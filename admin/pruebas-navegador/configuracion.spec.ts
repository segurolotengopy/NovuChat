import { expect, test } from '@playwright/test';
import { USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { abrirConfiguracion, cargarDia, DIAS, resultadoDeGuardar } from './ayudas/configuracion';
import { leerDoc } from './ayudas/datos';
import { simularFuncion } from './ayudas/funciones';
import { FOGON, escribirSinTope } from './ayudas/o1-comun';
import prepararDatos from './preparar-datos';

test.describe('Configuración: horarios', () => {
  test.beforeEach(async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await abrirConfiguracion(page);
  });

  test('guarda los 7 días y, al volver a entrar, los muestra', async ({ page }) => {
    for (const dia of DIAS.slice(0, 5)) await cargarDia(page, dia, { desde: '12:00', hasta: '22:00' });
    await cargarDia(page, 'Sábado', { desde: '12:00', hasta: '23:00' });
    await cargarDia(page, 'Domingo', 'cerrado');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('Guardado');

    await page.reload();
    await abrirConfiguracion(page);
    await expect(page.getByLabel('Lunes, desde')).toHaveValue('12:00');
    await expect(page.getByLabel('Sábado, hasta')).toHaveValue('23:00');
    await expect(page.locator('.horario-dia', { has: page.getByText('Domingo', { exact: true }) }).getByLabel('Cerrado')).toBeChecked();
  });

  test('NEGATIVA: un día con solo la hora de apertura no se guarda y dice cuál', async ({ page }) => {
    await page.getByLabel('Lunes, desde').fill('12:00');
    await page.getByLabel('Lunes, hasta').fill('');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('Revisa el horario de atención');
    await expect(resultadoDeGuardar(page)).not.toContainText('Guardado');
  });

  test('NEGATIVA: un cierre antes de la apertura no se guarda', async ({ page }) => {
    await page.getByLabel('Martes, desde').fill('22:00');
    await page.getByLabel('Martes, hasta').fill('12:00');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('Revisa el horario de atención');
  });
});

