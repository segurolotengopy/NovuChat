/**
 * EL DOBLE CUMPLE EL CONTRATO, y el cliente HTTP lo habla bien.
 *
 * Se prueba a través de `crearClienteHttp` (functions/src/cobrador.ts) con el
 * `fetch` del doble: así se verifican a la vez las rutas, cabeceras y cuerpos
 * que manda NovuChat y las respuestas que el contrato promete
 * (DISENO.md §4undecies.5, `docs/10-contrato-consumidores.md` del cobrador).
 * No necesita emulador.
 */
import { describe, expect, it } from 'vitest';
import { CobradorDoble, firmarAviso, idDeCobro, pngMinimo } from './dobles/cobrador.ts';
import {
  ErrorCobrador, CobradorNoResponde, configCobradorDe, crearClienteHttp, montoATexto, montoDesdeTexto, verificarAviso,
} from '../functions/src/cobrador.ts';
import { VENTANA_MS } from '../functions/src/firma.ts';

const BASE = 'https://cobrador.prueba';
const nuevo = () => {
  const doble = new CobradorDoble({ tokens: { 'token-de-prueba-de-novuchat-sin-valor-real': 'novuchat', 'token-de-prueba-del-otro-consumidor-x': 'otro' } });
  const cliente = crearClienteHttp({ baseUrl: BASE, token: doble.tokenDe('novuchat'), fetchImpl: doble.fetch });
  const ajeno = crearClienteHttp({ baseUrl: BASE, token: doble.tokenDe('otro'), fetchImpl: doble.fetch });
  return { doble, cliente, ajeno };
};
const codigo = async (p: Promise<unknown>) => {
  try { await p; return null; } catch (e) { return e instanceof ErrorCobrador ? { status: e.status, codigo: e.codigo } : e; }
};

describe('montos como texto decimal', () => {
  it('el entero en bolivianos viaja como "150.00" y nunca como número', () => {
    expect(montoATexto(150)).toBe('150.00');
    expect(montoATexto(0)).toBe('0.00');
    expect(() => montoATexto(12.5)).toThrow();
    expect(() => montoATexto(-1)).toThrow();
    expect(montoDesdeTexto('630.00')).toBe(630);
    expect(montoDesdeTexto('630.5')).toBe(630.5);
    expect(montoDesdeTexto(630)).toBeNull();
    expect(montoDesdeTexto('630,00')).toBeNull();
  });
});

describe('la base URL del cobrador (el destino del token)', () => {
  it('acepta https y el loopback anclado; rechaza un host que empieza con localhost y http remoto', () => {
    const de = (baseUrl: string) => configCobradorDe({ cobrador: { baseUrl } })?.baseUrl ?? null;
    expect(de('https://cobros.ejemplo.bo/')).toBe('https://cobros.ejemplo.bo');
    expect(de('http://localhost:8787')).toBe('http://localhost:8787');
    expect(de('http://127.0.0.1:8787/api')).toBe('http://127.0.0.1:8787/api');
    expect(de('http://localhost.atacante.bo')).toBeNull();
    expect(de('http://localhost.atacante.bo:80/')).toBeNull();
    expect(de('http://127.0.0.1.atacante.bo')).toBeNull();
    expect(de('http://cobros.ejemplo.bo')).toBeNull();
    expect(de('')).toBeNull();
    expect(configCobradorDe({})).toBeNull();
    expect(configCobradorDe({ cobrador: { baseUrl: 'https://x.bo', vigenciaHoras: 999999 } })?.vigenciaHoras).toBe(72);
  });
});

