import { deflateSync } from 'node:zlib';
import { expect, test, type Page, type Route } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { PROYECTO, PUERTO_FIRESTORE, USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { limpiarConversaciones, sembrarConversacion, type MensajeDePrueba } from './ayudas/datos';
import prepararDatos, { fijarPantallaConversaciones } from './preparar-datos';
import { palabrasDe, trozosDeTelefono } from '../functions/src/core/conversacion/normalizacion';

/**
 * EL DETALLE DE UNA CONVERSACIÓN SIEMPRE PERMITE LLEGAR A «ENVIAR ARCHIVO» (reclamo de Andres, 17/11/2026).
 *
 * La prueba anterior (#990) comparaba el TEXTO del CSS y no detectó que, en una laptop de 768 px, la vista previa y sus botones
 * quedaban recortados sin scroll. Esta mide el LAYOUT CALCULADO en un Chromium real, con una imagen grande en la vista previa:
 * después de `scrollIntoViewIfNeeded` el botón tiene que quedar DENTRO de la ventana Y dentro de la caja de la conversación
 * (`.cv-cuerpo` recorta con overflow:hidden: un botón fuera de esa caja no se ve aunque la página tenga scroll).
 * Tamaños: 1366×768, 1280×720, 1920×1080 y 375×812, con el menú lateral abierto y plegado. Se corre a mano (Playwright no está en CI).
 * Con `CAPTURAS_SCROLL=<carpeta>` guarda una captura de cada caso.
 */

const FOGON = 'parrilla-el-fogon';
const TEL = '59100000048';
const CONV = `wa_${TEL}`;
const CAPTURAS = process.env.CAPTURAS_SCROLL;

test.describe.configure({ timeout: 90_000 });

function bd() {
  process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${PUERTO_FIRESTORE}`;
  if (!PROYECTO.startsWith('demo-')) throw new Error('NEGADO: el proyecto de las pruebas de navegador tiene que empezar con «demo-».');
  if (!getApps().length) initializeApp({ projectId: PROYECTO });
  return getFirestore();
}

const HOLA: MensajeDePrueba[] = [{ direccion: 'entrante', texto: 'Hola, quiero pedir', minutosAtras: 5 }];

function camposDeConversacion(): Record<string, unknown> {
  const entrante = Date.now() - 5 * 60_000;
  return {
    nombreContacto: 'Ximena P.', telefonoTrozos: trozosDeTelefono(TEL), nombrePalabras: palabrasDe('Ximena P.', 6),
    noLeidos: 0, sinLeer: false, atencionEstado: 'normal',
    ultimoEntranteEn: Timestamp.fromMillis(entrante), ventanaVenceEn: Timestamp.fromMillis(entrante + 24 * 3_600_000),
  };
}

function crc32(b: Buffer): number {
  let c = ~0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return ~c >>> 0;
}
function trozo(tipo: string, datos: Buffer): Buffer {
  const t = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
  const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(t));
  return Buffer.concat([largo, t, crc]);
}
function pngDe(ancho: number, alto: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = 2;
  const fila = Buffer.alloc(1 + ancho * 3, 0x80); fila[0] = 0;
  const crudo = Buffer.concat(Array.from({ length: alto }, () => fila));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    trozo('IHDR', ihdr), trozo('IDAT', deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))]);
}

const TAMANOS = [
  { nombre: '1366x768', ancho: 1366, alto: 768 },
  { nombre: '1280x720', ancho: 1280, alto: 720 },
  { nombre: '1920x1080', ancho: 1920, alto: 1080 },
  { nombre: '375x812', ancho: 375, alto: 812 },
] as const;

const botonMenu = (page: Page) => page.locator('header.cabecera button.boton-menu');

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
function uidDelToken(autorizacion: string | undefined): string {
  const jwt = (autorizacion ?? '').replace(/^Bearer\s+/i, '');
  const json = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { user_id?: string; sub?: string };
  return json.user_id ?? json.sub ?? '';
}
/** `tomarConversacion` se simula (no hay emulador de Functions): escribe `turno` como lo haría el servidor. Con la conversación TOMADA se ve el redactor completo, la peor altura. */
async function simularTomar(page: Page): Promise<void> {
  await page.route(/\/tomarConversacion$/, async (ruta: Route) => {
    const p = ruta.request();
    if (p.method() === 'OPTIONS') { await ruta.fulfill({ status: 204, headers: CORS }); return; }
    const uid = uidDelToken(p.headers()['authorization']);
    await bd().doc(`tenants/${FOGON}/conversaciones/${CONV}`).set(
      { turno: { responde: 'persona', tomadoPor: uid, tomadoEn: Timestamp.now(), actividadPersonaEn: Timestamp.now() } }, { merge: true });
    await ruta.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ result: { turno: { responde: 'persona' } } }) });
  });
}

async function prepararPantalla(page: Page, menuAbierto: boolean): Promise<void> {
  await simularTomar(page);
  await ingresar(page, USUARIOS.adminFogon);
  await page.goto(`/negocio/${FOGON}/conversaciones/${CONV}`);
  await expect(page.getByTestId('detalle')).toBeVisible();
  await page.getByRole('button', { name: 'Tomar conversación' }).click();
  await expect(page.getByTestId('estado-turno')).toHaveText('Responde una persona (usted)');
  const abierto = (await botonMenu(page).getAttribute('aria-expanded')) === 'true';
  if (abierto !== menuAbierto) await botonMenu(page).click();
  await expect(botonMenu(page)).toHaveAttribute('aria-expanded', String(menuAbierto));
}

/** Un elemento es ALCANZABLE si, tras llevarlo a la vista, queda dentro de la ventana y dentro de la caja que recorta (`.cv-cuerpo`). */
async function medir(page: Page, objetivo: ReturnType<Page['locator']>) {
  await objetivo.scrollIntoViewIfNeeded();
  const el = await objetivo.elementHandle();
  return page.evaluate((nodo) => {
    const r = (nodo as HTMLElement).getBoundingClientRect();
    const caja = document.querySelector('.cv-cuerpo')!.getBoundingClientRect();
    const hilo = document.querySelector('.cv-hilo')!.getBoundingClientRect();
    return {
      arriba: r.top, abajo: r.bottom, alto: r.height, ventana: window.innerHeight,
      cajaArriba: caja.top, cajaAbajo: caja.bottom, hiloAlto: hilo.height,
    };
  }, el);
}

for (const t of TAMANOS) {
  for (const menuAbierto of t.ancho < 768 ? [false] : [true, false]) {
    const caso = `${t.nombre}, menú ${menuAbierto ? 'abierto' : 'plegado'}`;
    test.describe(`Conversaciones: detalle con vista previa grande, ${caso}`, () => {
      test.use({ viewport: { width: t.ancho, height: t.alto } });
      test.beforeEach(async () => {
        prepararDatos();
        await limpiarConversaciones(FOGON);
        await fijarPantallaConversaciones(FOGON, 'nueva');
        await bd().doc(`tenants/${FOGON}`).set({ personaPuedeEnviarMedios: true, personaPuedeEscribir: true }, { merge: true });
        await sembrarConversacion(FOGON, TEL, HOLA, camposDeConversacion());
      });
      test.afterEach(async () => {
        await fijarPantallaConversaciones(FOGON, null);
        await bd().doc(`tenants/${FOGON}`).set({ personaPuedeEnviarMedios: FieldValue.delete(), personaPuedeEscribir: FieldValue.delete() }, { merge: true });
      });

      test('imagen grande: «Enviar archivo» y la vista previa se alcanzan, y el hilo no desaparece', async ({ page }) => {
        await prepararPantalla(page, menuAbierto);
        await page.locator('input[type=file]').setInputFiles({ name: 'grande.png', mimeType: 'image/png', buffer: pngDe(1600, 2400) });
        await expect(page.getByAltText('Vista previa de la imagen que se enviará')).toBeVisible();
        // El campo de texto crece hasta su tope: es la peor altura del redactor.
        await page.getByLabel('Mensaje para el cliente').fill(Array.from({ length: 40 }, (_, i) => `línea ${i + 1}`).join('\n'));

        const enviar = page.getByRole('button', { name: 'Enviar archivo' });
        const m = await medir(page, enviar);
        if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${t.nombre}-menu-${menuAbierto ? 'abierto' : 'plegado'}.png` });
        expect(m.abajo, `«Enviar archivo» termina dentro de la ventana (${m.abajo} de ${m.ventana})`).toBeLessThanOrEqual(m.ventana);
        expect(m.arriba, '«Enviar archivo» no queda por encima de la ventana').toBeGreaterThanOrEqual(0);
        expect(m.abajo, `«Enviar archivo» queda dentro de la caja que recorta (${m.abajo} de ${m.cajaAbajo})`).toBeLessThanOrEqual(m.cajaAbajo + 1);
        expect(m.arriba, '«Enviar archivo» no queda por encima de la caja').toBeGreaterThanOrEqual(m.cajaArriba - 1);
        await expect(enviar).toBeEnabled();

        const previa = await medir(page, page.getByAltText('Vista previa de la imagen que se enviará'));
        expect(previa.alto, 'la vista previa se ve (no queda en 0 píxeles)').toBeGreaterThan(40);
        expect(previa.abajo, 'la vista previa queda dentro de la caja que recorta').toBeLessThanOrEqual(previa.cajaAbajo + 1);
        // El hilo es lo que se lee: puede reducirse, pero no a nada.
        expect(m.hiloAlto, 'el hilo conserva altura para leer').toBeGreaterThanOrEqual(96);
      });
    });
  }
}
