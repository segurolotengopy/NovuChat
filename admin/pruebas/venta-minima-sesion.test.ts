/**
 * «VENTA MÍNIMA v0»: EL ESTADO DE LA CONVERSACIÓN EN EL SERVIDOR (PR-4a), las piezas sueltas y las guardias del armador.
 * Contrato: `docs/arquitectura/estado-de-conversacion.md`. Las pruebas de punta a punta (compromiso antes de enviar, conflicto, compensación,
 * aislamiento de la prueba, 0 mensajes por conversación) están al final de `venta-minima-flujo.test.ts`, con el n8n de mentira.
 *
 * QUÉ CUBRE ESTE ARCHIVO, cada punto con su negativo:
 *   - `vmSes`: lo que lee `Decidir turno`, `Plan del turno` e `Interpretar entrada` (el bloque del servidor: estado de ESTE teléfono y SUS pedidos, sin los de más de 72 h);
 *   - la LECTURA DE RESPALDO de la publicación (memoria vieja de n8n → servidor), hasta el 30/11/2026: se usa solo si el servidor no tiene nada del teléfono, solo lo vigente y
 *     solo lo suyo, se migra al comprometer, y pasada la fecha de retiro ni se mira;
 *   - `vmGuardarPedido` (72 h, tope), `vmVenceEnMin` (60 / 1440 / 4320) y el tope en BYTES (15.000) con el peor caso;
 *   - las guardias de `construir.mjs --verificar` sobre el estado (el módulo común se incluye tal cual; nada se envía antes del compromiso; los nodos «Comprometer *» reintentan);
 *   - ninguna construcción prohibida (`new Function`, `eval`, globales de Node) en los nodos nuevos, y ningún secreto.
 * Reloj: lunes 05/10/2026 10:00 en La Paz. Teléfonos sintéticos con seis ceros.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar, type J } from './lib/flujo';
import { editarJson, leer, nodoDe, verificarEnCopia } from './lib/venta-minima-mundo';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/venta-minima/src');
const COMUN = readFileSync(join(RAIZ, 'lib/comun.js'), 'utf8');
const SESION = readFileSync(join(RAIZ, '../../comun-sin-agente/src/sesion.js'), 'utf8');
const nodoFuente = (n: string): string => readFileSync(join(RAIZ, `nodos/${n}.js`), 'utf8');

const AHORA = Date.UTC(2026, 9, 5, 14);
const MIN = 60_000;
const HORA = 60 * MIN;
const CLIENTE = '59100000011';
const OTRO = '59100000012';
const RETIRO = Date.UTC(2026, 10, 30, 4, 0, 0); // 30/11/2026 00:00 en La Paz

/** `cfg.sesion` como lo deja «Config del negocio» cuando el servidor contestó el `leer`. */
const sesion = (bloque: J | null, extra: J = {}): J => ({ ok: true, version: bloque ? 3 : 0, estado: bloque, vencido: false, corrupta: false, visto: 'nuevo', ...extra });

