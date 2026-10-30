/**
 * miniCRM, módulo de flujo (PR-B, pasos 2 y 3): `Flujos/src/modulos/crm/`.
 *
 *   · «misma salida que hoy»: `crmDecidirFila` con el mapa de NovuChat da lo MISMO que el decidir-fila vivo, congelado como oráculo
 *     (`oraculo/decidir-fila-antes.js`, copia exacta; nunca entra a un flujo): 40 casos de tabla y 300 con semilla fija.
 *   · lo que cambia a propósito se NIEGA: encabezado movido, mapa sin columnas del equipo o con una del equipo dentro del rango leído.
 *   · LOW 1 (listas de la consola) y LOW 2 (mapa y encabezados letra por letra).
 *   · `activo: false`: ni se escribe ni se consulta Google.
 *   · paridad de `neutralizarTexto` (TypeScript) con `crmNeutralizarTexto` (el que corre en n8n).
 * Mensajes por conversación: 0 (ninguna de estas piezas envía).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext, Script } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMPOS_DEL_BOT, CAMPOS_DEL_EQUIPO, neutralizarTexto } from '../../../functions/src/modulos/crm/columnas.js';
import { GLOBALES_FUERA_DEL_SANDBOX } from '../../lib/flujo.ts';
// @ts-expect-error módulo .mjs sin tipos
import { injertarCrm, inyectarMapa, MARCA_MAPA, paquetesCrm, validarMapaCrm } from '../../../../Flujos/experimental/comun-sin-agente/construir-crm.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FLUJOS = join(AQUI, '..', '..', '..', '..', 'Flujos', 'src', 'modulos');
const leer = (r: string) => readFileSync(join(FLUJOS, r), 'utf8');
const ORACULO = readFileSync(join(AQUI, 'oraculo', 'decidir-fila-antes.js'), 'utf8');

type J = Record<string, unknown>;
type Item = { json: J; error?: unknown };

/** El mapa de NovuChat: lo que el código vivo espera de su hoja (D2 del plan). */
const MAPA = {
  filaEncabezados: 3, prefijoId: 'LEAD-', primerId: 1001,
  columnas: {
    id: { letra: 'A', titulo: 'ID Lead' }, fecha: { letra: 'B', titulo: 'Fecha Registro' }, nombre: { letra: 'C', titulo: 'Nombre y Apellido' },
    empresa: { letra: 'D', titulo: 'Empresa / Cliente' }, telefono: { letra: 'E', titulo: 'Teléfono WhatsApp' }, interes: { letra: 'F', titulo: 'Rubro' },
    etapaInicial: { letra: 'G', titulo: 'Etapa Funnel' }, origen: { letra: 'H', titulo: 'Origen / Canal' },
    calificacion: { letra: 'I', titulo: 'Calificación IA' }, resumen: { letra: 'J', titulo: 'Resumen Chatbot IA' },
  },
  equipo: { valor: null, responsable: { letra: 'N', titulo: 'Responsable' }, estado: { letra: 'M', titulo: 'Estado Comercial' }, proximaAccion: { letra: 'K', titulo: 'Próxima acción' } },
  extrasDelEquipo: { L: 'Notas del equipo' },
  alCrear: { etapaInicial: '1. Nuevo Lead', origen: 'Chatbot WhatsApp IA', origenAnuncio: 'Campaña Meta Ads', estado: 'Activo' },
};
const clonar = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const TITULOS = ['ID Lead', 'Fecha Registro', 'Nombre y Apellido', 'Empresa / Cliente', 'Teléfono WhatsApp', 'Rubro', 'Etapa Funnel', 'Origen / Canal', 'Calificación IA', 'Resumen Chatbot IA'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function correr(codigo: string, entrada: Item[], nodos: Record<string, Item[]> = {}, registro?: string[]): any {
  const $ = (n: string) => {
    registro?.push(n);
    if (!(n in nodos)) throw new Error(`nodo sin ejecutar: ${n}`);
    return { all: () => nodos[n], first: () => nodos[n][0] };
  };
  const $input = { all: () => entrada, first: () => entrada[0] };
  const vacios = GLOBALES_FUERA_DEL_SANDBOX;
  const nodo = runInNewContext(`(function ($input, $, ${vacios.join(', ')}) {\n${codigo}\n})`, {});
  return nodo(entrada.length ? $input : $input, $, ...vacios.map(() => undefined));
}

const CRM = leer('crm/crm.js');
const ADAPTADOR = leer('captacion/crm-captacion.js');
const NODO_DECIDIR = leer('crm/nodo-decidir-fila.js');
const NODO_PROSPECTO = leer('crm/nodo-prospecto.js');
const conMapa = (c: string, m: unknown = MAPA) => inyectarMapa(c, m);
const FUNCIONES = 'return { crmNeutralizarTexto, crmElemento, crmSanearConfig, crmActivo, crmValidarMapa, crmFilaMasReciente, crmDecidirFila, capCalificar, capResumir, CAP_PRIORIDAD, CRM_CAMPOS_BOT, CRM_CAMPOS_EQUIPO };';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M: any = runInNewContext(`(function () {\n${conMapa(CRM)}\n${ADAPTADOR}\n${FUNCIONES}\n})()`, {});
const adaptador = { calificar: M.capCalificar, resumir: M.capResumir, prioridad: M.CAP_PRIORIDAD };

const AHORA = Date.UTC(2026, 9, 30, 15, 0, 0);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(AHORA); });
afterEach(() => { vi.useRealTimers(); });

