/**
 * LA LIBRERÍA DE AGENDA DE «AGENDA MÍNIMA v0» (`Flujos/experimental/agenda-minima/src/lib/agenda.js`).
 *
 * Principio del flujo: el código calcula, el modelo conversa. Toda hora que se ofrece sale de estas
 * funciones puras; esta suite las prueba una por una, cada regla con su caso negativo. Cubre los
 * incidentes reales: el «día lleno» que el modelo calculaba mal (un día con UNA hora libre NO está
 * lleno), el «9 am», la hora que pide es la de su propia cita (`ignorarIds`), y el cruce que el
 * candado tiene que ver antes y después de crear (17/09/2026).
 *
 * El reloj es un parámetro: `AHORA` es una fecha base fija (miércoles 30/09/2026, 10:00 en La Paz).
 * Ninguna prueba mira el reloj real, así no caducan (memoria «pruebas con fechas fijas caducan»).
 *
 * La librería es JavaScript plano para un nodo Code de n8n. Se evalúa con el mismo ayudante que las
 * demás suites de flujos (`./lib/flujo`, que lleva la marca de Semgrep y le quita al código los
 * globales que el sandbox de n8n no tiene: `URL`, `Buffer`, `crypto`, `process`, `require`…). Si la
 * librería usara alguno, aquí reventaría igual que en producción.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar } from './lib/flujo';

const RUTA = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/agenda-minima/src/lib/agenda.js');
const FUENTE = readFileSync(RUTA, 'utf8');

const NOMBRES = [
  'fechaLocal', 'horaLocal', 'diaDeLaSemana', 'isoLocal', 'msDe', 'sumarDias', 'etiquetaDeHueco', 'textoDeFecha',
  'tramosDelDia', 'ocupados', 'huecosDelDia', 'ofertaDeHuecos', 'rangoALeer', 'hayCruce', 'tituloDeLaCita',
  'descripcionDeLaCita', 'citasDelTelefono', 'idDeBoton', 'leerIdDeBoton', 'partirNombre',
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
const L = ejecutar(`${FUENTE}\nreturn [{ json: { ${NOMBRES.join(', ')}, TZ_OFFSET_MIN } }];`, [{}])[0] as
  Record<(typeof NOMBRES)[number], Fn> & { TZ_OFFSET_MIN: number };

// --- El mundo de las pruebas ------------------------------------------------------------------
// Miércoles 30/09/2026. Jueves 01/10, viernes 02/10, sábado 03/10, domingo 04/10, lunes 05/10.
const MIE = '2026-09-30';
const JUE = '2026-10-01';
const VIE = '2026-10-02';
const SAB = '2026-10-03';
const DOM = '2026-10-04';
const LUN = '2026-10-05';
const MAR = '2026-10-06';

/** Instante de una hora de La Paz, calculado con aritmética propia (independiente de la librería). */
const ms = (fecha: string, hhmm: string): number => {
  const [a, m, d] = fecha.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return Date.UTC(a!, m! - 1, d!, h! + 4, mi!);
};
const AHORA = ms(MIE, '10:00');

// El horario real de Bellido (`negocio-bellido.json`, `negocio.horarios`).
const BELLIDO = {
  _nota: 'De la ficha de WhatsApp Business del doctor.',
  lun: '11:00-18:00', mar: '11:00-18:00', mie: '11:00-18:00', jue: '14:00-18:00',
  vie: '11:00-18:00', sab: '09:00-12:00', dom: 'cerrado',
};
const CFG = { horario: BELLIDO, duracionPorDefectoMin: 30, anticipacionMinimaMin: 120, anticipacionMaximaDias: 60 };
// Un horario amplio y sencillo para probar la aritmética de los huecos.
const AMPLIO = { lun: '08:00-18:00', mar: '08:00-18:00', mie: '08:00-18:00', jue: '08:00-18:00', vie: '08:00-18:00', sab: '08:00-18:00', dom: 'cerrado' };

interface Ev { id: string; summary?: string; description?: string; status?: string; transparency?: string;
  start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string } }
const ev = (id: string, fecha: string, desde: string, hasta: string, extra: Partial<Ev> = {}): Ev => ({
  id, summary: `Cita ${id}`, status: 'confirmed',
  start: { dateTime: L.isoLocal(fecha, desde) }, end: { dateTime: L.isoLocal(fecha, hasta) }, ...extra,
});
const diaEntero = (id: string, desde: string, hasta: string, extra: Partial<Ev> = {}): Ev =>
  ({ id, summary: `Día ${id}`, start: { date: desde }, end: { date: hasta }, ...extra });
const horas = (huecos: { inicio: string }[]): string[] => huecos.map((h) => h.inicio.slice(11, 16));
const huecosAmplio = (eventos: Ev[], extra: Record<string, unknown> = {}, fecha = VIE) => L.huecosDelDia({
  eventos, fecha, horario: AMPLIO, duracionMin: 30, ahoraMs: AHORA, anticipacionMin: 0, franja: 'cualquiera', ...extra,
});
const oferta = (extra: Record<string, unknown> = {}) => L.ofertaDeHuecos({ eventos: [], cfg: CFG, ahoraMs: AHORA, ...extra });

/** Un lunes (05/10) tapado de 11:00 a 18:00 con 8 eventos seguidos. */
const LUNES_LLENO: Ev[] = [
  ev('a1', LUN, '11:00', '12:00'), ev('a2', LUN, '12:00', '13:00'), ev('a3', LUN, '13:00', '14:00'),
  ev('a4', LUN, '14:00', '15:00'), ev('a5', LUN, '15:00', '16:00'), ev('a6', LUN, '16:00', '17:00'),
  ev('a7', LUN, '17:00', '17:30'), ev('a8', LUN, '17:30', '18:00'),
];
/** El mismo lunes, pero el de 15:00 a 16:00 se parte: queda libre SOLO el hueco de 15:00 a 15:30. */
const LUNES_UNA_HORA: Ev[] = [...LUNES_LLENO.filter((e) => e.id !== 'a5'), ev('a5b', LUN, '15:30', '16:00')];

const TEL = '59170000001';
const TEL_PREFIJO = '5917000000'; // prefijo de TEL: no es el mismo teléfono
const TEL_OTRO = '59170000002';

// =============================================================================================
describe('la librería es apta para un nodo Code de n8n', () => {
  const codigo = FUENTE.split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/ .*$/, '')).join('\n');

  it('sin módulos, sin globales de Node, sin reloj y sin Intl (el tiempo entra por ahoraMs)', () => {
    expect(codigo).not.toMatch(/\brequire\b|^\s*(import|export)\b|\bmodule\.exports\b/m);
    expect(codigo).not.toMatch(/\bURL\b|\bBuffer\b|\bcrypto\b|\bprocess\b|\bIntl\b|\bsetTimeout\b|\bfetch\b/);
    expect(codigo).not.toMatch(/Date\.now\b|new Date\(\s*\)|toLocale|getTimezoneOffset|getHours|getDate\(|getDay\(/);
  });
  it('declara con esos nombres exactos todas las funciones del contrato', () => {
    for (const n of NOMBRES) {
      expect(typeof L[n], n).toBe('function');
      expect(FUENTE, n).toMatch(new RegExp(`^function ${n}\\(`, 'm'));
    }
    expect(L.TZ_OFFSET_MIN).toBe(-240);
  });
  it('da el mismo resultado sea cual sea la zona del proceso (todo es aritmética con desplazamiento fijo)', () => {
    // Un instante a las 23:30 de La Paz: si dependiera de la zona del proceso, cambiaría el día.
    expect(L.fechaLocal(ms(MIE, '23:30'))).toBe(MIE);
    expect(L.horaLocal(ms(MIE, '23:30'))).toBe('23:30');
  });
});

