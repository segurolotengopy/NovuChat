// NORMALIZAR ENTRADA (contrato con los módulos comunes de medios).
//
// «Interpretar entrada» ya lee el mensaje y lo deja listo para este flujo. Los módulos comunes de medios
// (`Flujos/src/core/medios/`, que se INCLUYEN sin copiarse) buscan `$('Normalizar entrada')` y leen estos campos:
// `esMedioAudio`, `esMedioVisual`, `esDocumento` y `mimeType`. Este nodo solo los agrega a lo que ya entrega
// «Interpretar entrada»; no cambia ningún otro campo ni decide nada.
const salida = [];
for (const it of $input.all()) {
  const j = it.json || {};
  const hayMedio = String(j.mediaId || '') !== '';
  salida.push({ json: Object.assign({}, j, {
    esMedioAudio: j.tipo === 'audio' && hayMedio,
    esMedioVisual: (j.tipo === 'image' || j.tipo === 'document') && hayMedio,
    esDocumento: j.tipo === 'document',
    mimeType: '',
  }), pairedItem: it.pairedItem });
}
return salida;
