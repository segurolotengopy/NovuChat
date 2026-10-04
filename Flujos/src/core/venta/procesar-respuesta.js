// Separa las marcas [ENVIAR_QR] / [PEDIDO_CONFIRMADO] / [ENVIAR_CATALOGO] y
// APLICA POR CÓDIGO las prohibiciones 3 y 4 de CLAUDE.md.
//
// Por qué acá y no solo en el prompt: un modelo puede omitir una frase del
// system message (por temperatura, por truncado o por un reintento). Las dos
// prohibiciones no pueden depender de la buena voluntad del LLM, así que este
// nodo es la última compuerta antes de que cualquier texto salga a WhatsApp.
// Todos los caminos de salida al cliente pasan por acá.

const entradas = $('Normalizar entrada').all();

// Frases que, si aparecen sin la palabra "simulad…", harían pasar el cobro por real.
const AFIRMA_COBRO = /((pago|cobro|transferencia|dep[oó]sito|abono)\s+(\S+\s+){0,3}(verificad|confirmad|recibid|acreditad|procesad|aprobad|realizad|efectuad|exitos)|ya\s+(recibimos|se\s+acredit|te\s+cobr|se\s+cobr)|(pago|cobro)\s+(\S+\s+){0,2}(real|de\s+verdad))/i;
// «Recibimos tu pago» y las demás formas que AFIRMAN un pago ya hecho y que
// AFIRMA_COBRO no cubre (prohibición 3 de CLAUDE.md, hallazgo de seguridad sobre
// main). Va APARTE y no dentro de AFIRMA_COBRO porque ese regex es letra por letra
// el de Platinum (una prueba lo exige) y este módulo no puede tocarlo. Con `u` y
// límites `(?<![\p{L}])` / `(?![\p{L}])` porque `\b` no ve las vocales con tilde.
// Los futuros («cuando recibamos tu pago te confirmamos», «te aviso cuando
// recibamos tu comprobante») NO entran: «recibamos» es subjuntivo y «comprobante»
// no es un pago. Una oración que es pregunta («¿Ya pagaste?») tampoco se toca.
const AFIRMA_RECIBIDO = /(?<![\p{L}])(?:(?:recibimos|hemos\s+recibido|he\s+recibido|recib[ií])\s+(?:ya\s+)?(?:tu|su|el|un)\s+(?:pago|dep[oó]sito|transferencia|abono)s?(?![\p{L}])|(?:pago|dep[oó]sito|transferencia|abono)s?\s+(?:ya\s+)?(?:recibid|acreditad|verificad|confirmad|aprobad|realizad|exitos)[oa]s?(?![\p{L}])|acredit(?:amos|ad[oa]s?|[oó])(?![\p{L}])|(?:tu|su|el)\s+(?:pago|dep[oó]sito|transferencia|abono)\s+(?:ya\s+)?(?:lleg[oó]|fue\s+(?:recibid|acreditad|confirmad)[oa]|se\s+(?:recibi[oó]|acredit[oó]|confirm[oó]))(?![\p{L}])|ya\s+(?:nos\s+)?lleg[oó]\s+(?:tu|su|el)\s+(?:pago|dep[oó]sito|transferencia|abono)(?![\p{L}])|ya\s+pagaste(?![\p{L}])|gracias\s+por\s+(?:tu|su|el)\s+(?:pago|dep[oó]sito|transferencia|abono)(?![\p{L}]))/iu;
// ¿Esta oración afirma un pago? (se juzga sin marcas de formato).
const afirmaPagoOracion = (o) => {
  const s = o.replace(/[*_~]/g, '');
  return AFIRMA_COBRO.test(s) || (!/\?\s*$/.test(s.trim()) && AFIRMA_RECIBIDO.test(s));
};
// ¿Algún tramo del texto afirma un pago? Conserva el criterio de siempre
// (AFIRMA_COBRO sobre el texto entero) y suma el de oración por oración.
const afirmaPago = (t) => AFIRMA_COBRO.test(t.replace(/[*_~]/g, ''))
  || t.split('\n').some((l) => l.split(/(?<=[.!?…])\s+/).some(afirmaPagoOracion));
