/**
 * CARGAR LAS DOS CAMPAÑAS DE Q'TACO (módulo Campañas) DESDE UN JSON — EN SECO POR DEFECTO.
 *
 * QUÉ CARGA. En `tenants/qtaco/config/campanas.lista`, dos campañas SIMULTÁNEAS identificadas por el texto que el anuncio de Meta deja
 * prellenado: A «Tortas mexicanas» y B «Jueves de +2» (`campanas-qtaco.json`, textos de la adenda de campañas). Modelado sobre
 * `rroca-ruben/cargar-campanas.mjs` y, para el proyecto y el respaldo, sobre `plataforma/aplicar-consola-oculta.mjs` (se IMPORTA, no se copia).
 *
 *   node admin/scripts/datos/qtaco/cargar-campanas.mjs --proyecto <id>                                                   # EN SECO
 *   node admin/scripts/datos/qtaco/cargar-campanas.mjs --proyecto <id> --respaldo <ruta> --aplicar [--confirmo-produccion qtaco]
 *   node admin/scripts/datos/qtaco/cargar-campanas.mjs --proyecto <id> --revertir --respaldo <ruta> [--aplicar] [--confirmo-produccion qtaco]
 *
 * El comercio es FIJO: `qtaco`. Un archivo de otro comercio, o un `--tenant` distinto, se rechaza sin tocar nada.
 *
 * QUÉ ESCRIBE (solo con `--aplicar`, en UNA transacción): `config/campanas.lista` (estas campañas, reemplazando las de igual `id` y
 * conservando las demás del comercio), el sello `actualizadoPor` y una entrada en `auditoria`. NO escribe `revision` ni `vigentes`: los
 * escribe SOLO el servidor (`verificarCampanas`) al ver la escritura; una campaña que rechace queda cargada y NO viaja al flujo.
 *
 * VIGENCIA. `inicio` = el día de la carga (día de Bolivia, UTC-4) y `fin` = inicio + 365 días (366 días inclusive, el máximo que admite el
 * servidor, que no acepta una campaña sin fin). Se imprime la fecha de fin MÁS PRÓXIMA: hay que RENOVAR antes. Una campaña ya cargada, idéntica,
 * vigente y a 30 días o más de su fin, no se toca; a menos de 30 días se vuelve a cargar (es la renovación: correr el script de nuevo).
 * `--aplicar` se rechaza entre las 23:50 y las 24:00 de La Paz (el día de la carga cambiaría a mitad de camino).
 *
 * REVISIÓN DEL SERVIDOR. Tras escribir, el script espera hasta ~60 s a que el servidor escriba `revision`, informa el estado de cada campaña
 * (aprobada, rechazada con su motivo, pendiente) y sale con 1 si alguna no quedó aprobada. Una campaña «igual» cuya revisión no es «aprobada»
 * tampoco se da por buena.
 *
 * RESPALDO Y REVERSA. Antes de escribir se guarda (0600, fuera de todo repositorio, nunca se pisa) el estado previo de `config/campanas`.
 * `--revertir --respaldo` quita estas campañas y repone las versiones previas de esos `id`; no toca las demás y NO pisa un cambio ajeno
 * (si las campañas de hoy ya no son las que escribió este script, sale con 2 sin escribir).
 *
 * PRODUCTOS. El servidor admite UN `productoId` por campaña, y exige que sea un documento ACTIVO del catálogo del comercio. Este script lo
 * comprueba en lectura si el archivo trae uno y, si no existe, se detiene; NUNCA crea productos. El archivo de hoy no trae ninguno (ver `_productos`).
 *
 * SALVAGUARDA DE PROYECTO: la de `aplicar-consola-oculta.mjs` (`GCP_PROJECT_ID_STAGING`/`GCP_PROJECT_ID_PROD`; contra producción, `--aplicar`
 * exige `--confirmo-produccion qtaco`). El id de un proyecto real nunca se imprime.
 *
 * SALIDA. 0 correcto (seco o escritura comprobada), 1 rechazo de datos o del comercio, 2 uso/salvaguarda/archivo, 3 error de ejecución.
 * COSTO. Seco: lecturas. `--aplicar`: una transacción (1 escritura de documento + 1 de auditoría). 0 mensajes por conversación.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tieneModulo } from '../../../functions/src/registro.ts';
import { comprobarProyecto, comprobarRespaldo, guardarRespaldo } from '../../plataforma/aplicar-consola-oculta.mjs';

export const TENANT = 'qtaco';
export const ARCHIVO_POR_OMISION = join(dirname(fileURLToPath(import.meta.url)), 'campanas-qtaco.json');
// Las cifras del servidor (`functions/src/modulos/campanas/campanas.ts`); la prueba las compara con él.
export const MAX_DIAS_DE_DURACION = 366;
export const MAX_DIAS_HASTA_EL_INICIO = 183;
export const MINIMO_TEXTO = 3;
export const TOPE_TEXTO = 300;
export const DIAS_DE_VIGENCIA = 366; // inclusive: fin = inicio + 365
/** Una campaña igual pero a menos de estos días de su fin se vuelve a cargar: es la renovación (inicio = hoy, fin = hoy + 365). */
export const DIAS_PARA_RENOVAR = 30;
/** Tras `--aplicar` se espera hasta esto a que el servidor escriba su `revision`. */
export const ESPERA_REVISION_MS = 60_000;
export const PAUSA_REVISION_MS = 2_000;
const MAX_CAMPANAS = 10;
// Los únicos textos que se cargan: los del anuncio. Un texto distinto es otra campaña que el flujo no reconocería.
export const TEXTOS_APROBADOS = {
  'tortas-mexicanas': 'Hola, vi el anuncio de las tortas mexicanas y quiero hacer un pedido.',
  'jueves-de-mas-2': 'Hola, vi la promoción Jueves de +2 y quiero hacer una reserva.',
};
// Los titulares: lo que dice en GRANDE la imagen del anuncio (el flujo reconoce la campaña también por la imagen). Sin montos: el precio no es titular.
export const TITULARES_APROBADOS = {
  'tortas-mexicanas': ['Tortas Mexicanas', 'Mañanas Tortas Mexicanas'],
  'jueves-de-mas-2': ['Jueves de +2'],
};
// Las cifras del servidor para los titulares (`campanas.ts`: MAX_TITULARES, MIN/MAX_LARGO_TITULAR, MAX_TITULARES_AL_FLUJO); la prueba las compara.
export const MAX_TITULARES = 5;
export const MIN_LARGO_TITULAR = 6;
export const MAX_LARGO_TITULAR = 100;
export const MAX_TITULARES_AL_FLUJO = 3;
const MONTO = /(\bbs\.?|\busd|\$)\s*\d|\d\s*(bs|usd|\$)/;
const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const POR_PLAN = { impulso: 0, crecimiento: 3, pro: 10, byoc: 10 };
const ID = /^[a-z0-9-]{1,40}$/;
const ID_PRODUCTO = /^[A-Za-z0-9_-]{1,100}$/;
const INVISIBLES = /[\p{Cf}\p{Cc}]/u;
const ENLACE = /https?:|www\.|\b\S+\.(?:com|net|org|bo|io|app|me|link|ly)\b/i;
const CLAVES_ARCHIVO = new Set(['tenant', 'campanas']);
const CLAVES_CAMPANA = new Set(['id', 'texto', 'titulares', 'productoId']);
const CON_VALOR = ['proyecto', 'tenant', 'archivo', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];

