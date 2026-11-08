/**
 * miniCRM: UNA FILA POR CONVERSACION (Andres, 08/11/2026; reemplaza la regla de 48 h).
 * La conversación es la del cobro: ventana FIJA de 24 h desde el primer mensaje de consulta del cliente
 * (ancla = `atencion.ventanaVenceEn` - 24 h, lo que devuelve «Reportar mensaje (entrante)»). Así el CRM se valida contra la consola.
 * Mensajes por conversación: 0 (escribir en la hoja no envía WhatsApp). Ningún literal de teléfono: se construyen en tiempo de ejecución.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import { inyectarMapa } from '../../../../Flujos/experimental/comun-sin-agente/construir-crm.mjs';

type J = Record<string, unknown>;
const FLUJOS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'Flujos', 'src', 'modulos');
const leer = (r: string) => readFileSync(join(FLUJOS, r), 'utf8');
const clonar = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

const T = {
  id: 'ID Lead', fecha: 'Fecha Registro', nombre: 'Nombre y Apellido', empresa: 'Empresa / Cliente', telefono: 'Teléfono WhatsApp', etapa: 'Etapa Funnel',
  origen: 'Origen / Canal', calif: 'Calificación IA', resumen: 'Resumen Chatbot IA', clasif: 'Clasificación', ultima: 'Última interacción', ventana: 'Se cierra la ventana de 24 h',
};
const MAPA = {
  filaEncabezados: 3, prefijoId: 'LEAD-', primerId: 1001,
  columnas: {
    id: { letra: 'A', titulo: T.id }, fecha: { letra: 'B', titulo: T.fecha }, nombre: { letra: 'C', titulo: T.nombre }, empresa: { letra: 'D', titulo: T.empresa },
    telefono: { letra: 'E', titulo: T.telefono }, etapaInicial: { letra: 'F', titulo: T.etapa }, origen: { letra: 'G', titulo: T.origen }, calificacion: { letra: 'H', titulo: T.calif },
    resumen: { letra: 'I', titulo: T.resumen }, clasificacion: { letra: 'J', titulo: T.clasif }, ultimaInteraccion: { letra: 'K', titulo: T.ultima }, ventana24h: { letra: 'L', titulo: T.ventana },
    agendo: { letra: 'M', titulo: 'Agendó' }, fechaCita: { letra: 'N', titulo: 'Fecha y hora de la cita' },
  },
  equipo: { valor: null, responsable: null, estado: null, proximaAccion: null },
  extrasDelEquipo: {},
  alCrear: { etapaInicial: '1. Nuevo Lead', origen: 'Chatbot WhatsApp IA', origenAnuncio: 'Campaña Meta Ads' },
};
const TITULOS = Object.values(MAPA.columnas).map((c) => c.titulo);
const FUNCIONES = 'return { crmDecidirFila, capCalificar, capResumir, CAP_PRIORIDAD };';
const conMapa = (m: unknown) => `${inyectarMapa(leer('crm/crm.js'), m)}\n${leer('captacion/crm-captacion.js')}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M: any = compileFunction(`${conMapa(MAPA)}\n${FUNCIONES}`, [])();

const H = 3600_000;
const ANCLA = Date.UTC(2026, 10, 8, 12, 0, 0);
const TEL = ['59', '17', '000', '020'].join('');
const lp = (ms: number) => new Date(ms - 4 * H).toISOString().slice(0, 16).replace('T', ' ');
const fila = (n: number, extra: J = {}): { json: J } => ({ json: { row_number: n, ...Object.fromEntries(TITULOS.map((t) => [t, ''])), [T.telefono]: TEL, ...extra } });
const previa = (ultimaMs: number, n = 8) => [fila(n, { [T.ultima]: lp(ultimaMs) })];
function decidir(p: J, busqueda: Array<{ json: J }> = [], mapa: unknown = MAPA, modulo = M): J {
  return modulo.crmDecidirFila({ prospectos: [{ json: p }], busqueda, lecturaIds: [{ json: { row_number: 4, [T.id]: 'LEAD-1010' } }], mapa: clonar(mapa),
    adaptador: { calificar: M.capCalificar, resumir: M.capResumir, prioridad: M.CAP_PRIORIDAD }, ahoraMs: ANCLA })[0].json as J;
}
const p = (o: J = {}): J => ({ telefono: TEL, nombre: 'Ana', conversacionDesdeMs: ANCLA, ultimaInteraccionMs: ANCLA + H, ...o });

describe('una fila por conversación: la ventana fija de 24 h', () => {
  it('NIEGA: un segundo mensaje dentro de la ventana no crea fila (actualiza la más reciente)', () => {
    const r = decidir(p({ ultimaInteraccionMs: ANCLA + 2 * H, quePidio: 'precio' }), previa(ANCLA + H));
    expect(r['accionPlanilla']).toBe('actualizar');
    expect(r['row_number']).toBe(8 + 2);
  });
  it('NIEGA: a las 23 h 59 del ancla no crea fila', () => {
    const t = ANCLA + 24 * H - 60_000;
    expect(decidir(p({ ultimaInteraccionMs: t }), previa(t - 3 * H))['accionPlanilla']).toBe('actualizar');
    expect(decidir(p({ ultimaInteraccionMs: t }), previa(ANCLA))['accionPlanilla']).toBe('actualizar');
  });
  it('a las 24 h exactas la conversación es otra: SÍ crea fila, y su ventana cierra 24 h después del ancla nueva', () => {
    const nueva = ANCLA + 24 * H;
    const r = decidir(p({ conversacionDesdeMs: nueva, ultimaInteraccionMs: nueva }), previa(ANCLA + 23 * H));
    expect(r['accionPlanilla']).toBe('agregar');
    expect(r[T.ventana]).toBe("'" + lp(nueva + 24 * H));
  });
  it('se compara al minuto: la fila escrita en el mismo minuto del ancla es de esa conversación', () => {
    expect(decidir(p({ conversacionDesdeMs: ANCLA + 45_000 }), previa(ANCLA))['accionPlanilla']).toBe('actualizar');
  });
  it('NIEGA: una cortesía con la ventana vencida (el ancla sigue siendo la de la conversación vencida) no crea fila', () => {
    const vencida = ANCLA - 30 * H;
    expect(decidir(p({ conversacionDesdeMs: vencida, ultimaInteraccionMs: ANCLA }), previa(vencida + H))['accionPlanilla']).toBe('actualizar');
  });
  it('NIEGA: con la ingesta caída (sin ancla) se actualiza la más reciente y no se crea', () => {
    for (const sin of [null, undefined, 'x', Number.NaN]) {
      expect(decidir(p({ conversacionDesdeMs: sin }), previa(ANCLA - 90 * H))['accionPlanilla'], String(sin)).toBe('actualizar');
    }
    expect(decidir(p({ conversacionDesdeMs: null }), [])['accionPlanilla']).toBe('agregar'); // sin ninguna fila del teléfono no hay a quién actualizar
  });
  it('NIEGA: `nuevoContacto` (la regla de 48 h) se ignora, con la ventana vigente y sin ancla', () => {
    expect(decidir(p({ nuevoContacto: true }), previa(ANCLA + H))['accionPlanilla']).toBe('actualizar');
    expect(decidir(p({ nuevoContacto: true, conversacionDesdeMs: null }), previa(ANCLA - 100 * H))['accionPlanilla']).toBe('actualizar');
  });
  it('NIEGA: un prospecto sin ancla ni fila ilegible tampoco crea (fila sin «Última interacción» con ancla = otra conversación, no se pisa)', () => {
    const vieja = [fila(8, { [T.ultima]: 'ayer' })];
    expect(decidir(p(), vieja)['accionPlanilla']).toBe('agregar');
    expect(decidir(p({ conversacionDesdeMs: null }), vieja)['accionPlanilla']).toBe('actualizar');
  });
  it('NIEGA: cancelar al día siguiente toca SOLO la fila más reciente y no crea otra', () => {
    const r = decidir(p({ conversacionDesdeMs: ANCLA + 30 * H, agendo: 'No', citaCancelada: true, citasRestantes: 0 }), [fila(3, { [T.ultima]: lp(ANCLA - 90 * H) }), ...previa(ANCLA, 9)]);
    expect(r['accionPlanilla']).toBe('actualizar');
    expect(r['row_number']).toBe(9 + 2);
  });
  it('NIEGA: un mapa sin «Última interacción» no escribe cuando hay conversación (sin_ultima_interaccion)', () => {
    const m = clonar(MAPA) as { columnas: Record<string, unknown> };
    delete m.columnas['ultimaInteraccion'];
    delete m.columnas['ventana24h'];
    Object.assign(m.columnas, { agendo: { letra: 'K', titulo: 'Agendó' }, fechaCita: { letra: 'L', titulo: 'Fecha y hora de la cita' } }); // sin huecos de letras
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sin: any = compileFunction(`${conMapa(m)}\n${FUNCIONES}`, [])();
    const suyas = [{ json: { row_number: 8, ...Object.fromEntries(Object.values(m.columnas).map((c) => [(c as { titulo: string }).titulo, ''])), [T.telefono]: TEL } }];
    const r = decidir(p(), suyas, m, sin);
    expect(r['accionPlanilla']).toBe('nada');
    expect(r['veredictoPlanilla']).toBe('sin_ultima_interaccion');
  });
  it('la fila nueva sale «Tibio» cuando el prospecto es el mínimo (sin ninguna señal)', () => {
    const r = decidir({ telefono: TEL, nombre: 'Ana P', nombreDePerfil: true, senales: {}, conversacionDesdeMs: ANCLA, ultimaInteraccionMs: ANCLA });
    expect(r['accionPlanilla']).toBe('agregar');
    expect(r[T.clasif]).toBe('Tibio');
  });
});

describe('una fila por conversación: el nodo «Prospecto para la planilla»', () => {
  const CODIGO = `${conMapa(MAPA)}\n${leer('crm/nodo-prospecto.js')}`;
  const correrNodo = (items: J[], ventanaVenceEn: unknown, ahoraMs: number): J[] => {
    const nodos: Record<string, unknown> = {
      'Traer configuración': { first: () => ({ json: {} }) },
      ...(ventanaVenceEn === undefined ? {} : { 'Reportar mensaje (entrante)': { first: () => ({ json: { atencion: { ventanaVenceEn } } }) } }),
    };
    const dolar = (n: string) => { if (!nodos[n]) throw new Error('no existe'); return nodos[n]; };
    const real = Date.now;
    Date.now = () => ahoraMs;
    try {
      return (compileFunction(CODIGO, ['$', '$input'])(dolar, { all: () => items.map((json) => ({ json })) }) as Array<{ json: J }>).map((x) => x.json);
    } finally { Date.now = real; }
  };
  const base = { guardarPlanilla: true, prospectoPlanilla: { telefono: TEL, nombre: 'Ana' } };
  const venc = new Date(ANCLA + 24 * H).toISOString();
  it('lleva el ancla (ventanaVenceEn - 24 h) dentro del prospecto', () => {
    expect(correrNodo([base], venc, ANCLA + H)[0]!['conversacionDesdeMs']).toBe(ANCLA);
  });
  it('sin la respuesta de la ingesta (o con un dato ilegible) el ancla es null: no se crea fila', () => {
    for (const v of [undefined, null, '', 'ayer', 5]) expect(correrNodo([base], v, ANCLA)[0]!['conversacionDesdeMs'], String(v)).toBeNull();
  });
  it('NIEGA: un saliente de campaña (sin prospecto) no produce nada', () => {
    expect(correrNodo([{ guardarPlanilla: false, prospectoPlanilla: null }], venc, ANCLA + H)).toHaveLength(0);
  });
  it('fila mínima: la conversación abre en este turno y el flujo declaró la planilla lista, sin prospecto', () => {
    const sinProspecto = { guardarPlanilla: false, prospectoPlanilla: null, from: TEL, nombrePerfil: 'Ana P', planillaMinima: true };
    const r = correrNodo([sinProspecto], venc, ANCLA + 60_000);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ telefono: TEL, nombre: 'Ana P', nombreDePerfil: true, conversacionDesdeMs: ANCLA, senales: {} });
    // NIEGA: sin la declaración del flujo (prueba, protección, sin planilla), nunca; ni en un turno posterior; ni sin ancla
    expect(correrNodo([{ ...sinProspecto, planillaMinima: false }], venc, ANCLA + 60_000)).toHaveLength(0);
    expect(correrNodo([{ ...sinProspecto, planillaMinima: undefined }], venc, ANCLA + 60_000)).toHaveLength(0);
    expect(correrNodo([sinProspecto], venc, ANCLA + 11 * 60_000)).toHaveLength(0);
    expect(correrNodo([sinProspecto], undefined, ANCLA + 60_000)).toHaveLength(0);
  });
});
