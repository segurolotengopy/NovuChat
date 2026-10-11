/**
 * =============================================================================
 * CONVERSACIONES: QUIÉN PUEDE BUSCAR EN LAS DE UN COMERCIO (CORE)
 * =============================================================================
 *
 * La búsqueda por palabra usa un `collectionGroup` con el SDK Admin, que se
 * salta `firestore.rules`. Por eso el permiso se vuelve a comprobar acá, a mano.
 * Es el de las reglas para LEER las conversaciones (decisión D13), con UNA
 * diferencia deliberada y MÁS ESTRICTA para el soporte:
 *
 *   - la persona del negocio (administrador u operador de ESE comercio, con
 *     sesión de contraseña y correo verificado: `esAdminDe` / `esOperDe`), o
 *   - el propietario de NovuChat (sesión de Google) mientras el comercio le
 *     conserve una ventana de soporte vigente (`soporteVigenteDe`),
 *
 * y, en TODOS los casos, el comercio está `activo` o `suspendido` (un comercio
 * suspendido SÍ puede ver sus conversaciones; dado de baja o inexistente, no).
 * Las reglas no exigen ese estado al soporte; esta callable sí, a propósito: una
 * búsqueda masiva sobre un comercio dado de baja no tiene dueño que la pida.
 *
 * SIN `cuentaVigenteDe` (D13). El visor de comprobantes la usa porque entrega
 * archivos de dinero; esta callable devuelve fragmentos de conversaciones que
 * la misma persona ya lee en la consola con ese mismo token, y las reglas de
 * Firestore tampoco miran Auth. Dos criterios distintos de «quién lee una
 * conversación» sería peor que un token vivo una hora más.
 *
 * LO QUE ESTE ARCHIVO GARANTIZA, cada línea con una prueba que la niega
 * (`pruebas/core/buscar-conversaciones.test.ts`):
 *
 *  - Autoriza sobre el comercio PEDIDO, nunca sobre «el primero del token».
 *  - La forma del `tenantId` se valida ANTES de armar ninguna ruta o clave
 *    (`__proto__`, `../x`, mayúsculas, vacío, no-texto): quien manda eso recibe
 *    el mismo «sin permiso» que quien no tiene rol; no se le dice cuál fue.
 *  - Un propietario sin ventana, vencida o de otro comercio no lee la ficha.
 *  - Un error de infraestructura (Firestore caído) sale como `unavailable`,
 *    JAMÁS como un permiso: decirle «sin permiso» a quien lo tiene es una
 *    mentira, y dejarlo pasar por una falla abriría la puerta.
 *
 * Core no depende de nada de arriba: la forma del id de comercio se repite acá
 * (es la misma de `ID_TENANT` de la consola de plataforma) en vez de importarla.
 */
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';
import { esAdminDe, esOperDe, esPropietario, exigirAutenticado } from '../seguridad/autorizacion.js';
import { soporteVigenteDe, type RolVerificado } from '../seguridad/vigencia.js';

/** La forma de un id de comercio (la de `ID_TENANT` en `central/comunes.ts`). */
export const ID_COMERCIO = /^[a-z0-9][a-z0-9-]{2,59}$/;

export const MENSAJE_SIN_PERMISO = 'No tiene permiso para buscar en estas conversaciones.';
export const MENSAJE_NO_DISPONIBLE = 'La búsqueda no está disponible en este momento. Intente de nuevo.';

/**
 * Exige que quien llama pueda leer las conversaciones de `tenantId`.
 *
 * @returns su uid y el rol con el que fue autorizado.
 * @throws HttpsError `unauthenticated` (sin sesión), `permission-denied` (sin rol,
 *         comercio mal escrito, no legible) o `unavailable` (falla de Firestore).
 */
export async function exigirLectorDeConversaciones(
  p: CallableRequest, tenantId: unknown, db: Firestore, ahoraMs: number,
): Promise<{ uid: string; rol: RolVerificado }> {
  const uid = exigirAutenticado(p);
  const sinPermiso = () => new HttpsError('permission-denied', MENSAJE_SIN_PERMISO);

  // 1. La forma, antes de cualquier ruta o clave.
  if (typeof tenantId !== 'string' || !ID_COMERCIO.test(tenantId)) throw sinPermiso();

  try {
    // 2. El rol DE ESTE comercio. Ninguna otra pertenencia sirve.
    let rol: RolVerificado;
    if (esAdminDe(p, tenantId)) rol = 'admin';
    else if (esOperDe(p, tenantId)) rol = 'oper';
    else if (esPropietario(p) && await soporteVigenteDe(p, tenantId, ahoraMs)) rol = 'soporte';
    else throw sinPermiso();

    // 3. El comercio: activo o suspendido. Dado de baja o inexistente, no.
    const ficha = await db.doc(`tenants/${tenantId}`).get();
    const estado: unknown = ficha.exists ? ficha.get('estado') : undefined;
    if (estado !== 'activo' && estado !== 'suspendido') throw sinPermiso();

    return { uid, rol };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    // Firestore (o lo que sea) falló: no es una respuesta sobre el permiso.
    throw new HttpsError('unavailable', MENSAJE_NO_DISPONIBLE);
  }
}
