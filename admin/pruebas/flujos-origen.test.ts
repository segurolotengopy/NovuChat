/**
 * LOS CINCO FLUJOS REPORTAN DE DÓNDE NACIÓ LA CONVERSACIÓN (`Analisis/38` §2).
 *
 * `origen-del-anuncio.test.ts` prueba la mitad del servidor: que la ingesta
 * guarda el origen al abrir la ventana y cuenta `conversacionesPorAnuncio`.
 * Acá se prueba la otra mitad, sin la cual la cifra sería siempre cero: que
 * cada flujo LEE el `referral` que manda Meta y lo REPORTA.
 *
 * SE APLICA A TODOS O A NINGUNO (`CLAUDE.md`, `Analisis/20` §5). Un cliente que
 * no reporte el origen no rompe nada —el servidor lo cuenta como directo— pero
 * baja la fracción medida de toda la cartera, y nadie lo nota: el número sale
 * más bajo, no sale mal. Por eso la lista de flujos es explícita y la prueba
 * falla cuando aparece uno nuevo que no lo hace.
 *
 * COMO EN `flujos-umbrales.test.ts`, el código y las expresiones se extraen del
 * JSON versionado y se EJECUTAN: si alguien edita un nodo en n8n y exporta, la
 * prueba corre el código nuevo, no una copia que se quedó vieja.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Flujo as FlujoCompleto } from './lib/flujo';
import { flujosDeProduccion } from './lib/flujos-de-cliente';
import { atiendeCliente } from './core/migracion/comprobaciones';
import { problemasDeRegla } from './core/migracion/excepciones';

const aqui = dirname(fileURLToPath(import.meta.url));

interface Nodo { name: string; type: string; parameters: Record<string, unknown> }
interface Flujo { nodes: Nodo[] }

/**
 * LOS FLUJOS QUE ATIENDEN A UN CLIENTE FINAL. Los de disparo horario
 * (recordatorios, seguimientos, señas vencidas) no abren conversación: no
 * tienen entrada de WhatsApp que normalizar ni origen que reportar.
 */
const FLUJOS = [
  'demo-a-agendamiento.json',
  'bellido-agendamiento.json',
  'demo-b-venta-cobro.json',
  'novuchat-onboarding.json',
];

const flujo = (archivo: string) =>
  JSON.parse(readFileSync(join(aqui, '../../Flujos/', archivo), 'utf8')) as Flujo;

function nodo(f: Flujo, nombre: string): Nodo {
  const n = f.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`sin nodo ${nombre}`);
  return n;
}

/** Ejecuta el nodo Code con un webhook de WhatsApp armado a mano. */
function normalizar(archivo: string, mensaje: Record<string, unknown>): Record<string, unknown> {
  const codigo = String(nodo(flujo(archivo), 'Normalizar entrada').parameters['jsCode']);
  // El nodo recibe el webhook YA desempaquetado y con la configuración del
  // negocio mezclada al mismo nivel (así lo arma `Config del negocio`): todo lo
  // que no sea una clave del webhook se arrastra como configuración.
  const entrada = [{
    messages: [{ from: '59170000000', id: 'wamid.PRUEBA', type: 'text',
                 text: { body: 'hola' }, ...mensaje }],
    contacts: [{ profile: { name: 'Prueba' } }],
    metadata: { phone_number_id: '100000000000000' },
    nombreNegocio: 'Prueba',
    direccion: '',
    // Lista vacía = se acepta cualquier origen; si no, el nodo descarta el
    // mensaje por prefijo y la prueba no ejercitaría nada.
    prefijosPermitidos: '',
  }];
  const $input = { all: () => entrada.map((json) => ({ json })), first: () => ({ json: entrada[0] }) };
  // La configuración del negocio que el nodo mezcla en su salida. Mínima: lo
  // que se ejercita acá es el origen, no el resto de la normalización.
  const $ = () => ({ first: () => ({ json: entrada[0] }) });
  const fn = vm.compileFunction(codigo, ['$input', '$']) as (i: unknown, r: unknown)
    => { json: Record<string, unknown> }[];
  return fn($input, $)[0].json;
}

