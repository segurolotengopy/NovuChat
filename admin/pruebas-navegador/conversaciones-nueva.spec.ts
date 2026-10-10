import { expect, test, type Page } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';
import { USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { crearUsuarioDeEnsayo, leerCampo, limpiarConversaciones, sembrarConversacion, type MensajeDePrueba } from './ayudas/datos';
import prepararDatos, { fijarPantallaConversaciones } from './preparar-datos';
import { palabrasDe, trozosDeTelefono } from '../functions/src/core/conversacion/normalizacion';

/**
 * LA PANTALLA NUEVA DE CONVERSACIONES (H1), detrás de la bandera `tenants/{id}.consolaConversaciones = 'nueva'`.
 * `conversaciones.spec.ts` sigue probando la pantalla de siempre (sin bandera) y no se toca: aquí la bandera se enciende en
 * cada prueba y se quita al terminar, para que las dos suites no se pisen.
 *
 * Los teléfonos son sintéticos (seis ceros seguidos). Los campos nuevos (`telefonoTrozos`, `nombrePalabras`, `ultimoEntranteEn`,
 * `ventanaVenceEn`, `noLeidos`, `sinLeer`, `atencionEstado`) se escriben con la función de Core, la misma que usa la ingesta.
 * La búsqueda por PALABRA llama a la Function `buscarConversaciones`: aquí no hay Functions, y se prueba que la pantalla lo
 * dice con claridad y no se rompe.
 */

const FOGON = 'parrilla-el-fogon';
const TEL_47 = '59100000047';
const TEL_74 = '59100000074';
const TEL_12 = '59100000012';
const HORA = 3_600_000;

interface OpcionesCampos { noLeidos?: number; entranteHaceMin?: number; estado?: string }

/** Los campos de una conversación tal como los dejará la ingesta (H1). */
function campos(telefono: string, nombre: string, o: OpcionesCampos = {}): Record<string, unknown> {
  const entrante = Date.now() - (o.entranteHaceMin ?? 5) * 60_000;
  const noLeidos = o.noLeidos ?? 0;
  return {
    nombreContacto: nombre,
    telefonoTrozos: trozosDeTelefono(telefono),
    nombrePalabras: palabrasDe(nombre, 6),
    ultimoEntranteEn: Timestamp.fromMillis(entrante),
    ventanaVenceEn: Timestamp.fromMillis(entrante + 24 * HORA),
    noLeidos,
    sinLeer: noLeidos > 0,
    atencionEstado: o.estado ?? 'normal',
  };
}

const HOLA: MensajeDePrueba[] = [
  { direccion: 'entrante', texto: 'Hola, quiero pedir', minutosAtras: 30 },
  { direccion: 'saliente', texto: 'Claro, ¿para delivery o recoger?', minutosAtras: 29 },
  { direccion: 'entrante', texto: 'Para recoger', minutosAtras: 28 },
];

async function abrirConversaciones(page: Page, correo: string = USUARIOS.adminFogon): Promise<void> {
  await ingresar(page, correo);
  await page.getByRole('link', { name: 'Conversaciones', exact: true }).click();
  await expect(page.getByTestId('lista')).toBeVisible();
}

const fila = (page: Page, texto: string | RegExp) => page.locator('.cv-ficha', { hasText: texto });

test.describe('Conversaciones (pantalla nueva)', () => {
  test.beforeEach(async () => {
    prepararDatos();
    await limpiarConversaciones(FOGON);
    await fijarPantallaConversaciones(FOGON, 'nueva');
  });
  test.afterEach(async () => { await fijarPantallaConversaciones(FOGON, null); });

  test('con la bandera se ve la pantalla nueva: lista, filtros SIN «El asistente atiende» y ningún Tomar ni campo para escribir', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL_47, HOLA, campos(TEL_47, 'Ximena P.', { noLeidos: 2 }));
    await abrirConversaciones(page);
    await expect(fila(page, 'Ximena P.')).toContainText('Para recoger');
    for (const chip of ['Todas', 'Necesita humano', 'No leídas', 'Ventana por vencer']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${chip}`) })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: /El asistente atiende/ })).toHaveCount(0);
    await fila(page, 'Ximena P.').click();
    await expect(page.getByTestId('detalle')).toBeVisible();
    await expect(page.getByRole('button', { name: /Tomar|Devolver/ })).toHaveCount(0);
    await expect(page.locator('textarea')).toHaveCount(0);
    await expect(page.getByText(/PROTOTIPO|simulaci/i)).toHaveCount(0);
  });

  test('abrir una conversación pone su id en la dirección y muestra sus mensajes en orden; recargar en esa dirección la vuelve a abrir (enlace profundo)', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL_47, HOLA, campos(TEL_47, 'Ximena P.'));
    await abrirConversaciones(page);
    await fila(page, 'Ximena P.').click();
    await expect(page).toHaveURL(new RegExp(`/negocio/${FOGON}/conversaciones/wa_${TEL_47}$`));
    const mensajes = page.locator('ol.cv-mensajes li');
    await expect(mensajes).toHaveCount(3);
    await expect(mensajes.nth(0)).toContainText('Hola, quiero pedir');
    await expect(mensajes.nth(2)).toContainText('Para recoger');
    await page.reload();
    await expect(page.locator('ol.cv-mensajes li')).toHaveCount(3);
    await expect(page.getByTestId('detalle')).toContainText('Ximena P.');
  });

  test('abrir una conversación sin leer la marca leída en la base: solo `noLeidos` y `sinLeer`, nada más', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL_47, HOLA, campos(TEL_47, 'Ximena P.', { noLeidos: 3 }));
    await abrirConversaciones(page);
    await expect(page.getByRole('button', { name: /^No leídas/ })).toContainText('1');
    await fila(page, 'Ximena P.').click();
    await expect.poll(() => leerCampo(`tenants/${FOGON}/conversaciones/wa_${TEL_47}`, 'noLeidos')).toBe(0);
    expect(await leerCampo(`tenants/${FOGON}/conversaciones/wa_${TEL_47}`, 'sinLeer')).toBe(false);
    expect(await leerCampo(`tenants/${FOGON}/conversaciones/wa_${TEL_47}`, 'ultimoMensaje')).toBe('Para recoger');
    expect(await leerCampo(`tenants/${FOGON}/conversaciones/wa_${TEL_47}`, 'atencionEstado')).toBe('normal');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('el operador del negocio también la marca', async ({ page }) => {
    await crearUsuarioDeEnsayo({ uid: 'u-oper-fogon-h1', correo: USUARIOS.operadorFogon, nombre: 'Luis (prueba)', tenantId: FOGON, rol: 'oper' });
    await sembrarConversacion(FOGON, TEL_12, HOLA, campos(TEL_12, 'Marcela R.', { noLeidos: 2 }));
    await abrirConversaciones(page, USUARIOS.operadorFogon);
    await fila(page, 'Marcela R.').click();
    await expect.poll(() => leerCampo(`tenants/${FOGON}/conversaciones/wa_${TEL_12}`, 'noLeidos')).toBe(0);
  });

  test('NEGATIVA: una conversación de antes de H1 (sin ningún campo nuevo) se ve, no tiene pastilla de ventana y no se escribe nada al abrirla', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL_74, HOLA, { nombreContacto: 'Pablo Q.' });
    await abrirConversaciones(page);
    await expect(fila(page, 'Pablo Q.')).toBeVisible();
    await fila(page, 'Pablo Q.').click();
    await expect(page.locator('ol.cv-mensajes li')).toHaveCount(3);
    await expect(page.locator('.cv-pastilla')).toHaveCount(0);
    await expect(fila(page, 'Pablo Q.').locator('.cv-contador')).toHaveCount(0);
    await page.waitForTimeout(2_500);   // más que el rebote de 1 s: si fuera a escribir, ya lo habría hecho
    expect(await leerCampo(`tenants/${FOGON}/conversaciones/wa_${TEL_74}`, 'noLeidos')).toBeUndefined();
    expect(await leerCampo(`tenants/${FOGON}/conversaciones/wa_${TEL_74}`, 'sinLeer')).toBeUndefined();
  });

  test('buscar por teléfono: los últimos 4, el número sin prefijo y el pegado con «+591»; dos números parecidos no se confunden', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL_47, HOLA, campos(TEL_47, 'Ximena P.'));
    await sembrarConversacion(FOGON, TEL_74, HOLA, campos(TEL_74, 'Mauricio T.'));
    await sembrarConversacion(FOGON, TEL_12, HOLA, campos(TEL_12, 'Marcela R.'));
    await abrirConversaciones(page);
    const buscador = page.getByLabel('Buscar conversaciones por teléfono, nombre o palabra');
    for (const escrito of ['0047', '00000047', '+591 000 00047']) {
      await buscador.fill(escrito);
      await expect(fila(page, 'Ximena P.')).toBeVisible();
      await expect(page.locator('.cv-ficha')).toHaveCount(1);
      await expect(fila(page, 'Mauricio T.')).toHaveCount(0);
    }
    await buscador.fill('0074');
    await expect(fila(page, 'Mauricio T.')).toBeVisible();
    await expect(page.locator('.cv-ficha')).toHaveCount(1);
    // menos de 4 dígitos no busca
    await buscador.fill('47');
    await expect(page.getByText('Escriba al menos 4 dígitos para buscar por teléfono.')).toBeVisible();
  });

  test('buscar por nombre', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL_47, HOLA, campos(TEL_47, 'Ximena P.'));
    await sembrarConversacion(FOGON, TEL_12, HOLA, campos(TEL_12, 'Marcela Ríos'));
    await abrirConversaciones(page);
    await page.getByLabel('Buscar conversaciones por teléfono, nombre o palabra').fill('marcela');
    await expect(fila(page, 'Marcela Ríos')).toBeVisible();
    await expect(fila(page, 'Ximena P.')).toHaveCount(0);
  });

  test('la búsqueda por palabra sin la Function desplegada lo dice con claridad y NO rompe la pantalla (el nombre sigue funcionando)', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL_12, HOLA, campos(TEL_12, 'Marcela Ríos'));
    await abrirConversaciones(page);
    const buscador = page.getByLabel('Buscar conversaciones por teléfono, nombre o palabra');
    await buscador.fill('marcela');
    await expect(page.locator('.cv-error-busqueda')).toContainText(/no está disponible/);
    await expect(fila(page, 'Marcela Ríos')).toBeVisible();          // lo del nombre no se perdió
    await buscador.fill('');
    await expect(page.getByRole('button', { name: /^Todas/ })).toBeVisible();   // y la lista vuelve
    await expect(fila(page, 'Marcela Ríos')).toBeVisible();
  });

  test('filtro «No leídas»: el contador sale del servidor y la lista deja solo las no leídas', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL_47, HOLA, campos(TEL_47, 'Ximena P.', { noLeidos: 2 }));
    await sembrarConversacion(FOGON, TEL_74, HOLA, campos(TEL_74, 'Mauricio T.'));
    await sembrarConversacion(FOGON, TEL_12, HOLA, campos(TEL_12, 'Marcela R.', { noLeidos: 1 }));
    await abrirConversaciones(page);
    await expect(page.getByRole('button', { name: /^Todas/ })).toContainText('3');
    await expect(page.getByRole('button', { name: /^No leídas/ })).toContainText('2');
    await page.getByRole('button', { name: /^No leídas/ }).click();
    await expect(page.locator('.cv-ficha')).toHaveCount(2);
    await expect(fila(page, 'Mauricio T.')).toHaveCount(0);
  });

  test('filtro «Necesita humano»: solo el estado operador/bloqueado de las últimas 24 h', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL_47, HOLA, campos(TEL_47, 'Ximena P.', { estado: 'operador' }));
    await sembrarConversacion(FOGON, TEL_74, HOLA, campos(TEL_74, 'Mauricio T.', { estado: 'normal' }));
    await sembrarConversacion(FOGON, TEL_12,
      [{ direccion: 'entrante', texto: 'hace dos días', minutosAtras: 48 * 60 }], campos(TEL_12, 'Marcela R.', { estado: 'operador', entranteHaceMin: 48 * 60 }));
    await abrirConversaciones(page);
    await page.getByRole('button', { name: /^Necesita humano/ }).click();
    await expect(page.locator('.cv-ficha')).toHaveCount(1);
    await expect(fila(page, 'Ximena P.')).toContainText('Necesita humano');
  });

  test('«Cargar más»: la primera página trae 50 y el botón trae las que faltan', async ({ page }) => {
    for (let i = 0; i < 55; i++) {
      const tel = `591000000${String(i).padStart(2, '0')}`;
      await sembrarConversacion(FOGON, tel, [], campos(tel, `Contacto ${String(i).padStart(2, '0')}`));
    }
    await abrirConversaciones(page);
    await expect(page.locator('.cv-ficha')).toHaveCount(50);
    await page.getByRole('button', { name: 'Cargar más conversaciones' }).click();
    await expect(page.locator('.cv-ficha')).toHaveCount(55);
    await expect(page.getByRole('button', { name: 'Cargar más conversaciones' })).toHaveCount(0);
  });

  test('NEGATIVA: el HTML de un mensaje se ve como texto, no se ejecuta', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL_47, [
      { direccion: 'entrante', texto: '<img src=x onerror="window.__xss=1"><b>negrita</b>', minutosAtras: 5 },
    ], campos(TEL_47, 'Ximena P.'));
    await abrirConversaciones(page);
    await fila(page, 'Ximena P.').click();
    await expect(page.locator('ol.cv-mensajes li')).toContainText('<b>negrita</b>');
    await expect(page.locator('ol.cv-mensajes img, ol.cv-mensajes b')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test('«No contactar» se enciende y queda guardado, y no toca los no leídos', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL_47, HOLA, campos(TEL_47, 'Ximena P.'));
    await abrirConversaciones(page);
    await fila(page, 'Ximena P.').click();
    const casilla = page.getByLabel('No contactar');
    await casilla.click();
    await expect(casilla).toBeChecked();
    await expect.poll(() => leerCampo(`tenants/${FOGON}/conversaciones/wa_${TEL_47}`, 'noContactar')).toBe(true);
    expect(await leerCampo(`tenants/${FOGON}/conversaciones/wa_${TEL_47}`, 'noLeidos')).toBe(0);
  });

  test('una dirección con una conversación que no existe lo dice y no rompe la lista', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL_47, HOLA, campos(TEL_47, 'Ximena P.'));
    await abrirConversaciones(page);
    await page.goto(`/negocio/${FOGON}/conversaciones/wa_59100000099`);
    await expect(page.getByText('No se encontró esa conversación.')).toBeVisible();
    await expect(fila(page, 'Ximena P.')).toBeVisible();
  });

  test('NEGATIVA (aislamiento): las conversaciones de otro comercio no se ven', async ({ page }) => {
    await sembrarConversacion('salon-aurora', '59100000099', [{ direccion: 'entrante', texto: 'secreto de la peluquería', minutosAtras: 5 }],
      campos('59100000099', 'Cliente Aurora'));
    await sembrarConversacion(FOGON, TEL_47, HOLA, campos(TEL_47, 'Ximena P.'));
    await abrirConversaciones(page);
    await expect(fila(page, 'Ximena P.')).toBeVisible();
    await expect(page.getByText('secreto de la peluquería')).toHaveCount(0);
    await expect(page.getByText('Cliente Aurora')).toHaveCount(0);
    // Ni siquiera con la dirección exacta de la conversación del otro comercio.
    await page.goto(`/negocio/salon-aurora/conversaciones/wa_59100000099`);
    await expect(page.getByText('secreto de la peluquería')).toHaveCount(0);
    await limpiarConversaciones('salon-aurora');
  });
});

test.describe('Conversaciones (sin la bandera)', () => {
  test('sin bandera (o con otro valor) se ve la pantalla de siempre, no la nueva', async ({ page }) => {
    prepararDatos();
    await limpiarConversaciones(FOGON);
    await fijarPantallaConversaciones(FOGON, null);
    await sembrarConversacion(FOGON, TEL_47, HOLA, campos(TEL_47, 'Ximena P.'));
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Conversaciones', exact: true }).click();
    // La de siempre lista con botones por teléfono; la nueva no tiene `data-testid="lista"`.
    await expect(page.getByRole('button', { name: new RegExp(TEL_47) })).toBeVisible();
    await expect(page.getByTestId('lista')).toHaveCount(0);
    await fijarPantallaConversaciones(FOGON, 'clasica');
    await page.reload();
    await expect(page.getByRole('button', { name: new RegExp(TEL_47) })).toBeVisible();
    await fijarPantallaConversaciones(FOGON, null);
  });
});
