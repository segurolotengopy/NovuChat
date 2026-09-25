// Normaliza el payload de WhatsApp a texto para el agente (criterio B-3).
// Descarta silenciosamente lo que no sea un mensaje de usuario.

// La configuracion se arrastra ENTERA y no campo por campo. Antes se copiaba
// una lista fija, y agregar un campo al nodo `Config del negocio` no bastaba:
// el prompt lo leia como undefined y la instruccion nunca llegaba al modelo.
// Fue exactamente lo que paso con `estiloEmojis` y `tratamiento`.
const CLAVES_DEL_WEBHOOK = ['messages', 'contacts', 'metadata', 'messaging_product',
                            'object', 'entry', 'statuses', 'errors'];

const out = [];
for (const item of $input.all()) {
  const src = item.json;
  const msg = Array.isArray(src.messages) ? src.messages[0] : undefined;
  if (!msg) continue; // acuse de estado u otro evento

  const config = {};
  for (const [clave, valor] of Object.entries(src)) {
    if (!CLAVES_DEL_WEBHOOK.includes(clave)) config[clave] = valor;
  }

  // Filtro por pais de origen. Meta cobra el mensaje segun el pais del
  // DESTINATARIO, asi que responderle a un numero extranjero cuesta su tarifa,
  // que puede ser diez veces la boliviana. Se descarta ANTES de responder: no
  // se contesta y no se gasta. Lista vacia = se acepta cualquier origen.
  const prefijos = String(config.prefijosPermitidos ?? '')
    .split(',').map(p => p.trim()).filter(Boolean);
  if (prefijos.length && !prefijos.some(p => String(msg.from ?? '').startsWith(p))) {
    continue;
  }

  // Meta manda `audio` para las notas de voz (`audio.voice: true`). `voice` se
  // acepta por si alguna version del webhook lo usa, y se REPORTA como audio:
  // si no, el contador del mes lo tiraria a «otro» y la cifra que dice por que
  // medio escribe la gente quedaria mal.
  const tipo = msg.type === 'voice' ? 'audio' : (msg.type ?? 'desconocido');

  // --- COMPROBANTE DE SEÑA (bloque 2, Analisis/07 §4) ------------------------
  // Si el panel dice que ESTE telefono tiene un QR de seña pendiente
  // (`senaPendiente`), la proxima foto o PDF es el comprobante: NO va al
  // modelo, va a la lectura y al cotejo del servidor (`¿Es un comprobante?`).
  // Sin seña pendiente una imagen es una imagen, como siempre. El id del
  // mensaje y el del medio viajan en el item: con el primero el servidor
  // referencia el cotejo, con el segundo se descarga el archivo de Meta.
  const mediaId = String(msg.image?.id || msg.document?.id || msg.audio?.id || msg.voice?.id || '');
  const mimeType = String(msg.image?.mime_type || msg.document?.mime_type
    || msg.audio?.mime_type || msg.voice?.mime_type || '');
  const esComprobante = ['image', 'document'].includes(tipo) && config.senaPendiente === 'si';

  // --- MEDIOS ENTRANTES QUE NO SON COMPROBANTE (bloque 3, Analisis/34 §3.1 y
  // §4.1) --------------------------------------------------------------------
  // Hasta hoy un audio o una foto recibian «por ahora atiendo por texto»: un
  // mensaje PAGADO que no avanza nada y que pierde al que escribio. Ahora el
  // flujo los baja, los convierte en TEXTO y recien ese texto entra al agente.
  //
  // EL AGENTE NUNCA VE EL MEDIO. No es una instruccion al modelo --«no
  // diagnostiques»-- sino la forma del cableado: el binario muere en el nodo
  // que lo lee, y al agente le llega una transcripcion o una categoria de una
  // lista cerrada. La clinica ya vio al asistente repetir afirmaciones de su
  // propio material; pedirle que se contenga no alcanza.
  //
  // Sin `mediaId` no hay nada que bajar: cae al aviso cortes de siempre.
  const esMedioAudio = ['audio', 'voice'].includes(tipo) && mediaId !== '';
  const esMedioVisual = ['image', 'document'].includes(tipo) && !esComprobante && mediaId !== '';

  let userInput = '';
  if (esComprobante) userInput = 'AVISO_SISTEMA: comprobante de seña (no va al modelo)';
  // LO QUE SE REPORTA A LA CONSOLA, y por que no es el contenido del medio.
  // `Reportar mensaje (entrante)` corre ANTES que la rama de medios (orden v1:
  // esta mas arriba en el lienzo, y asi tiene que quedar o el aviso de uso
  // extendido no sale nunca). Asi que lo que se guarda en el historial de 12
  // meses es esta marca, no lo que decia el audio ni lo que se leyo en la
  // foto. Es ademas lo correcto con datos de salud (Analisis/34 §4.1, riesgo
  // 1): una foto de dientes o una orden medica no dejan rastro escrito. Lo
  // que el paciente dijo se ve igual en la conversacion, porque el asistente
  // repite en una linea lo que entendio del audio antes de agendar.
  else if (esMedioAudio) userInput = '(audio) el cliente envió una nota de voz';
  else if (esMedioVisual) {
    userInput = tipo === 'document' ? '(documento) el cliente envió un archivo'
      : '(imagen) el cliente envió una foto';
  }
  else switch (tipo) {
    case 'text':
      userInput = msg.text?.body ?? '';
      break;
    case 'interactive': {
      const sel = msg.interactive?.list_reply ?? msg.interactive?.button_reply;
      userInput = `El cliente seleccionó la opción del menú: ${sel?.title ?? ''} (id: ${sel?.id ?? ''})`;
      break;
    }
    case 'button':
      userInput = `El cliente tocó el botón: ${msg.button?.text ?? ''}`;
      break;
    case 'image':
      userInput = 'AVISO_SISTEMA: el cliente envió una imagen. Agradécela y continúa el agendamiento.';
      break;
    // UBICACION (bloque 3). Mandar el pin es la forma en que mucha gente
    // pregunta «¿donde quedan?»: contestarle «por ahora atiendo por texto» es
    // gastar un mensaje para no responder. La direccion sale de la
    // configuracion del negocio, no del modelo. Cero mensajes agregados: es el
    // mismo turno de siempre.
    case 'location':
      userInput = String(config.direccion || '').trim()
        ? 'AVISO_SISTEMA: el cliente envió su ubicación. Agradécela, dile dónde atiende '
          + String(config.nombreNegocio || 'el negocio') + ': ' + String(config.direccion).trim()
          + ', y sigue con la consulta. No calcules distancias ni rutas.'
        : 'AVISO_SISTEMA: el cliente envió su ubicación. Agradécela y sigue con la consulta.';
      break;
    default:
      userInput = `AVISO_SISTEMA: el cliente envió un mensaje de tipo "${tipo}" que no puedes leer. ` +
        'Respóndele cortésmente que por ahora atiendes por texto.';
  }

  // --- EL ANUNCIO DE META (24/09/2026) -------------------------------------
  // Cuando alguien toca un anuncio de clic a WhatsApp, Meta manda `referral`
  // junto al primer mensaje: el titular, el texto y la fuente del anuncio. Los
  // flujos de reservas lo tiraban; el de captacion ya lo leia, y esta es la
  // misma forma. Es DATO del anuncio, no una orden: va recortado y sin saltos.
  const plano = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
  const ref = msg.referral && typeof msg.referral === 'object' ? msg.referral : null;
  const anuncio = ref ? {
    titular: plano(ref.headline, 120),
    fuente: plano(ref.source_type, 20),
    idAnuncio: plano(ref.source_id, 40),
  } : null;

  // --- LA CAMPAÑA SE RECONOCE POR SU TEXTO EXACTO (Andres, 24/09/2026) ------
  // El comercio carga en la consola el texto que su campaña de Meta deja
  // escrito en el chat, con su vigencia; el servidor lo verifica y manda SOLO
  // las campañas vigentes y aplicadas (`campanasActivas`, texto JSON). Si lo
  // que escribio la persona es ESE texto, la conversacion nace de la campaña.
  // «Exacto» es exacto en las palabras: no cuentan mayusculas, tildes, signos
  // ni emojis, que el celular cambia solo; una palabra de mas o de menos si
  // cuenta, porque entonces ya no es el texto del anuncio sino lo que la
  // persona escribio. Solo texto: un audio o un boton no son la campaña.
  // Sin campañas, o con el panel caido, no hay coincidencia: el flujo sigue
  // como siempre.
  const palabras = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  let campanas = [];
  try { campanas = JSON.parse(String(config.campanasActivas || '[]')); } catch (e) { campanas = []; }
  const escrito = tipo === 'text' ? palabras(msg.text?.body) : '';
  const laCampana = escrito === '' || !Array.isArray(campanas) ? null
    : (campanas.find((c) => c && typeof c.texto === 'string' && palabras(c.texto) === escrito) || null);
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
  // Se deriva del objeto `anuncio` de arriba (25/09/2026, al fusionar con
  // `main`): asi hay UNA sola lectura de `referral`, y un `referral` que no es
  // un objeto no cuenta como anuncio ni aca ni alla.
  //
  // Cero mensajes agregados: viaja en el reporte que ya se hacia.
  const origen = anuncio ? 'anuncio' : 'directo';

  out.push({ json: {
    ...config,
    userInput,
    tipo,
    origen,
    from: msg.from,
    nombrePerfil: contacto?.profile?.name ?? '',
    // EL ID DE LA OPCION TOCADA (24/09/2026). `Estado de la conversacion` de
    // Bellido decide con `eleccion` --«control_recien_nacido»,
    // «control_nino_sano», «vacunas_otros», «emergencia»-- y NADIE lo llenaba
    // desde el 18/09: el id solo viajaba dentro del texto de `userInput`. Los
    // botones de emergencia y vacunas funcionaban de casualidad, por las
    // palabras del titulo; el tipo de cita no se guardaba NUNCA, y el modelo lo
    // adivinaba de la memoria. Con «niño sano» y despues «recién nacido» en la
    // misma conversacion consulto la agenda como niño sano y rechazo las 12:00
    // del dia siguiente, que estaban libres (Andres, 24/09, #5647). La suite no
    // lo veia porque inyectaba `eleccion` a mano: ahora hay una prueba que
    // encadena los dos nodos reales. Vacio en todo lo que no es un interactivo.
    eleccion: tipo === 'interactive'
      ? String((msg.interactive?.list_reply ?? msg.interactive?.button_reply)?.id ?? '')
      : '',
    anuncio,
    campana,
    mensajeId: String(msg.id ?? ''),
    mediaId,
    mimeType,
    esComprobante,
    esMedioAudio,
    esMedioVisual,
    // Reloj de la ejecucion, para medir la latencia de punta a punta con
    // `ver-ejecuciones.sh`: `Mensaje a enviar` resta y deja `latenciaMs`. La
    // rama de medios agrega una descarga y una llamada al modelo, y el p90 de
    // 10 s es lo que hay que vigilar (Analisis/34 §3.1).
    recibidoEn: Date.now(),
  }});
}
return out;
