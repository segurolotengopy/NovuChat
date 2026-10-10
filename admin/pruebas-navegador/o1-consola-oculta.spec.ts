import { expect, test, type Page } from '@playwright/test';
import { USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { fijarCobroReal, fijarConsolaOculta, fijarModulos, leerDoc, leerFicha } from './ayudas/datos';
import {
  CORREO_PROPIETARIO_SIMULADO, FOGON, MODULOS_QTACO, crearPropietarioSimulado, enlacesDelMenu, escribirComoUsuario, fijarDoc,
} from './ayudas/o1-comun';
import prepararDatos from './preparar-datos';

/**
 * CONSOLA OCULTA (`tenants/{id}.consolaOculta`): lo que NovuChat decidió no pintarle a un comercio. Ids cerrados:
 * `horario`, `hoy`, `invitar`, `pagar`, `reemplazoQr` (`functions/src/central/consola-oculta.ts`).
 *
 * OCULTAR ES SOLO PRESENTACIÓN: el servidor no cambia. Acá se prueba (1) que cada id oculta SU pieza y no las demás, (2) que sin el
 * id todo sigue como siempre, (3) que un id desconocido o un valor que no es lista no oculta nada, (4) que el propietario de NovuChat
 * lo ve todo y (5) que el comercio no puede escribir la lista ni desocultar nada por su cuenta, mientras que lo oculto (Horario)
 * sigue permitido por el servidor si alguien lo pide a mano. Las callables de Invitar, Pagar y el registro del QR NO se prueban acá
 * (no hay emulador de Functions): su permiso lo cubren las pruebas de `functions/`.
 *
 * Una pieza oculta se comprueba DESPUÉS de una espera corta: mientras la lista carga la consola tampoco la pinta, y sin la espera
 * «oculta» pasaría aun con la pieza que sí debe verse. El caso sin id (que espera de verdad hasta que aparece) prueba que llega a tiempo.
 */

const IDS = ['horario', 'hoy', 'invitar', 'pagar', 'reemplazoQr'] as const;
type Id = (typeof IDS)[number];

const REGISTRADO_ACTIVO = { nombreCuenta: 'Q Taco de Prueba SRL', cuentas: ['123456789'], banco: 'Banco de Prueba', venceEl: '2027-12-31', activo: true };

const ESPERA_DE_LA_LISTA_MS = 1000;

/** Abre la pantalla donde vive la pieza de `id`, la deja cargada, y dice si se ve. */
async function seVe(page: Page, id: Id, quiereVerla: boolean): Promise<boolean> {
  const marcar = async (pieza: ReturnType<Page['locator']>) => {
    if (quiereVerla) await expect(pieza).toBeVisible();
    else await page.waitForTimeout(ESPERA_DE_LA_LISTA_MS);
    return (await pieza.count()) > 0 && (await pieza.first().isVisible());
  };
  switch (id) {
    case 'horario': {
      await page.goto(`/negocio/${FOGON}/configuracion`);
      await expect(page.getByText('Cargando')).toBeHidden();
      await expect(page.getByRole('heading', { name: 'Voz del asistente' })).toBeVisible();
      return marcar(page.getByRole('heading', { name: 'Horario de atención (opcional)' }));
    }
    case 'hoy': {
      await page.goto('/');
      await expect(page.getByText('LO QUE EL ASISTENTE SABE OFRECER')).toBeVisible();
      return marcar(page.getByRole('heading', { level: 3, name: 'Hoy', exact: true }));
    }
    case 'invitar': {
      await page.goto(`/negocio/${FOGON}/usuarios`);
      await expect(page.getByRole('row', { name: /admin\.fogon@ejemplo\.com/ })).toBeVisible();
      return marcar(page.getByRole('heading', { name: 'Invitar', exact: true }));
    }
    case 'pagar': {
      await page.goto(`/negocio/${FOGON}/consumo`);
      await expect(page.getByRole('heading', { name: 'Consumo', level: 2 })).toBeVisible();
      return marcar(enlacesDelMenu(page).filter({ hasText: /^Pagar$/ }));
    }
    case 'reemplazoQr': {
      await page.goto(`/negocio/${FOGON}/cobro`);
      await expect(page.getByText('Cobrando', { exact: true })).toBeVisible();
      return marcar(page.getByRole('heading', { name: 'Cambiar el QR' }));
    }
  }
}

test.describe('Consola oculta', () => {
  test.beforeEach(async () => {
    prepararDatos();
    await fijarModulos(FOGON, MODULOS_QTACO);
    await fijarCobroReal(FOGON, REGISTRADO_ACTIVO);
  });
  test.afterAll(async () => {
    await fijarConsolaOculta(FOGON, null);
    await fijarCobroReal(FOGON, null);
    await fijarModulos(FOGON, null);
  });

  test('sin lista (el comercio de siempre) se ve todo: horario, tarjeta «Hoy», Invitar, Pagar y Cambiar el QR', async ({ page }) => {
    expect((await leerFicha(FOGON))['consolaOculta']).toBeUndefined();
    await ingresar(page, USUARIOS.adminFogon);
    for (const id of IDS) expect(await seVe(page, id, true), `sin lista debe verse «${id}»`).toBe(true);
  });

  for (const oculto of IDS) {
    test(`con «${oculto}» en la lista se oculta SOLO eso: las otras cuatro piezas se siguen viendo`, async ({ page }) => {
      await fijarConsolaOculta(FOGON, [oculto]);
      await ingresar(page, USUARIOS.adminFogon);
      for (const id of IDS) {
        // El orden importa poco; lo que se mira es cada pieza contra su propia pantalla.
        expect(await seVe(page, id, id !== oculto), `con «${oculto}» oculto, «${id}» ${id === oculto ? 'no debe verse' : 'debe verse'}`).toBe(id !== oculto);
      }
    });
  }

  test('con los cinco ids a la vez no se ve ninguna de las cinco piezas, pero las pantallas y el resto del menú siguen', async ({ page }) => {
    await fijarConsolaOculta(FOGON, [...IDS]);
    await ingresar(page, USUARIOS.adminFogon);
    for (const id of IDS) expect(await seVe(page, id, false), `«${id}» no debe verse`).toBe(false);
    // Lo demás no se ocultó de más: Configuración sigue con su formulario, Usuarios con su tabla, el menú con sus enlaces.
    await page.goto(`/negocio/${FOGON}/usuarios`);
    await expect(page.getByRole('heading', { name: 'Usuarios del negocio' })).toBeVisible();
    await expect(page.getByRole('row', { name: /admin\.fogon@ejemplo\.com.*admin.*activo/ })).toBeVisible();
    await expect(enlacesDelMenu(page).filter({ hasText: /^Cuenta$/ })).toBeVisible();
    await expect(enlacesDelMenu(page).filter({ hasText: /^Bitácora$/ })).toBeVisible();
  });

  test('«reemplazoQr» oculto SIN cobro activo deja el formulario: el PRIMER QR siempre se puede registrar', async ({ page }) => {
    await fijarCobroReal(FOGON, null);
    await fijarConsolaOculta(FOGON, ['reemplazoQr']);
    await ingresar(page, USUARIOS.adminFogon);
    await page.goto(`/negocio/${FOGON}/cobro`);
    await expect(page.getByRole('heading', { name: 'Cargar mi QR' })).toBeVisible();
    await expect(page.getByLabel('Imagen del QR')).toBeVisible();
    // Registrado pero todavía sin cobrar: también se puede cambiar.
    await fijarCobroReal(FOGON, { ...REGISTRADO_ACTIVO, activo: false });
    await expect(page.getByRole('heading', { name: 'Cambiar el QR' })).toBeVisible();
  });

  test('«reemplazoQr» oculto con el cobro activo dice que se pida a NovuChat y no ofrece el formulario', async ({ page }) => {
    await fijarConsolaOculta(FOGON, ['reemplazoQr']);
    await ingresar(page, USUARIOS.adminFogon);
    await page.goto(`/negocio/${FOGON}/cobro`);
    await expect(page.getByText('Tu QR está cobrando. Para cambiarlo, comunícate con NovuChat')).toBeVisible();
    await expect(page.getByLabel('Imagen del QR')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Guardar mi QR' })).toHaveCount(0);
  });

  test('«pagar» oculto: la dirección /pagar vuelve al inicio, y sin el id la pantalla Pagar abre', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await page.goto(`/negocio/${FOGON}/pagar`);
    await expect(page.getByRole('heading', { name: 'Pagar', level: 2 })).toBeVisible();
    await fijarConsolaOculta(FOGON, ['pagar']);
    await page.goto(`/negocio/${FOGON}/pagar`);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    await expect(page.getByRole('heading', { name: 'Pagar', level: 2 })).toHaveCount(0);
  });

  test('«pagar» oculto: «Estado de cuenta» no ofrece el botón Pagar (y sin el id, con producción, sí)', async ({ page }) => {
    await fijarDoc(`tenants/${FOGON}/cuenta/estado`, { modalidad: 'prepago' });
    await ingresar(page, USUARIOS.adminFogon);
    await page.goto(`/negocio/${FOGON}/cuenta`);
    await expect(page.getByRole('heading', { name: 'Estado de cuenta' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pagar', exact: true })).toHaveCount(2); // el del menú y el botón de la pantalla
    await fijarConsolaOculta(FOGON, ['pagar']);
    await expect(page.getByRole('link', { name: 'Pagar', exact: true })).toHaveCount(0);
  });

  test('la lista cambia en vivo: al ocultar «hoy» la tarjeta desaparece sin recargar, y al quitar la lista vuelve', async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    const hoy = page.getByRole('heading', { level: 3, name: 'Hoy', exact: true });
    await expect(hoy).toBeVisible();
    await fijarConsolaOculta(FOGON, ['hoy']);
    await expect(hoy).toHaveCount(0);
    await fijarConsolaOculta(FOGON, null);
    await expect(hoy).toBeVisible();
  });

  test('NEGATIVA: un id desconocido no oculta nada (se ignora solo él, no a los conocidos que lo acompañan)', async ({ page }) => {
    await fijarConsolaOculta(FOGON, ['inventario', 'todo', 'Horario', '']);
    await ingresar(page, USUARIOS.adminFogon);
    for (const id of IDS) expect(await seVe(page, id, true), `con ids desconocidos debe verse «${id}»`).toBe(true);
    // Y uno conocido junto a uno desconocido sí oculta el conocido.
    await fijarConsolaOculta(FOGON, ['todo', 'invitar']);
    expect(await seVe(page, 'invitar', false)).toBe(false);
    expect(await seVe(page, 'horario', true)).toBe(true);
  });

  for (const [descripcion, valor] of [
    ['una cadena', 'pagar'], ['un objeto', { pagar: true, invitar: true }], ['un número', 7], ['null', null],
  ] as const) {
    test(`NEGATIVA: un valor que no es lista (${descripcion}) no oculta nada`, async ({ page }) => {
      await fijarConsolaOculta(FOGON, null);
      await fijarDoc(`tenants/${FOGON}`, { consolaOculta: valor });
      expect((await leerFicha(FOGON))['consolaOculta']).toEqual(valor);
      await ingresar(page, USUARIOS.adminFogon);
      for (const id of IDS) expect(await seVe(page, id, true), `con ${descripcion} debe verse «${id}»`).toBe(true);
    });
  }

  test('el propietario de NovuChat (claim de propietario) lo ve todo aunque la lista oculte los cinco', async ({ page }) => {
    // Propietario SIMULADO: cuenta de contraseña con `p: true` y administradora del comercio (la presentación depende solo del claim).
    await fijarConsolaOculta(FOGON, [...IDS]);
    await crearPropietarioSimulado(FOGON);
    await ingresar(page, CORREO_PROPIETARIO_SIMULADO);
    await page.goto(`/negocio/${FOGON}/configuracion`);
    await expect(page.getByRole('heading', { name: 'Horario de atención (opcional)' })).toBeVisible();
    await page.goto(`/negocio/${FOGON}/usuarios`);
    await expect(page.getByRole('heading', { name: 'Invitar', exact: true })).toBeVisible();
    await page.goto(`/negocio/${FOGON}/cobro`);
    await expect(page.getByRole('heading', { name: 'Cambiar el QR' })).toBeVisible();
    await page.goto(`/negocio/${FOGON}/pagar`);
    await expect(page.getByRole('heading', { name: 'Pagar', level: 2 })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/negocio/${FOGON}/pagar`);
    await expect(enlacesDelMenu(page).filter({ hasText: /^Pagar$/ })).toBeVisible();
    // «Hoy» vive en el Tablero del comercio; el propietario ve su propio panel, por eso no se prueba acá.
  });

  test('ocultar es solo presentación: con «horario» oculto el servidor SIGUE aceptando el horario si alguien lo escribe por el SDK', async () => {
    await fijarConsolaOculta(FOGON, ['horario']);
    const dias = { lun: '10:00-20:00', mar: '10:00-20:00', mie: '10:00-20:00', jue: '10:00-20:00', vie: '10:00-20:00', sab: '10:00-20:00', dom: 'cerrado' };
    const r = await escribirComoUsuario(USUARIOS.adminFogon, `tenants/${FOGON}/config/negocio`, { horarios: dias }, { conSelloDe: 'u-admin-fogon' });
    expect(r.aceptado, `estado ${r.estado}`).toBe(true);
    expect((await leerDoc(`tenants/${FOGON}/config/negocio`))?.['horarios']).toEqual(dias);
  });

  test('NEGATIVA: el comercio NO puede escribir la lista ni quitarse lo oculto (la ficha del comercio es solo del servidor)', async () => {
    await fijarConsolaOculta(FOGON, ['pagar']);
    const r = await escribirComoUsuario(USUARIOS.adminFogon, `tenants/${FOGON}`, { consolaOculta: [] });
    expect(r.aceptado).toBe(false);
    expect((await leerFicha(FOGON))['consolaOculta']).toEqual(['pagar']);
    const r2 = await escribirComoUsuario(USUARIOS.adminFogon, `tenants/${FOGON}`, { consolaOculta: ['horario'] });
    expect(r2.aceptado).toBe(false);
  });

  test('con «horario» oculto, guardar Configuración no valida ni toca los horarios (un día viejo con formato ilegible queda como está)', async ({ page }) => {
    await fijarConsolaOculta(FOGON, ['horario']);
    await fijarDoc(`tenants/${FOGON}/config/negocio`, { horarios: { lun: '09:00-19:00', mar: '09:00-19:00', mie: '09:00-19:00', jue: '09:00-19:00', vie: '09:00-20:00', sab: '09:00-14:00', dom: 'cerrado' } });
    await ingresar(page, USUARIOS.adminFogon);
    await page.goto(`/negocio/${FOGON}/configuracion`);
    await expect(page.getByRole('heading', { name: 'Voz del asistente' })).toBeVisible();
    await page.getByLabel('Descripción').fill('Parrilla y comida al paso. Pedidos para llevar y mesas.');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('p[role="status"]:not(.ayuda)')).toContainText('Guardado');
    const doc = await leerDoc(`tenants/${FOGON}/config/negocio`);
    expect(doc?.['descripcion']).toBe('Parrilla y comida al paso. Pedidos para llevar y mesas.');
    expect(doc?.['horarios']).toEqual({ lun: '09:00-19:00', mar: '09:00-19:00', mie: '09:00-19:00', jue: '09:00-19:00', vie: '09:00-20:00', sab: '09:00-14:00', dom: 'cerrado' });
  });
});
