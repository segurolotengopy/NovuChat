import { test } from '@playwright/test';
import { USUARIOS } from './entorno';
import { expect, ingresar } from './ayudas/o2-ingresar';
import { crearUsuarioDeEnsayo, fijarModulos, limpiarPedidos, sembrarPedido } from './ayudas/datos';
import { leerDescargaCsv, type CsvLeido } from './ayudas/o2-csv';

/**
 * CARRIL 2 · PED-04: exportar los pedidos a CSV (`web/src/central/lib/exportar.ts`).
 * Columnas y datos del archivo descargado, y la neutralización de fórmulas (R3 de la matriz): una celda de TEXTO que empieza con
 * `=`, `+`, `-`, `@`, tabulación o retorno lleva un `'` delante. Con las cabeceras reales, en `o2-pedidos-csv.cabeceras.spec.ts`.
 */
const FOGON = 'parrilla-el-fogon';
const COLUMNAS = ['Cuándo', 'Cliente', 'Entrega', 'Dirección', 'Referencia', 'Ítems', 'Nota', 'Total', 'Moneda', 'Estado'];
const FORMULA = '=HYPERLINK("http://x","clic")';

test.describe.configure({ timeout: 90_000 });

async function exportar(page: import('@playwright/test').Page, cantidad: number): Promise<{ nombre: string; csv: CsvLeido }> {
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: `Exportar (${cantidad})` }).click()]);
  return { nombre: descarga.suggestedFilename(), csv: await leerDescargaCsv(descarga) };
}

