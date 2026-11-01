/**
 * Recordatorios de cita: el contacto bloqueado no recibe el recordatorio (31/10/2026).
 *
 * Se corre el JS versionado del flujo `demo-a-recordatorios.json` (nodo «Omitir bloqueados») con
 * `new Function` y sin los globales de Node, como en n8n. Decision D3=(a) de Andres: ante error,
 * tiempo de espera, respuesta ilegible o longitudes distintas el recordatorio SE ENVIA IGUAL.
 * Costo en mensajes por conversacion: 0 (el filtro solo quita envios).
 */
import { describe, expect, it } from 'vitest';
import {
  GLOBALES_FUERA_DEL_SANDBOX, codigoDe, correr, destinos, entradas, leerFlujo, nodo, type J,
} from '../../lib/flujo.ts';

const f = leerFlujo('demo-a-recordatorios.json');
const CODIGO = codigoDe(f, 'Omitir bloqueados');
const lote = (n: number): J[] => Array.from({ length: n }, (_, i) => ({ eventoId: `ev${i}`, telefono: `5917000000${i}`, nombre: `N${i}` }));
const ok = (atencion: unknown): J => ({ statusCode: 200, body: { atencion } });
const bloq = ok({ estado: 'bloqueado', avisarRecepcion: '', bloqueadoPorContacto: true });
const correrCon = (originales: J[], respuestas: J[]) =>
  correr(CODIGO, respuestas, { 'Preparar recordatorios': originales }, { console: { log: () => {} } }) as unknown as { json: J; pairedItem: { item: number } }[];
const ids = (r: { json: J }[]) => r.map((x) => x.json['eventoId']);

