/**
 * ESCRIBIR `tenants/{id}/config/campanaSaliente` DE UN SOLO COMERCIO — seco por omisión.
 *
 * QUÉ ES. Los topes de la campaña saliente del chat (PR-C, 27/11/2026): `porTanda`, `porDia`, `porReclamo`, `ventanaDias`,
 * `pausaErroresPct`, `pausaMinimoEnviados` y `pausaNoPct`. Dependen de la calidad del número, no de lo que se vende, por eso son
 * de Core y no del plan. Los lee SOLO el servidor (`salidaCampana.ts`, con el SDK Admin) y los escribe NovuChat desde
 * Plataforma: `firestore.rules` no deja que ningún navegador escriba (ni lea de forma especial) este documento. Sin el documento,
 * o con un valor ilegible, la campaña queda CERRADA: no sale ningún mensaje.
 * Los valores viven versionados en `scripts/datos/campana-saliente/<nombre>.json` (cifras; sin identificadores).
 *
 *   node scripts/plataforma/campana-saliente-config.mjs --proyecto <id|prod> --tenant <id> --datos <nombre> \
 *        [--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]
 *
 * QUÉ HACE (mismo patrón que `respuesta-libre.mjs`).
 *   · SECO (sin `--aplicar`): lee el comercio y el documento, imprime qué cambiaría y no escribe.
 *   · `--aplicar`: exige `--respaldo` (ruta absoluta, fuera de todo repositorio, carpeta 0700, archivo 0600, nunca se pisa) con
 *     el valor previo (o su ausencia) y recién entonces UNA escritura, con precondición. Relee y compara.
 *   · Los datos pasan por `leerConfigCampana`, la MISMA función que usa el servidor (compilada en `functions/lib`; corra antes
 *     `pnpm functions:build`): si el servidor los leería como ilegibles, o si traen campos que no son de este documento, se
 *     rechazan con salida 2 sin tocar nada.
 *   · IDEMPOTENTE: si ya está escrito igual, sale con 0 sin escribir.
 *   · Deshacer: restaurar el respaldo o borrar el documento (la campaña vuelve a quedar cerrada).
 *
 * SALVAGUARDA DE PROYECTO: la de `respuesta-libre.mjs` (lista blanca; `--proyecto prod` toma el id de las credenciales y nunca lo
 * imprime; contra producción, `--aplicar` exige `--confirmo-produccion <tenant>` igual a `--tenant`). Salida 0: sin diferencias
 * o escritura comprobada. 1: el seco encontró diferencias. 2: uso o salvaguarda. 3: error de ejecución.
 *
 * COSTO. Seco: dos lecturas. `--aplicar`: tres lecturas y UNA escritura. 0 mensajes por conversación. NO se corre contra
 * producción sin el «sí» de Andres.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comprobarProyecto, comprobarRespaldo, guardarRespaldo } from './aplicar-consola-oculta.mjs';
import { entornoDeCredenciales, proyectoDesdeCredenciales } from './respuesta-libre.mjs';

let leerConfigCampana;
try {
  ({ leerConfigCampana } = await import('../../functions/lib/core/conversacion/salidaCampana.js'));
} catch (e) {
  const { existsSync } = await import('node:fs');
  const falta = !existsSync(new URL('../../functions/lib/core/conversacion/salidaCampana.js', import.meta.url));
  console.error(falta
    ? '\n  ✗ No se encuentra functions/lib/core/conversacion/salidaCampana.js. Compile primero: pnpm functions:build\n'
    : `\n  ✗ No se pudo cargar functions/lib/core/conversacion/salidaCampana.js: ${e?.message ?? e}\n`);
  process.exit(2);
}

export { entornoDeCredenciales };
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const ID_DATOS = /^[a-z0-9][a-z0-9-]{1,40}$/;
const CON_VALOR = ['proyecto', 'tenant', 'datos', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar'];
export const CAMPOS = ['porTanda', 'porDia', 'porReclamo', 'ventanaDias', 'pausaErroresPct', 'pausaMinimoEnviados', 'pausaNoPct'];
const DIRECTORIO_DATOS = join(dirname(fileURLToPath(import.meta.url)), '..', 'datos', 'campana-saliente');

export const USO = '  node scripts/plataforma/campana-saliente-config.mjs --proyecto <id|prod> --tenant <id> --datos <nombre> '
  + '[--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]';

/** Lee `datos/campana-saliente/<nombre>.json` y exige que el servidor lo lea sin cambios. Devuelve `{ok, valor|motivo}`. */
export function cargarDatos(nombre, directorio = DIRECTORIO_DATOS) {
  if (!ID_DATOS.test(nombre)) return { ok: false, motivo: '--datos inválido (minúsculas, dígitos y guiones)' };
  let crudo;
  try {
    crudo = JSON.parse(readFileSync(join(directorio, `${nombre}.json`), 'utf8'));
  } catch {
    return { ok: false, motivo: `no se pudo leer scripts/datos/campana-saliente/${nombre}.json` };
  }
  return validarDatos(crudo);
}

