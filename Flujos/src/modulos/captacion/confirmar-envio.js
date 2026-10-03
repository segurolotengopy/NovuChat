// CONFIRMAR ENVIO: lo unico que se da por hecho es lo que Meta ACEPTO.
//
// CORRE AL FINAL. Es el hijo mas bajo de `Salida` en el lienzo y el flujo va
// con `executionOrder: v1`: cuando llega aca ya corrieron el envio al cliente
// (y su respaldo), el aviso interno, el CRM y la planilla. Por eso puede leer
// el resultado de los cuatro, y por eso un error aca no se lleva por delante
// al aviso, al CRM ni a la planilla. Si se lo sube en el lienzo, lee envios que
// todavia no ocurrieron.
//
// HACE CUATRO COSAS, sin ninguna llamada a Meta (lee lo que ya contesto):
//  1. Si Meta rechazo el mensaje -- el texto, o el interactivo Y su respaldo --
//     o el envio no llego a Meta, TERMINA LA EJECUCION EN ERROR con el codigo y
//     el mensaje de Meta. `Enviar a WhatsApp` usa `neverError` para poder
//     mandar el respaldo, y sin este nodo un texto rechazado terminaba en
//     «success» sin que nadie se enterara (aceptacion del 15/09/2026: Meta
//     respondio 190 por una credencial mal asignada). Asi lo encuentra
//     `scripts/ver-ejecuciones.sh --error`. El error NO lleva el texto de la
//     respuesta ni el telefono del cliente.
//  2. Solo lo que salio pasa a `Reportar mensaje (saliente)`. El servidor cuenta
//     cada saliente como una respuesta del bloque (`ingesta.ts`,
//     `mensajesVentana`): reportar uno que no salio se le facturaba al comercio.
//     Regla I-ENTREGA: salio solo si Meta devolvio `messages[0].id`; ese id viaja
//     como `idMeta`. Una 2xx sin id no se reporta (ni corta la ejecucion).
//  3. Marca `avisado` recien cuando Meta acepto la PLANTILLA del aviso interno.
//     El 15/09/2026 `solicitud_contacto` todavia estaba en revision y Meta
//     rechazo el envio (132001): el flujo dio el aviso por hecho y los cuatro
//     prospectos que probaron quedaron marcados como avisados sin que nadie los
//     llamara, y sin boton para volver a pedirlo. Un aviso rechazado queda
//     anotado en los `avisos` del turno -- se ve con `scripts/ver-ejecuciones.sh`
//     -- y en la conversacion (`avisoFalla`), y el estado NO dice que se aviso:
//     el proximo turno vuelve a intentarlo (un mensaje que Meta rechaza no se
//     cobra) y el boton «Hablar con un asesor» sigue saliendo.
//     Un aviso rechazado NO termina la ejecucion en error: al cliente si se le
//     respondio, y cortar aca dejaria sin reportar esa respuesta, que es la que
//     el servidor cuenta y factura.
//     Lo mismo con el CRM: un POST rechazado se anota (`crm_rechazado`) y no
//     marca nada, porque el CRM no escribe estado; el proximo cambio del
//     prospecto lo vuelve a mandar. MENSAJES: ninguno, aca no se llama a Meta.
//  4. Anota si la PLANILLA no guardo la fila (`planilla_no_guardada`): no se
//     pudo leer, los encabezados no son los esperados, o Google rechazo la
//     escritura. Los nodos de Google corren con `continueRegularOutput`: un
//     fallo no corta la ejecucion -- al cliente ya se le respondio -- y sale
//     como el item de entrada con `error` al lado de `json`. Tampoco marca
//     nada: el proximo cambio de la ficha vuelve a intentarlo, y la fila se
//     busca por telefono.
const sd = $getWorkflowStaticData('global');
sd.conversaciones = sd.conversaciones ?? {};

const acepto = (r) => { const s = Number(r?.statusCode); return s >= 200 && s < 300; };

