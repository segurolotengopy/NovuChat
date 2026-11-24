/**
 * FUENTE EXTERNA DE CATÁLOGO (B3), NEGANDO PRIMERO. Sin red ni Firestore: el `fetch`, el lector del secreto y el
 * reloj son dobles inyectados en `leerCatalogoExterno`. Cada prueba afirma sobre lo que el doble RECIBIÓ (cuántas
 * llamadas, a dónde, con qué cabeceras) y sobre todo lo que salió al registro.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

/** Todo lo que el servidor manda al logger de Functions: se revisa que no filtre el secreto ni la URL. */
const registros: unknown[][] = [];
const requerir = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'functions', 'package.json'));
const { logger } = requerir('firebase-functions') as typeof import('firebase-functions');
for (const nivel of ['warn', 'info', 'error', 'log', 'debug', 'write'] as const) {
  (logger as unknown as Record<string, unknown>)[nivel] = (...a: unknown[]) => { registros.push(a); };
}

const F = await import('../../../functions/src/modulos/catalogo-web/fuenteExterna.ts');

const T = 'comercio-ext';
const BEARER = 'bearer-secreto-de-prueba-0001';
const BASE = 'https://tienda.ejemplo.test';
const mapa = (o: Record<string, unknown> = { baseUrl: BASE, bearer: BEARER }) => JSON.stringify({ [T]: o });

interface Llamada { url: string; init: RequestInit }
function entorno(opciones: { secreto?: string | (() => string); respuesta?: () => Response | Promise<Response>; ahora?: { t: number } } = {}) {
  const llamadas: Llamada[] = [];
  const reloj = opciones.ahora ?? { t: 1_000_000 };
  const d = {
    leerSecreto: typeof opciones.secreto === 'function' ? opciones.secreto : () => opciones.secreto ?? mapa(),
    http: (async (url: string | URL | Request, init?: RequestInit) => {
      llamadas.push({ url: String(url), init: init ?? {} });
      return opciones.respuesta ? opciones.respuesta() : json(catalogoBo());
    }) as typeof fetch,
    ahora: () => reloj.t,
  };
  return { d, llamadas, reloj };
}
const json = (cuerpo: unknown, estado = 200): Response => new Response(JSON.stringify(cuerpo), { status: estado });
const item = (o: Record<string, unknown> = {}) => ({
  id: 'p1', nombre: 'Polera', precioCentavos: 15000, moneda: 'BOB', stock: 5, disponible: true,
  foto: 'https://cdn.ejemplo.test/p1.jpg', fotos: [], area: 'Ropa', descripcion: 'Algodón', ...o,
});
const catalogoBo = (items: unknown[] = [item()]) => ({ version: 1, mercado: 'BO', moneda: 'BOB', items });
const catalogoAr = (items: unknown[] = [item({ moneda: 'ARS', precioCentavos: 123_400_000 })]) =>
  ({ version: 1, mercado: 'AR', moneda: 'ARS', items });

beforeEach(() => { F.vaciarCacheDelCatalogoExterno(); registros.length = 0; });

describe('el mercado sale del teléfono: 591 → BO, 54 → AR, otro → ninguno', () => {
  it('mapea los dos y rechaza el resto', () => {
    expect(F.mercadoDeTelefono('59170020001')).toBe('BO');
    expect(F.mercadoDeTelefono('5491155551234')).toBe('AR');
    for (const otro of ['', '1555123456', '5511987654321', '70020001', '5912', '541', null, 59170020001, undefined]) {
      expect(F.mercadoDeTelefono(otro), String(otro)).toBeNull();
    }
  });
});

