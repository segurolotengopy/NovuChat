import { expect, test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { diaDeBolivia, fijarCampanas, fijarPlan } from './ayudas/datos';
import prepararDatos from './preparar-datos';

const FOGON = 'parrilla-el-fogon';

async function abrirCampanas(page: Page): Promise<void> {
  await ingresar(page, USUARIOS.adminFogon);
  await page.getByRole('link', { name: 'Campañas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Campañas', exact: true })).toBeVisible();
}

test.describe('Campañas: plan Impulso (no incluye campañas)', () => {
  test.beforeEach(async () => { prepararDatos(); await fijarCampanas(FOGON, []); });

  test('NEGATIVA: dice que el plan no incluye campañas, cuál sí, y no ofrece el formulario', async ({ page }) => {
    await abrirCampanas(page);
    await expect(page.getByText('Tu plan no incluye campañas.')).toBeVisible();
    await expect(page.getByText('0 de 0 campañas')).toBeVisible();
    await expect(page.getByText(/El plan Crecimiento admite hasta 3 a la vez/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nueva campaña' })).toHaveCount(0);
    await expect(page.getByLabel('Texto exacto que deja el anuncio')).toHaveCount(0);
  });
});

test.describe('Campañas: plan Crecimiento (hasta 3)', () => {
  test.beforeEach(async () => { prepararDatos(); await fijarPlan(FOGON, 'crecimiento', 3); await fijarCampanas(FOGON, []); });

  test('sin campañas muestra cuántas admite el plan y ofrece crear la primera', async ({ page }) => {
    await abrirCampanas(page);
    await expect(page.getByText('0 de 3 campañas')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nueva campaña' })).toBeVisible();
  });

  test('crea una campaña con su texto y sus fechas, y aparece en la lista', async ({ page }) => {
    await abrirCampanas(page);
    await page.getByLabel('Texto exacto que deja el anuncio').fill('Quiero los tacos de martes');
    await page.getByLabel('Desde').fill(diaDeBolivia(0));
    await page.getByLabel('Hasta (incluido)').fill(diaDeBolivia(7));
    await page.getByRole('button', { name: 'Agregar campaña' }).click();
    await expect(page.getByText('Guardada. La revisamos antes de aplicarla')).toBeVisible();
    await expect(page.getByRole('row', { name: /Quiero los tacos de martes/ })).toBeVisible();
    await expect(page.getByText(/1 de \d+ campañas/)).toBeVisible();
  });

  test('NEGATIVA: sin texto no se puede agregar', async ({ page }) => {
    await abrirCampanas(page);
    await page.getByLabel('Desde').fill(diaDeBolivia(0));
    await page.getByLabel('Hasta (incluido)').fill(diaDeBolivia(3));
    await expect(page.getByRole('button', { name: 'Agregar campaña' })).toBeDisabled();
  });

  test('NEGATIVA: una fecha de fin anterior al inicio se rechaza y dice por qué', async ({ page }) => {
    await abrirCampanas(page);
    await page.getByLabel('Texto exacto que deja el anuncio').fill('Oferta de prueba');
    await page.getByLabel('Desde').fill(diaDeBolivia(5));
    await page.getByLabel('Hasta (incluido)').fill(diaDeBolivia(2));
    await expect(page.getByText('La fecha de fin es anterior a la de inicio.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Agregar campaña' })).toBeDisabled();
  });

  test('NEGATIVA: una campaña que empieza en el pasado se rechaza', async ({ page }) => {
    await abrirCampanas(page);
    await page.getByLabel('Texto exacto que deja el anuncio').fill('Oferta vieja');
    await page.getByLabel('Desde').fill(diaDeBolivia(-3));
    await page.getByLabel('Hasta (incluido)').fill(diaDeBolivia(3));
    await expect(page.getByRole('button', { name: 'Agregar campaña' })).toBeDisabled();
  });

  test('NEGATIVA: otra campaña con el mismo texto (sin importar mayúsculas ni tildes) se rechaza', async ({ page }) => {
    await fijarCampanas(FOGON, [{ id: 'c1', texto: 'Quiero los tacos de martes', inicio: diaDeBolivia(0), fin: diaDeBolivia(7) }]);
    await abrirCampanas(page);
    await page.getByLabel('Texto exacto que deja el anuncio').fill('QUIERO LOS TACOS DE MARTES!');
    await page.getByLabel('Desde').fill(diaDeBolivia(0));
    await page.getByLabel('Hasta (incluido)').fill(diaDeBolivia(3));
    await expect(page.getByText('Otra campaña ya tiene este mismo texto.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Agregar campaña' })).toBeDisabled();
  });

  test('edita una campaña y la elimina', async ({ page }) => {
    await fijarCampanas(FOGON, [{ id: 'c1', texto: 'Promo del viernes', inicio: diaDeBolivia(0), fin: diaDeBolivia(7) }]);
    await abrirCampanas(page);
    await page.getByRole('button', { name: 'Editar' }).click();
    await page.getByLabel('Hasta (incluido)').fill(diaDeBolivia(14));
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Guardada. La revisamos antes de aplicarla')).toBeVisible();

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.getByText('Campaña eliminada.')).toBeVisible();
    await expect(page.getByRole('row', { name: /Promo del viernes/ })).toHaveCount(0);
  });

  test('NEGATIVA: «Cancelar» en la confirmación no elimina', async ({ page }) => {
    await fijarCampanas(FOGON, [{ id: 'c1', texto: 'Promo del viernes', inicio: diaDeBolivia(0), fin: diaDeBolivia(7) }]);
    await abrirCampanas(page);
    page.once('dialog', (d) => void d.dismiss());
    await page.getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.getByRole('row', { name: /Promo del viernes/ })).toBeVisible();
  });

  test('NEGATIVA: con el tope del plan ya no se puede crear otra y se explica', async ({ page }) => {
    await fijarCampanas(FOGON, ['uno', 'dos', 'tres'].map((t, i) => ({ id: `c${i}`, texto: `Campaña ${t}`, inicio: diaDeBolivia(0), fin: diaDeBolivia(7) })));
    await abrirCampanas(page);
    await expect(page.getByText('3 de 3 campañas')).toBeVisible();
    await expect(page.getByText('Llegaste al tope de tu plan.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nueva campaña' })).toHaveCount(0);
  });

  test('NEGATIVA (aislamiento): las campañas de otro comercio no se ven', async ({ page }) => {
    await fijarCampanas('salon-aurora', [{ id: 'a1', texto: 'Corte con descuento secreto', inicio: diaDeBolivia(0), fin: diaDeBolivia(7) }]);
    await abrirCampanas(page);
    await expect(page.getByText('Corte con descuento secreto')).toHaveCount(0);
    await fijarCampanas('salon-aurora', []);
  });
});
