/**
 * LOS ANUNCIOS DE RUBÉN COMO DATO: LA VALIDACIÓN (pura, sin red ni Firestore).
 *
 * El archivo `campanas-rroca-ruben.json` trae los anuncios como la Consola los guarda: `titulares` (de 1 a 5; el primero es el canónico),
 * `productoId` y `angulo`. El módulo Campañas (`functions/src/modulos/campanas/campanas.ts`) los revisa en el SERVIDOR cuando se escribe
 * `tenants/{t}/config/campanas`: forma, fechas, duplicados, montos, patrones de inyección y un revisor de modelo. El SDK Admin se salta las
 * reglas de Firestore, así que este módulo repite las comprobaciones SIN MODELO para no cargar nada que el servidor rechazaría después, y
 * `pruebas/tenants/rroca-ruben/campanas.test.ts` lo compara con `revisarSinModelo` (el servidor de verdad) con casos buenos y malos.
 * Lo que decide el servidor y no se repite aquí: el revisor de modelo, los nombres de otros comercios y los patrones finos de inyección.
 *
 * Es CÓDIGO sin datos: no tiene ningún titular, ángulo ni identificador de Rubén.
 */

// Las cifras del servidor (la prueba las compara con `campanas.ts`).
export const MAX_TITULARES = 5;
export const MIN_LARGO_TITULAR = 6;
export const MAX_LARGO_TITULAR = 100;
export const TOPE_ANGULO = 300;
export const MAX_ANUNCIOS = 10;
export const MAX_DIAS_DE_DURACION = 366;
const ID = /^[a-z0-9-]{1,40}$/;
const ID_PRODUCTO = /^[A-Za-z0-9_-]{1,100}$/;
// Un monto en un titular es una insignia de precio, no un titular (misma expresión que el servidor).
const MONTO = /(\bbs\.?|\busd|\$)\s*\d|\d\s*(bs|usd|\$)/;
const INVISIBLES = /[\p{Cf}\p{Cc}]/u;
const ENLACE = /https?:|www\.|\b\S+\.(?:com|net|org|bo|io|app|me|link|ly)\b/i;
// Palabras de la capa de patrones del servidor (`comportamiento.ts`, patrón «prompt»): un titular o un ángulo que las trae se RECHAZA al escribirse. Se repite solo esta, la que ya mordió a un ángulo aprobado.
const PALABRA_RECHAZADA = /(?<![\p{L}\p{N}_])(prompts?|system|systems)(?![\p{L}\p{N}_])/iu;
const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const palabras = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const colapsar = (t) => [...new Set((t ?? []).map((x) => x.trim().replace(/\s+/g, ' ')))];