// =============================================================================================
describe('fechas en La Paz (UTC-4 fijo)', () => {
  it('diaDeLaSemana', () => {
    expect(L.diaDeLaSemana(MIE)).toBe('miércoles');
    expect(L.diaDeLaSemana(JUE)).toBe('jueves');
    expect(L.diaDeLaSemana(SAB)).toBe('sábado');
    expect(L.diaDeLaSemana(DOM)).toBe('domingo');
    expect(L.diaDeLaSemana(LUN)).toBe('lunes');
    // Niega: una fecha que no existe no tiene día de la semana.
    expect(L.diaDeLaSemana('2026-02-30')).toBeNull();
    expect(L.diaDeLaSemana('mañana')).toBeNull();
    expect(L.diaDeLaSemana('')).toBeNull();
    expect(L.diaDeLaSemana(JUE)).not.toBe('viernes');
  });

  it('el cruce de medianoche UTC: las 23:30 de La Paz siguen siendo ese día local', () => {
    const t = Date.UTC(2026, 9, 1, 3, 30); // 03:30Z del 01/10 = 23:30 del 30/09 en La Paz
    expect(L.fechaLocal(t)).toBe(MIE);
    expect(L.horaLocal(t)).toBe('23:30');
    // Niega: 30 minutos después ya es el día siguiente, a las 00:00.
    expect(L.fechaLocal(t + 30 * 60000)).toBe(JUE);
    expect(L.horaLocal(t + 30 * 60000)).toBe('00:00');
    // Y las 04:00 UTC, que en UTC ya son del día siguiente, en La Paz son las 00:00 de ese día.
    expect(L.fechaLocal(Date.UTC(2026, 9, 1, 3, 59))).toBe(MIE);
    // Una hora cualquiera del día, en punto de La Paz (14:00Z = 10:00).
    expect(L.horaLocal(AHORA)).toBe('10:00');
    expect(L.fechaLocal(AHORA)).toBe(MIE);
  });

  it('isoLocal y msDe: ida y vuelta, siempre con -04:00', () => {
    expect(L.isoLocal(JUE, '15:00')).toBe('2026-10-01T15:00:00-04:00');
    expect(L.isoLocal(JUE, '9:05')).toBe('2026-10-01T09:05:00-04:00');
    expect(L.msDe('2026-10-01T15:00:00-04:00')).toBe(ms(JUE, '15:00'));
    expect(L.msDe('2026-10-01T19:00:00Z')).toBe(ms(JUE, '15:00'));
    expect(L.msDe('2026-10-01T15:00:00.000-04:00')).toBe(ms(JUE, '15:00'));
    // Sin desplazamiento se toma como La Paz, nunca la zona del proceso.
    expect(L.msDe('2026-10-01T15:00:00')).toBe(ms(JUE, '15:00'));
    expect(L.msDe(JUE)).toBe(ms(JUE, '00:00'));
    expect(L.msDe(123)).toBe(123);
    // Niega: un texto que no es una fecha no es un instante.
    expect(Number.isNaN(L.msDe('hoy a las tres'))).toBe(true);
    expect(L.msDe('2026-10-01T15:00:00-04:00')).not.toBe(ms(JUE, '16:00'));
    expect(L.fechaLocal(L.msDe(L.isoLocal(JUE, '23:30')))).toBe(JUE);
  });

  it('sumarDias cruza mes y año, y respeta el año bisiesto', () => {
    expect(L.sumarDias(MIE, 1)).toBe(JUE);
    expect(L.sumarDias(MIE, 2)).toBe(VIE);
    expect(L.sumarDias('2026-09-30', 1)).toBe('2026-10-01');
    expect(L.sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(L.sumarDias('2027-01-01', -1)).toBe('2026-12-31');
    expect(L.sumarDias('2028-02-28', 1)).toBe('2028-02-29');
    expect(L.sumarDias('2027-02-28', 1)).toBe('2027-03-01');
    expect(L.sumarDias(JUE, 0)).toBe(JUE);
    expect(L.sumarDias(JUE, 14)).toBe('2026-10-15');
  });

  it('etiquetaDeHueco: «Jue 15:00», de 20 caracteres o menos', () => {
    expect(L.etiquetaDeHueco(L.isoLocal(JUE, '15:00'))).toBe('Jue 15:00');
    expect(L.etiquetaDeHueco(L.isoLocal(MIE, '09:30'))).toBe('Mié 09:30');
    expect(L.etiquetaDeHueco(L.isoLocal(SAB, '11:00'))).toBe('Sáb 11:00');
    // La hora es la de La Paz aunque el ISO venga en UTC.
    expect(L.etiquetaDeHueco('2026-10-01T03:30:00Z')).toBe('Mié 23:30');
    // Niega: ningún día de la semana pasa de 20 caracteres.
    for (let i = 0; i < 7; i++) {
      expect(L.etiquetaDeHueco(L.isoLocal(L.sumarDias(MIE, i), '17:30')).length).toBeLessThanOrEqual(20);
    }
    expect(L.etiquetaDeHueco(L.isoLocal(JUE, '15:00'))).not.toContain('Vie');
    expect(L.etiquetaDeHueco('no es una fecha')).toBe('');
  });

  it('textoDeFecha: «jueves 1 de octubre a las 15:00»', () => {
    expect(L.textoDeFecha(L.isoLocal(JUE, '15:00'))).toBe('jueves 1 de octubre a las 15:00');
    expect(L.textoDeFecha(L.isoLocal(MIE, '09:30'))).toBe('miércoles 30 de septiembre a las 09:30');
    expect(L.textoDeFecha('2026-10-01T03:30:00Z')).toBe('miércoles 30 de septiembre a las 23:30');
    expect(L.textoDeFecha(L.isoLocal(JUE, '15:00'))).not.toContain('viernes');
  });
});

// =============================================================================================
describe('tramosDelDia: las formas del horario', () => {
  it('la forma real de Bellido: un texto «HH:MM-HH:MM» por día, con el jueves desde las 14:00', () => {
    expect(L.tramosDelDia(BELLIDO, LUN)).toEqual([{ desde: '11:00', hasta: '18:00' }]);
    expect(L.tramosDelDia(BELLIDO, JUE)).toEqual([{ desde: '14:00', hasta: '18:00' }]);
    expect(L.tramosDelDia(BELLIDO, SAB)).toEqual([{ desde: '09:00', hasta: '12:00' }]);
    // Niega: el jueves NO empieza a las 11:00.
    expect(L.tramosDelDia(BELLIDO, JUE)).not.toEqual([{ desde: '11:00', hasta: '18:00' }]);
  });
  it('un día «cerrado» no tiene tramos, con cualquier mayúscula', () => {
    expect(L.tramosDelDia(BELLIDO, DOM)).toEqual([]);
    expect(L.tramosDelDia({ dom: 'Cerrada' }, DOM)).toEqual([]);
    expect(L.tramosDelDia({ dom: 'CERRADO' }, DOM)).toEqual([]);
  });
  it('un día con dos tramos (coma o punto y coma) sale en orden', () => {
    const esperado = [{ desde: '09:00', hasta: '12:00' }, { desde: '14:00', hasta: '18:00' }];
    expect(L.tramosDelDia({ lun: '09:00-12:00, 14:00-18:00' }, LUN)).toEqual(esperado);
    expect(L.tramosDelDia({ lun: '14:00-18:00;09:00-12:00' }, LUN)).toEqual(esperado);
    expect(L.tramosDelDia({ lun: '09:00 a 12:00, 14:00 – 18:00' }, LUN)).toEqual(esperado);
    // Niega: un solo tramo no inventa el segundo.
    expect(L.tramosDelDia({ lun: '09:00-12:00' }, LUN)).toHaveLength(1);
  });
  it('acepta, por tolerancia, listas, objetos, claves largas y el horario como texto JSON', () => {
    const esperado = [{ desde: '09:00', hasta: '12:00' }, { desde: '14:00', hasta: '18:00' }];
    expect(L.tramosDelDia({ lun: ['09:00-12:00', '14:00-18:00'] }, LUN)).toEqual(esperado);
    expect(L.tramosDelDia({ lun: [{ desde: '09:00', hasta: '12:00' }, { desde: '14:00', hasta: '18:00' }] }, LUN)).toEqual(esperado);
    expect(L.tramosDelDia({ lun: { abre: '09:00', cierra: '12:00' } }, LUN)).toEqual([esperado[0]]);
    expect(L.tramosDelDia({ lunes: '09:00-12:00' }, LUN)).toEqual([esperado[0]]);
    expect(L.tramosDelDia({ mie: '09:00-12:00' }, MIE)).toEqual([esperado[0]]);
    expect(L.tramosDelDia({ miércoles: '09:00-12:00' }, MIE)).toEqual([esperado[0]]);
    expect(L.tramosDelDia(JSON.stringify({ lun: '09:00-12:00' }), LUN)).toEqual([esperado[0]]);
    expect(L.tramosDelDia({ lun: [] }, LUN)).toEqual([]);
    expect(L.tramosDelDia({ lun: null }, LUN)).toEqual([]);
  });
  it('falla cerrado: un día que falta, un texto ilegible o un horario roto no ofrecen nada', () => {
    expect(L.tramosDelDia({ lun: '09:00-12:00' }, MAR)).toEqual([]);
    expect(L.tramosDelDia({ lun: 'por la mañana' }, LUN)).toEqual([]);
    expect(L.tramosDelDia({ lun: '18:00-09:00' }, LUN)).toEqual([]);
    expect(L.tramosDelDia({ lun: '25:00-26:00' }, LUN)).toEqual([]);
    expect(L.tramosDelDia({}, LUN)).toEqual([]);
    expect(L.tramosDelDia(null, LUN)).toEqual([]);
    expect(L.tramosDelDia(undefined, LUN)).toEqual([]);
    expect(L.tramosDelDia('{no es json', LUN)).toEqual([]);
    expect(L.tramosDelDia(BELLIDO, 'no es fecha')).toEqual([]);
    // Una clave suelta como `_nota` no es un día.
    expect(L.tramosDelDia({ _nota: '09:00-12:00' }, LUN)).toEqual([]);
  });
});

// =============================================================================================
describe('ocupados', () => {
  it('convierte cada evento en un intervalo con su id', () => {
    const r = L.ocupados([ev('e1', VIE, '10:00', '10:30')]);
    expect(r).toEqual([{ inicioMs: ms(VIE, '10:00'), finMs: ms(VIE, '10:30'), id: 'e1' }]);
  });
  it('ignora los cancelados y los `transparent`; niega: un confirmado o `opaque` sí cuenta', () => {
    const r = L.ocupados([
      ev('cancelado', VIE, '10:00', '10:30', { status: 'cancelled' }),
      ev('libre', VIE, '11:00', '11:30', { transparency: 'transparent' }),
      ev('firme', VIE, '12:00', '12:30'),
      ev('opaco', VIE, '13:00', '13:30', { transparency: 'opaque' }),
    ]);
    expect(r.map((o: { id: string }) => o.id)).toEqual(['firme', 'opaco']);
  });
  it('un evento de día entero ocupa el día local completo (el fin es exclusivo)', () => {
    const [o] = L.ocupados([diaEntero('d1', VIE, SAB)]);
    expect(o.inicioMs).toBe(ms(VIE, '00:00'));
    expect(o.finMs).toBe(ms(SAB, '00:00'));
    // Sin `end` se toma un día.
    const [p] = L.ocupados([{ id: 'd2', start: { date: VIE }, end: {} }]);
    expect(p.finMs - p.inicioMs).toBe(24 * 3600000);
    // Niega: no ocupa el día siguiente.
    expect(o.finMs).toBeLessThanOrEqual(ms(SAB, '00:00'));
  });
  it('`ignorarIds` saca del cálculo solo esos ids', () => {
    const eventos = [ev('propia', VIE, '10:00', '10:30'), ev('ajena', VIE, '11:00', '11:30')];
    expect(L.ocupados(eventos, { ignorarIds: ['propia'] }).map((o: { id: string }) => o.id)).toEqual(['ajena']);
    expect(L.ocupados(eventos, { ignorarIds: [] })).toHaveLength(2);
    expect(L.ocupados(eventos, {})).toHaveLength(2);
    expect(L.ocupados(eventos)).toHaveLength(2);
  });
  it('un fin ilegible se toma de 30 minutos (falla cerrado); sin inicio legible se omite; basura no revienta', () => {
    const [o] = L.ocupados([{ id: 'x', start: { dateTime: L.isoLocal(VIE, '10:00') }, end: {} }]);
    expect(o.finMs - o.inicioMs).toBe(30 * 60000);
    expect(L.ocupados([{ id: 'y', start: {}, end: {} }, null, 'texto', { id: 'z' }])).toEqual([]);
    expect(L.ocupados(undefined)).toEqual([]);
    expect(L.ocupados([])).toEqual([]);
  });
});

// =============================================================================================
describe('huecosDelDia', () => {
  it('un evento de 10:00 a 10:30 bloquea el hueco de 10:00, pero no los de 09:30 ni 10:30', () => {
    const h = horas(huecosAmplio([ev('e1', VIE, '10:00', '10:30')]));
    expect(h).not.toContain('10:00');
    expect(h).toContain('09:30');
    expect(h).toContain('10:30');
    // Niega: sin el evento, las 10:00 están libres.
    expect(horas(huecosAmplio([]))).toContain('10:00');
  });
  it('un evento de 10:15 a 10:45 bloquea 10:00 y 10:30', () => {
    const h = horas(huecosAmplio([ev('e1', VIE, '10:15', '10:45')]));
    expect(h).not.toContain('10:00');
    expect(h).not.toContain('10:30');
    expect(h).toContain('09:30');
    expect(h).toContain('11:00');
  });
  it('los eventos en formato UTC (Z) bloquean la hora local que les corresponde', () => {
    const e: Ev = { id: 'z', start: { dateTime: '2026-10-02T14:00:00.000Z' }, end: { dateTime: '2026-10-02T14:30:00.000Z' } };
    expect(horas(huecosAmplio([e]))).not.toContain('10:00');
    expect(horas(huecosAmplio([e]))).toContain('09:30');
  });
  it('solo en punto o y media, aunque el tramo empiece a las 08:10', () => {
    const r = L.huecosDelDia({ eventos: [], fecha: VIE, horario: { vie: '08:10-09:45' }, duracionMin: 30, ahoraMs: AHORA });
    expect(horas(r)).toEqual(['08:30', '09:00']);
    for (const h of huecosAmplio([])) expect(h.inicio).toMatch(/T\d{2}:(00|30):00-04:00$/);
    // Niega: ni siquiera con un evento de 10:15 aparece una hora en :15 o :45.
    for (const h of huecosAmplio([ev('e1', VIE, '10:15', '10:45')])) expect(h.inicio).not.toMatch(/:(15|45):00-/);
  });
  it('la cita entera cabe antes del fin del tramo', () => {
    const tramo = { vie: '09:00-10:00' };
    const con = (duracionMin: number) => horas(L.huecosDelDia({ eventos: [], fecha: VIE, horario: tramo, duracionMin, ahoraMs: AHORA }));
    expect(con(30)).toEqual(['09:00', '09:30']);
    expect(con(45)).toEqual(['09:00']); // 09:30 + 45 min se pasa de las 10:00
    expect(con(60)).toEqual(['09:00']);
    expect(con(90)).toEqual([]);
    // El fin de cada hueco es inicio + duración.
    const [h] = L.huecosDelDia({ eventos: [], fecha: VIE, horario: tramo, duracionMin: 45, ahoraMs: AHORA });
    expect(h.fin).toBe(L.isoLocal(VIE, '09:45'));
  });
  it('un hueco que termina justo a las 18:00 vale; con dos tramos no se ofrece lo que queda entre ellos', () => {
    const h = horas(L.huecosDelDia({ eventos: [], fecha: VIE, horario: { vie: '09:00-10:00, 14:00-15:00' }, duracionMin: 30, ahoraMs: AHORA }));
    expect(h).toEqual(['09:00', '09:30', '14:00', '14:30']);
    expect(horas(huecosAmplio([])).slice(-1)).toEqual(['17:30']);
  });
  it('un día cerrado no tiene huecos', () => {
    expect(huecosAmplio([], {}, DOM)).toEqual([]);
    expect(L.huecosDelDia({ eventos: [], fecha: DOM, horario: BELLIDO, duracionMin: 30, ahoraMs: AHORA })).toEqual([]);
    // Niega: el sábado del mismo horario sí abre.
    expect(horas(L.huecosDelDia({ eventos: [], fecha: SAB, horario: BELLIDO, duracionMin: 30, ahoraMs: AHORA })))
      .toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
  });
  it('anticipación mínima: no se ofrece antes de ahora más `anticipacionMin`', () => {
    const hoy = (anticipacionMin: number) => horas(huecosAmplio([], { fecha: MIE, anticipacionMin }, MIE));
    // Son las 10:00. Con 120 min, la primera es la de las 12:00 (justo en el límite vale).
    expect(hoy(120)[0]).toBe('12:00');
    expect(hoy(120)).not.toContain('11:30');
    expect(hoy(0)[0]).toBe('10:00');
    expect(hoy(45)[0]).toBe('11:00');
    // Un día futuro no lo afecta.
    expect(horas(huecosAmplio([], { anticipacionMin: 120 }, VIE))[0]).toBe('08:00');
  });
  it('franja: mañana es antes de las 12:00, tarde desde las 12:00', () => {
    const franja = (f: string) => horas(huecosAmplio([], { franja: f }));
    expect(franja('manana')[0]).toBe('08:00');
    expect(franja('manana').slice(-1)).toEqual(['11:30']);
    expect(franja('tarde')[0]).toBe('12:00');
    expect(franja('tarde').slice(-1)).toEqual(['17:30']);
    expect(franja('cualquiera')).toHaveLength(franja('manana').length + franja('tarde').length);
    // Niega: cada franja excluye a la otra.
    expect(franja('manana')).not.toContain('12:00');
    expect(franja('tarde')).not.toContain('11:30');
    // Una franja desconocida es «cualquiera».
    expect(franja('noche')).toEqual(franja('cualquiera'));
  });
  it('`ignorarIds`: la cita propia no bloquea su hueco; la ajena sí', () => {
    const eventos = [ev('propia', VIE, '10:00', '10:30'), ev('ajena', VIE, '11:00', '11:30')];
    const h = horas(huecosAmplio(eventos, { ignorarIds: ['propia'] }));
    expect(h).toContain('10:00');
    expect(h).not.toContain('11:00');
    expect(horas(huecosAmplio(eventos))).not.toContain('10:00');
  });
  it('un evento de día entero tapa todo el día; cancelado o `transparent` no tapa nada', () => {
    expect(huecosAmplio([diaEntero('d', VIE, SAB)])).toEqual([]);
    expect(huecosAmplio([diaEntero('d', VIE, SAB, { status: 'cancelled' })]).length).toBeGreaterThan(0);
    expect(huecosAmplio([diaEntero('d', VIE, SAB, { transparency: 'transparent' })]).length).toBeGreaterThan(0);
    // El día siguiente al del evento sigue libre.
    expect(huecosAmplio([diaEntero('d', VIE, SAB)], {}, SAB).length).toBeGreaterThan(0);
  });
  it('cada hueco trae inicio, fin y etiqueta, en orden', () => {
    const r = L.huecosDelDia({ eventos: [], fecha: JUE, horario: BELLIDO, duracionMin: 30, ahoraMs: AHORA });
    expect(r[0]).toEqual({ inicio: L.isoLocal(JUE, '14:00'), fin: L.isoLocal(JUE, '14:30'), etiqueta: 'Jue 14:00' });
    expect(horas(r)).toEqual(['14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30']);
    expect(L.huecosDelDia({ eventos: [], fecha: 'jueves', horario: BELLIDO, duracionMin: 30, ahoraMs: AHORA })).toEqual([]);
  });
});

// =============================================================================================
describe('ofertaDeHuecos', () => {
  describe('desde mañana; hoy solo si lo pide (P12)', () => {
    it('sin fecha, la oferta empieza mañana', () => {
      const r = oferta();
      expect(r.dia).toBe(JUE);
      expect(horas(r.huecos)).toEqual(['14:00', '14:30', '15:00']); // el jueves empieza a las 14:00
      expect(r.aviso).toBeNull();
      expect(r.diaPedido).toBeNull();
      // Niega: no ofrece nada de hoy, aunque hoy tenga huecos y cumplan la anticipación.
      expect(r.huecos.every((h: { inicio: string }) => !h.inicio.startsWith(MIE))).toBe(true);
    });
    it('hoy solo con `pidioHoy`, respetando la anticipación mínima (son las 10:00: desde las 12:00)', () => {
      const r = oferta({ pidioHoy: true });
      expect(r.dia).toBe(MIE);
      expect(horas(r.huecos)).toEqual(['12:00', '12:30', '13:00']);
      expect(r.aviso).toBeNull();
      // Niega: `pidioHoy` falso o ausente no lo trae.
      expect(oferta({ pidioHoy: false }).dia).toBe(JUE);
    });
    it('hoy también si `fechaPreferida` es hoy', () => {
      const r = oferta({ fechaPreferida: MIE });
      expect(r.dia).toBe(MIE);
      expect(r.diaPedido).toBe(MIE);
      expect(horas(r.huecos)[0]).toBe('12:00');
    });
    it('si pidió hoy y ya no queda nada (17:30 + 2 h), lo dice y ofrece mañana', () => {
      const tarde = ms(MIE, '17:30');
      const r = oferta({ pidioHoy: true, ahoraMs: tarde });
      expect(r.aviso).toBe('dia_lleno');
      expect(r.diaPedido).toBe(MIE);
      expect(r.dia).toBe(JUE);
      // Niega: sin pedir hoy, no hay aviso alguno.
      expect(oferta({ ahoraMs: tarde }).aviso).toBeNull();
    });
    it('una fecha futura pedida se respeta', () => {
      const r = oferta({ fechaPreferida: VIE });
      expect(r.dia).toBe(VIE);
      expect(r.diaPedido).toBe(VIE);
      expect(horas(r.huecos)).toEqual(['11:00', '11:30', '12:00']);
    });
  });

  describe('día lleno', () => {
    it('8 eventos seguidos que tapan el día: aviso `dia_lleno` y los huecos del siguiente día con huecos', () => {
      const r = oferta({ eventos: LUNES_LLENO, fechaPreferida: LUN });
      expect(r.aviso).toBe('dia_lleno');
      expect(r.diaPedido).toBe(LUN);
      expect(r.dia).toBe(MAR);
      expect(horas(r.huecos)).toEqual(['11:00', '11:30', '12:00']);
      expect(r.franjaLlena).toBeUndefined();
    });
    it('un día con UNA hora libre NO es día lleno: esa hora se ofrece (el error de aritmética del modelo)', () => {
      const r = oferta({ eventos: LUNES_UNA_HORA, fechaPreferida: LUN });
      expect(r.aviso).toBeNull();
      expect(r.dia).toBe(LUN);
      expect(horas(r.huecos)).toEqual(['15:00']);
    });
    it('el día lleno se salta también el siguiente si está lleno', () => {
      const martesLleno = LUNES_LLENO.map((e, i) => ev(`m${i}`, MAR, e.start.dateTime!.slice(11, 16), e.end.dateTime!.slice(11, 16)));
      const r = oferta({ eventos: [...LUNES_LLENO, ...martesLleno], fechaPreferida: LUN });
      expect(r.aviso).toBe('dia_lleno');
      expect(r.dia).toBe('2026-10-07');
    });
    it('un evento de día entero lo llena; el fin exclusivo deja libre el día siguiente', () => {
      const r = oferta({ eventos: [diaEntero('feriado', VIE, SAB)], fechaPreferida: VIE });
      expect(r.aviso).toBe('dia_lleno');
      expect(r.dia).toBe(SAB);
      expect(horas(r.huecos)[0]).toBe('09:00');
    });
    it('si el día tiene lugar pero no en la franja pedida, sale `dia_lleno` con `franjaLlena` (el texto no debe decir que no queda nada en todo el día)', () => {
      const eventos = [ev('m1', LUN, '11:00', '12:00')]; // tapa toda la mañana del lunes (abre a las 11:00)
      const r = oferta({ eventos, fechaPreferida: LUN, franja: 'manana' });
      expect(r.aviso).toBe('dia_lleno');
      expect(r.franjaLlena).toBe(true);
      expect(r.dia).toBe(MAR);
      // Niega: la tarde de ese lunes sí tiene lugar, sin aviso.
      const t = oferta({ eventos, fechaPreferida: LUN, franja: 'tarde' });
      expect(t.aviso).toBeNull();
      expect(t.dia).toBe(LUN);
    });
  });

  describe('día cerrado y fechas fuera de lugar', () => {
    it('un domingo (cerrado): aviso `dia_cerrado` y los huecos del siguiente día abierto', () => {
      const r = oferta({ fechaPreferida: DOM });
      expect(r.aviso).toBe('dia_cerrado');
      expect(r.diaPedido).toBe(DOM);
      expect(r.dia).toBe(LUN);
      expect(horas(r.huecos)).toEqual(['11:00', '11:30', '12:00']);
      // Niega: el sábado (con horario) no es cerrado.
      expect(oferta({ fechaPreferida: SAB }).aviso).toBeNull();
    });
    it('una fecha pasada: aviso `fecha_pasada` y la oferta desde mañana', () => {
      const r = oferta({ fechaPreferida: '2026-09-28' });
      expect(r.aviso).toBe('fecha_pasada');
      expect(r.dia).toBe(JUE);
      expect(r.diaPedido).toBe('2026-09-28');
      expect(r.huecos.length).toBeGreaterThan(0);
    });
    it('más allá de `anticipacionMaximaDias`: `fuera_de_rango`, sin huecos; dentro del rango, no', () => {
      const r = oferta({ fechaPreferida: '2027-01-01' });
      expect(r.aviso).toBe('fuera_de_rango');
      expect(r.huecos).toEqual([]);
      expect(r.dia).toBeNull();
      const dentro = oferta({ fechaPreferida: '2026-11-20' });
      expect(dentro.aviso).toBeNull();
      expect(dentro.dia).toBe('2026-11-20');
    });
    it('sin ningún hueco en 14 días: `sin_huecos`', () => {
      const r = oferta({ eventos: [diaEntero('cierre', '2026-09-29', '2026-12-01')] });
      expect(r.aviso).toBe('sin_huecos');
      expect(r.huecos).toEqual([]);
      expect(r.dia).toBeNull();
      // Niega: si el cierre dura solo 5 días, se encuentra un hueco dentro de los 14.
      const corto = oferta({ eventos: [diaEntero('cierre', '2026-09-29', '2026-10-04')] });
      expect(corto.aviso).toBeNull();
      expect(corto.dia).toBe(LUN); // jueves a sábado tapados, domingo cerrado
    });
    it('un horario que no se entiende no ofrece nada (falla cerrado)', () => {
      const r = L.ofertaDeHuecos({ eventos: [], cfg: { ...CFG, horario: { lun: 'siempre' } }, ahoraMs: AHORA });
      expect(r.aviso).toBe('sin_huecos');
      expect(r.huecos).toEqual([]);
    });
  });

  describe('hora preferida («9 am»)', () => {
    it('libre: va primera y le siguen las más cercanas', () => {
      const r = oferta({ fechaPreferida: VIE, horaPreferida: '16:00' });
      expect(r.aviso).toBeNull();
      expect(r.huecos[0].inicio).toBe(L.isoLocal(VIE, '16:00'));
      expect(r.huecos).toHaveLength(3);
      expect(horas(r.huecos).slice(1).sort()).toEqual(['15:30', '16:30']);
    });
    it('ocupada: aviso `hora_ocupada` y las tres más cercanas, en orden de hora', () => {
      const r = oferta({ eventos: [ev('o1', VIE, '16:00', '16:30')], fechaPreferida: VIE, horaPreferida: '16:00' });
      expect(r.aviso).toBe('hora_ocupada');
      expect(r.dia).toBe(VIE);
      expect(horas(r.huecos)).toEqual(['15:00', '15:30', '16:30']);
      // Niega: la hora ocupada no se ofrece.
      expect(horas(r.huecos)).not.toContain('16:00');
    });
    it('una hora fuera del horario (las 9:00, el consultorio abre a las 11:00) tampoco se ofrece, y se ofrecen las más cercanas', () => {
      const r = oferta({ fechaPreferida: VIE, horaPreferida: '09:00' });
      expect(r.aviso).toBe('hora_ocupada');
      expect(horas(r.huecos)).toEqual(['11:00', '11:30', '12:00']);
    });
    it('acepta la hora sin cero a la izquierda y sin fecha (se aplica al primer día con huecos)', () => {
      const r = oferta({ horaPreferida: '4:00' });
      expect(r.aviso).toBe('hora_ocupada'); // 04:00 no existe en el horario del jueves
      expect(r.dia).toBe(JUE);
      const s = oferta({ horaPreferida: '15:00' });
      expect(s.dia).toBe(JUE);
      expect(s.huecos[0].inicio).toBe(L.isoLocal(JUE, '15:00'));
      expect(s.aviso).toBeNull();
    });
    it('una hora preferida ilegible se ignora', () => {
      const r = oferta({ fechaPreferida: VIE, horaPreferida: 'tarde' });
      expect(r.aviso).toBeNull();
      expect(horas(r.huecos)).toEqual(['11:00', '11:30', '12:00']);
    });
  });

  describe('franja y máximo', () => {
    it('franja mañana y tarde', () => {
      const m = oferta({ fechaPreferida: VIE, franja: 'manana' });
      expect(horas(m.huecos)).toEqual(['11:00', '11:30']); // el viernes abre a las 11:00: solo dos huecos antes del mediodía
      const t = oferta({ fechaPreferida: VIE, franja: 'tarde' });
      expect(horas(t.huecos)).toEqual(['12:00', '12:30', '13:00']);
      // Niega: la mañana no trae horas de la tarde y al revés.
      expect(horas(m.huecos)).not.toContain('12:00');
      expect(horas(t.huecos)).not.toContain('11:30');
    });
    it('el jueves no tiene mañana: la franja mañana busca el siguiente día que la tenga', () => {
      const r = oferta({ franja: 'manana' });
      expect(r.dia).toBe(VIE);
      expect(horas(r.huecos)).toEqual(['11:00', '11:30']);
    });
    it('`maximo`: 3 por defecto, y el que se pida', () => {
      expect(oferta({ fechaPreferida: VIE }).huecos).toHaveLength(3);
      expect(oferta({ fechaPreferida: VIE, maximo: 2 }).huecos).toHaveLength(2);
      expect(oferta({ fechaPreferida: VIE, maximo: 5 }).huecos).toHaveLength(5);
      expect(oferta({ fechaPreferida: VIE, maximo: 0 }).huecos).toHaveLength(3);
      expect(oferta({ fechaPreferida: VIE, maximo: 50 }).huecos).toHaveLength(14); // el viernes tiene 14 huecos
    });
  });

  describe('mover una cita: `ignorarIds`', () => {
    it('la cita propia no bloquea; sin `ignorarIds` el mismo lunes sigue lleno', () => {
      const eventos = LUNES_UNA_HORA.map((e) => e).concat([ev('propia', LUN, '15:00', '15:30')]);
      const sin = oferta({ eventos, fechaPreferida: LUN });
      expect(sin.aviso).toBe('dia_lleno');
      const con = oferta({ eventos, fechaPreferida: LUN, ignorarIds: ['propia'] });
      expect(con.aviso).toBeNull();
      expect(horas(con.huecos)).toEqual(['15:00']);
    });
  });

  it('es determinista: el mismo turno da la misma oferta, y no depende del reloj real', () => {
    const a = oferta({ fechaPreferida: VIE, horaPreferida: '12:30' });
    const b = oferta({ fechaPreferida: VIE, horaPreferida: '12:30' });
    expect(a).toEqual(b);
    // Con otro `ahoraMs` la oferta cambia: el reloj es un parámetro.
    expect(oferta({ ahoraMs: ms(VIE, '10:00') }).dia).toBe(SAB);
  });
});

// =============================================================================================
describe('rangoALeer', () => {
  it('sin fecha: desde el inicio de hoy hasta 14 días después, a las 00:00 de La Paz', () => {
    expect(L.rangoALeer({ ahoraMs: AHORA })).toEqual({ desde: L.isoLocal(MIE, '00:00'), hasta: L.isoLocal('2026-10-14', '00:00') });
  });
  it('con una fecha futura, parte de ella; con una pasada o sin fecha, de hoy', () => {
    expect(L.rangoALeer({ ahoraMs: AHORA, fechaPreferida: '2026-10-20' }))
      .toEqual({ desde: L.isoLocal('2026-10-20', '00:00'), hasta: L.isoLocal('2026-11-03', '00:00') });
    expect(L.rangoALeer({ ahoraMs: AHORA, fechaPreferida: '2026-09-01' }).desde).toBe(L.isoLocal(MIE, '00:00'));
    expect(L.rangoALeer({ ahoraMs: AHORA, fechaPreferida: MIE }).desde).toBe(L.isoLocal(MIE, '00:00'));
    expect(L.rangoALeer({ ahoraMs: AHORA, fechaPreferida: 'el jueves' }).desde).toBe(L.isoLocal(MIE, '00:00'));
  });
  it('`dias` cambia el ancho; lo que lee alcanza para lo que recorre la oferta', () => {
    expect(L.rangoALeer({ ahoraMs: AHORA, dias: 3 }).hasta).toBe(L.isoLocal('2026-10-03', '00:00'));
    const r = L.rangoALeer({ ahoraMs: AHORA });
    // El último día que recorre la oferta sin fecha (mañana + 13) cae dentro del rango leído.
    expect(L.msDe(L.isoLocal(L.sumarDias(MIE, 14), '23:59'))).toBeLessThanOrEqual(L.msDe(r.hasta) + 24 * 3600000);
    expect(L.msDe(L.isoLocal(L.sumarDias(MIE, 13), '23:59'))).toBeLessThan(L.msDe(r.hasta));
    // Niega: no lee para atrás.
    expect(L.msDe(r.desde)).toBeLessThanOrEqual(AHORA);
  });
});

// =============================================================================================
describe('hayCruce: el candado', () => {
  const E = [ev('e1', VIE, '10:00', '10:30')];
  const cruce = (inicio: string, fin: string, extra: Record<string, unknown> = {}, eventos: Ev[] = E) =>
    L.hayCruce({ eventos, inicio: L.isoLocal(VIE, inicio), fin: L.isoLocal(VIE, fin), ...extra });

  it('antes de crear: el mismo intervalo, o uno que lo pisa, cruza y dice con quién', () => {
    expect(cruce('10:00', '10:30')).toEqual({ cruce: true, con: ['e1'] });
    expect(cruce('10:15', '10:45')).toEqual({ cruce: true, con: ['e1'] });
    expect(cruce('09:45', '10:15').cruce).toBe(true);
    expect(cruce('09:00', '11:00').cruce).toBe(true);
  });
  it('niega: pegado por antes o por después no cruza', () => {
    expect(cruce('09:30', '10:00')).toEqual({ cruce: false, con: [] });
    expect(cruce('10:30', '11:00')).toEqual({ cruce: false, con: [] });
    expect(cruce('14:00', '14:30').cruce).toBe(false);
    expect(L.hayCruce({ eventos: [], inicio: L.isoLocal(VIE, '10:00'), fin: L.isoLocal(VIE, '10:30') }).cruce).toBe(false);
  });
  it('después de crear: el evento propio (`exceptoId`) no cuenta, pero otro que se cruza sí', () => {
    const conPropio = [...E, ev('propio', VIE, '10:00', '10:30')];
    // El propio y el ajeno ocupan lo mismo: el candado ve al ajeno.
    expect(cruce('10:00', '10:30', { exceptoId: 'propio' }, conPropio)).toEqual({ cruce: true, con: ['e1'] });
    // Sin ajeno, el propio solo no se cruza consigo mismo.
    expect(cruce('10:00', '10:30', { exceptoId: 'propio' }, [ev('propio', VIE, '10:00', '10:30')])).toEqual({ cruce: false, con: [] });
    // Niega: si no se pasa `exceptoId`, el propio se cruza consigo mismo (así se ve antes de crear).
    expect(cruce('10:00', '10:30', {}, [ev('propio', VIE, '10:00', '10:30')]).cruce).toBe(true);
    expect(cruce('10:00', '10:30', { exceptoId: '' }, [ev('propio', VIE, '10:00', '10:30')]).cruce).toBe(true);
  });
  it('los eventos cancelados o `transparent` no cruzan; el de día entero sí', () => {
    expect(cruce('10:00', '10:30', {}, [ev('c', VIE, '10:00', '10:30', { status: 'cancelled' })]).cruce).toBe(false);
    expect(cruce('10:00', '10:30', {}, [ev('t', VIE, '10:00', '10:30', { transparency: 'transparent' })]).cruce).toBe(false);
    expect(cruce('10:00', '10:30', {}, [diaEntero('d', VIE, SAB)])).toEqual({ cruce: true, con: ['d'] });
    expect(cruce('10:00', '10:30', {}, [diaEntero('d', SAB, DOM)]).cruce).toBe(false);
  });
  it('varios cruces: los da todos', () => {
    const r = cruce('10:00', '11:00', {}, [ev('a', VIE, '10:00', '10:30'), ev('b', VIE, '10:30', '11:00'), ev('c', VIE, '11:00', '11:30')]);
    expect(r).toEqual({ cruce: true, con: ['a', 'b'] });
  });
  it('falla cerrado: un intervalo ilegible o al revés cuenta como cruce', () => {
    expect(L.hayCruce({ eventos: [], inicio: 'mañana', fin: 'luego' }).cruce).toBe(true);
    expect(cruce('11:00', '10:00', {}, []).cruce).toBe(true);
    expect(cruce('10:00', '10:00', {}, []).cruce).toBe(true);
  });
  it('el caso del 17/09: crear sobre una hora ocupada que la oferta ya no ve libre', () => {
    // La oferta no incluye la hora ocupada; el candado, además, la rechaza si alguien la fuerza.
    const oc = [ev('o', VIE, '16:00', '16:30')];
    expect(horas(oferta({ eventos: oc, fechaPreferida: VIE, horaPreferida: '16:00' }).huecos)).not.toContain('16:00');
    expect(cruce('16:00', '16:30', {}, oc).cruce).toBe(true);
  });
});

// =============================================================================================
describe('tituloDeLaCita: «Apellidos, Nombres (CNS)» / «(RN)»', () => {
  const ANA = { apellidos: 'Pérez Gómez', nombres: 'Ana' };
  it('control del niño sano lleva (CNS); recién nacido, (RN)', () => {
    expect(L.tituloDeLaCita({ pacientes: [ANA], servicio: 'control_nino_sano' })).toBe('Pérez Gómez, Ana (CNS)');
    expect(L.tituloDeLaCita({ pacientes: [ANA], servicio: 'control_recien_nacido' })).toBe('Pérez Gómez, Ana (RN)');
    // Niega: cada servicio lleva SOLO su marca.
    expect(L.tituloDeLaCita({ pacientes: [ANA], servicio: 'control_nino_sano' })).not.toContain('(RN)');
    expect(L.tituloDeLaCita({ pacientes: [ANA], servicio: 'control_recien_nacido' })).not.toContain('(CNS)');
  });
  it('reconoce el servicio aunque venga escrito como en el catálogo', () => {
    expect(L.tituloDeLaCita({ pacientes: [ANA], servicio: 'control-del-nino-sano' })).toBe('Pérez Gómez, Ana (CNS)');
    expect(L.tituloDeLaCita({ pacientes: [ANA], servicio: 'Control del niño sano' })).toBe('Pérez Gómez, Ana (CNS)');
    expect(L.tituloDeLaCita({ pacientes: [ANA], servicio: 'Control del recién nacido' })).toBe('Pérez Gómez, Ana (RN)');
  });
  it('un servicio desconocido o ausente no lleva marca (nunca se inventa una)', () => {
    expect(L.tituloDeLaCita({ pacientes: [ANA], servicio: 'consulta_general' })).toBe('Pérez Gómez, Ana');
    expect(L.tituloDeLaCita({ pacientes: [ANA] })).toBe('Pérez Gómez, Ana');
  });
  it('hermanos del mismo apellido: «Pérez Gómez, Ana y Luis (CNS)»', () => {
    const r = L.tituloDeLaCita({ pacientes: [ANA, { apellidos: 'Pérez Gómez', nombres: 'Luis' }], servicio: 'control_nino_sano' });
    expect(r).toBe('Pérez Gómez, Ana y Luis (CNS)');
    // El mismo apellido con otra mayúscula o sin tilde es el mismo apellido.
    expect(L.tituloDeLaCita({ pacientes: [ANA, { apellidos: 'PEREZ GOMEZ', nombres: 'Luis' }], servicio: 'control_nino_sano' }))
      .toBe('Pérez Gómez, Ana y Luis (CNS)');
  });
  it('hermanos de apellidos distintos: «Pérez, Ana / Rojas, Luis (CNS)»', () => {
    const r = L.tituloDeLaCita({ pacientes: [{ apellidos: 'Pérez', nombres: 'Ana' }, { apellidos: 'Rojas', nombres: 'Luis' }], servicio: 'control_nino_sano' });
    expect(r).toBe('Pérez, Ana / Rojas, Luis (CNS)');
    expect(r).not.toContain(' y ');
    // Uno solo con apellido y el otro sin él: no se pueden juntar.
    expect(L.tituloDeLaCita({ pacientes: [ANA, { apellidos: '', nombres: 'Luis' }], servicio: 'control_nino_sano' }))
      .toBe('Pérez Gómez, Ana / Luis (CNS)');
  });
  it('un paciente sin apellido, sin nombre o sin nada', () => {
    expect(L.tituloDeLaCita({ pacientes: [{ apellidos: '', nombres: 'Ana' }], servicio: 'control_nino_sano' })).toBe('Ana (CNS)');
    expect(L.tituloDeLaCita({ pacientes: [{ apellidos: 'Pérez', nombres: '' }], servicio: 'control_recien_nacido' })).toBe('Pérez (RN)');
    // Sin nombre no hay título: no se agenda «(CNS)» a secas.
    expect(L.tituloDeLaCita({ pacientes: [], servicio: 'control_nino_sano' })).toBe('');
    expect(L.tituloDeLaCita({ pacientes: [{ apellidos: ' ', nombres: '' }], servicio: 'control_nino_sano' })).toBe('');
    expect(L.tituloDeLaCita({ servicio: 'control_nino_sano' })).toBe('');
  });
  it('limpia espacios y paréntesis del nombre para no confundir la marca (los lee «Comprobar reserva»)', () => {
    expect(L.tituloDeLaCita({ pacientes: [{ apellidos: '  Pérez   Gómez ', nombres: 'Ana (CNS)' }], servicio: 'control_nino_sano' }))
      .toBe('Pérez Gómez, Ana CNS (CNS)');
    expect(L.tituloDeLaCita({ pacientes: [ANA], servicio: 'control_nino_sano' }).match(/\(/g)).toHaveLength(1);
  });
  it('la descripción usa el MISMO formato que el flujo vivo: «Cliente», «Telefono», «Agendado por NovuChat.»', () => {
    const d = L.descripcionDeLaCita({ telefono: TEL, servicio: 'control_nino_sano', pacientes: [ANA], nombrePerfil: 'Mamá de Ana' });
    const lineas = d.split('\n');
    // Lo que escribe `agendar_cita` de Bellido, letra por letra: las tres líneas, en ese orden.
    expect(lineas[0]).toBe('Cliente: Mamá de Ana');
    expect(lineas[1]).toBe(`Telefono: ${TEL}`);
    expect(lineas[lineas.length - 1]).toBe('Agendado por NovuChat.');
    expect(d).toContain('Control del niño sano');
    expect(d).toContain('Pérez Gómez, Ana');
    const rn = L.descripcionDeLaCita({ telefono: TEL, servicio: 'control_recien_nacido', pacientes: [ANA, { apellidos: 'Pérez Gómez', nombres: 'Luis' }] });
    expect(rn).toContain('Control del recién nacido');
    expect(rn).toContain('Pacientes:');
    // Niega: ya no es el rótulo `Tel:` propio ni el «Contacto en WhatsApp» del primer borrador.
    expect(d).not.toMatch(/^Tel:/m);
    expect(d).not.toContain('Contacto en WhatsApp');
    // Sin perfil ni pacientes siguen las tres líneas del flujo vivo.
    expect(L.descripcionDeLaCita({ telefono: TEL }).split('\n')).toEqual(['Cliente: ', `Telefono: ${TEL}`, 'Agendado por NovuChat.']);
    // Nada de promesas en el texto.
    expect(d).not.toMatch(/te aviso|te llamamos|te escribir|lo consulto/i);
  });
});

// =============================================================================================
describe('citasDelTelefono', () => {
  // La descripción REAL que escribe `agendar_cita` del flujo vivo de Bellido, con datos ficticios.
  const REAL = (tel: string) => `Cliente: Mamá de Ana\nTelefono: ${tel}\nAgendado por NovuChat.`;
  const conTel = (id: string, fecha: string, desde: string, tel: string, extra: Partial<Ev> = {}): Ev =>
    ev(id, fecha, desde, `${String(Number(desde.slice(0, 2)) + 1).padStart(2, '0')}:${desde.slice(3)}`, {
      summary: `Pérez, ${id} (CNS)`, description: REAL(tel), ...extra });
  const ids = (eventos: Ev[], telefono = TEL) => L.citasDelTelefono({ eventos, telefono, ahoraMs: AHORA }).map((c: { id: string }) => c.id);

  it('solo las futuras: la de hoy a las 09:00 (ya pasó) y las de ayer no', () => {
    const eventos = [conTel('pasada', MIE, '09:00', TEL), conTel('ayer', '2026-09-29', '15:00', TEL), conTel('futura', VIE, '15:00', TEL), conTel('hoy', MIE, '16:00', TEL)];
    expect(ids(eventos)).toEqual(['hoy', 'futura']); // en orden de hora
    expect(ids(eventos)).not.toContain('pasada');
    expect(ids(eventos)).not.toContain('ayer');
  });
  it('una cita creada por el flujo vivo (su descripción real) se encuentra', () => {
    const viva = ev('viva', VIE, '15:00', '15:30', { summary: 'Cita Ana Pérez — control-del-nino-sano', description: REAL(TEL) });
    expect(ids([viva])).toEqual(['viva']);
    // Y también la que carga `citas-a-calendario.mjs`, que escribe lo mismo.
    expect(ids([conTel('importada', VIE, '16:00', TEL)])).toEqual(['importada']);
    // Niega: con el teléfono de otra persona, no.
    expect(ids([viva], TEL_OTRO)).toEqual([]);
  });
  it('una cita del doctor sin línea de teléfono no se encuentra (no es del paciente del chat)', () => {
    const eventos = [conTel('mia', VIE, '15:00', TEL),
      ev('sinDescripcion', VIE, '11:00', '11:30', { summary: 'Pérez Gómez, Ana (CNS)' }),
      ev('sinLinea', VIE, '12:00', '12:30', { summary: 'Rojas, Luis (RN)', description: 'Paciente nuevo. Llamó al consultorio.' }),
      ev('soloNombre', VIE, '13:00', '13:30', { description: 'Cliente: Mamá de Ana' })];
    expect(ids(eventos)).toEqual(['mia']);
    expect(ids(eventos)).not.toContain('sinDescripcion');
    expect(ids(eventos)).not.toContain('sinLinea');
    expect(ids(eventos)).not.toContain('soloNombre');
  });
  it('otro teléfono no coincide', () => {
    const eventos = [conTel('mia', VIE, '15:00', TEL), conTel('ajena', VIE, '16:00', TEL_OTRO)];
    expect(ids(eventos)).toEqual(['mia']);
    expect(ids(eventos, TEL_OTRO)).toEqual(['ajena']);
  });
  it('un teléfono que es prefijo o sufijo de otro no coincide, ni al revés', () => {
    const eventos = [conTel('larga', VIE, '15:00', TEL)];
    expect(ids(eventos, TEL_PREFIJO)).toEqual([]);
    expect(ids(eventos, TEL.slice(1))).toEqual([]); // sufijo: le falta el primer dígito
    expect(ids([conTel('corta', VIE, '15:00', TEL_PREFIJO)], TEL)).toEqual([]);
    expect(ids([conTel('sufijo', VIE, '15:00', TEL.slice(1))], TEL)).toEqual([]);
    expect(ids(eventos, TEL)).toEqual(['larga']);
    // Ni un teléfono vacío coincide con todo.
    expect(ids(eventos, '')).toEqual([]);
  });
  it('reconoce `Telefono:`, `Teléfono:` y `Tel:`, sin distinguir mayúsculas, con espacios opcionales y un `+` opcional', () => {
    for (const linea of [`Telefono: ${TEL}`, `Teléfono: ${TEL}`, `Tel: ${TEL}`, `TELEFONO: ${TEL}`, `teléfono:${TEL}`, `  Tel :  ${TEL}  `,
      `Telefono: +${TEL}`, `Tel:+${TEL}`]) {
      expect(ids([conTel('x', VIE, '15:00', TEL, { description: `Cliente: X\n${linea}\nNota` })]), linea).toEqual(['x']);
    }
    // El `+` también puede venir en el teléfono que se busca.
    expect(ids([conTel('y', VIE, '15:00', TEL)], `+${TEL}`)).toEqual(['y']);
  });
  it('niega: otros rótulos, texto pegado al número o un número con algo más no valen', () => {
    for (const linea of [`Tel. ${TEL}`, `Celular: ${TEL}`, `Contacto ${TEL}`, `Telefono: ${TEL} y otro`, `Telefono: ${TEL}0`,
      `Telefono: 0${TEL}`, `Mi Telefono: ${TEL}`, TEL, `Telefonos: ${TEL}`]) {
      expect(ids([conTel('x', VIE, '15:00', TEL, { description: linea })]), linea).toEqual([]);
    }
  });
  it('la línea puede estar en cualquier lugar de la descripción, con salto de línea de Windows o `<br>`', () => {
    expect(ids([conTel('a', VIE, '15:00', TEL, { description: `Servicio: x\nTelefono: ${TEL}\nNota` })])).toEqual(['a']);
    expect(ids([conTel('b', VIE, '15:00', TEL, { description: `Servicio: x\r\nTelefono: ${TEL}\r\n` })])).toEqual(['b']);
    expect(ids([conTel('c', VIE, '15:00', TEL, { description: `Cliente: x<br>Telefono: ${TEL}<br>Agendado por NovuChat.` })])).toEqual(['c']);
  });
  it('los cancelados y los de día entero no cuentan', () => {
    expect(ids([conTel('x', VIE, '15:00', TEL, { status: 'cancelled' })])).toEqual([]);
    expect(ids([{ ...diaEntero('d', VIE, SAB), description: REAL(TEL) }])).toEqual([]);
  });
  it('devuelve id, inicio, fin, título y etiqueta', () => {
    const [c] = L.citasDelTelefono({ eventos: [conTel('e9', JUE, '15:30', TEL)], telefono: TEL, ahoraMs: AHORA });
    expect(c).toEqual({ id: 'e9', inicio: L.isoLocal(JUE, '15:30'), fin: L.isoLocal(JUE, '16:30'), titulo: 'Pérez, e9 (CNS)', etiqueta: 'Jue 15:30' });
    expect(c.etiqueta.length).toBeLessThanOrEqual(20);
    expect(L.citasDelTelefono({ eventos: undefined, telefono: TEL, ahoraMs: AHORA })).toEqual([]);
  });
  it('ida y vuelta con `descripcionDeLaCita`', () => {
    const d = L.descripcionDeLaCita({ telefono: TEL, servicio: 'control_nino_sano', pacientes: [{ apellidos: 'Pérez', nombres: 'Ana' }], nombrePerfil: 'Mamá de Ana' });
    expect(ids([conTel('rt', VIE, '15:00', TEL, { description: d })])).toEqual(['rt']);
    expect(ids([conTel('rt', VIE, '15:00', TEL, { description: d })], TEL_OTRO)).toEqual([]);
    expect(ids([conTel('rt', VIE, '15:00', TEL, { description: d })], TEL_PREFIJO)).toEqual([]);
  });
});

// =============================================================================================
describe('idDeBoton / leerIdDeBoton', () => {
  const INICIO = '2026-10-01T15:00:00-04:00';
  it('hueco: ida y vuelta', () => {
    const id = L.idDeBoton('h', { inicio: INICIO, servicio: 'control_nino_sano' });
    expect(id).toBe(`h|${INICIO}|control_nino_sano`);
    expect(L.leerIdDeBoton(id)).toEqual({ tipo: 'h', inicio: INICIO, servicio: 'control_nino_sano' });
  });
  it('cancelar y mover: ida y vuelta, con objeto o con el id suelto', () => {
    expect(L.idDeBoton('c', { id: 'abc123def' })).toBe('c|abc123def');
    expect(L.idDeBoton('m', { id: 'abc123def' })).toBe('m|abc123def');
    expect(L.idDeBoton('c', 'abc123def')).toBe('c|abc123def');
    expect(L.leerIdDeBoton('c|abc123def')).toEqual({ tipo: 'c', id: 'abc123def' });
    expect(L.leerIdDeBoton('m|abc_123.def-9')).toEqual({ tipo: 'm', id: 'abc_123.def-9' });
    // Niega: cancelar y mover no se confunden.
    expect(L.leerIdDeBoton('c|abc')?.tipo).not.toBe('m');
  });
  it('256 caracteres como máximo (el tope de Meta)', () => {
    expect(L.idDeBoton('c', { id: 'a'.repeat(200) })!.length).toBe(202);
    // Un id de evento de 200 caracteres cabe; con 201 ya no lee (tope propio de la lectura).
    expect(L.leerIdDeBoton(`c|${'a'.repeat(200)}`)).not.toBeNull();
    expect(L.leerIdDeBoton(`c|${'a'.repeat(201)}`)).toBeNull();
    // Y nada pasa de 256, ni al armar ni al leer.
    expect(L.idDeBoton('c', { id: 'a'.repeat(300) })).toBeNull();
    expect(L.leerIdDeBoton(`h|${INICIO}|${'s'.repeat(300)}`)).toBeNull();
    // Todo id armado cabe.
    for (const id2 of [L.idDeBoton('h', { inicio: INICIO, servicio: 'control_recien_nacido' }), L.idDeBoton('m', { id: 'a'.repeat(200) })]) {
      expect(id2!.length).toBeLessThanOrEqual(256);
    }
  });
  it('un id desconocido o mal formado da null', () => {
    for (const malo of ['', 'x|abc', 'hola', 'h|', 'h|mañana|control_nino_sano', `h|${INICIO}`, `h|${INICIO}|con espacio`,
      `h|${INICIO}|a|b`, 'c|', 'c|con espacio', 'c|a|b', 'm|', 'h|2026-13-40T99:99:00-04:00|control_nino_sano', 'H|x|y']) {
      expect(L.leerIdDeBoton(malo), malo).toBeNull();
    }
    expect(L.leerIdDeBoton(undefined)).toBeNull();
    expect(L.leerIdDeBoton(null)).toBeNull();
    expect(L.leerIdDeBoton(42)).toBeNull();
  });
  it('armar con datos que no caben da null en vez de un id que no se puede leer', () => {
    expect(L.idDeBoton('x', { id: 'a' })).toBeNull();
    expect(L.idDeBoton('c', {})).toBeNull();
    expect(L.idDeBoton('c', { id: 'a|b' })).toBeNull();
    expect(L.idDeBoton('h', { inicio: 'mañana', servicio: 'control_nino_sano' })).toBeNull();
    expect(L.idDeBoton('h', { inicio: INICIO })).toBeNull();
    expect(L.idDeBoton('h')).toBeNull();
  });
});

// =============================================================================================
describe('partirNombre', () => {
  it('con coma: «Apellidos, Nombres»', () => {
    expect(L.partirNombre('Pérez Gómez, Ana')).toEqual({ apellidos: 'Pérez Gómez', nombres: 'Ana' });
    expect(L.partirNombre('Pérez, Ana María')).toEqual({ apellidos: 'Pérez', nombres: 'Ana María' });
  });
  it('dos palabras: nombre y apellido; tres: la primera es el nombre', () => {
    expect(L.partirNombre('Ana Pérez')).toEqual({ apellidos: 'Pérez', nombres: 'Ana' });
    expect(L.partirNombre('Ana Pérez Gómez')).toEqual({ apellidos: 'Pérez Gómez', nombres: 'Ana' });
  });
  it('cuatro o más: los dos primeros son el nombre (nombre compuesto)', () => {
    expect(L.partirNombre('Juan Carlos Pérez Gómez')).toEqual({ apellidos: 'Pérez Gómez', nombres: 'Juan Carlos' });
  });
  it('una sola palabra: solo nombre, con el apellido vacío (hay que pedirlo)', () => {
    expect(L.partirNombre('Ana')).toEqual({ apellidos: '', nombres: 'Ana' });
  });
  it('pone en mayúscula lo escrito todo en minúsculas o todo en mayúsculas, y respeta lo demás', () => {
    expect(L.partirNombre('ana pérez gómez')).toEqual({ apellidos: 'Pérez Gómez', nombres: 'Ana' });
    expect(L.partirNombre('ANA PÉREZ')).toEqual({ apellidos: 'Pérez', nombres: 'Ana' });
    expect(L.partirNombre('Ana de la Cruz')).toEqual({ apellidos: 'de la Cruz', nombres: 'Ana' });
    expect(L.partirNombre('ana de la cruz')).toEqual({ apellidos: 'de la Cruz', nombres: 'Ana' });
  });
  it('limpia espacios y signos', () => {
    expect(L.partirNombre('  Ana   Pérez. ')).toEqual({ apellidos: 'Pérez', nombres: 'Ana' });
  });
  it('null si está vacío, es un saludo o relleno, lleva dígitos o no es texto', () => {
    for (const no of ['', '   ', 'hola', 'Hola!', 'buenas tardes', 'Buenos días', 'si', 'Sí', 'ya', 'dale', 'ok', 'hola buenas', 'quiero una cita']) {
      expect(L.partirNombre(no), no).toBeNull();
    }
    expect(L.partirNombre('59170000001')).toBeNull();
    expect(L.partirNombre('Ana 2 años')).toBeNull();
    expect(L.partirNombre('x'.repeat(200))).toBeNull();
    expect(L.partirNombre(null)).toBeNull();
    expect(L.partirNombre(undefined)).toBeNull();
    expect(L.partirNombre(42)).toBeNull();
    // Niega: un nombre que empieza como saludo pero es un nombre sí se parte.
    expect(L.partirNombre('Diana Buenavista')).toEqual({ apellidos: 'Buenavista', nombres: 'Diana' });
  });
  it('lo que sale sirve para el título de la cita', () => {
    const p = L.partirNombre('mateo pérez gómez');
    expect(L.tituloDeLaCita({ pacientes: [p], servicio: 'control_nino_sano' })).toBe('Pérez Gómez, Mateo (CNS)');
  });
});