describe('Omitir bloqueados', () => {
  it('omite al bloqueado (200 y true exacto); lote mixto deja pasar a los demas', () => {
    const r = correrCon(lote(4), [ok({ estado: 'activo' }), bloq, ok({ estado: 'activo' }), bloq]);
    expect(ids(r)).toEqual(['ev0', 'ev2']);
    expect(r.every((x) => x.json['bloqueoMotivo'] === undefined)).toBe(true);
  });

  it('el cuerpo como texto JSON tambien se lee', () => {
    const r = correrCon(lote(2), [{ statusCode: 200, body: JSON.stringify({ atencion: { bloqueadoPorContacto: true } }) }, ok({})]);
    expect(ids(r)).toEqual(['ev1']);
  });

  it.each([
    ['pausa por persona', ok({ estado: 'bloqueado', pausadoPorPersona: true, avisarRecepcion: '' })],
    ['409', { statusCode: 409, body: { atencion: { bloqueadoPorContacto: true } } }],
    ['atencion null', ok(null)],
    ["'true' texto", ok({ bloqueadoPorContacto: 'true' })],
    ['1', ok({ bloqueadoPorContacto: 1 })],
    ['objeto vacio', ok({ bloqueadoPorContacto: {} })],
  ])('NO omite: %s', (_n, resp) => {
    expect(ids(correrCon(lote(1), [resp]))).toEqual(['ev0']);
  });

  it.each([
    ['error', { error: { message: 'x' } }],
    ['tiempo de espera', { error: { code: 'ETIMEDOUT' } }],
    ['respuesta ilegible', { statusCode: 200, body: '<html>' }],
    ['500', { statusCode: 500, body: {} }],
  ])('falla abierta (%s): se envia con el motivo y sin telefono en el motivo', (_n, resp) => {
    const r = correrCon(lote(1), [resp]);
    expect(ids(r)).toEqual(['ev0']);
    expect(r[0].json['bloqueoMotivo']).toBe('bloqueo sin verificar');
    expect(String(r[0].json['bloqueoMotivo'])).not.toMatch(/\d{4,}/);
    expect(String(r[0].json['bloqueoMotivo'])).not.toContain(String(lote(1)[0]['telefono']));
  });

  it('atencion null (sin conversacion): se envia igual con el motivo «sin conversación», sin telefono', () => {
    const r = correrCon(lote(2), [ok(null), ok({ estado: 'activo' })]);
    expect(ids(r)).toEqual(['ev0', 'ev1']);
    expect(r[0].json['bloqueoMotivo']).toBe('sin conversación');
    expect(String(r[0].json['bloqueoMotivo'])).not.toMatch(/\d{4,}/);
    expect(r[1].json['bloqueoMotivo']).toBeUndefined();
  });

  it('un bloqueado no verificable no se omite aunque el cuerpo lo diga con statusCode distinto de 200', () => {
    expect(ids(correrCon(lote(1), [{ statusCode: 500, body: { atencion: { bloqueadoPorContacto: true } } }]))).toEqual(['ev0']);
  });

  it('longitudes distintas: se envian TODOS con el motivo', () => {
    const r = correrCon(lote(3), [bloq]);
    expect(ids(r)).toEqual(['ev0', 'ev1', 'ev2']);
    expect(r.every((x) => x.json['bloqueoMotivo'] === 'bloqueo sin verificar')).toBe(true);
  });

  it('3 originales y 1 respuesta: todo pairedItem existe en la entrada (< respuestas.length)', () => {
    const r = correrCon(lote(3), [bloq]);
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.pairedItem.item >= 0 && x.pairedItem.item < 1)).toBe(true);
  });

  it('el flujo no depende de un indice inexistente: Marcar usa Omitir bloqueados y Config usa first()', () => {
    const txt = JSON.stringify(f);
    expect(txt).not.toContain("$('Config del recordatorio').item");
    const m = JSON.stringify(nodo(f, 'Marcar como recordado'));
    expect(m).not.toContain("$('Preparar recordatorios').item");
    expect(m).toContain("$('Omitir bloqueados').item.json");
  });

  it('pairedItem apunta al indice ORIGINAL', () => {
    const r = correrCon(lote(4), [bloq, ok({}), bloq, ok({})]);
    expect(r.map((x) => x.pairedItem.item)).toEqual([1, 3]);
    expect(ids(r)).toEqual(['ev1', 'ev3']);
  });

  it('envios <= antes, y no registra telefonos completos', () => {
    const logs: string[] = [];
    const orig = lote(5);
    const r = correr(CODIGO, orig.map(() => bloq), { 'Preparar recordatorios': orig }, { console: { log: (s: string) => logs.push(s) } });
    expect(r.length).toBeLessThanOrEqual(orig.length);
    expect(logs.join(' ')).not.toMatch(/\d{8,}/);
  });

  it('no usa globales que el Code de n8n no tiene', () => {
    for (const g of GLOBALES_FUERA_DEL_SANDBOX) expect(CODIGO).not.toMatch(new RegExp(`\\b${g}\\b`));
  });
});

describe('Lienzo', () => {
  it('Preparar -> Estado del contacto -> Omitir bloqueados -> ¿Plantilla aprobada? (1:1, sin otra entrada)', () => {
    expect(destinos(f, 'Preparar recordatorios')).toEqual(['Estado del contacto']);
    expect(destinos(f, 'Estado del contacto')).toEqual(['Omitir bloqueados']);
    expect(destinos(f, 'Omitir bloqueados')).toEqual(['¿Plantilla aprobada?']);
    expect(entradas(f, '¿Plantilla aprobada?')).toEqual(['Omitir bloqueados']);
  });

  it('«Estado del contacto» consulta con el telefono, tolera errores y no revienta el flujo', () => {
    const p = nodo(f, 'Estado del contacto') as unknown as { onError: string; parameters: J };
    expect(p.onError).toBe('continueRegularOutput');
    expect(p.parameters['jsonBody']).toContain('telefono: $json.telefono');
    expect(p.parameters['options'].timeout).toBe(4000);
    expect(p.parameters['options'].response.response).toEqual({ fullResponse: true, neverError: true });
  });
});
