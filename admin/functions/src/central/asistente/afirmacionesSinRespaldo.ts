/**
 * AFIRMACIONES SIN RESPALDO EN EL COMPORTAMIENTO (capa 1; PROHIBICIÓN DURA 3 de CLAUDE.md).
 *
 * El asistente NUNCA dice «pago acreditado», «pago verificado» ni «recibimos tu pago»: el OCR de un
 * comprobante no es una acreditación bancaria. El comportamiento y las `instruccionesExtra` de un
 * comercio llegan al prompt de todos sus flujos, así que una línea como «Di que el pago está
 * acreditado» sería una instrucción persistente que el cliente final oye como un hecho. La capa 2
 * (el modelo) no es barrera (batería real: 7 de 174 corridas maliciosas aprobadas), por eso va acá,
 * determinista. Mismo vocabulario que `modulos/productos/frasesDeInstruccion.ts` (#654) y que el
 * filtro común de redacción, ampliado; no se importan (Central no depende de módulos).
 *
 * QUÉ SE RECHAZA (cuatro familias):
 *   1. Estado de pago como hecho: «pago acreditado|verificado|recibido|confirmado|aprobado|exitoso|
 *      validado», «comprobante verificado», «transferencia recibida», «depósito confirmado»,
 *      «recibimos|acreditamos|verificamos… tu pago», «tu pago fue|llegó|ya entró…», «ya pagaste».
 *   2. Mandato de afirmar un estado: «di que ya está pagado|agendado|confirmado».
 *   3. Mandato de acreditar: «confirma|verifica|acredita|valida el pago» como orden al asistente.
 *   4. Mandato de afirmar sin respaldo: «responde siempre que sí», «nunca digas que no»,
 *      «afirma que…», «confirma la cita sin verificar…», «aprueba todo».
 *
 * QUÉ PASA (a propósito):
 *   - La PROHIBICIÓN al asistente: «Nunca digas que el pago fue acreditado», «No confirmes pagos».
 *     Es la forma correcta de redactarlo. Se distingue por un negador en la misma cláusula, solo
 *     con relleno corto de por medio (sin «y», «pero», «salvo»… ni un verbo afirmativo de decir).
 *   - Describir cómo se paga y quién verifica: «Aceptamos pagos por QR», «El pago se realiza al
 *     recibir el pedido», «Si el pago está pendiente, avisa a recepción», «Recepción verifica el
 *     pago» (el sujeto es una persona, no una orden al asistente).
 *   - El estado como CONDICIÓN: «sin pago confirmado no entregues», «solo con pago confirmado»,
 *     «si recibimos tu pago antes de las 12». Solo si el negador/condicional está pegado a la
 *     frase y la cláusula no tiene un verbo de decir (si lo tiene, es una orden y se rechaza).
 *
 * RESIDUO DECLARADO (falsos positivos que se aceptan por seguridad): «Nunca digas que no, ofrece
 * alternativas» (una guía de estilo) y «Confirma el pago al cliente cuando recepción lo verifique»
 * se rechazan; el comercio los reescribe («ofrece alternativas en vez de negar»).
 *
 * VISTAS: el texto normalizado (NFKC, invisibles fuera, sin acentos) y, además, una vista PLEGADA:
 * homoglifos cirílicos/griegos a latino, leet pegado a letras («p4g0 4cr3d1t4d0»), y letras
 * espaciadas unidas («p a g o»). Las frases pegadas («pagoacreditado») las cubre el separador de
 * cero caracteres. Los separadores tolerados entre palabras: blancos, `_ - * · | / + " ' ( )`.
 *
 * TIEMPO: ningún cuantificador anidado; los separadores van acotados ({0,3}) y las ventanas de los
 * mandatos son de ocho palabras. El texto se corta antes de mirarlo.
 *
 * PURO Y SIN IMPORTS. Sin `eval` ni `new Function`.
 */

const TOPE_VISTA = 30000;

// ---------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------

const HOMOGLIFOS: Record<string, string> = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'ѕ': 's', 'ј': 'j',
  'ο': 'o', 'α': 'a', 'ε': 'e', 'ι': 'i', 'ν': 'v', 'ρ': 'p',
};
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

