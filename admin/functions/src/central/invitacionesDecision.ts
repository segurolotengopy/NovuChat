// ZONA CENTRAL: la decisión PURA de las invitaciones (sin Firebase, sin red, sin reloj propio).
//
// Todo lo que puede decidirse con los datos en la mano vive acá, para probarlo negando en
// una suite pura (`invitaciones-decision.test.ts`). Los callables (`invitaciones.ts`) solo
// leen, llaman a estas funciones y escriben.
//
// Diseño aprobado por Andres (18/10/2026): vigencia de 7 días, tope de 20 pendientes y de
// 5 reenvíos; un admin invita admins solo si el negocio NO tiene titular; si lo tiene, solo
// el titular. Sin correo: la persona ve la invitación al ingresar.
import { createHash } from 'node:crypto';

export const VIGENCIA_INVITACION_DIAS = 7;
export const TOPE_PENDIENTES = 20;
export const TOPE_REENVIOS = 5;
const DIA_MS = 24 * 60 * 60 * 1000;

export type EstadoInvitacion = 'pendiente' | 'aceptada' | 'vencida' | 'revocada';
export type RolInvitado = 'admin' | 'oper';

/** Mensajes exactos del diseño (Analisis, adenda 3, §4). */
export const MENSAJE = {
  invitada: 'Si ese correo corresponde a una cuenta de NovuChat, la persona verá la invitación al ingresar. Vence en 7 días.',
  yaEsMiembro: 'Esa persona ya es usuaria de este negocio.',
  topePendientes: 'Este negocio tiene 20 invitaciones pendientes. Cancele alguna antes de invitar de nuevo.',
  topeReenvios: 'Esta invitación ya se reenvió 5 veces. Cancélela y vuelva a invitar.',
  noEncontrada: 'Invitación no encontrada o ya no disponible.',
  noVigente: 'Esta invitación ya no está vigente. Pida que se la envíen de nuevo.',
  yaTieneAcceso: 'Ya tiene acceso a este negocio.',
  sesion: 'Ingrese con su correo y contraseña, con el correo verificado, para responder invitaciones.',
  rechazada: 'Invitación rechazada.',
  cancelada: 'Invitación cancelada.',
  // No está en el diseño: el permiso de rol según el titular.
  soloTitularInvitaAdmin: 'Este negocio tiene titular: solo el titular de la cuenta puede invitar administradores.',
} as const;

export const aceptadaMensaje = (negocio: string): string => `Listo: ya tiene acceso a ${negocio}.`;

// ---------------------------------------------------------------------------
// Identificadores y correo
// ---------------------------------------------------------------------------

/** Correo normalizado (minúsculas, sin espacios en los bordes), o null si no es un correo. */
export function normalizarCorreo(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const c = valor.trim().toLowerCase();
  if (c.length === 0 || c.length > 254) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c) ? c : null;
}

/** Id del documento: sha256 del correo normalizado (una invitación por correo y negocio). */
export const idInvitacion = (correoNormalizado: string): string =>
  createHash('sha256').update(correoNormalizado, 'utf8').digest('hex');

/** ¿Tiene la forma de un id de invitación (hex de 64)? Rechaza barras, `__proto__`, largos. */
export const esIdInvitacion = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

// ---------------------------------------------------------------------------
// Estado y vigencia
// ---------------------------------------------------------------------------

