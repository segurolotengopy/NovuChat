/**
 * miniCRM: tres columnas OPCIONALES del bot, «Servicio elegido», «Agendó» y «Fecha y hora de la cita» (orden de Andres, 07/11/2026; Bellido).
 *   · Contrato: los campos están en `COLUMNAS_V1` (dueño del bot) y en `CRM_CAMPOS_BOT`.
 *   · Un cliente que NO las mapea escribe EXACTAMENTE lo de antes, aunque el prospecto traiga los campos (comparado con el mapa sin ellas).
 *   · Reglas (negando primero): «Sí» solo por el hecho; un «No» posterior nunca pisa un «Sí»; la cancelación explícita sí; la fecha solo con «Sí»;
 *     el servicio es de lista cerrada y se neutraliza.
 * Mensajes por conversación: 0.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CAMPOS_DEL_BOT, COLUMNAS_V1 } from '../../../functions/src/modulos/crm/columnas.js';
// @ts-expect-error módulo .mjs sin tipos
import { inyectarMapa } from '../../../../Flujos/experimental/comun-sin-agente/construir-crm.mjs';

type J = Record<string, unknown>;
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const leer = (r: string): string => readFileSync(join(RAIZ, r), 'utf8');
const clonar = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

const MAPA_BASE = {
  filaEncabezados: 3, prefijoId: 'LEAD-', primerId: 1001,
  columnas: {
    id: { letra: 'A', titulo: 'ID Lead' }, fecha: { letra: 'B', titulo: 'Fecha Registro' }, nombre: { letra: 'C', titulo: 'Nombre y Apellido' },
    empresa: { letra: 'D', titulo: 'Empresa / Cliente' }, telefono: { letra: 'E', titulo: 'Teléfono WhatsApp' }, etapaInicial: { letra: 'F', titulo: 'Etapa Funnel' },
    origen: { letra: 'G', titulo: 'Origen / Canal' }, calificacion: { letra: 'H', titulo: 'Calificación IA' }, resumen: { letra: 'I', titulo: 'Resumen Chatbot IA' },
  },
  equipo: { valor: null, responsable: null, estado: null, proximaAccion: null },
  extrasDelEquipo: {},
  alCrear: { etapaInicial: '1. Nuevo Lead', origen: 'Chatbot WhatsApp IA', origenAnuncio: 'Campaña Meta Ads' },
};
const MAPA_CON: typeof MAPA_BASE = clonar(MAPA_BASE);
Object.assign(MAPA_CON.columnas, {
  servicioElegido: { letra: 'J', titulo: 'Servicio elegido' }, agendo: { letra: 'K', titulo: 'Agendó' }, fechaCita: { letra: 'L', titulo: 'Fecha y hora de la cita' },
});
const FUNCIONES = 'return { crmDecidirFila, capCalificar, capResumir, CAP_PRIORIDAD, CRM_CAMPOS_BOT };';
const modulo = (mapa: unknown) => compileFunction(`${inyectarMapa(leer('Flujos/src/modulos/crm/crm.js'), mapa)}\n${leer('Flujos/src/modulos/captacion/crm-captacion.js')}\n${FUNCIONES}`, [])();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SIN: any = modulo(MAPA_BASE);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CON: any = modulo(MAPA_CON);

const TEL = ['59', '17', '000', '001'].join('');
const AHORA = Date.UTC(2026, 10, 7, 15, 0, 0);
const CITA = Date.UTC(2026, 10, 9, 19, 30, 0); // 15:30 en La Paz
const T_BASE = ['ID Lead', 'Fecha Registro', 'Nombre y Apellido', 'Empresa / Cliente', 'Teléfono WhatsApp', 'Etapa Funnel', 'Origen / Canal', 'Calificación IA', 'Resumen Chatbot IA'];
const T_CON = [...T_BASE, 'Servicio elegido', 'Agendó', 'Fecha y hora de la cita'];
const existente = (extra: J = {}): J => ({ json: { row_number: 5, ...Object.fromEntries(T_CON.map((t) => [t, ''])), 'Teléfono WhatsApp': TEL, 'Nombre y Apellido': 'Ana', ...extra } });
function decidir(M: any, mapa: typeof MAPA_BASE, p: J, fila?: J): J { // eslint-disable-line @typescript-eslint/no-explicit-any
  const ids = [{ json: { row_number: 2, 'ID Lead': 'LEAD-1010' } }];
  const r = M.crmDecidirFila({ prospectos: [{ json: { telefono: TEL, nombre: 'Ana', nombreDePerfil: true, ultimaInteraccionMs: AHORA, ...p } }], busqueda: fila ? [fila] : [], lecturaIds: ids,
    mapa: clonar(mapa), adaptador: { calificar: M.capCalificar, resumir: M.capResumir, prioridad: M.CAP_PRIORIDAD }, ahoraMs: AHORA });
  return r[0].json as J;
}
const nuevaCon = (p: J): J => decidir(CON, MAPA_CON, p);
const actCon = (p: J, previo: J = {}): J => decidir(CON, MAPA_CON, p, existente(previo));
const SI = { agendo: 'Sí', fechaCita: CITA };

describe('contrato', () => {
  it('los tres campos son del bot, nuevos, con sus títulos, y el módulo de n8n los conoce', () => {
    for (const [campo, titulo] of [['servicioElegido', 'Servicio elegido'], ['agendo', 'Agendó'], ['fechaCita', 'Fecha y hora de la cita']]) {
      const c = COLUMNAS_V1.find((x) => x.campo === campo);
      expect(c, campo).toMatchObject({ titulo, dueno: 'bot', nueva: true });
      expect(CAMPOS_DEL_BOT).toContain(campo);
    }
    expect([...CON.CRM_CAMPOS_BOT].sort()).toEqual([...CAMPOS_DEL_BOT].sort());
  });
});

describe('un cliente que NO las mapea escribe lo de antes', () => {
  const traen = { servicioElegido: 'Emergencia', agendo: 'Sí', fechaCita: CITA, citaCancelada: true };
  const sinCampos = { quePidio: 'Agendar cita', diaPreferido: 'Lunes' };
  it('fila nueva: la salida es idéntica con o sin los campos nuevos en el prospecto', () => {
    expect(JSON.stringify(decidir(SIN, MAPA_BASE, { ...sinCampos, ...traen }))).toBe(JSON.stringify(decidir(SIN, MAPA_BASE, sinCampos)));
  });
  it('fila existente: ídem, y ninguna celda nueva aparece', () => {
    const fila = { json: { row_number: 5, ...Object.fromEntries(T_BASE.map((t) => [t, ''])), 'Teléfono WhatsApp': TEL } };
    const a = decidir(SIN, MAPA_BASE, { ...sinCampos, ...traen, nombre: 'Luis' }, fila);
    expect(JSON.stringify(a)).toBe(JSON.stringify(decidir(SIN, MAPA_BASE, { ...sinCampos, nombre: 'Luis' }, fila)));
    expect(JSON.stringify(a)).not.toMatch(/Servicio elegido|Agendó|Fecha y hora/);
  });
  it('con las columnas mapeadas pero un prospecto sin los campos: solo se agrega «Agendó: No» al crear', () => {
    const sin = decidir(SIN, MAPA_BASE, sinCampos);
    const con = nuevaCon(sinCampos);
    const { Agendó, ...resto } = con as J;
    expect(Agendó).toBe('No');
    expect(resto).toEqual(sin);
  });
});

describe('«Agendó» y «Fecha y hora de la cita»', () => {
  it('NIEGA: sin «Sí» no hay fecha, ni en fila nueva ni en existente', () => {
    expect(nuevaCon({ agendo: 'No', fechaCita: CITA })['Fecha y hora de la cita']).toBeUndefined();
    expect(nuevaCon({ fechaCita: CITA })['Fecha y hora de la cita']).toBeUndefined();
    expect(actCon({ agendo: 'No', fechaCita: CITA, quePidio: 'x', nombre: 'Luis' }, { 'Nombre y Apellido': 'Ana' })['Fecha y hora de la cita']).toBeUndefined();
  });
  it('NIEGA: un valor que no es «Sí» ni «No» no se escribe como «Agendó» (ni «true», ni «si»)', () => {
    for (const v of [true, 'true', 'si', 'SÍ', 1, null, {}]) expect(nuevaCon({ agendo: v })['Agendó'], String(v)).toBe('No');
    expect(actCon({ agendo: true, nombre: 'Luis' })['Agendó']).toBeUndefined();
  });
  it('fila nueva: «No» por defecto', () => {
    expect(nuevaCon({})['Agendó']).toBe('No');
  });
  it('fila nueva con cita creada: «Sí» y la fecha en hora de La Paz', () => {
    const r = nuevaCon(SI);
    expect(r['Agendó']).toBe("'Sí"); // en fila nueva, como el resto de los textos (USER_ENTERED)
    expect(r['Fecha y hora de la cita']).toBe("'2026-11-09 15:30");
  });
  it('fila existente: «Sí» se escribe y lleva la fecha (sin apóstrofo, escritura RAW)', () => {
    const r = actCon(SI);
    expect(r['accionPlanilla']).toBe('actualizar');
    expect(r['Agendó']).toBe('Sí');
    expect(r['Fecha y hora de la cita']).toBe('2026-11-09 15:30');
  });
  it('NIEGA: un «No» de un turno posterior NUNCA pisa un «Sí» existente (ni con otro dato nuevo)', () => {
    const previo = { 'Agendó': 'Sí', 'Fecha y hora de la cita': '2026-11-09 15:30' };
    const r = actCon({ agendo: 'No', quePidio: 'Consultar horarios', nombre: 'Luis' }, previo);
    expect(r['Agendó']).toBeUndefined();
    expect(r['Fecha y hora de la cita']).toBeUndefined();
    expect(JSON.stringify(actCon({ agendo: 'No' }, previo))).not.toMatch(/Agendó|Fecha y hora/);
  });
  it('NIEGA: un «No» con citaCancelada falsa o ausente tampoco pisa; solo la cancelación explícita', () => {
    const previo = { 'Agendó': 'Sí', 'Fecha y hora de la cita': '2026-11-09 15:30' };
    expect(actCon({ agendo: 'No', citaCancelada: false, quePidio: 'x' }, previo)['Agendó']).toBeUndefined();
    expect(actCon({ agendo: 'No', citaCancelada: 'true', quePidio: 'x' }, previo)['Agendó']).toBeUndefined();
    expect(actCon({ agendo: 'Sí', citaCancelada: true, fechaCita: CITA }, previo)['Agendó']).toBeUndefined();
  });
  it('la cancelación explícita deja «No» y limpia la fecha', () => {
    const r = actCon({ agendo: 'No', citaCancelada: true }, { 'Agendó': 'Sí', 'Fecha y hora de la cita': '2026-11-09 15:30' });
    expect(r['Agendó']).toBe('No');
    expect(r['Fecha y hora de la cita']).toBe('');
  });
  it('una fecha fuera de rango (segundos en vez de ms, NaN) no se escribe', () => {
    expect(nuevaCon({ agendo: 'Sí', fechaCita: 1.8e9 })['Fecha y hora de la cita']).toBeUndefined();
    expect(nuevaCon({ agendo: 'Sí', fechaCita: Number.NaN })['Fecha y hora de la cita']).toBeUndefined();
    expect(nuevaCon({ agendo: 'Sí', fechaCita: 'mañana' })['Fecha y hora de la cita']).toBeUndefined();
  });
});

describe('cancelar o reprogramar tras 48 h (nuevoContacto) y cancelar una de varias citas', () => {
  const PREVIO = { 'Agendó': 'Sí', 'Fecha y hora de la cita': '2026-11-09 15:30', 'Nombre y Apellido': 'Ana' };
  const CANC = { agendo: 'No', citaCancelada: true, citaCanceladaMs: CITA };
  it('NIEGA: cancelar pasadas las 48 h NO crea una fila nueva: actualiza la más reciente del teléfono, solo en «Agendó» y fecha', () => {
    const r = actCon({ ...CANC, nuevoContacto: true, citasRestantes: 0, nombre: 'Luis', quePidio: 'Cancelar cita' }, PREVIO);
    expect(r['accionPlanilla']).toBe('actualizar');
    expect(r['row_number']).toBe(5 + 2);
    expect(r['Agendó']).toBe('No');
    expect(r['Fecha y hora de la cita']).toBe('');
    expect(Object.keys(r).filter((k) => !['accionPlanilla', 'veredictoPlanilla', 'row_number', 'Agendó', 'Fecha y hora de la cita'].includes(k))).toEqual([]);
  });
  it('reprogramar pasadas las 48 h actualiza la fila vieja con la nueva fecha (y solo eso)', () => {
    const nueva = Date.UTC(2026, 10, 12, 18, 0, 0);
    const r = actCon({ agendo: 'Sí', fechaCita: nueva, citaReprogramada: true, nuevoContacto: true, nombre: 'Luis', quePidio: 'Reprogramar cita' }, PREVIO);
    expect(r['accionPlanilla']).toBe('actualizar');
    expect(r['Fecha y hora de la cita']).toBe('2026-11-12 14:00');
    expect(Object.keys(r).filter((k) => !['accionPlanilla', 'veredictoPlanilla', 'row_number', 'Fecha y hora de la cita'].includes(k))).toEqual([]);
  });
  it('sin cancelar ni reprogramar, pasadas las 48 h sigue siendo una fila NUEVA (no cambia)', () => {
    expect(actCon({ agendo: 'No', nuevoContacto: true }, PREVIO)['accionPlanilla']).toBe('agregar');
    expect(actCon({ agendo: 'Sí', fechaCita: CITA, nuevoContacto: true }, PREVIO)['accionPlanilla']).toBe('agregar');
  });
  it('NIEGA: cancelar UNA de varias citas que NO es la de la fila no pone «No» ni limpia la fecha', () => {
    const r = actCon({ ...CANC, citaCanceladaMs: Date.UTC(2026, 10, 10, 19, 0, 0), citasRestantes: 1, proximaCitaMs: CITA, nombre: 'Luis' }, PREVIO);
    expect(r['Agendó']).toBeUndefined();
    expect(r['Fecha y hora de la cita']).toBeUndefined();
  });
  it('cancelar la cita de la fila cuando QUEDAN otras: sigue «Sí» y la fecha pasa a la próxima', () => {
    const prox = Date.UTC(2026, 10, 11, 19, 0, 0);
    const r = actCon({ ...CANC, citasRestantes: 1, proximaCitaMs: prox, nombre: 'Luis' }, PREVIO);
    expect(r['Agendó']).toBeUndefined();
    expect(r['Fecha y hora de la cita']).toBe('2026-11-11 15:00');
  });
  it('cancelar la última cita (no queda ninguna): «No» y fecha vacía; sin dato de cuántas quedan se comporta como antes', () => {
    for (const extra of [{ citasRestantes: 0 }, {}]) {
      const r = actCon({ ...CANC, ...extra }, PREVIO);
      expect([r['Agendó'], r['Fecha y hora de la cita']]).toEqual(['No', '']);
    }
  });
});

describe('«Servicio elegido» (lista cerrada)', () => {
  it('acepta solo los cuatro valores', () => {
    for (const s of ['Emergencia', 'Recién nacido', 'Control niño sano', 'Vacunas y/o otros']) expect(nuevaCon({ servicioElegido: s })['Servicio elegido'], s).toBe("'" + s);
  });
  it('NIEGA: cualquier otro valor se descarta (texto libre, fórmula, clínico, otro idioma, no-texto)', () => {
    for (const s of ['dolor de pecho', '=1+1', 'Control del niño sano', 'emergencia', 'Vacunas', 7, null, ['Emergencia'], { a: 1 }]) {
      expect(nuevaCon({ servicioElegido: s })['Servicio elegido'], String(s)).toBeUndefined();
      expect(actCon({ servicioElegido: s, nombre: 'Luis' })['Servicio elegido'], String(s)).toBeUndefined();
    }
  });
  it('en una fila existente se sobrescribe con el último valor válido, y un turno sin servicio no lo borra', () => {
    expect(actCon({ servicioElegido: 'Vacunas y/o otros' }, { 'Servicio elegido': 'Recién nacido' })['Servicio elegido']).toBe('Vacunas y/o otros');
    expect(actCon({ nombre: 'Luis' }, { 'Servicio elegido': 'Recién nacido' })['Servicio elegido']).toBeUndefined();
    expect(actCon({ servicioElegido: 'inventado' }, { 'Servicio elegido': 'Recién nacido' })['Servicio elegido']).toBeUndefined();
  });
});
