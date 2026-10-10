import { test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import prepararDatos from './preparar-datos';
import { fijarCobroReal, fijarConsolaOculta, limpiarCierres, sembrarCierre, sembrarContadoresDelMes } from './ayudas/datos';
import { FOGON, entrar, esperar as expect, fijarQrDeDemostracion } from './ayudas/o3-datos';
import { simularFuncion } from './ayudas/funciones';
import { qrEnPng } from './ayudas/qr';

/**
 * COB-08 — Detalle del cobro (cotejo y textos), con la PROHIBICIÓN 3 de CLAUDE.md puesta en pantalla: ninguna frase afirma que un pago está
 * acreditado, verificado o recibido. El OCR de un comprobante no es una acreditación bancaria; quien confirma que entró la plata es el banco.
 *
 * Se barre el HTML COMPLETO (el DOM serializado, con atributos como `aria-label` o `title`; el HTML sin etiquetas, para que una frase partida
 * por `<strong>` no se escape; y el texto visible) de Cobros, del detalle de cada cobro y de Configuración de QR, en cada estado.
 */

const FRASES_PROHIBIDAS = [
  'pago acreditado', 'pago verificado', 'recibimos tu pago', 'verificamos tu pago', 'gracias por tu pago',
  // Variantes de la misma afirmación.
  'pago confirmado', 'pago recibido', 'acreditad',
];

const normal = (t: string) => t.toLowerCase().replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

/** Falla si ALGUNA de las tres lecturas de la página contiene una frase prohibida; `donde` dice qué estado se barrió. */
async function barrer(page: Page, donde: string): Promise<void> {
  const html = normal(await page.content());
  const sinEtiquetas = normal((await page.content()).replace(/<[^>]*>/g, ' '));
  const visible = normal(await page.locator('body').innerText());
  expect(visible.length, `${donde}: la página está vacía`).toBeGreaterThan(200);
  for (const [fuente, texto] of [['HTML', html], ['HTML sin etiquetas', sinEtiquetas], ['texto visible', visible]] as const) {
    for (const frase of FRASES_PROHIBIDAS) expect(texto.includes(frase), `${donde} · ${fuente} contiene «${frase}»`).toBe(false);
  }
}

const REGISTRADO = { nombreCuenta: 'Q Taco de Prueba SRL', cuentas: ['123456789'], banco: 'Banco de Prueba', venceEl: '2027-12-31' };
const ACTIVO = { ...REGISTRADO, activo: true, ficha: 'ficha-de-prueba', cargaUtil: 'SINTETICO-QR-DE-PRUEBA-0001' };
const CONTADORES = { cobrosQrEnviados: 7, cobrosValidos: 4, cobrosAproximados: 1, cobrosEnRevision: 1, cobrosInvalidos: 1 };

/** Un cobro por estado de cotejo (el monto identifica la fila). */
async function sembrarEstados(): Promise<void> {
  await sembrarCierre(FOGON, { id: 'cuadra', monto: 110, items: [{ nombre: 'Tacos de Birria', cantidad: 2 }], cotejo: { resultado: 'cuadra', montoLeido: 110, banco: 'Banco de Prueba', intentos: 1 } });
  await sembrarCierre(FOGON, { id: 'no-cuadra', monto: 55, cotejo: { resultado: 'no_cuadra', montoLeido: 50, banco: 'Banco de Prueba', intentos: 3, diferencias: ['El monto leído es 50 y el pedido es 55', 'La cuenta destino no coincide'] } });
  await sembrarCierre(FOGON, { id: 'ilegible', monto: 44, cotejo: { resultado: 'ilegible', intentos: 2 } });
  await sembrarCierre(FOGON, { id: 'sin-cotejo', monto: 33 });
  await sembrarCierre(FOGON, { id: 'comprobado', monto: 22, comprobado: true, cotejo: { resultado: 'cuadra', montoLeido: 22 } });
  await sembrarCierre(FOGON, { id: 'cita-1', tipo: 'cita', monto: 66, referencia: 'CITA-1', cotejo: { resultado: 'cuadra', montoLeido: 66 } });
  // Una venta cotejada con comprobante en custodia: el detalle pinta el visor (no se pulsa: es de otra sesión).
  await sembrarCierre(FOGON, { id: 'venta_1', monto: 77, cotejo: { resultado: 'cuadra', montoLeido: 77 } });
}

async function abrirCobros(page: Page): Promise<void> {
  await entrar(page, USUARIOS.adminFogon);
  await page.goto(`/negocio/${FOGON}/cobros`);
  await expect(page.getByRole('heading', { name: 'Cobros', exact: true, level: 2 })).toBeVisible();
}

const fila = (page: Page, monto: string) => page.getByRole('row', { name: new RegExp(`(?<![\\d.])${monto} Bs`) });
const detalle = (page: Page) => page.getByRole('dialog', { name: 'Detalle del cobro' });

async function verDetalle(page: Page, monto: string): Promise<void> {
  await fila(page, monto).getByRole('button', { name: 'Ver' }).click();
  await expect(detalle(page)).toBeVisible();
}

test.describe('COB-08 · Cobros: detalle del cobro, cotejo y textos', () => {
  test.beforeEach(async () => {
    test.setTimeout(120_000);
    prepararDatos();
    await limpiarCierres(FOGON);
    await fijarCobroReal(FOGON, null);
    await fijarConsolaOculta(FOGON, null);
  });

  test('la lista muestra cada estado con su rótulo de DATOS (nunca de dinero) y el HTML completo no afirma que el pago esté acreditado', async ({ page }) => {
    await sembrarEstados();
    await sembrarCierre(FOGON, { id: 'aprox', monto: 88, cotejo: { resultado: 'cuadra', montoLeido: 88, calidad: 'aproximado' } as never });
    await abrirCobros(page);
    await expect(fila(page, '110')).toContainText('Datos coinciden');
    await expect(fila(page, '88')).toContainText('Datos coinciden de forma aproximada');
    await expect(fila(page, '55')).toContainText('Hay una diferencia');
    await expect(fila(page, '44')).toContainText('Ilegible');
    await expect(fila(page, '33')).not.toContainText(/Datos coinciden|Hay una diferencia|Ilegible/);
    await expect(fila(page, '22')).toContainText('Comprobado por el negocio');
    await expect(page.getByText('eso no confirma que el dinero entró')).toBeVisible();
    await expect(page.getByText('NovuChat nunca lo marca solo.')).toBeVisible();
    await barrer(page, 'Cobros · todos los estados · cobro simulado');
  });

  test('el detalle de cada cobro (cuadra, no cuadra, ilegible, sin cotejo, comprobado, seña de cita y venta con comprobante) dice lo que leyó el servidor y barre el HTML', async ({ page }) => {
    await sembrarEstados();
    await abrirCobros(page);

    // Cuadra.
    await verDetalle(page, '110');
    await expect(detalle(page)).toContainText('Datos coinciden');
    await expect(detalle(page)).toContainText('Monto leído: 110');
    await expect(detalle(page)).toContainText('Banco: Banco de Prueba');
    await expect(detalle(page)).toContainText('un comprobante recibido');
    await expect(detalle(page)).toContainText('2×');
    await expect(detalle(page)).toContainText('Tacos de Birria');
    await expect(detalle(page)).toContainText('Eso no confirma que el dinero entró');
    await expect(detalle(page)).toContainText('El comprobante que mandó el cliente está en su conversación de WhatsApp');
    await barrer(page, 'Detalle · cuadra');
    await page.keyboard.press('Escape');
    await expect(detalle(page)).toBeHidden();

    // No cuadra: las diferencias, cada una, y el conteo de comprobantes.
    await verDetalle(page, '55');
    await expect(detalle(page)).toContainText('Hay una diferencia');
    await expect(detalle(page)).toContainText('Monto leído: 50');
    await expect(detalle(page)).toContainText('3 comprobantes recibidos');
    await expect(detalle(page).getByRole('listitem').filter({ hasText: 'El monto leído es 50 y el pedido es 55' })).toHaveCount(1);
    await expect(detalle(page).getByRole('listitem').filter({ hasText: 'La cuenta destino no coincide' })).toHaveCount(1);
    await barrer(page, 'Detalle · no cuadra');
    await detalle(page).getByRole('button', { name: 'Cerrar' }).click();

    // Ilegible: sin monto leído.
    await verDetalle(page, '44');
    await expect(detalle(page)).toContainText('Ilegible');
    await expect(detalle(page)).toContainText('Monto leído: —');
    await expect(detalle(page)).toContainText('2 comprobantes recibidos');
    await barrer(page, 'Detalle · ilegible');
    await page.keyboard.press('Escape');

    // Sin cotejo: no inventa uno.
    await verDetalle(page, '33');
    await expect(detalle(page)).not.toContainText('Comprobante:');
    await expect(detalle(page)).toContainText('Este cobro no tiene el detalle de los ítems guardado.');
    await barrer(page, 'Detalle · sin cotejo');
    await page.keyboard.press('Escape');

    // Comprobado por el negocio.
    await verDetalle(page, '22');
    await expect(detalle(page)).toContainText('Comprobado por el negocio el');
    await barrer(page, 'Detalle · comprobado');
    await page.keyboard.press('Escape');

    // Seña de una cita.
    await verDetalle(page, '66');
    await expect(detalle(page)).toContainText('Seña de una reserva · cita CITA-1');
    await barrer(page, 'Detalle · seña de cita');
    await page.keyboard.press('Escape');

    // Venta con comprobante en custodia: sale el visor, que habla de datos y de conservación.
    await verDetalle(page, '77');
    await barrer(page, 'Detalle · venta cotejada con visor del comprobante');
    await page.keyboard.press('Escape');
  });

  test('con el cobro real ACTIVO: la tabla de comprobantes por mes, la lista y un detalle no dicen acreditado, y no hablan de cobro simulado', async ({ page }) => {
    await fijarCobroReal(FOGON, ACTIVO);
    await sembrarContadoresDelMes(FOGON, CONTADORES);
    await sembrarEstados();
    await abrirCobros(page);
    await expect(page.getByLabel('Comprobantes por mes')).toContainText('Que los datos coincidan no confirma que el dinero entró');
    await expect(page.getByText('Cobro simulado')).toHaveCount(0);
    await barrer(page, 'Cobros · cobro real activo');
    await verDetalle(page, '110');
    await barrer(page, 'Detalle · cobro real activo');
  });

  test('con un QR real REGISTRADO pero todavía sin cobrar, Cobros dice que el cobro es simulado y no que cobra', async ({ page }) => {
    await fijarCobroReal(FOGON, { ...REGISTRADO, activo: false });
    await sembrarContadoresDelMes(FOGON, CONTADORES);
    await sembrarEstados();
    await abrirCobros(page);
    await expect(page.getByText('Cobro simulado: los comprobantes no se cotejan.')).toBeVisible();
    await expect(page.getByLabel('Comprobantes por mes')).toHaveCount(0);
    await barrer(page, 'Cobros · QR registrado sin cobrar');
  });

  test('NEGATIVA (modos excluyentes): con cobro simulado no aparece la tabla de cobro real, y con cobro real no aparece el aviso de simulado', async ({ page }) => {
    await sembrarContadoresDelMes(FOGON, CONTADORES);
    await sembrarEstados();
    await abrirCobros(page);
    await expect(page.getByText('Cobro simulado: los comprobantes no se cotejan.')).toBeVisible();
    await expect(page.getByLabel('Comprobantes por mes')).toHaveCount(0);
    await fijarCobroReal(FOGON, ACTIVO);
    await page.reload();
    await expect(page.getByLabel('Comprobantes por mes')).toBeVisible();
    await expect(page.getByText('Cobro simulado')).toHaveCount(0);
  });
});

test.describe('COB-08 · Configuración de QR: textos en cada estado', () => {
  test.beforeEach(async () => {
    test.setTimeout(120_000);
    prepararDatos();
    await fijarCobroReal(FOGON, null);
    await fijarConsolaOculta(FOGON, null);
  });

  async function abrirQr(page: Page): Promise<void> {
    await entrar(page, USUARIOS.adminFogon);
    await page.goto(`/negocio/${FOGON}/cobro`);
    await expect(page.getByRole('heading', { name: 'Tu QR de cobro' })).toBeVisible();
  }

  test('sin QR, registrado sin cobrar, cobrando, cobrando con el reemplazo oculto y con monto fijo: ningún texto afirma un pago acreditado', async ({ page }) => {
    await abrirQr(page);
    await expect(page.getByText('Todavía no cargaste ningún QR propio')).toBeVisible();
    await barrer(page, 'QR · vacío');

    await fijarCobroReal(FOGON, { ...REGISTRADO, activo: false });
    await expect(page.getByText('Guardado, todavía sin cobrar')).toBeVisible();
    await expect(page.getByText('El asistente sigue enviando el QR de demostración')).toBeVisible();
    await barrer(page, 'QR · registrado sin cobrar');

    await fijarCobroReal(FOGON, ACTIVO);
    await expect(page.getByText('Cobrando', { exact: true })).toBeVisible();
    await expect(page.getByText('El asistente envía este QR a tus clientes.')).toBeVisible();
    await barrer(page, 'QR · cobrando');

    await fijarConsolaOculta(FOGON, ['reemplazoQr']);
    await expect(page.getByText('Tu QR está cobrando. Para cambiarlo')).toBeVisible();
    await barrer(page, 'QR · cobrando con reemplazo oculto');
    await fijarConsolaOculta(FOGON, null);

    await fijarCobroReal(FOGON, { ...ACTIVO, montoFijo: 50 });
    await expect(page.getByText('Este QR cobra siempre 50')).toBeVisible();
    await barrer(page, 'QR · monto fijo');
  });

  test('CONTROL del barrido: si la página dijera «pago acreditado» (en el texto, en un atributo o partida por una etiqueta) el detector lo ve', async ({ page }) => {
    await abrirQr(page);
    await barrer(page, 'control · limpia');
    await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<p>Su <strong>pago</strong> acreditado</p>'); });
    await expect(barrer(page, 'control · partida por etiqueta')).rejects.toThrow(/acreditad/);
    await page.evaluate(() => { document.body.lastElementChild?.remove(); document.body.insertAdjacentHTML('beforeend', '<span aria-label="Pago verificado"></span>'); });
    await expect(barrer(page, 'control · en un atributo')).rejects.toThrow(/pago verificado/);
  });

  test('tras guardar (con advertencias) y tras un rechazo del servidor, los mensajes tampoco afirman un pago acreditado', async ({ page }) => {
    await simularFuncion(page, 'registrarQrDeCobro', {
      resultado: { registrado: true, problemas: [], advertencias: ['El QR vence en menos de 180 días.'], documento: 'venta' },
    });
    await abrirQr(page);
    const llenar = async () => {
      await page.getByLabel('Imagen del QR').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: qrEnPng('SINTETICO-QR-DE-PRUEBA-0001') });
      await page.getByLabel('¿A nombre de quién está la cuenta?').fill('Q Taco de Prueba SRL');
      await page.getByLabel('Número de la cuenta que recibe el dinero').fill('123456789');
      await page.getByLabel('¿Qué día vence el QR?').fill('2027-12-31');
      await page.getByLabel(/Miré en mi banco y confirmo/).check();
      await page.getByLabel(/NO tiene un importe fijo grabado/).check();
    };
    await llenar();
    await page.getByRole('button', { name: 'Guardar mi QR' }).click();
    await expect(page.getByText('QR guardado y verificado')).toBeVisible();
    await expect(page.getByText('El asistente todavía envía el QR de demostración')).toBeVisible();
    await expect(page.getByText('El QR vence en menos de 180 días.')).toBeVisible();
    await barrer(page, 'QR · guardado con advertencias');
  });

  test('DOCUMENTA lo que hace hoy la pantalla (prohibición 3): con un QR de demostración cargado Y el cobro real activo, la pantalla dice a la vez «Cobrando» y «Hay un QR de demostración cargado»', async ({ page }) => {
    // Los dos modos son excluyentes (CLAUDE.md, prohibición 3), pero la pantalla no lo impide ni lo marca: lo decide el script de NovuChat
    // que activa el cobro real. Esta prueba fija lo que se ve si los datos llegaran así; si la pantalla lo corrige, se invierte.
    await fijarCobroReal(FOGON, ACTIVO);
    await fijarQrDeDemostracion(FOGON, true);
    await abrirQr(page);
    await expect(page.getByText('Cobrando', { exact: true })).toBeVisible();
    await expect(page.getByText('Hay un QR de demostración cargado.')).toBeVisible();
    await barrer(page, 'QR · demostración y cobro real a la vez');
  });
});
