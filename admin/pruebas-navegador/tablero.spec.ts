import { expect, test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { fijarHorarios } from './ayudas/datos';
import { FOGON, crearOperadorFogon, fijarDoc, limpiarBitacora, quitarCampo, sembrarEventosDeBitacora } from './ayudas/o1-comun';
import prepararDatos from './preparar-datos';

const TODOS_LOS_DIAS = Object.fromEntries(['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'].map((d) => [d, '10:00-20:00']));

test.describe('Tablero', () => {
  test.beforeEach(() => { prepararDatos(); });

  test('muestra las cifras del comercio, lo que el asistente sabe ofrecer y el estado de la cuenta', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await expect(page.getByRole('heading', { name: 'Tu negocio' })).toBeVisible();
    await expect(page.getByText('CONVERSACIONES', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('MENSAJES DEL ASISTENTE')).toBeVisible();
    await expect(page.getByText('DERIVACIONES A OPERADOR')).toBeVisible();
    await expect(page.getByText('LO QUE EL ASISTENTE SABE OFRECER')).toBeVisible();
    await expect(page.getByText('Al día')).toBeVisible();
    // Las cifras salen de la siembra: 12 conversaciones este mes, 3 productos.
    await expect(page.getByText('12', { exact: true }).first()).toBeVisible();
  });

  test('el horario de hoy sale de lo configurado', async ({ page }) => {
    await fijarHorarios('parrilla-el-fogon', TODOS_LOS_DIAS);
    await ingresar(page, USUARIOS.adminFogon);
    await expect(page.getByText('Hoy abierto 10:00-20:00')).toBeVisible();
  });

  test('los períodos de arriba cambian sin romper la pantalla', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    for (const periodo of ['7 días', '30 días', 'Hoy']) {
      await page.getByRole('button', { name: periodo, exact: true }).click();
      await expect(page.getByText('MENSAJES DEL ASISTENTE')).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
  });

  test('«Editar productos» lleva al catálogo', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Editar productos' }).click();
    await expect(page.getByRole('heading', { name: 'Productos', exact: true })).toBeVisible();
  });
});

