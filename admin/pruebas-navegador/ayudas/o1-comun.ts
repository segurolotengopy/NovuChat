import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { expect, type Page } from '@playwright/test';
import { CLAVE_DE_PRUEBA, PROYECTO, PUERTO_AUTH, PUERTO_FIRESTORE } from '../entorno';
import { crearUsuarioDeEnsayo } from './datos';

/**
 * Ayudas del carril 1 (acceso, menú, consola oculta, Configuración, Tablero). Las escribe un solo dueño (O1); las ayudas comunes
 * de `datos.ts`, `entorno.ts` y `preparar-datos.ts` son de la Operadora y aquí solo se usan.
 */

export const FOGON = 'parrilla-el-fogon';
export const AURORA = 'salon-aurora';

/** Los módulos de Q'Taco (ventas sin inventario): lo que `aplicar-modulos-tenant` le escribe a la ficha. */
export const MODULOS_QTACO = ['productos', 'campanas', 'cobros', 'pedidos', 'catalogo-web'];

export const UID_OPER_FOGON = 'u-oper-fogon';
export const UID_PROPIETARIO_SIMULADO = 'u-propietario-simulado';
export const CORREO_PROPIETARIO_SIMULADO = 'propietario.simulado@ejemplo.com';

/** Crea el operador de Q'Taco (la siembra solo trae uno en el salón). Se llama DESPUÉS de sembrar: la siembra borra los miembros. */
export async function crearOperadorFogon(correo: string): Promise<void> {
  await crearUsuarioDeEnsayo({ uid: UID_OPER_FOGON, correo, nombre: 'Operador Fogon', tenantId: FOGON, rol: 'oper' });
}

function bdPropia() {
  process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${PUERTO_FIRESTORE}`;
  process.env['FIREBASE_AUTH_EMULATOR_HOST'] = `127.0.0.1:${PUERTO_AUTH}`;
  if (!PROYECTO.startsWith('demo-')) throw new Error('NEGADO: el proyecto de las pruebas de navegador tiene que empezar con «demo-».');
  // La app por omisión, la misma que usa `datos.ts` (que solo inicializa una si no hay ninguna): dos apps distintas se pisarían.
  const app = getApps()[0] ?? initializeApp({ projectId: PROYECTO });
  if (!String(app.options.projectId ?? '').startsWith('demo-')) throw new Error('NEGADO: la app de Admin no es de un proyecto demo-*.');
  return { db: getFirestore(app), auth: getAuth(app) };
}

/**
 * PROPIETARIO SIMULADO. La consola decide qué pinta solo con el claim `nc.p` del token (`leerPermisos`); las reglas, en cambio,
 * exigen además el proveedor `google.com` (que acá no se automatiza). Se crea entonces una cuenta de contraseña con `p: true` y,
 * además, administradora del comercio, para que lea la ficha. Sirve para probar la PRESENTACIÓN del propietario (la lista de
 * `consolaOculta` no le rige), no sus permisos de servidor.
 */
export async function crearPropietarioSimulado(tenantId: string): Promise<void> {
  const { db, auth } = bdPropia();
  const datos = { email: CORREO_PROPIETARIO_SIMULADO, emailVerified: true, password: CLAVE_DE_PRUEBA, displayName: 'Propietario simulado', disabled: false };
  try { await auth.updateUser(UID_PROPIETARIO_SIMULADO, datos); } catch (e) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
    await auth.createUser({ uid: UID_PROPIETARIO_SIMULADO, ...datos });
  }
  await auth.setCustomUserClaims(UID_PROPIETARIO_SIMULADO, { nc: { t: { [tenantId]: 'admin' }, p: true, v: 1 } });
  await db.doc(`usuarios/${UID_PROPIETARIO_SIMULADO}`).set({ nombre: 'Propietario simulado', preferencias: {} });
  await db.doc(`tenants/${tenantId}/miembros/${UID_PROPIETARIO_SIMULADO}`).set({ correo: CORREO_PROPIETARIO_SIMULADO, rol: 'admin', estado: 'activo', desde: Timestamp.now() });
}

/** Escribe un documento por el SDK Admin (se salta las reglas): para sembrar lo que en producción escribe el servidor. */
export async function fijarDoc(ruta: string, campos: Record<string, unknown>, mezclar = true): Promise<void> {
  await bdPropia().db.doc(ruta).set(campos, { merge: mezclar });
}

/** Quita un campo de un documento (por el SDK Admin): para probar el comercio que nunca lo tuvo. */
export async function quitarCampo(ruta: string, campo: string): Promise<void> {
  await bdPropia().db.doc(ruta).update({ [campo]: FieldValue.delete() });
}

/**
 * Deja en la bitácora del comercio EXACTAMENTE `n` eventos, todos de los últimos minutos (para el tope de 1500 del Tablero). Antes
 * borra los que traía la siembra: cuentan para el tope y harían que «uno menos que el tope» fuera en realidad el tope.
 */
export async function sembrarEventosDeBitacora(tenantId: string, n: number): Promise<void> {
  const { db } = bdPropia();
  await limpiarBitacora(tenantId);
  const base = Date.now();
  let lote = db.batch();
  for (let i = 0; i < n; i += 1) {
    lote.set(db.doc(`tenants/${tenantId}/bitacora/o1-${String(i).padStart(5, '0')}`), {
      tipo: i % 2 === 0 ? 'mensaje_entrante' : 'mensaje_saliente',
      conversacionId: `wa_5917000000${i % 10}`,
      ts: Timestamp.fromMillis(base - 60_000 - i),
    });
    if ((i + 1) % 400 === 0) { await lote.commit(); lote = db.batch(); }
  }
  await lote.commit();
}

export async function limpiarBitacora(tenantId: string): Promise<void> {
  // De a 200 y en serie: el borrado masivo en paralelo (`recursiveDelete`) deja sin aire al emulador con 1500 eventos.
  const { db } = bdPropia();
  for (;;) {
    const lote = await db.collection(`tenants/${tenantId}/bitacora`).limit(200).get();
    if (lote.empty) return;
    const escritura = db.batch();
    lote.docs.forEach((d) => escritura.delete(d.ref));
    await escritura.commit();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Escribir "por el SDK" COMO UN USUARIO: una petición REST al emulador de Firestore con el ID token de la persona, o sea con las
// reglas reales y sin pasar por la pantalla. Es lo que haría quien se salte la consola. Sirve para comprobar que ocultar es solo
// presentación (el servidor sigue permitiendo) y que el comercio no puede escribir lo que no le toca (negativa).
// ---------------------------------------------------------------------------------------------------------------------

async function idTokenDe(correo: string): Promise<string> {
  const r = await fetch(`http://127.0.0.1:${PUERTO_AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=clave-ficticia`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password: CLAVE_DE_PRUEBA, returnSecureToken: true }),
  });
  const cuerpo = (await r.json()) as { idToken?: string };
  if (!r.ok || !cuerpo.idToken) throw new Error(`No se pudo ingresar como ${correo} en el emulador de Auth (${r.status}).`);
  return cuerpo.idToken;
}

