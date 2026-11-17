// ARMAR TURNO: tras la espera de la ráfaga, decide lo que se resuelve sin el modelo y, si hace falta el modelo, arma su pedido.
//
// 1. La ficha de este turno es la que «Registrar evento» dejó COMPROMETIDA en el servidor (`cnRegistro`), con su versión: no se relee tras la espera (enmienda §6.1.3).
//    Si en la ráfaga otra ejecución registró un evento más nuevo, este turno lo descubre al comprometer («Armar mensajes»): la más nueva responde por todos.
// 2. Los eventos a responder son TODOS los de la cola desde el último mensaje del asistente (`seq` mayor que `hasta`): «el usuario tocó Salud, Gastronomía, Retail».
// 3. `chDecidir`: un toque de botón o un detector del CÓDIGO (costo del servicio, consumo, tope de un plan, banco, costos de Meta, integraciones, descuento, pedido de una persona)
//    resuelve sin modelo; la lista de rubros al primer saludo; todo lo demás cae en el modelo («Catch All»), con su contexto.
// 4. Una sola llamada al modelo por turno: instrucciones del documento + historial + eventos. La `systemInstruction` es estática; el turno va en `contents`.
// Este nodo NO escribe nada. Si la puerta cerró el turno deja el plan «suspendido» o «uso_extendido»; si no hay estado en el servidor (el `leer` o el registro fallaron), «sin_estado»:
// «Armar mensajes» lo cumple (genérico con botón y aviso a recepción, sin compromiso).
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
let plan = chDecidir({ eventos: eventos, ficha: f, cfg: cfg, from: t.from });
// LA BAJA POR NOTA DE VOZ (decisión de Andres, 16/11/2026): la puerta solo ve el texto ESCRITO (`t.texto`); un audio llega a la cola con su TRANSCRIPCIÓN (`k: 'audio'`, `c`, con el tope de 4.400 caracteres de «Registrar evento»).
// Si el audio final de este turno pide la baja (`bjPideBaja`, pieza común del core), el turno es `baja`: UN texto fijo, sin modelo, botones ni aviso (0 mensajes agregados: reemplaza la respuesta del turno). El entrante de un audio
// no marca `no_contactar`, así que `porVoz` hace que «Armar mensajes» lo ponga en el reporte del mensaje SALIENTE de la confirmación (confirmar sin registrar está prohibido). Un audio sin transcripción (`c` vacío) sigue su camino.
// SEGUNDA PASADA (16/11/2026): la baja por voz solo se decide si ese audio es el ÚLTIMO evento CON CONTENIDO de la ráfaga (un mensaje posterior del cliente manda: sigue su camino y no se pierde) y su transcripción es CORTA (hasta `CH_BAJA_VOZ_MAX` caracteres).
// `hastaBaja` = el `seq` de ese audio: «Armar mensajes» marca respondido SOLO hasta ahí, nunca mensajes posteriores.
const CH_BAJA_VOZ_MAX = 160;
const conContenido = eventos.filter((e) => e && ((typeof e.c === 'string' && e.c !== '') || e.boton));
const ultimoConContenido = conContenido[conContenido.length - 1];
if (ultimoConContenido && ultimoConContenido.k === 'audio' && ultimoConContenido.c.length <= CH_BAJA_VOZ_MAX && bjPideBaja(ultimoConContenido.c)) plan = { ruta: 'baja', porVoz: true, hastaBaja: ultimoConContenido.seq, fijo: '', contexto: '', rubroElegido: '', temas: [], soporte: false, tope: false, hechos: {}, aMedida: false };
const precios = chContextoPrecios(f, eventos);
const llamar = plan.ruta === 'modelo';
const cuerpo = llamar ? chCuerpoModelo({ cfg: cfg, ficha: f, eventos: eventos, contexto: plan.contexto, ahoraMs: t.ahoraMs, precios: precios }) : null;
return [{ json: { plan: plan, eventos: eventos, hasta: eventos[eventos.length - 1].seq, llamarModelo: llamar, cuerpoModelo: cuerpo, modelo: cfg.modelo, precios: precios, from: t.from, ficha: f, version: r.version } }];
