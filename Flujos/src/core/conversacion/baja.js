// CORE · CONVERSACIÓN · BAJA POR TEXTO (prefijo `bj`, 13/11/2026). Funciones PURAS para incluir byte a byte en un nodo Code de n8n (JS): sin importaciones ni globales de Node, sin retorno de nivel superior.
// Qué resuelve: la política de WhatsApp Business exige respetar a quien pide no recibir más mensajes. El pedido se reconoce con UNA sola expresión, en todos los flujos, y se contesta con UN
// texto fijo de confirmación y nada más: ni el modelo, ni el menú, ni botones, ni aviso al negocio. El reporte `no_contactar` viaja con el entrante («Reportar mensaje (entrante)») y el servidor
// apaga seguimientos y rescates. Costo: 0 mensajes agregados (la confirmación REEMPLAZA a la respuesta que ese turno ya enviaba).
// Origen canónico: la expresión acotada a PETICIONES de la venta digital (revisión de #584; tú, usted, ustedes y voseo), sin un byte de diferencia. Tiene que ser un pedido A NOSOTROS y sin objeto
// ni complemento que lo vuelva otra cosa: el relato de un tercero («mi ex no deja de escribirme», «el doctor dijo que no me escriban»), «no me escribas el precio, mándame el QR» y «no me
// escribiste el precio» NO cuentan; «para de escribirme», «basta, no me escriban», «n0 me escribas», «dame de baja» y «stop» SÍ.
// La expresión del nodo «Reportar mensaje (entrante)» de cada flujo es LITERALMENTE esta (lo exige `admin/pruebas/core/ux-baja.test.ts`): quien recibe la confirmación es quien quedó marcado.
// Sin textos ni nombres de un cliente: el texto de confirmación es neutro y el flujo puede pasar el suyo (dato del tenant).
const BJ_BAJA = /(?<!\b(?:dij\w+|dice|dicen|digo) que )\bno (?:me |nos |le |les )?escrib(?:a|as|an|ais|is)\b(?:(?=(?: (?:mas|ya|nunca|jamas|otra vez|de nuevo|nada mas|mensajes|por favor|porfa|por aqui|por este medio|por whatsapp|gracias))*(?:\W*$|[.,;!?]))|(?= (?:mas|nunca|jamas)\b))|(?<!\b(?:dij\w+|dice|dicen|digo) que )\bno (?:me |nos |le |les )?(?:contact(?:e|es|en)|moleste[sn]?)\b|(?<!\b(?:dij\w+|dice|dicen|digo) que )\bno (?:me |nos |le |les )?llam(?:e|es|en)\b(?! la atencion)|(?<!\b(?:dij\w+|dice|dicen|digo) que )\bno (?:me |nos |le |les )?(?:mand|envi)(?:e|es|en)\b(?= (?:mas|mensajes|nada mas)\b|\W*$|,? por favor)|(?<!\b(?:dij\w+|dice|dicen|digo) que )\bno (?:me |nos |le |les )?vuelv(?:a|as|an) a (?:escribir|llamar|contactar|mandar)(?:me|nos)?\b|\bno quiero (?:que (?:me|nos) (?:escrib|contact|mand|llam|molest)(?:a|as|an|e|es|en)\b|recibir (?:mas )?mensajes\b|mas mensajes\b)|(?<!\b(?:dij\w+|dice|dicen|digo) que )\bno (?:me |nos |le |les )?sig(?:a|as|an) escribiendo\b|(?<!\bno (?:me |nos )?)(?<!\b(?:dij\w+|dice|dicen|digo|pide|pidio|pidieron) que (?:\w+ ){0,3})(?<!\bquiero que (?:\w+ ){1,3})\b(?:dej(?:a|as|e|es|en|ame|eme|enme)|par(?:a|as|e|es|en))\b(?: me)? de (?:escribir|mandar|molestar|llamar|contactar)(?:me|nos)?\b(?=(?: (?:mas|ya|nunca|jamas|otra vez|de nuevo|nada mas|mensajes|por favor|porfa|por aqui|por este medio|por whatsapp|gracias))*(?:\W*$|[.,;!?]))(?![^]*\b(?:dice|dijo|dicen)\b)|\b(?:dar|darme|dame|deme|denme) de baja\b(?! (?:el|la|los|las|un|una|mi|mis|a)\b)|(?:^|\s)(?:borr|quit|elimin|saqu)(?:a|e|en)(?:me|nos)(?: de (?:la lista|aqui|sus contactos|tu lista|su lista|esta lista)\b|(?: por favor)?\W*$)|^\W*stop(?: por favor)?\W*$/i;
// El texto se pliega ANTES de probar (NFKC: ancho completo; sin tildes; minúsculas; cifras que hacen de letras: «n0 me escribas»; espacios colapsados): la misma cadena que el nodo del reporte.
function bjPlegar(texto) {
  return String(texto === undefined || texto === null ? '' : texto).normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\s+/g, ' ');
}
// ¿El texto del cliente pide la baja? (la expresión ya excluye el relato de un tercero y los pedidos con otro objeto).
function bjPideBaja(texto) {
  return BJ_BAJA.test(bjPlegar(texto));
}
// La confirmación por defecto: una frase, sin pregunta, sin oferta y sin promesa que el flujo no cumpla (escribir de nuevo SÍ funciona: el siguiente mensaje se atiende como siempre).
const BJ_TEXTO_BAJA = 'Entendido, tomé nota de que no quieres recibir más mensajes. Si más adelante necesitas algo, escríbeme cuando quieras.';
// El texto que sale: el del tenant si es un texto útil (hasta 300 caracteres, una sola línea), si no el neutro.
function bjTextoBaja(propio) {
  const t = typeof propio === 'string' ? propio.replace(/\s+/g, ' ').trim() : '';
  return t !== '' && t.length <= 300 ? t : BJ_TEXTO_BAJA;
}
