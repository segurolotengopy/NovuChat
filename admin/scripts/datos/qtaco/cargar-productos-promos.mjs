/**
 * CARGAR DOS PRODUCTOS DE LA CAMPAÑA «TORTAS MEXICANAS» EN EL CATÁLOGO DE Q'TACO — seco por omisión.
 *
 * QUÉ ES. Crea en `tenants/qtaco/catalogo`, en el área `promociones`, dos ítems con ids FIJOS:
 *   · promo-torta-sin-queso : «Torta mexicana sin queso», Bs 15
 *   · promo-torta-con-queso : «Torta mexicana con queso», Bs 20
 * Ambas incluyen la salsa mexicana especial (va en la descripción). Nada más: ningún otro campo ni ítem.
 *
 *   node scripts/datos/qtaco/cargar-productos-promos.mjs --proyecto <id> --tenant qtaco \
 *        [--aplicar] [--respaldo <ruta>] [--confirmo-produccion qtaco]
 *   node scripts/datos/qtaco/cargar-productos-promos.mjs --revertir --respaldo <ruta> \
 *        --tenant qtaco --proyecto <id> [--aplicar] [--confirmo-produccion qtaco]
 *
 * FORMA DEL ÍTEM (la de `itemValido()` de firestore.rules y `formaDeAltaValida` de limiteCatalogo.ts):
 * `nombre`, `descripcion`, `area`, `precio` (número), `moneda: 'BOB'`, `activo: true` y el sello
 * `actualizadoPor` / `actualizadoEn`. Sin `stock` (nace sin existencias).
 *
 * TOPE DEL PLAN. El catálogo cuenta contra el límite de productos del plan: se lee de `cuenta/estado`
 * (`limites.productos`, entero de 1 a 100000; si no, la tabla de respaldo por `plan`; plan desconocido, el menor,
 * igual que `limiteProductos()` de las reglas). Como `importarCatalogo`, el alta se hace en UNA transacción que
 * también mueve `contadores/catalogo` (+2, `ultimoItem`). Si no caben los dos, no se crea ninguno.
 *
 * NUNCA PISA. Se detiene (sin escribir) si: algún id ya existe; ya hay un ítem con nombre equivalente (igual tras
 * quitar tildes y mayúsculas, o que contenga «torta mexicana»); el tenant no está activo; el contador no coincide
 * con la colección; o no caben en el plan. Los ids se crean con `create` (precondición «no existe»).
 *
 * SALVAGUARDA DE PROYECTO. La de `aplicar-consola-oculta.mjs` (se importa, no se copia):
 * `GCP_PROJECT_ID_STAGING`/`GCP_PROJECT_ID_PROD`; contra producción `--aplicar` exige
 * `--confirmo-produccion qtaco`. Nunca se imprime el id de un proyecto real. Tenant fijo: qtaco.
 *
 * RESPALDO (`--aplicar` lo exige): ruta absoluta fuera de todo repositorio, carpeta 0700, archivo 0600, nunca se
 * pisa. Guarda los dos ítems creados y el contador previo. REVERSA (`--revertir --respaldo`): en una transacción
 * BORRA solo esos dos ids y SOLO si siguen idénticos a lo creado (sin contar la hora del sello); uno modificado se
 * deja y se avisa. Baja el contador en lo borrado y deja `ultimoItem` = el último id borrado (como `bajaContada`).
 *
 * SALIDA. 0: escrito y comprobado (o revertido). 1: el seco puede aplicarse / quedó algo sin revertir. 2: uso,
 * salvaguarda o bloqueo (no se escribió nada). 3: error de ejecución. 130: Ctrl-C.
 *
 * COSTO. Seco: lee 3 documentos (ficha, cuenta, contador) y la colección (nombre, area), 0 escrituras.
 * `--aplicar`: una transacción con 2 altas y 1 escritura de contador. 0 mensajes por conversación.
 * NO se corre contra producción sin el «sí» de Andres.
 */
