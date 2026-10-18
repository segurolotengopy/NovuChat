// ZONA CENTRAL: los usuarios del negocio (quitar; invitar está en invitaciones.ts). Salieron de
// `index.ts` sin cambiar lógica (F2, P1); `index.ts` los reexporta.
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { asignarRol } from '../core/seguridad/claims.js';
import { exigirAdminDe } from '../core/seguridad/autorizacion.js';
import { ID_TENANT, auditar, db, texto } from './comunes.js';
import { decidirSobreTitular, titularDe } from './titular.js';

// ---------------------------------------------------------------------------
// USUARIOS DEL NEGOCIO
// ---------------------------------------------------------------------------
// `invitarUsuario` vive en `invitaciones.ts` (I1): ya no pone el rol, deja una invitación que la
// persona acepta. Se reexporta acá para que `index.ts` no cambie.
export { invitarUsuario } from './invitaciones.js';

export const quitarUsuario = onCall(async (peticion) => {
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  const uid = exigirAdminDe(peticion, tenantId);
  const destino = texto(datos['uid'], 128);
  if (!destino) throw new HttpsError('invalid-argument', 'Falta el usuario.');
  // La forma de un uid de Firebase Auth: sin barras ni nada que cambie la ruta del documento.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(destino)) throw new HttpsError('invalid-argument', 'Usuario inválido.');

  // Solo se quita a un MIEMBRO de este negocio. Sin esta comprobación, un administrador de A
  // que conociera el uid de alguien de B (o del propietario) le revocaba todas las sesiones
  // y le subía la versión de sus claims: una empresa tocaba a un usuario de otra. La ficha
  // se borra con precondición de existencia (atómica) antes de revocar nada, y se audita
  // solo después.
  // El titular de la cuenta no se quita (ni lo hace él mismo): se decide ANTES de borrar la
  // ficha, revocar o auditar nada.
  const motivo = decidirSobreTitular({ accion: 'quitar', destino, titular: await titularDe(tenantId) });
  if (motivo) throw new HttpsError('failed-precondition', motivo);
  const fichaMiembro = db().doc(`tenants/${tenantId}/miembros/${destino}`);
  try {
    await fichaMiembro.delete({ exists: true });
  } catch (e) {
    // NOT_FOUND de Firestore (código gRPC 5): la ficha no existía.
    if ((e as { code?: unknown }).code === 5) {
      throw new HttpsError('not-found', 'Ese usuario no es miembro del negocio.');
    }
    throw e;
  }
  // Revocación inmediata: sin esto el usuario retirado sigue leyendo hasta una
  // hora, que es lo que dura su ID token.
  await asignarRol(destino, tenantId, null, { revocarSesiones: true });
  await auditar(tenantId, 'quitar_usuario', uid, { destino });
  return { ok: true };
});