/** El día de Bolivia (UTC-4 fijo) de un instante, `AAAA-MM-DD`. */
export const diaBolivia = (ms) => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);
export const sumarDias = (fecha, n) => new Date(Date.parse(`${fecha}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Las campañas que se escribirían en `config/campanas.lista`: el anuncio más las fechas (hoy hasta hoy + `diasDeVigencia` - 1).
 * Una campaña sin `texto` es válida si tiene titulares. No inventa claves: solo `id`, `texto`, `inicio`, `fin`, `titulares`, `productoId`, `angulo`.
 */
export function armarLista(datos, hoy) {
  const dias = datos && Number.isInteger(datos.diasDeVigencia) ? datos.diasDeVigencia : 180;
  const fin = sumarDias(hoy, Math.max(1, Math.min(dias, MAX_DIAS_DE_DURACION)) - 1);
  return (Array.isArray(datos?.anuncios) ? datos.anuncios : []).map((a) => ({
    id: a.id, texto: '', inicio: hoy, fin,
    titulares: a.titulares, ...(a.productoId !== undefined ? { productoId: a.productoId } : {}), ...(a.angulo !== undefined ? { angulo: a.angulo } : {}),
  }));
}

const CLAVES_ANUNCIO = new Set(['id', 'titulares', 'productoId', 'angulo']);
const CLAVES_ARCHIVO = new Set(['tenant', 'diasDeVigencia', 'anuncios']);

/**
 * Los problemas del archivo (lista vacía si cumple). `productosActivos`: los ids del catálogo ACTIVO del tenant; sin él no se comprueba el
 * producto (la carga real sí lo hace contra Firestore). `limite`: el tope de campañas del plan.
 */
export function validarArchivo(datos, { productosActivos = null, limite = MAX_ANUNCIOS } = {}) {
  const p = [];
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return ['el archivo no es un objeto JSON'];
  for (const k of Object.keys(datos)) if (!k.startsWith('_') && !CLAVES_ARCHIVO.has(k)) p.push(`clave desconocida: «${k}»`);
  if ('diasDeVigencia' in datos && !(Number.isInteger(datos.diasDeVigencia) && datos.diasDeVigencia >= 1 && datos.diasDeVigencia <= MAX_DIAS_DE_DURACION)) {
    p.push(`diasDeVigencia: un entero de 1 a ${MAX_DIAS_DE_DURACION}`);
  }
  const lista = datos.anuncios;
  if (!Array.isArray(lista) || lista.length === 0) return [...p, 'anuncios: tiene que ser una lista con al menos un anuncio'];
  if (lista.length > MAX_ANUNCIOS) p.push(`anuncios: ${lista.length}, el máximo es ${MAX_ANUNCIOS}`);
  if (lista.length > limite) p.push(`anuncios: ${lista.length}, y el plan del comercio admite ${limite} campaña(s) a la vez (decisión comercial: no se recorta en silencio)`);
  const ids = new Set();
  const titularesVistos = new Map();
  lista.forEach((a, i) => {
    const donde = `anuncios[${i}]`;
    if (!a || typeof a !== 'object' || Array.isArray(a)) { p.push(`${donde}: tiene que ser un objeto`); return; }
    for (const k of Object.keys(a)) if (!CLAVES_ANUNCIO.has(k)) p.push(`${donde}: clave desconocida «${k}»`);
    if (typeof a.id !== 'string' || !ID.test(a.id)) p.push(`${donde}.id: minúsculas, dígitos y guiones, 1 a 40`);
    else if (ids.has(a.id)) p.push(`${donde}.id: «${a.id}» repetido`);
    else ids.add(a.id);
    if (!Array.isArray(a.titulares) || a.titulares.some((x) => typeof x !== 'string')) { p.push(`${donde}.titulares: una lista de textos`); return; }
    const titulares = colapsar(a.titulares);
    if (titulares.length < 1 || titulares.length > MAX_TITULARES) p.push(`${donde}.titulares: de 1 a ${MAX_TITULARES} titulares distintos`);
    for (const t of titulares) {
      if (t.length < MIN_LARGO_TITULAR || t.length > MAX_LARGO_TITULAR) p.push(`${donde}.titulares: «${t.slice(0, 30)}» tiene que medir de ${MIN_LARGO_TITULAR} a ${MAX_LARGO_TITULAR} caracteres`);
      if (MONTO.test(sinTildes(t))) p.push(`${donde}.titulares: un titular no lleva montos (el precio sale del catálogo)`);
      if (INVISIBLES.test(t.normalize('NFKC'))) p.push(`${donde}.titulares: caracteres invisibles o de control`);
      if (ENLACE.test(t)) p.push(`${donde}.titulares: un titular no lleva enlaces`);
      if (PALABRA_RECHAZADA.test(t.normalize('NFKC'))) p.push(`${donde}.titulares: la palabra «${PALABRA_RECHAZADA.exec(t.normalize('NFKC'))[1]}» la rechaza el servidor en un anuncio (patrón «prompt»): reescríbalo`);
      const n = palabras(t);
      const otro = titularesVistos.get(n);
      if (otro !== undefined && otro !== a.id) p.push(`${donde}.titulares: «${t.slice(0, 30)}» ya lo usa el anuncio «${otro}» (el flujo no sabría de cuál viene)`);
      titularesVistos.set(n, a.id);
    }
    if (a.productoId !== undefined) {
      if (typeof a.productoId !== 'string' || !ID_PRODUCTO.test(a.productoId) || /^__.*__$/.test(a.productoId)) p.push(`${donde}.productoId: un id de catálogo válido`);
      else if (productosActivos && !productosActivos.has(a.productoId)) p.push(`${donde}.productoId: «${a.productoId}» no existe o no está activo en el catálogo del comercio`);
    }
    if (a.angulo !== undefined) {
      if (typeof a.angulo !== 'string' || a.angulo.trim() === '') p.push(`${donde}.angulo: un texto`);
      else {
        if (a.angulo.trim().length > TOPE_ANGULO) p.push(`${donde}.angulo: ${a.angulo.trim().length} caracteres, el máximo es ${TOPE_ANGULO}`);
        if (INVISIBLES.test(a.angulo.normalize('NFKC'))) p.push(`${donde}.angulo: caracteres invisibles o de control`);
        if (ENLACE.test(a.angulo)) p.push(`${donde}.angulo: un ángulo no lleva enlaces`);
        if (PALABRA_RECHAZADA.test(a.angulo.normalize('NFKC'))) p.push(`${donde}.angulo (${a.id}): la palabra «${PALABRA_RECHAZADA.exec(a.angulo.normalize('NFKC'))[1]}» la rechaza el servidor en un anuncio (patrón «prompt»): el ángulo aprobado necesita otra redacción antes de cargarse`);
        if (/\b\d+(?:[.,]\d+)?\s?(bs|bolivianos|usd|\$)\b|(?:bs\.?|usd|\$)\s?\d/i.test(sinTildes(a.angulo))) p.push(`${donde}.angulo: un ángulo no lleva montos (el precio sale del catálogo)`);
      }
    }
  });
  return p;
}