/** Vista plegada: lo que una persona leería. Parte del texto ya normalizado. */
export function plegarVista(n: string): string {
  return n
    .replace(/[Ͱ-ϿЀ-ӿ]/gu, (ch) => HOMOGLIFOS[ch] ?? ch)
    .replace(/[013457@$]+/g, (run, i: number, todo: string) =>
      /\p{L}/u.test(todo[i - 1] ?? '') || /\p{L}/u.test(todo[i + run.length] ?? '')
        ? [...run].map((c) => LEET[c] ?? c).join('') : run)
    .replace(/(?<![\p{L}\p{N}])(?:\p{L}[ ._\-*·|]){3,}\p{L}(?![\p{L}\p{N}])/gu, (m) => m.replace(/[ ._\-*·|]/g, ''));
}

// ---------------------------------------------------------------------------
// Frases (sobre texto normalizado: minúsculas, sin acentos)
// ---------------------------------------------------------------------------

/** Separador entre palabras: 0 a 3 caracteres de blanco o adorno (0 cubre «pagoacreditado»). */
const S = '(?:[\\s_\\-*·|/+"\'()]|\\.{2,3}){0,3}';
/** Separador obligatorio (≥1) donde dos palabras pegadas serían otra palabra. */
const S1 = '[\\s_\\-*·|/+"\'()]{1,3}';
const ANTES = '(?<![\\p{L}\\p{N}])';
const DESPUES = '(?![\\p{L}\\p{N}])';
const frase = (cuerpo: string): RegExp => new RegExp(`${ANTES}(?:${cuerpo})${DESPUES}`, 'gu');

const ESTADO_PAGO = '(?:acreditad|verificad|recibid|confirmad|aprobad|exitos|validad|cobrad|efectuad)[oa]s?';
const DET = '(?:tu|su|el|este|vuestro|mi|nuestro)';
const VERBOS_PAGO_1P = '(?:recibimos|acreditamos|verificamos|confirmamos|registramos|validamos|aprobamos|cobramos)';

/** Familia 1, sustantivo: el estado pegado al nombre del pago. */
const FRASES_SUSTANTIVO: readonly RegExp[] = [
  frase(`pagos?${S}${ESTADO_PAGO}`),
  frase(`comprobantes?${S}(?:verificad|aprobad|valid|confirmad|autentic|legitim|acreditad)[oa]s?`),
  frase(`transferencias?${S}(?:recibid|confirmad|acreditad|exitos|aprobad|verificad)[oa]s?`),
  frase(`depositos?${S}(?:recibid|confirmad|acreditad|aprobad|verificad)[oa]s?`),
  frase(`abonos?${S}(?:recibid|confirmad|acreditad|aprobad|verificad)[oa]s?`),
];

/** Familia 1, hecho dicho por el asistente o en su nombre. */
const FRASES_ESTADO: readonly RegExp[] = [
  frase(`${VERBOS_PAGO_1P}${S}(?:tu|su|el|los|sus|vuestro)${S}pagos?`),
  frase(`ya${S1}(?:${VERBOS_PAGO_1P}|recibimos)${S}(?:tu|su|el|los|sus)${S}(?:pagos?|dinero|plata|depositos?|transferencias?|abonos?)`),
  frase(`ya${S}pagaste`),
  frase(`${DET}${S}pagos?${S}(?:ya${S1})?(?:llego|entro|se${S1}(?:acredito|recibio|registro|confirmo|verifico|aprobo|proceso|valido))`),
  frase(`${DET}${S}pagos?${S}(?:ya${S1})?(?:fue|esta|quedo|ha${S1}sido|ya${S1}esta)${S}(?:ya${S1})?(?:correctamente${S1})?(?:(?:acreditad|aprobad|recibid|verificad|confirmad|registrad|procesad|exitos|validad)[oa]s?|listo|ok)`),
];

/** Estados que se cuelgan de un verbo de decir: «di que ya está pagado». */
const ESTADO_DICHO = /^(?:pagad|agendad|reservad|acreditad|aprobad|verificad|confirmad|cobrad)[oa]s?$/u;
const ANTES_DEL_ESTADO = new Set(['esta', 'estan', 'queda', 'quedo', 'quedaron', 'fue', 'fueron', 'sido', 'ya', 'estara', 'sera']);