function nuevo(prospectos: J[], busqueda: Item[], ids: Item[]) {
  const pros = prospectos.map((json) => ({ json }));
  return {
    oraculo: correr(ORACULO, ids, { 'Prospecto para la planilla': pros, 'Buscar teléfono en planilla': busqueda }),
    modulo: M.crmDecidirFila({ prospectos: pros, busqueda, lecturaIds: ids, mapa: clonar(MAPA), adaptador, ahoraMs: Date.now() }),
    nodo: correr([conMapa(CRM), ADAPTADOR, NODO_DECIDIR].join('\n'), ids, { 'Prospecto para la planilla': pros, 'Buscar teléfono en planilla': busqueda }),
  };
}
const fila = (n: number, tel: string, extra: J = {}): Item => ({ json: Object.fromEntries([['row_number', n], ...TITULOS.map((t) => [t, '']), ...Object.entries({ 'Teléfono WhatsApp': tel, ...extra })].reduce((a, [k, v]) => { const i = a.findIndex(([kk]) => kk === k); if (i >= 0) a[i] = [k, v]; else a.push([k, v]); return a; }, [] as [string, unknown][])) });
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
    expect(r.modulo).toEqual(r.oraculo);
    expect(r.nodo).toEqual(r.oraculo);
  });
});