test.describe('Tablero: aviso del 80 %, tope de 1500 eventos y horario (TAB-01)', () => {
  test.beforeEach(() => { prepararDatos(); });
  // Los eventos sembrados se borran con la página ya cerrada: borrarlos con un oyente abierto satura al emulador.
  test.afterEach(async ({ page }) => { test.setTimeout(150_000); await page.goto('about:blank'); await limpiarBitacora(FOGON); });

  const mesActual = () => new Date().toISOString().slice(0, 7);
  const mesAnterior = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
  const aviso = (page: Page) => page.getByText(/Llegaste al \d+ % de las conversaciones de tu plan/);
  const TODOS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];

  test('el aviso del 80 % que marcó el servidor sale arriba de todo, con sus números y la bolsa', async ({ page }) => {
    await fijarDoc(`tenants/${FOGON}/cuenta/estado`, { avisoConsumo: { mes: mesActual(), conversaciones: 80, limite: 100 } });
    await ingresar(page, USUARIOS.adminFogon);
    await expect(aviso(page)).toContainText('80 % de las conversaciones de tu plan (80 de 100)');
    await expect(page.getByText(/bolsa de \d+ conversaciones por USD/)).toBeVisible();
  });

  test('NEGATIVA: un aviso del mes anterior no se muestra (el conteo ya volvió a cero)', async ({ page }) => {
    await fijarDoc(`tenants/${FOGON}/cuenta/estado`, { avisoConsumo: { mes: mesAnterior(), conversaciones: 80, limite: 100 } });
    await ingresar(page, USUARIOS.adminFogon);
    await expect(page.getByText('LO QUE EL ASISTENTE SABE OFRECER')).toBeVisible();
    await expect(aviso(page)).toHaveCount(0);
  });

  test('NEGATIVA: sin aviso en la cuenta no hay aviso, y un aviso con límite 0 tampoco', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await expect(page.getByText('LO QUE EL ASISTENTE SABE OFRECER')).toBeVisible();
    await expect(aviso(page)).toHaveCount(0);
    await fijarDoc(`tenants/${FOGON}/cuenta/estado`, { avisoConsumo: { mes: mesActual(), conversaciones: 80, limite: 0 } });
    await page.reload();
    await expect(page.getByText('LO QUE EL ASISTENTE SABE OFRECER')).toBeVisible();
    await expect(aviso(page)).toHaveCount(0);
  });

  test('NEGATIVA: el operador no ve el aviso del 80 % (no lee la cuenta)', async ({ page }) => {
    await crearOperadorFogon(USUARIOS.operadorFogon);
    await fijarDoc(`tenants/${FOGON}/cuenta/estado`, { avisoConsumo: { mes: mesActual(), conversaciones: 80, limite: 100 } });
    await ingresar(page, USUARIOS.operadorFogon);
    await expect(page.getByText('LO QUE EL ASISTENTE SABE OFRECER')).toBeVisible();
    await expect(aviso(page)).toHaveCount(0);
  });

  test('con 1500 eventos en el período el gráfico avisa que es incompleto y manda a Consumo para facturar', async ({ page }) => {
    test.setTimeout(150_000);
    await sembrarEventosDeBitacora(FOGON, 1500);
    await ingresar(page, USUARIOS.adminFogon);
    await expect(page.getByText('El período tiene más movimiento del que esta pantalla trae de una vez')).toBeVisible();
    await expect(page.getByText(/«Consumo», que no tiene este tope/)).toBeVisible();
  });

  test('NEGATIVA: con 1499 eventos (uno menos que el tope) no hay aviso de gráfico incompleto', async ({ page }) => {
    test.setTimeout(150_000);
    await sembrarEventosDeBitacora(FOGON, 1499);
    await ingresar(page, USUARIOS.adminFogon);
    await expect(page.getByText('MENSAJES DEL ASISTENTE')).toBeVisible();
    await expect(page.getByText('749', { exact: true })).toBeVisible(); // las cifras ya cargaron: 749 enviados (los de índice impar entre 1499 eventos)
    await expect(page.getByText('El período tiene más movimiento del que esta pantalla trae de una vez')).toHaveCount(0);
  });

  test('sin horario cargado la tarjeta «Hoy» dice «Sin horario fijo» y no inventa que está cerrado', async ({ page }) => {
    await quitarCampo(`tenants/${FOGON}/config/negocio`, 'horarios');
    await ingresar(page, USUARIOS.adminFogon);
    await expect(page.getByText('Sin horario fijo')).toBeVisible();
    await expect(page.getByText('No cargaste un horario de atención')).toBeVisible();
    await expect(page.getByText('Hoy cerrado')).toHaveCount(0);
    await expect(page.getByText(/Hoy abierto/)).toHaveCount(0);
  });

  test('con los siete días vacíos también dice «Sin horario fijo»', async ({ page }) => {
    await fijarHorarios(FOGON, Object.fromEntries(TODOS.map((d) => [d, ''])));
    await ingresar(page, USUARIOS.adminFogon);
    await expect(page.getByText('Sin horario fijo')).toBeVisible();
  });

  test('NEGATIVA: con horario cargado y hoy cerrado dice «Hoy cerrado», no «Sin horario fijo»', async ({ page }) => {
    await fijarHorarios(FOGON, Object.fromEntries(TODOS.map((d) => [d, 'cerrado'])));
    await ingresar(page, USUARIOS.adminFogon);
    await expect(page.getByText('Hoy cerrado')).toBeVisible();
    await expect(page.getByText('Sin horario fijo')).toHaveCount(0);
  });
});

