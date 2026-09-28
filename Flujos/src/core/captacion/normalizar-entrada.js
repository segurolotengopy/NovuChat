// Normaliza el payload de la Cloud API (regla "normalizacion de entrada" de
// CLAUDE.md) y arrastra lo que puso `Config del negocio`. Nunca se accede a
// `.text.body` fuera de este nodo.
//
// LO PROPIO DE ESTE FLUJO:
//  - `eleccion`: `asesor` si el cliente toco «Hablar con un asesor» -- el boton
//    de respuesta que sale con los planes, al fin del primer bloque y cuando
//    pide soporte -- o lo ESCRIBIO: quien contesta «quiero hablar con un
//    asesor» no tiene que tocar el boton. Y si Meta rechazo el interactivo, el
//    texto de respaldo le pide justamente que lo escriba.
//  - `pideSoporte`: dice que ya es cliente o pide ayuda con su cuenta. Desde el
//    27/09/2026 no hay botones de bienvenida ni rama propia para eso: responde
//    el agente, sin pedirle datos de prospecto, y el mensaje sale con el boton
//    «Hablar con un asesor» (lo decide `Procesar respuesta`, por codigo).
//  - `anuncio`: si el mensaje viene de un anuncio de clic a WhatsApp, Meta manda
//    `referral`. Sirve para que el asistente sepa por que escribe la persona, y
//    para medir la ventana de punto de entrada gratuito (CLAUDE.md §6).
//  - Una imagen o un documento NO se asumen como comprobante: este flujo no
//    cobra.
//  - MEDIOS ENTRANTES (28/09/2026): audio, imagen y documento son capacidades
//    de TODOS los flujos (Andres, 25/09). La misma semantica que
//    `Flujos/src/comun/normalizar-entrada.js`: con id del medio, `esMedioAudio`
//    o `esMedioVisual`, y la rama `¿Trae un medio?` lo convierte en TEXTO
//    antes de `Estado de la conversación`. `userInput` queda como la MARCA que
//    se reporta a la consola; lo que lee el agente lo escriben `Preparar
//    transcripción` y `Preparar imagen`. Sin id no hay nada que bajar: se pide
//    que lo escriba, como antes.
// Sin el nombre del negocio adentro: el flujo es generico.
const SOPORTE = /\b(ya\s+soy\s+cliente|soy\s+cliente(?!\s+nuev)|ya\s+(tengo|uso|contrat[eé])\s+(el\s+|su\s+|mi\s+|tu\s+|la\s+)?(asistente|servicio|cuenta|consola|plan)|mi\s+consola|entrar\s+a\s+(la\s+|mi\s+)?(consola|cuenta)|no\s+puedo\s+(entrar|ingresar)|soporte(\s+t[eé]cnico)?|recuperar\s+(mi\s+|la\s+)?contrase[nñ]a|olvid[eé]\s+(mi\s+|la\s+)?contrase[nñ]a)\b/i;
// El mensaje ENTERO es el pedido: «asesor», «quiero hablar con un asesor».
// Una pregunta que solo menciona al asesor («¿el asesor me llama?») sigue al
// asistente.
const ASESOR = /^\s*(quiero\s+|me\s+gustar[ií]a\s+|deseo\s+|prefiero\s+)?(hablar\s+con\s+)?(un\s+|una\s+|el\s+|la\s+)?(asesor|asesora|especialista)(\s+por\s+favor)?[\s.!¡]*$/i;

