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
import { flujosDeProduccion } from './lib/flujos-de-cliente.ts';
import { atiendeCliente, idDeFlujo, incluyeVariante, SRC_CORE } from './core/migracion/comprobaciones.ts';
import { excepcionesDe, problemasDeRegla } from './core/migracion/excepciones.ts';

const TRIGGER_WHATSAPP = 'n8n-nodes-base.whatsAppTrigger';
const esAgente = (tipo: string) => tipo === '@n8n/n8n-nodes-langchain.agent';
const PREPARAR = ['Preparar transcripción', 'Preparar imagen'] as const;

/**
 * Flujos conversacionales que, por una decisión declarada, todavía no tienen
 * medios: `archivo → porqué`. Cada uno tiene que figurar en
 * `docs/versiones-por-cliente.md`. Vacío desde el 28/09/2026.
 */
const EXCEPCIONES: Record<string, string[]> = {
  // 22/10/2026 («el asistente entiende las imágenes»): Bellido conserva el «Preparar imagen» anterior
  // (sin descripción de lo que se ve) por orden de Andres de no tocarlo ni publicarlo. Platinum, que se regeneró,
  // ya no existe (baja del 11/11/2026).
  'bellido-agendamiento.json': ['Preparar imagen'],
};
/** Por qué cada excepción (por nodo, no por flujo entero: el resto de la rama de medios sí se comprueba). */
const PORQUE: Record<string, string> = {
  'bellido-agendamiento.json': 'Conserva el «Preparar imagen» anterior a la descripción de imágenes: orden de Andres de no tocar Bellido (corre otro flujo) hasta nuevo aviso.',
};
const exceptuado = (archivo: string, nodo: string): boolean => (EXCEPCIONES[archivo] ?? []).includes(nodo);

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

// ---------------------------------------------------------------------------
// Flujos SIN agente de n8n (etapa 1, 13/11/2026): el contrato equivalente. El agente es código propio del flujo («Decidir turno» y siguientes), así
// que no hay «¿Trae un medio?» ni un nodo agente al que llegar. Lo que SÍ comparten los flujos con rama de medios es la cadena de abajo, medida
// contra los JSON reales (nombres verificados, no supuestos): «¿Tamaño aceptable?» corta antes de bajar; «Descargar medio» baja el archivo;
// «¿Es audio?» → «Transcribir audio» → «Preparar transcripción»; si no, «¿Es un documento?» → «Describir documento» / «Describir imagen» →
// «Preparar imagen»; y «Medio no aceptado» es la salida del medio que no se baja. Las tres piezas terminales son Code que TERMINAN en el módulo
// de core (`Flujos/src/core/medios/`, mismo criterio de sufijo que `incluyeVariante`), y vuelven al camino de siempre por los mismos destinos.
// ---------------------------------------------------------------------------

const TERMINALES_SIN_AGENTE: Record<string, string> = {
  'Preparar transcripción': 'preparar-transcripcion.js',
  'Preparar imagen': 'preparar-imagen.js',
  'Medio no aceptado': 'medio-no-aceptado.js',
};
/** Los nodos propios de la rama de medios sin agente (además de los terminales): una sola lista para «requeridos» y «esperados». */
const NODOS_DE_LA_RAMA_SIN_AGENTE = ['¿Tamaño aceptable?', 'Descargar medio', '¿Es audio?', 'Transcribir audio', '¿Es un documento?', 'Describir imagen', 'Describir documento'];
const DESTINO_DE_NODO_SIN_AGENTE = {
  'Transcribir audio': ['Preparar transcripción'], 'Describir imagen': ['Preparar imagen'], 'Describir documento': ['Preparar imagen'],
} as const;

/** El flujo atiende (reporta el entrante) y no tiene ningún nodo agente: le corresponde el contrato «sin agente». */
export const esSinAgenteQueAtiende = (f: Flujo): boolean => atiendeCliente(f) && !f.nodes.some((n) => esAgente(n.type));

/**
 * Lo que le falta a un flujo SIN agente que atiende para tener audio, imagen y documento. Lista vacía = cumple. Comprueba el CABLEADO
 * (conexiones), no solo la presencia de nodos.
 */
