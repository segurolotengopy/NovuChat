// CONFIRMAR ENVIO: lo unico que se da por hecho es lo que Meta ACEPTO.
//
// CORRE AL FINAL. Es el hijo mas bajo de «Armar mensajes» en el lienzo (por encima solo esta «Resumen del turno», que no lee
// envios) y el flujo va con `executionOrder: v1`: cuando llega aca ya corrieron el envio al cliente (y su respaldo), el aviso a
// recepcion, el CRM y la planilla. Si se lo sube en el lienzo, lee envios que todavia no ocurrieron.
//
// HACE TRES COSAS, sin ninguna llamada a Meta (lee lo que ya contesto):
//  1. Si Meta rechazo un mensaje AL CLIENTE —el texto, o el interactivo Y su respaldo— o el envio no llego a Meta, TERMINA LA
//     EJECUCION EN ERROR (`throw`) con el codigo y el mensaje de Meta. «Enviar a WhatsApp» usa `neverError` para poder mandar el
//     respaldo, y sin este nodo un texto rechazado terminaba en «success» sin que nadie se enterara. El error NO lleva el texto
//     de la respuesta ni el telefono del cliente.
//  2. Solo lo que salio pasa a «Reportar mensaje (saliente)». El servidor cuenta cada saliente como una respuesta del bloque: reportar
//     uno que no salio se le facturaba al comercio. Salio solo si Meta devolvio `messages[0].id`; ese id viaja como `idMeta`.
//     El aviso a recepcion NO se reporta (no es una respuesta al cliente) y en modo prueba nada se reporta.
//  3. Marca `avisado` recien cuando Meta acepto la PLANTILLA del aviso. Un aviso rechazado queda en `avisoFalla` y el estado NO dice
//     que se aviso: el proximo pedido del asesor vuelve a intentarlo (un mensaje que Meta rechaza no se cobra). Un aviso rechazado
//     NO corta la ejecucion: al cliente si se le respondio, y cortar dejaria sin reportar esa respuesta, que es la que se factura.
// Es el unico nodo, ademas de «Armar mensajes», que escribe la ficha, y solo esos dos campos. MENSAJES: ninguno.
const items = $input.all().map((x) => x.json);
const enviables = items.filter((i) => i && i.sinMensajes !== true);
// Sin envio (modo prueba sin `enviarDeVerdad`, o nada que enviar) no hay nada que confirmar.
if (!enviables.length || !cnNodo('Enviar a WhatsApp')) return [];

const acepto = (r) => { const s = Number(r && r.statusCode); return !!r && !r.error && s >= 200 && s < 300; };
const cuerpoDe = (r) => {
  let c = r ? r.body : undefined;
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch (err) { c = {}; } }
  return c && typeof c === 'object' ? c : {};
};
// El id que Meta devuelve al aceptar un mensaje (`messages[0].id`); vacio si no hay.
const idDe = (r) => {
  const c = cuerpoDe(r);
  const id = Array.isArray(c.messages) && c.messages[0] ? c.messages[0].id : undefined;
  return typeof id === 'string' ? id.trim() : '';
};
// Codigo y mensaje de Meta en una linea, sin datos del cliente.
const detalle = (r, telefono) => {
  if (!r) return 'el nodo de envío no devolvió nada';
  const c = cuerpoDe(r);
  const e = c.error && typeof c.error === 'object' ? c.error : (r.error && typeof r.error === 'object' ? r.error : {});
  const partes = [r.statusCode !== undefined ? 'HTTP ' + r.statusCode : 'sin respuesta HTTP'];
  if (e.code !== undefined) partes.push('código ' + e.code);
  if (e.error_subcode !== undefined) partes.push('subcódigo ' + e.error_subcode);
  if (e.type) partes.push(String(e.type));
  let msg = String(e.message !== undefined ? e.message : (e.description !== undefined ? e.description : (typeof r.error === 'string' ? r.error : '')));
  const dig = cnDigitos(telefono);
  if (dig.length >= 6) msg = msg.split(dig).join('[destinatario]');
  msg = msg.replace(/\s+/g, ' ').trim().slice(0, 200);
  return partes.join(', ') + (msg ? ': ' + msg : '');
};

const prueba = cnCfg().modoPrueba === true;
const envios = cnTodos('Enviar a WhatsApp');
const respaldos = cnTodos('Enviar texto de respaldo');
const from = String((enviables[0] && enviables[0].from) || '');
const fichas = cnMapaDeFichas(true);
const ficha = cnClaveValida(from) && Object.prototype.hasOwnProperty.call(fichas.mapa, from) ? fichas.mapa[from] : null;

const salen = [];
const fallas = [];
let avisoAceptado = false;
let usados = 0;
enviables.forEach((it) => {
  const k = enviables.indexOf(it);
  const envio = envios[k];
  // El mismo criterio que «¿Falló el interactivo?»: solo entonces corrio el respaldo, en el mismo orden.
  const porRespaldo = !acepto(envio) && it.esInteractivo === true;
  const final = porRespaldo ? respaldos[usados++] : envio;
  if (it.destino === 'recepcion') {
    if (it.marcaAvisado === true && ficha) {
      if (acepto(final)) { ficha.avisado = true; ficha.avisoFalla = ''; avisoAceptado = true; } else ficha.avisoFalla = 'aviso_rechazado: ' + detalle(final, from);
    }
    return;
  }
  if (!acepto(final)) {
    fallas.push(porRespaldo
      ? detalle(final, from) + ' (respaldo en texto; antes el interactivo: ' + detalle(envio, from) + ')'
      : detalle(final, from) + ' (' + (it.esInteractivo ? 'interactivo' : 'texto') + ')');
    return;
  }
  const idMeta = idDe(final);
  if (!idMeta || prueba || it.reportar !== true) return;
  salen.push({ json: {
    from: from, phoneNumberId: it.phoneNumberId, tipo: porRespaldo ? 'text' : it.tipoReporte,
    texto: porRespaldo ? String(it.respaldo || '') : String(it.texto || ''), idMeta: idMeta, evento: it.evento || '',
  }, pairedItem: { item: items.indexOf(it) } });
});

if (fallas.length) {
  // R8: si Meta rechazo el mensaje al cliente (y su respaldo), la conversacion NO avanzo para el: se restaura la ficha de antes del
  // turno, conservando `ultimosIds` y `ultimoMensajeMs` (el reenvio de Meta sigue siendo un repetido). Lo que ya salio de verdad —el
  // aviso a recepcion— se conserva: `avisado` no se pierde.
  const previa = items[0] && items[0].fichaAntes;
  if (ficha && previa && typeof previa === 'object') {
    const ids = Array.isArray(ficha.ultimosIds) ? ficha.ultimosIds.slice() : [];
    const hora = ficha.ultimoMensajeMs;
    const restaurada = JSON.parse(JSON.stringify(previa));
    restaurada.ultimosIds = ids;
    restaurada.ultimoMensajeMs = hora;
    if (avisoAceptado) { restaurada.avisado = true; restaurada.avisoFalla = ''; }
    fichas.mapa[from] = restaurada;
  }
  throw new Error('Meta rechazó el mensaje al cliente: ' + fallas.join(' | '));
}
return salen;