describe('crearCobro', () => {
  it('201 con el cobro y su QR; el cuerpo lleva la referencia, el concepto y el monto como texto', async () => {
    const { doble, cliente } = nuevo();
    const r = await cliente.crearCobro({ referenciaExterna: 'abcDEF012345_-abcd', concepto: 'NovuChat · Pro · 1 mes', montoBs: 1134, horasDeVigencia: 72 });
    expect(r.creado).toBe(true);
    expect(r.cobro.id).toMatch(/^cons-[0-9a-f]{64}$/);
    expect(r.cobro.id).toBe(idDeCobro('novuchat', 'abcDEF012345_-abcd'));
    expect(r.cobro).toMatchObject({ estado: 'QR_ACTIVO', monto: '1134.00', moneda: 'BOB', referenciaExterna: 'abcDEF012345_-abcd', pago: null });
    expect(r.cobro.qr).toMatchObject({ version: 1, imagenDisponible: true });
    expect(Buffer.from(r.imagenQrBase64 ?? '', 'base64').subarray(0, 8)).toEqual(pngMinimo().subarray(0, 8));
    expect(doble.llamadas.at(-1)).toMatchObject({ metodo: 'POST', ruta: '/api/v1/cobros', status: 201 });
  });

  it('la misma referencia devuelve el MISMO cobro con 200: un reintento no produce dos QR', async () => {
    const { doble, cliente } = nuevo();
    const a = await cliente.crearCobro({ referenciaExterna: 'ref-1', concepto: 'x', montoBs: 100 });
    const b = await cliente.crearCobro({ referenciaExterna: 'ref-1', concepto: 'otro concepto', montoBs: 100 });
    expect(b.creado).toBe(false);
    expect(b.cobro.id).toBe(a.cobro.id);
    expect(b.cobro.concepto).toBe('x');          // el concepto del primero es el que vale
    expect(b.imagenQrBase64).toBe(a.imagenQrBase64);
    expect(doble.cobros.size).toBe(1);
  });

  it('la misma referencia con otro importe → 409 IMPORTE_DISTINTO_CON_MISMA_REFERENCIA', async () => {
    const { cliente } = nuevo();
    await cliente.crearCobro({ referenciaExterna: 'ref-2', concepto: 'x', montoBs: 100 });
    expect(await codigo(cliente.crearCobro({ referenciaExterna: 'ref-2', concepto: 'x', montoBs: 101 })))
      .toEqual({ status: 409, codigo: 'IMPORTE_DISTINTO_CON_MISMA_REFERENCIA' });
  });

  it('una referencia terminal no se recicla: vuelve tal cual, con 200', async () => {
    const { doble, cliente } = nuevo();
    const a = await cliente.crearCobro({ referenciaExterna: 'ref-3', concepto: 'x', montoBs: 100 });
    doble.fijarEstado(a.cobro.id, 'VENCIDO');
    const b = await cliente.crearCobro({ referenciaExterna: 'ref-3', concepto: 'x', montoBs: 100 });
    expect(b.creado).toBe(false);
    expect(b.cobro.estado).toBe('VENCIDO');
  });

  it('BORRADOR cuando el banco falló: qr null; reintentar con la misma referencia lo retoma', async () => {
    const { doble, cliente } = nuevo();
    doble.bancoCaido = true;
    const a = await cliente.crearCobro({ referenciaExterna: 'ref-4', concepto: 'x', montoBs: 100 });
    expect(a.cobro.estado).toBe('BORRADOR');
    expect(a.cobro.qr).toBeNull();
    expect(a.imagenQrBase64).toBeNull();
    doble.bancoCaido = false;
    const b = await cliente.crearCobro({ referenciaExterna: 'ref-4', concepto: 'x', montoBs: 100 });
    expect(b.creado).toBe(false);
    expect(b.cobro.id).toBe(a.cobro.id);
    expect(b.cobro.estado).toBe('QR_ACTIVO');
    expect(b.imagenQrBase64).not.toBeNull();
  });

  it('cupo de 60 por hora → 429 CUPO_POR_HORA_AGOTADO', async () => {
    const { cliente } = nuevo();
    for (let i = 0; i < 60; i++) await cliente.crearCobro({ referenciaExterna: `cupo-${i}`, concepto: 'x', montoBs: 1 });
    expect(await codigo(cliente.crearCobro({ referenciaExterna: 'cupo-61', concepto: 'x', montoBs: 1 })))
      .toEqual({ status: 429, codigo: 'CUPO_POR_HORA_AGOTADO' });
  });

  it('502 QR_SUELTO_EN_EL_PROVEEDOR y 503 SERVICIO_NO_DISPONIBLE llegan con su código', async () => {
    const { doble, cliente } = nuevo();
    doble.qrSuelto = true;
    expect(await codigo(cliente.crearCobro({ referenciaExterna: 'ref-5', concepto: 'x', montoBs: 1 })))
      .toEqual({ status: 502, codigo: 'QR_SUELTO_EN_EL_PROVEEDOR' });
    doble.qrSuelto = false; doble.noDisponible = true;
    expect(await codigo(cliente.crearCobro({ referenciaExterna: 'ref-6', concepto: 'x', montoBs: 1 })))
      .toEqual({ status: 503, codigo: 'SERVICIO_NO_DISPONIBLE' });
  });

  it('el cliente rechaza una referencia fuera del juego de caracteres antes de mandarla', async () => {
    const { doble, cliente } = nuevo();
    await expect(cliente.crearCobro({ referenciaExterna: 'tenant/2026-09/x', concepto: 'x', montoBs: 1 })).rejects.toThrow();
    expect(doble.llamadas).toHaveLength(0);
  });
});

