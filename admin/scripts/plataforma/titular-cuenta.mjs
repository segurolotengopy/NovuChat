/**
 * EL TITULAR DE LA CUENTA: la lógica, separada de la línea de comandos para poder probarla.
 *
 * «Titular de la cuenta» NO es «titularidad» (esa es del número de WhatsApp). Es la persona
 * que NovuChat reconoce como dueña de la cuenta del comercio. Decisión de Andres (17/10/2026):
 * un administrador no puede quitar al titular; solo NovuChat lo cambia, con `fijar-titular.mjs`.
 *
 * Vive en la ficha `tenants/{t}`: `titularCuentaUid`, `titularCuentaEn`, `titularCuentaPor`.
 * La escribe solo el SDK Admin (las reglas no dejan al navegador tocar la ficha).
 * Invariante: si hay titular, es miembro con rol admin y estado activo.
 *
 * `db` y `auth` se reciben de afuera: el script les pasa los del SDK Admin y las pruebas, el
 * emulador de Firestore y un Auth de mentira (el Auth de los hijos de prueba está apagado a propósito).
 */
import { Timestamp } from 'firebase-admin/firestore';

export const MOTIVO_TITULAR = 'primero cambie el titular con fijar-titular.mjs';

/** ¿Puede esta persona ser titular de este comercio? Devuelve el motivo si no. */
export async function motivoSiNoPuedeSerTitular({ db, auth, tenant, uid }) {
  const miembro = await db.doc(`tenants/${tenant}/miembros/${uid}`).get();
  if (!miembro.exists) return 'no es miembro de este comercio';
  if (miembro.get('estado') !== 'activo') return `su membresía no está activa (estado ${miembro.get('estado') ?? '?'})`;
  if (miembro.get('rol') !== 'admin') return `su rol en la ficha no es admin (es ${miembro.get('rol') ?? '?'})`;
  const usuario = await auth.getUser(uid).catch(() => null);
  if (!usuario) return 'no existe esa cuenta en Auth';
  const rol = ((usuario.customClaims ?? {}).nc ?? {}).t?.[tenant];
  if (rol !== 'admin') return `su claim en este comercio no es admin (es ${rol ?? 'ninguno'})`;
  return null;
}

/** Los administradores activos de un comercio (ficha y claim coinciden). Solo lee. */
export async function adminsActivos({ db, auth, tenant }) {
  const snap = await db.collection(`tenants/${tenant}/miembros`).where('estado', '==', 'activo').get();
  const lista = [];
  for (const d of snap.docs) {
    if (d.get('rol') !== 'admin') continue;
    const usuario = await auth.getUser(d.id).catch(() => null);
    const rol = ((usuario?.customClaims ?? {}).nc ?? {}).t?.[tenant];
    lista.push({ uid: d.id, claimAdmin: rol === 'admin' });
  }
  return lista;
}

/**
 * Fija (o con `uid: null`, quita) el titular. Una transacción: la ficha y la auditoría
 * `fijar_titular` con el anterior y el nuevo. Con `aplicar: false` solo dice qué haría.
 * Devuelve { ok, motivo?, anterior, nuevo, aplicado }.
 */
export async function fijarTitular({ db, auth, tenant, uid, operador, aplicar }) {
  const ref = db.doc(`tenants/${tenant}`);
  const ficha = await ref.get();
  if (!ficha.exists) return { ok: false, motivo: `el comercio «${tenant}» no existe` };
  const anterior = ficha.get('titularCuentaUid') ?? null;
  if (uid) {
    const motivo = await motivoSiNoPuedeSerTitular({ db, auth, tenant, uid });
    if (motivo) return { ok: false, motivo, anterior };
  } else if (!anterior) {
    return { ok: false, motivo: 'la cuenta ya no tiene titular', anterior };
  }
  if (!aplicar) return { ok: true, aplicado: false, anterior, nuevo: uid ?? null };

  const ahora = Timestamp.now();
  await db.runTransaction(async (tx) => {
    const f = await tx.get(ref);
    if ((f.get('titularCuentaUid') ?? null) !== anterior) throw new Error('el titular cambió mientras tanto; repita');
    if (uid) {
      const m = await tx.get(db.doc(`tenants/${tenant}/miembros/${uid}`));
      if (!m.exists || m.get('estado') !== 'activo' || m.get('rol') !== 'admin') {
        throw new Error('la membresía cambió mientras tanto; repita');
      }
    }
    // Solo estos tres campos; el resto de la ficha no se toca.
    tx.update(ref, { titularCuentaUid: uid ?? null, titularCuentaEn: ahora, titularCuentaPor: 'fijar-titular' });
    tx.create(db.collection(`tenants/${tenant}/auditoria`).doc(), {
      accion: 'fijar_titular', uid: operador, origen: 'script', script: 'fijar-titular', en: ahora,
      antes: { titularCuentaUid: anterior }, despues: { titularCuentaUid: uid ?? null },
    });
  });
  const relectura = (await ref.get()).get('titularCuentaUid') ?? null;
  if (relectura !== (uid ?? null)) return { ok: false, motivo: 'la relectura no coincide con lo escrito', anterior, nuevo: relectura };
  return { ok: true, aplicado: true, anterior, nuevo: relectura };
}

/**
 * Para `asignar-rol.mjs`: ¿esta acción dejaría al titular sin su rol de admin?
 * `accion` es 'quitar' o 'oper'. Se busca a la persona por su correo en las fichas de
 * `miembros` (sirve también en seco, sin Auth) y por el uid de Auth si ya se conoce.
 * Devuelve el motivo del rechazo, o null.
 */
export async function rechazoPorTitular({ db, tenant, correo, uidAuth, accion }) {
  const ficha = await db.doc(`tenants/${tenant}`).get();
  const titular = ficha.get('titularCuentaUid') ?? null;
  if (!titular) return null;
  const uids = new Set(uidAuth ? [uidAuth] : []);
  const porCorreo = await db.collection(`tenants/${tenant}/miembros`).where('correo', '==', correo).get();
  for (const d of porCorreo.docs) uids.add(d.id);
  if (!uids.has(titular)) return null;
  const que = accion === 'quitar' ? 'quitar el acceso al' : 'dejar como operador al';
  return `no se puede ${que} titular de la cuenta: ${MOTIVO_TITULAR}`;
}