test.describe('Configuración: enlace de Google Maps', () => {
  const campo = (page: import('@playwright/test').Page) => page.getByLabel('Enlace de Google Maps (opcional)');

  test.beforeEach(async ({ page }) => {
    await ingresar(page, USUARIOS.adminFogon);
    await abrirConfiguracion(page);
  });

  test('NEGATIVA: un enlace de otro sitio no se guarda (el asistente se lo manda a los clientes)', async ({ page }) => {
    await campo(page).fill('https://sitio-malo.example/maps/abc');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('El enlace del mapa tiene que ser el que da Google Maps');
    await expect(resultadoDeGuardar(page)).not.toContainText('Guardado');
  });

  test('NEGATIVA: un enlace con el texto de Google Maps pero de otro dominio tampoco', async ({ page }) => {
    await campo(page).fill('https://maps.app.goo.gl.sitio-malo.example/abc');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('El enlace del mapa tiene que ser el que da Google Maps');
  });

  test('guarda un enlace de Google Maps válido', async ({ page }) => {
    await campo(page).fill('https://maps.app.goo.gl/AbCdEfGh12');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('Guardado');
    await page.reload();
    await abrirConfiguracion(page);
    await expect(campo(page)).toHaveValue('https://maps.app.goo.gl/AbCdEfGh12');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// CFG-01 (identidad y contacto) y CFG-09 (el guardado COMPLETO, el que topaba las 1000 expresiones de las reglas)
// ---------------------------------------------------------------------------------------------------------------------

/** Un texto de exactamente `n` caracteres (palabras separadas, nada que parezca un dato real). */
const textoDe = (n: number, semilla: string) => `${semilla} `.repeat(Math.ceil(n / (semilla.length + 1))).slice(0, n);

/** Los campos de texto de la pantalla: [etiqueta, clave en `config/negocio`, tope de la regla]. */
const CAMPOS_CON_TOPE: [RegExp, string, number][] = [
  [/^Nombre del negocio/, 'nombreNegocio', 80],
  [/^Descripción/, 'descripcion', 400],
  [/^Dirección del local/, 'direccion', 200],
  [/^Política de cancelación/, 'politicaCancelacion', 600],
  [/^Al cerrar la conversación/, 'mensajeCierre', 300],
  [/^Si algo falla temporalmente/, 'mensajeErrorTemporal', 300],
  [/^Si no se pudo confirmar una reserva/, 'mensajeReservaNoConfirmada', 300],
  [/^Si el servicio está suspendido/, 'mensajeComercioSuspendido', 300],
  [/^Indicaciones para el asistente/, 'instruccionesExtra', 1500],
];

const UBICACION = { lat: -16.5, lng: -68.15 };

test.describe('Configuración: guardado completo (CFG-01 y CFG-09)', () => {
  test.beforeEach(async ({ page }) => {
    prepararDatos();
    await ingresar(page, USUARIOS.adminFogon);
    await abrirConfiguracion(page);
  });

  test('CFG-09: el documento más grande que arma la consola (7 días, catálogo web, ubicación, todos los textos al tope) termina en «Guardado.» y se relee igual', async ({ page }) => {
    await simularFuncion(page, 'ubicacionDeEnlace', { resultado: { ubicacion: UBICACION, motivo: null } });
    const valores: Record<string, string> = {};
    for (const [etiqueta, clave, tope] of CAMPOS_CON_TOPE) {
      valores[clave] = textoDe(tope, `Texto ${clave}`);
      await page.getByLabel(etiqueta).fill(valores[clave]);
    }
    await page.getByLabel(/^Número de recepción/).fill('59170000001');
    await page.getByLabel('Enlace de Google Maps (opcional)').fill('https://maps.app.goo.gl/AbCdEfGh12');
    for (const dia of DIAS) await cargarDia(page, dia, { desde: '10:00', hasta: '22:45' });
    await page.getByLabel(/^Nombre del asistente/).fill(textoDe(40, 'Kenji'));
    await page.getByLabel(/^Cómo trata al cliente/).selectOption('tu');
    await page.getByLabel(/^Emojis/).selectOption('muchos');
    await page.getByLabel(/Publicar mi catálogo como página web/).check();
    await page.getByText('Terracota').click();
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('Guardado');
    await expect(resultadoDeGuardar(page)).not.toContainText('rechazó');

    const doc = await leerDoc(`tenants/${FOGON}/config/negocio`);
    for (const [, clave] of CAMPOS_CON_TOPE) expect(doc?.[clave], clave).toBe(valores[clave]);
    expect(doc?.['numeroRecepcion']).toBe('59170000001');
    expect(doc?.['direccionMaps']).toBe('https://maps.app.goo.gl/AbCdEfGh12');
    expect(doc?.['ubicacion']).toEqual(UBICACION);
    expect(doc?.['catalogoWebActivo']).toBe(true);
    expect(doc?.['paleta']).toBe('terracota');
    expect(doc?.['tratamiento']).toBe('tu');
    expect(doc?.['estiloEmojis']).toBe('muchos');
    expect(doc?.['horarios']).toEqual(Object.fromEntries(['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'].map((d) => [d, '10:00-22:45'])));

    // Al volver a entrar, la pantalla muestra lo guardado.
    await page.reload();
    await abrirConfiguracion(page);
    await expect(page.getByLabel(/^Nombre del negocio/)).toHaveValue(valores['nombreNegocio'] as string);
    await expect(page.getByLabel(/^Indicaciones para el asistente/)).toHaveValue(valores['instruccionesExtra'] as string);
    await expect(page.getByLabel('Domingo, hasta')).toHaveValue('22:45');
    await expect(page.getByLabel(/Publicar mi catálogo como página web/)).toBeChecked();
    await expect(page.getByText('Ubicación detectada')).toBeVisible();
  });

  test('CFG-01: la dirección vacía se guarda (el asistente dice que no la tiene)', async ({ page }) => {
    await page.getByLabel(/^Dirección del local/).fill('');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('Guardado');
    expect((await leerDoc(`tenants/${FOGON}/config/negocio`))?.['direccion']).toBe('');
  });

  test('CFG-01: el número de recepción acepta de 8 a 15 dígitos (los extremos)', async ({ page }) => {
    for (const largo of [8, 15]) {
      await page.getByLabel(/^Número de recepción/).fill('7'.repeat(largo));
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(resultadoDeGuardar(page)).toContainText('Guardado');
      expect((await leerDoc(`tenants/${FOGON}/config/negocio`))?.['numeroRecepcion']).toBe('7'.repeat(largo));
    }
  });

  for (const [etiqueta, clave, tope] of CAMPOS_CON_TOPE) {
    test(`NEGATIVA CFG-01: «${clave}» no admite más de ${tope} caracteres (la pantalla corta a ${tope} y el servidor rechaza ${tope + 1})`, async ({ page }) => {
      const antes = (await leerDoc(`tenants/${FOGON}/config/negocio`))?.[clave];
      // 1) Lo que escribe una persona: el campo corta en el tope.
      await page.getByLabel(etiqueta).fill('a'.repeat(tope + 20));
      expect((await page.getByLabel(etiqueta).inputValue()).length).toBe(tope);
      // 2) Lo que llega saltándose la pantalla (pegado, extensión): el servidor lo rechaza y el documento no cambia.
      await escribirSinTope(page, etiqueta, 'a'.repeat(tope + 1));
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(resultadoDeGuardar(page)).toContainText('El servidor rechazó el cambio');
      expect((await leerDoc(`tenants/${FOGON}/config/negocio`))?.[clave]).toBe(antes);
    });
  }

  test('NEGATIVA CFG-01: el nombre del negocio vacío no se guarda', async ({ page }) => {
    const antes = (await leerDoc(`tenants/${FOGON}/config/negocio`))?.['nombreNegocio'];
    await page.getByLabel(/^Nombre del negocio/).fill('');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('El servidor rechazó el cambio');
    expect((await leerDoc(`tenants/${FOGON}/config/negocio`))?.['nombreNegocio']).toBe(antes);
  });

  for (const [descripcion, valor] of [
    ['7 dígitos', '7'.repeat(7)], ['con letras', 'abc12345678'], ['con el signo +', '+59170000001'], ['vacío', ''], ['con espacios', '591 7000 0001'],
  ] as const) {
    test(`NEGATIVA CFG-01: un número de recepción ${descripcion} no se guarda`, async ({ page }) => {
      const antes = (await leerDoc(`tenants/${FOGON}/config/negocio`))?.['numeroRecepcion'];
      await page.getByLabel(/^Número de recepción/).fill(valor);
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(resultadoDeGuardar(page)).toContainText('El servidor rechazó el cambio');
      expect((await leerDoc(`tenants/${FOGON}/config/negocio`))?.['numeroRecepcion']).toBe(antes);
    });
  }

  test('NEGATIVA CFG-01: un número de recepción de 16 dígitos no se guarda (la pantalla corta a 15 y el servidor rechaza 16)', async ({ page }) => {
    const antes = (await leerDoc(`tenants/${FOGON}/config/negocio`))?.['numeroRecepcion'];
    await page.getByLabel(/^Número de recepción/).fill('7'.repeat(20));
    expect((await page.getByLabel(/^Número de recepción/).inputValue()).length).toBe(15);
    await escribirSinTope(page, /^Número de recepción/, '7'.repeat(16));
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('El servidor rechazó el cambio');
    expect((await leerDoc(`tenants/${FOGON}/config/negocio`))?.['numeroRecepcion']).toBe(antes);
  });

  test('NEGATIVA CFG-01: un nombre del asistente de más de 40 caracteres no se guarda y la pantalla lo explica', async ({ page }) => {
    await escribirSinTope(page, /^Nombre del asistente/, 'a'.repeat(41));
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(resultadoDeGuardar(page)).toContainText('hasta 40 caracteres');
    expect((await leerDoc(`tenants/${FOGON}/config/negocio`))?.['nombreAsistente']).toBeUndefined();
  });
});
