/**
 * TOPE DE RESPUESTAS POR VENTANA DE 24 HORAS — y el caché de 60 s.
 *
 * Desde el 1 de octubre de 2026 Meta cobra cada respuesta del asistente, así
 * que cuántos mensajes manda por conversación es EL costo. Estas pruebas cubren
 * las tres decisiones puras que lo gobiernan, sin emulador ni red:
 *
 *   a) qué tope rige para un comercio (`topeMensajes24h`): el estándar único
 *      de 25 y el ajuste por comercio, con sus cotas;
 *   b) dónde está una conversación respecto del tope (`estadoDelTope`), con
 *      la ventana vencida, vigente y sin abrir;
 *   c) cómo la ingesta mantiene el contador (`contadoresDelMensaje`),
 *      reproducido mensaje por mensaje igual que hace la transacción;
 *   d) el caché con vencimiento de `configuracionFlujo`: vence a los 60 s
 *      exactos, una sola carga en vuelo, y un error no se guarda.
 *
 * Como en la suite de atenciones, se reproduce lo que ESCRIBE la transacción:
 * si eso se desviara de `ingesta.ts`, la prueba dejaría de probar el sistema.
 */
import { describe, expect, it } from 'vitest';
import {
  MS_VENTANA_ATENCION, TOPE_MAXIMO, TOPE_MENSAJES_24H,
  estadoDelTope, topeMensajes24h, ventanaVencida, type MarcasDeTope,
} from '../functions/src/planes.ts';
import { cacheConTtl } from '../functions/src/cache.ts';
import { contadoresDelMensaje, type MarcasDeConteo } from '../functions/src/ingesta.ts';

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const T0 = Date.parse('2026-10-05T14:00:00Z');
const ancla = (ms: number) => ({ toMillis: () => ms });

describe('Qué tope rige para un comercio', () => {
  it('el estándar es 25 y es el mismo para todos: el tope no diferencia planes', () => {
    // Escalonarlo por plan estaba al revés (Analisis/16): el plan barato es el
    // que más barato tiene ser generoso, y un plan caro con un tope menor que
    // el barato es invendible.
    expect(TOPE_MENSAJES_24H).toBe(25);
    expect(topeMensajes24h(undefined)).toEqual({ tope: 25, origen: 'estandar' });
    expect(topeMensajes24h(null)).toEqual({ tope: 25, origen: 'estandar' });
  });

  it('el ajuste por comercio manda sobre el estándar', () => {
    expect(topeMensajes24h(10)).toEqual({ tope: 10, origen: 'cuenta' });
    expect(topeMensajes24h(40)).toEqual({ tope: 40, origen: 'cuenta' });
    expect(topeMensajes24h(5.9).tope).toBe(5);   // se trunca
  });

  it('un ajuste fuera de rango se ignora: nunca «sin tope» por un dato mal cargado', () => {
    for (const malo of [0, -3, TOPE_MAXIMO + 1, Number.NaN, '7', {}, true]) {
      expect(topeMensajes24h(malo), String(malo)).toEqual({ tope: 25, origen: 'estandar' });
    }
  });
});

describe('Dónde está la conversación respecto del tope', () => {
  it('sin ventana abierta se informa el tope entero', () => {
    expect(estadoDelTope({}, 8, T0)).toEqual({
      tope: 8, enviados: 0, restantes: 8, ventanaVenceEn: null, alcanzado: false,
    });
  });

  it('con la ventana vigente descuenta lo enviado y dice cuándo vence', () => {
    const m: MarcasDeTope = { atencionDesde: ancla(T0 - 2 * HORA), mensajesVentana: 5 };
    expect(estadoDelTope(m, 8, T0)).toEqual({
      tope: 8, enviados: 5, restantes: 3, ventanaVenceEn: T0 + 22 * HORA, alcanzado: false,
    });
  });

  it('en el tope exacto quedan 0 (corresponde el único aviso); pasado el aviso, negativo (silencio)', () => {
    const base = { atencionDesde: ancla(T0 - HORA) };
    expect(estadoDelTope({ ...base, mensajesVentana: 8 }, 8, T0)).toMatchObject({ restantes: 0, alcanzado: true });
    expect(estadoDelTope({ ...base, mensajesVentana: 9 }, 8, T0)).toMatchObject({ restantes: -1, alcanzado: true });
  });

  it('una ventana vencida cuenta como nueva: el cliente de ayer no arranca castigado', () => {
    const m: MarcasDeTope = { atencionDesde: ancla(T0 - MS_VENTANA_ATENCION), mensajesVentana: 40 };
    expect(ventanaVencida(m, T0)).toBe(true);
    expect(estadoDelTope(m, 8, T0)).toEqual({
      tope: 8, enviados: 0, restantes: 8, ventanaVenceEn: null, alcanzado: false,
    });
    // Un milisegundo antes de vencer, sigue vigente.
    expect(ventanaVencida({ atencionDesde: ancla(T0 - MS_VENTANA_ATENCION + 1) }, T0)).toBe(false);
  });

  it('tolera basura en el contador', () => {
    const base = { atencionDesde: ancla(T0 - HORA) };
    expect(estadoDelTope({ ...base, mensajesVentana: 'tres' }, 8, T0).enviados).toBe(0);
    expect(estadoDelTope({ ...base, mensajesVentana: -4 }, 8, T0).enviados).toBe(0);
    expect(estadoDelTope({ ...base, mensajesVentana: 2.7 }, 8, T0).enviados).toBe(2);
    expect(estadoDelTope({ atencionDesde: 'ayer', mensajesVentana: 3 }, 8, T0).enviados).toBe(0);
  });
});

