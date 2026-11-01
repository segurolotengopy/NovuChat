/**
 * ESCRIBIR `tenants/{id}.modulos` EN TODAS LAS FICHAS ACTIVAS QUE NO LA TIENEN — seco por omisión.
 *
 * POR QUÉ EXISTE. `aplicar-modulos-tenant.mjs` escribe `modulos` de UN comercio por corrida. Con varias
 * fichas pendientes (H2b-cierre), repetir el comando a mano es el lugar donde se equivoca una lista o se
 * olvida una ficha. Este script hace el LOTE en un solo comando y REUTILIZA, sin copiarla, la lógica del de
 * un comercio: importa su salvaguarda de proyecto, su evaluación y su freno, su respaldo 0600 y su
 * `ejecutar` (precondición de `updateTime`, relectura, escritura de SOLO el campo `modulos`).
 *
 *   node scripts/plataforma/aplicar-modulos-lote.mjs --proyecto <id> [--excluir a,b|ninguno] \
 *        [--acepto <tenant>:<cap,...>]... [--respaldo-dir <dir>] [--aplicar] [--confirmo-produccion lote]
 *   node scripts/plataforma/aplicar-modulos-lote.mjs --revertir --respaldo-dir <dir> --proyecto <id> \
 *        [--acepto <tenant>:<cap,...>]... [--excluir a,b|ninguno] [--aplicar] [--confirmo-produccion lote]
 *
 * QUÉ HACE.
 *   · CANDIDATAS: las fichas de `tenants` que NO tienen el campo `modulos` y no están dadas de baja
 *     (`estado` = `dado_de_baja` o `baja`). Una ficha que ya tiene `modulos` (cualquier valor) se OMITE:
 *     nunca se pisa. Las de `--excluir` se omiten también.
 *   · LA LISTA de cada candidata es la misma derivación de `migrar-modulos.mjs`: los módulos de sus
 *     `flujos` (o `vertical`) más los comunes, con `modulosDeFicha` del registro. Menos las capacidades que
 *     el operador acepte QUITAR con `--acepto <tenant>:<cap,...>` (p. ej. `<tenant>:inventario`: la decisión de
 *     no darle inventario). Lo que no se acepta explícitamente no se quita.
 *   · SECO (sin `--aplicar`): por ficha imprime módulos de antes y de después, los siete chequeos y las
 *     capacidades que cambian (es la salida del seco de `aplicar-modulos-tenant`), y al final cuáles
 *     `--aplicar` rechazaría. Solo lecturas.
 *   · `--aplicar`: exige `--respaldo-dir` y `--excluir` explícitos. Por ficha: si las capacidades que
 *     cambian no son EXACTAMENTE las aceptadas en `--acepto`, o si la ficha ya difiere por sí sola entre
 *     `flujos` y el registro, la RECHAZA (no escribe esa ficha). Las demás se escriben, de a una: respaldo
 *     0600 `<dir>/<tenant>.json`, relectura, escritura de SOLO `modulos` con la precondición de la hora de
 *     actualización, relectura final. Una ficha que falla NO detiene las demás; el script termina con
 *     código 3 y las lista.
 *   · IDEMPOTENTE: una ficha que ya tiene `modulos` se omite; reaplicar el comando no escribe nada.
 *   · `--revertir --aplicar`: restaura ficha por ficha desde `<dir>/<tenant>.json`, con el freno y la
 *     regla de «no pisar cambios ajenos» de `aplicar-modulos-tenant`. Si en el respaldo `modulos` NO
 *     existía, RECHAZA: «tras H2b-cierre borrar modulos corta todo». Nunca borra el campo.
 *
 * UN CLIENTE QUE NO SE TOCA. Ninguno se identifica por nombre en código común. Quien aplica pasa `--excluir <id>` con el id del
 * tenant de ese cliente (es el modo de «no tocarlo»), o `--excluir ninguno` para declarar que no excluye a nadie.
 * Con `--aplicar` la opción es obligatoria: omitirla se rechaza con código 2.
 *
 * SALVAGUARDA DE PROYECTO. La de `aplicar-modulos-tenant` (lista blanca GCP_PROJECT_ID_STAGING /
 * GCP_PROJECT_ID_PROD, emulador `demo-*` con FIRESTORE_EMULATOR_HOST local). Contra PRODUCCIÓN, `--aplicar`
 * exige `--confirmo-produccion lote`. El id de un proyecto real NUNCA se imprime: se dice `staging` o
 * `produccion`. El respaldo queda en una carpeta del usuario, fuera de todo repositorio, 0700/0600.
 *
 * SALIDA. 0: seco sin fichas rechazadas, o aplicado sin fallas. 1: seco con fichas que `--aplicar`
 * rechazaría. 2: uso o salvaguarda (nada escrito). 3: alguna ficha falló o fue rechazada al aplicar (las
 * demás se procesaron), o error de ejecución. 130: Ctrl-C.
 *
 * COSTO. Seco: una lectura del listado de `tenants` más dos lecturas por candidata. `--aplicar`: tres
 * lecturas y UNA escritura de un campo por ficha escrita. 0 mensajes por conversación. NO se corre contra
 * staging ni producción sin el «sí» de Andres.
 */
import { readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULOS_COMUNES_HOY, modulosDeFicha } from '../../functions/src/registro.ts';
import {
  comprobarProyecto, comprobarRespaldo, ejecutar, evaluar, leerRespaldo, mensajeDeInterrupcion, permitirAplicar,
  validarListaDeModulos,
} from './aplicar-modulos-tenant.mjs';

const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const CON_VALOR = ['proyecto', 'respaldo-dir', 'acepto', 'excluir', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];
const ESTADOS_DE_BAJA = ['dado_de_baja', 'baja'];
const CAMPOS_LISTADO = ['flujos', 'vertical', 'modulos', 'estado'];
const tiene = (o, c) => Object.prototype.hasOwnProperty.call(o, c);

export const USO = '  node scripts/plataforma/aplicar-modulos-lote.mjs --proyecto <id> [--excluir a,b|ninguno] '
  + '[--acepto <tenant>:<cap,...>]... [--respaldo-dir <dir>] [--aplicar] [--confirmo-produccion lote]\n'
  + '  node scripts/plataforma/aplicar-modulos-lote.mjs --revertir --respaldo-dir <dir> --proyecto <id> '
  + '[--acepto <tenant>:<cap,...>]... [--excluir a,b|ninguno] [--aplicar] [--confirmo-produccion lote]';

// ===========================================================================
// ARGUMENTOS (puros salvo por mirar el sistema de archivos del respaldo)
// ===========================================================================

/** `[a,b]` o `ninguno`. `{ ok, lista }` o `{ ok: false, problemas }`. */
function validarExcluir(texto) {
  if (texto === 'ninguno') return { ok: true, lista: [] };
  const lista = texto.split(',');
  const problemas = [];
  for (const t of lista) if (!ID_TENANT.test(t)) problemas.push('--excluir trae un id de tenant inválido (o use «ninguno»)');
  lista.forEach((t, i) => { if (lista.indexOf(t) !== i) problemas.push('--excluir trae un tenant repetido'); });
  return problemas.length ? { ok: false, problemas: [...new Set(problemas)] } : { ok: true, lista };
}

/** `tenant:cap,cap` → `{ tenant, caps }`. Los comunes no se pueden quitar: con una lista, manda la lista. */
function validarAcepto(texto) {
  const i = texto.indexOf(':');
  if (i < 0) return { ok: false, problemas: ['--acepto tiene la forma <tenant>:<cap,...>'] };
  const tenant = texto.slice(0, i);
  if (!ID_TENANT.test(tenant)) return { ok: false, problemas: ['--acepto: tenant inválido'] };
  const r = validarListaDeModulos(texto.slice(i + 1), '--acepto', { exigirComunes: false });
  if (!r.ok) return r;
  if (r.lista.some((m) => MODULOS_COMUNES_HOY.includes(m))) {
    return { ok: false, problemas: [`--acepto: no se pueden quitar los módulos comunes (${MODULOS_COMUNES_HOY.join(', ')})`] };
  }
  return { ok: true, tenant, caps: r.lista };
}

/**
 * Valida los argumentos y la salvaguarda. Devuelve `{ ok: true, cfg }` o `{ ok: false, problemas }`. Los
 * problemas nunca incluyen el id del proyecto ni el valor de un argumento desconocido.
 */