describe('misma salida que hoy: 300 casos con semilla fija', () => {
  function azar(semilla: number) { let a = semilla; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; }; }
  const R = azar(20261030);
  const elige = <T,>(l: T[]): T => l[Math.floor(R() * l.length)];
  const textos = ['', 'Ana', 'Ana Pérez', '=1+1', ' +591', '@ana', '- -x', '​=A1', 'a­=b', 'Tienda  de   ropa', '= =1', 'x'.repeat(200), 'Taller\nSol'];
  const rubros = ['', 'Panadería', 'Ropa', '=SUMA(1)', 'Salud y belleza'];
  const hechos = [undefined, { pidioPlanes: true }, { pidioAsesor: true }, { respondioDolor: true }, { descarte: 'sin_negocio' }, { descarte: 'raro' }, { temas: ['costos', 'x'], respondioDolor: true }];
  const calis = ['', 'Baja', 'Media', 'Descalificado', 'Alta', 'otra'];
  const fallo = { name: 'NodeApiError', httpCode: '403', message: 'The caller does not have permission PERMISSION_DENIED' };
  for (let i = 0; i < 300; i++) {
    it(`caso ${i}`, () => {
      const tel = elige([TEL, OTRO]);
      const p: J = { telefono: elige([tel, tel, tel, '']), nombre: elige(textos), empresa: elige(textos), rubro: elige(rubros), necesidad: elige(textos), anuncio: R() < 0.2,
        estado: elige(['', 'cerrado', 'en_conversacion', 'operador', 'bloqueado']), nuevoContacto: R() < 0.15, consulta: elige(['', 'precios']), flujos: elige(['', 'agenda']),
        otrosNegocios: R() < 0.2 ? [{ empresa: 'Otra', rubro: 'Ropa' }, { empresa: '', rubro: '' }] : undefined };
      const h = elige(hechos); if (h) p.hechos = h;
      const n = Math.floor(R() * 4);
      const filas = Array.from({ length: n }, (_, k) => fila(2 + Math.floor(R() * 50) + k * 60, elige([tel, tel, OTRO, '+' + tel]), {
        'Calificación IA': elige(calis), 'Nombre y Apellido': elige(textos), 'Empresa / Cliente': elige(textos), Rubro: elige(rubros), 'Resumen Chatbot IA': elige(textos) }));
      filas.sort(() => R() - 0.5);
      let ids: Item[] = Array.from({ length: Math.floor(R() * 4) }, (_, k) => ({ json: { row_number: 2 + k, 'ID Lead': elige(['LEAD-1005', 'LEAD-1099', 'x', '', 'lead-1100']) } }));
      let bus: Item[] = filas;
      const tipo = R();
      if (tipo < 0.07) bus = [{ json: { error: fallo }, error: fallo }];
      else if (tipo < 0.12) ids = [{ json: { error: fallo } }];
      else if (tipo < 0.17 && bus.length) { const f = clonar(bus[0].json); delete f[elige(TITULOS)]; bus = [{ json: f }, ...bus.slice(1)]; }
      else if (tipo < 0.21) ids = [{ json: { row_number: 2, 'Otro título': 'LEAD-1' } }];
      const r = nuevo([p], bus, ids);
      expect(r.modulo).toEqual(r.oraculo);
      expect(r.nodo).toEqual(r.oraculo);
    });
  }
});

