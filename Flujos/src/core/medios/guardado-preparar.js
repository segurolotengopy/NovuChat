// PREPARAR GUARDADO (módulo común de medios, contrato v2 «guardar y descargar TODO» del 30/10/2026 §1 y §4): decide si el medio de ESTE mensaje
// entrante se guarda y con qué cabeceras.
//
// Corre en su PROPIA rama, colgada de «Reportar mensaje (entrante)» (el servidor exige el entrante ya registrado por la ingesta) y DEBAJO de la rama que
// responde en el lienzo: con `executionOrder: v1` corre DESPUÉS de que el cliente recibió su respuesta, y nada de lo que pase acá corta el turno.
// Devuelve [] (la rama termina en silencio) si el mensaje no trae un medio, o si le falta un dato que el servidor exige.
// TODO medio se guarda (decisión de Andres, 30/10): imagen, audio (y nota de voz), video, documento de CUALQUIER tipo y sticker (va como `image`, webp).
// Ya no hay modo Anotar. Cada uno se baja con SU PROPIA descarga de Meta (no gasta el tope diario de ver u oír). El flujo NO se adelanta al tope por tipo
// del servidor (imagen 5 MB, audio, video y documento 16 MB): solo deja de bajar lo que Meta informa por encima de 16 MiB (`limite`), que cuenta como 413.
// `contentType` es el mime que declara Meta SOLO si está en la lista cerrada de abajo; si no, `application/octet-stream` (el servidor decide por los bytes).
// También anota, en el estado estático del flujo (clave `guardadoDeMedios`), cuándo escribió por última vez la RECEPCIÓN: es la ventana de 24 h que
// decide si el aviso de falla puede salir como texto libre. Ningún dato del cliente se guarda ahí.
// Este nodo NO toca el binario: no lo hay todavía (se baja después) y nunca lo lee.
//
// `GM_FUENTES` la define la cabecera que arma `guardado.mjs` para cada flujo (`carga`: el nodo con `messages`; `config`: «Config del negocio»).
// JavaScript plano del nodo Code de n8n: sin require, URL, Buffer ni crypto.
const gmCarga = (GM_FUENTES && GM_FUENTES.carga && typeof GM_FUENTES.carga === 'object') ? GM_FUENTES.carga : {};
const gmCfg = (GM_FUENTES && GM_FUENTES.config && typeof GM_FUENTES.config === 'object') ? GM_FUENTES.config : {};
const gmMsg = Array.isArray(gmCarga.messages) && gmCarga.messages[0] && typeof gmCarga.messages[0] === 'object' ? gmCarga.messages[0] : null;
const gmAhora = Number(gmCarga.ahoraMs) > 0 ? Number(gmCarga.ahoraMs) : Date.now();
const gmSd = $getWorkflowStaticData('global');
if (!gmSd.guardadoDeMedios || typeof gmSd.guardadoDeMedios !== 'object' || Array.isArray(gmSd.guardadoDeMedios)) gmSd.guardadoDeMedios = {};
const gmEstado = gmSd.guardadoDeMedios;
if (!gmMsg) return [];

const gmTelefono = String(gmMsg.from || '');
const gmRecepcion = String(gmCfg.numeroRecepcionDigitos || gmCfg.numeroRecepcion || '').replace(/\D/g, '');
// La ventana de la recepción: su último mensaje a este número (de cualquier tipo).
if (gmRecepcion && gmTelefono === gmRecepcion) gmEstado.recepcionMs = gmAhora;

// El tipo del mensaje de WhatsApp → la categoría que se manda en `X-NovuChat-Tipo` (contrato v2 §1: image | audio | video | document).
const GM_TIPOS = { image: 'image', sticker: 'image', audio: 'audio', voice: 'audio', video: 'video', document: 'document' };
const gmTipoMeta = String(gmMsg.type || '');
const gmTipo = Object.prototype.hasOwnProperty.call(GM_TIPOS, gmTipoMeta) ? GM_TIPOS[gmTipoMeta] : '';
if (!gmTipo) return [];
const gmMedio = gmMsg[gmTipoMeta] || (gmTipo === 'audio' ? (gmMsg.audio || gmMsg.voice) : null);
if (!gmMedio || typeof gmMedio !== 'object') return [];
const gmMediaId = String(gmMedio.id || '');
const gmIdMeta = String(gmMsg.id || '');
// Lo que el servidor exige (§1): teléfono de 8 a 15 dígitos y el id del MENSAJE. Lo que viaja en una cabecera, sin espacios ni controles.
if (!/^\d{8,15}$/.test(gmTelefono) || !/^[\x21-\x7e]{1,200}$/.test(gmIdMeta) || !/^[A-Za-z0-9_-]{1,100}$/.test(gmMediaId)) return [];
const gmMimeCrudo = String(gmMedio.mime_type || '').toLowerCase().split(';')[0].trim();
// La lista CERRADA de mimes que viajan tal cual en `Content-Type`; cualquier otro (o uno de otra categoría) va como application/octet-stream.
const GM_MIMES = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  audio: ['audio/ogg', 'audio/opus', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/mpeg', 'audio/aac', 'audio/amr'],
  video: ['video/mp4', 'video/3gpp'],
  document: [
    'application/pdf', 'application/zip', 'text/plain', 'text/csv',
    'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
};
const gmContentType = GM_MIMES[gmTipo].indexOf(gmMimeCrudo) >= 0 ? gmMimeCrudo : 'application/octet-stream';
// 16 MiB: lo más grande que el flujo baja (Meta permite documentos de 100 MB; manda el tope de Andres). El tope por tipo lo impone el servidor.
const GM_LIMITE = 16 * 1024 * 1024;

return [{ json: {
  telefono: gmTelefono,
  idMeta: gmIdMeta,
  tipo: gmTipo,
  contentType: gmContentType,
  mediaId: gmMediaId,
  limite: GM_LIMITE,
  // A quién iría el aviso de falla (el número del NEGOCIO, no del cliente).
  recepcion: gmRecepcion,
  ahoraMs: gmAhora,
} }];