import { readFileSync, openSync, closeSync, fstatSync, constants, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { comprobarProyecto, comprobarRespaldo, guardarRespaldo } from '../../plataforma/aplicar-consola-oculta.mjs';

export const TENANTS_PERMITIDOS = Object.freeze(['qtaco']);
export const SELLO = 'cargar-productos-promos';
const DESCRIPCION = 'Incluye salsa mexicana especial.';

/** LOS ÚNICOS DOS ÍTEMS QUE ESTE ARCHIVO ESCRIBE (sin el sello). */
export const PRODUCTOS = Object.freeze([
  Object.freeze({ id: 'promo-torta-sin-queso', nombre: 'Torta mexicana sin queso', descripcion: DESCRIPCION, area: 'promociones', precio: 15, moneda: 'BOB', activo: true }),
  Object.freeze({ id: 'promo-torta-con-queso', nombre: 'Torta mexicana con queso', descripcion: DESCRIPCION, area: 'promociones', precio: 20, moneda: 'BOB', activo: true }),
]);
const IDS = PRODUCTOS.map((p) => p.id);

/** Respaldo del límite por plan; es la línea RESPALDO-PRODUCTOS-POR-PLAN de firestore.rules (una prueba lo compara). */
export const PRODUCTOS_POR_PLAN_RESPALDO = Object.freeze({ impulso: 20, crecimiento: 100, pro: 500, byoc: 500 });
const PLAN_MENOR = 20;

const CON_VALOR = ['proyecto', 'tenant', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];
export const USO = '  node scripts/datos/qtaco/cargar-productos-promos.mjs --proyecto <id> --tenant qtaco '
  + '[--aplicar] [--respaldo <ruta>] [--confirmo-produccion qtaco]\n'
  + '  node scripts/datos/qtaco/cargar-productos-promos.mjs --revertir --respaldo <ruta> --tenant qtaco --proyecto <id> '
  + '[--aplicar] [--confirmo-produccion qtaco]\n'
  + `  tenants permitidos: ${TENANTS_PERMITIDOS.join(', ')}`;

export const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Límite de productos de la cuenta, igual que `limiteProductos()` de las reglas. */
export function limiteDeProductos(cuenta) {
  const c = cuenta && typeof cuenta === 'object' ? cuenta : {};
  const propio = c.limites && typeof c.limites === 'object' ? c.limites.productos : null;
  if (Number.isInteger(propio) && propio >= 1 && propio <= 100000) return propio;
  return Object.hasOwn(PRODUCTOS_POR_PLAN_RESPALDO, c.plan) ? PRODUCTOS_POR_PLAN_RESPALDO[c.plan] : PLAN_MENOR;
}

/** ¿Un ítem existente tiene nombre equivalente a alguno de los dos (o es otra «torta mexicana»)? */
export function nombreEquivalente(nombre) {
  const n = normalizar(nombre);
  return n.includes('torta mexicana') || PRODUCTOS.some((p) => normalizar(p.nombre) === n);
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
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: revertir, permitirExistente: false });
    if (r.ok) respaldoReal = respaldo; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, aplicar, revertir, respaldo: respaldoReal } };
}

// ===========================================================================
// EVALUACIÓN (pura): ¿se puede crear? Devuelve los motivos de bloqueo.
// ===========================================================================
export function evaluar({ tenant, cuenta, contador, items }) {
  const bloqueos = [];
  if (!tenant || tenant.estado !== 'activo') bloqueos.push('el comercio no está operativo (estado distinto de «activo»)');
  if (tenant && !(Array.isArray(tenant.modulos) && tenant.modulos.includes('productos'))) bloqueos.push('el comercio no tiene el módulo «productos» encendido (tenants/qtaco.modulos)');
  const limite = limiteDeProductos(cuenta);
  const hay = items.length;
  if (contador && !Number.isInteger(contador.items)) bloqueos.push('contador corrupto: se detiene');
  const guardado = contador && Number.isInteger(contador.items) ? contador.items : null;
  if (guardado !== null && guardado !== hay) bloqueos.push(`el contador del catálogo (${guardado}) no coincide con los ítems reales (${hay}): se detiene`);
  const caben = Math.max(0, limite - Math.max(hay, guardado ?? 0));
  for (const p of PRODUCTOS) {
    if (items.some((i) => i.id === p.id)) bloqueos.push(`el id ${p.id} ya existe: nunca se pisa`);
  }
  for (const i of items) {
    if (!IDS.includes(i.id) && nombreEquivalente(i.nombre)) bloqueos.push(`ya hay un ítem de nombre equivalente (id ${String(i.id).slice(0, 60)})`);
  }
  if (caben < PRODUCTOS.length) bloqueos.push(`no caben en el plan: hay ${hay} de ${limite} y se necesitan ${PRODUCTOS.length}`);
  return { bloqueos, limite, hay, caben, contadorPrevio: contador && typeof contador === 'object' ? { existia: true, items: guardado, ultimoItem: typeof contador.ultimoItem === 'string' ? contador.ultimoItem : '' } : { existia: false, items: null, ultimoItem: '' } };
}

const ruta = (t) => `tenants/${t}`;