/**
 * Reproduce lo que ESCRIBE la transacción de `ingesta.ts` para el contador de
 * la ventana: el ancla solo al abrir una atención, y `mensajesVentana` tal
 * cual lo devuelve `contadoresDelMensaje`.
 */
type Mensaje = 'entrante' | 'saliente'
  | { dir: 'entrante' | 'saliente'; tras?: number; texto?: string };

function reproducir(mensajes: Mensaje[]) {
  let marcas: MarcasDeConteo = {};
  let reloj = T0;
  const contadores: number[] = [];
  for (const m of mensajes) {
    const direccion = typeof m === 'string' ? m : m.dir;
    reloj += typeof m === 'string' ? MINUTO : (m.tras ?? MINUTO);
    const texto = typeof m === 'string' ? 'quiero una cita' : (m.texto ?? 'quiero una cita');
    const conteo = contadoresDelMensaje(marcas, '2026-10', direccion, reloj, texto);
    const ahora = reloj;
    marcas = {
      ...marcas,
      periodoContado: '2026-10',
      respuestasDelPeriodo: conteo.respuestasDelPeriodo,
      mensajesVentana: conteo.mensajesVentana,
      atencionDesde: conteo.atencion ? ancla(ahora) : marcas.atencionDesde,
    };
    contadores.push(conteo.mensajesVentana);
  }
  return { marcas, contadores, reloj };
}

describe('La ingesta mantiene el contador de la ventana', () => {
  it('cuenta solo las respuestas del asistente, no los mensajes del cliente', () => {
    const { contadores } = reproducir(['entrante', 'saliente', 'entrante', 'saliente', 'saliente']);
    expect(contadores).toEqual([0, 1, 1, 2, 3]);
  });

  it('vuelve a cero cuando un mensaje del cliente abre una ventana nueva', () => {
    const { contadores, marcas, reloj } = reproducir([
      'entrante', 'saliente', 'saliente', 'saliente',
      { dir: 'entrante', tras: 25 * HORA },   // pasadas las 24 h: abre otra
      'saliente',
    ]);
    expect(contadores).toEqual([0, 1, 2, 3, 0, 1]);
    expect(estadoDelTope(marcas, 8, reloj)).toMatchObject({ enviados: 1, restantes: 7 });
  });

  it('una cortesía sobre una ventana vencida no abre, pero tampoco arrastra el contador viejo', () => {
    const { contadores } = reproducir([
      'entrante', 'saliente', 'saliente',
      { dir: 'entrante', tras: 25 * HORA, texto: 'gracias' },   // no abre atención
      'saliente',                                               // respuesta a la cortesía
    ]);
    // La ventana venció: la respuesta a la cortesía arranca de cero, no de 2.
    expect(contadores).toEqual([0, 1, 2, 0, 1]);
  });

  it('lo que lee el tope coincide con lo que dejó la ingesta, mensaje a mensaje', () => {
    const tope = 3;
    const { marcas, reloj } = reproducir(['entrante', 'saliente', 'entrante', 'saliente', 'entrante', 'saliente']);
    // Tres respuestas con tope 3: en el turno siguiente quedan 0, o sea el aviso.
    expect(estadoDelTope(marcas, tope, reloj + MINUTO)).toMatchObject({ enviados: 3, restantes: 0, alcanzado: true });
    // El aviso también cuenta: después, negativo → silencio.
    const despues = reproducir(['entrante', 'saliente', 'entrante', 'saliente', 'entrante', 'saliente', 'entrante', 'saliente']);
    expect(estadoDelTope(despues.marcas, tope, despues.reloj + MINUTO)).toMatchObject({ restantes: -1 });
  });

  it('el resto del conteo (atenciones, interacciones) no cambia', () => {
    const c1 = contadoresDelMensaje({}, '2026-10', 'entrante', T0, 'hola quiero turno');
    expect(c1).toMatchObject({ atencion: true, personaNueva: true, interaccion: false, respuestasDelPeriodo: 0, mensajesVentana: 0 });
  });
});

