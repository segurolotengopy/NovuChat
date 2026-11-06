/**
 * EDICIÓN DEL miniCRM CON LA CUENTA DE GOOGLE: LO QUE LA PANTALLA DECIDE (03/11/2026).
 *
 * Funciones puras y sin Firebase (se prueban sin navegador: `pruebas/central/edicion-crm-pantalla.test.ts`); la única parte con red es
 * `capaEdicionReal` (los tres callables de `editoresCrm`, por nombre y con tipos LOCALES). LA CONSOLA NO DECIDE: MUESTRA. El servidor
 * verifica el token de Google, el tope de editores del plan y quién puede apuntar a quién; lo que se calcula aquí solo evita ofrecer lo
 * que el servidor va a negar. Una sola identidad por persona: la cuenta de Google NO se vincula al usuario de Firebase; solo viaja su
 * ID token (de un solo uso) al servidor.
 */
import { httpsCallable, type Functions } from 'firebase/functions';

export type EstadoEdicion = 'ninguno' | 'activo' | 'revocado' | 'revocado_pendiente';
export interface MiEdicion { estado: EstadoEdicion; enlaceHoja: string | null; correo: string }
export interface CapaEdicion {
  consultar(tenantId: string): Promise<unknown>;
  registrar(tenantId: string, idTokenGoogle: string, uidDestino?: string): Promise<unknown>;
  quitar(tenantId: string, uidDestino?: string): Promise<unknown>;
}

/** El client id público de OAuth (no es un secreto). Sin él, la función no existe para la pantalla. */
export function clientIdGoogle(valor: unknown): string | null {
  return typeof valor === 'string' && /^[A-Za-z0-9._-]{10,200}$/.test(valor.trim()) ? valor.trim() : null;
}

