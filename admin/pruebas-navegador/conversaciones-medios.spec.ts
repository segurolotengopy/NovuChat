import { deflateSync } from 'node:zlib';
import { expect, test, type Page, type Route } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { PROYECTO, PUERTO_FIRESTORE, USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { limpiarConversaciones, sembrarConversacion, type MensajeDePrueba } from './ayudas/datos';
import prepararDatos, { fijarPantallaConversaciones } from './preparar-datos';
import { palabrasDe, trozosDeTelefono } from '../functions/src/core/conversacion/normalizacion';
import { validarAdjunto } from '../functions/src/core/medios/salientes';

/**
 * MEDIOS B4 «ENVÍO DE ARCHIVOS Y NOTAS DE VOZ DESDE LA CONSOLA» EN LA PANTALLA NUEVA.
 *
 * LA CALLABLE `enviarAdjuntoComoPersona` SE SIMULA (no hay emulador de Functions en esta suite): se prueba la PANTALLA contra
 * el contrato, y lo que ella MANDÓ se pasa por el MISMO validador del servidor (`validarAdjunto`). Eso hace de la prueba de la
 * nota de voz la única comprobación real de que el Chromium produce WebM/Opus mono que el servidor acepta.
 * Se corre a mano (Playwright no está en CI). Teléfonos sintéticos (seis ceros seguidos).
 */

const FOGON = 'parrilla-el-fogon';
const TEL = '59100000047';
const CONV = `wa_${TEL}`;

// Un micrófono falso de Chromium: sin pedir permiso y sin hardware.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

function bd() {
  process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${PUERTO_FIRESTORE}`;
  if (!PROYECTO.startsWith('demo-')) throw new Error('NEGADO: el proyecto de las pruebas de navegador tiene que empezar con «demo-».');
  if (!getApps().length) initializeApp({ projectId: PROYECTO });
  if (!String(getApps()[0]?.options.projectId ?? '').startsWith('demo-')) throw new Error('NEGADO: la app de Admin no es de un proyecto demo-*.');
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

async function fijarMedios(valor: boolean | null): Promise<void> {
  const { FieldValue } = await import('firebase-admin/firestore');
  // Escribir como persona también tiene su bandera (`personaPuedeEscribir`): sin ella no hay «Tomar».
  await bd().doc(`tenants/${FOGON}`).set(
    valor === null
      ? { personaPuedeEnviarMedios: FieldValue.delete(), personaPuedeEscribir: FieldValue.delete() }
      : { personaPuedeEnviarMedios: valor, personaPuedeEscribir: true }, { merge: true });
}

// ── El «servidor» de mentira: Tomar (escribe `turno`) y enviarAdjuntoComoPersona (registra el cuerpo) ──

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
type Cuerpo = { tenantId?: string; conversacionId?: string; clave?: string; adjunto?: { base64?: string; mime?: string; nombre?: string }; leyenda?: string };
interface Servidor { adjuntos: Cuerpo[]; responder: (f: (n: number) => { estado: number; cuerpo: unknown }) => void }

function uidDelToken(autorizacion: string | undefined): string {
  const jwt = (autorizacion ?? '').replace(/^Bearer\s+/i, '');
  const json = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { user_id?: string; sub?: string };
  return json.user_id ?? json.sub ?? '';
}

async function simularServidor(page: Page): Promise<Servidor> {
  const adjuntos: Cuerpo[] = [];
  let respuesta: (n: number) => { estado: number; cuerpo: unknown } = () => ({ estado: 200, cuerpo: { result: { estado: 'pendiente', mensajeId: 'm1' } } });
  await page.route(/\/tomarConversacion$/, async (ruta: Route) => {
    const p = ruta.request();
    if (p.method() === 'OPTIONS') { await ruta.fulfill({ status: 204, headers: CORS }); return; }
    const uid = uidDelToken(p.headers()['authorization']);
    await bd().doc(`tenants/${FOGON}/conversaciones/${CONV}`).set(
      { turno: { responde: 'persona', tomadoPor: uid, tomadoEn: Timestamp.now(), actividadPersonaEn: Timestamp.now() } }, { merge: true });
    await ruta.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ result: { turno: { responde: 'persona' } } }) });
  });
  await page.route(/\/enviarAdjuntoComoPersona$/, async (ruta: Route) => {
    const p = ruta.request();
    if (p.method() === 'OPTIONS') { await ruta.fulfill({ status: 204, headers: CORS }); return; }
    adjuntos.push(((p.postDataJSON() as { data?: Cuerpo } | null)?.data) ?? {});
    const r = respuesta(adjuntos.length);
    await ruta.fulfill({ status: r.estado, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(r.cuerpo) });
  });
  return { adjuntos, responder: (f) => { respuesta = f; } };
}

async function abrirYTomar(page: Page): Promise<void> {
  await ingresar(page, USUARIOS.adminFogon);
  await page.goto(`/negocio/${FOGON}/conversaciones/${CONV}`);
  await expect(page.getByTestId('detalle')).toBeVisible();
  await page.getByRole('button', { name: 'Tomar conversación' }).click();
  await expect(page.getByTestId('estado-turno')).toHaveText('Responde una persona (usted)');
}

// ── Un PNG ancho y bajo, sin dependencias (5000×10 pasa de los 4.096 px de lado) ──

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
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = 2;   // 8 bits, RGB
  const fila = Buffer.alloc(1 + ancho * 3, 0x80); fila[0] = 0;
  const crudo = Buffer.concat(Array.from({ length: alto }, () => fila));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    trozo('IHDR', ihdr), trozo('IDAT', deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))]);
}

const adjuntar = (page: Page) => page.getByRole('button', { name: 'Adjuntar archivo' });
const grabar = (page: Page) => page.getByRole('button', { name: 'Grabar nota de voz' });

test.describe('Conversaciones: enviar archivos y notas de voz (Medios B4)', () => {
  test.beforeEach(async () => {
    prepararDatos();
    await limpiarConversaciones(FOGON);
    await fijarPantallaConversaciones(FOGON, 'nueva');
    await sembrarConversacion(FOGON, TEL, HOLA, camposDeConversacion());
  });
  test.afterEach(async () => { await fijarPantallaConversaciones(FOGON, null); await fijarMedios(null); });

  test('NEGATIVA: con la bandera apagada no hay botones de adjuntar ni de grabar, aunque la conversación esté tomada', async ({ page }) => {
    await fijarMedios(false);
    await simularServidor(page);
    await abrirYTomar(page);
    await expect(page.getByLabel('Mensaje para el cliente')).toBeVisible();
    await expect(adjuntar(page)).toHaveCount(0);
    await expect(grabar(page)).toHaveCount(0);
  });

  test('una imagen de 5000×10 sale como JPEG de lado ≤ 4.096 que el validador del servidor acepta; se confirma antes de enviar', async ({ page }) => {
    await fijarMedios(true);
    const servidor = await simularServidor(page);
    await abrirYTomar(page);
    await page.locator('input[type=file]').setInputFiles({ name: 'ancha.png', mimeType: 'image/png', buffer: pngDe(5000, 10) });
    await expect(page.getByAltText('Vista previa de la imagen que se enviará')).toBeVisible();
    await page.getByRole('button', { name: 'Enviar archivo' }).click();
    const dialogo = page.getByRole('alertdialog');
    await expect(dialogo).toContainText('Ximena P.');
    await expect(dialogo).toContainText('terminado en 0047');
    expect(servidor.adjuntos).toHaveLength(0);                       // todavía nada salió
    await page.keyboard.press('Escape');
    await expect(dialogo).toHaveCount(0);
    expect(servidor.adjuntos).toHaveLength(0);                       // Escape cancela
    await page.getByRole('button', { name: 'Enviar archivo' }).click();
    await page.getByRole('button', { name: 'Sí, enviar' }).click();
    await expect.poll(() => servidor.adjuntos.length).toBe(1);

    const c = servidor.adjuntos[0]!;
    expect(Object.keys(c).sort()).toEqual(['adjunto', 'clave', 'conversacionId', 'tenantId']);
    expect(Object.keys(c.adjunto!).sort()).toEqual(['base64', 'mime']);
    expect(c.adjunto!.mime).toBe('image/jpeg');
    const v = validarAdjunto(Buffer.from(c.adjunto!.base64!, 'base64'), { mime: c.adjunto!.mime });
    expect(v.ok).toBe(true);
  });

  test('una nota de voz de 3 s sale como audio que el validador del servidor acepta como voz', async ({ page }) => {
    await fijarMedios(true);
    const servidor = await simularServidor(page);
    await abrirYTomar(page);
    await expect(grabar(page)).toBeVisible();
    await grabar(page).click();
    await expect(page.getByRole('button', { name: /^Detener/ })).toBeVisible();
    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: /^Detener/ }).click();
    await expect(page.locator('audio')).toBeVisible();
    await expect(page.getByLabel(/Texto que acompaña/)).toHaveCount(0);   // los audios no llevan texto
    await page.getByRole('button', { name: 'Enviar archivo' }).click();
    await page.getByRole('button', { name: 'Sí, enviar' }).click();
    await expect.poll(() => servidor.adjuntos.length).toBe(1);

    const c = servidor.adjuntos[0]!;
    expect('leyenda' in c).toBe(false);
    expect(['audio/ogg', 'audio/webm']).toContain(c.adjunto!.mime);
    const v = validarAdjunto(Buffer.from(c.adjunto!.base64!, 'base64'), { mime: c.adjunto!.mime });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.voz).toBe(true);
      // Solo el WebM se reempaqueta a Ogg; un Ogg/Opus ya viene como lo quiere WhatsApp.
      expect(v.reempaquetado).toBe(c.adjunto!.mime === 'audio/webm');
    }
  });

  test('sin respuesta (504) el envío queda abierto y el reintento usa la MISMA clave', async ({ page }) => {
    await fijarMedios(true);
    const servidor = await simularServidor(page);
    servidor.responder((n) => (n === 1
      ? { estado: 504, cuerpo: { error: { message: 'DETALLE-INTERNO-DEL-SERVIDOR-NO-VISIBLE', status: 'DEADLINE_EXCEEDED' } } }
      : { estado: 200, cuerpo: { result: { estado: 'pendiente', mensajeId: 'm1' } } }));
    await abrirYTomar(page);
    await page.locator('input[type=file]').setInputFiles({ name: 'carta.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') });
    await page.getByRole('button', { name: 'Enviar archivo' }).click();
    await page.getByRole('button', { name: 'Sí, enviar' }).click();
    await expect(page.getByRole('alert')).toContainText('No se pudo confirmar si llegó');
    await expect(page.locator('body')).not.toContainText('DETALLE-INTERNO');
    await page.getByRole('button', { name: 'Reintentar envío' }).click();
    await page.getByRole('button', { name: 'Sí, enviar' }).click();
    await expect.poll(() => servidor.adjuntos.length).toBe(2);
    expect(servidor.adjuntos[1]!.clave).toBe(servidor.adjuntos[0]!.clave);
    expect(servidor.adjuntos[0]!.adjunto!.nombre).toBe('carta.txt');
  });
});
