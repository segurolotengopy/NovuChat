import { test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import prepararDatos from './preparar-datos';
import {
  FOGON, catalogoDeQtaco, entrar, esperar as expect, fijarPlanCrecimiento, fijarStock, sembrarCatalogo, sembrarFotoSubida,
  type ItemDeCatalogo,
} from './ayudas/o3-datos';

/**
 * PRO-01 — lista, búsqueda, filtros, orden y paginación del catálogo (`/catalogo`), con la forma de Q'Taco: 79 ítems, 54 activos y 25 de baja,
 * plan Crecimiento y NINGÚN ítem con existencias (Q'Taco no usa inventario). Todo vive en la URL y se puede recargar y compartir.
 * Lo que se espera se CALCULA con `catalogoDeQtaco()`, la misma función que sembró; los totales (79, 54, 25) además se fijan a mano.
 */

const TODOS = catalogoDeQtaco();
const URL_CATALOGO = `/negocio/${FOGON}/catalogo`;

const filas = (page: Page) => page.locator('table.table').first().locator('tbody tr');
const contador = (page: Page) => page.locator('.catalogo-contador');
/** Un control del filtro, por el texto de su rótulo (los rótulos contienen las opciones, por eso no se usa `getByLabel`). */
const control = (page: Page, rotulo: string) =>
  page.locator('.filtros-catalogo label').filter({ hasText: new RegExp(`^${rotulo}`) }).locator('select, input');
const paginadores = (page: Page) => page.getByRole('navigation', { name: 'Páginas del catálogo' });

/** «Mostrando 1–50 de 79» o, con filtros, «… (hay 79 en total)». */
function resumen(n: number, pagina = 1, conFiltros = false): string {
  const desde = (pagina - 1) * 50 + 1;
  const hasta = Math.min(pagina * 50, n);
  return `Mostrando ${desde}–${hasta} de ${n}${conFiltros ? ` (hay ${TODOS.length} en total)` : ''}`;
}

async function abrir(page: Page, consulta = ''): Promise<void> {
  await entrar(page, USUARIOS.adminFogon);
  await page.goto(`${URL_CATALOGO}${consulta}`);
  await expect(page.getByRole('heading', { name: 'Productos', exact: true })).toBeVisible();
  await expect(contador(page)).toContainText(/Mostrando|Nada coincide/);
}

/** La primera línea de la celda del nombre de cada fila visible. */
async function nombres(page: Page): Promise<string[]> {
  const celdas = await filas(page).locator('td:first-child').allInnerTexts();
  return celdas.map((t) => t.split('\n')[0]!.trim());
}

/** El precio de cada fila visible: un número, o `null` si dice «A consultar». */
async function precios(page: Page): Promise<(number | null)[]> {
  const celdas = await filas(page).locator('td:nth-child(3)').allInnerTexts();
  return celdas.map((t) => (t.includes('A consultar') ? null : Number.parseFloat(t)));
}

test.describe('PRO-01 · Productos: lista, búsqueda, filtros, orden y paginación (79 ítems, plan Crecimiento)', () => {
  test.beforeAll(async () => {
    prepararDatos();
    await fijarPlanCrecimiento(FOGON);
    await sembrarCatalogo(FOGON, TODOS);
    await sembrarFotoSubida(FOGON, 'p-001'); // una foto SUBIDA (p-001 no tiene imagenUrl): cuenta como «con foto»
  });
  test.beforeEach(() => { test.setTimeout(90_000); });

  test('el catálogo de ensayo tiene la forma de Q\'Taco: 79 ítems, 54 activos y 25 de baja', () => {
    expect(TODOS).toHaveLength(79);
    expect(TODOS.filter((i) => i.activo)).toHaveLength(54);
    expect(TODOS.filter((i) => !i.activo)).toHaveLength(25);
    expect(TODOS.some((i) => i.stock !== undefined)).toBe(false);
  });

  test('sin filtros muestra los primeros 50 de 79, el contador del plan y ningún aviso de filtros', async ({ page }) => {
    await abrir(page);
    await expect(contador(page)).toHaveText(resumen(79));
    await expect(filas(page)).toHaveCount(50);
    await expect(page.getByText('79 de 100 productos')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Limpiar filtros' })).toHaveCount(0);
    await expect(page).not.toHaveURL(/\?/);
  });

  test('paginación de 50 en 50: la segunda página trae los 29 restantes, vive en la URL y sobrevive a la recarga', async ({ page }) => {
    await abrir(page);
    await expect(paginadores(page).first()).toContainText('Página 1 de 2');
    await expect(paginadores(page).first().getByRole('button', { name: '← Anterior' })).toBeDisabled();
    const primeraPagina = await nombres(page);

    await paginadores(page).first().getByRole('button', { name: 'Siguiente →' }).click();
    await expect(page).toHaveURL(/[?&]p=2/);
    await expect(contador(page)).toHaveText(resumen(79, 2));
    await expect(filas(page)).toHaveCount(29);
    await expect(paginadores(page).first().getByRole('button', { name: 'Siguiente →' })).toBeDisabled();
    const segunda = await nombres(page);
    expect(segunda.some((n) => primeraPagina.includes(n))).toBe(false); // ninguna fila repetida entre páginas

    await page.reload();
    await expect(contador(page)).toHaveText(resumen(79, 2));
    await expect(filas(page)).toHaveCount(29);

    // El paginador de abajo hace lo mismo; volver a la primera quita `p` de la URL.
    await paginadores(page).last().getByRole('button', { name: '← Anterior' }).click();
    await expect(contador(page)).toHaveText(resumen(79, 1));
    await expect(page).not.toHaveURL(/[?&]p=/);
  });

  test('la búsqueda no distingue tildes ni mayúsculas, busca en la descripción y vive en la URL', async ({ page }) => {
    const conJamon = TODOS.filter((i) => i.descripcion?.includes('Jamón')).length;
    expect(conJamon).toBe(11);
    await abrir(page);
    await control(page, 'Buscar').fill('JAMON');
    await expect(contador(page)).toHaveText(resumen(conJamon, 1, true));
    await expect(filas(page)).toHaveCount(conJamon);
    await expect(page).toHaveURL(/[?&]q=JAMON/);
    await control(page, 'Buscar').fill('jamón');
    await expect(filas(page)).toHaveCount(conJamon);

    // Varias palabras: todas tienen que estar, en cualquier orden.
    await control(page, 'Buscar').fill('birria taco');
    const birria = TODOS.filter((i) => i.nombre.startsWith('Taco Birria')).length;
    await expect(contador(page)).toHaveText(resumen(birria, 1, true));

    // Por el código del ítem (lo que el comercio ve en la exportación) y por el área.
    await control(page, 'Buscar').fill('p-010');
    await expect(filas(page)).toHaveCount(1);
    await control(page, 'Buscar').fill('combos');
    await expect(filas(page)).toHaveCount(TODOS.filter((i) => i.area === 'combos').length);

    // Recargar conserva la búsqueda.
    await page.reload();
    await expect(control(page, 'Buscar')).toHaveValue('combos');
    await expect(filas(page)).toHaveCount(TODOS.filter((i) => i.area === 'combos').length);
  });

  test('filtro por área: cada área, «Sin área», y vive en la URL', async ({ page }) => {
    await abrir(page);
    const areas = await control(page, 'Área').locator('option').allInnerTexts();
    expect(areas).toEqual(['Todas', 'bebidas', 'combos', 'postres', 'tacos', 'Sin área']);

    for (const area of ['bebidas', 'tacos']) {
      const esperados = TODOS.filter((i) => i.area === area).length;
      await control(page, 'Área').selectOption(area);
      await expect(page).toHaveURL(new RegExp(`[?&]area=${area}`));
      await expect(contador(page)).toHaveText(resumen(esperados, 1, true));
    }
    const sinArea = TODOS.filter((i) => !i.area).length;
    await control(page, 'Área').selectOption('-');
    await expect(contador(page)).toHaveText(resumen(sinArea, 1, true));

    await page.reload();
    await expect(control(page, 'Área')).toHaveValue('-');
    await expect(contador(page)).toHaveText(resumen(sinArea, 1, true));
  });

  test('filtro por estado: «Se ofrece» (54, dos páginas) y «Dado de baja» (25)', async ({ page }) => {
    await abrir(page);
    await control(page, 'Estado').selectOption('inactivo');
    await expect(page).toHaveURL(/[?&]estado=inactivo/);
    await expect(contador(page)).toHaveText(resumen(25, 1, true));
    await expect(filas(page)).toHaveCount(25);
    await expect(filas(page).filter({ hasText: 'Se ofrece' })).toHaveCount(0);

    await control(page, 'Estado').selectOption('activo');
    await expect(contador(page)).toHaveText(resumen(54, 1, true));
    await expect(filas(page)).toHaveCount(50);
    await expect(filas(page).filter({ hasText: 'Dado de baja' })).toHaveCount(0);
    await paginadores(page).first().getByRole('button', { name: 'Siguiente →' }).click();
    await expect(contador(page)).toHaveText(resumen(54, 2, true));
    await expect(filas(page)).toHaveCount(4);

    await page.reload();
    await expect(control(page, 'Estado')).toHaveValue('activo');
    await expect(contador(page)).toHaveText(resumen(54, 2, true));
  });

  test('filtro por foto: cuenta la foto por dirección y la foto subida', async ({ page }) => {
    const porDireccion = TODOS.filter((i) => i.imagenUrl).length;
    const conFoto = porDireccion + 1; // + la foto subida de p-001
    await abrir(page);
    await control(page, 'Foto').selectOption('con');
    await expect(page).toHaveURL(/[?&]foto=con/);
    await expect(contador(page)).toHaveText(resumen(conFoto, 1, true));
    await expect(filas(page).filter({ hasText: 'Taco Birria 001' })).toHaveCount(1); // el de la foto subida
    await control(page, 'Foto').selectOption('sin');
    await expect(contador(page)).toHaveText(resumen(79 - conFoto, 1, true));
    await expect(filas(page).filter({ hasText: 'Taco Birria 001' })).toHaveCount(0);
    await page.reload();
    await expect(control(page, 'Foto')).toHaveValue('sin');
    await expect(contador(page)).toHaveText(resumen(79 - conFoto, 1, true));
  });

  test('filtro por precio desde/hasta: deja los que caen en el rango (inclusive) y saca los «a consultar»', async ({ page }) => {
    const enRango = (desde: number, hasta: number) =>
      TODOS.filter((i) => i.precio !== undefined && i.precio >= desde && i.precio <= hasta);
    await abrir(page);
    await control(page, 'Precio desde').fill('20');
    await control(page, 'hasta').fill('40');
    await expect(page).toHaveURL(/pmin=20/);
    await expect(page).toHaveURL(/pmax=40/);
    const esperados = enRango(20, 40);
    expect(esperados.length).toBeGreaterThan(5);
    await expect(contador(page)).toHaveText(resumen(esperados.length, 1, true));
    for (const p of await precios(page)) { expect(p).not.toBeNull(); expect(p!).toBeGreaterThanOrEqual(20); expect(p!).toBeLessThanOrEqual(40); }

    // Solo «desde»: sin tope arriba.
    await control(page, 'hasta').fill('');
    await expect(page).not.toHaveURL(/pmax=/);
    await control(page, 'Precio desde').fill('90');
    const caros = enRango(90, Infinity);
    await expect(contador(page)).toHaveText(resumen(caros.length, 1, true));

    // El límite exacto entra: un precio que existe, como «desde» y «hasta» a la vez.
    const unPrecio = TODOS.find((i) => i.precio !== undefined)!.precio!;
    await control(page, 'Precio desde').fill(String(unPrecio));
    await control(page, 'hasta').fill(String(unPrecio));
    await expect(contador(page)).toHaveText(resumen(enRango(unPrecio, unPrecio).length, 1, true));

    await page.reload();
    await expect(control(page, 'Precio desde')).toHaveValue(String(unPrecio));
  });

  test('orden: nombre (por defecto), precio de menor a mayor y de mayor a menor (lo «a consultar» siempre al final) y recién modificados', async ({ page }) => {
    await abrir(page);
    const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
    const porNombre = await nombres(page);
    expect([...porNombre].sort(collator.compare)).toEqual(porNombre);

    // Menor a mayor: página 1 y página 2, con los 6 «a consultar» al final.
    await control(page, 'Ordenar por').selectOption('precio');
    await expect(page).toHaveURL(/[?&]orden=precio/);
    const p1 = (await precios(page)).filter((p): p is number => p !== null);
    expect(p1).toHaveLength(50);
    expect([...p1].sort((a, b) => a - b)).toEqual(p1);
    await paginadores(page).first().getByRole('button', { name: 'Siguiente →' }).click();
    await expect(filas(page)).toHaveCount(29);
    const p2 = await precios(page);
    const aConsultar = TODOS.filter((i) => i.precio === undefined).length;
    expect(aConsultar).toBe(6);
    expect(p2.slice(-aConsultar)).toEqual(Array(aConsultar).fill(null));
    const conPrecio2 = p2.slice(0, -aConsultar) as number[];
    expect([...conPrecio2].sort((a, b) => a - b)).toEqual(conPrecio2);
    expect(conPrecio2[0]!).toBeGreaterThanOrEqual(p1.at(-1)!); // la segunda página sigue donde terminó la primera

    // Mayor a menor, y cambiar el orden vuelve a la página 1.
    await control(page, 'Ordenar por').selectOption('-precio');
    await expect(page).not.toHaveURL(/[?&]p=/);
    const d1 = await precios(page);
    expect(d1).toHaveLength(50);
    expect(d1.every((p) => p !== null)).toBe(true);
    expect([...d1 as number[]].sort((a, b) => b - a)).toEqual(d1);
    await paginadores(page).first().getByRole('button', { name: 'Siguiente →' }).click();
    expect((await precios(page)).slice(-aConsultar)).toEqual(Array(aConsultar).fill(null));

    // Recién modificados: el ítem 1 es el más reciente, y así hacia atrás.
    await control(page, 'Ordenar por').selectOption('recientes');
    await expect(page).toHaveURL(/[?&]orden=recientes/);
    expect((await nombres(page)).slice(0, 3)).toEqual(['Taco Birria 001', 'Horchata 002', 'Flan 003']);

    // Volver a «Nombre» quita el parámetro de la URL.
    await control(page, 'Ordenar por').selectOption('nombre');
    await expect(page).not.toHaveURL(/orden=/);
    await page.reload();
    await expect(control(page, 'Ordenar por')).toHaveValue('nombre');
  });

  test('cambiar un filtro desde la página 2 vuelve a la página 1, y varios filtros se combinan', async ({ page }) => {
    await abrir(page, '?estado=activo&p=2');
    await expect(contador(page)).toHaveText(resumen(54, 2, true));
    await control(page, 'Área').selectOption('tacos');
    await expect(page).not.toHaveURL(/[?&]p=/);
    const esperados = TODOS.filter((i) => i.activo && i.area === 'tacos' && i.precio !== undefined && i.precio <= 50).length;
    await control(page, 'hasta').fill('50');
    await expect(contador(page)).toHaveText(resumen(esperados, 1, true));
    await expect(page).toHaveURL(/estado=activo/);
    await expect(page).toHaveURL(/area=tacos/);
    await expect(page).toHaveURL(/pmax=50/);
  });

  test('una dirección con todos los filtros se abre tal cual: los controles y la lista lo reflejan', async ({ page }) => {
    const consulta = '?q=taco&area=tacos&estado=activo&foto=sin&pmin=10&pmax=70&orden=-precio';
    const esperados = TODOS.filter((i) => `${i.nombre} ${i.descripcion ?? ''} ${i.area ?? ''} ${i.id}`.toLowerCase().includes('taco')
      && i.area === 'tacos' && i.activo && !i.imagenUrl && i.id !== 'p-001' && i.precio !== undefined && i.precio >= 10 && i.precio <= 70);
    await abrir(page, consulta);
    await expect(control(page, 'Buscar')).toHaveValue('taco');
    await expect(control(page, 'Área')).toHaveValue('tacos');
    await expect(control(page, 'Estado')).toHaveValue('activo');
    await expect(control(page, 'Foto')).toHaveValue('sin');
    await expect(control(page, 'Precio desde')).toHaveValue('10');
    await expect(control(page, 'hasta')).toHaveValue('70');
    await expect(control(page, 'Ordenar por')).toHaveValue('-precio');
    await expect(contador(page)).toHaveText(resumen(esperados.length, 1, true));
    const p = await precios(page) as number[];
    expect([...p].sort((a, b) => b - a)).toEqual(p);
  });

  test('NEGATIVA: los parámetros inválidos de la URL se ignoran y la lista sale como sin filtros', async ({ page }) => {
    await abrir(page, '?estado=roto&foto=xx&orden=zzz&p=-3&pmin=abc&pmax=-5&stock=raro');
    await expect(contador(page)).toHaveText(resumen(79));
    await expect(filas(page)).toHaveCount(50);
    await expect(control(page, 'Estado')).toHaveValue('');
    await expect(control(page, 'Foto')).toHaveValue('');
    await expect(control(page, 'Ordenar por')).toHaveValue('nombre');
    await expect(control(page, 'Precio desde')).toHaveValue(''); // un texto no es un número: el control de tipo número lo descarta
    await expect(page.getByRole('button', { name: 'Limpiar filtros' })).toHaveCount(0);
  });

  test('NEGATIVA: una página que no existe se lleva a la última, y la página 0 o un texto, a la primera', async ({ page }) => {
    await abrir(page, '?p=999');
    await expect(contador(page)).toHaveText(resumen(79, 2));
    for (const consulta of ['?p=0', '?p=dos']) {
      await page.goto(`${URL_CATALOGO}${consulta}`);
      await expect(contador(page)).toHaveText(resumen(79, 1));
    }
  });

  test('NEGATIVA: una búsqueda de más de 80 caracteres se recorta a 80 y no rompe la pantalla', async ({ page }) => {
    await abrir(page, `?q=${'a'.repeat(200)}`);
    await expect(control(page, 'Buscar')).toHaveValue('a'.repeat(80));
    await expect(contador(page)).toContainText('Nada coincide');
  });

  test('NEGATIVA: un valor de filtro que existe en la URL pero no en los datos dice «Nada coincide» (no se ignora)', async ({ page }) => {
    await abrir(page, '?area=area-que-no-existe');
    await expect(contador(page)).toHaveText('Nada coincide con la búsqueda. (hay 79 en total)');
    await expect(page.getByText('Ningún ítem coincide con lo que buscas.')).toBeVisible();
  });

  test('«Nada coincide» ofrece «Limpiar filtros» en dos lugares y cualquiera devuelve los 79 con la URL limpia', async ({ page }) => {
    await abrir(page);
    await control(page, 'Buscar').fill('zzzzzz');
    await expect(contador(page)).toHaveText('Nada coincide con la búsqueda. (hay 79 en total)');
    await expect(page.getByText('Ningún ítem coincide con lo que buscas.')).toBeVisible();
    await expect(filas(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Limpiar filtros' })).toHaveCount(2);

    await page.locator('.filtros-catalogo').getByRole('button', { name: 'Limpiar filtros' }).click();
    await expect(contador(page)).toHaveText(resumen(79));
    await expect(page).not.toHaveURL(/q=/);

    // El enlace de dentro del mensaje hace lo mismo, también con varios filtros puestos.
    await control(page, 'Estado').selectOption('inactivo');
    await control(page, 'Buscar').fill('zzzzzz');
    await page.locator('p.vacio').getByRole('button', { name: 'Limpiar filtros' }).click();
    await expect(contador(page)).toHaveText(resumen(79));
    await expect(control(page, 'Estado')).toHaveValue('');
    await expect(control(page, 'Buscar')).toHaveValue('');
  });

  test('NEGATIVA (Q\'Taco no usa inventario): sin ningún ítem con stock no hay columna ni filtro de Existencias, ni siquiera con ?stock= en la URL', async ({ page }) => {
    await abrir(page, '?stock=agotado');
    await expect(page.getByRole('columnheader', { name: 'Existencias' })).toHaveCount(0);
    await expect(page.locator('.filtros-catalogo label').filter({ hasText: /^Existencias/ })).toHaveCount(0);
    // El filtro de la URL no se aplica (no hay control para sacarlo): la lista sale completa y sin aviso de filtros.
    await expect(contador(page)).toHaveText(resumen(79));
    await expect(page.getByRole('button', { name: 'Limpiar filtros' })).toHaveCount(0);
  });

  test('DOCUMENTA lo que hace hoy la pantalla: la lista de «Ordenar por» ofrece «Existencias» aunque ningún ítem lleve stock', async ({ page }) => {
    // No es la columna ni el filtro que pide la matriz (esos NO aparecen), pero es una puerta hacia el inventario que Q'Taco no usa.
    // Elegirla no rompe nada: sin existencias, el orden cae al de nombre. Si algún día se oculta, esta prueba se invierte.
    await abrir(page);
    const opciones = await control(page, 'Ordenar por').locator('option').allInnerTexts();
    expect(opciones).toContain('Existencias: lo que menos queda primero');
    const antes = await nombres(page);
    await control(page, 'Ordenar por').selectOption('stock');
    await expect(page).toHaveURL(/orden=stock/);
    expect(await nombres(page)).toEqual(antes);
  });
});

test.describe('PRO-01 · con UN ítem con existencias, la columna y el filtro de Existencias sí aparecen (control de la negativa)', () => {
  test.beforeAll(async () => {
    prepararDatos();
    await fijarPlanCrecimiento(FOGON);
    const items: ItemDeCatalogo[] = catalogoDeQtaco();
    await sembrarCatalogo(FOGON, items);
    await fijarStock(FOGON, 'p-002', 0);
    await fijarStock(FOGON, 'p-004', 12);
  });

  test('aparecen la columna y el filtro, y «Agotado» deja solo el ítem en cero', async ({ page }) => {
    test.setTimeout(90_000);
    await abrir(page);
    await expect(page.getByRole('columnheader', { name: 'Existencias' })).toBeVisible();
    await control(page, 'Existencias').selectOption('agotado');
    await expect(page).toHaveURL(/stock=agotado/);
    await expect(contador(page)).toHaveText(resumen(1, 1, true));
    await expect(filas(page).first()).toContainText('Horchata 002');
    await control(page, 'Existencias').selectOption('con');
    await expect(contador(page)).toHaveText(resumen(1, 1, true));
    await expect(filas(page).first()).toContainText('Combo Familiar 004');
    await control(page, 'Existencias').selectOption('sin-control');
    await expect(contador(page)).toHaveText(resumen(77, 1, true));
  });
});
