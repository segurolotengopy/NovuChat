// CONFIRMAR ENVÍO (PROPIO de este flujo: la ficha es propia): lo único que se da por hecho es lo que Meta ACEPTÓ.
//
// El envío y el reporte saliente son COMUNES (`comun-sin-agente/src/envio.mjs`: «Enviar a WhatsApp», «Enviar respaldo», «Reportar mensaje (saliente)»). Este nodo no envía ni reporta:
// solo lee lo que esa cadena contestó, y hace lo que depende de la ficha. CORRE AL FINAL: es el hijo más bajo de «Soltar mensajes» salvo «Resumen del turno» (`executionOrder: v1`).
//
// El estado se COMPROMETIÓ ANTES de enviar («Armar mensajes»); este nodo no escribe en ningún lado: ARMA el compromiso compensatorio (con la versión recién comprometida) y «Cerrar turno» corta.
//  1. Si Meta rechazó un mensaje AL CLIENTE (y su respaldo en texto): `error` (código y mensaje de Meta, sin el teléfono) y compensación: la ficha de ANTES del turno (`fichaAntes`, con la cola de
//     eventos sin responder: el próximo mensaje los responde juntos), conservando `ultimosIds` y `ultimoMs` (el reenvío de Meta sigue siendo un repetido) y el `avisado` de un aviso que sí salió.
//  2. `avisado` ya se comprometió con el aviso; si Meta rechazó la PLANTILLA, se deshace (compensación) y queda en `avisoFalla`: el próximo pedido vuelve a intentarlo. Un aviso rechazado NO corta
//     la ejecución: al cliente sí se le respondió.
// Un envío «aceptado» es el que devolvió `messages[0].id` y ningún `error`. MENSAJES: ninguno.
const items = $input.all().map((x) => x.json);
const enviables = items.filter((i) => i && i.sinMensajes !== true);
// Sin envío (modo prueba sin `enviarDeVerdad`, o nada que enviar) no hay nada que confirmar.
if (!enviables.length || !cnNodo('Enviar a WhatsApp')) return [];

const idDe = (r) => {
  const id = r && Array.isArray(r.messages) && r.messages[0] ? r.messages[0].id : undefined;
  return typeof id === 'string' ? id.trim() : '';
};
const acepto = (r) => !!r && !r.error && idDe(r) !== '';
// Código y mensaje de Meta en una línea, sin datos del cliente.
const detalle = (r, telefono) => {
  if (!r) return 'el nodo de envío no devolvió nada';
  const e = r.error && typeof r.error === 'object' ? r.error : {};
  const partes = [e.httpCode !== undefined ? 'HTTP ' + e.httpCode : 'sin respuesta HTTP'];
  let msg = String(e.message !== undefined ? e.message : (e.description !== undefined ? e.description : (typeof r.error === 'string' ? r.error : '')));
  const dig = cnDigitos(telefono);
  if (dig.length >= 6) msg = msg.split(dig).join('[destinatario]');
  msg = msg.replace(/\s+/g, ' ').trim().slice(0, 200);
  return partes.join(', ') + (msg ? ': ' + msg : '');
};

const envios = cnTodos('Enviar a WhatsApp');
const respaldos = cnTodos('Enviar respaldo');
const from = String((enviables[0] && enviables[0].from) || '');
const primero = items[0] || {};
const comprometido = primero.comprometido === true && primero.estadoComprometido && typeof primero.estadoComprometido === 'object';

const fallas = [];
let avisoAceptado = false;
let avisoRechazado = '';
let usados = 0;
enviables.forEach((it, k) => {
  const envio = envios[k];
  // El respaldo corre, en el mismo orden, para cada envío que falló.
  const porRespaldo = !acepto(envio);
  const final = porRespaldo ? respaldos[usados++] : envio;
  if (it.destino === 'recepcion') {
    // El aviso cuenta SOLO si Meta aceptó la plantilla: el texto de respaldo que la cadena común manda tras un rechazo no es el aviso.
    if (it.marcaAvisado === true) {
      if (acepto(envio)) avisoAceptado = true;
      else avisoRechazado = 'aviso_rechazado: ' + detalle(envio, from);
    }
    return;
  }
  if (!acepto(final)) {
    fallas.push(porRespaldo
      ? detalle(final, from) + ' (respaldo en texto; antes: ' + detalle(envio, from) + ')'
      : detalle(final, from));
  }
});

if (!fallas.length && !avisoRechazado) return [];
let estado = null;
if (comprometido) {
  const comp = primero.estadoComprometido;
  const previa = primero.fichaAntes && typeof primero.fichaAntes === 'object' ? primero.fichaAntes : null;
  if (fallas.length && previa) {
    estado = JSON.parse(JSON.stringify(previa));
    estado.ultimosIds = Array.isArray(comp.ultimosIds) ? comp.ultimosIds.slice() : [];
    estado.ultimoMs = comp.ultimoMs;
    if (avisoAceptado) { estado.avisado = true; estado.avisoFalla = ''; estado.empresasAvisadas = comp.empresasAvisadas; estado.avisosVentana = comp.avisosVentana; }
  } else if (avisoRechazado && previa) {
    // Meta aceptó la respuesta al cliente pero rechazó la plantilla: se deshace solo el `avisado` comprometido de antemano.
    estado = JSON.parse(JSON.stringify(comp));
    estado.avisado = previa.avisado === true;
    estado.empresasAvisadas = previa.empresasAvisadas;
    estado.avisosVentana = previa.avisosVentana;
    estado.avisoFalla = avisoRechazado.slice(0, 200);
  }
}
const compensar = estado ? cnCuerpoComprometer(from, $execution.id, 'comp', Number(primero.versionComprometida) || 0, estado) : null;
return [{ json: { compensar: compensar !== null, compromiso: compensar, numero: primero.numero || cnNumeroHeader(), error: fallas.length ? 'Meta rechazó el mensaje al cliente: ' + fallas.join(' | ') : '', avisoRechazado: avisoRechazado } }];
