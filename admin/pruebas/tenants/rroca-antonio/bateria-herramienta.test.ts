/**
 * LA BATERÍA DE LA CONVERSACIÓN DE ANTONIO (`Flujos/experimental/rroca-antonio/herramientas/bateria.mjs` y `bateria-casos.json`), REHECHO SOBRE LA ENTREGA 2.
 *
 * Aquí se prueba SIN modelo ni red (`--seco`: una respuesta fija por turno) y se comprueba:
 *   1. que los 15 turnos corren por el flujo de prueba versionado y dan CERO violaciones (invariantes y reglas duras), con 7 llamadas al modelo por corrida;
 *   2. que la corrida real EXIGE `--confirmo-gasto` (es gasto) y que en `--seco` no se toca la red, ni un archivo de entorno, ni gcloud;
 *   3. que no imprime un secreto;
 *   4. que cada detector detecta (una batería que acepta todo no mediría nada) y que `medir` aplica el umbral del 85 %;
 *   5. que REUTILIZA el motor de `chat-novuchat` (no hay un cuarto motor copiado) y que su lista de librerías sale del armador (no hay una lista aparte).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const CARPETA = join(aqui, '../../../../Flujos/experimental/rroca-antonio');
const RUTA_BATERIA = join(CARPETA, 'herramientas/bateria.mjs');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
const B = (await import(/* @vite-ignore */ RUTA_BATERIA)) as { main: (argv: string[], deps?: J) => Promise<number>; validarCasos: (d: J) => J[]; medir: Fn; cargarLibreria: () => J; diagnosticar: Fn };
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

