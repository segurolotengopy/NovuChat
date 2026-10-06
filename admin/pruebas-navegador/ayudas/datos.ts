import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { PROYECTO, PUERTO_FIRESTORE } from '../entorno';

/**
 * Escribe datos de prueba en el emulador con el SDK Admin (se salta las reglas: es la forma de poner lo que en producción escribe
 * el servidor, como un pedido del catálogo web). SOLO contra el emulador: sin esa variable, o con un proyecto que no sea `demo-`,
 * se niega.
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
