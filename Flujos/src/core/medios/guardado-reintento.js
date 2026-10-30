// PREPARAR REINTENTO (módulo común de medios, contrato v2 del 30/10/2026): `guardarMedio` respondió un 5xx (502 no_se_guardo, no_se_registro u otro):
// se reintenta UNA vez, con el mismo pedido. El servidor reconoce el repetido por el id del mensaje.
// Arma el ítem del reintento: los datos de «Preparar guardado» y la REFERENCIA al mismo binario `data` de «Descargar medio (guardado)» (no se vuelve a
// pedir a Meta). NO LEE el binario: copia el objeto que n8n le da (su id en el almacén de binarios) sin abrir su contenido. Un medio a la vez: un ítem.
// JavaScript plano del nodo Code de n8n: sin require, ni los globales de Node.
const rpPrep = $('Preparar guardado').first().json || {};
const rpItem = { json: Object.assign({}, rpPrep, { intento: 2 }) };
if ($('Descargar medio (guardado)').isExecuted) {
  const rpBajado = $('Descargar medio (guardado)').first();
  if (rpBajado && rpBajado.binary && rpBajado.binary.data) rpItem.binary = { data: rpBajado.binary.data };
}
return [rpItem];