describe('el secreto: sin destino válido NO sale ninguna llamada (falla cerrado)', () => {
  const malos: Array<[string, string | (() => string)]> = [
    ['ausente', () => { throw new Error('sin secreto'); }],
    ['vacío', ''],
    ['no es JSON', 'esto no es json'],
    ['no es un objeto', '[1,2]'],
    ['sin la entrada del comercio', JSON.stringify({ otro: { baseUrl: BASE, bearer: BEARER } })],
    ['http, no https', mapa({ baseUrl: 'http://tienda.ejemplo.test', bearer: BEARER })],
    ['con usuario y clave', mapa({ baseUrl: 'https://u:c@tienda.ejemplo.test', bearer: BEARER })],
    ['con parámetros', mapa({ baseUrl: `${BASE}?a=1`, bearer: BEARER })],
    ['con ancla', mapa({ baseUrl: `${BASE}#x`, bearer: BEARER })],
    ['a localhost', mapa({ baseUrl: 'https://localhost', bearer: BEARER })],
    ['a una IP interna', mapa({ baseUrl: 'https://169.254.169.254', bearer: BEARER })],
    ['sin bearer', mapa({ baseUrl: BASE })],
    ['bearer corto', mapa({ baseUrl: BASE, bearer: 'corto' })],
    ['con puerto distinto de 443', mapa({ baseUrl: 'https://tienda.ejemplo.test:8443', bearer: BEARER })],
    ['a un nombre sin punto', mapa({ baseUrl: 'https://intranet', bearer: BEARER })],
    ['a metadata', mapa({ baseUrl: 'https://metadata', bearer: BEARER })],
    ['a metadata.google.internal', mapa({ baseUrl: 'https://metadata.google.internal', bearer: BEARER })],
    ['a un subdominio de localhost', mapa({ baseUrl: 'https://api.localhost', bearer: BEARER })],
    ['a 0.0.0.0', mapa({ baseUrl: 'https://0.0.0.0', bearer: BEARER })],
    ['a 0.1.2.3 (0/8)', mapa({ baseUrl: 'https://0.1.2.3', bearer: BEARER })],
    ['a 100.64/10', mapa({ baseUrl: 'https://100.100.1.1', bearer: BEARER })],
    ['a 127/8', mapa({ baseUrl: 'https://127.1.2.3', bearer: BEARER })],
    ['a 127.0.0.1 escrito como número', mapa({ baseUrl: 'https://2130706433', bearer: BEARER })],
    ['a 169.254/16', mapa({ baseUrl: 'https://169.254.169.254', bearer: BEARER })],
    ['a 10/8', mapa({ baseUrl: 'https://10.1.2.3', bearer: BEARER })],
    ['a 172.16/12', mapa({ baseUrl: 'https://172.20.0.1', bearer: BEARER })],
    ['a 192.168/16', mapa({ baseUrl: 'https://192.168.0.9', bearer: BEARER })],
    ['a IPv6 ::1', mapa({ baseUrl: 'https://[::1]', bearer: BEARER })],
    ['a IPv6 ULA (fd00::/8)', mapa({ baseUrl: 'https://[fd12:3456::1]', bearer: BEARER })],
    ['a IPv6 ULA (fc00::/8)', mapa({ baseUrl: 'https://[fc00::1]', bearer: BEARER })],
    ['a IPv6 link-local', mapa({ baseUrl: 'https://[fe80::1]', bearer: BEARER })],
    ['a IPv4 mapeada en IPv6', mapa({ baseUrl: 'https://[::ffff:127.0.0.1]', bearer: BEARER })],
    ['a IPv4 mapeada en IPv6 (nube)', mapa({ baseUrl: 'https://[::ffff:169.254.169.254]', bearer: BEARER })],
    ['clave de más (mal escrita)', mapa({ baseUrl: BASE, bearer: BEARER, Bearer: 'x' })],
    ['baseUrl que no es texto', mapa({ baseUrl: 5, bearer: BEARER })],
  ];
  for (const [nombre, secreto] of malos) {
    it(`${nombre}: no hay llamada y el motivo es de configuración`, async () => {
      const { d, llamadas } = entorno({ secreto });
      const r = await F.leerCatalogoExterno(T, 'BO', d);
      expect(r.ok).toBe(false);
      expect(llamadas).toHaveLength(0);
      expect(['sin_secreto', 'sin_destino']).toContain((r as { motivo: string }).motivo);
    });
  }
});