test.describe('Tablero del operador (TAB-02)', () => {
  test.beforeEach(async () => { prepararDatos(); await crearOperadorFogon(USUARIOS.operadorFogon); });

  test('el operador ve «Hoy» y «Lo que el asistente sabe ofrecer», sin «Editar», sin cifras ni cuenta', async ({ page }) => {
    await ingresar(page, USUARIOS.operadorFogon);
    await expect(page.getByRole('heading', { level: 3, name: 'Hoy', exact: true })).toBeVisible();
    await expect(page.getByText('LO QUE EL ASISTENTE SABE OFRECER')).toBeVisible();
    await expect(page.getByRole('link', { name: /Editar/ })).toHaveCount(0);
    for (const prohibido of ['MENSAJES DEL ASISTENTE', 'DERIVACIONES A OPERADOR', 'CUENTA', 'Al día']) await expect(page.getByText(prohibido, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Período' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});

test.describe('Encabezado del comercio: nombre y chip PRUEBA / PRODUCCIÓN (ACC-07)', () => {
  test.beforeEach(async () => { prepararDatos(); await crearOperadorFogon(USUARIOS.operadorFogon); });

  const franja = (page: Page) => page.getByLabel('Comercio', { exact: true });
  const chip = (page: Page) => franja(page).locator('.tag');

  test('el administrador ve el nombre del comercio y el chip PRUEBA (la cuenta sembrada es una demostración)', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await expect(franja(page)).toContainText('Parrilla El Fogon');
    await expect(chip(page)).toHaveText('PRUEBA');
  });

  test('el chip sigue a la modalidad de la cuenta, en vivo: producción es PRODUCCIÓN; demostración y mes de prueba, PRUEBA', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await expect(chip(page)).toHaveText('PRUEBA');
    await fijarDoc(`tenants/${FOGON}/cuenta/estado`, { modalidad: 'prepago' });
    await expect(chip(page)).toHaveText('PRODUCCIÓN');
    await fijarDoc(`tenants/${FOGON}/cuenta/estado`, { modalidad: 'prueba' });
    await expect(chip(page)).toHaveText('PRUEBA');
    await fijarDoc(`tenants/${FOGON}/cuenta/estado`, { modalidad: 'demostracion' });
    await expect(chip(page)).toHaveText('PRUEBA');
  });

  test('NEGATIVA: una modalidad desconocida o ausente nunca se muestra como PRODUCCIÓN', async ({ page }) => {
    await fijarDoc(`tenants/${FOGON}/cuenta/estado`, { modalidad: 'produccion-inventada' });
    await ingresar(page, USUARIOS.adminFogon);
    await expect(chip(page)).toHaveText('PRUEBA');
    await quitarCampo(`tenants/${FOGON}/cuenta/estado`, 'modalidad');
    await expect(chip(page)).toHaveText('PRUEBA');
  });

  test('NEGATIVA: el operador ve el nombre del comercio pero ni chip ni error (no pide cuenta/estado)', async ({ page }) => {
    const errores: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    page.on('pageerror', (e) => errores.push(e.message));
    await fijarDoc(`tenants/${FOGON}/cuenta/estado`, { modalidad: 'prepago' });
    await ingresar(page, USUARIOS.operadorFogon);
    await expect(franja(page)).toContainText('Parrilla El Fogon');
    await page.getByRole('link', { name: 'Pedidos', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pedidos', level: 2 })).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(chip(page)).toHaveCount(0);
    await expect(page.getByText('PRODUCCIÓN')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(errores.filter((e) => /permission|insufficient|permisos/i.test(e)), `errores de permiso en la consola: ${errores.join(' | ')}`).toEqual([]);
  });

  test('NEGATIVA (aislamiento): el administrador de otro comercio ve SU nombre y SU chip, no los de Q\'Taco', async ({ page }) => {
    await fijarDoc(`tenants/${FOGON}/cuenta/estado`, { modalidad: 'prepago' });
    await ingresar(page, USUARIOS.adminAurora);
    await expect(franja(page)).toContainText('Salon Aurora');
    await expect(franja(page)).not.toContainText('Fogon');
    await expect(chip(page)).toHaveText('PRUEBA');
  });
});

test.describe('Usuarios', () => {
  test.beforeEach(() => { prepararDatos(); });

  test('lista a los usuarios del comercio con su rol y su estado, y ofrece los dos roles para invitar', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Usuarios', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Usuarios del negocio' })).toBeVisible();
    await expect(page.getByRole('row', { name: /admin\.fogon@ejemplo\.com.*admin.*activo/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Operador — solo lee conversaciones/ })).toBeAttached();
    await expect(page.getByRole('option', { name: /Administrador — además edita la configuración/ })).toBeAttached();
  });

  test('NEGATIVA (aislamiento): no aparecen los usuarios de otro comercio', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Usuarios', exact: true }).click();
    await expect(page.getByRole('row', { name: /admin\.fogon/ })).toBeVisible();
    await expect(page.getByText('admin.aurora@ejemplo.com')).toHaveCount(0);
    await expect(page.getByText('operador.aurora@ejemplo.com')).toHaveCount(0);
  });
});
