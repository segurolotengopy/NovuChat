import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { expect, type Page } from '@playwright/test';
import { CLAVE_DE_PRUEBA, PROYECTO, PUERTO_AUTH, PUERTO_FIRESTORE } from '../entorno';
import { PNG_1X1 } from './png';

/**
 * Ayudas propias del CARRIL 3 (Cobros y Productos). No tocan `ayudas/datos.ts` (es de la Operadora): replican su barrera.
 * El SDK Admin se salta las reglas, así que se usa SOLO contra el emulador: la variable `FIRESTORE_EMULATOR_HOST` se FUERZA al
 * puerto del carril y, con un proyecto que no empiece por «demo-», se niega.
 */
function bd() {
  process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${PUERTO_FIRESTORE}`;
  if (!PROYECTO.startsWith('demo-')) throw new Error('NEGADO: el proyecto de las pruebas de navegador tiene que empezar con «demo-».');
  if (!getApps().length) initializeApp({ projectId: PROYECTO });
  if (!String(getApps()[0]?.options.projectId ?? '').startsWith('demo-')) throw new Error('NEGADO: la app de Admin no es de un proyecto demo-*.');
  return getFirestore();
}

export const FOGON = 'parrilla-el-fogon';
export const AURORA = 'salon-aurora';
export const UID_ADMIN_FOGON = 'u-admin-fogon';

/** `expect` con más paciencia (20 s): la máquina de pruebas corre varias suites a la vez y un listener de Firestore puede tardar. */
export const esperar = expect.configure({ timeout: 20_000 });

// ---------------------------------------------------------------------------------------------------------------------
// Entrada paciente: la máquina de pruebas corre varias suites a la vez y el inicio de sesión tarda más de lo que la configuración espera
// ---------------------------------------------------------------------------------------------------------------------

/** Igual que `ingresar`, con más paciencia (30 s) para que una máquina cargada no dé un rojo que no es de la pantalla. */
export async function entrar(page: Page, correo: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Correo').fill(correo);
  await page.getByLabel('Contraseña').fill(CLAVE_DE_PRUEBA);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByLabel('Correo')).toBeHidden({ timeout: 30_000 });
}

// ---------------------------------------------------------------------------------------------------------------------
// Plan y catálogo
// ---------------------------------------------------------------------------------------------------------------------

/** Plan Crecimiento como lo deja `asignar-plan`: 100 productos y 3 campañas (`fijarPlan` de la Operadora solo mueve las campañas). */
export async function fijarPlanCrecimiento(tenantId: string): Promise<void> {
  await bd().doc(`tenants/${tenantId}/cuenta/estado`).set(
    { plan: 'crecimiento', limites: { conversaciones: 220, productos: 100, agendas: 5, campanas: 3, cambiosIncluidos: 1 } }, { merge: true });
}

export interface ItemDeCatalogo {
  id: string;
  nombre: string;
  area?: string;
  descripcion?: string;
  precio?: number;
  imagenUrl?: string;
  activo: boolean;
  stock?: number;
  /** Minutos atrás de su última modificación (para «Recién modificados»). */
  haceMin?: number;
}

const BASES = ['Taco Pastor', 'Taco Birria', 'Horchata', 'Flan', 'Combo Familiar', 'Nachos'];
const AREAS = ['tacos', 'tacos', 'bebidas', 'postres', 'combos', ''];
const pad = (i: number) => String(i).padStart(3, '0');

/**
 * El catálogo con la forma de Q'Taco (`n` = 79: 54 activos y 25 de baja). Es determinista para que la prueba calcule lo que espera con
 * la misma función que sembró:
 *  - baja: los múltiplos de 3 hasta el 75 (25 ítems);
 *  - sin precio («a consultar»): los múltiplos de 13;
 *  - foto https: los múltiplos de 4;
 *  - sin área: i % 6 == 5;
 *  - la descripción menciona «Jamón» en los múltiplos de 7 (para la búsqueda sin tildes);
 *  - «Recién modificados»: el 1 es el más reciente.
 */
export function catalogoDeQtaco(n = 79): ItemDeCatalogo[] {
  const lista: ItemDeCatalogo[] = [];
  for (let i = 1; i <= n; i++) {
    const area = AREAS[i % 6]!;
    lista.push({
      id: `p-${pad(i)}`,
      nombre: `${BASES[i % 6]} ${pad(i)}`,
      ...(i % 6 === 5 ? {} : { area }),
      ...(i % 7 === 0 ? { descripcion: `Con salsa de Jamón ahumado (${i})` } : {}),
      ...(i % 13 === 0 ? {} : { precio: 5 + ((i * 7) % 90) }),
      ...(i % 4 === 0 ? { imagenUrl: `https://fotos.ejemplo.test/p/${pad(i)}.jpg` } : {}),
      activo: !(i % 3 === 0 && i <= 75),
      haceMin: i,
    });
  }
  return lista;
}

