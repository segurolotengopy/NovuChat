/**
 * HABILITAR PRODUCTOS DESHABILITADOS DE UNA CATEGORÍA — seco por omisión.
 *
 * QUÉ ES. Pone `activo: true` en los ítems de `tenants/{id}/catalogo` que hoy están
 * deshabilitados (`activo !== true`) y cuya categoría es exactamente cerveza, postres,
 * helados o tragos. En el catálogo la categoría vive en el campo `area` (la consola lo
 * guarda recortado y en minúsculas, y su filtro compara con `normalizar`: sin tildes y
 * en minúsculas; ver `web/src/modulos/productos/Catalogo.tsx`). Aquí se compara igual
 * que ese filtro: igualdad EXACTA tras `normalizar`. No hay plural ni parecido: «cervezas»
 * NO coincide. Los deshabilitados de otras categorías no se tocan: solo se cuentan.
 * Modelado sobre `aplicar-consola-oculta.mjs`: seco, salvaguarda de proyecto, respaldo y reversa.
 *
 *   node scripts/plataforma/habilitar-productos.mjs --proyecto <id> --tenant qtaco \
 *        [--aplicar] [--respaldo <ruta>] [--confirmo-produccion qtaco]
 *   node scripts/plataforma/habilitar-productos.mjs --revertir --respaldo <ruta> \
 *        --tenant qtaco --proyecto <id> [--aplicar] [--confirmo-produccion qtaco]
 *
 * QUÉ HACE.
 *   · SECO (sin `--aplicar`): UNA lectura de la colección (solo `nombre`, `area`, `activo`).
 *     Imprime la tabla nombre/categoría/activo de lo que habilitaría y, aparte, el conteo y
 *     los nombres de los deshabilitados de OTRAS categorías. No escribe.
 *   · `--aplicar`: exige `--respaldo` (ruta absoluta fuera de todo repositorio, carpeta 0700,
 *     archivo 0600, nunca se pisa) con los ids a habilitar; luego, por cada ítem, un `update`
 *     SOLO del campo `activo`, con la precondición de la hora leída. Relee y compara.
 *   · `--revertir --aplicar`: devuelve `activo: false` a los ítems del respaldo que hoy estén
 *     en `true`. Los que ya no estén en `true` o ya no existan no se tocan.
 *   · IDEMPOTENTE: sin nada que habilitar, sale con 0 sin escribir. Nunca borra ni crea.
 *   · El tenant es de una lista cerrada (`TENANTS_PERMITIDOS`); cualquier otro se rechaza.
 *
 * SALVAGUARDA DE PROYECTO. La de `aplicar-consola-oculta.mjs` (se importa, no se copia):
 * `GCP_PROJECT_ID_STAGING`/`GCP_PROJECT_ID_PROD`; contra producción `--aplicar` exige
 * `--confirmo-produccion <tenant>`. Nunca se imprime el id de un proyecto real.
 *
 * SALIDA. 0: sin diferencias, o escritura hecha y comprobada. 1: el seco encontró diferencias
 * (o no hay catálogo). 2: uso o salvaguarda. 3: error de ejecución. 130: Ctrl-C.
 *
 * COSTO. Seco: una lectura de la colección. `--aplicar`: una lectura, N escrituras de un campo y
 * una relectura. 0 mensajes por conversación. NO se corre contra producción sin el «sí» de Andres.
 */
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comprobarProyecto, comprobarRespaldo } from './aplicar-consola-oculta.mjs';

const CAMPO = 'activo';
export const TENANTS_PERMITIDOS = Object.freeze(['qtaco']);
export const CATEGORIAS = Object.freeze(['cerveza', 'postres', 'helados', 'tragos']);
const CON_VALOR = ['proyecto', 'tenant', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];

export const USO = '  node scripts/plataforma/habilitar-productos.mjs --proyecto <id> --tenant qtaco '
  + '[--aplicar] [--respaldo <ruta>] [--confirmo-produccion qtaco]\n'
  + '  node scripts/plataforma/habilitar-productos.mjs --revertir --respaldo <ruta> --tenant qtaco --proyecto <id> '
  + '[--aplicar] [--confirmo-produccion qtaco]\n'
  + `  tenants permitidos: ${TENANTS_PERMITIDOS.join(', ')}; categorías: ${CATEGORIAS.join(', ')}`;

