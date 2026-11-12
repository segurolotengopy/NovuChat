/**
 * DAR DE BAJA UN COMERCIO — seco por omisión. LA BAJA NO SE DESHACE CON UN BOTÓN.
 *
 * QUÉ ES. El mismo efecto que la callable `bajaTenant` (`functions/src/plataforma/tenants.ts`), para cuando hay que
 * darlo de baja sin pasar por la consola (no existe ese comercio en la práctica, un alta que no corresponde). La LÓGICA
 * no se copia: es `ejecutarBajaTenant`, de `functions/src/plataforma/baja.ts`, que usan los dos. Calcado de
 * `aplicar-guardar-medios.mjs`: seco, respaldo, relectura e idempotencia; reutiliza sus piezas (proyecto, respaldo).
 *
 *   node scripts/plataforma/baja-comercio.mjs --proyecto <id> --tenant <id> \
 *        [--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]
 *
 * QUÉ HACE, EN ESTE ORDEN (`ejecutarBajaTenant`):
 *   1. la ficha `tenants/{id}`: `estado: 'dado_de_baja'`, `bajaEn` (ahora) y `bajaPor` (`script:baja-comercio`);
 *   2. `marcarRutasDelTenant`: cada ruta de `rutasWhatsApp` de ese comercio pasa a `dado_de_baja`;
 *   3. el gancho al cerrar el negocio: ver «MINICRM» abajo;
 *   4. por cada miembro: se quita su rol de ese comercio y se revocan sus sesiones (`asignarRol(..., null, { revocarSesiones })`);
 *   5. auditoría (`baja_tenant`) en `tenants/{id}/auditoria`.
 *   · SECO (sin `--aplicar`): solo lecturas. Imprime el estado actual, la cantidad de miembros, de rutas (por estado)
 *     y de editores del miniCRM; ningún dato personal (ni correos, ni teléfonos, ni identificadores de usuario).
 *   · `--aplicar`: exige `--respaldo` y, en producción, `--confirmo-produccion <tenant>` (igual a `--tenant`). Guarda el
 *     respaldo, lo relee, y recién entonces da la baja con la precondición de la hora de la ficha leída (si cambió, aborta).
 *     Después relee la ficha y las rutas y comprueba el resultado.
 *   · IDEMPOTENTE: si la ficha ya está `dado_de_baja` con todas sus rutas cortadas y su auditoría, sale con 0 sin escribir.
 *     Si una baja quedó cortada a medias (ficha lista pero faltan rutas o la auditoría), `--aplicar` la COMPLETA sin
 *     reescribir la ficha (se conservan `bajaEn` y `bajaPor`).
 *
 * NO HAY `--revertir`, A PROPÓSITO. La baja revoca sesiones y quita los claims de los miembros, y eso no se reconstruye
 * con un botón: quien tenga que reabrir un comercio lo decide y lo opera aparte (un alta nueva). El respaldo guarda el
 * estado previo (ficha, rutas y, por miembro, su `uid` y su rol) para auditar y para poder reponer a mano, nunca
 * correos ni teléfonos. Pasar `--revertir` es un error de uso.
 *
 * RETENCIÓN. Los datos se retienen 12 meses: este script NO BORRA ningún documento (ni la ficha, ni las conversaciones,
 * ni los miembros). El borrado real es un procedimiento aparte, deliberado y con plazo.
 *
 * MINICRM. El gancho de la callable revoca a los editores de la hoja con Drive (`revocarEditoresAlCerrarTenant`), que
 * necesita la identidad de servicio de las Functions y no se puede armar desde aquí. Este script NO lo corre: lo cierra
 * la RECONCILIACIÓN programada de `editoresCrm.ts`, que revoca a todo editor `activo` de un negocio `dado_de_baja` en su
 * siguiente pasada (red de seguridad declarada). El seco dice cuántos editores hay vigentes; si hay alguno, se avisa.
 *
 * SALVAGUARDA DE PROYECTO. Lista blanca por `GCP_PROJECT_ID_STAGING` y `GCP_PROJECT_ID_PROD`; contra PRODUCCIÓN,
 * `--aplicar` exige `--confirmo-produccion <tenant>`. Contra el emulador (`demo-*`) exige `FIRESTORE_EMULATOR_HOST`
 * local. El id de un proyecto real NUNCA se imprime. Un comercio EXCLUIDO (Bellido o `NOVUCHAT_TENANTS_EXCLUIDOS`) no se
 * toca sin una orden expresa de Andres.
 *
 * SALIDA. 0: seco sin diferencias (ya dado de baja), o baja hecha y comprobada. 1: el seco encontró un comercio por dar
 * de baja (o la ficha no existe). 2: uso o salvaguarda (nada escrito). 3: error de ejecución (solo `e.code ?? e.name`).
 * 130: Ctrl-C.
 *
 * COSTO. Seco: lecturas (ficha, miembros, rutas, editores). `--aplicar`: esas lecturas, una escritura de la ficha, una
 * por ruta, una por miembro (claims) y la auditoría. 0 mensajes por conversación. NO se corre contra producción sin el
 * «sí» de Andres.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ejecutarBajaTenant } from '../../functions/src/plataforma/baja.ts';
import {
  ID_TENANT, comprobarProyecto, comprobarRespaldo, guardarRespaldo, rutaDelRespaldoSigueIgual, leerRespaldoGenerico,
  esTenantExcluido, nombreExcluido,
} from './aplicar-consola-conversaciones.mjs';

const CON_VALOR = ['proyecto', 'tenant', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar'];
export const QUIEN = 'script:baja-comercio';
const ESTADO_BAJA = 'dado_de_baja';

export const USO = '  node scripts/plataforma/baja-comercio.mjs --proyecto <id> --tenant <id> '
  + '[--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]';

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
    if (nombre === 'revertir') {
      problemas.push('la baja no se deshace con un botón: no existe --revertir (reabrir un comercio es un alta nueva, decidida aparte)');
    } else if (BANDERAS.includes(nombre)) {
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
  const { proyecto, tenant, respaldo } = valores;
  const confirmo = valores['confirmo-produccion'];

  if (proyecto === undefined) problemas.push('falta --proyecto');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto !== undefined && !proy.ok) problemas.push(proy.motivo);

  if (tenant === undefined) problemas.push('falta --tenant');
  else if (tenant.includes(',')) problemas.push('--tenant admite UN solo comercio por corrida (sin comas)');
  else if (!ID_TENANT.test(tenant)) problemas.push('--tenant inválido (minúsculas, dígitos y guiones, de 3 a 60)');
  else if (esTenantExcluido(tenant, env)) {
    problemas.push('este comercio está EXCLUIDO (Bellido o NOVUCHAT_TENANTS_EXCLUIDOS): no se le corre este script sin una orden expresa de Andres');
  }

  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) {
    problemas.push('contra producción, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  }
  if (aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta> (por omisión no hay respaldo)');

  let respaldoReal = null;
  let respaldoResuelto = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: false, permitirExistente: true });
    if (r.ok) { respaldoReal = respaldo; respaldoResuelto = r.real; } else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, aplicar, respaldo: respaldoReal, respaldoResuelto } };
}

// ===========================================================================
// RESPALDO: el estado previo. Sin correos ni teléfonos; sí guarda el `uid` y el rol de cada miembro (identificadores
// seudónimos, necesarios para auditar o reponer a mano) y el id de cada ruta, y por eso va a una carpeta privada
// ===========================================================================
export function contenidoDelRespaldo({ entorno, tenant, ficha, actualizadoEn, rutas, miembros }) {
  return {
    version: 1, campo: 'baja', entorno, tenant, creadoEn: new Date().toISOString(), fichaActualizadaEn: actualizadoEn,
    previo: { estado: typeof ficha.estado === 'string' ? ficha.estado : null, bajaEn: iso(ficha.bajaEn), bajaPor: typeof ficha.bajaPor === 'string' ? ficha.bajaPor : null },
    rutas, miembros,
  };
}

/** Comprueba que el respaldo recién escrito se puede leer de vuelta con la forma esperada. */
export function leerRespaldo(ruta, { entorno, tenant }) {
  const l = leerRespaldoGenerico(ruta, { limite: 256 * 1024 });
  if (!l.ok) return l;
  const r = l.respaldo;
  if (r?.version !== 1 || r.campo !== 'baja' || typeof r.previo !== 'object' || r.previo === null) return { ok: false, motivo: 'el respaldo no tiene la forma esperada' };
  if (r.tenant !== tenant) return { ok: false, motivo: 'el respaldo es de otro comercio' };
  if (r.entorno !== entorno) return { ok: false, motivo: 'el respaldo es de otro entorno (staging, produccion o emulador)' };
  if (!Array.isArray(r.rutas) || !Array.isArray(r.miembros)) return { ok: false, motivo: 'el respaldo no trae las rutas y los miembros' };
  return { ok: true, respaldo: r };
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================
const iso = (t) => (t && typeof t.toDate === 'function' ? t.toDate().toISOString() : null);
const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';

/** Lo que se lee del comercio. Nada personal: estados y cantidades. */
async function leerSituacion(db, tenant) {
  const ref = db.doc(`tenants/${tenant}`);
  const [snap] = await db.getAll(ref, { fieldMask: ['estado', 'nombre', 'bajaEn', 'bajaPor'] });
  if (!snap.exists) return { existe: false };
  const rutas = (await db.collection('rutasWhatsApp').where('tenantId', '==', tenant).get()).docs
    .map((d) => ({ id: d.id, estado: String(d.get('estado') ?? '') }));
  const miembros = (await db.collection(`tenants/${tenant}/miembros`).get()).docs
    .map((d) => ({ uid: d.id, rol: String(d.get('rol') ?? '') }));
  const editores = (await db.collection(`tenants/${tenant}/editoresCrm`).get()).docs
    .filter((d) => ['activo', 'revocado_pendiente'].includes(d.get('estado'))).length;
  const auditada = !(await db.collection(`tenants/${tenant}/auditoria`).where('accion', '==', 'baja_tenant').limit(1).get()).empty;
  return { existe: true, snap, ficha: snap.data() ?? {}, rutas, miembros, editores, auditada };
}

const porEstado = (rutas) => {
  const c = {};
  for (const r of rutas) c[r.estado || '(sin estado)'] = (c[r.estado || '(sin estado)'] ?? 0) + 1;
  return Object.keys(c).length ? Object.entries(c).map(([e, n]) => `${n} ${e}`).join(', ') : 'ninguna';
};

/**
 * Corre la operación ya validada. `deps`: `{ db, Timestamp, quitarRol, auditar, log, marcarEscritura, env }`.
 * Importable para probar la precondición con una base que cambia entre la lectura y la escritura.
 */
export async function ejecutar(cfg, deps) {
  const { db } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const marcar = deps.marcarEscritura ?? (() => {});
  const rotulo = `${cfg.entorno} · tenant ${cfg.tenant}`;

  const s = await leerSituacion(db, cfg.tenant);
  if (!s.existe) { log(`\n  ✗ ${cfg.tenant}: no existe la ficha (${cfg.entorno})\n`); return 1; }
  // Segunda barrera: el NOMBRE de la ficha también puede nombrar a un comercio excluido.
  if (esTenantExcluido(cfg.tenant, deps.env) || nombreExcluido(s.ficha.nombre, deps.env)) {
    log('\n  ✗ Este comercio está EXCLUIDO: no se toca. No se escribió nada.\n');
    return 2;
  }

  log(`\n  ${cfg.aplicar ? 'APLICAR LA BAJA' : 'SECO (solo lecturas)'} · ${rotulo}\n`);
  log(`  estado actual       : ${typeof s.ficha.estado === 'string' ? s.ficha.estado : '(sin estado)'}`);
  log(`  miembros            : ${s.miembros.length} (se les quita el rol y se revocan sus sesiones)`);
  log(`  rutas de WhatsApp   : ${s.rutas.length} (${porEstado(s.rutas)})`);
  log(`  editores del miniCRM: ${s.editores} vigentes o pendientes (los revoca la reconciliación programada, no este script)`);
  log('  se conservan todos los datos 12 meses: este script no borra ningún documento');

  // Una baja cortada a medias (la ficha ya dice `dado_de_baja` pero faltan rutas o la auditoría) se COMPLETA: los pasos
  // siguientes son idempotentes y la ficha no se reescribe (se conservan `bajaEn` y `bajaPor`).
  const yaDeBaja = s.ficha.estado === ESTADO_BAJA;
  const incompleta = yaDeBaja && (!s.rutas.every((r) => r.estado === ESTADO_BAJA) || !s.auditada);
  if (yaDeBaja && !incompleta) { log('\n  ✓ El comercio ya está dado de baja (ficha, rutas y auditoría): nada que hacer.\n'); return 0; }
  if (incompleta) log('  ! La baja quedó INCOMPLETA (faltan rutas por cortar o la auditoría): --aplicar la completa sin reescribir la ficha.');
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (y --respaldo) para dar de baja. La baja no se deshace con un botón.\n'); return 1; }

  try {
    guardarRespaldo(cfg.respaldo, contenidoDelRespaldo({
      entorno: cfg.entorno, tenant: cfg.tenant, ficha: s.ficha, actualizadoEn: iso(s.snap.updateTime), rutas: s.rutas, miembros: s.miembros,
    }));
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa; elija otro nombre. No se escribe nada.\n'); return 2; }
    throw e;
  }
  marcar('respaldo');
  const comprobado = (deps.leerRespaldo ?? leerRespaldo)(cfg.respaldo, cfg);
  if (!comprobado.ok) {
    log(`\n  ✗ El respaldo recién guardado no se puede releer (${comprobado.motivo}). No se escribe nada; para repetir use OTRA ruta de --respaldo.\n`);
    return 2;
  }
  if (!rutaDelRespaldoSigueIgual(cfg, deps.comprobarRespaldo)) {
    log('\n  ✗ La ruta del respaldo cambió durante la corrida. No se escribe nada.\n');
    return 2;
  }
  log(`\n  Respaldo guardado y releído: ${cfg.respaldo}`);

  marcar('escribiendo');
  try {
    await ejecutarBajaTenant(
      { db, ahora: () => deps.Timestamp.now(), quitarRol: deps.quitarRol, auditar: deps.auditar },
      cfg.tenant, QUIEN, yaDeBaja ? { soloCompletar: true } : { ultimaActualizacion: s.snap.updateTime },
    );
    marcar('escrito');
  } catch (e) {
    if (esPrecondicion(e)) { marcar('respaldo'); log('\n  ✗ La ficha cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr el seco y repita con OTRA ruta de --respaldo.\n'); return 3; }
    throw e;
  }

  const despues = await leerSituacion(db, cfg.tenant);
  const fichaBien = despues.existe && despues.ficha.estado === ESTADO_BAJA;
  const rutasBien = despues.rutas.every((r) => r.estado === ESTADO_BAJA);
  const miembrosBien = despues.miembros.length === s.miembros.length; // nada se borra
  if (!fichaBien || !rutasBien || !miembrosBien) {
    log('\n  ✗ La relectura no coincide con lo esperado. Revise el comercio con el seco; el respaldo guarda el estado previo.\n');
    return 3;
  }
  log(`\n  ✓ Dado de baja y releído: ficha «${ESTADO_BAJA}», ${despues.rutas.length} ruta(s) cortada(s), ${s.miembros.length} miembro(s) con el rol quitado (según la llamada a asignarRol).`);
  if (s.editores > 0) log('  Pendiente por diseño: los editores del miniCRM los revoca la reconciliación programada en su próxima pasada.');
  log('  La baja no se deshace con un botón; los datos quedan retenidos 12 meses.\n');
  return 0;
}

/** En qué punto está la corrida: 'antes', 'respaldo' (guardado, nada escrito), 'escribiendo', 'escrito'. */
const corrida = { estado: 'antes' };

export function mensajeDeInterrupcion(estado, causa = 'Interrumpido por el operador') {
  if (estado === 'antes') return `\n  ! ${causa} antes de escribir. No se guardó respaldo ni se escribió nada.\n`;
  if (estado === 'respaldo') {
    return `\n  ! ${causa} con el respaldo YA guardado y nada escrito. Para repetir use OTRA ruta de --respaldo (la anterior ya existe y no se pisa).\n`;
  }
  if (estado === 'escrito') {
    return `\n  ! ${causa} DESPUÉS de escribir: la baja SÍ se hizo y la relectura no se completó. Corra el seco para verificar el comercio.\n`;
  }
  return `\n  ! ${causa} DURANTE la baja: pudo haberse hecho en parte (la ficha, las rutas o los roles). Corra el seco para ver en qué quedó; `
    + 'el seco dice qué falta y repetir --aplicar (con otro respaldo) completa la baja sin reescribir la ficha.\n';
}

async function principal() {
  const analisis = analizarArgumentos(process.argv.slice(2));
  if (!analisis.ok) {
    console.error(`\n  ✗ ${analisis.problemas.join('\n  ✗ ')}\n\n${USO}\n`);
    process.exit(2);
  }
  const { cfg } = analisis;
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  // Las mismas piezas que usa la callable: `asignarRol` (claims) y `auditar` (la auditoría del comercio).
  const { asignarRol } = await import('../../functions/src/core/seguridad/claims.ts');
  const { auditar } = await import('../../functions/src/central/comunes.ts');
  process.on('SIGINT', () => {
    console.error(mensajeDeInterrupcion(corrida.estado));
    process.exit(130);
  });
  const codigo = await ejecutar(cfg, {
    db, Timestamp, env: process.env,
    // Un miembro cuyo usuario de Auth ya no existe no tiene nada que quitar: no detiene al resto.
    quitarRol: (uid, tenantId) => asignarRol(uid, tenantId, null, { revocarSesiones: true }).catch((e) => {
      if (e?.code !== 'auth/user-not-found') throw e;
    }),
    auditar,
    marcarEscritura: (v) => { corrida.estado = v; },
  });
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
    if (corrida.estado !== 'antes') console.error(mensajeDeInterrupcion(corrida.estado, 'Falló con un error'));
    process.exit(3);
  }
}
