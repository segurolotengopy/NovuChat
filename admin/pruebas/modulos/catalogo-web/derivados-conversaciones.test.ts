/**
 * EL CARRITO DE LA WEB ESCRIBE LOS CAMPOS DERIVADOS DE CONVERSACIONES (H1).
 *
 * `checkoutCatalogo` crea la conversación y un mensaje `entrante` de tipo
 * `order` fuera de la ingesta. Con H1 la ingesta escribe los campos derivados
 * que lee la pantalla nueva de Conversaciones; este escritor paralelo tenía que
 * escribir su parte, o los pedidos web no aparecerían en «No leídas» ni en la
 * búsqueda por texto.
 *
 * Qué fija esta suite, corriendo `checkoutCatalogo` DE VERDAD contra el emulador:
 *   - cada pedido sube `noLeidos` en 1 y deja `sinLeer: true` (1, luego 2);
 *   - NO escribe `ultimoEntranteEn` ni `ventanaVenceEn`: un carrito web no abre
 *     ni renueva la ventana de 24 h de Meta (con una conversación ya existente
 *     sus valores quedan intactos);
 *   - el mensaje `order` lleva `tenantId` IGUAL al segmento de su ruta y
 *     `palabras` (de 1 a 30), con id automático de 20 caracteres;
 *   - los contadores de facturación (`metricas`, `cuenta/estado` y las marcas de
 *     la conversación) no cambian;
 *   - el flujo NO es idempotente por diseño (cada petición es un pedido nuevo):
 *     lo que se fija es que `noLeidos` y `mensajesTotal` suben juntos, en el
 *     mismo lote, así que nunca se cuenta un mensaje sin su no leído.
 *
 * Emulador, con puerto propio:
 *   FIRESTORE_EMULATOR_PORT=8291 FIRESTORE_EMULATOR_WS_PORT=9211 \
 *     bash pruebas/correr.sh --project emulador pruebas/modulos/catalogo-web/derivados-conversaciones.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
process.env['SITIO_PUBLICO'] = 'https://catalogo.ejemplo.test';
process.env['INGESTA_CLIENTE16'] = 'valor-de-prueba-de-los-derivados';

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const { checkoutCatalogo, emitirFicha } =
  await import('../../../functions/src/modulos/catalogo-web/catalogoWeb.ts');
const { limitesDe } = await import('../../../functions/src/central/cuenta/planes.ts');
const { palabrasDe, trozosDeTelefono, MAX_PALABRAS_POR_MENSAJE } =
  await import('../../../functions/src/core/conversacion/normalizacion.ts');

const ADMIN = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PUERTO_ID = '1000000401';

/** Dos comercios con teléfonos propios: uno sin conversación previa y otro con ventana ya abierta. */
const NUEVO = { t: 'deriv-web-nuevo', tel: '70030001', pid: PUERTO_ID };
const PREVIO = { t: 'deriv-web-previo', tel: '70030002', pid: '1000000402' };

interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }

async function checkout(ficha: string, cuerpo: unknown): Promise<Respuesta> {
  const cabeceras: Record<string, string> = { 'content-type': 'application/json' };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const ruta = `/api/catalogo/${ficha}/checkout`;
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer, path: ruta, url: ruta, originalUrl: ruta,
  };
  const r: Respuesta = { codigo: 0, cuerpo: {} };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = { texto: b }; return respuesta; },
    json(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, type() { return respuesta; },
    on() { return respuesta; }, end() { return respuesta; },
  };
  await (checkoutCatalogo as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

const ITEMS = [{ id: 'i000', cantidad: 1 }];

async function pedir(c: typeof NUEVO): Promise<Respuesta> {
  const f = await emitirFicha({
    tenantId: c.t, phoneNumberId: c.pid, flujo: 'venta', telefono: c.tel, reutilizar: false,
  });
  const r = await checkout(f.id, { items: ITEMS, entrega: 'retiro' });
  expect(r.codigo, JSON.stringify(r.cuerpo)).toBe(200);
  return r;
}

const refConv = (c: typeof NUEVO) => db.doc(`tenants/${c.t}/conversaciones/wa_${c.tel}`);
const conv = async (c: typeof NUEVO) => (await refConv(c).get()).data() ?? {};
const mensajes = async (c: typeof NUEVO) => (await refConv(c).collection('mensajes').get()).docs;
const fotoFacturacion = async (c: typeof NUEVO) => ({
  metricas: (await db.collection(`tenants/${c.t}/metricas`).get()).docs.map((d) => [d.id, d.data()]),
  cuenta: (await db.doc(`tenants/${c.t}/cuenta/estado`).get()).data(),
});

const ANTES = Timestamp.fromMillis(Date.parse('2026-10-01T12:00:00Z'));
const VENCE = Timestamp.fromMillis(Date.parse('2026-10-02T12:00:00Z'));
const MARCAS = {
  atencionDesde: ANTES, periodoContado: '2026-10', respuestasDelPeriodo: 3, mensajesVentana: 5,
  periodoInteraccion: '2026-10', origen: 'organico',
};

async function sembrar(c: typeof NUEVO): Promise<void> {
  await db.doc(`rutasWhatsApp/${c.pid}`).set({
    tenantId: c.t, flujo: 'venta', aliasSecreto: 'cliente16', estado: 'activo',
  });
  await db.doc(`tenants/${c.t}`).set({ nombre: c.t, estado: 'activo', plan: 'crecimiento', flujos: ['venta'] });
  await db.doc(`tenants/${c.t}/cuenta/estado`).set({
    plan: 'crecimiento', limites: limitesDe('crecimiento'), modalidad: 'demostracion',
  });
  await db.doc(`tenants/${c.t}/config/negocio`).set({
    nombreNegocio: c.t, numeroRecepcion: '70000001', catalogoWebActivo: true,
  });
  await db.doc(`tenants/${c.t}/catalogo/i000`).set({
    nombre: 'Salteñas de pollo', area: 'tacos', precio: 10, moneda: 'BOB', activo: true,
  });
}

beforeAll(async () => {
  await sembrar(NUEVO);
  await sembrar(PREVIO);
  // Conversación previa: ya tenía ventana abierta, marcas de facturación y 2 no leídos.
  await refConv(PREVIO).set({
    ...MARCAS, ultimoEntranteEn: ANTES, ventanaVenceEn: VENCE, noLeidos: 2, sinLeer: true,
  });
}, 60_000);

afterAll(async () => {
  for (const c of [NUEVO, PREVIO]) {
    await db.recursiveDelete(db.doc(`tenants/${c.t}`));
    await db.doc(`rutasWhatsApp/${c.pid}`).delete();
    for (const f of (await db.collection('fichasCatalogo').where('tenantId', '==', c.t).get()).docs) {
      await f.ref.delete();
    }
  }
});

describe('conversación NUEVA creada por un carrito web', () => {
  it('el primer pedido deja noLeidos=1 y sinLeer=true; el segundo, noLeidos=2', async () => {
    await pedir(NUEVO);
    const a = await conv(NUEVO);
    expect(a['noLeidos']).toBe(1);
    expect(a['sinLeer']).toBe(true);
    await pedir(NUEVO);
    const b = await conv(NUEVO);
    expect(b['noLeidos']).toBe(2);
    expect(b['sinLeer']).toBe(true);
  });

  it('NEGANDO: no abre la ventana de 24 h: ni `ultimoEntranteEn` ni `ventanaVenceEn`', async () => {
    const d = await conv(NUEVO);
    expect(d).not.toHaveProperty('ultimoEntranteEn');
    expect(d).not.toHaveProperty('ventanaVenceEn');
    // Ni la ancla de atención que usa la ingesta: un carrito no abre atención.
    expect(d).not.toHaveProperty('atencionDesde');
  });

  it('lleva los trozos del teléfono para hallar el número por sus últimos dígitos', async () => {
    expect((await conv(NUEVO))['telefonoTrozos']).toEqual(trozosDeTelefono(NUEVO.tel));
  });

  it('noLeidos y mensajesTotal suben juntos: nunca un mensaje sin su no leído (mismo lote)', async () => {
    const d = await conv(NUEVO);
    const docs = await mensajes(NUEVO);
    expect(docs.length).toBeGreaterThanOrEqual(2);
    expect(d['noLeidos']).toBe(docs.length);
    expect(d['mensajesTotal']).toBe(docs.length);
  });
});

describe('conversación PREVIA con ventana abierta', () => {
  it('suma 1 a los no leídos que ya tenía y NO mueve ni la ventana ni la ancla', async () => {
    await pedir(PREVIO);
    const d = await conv(PREVIO);
    expect(d['noLeidos']).toBe(3);
    expect(d['sinLeer']).toBe(true);
    expect((d['ultimoEntranteEn'] as FirebaseFirestore.Timestamp).toMillis()).toBe(ANTES.toMillis());
    expect((d['ventanaVenceEn'] as FirebaseFirestore.Timestamp).toMillis()).toBe(VENCE.toMillis());
  });

  it('NEGANDO: las marcas de facturación de la conversación quedan como estaban', async () => {
    const d = await conv(PREVIO);
    expect((d['atencionDesde'] as FirebaseFirestore.Timestamp).toMillis()).toBe(ANTES.toMillis());
    for (const k of ['periodoContado', 'respuestasDelPeriodo', 'mensajesVentana', 'periodoInteraccion', 'origen'] as const) {
      expect(d[k], k).toEqual(MARCAS[k]);
    }
  });
});

describe('el mensaje `order`', () => {
  it('lleva `tenantId` IGUAL al segmento de su ruta (la condición de seguridad)', async () => {
    for (const c of [NUEVO, PREVIO]) {
      const docs = (await mensajes(c)).filter((m) => m.get('tipo') === 'order');
      expect(docs.length, c.t).toBeGreaterThan(0);
      for (const m of docs) {
        // tenants/{t}/conversaciones/{c}/mensajes/{m}
        const segmentos = m.ref.path.split('/');
        expect(segmentos[0]).toBe('tenants');
        expect(m.get('tenantId'), m.ref.path).toBe(segmentos[1]);
        expect(m.get('tenantId')).toBe(c.t);
      }
    }
  });

  it('lleva `palabras` (de 1 a 30) calculadas del mismo texto que se guarda', async () => {
    for (const m of (await mensajes(NUEVO))) {
      const palabras = m.get('palabras') as string[];
      expect(Array.isArray(palabras)).toBe(true);
      expect(palabras.length).toBeGreaterThan(0);
      expect(palabras.length).toBeLessThanOrEqual(MAX_PALABRAS_POR_MENSAJE);
      expect(palabras).toEqual(palabrasDe(m.get('texto')));
    }
  });

  it('conserva sus campos de siempre: dirección entrante, tipo order y el id automático de 20 caracteres', async () => {
    for (const m of (await mensajes(NUEVO))) {
      expect(m.id).toMatch(/^[A-Za-z0-9]{20}$/);
      expect(m.get('direccion')).toBe('entrante');
      expect(m.get('tipo')).toBe('order');
      expect(typeof m.get('texto')).toBe('string');
      expect(m.get('ts')).toBeDefined();
    }
  });
});

describe('facturación: el carrito web sigue sin mover los contadores', () => {
  it('NEGANDO: no se crea ningún documento de `metricas` y `cuenta/estado` no cambia', async () => {
    const antes = await fotoFacturacion(NUEVO);
    await pedir(NUEVO);
    const despues = await fotoFacturacion(NUEVO);
    expect(despues.metricas).toEqual([]);
    expect(despues).toEqual(antes);
    const antesP = await fotoFacturacion(PREVIO);
    await pedir(PREVIO);
    expect(await fotoFacturacion(PREVIO)).toEqual(antesP);
  });
});

describe('el código: lo que no debe volver a aparecer', () => {
  const f = readFileSync(
    join(ADMIN, 'functions', 'src', 'modulos', 'catalogo-web', 'catalogoWeb.ts'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

  it('NEGANDO: el checkout no escribe la ventana ni usa el calculador que la mueve', () => {
    expect(f).not.toContain('ventanaVenceEn');
    expect(f).not.toContain('ultimoEntranteEn');
    expect(f).not.toContain('camposDeConversacionPorMensaje');
  });

  it('el `tenantId` del mensaje sale de la misma variable que arma la ruta', () => {
    expect(f).toContain('camposDeMensajeIndexado(resumen, ficha.tenantId)');
    expect(f).toContain('tenants/${ficha.tenantId}/conversaciones/${conversacionId}');
  });
});
