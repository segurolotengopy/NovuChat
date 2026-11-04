// ARMAR TURNO: tras la espera de la ráfaga, decide lo que se resuelve sin el modelo y, si hace falta el modelo, arma su pedido.
//
// 1. La ficha de este turno es la que «Registrar evento» dejó COMPROMETIDA en el servidor (`cnRegistro`), con su versión: no se relee tras la espera (enmienda §6.1.3).
//    Si en la ráfaga otra ejecución registró un evento más nuevo, este turno lo descubre al comprometer («Armar mensajes»): la más nueva responde por todos.
// 2. Los eventos a responder son TODOS los de la cola desde el último mensaje del asistente (`seq` mayor que `hasta`): «el usuario tocó Salud, Gastronomía, Retail».
// 3. `chDecidir`: un toque de botón o un detector del CÓDIGO (costo del servicio, consumo, tope de un plan, banco, costos de Meta, integraciones, descuento, pedido de una persona)
//    resuelve sin modelo; la lista de rubros al primer saludo; todo lo demás cae en el modelo («Catch All»), con su contexto.
// 4. Una sola llamada al modelo por turno: instrucciones del documento + historial + eventos. La `systemInstruction` es estática; el turno va en `contents`.
// Este nodo NO escribe nada. Si la puerta cerró el turno deja el plan «suspendido» o «uso_extendido»; si no hay estado en el servidor (el `leer` o el registro fallaron), «sin_estado»:
// «Armar mensajes» lo cumple (genérico con botón, sin avisos ni compromiso).
const t = cnPrimero('Interpretar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const reg = cnPrimero('Registrar evento') || {};
const cfg = cnCfg();
const sesion = cfg.sesion && typeof cfg.sesion === 'object' ? cfg.sesion : { ok: false, version: 0, estado: null };
const cerrado = (ruta) => [{ json: { plan: { ruta: ruta, fijo: '', contexto: '', rubroElegido: '', temas: [], hechos: {}, aMedida: false }, eventos: [], hasta: 0, llamarModelo: false, cuerpoModelo: null, modelo: cfg.modelo, precios: false, from: t.from,
  ficha: sesion.ok === true ? chFichaVigente(sesion.estado, t.ahoraMs) : null, version: sesion.ok === true ? sesion.version : 0 } }];
if (puerta.ruta !== 'sigue') return cerrado(puerta.ruta);
if (reg.falla === true) return cerrado('sin_estado');
if (reg.registrado !== true) return [];
const r = cnRegistro();
// Agotados los intentos de registro y el ganador ya trae un evento más nuevo: otra ejecución responde (ráfaga de 4 o más clics); esta termina SIN enviar.
if (r.cede === true) return [];
if (!r.ok) return cerrado('sin_estado');
const f = chFichaVigente(r.ficha, t.ahoraMs);
const eventos = f.cola.filter((e) => e.seq > f.hasta);
if (!eventos.length) return [];
const plan = chDecidir({ eventos: eventos, ficha: f, cfg: cfg, from: t.from });
const precios = chContextoPrecios(f, eventos);
const llamar = plan.ruta === 'modelo';
const cuerpo = llamar ? chCuerpoModelo({ cfg: cfg, ficha: f, eventos: eventos, contexto: plan.contexto, ahoraMs: t.ahoraMs, precios: precios }) : null;
return [{ json: { plan: plan, eventos: eventos, hasta: eventos[eventos.length - 1].seq, llamarModelo: llamar, cuerpoModelo: cuerpo, modelo: cfg.modelo, precios: precios, from: t.from, ficha: f, version: r.version } }];