export function faltantesDeMediosSinAgente(f: Flujo, srcCore: string = SRC_CORE): string[] {
  const falta: string[] = [];
  const porNombre = new Map(f.nodes.map((n) => [n.name, n]));
  const requeridos = [...NODOS_DE_LA_RAMA_SIN_AGENTE, ...Object.keys(TERMINALES_SIN_AGENTE)];
  for (const n of requeridos) if (!porNombre.has(n)) falta.push(`no tiene el nodo «${n}»`);
  if (falta.length) return falta;

  // Cada salida (índice) va a UN solo nodo, el esperado.
  const salida = (desde: string, indice: number): string[] => salidas(f, desde)[indice] ?? [];
  const exacto = (desde: string, indice: number, hacia: string) => {
    const d = salida(desde, indice);
    if (d.length !== 1 || d[0] !== hacia) falta.push(`«${desde}» (salida ${indice}) tiene que ir solo a «${hacia}» (va a ${JSON.stringify(d)})`);
  };
  exacto('¿Tamaño aceptable?', 0, 'Descargar medio');
  exacto('¿Tamaño aceptable?', 1, 'Medio no aceptado');
  exacto('Descargar medio', 0, '¿Es audio?');
  exacto('¿Es audio?', 0, 'Transcribir audio');
  exacto('¿Es audio?', 1, '¿Es un documento?');
  exacto('¿Es un documento?', 0, 'Describir documento');
  exacto('¿Es un documento?', 1, 'Describir imagen');
  for (const [desde, [hacia]] of Object.entries(DESTINO_DE_NODO_SIN_AGENTE)) exacto(desde, 0, hacia);
  if (salidas(f, 'Descargar medio').flat().length !== 1) falta.push('«Descargar medio» tiene que ir solo a «¿Es audio?»');

  // Alcanzable desde la entrada del flujo: algún disparador o webhook (el de WhatsApp o el del receptor) llega a «¿Tamaño aceptable?».
  const raices = f.nodes.filter((n) => /trigger|webhook/i.test(n.type)).map((n) => n.name);
  if (!alcanzables(f, raices).has('¿Tamaño aceptable?')) falta.push('«¿Tamaño aceptable?» no es alcanzable desde la entrada del flujo');

  // La descarga es de verdad un archivo (el binario que NO puede pasar de los «Preparar …»).
  const d = porNombre.get('Descargar medio')!;
  if (d.type !== 'n8n-nodes-base.httpRequest' || !JSON.stringify(d.parameters['options'] ?? {}).includes('"responseFormat":"file"')) {
    falta.push('«Descargar medio» no es un HTTP con respuesta de tipo archivo');
  }

  // Las tres piezas terminales son Code que terminan en el módulo de core.
  for (const [nombre, archivo] of Object.entries(TERMINALES_SIN_AGENTE)) {
    const n = porNombre.get(nombre)!;
    let modulo = '';
    try { modulo = readFileSync(join(srcCore, 'medios', archivo), 'utf8'); } catch { falta.push(`core/medios/${archivo} no existe`); continue; }
    if (n.type !== 'n8n-nodes-base.code') falta.push(`«${nombre}» no es un nodo Code`);
    else if (!incluyeVariante(String(n.parameters['jsCode'] ?? ''), [modulo])) falta.push(`«${nombre}» no termina en core/medios/${archivo}`);
  }

  // El binario no pasa de los terminales y la rama no envía nada: desde «¿Tamaño aceptable?», cortando en los terminales, solo hay nodos de la rama.
  const terminales = new Set(Object.keys(TERMINALES_SIN_AGENTE));
  const esperados = new Set([...NODOS_DE_LA_RAMA_SIN_AGENTE, ...terminales]);
  const rama = alcanzables(f, ['¿Tamaño aceptable?'], (n) => terminales.has(n));
  for (const n of rama) if (!esperados.has(n)) falta.push(`desde «¿Tamaño aceptable?» se llega a «${n}» sin pasar por un «Preparar …» ni «Medio no aceptado»`);
  for (const n of rama) {
    const nodo = porNombre.get(n);
    if (!nodo) continue;
    const enviaWhatsApp = nodo.type === 'n8n-nodes-base.whatsApp' && String(nodo.parameters['resource'] ?? 'message') !== 'media';
    const enviaHttp = nodo.type === 'n8n-nodes-base.httpRequest' && String(nodo.parameters['method'] ?? 'GET') !== 'GET';
    if (enviaWhatsApp || enviaHttp) falta.push(`«${n}», en la rama de medios, envía algo: tiene que ser solo lectura`);
  }

  // Los tres terminales vuelven al camino de siempre por el MISMO destino (no vacío).
  const destinos = [...terminales].map((t) => JSON.stringify([...new Set(salidas(f, t).flat())].sort()));
  if (new Set(destinos).size !== 1 || destinos[0] === '[]') falta.push(`los terminales de la rama no vuelven todos al mismo destino (${destinos.join(' | ')})`);
  return falta;
}

