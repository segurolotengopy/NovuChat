// RESULTADO DEL GUARDADO (módulo común de medios, contrato M1↔M2 del 29/10/2026 §2 y §4): lee la respuesta de `guardarMedio` y decide el AVISO DE FALLA.
//
// Toda respuesta del §2 termina acá y NINGUNA corta el turno (el cliente ya recibió su respuesta: esta rama corre después).
//   200 {ruta, repetido} · 200 {anotado:true, repetido} · 400 · 401 · 405 · 409 (guardado_apagado, sin_mensaje, en_curso, {estado}) → silencio (devuelve []).
//   400 anotar_con_cuerpo es un DEFECTO DEL FLUJO (en modo Anotar nunca se manda cuerpo): sin aviso a la recepción, se REGISTRA en el estado estático
//   (`guardadoDeMedios.anotarConCuerpo = {dia, n}`, sin datos del paciente) para que se vea al revisar el flujo.
//   413 demasiado_grande · 415 tipo_no_admitido · 429 cupo_diario_lleno · 502 no_se_guardo|no_se_registro (o cualquier 5xx), YA REINTENTADO una vez →
//   aviso a la recepción, si se puede. Un 200 {ruta, repetido:true} en modo Anotar (el medio ya estaba guardado) también es éxito.
//   Un medio que Meta informó más grande que el límite NO se baja: cuenta como 413 sin llamar al servidor.
//   Un corte de red, un error de Meta o una respuesta que no se entiende → silencio (no hay motivo cierto que decirle a la recepción).
// EL AVISO: texto libre a la recepción del negocio SOLO si su ventana de 24 h está abierta (escribió hace menos de 23 h 30 min: lo anota «Preparar guardado»),
// a lo más UNO por día de La Paz (UTC-4 fijo) y por comercio (el estado estático es del flujo, que es de un solo comercio), y SIN datos del paciente:
// ni teléfono, ni nombre, ni el archivo, ni el id del mensaje. Solo el motivo. El día se marca ANTES de enviar: si Meta lo rechaza, ese día no se reintenta.
// Si Meta rechaza el aviso, la ejecución termina en ERROR (el envío no traga el fallo); la rama corre al final, cuando el cliente ya recibió su respuesta.
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
if (grCodigo === 400 && grCuerpo.error === 'anotar_con_cuerpo') {
  const grPrevio = grEstado.anotarConCuerpo && grEstado.anotarConCuerpo.dia === grHoy ? Number(grEstado.anotarConCuerpo.n) || 0 : 0;
  grEstado.anotarConCuerpo = { dia: grHoy, n: Math.min(grPrevio + 1, 1000) };
  return [];
}
const GR_MOTIVOS = {
  413: 'el archivo supera el tamaño permitido',
  415: 'el tipo de archivo no se admite',
  429: 'se llenó el cupo diario de archivos del comercio',
  502: 'el servidor no pudo guardarlo',
};
// Un 5xx llega acá DESPUÉS del único reintento («Reintentar el guardado»): si sigue fallando, es «el servidor no pudo guardarlo».
let grMotivo = Object.prototype.hasOwnProperty.call(GR_MOTIVOS, grCodigo) ? GR_MOTIVOS[grCodigo] : (grCodigo >= 500 && grCodigo <= 599 ? GR_MOTIVOS[502] : '');
// El medio que no se bajó por tamaño (Meta lo informó por encima del límite): es un 413 aunque el servidor no lo haya visto.
const grTamano = Number(grUrl.file_size);
if (!grMotivo && grPrep.modo === 'descargar' && Number(grPrep.limite) > 0 && grTamano > Number(grPrep.limite)) grMotivo = GR_MOTIVOS[413];
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
