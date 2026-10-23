/**
 * LA BATERÍA DE LA CONVERSACIÓN DE RUBÉN (`Flujos/experimental/rroca-ruben/herramientas/bateria.mjs` y `bateria-casos.json`), ENTREGA 2.
 *
 * Aquí se prueba SIN modelo ni red (`--seco`: una respuesta fija por turno) y se comprueba:
 *   1. que los 12 turnos corren por el flujo de prueba versionado y dan CERO violaciones (invariantes 11 a 15 y reglas duras), con 8 llamadas al modelo por corrida;
 *   2. que la corrida real EXIGE `--confirmo-gasto` (es gasto) y que en `--seco` no se toca la red, ni un archivo de entorno, ni gcloud;
 *   3. que no imprime un secreto;
 *   4. que cada detector detecta (una batería que acepta todo no mediría nada) y que `medir` aplica el umbral del 85 %;
 *   5. que REUTILIZA el motor de `chat-novuchat` (no hay un cuarto motor copiado).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const CARPETA = join(aqui, '../../../../Flujos/experimental/rroca-ruben');
const RUTA_BATERIA = join(CARPETA, 'herramientas/bateria.mjs');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
const B = (await import(/* @vite-ignore */ RUTA_BATERIA)) as { main: (argv: string[], deps?: J) => Promise<number>; validarCasos: (d: J) => J[]; medir: Fn; cargarLibreria: () => J };
const CASOS = JSON.parse(readFileSync(join(CARPETA, 'herramientas/bateria-casos.json'), 'utf8')) as J;
const FUENTE = readFileSync(RUTA_BATERIA, 'utf8');
const clonar = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

async function correr(argv: string[], deps: J = {}): Promise<{ codigo: number; salida: string; error: string }> {
  let salida = '';
  let error = '';
  const codigo = await B.main(argv, { salida: (t: string) => { salida += t; }, error: (t: string) => { error += t; }, ...deps });
  return { codigo, salida, error };
}
const sinRed: J = {
  fetch: () => { throw new Error('el modo seco NO llama a la red'); },
  leerArchivo: () => { throw new Error('el modo seco NO lee archivos de entorno'); },
  gcloudToken: () => { throw new Error('el modo seco NO pide un token'); },
};

describe('la batería de Rubén en seco: los 12 turnos corren por el flujo versionado con cero violaciones', () => {
  it('una corrida por caso: 12 turnos, 8 llamadas al modelo, ningún respaldo y cero violaciones', async () => {
    const r = await correr(['--seco', '--n', '1', '--json'], sinRed);
    expect(r.codigo, r.error).toBe(0);
    const m = (JSON.parse(r.salida) as J)['medidas'] as J;
    expect(m['turnosTotales']).toBe(12);
    // Los turnos que llegan al modelo: A2 y A3, B2 y B4, C1 a C4 (A1, A4 y B1 y B3 no).
    expect(m['turnosDelModelo']).toBe(8);
    expect(m['violaciones'], JSON.stringify(m['violaciones'].slice(0, 5))).toEqual([]);
    expect(m['conRespaldo'].n, JSON.stringify(m['conRespaldo'])).toBe(0);
    expect(m['umbral'].cumple).toBe(true);
  }, 60_000);

  it('tres corridas por caso: sigue en cero y no toca la red, ni un archivo de entorno, ni gcloud (el seco lo haría fallar)', async () => {
    const r = await correr(['--seco', '--n', '3', '--json'], sinRed);
    expect(r.codigo, r.error).toBe(0);
    const m = (JSON.parse(r.salida) as J)['medidas'] as J;
    expect(m['turnosTotales']).toBe(36);
    expect(m['violaciones']).toEqual([]);
  }, 120_000);

  it('el informe de texto dice que es seco y trae las conversaciones para compararlas con el PDF', async () => {
    const r = await correr(['--seco', '--n', '1', '--casos', 'A', '--conversaciones'], sinRed);
    expect(r.codigo, r.error).toBe(0);
    expect(r.salida).toMatch(/MODO SECO/);
    expect(r.salida).toMatch(/Caso A, corrida 1/);
    expect(r.salida).toMatch(/Asistente \[opciones\]:[^\n]*Te dejo aquí abajo las opciones[^\n]*ahorras 17 Bs/);
    expect(r.salida).toMatch(/Asistente \[qr\]:[^\n]*¡Genial! Te llevas el Pack Completo/);
  }, 60_000);

  it('NEGADA: la corrida real sin `--confirmo-gasto` no hace nada (código 2, sin leer la clave ni llamar a la red)', async () => {
    const r = await correr(['--n', '1', '--vertex', 'proyecto-de-pruebas'], sinRed);
    expect(r.codigo).toBe(2);
    expect(r.error).toMatch(/GASTO/);
    expect(r.error).toMatch(/--confirmo-gasto/);
    const solo = await correr(['--n', '1', '--env', '.env.cualquiera'], sinRed);
    expect(solo.codigo).toBe(2);
  });

  it('NEGADA: no imprime un secreto: con una clave de pruebas que no se usa por falta de la confirmación, ningún valor sale', async () => {
    const CLAVE = 'AI' + 'zaFAKE_clave_de_prueba_' + 'ABCDEFGHIJKLMNOP'; // falsa, armada en dos partes como en la batería de chat-novuchat
    const r = await correr(['--n', '1', '--env', '.env.x'], { ...sinRed, leerArchivo: () => `GEMINI_API_KEY=${CLAVE}\n` });
    expect(r.salida + r.error).not.toContain(CLAVE);
  });
});

