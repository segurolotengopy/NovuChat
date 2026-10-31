// RESULTADO DEL GUARDADO (módulo común de medios, contrato v2 «guardar y descargar TODO» del 30/10/2026 y §2 del contrato del 29/10): lee la respuesta
// de `guardarMedio` y decide el AVISO DE FALLA.
//
// Toda respuesta termina acá y NINGUNA corta el turno (el cliente ya recibió su respuesta: esta rama corre después).
//   200 {ruta, repetido} · 400 · 401 · 405 · 409 (guardado_apagado, sin_mensaje, en_curso, {estado}) → silencio (devuelve []).
//   Registrados en el estado estático, sin aviso y sin datos del paciente (`guardadoDeMedios.<clave> = {dia, n}`): 401 (token rotado o número equivocado)
//   → `sinAcceso`; un 400 (telefono_invalido, falta_idmeta, tipo_invalido, vacio) → `pedidoInvalido`; una descarga de Meta que falló (sin respuesta del
//   servidor, tamaño dentro del límite) → `sinDescarga`.
//   413 demasiado_grande · 415 tipo_no_admitido · 429 cupo_diario_lleno | cupo_telefono_lleno · 502 no_se_guardo|no_se_registro (o cualquier 5xx), YA
//   REINTENTADO una vez → aviso a la recepción, si se puede.
//   Un medio que Meta informó más grande que 16 MiB NO se baja: cuenta como 413 sin llamar al servidor.
//   Un video o documento sin tamaño informado por Meta (ausente o 0) tampoco se baja: se registra en `sinTamano` y avisa como falla de tamaño.
//   Un corte de red, un error de Meta o una respuesta que no se entiende → silencio (no hay motivo cierto que decirle a la recepción).
// EL AVISO: texto libre a la recepción del negocio SOLO si su ventana de 24 h está abierta (escribió hace menos de 23 h 30 min: lo anota «Preparar guardado»),
// a lo más UNO por ejecución y día de La Paz (UTC-4 fijo) y por comercio (el estado estático es del flujo, que es de un solo comercio): con ejecuciones
// CONCURRENTES (un álbum de 3 fotos son 3 ejecuciones que leen el estado a la vez) pueden salir varios el mismo día. n8n no da un candado real; queda
// acotado porque el aviso no lleva datos del paciente y solo sale con la ventana de la recepción abierta. Y SIN datos del paciente:
// ni teléfono, ni nombre, ni el archivo, ni el id del mensaje. Solo el motivo. El día se marca ANTES de enviar: si Meta lo rechaza, ese día no se reintenta.
// Si Meta rechaza el aviso, la ejecución termina en ERROR (el envío no traga el fallo); la rama corre al final, cuando el cliente ya recibió su respuesta.
// Este nodo NO toca el binario.
// JavaScript plano del nodo Code de n8n: sin require, URL, Buffer ni crypto.
const grPrep = $('Preparar guardado').first().json || {};
const grUrl = $('Pedir el medio a Meta (guardado)').isExecuted ? ($('Pedir el medio a Meta (guardado)').first().json || {}) : {};
const grR = ($input.first() && $input.first().json) || {};
const grCodigo = Number(grR.statusCode) || 0;
const grCuerpo = grR.body && typeof grR.body === 'object' ? grR.body : {};
const grSd = $getWorkflowStaticData('global');
if (!grSd.guardadoDeMedios || typeof grSd.guardadoDeMedios !== 'object' || Array.isArray(grSd.guardadoDeMedios)) grSd.guardadoDeMedios = {};
const grEstado = grSd.guardadoDeMedios;
const grAhora = Number(grPrep.ahoraMs) > 0 ? Number(grPrep.ahoraMs) : Date.now();
const grHoy = new Date(grAhora - 4 * 3600 * 1000).toISOString().slice(0, 10);
const grRegistrar = (clave) => {
  const previo = grEstado[clave] && grEstado[clave].dia === grHoy ? Number(grEstado[clave].n) || 0 : 0;
  grEstado[clave] = { dia: grHoy, n: Math.min(previo + 1, 1000) };
};
if (grCodigo === 400) { grRegistrar('pedidoInvalido'); return []; }
if (grCodigo === 401) { grRegistrar('sinAcceso'); return []; }
const GR_MOTIVOS = {
  413: 'el archivo supera el tamaño permitido',
  415: 'el tipo de archivo no se admite',
  429: 'se llenó el cupo diario de archivos del comercio',
  '429t': 'se llenó el cupo diario de archivos de una conversación',
  '413s': 'no se pudo comprobar su tamaño',
  502: 'el servidor no pudo guardarlo',
};
// Un 5xx llega acá DESPUÉS del único reintento («Reintentar el guardado»): si sigue fallando, es «el servidor no pudo guardarlo».
let grMotivo = Object.prototype.hasOwnProperty.call(GR_MOTIVOS, grCodigo) ? GR_MOTIVOS[grCodigo] : (grCodigo >= 500 && grCodigo <= 599 ? GR_MOTIVOS[502] : '');
// El cupo por teléfono (100 medios o 500 MiB por día, contrato v2 §7.4) tiene su propio motivo; sigue sin decir CUÁL conversación.
if (grCodigo === 429 && grCuerpo.error === 'cupo_telefono_lleno') grMotivo = GR_MOTIVOS['429t'];
// El medio que no se bajó por tamaño (Meta lo informó por encima de 16 MiB): es un 413 aunque el servidor no lo haya visto.
const grTamano = Number(grUrl.file_size);
if (!grMotivo && grCodigo === 0 && Number(grPrep.limite) > 0 && grTamano > Number(grPrep.limite)) grMotivo = GR_MOTIVOS[413];
// Video o documento sin tamaño informado (Meta sí respondió con su URL): no se bajó a propósito; se registra y avisa como falla de tamaño.
if (!grMotivo && grCodigo === 0 && grPrep.exigeTamano === true && grUrl.url && !(grTamano > 0)) { grRegistrar('sinTamano'); grMotivo = GR_MOTIVOS['413s']; }
// Sin respuesta del servidor (Meta no dio la URL o no dejó bajar el archivo): no se sabe más, se registra sin aviso.
if (!grMotivo && grCodigo === 0) { grRegistrar('sinDescarga'); return []; }
if (!grMotivo) return [];

const GR_VENTANA_MS = 23 * 3600 * 1000 + 30 * 60 * 1000;
const grRecepcionMs = Number(grEstado.recepcionMs) || 0;
const grVentanaAbierta = grRecepcionMs > 0 && grAhora >= grRecepcionMs && grAhora - grRecepcionMs < GR_VENTANA_MS;
if (grEstado.avisoDia === grHoy || !grVentanaAbierta) return [];
const grRecepcion = String(grPrep.recepcion || '').replace(/\D/g, '');
if (!/^\d{6,20}$/.test(grRecepcion)) return [];
grEstado.avisoDia = grHoy;
return [{ json: {
  numeroRecepcion: grRecepcion,
  texto: 'No se pudo guardar un archivo de una conversación (' + grMotivo + '). Revísala en la Consola.',
} }];
