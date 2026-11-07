/**
 * `auditar-ejecuciones-n8n.mjs` (07/11/2026): solo lectura, sin teléfonos ni contenido en la salida, y el aviso cuando el flujo no guarda las fallas.
 */
import { describe, expect, it } from 'vitest';
import { analizarArgumentos, auditar, enmascarar, resumirEjecucion } from '../../scripts/plataforma/auditar-ejecuciones-n8n.mjs';

const AHORA = Date.UTC(2026, 10, 7, 13);
const iso = (ms: number): string => new Date(ms).toISOString();

describe('auditar-ejecuciones-n8n', () => {
  it('enmascara secuencias de 6 dígitos o más y recorta', () => {
    expect(enmascarar('falló con el cliente 59100000033 y wamid 123456')).toBe('falló con el cliente ###### y wamid ######');
    expect(enmascarar('x'.repeat(500))).toHaveLength(160);
  });
  it('argumentos: exige el id del flujo y límites razonables', () => {
    expect(analizarArgumentos(['--flujo', 'AbC123']).problemas).toEqual([]);
    expect(analizarArgumentos([]).problemas.join(' ')).toMatch(/--flujo/);
    expect(analizarArgumentos(['--flujo', '../x']).problemas.join(' ')).toMatch(/--flujo/);
    expect(analizarArgumentos(['--flujo', 'a', '--horas', '0']).problemas.join(' ')).toMatch(/--horas/);
  });
  it('resume una ejecución con error de expresión: nodos y mensajes, sin datos de los ítems', () => {
    const r = resumirEjecucion({
      id: '991', status: 'error', startedAt: iso(AHORA),
      data: { resultData: { lastNodeExecuted: '¿Es comprobante?', error: { message: 'Cannot access "prototype" due to security concerns' },
        runData: { '¿Es comprobante?': [{ error: { message: 'Cannot access "prototype" due to security concerns' }, data: { main: [[{ json: { from: '59100000033', texto: 'hola' } }]] } }], 'Config del negocio': [{}] } } },
    });
    expect(r.errorDeExpresion).toBe(true);
    expect(r.nodos).toEqual([{ nodo: '¿Es comprobante?', mensaje: 'Cannot access "prototype" due to security concerns' }]);
    expect(JSON.stringify(r)).not.toMatch(/59100000033|hola/);
  });
  it('solo GET; lista las fallas recientes y avisa si el flujo no guarda las ejecuciones con error', async () => {
    const llamadas: { url: string; metodo: string }[] = [];
    const buscar = (async (url: string, init: { method?: string }) => {
      llamadas.push({ url, metodo: init.method ?? 'GET' });
      const cuerpo = url.includes('/workflows/') ? { settings: { saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none' } }
        : url.includes('/executions/77') ? { id: '77', status: 'crashed', startedAt: iso(AHORA - 3_600_000), data: { resultData: { error: { message: 'murió' } } } }
          : { data: [{ id: '77', status: 'crashed', startedAt: iso(AHORA - 3_600_000) }, { id: '78', status: 'success', startedAt: iso(AHORA - 60_000) }, { id: '10', status: 'error', startedAt: iso(AHORA - 90 * 3_600_000) }], nextCursor: null };
      return { ok: true, status: 200, json: async () => cuerpo } as Response;
    }) as unknown as typeof fetch;
    const r = await auditar({ base: 'https://n8n.ejemplo.invalid', clave: 'k', flujo: 'abc', horas: 24, limite: 100, ahoraMs: AHORA, buscar });
    expect(r.guardaFallas).toBe(false);
    expect(r.ejecuciones).toBe(2);
    expect(r.conFalla.map((x) => x.id)).toEqual(['77']);
    expect(llamadas.every((l) => l.metodo === 'GET')).toBe(true);
  });
});
