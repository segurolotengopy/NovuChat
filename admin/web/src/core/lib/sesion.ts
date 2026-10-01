/**
 * Lectura de la identidad y de los permisos del usuario.
 *
 * REGLA CENTRAL: el rol y la pertenencia a un tenant se leen SIEMPRE de los
 * custom claims del ID token, que emite una Cloud Function con el SDK Admin y
 * firma Google. Nunca de un documento de Firestore que el usuario pueda tocar,
 * y nunca de algo guardado en localStorage.
 *
 * Lo que se decide acá es solo COSMÉTICO: qué menús se pintan. La autorización
 * real la aplica Firestore con `admin/firestore.rules`. Si alguien manipula el
 * navegador para pintarse un menú de más, el servidor igual le niega los datos.
 */
import type { User } from 'firebase/auth';

export type Rol = 'admin' | 'oper' | 'ingesta';

export interface Permisos {
  /** Propietario de la plataforma NovuChat. */
  propietario: boolean;
  /** Mapa tenantId -> rol, tal como viene del token. */
  tenants: Record<string, Rol>;
  /** Versión de los claims, para detectar tokens viejos tras un cambio de rol. */
  version: number;
}

const PERMISOS_VACIOS: Permisos = { propietario: false, tenants: {}, version: 0 };

/**
 * `forzarRefresco` obliga a pedir un ID token nuevo. Se usa después de un
 * cambio de rol: sin esto, el usuario arrastra los permisos viejos hasta que el
 * token caduque (hasta una hora).
 */
export async function leerPermisos(usuario: User | null, forzarRefresco = false): Promise<Permisos> {
  if (!usuario) return PERMISOS_VACIOS;
  const resultado = await usuario.getIdTokenResult(forzarRefresco);
  const nc = resultado.claims['nc'];
  if (typeof nc !== 'object' || nc === null) return PERMISOS_VACIOS;

  const bruto = nc as Record<string, unknown>;
  const tenantsBruto = typeof bruto['t'] === 'object' && bruto['t'] !== null
    ? (bruto['t'] as Record<string, unknown>)
    : {};

  const tenants: Record<string, Rol> = {};
  for (const [id, rol] of Object.entries(tenantsBruto)) {
    if (rol === 'admin' || rol === 'oper' || rol === 'ingesta') tenants[id] = rol;
  }

  return {
    propietario: bruto['p'] === true,
    tenants,
    version: typeof bruto['v'] === 'number' ? bruto['v'] : 0,
  };
}

export const rolEn = (p: Permisos, tenantId: string): Rol | null => p.tenants[tenantId] ?? null;
export const esAdmin = (p: Permisos, tenantId: string) => rolEn(p, tenantId) === 'admin';
export const puedeVerConversaciones = (p: Permisos, tenantId: string) =>
  rolEn(p, tenantId) === 'admin' || rolEn(p, tenantId) === 'oper';
