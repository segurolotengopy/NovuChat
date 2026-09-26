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

  // --- UNA MARCA SOLA NO ES UNA RESPUESTA VACIA (21/09/2026) -----------------
  // Prueba con el telefono: el asistente ofrecio «¿Te comunico con ellos?», el
  // paciente dijo «ok» y despues «si, comunicame», y las dos veces el modelo
  // contesto SOLO [CONTACTO_RECEPCION]. Sin la marca el texto quedaba vacio y
  // salia «tuve un problema tecnico»: lo ofrecido no se cumplio nunca. Si el
  // modelo solo marco una accion, la accion ES la respuesta, con una linea fija.
  const tratoUsted = /\busted\b/i.test(String(cfg.tratamiento || ''));
  const numeroCargado = String(cfg.numeroRecepcion ?? '').replace(/\D/g, '') !== '';
  const soloMarca = !fallo && respuesta === '' && /\[[A-Za-z_ ]{3,30}\]/.test(texto);
  const direccionFija = String(cfg.direccion || '').trim();
  // Sin numero cargado no hay boton que mandar: lo resuelve una persona.
  const contactoSinNumero = pideContacto && !numeroCargado;
  if (soloMarca) {
    if (pideContacto && numeroCargado) {
      respuesta = tratoUsted ? 'Le paso el contacto de recepción para que les escriba directo.'
        : 'Te paso el contacto de recepción para que les escribas directo.';
    } else if (pideUbicacion && direccionFija && !/no\s+(est[aá]\s+)?definid/i.test(direccionFija)) {
      respuesta = (tratoUsted ? 'Nos encuentra en ' : 'Nos encuentras en ') + direccionFija.replace(/[.\s]+$/, '') + '.';
    } else if (transferir || contactoSinNumero) {
      respuesta = tratoUsted ? 'Le pido a recepción que le responda por este chat.'
        : 'Le pido a recepción que te responda por este chat.';
    }
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
  // Si el modelo solo marco el contacto, o su texto dice que lo pasa, se
  // manda: un texto que anuncia el contacto y no lo trae es una promesa rota.
  const ANUNCIA_CONTACTO = /contacto|n[uú]mero|bot[oó]n|escrib[a-záéíóúñ]*\s+directo/i;
  const enviarContacto = pideContacto && (pidioContacto || soloMarca || ANUNCIA_CONTACTO.test(respuesta)) && !vacia && numeroRecepcion !== '';
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

  // --- LA HERRAMIENTA CORRIO Y NO DEVOLVIO NINGUNA CITA (2026-09-25) --------
  // Cuando `agendar_cita` falla --Google rechaza la creacion, la fecha, un
  // 403--, n8n le entrega al modelo una observacion VACIA (#5553) y el modelo
  // escribe «quedo agendada» igual. `eventosCreados` queda vacio y el candado,
  // que ancla en esos ids, no tenia nada que verificar: fallaba ABIERTO y el
  // texto salia tal cual. Este hecho --la herramienta figura en los pasos y no
  // trajo ningun evento con id-- viaja al candado, que lo cierra. Solo con los
  // pasos a la vista: si el agente no los devolvio (`isExecuted` como respaldo)
  // no se puede afirmar que fallo, y queda como antes.
  const agendarSinEvento = herramientas.includes('agendar_cita') && eventosCreados.length === 0;
  // Lo que la herramienta DEVOLVIO cuando no trajo cita, recortado y en una
  // linea, para el aviso a recepcion (revision de seguridad del 25/09): si un
  // dia n8n cambia la forma de la observacion y una cita real deja de
  // reconocerse, se ve en el primer aviso y no por reclamo. Vacio = «vacia».
  const observacionAgendar = !agendarSinEvento ? '' : pasos
    .filter((p) => p && p.action && p.action.tool === 'agendar_cita')
    .map((p) => (typeof p.observation === 'string' ? p.observation : JSON.stringify(p.observation ?? '')))
    .join(' | ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'vacia';

  // --- NO NEGAR UN SERVICIO QUE NO CONOCE (2026-09-21) -----------------------
  // Dos pruebas seguidas con el telefono: a «¿hacen estetica facial?» el modelo
  // contesto «no realizamos estetica facial; nos enfocamos exclusivamente en
  // odontologia», aunque el prompt ya decia «lo que no sabes, no lo niegues:
  // te asesora una persona». Ninguna fuente dice que no lo hagan, y el logo
  // de la clinica dice «Clinica dental & estetica facial». El prompt no es una
  // barrera: si la respuesta NIEGA un servicio, se reemplaza por la derivacion
  // y se avisa a recepcion, que es quien sabe. Solo las formas de negar un
  // SERVICIO; «no atendemos los domingos» o «no tenemos horario» no entran.
  const NIEGA_SERVICIO = /\bno\s+(realizamos|ofrecemos|brindamos|hacemos|trabajamos|contamos\s+con|damos)\b|\bexclusivamente\s+(en\s+)?(odontolog|dental|estetica\s+dental|est[eé]tica\s+dental)|\bsolo\s+(hacemos|ofrecemos|realizamos|trabajamos)\b/i;
  const negoServicio = !fallo && NIEGA_SERVICIO.test(respuesta.replace(/[*_~]/g, ''));
  if (negoServicio) {
    respuesta = /\busted\b/i.test(String(cfg.tratamiento || ''))
      ? 'Sobre eso le asesora una persona del equipo: ya le paso su consulta y le escribe por acá.'
      : 'Sobre eso te asesora una persona del equipo: ya le paso tu consulta y te escribe por acá.';
    avisos.push('negacion_de_servicio');
  }

  // --- UNA CANCELACION SE AFIRMA SOLO SI GOOGLE LA CONFIRMO (2026-09-20) -----
  // Prueba real con el telefono: el cliente confirmo, el modelo llamo a
  // cancelar_cita con un identificador INVENTADO --la memoria guarda los
  // mensajes, no lo que devuelven las herramientas, y el id real se habia
  // quedado en el turno anterior--, Google contesto «Not Found», y el modelo
  // escribio igual «Listo, la cita quedo cancelada». La cita siguio en la
  // agenda. El prompt ya decia «si cancelar_cita falla, di que no se pudo»:
  // el prompt no es una barrera (CLAUDE.md), asi que se decide aca, por lo
  // que la herramienta DEVOLVIO. Borrar un evento en Google devuelve
  // `{ success: true }`; cualquier otra cosa --vacio, error, otra forma-- es
  // una cancelacion que no se puede afirmar. Falla CERRADA: en el peor caso,
  // recepcion confirma una cancelacion que si ocurrio.
  const canceloBien = (obs) => {
    let o = obs;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { return false; } }
    const lista = Array.isArray(o) ? o : [o];
    return lista.length > 0 && lista.every((x) => x && x.success === true);
  };
  const pasosCancelar = pasos.filter((p) => p && p.action && p.action.tool === 'cancelar_cita');

  // --- SIN CONFIRMACION NO SE CANCELA (Andres, 21/09/2026, opcion 2) --------
  // El modelo cancelo dos veces en el mismo mensaje en que se lo pidieron
  // («quiero cancelar la cita», «quiero cancelar la de las 11»), con el prompt
  // diciendo que primero la muestre y pida confirmacion. Ahora la compuerta
  // esta en la herramienta: si el mensaje del cliente no confirma, cancelar_cita
  // recibe un identificador que no existe y Google no borra nada. Aca se
  // reemplaza lo que haya escrito el modelo por la pregunta, con la cita que
  // se busco en este mismo turno. La MISMA expresion regular esta en
  // `cancelar_cita`: una prueba exige que sean identicas. Termina con
  // `(?![a-z…])` y NO con `\b`: en JavaScript `\b` no ve la «í» como letra,
  // y «Sí» con tilde —la respuesta mas comun— no se reconocia.
  //
  // «SI QUIERO REAGENDAR» ES UNA CONFIRMACION (24/09/2026, ejecucion #5553 de
  // Bellido). El asistente pregunto «¿me confirmas que quieres reagendar esa
  // cita?», la paciente contesto «Si quiero reagendar», y la lista no tenia
  // «reagendar»: la herramienta recibio SIN-CONFIRMAR, Google no borro nada,
  // el modelo dijo «he cancelado» y esta compuerta lo reemplazo por la pregunta
  // otra vez. Resultado: un mensaje pagado de mas, seco, y las opciones de
  // horario recien en el siguiente. Se aceptan las formas de mover, cambiar,
  // reprogramar y reagendar, y las palabras «fecha», «hora», «horario» y «dia»
  // que las acompañan. Lo que sigue SIN entrar es lo del #4034: una respuesta
  // que nombra OTRA cita («la de las 16», «la del lunes», «la otra») no es una
  // confirmacion de la que se mostro.
  const CONFIRMA_CANCELAR = /^[^a-záéíóúñ0-9]*(s[ií]|dale|confirmo|confirmado|correcto|exacto|as[ií] es|ok|okay|okey|de acuerdo|claro|adelante|hazlo|procede|canc[eé]lal[ao]|mu[eé]vel[ao]|c[aá]mbial[ao]|reprogr[aá]mal[ao]|reag[eé]ndal[ao]|por favor)(?![a-záéíóúñ])(?:[^a-záéíóúñ0-9]+(?:s[ií]|sip|dale|confirm[a-záéíóúñ]*|correcto|exacto|as[ií]|es|ok|okay|okey|de|acuerdo|claro|adelante|hazlo|procede|canc[eé]l[a-záéíóúñ]*|anul[a-záéíóúñ]*|reag[eé]nd[a-záéíóúñ]*|reprogr[aá]m[a-záéíóúñ]*|mov[a-záéíóúñ]*|mu[eé]v[a-záéíóúñ]*|cambi[a-záéíóúñ]*|c[aá]mbi[a-záéíóúñ]*|fecha|hora|horario|d[ií]a|quiero|la|lo|esa|ese|esta|misma|mismo|por|favor|porfa|porfavor|gracias|muchas|ya|y|listo|perfecto|bueno|nom[aá]s|seguro|pues|entonces)(?![a-záéíóúñ]))*[^a-záéíóúñ0-9]*$/i;
  const textoCliente = String(ent.userInput || '').replace(/^\(audio transcripto\)\s*/i, '').split('\n')[0];
  // --- EL ID DE LA CITA QUE SE MOSTRO, GUARDADO POR TELEFONO (26/09/2026) ---
  // Ejecuciones #6086 y #6091 del Demo A: la compuerta de abajo pregunto
  // «¿confirmas que quieres cancelar tu cita de corte de las 10:00?», el
  // cliente dijo «si», y el modelo llamo a cancelar_cita con el id de OTRA cita
  // (la manicure de las 11:00) y escribio «he cancelado tu manicure». La
  // memoria del agente guarda mensajes, no lo que devolvieron las herramientas:
  // en el turno siguiente el id es lo que el modelo reconstruya. Por eso el id
  // de la cita que se mostro se guarda ACA, por telefono y por 30 minutos, en
  // los datos estaticos del flujo; `Config del negocio` lo expone en el turno
  // siguiente y `cancelar_cita` lo usa cuando el cliente confirma, en vez del
  // que el modelo elija. Barrera por hecho, no por prompt. Sin datos estaticos
  // (pruebas sin ese global) no se guarda nada y todo sigue como hasta hoy.
  const pendientesDeCancelar = (() => {
    try {
      const sd = $getWorkflowStaticData('global');
      sd.cancelacionesPendientes = (sd.cancelacionesPendientes && typeof sd.cancelacionesPendientes === 'object')
        ? sd.cancelacionesPendientes : {};
      return sd.cancelacionesPendientes;
    } catch (e) { return null; }
  })();
  const telefonoDelCliente = String(ent.from || '');
  // Como se describe una cita en la pregunta: «de corte del sabado, 26 de
  // septiembre a las 10:00». Es lo que el cliente lee, y lo que se guarda con
  // el id para que la pregunta siguiente pueda nombrar lo que va a cancelar.
  const describirCita = (cita) => {
    if (!cita) return '';
    const serv = (String(cita.summary || '').split('—')[1] || '').trim().replace(/-/g, ' ');
    let cuando = '';
    try {
      const d = new Date(cita.start && cita.start.dateTime);
      cuando = d.toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/La_Paz' })
        + ' a las ' + d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' });
    } catch (e) { cuando = ''; }
    return (serv ? ' de ' + serv : '') + (cuando ? ' del ' + cuando : '');
  };
  // El registro de este telefono: el pendiente (la cita que se mostro al pedir
  // confirmacion) y los CANDIDATOS (todo lo que buscar_mi_cita le devolvio en
  // los ultimos 30 minutos, id y descripcion). Los candidatos son lo unico que
  // el cliente pudo haber visto: la herramienta rechaza cancelar otra cosa.
  const registroDe = () => (pendientesDeCancelar && telefonoDelCliente)
    ? (pendientesDeCancelar[telefonoDelCliente] = pendientesDeCancelar[telefonoDelCliente] || { eventoId: '', desc: '', desde: 0, candidatos: {} })
    : null;
  const guardarPendiente = (id, desc) => {
    const r = registroDe();
    if (r && id) { r.eventoId = String(id).slice(0, 200); r.desc = String(desc || '').slice(0, 160); r.desde = Date.now(); }
  };
  const olvidarPendiente = () => { const r = registroDe(); if (r) { r.eventoId = ''; r.desc = ''; } };
  const citasBuscadas = () => {
    const vistas = [];
    for (const p of pasos) {
      if (!p || !p.action || p.action.tool !== 'buscar_mi_cita') continue;
      let obs = p.observation;
      if (typeof obs === 'string') { try { obs = JSON.parse(obs); } catch (e) { obs = null; } }
      for (const ev of (Array.isArray(obs) ? obs : [])) {
        if (ev && ev.id && !vistas.some((v) => v.id === String(ev.id))) vistas.push({ id: String(ev.id), desc: describirCita(ev) });
      }
    }
    return vistas;
  };
  // Todo lo que buscar_mi_cita devolvio en este turno queda como candidato, con
  // su descripcion, por 30 minutos: hasta diez, que es mas de lo que un cliente
  // tiene por delante.
  const vistasEsteTurno = citasBuscadas();
  if (vistasEsteTurno.length) {
    const r = registroDe();
    if (r) {
      r.candidatos = (r.candidatos && typeof r.candidatos === 'object') ? r.candidatos : {};
      for (const v of vistasEsteTurno) r.candidatos[v.id.slice(0, 200)] = String(v.desc).slice(0, 160);
      const ids = Object.keys(r.candidatos);
      for (const id of ids.slice(0, Math.max(0, ids.length - 10))) delete r.candidatos[id];
      r.desde = Date.now();
    }
  }

  const cancelacionSinConfirmar = pasosCancelar.length > 0 && !CONFIRMA_CANCELAR.test(textoCliente);
  const cancelacionFallida = !cancelacionSinConfirmar && pasosCancelar.length > 0
    && pasosCancelar.some((p) => !canceloBien(p.observation));
  if (cancelacionSinConfirmar && !fallo) {
    const pedida = String((pasosCancelar[0].action.toolInput || {}).eventoId || '');
    const vista = vistasEsteTurno.find((v) => v.id === pedida) || null;
    const registro = registroDe();
    const candidatos = (registro && registro.candidatos && typeof registro.candidatos === 'object') ? registro.candidatos : {};
    let desc = '';
    // LA PREGUNTA NOMBRA SIEMPRE LO QUE SE VA A CANCELAR (revision de seguridad
    // del 26/09). Tres casos, en orden:
    //   1. el modelo busco en este turno y pidio una de las que encontro: esa;
    //   2. no busco, pero pidio una que el cliente YA VIO en los ultimos 30
    //      minutos (candidatos): esa. Es «no, mejor la de las 11» sin volver a
    //      buscar, y el pendiente viejo NO se queda pegado;
    //   3. pidio algo que nadie vio: si habia un pendiente, la pregunta nombra
    //      ESE (es lo que el «si» va a cancelar); si no, se olvida todo y la
    //      pregunta sale sin cita, y el «si» siguiente tampoco cancela nada que
    //      no se haya mostrado (la herramienta lo rechaza).
    if (vista) {
      desc = vista.desc;
      guardarPendiente(vista.id, desc);
    } else if (pedida && Object.prototype.hasOwnProperty.call(candidatos, pedida)) {
      desc = String(candidatos[pedida] || '');
      guardarPendiente(pedida, desc);
    } else if (registro && registro.eventoId) {
      desc = String(registro.desc || '');
    } else {
      olvidarPendiente();
    }
    // SI VINO A MOVER LA CITA, LA PREGUNTA LO DICE (Andres, 24/09/2026): «primero
    // tienes que cancelar» sin ofrecer nada suena a tramite, y la persona
    // escribio para conseguir OTRO horario, no para perder el suyo. El horario
    // nuevo lo ofrece el turno siguiente, cuando la cancelacion ya es un hecho
    // (regla 4b.5 del prompt: primero cancelar, despues agendar).
    const quiereMover = /reagend|reprogram|\bmov[eé]r|mu[eé]v[ae]|cambi/i.test(textoCliente);
    const deUsted = /\busted\b/i.test(String(cfg.tratamiento || ''));
    respuesta = deUsted
      ? (quiereMover
        ? `Para moverla necesito que me confirme: ¿cancelo su cita${desc}? Respóndame «sí» y la cancelo para darle otro horario.`
        : `¿Confirma que quiere cancelar su cita${desc}? Respóndame «sí» y la cancelo.`)
      : (quiereMover
        ? `Para moverla necesito que me confirmes: ¿cancelo tu cita${desc}? Respóndeme «sí» y la cancelo para darte otro horario.`
        : `¿Confirmas que quieres cancelar tu cita${desc}? Respóndeme «sí» y la cancelo.`);
    avisos.push('cancelacion_sin_confirmar');
  }
  // Cuando el MODELO pide la confirmacion por su cuenta (sin llamar a la
  // herramienta) y en este turno busco y encontro UNA sola cita, esa es la que
  // se mostro: queda guardada igual. Con varias no se adivina cual.
  if (!fallo && pasosCancelar.length === 0 && /cancel/i.test(respuesta) && /\?/.test(respuesta)) {
    if (vistasEsteTurno.length === 1) guardarPendiente(vistasEsteTurno[0].id, vistasEsteTurno[0].desc);
  }

  // --- UNA CITA PAGADA QUE SE CANCELA (2026-09-21) ---------------------------
  // Prueba con el telefono: el paciente pago la seña y enseguida cancelo; el
  // asistente contesto «listo, quedo cancelada» y nadie se entero de que habia
  // un adelanto de por medio. Con la seña activa, toda cita nace con el rotulo
  // «PENDIENTE DE SEÑA» y lo pierde solo cuando el comprobante cuadra: una cita
  // SIN el rotulo que se cancela es una cita pagada (o cargada a mano por la
  // clinica). Lo que se haga con el adelanto lo decide el negocio; lo que no
  // puede pasar es que nadie lo sepa.
  const idsCancelados = new Set(pasosCancelar.filter((p) => canceloBien(p.observation))
    .map((p) => String((p.action.toolInput && p.action.toolInput.eventoId) || '')).filter(Boolean));
  // Cancelada de verdad: el pendiente y los candidatos de este telefono ya no
  // sirven (la cita cancelada no vuelve a mostrarse; las otras, cuando las
  // vuelva a buscar).
  if (idsCancelados.size && pendientesDeCancelar && telefonoDelCliente) delete pendientesDeCancelar[telefonoDelCliente];
  let citaPagadaCancelada = null;
  if (idsCancelados.size && cfg.senaActiva === 'si') {
    for (const p of pasos) {
      if (!p || !p.action || p.action.tool !== 'buscar_mi_cita') continue;
      let obs = p.observation;
      if (typeof obs === 'string') { try { obs = JSON.parse(obs); } catch (e) { obs = null; } }
      for (const ev of (Array.isArray(obs) ? obs : [])) {
        if (ev && idsCancelados.has(String(ev.id)) && !/^PENDIENTE DE SEÑA/.test(String(ev.summary || ''))) {
          citaPagadaCancelada = ev;
        }
      }
    }
  }
  // CON ANTICIPACION, EL ADELANTO QUEDA A FAVOR (Andres, 21/09/2026): siete dias
  // para reagendar sin pagar otra seña, si se cancelo con al menos dos horas.
  // La regla la aplica el SERVIDOR con el evento `cita_cancelada`; aca se
  // calcula lo mismo solo para decirle al paciente lo que va a pasar. Con
  // menos anticipacion no hay credito automatico: lo decide recepcion.
  const inicioPagada = citaPagadaCancelada ? Date.parse(String((citaPagadaCancelada.start || {}).dateTime || '')) : NaN;
  const conAnticipacion = Number.isFinite(inicioPagada) && inicioPagada - Date.now() >= 2 * 3600 * 1000;
  // EL CREDITO LO DA EL SERVIDOR, Y SOLO POR LA CITA DE SU SEÑA (21/09/2026,
  // #4034). El flujo prometio «el adelanto queda a tu favor» por una cita sin
  // rotulo que NO era la de la seña registrada, y el servidor —que exige esa
  // cita— no dio nada: una promesa que nadie iba a cumplir. Ahora se promete
  // solo si la cita cancelada es la que el servidor tiene como pagada; si no,
  // lo coordina recepcion (aviso + boton).
  const esLaCitaDeLaSena = !!citaPagadaCancelada && String(cfg.senaEventoId || '') !== ''
    && String(cfg.senaEventoId) === String(citaPagadaCancelada.id) && cfg.senaPendiente !== 'si';
  const adelantoAFavor = !!citaPagadaCancelada && !cancelacionFallida && conAnticipacion && esLaCitaDeLaSena;
  const usted = /\busted\b/i.test(String(cfg.tratamiento || ''));
  if (adelantoAFavor) {
    respuesta = respuesta.trim() + (usted
      ? '\n\nEl adelanto que pagó queda a su favor por 7 días: si reagenda en ese plazo, no paga otra seña.'
      : '\n\nEl adelanto que pagaste queda a tu favor por 7 días: si reagendas en ese plazo, no pagas otra seña.');
  } else if (citaPagadaCancelada && !cancelacionFallida) {
    respuesta = respuesta.trim() + (usted
      ? '\n\nSobre el adelanto que pagó, le escribe recepción.'
      : '\n\nSobre el adelanto que pagaste, te escribe recepción.');
  }
  if (cancelacionFallida && !fallo) {
    respuesta = 'No pude cancelar la cita en la agenda en este momento. Le paso el pedido a recepción '
      + 'para que la cancele y le confirme por este chat.';
    avisos.push('cancelacion_no_confirmada');
  }
  // --- NO SE OFRECE LO QUE NO SE VA A CUMPLIR (Andres, 21/09/2026) -----------
  // POLITICA DE NOVUCHAT, para todos los clientes. El asistente escribio «lo
  // consulto con recepcion para que te confirmen» y no tiene como consultar a
  // nadie: el paciente espero una respuesta que no iba a llegar. Lo unico que
  // puede ofrecer cuando le falta un dato o algo falla es pasar con recepcion,
  // que es un aviso a recepcion MAS el boton para escribirle directo (lo
  // agrega `Mensaje a enviar` a todo lo que se transfiere). Toda promesa de que
  // alguien le va a responder o avisar despues se CUMPLE: se transfiere. No se
  // toca el texto; lo que se hace es que sea verdad. Las preguntas («¿Quieres
  // que te pase con recepcion?») no prometen nada y no cuentan.
  const PROMESA = /(consult|averigu|pregunt|verific|revis|coordin)[a-záéíóúñ]*\s+(lo\s+|eso\s+)?(con|a)\s+(recepci|la\s+cl[ií]nica|el\s+equipo|el\s+personal|(el|la)\s+(doctor|doctora|dr|dra)(?![a-záéíóúñ])|administraci|caja|alguien|una\s+persona|la\s+empresa|el\s+negocio|mis\s+compa)|(te|le)\s+(avis|escrib|llam|contact|confirm|mand|env[ií]|respond)[a-záéíóúñ]*\s+(luego|despu[eé]s|m[aá]s\s+tarde|ma[ñn]ana|en\s+cuanto|apenas|pronto|en\s+un\s+rato|en\s+breve|a\s+la\s+brevedad)|(te|le)\s+(avisar|escribir|llamar|contactar|confirmar|responder)([eé]|[aá]n?)(?![a-záéíóúñ])|voy\s+a\s+(consultar|averiguar|preguntar|avisar|escribir|llamar|contactar|confirmar)/i;
  const frasePrometida = fallo ? '' : (respuesta.split(/(?<=[.!?…])\s+|\n+/)
    .map((o) => o.trim()).find((o) => o && !/\?\s*$/.test(o) && PROMESA.test(o)) || '');
  const prometeSinRespaldo = frasePrometida !== '' && !transferir;
  if (prometeSinRespaldo) avisos.push('promesa_cumplida_por_recepcion');
  const pasarARecepcion = prometeSinRespaldo || contactoSinNumero;

  // --- EL DIA DE LA SEMANA LO PONE EL CODIGO, NO EL MODELO (2026-09-23) ------
  // Bellido, prueba real del cliente con dos telefonos (#4790 y #4799):
  //   · `consultar_disponibilidad` recibio 2026-09-25 y el modelo escribio
  //     «el jueves 25 de septiembre». El 25 era viernes.
  //   · `buscar_mi_cita` DEVOLVIO la cita correcta, 2026-09-24T15:00-04:00, y
  //     el modelo escribio «el miercoles 24 de septiembre a las 15:00». El 24
  //     era jueves.
  // El dia del mes y la hora salieron BIEN las dos veces. Lo unico que el
  // modelo inventa es la PALABRA del dia de la semana, porque es lo unico que
  // tiene que calcular. El doctor lo leyo como «se ha confundido con las
  // fechas» y decidio no publicar el numero hasta que se arregle. Y el error
  // no se queda en el texto: con el dia equivocado el modelo consulto la
  // franja del jueves (14:00-18:00) sobre una fecha que era viernes.
  //
  // POR QUE EN CODIGO Y NO EN EL PROMPT. Pedirle que no calcule es una
  // instruccion mas, y ya sabemos como termina (la regla del candado, 17/09:
  // una instruccion se ignora bajo insistencia y cambia con cada modelo). Aca
  // no hay nada que interpretar: el turno SABE que fechas tocaron las
  // herramientas —lo que les entro y lo que devolvieron— y de una fecha al dia
  // de la semana hay una sola respuesta.
  //
  // SOLO CORRIGE LO QUE PUEDE PROBAR. Se toca la palabra unicamente cuando el
  // numero del dia coincide con una fecha real de este turno (y el mes, si el
  // texto lo dice). Si no coincide, o si dos fechas del turno caen en el mismo
  // numero con distinto dia de semana, el flujo no tiene con que decidir: deja
  // el texto como esta. Corregir de menos es un texto raro; corregir de mas es
  // mandar a un paciente otro dia.
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const sinTilde = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const porDia = new Map();   // dia del mes -> [{ semana, mes }]
  // UNA FECHA ANTERIOR A HOY NO ES EVIDENCIA (24/09/2026, ejecucion #5563 de
  // Bellido). El modelo llamo a consultar_disponibilidad y a agendar_cita con
  // el 25/09/2025 --un año atras-- y este corrector, fiel a «lo que las
  // herramientas tocaron», cambio un «viernes 25» que estaba BIEN por «jueves
  // 25», que era el dia de la semana del 25 de 2025. Una cita nunca esta en
  // el pasado: una fecha de ayer o de otro año en un paso de herramienta es
  // un error del modelo, no un dato, y no sirve para corregir nada. Se
  // compara el DIA en la zona del negocio (en-CA da AAAA-MM-DD, que ordena
  // como texto); lo de hoy si cuenta, porque un rango de hoy a las 09:00
  // consultado a las 19:00 es legitimo.
  const hoyLaPaz = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const anotarFecha = (iso) => {
    const t = Date.parse(String(iso || ''));
    if (!Number.isFinite(t)) return;
    const diaLaPaz = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(t));
    if (diaLaPaz < hoyLaPaz) return;
    // El dia, el mes y el dia de la semana, los tres en la zona del negocio:
    // en UTC una cita de las 17:30 de La Paz ya pertenece al dia siguiente, y
    // ese desfase es justo el que se vino a arreglar.
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/La_Paz', weekday: 'short', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(t));
    const valor = (tipo) => (partes.find((p) => p.type === tipo) || {}).value || '';
    const dia = parseInt(valor('day'), 10);
    const mes = parseInt(valor('month'), 10);
    const semana = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[valor('weekday')];
    if (!Number.isFinite(dia) || !Number.isFinite(mes) || !Number.isFinite(semana)) return;
    const ya = porDia.get(dia) || [];
    if (!ya.some((f) => f.mes === mes && f.semana === semana)) ya.push({ mes, semana });
    porDia.set(dia, ya);
  };
  for (const p of pasos) {
    if (!p || !p.action) continue;
    const entrada = p.action.toolInput || {};
    anotarFecha(entrada.inicio);
    anotarFecha(entrada.fin);
    let obs = p.observation;
    if (typeof obs === 'string') { try { obs = JSON.parse(obs); } catch (e) { obs = null; } }
    const eventos = Array.isArray(obs) ? obs : (obs && typeof obs === 'object' ? [obs] : []);
    for (const ev of eventos) {
      if (!ev || typeof ev !== 'object') continue;
      anotarFecha((ev.start || {}).dateTime);
      anotarFecha((ev.end || {}).dateTime);
    }
  }
  let diaCorregido = false;
  if (porDia.size && !fallo) {
    respuesta = respuesta.replace(
      /\b(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)(\s+)(\d{1,2})\b(\s+de\s+([a-záéíóú]+))?/gi,
      (todo, palabra, espacio, numero, colaMes, nombreMes) => {
        const dia = parseInt(numero, 10);
        const candidatas = porDia.get(dia) || [];
        if (!candidatas.length) return todo;
        let elegidas = candidatas;
        if (nombreMes) {
          const mes = MESES.findIndex((m) => m === sinTilde(nombreMes)) + 1;
          // Un mes escrito que no es ninguno de los del turno: no es esta fecha.
          if (!mes) return todo;
          elegidas = candidatas.filter((f) => f.mes === mes);
          if (!elegidas.length) return todo;
        }
        const semanas = Array.from(new Set(elegidas.map((f) => f.semana)));
        if (semanas.length !== 1) return todo;   // ambiguo: no se toca
        const correcto = DIAS[semanas[0]];
        if (sinTilde(palabra) === sinTilde(correcto)) return todo;
        diaCorregido = true;
        // Se conserva la mayuscula inicial: la palabra puede abrir la oracion.
        const puesto = /^[A-ZÁÉÍÓÚÑ]/.test(palabra)
          ? correcto.charAt(0).toUpperCase() + correcto.slice(1)
          : correcto;
        return puesto + espacio + numero + (colaMes || '');
      },
    );
  }
  if (diaCorregido) avisos.push('dia_de_semana_corregido');

  const verificarReserva = ejecutoAgendar || afirmaAgendo;

  out.push({ json: {
    respuesta,
    // Con el adelanto a favor no hace falta una persona: se aplica solo.
    transferir: transferir || qrSinSena || cancelacionFallida || negoServicio || (!!citaPagadaCancelada && !adelantoAFavor) || pasarARecepcion,
    motivoTransferencia: (transferir || qrSinSena || cancelacionFallida || negoServicio || (citaPagadaCancelada && !adelantoAFavor) || pasarARecepcion)
      ? ((citaPagadaCancelada && !adelantoAFavor) ? 'el cliente CANCELÓ una cita que ya tenía la seña pagada ('
          + String(citaPagadaCancelada.summary || '') + ', ' + String((citaPagadaCancelada.start || {}).dateTime || '')
          + '): coordinar con él qué pasa con el adelanto'
        : negoServicio ? 'el cliente preguntó por algo que el asistente no sabe si el negocio ofrece: asesorarlo. Escribió: «'
          + String(ent.userInput || '').replace(/\s+/g, ' ').slice(0, 160) + '»'
        : cancelacionFallida ? 'el cliente pidió CANCELAR su cita y cancelar_cita NO la borró (Google no confirmó): la cita sigue en la agenda, cancelarla a mano y avisarle'
        : pasarARecepcion ? (contactoSinNumero && !prometeSinRespaldo
          ? 'el cliente pidió hablar con recepción y no hay número de recepción cargado en la consola: escribirle por este chat. Escribió: «'
          : 'el asistente le dijo al cliente que alguien le iba a responder («' + frasePrometida.slice(0, 160)
            + '»): responderle por este chat. El cliente escribió: «')
          + String(ent.userInput || '').replace(/\s+/g, ' ').slice(0, 160) + '»'
        : qrSinSena ? 'pidió el QR de su seña y no hay ninguna pendiente: revisar si quedó a medias'
        : (ent.forzarTransferencia === true && ent.motivoForzado
          ? String(ent.motivoForzado)
          // EL MOTIVO DICE LO QUE PASO (2026-09-20). Antes decia siempre «tres
          // rechazos de horario consecutivos», y el modelo marca [TRANSFERIR] por
          // varias razones: un servicio que no conoce, una cancelacion que
          // fallo, una cita que no pudo verificar. Recepcion leia «tres
          // rechazos» cuando el paciente habia preguntado por estetica facial.
          // Sin saber la razon exacta, se le da lo unico cierto: que derivo el
          // asistente, y que escribio el cliente.
          : 'el asistente pidió que lo atienda una persona. El cliente escribió: «'
            + String(ent.userInput || '').replace(/\s+/g, ' ').slice(0, 160) + '»')) : '',
    afirmaAgendo,
    ejecutoAgendar,
    agendarSinEvento,
    observacionAgendar,
    verificarReserva,
    herramientas,
    eventosCreados,
    respuestaVacia: vacia,
    seDespide,
    falloModelo: fallo,
    from: ent.from,
    nombrePerfil: ent.nombrePerfil,
    enviarUbicacion, enviarContacto, numeroRecepcion, reenviarQr,
    // El hecho que el reporte del saliente le lleva al servidor, que es quien
    // decide el adelanto a favor.
    ...(adelantoAFavor ? { eventoSena: { evento: 'cita_cancelada', referencia: String(citaPagadaCancelada.id),
      inicio: String((citaPagadaCancelada.start || {}).dateTime || '') } } : {}),
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