describe('estadoCobro', () => {
  it('por id y por referencia devuelven lo mismo; pago solo con CONFIRMADO, con los nombres públicos del riel', async () => {
    const { doble, cliente } = nuevo();
    const a = await cliente.crearCobro({ referenciaExterna: 'est-1', concepto: 'x', montoBs: 630 });
    expect((await cliente.estadoCobro(a.cobro.id)).pago).toBeNull();
    doble.fijarEstado('est-1', 'PAGO_DETECTADO');
    expect((await cliente.estadoPorReferencia('est-1'))).toMatchObject({ estado: 'PAGO_DETECTADO', pago: null });
    doble.fijarEstado('est-1', 'CONFIRMADO', { riel: 'watcher-baneco', confirmadoPor: 'accion-manual' });
    const porId = await cliente.estadoCobro(a.cobro.id);
    const porRef = await cliente.estadoPorReferencia('est-1');
    expect(porId).toEqual(porRef);
    expect(porId.pago).toMatchObject({ monto: '630.00', riel: 'api-baneco', confirmadoPor: 'revision-manual' });
    expect(typeof porId.pago?.confirmadoEn).toBe('string');
  });

  it('lo ajeno y lo inexistente responden 404, nunca 403', async () => {
    const { cliente, ajeno } = nuevo();
    const a = await cliente.crearCobro({ referenciaExterna: 'ajeno-1', concepto: 'x', montoBs: 1 });
    expect(await codigo(ajeno.estadoCobro(a.cobro.id))).toEqual({ status: 404, codigo: 'NO_ENCONTRADO' });
    expect(await codigo(ajeno.estadoPorReferencia('ajeno-1'))).toEqual({ status: 404, codigo: 'NO_ENCONTRADO' });
    expect(await codigo(ajeno.anularCobro(a.cobro.id))).toEqual({ status: 404, codigo: 'NO_ENCONTRADO' });
    expect(await codigo(ajeno.imagenQr(a.cobro.id))).toEqual({ status: 404, codigo: 'NO_ENCONTRADO' });
    expect(await codigo(cliente.estadoCobro(`cons-${'0'.repeat(64)}`))).toEqual({ status: 404, codigo: 'NO_ENCONTRADO' });
    // Y un id con forma inválida no llega a la red.
    expect(await codigo(cliente.estadoCobro('../otra-cosa'))).toEqual({ status: 404, codigo: 'NO_ENCONTRADO' });
  });

  it('sin token válido, 401; un token de consumidor no abre la consola del dueño (404)', async () => {
    const { doble } = nuevo();
    const sinToken = crearClienteHttp({ baseUrl: BASE, token: 'token-equivocado', fetchImpl: doble.fetch });
    expect(await codigo(sinToken.listarCobros())).toEqual({ status: 401, codigo: 'NO_AUTORIZADO' });
    const r = doble.manejar({ metodo: 'GET', ruta: '/api/cobros', consulta: {}, cuerpo: null, token: doble.tokenDe('novuchat') });
    expect(r.status).toBe(404);
  });
});

