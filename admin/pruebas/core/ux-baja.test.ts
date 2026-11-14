/**
 * INVARIANTE GLOBAL «la baja por texto se respeta y se confirma» (13/11/2026): recorre TODOS los flujos de producción que atienden a un
 * cliente, descubiertos del disco con la lista única, y exige que cada uno lleve la baja común o tenga su excepción declarada.
 * Pruebas NEGADAS de las piezas puras (`ux/baja.ts`) y la medición real sobre `Flujos/`.
 */
import { describe, expect, it } from 'vitest';
import { leerFlujo, type Flujo } from '../lib/flujo';
import { flujosDeProduccion } from '../lib/flujos-de-cliente';
import { atiendeCliente, idDeFlujo } from './migracion/comprobaciones';
import {
  ALTA_BAJA, EXCEPCIONES_DE_BAJA, LIMITE_BAJA, NODO_REPORTE, TOPE_BAJA, expresionDeBaja, faltasDeBaja, fuenteDeBaja, incluyeLaPiezaDeBaja,
  plegadoDeBaja, problemasDeBaja, reporteDeBaja, type ExcepcionDeBaja, type HechoDeBaja,
} from './ux/baja';

const FUENTE = fuenteDeBaja();
const EXPRESION = expresionDeBaja(FUENTE);
const PLEGADO = plegadoDeBaja(FUENTE);

const flujo = (cuerpoDelReporte: string | undefined, codigos: string[] = []): Flujo => ({
  nodes: [
    ...(cuerpoDelReporte === undefined ? [] : [{ name: NODO_REPORTE, type: 'n8n-nodes-base.httpRequest', parameters: { jsonBody: cuerpoDelReporte } }]),
    ...codigos.map((jsCode, i) => ({ name: `Code ${i}`, type: 'n8n-nodes-base.code', parameters: { jsCode } })),
  ],
  connections: {},
} as unknown as Flujo);
const CUERPO_BUENO = `={{ JSON.stringify({ evento: ${EXPRESION}.test(String(t.texto || '')${PLEGADO}) ? 'no_contactar' : undefined }) }}`;
const CUERPO_AMPLIO = "={{ JSON.stringify({ evento: /no (me )?(escrib|mand|molest|contact|llam)|^stop$/i.test(String(t.texto || '')) ? 'no_contactar' : undefined }) }}";

describe('las piezas puras de la baja común', () => {
  it('la pieza declara la expresión y el plegado en la forma que se lee', () => {
    expect(EXPRESION.startsWith('/')).toBe(true);
    expect(EXPRESION.endsWith('/i')).toBe(true);
    expect(PLEGADO.startsWith(".normalize('NFKC')")).toBe(true);
    expect(PLEGADO.endsWith(".replace(/\\s+/g, ' ')")).toBe(true);
  });
  it('reporteDeBaja: literal de core con su plegado → core', () => {
    expect(reporteDeBaja(flujo(CUERPO_BUENO))).toBe('core');
  });
  it('NIEGA: la expresión amplia, una coma de diferencia o el literal sin plegado → otra', () => {
    expect(reporteDeBaja(flujo(CUERPO_AMPLIO))).toBe('otra');
    expect(reporteDeBaja(flujo(CUERPO_BUENO.replace('escrib(?:a|as', 'escrib(?:a|es')))).toBe('otra');
    expect(reporteDeBaja(flujo(CUERPO_BUENO.replace(PLEGADO, '')))).toBe('otra');
    expect(reporteDeBaja(flujo(CUERPO_BUENO.replace(".normalize('NFKC')", '')))).toBe('otra');
  });
  it('NIEGA: el literal en un comentario, sin `.test(`, no cuenta', () => {
    expect(reporteDeBaja(flujo(`={{ /* ${EXPRESION} ${PLEGADO} */ JSON.stringify({ evento: t.baja ? 'no_contactar' : undefined }) }}`))).toBe('otra');
  });
  it('NIEGA: sin `no_contactar`, o sin el nodo del reporte → ninguna', () => {
    expect(reporteDeBaja(flujo("={{ JSON.stringify({ telefono: t.from }) }}"))).toBe('ninguna');
    expect(reporteDeBaja(flujo(undefined))).toBe('ninguna');
  });
  const USA = "if (bjPideBaja(t.texto)) return [{ json: { texto: bjTextoBaja(cfg.textoBaja) } }];";
  it('incluyeLaPiezaDeBaja: la pieza entera, con librerías antes y el código que la llama después → sí (en un nodo o repartida en dos)', () => {
    expect(incluyeLaPiezaDeBaja(flujo(CUERPO_BUENO, ['const x = 1;', `// librería\n${FUENTE}\n${USA}`]))).toBe(true);
    expect(incluyeLaPiezaDeBaja(flujo(CUERPO_BUENO, [`${FUENTE}\nif (bjPideBaja(t.texto)) return [];`, `${FUENTE}\nconst m = bjTextoBaja();`]))).toBe(true);
  });
  it('NIEGA: la pieza pegada sin llamarla, o llamada sin llevar la pieza → no', () => {
    expect(incluyeLaPiezaDeBaja(flujo(CUERPO_BUENO, [`${FUENTE}\nreturn [];`]))).toBe(false);
    expect(incluyeLaPiezaDeBaja(flujo(CUERPO_BUENO, [`${FUENTE}\nif (bjPideBaja(t.texto)) return [];`]))).toBe(false);
    expect(incluyeLaPiezaDeBaja(flujo(CUERPO_BUENO, [USA]))).toBe(false);
  });
  it('NIEGA: un byte alterado, o solo la expresión sin la pieza → no', () => {
    expect(incluyeLaPiezaDeBaja(flujo(CUERPO_BUENO, [FUENTE.replace('tomé nota', 'tome nota')]))).toBe(false);
    expect(incluyeLaPiezaDeBaja(flujo(CUERPO_BUENO, [`const BJ_BAJA = ${EXPRESION};`]))).toBe(false);
    expect(incluyeLaPiezaDeBaja(flujo(CUERPO_BUENO))).toBe(false);
  });
  it('faltasDeBaja: cumple los dos → vacío; cada hecho falta por separado', () => {
    expect(faltasDeBaja(flujo(CUERPO_BUENO, [`${FUENTE}\n${USA}`]))).toEqual([]);
    expect(faltasDeBaja(flujo(CUERPO_AMPLIO, [`${FUENTE}\n${USA}`]))).toEqual(['reporte']);
    expect(faltasDeBaja(flujo(CUERPO_BUENO))).toEqual(['confirma']);
    expect(faltasDeBaja(flujo(undefined))).toEqual(['reporte', 'confirma']);
  });
});