describe('lo que se NIEGA: filas, encabezados y mapa', () => {
  const p = { telefono: TEL, nombre: 'Ana Nueva', empresa: 'Taller', rubro: 'Ropa' };
  it('dos filas del mismo teléfono: se actualiza la MÁS RECIENTE (mayor row_number), en cualquier orden de lectura', () => {
    const vieja = fila(4, TEL, { 'Nombre y Apellido': 'Ana Vieja' });
    const reciente = fila(30, TEL, { 'Nombre y Apellido': 'Ana Reciente' });
    for (const orden of [[vieja, reciente], [reciente, vieja]]) {
      const [s] = M.crmDecidirFila({ prospectos: [{ json: p }], busqueda: orden, lecturaIds: [{ json: { row_number: 2, 'ID Lead': 'LEAD-1001' } }], mapa: MAPA, adaptador, ahoraMs: AHORA });
      expect(s.json.accionPlanilla).toBe('actualizar');
      expect(s.json.row_number).toBe(32);
    }
    expect(M.crmFilaMasReciente([{ row_number: '4' }, { row_number: 30 }, { row_number: 12 }]).row_number).toBe(30);
    expect(M.crmFilaMasReciente([])).toBeUndefined();
  });
  it('encabezado movido («Rubro» en la letra G): salida «nada», no se escribe', () => {
    const f = fila(5, TEL).json;
    const movida = { row_number: 5, ...Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'row_number' && k !== 'Rubro' && k !== 'Etapa Funnel').concat([['Etapa Funnel', ''], ['Rubro', '']]).slice(0)) };
    expect(Object.keys(movida).indexOf('Rubro')).toBeGreaterThan(Object.keys(movida).indexOf('Etapa Funnel'));
    const [s] = M.crmDecidirFila({ prospectos: [{ json: p }], busqueda: [{ json: movida }], lecturaIds: [{ json: { row_number: 2, 'ID Lead': 'LEAD-1001' } }], mapa: MAPA, adaptador, ahoraMs: AHORA });
    expect(s.json.accionPlanilla).toBe('nada');
    expect(s.json.veredictoPlanilla).toBe('encabezados_distintos: la fila 3 no tiene «Rubro»');
  });
  it('una columna de más en la lectura de IDs o en la fila también es encabezado distinto', () => {
    const conSobra = { json: { ...fila(5, TEL).json, 'Notas del equipo': 'x' } };
    const [s] = M.crmDecidirFila({ prospectos: [{ json: p }], busqueda: [conSobra], lecturaIds: [], mapa: MAPA, adaptador, ahoraMs: AHORA });
    expect(s.json.accionPlanilla).toBe('nada');
    expect(s.json.veredictoPlanilla).toBe('encabezados_distintos: columnas de más en la fila 3');
    const [t] = M.crmDecidirFila({ prospectos: [{ json: p }], busqueda: [], lecturaIds: [{ json: { row_number: 2, 'ID Lead': 'LEAD-1', 'Fecha Registro': 'x' } }], mapa: MAPA, adaptador, ahoraMs: AHORA });
    expect(t.json.accionPlanilla).toBe('nada');
    expect(t.json.veredictoPlanilla).toBe('encabezados_distintos: columnas de más en la fila 3');
  });
  it('las columnas del equipo no se escriben: al actualizar solo salen las 5 del bot; al crear, solo el estado inicial', () => {
    const [a] = M.crmDecidirFila({ prospectos: [{ json: { ...p, hechos: { pidioAsesor: true } } }], busqueda: [fila(5, TEL)], lecturaIds: [], mapa: MAPA, adaptador, ahoraMs: AHORA });
    expect(Object.keys(a.json).filter((k) => !['accionPlanilla', 'veredictoPlanilla', 'row_number'].includes(k)).every((k) => ['Nombre y Apellido', 'Empresa / Cliente', 'Rubro', 'Calificación IA', 'Resumen Chatbot IA'].includes(k))).toBe(true);
    const [c] = M.crmDecidirFila({ prospectos: [{ json: p }], busqueda: [], lecturaIds: [], mapa: MAPA, adaptador, ahoraMs: AHORA });
    expect(c.json['Estado Comercial']).toBe('Activo');
    for (const t of ['Próxima acción', 'Notas del equipo', 'Responsable']) expect(c.json).not.toHaveProperty(t);
    const sinEstado = clonar(MAPA); delete (sinEstado.alCrear as J).estado;
    const [d] = M.crmDecidirFila({ prospectos: [{ json: p }], busqueda: [], lecturaIds: [], mapa: sinEstado, adaptador, ahoraMs: AHORA });
    expect(d.json).not.toHaveProperty('Estado Comercial');
  });
  it('el mapa de NovuChat es válido; sin equipo.valor, o con una columna del equipo dentro del rango leído, falla (y el injerto también)', () => {
    expect(validarMapaCrm(MAPA)).toEqual([]);
    const sinValor = clonar(MAPA) as J; delete (sinValor.equipo as J).valor;
    expect(validarMapaCrm(sinValor).join()).toMatch(/equipo\.valor/);
    const kDentro = clonar(MAPA); kDentro.equipo.proximaAccion = { letra: 'F', titulo: 'Próxima acción' };
    expect(validarMapaCrm(kDentro).length).toBeGreaterThan(0);
    const kDentro2 = clonar(MAPA); kDentro2.extrasDelEquipo = { E: 'Notas' } as never;
    expect(validarMapaCrm(kDentro2).length).toBeGreaterThan(0);
    const flujo = { nodes: [{ name: 'X', parameters: { jsCode: conMapa(CRM, MAPA).replace(/const CRM_MAPA = .*;/, MARCA_MAPA) } }] };
    expect(() => injertarCrm(flujo, sinValor)).toThrow(/no es valido/);
  });
  it('un mapa inválido que llegue al nodo no escribe nada (mapa_invalido)', () => {
    const malo = clonar(MAPA); delete (malo.equipo as J).responsable;
    const [s] = M.crmDecidirFila({ prospectos: [{ json: p }], busqueda: [], lecturaIds: [], mapa: malo, adaptador, ahoraMs: AHORA });
    expect(s.json).toEqual({ accionPlanilla: 'nada', veredictoPlanilla: 'mapa_invalido' });
  });
  const invalido = (cambia: (m: ReturnType<typeof clonar<typeof MAPA>>) => void) => { const m = clonar(MAPA); cambia(m); return validarMapaCrm(m); };
  it.each([
    ['letra repetida', (m: typeof MAPA) => { m.columnas.fecha.letra = 'A'; }],
    ['título repetido', (m: typeof MAPA) => { m.columnas.fecha.titulo = 'ID Lead'; }],
    ['título que empieza por =', (m: typeof MAPA) => { m.columnas.fecha.titulo = '=Fecha'; }],
    ['título de 61 caracteres', (m: typeof MAPA) => { m.columnas.fecha.titulo = 'x'.repeat(61); }],
    ['hueco en el rango leído', (m: typeof MAPA) => { m.columnas.resumen.letra = 'L'; m.extrasDelEquipo = {} as never; }],
    ['falta telefono', (m: typeof MAPA) => { delete (m.columnas as J).telefono; }],
    ['campo del bot desconocido', (m: typeof MAPA) => { (m.columnas as J).raro = { letra: 'K', titulo: 'Raro' }; }],
    ['prefijoId que empieza con «-»', (m: typeof MAPA) => { m.prefijoId = '-LEAD'; }],
    ['filaEncabezados 0', (m: typeof MAPA) => { m.filaEncabezados = 0; }],
    ['filaEncabezados 21', (m: typeof MAPA) => { m.filaEncabezados = 21; }],
    ['alCrear sin origen', (m: typeof MAPA) => { delete (m.alCrear as J).origen; }],
    ['alCrear.estado con fórmula', (m: typeof MAPA) => { m.alCrear.estado = '=Activo'; }],
    ['alCrear.estado sin columna de estado', (m: typeof MAPA) => { (m.equipo as J).estado = null; }],
  ])('mapa inválido: %s', (_n, cambia) => {
    expect(invalido(cambia as never).length).toBeGreaterThan(0);
  });
});

