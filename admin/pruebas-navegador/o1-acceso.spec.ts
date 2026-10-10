import { expect, test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { fijarModulos, leerFicha } from './ayudas/datos';
import {
  AURORA, CORREO_PROPIETARIO_SIMULADO, FOGON, MODULOS_QTACO, crearOperadorFogon, crearPropietarioSimulado,
  enlaceMiCuenta, esperarMenu, sinPermiso,
} from './ayudas/o1-comun';
import prepararDatos from './preparar-datos';

/**
 * ACC-05 (guardia de rutas por rol y por comercio) y ACC-06 (menú y pestañas según módulos y rol).
 * El guardia de rutas y el menú son CONVENIENCIA (quien autoriza es `firestore.rules`); lo que se prueba acá es lo que ve la
 * persona: que lo que no le toca no se pinte y que escribir la dirección a mano no abra la pantalla.
 */

/** [ruta bajo /negocio/<id>/, encabezado de la pantalla (null si no tiene uno propio)]. */
const RUTAS_DEL_COMERCIO: [string, string | null][] = [
  ['configuracion', 'Configuración del negocio'],
  ['catalogo', 'Productos'],
  ['campanas', 'Campañas'],
  ['pedidos', 'Pedidos'],
  ['cobros', 'Cobros'],
  ['cobro', 'Configuración de QR'],
  ['conversaciones', null],
  ['usuarios', 'Usuarios del negocio'],
  ['contactos', 'Personas de referencia'],
  ['consumo', 'Consumo'],
  ['cuenta', 'Estado de cuenta'],
  ['pagar', 'Pagar'],
  ['reclamos', 'Reclamos'],
  ['bitacora', 'Bitácora'],
];
/** Lo que el operador (con el módulo Pedidos) sí abre. El resto es «Sin permiso». */
const RUTAS_DEL_OPERADOR = ['pedidos', 'cobros', 'conversaciones', 'consumo', 'reclamos'];

const rutaDe = (tenant: string, r: string) => `/negocio/${tenant}/${r}`;
const rutaActual = (page: Page) => new URL(page.url()).pathname;

async function abre(page: Page, ruta: string, encabezado: string | null, quien: string): Promise<void> {
  await page.goto(ruta);
  if (encabezado) await expect.soft(page.getByRole('heading', { name: encabezado, exact: true }), `${quien}: ${ruta} debe abrir «${encabezado}»`).toBeVisible();
  else await expect.soft(page.getByRole('button', { name: 'Salir', exact: true }), `${quien}: ${ruta} debe abrir la pantalla`).toBeVisible();
  await expect.soft(sinPermiso(page), `${quien}: ${ruta} no debe decir «Sin permiso»`).toHaveCount(0);
  expect.soft(rutaActual(page), `${quien}: ${ruta} no debe redirigir`).toBe(ruta);
}

async function niega(page: Page, ruta: string, quien: string): Promise<void> {
  await page.goto(ruta);
  await expect.soft(sinPermiso(page), `${quien}: ${ruta} debe decir «Sin permiso»`).toBeVisible();
  expect.soft(rutaActual(page), `${quien}: ${ruta} se queda en su dirección`).toBe(ruta);
}

test.describe('ACC-05: guardia de rutas por rol y por comercio', () => {
  test.beforeAll(async () => {
    prepararDatos();
    await crearOperadorFogon(USUARIOS.operadorFogon);
    await fijarModulos(FOGON, MODULOS_QTACO);
  });
  test.afterAll(async () => { await fijarModulos(FOGON, null); });

  test('NEGATIVA: sin sesión toda ruta redirige a /ingresar', async ({ page }) => {
    const rutas = ['/', '/mi-cuenta', '/negocios', '/bitacora', ...RUTAS_DEL_COMERCIO.map(([r]) => rutaDe(FOGON, r))];
    for (const ruta of rutas) {
      await page.goto(ruta);
      await expect.soft(page, `sin sesión: ${ruta}`).toHaveURL(/\/ingresar$/);
      await expect.soft(page.getByLabel('Correo'), `sin sesión: ${ruta} muestra el ingreso`).toBeVisible();
    }
  });

  test('el administrador de Q\'Taco abre todas las rutas de su menú, sin «Sin permiso»', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    for (const [r, encabezado] of RUTAS_DEL_COMERCIO) await abre(page, rutaDe(FOGON, r), encabezado, 'admin');
    await abre(page, '/mi-cuenta', 'Mi cuenta', 'admin');
  });

  test('el operador abre solo Pedidos, Cobros, Conversaciones, Consumo y Reclamos; el resto dice «Sin permiso»', async ({ page }) => {
    await ingresar(page, USUARIOS.operadorFogon);
    for (const [r, encabezado] of RUTAS_DEL_COMERCIO) {
      if (RUTAS_DEL_OPERADOR.includes(r)) await abre(page, rutaDe(FOGON, r), encabezado, 'operador');
      else await niega(page, rutaDe(FOGON, r), 'operador');
    }
    await abre(page, '/mi-cuenta', 'Mi cuenta', 'operador');
  });

  test('NEGATIVA: el operador tampoco abre las rutas de módulos que el comercio no tiene, ni las de NovuChat', async ({ page }) => {
    await ingresar(page, USUARIOS.operadorFogon);
    for (const r of ['agenda', 'inventario', 'captacion']) await niega(page, rutaDe(FOGON, r), 'operador');
    await niega(page, '/negocios', 'operador');
    await niega(page, '/bitacora', 'operador');
    await niega(page, `/negocios/${FOGON}/administrar`, 'operador');
  });

  test('NEGATIVA (aislamiento): el administrador de OTRO comercio recibe «Sin permiso» en toda ruta de Q\'Taco', async ({ page }) => {
    await ingresar(page, USUARIOS.adminAurora);
    for (const [r] of RUTAS_DEL_COMERCIO) await niega(page, rutaDe(FOGON, r), 'admin de Aurora en Q\'Taco');
    // Y lo suyo sí lo abre: la negación es por comercio, no un bloqueo general.
    await abre(page, rutaDe(AURORA, 'configuracion'), 'Configuración del negocio', 'admin de Aurora en lo suyo');
  });

  test('NEGATIVA (aislamiento): el administrador de Q\'Taco recibe «Sin permiso» en toda ruta de OTRO comercio', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    for (const [r] of RUTAS_DEL_COMERCIO) await niega(page, rutaDe(AURORA, r), 'admin de Q\'Taco en Aurora');
  });

  test('NEGATIVA: las rutas de NovuChat (Negocios, Administrar, Bitácora general) dicen «Sin permiso» al administrador del comercio', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await niega(page, '/negocios', 'admin');
    await niega(page, '/bitacora', 'admin');
    await niega(page, `/negocios/${FOGON}/administrar`, 'admin');
  });

  test('NEGATIVA: una ruta que no existe, o con un comercio inventado, no abre nada (vuelve al inicio o dice «Sin permiso»)', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await page.goto('/negocio/no-existe/configuracion');
    await expect(sinPermiso(page)).toBeVisible();
    await page.goto(`/negocio/${FOGON}/inexistente`);
    await expect.poll(() => rutaActual(page)).toBe('/');
  });

  test('NEGATIVA: Inventario, que Q\'Taco no tiene, redirige al inicio por la dirección directa', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await page.goto(rutaDe(FOGON, 'inventario'));
    await expect.poll(() => rutaActual(page)).toBe('/');
    await expect(page.getByRole('heading', { name: 'Inventario' })).toHaveCount(0);
  });

  test('NEGATIVA: Captación, que Q\'Taco no tiene, no muestra ningún formulario (dice que el negocio no tiene el flujo)', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await page.goto(rutaDe(FOGON, 'captacion'));
    await expect(page.getByText('Este negocio no tiene el flujo de captación')).toBeVisible();
    await expect(page.getByRole('button', { name: /guardar/i })).toHaveCount(0);
  });

  test('NEGATIVA: Agenda, que Q\'Taco no tiene, no se abre escribiendo la dirección (ni /funcionarios)', async ({ page }) => {
    // ACC-05: `App.tsx` deja la ruta `/agenda` con solo el guardia de administrador y `Funcionarios` no mira los módulos (a
    // diferencia de `Inventario`, que redirige, y de `Captacion`, que lo explica): un administrador de Q'Taco ve la pantalla
    // «Agenda» con su formulario aunque el menú no la ofrezca. El servidor sí cierra la escritura (reglas por módulo), por eso es
    // un defecto de presentación, no de seguridad. Cuando se corrija, esta prueba se pone roja y se quita la marca.
    test.fail(true, 'ACC-05: /agenda no redirige ni niega para un comercio sin el módulo Agenda (Funcionarios.tsx no mira los módulos)');
    await ingresar(page, USUARIOS.adminFogon);
    await page.goto(rutaDe(FOGON, 'agenda'));
    await expect(page.getByRole('button', { name: 'Salir', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toHaveCount(0);
    await page.goto(rutaDe(FOGON, 'funcionarios'));
    await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toHaveCount(0);
  });

  test('el propietario simulado (claim de propietario) abre Pagar y Captación aunque no sea su menú de comercio', async ({ page }) => {
    await crearPropietarioSimulado(FOGON);
    await ingresar(page, CORREO_PROPIETARIO_SIMULADO);
    await abre(page, rutaDe(FOGON, 'pagar'), 'Pagar', 'propietario');
    await abre(page, rutaDe(FOGON, 'captacion'), null, 'propietario');
    await expect(sinPermiso(page)).toHaveCount(0);
  });
});

test.describe('ACC-06: menú y pestañas según los módulos de la ficha y el rol', () => {
  const MENU_ADMIN_QTACO = [
    'Configuración', 'Productos', 'Campañas', 'Pedidos', 'Cobros', 'Configuración de QR', 'Conversaciones',
    'Usuarios', 'Contactos', 'Consumo', 'Cuenta', 'Pagar', 'Reclamos', 'Bitácora',
  ];
  const NUNCA = ['Agenda', 'Funcionarios', 'Captación', 'Negocios', 'Inventario'];

  test.beforeAll(async () => {
    prepararDatos();
    await crearOperadorFogon(USUARIOS.operadorFogon);
  });
  test.afterAll(async () => { await fijarModulos(FOGON, null); });

  const sinLoProhibido = async (page: Page) => {
    for (const nombre of NUNCA) await expect(page.locator('header.cabecera').getByRole('link', { name: nombre, exact: true })).toHaveCount(0);
  };

  test('con `modulos` (productos, campañas, cobros, pedidos, catálogo web): el administrador ve el menú de Q\'Taco, en ese orden, y Mi cuenta', async ({ page }) => {
    await fijarModulos(FOGON, MODULOS_QTACO);
    await ingresar(page, USUARIOS.adminFogon);
    await esperarMenu(page, MENU_ADMIN_QTACO);
    await expect(enlaceMiCuenta(page)).toBeVisible();
    await sinLoProhibido(page);
  });

  test('NEGATIVA: con esos módulos el administrador no llega a Inventario ni por la dirección', async ({ page }) => {
    await fijarModulos(FOGON, MODULOS_QTACO);
    await ingresar(page, USUARIOS.adminFogon);
    await esperarMenu(page, MENU_ADMIN_QTACO);
    await page.goto(rutaDe(FOGON, 'inventario'));
    await expect.poll(() => rutaActual(page)).toBe('/');
  });

  test('el menú es el mismo en una pantalla sin comercio en la dirección (Mi cuenta): toma el único comercio de la persona', async ({ page }) => {
    await fijarModulos(FOGON, MODULOS_QTACO);
    await ingresar(page, USUARIOS.adminFogon);
    await page.goto('/mi-cuenta');
    await esperarMenu(page, MENU_ADMIN_QTACO);
  });

  test('el operador ve solo Pedidos, Cobros, Conversaciones, Consumo y Reclamos, y Mi cuenta', async ({ page }) => {
    // La matriz (06/10) listaba Pedidos, Conversaciones, Consumo, Reclamos y Mi cuenta. Desde el 09/10/2026 (Andres) el operador de un
    // comercio con Pedidos ve también «Cobros» (`rolesConModulo` en el registro): la prueba sigue lo vigente.
    await fijarModulos(FOGON, MODULOS_QTACO);
    await ingresar(page, USUARIOS.operadorFogon);
    await esperarMenu(page, ['Pedidos', 'Cobros', 'Conversaciones', 'Consumo', 'Reclamos']);
    await expect(enlaceMiCuenta(page)).toBeVisible();
    await sinLoProhibido(page);
    for (const prohibido of ['Configuración', 'Productos', 'Campañas', 'Configuración de QR', 'Usuarios', 'Contactos', 'Cuenta', 'Pagar', 'Bitácora']) {
      await expect(page.locator('header.cabecera').getByRole('link', { name: prohibido, exact: true })).toHaveCount(0);
    }
  });

  test('NEGATIVA: sin el módulo Pedidos el operador no ve «Cobros» en el menú y, por la dirección, vuelve al inicio', async ({ page }) => {
    await fijarModulos(FOGON, ['productos', 'cobros']);
    await ingresar(page, USUARIOS.operadorFogon);
    await esperarMenu(page, ['Conversaciones', 'Consumo', 'Reclamos']);
    await page.goto(rutaDe(FOGON, 'cobros'));
    await expect.poll(() => rutaActual(page)).toBe('/');
  });

  test('sin el campo `modulos` la consola cae al respaldo por `flujos` (venta): conserva Inventario y Catálogo web, y quita nada de lo demás', async ({ page }) => {
    // Es el estado de Q'Taco ANTES de `aplicar-modulos-tenant`: por eso la matriz pedía escribir `modulos`. Si esta prueba se pone
    // roja porque Inventario desapareció, el respaldo cambió y hay que revisar qué ve hoy cada comercio sin `modulos`.
    await fijarModulos(FOGON, null);
    expect((await leerFicha(FOGON))['modulos']).toBeUndefined();
    await ingresar(page, USUARIOS.adminFogon);
    await esperarMenu(page, [
      'Configuración', 'Productos', 'Campañas', 'Pedidos', 'Cobros', 'Inventario', 'Configuración de QR', 'Conversaciones',
      'Usuarios', 'Contactos', 'Consumo', 'Cuenta', 'Pagar', 'Reclamos', 'Bitácora',
    ]);
    for (const nombre of ['Agenda', 'Captación', 'Negocios']) await expect(page.locator('header.cabecera').getByRole('link', { name: nombre, exact: true })).toHaveCount(0);
  });

  test('sin `modulos` el operador ve lo mismo que con ellos (Pedidos, Cobros, Conversaciones, Consumo, Reclamos)', async ({ page }) => {
    await fijarModulos(FOGON, null);
    await ingresar(page, USUARIOS.operadorFogon);
    await esperarMenu(page, ['Pedidos', 'Cobros', 'Conversaciones', 'Consumo', 'Reclamos']);
  });

  test('NEGATIVA: con `modulos` vacío no hay pestañas de módulo (Pedidos, Cobros, QR) y queda lo común', async ({ page }) => {
    await fijarModulos(FOGON, []);
    await ingresar(page, USUARIOS.adminFogon);
    await esperarMenu(page, [
      'Configuración', 'Catálogo', 'Campañas', 'Conversaciones', 'Usuarios', 'Contactos', 'Consumo', 'Cuenta', 'Pagar', 'Reclamos', 'Bitácora',
    ]);
  });

  test('NEGATIVA: el administrador de Aurora (agenda) no ve Pedidos, Cobros ni Inventario, y su menú no se mezcla con el de Q\'Taco', async ({ page }) => {
    await ingresar(page, USUARIOS.adminAurora);
    await expect(page.locator('header.cabecera').getByRole('link', { name: 'Agenda', exact: true })).toBeVisible();
    for (const nombre of ['Pedidos', 'Inventario', 'Captación', 'Negocios']) {
      await expect(page.locator('header.cabecera').getByRole('link', { name: nombre, exact: true })).toHaveCount(0);
    }
  });
});
