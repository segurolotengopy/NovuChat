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
 *        [--acepto <tenant>:<cap,...>]...
 *   node scripts/plataforma/aplicar-modulos-lote.mjs --proyecto <id> --excluir a,b|ninguno \
 *        [--acepto <tenant>:<cap,...>]... --respaldo-dir <dir> --esperar <huella> --aplicar [--confirmo-produccion lote]
 *
 * QUÉ HACE.
 *   · CANDIDATAS: las fichas de `tenants` que NO tienen el campo `modulos` y no están dadas de baja
 *     (`estado` = `dado_de_baja` o `baja`). Una ficha que ya tiene `modulos` (cualquier valor) se OMITE:
 *     nunca se pisa. Las de `--excluir` se omiten también; un id de `--excluir` que no existe entre las
 *     fichas corta la corrida con 2 (un error de dedo no puede dejar entrar a quien debía quedar fuera).
 *   · LA LISTA de cada candidata es la misma derivación de `migrar-modulos.mjs`: los módulos de sus
 *     `flujos` (o `vertical`) más los comunes, con `modulosDeFicha` del registro. Menos las capacidades que
 *     el operador acepte QUITAR con `--acepto <tenant>:<cap,...>`. Lo que no se acepta explícitamente no se
 *     quita, y NO se acepta una lista en que algún módulo dependa (`dependeDe` del registro) de otro que quedó
 *     fuera: no hay bandera de excepción.
 *   · SECO (sin `--aplicar`): por ficha imprime módulos de antes y de después, los siete chequeos y las
 *     capacidades que cambian, la LISTA EXACTA de ids que se escribirían y una HUELLA (hash de ids y listas
 *     destino). Solo lecturas.
 *   · `--aplicar`: exige `--respaldo-dir`, `--excluir` y `--esperar <huella>` (la del seco que se revisó). Si
 *     las candidatas o sus listas difieren de las del seco (apareció una ficha, cambió una), sale con 2 sin
 *     escribir. Por ficha: si las capacidades que cambian no son EXACTAMENTE las aceptadas en `--acepto`, o la
 *     ficha ya difiere por sí sola entre `flujos` y el registro, la RECHAZA. Las demás se escriben, de a una:
 *     respaldo 0600 `<dir>/<tenant>.json`, relectura, escritura de SOLO `modulos` con la precondición de la hora
 *     de actualización, relectura final. Una ficha que falla NO detiene las demás; el script termina con
 *     código 3 y las lista. Nunca borra el campo `modulos` (no recibe la operación de borrado).
 *   · IDEMPOTENTE: una ficha que ya tiene `modulos` se omite; reaplicar el comando no escribe nada.
 *   · NO HAY `--revertir`: el lote solo escribe fichas SIN `modulos`, y deshacer sería borrarlo, que tras
 *     H2b-cierre corta todo. La vuelta atrás real, ficha por ficha, es
 *     `aplicar-modulos-tenant.mjs --modulos <derivada> --acepto-diferencias <caps>` (con la lista que se quiere
 *     dejar), o corregir con el seco de ese script. El respaldo `<dir>/<tenant>.json` documenta el estado previo.
 *
 * UN CLIENTE QUE NO SE TOCA. Ninguno se identifica por nombre en código común. Quien aplica pasa `--excluir <id>` con el id del
 * tenant de ese cliente (es el modo de «no tocarlo»), o `--excluir ninguno` para declarar que no excluye a nadie.
 * Con `--aplicar` la opción es obligatoria: omitirla se rechaza con código 2.
 *
 * SALVAGUARDA DE PROYECTO. La de `aplicar-modulos-tenant` (lista blanca GCP_PROJECT_ID_STAGING /
 * GCP_PROJECT_ID_PROD, emulador `demo-*` con FIRESTORE_EMULATOR_HOST local). Contra PRODUCCIÓN, `--aplicar`
 * exige además `--confirmo-produccion lote`. El id de un proyecto real NUNCA se imprime: se dice `staging` o
 * `produccion`. El respaldo queda en una carpeta del usuario (no un enlace simbólico), fuera de todo
 * repositorio, 0700/0600.
 *
 * SALIDA. 0: seco sin fichas rechazadas, o aplicado sin fallas. 1: seco con fichas que `--aplicar`
 * rechazaría. 2: uso, salvaguarda, huella distinta o `--excluir` inexistente (nada escrito). 3: alguna ficha
 * falló o fue rechazada al aplicar (las demás se procesaron), o error de ejecución. 130: Ctrl-C (muestra los
 * ids ya escritos). El resumen termina con «quedan SIN modulos: <ids>»
 * en toda corrida que llega a procesar fichas (las salidas tempranas con 2 no lo imprimen).
 *
 * COSTO. Seco: una lectura del listado de `tenants` más dos lecturas por candidata. `--aplicar`: tres
 * lecturas y UNA escritura de un campo por ficha escrita. 0 mensajes por conversación. NO se corre contra
 * staging ni producción sin el «sí» de Andres.
 */
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULOS_COMUNES_HOY, manifiestoDe, modulosDeFicha } from '../../functions/src/registro.ts';
import {
  comprobarProyecto, comprobarRespaldo, ejecutar, evaluar, permitirAplicar, validarListaDeModulos,
} from './aplicar-modulos-tenant.mjs';

