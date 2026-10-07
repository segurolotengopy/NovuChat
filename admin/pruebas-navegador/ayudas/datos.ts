import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { PROYECTO, PUERTO_FIRESTORE } from '../entorno';

/**
 * Escribe datos de prueba en el emulador con el SDK Admin (se salta las reglas: es la forma de poner lo que en producción escribe
 * el servidor, como un pedido del catálogo web). SOLO contra el emulador: la variable `FIRESTORE_EMULATOR_HOST` se FUERZA a nuestro puerto (un valor heredado no gana, y con ella el SDK ignora las
 * credenciales reales) y, con un proyecto que no sea `demo-`, se niega.
 */
function bd() {
  process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${PUERTO_FIRESTORE}`;
  if (!PROYECTO.startsWith('demo-')) throw new Error('NEGADO: el proyecto de las pruebas de navegador tiene que empezar con «demo-».');
  if (!getApps().length) initializeApp({ projectId: PROYECTO });
  return getFirestore();
}

export interface PedidoDePrueba {
  id: string;
  items: { nombre: string; cantidad: number; detalle?: string }[];
  total: number;
  entrega: 'delivery' | 'retiro';
  direccion?: string;
  nota?: string;
  telefonoEnmascarado?: string;
  moneda?: string;
}

export async function sembrarPedido(tenantId: string, p: PedidoDePrueba): Promise<void> {
  const { id, ...resto } = p;
  await bd().doc(`tenants/${tenantId}/pedidos/${id}`).set({
    moneda: 'Bs', telefonoEnmascarado: '*** 0031', estado: 'nuevo', origen: 'catalogo-web', ...resto, creadoEn: Timestamp.now(),
  });
}

/** Deja el comercio sin pedidos (cada prueba arranca vacía). */
export async function limpiarPedidos(tenantId: string): Promise<void> {
  await bd().recursiveDelete(bd().collection(`tenants/${tenantId}/pedidos`));
}

/** Fija el horario de los 7 días del comercio (por el SDK Admin: no depende de que el guardado de la consola funcione). */
export async function fijarHorarios(tenantId: string, horarios: Record<string, string>): Promise<void> {
  await bd().doc(`tenants/${tenantId}/config/negocio`).set({ horarios }, { merge: true });
}

/** Deja registrado (o quita) el QR de cobro real de un comercio de ventas, como lo guardaría la Function `registrarQrDeCobro`. */
export async function fijarCobroReal(tenantId: string, cobro: Record<string, unknown> | null): Promise<void> {
  const ref = bd().doc(`tenants/${tenantId}/config/venta`);
  if (cobro === null) { const { FieldValue } = await import('firebase-admin/firestore'); await ref.set({ cobroReal: FieldValue.delete() }, { merge: true }); return; }
  await ref.set({ cobroReal: cobro }, { merge: true });
}

export interface CierreDePrueba {
  id: string;
  /** Cuántos días atrás ocurrió (0 = hoy). */
  haceDias?: number;
  tipo?: string;
  telefonoEnmascarado?: string;
  monto: number;
  referencia?: string;
  items?: { nombre: string; cantidad: number }[];
  cotejo?: { resultado: 'cuadra' | 'no_cuadra' | 'ilegible'; diferencias?: string[]; montoLeido?: number; banco?: string; intentos?: number };
  comprobado?: boolean;
}

/** Un cierre (un cobro) del comercio, como lo escribe el servidor al terminar un pedido. */
export async function sembrarCierre(tenantId: string, c: CierreDePrueba): Promise<void> {
  const { id, haceDias = 0, comprobado, cotejo, ...resto } = c;
  await bd().doc(`tenants/${tenantId}/cierres/${id}`).set({
    tipo: 'pedido', moneda: 'Bs', telefonoEnmascarado: '*** 0031', referencia: id.toUpperCase(), ...resto,
    ocurridoEn: Timestamp.fromMillis(Date.now() - haceDias * 86_400_000),
    ...(cotejo ? { cotejo: { ...cotejo, en: Timestamp.now() } } : {}),
    ...(comprobado ? { comprobadoPor: 'u-admin-fogon', comprobadoEn: Timestamp.now() } : {}),
  });
}

export async function limpiarCierres(tenantId: string): Promise<void> {
  await bd().recursiveDelete(bd().collection(`tenants/${tenantId}/cierres`));
}

/** Los contadores de comprobantes del mes en curso (los escribe el servidor). */
export async function sembrarContadoresDelMes(tenantId: string, contadores: Record<string, number>): Promise<void> {
  const d = new Date();
  const periodo = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  await bd().doc(`tenants/${tenantId}/metricas/${periodo}`).set(contadores, { merge: true });
}

export interface MensajeDePrueba { direccion: 'entrante' | 'saliente'; texto: string; tipo?: string; minutosAtras: number }

/** Una conversación con sus mensajes, como la deja la ingesta. El teléfono es sintético (seis ceros seguidos). */
export async function sembrarConversacion(tenantId: string, telefono: string, mensajes: MensajeDePrueba[], extra: Record<string, unknown> = {}): Promise<void> {
  const ref = bd().doc(`tenants/${tenantId}/conversaciones/wa_${telefono}`);
  const ultimo = mensajes.length ? mensajes.reduce((a, m) => (m.minutosAtras < a.minutosAtras ? m : a)) : { texto: 'sin mensajes', minutosAtras: 1 };
  await ref.set({ telefono, ultimoMensaje: ultimo.texto, ultimoEn: Timestamp.fromMillis(Date.now() - ultimo.minutosAtras * 60_000), ...extra });
  for (const [i, m] of mensajes.entries()) {
    await ref.collection('mensajes').doc(`m${i}`).set({
      direccion: m.direccion, texto: m.texto, ...(m.tipo ? { tipo: m.tipo } : {}), ts: Timestamp.fromMillis(Date.now() - m.minutosAtras * 60_000),
    });
  }
}

export async function limpiarConversaciones(tenantId: string): Promise<void> {
  await bd().recursiveDelete(bd().collection(`tenants/${tenantId}/conversaciones`));
}

export async function leerCampo(ruta: string, campo: string): Promise<unknown> {
  return (await bd().doc(ruta).get()).get(campo);
}

export interface CampanaDePrueba { id: string; texto: string; inicio: string; fin: string }

/** Deja la lista de campañas del comercio (vacía o con las que se pasen), como la guardaría la consola. */
export async function fijarCampanas(tenantId: string, lista: CampanaDePrueba[]): Promise<void> {
  await bd().doc(`tenants/${tenantId}/config/campanas`).set({ lista, actualizadoPor: 'u-admin-fogon', actualizadoEn: Timestamp.now() });
}

/** El día de hoy en Bolivia (UTC−4) más `n` días, como aaaa-mm-dd. */
export function diaDeBolivia(n = 0): string {
  return new Date(Date.now() - 4 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
}

/** Fija el plan del comercio y cuántas campañas admite (la consola lee `cuenta/estado`; el plan inicial de la siembra es Impulso, que no incluye campañas). */
export async function fijarPlan(tenantId: string, plan: string, campanas: number): Promise<void> {
  await bd().doc(`tenants/${tenantId}/cuenta/estado`).set({ plan, limites: { campanas } }, { merge: true });
}
