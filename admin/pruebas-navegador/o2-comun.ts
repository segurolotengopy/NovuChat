import { expect as base, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { ingresar } from './ayudas/ingresar';
import { bd, crearUsuarioDeEnsayo } from './ayudas/datos';

/**
 * Lo que comparten los specs del carril 2 (Pedidos). Es solo del carril: las ayudas comunes viven en `ayudas/` y son de la Operadora.
 * La barrera `demo-*` y el emulador propio son las de `bd()` de `ayudas/datos.ts`.
 */

/** Espera más holgada: los cuatro carriles y el resto de la máquina corren a la vez y 8 s no alcanzan sin que haya un defecto. No relaja ninguna comprobación. */
export const ESPERA_MS = 25_000;
export const expect = base.configure({ timeout: ESPERA_MS });

/** Entrar con la espera holgada. */
export const ingresarO2 = (page: Page, correo: string): Promise<void> => ingresar(page, correo, ESPERA_MS);

/**
 * El cocinero (operador) de Parrilla El Fogon, PROPIO de este carril: correo y uid distintos de `USUARIOS.operadorFogon`, para no chocar
 * (mismo correo con otro uid) con otro spec que cree a ese operador.
 */
export const OPERADOR_O2 = { uid: 'u-o2-cocinero-fogon', correo: 'cocinero.o2.fogon@ejemplo.com' } as const;

export async function crearOperadorO2(tenantId: string): Promise<void> {
  await crearUsuarioDeEnsayo({ uid: OPERADOR_O2.uid, correo: OPERADOR_O2.correo, nombre: 'Cocinero de prueba', tenantId, rol: 'oper' });
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
