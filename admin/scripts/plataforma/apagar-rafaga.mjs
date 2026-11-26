/**
 * =============================================================================
 * APAGAR O ENCENDER LA RÁFAGA DE UN COMERCIO (`tenants/{id}.rafagaApagada`)
 * =============================================================================
 *
 * POR QUÉ EXISTE. El servidor lee `rafagaApagada === true` de la ficha del comercio y lo agrega a la respuesta
 * de `configuracionFlujo`; con eso la pieza de ráfagas (core, `docs/arquitectura/rafagas.md`) deja de agrupar y
 * cada texto se responde solo, SIN republicar el flujo. Ningún cliente puede escribir ese campo
 * (`firestore.rules`: la ficha del tenant es de solo lectura para clientes); este script, con el SDK Admin, es
 * el camino.
 *
 *   --apagar    escribe `rafagaApagada: true` (el valor exacto).
 *   --encender  BORRA el campo (FieldValue.delete()); nunca lo pone en false.
 *
 * Un comercio por corrida (sin modo «todos»). Idempotente: si ya está así, no escribe. No toca ningún otro campo.
 * Deja auditoría `cambiar_rafaga` en `tenants/{id}/auditoria` (accion, uid del script, hora, antes y después).
 *
 *   node scripts/plataforma/apagar-rafaga.mjs --proyecto <id> --tenant <id> --apagar|--encender
 *        [--aplicar] [--confirmo-produccion <tenant>]
 *
 * Sin `--aplicar` NO escribe: dice «pondría…». SALVAGUARDA DE PROYECTO (la de `aplicar-modulos-tenant.mjs`):
 * un `demo-*` solo contra el emulador (FIRESTORE_EMULATOR_HOST local); un proyecto real solo si es el de
 * `GCP_PROJECT_ID_STAGING` o `GCP_PROJECT_ID_PROD` y sin variables de emulador sobrantes. Contra staging o
 * producción, `--aplicar` exige `--confirmo-produccion <tenant>` igual a `--tenant`; contra el emulador esa
 * opción se rechaza. Solo se toca un comercio `activo` o `suspendido`. El id de un proyecto real nunca se imprime.
 *
 * SALIDA. 0: hecho, o ya estaba así, o simulacro. 1: el comercio no existe o falló la escritura. 2: uso.
 *
 * COSTO. Una lectura y, con `--aplicar` y cambio real, una escritura de un campo y una de auditoría.
 * 0 mensajes por conversación. No imprime datos personales ni credenciales.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CAMPO = 'rafagaApagada';
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const ID_PROYECTO_REAL = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const ID_PROYECTO_DEMO = /^demo-[a-z0-9-]{1,40}$/;
const CON_VALOR = ['proyecto', 'tenant', 'confirmo-produccion'];
const BANDERAS = ['apagar', 'encender', 'aplicar'];
const ESTADOS_PERMITIDOS = ['activo', 'suspendido'];

const HOST_LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):[0-9]{1,5}$/;
const VARIABLES_DE_EMULADOR = [
  'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST',
  'STORAGE_EMULATOR_HOST', 'FIREBASE_EMULATOR_HUB',
];

/** Misma lista blanca que `aplicar-modulos-tenant.mjs`. Devuelve `{ ok, entorno }` (`emulador`, `staging`, `produccion`). */
export function comprobarProyecto(proyecto, env = process.env) {
  if (typeof proyecto !== 'string' || proyecto === '') return { ok: false, motivo: 'falta --proyecto' };
  const v = (k) => (typeof env[k] === 'string' ? env[k].trim() : '');
  const hayEmulador = VARIABLES_DE_EMULADOR.some((k) => env[k] !== undefined);
  if (proyecto.startsWith('demo-')) {
    if (!ID_PROYECTO_DEMO.test(proyecto)) return { ok: false, motivo: 'el id del proyecto demo no tiene la forma exacta (minúsculas, sin espacios)' };
    if (!HOST_LOCAL.test(v('FIRESTORE_EMULATOR_HOST'))) {
      return { ok: false, motivo: 'un proyecto demo-* solo se usa contra el emulador: falta FIRESTORE_EMULATOR_HOST (127.0.0.1, localhost o [::1] con puerto)' };
    }
    return { ok: true, entorno: 'emulador' };
  }
  if (!ID_PROYECTO_REAL.test(proyecto)) return { ok: false, motivo: 'el id del proyecto no tiene la forma exacta (minúsculas, dígitos y guiones, sin espacios)' };
  if (hayEmulador) return { ok: false, motivo: 'hay variables de emulador puestas y el proyecto no es demo-*: se rechaza por ambiguo' };
  const staging = v('GCP_PROJECT_ID_STAGING');
  const prod = v('GCP_PROJECT_ID_PROD');
  if (!staging) return { ok: false, motivo: 'falta GCP_PROJECT_ID_STAGING: la lista blanca de proyectos está incompleta' };
  if (!prod) return { ok: false, motivo: 'falta GCP_PROJECT_ID_PROD: la lista blanca de proyectos está incompleta' };
  if (!ID_PROYECTO_REAL.test(staging) || !ID_PROYECTO_REAL.test(prod)) {
    return { ok: false, motivo: 'GCP_PROJECT_ID_STAGING o GCP_PROJECT_ID_PROD no tienen la forma de un id de proyecto' };
  }
  if (staging === prod) return { ok: false, motivo: 'GCP_PROJECT_ID_STAGING y GCP_PROJECT_ID_PROD son iguales: no se sabe cuál es cuál' };
  if (proyecto === prod) return { ok: true, entorno: 'produccion' };
  if (proyecto === staging) return { ok: true, entorno: 'staging' };
  return { ok: false, motivo: 'el proyecto no es ninguno de la lista blanca (GCP_PROJECT_ID_STAGING, GCP_PROJECT_ID_PROD)' };
}

