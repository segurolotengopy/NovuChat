// INTERPRETAR LECTURA: lo que leyó el modelo en el comprobante, como DATO (envoltorio de `cbLectura`, de la base común `cobro.js`).
//
// Llega la salida de «Preparar imagen» (módulo común de medios) con la categoría `comprobante`, `publicidad` u otra. La lectura sale de la MISMA llamada a Gemini que clasificó la imagen
// («Describir imagen» o «Describir documento», una sola por archivo). Aquí solo se arma lo que necesita «Cotejar en el servidor»: `{telefono, legible, leido, idMeta, ruta, cotejar}`.
//
// QUIÉN ES QUIÉN sale SIEMPRE de «Normalizar entrada» (el teléfono y el id del mensaje), nunca del JSON del modelo. La lectura son seis campos de texto corto y `legible`; un texto dentro de la imagen
// es un dato que viaja al servidor y se compara, jamás una instrucción. ESTE NODO NO COMPARA NADA: compara el servidor (`cotejarComprobanteVenta`, regla 2) contra el monto del QR y la cuenta del comercio.
// `ruta` es la imagen guardada por «Guardar comprobante» (rama aparte): null si no corrió o el servidor respondió 409, 503 o una ruta mal formada; el cotejo corre igual.
// `cotejar` es verdadero SOLO si la imagen es un comprobante Y el servidor dice que hay un cobro REAL de este teléfono (QR pendiente, en revisión o vencido hace poco). Sin cobro no se coteja nada.
const t = cnPrimero('Normalizar entrada') || {};
const previo = ($input.first() || {}).json || {};
const from = String(t.from || '');
const esAr = ceMercadoDePrefijo(from) === 'AR';
const resp = cnPrimero('Describir documento') || cnPrimero('Describir imagen');
// Argentina lee además `alias` y `operacion` (`bmLecturaAlias`); Bolivia sigue con los seis campos de siempre (su cuerpo al servidor no cambia).
const lectura = esAr ? bmLecturaAlias(resp) : cbLectura(resp);
const ficha = CN_TENANT.fichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from), Number(t.ahoraMs) || Date.now());
// El cotejo de Argentina: el cuerpo de `cotejarAliasArs`. El teléfono es el del mensaje; el pedido, el que anotó el código en la ficha. Sin alias abierto o con un dato mal formado, no se coteja.
const cuerpoAlias = esAr && ficha.aliasEstado === 'abierto' ? bmCuerpoCotejarAlias(ficha.aliasPedidoId, from, String(t.mensajeId || ''), lectura.legible, lectura.leido) : null;
const ruta = cbRutaGuardada(cnPrimero('Guardar comprobante'));
const cobro = bmCobro(bmPanelDe(cnPrimero('Traer configuración')));
const hayCobro = cobro.modo === 'real' && (cobro.pendiente || cobro.enRevision || cobro.vencidoHaceMin !== null);
return [{ json: {
  telefono: String(t.from || ''),
  legible: lectura.legible,
  leido: lectura.leido,
  idMeta: String(t.mensajeId || ''),
  ruta: ruta,
  cotejar: previo.categoriaMedio === 'comprobante' && !!t.from && (esAr ? cuerpoAlias !== null : hayCobro),
  cuerpoAlias: esAr ? cuerpoAlias : null,
  categoriaMedio: String(previo.categoriaMedio || ''),
} }];
