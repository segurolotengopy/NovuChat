// PREPARAR REINTENTO (módulo común de medios, contrato M1↔M2 del 29/10/2026, revisión del integrador): `guardarMedio` respondió un 5xx (502 no_se_guardo,
// no_se_registro u otro): se reintenta UNA vez, con el mismo pedido. El servidor reconoce el repetido por el id del mensaje.
// Arma el ítem del reintento: los datos de «Preparar guardado» y, si el medio se bajó, el MISMO binario `data` de «Descargar medio (guardado)» (no se vuelve a
// pedir a Meta). En modo Anotar no lleva binario: el reintento va sin cuerpo. Un medio a la vez: un solo ítem.
// JavaScript plano del nodo Code de n8n: sin require, ni los globales de Node.
const rpPrep = $('Preparar guardado').first().json || {};
const rpItem = { json: Object.assign({}, rpPrep, { intento: 2 }) };
if (rpPrep.modo === 'descargar' && $('Descargar medio (guardado)').isExecuted) {
  const rpBajado = $('Descargar medio (guardado)').first();
  if (rpBajado && rpBajado.binary && rpBajado.binary.data) rpItem.binary = { data: rpBajado.binary.data };
}
return [rpItem];
