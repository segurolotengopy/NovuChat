import { expect, test, type Page } from '@playwright/test';
import { FICHA_DEL_CATALOGO, URL_CATALOGO } from './entorno';
import { PNG_1X1 } from './ayudas/png';

// El catálogo web público es OTRO sitio de Hosting (target `catalogo`) con su propia política. Aquí corre la compilación real
// (`web/dist-catalogo`) con las cabeceras reales de `firebase.json`, contra los datos de la vista previa
// (`scripts/datos/catalogo-demo.mjs`: el servidor es de mentira, la página es la de producción).
test.use({ baseURL: URL_CATALOGO });
const RUTA = `/c/${FICHA_DEL_CATALOGO}`;
const WHATSAPP_DE_PRUEBA = '59100000031';

/** Hace que la respuesta del catálogo traiga el WhatsApp del comercio (la vista previa no lo manda) y detiene la apertura real de wa.me. */
async function conWhatsApp(page: Page): Promise<void> {
  await page.route(new RegExp(`/api/catalogo/${FICHA_DEL_CATALOGO}$`), async (ruta) => {
    const original = await ruta.fetch();
    const cuerpo = await original.json() as { negocio: Record<string, unknown> };
    cuerpo.negocio['whatsapp'] = WHATSAPP_DE_PRUEBA;
    await ruta.fulfill({ response: original, json: cuerpo });
  });
  await page.route('https://wa.me/**', (ruta) => ruta.fulfill({ status: 200, contentType: 'text/html', body: '<p>chat de prueba</p>' }));
}

function vigilarPolitica(page: Page): string[] {
  const violaciones: string[] = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violaciones.push(m.text()); });
  return violaciones;
}