const conversacionales = archivos.filter((a) => esConversacional(leerFlujo(a)));

describe('Capacidades comunes: todo flujo conversacional tiene audio, imagen y documento', () => {
  it('se descubren del disco, y son los cuatro de hoy (ninguno se escribe a mano para que no falte el de mañana)', () => {
    // Un piso, no una lista cerrada: si mañana nace un sexto flujo con
    // disparador de WhatsApp y agente, entra solo a la prueba de abajo.
    expect(conversacionales).toEqual(expect.arrayContaining([
      'bellido-agendamiento.json', 'demo-a-agendamiento.json', 'demo-b-venta-cobro.json',
      'novuchat-onboarding.json',
    ]));
    // Los programados quedan fuera por lo que son, no por su nombre.
    for (const a of ['agendamiento-seguimientos.json', 'agendamiento-senas-vencidas.json', 'demo-a-recordatorios.json']) {
      expect(conversacionales, a).not.toContain(a);
    }
  });

  it.each(conversacionales)('%s: tiene la rama de medios cableada hasta su agente', (archivo) => {
    const falta = faltantesDeMedios(leerFlujo(archivo));
    expect(falta, `${archivo}:\n  - ${falta.join('\n  - ')}`).toEqual([]);
  });

  it('los dos «Preparar …» son el MISMO código en todos: un módulo, nunca una copia que diverja', () => {
    for (const p of PREPARAR) {
      const codigos = new Set(conversacionales.filter((a) => !exceptuado(a, p))
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
    for (const a of Object.keys(EXCEPCIONES)) {
      expect(archivos, a).toContain(a);
      expect((PORQUE[a] ?? '').trim().length, a).toBeGreaterThan(20);
      expect(registro, a).toContain(a);
    }
  });
});

describe('Sin agente: la prueba no es vacía, un flujo con la rama rota FALLA', () => {
  const base = (): Flujo => JSON.parse(JSON.stringify(leerFlujo('experimental/agenda-minima/agenda-minima.v0.json'))) as Flujo;

  it('la base real (agenda mínima) cumple y es un flujo sin agente que atiende', () => {
    expect(esSinAgenteQueAtiende(base())).toBe(true);
    expect(faltantesDeMediosSinAgente(base())).toEqual([]);
  });

  it('un flujo sin «Preparar imagen» falla y lo nombra', () => {
    const f = base();
    f.nodes = f.nodes.filter((n) => n.name !== 'Preparar imagen');
    expect(faltantesDeMediosSinAgente(f)).toContain('no tiene el nodo «Preparar imagen»');
  });

  it('un flujo sin rama de medios (solo el reporte del entrante) falla', () => {
    const f = { nodes: [{ name: 'Reportar mensaje (entrante)', type: 'n8n-nodes-base.httpRequest', parameters: {} }], connections: {} } as unknown as Flujo;
    expect(esSinAgenteQueAtiende(f)).toBe(true);
    expect(faltantesDeMediosSinAgente(f).length).toBeGreaterThan(0);
  });

  it('si un nodo de WhatsApp de MENSAJE entra en la rama, falla; uno de medios (lectura) no', () => {
    const f = base();
    const n = f.nodes.find((x) => x.name === 'Describir imagen')!;
    n.type = 'n8n-nodes-base.whatsApp';
    n.parameters = { resource: 'message' };
    expect(faltantesDeMediosSinAgente(f).join('\n')).toMatch(/«Describir imagen», en la rama de medios, envía algo/);
    n.parameters = { resource: 'media' };
    expect(faltantesDeMediosSinAgente(f).join('\n')).not.toMatch(/«Describir imagen», en la rama de medios, envía algo/);
  });

  it('si un HTTP de la rama deja de ser GET (envía algo), falla', () => {
    const f = base();
    f.nodes.find((n) => n.name === 'Descargar medio')!.parameters['method'] = 'POST';
    expect(faltantesDeMediosSinAgente(f).join('\n')).toMatch(/«Descargar medio», en la rama de medios, envía algo/);
  });

  it('si el binario sale de la rama sin pasar por un «Preparar …», falla y lo nombra', () => {
    const f = base();
    f.connections['Describir imagen'] = { main: [[{ node: 'Decidir turno', type: 'main', index: 0 }]] };
    const falta = faltantesDeMediosSinAgente(f).join('\n');
    expect(falta).toMatch(/«Describir imagen» \(salida 0\) tiene que ir solo a «Preparar imagen»/);
    expect(falta).toMatch(/se llega a «Decidir turno» sin pasar por un «Preparar …»/);
  });

  it('si un «Preparar …» deja de terminar en el módulo de core, o deja de ser Code, falla', () => {
    const f = base();
    f.nodes.find((n) => n.name === 'Preparar imagen')!.parameters['jsCode'] = 'return [];';
    expect(faltantesDeMediosSinAgente(f).join('\n')).toMatch(/«Preparar imagen» no termina en core\/medios\/preparar-imagen.js/);
    const g = base();
    g.nodes.find((n) => n.name === 'Medio no aceptado')!.type = 'n8n-nodes-base.set';
    expect(faltantesDeMediosSinAgente(g).join('\n')).toMatch(/«Medio no aceptado» no es un nodo Code/);
  });

  it('si la rama no es alcanzable desde la entrada, o el medio demasiado grande no va a «Medio no aceptado», falla', () => {
    const f = base();
    f.connections['Obtener URL del medio (general)'] = { main: [[]] };
    expect(faltantesDeMediosSinAgente(f).join('\n')).toMatch(/«¿Tamaño aceptable\?» no es alcanzable desde la entrada/);
    const g = base();
    g.connections['¿Tamaño aceptable?'] = { main: [[{ node: 'Descargar medio', type: 'main', index: 0 }], []] };
    expect(faltantesDeMediosSinAgente(g).join('\n')).toMatch(/«¿Tamaño aceptable\?» \(salida 1\) tiene que ir solo a «Medio no aceptado»/);
  });

  it('si los terminales vuelven a destinos distintos, falla', () => {
    const f = base();
    f.connections['Medio no aceptado'] = { main: [[{ node: 'Normalizar entrada', type: 'main', index: 0 }]] };
    expect(faltantesDeMediosSinAgente(f).join('\n')).toMatch(/no vuelven todos al mismo destino/);
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

// ---------------------------------------------------------------------------
// Migración (etapa 0, 12/11/2026): la lista única. La comprobación de arriba sigue IGUAL sobre su lista (los JSON de la raíz de `Flujos/` con
// disparador de WhatsApp y agente). Todo flujo de producción que ATIENDE a un cliente y no está cubierto por ella (los de `experimental/` y
// `clientes/`, que no usan el agente de n8n) debe cumplirla o estar en la lista de excepciones con vencimiento (decisión D2 de Andres):
// ninguno puede quedar fuera de las dos.
// ---------------------------------------------------------------------------

describe('Capacidades comunes, lista única: cubierto por la comprobación o con excepción declarada', () => {
  const produccion = flujosDeProduccion();
  const atienden = produccion.filter((a) => atiendeCliente(leerFlujo(a)));
  // Los de `conversacionales` ya los recorre, uno por uno y sin excepciones, `it.each(conversacionales)` de arriba.
  const cubiertoPorLaComprobacion = (a: string): boolean => conversacionales.includes(a);

  it('los flujos de producción que no atienden a un cliente no son conversacionales: quedan fuera por lo que son', () => {
    const fuera = produccion.filter((a) => !atienden.includes(a));
    expect(fuera.length).toBeGreaterThan(5);
    for (const a of fuera) expect(esConversacional(leerFlujo(a)), a).toBe(false);
  });

  it('todo flujo de producción que atiende a un cliente cumple la comprobación o tiene excepción; ninguna excepción sobra', () => {
    expect(atienden.length).toBeGreaterThan(10);
    // Con agente de n8n: la comprobación de siempre. Sin agente (etapa 1): el contrato equivalente, `faltantesDeMediosSinAgente`.
    const cumple = (a: string): boolean => {
      const f = leerFlujo(a);
      if (cubiertoPorLaComprobacion(a)) return true;
      return (esSinAgenteQueAtiende(f) ? faltantesDeMediosSinAgente(f) : faltantesDeMedios(f)).length === 0;
    };
    const hoy = new Map(atienden.map((a) => [a, cumple(a) ? [] : ['rama de medios']]));
    const detalle = atienden.filter((a) => !cumple(a)).map((a) => `${a}: ${(esSinAgenteQueAtiende(leerFlujo(a)) ? faltantesDeMediosSinAgente(leerFlujo(a)) : faltantesDeMedios(leerFlujo(a))).join('; ')}`).join('\n');
    expect(problemasDeRegla('capacidades-comunes', hoy), detalle).toEqual([]);
  });

  it('el conjunto que atiende, medido aparte por el texto del JSON, es exactamente el que cubren la comprobación con agente, la de sin agente o una excepción', () => {
    // Medido de forma independiente: el JSON crudo nombra «Reportar mensaje (entrante)» como nodo (no por `atiendeCliente`).
    const porTexto = produccion.filter((a) => readFileSync(join(CARPETA_FLUJOS, a), 'utf8').includes('"name": "Reportar mensaje (entrante)"'));
    expect([...porTexto].sort()).toEqual([...atienden].sort());
    const conAgente = atienden.filter((a) => leerFlujo(a).nodes.some((n) => esAgente(n.type)));
    const sinAgente = atienden.filter((a) => esSinAgenteQueAtiende(leerFlujo(a)));
    expect([...conAgente, ...sinAgente].sort()).toEqual([...atienden].sort()); // sin solapes ni huecos
    const exceptuados = new Set(excepcionesDe('capacidades-comunes').map(([j]) => idDeFlujo(j)));
    for (const a of atienden) {
      const cumple = conversacionales.includes(a) || (sinAgente.includes(a) ? faltantesDeMediosSinAgente(leerFlujo(a)) : faltantesDeMedios(leerFlujo(a))).length === 0;
      expect(cumple || exceptuados.has(idDeFlujo(a)), a).toBe(true);
    }
  });

  it('contraprueba: un flujo que atiende y no tiene la rama de medios falla sin excepción; con excepción pasa; si ya la cumple, la excepción sobra', () => {
    const exc = { 'a.json#capacidades-comunes#rama de medios': { dueno: 'x', vence: '2027-01-31', motivo: 'm', desde: '2026-11-12' } };
    const sinRama = { nodes: [{ name: 'Reportar mensaje (entrante)', type: 'n8n-nodes-base.httpRequest', parameters: {} }], connections: {} } as unknown as Flujo;
    expect(atiendeCliente(sinRama)).toBe(true);
    expect(faltantesDeMedios(sinRama).length).toBeGreaterThan(0);
    expect(problemasDeRegla('capacidades-comunes', new Map([['a.json', ['rama de medios']]]), {})).toHaveLength(1);
    expect(problemasDeRegla('capacidades-comunes', new Map([['a.json', ['rama de medios']]]), exc)).toEqual([]);
    expect(problemasDeRegla('capacidades-comunes', new Map([['a.json', []]]), exc)).toEqual([expect.stringContaining('SOBRA')]);
  });
});