/** Evalúa el `jsonBody` del nodo que reporta a la ingesta. */
function reporte(archivo: string, $json: Record<string, unknown>): Record<string, unknown> {
  const cuerpo = String(nodo(flujo(archivo), 'Reportar mensaje (entrante)').parameters['jsonBody']);
  const m = /^=\{\{([\s\S]*)\}\}$/.exec(cuerpo.trim());
  if (!m) throw new Error(`no es una expresión simple: ${cuerpo.slice(0, 60)}`);
  const fn = vm.compileFunction(`return (${m[1]});`, ['$json']) as (j: unknown) => string;
  return JSON.parse(fn($json)) as Record<string, unknown>;
}

/** Lo que Meta agrega al mensaje cuando viene de un anuncio de clic a WhatsApp. */
const REFERRAL = {
  referral: {
    source_type: 'ad',
    source_id: '120200000000000000',
    headline: 'Tratamientos faciales con 20% de descuento',
    source_url: 'https://fb.me/ejemplo',
  },
};

describe.each(FLUJOS)('%s', (archivo) => {
  it('marca `anuncio` cuando Meta manda `referral`', () => {
    expect(normalizar(archivo, REFERRAL)['origen']).toBe('anuncio');
  });

  it('marca `directo` cuando no lo manda', () => {
    expect(normalizar(archivo, {})['origen']).toBe('directo');
  });

  it('el origen VIAJA a la ingesta, no se queda en el flujo', () => {
    // El defecto que este cambio corrige era exactamente este: el flujo leía el
    // anuncio, lo usaba en el prompt, y no lo reportaba nunca.
    expect(reporte(archivo, normalizar(archivo, REFERRAL))).toMatchObject({ origen: 'anuncio' });
    expect(reporte(archivo, normalizar(archivo, {}))).toMatchObject({ origen: 'directo' });
  });

  it('un flujo sin el campo reporta `directo`, nunca `anuncio`', () => {
    // Respaldo del respaldo: si `Normalizar entrada` dejara de poner el campo
    // —por un merge, por una edición en n8n— el reporte no puede inventar un
    // anuncio. Sobreestimar la fracción por campaña infla el margen esperado.
    expect(reporte(archivo, { from: '59170000000', tipo: 'text', userInput: 'hola' }))
      .toMatchObject({ origen: 'directo' });
  });

  it('el origen no trae el titular ni la URL de la campaña', () => {
    // Para la cifra alcanza con SI vino de un anuncio. El titular y la URL son
    // datos de la campaña del comercio y no tienen por qué viajar al servidor.
    const cuerpo = reporte(archivo, normalizar(archivo, REFERRAL));
    const texto = JSON.stringify(cuerpo);
    expect(texto).not.toContain('fb.me');
    expect(texto).not.toContain('descuento');
  });
});

describe('La lista de flujos', () => {
  it('cubre TODOS los que reportan un mensaje entrante', () => {
    // Si mañana se agrega un flujo de atención y no reporta el origen, la
    // fracción medida baja para toda la cartera y nadie lo nota: el número sale
    // más bajo, no sale mal. Esta prueba es la que obliga a agregarlo a la
    // lista —y, al agregarlo, a que pase las cinco de arriba—.
    const enDisco = readdirSync(join(aqui, '../../Flujos'))
      .filter((f) => f.endsWith('.json'))
      .filter((f) => flujo(f).nodes.some((n) => n.name === 'Reportar mensaje (entrante)'));
    expect(enDisco.sort()).toEqual([...FLUJOS].sort());
  });
});

// ---------------------------------------------------------------------------
// Migración (etapa 0, 12/11/2026): la lista única. Las pruebas de arriba siguen IGUAL sobre su lista de cuatro. Todo OTRO flujo de producción
// que atiende a un cliente (reporta el mensaje entrante) debe pasar las mismas comprobaciones o estar en la lista de excepciones con
// vencimiento (decisión D2 de Andres): ninguno puede quedar fuera de las dos.
// ---------------------------------------------------------------------------

