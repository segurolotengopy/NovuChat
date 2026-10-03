// ZONA CENTRAL: NovuChat mueve el estado de un reclamo. Salió de `index.ts`
// sin cambiar lógica (F2, P1); `index.ts` lo reexporta.
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { exigirPropietario } from '../../core/seguridad/autorizacion.js';
import { ID_TENANT, auditar, db, texto } from '../comunes.js';

// ---------------------------------------------------------------------------
// RECLAMOS. El comercio los crea escribiendo Firestore (las reglas validan el
// esquema); NovuChat los mueve de estado por acá, porque el documento es
// inmutable para los clientes. Ver `reclamos.ts` para el envío del correo.
// ---------------------------------------------------------------------------
const ESTADOS_RECLAMO = new Set(['nuevo', 'en_curso', 'resuelto']);

export const moverReclamo = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  const reclamoId = texto(datos['reclamoId'], 128);
  const estado = texto(datos['estado'], 20);
  if (!ID_TENANT.test(tenantId) || !reclamoId) {
    throw new HttpsError('invalid-argument', 'Identificador inválido.');
  }
  if (!ESTADOS_RECLAMO.has(estado)) throw new HttpsError('invalid-argument', 'Estado inválido.');

  await db().doc(`tenants/${tenantId}/reclamos/${reclamoId}`).update({
    estado, movidoPor: uid, movidoEn: Timestamp.now(),
  });
  await auditar(tenantId, 'mover_reclamo', uid, { reclamoId, estado });
  return { ok: true };
});
