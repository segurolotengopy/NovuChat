/**
 * PROHIBICIÓN 4 EN CÓDIGO, EN LAS TRES VARIANTES: el agente no niega ser una IA.
 *
 * Hasta el 02/10/2026 solo la variante de venta y la de captación tenían la red
 * `NIEGA_IA`; la de reservas (Demo A) dependía del prompt, y un prompt
 * no es una barrera. Esta suite exige que la expresión sea IDÉNTICA (fuente) en
 * las tres, y corre el código real de `Procesar respuesta` de reservas, el que
 * está en el JSON del Demo A.
 *
 * Corrige texto dentro del mismo mensaje: 0 mensajes agregados.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { codigoDe, ejecutar, leerFlujo, type Flujo, type J } from '../lib/flujo';
import { flujosDeProduccion } from '../lib/flujos-de-cliente';
import { atiendeCliente, expresionNiegaIaDeCore, fuenteDeNiegaIa } from './migracion/comprobaciones';
import { problemasDeRegla } from './migracion/excepciones';

const aqui = dirname(fileURLToPath(import.meta.url));
const src = (ruta: string): string => readFileSync(join(aqui, '../../../Flujos/src', ruta), 'utf8');
const regex = (codigo: string): string => {
  const l = codigo.split('\n').find((x) => x.trimStart().startsWith('const NIEGA_IA'));
  if (!l) throw new Error('sin NIEGA_IA');
  return l.trim();
};

const RESERVAS = src('core/procesar-respuesta.js');
const VENTA = src('core/venta/procesar-respuesta.js');
const CAPTACION = src('core/captacion/procesar-respuesta.js');

describe('NIEGA_IA: la misma expresión en las tres variantes', () => {
  it('reservas, venta y captación la declaran con la misma fuente', () => {
    expect(regex(RESERVAS)).toBe(regex(VENTA));
    expect(regex(CAPTACION)).toBe(regex(VENTA));
  });
});

const CFG: J = { nombreAsistente: 'Sofía', nombreNegocio: 'Clínica', senaActiva: '', funcionarios: '[]' };
const ENTRADA: J[] = [{ from: '59170000001', nombrePerfil: 'Ana', userInput: 'eres un bot?' }];

const corre = (codigo: string, output: string): J =>
  ejecutar(codigo, [{ output }], { 'Normalizar entrada': ENTRADA, 'Config del negocio': [CFG] })[0]!;

// Quita el bloque (declaración y uso) para la contraprueba.
const SIN_BLOQUE = (codigo: string): string => codigo
  .replace(/\n\s*const NIEGA_IA = .*\n/, '\n')
  .replace(/\n\s*if \(NIEGA_IA\.test\(respuesta\)\) \{[\s\S]*?avisos\.push\('correccion_ia'\);\n\s*\}\n/, '\n');

describe.each([
  ['Demo A', 'demo-a-agendamiento.json'],
])('reservas (%s): lo que corre en el JSON', (_n, archivo) => {
  const codigo = codigoDe(leerFlujo(archivo), 'Procesar respuesta');

  it('«No soy un bot, soy Sofía» se corrige y deja el aviso', () => {
    const r = corre(codigo, 'No soy un bot, soy Sofía. ¿En qué te ayudo?');
    expect(String(r['respuesta'])).toContain('sí, soy Sofía, un asistente virtual con inteligencia artificial');
    expect(String(r['respuesta'])).not.toMatch(/no soy un bot/i);
    expect(r['avisos']).toContain('correccion_ia');
  });

  it('«no soy una IA» también se corrige', () => {
    const r = corre(codigo, 'Tranquilo, no soy una IA. Dime la hora.');
    expect(String(r['respuesta'])).not.toMatch(/no soy una IA/i);
    expect(r['avisos']).toContain('correccion_ia');
  });

  it('«Soy un asistente virtual» queda igual y sin aviso', () => {
    const r = corre(codigo, 'Soy un asistente virtual. ¿En qué te ayudo?');
    expect(String(r['respuesta'])).toBe('Soy un asistente virtual. ¿En qué te ayudo?');
    expect(r['avisos']).not.toContain('correccion_ia');
  });

  it('contraprueba: sin el bloque, la negación pasa al cliente', () => {
    const sin = SIN_BLOQUE(codigo);
    expect(sin).not.toContain('NIEGA_IA');
    const r = corre(sin, 'No soy un bot, soy Sofía.');
    expect(String(r['respuesta'])).toMatch(/no soy un bot/i);
    expect(r['avisos']).not.toContain('correccion_ia');
  });
});

// ---------------------------------------------------------------------------
// M5 de la migración (etapa 0, 12/11/2026): ESTÁTICO, de dónde sale la red NIEGA_IA de cada flujo que atiende a un cliente.
// ---------------------------------------------------------------------------

const nodoCode = (jsCode: string) => ({ name: 'N', type: 'n8n-nodes-base.code', parameters: { jsCode } });
const flujoCon = (...codigos: string[]): Flujo => ({ name: 'x', nodes: codigos.map(nodoCode), connections: {} }) as unknown as Flujo;
const CORE = expresionNiegaIaDeCore();

describe('M5: todo flujo que atiende a un cliente toma NIEGA_IA de core, o tiene excepción', () => {
  it('la expresión de core se lee del archivo y es la de las tres variantes', () => {
    expect(CORE).toMatch(/^\/.*\/i$/);
    expect(regex(VENTA)).toContain(CORE);
    expect(regex(CAPTACION)).toContain(CORE);
  });

  it('cada flujo de producción que reporta el mensaje entrante: la expresión es la de core, o hay excepción; ninguna excepción sobra', () => {
    const atienden = flujosDeProduccion().filter((a) => atiendeCliente(leerFlujo(a)));
    expect(atienden.length).toBeGreaterThan(10);
    const hoy = new Map(atienden.map((a) => [a, fuenteDeNiegaIa(leerFlujo(a), CORE) === 'core' ? [] : ['NIEGA_IA']]));
    expect(problemasDeRegla('niega-ia', hoy)).toEqual([]);
  });

  it('contraprueba: core pasa; una copia renombrada IDÉNTICA pasa; una copia distinta es «otra»; sin expresión es «ninguna»', () => {
    expect(fuenteDeNiegaIa(flujoCon(`const NIEGA_IA = ${CORE};`), CORE)).toBe('core');
    expect(fuenteDeNiegaIa(flujoCon(`const X_NIEGA_IA = ${CORE};`), CORE)).toBe('core');
    expect(fuenteDeNiegaIa(flujoCon('const EV_NIEGA_IA = /\\bhumano\\b/i;'), CORE)).toBe('otra');
    expect(fuenteDeNiegaIa(flujoCon(`const NIEGA_IA = ${CORE.replace('soy', 'sos')};`), CORE)).toBe('otra');
    expect(fuenteDeNiegaIa(flujoCon('return [];'), CORE)).toBe('ninguna');
  });

  it('contraprueba: un flujo sin la red y sin excepción falla; con excepción pasa; la excepción de un flujo que ya la tiene sobra', () => {
    const exc = { 'a.json#niega-ia#NIEGA_IA': { dueno: 'x', vence: '2027-01-31', motivo: 'm', desde: '2026-11-12' } };
    expect(problemasDeRegla('niega-ia', new Map([['a.json', ['NIEGA_IA']]]), {})).toHaveLength(1);
    expect(problemasDeRegla('niega-ia', new Map([['a.json', ['NIEGA_IA']]]), exc)).toEqual([]);
    expect(problemasDeRegla('niega-ia', new Map([['a.json', []]]), exc)).toEqual([expect.stringContaining('SOBRA')]);
  });
});