export function analizar(argv, env = process.env) {
  const problemas = [];
  const v = { __proto__: null };
  const b = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string' || !a.startsWith('--')) { problemas.push('argumento suelto'); continue; }
    const n = a.slice(2);
    if (BANDERAS.includes(n)) {
      if (b.includes(n)) problemas.push(`opción repetida: --${n}`);
      b.push(n);
    } else if (CON_VALOR.includes(n)) {
      if (n in v) problemas.push(`opción repetida: --${n}`);
      const x = argv[i + 1];
      if (x === undefined || x.startsWith('--')) { problemas.push(`--${n} sin valor`); continue; }
      v[n] = x;
      i += 1;
    } else problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40)}`);
  }
  const apagar = b.includes('apagar');
  const encender = b.includes('encender');
  const aplicar = b.includes('aplicar');
  const { proyecto, tenant } = v;
  const confirmo = v['confirmo-produccion'];
  if (apagar === encender) problemas.push('pida exactamente una: --apagar o --encender');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto === undefined) problemas.push('falta --proyecto');
  else if (!proy.ok) problemas.push(proy.motivo);
  if (tenant === undefined) problemas.push('falta --tenant');
  else if (tenant.includes(',')) problemas.push('--tenant admite UN solo comercio por corrida');
  else if (!ID_TENANT.test(tenant)) problemas.push('--tenant inválido (minúsculas, dígitos y guiones, de 3 a 60)');
  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno === 'emulador') problemas.push('--confirmo-produccion no se usa contra el emulador');
    else if (confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  } else if (proy.ok && proy.entorno !== 'emulador' && aplicar) {
    problemas.push('contra staging o producción, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, tenant, apagar, aplicar, entorno: proy.entorno } };
}

export const USO = '  node scripts/plataforma/apagar-rafaga.mjs --proyecto <id> --tenant <id> --apagar|--encender '
  + '[--aplicar] [--confirmo-produccion <tenant>]';

/** `deps`: `{ db, FieldValue, log }`. Devuelve el código de salida. */
export async function ejecutar(cfg, deps) {
  const { db, FieldValue } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const ref = db.doc(`tenants/${cfg.tenant}`);
  const accion = cfg.apagar ? 'apagar' : 'encender';
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SIMULACRO'} · ${cfg.entorno} · comercio ${cfg.tenant} · ${accion}\n`);
  let resultado;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) { resultado = { codigo: 1, texto: `  ✗ No existe el comercio «${cfg.tenant}».\n` }; return; }
    const d = snap.data() ?? {};
    if (!ESTADOS_PERMITIDOS.includes(d['estado'])) {
      resultado = { codigo: 1, texto: `  ✗ «${cfg.tenant}» no está activo ni suspendido (dado de baja o estado desconocido): no se le toca la ráfaga.\n` };
      return;
    }
    const hay = Object.prototype.hasOwnProperty.call(d, CAMPO);
    const hoy = hay ? d[CAMPO] : null;
    const yaEsta = cfg.apagar ? hoy === true : !hay;
    if (yaEsta) { resultado = { codigo: 0, texto: `  ✓ Nada que hacer: ${CAMPO} ya está ${cfg.apagar ? 'en true' : 'ausente'}.\n` }; return; }
    if (!cfg.aplicar) {
      resultado = { codigo: 0, texto: cfg.apagar
        ? `  pondría ${CAMPO}: true en tenants/${cfg.tenant}. No se escribió nada; agregue --aplicar.\n`
        : `  quitaría el campo ${CAMPO} de tenants/${cfg.tenant}. No se escribió nada; agregue --aplicar.\n` };
      return;
    }
    tx.update(ref, { [CAMPO]: cfg.apagar ? true : FieldValue.delete() });
    tx.create(db.collection(`tenants/${cfg.tenant}/auditoria`).doc(), {
      accion: 'cambiar_rafaga', uid: 'apagar-rafaga', en: FieldValue.serverTimestamp(),
      antes: hay ? hoy : null, despues: cfg.apagar ? true : null,
    });
    resultado = { codigo: 0, texto: cfg.apagar ? `  ✓ ${CAMPO} quedó en true.\n` : `  ✓ ${CAMPO} se quitó (la ráfaga vuelve a regir).\n` };
  });
  log(resultado.texto);
  return resultado.codigo;
}

async function principal() {
  const r = analizar(process.argv.slice(2));
  if (!r.ok) {
    console.error(`\n  ✗ ${r.problemas.join('\n  ✗ ')}\n\n${USO}\n`);
    process.exit(2);
  }
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  initializeApp({ projectId: r.cfg.proyecto });
  const db = getFirestore();
  const codigo = await ejecutar(r.cfg, { db, FieldValue });
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
    process.exit(1);
  }
}