describe('problemasDeBaja: el cruce con las excepciones', () => {
  const e = (parcial: Partial<ExcepcionDeBaja> = {}): ExcepcionDeBaja => ({ hechos: ['reporte', 'confirma'], motivo: 'm', dueno: 'd', vence: '2027-01-31', ...parcial });
  const HOY = '2026-11-13';
  const faltas = (o: Record<string, HechoDeBaja[]>): Map<string, HechoDeBaja[]> => new Map(Object.entries(o));
  it('todo cubierto y nada sobra → sin problemas', () => {
    expect(problemasDeBaja(faltas({ 'a.json': ['reporte', 'confirma'], 'b.json': ['confirma'] }), { 'a.json': e(), 'b.json': e({ hechos: ['confirma'] }) }, 2, HOY)).toEqual([]);
  });
  it('NIEGA: una falta sin excepción', () => {
    expect(problemasDeBaja(faltas({ 'a.json': ['reporte'] }), {}, 0, HOY)).toEqual([expect.stringContaining('a.json#reporte: no cumple')]);
    expect(problemasDeBaja(faltas({ 'a.json': ['reporte', 'confirma'] }), { 'a.json': e({ hechos: ['confirma'] }) }, 1, HOY)).toEqual([expect.stringContaining('a.json#reporte: no cumple')]);
  });
  it('NIEGA: una excepción que ya se cumple SOBRA, entera o por hecho', () => {
    expect(problemasDeBaja(faltas({}), { 'a.json': e() }, 1, HOY)).toEqual([expect.stringContaining('SOBRA')]);
    expect(problemasDeBaja(faltas({ 'a.json': ['confirma'] }), { 'a.json': e() }, 1, HOY)).toEqual([expect.stringContaining('a.json#reporte: SOBRA')]);
  });
  it('NIEGA: más excepciones que el tope', () => {
    expect(problemasDeBaja(faltas({ 'a.json': ['reporte', 'confirma'] }), { 'a.json': e() }, 0, HOY)).toEqual([expect.stringContaining('el tope solo baja')]);
  });
  it('NIEGA: sin motivo, sin dueño, fecha inválida, más allá del límite, vencida', () => {
    const f = faltas({ 'a.json': ['reporte', 'confirma'] });
    expect(problemasDeBaja(f, { 'a.json': e({ motivo: ' ' }) }, 1, HOY)).toEqual([expect.stringContaining('sin motivo')]);
    expect(problemasDeBaja(f, { 'a.json': e({ dueno: '' }) }, 1, HOY)).toEqual([expect.stringContaining('sin dueño')]);
    expect(problemasDeBaja(f, { 'a.json': e({ vence: 'pronto' }) }, 1, HOY)).toEqual([expect.stringContaining('no es una fecha')]);
    expect(problemasDeBaja(f, { 'a.json': e({ vence: '2027-02-12' }) }, 1, HOY)).toEqual([expect.stringContaining('después del límite')]);
    expect(problemasDeBaja(f, { 'a.json': e({ vence: '2026-11-12' }) }, 1, HOY)).toEqual([expect.stringContaining('VENCIDA')]);
  });
});

describe('todos los flujos de producción que atienden a un cliente', () => {
  const medidos = flujosDeProduccion().map((ruta) => [ruta, leerFlujo(ruta)] as const).filter(([, f]) => atiendeCliente(f));
  const faltas = new Map<string, HechoDeBaja[]>();
  for (const [ruta, f] of medidos) { const x = faltasDeBaja(f); if (x.length > 0) faltas.set(idDeFlujo(ruta), x); }

  it('la lista única descubre flujos que atienden (si queda vacía, la prueba no mira nada)', () => {
    expect(medidos.length).toBeGreaterThanOrEqual(10);
  });
  it('cada flujo lleva la baja común (expresión literal en el reporte y la pieza incluida) o tiene su excepción declarada', () => {
    expect(problemasDeBaja(faltas)).toEqual([]);
  });
  it('el tope es la cuenta de hoy y el límite son 90 días desde el alta', () => {
    expect(Object.keys(EXCEPCIONES_DE_BAJA)).toHaveLength(TOPE_BAJA);
    expect(new Date(`${LIMITE_BAJA}T00:00:00Z`).getTime() - new Date(`${ALTA_BAJA}T00:00:00Z`).getTime()).toBe(90 * 86_400_000);
  });
  it('al menos un flujo ya cumple los dos hechos sin excepción (la regla no es letra muerta)', () => {
    expect(medidos.some(([ruta]) => !faltas.has(idDeFlujo(ruta)))).toBe(true);
  });
});