/** Familia 4: mandatos de afirmar sin respaldo, fijos. */
const FRASES_ABSOLUTAS: readonly RegExp[] = [
  frase(`(?:responde|responder|contesta|contestar|di|dile|diles|decile|decir|afirma|afirmale|afirmar|asegura|asegurale)${S1}siempre${S1}que${S1}si`),
  frase(`(?:siempre${S1})(?:responde|contesta|di|dile|diles|decile|afirma|afirmale|asegura)${S1}que${S1}si`),
  frase(`(?:responde|contesta|di|dile|diles|decile|afirma)${S1}que${S1}si${S1}a${S1}(?:todo|todos|todas|cualquier\\w*|lo${S1}que)`),
  frase(`(?:nunca|jamas|no)${S1}(?:le${S1}|les${S1})?(?:digas|diga|respondas|contestes)${S1}(?:nunca${S1})?que${S1}no(?=${S1}a${S1}(?:nada|nadie|todo|ningun)|\\s*(?:[.,;:!?]|$))`),
  frase(`(?:nunca|jamas|no)${S1}(?:rechaces|niegues|rehuses)${S1}(?:nada|a${S1}nadie|ninguna?)`),
  frase(`(?:afirma|afirmale|afirmar|afirmes)${S1}que`),
  frase(`(?:acepta|aprueba|valida|acredita|autoriza)${S1}(?:siempre${S1})?(?:todo|lo${S1}que${S1}(?:pida|diga|envie|mande|digan|pidan))`),
  frase(`(?:aprueba|valida|acredita|verifica)${S1}(?:siempre${S1})?(?:cualquier|todo)${S1}(?:comprobante|pago|transferencia|deposito)\\w*`),
  frase(`da${S1}por${S1}(?:bueno|valido|pagado|acreditado)${S1}(?:todo|cualquier)`),
];

// ---------------------------------------------------------------------------
// Mandatos con ventana (familias 2 y 3)
// ---------------------------------------------------------------------------

const VERBOS_DE_DECIR = new Set([
  'di', 'dile', 'diles', 'decile', 'decir', 'digas', 'diga', 'digan', 'afirma', 'afirmale', 'afirmar', 'afirmes', 'afirme',
  'asegura', 'asegurale', 'asegurar', 'asegures', 'responde', 'responder', 'respondas', 'contesta', 'contestar',
  'confirma', 'confirmale', 'confirmar', 'confirmes', 'confirme', 'indica', 'indicale', 'indicar', 'informa', 'informale',
  'avisa', 'avisale', 'escribe', 'comunica', 'comunicale', 'notifica', 'anuncia', 'aclara', 'menciona', 'repite',
  'certifica', 'garantiza', 'garantizale', 'hazle',
]);
/** Verbos que acreditan: con «pago» de objeto son la orden de dar por cobrado. */
const VERBOS_DE_ACREDITAR = new Set([
  'confirma', 'confirmale', 'confirmar', 'acredita', 'acreditale', 'acreditar', 'verifica', 'verificar',
  'valida', 'validar', 'aprueba', 'aprobar', 'confirmes', 'acredites', 'verifiques', 'valides', 'apruebes',
]);
/** Sujeto o verbo auxiliar que NO hace de imperativo («recepción verifica el pago»). */
const PREVIAS_DE_ORDEN = new Set([
  'y', 'luego', 'despues', 'entonces', 'siempre', 'tambien', 'ya', 'ahora', 'solo', 'debes', 'puedes', 'podes', 'deberas',
  'podras', 'tienes', 'tenes', 'quiero', 'hay', 'automaticamente', 'inmediatamente', 'que', 'para', 'de', 'el', 'asistente', 'bot',
]);
const OBJETOS_DE_RESERVA = new Set(['cita', 'citas', 'reserva', 'reservas', 'turno', 'turnos', 'pedido', 'pedidos', 'compra', 'compras', 'orden', 'ordenes', 'hora', 'pago', 'pagos', 'cobro']);
const SIN_RESPALDO = /(?:^|\s)(?:sin\s+(?:verificar|revisar|consultar|comprobar|validar|chequear|esperar|preguntar|importar|mirar|buscar)|aunque|pase\s+lo\s+que\s+pase|a\s+pesar\s+de|igual\s+(?:si|aunque|con))(?![\p{L}\p{N}])/u;

interface Ficha { t: string; i: number; ruptura: boolean }