// El id que Meta devuelve al aceptar un mensaje (`messages[0].id`); vacio si no hay.
const idDe = (r) => {
  let cuerpo = r?.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (err) { cuerpo = {}; } }
  const id = cuerpo && Array.isArray(cuerpo.messages) ? cuerpo.messages[0]?.id : undefined;
  return typeof id === 'string' ? id.trim() : '';
};

// Lo que devolvio un nodo de envio; nada si no corrio.
const salidaDe = (nombre) => {
  try {
    const n = $(nombre);
    if (n.isExecuted === false) return [];
    return n.all().map((x) => x.json);
  } catch (err) {
    return [];
  }
};

// Los items COMPLETOS de un nodo -- con `error` si fallo --; nada si no corrio.
const itemsDe = (nombre) => {
  try {
    const n = $(nombre);
    if (n.isExecuted === false) return [];
    return n.all();
  } catch (err) {
    return [];
  }
};
// Por que no se escribio una fila de la planilla: SOLO el tipo y el codigo del
// error, nunca su mensaje, que podria repetir un dato del cliente (revision
// del PR #237). Vacio si se escribio.
const ESTADOS_GOOGLE = /\b(PERMISSION_DENIED|NOT_FOUND|INVALID_ARGUMENT|RESOURCE_EXHAUSTED|UNAUTHENTICATED|UNAVAILABLE|FAILED_PRECONDITION|DEADLINE_EXCEEDED|INTERNAL)\b/;
const fallaPlanilla = (it) => {
  if (!it) return 'el nodo de la planilla no devolvió la fila';
  const e = it.error ?? (it.json && it.json.error);
  if (!e) return '';
  if (typeof e !== 'object') return 'error';
  const tipo = /^[A-Za-z]{1,40}$/.test(String(e.name ?? '')) ? e.name : 'error';
  const codigo = [e.httpCode, e.context?.httpCode, e.status, e.statusCode]
    .map((v) => String(v ?? '')).find((v) => /^\d{3}$/.test(v))
    || (/\b([45]\d{2})\b/.exec(String(e.message ?? '')) || [])[1] || '';
  const estado = (ESTADOS_GOOGLE.exec(String(e.message ?? '') + ' ' + String(e.description ?? '')) || [])[1] || '';
  return [tipo, codigo && 'HTTP ' + codigo, estado].filter(Boolean).join(' ');
};

// Codigo y mensaje de Meta en una linea, sin datos del cliente.
const detalle = (r, telefono) => {
  if (!r) return 'el nodo de envío no devolvió nada';
  let cuerpo = r.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (err) { cuerpo = {}; } }
  const e = cuerpo && typeof cuerpo === 'object' && cuerpo.error && typeof cuerpo.error === 'object'
    ? cuerpo.error
    : (r.error && typeof r.error === 'object' ? r.error : {});
  const partes = [r.statusCode != null ? 'HTTP ' + r.statusCode : 'sin respuesta HTTP'];
  if (e.code != null) partes.push('código ' + e.code);
  if (e.error_subcode != null) partes.push('subcódigo ' + e.error_subcode);
  if (e.type) partes.push(String(e.type));
  if (e.fbtrace_id) partes.push('fbtrace ' + e.fbtrace_id);
  let msg = String(e.message ?? e.description ?? (typeof r.error === 'string' ? r.error : ''));
  const digitos = String(telefono ?? '').replace(/\D/g, '');
  if (digitos.length >= 6) msg = msg.split(digitos).join('[destinatario]');
  msg = msg.replace(/\s+/g, ' ').trim().slice(0, 200);
  return partes.join(', ') + (msg ? ': ' + msg : '');
};

const items = $input.all().map((x) => x.json);
// Lo que este nodo le agrega a los avisos del turno, por item.
const extra = items.map(() => []);