const DICE_SIMULADO = /(simulad|simulacr|demostraci[oó]n|\bdemo\b|no\s+cobra)/i;
// Negaciones de ser IA (prohibición 4).
const NIEGA_IA = /(no\s+soy\s+(un[ao]?\s+)?(bot|robot|m[aá]quina|programa|inteligencia\s+artificial|\bia\b|asistente\s+virtual|autom[aá]tic[ao])|soy\s+(un[ao]?\s+)?(persona|humano|humana|ser\s+humano)|habl(as|[aá]s|a)\s+con\s+(un[ao]?\s+)?(persona|humano|humana))/i;

const out = [];

for (let i = 0; i < $input.all().length; i++) {
  const item = $input.all()[i];
  // Emparejamiento por índice: nunca .first(), que le pondría el teléfono del
  // primer mensaje a todos los items si llegaran dos a la vez.
  const ent = (entradas[i] ?? entradas[entradas.length - 1]).json;

  // EL MODELO FALLO (Gemini devuelve 500/503 en picos; el agente sigue con
  // `onError: continueRegularOutput` y entrega `error` en vez de `output`).
  // Se distingue de una respuesta vacia: no se despide, no se pide catalogo, no
  // se manda QR ni se confirma un pedido. Lo unico que se ofrece es pasar con
  // una persona (politica del 21/09/2026): texto fijo + boton, en UN mensaje.
  const fallo = item.json.error !== undefined
    || (item.json.output === undefined && item.json.text === undefined);
  const bruto = fallo ? '' : String(item.json.output ?? item.json.text ?? '').trim();
  const enviarQr = /\[ENVIAR_QR\]/i.test(bruto);
  const pedidoConfirmado = /\[PEDIDO_CONFIRMADO\]/i.test(bruto);
  // [TRANSFERIR]: el modelo pide pasar con una persona del negocio. La marca la
  // convierte el codigo en aviso al dueno (una vez por telefono y ventana de
  // 24 h) y en un boton para escribirle directo, dentro del mismo mensaje.
  const pideTransferir = /\[TRANSFERIR\]/i.test(bruto);
  const numeroDuenoLimpio = String(ent.numeroDueno ?? '').replace(/\D/g, '');
  // [ENVIAR_CATALOGO]: el agente pide derivar al catalogo web propio. La marca
  // se obedece SIEMPRE, aunque la configuracion diga que esta apagado: quien
  // decide es el servidor (`enlaceCatalogo` contesta 409 «catalogo web
  // apagado») y el flujo arma el texto honesto con esa respuesta. Un limite
  // que se aplica en dos lugares distintos termina aplicandose mal en uno.
  const pedirCatalogo = /\[ENVIAR_CATALOGO\]/i.test(bruto);
  // [REENVIAR_QR]: el cliente dice que el QR no le llego. Existe porque sin
  // ella el modelo INVENTA (Platinum, 20/09/2026: «el sistema automatico de
  // pagos por QR no esta disponible», que era mentira). Solo vale si hay un QR
  // pendiente de verdad; si no lo hay, la marca se ignora y el turno sigue.
  const reenviarQr = /\[REENVIAR_QR\]/i.test(bruto)
    && String(ent.cobroPendiente || '') === 'si';

  // Quita las marcas conocidas y cualquier otra marca en corchetes que el
  // modelo se haya inventado, para que el cliente nunca las vea.
  let texto = bruto
    .replace(/\[ENVIAR_QR\]/gi, '')
    .replace(/\[PEDIDO_CONFIRMADO\]/gi, '')
    .replace(/\[ENVIAR_CATALOGO\]/gi, '')
    .replace(/\[REENVIAR_QR\]/gi, '')
    .replace(/\[TRANSFERIR\]/gi, '')
    .replace(/\[[A-ZÁÉÍÓÚÑ_ ]{3,30}\]/g, '')
    .trim();

  const avisos = [];
  if (fallo) avisos.push('fallo_modelo');
  // Sin numero del dueno no hay a quien transferir ni boton que dar: la marca
  // se ignora, se deja constancia y el texto no promete nada (filtro PROMESA).
  let transferir = pideTransferir && numeroDuenoLimpio !== '';
  if (pideTransferir && !transferir) avisos.push('transferencia_sin_numero');

  // ¿EL TEXTO VA EN EL PIE DE LA IMAGEN, O APARTE? (23/09/2026)
  //
  // Hasta hoy un turno de cobro costaba DOS mensajes: el texto con el total y,
  // detrás, la imagen del QR con un pie fijo. Son 0,0113 USD de más por cada
  // conversación que llega a pagar, en todos los clientes de venta, por decir
  // en dos mensajes lo que entra en uno («Base comercial» §1: un mensaje largo
  // y completo es más barato que dos cortos).
  //
  // Meta acepta 1.024 caracteres de pie, y `Preparar QR de cobro` agrega sus
  // líneas fijas. El tope de acá es conservador a propósito: si el desglose es
  // largo, el texto sale aparte como antes --dos mensajes-- en vez de recortar
  // el total del cliente. Nunca se trunca lo que el cliente tiene que leer.
  const TOPE_TEXTO_EN_PIE = 700;

  // --- Prohibición 4: el agente no niega ser una IA ---------------------
  if (NIEGA_IA.test(texto)) {
    // Si la empresa le puso nombre al asistente (consola, 15/09/2026), la
    // correccion lo dice; sin nombre, el texto de siempre. Funcion y no cadena
    // de reemplazo: un `$&` dentro del nombre no se expande.
    const quien = String(ent.nombreAsistente ?? '').trim();
    texto = texto.replace(new RegExp(NIEGA_IA.source, 'gi'), () => 'sí, soy ' + (quien ? quien + ', ' : '')
      + 'un asistente virtual con inteligencia artificial');
    avisos.push('correccion_ia');
  }

  // --- Prohibición 3: DOS MODOS EXCLUYENTES, DOS REDES DISTINTAS --------
  //
  // Cuál rige lo decide el servidor y llega en `cobroRealActivo`
  // (`Config del negocio`). No se decide acá y no se mezclan nunca:
  //
  //   SIMULADO -> hay que DECIR que es simulado. El peligro es que un cobro de
  //               mentira parezca de verdad, así que se agrega el rótulo.
  //   REAL     -> hay que NO AFIRMAR un pago. El peligro es el contrario: el
  //               OCR de un comprobante no es una acreditación bancaria, una
  //               imagen se edita, y quien confirma que entró la plata es el
  //               negocio en su banco. Acá el rótulo sería una mentira, así que
  //               en vez de agregar se REESCRIBE la oración que afirma.
  //
  // El prompt dice las dos cosas, pero un prompt no es una barrera: se ignora
  // bajo insistencia y cambia con cada modelo. Esta es la última compuerta.
  const cobroReal = String(ent.cobroRealActivo || '') === 'si';
  if (!cobroReal) {
    // (a) Si sale el QR, el texto que lo acompaña dice que es demostración.
    if (enviarQr && !DICE_SIMULADO.test(texto)) {
      texto = (texto ? texto + '\n\n' : '') + ent.rotuloDemo;
      avisos.push('rotulo_qr');
    }
    // (b) Si se confirma el pedido, la confirmación dice "simulado".
    if (pedidoConfirmado && !DICE_SIMULADO.test(texto)) {
      texto = (texto ? texto + '\n\n' : '') + ent.textoPagoSimulado;
      avisos.push('rotulo_confirmacion');
    }
    // (c) Red de seguridad para CUALQUIER otro camino —reintento del cliente,
    //     mensaje suelto, respuesta fuera de guion— en el que el agente afirme
    //     un cobro sin decir que es simulado.
    if (afirmaPago(texto) && !DICE_SIMULADO.test(texto)) {
      texto = texto + '\n\n' + ent.rotuloDemo;
      avisos.push('rotulo_generico');
    }
  } else {
    // CON DINERO DE VERDAD: la oración que afirma un pago se reemplaza por lo
    // único cierto. Es LETRA POR LETRA la corrección de los flujos de reservas
    // (`Flujos/src/comun/procesar-respuesta.js`), con el mismo regex y el mismo
    // troceado por oración; una prueba exige que las dos sigan siendo iguales.
    // Se juzga sin marcas de formato: «*pago verificado*» también cuenta.
    if (afirmaPago(texto)) {
      const quienRevisa = String(ent.nombreNegocio || '').trim() || 'el negocio';
      const CORRECCION = `El comprobante lo revisa ${quienRevisa} y ellos confirman el pago.`;
      texto = texto.split('\n').map((linea) => linea.split(/(?<=[.!?…])\s+/)
        .map((o) => (afirmaPagoOracion(o) ? CORRECCION : o)).join(' ')).join('\n').trim();
      avisos.push('correccion_cobro');
    }
    // Y NADA DE «SIMULADO» CON UN COBRO REAL: el rótulo diría que un QR que sí
    // cobra no cobra, que es la otra mitad de la prohibición 3. Si el modelo lo
    // escribe igual --porque el prompt viejo se lo enseñó, o porque alarga--, la
    // palabra se quita junto con la oración que la lleva.
    if (DICE_SIMULADO.test(texto)) {
      const sinSimulacro = texto.split('\n').map((linea) => linea.split(/(?<=[.!?…])\s+/)
        .filter((o) => !DICE_SIMULADO.test(o.replace(/[*_~]/g, ''))).join(' ')).join('\n').trim();
      texto = sinSimulacro;
      avisos.push('simulado_quitado');
    }
  }

  // --- SOLO SE OFRECE LO QUE SE CUMPLE (politica de NovuChat, 21/09/2026) ---
  // Lo unico que este flujo cumple es pasar con una persona (aviso al dueno mas
  // boton, ver `Mensaje a enviar`): una promesa de consultar o de avisar despues
  // no la cumple nadie, asi que se quita la oracion. Las preguntas no prometen
  // nada y quedan.
  const PROMESA = /(consult|averigu|pregunt|verific|revis|coordin)[a-záéíóúñ]*\s+(lo\s+|eso\s+)?(con|a)\s+(recepci|la\s+cl[ií]nica|el\s+equipo|el\s+personal|(el|la)\s+(doctor|doctora|dr|dra)(?![a-záéíóúñ])|administraci|caja|alguien|una\s+persona|la\s+empresa|el\s+negocio|mis\s+compa)|(te|le)\s+(avis|escrib|llam|contact|confirm|mand|env[ií]|respond)[a-záéíóúñ]*\s+(?:por\s+(?:aqu[ií]|ac[aá]|este\s+chat|whatsapp)\s+)?(luego|despu[eé]s|m[aá]s\s+tarde|ma[ñn]ana|en\s+cuanto|apenas|pronto|en\s+un\s+rato|en\s+breve|a\s+la\s+brevedad|cuando(?![a-záéíóúñ])(?!\s+(?:me|nos)\s+(?:digas|confirmes|env[ií]es|mandes|escribas|pases)))|(te|le)\s+(avisar|escribir|llamar|contactar|confirmar|responder)([eé]|[aá]n?)(?![a-záéíóúñ])|voy\s+a\s+(consultar|averiguar|preguntar|avisar|escribir|llamar|contactar|confirmar)/i;
  const oraciones = texto.split(/(?<=[.!?…])\s+/);
  const sinPromesas = oraciones.filter((o) => /\?\s*$/.test(o.trim()) || !PROMESA.test(o));
  if (sinPromesas.length < oraciones.length) {
    texto = sinPromesas.join(' ').trim();
    avisos.push('promesa_quitada');
  }

  // UNA RESPUESTA QUE ES SOLO UNA MARCA NO ESTA VACIA (politica del
  // 21/09/2026). Si el modelo escribio unicamente [ENVIAR_CATALOGO], lo que
  // quiso decir es «mira el catalogo»: el mensaje se arma igual en «Enlace del
  // catálogo» y no corresponde el aviso de fallo, que confundiria al cliente.
  if (!texto && pedirCatalogo) {
    texto = 'Te comparto nuestro catálogo para que veas todo lo que tenemos.';
    avisos.push('catalogo_sin_texto');
  }

  const negocio = String(ent.nombreNegocio ?? '').trim() || 'el negocio';
  // AVISO AL DUENO: UNA VEZ POR TELEFONO Y VENTANA DE 24 H (Andres, 02/10/2026).
  // Cada aviso es un mensaje que Meta cobra: un cliente que insiste en hablar
  // con una persona no manda diez avisos. El boton, en cambio, sale siempre:
  // no cuesta mas. El estado va por telefono en `$getWorkflowStaticData`. Aca
  // solo se LEE: la marca la pone `Marcar aviso de transferencia` DESPUES del
  // envio y solo si Meta devolvio un id; un aviso que fallo no cierra la ventana.
  // Dos ejecuciones simultaneas del mismo telefono pueden leer antes de que
  // ninguna marque: eso solo provoca un aviso de mas, nunca uno de menos.
  let avisarDueno = false;
  if (transferir && String(ent.from ?? '') !== numeroDuenoLimpio) {
    const VENTANA_MS = 24 * 60 * 60 * 1000;
    const sd = $getWorkflowStaticData('global');
    sd.avisosTransferencia = sd.avisosTransferencia ?? {};
    const ahora = Date.now();
    for (const k of Object.keys(sd.avisosTransferencia)) {
      if (ahora - Number(sd.avisosTransferencia[k]) >= VENTANA_MS) delete sd.avisosTransferencia[k];
    }
    const previo = Number(sd.avisosTransferencia[ent.from]);
    avisarDueno = !(Number.isFinite(previo) && ahora - previo < VENTANA_MS);
    if (!avisarDueno) avisos.push('aviso_dueno_repetido');
  }
  // «LE AVISO» / «YA LE AVISE» SOLO SI ES CIERTO (regla R4 del plan de entrega,
  // 03/10/2026). El texto al cliente sale ANTES de que el aviso al dueño se
  // intente, asi que ninguna oracion puede anunciarlo: si el aviso falla, el
  // cliente quedaria con una promesa falsa. Se quita lo que el modelo escriba en
  // ese sentido; lo unico que queda es el boton («escribele directo»).
  //   - Futuro y presente («le aviso», «le avisaré», «avisarle», «le estoy
  //     avisando», «el sistema le avisa»): se quitan SIEMPRE, con o sin
  //     transferencia, y tambien si quien escribe es el dueño. «le aviso que…» y
  //     «le aviso:» (presente) son informar, no avisar: quedan.
  //   - Pasado («ya le avisé», «se le avisó», «le notifiqué», «fue avisado»,
  //     «ya está al tanto», «le pasé tu consulta»): se quita salvo que haya una
  //     marca vigente para ESTE telefono. La marca la escribe `Marcar aviso de
  //     transferencia` solo con el id de Meta. «informé»/«comuniqué» solo cuentan
  //     si van a un destinatario o sin complemento («Ya les informé,»); «Como le
  //     informé, el envío cuesta 10 Bs.» y «Le informé el precio» quedan.
  // Con `u` y `(?<![\p{L}])` / `(?![\p{L}])` porque `\b` no ve las vocales con tilde.
  const AVISO_FUTURO = /(?<![\p{L}])(?:(?:le|les)\s+(?:(?:aviso|notifico)(?![\p{L}])(?!\s+que(?![\p{L}])|\s*:)|avisar[eé](?![\p{L}])|avisaremos(?![\p{L}])|avisamos(?![\p{L}])|notificar[eé](?![\p{L}])|estoy\s+avisando(?![\p{L}]))|avisarl[eo]s?(?![\p{L}])|el\s+sistema\s+(?:le\s+|les\s+)?(?:avisa|avisar[aá]|notifica|notificar[aá])(?![\p{L}])|^\s*(?:ahora\s+)?aviso\s+(?:a|al)(?![\p{L}])|(?:estoy|estamos)\s+avisando(?![\p{L}])|(?:le|les)\s+(?:paso|estoy\s+pasando)\s+(?:tu|su)\s+\p{L}+\s+(?:a|al)(?![\p{L}]))/iu;
  const AVISO_PASADO = /(?<![\p{L}])(?:(?<!como\s(?:ya\s)?)(?:le|les|lo|los)\s+(?:(?:avis[eé]|avisó|he\s+avisado|hemos\s+avisado|he\s+notificado|hemos\s+notificado|notifiqu[eé]|pas[eé]\s+(?:tu|el|su)\s+(?:mensaje|pedido|consulta|caso))(?![\p{L}])|(?:inform|comuniqu)[eé](?=\s*(?:[,.;!]|$)|\s+(?:a|al)\s+(?:la\s+|el\s+|un\s+)?(?:negocio|due[ñn][oa]|recepci[oó]n|encargad[oa])(?![\p{L}])|\s+(?:tu|su)\s+(?:pedido|consulta|caso|mensaje|solicitud)(?![\p{L}])))|(?:ya\s+)?(?:avis|notifiqu|inform|comuniqu)[eé]\s+(?:a|al)\s+(?:la\s+|el\s+|un\s+)?(?:negocio|due[ñn][oa]|recepci[oó]n|encargad[oa])(?![\p{L}])|ya\s+(?:avis|notifiqu)[eé](?=\s*[.,;!]|$)|(?<!te\s(?:lo\s|la\s)?)(?:ya\s+)?(?:he|hemos)\s+(?:avisado|notificado|informado)(?![\p{L}])|acabo\s+de\s+(?:avisar|notificar)(?![\p{L}])|(?:pas|mand|envi)[eé]\s+(?:(?:tu|su)\s+[\p{L}]+\s+)?(?:a|al)\s+(?:la\s+|el\s+)?(?:due[ñn][oa]|negocio|recepci[oó]n|encargad[oa])(?![\p{L}])|escrib[ií]\s+(?:a|al)\s+(?:la\s+|el\s+)?(?:due[ñn][oa]|negocio|recepci[oó]n|encargad[oa])(?![\p{L}])|se\s+(?:le\s+|les\s+)?(?:avisó|informó|notificó)(?![\p{L}])|fue(?:ron)?\s+(?:avisad|notificad|informad)[oa]s?(?![\p{L}])|est[aá]n?\s+(?:ya\s+)?(?:avisad|notificad|informad)[oa]s?(?![\p{L}])|(?:ya\s+)?est[aá]n?\s+al\s+tanto(?![\p{L}])|el\s+sistema\s+(?:ya\s+)?(?:le\s+|les\s+)?(?:avisó|notificó)(?![\p{L}]))/iu;
  {
    // Solo se LEE (no se crea nada): sin transferencia el estado no se toca.
    let marcas = {};
    try { marcas = $getWorkflowStaticData('global').avisosTransferencia ?? {}; } catch (e) { marcas = {}; }
    const prevMarca = Number(marcas[ent.from]);
    const marcaVigente = Number.isFinite(prevMarca) && Date.now() - prevMarca < 24 * 60 * 60 * 1000
      && String(ent.from ?? '') !== numeroDuenoLimpio;
    // Linea por linea (un resumen de pedido de varias lineas conserva sus saltos) y,
    // dentro de cada linea, por oracion y antes de cualquier «¿».
    let quitado = false;
    const lineas = texto.split('\n').map((linea) => {
      const trozos = linea.split(/(?<=[.!?…])\s+|;\s+|,?\s*(?=¿)|,\s*(?=(?:ya\s+)?(?:le|les)\s+avis)/u);
      const dejar = trozos.filter((o) => /\?\s*$/.test(o.trim())
        || !(AVISO_FUTURO.test(o) || (!marcaVigente && AVISO_PASADO.test(o))));
      if (dejar.length < trozos.length) quitado = true;
      return dejar.length < trozos.length ? dejar.join(' ').trim() : linea;
    });
    if (quitado) {
      texto = lineas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      avisos.push('aviso_anunciado_quitado');
    }
  }
  let respuestaVacia = false;
  let falloModelo = false;
  if (fallo) {
    // Con numero hay boton, y el texto lo dice; sin numero no se invita a tocar
    // nada que no existe.
    falloModelo = true;
    texto = numeroDuenoLimpio
      ? 'Disculpa, tuve un problema para responderte. Si prefieres, toca el botón y escríbele directo a ' + negocio + '.'
      : 'Disculpa, tuve un problema para responderte. ¿Me lo repites?';
  } else if (!texto && transferir) {
    // Una respuesta que es solo la marca no esta vacia: es «paso con una persona».
    // El texto dice solo lo que este turno cumple: si el aviso va a salir ahora,
    // NO se anuncia (todavia no se sabe si sale): solo el boton. «Ya le avisé» se
    // dice unicamente si la ventana de 24 h ya esta marcada, es decir, si un aviso
    // anterior salio con id de Meta. Y si quien escribe es el propio dueño, no
    // hay a quien avisar y solo se remite al botón.
    texto = String(ent.from ?? '') === numeroDuenoLimpio
      ? 'Para hablar con una persona de ' + negocio + ', toca el botón y escríbele directo.'
      : avisarDueno
        ? 'Para que te atienda una persona de ' + negocio + ', toca el botón y escríbele directo.'
        : 'Ya le avisé a ' + negocio + '; si prefieres no esperar, toca el botón y escríbele directo.';
    avisos.push('transferencia_sin_texto');
  } else if (!texto) {
    texto = 'Disculpa, no pude generar la respuesta. ¿Me lo repites?';
    avisos.push('respuesta_vacia');
    respuestaVacia = true;
  }

  const motivoBruto = /^AVISO_SISTEMA/.test(String(ent.userInput ?? '')) ? '' : String(ent.userInput ?? '').trim();
  const motivo = motivoBruto.length > 200 ? motivoBruto.slice(0, 200) + '…' : motivoBruto;
  // Campo PROPIO: `textoAviso` es el del pedido confirmado y no se comparte. Con
  // [PEDIDO_CONFIRMADO] y [TRANSFERIR] en el mismo turno salen dos avisos
  // distintos, cada uno con su texto (`Aviso de transferencia` lo mapea).
  const textoAvisoTransferencia = avisarDueno
    ? '🔔 NovuChat: el cliente ' + (String(ent.nombrePerfil ?? '').trim() || 'sin nombre de perfil') + ' (' + ent.from
      + ') necesita atención de una persona. Motivo: ' + (motivo || 'no indicado') + '. Escríbele a este número.'
    : '';

  // Se decide con el texto YA saneado: es el que va a viajar.
  // Con transferencia el texto sale por `Mensaje a enviar`, que es quien le
  // pone el boton: no puede viajar en el pie de la imagen.
  const textoEnElQr = enviarQr && !transferir && texto.length <= TOPE_TEXTO_EN_PIE;

  out.push({ json: {
    respuesta: texto,
    enviarQr,
    reenviarQr,
    // Con esto en true, «¿Responder ahora?» NO manda el texto: lo manda
    // «Enviar QR de cobro» en el pie de la imagen, en UN solo mensaje.
    textoEnElQr,
    pedidoConfirmado,
    // Para `Mensaje a enviar` (boton) y `¿Transferir al dueño?` (aviso).
    transferir,
    avisarDueno,
    textoAvisoTransferencia,
    falloModelo,
    respuestaVacia,
    // Con `pedirCatalogo` el texto NO sale por el camino normal: «¿Responder
    // ahora?» lo corta y el mensaje lo arma «Enlace del catálogo» con la
    // direccion adentro, para que el cliente reciba UN SOLO mensaje.
    pedirCatalogo,
    avisos,                       // queda en la ejecución para auditar el ensayo
    from: ent.from,
    nombrePerfil: ent.nombrePerfil,
    // Config arrastrada: los nodos de salida leen $json y no dependen del
    // emparejamiento de items hacia atrás, que se rompe después de un Code.
    phoneNumberId: ent.phoneNumberId,
    numeroDueno: ent.numeroDueno,
    waGraphVersion: ent.waGraphVersion,
    qrMediaId: ent.qrMediaId,
    qrUrl: ent.qrUrl,
    rotuloDemo: ent.rotuloDemo,
    captionQr: ent.captionQr,
    nombreNegocio: ent.nombreNegocio,
    // El modo de cobro y el estado del QR de este teléfono, para los nodos de
    // la rama del QR, que leen `$json` y no vuelven hacia atrás.
    cobroRealActivo: ent.cobroRealActivo,
    cobroPendiente: ent.cobroPendiente,
    cobroQrUrl: ent.cobroQrUrl,
    moneda: ent.moneda,
  }});
}

return out;
