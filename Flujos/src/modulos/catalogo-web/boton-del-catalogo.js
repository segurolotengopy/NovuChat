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
// Acorta `texto` a `max` caracteres por LÍNEAS enteras y NUNCA en silencio (estándar 2.2): al final dice cuántos productos (líneas con
// viñeta) quedaron fuera y remite al catálogo. Un texto que cabe vuelve igual.
function cwAcortarConRemision(texto, max) {
  var t = String(texto === undefined || texto === null ? '' : texto);
  if (t.length <= max) return t;
  var reserva = 70;
  var lineas = t.split('\n');
  var quedan = [];
  var largo = 0;
  var i = 0;
  for (; i < lineas.length; i++) {
    var suma = (quedan.length ? 1 : 0) + lineas[i].length;
    if (largo + suma > max - reserva) break;
    quedan.push(lineas[i]);
    largo += suma;
  }
  if (!quedan.length) quedan.push(cmRecorte(lineas[0], max - reserva));
  var fuera = lineas.slice(i).filter(function (l) { return /^\s*[•\-*–]/.test(l); }).length;
  var remision = fuera > 0 ? (fuera === 1 ? 'Hay 1 producto más; míralo en el catálogo.' : 'Hay ' + fuera + ' productos más; míralos en el catálogo.') : 'Hay más en el catálogo.';
  return quedan.join('\n').trimEnd() + '\n\n' + remision;
}
// El botón «Ver catálogo» como MENSAJE APARTE (cta_url), o null sin enlace https válido. Es el segundo mensaje de una LISTA interactiva
// (WhatsApp no junta una lista con un botón de enlace): +1 mensaje, aceptado por Andres el 27/11/2026 (`cwMensajesConCatalogo`).
function cwMensajeBotonCatalogo(enlace) {
  var url = cwUrlValida(enlace);
  if (!url) return null;
  var cuerpo = 'Mira todo el catálogo con fotos y precios.';
  return {
    payload: cmEnlace(cuerpo, 'Ver catálogo', url),
    texto: cuerpo,
    respaldo: cuerpo + '\n\n' + url,
    tipoReporte: 'interactive',
    conBoton: true,
    botonAparte: true,
  };
}
// Pone el catálogo en el mensaje `m` ({ payload, texto, respaldo }), SIEMPRE que haya un enlace https válido y SIN agregar mensajes
// (Andres, 27/11/2026: el botón sale siempre):
//   - texto simple: botón «Ver catálogo» (cta_url); si el cuerpo pasa de 1000 caracteres se acorta por líneas con la remisión
//     «Hay N productos más; míralos en el catálogo.» (el respaldo conserva el texto entero);
//   - mensaje de BOTONES DE RESPUESTA (WhatsApp no junta dos acciones): el enlace va como texto al final del cuerpo
//     («Ver catálogo: <url>»), con el cuerpo acortado con remisión si hace falta para caber en 1024; los botones quedan intactos;
//   - LISTA interactiva: NO se toca aquí y devuelve false: su botón va en un segundo mensaje (`cwMensajesConCatalogo`, +1 mensaje);
//   - IMAGEN con leyenda: el enlace va al final de la leyenda; cualquier otro tipo (documento…): no se toca y devuelve false.
// Devuelve si lo hizo.
function cwConBotonCatalogo(m, enlace) {
  var url = cwUrlValida(enlace);
  if (!url || !m || !m.payload || typeof m.texto !== 'string') return false;
  if (m.payload.type === 'text') {
    var cuerpo = cwAcortarConRemision(m.texto, 1000);
    m.payload = cmEnlace(cuerpo, 'Ver catálogo', url);
    m.respaldo = cwAcortarConRemision(m.texto, 4000 - url.length - 2) + '\n\n' + url;
    m.texto = cuerpo;
    m.tipoReporte = 'interactive';
    m.conBoton = true;
    return true;
  }
  var it = m.payload.type === 'interactive' ? m.payload.interactive : null;
  if (it && it.type === 'button' && it.body && typeof it.body.text === 'string') {
    if (it.body.text.indexOf(url) < 0) {
      var pie = '\n\nVer catálogo: ' + url;
      // La cuenta de «Hay N productos más» va sobre el texto COMPLETO (`m.texto`), no sobre el cuerpo que `cmBotones` ya recortó a 1024.
      // Solo se usa si EMPIEZA igual que el cuerpo (el cuerpo es su recorte, con «…» al final si se cortó): un texto distinto nunca reemplaza al cuerpo.
      var base = it.body.text.replace(/…$/, '');
      var completo = m.texto.length > it.body.text.length && m.texto.indexOf(base) === 0 ? m.texto : it.body.text;
      it.body.text = cwAcortarConRemision(completo, 1024 - pie.length) + pie;
    }
    m.texto = it.body.text;
    m.respaldo = (String(m.respaldo || '').indexOf(url) < 0 ? cwAcortarConRemision(String(m.respaldo || m.texto), 4000 - url.length - 2) + '\n\n' + url : m.respaldo);
    m.conEnlaceEnTexto = true;
    return true;
  }
  // Una imagen con leyenda: el enlace va al final de la leyenda (máx. 1024), con la remisión si hace falta.
  var im = m.payload.type === 'image' ? m.payload.image : null;
  if (im && typeof im.caption === 'string') {
    if (im.caption.indexOf(url) < 0) {
      var pieIm = '\n\nVer catálogo: ' + url;
      im.caption = cwAcortarConRemision(im.caption, 1024 - pieIm.length) + pieIm;
    }
    m.texto = im.caption;
    m.conEnlaceEnTexto = true;
    return true;
  }
  return false;
}
// Los mensajes que salen con el catálogo: SIEMPRE el botón cuando hay enlace válido (estándar 1.2).
//   texto o botones de respuesta: el MISMO mensaje (0 mensajes agregados), `[m]`;
//   lista interactiva: `[m, botón aparte]` (+1 mensaje, decisión de Andres del 27/11/2026);
//   sin enlace válido, o un tipo que no admite el enlace: `[m]` sin cambios.
function cwMensajesConCatalogo(m, enlace) {
  var it = m && m.payload && m.payload.type === 'interactive' ? m.payload.interactive : null;
  if (it && it.type === 'list') {
    var aparte = cwMensajeBotonCatalogo(enlace);
    return aparte ? [m, aparte] : [m];
  }
  cwConBotonCatalogo(m, enlace);
  return [m];
}
