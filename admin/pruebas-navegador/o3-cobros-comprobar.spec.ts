import { test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import prepararDatos from './preparar-datos';
import { crearUsuarioDeEnsayo, leerDoc, limpiarCierres, sembrarCierre } from './ayudas/datos';
import {
  FOGON, UID_ADMIN_FOGON, clienteDeReglas, entrar, esperar as expect, nombreDoc, sembrarCierreCrudo, type ClienteDeReglas,
} from './ayudas/o3-datos';

/**
 * COB-07 — «Comprobar»: el negocio afirma que lo vio en su banco. Se marca UNA vez (`comprobadoPor` + `comprobadoEn`), no se desmarca ni se
 * reescribe, no lo escribe el operador ni el administrador de otro comercio, y NovuChat nunca lo marca solo (prohibición 3).
 * Cada negativa se prueba por la pantalla Y por un cliente que obedece las reglas (token de un usuario real del emulador), con control positivo.
 */

const cierre = (id: string) => `tenants/${FOGON}/cierres/${id}`;
const fila = (page: Page, monto: string) => page.getByRole('row', { name: new RegExp(`(?<![\\d.])${monto} Bs`) });

async function abrirCobros(page: Page, correo: string = USUARIOS.adminFogon): Promise<void> {
  await entrar(page, correo);
  await page.goto(`/negocio/${FOGON}/cobros`);
  await expect(page.getByRole('heading', { name: 'Cobros', exact: true, level: 2 })).toBeVisible();
}

/** El sello de comprobación tal como lo escribe la consola: uid de quien lo marca y hora del servidor. */
function comprobar(id: string, uid: string, extra: { campos?: Record<string, unknown>; mascara?: string[] } = {}): unknown[] {
  return [{
    update: { name: nombreDoc(cierre(id)), fields: { comprobadoPor: { stringValue: uid }, ...extra.campos } },
    updateMask: { fieldPaths: ['comprobadoPor', ...(extra.mascara ?? [])] },
    updateTransforms: [{ fieldPath: 'comprobadoEn', setToServerValue: 'REQUEST_TIME' }],
    currentDocument: { exists: true },
  }];
}

test.describe('COB-07 · «Comprobar» (el negocio afirma que lo vio en su banco)', () => {
  test.beforeEach(async () => {
    test.setTimeout(90_000);
    prepararDatos();
    await limpiarCierres(FOGON);
    await limpiarCierres('salon-aurora');
  });

  test('el administrador comprueba: la fila pasa a «Comprobado por el negocio», se guarda quién y cuándo, el botón desaparece y las cifras se mueven', async ({ page }) => {
    await sembrarCierre(FOGON, { id: 'c1', monto: 110, cotejo: { resultado: 'cuadra', montoLeido: 110 } });
    await sembrarCierre(FOGON, { id: 'c2', monto: 55 });
    await abrirCobros(page);
    await expect(fila(page, '110')).toContainText('Datos coinciden');
    await expect(fila(page, '110')).toContainText('Sin comprobar'); // un cotejo que cuadra NO comprueba nada
    await fila(page, '110').getByRole('button', { name: 'Comprobar' }).click();
    await expect(fila(page, '110')).toContainText('Comprobado por el negocio');
    await expect(fila(page, '110').getByRole('button', { name: 'Comprobar' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    // El otro no se tocó.
    await expect(fila(page, '55')).toContainText('Sin comprobar');
    await expect(fila(page, '55').getByRole('button', { name: 'Comprobar' })).toBeVisible();
    // Las cifras: 1 comprobado y 1 sin comprobar.
    const tarjeta = page.locator('article.tarjeta').filter({ has: page.getByRole('heading', { name: 'Comprobados', exact: true }) });
    await expect(tarjeta.locator('.dato strong').nth(0)).toHaveText('1');
    await expect(tarjeta.locator('.dato strong').nth(1)).toHaveText('1');
    // El documento: quién (uid del administrador) y cuándo (hora del servidor), en el cierre correcto.
    const c1 = await leerDoc(cierre('c1'));
    expect(c1?.['comprobadoPor']).toBe(UID_ADMIN_FOGON);
    expect(typeof (c1?.['comprobadoEn'] as { toMillis?: () => number } | undefined)?.toMillis).toBe('function');
    expect(Math.abs((c1?.['comprobadoEn'] as { toMillis: () => number }).toMillis() - Date.now())).toBeLessThan(120_000);
    expect((await leerDoc(cierre('c2')))?.['comprobadoPor']).toBeUndefined();
    // El detalle lo dice con la hora.
    await fila(page, '110').getByRole('button', { name: 'Ver' }).click();
    await expect(page.getByRole('dialog', { name: 'Detalle del cobro' })).toContainText('Comprobado por el negocio el');
  });

  test('NEGATIVA: la pantalla no ofrece desmarcar un cobro comprobado (solo «Ver») y recargar lo deja igual', async ({ page }) => {
    await sembrarCierre(FOGON, { id: 'c1', monto: 110, comprobado: true });
    await abrirCobros(page);
    const botones = await fila(page, '110').getByRole('button').allInnerTexts();
    expect(botones).toEqual(['Ver']);
    await expect(fila(page, '110')).not.toContainText(/desmarcar|quitar|deshacer/i);
    await page.reload();
    await expect(fila(page, '110')).toContainText('Comprobado por el negocio');
  });

  test('NEGATIVA (reglas): un cobro comprobado no se vuelve a comprobar, no se desmarca, no se borra ni se le cambia el monto', async () => {
    await sembrarCierre(FOGON, { id: 'c1', monto: 110 });
    await sembrarCierre(FOGON, { id: 'c2', monto: 55 });
    const admin: ClienteDeReglas = await clienteDeReglas(USUARIOS.adminFogon);
    // Control positivo: el mismo escrito, sobre un cierre sin sello, SÍ pasa.
    expect(await admin.lote(comprobar('c1', admin.uid))).toMatchObject({ ok: true });
    const sello = await leerDoc(cierre('c1'));
    expect(sello?.['comprobadoPor']).toBe(admin.uid);

    // Reescribirlo (otra hora, el mismo uid): se rechaza.
    expect((await admin.lote(comprobar('c1', admin.uid))).codigo).toBe('PERMISSION_DENIED');
    // Desmarcarlo (borrar el campo): se rechaza.
    const desmarcar = [{
      update: { name: nombreDoc(cierre('c1')), fields: {} }, updateMask: { fieldPaths: ['comprobadoPor', 'comprobadoEn'] },
      currentDocument: { exists: true },
    }];
    expect((await admin.lote(desmarcar)).codigo).toBe('PERMISSION_DENIED');
    // Borrar el cierre: se rechaza.
    expect((await admin.lote([{ delete: nombreDoc(cierre('c1')) }])).codigo).toBe('PERMISSION_DENIED');
    // Cambiar el monto de un cierre (con o sin sello): se rechaza.
    const monto = [{
      update: { name: nombreDoc(cierre('c2')), fields: { monto: { integerValue: '1' } } }, updateMask: { fieldPaths: ['monto'] }, currentDocument: { exists: true },
    }];
    expect((await admin.lote(monto)).codigo).toBe('PERMISSION_DENIED');
    // Comprobar y cambiar el monto en el mismo lote: se rechaza (el sello es la ÚNICA escritura permitida).
    expect((await admin.lote(comprobar('c2', admin.uid, { campos: { monto: { integerValue: '1' } }, mascara: ['monto'] }))).codigo).toBe('PERMISSION_DENIED');

    // Nada cambió.
    const despues = await leerDoc(cierre('c1'));
    expect(despues?.['comprobadoPor']).toBe(admin.uid);
    expect((despues?.['comprobadoEn'] as { toMillis: () => number }).toMillis()).toBe((sello?.['comprobadoEn'] as { toMillis: () => number }).toMillis());
    const c2 = await leerDoc(cierre('c2'));
    expect(c2?.['monto']).toBe(55);
    expect(c2?.['comprobadoPor']).toBeUndefined();
  });

  test('NEGATIVA (reglas): no se puede firmar con el uid de otra persona ni con una hora puesta a mano', async () => {
    await sembrarCierre(FOGON, { id: 'c1', monto: 110 });
    const admin = await clienteDeReglas(USUARIOS.adminFogon);
    expect((await admin.lote(comprobar('c1', 'u-otra-persona'))).codigo).toBe('PERMISSION_DENIED');
    const horaPropia = [{
      update: { name: nombreDoc(cierre('c1')), fields: { comprobadoPor: { stringValue: admin.uid }, comprobadoEn: { timestampValue: '2020-01-01T00:00:00Z' } } },
      updateMask: { fieldPaths: ['comprobadoPor', 'comprobadoEn'] }, currentDocument: { exists: true },
    }];
    expect((await admin.lote(horaPropia)).codigo).toBe('PERMISSION_DENIED');
    expect((await leerDoc(cierre('c1')))?.['comprobadoPor']).toBeUndefined();
  });

  test('NEGATIVA: el operador ve la lista pero no tiene «Comprobar» ni «Exportar»; lo que ve es el estado y «Ver»', async ({ page }) => {
    await crearUsuarioDeEnsayo({ uid: 'u-oper-fogon', correo: USUARIOS.operadorFogon, nombre: 'Operador Fogon', tenantId: FOGON, rol: 'oper' });
    await sembrarCierre(FOGON, { id: 'c1', monto: 110, cotejo: { resultado: 'cuadra', montoLeido: 110 } });
    await sembrarCierre(FOGON, { id: 'c2', monto: 55, comprobado: true });
    // HOY el operador SÍ entra a Cobros si el negocio tiene Pedidos (Andres, 09/10/2026): la matriz del 06/10 decía que no entraba.
    await abrirCobros(page, USUARIOS.operadorFogon);
    await expect(fila(page, '110')).toContainText('Sin comprobar');
    await expect(fila(page, '55')).toContainText('Comprobado por el negocio');
    await expect(page.getByRole('button', { name: 'Comprobar' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Exportar/ })).toHaveCount(0);
    expect(await fila(page, '110').getByRole('button').allInnerTexts()).toEqual(['Ver']);
    // El detalle tampoco ofrece comprobar.
    await fila(page, '110').getByRole('button', { name: 'Ver' }).click();
    await expect(page.getByRole('dialog', { name: 'Detalle del cobro' })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Comprobar' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect((await leerDoc(cierre('c1')))?.['comprobadoPor']).toBeUndefined();
  });

  test('NEGATIVA (reglas): el operador no puede comprobar un cobro (PERMISSION_DENIED) aunque SÍ puede leerlo; el cobro queda sin sello', async () => {
    await crearUsuarioDeEnsayo({ uid: 'u-oper-fogon', correo: USUARIOS.operadorFogon, nombre: 'Operador Fogon', tenantId: FOGON, rol: 'oper' });
    await sembrarCierre(FOGON, { id: 'c1', monto: 110 });
    const oper = await clienteDeReglas(USUARIOS.operadorFogon);
    const r = await oper.lote(comprobar('c1', oper.uid));
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe('PERMISSION_DENIED');
    expect((await leerDoc(cierre('c1')))?.['comprobadoPor']).toBeUndefined();
    // Hallazgo R8 de la matriz: lo lee por SDK aunque el menú no se lo ofrezca (hoy además la pantalla se lo muestra).
    expect((await oper.leer(cierre('c1'))).estado).toBe(200);
  });

  test('NEGATIVA: el administrador de OTRO comercio no ve los cobros de este por la pantalla, y por las reglas ni los lee ni los comprueba', async ({ page }) => {
    await sembrarCierre(FOGON, { id: 'c1', monto: 110 });
    await entrar(page, USUARIOS.adminAurora);
    await page.goto(`/negocio/${FOGON}/cobros`);
    await page.waitForTimeout(2000);
    await expect(fila(page, '110')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Comprobar' })).toHaveCount(0);

    const ajeno = await clienteDeReglas(USUARIOS.adminAurora);
    expect((await ajeno.lote(comprobar('c1', ajeno.uid))).codigo).toBe('PERMISSION_DENIED');
    expect((await ajeno.leer(cierre('c1'))).estado).toBe(403);
    expect((await leerDoc(cierre('c1')))?.['comprobadoPor']).toBeUndefined();
  });

  test('NEGATIVA: si el servidor rechaza la comprobación, la pantalla lo dice, no cambia la fila y no toca el documento', async ({ page }) => {
    // Un sello que existe pero NO es un texto (dato corrupto): la pantalla lo toma por «sin comprobar» y ofrece el botón, y la regla
    // («no se reescribe un sello que ya existe») lo rechaza. Es el único camino honesto para ver el mensaje de rechazo.
    await sembrarCierreCrudo(FOGON, 'c1', {
      tipo: 'pedido', moneda: 'Bs', telefonoEnmascarado: '*** 0031', referencia: 'C1', monto: 110, ocurridoEn: new Date(), comprobadoPor: 12345,
    });
    await abrirCobros(page);
    await fila(page, '110').getByRole('button', { name: 'Comprobar' }).click();
    await expect(page.getByRole('alert')).toHaveText('El servidor rechazó la comprobación. Revise que siga teniendo permiso.');
    await expect(fila(page, '110')).toContainText('Sin comprobar');
    expect((await leerDoc(cierre('c1')))?.['comprobadoPor']).toBe(12345);
  });

  test('NovuChat nunca lo marca solo: un cobro con el cotejo que «cuadra» sigue sin comprobar y ofrece el botón', async ({ page }) => {
    await sembrarCierre(FOGON, { id: 'c1', monto: 110, cotejo: { resultado: 'cuadra', montoLeido: 110, banco: 'Banco de Prueba', intentos: 1 } });
    await abrirCobros(page);
    await expect(fila(page, '110')).toContainText('Datos coinciden');
    await expect(fila(page, '110')).toContainText('Sin comprobar');
    await expect(fila(page, '110').getByRole('button', { name: 'Comprobar' })).toBeVisible();
    await page.waitForTimeout(1500);
    expect((await leerDoc(cierre('c1')))?.['comprobadoPor']).toBeUndefined();
  });
});
