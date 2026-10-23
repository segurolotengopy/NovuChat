// =============================================================================
// FILTRO DE LA REDACCIÓN DEL MODELO (prefijo `cm`): lo que el modelo escribe NO sale sin pasar por aquí
// =============================================================================
// Se pega DELANTE del código de un nodo Code (marca `@@comun+filtro:…` o `@@solo+filtro:…`). Autosuficiente:
// no usa funciones `cn*` ni lee nada. Principio del flujo «sin agente»: el código calcula y el modelo conversa;
// cuando el modelo redacta, el código VERIFICA lo redactado y, si algo falla, lo descarta y usa un texto fijo.
// Ninguna regla es una instrucción al modelo: una instrucción se ignora bajo insistencia (CLAUDE.md).
//
// Sacado de `agenda-minima/src/nodos/armar-mensajes.js` (que sigue con sus copias), SIN lo que es de un negocio:
// ni lo clínico ni las horas de una agenda ni nombres de personas. Eso entra por `opciones`.
//
//   cmMotivoDeRechazo(texto, opciones) -> '' si el texto puede salir, o el MOTIVO del rechazo
//   cmRedaccionValida(texto, opciones) -> true/false
//   cmPulirRedaccion(texto, opciones)  -> el texto sin saludo repetido, sin muletillas y con el nombre del negocio bien escrito
//
// opciones de `cmMotivoDeRechazo` (todas opcionales):
//   maximo            largo máximo (900)
//   permitirMontos    false por defecto: un MONTO nunca sale de la redacción, lo dice el código con su cifra
//   enlacesPermitidos los enlaces COMPLETOS del negocio; por defecto NINGÚN enlace sale (null apaga la revisión)
//   quienPromete      sujetos (ya normalizados) cuyo «<sujeto> te…» es una promesa: ['recepcion', 'el doctor']
//   prohibidos        regex extra, probadas contra el texto NORMALIZADO (minúsculas y sin tildes)
//   textoDelCliente   lo que preguntó el cliente: a una pregunta de IDENTIDAD no se contesta empezando con «Sí»
//   sinImagenes       true: el flujo NO envía imágenes; «te muestro / envío fotos, capturas, la portada…» es una promesa sin respaldo
//                     y se rechaza con el motivo `promete_imagenes`. Apagado por defecto (hay flujos que sí envían imágenes)
//   maxOraciones      tope de oraciones (apagado): motivo `largo_en_oraciones`; pulir recorta y conserva la pregunta final
//   sinDatosDePago    true: ningún dato de pago lo escribe el modelo (cuenta, banco, Tigo Money, Yape, QR, «deposita/paga…»): `datos_de_pago`
//   sinAfirmarCompra  true: no afirma compra ni entrega («ya compraste», «ya te llegó», «te lo enviamos»); una pregunta no afirma: `afirma_compra`
//   sinPromesasDeAviso true: «un asesor se comunicará», «te avisaremos/llamaremos…»: `promete_aviso`. `avisoRespaldado: true` (el flujo SÍ avisa) permite
//                     «le avisamos al equipo/recepción/asesor» solo si cierra la oración y no promete contactar al cliente
//   extra             funciones (texto, normalizado) => motivo ('' si pasa): las reglas propias del flujo (horas, etc.)
// Las promesas sin respaldo, afirmar un hecho que solo el código puede afirmar (quedó agendado, pago acreditado…),
// negar ser una IA y los huecos de plantilla se revisan SIEMPRE, y no se pueden apagar.