describe('LOW 1: la configuración de la consola (config/crm) se sanea', () => {
  it('un elemento de 41 caracteres, un número o un objeto se descartan; uno de 40 pasa', () => {
    expect(M.crmElemento('x'.repeat(41))).toBeNull();
    expect(M.crmElemento('x'.repeat(40))).toBe('x'.repeat(40));
    expect(M.crmElemento(5)).toBeNull();
    expect(M.crmElemento({ a: 1 })).toBeNull();
    expect(M.crmElemento(null)).toBeNull();
    expect(M.crmElemento('   ')).toBeNull();
    expect(M.crmElemento('  Nuevo  ')).toBe('Nuevo');
  });
  it("'=1+1' queda «'=1+1»; invisibles y espacios delante no esconden la fórmula", () => {
    expect(M.crmElemento('=1+1')).toBe("'=1+1");
    expect(M.crmElemento('​=A1')).toBe("'=A1");
    expect(M.crmElemento(' @x')).toBe("'@x");
  });
  it('la lista se corta en 20, solo entran etapas y orígenes, y la moneda de 1 a 5 caracteres', () => {
    const s = M.crmSanearConfig({ activo: true, moneda: 'USD', listas: { etapas: Array.from({ length: 30 }, (_, i) => `E${i}`).concat([7 as never]), origenes: ['a', 9, 'b'], otra: ['x'] } });
    expect(s.listas.etapas).toHaveLength(20);
    expect(s.listas.origenes).toEqual(['a', 'b']);
    expect(s.listas).not.toHaveProperty('otra');
    expect(s.moneda).toBe('USD');
    expect(M.crmSanearConfig({ moneda: 'DEMASIADO' }).moneda).toBe('');
    expect(M.crmSanearConfig(null)).toEqual({ activo: true, moneda: '', listas: {} });
    expect(M.crmSanearConfig({ listas: 'x' }).listas).toEqual({});
  });
  it('solo activo === false apaga; ausente, ilegible o «no» enciende', () => {
    for (const c of [null, undefined, {}, { activo: 'no' }, { activo: 0 }, { activo: true }, 'x', []]) expect(M.crmActivo(c)).toBe(true);
    expect(M.crmActivo({ activo: false })).toBe(false);
    expect(M.crmSanearConfig({ activo: false }).activo).toBe(false);
    expect(M.crmSanearConfig({ activo: 'false' }).activo).toBe(true);
  });
});

