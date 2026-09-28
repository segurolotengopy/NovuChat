/**
 * =============================================================================
 * LO QUE TODO FLUJO CONVERSACIONAL TIENE QUE TENER: AUDIO, IMAGEN Y DOCUMENTO
 * =============================================================================
 *
 * EL HECHO (25/09/2026, `Prompts/capacidades-comunes.md`). Andres probó el
 * Demo B con una foto y una nota de voz y recibió «No puedo abrir imágenes» y
 * «No puedo escuchar notas de voz». No era una regresión: el Demo B y la
 * captación NUNCA tuvieron la rama de medios que reservas tiene desde el 18/09,
 * y NINGÚN control lo vio. `estado-de-versiones.sh` compara cada flujo vivo con
 * SU PROPIO JSON, así que un flujo al día con un JSON al que le falta una
 * capacidad común sale en verde. Faltaba una definición de «lo que todo flujo
 * conversacional tiene» y una prueba que la exija. Es esta.
 *
 * QUÉ ES UN FLUJO CONVERSACIONAL: un JSON de `Flujos/` con un disparador de
 * WhatsApp y un agente de IA. Los programados (recordatorios, seguimientos,
 * señas vencidas) no tienen ninguno de los dos y quedan fuera solos. La lista
 * NO se escribe a mano: se descubre del disco, para que un flujo que nazca
 * mañana entre sin que nadie se acuerde de agregarlo.
 *
 * QUÉ SE EXIGE, por NOMBRE de nodo (el contrato que ya cumplen reservas):
 *   1. «¿Trae un medio?», alcanzable desde el disparador, que decide por
 *      `esMedioAudio` y `esMedioVisual` (lo que marca «Normalizar entrada»).
 *   2. Desde su salida verdadera se llega a «Transcribir audio» y a
 *      «Describir imagen»; «Transcribir audio» va SOLO a «Preparar
 *      transcripción» y «Describir imagen» SOLO a «Preparar imagen», o a UN
 *      nodo Code del flujo que va solo a ese «Preparar» (el filtro de
 *      categorías que cada flujo puede cumplir).
 *   3. Los dos «Preparar …» son nodos Code y llegan al MISMO agente al que
 *      llega un mensaje sin medio (la salida falsa de «¿Trae un medio?»).
 *   4. EL AGENTE NUNCA VE EL BINARIO: desde toda descarga de la rama, sin
 *      pasar por un «Preparar …», no se alcanza ningún agente ni el punto de
 *      reingreso al camino de siempre. Lo que vuelve sin un «Preparar …» (el
 *      aviso de un medio demasiado grande, que nunca se bajó) es un nodo Code.
 *   5. La rama no envía nada: sus nodos de Meta son lecturas (0 mensajes).
 *   6. Los dos «Preparar …» son el mismo código en todos los flujos (un solo
 *      módulo, nunca una copia que diverja), y donde hay manifiesto apuntan al
 *      mismo archivo.
 *
 * EXCEPCIONES: solo declaradas, con su porqué, y con su fila en
 * `docs/versiones-por-cliente.md` (la decisión 1 del frente). Hoy no hay
 * ninguna.
 *
 * LO QUE NO MIRA, a propósito: las categorías del clasificador y los avisos,
 * que son por módulo (decisión 3 del frente; F3a). Ni el orden del lienzo, que
 * ya prueban `flujos-umbrales.test.ts` y la suite de cada flujo.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Flujo, CARPETA_FLUJOS, leerFlujo } from './lib/flujo.ts';

const TRIGGER_WHATSAPP = 'n8n-nodes-base.whatsAppTrigger';
const esAgente = (tipo: string) => tipo === '@n8n/n8n-nodes-langchain.agent';
const PREPARAR = ['Preparar transcripción', 'Preparar imagen'] as const;

/**
 * Flujos conversacionales que, por una decisión declarada, todavía no tienen
 * medios: `archivo → porqué`. Cada uno tiene que figurar en
 * `docs/versiones-por-cliente.md`. Vacío desde el 28/09/2026.
 */