export function validarDatos(crudo) {
  if (crudo === null || typeof crudo !== 'object' || Array.isArray(crudo)) return { ok: false, motivo: 'los datos no son un objeto' };
  if (Object.keys(crudo).some((k) => !CAMPOS.includes(k))) return { ok: false, motivo: 'los datos traen campos que no son de este documento' };
  const leido = leerConfigCampana(crudo);
  if (leido === null) return { ok: false, motivo: 'el servidor leería estos datos como ilegibles (enteros ≥ 1, porReclamo ≤ 10, porcentajes ≤ 100): corríjalos' };
  return { ok: true, valor: Object.fromEntries(CAMPOS.map((k) => [k, leido[k]])) };
}

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
  let { proyecto } = valores;
  const { tenant, respaldo, datos } = valores;
  const confirmo = valores['confirmo-produccion'];

  if (proyecto === undefined) problemas.push('falta --proyecto');
  let proy = { ok: false };
  let dirCredenciales = null;
  if (proyecto === 'prod') {
    const c = proyectoDesdeCredenciales(env);
    if (!c.ok) problemas.push(c.motivo);
    else {
      proyecto = c.id;
      dirCredenciales = c.dir;
      proy = comprobarProyecto(proyecto, c.env);
      if (!proy.ok) problemas.push(proy.motivo);
    }
  } else if (proyecto !== undefined) {
    proy = comprobarProyecto(proyecto, env);
    if (!proy.ok) problemas.push(proy.motivo);
  }

  if (tenant === undefined) problemas.push('falta --tenant');
  else if (tenant.includes(',')) problemas.push('--tenant admite UN solo comercio por corrida (sin comas)');
  else if (!ID_TENANT.test(tenant)) problemas.push('--tenant inválido (minúsculas, dígitos y guiones, de 3 a 60)');

  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) {
    problemas.push('contra producción, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  }

  let deseado = null;
  if (datos === undefined) problemas.push('falta --datos <nombre>');
  else {
    const c = cargarDatos(datos, opciones.directorioDatos);
    if (c.ok) deseado = c.valor; else problemas.push(c.motivo);
  }

  if (aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta> (por omisión no hay respaldo)');
  let respaldoReal = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, permitirExistente: true });
    if (r.ok) respaldoReal = respaldo; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, dirCredenciales, entorno: proy.entorno, tenant, deseado, aplicar, respaldo: respaldoReal } };
}

const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';

/** Los campos del documento que importan, en orden fijo, para comparar y para el respaldo. */
const extraer = (snap) => {
  if (!snap.exists) return null;
  const o = {};
  for (const k of CAMPOS) { const v = snap.get(k); if (v !== undefined) o[k] = v; }
  return o;
};
const igualA = (actual, deseado) => actual !== null && CAMPOS.every((k) => actual[k] === deseado[k]);

/** Para imprimir: son cifras, no secretos. */
export const resumen = (v) => (v === null ? 'AUSENTE' : CAMPOS.filter((k) => v[k] !== undefined).map((k) => `${k}=${v[k]}`).join(', '));

/** Devuelve el código de salida. `deps`: `{ db, log }`. Importable para probar con una base en memoria. */
export async function ejecutar(cfg, deps) {
  const { db } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const rotulo = `${cfg.entorno} · tenant ${cfg.tenant}`;
  const ficha = db.doc(`tenants/${cfg.tenant}`);
  const ref = db.doc(`tenants/${cfg.tenant}/config/campanaSaliente`);

  const [fsnap] = await db.getAll(ficha, { fieldMask: ['estado'] });
  if (!fsnap.exists) { log(`\n  ✗ ${cfg.tenant}: no existe el comercio (${cfg.entorno})\n`); return 1; }
  const [snap] = await db.getAll(ref, { fieldMask: CAMPOS });
  const hoy = extraer(snap);

  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)'} · ${rotulo}\n`);
  log(`  documento hoy      : ${resumen(hoy)}`);
  log(`  documento después  : ${resumen(cfg.deseado)}`);

  if (igualA(hoy, cfg.deseado)) { log('\n  ✓ Ya está así: nada que hacer.\n'); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (y --respaldo) para escribir.\n'); return 1; }

  try {
    guardarRespaldo(cfg.respaldo, {
      version: 1, entorno: cfg.entorno, tenant: cfg.tenant, creadoEn: new Date().toISOString(),
      previo: { presente: snap.exists, valor: hoy },
    });
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa; elija otro nombre. No se escribe nada.\n'); return 2; }
    throw e;
  }
  log(`\n  Respaldo guardado y releído: ${cfg.respaldo}`);

  try {
    if (snap.exists) await ref.update(cfg.deseado, { lastUpdateTime: snap.updateTime });
    else await ref.create(cfg.deseado);
  } catch (e) {
    if (esPrecondicion(e) || e?.code === 6 || e?.code === 'already-exists' || e?.code === 5 || e?.code === 'not-found') {
      log('\n  ✗ El documento cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr el seco.\n');
      return 3;
    }
    throw e;
  }
  const [despues] = await db.getAll(ref, { fieldMask: CAMPOS });
  if (!igualA(extraer(despues), cfg.deseado)) { log('\n  ✗ La relectura no coincide con lo escrito. Revise con el seco; el respaldo guarda el valor previo.\n'); return 3; }
  log(`\n  ✓ Escrito y releído: ${resumen(cfg.deseado)}.\n`);
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
  Object.assign(process.env, entornoDeCredenciales(cfg));
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  process.on('SIGINT', () => { console.error('\n  ! Interrumpido. Corra el seco para ver el estado.\n'); process.exit(130); });
  const codigo = await ejecutar(cfg, { db });
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