describe('la llamada', () => {
  it('va por GET a la ruta del contrato con Bearer, sin seguir redirecciones y con 8 s de espera', async () => {
    const { d, llamadas } = entorno();
    const r = await F.leerCatalogoExterno(T, 'BO', d);
    expect(r.ok).toBe(true);
    expect(llamadas).toHaveLength(1);
    const { url, init } = llamadas[0]!;
    expect(url).toBe(`${BASE}/api/novuchat/v1/catalogo?mercado=BO`);
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${BEARER}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(F.ESPERA_MAXIMA_MS).toBe(8000);
  });

  it('una redirección (el fetch real la rechaza con redirect:error) falla cerrado: red', async () => {
    const { d } = entorno({ respuesta: () => { throw new TypeError('redirect mode is set to error'); } });
    expect(await F.leerCatalogoExterno(T, 'BO', d)).toEqual({ ok: false, motivo: 'red' });
  });

  it('tiempo agotado → motivo tiempo', async () => {
    const { d } = entorno({ respuesta: () => { throw new DOMException('timeout', 'TimeoutError'); } });
    expect(await F.leerCatalogoExterno(T, 'BO', d)).toEqual({ ok: false, motivo: 'tiempo' });
  });

  it('401, 429, 503 y otros estados dan falla, nunca un catálogo vacío', async () => {
    const casos: Array<[number, string]> = [[401, 'no_autorizado'], [429, 'limite'], [503, 'no_disponible'], [500, 'no_disponible'], [404, 'no_disponible']];
    for (const [estado, motivo] of casos) {
      F.vaciarCacheDelCatalogoExterno();
      const { d } = entorno({ respuesta: () => json({ error: 'x', items: [] }, estado) });
      expect(await F.leerCatalogoExterno(T, 'BO', d), String(estado)).toEqual({ ok: false, motivo });
    }
  });

  it('un cuerpo que no cumple el contrato falla: no es JSON, otra versión, moneda que no es la del mercado, mercado cruzado', async () => {
    const cuerpos: unknown[] = [
      'esto no es json', { version: 2, moneda: 'BOB', items: [] }, { version: 1, moneda: 'BOB' },
      { ...catalogoBo(), moneda: 'ARS' }, { ...catalogoBo(), mercado: 'AR' }, null, [],
    ];
    for (const c of cuerpos) {
      F.vaciarCacheDelCatalogoExterno();
      const { d } = entorno({ respuesta: () => new Response(typeof c === 'string' ? c : JSON.stringify(c), { status: 200 }) });
      expect(await F.leerCatalogoExterno(T, 'BO', d), JSON.stringify(c)).toEqual({ ok: false, motivo: 'contrato' });
    }
  });
});

describe('caché de 60 s por comercio y mercado', () => {
  it('dentro de la ventana no vuelve a llamar; pasada, sí; y mercados distintos no se mezclan', async () => {
    const reloj = { t: 5_000_000 };
    const { d, llamadas } = entorno({ ahora: reloj, respuesta: () => json(catalogoBo()) });
    await F.leerCatalogoExterno(T, 'BO', d);
    reloj.t += 59_000;
    await F.leerCatalogoExterno(T, 'BO', d);
    expect(llamadas).toHaveLength(1);
    reloj.t += 2_000;
    await F.leerCatalogoExterno(T, 'BO', d);
    expect(llamadas).toHaveLength(2);
    const ar = entorno({ ahora: reloj, respuesta: () => json(catalogoAr()) });
    const r = await F.leerCatalogoExterno(T, 'AR', ar.d);
    expect(r.ok && r.moneda).toBe('ARS');
    expect(ar.llamadas).toHaveLength(1);
  });

  it('una falla se recuerda 10 s (caché negativo) y pasado ese rato se vuelve a llamar', async () => {
    let n = 0;
    const reloj = { t: 7_000_000 };
    const { d, llamadas } = entorno({ ahora: reloj, respuesta: () => (++n === 1 ? json({}, 503) : json(catalogoBo())) });
    expect((await F.leerCatalogoExterno(T, 'BO', d)).ok).toBe(false);
    reloj.t += 9_000;
    expect(await F.leerCatalogoExterno(T, 'BO', d)).toEqual({ ok: false, motivo: 'no_disponible' });
    expect(llamadas).toHaveLength(1); // NO golpea otra vez una fuente caída
    reloj.t += 2_000;
    expect((await F.leerCatalogoExterno(T, 'BO', d)).ok).toBe(true);
    expect(llamadas).toHaveLength(2);
    expect(F.VIDA_DEL_CACHE_NEGATIVO_MS).toBeLessThanOrEqual(15_000);
  });

  it('las fallas de CONFIGURACIÓN no se recuerdan: arreglar el secreto surte efecto de inmediato', async () => {
    let secreto = 'basura';
    const { d, llamadas } = entorno({ secreto: () => secreto });
    expect((await F.leerCatalogoExterno(T, 'BO', d)).ok).toBe(false);
    secreto = mapa();
    expect((await F.leerCatalogoExterno(T, 'BO', d)).ok).toBe(true);
    expect(llamadas).toHaveLength(1);
  });

  it('NEGANDO: dos llamadas simultáneas de la misma clave comparten UNA sola llamada a la fuente', async () => {
    let soltar: () => void = () => undefined;
    const puerta = new Promise<void>((ok) => { soltar = ok; });
    const { d, llamadas } = entorno({ respuesta: async () => { await puerta; return json(catalogoBo()); } });
    const a = F.leerCatalogoExterno(T, 'BO', d);
    const b = F.leerCatalogoExterno(T, 'BO', d);
    const c = F.leerCatalogoExterno(T, 'AR', d); // otra clave: llamada propia
    await new Promise((ok) => setTimeout(ok, 5));
    soltar();
    const [ra, rb] = await Promise.all([a, b, c]);
    expect(llamadas.filter((l) => l.url.includes('mercado=BO'))).toHaveLength(1);
    expect(ra).toBe(rb);
  });

  it('ETag: pasados los 60 s se pregunta con If-None-Match y un 304 renueva el caché SIN releer el cuerpo', async () => {
    const reloj = { t: 9_000_000 };
    let n = 0;
    const { d, llamadas } = entorno({
      ahora: reloj,
      respuesta: () => (++n === 1
        ? new Response(JSON.stringify(catalogoBo()), { status: 200, headers: { etag: '"abc123"' } })
        : new Response(null, { status: 304 })),
    });
    const primera = await F.leerCatalogoExterno(T, 'BO', d);
    expect((llamadas[0]!.init.headers as Record<string, string>)['If-None-Match']).toBeUndefined();
    reloj.t += 61_000;
    const segunda = await F.leerCatalogoExterno(T, 'BO', d);
    expect(llamadas).toHaveLength(2);
    expect((llamadas[1]!.init.headers as Record<string, string>)['If-None-Match']).toBe('"abc123"');
    expect(segunda).toBe(primera);
    reloj.t += 30_000; // renovado: dentro de la nueva ventana no llama
    await F.leerCatalogoExterno(T, 'BO', d);
    expect(llamadas).toHaveLength(2);
  });

  it('NEGANDO: un ETag con formato raro no se reenvía, y un 304 sin caché propio es falla de contrato', async () => {
    const reloj = { t: 11_000_000 };
    const { d, llamadas } = entorno({
      ahora: reloj, respuesta: () => new Response(JSON.stringify(catalogoBo()), { status: 200, headers: { etag: 'sin-comillas<script>' } }),
    });
    await F.leerCatalogoExterno(T, 'BO', d);
    reloj.t += 61_000;
    await F.leerCatalogoExterno(T, 'BO', d);
    expect((llamadas[1]!.init.headers as Record<string, string>)['If-None-Match']).toBeUndefined();
    F.vaciarCacheDelCatalogoExterno();
    const solo = entorno({ respuesta: () => new Response(null, { status: 304 }) });
    expect(await F.leerCatalogoExterno(T, 'BO', solo.d)).toEqual({ ok: false, motivo: 'contrato' });
  });
});