/** Lo que llega del servidor, con tolerancia: cualquier cosa rara es «ninguno», nunca un enlace sin validar. */
export function leerMiEdicion(crudo: unknown): MiEdicion {
  const d = (crudo ?? {}) as Record<string, unknown>;
  const e = d['estado'];
  const estado: EstadoEdicion = e === 'activo' || e === 'revocado' || e === 'revocado_pendiente' ? e : 'ninguno';
  const enlace = d['enlaceHoja'];
  const enlaceHoja = estado === 'activo' && typeof enlace === 'string'
    && /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{10,100}(?:[/?#][^\s"'<>]*)?$/.test(enlace) ? enlace : null;
  const correo = estado === 'activo' ? abreviarCorreoVista(d['correo']) : '';
  return { estado, enlaceHoja, correo };
}

/** Abrevia un correo para mostrarlo: `ab***@gmail.com`. El correo completo no se guarda ni se pinta. */
export function abreviarCorreoVista(correo: unknown): string {
  if (typeof correo !== 'string') return '';
  const i = correo.lastIndexOf('@');
  if (i < 1) return correo.includes('*') ? correo.slice(0, 80) : '';
  if (correo.slice(0, i).includes('*')) return correo.slice(0, 80);
  return `${correo.slice(0, Math.min(2, i))}***${correo.slice(i, i + 60)}`;
}

export interface VistaEdicion {
  /** Se pinta el bloque. Sin client id (o sin rol del negocio) no se pinta nada. */
  visible: boolean;
  puedeHabilitar: boolean;
  puedeQuitar: boolean;
  /** El enlace «Abrir hoja» del componente: solo si está activo y trae enlace. */
  verEnlace: boolean;
  aviso: 'pendiente' | 'revocado' | null;
}

export function vistaDeEdicion(e: { clientId: string | null; esAdmin: boolean; esOper: boolean; miEdicion: MiEdicion | null }): VistaEdicion {
  const oculto: VistaEdicion = { visible: false, puedeHabilitar: false, puedeQuitar: false, verEnlace: false, aviso: null };
  if (e.clientId === null || !(e.esAdmin || e.esOper) || e.miEdicion === null) return oculto;
  const s = e.miEdicion.estado;
  return {
    visible: true,
    puedeHabilitar: s === 'ninguno' || s === 'revocado',
    puedeQuitar: s === 'activo' || s === 'revocado_pendiente',
    verEnlace: s === 'activo' && e.miEdicion.enlaceHoja !== null,
    aviso: s === 'revocado_pendiente' ? 'pendiente' : s === 'revocado' ? 'revocado' : null,
  };
}

/** En Usuarios (solo admin): las acciones sobre cada miembro. Nunca para quien no es admin. */
export function accionesDeMiembro(e: { clientId: string | null; esAdmin: boolean; estado: EstadoEdicion; miembroActivo: boolean }) {
  const ok = e.clientId !== null && e.esAdmin;
  return {
    habilitar: ok && e.miembroActivo && (e.estado === 'ninguno' || e.estado === 'revocado'),
    quitar: ok && (e.estado === 'activo' || e.estado === 'revocado_pendiente'),
  };
}

export const ROTULO_ESTADO: Record<EstadoEdicion, string> = {
  ninguno: 'Sin edición', activo: 'Edición habilitada', revocado: 'Edición quitada', revocado_pendiente: 'Baja pendiente',
};

/**
 * El texto de un error. El mensaje del servidor NO se muestra crudo: se mapea por código (el SDK los entrega como `functions/<código>`)
 * y cada texto dice qué hacer. Lo desconocido cae en un texto neutro.
 */
export function textoErrorEdicion(e: unknown, accion: 'habilitar' | 'quitar' = 'habilitar'): string {
  const c = String((e as { code?: unknown } | undefined)?.code ?? '').replace(/^functions\//, '');
  switch (c) {
    case 'failed-precondition':
      return 'Por ahora no se puede habilitar la edición: el miniCRM está apagado, no tiene hoja o la persona ya no es del negocio.';
    case 'already-exists': return 'Esa cuenta de Google ya edita la hoja para otra persona. Use otra cuenta.';
    case 'resource-exhausted': return 'El negocio alcanzó el máximo de personas que pueden editar la hoja. Quite a alguien primero.';
    case 'unavailable': return 'Google no confirmó el cambio del permiso. Intente de nuevo en unos minutos.';
    case 'permission-denied': return accion === 'quitar'
      ? 'No tiene permiso para quitar esta edición.'
      : 'La cuenta de Google debe estar verificada y ser la misma con la que usted ingresó, salvo que el administrador la registre.';
    case 'unauthenticated': return 'No se pudo verificar la cuenta de Google. Elija la cuenta de nuevo.';
    case 'aborted': return 'Otra operación cambió a esta persona al mismo tiempo. Intente de nuevo.';
    case 'not-found': return 'Esa persona no tiene edición habilitada.';
    case 'invalid-argument': return 'Los datos no son válidos. Recargue la página e intente de nuevo.';
    default: return accion === 'quitar' ? 'No se pudo quitar la edición. Intente de nuevo.' : 'No se pudo habilitar la edición. Intente de nuevo.';
  }
}

/** Resultado de quitar: `ok:false` (baja pendiente en Drive) nunca se presenta como «quitada». */
export function textoResultadoQuitar(r: unknown): string {
  const d = (r ?? {}) as Record<string, unknown>;
  return d['ok'] === true && d['estado'] === 'revocado'
    ? 'Edición quitada.'
    : 'La baja quedó pendiente: Google aún no confirmó. Vuelva a pulsar «Quitar» en unos minutos.';
}

export function capaEdicionReal(funciones: Functions): CapaEdicion {
  const llamar = async (nombre: string, datos: Record<string, unknown>) => (await httpsCallable(funciones, nombre)(datos)).data;
  return {
    consultar: (tenantId) => llamar('consultarMiEdicionCrm', { tenantId }),
    registrar: (tenantId, idTokenGoogle, uidDestino) =>
      llamar('registrarEditorCrm', uidDestino ? { tenantId, idTokenGoogle, uidDestino } : { tenantId, idTokenGoogle }),
    quitar: (tenantId, uidDestino) => llamar('quitarEditorCrm', uidDestino ? { tenantId, uidDestino } : { tenantId }),
  };
}
