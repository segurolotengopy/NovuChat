/**
 * `auditar-ejecuciones-n8n.mjs` (07/11/2026): solo lectura, sin seguir redirecciones, filtro por estado en el servidor, sin teléfonos ni texto de error en la
 * salida (solo el TIPO), y los avisos cuando el flujo no guarda las fallas o `--limite` corta la lista.
 */
import { describe, expect, it } from 'vitest';
import { analizarArgumentos, auditar, enmascarar, resumirEjecucion, tipoDeError } from '../../scripts/plataforma/auditar-ejecuciones-n8n.mjs';

const AHORA = Date.UTC(2026, 10, 7, 13);
const iso = (ms: number): string => new Date(ms).toISOString();
const respuesta = (cuerpo: unknown): Response => ({ ok: true, status: 200, json: async () => cuerpo }) as Response;

describe('auditar-ejecuciones-n8n', () => {
  it('enmascara teléfonos (también con espacios, «+», guiones o paréntesis) y secuencias largas de dígitos', () => {
    expect(enmascarar('cliente 59100000033 y wamid 123456')).toBe('cliente ###### y wamid ######');
    expect(enmascarar('cliente +591 0000 0033 y (591) 0000-0033')).toBe('cliente ###### y ######');
    expect(enmascarar('a las 20:00')).toBe('a las 20:00');
    expect(enmascarar('x'.repeat(500))).toHaveLength(160);
  });
  it('el tipo de error, nunca su texto', () => {
    expect(tipoDeError({ message: 'Cannot access "prototype" due to security concerns' })).toBe('seguridad');
    expect(tipoDeError({ message: 'invalid syntax', name: 'ExpressionError' })).toBe('expresion');
    expect(tipoDeError({ message: 'el cliente 59100000033 dijo hola' })).toBe('otro');
  });
  it('argumentos: exige el id del flujo y límites razonables', () => {
    expect(analizarArgumentos(['--flujo', 'AbC123']).problemas).toEqual([]);
    expect(analizarArgumentos([]).problemas.join(' ')).toMatch(/--flujo/);
    expect(analizarArgumentos(['--flujo', '../x']).problemas.join(' ')).toMatch(/--flujo/);
    expect(analizarArgumentos(['--flujo', 'a', '--horas', '0']).problemas.join(' ')).toMatch(/--horas/);
  });
  it('resume una ejecución con error de expresión: nodos y TIPO, sin datos de los ítems ni el texto del error', () => {
    const r = resumirEjecucion({
      id: '991', status: 'error', startedAt: iso(AHORA),
      data: { resultData: { lastNodeExecuted: '¿Es comprobante?', error: { message: 'Cannot access "prototype" due to security concerns' },
        runData: { '¿Es comprobante?': [{ error: { message: 'Cannot access "prototype" due to security concerns 59100000033' }, data: { main: [[{ json: { from: '59100000033', texto: 'hola' } }]] } }], 'Config del negocio': [{}] } } },
    });
    expect(r.errorDeExpresion).toBe(true);
    expect(r.nodos).toEqual([{ nodo: '¿Es comprobante?', tipo: 'seguridad' }]);
    expect(JSON.stringify(r)).not.toMatch(/59100000033|hola|Cannot access/);
  });
  it('solo GET, sin seguir redirecciones, con el filtro de estado en el servidor; avisa si el flujo no guarda las fallas', async () => {
    const llamadas: { url: string; init: RequestInit }[] = [];
    const buscar = (async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      if (url.includes('/workflows/')) return respuesta({ settings: { saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none' } });
      if (url.includes('/executions/77')) return respuesta({ id: '77', status: 'error', startedAt: iso(AHORA - 3_600_000), data: { resultData: { error: { message: 'murió' } } } });
      const estado = new URL(url).searchParams.get('status');
      return respuesta(estado === 'error'
        ? { data: [{ id: '77', status: 'error', startedAt: iso(AHORA - 3_600_000) }, { id: '10', status: 'error', startedAt: iso(AHORA - 90 * 3_600_000) }], nextCursor: null }
        : { data: [], nextCursor: null });
    }) as unknown as typeof fetch;
    const r = await auditar({ base: 'https://n8n.ejemplo.invalid', clave: 'k', flujo: 'abc', horas: 24, limite: 100, ahoraMs: AHORA, buscar });
    expect(r.guardaFallas).toBe(false);
    expect(r.cortado).toBe(false);
    expect(r.conFalla.map((x) => x.id)).toEqual(['77']);
    expect(llamadas.every((l) => l.init.method === 'GET' && l.init.redirect === 'error')).toBe(true);
    const listas = llamadas.filter((l) => /\/executions\?/.test(l.url)).map((l) => new URL(l.url).searchParams.get('status'));
    expect(listas.sort()).toEqual(['canceled', 'error']);
  });
  it('una redirección hace fallar la consulta (la clave no viaja a otro anfitrión)', async () => {
    const buscar = (async (_url: string, init: RequestInit) => {
      if (init.redirect === 'error') throw new TypeError('fetch failed: redirect mode is set to error');
      return respuesta({});
    }) as unknown as typeof fetch;
    await expect(auditar({ base: 'https://n8n.ejemplo.invalid', clave: 'k', flujo: 'abc', horas: 24, limite: 10, ahoraMs: AHORA, buscar })).rejects.toThrow(/redirect/);
  });
  it('avisa cuando --limite corta la lista', async () => {
    const buscar = (async (url: string) => {
      if (url.includes('/workflows/')) return respuesta({ settings: {} });
      if (/\/executions\/\d/.test(url)) return respuesta({});
      return respuesta({ data: [{ id: '1', status: 'error', startedAt: iso(AHORA - 60_000) }, { id: '2', status: 'error', startedAt: iso(AHORA - 120_000) }], nextCursor: 'mas' });
    }) as unknown as typeof fetch;
    const r = await auditar({ base: 'https://n8n.ejemplo.invalid', clave: 'k', flujo: 'abc', horas: 24, limite: 2, ahoraMs: AHORA, buscar });
    expect(r.cortado).toBe(true);
  });
});
