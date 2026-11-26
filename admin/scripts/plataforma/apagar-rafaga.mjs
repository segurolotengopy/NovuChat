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
 * Sin `--aplicar` NO escribe: dice «pondría…». Contra un proyecto que no es `demo-*` (emulador), `--aplicar`
 * exige `--confirmo-produccion <tenant>` igual a `--tenant`.
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
const ID_PROYECTO = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const CON_VALOR = ['proyecto', 'tenant', 'confirmo-produccion'];
const BANDERAS = ['apagar', 'encender', 'aplicar'];

export function analizar(argv) {
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
  if (proyecto === undefined) problemas.push('falta --proyecto');
  else if (!proyecto.startsWith('demo-') && !ID_PROYECTO.test(proyecto)) problemas.push('--proyecto inválido');
  const real = proyecto !== undefined && !proyecto.startsWith('demo-');
  if (tenant === undefined) problemas.push('falta --tenant');
  else if (tenant.includes(',')) problemas.push('--tenant admite UN solo comercio por corrida');
  else if (!ID_TENANT.test(tenant)) problemas.push('--tenant inválido (minúsculas, dígitos y guiones, de 3 a 60)');
  if (confirmo !== undefined && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  if (real && aplicar && confirmo === undefined) {
    problemas.push('contra un proyecto real, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, tenant, apagar, aplicar, real } };
}

export const USO = '  node scripts/plataforma/apagar-rafaga.mjs --proyecto <id> --tenant <id> --apagar|--encender '
  + '[--aplicar] [--confirmo-produccion <tenant>]';

/** `deps`: `{ db, FieldValue, log }`. Devuelve el código de salida. */
export async function ejecutar(cfg, deps) {
  const { db, FieldValue } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const ref = db.doc(`tenants/${cfg.tenant}`);
  const accion = cfg.apagar ? 'apagar' : 'encender';
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SIMULACRO'} · ${cfg.real ? 'proyecto real' : 'emulador'} · comercio ${cfg.tenant} · ${accion}\n`);
  let resultado;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) { resultado = { codigo: 1, texto: `  ✗ No existe el comercio «${cfg.tenant}».\n` }; return; }
    const d = snap.data() ?? {};
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
      accion: 'cambiar_rafaga', uid: 'apagar-rafaga', en: new Date(),
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