/** Milisegundos de un Timestamp de Firestore, un Date o un número; NaN si no es ninguno. */
export function msDe(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && v !== null && typeof (v as { toMillis?: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  return Number.NaN;
}

export const venceEnDesde = (ahoraMs: number): number => ahoraMs + VIGENCIA_INVITACION_DIAS * DIA_MS;

/**
 * Estado EFECTIVO: una invitación `pendiente` cuyo plazo pasó es `vencida` aunque el documento
 * aún diga lo contrario (no hay tarea programada: se persiste al tocarla). Un documento dañado
 * (estado desconocido, plazo ausente) falla cerrado: `null` = no disponible.
 */
export function estadoEfectivo(
  inv: { estado?: unknown; venceEn?: unknown } | undefined | null, ahoraMs: number,
): EstadoInvitacion | null {
  if (!inv) return null;
  switch (inv.estado) {
    case 'aceptada': return 'aceptada';
    case 'revocada': return 'revocada';
    case 'vencida': return 'vencida';
    case 'pendiente': {
      const vence = msDe(inv.venceEn);
      return Number.isFinite(vence) && vence > ahoraMs ? 'pendiente' : 'vencida';
    }
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Invitar
// ---------------------------------------------------------------------------
export interface Rechazo { ok: false; code: 'permission-denied' | 'already-exists' | 'resource-exhausted'; mensaje: string }
export type DecisionInvitar = Rechazo | { ok: true; accion: 'crear' | 'renovar'; reenvios: number };

/**
 * Decide si quien invita puede crear o renovar la invitación. `existente` es la del mismo
 * correo en este negocio (estado efectivo y reenvíos ya contados); `vigentesOtras` son las
 * pendientes VIGENTES del negocio sin contar la del mismo correo.
 *
 * Orden: permiso del rol, miembro ya existente, tope de reenvíos, tope de pendientes.
 * Reinvitar a un miembro (incluido el titular) se rechaza siempre: el rol de un miembro no se
 * cambia por invitación.
 */
export function decidirInvitar(p: {
  rol: RolInvitado;
  hayTitular: boolean;
  invitadorEsTitular: boolean;
  yaMiembro: boolean;
  existente: { estado: EstadoInvitacion | null; reenvios: number } | null;
  vigentesOtras: number;
}): DecisionInvitar {
  if (p.rol === 'admin' && p.hayTitular && !p.invitadorEsTitular) {
    return { ok: false, code: 'permission-denied', mensaje: MENSAJE.soloTitularInvitaAdmin };
  }
  if (p.yaMiembro) return { ok: false, code: 'already-exists', mensaje: MENSAJE.yaEsMiembro };

  const e = p.existente;
  // Una pendiente (vigente o ya vencida) se RENUEVA y cuenta como reenvío. Una aceptada
  // (la persona fue quitada después) o revocada se crea de nuevo, de cero: es el camino de
  // «cancélela y vuelva a invitar».
  const renueva = e !== null && (e.estado === 'pendiente' || e.estado === 'vencida');
  const reenvios = renueva ? Math.max(0, Math.trunc(e.reenvios) || 0) : 0;
  if (renueva && reenvios >= TOPE_REENVIOS) {
    return { ok: false, code: 'resource-exhausted', mensaje: MENSAJE.topeReenvios };
  }
  // Renovar una pendiente vigente no suma otra al conteo; todo lo demás sí.
  const yaCuenta = e !== null && e.estado === 'pendiente';
  if (!yaCuenta && p.vigentesOtras >= TOPE_PENDIENTES) {
    return { ok: false, code: 'resource-exhausted', mensaje: MENSAJE.topePendientes };
  }
  return { ok: true, accion: renueva ? 'renovar' : 'crear', reenvios: renueva ? reenvios + 1 : 0 };
}

// ---------------------------------------------------------------------------
// Responder
// ---------------------------------------------------------------------------
export type DecisionResponder =
  | { ok: true }
  | { ok: false; code: 'not-found' | 'failed-precondition' | 'already-exists'; mensaje: string; persistirVencida?: boolean };

/**
 * Comprobaciones de `responderInvitacion` sobre la invitación ya leída, en el orden del diseño
 * (la sesión y la forma de los ids ya se comprobaron antes): el correo de la invitación debe
 * ser el del token (si no, `not-found` UNIFORME, que no distingue «no existe» de «es de otro»);
 * pendiente y vigente; negocio no dado de baja; y, solo al aceptar, sin rol previo.
 */
export function decidirResponder(p: {
  correoToken: string;
  inv: { correo?: unknown; estado?: unknown; venceEn?: unknown } | undefined;
  ahoraMs: number;
  negocioDeBaja: boolean;
  respuesta: 'aceptar' | 'rechazar';
  tieneAcceso: boolean;
}): DecisionResponder {
  const noEncontrada = { ok: false, code: 'not-found', mensaje: MENSAJE.noEncontrada } as const;
  if (!p.inv || typeof p.inv.correo !== 'string' || p.inv.correo !== p.correoToken) return noEncontrada;
  const estado = estadoEfectivo(p.inv, p.ahoraMs);
  if (estado === null) return noEncontrada;
  if (estado !== 'pendiente') {
    return {
      ok: false, code: 'failed-precondition', mensaje: MENSAJE.noVigente,
      // Solo una «pendiente» cuyo plazo pasó se persiste como vencida.
      ...(p.inv.estado === 'pendiente' ? { persistirVencida: true } : {}),
    };
  }
  if (p.negocioDeBaja) return noEncontrada;
  if (p.respuesta === 'aceptar' && p.tieneAcceso) {
    return { ok: false, code: 'already-exists', mensaje: MENSAJE.yaTieneAcceso };
  }
  return { ok: true };
}
