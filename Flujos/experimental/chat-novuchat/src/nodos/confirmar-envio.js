// CONFIRMAR ENVÍO (PROPIO de este flujo: la ficha es propia): lo único que se da por hecho es lo que Meta ACEPTÓ.
//
// El envío y el reporte saliente son COMUNES (`comun-sin-agente/src/envio.mjs`: «Enviar a WhatsApp», «Enviar respaldo», «Reportar mensaje (saliente)»). Este nodo no envía ni reporta:
// solo lee lo que esa cadena contestó, y hace lo que depende de la ficha. CORRE AL FINAL: es el hijo más bajo de «Armar mensajes» salvo «Resumen del turno» (`executionOrder: v1`).
//
//  1. Si Meta rechazó un mensaje AL CLIENTE (y su respaldo en texto) TERMINA LA EJECUCIÓN EN ERROR (`throw`) con el código y el mensaje de Meta, sin el teléfono: el envío común no corta el turno
//     (`continueRegularOutput`), y sin este nodo un texto rechazado terminaba en «success» sin que nadie se enterara. Y RESTAURA la ficha de antes del turno (`fichaAntes`, con la cola de
//     eventos sin responder: el próximo mensaje los responde juntos), conservando `ultimosIds` y `ultimoMs` (el reenvío de Meta sigue siendo un repetido) y el `avisado` de un aviso que sí salió.
//  2. Marca `avisado` recién cuando Meta aceptó la PLANTILLA del aviso. Un aviso rechazado queda en `avisoFalla` y el próximo pedido vuelve a intentarlo. Un aviso rechazado NO corta la ejecución:
//     al cliente sí se le respondió.
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
const fichas = cnMapaDeFichas(true);
const ficha = cnFichaDe(fichas.mapa, from);

const fallas = [];
let avisoAceptado = false;
let avisosGuardados = null; // { empresas, n } de la ficha tras el aviso aceptado
let usados = 0;
enviables.forEach((it, k) => {
  const envio = envios[k];
  // El respaldo corre, en el mismo orden, para cada envío que falló.
  const porRespaldo = !acepto(envio);
  const final = porRespaldo ? respaldos[usados++] : envio;
  if (it.destino === 'recepcion') {
    if (it.marcaAvisado === true && ficha) {
      // El aviso cuenta SOLO si Meta aceptó la plantilla: el texto de respaldo que la cadena común manda tras un rechazo no es el aviso.
      if (acepto(envio)) { ficha.avisado = true; ficha.avisoFalla = ''; 
        // Se recuerdan las empresas avisadas en la ventana (a lo más 3) y cuántos avisos van: el tope acota la plantilla por segunda empresa.
        const emp = String(it.empresaAviso || '').slice(0, 60);
        const previas = Array.isArray(ficha.empresasAvisadas) ? ficha.empresasAvisadas.filter((x) => typeof x === 'string') : [];
        ficha.empresasAvisadas = emp && !previas.includes(emp) ? previas.concat([emp]).slice(-3) : previas.slice(-3);
        ficha.avisosVentana = Math.min(3, (Number(ficha.avisosVentana) || 0) + 1);
        avisosGuardados = { empresas: ficha.empresasAvisadas.slice(), n: ficha.avisosVentana };
        avisoAceptado = true;
      } else ficha.avisoFalla = 'aviso_rechazado: ' + detalle(envio, from);
    }
    return;
  }
  if (!acepto(final)) {
    fallas.push(porRespaldo
      ? detalle(final, from) + ' (respaldo en texto; antes: ' + detalle(envio, from) + ')'
      : detalle(final, from));
  }
});

if (fallas.length) {
  const previa = items[0] && items[0].fichaAntes;
  if (ficha && previa && typeof previa === 'object') {
    const ids = Array.isArray(ficha.ultimosIds) ? ficha.ultimosIds.slice() : [];
    const hora = ficha.ultimoMs;
    const restaurada = JSON.parse(JSON.stringify(previa));
    restaurada.ultimosIds = ids;
    restaurada.ultimoMs = hora;
    if (avisoAceptado) { restaurada.avisado = true; restaurada.avisoFalla = ''; if (avisosGuardados) { restaurada.empresasAvisadas = avisosGuardados.empresas; restaurada.avisosVentana = avisosGuardados.n; } }
    fichas.mapa[from] = restaurada;
  }
  throw new Error('Meta rechazó el mensaje al cliente: ' + fallas.join(' | '));
}
return [];
