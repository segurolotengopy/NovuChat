import { expect, test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { limpiarCierres, limpiarConversaciones, sembrarConversacion } from './ayudas/datos';
import { simularFuncion } from './ayudas/funciones';
import prepararDatos from './preparar-datos';

const FOGON = 'parrilla-el-fogon';
const PROHIBIDAS = /acreditad|pagado|verificad|aprobad|recibimos tu pago/i;

async function abrirCobros(page: Page): Promise<void> {
  await ingresar(page, USUARIOS.adminFogon);
  await page.getByRole('link', { name: 'Cobros', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cobros', exact: true }).first()).toBeVisible();
}

const lista = (page: Page) => page.getByRole('article', { name: 'Comprobantes recibidos' });

test.describe('Cobros · comprobantes recibidos', () => {
  test.beforeEach(async () => {
    test.setTimeout(90_000);
    prepararDatos();
    await limpiarCierres(FOGON);
    await limpiarConversaciones(FOGON);
  });

  test('sin comprobantes: estado vacío y el aviso fijo', async ({ page }) => {
    await abrirCobros(page);
    await expect(lista(page).getByText('Todavía no llegó ningún comprobante.')).toBeVisible();
    await expect(lista(page).getByText('NovuChat nunca confirma que el dinero entró: eso lo ve usted en su banco.')).toBeVisible();
  });

  test('lista del más nuevo al más viejo, con estados en palabras simples; «Ver foto» solo con foto y pide la forma nueva', async ({ page }) => {
    const ahora = Date.now();
    await sembrarConversacion(FOGON, '59171000001', [], {
      nombreContacto: 'Ana Rojas',
      solicitud: {
        reglaCobro: 2, monto: 55,
        comprobantes: [
          { idMeta: 'wamid.viejo', estado: 'invalido', motivo: 'monto_menor', en: new Date(ahora - 3_600_000), ruta: 'sintetica/a.jpg', importe: 55, montoLeido: 50 },
        ],
      },
    });
    await sembrarConversacion(FOGON, '59171000002', [], {
      solicitud: {
        reglaCobro: 2, monto: 70,
        comprobantes: [
          { idMeta: 'wamid.nuevo', estado: 'invalido', motivo: 'ilegible', en: new Date(ahora - 60_000), importe: 70 },
        ],
      },
    });
    const llamadas = await simularFuncion(page, 'verComprobante', { resultado: { mime: 'image/png', base64: 'iVBORw0KGgo=' } });
    await abrirCobros(page);

    const filas = lista(page).getByRole('row');
    await expect(filas).toHaveCount(3); // encabezado + 2
    await expect(filas.nth(1)).toContainText('****002');
    await expect(filas.nth(1)).toContainText('Ilegible');
    await expect(filas.nth(1)).toContainText('—');
    await expect(filas.nth(1).getByRole('button', { name: 'Ver foto' })).toHaveCount(0);
    await expect(filas.nth(2)).toContainText('Ana Rojas');
    await expect(filas.nth(2)).toContainText('No coincide el monto');
    await expect(lista(page)).not.toContainText('Comprobado');
    expect(await lista(page).innerText()).not.toMatch(PROHIBIDAS);

    await filas.nth(2).getByRole('button', { name: 'Ver foto' }).click();
    await expect(lista(page).getByRole('img', { name: 'Comprobante que mandó el cliente' })).toBeVisible();
    expect(llamadas.llamadas).toEqual([{ tenantId: FOGON, conversacionId: 'wa_59171000001', idMeta: 'wamid.viejo' }]);
  });
});
