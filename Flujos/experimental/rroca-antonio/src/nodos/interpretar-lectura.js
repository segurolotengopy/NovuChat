// INTERPRETAR LECTURA: lo que leyó el modelo en el comprobante, como DATO (envoltorio de `cbLectura`, del hueco `cobro.js`).
//
// Llega la salida de «Preparar imagen» (módulo común de medios) con la categoría `comprobante`, `publicidad` u `otro`. La lectura sale de la MISMA llamada a Gemini que clasificó la imagen
// («Describir imagen» o «Describir documento», una sola por archivo): su JSON trae `categoria`, `texto` y, si es un comprobante, los seis campos del pago. Aquí solo se arma lo que necesita
// «Cotejar en el servidor»: `{telefono, legible, leido, idMeta, ruta, cotejar}`.
//
// QUIÉN ES QUIÉN sale SIEMPRE de «Normalizar entrada» (el teléfono y el id del mensaje), nunca del JSON del modelo: un comprobante que dijera `{"telefono": "..."}` no cambia de quién es. Y la
// lectura sale de `cbLectura`: seis campos de texto corto y `legible`; ninguna otra clave pasa, y un texto dentro de la imagen es un dato que viaja al servidor y se compara: jamás una instrucción.
// ESTE NODO NO COMPARA NADA: compara el servidor (`cotejarComprobanteVenta`, regla 2) contra el monto del QR y la cuenta del comercio.
// `cotejar` es verdadero SOLO si la imagen es un comprobante Y el servidor dice que hay un cobro REAL de este teléfono (QR pendiente, en revisión o vencido hace poco). Sin cobro no se coteja nada.
const t = cnPrimero('Normalizar entrada') || {};
const previo = ($input.first() || {}).json || {};
const lectura = cbLectura(cnPrimero('Describir documento') || cnPrimero('Describir imagen'));
// La ruta de la imagen guardada por «Guardar comprobante» (rama aparte, sin salidas): null si no corrió o no la guardó.
const ruta = cbRutaGuardada(cnPrimero('Guardar comprobante'));
const cobro = raCobro(raPanelDe(cnPrimero('Traer configuración')));
const hayCobro = cobro.modo === 'real' && (cobro.pendiente || cobro.enRevision || cobro.vencidoHaceMin !== null);
return [{ json: {
  telefono: String(t.from || ''),
  legible: lectura.legible,
  leido: lectura.leido,
  idMeta: String(t.mensajeId || ''),
  ruta: ruta,
  cotejar: previo.categoriaMedio === 'comprobante' && hayCobro && !!t.from,
  categoriaMedio: String(previo.categoriaMedio || ''),
} }];