type ValorFs = Record<string, unknown>;
function aValorFs(v: unknown): ValorFs {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(aValorFs) } };
  if (v !== null && typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, aValorFs(x)])) } };
  return { nullValue: null };
}

/**
 * Actualiza campos de un documento existente como `correo`. Con `conSello` agrega `actualizadoPor` (el uid) y `actualizadoEn`
 * (la hora del servidor), que es lo que exige la regla de `config/negocio`. Devuelve si el servidor lo aceptó.
 */
export async function escribirComoUsuario(correo: string, ruta: string, campos: Record<string, unknown>, opciones: { conSelloDe?: string } = {}):
  Promise<{ aceptado: boolean; estado: number }> {
  const token = await idTokenDe(correo);
  const nombre = `projects/${PROYECTO}/databases/(default)/documents/${ruta}`;
  const todos = { ...campos, ...(opciones.conSelloDe ? { actualizadoPor: opciones.conSelloDe } : {}) };
  const escritura = {
    update: { name: nombre, fields: Object.fromEntries(Object.entries(todos).map(([k, v]) => [k, aValorFs(v)])) },
    updateMask: { fieldPaths: [...Object.keys(todos), ...(opciones.conSelloDe ? ['actualizadoEn'] : [])] },
    ...(opciones.conSelloDe ? { updateTransforms: [{ fieldPath: 'actualizadoEn', setToServerValue: 'REQUEST_TIME' }] } : {}),
    currentDocument: { exists: true },
  };
  const r = await fetch(`http://127.0.0.1:${PUERTO_FIRESTORE}/v1/projects/${PROYECTO}/databases/(default)/documents:commit`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ writes: [escritura] }),
  });
  return { aceptado: r.ok, estado: r.status };
}

// ---------------------------------------------------------------------------------------------------------------------
// La pantalla
// ---------------------------------------------------------------------------------------------------------------------

/** Los rótulos de los enlaces del menú, en orden (sin «Mi cuenta», que va aparte). */
export function enlacesDelMenu(page: Page) {
  return page.locator('header.cabecera nav a');
}

/** Espera a que el menú tenga exactamente estos rótulos, en este orden (el menú se arma cuando carga la ficha del comercio). */
export async function esperarMenu(page: Page, rotulos: string[]): Promise<void> {
  await expect(enlacesDelMenu(page)).toHaveText(rotulos);
}

export const enlaceMiCuenta = (page: Page) => page.locator('header.cabecera').getByRole('link', { name: 'Mi cuenta', exact: true });

/** «Sin permiso» (el encabezado de la pantalla que cierra el guardia de rutas). */
export const sinPermiso = (page: Page) => page.getByRole('heading', { name: 'Sin permiso' });

/** Escribe un valor en un campo controlado de React saltándose el `maxLength` del navegador (como lo haría quien pega o arma la petición a mano). */
export async function escribirSinTope(page: Page, etiqueta: string | RegExp, valor: string): Promise<void> {
  const campo = page.getByLabel(etiqueta, { exact: typeof etiqueta === 'string' });
  await campo.evaluate((el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, valor);
}
