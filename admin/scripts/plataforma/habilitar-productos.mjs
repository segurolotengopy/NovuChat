/**
 * HABILITAR PRODUCTOS DESHABILITADOS DE UNA CATEGORÍA — seco por omisión.
 *
 * QUÉ ES. Pone `activo: true` en los ítems de `tenants/{id}/catalogo` que hoy están
 * deshabilitados (`activo !== true`) y cuya categoría es exactamente cervezas, cocteleria o postres
 * (nombres reales del catálogo de qtaco; los helados están dentro de postres). En el catálogo la
 * categoría vive en el campo `area` (la consola lo guarda recortado y en minúsculas, y su filtro compara
 * con `normalizar`: sin tildes y en minúsculas; ver `web/src/modulos/productos/Catalogo.tsx`). Aquí se
 * compara igual que ese filtro, más recorte de espacios: igualdad EXACTA tras `normalizar`. Ni plural ni
 * parecido: «cerveza», «tragos», «helados» o «promociones» NO coinciden y no se tocan. Los deshabilitados
 * de otras categorías solo se cuentan. `--buscar <texto>` es SOLO LECTURA: lista área/nombre/activo de
 * todos los ítems cuyo nombre normalizado contenga el texto, en cualquier estado.
 * Modelado sobre `aplicar-consola-oculta.mjs`: seco, salvaguarda de proyecto, respaldo y reversa.
 *
 *   node scripts/plataforma/habilitar-productos.mjs --proyecto <id> --tenant qtaco \
 *        [--aplicar] [--respaldo <ruta>] [--confirmo-produccion qtaco]
 *   node scripts/plataforma/habilitar-productos.mjs --revertir --respaldo <ruta> \
 *        --tenant qtaco --proyecto <id> [--aplicar] [--confirmo-produccion qtaco]
 *
 * QUÉ HACE.
 *   · SECO (sin `--aplicar`): UNA lectura de la colección (solo `nombre`, `area`, `activo`).
 *     Imprime el conteo por área de TODO el catálogo (total y deshabilitados), avisa si alguna
 *     categoría objetivo no tiene coincidencias, la tabla nombre/categoría/activo de lo que
 *     habilitaría y, aparte, conteo y nombres (con su área) de los deshabilitados de OTRAS
 *     categorías. No escribe.
 *   · `--aplicar`: exige `--respaldo` (ruta absoluta fuera de todo repositorio, carpeta 0700,
 *     archivo 0600, nunca se pisa) con los ids a habilitar; luego, por cada ítem, un `update`
 *     SOLO del campo `activo`, con la precondición de la hora leída. Relee y compara.
 *   · `--revertir --aplicar`: restaura el valor previo REAL de `activo` (ausente, false o null;
 *     si estaba ausente se quita el campo) en los ítems del respaldo que hoy estén en `true`. Los demás no
 *     se tocan. Si el respaldo nombra un ítem que hoy no es de las categorías objetivo, se rechaza entero (2).
 *   · IDEMPOTENTE: sin nada que habilitar, sale con 0 sin escribir. Nunca borra documentos ni crea.
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
/**
 * LAS CATEGORÍAS OBJETIVO: el único lugar donde se cambian. Se escriben ya normalizadas (sin tildes, minúsculas);
 * la comparación es de igualdad EXACTA tras `normalizar` y recorte de espacios: sin plurales ni parecidos.
 */
export const CATEGORIAS = Object.freeze(['cervezas', 'cocteleria', 'postres']);
const CON_VALOR = ['proyecto', 'tenant', 'respaldo', 'confirmo-produccion', 'buscar'];
const BANDERAS = ['aplicar', 'revertir'];

export const USO = '  node scripts/plataforma/habilitar-productos.mjs --proyecto <id> --tenant qtaco '
  + '[--aplicar] [--respaldo <ruta>] [--confirmo-produccion qtaco]\n'
  + '  node scripts/plataforma/habilitar-productos.mjs --proyecto <id> --tenant qtaco --buscar <texto>   (solo lectura)\n'
  + '  node scripts/plataforma/habilitar-productos.mjs --revertir --respaldo <ruta> --tenant qtaco --proyecto <id> '
  + '[--aplicar] [--confirmo-produccion qtaco]\n'
  + `  tenants permitidos: ${TENANTS_PERMITIDOS.join(', ')}; categorías: ${CATEGORIAS.join(', ')}`;

