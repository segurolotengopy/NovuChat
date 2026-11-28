/**
 * LA NOTA DEL CLIENTE A NIVEL DE PEDIDO Y SU ENVÍO A NOVUTIENDA (27/11/2026), NEGANDO PRIMERO.
 *
 * Tres frentes:
 *   N1. De dónde sale `notaCliente` (`armarPedidoWa`, parámetro `nota`): del campo propio, saneado y de hasta 500 caracteres.
 *   N2. El cuerpo (`armarCuerpo`) y la validación de la nota (`notaParaNovuTienda`): sin nota, el JSON es BYTE A BYTE el de hoy.
 *   N3. La callable de verdad contra el emulador: la nota solo sale con la bandera `notaANovuTienda === true` del comercio,
 *       nunca con la bandera apagada (ni en el reintento), y una nota inválida no aborta la confirmación.
 *
 * Mutación por razonamiento: si `atenderConfirmacion` dejara de consultar `enviarNotaDe`, las pruebas de N3 «bandera
 * ausente / false / texto / 1 / null» fallarían (el cuerpo traería `nota`); si `armarCuerpo` agregara la clave vacía, fallaría
 * «sin nota: la clave no existe».
 */
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const requerir = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'functions', 'package.json'));
const { logger } = requerir('firebase-functions') as typeof import('firebase-functions');
for (const nivel of ['warn', 'info', 'error', 'log', 'debug', 'write'] as const) {
  (logger as unknown as Record<string, unknown>)[nivel] = () => undefined;
}

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const M = await import('../../../functions/src/modulos/pedidos/confirmarExterno.ts');
const Q = await import('../../../functions/src/modulos/pedidos/pedidoDelQr.ts');

const lineaExt = (id: string, o: Record<string, unknown> = {}) => (
  { externa: true, id, nombre: `Producto ${id}`, cantidad: 1, precioCentavos: 1000, moneda: 'BOB', ...o });
const armarExt = (nota?: unknown, lineas: unknown[] = [lineaExt('a')]) =>
  Q.armarPedidoWa(lineas, 'retiro', null, {}, 'BM1', '59170000009', 10, { monedas: ['BOB'] }, false, nota).pedido;
const DOCS_PROPIOS = { 'prod-1': { activo: true, nombre: 'Café', precio: 10, moneda: 'BOB' } };
const armarPropio = (nota?: unknown) =>
  Q.armarPedidoWa([{ id: 'prod-1', cantidad: 1 }], 'retiro', null, DOCS_PROPIOS as never, 'BM2', '59170000009', 10, null, false, nota).pedido;