export const USO = '  node admin/scripts/datos/qtaco/cargar-campanas.mjs --proyecto <id> [--respaldo <ruta> --aplicar] [--confirmo-produccion qtaco]\n'
  + '  node admin/scripts/datos/qtaco/cargar-campanas.mjs --proyecto <id> --revertir --respaldo <ruta> [--aplicar] [--confirmo-produccion qtaco]';

// ===========================================================================
// FECHAS (días de Bolivia, UTC-4 fijo) Y COMPARACIONES (puras)
// ===========================================================================
export const diaBolivia = (ms) => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);
export const sumarDias = (fecha, n) => new Date(Date.parse(`${fecha}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const palabras = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const colapsar = (x) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : x);
const clave = (c) => JSON.stringify([c?.id, (c?.texto ?? '').trim(), c?.inicio, c?.fin, c?.productoId ?? null, Array.isArray(c?.titulares) ? c.titulares.map(colapsar) : null]);

// ===========================================================================
// VALIDACIÓN DEL ARCHIVO (igual al servidor, sin modelo)
// ===========================================================================
/** Los problemas del archivo (lista vacía si cumple). `productosActivos`: ids del catálogo ACTIVO; sin él no se comprueba el producto. */
export function validarArchivo(datos, { productosActivos = null, limite = MAX_CAMPANAS } = {}) {
  const p = [];
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return ['el archivo no es un objeto JSON'];
  for (const k of Object.keys(datos)) if (!k.startsWith('_') && !CLAVES_ARCHIVO.has(k)) p.push(`clave desconocida: «${k.slice(0, 40)}»`);
  const lista = datos.campanas;
  if (!Array.isArray(lista) || lista.length === 0) return [...p, 'campanas: tiene que ser una lista con al menos una campaña'];
  if (lista.length > Math.min(limite, MAX_CAMPANAS)) p.push(`campanas: ${lista.length}, y el comercio admite ${Math.min(limite, MAX_CAMPANAS)} a la vez (no se recorta en silencio)`);
  const ids = new Set();
  const textos = new Map();
  const titularesVistos = new Map();
  lista.forEach((c, i) => {
    const donde = `campanas[${i}]`;
    if (!c || typeof c !== 'object' || Array.isArray(c)) { p.push(`${donde}: tiene que ser un objeto`); return; }
    for (const k of Object.keys(c)) if (!CLAVES_CAMPANA.has(k)) p.push(`${donde}: clave desconocida «${k.slice(0, 40)}»`);
    if (typeof c.id !== 'string' || !ID.test(c.id)) p.push(`${donde}.id: minúsculas, dígitos y guiones, 1 a 40`);
    else if (ids.has(c.id)) p.push(`${donde}.id: «${c.id}» repetido`);
    else ids.add(c.id);
    if (typeof c.texto !== 'string' || c.texto.trim() === '') { p.push(`${donde}.texto: obligatorio, con palabras`); }
    else {
      const t = c.texto.trim();
      if (t.length < MINIMO_TEXTO || t.length > TOPE_TEXTO) p.push(`${donde}.texto: de ${MINIMO_TEXTO} a ${TOPE_TEXTO} caracteres`);
      if (INVISIBLES.test(c.texto.normalize('NFKC'))) p.push(`${donde}.texto: caracteres invisibles o de control`);
      if (ENLACE.test(c.texto)) p.push(`${donde}.texto: un texto no lleva enlaces`);
      if (typeof c.id === 'string' && Object.hasOwn(TEXTOS_APROBADOS, c.id) && c.texto !== TEXTOS_APROBADOS[c.id]) {
        p.push(`${donde}.texto: no es el texto exacto del anuncio de «${c.id}» (el flujo reconoce la campaña por él)`);
      }
      const n = palabras(t);
      const otro = textos.get(n);
      if (otro !== undefined) p.push(`${donde}.texto: ya lo usa la campaña «${otro}»`);
      textos.set(n, c.id);
    }
    if (!Array.isArray(c.titulares) || c.titulares.length === 0) p.push(`${donde}.titulares: obligatorios (de 1 a ${MAX_TITULARES}; el flujo reconoce el anuncio por su imagen)`);
    else {
      if (c.titulares.length > MAX_TITULARES) p.push(`${donde}.titulares: de 1 a ${MAX_TITULARES}`);
      if (c.titulares.length > MAX_TITULARES_AL_FLUJO) p.push(`${donde}.titulares: al flujo viajan ${MAX_TITULARES_AL_FLUJO}, no más`);
      c.titulares.forEach((t, j) => {
        const d2 = `${donde}.titulares[${j}]`;
        if (typeof t !== 'string') { p.push(`${d2}: tiene que ser un texto`); return; }
        const u = colapsar(t);
        if (u.length < MIN_LARGO_TITULAR || u.length > MAX_LARGO_TITULAR) p.push(`${d2}: de ${MIN_LARGO_TITULAR} a ${MAX_LARGO_TITULAR} caracteres`);
        if (MONTO.test(sinTildes(u))) p.push(`${d2}: un titular no lleva montos (el precio sale del producto)`);
        if (INVISIBLES.test(t.normalize('NFKC'))) p.push(`${d2}: caracteres invisibles o de control`);
        if (ENLACE.test(t)) p.push(`${d2}: un titular no lleva enlaces`);
        const n = palabras(u);
        const otro = titularesVistos.get(n);
        if (otro !== undefined && otro !== c.id) p.push(`${d2}: ya lo usa la campaña «${otro}»`);
        titularesVistos.set(n, c.id);
      });
      if (typeof c.id === 'string' && Object.hasOwn(TITULARES_APROBADOS, c.id)
        && JSON.stringify(c.titulares.map(colapsar)) !== JSON.stringify(TITULARES_APROBADOS[c.id])) {
        p.push(`${donde}.titulares: no son los titulares exactos de la imagen de «${c.id}» (el flujo reconoce el anuncio por ellos)`);
      }
    }
    if (typeof c.id === 'string' && !Object.hasOwn(TEXTOS_APROBADOS, c.id)) p.push(`${donde}.id: «${c.id.slice(0, 40)}» no es una de las campañas de Q'Taco (${Object.keys(TEXTOS_APROBADOS).join(', ')})`);
    if (c.productoId !== undefined) {
      if (typeof c.productoId !== 'string' || !ID_PRODUCTO.test(c.productoId) || /^__.*__$/.test(c.productoId)) p.push(`${donde}.productoId: un id de catálogo válido`);
      else if (productosActivos && !productosActivos.has(c.productoId)) p.push(`${donde}.productoId: «${c.productoId}» no existe o no está activo en el catálogo del comercio (este script no crea productos)`);
    }
  });
  for (const id of Object.keys(TEXTOS_APROBADOS)) if (!ids.has(id)) p.push(`campanas: falta la campaña «${id}» (el archivo tiene que traer exactamente las campañas de Q'Taco: ${Object.keys(TEXTOS_APROBADOS).join(', ')})`);
  return p;
}