const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const HUELLA = /^[0-9a-f]{32}$/;
const CON_VALOR = ['proyecto', 'respaldo-dir', 'acepto', 'excluir', 'confirmo-produccion', 'esperar'];
const BANDERAS = ['aplicar'];
const ESTADOS_DE_BAJA = ['dado_de_baja', 'baja'];
const CAMPOS_LISTADO = ['flujos', 'vertical', 'modulos', 'estado'];
const tiene = (o, c) => Object.prototype.hasOwnProperty.call(o, c);

export const USO = '  node scripts/plataforma/aplicar-modulos-lote.mjs --proyecto <id> [--excluir a,b|ninguno] '
  + '[--acepto <tenant>:<cap,...>]...\n'
  + '  node scripts/plataforma/aplicar-modulos-lote.mjs --proyecto <id> --excluir a,b|ninguno [--acepto <tenant>:<cap,...>]... '
  + '--respaldo-dir <dir> --esperar <huella> --aplicar [--confirmo-produccion lote]';

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
  const proyecto = valores['proyecto'];
  const dir = valores['respaldo-dir'];
  const esperar = valores['esperar'];

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

  if (esperar !== undefined && !HUELLA.test(esperar)) problemas.push('--esperar no tiene la forma de una huella (32 caracteres hexadecimales, la del seco)');
  if (aplicar && esperar === undefined) problemas.push('--aplicar exige --esperar <huella> (la que imprimió el seco que se revisó)');

  const acepto = { __proto__: null };
  for (const texto of aceptos) {
    const r = validarAcepto(texto);
    if (!r.ok) { problemas.push(...r.problemas); continue; }
    if (r.tenant in acepto) problemas.push('--acepto repite un tenant: júntelos en una sola lista');
    else acepto[r.tenant] = r.caps;
  }

  if (aplicar && dir === undefined) problemas.push('--aplicar exige --respaldo-dir <carpeta> (por omisión no hay respaldo)');
  let respaldoDir = null;
  if (dir !== undefined) {
    // Se valida la carpeta con un nombre de archivo cualquiera dentro de ella: absoluta, fuera de todo repositorio,
    // del usuario y 0700 si ya existe. El archivo de la prueba no existe nunca (nombre que no es un tenant).
    const r = comprobarRespaldo(join(dir, '_carpeta.json'), { ...opciones, permitirExistente: true });
    let enlace = false;
    try { enlace = lstatSync(dir).isSymbolicLink(); } catch { /* no existe: se creará */ }
    if (enlace) problemas.push('--respaldo-dir no puede ser un enlace simbólico');
    else if (r.ok) respaldoDir = dir;
    else problemas.push(r.motivo.replace('--respaldo', '--respaldo-dir'));
  }

  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, aplicar, excluir, acepto, respaldoDir, esperar: esperar ?? null } };
}

// ===========================================================================
// SELECCIÓN, LISTA Y HUELLA (puras)
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

/**
 * La lista destino de una candidata: la derivada menos lo aceptado. `{ ok, destino }` o `{ ok: false, motivo }`.
 * Rechaza una lista en que algún módulo dependa (`dependeDe` del registro) de uno que quedó fuera. Sin excepción.
 */
