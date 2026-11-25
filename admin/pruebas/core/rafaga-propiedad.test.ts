/**
 * LA RÁFAGA — PROPIEDAD: ningún texto se pierde ni se responde dos veces, aunque cada ejecución vea una lista distinta.
 *
 * Cada ejecución consulta en SU momento (ms propio + espera) y recibe lo que existía entonces, no la lista final. Aquí se simula así,
 * para TODAS las secuencias de mensajes de un teléfono con saltos en {0, 200, 1000, 1500, 1800, 3000} ms y con medios (audio),
 * textos con número oculto ([nº]) y marcas de saliente en cualquier posición:
 *   - cada texto que ejecuta el nodo (agrupable o con [nº]) aparece EXACTAMENTE UNA VEZ entre los textos respondidos por todas las ejecuciones;
 *   - lo que responde un grupo es la unión cronológica de sus textos (el propio crudo, los ajenos como los guardó el servidor);
 *   - el servidor entrega como mucho 6 entradas: las secuencias de la prueba caben (el residual de 6 o más seguidos está en docs/arquitectura/rafagas.md).
 * Sin emulador: ejecuta el cuerpo real del nodo con `vm.compileFunction`.
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
interface Mensaje { clase: Clase; id: string; ms: number; crudo: string; guardado: Entrada }

function armar(clases: Clase[], saltos: number[]): Mensaje[] {
  let ms = 100000;
  return clases.map((clase, i) => {
    if (i > 0) ms += saltos[i - 1];
    const id = `m${i + 1}`;
    const guardado: Entrada = clase === 's' ? { idMeta: '', tipo: 'saliente', texto: '', ms }
      : clase === 'a' ? { idMeta: id, tipo: 'audio', texto: '', ms }
      : clase === 'n' ? { idMeta: id, tipo: 'text', texto: `mi cel es [nº] ${id}`, ms }
      : { idMeta: id, tipo: 'text', texto: `texto ${id}`, ms };
    return { clase, id, ms, crudo: clase === 'n' ? `mi cel es 70000000 ${id}` : `texto ${id}`, guardado };
  });
}

/** Lo que responde cada ejecución (una por cada texto), con su propia vista: lo escrito hasta ms propio + espera, las últimas 6 entradas. */
function responder(mensajes: Mensaje[], esperaSeg: number): { id: string; salida: { accion: string; ids: string[]; texto?: string } | null }[] {
  const resultado: { id: string; salida: { accion: string; ids: string[]; texto?: string } | null }[] = [];
  for (const m of mensajes) {
    if (m.clase !== 't' && m.clase !== 'n') continue;
    const vista = mensajes.filter((x) => x.ms <= m.ms + esperaSeg * 1000).map((x) => x.guardado).slice(-6);
    const entrada = { mensajeId: m.id, userInput: m.crudo, tipo: 'text', from: '59170000000' };
    const stub = ($: string) => ({ first: () => ({ json: $ === '¿Esperar ráfaga?' ? entrada : { esperaRafagaSeg: esperaSeg } }) });
    const salida = nodo({ all: () => [{ json: { rafaga: { v: 1, fragmentos: vista } } }] }, stub, ...SIN);
    resultado.push({ id: m.id, salida: salida.length ? { accion: salida[0].json.rafaga.accion, ids: salida[0].json.rafaga.ids, texto: salida[0].json.textoDelTurno } : null });
  }
  return resultado;
}

function comprobar(mensajes: Mensaje[], esperaSeg: number, contexto: string): void {
  const respuestas = responder(mensajes, esperaSeg);
  const respondidos: string[] = [];
  for (const r of respuestas) {
    if (!r.salida) continue;
    respondidos.push(...r.salida.ids);
    // Quien responde es el último de su grupo, y el grupo es contiguo entre los textos agrupables.
    expect(r.salida.ids[r.salida.ids.length - 1] || r.id, contexto).toBe(r.id);
    if (r.salida.accion === 'agrupado') {
      const texto = r.salida.ids.map((id) => { const m = mensajes.find((x) => x.id === id)!; return id === r.id ? m.crudo : m.guardado.texto; }).join('\n');
      expect(r.salida.texto, contexto).toBe(texto);
    }
  }
  const ejecutan = mensajes.filter((m) => m.clase === 't' || m.clase === 'n').map((m) => m.id);
  expect([...respondidos].sort(), contexto).toEqual([...ejecutan].sort());
}

const SALTOS = [0, 200, 1000, 1500, 1800, 3000];
function* productos<T>(valores: T[], largo: number): Generator<T[]> {
  if (largo === 0) { yield []; return; }
  for (const resto of productos(valores, largo - 1)) for (const v of valores) yield [v, ...resto];
}
const describir = (clases: Clase[], saltos: number[]) => `${clases.join('')} saltos=${saltos.join(',')}`;

describe('rafaga: propiedad (cada texto, exactamente una respuesta; cada ejecución con su vista)', () => {
  it('todas las secuencias de 1 a 4 mensajes con cualquier mezcla de texto, [nº], audio y saliente, espera 2 s', () => {
    let casos = 0;
    for (let largo = 1; largo <= 4; largo++) {
      for (const clases of productos<Clase>(['t', 'n', 'a', 's'], largo)) {
        for (const saltos of productos(SALTOS, largo - 1)) { comprobar(armar(clases, saltos), 2, describir(clases, saltos)); casos++; }
      }
    }
    expect(casos).toBeGreaterThan(50000);
  });

  it('secuencias de 5 mensajes: todo texto, y con UN medio, [nº] o saliente en cualquier posición, espera 2 s', () => {
    let casos = 0;
    const base: Clase[] = ['t', 't', 't', 't', 't'];
    const variantes: Clase[][] = [base];
    for (let i = 0; i < 5; i++) for (const c of ['n', 'a', 's'] as Clase[]) variantes.push(base.map((x, j) => (j === i ? c : x)));
    for (const clases of variantes) for (const saltos of productos(SALTOS, 4)) { comprobar(armar(clases, saltos), 2, describir(clases, saltos)); casos++; }
    expect(casos).toBe(16 * 1296);
  });

  it('espera de 1 s (G = 500) y de 5 s (G = 4500): secuencias de 1 a 3 mensajes con todas las mezclas', () => {
    const saltos = [0, 200, 500, 600, 1000, 3000, 4500, 4600, 9000];
    for (const espera of [1, 5]) {
      for (let largo = 1; largo <= 3; largo++) {
        for (const clases of productos<Clase>(['t', 'n', 'a', 's'], largo)) {
          for (const s of productos(saltos, largo - 1)) comprobar(armar(clases, s), espera, `espera ${espera}: ${describir(clases, s)}`);
        }
      }
    }
  });

  it('el caso del revisor (A 0, B 1000, C 2800, G = 1500) con la vista propia de cada ejecución', () => {
    const mensajes = armar(['t', 't', 't'], [1000, 1800]);
    const respuestas = responder(mensajes, 2);
    expect(respuestas.map((r) => r.salida?.ids ?? null)).toEqual([null, ['m1', 'm2'], ['m3']]);
  });

  it('seis textos seguidos a 200 ms: el servidor entrega las seis y responde una sola vez; con la lista truncada a 6 el residual es declarado', () => {
    const mensajes = armar(['t', 't', 't', 't', 't', 't'], [200, 200, 200, 200, 200]);
    const r = responder(mensajes, 2).filter((x) => x.salida);
    expect(r).toHaveLength(1);
    expect(r[0].salida!.ids).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
  });
});
