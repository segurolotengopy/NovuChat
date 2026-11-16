import { test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import { expect, ingresarO2 as ingresar } from './o2-comun';

/**
 * MENÚ LATERAL CON SÁNDWICH (pedido de Andres, 16/11/2026): el menú de la consola va a la izquierda y se abre y cierra con el botón
 * sándwich, en la computadora y en el teléfono. Lo que una prueba sin navegador no ve: que el panel se dibuja donde debe, que el
 * contenido no queda debajo, que cerrado no se alcanza con Tab, y que Escape y el toque afuera lo cierran devolviendo el foco.
 * Con `CAPTURAS_MENU=<carpeta>` guarda capturas de cada estado (para el PR); sin la variable no escribe nada.
 */
const FOGON = 'parrilla-el-fogon';
const CAPTURAS = process.env.CAPTURAS_MENU;

test.describe.configure({ timeout: 90_000 });

const boton = (page: Page) => page.locator('header.cabecera button.boton-menu');
const menu = (page: Page) => page.locator('#menu-lateral');

async function abrirInicio(page: Page): Promise<void> {
  await ingresar(page, USUARIOS.adminFogon);
  await page.goto(`/negocio/${FOGON}/inicio`);
  await expect(menu(page).locator('a', { hasText: 'Conversaciones' })).toBeAttached(); // por selector: cerrado, el menú no tiene rol accesible
}
async function capturar(page: Page, nombre: string): Promise<void> {
  if (!CAPTURAS) return;
  await page.waitForTimeout(350); // el deslizamiento del panel dura 200 ms
  await page.screenshot({ path: `${CAPTURAS}/${nombre}.png` });
}
/** Cuántos píxeles se sale el documento del ancho de la pantalla (0 = nada). */
const desborde = (page: Page): Promise<number> =>
  page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));

test.describe('Menú lateral en la computadora (1280 px)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('empieza abierto a la izquierda, el contenido no queda debajo, y el sándwich lo pliega y lo recuerda', async ({ page }) => {
    await abrirInicio(page);
    await expect(boton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(boton(page)).toHaveAttribute('aria-controls', 'menu-lateral');
    await expect(boton(page)).toHaveAccessibleName('Cerrar menú');
    await expect(page.getByRole('navigation', { name: 'Menú principal' })).toBeVisible();
    const caja = await menu(page).boundingBox();
    expect(caja?.x, 'el menú va pegado al borde izquierdo').toBe(0);
    // El tablero de la cuenta no cuelga una sección: sus tarjetas van sueltas. Ninguna puede quedar debajo del menú.
    const tarjeta = await page.locator('article.card').first().boundingBox();
    expect(tarjeta && tarjeta.x, 'el contenido empieza donde termina el menú').toBeGreaterThanOrEqual(caja?.width ?? 0);
    const cabecera = await page.locator('header.cabecera').boundingBox();
    expect(cabecera && [cabecera.x, cabecera.width], 'la cabecera sigue a todo lo ancho').toEqual([0, 1280]);
    await expect(menu(page).getByRole('link', { name: 'Inicio', exact: true })).toHaveAttribute('aria-current', 'page');
    const salir = await page.getByRole('button', { name: 'Salir' }).boundingBox();
    expect(salir && salir.x + salir.width, 'borde derecho de «Salir» con las 14 opciones del administrador').toBeLessThanOrEqual(1280);
    expect(await desborde(page), 'sin desplazamiento lateral').toBe(0);
    await capturar(page, 'escritorio-abierto');

    await boton(page).click();
    await expect(boton(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(boton(page)).toHaveAccessibleName('Abrir menú');
    await expect(menu(page)).toBeHidden();
    await capturar(page, 'escritorio-plegado');

    // La preferencia sobrevive a recargar la página.
    await page.reload();
    await expect(boton(page)).toHaveAttribute('aria-expanded', 'false');
    await boton(page).click();
    await expect(menu(page)).toBeVisible();
  });

  test('navegar no lo cierra y la opción activa cambia', async ({ page }) => {
    await abrirInicio(page);
    await menu(page).getByRole('link', { name: 'Conversaciones', exact: true }).click();
    await expect(page).toHaveURL(/\/conversaciones/);
    await expect(boton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(menu(page).getByRole('link', { name: 'Conversaciones', exact: true })).toHaveAttribute('aria-current', 'page');
    const lista = await page.locator('#raiz > section.cv').boundingBox();
    expect(lista && lista.x, 'Conversaciones empieza donde termina el menú').toBeGreaterThanOrEqual(239);
    expect(await desborde(page), 'Conversaciones sin desplazamiento lateral').toBe(0);
    await capturar(page, 'escritorio-conversaciones');
  });
});

test.describe('Menú lateral en el teléfono (375 px)', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('empieza cerrado, la barra de arriba cabe entera, y cerrado no se alcanza con el teclado', async ({ page }) => {
    await abrirInicio(page);
    await expect(boton(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(menu(page)).toBeHidden();
    expect(await desborde(page), 'sin desplazamiento lateral').toBe(0);
    const salir = await page.getByRole('button', { name: 'Salir' }).boundingBox();
    expect(salir && salir.x + salir.width, 'borde derecho de «Salir»').toBeLessThanOrEqual(375);
    await expect(menu(page)).toHaveAttribute('inert', '');
    await capturar(page, 'movil-cerrado');
  });

  test('el sándwich abre el panel sobre el contenido; elegir una opción lo cierra', async ({ page }) => {
    await abrirInicio(page);
    await boton(page).tap();
    await expect(boton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(menu(page)).toBeVisible();
    await expect(page.locator('.menu-velo')).toBeVisible();
    expect(await desborde(page), 'el panel no ensancha la página').toBe(0);
    await capturar(page, 'movil-abierto');
    await menu(page).getByRole('link', { name: 'Consumo', exact: true }).tap();
    await expect(page).toHaveURL(/\/consumo/);
    await expect(boton(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(menu(page)).toBeHidden();
    await expect(boton(page)).toBeFocused();
  });

  test('Escape y el toque afuera lo cierran, y el foco vuelve al sándwich', async ({ page }) => {
    await abrirInicio(page);
    await boton(page).tap();
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    await expect(boton(page)).toBeFocused();

    await boton(page).tap();
    await expect(menu(page)).toBeVisible();
    await page.locator('.menu-velo').tap({ position: { x: 340, y: 300 } });
    await expect(menu(page)).toBeHidden();
    await expect(boton(page)).toBeFocused();
    await expect(page.locator('.menu-velo')).toHaveCount(0);
  });
});