describe('Caché con vencimiento para la configuración del comercio', () => {
  const TTL = 60 * 1000;

  function relojFalso(inicio = T0) {
    let t = inicio;
    return { ahora: () => t, avanzar: (ms: number) => { t += ms; } };
  }

  it('sirve de memoria dentro de los 60 s y vuelve al origen al vencer', async () => {
    const reloj = relojFalso();
    const cache = cacheConTtl<string>(TTL, 500, reloj.ahora);
    let cargas = 0;
    const cargar = async () => { cargas += 1; return `v${cargas}`; };

    expect(await cache.obtener('t', cargar)).toEqual({ valor: 'v1', origen: 'origen', edadMs: 0 });
    reloj.avanzar(TTL - 1);
    expect(await cache.obtener('t', cargar)).toEqual({ valor: 'v1', origen: 'memoria', edadMs: TTL - 1 });
    reloj.avanzar(1);   // 60 s exactos: vencido. El contrato es «no más de 60 s».
    expect(await cache.obtener('t', cargar)).toEqual({ valor: 'v2', origen: 'origen', edadMs: 0 });
    expect(cargas).toBe(2);
  });

  it('dos comercios no se pisan', async () => {
    const cache = cacheConTtl<string>(TTL, 500, relojFalso().ahora);
    expect((await cache.obtener('a', async () => 'de-a')).valor).toBe('de-a');
    expect((await cache.obtener('b', async () => 'de-b')).valor).toBe('de-b');
    expect((await cache.obtener('a', async () => 'otra')).valor).toBe('de-a');
    expect(cache.tamano).toBe(2);
  });

  it('una sola carga en vuelo por clave cuando llegan turnos simultáneos', async () => {
    const cache = cacheConTtl<string>(TTL, 500, relojFalso().ahora);
    let cargas = 0;
    let liberar!: (v: string) => void;
    const cargar = () => { cargas += 1; return new Promise<string>((r) => { liberar = r; }); };
    const p1 = cache.obtener('t', cargar);
    const p2 = cache.obtener('t', cargar);
    liberar('v');
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(cargas).toBe(1);
    expect(r1.valor).toBe('v');
    expect(r2.valor).toBe('v');
  });

  it('un error no se guarda: la llamada siguiente vuelve a intentar', async () => {
    const cache = cacheConTtl<string>(TTL, 500, relojFalso().ahora);
    let cargas = 0;
    const cargar = async () => { cargas += 1; if (cargas === 1) throw new Error('firestore caído'); return 'ok'; };
    await expect(cache.obtener('t', cargar)).rejects.toThrow('firestore caído');
    expect(cache.tamano).toBe(0);
    expect((await cache.obtener('t', cargar)).valor).toBe('ok');
    expect(cargas).toBe(2);
  });

  it('está acotado: al superar el máximo descarta la entrada más vieja', async () => {
    const cache = cacheConTtl<number>(TTL, 2, relojFalso().ahora);
    await cache.obtener('a', async () => 1);
    await cache.obtener('b', async () => 2);
    await cache.obtener('c', async () => 3);
    expect(cache.tamano).toBe(2);
    // `a` se fue; `b` y `c` siguen.
    expect((await cache.obtener('a', async () => 10)).origen).toBe('origen');
    expect((await cache.obtener('c', async () => 30)).origen).toBe('memoria');
  });

  it('invalidar borra una clave o todo', async () => {
    const cache = cacheConTtl<number>(TTL, 500, relojFalso().ahora);
    await cache.obtener('a', async () => 1);
    await cache.obtener('b', async () => 2);
    cache.invalidar('a');
    expect(cache.tamano).toBe(1);
    cache.invalidar();
    expect(cache.tamano).toBe(0);
  });
});
