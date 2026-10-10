import { test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import prepararDatos from './preparar-datos';
import { fijarCobroReal, fijarConsolaOculta } from './ayudas/datos';
import { FOGON, entrar, esperar as expect } from './ayudas/o3-datos';
import { qrEnPng } from './ayudas/qr';
import { simularFuncion } from './ayudas/funciones';

/**
 * COB-02 — «Cambiar el QR» cuando el cobro real ya está activo (riesgo R7 de la matriz). Cada registro del servidor vuelve a `activo: false`
 * (`cobro.ts`), o sea que el formulario de reemplazo APAGA el cobro de quien ya cobra. NovuChat puede esconder ese formulario con el id
 * `reemplazoQr` de `consolaOculta`, y la pantalla lo esconde SOLO si el cobro real está activo: el primer QR sigue pudiéndose cargar.
 *
 *   consolaOculta        cobroReal          formulario de reemplazo
 *   ['reemplazoQr']      activo: true       NO se pinta (avisa que hay que hablar con NovuChat)
 *   ['reemplazoQr']      activo: false      sí
 *   ['reemplazoQr']      sin registrar      sí («Cargar mi QR»)
 *   sin lista / otros    activo: true       sí, sin ninguna advertencia previa (el comportamiento de siempre)
 *
 * Es solo presentación: el servidor no cambia.
 */

const REGISTRADO = { nombreCuenta: 'Q Taco de Prueba SRL', cuentas: ['123456789'], banco: 'Banco de Prueba', venceEl: '2027-12-31' };
const ACTIVO = { ...REGISTRADO, activo: true, ficha: 'ficha-de-prueba', cargaUtil: 'SINTETICO-QR-DE-PRUEBA-0001' };
const AVISO_OCULTO = 'Tu QR está cobrando. Para cambiarlo, comunícate con NovuChat: así el cobro no se corta mientras se reemplaza.';

const cambiar = (page: Page) => page.getByRole('heading', { name: 'Cambiar el QR' });
const cargar = (page: Page) => page.getByRole('heading', { name: 'Cargar mi QR' });
const formulario = (page: Page) => page.getByRole('button', { name: 'Guardar mi QR' });

async function abrirQr(page: Page): Promise<void> {
  await entrar(page, USUARIOS.adminFogon);
  await page.goto(`/negocio/${FOGON}/cobro`);
  await expect(page.getByRole('heading', { name: 'Configuración de QR' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tu QR de cobro' })).toBeVisible();
}

test.describe('COB-02 · «Cambiar el QR» con el cobro real activo (reemplazoQr)', () => {
  test.beforeEach(async () => {
    test.setTimeout(90_000);
    prepararDatos();
    await fijarCobroReal(FOGON, null);
    await fijarConsolaOculta(FOGON, null);
  });

  test('con `reemplazoQr` y el cobro real ACTIVO el formulario no se pinta: queda «Cobrando» y el aviso de hablar con NovuChat', async ({ page }) => {
    await fijarCobroReal(FOGON, ACTIVO);
    await fijarConsolaOculta(FOGON, ['reemplazoQr']);
    await abrirQr(page);
    await expect(page.getByText(AVISO_OCULTO)).toBeVisible();
    await expect(page.getByText('Cobrando')).toBeVisible();
    await expect(cambiar(page)).toHaveCount(0);
    await expect(cargar(page)).toHaveCount(0);
    await expect(formulario(page)).toHaveCount(0);
    await expect(page.getByLabel('Imagen del QR')).toHaveCount(0);
    await expect(page.getByLabel(/Miré en mi banco y confirmo/)).toHaveCount(0);
  });

  test('con `reemplazoQr` y el cobro real INACTIVO (registrado sin cobrar) el formulario SÍ se pinta, y no aparece el aviso', async ({ page }) => {
    await fijarCobroReal(FOGON, { ...REGISTRADO, activo: false });
    await fijarConsolaOculta(FOGON, ['reemplazoQr']);
    await abrirQr(page);
    await expect(cambiar(page)).toBeVisible();
    await expect(formulario(page)).toBeVisible();
    await expect(page.getByText('Guardado, todavía sin cobrar')).toBeVisible();
    await expect(page.getByText(AVISO_OCULTO)).toHaveCount(0);
  });

  test('con `reemplazoQr` y NINGÚN QR registrado el formulario SÍ se pinta como «Cargar mi QR» (el primer QR no se bloquea)', async ({ page }) => {
    await fijarConsolaOculta(FOGON, ['reemplazoQr']);
    await abrirQr(page);
    await expect(cargar(page)).toBeVisible();
    await expect(formulario(page)).toBeVisible();
    await expect(page.getByText('Todavía no cargaste ningún QR propio')).toBeVisible();
    await expect(page.getByText(AVISO_OCULTO)).toHaveCount(0);
  });

  test('sin la lista `consolaOculta` y con el cobro activo la pantalla es la de siempre: «Cambiar el QR» con su formulario y sin aviso', async ({ page }) => {
    await fijarCobroReal(FOGON, ACTIVO);
    await abrirQr(page);
    await expect(page.getByText('Cobrando')).toBeVisible();
    await expect(cambiar(page)).toBeVisible();
    await expect(formulario(page)).toBeVisible();
    await expect(page.getByText(AVISO_OCULTO)).toHaveCount(0);
  });

  test('una lista con OTROS ids (sin `reemplazoQr`) tampoco cambia nada: con el cobro activo se ofrece «Cambiar el QR»', async ({ page }) => {
    await fijarCobroReal(FOGON, ACTIVO);
    await fijarConsolaOculta(FOGON, ['horario', 'invitar']);
    await abrirQr(page);
    await expect(cambiar(page)).toBeVisible();
    await expect(page.getByText(AVISO_OCULTO)).toHaveCount(0);
  });

  test('en vivo: con la pantalla abierta, activar el cobro esconde el formulario y desactivarlo lo vuelve a mostrar', async ({ page }) => {
    await fijarCobroReal(FOGON, { ...REGISTRADO, activo: false });
    await fijarConsolaOculta(FOGON, ['reemplazoQr']);
    await abrirQr(page);
    await expect(cambiar(page)).toBeVisible();
    await fijarCobroReal(FOGON, ACTIVO);
    await expect(page.getByText(AVISO_OCULTO)).toBeVisible();
    await expect(cambiar(page)).toHaveCount(0);
    await fijarCobroReal(FOGON, { ...ACTIVO, activo: false });
    await expect(cambiar(page)).toBeVisible();
    await expect(page.getByText(AVISO_OCULTO)).toHaveCount(0);
  });

  test('en vivo: si NovuChat quita `reemplazoQr` de la lista, el formulario reaparece sin recargar', async ({ page }) => {
    await fijarCobroReal(FOGON, ACTIVO);
    await fijarConsolaOculta(FOGON, ['reemplazoQr']);
    await abrirQr(page);
    await expect(page.getByText(AVISO_OCULTO)).toBeVisible();
    await fijarConsolaOculta(FOGON, null);
    await expect(cambiar(page)).toBeVisible();
    await expect(page.getByText(AVISO_OCULTO)).toHaveCount(0);
  });

  test('DOCUMENTA lo que hace hoy la pantalla (R7): sin la lista, cambiar el QR con el cobro activo no pide confirmación ni advierte antes, y recién después dice «todavía sin cobrar»', async ({ page }) => {
    const { llamadas } = await simularFuncion(page, 'registrarQrDeCobro', { resultado: { registrado: true, problemas: [], advertencias: [], documento: 'venta' } });
    let dialogos = 0;
    page.on('dialog', async (d) => { dialogos += 1; await d.dismiss(); });
    await fijarCobroReal(FOGON, ACTIVO);
    await abrirQr(page);
    await expect(page.getByText('Cobrando')).toBeVisible();
    // Antes de enviar, nada en pantalla avisa que el cobro se va a cortar.
    const antes = (await page.locator('body').innerText()).toLowerCase();
    for (const aviso of ['apag', 'se corta', 'se cortará', 'dejará de cobrar', 'dejara de cobrar', 'confirmar el cambio']) expect(antes, aviso).not.toContain(aviso);

    await page.getByLabel('Imagen del QR').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: qrEnPng('SINTETICO-QR-DE-PRUEBA-0002') });
    await page.getByLabel('¿A nombre de quién está la cuenta?').fill('Q Taco de Prueba SRL');
    await page.getByLabel('Número de la cuenta que recibe el dinero').fill('123456789');
    await page.getByLabel('¿Qué día vence el QR?').fill('2027-12-31');
    await page.getByLabel(/Miré en mi banco y confirmo/).check();
    await page.getByLabel(/NO tiene un importe fijo grabado/).check();
    await formulario(page).click();
    await expect(page.getByText('QR guardado y verificado')).toBeVisible();
    expect(llamadas).toHaveLength(1); // se mandó sin ninguna confirmación intermedia
    expect(dialogos).toBe(0);

    // Lo que hace el servidor al registrar (`cobro.ts`): el cobro vuelve a `activo: false`. La pantalla pasa de «Cobrando» a «sin cobrar».
    await fijarCobroReal(FOGON, { ...ACTIVO, activo: false });
    await expect(page.getByText('Guardado, todavía sin cobrar')).toBeVisible();
    await expect(page.getByText('Cobrando', { exact: true })).toHaveCount(0);
  });
});