// ===========================================================================
describe('N1. `armarPedidoWa` y la nota del cliente (campo propio)', () => {
  it('la constante: 500 para la nota; el detalle por línea sigue en 120', () => {
    expect(Q.MAX_NOTA_WA).toBe(500);
    expect(Q.MAX_DETALLE_WA).toBe(120);
  });
  it('catálogo externo y catálogo propio: la nota queda como `notaCliente`', () => {
    expect(armarExt('sin cebolla, por favor')?.notaCliente).toBe('sin cebolla, por favor');
    const p = armarPropio('con hielo');
    expect(p, 'el documento de catálogo de la prueba debe ser comprable').not.toBeNull();
    expect(p?.notaCliente).toBe('con hielo');
  });
  it('sin nota, vacía, solo espacios o que no es texto: el pedido NO lleva `notaCliente` (ni vacío)', () => {
    for (const nota of [undefined, null, '', '   ', ' \t\n ', 5, {}, [], ['x'], true]) {
      const p = armarExt(nota);
      expect(p, JSON.stringify(nota)).not.toBeNull();
      expect(p, JSON.stringify(nota)).not.toHaveProperty('notaCliente');
      expect(armarPropio(nota)).not.toHaveProperty('notaCliente');
    }
  });
  it('sin el parámetro, el pedido es idéntico al de siempre', () => {
    const sin = Q.armarPedidoWa([lineaExt('a')], 'retiro', null, {}, 'BM1', '59170000009', 10, { monedas: ['BOB'] });
    expect(JSON.stringify(sin)).toBe(JSON.stringify({ pedido: armarExt(), descartados: [] }));
    expect(sin.pedido).not.toHaveProperty('notaCliente');
  });
  it('500 caracteres entran enteros; 501 y más se recortan a 500 por puntos de código', () => {
    expect(armarExt('a'.repeat(500))?.notaCliente).toBe('a'.repeat(500));
    expect(armarExt('a'.repeat(501))?.notaCliente).toBe('a'.repeat(500));
    // El saneo mira como mucho los primeros 1000 caracteres: un texto enorme igual da una nota de 500.
    expect(Array.from(armarExt('b'.repeat(5000))?.notaCliente ?? '')).toHaveLength(500);
    const emojis = armarExt('😀'.repeat(600))?.notaCliente ?? '';
    expect(Array.from(emojis)).toHaveLength(500);
    expect(emojis).not.toMatch(/\p{Cs}/u); // jamás un par sustituto cortado
  });
  it('queda saneada: sin enlaces, sin marcas, sin caracteres de control', () => {
    const n = armarExt('mire https://malo.example/x www.malo.example <b>hola</b>\u0007 &fin')?.notaCliente ?? '';
    expect(n).not.toMatch(/http|www\.|[<>&]/);
    expect(n).not.toMatch(/\p{Cc}/u);
    expect(n).toContain('hola');
    expect(armarExt('https://solo.enlace/aqui')).not.toHaveProperty('notaCliente'); // solo enlace = nada
  });
  it('el detalle de las líneas NO cambia: sigue recortado a 120 y no se mezcla con la nota', () => {
    const p = armarExt('la nota', [lineaExt('a', { detalle: 'd'.repeat(300) }), lineaExt('b', { detalle: 'roble' })]);
    expect(p?.items.map((i) => Array.from(String(i['detalle'])).length)).toEqual([120, 5]);
    expect(p?.notaCliente).toBe('la nota');
  });
});

