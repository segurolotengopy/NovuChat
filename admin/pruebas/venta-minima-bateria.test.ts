/**
 * LA BATERÍA DE CONVERSACIÓN DE «VENTA MÍNIMA v0» (Q'Taco), SIN RED NI CLAVE
 * (`Flujos/experimental/venta-minima/herramientas/bateria.mjs` y `bateria-casos/*.json`).
 *
 * La batería recorre el JSON ARMADO de producción (`venta-minima.qtaco.json`) nodo por nodo, con el código real de cada Code, y
 * pone dobles solo donde el flujo sale a la red. Esta suite prueba la herramienta, y lo hace NEGANDO:
 *   - `--seco` corre todos los casos de la carpeta con cero fallos, sin tocar la red (un `fetch` de mentira que explota y el
 *     `fetch` global reemplazado por uno que explota) y sin clave;
 *   - la batería MIDE el flujo: con una avería inyectada en «Decidir turno» (una copia del flujo), el caso A9 falla;
 *   - el motor detecta cada tipo de incumplimiento de un `esperado` (texto, botón, estado, efecto, fallo de nodo…);
 *   - E8, el negativo global: una frase prohibida que el flujo emite de verdad (una dirección que dice «escríbeles»)
 *     la detecta la batería, y el mismo caso sin la frase no la acusa;
 *   - un caso mal formado (clave desconocida, expresión inválida, id repetido, tipo de turno desconocido, JSON roto) es un error
 *     de uso (código 2), y los argumentos se validan;
 *   - con `--vertex` el token de gcloud (de mentira) va solo a `*-aiplatform.googleapis.com`, el cuerpo es el que arma el flujo y
 *     el token NUNCA aparece en la salida ni en un error;
 *   - la herramienta no escribe archivos y el repositorio público no recibe rutas de usuario ni UUID.
 * Ningún `fetch` es real. Todo dato es sintético (teléfonos de seis ceros seguidos).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;

const AQUI = dirname(fileURLToPath(import.meta.url));
const CARPETA = join(AQUI, '../../Flujos/experimental/venta-minima');
const HERRAMIENTA = join(CARPETA, 'herramientas/bateria.mjs');
const CARPETA_CASOS = join(CARPETA, 'herramientas/bateria-casos');
const RUTA_FLUJO = join(CARPETA, 'venta-minima.qtaco.json');
/**
 * Los casos que NO pasan contra main y esperan una rama (05/10/2026). `A-delivery-opcional.json` pasa contra la rama de delivery opcional (PR #435) y falla contra
 * main; `A-pendiente-de-rama.json` falla contra las dos hoy (A7 y A8 esperan la rama funcional; A14 choca con el texto de la #435). La suite los saca del
 * «cero fallos» y fija, con un control negativo, que fallan: se ponen en rojo cuando llegue lo que esperan y entonces el caso pasa a `A.json`.
 * `D-reserva-confirmada.json` (D5 a D8) pasa contra la rama de RESERVA CONFIRMADA (PR #437, fc7621ac) y falla contra main (todavía dice «solicitud» y deriva).
 */
const ARCHIVOS_DE_RAMA = ['A-delivery-opcional.json', 'A-pendiente-de-rama.json', 'D-reserva-confirmada.json', 'A-seguridad-delivery-2.json'];
/**
 * Los casos de esos archivos que PASAN contra main (main no toma texto libre como dato: M1p y L1 derivan igual, M2p no guarda nada, y M1refp no duplica la
 * referencia como dirección). Solo protegen a la rama de delivery opcional: contra su head 542d5f7e M1p, M2p y L1 pasan y M1refp FALLA (ver su nota).
 */
const PASAN_EN_MAIN_DE_RAMA = ['L1', 'M1p', 'M1refp', 'M2p'];
const idsDeRama = (): string[] => ARCHIVOS_DE_RAMA.flatMap((f) => ((JSON.parse(readFileSync(join(CARPETA_CASOS, f), 'utf8')) as J)['casos'] as J[]).map((c) => String(c['id'])));
/**
 * Los casos de SEGURIDAD del texto libre (la cartera, 05/10/2026): el código no debe tomar como dirección ni como referencia lo que no lo es. Fallan contra la rama de
 * delivery opcional en f065863b y deben pasar con su head nuevo. Contra main S1, S2 y S3 fallan (main pide referencia y nombre, y no muestra la carta ahí); S2b y S2c
 * (un número suelto dicho dos veces) PASAN: main nunca lo toma como dirección y a la segunda vez pasa con el local. Esos dos solo protegen a la rama.
 */
const ARCHIVO_SEGURIDAD = 'A-seguridad-texto-libre.json';
const PASAN_EN_MAIN_DE_SEGURIDAD = ['S2b', 'S2c'];
const idsDeSeguridad = (): string[] => ((JSON.parse(readFileSync(join(CARPETA_CASOS, ARCHIVO_SEGURIDAD), 'utf8')) as J)['casos'] as J[]).map((c) => String(c['id']));
/** Los casos que HOY fallan contra main (los de rama y los de seguridad que main no cumple). */
const idsQueFallanEnMain = (): string[] => [...idsDeRama().filter((x) => !PASAN_EN_MAIN_DE_RAMA.includes(x)), ...idsDeSeguridad().filter((x) => !PASAN_EN_MAIN_DE_SEGURIDAD.includes(x))];

interface Modulo {
  main(argv: string[], deps?: J): Promise<number>;
  leerArgumentos(argv: string[]): J;
  validarCasos(datos: unknown, origen?: string): J[];
  leerCasosDeCarpeta(carpeta?: string): { casos: J[]; global: J | null };
  expandirVariantes(caso: J): { etiqueta: string; caso: J }[];
  evaluarEsperado(e: J, r: J, donde?: string): string[];
  textoDeAviso(p: J): string;
  revisarNegativoGlobal(frases: string[], corridas: J[], campo?: string): J[];
  piezasDeEnvio(p: J): string[];
  correrCaso(a: J): Promise<J>;
  panelBase(): J;
}
const B = (await import(pathToFileURL(HERRAMIENTA).href)) as Modulo;

const TOKEN = 'TOKEN-DE-MENTIRA-no-es-un-secreto-xyz';
const flujo = (): J => JSON.parse(readFileSync(RUTA_FLUJO, 'utf8')) as J;
const casosDeLaCarpeta = (): { casos: J[]; global: J | null } => B.leerCasosDeCarpeta();

interface Salida { codigo: number; salida: string; error: string }
interface Mundo { salida: string[]; error: string[]; red: { url: string; encabezados: Record<string, string>; cuerpo: string }[]; deps: J }

/** Un entorno de mentira para `main`: `fetch` de mentira (explota por omisión) y un token de gcloud de mentira. */
function mundo(respuesta?: (cuerpo: J, n: number) => J | string | Error, extra: J = {}): Mundo {
  const m: Mundo = { salida: [], error: [], red: [], deps: {} };
  m.deps = {
    salida: (t: string) => { m.salida.push(t); },
    error: (t: string) => { m.error.push(t); },
    gcloudToken: () => TOKEN,
    fetch: (url: string, init: J) => {
      m.red.push({ url: String(url), encabezados: init['headers'] as Record<string, string>, cuerpo: String(init['body']) });
      if (!respuesta) throw new Error('la red no se toca en esta prueba');
      const r = respuesta(JSON.parse(String(init['body'])) as J, m.red.length);
      if (r instanceof Error) return Promise.reject(r);
      if (typeof r === 'string' && /^HTTP /.test(r)) return Promise.resolve({ ok: false, status: Number(r.slice(5, 8)), text: () => Promise.resolve(r.slice(9)) });
      const texto = typeof r === 'string' ? r : JSON.stringify(r);
      const http = { candidates: [{ content: { parts: [{ text: texto }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, cachedContentTokenCount: 200, thoughtsTokenCount: 10 } };
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(http)) });
    },
    ...extra,
  };
  return m;
}
async function correr(m: Mundo, argv: string[]): Promise<Salida> {
  const codigo = await B.main(argv, m.deps);
  return { codigo, salida: m.salida.join(''), error: m.error.join('') };
}
const json = (s: Salida): J => JSON.parse(s.salida) as J;

