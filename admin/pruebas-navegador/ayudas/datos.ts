import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { CLAVE_DE_PRUEBA, PROYECTO, PUERTO_AUTH, PUERTO_FIRESTORE } from '../entorno';

/**
 * Escribe datos de prueba en el emulador con el SDK Admin (se salta las reglas: es la forma de poner lo que en producción escribe
 * el servidor, como un pedido del catálogo web). SOLO contra el emulador: la variable `FIRESTORE_EMULATOR_HOST` se FUERZA a nuestro puerto (un valor heredado no gana, y con ella el SDK ignora las
 * credenciales reales) y, con un proyecto que no sea `demo-`, se niega.
 */
function bd() {
  process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${PUERTO_FIRESTORE}`;
  if (!PROYECTO.startsWith('demo-')) throw new Error('NEGADO: el proyecto de las pruebas de navegador tiene que empezar con «demo-».');
  if (!getApps().length) initializeApp({ projectId: PROYECTO });
  // Segunda barrera: si otro módulo inicializó la app antes con otro proyecto, no se sigue.
  if (!String(getApps()[0]?.options.projectId ?? '').startsWith('demo-')) throw new Error('NEGADO: la app de Admin no es de un proyecto demo-*.');
  return getFirestore();
}

export interface PedidoDePrueba {
  id: string;
  items: { nombre: string; cantidad: number; detalle?: string }[];
  total: number;
  entrega: 'delivery' | 'retiro';
  direccion?: string;
  nota?: string;
  /** La referencia para llegar que escribió el cliente (catálogo web). */
  referencia?: string;
  /** Lo que guarda el servidor del catálogo web: `{lat, lng}`, a veces con valores inválidos a propósito. */
  ubicacion?: unknown;
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

// ---------------------------------------------------------------------------------------------------------------------
// Comercio y usuarios de ensayo (los helpers de `ayudas/` los escribe UN solo dueño: la Operadora; los carriles solo los usan)
// ---------------------------------------------------------------------------------------------------------------------

/** Los módulos del comercio (`tenants/{id}.modulos`) o, con `null`, quita el campo (la consola vuelve al respaldo por `flujos`). */
export async function fijarModulos(tenantId: string, modulos: string[] | null): Promise<void> {
  const { FieldValue } = await import('firebase-admin/firestore');
  await bd().doc(`tenants/${tenantId}`).set({ modulos: modulos === null ? FieldValue.delete() : modulos }, { merge: true });
}

/** Lo que NovuChat le oculta a la consola del comercio (`tenants/{id}.consolaOculta`): ids de `functions/src/central/consola-oculta.ts`. */
export async function fijarConsolaOculta(tenantId: string, ids: string[] | null): Promise<void> {
  const { FieldValue } = await import('firebase-admin/firestore');
  await bd().doc(`tenants/${tenantId}`).set({ consolaOculta: ids === null ? FieldValue.delete() : ids }, { merge: true });
}

export async function leerFicha(tenantId: string): Promise<Record<string, unknown>> {
  return ((await bd().doc(`tenants/${tenantId}`).get()).data() ?? {}) as Record<string, unknown>;
}

/**
 * Crea (o actualiza) un usuario de contraseña de un comercio, con el formato de claims y de espejo de miembros que usa `scripts/sembrar.mjs`.
 * `verificado: false` crea el caso «correo sin verificar». Contraseña: la de prueba de la siembra. Solo contra el emulador de Auth.
 */
export async function crearUsuarioDeEnsayo(o: { uid: string; correo: string; nombre: string; tenantId: string; rol: 'admin' | 'oper'; verificado?: boolean }): Promise<void> {
  const db = bd();
  process.env['FIREBASE_AUTH_EMULATOR_HOST'] = `127.0.0.1:${PUERTO_AUTH}`;
  const auth = getAuth();
  const datos = { email: o.correo, emailVerified: o.verificado !== false, password: CLAVE_DE_PRUEBA, displayName: o.nombre, disabled: false };
  try { await auth.updateUser(o.uid, datos); } catch (e) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
    await auth.createUser({ uid: o.uid, ...datos });
  }
  await auth.setCustomUserClaims(o.uid, { nc: { t: { [o.tenantId]: o.rol }, v: 1 } });
  await db.doc(`usuarios/${o.uid}`).set({ nombre: o.nombre, preferencias: {} });
  await db.doc(`tenants/${o.tenantId}/miembros/${o.uid}`).set({ correo: o.correo, rol: o.rol, estado: 'activo', desde: Timestamp.now() });
}

/** Borra un documento (por el SDK Admin) para probar la consola sobre un comercio sin él. */
export async function borrarDoc(ruta: string): Promise<void> {
  await bd().doc(ruta).delete();
}

export async function leerDoc(ruta: string): Promise<Record<string, unknown> | undefined> {
  return (await bd().doc(ruta).get()).data() as Record<string, unknown> | undefined;
}
