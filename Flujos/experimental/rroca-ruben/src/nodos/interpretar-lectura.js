// INTERPRETAR LECTURA: lo que leyó el modelo en el comprobante, como DATO (envoltorio de `cbLectura`, del hueco `cobro.js`).
//
// Llega la salida de «Preparar imagen» (módulo común de medios: valida la categoría, sanea la descripción y reconoce el anuncio por su titular). La LECTURA del pago sale de la MISMA llamada a Gemini que clasificó el archivo («Leer comprobante (PDF)»,
// «Leer comprobante (imagen)» o «Ver imagen», la que corrió): su JSON trae `categoria`, `descripcion` y, si es un comprobante, los seis campos del pago. Sale lo que necesita «Cotejar en el servidor»: `{telefono, legible, leido, idMeta, ruta}`.
// QUIÉN ES QUIÉN sale SIEMPRE de «Interpretar entrada» (el teléfono, el id del mensaje), nunca del JSON del modelo: un comprobante que dijera `{"telefono": "..."}` no cambia de quién es.
// La lectura sale de `cbLectura`: seis campos de texto corto y `legible`; ninguna otra clave pasa, y un texto dentro de la imagen es un dato que viaja al servidor y se compara: jamás una
// instrucción, ni llega al cliente como texto libre. ESTE NODO NO COMPARA NADA: compara el servidor (`cotejarComprobanteVenta`, regla 2) contra el monto del QR y la cuenta del comercio.
const entradas = cnTodos('Interpretar entrada');
const items = $input.all();
// La respuesta cruda del lector que corrió (los tres comparten prompt); nunca más de uno por turno.
const cruda = cnNodo('Leer comprobante (PDF)') ? cnPrimero('Leer comprobante (PDF)') : (cnNodo('Leer comprobante (imagen)') ? cnPrimero('Leer comprobante (imagen)') : cnPrimero('Ver imagen'));
// La ruta de la imagen guardada por «Guardar comprobante» (rama aparte, sin salidas): null si no corrió o no la guardó.
const ruta = cbRutaGuardada(cnPrimero('Guardar comprobante'));
const salida = [];
for (let i = 0; i < items.length; i++) {
  const t = entradas[i] || entradas[entradas.length - 1];
  // Sin el mensaje de origen no hay a quién atribuirle el comprobante: no se coteja nada.
  if (!t || !t.from) continue;
  const lectura = cbLectura(cruda);
  // La categoría decide si se coteja: SIN un cobro real que cotejar (`t.esComprobante` falso) nunca se coteja; `pago_con_problema` tampoco (aunque se haya leído una cuenta) y avisa a Rubén; un anuncio, una foto o una captura sin cuenta
  // leída desvían el turno SIN cotejar (`¿Lo leído es comprobante?`). Ante la duda (Gemini caído, sin categoría) se coteja, como siempre.
  const clasif = rrClasificaLector(items[i].json, lectura, t.esComprobante === true);
  salida.push({ json: { telefono: String(t.from), legible: lectura.legible, leido: lectura.leido, idMeta: String(t.mensajeId || ''), ruta: ruta, noEsComprobante: clasif.noEsComprobante, pagoConProblema: clasif.pagoConProblema }, pairedItem: { item: i } });
}
return salida;
