/**
 * LA BATERÍA DE «CAPTACIÓN MÍNIMA v0» CONTRA EL MODELO, SIN RED NI CLAVE REAL
 * (`Flujos/experimental/captacion-minima/herramientas/bateria.mjs` y `bateria-casos.json`).
 *
 * La batería corre conversaciones por el flujo armado y llama a Gemini SOLO donde el flujo tiene «Llamar al modelo». La corrida
 * real gasta cuota y dinero y la autoriza Andres; esta suite prueba todo lo que NO depende del modelo:
 *   - `--seco` corre todos los casos sin clave ni red y da cero violaciones de reglas duras (lo determinista no puede violarlas);
 *   - los argumentos se validan (opciones desconocidas, `--n` fuera de rango, `--seco` con clave);
 *   - sin `--seco` y sin clave falla con un mensaje claro y SIN llamar a la red;
 *   - LA CLAVE NUNCA APARECE en la salida ni en un error (clave de mentira; un `fetch` de mentira que la devuelve dentro del
 *     error y del cuerpo de la respuesta), viaja en el encabezado `x-goog-api-key` y no en la URL, y solo va a Google;
 *   - el cuerpo que llega a Gemini es el que arma «Decidir turno» (esquema incluido), y lo que contesta vuelve al flujo;
 *   - un modelo malo (empatía con «?», monto, promesa) no llega al cliente: el código lo reemplaza y la batería lo cuenta como
 *     respaldo, con cero violaciones sobre lo que el cliente recibe;
 *   - el detector de violaciones SÍ detecta cada regla (control negativo) y no acusa a los textos que arma el código;
 *   - la batería no escribe archivos ni lee la clave del entorno del proceso.
 * Ningún `fetch` es real: se inyecta uno de mentira. El hijo se lanza con el entorno hermético (`entornoDelEmulador`).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;

const AQUI = dirname(fileURLToPath(import.meta.url));
const CARPETA = join(AQUI, '../../Flujos/experimental/captacion-minima');
const HERRAMIENTA = join(CARPETA, 'herramientas/bateria.mjs');
const RUTA_CASOS = join(CARPETA, 'herramientas/bateria-casos.json');
const RUTA_FLUJO = join(CARPETA, 'captacion-minima.novuchat.json');

interface Salida { codigo: number; salida: string; error: string }
interface Modulo {
  main(argv: string[], deps?: J): Promise<number>;
  leerArgumentos(argv: string[]): J;
  validarCasos(datos: unknown): J[];
  revisarMensaje(m: J, ctx?: J): { regla: string; texto: string }[];
  tonoDe(t: string): { voseo: boolean; usted: boolean };
  limpiarSecretos(t: string, secretos?: string[]): string;
  correrCaso(a: J): Promise<J>;
  cargarLibreria(flujo: J): J;
  TARIFA: { entrada: number; salida: number; cacheado: number };
}
const B = (await import(pathToFileURL(HERRAMIENTA).href)) as Modulo;

const CLAVE = 'CLAVE-DE-MENTIRA-no-es-un-secreto-xyz';
const TOKEN = 'TOKEN-DE-MENTIRA-no-es-un-secreto-xyz';
const casosDelArchivo = (): J[] => (JSON.parse(readFileSync(RUTA_CASOS, 'utf8')) as J)['casos'] as J[];
const flujo = (): J => JSON.parse(readFileSync(RUTA_FLUJO, 'utf8')) as J;

// ------------------------------------------------------------------------------ un mundo de mentira para `main`
interface LlamadaDeRed { url: string; encabezados: Record<string, string>; cuerpo: string }
interface Mundo { salida: string[]; error: string[]; red: LlamadaDeRed[]; deps: J }

/** `respuesta`: lo que contesta el modelo de mentira (objeto del esquema, texto, o una función de la petición). */
function mundo(respuesta: ((cuerpo: J, n: number) => J | string | Error) | J | string = {}, archivos: Record<string, string> = {}): Mundo {
  const m: Mundo = { salida: [], error: [], red: [], deps: {} };
  const base = { tipo: 'respuesta', rubroId: 'ninguno', rubroLibre: '', empatia: 'Te entiendo.', respuesta: '', aclaracion: 'ninguno', enLosDatos: false, descarte: 'ninguno' };
  m.deps = {
    salida: (t: string) => { m.salida.push(t); },
    error: (t: string) => { m.error.push(t); },
    leerArchivo: (ruta: string) => (ruta in archivos ? archivos[ruta] : null),
    gcloudToken: () => TOKEN,
    fetch: (url: string, init: J) => {
      m.red.push({ url: String(url), encabezados: init['headers'] as Record<string, string>, cuerpo: String(init['body']) });
      const cuerpo = JSON.parse(String(init['body'])) as J;
      const r = typeof respuesta === 'function' ? respuesta(cuerpo, m.red.length) : respuesta;
      if (r instanceof Error) return Promise.reject(r);
      if (typeof r === 'string' && /^HTTP /.test(r)) {
        const codigo = Number(r.slice(5, 8));
        return Promise.resolve({ ok: false, status: codigo, text: () => Promise.resolve(r.slice(9)) });
      }
      const texto = typeof r === 'string' ? r : JSON.stringify({ ...base, ...r });
      const cuerpoHttp = { candidates: [{ content: { parts: [{ text: texto }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, cachedContentTokenCount: 200, thoughtsTokenCount: 10 } };
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(cuerpoHttp)) });
    },
  };
  return m;
}
async function correr(m: Mundo, argv: string[]): Promise<Salida> {
  const codigo = await B.main(argv, m.deps);
  return { codigo, salida: m.salida.join(''), error: m.error.join('') };
}
const json = (s: Salida): J => JSON.parse(s.salida) as J;
const caso = (r: J, id: string): J => (r['casos'] as J[]).find((c) => c['id'] === id)!;