/** Misma función que el filtro de la consola (`normalizar` de Catalogo.tsx). */
export const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** ¿La categoría (`area`) es una de las cuatro, igual que la compara la consola? */
export const categoriaObjetivo = (area) => typeof area === 'string' && CATEGORIAS.includes(normalizar(area));

/**
 * Parte los ítems leídos en: los que se habilitarían y los deshabilitados de otras categorías.
 * Un ítem está deshabilitado si `activo !== true` (como lo pinta la consola).
 */
export function clasificar(items) {
  const habilitar = [];
  const otras = [];
  for (const it of items) {
    if (it.activo === true) continue;
    (categoriaObjetivo(it.area) ? habilitar : otras).push(it);
  }
  const porNombre = (a, b) => String(a.nombre ?? '').localeCompare(String(b.nombre ?? '')) || a.id.localeCompare(b.id);
  return { habilitar: habilitar.sort(porNombre), otras: otras.sort(porNombre) };
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
  const { proyecto, tenant, respaldo } = valores;
  const confirmo = valores['confirmo-produccion'];

  if (proyecto === undefined) problemas.push('falta --proyecto');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto !== undefined && !proy.ok) problemas.push(proy.motivo);

  if (tenant === undefined) problemas.push('falta --tenant');
  else if (!TENANTS_PERMITIDOS.includes(tenant)) problemas.push(`--tenant fuera de la lista cerrada (${TENANTS_PERMITIDOS.join(', ')})`);

  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) {
    problemas.push('contra producción, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  }

  if (revertir && respaldo === undefined) problemas.push('--revertir exige --respaldo <ruta>');
  if (!revertir && aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta> (por omisión no hay respaldo)');
  let respaldoReal = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: revertir, permitirExistente: !revertir });
    if (r.ok) respaldoReal = respaldo; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, aplicar, revertir, respaldo: respaldoReal } };
}

// ===========================================================================
// RESPALDO: ids de los ítems y su valor previo (siempre false). Ningún dato del comercio.
// ===========================================================================
export function contenidoDelRespaldo({ entorno, tenant, ids }) {
  return {
    version: 1, entorno, tenant, creadoEn: new Date().toISOString(),
    items: ids.map((id) => ({ id, previo: false })),
  };
}

export function guardarRespaldo(ruta, contenido) {
  const dir = dirname(ruta);
  const creada = mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fdDir = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    if (creada !== undefined) fchmodSync(fdDir, 0o700);
    const s0 = fstatSync(fdDir);
    if ((s0.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && s0.uid !== process.getuid())) {
      throw Object.assign(new Error('carpeta'), { code: 'respaldo-carpeta' });
    }
    const texto = `${JSON.stringify(contenido, null, 2)}\n`;
    const fd = openSync(ruta, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      fchmodSync(fd, 0o600);
      writeSync(fd, texto);
      fsyncSync(fd);
      const s = fstatSync(fd);
      const leido = Buffer.alloc(s.size);
      const n = readSync(fd, leido, 0, s.size, 0);
      if (!(s.isFile() && (s.mode & 0o777) === 0o600 && n === s.size && leido.toString('utf8') === texto)) {
        throw Object.assign(new Error('relectura'), { code: 'respaldo-relectura' });
      }
    } finally {
      closeSync(fd);
    }
  } finally {
    closeSync(fdDir);
  }
}

const MAXIMO_RESPALDO = 1024 * 1024;
const ID_ITEM = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