/** Deja el catálogo del comercio EXACTAMENTE con estos ítems y el contador del plan al día (lo que escribe el servidor). */
export async function sembrarCatalogo(tenantId: string, items: ItemDeCatalogo[], contador: number = items.length): Promise<void> {
  const db = bd();
  await db.recursiveDelete(db.collection(`tenants/${tenantId}/catalogo`));
  await db.recursiveDelete(db.collection(`tenants/${tenantId}/fotosCatalogo`));
  const ahora = Date.now();
  for (let i = 0; i < items.length; i += 400) {
    const lote = db.batch();
    for (const it of items.slice(i, i + 400)) {
      const { id, haceMin = 0, ...resto } = it;
      lote.set(db.doc(`tenants/${tenantId}/catalogo/${id}`), {
        ...resto, moneda: 'BOB', actualizadoPor: UID_ADMIN_FOGON, actualizadoEn: Timestamp.fromMillis(ahora - haceMin * 60_000),
      });
    }
    await lote.commit();
  }
  await db.doc(`tenants/${tenantId}/contadores/catalogo`).set({ items: contador, ultimoItem: '', actualizadoEn: FieldValue.serverTimestamp() });
}

/** Pone existencias a un ítem (lo que en producción hace `ajustarStock`): sirve para el caso «un ítem lleva stock». */
export async function fijarStock(tenantId: string, id: string, stock: number): Promise<void> {
  await bd().doc(`tenants/${tenantId}/catalogo/${id}`).set({ stock }, { merge: true });
}

/** Una foto SUBIDA por el comercio (vive en `fotosCatalogo`, no en el ítem): cuenta como «con foto» en el filtro. */
export async function sembrarFotoSubida(tenantId: string, id: string): Promise<void> {
  const datos = `data:image/png;base64,${PNG_1X1.toString('base64')}`;
  await bd().doc(`tenants/${tenantId}/fotosCatalogo/${id}`).set({
    datos, ancho: 1, alto: 1, bytes: PNG_1X1.length, tipo: 'image/png', actualizadoPor: UID_ADMIN_FOGON, actualizadoEn: Timestamp.now(),
  });
}

export async function leerContadorCatalogo(tenantId: string): Promise<number | undefined> {
  const v = (await bd().doc(`tenants/${tenantId}/contadores/catalogo`).get()).get('items');
  return typeof v === 'number' ? v : undefined;
}

export async function existeItem(tenantId: string, id: string): Promise<boolean> {
  return (await bd().doc(`tenants/${tenantId}/catalogo/${id}`).get()).exists;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cierres (cobros) con campos a mano
// ---------------------------------------------------------------------------------------------------------------------

/** Un cierre con EXACTAMENTE los campos que se pasen (sirve para los datos raros: sin monto, sin fecha, sello que no es un texto). */
export async function sembrarCierreCrudo(tenantId: string, id: string, campos: Record<string, unknown>): Promise<void> {
  await bd().doc(`tenants/${tenantId}/cierres/${id}`).set(campos);
}

export function ahoraMenosDias(dias: number): Timestamp {
  return Timestamp.fromMillis(Date.now() - dias * 86_400_000);
}

// ---------------------------------------------------------------------------------------------------------------------
// «Por SDK»: un cliente que obedece las REGLAS (no el SDK Admin). Es el cliente REST de los emuladores con el token de un usuario
// real de la siembra: el emulador de Firestore evalúa `firestore.rules` con ese token, igual que con el SDK de la consola.
// ---------------------------------------------------------------------------------------------------------------------

export interface RespuestaDeReglas { ok: boolean; estado: number; codigo: string }

export interface ClienteDeReglas {
  uid: string;
  /** Aplica las escrituras en UN lote atómico (igual que `writeBatch`). */
  lote(escrituras: unknown[]): Promise<RespuestaDeReglas>;
  /** Lee un documento con las reglas; `null` si las reglas lo niegan o no existe. */
  leer(ruta: string): Promise<{ estado: number; campos: Record<string, unknown> | null }>;
}

const RAIZ_DOCS = `projects/${PROYECTO}/databases/(default)/documents`;

export async function clienteDeReglas(correo: string): Promise<ClienteDeReglas> {
  const r = await fetch(`http://127.0.0.1:${PUERTO_AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=clave-ficticia`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password: CLAVE_DE_PRUEBA, returnSecureToken: true }),
  });
  const sesion = await r.json() as { idToken?: string; localId?: string; error?: unknown };
  if (!sesion.idToken || !sesion.localId) throw new Error(`No se pudo entrar como ${correo} en el emulador de Auth.`);
  const cabeceras = { 'content-type': 'application/json', authorization: `Bearer ${sesion.idToken}` };
  const base = `http://127.0.0.1:${PUERTO_FIRESTORE}/v1/${RAIZ_DOCS}`;
  return {
    uid: sesion.localId,
    async lote(escrituras) {
      const res = await fetch(`${base}:commit`, { method: 'POST', headers: cabeceras, body: JSON.stringify({ writes: escrituras }) });
      const cuerpo = await res.json().catch(() => ({})) as { error?: { status?: string } };
      return { ok: res.ok, estado: res.status, codigo: cuerpo.error?.status ?? (res.ok ? 'OK' : String(res.status)) };
    },
    async leer(ruta) {
      const res = await fetch(`${base}/${ruta}`, { headers: cabeceras });
      if (!res.ok) return { estado: res.status, campos: null };
      return { estado: res.status, campos: ((await res.json()) as { fields?: Record<string, unknown> }).fields ?? {} };
    },
  };
}

export const nombreDoc = (ruta: string) => `${RAIZ_DOCS}/${ruta}`;

/** El QR de demostración (`config/venta.mediaIdQr`) que NovuChat carga para las presentaciones; con `false` lo quita. */
export async function fijarQrDeDemostracion(tenantId: string, hay: boolean): Promise<void> {
  await bd().doc(`tenants/${tenantId}/config/venta`).set({ mediaIdQr: hay ? 'media-de-prueba-0001' : FieldValue.delete() }, { merge: true });
}