const EXCEPCIONES: Record<string, string> = {};

const archivos = readdirSync(CARPETA_FLUJOS)
  .filter((a) => a.endsWith('.json') && !a.endsWith('.local.json'))
  .sort();

export const esConversacional = (f: Flujo): boolean =>
  f.nodes.some((n) => n.type === TRIGGER_WHATSAPP) && f.nodes.some((n) => esAgente(n.type));

const salidas = (f: Flujo, desde: string): string[][] =>
  (f.connections[desde]?.['main'] ?? []).map((s) => (s ?? []).map((x) => x.node));

/** Todo lo alcanzable desde `inicio` sin atravesar `corte` (que sí se incluye si se toca). */
function alcanzables(f: Flujo, inicio: string[], corte: (n: string) => boolean = () => false): Set<string> {
  const vistos = new Set<string>(inicio);
  const pendientes = inicio.filter((n) => !corte(n));
  while (pendientes.length) {
    const actual = pendientes.pop() as string;
    for (const s of salidas(f, actual)) {
      for (const x of s) {
        if (vistos.has(x)) continue;
        vistos.add(x);
        if (!corte(x)) pendientes.push(x);
      }
    }
  }
  return vistos;
}

/** Los agentes a los que se llega desde `inicio`, deteniéndose en el primer agente de cada camino. */
function primerosAgentes(f: Flujo, inicio: string[]): string[] {
  const agentes = new Set(f.nodes.filter((n) => esAgente(n.type)).map((n) => n.name));
  return [...alcanzables(f, inicio, (n) => agentes.has(n))].filter((n) => agentes.has(n)).sort();
}

/**
 * Lo que le falta a un flujo conversacional para tener audio, imagen y
 * documento. Lista vacía = cumple. Cada entrada dice QUÉ falta, para que la
 * falla se entienda sin abrir el JSON.
 */
