import { test } from '@playwright/test';
import { USUARIOS } from './entorno';
import { expect, ingresar } from './ayudas/o2-ingresar';
import { crearUsuarioDeEnsayo, fijarModulos, limpiarPedidos, sembrarPedido } from './ayudas/datos';
import { fijarEstadoDelComercio, sembrarMuchosPedidos } from './ayudas/o2-datos';

/**
 * CARRIL 2 · PED-01 (lista en vivo, también con sesión de operador) y PED-02 (la tarjeta del pedido, con la referencia del cliente).
 * La ubicación (PED-03), el CSV (PED-04) y el teléfono (PED-06) tienen su propio archivo.
 */
const FOGON = 'parrilla-el-fogon';
const AURORA = 'salon-aurora';

// Con la máquina cargada por los otros carriles, el tiempo de cada prueba (siembra, inicio de sesión) se estira: tolerancia de tiempo, no de comprobaciones.
test.describe.configure({ timeout: 90_000 });

async function abrirPedidos(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('link', { name: 'Pedidos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
}

test.describe('PED-01: la lista de pedidos en vivo, con sesión de operador', () => {
  test.beforeAll(async () => {
    await crearUsuarioDeEnsayo({ uid: 'u-o2-oper-fogon', correo: USUARIOS.operadorFogon, nombre: 'Cocinero de prueba', tenantId: FOGON, rol: 'oper' });
  });
  test.beforeEach(async () => {
    await limpiarPedidos(FOGON);
    await limpiarPedidos(AURORA);
    await fijarModulos(FOGON, null);
    await fijarEstadoDelComercio(FOGON, 'activo');
  });
  test.afterEach(async () => {
    await fijarModulos(FOGON, null);
    await fijarEstadoDelComercio(FOGON, 'activo');
  });

  test('el cocinero (operador) abre Pedidos, ve el vacío y el primer pedido aparece solo, sin recargar', async ({ page }) => {
    await ingresar(page, USUARIOS.operadorFogon);
    await abrirPedidos(page);
    await expect(page.getByText('Todavía no hay pedidos')).toBeVisible();
    // Sin pedidos no se ofrece exportar un archivo vacío.
    await expect(page.getByRole('button', { name: /Exportar/ })).toHaveCount(0);

    await sembrarPedido(FOGON, { id: 'o1', items: [{ nombre: 'Tacos de Birria', cantidad: 2, detalle: 'sin cebolla' }], total: 110, entrega: 'retiro' });
    await expect(page.locator('li.pedido')).toHaveCount(1);
    await expect(page.locator('li.pedido')).toContainText('Tacos de Birria');
    await expect(page.locator('li.pedido em.pedido-detalle')).toHaveText('sin cebolla');
    await expect(page.getByText('Todavía no hay pedidos')).toBeHidden();
    await expect(page.getByRole('button', { name: /Exportar \(1\)/ })).toBeVisible();
  });

  test('el operador ve Pedidos y Conversaciones, pero ninguna pestaña de administración', async ({ page }) => {
    await ingresar(page, USUARIOS.operadorFogon);
    await expect(page.getByRole('link', { name: 'Pedidos', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Conversaciones', exact: true })).toBeVisible();
    for (const pestana of ['Configuración', 'Productos', 'Campañas', 'Usuarios', 'Cuenta']) {
      await expect(page.getByRole('link', { name: pestana, exact: true }), `el operador no debería ver «${pestana}»`).toHaveCount(0);
    }
  });

  test('el operador también exporta y la descarga trae el pedido', async ({ page }) => {
    await sembrarPedido(FOGON, { id: 'o2', items: [{ nombre: 'Nachos', cantidad: 1 }], total: 58, entrega: 'retiro' });
    await ingresar(page, USUARIOS.operadorFogon);
    await abrirPedidos(page);
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Exportar \(1\)/ }).click()]);
    expect(descarga.suggestedFilename()).toMatch(/^pedidos-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test('del más nuevo al más viejo, y uno que llega en vivo se pone ARRIBA', async ({ page }) => {
    await sembrarPedido(FOGON, { id: 'v1', items: [{ nombre: 'Primero del día', cantidad: 1 }], total: 10, entrega: 'retiro' });
    await new Promise((r) => setTimeout(r, 30));
    await sembrarPedido(FOGON, { id: 'v2', items: [{ nombre: 'Segundo del día', cantidad: 1 }], total: 20, entrega: 'retiro' });
    await ingresar(page, USUARIOS.operadorFogon);
    await abrirPedidos(page);
    const tarjetas = page.locator('li.pedido');
    await expect(tarjetas).toHaveCount(2);
    await expect(tarjetas.nth(0)).toContainText('Segundo del día');
    await expect(tarjetas.nth(1)).toContainText('Primero del día');

    await new Promise((r) => setTimeout(r, 30));
    await sembrarPedido(FOGON, { id: 'v3', items: [{ nombre: 'Tercero en vivo', cantidad: 1 }], total: 30, entrega: 'delivery' });
    await expect(tarjetas).toHaveCount(3);
    await expect(tarjetas.nth(0)).toContainText('Tercero en vivo');
  });

  test('NEGATIVA (tope): con 101 pedidos solo se muestran los 100 más nuevos', async ({ page }) => {
    await sembrarMuchosPedidos(FOGON, 101);
    await ingresar(page, USUARIOS.operadorFogon);
    await abrirPedidos(page);
    await expect(page.locator('li.pedido')).toHaveCount(100);
    await expect(page.getByRole('button', { name: 'Exportar (100)' })).toBeVisible();
    await expect(page.locator('li.pedido').first()).toContainText('Plato numero 101');
    await expect(page.getByText('Plato numero 2', { exact: true })).toBeVisible();
    // El más viejo (el 1º) queda fuera del corte.
    await expect(page.getByText('Plato numero 1', { exact: true })).toHaveCount(0);
  });

  test('la pantalla avisa que los pedidos tomados conversando no están aquí', async ({ page }) => {
    await ingresar(page, USUARIOS.operadorFogon);
    await abrirPedidos(page);
    await expect(page.getByText('Por ahora aparecen los pedidos hechos desde el catálogo web.')).toBeVisible();
    await expect(page.getByText('Los que el asistente toma conversando están en «Conversaciones».')).toBeVisible();
  });

  test('NEGATIVA (aislamiento): el operador de otro comercio no ve los pedidos de este, ni por la dirección directa', async ({ page }) => {
    await sembrarPedido(FOGON, { id: 'f1', items: [{ nombre: 'Costillas del Fogon', cantidad: 1 }], total: 80, entrega: 'retiro' });
    await sembrarPedido(AURORA, { id: 'a1', items: [{ nombre: 'Servicio de Aurora', cantidad: 1 }], total: 50, entrega: 'retiro' });
    await ingresar(page, USUARIOS.operadorAurora);
    // Aurora es una agenda: no tiene la pestaña. Si abre la ruta de los suyos, ve solo lo suyo.
    await expect(page.getByRole('link', { name: 'Pedidos', exact: true })).toHaveCount(0);
    await page.goto(`/negocio/${AURORA}/pedidos`);
    await expect(page.getByText('Servicio de Aurora')).toBeVisible();
    await expect(page.getByText('Costillas del Fogon')).toHaveCount(0);

    // La ruta de Fogon la cierra el guardia de la consola (y, detrás, las reglas del servidor).
    await page.goto(`/negocio/${FOGON}/pedidos`);
    await expect(page.getByText('Sin permiso')).toBeVisible();
    await expect(page.getByText('Costillas del Fogon')).toHaveCount(0);
    await expect(page.locator('li.pedido')).toHaveCount(0);
  });

  test('NEGATIVA (sin módulo): si el comercio no tiene Pedidos, el operador no ve la pestaña', async ({ page }) => {
    await fijarModulos(FOGON, ['productos']);
    await ingresar(page, USUARIOS.operadorFogon);
    await expect(page.getByRole('link', { name: 'Conversaciones', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pedidos', exact: true })).toHaveCount(0);
  });

  test('NEGATIVA (error de lectura): si el servidor rechaza la lectura, la pantalla lo dice y no muestra pedidos', async ({ page }) => {
    await sembrarPedido(FOGON, { id: 'e1', items: [{ nombre: 'No debería verse', cantidad: 1 }], total: 5, entrega: 'retiro' });
    await fijarEstadoDelComercio(FOGON, 'baja');
    await ingresar(page, USUARIOS.operadorFogon);
    await page.goto(`/negocio/${FOGON}/pedidos`);
    await expect(page.getByRole('alert')).toContainText('No se pudieron leer los pedidos.');
    await expect(page.getByText('No debería verse')).toHaveCount(0);
    await expect(page.getByText('Todavía no hay pedidos')).toHaveCount(0);
  });
});

test.describe('PED-02: la tarjeta del pedido', () => {
  test.beforeEach(async () => {
    await limpiarPedidos(FOGON);
    await fijarModulos(FOGON, null);
  });

  async function abrirComoAdmin(page: import('@playwright/test').Page): Promise<void> {
    await ingresar(page, USUARIOS.adminFogon);
    await abrirPedidos(page);
  }

  test('un delivery muestra entrega, dirección, REFERENCIA, ítems con su detalle, nota y total con moneda', async ({ page }) => {
    await sembrarPedido(FOGON, {
      id: 't1', total: 165, entrega: 'delivery', direccion: 'Av. Banzer 1234', referencia: 'A media cuadra del surtidor, portón verde',
      nota: 'Tocar el timbre dos veces',
      items: [{ nombre: 'Tacos al Pastor', cantidad: 3, detalle: 'sin cebolla' }, { nombre: 'Horchata', cantidad: 1 }],
    });
    await abrirComoAdmin(page);
    const tarjeta = page.locator('li.pedido').first();
    await expect(tarjeta).toContainText('Enviar a domicilio');
    await expect(tarjeta).toContainText('Av. Banzer 1234');
    await expect(tarjeta.locator('p.pedido-direccion').filter({ hasText: 'Referencia:' })).toHaveText('Referencia: A media cuadra del surtidor, portón verde');
    const items = tarjeta.locator('ul.pedido-items > li');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('3×');
    await expect(items.nth(0)).toContainText('Tacos al Pastor');
    await expect(items.nth(0).locator('em.pedido-detalle')).toHaveText('sin cebolla');
    await expect(items.nth(1)).toContainText('1×');
    await expect(items.nth(1).locator('em.pedido-detalle')).toHaveCount(0);
    await expect(tarjeta.locator('p.pedido-nota')).toHaveText('Tocar el timbre dos veces');
    await expect(tarjeta.locator('.pedido-total')).toHaveText(/165\s*Bs/);
  });

  test('un retiro muestra «Retira en el local», sin dirección ni referencia', async ({ page }) => {
    await sembrarPedido(FOGON, { id: 't2', total: 58, entrega: 'retiro', items: [{ nombre: 'Nachos', cantidad: 1 }] });
    await abrirComoAdmin(page);
    const tarjeta = page.locator('li.pedido').first();
    await expect(tarjeta).toContainText('Retira en el local');
    await expect(tarjeta.locator('p.pedido-direccion')).toHaveCount(0);
    await expect(tarjeta.locator('p.pedido-nota')).toHaveCount(0);
  });

  test('NEGATIVA: sin referencia (los pedidos anteriores) la línea «Referencia» no aparece y el resto queda igual', async ({ page }) => {
    await sembrarPedido(FOGON, { id: 't3', total: 70, entrega: 'delivery', direccion: 'Calle Sucre 55', items: [{ nombre: 'Costillas', cantidad: 1 }] });
    await sembrarPedido(FOGON, { id: 't3b', total: 71, entrega: 'delivery', direccion: 'Calle Sucre 56', referencia: '', items: [{ nombre: 'Costillas', cantidad: 1 }] });
    await abrirComoAdmin(page);
    await expect(page.locator('li.pedido')).toHaveCount(2);
    await expect(page.getByText('Referencia:')).toHaveCount(0);
    await expect(page.locator('li.pedido').first()).toContainText('Calle Sucre 5');
  });

  test('NEGATIVA: un pedido sin ítems dice «Sin detalle de ítems.» y no rompe la lista', async ({ page }) => {
    await sembrarPedido(FOGON, { id: 't4', total: 12, entrega: 'retiro', items: [] });
    await sembrarPedido(FOGON, { id: 't4b', total: 13, entrega: 'retiro', items: [{ nombre: 'Café', cantidad: 1 }] });
    await abrirComoAdmin(page);
    await expect(page.locator('li.pedido')).toHaveCount(2);
    await expect(page.getByText('Sin detalle de ítems.')).toBeVisible();
    await expect(page.getByText('Café')).toBeVisible();
  });

  test('la modalidad de entrega se ve ANTES que el monto (lo que manda la pantalla del cocinero)', async ({ page }) => {
    test.fail(true, 'PED-02 (matriz: «Modalidad antes del monto»; el comentario de Pedidos.tsx dice lo mismo): hoy el total va en la cabecera, ARRIBA de la modalidad. A decidir por la Cartera si basta o hay que reordenar.');
    await sembrarPedido(FOGON, { id: 't5', total: 99, entrega: 'delivery', direccion: 'Av. Banzer 1', items: [{ nombre: 'Taco', cantidad: 1 }] });
    await abrirComoAdmin(page);
    const tarjeta = page.locator('li.pedido').first();
    const entrega = await tarjeta.locator('p.pedido-entrega').boundingBox();
    const total = await tarjeta.locator('.pedido-total').boundingBox();
    expect(entrega && total && entrega.y).toBeLessThan(total!.y);
  });

  test('NEGATIVA (texto hostil): HTML, javascript: y fórmulas en nota, dirección, referencia e ítem se ven como texto, no se ejecutan', async ({ page }) => {
    const hostilHtml = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
    const hostilJs = '<a href="javascript:window.__xss=3">clic aquí</a> javascript:window.__xss=4';
    const dialogos: string[] = [];
    page.on('dialog', (d) => { dialogos.push(d.message()); void d.dismiss(); });
    await sembrarPedido(FOGON, {
      id: 't6', total: 10, entrega: 'delivery', direccion: hostilJs, referencia: hostilHtml, nota: `${hostilHtml} ${hostilJs}`,
      items: [{ nombre: hostilHtml, cantidad: 1, detalle: hostilJs }],
    });
    await abrirComoAdmin(page);
    const tarjeta = page.locator('li.pedido').first();
    await expect(tarjeta.locator('p.pedido-direccion').first()).toHaveText(hostilJs);
    await expect(tarjeta.locator('p.pedido-direccion').filter({ hasText: 'Referencia:' })).toHaveText(`Referencia: ${hostilHtml}`);
    await expect(tarjeta.locator('p.pedido-nota')).toHaveText(`${hostilHtml} ${hostilJs}`);
    await expect(tarjeta.locator('ul.pedido-items')).toContainText(hostilHtml);
    // Ni imágenes, ni scripts, ni un solo enlace nacido de ese texto.
    await expect(tarjeta.locator('img, script, a')).toHaveCount(0);
    await expect(page.locator('a[href^="javascript:" i]')).toHaveCount(0);
    // Hacer clic sobre el texto «enlace» no navega ni ejecuta nada.
    const url = page.url();
    await tarjeta.locator('p.pedido-nota').click();
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    expect(dialogos).toEqual([]);
  });

  test('NEGATIVA: caracteres de control y de dirección bidireccional (Trojan Source) se quitan del texto del cliente', async ({ page }) => {
    await sembrarPedido(FOGON, { id: 't7', total: 10, entrega: 'retiro', nota: 'confirmo ‮odnum‬ ok\u0007', referencia: 'cerca⁦ del gas', items: [{ nombre: 'Taco', cantidad: 1 }] });
    await abrirComoAdmin(page);
    const nota = (await page.locator('li.pedido p.pedido-nota').textContent()) ?? '';
    expect(nota).toBe('confirmo odnum ok');
    expect(nota).not.toMatch(/[‪-‮⁦-⁩\u0000-\u0008]/);
    // La referencia de un retiro igual se muestra: es lo que el cliente escribió.
    await expect(page.getByText('Referencia: cerca del gas')).toBeVisible();
  });

  test('NEGATIVA: una nota de 400 caracteres se recorta a 300 y no deforma la tarjeta', async ({ page }) => {
    await sembrarPedido(FOGON, { id: 't8', total: 10, entrega: 'retiro', nota: 'n'.repeat(400), items: [{ nombre: 'Taco', cantidad: 1 }] });
    await abrirComoAdmin(page);
    expect(((await page.locator('li.pedido p.pedido-nota').textContent()) ?? '').length).toBe(300);
  });
});