test.describe('Catálogo web público (cabeceras reales)', () => {
  test('la política y los permisos del sitio del catálogo están puestos', async ({ page }) => {
    const respuesta = await page.goto(RUTA);
    const h = respuesta?.headers() ?? {};
    expect(h['content-security-policy']).toContain("default-src 'none'");
    expect(h['content-security-policy']).toContain("connect-src 'self'");
    expect(h['content-security-policy']).not.toMatch(/connect-src[^;]*\*/);
    // Hoy la geolocalización está cerrada. El PR-B (ubicación en el catálogo) debe abrir SOLO `geolocation=(self)`: ese día esta
    // línea se actualiza junto con el cambio de `firebase.json`, y se prueba además con un navegador real y en un teléfono.
    expect(h['permissions-policy']).toContain('geolocation=()');
  });

  test('carga el catálogo: nombre, ítems con precio, sin violaciones de la política', async ({ page }) => {
    const violaciones = vigilarPolitica(page);
    await page.goto(RUTA);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('strong', { hasText: 'Hamburguesa doble' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Agregar/ }).first()).toBeVisible();
    expect(violaciones, violaciones.join('\n')).toEqual([]);
  });

  test('la foto de un ítem (enlace https) se muestra y la política no la bloquea', async ({ page }) => {
    const violaciones = vigilarPolitica(page);
    await page.route('https://images.pexels.com/**', (ruta) => ruta.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }));
    await page.goto(RUTA);
    const foto = page.locator('li, article, div', { has: page.locator('strong', { hasText: 'Hamburguesa doble' }) }).locator('img').first();
    await expect(foto).toBeVisible();
    expect(await foto.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    expect(violaciones, violaciones.join('\n')).toEqual([]);
  });

  test('buscar y filtrar por área dejan solo lo que corresponde', async ({ page }) => {
    await page.goto(RUTA);
    await page.getByLabel('Buscar en el catálogo').fill('salchipapa');
    await expect(page.locator('strong', { hasText: 'Salchipapa' })).toBeVisible();
    await expect(page.locator('strong', { hasText: 'Hamburguesa doble' })).toHaveCount(0);
  });

  test('carrito: agregar, sumar, restar y quitar; el total y la barra del pedido se mueven', async ({ page }) => {
    await page.goto(RUTA);
    await page.getByRole('button', { name: /^Agregar Hamburguesa doble/ }).click();
    await page.getByRole('button', { name: 'Agregar uno de Hamburguesa doble' }).click();
    await expect(page.locator('.cat-barra')).toContainText('2');
    await page.getByRole('button', { name: 'Quitar uno de Hamburguesa doble' }).click();
    await expect(page.locator('.cat-barra')).toContainText('1');
    await page.getByRole('button', { name: 'Quitar uno de Hamburguesa doble' }).click();
    await expect(page.locator('.cat-barra')).toHaveCount(0);
  });

  test('retiro en el local: confirma sin pedir dirección y manda solo identificadores y cantidades', async ({ page }) => {
    await conWhatsApp(page);
    const cuerpos: unknown[] = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/checkout')) cuerpos.push(r.postDataJSON()); });
    await page.goto(RUTA);
    await page.getByRole('button', { name: /^Agregar Salchipapa/ }).click();
    await page.locator('.cat-barra').click();
    await expect(page.getByRole('heading', { name: 'Tu pedido' })).toBeVisible();
    await page.getByRole('button', { name: 'Retiro en el local' }).click();
    await page.getByRole('button', { name: 'Confirmar el pedido' }).click();
    await expect(page.getByRole('heading', { name: /ya tiene tu pedido/ })).toBeVisible();
    expect(cuerpos).toHaveLength(1);
    expect(cuerpos[0]).toMatchObject({ entrega: 'retiro', items: [{ cantidad: 1 }] });
    expect(JSON.stringify(cuerpos[0])).not.toMatch(/precio|total|monto/i); // el precio lo pone el servidor, nunca el navegador
  });

  test('envío: exige la dirección y la manda junto con la referencia', async ({ page }) => {
    await conWhatsApp(page);
    const cuerpos: unknown[] = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/checkout')) cuerpos.push(r.postDataJSON()); });
    await page.goto(RUTA);
    await page.getByRole('button', { name: /^Agregar Salchipapa/ }).click();
    await page.locator('.cat-barra').click();
    await page.getByRole('button', { name: /^Envío/ }).click();
    const confirmar = page.getByRole('button', { name: 'Confirmar el pedido' });
    await expect(confirmar).toBeDisabled(); // NEGATIVA: sin dirección no se puede confirmar
    await page.getByLabel('¿A dónde lo llevamos?').fill('Av. Banzer 1234, zona Norte');
    await expect(confirmar).toBeEnabled();
    await confirmar.click();
    await expect(page.getByRole('heading', { name: /ya tiene tu pedido/ })).toBeVisible();
    expect(cuerpos[0]).toMatchObject({ entrega: 'envio', direccion: 'Av. Banzer 1234, zona Norte' });
  });

  test('la pantalla final tiene «Volver al chat» con el enlace de WhatsApp del comercio', async ({ page }) => {
    await conWhatsApp(page);
    await page.goto(RUTA);
    await page.getByRole('button', { name: /^Agregar Salchipapa/ }).click();
    await page.locator('.cat-barra').click();
    await page.getByRole('button', { name: 'Retiro en el local' }).click();
    await page.getByRole('button', { name: 'Confirmar el pedido' }).click();
    const volver = page.getByRole('link', { name: 'Volver al chat' });
    await expect(volver).toBeVisible();
    await expect(volver).toHaveAttribute('href', `https://wa.me/${WHATSAPP_DE_PRUEBA}`);
  });

  test('NEGATIVA: si el servidor rechaza el pedido (429) lo dice en palabras del cliente y no pasa a «Listo»', async ({ page }) => {
    await page.route(/\/checkout$/, (ruta) => ruta.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ ok: false }) }));
    await page.goto(RUTA);
    await page.getByRole('button', { name: /^Agregar Salchipapa/ }).click();
    await page.locator('.cat-barra').click();
    await page.getByRole('button', { name: 'Retiro en el local' }).click();
    await page.getByRole('button', { name: 'Confirmar el pedido' }).click();
    await expect(page.getByRole('alert')).toContainText('Ya enviaste varios pedidos con este enlace');
    await expect(page.getByRole('heading', { name: /ya tiene tu pedido/ })).toHaveCount(0);
  });

  test('NEGATIVA: un enlace que no existe dice que ya no está disponible, igual que uno vencido', async ({ page }) => {
    await page.route(new RegExp(`/api/catalogo/${FICHA_DEL_CATALOGO}$`), (ruta) => ruta.fulfill({ status: 404, body: '' }));
    await page.goto(RUTA);
    await expect(page.getByText('Este enlace ya no está disponible')).toBeVisible();
  });

  test('NEGATIVA: un catálogo apagado (409) lo dice distinto', async ({ page }) => {
    await page.route(new RegExp(`/api/catalogo/${FICHA_DEL_CATALOGO}$`), (ruta) => ruta.fulfill({ status: 409, body: '' }));
    await page.goto(RUTA);
    await expect(page.getByText('Este negocio todavía no publicó su catálogo')).toBeVisible();
  });
});