/** ¿Está el reloj en los últimos 10 minutos del día de La Paz (23:50 a 24:00)? Ahí no se aplica. */
export const enFranjaDeMedianoche = (ms) => { const d = new Date(ms - 4 * 3_600_000); return d.getUTCHours() === 23 && d.getUTCMinutes() >= 50; };

/** El estado de una campaña según el `revision` que escribió el servidor: `{ estado, motivo }` (`sin_revision` si aún no hay). */
export function estadoDeRevision(revision, id) {
  const r = revision && typeof revision === 'object' ? revision.porCampana?.[id] : undefined;
  return r && typeof r.estado === 'string' ? { estado: r.estado, motivo: typeof r.motivo === 'string' ? r.motivo : '' } : { estado: 'sin_revision', motivo: '' };
}

/** Las campañas que se escribirían: inicio = hoy, fin = hoy + 365 (366 días inclusive). */
export function armarLista(datos, hoy) {
  const fin = sumarDias(hoy, DIAS_DE_VIGENCIA - 1);
  return datos.campanas.map((c) => ({ id: c.id, texto: c.texto.trim(), inicio: hoy, fin, titulares: c.titulares.map(colapsar), ...(c.productoId !== undefined ? { productoId: c.productoId } : {}) }));
}

/** Las mismas comprobaciones de fechas del servidor sobre lo que se va a escribir (nunca debería fallar; si falla, no se escribe). */
export function problemasDeFechas(lista, hoy) {
  const p = [];
  for (const c of lista) {
    if (c.fin < c.inicio) p.push(`${c.id}: el fin es anterior al inicio`);
    if (c.fin < hoy) p.push(`${c.id}: el fin ya pasó`);
    if (c.inicio < hoy) p.push(`${c.id}: el inicio ya pasó`);
    if (diasEntre(hoy, c.inicio) > MAX_DIAS_HASTA_EL_INICIO) p.push(`${c.id}: empieza en más de seis meses`);
    if (diasEntre(c.inicio, c.fin) + 1 > MAX_DIAS_DE_DURACION) p.push(`${c.id}: dura más de ${MAX_DIAS_DE_DURACION} días`);
  }
  return p;
}