export function analizarArgumentos(argv, env = process.env, opciones = {}) {
  const problemas = [];
  const valores = { __proto__: null };
  const aceptos = [];
  const banderas = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string' || !a.startsWith('--')) { problemas.push('argumento suelto (sin su opción)'); continue; }
    const nombre = a.slice(2);
    if (BANDERAS.includes(nombre)) {
      if (banderas.includes(nombre)) problemas.push(`opción repetida: --${nombre}`);
      banderas.push(nombre);
    } else if (CON_VALOR.includes(nombre)) {
      const valor = argv[i + 1];
      if (valor === undefined || valor.startsWith('--')) { problemas.push(`--${nombre} sin valor`); continue; }
      i += 1;
      if (nombre === 'acepto') { aceptos.push(valor); continue; }
      if (nombre in valores) problemas.push(`opción repetida: --${nombre}`);
      valores[nombre] = valor;
    } else {
      problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40)}`);
    }
  }
  const aplicar = banderas.includes('aplicar');
  const revertir = banderas.includes('revertir');
  const proyecto = valores['proyecto'];
  const dir = valores['respaldo-dir'];

  if (proyecto === undefined) problemas.push('falta --proyecto');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto !== undefined && !proy.ok) problemas.push(proy.motivo);

  const confirmo = valores['confirmo-produccion'];
  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (confirmo !== 'lote') problemas.push('--confirmo-produccion tiene que ser exactamente «lote»');
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) {
    problemas.push('contra producción, --aplicar exige --confirmo-produccion lote');
  }

  let excluir = [];
  if ('excluir' in valores) {
    const r = validarExcluir(valores['excluir']);
    if (r.ok) excluir = r.lista; else problemas.push(...r.problemas);
  } else if (aplicar) {
    problemas.push('--aplicar exige --excluir <id,...> (o «ninguno»): declare a quién NO se toca');
  }

  const acepto = { __proto__: null };
  for (const texto of aceptos) {
    const r = validarAcepto(texto);
    if (!r.ok) { problemas.push(...r.problemas); continue; }
    if (r.tenant in acepto) problemas.push('--acepto repite un tenant: júntelos en una sola lista');
    else acepto[r.tenant] = r.caps;
  }

  if ((aplicar || revertir) && dir === undefined) problemas.push(`${revertir ? '--revertir' : '--aplicar'} exige --respaldo-dir <carpeta> (por omisión no hay respaldo)`);
  let respaldoDir = null;
  if (dir !== undefined) {
    // Se valida la carpeta con un nombre de archivo cualquiera dentro de ella: absoluta, fuera de todo repositorio,
    // del usuario y 0700 si ya existe. El archivo de la prueba no existe nunca (nombre que no es un tenant).
    const r = comprobarRespaldo(join(dir, '_carpeta.json'), { ...opciones, permitirExistente: true });
    if (r.ok) respaldoDir = dir; else problemas.push(r.motivo.replace('--respaldo', '--respaldo-dir'));
  }

  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, aplicar, revertir, excluir, acepto, respaldoDir } };
}

// ===========================================================================
// SELECCIÓN Y LISTA (puras)
// ===========================================================================

const sinModulos = (ficha) => {
  const { modulos: _quitado, ...resto } = ficha ?? {};
  return resto;
};

/**
 * Qué se hace con una ficha del listado: `{ accion: 'omitir', motivo }` o `{ accion: 'candidata', derivada }`.
 * La derivación es la de `migrar-modulos.mjs` (`comparar(ficha)`): `modulosDeFicha` sin `modulos`.
 */
export function clasificar(id, ficha, excluir) {
  if (excluir.includes(id)) return { accion: 'omitir', motivo: 'excluida con --excluir' };
  if (ESTADOS_DE_BAJA.includes(ficha?.estado)) return { accion: 'omitir', motivo: 'dada de baja' };
  if (tiene(ficha ?? {}, 'modulos')) return { accion: 'omitir', motivo: 'ya tiene «modulos»' };
  return { accion: 'candidata', derivada: modulosDeFicha(sinModulos(ficha)) };
}

/** La lista destino de una candidata: la derivada menos lo aceptado. `{ ok, destino }` o `{ ok: false, motivo }`. */
export function destinoDe(derivada, aceptadas) {
  const fuera = aceptadas.filter((m) => !derivada.includes(m));
  if (fuera.length) return { ok: false, motivo: `--acepto nombra ${fuera.join(', ')}, que la ficha no tiene derivado de sus flujos: nada que quitar` };
  return { ok: true, destino: derivada.filter((m) => !aceptadas.includes(m)) };
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================

const lista = (l) => (l.length ? l.join(', ') : '(ninguno)');

/**
 * Un `db` que delega en el real pero cuya PRIMERA lectura (la de `ejecutar`) se rechaza si la ficha dejó de ser
 * candidata entre el listado y ahora (`rechaza(datos)` → motivo). La relectura posterior pasa sin mirar.
 */
function dbGuardado(db, rechaza) {
  let lecturas = 0;
  return {
    doc: (p) => db.doc(p),
    getAll: async (...a) => {
      const r = await db.getAll(...a);
      lecturas += 1;
      if (lecturas === 1 && r[0]?.exists) {
        // La lectura de `ejecutar` pide solo flujos, vertical y modulos: `estado` se lee aparte, DESPUÉS, de modo que
        // cualquier cambio posterior a la lectura de `ejecutar` también lo frena la precondición de updateTime.
        const [extra] = await db.getAll(a[0], { fieldMask: ['estado', 'modulos'] });
        const motivo = rechaza(extra.data() ?? {});
        if (motivo) throw Object.assign(new Error(motivo), { code: 'ficha-cambio' });
      }
      return r;
    },
  };
}

/**
 * Corre el lote ya validado. `deps`: `{ db, FieldValue, log, marcarEscritura, listarRespaldos }`. Devuelve el código de salida.
 */
export async function ejecutarLote(cfg, deps) {
  const { db } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const modo = cfg.revertir ? 'REVERTIR' : cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)';
  log(`\n  LOTE · ${modo} · ${cfg.entorno}\n`);
  const fallas = [];
  const rechazadas = [];
  let hechas = 0;
  let omitidas = 0;

  if (cfg.revertir) return revertirLote(cfg, deps, log);

  const docs = await db.collection('tenants').select(...CAMPOS_LISTADO).get();
  const fichas = docs.docs.map((d) => ({ id: d.id, ficha: d.data() ?? {} })).sort((a, b) => a.id.localeCompare(b.id));
  const candidatas = [];
  for (const { id, ficha } of fichas) {
    const c = clasificar(id, ficha, cfg.excluir);
    if (c.accion === 'omitir') { omitidas += 1; log(`  · ${id}: omitida (${c.motivo})`); continue; }
    candidatas.push({ id, ficha, derivada: c.derivada });
  }
  // Un --acepto que no apunta a una candidata es un error de dedo: se corta antes de tocar nada.
  const ids = candidatas.map((c) => c.id);
  const sueltos = Object.keys(cfg.acepto).filter((t) => !ids.includes(t));
  if (sueltos.length) {
    log(`\n  ✗ --acepto nombra tenants que no son candidatos (no existen, ya tienen «modulos», están de baja o excluidos): ${sueltos.join(', ')}. No se escribe nada.\n`);
    return 2;
  }
  if (!cfg.aplicar && cfg.excluir.length === 0) {
    log('  ! Sin --excluir: se incluirían TODAS las candidatas, también el cliente que deba quedar fuera. Con --aplicar, --excluir es obligatorio.');
  }
  log(`\n  candidatas: ${candidatas.length} · omitidas: ${omitidas}\n`);

  for (const { id, ficha, derivada } of candidatas) {
    const aceptadas = cfg.acepto[id] ?? [];
    const d = destinoDe(derivada, aceptadas);
    if (!d.ok) { rechazadas.push(id); log(`  ✗ ${id}: ${d.motivo}`); continue; }
    const permiso = permitirAplicar(evaluar(ficha, d.destino), aceptadas);
    if (!permiso.ok) rechazadas.push(id);
    const cfgFicha = {
      entorno: cfg.entorno, tenant: id, modulos: d.destino, acepto: aceptadas, aplicar: cfg.aplicar, revertir: false,
      respaldo: cfg.respaldoDir ? join(cfg.respaldoDir, `${id}.json`) : null,
    };
    if (!cfg.aplicar) {
      try {
        await ejecutar(cfgFicha, { db, FieldValue: deps.FieldValue, log });
      } catch (e) { fallas.push(id); log(`  ✗ ${id}: error de ejecución (${e?.code ?? e?.name ?? 'desconocido'})`); }
      continue;
    }
    if (!permiso.ok) { log(`\n  ✗ ${id}: rechazada, no se escribe. ${permiso.motivo}\n`); continue; }
    const r = comprobarRespaldo(cfgFicha.respaldo, { permitirExistente: true });
    if (!r.ok) { fallas.push(id); log(`\n  ✗ ${id}: ${r.motivo}\n`); continue; }
    try {
      const guardado = dbGuardado(db, (datos) => (tiene(datos, 'modulos') ? 'la ficha ya tiene «modulos»'
        : ESTADOS_DE_BAJA.includes(datos.estado) ? 'la ficha está dada de baja' : null));
      const codigo = await ejecutar(cfgFicha, { db: guardado, FieldValue: deps.FieldValue, log, marcarEscritura: deps.marcarEscritura });
      if (codigo === 0) hechas += 1; else { fallas.push(id); log(`  ✗ ${id}: terminó con código ${codigo}`); }
    } catch (e) {
      fallas.push(id);
      log(`\n  ✗ ${id}: ${e?.code === 'ficha-cambio' ? `la ficha cambió después del listado (${e.message}); no se escribió` : `error de ejecución (${e?.code ?? e?.name ?? 'desconocido'})`}\n`);
    }
  }

  log('  Resumen del lote');
  log(`    candidatas       : ${candidatas.length}`);
  log(`    escritas         : ${hechas}`);
  log(`    omitidas         : ${omitidas}`);
  log(`    rechazadas       : ${lista(rechazadas)}`);
  log(`    con falla        : ${lista(fallas)}`);
  if (!cfg.aplicar) log('\n  Seco: no se escribió nada.\n');
  if (fallas.length) return 3;
  if (rechazadas.length) return cfg.aplicar ? 3 : 1;
  return 0;
}

/** `--revertir`: ficha por ficha desde `<dir>/<tenant>.json`. Nunca borra `modulos`. */
async function revertirLote(cfg, deps, log) {
  const { db } = deps;
  const archivos = (deps.listarRespaldos ?? ((d) => readdirSync(d)))(cfg.respaldoDir)
    .filter((n) => n.endsWith('.json') && ID_TENANT.test(n.slice(0, -5))).sort();
  const fallas = [];
  let hechas = 0;
  for (const nombre of archivos) {
    const id = nombre.slice(0, -5);
    if (cfg.excluir.includes(id)) { log(`  · ${id}: omitida (excluida con --excluir)`); continue; }
    const ruta = join(cfg.respaldoDir, nombre);
    const r = comprobarRespaldo(ruta, { lectura: true });
    if (!r.ok) { fallas.push(id); log(`  ✗ ${id}: ${r.motivo}`); continue; }
    const lectura = leerRespaldo(ruta, { entorno: cfg.entorno, tenant: id });
    if (!lectura.ok) { fallas.push(id); log(`  ✗ ${id}: ${lectura.motivo}`); continue; }
    if (!lectura.respaldo.previo.modulosPresente) {
      fallas.push(id);
      log(`  ✗ ${id}: «modulos» no existía antes de escribirla; revertir la borraría. No se borra: tras H2b-cierre borrar modulos corta todo.`);
      continue;
    }
    try {
      const guardado = dbGuardado(db, (datos) => (ESTADOS_DE_BAJA.includes(datos.estado) ? 'la ficha está dada de baja' : null));
      const codigo = await ejecutar(
        { entorno: cfg.entorno, tenant: id, revertir: true, aplicar: cfg.aplicar, acepto: cfg.acepto[id] ?? [], respaldo: ruta },
        { db: guardado, FieldValue: deps.FieldValue, log, marcarEscritura: deps.marcarEscritura },
      );
      if (codigo === 0) hechas += 1;
      else if (!(codigo === 1 && !cfg.aplicar)) { fallas.push(id); log(`  ✗ ${id}: terminó con código ${codigo}`); }
    } catch (e) {
      fallas.push(id);
      log(`  ✗ ${id}: ${e?.code === 'ficha-cambio' ? e.message : `error de ejecución (${e?.code ?? e?.name ?? 'desconocido'})`}`);
    }
  }
  log('\n  Resumen de la reversión');
  log(`    respaldos leídos : ${archivos.length}`);
  log(`    revertidas       : ${hechas}`);
  log(`    con falla        : ${lista(fallas)}`);
  if (!cfg.aplicar) log('\n  Seco: no se escribió nada.\n');
  return fallas.length ? 3 : 0;
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
    console.error(mensajeDeInterrupcion(estado));
    process.exit(130);
  });
  const codigo = await ejecutarLote(cfg, { db, FieldValue, marcarEscritura: (v) => { estado = v; } });
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