describe('anularCobro', () => {
  it('200 ANULADO, y repetirlo devuelve lo mismo', async () => {
    const { doble, cliente } = nuevo();
    const a = await cliente.crearCobro({ referenciaExterna: 'an-1', concepto: 'x', montoBs: 1 });
    expect((await cliente.anularCobro(a.cobro.id, 'el comercio cargó un pago manual')).resultado).toBe('ANULADO');
    expect((await cliente.anularCobro(a.cobro.id)).resultado).toBe('ANULADO');
    expect(doble.cobroPorReferencia('an-1')?.motivoAnulacion).toContain('consumidor:novuchat');
  });

  it('anular un pagado → 409 PAGADO_NO_SE_ANULA; un pago tardío → 409 PAGO_TARDIO_EN_REVISION', async () => {
    const { doble, cliente } = nuevo();
    const a = await cliente.crearCobro({ referenciaExterna: 'an-2', concepto: 'x', montoBs: 1 });
    doble.fijarEstado('an-2', 'CONFIRMADO');
    expect(await codigo(cliente.anularCobro(a.cobro.id))).toEqual({ status: 409, codigo: 'PAGADO_NO_SE_ANULA' });
    const b = await cliente.crearCobro({ referenciaExterna: 'an-3', concepto: 'x', montoBs: 1 });
    doble.fijarAnulacion('an-3', 'PAGO_TARDIO_EN_REVISION');
    expect(await codigo(cliente.anularCobro(b.cobro.id))).toEqual({ status: 409, codigo: 'PAGO_TARDIO_EN_REVISION' });
    expect(doble.cobroPorReferencia('an-3')?.estado).toBe('EN_REVISION');
  });
});

describe('listarCobros e imagen', () => {
  it('lista los propios del rango, hasta exclusivo, con truncado', async () => {
    const { cliente, ajeno } = nuevo();
    for (let i = 0; i < 3; i++) await cliente.crearCobro({ referenciaExterna: `l-${i}`, concepto: 'x', montoBs: 1 });
    await ajeno.crearCobro({ referenciaExterna: 'l-ajeno', concepto: 'x', montoBs: 1 });
    const todos = await cliente.listarCobros();
    expect(todos.cobros).toHaveLength(3);
    expect(todos.truncado).toBe(false);
    const dos = await cliente.listarCobros({ limite: 2 });
    expect(dos.cobros).toHaveLength(2);
    expect(dos.truncado).toBe(true);
    expect(await codigo(cliente.listarCobros({ desde: '2026-01-01T00:00:00Z', hasta: '2026-06-01T00:00:00Z' })))
      .toEqual({ status: 400, codigo: 'RANGO_DEMASIADO_LARGO' });
    expect(await codigo(cliente.listarCobros({ desde: '2026-01-01' }))).toEqual({ status: 400, codigo: 'CONSULTA_INVALIDA' });
  });

  it('GET …/qr devuelve la imagen y su vencimiento; sin imagen, 404 SIN_IMAGEN', async () => {
    const { doble, cliente } = nuevo();
    const a = await cliente.crearCobro({ referenciaExterna: 'img-1', concepto: 'x', montoBs: 1 });
    const img = await cliente.imagenQr(a.cobro.id);
    expect(img.imagenQrBase64).toBe(a.imagenQrBase64);
    expect(img.venceEn).toBe(a.cobro.qr?.venceEn);
    doble.bancoCaido = true;
    const b = await cliente.crearCobro({ referenciaExterna: 'img-2', concepto: 'x', montoBs: 1 });
    expect(await codigo(cliente.imagenQr(b.cobro.id))).toEqual({ status: 404, codigo: 'SIN_IMAGEN' });
  });
});

describe('el cliente ante una red rota', () => {
  it('timeout y respuesta sin forma se tratan como «no respondió», no como un estado', async () => {
    const colgado = crearClienteHttp({ baseUrl: BASE, token: 'x'.repeat(32), timeoutMs: 20,
      fetchImpl: (_u, init) => new Promise((_r, rechazar) => { init.signal?.addEventListener('abort', () => rechazar(new Error('AbortError'))); }) });
    await expect(colgado.estadoPorReferencia('r')).rejects.toBeInstanceOf(CobradorNoResponde);
    const roto = crearClienteHttp({ baseUrl: BASE, token: 'x'.repeat(32),
      fetchImpl: async () => ({ status: 200, text: async () => '<html>' }) });
    await expect(roto.estadoPorReferencia('r')).rejects.toBeInstanceOf(CobradorNoResponde);
    const sinCobro = crearClienteHttp({ baseUrl: BASE, token: 'x'.repeat(32),
      fetchImpl: async () => ({ status: 200, text: async () => '{"cobro":{"id":"x"}}' }) });
    await expect(sinCobro.estadoPorReferencia('r')).rejects.toBeInstanceOf(CobradorNoResponde);
  });
});