export function faltantesDeMedios(f: Flujo): string[] {
  const falta: string[] = [];
  const porNombre = new Map(f.nodes.map((n) => [n.name, n]));
  for (const n of ['¿Trae un medio?', 'Transcribir audio', 'Describir imagen', ...PREPARAR]) {
    if (!porNombre.has(n)) falta.push(`no tiene el nodo «${n}»`);
  }
  if (falta.length) return falta;

  // 1. Alcanzable desde el disparador, y decide por lo que marcó la normalización.
  const disparadores = f.nodes.filter((n) => n.type === TRIGGER_WHATSAPP).map((n) => n.name);
  if (!alcanzables(f, disparadores).has('¿Trae un medio?')) falta.push('«¿Trae un medio?» no es alcanzable desde el disparador de WhatsApp');
  const condicion = JSON.stringify(porNombre.get('¿Trae un medio?')!.parameters['conditions'] ?? {});
  if (!/esMedioAudio/.test(condicion) || !/esMedioVisual/.test(condicion)) {
    falta.push('«¿Trae un medio?» no decide por esMedioAudio y esMedioVisual');
  }

  // 2. La salida verdadera lleva a transcribir y a describir, y cada uno a su «Preparar».
  const [verdadera = [], falsa = []] = salidas(f, '¿Trae un medio?');
  const desdeVerdadera = alcanzables(f, verdadera);
  for (const n of ['Transcribir audio', 'Describir imagen']) {
    if (!desdeVerdadera.has(n)) falta.push(`desde la salida verdadera de «¿Trae un medio?» no se llega a «${n}»`);
  }
  // Directo a su «Preparar», o a UN nodo Code propio del flujo que va solo a
  // ese «Preparar» (el «Filtrar categoría» de la revisión de seguridad del PR
  // #256: reduce las categorías a las que el flujo cumple). Nada más: ni un
  // agente, ni una bifurcación, ni un nodo que no sea código del flujo.
  const unico = (desde: string, hacia: string) => {
    const d = salidas(f, desde).flat();
    const directo = d.length === 1 && d[0] === hacia;
    const filtro = d.length === 1 && d[0] !== hacia && porNombre.get(d[0]!)?.type === 'n8n-nodes-base.code'
      && JSON.stringify(salidas(f, d[0]!).flat()) === JSON.stringify([hacia]);
    if (!directo && !filtro) {
      falta.push(`«${desde}» tiene que ir solo a «${hacia}», o a un nodo Code que vaya solo a él (va a ${JSON.stringify(d)})`);
    }
  };
  unico('Transcribir audio', 'Preparar transcripción');
  unico('Describir imagen', 'Preparar imagen');

  // 3. Los «Preparar …» son Code y llegan al agente al que llega un mensaje sin medio.
  const suAgente = primerosAgentes(f, falsa);
  if (!suAgente.length) falta.push('la salida falsa de «¿Trae un medio?» no llega a ningún agente');
  for (const p of PREPARAR) {
    if (porNombre.get(p)!.type !== 'n8n-nodes-base.code') falta.push(`«${p}» no es un nodo Code`);
    const agentes = primerosAgentes(f, salidas(f, p).flat());
    if (!suAgente.length || JSON.stringify(agentes) !== JSON.stringify(suAgente)) {
      falta.push(`«${p}» no llega al agente del flujo (${JSON.stringify(suAgente)}); llega a ${JSON.stringify(agentes)}`);
    }
  }

  // 4. El agente nunca ve el binario. La rama termina donde vuelve al camino de
  // siempre: en un agente, en un «Preparar …» o en el nodo al que va la salida
  // falsa de «¿Trae un medio?» (el reingreso: el agente en el Demo B, «Estado
  // de la conversación» en la captación).
  const agentes = new Set(f.nodes.filter((n) => esAgente(n.type)).map((n) => n.name));
  const esPreparar = (n: string) => (PREPARAR as readonly string[]).includes(n);
  const reingreso = new Set(falsa);
  const rama = alcanzables(f, verdadera, (n) => esPreparar(n) || agentes.has(n) || reingreso.has(n));
  // Quién tiene el binario en la mano: toda descarga que devuelve un archivo.
  const descargas = [...rama].filter((n) => {
    const x = porNombre.get(n);
    return x?.type === 'n8n-nodes-base.httpRequest'
      && JSON.stringify(x.parameters['options'] ?? {}).includes('"responseFormat":"file"');
  });
  if (!descargas.length) falta.push('la rama de medios no descarga el archivo (ningún HTTP con respuesta de tipo archivo)');
  for (const d of descargas) {
    const conBinario = alcanzables(f, [d], esPreparar);
    for (const a of [...agentes, ...reingreso]) {
      if (conBinario.has(a)) falta.push(`desde «${d}» (con el binario) se llega a «${a}» sin pasar por un «Preparar …»`);
    }
  }
  // Lo que vuelve al camino de siempre SIN un «Preparar …» (el aviso de un
  // medio que no se bajó) tiene que ser un nodo Code: texto que escribe el
  // flujo, nunca lo que devolvió un modelo o Meta tal cual.
  for (const n of rama) {
    if (esPreparar(n) || agentes.has(n) || reingreso.has(n)) continue;
    const vuelve = salidas(f, n).flat().some((x) => agentes.has(x) || reingreso.has(x));
    if (vuelve && porNombre.get(n)?.type !== 'n8n-nodes-base.code') {
      falta.push(`«${n}» vuelve al agente sin ser un nodo Code`);
    }
  }

  // 5. La rama no envía nada.
  for (const n of rama) {
    const nodo = porNombre.get(n);
    if (!nodo || esPreparar(n) || agentes.has(n) || reingreso.has(n)) continue;
    const enviaWhatsApp = nodo.type === 'n8n-nodes-base.whatsApp' && String(nodo.parameters['resource'] ?? 'message') !== 'media';
    const enviaHttp = nodo.type === 'n8n-nodes-base.httpRequest' && String(nodo.parameters['method'] ?? 'GET') !== 'GET';
    if (enviaWhatsApp || enviaHttp) falta.push(`«${n}», en la rama de medios, envía algo: tiene que ser solo lectura`);
  }
  return falta;
}

