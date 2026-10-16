import { expect, test, type Page, type Route } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { PROYECTO, PUERTO_FIRESTORE, USUARIOS } from './entorno';
import { ingresar } from './ayudas/ingresar';
import { crearUsuarioDeEnsayo, limpiarConversaciones, sembrarConversacion, type MensajeDePrueba } from './ayudas/datos';
import prepararDatos, { fijarPantallaConversaciones } from './preparar-datos';
import { palabrasDe, trozosDeTelefono } from '../functions/src/core/conversacion/normalizacion';

/**
 * H2 «INTERVENCIÓN DE UNA PERSONA» EN LA PANTALLA NUEVA (contrato único H2, 16/10/2026, §2, §4 y §5).
 *
 * LAS TRES CALLABLES SE SIMULAN (`tomarConversacion`, `devolverConversacion`, `enviarComoPersona`): todavía no están
 * desplegadas ni fusionadas, y no hay emulador de Functions en esta suite. Se prueba la PANTALLA contra el contrato, no las
 * Functions. El «servidor» de mentira hace lo que haría el verdadero —escribir `turno` y el mensaje saliente con el SDK Admin,
 * que se salta las reglas porque en producción lo escribe el servidor— para que la pantalla reaccione por el oyente en vivo,
 * como lo hará de verdad. Cada llamada queda registrada: lo que la pantalla MANDÓ se comprueba campo por campo.
 *
 * Los teléfonos son sintéticos (seis ceros seguidos).
 */

const FOGON = 'parrilla-el-fogon';
const TEL = '59100000047';
const TEL_B = '59100000074';
const CONV = `wa_${TEL}`;
const CONV_B = `wa_${TEL_B}`;
const RUTA_CONV = `tenants/${FOGON}/conversaciones/${CONV}`;
const HORA = 3_600_000;
const OTRO_UID = 'uidDeOtraPersonaDelNegocioAbCdEfGhIj';