const temporales: string[] = [];
afterAll(() => { for (const t of temporales) rmSync(t, { recursive: true, force: true }); });
function carpetaConCasos(archivos: Record<string, string>): string {
  const t = mkdtempSync(join(tmpdir(), 'vm-bateria-'));
  temporales.push(t);
  for (const [nombre, texto] of Object.entries(archivos)) writeFileSync(join(t, nombre), texto);
  return t;
}

// ------------------------------------------------------------------------------ `--seco`: lo determinista, sin red
describe('--seco: todos los casos pasan por el flujo armado, sin clave y sin red', () => {
  it('corre todos los casos de la carpeta con cero fallos, sin una sola llamada de red (el negativo global E8 va aparte, abajo)', async () => {
    const m = mundo();
    const globalFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error('el fetch global no se toca en --seco'); }) as typeof fetch;
    let s: Salida;
    const deRama = new Set(idsQueFallanEnMain());
    const ids = casosDeLaCarpeta().casos.map((c) => String(c['id'])).filter((x) => !deRama.has(x)); // los de una rama se miden aparte, abajo
    try { s = await correr(m, ['--seco', '--json', '--casos', ids.join(',')]); } finally { globalThis.fetch = globalFetch; }
    expect(s.codigo, s.error + '\n' + s.salida.slice(0, 2000)).toBe(0);
    const r = json(s);
    expect(r.modo).toBe('seco');
    expect(r.fallaron, JSON.stringify(r.casos.filter((c: J) => !c.ok).map((c: J) => [c.id, c.por]))).toBe(0);
    expect(r.casos.map((c: J) => c.id)).toEqual(ids);
    expect(m.red, 'ninguna llamada a la red').toHaveLength(0);
    expect(r.total.turnos).toBeGreaterThan(0);
    expect(r.negativoGlobal).toBeNull(); // una lista de casos que no nombra a E8 no lo evalúa
  });

  it('el alcance: los casos son los de los lotes 1 a 3, y cada escenario de A1 a F5 está implementado, es el negativo global o está en los pendientes', () => {
    // A10d es la variante de A10 con el delivery pendiente (ahí «no quiero delivery» SÍ pasa a recojo). El lote 3 es el de delivery opcional (A11 se redefinió con él).
    const lote1 = ['A9', 'A10', 'A10d', 'A12', 'B1', 'B2', 'B3', 'B5'];
    const lote2 = ['B6', 'B7', 'B8', 'B9', 'C7', 'C8', 'C10', 'D1', 'D2', 'D3', 'D4', 'D9', 'E2', 'E3', 'E5', 'E7', 'F2', 'F3', 'F4'];
    const lote3 = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A11', 'A13', 'A14', 'A15'];
    const lote4 = ['S1', 'S2', 'S2b', 'S2c', 'S3']; // seguridad del texto libre
    const lote5 = ['D5', 'D5b', 'D6', 'D7', 'D7b', 'D8']; // reserva confirmada (rama #437); D8c, su control, ya pasa en main y vive en D.json
    const lote6 = ['M1r', 'M1p', 'M1ref', 'M2r', 'M2p', 'L1', 'FB1', 'FB2', 'SV2', 'SV2b']; // seguridad del delivery, 2.ª ronda: pasan contra 542d5f7e
    const lote6x = ['M1s', 'M1sp', 'FB3', 'M1refp']; // los que HOY fallan también contra 542d5f7e (ver A-pendiente-de-rama.json)
    const control = ['D8c'];
    const { casos, global: g } = casosDeLaCarpeta();
    const ids = casos.map((c) => String(c['id']));
    expect([...ids].sort()).toEqual([...lote1, ...lote2, ...lote3, ...lote4, ...lote5, ...lote6, ...lote6x, ...control].sort());
    expect([...idsDeRama()].sort(), 'los casos de rama son los de los lotes 3, 5 y 6').toEqual([...lote3, ...lote5, ...lote6, ...lote6x].sort());
    expect(idsDeSeguridad().sort(), 'los de seguridad son exactamente los del lote 4').toEqual([...lote4].sort());
    const pendientes = ((JSON.parse(readFileSync(join(CARPETA_CASOS, 'pendientes.json'), 'utf8')) as J)['pendientes'] as J[]).map((p) => String(p['id']));
    const grilla: string[] = [];
    for (const [letra, n] of [['A', 15], ['B', 9], ['C', 10], ['D', 9], ['E', 8], ['F', 5]] as const) for (let i = 1; i <= n; i++) grilla.push(`${letra}${i}`);
    const cubiertos = new Set([...ids, ...pendientes, g ? String(g['id']) : '']);
    expect(grilla.filter((x) => !cubiertos.has(x)), 'escenarios sin implementar ni listar').toEqual([]);
  });

  it('la tabla de texto trae una fila por escenario, el resumen y el costo; --tabla la da en Markdown', async () => {
    const s = await correr(mundo(), ['--seco', '--casos', 'A9,B1']);
    expect(s.codigo).toBe(0);
    expect(s.salida).toMatch(/ID\s+TÍTULO\s+CORR\s+RESULTADO\s+POR QUÉ/);
    expect(s.salida).toMatch(/APROBÓ/);
    expect(s.salida).toMatch(/turnos totales: \d+/);
    expect(s.salida).toMatch(/llamadas al modelo/);
    expect(s.salida).toMatch(/Costo: sin uso real \(modo seco\)/);
    const md = await correr(mundo(), ['--seco', '--tabla', '--casos', 'A9,B1']);
    expect(md.salida).toMatch(/^\| ID \| TÍTULO \| CORR \| RESULTADO \| POR QUÉ \|$/m);
    expect(md.salida).toMatch(/^\|---\|---\|---\|---\|---\|$/m);
  });

  it('--casos corre solo los pedidos y un id desconocido es un error de uso', async () => {
    const primero = casosDeLaCarpeta().casos.find((c) => !idsQueFallanEnMain().includes(String(c['id']))) as J; // el primero que pasa contra main
    const s = await correr(mundo(), ['--seco', '--json', '--casos', primero['id']]);
    expect(s.codigo).toBe(0);
    expect(json(s).casos.filter((c: J) => c.id === primero['id'])).toHaveLength(1);
    const mal = await correr(mundo(), ['--seco', '--casos', 'ZZ99']);
    expect(mal.codigo).toBe(2);
    expect(mal.error).toMatch(/Caso desconocido: ZZ99/);
  });

  it('un caso con variantes se corre una vez por frase, desde el mismo estado previo', async () => {
    const conVariantes = casosDeLaCarpeta().casos.find((c) => c['variantes']) as J;
    expect(conVariantes, 'hay al menos un caso con variantes').toBeTruthy();
    const frases = (conVariantes['variantes'] as J)['frases'] as unknown[];
    const x = B.expandirVariantes(conVariantes);
    expect(x).toHaveLength(frases.length);
    const textos = x.map((v) => {
      const c = v.caso['turnos'][conVariantes['variantes'].turno - 1].cliente as J;
      return String(c['texto'] ?? c['transcripcion']);
    });
    expect(new Set(textos).size).toBe(frases.length);
    expect(x.every((v) => v.caso['variantes'] === undefined)).toBe(true);
  });

  it('el resumen cuenta turnos y llamadas al modelo de verdad (A10 llama a «Extraer» una vez por frase)', async () => {
    const s = await correr(mundo(), ['--seco', '--json', '--casos', 'A10']);
    const r = json(s);
    expect(r.total.llamadasModelo).toBe(3);
    expect(r.total.turnos).toBe(6); // (1 previo + 1) por cada una de las 3 frases
  });

  it('el 05/10 las bebidas siguen en el delivery: el valor vivo de areasSinDelivery (vacío) gobierna la batería', async () => {
    // Con el valor del JSON versionado («Bebidas») A12 quitaría las bebidas del pedido; la batería corre con lo publicado.
    const f = flujo();
    const base = (f['nodes'] as J[]).find((n) => n['name'] === 'Config base') as J;
    const a = (base['parameters'].assignments.assignments as J[]).find((x) => x['name'] === 'areasSinDelivery') as J;
    expect(a['value']).toBe('Bebidas'); // el JSON versionado: si esto cambia (se vacía en main), la excepción CONFIG_VIVA sobra y hay que quitarla
    const caso = casosDeLaCarpeta().casos.find((c) => c['id'] === 'A12') as J;
    const corrida = await B.correrCaso({ caso, rep: 1, flujo: f, opciones: { seco: true }, credencial: {}, deps: {} });
    expect(corrida['ok'], JSON.stringify(corrida['fallas'])).toBe(true);
  });
});

