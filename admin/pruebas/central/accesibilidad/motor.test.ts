// @vitest-environment jsdom
/**
 * PRUEBAS DE ACCESIBILIDAD CON MOTOR (13/11/2026): la `App` real de la consola se monta en jsdom con `react-dom/client`, en ocho pantallas
 * con datos mínimos, y se le pasa axe-core (WCAG 2.0, 2.1 y 2.2, A y AA). Solo se sustituye la capa de datos (Firebase); ver
 * `sustitutos.ts`, `dibujar.ts` y `paginas.ts`. Lo encontrado se compara con `linea-de-base-motor.ts`: el tope solo baja.
 * Qué mide y qué no: docs/arquitectura/accesibilidad-consola.md. Sin red ni emulador.
 *
 * ATENCIÓN: cambiar `ALTA_MOTOR`, `TOPE_MOTOR`, la base hacia arriba o `DESACTIVADAS` exige pasar por el agente `seguridad`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const sesion = vi.hoisted(() => ({ valor: null as unknown }));
vi.mock('../../../web/src/core/lib/firebase', async () => (await import('./sustitutos')).firebaseFalso);
vi.mock('../../../web/src/core/lib/contexto', () => ({ useSesion: () => sesion.valor, ProveedorSesion: ({ children }: { children: unknown }) => children }));
vi.mock('firebase/firestore', async (orig) => (await import('./sustitutos')).firestoreFalso(await orig<Record<string, unknown>>()));
vi.mock('firebase/functions', async (orig) => (await import('./sustitutos')).functionsFalso(await orig<Record<string, unknown>>()));
vi.mock('firebase/auth', async (orig) => (await import('./sustitutos')).authFalso(await orig<Record<string, unknown>>()));

import { App } from '../../../web/src/App';
import { capacidadesDeConsola } from '../../../web/src/central/lib/flujos';
import { modulosDeFicha } from '../../../functions/src/registro';
import { ALTA_MOTOR, LINEA_DE_BASE_MOTOR, TOPE_MOTOR, TOPE_MOTOR_POR_REGLA } from './linea-de-base-motor';
import { compararConLineaDeBase } from './linea-de-base';
import { ALTA_MOTOR_FIJADA, TOPE_MOTOR_MAXIMO } from './tope-fijado';
import { AHORA, PAGINAS, type PaginaDePrueba } from './paginas';
import { ALMACEN, reiniciarAlmacen } from './sustitutos';
import {
  DESACTIVADAS, agruparAxe, axe, correrAxe, correrAxeSobreHtml, dibujarRuta, problemasDeDibujo, reglasEsperadas, reglasEvaluadas,
  type AxeInforme,
} from './dibujar';

const DONDE_MOTOR = { archivo: 'linea-de-base-motor.ts', topes: 'TOPE_MOTOR y TOPE_MOTOR_MAXIMO' };

interface Medida {
  problemas: string[];
  axe: AxeInforme;
  lecturas: number;
  escrituras: string[];
  red: number;
  sinSustituto: string[];
}
const medidas = new Map<string, Medida>();
let encontradas: Record<string, number> = {};
let reglasVistas: string[] = [];
let primeraSola: Record<string, number> = {};
let primeraDespues: Record<string, number> = {};
const ordenadas = [...PAGINAS].sort((a, b) => a.id.localeCompare(b.id));

function problemasDe(p: PaginaDePrueba, texto: string, html: string): string[] {
  const salida = problemasDeDibujo(texto, p.enHtml ? [] : [p.centinela]);
  if (p.enHtml && !html.includes(p.centinela)) salida.push(`falta el centinela «${p.centinela}» en el HTML`);
  return salida;
}

async function medir(p: PaginaDePrueba): Promise<Medida> {
  reiniciarAlmacen(p.escenario());
  sesion.valor = p.sesion;
  const d = await dibujarRuta(p.ruta, App);
  const informe = await correrAxe();
  const medida: Medida = {
    problemas: problemasDe(p, d.texto, d.html), axe: informe, lecturas: ALMACEN.lecturas, escrituras: [...ALMACEN.escrituras],
    red: ALMACEN.red, sinSustituto: [...ALMACEN.sinSustituto],
  };
  await d.desmontar();
  return medida;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: AHORA });
  vi.stubGlobal('fetch', async () => { ALMACEN.red++; throw new Error('red no permitida en la prueba de accesibilidad'); });
  const vistas = new Set<string>();
  for (const p of ordenadas) {
    const m = await medir(p);
    medidas.set(p.id, m);
    Object.assign(encontradas, agruparAxe(p.id, m.axe));
    for (const r of reglasEvaluadas(m.axe)) vistas.add(r);
  }
  reglasVistas = [...vistas].sort();
  // Para la prueba de orden: la primera página sola, y otra vez tras haber dibujado las demás.
  const primera = ordenadas[0]!;
  primeraSola = agruparAxe(primera.id, medidas.get(primera.id)!.axe);
  primeraDespues = agruparAxe(primera.id, (await medir(primera)).axe);
}, 120000);

afterAll(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('accesibilidad con motor: la App real en ocho pantallas, con axe-core', () => {
  it('cada página se dibujó con datos de verdad (no «Cargando…», no «Sin permiso», con su dato centinela)', () => {
    const malas = ordenadas.flatMap((p) => (medidas.get(p.id)?.problemas ?? ['sin medida']).map((x) => `${p.id}: ${x}`));
    expect(malas).toEqual([]);
    expect(medidas.size).toBe(PAGINAS.length);
    expect(PAGINAS.length).toBeGreaterThanOrEqual(5);
  });

  it('hermética: toda página con datos leyó, ninguna escribió, ninguna salió a la red ni llamó algo sin sustituto', () => {
    for (const p of ordenadas) {
      const m = medidas.get(p.id)!;
      if (p.id !== 'ingresar') expect(m.lecturas, `${p.id} lecturas`).toBeGreaterThan(0);
      expect(m.escrituras, `${p.id} escrituras`).toEqual([]);
      expect(m.red, `${p.id} red`).toBe(0);
      expect(m.sinSustituto, `${p.id} sin sustituto`).toEqual([]);
    }
  });

  it('axe corrió de verdad: evaluó exactamente las reglas WCAG esperadas (al menos 55)', () => {
    expect(reglasVistas).toEqual(reglasEsperadas());
    expect(reglasVistas.length).toBeGreaterThanOrEqual(55);
  });

  it('la versión de axe-core es la admitida (4.14.0): cambiarla cambia las reglas y las cuentas', () => {
    expect(axe.version).toBe('4.14.0');
  });

  it('las reglas que no se pueden evaluar en jsdom son una lista cerrada de seis y existen en axe', () => {
    expect(Object.keys(DESACTIVADAS).sort()).toEqual([
      'color-contrast', 'css-orientation-lock', 'label-content-name-mismatch', 'link-in-text-block', 'scrollable-region-focusable', 'target-size',
    ]);
    const todas = axe.getRules().map((r) => r.ruleId);
    for (const r of Object.keys(DESACTIVADAS)) expect(todas, r).toContain(r);
  });

  it('lo encontrado coincide con la línea de base del motor: ni nada nuevo ni base que sobre', () => {
    expect(compararConLineaDeBase(encontradas, LINEA_DE_BASE_MOTOR, DONDE_MOTOR)).toEqual([]);
  });

  it('la base suma TOPE_MOTOR, su desglose por regla es TOPE_MOTOR_POR_REGLA y toda página de la base existe', () => {
    expect(Object.values(LINEA_DE_BASE_MOTOR).reduce((a, b) => a + b, 0)).toBe(TOPE_MOTOR);
    const porRegla: Record<string, number> = {};
    for (const [clave, n] of Object.entries(LINEA_DE_BASE_MOTOR)) {
      const regla = clave.split('#')[1] ?? '';
      porRegla[regla] = (porRegla[regla] ?? 0) + n;
    }
    expect(porRegla).toEqual(TOPE_MOTOR_POR_REGLA);
    const ids = PAGINAS.map((p) => p.id);
    expect([...new Set(Object.keys(LINEA_DE_BASE_MOTOR).map((k) => k.split('#')[0] ?? ''))].filter((i) => !ids.includes(i))).toEqual([]);
  });

  it('el tope no sube en silencio: ALTA_MOTOR es la fijada y TOPE_MOTOR no pasa del máximo fijado en tope-fijado.ts', () => {
    expect(ALTA_MOTOR).toBe(ALTA_MOTOR_FIJADA);
    expect(TOPE_MOTOR).toBeLessThanOrEqual(TOPE_MOTOR_MAXIMO);
  });

  it('el orden no cambia el resultado: la primera página da lo mismo sola que después de dibujar las demás', () => {
    expect(primeraDespues).toEqual(primeraSola);
  });

  it('la ficha de prueba abre Cobros (el comercio de prueba tiene pedidos)', () => {
    const ficha = PAGINAS.find((p) => p.id === 'cobros')!.escenario().docs?.['tenants/comercio-a11y'] ?? {};
    expect(capacidadesDeConsola(modulosDeFicha(ficha)).conPedidos).toBe(true);
  });
});

describe('contrapruebas: el motor detecta y la suite no se deja engañar', () => {
  it('un HTML con imagen sin alt y botón sin nombre SÍ da image-alt y button-name, y hay reglas que pasan', async () => {
    const r = await correrAxeSobreHtml('<main><h1>x</h1><img src="x.png"><button type="button"></button></main>');
    const cuenta = agruparAxe('c', r);
    expect(cuenta['c#image-alt']).toBe(1);
    expect(cuenta['c#button-name']).toBe(1);
    expect(r.passes.length).toBeGreaterThan(0);
  });

  it('problemasDeDibujo marca texto vacío, «Cargando…», «Sin permiso» y texto largo sin el centinela', () => {
    const largo = 'texto largo de relleno que supera con holgura los cuarenta caracteres sin espacios del umbral';
    expect(problemasDeDibujo('', [])).not.toEqual([]);
    expect(problemasDeDibujo('Cargando…', [])).not.toEqual([]);
    expect(problemasDeDibujo(`${largo} Sin permiso`, [])).not.toEqual([]);
    expect(problemasDeDibujo(largo, ['CENTINELA'])).not.toEqual([]);
    expect(problemasDeDibujo(`${largo} CENTINELA`, ['CENTINELA'])).toEqual([]);
  });

  it('una página sin datos (lecturas colgadas) da problema de dibujo: la suite se pondría en rojo', async () => {
    const p = PAGINAS.find((x) => x.id === 'consumo')!;
    reiniciarAlmacen(p.escenario());
    ALMACEN.colgado = true;
    sesion.valor = p.sesion;
    const d = await dibujarRuta(p.ruta, App);
    const problemas = problemasDe(p, d.texto, d.html);
    await d.desmontar();
    expect(problemas).not.toEqual([]);
  });

  it('el texto de «la línea de base sobra» con el `donde` del motor nombra linea-de-base-motor.ts', () => {
    const textos = compararConLineaDeBase({}, { 'x#regla': 1 }, DONDE_MOTOR);
    expect(textos).toHaveLength(1);
    expect(textos[0]).toContain('linea-de-base-motor.ts');
    expect(textos[0]).toContain('TOPE_MOTOR');
  });
});