function bd() {
  process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${PUERTO_FIRESTORE}`;
  if (!PROYECTO.startsWith('demo-')) throw new Error('NEGADO: el proyecto de las pruebas de navegador tiene que empezar con «demo-».');
  if (!getApps().length) initializeApp({ projectId: PROYECTO });
  if (!String(getApps()[0]?.options.projectId ?? '').startsWith('demo-')) throw new Error('NEGADO: la app de Admin no es de un proyecto demo-*.');
  return getFirestore();
}

interface OpcionesCampos { entranteHaceMin?: number | null; noLeidos?: number; turno?: Record<string, unknown> }

/** Los campos de una conversación como los deja la ingesta (H1) y, con `turno`, como los deja el servidor tras una toma (H2). */
function campos(telefono: string, nombre: string, o: OpcionesCampos = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    nombreContacto: nombre,
    telefonoTrozos: trozosDeTelefono(telefono),
    nombrePalabras: palabrasDe(nombre, 6),
    noLeidos: o.noLeidos ?? 0,
    sinLeer: (o.noLeidos ?? 0) > 0,
    atencionEstado: 'normal',
  };
  if (o.entranteHaceMin !== null) {
    const entrante = Date.now() - (o.entranteHaceMin ?? 5) * 60_000;
    base['ultimoEntranteEn'] = Timestamp.fromMillis(entrante);
    base['ventanaVenceEn'] = Timestamp.fromMillis(entrante + 24 * HORA);
  }
  if (o.turno) base['turno'] = o.turno;
  return base;
}

const HOLA: MensajeDePrueba[] = [
  { direccion: 'entrante', texto: 'Hola, quiero pedir', minutosAtras: 30 },
  { direccion: 'saliente', texto: 'Claro, ¿para delivery o recoger?', minutosAtras: 29 },
  { direccion: 'entrante', texto: 'Para recoger', minutosAtras: 28 },
];

const turnoDe = (uid: string, haceMin = 3) => ({
  responde: 'persona', tomadoPor: uid, tomadoEn: Timestamp.fromMillis(Date.now() - haceMin * 60_000),
  actividadPersonaEn: Timestamp.fromMillis(Date.now() - haceMin * 60_000),
});

// ── El «servidor» de mentira ─────────────────────────────────────────────────

type Llamada = { nombre: string; datos: Record<string, unknown>; uid: string };
type Respuesta = { resultado: unknown } | { estado: number; error: { message: string; status: string } };

interface Servidor {
  llamadas: Llamada[];
  /** Cambia lo que contesta una callable (por defecto, lo que haría el servidor de verdad). */
  contestar(nombre: string, f: (l: Llamada) => Promise<Respuesta> | Respuesta): void;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

/** El uid de quien llama, leído del token que manda el SDK (el emulador de Auth firma sin clave: se lee el cuerpo). */
function uidDelToken(autorizacion: string | undefined): string {
  const jwt = (autorizacion ?? '').replace(/^Bearer\s+/i, '');
  const cuerpo = jwt.split('.')[1] ?? '';
  const json = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as { user_id?: string; sub?: string };
  return json.user_id ?? json.sub ?? '';
}

async function simularServidor(page: Page): Promise<Servidor> {
  const llamadas: Llamada[] = [];
  const f: Record<string, (l: Llamada) => Promise<Respuesta> | Respuesta> = {
    async tomarConversacion(l) {
      const id = String(l.datos['conversacionId']);
      const turno = { responde: 'persona', tomadoPor: l.uid, tomadoEn: Timestamp.now(), actividadPersonaEn: Timestamp.now() };
      await bd().doc(`tenants/${FOGON}/conversaciones/${id}`).set({ turno }, { merge: true });
      return { resultado: { turno: { responde: 'persona', tomadoPor: l.uid } } };
    },
    async devolverConversacion(l) {
      const id = String(l.datos['conversacionId']);
      const turno = { responde: 'asistente', tomadoPor: l.uid, devueltoEn: Timestamp.now(), motivoDevolucion: 'manual' };
      await bd().doc(`tenants/${FOGON}/conversaciones/${id}`).set({ turno }, { merge: true });
      return { resultado: { turno: { responde: 'asistente' } } };
    },
    async enviarComoPersona(l) {
      const id = String(l.datos['conversacionId']);
      const clave = String(l.datos['claveIdempotencia']);
      const ref = bd().doc(`tenants/${FOGON}/conversaciones/${id}/mensajes/${clave}`);
      await ref.set({
        direccion: 'saliente', autor: 'persona', autorUid: l.uid, texto: l.datos['texto'], tipo: 'text',
        estadoEnvio: 'pendiente', ts: Timestamp.now(),
      });
      await bd().doc(`tenants/${FOGON}/conversaciones/${id}`).set({ ultimoMensaje: l.datos['texto'], ultimoEn: Timestamp.now() }, { merge: true });
      return { resultado: { estado: 'pendiente', mensajeId: clave } };
    },
  };
  for (const nombre of Object.keys(f)) {
    await page.route(new RegExp(`/${nombre}$`), async (ruta: Route) => {
      const peticion = ruta.request();
      if (peticion.method() === 'OPTIONS') { await ruta.fulfill({ status: 204, headers: CORS }); return; }
      const llamada: Llamada = {
        nombre,
        datos: ((peticion.postDataJSON() as { data?: Record<string, unknown> } | null)?.data) ?? {},
        uid: uidDelToken(peticion.headers()['authorization']),
      };
      llamadas.push(llamada);
      const r = await f[nombre]!(llamada);
      if ('resultado' in r) await ruta.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ result: r.resultado }) });
      else await ruta.fulfill({ status: r.estado, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ error: r.error }) });
    });
  }
  return { llamadas, contestar: (nombre, g) => { f[nombre] = g; } };
}

const error = (estado: number, status: string, details?: Record<string, unknown>): Respuesta =>
  ({ estado, error: { message: 'DETALLE-INTERNO-DEL-SERVIDOR-NO-VISIBLE', status, ...(details ? { details } : {}) } as { message: string; status: string } });

// ── Ayudas de pantalla ───────────────────────────────────────────────────────

async function abrir(page: Page, correo: string = USUARIOS.adminFogon, conv: string = CONV): Promise<void> {
  await ingresar(page, correo);
  await page.goto(`/negocio/${FOGON}/conversaciones/${conv}`);
  await expect(page.getByTestId('detalle')).toBeVisible();
}
const estado = (page: Page) => page.getByTestId('estado-turno');
const campo = (page: Page) => page.getByLabel('Mensaje para el cliente');
const tomar = (page: Page) => page.getByRole('button', { name: 'Tomar conversación' });
const devolver = (page: Page) => page.getByRole('button', { name: 'Devolver al asistente' });
const enviar = (page: Page) => page.getByRole('button', { name: 'Enviar', exact: true });

async function tomarYEsperar(page: Page): Promise<void> {
  await tomar(page).click();
  await expect(estado(page)).toHaveText('Responde una persona (usted)');
  await expect(campo(page)).toBeVisible();
}

test.describe('Conversaciones: intervención de una persona (H2)', () => {
  test.beforeEach(async () => {
    prepararDatos();
    await limpiarConversaciones(FOGON);
    await fijarPantallaConversaciones(FOGON, 'nueva');
  });
  test.afterEach(async () => { await fijarPantallaConversaciones(FOGON, null); });

  test('Tomar: llama a la callable con SOLO {tenantId, conversacionId}, el estado cambia en vivo y aparece el campo; Devolver lo deshace', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.'));
    const servidor = await simularServidor(page);
    await abrir(page);
    await expect(estado(page)).toHaveText('Responde el asistente');
    await expect(page.locator('#cv-turno-aviso')).toContainText('el asistente deja de responder');
    await expect(campo(page)).toHaveCount(0);

    await tomarYEsperar(page);
    expect(servidor.llamadas).toHaveLength(1);
    expect(servidor.llamadas[0]!.nombre).toBe('tomarConversacion');
    expect(servidor.llamadas[0]!.datos).toEqual({ tenantId: FOGON, conversacionId: CONV });
    await expect(tomar(page)).toHaveCount(0);
    await expect(devolver(page)).toBeVisible();
    await expect(page.locator('.cv-ficha', { hasText: 'Ximena P.' })).toContainText('Responde una persona');

    await devolver(page).click();
    await expect(estado(page)).toHaveText('Responde el asistente');
    await expect(campo(page)).toHaveCount(0);
    await expect(tomar(page)).toBeVisible();
    expect(servidor.llamadas.map((l) => l.nombre)).toEqual(['tomarConversacion', 'devolverConversacion']);
    expect(servidor.llamadas[1]!.datos).toEqual({ tenantId: FOGON, conversacionId: CONV });
  });

  test('el estado sigue al documento EN VIVO: si el servidor devuelve la conversación (inactividad), la pantalla lo muestra sin recargar', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.'));
    await simularServidor(page);
    await abrir(page);
    await tomarYEsperar(page);
    await bd().doc(RUTA_CONV).set({ turno: { responde: 'asistente', devueltoEn: Timestamp.now(), motivoDevolucion: 'inactividad' } }, { merge: true });
    await expect(estado(page)).toHaveText('Responde el asistente');
    await expect(campo(page)).toHaveCount(0);
  });

  test('la tiene otra persona: se ve quién (uid abreviado), el oper no ve ningún botón y el admin puede devolverla', async ({ page, browser }) => {
    await crearUsuarioDeEnsayo({ uid: 'u-oper-fogon-h1', correo: USUARIOS.operadorFogon, nombre: 'Luis (prueba)', tenantId: FOGON, rol: 'oper' });
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.', { turno: turnoDe(OTRO_UID) }));
    const servidor = await simularServidor(page);
    await abrir(page, USUARIOS.operadorFogon);
    await expect(estado(page)).toHaveText(`Responde una persona (${OTRO_UID.slice(0, 6)}…)`);
    await expect(page.locator('body')).not.toContainText(OTRO_UID);
    await expect(page.getByRole('button', { name: /^(Tomar|Devolver)/ })).toHaveCount(0);
    await expect(campo(page)).toHaveCount(0);

    // El admin sí puede devolverla (y no puede escribir en ella).
    const otra = await browser.newPage();
    const servidor2 = await simularServidor(otra);
    await abrir(otra);
    await expect(devolver(otra)).toBeVisible();
    await expect(tomar(otra)).toHaveCount(0);
    await expect(campo(otra)).toHaveCount(0);
    await devolver(otra).click();
    await expect(estado(otra)).toHaveText('Responde el asistente');
    expect(servidor2.llamadas.map((l) => l.nombre)).toEqual(['devolverConversacion']);
    expect(servidor.llamadas).toHaveLength(0);
    await otra.close();
  });

  test('el operador del negocio ve «Tomar» y puede tomar', async ({ page }) => {
    await crearUsuarioDeEnsayo({ uid: 'u-oper-fogon-h1', correo: USUARIOS.operadorFogon, nombre: 'Luis (prueba)', tenantId: FOGON, rol: 'oper' });
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.'));
    const servidor = await simularServidor(page);
    await abrir(page, USUARIOS.operadorFogon);
    await tomarYEsperar(page);
    expect(servidor.llamadas[0]!.uid).toBe('u-oper-fogon-h1');
  });

  test('NEGATIVA: un `turno` raro en el documento se ve como «Responde el asistente», nunca como una persona', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.', { turno: { responde: 'Persona', tomadoPor: OTRO_UID } }));
    await abrir(page);
    await expect(estado(page)).toHaveText('Responde el asistente');
    await expect(tomar(page)).toBeVisible();
  });

  test('errores de Tomar: el texto sale del CÓDIGO y se ve junto al botón; el mensaje del servidor NUNCA se muestra', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.'));
    const servidor = await simularServidor(page);
    await abrir(page);
    servidor.contestar('tomarConversacion', () => error(400, 'FAILED_PRECONDITION'));
    await tomar(page).click();
    const alerta = page.locator('#cv-turno-error');
    await expect(alerta).toContainText('la tiene otra persona');
    await expect(page.locator('body')).not.toContainText('DETALLE-INTERNO');
    await expect(tomar(page)).toBeEnabled();
    await expect(tomar(page)).toHaveAttribute('aria-describedby', /cv-turno-error/);
    servidor.contestar('tomarConversacion', () => error(403, 'PERMISSION_DENIED'));
    await tomar(page).click();
    await expect(alerta).toContainText('No tiene permiso');
    await expect(estado(page)).toHaveText('Responde el asistente');
  });

  test('doble clic en Tomar: UNA sola llamada', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.'));
    const servidor = await simularServidor(page);
    await abrir(page);
    servidor.contestar('tomarConversacion', async (l) => {
      await new Promise((r) => setTimeout(r, 700));
      await bd().doc(RUTA_CONV).set({ turno: { responde: 'persona', tomadoPor: l.uid, tomadoEn: Timestamp.now(), actividadPersonaEn: Timestamp.now() } }, { merge: true });
      return { resultado: { turno: { responde: 'persona' } } };
    });
    await tomar(page).dblclick();
    await expect(estado(page)).toHaveText('Responde una persona (usted)');
    expect(servidor.llamadas.filter((l) => l.nombre === 'tomarConversacion')).toHaveLength(1);
  });

  test('Enviar: manda SOLO {tenantId, conversacionId, texto, claveIdempotencia} con una clave válida; el mensaje sale como «Persona (usted)» y su estado sigue al documento', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.'));
    const servidor = await simularServidor(page);
    await abrir(page);
    await tomarYEsperar(page);
    await expect(enviar(page)).toBeDisabled();                       // sin texto no se envía
    await campo(page).fill('Listo, ya le preparo el pedido.');
    await expect(page.locator('#cv-redactor-contador')).toHaveText('31 / 1.000');
    await enviar(page).click();

    const envio = servidor.llamadas.find((l) => l.nombre === 'enviarComoPersona')!;
    expect(Object.keys(envio.datos).sort()).toEqual(['claveIdempotencia', 'conversacionId', 'tenantId', 'texto']);
    expect(envio.datos['tenantId']).toBe(FOGON);
    expect(envio.datos['conversacionId']).toBe(CONV);
    expect(envio.datos['texto']).toBe('Listo, ya le preparo el pedido.');
    expect(String(envio.datos['claveIdempotencia'])).toMatch(/^[A-Za-z0-9_.:-]{16,128}$/);

    const mensaje = page.locator('ol.cv-mensajes li').last();
    await expect(mensaje).toContainText('Listo, ya le preparo el pedido.');
    await expect(mensaje).toContainText('Persona (usted)');
    await expect(mensaje.locator('.cv-burbuja')).toHaveClass(/cv-burbuja--persona/);
    await expect(mensaje.locator('[data-estado]')).toHaveText('Enviando…');
    await expect(campo(page)).toHaveValue('');                       // el texto salió del campo
    // El flujo de n8n confirma: el estado cambia en vivo.
    const ref = bd().doc(`tenants/${FOGON}/conversaciones/${CONV}/mensajes/${String(envio.datos['claveIdempotencia'])}`);
    await ref.update({ estadoEnvio: 'aceptado' });
    await expect(mensaje.locator('[data-estado]')).toHaveText('Enviado a WhatsApp');
    await ref.update({ estadoEnvio: 'incierto' });
    await expect(mensaje.locator('[data-estado]')).toHaveText('No se pudo confirmar si llegó');
    await ref.update({ estadoEnvio: 'rechazado' });
    await expect(mensaje.locator('[data-estado]')).toContainText('no se envió');
    // Los mensajes del asistente y los del cliente no llevan estado de envío.
    await expect(page.locator('[data-estado]')).toHaveCount(1);
  });

  test('el mensaje de un asistente y el de una persona se distinguen; el uid de otra persona va abreviado y el HTML se ve como texto', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.', { turno: turnoDe(OTRO_UID) }));
    const col = bd().collection(`tenants/${FOGON}/conversaciones/${CONV}/mensajes`);
    await col.doc('a1').set({ direccion: 'saliente', autor: 'asistente', texto: 'Respuesta del asistente', ts: Timestamp.fromMillis(Date.now() - 10 * 60_000) });
    await col.doc('p1').set({
      direccion: 'saliente', autor: 'persona', autorUid: OTRO_UID, texto: '<b onmouseover=alert(1)>Hola</b>', estadoEnvio: 'aceptado',
      ts: Timestamp.fromMillis(Date.now() - 5 * 60_000),
    });
    await col.doc('p2').set({
      direccion: 'saliente', autor: 'persona', autorUid: '<img src=x onerror="window.__xss=1">uidraro', texto: 'raro', estadoEnvio: 'enviado-raro',
      ts: Timestamp.fromMillis(Date.now() - 4 * 60_000),
    });
    await abrir(page);
    const asistente = page.locator('.cv-burbuja', { hasText: 'Respuesta del asistente' });
    await expect(asistente).toContainText('Asistente');
    await expect(asistente).not.toHaveClass(/cv-burbuja--persona/);
    const persona = page.locator('.cv-burbuja', { hasText: 'onmouseover' });
    await expect(persona).toHaveClass(/cv-burbuja--persona/);
    await expect(persona).toContainText(`Persona (${OTRO_UID.slice(0, 6)}…)`);
    await expect(persona).toContainText('<b onmouseover=alert(1)>Hola</b>');
    await expect(persona.locator('b')).toHaveCount(0);
    await expect(page.locator('.cv-burbuja', { hasText: 'raro' }).locator('.cv-envio')).toHaveCount(0);   // estado raro = sin estado
    await expect(page.locator('ol.cv-mensajes img')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    await expect(page.locator('body')).not.toContainText(OTRO_UID);
  });

  test('doble clic en Enviar: UNA sola llamada; mientras se envía el botón está deshabilitado', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.'));
    const servidor = await simularServidor(page);
    await abrir(page);
    await tomarYEsperar(page);
    const original = servidor.llamadas.length;
    servidor.contestar('enviarComoPersona', async () => {
      await new Promise((r) => setTimeout(r, 800));
      return { resultado: { estado: 'pendiente' } };
    });
    await campo(page).fill('Un solo mensaje');
    await enviar(page).dblclick();
    await expect(enviar(page)).toBeDisabled();
    await expect(campo(page)).toHaveValue('');
    expect(servidor.llamadas.length - original).toBe(1);
  });

  test('sin respuesta del servidor (504): «No se pudo confirmar si llegó», el texto se conserva y reintentar usa LA MISMA clave; con otro texto, clave nueva', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.'));
    const servidor = await simularServidor(page);
    await abrir(page);
    await tomarYEsperar(page);
    servidor.contestar('enviarComoPersona', () => error(504, 'DEADLINE_EXCEEDED'));
    await campo(page).fill('Mensaje importante');
    await enviar(page).click();
    await expect(page.locator('#cv-redactor-error')).toContainText('No se pudo confirmar si llegó');
    await expect(page.locator('#cv-redactor-error')).toContainText('no se duplica');
    await expect(page.locator('body')).not.toContainText('DETALLE-INTERNO');
    await expect(campo(page)).toHaveValue('Mensaje importante');       // sin reenvío automático: el texto sigue ahí
    await expect(campo(page)).toHaveAttribute('aria-invalid', 'true');
    await page.waitForTimeout(1500);
    const envios = () => servidor.llamadas.filter((l) => l.nombre === 'enviarComoPersona');
    expect(envios()).toHaveLength(1);                                   // nada se reintentó solo

    await enviar(page).click();                                         // la persona decide reintentar
    await expect.poll(() => envios().length).toBe(2);
    expect(envios()[1]!.datos['claveIdempotencia']).toBe(envios()[0]!.datos['claveIdempotencia']);

    await campo(page).fill('Otro mensaje distinto');                    // otro texto = otro envío
    await enviar(page).click();
    await expect.poll(() => envios().length).toBe(3);
    expect(envios()[2]!.datos['claveIdempotencia']).not.toBe(envios()[0]!.datos['claveIdempotencia']);
  });

  test('un resultado `incierto` del servidor NO se reenvía solo: el mensaje queda marcado, el campo se vacía y escribirlo otra vez es una decisión nueva (clave nueva)', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.'));
    const servidor = await simularServidor(page);
    await abrir(page);
    await tomarYEsperar(page);
    servidor.contestar('enviarComoPersona', async (l) => {
      const clave = String(l.datos['claveIdempotencia']);
      await bd().doc(`tenants/${FOGON}/conversaciones/${CONV}/mensajes/${clave}`).set({
        direccion: 'saliente', autor: 'persona', autorUid: l.uid, texto: l.datos['texto'], estadoEnvio: 'incierto', ts: Timestamp.now(),
      });
      return { resultado: { estado: 'incierto', mensajeId: clave } };
    });
    await campo(page).fill('No sé si llegó');
    await enviar(page).click();
    await expect(page.locator('.cv-envio--incierto')).toHaveText('No se pudo confirmar si llegó');
    await expect(page.getByRole('status').filter({ hasText: 'no se reenvía solo' })).toBeVisible();
    await expect(campo(page)).toHaveValue('');
    await page.waitForTimeout(1500);
    const envios = servidor.llamadas.filter((l) => l.nombre === 'enviarComoPersona');
    expect(envios).toHaveLength(1);
    await campo(page).fill('No sé si llegó');
    await enviar(page).click();
    await expect.poll(() => servidor.llamadas.filter((l) => l.nombre === 'enviarComoPersona').length).toBe(2);
    const dos = servidor.llamadas.filter((l) => l.nombre === 'enviarComoPersona');
    expect(dos[1]!.datos['claveIdempotencia']).not.toBe(dos[0]!.datos['claveIdempotencia']);
  });

  test('errores de Enviar por código: tope de envíos, turno perdido, texto inválido; el texto se conserva y el campo queda marcado', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.'));
    const servidor = await simularServidor(page);
    await abrir(page);
    await tomarYEsperar(page);
    await campo(page).fill('Hola');
    servidor.contestar('enviarComoPersona', () => error(429, 'RESOURCE_EXHAUSTED', { tope: 'minuto', esperaSegundos: 37 }));
    await enviar(page).click();
    await expect(page.locator('#cv-redactor-error')).toHaveText('Límite de envíos por minuto; intente en 37 s.');
    servidor.contestar('enviarComoPersona', () => error(429, 'RESOURCE_EXHAUSTED', { tope: 'dia' }));
    await enviar(page).click();
    await expect(page.locator('#cv-redactor-error')).toContainText('por día');
    servidor.contestar('enviarComoPersona', () => error(429, 'RESOURCE_EXHAUSTED', { tope: 'conversacion' }));
    await enviar(page).click();
    await expect(page.locator('#cv-redactor-error')).toContainText('esta conversación en esta ventana de 24 h');
    servidor.contestar('enviarComoPersona', () => error(429, 'RESOURCE_EXHAUSTED'));
    await enviar(page).click();
    await expect(page.locator('#cv-redactor-error')).toContainText('Alcanzó un límite de envíos');
    await expect(campo(page)).toHaveValue('Hola');
    await expect(campo(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(campo(page)).toHaveAttribute('aria-describedby', /cv-redactor-error/);
    servidor.contestar('enviarComoPersona', () => error(400, 'FAILED_PRECONDITION'));
    await enviar(page).click();
    await expect(page.locator('#cv-redactor-error')).toContainText('ya no tiene esta conversación');
    servidor.contestar('enviarComoPersona', () => error(403, 'PERMISSION_DENIED'));
    await enviar(page).click();
    await expect(page.locator('#cv-redactor-error')).toContainText('No tiene permiso');
    await expect(page.locator('body')).not.toContainText('DETALLE-INTERNO');
    // escribir de nuevo quita el error
    await campo(page).fill('Hola otra vez');
    await expect(page.locator('#cv-redactor-error')).toHaveCount(0);
  });

  test('contador y tope: 1.000 caracteres entran, 1.001 deshabilita «Enviar» y lo dice; un texto solo de espacios no se envía', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.'));
    const servidor = await simularServidor(page);
    await abrir(page);
    await tomarYEsperar(page);
    await campo(page).fill('a'.repeat(1000));
    await expect(page.locator('#cv-redactor-contador')).toHaveText('1.000 / 1.000');
    await expect(enviar(page)).toBeEnabled();
    await campo(page).fill('a'.repeat(1001));
    await expect(page.locator('#cv-redactor-contador')).toContainText('1.001 / 1.000');
    await expect(page.locator('#cv-redactor-contador')).toContainText('se pasó del máximo');
    await expect(enviar(page)).toBeDisabled();
    await expect(campo(page)).toHaveAttribute('aria-invalid', 'true');
    await campo(page).press('Control+Enter');                           // el atajo tampoco envía lo inválido
    await campo(page).fill('   \n  ');
    await expect(enviar(page)).toBeDisabled();
    await campo(page).press('Control+Enter');
    expect(servidor.llamadas.filter((l) => l.nombre === 'enviarComoPersona')).toHaveLength(0);
  });

  test('teclado: se llega a «Tomar» con Tab, Ctrl+Enter envía, Enter agrega un salto de línea y Escape en el campo NO cierra la conversación', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.'));
    const servidor = await simularServidor(page);
    await abrir(page);
    await tomar(page).focus();
    await expect(tomar(page)).toBeFocused();
    await page.keyboard.press('Enter');                                 // activar con el teclado
    await expect(estado(page)).toHaveText('Responde una persona (usted)');
    await campo(page).focus();
    await page.keyboard.type('Línea uno');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Línea dos');
    await expect(campo(page)).toHaveValue('Línea uno\nLínea dos');
    expect(servidor.llamadas.filter((l) => l.nombre === 'enviarComoPersona')).toHaveLength(0);   // Enter solo no envía
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(new RegExp(`/conversaciones/${CONV}$`));
    await expect(campo(page)).toBeFocused();
    await page.keyboard.press('Control+Enter');
    await expect.poll(() => servidor.llamadas.filter((l) => l.nombre === 'enviarComoPersona').length).toBe(1);
    expect(servidor.llamadas.at(-1)!.datos['texto']).toBe('Línea uno\nLínea dos');
    await expect(campo(page)).toBeFocused();                             // el foco no se pierde al enviar
  });

  test('ventana abierta: cuenta regresiva que baja cada segundo, contada desde el último mensaje del CLIENTE', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.', { entranteHaceMin: 20 * 60 }));   // hace 20 h: quedan ~4 h
    await simularServidor(page);
    await abrir(page);
    await tomarYEsperar(page);
    const cuenta = page.getByTestId('cuenta-regresiva');
    const primera = await cuenta.textContent();
    expect(primera).toMatch(/^0[34]:[0-5]\d:[0-5]\d$/);
    await page.waitForTimeout(2200);
    const segunda = await cuenta.textContent();
    expect(segunda).not.toBe(primera);
    expect(segunda! < primera!).toBe(true);
    await expect(page.getByRole('timer')).toBeVisible();
  });

  test('ventana por cerrar (36 s): se puede tomar, pero el campo ya no deja enviar (margen de 60 s del servidor) y lo explica', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.', { entranteHaceMin: 24 * 60 - 0.6 }));
    await simularServidor(page);
    await abrir(page);
    await tomarYEsperar(page);
    await expect(campo(page)).toBeDisabled();
    await expect(page.locator('#cv-redactor-ayuda')).toContainText('ventana de 24 h de WhatsApp está cerrada');
    await expect(enviar(page)).toBeDisabled();
    await expect(page.getByTestId('cuenta-regresiva')).toHaveCount(0);
  });

  test('ventana CERRADA (más de 24 h) o SIN DATO: «Tomar» no se ofrece (el servidor lo rechaza) y se explica; la cabecera dice «sin dato» si falta', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.', { entranteHaceMin: 26 * 60 }));
    await sembrarConversacion(FOGON, TEL_B, HOLA, campos(TEL_B, 'Mauricio T.', { entranteHaceMin: null }));
    await simularServidor(page);
    await abrir(page);
    await expect(tomar(page)).toHaveCount(0);
    await expect(page.locator('#cv-turno-sin-ventana')).toContainText('No se puede tomar');
    await expect(page.locator('.cv-pastilla')).toContainText('Ventana cerrada');
    await page.goto(`/negocio/${FOGON}/conversaciones/${CONV_B}`);
    await expect(page.getByTestId('detalle')).toBeVisible();
    await expect(tomar(page)).toHaveCount(0);
    await expect(page.locator('#cv-turno-sin-ventana')).toBeVisible();
    await expect(page.locator('.cv-pastilla')).toHaveText('Ventana: sin dato');
  });

  test('un turno que venció por inactividad (31 min) se ve como «Responde el asistente» y «Tomar» está disponible para cualquiera', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.', { turno: turnoDe(OTRO_UID, 31) }));
    await abrir(page);
    await expect(estado(page)).toHaveText('Responde el asistente');
    await expect(tomar(page)).toBeVisible();
    await expect(page.locator('.cv-ficha', { hasText: 'Ximena P.' })).not.toContainText('Responde una persona');
  });

  test('un mensaje rechazado explica el motivo con un texto fijo por el código de Meta', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.', { turno: turnoDe(OTRO_UID) }));
    const col = bd().collection(`tenants/${FOGON}/conversaciones/${CONV}/mensajes`);
    await col.doc('r1').set({ direccion: 'saliente', autor: 'persona', autorUid: OTRO_UID, texto: 'uno', estadoEnvio: 'rechazado', codigoEnvio: '131047', ts: Timestamp.now() });
    await col.doc('r2').set({ direccion: 'saliente', autor: 'persona', autorUid: OTRO_UID, texto: 'dos', estadoEnvio: 'rechazado', codigoEnvio: '999999', ts: Timestamp.now() });
    await col.doc('r3').set({ direccion: 'saliente', autor: 'persona', autorUid: OTRO_UID, texto: 'tres', estadoEnvio: 'rechazado', codigoEnvio: 'WM-3037', esperaSegundos: 12, ts: Timestamp.now() });
    await abrir(page);
    const motivo = (t: string) => page.locator('.cv-burbuja', { hasText: t }).getByTestId('motivo-rechazo');
    await expect(motivo('uno')).toContainText('Pasaron más de 24 horas');
    await expect(motivo('dos')).toHaveText('WhatsApp no aceptó el mensaje.');
    await expect(motivo('tres')).toHaveText('Límite de envíos; intente en 12 s.');
    await expect(page.locator('body')).not.toContainText('999999');
  });

  test('al cambiar de conversación con un envío sin confirmar, al volver quedan el texto y LA MISMA clave (en memoria, no en el navegador)', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.'));
    await sembrarConversacion(FOGON, TEL_B, HOLA, campos(TEL_B, 'Mauricio T.'));
    const servidor = await simularServidor(page);
    await abrir(page);
    await tomarYEsperar(page);
    servidor.contestar('enviarComoPersona', () => error(504, 'DEADLINE_EXCEEDED'));
    await campo(page).fill('Pendiente de confirmar');
    await enviar(page).click();
    await expect(page.locator('#cv-redactor-error')).toContainText('No se pudo confirmar si llegó');
    await page.locator('.cv-ficha', { hasText: 'Mauricio T.' }).click();
    await expect(page.getByTestId('detalle')).toContainText('Mauricio T.');
    await page.locator('.cv-ficha', { hasText: 'Ximena P.' }).click();
    await expect(campo(page)).toHaveValue('Pendiente de confirmar');
    await enviar(page).click();
    const envios = () => servidor.llamadas.filter((l) => l.nombre === 'enviarComoPersona');
    await expect.poll(() => envios().length).toBe(2);
    expect(envios()[1]!.datos['claveIdempotencia']).toBe(envios()[0]!.datos['claveIdempotencia']);
  });

  test('filtro «El asistente atiende»: deja las que no tiene una persona; su número es todas menos las de una persona', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.', { turno: turnoDe(OTRO_UID) }));
    await sembrarConversacion(FOGON, TEL_B, HOLA, campos(TEL_B, 'Mauricio T.'));
    await sembrarConversacion(FOGON, '59100000012', HOLA, campos('59100000012', 'Marcela R.'));
    await ingresar(page, USUARIOS.adminFogon);
    await page.getByRole('link', { name: 'Conversaciones', exact: true }).click();
    await expect(page.getByTestId('lista')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Todas/ })).toContainText('3');
    await expect(page.getByRole('button', { name: /^El asistente atiende/ })).toContainText('2');
    await page.getByRole('button', { name: /^El asistente atiende/ }).click();
    await expect(page.locator('.cv-ficha')).toHaveCount(2);
    await expect(page.locator('.cv-ficha', { hasText: 'Ximena P.' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Todas/ }).click();
    await expect(page.locator('.cv-ficha')).toHaveCount(3);
    await expect(page.locator('.cv-ficha', { hasText: 'Ximena P.' })).toContainText('Responde una persona');
  });

  test('NEGATIVA (aislamiento): la conversación de otro comercio que tiene una persona no aparece ni se puede abrir; las callables mandan SOLO el comercio de la ruta', async ({ page }) => {
    await sembrarConversacion('salon-aurora', '59100000099', [{ direccion: 'entrante', texto: 'secreto de la peluquería', minutosAtras: 5 }],
      campos('59100000099', 'Cliente Aurora', { turno: turnoDe(OTRO_UID) }));
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.'));
    const servidor = await simularServidor(page);
    await abrir(page);
    await expect(page.getByText('Cliente Aurora')).toHaveCount(0);
    await page.goto('/negocio/salon-aurora/conversaciones/wa_59100000099');
    await expect(page.getByText('secreto de la peluquería')).toHaveCount(0);
    await expect(tomar(page)).toHaveCount(0);
    await page.goto(`/negocio/${FOGON}/conversaciones/${CONV}`);
    await tomarYEsperar(page);
    expect(servidor.llamadas.every((l) => l.datos['tenantId'] === FOGON)).toBe(true);
    await limpiarConversaciones('salon-aurora');
  });

  test('NEGATIVA: nada de lo que se escribe queda en el almacenamiento del navegador', async ({ page }) => {
    await sembrarConversacion(FOGON, TEL, HOLA, campos(TEL, 'Ximena P.'));
    await simularServidor(page);
    await abrir(page);
    await tomarYEsperar(page);
    await campo(page).fill('BORRADOR-QUE-NO-SE-GUARDA-EN-EL-NAVEGADOR');
    const guardado = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(guardado).not.toContain('BORRADOR-QUE-NO-SE-GUARDA');
    await page.reload();
    await expect(campo(page)).toHaveCount(0);                            // un borrador no sobrevive: no hay dónde guardarlo
  });
});
