// ZONA CENTRAL: los usuarios del negocio (invitar y quitar). Salieron de
// `index.ts` sin cambiar lógica (F2, P1); `index.ts` los reexporta.
import { Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { asignarRol } from '../core/seguridad/claims.js';
import { exigirAdminDe } from '../core/seguridad/autorizacion.js';
import { ID_TENANT, auditar, db, texto } from './comunes.js';

// ---------------------------------------------------------------------------
// USUARIOS DEL NEGOCIO
// ---------------------------------------------------------------------------
export const invitarUsuario = onCall(async (peticion) => {
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  const uid = exigirAdminDe(peticion, tenantId);

  const correo = texto(datos['correo'], 254).toLowerCase();
  const rol = datos['rol'] === 'admin' ? 'admin' : 'oper';
  // Un administrador de negocio NO puede crear roles de plataforma ni de
  // servicio: la lista de roles asignables está cerrada acá arriba.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
    throw new HttpsError('invalid-argument', 'Correo inválido.');
  }

  const destino = await getAuth().getUserByEmail(correo).catch(() => null);
  if (!destino) throw new HttpsError('failed-precondition', 'La persona debe ingresar una vez primero.');

  // El panel exige `email_verified` en las reglas, así que un administrador de
  // comercio sin verificar no ve nada aunque tenga el claim. Se avisa acá para
  // que quien invita entienda por qué la persona "entra pero no ve".
  const verificado = destino.emailVerified;

  await db().doc(`tenants/${tenantId}/miembros/${destino.uid}`).set({
    correo, rol, estado: verificado ? 'activo' : 'pendiente_verificacion',
    desde: Timestamp.now(), invitadoPor: uid,
  });
  // `asignarRol` rechaza la asignación si la cuenta no es de contraseña pura.
  await asignarRol(destino.uid, tenantId, rol);
  await auditar(tenantId, 'invitar_usuario', uid, { destino: destino.uid, rol, verificado });
  return { ok: true, verificado };
});

export const quitarUsuario = onCall(async (peticion) => {
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  const uid = exigirAdminDe(peticion, tenantId);
  const destino = texto(datos['uid'], 128);
  if (!destino) throw new HttpsError('invalid-argument', 'Falta el usuario.');

  await db().doc(`tenants/${tenantId}/miembros/${destino}`).delete();
  // Revocación inmediata: sin esto el usuario retirado sigue leyendo hasta una
  // hora, que es lo que dura su ID token.
  await asignarRol(destino, tenantId, null, { revocarSesiones: true });
  await auditar(tenantId, 'quitar_usuario', uid, { destino });
  return { ok: true };
});