describe('cada ítem se valida; el que no cumple se descarta, no tumba el catálogo', () => {
  const leer = async (items: unknown[], mercado: 'BO' | 'AR' = 'BO') => {
    F.vaciarCacheDelCatalogoExterno();
    const { d } = entorno({ respuesta: () => json(mercado === 'BO' ? catalogoBo(items) : catalogoAr(items)) });
    const r = await F.leerCatalogoExterno(T, mercado, d);
    if (!r.ok) throw new Error(`falló: ${r.motivo}`);
    return r.items;
  };

  it('ids con mala forma, repetidos, sin nombre, sin precio válido o con otra moneda se descartan', async () => {
    const items = await leer([
      item({ id: 'bueno' }), item({ id: '-polera' }), item({ id: '_polera' }), item({ id: '../x' }), item({ id: 'con espacio' }), item({ id: '' }), item({ id: 'a'.repeat(81) }),
      item({ id: 'bueno' }), item({ id: 'sin-nombre', nombre: '  ' }), item({ id: 'p0', precioCentavos: 0 }),
      item({ id: 'pneg', precioCentavos: -5 }), item({ id: 'pdec', precioCentavos: 10.5 }), item({ id: 'ptxt', precioCentavos: '100' }),
      item({ id: 'pgrande', precioCentavos: 1e12 }), item({ id: 'usd', moneda: 'USD' }), item({ id: 'ars-en-bo', moneda: 'ARS' }),
      item({ id: 'stockneg', stock: -1 }), item({ id: 'stockdec', stock: 1.5 }), item({ id: 'stocktxt', stock: '3' }), 7, null,
    ]);
    expect(items.map((i) => i.id)).toEqual(['bueno']);
  });

  it('`disponible:false` manda aunque el stock sea 3; solo `true` estricto vende', async () => {
    const items = await leer([
      item({ id: 'no', disponible: false, stock: 3 }), item({ id: 'txt', disponible: 'true' }),
      item({ id: 'falta', disponible: undefined }), item({ id: 'si', disponible: true, stock: 3 }),
    ]);
    const por = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(por['no']!.disponible).toBe(false);
    expect(por['txt']!.disponible).toBe(false);
    expect(por['falta']!.disponible).toBe(false);
    expect(F.hayParaVenderExterno(por['no']!)).toBe(false);
    expect(F.hayParaVenderExterno(por['si']!, 3)).toBe(true);
    expect(F.hayParaVenderExterno(por['si']!, 4)).toBe(false); // stock 3, pedido de 4
  });

  it('stock null = sin control de stock: se vende cualquier cantidad', async () => {
    const [it] = await leer([item({ stock: null })]);
    expect(it!.stock).toBeNull();
    expect(F.hayParaVenderExterno(it!, 99)).toBe(true);
  });

  it('la foto tiene que ser https público; si `foto` no sirve se usa la primera válida de `fotos`; si ninguna, vacía', async () => {
    const items = await leer([
      item({ id: 'a', foto: 'http://x.test/a.jpg', fotos: [] }),
      item({ id: 'b', foto: 'javascript:alert(1)', fotos: ['data:text/html,x', 'https://cdn.ejemplo.test/b2.jpg'] }),
      item({ id: 'c', foto: 'https://127.0.0.1/c.jpg', fotos: [] }),
      item({ id: 'd', foto: 'https://cdn.ejemplo.test/d.jpg' }),
    ]);
    const por = Object.fromEntries(items.map((i) => [i.id, i.imagenUrl]));
    expect(por).toEqual({ a: '', b: 'https://cdn.ejemplo.test/b2.jpg', c: '', d: 'https://cdn.ejemplo.test/d.jpg' });
  });

  it('descripción ≤ 300 y área ≤ 40 recortadas; sin enlaces ni `<>`', async () => {
    const [it] = await leer([item({
      descripcion: 'x'.repeat(500), area: 'y'.repeat(100), nombre: 'Hola <b>mundo</b> https://malo.test/x',
    })]);
    expect(it!.descripcion).toHaveLength(300);
    expect(it!.area).toHaveLength(40);
    expect(it!.nombre).not.toMatch(/[<>]|https?:/);
  });

  it('máximo 200 ítems aunque la fuente mande más', async () => {
    const muchos = Array.from({ length: 260 }, (_, n) => item({ id: `p${n}` }));
    expect(await leer(muchos)).toHaveLength(200);
  });

  it('ARS en el mercado AR conserva el precio exacto en centavos', async () => {
    const [it] = await leer([item({ moneda: 'ARS', precioCentavos: 123_400_000 })], 'AR');
    expect(it).toMatchObject({ moneda: 'ARS', precioCentavos: 123_400_000 });
  });
});