// ------------------------------------------------------------------------------ lote 3: delivery y entrega (rama de delivery opcional, #435)
describe('lote 3 (delivery y entrega): los casos de la rama FALLAN contra main (control negativo) y A10 mide su defecto', () => {
  // Estos casos pasan contra la rama de delivery opcional (PR #435: se comprobó en un worktree temporal con la batería fusionada encima de
  // origin/cartera/qtaco-delivery-opcional; en `--seco`: A1–A6, A11, A13 y A15 pasan; A7 pasa 2 de 3 frases, y A8 y A14 fallan por lo que dicen sus archivos).
  // Contra main FALLAN porque main todavía pide referencia y nombre. Cuando la rama se fusione, esta prueba se pone ROJA: se mueven los casos que ya
  // pasan de `A-delivery-opcional.json` a `A.json` y se ajusta la lista de abajo.
  it('contra main, cada caso de los archivos de rama falla en --seco (ninguno pasa por casualidad)', async () => {
    const ids = idsDeRama();
    const s = await correr(mundo(), ['--seco', '--json', '--casos', ids.join(',')]);
    expect(s.codigo, s.error).toBe(1);
    const r = json(s);
    const pasan = r.casos.filter((c: J) => c.ok).map((c: J) => c.id);
    expect([...pasan].sort(), 'estos casos ya pasan contra main: pasan a A.json y salen de los archivos de rama').toEqual([...PASAN_EN_MAIN_DE_RAMA].sort());
    expect(r.casos.map((c: J) => c.id)).toEqual(ids);
  });

  it('contra main A7 pasa dos frases de tres (el cambio con «cambiar al delivery» ya lo cubre #426) y falla «quiero que me manden», que deriva a una persona', async () => {
    const s = await correr(mundo(), ['--seco', '--json', '--casos', 'A7']);
    const a7 = json(s).casos.find((c: J) => c.id === 'A7') as J;
    expect(a7.corridas).toBe(3);
    expect(a7.aprobaron).toBe(2);
    expect(String(a7.por)).toMatch(/quiero que me manden/);
    expect(String(a7.por)).toMatch(/persona|direcci/);
  });

  it('A14 falla por la referencia: la pregunta de la dirección menciona una referencia y el escenario dice que NUNCA se pide en el chat', async () => {
    const s = await correr(mundo(), ['--seco', '--json', '--casos', 'A14']);
    const a14 = json(s).casos.find((c: J) => c.id === 'A14') as J;
    expect(a14.ok).toBe(false);
    expect(String(a14.por)).toMatch(/referencia/);
  });

  // ---- seguridad del texto libre (A-seguridad-texto-libre.json)
  it('seguridad: contra main S1, S2 y S3 fallan (pasan con el head nuevo de la rama) y S2b y S2c pasan (main nunca toma un número suelto como dirección)', async () => {
    const s = await correr(mundo(), ['--seco', '--json', '--casos', idsDeSeguridad().join(',')]);
    const r = json(s);
    const estado = Object.fromEntries(r.casos.map((c: J) => [c.id, c.ok]));
    expect(estado).toEqual({ S1: false, S2: false, S2b: true, S2c: true, S3: false });
  });

  it('seguridad: el texto libre que NO es un dato (órdenes, ayuda, consultas, carta, comprobante, números sueltos) se mide con invariantes de estado, no con frases', () => {
    const { casos } = B.leerCasosDeCarpeta();
    const seg = casos.filter((c) => idsDeSeguridad().includes(String(c['id'])));
    for (const c of seg) {
      const nota = JSON.stringify(c);
      if (c['id'] !== 'S3') expect(nota, `${c['id']} asierta que la dirección o la referencia no se guardaron`).toMatch(/entrega\.(direccion|referencia)/);
    }
    const s3 = seg.find((c) => c['id'] === 'S3') as J;
    expect(String(s3['nota'])).toMatch(/POR CONFIRMAR CON LA CARTERA/); // lo único no resuelto: si la segunda instrucción reemplaza o completa la referencia
  });

  it('A10 mide el defecto: si el modelo lee «no quiero delivery» como delivery, el flujo cambia la entrega y el caso falla; con la respuesta fija de siempre, pasa', async () => {
    const caso = casosDeLaCarpeta().casos.find((c) => c['id'] === 'A10') as J;
    const f = flujo();
    const bueno = await B.correrCaso({ caso: B.expandirVariantes(caso)[0]!.caso, rep: 1, flujo: f, opciones: { seco: true }, credencial: {}, deps: {} });
    expect(bueno['ok'], JSON.stringify(bueno['fallas'])).toBe(true);
    const malo = B.expandirVariantes(caso)[0]!.caso;
    (malo['turnos'] as J[])[0]!['seco'] = { lineas: [], entrega: 'delivery' };
    const c = await B.correrCaso({ caso: malo, rep: 1, flujo: f, opciones: { seco: true }, credencial: {}, deps: {} });
    expect(c['ok']).toBe(false);
    expect(JSON.stringify(c['fallas'])).toMatch(/entrega/);
  });

  it('A10d (delivery pendiente): lo mismo que dice el cliente SÍ pasa a recojo, y si el modelo no lo entiende (líneas vacías) el caso falla en vez de aprobar', async () => {
    const caso = casosDeLaCarpeta().casos.find((c) => c['id'] === 'A10d') as J;
    const malo = B.expandirVariantes(caso)[0]!.caso;
    (malo['turnos'] as J[])[0]!['seco'] = { lineas: [] };
    const c = await B.correrCaso({ caso: malo, rep: 1, flujo: flujo(), opciones: { seco: true }, credencial: {}, deps: {} });
    expect(c['ok']).toBe(false);
  });
});

// ------------------------------------------------------------------------------ la batería mide el flujo (control negativo)
describe('la batería MIDE el flujo: con una avería inyectada, el caso falla', () => {
  /** Una copia del flujo con un cambio en el código de «Decidir turno» (nunca se escribe en el repositorio). */
  function flujoAveriado(de: string, a: string): J {
    const f = flujo();
    const n = (f['nodes'] as J[]).find((x) => x['name'] === 'Decidir turno') as J;
    expect(String(n['parameters'].jsCode)).toContain(de);
    n['parameters'].jsCode = String(n['parameters'].jsCode).replace(de, a);
    return f;
  }
  it('A9 pasa con el flujo real y falla si «Decidir turno» ya no cambia a recojo', async () => {
    const caso = casosDeLaCarpeta().casos.find((c) => c['id'] === 'A9') as J;
    const sano = await B.correrCaso({ caso: B.expandirVariantes(caso)[0]!.caso, rep: 1, flujo: flujo(), opciones: { seco: true }, credencial: {}, deps: {} });
    expect(sano['ok'], JSON.stringify(sano['fallas'])).toBe(true);
    const roto = await B.correrCaso({
      caso: B.expandirVariantes(caso)[0]!.caso, rep: 1, flujo: flujoAveriado('cfg.aceptaRetiroEnLocal !== false &&', 'false &&'), opciones: { seco: true }, credencial: {}, deps: {},
    });
    expect(roto['ok']).toBe(false);
    expect(JSON.stringify(roto['fallas'])).toMatch(/entrega\.entrega|recojo/);
  });

  it('un nodo que lanza deja el fallo en el turno (el caso lo ve): sin `esperado.fallo`, es un incumplimiento', async () => {
    const caso = { id: 'ZZ1', titulo: 'x', turnos: [{ cliente: { tipo: 'texto', texto: 'hola' }, esperado: {} }] };
    const f = flujo();
    const n = (f['nodes'] as J[]).find((x) => x['name'] === 'Decidir turno') as J;
    n['parameters'].jsCode = 'throw new Error("avería de prueba");';
    const c = await B.correrCaso({ caso, rep: 1, flujo: f, opciones: { seco: true }, credencial: {}, deps: {} });
    expect(c['ok']).toBe(false);
    expect(JSON.stringify(c['fallas'])).toMatch(/Decidir turno/);
    // …y declarado en `esperado.fallo`, el mismo turno cumple.
    const declarado = { ...caso, turnos: [{ cliente: { tipo: 'texto', texto: 'hola' }, esperado: { fallo: 'Decidir turno' } }] };
    const ok = await B.correrCaso({ caso: declarado, rep: 1, flujo: f, opciones: { seco: true }, credencial: {}, deps: {} });
    expect(ok['ok'], JSON.stringify(ok['fallas'])).toBe(true);
  });

  it('el botón se toca por título entre lo que el flujo mostró: sin ese botón, el caso falla en vez de inventarlo', async () => {
    const caso = { id: 'ZZ2', titulo: 'x', turnos: [{ cliente: { tipo: 'boton', titulo: 'Botón que no existe' } }] };
    const c = await B.correrCaso({ caso, rep: 1, flujo: flujo(), opciones: { seco: true }, credencial: {}, deps: {} });
    expect(c['ok']).toBe(false);
    expect(JSON.stringify(c['fallas'])).toMatch(/no había un botón «Botón que no existe»/);
  });

  it('un estado previo que no se logra lo dice (y no mide lo que sigue)', async () => {
    const caso = { id: 'ZZ3', titulo: 'x', estadoPrevio: [{ cliente: { tipo: 'texto', texto: 'hola' }, esperado: { estado: { paso: 'pedido_confirmar' } } }], turnos: [{ cliente: { tipo: 'texto', texto: 'hola' } }] };
    const c = await B.correrCaso({ caso, rep: 1, flujo: flujo(), opciones: { seco: true }, credencial: {}, deps: {} });
    expect(c['ok']).toBe(false);
    expect(c['previoLogrado']).toBe(false);
    expect(c['turnos']).toBe(1);
  });
});

