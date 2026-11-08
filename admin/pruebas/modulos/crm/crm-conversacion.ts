/**
 * miniCRM: UNA FILA POR CONVERSACION (Andres, 08/11/2026; reemplaza la regla de 48 h).
 * La conversación es la del cobro: ventana FIJA de 24 h desde el primer mensaje de consulta. La ingesta devuelve el ancla en `atencion.conversacionDesde` y
 * `atencion.conversacionNueva` (helper único: `ingesta-conversacion.ts`). Una fila es de la conversación si su celda «Se cierra la ventana de 24 h» es >= desde + 24 h
 * (o, sin esa columna, su fecha de registro con hora es >= desde). Mensajes por conversación: 0. Ningún literal de teléfono: se construyen en tiempo de ejecución.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import { inyectarMapa } from '../../../../Flujos/experimental/comun-sin-agente/construir-crm.mjs';
import { isoSinFracciones, respuestaDeIngesta } from './ingesta-conversacion';
// @ts-expect-error oráculo en JavaScript plano
import { decidirAccion } from './oraculo/decidir-fila-conversacion.js';

type J = Record<string, unknown>;
const FLUJOS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'Flujos', 'src', 'modulos');
const leer = (r: string) => readFileSync(join(FLUJOS, r), 'utf8');
const clonar = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

const T = {
  id: 'ID Lead', fecha: 'Fecha Registro', nombre: 'Nombre y Apellido', empresa: 'Empresa / Cliente', telefono: 'Teléfono WhatsApp', etapa: 'Etapa Funnel',
  origen: 'Origen / Canal', calif: 'Calificación IA', resumen: 'Resumen Chatbot IA', clasif: 'Clasificación', ultima: 'Última interacción', ventana: 'Se cierra la ventana de 24 h',
  estado: 'Estado Comercial',
};
const MAPA = {
  filaEncabezados: 3, prefijoId: 'LEAD-', primerId: 1001,
  columnas: {
    id: { letra: 'A', titulo: T.id }, fecha: { letra: 'B', titulo: T.fecha }, nombre: { letra: 'C', titulo: T.nombre }, empresa: { letra: 'D', titulo: T.empresa },
    telefono: { letra: 'E', titulo: T.telefono }, etapaInicial: { letra: 'F', titulo: T.etapa }, origen: { letra: 'G', titulo: T.origen }, calificacion: { letra: 'H', titulo: T.calif },
    resumen: { letra: 'I', titulo: T.resumen }, clasificacion: { letra: 'J', titulo: T.clasif }, ultimaInteraccion: { letra: 'K', titulo: T.ultima }, ventana24h: { letra: 'L', titulo: T.ventana },
    agendo: { letra: 'M', titulo: 'Agendó' }, fechaCita: { letra: 'N', titulo: 'Fecha y hora de la cita' },
  },
  equipo: { valor: null, responsable: null, estado: { letra: 'O', titulo: T.estado }, proximaAccion: null },
  extrasDelEquipo: {},
  alCrear: { etapaInicial: '1. Nuevo Lead', origen: 'Chatbot WhatsApp IA', origenAnuncio: 'Campaña Meta Ads', estado: 'Activo' },
};
/** El mapa de un tenant SIN la columna de la ventana (como NovuChat): identifica por la fecha de registro con hora. */
const MAPA_FECHA = (() => {
  const m = clonar(MAPA) as typeof MAPA & { alCrear: Record<string, unknown> };
  delete (m.columnas as Record<string, unknown>)['ventana24h'];
  delete (m.columnas as Record<string, unknown>)['ultimaInteraccion'];
  delete (m.columnas as Record<string, unknown>)['agendo'];
  delete (m.columnas as Record<string, unknown>)['fechaCita'];
  delete (m.columnas as Record<string, unknown>)['clasificacion'];
  m.alCrear['fechaConHora'] = true;
  m.equipo.estado = { letra: 'J', titulo: T.estado }; // sin huecos de letras
  return m;
})();
const titulos = (m: { columnas: Record<string, { titulo: string }>; equipo: Record<string, { titulo: string } | null> }) =>
  [...Object.values(m.columnas).map((c) => c.titulo), ...Object.values(m.equipo).filter(Boolean).map((c) => (c as { titulo: string }).titulo)];