describe('el secreto no sale por ningún lado', () => {
  it('ni el Bearer ni la URL aparecen en lo registrado ni en lo devuelto, en éxito ni en cada tipo de falla', async () => {
    const salidas: unknown[] = [];
    const variantes: Array<() => Response | Promise<Response>> = [
      () => json(catalogoBo()), () => json({}, 401), () => json({}, 429), () => json({}, 503),
      () => new Response('basura', { status: 200 }),
      () => { throw new TypeError(`fallo con ${BEARER} y ${BASE}`); },
      () => { throw new DOMException(`timeout ${BEARER}`, 'TimeoutError'); },
    ];
    for (const respuesta of variantes) {
      F.vaciarCacheDelCatalogoExterno();
      const { d } = entorno({ respuesta });
      salidas.push(await F.leerCatalogoExterno(T, 'BO', d));
    }
    // También los fallos de configuración.
    salidas.push(await F.leerCatalogoExterno(T, 'BO', entorno({ secreto: mapa({ baseUrl: 'http://x.test', bearer: BEARER }) }).d));
    const todo = JSON.stringify([salidas, registros]);
    expect(registros.length).toBeGreaterThan(0);
    expect(todo).not.toContain(BEARER);
    expect(todo).not.toContain('tienda.ejemplo.test');
    expect(todo).not.toContain(T);
  });

  it('los registros llevan solo `codigo` (y `estado` HTTP)', async () => {
    const { d } = entorno({ respuesta: () => json({}, 503) });
    await F.leerCatalogoExterno(T, 'BO', d);
    expect(registros).toHaveLength(1);
    expect(registros[0]![1]).toEqual({ codigo: 'no_disponible', estado: 503 });
  });
});

