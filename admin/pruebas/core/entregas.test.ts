/**
 * =============================================================================
 * SE ENTREGA LO QUE SE PROMETE: PRUEBA ESTÁTICA DE LOS FLUJOS (I-ENTREGA)
 * =============================================================================
 *
 * EL CASO, 03/10/2026 (Demo B). El QR del cobro falló porque Meta rechazó un
 * media ID vencido; el texto de cobro viajaba en el pie de esa misma imagen,
 * así que el cliente no recibió NADA, y n8n mostró `success`. Nadie lo vio
 * porque ningún control preguntaba «¿este envío tiene a dónde ir cuando falla?»
 * ni «¿lo que el texto anuncia lo entrega algo?». Esta suite lo pregunta de
 * forma estática, sobre cada JSON del disco, y no cambia ningún flujo.
 *
 * LA REGLA (I-ENTREGA). Un envío solo cuenta como entregado si Meta devolvió un
 * `messages[0].id`; un texto que anuncia lo que entrega otro envío viaja dentro
 * de ese mismo mensaje o sale DESPUÉS, elegido según el resultado; todo envío
 * al cliente tiene camino de fallo al cliente (texto de respaldo con botón); si
 * el respaldo también falla, la ejecución termina en error visible; nunca
 * `continueRegularOutput` sin verificador del id ni `continueErrorOutput` con
 * la salida de error desconectada.
 *
 * LAS SEIS REGLAS que comprueba (por flujo; los programados solo la 1 y la 3):
 *   1. Todo envío tiene una VERIFICACIÓN (una de cuatro formas, ver
 *      `verificacion`), distinta de ninguna.
 *   2. (Conversacionales, destino cliente.) Si el envío no es texto, desde él se
 *      alcanza otro envío de texto al cliente; si es texto, o es «ruidoso» (su
 *      falla corta la ejecución con error), o alcanza otro texto al cliente, o
 *      un Code verificador alcanzable (o que lo nombra) tiene `throw`, o alcanza
 *      un reporte `envio_fallido`.
 *   3. Todo reporte saliente a `/ingesta` lleva `idMeta`, y cada camino hacia
 *      atrás hasta el primer envío pasa por una PUERTA que lee el id.
 *   4. Toda marca `[MARCA]` del prompt tiene un Code que la consume y desde él
 *      se alcanza un envío.
 *   5. Un anuncio en un texto que el flujo escribe (los literales de los Code)
 *      alcanza su mecanismo: «aquí tienes el QR» → una imagen con respaldo;
 *      «toca el botón» → un nodo con `cta_url`; «ya le avisé» → después de un
 *      aviso al negocio con id verificado.
 *   6. Un anuncio en el prompt exige que su mecanismo cumpla la regla 2.
 *
 * LAS EXCEPCIONES (`EXCEPCIONES`) arrancan con CADA violación real de hoy y cada
 * una dice qué PR o hecho la cierra. Una prueba falla si una excepción ya no se
 * aplica (vencida: el PR la cerró y hay que borrarla) o nombra un archivo o un
 * nodo que ya no existe. Así la lista solo puede encogerse.
 *
 * ALCANCE Y LO QUE NO MIRA, a propósito (falsos positivos de una red de listas):
 *   - Lo que Meta acepta y falla después (acuses `failed`): fuera de alcance.
 *   - Los envíos por Code que construyen la URL (ninguno hoy) no se descubren.
 *   - La regla 5 lee solo literales de los Code (comentarios y regex fuera), no
 *     los textos de un Set ni los que traen las herramientas.
 *   - «Verificador inmediato» acepta también un IF sobre `error` cuyas demás
 *     salidas (las que no son otro envío) son un verificador del id: es el
 *     patrón de Venta mínima (`¿Falló el envío?` → respaldo | `¿Reportar?`).
 *
 * HERMÉTICA: lee solo archivos del repositorio, sin red ni emulador.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Flujo, type Nodo, CARPETA_FLUJOS } from '../lib/flujo.ts';

// ---------------------------------------------------------------------------
// Descubrimiento
// ---------------------------------------------------------------------------

const EXCLUIDO = /\.(local|plantilla|prueba)\.json$/;

// Los JSON de Flujos/ y de Flujos/experimental/<carpeta>/, sin locales, plantillas ni de prueba.
export function flujos(): string[] {
  const arriba = readdirSync(CARPETA_FLUJOS).filter((a) => a.endsWith('.json') && !EXCLUIDO.test(a));
  const exp = join(CARPETA_FLUJOS, 'experimental');
  const dentro = existsSync(exp)
    ? readdirSync(exp, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((d) =>
      readdirSync(join(exp, d.name)).filter((a) => a.endsWith('.json') && !EXCLUIDO.test(a)).map((a) => `experimental/${d.name}/${a}`))
    : [];
  return [...arriba, ...dentro].sort();
}

const leer = (archivo: string): Flujo => JSON.parse(readFileSync(join(CARPETA_FLUJOS, archivo), 'utf8')) as Flujo;

export const esProgramado = (f: Flujo): boolean => f.nodes.some((n) => n.type.endsWith('.scheduleTrigger'));

// ---------------------------------------------------------------------------
// Texto de los nodos
// ---------------------------------------------------------------------------

/** El tipo de nodo sin paquete; las variantes «herramienta» del agente se leen como el nodo que envuelven. */
const tipo = (n: Nodo): string => {
  const t = n.type.split('.').pop() ?? '';
  if (t === 'httpRequestTool' || t === 'toolHttpRequest') return 'httpRequest';
  return t === 'whatsAppTool' ? 'whatsApp' : t;
};
const esCode = (n: Nodo): boolean => tipo(n) === 'code';
const esIf = (n: Nodo): boolean => tipo(n) === 'if';
/** El JavaScript del Code SIN comentarios: un comentario que nombra un nodo o cita `messages[0].id` no es código que lo haga. */
const codigo = (n: Nodo): string => (esCode(n) ? tokenizar(String(n.parameters['jsCode'] ?? '')).sinComentarios : '');
const texto = (n: Nodo): string => JSON.stringify(n.parameters ?? {});

