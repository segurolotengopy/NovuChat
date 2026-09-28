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
const DICE_SIMULADO = /(simulad|simulacr|demostraci[oó]n|\bdemo\b|no\s+cobra)/i;
// Negaciones de ser IA (prohibición 4).
const NIEGA_IA = /(no\s+soy\s+(un[ao]?\s+)?(bot|robot|m[aá]quina|programa|inteligencia\s+artificial|\bia\b|asistente\s+virtual|autom[aá]tic[ao])|soy\s+(un[ao]?\s+)?(persona|humano|humana|ser\s+humano)|habl(as|[aá]s|a)\s+con\s+(un[ao]?\s+)?(persona|humano|humana))/i;

const out = [];

for (let i = 0; i < $input.all().length; i++) {
  const item = $input.all()[i];
  // Emparejamiento por índice: nunca .first(), que le pondría el teléfono del
  // primer mensaje a todos los items si llegaran dos a la vez.
  const ent = (entradas[i] ?? entradas[entradas.length - 1]).json;

  const bruto = String(item.json.output ?? item.json.text ?? '').trim();
  const enviarQr = /\[ENVIAR_QR\]/i.test(bruto);
  const pedidoConfirmado = /\[PEDIDO_CONFIRMADO\]/i.test(bruto);
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
    .replace(/\[[A-ZÁÉÍÓÚÑ_ ]{3,30}\]/g, '')
    .trim();

  const avisos = [];

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
    if (AFIRMA_COBRO.test(texto) && !DICE_SIMULADO.test(texto)) {
      texto = texto + '\n\n' + ent.rotuloDemo;
      avisos.push('rotulo_generico');
    }
  } else {
    // CON DINERO DE VERDAD: la oración que afirma un pago se reemplaza por lo
    // único cierto. Es LETRA POR LETRA la corrección de los flujos de reservas
    // (`Flujos/src/comun/procesar-respuesta.js`), con el mismo regex y el mismo
    // troceado por oración; una prueba exige que las dos sigan siendo iguales.
    // Se juzga sin marcas de formato: «*pago verificado*» también cuenta.
    if (AFIRMA_COBRO.test(texto.replace(/[*_~]/g, ''))) {
      const quienRevisa = String(ent.nombreNegocio || '').trim() || 'el negocio';
      const CORRECCION = `El comprobante lo revisa ${quienRevisa} y ellos confirman el pago.`;
      texto = texto.split('\n').map((linea) => linea.split(/(?<=[.!?…])\s+/)
        .map((o) => (AFIRMA_COBRO.test(o.replace(/[*_~]/g, '')) ? CORRECCION : o)).join(' ')).join('\n').trim();
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
  // Este flujo no tiene a nadie a quien pasar la conversacion: una promesa de
  // consultar o de avisar despues no la cumple nadie, asi que se quita la
  // oracion. Las preguntas no prometen nada y quedan.
  const PROMESA = /(consult|averigu|pregunt|verific|revis|coordin)[a-záéíóúñ]*\s+(lo\s+|eso\s+)?(con|a)\s+(recepci|la\s+cl[ií]nica|el\s+equipo|el\s+personal|(el|la)\s+(doctor|doctora|dr|dra)(?![a-záéíóúñ])|administraci|caja|alguien|una\s+persona|la\s+empresa|el\s+negocio|mis\s+compa)|(te|le)\s+(avis|escrib|llam|contact|confirm|mand|env[ií]|respond)[a-záéíóúñ]*\s+(luego|despu[eé]s|m[aá]s\s+tarde|ma[ñn]ana|en\s+cuanto|apenas|pronto|en\s+un\s+rato|en\s+breve|a\s+la\s+brevedad)|(te|le)\s+(avisar|escribir|llamar|contactar|confirmar|responder)([eé]|[aá]n?)(?![a-záéíóúñ])|voy\s+a\s+(consultar|averiguar|preguntar|avisar|escribir|llamar|contactar|confirmar)/i;
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

  if (!texto) {
    texto = 'Disculpa, no pude generar la respuesta. ¿Me lo repites?';
    avisos.push('respuesta_vacia');
  }

  // Se decide con el texto YA saneado: es el que va a viajar.
  const textoEnElQr = enviarQr && texto.length <= TOPE_TEXTO_EN_PIE;

  out.push({ json: {
    respuesta: texto,
    enviarQr,
    reenviarQr,
    // Con esto en true, «¿Responder ahora?» NO manda el texto: lo manda
    // «Enviar QR de cobro» en el pie de la imagen, en UN solo mensaje.
    textoEnElQr,
    pedidoConfirmado,
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
