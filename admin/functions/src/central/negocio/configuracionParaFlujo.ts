// ZONA CENTRAL: vista previa de lo que ve el asistente. Salió de `index.ts`
// sin cambiar lógica (F2, P1); `index.ts` la reexporta.
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { claimsDe as claims } from '../../core/seguridad/autorizacion.js';
import { ID_TENANT, db, texto } from '../comunes.js';

// ---------------------------------------------------------------------------
// VISTA PREVIA DE LO QUE VE EL ASISTENTE.
//
// n8n NO llama a esta función: usa `configuracionFlujo` (en ingesta.ts), que se
// autentica con HMAC y resuelve el comercio por `phone_number_id`. Ésta es para
// el PANEL: le muestra al comercio, con su sesión de usuario, exactamente qué
// datos recibe su asistente. Sirve para que el dueño entienda por qué el
// asistente contestó lo que contestó, sin tener que abrir n8n.
//
// La respuesta viene con los campos SEPARADOS y rotulados. `instruccionesExtra`
// se entrega en su propia clave para que el flujo la inserte en una sección
// delimitada del prompt, marcada como dato del negocio. Nunca concatenada por
// delante de las reglas de comportamiento del agente.
// ---------------------------------------------------------------------------
export const configuracionParaFlujo = onCall(async (peticion) => {
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  const c = claims(peticion);
  if (!c.t[tenantId] && !c.p) throw new HttpsError('permission-denied', 'Sin acceso.');

  const [tenant, config, catalogo] = await Promise.all([
    db().doc(`tenants/${tenantId}`).get(),
    db().doc(`tenants/${tenantId}/config/negocio`).get(),
    db().collection(`tenants/${tenantId}/catalogo`).where('activo', '==', true).limit(200).get(),
  ]);
  if (tenant.get('estado') !== 'activo') throw new HttpsError('failed-precondition', 'Negocio inactivo.');

  return {
    negocio: config.data() ?? {},
    catalogo: catalogo.docs.map((d) => ({ id: d.id, ...d.data() })),
    generadoEn: FieldValue.serverTimestamp(),
  };
});
