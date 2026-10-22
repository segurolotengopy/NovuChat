// ARMAR MENSAJES (esqueleto, PR-A): lo que sale a la persona, armado por CÓDIGO. UN SOLO MENSAJE por turno, o ninguno.
//   puerta «suspendido»    -> el texto neutro del comercio (sin revelar el motivo);
//   puerta «uso_extendido» -> el aviso fijo, solo si el estado es «operador»; si es «bloqueado» (pausa por persona) NO SALE NADA: cero envío, cero modelo, cero descarga;
//   puerta «sigue»         -> `otro`: el texto cortés fijo; `pendiente`: nada (PR-B).
// La ficha del teléfono (`doctoras[<messages[0].from>]`) se escribe AQUÍ, una sola vez por turno.
const cfg = cnCfg();
const t = cnPrimero('Normalizar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const decision = cnPrimero('Decidir turno') || {};
const plan = decision.plan && typeof decision.plan === 'object' ? decision.plan : { tipo: 'nada' };
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const prueba = cfg.modoPrueba === true;
const telPrueba = String(cfg.telefonoDePrueba || '');
let m = null;
const texto = (cuerpo, extra) => { const c = drTexto(cuerpo); return cmMensaje('cliente', cmTexto(c), c, c, Object.assign({ tipoReporte: 'text' }, extra || {})); };
if (puerta.ruta === 'suspendido' || puerta.ruta === 'uso_extendido') {
  if (puerta.responder === true && String(puerta.texto || '').trim() !== '') m = texto(String(puerta.texto));
} else if (puerta.ruta === 'sigue' && plan.tipo === 'otro') {
  m = texto(DR_TEXTO_CORTES);
}
if (cnClaveValida(from)) {
  const fichas = cnMapaDeFichas(true);
  const ficha = drFichaVigente(cnFichaDe(fichas.mapa, from), ahora);
  drRecordarIds(ficha, [t.mensajeId]);
  ficha.turnos += 1;
  ficha.ultimoMs = ahora;
  fichas.mapa[from] = ficha;
  drBarrer(fichas.mapa, ahora);
}
const resumen = { plan: plan.tipo === 'nada' ? (puerta.ruta || 'nada') : plan.tipo, mensajes: 0, categoria: t.categoria || '' };
const numero = prueba ? telPrueba : from;
const sale = !!m && numero !== '';
resumen.mensajes = sale ? 1 : 0;
if (!sale) return [{ json: { sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: from, plan: resumen.plan, resumen: resumen } }];
m.payload.to = numero;
return [{ json: {
  para: numero, destino: m.para, payload: m.payload, texto: m.texto, respaldo: m.respaldo, tipoReporte: m.tipoReporte, evento: m.evento || '',
  reportar: !prueba, phoneNumberId: cfg.phoneNumberId, waGraphVersion: cfg.waGraphVersion || 'v26.0', from: from, sinMensajes: false, plan: resumen.plan, resumen: resumen,
} }];
