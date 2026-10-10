import { test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import prepararDatos from './preparar-datos';
import { crearUsuarioDeEnsayo } from './ayudas/datos';
import {
  FOGON, catalogoDeQtaco, clienteDeReglas, entrar, esperar as expect, existeItem, fijarPlanCrecimiento, leerContadorCatalogo, nombreDoc,
  sembrarCatalogo, type ClienteDeReglas,
} from './ayudas/o3-datos';

/**
 * PRO-10 — límite de productos por plan (Crecimiento: 100). La pantalla dice «N de 100», avisa desde el 90 %, y en el tope deshabilita
 * «Agregar» con el porqué; eliminar un ítem de baja libera un lugar. Y, por separado, lo que dicen las REGLAS cuando alguien se salta la
 * pantalla: se prueba con un cliente que obedece `firestore.rules` (token de un usuario real del emulador), con su control positivo
 * para que un rechazo no sea una prueba vacía.
 */

const URL_CATALOGO = `/negocio/${FOGON}/catalogo`;
const CONTADOR = `tenants/${FOGON}/contadores/catalogo`;

const cifra = (page: Page) => page.locator('.uso-plan-cifra');
const uso = (page: Page) => page.locator('.uso-plan');
const agregar = (page: Page) => page.getByRole('button', { name: 'Agregar', exact: true });

async function abrir(page: Page, consulta = ''): Promise<void> {
  await entrar(page, USUARIOS.adminFogon);
  await page.goto(`${URL_CATALOGO}${consulta}`);
  await expect(page.getByRole('heading', { name: 'Productos', exact: true })).toBeVisible();
  await expect(cifra(page)).toBeVisible();
}

async function sembrarN(n: number): Promise<void> {
  prepararDatos();
  await fijarPlanCrecimiento(FOGON);
  await sembrarCatalogo(FOGON, catalogoDeQtaco(n));
}

async function darDeAlta(page: Page, nombre: string): Promise<void> {
  await page.getByLabel('Nombre').last().fill(nombre);
  await page.getByLabel(/^Precio/).last().fill('10');
  await agregar(page).click();
  await expect(page.getByText('Agregado. El asistente lo ofrece desde ahora.')).toBeVisible();
}

/** Un alta como la hace la consola: el ítem y el contador en UN lote. `items` es el valor al que se lleva el contador. */
function altaDeItem(uid: string, id: string, items: number | null, extra: Record<string, unknown> = {}): unknown[] {
  const escrituras: unknown[] = [{
    update: {
      name: nombreDoc(`tenants/${FOGON}/catalogo/${id}`),
      fields: { nombre: { stringValue: `Alta ${id}` }, activo: { booleanValue: true }, actualizadoPor: { stringValue: uid }, ...extra },
    },
    updateTransforms: [{ fieldPath: 'actualizadoEn', setToServerValue: 'REQUEST_TIME' }],
    currentDocument: { exists: false },
  }];
  if (items !== null) {
    escrituras.push({
      update: { name: nombreDoc(CONTADOR), fields: { items: { integerValue: String(items) }, ultimoItem: { stringValue: id } } },
      updateMask: { fieldPaths: ['items', 'ultimoItem'] },
      updateTransforms: [{ fieldPath: 'actualizadoEn', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { exists: true },
    });
  }
  return escrituras;
}

test.describe('PRO-10 · Límite de productos por plan (pantalla)', () => {
  test.beforeEach(() => { test.setTimeout(90_000); });

  test('con 79 de 100: dice «79 de 100 productos (plan Crecimiento)», sin aviso, y «Agregar» está habilitado', async ({ page }) => {
    await sembrarN(79);
    await abrir(page);
    await expect(cifra(page)).toHaveText('79 de 100 productos (plan Crecimiento)');
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '79');
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '100');
    await expect(uso(page)).not.toHaveClass(/uso-plan-cerca|uso-plan-lleno/);
    await expect(uso(page)).not.toContainText('quedan');
    await expect(agregar(page)).toBeEnabled();
  });

  test('con 89 de 100 todavía no avisa (el aviso empieza en el 90 %)', async ({ page }) => {
    await sembrarN(89);
    await abrir(page);
    await expect(cifra(page)).toHaveText('89 de 100 productos (plan Crecimiento)');
    await expect(uso(page)).not.toHaveClass(/uso-plan-cerca|uso-plan-lleno/);
    await expect(uso(page)).not.toContainText(/Te queda/);
    await expect(agregar(page)).toBeEnabled();
  });

  test('con 90 de 100 avisa cuántos lugares quedan, ofrece el plan siguiente y el camino para cambiar; «Agregar» sigue habilitado y agrega', async ({ page }) => {
    await sembrarN(90);
    await abrir(page);
    await expect(cifra(page)).toHaveText('90 de 100 productos (plan Crecimiento)');
    await expect(uso(page)).toHaveClass(/uso-plan-cerca/);
    await expect(uso(page)).toContainText('Te quedan 10 lugares.');
    await expect(uso(page)).toContainText('el plan Pro admite hasta 500 productos');
    await expect(uso(page).getByRole('link', { name: 'Reclamos' })).toHaveAttribute('href', `/negocio/${FOGON}/reclamos`);
    await expect(agregar(page)).toBeEnabled();
    await expect(uso(page)).not.toContainText('Llegaste al tope');

    await darDeAlta(page, 'Taco numero noventa y uno');
    await expect(cifra(page)).toHaveText('91 de 100 productos (plan Crecimiento)');
    await expect(uso(page)).toContainText('Te quedan 9 lugares.');
    expect(await leerContadorCatalogo(FOGON)).toBe(91);
  });

  test('con 99 de 100 dice «Te queda 1 lugar» (en singular); al agregar el último llega al tope y «Agregar» se deshabilita', async ({ page }) => {
    await sembrarN(99);
    await abrir(page);
    await expect(uso(page)).toContainText('Te queda 1 lugar.');
    await darDeAlta(page, 'Taco numero cien');
    await expect(cifra(page)).toHaveText('100 de 100 productos (plan Crecimiento)');
    await expect(uso(page)).toHaveClass(/uso-plan-lleno/);
    await expect(agregar(page)).toBeDisabled();
    expect(await leerContadorCatalogo(FOGON)).toBe(100);
  });

  test('NEGATIVA: con 100 de 100 el tope se dice con su porqué, «Agregar» queda deshabilitado, Enter no agrega nada y editar sigue funcionando', async ({ page }) => {
    await sembrarN(100);
    await abrir(page);
    await expect(cifra(page)).toHaveText('100 de 100 productos (plan Crecimiento)');
    await expect(uso(page)).toHaveClass(/uso-plan-lleno/);
    await expect(uso(page)).toContainText('Llegaste al tope de tu plan');
    await expect(uso(page)).toContainText('no se pueden agregar productos nuevos');
    await expect(uso(page)).toContainText('Editar los que ya tienes sigue funcionando');
    await expect(uso(page)).toContainText('o pasa al plan Pro, que admite hasta 500');
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    await expect(agregar(page)).toBeDisabled();
    await expect(page.getByText('No se puede agregar: tu plan admite 100 productos y ya tienes 100.')).toBeVisible();

    // Intentar igual con el teclado: el botón deshabilitado también bloquea el envío con Enter.
    await page.getByLabel('Nombre').last().fill('Taco de contrabando');
    await page.getByLabel('Nombre').last().press('Enter');
    await expect(page.getByText('Agregado.')).toHaveCount(0);
    expect(await existeItem(FOGON, 'taco-de-contrabando')).toBe(false);
    expect(await leerContadorCatalogo(FOGON)).toBe(100);

    // Editar un ítem que ya existe no cuenta contra el tope.
    await page.getByLabel('Buscar').fill('Flan 003');
    const fila = page.getByRole('row', { name: /Flan 003/ });
    await fila.getByRole('button', { name: 'Editar' }).click();
    await page.getByPlaceholder('vacío = a consultar').fill('77');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Guardado. El asistente lo dice así desde el próximo mensaje.')).toBeVisible();
    await expect(page.getByRole('row', { name: /Flan 003/ })).toContainText('77');
    expect(await leerContadorCatalogo(FOGON)).toBe(100);
  });

  test('eliminar un ítem de baja libera un lugar: 100 → 99, el aviso vuelve a «Te queda 1 lugar» y se puede agregar de nuevo', async ({ page }) => {
    await sembrarN(100);
    await abrir(page, '?estado=inactivo');
    await expect(agregar(page)).toBeDisabled();
    const fila = page.getByRole('row', { name: /Flan 003/ });
    await fila.getByRole('button', { name: 'Eliminar' }).click();
    await page.getByRole('button', { name: 'Sí, eliminar' }).click();
    await expect(page.getByText('Eliminado. Se liberó un lugar de tu plan.')).toBeVisible();
    await expect(cifra(page)).toHaveText('99 de 100 productos (plan Crecimiento)');
    await expect(uso(page)).toHaveClass(/uso-plan-cerca/);
    await expect(uso(page)).toContainText('Te queda 1 lugar.');
    await expect(agregar(page)).toBeEnabled();
    await expect(page.getByRole('row', { name: /Flan 003/ })).toHaveCount(0);
    expect(await leerContadorCatalogo(FOGON)).toBe(99);
    expect(await existeItem(FOGON, 'p-003')).toBe(false);

    await darDeAlta(page, 'Reemplazo del flan');
    await expect(cifra(page)).toHaveText('100 de 100 productos (plan Crecimiento)');
    await expect(agregar(page)).toBeDisabled();
  });

  test('NEGATIVA: a un ítem que se ofrece no se le puede dar «Eliminar», así que el lugar no se libera sin dar de baja primero', async ({ page }) => {
    await sembrarN(100);
    await abrir(page, '?estado=activo');
    await expect(page.getByRole('button', { name: 'Eliminar' })).toHaveCount(0);
    await expect(cifra(page)).toHaveText('100 de 100 productos (plan Crecimiento)');
  });

  test('con el plan Impulso (la siembra por defecto) el tope es 20 y el plan que se ofrece es Crecimiento', async ({ page }) => {
    prepararDatos();
    await sembrarCatalogo(FOGON, catalogoDeQtaco(20));
    await abrir(page);
    await expect(cifra(page)).toHaveText('20 de 20 productos (plan Impulso)');
    await expect(uso(page)).toContainText('Llegaste al tope de tu plan');
    await expect(uso(page)).toContainText('pasa al plan Crecimiento, que admite hasta 100');
    await expect(agregar(page)).toBeDisabled();
  });
});

test.describe('PRO-10 · Límite de productos por plan (las reglas del servidor, sin pantalla)', () => {
  let admin: ClienteDeReglas;
  test.beforeEach(async () => {
    test.setTimeout(90_000);
    await sembrarN(100);
    admin = await clienteDeReglas(USUARIOS.adminFogon);
  });

  test('NEGATIVA: con 100 de 100, un alta que lleva el contador a 101 la rechazan las reglas, y el catálogo queda igual', async () => {
    const r = await admin.lote(altaDeItem(admin.uid, 'p-101', 101));
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('PERMISSION_DENIED');
    expect(await existeItem(FOGON, 'p-101')).toBe(false);
    expect(await leerContadorCatalogo(FOGON)).toBe(100);
  });

  test('NEGATIVA: crear un ítem SIN mover el contador (para no gastar un lugar) también se rechaza', async () => {
    const r = await admin.lote(altaDeItem(admin.uid, 'p-102', null));
    expect(r.codigo).toBe('PERMISSION_DENIED');
    expect(await existeItem(FOGON, 'p-102')).toBe(false);
  });

  test('NEGATIVA: mover el contador sin crear el ítem (inflarlo o desinflarlo a mano) se rechaza', async () => {
    const solo = (n: number) => [{
      update: { name: nombreDoc(CONTADOR), fields: { items: { integerValue: String(n) }, ultimoItem: { stringValue: 'p-fantasma' } } },
      updateMask: { fieldPaths: ['items', 'ultimoItem'] },
      updateTransforms: [{ fieldPath: 'actualizadoEn', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { exists: true },
    }];
    expect((await admin.lote(solo(99))).codigo).toBe('PERMISSION_DENIED');
    expect((await admin.lote(solo(0))).codigo).toBe('PERMISSION_DENIED');
    expect(await leerContadorCatalogo(FOGON)).toBe(100);
  });

  test('NEGATIVA: borrar un ítem sin bajar el contador se rechaza (el lugar no se regala ni se pierde)', async () => {
    const r = await admin.lote([{ delete: nombreDoc(`tenants/${FOGON}/catalogo/p-003`) }]);
    expect(r.codigo).toBe('PERMISSION_DENIED');
    expect(await existeItem(FOGON, 'p-003')).toBe(true);
  });

  test('NEGATIVA: un ítem con existencias (`stock`) no se crea desde el navegador, ni con lugar libre', async () => {
    await sembrarCatalogo(FOGON, catalogoDeQtaco(50));
    const r = await admin.lote(altaDeItem(admin.uid, 'p-con-stock', 51, { stock: { integerValue: '5' } }));
    expect(r.codigo).toBe('PERMISSION_DENIED');
    expect(await existeItem(FOGON, 'p-con-stock')).toBe(false);
  });

  test('CONTROL POSITIVO: con 99 de 100 el mismo alta sí pasa (el rechazo de arriba es por el tope, no por cómo está armado el lote)', async () => {
    await sembrarCatalogo(FOGON, catalogoDeQtaco(99));
    const r = await admin.lote(altaDeItem(admin.uid, 'p-100', 100));
    expect(r).toMatchObject({ ok: true, codigo: 'OK' });
    expect(await existeItem(FOGON, 'p-100')).toBe(true);
    expect(await leerContadorCatalogo(FOGON)).toBe(100);
    // y ahora, con 100, el siguiente no.
    expect((await admin.lote(altaDeItem(admin.uid, 'p-101', 101))).codigo).toBe('PERMISSION_DENIED');
  });

  test('NEGATIVA: con lugar libre, el operador y el administrador de otro comercio tampoco pueden crear productos', async () => {
    await sembrarCatalogo(FOGON, catalogoDeQtaco(50));
    await crearUsuarioDeEnsayo({ uid: 'u-oper-fogon', correo: USUARIOS.operadorFogon, nombre: 'Operador Fogon', tenantId: FOGON, rol: 'oper' });
    const oper = await clienteDeReglas(USUARIOS.operadorFogon);
    expect((await oper.lote(altaDeItem(oper.uid, 'p-oper', 51))).codigo).toBe('PERMISSION_DENIED');
    const ajeno = await clienteDeReglas(USUARIOS.adminAurora);
    expect((await ajeno.lote(altaDeItem(ajeno.uid, 'p-ajeno', 51))).codigo).toBe('PERMISSION_DENIED');
    expect(await existeItem(FOGON, 'p-oper')).toBe(false);
    expect(await existeItem(FOGON, 'p-ajeno')).toBe(false);
    // y el administrador del propio comercio sí (control).
    expect((await admin.lote(altaDeItem(admin.uid, 'p-propio', 51))).ok).toBe(true);
  });
});