export function leerRespaldo(ruta, { entorno, tenant }) {
  let texto;
  let fd;
  try {
    fd = openSync(ruta, constants.O_RDONLY | constants.O_NOFOLLOW);
    const s = fstatSync(fd);
    if (!s.isFile()) return { ok: false, motivo: 'el respaldo no es un archivo regular' };
    if (typeof process.getuid === 'function' && s.uid !== process.getuid()) return { ok: false, motivo: 'el respaldo no es del usuario' };
    if ((s.mode & 0o077) !== 0) return { ok: false, motivo: 'el respaldo tiene permisos de grupo u otros (tiene que ser 0600)' };
    if (s.size > MAXIMO_RESPALDO) return { ok: false, motivo: 'el respaldo no es un JSON legible' };
    texto = readFileSync(fd, 'utf8');
  } catch {
    return { ok: false, motivo: 'el respaldo no se pudo abrir ni leer' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  let r;
  try { r = JSON.parse(texto); } catch { return { ok: false, motivo: 'el respaldo no es un JSON legible' }; }
  if (r?.version !== 1 || !Array.isArray(r.items)) return { ok: false, motivo: 'el respaldo no tiene la forma esperada' };
  if (r.tenant !== tenant) return { ok: false, motivo: 'el respaldo es de otro comercio' };
  if (r.entorno !== entorno) return { ok: false, motivo: 'el respaldo es de otro entorno (staging, produccion o emulador)' };
  const ids = r.items.map((x) => x?.id);
  if (r.items.some((x) => typeof x?.id !== 'string' || !ID_ITEM.test(x.id) || x.previo !== false)
    || new Set(ids).size !== ids.length) {
    return { ok: false, motivo: 'el respaldo no guardó los ítems con fidelidad (ids válidos, sin repetidos, previo false)' };
  }
  return { ok: true, ids };
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================
const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';
const ruta = (tenant) => `tenants/${tenant}/catalogo`;

/** LAS ÚNICAS ESCRITURAS A FIRESTORE DE TODO EL ARCHIVO: solo `activo`, con la precondición de la hora leída. */
async function escribirActivo(ref, valor, ultimaActualizacion) {
  await ref.update({ [CAMPO]: valor }, { lastUpdateTime: ultimaActualizacion });
}

/** Lee SOLO nombre, area y activo de cada ítem del catálogo. */
async function leerCatalogo(db, tenant) {
  const s = await db.collection(ruta(tenant)).select('nombre', 'area', 'activo').get();
  return s.docs.map((d) => {
    const x = d.data() ?? {};
    return { id: d.id, nombre: x.nombre, area: x.area, activo: x.activo, updateTime: d.updateTime, ref: d.ref };
  });
}

const texto = (v) => (typeof v === 'string' ? v.slice(0, 80).replace(/[\r\n\t]+/g, ' ') : '(sin dato)');
const celda = (v, n) => texto(v).padEnd(n).slice(0, Math.max(n, texto(v).length));

export function mensajeDeInterrupcion(estado) {
  if (estado === 'antes') return '\n  ! Interrumpido por el operador antes de escribir. No se escribió nada.\n';
  if (estado === 'escrito') return '\n  ! Interrumpido entre escrituras: algunas SÍ se hicieron. Corra el seco; para deshacer, --revertir con el mismo respaldo.\n';
  return '\n  ! Interrumpido DURANTE una escritura: puede haberse hecho o no. Corra el seco para ver el estado.\n';
}

/** Corre la operación ya validada. `deps`: `{ db, log, marcarEscritura }`. Devuelve el código de salida. */
export async function ejecutar(cfg, deps) {
  const { db } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const marcar = deps.marcarEscritura ?? (() => {});
  const rotulo = `${cfg.entorno} · tenant ${cfg.tenant}`;
  const items = await leerCatalogo(db, cfg.tenant);

  // ------------------------------------------------------------------ revertir
  if (cfg.revertir) {
    const lectura = leerRespaldo(cfg.respaldo, cfg);
    if (!lectura.ok) { log(`\n  ✗ ${lectura.motivo}\n`); return 2; }
    const porId = new Map(items.map((i) => [i.id, i]));
    const aRevertir = lectura.ids.map((id) => porId.get(id)).filter((i) => i && i.activo === true);
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
    log(`  ítems del respaldo        : ${lectura.ids.length}`);
    log(`  se devuelven a «activo: false»: ${aRevertir.length}`);
    if (aRevertir.length === 0) { log('\n  ✓ Nada que revertir.\n'); return 0; }
    if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar para revertir.\n'); return 1; }
    for (const it of aRevertir) {
      marcar('escribiendo');
      try {
        await escribirActivo(it.ref, false, it.updateTime);
        marcar('escrito');
      } catch (e) {
        if (esPrecondicion(e)) { marcar('antes'); log('\n  ✗ Un ítem cambió entre la lectura y la escritura: se detiene. Corra el seco y reintente.\n'); return 3; }
        throw e;
      }
    }
    const despues = new Map((await leerCatalogo(db, cfg.tenant)).map((i) => [i.id, i]));
    if (aRevertir.some((i) => despues.get(i.id)?.activo !== false)) {
      log('\n  ✗ La relectura no coincide con lo esperado. Revise con el seco.\n');
      return 3;
    }
    log(`\n  ✓ Revertido: ${aRevertir.length} ítem(s) vuelven a «activo: false».\n`);
    return 0;
  }

  // -------------------------------------------------------- seco y aplicar
  if (items.length === 0) { log(`\n  ✗ ${cfg.tenant}: el catálogo está vacío o no existe (${cfg.entorno})\n`); return 1; }
  const { habilitar, otras } = clasificar(items);
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
  log(`  Se habilitarían (${habilitar.length}) — categorías: ${CATEGORIAS.join(', ')}`);
  if (habilitar.length) {
    log(`  ${'nombre'.padEnd(34)} ${'categoría'.padEnd(12)} activo`);
    for (const it of habilitar) log(`  ${celda(it.nombre, 34)} ${celda(it.area, 12)} ${it.activo === false ? 'false' : '(sin dato)'} -> true`);
  }
  log(`\n  Deshabilitados de OTRAS categorías (NO se tocan): ${otras.length}`);
  for (const it of otras) log(`    · ${texto(it.nombre)}`);

  if (habilitar.length === 0) { log('\n  ✓ Nada que habilitar.\n'); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (y --respaldo) para escribir.\n'); return 1; }

  try {
    guardarRespaldo(cfg.respaldo, contenidoDelRespaldo({ entorno: cfg.entorno, tenant: cfg.tenant, ids: habilitar.map((i) => i.id) }));
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa; elija otro nombre. No se escribe nada.\n'); return 2; }
    throw e;
  }
  log(`\n  Respaldo guardado y releído: ${cfg.respaldo}`);

  for (const it of habilitar) {
    marcar('escribiendo');
    try {
      await escribirActivo(it.ref, true, it.updateTime);
      marcar('escrito');
    } catch (e) {
      if (esPrecondicion(e)) { marcar('antes'); log('\n  ✗ Un ítem cambió entre la lectura y la escritura: se detiene. Corra el seco; el respaldo permite revertir lo ya escrito.\n'); return 3; }
      throw e;
    }
  }
  const despues = new Map((await leerCatalogo(db, cfg.tenant)).map((i) => [i.id, i]));
  if (habilitar.some((i) => despues.get(i.id)?.activo !== true)) {
    log('\n  ✗ La relectura no coincide con lo escrito. Revise con el seco; el respaldo permite revertir.\n');
    return 3;
  }
  log(`\n  ✓ Escrito y releído: ${habilitar.length} ítem(s) con «activo: true».`);
  log('  Para deshacer: --revertir con el mismo respaldo, tenant y proyecto.\n');
  return 0;
}

async function principal() {
  const analisis = analizarArgumentos(process.argv.slice(2));
  if (!analisis.ok) {
    console.error(`\n  ✗ ${analisis.problemas.join('\n  ✗ ')}\n\n${USO}\n`);
    process.exit(2);
  }
  const { cfg } = analisis;
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  let estado = 'antes';
  process.on('SIGINT', () => {
    console.error(mensajeDeInterrupcion(estado));
    process.exit(130);
  });
  const codigo = await ejecutar(cfg, { db, marcarEscritura: (v) => { estado = v; } });
  await db.terminate().catch(() => {});
  process.exit(codigo);
}

function seEjecutaDirecto() {
  try {
    return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (seEjecutaDirecto()) {
  try {
    await principal();
  } catch (e) {
    console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`);
    process.exit(3);
  }
}
