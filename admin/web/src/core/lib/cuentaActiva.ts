/**
 * LA CUENTA ACTIVA: qué cuenta se ofrece y cuál fue la última.
 *
 * REGLA: la cuenta activa es SOLO el `:tenantId` de la URL. Acá no hay estado
 * de servidor ni autorización: lo guardado en localStorage es una PREFERENCIA
 * (cuál destacar), nunca un permiso. El servidor decide en cada petición contra
 * los claims firmados; y esta preferencia solo se usa si el id sigue estando en
 * los claims del token (una cuenta quitada, ajena o malformada se descarta).
 *
 * Todo el acceso al almacenamiento va en try/catch: puede estar bloqueado
 * (modo privado, cuota, política del navegador) y la consola debe seguir.
 */
import type { Permisos } from './sesion';

const PREFIJO = 'nc:ultimaCuenta:';

/** Cuentas a las que la persona entra como administrador u operador (nunca `ingesta`, que es una máquina). */
export function cuentasDe(permisos: Permisos): string[] {
  return Object.entries(permisos.tenants)
    .filter(([, rol]) => rol === 'admin' || rol === 'oper')
    .map(([id]) => id);
}

function almacen(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** La última cuenta usada, SOLO si sigue entre las cuentas del token; si no, null. */
export function leerUltima(uid: string, permisos: Permisos): string | null {
  try {
    if (typeof uid !== 'string' || uid === '') return null;
    const valor = almacen()?.getItem(PREFIJO + uid);
    if (typeof valor !== 'string' || valor === '') return null;
    return cuentasDe(permisos).includes(valor) ? valor : null;
  } catch {
    return null;
  }
}

/** Recuerda la última cuenta (preferencia). Nunca lanza. */
export function guardarUltima(uid: string, tenantId: string): void {
  try {
    if (typeof uid !== 'string' || uid === '' || typeof tenantId !== 'string' || tenantId === '') return;
    almacen()?.setItem(PREFIJO + uid, tenantId);
  } catch {
    /* el almacenamiento puede fallar: es solo una preferencia */
  }
}

export type DestinoInicial =
  | { tipo: 'ninguna' }
  | { tipo: 'directa'; tenantId: string }
  | { tipo: 'selector'; ultima: string | null };

/**
 * Qué hacer al entrar: 0 cuentas, nada (el mensaje «todavía no está asociada»);
 * 1, directo; varias, el selector SIEMPRE (nunca entra sola a la última: el
 * riesgo es atender en la cuenta equivocada). El propietario de NovuChat nunca
 * ve el selector: sigue en «Negocios».
 */
export function destinoInicial(permisos: Permisos, ultima: string | null): DestinoInicial {
  if (permisos.propietario) return { tipo: 'ninguna' };
  const cuentas = cuentasDe(permisos);
  if (cuentas.length === 0) return { tipo: 'ninguna' };
  if (cuentas.length === 1) return { tipo: 'directa', tenantId: cuentas[0]! };
  return { tipo: 'selector', ultima: ultima !== null && cuentas.includes(ultima) ? ultima : null };
}
