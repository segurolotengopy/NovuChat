/**
 * miniCRM en Captación mínima (PR-B2): el flujo INCLUYE el módulo `crm` en vez de llevar sus dos copias.
 *
 *   · «misma salida que hoy»: `crmDecidirFila` con el mapa de NovuChat y el adaptador de captación da lo MISMO que el decidir-fila que llevaba
 *     Captación mínima, congelado como oráculo (`oraculo/decidir-fila-captacion-minima.js`, copia exacta; es de prueba y nunca entra a un flujo):
 *     40 casos de tabla y 300 con semilla fija.
 *   · el delta se DECLARA y se NIEGA: (1) `seguro` pasa a estricto (L2 de chat-novuchat: «= =1» ya no deja «=1»); (2) con dos filas del mismo
 *     teléfono se actualiza la MÁS RECIENTE (antes, la primera que leía n8n, que era la más antigua).
 *   · el flujo versionado lleva el código del módulo y el mapa, sin copias.
 * Mensajes por conversación: 0 (ninguna de estas piezas envía).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GLOBALES_FUERA_DEL_SANDBOX } from '../../lib/flujo.ts';
// @ts-expect-error módulo .mjs sin tipos
import { inyectarMapa } from '../../../../Flujos/experimental/comun-sin-agente/construir-crm.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..', '..');
const MODULOS = join(RAIZ, 'Flujos', 'src', 'modulos');
const leer = (r: string) => readFileSync(join(MODULOS, r), 'utf8');
const ORACULO = readFileSync(join(AQUI, 'oraculo', 'decidir-fila-captacion-minima.js'), 'utf8');
const DATOS = join(RAIZ, 'admin', 'scripts', 'datos', 'captacion-minima');

type J = Record<string, unknown>;
type Item = { json: J; error?: unknown };

/** El mapa REAL del tenant (dato versionado), el mismo que el flujo lleva dentro del código. */
const MAPA = (JSON.parse(readFileSync(join(DATOS, 'novuchat.json'), 'utf8')) as J)['crm'];
const clonar = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const TITULOS = ['ID Lead', 'Fecha Registro', 'Nombre y Apellido', 'Empresa / Cliente', 'Teléfono WhatsApp', 'Rubro', 'Etapa Funnel', 'Origen / Canal', 'Calificación IA', 'Resumen Chatbot IA'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function correr(codigo: string, entrada: Item[], nodos: Record<string, Item[]> = {}): any {
  const $ = (n: string) => {
    if (!(n in nodos)) throw new Error(`nodo sin ejecutar: ${n}`);
    return { all: () => nodos[n], first: () => nodos[n][0] };
  };
  const $input = { all: () => entrada, first: () => entrada[0] };
  const vacios = GLOBALES_FUERA_DEL_SANDBOX;
  return compileFunction(codigo, ['$input', '$', ...vacios])($input, $, ...vacios.map(() => undefined));
}

const CRM = leer('crm/crm.js');
const ADAPTADOR = leer('captacion/crm-captacion.js');
const NODO_DECIDIR = leer('crm/nodo-decidir-fila.js');
const CODIGO_NODO = [inyectarMapa(CRM, MAPA), ADAPTADOR, NODO_DECIDIR].join('\n');

const AHORA = Date.UTC(2026, 9, 30, 15, 0, 0);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(AHORA); });
afterEach(() => { vi.useRealTimers(); });

function nuevo(prospectos: J[], busqueda: Item[], ids: Item[]) {
  const pros = prospectos.map((json) => ({ json }));
  const nodos = { 'Prospecto para la planilla': pros, 'Buscar teléfono en planilla': busqueda };
  return { oraculo: correr(ORACULO, ids, nodos), nodo: correr(CODIGO_NODO, ids, nodos) };
}
const fila = (n: number, tel: string, extra: J = {}): Item => ({ json: { row_number: n, ...Object.fromEntries(TITULOS.map((t) => [t, ''])), 'Teléfono WhatsApp': tel, ...extra } });
const TEL = ['59', '17', '000', '001'].join('');
const OTRO = ['59', '17', '000', '002'].join('');