/**
 * La lista final: las campañas de Q'Taco que hay que escribir (nuevas o distintas), las que ya están iguales y vigentes (no se tocan) y las ajenas
 * (se conservan). Pura.
 */
export function planDeLista(existentes, datos, hoy) {
  const deArchivo = armarLista(datos, hoy);
  const porId = new Map(existentes.map((c) => [c && c.id, c]));
  const filas = deArchivo.map((c) => {
    const viejo = porId.get(c.id);
    if (!viejo) return { c, estado: 'nuevo' };
    const igual = (viejo.texto ?? '').trim() === c.texto && (viejo.productoId ?? null) === (c.productoId ?? null)
      && typeof viejo.inicio === 'string' && typeof viejo.fin === 'string' && viejo.inicio <= hoy && hoy <= viejo.fin && diasEntre(hoy, viejo.fin) >= DIAS_PARA_RENOVAR
      && JSON.stringify(viejo.titulares ?? null) === JSON.stringify(c.titulares) && viejo.angulo === undefined;
    return igual ? { c: viejo, estado: 'igual' } : { c, estado: 'cambia' };
  });
  const ids = new Set(deArchivo.map((c) => c.id));
  const ajenas = existentes.filter((c) => c && !ids.has(c.id));
  const lista = [...filas.map((f) => f.c), ...ajenas];
  return { filas, lista, ajenas, escribir: filas.filter((f) => f.estado !== 'igual').map((f) => f.c) };
}

