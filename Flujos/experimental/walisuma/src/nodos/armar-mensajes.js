// ARMAR MENSAJES (ESQUELETO, PR-2): lo que sale al cliente, armado por CÓDIGO. UN SOLO MENSAJE por turno, o ninguno (+0 mensajes agregados).
//
// En el esqueleto solo sale lo que ya se decide sin conversación:
//   puerta «suspendido»     -> el texto neutro del comercio (sin revelar el motivo);
//   puerta «uso_extendido»  -> el aviso fijo, solo si el estado es «operador»; si es «bloqueado» (pausa por Tomar) NO SALE NADA: cero envío, cero modelo, cero descarga;
//   puerta «sigue»          -> un número de otro país recibe el texto fijo (a lo más una vez en 24 h: lo decide «Normalizar entrada», que solo lee la ficha); un tipo que este canal no lee recibe el texto cortés;
//                              todo lo demás: ningún mensaje (la conversación, el carrito, el cobro y los avisos son del PR-3).
//
// PUNTO DE EMPALME DEL PR-3: aquí se agrega la lectura del plan de «Decidir turno» (`$('Decidir turno')`), el armado de la venta (carrito, cobro, derivación) y el estado de los avisos (`$('Armar avisos')`). La forma del ítem de salida
// (la que consumen «¿Enviar de verdad?», «Enviar a WhatsApp», «Reportar mensaje (saliente)» y «Resumen del turno») ya es la definitiva.
//
// LA FICHA del teléfono (`staticData.global.walisuma[<messages[0].from>]`) se escribe AQUÍ, una sola vez por turno, con la clave `from` de «Normalizar entrada» (= `messages[0].from`); nunca con otro dato. «Resumen del turno» devuelve
// `fueraDePaisMs` si Meta no aceptó el envío (`revertirFicha`): un texto que no salió no cuenta como enviado.
const cfg = cnCfg();
const t = cnPrimero('Normalizar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const prueba = cfg.modoPrueba === true;
const telPrueba = String(cfg.telefonoDePrueba || '');
const claveOk = cnClaveValida(from);
const sinSalida = (resumen) => [{ json: { sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: from, plan: resumen.plan, resumen: resumen } }];
if (!claveOk) return sinSalida({ plan: 'nada', mensajes: 0, categoria: '', llamadasModelo: 0 });

const fichaAntes = CN_TENANT.fichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from), ahora);
const texto = (cuerpo) => { const c = wlSeguro(cuerpo); return cmMensaje('cliente', cmTexto(c), c, c, { tipoReporte: 'text' }); };

let m = null;
let tipoDePlan = 'nada';
let marcaFueraDePais = false;
if (puerta.ruta === 'suspendido') {
  m = texto(puerta.texto); tipoDePlan = 'suspendido';
} else if (puerta.ruta === 'uso_extendido') {
  // «bloqueado» no responde nada (responder=false): ni mensaje, ni modelo.
  if (puerta.responder === true && String(puerta.texto || '').trim() !== '') { m = texto(puerta.texto); tipoDePlan = 'uso_extendido'; }
  else tipoDePlan = 'bloqueado';
} else if (puerta.ruta === 'sigue') {
  if (t.fueraDePais === true) { m = texto(WL_TEXTO_FUERA_DE_PAIS); tipoDePlan = 'fuera_de_pais'; marcaFueraDePais = true; }
  else if (t.categoria === 'otro') { m = texto(WL_TEXTO_CORTES); tipoDePlan = 'cortes'; }
}

// La ficha: se escribe siempre (también cuando no sale nada), una vez por turno, y solo la de ESTE teléfono.
const fichas = cnMapaDeFichas(true);
if (fichas.sd) {
  const ficha = CN_TENANT.fichaVigente(cnFichaDe(fichas.mapa, from), ahora);
  wlRecordarIds(ficha, [t.mensajeId]);
  ficha.ultimoMs = ahora;
  ficha.turnos = Math.min(ficha.turnos + 1, 100000);
  if (m) ficha.saludado = true;
  if (marcaFueraDePais) ficha.fueraDePaisMs = ahora;
  fichas.mapa[from] = ficha;
  wlBarrer(fichas.mapa, ahora);
}

const resumen = { plan: tipoDePlan === 'nada' ? (puerta.ruta || 'nada') : tipoDePlan, mensajes: 0, categoria: t.categoria || '', llamadasModelo: 0 };
let numero = from;
if (prueba) numero = telPrueba;
// `mensajes` se calcula DESPUÉS de decidir el número: en prueba con un teléfono no permitido (`telPrueba` vacío) no sale nada y el resumen lo dice.
const sale = !!m && numero !== '';
resumen.mensajes = sale ? 1 : 0;
if (!sale) return sinSalida(resumen);
m.payload.to = numero;
const salida = {
  para: numero, destino: m.para, payload: m.payload, texto: m.texto, respaldo: m.respaldo,
  tipoReporte: m.tipoReporte, evento: m.evento || '', esInteractivo: m.tipoReporte === 'interactive', esAviso: false,
  // Solo lo que sale al cliente se reporta; en modo prueba, nada.
  reportar: !prueba,
  phoneNumberId: cfg.phoneNumberId, waGraphVersion: cfg.waGraphVersion || 'v26.0', from: from, sinMensajes: false,
  plan: resumen.plan, resumen: resumen,
};
if (marcaFueraDePais) salida.revertirFicha = { fueraDePaisMs: fichaAntes.fueraDePaisMs };
return [{ json: salida }];
