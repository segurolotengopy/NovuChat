import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { PROYECTO, PUERTO_FIRESTORE } from '../entorno';

/**
 * Ayudas propias del carril 2 (las de `datos.ts` son de la Operadora). Mismas barreras: solo el emulador propio y solo un proyecto `demo-*`.
 */
function bd() {
  process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${PUERTO_FIRESTORE}`;
  if (!PROYECTO.startsWith('demo-')) throw new Error('NEGADO: el proyecto de las pruebas de navegador tiene que empezar con «demo-».');
  if (!getApps().length) initializeApp({ projectId: PROYECTO });
  if (!String(getApps()[0]?.options.projectId ?? '').startsWith('demo-')) throw new Error('NEGADO: la app de Admin no es de un proyecto demo-*.');
  return getFirestore();
}

/**
 * Deja el comercio sin pedidos con lotes de borrado (hasta 400 por lote). `limpiarPedidos` usa `recursiveDelete`, que con 100 documentos y la
 * máquina cargada falló a medias («100 deletes failed») y dejó la prueba siguiente con datos viejos.
 */
export async function vaciarPedidos(tenantId: string): Promise<void> {
  const db = bd();
  const refs = await db.collection(`tenants/${tenantId}/pedidos`).listDocuments();
  for (let i = 0; i < refs.length; i += 400) {
    const lote = db.batch();
    for (const r of refs.slice(i, i + 400)) lote.delete(r);
    await lote.commit();
  }
}

/** Cambia el estado del comercio (`activo`, `suspendido`, `baja`…): las reglas de lectura miran este campo. */
export async function fijarEstadoDelComercio(tenantId: string, estado: string): Promise<void> {
  await bd().doc(`tenants/${tenantId}`).set({ estado }, { merge: true });
}

/**
 * Siembra `n` pedidos mínimos con fechas crecientes (el `m001` es el más viejo y el de número mayor, el más nuevo): la pantalla los ordena
 * por `creadoEn`, del más nuevo al más viejo. Un solo lote (el tope de Firestore es 500 por lote).
 */
export async function sembrarMuchosPedidos(tenantId: string, n: number): Promise<void> {
  const db = bd();
  const lote = db.batch();
  const t0 = Date.now() - n * 1000;
  for (let i = 1; i <= n; i += 1) {
    lote.set(db.doc(`tenants/${tenantId}/pedidos/m${String(i).padStart(3, '0')}`), {
      moneda: 'Bs', telefonoEnmascarado: '*** 0031', estado: 'nuevo', origen: 'catalogo-web', entrega: 'retiro', total: i,
      items: [{ nombre: `Plato numero ${i}`, cantidad: 1 }], creadoEn: Timestamp.fromMillis(t0 + i * 1000),
    });
  }
  await lote.commit();
}
