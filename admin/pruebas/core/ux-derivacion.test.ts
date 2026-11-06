/**
 * INVARIANTE GLOBAL «respuesta resuelta ⇒ sin botón de derivación» (22/10/2026): infraestructura (PR D1 de core). Las tablas por flujo las escribe Cartera (D2 a D5).
 * Pruebas NEGADAS de la regla, del vigilante, de la cobertura estática y del registro de flujos conversacionales.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { J } from '../lib/flujo';
import type { Mundo, ResultadoTurno } from '../lib/n8n-de-mentira';
import { coberturaDePlanes, esBotonDeDerivacion, planesDelCodigo, vigilarDerivacion, violacionesDeDerivacion, type TablaDePlanes } from './ux/derivacion';
import { EXCEPCIONES, flujosConversacionales, problemasDelRegistro } from './ux/flujos-derivacion';

const ctaUrl = (url: string, texto = 'Escribir'): J => ({ interactive: { type: 'cta_url', body: { text: 'Hola' }, action: { name: 'cta_url', parameters: { display_text: texto, url } } } });
const WA = { tipo: 'interactive', cuerpo: 'Te paso con una persona', payload: ctaUrl('https://wa.me/59170000000?text=Hola') };
const API_WA = { tipo: 'interactive', cuerpo: 'x', payload: ctaUrl('https://api.whatsapp.com/send?phone=59170000000') };
const CATALOGO = { tipo: 'interactive', cuerpo: 'Mira el catálogo', payload: ctaUrl('https://catalogo.ejemplo.test/tienda', 'Ver catálogo') };
const MAPA = { tipo: 'interactive', cuerpo: 'Estamos aquí', payload: ctaUrl('https://maps.google.com/?q=-16.5,-68.1', 'Ver mapa') };
const TEXTO = { tipo: 'text', cuerpo: 'El precio es 100 Bs.', payload: { text: { body: 'El precio es 100 Bs.' } } };
const RESPALDO_WA = { tipo: 'text', cuerpo: 'Te paso con una persona. Escríbele aquí: https://wa.me/59170000000', payload: { text: { body: 'x' } }, respaldo: true };
const CON = { hayRecepcion: true };

describe('esBotonDeDerivacion: definición independiente del texto', () => {
  it('cta_url a wa.me y a api.whatsapp.com SÍ; catálogo y mapa NO; un respaldo con wa.me SÍ; texto plano NO', () => {
    expect(esBotonDeDerivacion(WA)).toBe(true);
    expect(esBotonDeDerivacion(API_WA)).toBe(true);
    expect(esBotonDeDerivacion(CATALOGO)).toBe(false);
    expect(esBotonDeDerivacion(MAPA)).toBe(false);
    expect(esBotonDeDerivacion(RESPALDO_WA)).toBe(true);
    expect(esBotonDeDerivacion({ payload: {}, respaldo: 'Escríbele: https://wa.me/591700' })).toBe(true);
    expect(esBotonDeDerivacion(TEXTO)).toBe(false);
  });
  it('NIEGA: un dominio que solo contiene «wa.me» en otra posición no es derivación', () => {
    expect(esBotonDeDerivacion({ payload: ctaUrl('https://ejemplo.test/?r=https://wa.me/1') })).toBe(false);
    expect(esBotonDeDerivacion({ payload: ctaUrl('https://wa.me.ejemplo.test/x') })).toBe(false);
  });
});

describe('violacionesDeDerivacion', () => {
  it('NIEGA: un cta_url wa.me con clase «resuelve» es violación', () => {
    expect(violacionesDeDerivacion('resuelve', [WA], CON)).toHaveLength(1);
    expect(violacionesDeDerivacion('resuelve', [API_WA], CON)).toHaveLength(1);
  });
  it('NIEGA: un cta_url de catálogo o mapa con «resuelve» NO es violación', () => {
    expect(violacionesDeDerivacion('resuelve', [CATALOGO], CON)).toEqual([]);
    expect(violacionesDeDerivacion('resuelve', [MAPA, TEXTO], CON)).toEqual([]);
  });
  it('NIEGA: un respaldo con wa.me en un plan «resuelve» es violación', () => {
    expect(violacionesDeDerivacion('resuelve', [RESPALDO_WA], CON)).toHaveLength(1);
  });
  it('NIEGA: «deriva» sin botón y con recepción es violación; sin recepción o en el mismo número, no; con botón, no', () => {
    expect(violacionesDeDerivacion('deriva', [TEXTO], CON)).toHaveLength(1);
    expect(violacionesDeDerivacion('deriva', [TEXTO], { hayRecepcion: false })).toEqual([]);
    expect(violacionesDeDerivacion('deriva', [TEXTO], { hayRecepcion: true, mismoNumero: true })).toEqual([]);
    expect(violacionesDeDerivacion('deriva', [WA], CON)).toEqual([]);
    expect(violacionesDeDerivacion('deriva', [], CON)).toEqual([]);
  });
  it('NIEGA: un plan desconocido (sin clasificar) es violación; «exento» no se vigila; una imagen no cuenta', () => {
    expect(violacionesDeDerivacion(undefined, [TEXTO], CON)).toHaveLength(1);
    expect(violacionesDeDerivacion('exento', [WA], CON)).toEqual([]);
    expect(violacionesDeDerivacion('resuelve', [{ tipo: 'image', payload: { type: 'image' } }, TEXTO], CON)).toEqual([]);
  });
});

/** Un mundo de mentira con turnos guionados: lo justo para probar el envoltorio. */
function mundoFalso(planes: Array<{ plan: string; mensajes: Array<typeof TEXTO | typeof WA> }>): Mundo {
  let i = 0;
  return {
    turno: () => {
      const p = planes[i++]!;
      return { mensajes: p.mensajes.map((m) => ({ ...m, respaldo: (m as { respaldo?: boolean }).respaldo ?? false })), resumen: { plan: p.plan } } as unknown as ResultadoTurno;
    },
  } as unknown as Mundo;
}
const TABLA: TablaDePlanes = { precio: { clase: 'resuelve' }, derivar: { clase: 'deriva' }, comprobante: { clase: 'exento', porque: 'su botón depende del resultado del cotejo' } };
const clasificar = (t: ResultadoTurno) => TABLA[String((t.resumen as J | null)?.['plan'] ?? '')]?.clase;

