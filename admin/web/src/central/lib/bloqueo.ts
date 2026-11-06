/**
 * =============================================================================
 * BLOQUEAR UN CONTACTO: LO QUE LA PANTALLA DECIDE (31/10/2026, Andres, opción A)
 * =============================================================================
 *
 * Funciones puras y sin Firebase (se prueban sin navegador: `pruebas/central/bloqueo-pantalla.test.ts`). La única parte con
 * red es `capaBloqueoReal` (las dos callables de Core: `bloquearContacto` y `desbloquearContacto`).
 *
 * LA CONSOLA NO DECIDE: MUESTRA. El servidor rechaza a quien no es administrador, con un turno vigente, o con el comercio
 * inactivo; lo que se calcula acá solo evita ofrecer lo que el servidor va a negar. Un botón escondido no es un permiso negado.
 *
 * El dato (`bloqueada`, `bloqueadaEn`) lo escribe SOLO el servidor; acá se lee con tolerancia: solo `true` exacto bloquea.
 * Un contacto bloqueado no recibe respuesta alguna (silencio total, ni a él ni a recepción).
 */
import { httpsCallable, type Functions } from 'firebase/functions';
import type { Acciones, EntradaTurno, SituacionTurno } from './turno';

export type AccionBloqueo = 'bloquear' | 'desbloquear';

export const AVISO_BLOQUEAR =
  'Un contacto bloqueado no recibe ninguna respuesta del asistente, ni aviso a recepción. Sus mensajes se guardan y se ven acá, '
  + 'pero no cuentan para el plan. Puede desbloquearlo cuando quiera.';
export const CONFIRMAR_BLOQUEO = '¿Bloquear este contacto? El asistente dejará de responderle del todo hasta que lo desbloquee.';
export const TEXTO_BLOQUEADO = 'Contacto bloqueado: el asistente no le responde';
export const MOTIVO_BLOQUEADO = 'Contacto bloqueado: desbloquéelo para tomar la conversación o escribirle.';
export const MOTIVO_TURNO_VIGENTE = 'Para bloquear, primero devuelva la conversación al asistente: ahora la tiene una persona.';

export interface EntradaBloqueo {
  /** admin u oper del negocio, y NO el propietario de NovuChat (`puedeGestionarConversaciones`). */
  puedeGestionar: boolean;
  /** El rol de quien mira es admin del negocio (solo el administrador bloquea y desbloquea). */
  esAdmin: boolean;
  comercioActivo: boolean;
  bloqueada: boolean;
  situacion: SituacionTurno;
}

export interface AccionesBloqueo {
  verBloquear: boolean;
  verDesbloquear: boolean;
  /** Hay un turno vigente: «Bloquear» no se ofrece y se explica por qué. */
  avisoTurnoVigente: boolean;
  habilitados: boolean;
}

export function accionesDeBloqueo(a: EntradaBloqueo): AccionesBloqueo {
  const admin = a.puedeGestionar && a.esAdmin;
  return {
    verBloquear: admin && !a.bloqueada && a.situacion === 'asistente',
    verDesbloquear: admin && a.bloqueada,
    avisoTurnoVigente: admin && !a.bloqueada && a.situacion !== 'asistente',
    habilitados: a.comercioActivo,
  };
}

/** Con el contacto bloqueado no se ofrece tomar ni escribir (devolver sigue permitido: el servidor lo permite siempre). */
export function accionesSinBloqueadas(acciones: Acciones, bloqueada: boolean): Acciones {
  if (!bloqueada) return acciones;
  return { ...acciones, sinIntervencion: false, verTomar: false, sinTomarPorVentana: false, verEscribir: false };
}

/** El rótulo del botón de la lista: «Bloqueados (3)»; sin número todavía, sin paréntesis (no se inventa un cero). */
export const rotuloBloqueados = (n: number | null): string => (n === null ? 'Bloqueados' : `Bloqueados (${n})`);

/** `bloqueada` solo vale `true` exacto (como en el servidor). */
export const estaBloqueadaDe = (v: unknown): boolean => v === true;

export interface FilaBloqueada { id: string; telefono: string; nombre: string; bloqueadaEn: number | null }

/** Lee un documento de conversación como fila de la lista de bloqueados, o `null` si no está bloqueada. */
export function filaBloqueada(id: string, d: Record<string, unknown> | null | undefined): FilaBloqueada | null {
  const x = d ?? {};
  if (!estaBloqueadaDe(x['bloqueada'])) return null;
  const t = x['bloqueadaEn'] as { toMillis?: () => number } | null | undefined;
  const ms = t && typeof t.toMillis === 'function' ? t.toMillis() : NaN;
  return {
    id,
    telefono: typeof x['telefono'] === 'string' && x['telefono'] ? x['telefono'] : id.replace(/^wa_/, ''),
    nombre: typeof x['nombreContacto'] === 'string' ? x['nombreContacto'] : '',
    bloqueadaEn: Number.isFinite(ms) ? ms : null,
  };
}

/** Más reciente arriba; sin fecha, al final. Se ordena acá: la consulta (`bloqueada == true`) no lleva orden ni índice nuevo. */
export function ordenarBloqueadas(filas: readonly FilaBloqueada[]): FilaBloqueada[] {
  return [...filas].sort((a, b) => (b.bloqueadaEn ?? -Infinity) - (a.bloqueadaEn ?? -Infinity) || a.id.localeCompare(b.id));
}

/** «31/10/2026 14:05» (hora de Bolivia, UTC-4 fijo); sin fecha, «sin fecha». */
export function textoFechaBloqueo(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return 'sin fecha';
  const d = new Date(ms - 4 * 3_600_000);
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}`;
}

/** El texto de un error por su CÓDIGO (nunca por su `message`). `failed-precondition` al bloquear = hay un turno vigente. */
export function textoErrorBloqueo(accion: AccionBloqueo, codigo: string): string {
  switch (codigo) {
    case 'unauthenticated': return 'Su sesión venció. Vuelva a ingresar.';
    case 'permission-denied': return 'No tiene permiso para bloquear o desbloquear contactos, o esta función no está habilitada para su comercio.';
    case 'failed-precondition':
      return accion === 'bloquear' ? MOTIVO_TURNO_VIGENTE : 'No se pudo desbloquear. Revise el estado de la conversación.';
    case 'not-found': return 'La conversación ya no existe, o esta función todavía no está disponible.';
    case 'resource-exhausted': return 'Alcanzó el tope de cambios por hora o por día.';
    default: return accion === 'bloquear' ? 'No se pudo bloquear el contacto. Intente de nuevo.' : 'No se pudo desbloquear el contacto. Intente de nuevo.';
  }
}

export interface CapaBloqueo {
  bloquear(e: EntradaTurno): Promise<unknown>;
  desbloquear(e: EntradaTurno): Promise<unknown>;
}

/** Las dos callables de Core (región us-east1), solo con los campos del contrato. */
export function capaBloqueoReal(funciones: Functions): CapaBloqueo {
  const llamar = (nombre: string) => async (e: EntradaTurno) =>
    (await httpsCallable<EntradaTurno, unknown>(funciones, nombre)({ tenantId: e.tenantId, conversacionId: e.conversacionId })).data;
  return { bloquear: llamar('bloquearContacto'), desbloquear: llamar('desbloquearContacto') };
}
