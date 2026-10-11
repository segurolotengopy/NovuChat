// ARMAR TURNO: tras la espera de la ráfaga, SOLO la última ejecución de cada teléfono sigue. Decide lo que se resuelve sin el modelo y, si hace falta el modelo, arma su pedido.
//
// 1. Si el evento de esta ejecución ya no es el último de su teléfono (`ficha.seq`), otra ejecución más nueva responde por todas: este nodo no emite nada y la ejecución termina.
// 2. Los eventos a responder son TODOS los de la cola desde el último mensaje del asistente (`seq` mayor que `hasta`): «el usuario tocó Salud, Gastronomía, Retail».
// 3. `chDecidir`: un toque de botón o un detector del CÓDIGO (costo del servicio, consumo, tope de un plan, banco, costos de Meta, integraciones, descuento, pedido de una persona)
//    resuelve sin modelo; la lista de rubros al primer saludo; todo lo demás cae en el modelo («Catch All»), con su contexto.
// 4. Una sola llamada al modelo por turno: instrucciones del documento + historial + eventos. La `systemInstruction` es estática; el turno va en `contents`.
// Este nodo SOLO LEE la ficha. Si la puerta cerró el turno, deja el plan «suspendido» o «uso_extendido» y «Armar mensajes» lo cumple.
const t = cnPrimero('Interpretar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const reg = cnPrimero('Registrar evento') || {};
const cfg = cnCfg();
if (puerta.ruta !== 'sigue') {
  return [{ json: { plan: { ruta: puerta.ruta, fijo: '', contexto: '', rubroElegido: '', temas: [], hechos: {}, aMedida: false }, eventos: [], hasta: 0, llamarModelo: false, cuerpoModelo: null, modelo: cfg.modelo, precios: false, from: t.from } }];
}
if (reg.registrado !== true) return [];
const f = chFichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, t.from), t.ahoraMs);
// Otra ejecución registró un evento después del mío: ella responde (con el mío incluido).
if (f.seq !== reg.seq) return [];
const eventos = f.cola.filter((e) => e.seq > f.hasta);
if (!eventos.length) return [];
const plan = chDecidir({ eventos: eventos, ficha: f, cfg: cfg, from: t.from });
const precios = chContextoPrecios(f, eventos);
const llamar = plan.ruta === 'modelo';
const cuerpo = llamar ? chCuerpoModelo({ cfg: cfg, ficha: f, eventos: eventos, contexto: plan.contexto, ahoraMs: t.ahoraMs, precios: precios }) : null;
return [{ json: { plan: plan, eventos: eventos, hasta: eventos[eventos.length - 1].seq, llamarModelo: llamar, cuerpoModelo: cuerpo, modelo: cfg.modelo, precios: precios, from: t.from } }];
