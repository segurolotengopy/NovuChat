/**
 * `rafagaApagada` en los dos comercios con «Config del negocio» PROPIA: Q'Taco (venta mínima) y el chat de NovuChat. La bandera por comercio llega de `configuracionFlujo`;
 * si su «Config del negocio» no la copia, el interruptor no llega a donde se lee. Se corre el CÓDIGO REAL del JSON versionado y se prueba negando:
 *   - con `rafagaApagada: true` y respuesta 200 la copia;
 *   - sin la bandera, con `false`, `'true'`, `1`, `null`, `0` o `'false'` NO (solo el `true` exacto);
 *   - con 409, 500 o sin código (0) NO la copia.
 * Q'Taco todavía no lleva la pieza de ráfagas: la clave queda lista y no cambia nada de su conducta de hoy (se prueba que ningún JSON suyo lleva nodos de ráfaga).
 * El chat de NovuChat tiene su propio «Esperar ráfaga» (coalescencia de clics): con la bandera, «Registrar evento» deja la espera en el mínimo de 0,1 s; sin ella, queda la de siempre.
 */
import { describe, expect, it } from 'vitest';
import { codigoDe, configBase, correr, leerFlujo } from '../lib/flujo';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;

const CUERPO_200 = { tenantId: 'tenant-de-prueba' };
const VALORES_QUE_NO_APAGAN: unknown[] = [false, 'true', 1, null, 'false', 0, {}, []];

const COMERCIOS: { nombre: string; archivo: string }[] = [
  { nombre: "Q'Taco (venta mínima, …3727)", archivo: 'clientes/venta-minima/venta-minima.qtaco-3727.json' },
  { nombre: 'Venta mínima (prueba)', archivo: 'clientes/venta-minima/venta-minima.prueba.json' },
  { nombre: 'Chat de NovuChat', archivo: 'clientes/novuchat/chat-novuchat.novuchat.json' },
  { nombre: 'Chat de NovuChat (prueba)', archivo: 'clientes/novuchat/chat-novuchat.prueba.json' },
];

describe.each(COMERCIOS)('rafagaApagada en «Config del negocio»: $nombre', ({ archivo }) => {
  const flujo = leerFlujo(archivo);
  const codigo = codigoDe(flujo, 'Config del negocio');
  const base = configBase(flujo);
  const configCon = (statusCode: number, body: J): J => correr(codigo, [{ statusCode, body }], { 'Config base': base })[0].json;

  it('con `rafagaApagada: true` y 200 el nodo la copia', () => {
    expect(configCon(200, { ...CUERPO_200, rafagaApagada: true }).rafagaApagada).toBe(true);
  });

  it('NEGADO: sin la bandera no hay clave con valor (la respuesta de hoy no cambia)', () => {
    expect(configCon(200, CUERPO_200).rafagaApagada).toBeUndefined();
  });

  it('NEGADO: `false`, `\'true\'`, `1`, `null`, `0`, `\'false\'`, `{}` y `[]` no apagan: solo el true exacto', () => {
    for (const v of VALORES_QUE_NO_APAGAN) {
      expect(configCon(200, { ...CUERPO_200, rafagaApagada: v }).rafagaApagada, `valor ${JSON.stringify(v)}`).toBeUndefined();
    }
  });

  it('NEGADO: con un 409, un 500 o sin código la bandera no se copia (solo vale con la respuesta 200 del panel)', () => {
    for (const codigoHttp of [409, 500, 0]) {
      expect(configCon(codigoHttp, { ...CUERPO_200, rafagaApagada: true }).rafagaApagada, `código ${codigoHttp}`).toBeUndefined();
    }
  });
});

describe("Q'Taco no lleva la pieza de ráfagas: la bandera queda lista y la conducta de hoy no cambia", () => {
  it.each(COMERCIOS.slice(0, 2))('$nombre no trae ningún nodo de ráfaga', ({ archivo }) => {
    const nombres = leerFlujo(archivo).nodes.map((n) => n.name);
    expect(nombres.filter((n) => /r[áa]faga/i.test(n))).toEqual([]);
  });
});

describe('Chat de NovuChat: «Registrar evento» y la espera de «Esperar ráfaga»', () => {
  const flujo = leerFlujo('clientes/novuchat/chat-novuchat.novuchat.json');
  const codigo = codigoDe(flujo, 'Registrar evento');
  const FROM = '70000011'; // ficticio, 8 dígitos: pasa la clave válida del nodo sin parecerse a un teléfono real
  const entrada = { tipo: 'text', from: FROM, mensajeId: 'wamid.RAFAGA1', ahoraMs: Date.UTC(2026, 10, 27, 15, 0, 0), evento: { k: 'otro', t: 'hola', c: '', rubro: '', boton: '' } };
  const registrar = (config: J): J => {
    const salida = correr(codigo, [{}], {
      'Interpretar entrada': entrada,
      'Puerta del turno': { ruta: 'sigue' },
      'Config del negocio': { sesion: { ok: true, version: 1, estado: null }, ...config },
    }, { $execution: { id: 'ejecucion-de-prueba' } });
    return salida[0].json;
  };

  it('sin la bandera la espera es la de siempre (mayor que el mínimo)', () => {
    const r = registrar({});
    expect(r.registrado, JSON.stringify(r)).toBe(true);
    expect(r.esperarSeg).toBeGreaterThan(0.1);
  });

  it('con `rafagaApagada: true` la espera baja al mínimo de 0,1 s y el evento se registra igual', () => {
    const r = registrar({ rafagaApagada: true });
    expect(r.registrado).toBe(true);
    expect(r.esperarSeg).toBe(0.1);
  });

  it('NEGADO: `false`, `\'true\'`, `1` y `null` no recortan la espera: solo el true exacto', () => {
    const normal = registrar({}).esperarSeg;
    for (const v of [false, 'true', 1, null, 0]) {
      expect(registrar({ rafagaApagada: v }).esperarSeg, `valor ${JSON.stringify(v)}`).toBe(normal);
    }
  });
});
