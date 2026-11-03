/**
 * DECIDIR EL ENVÍO POR EL RELÉ (P1 del plan del 02/11/2026): la tabla de `Flujos/src/core/rele/decidir-envio.js`, probada NEGANDO.
 *   - un 504 WM-3041 NUNCA se reenvía (ni con `reintentable`), ni se respalda;
 *   - un 429 WM-3037 se repite UNA vez, tras 61 a 64 s; un 409 WM-3035, hasta 2 veces tras 2 a 3 s; un reintentable, 2 veces (2 s y 8 s);
 *   - lo que el relé rechaza antes de Meta, o Meta con un código conocido, va a respaldo; nada más;
 *   - un código WM desconocido, una caída de red, un 2xx sin id o un cuerpo ilegible son INCIERTOS: no se reenvía, no se respalda, no se reporta.
 * La función se carga en un contexto de `node:vm` VACÍO (sin URL, Buffer ni crypto), como el Code de n8n.
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { RAIZ_REPO, leerFuentes } from '../fuente-vm';

interface Decision { accion: string; codigo: string; esperaS: number; idMeta?: string; intentos: { n429: number; n409: number; nReint: number } }
interface Intentos { n429?: number; n409?: number; nReint?: number }
const RUTAS = ['Flujos/src/core/rele/codigos.js', 'Flujos/src/core/rele/decidir-envio.js'];
const FUENTE = leerFuentes(RUTAS);
const CORTE = FUENTE.indexOf('const respuestas = $input.all();');
const { releDecidir, RELE_PREVIOS, RELE_METAS } = vm.runInNewContext(
  `${FUENTE.slice(0, CORTE)}\n({ releDecidir, RELE_PREVIOS, RELE_METAS })`, Object.create(null),
) as { releDecidir: (r: unknown, i?: unknown, a?: number) => Decision; RELE_PREVIOS: string[]; RELE_METAS: string[] };
const d = (r: unknown, i: Intentos = {}, azar = 0): Decision => releDecidir(r, i, azar);
const err = (codigo: string, extra: Record<string, unknown> = {}): unknown => ({ error: { codigo, reintentable: false, ...extra } });

describe('el módulo se parte donde dice y no usa nada que el Code de n8n no tenga', () => {
  it('encontró el cuerpo del nodo y la función', () => {
    expect(CORTE).toBeGreaterThan(0);
    expect(typeof releDecidir).toBe('function');
  });
  it('NIEGA: ni require, URL, Buffer, crypto, process ni temporizadores', () => {
    const sinComentarios = FUENTE.replace(/^\s*\/\/.*$/gm, '');
    expect(sinComentarios).not.toMatch(/\b(require|URL|URLSearchParams|Buffer|crypto|process|setTimeout|setInterval|fetch|structuredClone)\b/);
  });
  it('las listas son las mismas del verificador de la salida de persona', () => {
    const otro = leerFuentes(['Flujos/src/core/salida-persona/resultado-del-envio.js']);
    for (const c of [...RELE_PREVIOS, ...RELE_METAS]) expect(otro, c).toContain(`'${c}'`);
  });
});

describe('éxito', () => {
  it('2xx con id: ok y el id', () => {
    expect(d({ messages: [{ id: 'wamid.ABC=' }] })).toMatchObject({ accion: 'ok', idMeta: 'wamid.ABC=', esperaS: 0 });
  });
  it('NIEGA: 2xx sin id, con id vacío, con id no texto o con caracteres raros es INCIERTO (Meta pudo aceptarlo)', () => {
    for (const r of [{}, { messages: [] }, { messages: [{}] }, { messages: [{ id: '' }] }, { messages: [{ id: 5 }] }, { messages: [{ id: 'a b' }] }, { messages: [{ id: 'x'.repeat(121) }] }, { messages: 'x' }, { data: '<html>' }]) {
      expect(d(r), JSON.stringify(r)).toMatchObject({ accion: 'incierto' });
      expect(d(r).idMeta).toBeUndefined();
    }
  });
  it('NIEGA: un id junto a un `error` no es éxito', () => {
    expect(d({ messages: [{ id: 'wamid.X' }], error: 'tiempo agotado' }).accion).toBe('incierto');
    expect(d({ messages: [{ id: 'wamid.X' }], error: { codigo: 'WM-3041' } }).accion).toBe('incierto');
  });
});

describe('504 WM-3041: nunca se reenvía', () => {
  it('es incierto, sin espera, aunque el relé diga reintentable y aunque queden todos los intentos', () => {
    for (const r of [err('WM-3041'), err('WM-3041', { reintentable: true }), err('WM-3041', { metaCodigo: '131047' })]) {
      const x = d(r);
      expect(x.accion).toBe('incierto');
      expect(x.esperaS).toBe(0);
    }
  });
  it('NIEGA: con cualquier combinación de contadores sigue sin reintentar ni respaldar', () => {
    for (const n429 of [0, 1, 5]) for (const n409 of [0, 2, 9]) for (const nReint of [0, 1, 7]) {
      expect(d(err('WM-3041', { reintentable: true }), { n429, n409, nReint }).accion).toBe('incierto');
    }
  });
});

describe('429 WM-3037: una espera de 61 a 64 s, una sola vez', () => {
  it('la primera vez reintenta con 61 a 64 s según el azar', () => {
    expect(d(err('WM-3037'), {}, 0)).toMatchObject({ accion: 'reintentar', esperaS: 61 });
    expect(d(err('WM-3037'), {}, 0.999)).toMatchObject({ accion: 'reintentar', esperaS: 64 });
    for (let k = 0; k <= 100; k++) {
      const s = d(err('WM-3037'), {}, k / 100).esperaS;
      expect(s).toBeGreaterThanOrEqual(61);
      expect(s).toBeLessThanOrEqual(64);
      // n8n deja de esperar en memoria pasados 65 s: la espera tiene que quedar por debajo.
      expect(s).toBeLessThan(65);
    }
  });
  it('NIEGA: la segunda vez NO reintenta: queda agotado, sin respaldo', () => {
    const x = d(err('WM-3037'), { n429: 1 });
    expect(x.accion).toBe('agotado');
    expect(x.esperaS).toBe(0);
  });
  it('cuenta el intento y no toca el objeto que recibió', () => {
    const previo = { n429: 0, n409: 1, nReint: 1 };
    const x = d(err('WM-3037'), previo);
    expect(x.intentos).toEqual({ n429: 1, n409: 1, nReint: 1 });
    expect(previo).toEqual({ n429: 0, n409: 1, nReint: 1 });
  });
  it('un 429 reintentable de otro origen (130429 de Meta) NO usa el contador del 429 del relé', () => {
    expect(d(err('WM-3040', { metaCodigo: '130429' }), { n429: 1 }).accion).toBe('reintentar');
  });
});

describe('409 WM-3035: hasta 2 veces, tras 2 a 3 s', () => {
  it('reintenta dos veces con 2 a 3 s y a la tercera queda agotado', () => {
    expect(d(err('WM-3035'), {}, 0)).toMatchObject({ accion: 'reintentar', esperaS: 2 });
    expect(d(err('WM-3035'), {}, 0.999)).toMatchObject({ accion: 'reintentar', esperaS: 3 });
    const segunda = d(err('WM-3035'), { n409: 1 }, 0.5);
    expect(segunda.accion).toBe('reintentar');
    expect(segunda.esperaS).toBeGreaterThanOrEqual(2);
    expect(segunda.esperaS).toBeLessThanOrEqual(3);
    expect(d(err('WM-3035'), { n409: 2 }).accion).toBe('agotado');
  });
  it('NIEGA: nunca va a respaldo (el pedido original sigue en curso en el relé)', () => {
    for (const n409 of [0, 1, 2, 3, 10]) expect(d(err('WM-3035'), { n409 }).accion).not.toBe('respaldo');
  });
});

describe('reintentable de un código conocido: 2 reintentos (2 s y 8 s)', () => {
  it('WM-3038 (saturación): 2 s, luego 8 s, luego agotado', () => {
    const r = err('WM-3038', { reintentable: true });
    const a = d(r, {});
    expect(a).toMatchObject({ accion: 'reintentar', esperaS: 2 });
    const b = d(r, a.intentos);
    expect(b).toMatchObject({ accion: 'reintentar', esperaS: 8 });
    const c = d(r, b.intentos);
    expect(c).toMatchObject({ accion: 'agotado', esperaS: 0 });
  });
  it('130429 de Meta (WM-3040) es reintentable aunque el relé no lo marque', () => {
    expect(d(err('WM-3040', { metaCodigo: '130429' })).accion).toBe('reintentar');
  });
  it('NIEGA: un código DESCONOCIDO marcado reintentable no se reintenta (puede que ya haya salido)', () => {
    for (const c of ['WM-3030', 'WM-3036', 'WM-3042', 'WM-3999', 'WM-1234']) expect(d(err(c, { reintentable: true })).accion, c).toBe('incierto');
  });
  it('NIEGA: un WM-3040 con código de Meta desconocido marcado reintentable no se reintenta', () => {
    expect(d(err('WM-3040', { metaCodigo: '999999', reintentable: true })).accion).toBe('incierto');
    expect(d(err('WM-3040', { reintentable: true })).accion).toBe('incierto');
  });
});

describe('respaldo: solo lo que se rechazó antes de salir', () => {
  it('cada código previo NO reintentable va a respaldo, con su código', () => {
    for (const c of RELE_PREVIOS.filter((x) => x !== 'WM-3037' && x !== 'WM-3038')) {
      expect(d(err(c)), c).toMatchObject({ accion: 'respaldo', codigo: c, esperaS: 0 });
    }
  });
  it('NIEGA: WM-3032 (cualquier link) y WM-3039 (más de 16 MiB) van a respaldo y NUNCA se reintentan, aunque el relé los marque reintentables', () => {
    for (const c of ['WM-3032', 'WM-3039']) {
      for (const rt of [false, true]) for (const nReint of [0, 1]) expect(d(err(c, { reintentable: rt }), { nReint }), `${c} ${String(rt)}`).toMatchObject({ accion: 'respaldo', esperaS: 0 });
    }
  });
  it('WM-3040 con un código de Meta conocido va a respaldo y deja el código de Meta', () => {
    for (const m of RELE_METAS.filter((x) => x !== '130429')) expect(d(err('WM-3040', { metaCodigo: m })), m).toMatchObject({ accion: 'respaldo', codigo: m });
  });
  it('NIEGA: WM-3040 con un código de Meta desconocido o ausente es incierto (incluye un id de medio vencido: 502, no 404)', () => {
    for (const m of [undefined, null, '', '1', '999999', 'abc']) expect(d(err('WM-3040', { metaCodigo: m })).accion, String(m)).toBe('incierto');
  });
  it('NIEGA: lo que no está en la lista permitida nunca va a respaldo', () => {
    for (let n = 3000; n < 3100; n++) {
      const c = `WM-${n}`;
      if (RELE_PREVIOS.includes(c) || c === 'WM-3040' || c === 'WM-3035' || c === 'WM-3041') continue;
      expect(d(err(c)).accion, c).toBe('incierto');
    }
  });
});

describe('incierto: red, tiempo, cuerpos raros', () => {
  it('un error de red o de tiempo (texto) es incierto', () => {
    for (const r of [{ error: 'timeout of 30000ms exceeded' }, { error: 'ECONNRESET' }, { error: true }, { error: ['x'] }]) expect(d(r), JSON.stringify(r)).toMatchObject({ accion: 'incierto', esperaS: 0 });
  });
  it('un error sin código WM o con código mal formado es incierto', () => {
    for (const r of [{ error: {} }, { error: { codigo: 5 } }, { error: { codigo: 'wm-3037' } }, { error: { codigo: 'WM-37' } }, { error: { codigo: 'WM-3037 ; drop' } }, { error: { message: 'x', reintentable: true } }]) {
      expect(d(r), JSON.stringify(r)).toMatchObject({ accion: 'incierto' });
    }
  });
  it('null, undefined, números, textos y arreglos son inciertos', () => {
    for (const r of [null, undefined, 0, 'ok', [], [{ messages: [{ id: 'wamid.X' }] }]]) expect(d(r).accion, JSON.stringify(r)).toBe('incierto');
  });
  it('el código que sale es solo letras, números, punto, guion y guion bajo, y cabe en 40', () => {
    const x = d(err('WM-3032'));
    expect(x.codigo).toMatch(/^[A-Za-z0-9_.-]{0,40}$/);
    expect(d({ error: { codigo: 'WM-3040', metaCodigo: '131047' } }).codigo).toBe('131047');
  });
});

describe('propiedades de toda la tabla', () => {
  const CODIGOS = ['WM-3010', 'WM-3011', 'WM-3030', 'WM-3032', 'WM-3035', 'WM-3036', 'WM-3037', 'WM-3038', 'WM-3039', 'WM-3040', 'WM-3041', 'WM-3042', 'WM-9999'];
  const METAS = [undefined, '131047', '130429', '1'];
  it('solo `reintentar` trae espera; solo `ok` trae idMeta; nunca más de 1 429, 2 409 y 2 reintentables', () => {
    for (const c of CODIGOS) for (const m of METAS) for (const rt of [true, false]) {
      let intentos: Intentos = {};
      let vueltas = 0;
      for (;;) {
        const x = d(err(c, { metaCodigo: m, reintentable: rt }), intentos, 0.3);
        expect(x.idMeta).toBeUndefined();
        if (x.accion === 'reintentar') {
          expect(x.esperaS).toBeGreaterThan(0);
          intentos = x.intentos;
          vueltas++;
          expect(vueltas, `${c} ${String(m)} ${String(rt)}`).toBeLessThanOrEqual(2);
          continue;
        }
        expect(x.esperaS).toBe(0);
        expect(['respaldo', 'incierto', 'agotado']).toContain(x.accion);
        break;
      }
      expect(intentos.n429 ?? 0).toBeLessThanOrEqual(1);
      expect(intentos.n409 ?? 0).toBeLessThanOrEqual(2);
      expect(intentos.nReint ?? 0).toBeLessThanOrEqual(2);
    }
  });
  it('el azar fuera de rango no saca la espera de su intervalo', () => {
    for (const azar of [-5, NaN, Infinity, 7, undefined as unknown as number]) {
      const s = releDecidir(err('WM-3037'), {}, azar).esperaS;
      expect(s).toBeGreaterThanOrEqual(61);
      expect(s).toBeLessThanOrEqual(64);
    }
  });
  it('los contadores basura se toman como cero', () => {
    for (const i of [null, 'x', { n429: -3, n409: 'a', nReint: NaN }, []]) expect(releDecidir(err('WM-3037'), i, 0).accion).toBe('reintentar');
  });
});

void RAIZ_REPO;
