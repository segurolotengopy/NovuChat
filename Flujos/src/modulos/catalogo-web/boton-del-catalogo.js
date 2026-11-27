// =============================================================================
// ENLACE Y BOTON DEL CATALOGO WEB (prefijo `cw`): el enlace sale de un dato https validado, el boton va en el MISMO mensaje
// =============================================================================
// Se pega DETRAS de `Flujos/src/core/sin-agente/mensajes.js` (cmEnlace). Sin `require`, `URL`, `Buffer` ni `crypto`: la
// forma de la URL se valida con una expresion regular sobre la URL entera. No conoce a ningun cliente y NUNCA lleva una URL
// fija: el enlace viene del dato del comercio (`catalogoWeb` del panel: { activo, enlace }).
//
// Un boton «Ver catalogo» en el mismo mensaje de texto del turno cuesta 0 mensajes extra (Base comercial, §1).

var CW_RE_ENLACE = /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?::\d{1,5})?(?:[/?#][^\s]*)?$/;
// Una URL https utilizable como enlace de boton, o ''.
function cwUrlValida(v) {
  if (typeof v !== 'string') return '';
  var e = v.trim();
  return e.length <= 500 && CW_RE_ENLACE.test(e) ? e : '';
}
// El enlace del catalogo web del comercio: `panel.cuerpo.catalogoWeb` con `activo === true` y un `enlace` https. Sin eso, ''.
function cwEnlaceCatalogo(panel) {
  var c = panel && panel.ok && panel.cuerpo && typeof panel.cuerpo === 'object' ? panel.cuerpo.catalogoWeb : null;
  var w = c && typeof c === 'object' && !Array.isArray(c) ? c : null;
  return w && w.activo === true ? cwUrlValida(w.enlace) : '';
}
// Convierte el mensaje `m` ({ payload, texto, respaldo }) en un boton con el catalogo, en el mismo mensaje. Solo si es un
// texto simple que cabe en el cuerpo del boton y hay enlace valido; devuelve si lo hizo.
function cwConBotonCatalogo(m, enlace) {
  var url = cwUrlValida(enlace);
  if (!url || !m || !m.payload || m.payload.type !== 'text' || typeof m.texto !== 'string' || m.texto.length > 1000) return false;
  m.payload = cmEnlace(m.texto, 'Ver catálogo', url);
  m.respaldo = m.texto + '\n\n' + url;
  m.tipoReporte = 'interactive';
  m.conBoton = true;
  return true;
}
