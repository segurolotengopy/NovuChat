/**
 * =============================================================================
 * CONVERSACIONES: QUIÉN PUEDE TOMAR, DEVOLVER Y ESCRIBIR COMO PERSONA (CORE)
 * =============================================================================
 *
 * H2 (contrato único del 16/10/2026, §2). Distinto de `acceso.ts` (leer/buscar) en cuatro cosas,
 * todas a propósito y todas con una prueba que las niega
 * (`pruebas/core/turno-conversacion.test.ts`):
 *
 *  1. SOLO la persona del negocio: el administrador o el operador de ESE comercio, con sesión de
 *     contraseña y correo verificado (`esAdminDe` / `esOperDe`). El soporte de NovuChat NO
 *     (ni con ventana vigente): tomar una conversación es hablar en nombre del comercio con su
 *     cliente, y eso lo hace el comercio. El propietario sin rol en el comercio recibe el mismo
 *     «sin permiso» que cualquiera.
 *  2. El comercio debe estar `activo`. Suspendido, dado de baja o inexistente: no. (Leer es
 *     distinto: un comercio suspendido sí ve sus conversaciones; hablar con sus clientes, no.)
 *  3. SIN `cuentaVigenteDe`, igual que `acceso.ts` y por la misma razón (decisión D13 del plan H1):
 *     el permiso es el de las reglas de Firestore, que tampoco miran Auth, y dos criterios
 *     distintos de «quién atiende una conversación» sería peor que un token vivo una hora más.
 *  4. HABILITACIÓN EN EL SERVIDOR: el comercio debe tener `consolaConversaciones === 'nueva'` y NO
 *     ser Bellido. La bandera es presentación, pero tomar y enviar exigen habilitación; una
 *     llamada a mano con la pantalla clásica no debe poder pausar al asistente. Bellido no se
 *     toca (decisión P1 de Andres, 09/10/2026): se rechaza aunque alguien le hubiera encendido
 *     la bandera.
 *
 * LA LISTA DE EXCLUSIÓN. Es la de `scripts/plataforma/aplicar-consola-conversaciones.mjs`
 * (`TENANTS_EXCLUIDOS`, `esTenantExcluido`, `nombreExcluido`), repetida acá porque Core no puede
 * importar de `scripts/`. Una prueba compara las dos y falla si se separan. Coincide si el id ES
 * un excluido o LO CONTIENE (`bellido`, `consultorio-bellido`, `bellido2`), sin tildes ni
 * mayúsculas: ante la duda se niega. El nombre de la ficha es una segunda barrera por si el id
 * no fuera el esperado. La variable `NOVUCHAT_TENANTS_EXCLUIDOS` del script NO se lee acá: una
 * variable de entorno nueva exige tocar el `.env` exacto del CI de producción, y la lista fija
 * ya cubre a Bellido.
 *
 * Errores: de infraestructura (Firestore caído) = `unavailable`, JAMÁS un permiso: decirle «sin
 * permiso» a quien lo tiene es una mentira, y dejar pasar por una falla abriría la puerta.
 */
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { esAdminDe, esOperDe, exigirAutenticado } from '../seguridad/autorizacion.js';
import { ID_COMERCIO } from './acceso.js';
import { ErroresDeTurno } from './turno.js';

/** El rol con el que una persona del negocio fue autorizada. */
export type RolDePersona = 'admin' | 'oper';

/** Los comercios a los que NUNCA se les habilita esto (espejo de `TENANTS_EXCLUIDOS` del script de plataforma). */
export const TENANTS_EXCLUIDOS: readonly string[] = Object.freeze(['bellido']);

const sinTildes = (s: string): string => s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();

/** ¿El id es de un comercio excluido, o lo contiene? Ante la duda, sí. */
export function esTenantExcluido(tenantId: unknown, excluidos: readonly string[] = TENANTS_EXCLUIDOS): boolean {
  if (typeof tenantId !== 'string') return false;
  const t = sinTildes(tenantId);
  return excluidos.some((x) => t === x || t.includes(x));
}

/** ¿El NOMBRE de la ficha nombra a un comercio excluido? Segunda barrera. */
export function nombreExcluido(nombre: unknown, excluidos: readonly string[] = TENANTS_EXCLUIDOS): boolean {
  if (typeof nombre !== 'string') return false;
  const n = sinTildes(nombre);
  return excluidos.some((x) => n.includes(x));
}

/**
 * ¿Está el comercio habilitado para que una persona tome y escriba? Con `consolaConversaciones`
 * EXACTAMENTE `'nueva'` (ausente, desconocida o de otro tipo = no) y sin ser un comercio excluido.
 */
export function habilitadoParaPersona(tenantId: unknown, ficha: DocumentData | null | undefined): boolean {
  if (!ficha || ficha['consolaConversaciones'] !== 'nueva') return false;
  return !esTenantExcluido(tenantId) && !nombreExcluido(ficha['nombre']);
}

/**
 * El rol DE ESTE comercio, del token, sin leer nada: la forma del id y luego admin u oper. El soporte
 * no está en la lista.
 */
export function exigirRolDePersona(p: CallableRequest, tenantId: unknown): RolDePersona {
  exigirAutenticado(p);
  const sinPermiso = () => new HttpsError(ErroresDeTurno.sinPermiso.code, ErroresDeTurno.sinPermiso.message);
  if (typeof tenantId !== 'string' || !ID_COMERCIO.test(tenantId)) throw sinPermiso();
  if (esAdminDe(p, tenantId)) return 'admin';
  if (esOperDe(p, tenantId)) return 'oper';
  throw sinPermiso();
}

/** El comercio: `activo` y habilitado (bandera `nueva`, no Bellido). Devuelve su ficha. */
export async function exigirComercioHabilitado(tenantId: string, db: Firestore): Promise<DocumentData> {
  try {
    const snap = await db.doc(`tenants/${tenantId}`).get();
    const ficha = snap.exists ? snap.data() : undefined;
    if (!ficha || ficha['estado'] !== 'activo') {
      throw new HttpsError(ErroresDeTurno.sinPermiso.code, ErroresDeTurno.sinPermiso.message);
    }
    if (!habilitadoParaPersona(tenantId, ficha)) {
      throw new HttpsError(ErroresDeTurno.noHabilitado.code, ErroresDeTurno.noHabilitado.message);
    }
    return ficha;
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    // Firestore (o lo que sea) falló: no es una respuesta sobre el permiso.
    throw new HttpsError(ErroresDeTurno.noDisponible.code, ErroresDeTurno.noDisponible.message);
  }
}

export interface PersonaAutorizada {
  uid: string;
  rol: RolDePersona;
  /** La ficha del comercio ya leída. */
  ficha: DocumentData;
}

/** Las dos cosas juntas, en orden: el rol del token y luego la ficha. */
export async function exigirPersonaDe(
  p: CallableRequest, tenantId: unknown, db: Firestore,
): Promise<PersonaAutorizada> {
  const uid = exigirAutenticado(p);
  const rol = exigirRolDePersona(p, tenantId);
  const ficha = await exigirComercioHabilitado(tenantId as string, db);
  return { uid, rol, ficha };
}
