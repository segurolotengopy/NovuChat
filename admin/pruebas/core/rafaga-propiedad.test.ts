/**
 * LA RÁFAGA — PROPIEDAD: qué se responde cuando cada ejecución ve una lista distinta, con retraso de escritura y con consultas que fallan.
 *
 * Cada ejecución consulta en SU momento (ms propio + espera) y recibe lo que el servidor le entrega según el contrato RELATIVO A SU MENSAJE:
 * hasta 5 predecesores + el propio + hasta 3 sucesores (con marcas de saliente y medios), solo lo ya visible entonces. Se ejecuta el cuerpo
 * real del nodo con `vm.compileFunction`. Sin emulador.
 *
 * Qué se afirma:
 *   - SIN fallas ni retraso: cada texto aparece EXACTAMENTE UNA vez entre los respondidos (secuencias de 1 a 5 enumeradas, de 7 a 9 sorteadas).
 *   - CON un retraso de escritura de hasta 500 ms por entrada (semilla fija): lo mismo (el margen de 500 ms existe para eso).
 *   - CON ejecuciones cuya consulta FALLA (responden solo): un texto se pierde SOLO si es el caso declarado (la ejecución que debía responder
 *     su grupo falló, o el grupo es de 7 o más textos y quedó fuera de la ventana de 5 predecesores); se duplica SOLO si la ejecución de ese
 *     mismo texto falló. Nada más. La predicción es exacta, en los dos sentidos.
 *   - Un álbum de 6 o más entradas posterior a mi mensaje no cambia mi decisión (depende solo de mi vecino siguiente).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { GLOBALES_FUERA_DEL_SANDBOX } from '../lib/flujo';

const CODIGO = readFileSync(join(__dirname, '../../../Flujos/src/core/rafaga/agrupar-rafaga.js'), 'utf8');
const nodo = vm.compileFunction(CODIGO, ['$input', '$', ...GLOBALES_FUERA_DEL_SANDBOX]) as (...a: unknown[]) => { json: Record<string, any> }[];
const SIN = GLOBALES_FUERA_DEL_SANDBOX.map(() => undefined);

type Clase = 't' | 'n' | 'a' | 's'; // texto, texto con número oculto, audio, marca de saliente
interface Entrada { idMeta: string; tipo: string; texto: string; ms: number }
interface Mensaje { clase: Clase; id: string; ms: number; crudo: string; guardado: Entrada; retraso: number }
interface Decision { accion: string; ids: string[]; texto?: string }
const PREDECESORES = 5;
const SUCESORES = 3;

const ordenar = (a: Entrada, b: Entrada) => (a.ms - b.ms) || (a.idMeta < b.idMeta ? -1 : a.idMeta > b.idMeta ? 1 : 0);

/** Un generador determinista (mulberry32): misma semilla, misma corrida. */
function semilla(s: number): () => number {
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function armar(clases: Clase[], saltos: number[], alea?: () => number): Mensaje[] {
  let ms = 100000;
  return clases.map((clase, i) => {
    if (i > 0) ms += saltos[i - 1];
    const id = `m${i + 1}`;
    const guardado: Entrada = clase === 's' ? { idMeta: '', tipo: 'saliente', texto: '', ms }
      : clase === 'a' ? { idMeta: id, tipo: 'audio', texto: '', ms }
      : clase === 'n' ? { idMeta: id, tipo: 'text', texto: `mi cel es [nº] ${id}`, ms }
      : { idMeta: id, tipo: 'text', texto: `texto ${id}`, ms };
    return { clase, id, ms, crudo: clase === 'n' ? `mi cel es 70000000 ${id}` : `texto ${id}`, guardado, retraso: alea ? Math.floor(alea() * 501) : 0 };
  });
}

/** La vista de la ejecución de `m`: lo ya escrito (con retraso) a ms propio + espera, recortado al contrato (5 predecesores, yo, 3 sucesores). */
function vistaDe(mensajes: Mensaje[], m: Mensaje, esperaSeg: number, tope = { pred: PREDECESORES, suc: SUCESORES }): Entrada[] {
  const visibles = mensajes.filter((x) => x === m || x.ms + x.retraso <= m.ms + esperaSeg * 1000).map((x) => x.guardado).sort(ordenar);
  const i = visibles.indexOf(m.guardado);
  return visibles.slice(Math.max(0, i - tope.pred), i + 1 + tope.suc);
}

function decidir(m: Mensaje, vista: Entrada[], esperaSeg: number, falla: boolean): Decision | null {
  const entrada = { mensajeId: m.id, userInput: m.crudo, tipo: 'text', from: '59170000000' };
  const stub = ($: string) => ({ first: () => ({ json: $ === '¿Esperar ráfaga?' ? entrada : { esperaRafagaSeg: esperaSeg } }) });
  const respuesta = falla ? { error: { message: 'timeout' } } : { rafaga: { v: 1, fragmentos: vista } };
  const salida = nodo({ all: () => [{ json: respuesta }] }, stub, ...SIN);
  return salida.length ? { accion: salida[0].json.rafaga.accion, ids: salida[0].json.rafaga.ids, texto: salida[0].json.textoDelTurno } : null;
}

const ejecutan = (mensajes: Mensaje[]) => mensajes.filter((m) => m.clase === 't' || m.clase === 'n');

function responder(mensajes: Mensaje[], esperaSeg: number, fallan = new Set<string>()): { m: Mensaje; d: Decision | null }[] {
  return ejecutan(mensajes).map((m) => ({ m, d: decidir(m, vistaDe(mensajes, m, esperaSeg), esperaSeg, fallan.has(m.id)) }));
}

/** El modelo: orden global, componentes por arista y, de ahí, qué se responde y qué se pierde (independiente del nodo). */
function modelo(mensajes: Mensaje[], esperaSeg: number, fallan: Set<string>) {
  const salto = esperaSeg * 1000 - 500;
  const orden = mensajes.map((m) => m.guardado).sort(ordenar);
  const agrupable = (e: Entrada) => e.tipo === 'text' && e.idMeta !== '' && !e.texto.includes('[nº]');
  const final = new Map<string, number>(); // id → posición del último de su componente
  for (let i = orden.length - 1; i >= 0; i--) {
    if (!agrupable(orden[i])) continue;
    const sigue = i + 1 < orden.length && agrupable(orden[i + 1]) && orden[i + 1].ms - orden[i].ms <= salto;
    final.set(orden[i].idMeta, sigue ? final.get(orden[i + 1].idMeta)! : i);
  }
  const respondidoPor = (id: string): boolean => {
    const i = orden.findIndex((e) => e.idMeta === id);
    if (fallan.has(id)) return true; // responde solo
    const fin = final.get(id)!;
    if (fin === i) return true; // es el último: responde
    const ultimo = orden[fin].idMeta;
    return !fallan.has(ultimo) && fin - i <= PREDECESORES; // lo cubre el último, si no falló y lo alcanza su ventana
  };
  return { orden, agrupable, final, respondidoPor };
}

function comprobarSinFallas(mensajes: Mensaje[], esperaSeg: number, contexto: string): void {
  const respuestas = responder(mensajes, esperaSeg);
  const respondidos: string[] = [];
  for (const { m, d } of respuestas) {
    if (!d) continue;
    respondidos.push(...d.ids);
    expect(d.ids[d.ids.length - 1], contexto).toBe(m.id);
    if (d.accion === 'agrupado') {
      const esperado = d.ids.map((id) => (id === m.id ? m.crudo : mensajes.find((x) => x.id === id)!.guardado.texto)).join('\n');
      expect(d.texto, contexto).toBe(esperado);
    }
  }
  expect([...respondidos].sort(), contexto).toEqual(ejecutan(mensajes).map((m) => m.id).sort());
}

function comprobarConFallas(mensajes: Mensaje[], esperaSeg: number, fallan: Set<string>, contexto: string): void {
  const cuentas = new Map<string, number>();
  for (const { d } of responder(mensajes, esperaSeg, fallan)) for (const id of d?.ids ?? []) cuentas.set(id, (cuentas.get(id) ?? 0) + 1);
  const mod = modelo(mensajes, esperaSeg, fallan);
  for (const m of ejecutan(mensajes)) {
    const veces = cuentas.get(m.id) ?? 0;
    const agrupable = mod.agrupable(m.guardado);
    const respondido = !agrupable || mod.respondidoPor(m.id);
    expect(veces >= 1, `${contexto}: ${m.id} ${respondido ? 'tenía que responderse' : 'se declara perdido'} (respondido ${veces} veces)`).toBe(respondido);
    // Duplicado solo si la ejecución de ese texto falló (responde solo) y otra lo incluyó.
    if (veces > 1) expect(fallan.has(m.id), `${contexto}: ${m.id} duplicado sin que su consulta haya fallado`).toBe(true);
  }
}

const SALTOS = [0, 200, 1000, 1500, 1800, 3000];
function* productos<T>(valores: T[], largo: number): Generator<T[]> {
  if (largo === 0) { yield []; return; }
  for (const resto of productos(valores, largo - 1)) for (const v of valores) yield [v, ...resto];
}
const describir = (c: Clase[], s: number[]) => `${c.join('')} saltos=${s.join(',')}`;
const sortear = <T>(alea: () => number, v: T[]): T => v[Math.floor(alea() * v.length)];

describe('rafaga: propiedad sin fallas (cada texto, exactamente una respuesta; cada ejecución con SU vista)', () => {
  it('todas las secuencias de 1 a 4 mensajes con cualquier mezcla de texto, [nº], audio y saliente, espera 2 s', () => {
    let casos = 0;
    for (let largo = 1; largo <= 4; largo++) {
      for (const clases of productos<Clase>(['t', 'n', 'a', 's'], largo)) {
        for (const saltos of productos(SALTOS, largo - 1)) { comprobarSinFallas(armar(clases, saltos), 2, describir(clases, saltos)); casos++; }
      }
    }
    expect(casos).toBeGreaterThan(50000);
  });

  it('secuencias de 5 mensajes: todo texto, y con UN medio, [nº] o saliente en cualquier posición, espera 2 s', () => {
    let casos = 0;
    const base: Clase[] = ['t', 't', 't', 't', 't'];
    const variantes: Clase[][] = [base];
    for (let i = 0; i < 5; i++) for (const c of ['n', 'a', 's'] as Clase[]) variantes.push(base.map((x, j) => (j === i ? c : x)));
    for (const clases of variantes) for (const saltos of productos(SALTOS, 4)) { comprobarSinFallas(armar(clases, saltos), 2, describir(clases, saltos)); casos++; }
    expect(casos).toBe(16 * 1296);
  });

  it('espera de 1 s (G = 500) y de 5 s (G = 4500): secuencias de 1 a 3 mensajes con todas las mezclas', () => {
    const saltos = [0, 200, 500, 600, 1000, 3000, 4500, 4600, 9000];
    for (const espera of [1, 5]) {
      for (let largo = 1; largo <= 3; largo++) {
        for (const clases of productos<Clase>(['t', 'n', 'a', 's'], largo)) {
          for (const s of productos(saltos, largo - 1)) comprobarSinFallas(armar(clases, s), espera, `espera ${espera}: ${describir(clases, s)}`);
        }
      }
    }
  });

  it('de 7 a 9 entradas con separadores (sorteo de semilla fija): cada texto, una vez, mientras ningún grupo pase de 6', () => {
    const alea = semilla(20261125);
    let casos = 0;
    while (casos < 6000) {
      const largo = 7 + Math.floor(alea() * 3);
      const clases = Array.from({ length: largo }, () => { const r = alea(); return (r < 0.5 ? 't' : r < 0.62 ? 'n' : r < 0.82 ? 'a' : 's') as Clase; });
      const saltos = Array.from({ length: largo - 1 }, () => sortear(alea, SALTOS));
      const mensajes = armar(clases, saltos);
      // Solo se afirma «exactamente una vez» si el modelo no declara pérdidas (un grupo de 7 o más). El resto se prueba abajo.
      const mod = modelo(mensajes, 2, new Set());
      if (!ejecutan(mensajes).every((m) => !mod.agrupable(m.guardado) || mod.respondidoPor(m.id))) continue;
      comprobarSinFallas(mensajes, 2, describir(clases, saltos));
      casos++;
    }
  });

  it('con retraso de escritura de hasta 500 ms por entrada (semilla fija): el margen de 500 ms basta, nada se pierde ni se repite', () => {
    const alea = semilla(99);
    for (let i = 0; i < 8000; i++) {
      const largo = 2 + Math.floor(alea() * 8);
      const clases = Array.from({ length: largo }, () => { const r = alea(); return (r < 0.55 ? 't' : r < 0.65 ? 'n' : r < 0.85 ? 'a' : 's') as Clase; });
      const saltos = Array.from({ length: largo - 1 }, () => sortear(alea, [0, 200, 1000, 1400, 1500, 1800, 3000]));
      const mensajes = armar(clases, saltos, alea);
      const mod = modelo(mensajes, 2, new Set());
      if (!ejecutan(mensajes).every((m) => !mod.agrupable(m.guardado) || mod.respondidoPor(m.id))) continue;
      comprobarSinFallas(mensajes, 2, `retraso ${mensajes.map((m) => m.retraso).join(',')}: ${describir(clases, saltos)}`);
    }
  });

  it('el caso del revisor (A 0, B 1000, C 2800, G = 1500): A calla, B responde «a»+«b», C responde solo', () => {
    const r = responder(armar(['t', 't', 't'], [1000, 1800]), 2);
    expect(r.map((x) => x.d?.ids ?? null)).toEqual([null, ['m1', 'm2'], ['m3']]);
  });
});

describe('rafaga: propiedad con consultas que FALLAN (responden solo)', () => {
  it('pérdida y duplicado exactamente donde se declaran, en secuencias de 2 a 9 (semilla fija; fallan ~30% de las consultas)', () => {
    const alea = semilla(7);
    let conPerdida = 0; let conDuplicado = 0;
    for (let i = 0; i < 12000; i++) {
      const largo = 2 + Math.floor(alea() * 8);
      const clases = Array.from({ length: largo }, () => { const r = alea(); return (r < 0.6 ? 't' : r < 0.68 ? 'n' : r < 0.85 ? 'a' : 's') as Clase; });
      const saltos = Array.from({ length: largo - 1 }, () => sortear(alea, SALTOS));
      const mensajes = armar(clases, saltos, alea);
      const fallan = new Set(ejecutan(mensajes).filter(() => alea() < 0.3).map((m) => m.id));
      comprobarConFallas(mensajes, 2, fallan, `${describir(clases, saltos)} fallan=${[...fallan].join(',')}`);
      const mod = modelo(mensajes, 2, fallan);
      if (ejecutan(mensajes).some((m) => mod.agrupable(m.guardado) && !mod.respondidoPor(m.id))) conPerdida++;
      const cuentas = new Map<string, number>();
      for (const { d } of responder(mensajes, 2, fallan)) for (const id of d?.ids ?? []) cuentas.set(id, (cuentas.get(id) ?? 0) + 1);
      if ([...cuentas.values()].some((v) => v > 1)) conDuplicado++;
    }
    // La prueba no es vacía: se ven las dos cosas que se declaran.
    expect(conPerdida).toBeGreaterThan(100);
    expect(conDuplicado).toBeGreaterThan(100);
  });

  it('H2: si falla la ejecución ANTERIOR, la siguiente repite su texto (se duplica, no se pierde)', () => {
    const mensajes = armar(['t', 't'], [1000]);
    const r = responder(mensajes, 2, new Set(['m1']));
    expect(r[0].d).toMatchObject({ accion: 'solo', ids: ['m1'] });
    expect(r[1].d).toMatchObject({ accion: 'agrupado', ids: ['m1', 'm2'] });
  });

  it('si falla la ejecución que debía RESPONDER el grupo, los textos que calló quedan sin contestar (riesgo declarado)', () => {
    const mensajes = armar(['t', 't'], [1000]);
    const r = responder(mensajes, 2, new Set(['m2']));
    expect(r[0].d).toBeNull();
    expect(r[1].d).toMatchObject({ accion: 'solo', ids: ['m2'] });
  });
});

describe('rafaga: cadenas de 7 o más textos seguidos (riesgo declarado) y álbumes', () => {
  it('de 7 a 9 textos a 200 ms: responde el último con los 6 más recientes; los más viejos quedan sin contestar (la ventana de predecesores es 5)', () => {
    for (let n = 7; n <= 9; n++) {
      const mensajes = armar(Array.from({ length: n }, () => 't' as Clase), Array.from({ length: n - 1 }, () => 200));
      const r = responder(mensajes, 2).filter((x) => x.d);
      expect(r).toHaveLength(1 + 0);
      expect(r[0].d!.ids).toEqual(Array.from({ length: 6 }, (_, k) => `m${n - 5 + k}`));
    }
  });

  it('seis textos seguidos caben: una sola respuesta con los seis', () => {
    const r = responder(armar(Array.from({ length: 6 }, () => 't' as Clase), [200, 200, 200, 200, 200]), 2).filter((x) => x.d);
    expect(r).toHaveLength(1);
    expect(r[0].d!.ids).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
  });

  it('un álbum de 6 a 9 entradas POSTERIOR a mi mensaje no cambia mi decisión', () => {
    const alea = semilla(31);
    for (let i = 0; i < 3000; i++) {
      const largo = 1 + Math.floor(alea() * 6);
      const clases = [...Array.from({ length: largo - 1 }, () => sortear(alea, ['t', 't', 'n', 'a', 's'] as Clase[])), 't' as Clase];
      const saltos = Array.from({ length: largo - 1 }, () => sortear(alea, SALTOS));
      const album = 6 + Math.floor(alea() * 4);
      const sin = armar(clases, saltos);
      const con = armar([...clases, ...Array.from({ length: album }, () => 'a' as Clase)], [...saltos, ...Array.from({ length: album }, () => 100)]);
      const yo = sin[sin.length - 1];
      const antes = decidir(yo, vistaDe(sin, yo, 2), 2, false);
      const despues = decidir(con[largo - 1], vistaDe(con, con[largo - 1], 2), 2, false);
      expect(despues, describir(clases, saltos)).toEqual(antes);
    }
  });

  it('el tope de 3 sucesores no cambia ninguna decisión: la regla solo mira a mi vecino siguiente', () => {
    const alea = semilla(5);
    for (let i = 0; i < 4000; i++) {
      const largo = 3 + Math.floor(alea() * 7);
      const clases = Array.from({ length: largo }, () => { const r = alea(); return (r < 0.6 ? 't' : r < 0.7 ? 'n' : r < 0.85 ? 'a' : 's') as Clase; });
      const saltos = Array.from({ length: largo - 1 }, () => sortear(alea, SALTOS));
      const mensajes = armar(clases, saltos);
      for (const m of ejecutan(mensajes)) {
        const acotada = decidir(m, vistaDe(mensajes, m, 2), 2, false);
        const completa = decidir(m, vistaDe(mensajes, m, 2, { pred: PREDECESORES, suc: 99 }), 2, false);
        expect(acotada, `${m.id}: ${describir(clases, saltos)}`).toEqual(completa);
      }
    }
  });
});