describe('activo:false: no se escribe y Google ni se consulta', () => {
  const guardar = { json: { guardarPlanilla: true, prospectoPlanilla: { telefono: TEL, nombre: 'Ana' } } };
  const cuerpo = (crm: unknown, cuerpoComoTexto = false) => ({ 'Traer configuración': [{ json: { statusCode: 200, body: cuerpoComoTexto ? JSON.stringify({ crm }) : { crm } } }] });
  it('con crm.activo false devuelve [] y lo único que toca es «Traer configuración»', () => {
    for (const texto of [false, true]) {
      const llamadas: string[] = [];
      const r = correr([conMapa(CRM), NODO_PROSPECTO].join('\n'), [guardar], cuerpo({ activo: false }, texto), llamadas);
      expect(r).toEqual([]);
      expect(new Set(llamadas)).toEqual(new Set(['Traer configuración']));
      expect(llamadas.join('|')).not.toMatch(/planilla|Google|Buscar|Leer|Agregar|Actualizar/i);
    }
  });
  it('activo ausente, ilegible o sin configuración legible: deja pasar al prospecto', () => {
    for (const nodos of [cuerpo({}), cuerpo({ activo: 'no' }), cuerpo(null), {}, { 'Traer configuración': [{ json: { body: '{no es json' } }] }]) {
      const r = correr([conMapa(CRM), NODO_PROSPECTO].join('\n'), [guardar, { json: { guardarPlanilla: false, prospectoPlanilla: { telefono: TEL } } }], nodos);
      expect(r).toHaveLength(1);
      expect(r[0].json.telefono).toBe(TEL);
    }
  });
  it('sin prospecto que guardar no hay salida aunque esté encendido', () => {
    expect(correr([conMapa(CRM), NODO_PROSPECTO].join('\n'), [{ json: { guardarPlanilla: false } }], cuerpo({}))).toEqual([]);
  });
});

describe('paridad TypeScript / JavaScript de neutralizar y del contrato', () => {
  const tabla = ['', 'Ana', '=SUMA(A1)', '+591', '-1', '@usuario', '  =1+1', '\t=cmd', '\n=1', '\r\n=1', ' =1', '﻿=1', '​=1', '​ @x', 'a=b', "'=1", 'x'.repeat(900),
    '\u0000=1', '\u007F+1', '⁠@x', 'Ñandú', '🙂 hola', '- ', '  ', 42, null, undefined, { a: 1 }, ['=1']];
  it.each(tabla.map((t) => [JSON.stringify(t) ?? 'undefined', t]))('misma salida para %s', (_n, t) => {
    expect(M.crmNeutralizarTexto(t)).toBe(neutralizarTexto(t));
    expect(M.crmNeutralizarTexto(t, 10)).toBe(neutralizarTexto(t, 10));
  });
  it('los campos del bot y del equipo son los mismos que el contrato de Functions', () => {
    expect([...M.CRM_CAMPOS_BOT].sort()).toEqual([...CAMPOS_DEL_BOT].sort());
    expect([...M.CRM_CAMPOS_EQUIPO]).toEqual([...CAMPOS_DEL_EQUIPO]);
  });
});

