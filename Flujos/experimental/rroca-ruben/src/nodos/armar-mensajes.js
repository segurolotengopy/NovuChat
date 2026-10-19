// ARMAR MENSAJES (PR-1, el esqueleto): lo que sale al cliente, armado por CÓDIGO. No hay modelo, ni cobro, ni QR, ni comprobante, ni rescate (son PR-2 a PR-4).
//
// UN SOLO MENSAJE por turno, o ninguno:
//   puerta «sigue»            -> el saludo fijo del asistente virtual de Rubén (para cualquier texto, toque o medio);
//   puerta «suspendido»        -> el texto neutro del comercio (sin revelar el motivo);
//   puerta «uso_extendido»     -> el aviso fijo, solo si el estado es «operador»; si es «bloqueado» (pausa por persona) NO SALE NADA: cero envío y cero modelo;
// Todo texto pasa por `rrSeguro` (NIEGA_IA, prohibición 4). El aviso a recepción de un uso extendido es de PR-3: aquí `transferir` no envía nada.
//
// La ficha del teléfono (`rroca[<messages[0].from>]`) se escribe AQUÍ, una sola vez por turno: la clave es SIEMPRE el número de origen, así que dos teléfonos jamás comparten estado.
// Hasta en un turno sin mensaje (bloqueado) se recuerda el id de Meta, para que una entrega repetida no se cuente dos veces.
const cfg = cnCfg();
const t = cnPrimero('Interpretar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const prueba = cfg.modoPrueba === true;
const telPrueba = String(cfg.telefonoDePrueba || '');
const claveOk = cnClaveValida(from);

let texto = '';
if (puerta.ruta === 'sigue') texto = RR_SALUDO;
else if ((puerta.ruta === 'suspendido' || puerta.ruta === 'uso_extendido') && puerta.responder === true) texto = String(puerta.texto || '');
texto = texto.trim() === '' ? '' : rrSeguro(texto);

// La ficha: un solo lugar, al final del turno.
if (claveOk) {
  const fichas = cnMapaDeFichas(true);
  const ficha = rrFichaVigente(cnFichaDe(fichas.mapa, from));
  rrRecordarId(ficha, t.mensajeId);
  ficha.turnos += 1;
  ficha.ultimoMs = ahora;
  fichas.mapa[from] = ficha;
  rrBarrer(fichas.mapa, ahora);
}

let numero = from;
if (prueba) numero = telPrueba;
// `mensajes` se calcula DESPUÉS de decidir el número: en prueba con un teléfono no permitido (`telPrueba` vacío) no sale nada y el resumen lo dice.
const sale = texto !== '' && numero !== '';
const resumen = { plan: puerta.ruta || 'nada', mensajes: sale ? 1 : 0, categoria: t.categoria || '' };
if (!sale) {
  return [{ json: { sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: from, plan: resumen.plan, resumen: resumen } }];
}
const m = cmMensaje('cliente', cmTexto(texto), texto, texto, { tipoReporte: 'text', evento: puerta.ruta || '' });
m.payload.to = numero;
return [{ json: {
  para: numero, destino: m.para, payload: m.payload, texto: m.texto, respaldo: m.respaldo,
  tipoReporte: m.tipoReporte, evento: m.evento, esInteractivo: false, esAviso: false, marcaAvisado: false, empresaAviso: '',
  // Solo lo que sale al cliente se reporta; en modo prueba, nada.
  reportar: !prueba,
  phoneNumberId: cfg.phoneNumberId, waGraphVersion: cfg.waGraphVersion || 'v26.0', from: from, sinMensajes: false,
  plan: resumen.plan, resumen: resumen,
} }];
