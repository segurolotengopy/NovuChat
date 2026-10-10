import { test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import prepararDatos from './preparar-datos';
import { diaDeBolivia, limpiarCierres, sembrarCierre } from './ayudas/datos';
import { FOGON, entrar, esperar as expect, sembrarCierreCrudo } from './ayudas/o3-datos';

/**
 * COB-06 — Cobros: lista, período y totales. Seis cierres en tres períodos:
 *
 *   hoy        A 100.5 (comprobado)   B 49.75
 *   hace 3 d.  C 30 (comprobado)
 *   hace 10 d. D 200
 *   hace 20 d. E 400 (comprobado)
 *   hace 45 d. F 1000                 ← fuera de «7 días» y de «30 días»
 *
 * Las tres cifras de cada período: cantidad de cobros, monto total y comprobados / sin comprobar.
 */

const TARJETA_COBROS = 'Cobros';
const TARJETA_COMPROBADOS = 'Comprobados';

const tarjeta = (page: Page, titulo: string) =>
  page.locator('article.tarjeta').filter({ has: page.getByRole('heading', { name: titulo, exact: true, level: 3 }) });
const cantidad = (page: Page) => tarjeta(page, TARJETA_COBROS).locator('.dato strong').nth(0);
const total = (page: Page) => tarjeta(page, TARJETA_COBROS).locator('.dato strong').nth(1);
const comprobados = (page: Page) => tarjeta(page, TARJETA_COMPROBADOS).locator('.dato strong').nth(0);
const sinComprobar = (page: Page) => tarjeta(page, TARJETA_COMPROBADOS).locator('.dato strong').nth(1);
const fila = (page: Page, monto: string) => page.getByRole('row', { name: new RegExp(`(?<![\\d.])${monto.replace('.', '\\.')} Bs`) });
const periodo = (page: Page, nombre: string) => page.getByRole('group', { name: 'Período' }).getByRole('button', { name: nombre, exact: true });

async function cifras(page: Page, esperadas: { cobros: string; monto: string; comprobados: string; sin: string }): Promise<void> {
  await expect(cantidad(page)).toHaveText(esperadas.cobros);
  await expect(total(page)).toHaveText(esperadas.monto);
  await expect(comprobados(page)).toHaveText(esperadas.comprobados);
  await expect(sinComprobar(page)).toHaveText(esperadas.sin);
}

async function sembrarSeis(): Promise<void> {
  await sembrarCierre(FOGON, { id: 'a', monto: 100.5, haceDias: 0, comprobado: true });
  await sembrarCierre(FOGON, { id: 'b', monto: 49.75, haceDias: 0 });
  await sembrarCierre(FOGON, { id: 'c', monto: 30, haceDias: 3, comprobado: true });
  await sembrarCierre(FOGON, { id: 'd', monto: 200, haceDias: 10 });
  await sembrarCierre(FOGON, { id: 'e', monto: 400, haceDias: 20, comprobado: true });
  await sembrarCierre(FOGON, { id: 'f', monto: 1000, haceDias: 45 });
}

async function abrirCobros(page: Page): Promise<void> {
  await entrar(page, USUARIOS.adminFogon);
  await page.goto(`/negocio/${FOGON}/cobros`);
  await expect(page.getByRole('heading', { name: 'Cobros', exact: true, level: 2 })).toBeVisible();
}

test.describe('COB-06 · Cobros: lista, período y totales', () => {
  test.beforeEach(async () => {
    test.setTimeout(90_000);
    prepararDatos();
    await limpiarCierres(FOGON);
  });

  test('«7 días» es el período por defecto: 3 cobros por 180.25, 2 comprobados y 1 sin comprobar; lo de hace 10, 20 y 45 días no entra', async ({ page }) => {
    await sembrarSeis();
    await abrirCobros(page);
    await expect(periodo(page, '7 días')).toHaveAttribute('aria-pressed', 'true');
    await cifras(page, { cobros: '3', monto: '180.25', comprobados: '2', sin: '1' });
    await expect(page.getByRole('row')).toHaveCount(4); // encabezado + 3
    for (const monto of ['100.5', '49.75', '30']) await expect(fila(page, monto)).toBeVisible();
    for (const monto of ['200', '400', '1000']) await expect(fila(page, monto)).toHaveCount(0);
  });

  test('«Hoy»: 2 cobros por 150.25, 1 comprobado y 1 sin comprobar; el de hace 3 días queda fuera', async ({ page }) => {
    await sembrarSeis();
    await abrirCobros(page);
    await periodo(page, 'Hoy').click();
    await expect(periodo(page, 'Hoy')).toHaveAttribute('aria-pressed', 'true');
    await cifras(page, { cobros: '2', monto: '150.25', comprobados: '1', sin: '1' });
    await expect(page.getByRole('row')).toHaveCount(3);
    await expect(fila(page, '30')).toHaveCount(0);
  });

  test('«30 días»: 5 cobros por 780.25, 3 comprobados y 2 sin comprobar; el de hace 45 días queda fuera; lo más nuevo va primero', async ({ page }) => {
    await sembrarSeis();
    await abrirCobros(page);
    await periodo(page, '30 días').click();
    await cifras(page, { cobros: '5', monto: '780.25', comprobados: '3', sin: '2' });
    await expect(page.getByRole('row')).toHaveCount(6);
    await expect(fila(page, '1000')).toHaveCount(0);
    // Orden: los dos de hoy (en cualquier orden entre sí), después 30, 200 y 400.
    const montos = (await page.getByRole('row').allInnerTexts()).slice(1).map((t) => /(?<![\d.])(\d+(?:\.\d+)?) Bs/.exec(t)?.[1]);
    expect(montos.slice(2)).toEqual(['30', '200', '400']);
    expect(new Set(montos.slice(0, 2))).toEqual(new Set(['100.5', '49.75']));
  });

  test('«Entre fechas»: un rango trae solo lo que cae adentro (los dos extremos incluidos) y recalcula las tres cifras', async ({ page }) => {
    await sembrarSeis();
    await abrirCobros(page);
    await periodo(page, 'Entre fechas').click();

    // Hace 12 días hasta hoy: A, B, C y D (no E, que es de hace 20 días).
    await page.getByLabel('Desde').fill(diaDeBolivia(-12));
    await page.getByLabel('Hasta').fill(diaDeBolivia(0));
    await cifras(page, { cobros: '4', monto: '380.25', comprobados: '2', sin: '2' });
    await expect(fila(page, '400')).toHaveCount(0);

    // Solo el día de hoy (desde = hasta): A y B; el día entero cuenta.
    await page.getByLabel('Desde').fill(diaDeBolivia(0));
    await cifras(page, { cobros: '2', monto: '150.25', comprobados: '1', sin: '1' });

    // Un rango que solo contiene al cierre de hace 45 días.
    await page.getByLabel('Desde').fill(diaDeBolivia(-46));
    await page.getByLabel('Hasta').fill(diaDeBolivia(-44));
    await cifras(page, { cobros: '1', monto: '1000', comprobados: '0', sin: '1' });
    await expect(fila(page, '1000')).toBeVisible();

    // Un rango amplio los trae a los seis.
    await page.getByLabel('Desde').fill(diaDeBolivia(-60));
    await page.getByLabel('Hasta').fill(diaDeBolivia(0));
    await cifras(page, { cobros: '6', monto: '1780.25', comprobados: '3', sin: '3' });
    await expect(page.getByRole('row')).toHaveCount(7);
  });

  test('NEGATIVA: «Hasta» antes de «Desde» no trae nada y lo dice (ceros en las tres cifras)', async ({ page }) => {
    await sembrarSeis();
    await abrirCobros(page);
    await periodo(page, 'Entre fechas').click();
    await page.getByLabel('Desde').fill(diaDeBolivia(0));
    await page.getByLabel('Hasta').fill(diaDeBolivia(-5));
    await expect(page.getByText('Sin cobros en este período.')).toBeVisible();
    await cifras(page, { cobros: '0', monto: '0', comprobados: '0', sin: '0' });
    await expect(page.getByRole('button', { name: /Exportar/ })).toHaveCount(0);
  });

  test('DOCUMENTA lo que hace hoy la pantalla: «Entre fechas» con las fechas vacías muestra TODOS los cobros cargados (no el período anterior)', async ({ page }) => {
    await sembrarSeis();
    await abrirCobros(page);
    await periodo(page, 'Entre fechas').click();
    await cifras(page, { cobros: '6', monto: '1780.25', comprobados: '3', sin: '3' });
    // Con una sola de las dos fechas puesta, pasa lo mismo.
    await page.getByLabel('Desde').fill(diaDeBolivia(-5));
    await cifras(page, { cobros: '6', monto: '1780.25', comprobados: '3', sin: '3' });
  });

  test('NEGATIVA: sin cobros en el período dice «Sin cobros en este período.», pone ceros y no ofrece exportar', async ({ page }) => {
    await sembrarCierre(FOGON, { id: 'viejo', monto: 999, haceDias: 45 });
    await abrirCobros(page);
    await expect(page.getByText('Sin cobros en este período.')).toBeVisible();
    await cifras(page, { cobros: '0', monto: '0', comprobados: '0', sin: '0' });
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Exportar/ })).toHaveCount(0);
    await periodo(page, '30 días').click();
    await expect(page.getByText('Sin cobros en este período.')).toBeVisible();
  });

  test('NEGATIVA: un cierre sin monto cuenta como cobro pero no suma (se ve «—»), y uno sin fecha no entra en ningún período', async ({ page }) => {
    await sembrarCierre(FOGON, { id: 'a', monto: 100.5, haceDias: 0 });
    await sembrarCierreCrudo(FOGON, 'sin-monto', { tipo: 'pedido', moneda: 'Bs', telefonoEnmascarado: '*** 0031', referencia: 'SIN-MONTO', ocurridoEn: new Date() });
    await sembrarCierreCrudo(FOGON, 'sin-fecha', { tipo: 'pedido', moneda: 'Bs', telefonoEnmascarado: '*** 0031', referencia: 'SIN-FECHA', monto: 777 });
    await abrirCobros(page);
    await cifras(page, { cobros: '2', monto: '100.5', comprobados: '0', sin: '2' });
    await expect(page.getByRole('row')).toHaveCount(3);
    await expect(fila(page, '777')).toHaveCount(0);
    await periodo(page, '30 días').click();
    await cifras(page, { cobros: '2', monto: '100.5', comprobados: '0', sin: '2' });
    await periodo(page, 'Entre fechas').click();
    await page.getByLabel('Desde').fill(diaDeBolivia(-3000));
    await page.getByLabel('Hasta').fill(diaDeBolivia(0));
    await cifras(page, { cobros: '2', monto: '100.5', comprobados: '0', sin: '2' });
  });

  test('un cobro nuevo aparece solo en el período abierto, sin recargar, y las cifras se recalculan', async ({ page }) => {
    await sembrarCierre(FOGON, { id: 'a', monto: 100.5, haceDias: 0 });
    await abrirCobros(page);
    await cifras(page, { cobros: '1', monto: '100.5', comprobados: '0', sin: '1' });
    await sembrarCierre(FOGON, { id: 'b', monto: 49.75, haceDias: 0, comprobado: true });
    await cifras(page, { cobros: '2', monto: '150.25', comprobados: '1', sin: '1' });
    await sembrarCierre(FOGON, { id: 'viejo', monto: 5, haceDias: 20 });
    await cifras(page, { cobros: '2', monto: '150.25', comprobados: '1', sin: '1' }); // uno de hace 20 días no entra en «7 días»
  });
});