describe('la batería de Antonio en seco: los 15 turnos corren por el flujo versionado con cero violaciones', () => {
  it('una corrida por caso: 15 turnos, 7 llamadas al modelo, ningún respaldo y cero violaciones', async () => {
    const r = await correr(['--seco', '--n', '1', '--json'], sinRed);
    expect(r.codigo, r.error).toBe(0);
    const m = (JSON.parse(r.salida) as J)['medidas'] as J;
    expect(m['turnosTotales']).toBe(15);
    // Los turnos que llegan al modelo: A2, A3 y A5, B3, C2, D1 y D2 (el saludo, el precio de un producto, el «sí», los botones, la factura no).
    expect(m['turnosDelModelo']).toBe(7);
    expect(m['violaciones'], JSON.stringify(m['violaciones'].slice(0, 5))).toEqual([]);
    expect(m['conRespaldo'].n, JSON.stringify(m['conRespaldo'])).toBe(0);
    expect(m['umbral'].cumple).toBe(true);
  }, 60_000);

  it('tres corridas por caso: sigue en cero y no toca la red, ni un archivo de entorno, ni gcloud (el seco lo haría fallar)', async () => {
    const r = await correr(['--seco', '--n', '3', '--json'], sinRed);
    expect(r.codigo, r.error).toBe(0);
    const m = (JSON.parse(r.salida) as J)['medidas'] as J;
    expect(m['turnosTotales']).toBe(45);
    expect(m['violaciones']).toEqual([]);
  }, 120_000);

  it('el informe de texto dice que es seco y trae las conversaciones: la presentación con el nombre del negocio, las etiquetas del catálogo y el puente', async () => {
    const r = await correr(['--seco', '--n', '1', '--conversaciones'], sinRed);
    expect(r.codigo, r.error).toBe(0);
    expect(r.salida).toMatch(/MODO SECO/);
    expect(r.salida).toMatch(/Caso A, corrida 1/);
    expect(r.salida).toMatch(/Soy el asistente virtual del Método Puente\./);
    expect(r.salida).not.toMatch(/Dauber/);
    expect(r.salida).toMatch(/Asistente \[opciones\]:[^\n]*Te dejo aquí abajo las opciones[^\n]*ahorras 57 Bs[^\n]*Pack completo 49Bs \| Libro 35Bs \| Ver complementos/);
    expect(r.salida).toMatch(/Asistente \[puente\]:[^\n]*¿Te muestro las opciones\?[^\n]*botones: Ver opciones/);
    expect(r.salida).toMatch(/Asistente \[precio\]:[^\n]*cuesta 35 Bs[^\n]*¿Te muestro las opciones\?/);
    expect(r.salida).toMatch(/Asistente \[modelo\]:[^\n]*tu QR sigue abierto/);
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

describe('la batería de Antonio: validación de casos, detectores y umbral', () => {
  it('los casos versionados son válidos: A, B, C y D con 5, 4, 4 y 2 turnos y 7 con respuesta fija del modo seco', () => {
    const casos = B.validarCasos(clonar(CASOS));
    expect(casos.map((c) => c['id'])).toEqual(['A', 'B', 'C', 'D']);
    expect(casos.map((c) => c['turnos'].length)).toEqual([5, 4, 4, 2]);
    expect(casos.flatMap((c) => c['turnos']).filter((t: J) => typeof t['seco'] === 'string')).toHaveLength(7);
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
      (d) => { d['casos'][0]['turnos'][1]['tema'] = 'discut'; },
      (d) => { d['casos'][0]['turnos'][1]['seco'] = 7; },
      (d) => { d['casos'][0]['turnos'][2]['duda'] = 'si'; },
    ];
    for (const [i, f] of mal.entries()) { const d = base(); f(d); expect(() => B.validarCasos(d), `caso malo ${i}`).toThrow(); }
  });
  it('`medir` aplica el umbral del 85 % de turnos sin respaldo y exige cero violaciones', () => {
    const turno = (plan: string, extra: J = {}): J => ({ n: 2, plan, llamoAlModelo: true, crudo: 'Una idea útil para ustedes, sin cifras y con calidez, que cabe en la rutina de una pareja.', motivo: plan.endsWith('_fijo') || plan === 'modelo_caido' ? 'varias_preguntas' : '', finishReason: 'STOP', tokensEntrada: 3500, tokensSalida: 250, ms: 800, marcas: {}, mensajes: [], botones: [], violaciones: [], ...extra });
    const corrida = (planes: string[], extra: J = {}): J => ({ caso: 'A', rep: 1, turnos: planes.map((p) => turno(p, extra)) });
    const bien = B.medir([corrida(['modelo', 'opciones', 'modelo', 'puente', 'modelo', 'angulo', 'modelo', 'modelo', 'modelo', 'modelo'])]);
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
  it('`medir` cuenta MAX_TOKENS, cifras inventadas, más de una pregunta, el tema, la duda y el largo', () => {
    const t = (crudo: string, extra: J = {}): J => ({ n: 2, plan: 'modelo', llamoAlModelo: true, crudo, motivo: '', finishReason: 'STOP', tokensEntrada: 100, tokensSalida: 50, ms: 10, marcas: {}, mensajes: [], botones: [], violaciones: [], ...extra });
    const m = B.medir([{ caso: 'A', rep: 1, turnos: [
      t('Son 99 ideas.', { finishReason: 'MAX_TOKENS' }),
      t('El libro tiene 14 capítulos y 138 páginas.'),
      t('¿Qué sienten? ¿Y desde cuándo?'),
      t('x'.repeat(800)),
      t('Con 6 pilares y 30 días de ejercicios para volver a conversar con calma, el libro y su método ayudan en casa, paso a paso y sin prisa.', { marcas: { duda: true } }),
      t('Discutir siempre por lo mismo agota a cualquier pareja y se puede practicar de otra forma.', { marcas: { tema: ['discut'] } }),
    ] }]);
    expect(m.maxTokens).toBe(1);
    expect(m.cifrasInventadas).toBe(1);
    expect(m.unaSolaPregunta).toEqual({ n: 5, de: 6 });
    expect(m.laDudaConectaConElLibro).toEqual({ n: 1, de: 1 });
    expect(m.respondeAlTema).toEqual({ n: 1, de: 1 });
    expect(m.largoEntre120y700).toEqual({ n: 1, de: 6 });
    expect(m.tokensEntrada).toBe(600);
    expect(m.costoUsd).toBeGreaterThan(0);
  });
  it('la librería aislada rechaza lo que rechaza el flujo: un monto, datos de pago, afirmar una compra, la promesa de aviso y la suplantación del autor', () => {
    const lib = B.cargarLibreria();
    const rev = (t: string): string => (lib['cmRevisarRedaccion'] as Fn)(t, {
      maximo: 700, enlacesPermitidos: [], quienPromete: ['antonio', 'el equipo'], nombreNegocio: 'El Puente', textoDelCliente: '', extra: [lib['raExtraRedaccion']],
      sinDatosDePago: true, sinAfirmarCompra: true, sinPromesasDeAviso: true,
    }).motivo;
    expect(rev('El libro cuesta solo 5 Bs hoy.')).not.toBe('');
    expect(rev('Puedes depositar a la cuenta del Banco Unión.')).not.toBe('');
    expect(rev('Ya compraste el libro, felicidades.')).not.toBe('');
    expect(rev('Un asesor se comunicará contigo muy pronto.')).not.toBe('');
    expect(rev('Soy Antonio Dauber y te escribo yo.')).not.toBe('');
    expect(rev('Para una pareja ocupada los ejercicios del libro son cortos y caben en la rutina.')).toBe('');
  });
  it('el diagnóstico nombra la regla exacta que rechazó y las etapas que quitó (eco del marcador, promesas de opciones, pregunta final)', () => {
    const lib = B.cargarLibreria();
    const d = (crudo: string, ctx: J = {}) => B.diagnosticar(lib, crudo, { modo: 'charla', habil: true, qrAbierto: false, textoCliente: '', ...ctx });
    expect(d('').motivo).toBe('vacio');
    expect(d('DERIVAR').motivo).toBe('derivar');
    expect(d('RIESGO').motivo).toBe('riesgo');
    expect(d('Soy Antonio Dauber, te atiendo yo.').motivo).toBe('suplanta_al_autor');
    expect(d('Ahorita te paso los precios.', { habil: false }).motivo).not.toBe('');
    const eco = d('[MODO_TURNO: PUENTE] Una idea útil para ustedes. ¿Qué piensas?', { modo: 'puente', habil: false });
    expect(eco.motivo).toBe('');
    expect(eco.pasos.map((p: J) => p['etapa'])).toContain('sin eco de marcador');
    expect(eco.pasos.at(-1)?.texto).not.toMatch(/\?/);
    expect(d('Una idea. Otra idea. Otra. Y otra más.', { qrAbierto: true }).motivo).toBe('');
  });
});

describe('la batería de Antonio REUTILIZA el motor de chat-novuchat (no copia un cuarto motor) y su lista de librerías sale del armador', () => {
  it('importa `crearMundo`, `llamarGemini`, `leerCredencial`, `limpiarSecretos` y `TARIFA` de `chat-novuchat/herramientas/bateria.mjs` y no los redefine', () => {
    expect(FUENTE).toMatch(/from '\.\.\/\.\.\/chat-novuchat\/herramientas\/bateria\.mjs'/);
    for (const n of ['crearMundo', 'llamarGemini', 'leerCredencial', 'limpiarSecretos', 'TARIFA']) {
      expect(FUENTE, n).toMatch(new RegExp(`import \\{[^}]*\\b${n}\\b[^}]*\\} from '\\.\\./\\.\\./chat-novuchat`));
      expect(FUENTE, n).not.toMatch(new RegExp(`(function|const|class) ${n}\\b`));
    }
  });
  it('las librerías del flujo salen de `CONFIG.librerias` del armador (si el armador cambia, la batería cambia con él)', () => {
    expect(FUENTE).toMatch(/import \{ CONFIG \} from '\.\.\/construir\.mjs'/);
    expect(FUENTE).toMatch(/CONFIG\.librerias\.map/);
  });
  it('la clave solo la ve el motor común (la herramienta propia no lee archivos de entorno ni la escribe en ningún lado)', () => {
    expect(FUENTE).not.toMatch(/writeFile|appendFile|x-goog-api-key|Authorization/);
    expect(FUENTE).toMatch(/--confirmo-gasto/);
  });
});
