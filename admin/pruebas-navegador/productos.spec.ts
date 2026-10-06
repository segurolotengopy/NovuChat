import { expect, test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import prepararDatos from './preparar-datos';

const fila = (page: Page, nombre: string) => page.getByRole('row', { name: new RegExp(nombre) });
const contador = (page: Page) => page.locator('.uso-plan');

async function agregar(page: Page, nombre: string, precio: string): Promise<void> {
  await page.getByLabel('Nombre').last().fill(nombre);
  if (precio !== '') await page.getByLabel(/^Precio/).last().fill(precio);
  await page.getByRole('button', { name: 'Agregar' }).click();
  await expect(page.getByText('Agregado. El asistente lo ofrece desde ahora.')).toBeVisible();
}

test.describe('Productos', () => {
  test.beforeEach(async ({ page }) => {
    prepararDatos(); // cada prueba parte del mismo catálogo (3 productos) y del mismo contador del plan
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Productos', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Productos', exact: true })).toBeVisible();
  });

  test('muestra lo cargado y cuánto del plan se usa', async ({ page }) => {
    await expect(fila(page, 'Pique macho')).toContainText('65');
    await expect(fila(page, 'Silpancho')).toContainText('Se ofrece');
    await expect(page.getByText(/3 de \d+ productos/)).toBeVisible();
  });

  test('alta, edición de precio, baja, volver a ofrecer y eliminación del todo, con el contador del plan al día', async ({ page }) => {
    await agregar(page, 'E2E Taco', '21');
    await expect(fila(page, 'E2E Taco')).toContainText('21');
    await expect(fila(page, 'E2E Taco')).toContainText('Se ofrece');
    await expect(page.getByText(/4 de \d+ productos/)).toBeVisible();

    await fila(page, 'E2E Taco').getByRole('button', { name: 'Editar' }).click();
    await page.getByPlaceholder('vacío = a consultar').fill('25.5');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Guardado. El asistente lo dice así desde el próximo mensaje.')).toBeVisible();
    await expect(fila(page, 'E2E Taco')).toContainText('25.5');

    await fila(page, 'E2E Taco').getByRole('button', { name: 'Dar de baja' }).click();
    await expect(fila(page, 'E2E Taco')).toContainText('Dado de baja');
    await fila(page, 'E2E Taco').getByRole('button', { name: 'Volver a ofrecer' }).click();
    await expect(fila(page, 'E2E Taco')).toContainText('Se ofrece');

    await fila(page, 'E2E Taco').getByRole('button', { name: 'Dar de baja' }).click();
    await fila(page, 'E2E Taco').getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.getByText('¿Eliminar del todo? No se puede deshacer.')).toBeVisible();
    await page.getByRole('button', { name: 'Sí, eliminar' }).click();
    await expect(page.getByText('Eliminado. Se liberó un lugar de tu plan.')).toBeVisible();
    await expect(fila(page, 'E2E Taco')).toHaveCount(0);
    await expect(page.getByText(/3 de \d+ productos/)).toBeVisible();
  });

  test('NEGATIVA: Eliminar no existe mientras el producto se ofrece (solo se elimina lo dado de baja)', async ({ page }) => {
    await expect(fila(page, 'Refresco').getByRole('button', { name: 'Eliminar' })).toHaveCount(0);
  });

  test('NEGATIVA: «No» en la confirmación no elimina nada', async ({ page }) => {
    await agregar(page, 'E2E Conservar', '5');
    await fila(page, 'E2E Conservar').getByRole('button', { name: 'Dar de baja' }).click();
    await fila(page, 'E2E Conservar').getByRole('button', { name: 'Eliminar' }).click();
    await page.getByRole('button', { name: 'No', exact: true }).click();
    await expect(fila(page, 'E2E Conservar')).toBeVisible();
  });

  test('NEGATIVA: una foto que no es https se rechaza al editar y dice por qué', async ({ page }) => {
    await fila(page, 'Refresco').getByRole('button', { name: 'Editar' }).click();
    await page.getByPlaceholder('https://… foto (opcional)').fill('http://sitio.example/foto.png');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('La foto tiene que ser una dirección https.')).toBeVisible();
  });

  test('NEGATIVA: sin nombre no se agrega nada', async ({ page }) => {
    await page.getByLabel(/^Precio/).last().fill('10');
    await page.getByRole('button', { name: 'Agregar' }).click();
    await expect(page.getByText('Agregado.')).toHaveCount(0);
    await expect(page.getByText(/3 de \d+ productos/)).toBeVisible();
  });

  test('buscar por nombre deja solo lo que coincide', async ({ page }) => {
    await page.getByLabel('Buscar').fill('pique');
    await expect(fila(page, 'Pique macho')).toBeVisible();
    await expect(fila(page, 'Silpancho')).toHaveCount(0);
  });

  test('NEGATIVA (aislamiento): lo de otro comercio no se ve', async ({ page }) => {
    await expect(page.getByText('Corte')).toHaveCount(0);
  });
});