// La librería y el módulo `sesion` se evalúan UNA vez (como en `venta-minima-comun.test.ts`); lo que cambia entre pruebas —la config, los datos estáticos y el reloj— entra por el contexto,
// nunca se arma código con datos de la prueba.
type Fn = (...a: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Lib {
  vmSes: Fn; vmGuardarPedido: Fn; vmVenceEnMin: Fn; vmVistoDeRespaldo: Fn; vmRetirarRespaldo: Fn; ssBytes: Fn; ssCuerpoComprometer: Fn; SS_CONFIG: J;
}
const contexto = { raiz: {} as J, ms: AHORA };
const referencias: Record<string, J> = {};
class RelojDelContexto extends Date {
  constructor(...a: unknown[]) { if (a.length === 0) super(contexto.ms); else super(...(a as [number])); }
  static override now(): number { return contexto.ms; }
}
const L = ejecutar(
  `${COMUN}\n${SESION}\nreturn [{ json: { vmSes, vmGuardarPedido, vmVenceEnMin, vmVistoDeRespaldo, vmRetirarRespaldo, ssBytes, ssCuerpoComprometer, SS_CONFIG } }];`,
  [{}], referencias, { $getWorkflowStaticData: () => contexto.raiz, Date: RelojDelContexto },
)[0] as unknown as Lib;
/** Fija la config, los datos estáticos y el reloj de la prueba y devuelve la librería. */
const lib = (o: { cfg?: J; raiz?: J; ahora?: number } = {}): Lib => {
  referencias['Config del negocio'] = o.cfg ?? {};
  contexto.raiz = o.raiz ?? {};
  contexto.ms = o.ahora ?? AHORA;
  return L;
};

const pedido = (id: string, edadMs: number, extra: J = {}): J => ({ pedidoId: id, from: CLIENTE, total: 55, lineas: [], guardadoMs: AHORA - edadMs, ...extra });

// =================================================================================================
describe('vmSes: la vista del servidor para el teléfono', () => {
  it('trae el estado de ESTE teléfono y SUS pedidos del bloque; los de más de 72 h no entran; copia profunda (cambiarlos no toca lo leído)', () => {
    const bloque = { v: 1, estado: { paso: 'pedido_confirmar', ultimoMensajeMs: AHORA - MIN, carrito: [{ id: 'a' }] }, pedidos: { 'ped-a': pedido('ped-a', 2 * HORA), 'ped-viejo': pedido('ped-viejo', 73 * HORA), 'ped-71': pedido('ped-71', 71 * HORA) } };
    const cfg = { sesion: sesion(bloque) };
    const ses = lib({ cfg }).vmSes(CLIENTE, AHORA);
    expect(ses.ok).toBe(true);
    expect(ses.version).toBe(3);
    expect(ses.estados[CLIENTE]).toMatchObject({ paso: 'pedido_confirmar' });
    expect(Object.keys(ses.pedidos).sort()).toEqual(['ped-71', 'ped-a']);
    expect(ses.previo).toEqual(bloque); // lo que restaura la compensación: el bloque tal como estaba (con los viejos incluidos)
    expect(ses.deRespaldo).toBe(false);
    ses.estados[CLIENTE].carrito.push(1);
    expect(ses.previo.estado.carrito).toHaveLength(1);
    expect(bloque.estado.carrito).toHaveLength(1);
  });

  it('sin una conversación válida del servidor (`ok` falso) no hay estado ni pedidos ni versión', () => {
    for (const cfg of [{}, { sesion: { ok: false, version: 0, estado: null } }, { sesion: sesion({ v: 1, estado: { paso: 'menu' }, pedidos: {} }, { ok: 'sí' }) }]) {
      const ses = lib({ cfg }).vmSes(CLIENTE, AHORA);
      expect(ses.ok, JSON.stringify(cfg)).toBe(false);
      expect(ses.estados, JSON.stringify(cfg)).toEqual({});
      expect(ses.pedidos, JSON.stringify(cfg)).toEqual({});
    }
  });

  it('un teléfono que no es una clave válida no abre nada (nada de __proto__ ni de «abc»)', () => {
    const cfg = { sesion: sesion({ v: 1, estado: { paso: 'menu' }, pedidos: {} }) };
    for (const mala of ['__proto__', 'constructor', 'abc', '']) {
      const ses = lib({ cfg }).vmSes(mala, AHORA);
      expect(Object.keys(ses.estados), mala).toEqual([]);
    }
  });

  it('un pedido que no es objeto, o con un id raro (`constructor`), no entra', () => {
    const bloque = { v: 1, estado: null, pedidos: { 'ped-ok': pedido('ped-ok', MIN), constructor: pedido('constructor', MIN), roto: null, texto: 'x' } };
    const ses = lib({ cfg: { sesion: sesion(bloque) } }).vmSes(CLIENTE, AHORA);
    expect(Object.keys(ses.pedidos)).toEqual(['ped-ok']);
  });
});

// =================================================================================================
describe('LECTURA DE RESPALDO de la publicación (la memoria vieja de n8n → el servidor), con retiro el 30/11/2026', () => {
  const viejo = (extra: J = {}): J => ({
    ventaMinima: {
      estados: { [CLIENTE]: { paso: 'pedido_confirmar', ultimoMensajeMs: AHORA - 10 * MIN, carrito: [{ id: 'a', cantidad: 1 }] }, [OTRO]: { paso: 'menu', ultimoMensajeMs: AHORA - MIN } },
      pedidos: { 'ped-mio': pedido('ped-mio', 2 * HORA, { resultado: 'cuadra' }), 'ped-ajeno': pedido('ped-ajeno', HORA, { from: OTRO }) },
      vistos: { 'wamid.VIEJO': AHORA - HORA },
      transferencias: { [CLIENTE]: [AHORA - 5 * MIN] },
      av: { dia: { fecha: '2026-10-05', n: 2 } },
      ...extra,
    },
  });
  const nuevo = sesion(null); // el servidor no tiene nada de este teléfono: versión 0

  it('con el servidor SIN nada del teléfono (versión 0) se usa el estado vigente de la memoria vieja y SUS pedidos; deRespaldo y previo lo dicen', () => {
    const ses = lib({ cfg: { sesion: nuevo }, raiz: viejo() }).vmSes(CLIENTE, AHORA);
    expect(ses.deRespaldo).toBe(true);
    expect(ses.estados[CLIENTE]).toMatchObject({ paso: 'pedido_confirmar' });
    expect(Object.keys(ses.pedidos)).toEqual(['ped-mio']); // el pedido de OTRO teléfono nunca
    expect(ses.previo).toMatchObject({ v: 1, estado: { paso: 'pedido_confirmar' } }); // la compensación restaura esto, no «nada»
  });

  it('NEGADO: si el servidor YA tiene estado del teléfono, manda el servidor y la memoria vieja se ignora (nunca se mezclan)', () => {
    const bloque = { v: 1, estado: { paso: 'menu', ultimoMensajeMs: AHORA - MIN }, pedidos: {} };
    const ses = lib({ cfg: { sesion: sesion(bloque) }, raiz: viejo() }).vmSes(CLIENTE, AHORA);
    expect(ses.deRespaldo).toBe(false);
    expect(ses.estados[CLIENTE]).toMatchObject({ paso: 'menu' });
    expect(ses.pedidos).toEqual({});
  });

  it('NEGADO: si el documento del servidor ya existió (versión > 0) y venció, NO resucita el estado de la memoria vieja', () => {
    const ses = lib({ cfg: { sesion: sesion(null, { version: 4, vencido: true }) }, raiz: viejo() }).vmSes(CLIENTE, AHORA);
    expect(ses.deRespaldo).toBe(false);
    expect(ses.estados).toEqual({});
  });

  it('NEGADO: lo vencido de la memoria vieja no se usa (60 min; 24 h en esperando_comprobante; 72 h los pedidos)', () => {
    const v = viejo();
    v['ventaMinima'].estados[CLIENTE].ultimoMensajeMs = AHORA - 61 * MIN;
    v['ventaMinima'].pedidos['ped-mio'].guardadoMs = AHORA - 73 * HORA;
    const ses = lib({ cfg: { sesion: nuevo }, raiz: v }).vmSes(CLIENTE, AHORA);
    expect(ses.deRespaldo).toBe(false);
    expect(ses.estados).toEqual({});
    expect(ses.pedidos).toEqual({});
    v['ventaMinima'].estados[CLIENTE] = { paso: 'esperando_comprobante', ultimoMensajeMs: AHORA - 23 * HORA };
    expect(lib({ cfg: { sesion: nuevo }, raiz: v }).vmSes(CLIENTE, AHORA).estados[CLIENTE]).toMatchObject({ paso: 'esperando_comprobante' });
  });

  it('PASADO EL RETIRO (30/11/2026 00:00 en La Paz) la memoria vieja ni se mira; un minuto antes, sí', () => {
    const v = viejo();
    v['ventaMinima'].estados[CLIENTE].ultimoMensajeMs = RETIRO - 2 * MIN;
    v['ventaMinima'].estados[CLIENTE].paso = 'esperando_comprobante';
    expect(lib({ cfg: { sesion: nuevo }, raiz: v, ahora: RETIRO - MIN }).vmSes(CLIENTE, RETIRO - MIN).deRespaldo).toBe(true);
    const despues = lib({ cfg: { sesion: nuevo }, raiz: v, ahora: RETIRO }).vmSes(CLIENTE, RETIRO);
    expect(despues.deRespaldo).toBe(false);
    expect(despues.estados).toEqual({});
  });

  it('vmVistoDeRespaldo: un mensaje visto por la memoria vieja no se responde dos veces mientras dure el respaldo; después del retiro, no', () => {
    expect(lib({ raiz: viejo() }).vmVistoDeRespaldo('wamid.VIEJO', AHORA)).toBe(true);
    expect(lib({ raiz: viejo() }).vmVistoDeRespaldo('wamid.OTRO', AHORA)).toBe(false);
    expect(lib({ raiz: viejo() }).vmVistoDeRespaldo('', AHORA)).toBe(false);
    expect(lib({ raiz: viejo(), ahora: RETIRO }).vmVistoDeRespaldo('wamid.VIEJO', RETIRO)).toBe(false);
    expect(lib({ raiz: {} }).vmVistoDeRespaldo('wamid.VIEJO', AHORA)).toBe(false);
  });

  it('vmRetirarRespaldo: tras comprometer lo migrado se borra de la memoria vieja (el teléfono y SUS pedidos), sin tocar el residuo de PR-4b ni a otros teléfonos', () => {
    const raiz = viejo();
    expect(lib({ raiz }).vmRetirarRespaldo(CLIENTE, AHORA, true)).toBe(true);
    expect(raiz['ventaMinima'].estados[CLIENTE]).toBeUndefined();
    expect(raiz['ventaMinima'].estados[OTRO]).toBeDefined();
    expect(raiz['ventaMinima'].pedidos['ped-mio']).toBeUndefined();
    expect(raiz['ventaMinima'].pedidos['ped-ajeno']).toBeDefined();
    expect(raiz['ventaMinima'].transferencias[CLIENTE]).toHaveLength(1);
    expect(raiz['ventaMinima'].av.dia.n).toBe(2);
    // sin haber migrado nada, antes del retiro no se borra nada
    const intacta = viejo();
    lib({ raiz: intacta }).vmRetirarRespaldo(CLIENTE, AHORA, false);
    expect(intacta).toEqual(viejo());
  });

  it('vmRetirarRespaldo pasado el retiro: se borran los TRES mapas viejos enteros y el residuo de PR-4b queda', () => {
    const raiz = viejo();
    lib({ raiz, ahora: RETIRO }).vmRetirarRespaldo(CLIENTE, RETIRO, false);
    expect(Object.keys(raiz['ventaMinima']).sort()).toEqual(['av', 'transferencias']);
  });
});

// =================================================================================================
describe('vmGuardarPedido, vmVenceEnMin y el tope en BYTES', () => {
  it('vmGuardarPedido: vive 72 h desde su última escritura (guardadoMs), fusiona con lo anterior, poda lo vencido y respeta el tope de 500', () => {
    const ses = { pedidos: { v: { guardadoMs: AHORA - 73 * HORA }, r: { guardadoMs: AHORA - 71 * HORA }, 'ped-1': { pedidoId: 'ped-1', total: 55, codigo: 'K7Q2', guardadoMs: AHORA - HORA } } };
    const guardado = lib().vmGuardarPedido(ses, { pedidoId: 'ped-1', mediaId: 'm1', resultado: 'cuadra' }, AHORA);
    expect(Object.keys(ses.pedidos).sort()).toEqual(['ped-1', 'r']);
    expect(guardado).toMatchObject({ total: 55, codigo: 'K7Q2', mediaId: 'm1', resultado: 'cuadra', guardadoMs: AHORA });
    const muchos: { pedidos: J } = { pedidos: {} };
    for (let i = 0; i < 520; i++) muchos.pedidos[`p${i}`] = { pedidoId: `p${i}`, guardadoMs: AHORA - HORA + i };
    lib().vmGuardarPedido(muchos, { pedidoId: 'nuevo' }, AHORA);
    const k = Object.keys(muchos.pedidos);
    expect({ n: k.length, nuevo: k.includes('nuevo'), p0: k.includes('p0'), p519: k.includes('p519') }).toEqual({ n: 500, nuevo: true, p0: false, p519: true });
  });

  it('vmGuardarPedido no guarda un pedido sin id válido ni con un reloj raro y no toca nada', () => {
    const ses = { pedidos: {} };
    const x = [lib().vmGuardarPedido(ses, {}, AHORA), lib().vmGuardarPedido(ses, { pedidoId: '__proto__' }, AHORA), lib().vmGuardarPedido(ses, { pedidoId: 'ok' }, Number.NaN), lib().vmGuardarPedido(null, { pedidoId: 'ok' }, AHORA)];
    expect(x).toEqual([null, null, null, null]);
    expect(Object.keys(ses.pedidos)).toEqual([]);
  });

  it('vmVenceEnMin: 60 min el estado normal, 24 h esperando el comprobante y 72 h (el tope del servidor) si el bloque trae pedidos', () => {
    const v = (b: J | null): number => lib().vmVenceEnMin(b);
    expect(v(null)).toBe(60);
    expect(v({ estado: { paso: 'menu' }, pedidos: {} })).toBe(60);
    expect(v({ estado: { paso: 'esperando_comprobante' }, pedidos: {} })).toBe(1440);
    expect(v({ estado: { paso: 'esperando_comprobante' }, pedidos: { a: {} } })).toBe(4320);
    expect(v({ estado: null, pedidos: { a: {} } })).toBe(4320);
    expect(v({ estado: { paso: 'menu' } })).toBe(60);
  });

  it('ssBytes mide UTF-8 sin lanzar con un surrogate suelto (cuenta U+FFFD = 3 bytes), con tildes (2), emojis (4) y sin Buffer', () => {
    const b = (t: string): number => lib().ssBytes(t);
    expect(b('abc')).toBe(3);
    expect(b('añ')).toBe(3);
    expect(b('😀')).toBe(4);
    expect(b('\uD800')).toBe(3);
    expect(b('\uDC00x')).toBe(4);
    expect(b('a\uD800b')).toBe(5);
    expect(() => b('\uD83D' + 'x')).not.toThrow();
  });

  it('el tope: SS_CONFIG.maxBytes es 15.000 (el servidor admite 16 KiB) y el compromiso es null si el bloque no cabe (nunca un 413)', () => {
    expect(lib().SS_CONFIG.maxBytes).toBe(15000);
    expect(lib().ssCuerpoComprometer(CLIENTE, 'e1', 'fin', 3, { v: 1, estado: { relleno: 'x'.repeat(15001) }, pedidos: {} })).toBeNull();
    const cabe = lib().ssCuerpoComprometer(CLIENTE, 'e1', 'fin', 3, { v: 1, estado: { paso: 'menu' }, pedidos: {} });
    expect(cabe.sesion).toMatchObject({ v: 1, accion: 'comprometer', espacio: 'venta-minima', versionLeida: 3, idCompromiso: 'vm-fin-e1', venceEnMin: 60 });
    expect(Object.keys(cabe).sort()).toEqual(['sesion', 'telefono']);
  });
});

// =================================================================================================
describe('PEOR CASO en bytes: el bloque nunca pasa de 15.000 aunque el teléfono tenga muchos pedidos (recorte por bytes, el más antiguo primero)', () => {
  // `Armar mensajes` arma el bloque con `amBloque`. Se corre el nodo REAL con el módulo `sesion` y las piezas de `comun.js`.
  const MENSAJES = nodoFuente('armar-mensajes');
  const corre = (cfg: J, plan: J): J => ejecutar(`${COMUN}\n${SESION}\n${MENSAJES}`, [{}], {
    'Config del negocio': { numeroRecepcion: '59100000031', nivelEmojis: 'muchos', ...cfg },
    'Interpretar entrada': { from: CLIENTE, ahoraMs: AHORA, mensajeId: 'wamid.X', phoneNumberId: 'P1' },
    'Plan del turno': plan,
  }, { $getWorkflowStaticData: () => ({}), $execution: { id: 'e1' } })[0]!;

  it('40 pedidos viejos de ~500 bytes multibyte: sigue comprometiendo, con el pedido nuevo y sin pasar de 15.000 bytes; salen primero los más antiguos', () => {
    const viejos: J = {};
    for (let i = 0; i < 40; i++) viejos[`ped-${i}`] = { pedidoId: `ped-${i}`, from: CLIENTE, total: 10, guardadoMs: AHORA - 60 * MIN + i, relleno: 'ñ😀'.repeat(60) };
    const r = corre({ sesion: sesion({ v: 1, estado: null, pedidos: viejos }) },
      { ruta: 'm', estadoNuevo: { paso: 'menu' }, pedido: { pedidoId: 'ped-nuevo', total: 55 }, mensajes: [{ tipo: 'texto', cuerpo: 'Hola', botones: [] }] });
    const bloque = r['bloque'] as J;
    expect(r['modo']).toBe('comprometer');
    expect(Buffer.byteLength(JSON.stringify(bloque))).toBeLessThanOrEqual(15000);
    const claves = Object.keys(bloque['pedidos']);
    expect(claves).toContain('ped-nuevo');
    expect(claves).not.toContain('ped-0');
    expect(claves).toContain('ped-39');
    expect(claves.length).toBeLessThan(41);
    expect(r['compromiso'].sesion.venceEnMin).toBe(4320);
    expect(r['compromiso'].sesion.versionLeida).toBe(3);
  });

  it('el pedido que sigue en el estado (el que espera el comprobante) es el ÚLTIMO que se suelta; y si aun así no cabe, el estado conserva su copia', () => {
    const grande = (id: string): J => ({ pedidoId: id, from: CLIENTE, total: 10, guardadoMs: AHORA - MIN, relleno: 'ñ😀'.repeat(1100) });
    const r = corre({ sesion: sesion({ v: 1, estado: null, pedidos: { 'ped-otro': grande('ped-otro') } }) },
      { ruta: 'm', estadoNuevo: { paso: 'esperando_comprobante', pedido: grande('ped-activo') }, pedido: grande('ped-activo'), mensajes: [{ tipo: 'texto', cuerpo: 'Hola', botones: [] }] });
    const bloque = r['bloque'] as J;
    expect(Buffer.byteLength(JSON.stringify(bloque))).toBeLessThanOrEqual(15000);
    expect(Object.keys(bloque['pedidos'])).not.toContain('ped-otro'); // el ajeno sale primero
    expect(bloque['estado'].pedido.pedidoId).toBe('ped-activo'); // y el estado conserva el suyo
  });

  it('si ni el estado solo cabe: no hay compromiso (modo `no_cabe`), sale el genérico con botón y no se lanza nada (surrogates sueltos incluidos)', () => {
    const r = corre({ sesion: sesion(null) },
      { ruta: 'm', estadoNuevo: { paso: 'pedido', nota: '\uD800' + 'ñ'.repeat(9000) }, mensajes: [{ tipo: 'texto', cuerpo: 'Hola', botones: [] }] });
    expect(r['modo']).toBe('no_cabe');
    expect(r['comprometer']).toBe(false);
    expect(r['compromiso']).toBeNull();
    expect(r['salidaFalla']).toHaveLength(1);
    expect(r['salidaFalla'][0].payload.interactive.action.name).toBe('cta_url'); // el botón a recepción
    expect(r['salida'][0].texto).toBe('Hola'); // lo planificado queda armado, pero Soltar mensajes no lo suelta
  });
});

// =================================================================================================
describe('las guardias de `construir.mjs --verificar` sobre el estado de la conversación (cada una, con su negativo sobre una COPIA)', () => {
  const rompe = (etiqueta: string, cambio: (f: ReturnType<typeof leer>) => void, mensaje: RegExp, archivo = 'venta-minima.qtaco.json') => {
    it(`FALLA: ${etiqueta}`, () => {
      const r = verificarEnCopia((vm) => editarJson(vm, archivo, cambio));
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(mensaje);
    });
  };
  const codigo = (f: ReturnType<typeof leer>, n: string): string => String(nodoDe(f, n).parameters['jsCode']);

  it('contraprueba: sin tocar nada, `--verificar` sale con 0 y los cuatro JSON traen el módulo `sesion` TAL CUAL en los cinco nodos que lo usan', () => {
    const r = verificarEnCopia(() => undefined);
    expect(r.status, r.stderr).toBe(0);
    for (const archivo of ['venta-minima.qtaco.json', 'venta-minima.qtaco-3727.json', 'venta-minima.prueba.json', 'venta-minima.ensayo-demo-a.json']) {
      const f = leer(archivo);
      for (const n of ['Config del negocio', 'Armar mensajes', 'Soltar mensajes', 'Confirmar envío', 'Resumen del turno']) {
        expect(codigo(f, n), `${archivo} · ${n}`).toContain(SESION.trimEnd());
      }
      for (const n of ['Interpretar entrada', 'Decidir turno', 'Plan del turno', 'Armar avisos', 'Sin estado']) expect(codigo(f, n), `${archivo} · ${n}`).not.toContain(SESION.trimEnd());
    }
  });

  rompe('un nodo trae una COPIA EDITADA del módulo `sesion` (el aislamiento de la prueba anulado)', (f) => {
    const n = nodoDe(f, 'Armar mensajes');
    n.parameters['jsCode'] = String(n.parameters['jsCode']).replace('function ssDesdeAutorizado(from) {', 'function ssDesdeAutorizado(from) { return true;');
  }, /sin traer `comun-sin-agente\/src\/sesion\.js` tal cual/);
  rompe('un nodo REDEFINE un ayudante de sesión después de traer el módulo (en JS gana la última declaración)', (f) => {
    const n = nodoDe(f, 'Armar mensajes');
    n.parameters['jsCode'] = String(n.parameters['jsCode']) + '\nfunction ssDesdeAutorizado() { return true; }\n';
  }, /declara ssDesdeAutorizado 2 veces/);
  rompe('«Armar mensajes» cuelga también de «¿Enviar de verdad?» (algo se enviaría antes del compromiso)', (f) => {
    f.connections['Armar mensajes']!['main']![0]!.push({ node: '¿Enviar de verdad?', type: 'main', index: 0 });
  }, /«Armar mensajes» tiene que colgar SOLO de «¿Comprometer turno\?»/);
  rompe('«Comprometer turno» llega al envío por su cuenta (sin pasar por «Soltar mensajes»)', (f) => {
    f.connections['Comprometer turno']!['main']![0]!.push({ node: '¿Enviar de verdad?', type: 'main', index: 0 });
  }, /«Comprometer turno» conecta con «¿Enviar de verdad\?»: solo «Soltar mensajes» puede/);
  rompe('«Comprometer turno» sin reintento (un 5xx perdería el compromiso)', (f) => { nodoDe(f, 'Comprometer turno').retryOnFail = false; }, /«Comprometer turno» tiene que reintentar/);
  rompe('«Comprometer turno» con maxTries 1', (f) => { nodoDe(f, 'Comprometer turno').maxTries = 1; }, /«Comprometer turno» tiene que reintentar/);
  rompe('«Comprometer compensación» con `neverError` (un 5xx no se reintentaría)', (f) => {
    (nodoDe(f, 'Comprometer compensación').parameters['options'] as J)['response'] = { response: { fullResponse: true, neverError: true } };
  }, /«Comprometer compensación» tiene que reintentar/);
  rompe('«Comprometer turno» llama a otra URL', (f) => { nodoDe(f, 'Comprometer turno').parameters['url'] = 'https://us-east1-novuchat-demo.cloudfunctions.net/ingesta'; }, /«Comprometer turno» tiene que llamar a configuracionFlujo/);
  rompe('«Traer configuración» pide el estado en OTRO espacio que el que compromete SS_CONFIG', (f) => {
    const n = nodoDe(f, 'Traer configuración');
    n.parameters['jsonBody'] = String(n.parameters['jsonBody']).replace("'venta-minima-prueba' : 'venta-minima'", "'venta-minima-prueba' : 'venta-minima-x'");
  }, /MISMO espacio que declara SS_CONFIG/);
  rompe('«Traer configuración» no manda el idMensaje (los repetidos no los marcaría el servidor)', (f) => {
    const n = nodoDe(f, 'Traer configuración');
    n.parameters['jsonBody'] = String(n.parameters['jsonBody']).replace('{ idMensaje: id }', '{}');
  }, /tiene que mandar el idMensaje/);
  rompe('«Traer configuración» pide el estado de cualquier teléfono en la prueba (sin `telefonosDePrueba`)', (f) => {
    const n = nodoDe(f, 'Traer configuración');
    n.parameters['jsonBody'] = String(n.parameters['jsonBody']).split('telefonosDePrueba').join('otraLista');
  }, /solo pide el estado para los `telefonosDePrueba`/);
  rompe('«Carga de entrada» ya no deja `modoPrueba: true` siempre que corre «Entrada de prueba»', (f) => {
    const n = nodoDe(f, 'Carga de entrada');
    n.parameters['jsCode'] = String(n.parameters['jsCode']).replace('modoPrueba: true,', 'modoPrueba: b.modoPrueba === true,');
  }, /tiene que dejar `modoPrueba: true` siempre que corra «Entrada de prueba»/, 'venta-minima.prueba.json');
  rompe('falta «Soltar mensajes»', (f) => { f.nodes = f.nodes.filter((n) => n.name !== 'Soltar mensajes'); }, /falta el nodo «Soltar mensajes»/);
});

// =================================================================================================
describe('lo que los nodos de PR-4a NO pueden tener', () => {
  const NODOS_NUEVOS = ['sin-estado', 'soltar-mensajes', 'confirmar-envio', 'armar-mensajes', 'resumen-del-turno', 'config-del-negocio', 'interpretar-entrada', 'decidir-turno'];
  const FUENTES = [...NODOS_NUEVOS.map((n) => [`nodos/${n}.js`, nodoFuente(n)] as const), ['lib/comun.js', COMUN] as const, ['comun-sin-agente/src/sesion.js', SESION] as const];

  it('sin `new Function`, `eval`, `Function(`, globales de Node (`Buffer`, `require`, `process`, `URL`, `crypto`) ni red en el código', () => {
    for (const [nombre, fuente] of FUENTES) {
      const codigo = fuente.replace(/^\s*\/\/.*$/gm, '');
      expect(codigo, nombre).not.toMatch(/\bnew\s+Function\b|\beval\s*\(|(^|[^.\w])Function\s*\(/);
      expect(codigo, nombre).not.toMatch(/\b(Buffer|require|process|crypto|fetch|XMLHttpRequest)\b|\bnew\s+URL\b/);
    }
  });

  it('el código de los nodos corre SIN los globales de Node (el sandbox de n8n no los tiene): la librería y el módulo se evalúan limpios', () => {
    expect(() => ejecutar(`${COMUN}\n${SESION}\nreturn [{ json: { ok: typeof vmSes + typeof ssCuerpoComprometer } }];`, [{}], {}, { $getWorkflowStaticData: () => ({}) })).not.toThrow();
  });

  it('ningún secreto, id real ni ruta de usuario en los JSON (solo marcadores REEMPLAZAR_* y teléfonos sintéticos)', () => {
    for (const archivo of ['venta-minima.qtaco.json', 'venta-minima.qtaco-3727.json', 'venta-minima.prueba.json', 'venta-minima.ensayo-demo-a.json', 'flujo.plantilla.json']) {
      const t = JSON.stringify(leer(archivo));
      expect(t, archivo).not.toMatch(/EAA[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}/);
      expect(t, archivo).not.toMatch(/\/home\/|\/Users\/|C:\\\\Users/);
    }
  });
});