// --- El aviso interno y el CRM ------------------------------------------
// Emparejamiento por indice, igual que el envio: `¿Avisar a NovuChat?` deja
// pasar en orden los items con `avisar === true`, y `¿Guardar prospecto?` los
// de `guardar === true`. Va antes del retorno por telefono bloqueado: con el
// bloqueo no hay mensaje al cliente, pero el aviso a una persona si sale.
const avisosMeta = salidaDe('Avisar a NovuChat');
const guardados = salidaDe('Guardar prospecto');
const decisiones = salidaDe('Decidir fila de la planilla');
const agregadas = itemsDe('Agregar fila');
const actualizadas = itemsDe('Actualizar fila');
let a = 0;
let g = 0;
let p = 0;
let pa = 0;
let pu = 0;
items.forEach((s, k) => {
  if (s.avisar === true) {
    const r = avisosMeta[a++];
    const c = sd.conversaciones[s.from];
    if (acepto(r)) {
      if (c) { c.avisado = true; delete c.avisoFalla; }
    } else {
      const falla = 'aviso_rechazado: ' + detalle(r, s.from);
      extra[k].push(falla);
      if (c) c.avisoFalla = falla;
    }
  }
  // Del CRM solo se anota lo que contesto: si el nodo no corrio -- `crmUrl`
  // vacio, que es lo de hoy --, no hay nada que anotar.
  if (s.guardar === true) {
    const r = guardados[g++];
    if (r !== undefined && !acepto(r)) extra[k].push('crm_rechazado: ' + detalle(r, s.from));
  }
  // De la planilla, en cambio, la ausencia SI es una falla: `Prospecto para la
  // planilla` dejo pasar este item, asi que tenia que haber una decision.
  if (s.guardarPlanilla === true) {
    const d = decisiones[p++];
    let falla = '';
    if (!d) falla = 'no se llegó a decidir la fila';
    else if (d.accionPlanilla === 'agregar') falla = fallaPlanilla(agregadas[pa++]);
    else if (d.accionPlanilla === 'actualizar') falla = fallaPlanilla(actualizadas[pu++]);
    else if (d.veredictoPlanilla !== 'sin_cambios') falla = String(d.veredictoPlanilla ?? 'sin veredicto');
    if (falla) extra[k].push('planilla_no_guardada: ' + falla);
  }
});

// El mismo criterio que `¿Responder?`: con el telefono bloqueado no se envio nada.
const aEnviar = items.filter((s) => s.responder !== false);
if (aEnviar.length === 0) return [];

const envios = salidaDe('Enviar a WhatsApp');
const respaldos = salidaDe('Enviar texto de respaldo');
const salen = [];
const fallas = [];
let r = 0;
aEnviar.forEach((s, k) => {
  const envio = envios[k];
  // El mismo criterio que `¿Falló el interactivo?`: solo entonces corrio el respaldo.
  const porRespaldo = Number(envio?.statusCode) >= 400 && s.esInteractivo === true;
  const final = porRespaldo ? respaldos[r++] : envio;
  const turno = 'turno ' + (s.accion || 'agente');
  if (!acepto(final)) {
    fallas.push(porRespaldo
      ? detalle(final, s.from) + ' (respaldo en texto, ' + turno + '; antes el interactivo: ' + detalle(envio, s.from) + ')'
      : detalle(final, s.from) + ' (' + (s.esInteractivo ? 'interactivo' : 'texto') + ', ' + turno + ')');
    return;
  }
  const idMeta = idDe(final);
  if (!idMeta) return; // sin id de Meta no hay entrega que reportar
  const idx = items.indexOf(s);
  salen.push({ json: {
    from: s.from,
    phoneNumberId: s.phoneNumberId,
    esInteractivo: porRespaldo ? false : s.esInteractivo === true,
    respuesta: porRespaldo ? String(s.respuestaRespaldo ?? s.respuesta ?? '') : s.respuesta,
    porRespaldo,
    idMeta,
    avisos: [...(Array.isArray(s.avisos) ? s.avisos : []), ...extra[idx]],
  }, pairedItem: { item: idx } });
});

if (fallas.length) throw new Error('Meta rechazó el mensaje al cliente: ' + fallas.join(' | '));
return salen;