export function destinoDe(derivada, aceptadas) {
  const fuera = aceptadas.filter((m) => !derivada.includes(m));
  if (fuera.length) return { ok: false, motivo: `--acepto nombra ${fuera.join(', ')}, que la ficha no tiene derivado de sus flujos: nada que quitar` };
  const destino = derivada.filter((m) => !aceptadas.includes(m));
  for (const m of destino) {
    const faltan = manifiestoDe(m).dependeDe.filter((d) => !destino.includes(d));
    if (faltan.length) return { ok: false, motivo: `el módulo «${m}» depende de ${faltan.join(', ')}, que quedaría fuera de la lista: no se escribe una lista con dependencias rotas` };
  }
  return { ok: true, destino };
}

/** Huella de lo que el seco mostró: entorno, ids y listas destino (o `null` si la ficha se rechaza), ordenados por id. */
export function huellaDe(plan, entorno) {
  const orden = [...plan].sort((a, b) => a.id.localeCompare(b.id)).map((p) => [p.id, p.destino ?? null]);
  return createHash('sha256').update(JSON.stringify([entorno, orden])).digest('hex').slice(0, 32);
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================

const lista = (l) => (l.length ? l.join(', ') : '(ninguno)');
/** `ejecutar` solo toca `FieldValue` al revertir, que este script nunca pide; si algún día lo hiciera, falla en vez de borrar. */
const TEXTO_DESHACER = '  Este lote no revierte ni borra: la vuelta atrás es reescribir la lista derivada con aplicar-modulos-tenant.mjs --modulos <derivada> --acepto-diferencias <caps>.\n';
const NUNCA_BORRAR = { delete: () => { throw Object.assign(new Error('el lote nunca borra «modulos»'), { code: 'lote-no-borra' }); } };

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
 * Corre el lote ya validado. `deps`: `{ db, log, marcarEscritura, escritas, enCurso }`; `escritas` (lista) recibe
 * los ids ya escritos y `enCurso(id)` el de la ficha en proceso (para el Ctrl-C). Devuelve el código de salida.
 */
export async function ejecutarLote(cfg, deps) {
  const { db } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  log(`\n  LOTE · ${cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)'} · ${cfg.entorno}\n`);
  const fallas = [];
  const rechazadas = [];
  const excluidasSin = [];
  let hechas = 0;
  let omitidas = 0;

  const docs = await db.collection('tenants').select(...CAMPOS_LISTADO).get();
  const fichas = docs.docs.map((d) => ({ id: d.id, ficha: d.data() ?? {} })).sort((a, b) => a.id.localeCompare(b.id));
  // Un id de --excluir que no existe es un error de dedo: la ficha que debía quedar fuera entraría. Se corta antes de todo.
  const existentes = fichas.map((f) => f.id);
  const inexistentes = cfg.excluir.filter((t) => !existentes.includes(t));
  if (inexistentes.length) {
    log(`\n  ✗ --excluir nombra tenants que no existen: ${inexistentes.join(', ')}. No se escribe nada.\n`);
    return 2;
  }
  const candidatas = [];
  for (const { id, ficha } of fichas) {
    const c = clasificar(id, ficha, cfg.excluir);
    if (c.accion === 'omitir') {
      omitidas += 1;
      log(`  · ${id}: omitida (${c.motivo})`);
      if (cfg.excluir.includes(id) && !tiene(ficha, 'modulos') && !ESTADOS_DE_BAJA.includes(ficha.estado)) excluidasSin.push(id);
      continue;
    }
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

  // El plan: lista destino de cada candidata (o el motivo de rechazo) y su huella.
  const plan = candidatas.map((c) => {
    const aceptadas = cfg.acepto[c.id] ?? [];
    if (!ID_TENANT.test(c.id)) return { ...c, aceptadas, error: 'el id del tenant no tiene la forma permitida (minúsculas, dígitos y guiones, de 3 a 60)' };
    const d = destinoDe(c.derivada, aceptadas);
    return d.ok ? { ...c, aceptadas, destino: d.destino } : { ...c, aceptadas, error: d.motivo };
  });
  const huella = huellaDe(plan, cfg.entorno);
  const aEscribir = plan.filter((p) => !p.error).map((p) => p.id);
  log(`\n  candidatas: ${candidatas.length} · omitidas: ${omitidas}`);
  log(`  ids que se escribirían (${aEscribir.length}): ${lista(aEscribir)}`);
  log(`  huella: ${huella}\n`);
  if (cfg.aplicar && cfg.esperar !== huella) {
    log('  ✗ La huella esperada no coincide con la del estado actual: cambiaron las candidatas o sus listas desde el seco. Corra el seco de nuevo, revíselo y use su huella. No se escribe nada.\n');
    return 2;
  }

  for (const p of plan) {
    const { id, ficha, aceptadas } = p;
    if (p.error) { rechazadas.push(id); log(`  ✗ ${id}: ${p.error}`); continue; }
    const permiso = permitirAplicar(evaluar(ficha, p.destino), aceptadas);
    if (!permiso.ok) rechazadas.push(id);
    const cfgFicha = {
      entorno: cfg.entorno, tenant: id, modulos: p.destino, acepto: aceptadas, aplicar: cfg.aplicar, revertir: false,
      respaldo: cfg.respaldoDir ? join(cfg.respaldoDir, `${id}.json`) : null,
    };
    if (!cfg.aplicar) {
      try {
        await ejecutar(cfgFicha, { db, FieldValue: NUNCA_BORRAR, log });
      } catch (e) { fallas.push(id); log(`  ✗ ${id}: error de ejecución (${e?.code ?? e?.name ?? 'desconocido'})`); }
      continue;
    }
    if (!permiso.ok) { log(`\n  ✗ ${id}: rechazada, no se escribe. ${permiso.motivo}\n`); continue; }
    const r = comprobarRespaldo(cfgFicha.respaldo, { permitirExistente: true });
    if (!r.ok) { fallas.push(id); log(`\n  ✗ ${id}: ${r.motivo}\n`); continue; }
    deps.enCurso?.(id);
    try {
      const guardado = dbGuardado(db, (datos) => (tiene(datos, 'modulos') ? 'la ficha ya tiene «modulos»'
        : ESTADOS_DE_BAJA.includes(datos.estado) ? 'la ficha está dada de baja' : null));
      const codigo = await ejecutar(cfgFicha, { db: guardado, FieldValue: NUNCA_BORRAR, textoDeshacer: TEXTO_DESHACER, log, marcarEscritura: deps.marcarEscritura });
      if (codigo === 0) { hechas += 1; deps.escritas?.push(id); } else { fallas.push(id); log(`  ✗ ${id}: terminó con código ${codigo}`); }
    } catch (e) {
      fallas.push(id);
      log(`\n  ✗ ${id}: ${e?.code === 'ficha-cambio' ? `la ficha cambió después del listado (${e.message}); no se escribió` : `error de ejecución (${e?.code ?? e?.name ?? 'desconocido'})`}\n`);
    }
  }

  const quedan = [...new Set([...excluidasSin, ...rechazadas, ...fallas])].sort();
  log('  Resumen del lote');
  log(`    candidatas       : ${candidatas.length}`);
  log(`    escritas         : ${hechas}`);
  log(`    omitidas         : ${omitidas}`);
  log(`    rechazadas       : ${lista(rechazadas)}`);
  log(`    con falla        : ${lista(fallas)}`);
  log(`    quedan SIN modulos: ${lista(quedan)}`);
  log('    Vuelta atrás, ficha por ficha: aplicar-modulos-tenant.mjs --modulos <derivada> --acepto-diferencias <caps> (este lote no revierte ni borra).');
  if (!cfg.aplicar) log('\n  Seco: no se escribió nada.\n');
  if (fallas.length) return 3;
  if (rechazadas.length) return cfg.aplicar ? 3 : 1;
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
  let actual = null;
  const escritas = [];
  process.on('SIGINT', () => {
    console.error(`\n  ! Interrumpido por el operador. Ficha en curso: ${actual ?? '(ninguna)'} (estado: ${estado}; si fue «escribiendo», puede haberse escrito o no: corra el seco).`);
    console.error(`    Ids ya escritos en esta corrida: ${lista(escritas)}.`);
    console.error('    No hay reversión en lote: la vuelta atrás es aplicar-modulos-tenant.mjs por ficha.\n');
    process.exit(130);
  });
  const codigo = await ejecutarLote(cfg, { db, marcarEscritura: (v) => { estado = v; }, escritas, enCurso: (id) => { actual = id; estado = 'antes'; } });
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