function cmNorm(t) {
  // NFKC junta las formas de ancho completo («ｑｕｅｄó» → «quedó»); se quitan los caracteres invisibles (U+200B a U+200D,
  // U+2060, U+FEFF), el guion blando, los selectores de variación y las etiquetas U+E0000 a U+E007F (todo \p{Cf}), que partían una palabra sin que se viera («agen​dé»).
  return String(t === undefined || t === null ? '' : t).normalize('NFKC').replace(/[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu, '').replace(/\u2800/g, ' ').replace(/[。｡]/g, '.')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
// El texto SIN los guiones, puntos y asteriscos que parten una palabra para esconderla («agen-dada», «a.gen.dé»).
function cmJunto(n) {
  return n.replace(/(\p{L})[-.·_*]+(?=\p{L})/gu, '$1');
}
// Letras sueltas separadas por espacios, guiones o puntos («p a g o», «p. a. g. o», «p-a-g-o»): se juntan las rachas de 3 o más
// letras sueltas. Se usa JUNTO con el texto sin tocar (nunca en lugar de él), así que no rompe montos ni teléfonos (no son letras).
function cmJuntoLetras(n) {
  return cmJunto(n.replace(/(?<![\p{L}\p{N}])\p{L}(?:[\s\-.·_*]+\p{L}(?![\p{L}\p{N}])){2,}/gu, (m) => m.replace(/[\s\-.·_*]+/g, '')));
}
// Homoglifos: una palabra que mezcla letras latinas con otro alfabeto (cirílico, griego…) esconde otra palabra («pаgo» con una
// «а» cirílica). El español no los usa; se rechaza el texto entero. No toca emojis, signos ni números.
function cmAlfabetoMixto(texto) {
  const palabras = String(texto || '').normalize('NFKC').match(/[\p{L}\p{M}]+/gu) || [];
  return palabras.some((w) => /\p{Script=Latin}/u.test(w) && /[^\p{Script=Latin}\p{M}\p{Script=Common}\p{Script=Inherited}]/u.test(w));
}
// «Política: el asistente solo ofrece lo que el flujo cumple»: ninguna promesa sin un mecanismo detrás.
const CM_PROMESAS = /lo consulto|lo consultar[eé]|consultar[eé]|\b(te|le) avis(o|ar[eé]|amos)\b|\b(te|le) llam(amos|ar[eé]|aremos)\b|te vamos a (llamar|avisar|escribir|contactar)|te van a (llamar|contactar|escribir|avisar)|te escribir[aá]n|te escribiremos|\b(te|le) contactar[eé]|nos comunicaremos|\b(te|le) confirm(o|ar[eé]) (luego|despues|mas tarde|manana)|te confirmar[eé]/;
// Lo que SOLO el código puede afirmar. Por defecto se rechaza todo lo que SUENA a confirmación: un falso rechazo
// cae en el texto fijo del código (barato); un falso «quedó agendada» es una cita que no existe (CLAUDE.md).
//   - participios de lo que el código hace o confirma: agendada, reservado, registrado, confirmada, anotado,
//     reprogramada, cancelada, acreditado, aprobado, verificado, pagado, recibido (de un pago)…
//   - primera persona: «agendé», «reservé», «registré», «confirmé», «anoté», «reprogramé», «he reservado»…
//   - el pago: «recibimos tu pago», «pago recibido/acreditado/aprobado», «tu pago fue…»
//   - marcas de visto bueno que pone el código: ✅ ✔ ☑
// Y negar ser una IA (prohibición 4: NUNCA): «no soy un bot / una máquina / un asistente», «soy una persona»,
// «hablas con una persona», «persona real», «de carne y hueso».
// Medios y sustantivos del pago. Medios que existen en Bolivia: QR simple, transferencia, Tigo Money, tarjeta, efectivo y depósito.
// (Nequi y PIX no existen aquí y no se listan. Yape SÍ existe y es una de las billeteras más grandes y difundidas de Bolivia: la lista de abajo no la
// nombra porque es solo para AFIRMAR un pago, pero la opción `sinDatosDePago` la bloquea.)
// Formas EXPLÍCITAS (nunca `pag\w*`: «página» no es un pago) y sin `cancel*` (cancelar una suscripción no es pagar; «cancelaste/cancelamos/cancelaron» tienen su regla).
// «abono» (también fertilizante) y «cobro» solo cuentan junto a un estado o verbo de recepción.
const CM_PAGO = '(?:pagos?|pag|pagad[oa]s?|pagar|pagas?|pagan|pague|pagaste|pagamos|pagaron|comprobantes?|abonos?|abonad[oa]s?|abonar|abonaste|abonamos|abonaron|cobros?|cobrad[oa]s?|cobrar|cobramos|cobraron|plata|dinero|depositos?|transferencias?|qr|tigo ?money|tarjeta|efectivo|vouchers?|bs|bolivianos)';
const CM_PAGO_HECHO = '(?:pagos?|pag|pagad[oa]s?|pagar|pagas?|pagan|pague|pagaste|pagamos|pagaron|comprobantes?|abonos?|abonad[oa]s?|abonar|abonaste|abonamos|abonaron|plata|dinero|depositos?|transferencias?|vouchers?)';
const CM_ESTADO = '(?:recibid|acreditad|aprobad|aceptad|procesad|completad|confirmad|verificad|registrad|validad|saldad|exitos|llego|llegaron|entro|entraron|ingreso|ingresaron|cayo|cayeron|reflej|se (?:acredit|proces|complet)|esta\\w* (?:en orden|ok|bien|list|acreditad|correct|completo|conforme|al dia|en (?:la|mi|nuestra|su) cuenta)|entra\\w* en (?:el|nuestro|mi) sistema|ya paso\\b(?! (?:a|al|con|tu|el|la|los|su)\\b)|(?:es|son|sea|seran) (?:valid|correct|ok\\b)|en orden)';
const CM_VERBO_RECEPCION = '(?:recib(?:i\\w*|ido|ida|idos|idas)|llego\\w*|llegaron|entro|entraron|ingreso|ingresaron|registramos|verificamos|validamos|vi|vimos|veo|vemos|vio|revise|revisamos|cayo|cayeron|cae|reflej\\w*)';
// Una PREGUNTA no afirma («¿Ya recibiste el QR?»): se exime solo si hay «¿» antes Y «?» después en la misma oración. Un «¿» suelto no exime.
const CM_NO_PREGUNTA = '(?:(?<!¿[^?.!]*)|(?![^?.!¡¿]*\\?))';
// Lo que SOLO puede afirmar el código se rechaza AUNQUE el cliente no lo haya pedido y aunque la frase diga algo cierto («Tu comprobante llegó y
// los datos coinciden» es del código, no del modelo). Una negación cercana («todavía NO llegó») no es afirmar.
const CM_SIN_NEGAR = '(?:(?!\\bno\\b)[^.!?])';
const CM_AFIRMA_LISTA = [
  // participios de lo que el código hace o confirma, y la primera persona (singular y plural), en pasado y presente
  '\\b(agendad|reservad|registrad|confirmad|anotad|reprogramad|programad|cancelad|acreditad|aprobad|verificad|validad|pagad|separad)[oa]s?\\b',
  '\\b(agende|reserve|registre|confirme|anote|reprograme|programe|cancele|cambie|separe|valide|acredite)\\b',
  '\\b(agend|reserv|registr|confirm|anot|reprogram|program|cancel|acredit|valid|separ)(amos|aron)\\b',
  '\\b(te|le|lo|la) (agendo|reservo|registro|confirmo|anoto|programo|separo|reprogramo|cancelo|valido|acredito)\\b',
  '\\bse (agendo|reservo|registro|confirmo|anoto|programo|separo|reprogramo|cancelo|valido|acredito|aprobo|cambio)\\b',
  '\\b(qued[oa]|esta|estan|fue|fueron|ha sido|han sido) (list|hech|fij|recib|ya)[oa]s?\\b',
  '\\bya (se|te|le) (agend|reserv|registr|confirm|anot|program|separ|acredit)',
  // el pago: el comprobante no es una acreditación bancaria (prohibición 3). Raíces y plurales, en el contexto de AFIRMAR un hecho
  // (recibido, llegó, está en orden…): NO se bloquea toda mención del pago («puedes pagar con QR», «envíame el comprobante»).
  '(?=\\b' + CM_PAGO + '\\b)' + CM_NO_PREGUNTA + '\\b' + CM_PAGO + '\\b' + CM_SIN_NEGAR + '{0,25}\\b' + CM_ESTADO,
  '(?=\\b' + CM_VERBO_RECEPCION + '\\b)' + CM_NO_PREGUNTA + '\\b' + CM_VERBO_RECEPCION + '\\b[^.!?]{0,30}\\b' + CM_PAGO + '\\b',
  '\\b(?:tenemos|tengo) (?:ya |aqui )?(?:tu|tus|su|sus|el|los|la|las|mi|mis) (?:\\w+ )?(?:' + CM_PAGO_HECHO + '|montos?)\\b',
  // figura / aparece / ya pasó / «ya hiciste el pago» / saldo cero / dinero en símbolos / «¿Ya pagaste? Sí, ya está»
  '\\b' + CM_PAGO_HECHO + '\\b' + CM_SIN_NEGAR + '{0,25}\\b(?:figur|aparec)',
  '\\b(?:figur|aparec)\\w*\\b[^.!?]{0,25}\\b' + CM_PAGO_HECHO + '\\b',
  '\\bya paso\\b[^.!?]{0,15}\\b' + CM_PAGO_HECHO + '\\b',
  '\\b(?:ya )?(?:hiciste|hicimos|hizo) (?:el|tu|un|su|la) (?:\\w+ )?pago\\b',
  '\\bsaldo (?:en |a )?cero\\b',
  '(?=\\b' + CM_VERBO_RECEPCION + '\\b)' + CM_NO_PREGUNTA + '\\b' + CM_VERBO_RECEPCION + '\\b[^.!?]{0,30}(?:\\$|\\bdolares?\\b|\\busdt?\\b)',
  '\\b(?:pag|cancel|abon|deposit|transferencia|comprobante|qr|plata|dinero)\\w*[^?]{0,30}\\?\\W*(?:(?:si|claro|ok|listo)\\W{1,3})?ya esta\\b',
  // el sustantivo del pago PEGADO a su visto bueno: «Pago OK», «Pago: listo», «Pago 👍», «Comprobante hecho»
  '\\b' + CM_PAGO_HECHO + '(?:[\\s:\\-]{1,3}(?:ok|okay|okey|listo|lista|hecho|hecha|completo|completa|correcto|correcta|valido|valida)\\b(?!\\?)|[\\s:\\-]{0,3}(?:👍|👌|🆗))',
  '\\b(?:listo|lista|hecho)\\W{0,3}(?:tu|tus|su|sus|el|los|la|las)\\s+(?:\\w+ )?' + CM_PAGO_HECHO + '\\b',
  '\\bya esta (?:tu|tus|su|sus|el|los|la|las)\\s+(?:\\w+ )?' + CM_PAGO_HECHO + '\\b',
  '\\b(?:todo|esta|estan) (?:en orden|ok|bien|correcto|perfecto)\\b[^.!?]{0,6}\\bcon (?:tu|tus|el|los|la|las|su|sus) (?:\\w+ )?(?:' + CM_PAGO_HECHO + '|qr)\\b',
  '\\bgracias por (?:haber |ya )?(?:(?:tu|tus|su|sus|el|los|la|las|mi) (?:\\w+ )?' + CM_PAGO_HECHO + '|pagar|pagado|cancelar|cancelado|abonar|abonado)\\b',
  '\\brecibid[oa]s?[,.!:\\s]+(?:muchas )?gracias\\b',
  '\\b(?:ok|okay|listo|perfecto|bien|vale|genial)[,.!:\\s]+recibid[oa]s?\\b',
  '^\\W*recibid[oa]s?\\W*$',
  '\\b(?:transaccion(?:es)?|operacion(?:es)?)\\b[^.!?]{0,25}\\b(?:exitos|aprobad|acreditad|completad|procesad|realizad|correct|ok\\b)',
  '\\bsaldad[oa]s?\\b',
  '\\bno (?:debes|debe|adeudas|adeuda) (?:nada|ningun)',
  '(?:💰|💵|💸|🤑)[^.!?]{0,15}\\b(?:recibid|acreditad|llego|ok\\b|listo|confirmad)',
  '\\b(?:recibid|acreditad|llego)\\w*[^.!?]{0,15}(?:💰|💵|💸)',
  // «cancelar» es PAGAR en Bolivia; «pagaste/pagamos» afirma un pago salvo en pregunta («¿ya pagaste?» o «…el envío?») o condicional («si pagaste»)
  '(?=\\b(?:cancelaste|cancelamos|cancelaron|pagaste|pagamos|pagaron)\\b)(?<!¿[^?.!]*)(?![^?.!¡¿]*\\?)(?<!\\b(?:si|cuando|apenas|despues de que) (?:ya )?)\\b(?:cancelaste|cancelamos|cancelaron|pagaste|pagamos|pagaron)\\b',
  '\\bpago (exitoso|validado|aprobado|confirmado|acreditado|recibido)\\b',
  '\\bconfirm(o|amos) (tu|la|su|el) (cita|reserva|pedido|pago)\\b',
  '(?=\\btu )' + CM_NO_PREGUNTA + '\\btu (cita|reserva|pedido|pago) (ya )?(esta|quedo|queda|fue|ha sido)\\b',
  // marcas de visto bueno: las pone el código
  '[✅✔✓☑]',
  // en inglés
  '\\b(booked|confirmed|scheduled|reserved|payment (received|confirmed))\\b',
  '\\bpaid\\b',
  '\\bpayment\\b[^.!?]{0,15}\\b(?:ok|okay|done|complete\\w*|approved|accepted|processed|verified|successful|settled)\\b',
  '\\b(?:got|received|have|has) your (?:payment|transfer|deposit|money)\\b',
  // negar ser una IA (prohibición 4: NUNCA): «no soy un bot», «esto no es un bot», «soy real», «hablas con una persona»…
  '\\bno (soy|es|eres|sos|estas hablando con|hablas con|estoy)\\b[^.!?]{0,20}\\b(ia|inteligencia|bot|chatbot|robot|maquina|programa|asistente|virtual|sistema|automatic\\w*)\\b',
  '\\bno (soy |es |eres |sos )?automatic\\w*',
  '\\b(no|ni) (un|una) (bot|chatbot|ia|robot|maquina|programa|sistema)\\b',
  // «soy Rubén, no un asistente», «no el asistente virtual», «no un agente virtual», «no un sistema»
  '\\b(no|ni) (un |una |el |la )?(asistente|agente|ayudante|sistema)( virtual)?\\b',
  '\\b(no|ni) (un |una |el |la )virtual\\b',
  '\\b(no hay|nada de) (bots?|robots?|chatbots?|maquinas?|ia)\\b',
  '\\bno te (contesta|responde|atiende|escribe|habla) (un|una)\\b',
  '\\b(atiende|atiendo|habla|hablas|contesta|responde|escribe|conmigo|soy)\\b[^.!?]{0,25}\\ben persona\\b',
  '^\\W*no[,;]?\\W+soy\\b(?![^.!?]{0,30}\\b(?:asistente|virtual)\\b)',
  '\\b(para nada|nunca|jamas|tampoco|ni de lejos|de ninguna manera)\\b[^.!?]{0,15}\\b(soy|es|eres|sos|estoy)\\b[^.!?]{0,20}\\b(ia|inteligencia|bot|chatbot|robot|maquina|programa|asistente|virtual|sistema|automatic\\w*)\\b',
  '\\bsoy (una |un )?(persona|humana|humano|ser humano|real|de verdad)\\b',
  '\\b(hablas|estas hablando|conversas|chateas) con (una |un )?(persona|humano|humana)\\b',
  '\\b(te )?(responde|escribe|atiende|contesta|habla) (una |un )?(persona|humano|humana)\\b',
  '\\bpersona (real|de verdad)\\b',
  'carne y hueso',
];
const CM_AFIRMA = new RegExp(CM_AFIRMA_LISTA.join('|'));
// Copia SOLO para comparar: el mismo patrón con las letras repetidas colapsadas («llego» → «lego»), para el texto colapsado («paaago» → «pago»).
// Las barras de escape se respetan (`\\b` + «bot» no es «bb»).
function cmColapsa(t) {
  return String(t).replace(/\\.|(\p{L})\1+/gsu, (m, l) => (l ? l : m));
}
const CM_AFIRMA_C = new RegExp(cmColapsa(CM_AFIRMA_LISTA.join('|')));
// Cifras dentro de una palabra con letras → su letra («pag0» → «pago», «p4go» → «pago»). Solo en la copia de comparar: montos, teléfonos y horas
// (cifras sin letras pegadas) no cambian, y las reglas de monto no miran esta copia.
function cmLeet(t) {
  return t.replace(/(?<=\p{L})[0134]|[0134](?=\p{L})/gu, (d) => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a' }[d]));
}
const CM_PALABRA_DE_NUMERO = 'un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|quinientos|mil|medio';
const CM_MONTO = new RegExp('\\b\\d[\\d.,]*\\s*(bs|bob|bolivianos?|usd|usdt|dolar(es)?|\\$us)\\b|\\b(?:bs|bob|usd)\\.?\\s*\\d|\\$\\s*\\d|\\b(?:' + CM_PALABRA_DE_NUMERO + ')\\s+(bolivianos?|dolar(es)?|bs|bob|usdt)\\b');
// Promesa de IMÁGENES sin respaldo (opción `sinImagenes`): «te muestro / envío / comparto…» o «puedo mostrar…», «aquí tienes», «te dejo»,
// «adjunto» cerca de una foto, captura, portada, vista previa o ejemplo visual. Se prueba sobre el texto normalizado.
const CM_PROMETE_IMAGENES = /\b(te (muestro|envio|mando|comparto|paso|adjunto|enviare|mandare|mostrare|compartire)|(puedo|podria|podemos|voy a|vamos a) (mostrar|enviar|mandar|compartir|pasar|adjuntar)(te|les|le)?|aqui (tienes|te dejo)|te dejo|adjunto|enviare|mandare|mostrare|compartire)\b[^.?!]{0,40}\b(imagen|imagenes|foto|fotos|fotografia|fotografias|captura|capturas|pantallazo|pantallazos|screenshot|screenshots|portada|detalles visuales|ejemplos visuales|vista previa)\b/;
// ---- Reglas OPT-IN (apagadas por defecto), sobre cuatro formas del texto y su copia colapsada.
function cmDuo(fuentes) { const f = fuentes.join('|'); return [new RegExp(f), new RegExp(cmColapsa(f))]; }
function cmVariantes(s) {
  const base = cmNorm(s);
  const sp = cmNorm(String(s).replace(/[ \t\u00a0]{2,}|\n+/g, ' , '));
  const nlc = cmJuntoLetras(cmLeet(sp));
  return [base, cmJunto(base), cmJuntoLetras(sp), nlc, cmJunto(cmColapsa(base)), cmColapsa(nlc)];
}
function cmHay(duo, vars, sinPreguntas) {
  return vars.some((v, i) => (sinPreguntas ? cmOraciones(v).filter((x) => x.indexOf('?') < 0) : [v]).some((x) => duo[i > 3 ? 1 : 0].test(x)));
}
const CM_VERBO_PAGO = '(?:pag(?:ar(?:lo|la|me|nos)?|a(?:lo|la|me)?(?! (?:dividendos|intereses|beneficios))|as|ues?|uen|uelo)|abon(?:ar|a|as|an|e|es|en)\\w*|deposit(?:ar|a|e|en)\\w*|transfi(?:ere|eres|era|eran)\\w*|transferir\\w*)';
const CM_MEDIO_PAGO = '(?:bancos?|cuentas?|tarjetas?|efectivo|depositos?|bnb|bcp|bisa|fassil|mercantil|union|ganadero|fie|prodem|economico)';
const CM_DATOS_PAGO = cmDuo([
  '\\b' + CM_VERBO_PAGO + '\\b',
  '\\b(?:tigo[ ,]{0,3}money|billeteras?|alias|transferencias?|codigos? qr|qr|bcp|bnb|fassil|prodem|ecofuturo|yap(?:e|ea)\\w*)\\b',
  '\\b(?:por|via|mediante|con) (?:un )?giros?\\b|\\bgiros? (?:bancario|postal|de dinero|de plata)\\b|\\b(?:hacer|haz|haga|realiza\\w*|envia\\w*|manda\\w*) (?:un |el |tu )?giros?\\b',
  '\\bgir(?:a|ar|e|alo)\\w* (?:el |tu |la |un |lo |su )?(?:dinero|plata|pago|monto|saldo)\\b',
  '\\bcuentas? (?:bancarias?|corrientes?|de ahorros?|de banco)\\b|\\bcuentas?\\b[^.!?]{0,15}\\bbancos?\\b',
  '\\b(?:numero|nro|num) (?:de )?cuenta\\b',
  '\\b(?:formas?|metodos?|medios?|datos|link|enlace) de pago\\b|\\bdatos (?:bancarios|para (?:el |la |tu )?(?:pago|deposito|transferencia|abono)|del? (?:pago|deposito|cuenta))\\b',
  '\\bcuenta\\b[^.!?]{0,20}\\d{4,}|(?<!\\d)\\d{4,}[^.!?]{0,15}\\bcuenta\\b',
  '\\b' + CM_MEDIO_PAGO + '\\b[^.!?]{0,30}\\b' + CM_VERBO_PAGO + '\\b',
  '\\bcancel\\w*\\b[^.!?]{0,25}\\b(?:efectivo|transferencia|tarjeta|qr|banco|cuenta|deposito|tigo|yape)\\b',
  '\\b(?:envia|manda|pas)\\w* (?:me |nos )?(?:el |tu |la |un |lo |su )?(?:dinero|plata|pago|monto|saldo)\\b',
  '\\b(?:haz|hacer|realiza|realizar|haga|realice|hacen) (?:el |tu |la |un |una |su )?(?:pago|deposito|transferencia|abono)\\b',
  '\\bescane\\w* (?:el |este |ese |mi )?(?:codigo|qr)\\b',
]);
const CM_AFIRMA_COMPRA = cmDuo([
  '\\bya (?:compraste|adquiriste|pediste|pidio|ordenaste|recibiste)\\b',
  '\\bya (?:hiciste|hizo|realizaste|realizo|hicimos) (?:tu |el |su |un |la )?(?:pedido|compra|orden)\\b',
  '\\bya (?:te|le|se) (?:llego|llegaron|enviamos|mandamos|entregamos|despachamos|envio|mando|entrego|despacho|enviaron|mandaron|entregaron)\\b',
  '\\bya (?:despachamos|enviamos|mandamos|entregamos|envie|mande|despache|entregue)\\b',
  '\\bya (?:tienes|tiene|tenes) (?:tu |el |su |la |los |las )?(?:\\w+ )?(?:libros?|pedido|compra|producto|paquete|acceso)\\b',
  '\\bya (?:lo|la|los|las) (?:tienes|tiene|recibiste|recibio)\\b',
  '\\bya (?:fue|esta|estan|quedo|ha sido|salio)\\b[^.!?]{0,12}\\b(?:enviad|entregad|despachad|mandad|camino|salio)',
  '\\b(?:tu|su|el|la) (?:pedido|compra|orden|libro|paquete)\\b[^.!?]{0,10}\\bya salio\\b',
  '\\b(?:te|le) (?:envie|mande|entregue|despache)\\b',
  '\\b(?:acabo|acabamos) de (?:enviar|mandar|entregar|despachar)',
  '\\b(?:te|le|se) (?:lo|la|los|las) (?:enviamos|mandamos|entregamos|despachamos|enviaron|mandaron|entregaron|enviare|enviaremos|mandaremos|entregaremos|hacemos llegar|haremos llegar)\\b',
  '\\b(?:te|le) (?:enviamos|mandamos|entregamos|despachamos|enviaremos|mandaremos|entregaremos) (?:tu |el |su |la |los |las )',
  '\\b(?:tu|su|el|la) (?:pedido|compra|orden|libro|envio|paquete|encomienda|entrega)\\b[^.!?]{0,25}\\b(?:fue|esta|estan|ha sido|quedo|ya)\\b[^.!?]{0,15}\\b(?:entregad|enviad|mandad|despachad|confirmad|procesad|completad|recibid|realizad|list|camino|aprobad|registrad|exitos)',
  '\\b(?:tu|su|el|la) (?:pedido|compra|libro|paquete|envio)\\b[^.!?]{0,15}\\b(?:llego|llegaron|va en camino|viene en camino)\\b',
  '\\b(?:vas a|va a|vamos a) recibir\\b[^.!?]{0,20}\\b(?:libro|pedido|compra|paquete|material|pdf|bonos?)\\b|\\brecibiras?\\b[^.!?]{0,20}\\b(?:libro|pedido|compra|paquete|material|pdf|bonos?)\\b',
  '\\b(?:te|le) llegara\\b|\\b(?:pedido|libro|paquete|compra|material) llegara\\b',
  '\\bcompra (?:confirmada|exitosa|realizada|completada|aprobada|registrada|procesada)\\b',
  '\\bgracias por (?:comprar|haber comprado|adquirir)\\b',
  '\\b(?:gracias|felicidades|felicitaciones)\\b[^.!?]{0,15}\\b(?:por|de) (?:tu|su|la|haber)\\b[^.!?]{0,15}\\b(?:compra|comprado|adquirido|pedido)\\b',
]);
const CM_PROMETE_AVISO = cmDuo([
  '\\bse (?:comunicara|comunicaran|contactara|contactaran|pondra|pondran)\\b',
  '\\b(?:te|le|les|lo|la) (?:llamara|llamaran|escribira|escribiran|contactara|contactaran|respondera|responderan|avisara|avisaran|buscara|buscaran|marcara)\\b',
  '\\b(?:te|le|les) (?:llamare|llamaremos|escribire|escribiremos|avisare|avisaremos|contactare|contactaremos|buscare|buscaremos|respondere|responderemos|marcare|hare llegar|haremos llegar)\\b',
  '\\b(?:te|le|les) (?:informar|notificar|mantendr|dar)(?:e|emos|a|an) (?:al tanto|informad\\w+|seguimiento)\\b|\\b(?:te|le|les) (?:informar|notificar)(?:e|emos|a|an)\\b|\\bdar\\w* seguimiento\\b',
  '\\b(?:te|le|les) (?:escribe|escribo|escribimos|escriben|contacta|contacto|contactamos|contactan|responde|respondo|respondemos|responden|llama(?! la atencion)|llamo|llamamos|llaman|busca|busco|buscamos|buscan)\\b',
  '\\b(?:recibiras|recibira) (?:una |un )?(?:llamada|mensaje|correo|respuesta|whatsapp)\\b',
  '\\b(?:quedamos|seguimos) en contacto\\b',
  '\\bpara que (?:te|le|lo) (?:llame|escriba|contacte|responda|busque|atienda|llamen|escriban|contacten)\\b',
  '\\bya (?:le|les) (?:pase|pasamos|di|dimos) (?:tu|su) (?:numero|contacto|telefono|whatsapp)\\b',
  '\\b(?:nos|me) (?:pondremos|pondre|comunicaremos|contactaremos)\\b',
  '\\b(?:te|le|les) (?:vamos|voy|van|va) a (?:llamar|escribir|avisar|contactar|responder|buscar)\\b',
  '\\bestaremos en contacto\\b',
  '\\b(?:comunicara|comunicaran|contactara|contactaran|llamara|llamaran|escribira|escribiran)\\b[^.!?]{0,15}\\bcontigo\\b',
  '\\b(?:te|le) (?:aviso|avisamos)\\b',
]);
// Aviso AL EQUIPO permitido (avisoRespaldado): solo si cierra la oración y no promete contactar al cliente.
const CM_AVISO_AL_EQUIPO = /\b(?:le|les) avis\w+ (?:al|a la|a los|a las|a) (?:equipo|negocio|recepcion|asesor\w*|doctor\w*|encargad\w*)(?=[\s.!?]*$)/;
const CM_PROMETE_RESTO = /\b(?:te|le|lo|la)\s+(?:llam|escrib|contact|respond|busc|atiend)\w*|\bpara que\b|\bque te\b/;
function cmSinAvisoAlEquipo(n) {
  return cmOraciones(n).map((x) => {
    const q = x.replace(CM_AVISO_AL_EQUIPO, '');
    return q !== x && !CM_PROMETE_RESTO.test(q) ? q : x;
  }).join(' ');
}
function cmReglasOptIn(s, o) {
  if (!(o.sinDatosDePago || o.sinAfirmarCompra || o.sinPromesasDeAviso)) return '';
  const vars = cmVariantes(s);
  if (o.sinDatosDePago && cmHay(CM_DATOS_PAGO, vars, false)) return 'datos_de_pago';
  if (o.sinAfirmarCompra && cmHay(CM_AFIRMA_COMPRA, vars, true)) return 'afirma_compra';
  if (o.sinPromesasDeAviso && cmHay(CM_PROMETE_AVISO, o.avisoRespaldado ? vars.map(cmSinAvisoAlEquipo) : vars, false)) return 'promete_aviso';
  return '';
}
// Un hueco de plantilla («a las )», «{{x}}», «undefined») nunca sale.
const CM_HUECO = /\(\s*\)|\ba las?\s*[).,;:!?]|\ba las?\s*$|\bde\s*\)|«\s*»|\{\{|undefined|null\b/;
// El cliente pregunta si habla con un bot / una IA / una persona: ahí una NEGACIÓN en la respuesta («Claro que no, soy Rubén») es negar ser una IA.
const CM_PREGUNTA_DE_BOT = /\b(eres|es|sos|hablo con|hablas con|estoy hablando con|estas hablando con)\b[^.!?]{0,20}\b(bot|chatbot|robot|ia|inteligencia|maquina|programa|persona|humano|humana|real|automatic\w*|asistente virtual)\b|^\W*(ia|bot|robot|humano|humana)\W*$/;
const CM_PREGUNTA_DE_IDENTIDAD = /\b(eres|es|sos) (el |la )?(doctor|doctora|dr|dra|persona|humano|humana|bot|robot)\b|\bquien (eres|es)\b/;

// Los enlaces de un texto: con esquema, con `www.`, una IP, o CUALQUIER dominio suelto (algo.mx, algo.cloud…). Se rechaza de
// más a propósito («Dr.Pérez» sin espacio cuenta): el costo es caer en el texto fijo.
const CM_ENLACE = new RegExp('(?:[a-z][a-z0-9+.-]*:\\/\\/|www\\.)\\S+|\\b\\d{1,3}(?:\\.\\d{1,3}){3}(?::\\d+)?(?:\\/\\S*)?|\\b[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.[a-z]{2,}(?![a-z0-9-])(?::\\d+)?(?:\\/\\S*)?', 'gi');
function cmEnlacesDe(texto) {
  // Primero se normaliza igual que el resto (ancho completo, invisibles, «。») y se junta lo que un salto o un espacio parte antes de la terminación.
  const t = String(texto || '').normalize('NFKC').replace(/[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu, '').replace(/\u2800/g, ' ').replace(/[。｡]/g, '.').replace(/\s+(?=\.[a-z]{2,}\b)/gi, '');
  return (t.match(CM_ENLACE) || []).map((e) => e.replace(/[).,;:!?»”"'\]]+$/, ''));
}
function cmNormEnlace(e) {
  return String(e || '').normalize('NFKC').trim().replace(/[).,;:!?»”"'\]]+$/, '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').toLowerCase();
}

function cmOraciones(t, estricto) {
  // `estricto` (maxOraciones): el salto de línea y un emoji cierran oración; «1.» no.
  const ABREV = estricto ? /(?:\b(?:Dr|Dra|Sr|Sra|Srta|Lic|Ing|Prof|Esp|Av|Edif|Of|No|Nro)|(?:^|\s)\d{1,2})\.$/i : /\b(Dr|Dra|Sr|Sra|Srta|Lic|Ing|Prof|Esp|Av|Edif|Of|No|Nro)\.$/i;
  const oraciones = [];
  for (const x of String(t).split(estricto ? /(?<=[.!?…])\s+|(?<=\p{Extended_Pictographic})\s+|\s*\n+\s*/u : /(?<=[.!?…])\s+/)) {
    if (oraciones.length && ABREV.test(oraciones[oraciones.length - 1])) oraciones[oraciones.length - 1] += ' ' + x;
    else oraciones.push(x);
  }
  return oraciones;
}

function cmMotivoDeRechazo(texto, opciones) {
  const o = opciones || {};
  const s = String(texto || '').trim();
  if (!s) return 'vacio';
  if (/^SIN_RESPUESTA/.test(s)) return 'sin_respuesta';
  // Tope duro: ninguna opción lo sube por encima de 2000 (las reglas con búsqueda hacia atrás se vuelven cuadráticas).
  if (s.length > Math.min(o.maximo || 900, 2000)) return 'largo';
  const n = cmNorm(s);
  if (!o.permitirMontos && (CM_MONTO.test(n) || CM_MONTO.test(cmJunto(n)))) return 'monto';
  const nj = cmJunto(n);
  const pn = o.avisoRespaldado && o.sinPromesasDeAviso ? cmSinAvisoAlEquipo(n) : n;
  if (CM_PROMESAS.test(pn) || CM_PROMESAS.test(cmJunto(pn)) || CM_PROMESAS.test(cmJuntoLetras(pn))) return 'promesa';
  const sujetos = (o.quienPromete || []).map((x) => String(x).replace(/[.*+?^${}()[\]\\|]/g, '\\$&'));
  if (sujetos.length && new RegExp('\\b(?:' + sujetos.join('|') + ') te\\b').test(n)) return 'promesa';
  if (cmAlfabetoMixto(s)) return 'afirma_un_hecho';
  // Dos o más espacios (o un salto) separan palabras aunque las letras vayan sueltas: «P a g o   r e c i b i d o».
  const nl = cmJuntoLetras(cmNorm(s.replace(/[ \t\u00a0]{2,}|\n+/g, ' , ')));
  if (CM_AFIRMA.test(n) || CM_AFIRMA.test(nj) || CM_AFIRMA.test(nl)) return 'afirma_un_hecho';
  if (CM_AFIRMA_C.test(cmColapsa(cmJuntoLetras(cmLeet(cmNorm(s.replace(/[ \t\u00a0]{2,}|\n+/g, ' , ')))))) || CM_AFIRMA_C.test(cmColapsa(nl))) return 'afirma_un_hecho';
  if (CM_HUECO.test(n)) return 'hueco';
  const pregunta = cmNorm(o.textoDelCliente || '');
  if (pregunta && CM_PREGUNTA_DE_IDENTIDAD.test(pregunta) && /^\W*si\b/.test(n)) return 'identidad';
  if (pregunta && CM_PREGUNTA_DE_BOT.test(pregunta) && /\b(no|nop|nel|para nada)\b/.test(n) && !/\b(asistente|virtual)\b/.test(n)) return 'identidad';
  if (o.sinImagenes) {
    const nlc = cmJuntoLetras(cmLeet(cmNorm(s.replace(/[ \t\u00a0]{2,}|\n+/g, ' , '))));
    if (CM_PROMETE_IMAGENES.test(n) || CM_PROMETE_IMAGENES.test(nj) || CM_PROMETE_IMAGENES.test(nl) || CM_PROMETE_IMAGENES.test(nlc)) return 'promete_imagenes';
  }
  if (o.maxOraciones >= 1 && cmOraciones(s, true).filter((x) => /[\p{L}\p{N}]/u.test(x)).length > o.maxOraciones) return 'largo_en_oraciones';
  const optIn = cmReglasOptIn(s, o);
  if (optIn) return optIn;
  for (const re of (o.prohibidos || [])) if (re.test(n)) return 'prohibido';
  // ENLACES: por defecto NINGUNO sale. `enlacesPermitidos` es la lista de enlaces COMPLETOS del negocio (mapa, redes,
  // wa.me). Se detectan `https?://…`, `www.…` y los dominios sueltos más comunes (wa.me/…, bit.ly/…, algo.com); un
  // enlace sale solo si es IGUAL a uno de la lista o cuelga de él (`/`, `?` o `#` después). `null` apaga la revisión
  // y debe ser una decisión escrita del flujo.
  if (o.enlacesPermitidos !== null) {
    const lista = (o.enlacesPermitidos || []).map((x) => cmNormEnlace(x)).filter(Boolean);
    for (const e of cmEnlacesDe(s)) {
      const n = cmNormEnlace(e);
      // Nunca `http://` (un enlace del negocio es https), nunca `..` ni `@` en la ruta, ni otro enlace dentro de él (`?next=https://…`).
      if (/^http:\/\//i.test(e) || /^[a-z][a-z0-9+.-]*:\/\//i.test(e) && !/^https:\/\//i.test(e)) return 'enlace_ajeno';
      const ok = lista.some((p) => {
        if (n === p) return true;
        if (!n.startsWith(p) || !/[\/?#]/.test(n.charAt(p.length))) return false;
        const cola = n.slice(p.length);
        return !/\.\.|@|:\/\/|%2f|%40|\\/i.test(cola);
      });
      if (!ok) return 'enlace_ajeno';
    }
  }
  for (const f of (o.extra || [])) {
    const m = f(s, n);
    if (m) return String(m);
  }
  return '';
}
function cmRedaccionValida(texto, opciones) {
  return cmMotivoDeRechazo(texto, opciones) === '';
}
// Pulido, en código. Se trabaja por ORACIONES COMPLETAS, nunca por trozos (cortar en el punto de «Dr.» dejaba
// la oferta empezando por «Andres Bellido y estoy aquí…»). Las abreviaturas de trato no cierran oración.
//   - fuera, al principio, toda oración que solo saluda o presenta (el menú ya saludó);
//   - fuera las muletillas de apertura («Claro que sí,», «Por supuesto,»…);
//   - toda palabra del nombre del negocio escrita con otros acentos vuelve a la forma de la configuración.
// opciones: { nombreNegocio }
function cmPulirRedaccion(texto, opciones) {
  const o = opciones || {};
  // Tope de largo: el pulido parte por oraciones y un texto enorme lo volvía cuadrático. Una redacción válida mide ≤ 900.
  const oraciones = cmOraciones(String(texto || '').slice(0, 5000).trim(), o.maxOraciones >= 1);
  const SALUDO = /^[¡!]?\s*(hola|buen[oa]s?\s+(d[ií]as|tardes|noches)|qu[eé] tal)\b/i;
  const PRESENTA = /\b(soy|somos)\s+(la|el|una|un|tu)\s+(asistente|secretaria|recepcionista)\b|\bestoy aqu[ií] para\b|\best(oy|amos) para (ayudarte|servirte)\b/i;
  while (oraciones.length > 1 && (SALUDO.test(oraciones[0]) || PRESENTA.test(oraciones[0]))) oraciones.shift();
  if (oraciones.length) oraciones[0] = oraciones[0].replace(/^[¡!]?\s*(claro que s[ií]|claro|por supuesto|con gusto|perfecto|listo|dale|genial)\s*[!,.:]+\s*/i, '');
  if (oraciones.length) oraciones[0] = oraciones[0].replace(/^[¡!]?\s*hola\s*[!.,]\s*/i, '');
  // Tope de oraciones (opt-in): se conservan las primeras y, si la última era una pregunta, esa pregunta.
  const tope = Number(o.maxOraciones);
  if (tope >= 1 && oraciones.length > tope) {
    const ultima = oraciones[oraciones.length - 1];
    const corte = oraciones.slice(0, tope);
    if (/\?[^\p{L}\p{N}]*$/u.test(ultima) && !/\?[^\p{L}\p{N}]*$/u.test(corte[tope - 1])) corte[tope - 1] = ultima;
    oraciones.length = 0;
    oraciones.push(...corte);
  }
  let t = oraciones.join(' ').trim();
  const sinTilde = (w) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const palabras = String(o.nombreNegocio || '').split(/[^A-Za-zÀ-ÿ]+/).filter((w) => w.length >= 4);
  for (const w of palabras) {
    t = t.replace(/[A-Za-zÀ-ÿ]+/g, (x) => (x !== w && sinTilde(x) === sinTilde(w)) ? w : x);
  }
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}
// LO QUE SALE es lo PULIDO, así que se valida lo pulido (pulir puede dejar un «Sí» al principio de lo que era
// «Hola. Sí, soy yo»). Devuelve { texto, motivo }: si `motivo` no es '', se descarta y se usa el texto fijo del código.
function cmRevisarRedaccion(texto, opciones) {
  const pulido = cmPulirRedaccion(texto, opciones);
  return { texto: pulido, motivo: cmMotivoDeRechazo(pulido, opciones) };
}
