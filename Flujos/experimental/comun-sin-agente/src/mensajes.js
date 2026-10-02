// =============================================================================
// MENSAJES (prefijo `cm`): los constructores de lo que sale por WhatsApp, en JavaScript plano
// =============================================================================
// Se pega DELANTE del código de un nodo Code (el construir.mjs de esta carpeta lo hace con la marca
// `@@comun+mensajes:…` o `@@solo+mensajes:…`): el nodo Code de n8n no tiene módulos. Es AUTOSUFICIENTE: no
// usa ninguna función `cn*` ni ningún nodo, no lee la configuración y no llama a la red, así que sirve igual en
// cualquier flujo. Sin `require`, `URL`, `Buffer` ni `crypto` (el Code de n8n no los tiene).
//
// Sacado de `agenda-minima/src/nodos/armar-mensajes.js`, que sigue con sus copias. Los límites son los de la
// Cloud API de Meta: texto 4096, cuerpo interactivo 1024, botón 20, tres botones, fila de lista 24 y su
// descripción 72, diez filas, id de botón o de fila 200.
//
// El PAYLOAD que sale de aquí lleva `to: ''` a propósito: el destinatario lo pone un solo nodo, el último
// (en modo prueba, TODO va al teléfono de prueba), y no cada constructor.
//
// Un ITEM de salida es `{ para, payload, texto, respaldo, ...extra }`:
//   para     quién lo recibe, en palabras del flujo («cliente», «recepcion»…);
//   payload  el cuerpo de la Cloud API;
//   texto    lo que se reporta a la consola (nunca el contenido de un medio);
//   respaldo texto plano que se manda SI Meta rechaza el interactivo (nunca se pierde un mensaje).

function cmRecorte(t, max) {
  const s = String(t === undefined || t === null ? '' : t);
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}
function cmBase(tipo) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: '', type: tipo };
}
function cmTexto(cuerpo) {
  return Object.assign(cmBase('text'), { text: { preview_url: true, body: cmRecorte(cuerpo, 4000) } });
}
function cmBotones(cuerpo, botones) {
  return Object.assign(cmBase('interactive'), { interactive: {
    type: 'button', body: { text: cmRecorte(cuerpo, 1024) },
    action: { buttons: (botones || []).slice(0, 3).map((b) => ({ type: 'reply', reply: { id: cmRecorte(b.id, 200), title: cmRecorte(b.title, 20) } })) },
  } });
}
function cmLista(cuerpo, boton, titulo, filas) {
  return Object.assign(cmBase('interactive'), { interactive: {
    type: 'list', body: { text: cmRecorte(cuerpo, 1024) },
    action: { button: cmRecorte(boton, 20), sections: [{ title: cmRecorte(titulo, 24), rows: (filas || []).slice(0, 10).map((f) => ({
      id: cmRecorte(f.id, 200), title: cmRecorte(f.title, 24), description: cmRecorte(f.description || '', 72) })) }] },
  } });
}
function cmEnlace(cuerpo, texto, url) {
  return Object.assign(cmBase('interactive'), { interactive: {
    type: 'cta_url', body: { text: cmRecorte(cuerpo, 1024) },
    action: { name: 'cta_url', parameters: { display_text: cmRecorte(texto, 20), url: String(url) } },
  } });
}
// El enlace que abre un chat de WhatsApp con un número (solo dígitos) y un saludo ya escrito.
function cmUrlWa(numero, saludo) {
  return 'https://wa.me/' + String(numero).replace(/\D/g, '') + '?text=' + encodeURIComponent(String(saludo || ''));
}
function cmMensaje(para, payload, texto, respaldo, extra) {
  return Object.assign({ para: para, payload: payload, texto: texto, respaldo: respaldo || texto }, extra || {});
}
// Un texto que nombra «el botón» cuando no hay botón queda mal: se le quitan esas frases.
function cmSinMencionDelBoton(cuerpo, porDefecto) {
  const s = String(cuerpo || '').replace(/\s*T[oó]ca(le)? el bot[oó]n[^.!?]*[.!?]?/gi, '')
    .replace(/\s*tocando el bot[oó]n/gi, '').replace(/\s+([.,])/g, '$1').trim();
  return s || String(porDefecto || '');
}
// PASAR CON UNA PERSONA: el mensaje con el botón que abre su chat, o solo texto si no hay a quién mandarlo.
//   op = { numero, desde, cuerpo, botonTexto, saludo, para?, evento?, textoDelRespaldo?, sinNumero? }
// Hay botón solo si `numero` existe y NO es el de quien escribe (`desde`): un botón a su propio chat no sirve.
// Devuelve el item, con `tipoReporte` ('interactive' o 'text') y `conBoton`.
function cmContactoConBoton(op) {
  const numero = String(op.numero || '').replace(/\D/g, '');
  const desde = String(op.desde || '').replace(/\D/g, '');
  const para = op.para || 'cliente';
  if (numero && numero !== desde) {
    const url = cmUrlWa(numero, op.saludo || '');
    return cmMensaje(para, cmEnlace(op.cuerpo, op.botonTexto || 'Escribir', url), op.cuerpo,
      op.cuerpo + '\n\n' + (op.textoDelRespaldo || 'Escríbele aquí:') + ' ' + url,
      { tipoReporte: 'interactive', evento: op.evento, conBoton: true });
  }
  const sinBoton = cmSinMencionDelBoton(op.cuerpo, op.sinNumero || 'Eso lo coordina una persona del equipo.');
  return cmMensaje(para, cmTexto(sinBoton), sinBoton, sinBoton, { tipoReporte: 'text', evento: op.evento, conBoton: false });
}