describe('misma salida que hoy: tabla de 40 casos', () => {
  const calis = ['', 'Baja', 'Media', 'Descalificado', 'Alta'];
  const hechos: Array<[string, J]> = [
    ['sin hechos', {}],
    ['pidió planes', { hechos: { pidioPlanes: true } }],
    ['respondió y eligió rubro', { rubro: 'Panadería', hechos: { respondioDolor: true } }],
    ['descarte', { hechos: { descarte: 'spam_o_prueba' } }],
  ];
  const casos: Array<[string, J[], Item[], Item[]]> = [];
  for (const c of calis) for (const [nombre, h] of hechos) {
    casos.push([`fila existente, celda «${c || 'vacía'}», ${nombre}`, [{ telefono: TEL, nombre: 'Ana', empresa: 'Taller Sol', rubro: 'Ropa', ...h }],
      [fila(5, TEL, { 'Calificación IA': c, 'Nombre y Apellido': 'Ana' })], [{ json: { row_number: 2, 'ID Lead': 'LEAD-1010' } }]]);
    casos.push([`fila nueva, ${nombre}, ${c || 'sin'} (fórmulas y anuncio)`, [{ telefono: TEL, nombre: c ? '=HYPERLINK("x")' : '@ana', empresa: '+Taller', anuncio: c === 'Alta', ...h }],
      [], [{ json: { row_number: 2, 'ID Lead': 'LEAD-1003' } }, { json: { row_number: 3, 'ID Lead': ' lead-1020 ' } }]]);
  }
  it('hay 40 casos', () => expect(casos).toHaveLength(40));
  it.each(casos)('%s', (_n, pros, bus, ids) => {
    const r = nuevo(pros, bus, ids);
    expect(r.nodo).toEqual(r.oraculo);
  });
});

describe('misma salida que hoy: 300 casos con semilla fija', () => {
  function azar(semilla: number) { let a = semilla; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; }; }
  const R = azar(20261031);
  const elige = <T,>(l: T[]): T => l[Math.floor(R() * l.length)];
  // Sin los textos con DOS bloques de signos de fórmula seguidos («= =1»): ahí está el delta declarado (se niega aparte, abajo).
  const textos = ['', 'Ana', 'Ana Pérez', '=1+1', ' +591', '@ana', '​=A1', 'a­=b', 'Tienda  de   ropa', 'x'.repeat(200), 'Taller\nSol'];
  const rubros = ['', 'Panadería', 'Ropa', '=SUMA(1)', 'Salud y belleza'];
  const hechos = [undefined, { pidioPlanes: true }, { pidioAsesor: true }, { respondioDolor: true }, { descarte: 'sin_negocio' }, { descarte: 'raro' }, { temas: ['costos', 'x'], respondioDolor: true }];
  const calis = ['', 'Baja', 'Media', 'Descalificado', 'Alta', 'otra'];
  const fallo = { name: 'NodeApiError', httpCode: '403', message: 'The caller does not have permission PERMISSION_DENIED' };
  for (let i = 0; i < 300; i++) {
    it(`caso ${i}`, () => {
      const tel = elige([TEL, OTRO]);
      const p: J = { telefono: elige([tel, tel, tel, '']), nombre: elige(textos), empresa: elige(textos), rubro: elige(rubros), necesidad: elige(textos), anuncio: R() < 0.2,
        estado: elige(['', 'cerrado', 'en_conversacion', 'operador', 'bloqueado']), consulta: elige(['', 'precios']), flujos: elige(['', 'agenda']) };
      const h = elige(hechos); if (h) p.hechos = h;
      // A lo sumo UNA fila de este teléfono (con dos, el delta declarado cambia cuál se actualiza): las demás son de otro número.
      const n = Math.floor(R() * 4);
      let usada = false;
      const filas = Array.from({ length: n }, (_, k) => {
        const mia = !usada && R() < 0.5; if (mia) usada = true;
        return fila(2 + Math.floor(R() * 50) + k * 60, mia ? elige([tel, '+' + tel]) : (tel === TEL ? OTRO : TEL), {
          'Calificación IA': elige(calis), 'Nombre y Apellido': elige(textos), 'Empresa / Cliente': elige(textos), Rubro: elige(rubros), 'Resumen Chatbot IA': elige(textos) });
      });
      let ids: Item[] = Array.from({ length: Math.floor(R() * 4) }, (_, k) => ({ json: { row_number: 2 + k, 'ID Lead': elige(['LEAD-1005', 'LEAD-1099', 'x', '', 'lead-1100']) } }));
      let bus: Item[] = filas;
      const tipo = R();
      if (tipo < 0.07) bus = [{ json: { error: fallo }, error: fallo }];
      else if (tipo < 0.12) ids = [{ json: { error: fallo } }];
      else if (tipo < 0.17 && bus.length) { const f = clonar(bus[0].json); delete f[elige(TITULOS)]; bus = [{ json: f }, ...bus.slice(1)]; }
      else if (tipo < 0.21) ids = [{ json: { row_number: 2, 'Otro título': 'LEAD-1' } }];
      const r = nuevo([p], bus, ids);
      expect(r.nodo).toEqual(r.oraculo);
    });
  }
});

