// Separa la marca [TRANSFERIR] de la respuesta al cliente (criterio C-11).
const entradas = $('Normalizar entrada').all();
const cfg = $('Config del negocio').first().json;
const cierre = String(cfg.mensajeCierre ?? '').trim()
  || 'Gracias por escribirnos. Si necesita algo mas, escribame por aca.';
const falla = String(cfg.mensajeErrorTemporal ?? '').trim()
  || 'Disculpe, tuve un problema tecnico momentaneo. Me repite lo ultimo?';

// `isExecuted` es de toda la ejecucion, no del item: se lee una sola vez, y
// protegido, porque si la referencia fallara la verificacion tiene que
// seguir abierta por las otras dos vias.
let herramientaAgendarCorrio = false;
try { herramientaAgendarCorrio = $('agendar_cita').isExecuted === true; }
catch (e) { herramientaAgendarCorrio = false; }

const items = $input.all();
const out = [];
for (let i = 0; i < items.length; i++) {
  // Emparejamiento por indice: nunca .first(), que le pondria el telefono del
  // primer cliente a la respuesta del segundo cuando llegan dos a la vez.
  const ent = (entradas[i] ?? entradas[entradas.length - 1]).json;
  const dato = items[i].json;

  // Gemini devuelve 500/503 en picos y entonces no llega `output`. Hay que
  // distinguirlo de una respuesta vacia: despedirse cuando en realidad se cayo
  // el modelo deja al cliente creyendo que la conversacion termino.
  const fallo = dato.error !== undefined || dato.output === undefined;
  const texto = String(dato.output ?? '').trim();
  // LA TRANSFERENCIA PUEDE VENIR FORZADA, y entonces no se le pide al modelo:
  // un pago de seña que llego DESPUES de que el horario se liberara tiene plata
  // de por medio y alguien esperando, asi que pasa a una persona si o si
  // (`Preparar imagen`, 19/09/2026). Un [TRANSFERIR] del modelo suma, no resta.
  const transferir = texto.includes('[TRANSFERIR]') || ent.forzarTransferencia === true;
  // UBICACION (Analisis/34 §2). La marca [ENVIAR_UBICACION] la escribe el
  // modelo SOLO cuando el cliente pidio expresamente el pin. Se quita del
  // texto siempre; el `location` nativo se manda solo si el comercio cargo
  // las coordenadas: sin ellas el texto ya lleva la direccion y el enlace, y
  // no hay nada mas que mandar. Cuesta un mensaje mas, solo en ese caso.
  const pideUbicacion = /\[ENVIAR_UBICACION\]/i.test(texto);
  // CONTACTO DE RECEPCION (19/09/2026). El modelo escribe la marca cuando el
  // cliente pide el numero o quiere hablar con una persona. El numero NO se
  // escribe en el texto: viaja en un boton que abre el chat de recepcion, asi
  // no hay que copiarlo a mano ni se equivoca un digito.
  const pideContacto = /\[CONTACTO_RECEPCION\]/i.test(texto);
  // REENVIAR EL QR (2026-09-20): el cliente dice que no le llegó y lo pide.
  const pideQr = /\[REENVIAR_QR\]/i.test(texto);
  let respuesta = texto.split('[TRANSFERIR]').join('')
    .replace(/\[ENVIAR_UBICACION\]/gi, '')
    .replace(/\[CONTACTO_RECEPCION\]/gi, '')
    .replace(/\[REENVIAR_QR\]/gi, '')
    // Cualquier otra marca en corchetes que el modelo invente, para que el
    // cliente nunca la vea (mismo criterio que el Demo B).
    .replace(/\[[A-ZÁÉÍÓÚÑ_ ]{3,30}\]/g, '')
    .trim();

  // El nodo de WhatsApp rechaza un cuerpo vacio con 400 Bad request. Pero una
  // respuesta vacia NO significa que la conversacion termino: el 2026-08-30 el
  // modelo devolvio cadena vacia en plena reserva y el cierre cortes hizo creer
  // al cliente que estaba todo listo, cuando no se habia agendado nada.
  // La despedida se detecta en lo que ESCRIBIO EL CLIENTE, no se deduce de que
  // el modelo no haya contestado. Ante la duda, un error recuperable -- que
  // invita a repetir -- es mucho mejor que un cierre, que corta.
  const DESPEDIDA = /^\s*(muchas\s+)?(gracias|grax|chau|chao|adios|adiós|listo|ok|oka|dale|perfecto|hasta\s+luego|nos\s+vemos|buenas\s+noches)\b[\s.!¡👍🙏😊]*$/i;
  const seDespide = DESPEDIDA.test(String(items[i].json.userInput ?? ''));

  // --- EL MONTO DE LA SEÑA NO LO ESCRIBE EL MODELO (2026-09-20) --------------
  // El prompt le inyecta el importe exacto y aun asi escribio «la seña de 50
  // Bs» con la seña en 1: confundio el precio del tratamiento con la seña. Una
  // clienta lo leyo. El prompt no es una barrera (CLAUDE.md), y esto es plata,
  // asi que se corrige aca: SOLO el importe que aparece pegado a la palabra
  // «seña» y dentro de la misma oracion. El precio del tratamiento —«cuesta
  // 500 Bs»— no se toca: esta en otra oracion y no lleva esa palabra al lado.
  const importeSena = String(cfg.senaImporte || '').trim();
  if (cfg.senaActiva === 'si' && importeSena !== '') {
    const moneda = String(cfg.senaMoneda || 'Bs').trim() || 'Bs';
    const correcto = importeSena + ' ' + moneda;
    respuesta = respuesta
      // El punto final va aparte: la version anterior se tragaba el de «50 Bs.»
      // --el grupo capturaba «Bs.» entero y lo reemplazaba sin el-- y la oracion
      // salia sin terminar (2026-09-20).
      .replace(/(se[ñn]a[^.!?\n]{0,40}?de\s+)(\d[\d.,]*)\s*(Bs\b\.?|bolivianos\b|BOB\b)/gi,
        (m, antes, n, unidad) => antes + correcto + (unidad.endsWith('.') ? '.' : ''))
      .replace(/(\d[\d.,]*)(\s*(?:Bs\b\.?|bolivianos\b|BOB\b))(\s+de\s+se[ñn]a)/gi,
        (m, n, mon, despues) => correcto + despues);
  }

  const vacia = respuesta === '';
  if (fallo) respuesta = falla;
  else if (vacia) respuesta = seDespide ? cierre : falla;

  // NEGRITA DE WHATSAPP, POR CONSTRUCCION (2026-09-17). El prompt pide UN
  // asterisco y el modelo sigue escribiendo **texto**, que WhatsApp muestra
  // con los asteriscos a la vista. Se corrige aca, determinista, en vez de
  // pedirselo otra vez al modelo: ***x*** -> *_x_* (negrita cursiva) y
  // **x** -> *x*. Un asterisco solo (vinetas, «2 * 3») no se toca. La MISMA
  // linea vive en `Procesar reintento` y en `Mensaje a enviar`, que es la
  // salida unica al cliente; una prueba exige que las tres sean identicas.
  const NEGRITA_MD = (t) => String(t).replace(/\*\*\*([^*\n]+?)\*\*\*/g, '*_$1_*').replace(/\*\*([^*\n]+?)\*\*/g, '*$1*');
  respuesta = NEGRITA_MD(respuesta);

  // --- PROHIBICION 3 CON DINERO REAL (seña por QR, bloque 2) ------------------
  // Con la seña activa el asistente maneja un cobro REAL: el QR es el del
  // comercio y el dinero va a su cuenta. CLAUDE.md, prohibicion 3: NUNCA
  // «pago acreditado», «pago verificado» ni «recibimos tu pago». El prompt lo
  // dice, pero un prompt no es una barrera (ya se rompio al cambiar de
  // modelo): si el modelo lo afirma igual, la ORACION se reemplaza por lo
  // unico cierto --el comprobante lo revisa el negocio, y el negocio confirma
  // el pago-- y queda anotado en `avisos`. Mismo regex que la red del cobro
  // simulado del Demo B; se juzga sin marcas de formato.
  const avisos = [];
  const AFIRMA_COBRO = /((pago|cobro|transferencia|dep[oó]sito|abono)\s+(\S+\s+){0,3}(verificad|confirmad|recibid|acreditad|procesad|aprobad|realizad|efectuad|exitos)|ya\s+(recibimos|se\s+acredit|te\s+cobr|se\s+cobr)|(pago|cobro)\s+(\S+\s+){0,2}(real|de\s+verdad))/i;
  if (cfg.senaActiva === 'si' && AFIRMA_COBRO.test(respuesta.replace(/[*_~]/g, ''))) {
    const quienRevisa = String(cfg.nombreNegocio || '').trim() || 'el negocio';
    const CORRECCION = `El comprobante lo revisa ${quienRevisa} y ellos confirman el pago.`;
    respuesta = respuesta.split('\n').map((linea) => linea.split(/(?<=[.!?…])\s+/)
      .map((o) => (AFIRMA_COBRO.test(o.replace(/[*_~]/g, '')) ? CORRECCION : o)).join(' ')).join('\n').trim();
    avisos.push('correccion_cobro');
  }

  // Marca si la respuesta AFIRMA que la cita quedo agendada. Se decide aca y
  // no en una expresion del nodo IF para poder probarlo: la trampa es que
  // "ya tiene reservada su cita" no es una confirmacion nueva sino un aviso
  // de que el horario esta ocupado, y disparar la compuerta ahi romperia una
  // conversacion correcta. Probado contra las frases reales del agente.
  // Solo cuentan las formas de HECHO CONSUMADO. "agendamos" y "reservamos"
  // salieron de la lista: en espanol son a la vez presente y pasado, y el
  // agente las usa para OFRECER ("con gusto agendamos tu cita"). El
  // 2026-08-29 esa ambiguedad disparo la compuerta en plena conversacion y le
  // dijo al cliente que no se pudo registrar una cita que nadie habia pedido.
  // EL DETECTOR NO PUEDE DEPENDER DE UNA REDACCION. La version anterior exigia
// un verbo antes del participio --«quedó confirmada»-- y el 6 de septiembre el
// modelo escribio «✅ Cita confirmada para corte con José», sin verbo. No
// coincidio, la compuerta de verificacion NI SIQUIERA CORRIO, y el cliente
// recibio una confirmacion de una cita que no existia: la credencial de Google
// habia perdido el acceso y `agendar_cita` fallo.
//
// Lo que lo desencadeno fue cambiar de modelo: Flash-Lite redacta distinto, y
// el detector estaba afinado a las frases del modelo anterior. Un detector
// atado a como escribe un modelo se rompe cada vez que se cambia de modelo.
// Por eso ahora tambien reconoce la forma sin verbo, y hay una NEGACION
// explicita para que «No pude confirmar tu cita» no dispare la compuerta.
//
// 2026-09-17, ejecucion #2936: «He reprogramado tu cita» no coincidia con
// nada de esto y una cita quedo encima de otra sin verificar. Se agregan
// reprogram-, reagend-, mov-, «te anote/anotamos» y «cambie tu cita». PERO
// ESTE DETECTOR YA NO ES LA PRIMERA DEFENSA: la verificacion se dispara por
// lo que el modelo HIZO (ver mas abajo, `ejecutoAgendar`); el regex queda
// como red adicional, y se juzga sobre el texto SIN marcas de formato.
const CONFIRMA = /(ha sido|han sido|queda|quedó|quedo|fue|está|esta|ya está|ya esta)\s+(agendad|reservad|registrad|confirmad|reprogramad|reagendad|movid|cambiad|anotad)|\b(he|hemos)\s+(agendado|reservado|registrado|confirmado|reprogramado|reagendado|movido|anotado)\b|(agendé|reservé|registré|reprogramé|reagendé|moví)(?![a-záéíóúñ])|\b(te|le|les|los|las)\s+anot(é|amos)(?![a-záéíóúñ])|\b(cambié|cambiamos|moví|movimos)\s+(tu|su|la)\s+cita\b|\b(cita|reserva|turno)\b[^.!?]{0,40}?\b(agendad|reservad|registrad|confirmad|reprogramad|reagendad|movid|cambiad)[oa]s?\b/i;
const NIEGA = /\bno\s+(pude|se pudo|pudimos|quedó|quedo|está|esta)\b/i;
  const YA_EXISTE = /\bya\s+(tiene|tienes|cuenta con|hay)/i;
  // Sin marcas de formato: «quedó *agendada*» cuenta igual que «quedó agendada».
  const plano = respuesta.replace(/[*_~]/g, '');
  const afirmaAgendo = CONFIRMA.test(plano) && !YA_EXISTE.test(plano) && !NIEGA.test(plano);

  // Coordenadas del pin, de la configuracion (consola o respaldo). Viajan
  // como texto porque Config base es un Set de textos; aca se vuelven numero
  // y se comprueba el rango. Con una sola, o con basura, no se manda nada.
  const coordenada = (v, max) => {
    const t = String(v ?? '').trim();
    const n = Number(t);
    return t !== '' && Number.isFinite(n) && Math.abs(n) <= max ? n : null;
  };
  const lat = coordenada(cfg.ubicacionLat, 90);
  const lng = coordenada(cfg.ubicacionLng, 180);
  // Si el modelo escribio SOLO la marca, la respuesta queda vacia y sale el
  // texto de error: ahi tampoco va el pin. Nunca un pin sin la direccion en el texto.
  // Y SOLO SI EL CLIENTE PREGUNTO POR LA UBICACION (2026-09-20). El modelo puso
  // la marca en una CONFIRMACION de cita, sin que nadie la pidiera: un mensaje
  // pagado de mas en cada reserva. La marca sigue siendo del modelo, pero acá
  // se comprueba contra lo que el cliente ESCRIBIO. Si no preguntó, no sale.
  const PREGUNTA_UBICACION = /\bd[oó]nde\b|ubicaci[oó]n|direcci[oó]n|c[oó]mo llego|c[oó]mo se llega|\bmapa\b|\bpin\b|googlemaps|google maps|queda(n|s)?\b/i;
  const preguntoPorLaUbicacion = PREGUNTA_UBICACION.test(String(ent.userInput || ''));
  const enviarUbicacion = pideUbicacion && preguntoPorLaUbicacion && !vacia && lat !== null && lng !== null;
  // El boton solo sale si hay numero cargado; si no, el texto del modelo ya
  // dice que lo atiende una persona y no se manda nada de mas.
  const numeroRecepcion = String(cfg.numeroRecepcion ?? '').replace(/\D/g, '');
  // Y SOLO SI EL CLIENTE LO PIDIO (2026-09-20). El modelo mandaba el boton por
  // su cuenta: salio mientras confirmaba una reserva, y otra vez para
  // deshacerse de una pregunta que no supo resolver. Es un mensaje pagado de
  // mas y, peor, empuja al paciente a otro canal sin que lo haya pedido. Si el
  // asistente necesita que intervenga una persona, para eso esta [TRANSFERIR],
  // que avisa a recepcion y no le cuesta un mensaje al cliente.
  const PIDE_CONTACTO = /n[uú]mero|tel[eé]fono|celular|whats?app\s+de|hablar con (alguien|una persona|un humano|recepci[oó]n)|comunic|contacto|me pas(as|es|a)|atienda alguien|una persona/i;
  const pidioContacto = PIDE_CONTACTO.test(String(ent.userInput || ''));
  const enviarContacto = pideContacto && pidioContacto && !vacia && numeroRecepcion !== '';
  // Se reenvía SOLO si hay una seña pendiente de verdad y un QR que mandar: el
  // servidor lo dice, no el modelo. Sin eso, el texto ya explica qué pasa.
  const reenviarQr = pideQr && !vacia
    && String(cfg.senaPendiente || '') === 'si' && String(cfg.senaQrUrl || '') !== '';
  // SI PIDIO EL QR Y NO HAY NINGUNA SEÑA PENDIENTE, el modelo acaba de decir
  // que se lo reenvia y no hay nada que reenviar: lo resuelve una persona. No
  // se le pide al modelo que lo decida, porque ya se equivoco una vez
  // inventando que «el sistema de pagos no esta disponible» (20/09/2026).
  const qrSinSena = pideQr && !vacia && !reenviarQr;

  // --- LO QUE EL MODELO HIZO, no lo que dijo (2026-09-17, ejecucion #2936) --
  // La paciente insistio («¿A las 10 no tienes?»), consultar_disponibilidad
  // le devolvio una cita de 10:00 a 11:00 y el modelo llamo a agendar_cita a
  // las 10:00 igual, con la regla de intervalos recien publicada en el
  // prompt. Y escribio «He reprogramado tu cita», que CONFIRMA no cubria: la
  // compuerta no corrio y la cita quedo encima de otra. Dos lecciones: el
  // prompt no es una barrera, y el candado no puede depender de un verbo.
  // Desde aca la verificacion se dispara si la herramienta SE EJECUTO, por
  // dos vias que no dependen de la redaccion:
  //   1. `intermediateSteps` de la salida del agente (opcion «Return
  //      Intermediate Steps» del nodo): cada herramienta invocada, con sus
  //      argumentos y lo que devolvio. Es por item, y trae el `id` del
  //      evento que agendar_cita creo; `Comprobar reserva` lo usa para
  //      anclar el candado a ESA cita y no solo a «lo creado hace 5 min».
  //   2. `$('agendar_cita').isExecuted`: n8n lo responde con la presencia
  //      del nodo en los datos de la ejecucion, y una herramienta invocada
  //      queda ahi (en la #2936 `agendar_cita` figura con su salida bajo
  //      `ai_tool`; en la #2933, que no agendo, no figura). Lo que NO sirve
  //      es `$('agendar_cita').all()`: lee la salida `main`, y una
  //      herramienta solo tiene `ai_tool`.
  // El regex queda como tercera red. Cualquiera de las tres abre la
  // verificacion (`verificarReserva`), que es lo que lee `¿Afirma que agendó?`.
  const pasos = Array.isArray(dato.intermediateSteps) ? dato.intermediateSteps : [];
  const herramientas = pasos.map((p) => String((p && p.action && p.action.tool) || '')).filter(Boolean);
  const eventosCreados = [];
  for (const p of pasos) {
    if (!p || !p.action || p.action.tool !== 'agendar_cita') continue;
    // La observacion es lo que devolvio la herramienta: el evento creado,
    // como texto JSON (asi lo entrega n8n) o ya como objeto.
    let obs = p.observation;
    if (typeof obs === 'string') { try { obs = JSON.parse(obs); } catch (e) { obs = null; } }
    const lista = Array.isArray(obs) ? obs : (obs && typeof obs === 'object' ? [obs] : []);
    for (const ev of lista) {
      if (!ev || !ev.id) continue;
      eventosCreados.push({
        id: String(ev.id),
        calendario: String((ev.organizer && ev.organizer.email) || ''),
        inicio: String((ev.start && ev.start.dateTime) || ''),
        fin: String((ev.end && ev.end.dateTime) || ''),
        titulo: String(ev.summary || ''),
      });
    }
  }
  const ejecutoAgendar = herramientas.includes('agendar_cita') || herramientaAgendarCorrio;
  const verificarReserva = ejecutoAgendar || afirmaAgendo;

  out.push({ json: {
    respuesta,
    transferir: transferir || qrSinSena,
    motivoTransferencia: (transferir || qrSinSena)
      ? (qrSinSena ? 'pidió el QR de su seña y no hay ninguna pendiente: revisar si quedó a medias'
        : (ent.forzarTransferencia === true && ent.motivoForzado
          ? String(ent.motivoForzado) : 'tres rechazos de horario consecutivos')) : '',
    afirmaAgendo,
    ejecutoAgendar,
    verificarReserva,
    herramientas,
    eventosCreados,
    respuestaVacia: vacia,
    seDespide,
    falloModelo: fallo,
    from: ent.from,
    nombrePerfil: ent.nombrePerfil,
    enviarUbicacion, enviarContacto, numeroRecepcion, reenviarQr,
    // Lo que el envio del pin necesita, arrastrado en el item (como en el
    // Demo B): `Enviar ubicacion` lo lee de `Mensaje a enviar`, porque el
    // $json que le llega de `Responder al cliente` es la respuesta de Meta.
    phoneNumberId: cfg.phoneNumberId,
    waGraphVersion: cfg.waGraphVersion || 'v26.0',
    ubicacionLat: lat,
    ubicacionLng: lng,
    direccion: String(cfg.direccion ?? ''),
    nombreNegocio: String(cfg.nombreNegocio ?? ''),
    // SEÑA (bloque 2): lo que `Preparar seña` y el QR necesitan, arrastrado
    // en el item; la compuerta `¿Enviar QR de la seña?` lee `senaActiva` de
    // aca, despues del candado. `calendarioDelEvento` es el del evento que
    // agendar_cita devolvio; `Preparar seña` lo confirma contra el calendario.
    avisos,
    senaActiva: cfg.senaActiva === 'si' ? 'si' : '',
    senaImporte: String(cfg.senaImporte ?? ''),
    senaMoneda: String(cfg.senaMoneda ?? 'Bs'),
    senaMinutosRetencion: String(cfg.senaMinutosRetencion ?? '30'),
    senaQrUrl: String(cfg.senaQrUrl ?? ''),
    senaNombreCuenta: String(cfg.senaNombreCuenta ?? ''),
    senaBanco: String(cfg.senaBanco ?? ''),
    direccionMaps: String(cfg.direccionMaps ?? ''),
    funcionarios: String(cfg.funcionarios ?? '[]'),
    calendarioDelEvento: eventosCreados.length ? eventosCreados[0].calendario : '',
  }});
}
return out;