const conversacionales = archivos.filter((a) => esConversacional(leerFlujo(a)));

describe('Capacidades comunes: todo flujo conversacional tiene audio, imagen y documento', () => {
  it('se descubren del disco, y son los cinco de hoy (ninguno se escribe a mano para que no falte el de mañana)', () => {
    // Un piso, no una lista cerrada: si mañana nace un sexto flujo con
    // disparador de WhatsApp y agente, entra solo a la prueba de abajo.
    expect(conversacionales).toEqual(expect.arrayContaining([
      'bellido-agendamiento.json', 'demo-a-agendamiento.json', 'demo-b-venta-cobro.json',
      'novuchat-onboarding.json', 'platinum-agendamiento.json',
    ]));
    // Los programados quedan fuera por lo que son, no por su nombre.
    for (const a of ['agendamiento-seguimientos.json', 'agendamiento-senas-vencidas.json', 'demo-a-recordatorios.json']) {
      expect(conversacionales, a).not.toContain(a);
    }
  });

  it.each(conversacionales)('%s: tiene la rama de medios cableada hasta su agente', (archivo) => {
    const falta = faltantesDeMedios(leerFlujo(archivo));
    if (archivo in EXCEPCIONES) return;
    expect(falta, `${archivo}:\n  - ${falta.join('\n  - ')}`).toEqual([]);
  });

  it('los dos «Preparar …» son el MISMO código en todos: un módulo, nunca una copia que diverja', () => {
    for (const p of PREPARAR) {
      const codigos = new Set(conversacionales.filter((a) => !(a in EXCEPCIONES))
        .map((a) => String(leerFlujo(a).nodes.find((n) => n.name === p)?.parameters['jsCode'])));
      expect(codigos.size, p).toBe(1);
    }
  });

  it('donde hay manifiesto, los «Preparar …» se inyectan desde el mismo archivo', () => {
    const destinos = new Map<string, Set<string>>(PREPARAR.map((p) => [p, new Set<string>()]));
    for (const a of conversacionales) {
      let crudo: string;
      try { crudo = readFileSync(join(CARPETA_FLUJOS, 'manifiestos', a), 'utf8'); } catch { continue; }
      const codigo = (JSON.parse(crudo) as { codigo?: Record<string, string | { archivo: string }> }).codigo ?? {};
      for (const p of PREPARAR) {
        const v = codigo[p];
        expect(v, `${a} tiene manifiesto y no inyecta «${p}»`).toBeDefined();
        destinos.get(p)!.add(typeof v === 'string' ? v : v!.archivo);
      }
    }
    for (const [p, rutas] of destinos) expect([...rutas], p).toHaveLength(1);
  });

  it('toda excepción está declarada en docs/versiones-por-cliente.md, con su flujo existente', () => {
    const registro = readFileSync(join(CARPETA_FLUJOS, '../docs/versiones-por-cliente.md'), 'utf8');
    for (const [a, porque] of Object.entries(EXCEPCIONES)) {
      expect(archivos, a).toContain(a);
      expect(porque.trim().length, a).toBeGreaterThan(20);
      expect(registro, a).toContain(a);
    }
  });
});