describe('el delta declarado, negado', () => {
  const ids = [{ json: { row_number: 2, 'ID Lead': 'LEAD-1001' } }];
  it('`seguro` estricto: «= =1» y «+ - @ cmd» ya no llegan a la hoja con un signo de fórmula delante (el oráculo sí los dejaba)', () => {
    const p = { telefono: TEL, nombre: '= =1', empresa: '+ - @ cmd', rubro: 'Ropa' };
    const r = nuevo([p], [], ids);
    const antes = r.oraculo[0].json; const ahora = r.nodo[0].json;
    expect(antes['Nombre y Apellido']).toBe("'=1"); // el oráculo conservaba un «=» delante (neutralizado con apóstrofo): lo que se corrige
    expect(String(ahora['Nombre y Apellido'])).not.toMatch(/^'?[=+\-@]/);
    expect(String(ahora['Empresa / Cliente'])).not.toMatch(/^'?[=+\-@]/);
    expect(ahora['Nombre y Apellido']).toBe("'1"); // queda «1» como texto (apóstrofo de la hoja), sin el «=»
    expect(String(ahora['Empresa / Cliente']).replace(/^'/, '')).toBe('cmd');
  });
  it('dos filas del mismo teléfono: se actualiza la MÁS RECIENTE (el oráculo tomaba la primera leída), en cualquier orden de lectura', () => {
    const p = { telefono: TEL, nombre: 'Ana Nueva', empresa: 'Taller', rubro: 'Ropa' };
    const vieja = fila(4, TEL, { 'Nombre y Apellido': 'Ana Vieja' });
    const reciente = fila(30, TEL, { 'Nombre y Apellido': 'Ana Reciente' });
    const a = nuevo([p], [vieja, reciente], ids);
    expect(a.oraculo[0].json.row_number).toBe(6);
    expect(a.nodo[0].json.row_number).toBe(32);
    const b = nuevo([p], [reciente, vieja], ids);
    expect(b.oraculo[0].json.row_number).toBe(32); // con el orden invertido la primera leída ya era la reciente: por eso el flujo pide TODAS las coincidencias
    expect(b.nodo[0].json.row_number).toBe(32);
  });
  it('un solo registro por teléfono: la misma salida que antes', () => {
    const p = { telefono: TEL, nombre: 'Ana', empresa: 'Taller', rubro: 'Ropa', hechos: { pidioPlanes: true } };
    const r = nuevo([p], [fila(9, TEL, { 'Calificación IA': 'Baja' })], ids);
    expect(r.nodo).toEqual(r.oraculo);
    expect(r.nodo[0].json.accionPlanilla).toBe('actualizar');
  });
});

describe('el flujo versionado incluye el módulo (sin copias)', () => {
  for (const salida of ['captacion-minima.novuchat.json', 'captacion-minima.prueba.json']) {
    it(`${salida}: el código del módulo y el mapa del tenant están en los nodos, y la búsqueda trae todas las coincidencias`, () => {
      const flujo = JSON.parse(readFileSync(join(RAIZ, 'Flujos', 'experimental', 'captacion-minima', salida), 'utf8')) as { nodes: Array<{ name: string; parameters: J }> };
      const js = (n: string) => String(flujo.nodes.find((x) => x.name === n)!.parameters['jsCode']);
      expect(js('Decidir fila de la planilla')).toContain(NODO_DECIDIR.trimEnd());
      expect(js('Decidir fila de la planilla')).toContain(ADAPTADOR.trimEnd());
      expect(js('Decidir fila de la planilla')).toContain(`const CRM_MAPA = ${JSON.stringify(MAPA)};`);
      expect(js('Prospecto para la planilla')).toContain(leer('crm/nodo-prospecto.js').trimEnd());
      const buscar = flujo.nodes.find((x) => x.name === 'Buscar teléfono en planilla')!.parameters as { options: J };
      expect(buscar.options['returnFirstMatch']).toBe(false);
    });
  }
});