describe('el código que corre en n8n', () => {
  const paq = paquetesCrm(join(FLUJOS, 'captacion', 'crm-captacion.js')) as Record<string, string[]>;
  const textos = Object.values(paq).flat().join('\n');
  it('se arma de los archivos del módulo, sin copias: crm.js primero, el adaptador de captación en el decidir', () => {
    expect(paq['crm-prospecto']).toEqual([CRM.trimEnd(), NODO_PROSPECTO.trimEnd()]);
    expect(paq['crm-decidir']).toEqual([CRM.trimEnd(), ADAPTADOR.trimEnd(), NODO_DECIDIR.trimEnd()]);
  });
  it('compila como cuerpo de un nodo Code y no usa globales fuera del sandbox', () => {
    for (const [k, partes] of Object.entries(paq)) {
      expect(() => new Script(`(function ($input, $) {\n${conMapa(partes.join('\n'))}\n})`), k).not.toThrow();
      for (const g of GLOBALES_FUERA_DEL_SANDBOX) expect(new RegExp(`(^|[^\\w$.'"«])${g.replace(/[$]/g, '\\$')}\\b(?!['"»])`).test(partes.join('\n').replace(/\/\/.*$/gm, '')), `${k} usa «${g}»`).toBe(false);
    }
    expect(textos).not.toMatch(/\brequire\(|\bnew URL\(|\bBuffer\.|\bcrypto\./);
  });
  it('el módulo común no nombra clientes (el vocabulario de captación vive solo en el adaptador)', () => {
    const comun = `${CRM}\n${NODO_PROSPECTO}\n${NODO_DECIDIR}\n${readFileSync(join(AQUI, '..', '..', '..', '..', 'Flujos', 'experimental', 'comun-sin-agente', 'construir-crm.mjs'), 'utf8')}`;
    expect(comun).not.toMatch(/novuchat|q'?taco|bellido|ruben|rubén|antonio|walisuma|\bevy\b|\bemma\b/i);
    expect(comun).not.toMatch(/Chatbot WhatsApp|Campaña Meta|Nuevo Lead|Leads_CRM|Descalificado|Rubro/);
  });
  it('el mapa se inyecta exactamente una vez; sin la marca o con dos, lanza', () => {
    expect(conMapa(CRM)).toContain('"prefijoId":"LEAD-"');
    expect(conMapa(CRM)).not.toContain('@@crm-mapa');
    expect(() => inyectarMapa('const x = 1;', MAPA)).toThrow(/exactamente una vez/);
    expect(() => inyectarMapa(`${MARCA_MAPA}\n${MARCA_MAPA}`, MAPA)).toThrow(/exactamente una vez/);
  });
  it('el injerto fija rangos, encabezados, columna del teléfono y todas las coincidencias en los 4 nodos de Google', () => {
    const google = (name: string, options: J, extra: J = {}) => ({ name, type: 'n8n-nodes-base.googleSheets', parameters: { options, ...extra } });
    const flujo = {
      nodes: [
        { name: 'Prospecto para la planilla', parameters: { jsCode: paq['crm-prospecto'].join('\n') } },
        { name: 'Decidir fila de la planilla', parameters: { jsCode: paq['crm-decidir'].join('\n') } },
        google('Buscar teléfono en planilla', { dataLocationOnSheet: { values: { range: 'A1:B' } }, returnFirstMatch: true }, { filtersUI: { values: [{ lookupColumn: 'x', lookupValue: 'a' }, { lookupColumn: 'x', lookupValue: 'b' }] } }),
        google('Leer IDs de la planilla', { dataLocationOnSheet: { values: { range: 'A1:A' } } }),
        google('Agregar fila', { locationDefine: { values: { headerRow: 1 } } }),
        google('Actualizar fila', { locationDefine: { values: { headerRow: 1, firstDataRow: 2 } } }),
      ],
    };
    const r = injertarCrm(flujo, MAPA) as typeof flujo;
    const nodo = (n: string) => r.nodes.find((x) => x.name === n)!.parameters as J;
    const b = nodo('Buscar teléfono en planilla') as { options: { dataLocationOnSheet: { values: { range: string } }; returnFirstMatch: boolean }; filtersUI: { values: Array<{ lookupColumn: string }> } };
    expect(b.options.dataLocationOnSheet.values.range).toBe('A3:J');
    expect(b.options.returnFirstMatch).toBe(false);
    expect(b.filtersUI.values.map((v) => v.lookupColumn)).toEqual(['Teléfono WhatsApp', 'Teléfono WhatsApp']);
    expect((nodo('Leer IDs de la planilla') as { options: { dataLocationOnSheet: { values: { range: string } } } }).options.dataLocationOnSheet.values.range).toBe('A3:A');
    expect((nodo('Agregar fila') as { options: { locationDefine: { values: J } } }).options.locationDefine.values).toEqual({ headerRow: 3 });
    expect((nodo('Actualizar fila') as { options: { locationDefine: { values: J } } }).options.locationDefine.values).toEqual({ headerRow: 3, firstDataRow: 4 });
    for (const n of r.nodes.slice(0, 2)) expect(((n.parameters as J).jsCode as string)).not.toContain('@@crm-mapa');
    expect(() => injertarCrm({ nodes: [] }, MAPA)).toThrow();
  });
});