describe('cuerpo acotado: Content-Length y lectura en flujo', () => {
  it('NEGANDO: un `Content-Length` mayor que 2 MB se rechaza sin leer el cuerpo', async () => {
    const { d } = entorno({ respuesta: () => new Response(JSON.stringify(catalogoBo()), { status: 200, headers: { 'content-length': '3000000' } }) });
    expect(await F.leerCatalogoExterno(T, 'BO', d)).toEqual({ ok: false, motivo: 'contrato' });
  });
  it('NEGANDO: un cuerpo que pasa de 2 MB sin declararlo se corta en el flujo (y no se lee entero)', async () => {
    let enviados = 0;
    const flujo = new ReadableStream<Uint8Array>({
      pull(c) { enviados += 1; c.enqueue(new Uint8Array(500_000).fill(32)); if (enviados > 200) c.close(); },
    });
    const { d } = entorno({ respuesta: () => new Response(flujo, { status: 200 }) });
    expect(await F.leerCatalogoExterno(T, 'BO', d)).toEqual({ ok: false, motivo: 'contrato' });
    expect(enviados).toBeLessThan(20); // se cortó cerca del tope, no se leyeron los 100 MB
  });
});

describe('ítems crudos y ninguno válido: es un error, nunca un catálogo vacío', () => {
  it('precioCentavos como texto y moneda en minúsculas en TODOS → falla de contrato, registrando solo la cuenta', async () => {
    const malos = [item({ id: 'a', precioCentavos: '100' }), item({ id: 'b', moneda: 'bob' }), item({ id: 'c', precioCentavos: '5' })];
    const { d } = entorno({ respuesta: () => json(catalogoBo(malos)) });
    expect(await F.leerCatalogoExterno(T, 'BO', d)).toEqual({ ok: false, motivo: 'contrato' });
    expect(registros.some((r) => JSON.stringify(r[1]) === JSON.stringify({ codigo: 'contrato', estado: 200, descartados: 3 }))).toBe(true);
  });
  it('una fuente que de verdad no tiene ítems (lista vacía) sigue siendo un catálogo vacío legítimo', async () => {
    const { d } = entorno({ respuesta: () => json(catalogoBo([])) });
    expect(await F.leerCatalogoExterno(T, 'BO', d)).toEqual({ ok: true, moneda: 'BOB', items: [] });
  });
  it('con ítems buenos y malos publica los buenos y registra solo la cantidad de descartados', async () => {
    const { d } = entorno({ respuesta: () => json(catalogoBo([item({ id: 'ok' }), item({ id: 'x', precioCentavos: '1' }), item({ id: 'y', moneda: 'usd' })])) });
    const r = await F.leerCatalogoExterno(T, 'BO', d);
    expect(r.ok && r.items.map((i) => i.id)).toEqual(['ok']);
    expect(registros.map((x) => x[1])).toContainEqual({ codigo: 'items_descartados', descartados: 2 });
  });
});

describe('areaClave y ordenArea (aditivos)', () => {
  const leer = async (items: unknown[]) => {
    const { d } = entorno({ respuesta: () => json(catalogoBo(items)) });
    const r = await F.leerCatalogoExterno(T, 'BO', d);
    if (!r.ok) throw new Error(r.motivo);
    return r.items;
  };
  it('se leen si vienen y quedan en blanco o null si no', async () => {
    const [con, sin] = await leer([item({ id: 'a', areaClave: 'ropa-hombre', ordenArea: 3 }), item({ id: 'b' })]);
    expect(con).toMatchObject({ areaClave: 'ropa-hombre', ordenArea: 3 });
    expect(sin).toMatchObject({ areaClave: '', ordenArea: null });
  });
  it('NEGANDO: ordenArea fuera de 0 a 39, no entero o de otro tipo es null; areaClave se recorta a 40', async () => {
    const its = await leer([
      item({ id: 'a', ordenArea: 40 }), item({ id: 'b', ordenArea: -1 }), item({ id: 'c', ordenArea: 1.5 }),
      item({ id: 'd', ordenArea: '2' }), item({ id: 'e', ordenArea: 0 }), item({ id: 'f', ordenArea: 39 }),
      item({ id: 'g', areaClave: 'k'.repeat(90) }),
    ]);
    expect(its.map((i) => i.ordenArea)).toEqual([null, null, null, null, 0, 39, null]);
    expect(its[6]!.areaClave).toHaveLength(40);
  });
});
