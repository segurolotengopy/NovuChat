import { expect, test } from '@playwright/test';
import { USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { fijarHorarios } from './ayudas/datos';
import prepararDatos from './preparar-datos';

const TODOS_LOS_DIAS = Object.fromEntries(['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'].map((d) => [d, '10:00-20:00']));

test.describe('Tablero', () => {
  test.beforeEach(() => { prepararDatos(); });

  test('muestra las cifras del comercio, lo que el asistente sabe ofrecer y el estado de la cuenta', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await expect(page.getByRole('heading', { name: 'Tu negocio' })).toBeVisible();
    await expect(page.getByText('CONVERSACIONES', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('MENSAJES DEL ASISTENTE')).toBeVisible();
    await expect(page.getByText('DERIVACIONES A OPERADOR')).toBeVisible();
    await expect(page.getByText('LO QUE EL ASISTENTE SABE OFRECER')).toBeVisible();
    await expect(page.getByText('Al día')).toBeVisible();
    // Las cifras salen de la siembra: 12 conversaciones este mes, 3 productos.
    await expect(page.getByText('12', { exact: true }).first()).toBeVisible();
  });

  test('el horario de hoy sale de lo configurado', async ({ page }) => {
    await fijarHorarios('parrilla-el-fogon', TODOS_LOS_DIAS);
    await ingresar(page, USUARIOS.adminFogon);
    await expect(page.getByText('Hoy abierto 10:00-20:00')).toBeVisible();
  });

  test('los períodos de arriba cambian sin romper la pantalla', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    for (const periodo of ['7 días', '30 días', 'Hoy']) {
      await page.getByRole('button', { name: periodo, exact: true }).click();
      await expect(page.getByText('MENSAJES DEL ASISTENTE')).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
  });

  test('«Editar productos» lleva al catálogo', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Editar productos' }).click();
    await expect(page.getByRole('heading', { name: 'Productos', exact: true })).toBeVisible();
  });
});

test.describe('Usuarios', () => {
  test.beforeEach(() => { prepararDatos(); });

  test('lista a los usuarios del comercio con su rol y su estado, y ofrece los dos roles para invitar', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Usuarios', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Usuarios del negocio' })).toBeVisible();
    await expect(page.getByRole('row', { name: /admin\.fogon@ejemplo\.com.*admin.*activo/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Operador — solo lee conversaciones/ })).toBeAttached();
    await expect(page.getByRole('option', { name: /Administrador — además edita la configuración/ })).toBeAttached();
  });

  test('NEGATIVA (aislamiento): no aparecen los usuarios de otro comercio', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Usuarios', exact: true }).click();
    await expect(page.getByRole('row', { name: /admin\.fogon/ })).toBeVisible();
    await expect(page.getByText('admin.aurora@ejemplo.com')).toHaveCount(0);
    await expect(page.getByText('operador.aurora@ejemplo.com')).toHaveCount(0);
  });
});
