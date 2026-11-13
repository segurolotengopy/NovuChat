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
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { codigoDe, ejecutar, leerFlujo, type Flujo, type J } from '../lib/flujo';
import { flujosDeProduccion } from '../lib/flujos-de-cliente';
import { atiendeCliente, expresionNiegaIaDeCore, expresionNiegaIaNormalizadaDeCore, expresionesNiegaIaDeCore, fuenteDeNiegaIa } from './migracion/comprobaciones';
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

// venta-minima (Q'Taco): el modelo NO escribe frases (solo clasifica), así que la identidad es SIEMPRE el texto fijo del código (`aIdentidad` en `Plan del turno`).
// Esta prueba exige que ese texto cumpla la regla de la prohibición 4 con la MISMA expresión `NIEGA_IA` de la variante de venta, y que detecte la mutación.
describe('NIEGA_IA en venta-minima: el texto fijo de identidad', () => {
  const PLAN = readFileSync(join(aqui, '../../../Flujos/experimental/venta-minima/src/nodos/plan-del-turno.js'), 'utf8');
  const cuerpoIdentidad = (codigo: string): string => {
    const m = /function aIdentidad\(\) \{[\s\S]*?\n\}/.exec(codigo);
    if (!m) throw new Error('sin aIdentidad');
    return m[0];
  };
  // La expresión se toma de la fuente de la variante de venta (no se copia aquí).
  const nuevaRegex = (): RegExp => (0, eval)(regex(VENTA).replace(/^const NIEGA_IA = /, '').replace(/;$/, '')) as RegExp;
  const cumple = (codigo: string): boolean => {
    // El texto que produce `aIdentidad`: se evalúa el propio literal (sustituyendo `negocio()`), no el código fuente. El texto armado COMPLETO se fija en
    // `venta-minima-respuesta-coherente.test.ts` (D0), con la salida real del flujo.
    const arg = /enlace\(([\s\S]*?)\)\]\);/.exec(cuerpoIdentidad(codigo))?.[1] ?? '';
    const c = (0, eval)(`(${arg.replace(/negocio\(\)/g, "'Q Taco'")})`) as string;
    return !nuevaRegex().test(c) && /asistente virtual/.test(c) && /inteligencia artificial/.test(c);
  };
  it('el texto fijo de identidad dice que es un asistente virtual con IA y no niega serlo', () => {
    expect(cumple(PLAN)).toBe(true);
  });
  it('MUTACIÓN: si el texto fijo pasa a negar ser una IA, la prueba falla', () => {
    for (const malo of ['Soy una persona de ', 'No soy un bot de ', 'Hablas con una persona de ']) {
      const mutado = PLAN.replace('Soy un asistente virtual con inteligencia artificial de ', malo);
      expect(mutado).not.toBe(PLAN);
      expect(cumple(mutado), malo).toBe(false);
    }
  });
  it('la pieza común no escribe frases al cliente (ni hay filtro que se pueda saltar)', () => {
    expect(src('core/conversacion/respuesta-coherente.js')).not.toMatch(/rcLeerRespuesta|rcMotivoDeRechazoLibre/);
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
  const lista = (vm.compileFunction(`return [${FILTRO.slice(ini, fin + marca.length)}];`) as () => string[])();
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

// ---------------------------------------------------------------------------
// M5 de la migración (etapa 0, 12/11/2026): ESTÁTICO, de dónde sale la red NIEGA_IA de cada flujo que atiende a un cliente.
// ---------------------------------------------------------------------------

const nodoCode = (jsCode: string) => ({ name: 'N', type: 'n8n-nodes-base.code', parameters: { jsCode } });
const flujoCon = (...codigos: string[]): Flujo => ({ name: 'x', nodes: codigos.map(nodoCode), connections: {} }) as unknown as Flujo;
const CORE = expresionNiegaIaDeCore();
const NORM = expresionNiegaIaNormalizadaDeCore();
const DECLARADAS = expresionesNiegaIaDeCore();

describe('M5: todo flujo que atiende a un cliente toma NIEGA_IA de core, o tiene excepción', () => {
  it('la expresión de core se lee del archivo y es la de las tres variantes', () => {
    expect(CORE).toMatch(/^\/.*\/i$/);
    expect(regex(VENTA)).toContain(CORE);
    expect(regex(CAPTACION)).toContain(CORE);
  });

  it('cada flujo de producción que reporta el mensaje entrante: la expresión es la de core, o hay excepción; ninguna excepción sobra', () => {
    const atienden = flujosDeProduccion().filter((a) => atiendeCliente(leerFlujo(a)));
    expect(atienden.length).toBeGreaterThan(10);
    const hoy = new Map(atienden.map((a) => [a, fuenteDeNiegaIa(leerFlujo(a), DECLARADAS) === 'core' ? [] : ['NIEGA_IA']]));
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

// Etapa 1 (13/11/2026, decisión de Andres «sí, dos declaradas»): core declara DOS expresiones como fuentes; cada flujo lleva una EXACTA, sin importar el nombre de su constante.
describe('M5: las dos expresiones declaradas de core', () => {
  const norm = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  it('son dos, distintas, y la normalizada se lee de su archivo de core', () => {
    expect(DECLARADAS).toEqual([CORE, NORM]);
    expect(NORM).not.toBe(CORE);
    expect(NORM.length).toBe(911);
    expect(src('core/texto/niega-ia-normalizado.js')).toContain(`const NIEGA_IA_NORMALIZADO = ${NORM};`);
  });

  it('la normalizada la llevan, con otro prefijo y el mismo literal, los flujos que la copiaron', () => {
    const atienden = flujosDeProduccion().map((a) => [a, leerFlujo(a)] as const).filter(([, f]) => atiendeCliente(f));
    const conNorm = atienden.filter(([, f]) => f.nodes.some((n) => String(n.parameters?.['jsCode'] ?? '').includes(`_NIEGA_IA = ${NORM};`)));
    expect(conNorm.length).toBeGreaterThanOrEqual(9);
    for (const [a, f] of conNorm) expect(fuenteDeNiegaIa(f, DECLARADAS), a).toBe('core');
  });

  it('contraprueba: el literal normalizado exacto cuenta como core con cualquier nombre; alterado un carácter, o sin expresión, no cuenta', () => {
    expect(fuenteDeNiegaIa(flujoCon(`const WL_NIEGA_IA = ${NORM};`), DECLARADAS)).toBe('core');
    expect(fuenteDeNiegaIa(flujoCon(`const NIEGA_IA = ${NORM};`), DECLARADAS)).toBe('core');
    expect(fuenteDeNiegaIa(flujoCon(`const WL_NIEGA_IA = ${NORM.replace('humano', 'humanos')};`), DECLARADAS)).toBe('otra');
    expect(fuenteDeNiegaIa(flujoCon(`const WL_NIEGA_IA = ${NORM.replace(/\/$/, 'i/')};`), DECLARADAS)).toBe('otra');
    expect(fuenteDeNiegaIa(flujoCon(`const WL_NIEGA_IA = ${CORE.replace('soy', 'sos')};`), DECLARADAS)).toBe('otra');
    expect(fuenteDeNiegaIa(flujoCon('return [];'), DECLARADAS)).toBe('ninguna');
    // Sola, la expresión normalizada no es la de core (compatibilidad con la firma anterior de un solo literal).
    expect(fuenteDeNiegaIa(flujoCon(`const A_NIEGA_IA = ${NORM};`), CORE)).toBe('otra');
  });

  it('comportamiento sobre texto normalizado: las negaciones coinciden y la admisión honesta no', () => {
    const re = (0, eval)(NORM) as RegExp;
    for (const mal of ['no soy un bot', 'no soy una ia', 'no estas hablando con un robot', 'soy una persona real', 'soy de carne y hueso', 'te atiende un humano', 'no es un mensaje automatico', 'es una chica de ventas', 'no responde ninguna inteligencia']) expect(re.test(norm(mal)), mal).toBe(true);
    for (const bien of ['soy la asistente virtual de la clinica', 'soy un asistente virtual con inteligencia artificial', 'tengo estos horarios para el jueves', 'el taxi sale a las ocho', 'tu pedido llega manana']) expect(re.test(norm(bien)), bien).toBe(false);
  });

  it('la de core sigue atrapando lo mismo que antes en texto crudo (no se debilita)', () => {
    const re = (0, eval)(CORE) as RegExp;
    for (const mal of ['No soy un bot, soy Sofía', 'Tranquilo, no soy una IA', 'Soy una persona real']) expect(re.test(mal), mal).toBe(true);
    expect(re.test('Soy un asistente virtual. ¿En qué te ayudo?')).toBe(false);
  });
});
