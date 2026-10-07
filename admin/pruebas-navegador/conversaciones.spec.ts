import { expect, test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { leerCampo, limpiarConversaciones, sembrarConversacion } from './ayudas/datos';
import prepararDatos from './preparar-datos';

const FOGON = 'parrilla-el-fogon';
const TEL = '59100000041';

async function abrirConversaciones(page: Page): Promise<void> {
  await ingresar(page, USUARIOS.adminFogon);
  await page.getByRole('link', { name: 'Conversaciones', exact: true }).click();
}

test.describe('Conversaciones', () => {
  test.beforeEach(async () => { prepararDatos(); await limpiarConversaciones(FOGON); });

  test('lista los hilos con el último mensaje y abre uno con sus mensajes en orden, entrantes y salientes', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, [
      { direccion: 'entrante', texto: 'Hola, quiero pedir', minutosAtras: 30 },
      { direccion: 'saliente', texto: 'Claro, ¿para delivery o recoger?', minutosAtras: 29 },
      { direccion: 'entrante', texto: 'Para recoger', minutosAtras: 28 },
    ]);
    await abrirConversaciones(page);
    await expect(page.getByRole('button', { name: new RegExp(TEL) })).toContainText('Para recoger');
    await page.getByRole('button', { name: new RegExp(TEL) }).click();
    const mensajes = page.locator('ol.hilo li');
    await expect(mensajes).toHaveCount(3);
    await expect(mensajes.nth(0)).toContainText('Hola, quiero pedir');
    await expect(mensajes.nth(0)).toHaveClass(/entrante/);
    await expect(mensajes.nth(1)).toHaveClass(/saliente/);
    await expect(mensajes.nth(2)).toContainText('Para recoger');
  });

  test('marca lo que llegó y no era texto: el comprobante, el audio, la ubicación', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, [
      { direccion: 'entrante', texto: 'el cliente envió una IMAGEN', tipo: 'image', minutosAtras: 5 },
      { direccion: 'entrante', texto: 'el cliente envió un AUDIO', tipo: 'audio', minutosAtras: 4 },
      { direccion: 'entrante', texto: 'el cliente compartió una ubicación', tipo: 'location', minutosAtras: 3 },
    ]);
    await abrirConversaciones(page);
    await page.getByRole('button', { name: new RegExp(TEL) }).click();
    await expect(page.getByText('Imagen — puede ser el comprobante')).toBeVisible();
    await expect(page.getByText('🎤 Audio')).toBeVisible();
    await expect(page.getByText('📍 Ubicación')).toBeVisible();
  });

  test('NO HAY FUNCIÓN HOY: la consola no reproduce audio ni video ni muestra la imagen de un comprobante (solo los marca)', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, [
      { direccion: 'entrante', texto: 'nota de voz', tipo: 'audio', minutosAtras: 4 },
      { direccion: 'entrante', texto: 'comprobante', tipo: 'image', minutosAtras: 3 },
    ]);
    await abrirConversaciones(page);
    await page.getByRole('button', { name: new RegExp(TEL) }).click();
    await expect(page.locator('ol.hilo li')).toHaveCount(2);
    await expect(page.locator('ol.hilo audio, ol.hilo video, ol.hilo img')).toHaveCount(0);
  });

  test('NEGATIVA: el HTML de un mensaje se ve como texto, no se ejecuta', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, [
      { direccion: 'entrante', texto: '<img src=x onerror="window.__xss=1"><b>negrita</b>', minutosAtras: 5 },
    ]);
    await abrirConversaciones(page);
    await page.getByRole('button', { name: new RegExp(TEL) }).click();
    await expect(page.locator('ol.hilo li')).toContainText('<b>negrita</b>');
    await expect(page.locator('ol.hilo img, ol.hilo b')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test('«No contactar» se enciende y se apaga y queda guardado', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, [{ direccion: 'entrante', texto: 'hola', minutosAtras: 5 }]);
    await abrirConversaciones(page);
    await page.getByRole('button', { name: new RegExp(TEL) }).click();
    const casilla = page.getByLabel('No contactar');
    await casilla.click(); // controlada por React: cambia cuando vuelve el dato de la base, no al instante
    await expect(casilla).toBeChecked();
    await expect.poll(() => leerCampo(`tenants/${FOGON}/conversaciones/wa_${TEL}`, 'noContactar')).toBe(true);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await casilla.click();
    await expect(casilla).not.toBeChecked();
    await expect.poll(() => leerCampo(`tenants/${FOGON}/conversaciones/wa_${TEL}`, 'noContactar')).toBe(false);
  });

  test('una conversación sin mensajes guardados lo dice', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, []);
    await abrirConversaciones(page);
    await page.getByRole('button', { name: new RegExp(TEL) }).click();
    await expect(page.getByText('Esta conversación todavía no tiene mensajes guardados.')).toBeVisible();
  });

  test('NEGATIVA (aislamiento): las conversaciones de otro comercio no se ven', async ({ page }) => {
    await sembrarConversacion('salon-aurora', '59100000099', [{ direccion: 'entrante', texto: 'secreto de la peluquería', minutosAtras: 5 }]);
    await sembrarConversacion(FOGON, TEL, [{ direccion: 'entrante', texto: 'hola fogon', minutosAtras: 5 }]);
    await abrirConversaciones(page);
    await expect(page.getByRole('button', { name: new RegExp(TEL) })).toBeVisible();
    await expect(page.getByText('secreto de la peluquería')).toHaveCount(0);
    await expect(page.getByText('59100000099')).toHaveCount(0);
    await limpiarConversaciones('salon-aurora');
  });
});