// ------------------------------------------------------------------------------ el motor: reloj, perfil, enlaces, reporte del QR
describe('el motor del caso: reloj, perfil, botón de enlace, reporte del QR y esperado por frase', () => {
  const H7 = 'lun=00:00-24:00,mar=00:00-24:00,mie=00:00-24:00,jue=00:00-24:00,vie=00:00-24:00,sab=00:00-24:00,dom=00:00-24:00';
  const correrUno = (caso: J): Promise<J> => B.correrCaso({ caso, rep: 1, flujo: flujo(), opciones: { seco: true }, credencial: {}, deps: {} });
  const tx = (texto: string): J => ({ tipo: 'texto', texto });
  const bt = (titulo: string): J => ({ tipo: 'boton', titulo });
  const pedirALas3 = (esperado: J, config: J = {}): J => ({
    id: 'ZZ4', titulo: 'x', reloj: '2026-10-06T03:00:00-04:00', config,
    turnos: [{ cliente: tx('hola') }, { cliente: bt('Hacer un pedido'), esperado }],
  });

  it('el reloj del caso manda: a las 3 de la mañana el horario real cierra los pedidos y el 7×24 los abre (y lo contrario falla)', async () => {
    const cerrado = await correrUno(pedirALas3({ textos: ['no estamos tomando pedidos'], textosNo: ['Esta es nuestra carta'] }));
    expect(cerrado['ok'], JSON.stringify(cerrado['fallas'])).toBe(true);
    const abierto = await correrUno(pedirALas3({ textos: ['Esta es nuestra carta'], textosNo: ['no estamos tomando pedidos'] }, { horario: H7 }));
    expect(abierto['ok'], JSON.stringify(abierto['fallas'])).toBe(true);
    const mal = await correrUno(pedirALas3({ textos: ['Esta es nuestra carta'] }));
    expect(mal['ok']).toBe(false);
  });

  it('el reloj del caso debe ser una fecha ISO con desfase', () => {
    for (const reloj of ['mañana', '2026-10-06 13:00', '2026-10-06T13:00:00', '2026-13-45T25:00:00-04:00']) {
      expect(() => B.validarCasos({ casos: [{ id: 'ZZ5', titulo: 'x', reloj, turnos: [{ cliente: { tipo: 'texto', texto: 'hola' } }] }] }), reloj).toThrow(/reloj/);
    }
    expect(B.validarCasos({ casos: [{ id: 'ZZ5', titulo: 'x', reloj: '2026-10-06T13:00:00-04:00', perfil: '', turnos: [{ cliente: { tipo: 'texto', texto: 'hola' } }] }] })).toHaveLength(1);
  });

  it('el perfil de WhatsApp del caso llega al flujo: con nombre de perfil la reserva ya lo tiene; sin él, lo pide', async () => {
    const reservar = (perfil: string | undefined, textos: string[]): J => ({
      id: 'ZZ6', titulo: 'x', ...(perfil === undefined ? {} : { perfil }),
      turnos: [{ cliente: tx('hola') }, { cliente: bt('Reservar mesa') }, { cliente: tx('somos 2 el jueves a las 7 pm'), seco: { personas: 2, fecha: '2026-10-08', hora: '19:00' }, esperado: { textos } }],
    });
    const con = await correrUno(reservar(undefined, ['A nombre de Carlos Pérez']));
    expect(con['ok'], JSON.stringify(con['fallas'])).toBe(true);
    const sin = await correrUno(reservar('', ['Me falta: a nombre de quién']));
    expect(sin['ok'], JSON.stringify(sin['fallas'])).toBe(true);
    const cruzado = await correrUno(reservar('', ['A nombre de Carlos Pérez']));
    expect(cruzado['ok']).toBe(false);
  });

  it('el botón de enlace cuenta como título y su URL se puede exigir (el destino de «Escribir al local» es la recepción)', async () => {
    const derivar = (esperado: J): J => ({ id: 'ZZ7', titulo: 'x', turnos: [{ cliente: tx('hola') }, { cliente: tx('quiero hablar con una persona'), esperado }] });
    const ok = await correrUno(derivar({ titulos: ['Escribir al local'], enlaces: ['wa\\.me/59100000031'], efectos: { derivacion: true, aviso: true } }));
    expect(ok['ok'], JSON.stringify(ok['fallas'])).toBe(true);
    const otro = await correrUno(derivar({ enlaces: ['wa\\.me/59100000099'] }));
    expect(otro['ok']).toBe(false);
    expect(JSON.stringify(otro['fallas'])).toMatch(/botón de enlace con/);
  });

  it('el reporte del QR al servidor se puede exigir, y su ausencia es un incumplimiento', async () => {
    const pedido = (esperado: J, esperadoSinQr: J = {}): J => ({
      id: 'ZZ8', titulo: 'x',
      turnos: [{ cliente: { tipo: 'carrito', items: [{ id: 'cat_birria1', cantidad: 1 }], entrega: 'retiro' }, esperado: esperadoSinQr }, { cliente: bt('Confirmar pedido'), esperado }],
    });
    const ok = await correrUno(pedido({ efectos: { qr: true }, reporteQr: { monto: 21, referencia: { regex: '^ped-' }, evento: 'qr_enviado' } }));
    expect(ok['ok'], JSON.stringify(ok['fallas'])).toBe(true);
    const mal = await correrUno(pedido({ reporteQr: { monto: 22 } }));
    expect(mal['ok']).toBe(false);
    expect(JSON.stringify(mal['fallas'])).toMatch(/reporte qr_enviado\.monto/);
    const sinQr = await correrUno(pedido({}, { reporteQr: { monto: 21 } }));
    expect(sinQr['ok']).toBe(false);
    expect(JSON.stringify(sinQr['fallas'])).toMatch(/no lo hizo/);
  });

  it('una frase de las variantes trae su propio esperado, que se mezcla sobre el del turno (el estado, ruta por ruta)', () => {
    const caso: J = {
      id: 'ZZ9', titulo: 'x',
      turnos: [{ cliente: tx('x'), esperado: { mensajes: 1, estado: { paso: 'pedido', 'entrega.entrega': '' } } }],
      variantes: { turno: 1, frases: ['a', { texto: 'b', esperado: { mensajes: 2, estado: { 'entrega.entrega': 'delivery' } } }] },
    };
    expect(B.validarCasos({ casos: [caso] })).toHaveLength(1);
    const [a, b] = B.expandirVariantes(caso);
    expect(a!.caso['turnos'][0].esperado).toEqual({ mensajes: 1, estado: { paso: 'pedido', 'entrega.entrega': '' } });
    expect(b!.caso['turnos'][0].esperado).toEqual({ mensajes: 2, estado: { paso: 'pedido', 'entrega.entrega': 'delivery' } });
    const malo = structuredClone(caso);
    malo['variantes'].frases[1].esperado = { estado: { 'a b': 1 } };
    expect(() => B.validarCasos({ casos: [malo] })).toThrow(/ruta de estado/);
  });

  it('--casos: el negativo global corre con todos los casos o si se nombra (sola, corre todos), no con una lista que no lo nombra', async () => {
    const dos = [{ id: 'Q1', titulo: 'uno', turnos: [{ cliente: tx('hola') }] }, { id: 'Q2', titulo: 'dos', turnos: [{ cliente: tx('hola') }] }];
    const global = { id: 'E8', titulo: 'g', frases: ['zzz'] };
    const via = (argv: string[]) => correr(mundo(undefined, { leerCasos: () => ({ casos: dos, global }) }), ['--seco', '--json', ...argv]);
    const todos = json(await via([]));
    expect(todos.negativoGlobal.id).toBe('E8');
    expect(todos.casos.map((c: J) => c.id)).toEqual(['Q1', 'Q2', 'E8']);
    const lista = json(await via(['--casos', 'Q2']));
    expect(lista.negativoGlobal).toBeNull();
    expect(lista.casos.map((c: J) => c.id)).toEqual(['Q2']);
    const sola = json(await via(['--casos', 'E8']));
    expect(sola.casos.map((c: J) => c.id)).toEqual(['Q1', 'Q2', 'E8']);
    const mezcla = json(await via(['--casos', 'Q1,E8']));
    expect(mezcla.casos.map((c: J) => c.id)).toEqual(['Q1', 'E8']);
  });
});