// ===========================================================================
describe('N2. el cuerpo y la validación de la nota', () => {
  const ITEMS = [{ id: 'sku-1', cantidad: 2, externa: true }, { id: 'mesa.2_a-3', cantidad: 5, externa: true }];
  const AHORA = Date.UTC(2026, 10, 27, 15, 0, 0);
  const DE_HOY = JSON.stringify({
    pedidoId: 'wa_BM1', items: [{ productoId: 'sku-1', cantidad: 2 }, { productoId: 'mesa.2_a-3', cantidad: 5 }],
    confirmadoEn: new Date(AHORA).toISOString(),
  });

  it('sin nota: el JSON es BYTE A BYTE el de hoy y la clave no existe (ni vacía, ni null)', () => {
    for (const nota of [undefined, null, '', '   ']) {
      const c = M.armarCuerpo('wa_BM1', ITEMS, AHORA, nota as never);
      expect(JSON.stringify(c)).toBe(DE_HOY);
      expect(c).not.toHaveProperty('nota');
    }
    expect(JSON.stringify(M.armarCuerpo('wa_BM1', ITEMS, AHORA))).toBe(DE_HOY);
  });
  it('con nota: la clave `nota` va AL FINAL (orden estable) y lo demás no cambia', () => {
    const c = M.armarCuerpo('wa_BM1', ITEMS, AHORA, 'sin cebolla');
    expect(Object.keys(c!)).toEqual(['pedidoId', 'items', 'confirmadoEn', 'nota']);
    expect(JSON.stringify(c)).toBe(DE_HOY.slice(0, -1) + ',"nota":"sin cebolla"}');
  });
  it('la firma se recalcula sobre el cuerpo EXACTO con nota, y difiere de la del cuerpo sin nota', () => {
    const con = JSON.stringify(M.armarCuerpo('wa_BM1', ITEMS, AHORA, 'hola'));
    const sin = JSON.stringify(M.armarCuerpo('wa_BM1', ITEMS, AHORA));
    const esperada = createHmac('sha256', 'secreto-de-prueba').update('123.').update(con).digest('hex');
    expect(M.firmaDeConfirmacion('secreto-de-prueba', 123, con)).toBe(esperada);
    expect(M.firmaDeConfirmacion('secreto-de-prueba', 123, con)).not.toBe(M.firmaDeConfirmacion('secreto-de-prueba', 123, sin));
  });
  it('una nota inválida pasada a armarCuerpo tampoco sale (se vuelve a validar)', () => {
    for (const nota of ['x'.repeat(501), 'a\u0000b', 'a\nb', 'a\tb', 'a\u007fb', 'a\u0085b', 'a\u2028b', 'a\u2029b', '\ud83d', 'a\ud83db']) {
      expect(JSON.stringify(M.armarCuerpo('wa_BM1', ITEMS, AHORA, nota))).toBe(DE_HOY);
    }
  });
  it('validación: más de 500 puntos de código no se envía; 500 ASCII se envían enteros', () => {
    expect(M.notaParaNovuTienda('a'.repeat(500))).toBe('a'.repeat(500));
    expect(M.notaParaNovuTienda('a'.repeat(501))).toBeNull();
    expect(M.notaParaNovuTienda('😀'.repeat(501))).toBeNull();
  });
  it('conteo confirmado por NovuTienda: 500 PUNTOS de código entran enteros, aunque sean 1000 unidades UTF-16; nunca se recorta', () => {
    for (const n of [251, 400, 500]) expect(M.notaParaNovuTienda('😀'.repeat(n)), String(n)).toBe('😀'.repeat(n));
    expect(M.notaParaNovuTienda('a'.repeat(499) + '😀')).toBe('a'.repeat(499) + '😀');
    expect(M.notaParaNovuTienda('😀'.repeat(501))).toBeNull();
  });
  it('validación: control (\\p{Cc}), par sustituto cortado, solo espacios, vacío y tipos ajenos = null', () => {
    for (const v of ['a\u0000b', 'a\u001fb', 'a\tb', 'a\nb', 'a\u007fb', 'a\u0085b', 'a\u2028b', 'a\u2029b', 'a\u009fb', '\ud83d', '\ude00', 'ab\ud83d', '😀'.slice(0, 1), '', ' ', '   ', undefined, null, 7, {}, ['a']]) {
      expect(M.notaParaNovuTienda(v), JSON.stringify(v)).toBeNull();
    }
    expect(M.notaParaNovuTienda('con tildes, ñ y 😀 va')).toBe('con tildes, ñ y 😀 va');
  });
  it('la bandera: solo `true` estricto enciende', () => {
    expect(M.enviarNotaDe({ notaANovuTienda: true })).toBe(true);
    for (const v of [undefined, false, 'true', 'TRUE', 1, 0, null, {}, [], [true]]) {
      expect(M.enviarNotaDe({ notaANovuTienda: v }), String(v)).toBe(false);
    }
    for (const c of [undefined, null, {}, 'true', 1, [], { catalogoExterno: { activo: true, notaANovuTienda: true } }]) {
      expect(M.enviarNotaDe(c)).toBe(false); // sin el campo en la raíz del documento, o con un documento ajeno
    }
  });
});

