// Normaliza el payload de la Cloud API (regla "normalización de entrada" de
// CLAUDE.md) y arrastra TODO lo que puso `Config del negocio`.
// Nunca se accede a `.text.body` fuera de este nodo.
const out = [];
for (const item of $input.all()) {
  const src = item.json;

  // Config del negocio viene con includeOtherFields=true: separo lo que es
  // payload de Meta de lo que es configuración, para no listar campo por campo
  // (así, agregar una variable al Set no obliga a tocar este código).
  const cfg = { ...src };
  for (const k of ['messages', 'contacts', 'statuses', 'errors', 'metadata', 'messaging_product']) {
    delete cfg[k];
  }

  const msg = Array.isArray(src.messages) ? src.messages[0] : undefined;
  if (!msg) continue; // acuse de estado u otro evento: no debería llegar acá

  const tipo = msg.type ?? 'desconocido';
  let userInput = '';
  let esSaludo = false;

  // --- EL COMPROBANTE DE UN COBRO --------------------------------------
  //
  // EL DEFECTO QUE ESTO CIERRA (23/09/2026). Hasta hoy este nodo marcaba
  // `esComprobante = true` en TODA imagen y TODO documento: la foto de un gato
  // era un comprobante, y aguas abajo eso alcanzaba para registrar un cierre de
  // venta que nadie pago. La prueba de que alguien pago no puede ser que mando
  // una foto; tiene que ser que HABIA UN QR ESPERANDO ESA FOTO.
  //
  // Quien sabe si hay un QR esperando es el SERVIDOR, no el flujo:
  // `configuracionFlujo` devuelve `cobro.pendiente` mirando la solicitud de
  // ESTE telefono (`cobroVenta.ts`), y caduca sola a las 24 h. Aca solo se lee.
  //
  // DOS BANDERAS Y NO UNA, porque son dos preguntas distintas:
  //   `esComprobante`  -> hay que LEERLO y cotejarlo contra el QR del comercio.
  //                       Solo con cobro REAL: en la demostracion no hay cuenta
  //                       contra la que cotejar y todo daria «no cuadra».
  //   `pagoDeclarado`  -> llego un archivo habiendo un QR pendiente. Vale en los
  //                       DOS modos y es el hecho con el que se cierra la venta
  //                       en la demostracion, en lugar de una palabra que el
  //                       modelo haya escrito.
  const ARCHIVO = ['image', 'document'];
  // El id y el mime de una nota de voz tambien viajan (28/09/2026): los usa la
  // rama de medios. `pagoDeclarado` y `esComprobante` siguen exigiendo imagen o
  // documento, asi que un audio nunca es un comprobante.
  const mediaId = String(msg.image?.id || msg.document?.id || msg.audio?.id || msg.voice?.id || '');
  const mimeType = String(msg.image?.mime_type || msg.document?.mime_type
    || msg.audio?.mime_type || msg.voice?.mime_type || '');
  const hayQrPendiente = String(cfg.cobroPendiente || '') === 'si';
  const pagoDeclarado = ARCHIVO.includes(tipo) && hayQrPendiente;
  const esComprobante = pagoDeclarado
    && String(cfg.cobroRealActivo || '') === 'si'
    // Sin `mediaId` no hay nada que bajar: cae al camino de siempre.
    && mediaId !== '';

  // --- MEDIOS ENTRANTES QUE NO SON DEL COBRO (28/09/2026) -------------------
  // Audio, imagen y documento son capacidades de TODOS los flujos (Andres,
  // 25/09). La misma semantica que `Flujos/src/comun/normalizar-entrada.js`:
  // un medio con id que NO es del cobro se baja, se convierte en TEXTO y recien
  // ese texto entra al agente (`¿Trae un medio?`). El agente nunca ve el medio.
  //
  // QUE ES «DEL COBRO» EN ESTE FLUJO, y por eso no entra a la rama:
  //   - `esComprobante`: cobro REAL con QR pendiente -> lectura y cotejo.
  //   - `hayQrPendiente` en cualquier modo: el archivo es el pago declarado y
  //     con el se cierra la venta en la demostracion (`¿Hay comprobante?`).
  //   - cobro SIMULADO CON QR pendiente: el archivo es el comprobante del pago
  //     simulado (Andres, 23/09 y 25/09).
  // SIN QR PENDIENTE, EN LOS DOS MODOS, un archivo es un archivo (Andres,
  // 28/09/2026): en simulado, una foto sin ningun pedido respondia «Pago
  // verificado (SIMULADO)» con un pedido inventado (ejecucion #7454). Ahora va a
  // la rama: se lee el texto y se pregunta de que se trata. Con un pedido en
  // curso (QR pendiente) la demostracion queda igual que antes.
  // Queda para la rama: sin QR pendiente, con id del medio. Y todo audio con
  // id, en los dos modos: un audio nunca fue un comprobante.
  const esMedioAudio = ['audio', 'voice'].includes(tipo) && mediaId !== '';
  const esMedioVisual = ARCHIVO.includes(tipo) && mediaId !== '' && !hayQrPendiente;
  // Lo que el cliente escribio junto al archivo. `Preparar imagen` reemplaza
  // `userInput` por su texto fijo, asi que la leyenda viaja aparte y el turno
  // del agente la agrega: sin esto, «¿tienen este en talla 40?» se perdia.
  const leyendaDelMedio = esMedioVisual
    ? String(msg[tipo]?.caption ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 300)
    : '';

  // QUE LE LLEGA AL MODELO CUANDO EL ARCHIVO SI PASA POR EL. Con cobro REAL el
  // comprobante se desvia antes del agente y esto no se usa (salvo que Meta no
  // mande el id del medio, y entonces el turno cae aca); y sin QR pendiente, un
  // archivo es un archivo y no se lo trata como un pago: la exigencia del
  // pendiente es del modo REAL, donde el comprobante se coteja de verdad.
  //
  // CON COBRO SIMULADO Y QR PENDIENTE EL ARCHIVO PASA (Andres, 23/09/2026;
  // corregido el 25/09; desde el 28/09, solo CON QR pendiente: sin el, ni con id
  // ni sin id se toma por pago, ejecucion #7454). El port del cobro le habia pegado la exigencia del pendiente a los
  // dos modos, y en la demostracion --donde la gracia es que la conversacion
  // fluya y el QR es de mentira-- una foto sin QR pendiente le hacia decir al
  // asistente «no hay ningun pago pendiente». Aca el agente sigue siendo quien
  // confirma, con el rotulo de siempre; el CIERRE de la venta sigue naciendo
  // solo del hecho (`pagoDeclarado`: archivo CON QR pendiente segun el
  // servidor, en `¿Hay comprobante?`), asi que sin QR no se cuenta nada.
  const textoDelArchivo = (que) => (String(cfg.cobroRealActivo || '') !== 'si' && !hayQrPendiente
    ? ('El cliente envió ' + (que === 'IMAGEN' ? 'una IMAGEN' : 'un DOCUMENTO')
       + ' que no se pudo abrir. Pregúntale de qué se trata. No supongas que es un comprobante de pago.')
    : String(cfg.cobroRealActivo || '') !== 'si'
    ? ('El cliente envió ' + (que === 'IMAGEN' ? 'una IMAGEN' : 'un DOCUMENTO')
       + '. En esta demostración se asume que es el comprobante del pago SIMULADO del QR.')
    : (!hayQrPendiente
      ? ('El cliente envió ' + (que === 'IMAGEN' ? 'una IMAGEN' : 'un DOCUMENTO')
         + ' y no hay ningún pago pendiente: no lo trates como un comprobante. Agradécele, '
         + 'dile que no puedes abrirlo y pregúntale qué necesita.')
      : ('AVISO_SISTEMA: llegó ' + (que === 'IMAGEN' ? 'una IMAGEN' : 'un DOCUMENTO')
         + ' con un pago pendiente, pero no se pudo leer. Pídele que lo reenvíe, más '
         + 'nítido o como PDF, y NO des el pago por recibido.')));

  switch (tipo) {
    case 'text': {
      userInput = msg.text?.body ?? '';
      esSaludo = /^(hola|ola|buen(a|o)s?( d[ií]as| tardes| noches)?|hey|holi|qu[eé] tal)[\s!¡.,?¿]*$/i
        .test(userInput.trim());
      break;
    }
    case 'interactive': {
      // Ya no se mandan listas tocables -- se quitaron el 2026-09-07 por
      // decision de Andres: solo texto -- pero una seleccion puede llegar igual
      // si el cliente toca una lista vieja que sigue en su chat. Se trata como
      // lo que es: el cliente diciendo el nombre de algo.
      const sel = msg.interactive?.list_reply ?? msg.interactive?.button_reply;
      userInput = 'El cliente seleccionó: ' + (sel?.title ?? '') +
        '. Tomalo como si te lo hubiera escrito.';
      break;
    }
    case 'button': {
      userInput = 'El cliente pulsó el botón: ' + (msg.button?.text ?? '');
      break;
    }
    case 'order': {
      const items = (msg.order?.product_items ?? [])
        .map(p => '- ' + p.quantity + ' x ' + p.product_retailer_id +
                  ' (precio unitario: ' + p.item_price + ' ' + p.currency + ')')
        .join('\n');
      const nota = msg.order?.text ? '\nNota del cliente: ' + msg.order.text : '';
      userInput = 'El cliente envió un CARRITO de compras con estos ítems:\n' +
        (items || '(carrito vacío)') + nota +
        '\nRevisa si faltan variantes o notas especiales según tus reglas.';
      break;
    }
    // Con la rama de medios, `userInput` es solo la MARCA que se reporta a la
    // consola (`Reportar mensaje (entrante)` corre antes que la rama): lo que
    // el agente lee lo escriben `Preparar transcripción` y `Preparar imagen`.
    case 'image': {
      if (esMedioVisual) { userInput = '(imagen) el cliente envió una foto'; break; }
      const cap = msg.image?.caption ? ' Escribió junto a la imagen: "' + msg.image.caption + '".' : '';
      userInput = textoDelArchivo('IMAGEN') + cap;
      break;
    }
    case 'document': {
      if (esMedioVisual) { userInput = '(documento) el cliente envió un archivo'; break; }
      userInput = textoDelArchivo('DOCUMENTO');
      break;
    }
    case 'audio':
    case 'voice': {
      if (esMedioAudio) { userInput = '(audio) el cliente envió una nota de voz'; break; }
      // Sin id del medio no hay nada que bajar: el aviso de siempre.
      userInput = 'AVISO_SISTEMA: el cliente envió una NOTA DE VOZ que no se pudo abrir. ' +
        'Pídele con amabilidad que te lo escriba por texto.';
      break;
    }
    case 'location': {
      const loc = msg.location ?? {};
      userInput = 'El cliente compartió su UBICACIÓN' +
        (loc.address ? ' (' + loc.address + ')' : '') +
        '. Úsala como dirección de entrega y confírmasela por escrito.';
      break;
    }
    case 'sticker':
    case 'video':
    case 'contacts':
    default: {
      userInput = 'AVISO_SISTEMA: el cliente envió un mensaje de tipo "' + tipo +
        '" que no puedes leer. Respóndele cortésmente que por ahora atiendes por texto ' +
        'y retomá la venta donde quedó.';
    }
  }

  // --- LA CAMPAÑA POR TEXTO (Andres, 02/10/2026, D4) -------------------------
  // Misma deteccion que `core/normalizar-entrada.js` (reservas): el servidor manda
  // en `campanasActivas` (texto JSON) solo las campañas vigentes y aplicadas, y si
  // lo escrito es EXACTO su texto en palabras (sin mayusculas, tildes ni signos)
  // la conversacion nace de la campaña. Solo texto. AQUI SOLO SE DETECTA: viaja
  // en `campana` y el turno del agente agrega UNA linea de contexto. No salta
  // ningun menu, no manda ningun mensaje y no toca el candado de agenda. Sin
  // campañas, o con el panel caido, no hay coincidencia y nada cambia.
  const palabras = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  let campanas = [];
  try { campanas = JSON.parse(String(cfg.campanasActivas || '[]')); } catch (e) { campanas = []; }
  const escrito = tipo === 'text' ? palabras(msg.text?.body) : '';
  const laCampana = escrito === '' || !Array.isArray(campanas) ? null
    : (campanas.find((c) => c && typeof c.texto === 'string' && palabras(c.texto) === escrito) || null);
  const plano = (t, max) => String(t ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
  const campana = laCampana ? { id: plano(laCampana.id, 60), texto: plano(laCampana.texto, 300) } : null;

  const contacto = Array.isArray(src.contacts) ? src.contacts[0] : undefined;

    // DE DONDE NACIO LA CONVERSACION (Analisis/38 §2, Analisis/39). Si el cliente
  // escribio desde un anuncio de clic a WhatsApp, Meta manda `referral` EN EL
  // PRIMER MENSAJE y solo en ese. Esa conversacion abre la ventana de punto de
  // entrada gratuito: 72 h en las que la empresa no paga ningun mensaje y no
  // gasta franquicia. Con que fraccion del trafico entra asi se decide el
  // margen de un contrato, y hasta ahora no se medía.
  //
  // Aca solo se dice SI vino de un anuncio, no cual: el titular y la URL no
  // hacen falta para la cifra y no tienen por que viajar al servidor. Los
  // mensajes siguientes mandan `directo` y el servidor NO los deja pisar el
  // origen de la ventana, que se escribe al abrirla (`ingesta.ts`).
  //
  // Cero mensajes agregados: viaja en el reporte que ya se hacia.
  const origen = msg.referral ? 'anuncio' : 'directo';

  out.push({ json: Object.assign({}, cfg, {
    userInput,
    tipo,
    origen,
    campana,
    esSaludo,
    esComprobante,
    pagoDeclarado,
    mediaId,
    mimeType,
    esMedioAudio,
    esMedioVisual,
    leyendaDelMedio,
    from: msg.from,
    mensajeId: msg.id ?? '',
    nombrePerfil: contacto?.profile?.name ?? '',
  })});
}
return out;