/** Las mismas cuatro comprobaciones de arriba, sobre cualquier flujo; una falla (o un nodo que no existe) es «no la cumple». */
function cumpleElOrigen(archivo: string): boolean {
  // «No tiene los nodos» es «no la cumple»; cualquier OTRO error (código del nodo que revienta, JSON ilegible) NO se traga: hace fallar la prueba.
  const nodos = flujo(archivo).nodes.map((n) => n.name);
  if (!nodos.includes('Normalizar entrada') || !nodos.includes('Reportar mensaje (entrante)')) return false;
  // Tampoco la cumple, para esta comprobación, el reporte que no es una expresión simple sobre `$json` (usa `$(...)`, `$node`, `$input`…): el arnés de arriba
  // no puede evaluarlo y no hay forma de comprobar que el origen viaje. Es una limitación declarada del arnés, no un error que se esconda.
  const cuerpo = String(nodo(flujo(archivo), 'Reportar mensaje (entrante)').parameters['jsonBody']);
  if (!/^=\{\{[\s\S]*\}\}$/.test(cuerpo.trim()) || /\$\(|\$node|\$input|\$items|\$env|\$vars|\$execution|\$workflow|\$now|\$today/.test(cuerpo)) return false;
  {
    const anuncio = normalizar(archivo, REFERRAL);
    const directo = normalizar(archivo, {});
    const viajaAnuncio = reporte(archivo, anuncio);
    const viajaDirecto = reporte(archivo, directo);
    const sinCampo = reporte(archivo, { from: '59170000000', tipo: 'text', userInput: 'hola' });
    const texto = JSON.stringify(viajaAnuncio);
    return anuncio['origen'] === 'anuncio' && directo['origen'] === 'directo' && viajaAnuncio['origen'] === 'anuncio'
      && viajaDirecto['origen'] === 'directo' && sinCampo['origen'] === 'directo' && !texto.includes('fb.me') && !texto.includes('descuento');
  }
}

// ---------------------------------------------------------------------------
// Flujos SIN agente de n8n (etapa 1, 13/11/2026). En estos flujos el origen no lo calcula «Normalizar entrada» por definición: lo calcula el nodo de
// ENTRADA que el reporte lee. Cuál es, sale del propio reporte (`$('<nodo>').first().json`), no de una lista escrita a mano: «Interpretar entrada» en
// unos, «Normalizar entrada» en otros. Se EJECUTA su código con un `$` simulado (el mismo método que `normalizar` de arriba: lo que importa es lo que
// el nodo hace con un `referral`, no lo que dice su texto) y se evalúa la expresión del reporte contra su salida. Si el código no corre con el `$`
// simulado, el flujo no cumple y se dice por qué (nunca se traga el error).
// ---------------------------------------------------------------------------

/** Lo que devuelve el nodo de entrada, ejecutado con un mensaje armado a mano; `string` si no se pudo ejecutar. */
function salidaDeEntrada(codigo: string, mensaje: Record<string, unknown>): Record<string, unknown> | string {
  const entrada = [{
    messages: [{ from: '59170000000', id: 'wamid.PRUEBA', type: 'text', text: { body: 'hola' }, ...mensaje }],
    contacts: [{ profile: { name: 'Prueba' } }], metadata: { phone_number_id: '100000000000000' },
    nombreNegocio: 'Prueba', direccion: '', prefijosPermitidos: '',
  }];
  const $input = { all: () => entrada.map((json) => ({ json })), first: () => ({ json: entrada[0] }) };
  // La configuración mínima que el filtro de entrada exige: el prefijo del número de prueba y el `phone_number_id` del propio mensaje de prueba.
  const CONFIG_MINIMA = { prefijosPermitidos: '591', phoneNumberIdEsperado: '100000000000000' };
  // Estos flujos leen el webhook del nodo «Carga de entrada» y la configuración de «Config del negocio» o «Config base» POR NOMBRE y solo si corrieron (`isExecuted`):
  // el simulador hace que corran esos tres (la configuración, mínima: aquí se ejercita el origen) y que ningún otro nodo haya corrido.
  const corridos: Record<string, Record<string, unknown>> = { 'Carga de entrada': entrada[0] as Record<string, unknown>, 'Config del negocio': CONFIG_MINIMA, 'Config base': CONFIG_MINIMA };
  const $ = (nombre: string) => {
    const json = corridos[nombre];
    return { first: () => ({ json }), all: () => (json ? [{ json }] : []), item: { json }, isExecuted: json !== undefined };
  };
  try {
    const salida = (vm.compileFunction(codigo, ['$input', '$']) as (i: unknown, r: unknown) => { json: Record<string, unknown> }[])($input, $);
    const json = salida?.[0]?.json;
    return json && typeof json === 'object' ? json : 'el nodo no devolvió ningún ítem con el mensaje de prueba';
  } catch (e) { return `el nodo de entrada no corre con el $ simulado (${e instanceof Error ? e.message : String(e)})`; }
}

/** Evalúa el `jsonBody` del reporte con `$('<entrada>').first().json` = `entrada`; `string` si no es evaluable. */
function reporteDeEntrada(cuerpo: string, entrada: Record<string, unknown>): Record<string, unknown> | string {
  const m = /^=\{\{([\s\S]*)\}\}$/.exec(cuerpo.trim());
  if (!m) return 'el reporte no es una expresión simple';
  try {
    const $ = () => ({ first: () => ({ json: entrada }) });
    const fn = vm.compileFunction(`return (${m[1]});`, ['$json', '$']) as (j: unknown, r: unknown) => string;
    return JSON.parse(fn(entrada, $)) as Record<string, unknown>;
  } catch (e) { return `el reporte no se pudo evaluar (${e instanceof Error ? e.message : String(e)})`; }
}

/**
 * Lo que le falta a un flujo SIN agente para reportar el origen del anuncio. Lista vacía = cumple. Las mismas comprobaciones de arriba (con `referral`
 * marca `anuncio`, sin él `directo`, el origen VIAJA al reporte, sin el campo reporta `directo`, ni titular ni URL), sobre el nodo de entrada que lee el
 * reporte.
 */
export function faltantesDelOrigenSinAgente(f: { nodes: Nodo[] }): string[] {
  const reportar = f.nodes.find((n) => n.name === 'Reportar mensaje (entrante)');
  if (!reportar) return ['no tiene «Reportar mensaje (entrante)»'];
  const cuerpo = String(reportar.parameters['jsonBody'] ?? '');
  const nombres = [...new Set([...cuerpo.matchAll(/\$\(\s*'([^']+)'\s*\)/g)].map((m) => m[1] as string))];
  if (/\$node|\$input|\$items|\$env|\$vars|\$execution|\$workflow|\$now|\$today/.test(cuerpo)) return ['el reporte usa variables de n8n que el arnés no puede simular'];
  // Un `$json` (solo o mezclado con `$('X')`) lee de OTRO sitio que el nodo de entrada comprobado: no se puede asegurar de dónde sale el origen.
  if (/\$json\b/.test(cuerpo)) return ['el reporte usa $json: no se puede comprobar de qué nodo sale el origen'];
  if (nombres.length !== 1) return [`el reporte no lee de UN solo nodo de entrada (lee de ${JSON.stringify(nombres)})`];
  const entrada = f.nodes.find((n) => n.name === nombres[0]);
  if (!entrada || entrada.type !== 'n8n-nodes-base.code') return [`el nodo «${nombres[0]}» que lee el reporte no es un nodo Code del flujo`];
  const codigo = String(entrada.parameters['jsCode'] ?? '');
  const anuncio = salidaDeEntrada(codigo, REFERRAL);
  const directo = salidaDeEntrada(codigo, {});
  for (const x of [anuncio, directo]) if (typeof x === 'string') return [`«${entrada.name}»: ${x}`];
  const falta: string[] = [];
  const a = anuncio as Record<string, unknown>;
  const d = directo as Record<string, unknown>;
  if (a['origen'] !== 'anuncio') falta.push(`«${entrada.name}» no marca anuncio cuando Meta manda referral (marca ${JSON.stringify(a['origen'])})`);
  if (d['origen'] !== 'directo') falta.push(`«${entrada.name}» no marca directo cuando no lo manda (marca ${JSON.stringify(d['origen'])})`);
  const rA = reporteDeEntrada(cuerpo, a);
  const rD = reporteDeEntrada(cuerpo, d);
  const rS = reporteDeEntrada(cuerpo, { from: '59170000000', tipo: 'text', userInput: 'hola' });
  for (const x of [rA, rD, rS]) if (typeof x === 'string') return [...falta, x];
  const [ra, rd, rs] = [rA, rD, rS] as Record<string, unknown>[];
  if (ra['origen'] !== 'anuncio' || rd['origen'] !== 'directo') falta.push('el origen no viaja al reporte');
  if (rs['origen'] !== 'directo') falta.push('un flujo sin el campo debe reportar directo, nunca anuncio');
  const texto = JSON.stringify(ra);
  if (texto.includes('fb.me') || texto.includes('descuento')) falta.push('el reporte trae el titular o la URL de la campaña');
  return falta;
}

export const cumpleElOrigenSinAgente = (f: { nodes: Nodo[] }): boolean => faltantesDelOrigenSinAgente(f).length === 0;

describe('Flujos de origen, lista única: cubierto por la lista de arriba o con excepción declarada', () => {
  const atienden = flujosDeProduccion().filter((a) => atiendeCliente(flujo(a) as unknown as FlujoCompleto));

  it('todo flujo de producción que atiende a un cliente y no está en la lista de arriba cumple las comprobaciones o tiene excepción; ninguna sobra', () => {
    expect(atienden.length).toBeGreaterThan(10);
    for (const a of FLUJOS) expect(atienden, a).toContain(a);
    // Con agente de n8n: la comprobación de siempre. Sin agente (etapa 1): `cumpleElOrigenSinAgente`, sobre el nodo de entrada que lee el reporte.
    const conAgente = (a: string): boolean => flujo(a).nodes.some((n) => n.type === '@n8n/n8n-nodes-langchain.agent');
    const cumple = (a: string): boolean => FLUJOS.includes(a) || (conAgente(a) ? cumpleElOrigen(a) : cumpleElOrigenSinAgente(flujo(a)));
    const hoy = new Map(atienden.map((a) => [a, cumple(a) ? [] : ['origen']]));
    expect(problemasDeRegla('flujos-origen', hoy)).toEqual([]);
  });

  it('contraprueba: un flujo sin el nodo «Normalizar entrada» (o sin «Reportar mensaje (entrante)») no cumple', () => {
    expect(cumpleElOrigen('agendamiento-seguimientos.json')).toBe(false);
    expect(cumpleElOrigen('demo-a-agendamiento.json')).toBe(true);
  });

  describe('sin agente: la prueba no es vacía, un flujo que no reporta el origen FALLA', () => {
    const real = (): { nodes: Nodo[] } => JSON.parse(JSON.stringify(flujo('experimental/agenda-minima/agenda-minima.v0.json'))) as { nodes: Nodo[] };
    const sintetico = (codigo: string, cuerpo: string): { nodes: Nodo[] } => ({
      nodes: [
        { name: 'Entrada', type: 'n8n-nodes-base.code', parameters: { jsCode: codigo } },
        { name: 'Reportar mensaje (entrante)', type: 'n8n-nodes-base.httpRequest', parameters: { jsonBody: cuerpo } },
      ],
    });
    const CODIGO_BUENO = "const m = $input.first().json.messages[0]; return [{ json: { from: m.from, origen: m.referral ? 'anuncio' : 'directo' } }];";
    const CUERPO_BUENO = "={{ JSON.stringify({ origen: $('Entrada').first().json.origen || 'directo' }) }}";

    it('el flujo real (agenda mínima) y un sintético correcto cumplen', () => {
      expect(faltantesDelOrigenSinAgente(real())).toEqual([]);
      expect(cumpleElOrigenSinAgente(sintetico(CODIGO_BUENO, CUERPO_BUENO))).toBe(true);
    });

    it('un flujo cuya entrada no calcula `origen` falla', () => {
      const f = sintetico("const m = $input.first().json.messages[0]; return [{ json: { from: m.from } }];", CUERPO_BUENO);
      expect(faltantesDelOrigenSinAgente(f).join('\n')).toMatch(/no marca anuncio cuando Meta manda referral/);
    });

    it('un flujo cuya entrada marca siempre `directo` (ignora el referral) falla', () => {
      const f = sintetico("const m = $input.first().json.messages[0]; return [{ json: { from: m.from, origen: 'directo' } }];", CUERPO_BUENO);
      expect(faltantesDelOrigenSinAgente(f).join('\n')).toMatch(/no marca anuncio/);
    });

    it('un reporte sin `origen` (el origen no viaja) falla', () => {
      const f = sintetico(CODIGO_BUENO, "={{ JSON.stringify({ telefono: $('Entrada').first().json.from }) }}");
      expect(faltantesDelOrigenSinAgente(f).join('\n')).toMatch(/el origen no viaja al reporte/);
    });

    it('un reporte que inventa `anuncio` cuando falta el campo, o que trae el titular de la campaña, falla', () => {
      const inventa = sintetico(CODIGO_BUENO, "={{ JSON.stringify({ origen: $('Entrada').first().json.origen || 'anuncio' }) }}");
      expect(faltantesDelOrigenSinAgente(inventa).join('\n')).toMatch(/nunca anuncio/);
      const titular = sintetico(CODIGO_BUENO, "={{ JSON.stringify({ origen: $('Entrada').first().json.origen || 'directo', url: 'fb.me/x' }) }}");
      expect(faltantesDelOrigenSinAgente(titular).join('\n')).toMatch(/titular o la URL/);
    });

    it('un flujo real al que se le quita el cálculo del origen, o sin el nodo de reporte, falla', () => {
      const f = real();
      const entrada = f.nodes.find((n) => n.name === 'Interpretar entrada')!;
      entrada.parameters['jsCode'] = String(entrada.parameters['jsCode']).replace("origen: ref ? 'anuncio' : 'directo',", '');
      expect(cumpleElOrigenSinAgente(f)).toBe(false);
      expect(faltantesDelOrigenSinAgente({ nodes: [] })).toEqual(['no tiene «Reportar mensaje (entrante)»']);
    });

    it('un reporte con `$json` (solo o mezclado con `$(...)`) no se puede comprobar y falla', () => {
      expect(faltantesDelOrigenSinAgente(sintetico(CODIGO_BUENO, "={{ JSON.stringify({ origen: $json.origen || 'directo' }) }}")).join('\n')).toMatch(/usa \$json/);
      expect(faltantesDelOrigenSinAgente(sintetico(CODIGO_BUENO, "={{ JSON.stringify({ origen: $('Entrada').first().json.origen || $json.origen || 'directo' }) }}")).join('\n')).toMatch(/usa \$json/);
    });

    it('un reporte que lee de dos nodos, o de un nodo que no es Code, no se puede comprobar y falla', () => {
      expect(faltantesDelOrigenSinAgente(sintetico(CODIGO_BUENO, "={{ JSON.stringify({ a: $('Entrada').first().json.origen, b: $('Otro').first().json.x }) }}")).join('\n'))
        .toMatch(/no lee de UN solo nodo de entrada/);
      expect(faltantesDelOrigenSinAgente(sintetico(CODIGO_BUENO, "={{ JSON.stringify({ origen: $('Falta').first().json.origen }) }}")).join('\n'))
        .toMatch(/no es un nodo Code del flujo/);
    });
  });

  it('contraprueba: sin excepción falla; con excepción pasa; si ya cumple, la excepción sobra', () => {
    const exc = { 'a.json#flujos-origen#origen': { dueno: 'x', vence: '2027-01-31', motivo: 'm', desde: '2026-11-12' } };
    expect(problemasDeRegla('flujos-origen', new Map([['a.json', ['origen']]]), {})).toHaveLength(1);
    expect(problemasDeRegla('flujos-origen', new Map([['a.json', ['origen']]]), exc)).toEqual([]);
    expect(problemasDeRegla('flujos-origen', new Map([['a.json', []]]), exc)).toEqual([expect.stringContaining('SOBRA')]);
  });
});
