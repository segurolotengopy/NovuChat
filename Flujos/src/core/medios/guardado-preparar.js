// PREPARAR GUARDADO (módulo común de medios, contrato M1↔M2 del 29/10/2026 §1 y §4): decide si el medio de ESTE mensaje entrante se guarda y cómo.
//
// Corre en su PROPIA rama, colgada de «Reportar mensaje (entrante)» (el servidor exige el entrante ya registrado por la ingesta) y DEBAJO de la rama que
// responde en el lienzo: con `executionOrder: v1` corre DESPUÉS de que el cliente recibió su respuesta, y nada de lo que pase acá corta el turno.
// Devuelve [] (la rama termina en silencio) si el mensaje no es imagen, audio o documento, o si le falta un dato que el servidor exige.
// Si devuelve un item, `modo` es:
//   - `anotar`: docx y xlsx (solo se ANOTAN, nunca se bajan bytes) y cualquier otro documento que no sea PDF (el servidor responde 415 y no se baja nada);
//   - `descargar`: imagen (hasta 5 MB), audio (hasta 16 MB) y PDF (hasta 10 MB), con SU PROPIA descarga de Meta (no gasta el tope diario de ver u oír).
// También anota, en el estado estático del flujo (clave `guardadoDeMedios`), cuándo escribió por última vez la RECEPCIÓN: es la ventana de 24 h que
// decide si el aviso de falla puede salir como texto libre. Ningún dato del cliente se guarda ahí.
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

const GM_TIPOS = { image: 'image', audio: 'audio', voice: 'audio', document: 'document' };
const gmTipo = Object.prototype.hasOwnProperty.call(GM_TIPOS, String(gmMsg.type || '')) ? GM_TIPOS[String(gmMsg.type)] : '';
if (!gmTipo) return [];
const gmMedio = gmTipo === 'audio' ? (gmMsg.audio || gmMsg.voice) : gmMsg[gmTipo];
if (!gmMedio || typeof gmMedio !== 'object') return [];
const gmMediaId = String(gmMedio.id || '');
const gmIdMeta = String(gmMsg.id || '');
// Lo que el servidor exige (§1): teléfono de 8 a 15 dígitos y el id del MENSAJE. Lo que viaja en una cabecera, sin espacios ni controles.
if (!/^\d{8,15}$/.test(gmTelefono) || !/^[\x21-\x7e]{1,200}$/.test(gmIdMeta) || !/^[A-Za-z0-9_-]{1,100}$/.test(gmMediaId)) return [];
const gmMimeCrudo = String(gmMedio.mime_type || '').toLowerCase().split(';')[0].trim();
const gmMime = /^[a-z0-9.+-]{1,40}\/[a-z0-9.+-]{1,100}$/.test(gmMimeCrudo) ? gmMimeCrudo : 'application/octet-stream';

// docx y xlsx: solo se anotan. Otro documento que no sea PDF también va por Anotar: el servidor responde 415 sin que se baje un byte.
const GM_SOLO_ANOTAR = ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
const GM_LIMITES = { image: 5000000, audio: 16000000, pdf: 10000000 };
const gmModo = gmTipo === 'document' && gmMime !== 'application/pdf' ? 'anotar' : 'descargar';
const gmLimite = gmModo === 'anotar' ? 0 : (gmTipo === 'document' ? GM_LIMITES.pdf : GM_LIMITES[gmTipo]);

return [{ json: {
  modo: gmModo,
  telefono: gmTelefono,
  idMeta: gmIdMeta,
  tipo: gmTipo,
  mime: gmMime,
  mediaId: gmMediaId,
  limite: gmLimite,
  soloAnotar: GM_SOLO_ANOTAR.indexOf(gmMime) >= 0,
  // A quién iría el aviso de falla (el número del NEGOCIO, no del cliente).
  recepcion: gmRecepcion,
  ahoraMs: gmAhora,
} }];