// ------------------------------------------------------------------------------ el evaluador de `esperado`
describe('evaluarEsperado detecta cada tipo de incumplimiento (y no acusa a lo que cumple)', () => {
  const mensaje = (piezas: string[], botones: { id: string; title: string }[] = [], filas: { id: string; title: string }[] = []) => ({ tipo: 'interactive', piezas, botones, filas, ok: true });
  const resultado = (extra: J = {}): J => ({
    mensajes: [mensaje(['Tu pedido: 2 × Tacos. Total 110 Bs.', 'Confirmar pedido'], [{ id: 'p|confirmar', title: 'Confirmar pedido' }])],
    estado: { paso: 'pedido_confirmar', entrega: { entrega: 'recojo' }, carrito: [{ id: 'a' }] }, estadoAntes: { paso: 'pedido', entrega: { entrega: 'delivery' }, carrito: [{ id: 'a' }] },
    avisos: 0, ruta: 'boton:x', qr: false, modelo: 0, cierre: 0, fallo: null, ...extra,
  });
  const fallas = (e: J, r: J = resultado()): string => B.evaluarEsperado(e, r).join(' | ');

  it('lo que cumple no acusa', () => {
    expect(B.evaluarEsperado({
      mensajes: 1, textos: ['tu pedido', 'Total \\d+ Bs'], textosNo: ['pago acreditado'], botones: ['p|confirmar'], botonesNo: ['p|cambiar'], titulos: ['Confirmar'], titulosNo: ['Cancelar'],
      estado: { paso: 'pedido_confirmar', 'entrega.entrega': 'recojo', carrito: { longitud: 1 }, 'entrega.direccion': { vacio: true } }, igualAntes: ['carrito'],
      efectos: { aviso: false, derivacion: false, qr: false, modelo: false, cierre: false }, ruta: '^boton', fallo: null,
    }, resultado())).toEqual([]);
  });
  it('texto que falta, texto prohibido (también sin tildes y sin mayúsculas) y cantidad de mensajes', () => {
    expect(fallas({ textos: ['reserva'] })).toMatch(/esperaba un texto con \/reserva\//);
    expect(fallas({ textosNo: ['TACOS'] })).toMatch(/no debía aparecer/);
    expect(fallas({ textosNo: ['confirmar pedido'] })).toMatch(/no debía aparecer/);
    expect(fallas({ mensajes: 2 })).toMatch(/esperaba 2 mensaje/);
    expect(fallas({ mensajes: { min: 0, max: 0 } })).toMatch(/esperaba/);
    expect(B.evaluarEsperado({ textos: ['qué tal\\?'] }, resultado({ mensajes: [mensaje(['Que tal?'])] }))).toEqual([]); // normalizado: sin tildes ni apertura
  });
  it('botones, filas y títulos', () => {
    expect(fallas({ botones: ['p|cambiar'] })).toMatch(/esperaba el botón o fila «p\|cambiar»/);
    expect(fallas({ botonesNo: ['p|confirmar'] })).toMatch(/no debía haber el botón/);
    expect(fallas({ titulos: ['Cambiar algo'] })).toMatch(/esperaba un botón con título/);
    expect(fallas({ titulosNo: ['Confirmar pedido'] })).toMatch(/no debía haber un botón/);
    expect(B.evaluarEsperado({ botones: ['m|reserva'] }, resultado({ mensajes: [mensaje(['Menú'], [], [{ id: 'm|reserva', title: 'Reservar' }])] }))).toEqual([]);
  });
  it('estado: escalar, regex, vacío, existe, longitud, contiene, y «igual que antes»', () => {
    expect(fallas({ estado: { paso: 'pedido' } })).toMatch(/estado\.paso: vale «pedido_confirmar» y se esperaba «pedido»/);
    expect(fallas({ estado: { 'entrega.entrega': 'delivery' } })).toMatch(/estado\.entrega\.entrega/);
    expect(fallas({ estado: { paso: { regex: '^pedido$' } } })).toMatch(/no coincide/);
    expect(fallas({ estado: { paso: { noRegex: 'confirmar' } } })).toMatch(/coincide/);
    expect(fallas({ estado: { carrito: { vacio: true } } })).toMatch(/debía estar vacío/);
    expect(fallas({ estado: { carrito: { longitud: 2 } } })).toMatch(/longitud es 1/);
    expect(fallas({ estado: { 'no.existe': { existe: true } } })).toMatch(/debía existir/);
    expect(fallas({ estado: { paso: { contiene: 'zzz' } } })).toMatch(/no contiene/);
    expect(fallas({ igualAntes: ['entrega.entrega'] })).toMatch(/debía quedar igual y cambió/);
    expect(fallas({ igualAntes: ['carrito'] })).toBe('');
  });
  it('efectos, ruta y fallo de nodo', () => {
    expect(fallas({ efectos: { aviso: true } })).toMatch(/efecto «aviso»: se esperaba que ocurriera y no ocurrió/);
    expect(fallas({ efectos: { derivacion: true } })).toMatch(/efecto «derivacion»/);
    expect(fallas({ efectos: { aviso: false } }, resultado({ avisos: 1 }))).toMatch(/NO ocurriera y ocurrió/);
    expect(fallas({ efectos: { derivacion: false } }, resultado({ ruta: 'transferir:pidió una persona' }))).toMatch(/efecto «derivacion»/);
    expect(fallas({ efectos: { qr: false } }, resultado({ qr: true }))).toMatch(/efecto «qr»/);
    expect(fallas({ efectos: { modelo: false } }, resultado({ modelo: 1 }))).toMatch(/efecto «modelo»/);
    expect(fallas({ efectos: { cierre: true } })).toMatch(/efecto «cierre»/);
    expect(fallas({ ruta: '^pedido:' })).toMatch(/no coincide/);
    expect(fallas({}, resultado({ fallo: { nodo: 'Armar mensajes', mensaje: 'boom' } }))).toMatch(/falló el nodo «Armar mensajes»: boom/);
    expect(fallas({ fallo: 'Resumen del turno' })).toMatch(/se esperaba que fallara «Resumen del turno»/);
    expect(fallas({ fallo: 'Resumen del turno' }, resultado({ fallo: { nodo: 'Resumen del turno', mensaje: 'x' } }))).toBe('');
  });
  it('los textos que ve el cliente incluyen cuerpo, pie, botones, filas, el botón de enlace y el pie de la imagen', () => {
    const p = B.piezasDeEnvio({
      type: 'interactive', interactive: { type: 'cta_url', header: { text: 'Encabezado' }, body: { text: 'Cuerpo' }, footer: { text: 'Pie' }, action: { name: 'cta_url', parameters: { display_text: 'Ver la carta', url: 'https://ejemplo.invalid/x' } } },
    });
    expect(p).toEqual(['Encabezado', 'Cuerpo', 'Pie', 'Ver la carta']);
    expect(B.piezasDeEnvio({ type: 'image', image: { link: 'https://ejemplo.invalid/q.png', caption: 'Escanea' } })).toEqual(['Escanea']);
    expect(B.piezasDeEnvio({ type: 'text', text: { body: 'Hola' } })).toEqual(['Hola']);
  });
});

// ------------------------------------------------------------------------------ E8: el negativo global
describe('E8, el negativo global: ninguna frase prohibida en lo que el cliente recibe', () => {
  const FRASES = ['pago acreditado', '\\bellos\\b', 'escr[ií]beles'];
  it('revisarNegativoGlobal encuentra cada frase inyectada (con tildes o sin ellas) y no acusa a un texto limpio', () => {
    const corridas = [
      { caso: 'X1', rep: 1, textos: [{ turno: 1, texto: 'Tu pago acreditado ya está' }, { turno: 2, texto: 'Listo, nos vemos' }] },
      { caso: 'X2', rep: 1, textos: [{ turno: 3, texto: 'ESCRÍBELES al local' }, { turno: 4, texto: 'ellos revisan el pago' }] },
    ];
    const v = B.revisarNegativoGlobal(FRASES, corridas);
    expect(v.map((x) => `${x['caso']} T${x['turno']} ${x['frase']}`)).toEqual(['X1 T1 pago acreditado', 'X2 T3 escr[ií]beles', 'X2 T4 \\bellos\\b']);
    expect(B.revisarNegativoGlobal(FRASES, [{ caso: 'X3', rep: 1, textos: [{ turno: 1, texto: 'Estamos en la calle Ejemplo, pasamos por ti' }] }])).toEqual([]);
  });

  /** Un negocio cuya dirección dice una frase prohibida: la consulta fija «¿dónde están?» la repite al cliente (de verdad, por el flujo). */
  const caso = (direccion: string): J => ({
    id: 'ZZ8', titulo: 'dirección con frase prohibida', panel: { datosDelNegocio: { nombreNegocio: "Q'Taco Mexican Grill", direccion } },
    turnos: [{ cliente: { tipo: 'texto', texto: '¿dónde están ubicados?' }, esperado: { textos: ['calle'] } }],
  });
  const global = { id: 'E8', titulo: 'negativo global', frases: FRASES };

  it('el flujo emite la frase y la batería la detecta (código 1); sin la frase, código 0', async () => {
    const malo = mundo(undefined, { leerCasos: () => ({ casos: [caso('Calle Ejemplo 1; escríbeles al llegar')], global }) });
    const s = await correr(malo, ['--seco', '--json']);
    expect(s.codigo, s.error).toBe(1);
    const r = json(s);
    expect(r.casos.find((c: J) => c.id === 'ZZ8').ok).toBe(true); // el caso en sí cumple…
    expect(r.casos.find((c: J) => c.id === 'E8').ok).toBe(false); // …y E8 lo acusa aparte
    expect(r.negativoGlobal.violaciones.map((v: J) => v.frase)).toContain('escr[ií]beles');
    const texto = await correr(mundo(undefined, { leerCasos: () => ({ casos: [caso('Calle Ejemplo 1; escríbeles al llegar')], global }) }), ['--seco']);
    expect(texto.salida).toMatch(/Negativo global E8: 1 violación/);
    expect(texto.salida).toMatch(/\[ZZ8 T1\] «escr\[ií\]beles»/);
    const sano = mundo(undefined, { leerCasos: () => ({ casos: [caso('Calle Ejemplo 1, zona Sur')], global }) });
    const ok = await correr(sano, ['--seco', '--json']);
    expect(ok.codigo, ok.error).toBe(0);
    expect(json(ok).negativoGlobal.violaciones).toHaveLength(0);
  });

  // HOY (main, 05/10/2026) E8 FALLA, y es un defecto real que arregla la rama de voz: el texto de la derivación dice «hablar con ellos» y los de
  // comprobante dicen «Si quieres hablar con ellos» y «ellos revisan el pago en su banco». `it.fails` pasa mientras E8 falle y se pone ROJA cuando se
  // arregle: entonces se quita el `.fails`, se borra la prueba de al lado y E8 queda como cualquier otro caso.
  it.fails('E8 sobre main: ninguna frase prohibida en lo que el cliente recibe (HOY FALLA: «ellos»; lo arregla la rama de voz)', async () => {
    const s = await correr(mundo(), ['--seco', '--json']);
    expect(json(s).negativoGlobal.violaciones).toHaveLength(0);
  });
  it('E8 sobre main, lo que se sabe HOY: la única frase prohibida que sale es «ellos», en la derivación y en los comprobantes que pasan con el local', async () => {
    const s = await correr(mundo(), ['--seco', '--json']);
    expect(s.codigo).toBe(1);
    const v = json(s).negativoGlobal.violaciones as J[];
    expect([...new Set(v.map((x) => x['frase']))]).toEqual(['\\bellos\\b']);
    // A7 se suma desde el lote 3: «quiero que me manden» deriva hoy con el texto genérico («para hablar con ellos»), el defecto que espera la rama funcional.
    // S2b, S2c y S3 se suman con el lote 4 por lo mismo: la segunda vez sin líneas (o la tercera, en S3) main pasa con el local con el texto genérico.
    expect([...new Set(v.map((x) => x['caso']))].sort()).toEqual(['A7', 'B9', 'C10', 'C7', 'E2', 'E7', 'L1', 'M1p', 'S2b', 'S2c', 'S3', 'SV2']);
    // L1, M1p y SV2 (seguridad del delivery, 2.ª ronda) también derivan con el texto genérico, por lo mismo.
    // Los textos de respaldo (solo si Meta rechaza el interactivo) además dicen «Escríbeles aquí»: aviso, no fallo.
    const latentes = json(s).negativoGlobal.latentes as J[];
    expect(latentes.some((x) => x['frase'] === 'escr[ií]beles')).toBe(true);
  });

  it('el negativo global de la carpeta cubre las frases del escenario E8', () => {
    const { global: g } = casosDeLaCarpeta();
    expect(g, 'E.json trae el negativo global').toBeTruthy();
    if (!g) return;
    expect(g.id).toBe('E8');
    const aprobadas: [string, boolean][] = [
      ['pago acreditado', true], ['Tu pago verificado', true], ['recibimos tu pago', true], ['verificamos tu pago', true], ['gracias por tu pago', true],
      ['reservamos tu mesa', true], ['quedó cancelado', true], ['Ellos revisan', true], ['Escríbeles', true], ['todavía no es una reserva', true],
      ['Los datos coinciden con tu pedido; el equipo revisa el pago en el banco', false],
    ];
    for (const [texto, debe] of aprobadas) {
      const v = B.revisarNegativoGlobal(g['frases'], [{ caso: 'X', rep: 1, textos: [{ turno: 1, texto }] }]);
      expect(v.length > 0, texto).toBe(debe);
    }
  });
});

// ------------------------------------------------------------------------------ casos mal formados y argumentos
describe('un caso mal formado o un argumento malo es un error de uso (código 2), sin red ni traza', () => {
  const bueno = (): J => ({ id: 'OK1', titulo: 't', turnos: [{ cliente: { tipo: 'texto', texto: 'hola' } }] });
  const malos: [string, (c: J) => void, RegExp][] = [
    ['sin título', (c) => { delete c['titulo']; }, /sin título/],
    ['sin turnos', (c) => { c['turnos'] = []; }, /sin turnos/],
    ['id con caracteres raros', (c) => { c['id'] = 'A 9!'; }, /sin id válido/],
    ['tipo de turno desconocido', (c) => { c['turnos'][0].cliente.tipo = 'telepatia'; }, /cliente\.tipo/],
    ['texto que falta', (c) => { delete c['turnos'][0].cliente.texto; }, /falta el texto/],
    ['botón sin id ni título', (c) => { c['turnos'][0].cliente = { tipo: 'boton' }; }, /falta el id o el titulo/],
    ['audio sin transcripción', (c) => { c['turnos'][0].cliente = { tipo: 'audio' }; }, /transcripción/],
    ['carrito sin ítems', (c) => { c['turnos'][0].cliente = { tipo: 'carrito', items: [] }; }, /carrito necesita/],
    ['«esperado» con una clave desconocida', (c) => { c['turnos'][0].esperado = { textoo: ['x'] }; }, /clave desconocida/],
    ['expresión regular inválida', (c) => { c['turnos'][0].esperado = { textos: ['(sin cerrar'] }; }, /no es válida/],
    ['efecto desconocido', (c) => { c['turnos'][0].esperado = { efectos: { magia: true } }; }, /clave desconocida/],
    ['efecto que no es booleano', (c) => { c['turnos'][0].esperado = { efectos: { aviso: 'si' } }; }, /true o false/],
    ['condición de estado desconocida', (c) => { c['turnos'][0].esperado = { estado: { paso: { casi: 1 } } }; }, /condición desconocida/],
    ['ruta de estado inválida', (c) => { c['turnos'][0].esperado = { estado: { 'a b': 1 } }; }, /ruta de estado/],
    ['«mensajes» que no es un número', (c) => { c['turnos'][0].esperado = { mensajes: 'uno' }; }, /entero o/],
    ['«seco» que no es objeto ni texto', (c) => { c['turnos'][0].seco = 5; }, /«seco»/],
    ['variantes sobre un turno que no es texto', (c) => { c['turnos'][0].cliente = { tipo: 'boton', id: 'x' }; c['variantes'] = { turno: 1, frases: ['a'] }; }, /texto o audio/],
    ['variantes con un turno que no existe', (c) => { c['variantes'] = { turno: 3, frases: ['a'] }; }, /variantes/],
    ['estadoPrevio que no es una lista', (c) => { c['estadoPrevio'] = {}; }, /estadoPrevio/],
  ];
  for (const [nombre, romper, patron] of malos) {
    it(`${nombre}: validarCasos lo rechaza y main sale con 2`, async () => {
      const c = bueno();
      romper(c);
      expect(() => B.validarCasos({ casos: [c] }, 'prueba.json')).toThrow(patron);
      const m = mundo(undefined, { leerCasos: () => ({ casos: B.validarCasos({ casos: [c] }, 'prueba.json'), global: null }) });
      const s = await correr(m, ['--seco']);
      expect(s.codigo).toBe(2);
      expect(s.error).toMatch(patron);
      expect(s.error).not.toMatch(/at .*\.mjs/); // sin traza
      expect(m.red).toHaveLength(0);
    });
  }
  it('el caso bueno de la prueba pasa la validación y corre', async () => {
    expect(B.validarCasos({ casos: [bueno()] })).toHaveLength(1);
    const s = await correr(mundo(undefined, { leerCasos: () => ({ casos: [bueno()], global: null }) }), ['--seco']);
    expect(s.codigo, s.error).toBe(0);
  });

  it('la carpeta de casos: un JSON roto, un id repetido entre archivos y un negativo global sin frases son errores de uso', () => {
    const roto = carpetaConCasos({ 'A.json': '{ no es json' });
    expect(() => B.leerCasosDeCarpeta(roto)).toThrow(/A\.json: no es un JSON válido/);
    const repetido = carpetaConCasos({ 'A.json': JSON.stringify({ casos: [bueno()] }), 'B.json': JSON.stringify({ casos: [bueno()] }) });
    expect(() => B.leerCasosDeCarpeta(repetido)).toThrow(/id repetido OK1/);
    const sinFrases = carpetaConCasos({ 'E.json': JSON.stringify({ casos: [bueno()], negativoGlobal: { id: 'E8', frases: [] } }) });
    expect(() => B.leerCasosDeCarpeta(sinFrases)).toThrow(/negativoGlobal/);
    const sinLista = carpetaConCasos({ 'A.json': JSON.stringify({ seccion: 'A' }) });
    expect(() => B.leerCasosDeCarpeta(sinLista)).toThrow(/falta la lista «casos»/);
    // Negativo: una carpeta bien formada se lee, y `pendientes.json` no se toma por una sección de casos.
    const bien = carpetaConCasos({ 'A.json': JSON.stringify({ casos: [bueno()] }), 'pendientes.json': JSON.stringify({ pendientes: [{ id: 'Z1', espera: 'rama x' }] }) });
    expect(B.leerCasosDeCarpeta(bien).casos.map((c) => c['id'])).toEqual(['OK1']);
  });

  it('los argumentos se validan: opciones desconocidas, valores que faltan, rangos, y hay que elegir --seco o --vertex', async () => {
    const mal: [string[], RegExp][] = [
      [['--seco', '--que'], /Opción desconocida/],
      [['--seco', '--n'], /Falta el valor de --n/],
      [['--seco', '--n', '0'], /entero de 1 a 20/],
      [['--seco', '--n', '21'], /entero de 1 a 20/],
      [['--seco', '--casos', 'A 9'], /--casos debe ser/],
      [['--seco', '--vertex', 'mi-proyecto-de-prueba'], /no se combina/],
      [['--vertex', 'Proyecto Raro'], /id de proyecto/],
      [['--vertex', 'mi-proyecto-de-prueba', '--locacion', 'EEUU'], /región válida/],
      [['--json'], /Indica --seco/],
      [[], /Indica --seco/],
    ];
    for (const [argv, patron] of mal) {
      const m = mundo();
      const s = await correr(m, argv);
      expect(s.codigo, argv.join(' ')).toBe(2);
      expect(s.error, argv.join(' ')).toMatch(patron);
      expect(m.red).toHaveLength(0);
    }
    const ayuda = await correr(mundo(), ['--ayuda']);
    expect(ayuda.codigo).toBe(0);
    expect(ayuda.salida).toMatch(/--seco/);
    expect(B.leerArgumentos(['--seco']).n).toBe(1);
  });

  it('--seco corre UNA vez por caso aunque se pida --n 5', async () => {
    const a = json(await correr(mundo(), ['--seco', '--json', '--casos', 'A9', '--n', '5']));
    expect(a.corridasPorCaso).toBe(1);
    expect(a.casos[0].corridas).toBe(2); // las dos frases de A9, una vez cada una
  });
});

// ------------------------------------------------------------------------------ --vertex con un fetch de mentira
describe('--vertex (con un fetch y un token de mentira): el cuerpo es el del flujo, el token solo va a Vertex y nunca se imprime', () => {
  const extraccion = { lineas: [] };
  it('cada llamada a «Extraer» sale a *-aiplatform.googleapis.com con el cuerpo del flujo; el token no aparece en la salida', async () => {
    const m = mundo(() => extraccion);
    const s = await correr(m, ['--vertex', 'mi-proyecto-de-prueba', '--locacion', 'us-central1', '--casos', 'A10', '--json']);
    expect(s.codigo, s.error + s.salida.slice(0, 800)).toBe(0);
    expect(m.red).toHaveLength(3); // una llamada por cada frase de A10
    for (const l of m.red) {
      expect(new URL(l.url).hostname).toBe('us-central1-aiplatform.googleapis.com');
      expect(l.url).toContain('/projects/mi-proyecto-de-prueba/');
      expect(l.url).toMatch(/\/models\/gemini-[A-Za-z0-9.-]+:generateContent$/);
      expect(l.encabezados['Authorization']).toBe(`Bearer ${TOKEN}`);
      expect(l.url).not.toContain(TOKEN); // nunca en la URL
      const cuerpo = JSON.parse(l.cuerpo) as J;
      expect(cuerpo['systemInstruction']).toBeTruthy(); // el cuerpo que arma «Decidir turno»
      expect(cuerpo['contents']).toBeTruthy();
    }
    expect(s.salida).not.toContain(TOKEN);
    expect(s.error).not.toContain(TOKEN);
    const r = json(s);
    expect(r.modo).toBe('real');
    expect(r.total.llamadasModelo).toBe(3);
    expect(r.total.usoModelo.entrada).toBe(3000);
    expect(r.costo.usd).toBeGreaterThan(0);
    expect(r.costo.tarifa).toEqual({ entrada: 0.3, salida: 2.5, cacheado: 0.03, unidad: 'USD por millón de tokens' });
  });

  it('un error de Vertex que devuelve el token no lo deja salir; el modelo caído no rompe la batería', async () => {
    const m = mundo((_c, n) => (n % 2 ? new Error(`fetch failed contra ${TOKEN}`) : `HTTP 400 {"error":{"message":"Bearer ${TOKEN} no sirve"}}`));
    const s = await correr(m, ['--vertex', 'mi-proyecto-de-prueba', '--casos', 'A10']);
    expect(s.salida).not.toContain(TOKEN);
    expect(s.error).not.toContain(TOKEN);
    expect(s.codigo).toBe(3); // el modelo devolvio error: los resultados no sirven para juzgar el flujo
  });

  it('un 404 del modelo (p. ej. el modelo no existe en esa ubicación) se SEÑALA y sale con 3; no se confunde con un defecto del flujo', async () => {
    const m = mundo(() => 'HTTP 404 {"error":{"message":"Publisher model was not found"}}');
    const s = await correr(m, ['--vertex', 'mi-proyecto-de-prueba', '--casos', 'A10']);
    expect(s.codigo).toBe(3);
    expect(s.salida).toMatch(/MODELO NO DISPONIBLE/);
    expect(s.salida).toMatch(/--locacion global/);
    expect(s.salida).toMatch(/404/);
    expect(s.salida).not.toContain(TOKEN);
  });

  it('sin token de gcloud es un error de uso (2), sin llamar a la red', async () => {
    const m = mundo(undefined, { gcloudToken: () => { throw new Error('no hay sesión'); } });
    const s = await correr(m, ['--vertex', 'mi-proyecto-de-prueba']);
    expect(s.codigo).toBe(2);
    expect(s.error).toMatch(/gcloud no entregó un token/);
    expect(m.red).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------ higiene del repositorio público
describe('higiene: la herramienta no escribe archivos y los casos no llevan datos reales', () => {
  const fuente = readFileSync(HERRAMIENTA, 'utf8');
  const archivosDeCasos = readdirSync(CARPETA_CASOS).filter((f) => f.endsWith('.json'));
  it('no importa nada que escriba, no lee variables de entorno del proceso y no hace `fetch` fuera de la inyección', () => {
    expect(fuente).not.toMatch(/writeFile|appendFile|createWriteStream|mkdirSync|unlinkSync|rmSync/);
    expect(fuente).not.toMatch(/process\.env/);
    expect(fuente.match(/\bfetch\b/g)?.length ?? 0).toBeLessThan(8);
    expect(fuente).not.toMatch(/new Function\(/); // el único `new Function` es el del motor de Captación mínima, con su justificación
  });
  it('ni la herramienta ni los casos llevan rutas de usuario, UUID ni claves', () => {
    const textos = [fuente, ...archivosDeCasos.map((f) => readFileSync(join(CARPETA_CASOS, f), 'utf8'))];
    for (const t of textos) {
      expect(t).not.toMatch(/\/home\/|\/Users\/|C:\\\\Users/);
      expect(t).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(t).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|ya29\.|Bearer [A-Za-z0-9]{12,}|-----BEGIN/);
      expect(t).not.toMatch(/CLIENTES\//);
    }
  });
  it('los teléfonos de los casos y del panel son sintéticos (seis ceros seguidos) y la única URL de un servicio es la de Maps de prueba', () => {
    const textos = [fuente, ...archivosDeCasos.map((f) => readFileSync(join(CARPETA_CASOS, f), 'utf8'))].join('\n');
    const telefonos = textos.match(/\b591\d{8}\b/g) ?? [];
    expect(telefonos.length).toBeGreaterThan(0);
    for (const t of telefonos) expect(t, t).toMatch(/^59100000\d{3}$/);
    // Las URL permitidas: las de ejemplo (.invalid), la de Maps de prueba y los anfitriones de Google que la cabecera nombra.
    const urls = textos.match(/https?:\/\/[^\s"'`)]+/g) ?? [];
    for (const u of urls) expect(u, u).toMatch(/\.invalid\b|^https:\/\/www\.google\.com\/maps\/|aiplatform\.googleapis\.com|^https:\/\/\$\{host\}/);
  });
  it('los pendientes no repiten un caso implementado', () => {
    const ids = new Set(casosDeLaCarpeta().casos.map((c) => c['id']));
    const pendientes = (JSON.parse(readFileSync(join(CARPETA_CASOS, 'pendientes.json'), 'utf8')) as J)['pendientes'] as J[];
    expect(pendientes.length).toBeGreaterThan(0);
    for (const p of pendientes) { expect(ids.has(p['id']), `${p['id']} está en los pendientes y también implementado`).toBe(false); expect(String(p['espera'])).toMatch(/rama|sin asignar/); }
  });
});

// ------------------------------------------------------------------------------ el texto de los AVISOS al local (05/10/2026)
describe('avisoTextos / avisoTextosNo: el aviso al local se lee (plantilla: nombre y parámetros de cuerpo)', () => {
  const plantilla = (nombre: string, ...parametros: string[]): J => ({
    messaging_product: 'whatsapp', type: 'template',
    template: { name: nombre, language: { code: 'es' }, components: [{ type: 'body', parameters: parametros.map((text) => ({ type: 'text', text })) }] },
  });
  const base = (avisosTextos: string[]): J => ({ mensajes: [], estado: {}, estadoAntes: {}, avisos: avisosTextos.length, ruta: '', qr: false, modelo: 0, cierre: 0, fallo: null, avisosTextos });

  it('textoDeAviso junta el nombre de la plantilla y los parámetros; un texto o interactivo da sus piezas', () => {
    const t = B.textoDeAviso(plantilla('aviso_reserva', 'GRUPO GRANDE', 'mesa para 15'));
    expect(t).toContain('aviso_reserva');
    expect(t).toContain('GRUPO GRANDE');
    expect(t).toContain('mesa para 15');
    expect(B.textoDeAviso({ type: 'text', text: { body: 'Hola equipo' } })).toBe('Hola equipo');
    expect(B.textoDeAviso({})).toBe('');
  });

  it('avisoTextos exige que ALGÚN aviso que salió coincida; sin avisos, falla diciendo que no salió ninguno', () => {
    const t = B.textoDeAviso(plantilla('aviso_reserva', 'GRUPO GRANDE'));
    expect(B.evaluarEsperado({ avisoTextos: ['GRUPO GRANDE'] }, base([t]))).toEqual([]);
    expect(B.evaluarEsperado({ avisoTextos: ['VARIAS RESERVAS'] }, base([t])).join(' ')).toMatch(/esperaba un aviso al local con \/VARIAS RESERVAS\//);
    expect(B.evaluarEsperado({ avisoTextos: ['GRUPO GRANDE'] }, base([])).join(' ')).toMatch(/no salió ningún aviso/);
  });

  it('avisoTextosNo exige que NINGÚN aviso coincida (p. ej. una marca que ya no debe existir)', () => {
    const t = B.textoDeAviso(plantilla('aviso_reserva', 'DÍA LLENO'));
    expect(B.evaluarEsperado({ avisoTextosNo: ['DÍA LLENO'] }, base([t])).join(' ')).toMatch(/no debía aparecer en un aviso al local \/DÍA LLENO\//);
    expect(B.evaluarEsperado({ avisoTextosNo: ['DÍA LLENO'] }, base([B.textoDeAviso(plantilla('x', 'VARIAS RESERVAS'))]))).toEqual([]);
  });

  const caso = (e: J): J => ({ casos: [{ id: 'ZZ9', titulo: 'aviso', turnos: [{ cliente: { tipo: 'texto', texto: 'hola' } }, { cliente: { tipo: 'texto', texto: 'quiero hablar con una persona' }, esperado: e }] }] });

  it('las claves se validan: lista de textos y regex válida; un caso mal formado da error de uso', () => {
    expect(() => B.validarCasos(caso({ avisoTextos: 'GRUPO' }))).toThrow(/lista de textos/);
    expect(() => B.validarCasos(caso({ avisoTextos: ['(sin cerrar'] }))).toThrow();
    expect(() => B.validarCasos(caso({ avisoTextosNo: [1] }))).toThrow(/lista de textos/);
    expect(B.validarCasos(caso({ avisoTextos: ['.'], avisoTextosNo: ['ZZZ'] }))).toHaveLength(1);
  });

  it('de punta a punta con --seco: el aviso al local de «quiero hablar con una persona» SALE y se lee (cualquier texto); una marca inexistente falla', async () => {
    const correrCon = async (e: J): Promise<number> => {
      const casos = B.validarCasos(caso(e));
      return B.main(['--seco', '--casos', 'ZZ9', '--json'], { salida: () => undefined, error: () => undefined, fetch: () => { throw new Error('sin red'); }, leerCasos: () => ({ casos, global: null }) });
    };
    expect(await correrCon({ avisoTextos: ['.'], efectos: { aviso: true } })).toBe(0); // salió un aviso y tiene texto
    expect(await correrCon({ avisoTextos: ['MARCA-QUE-NO-EXISTE'] })).toBe(1); // ningún aviso la trae
    expect(await correrCon({ avisoTextosNo: ['.'] })).toBe(1); // hay un aviso con texto: «ninguno coincide con cualquier cosa» falla
  });
});