/** Lee ficha, cuenta, contador y la colección (solo nombre y area) con `lector` = db o transacción. */
async function leerEstado(db, lector, tenant) {
  const [t, c, k] = await lector.getAll(db.doc(ruta(tenant)), db.doc(`${ruta(tenant)}/cuenta/estado`), db.doc(`${ruta(tenant)}/contadores/catalogo`));
  const s = await lector.get(db.collection(`${ruta(tenant)}/catalogo`).select('nombre', 'area'));
  return {
    tenant: t.exists ? t.data() : null,
    cuenta: c.exists ? c.data() : {},
    contador: k.exists ? k.data() : null,
    items: s.docs.map((d) => ({ id: d.id, nombre: d.data()?.nombre })),
  };
}

// ===========================================================================
// RESPALDO
// ===========================================================================
export function contenidoDelRespaldo({ entorno, tenant, contadorPrevio }) {
  return {
    version: 1, entorno, tenant, creadoEn: new Date().toISOString(),
    items: PRODUCTOS.map((p) => ({ ...p })), contadorPrevio,
  };
}

const iguales = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function leerRespaldo(rutaR, { entorno, tenant }) {
  let texto; let fd;
  try {
    fd = openSync(rutaR, constants.O_RDONLY | constants.O_NOFOLLOW);
    const s = fstatSync(fd);
    if (!s.isFile() || s.size > 64 * 1024) return { ok: false, motivo: 'el respaldo no es un archivo regular legible' };
    if (typeof process.getuid === 'function' && s.uid !== process.getuid()) return { ok: false, motivo: 'el respaldo no es del usuario' };
    if ((s.mode & 0o077) !== 0) return { ok: false, motivo: 'el respaldo tiene permisos de grupo u otros (tiene que ser 0600)' };
    texto = readFileSync(fd, 'utf8');
  } catch { return { ok: false, motivo: 'el respaldo no se pudo abrir ni leer' }; } finally { if (fd !== undefined) closeSync(fd); }
  let r;
  try { r = JSON.parse(texto); } catch { return { ok: false, motivo: 'el respaldo no es un JSON legible' }; }
  if (r?.version !== 1 || !Array.isArray(r.items)) return { ok: false, motivo: 'el respaldo no tiene la forma esperada' };
  if (r.tenant !== tenant) return { ok: false, motivo: 'el respaldo es de otro comercio' };
  if (r.entorno !== entorno) return { ok: false, motivo: 'el respaldo es de otro entorno' };
  if (!iguales(r.items, PRODUCTOS.map((p) => ({ ...p })))) return { ok: false, motivo: 'el respaldo no coincide con los dos productos que este script crea' };
  const cp = r.contadorPrevio;
  if (typeof cp !== 'object' || cp === null || typeof cp.existia !== 'boolean' || typeof cp.ultimoItem !== 'string') {
    return { ok: false, motivo: 'el respaldo no trae el contador previo' };
  }
  return { ok: true, contadorPrevio: cp };
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================
export function mensajeDeInterrupcion(estado) {
  if (estado === 'antes') return '\n  ! Interrumpido por el operador antes de escribir. No se escribió nada.\n';
  return '\n  ! Interrumpido DURANTE la transacción: se hizo completa o no se hizo. Corra el seco para ver el estado.\n';
}

/** Lo que se escribe en cada ítem: LAS ÚNICAS CLAVES (las de la regla de create), más el sello. */
const documento = ({ id, ...resto }, FieldValue) => ({ ...resto, actualizadoPor: SELLO, actualizadoEn: FieldValue.serverTimestamp() });
const sinSello = (d) => { const { actualizadoEn, ...r } = d ?? {}; return r; };

export async function ejecutar(cfg, deps) {
  const { db, FieldValue } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const marcar = deps.marcarEscritura ?? (() => {});
  const rotulo = `${cfg.entorno} · tenant ${cfg.tenant}`;
  const refCat = (id) => db.doc(`${ruta(cfg.tenant)}/catalogo/${id}`);
  const refContador = db.doc(`${ruta(cfg.tenant)}/contadores/catalogo`);

  // ------------------------------------------------------------------ revertir
  if (cfg.revertir) {
    const lectura = leerRespaldo(cfg.respaldo, cfg);
    if (!lectura.ok) { log(`\n  ✗ ${lectura.motivo}\n`); return 2; }
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO (solo lectura)'} · ${rotulo}\n`);
    const planear = async (tx) => {
      const docs = await tx.getAll(...IDS.map(refCat), refContador);
      const k = docs[docs.length - 1];
      const aBorrar = []; const dejar = [];
      PRODUCTOS.forEach((p, i) => {
        const d = docs[i];
        if (!d.exists) return;
        const { id, ...esperado } = p;
        (iguales(Object.fromEntries(Object.entries(sinSello(d.data())).sort()), Object.fromEntries(Object.entries({ ...esperado, actualizadoPor: SELLO }).sort())) ? aBorrar : dejar).push(p.id);
      });
      return { aBorrar, dejar, contador: k.exists ? k.data() : null };
    };
    if (!cfg.aplicar) {
      const { aBorrar, dejar } = await planear({ getAll: (...r) => db.getAll(...r) });
      log(`  se borrarían (idénticos a lo creado): ${aBorrar.length}`);
      for (const id of dejar) log(`  ! ${id} fue modificado: NO se borraría`);
      log(aBorrar.length ? '\n  Seco: no se escribió nada. Agregue --aplicar para revertir.\n' : '\n  ✓ Nada que revertir.\n');
      return aBorrar.length ? 1 : (dejar.length ? 1 : 0);
    }
    marcar('escribiendo');
    const res = await db.runTransaction(async (tx) => {
      const { aBorrar, dejar, contador } = await planear(tx);
      if (aBorrar.length && (!contador || !Number.isInteger(contador.items) || contador.items < aBorrar.length)) return { error: 'el contador del catálogo no permite restar lo borrado' };
      for (const id of aBorrar) tx.delete(refCat(id));
      if (aBorrar.length) tx.set(refContador, { items: contador.items - aBorrar.length, ultimoItem: aBorrar[aBorrar.length - 1], actualizadoEn: FieldValue.serverTimestamp() });
      return { aBorrar, dejar };
    });
    marcar('escrito');
    if (res.error) { log(`\n  ✗ ${res.error}. No se escribió nada.\n`); return 2; }
    for (const id of res.dejar) log(`  ! ${id} fue modificado: se dejó como está`);
    log(`\n  ✓ Revertido: ${res.aBorrar.length} ítem(s) borrado(s).\n`);
    return res.dejar.length ? 1 : 0;
  }

  // -------------------------------------------------------- seco y aplicar
  const estado = await leerEstado(db, { getAll: (...r) => db.getAll(...r), get: (q) => q.get() }, cfg.tenant);
  const ev = evaluar(estado);
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo lectura)'} · ${rotulo}\n`);
  log(`  Catálogo: ${ev.hay} ítems; límite del plan: ${ev.limite}; caben: ${ev.caben}; se necesitan: ${PRODUCTOS.length}`);
  for (const p of PRODUCTOS) log(`    + ${p.id}  «${p.nombre}»  Bs ${p.precio}  [${p.area}]`);
  if (ev.bloqueos.length) {
    for (const b of ev.bloqueos) log(`  ✗ ${b}`);
    log('\n  Bloqueado: no se escribe nada.\n');
    return 2;
  }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (y --respaldo) para escribir.\n'); return 1; }

  try {
    guardarRespaldo(cfg.respaldo, contenidoDelRespaldo({ entorno: cfg.entorno, tenant: cfg.tenant, contadorPrevio: ev.contadorPrevio }));
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa. No se escribe nada.\n'); return 2; }
    throw e;
  }
  log(`  Respaldo guardado y releído: ${cfg.respaldo}`);

  marcar('escribiendo');
  const bloqueos = await db.runTransaction(async (tx) => {
    const e2 = await leerEstado(db, tx, cfg.tenant);
    const v = evaluar(e2);
    if (v.bloqueos.length) return v.bloqueos;
    for (const p of PRODUCTOS) tx.create(refCat(p.id), documento(p, FieldValue));
    tx.set(refContador, { items: (e2.contador && Number.isInteger(e2.contador.items) ? e2.contador.items : e2.items.length) + PRODUCTOS.length, ultimoItem: PRODUCTOS[PRODUCTOS.length - 1].id, actualizadoEn: FieldValue.serverTimestamp() });
    return [];
  });
  marcar('escrito');
  if (bloqueos.length) {
    for (const b of bloqueos) log(`  ✗ ${b}`);
    log('\n  El catálogo cambió entre la lectura y la escritura: no se escribió nada.\n');
    return 2;
  }
  const despues = await db.getAll(...IDS.map(refCat));
  if (!despues.every((d) => d.exists)) { log('\n  ✗ La relectura no coincide con lo escrito. Revise con el seco.\n'); return 3; }
  log(`\n  ✓ Escrito y releído: ${PRODUCTOS.length} ítems.`);
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
  process.on('SIGINT', () => { console.error(mensajeDeInterrupcion(estado)); process.exit(130); });
  const codigo = await ejecutar(cfg, { db, FieldValue, marcarEscritura: (v) => { estado = v; } });
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
