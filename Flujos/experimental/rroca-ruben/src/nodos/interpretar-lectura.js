// INTERPRETAR LECTURA: lo que leyó el modelo en el comprobante, como DATO (envoltorio de `cbLectura`, del hueco `cobro.js`).
//
// Llega la salida del nodo de Gemini («Leer comprobante (imagen)» o «(PDF)») y sale lo que necesita «Cotejar en el servidor»: `{telefono, legible, leido, idMeta, ruta}`.
// QUIÉN ES QUIÉN sale SIEMPRE de «Interpretar entrada» (el teléfono, el id del mensaje), nunca del JSON del modelo: un comprobante que dijera `{"telefono": "..."}` no cambia de quién es.
// La lectura sale de `cbLectura`: seis campos de texto corto y `legible`; ninguna otra clave pasa, y un texto dentro de la imagen es un dato que viaja al servidor y se compara: jamás una
// instrucción, ni llega al cliente como texto libre. ESTE NODO NO COMPARA NADA: compara el servidor (`cotejarComprobanteVenta`, regla 2) contra el monto del QR y la cuenta del comercio.
const entradas = cnTodos('Interpretar entrada');
const items = $input.all();
// La ruta de la imagen guardada por «Guardar comprobante» (rama aparte, sin salidas): null si no corrió o no la guardó.
const ruta = cbRutaGuardada(cnPrimero('Guardar comprobante'));
const salida = [];
for (let i = 0; i < items.length; i++) {
  const t = entradas[i] || entradas[entradas.length - 1];
  // Sin el mensaje de origen no hay a quién atribuirle el comprobante: no se coteja nada.
  if (!t || !t.from) continue;
  const lectura = cbLectura(items[i].json);
  salida.push({ json: { telefono: String(t.from), legible: lectura.legible, leido: lectura.leido, idMeta: String(t.mensajeId || ''), ruta: ruta }, pairedItem: { item: i } });
}
return salida;