describe('la batería de Rubén: validación de casos, detectores y umbral', () => {
  it('los casos versionados son válidos: A, B y C con 4 turnos cada uno y 8 con respuesta fija del modo seco', () => {
    const casos = B.validarCasos(clonar(CASOS));
    expect(casos.map((c) => c['id'])).toEqual(['A', 'B', 'C']);
    expect(casos.map((c) => c['turnos'].length)).toEqual([4, 4, 4]);
    expect(casos.flatMap((c) => c['turnos']).filter((t: J) => typeof t['seco'] === 'string')).toHaveLength(8);
  });
  it('NEGADA: rechaza casos mal formados (sin turnos, ids repetidos, turno sin `dice` ni `boton` o con los dos, botón inválido)', () => {
    const base = (): J => clonar(CASOS);
    const mal: Array<(d: J) => void> = [
      (d) => { d['casos'] = []; },
      (d) => { d['casos'][1]['id'] = 'A'; },
      (d) => { d['casos'][0]['turnos'] = []; },
      (d) => { d['casos'][0]['turnos'][0] = {}; },
      (d) => { d['casos'][0]['turnos'][0] = { dice: 'hola', boton: 'b_pack' }; },
      (d) => { d['casos'][0]['turnos'][3] = { boton: 'pack' }; },
      (d) => { d['casos'][0]['turnos'][1]['rubro'] = 'torta'; },
      (d) => { d['casos'][0]['turnos'][1]['seco'] = 7; },
    ];
    for (const [i, f] of mal.entries()) { const d = base(); f(d); expect(() => B.validarCasos(d), `caso malo ${i}`).toThrow(); }
  });
  it('`medir` aplica el umbral del 85 % de turnos sin respaldo y exige cero violaciones', () => {
    const turno = (plan: string, extra: J = {}): J => ({ n: 2, plan, llamoAlModelo: true, crudo: 'Una idea útil para tu negocio sin cifras.', motivo: plan.endsWith('_fijo') || plan === 'modelo_caido' ? 'varias_preguntas' : '', finishReason: 'STOP', tokensEntrada: 3500, tokensSalida: 250, ms: 800, marcas: {}, mensajes: [], botones: [], violaciones: [], ...extra });
    const corrida = (planes: string[], extra: J = {}): J => ({ caso: 'A', rep: 1, turnos: planes.map((p) => turno(p, extra)) });
    const bien = B.medir([corrida(['modelo', 'opciones', 'modelo', 'puente', 'modelo', 'modelo', 'modelo', 'modelo', 'modelo', 'modelo'])]);
    expect(bien.umbral.cumple).toBe(true);
    expect(bien.sinRespaldo.pct).toBe(100);
    // 8 de 10 (80 %): no cumple.
    const flojo = B.medir([corrida(['modelo', 'opciones', 'modelo', 'puente', 'modelo', 'modelo', 'modelo', 'modelo', 'modelo_caido', 'puente_fijo'])]);
    expect(flojo.sinRespaldo.pct).toBe(80);
    expect(flojo.umbral.cumple).toBe(false);
    expect(flojo.conRespaldo.motivos).toEqual({ varias_preguntas: 2 });
    // 9 de 10 (90 %) pero con UNA violación dura: no cumple.
    const dura = corrida(['modelo', 'modelo', 'modelo', 'modelo', 'modelo', 'modelo', 'modelo', 'modelo', 'modelo', 'modelo_caido']);
    dura.turnos[0].violaciones = ['inv. 11: un precio con 1 mensaje(s) de conversación'];
    expect(B.medir([dura]).umbral.cumple).toBe(false);
    // Sin turnos del modelo no hay umbral que cumplir.
    expect(B.medir([{ caso: 'A', rep: 1, turnos: [turno('saludo', { llamoAlModelo: false })] }]).umbral.cumple).toBe(false);
  });
  it('`medir` cuenta MAX_TOKENS, cifras inventadas, repetición de la descripción, más de una pregunta y el largo', () => {
    const t = (crudo: string, extra: J = {}): J => ({ n: 2, plan: 'modelo', llamoAlModelo: true, crudo, motivo: '', finishReason: 'STOP', tokensEntrada: 100, tokensSalida: 50, ms: 10, marcas: {}, mensajes: [], botones: [], violaciones: [], ...extra });
    const m = B.medir([{ caso: 'A', rep: 1, turnos: [
      t('Son 99 ideas.', { finishReason: 'MAX_TOKENS' }),
      t('El libro tiene 12 capítulos y 230 páginas.'),
      t('¿Qué vendes? ¿Y dónde?'),
      t('x'.repeat(400)),
      t('Con 7 pasos y 100 prompts.'),
    ] }]);
    expect(m.maxTokens).toBe(1);
    expect(m.cifrasInventadas).toBe(1);
    expect(m.repiteLaDescripcion).toBe(1);
    expect(m.unaSolaPregunta).toEqual({ n: 4, de: 5 });
    expect(m.largoEntre300y900).toEqual({ n: 1, de: 5 });
    expect(m.tokensEntrada).toBe(500);
    expect(m.costoUsd).toBeGreaterThan(0);
  });
  it('la librería aislada rechaza lo que rechaza el flujo: un monto, «gratis» y la suplantación', () => {
    const lib = B.cargarLibreria();
    const rev = (t: string): string => (lib['cmRevisarRedaccion'] as Fn)(t, { maximo: 900, enlacesPermitidos: [], quienPromete: ['ruben', 'el equipo'], nombreNegocio: 'Rubén Roca', textoDelCliente: '', extra: [lib['rrExtraRedaccion']] }).motivo;
    expect(rev('El libro cuesta solo 5 Bs hoy.')).not.toBe('');
    expect(rev('Te alcanza mucho alcance gratis en TikTok.')).not.toBe('');
    expect((lib['rrSuplantaARuben'] as Fn)('Soy Rubén y te escribo yo.')).toBe(true);
    expect(rev('Para una tienda el libro ayuda a responder más rápido.')).toBe('');
  });
});

describe('la batería de Rubén REUTILIZA el motor de chat-novuchat (no copia un cuarto motor)', () => {
  it('importa `crearMundo`, `llamarGemini`, `leerCredencial`, `limpiarSecretos` y `TARIFA` de `chat-novuchat/herramientas/bateria.mjs` y no los redefine', () => {
    expect(FUENTE).toMatch(/from '\.\.\/\.\.\/chat-novuchat\/herramientas\/bateria\.mjs'/);
    for (const n of ['crearMundo', 'llamarGemini', 'leerCredencial', 'limpiarSecretos', 'TARIFA']) {
      expect(FUENTE, n).toMatch(new RegExp(`import \\{[^}]*\\b${n}\\b[^}]*\\} from '\\.\\./\\.\\./chat-novuchat`));
      expect(FUENTE, n).not.toMatch(new RegExp(`(function|const|class) ${n}\\b`));
    }
  });
  it('la clave solo la ve el motor común (la herramienta propia no lee archivos de entorno ni la escribe en ningún lado)', () => {
    expect(FUENTE).not.toMatch(/writeFile|appendFile|x-goog-api-key|Authorization/);
    expect(FUENTE).toMatch(/--confirmo-gasto/);
  });
});
