// ZONA CENTRAL: el titular de la cuenta (`titularCuentaUid` en la ficha `tenants/{t}`).
//
// Decisión de Andres: un administrador NO puede quitar al titular, y el titular
// tampoco puede quitarse ni degradarse desde la consola; solo NovuChat lo cambia
// (script). Invariante: si hay titular, es miembro con rol admin.
//
// Vocabulario: «titular de la cuenta», NO «titularidad», que ya nombra al dueño
// del número de WhatsApp (`rutasWhatsApp/{n}.titularidad`).
//
// La ficha `tenants/{t}` la escribe solo el SDK Admin, así que el campo no se
// puede falsificar desde el navegador. Un tenant sin el campo (hoy, todos) se
// comporta como siempre.
import { db } from './comunes.js';

export const MOTIVO_TITULAR = 'No se puede quitar al titular de la cuenta. Lo cambia NovuChat.';

/** El titular según el contenido de la ficha: texto no vacío, o null. Pura. */
export function titularDeFicha(ficha: Record<string, unknown> | undefined): string | null {
  const valor = ficha?.['titularCuentaUid'];
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

/** Lee la ficha del negocio y devuelve su titular (null si no tiene). */
export async function titularDe(tenantId: string): Promise<string | null> {
  const ficha = await db().doc(`tenants/${tenantId}`).get();
  return titularDeFicha(ficha.data());
}

/**
 * Decide si la acción sobre `destino` se permite. Devuelve null (permitido) o el
 * motivo del rechazo. Quitar al titular nunca; invitarlo solo como administrador
 * (reinvitarlo como admin es inofensivo y repara una ficha dañada).
 */
export function decidirSobreTitular(p: {
  accion: 'quitar' | 'invitar'; destino: string; titular: string | null; rol?: string;
}): string | null {
  if (p.titular === null || p.destino !== p.titular) return null;
  if (p.accion === 'quitar') return MOTIVO_TITULAR;
  return p.rol === 'admin' ? null : MOTIVO_TITULAR;
}