const COMPARA_ESTADO = /statusCode\W{0,12}(?:>=?|<=?|===?|!==?|!=|==)|(?:>=?|<=?|===?|!==?|!=|==)\W{0,12}statusCode|statusCode\s*\)\s*(?:>=?|<=?|===?|!==?)/;
const LEE_ID = /messages[\s\S]{0,80}\[0\][\s\S]{0,40}\bid\b/;
/** En un Code el arreglo suele copiarse antes a una variable (`const m = j.messages`): también vale `m[0].id`. */
const LEE_ID_CODIGO = /messages[\s\S]{0,80}\[0\][\s\S]{0,40}\bid\b|\[0\]\??\.id\b/;
const COMPARACION_O_THROW = /===|!==|==|!=|\bthrow\b|\.filter\(|[^?]\?[^?.:]/;

/** El contenido (con paréntesis balanceados) del operando de cada `if (...)` de una sentencia. */
function operandosDeIf(sentencia: string): string[] {
  const r: string[] = [];
  const re = /\bif\s*\(/g;
  for (let m = re.exec(sentencia); m; m = re.exec(sentencia)) {
    let nivel = 1;
    let j = m.index + m[0].length;
    for (; j < sentencia.length && nivel > 0; j++) { if (sentencia[j] === '(') nivel++; else if (sentencia[j] === ')') nivel--; }
    r.push(sentencia.slice(m.index + m[0].length, j - 1));
  }
  return r;
}

/**
 * Lo que un Code mira del resultado de un envío, de verdad: un `statusCode` dentro de una comparación, o
 * `messages[0].id` DENTRO de la condición: el operando de un `if (...)`, o una comparación, un `throw`, un
 * `filter` o un ternario en la MISMA sentencia (el código se parte por `;` y por saltos de línea). Citarlos,
 * copiarlos a un campo o tenerlos cerca de una comparación ajena no es mirar (sondas C, D, D2, D3 y J).
 */
export const leeWamid = (s: string): boolean => {
  if (COMPARA_ESTADO.test(s)) return true;
  for (const sentencia of s.split(/[;\n]/)) {
    if (!LEE_ID_CODIGO.test(sentencia)) continue;
    if (operandosDeIf(sentencia).some((o) => LEE_ID_CODIGO.test(o))) return true;
    if (COMPARACION_O_THROW.test(sentencia)) return true;
  }
  return false;
};

type CondicionIf = { leftValue?: unknown; rightValue?: unknown; operator?: { type?: string; operation?: string } };
const condicionesDe = (n: Nodo): CondicionIf[] =>
  (((n.parameters?.['conditions'] ?? {}) as { conditions?: CondicionIf[] }).conditions ?? []);

/** Un IF v2 mira el resultado de un envío: una expresión que lo lee, o la forma estructurada `statusCode` + comparador. */
const ifLeeId = (n: Nodo): boolean => condicionesDe(n).some((c) => {
  const lv = String(c.leftValue ?? '');
  if (COMPARA_ESTADO.test(lv) || LEE_ID.test(lv)) return true;
  return /statusCode/.test(lv) && /^(gt|gte|lt|lte|equals|notEquals)$/.test(String(c.operator?.operation ?? ''));
});
const leeId = (n: Nodo): boolean => (esCode(n) ? leeWamid(codigo(n)) : esIf(n) && ifLeeId(n));
export const leeIdDe = leeId;

/**
 * Por qué salida de un IF sale el FALLO del envío: 0 (verdadera), 1 (falsa), o null si no se puede decidir
 * (entonces no se abre ninguna: un IF que no sabemos leer no prueba nada).
 */
export function salidaDeFalloDelIf(n: Nodo): 0 | 1 | null {
  for (const c of condicionesDe(n)) {
    const lv = String(c.leftValue ?? '');
    const op = String(c.operator?.operation ?? '');
    const verdad = op === 'true' || op === '' ? true : op === 'false' ? false : null;
    const num = Number(c.rightValue);
    // statusCode, estructurado: el error es >= 400 (o igual a un código de error).
    if (/statusCode/.test(lv) && /^(gt|gte|lt|lte|equals|notEquals)$/.test(op)) {
      if (op === 'gt' || op === 'gte') return 0;
      if (op === 'lt' || op === 'lte') return 1;
      if (Number.isFinite(num)) return (op === 'equals') === (num >= 400) ? 0 : 1;
    }
    // statusCode dentro de la expresión booleana: `… >= 400` es la salida de error; `… < 400`, su contraria.
    const e = /statusCode\)?\s*(>=?|<=?)\s*\d+/.exec(lv);
    if (e && verdad !== null) return ((e[1] as string).startsWith('>') === verdad) ? 0 : 1;
    // `error` en la expresión: verdadera = hubo error.
    if (/\.error\b/.test(lv) && !LEE_ID.test(lv) && verdad !== null) return verdad ? 0 : 1;
    // id: verdadera = hay id = ÉXITO; el fallo sale por la falsa. `!id` (una sola negación) invierte.
    if (LEE_ID.test(lv) && verdad !== null) {
      const niega = /^=?\{\{\s*!(?!!)/.test(lv);
      return (verdad !== niega) ? 1 : 0;
    }
    if (LEE_ID.test(lv) && /^(exists|notEmpty)$/.test(op)) return 1;
    if (LEE_ID.test(lv) && /^(notExists|empty)$/.test(op)) return 0;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tokenizador mínimo de los Code: literales de cadena, sin comentarios ni regex
// ---------------------------------------------------------------------------

/**
 * Recorre el JavaScript de un nodo y devuelve (a) los literales de cadena y de
 * plantilla (con su contenido) y (b) el código sin comentarios. Salta
 * los comentarios de línea y de bloque y los literales de expresión regular, que es donde
 * un texto como «aquí tienes el QR» aparece en un detector y no en un mensaje.
 */
export function tokenizar(src: string): { literales: string[]; sinComentarios: string } {
  const literales: string[] = [];
  let limpio = '';
  let i = 0;
  let previo = ''; // último carácter significativo, para decidir si «/» abre una regex
  const abreRegex = () => previo === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(previo) || /(?:return|typeof|case|in|of)$/.test(limpio.trimEnd());
  while (i < src.length) {
    const c = src[i] as string;
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const fin = src.indexOf('*/', i + 2); i = fin < 0 ? src.length : fin + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      let valor = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') { valor += src[j] as string + (src[j + 1] ?? ''); j += 2; continue; }
        valor += src[j] as string;
        j++;
      }
      literales.push(valor);
      limpio += src.slice(i, j + 1);
      i = j + 1;
      previo = c;
      continue;
    }
    if (c === '/' && abreRegex()) {
      let j = i + 1;
      let enClase = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') enClase = true;
        else if (src[j] === ']') enClase = false;
        else if (src[j] === '/' && !enClase) break;
        j++;
      }
      limpio += src.slice(i, j + 1);
      i = j + 1;
      while (i < src.length && /[a-z]/.test(src[i] as string)) { limpio += src[i] as string; i++; }
      previo = '/';
      continue;
    }
    limpio += c;
    if (!/\s/.test(c)) previo = c;
    i++;
  }
  return { literales, sinComentarios: limpio };
}

// ---------------------------------------------------------------------------
// Grafo
// ---------------------------------------------------------------------------

const porNombre = (f: Flujo, nombre: string): Nodo | undefined => f.nodes.find((n) => n.name === nombre);
const salidasDe = (f: Flujo, desde: string): string[][] =>
  (f.connections[desde]?.['main'] ?? []).map((s) => (s ?? []).map((x) => x.node));
const sucesores = (f: Flujo, desde: string): string[] => salidasDe(f, desde).flat();

/** Todo lo alcanzable desde `desde` por cualquier salida (sin incluirlo, salvo que haya un ciclo). */
export function alcanza(f: Flujo, desde: string): Set<string> {
  const vistos = new Set<string>();
  const pendientes = [desde];
  while (pendientes.length) {
    const actual = pendientes.pop() as string;
    for (const s of sucesores(f, actual)) {
      if (vistos.has(s)) continue;
      vistos.add(s);
      pendientes.push(s);
    }
  }
  return vistos;
}

/** Los pares (predecesor, índice de salida) que entran a `hacia`. */
function predecesores(f: Flujo, hacia: string): { de: string; salida: number }[] {
  const r: { de: string; salida: number }[] = [];
  for (const [de, c] of Object.entries(f.connections)) {
    (c['main'] ?? []).forEach((s, salida) => { if ((s ?? []).some((x) => x.node === hacia)) r.push({ de, salida }); });
  }
  return r;
}

// ---------------------------------------------------------------------------
// Clasificación de los envíos
// ---------------------------------------------------------------------------

export type Clase = 'texto' | 'imagen' | 'boton' | 'plantilla' | 'ubicacion' | 'dinamico';

/**
 * Un envío de WhatsApp: HTTP POST a `/messages` (también como herramienta del agente), o el nodo whatsApp que no es
 * de medios. En el nodo whatsApp la operación por defecto es `sendTemplate`: sin `operation` también envía.
 */
export function esEnvio(n: Nodo): boolean {
  const p = n.parameters ?? {};
  if (tipo(n) === 'httpRequest') return String(p['method'] ?? '').toUpperCase() === 'POST' && String(p['url'] ?? '').includes('/messages');
  if (tipo(n) === 'whatsApp') {
    if (String(p['resource'] ?? 'message') !== 'message') return false;
    return ['send', 'sendTemplate', 'sendAndWait'].includes(String(p['operation'] ?? 'sendTemplate'));
  }
  return false;
}

/**
 * Lo que sale por el camino de FALLO de un envío: por la salida de error si es `continueErrorOutput`; detrás de un
 * IF o Code que lee el id o `error` si es `continueRegularOutput`. Un texto colgado de la salida de ÉXITO, o de un
 * nodo que no decide nada, no es un camino de fallo (sondas A y B de la revisión de `seguridad`).
 */
export function alcanceDeFallo(f: Flujo, n: Nodo): Set<string> {
  const inicio: string[] = [];
  const sinExpandir = new Set<string>(); // gates que se cuentan (por su `throw`) pero de los que no cuelga ningún camino
  if (n.onError === 'continueErrorOutput') inicio.push(...(salidasDe(f, n.name)[1] ?? []));
  else if (n.onError === 'continueRegularOutput') {
    for (const s of sucesores(f, n.name)) {
      const x = porNombre(f, s);
      if (!x) continue;
      if (esCode(x) && (leeId(x) || /error/.test(codigo(x)))) { inicio.push(s); sinExpandir.add(s); continue; } // un Code no abre camino al cliente
      if (!esIf(x) || !(leeId(x) || /error/.test(texto(x)))) continue;
      const salida = salidaDeFalloDelIf(x);
      if (salida === null) continue; // no se puede decidir la polaridad: no se abre ninguna salida
      inicio.push(s);
      for (const d of salidasDe(f, s)[salida] ?? []) inicio.push(d);
      sinExpandir.add(s);
    }
  }
  const vistos = new Set<string>(inicio);
  const pendientes = inicio.filter((x) => !sinExpandir.has(x));
  while (pendientes.length) {
    for (const s of sucesores(f, pendientes.pop() as string)) { if (!vistos.has(s)) { vistos.add(s); pendientes.push(s); } }
  }
  return vistos;
}

/** ¿Se llega a `n` por el camino de fallo de OTRO envío? Es lo que hace «de respaldo» a un envío de cuerpo dinámico. */
const esRespaldoDeOtro = (f: Flujo, n: Nodo): boolean =>
  f.nodes.some((e) => e !== n && esEnvio(e) && alcanceDeFallo(f, e).has(n.name));

export function clase(n: Nodo, f?: Flujo): Clase {
  const p = n.parameters ?? {};
  if (tipo(n) === 'whatsApp') {
    const op = String(p['operation'] ?? 'sendTemplate');
    if (op === 'sendTemplate') return 'plantilla';
    if (op === 'sendAndWait') return 'boton';
    switch (String(p['messageType'] ?? 'text')) {
      case 'text': return 'texto';
      case 'location': return 'ubicacion';
      case 'image': case 'audio': case 'document': case 'video': case 'sticker': return 'imagen';
      default: return 'dinamico';
    }
  }
  const t = texto(n);
  if (t.includes('cta_url')) return 'boton';
  const m = /(?<!\w)type\\*["']?\s*:\s*\\*["'](\w+)/.exec(t);
  switch (m?.[1]) {
    case 'text': return 'texto';
    case 'image': return 'imagen';
    case 'location': return 'ubicacion';
    case 'template': return 'plantilla';
    case 'interactive': return 'boton';
    // El cuerpo viene armado por otro nodo (`$json.cuerpoMeta`): no se ve qué es. Un envío «de respaldo» es el
    // texto de último recurso SOLO si se llega a él desde la salida de fallo de otro envío (sonda H): el nombre
    // solo no basta.
    default: return /respaldo/i.test(n.name) && f && esRespaldoDeOtro(f, n) ? 'texto' : 'dinamico';
  }
}

const ES_NEGOCIO = /^(Avisar |Aviso |Enviar aviso$)/;
const NOMBRA_NEGOCIO = /numeroDue|numeroRecep|doctor/i;
/** El DESTINATARIO manda sobre el nombre del nodo (sonda G); el nombre solo decide si el cuerpo viene armado (sin `to`). */
export function destino(n: Nodo): 'cliente' | 'negocio' {
  const p = n.parameters ?? {};
  const para = tipo(n) === 'whatsApp' ? String(p['recipientPhoneNumber'] ?? '') : (/\bto\s*:\s*([^,\n]+)/.exec(String(p['jsonBody'] ?? ''))?.[1] ?? '');
  if (para) return NOMBRA_NEGOCIO.test(para) ? 'negocio' : 'cliente';
  return ES_NEGOCIO.test(n.name) ? 'negocio' : 'cliente';
}

const enviosDe = (f: Flujo): Nodo[] => f.nodes.filter(esEnvio);

function antecesores(f: Flujo, n: string): Set<string> {
  const vistos = new Set<string>();
  const pendientes = [n];
  while (pendientes.length) {
    for (const { de } of predecesores(f, pendientes.pop() as string)) { if (!vistos.has(de)) { vistos.add(de); pendientes.push(de); } }
  }
  return vistos;
}

/** ¿`c` corre después del envío `n`: se llega a él desde el envío, o cuelga de un antecesor del envío sin serlo? */
function esPosterior(f: Flujo, n: string, c: string): boolean {
  if (alcanza(f, n).has(c)) return true;
  const ant = antecesores(f, n);
  return !ant.has(c) && [...ant].some((a) => alcanza(f, a).has(c));
}

/** Los Code que nombran al envío entre comillas, leen el id y corren DESPUÉS de él (sondas C y D). */
const sumideroDe = (f: Flujo, n: Nodo): Nodo[] =>
  f.nodes.filter((c) => esCode(c) && c !== n && leeWamid(codigo(c))
    && [`'${n.name}'`, `"${n.name}"`, `\`${n.name}\``].some((q) => codigo(c).includes(q))
    && esPosterior(f, n.name, c.name));

export type Verificacion = 'salida-de-error' | 'verificador-inmediato' | 'sumidero-por-nombre' | 'ruidoso';

/** Cómo se entera el flujo de que este envío falló, o null si no se entera. */
export function verificacion(f: Flujo, n: Nodo): Verificacion | null {
  const sig = salidasDe(f, n.name);
  if (n.onError === 'continueErrorOutput' && (sig[1] ?? []).length > 0) return 'salida-de-error';
  if (n.onError === 'continueRegularOutput') {
    const nodos = sig.flat().map((s) => porNombre(f, s)).filter((x): x is Nodo => !!x);
    // Un Code que «solo actúa si corrió» otro nodo (`isExecuted`) verifica UN origen: si el envío lo
    // alimentan varios, los demás quedan sin verificador (Demo B, `Avisar al dueño`, 03/10).
    const condicional = (x: Nodo) => esCode(x) && /isExecuted/.test(codigo(x)) && predecesores(f, n.name).length > 1;
    if (nodos.length && nodos.every((x) => (esCode(x) || esIf(x)) && leeId(x) && !condicional(x))) return 'verificador-inmediato';
    // IF sobre `error` cuyas salidas que no son otro envío son verificadores del id.
    if (nodos.length && nodos.every((x) => esIf(x) && /error/.test(texto(x)))) {
      const resto = nodos.flatMap((x) => sucesores(f, x.name)).map((s) => porNombre(f, s)).filter((x): x is Nodo => !!x && !esEnvio(x));
      if (resto.length && resto.every((x) => (esCode(x) || esIf(x)) && leeId(x))) return 'verificador-inmediato';
    }
  }
  if (sumideroDe(f, n).length) return 'sumidero-por-nombre';
  if (esRuidoso(f, n)) return 'ruidoso';
  return null;
}

/** «Ruidoso»: si el texto falla, n8n detiene la ejecución con error (el comportamiento por defecto). */
function esRuidoso(f: Flujo, n: Nodo): boolean {
  return (n.onError === undefined || n.onError === 'stopWorkflow') && clase(n, f) === 'texto';
}

// ---------------------------------------------------------------------------
// Las reglas
// ---------------------------------------------------------------------------

export interface Violacion { regla: number; nodo: string; detalle: string }

const enviosClienteTexto = (f: Flujo, nombres: Iterable<string>): string[] =>
  [...nombres].filter((s) => { const x = porNombre(f, s); return !!x && esEnvio(x) && destino(x) === 'cliente' && clase(x, f) === 'texto'; });

/** Regla 2 para un envío al cliente: ¿tiene camino de fallo al cliente? Se mira SOLO lo que cuelga de su camino de fallo. */
export function cumpleRegla2(f: Flujo, n: Nodo): boolean {
  const desde = alcanceDeFallo(f, n);
  desde.delete(n.name);
  if (enviosClienteTexto(f, desde).length) return true;
  if (clase(n, f) !== 'texto') return false;
  if (esRuidoso(f, n)) return true;
  const verificadores = [...[...desde].map((s) => porNombre(f, s)).filter((x): x is Nodo => !!x && esCode(x) && leeId(x)), ...sumideroDe(f, n)];
  if (verificadores.some((c) => /\bthrow\b/.test(codigo(c)))) return true;
  return [...desde].some((s) => { const x = porNombre(f, s); return !!x && !esEnvio(x) && texto(x).includes('envio_fallido'); });
}

const esIngestaSaliente = (n: Nodo): boolean =>
  tipo(n) === 'httpRequest' && String(n.parameters['url'] ?? '').includes('/ingesta') && /direccion['"]?\s*:\s*\\?['"]saliente/.test(texto(n).replace(/\\"/g, '"'));

/** Regla 3: todo camino hacia atrás desde el reporte hasta un envío pasa por una puerta. Devuelve los envíos sin puerta. */
function enviosSinPuerta(f: Flujo, reporte: string): string[] {
  const malos = new Set<string>();
  const vistos = new Set<string>();
  const pendientes = [reporte];
  while (pendientes.length) {
    const actual = pendientes.pop() as string;
    for (const { de, salida } of predecesores(f, actual)) {
      const p = porNombre(f, de);
      if (!p) continue;
      if (esEnvio(p)) {
        const v = verificacion(f, p);
        if (salida === 0 && (v === 'salida-de-error' || v === 'ruidoso')) continue;
        malos.add(p.name);
        continue;
      }
      if (leeId(p)) continue; // la puerta
      if (vistos.has(de)) continue;
      vistos.add(de);
      pendientes.push(de);
    }
  }
  return [...malos];
}

/** Marcas de comando de un prompt: `[MAYUSCULAS_CON_GUION]`, no los delimitadores de sección. */
export const marcasDelPrompt = (prompt: string): string[] =>
  [...new Set([...prompt.matchAll(/\[([A-ZÁÉÍÓÚ]{3,}(?:_[A-ZÁÉÍÓÚ]+)*)\]/g)].map((m) => `[${m[1]}]`))];

const ANUNCIOS_CODIGO: { id: 'qr' | 'boton' | 'aviso'; re: RegExp }[] = [
  { id: 'qr', re: /aqu[ií] tienes el (c[oó]digo )?qr|te (env[ií]o|mando) el qr|a continuaci[oó]n (te|le) llega/i },
  { id: 'boton', re: /toca(r|ndo)? el bot[oó]n|t[oó]cale el bot[oó]n/i },
  { id: 'aviso', re: /ya le avis[eé]|le aviso a|ya le pas[eé]|te escribe por ac[aá]|tomar[aá] el chat/i },
];

type Mecanismo = 'qr' | 'contacto' | 'aviso';
const ANUNCIOS_PROMPT: { id: string; re: RegExp; mec: Mecanismo }[] = [
  { id: 'a-continuacion-llega', re: /a continuaci[oó]n (le|te) llega/, mec: 'qr' },
  { id: 'avisa-que-un-humano', re: /avisa que un humano/, mec: 'aviso' },
  { id: 'le-pasas-el-contacto', re: /le pasas el contacto/, mec: 'contacto' },
  { id: 'se-lo-mandas-de-nuevo', re: /se lo mand[aá]s de nuevo/, mec: 'qr' },
];

const textoDelPrompt = (n: Nodo): string => {
  const o = (n.parameters['options'] ?? {}) as Record<string, unknown>;
  return typeof o['systemMessage'] === 'string' ? o['systemMessage'] : '';
};
const esAgente = (n: Nodo): boolean => n.type === '@n8n/n8n-nodes-langchain.agent';

export function violaciones(f: Flujo): Violacion[] {
  const v: Violacion[] = [];
  const conversacional = !esProgramado(f);
  const envios = enviosDe(f);
  const sumaVerificado = (n: Nodo): boolean => verificacion(f, n) !== null;

  // 1 y 2
  for (const n of envios) {
    if (!sumaVerificado(n)) {
      v.push({ regla: 1, nodo: n.name, detalle: `«${n.name}» (${n.onError ?? 'sin onError'}) no tiene verificación: ni salida de error conectada, ni verificador del id, ni sumidero que lo nombre, ni es un texto que corta con error` });
    }
    if (conversacional && destino(n) === 'cliente' && !cumpleRegla2(f, n)) {
      v.push({ regla: 2, nodo: n.name, detalle: `«${n.name}» (${clase(n, f)}) no tiene camino de fallo al cliente: ${clase(n, f) === 'texto' ? 'su texto no corta con error, no hay otro texto al cliente, ni throw, ni envio_fallido' : 'desde él no se alcanza otro envío de texto al cliente'}` });
    }
  }

  // 3
  for (const r of f.nodes.filter(esIngestaSaliente)) {
    if (!/idMeta/.test(texto(r))) v.push({ regla: 3, nodo: r.name, detalle: `«${r.name}» reporta un saliente sin idMeta` });
    for (const e of enviosSinPuerta(f, r.name)) {
      v.push({ regla: 3, nodo: `${r.name}::${e}`, detalle: `un camino de «${e}» a «${r.name}» no pasa por una puerta que lea el id` });
    }
  }

  // 4
  const codes = f.nodes.filter(esCode);
  for (const a of f.nodes.filter(esAgente)) {
    for (const marca of marcasDelPrompt(textoDelPrompt(a))) {
      const re = new RegExp(`\\\\?\\[${marca.slice(1, -1)}\\\\?\\]`);
      const consumidores = codes.filter((c) => re.test(codigo(c)));
      const alcanzaEnvio = consumidores.some((c) => [...alcanza(f, c.name)].some((s) => { const x = porNombre(f, s); return !!x && esEnvio(x); }));
      if (!consumidores.length) v.push({ regla: 4, nodo: `${a.name}::${marca}`, detalle: `la marca ${marca} del prompt de «${a.name}» no la consume ningún Code` });
      else if (!alcanzaEnvio) v.push({ regla: 4, nodo: `${a.name}::${marca}`, detalle: `la marca ${marca} la consume un Code, pero desde él no se alcanza ningún envío` });
    }
  }

  // 5
  const imagenesOk = envios.filter((e) => clase(e, f) === 'imagen' && destino(e) === 'cliente' && cumpleRegla2(f, e)).map((e) => e.name);
  for (const c of codes) {
    const { literales } = tokenizar(String(c.parameters['jsCode'] ?? ''));
    for (const { id, re } of ANUNCIOS_CODIGO) {
      if (!literales.some((l) => re.test(l))) continue;
      const desde = alcanza(f, c.name);
      if (id === 'qr' && !imagenesOk.some((e) => desde.has(e))) {
        v.push({ regla: 5, nodo: `${c.name}::qr`, detalle: `«${c.name}» anuncia el QR pero desde él no se alcanza un envío de imagen con respaldo al cliente` });
      }
      if (id === 'boton' && !f.nodes.some((n) => texto(n).includes('cta_url'))) {
        v.push({ regla: 5, nodo: `${c.name}::boton`, detalle: `«${c.name}» anuncia un botón y el flujo no tiene ningún nodo con cta_url` });
      }
      if (id === 'aviso') {
        const alcanzableDesdeAviso = envios.some((e) => destino(e) === 'negocio' && alcanza(f, e.name).has(c.name));
        const nombraAviso = envios.some((e) => destino(e) === 'negocio' && codigo(c).includes(`'${e.name}'`) && leeWamid(codigo(c)));
        if (!alcanzableDesdeAviso && !nombraAviso) {
          v.push({ regla: 5, nodo: `${c.name}::aviso`, detalle: `«${c.name}» dice que ya se avisó, pero no es alcanzable desde un envío al negocio ni lo nombra leyendo el id` });
        }
      }
    }
  }

  // 6
  for (const a of f.nodes.filter(esAgente)) {
    const prompt = textoDelPrompt(a);
    for (const { id, re, mec } of ANUNCIOS_PROMPT) {
      if (!re.test(prompt)) continue;
      const alcanceOk = (nodos: Nodo[]) => nodos.length > 0 && nodos.every((x) => cumpleRegla2(f, x));
      const clientes = envios.filter((e) => destino(e) === 'cliente');
      const mecanismo = mec === 'qr' ? clientes.filter((e) => clase(e, f) === 'imagen')
        : mec === 'contacto' ? clientes.filter((e) => clase(e, f) === 'boton')
          : envios.filter((e) => destino(e) === 'negocio').filter((e) => [...alcanza(f, e.name)].some((s) => enviosClienteTexto(f, [s]).length));
      const ok = mec === 'aviso' ? mecanismo.length > 0 : alcanceOk(mecanismo);
      const quien = mec === 'aviso' ? 'ningún aviso al negocio del que dependa el texto al cliente (R4)' : (mecanismo.map((m) => m.name).join(', ') || 'no existe');
      if (!ok) v.push({ regla: 6, nodo: `${a.name}::${id}`, detalle: `el prompt de «${a.name}» anuncia «${id}» y su mecanismo no cumple la regla 2 (${quien})` });
    }
  }

  // 7. Un nodo que habla con Graph y que esta suite no sabe clasificar como envío: una puerta lateral que ninguna
  // regla vería (sondas I, K y L). Las lecturas (GET) son de medios y perfil: no envían.
  for (const n of f.nodes) {
    const url = String((n.parameters ?? {})['url'] ?? '');
    const metodo = String((n.parameters ?? {})['method'] ?? 'GET').toUpperCase();
    if (url.includes('graph.facebook') && metodo !== 'GET' && !esEnvio(n)) {
      v.push({ regla: 7, nodo: n.name, detalle: `«${n.name}» (${n.type}, ${metodo}) escribe en Graph y esta suite no lo clasifica como envío` });
    }
  }
  return v;
}

export const clave = (archivo: string, regla: number, nodo: string): string => `${archivo}#${regla}#${nodo}`;

export interface Excepcion { porque: string; vence: string }

/**
 * ATENCIÓN: cambiar esta línea, `TOPE_DE_EXCEPCIONES` o cualquier `vence` EXIGE pasar por el agente `seguridad`
 * (revisión del #379): son los topes que impiden que el mapa de excepciones sea un cheque en blanco.
 *
 * La fecha de alta del mapa: ninguna excepción vence más de 90 días después (2026-10-03 + 90 = 2027-01-01). */
export const ALTA_DE_EXCEPCIONES = '2026-10-03';
/** ATENCIÓN: cambiar este tope exige pasar por el agente `seguridad`. Cuántas excepciones hay hoy. SOLO BAJA: una excepción nueva exige bajar otra, o un PR que cambie este tope y lo justifique. */
export const TOPE_DE_EXCEPCIONES = 49;

/**
 * `archivo#regla#nodo` → { por qué; qué PR la cierra, y hasta cuándo vale }. EMPIEZA con cada
 * violación real que encontró la suite el 03/10/2026.
 */
export const EXCEPCIONES: Record<string, Excepcion> = {
  'bellido-agendamiento.json#1#Enviar ubicación': {
    porque: 'flujo A de Bellido, descartado el 01/10 (corre B); D9: la cierra PR-6, que deja a B como único flujo de Bellido y retira o declara este JSON',
    vence: '2027-01-01',
  },
  'bellido-agendamiento.json#2#Enviar ubicación': {
    porque: 'flujo A de Bellido, descartado el 01/10 (corre B); D9: la cierra PR-6, que deja a B como único flujo de Bellido y retira o declara este JSON',
    vence: '2027-01-01',
  },
  'bellido-agendamiento.json#1#Enviar contacto': {
    porque: 'flujo A de Bellido, descartado el 01/10 (corre B); D9: la cierra PR-6, que deja a B como único flujo de Bellido y retira o declara este JSON',
    vence: '2027-01-01',
  },
  'bellido-agendamiento.json#2#Enviar contacto': {
    porque: 'flujo A de Bellido, descartado el 01/10 (corre B); D9: la cierra PR-6, que deja a B como único flujo de Bellido y retira o declara este JSON',
    vence: '2027-01-01',
  },
  'bellido-agendamiento.json#2#Enviar QR de la seña': {
    porque: 'flujo A de Bellido, descartado el 01/10 (corre B); D9: la cierra PR-6, que deja a B como único flujo de Bellido y retira o declara este JSON',
    vence: '2027-01-01',
  },
  'bellido-agendamiento.json#1#Redes del doctor': {
    porque: 'flujo A de Bellido, descartado el 01/10 (corre B); D9: la cierra PR-6, que deja a B como único flujo de Bellido y retira o declara este JSON',
    vence: '2027-01-01',
  },
  'bellido-agendamiento.json#2#Redes del doctor': {
    porque: 'flujo A de Bellido, descartado el 01/10 (corre B); D9: la cierra PR-6, que deja a B como único flujo de Bellido y retira o declara este JSON',
    vence: '2027-01-01',
  },
  'bellido-agendamiento.json#1#Avisar al doctor (texto)': {
    porque: 'flujo A de Bellido, descartado el 01/10 (corre B); D9: la cierra PR-6, que deja a B como único flujo de Bellido y retira o declara este JSON',
    vence: '2027-01-01',
  },
  'bellido-agendamiento.json#3#Reportar ubicación (saliente)::Enviar ubicación': {
    porque: 'flujo A de Bellido, descartado el 01/10 (corre B); D9: la cierra PR-6, que deja a B como único flujo de Bellido y retira o declara este JSON',
    vence: '2027-01-01',
  },
  'bellido-agendamiento.json#3#Reportar contacto (saliente)::Enviar contacto': {
    porque: 'flujo A de Bellido, descartado el 01/10 (corre B); D9: la cierra PR-6, que deja a B como único flujo de Bellido y retira o declara este JSON',
    vence: '2027-01-01',
  },
  'bellido-agendamiento.json#3#Reportar redes (saliente)::Redes del doctor': {
    porque: 'flujo A de Bellido, descartado el 01/10 (corre B); D9: la cierra PR-6, que deja a B como único flujo de Bellido y retira o declara este JSON',
    vence: '2027-01-01',
  },
  'bellido-agendamiento.json#5#Procesar respuesta::aviso': {
    porque: 'flujo A de Bellido, descartado el 01/10 (corre B); D9: la cierra PR-6, que deja a B como único flujo de Bellido y retira o declara este JSON',
    vence: '2027-01-01',
  },
  'bellido-agendamiento.json#6#AI Agent (Sofía)::avisa-que-un-humano': {
    porque: 'flujo A de Bellido, descartado el 01/10 (corre B); D9: la cierra PR-6, que deja a B como único flujo de Bellido y retira o declara este JSON',
    vence: '2027-01-01',
  },
  'demo-a-agendamiento.json#1#Enviar ubicación': {
    porque: '«Enviar contacto/ubicación» (continueErrorOutput) con la salida de error sin conectar: el texto dice «toca el botón» y no hay botón; la cierra PR-5 (Demo A)',
    vence: '2027-01-01',
  },
  'demo-a-agendamiento.json#2#Enviar ubicación': {
    porque: 'el fallo del envío no llega al cliente (el aviso o nada, sin texto de respaldo con botón); la cierra PR-5 (Demo A)',
    vence: '2027-01-01',
  },
  'demo-a-agendamiento.json#1#Enviar contacto': {
    porque: '«Enviar contacto/ubicación» (continueErrorOutput) con la salida de error sin conectar: el texto dice «toca el botón» y no hay botón; la cierra PR-5 (Demo A)',
    vence: '2027-01-01',
  },
  'demo-a-agendamiento.json#2#Enviar contacto': {
    porque: 'el fallo del envío no llega al cliente (el aviso o nada, sin texto de respaldo con botón); la cierra PR-5 (Demo A)',
    vence: '2027-01-01',
  },
  'demo-a-agendamiento.json#2#Enviar QR de la seña': {
    porque: 'el fallo del envío no llega al cliente (el aviso o nada, sin texto de respaldo con botón); la cierra PR-5 (Demo A)',
    vence: '2027-01-01',
  },
  'demo-a-agendamiento.json#3#Reportar ubicación (saliente)::Enviar ubicación': {
    porque: 'el reporte saliente cuelga del envío sin puerta que lea el id; la cierra PR-5 (Demo A)',
    vence: '2027-01-01',
  },
  'demo-a-agendamiento.json#3#Reportar contacto (saliente)::Enviar contacto': {
    porque: 'el reporte saliente cuelga del envío sin puerta que lea el id; la cierra PR-5 (Demo A)',
    vence: '2027-01-01',
  },
  'demo-a-agendamiento.json#5#Procesar respuesta::aviso': {
    porque: '«Un humano tomará el chat» sale antes de que el aviso a recepción salga y no depende de él (R4); la cierra PR-5 (Demo A)',
    vence: '2027-01-01',
  },
  'demo-a-agendamiento.json#6#AI Agent (Sofía)::a-continuacion-llega': {
    porque: 'el prompt promete un mecanismo (QR, contacto, aviso) sin respaldo de entrega; la cierra PR-5 (Demo A)',
    vence: '2027-01-01',
  },
  'demo-a-agendamiento.json#6#AI Agent (Sofía)::avisa-que-un-humano': {
    porque: 'el prompt promete un mecanismo (QR, contacto, aviso) sin respaldo de entrega; la cierra PR-5 (Demo A)',
    vence: '2027-01-01',
  },
  'demo-a-agendamiento.json#6#AI Agent (Sofía)::le-pasas-el-contacto': {
    porque: 'el prompt promete un mecanismo (QR, contacto, aviso) sin respaldo de entrega; la cierra PR-5 (Demo A)',
    vence: '2027-01-01',
  },
  'demo-a-agendamiento.json#6#AI Agent (Sofía)::se-lo-mandas-de-nuevo': {
    porque: 'el prompt promete un mecanismo (QR, contacto, aviso) sin respaldo de entrega; la cierra PR-5 (Demo A)',
    vence: '2027-01-01',
  },
  'demo-b-venta-cobro.json#1#Avisar al dueño': {
    porque: 'falla callada del aviso en pedido, cobro y uso extendido: el único verificador (Marcar aviso de transferencia) actúa solo para la transferencia; la cierra PR-4 (Demo B resto)',
    vence: '2027-01-01',
  },
  'demo-b-venta-cobro.json#5#Procesar respuesta::aviso': {
    porque: '«le aviso» / «ya le avisé» se dice en el mismo texto antes de que el aviso salga y sin depender de él (R4); la cierra PR-4 (Demo B resto)',
    vence: '2027-01-01',
  },
  'experimental/agenda-minima/agenda-minima.v0.json#1#Enviar a WhatsApp': {
    porque: 'Bellido B (agenda mínima): ¿Falló el envío? mira solo $json.error, el respaldo no tiene último recurso (error visible) y el reporte saliente no verifica el id; la cierra PR-6 (Bellido B, ventana 2 a 3)',
    vence: '2027-01-01',
  },
  'experimental/agenda-minima/agenda-minima.v0.json#1#Enviar respaldo': {
    porque: 'Bellido B (agenda mínima): ¿Falló el envío? mira solo $json.error, el respaldo no tiene último recurso (error visible) y el reporte saliente no verifica el id; la cierra PR-6 (Bellido B, ventana 2 a 3)',
    vence: '2027-01-01',
  },
  'experimental/agenda-minima/agenda-minima.v0.json#2#Enviar respaldo': {
    porque: 'Bellido B (agenda mínima): ¿Falló el envío? mira solo $json.error, el respaldo no tiene último recurso (error visible) y el reporte saliente no verifica el id; la cierra PR-6 (Bellido B, ventana 2 a 3)',
    vence: '2027-01-01',
  },
  'experimental/agenda-minima/agenda-minima.v0.json#3#Reportar mensaje (saliente)::Enviar respaldo': {
    porque: 'Bellido B (agenda mínima): ¿Falló el envío? mira solo $json.error, el respaldo no tiene último recurso (error visible) y el reporte saliente no verifica el id; la cierra PR-6 (Bellido B, ventana 2 a 3)',
    vence: '2027-01-01',
  },
  'experimental/agenda-minima/agenda-minima.v0.json#3#Reportar mensaje (saliente)::Enviar a WhatsApp': {
    porque: 'Bellido B (agenda mínima): ¿Falló el envío? mira solo $json.error, el respaldo no tiene último recurso (error visible) y el reporte saliente no verifica el id; la cierra PR-6 (Bellido B, ventana 2 a 3)',
    vence: '2027-01-01',
  },
  'experimental/agenda-minima/agenda-minima.v0.json#5#Config del negocio::aviso': {
    porque: 'Bellido B: «Ya le avisé al doctor» sale en la misma tanda que la plantilla de emergencia y no depende de que salga (gravedad alta, emergencia clínica); D4 con el doctor; la cierra PR-6 (Bellido B, ventana 2 a 3)',
    vence: '2027-01-01',
  },
  'experimental/agenda-minima/agenda-minima.v0.json#5#Armar mensajes::aviso': {
    porque: 'Bellido B: «Ya le avisé al doctor» sale en la misma tanda que la plantilla de emergencia y no depende de que salga (gravedad alta, emergencia clínica); D4 con el doctor; la cierra PR-6 (Bellido B, ventana 2 a 3)',
    vence: '2027-01-01',
  },
  'experimental/venta-minima/venta-minima.ensayo-demo-a.json#2#Enviar respaldo': {
    porque: 'Q\'Taco: cumple R2 y R4 pero «Enviar respaldo» es el último recurso y no termina en error visible ni reporta envio_fallido (D11); la cierra PR-7 (Q\'Taco, ventana y ensayo; D3)',
    vence: '2027-01-01',
  },
  'experimental/venta-minima/venta-minima.qtaco.json#2#Enviar respaldo': {
    porque: 'Q\'Taco: cumple R2 y R4 pero «Enviar respaldo» es el último recurso y no termina en error visible ni reporta envio_fallido (D11); la cierra PR-7 (Q\'Taco, ventana y ensayo; D3)',
    vence: '2027-01-01',
  },
  'novuchat-onboarding.json#5#Traspaso a un asesor::aviso': {
    porque: 'captación: «Ya le pasé tus datos» sale antes del aviso a NovuChat y no depende de él (R4); la cierra PR-8 (captación R4, después del traspaso)',
    vence: '2027-01-01',
  },
  'platinum-agendamiento.json#1#Enviar ubicación': {
    porque: 'Platinum es un demo con JSON desalineado de Demo A; D8: excepción declarada hasta que PR-5 o F3b lo reconstruya sobre el core',
    vence: '2027-01-01',
  },
  'platinum-agendamiento.json#2#Enviar ubicación': {
    porque: 'Platinum es un demo con JSON desalineado de Demo A; D8: excepción declarada hasta que PR-5 o F3b lo reconstruya sobre el core',
    vence: '2027-01-01',
  },
  'platinum-agendamiento.json#1#Enviar contacto': {
    porque: 'Platinum es un demo con JSON desalineado de Demo A; D8: excepción declarada hasta que PR-5 o F3b lo reconstruya sobre el core',
    vence: '2027-01-01',
  },
  'platinum-agendamiento.json#2#Enviar contacto': {
    porque: 'Platinum es un demo con JSON desalineado de Demo A; D8: excepción declarada hasta que PR-5 o F3b lo reconstruya sobre el core',
    vence: '2027-01-01',
  },
  'platinum-agendamiento.json#2#Enviar QR de la seña': {
    porque: 'Platinum es un demo con JSON desalineado de Demo A; D8: excepción declarada hasta que PR-5 o F3b lo reconstruya sobre el core',
    vence: '2027-01-01',
  },
  'platinum-agendamiento.json#3#Reportar ubicación (saliente)::Enviar ubicación': {
    porque: 'Platinum es un demo con JSON desalineado de Demo A; D8: excepción declarada hasta que PR-5 o F3b lo reconstruya sobre el core',
    vence: '2027-01-01',
  },
  'platinum-agendamiento.json#3#Reportar contacto (saliente)::Enviar contacto': {
    porque: 'Platinum es un demo con JSON desalineado de Demo A; D8: excepción declarada hasta que PR-5 o F3b lo reconstruya sobre el core',
    vence: '2027-01-01',
  },
  'platinum-agendamiento.json#5#Procesar respuesta::aviso': {
    porque: 'Platinum es un demo con JSON desalineado de Demo A; D8: excepción declarada hasta que PR-5 o F3b lo reconstruya sobre el core',
    vence: '2027-01-01',
  },
  'platinum-agendamiento.json#6#AI Agent (Sofía)::a-continuacion-llega': {
    porque: 'Platinum es un demo con JSON desalineado de Demo A; D8: excepción declarada hasta que PR-5 o F3b lo reconstruya sobre el core',
    vence: '2027-01-01',
  },
  'platinum-agendamiento.json#6#AI Agent (Sofía)::avisa-que-un-humano': {
    porque: 'Platinum es un demo con JSON desalineado de Demo A; D8: excepción declarada hasta que PR-5 o F3b lo reconstruya sobre el core',
    vence: '2027-01-01',
  },
  'platinum-agendamiento.json#6#AI Agent (Sofía)::le-pasas-el-contacto': {
    porque: 'Platinum es un demo con JSON desalineado de Demo A; D8: excepción declarada hasta que PR-5 o F3b lo reconstruya sobre el core',
    vence: '2027-01-01',
  },
  'platinum-agendamiento.json#6#AI Agent (Sofía)::se-lo-mandas-de-nuevo': {
    porque: 'Platinum es un demo con JSON desalineado de Demo A; D8: excepción declarada hasta que PR-5 o F3b lo reconstruya sobre el core',
    vence: '2027-01-01',
  },
};


// ---------------------------------------------------------------------------
// Excepciones: ni vencidas ni sobre algo que no existe
// ---------------------------------------------------------------------------

/** Los nodos que una clave nombra: en la regla 3, el reporte y el envío; en las 4 a 6, lo que va tras «::» es una etiqueta. */
const nodoDeClave = (regla: string, nodo: string): string[] => (regla === '3' ? nodo.split('::') : [nodo.split('::')[0] as string]);

/**
 * Lo que está mal con el mapa de excepciones frente a las violaciones de hoy:
 * una excepción que ya no se aplica (vencida: la cerró un PR y hay que
 * borrarla), una que nombra un archivo o un nodo que no existe, o una sin
 * motivo ni PR que la cierre.
 */
export function problemasDeExcepciones(
  hoy: Map<string, Violacion[]>,
  excepciones: Record<string, Excepcion>,
  existeNodo: (archivo: string, nodo: string) => boolean,
  ahora: Date = new Date(),
  alta: string = ALTA_DE_EXCEPCIONES,
): string[] {
  const p: string[] = [];
  const limite = new Date(`${alta}T00:00:00Z`).getTime() + 90 * 86_400_000;
  for (const [k, { porque, vence }] of Object.entries(excepciones)) {
    const [archivo = '', regla = '', ...resto] = k.split('#');
    const nodo = resto.join('#');
    const vivas = hoy.get(archivo);
    if (!vivas) { p.push(`${k}: nombra un archivo que no existe`); continue; }
    if (!nodoDeClave(regla, nodo).every((n) => existeNodo(archivo, n))) { p.push(`${k}: nombra un nodo que no existe`); continue; }
    if (!vivas.some((x) => String(x.regla) === regla && x.nodo === nodo)) p.push(`${k}: VENCIDA, el flujo ya la cumple; hay que borrarla`);
    if (!/\bPR-\d+\b/.test(porque)) p.push(`${k}: no dice qué PR la cierra (PR-N)`);
    const t = /^\d{4}-\d{2}-\d{2}$/.test(vence) ? new Date(`${vence}T00:00:00Z`).getTime() : NaN;
    if (Number.isNaN(t)) p.push(`${k}: «vence» no es una fecha AAAA-MM-DD`);
    else if (t > limite) p.push(`${k}: vence ${vence}, a más de 90 días del alta (${alta})`);
    else if (ahora.getTime() > t) p.push(`${k}: VENCIÓ el ${vence}: o se cierra el PR que la quita, o se renueva con una decisión de Andres`);
  }
  return p;
}

const ARCHIVOS = flujos();
const FLUJOS = new Map(ARCHIVOS.map((a) => [a, leer(a)]));
const HOY = new Map([...FLUJOS].map(([a, f]) => [a, violaciones(f)]));
const existeNodo = (archivo: string, nodo: string): boolean => !!FLUJOS.get(archivo)?.nodes.some((n) => n.name === nodo);

describe('Entregas: los flujos del disco', () => {
  it('se descubren del disco: los 8 de Flujos/ y los de experimental/, sin locales, plantillas ni de prueba', () => {
    expect(ARCHIVOS.filter((a) => !a.includes('/')).length).toBeGreaterThanOrEqual(8);
    expect(ARCHIVOS).toEqual(expect.arrayContaining([
      'bellido-agendamiento.json', 'demo-a-agendamiento.json', 'demo-b-venta-cobro.json', 'novuchat-onboarding.json',
      'platinum-agendamiento.json', 'agendamiento-seguimientos.json', 'demo-a-recordatorios.json',
      'experimental/agenda-minima/agenda-minima.v0.json', 'experimental/venta-minima/venta-minima.qtaco.json',
    ]));
    for (const a of ARCHIVOS) expect(a, a).not.toMatch(EXCLUIDO);
  });

  it('los programados se reconocen por su disparador, no por su nombre', () => {
    for (const a of ['agendamiento-seguimientos.json', 'agendamiento-senas-vencidas.json', 'demo-a-recordatorios.json']) {
      expect(esProgramado(FLUJOS.get(a) as Flujo), a).toBe(true);
    }
    for (const a of ['demo-b-venta-cobro.json', 'novuchat-onboarding.json']) expect(esProgramado(FLUJOS.get(a) as Flujo), a).toBe(false);
  });

  it.each(ARCHIVOS)('%s: no tiene violaciones fuera de las excepciones declaradas', (archivo) => {
    const sin = (HOY.get(archivo) ?? []).filter((x) => !(clave(archivo, x.regla, x.nodo) in EXCEPCIONES));
    expect(sin.map((x) => `regla ${x.regla}: ${x.detalle}`), `${archivo}:\n  - ${sin.map((x) => x.detalle).join('\n  - ')}`).toEqual([]);
  });

  it('ninguna excepción está vencida, nombra algo que no existe, carece de PR o de fecha, o pasó su fecha', () => {
    expect(problemasDeExcepciones(HOY, EXCEPCIONES, existeNodo)).toEqual([]);
  });

  it('el mapa de excepciones solo puede bajar', () => {
    expect(Object.keys(EXCEPCIONES).length).toBeLessThanOrEqual(TOPE_DE_EXCEPCIONES);
  });
});

// ---------------------------------------------------------------------------
// Contrapruebas: flujos en memoria que DEBEN fallar nombrando el nodo
// ---------------------------------------------------------------------------

type Arista = [string, string, number?];
const GRAPH = 'https://graph.facebook.com/v26.0/{{ $json.phoneNumberId }}/messages';

const nodoMem = (name: string, tipoNodo: string, parameters: Record<string, unknown> = {}, onError?: string): Nodo =>
  ({ name, type: `n8n-nodes-base.${tipoNodo}`, parameters, ...(onError ? { onError } : {}) });
const envioHttp = (name: string, tipoMsg: string, onError?: string, para = '$json.from'): Nodo =>
  nodoMem(name, 'httpRequest', { method: 'POST', url: `=${GRAPH}`, jsonBody: `={{ JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: ${para}, type: '${tipoMsg}' }) }}` }, onError);
const envioDinamico = (name: string, onError?: string): Nodo =>
  nodoMem(name, 'httpRequest', { method: 'POST', url: `=${GRAPH}`, jsonBody: '={{ JSON.stringify($json.payload) }}' }, onError);
const avisoWa = (name: string): Nodo => nodoMem(name, 'whatsApp', { operation: 'send', recipientPhoneNumber: '={{ $json.numeroDueno }}', textBody: 'aviso' });
const clienteWa = (name: string): Nodo => nodoMem(name, 'whatsApp', { operation: 'send', recipientPhoneNumber: '={{ $json.from }}', textBody: 'hola' });
const code = (name: string, jsCode: string): Nodo => nodoMem(name, 'code', { jsCode });
const si = (name: string, expr: string): Nodo => nodoMem(name, 'if', { conditions: { conditions: [{ leftValue: `={{ ${expr} }}` }] } });
const reporte = (name: string, conId = true): Nodo => nodoMem(name, 'httpRequest', {
  method: 'POST', url: 'https://x.cloudfunctions.net/ingesta',
  jsonBody: `={{ JSON.stringify({ telefono: $json.from, direccion: 'saliente', tipo: 'texto'${conId ? ', idMeta: (($json.messages || [])[0] || {}).id || \'\'' : ''} }) }}`,
});
const agente = (name: string, prompt: string): Nodo =>
  ({ name, type: '@n8n/n8n-nodes-langchain.agent', parameters: { options: { systemMessage: prompt } } });
const mem = (nodes: Nodo[], aristas: Arista[]): Flujo => {
  const connections: Flujo['connections'] = {};
  for (const [de, a, salida = 0] of aristas) {
    const c = (connections[de] ??= { main: [] }) as { main: { node: string; type: string; index: number }[][] };
    while (c.main.length <= salida) c.main.push([]);
    (c.main[salida] as { node: string; type: string; index: number }[]).push({ node: a, type: 'main', index: 0 });
  }
  return { name: 'mem', nodes, connections };
};
const reglasDe = (f: Flujo): string[] => violaciones(f).map((x) => `${x.regla}:${x.nodo}`);

const ID = '(($json.messages || [])[0] || {}).id';

/**
 * Réplica mínima del DISEÑO OBJETIVO de Venta mínima: el id decide, y el respaldo termina en error visible
 * (`Entrega fallida`). No es lo que corre hoy en Q'Taco, que todavía no tiene ese último recurso (PR-7).
 */
const ventaMinima = (): Flujo => mem([
  code('Armar mensajes', 'return $input.all();'),
  envioDinamico('Enviar a WhatsApp', 'continueRegularOutput'),
  si('¿Falló el envío?', '!!($json && $json.error)'),
  envioHttp('Enviar respaldo', 'text', 'continueRegularOutput'),
  si('¿Reportar? (saliente)', `!!${ID}`),
  reporte('Reportar mensaje (saliente)'),
  code('Entrega fallida', `const j = $input.first().json; if (!${ID.replace('$json', 'j')}) { throw new Error('envio_fallido: messages[0].id vacío'); } return [];`),
], [
  ['Armar mensajes', 'Enviar a WhatsApp'], ['Enviar a WhatsApp', '¿Falló el envío?'],
  ['¿Falló el envío?', 'Enviar respaldo', 0], ['¿Falló el envío?', '¿Reportar? (saliente)', 1],
  ['Enviar respaldo', '¿Reportar? (saliente)'], ['¿Reportar? (saliente)', 'Reportar mensaje (saliente)', 0],
  ['¿Reportar? (saliente)', 'Entrega fallida', 1],
]);

/** Réplica mínima de Captación: el sumidero `Confirmar envío` nombra los envíos, lee el estado y lanza. */
const captacion = (): Flujo => mem([
  code('Salida', 'return $input.all();'),
  envioDinamico('Enviar a WhatsApp', 'continueRegularOutput'),
  si('¿Falló el interactivo?', 'Number($json.statusCode) >= 400'),
  envioDinamico('Enviar texto de respaldo', 'continueRegularOutput'),
  code('Confirmar envío', `const a = $('Enviar a WhatsApp').first().json; const r = $('Enviar texto de respaldo').all(); if (Number(a.statusCode) >= 400 && !r.length) { throw new Error('Meta rechazó el mensaje'); } return [{ json: { idMeta: ${ID.replace('$json', 'a.body')}, statusCode: a.statusCode } }];`),
  reporte('Reportar mensaje (saliente)'),
], [
  ['Salida', 'Enviar a WhatsApp'], ['Enviar a WhatsApp', '¿Falló el interactivo?'], ['¿Falló el interactivo?', 'Enviar texto de respaldo'],
  ['Salida', 'Confirmar envío'], ['Confirmar envío', 'Reportar mensaje (saliente)'],
]);

describe('Entregas: contrapruebas (cada una falla nombrando el nodo)', () => {
  it('controles positivos: la réplica de Venta mínima y la de Captación pasan las seis reglas', () => {
    expect(reglasDe(ventaMinima())).toEqual([]);
    expect(reglasDe(captacion())).toEqual([]);
  });

  it('regla 1: un envío con la salida de error vacía falla', () => {
    const f = mem([envioHttp('Enviar QR', 'image', 'continueErrorOutput'), clienteWa('Responder al cliente')], [['Enviar QR', 'Responder al cliente', 0]]);
    expect(reglasDe(f)).toContain('1:Enviar QR');
  });

  it('regla 1: continueErrorOutput con la salida de error conectada sí tiene verificación', () => {
    const f = mem([envioHttp('Enviar QR', 'image', 'continueErrorOutput'), clienteWa('Responder al cliente')], [['Enviar QR', 'Responder al cliente', 1]]);
    expect(reglasDe(f)).not.toContain('1:Enviar QR');
  });

  it('regla 1: un IF que mira solo $json.error NO verifica el id', () => {
    const f = mem([
      envioHttp('Enviar imagen', 'image', 'continueRegularOutput'), si('¿Hubo error?', '!!$json.error'),
      reporte('Reportar mensaje (saliente)'), clienteWa('Responder al cliente'),
    ], [['Enviar imagen', '¿Hubo error?'], ['¿Hubo error?', 'Responder al cliente', 0], ['¿Hubo error?', 'Reportar mensaje (saliente)', 1]]);
    expect(reglasDe(f)).toEqual(expect.arrayContaining(['1:Enviar imagen', '3:Reportar mensaje (saliente)::Enviar imagen']));
  });

  it('regla 1: un texto que nadie verifica, pero cuya falla detiene la ejecución («ruidoso»), cumple; con continueRegularOutput no', () => {
    expect(reglasDe(mem([clienteWa('Responder al cliente')], []))).toEqual([]);
    const f = mem([nodoMem('Responder al cliente', 'whatsApp', { operation: 'send', recipientPhoneNumber: '={{ $json.from }}', textBody: 'hola' }, 'continueRegularOutput')], []);
    expect(reglasDe(f)).toContain('1:Responder al cliente');
  });

  it('regla 2: la réplica del 03/10 (imagen al cliente cuya falla va solo a un aviso al negocio) falla', () => {
    const f = mem([
      envioHttp('Enviar QR de cobro', 'image', 'continueErrorOutput'), reporte('Reportar QR (saliente)'),
      code('QR no enviado', 'return $input.all();'), avisoWa('Avisar al dueño'),
    ], [['Enviar QR de cobro', 'Reportar QR (saliente)', 0], ['Enviar QR de cobro', 'QR no enviado', 1], ['QR no enviado', 'Avisar al dueño']]);
    expect(reglasDe(f)).toContain('2:Enviar QR de cobro');
    // La corrección (texto de respaldo al cliente en la salida de error) la cumple.
    const arreglado = mem([
      envioHttp('Enviar QR de cobro', 'image', 'continueErrorOutput'), clienteWa('Texto de respaldo del QR'),
    ], [['Enviar QR de cobro', 'Texto de respaldo del QR', 1]]);
    expect(reglasDe(arreglado)).toEqual([]);
  });

  it('regla 2: un respaldo de texto sin throw ni envio_fallido falla; con throw o con envio_fallido cumple', () => {
    const sin = mem([
      envioDinamico('Enviar a WhatsApp', 'continueRegularOutput'), si('¿Falló el envío?', '!!$json.error'),
      envioHttp('Enviar respaldo', 'text', 'continueRegularOutput'), si('¿Reportar?', `!!${ID}`), reporte('Reportar mensaje (saliente)'),
    ], [['Enviar a WhatsApp', '¿Falló el envío?'], ['¿Falló el envío?', 'Enviar respaldo', 0], ['¿Falló el envío?', '¿Reportar?', 1],
      ['Enviar respaldo', '¿Reportar?'], ['¿Reportar?', 'Reportar mensaje (saliente)']]);
    expect(reglasDe(sin)).toContain('2:Enviar respaldo');
    expect(reglasDe(sin)).not.toContain('2:Enviar a WhatsApp');
    const conEvento = mem(sin.nodes.concat([code('Marcar fallo', `const id = ${ID}; return [{ json: { evento: 'envio_fallido', idMeta: id } }];`)]), [
      ['Enviar respaldo', '¿Reportar?'], ['Enviar a WhatsApp', '¿Falló el envío?'], ['¿Falló el envío?', 'Enviar respaldo', 0],
      ['¿Falló el envío?', '¿Reportar?', 1], ['¿Reportar?', 'Reportar mensaje (saliente)'], ['¿Reportar?', 'Marcar fallo', 1],
    ]);
    expect(reglasDe(conEvento)).not.toContain('2:Enviar respaldo');
  });

  it('regla 3: un reporte colgado de la salida regular de un continueRegularOutput falla (reglas 1 y 3)', () => {
    const f = mem([envioHttp('Enviar texto', 'text', 'continueRegularOutput'), reporte('Reportar mensaje (saliente)')], [['Enviar texto', 'Reportar mensaje (saliente)']]);
    expect(reglasDe(f)).toEqual(expect.arrayContaining(['1:Enviar texto', '3:Reportar mensaje (saliente)::Enviar texto']));
  });

  it('regla 3: un reporte saliente sin idMeta falla aunque haya puerta', () => {
    const f = ventaMinima();
    f.nodes = f.nodes.map((n) => (n.name === 'Reportar mensaje (saliente)' ? reporte(n.name, false) : n));
    expect(reglasDe(f)).toEqual(['3:Reportar mensaje (saliente)']);
  });

  it('regla 4: una marca del prompt sin consumidor falla; con consumidor que alcanza un envío cumple (literal o escapada)', () => {
    const ag = agente('AI Agent', 'Cuando quieras pasar con una persona escribe [TRANSFERIR]. Usa [CONTEXTO DEL SISTEMA] como contexto.');
    const sin = mem([ag, code('Procesar respuesta', 'return $input.all();'), clienteWa('Responder al cliente')], [['AI Agent', 'Procesar respuesta'], ['Procesar respuesta', 'Responder al cliente']]);
    expect(reglasDe(sin)).toEqual(['4:AI Agent::[TRANSFERIR]']);
    for (const consumo of ["if (t.includes('[TRANSFERIR]')) return 1;", 'const re = /\\[TRANSFERIR\\]/i;']) {
      const con = mem([ag, code('Procesar respuesta', consumo), clienteWa('Responder al cliente')], [['AI Agent', 'Procesar respuesta'], ['Procesar respuesta', 'Responder al cliente']]);
      expect(reglasDe(con), consumo).toEqual([]);
    }
    const colgado = mem([ag, code('Procesar respuesta', "if (t.includes('[TRANSFERIR]')) return 1;"), clienteWa('Responder al cliente')], [['AI Agent', 'Procesar respuesta']]);
    expect(reglasDe(colgado)).toEqual(['4:AI Agent::[TRANSFERIR]']);
  });

  it('regla 4: un comentario que nombra la marca no es un consumidor', () => {
    const ag = agente('AI Agent', 'Escribe [PEDIDO_CONFIRMADO] al cerrar.');
    const f = mem([ag, code('Procesar respuesta', "// aquí iría [PEDIDO_CONFIRMADO]\nreturn [];"), clienteWa('Responder al cliente')], [['Procesar respuesta', 'Responder al cliente']]);
    expect(reglasDe(f)).toEqual(['4:AI Agent::[PEDIDO_CONFIRMADO]']);
  });

  it('regla 5: «Ya le avisé al doctor» con el aviso DESPUÉS (o en paralelo) falla; con el aviso antes, cumple', () => {
    const despues = mem([
      code('Armar mensajes', "const t = 'Comunícate ahora. Ya le avisé al doctor.'; return [{ json: { t } }];"),
      clienteWa('Responder al cliente'), avisoWa('Avisar al doctor'),
    ], [['Armar mensajes', 'Responder al cliente'], ['Armar mensajes', 'Avisar al doctor']]);
    expect(reglasDe(despues)).toContain('5:Armar mensajes::aviso');
    const antes = mem([
      avisoWa('Avisar al doctor'), code('Armar mensajes', "const t = 'Comunícate ahora. Ya le avisé al doctor.'; return [{ json: { t } }];"), clienteWa('Responder al cliente'),
    ], [['Avisar al doctor', 'Armar mensajes'], ['Armar mensajes', 'Responder al cliente']]);
    expect(reglasDe(antes)).not.toContain('5:Armar mensajes::aviso');
  });

  it('regla 5: «aquí tienes el QR» exige una imagen con respaldo; «toca el botón» exige un nodo con cta_url', () => {
    const qr = mem([code('Armar mensajes', "return [{ json: { t: 'Aquí tienes el QR para pagar.' } }];"), envioHttp('Enviar QR', 'image', 'continueErrorOutput')], [['Armar mensajes', 'Enviar QR']]);
    expect(reglasDe(qr)).toEqual(expect.arrayContaining(['5:Armar mensajes::qr', '1:Enviar QR', '2:Enviar QR']));
    const qrBien = mem([code('Armar mensajes', "return [{ json: { t: 'Aquí tienes el QR para pagar.' } }];"), envioHttp('Enviar QR', 'image', 'continueErrorOutput'), clienteWa('Texto de respaldo')],
      [['Armar mensajes', 'Enviar QR'], ['Enviar QR', 'Texto de respaldo', 1]]);
    expect(reglasDe(qrBien)).toEqual([]);
    const boton = mem([code('Armar mensajes', "return [{ json: { t: 'Toca el botón para escribirle.' } }];"), clienteWa('Responder al cliente')], [['Armar mensajes', 'Responder al cliente']]);
    expect(reglasDe(boton)).toEqual(['5:Armar mensajes::boton']);
  });

  it('regla 5: lee literales, no comentarios ni expresiones regulares', () => {
    const f = mem([code('Procesar respuesta', "// ya le avisé al doctor\nconst re = /ya le avis[eé]/i; const ok = re.test(x) ? 1 : 2; return [];"), clienteWa('Responder al cliente')], [['Procesar respuesta', 'Responder al cliente']]);
    expect(reglasDe(f)).toEqual([]);
    expect(tokenizar("const a = 'x'; // 'no'\nconst b = /'no'/.test(a); const c = `sí ${a}`; /* 'no' */").literales).toEqual(['x', 'sí ${a}']);
  });

  it('regla 6: un anuncio del prompt cuyo mecanismo no cumple la regla 2 falla; con respaldo cumple', () => {
    const ag = agente('AI Agent', 'Di «a continuación te llega el QR» y, si piden el contacto, le pasas el contacto.');
    const mal = mem([ag, envioHttp('Enviar QR', 'image', 'continueErrorOutput'), envioHttp('Enviar contacto', 'interactive', 'continueErrorOutput')], []);
    expect(reglasDe(mal)).toEqual(expect.arrayContaining(['6:AI Agent::a-continuacion-llega', '6:AI Agent::le-pasas-el-contacto']));
    const bien = mem([ag, envioHttp('Enviar QR', 'image', 'continueErrorOutput'), envioHttp('Enviar contacto', 'interactive', 'continueErrorOutput'), clienteWa('Respaldo QR'), clienteWa('Respaldo contacto')],
      [['Enviar QR', 'Respaldo QR', 1], ['Enviar contacto', 'Respaldo contacto', 1]]);
    expect(reglasDe(bien).filter((r) => r.startsWith('6:'))).toEqual([]);
  });

  it('excepciones: vencida, inexistente, sin PR, sin fecha, a más de 90 días o pasada de fecha, fallan', () => {
    const hoy = new Map([['a.json', [{ regla: 2, nodo: 'Enviar QR', detalle: 'x' }]]]);
    const existe = (_a: string, n: string) => n === 'Enviar QR';
    const ok = { porque: 'falla; la cierra PR-5', vence: '2026-12-31' };
    const antes = new Date('2026-10-04T00:00:00Z');
    const prob = (k: string, e: { porque: string; vence: string }, ahora = antes) => problemasDeExcepciones(hoy, { [k]: e }, existe, ahora);
    expect(prob('a.json#2#Enviar QR', ok)).toEqual([]);
    expect(prob('a.json#1#Enviar QR', ok)).toEqual([expect.stringContaining('VENCIDA')]);
    expect(prob('b.json#2#Enviar QR', ok)).toEqual([expect.stringContaining('archivo que no existe')]);
    expect(prob('a.json#2#Otro', ok)).toEqual([expect.stringContaining('nodo que no existe')]);
    for (const porque of ['porque sí', 'se retira el JSON', 'la cierra PR-3a', 'la cierra F3b']) {
      expect(prob('a.json#2#Enviar QR', { ...ok, porque }), porque).toEqual([expect.stringContaining('qué PR')]);
    }
    expect(prob('a.json#2#Enviar QR', { ...ok, vence: 'pronto' })).toEqual([expect.stringContaining('AAAA-MM-DD')]);
    expect(prob('a.json#2#Enviar QR', { ...ok, vence: '2027-01-02' })).toEqual([expect.stringContaining('más de 90 días')]);
    expect(prob('a.json#2#Enviar QR', { ...ok, vence: '2027-01-01' })).toEqual([]);
    // Al pasar la fecha, la suite falla: una excepción no es un cheque en blanco.
    expect(prob('a.json#2#Enviar QR', ok, new Date('2027-01-01T00:00:00Z'))).toEqual([expect.stringContaining('VENCIÓ')]);
  });

  it('regla 2, sonda A: la réplica del 03/10 con un «Responder al cliente» colgado de la salida de ÉXITO sigue fallando', () => {
    const f = mem([
      envioHttp('Enviar QR de cobro', 'image', 'continueErrorOutput'), clienteWa('Responder al cliente'),
      code('QR no enviado', 'return $input.all();'), avisoWa('Avisar al dueño'),
    ], [['Enviar QR de cobro', 'Responder al cliente', 0], ['Enviar QR de cobro', 'QR no enviado', 1], ['QR no enviado', 'Avisar al dueño']]);
    expect(reglasDe(f)).toContain('2:Enviar QR de cobro');
  });

  it('regla 2, sonda B: imagen con la salida de error a un NoOp y la de éxito a un texto al cliente falla', () => {
    const f = mem([envioHttp('Enviar QR', 'image', 'continueErrorOutput'), nodoMem('Nada', 'noOp'), clienteWa('Responder al cliente')],
      [['Enviar QR', 'Responder al cliente', 0], ['Enviar QR', 'Nada', 1]]);
    expect(reglasDe(f)).toContain('2:Enviar QR');
  });

  it('regla 2: con continueRegularOutput el texto de respaldo tiene que estar detrás de un IF o Code que lea el id o error', () => {
    const colgado = mem([envioDinamico('Enviar a WhatsApp', 'continueRegularOutput'), envioHttp('Enviar respaldo', 'text', 'continueRegularOutput')],
      [['Enviar a WhatsApp', 'Enviar respaldo']]);
    expect(reglasDe(colgado)).toContain('2:Enviar a WhatsApp');
  });

  it('LOW-1, sondas E y F: el nodo WhatsApp se clasifica por messageType y sin operation es sendTemplate', () => {
    const imagen = nodoMem('Enviar foto', 'whatsApp', { operation: 'send', messageType: 'image', recipientPhoneNumber: '={{ $json.from }}' });
    expect(esEnvio(imagen)).toBe(true);
    expect(clase(imagen)).toBe('imagen');
    expect(reglasDe(mem([imagen], []))).toContain('2:Enviar foto'); // una imagen sin texto de respaldo
    for (const parametros of [{ recipientPhoneNumber: '={{ $json.from }}' }, { resource: 'message', recipientPhoneNumber: '={{ $json.from }}' }]) {
      const plantilla = nodoMem('Enviar plantilla', 'whatsApp', parametros);
      expect(esEnvio(plantilla), JSON.stringify(parametros)).toBe(true);
      expect(clase(plantilla)).toBe('plantilla');
    }
    expect(esEnvio(nodoMem('Bajar medio', 'whatsApp', { resource: 'media', operation: 'mediaUrlGet' }))).toBe(false);
  });

  it('LOW-2, sondas C, D y J: citar statusCode o copiar el id sin decidir nada NO es leerlo', () => {
    expect(leeWamid("const s = $json.statusCode; return [{ json: { s } }];")).toBe(false);
    expect(leeWamid("return [{ json: { idMeta: String((($json.messages || [])[0] || {}).id || '') } }];")).toBe(false);
    expect(leeWamid('if (Number($json.statusCode) >= 400) throw new Error("x");')).toBe(true);
    expect(leeWamid("if (!(($json.messages || [])[0] || {}).id) throw new Error('x');")).toBe(true);
    const f = mem([envioHttp('Enviar texto', 'text', 'continueRegularOutput'), code('Copia', "return [{ json: { s: $json.statusCode, idMeta: (($json.messages || [])[0] || {}).id } }];"), reporte('Reportar mensaje (saliente)')],
      [['Enviar texto', 'Copia'], ['Copia', 'Reportar mensaje (saliente)']]);
    expect(reglasDe(f)).toEqual(expect.arrayContaining(['1:Enviar texto', '3:Reportar mensaje (saliente)::Enviar texto']));
  });

  it('LOW-2: un sumidero que nombra al envío pero no corre después de él (otra rama sin antecesor común) no cuenta', () => {
    const lee = "const a = $('Enviar texto').first().json; if (Number(a.statusCode) >= 400) throw new Error('x'); return [];";
    const ajeno = mem([envioHttp('Enviar texto', 'text', 'continueRegularOutput'), code('Sumidero ajeno', lee)], []);
    expect(reglasDe(ajeno)).toContain('1:Enviar texto');
    const hermano = mem([code('Salida', 'return $input.all();'), envioHttp('Enviar texto', 'text', 'continueRegularOutput'), code('Confirmar envío', lee)],
      [['Salida', 'Enviar texto'], ['Salida', 'Confirmar envío']]);
    expect(reglasDe(hermano)).not.toContain('1:Enviar texto');
  });

  it('LOW-3, sonda G: el destinatario manda sobre el nombre del nodo', () => {
    expect(destino(envioHttp('Avisar al cliente', 'text', undefined, '$json.from'))).toBe('cliente');
    expect(destino(envioHttp('Enviar texto', 'text', undefined, '$json.numeroDuenoPrueba'))).toBe('negocio');
    expect(destino(envioDinamico('Aviso de respaldo'))).toBe('negocio'); // sin `to` a la vista, decide el nombre
    expect(destino(nodoMem('Avisar a recepción', 'whatsApp', { operation: 'send', recipientPhoneNumber: '={{ $json.from }}' }))).toBe('cliente');
  });

  it('LOW-3, sonda H: «respaldo» en el nombre solo cuenta si se llega desde la salida de fallo de otro envío', () => {
    const suelto = mem([envioDinamico('Enviar respaldo', 'continueRegularOutput')], []);
    expect(clase(suelto.nodes[0] as Nodo, suelto)).toBe('dinamico');
    expect(clase(ventaMinima().nodes.find((n) => n.name === 'Enviar respaldo') as Nodo)).toBe('texto'); // explícito, sin grafo
    const conExito = mem([envioDinamico('Enviar a WhatsApp', 'continueRegularOutput'), envioDinamico('Enviar respaldo', 'continueRegularOutput')], [['Enviar a WhatsApp', 'Enviar respaldo']]);
    expect(clase(conExito.nodes[1] as Nodo, conExito)).toBe('dinamico'); // colgado del éxito
    const conFallo = mem([envioDinamico('Enviar a WhatsApp', 'continueErrorOutput'), envioDinamico('Enviar respaldo', 'continueRegularOutput')], [['Enviar a WhatsApp', 'Enviar respaldo', 1]]);
    expect(clase(conFallo.nodes[1] as Nodo, conFallo)).toBe('texto');
  });

  it('LOW-4, sondas I, K y L: las herramientas del agente son envíos, y un nodo con graph.facebook que no se clasifica falla', () => {
    const tool = (type: string, p: Record<string, unknown>): Nodo => ({ name: 'Herramienta', type, parameters: p });
    expect(esEnvio(tool('n8n-nodes-base.httpRequestTool', { method: 'POST', url: `=${GRAPH}` }))).toBe(true);
    expect(esEnvio(tool('@n8n/n8n-nodes-langchain.toolHttpRequest', { method: 'POST', url: `=${GRAPH}` }))).toBe(true);
    expect(esEnvio(tool('n8n-nodes-base.whatsAppTool', { operation: 'send' }))).toBe(true);
    // Un POST a Graph cuya URL no dice `/messages` (armada con una expresión) no se puede clasificar: falla.
    const raro = mem([tool('n8n-nodes-base.httpRequest', { method: 'POST', url: "=https://graph.facebook.com/v26.0/{{ $json.phoneNumberId }}/{{ $json.ruta }}" })], []);
    expect(reglasDe(raro)).toEqual(['7:Herramienta']);
    // Las lecturas (GET) no envían.
    expect(reglasDe(mem([tool('n8n-nodes-base.httpRequest', { url: 'https://graph.facebook.com/v26.0/123' })], []))).toEqual([]);
  });

  it('LOW-5: un verificador que «solo actúa si corrió» otro nodo no cubre un envío con dos orígenes', () => {
    const solo = "const c = $('Aviso de transferencia').isExecuted; if (c && !(($input.first().json.messages || [])[0] || {}).id) throw new Error('x'); return $input.all();";
    const base = (origenes: string[]) => mem([
      code('Origen 1', 'return [];'), code('Origen 2', 'return [];'), avisoWa('Avisar al dueño'), code('Marcar', solo),
    ].map((n) => (n.name === 'Avisar al dueño' ? { ...n, onError: 'continueRegularOutput' } : n)),
    [...origenes.map((o): Arista => [o, 'Avisar al dueño']), ['Avisar al dueño', 'Marcar']]);
    expect(reglasDe(base(['Origen 1']))).not.toContain('1:Avisar al dueño');
    expect(reglasDe(base(['Origen 1', 'Origen 2']))).toContain('1:Avisar al dueño');
  });

  it('LOW-5: «Enviar contacto» lleva el número de recepción en el cuerpo y va al CLIENTE', () => {
    const contacto = nodoMem('Enviar contacto', 'httpRequest', {
      method: 'POST', url: `=${GRAPH}`,
      jsonBody: "={{ JSON.stringify({ messaging_product: 'whatsapp', to: $json.from, type: 'interactive', interactive: { type: 'cta_url', action: { parameters: { url: 'https://wa.me/' + $json.numeroRecepcion } } } }) }}",
    }, 'continueErrorOutput');
    expect(destino(contacto)).toBe('cliente');
    expect(clase(contacto)).toBe('boton');
  });

  it('el control positivo de Venta mínima es la réplica del diseño OBJETIVO (con «Entrega fallida»), no de lo que corre hoy en Q\'Taco', () => {
    // Q'Taco todavía no tiene el último recurso en error visible: por eso `Enviar respaldo` está en las excepciones (PR-7).
    expect(reglasDe(ventaMinima())).toEqual([]);
    expect((HOY.get('experimental/venta-minima/venta-minima.qtaco.json') ?? []).map((x) => `${x.regla}#${x.nodo}`)).toContain('2#Enviar respaldo');
  });
});

describe('Entregas: segunda revisión (polaridad del IF, IF v2, ventana de leeWamid)', () => {
  const envioConIf = (cond: Nodo, salidaConTexto: number): Flujo => mem(
    [envioDinamico('Enviar a WhatsApp', 'continueRegularOutput'), cond, envioHttp('Enviar respaldo', 'text', 'continueRegularOutput')],
    [['Enviar a WhatsApp', cond.name], [cond.name, 'Enviar respaldo', salidaConTexto]],
  );

  it('MEDIUM, A6: un IF `!!messages[0].id` con el texto en la salida 0 (la de ÉXITO) falla; con el texto en la 1 (fallo) cumple', () => {
    const cond = si('¿Salió?', `!!${ID}`);
    expect(reglasDe(envioConIf(cond, 0))).toContain('2:Enviar a WhatsApp');
    expect(reglasDe(envioConIf(cond, 1))).not.toContain('2:Enviar a WhatsApp');
    expect(salidaDeFalloDelIf(cond)).toBe(1);
    expect(salidaDeFalloDelIf(si('¿No salió?', `!${ID}`))).toBe(0);
  });

  it('MEDIUM: un IF sobre `error` abre la salida 0; statusCode >= 400, también; un IF que no se puede decidir, ninguna', () => {
    expect(salidaDeFalloDelIf(si('¿Falló?', '!!($json && $json.error)'))).toBe(0);
    expect(reglasDe(envioConIf(si('¿Falló?', '!!($json && $json.error)'), 0))).not.toContain('2:Enviar a WhatsApp');
    expect(reglasDe(envioConIf(si('¿Falló?', '!!($json && $json.error)'), 1))).toContain('2:Enviar a WhatsApp');
    expect(salidaDeFalloDelIf(si('¿Falló?', 'Number($json.statusCode) >= 400'))).toBe(0);
    const raro = nodoMem('¿Qué pasó?', 'if', { conditions: { conditions: [{ leftValue: '={{ $json.error }}', operator: { type: 'string', operation: 'contains' } }] } });
    expect(salidaDeFalloDelIf(raro)).toBeNull();
    expect(reglasDe(envioConIf(raro, 0))).toContain('2:Enviar a WhatsApp');
    expect(reglasDe(envioConIf(raro, 1))).toContain('2:Enviar a WhatsApp');
  });

  it('MEDIUM, A7: un Code `if (!id) throw` con un texto DESPUÉS no abre un camino de fallo al cliente', () => {
    const f = mem([
      envioDinamico('Enviar a WhatsApp', 'continueRegularOutput'),
      code('Verificar', `if (!${ID}) { throw new Error('Meta no devolvió id'); } return $input.all();`),
      envioHttp('Enviar respaldo', 'text', 'continueRegularOutput'),
    ], [['Enviar a WhatsApp', 'Verificar'], ['Verificar', 'Enviar respaldo']]);
    expect(reglasDe(f)).toContain('2:Enviar a WhatsApp');
  });

  it('LOW-1: el IF v2 estructurado (leftValue con statusCode, operador number gte, rightValue 400) lee el id y abre la salida 0', () => {
    const v2 = nodoMem('¿Falló el interactivo?', 'if', {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: 'c1', leftValue: '={{ Number($json.statusCode) }}', rightValue: 400, operator: { type: 'number', operation: 'gte' } }], combinator: 'and' },
      options: {},
    });
    expect(leeIdDe(v2)).toBe(true);
    expect(salidaDeFalloDelIf(v2)).toBe(0);
    const f = mem([envioDinamico('Enviar interactivo', 'continueRegularOutput'), v2, envioHttp('Enviar respaldo', 'text', 'continueRegularOutput'), reporte('Reportar mensaje (saliente)')],
      [['Enviar interactivo', '¿Falló el interactivo?'], ['¿Falló el interactivo?', 'Enviar respaldo', 0], ['¿Falló el interactivo?', 'Reportar mensaje (saliente)', 1]]);
    expect(reglasDe(f)).not.toContain('1:Enviar interactivo');
    expect(reglasDe(f)).not.toContain('2:Enviar interactivo');
    // Citar statusCode con un comparador ajeno al estado no lo lee.
    expect(leeIdDe(nodoMem('IF', 'if', { conditions: { conditions: [{ leftValue: '={{ $json.statusCode }}', operator: { type: 'string', operation: 'contains' } }] } }))).toBe(false);
  });

  it('LOW-3, sondas D2 y D3: una copia del id cerca de una comparación o un throw AJENOS no es leerlo', () => {
    expect(leeWamid("const idMeta = (($json.messages || [])[0] || {}).id; if (n === 1) return [];")).toBe(false); // D2
    expect(leeWamid("return [{ json: { id: (($json.messages || [])[0] || {}).id } }];\nif (x > 0) throw new Error('y');")).toBe(false); // D3
    expect(leeWamid("const m = j.messages;\nconst salio = !!m[0] && typeof m[0].id === 'string';")).toBe(true);
    expect(leeWamid("if (!(($json.messages || [])[0] || {}).id) { throw new Error('x'); }")).toBe(true);
    expect(leeWamid("const ok = x === 1; const idMeta = (($json.messages || [])[0] || {}).id;")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Los *.prueba.json
// ---------------------------------------------------------------------------

/*
 * DECLARADO (revisión de `seguridad` del #379): `EXCLUIDO` deja fuera los `*.prueba.json` (agenda-minima y
 * venta-minima) de las reglas, por la especificación del plan. Pero esos JSON SÍ se importan a n8n para ensayar con
 * teléfonos reales (`docs/ensayo/LEEME.md`, `Flujos/experimental/venta-minima/DISENO.md`: «se importa únicamente para
 * ensayar, y se desactiva y se borra al terminar»). Por eso cada violación de un `*.prueba.json` tiene que tener su
 * equivalente (`regla#nodo`) en las violaciones o las excepciones de su familia (los demás JSON de su carpeta):
 * un ensayo no puede probar un camino de envío que el flujo de verdad no tiene.
 */
export function violacionesSinEquivalente(prueba: Flujo, familia: { archivo: string; flujo: Flujo }[]): string[] {
  const conocidas = new Set<string>();
  for (const { archivo, flujo } of familia) {
    for (const x of violaciones(flujo)) conocidas.add(`${x.regla}#${x.nodo}`);
    for (const k of Object.keys(EXCEPCIONES)) {
      const [a = '', regla = '', ...resto] = k.split('#');
      if (a === archivo) conocidas.add(`${regla}#${resto.join('#')}`);
    }
  }
  return violaciones(prueba).map((x) => `${x.regla}#${x.nodo}`).filter((k) => !conocidas.has(k));
}

describe('Entregas: los *.prueba.json (se importan a n8n para ensayos con teléfonos reales)', () => {
  const exp = join(CARPETA_FLUJOS, 'experimental');
  const pruebas = readdirSync(exp, { withFileTypes: true }).filter((e) => e.isDirectory())
    .flatMap((d) => readdirSync(join(exp, d.name)).filter((a) => a.endsWith('.prueba.json')).map((a) => `experimental/${d.name}/${a}`));
  const familiaDe = (a: string) => ARCHIVOS.filter((x) => x.startsWith(`${a.split('/').slice(0, 2).join('/')}/`))
    .map((archivo) => ({ archivo, flujo: FLUJOS.get(archivo) as Flujo }));

  it('existen, y cada violación de un ensayo tiene su equivalente en la familia', () => {
    expect(pruebas.length).toBeGreaterThan(0);
    for (const a of pruebas) expect(violacionesSinEquivalente(leer(a), familiaDe(a)), a).toEqual([]);
  });

  it('contraprueba: sin `onError` en «Enviar a WhatsApp» de venta-minima.prueba.json, el ensayo ya no coincide con su familia', () => {
    const a = 'experimental/venta-minima/venta-minima.prueba.json';
    const roto = leer(a);
    const envio = roto.nodes.find((n) => n.name === 'Enviar a WhatsApp') as Nodo;
    delete envio.onError;
    expect(violacionesSinEquivalente(roto, familiaDe(a))).toContain('1#Enviar a WhatsApp');
  });
});