function fichar(vista: string): Ficha[] {
  const fichas: Ficha[] = [];
  for (const m of vista.matchAll(/[\p{L}\p{N}]+|[.,;!?\n]/gu)) {
    fichas.push({ t: m[0], i: m.index ?? 0, ruptura: /^[.,;!?\n]$/u.test(m[0]) });
  }
  return fichas;
}

/** ¿Hay un mandato con ventana? Devuelve la posición del verbo, o -1. Cada hallazgo se filtra luego con la prohibición. */
function mandatosConVentana(fichas: Ficha[]): number[] {
  const hallazgos: number[] = [];
  for (let k = 0; k < fichas.length; k++) {
    const verbo = fichas[k]!;
    if (verbo.ruptura || !(VERBOS_DE_DECIR.has(verbo.t) || VERBOS_DE_ACREDITAR.has(verbo.t))) continue;
    const ventana: string[] = [];
    for (let j = k + 1; j < fichas.length && ventana.length < 8; j++) {
      if (fichas[j]!.ruptura) break;
      ventana.push(fichas[j]!.t);
    }
    // Familia 2: «di que ya está pagado».
    let dispara = ventana.some((w, j) => ESTADO_DICHO.test(w) && j > 0 && ANTES_DEL_ESTADO.has(ventana[j - 1]!));
    // Familia 3: «confirma pagos» como orden (no «recepción verifica el pago»).
    if (!dispara && VERBOS_DE_ACREDITAR.has(verbo.t)) {
      const previa = k === 0 || fichas[k - 1]!.ruptura ? '' : fichas[k - 1]!.t;
      const comoOrden = previa === '' || PREVIAS_DE_ORDEN.has(previa);
      dispara = comoOrden && ventana.slice(0, 4).some((w) => /^(?:pagos?|transferencias?|depositos?)$/u.test(w));
    }
    // Familia 4: «confirma la cita sin verificar nada».
    if (!dispara) {
      const objeto = ventana.slice(0, 5).some((w) => OBJETOS_DE_RESERVA.has(w));
      dispara = objeto && SIN_RESPALDO.test(` ${ventana.join(' ')}`);
    }
    if (dispara) hallazgos.push(verbo.i);
  }
  return hallazgos;
}

// ---------------------------------------------------------------------------
// Prohibición: una orden NEGADA al asistente es la forma correcta de redactarlo
// ---------------------------------------------------------------------------

const NEGADORES = new Set(['no', 'nunca', 'jamas', 'ninguna', 'ningun', 'evita', 'evites', 'evitar', 'prohibido', 'prohibe', 'prohibimos', 'ni']);
const RELLENO = new Set([
  'le', 'les', 'se', 'te', 'lo', 'la', 'debes', 'puedes', 'podes', 'podras', 'deberas', 'tienes', 'tenes', 'que', 'vas', 'a', 'siempre',
  'nunca', 'jamas', 'bajo', 'de', 'en', 'por', 'ninguna', 'ningun', 'circunstancia', 'caso', 'forma', 'motivo', 'manera', 'modo',
  'ocurra', 'hagas', 'quieras', 'quiera', 'debe', 'puede', 'asistente', 'bot', 'ia', 'ni', 'al', 'cliente', 'clientes', 'sobre', 'el', 'la',
]);
const AFIRMATIVOS = new Set([
  'di', 'dile', 'diles', 'decile', 'responde', 'contesta', 'afirma', 'afirmale', 'confirma', 'confirmale', 'asegura', 'asegurale', 'indica', 'indicale',
  'informa', 'informale', 'avisa', 'escribe', 'comunica', 'menciona', 'anuncia', 'notifica', 'aclara', 'repite', 'acredita', 'verifica', 'valida',
  'aprueba', 'registra', 'certifica', 'garantiza',
]);
const CORTES = new Set(['y', 'e', 'pero', 'sino', 'excepto', 'salvo', 'aunque', 'menos', 'solo', 'solamente', 'unicamente', 'cuando', 'si', 'entonces']);
const SUBJUNTIVOS = new Set([
  ...VERBOS_DE_DECIR, 'escribas', 'escriba', 'informes', 'menciones', 'comuniques', 'prometas', 'presentes', 'insinues', 'sugieras',
  'anuncies', 'notifiques', 'acredites', 'verifiques', 'valides', 'apruebes', 'registres', 'expreses', 'manifiestes', 'pronuncies',
  'repitas', 'emitas', 'envies', 'muestres', 'escribir', 'acreditar', 'verificar', 'validar', 'aprobar', 'registrar', 'prometer',
  'presentar', 'sugerir', 'insinuar', 'mencionar', 'anunciar', 'notificar', 'comunicar', 'informar', 'indicar',
]);