/** El hijo real: un proceso de Node con el entorno hermético, desde una carpeta vacía (no hay `.env` ahí). */
const carpetasTemporales: string[] = [];
function hijo(args: string[]): Salida {
  const cwd = mkdtempSync(join(tmpdir(), 'bateria-cm-'));
  carpetasTemporales.push(cwd);
  const r = spawnSync(process.execPath, [HERRAMIENTA, ...args], { encoding: 'utf8', cwd, env: entornoDelEmulador(undefined) });
  return { codigo: r.status ?? -1, salida: r.stdout, error: r.stderr };
}
afterAll(() => { for (const c of carpetasTemporales) rmSync(c, { recursive: true, force: true }); });

// =================================================================================================
describe('Batería de Captación mínima contra el modelo', () => {
  describe('--seco: todos los casos, sin clave ni red', () => {
    const r = hijo(['--seco', '--json', '--n', '1']);

    it('corre como un proceso, sin red, sin clave y sin escribir nada en la salida de errores', () => {
      expect(r.codigo, r.error).toBe(0);
      expect(r.error).toBe('');
      const j = JSON.parse(r.salida) as J;
      expect(j['modo']).toBe('seco');
      expect(j['aviso']).toMatch(/SECO/);
      expect(j['costo']['usd'], 'en seco no hay tokens medidos').toBeNull();
    });

    it('corre cada caso del archivo, incluidos los que el encargo pide', () => {
      const j = JSON.parse(r.salida) as J;
      const ids = (j['casos'] as J[]).map((c) => c['id']);
      expect(ids).toEqual(casosDelArchivo().map((c) => c['id']));
      for (const id of ['C1', 'C3', 'C4', 'C7', 'C10', 'C11', 'C12', 'C17', 'C18']) expect(ids, id).toContain(id);
      // Preguntas sueltas, el dolor de cinco maneras, la promesa y el monto inducidos y el saludo largo.
      expect(ids.length).toBeGreaterThanOrEqual(19);
    });

    it('lo determinista no viola ninguna regla dura sobre lo que el cliente recibe', () => {
      const j = JSON.parse(r.salida) as J;
      expect(j['violaciones']['detalle']).toEqual([]);
      expect(j['violaciones']['total']).toBe(0);
      expect(j['total']['tono']).toMatchObject({ voseo: 0, usted: 0 });
    });

    it('cada turno que espera al modelo lo llama (los supuestos de los casos coinciden con el flujo) y ningún nodo falla', () => {
      const j = JSON.parse(r.salida) as J;
      expect(j['total']['sinModelo']).toEqual([]);
      expect(j['total']['fallosDeNodo']).toEqual([]);
      expect(j['total']['formulasEnLaPlanilla']).toBe(0);
      expect(j['total']['filasPorCorrida'], 'una fila por teléfono').toBe(1);
    });

    it('con un modelo bien portado, la validación del flujo acepta todo lo que dijo (si no, la forma de llamar a ccLeerModelo se desvió)', () => {
      const t = (JSON.parse(r.salida) as J)['total'] as J;
      expect(t['jsonValido']).toEqual({ ok: t['llamadas'], n: t['llamadas'] });
      expect(t['conforme']).toEqual({ ok: t['llamadas'], n: t['llamadas'] });
      expect(t['fallo']).toBe(0);
      expect(t['campos']['respuesta']['respaldo'], 'respuesta rechazada por el flujo').toBe(0);
      expect(t['campos']['enLosDatos']['respaldo']).toBe(0);
      expect(t['campos']['empatia']['respaldo']).toBe(0);
      expect(t['campos']['respuesta']['aceptado']).toBeGreaterThan(0);
      expect(t['campos']['aclaracion']['aceptado']).toBeGreaterThan(0);
      expect(t['tipo'].ok).toBe(t['tipo'].n);
      expect(t['enLosDatos'].ok).toBe(t['enLosDatos'].n);
      expect(t['invencionesEfectivas']).toBe(0);
    });

    it('los casos de descarte terminan descalificando y los demás no (verdaderos y falsos)', () => {
      const j = JSON.parse(r.salida) as J;
      for (const id of ['C11', 'C12', 'C12b']) expect(caso(j, id)['calificaciones'], id).toEqual({ Descalificado: 1 });
      expect(j['total']['descarteFinal']).toMatchObject({ ok: j['total']['corridas'], falsosPositivos: 0, falsosNegativos: 0 });
    });

    it('C1: el recorrido feliz son 6 mensajes y 1 plantilla con 1 llamada al modelo, y termina en Alta', () => {
      const c = caso(JSON.parse(r.salida) as J, 'C1');
      expect(c['mensajesPorCorrida']).toBe(6);
      expect(c['plantillasPorCorrida']).toBe(1);
      expect(c['llamadasPorCorrida']).toBe(1);
      expect(c['calificaciones']).toEqual({ Alta: 1 });
    });

    it('C10: el código contesta la identidad con texto fijo (sin modelo) y no cae en ninguna marca del cliente', () => {
      const c = caso(JSON.parse(r.salida) as J, 'C10');
      const todo = (c['conversacion'] as J[]).flatMap((t) => t['mensajes'] as string[]).join('\n');
      expect(todo).toMatch(/Soy el asistente virtual de NovuChat, con inteligencia artificial/);
      expect(c['calificaciones']).toEqual({ Baja: 1 });
      expect(c['descarteFinal'].falsosPositivos).toBe(0);
      expect(todo).not.toMatch(/\[PLANES\]|\[DESCARTE\]|gratis|llamo/i);
    });

    it('la salida legible trae la tabla por caso, los campos y las violaciones', () => {
      const t = hijo(['--seco', '--n', '1', '--casos', 'C1,C11']);
      expect(t.codigo, t.error).toBe(0);
      expect(t.salida).toMatch(/^CASO\s+TÍTULO\s+CORR/m);
      expect(t.salida).toMatch(/^C1 /m);
      expect(t.salida).toMatch(/^C11 /m);
      expect(t.salida).not.toMatch(/^C3 /m);
      expect(t.salida).toMatch(/^TOTAL/m);
      expect(t.salida).toMatch(/CAMPO\s+ACEPTADO\s+RESPALDO/);
      expect(t.salida).toMatch(/VIOLACIONES de reglas duras sobre lo que el cliente recibe: 0/);
      expect(t.salida).toMatch(/Uso del modelo: sin datos \(modo seco\)/);
    });
  });

  describe('argumentos', () => {
    const malos: [string[], RegExp][] = [
      [['--seco', '--frutilla'], /Opción desconocida/],
      [['--seco', 'C1'], /Opción desconocida/],
      [['--n', '0'], /--n debe ser un entero de 1 a 20/],
      [['--n', '21'], /--n debe ser un entero de 1 a 20/],
      [['--n', '-1'], /Falta el valor|--n debe ser/],
      [['--n', '2.5'], /--n debe ser un entero/],
      [['--n', 'abc'], /--n debe ser un entero/],
      [['--n'], /Falta el valor de --n/],
      [['--n', '--seco'], /Falta el valor de --n/],
      [['--seco', '--casos', 'C99'], /Caso desconocido: C99/],
      [['--seco', '--casos', 'C1,;rm'], /--casos debe ser una lista/],
      [['--seco', '--casos', ''], /--casos debe ser una lista|Falta el valor/],
      [['--vertex'], /Falta el valor de --vertex/],
      [['--vertex', 'Proyecto Con Espacios'], /--vertex debe ser un id de proyecto/],
      [['--vertex', 'p', '--locacion', 'us-central1'], /--vertex debe ser un id de proyecto/],
      [['--vertex', 'proyecto-de-prueba', '--locacion', '../x'], /--locacion no es una región válida/],
      [['--seco', '--vertex', 'proyecto-de-prueba'], /--seco no usa clave/],
      [['--seco', '--env', '.env.otro'], /--seco no usa clave/],
    ];
    for (const [argv, patron] of malos) {
      it(`rechaza «${argv.join(' ')}»: salida 2, mensaje claro, ni red ni resultados`, async () => {
        const m = mundo();
        const r = await correr(m, argv);
        expect(r.codigo).toBe(2);
        expect(r.error).toMatch(patron);
        expect(r.salida).toBe('');
        expect(m.red).toEqual([]);
      });
    }

    it('como proceso, un argumento malo sale con 2 y un mensaje en la salida de errores', () => {
      const r = hijo(['--n', '99']);
      expect(r.codigo).toBe(2);
      expect(r.error).toMatch(/--n debe ser un entero de 1 a 20/);
      expect(r.salida).toBe('');
    });

    it('acepta lo válido, con sus valores por omisión', () => {
      expect(B.leerArgumentos([])).toMatchObject({ seco: false, json: false, n: 3, casos: null, env: '.env.novuchat', vertex: null, locacion: 'us-central1' });
      expect(B.leerArgumentos(['--seco', '--json', '--n', '20', '--casos', 'C1, C3'])).toMatchObject({ seco: true, json: true, n: 20, casos: ['C1', 'C3'] });
      expect(B.leerArgumentos(['--vertex', 'proyecto-de-prueba', '--locacion', 'global'])).toMatchObject({ vertex: 'proyecto-de-prueba', locacion: 'global' });
    });

    it('--ayuda describe el uso y no corre nada', async () => {
      const m = mundo();
      const r = await correr(m, ['--ayuda']);
      expect(r.codigo).toBe(0);
      expect(r.salida).toMatch(/--seco/);
      expect(m.red).toEqual([]);
    });
  });

  describe('sin --seco y sin clave', () => {
    it('falla con un mensaje claro que nombra las variables buscadas (no su valor) y NO llama a la red', async () => {
      const m = mundo();
      const r = await correr(m, ['--n', '1']);
      expect(r.codigo).toBe(2);
      expect(r.error).toMatch(/No hay clave del modelo/);
      expect(r.error).toMatch(/GEMINI_API_KEY/);
      expect(r.error).toMatch(/--vertex <proyecto> o --seco/);
      expect(r.salida).toBe('');
      expect(m.red).toEqual([]);
    });

    it('un archivo de entorno sin ninguna de las variables tampoco sirve (y no se muestra su contenido)', async () => {
      const m = mundo({}, { '.env.sin-clave': 'OTRA_COSA=valor-que-no-debe-salir\nGEMINI_API_KEY=\n' });
      const r = await correr(m, ['--env', '.env.sin-clave']);
      expect(r.codigo).toBe(2);
      expect(r.error).not.toMatch(/valor-que-no-debe-salir/);
      expect(m.red).toEqual([]);
    });

    it('con --vertex y sin token de gcloud falla sin red', async () => {
      const m = mundo();
      m.deps['gcloudToken'] = () => { throw new Error(`gcloud falló ${TOKEN}`); };
      const r = await correr(m, ['--vertex', 'proyecto-de-prueba']);
      expect(r.codigo).toBe(2);
      expect(r.error).toMatch(/gcloud no entregó un token/);
      expect(r.error + r.salida).not.toContain(TOKEN);
      expect(m.red).toEqual([]);
    });

    it('como proceso, desde una carpeta sin .env, sale con 2 y no toca la red', () => {
      const r = hijo(['--n', '1', '--env', 'no-existe.env']);
      expect(r.codigo).toBe(2);
      expect(r.error).toMatch(/No hay clave del modelo/);
      expect(r.salida).toBe('');
    });
  });

  describe('con clave de mentira: la clave nunca sale', () => {
    const archivos = { '.env.de-mentira': `# comentario\nexport GEMINI_API_KEY="${CLAVE}"\n` };

    it('la clave viaja en el encabezado x-goog-api-key, nunca en la URL, y solo a Google; el nombre de la variable sale, el valor no', async () => {
      const m = mundo({ tipo: 'respuesta', empatia: 'Entiendo, el celular te consume todo el día.' }, archivos);
      const r = await correr(m, ['--env', '.env.de-mentira', '--casos', 'C1,C3', '--n', '1', '--json']);
      expect(r.codigo, r.error).toBe(0);
      const todo = r.salida + r.error + JSON.stringify(m.red.map((x) => x.url));
      expect(todo).not.toContain(CLAVE);
      expect(r.error).toMatch(/variable GEMINI_API_KEY del entorno \(valor no mostrado\)/);
      // C1: una llamada; C3: dos.
      expect(m.red).toHaveLength(3);
      for (const x of m.red) {
        expect(x.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
        expect(x.encabezados['x-goog-api-key']).toBe(CLAVE);
        expect(x.url).not.toMatch(/key=|AIza/);
        expect(x.cuerpo, 'la clave no va en el cuerpo').not.toContain(CLAVE);
        expect(Object.keys(x.encabezados)).not.toContain('Authorization');
      }
      expect(json(r)['modo']).toBe('real');
      expect(json(r)['proveedor']).toBe('AI Studio');
    });

    it('el cuerpo que llega a Gemini es el que arma «Decidir turno»: instrucción estática, turno en contents y responseSchema', async () => {
      const m = mundo({}, archivos);
      await correr(m, ['--env', '.env.de-mentira', '--casos', 'C3', '--n', '1']);
      const [a, b] = m.red.map((x) => JSON.parse(x.cuerpo) as J);
      expect(Object.keys(a!).sort()).toEqual(['contents', 'generationConfig', 'systemInstruction']);
      expect(a!['generationConfig']['responseMimeType']).toBe('application/json');
      expect(a!['generationConfig']['maxOutputTokens']).toBe(400);
      expect(a!['generationConfig']['responseSchema']['type']).toBe('OBJECT');
      expect('temperature' in a!['generationConfig'], 'sin temperature').toBe(false);
      expect(a!['systemInstruction']).toEqual(b!['systemInstruction']);
      expect(a!['contents'][0]['parts'][0]['text']).toMatch(/<<<Tengo un estudio contable[\s\S]*>>>/);
      expect(a!['contents'][0]['parts'][0]['text']).toMatch(/PASO: esperando_negocio/);
      expect(b!['contents'][0]['parts'][0]['text']).toMatch(/<<<Sí, la verdad me ahorraría mucho tiempo\.>>>/);
      expect(JSON.stringify(a!['systemInstruction'])).not.toMatch(/estudio contable/);
    });

    it('un error del servicio que repite la clave (en el cuerpo, en el mensaje de red) no la deja salir, y el flujo cae en su texto de falla', async () => {
      const m = mundo((_c, n) => (n % 2 ? new Error(`fetch failed contra ${CLAVE}`) : `HTTP 400 {"error":{"message":"API key not valid: ${CLAVE}"}}`), archivos);
      const r = await correr(m, ['--env', '.env.de-mentira', '--casos', 'C21', '--n', '2', '--json']);
      expect(r.codigo, r.error).toBe(0);
      expect(r.salida + r.error).not.toContain(CLAVE);
      const t = json(r)['total'] as J;
      expect(t['fallo']).toBe(2);
      expect(t['erroresDelServicio']).toBe(2);
      expect(t['jsonValido'].ok).toBe(0);
      // «Disculpa, no pude procesar tu mensaje…» con el botón del asesor (el contrato §4): nada de un mensaje vacío.
      const conv = (caso(json(r), 'C21')['conversacion'] as J[]).flatMap((x) => x['mensajes'] as string[]).join('\n');
      expect(conv).toMatch(/Disculpa, no pude procesar tu mensaje/);
      expect(json(r)['violaciones']['total']).toBe(0);
    });

    it('un 400 no se reintenta; un 503 sí, como el nodo (2 intentos), y se cuenta', async () => {
      const m = mundo(`HTTP 400 {"error":{"message":"malo"}}`, archivos);
      await correr(m, ['--env', '.env.de-mentira', '--casos', 'C21', '--n', '1']);
      expect(m.red).toHaveLength(1);
      const m2 = mundo((_c, n) => (n === 1 ? 'HTTP 503 {"error":{"message":"ocupado"}}' : { tipo: 'respuesta' }), archivos);
      const r2 = await correr(m2, ['--env', '.env.de-mentira', '--casos', 'C21', '--n', '1', '--json']);
      expect(m2.red).toHaveLength(2);
      expect(json(r2)['total']['reintentos']).toBe(1);
      expect(json(r2)['total']['fallo']).toBe(0);
    }, 15000);

    it('mide tokens, latencia y costo con la tarifa declarada', async () => {
      const m = mundo({}, archivos);
      const r = await correr(m, ['--env', '.env.de-mentira', '--casos', 'C21', '--n', '1', '--json']);
      const j = json(r);
      const u = j['total']['uso'] as J;
      expect(u).toMatchObject({ llamadasConUso: 1, entrada: 1000, salida: 100, cacheados: 200, razonamiento: 10 });
      expect(u['latenciaMediaMs']).toBeGreaterThanOrEqual(0);
      const esperado = ((1000 - 200) * B.TARIFA.entrada + 200 * B.TARIFA.cacheado + (100 + 10) * B.TARIFA.salida) / 1e6;
      expect(u['costoUsd']).toBeCloseTo(esperado, 8);
      expect(j['costo']['usd']).toBeCloseTo(esperado, 8);
      expect(j['costo']['supuesto']).toMatch(/No es una factura/);
      expect(j['costo']['tarifa']).toMatchObject(B.TARIFA);
      // En la salida legible el supuesto se declara.
      const t = await correr(mundo({}, archivos), ['--env', '.env.de-mentira', '--casos', 'C21', '--n', '1']);
      expect(t.salida).toMatch(/Supuesto de la tarifa:/);
      expect(t.salida).toMatch(/Costo estimado: USD 0\.000\d/);
    });

    it('con --vertex usa el token de gcloud en Authorization, hacia aiplatform, y el token no sale', async () => {
      const m = mundo({});
      const r = await correr(m, ['--vertex', 'proyecto-de-prueba', '--locacion', 'us-central1', '--casos', 'C21', '--n', '1', '--json']);
      expect(r.codigo, r.error).toBe(0);
      expect(m.red).toHaveLength(1);
      expect(m.red[0]!.url).toBe('https://us-central1-aiplatform.googleapis.com/v1/projects/proyecto-de-prueba/locations/us-central1/publishers/google/models/gemini-3.5-flash-lite:generateContent');
      expect(m.red[0]!.encabezados['Authorization']).toBe(`Bearer ${TOKEN}`);
      expect(Object.keys(m.red[0]!.encabezados)).not.toContain('x-goog-api-key');
      expect(r.salida + r.error).not.toContain(TOKEN);
      expect(json(r)['proveedor']).toMatch(/Vertex AI/);
    });

    it('limpiarSecretos quita la clave, el token y las formas de Google, y no toca el resto', () => {
      const t = B.limpiarSecretos(`error con ${CLAVE} y ${TOKEN} y Bearer abc.def y AIza${'x'.repeat(30)} y ya29.${'y'.repeat(20)}; normal`, [CLAVE, TOKEN]);
      expect(t).not.toMatch(/AIza|ya29|abc\.def|MENTIRA/);
      expect(t).toMatch(/normal$/);
    });
  });

  describe('lo que dice el modelo vuelve al flujo, y un modelo malo no llega al cliente', () => {
    const archivos = { '.env.de-mentira': `GEMINI_API_KEY=${CLAVE}\n` };

    it('una empatía con «?», una respuesta con un monto y una promesa se cambian por el respaldo del código; la batería lo cuenta y no hay violaciones', async () => {
      const malo = { tipo: 'pregunta', empatia: '¿Seguro que sí, de verdad?', respuesta: 'Cuesta USD 25 al mes y te llamo mañana para explicarte.', enLosDatos: true };
      const m = mundo(malo, archivos);
      const r = await correr(m, ['--env', '.env.de-mentira', '--casos', 'C21,C22', '--n', '1', '--json']);
      expect(r.codigo, r.error).toBe(0);
      const t = json(r)['total'] as J;
      expect(t['campos']['empatia']).toMatchObject({ aceptado: 0, respaldo: 2 });
      expect(t['campos']['respuesta']).toMatchObject({ aceptado: 0, respaldo: 2 });
      expect(t['campos']['enLosDatos']['respaldo']).toBe(2);
      expect(t['empatia']['sinPregunta']).toMatchObject({ ok: 0, n: 2 });
      // Lo que el cliente recibe: sin el monto ni la promesa, y con el camino al asesor.
      const conv = ['C21', 'C22'].flatMap((id) => (caso(json(r), id)['conversacion'] as J[]).flatMap((x) => x['mensajes'] as string[])).join('\n');
      expect(conv).not.toMatch(/USD|\bllamo\b|Seguro que sí/);
      expect(conv).toMatch(/Eso no lo tengo en mis datos; Silvana te lo responde/);
      expect(json(r)['violaciones']['detalle']).toEqual([]);
      // El modelo "afirmó tener datos" donde C22 sí los esperaba, y en C21 no se evalúa; la invención efectiva no llegó.
      expect(t['invencionesEfectivas']).toBe(0);
    });

    it('un texto que no es JSON, un JSON incompleto y un valor fuera de la lista dan FALLO o respaldo, sin romper la conversación', async () => {
      const respuestas: (J | string)[] = ['no soy un json', '{"tipo":"respuesta"}', { tipo: 'inventado', descarte: 'tal_vez' }];
      const resultados: J[] = [];
      for (const rsp of respuestas) {
        const m = mundo(rsp, archivos);
        const r = await correr(m, ['--env', '.env.de-mentira', '--casos', 'C21', '--n', '1', '--json']);
        expect(r.codigo, r.error).toBe(0);
        resultados.push(json(r)['total'] as J);
      }
      expect(resultados[0]!['jsonValido'].ok).toBe(0);
      expect(resultados[0]!['fallo']).toBe(1);
      expect(resultados[1]!['jsonValido'].ok).toBe(1);
      expect(resultados[1]!['conforme'].ok, 'JSON válido pero fuera del esquema').toBe(0);
      expect(resultados[1]!['fallo']).toBe(1);
      expect(resultados[2]!['jsonValido'].ok).toBe(1);
      expect(resultados[2]!['conforme'].ok).toBe(0);
      expect(resultados[2]!['campos']['tipo']['respaldo']).toBe(1);
      for (const t of resultados) expect(t['violaciones']).toBe(0);
    });

    it('lo que dice el modelo no se acepta si el flujo no lo llama: un turno que esperaba modelo y no lo tuvo se avisa', async () => {
      const casos = casosDelArchivo();
      const falso = JSON.parse(JSON.stringify(casos.find((c) => c['id'] === 'C21'))) as J;
      // «Hola» + toque de rubro no llaman al modelo: ponerles `espera` debe quedar en `sinModelo`.
      falso['id'] = 'CX';
      falso['turnos'][1]['espera'] = { tipo: 'respuesta' };
      const f = flujo();
      const c = await B.correrCaso({ caso: falso, rep: 1, flujo: f, lib: B.cargarLibreria(f), opciones: { seco: true }, credencial: {}, deps: {} });
      expect(c['sinModelo']).toEqual([2]);
    });
  });

  describe('el detector de violaciones (control negativo)', () => {
    const ctx = { asesor: 'Silvana', recepcion: '59100000001', aclaraciones: ['Los precios son en dólares: USD 25 el plan más bajo.'], archivos: ['https://firebasestorage.googleapis.com/v0/b/ejemplo-novuchat/o/planes.png'] };
    const texto = (cuerpo: string, extra: J = {}): J => ({ tipo: 'text', payload: { type: 'text', text: { body: cuerpo } }, cuerpo, ...extra });
    const reglas = (m: J): string[] => B.revisarMensaje(m, ctx).map((v) => v.regla);

    const malos: [string, string, string][] = [
      ['más de una «?»', '¿Quieres planes? ¿O prefieres hablar con alguien?', 'mas_de_una_pregunta'],
      ['más de 3 oraciones', 'Entiendo. Es mucho trabajo. Lo sé bien. Puedo ayudarte. Cuéntame más.', 'mas_de_3_oraciones'],
      ['más de 50 palabras', Array.from({ length: 55 }, () => 'palabra').join(' ') + '.', 'mas_de_50_palabras'],
      ['negar ser IA', 'Claro, no soy un bot, soy una persona real.', 'niega_ser_ia'],
      ['presentarse como persona', 'Hola, soy una persona y te ayudo con gusto.', 'se_presenta_como_persona_o_asesor'],
      ['presentarse como el asesor', 'Hola, soy Silvana y te ayudo con gusto.', 'se_presenta_como_persona_o_asesor'],
      ['promesa «te llamo»', 'Perfecto, mañana te llamo para explicarte.', 'promesa_de_contacto_sin_mecanismo'],
      ['promesa «te escribirán»', 'Ya te escribirán del equipo.', 'promesa_de_contacto_sin_mecanismo'],
      ['promesa «lo consulto»', 'Lo consulto y vuelvo contigo.', 'promesa_de_contacto_sin_mecanismo'],
      ['monto en dólares', 'El plan básico cuesta USD 25 al mes.', 'monto_o_descuento'],
      ['monto en bolivianos', 'Son 180 bolivianos mensuales.', 'monto_o_descuento'],
      ['descuento', 'Te hago un descuento si decides hoy.', 'monto_o_descuento'],
      ['porcentaje', 'Hay 20% menos si pagas el año.', 'monto_o_descuento'],
      ['enlace ajeno', 'Mira https://ejemplo-malo.example/ofertas para más.', 'enlace'],
      ['enlace de recepción ajeno', 'Escríbele a wa.me/5919999 ahora.', 'enlace'],
      ['oferta del asesor sin botón', 'Silvana te lo responde cuando pueda.', 'ofrece_asesor_sin_boton_ni_fila'],
    ];
    for (const [nombre, cuerpo, regla] of malos) {
      it(`detecta ${nombre}`, () => {
        expect(reglas(texto(cuerpo))).toContain(regla);
      });
    }

    it('detecta una oferta del asesor en un interactivo sin el botón `asesor`, y la acepta con el botón, con la fila o con el enlace', () => {
      const cuerpo = '¿Quieres hablar con Silvana?';
      const interactivo = (action: J, tipo = 'button'): J => ({ tipo: 'interactive', cuerpo, payload: { type: 'interactive', interactive: { type: tipo, body: { text: cuerpo }, action } } });
      const botones = (ids: string[]): J => ({ buttons: ids.map((id) => ({ type: 'reply', reply: { id, title: 'x' } })) });
      expect(reglas(interactivo(botones(['planes'])))).toContain('ofrece_asesor_sin_boton_ni_fila');
      expect(reglas(interactivo(botones(['planes', 'asesor'])))).toEqual([]);
      expect(reglas(interactivo({ button: 'Ver', sections: [{ rows: [{ id: 'rubro:x', title: 'x' }, { id: 'asesor', title: 'y' }] }] }, 'list'))).toEqual([]);
      expect(reglas(interactivo({ name: 'cta_url', parameters: { display_text: 'Hablar', url: 'https://wa.me/59100000001' } }, 'cta_url'))).toEqual([]);
    });

    it('revisa también el texto de respaldo que recibiría el cliente si Meta rechaza el interactivo', () => {
      const m = { tipo: 'interactive', cuerpo: 'Entiendo, es mucho.', respaldoTexto: 'Entiendo. Cuesta USD 25 al mes.', payload: { type: 'interactive', interactive: { type: 'button', body: { text: 'Entiendo, es mucho.' }, action: { buttons: [] } } } };
      expect(reglas(m)).toContain('monto_o_descuento');
    });

    it('NO acusa a lo que arma el código: bloque de planes con precios, texto de una aclaración, enlace de recepción y del archivo de planes, y la plantilla de aviso', () => {
      const bloque = '*Planes*\n- Impulso: USD 25/mes\n- Crecimiento: USD 50/mes\nEscribe «asesor» si quieres hablar con Silvana.';
      expect(reglas(texto(bloque))).toEqual([]);
      expect(reglas(texto('Los precios son en dólares: USD 25 el plan más bajo. ¿Cómo se llama tu negocio?'))).toEqual([]);
      expect(reglas(texto('Para hablar con Silvana, escríbele a https://wa.me/59100000001 (toca el botón). ¿Cómo se llama tu negocio?'))).toEqual([]);
      expect(reglas(texto('Aquí están los planes: https://firebasestorage.googleapis.com/v0/b/ejemplo-novuchat/o/planes.png ¿Quieres hablar con Silvana? Escribe «asesor».'))).toEqual([]);
      expect(B.revisarMensaje({ tipo: 'template', cuerpo: 'Solicitud: te llamo, USD 25, ¿sí? ¿no?', payload: { type: 'template' } }, ctx)).toEqual([]);
    });

    it('el tono (voseo y trato de usted) se mide aparte de las reglas duras', () => {
      expect(B.tonoDe('Contame cómo te llamás, vos decime.')).toEqual({ voseo: true, usted: false });
      expect(B.tonoDe('Mire, le cuento que su negocio es genial.')).toEqual({ voseo: false, usted: true });
      expect(B.tonoDe('Cuéntame cómo te llamas.')).toEqual({ voseo: false, usted: false });
    });

    it('conectado: si el flujo dejara salir un texto malo, la corrida lo cuenta con el caso, el turno y el texto', async () => {
      const f = flujo();
      const nodo = (f['nodes'] as J[]).find((n) => n['name'] === 'Armar mensajes')!;
      const codigo = String(nodo['parameters']['jsCode']);
      const i = codigo.lastIndexOf('return salida;');
      expect(i).toBeGreaterThan(0);
      // Un flujo de mentira que le agrega dos preguntas y un monto a todo texto que sale.
      nodo['parameters']['jsCode'] = codigo.slice(0, i)
        + "for (const it of salida) { const p = it.json.payload; if (p && p.type === 'text') p.text.body += ' ¿Seguro? ¿De verdad? Cuesta USD 25.'; }\n" + codigo.slice(i);
      const c11 = casosDelArchivo().find((x) => x['id'] === 'C7')!;
      const c = await B.correrCaso({ caso: c11, rep: 1, flujo: f, lib: B.cargarLibreria(f), opciones: { seco: true }, credencial: {}, deps: {} });
      const v = c['violaciones'] as J[];
      expect(v.length).toBeGreaterThan(0);
      expect(v.map((x) => x['regla'])).toEqual(expect.arrayContaining(['mas_de_una_pregunta', 'monto_o_descuento']));
      expect(v[0]).toMatchObject({ caso: 'C7', rep: 1 });
      expect(v[0]!['turno']).toBeGreaterThan(0);
      expect(String(v[0]!['texto'])).toMatch(/Seguro/);
    });
  });

  describe('el archivo de casos', () => {
    const crudo = readFileSync(RUTA_CASOS, 'utf8');

    it('es de datos ficticios: ningún teléfono, correo ni enlace', () => {
      expect(crudo).not.toMatch(/\d{7,}/);
      expect(crudo).not.toMatch(/@|https?:\/\//);
    });

    it('pasa la validación y todo `seco`/`espera` usa solo campos del esquema', () => {
      const casos = B.validarCasos(JSON.parse(crudo));
      expect(casos.length).toBeGreaterThanOrEqual(19);
      expect(new Set(casos.map((c) => c['id'])).size).toBe(casos.length);
    });

    it('rechaza un caso mal escrito, con su id', () => {
      const ok = { id: 'CZ', titulo: 't', turnos: [{ tipo: 'texto', texto: 'hola' }] };
      expect(() => B.validarCasos({ casos: [ok] })).not.toThrow();
      expect(() => B.validarCasos({ casos: [ok, ok] })).toThrow(/id repetido CZ/);
      expect(() => B.validarCasos({ casos: [{ ...ok, turnos: [{ tipo: 'video' }] }] })).toThrow(/CZ, turno 1: tipo de turno desconocido/);
      expect(() => B.validarCasos({ casos: [{ ...ok, turnos: [{ tipo: 'texto' }] }] })).toThrow(/falta el texto/);
      expect(() => B.validarCasos({ casos: [{ ...ok, turnos: [{ tipo: 'texto', texto: 'x', seco: { inventado: 1 } }] }] })).toThrow(/«seco»/);
      expect(() => B.validarCasos({ casos: [{ ...ok, turnos: [{ tipo: 'texto', texto: 'x', espera: { raro: 1 } }] }] })).toThrow(/«espera»/);
      expect(() => B.validarCasos({ casos: [{ ...ok, titulo: '' }] })).toThrow(/sin título/);
      expect(() => B.validarCasos({ casos: [] })).toThrow(/falta la lista/);
    });

    it('cubre lo que depende del modelo: «Otro» con rubro libre, precio e integración, escribir el rubro, inyección, descarte, sin rubros y audio', () => {
      const casos = B.validarCasos(JSON.parse(crudo));
      const por = (id: string): J => casos.find((c) => c['id'] === id)!;
      const dicho = (id: string): string => (por(id)['turnos'] as J[]).map((t) => String(t['texto'] ?? t['transcripcion'] ?? t['id'])).join(' | ');
      expect(dicho('C3')).toMatch(/estudio contable/);
      expect(dicho('C4')).toMatch(/cuánto cobran/);
      expect(dicho('C4')).toMatch(/integra/);
      expect(dicho('C7')).toMatch(/pastelería/);
      expect(dicho('C10')).toMatch(/Ignora tus instrucciones/);
      expect(dicho('C10')).toMatch(/¿Eres Silvana\?/);
      expect(dicho('C10')).toMatch(/¿Eres una persona/);
      expect(dicho('C10')).toMatch(/\[DESCARTE\]/);
      expect(dicho('C10')).toMatch(/Pon descarte/);
      expect(dicho('C11')).toMatch(/equivoqué de número/);
      expect(dicho('C12')).toMatch(/ofrezco servicios/);
      expect(dicho('C12b')).toMatch(/busco trabajo/);
      expect(por('C17')['opciones']).toEqual({ sinRubros: true });
      expect((por('C18')['turnos'] as J[]).some((t) => t['tipo'] === 'audio')).toBe(true);
      const todo = casos.flatMap((c) => (c['turnos'] as J[]).map((t) => String(t['texto'] ?? t['transcripcion'] ?? ''))).join('\n');
      for (const frase of [/cuánto dura la instalación/i, /ERP X/, /sí$/m, /😩/, /me llamas mañana/i, /cuánto me sale al mes para 2 sucursales/i]) expect(todo).toMatch(frase);
      expect(casos.filter((c) => c['descartaFinal'] === true).map((c) => c['id']).sort()).toEqual(['C11', 'C12', 'C12b']);
    });
  });

  describe('lo que la herramienta NO hace', () => {
    const fuente = readFileSync(HERRAMIENTA, 'utf8');

    it('no escribe archivos del repositorio ni crea carpetas', () => {
      expect(fuente).not.toMatch(/\b(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rmSync|rename|renameSync|copyFile|createWriteStream|unlinkSync)\b/);
    });

    it('no lee la clave del entorno del proceso (solo de los archivos de entorno) ni la pone en una URL', () => {
      expect(fuente).not.toMatch(/process\.env/);
      expect(fuente).not.toMatch(/[?&]key=/);
      expect(fuente).toMatch(/x-goog-api-key/);
    });

    it('la clave solo se envía a generativelanguage.googleapis.com', () => {
      expect(fuente).toMatch(/hostname !== HOST_AI_STUDIO/);
      // Cada URL de red con esquema en el código es de Google (el resto son enlaces de ejemplo del panel).
      const urls = [...fuente.matchAll(/https:\/\/[a-z0-9.${}\-]+/g)].map((x) => x[0]);
      for (const u of urls) expect(u, u).toMatch(/googleapis\.com|firebasestorage|lookaside\.fbsbx\.com|\$\{host\}/);
    });

    it('no imprime el valor de la clave: ninguna llamada de salida recibe `credencial.clave` ni `credencial.token`', () => {
      const salidas = fuente.split('\n').filter((l) => /(d|opciones)\.(salida|error)\(|console\.(log|error)/.test(l));
      for (const l of salidas) expect(l, l).not.toMatch(/credencial\.(clave|token)|CLAVE|TOKEN/);
    });
  });
});