describe('La prueba no es vacía: un flujo sin medios, o con la rama rota, FALLA', () => {
  const base = (): Flujo => JSON.parse(JSON.stringify(leerFlujo('demo-b-venta-cobro.json'))) as Flujo;

  it('un flujo nuevo con disparador y agente pero sin medios es conversacional y le falta todo', () => {
    const nuevo = {
      name: 'nuevo', nodes: [
        { name: 'WhatsApp Trigger', type: TRIGGER_WHATSAPP, parameters: {} },
        { name: 'Normalizar entrada', type: 'n8n-nodes-base.code', parameters: { jsCode: 'return [];' } },
        { name: 'AI Agent', type: '@n8n/n8n-nodes-langchain.agent', parameters: {} },
      ],
      connections: {
        'WhatsApp Trigger': { main: [[{ node: 'Normalizar entrada', type: 'main', index: 0 }]] },
        'Normalizar entrada': { main: [[{ node: 'AI Agent', type: 'main', index: 0 }]] },
      },
    } as unknown as Flujo;
    expect(esConversacional(nuevo)).toBe(true);
    expect(faltantesDeMedios(nuevo)).toEqual(expect.arrayContaining(['no tiene el nodo «¿Trae un medio?»']));
  });

  it('si «Preparar imagen» deja de llegar al agente, falla y lo nombra', () => {
    const f = base();
    f.connections['Preparar imagen'] = { main: [[]] };
    expect(faltantesDeMedios(f).join('\n')).toMatch(/«Preparar imagen» no llega al agente/);
  });

  it('si el binario va derecho al agente, falla y lo nombra', () => {
    const f = base();
    f.connections['Describir imagen'] = { main: [[{ node: 'AI Agent NovuChat', type: 'main', index: 0 }]] };
    const falta = faltantesDeMedios(f).join('\n');
    expect(falta).toMatch(/«Describir imagen» tiene que ir solo a «Preparar imagen»/);
    expect(falta).toMatch(/desde «Descargar medio» \(con el binario\) se llega a «AI Agent NovuChat» sin pasar por un «Preparar …»/);
  });

  it('si el filtro de categoría deja de ser código del flujo, o se abre a otro destino, falla', () => {
    const f = base();
    f.nodes.find((x) => x.name === 'Filtrar categoría')!.type = 'n8n-nodes-base.set';
    expect(faltantesDeMedios(f).join('\n')).toMatch(/«Describir imagen» tiene que ir solo a «Preparar imagen», o a un nodo Code/);
    const g = base();
    g.connections['Filtrar categoría'] = { main: [[{ node: 'Preparar imagen', type: 'main', index: 0 },
      { node: 'AI Agent NovuChat', type: 'main', index: 0 }]] };
    const falta = faltantesDeMedios(g).join('\n');
    expect(falta).toMatch(/«Describir imagen» tiene que ir solo a «Preparar imagen»/);
    expect(falta).toMatch(/sin pasar por un «Preparar …»/);
  });

  it('si el aviso de un medio no aceptado vuelve al agente desde un nodo que no es Code, o DESPUÉS de la descarga, falla', () => {
    const f = base();
    f.nodes.find((x) => x.name === 'Medio no aceptado')!.type = 'n8n-nodes-base.set';
    expect(faltantesDeMedios(f).join('\n')).toMatch(/«Medio no aceptado» vuelve al agente sin ser un nodo Code/);
    const g = base();
    g.connections['Descargar medio'] = { main: [[{ node: 'Medio no aceptado', type: 'main', index: 0 }]] };
    expect(faltantesDeMedios(g).join('\n')).toMatch(/desde «Descargar medio» \(con el binario\) se llega a «AI Agent NovuChat»/);
  });

  it('si un nodo de la rama empieza a enviar, falla', () => {
    const f = base();
    const n = f.nodes.find((x) => x.name === 'Descargar medio')!;
    n.parameters['method'] = 'POST';
    expect(faltantesDeMedios(f).join('\n')).toMatch(/«Descargar medio», en la rama de medios, envía algo/);
  });

  it('si «¿Trae un medio?» deja de decidir por lo que marcó la normalización, falla', () => {
    const f = base();
    f.nodes.find((x) => x.name === '¿Trae un medio?')!.parameters['conditions'] = { conditions: [{ leftValue: '={{ true }}' }] };
    expect(faltantesDeMedios(f).join('\n')).toMatch(/no decide por esMedioAudio y esMedioVisual/);
  });
});