async function abrirPedidos(page: import('@playwright/test').Page, correo: string = USUARIOS.adminFogon): Promise<void> {
  await ingresar(page, correo);
  await page.getByRole('link', { name: 'Pedidos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
}

/** La fila del archivo cuyo «Cliente» es `cliente`, como objeto columna → valor. */
function fila(csv: CsvLeido, cliente: string): Record<string, string> {
  const [cabecera, ...datos] = csv.filas;
  const f = datos.find((d) => d[1] === cliente || d[1] === `'${cliente}`);
  if (!f) throw new Error(`No hay una fila con Cliente «${cliente}» en: ${datos.map((d) => d[1]).join(', ')}`);
  return Object.fromEntries((cabecera as string[]).map((c, i) => [c, f[i] ?? '']));
}

test.describe('PED-04: exportar pedidos a CSV', () => {
  test.beforeAll(async () => {
    await crearUsuarioDeEnsayo({ uid: 'u-o2-oper-fogon', correo: USUARIOS.operadorFogon, nombre: 'Cocinero de prueba', tenantId: FOGON, rol: 'oper' });
  });
  test.beforeEach(async () => {
    await limpiarPedidos(FOGON);
    await fijarModulos(FOGON, null);
  });

  test('el archivo trae `sep=;`, BOM, las diez columnas y los datos del pedido', async ({ page }) => {
    await sembrarPedido(FOGON, {
      id: 'c1', total: 165, entrega: 'delivery', direccion: 'Av. Banzer 1234', referencia: 'A media cuadra del surtidor', nota: 'Tocar el timbre',
      telefonoEnmascarado: '*** 0101',
      items: [{ nombre: 'Tacos al Pastor', cantidad: 3, detalle: 'sin cebolla' }, { nombre: 'Horchata', cantidad: 1 }],
    });
    await sembrarPedido(FOGON, { id: 'c2', total: 58, entrega: 'retiro', telefonoEnmascarado: '*** 0102', items: [{ nombre: 'Nachos', cantidad: 1 }] });
    await abrirPedidos(page);
    const { nombre, csv } = await exportar(page, 2);

    const hoy = new Date().toISOString().slice(0, 10);
    const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    expect(nombre).toMatch(/^pedidos-\d{4}-\d{2}-\d{2}\.csv$/);
    expect([hoy, ayer]).toContain(nombre.slice(8, 18));
    expect(csv.conBom).toBe(true);
    expect(csv.separador).toBe(';');
    expect(csv.crudo.endsWith('\r\n')).toBe(true);
    expect(csv.filas[0]).toEqual(COLUMNAS);
    expect(csv.filas).toHaveLength(3);
    for (const f of csv.filas) expect(f, 'todas las filas con las diez celdas').toHaveLength(COLUMNAS.length);

    const a = fila(csv, '*** 0101');
    expect(a['Entrega']).toBe('🛵 Enviar a domicilio');
    expect(a['Dirección']).toBe('Av. Banzer 1234');
    expect(a['Referencia']).toBe('A media cuadra del surtidor');
    expect(a['Ítems']).toBe('3× Tacos al Pastor (sin cebolla) · 1× Horchata');
    expect(a['Nota']).toBe('Tocar el timbre');
    expect(a['Total']).toBe('165');
    expect(a['Moneda']).toBe('Bs');
    expect(a['Estado']).toBe('nuevo');
    expect(a['Cuándo']).not.toBe('');

    const b = fila(csv, '*** 0102');
    expect(b['Entrega']).toBe('🏪 Retira en el local');
    expect(b['Dirección']).toBe('');
    expect(b['Referencia']).toBe('');
    expect(b['Nota']).toBe('');
    expect(b['Total']).toBe('58');
    // Del más nuevo al más viejo, como en pantalla.
    expect(csv.filas[1]?.[1]).toBe('*** 0102');
  });

  test('el archivo coincide con lo que se ve: ni de más ni de menos, y el operador baja lo mismo', async ({ page }) => {
    for (let i = 1; i <= 5; i += 1) {
      await sembrarPedido(FOGON, { id: `c${i}`, total: i * 10, entrega: 'retiro', telefonoEnmascarado: `*** 020${i}`, items: [{ nombre: `Plato ${i}`, cantidad: i }] });
    }
    await abrirPedidos(page, USUARIOS.operadorFogon);
    await expect(page.locator('li.pedido')).toHaveCount(5);
    const { csv } = await exportar(page, 5);
    expect(csv.filas).toHaveLength(6);
    expect(csv.filas.slice(1).map((f) => f[5])).toEqual(['5× Plato 5', '4× Plato 4', '3× Plato 3', '2× Plato 2', '1× Plato 1']);
  });

  test('NEGATIVA (fórmulas): `=HYPERLINK(...)` en la nota, la dirección y la referencia sale neutralizado, con un apóstrofo delante', async ({ page }) => {
    await sembrarPedido(FOGON, {
      id: 'f1', total: 20, entrega: 'delivery', telefonoEnmascarado: '*** 0301', direccion: FORMULA, referencia: FORMULA, nota: FORMULA,
      items: [{ nombre: 'Taco', cantidad: 1 }],
    });
    await abrirPedidos(page);
    const { csv } = await exportar(page, 1);
    const f = fila(csv, '*** 0301');
    expect(f['Dirección']).toBe(`'${FORMULA}`);
    expect(f['Referencia']).toBe(`'${FORMULA}`);
    expect(f['Nota']).toBe(`'${FORMULA}`);
    // En el archivo crudo, cada celda con fórmula arranca con comilla + apóstrofo, nunca con comilla + signo igual.
    expect(csv.crudo).not.toMatch(/"=HYPERLINK/);
    expect(csv.crudo.match(/"'=HYPERLINK\(""http:\/\/x"",""clic""\)"/g)).toHaveLength(3);
  });

  for (const [nombre, inicio] of [['igual', '='], ['más', '+'], ['menos', '-'], ['arroba', '@'], ['tabulación', '\t'], ['retorno de carro', '\r']] as const) {
    test(`NEGATIVA (fórmulas): una nota que empieza con «${nombre}» sale neutralizada`, async ({ page }) => {
      await sembrarPedido(FOGON, { id: 'g1', total: 20, entrega: 'retiro', telefonoEnmascarado: '*** 0302', nota: `${inicio}cmd|' /C calc'!A0`, items: [{ nombre: 'Taco', cantidad: 1 }] });
      await abrirPedidos(page);
      const { csv } = await exportar(page, 1);
      expect(fila(csv, '*** 0302')['Nota']).toBe(`'${inicio}cmd|' /C calc'!A0`);
    });
  }

  test('NEGATIVA (fórmulas): ninguna celda de ninguna columna del archivo empieza con un carácter de fórmula', async ({ page }) => {
    const peligrosos = ['=1+1', '+59170000031', '-17.78346, -63.18212', '@SUM(A1)', '\t=1', '\r=1', "'=1", FORMULA];
    for (const [i, p] of peligrosos.entries()) {
      await sembrarPedido(FOGON, {
        id: `h${i}`, total: 10 + i, entrega: 'delivery', telefonoEnmascarado: `*** 04${String(i).padStart(2, '0')}`,
        direccion: p, referencia: p, nota: p, items: [{ nombre: p, cantidad: 1, detalle: p }],
      });
    }
    // También el campo Cliente, que es texto del servidor pero llega por el pedido.
    await sembrarPedido(FOGON, { id: 'hc', total: 5, entrega: 'retiro', telefonoEnmascarado: '=1+1', items: [{ nombre: 'Taco', cantidad: 1 }] });
    await abrirPedidos(page);
    const { csv } = await exportar(page, peligrosos.length + 1);
    const datos = csv.filas.slice(1);
    expect(datos).toHaveLength(peligrosos.length + 1);
    for (const f of datos) {
      for (const [col, celda] of f.entries()) {
        expect(celda, `columna «${COLUMNAS[col]}» sin neutralizar: ${JSON.stringify(celda)}`).not.toMatch(/^[=+\-@\t\r]/);
      }
    }
    expect(datos.find((f) => f[1] === `'=1+1`), 'el Cliente «=1+1» llegó neutralizado').toBeTruthy();
  });

  test('lo que no es peligroso NO se toca: texto normal, un signo en el medio y un monto negativo (es un número, no una fórmula)', async ({ page }) => {
    await sembrarPedido(FOGON, {
      id: 'n1', total: -5, entrega: 'retiro', telefonoEnmascarado: '*** 0501', direccion: 'Calle 21 de Calacoto', nota: 'sin picante = mejor, 2+2 y a@b.com',
      items: [{ nombre: 'Taco', cantidad: 1 }],
    });
    await abrirPedidos(page);
    const { csv } = await exportar(page, 1);
    const f = fila(csv, '*** 0501');
    expect(f['Dirección']).toBe('Calle 21 de Calacoto');
    expect(f['Nota']).toBe('sin picante = mejor, 2+2 y a@b.com');
    expect(f['Total']).toBe('-5');
  });

  test('NEGATIVA (estructura): punto y coma, comillas y saltos de línea dentro de una nota no parten la fila', async ({ page }) => {
    const rara = 'dos;campos "entre comillas"\nsegunda línea; fin';
    await sembrarPedido(FOGON, { id: 'e1', total: 7, entrega: 'retiro', telefonoEnmascarado: '*** 0601', nota: rara, items: [{ nombre: 'Taco', cantidad: 1 }] });
    await sembrarPedido(FOGON, { id: 'e2', total: 8, entrega: 'retiro', telefonoEnmascarado: '*** 0602', nota: 'normal', items: [{ nombre: 'Taco', cantidad: 1 }] });
    await abrirPedidos(page);
    const { csv } = await exportar(page, 2);
    expect(csv.filas).toHaveLength(3);
    expect(fila(csv, '*** 0601')['Nota']).toBe(rara);
    expect(fila(csv, '*** 0602')['Nota']).toBe('normal');
  });

  test('NEGATIVA (HTML): el texto hostil llega al archivo como texto, sin transformarse', async ({ page }) => {
    const html = '<img src=x onerror="window.__xss=1"> javascript:alert(1)';
    await sembrarPedido(FOGON, { id: 'x1', total: 7, entrega: 'delivery', telefonoEnmascarado: '*** 0701', direccion: html, referencia: html, nota: html, items: [{ nombre: 'Taco', cantidad: 1 }] });
    await abrirPedidos(page);
    const { csv } = await exportar(page, 1);
    const f = fila(csv, '*** 0701');
    expect(f['Dirección']).toBe(html);
    expect(f['Nota']).toBe(html);
    expect(f['Referencia']).toBe(html);
  });

  test('NEGATIVA (aislamiento): el archivo de un comercio no lleva pedidos de otro', async ({ page }) => {
    await sembrarPedido('salon-aurora', { id: 'au1', total: 9, entrega: 'retiro', telefonoEnmascarado: '*** 0801', items: [{ nombre: 'Secreto de Aurora', cantidad: 1 }] });
    await sembrarPedido(FOGON, { id: 'fo1', total: 9, entrega: 'retiro', telefonoEnmascarado: '*** 0802', items: [{ nombre: 'Costillas', cantidad: 1 }] });
    try {
      await abrirPedidos(page);
      const { csv } = await exportar(page, 1);
      expect(csv.crudo).toContain('Costillas');
      expect(csv.crudo).not.toContain('Secreto de Aurora');
    } finally {
      await limpiarPedidos('salon-aurora');
    }
  });
});