/** Misma función que el filtro de la consola (`normalizar` de Catalogo.tsx), más el recorte de espacios. */
export const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** ¿La categoría (`area`) es una de las tres, igual que la compara la consola? */
export const categoriaObjetivo = (area, categorias = CATEGORIAS) => typeof area === 'string' && categorias.includes(normalizar(area));

/** Conteo por área (normalizada) de TODO el catálogo: total y deshabilitados. Sin área: «(sin área)». */
export function conteoPorArea(items) {
  const m = { __proto__: null };
  for (const it of items) {
    const k = typeof it.area === 'string' && normalizar(it.area) !== '' ? normalizar(it.area) : '(sin área)';
    const c = m[k] ?? { total: 0, deshabilitados: 0 };
    c.total += 1;
    if (it.activo !== true) c.deshabilitados += 1;
    m[k] = c;
  }
  return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Parte los ítems leídos en: los que se habilitarían y los deshabilitados de otras categorías.
 * Un ítem está deshabilitado si `activo` es false, null o está ausente. Cualquier otro valor ('no', 0…) es
 * «no reconocido»: no se habilita ni se cuenta entre las otras; el seco lo lista aparte y no se toca.
 */
export const activoReconocido = (v) => v === true || v === false || v === null || v === undefined;

export function clasificar(items, categorias = CATEGORIAS) {
  const habilitar = [];
  const otras = [];
  const noReconocidos = [];
  for (const it of items) {
    if (it.activo === true) continue;
    if (!activoReconocido(it.activo)) { noReconocidos.push(it); continue; }
    (categoriaObjetivo(it.area, categorias) ? habilitar : otras).push(it);
  }
  const porNombre = (a, b) => String(a.nombre ?? '').localeCompare(String(b.nombre ?? '')) || a.id.localeCompare(b.id);
  return { habilitar: habilitar.sort(porNombre), otras: otras.sort(porNombre), noReconocidos: noReconocidos.sort(porNombre) };
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

  const buscar = valores.buscar;
  if (buscar !== undefined) {
    if (normalizar(buscar) === '' || buscar.length > 40) problemas.push('--buscar necesita un texto de 1 a 40 caracteres');
    if (aplicar || revertir || respaldo !== undefined) problemas.push('--buscar es de solo lectura: no se combina con --aplicar, --revertir ni --respaldo');
  }
  if (revertir && respaldo === undefined) problemas.push('--revertir exige --respaldo <ruta>');
  if (!revertir && aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta> (por omisión no hay respaldo)');
  let respaldoReal = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: revertir, permitirExistente: !revertir });
    if (r.ok) respaldoReal = respaldo; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, buscar: buscar ?? null, aplicar, revertir, respaldo: respaldoReal } };
}