describe('el aviso de confirmación: firma y verificación', () => {
  const SECRETO = 'secreto-de-prueba-del-aviso';
  const peticion = (cuerpo: string, cabeceras: Record<string, string>) => ({
    rawBody: Buffer.from(cuerpo),
    get: (n: string) => Object.entries(cabeceras).find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1],
  });

  it('el doble firma con HMAC-SHA256(secreto, "<marca>." + cuerpo) y verificarAviso lo acepta', () => {
    const { doble, cliente } = nuevo();
    return cliente.crearCobro({ referenciaExterna: 'av-1', concepto: 'x', montoBs: 630 }).then(() => {
      doble.fijarEstado('av-1', 'CONFIRMADO');
      const cuerpo = JSON.stringify(doble.avisoDe('av-1'));
      const marca = Date.now();
      const r = verificarAviso(peticion(cuerpo, firmarAviso(SECRETO, cuerpo, marca)), SECRETO, marca);
      expect(r.estado).toBe('ok');
      if (r.estado !== 'ok') return;
      expect(r.aviso).toMatchObject({ evento: 'cobro.confirmado', referenciaExterna: 'av-1', montoCentavos: 63000, riel: 'watcher-baneco' });
      expect(r.aviso.cobroId).toBe(idDeCobro('novuchat', 'av-1'));
      expect(r.aviso.idEvento).toBe(r.aviso.cobroId);
    });
  });

  it('otro secreto, cuerpo alterado, marca fuera de ±5 min o firma ausente → no_firmado', () => {
    const cuerpo = JSON.stringify({ evento: 'cobro.confirmado', cobroId: `cons-${'a'.repeat(64)}`, referenciaExterna: 'r' });
    const marca = Date.now();
    expect(verificarAviso(peticion(cuerpo, firmarAviso('otro-secreto', cuerpo, marca)), SECRETO, marca).estado).toBe('no_firmado');
    expect(verificarAviso(peticion(cuerpo + ' ', firmarAviso(SECRETO, cuerpo, marca)), SECRETO, marca).estado).toBe('no_firmado');
    expect(verificarAviso(peticion(cuerpo, firmarAviso(SECRETO, cuerpo, marca)), SECRETO, marca + VENTANA_MS + 1).estado).toBe('no_firmado');
    expect(verificarAviso(peticion(cuerpo, firmarAviso(SECRETO, cuerpo, marca)), SECRETO, marca - VENTANA_MS - 1).estado).toBe('no_firmado');
    expect(verificarAviso(peticion(cuerpo, { 'X-Marca-Tiempo': String(marca) }), SECRETO, marca).estado).toBe('no_firmado');
    expect(verificarAviso(peticion(cuerpo, firmarAviso(SECRETO, cuerpo, marca)), '', marca).estado).toBe('no_firmado');
    // Y una firma de otra marca, aunque la marca declarada esté en ventana.
    const f = firmarAviso(SECRETO, cuerpo, marca - 1000);
    expect(verificarAviso(peticion(cuerpo, { ...f, 'X-Marca-Tiempo': String(marca) }), SECRETO, marca).estado).toBe('no_firmado');
  });

  it('bien firmado pero sin la forma del aviso → mal_formado (no se confunde con un 401)', () => {
    const marca = Date.now();
    for (const cuerpo of ['no es json', '{"evento":"otro"}', '{"evento":"cobro.confirmado","cobroId":"x","referenciaExterna":"r"}']) {
      expect(verificarAviso(peticion(cuerpo, firmarAviso(SECRETO, cuerpo, marca)), SECRETO, marca).estado).toBe('mal_formado');
    }
  });
});