const out = [];
const items = $input.all();
for (let i = 0; i < items.length; i++) {
  const src = items[i].json;

  // Config viene mezclada con el payload de Meta: se separa sin listar campo
  // por campo. `conocimiento` se descarta: son 16 mil caracteres que el agente
  // lee directo de su nodo, y no tienen por que viajar en cada item.
  const cfg = { ...src };
  for (const k of ['messages', 'contacts', 'statuses', 'errors', 'metadata',
                   'messaging_product', 'conocimiento']) {
    delete cfg[k];
  }

  const msg = Array.isArray(src.messages) ? src.messages[0] : undefined;
  if (!msg) continue; // acuse de estado u otro evento: no deberia llegar aca

  const tipo = msg.type ?? 'desconocido';
  const mediaId = String(msg.image?.id || msg.document?.id || msg.audio?.id || msg.voice?.id || '');
  const mimeType = String(msg.image?.mime_type || msg.document?.mime_type
    || msg.audio?.mime_type || msg.voice?.mime_type || '');
  const esMedioAudio = ['audio', 'voice'].includes(tipo) && mediaId !== '';
  const esMedioVisual = ['image', 'document'].includes(tipo) && mediaId !== '';
  // Lo que escribio junto al archivo: `Preparar imagen` reemplaza `userInput`,
  // asi que la leyenda viaja aparte y `Estado de la conversación` la agrega.
  const leyendaDelMedio = esMedioVisual
    ? String(msg[tipo]?.caption ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 300)
    : '';
  let userInput = '';
  let eleccion = '';
  let pideSoporte = false;

  switch (tipo) {
    case 'text': {
      userInput = msg.text?.body ?? '';
      if (ASESOR.test(userInput)) eleccion = 'asesor';
      else if (SOPORTE.test(userInput)) pideSoporte = true;
      break;
    }
    case 'interactive': {
      const r = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
      const id = String(r?.id ?? '');
      const titulo = String(r?.title ?? '');
      if (id === 'asesor') eleccion = 'asesor';
      // Un boton de un mensaje viejo se toma por su texto, como si lo hubiera
      // escrito: «Soy cliente…» sigue siendo un pedido de soporte.
      else if (SOPORTE.test(titulo)) pideSoporte = true;
      userInput = id === 'asesor' ? 'Quiero hablar con un asesor.'
        : 'El cliente toco: ' + titulo + '. Tomalo como si te lo hubiera escrito.';
      break;
    }
    case 'button': {
      userInput = 'El cliente pulso el boton: ' + (msg.button?.text ?? '');
      break;
    }
    case 'image':
    case 'document':
    case 'video': {
      if (esMedioVisual) {
        userInput = tipo === 'document' ? '(documento) el cliente envio un archivo' : '(imagen) el cliente envio una foto';
        break;
      }
      const cap = msg[tipo]?.caption ? ' Escribio junto al archivo: "' + msg[tipo].caption + '".' : '';
      userInput = 'AVISO_SISTEMA: el cliente envio un archivo (' + tipo + ') que no puedes ver.' + cap +
        ' Pidele con amabilidad que te escriba en texto lo que necesita.';
      break;
    }
    case 'audio':
    case 'voice': {
      if (esMedioAudio) { userInput = '(audio) el cliente envio una nota de voz'; break; }
      userInput = 'AVISO_SISTEMA: el cliente envio una NOTA DE VOZ que no se pudo abrir. ' +
        'Pidele con amabilidad que te lo escriba.';
      break;
    }
    case 'location': {
      const loc = msg.location ?? {};
      userInput = 'AVISO_SISTEMA: el cliente compartio una ubicacion' +
        (loc.address ? ' (' + loc.address + ')' : '') +
        '. Si es la de su negocio, agradecela y sigue la conversacion.';
      break;
    }
    case 'sticker':
    case 'contacts':
    default: {
      userInput = 'AVISO_SISTEMA: el cliente envio un mensaje de tipo "' + tipo +
        '" que no puedes leer. Respondele con cortesia que por ahora atiendes por texto.';
    }
  }

  const ref = msg.referral;
  const anuncio = ref ? {
    titular: String(ref.headline ?? '').slice(0, 120),
    fuente: String(ref.source_type ?? ''),
    url: String(ref.source_url ?? '').slice(0, 200),
  } : null;

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
  const origen = anuncio ? 'anuncio' : 'directo';

  out.push({ json: Object.assign({}, cfg, {
    userInput,
    tipo,
    eleccion,
    pideSoporte,
    anuncio,
    origen,
    mediaId,
    mimeType,
    esMedioAudio,
    esMedioVisual,
    leyendaDelMedio,
    from: msg.from,
    mensajeId: msg.id ?? '',
    nombrePerfil: contacto?.profile?.name ?? '',
  }), pairedItem: { item: i } });
}
return out;