// ===========================================================================
// RESPALDO: ids de los ítems y su valor previo REAL de `activo` (ausente, false o null). Ningún dato del comercio.
// ===========================================================================
export function contenidoDelRespaldo({ entorno, tenant, items }) {
  return {
    version: 1, entorno, tenant, creadoEn: new Date().toISOString(),
    items: items.map((it) => {
      const presente = it.activo !== undefined;
      return { id: it.id, previo: { presente, valor: presente ? it.activo : null } };
    }),
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

const previoValido = (p) => typeof p === 'object' && p !== null && typeof p.presente === 'boolean'
  && (p.presente ? (p.valor === false || p.valor === null) : p.valor === null);

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
  if (r.items.some((x) => typeof x?.id !== 'string' || !ID_ITEM.test(x.id) || !previoValido(x.previo))
    || new Set(ids).size !== ids.length) {
    return { ok: false, motivo: 'el respaldo no guardó los ítems con fidelidad (ids válidos, sin repetidos, valor previo ausente, false o null)' };
  }
  return { ok: true, ids, previos: new Map(r.items.map((x) => [x.id, x.previo])) };
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

export function mensajeDeInterrupcion(estado, revertir = false) {
  if (estado === 'antes') return '\n  ! Interrumpido por el operador antes de escribir. No se escribió nada.\n';
  if (estado === 'escrito') return '\n  ! Interrumpido entre escrituras: algunas SÍ se hicieron. Corra el seco'
    + (revertir ? ' y vuelva a correr la reversa con el mismo respaldo.\n' : '; para deshacer, --revertir con el mismo respaldo.\n');
  return '\n  ! Interrumpido DURANTE una escritura: puede haberse hecho o no. Corra el seco para ver el estado.\n';
}

/**
 * Escribe `activo` ítem por ítem. Devuelve null si todo salió bien, o 3 tras avisar. Mismo estado que la
 * interrupción: «antes» si no se escribió nada; «escrito» si ya hubo escrituras (el mensaje lo dice y recuerda --revertir).
 */
async function escribirTodos(lista, valorDe, marcar, log, siguiente, revertir = false) {
  let hechas = 0;
  for (const it of lista) {
    marcar('escribiendo');
    try {
      await escribirActivo(it.ref, valorDe(it), it.updateTime);
      hechas += 1;
      marcar('escrito');
    } catch (e) {
      marcar(hechas === 0 ? 'antes' : 'escrito');
      const causa = esPrecondicion(e) ? 'un ítem cambió entre la lectura y la escritura' : `error de escritura (${e?.code ?? e?.name ?? 'desconocido'})`;
      if (hechas === 0) log(`\n  ✗ ${causa}: no se escribió nada. ${siguiente}.\n`);
      else if (revertir) log(`\n  ✗ ${causa}: SÍ se revirtieron ${hechas} de ${lista.length} ítem(s). ${siguiente}; el resto sigue habilitado y se revierte repitiendo la reversa con el mismo respaldo.\n`);
      else log(`\n  ✗ ${causa}: SÍ se escribieron ${hechas} de ${lista.length} ítem(s). ${siguiente}; para deshacer, --revertir con el mismo respaldo.\n`);
      return 3;
    }
  }
  return null;
}

/** Corre la operación ya validada. `deps`: `{ db, log, marcarEscritura }`. Devuelve el código de salida. */
export async function ejecutar(cfg, deps) {
  const { db, FieldValue } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const marcar = deps.marcarEscritura ?? (() => {});
  const rotulo = `${cfg.entorno} · tenant ${cfg.tenant}`;
  const items = await leerCatalogo(db, cfg.tenant);

  // ------------------------------------------------------------------ buscar (solo lectura)
  if (cfg.buscar) {
    const q = normalizar(cfg.buscar);
    const halladas = items.filter((i) => normalizar(i.nombre).includes(q));
    log(`\n  BÚSQUEDA (solo lectura) · ${rotulo} · ${halladas.length} ítem(s) de ${items.length}\n`);
    if (halladas.length) log(`  ${'área'.padEnd(16)} ${'nombre'.padEnd(34)} activo`);
    for (const it of halladas) log(`  ${celda(typeof it.area === 'string' && it.area.trim() !== '' ? it.area : '(sin área)', 16)} ${celda(it.nombre, 34)} ${it.activo === true ? 'true' : it.activo === false ? 'false' : '(sin dato)'}`);
    log('');
    return 0;
  }

  // ------------------------------------------------------------------ revertir
  if (cfg.revertir) {
    const lectura = leerRespaldo(cfg.respaldo, cfg);
    if (!lectura.ok) { log(`\n  ✗ ${lectura.motivo}\n`); return 2; }
    const porId = new Map(items.map((i) => [i.id, i]));
    const presentes = lectura.ids.map((id) => porId.get(id)).filter(Boolean);
    if (presentes.some((i) => !categoriaObjetivo(i.area))) {
      log('\n  ✗ El respaldo nombra ítems que hoy no son de las categorías objetivo: se rechaza entero. No se escribe nada.\n');
      return 2;
    }
    const aRevertir = presentes.filter((i) => i.activo === true);
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
    log(`  ítems del respaldo        : ${lectura.ids.length}`);
    log(`  se devuelven a su valor previo: ${aRevertir.length}`);
    if (aRevertir.length === 0) { log('\n  ✓ Nada que revertir.\n'); return 0; }
    if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar para revertir.\n'); return 1; }
    const previoDe = (id) => lectura.previos.get(id);
    const falla = await escribirTodos(aRevertir, (it) => (previoDe(it.id).presente ? previoDe(it.id).valor : FieldValue.delete()), marcar, log, 'Corra el seco y reintente', true);
    if (falla !== null) return falla;
    const despues = new Map((await leerCatalogo(db, cfg.tenant)).map((i) => [i.id, i]));
    const igual = (i) => {
      const p = previoDe(i.id);
      const d = despues.get(i.id);
      return p.presente ? d?.activo === p.valor : d !== undefined && d.activo === undefined;
    };
    if (!aRevertir.every(igual)) {
      log('\n  ✗ La relectura no coincide con lo esperado. Revise con el seco.\n');
      return 3;
    }
    log(`\n  ✓ Revertido: ${aRevertir.length} ítem(s) vuelven a su valor previo.\n`);
    return 0;
  }

  // -------------------------------------------------------- seco y aplicar
  if (items.length === 0) { log(`\n  ✗ ${cfg.tenant}: el catálogo está vacío o no existe (${cfg.entorno})\n`); return 1; }
  const { habilitar, otras, noReconocidos } = clasificar(items);
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
  log(`  Catálogo por área (${items.length} ítems; total / deshabilitados):`);
  for (const [area, c] of conteoPorArea(items)) log(`    ${texto(area).padEnd(24)} ${c.total} / ${c.deshabilitados}`);
  for (const c of CATEGORIAS.filter((k) => !items.some((i) => categoriaObjetivo(i.area, [k])))) {
    log(`  ! AVISO: ninguna área coincide con «${c}» (revise los nombres reales con el conteo de arriba).`);
  }
  log(`\n  Se habilitarían (${habilitar.length}) — categorías: ${CATEGORIAS.join(', ')}`);
  if (habilitar.length) {
    log(`  ${'nombre'.padEnd(34)} ${'categoría'.padEnd(12)} activo`);
    for (const it of habilitar) log(`  ${celda(it.nombre, 34)} ${celda(it.area, 12)} ${it.activo === false ? 'false' : '(sin dato)'} -> true`);
  }
  log(`\n  Deshabilitados de OTRAS categorías (NO se tocan): ${otras.length}`);
  for (const it of otras) log(`    · ${texto(it.nombre)} [${typeof it.area === 'string' && it.area.trim() !== '' ? texto(it.area) : '(sin área)'}]`);
  if (noReconocidos.length) {
    log(`\n  Valor de «activo» no reconocido, no se toca: ${noReconocidos.length}`);
    for (const it of noReconocidos) log(`    · ${texto(it.nombre)} [${typeof it.area === 'string' && it.area.trim() !== '' ? texto(it.area) : '(sin área)'}] tipo ${typeof it.activo}`);
  }

  if (habilitar.length === 0) { log('\n  ✓ Nada que habilitar.\n'); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (y --respaldo) para escribir.\n'); return 1; }

  const contenido = contenidoDelRespaldo({ entorno: cfg.entorno, tenant: cfg.tenant, items: habilitar });
  if (!contenido.items.every((x) => previoValido(x.previo))) {
    log('\n  ✗ Algún ítem tiene un valor previo de «activo» que el respaldo no puede restaurar con fidelidad. No se escribe nada.\n');
    return 2;
  }
  try {
    guardarRespaldo(cfg.respaldo, contenido);
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa; elija otro nombre. No se escribe nada.\n'); return 2; }
    throw e;
  }
  log(`\n  Respaldo guardado y releído: ${cfg.respaldo}`);

  const falla = await escribirTodos(habilitar, () => true, marcar, log, 'Corra el seco');
  if (falla !== null) return falla;
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
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  let estado = 'antes';
  process.on('SIGINT', () => {
    console.error(mensajeDeInterrupcion(estado, cfg.revertir));
    process.exit(130);
  });
  const codigo = await ejecutar(cfg, { db, FieldValue, marcarEscritura: (v) => { estado = v; } });
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