const FUNCIONES = 'return { crmDecidirFila, crmDesdeVentana, capCalificar, capResumir, CAP_PRIORIDAD };';
const conMapa = (m: unknown) => `${inyectarMapa(leer('crm/crm.js'), m)}\n${leer('captacion/crm-captacion.js')}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const modulo = (m: unknown): any => compileFunction(`${conMapa(m)}\n${FUNCIONES}`, [])();
const M = modulo(MAPA);
const MF = modulo(MAPA_FECHA);

const H = 3600_000;
const ANCLA = Date.UTC(2026, 10, 8, 12, 0, 0);
const TEL = ['59', '17', '000', '020'].join('');
const lp = (ms: number) => new Date(ms - 4 * H).toISOString().slice(0, 16).replace('T', ' ');
const fila = (n: number, extra: J = {}, m: Parameters<typeof titulos>[0] = MAPA): { json: J } => ({ json: { row_number: n, ...Object.fromEntries(titulos(m).map((t) => [t, ''])), [T.telefono]: TEL, ...extra } });
/** La fila que dejó una conversación que abrió en `desdeMs`: su ventana cierra 24 h después y su última interacción es posterior. */
const deConversacion = (desdeMs: number, n = 8, extra: J = {}) => fila(n, { [T.ventana]: lp(desdeMs + 24 * H), [T.ultima]: lp(desdeMs + H), ...extra });
const deConversacionFecha = (desdeMs: number, n = 8) => fila(n, { [T.fecha]: lp(desdeMs) }, MAPA_FECHA);
function decidir(pr: J, busqueda: Array<{ json: J }> = [], mapa: unknown = MAPA, mod = M): J {
  return mod.crmDecidirFila({ prospectos: [{ json: pr }], busqueda, lecturaIds: [{ json: { row_number: 4, [T.id]: 'LEAD-1010' } }], mapa: clonar(mapa),
    adaptador: { calificar: M.capCalificar, resumir: M.capResumir, prioridad: M.CAP_PRIORIDAD }, ahoraMs: ANCLA })[0].json as J;
}
const p = (o: J = {}): J => ({ telefono: TEL, nombre: 'Ana', conversacionDesdeMs: ANCLA, ultimaInteraccionMs: ANCLA + H, ...o });
const SOLO_CLAVES = (r: J, permitidas: string[]) => Object.keys(r).filter((k) => !['accionPlanilla', 'veredictoPlanilla', 'row_number', ...permitidas].includes(k));

describe('una fila por conversación: la ventana fija de 24 h', () => {
  it('NIEGA: un segundo mensaje dentro de la ventana no crea fila (actualiza la más reciente)', () => {
    const r = decidir(p({ ultimaInteraccionMs: ANCLA + 2 * H, quePidio: 'precio' }), [deConversacion(ANCLA)]);
    expect(r['accionPlanilla']).toBe('actualizar');
    expect(r['row_number']).toBe(8 + 2);
  });
  it('NIEGA: a las 23 h 59 del ancla no crea fila', () => {
    const t = ANCLA + 24 * H - 60_000;
    expect(decidir(p({ ultimaInteraccionMs: t, quePidio: 'x' }), [deConversacion(ANCLA)])['accionPlanilla']).toBe('actualizar');
  });
  it('a las 24 h exactas la conversación es otra: SÍ crea fila, y su ventana cierra 24 h después del ancla nueva', () => {
    const nueva = ANCLA + 24 * H;
    const r = decidir(p({ conversacionDesdeMs: nueva, ultimaInteraccionMs: nueva }), [deConversacion(ANCLA)]);
    expect(r['accionPlanilla']).toBe('agregar');
    expect(r[T.ventana]).toBe("'" + lp(nueva + 24 * H));
  });
  it('se compara al minuto: la fila escrita en el mismo minuto del ancla es de esa conversación', () => {
    expect(decidir(p({ conversacionDesdeMs: ANCLA + 45_000, quePidio: 'x' }), [deConversacion(ANCLA)])['accionPlanilla']).toBe('actualizar');
  });
  it('NIEGA: una cortesía con la ventana vencida (el ancla sigue siendo la de la conversación vencida) no crea fila', () => {
    const vencida = ANCLA - 30 * H;
    expect(decidir(p({ conversacionDesdeMs: vencida, ultimaInteraccionMs: ANCLA, quePidio: 'x' }), [deConversacion(vencida)])['accionPlanilla']).toBe('actualizar');
  });
  it('NIEGA: con la ingesta caída (sin ancla) se actualiza la más reciente y no se crea', () => {
    for (const sin of [null, undefined, 'x', Number.NaN]) {
      expect(decidir(p({ conversacionDesdeMs: sin, quePidio: 'x' }), [deConversacion(ANCLA - 90 * H)])['accionPlanilla'], String(sin)).toBe('actualizar');
    }
    expect(decidir(p({ conversacionDesdeMs: null }), [])['accionPlanilla']).toBe('agregar'); // sin ninguna fila del teléfono no hay a quién actualizar
  });
  it('NIEGA: `nuevoContacto` (la regla de 48 h) se ignora, con la ventana vigente y sin ancla', () => {
    expect(decidir(p({ nuevoContacto: true, quePidio: 'x' }), [deConversacion(ANCLA)])['accionPlanilla']).toBe('actualizar');
    expect(decidir(p({ nuevoContacto: true, conversacionDesdeMs: null, quePidio: 'x' }), [deConversacion(ANCLA - 100 * H)])['accionPlanilla']).toBe('actualizar');
  });
  it('una fila sin la celda de la ventana (o ilegible) es de otra conversación: con ancla se agrega; sin ancla se actualiza', () => {
    const vieja = [fila(8, { [T.ventana]: 'ayer' })];
    expect(decidir(p(), vieja)['accionPlanilla']).toBe('agregar');
    expect(decidir(p({ conversacionDesdeMs: null, quePidio: 'x' }), vieja)['accionPlanilla']).toBe('actualizar');
  });
  it('NIEGA: cancelar al día siguiente toca SOLO la fila más reciente y no crea otra', () => {
    const r = decidir(p({ conversacionDesdeMs: ANCLA + 30 * H, agendo: 'No', citaCancelada: true, citasRestantes: 0 }), [deConversacion(ANCLA - 90 * H, 3), deConversacion(ANCLA, 9)]);
    expect(r['accionPlanilla']).toBe('actualizar');
    expect(r['row_number']).toBe(9 + 2);
  });
  it('NIEGA: un mapa sin columna de ventana ni fecha con hora no escribe cuando hay conversación (sin_identificador_de_conversacion)', () => {
    const m = clonar(MAPA) as { columnas: Record<string, unknown> };
    for (const k of ['ventana24h', 'ultimaInteraccion', 'agendo', 'fechaCita']) delete m.columnas[k];
    (m as unknown as typeof MAPA).equipo.estado = { letra: 'K', titulo: T.estado };
    const r = decidir(p(), [fila(8, {}, m as never)], m, modulo(m));
    expect(r['accionPlanilla']).toBe('nada');
    expect(r['veredictoPlanilla']).toBe('sin_identificador_de_conversacion');
  });
  it('sin la columna de la ventana, la fecha de registro CON hora identifica la conversación (mapa de NovuChat)', () => {
    const crea = decidir(p(), [], MAPA_FECHA, MF);
    expect(crea['accionPlanilla']).toBe('agregar');
    expect(crea[T.fecha]).toBe("'" + lp(ANCLA)); // la fecha de la fila es el inicio de la conversación
    expect(decidir(p({ quePidio: 'x', rubro: 'Ropa' }), [deConversacionFecha(ANCLA)], MAPA_FECHA, MF)['accionPlanilla']).toBe('actualizar');
    expect(decidir(p({ conversacionDesdeMs: ANCLA + 24 * H }), [deConversacionFecha(ANCLA)], MAPA_FECHA, MF)['accionPlanilla']).toBe('agregar');
  });
});

describe('una fila por conversación: la fila mínima NEUTRA (protección, prueba, otro país, plan)', () => {
  const MIN = (o: J = {}): J => ({ telefono: TEL, minima: true, senales: {}, conversacionDesdeMs: ANCLA, ultimaInteraccionMs: ANCLA, ...o });
  it('crea la fila con SOLO teléfono, fecha y última interacción: Etapa, Origen y clasificación VACÍOS y Estado «Sin seguimiento»', () => {
    const r = decidir(MIN({ nombre: 'Dato Que No Debe Pasar', quePidio: 'texto', resumen: 'motivo', rubro: 'x', empresa: 'y', anuncio: true, plan: 'riesgo', estado: 'cerrado' }));
    expect(r['accionPlanilla']).toBe('agregar');
    expect(r[T.telefono]).toBe("'" + TEL);
    expect(r[T.ultima]).toBe("'" + lp(ANCLA));
    expect(r[T.estado]).toBe('Sin seguimiento');
    for (const k of [T.etapa, T.origen, T.clasif, T.nombre, T.empresa, T.calif, T.resumen, 'Agendó', 'Fecha y hora de la cita']) expect([undefined, ''], k).toContain(r[k]);
    expect(Object.values(r).join('|')).not.toMatch(/Dato Que No Debe|texto|motivo|Nuevo Lead|Activo|Tibio|Chatbot|Campaña|riesgo|cerrado/);
  });
  it('una conversación sin prospecto produce exactamente 1 fila; la 2.ª en la misma ventana no crea otra', () => {
    expect(decidir(MIN())['accionPlanilla']).toBe('agregar');
    const escrita = deConversacion(ANCLA, 8, { [T.ultima]: lp(ANCLA), [T.estado]: 'Sin seguimiento' });
    const segunda = decidir(MIN({ ultimaInteraccionMs: ANCLA + 2 * H, nombre: 'No' }), [escrita]);
    expect(segunda['accionPlanilla']).toBe('actualizar');
    expect(SOLO_CLAVES(segunda, [T.ultima])).toEqual([]);
    expect(decidir(MIN({ ultimaInteraccionMs: ANCLA + 10 * 60_000 }), [escrita])['accionPlanilla']).toBe('nada'); // menos de 60 min: no se escribe
  });
  it('una fila MÍNIMA nunca pisa una fila con datos: no escribe nombre, calificación ni clasificación', () => {
    const rica = deConversacion(ANCLA, 8, { [T.nombre]: 'Ana', [T.clasif]: 'Caliente', [T.calif]: 'Alta', [T.ultima]: lp(ANCLA) });
    const r = decidir(MIN({ nombre: 'Otro', ultimaInteraccionMs: ANCLA + 2 * H }), [rica]);
    expect(SOLO_CLAVES(r, [T.ultima])).toEqual([]);
  });
});

describe('una fila por conversación: menos escrituras (cuota de Google Sheets)', () => {
  it('«Última interacción» sola no justifica una escritura antes de 60 min; después de 60 min sí', () => {
    const f = deConversacion(ANCLA, 8, { [T.ultima]: lp(ANCLA + H), [T.nombre]: 'Ana', [T.calif]: 'Media' });
    const sin = (ms: number) => decidir(p({ nombre: 'Ana', ultimaInteraccionMs: ms }), [f]);
    expect(sin(ANCLA + H + 30 * 60_000)['accionPlanilla']).toBe('nada');
    expect(sin(ANCLA + 2 * H + 60_000)['accionPlanilla']).toBe('actualizar');
  });
  it('si cambia otra celda, «Última interacción» viaja en la misma escritura', () => {
    const f = deConversacion(ANCLA, 8, { [T.ultima]: lp(ANCLA + H) });
    const r = decidir(p({ nombre: 'Luis', ultimaInteraccionMs: ANCLA + H + 5 * 60_000 }), [f]);
    expect(r['accionPlanilla']).toBe('actualizar');
    expect(r[T.nombre]).toBe('Luis');
  });
});

describe('una fila por conversación: el nodo «Prospecto para la planilla» y el contrato de la ingesta', () => {
  const CODIGO = `${conMapa(MAPA)}\n${leer('crm/nodo-prospecto.js')}`;
  const LISTA = { planillaProspectosId: 'id-de-hoja-de-prueba', planillaProspectosHoja: 'Leads' };
  const correrNodo = (items: J[], ingesta: J | undefined, ahoraMs: number, o: { planilla?: J | null; normalizar?: unknown } = {}): J[] => {
    const planilla = o.planilla === undefined ? LISTA : o.planilla;
    const nodos: Record<string, unknown> = {
      'Traer configuración': { first: () => ({ json: {} }) },
      ...(planilla === null ? {} : { 'Config del negocio': { first: () => ({ json: planilla }) } }),
      ...(ingesta === undefined ? {} : { 'Reportar mensaje (entrante)': { first: () => ({ json: ingesta }) } }),
      ...(o.normalizar === undefined ? {} : { 'Normalizar entrada': { first: () => ({ json: { from: o.normalizar } }) } }),
    };
    const dolar = (n: string) => { if (!nodos[n]) throw new Error('no existe'); return nodos[n]; };
    const real = Date.now;
    Date.now = () => ahoraMs;
    try {
      return (compileFunction(CODIGO, ['$', '$input'])(dolar, { all: () => items.map((json) => ({ json })) }) as Array<{ json: J }>).map((x) => x.json);
    } finally { Date.now = real; }
  };
  const base = { guardarPlanilla: true, prospectoPlanilla: { telefono: TEL, nombre: 'Ana' } };
  const apertura = respuestaDeIngesta({ desdeMs: ANCLA, nueva: true });
  const despues = respuestaDeIngesta({ desdeMs: ANCLA, nueva: false });
  it('el helper del contrato entrega ISO UTC con Z y sin fracciones', () => {
    expect(isoSinFracciones(ANCLA + 123)).toBe('2026-11-08T12:00:00Z');
    expect((apertura['atencion'] as J)['conversacionDesde']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
  it('lleva el ancla (`conversacionDesde`) dentro del prospecto, en la apertura y después', () => {
    expect(correrNodo([base], apertura, ANCLA)[0]!['conversacionDesdeMs']).toBe(ANCLA);
    expect(correrNodo([base], despues, ANCLA + 5 * H)[0]!['conversacionDesdeMs']).toBe(ANCLA);
  });
  it('sin la respuesta de la ingesta, con un dato ilegible o FUERA DE RANGO el ancla es null: no se crea fila', () => {
    const con = (desde: unknown) => ({ ok: true, atencion: { conversacionDesde: desde, conversacionNueva: true } });
    for (const v of [undefined, null, '', 'ayer', 5, isoSinFracciones(ANCLA + 24 * H + 10 * 60_000), isoSinFracciones(ANCLA - 24 * H - 6 * 60_000), isoSinFracciones(ANCLA + 6 * 60_000)]) {
      expect(correrNodo([base], con(v), ANCLA)[0]!['conversacionDesdeMs'] ?? null, String(v)).toBeNull();
    }
    expect(correrNodo([base], undefined, ANCLA)[0]!['conversacionDesdeMs']).toBeNull();
    expect(correrNodo([base], { ok: true }, ANCLA)[0]!['conversacionDesdeMs']).toBeNull();
  });
  it('NIEGA: `ventanaVenceEn` ya no se usa para derivar el ancla (solo vale el contrato nuevo)', () => {
    expect(correrNodo([base], { ok: true, atencion: { ventanaVenceEn: isoSinFracciones(ANCLA + 24 * H) } }, ANCLA + H)[0]!['conversacionDesdeMs']).toBeNull();
  });
  it('fila mínima SOLO cuando este mensaje abrió la conversación: sale solo el teléfono', () => {
    const filtrado = { guardarPlanilla: false, prospectoPlanilla: null, from: TEL, nombrePerfil: 'Ana P', texto: 'algo de la protección', plan: 'riesgo' };
    const r = correrNodo([filtrado], apertura, ANCLA + 60_000, { normalizar: TEL });
    expect(r).toHaveLength(1);
    expect(Object.keys(r[0]!).sort()).toEqual(['conversacionDesdeMs', 'minima', 'senales', 'telefono', 'ultimaInteraccionMs']);
    expect(r[0]).toMatchObject({ telefono: TEL, minima: true, conversacionDesdeMs: ANCLA, senales: {} });
    expect(JSON.stringify(r)).not.toMatch(/Ana P|protección|riesgo/);
    // NIEGA: en los turnos que NO abren conversación no se arma fila mínima (y Google ni se consulta)
    expect(correrNodo([filtrado], despues, ANCLA + 5 * H, { normalizar: TEL })).toHaveLength(0);
  });
  it('NIEGA: sin ancla, sin planilla configurada (id u hoja vacíos) o sin teléfono verificado, no hay fila mínima (y sin teléfono FALLA a la vista)', () => {
    const filtrado = { guardarPlanilla: false, prospectoPlanilla: null, from: TEL };
    expect(correrNodo([filtrado], undefined, ANCLA)).toHaveLength(0);
    expect(correrNodo([filtrado], { ok: true, atencion: { conversacionDesde: null, conversacionNueva: true } }, ANCLA)).toHaveLength(0);
    expect(correrNodo([filtrado], apertura, ANCLA, { planilla: null })).toHaveLength(0);
    expect(correrNodo([filtrado], apertura, ANCLA, { planilla: { planillaProspectosId: '', planillaProspectosHoja: 'Leads' } })).toHaveLength(0);
    expect(correrNodo([filtrado], apertura, ANCLA, { planilla: { planillaProspectosId: 'x', planillaProspectosHoja: '' } })).toHaveLength(0);
    expect(() => correrNodo([{ guardarPlanilla: false, prospectoPlanilla: null }], apertura, ANCLA)).toThrow(/telefono verificado/);
    expect(() => correrNodo([{ ...filtrado, from: 'abc' }], apertura, ANCLA)).toThrow(/telefono verificado/);
    expect(() => correrNodo([filtrado], apertura, ANCLA, { normalizar: TEL.slice(0, -1) + '9' })).toThrow(/no coincide/);
  });
  it('NIEGA: con un prospecto armado no sale además una fila mínima', () => {
    expect(correrNodo([base, { guardarPlanilla: false, prospectoPlanilla: null, from: TEL }], apertura, ANCLA + H)).toHaveLength(1);
  });
});

describe('una fila por conversación: las negaciones nombradas (coordinadora, 08/11/2026)', () => {
  it('(1) un saliente de campaña NO crea fila: sin entrante no hay ancla ni prospecto', () => {
    const nodos: Record<string, unknown> = { 'Traer configuración': { first: () => ({ json: {} }) }, 'Reportar mensaje (entrante)': { first: () => ({ json: despuesDeLaApertura() }) } };
    const dolar = (n: string) => { if (!nodos[n]) throw new Error('no existe'); return nodos[n]; };
    const salientes = [{ guardarPlanilla: false, prospectoPlanilla: null, saliente: true, campana: true }, { guardarPlanilla: true, prospectoPlanilla: null }];
    const r = compileFunction(`${conMapa(MAPA)}\n${leer('crm/nodo-prospecto.js')}`, ['$', '$input'])(dolar, { all: () => salientes.map((json) => ({ json })) }) as unknown[];
    expect(r).toHaveLength(0);
  });
  it('(2) `nuevoContacto=true` con la ventana vigente NO crea fila (regresión de la regla de 48 h)', () => {
    const r = decidir(p({ nuevoContacto: true, conversacionDesdeMs: ANCLA, quePidio: 'x' }), [deConversacion(ANCLA)]);
    expect(r['accionPlanilla']).toBe('actualizar');
    expect(r['row_number']).toBe(8 + 2);
  });
  it('(3) cancelar al día siguiente toca SOLO la fila más reciente y no crea otra', () => {
    const filas = [deConversacion(ANCLA - 90 * H, 3), deConversacion(ANCLA, 9)];
    const r = decidir(p({ conversacionDesdeMs: ANCLA + 30 * H, agendo: 'No', citaCancelada: true, citasRestantes: 0 }), filas);
    expect(r['accionPlanilla']).toBe('actualizar');
    expect(r['row_number']).toBe(9 + 2);
    expect(SOLO_CLAVES(r, ['Agendó', 'Fecha y hora de la cita'])).toEqual([]);
  });
});

function despuesDeLaApertura(): J { return respuestaDeIngesta({ desdeMs: ANCLA, nueva: false }); }

describe('oráculo nuevo (una fila por conversación): el módulo y la referencia escrita aparte deciden igual', () => {
  it('500 casos con semilla fija: con y sin ancla, fila de esta conversación, de otra, ilegible o ausente, con `nuevoContacto` verdadero o falso', () => {
    let semilla = 20261108;
    const R = () => { semilla = (semilla * 1664525 + 1_013_904_223) % 2 ** 32; return semilla / 2 ** 32; };
    const cuenta: Record<string, number> = { agregar: 0, actualizar: 0 };
    for (let i = 0; i < 500; i++) {
      const desde = R() < 0.2 ? null : ANCLA + Math.floor((R() - 0.5) * 20 * H);
      const hay = R() < 0.8;
      const celda = !hay ? null : R() < 0.1 ? 'ayer' : lp((desde ?? ANCLA) + 24 * H + Math.floor((R() - 0.6) * 60 * H));
      const busqueda = hay ? [fila(5, { [T.ventana]: celda })] : [];
      const r = decidir(p({ nuevoContacto: R() < 0.5, conversacionDesdeMs: desde, quePidio: 'x' }), busqueda);
      const esperado = decidirAccion({ hayFila: hay, desdeMs: desde, ventanaCelda: celda });
      expect(r['accionPlanilla'], `caso ${i}`).toBe(esperado);
      cuenta[esperado] = (cuenta[esperado] ?? 0) + 1;
    }
    expect(cuenta['agregar']).toBeGreaterThan(50);
    expect(cuenta['actualizar']).toBeGreaterThan(50);
  });
});