// ===========================================================================
describe('N3. la callable: la nota solo sale con la bandera encendida', () => {
  const T = 'bermejo-prueba';
  const AHORA = Date.UTC(2026, 10, 27, 15, 0, 0);
  const FIRMA = 'FIRMA-SECRETA-DE-PRUEBA';
  const h = { llamadas: [] as Array<{ cuerpo: string; cab: Record<string, string> }>, respuestas: [{ estado: 200 }] as Array<{ estado: number }> };
  const http = (async (_u: string, init?: RequestInit) => {
    h.llamadas.push({ cuerpo: String(init?.body ?? ''), cab: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)) });
    const r = h.respuestas.length > 1 ? h.respuestas.shift()! : h.respuestas[0]!;
    return new Response(null, { status: r.estado });
  }) as unknown as typeof fetch;
  const callable = M.crearConfirmarPedidoExterno({
    leerSecreto: () => JSON.stringify({ [T]: { baseUrl: 'https://tienda.example.org/', firmaSecreto: FIRMA } }),
    cuentaVigente: (async () => true) as never,
    db: () => db, http, dormir: async () => undefined, ahora: () => AHORA,
  });
  const admin = {
    uid: 'u-admin',
    token: { nc: { v: 1, t: { [T]: 'admin' } }, firebase: { sign_in_provider: 'password', identities: {} }, email_verified: true, auth_time: Math.floor(Date.now() / 1000) - 60 },
  };
  const llamar = () => (callable as unknown as { run: (r: unknown) => Promise<unknown> })
    .run({ data: { tenantId: T, pedidoId: 'wa_BM1' }, auth: admin, rawRequest: {} });
  const DE_HOY = JSON.stringify({
    pedidoId: 'wa_BM1', items: [{ productoId: 'sku-1', cantidad: 2 }], confirmadoEn: new Date(AHORA).toISOString(),
  });

  async function sembrar(config: Record<string, unknown>, extraPedido: Record<string, unknown> = {}) {
    await db.recursiveDelete(db.doc(`tenants/${T}`));
    await db.doc(`tenants/${T}`).set({ nombre: T, estado: 'activo', flujos: ['venta'], modulos: ['productos', 'pedidos'] });
    await db.doc(`tenants/${T}/config/pedidos`).set({ catalogoExterno: { activo: true, monedas: ['BOB'] }, ...config });
    await db.doc(`tenants/${T}/pedidos/wa_BM1`).set({
      origen: 'whatsapp', conversacionId: 'wa_59170000009', telefonoEnmascarado: '****009', total: 20, moneda: 'BOB', costoEnvio: 0,
      entrega: 'retiro', referenciaQr: 'BM1', totalServidorCentavos: 2000, montoQrCentavos: 2000, totalDistinto: false,
      catalogo: 'externo', estado: 'recibido',
      items: [{ id: 'sku-1', nombre: 'Producto', cantidad: 2, precio: 10, precioCentavos: 1000, moneda: 'BOB', subtotal: 20, externa: true }],
      ...extraPedido,
    });
  }
  const firmaOk = (l: { cuerpo: string; cab: Record<string, string> }) =>
    l.cab['X-Firma'] === createHmac('sha256', FIRMA).update(`${l.cab['X-Marca-Tiempo']}.`).update(l.cuerpo).digest('hex');

  beforeEach(() => { h.llamadas = []; h.respuestas = [{ estado: 200 }]; });

  it('bandera AUSENTE y pedido con nota: el cuerpo es el de hoy, sin `nota`', async () => {
    await sembrar({}, { notaCliente: 'sin cebolla' });
    expect(await llamar()).toMatchObject({ estado: 'confirmado' });
    expect(h.llamadas).toHaveLength(1);
    expect(h.llamadas[0]!.cuerpo).toBe(DE_HOY);
    expect(h.llamadas[0]!.cuerpo).not.toContain('nota');
  });
  it('bandera false, "true", "TRUE", 1, null, objeto: apagada (cuerpo idéntico al de hoy)', async () => {
    for (const v of [false, 'true', 'TRUE', 1, null, { activo: true }]) {
      await sembrar({ notaANovuTienda: v }, { notaCliente: 'sin cebolla' });
      h.llamadas = [];
      expect(await llamar(), String(v)).toMatchObject({ estado: 'confirmado' });
      expect(h.llamadas[0]!.cuerpo, String(v)).toBe(DE_HOY);
    }
  });
  it('la bandera DENTRO de catalogoExterno no cuenta (vive junto a él, no dentro)', async () => {
    await sembrar({ catalogoExterno: { activo: true, monedas: ['BOB'], notaANovuTienda: true } }, { notaCliente: 'sin cebolla' });
    await llamar();
    expect(h.llamadas[0]!.cuerpo).toBe(DE_HOY);
  });
  it('bandera true y pedido SIN notaCliente (ausente, vacía o no texto): el cuerpo es el de hoy', async () => {
    for (const extra of [{}, { notaCliente: '' }, { notaCliente: '   ' }, { notaCliente: 5 }, { notaCliente: null }]) {
      await sembrar({ notaANovuTienda: true }, extra);
      h.llamadas = [];
      expect(await llamar(), JSON.stringify(extra)).toMatchObject({ estado: 'confirmado' });
      expect(h.llamadas[0]!.cuerpo, JSON.stringify(extra)).toBe(DE_HOY);
    }
  });
  it('bandera true y nota: el cuerpo trae `nota` al final y la firma cubre el cuerpo exacto', async () => {
    await sembrar({ notaANovuTienda: true }, { notaCliente: 'sin cebolla 😀' });
    expect(await llamar()).toMatchObject({ estado: 'confirmado', yaConfirmado: false });
    expect(h.llamadas).toHaveLength(1);
    expect(h.llamadas[0]!.cuerpo).toBe(DE_HOY.slice(0, -1) + ',"nota":"sin cebolla 😀"}');
    expect(firmaOk(h.llamadas[0]!)).toBe(true);
  });
  it('nota de 400 emojis (guardada): sale ENTERA (400 puntos de código) y la firma cubre ese cuerpo', async () => {
    await sembrar({ notaANovuTienda: true }, { notaCliente: '😀'.repeat(400) });
    await llamar();
    const nota = JSON.parse(h.llamadas[0]!.cuerpo).nota as string;
    expect(nota).toBe('😀'.repeat(400));
    expect(firmaOk(h.llamadas[0]!)).toBe(true);
    expect((await db.doc(`tenants/${T}/pedidos/wa_BM1`).get()).get('notaCliente')).toBe('😀'.repeat(400)); // lo guardado no se recorta
  });
  it('nota de 500 caracteres: sale; la clave jamás lleva nada más que la nota', async () => {
    await sembrar({ notaANovuTienda: true }, { notaCliente: 'z'.repeat(500) });
    await llamar();
    expect(JSON.parse(h.llamadas[0]!.cuerpo)).toEqual({ ...JSON.parse(DE_HOY), nota: 'z'.repeat(500) });
  });
  it('nota inválida (501, control, par sustituto cortado, solo espacios): NO se envía y la confirmación sigue', async () => {
    for (const nota of ['q'.repeat(501), 'a\u0000b', 'a\nb', 'a\tb', 'a\u2028b', 'a\u2029b', 'a\u0085b', 'a\u007fb', '   ']) {
      await sembrar({ notaANovuTienda: true }, { notaCliente: nota });
      h.llamadas = [];
      expect(await llamar(), JSON.stringify(nota)).toMatchObject({ estado: 'confirmado' });
      expect(h.llamadas).toHaveLength(1);
      expect(h.llamadas[0]!.cuerpo, JSON.stringify(nota)).toBe(DE_HOY);
      expect((await db.doc(`tenants/${T}/pedidos/wa_BM1`).get()).get('estado')).toBe('confirmado');
    }
  });
  it('reintento (503 y luego 200): con la bandera apagada JAMÁS sale `nota`; encendida, el cuerpo es el mismo byte a byte en cada intento', async () => {
    h.respuestas = [{ estado: 503 }, { estado: 200 }];
    await sembrar({}, { notaCliente: 'sin cebolla' });
    await llamar();
    expect(h.llamadas).toHaveLength(2);
    for (const l of h.llamadas) expect(l.cuerpo).toBe(DE_HOY);

    h.llamadas = []; h.respuestas = [{ estado: 503 }, { estado: 200 }];
    await sembrar({ notaANovuTienda: true }, { notaCliente: 'sin cebolla' });
    await llamar();
    expect(h.llamadas).toHaveLength(2);
    expect(h.llamadas[0]!.cuerpo).toBe(h.llamadas[1]!.cuerpo);
    expect(h.llamadas[0]!.cuerpo).toContain('"nota":"sin cebolla"');
    for (const l of h.llamadas) expect(firmaOk(l)).toBe(true);
  });
  it('un pedido confirmado a mano o por otro camino no cambia: el pedido guardado conserva `notaCliente` intacta', async () => {
    await sembrar({ notaANovuTienda: true }, { notaCliente: 'sin cebolla' });
    await llamar();
    expect((await db.doc(`tenants/${T}/pedidos/wa_BM1`).get()).get('notaCliente')).toBe('sin cebolla');
  });
});