// ===========================================================================
// ARGUMENTOS
// ===========================================================================
export function analizarArgumentos(argv, env = process.env, opciones = {}) {
  const problemas = [];
  const valores = { __proto__: null };
  const banderas = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string' || !a.startsWith('--')) { problemas.push('argumento suelto (sin su opción)'); continue; }
    const nombre = a.slice(2);
    if (BANDERAS.includes(nombre)) {
      if (banderas.includes(nombre)) problemas.push(`opción repetida: --${nombre}`);
      banderas.push(nombre);
    } else if (CON_VALOR.includes(nombre)) {
      if (nombre in valores) problemas.push(`opción repetida: --${nombre}`);
      const valor = argv[i + 1];
      if (valor === undefined || valor.startsWith('--')) { problemas.push(`--${nombre} sin valor`); continue; }
      valores[nombre] = valor;
      i += 1;
    } else {
      problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40)}`);
    }
  }
  const aplicar = banderas.includes('aplicar');
  const revertir = banderas.includes('revertir');
  const { proyecto, respaldo } = valores;
  const confirmo = valores['confirmo-produccion'];
  if ('tenant' in valores && valores.tenant !== TENANT) problemas.push(`este script es SOLO del comercio «${TENANT}»: --tenant distinto, no se escribe nada`);

  if (proyecto === undefined) problemas.push('falta --proyecto');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto !== undefined && !proy.ok) problemas.push(proy.motivo);

  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== TENANT) problemas.push(`--confirmo-produccion tiene que ser «${TENANT}»`);
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) {
    problemas.push(`contra producción, --aplicar exige --confirmo-produccion ${TENANT}`);
  }
  if (revertir && respaldo === undefined) problemas.push('--revertir exige --respaldo <ruta>');
  if (!revertir && aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta> (por omisión no hay respaldo)');
  let respaldoReal = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: revertir });
    if (r.ok) respaldoReal = respaldo; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, archivo: valores.archivo ?? ARCHIVO_POR_OMISION, aplicar, revertir, respaldo: respaldoReal } };
}

/** Lee el JSON de datos y comprueba que sea de Q'Taco. Devuelve `{ datos }` o `{ error }`. */
export function leerArchivo(ruta) {
  let datos;
  try { datos = JSON.parse(readFileSync(ruta, 'utf8')); } catch (e) { return { error: `No se pudo leer ${ruta} como JSON: ${e.message}` }; }
  if (!datos || typeof datos !== 'object' || datos.tenant !== TENANT) {
    return { error: `El archivo es del comercio «${String(datos?.tenant ?? '(sin campo tenant)').slice(0, 60)}» (tiene que decir «${TENANT}»): no se escribe nada.` };
  }
  return { datos };
}

// ===========================================================================
// RESPALDO
// ===========================================================================
/** Lo que se guarda: la lista previa de campañas del comercio (o su ausencia) y lo que se escribió. Sin secretos. */
export function contenidoDelRespaldo({ entorno, existia, previa, escrito }) {
  return { version: 1, entorno, tenant: TENANT, creadoEn: new Date().toISOString(), previo: { documento: existia, lista: previa }, escrito };
}

const MAXIMO_RESPALDO = 64 * 1024;
const CLAVES_ESCRITA = new Set(['id', 'texto', 'inicio', 'fin', 'titulares', 'productoId']);
const CLAVES_REGLA = new Set(['id', 'texto', 'inicio', 'fin', 'titulares', 'productoId', 'angulo']);
const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const clavesDentro = (o, permitidas) => Object.keys(o).every((k) => permitidas.has(k));

/** El respaldo se LEE con desconfianza: lo que trae se vuelve a escribir en producción. Valida el contenido, no solo la forma. */
export function validarContenidoDelRespaldo(r) {
  if (!esObjeto(r) || r.version !== 1 || !esObjeto(r.previo) || typeof r.previo.documento !== 'boolean' || !Array.isArray(r.previo.lista) || !Array.isArray(r.escrito) || r.escrito.length === 0) {
    return 'el respaldo no tiene la forma esperada';
  }
  if (r.escrito.length > Object.keys(TEXTOS_APROBADOS).length) return 'el respaldo dice que se escribieron más campañas que las de Q\'Taco';
  const idsEscritos = new Set();
  for (const e of r.escrito) {
    if (!esObjeto(e) || !clavesDentro(e, CLAVES_ESCRITA) || typeof e.id !== 'string' || !Object.hasOwn(TEXTOS_APROBADOS, e.id)
      || typeof e.texto !== 'string' || e.texto.length > TOPE_TEXTO || typeof e.inicio !== 'string' || typeof e.fin !== 'string'
      || (e.productoId !== undefined && typeof e.productoId !== 'string')
      || (e.titulares !== undefined && (!Array.isArray(e.titulares) || e.titulares.length > MAX_TITULARES_AL_FLUJO || e.titulares.some((t) => typeof t !== 'string' || t.length > MAX_LARGO_TITULAR))) || idsEscritos.has(e.id)) {
      return 'el respaldo trae una campaña escrita que no es de Q\'Taco o con claves que este script no escribe';
    }
    idsEscritos.add(e.id);
  }
  if (r.previo.lista.length > MAX_CAMPANAS) return 'el respaldo trae más campañas previas que el máximo';
  const idsPrevios = new Set();
  for (const c of r.previo.lista) {
    const n = esObjeto(c) ? Object.keys(c).length : 0;
    if (!esObjeto(c) || n < 4 || n > 7 || !clavesDentro(c, CLAVES_REGLA) || typeof c.id !== 'string' || typeof c.texto !== 'string' || c.texto.length > TOPE_TEXTO || idsPrevios.has(c.id)) {
      return 'el respaldo trae una campaña previa que no tiene la forma de una regla de campaña';
    }
    idsPrevios.add(c.id);
  }
  return null;
}

export function leerRespaldoDeCampanas(ruta, entorno) {
  let r;
  let fd;
  try {
    fd = openSync(ruta, constants.O_RDONLY | constants.O_NOFOLLOW);
    const st = fstatSync(fd);
    if (!st.isFile()) return { ok: false, motivo: 'el respaldo no es un archivo regular' };
    if (st.size > MAXIMO_RESPALDO) return { ok: false, motivo: 'el respaldo es demasiado grande' };
    r = JSON.parse(readFileSync(fd, 'utf8'));
  } catch { return { ok: false, motivo: 'el respaldo no se pudo abrir ni leer como JSON' }; } finally { if (fd !== undefined) closeSync(fd); }
  if (esObjeto(r) && r.tenant !== TENANT) return { ok: false, motivo: 'el respaldo es de otro comercio' };
  if (esObjeto(r) && r.entorno !== entorno) return { ok: false, motivo: 'el respaldo es de otro entorno (staging, produccion o emulador)' };
  const malo = validarContenidoDelRespaldo(r);
  if (malo) return { ok: false, motivo: malo };
  return { ok: true, respaldo: r };
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================
const SELLO = 'cargar-campanas-qtaco';

async function leerContexto(db, tx, datos) {
  const refTenant = db.doc(`tenants/${TENANT}`);
  const refCuenta = db.doc(`tenants/${TENANT}/cuenta/estado`);
  const refCamp = db.doc(`tenants/${TENANT}/config/campanas`);
  const [tenant, cuenta, camp] = await Promise.all([tx.get(refTenant), tx.get(refCuenta), tx.get(refCamp)]);
  const ids = [...new Set(datos.campanas.map((c) => c.productoId).filter((x) => typeof x === 'string'))];
  const docs = ids.length ? await tx.getAll(...ids.map((i) => db.doc(`tenants/${TENANT}/catalogo/${i}`))) : [];
  return { refCamp, tenant, cuenta, camp, activos: new Set(docs.filter((d) => d.exists && d.get('activo') === true).map((d) => d.id)) };
}

/** Corre la operación ya validada. Devuelve el código de salida. `deps`: `{ db, Timestamp, FieldValue, log, ahora }`. */
export async function ejecutar(cfg, datos, deps) {
  const { db, Timestamp } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const ahoraMs = (deps.ahora ?? Date.now)();
  const hoy = diaBolivia(ahoraMs);
  const rotulo = `${cfg.entorno} · tenant ${TENANT}`;

  // ------------------------------------------------------------------ revertir
  if (cfg.revertir) {
    const lectura = leerRespaldoDeCampanas(cfg.respaldo, cfg.entorno);
    if (!lectura.ok) { log(`\n  ✗ ${lectura.motivo}\n`); return 2; }
    const { previo, escrito } = lectura.respaldo;
    const ids = new Set(escrito.map((c) => c.id));
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO (solo lecturas)'} · ${rotulo}\n`);
    let codigo = 0;
    await db.runTransaction(async (tx) => {
      const refCamp = db.doc(`tenants/${TENANT}/config/campanas`);
      const camp = await tx.get(refCamp);
      const hoyLista = Array.isArray(camp.get('lista')) ? camp.get('lista') : [];
      const actuales = hoyLista.filter((c) => c && ids.has(c.id));
      if (actuales.length === 0) { log('  ✓ Ninguna de las campañas escritas está en la lista: nada que revertir.\n'); return; }
      if (actuales.length !== escrito.length || escrito.some((e) => !actuales.some((a) => clave(a) === clave(e)))) {
        log('  ✗ Las campañas de hoy ya no son las que escribió este script: alguien las cambió después. Revertir pisaría ese cambio. No se escribe nada.\n');
        codigo = 2; return;
      }
      const repuestas = previo.lista.filter((c) => c && ids.has(c.id));
      const resto = hoyLista.filter((c) => !(c && ids.has(c.id)));
      const lista = [...repuestas, ...resto];
      if (lista.length > MAX_CAMPANAS) { log('  ✗ La lista resultante pasaría el máximo de campañas: no se escribe nada.\n'); codigo = 2; return; }
      log(`  quita ${actuales.length} campaña(s) de Q'Taco (${[...ids].join(', ')}) · repone ${repuestas.length} previa(s) · conserva ${resto.length} ajena(s)`);
      if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar para revertir.\n'); return; }
      if (!previo.documento && lista.length === 0) tx.delete(refCamp);
      else tx.set(refCamp, { lista, actualizadoPor: `${SELLO}-revertir`, actualizadoEn: Timestamp.now() }, { mergeFields: ['lista', 'actualizadoPor', 'actualizadoEn'] });
      tx.create(db.collection(`tenants/${TENANT}/auditoria`).doc(), {
        accion: 'revertir_campanas', uid: SELLO, en: Timestamp.now(), campos: ['lista'], conteos: { quitadas: actuales.length, repuestas: repuestas.length },
      });
    });
    if (codigo === 0 && cfg.aplicar) log('  ✓ Revertido. El servidor vuelve a revisar la lista.\n');
    return codigo;
  }

  // -------------------------------------------------------- seco y aplicar
  if (cfg.aplicar && enFranjaDeMedianoche(ahoraMs)) {
    log('\n  ✗ No se aplica entre las 23:50 y las 24:00 de La Paz: el día de la carga cambiaría a mitad de camino. Corra de nuevo pasada la medianoche. No se escribió nada.\n');
    return 2;
  }
  const antes = validarArchivo(datos);
  if (antes.length) { log(`\n  ✗ El archivo no cumple las reglas del servidor (${antes.length}):\n    - ${antes.join('\n    - ')}\n\n  No se escribió nada.\n`); return 2; }

  // Lectura previa (fuera de la transacción) para poder guardar el respaldo ANTES de escribir.
  let previa = null;
  let rechazo = null;
  let plan = null;
  const evaluar = async (tx) => {
    const c = await leerContexto(db, tx, datos);
    if (!c.tenant.exists) return { rechazo: `No existe el comercio «${TENANT}».` };
    if ((c.tenant.get('estado') ?? 'activo') !== 'activo') return { rechazo: `«${TENANT}» no está activo: no se reconfigura.` };
    if (!tieneModulo(c.tenant.data(), 'campanas')) return { rechazo: `«${TENANT}» no tiene el módulo «campanas» encendido (tenants/${TENANT}.modulos): el servidor no revisaría ni usaría las campañas. No se escribe nada.` };
    const propio = c.cuenta.get('limites.campanas');
    const limite = Number.isInteger(propio) && propio >= 0 && propio <= MAX_CAMPANAS ? propio : (POR_PLAN[c.cuenta.get('plan')] ?? 0);
    const problemas = validarArchivo(datos, { productosActivos: c.activos, limite });
    if (problemas.length) return { rechazo: `El archivo no cabe en este comercio:\n    - ${problemas.join('\n    - ')}` };
    const existentes = Array.isArray(c.camp.get('lista')) ? c.camp.get('lista') : [];
    const p = planDeLista(existentes, datos, hoy);
    const malasFechas = problemasDeFechas(p.escribir, hoy);
    if (malasFechas.length) return { rechazo: `Las fechas no cumplen las reglas del servidor:\n    - ${malasFechas.join('\n    - ')}` };
    const textosAjenos = new Set(p.ajenas.map((a) => palabras(a.texto)).filter((t) => t !== ''));
    const titularesAjenos = new Set(p.ajenas.flatMap((a) => (Array.isArray(a.titulares) ? a.titulares : []).map(palabras)).filter((t) => t !== ''));
    const choque = p.filas.find((f) => textosAjenos.has(palabras(f.c.texto)) || f.c.titulares.some((t) => titularesAjenos.has(palabras(t))));
    if (choque) return { rechazo: `Otra campaña del comercio ya tiene el mismo texto o titular que «${choque.c.id}»: el flujo no sabría de cuál viene. No se recorta nada en silencio.` };
    if (p.lista.length > Math.min(limite, MAX_CAMPANAS)) {
      return { rechazo: `Con las campañas que el comercio ya tiene (${existentes.length}), la lista tendría ${p.lista.length} y su plan admite ${limite}. Es una decisión comercial: no se recorta nada en silencio.` };
    }
    return { c, existentes, p, limite };
  };

  try {
    await db.runTransaction(async (tx) => {
      const r = await evaluar(tx);
      if (r.rechazo) { rechazo = r.rechazo; return; }
      plan = { ...r.p, limite: r.limite, creaDocumento: !r.c.camp.exists };
      previa = { documento: r.c.camp.exists, lista: r.existentes, revision: r.c.camp.get('revision') ?? null };
    });
  } catch (e) { log(`  ✗ error de lectura: ${e?.code ?? e?.name ?? 'desconocido'}\n`); return 1; }
  if (rechazo) { log(`\n  ✗ ${rechazo}\n`); return 1; }

  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)'} · ${rotulo}\n`);
  log(`  config/campanas${plan.creaDocumento ? ' (se crea)' : ''} · tope: ${plan.limite} · campañas del archivo: ${plan.filas.length} · ajenas que se conservan: ${plan.ajenas.length}`);
  const revisionPrevia = previa.revision;
  for (const f of plan.filas) {
    const rev = f.estado === 'igual' ? ` · revisión: ${estadoDeRevision(revisionPrevia, f.c.id).estado}` : '';
    log(`    ${f.estado.padEnd(6)} ${f.c.id.padEnd(18)} ${f.c.inicio} → ${f.c.fin}${f.c.productoId ? ' · con producto' : ''}${rev}`);
  }
  const finMasProximo = plan.filas.map((f) => f.c.fin).sort()[0];
  log(`\n  RENOVAR antes del ${finMasProximo} (el fin más próximo; el servidor no admite campañas sin fin).`);
  const malasIguales = plan.filas.filter((f) => f.estado === 'igual').map((f) => ({ id: f.c.id, ...estadoDeRevision(revisionPrevia, f.c.id) })).filter((x) => x.estado !== 'aprobada');
  if (plan.escribir.length === 0) {
    if (malasIguales.length) {
      for (const m of malasIguales) log(`  ✗ ${m.id}: la revisión del servidor es «${m.estado}»${m.motivo ? ` — ${m.motivo}` : ''}. Está cargada pero NO viaja al flujo.`);
      log('\n  Las campañas están iguales, pero alguna no está aprobada por el servidor: no hay nada que escribir, hay que corregirla.\n');
      return 1;
    }
    log('\n  ✓ Las dos campañas ya están cargadas, iguales, vigentes y aprobadas: nada que hacer.\n');
    return 0;
  }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --respaldo <ruta> y --aplicar (el servidor revisará cada campaña al escribirse).\n'); return 0; }

  try {
    guardarRespaldo(cfg.respaldo, contenidoDelRespaldo({ entorno: cfg.entorno, existia: previa.documento, previa: previa.lista, escrito: plan.escribir }));
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa; elija otro nombre. No se escribe nada.\n'); return 2; }
    throw e;
  }
  log(`\n  Respaldo guardado y releído: ${cfg.respaldo}`);

  try {
    await db.runTransaction(async (tx) => {
      const r = await evaluar(tx);
      if (r.rechazo) { rechazo = r.rechazo; return; }
      // Lo que se respaldó tiene que ser lo que hay: si el documento cambió entre la lectura y la escritura, no se escribe.
      if (JSON.stringify(r.existentes) !== JSON.stringify(previa.lista)) { rechazo = 'La lista de campañas cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr el seco.'; return; }
      const ahora = Timestamp.now();
      tx.set(r.c.refCamp, { lista: r.p.lista, actualizadoPor: SELLO, actualizadoEn: ahora }, { mergeFields: ['lista', 'actualizadoPor', 'actualizadoEn'] });
      tx.create(db.collection(`tenants/${TENANT}/auditoria`).doc(), {
        accion: 'cargar_campanas', uid: SELLO, en: ahora, campos: ['lista'], conteos: { campanas: r.p.escribir.length, conservadas: r.p.ajenas.length },
      });
    });
  } catch (e) { log(`  ✗ error de escritura: ${e?.code ?? e?.name ?? 'desconocido'}\n`); return 3; }
  if (rechazo) { log(`\n  ✗ ${rechazo}\n`); return 1; }

  const rel = await db.doc(`tenants/${TENANT}/config/campanas`).get();
  const lista = Array.isArray(rel.get('lista')) ? rel.get('lista') : [];
  const falla = rel.get('actualizadoPor') !== SELLO || plan.escribir.some((e) => !lista.some((c) => clave(c) === clave(e)));
  log(`\n  ${falla ? '✗' : '✓'} Verificación por relectura: ${falla ? 'no coincide' : `${plan.escribir.length} campaña(s) cargadas; el servidor las revisa ahora (revision y vigentes los escribe él)`}`);
  if (falla) return 3;
  log(`  Para deshacer: --revertir --respaldo ${cfg.respaldo}`);

  // El servidor revisa al ver la escritura: se espera su `revision` (distinta de la previa, con una entrada por cada campaña escrita).
  const espera = deps.esperaMs ?? ESPERA_REVISION_MS;
  const pausa = deps.pausaMs ?? PAUSA_REVISION_MS;
  const hashPrevio = previa.revision?.hash ?? null;
  const ids = plan.escribir.map((c) => c.id);
  const todosLosIds = plan.filas.map((f) => f.c.id);
  let revision = null;
  for (let t = 0; ; t += pausa) {
    const doc = await db.doc(`tenants/${TENANT}/config/campanas`).get();
    const rev = doc.get('revision');
    if (rev && typeof rev === 'object' && rev.hash !== hashPrevio && ids.every((id) => rev.porCampana?.[id])) { revision = rev; break; }
    if (t >= espera) break;
    await new Promise((res) => setTimeout(res, pausa));
  }
  if (!revision) {
    log(`\n  ✗ El servidor no escribió su revisión en ${Math.round(espera / 1000)} s. Las campañas quedaron cargadas pero sin comprobar: corra el seco más tarde (o --revertir).\n`);
    return 1;
  }
  let todasBien = true;
  for (const id of todosLosIds) {
    const e = estadoDeRevision(revision, id);
    if (e.estado !== 'aprobada') todasBien = false;
    log(`    revisión ${id.padEnd(18)} ${e.estado}${e.motivo ? ` — ${e.motivo}` : ''}`);
  }
  log(todasBien ? '\n  ✓ El servidor aprobó las campañas cargadas.\n' : '\n  ✗ El servidor NO aprobó alguna campaña: está cargada pero no viaja al flujo. Corríjala o use --revertir.\n');
  return todasBien ? 0 : 1;
}

async function principal() {
  const analisis = analizarArgumentos(process.argv.slice(2));
  if (!analisis.ok) {
    console.error(`\n  ✗ ${analisis.problemas.join('\n  ✗ ')}\n\n${USO}\n`);
    process.exit(2);
  }
  const { cfg } = analisis;
  const lectura = leerArchivo(cfg.archivo);
  if (lectura.error) { console.error(`\n  ✗ ${lectura.error}\n`); process.exit(2); }
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  const codigo = await ejecutar(cfg, lectura.datos, { db, Timestamp });
  await db.terminate().catch(() => {});
  process.exit(codigo);
}

function seEjecutaDirecto() {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}
if (seEjecutaDirecto()) {
  try { await principal(); } catch (e) {
    console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`);
    process.exit(3);
  }
}