describe('vigilarDerivacion envuelve mundo.turno y cuenta los turnos', () => {
  it('turnos correctos pasan y se cuentan', () => {
    const m = mundoFalso([{ plan: 'precio', mensajes: [TEXTO] }, { plan: 'derivar', mensajes: [WA] }, { plan: 'comprobante', mensajes: [WA] }]);
    const c = vigilarDerivacion(m, { clasificar, hayRecepcion: true });
    for (let i = 0; i < 3; i++) m.turno({});
    expect(c.turnos).toBe(3);
  });
  it('NIEGA: un plan que resuelve con botón rompe el turno; un plan sin clasificar también', () => {
    const m = mundoFalso([{ plan: 'precio', mensajes: [WA] }]);
    vigilarDerivacion(m, { clasificar, hayRecepcion: true });
    expect(() => m.turno({})).toThrow(/derivación violado/);
    const n = mundoFalso([{ plan: 'plan_nuevo', mensajes: [TEXTO] }]);
    vigilarDerivacion(n, { clasificar, hayRecepcion: true });
    expect(() => n.turno({})).toThrow(/no está clasificado/);
  });
  it('NIEGA: un plan que deriva sin botón rompe el turno, salvo sin recepción', () => {
    const m = mundoFalso([{ plan: 'derivar', mensajes: [TEXTO] }, { plan: 'derivar', mensajes: [TEXTO] }]);
    vigilarDerivacion(m, { clasificar, hayRecepcion: (_t) => false });
    expect(() => m.turno({})).not.toThrow();
    const n = mundoFalso([{ plan: 'derivar', mensajes: [TEXTO] }]);
    vigilarDerivacion(n, { clasificar, hayRecepcion: true });
    expect(() => n.turno({})).toThrow();
  });
});

describe('cobertura estática de planes (armar-mensajes.js)', () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'deriv-'));
  const escribir = (nombre: string, cuerpo: string) => { const r = join(carpeta, nombre); writeFileSync(r, cuerpo); return r; };
  it('lee tipoDePlan === y tipo === del código', () => {
    const r = escribir('a.js', "if (tipoDePlan === 'precio') {}\nelse if (tipo === 'derivar') {}\nconst x = plan.tipo === 'ajeno';\n");
    expect(planesDelCodigo(r)).toEqual(['derivar', 'precio']);
  });
  it('NIEGA: un armar-mensajes de prueba con un plan sin tabla hace fallar la cobertura', () => {
    const r = escribir('b.js', "if (tipoDePlan === 'precio') {}\nif (tipoDePlan === 'plan_nuevo') {}\n");
    expect(coberturaDePlanes(r, TABLA)).toEqual(['plan sin clasificar: «plan_nuevo»']);
    expect(coberturaDePlanes(r, { ...TABLA, plan_nuevo: { clase: 'resuelve' } })).toEqual([]);
  });
  it('NIEGA: un exento sin porqué no cubre', () => {
    const r = escribir('c.js', "if (tipoDePlan === 'precio') {}\n");
    expect(coberturaDePlanes(r, { precio: { clase: 'exento' } })).toEqual(['plan exento sin porqué: «precio»']);
    rmSync(carpeta, { recursive: true, force: true });
  });
});

describe('registro de flujos conversacionales', () => {
  it('descubre del disco los flujos de Flujos/experimental y todos tienen tabla o excepción', () => {
    const flujos = flujosConversacionales();
    expect(flujos).toEqual(expect.arrayContaining(['rroca-antonio', 'rroca-ruben', 'venta-minima', 'chat-novuchat', 'doctoras', 'agenda-minima']));
    expect(flujos).not.toContain('comun-sin-agente');
    expect(problemasDelRegistro()).toEqual([]);
  });
  it('las excepciones iniciales están fechadas y con porqué', () => {
    for (const [f, e] of Object.entries(EXCEPCIONES)) { expect(e.desde, f).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(e.porque.length, f).toBeGreaterThan(20); }
  });
  it('NIEGA: un flujo conversacional nuevo sin tabla ni excepción falla', () => {
    const p = problemasDelRegistro([...flujosConversacionales(), 'flujo-nuevo'], EXCEPCIONES);
    expect(p).toEqual(['flujo-nuevo: flujo conversacional sin tabla de derivación ni excepción declarada']);
  });
  it('NIEGA: una excepción que sobra (ya hay tabla), de un flujo inexistente o sin porqué falla', () => {
    expect(problemasDelRegistro(['a'], { a: { desde: '2026-10-23', porque: 'x'.repeat(30) } }, () => true)).toEqual(['a: ya tiene tabla; la excepción sobra']);
    expect(problemasDelRegistro(['a'], { a: { desde: '2026-10-23', porque: 'ok' }, b: { desde: '2026-10-23', porque: 'ok' } }, () => false)).toEqual(['b: excepción de un flujo que no existe']);
    expect(problemasDelRegistro(['a'], { a: { desde: 'ayer', porque: ' ' } }, () => false)).toEqual(['a: la excepción necesita fecha (AAAA-MM-DD) y porqué']);
  });
});
