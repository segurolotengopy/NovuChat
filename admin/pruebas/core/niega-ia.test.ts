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
import { codigoDe, ejecutar, leerFlujo, type J } from '../lib/flujo';

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

// AGENDA MÍNIMA (Bellido, 12/11/2026): la regla de IDENTIDAD de «Armar mensajes» NO es una copia: se DERIVA al armar del bloque «negar ser una IA» de `filtro-redaccion.js`.
// Esta prueba exige que lo que lleva el JSON versionado sea exactamente esa lista del core (si el core la cambia y no se regenera agenda mínima, falla) y que ambas variantes la lleven.
describe('agenda mínima: la regla de identidad es la del core, derivada y no copiada', () => {
  const FILTRO = src('core/texto/filtro-redaccion.js');
  const ini = FILTRO.indexOf('  // negar ser una IA (prohibición 4');
  const marca = "  'carne y hueso',\n";
  const fin = FILTRO.indexOf(marca, ini);
  const lista = new Function(`return [${FILTRO.slice(ini, fin + marca.length)}];`)() as string[];
  it('el bloque del core existe y tiene la forma esperada', () => {
    expect(ini).toBeGreaterThan(0);
    expect(lista.length).toBeGreaterThanOrEqual(8);
    expect(lista).toContain('carne y hueso');
  });
  for (const archivo of ['experimental/agenda-minima/agenda-minima.v0.json', 'experimental/agenda-minima/agenda-minima.prueba.json']) {
    it(`${archivo}: «Armar mensajes» lleva NIEGA_IA_CORE igual a la lista del core y la usa en redaccionValida`, () => {
      const flujo = JSON.parse(readFileSync(join(aqui, '../../../Flujos', archivo), 'utf8')) as { nodes: { name: string; parameters: { jsCode?: string } }[] };
      const codigo = flujo.nodes.find((n) => n.name === 'Armar mensajes')!.parameters.jsCode!;
      expect(codigo).toContain(`const NIEGA_IA_CORE = new RegExp(${JSON.stringify(lista.join('|'))});`);
      expect(codigo).toContain('if (algun(NIEGA_IA_CORE)) return false;');
    });
  }
  it('NIEGA: la regla del core, aplicada a las negaciones de identidad, las atrapa (y no a la admisión honesta)', () => {
    const re = new RegExp(lista.join('|'));
    const norm = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (const mal of ['Soy un ser humano', 'Soy de carne y hueso', 'No soy un programa', 'No soy una máquina', 'No soy una IA, soy una persona real', 'No soy un bot']) expect(re.test(norm(mal)), mal).toBe(true);
    for (const bien of ['Soy la asistente virtual, una inteligencia artificial', 'Tengo estos horarios para el jueves']) expect(re.test(norm(bien)), bien).toBe(false);
  });
});
