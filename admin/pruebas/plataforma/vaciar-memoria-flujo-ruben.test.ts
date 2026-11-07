/**
 * `vaciar-memoria-flujo.mjs` con la clave `ruben` (el flujo nuevo de «Noches Sin Insomnio»): borra solo la ficha del sufijo dado,
 * incluida su protección de crisis (`riesgo`, `riesgoMs`), y nunca otra ficha. Núcleo puro; se prueba NEGANDO.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import { CLAVES, analizarArgumentos, sinFichas } from '../../scripts/plataforma/vaciar-memoria-flujo.mjs';

const A = '59170007339'; // sintético
const B = '59170001250'; // sintético
const sd = () => ({ global: { ruben: { [A]: { riesgo: true, riesgoMs: 1 }, [B]: { riesgo: false } }, rroca: { [A]: { x: 1 } } } });
const cfg = (extra = {}) => ({ clave: 'ruben', todas: false, sufijos: ['70007339'], conTopes: false, ...extra });

describe('vaciar-memoria-flujo con la clave ruben', () => {
  it('la clave ruben está admitida y una desconocida no', () => {
    expect(CLAVES).toContain('ruben');
    const env = { N8N_BASE_URL: 'https://n8n.ejemplo', N8N_API_KEY: 'k' };
    const a = ['--workflow', 'abc123XYZ', '--clave', 'ruben', '--sufijos', '70007339'];
    expect(analizarArgumentos(a, env).ok).toBe(true);
    expect(analizarArgumentos(['--workflow', 'abc123XYZ', '--clave', 'otra', '--sufijos', '70007339'], env).ok).toBe(false);
  });
  it('borra SOLO la ficha del sufijo (con su riesgo), conserva la otra y no toca la clave hermana', () => {
    const r = sinFichas(sd(), cfg());
    expect(r.ok).toBe(true);
    expect(r.aBorrar).toBe(1);
    expect(Object.keys(r.nuevo.global.ruben)).toEqual([B]);
    expect(r.nuevo.global.rroca[A]).toEqual({ x: 1 });
  });
  it('NIEGA un sufijo ambiguo y un flujo sin la clave', () => {
    const ambiguo = sd();
    (ambiguo.global.ruben as any)['59870007339'] = {};
    expect(sinFichas(ambiguo, cfg()).ok).toBe(false);
    expect(sinFichas({ global: {} }, cfg()).ok).toBe(false);
  });
  it('en seco por omisión no pide respaldo y --aplicar lo exige', () => {
    const env = { N8N_BASE_URL: 'https://n8n.ejemplo', N8N_API_KEY: 'k' };
    const base = ['--workflow', 'abc123XYZ', '--clave', 'ruben', '--sufijos', '70007339'];
    expect(analizarArgumentos([...base, '--aplicar', '--confirmo-produccion', 'abc123XYZ'], env).ok).toBe(false);
  });
});