/**
 * ¿La cláusula previa al hallazgo es una prohibición? Un negador, relleno corto y (si el hallazgo
 * no empieza con el verbo) un verbo de decir sin afirmativos ni cortes de por medio.
 */
function prohibido(previas: Ficha[], empiezaConVerbo: boolean): boolean {
  // Del negador más cercano al más lejano: «No digas "x" ni "y"» tiene un «ni» pegado al hallazgo,
  // pero la prohibición la sostiene el «No digas» anterior.
  for (let k = previas.length - 1; k >= 0; k--) {
    if (!NEGADORES.has(previas[k]!.t)) continue;
    const resto = previas.slice(k + 1).map((f) => f.t);
    if (resto.length > 8 || resto.some((w) => AFIRMATIVOS.has(w) || CORTES.has(w))) continue;
    if (empiezaConVerbo ? resto.length <= 5 && resto.every((w) => RELLENO.has(w)) : resto.some((w) => SUBJUNTIVOS.has(w))) return true;
  }
  return false;
}

const COND_ANTES = /(?:^|\s)(?:sin|solo\s+con|solamente\s+con|unicamente\s+con|hasta\s+(?:tener|contar\s+con|ver)|si\s+(?:hay|tiene|tienes)|cuando\s+(?:haya|tenga|tengas)|hasta\s+que\s+haya)$/u;
const COND_ESTADO = /(?:^|\s)(?:si|cuando|apenas|en\s+cuanto|una\s+vez\s+que|despues\s+de\s+que)$/u;

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

function hallazgosEnVista(vista: string): boolean {
  const fichas = fichar(vista);
  /** Fichas de la cláusula que precede a la posición `pos` (desde la última ruptura de oración o coma). */
  const previas = (pos: number): Ficha[] => {
    const antes = fichas.filter((f) => f.i < pos);
    let desde = 0;
    for (let j = antes.length - 1; j >= 0; j--) if (antes[j]!.ruptura) { desde = j + 1; break; }
    return antes.slice(desde);
  };
  const textoPrevio = (pos: number): string => previas(pos).map((f) => f.t).join(' ');
  const hayVerboDeDecir = (pos: number): boolean => previas(pos).some((f) => VERBOS_DE_DECIR.has(f.t) || AFIRMATIVOS.has(f.t));

  for (const re of FRASES_SUSTANTIVO) {
    for (const m of vista.matchAll(re)) {
      const pos = m.index ?? 0;
      if (prohibido(previas(pos), false)) continue;
      if (!hayVerboDeDecir(pos) && COND_ANTES.test(textoPrevio(pos))) continue;
      return true;
    }
  }
  for (const re of FRASES_ESTADO) {
    for (const m of vista.matchAll(re)) {
      const pos = m.index ?? 0;
      if (prohibido(previas(pos), false)) continue;
      if (!hayVerboDeDecir(pos) && COND_ESTADO.test(textoPrevio(pos))) continue;
      return true;
    }
  }
  for (const re of FRASES_ABSOLUTAS) {
    for (const m of vista.matchAll(re)) {
      const pos = m.index ?? 0;
      // Las que traen su propio negador («nunca digas que no») no se exentan por uno anterior.
      if (/^(?:nunca|jamas|no)\s/u.test(m[0])) return true;
      if (prohibido(previas(pos), true)) continue;
      return true;
    }
  }
  for (const pos of mandatosConVentana(fichas)) {
    if (prohibido(previas(pos), true)) continue;
    return true;
  }
  return false;
}

/**
 * ¿El texto manda decir, o dice, algo sobre un pago o un estado que el flujo no puede respaldar?
 * Recibe el texto YA normalizado (`normalizar`, sin sustituir términos registrados: un término de
 * producto no exime estas frases).
 */
export function afirmaSinRespaldo(normalizado: string): boolean {
  if (typeof normalizado !== 'string' || normalizado === '') return false;
  const base = normalizado.slice(0, TOPE_VISTA);
  const plegada = plegarVista(base);
  return hallazgosEnVista(base) || (plegada !== base && hallazgosEnVista(plegada));
}
