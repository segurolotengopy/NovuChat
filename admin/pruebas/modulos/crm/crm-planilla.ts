/**
 * miniCRM, PR-E: la planilla de las subcuentas (plantilla NOVUCHAT_miniCRM_IA, 31/10/2026).
 *   · clasificación, prioridad y cierre de ventana POR CODIGO: tabla con los 6 leads del plan.
 *   · el mapa con columnas del bot NO contiguas (A a I y N a T), el equipo en medio (J a M) y al final (U).
 *   · se NIEGA: el bot nunca escribe J, K, L (salvo el estado al crear), M, U ni F (salvo al crear).
 *   · paridad del contrato de Functions con el módulo que corre en n8n.
 * Mensajes por conversación: 0 (ninguna de estas piezas envía).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CAMPOS_DEL_BOT, CAMPOS_DEL_EQUIPO } from '../../../functions/src/modulos/crm/columnas.js';
// @ts-expect-error módulo .mjs sin tipos
import { inyectarMapa } from '../../../../Flujos/experimental/comun-sin-agente/construir-crm.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FLUJOS = join(AQUI, '..', '..', '..', '..', 'Flujos', 'src', 'modulos');
const leer = (r: string) => readFileSync(join(FLUJOS, r), 'utf8');
type J = Record<string, unknown>;

const T = {
  id: 'ID Lead', fecha: 'Fecha', nombre: 'Nombre y Apellido', empresa: 'Empresa', telefono: 'Teléfono', etapa: 'Etapa Funnel', origen: 'Origen',
  calif: 'Calificación IA', resumen: 'Resumen', valor: 'Valor', resp: 'Responsable', estado: 'Estado Comercial', prox: 'Próxima Acción',
  clasif: 'Clasificación', quePidio: 'Qué pidió', dia: 'Día preferido', horario: 'Horario preferido', deriv: 'Derivación a recepción',
  ultima: 'Última interacción', ventana: 'Se cierra la ventana de 24 h', diag: 'Diagnóstico del equipo',
};
const MAPA = {
  filaEncabezados: 3, prefijoId: 'L-', primerId: 1,
  columnas: {
    id: { letra: 'A', titulo: T.id }, fecha: { letra: 'B', titulo: T.fecha }, nombre: { letra: 'C', titulo: T.nombre }, empresa: { letra: 'D', titulo: T.empresa },
    telefono: { letra: 'E', titulo: T.telefono }, etapaInicial: { letra: 'F', titulo: T.etapa }, origen: { letra: 'G', titulo: T.origen },
    calificacion: { letra: 'H', titulo: T.calif }, resumen: { letra: 'I', titulo: T.resumen },
    clasificacion: { letra: 'N', titulo: T.clasif }, quePidio: { letra: 'O', titulo: T.quePidio }, diaPreferido: { letra: 'P', titulo: T.dia },
    horarioPreferido: { letra: 'Q', titulo: T.horario }, derivacion: { letra: 'R', titulo: T.deriv }, ultimaInteraccion: { letra: 'S', titulo: T.ultima },
    ventana24h: { letra: 'T', titulo: T.ventana },
  } as Record<string, { letra: string; titulo: string }>,
  equipo: {
    valor: { letra: 'J', titulo: T.valor }, responsable: { letra: 'K', titulo: T.resp }, estado: { letra: 'L', titulo: T.estado },
    proximaAccion: { letra: 'M', titulo: T.prox }, diagnostico: { letra: 'U', titulo: T.diag },
  } as Record<string, { letra: string; titulo: string } | null>,
  extrasDelEquipo: {} as Record<string, string>,
  alCrear: { etapaInicial: '1. Nuevo', origen: 'Chatbot', origenAnuncio: 'Anuncio', estado: 'Activo' } as J,
};
const clonar = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const TITULOS_LEIDOS = [T.id, T.fecha, T.nombre, T.empresa, T.telefono, T.etapa, T.origen, T.calif, T.resumen, T.valor, T.resp, T.estado, T.prox,
  T.clasif, T.quePidio, T.dia, T.horario, T.deriv, T.ultima, T.ventana, T.diag];

const FUNCIONES = 'return { crmClasificar, crmPrioridad, crmVentana24h, crmValidarMapa, crmDecidirFila, capCalificar, capResumir, CAP_PRIORIDAD, CRM_CAMPOS_BOT, CRM_CAMPOS_EQUIPO };';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M: any = compileFunction(`${inyectarMapa(leer('crm/crm.js'), MAPA)}\n${leer('captacion/crm-captacion.js')}\n${FUNCIONES}`, [])();
const adaptador = { calificar: M.capCalificar, resumir: M.capResumir, prioridad: M.CAP_PRIORIDAD };
const AHORA = Date.UTC(2026, 9, 31, 15, 0, 0);
const TEL = ['59', '17', '000', '010'].join('');

const fila = (n: number, tel: string, extra: J = {}): { json: J } => ({ json: { row_number: n, ...Object.fromEntries(TITULOS_LEIDOS.map((t) => [t, ''])), [T.telefono]: tel, ...extra } });
const decidir = (p: J, busqueda: Array<{ json: J }> = [], mapa: unknown = MAPA, ids: Array<{ json: J }> = [{ json: { row_number: 4, [T.id]: 'L-7' } }]) =>
  M.crmDecidirFila({ prospectos: [{ json: p }], busqueda, lecturaIds: ids, mapa: clonar(mapa), adaptador, ahoraMs: AHORA })[0].json as J;
const claves = (j: J) => Object.keys(j).filter((k) => !['accionPlanilla', 'veredictoPlanilla', 'row_number'].includes(k));

// Los 6 leads del plan: lo que HIZO cada uno y lo que la planilla debe decir.
const LEADS: Array<[string, J, string, string]> = [
  ['Maria Eugenia: aceptó agendar', { aceptoAgendar: true, llegoPorAnuncio: true }, 'Caliente', 'Alta'],
  ['Rosarito: pidió la ubicación', { pidioUbicacion: true }, 'Caliente', 'Alta'],
  ['Dunia: llegó por anuncio', { llegoPorAnuncio: true }, 'Tibio', 'Media'],
  ['Yeimy: escribió y no avanzó', {}, 'Tibio', 'Media'],
  ['Roxi: preguntó el precio y cerró', { preguntoPrecioYCerro: true, llegoPorAnuncio: true }, 'Frío', 'Baja'],
  ['Moira: no es paciente', { noEsPaciente: true, pidioUbicacion: true }, 'No es lead', 'N/A'],
];

describe('clasificación, prioridad y cierre de ventana (por código)', () => {
  it.each(LEADS)('%s', (_n, senales, clasif, prio) => {
    expect(M.crmClasificar(senales)).toBe(clasif);
    expect(M.crmPrioridad(clasif)).toBe(prio);
  });
  it('pidió que lo llamen = Caliente; solo `=== true` cuenta', () => {
    expect(M.crmClasificar({ pidioLlamada: true })).toBe('Caliente');
    expect(M.crmClasificar({ aceptoAgendar: 'true', pidioUbicacion: 1, pidioLlamada: 'si' })).toBe('Tibio');
    for (const raro of [null, undefined, 'x', 5, [], {}]) expect(M.crmClasificar(raro)).toBe('Tibio');
  });
  it('prioridad: un valor desconocido no inventa una prioridad', () => {
    for (const raro of ['', 'caliente', 'Hot', 'toString', '__proto__', null, undefined, 7]) expect(M.crmPrioridad(raro)).toBe('N/A');
  });
  it('la ventana se cierra 24 h después de la última interacción, sin modelo', () => {
    expect(M.crmVentana24h(AHORA)).toBe(AHORA + 24 * 3600 * 1000);
    expect(M.crmVentana24h(0)).toBe(24 * 3600 * 1000);
    for (const raro of [null, undefined, '1', NaN, Infinity]) expect(M.crmVentana24h(raro)).toBeNull();
  });
  it('la fila nueva de cada uno de los 6 leads lleva su clasificación y su cierre de ventana en hora de La Paz', () => {
    for (const [, senales, clasif] of LEADS) {
      const f = decidir({ telefono: TEL, nombre: 'Ana', senales, ultimaInteraccionMs: AHORA });
      expect(f.accionPlanilla).toBe('agregar');
      expect(f[T.clasif]).toBe(clasif);
      // Las dos fechas van como TEXTO (apóstrofo) tanto al crear como al actualizar: «AAAA-MM-DD HH:MM», hora de La Paz.
      expect(f[T.ultima]).toBe("'2026-10-31 11:00");
      expect(f[T.ventana]).toBe("'2026-11-01 11:00");
    }
  });
});

describe('mapa con columnas del bot no contiguas', () => {
  it('el mapa de la plantilla es válido', () => expect(M.crmValidarMapa(MAPA)).toEqual([]));
  it('sin los campos nuevos, un mapa con solo A a I (y el equipo después) sigue siendo válido', () => {
    const m = clonar(MAPA);
    for (const k of ['clasificacion', 'quePidio', 'diaPreferido', 'horarioPreferido', 'derivacion', 'ultimaInteraccion', 'ventana24h']) delete m.columnas[k];
    delete m.equipo.diagnostico;
    expect(M.crmValidarMapa(m)).toEqual([]);
  });
  const invalido = (cambia: (m: typeof MAPA) => void) => { const m = clonar(MAPA); cambia(m); return M.crmValidarMapa(m) as string[]; };
  it.each([
    ['un campo del bot en la letra de una columna del equipo (J)', (m: typeof MAPA) => { m.columnas.clasificacion.letra = 'J'; }, 'equipo.valor: la letra J ya la usa columnas.clasificacion'],
    ['un campo del bot en la letra del diagnóstico (U)', (m: typeof MAPA) => { m.columnas.ventana24h.letra = 'U'; }, 'equipo.diagnostico: la letra U ya la usa columnas.ventana24h'],
    ['el bot en el estado (L)', (m: typeof MAPA) => { m.columnas.derivacion.letra = 'L'; }, 'equipo.estado: la letra L ya la usa columnas.derivacion'],
    ['el bot en la próxima acción (M)', (m: typeof MAPA) => { m.columnas.quePidio.letra = 'M'; }, 'equipo.proximaAccion: la letra M ya la usa columnas.quePidio'],
    ['el bot en el responsable (K)', (m: typeof MAPA) => { m.columnas.diaPreferido.letra = 'K'; }, 'equipo.responsable: la letra K ya la usa columnas.diaPreferido'],
    ['una columna del equipo sin declarar dentro del rango leído (hueco en K)', (m: typeof MAPA) => { m.equipo.responsable = null; }, 'la columna K cae dentro del rango que se lee (A a U) y no esta declarada'],
    ['letra repetida entre dos del bot', (m: typeof MAPA) => { m.columnas.horarioPreferido.letra = 'N'; }, 'columnas.horarioPreferido: la letra N ya la usa columnas.clasificacion'],
    ['campo del bot desconocido', (m: typeof MAPA) => { m.columnas.raro = { letra: 'V', titulo: 'Raro' }; }, '«raro» no es una columna del bot'],
    ['el diagnóstico como campo del bot', (m: typeof MAPA) => { m.columnas.diagnostico = { letra: 'V', titulo: 'Otro' }; }, '«diagnostico» no es una columna del bot'],
    ['título repetido con una del equipo', (m: typeof MAPA) => { m.columnas.quePidio.titulo = T.valor; }, 'equipo.valor: el titulo se repite'],
  ])('NIEGA: %s', (_n, cambia, mensaje) => {
    expect(invalido(cambia as never)).toContain(mensaje);
  });
  it('un mapa inválido que llegue al nodo no escribe nada', () => {
    const malo = clonar(MAPA); malo.columnas.clasificacion.letra = 'J';
    expect(decidir({ telefono: TEL, nombre: 'Ana' }, [], malo)).toEqual({ accionPlanilla: 'nada', veredictoPlanilla: 'mapa_invalido' });
  });
});

describe('encabezados letra por letra, también con el equipo en medio', () => {
  const p = { telefono: TEL, nombre: 'Ana', senales: { pidioUbicacion: true } };
  it('la fila leída completa (A a U) coincide: se actualiza', () => {
    const r = decidir(p, [fila(8, TEL)]);
    expect(r.accionPlanilla).toBe('actualizar');
    expect(r.row_number).toBe(10);
  });
  it('un encabezado del equipo movido de lugar (Valor y Responsable cambiados) = no escribe', () => {
    const f = fila(8, TEL).json;
    const cambiada: J = { row_number: 8 };
    for (const t of TITULOS_LEIDOS) cambiada[t === T.valor ? T.resp : t === T.resp ? T.valor : t] = '';
    cambiada[T.telefono] = f[T.telefono];
    const r = decidir(p, [{ json: cambiada }]);
    expect(r.accionPlanilla).toBe('nada');
    expect(String(r.veredictoPlanilla)).toMatch(/^encabezados_distintos/);
  });
  it('un encabezado del bot movido (Qué pidió en lugar de Clasificación) = no escribe', () => {
    const cambiada: J = { row_number: 8 };
    for (const t of TITULOS_LEIDOS) cambiada[t === T.clasif ? T.quePidio : t === T.quePidio ? T.clasif : t] = '';
    cambiada[T.telefono] = TEL;
    expect(decidir(p, [{ json: cambiada }]).accionPlanilla).toBe('nada');
  });
  it('una columna de más al final de la lectura = no escribe; una del bot que falta también', () => {
    expect(decidir(p, [fila(8, TEL, { 'Notas sueltas': 'x' })]).accionPlanilla).toBe('nada');
    const sin = fila(8, TEL).json; delete sin[T.ventana];
    expect(decidir(p, [{ json: sin }]).accionPlanilla).toBe('nada');
  });
});

describe('se NIEGA: el bot nunca escribe lo del equipo', () => {
  const EQUIPO_TITULOS = [T.valor, T.resp, T.prox, T.diag];
  const completo = {
    telefono: TEL, nombre: 'Ana', empresa: 'Taller', rubro: 'Ropa', senales: { aceptoAgendar: true }, quePidio: 'Cita de limpieza', diaPreferido: 'martes',
    horarioPreferido: 'tarde', derivacion: true, ultimaInteraccionMs: AHORA, anuncio: true,
  };
  it('al ACTUALIZAR, solo salen columnas del bot y nunca F, J, K, L, M ni U', () => {
    const r = decidir(completo, [fila(8, TEL, { [T.calif]: 'Baja' })]);
    expect(r.accionPlanilla).toBe('actualizar');
    const ok = [T.nombre, T.empresa, T.calif, T.resumen, T.clasif, T.quePidio, T.dia, T.horario, T.deriv, T.ultima, T.ventana];
    for (const k of claves(r)) expect(ok, k).toContain(k);
    for (const t of [...EQUIPO_TITULOS, T.estado, T.etapa]) expect(r).not.toHaveProperty(t);
    expect(r[T.clasif]).toBe('Caliente');
    expect(r[T.deriv]).toBe('Sí');
  });
  it('al CREAR, solo la etapa (F) y el estado (L) del equipo, y nunca J, K, M ni U', () => {
    const r = decidir(completo);
    expect(r.accionPlanilla).toBe('agregar');
    expect(r[T.etapa]).toBe('1. Nuevo');
    expect(r[T.estado]).toBe('Activo');
    for (const t of EQUIPO_TITULOS) expect(r).not.toHaveProperty(t);
    const permitidas = new Set(TITULOS_LEIDOS.filter((t) => !EQUIPO_TITULOS.includes(t)));
    for (const k of claves(r)) expect(permitidas.has(k), k).toBe(true);
  });
  it('aunque el prospecto traiga claves con el título de una columna del equipo, no se copian', () => {
    const r = decidir({ ...completo, [T.valor]: '1000', [T.diag]: 'x', diagnostico: 'x', valor: 5, estado: 'cerrado' }, [fila(8, TEL)]);
    for (const t of EQUIPO_TITULOS) expect(r).not.toHaveProperty(t);
    expect(r).not.toHaveProperty(T.estado);
  });
  it('el contrato de Functions y el módulo de n8n tienen los mismos campos del bot y del equipo (paridad TS/JS)', () => {
    expect([...M.CRM_CAMPOS_BOT].sort()).toEqual([...CAMPOS_DEL_BOT].sort());
    expect([...M.CRM_CAMPOS_EQUIPO]).toEqual([...CAMPOS_DEL_EQUIPO]);
  });
});

describe('reglas de la fila con los campos nuevos', () => {
  it('sin los campos nuevos en el prospecto, la fila nueva no los trae', () => {
    const r = decidir({ telefono: TEL, nombre: 'Ana' });
    for (const t of [T.clasif, T.quePidio, T.dia, T.horario, T.deriv, T.ultima, T.ventana]) expect(r).not.toHaveProperty(t);
  });
  it('el texto del cliente nunca es fórmula: día, horario y qué pidió quedan como texto', () => {
    const r = decidir({ telefono: TEL, nombre: 'Ana', quePidio: '=HYPERLINK("x")', diaPreferido: '+lunes', horarioPreferido: '@tarde', derivacion: '=1' });
    for (const t of [T.quePidio, T.dia, T.horario, T.deriv]) expect(String(r[t])).toMatch(/^'[^=+\-@]/);
    const u = decidir({ telefono: TEL, nombre: 'Ana', quePidio: '=HYPERLINK("x")', diaPreferido: '+lunes' }, [fila(8, TEL)]);
    expect(String(u[T.quePidio])).not.toMatch(/^[=+\-@]/);
    expect(String(u[T.dia])).not.toMatch(/^[=+\-@]/);
  });
  it('los textos largos se acotan', () => {
    const r = decidir({ telefono: TEL, nombre: 'Ana', quePidio: 'x'.repeat(900), diaPreferido: 'y'.repeat(900) });
    expect(String(r[T.quePidio]).length).toBeLessThanOrEqual(201);
    expect(String(r[T.dia]).length).toBeLessThanOrEqual(61);
  });
  it('la clasificación sube y no baja al actualizar', () => {
    const baja = decidir({ telefono: TEL, nombre: 'Ana', senales: { preguntoPrecioYCerro: true } }, [fila(8, TEL, { [T.clasif]: 'Caliente' })]);
    expect(baja).not.toHaveProperty(T.clasif);
    const sube = decidir({ telefono: TEL, nombre: 'Ana', senales: { aceptoAgendar: true } }, [fila(8, TEL, { [T.clasif]: 'Tibio' })]);
    expect(sube[T.clasif]).toBe('Caliente');
  });
  it('el nombre ya dado no se pisa con el del perfil de WhatsApp; uno vacío sí se completa', () => {
    const dado = decidir({ telefono: TEL, nombre: 'Perfil WA', nombreDePerfil: true, empresa: 'Taller' }, [fila(8, TEL, { [T.nombre]: 'Ana Pérez' })]);
    expect(dado).not.toHaveProperty(T.nombre);
    const vacio = decidir({ telefono: TEL, nombre: 'Perfil WA', nombreDePerfil: true }, [fila(8, TEL)]);
    expect(vacio[T.nombre]).toBe('Perfil WA');
  });
  it('teléfono con dos filas: se actualiza la más reciente', () => {
    const r = decidir({ telefono: TEL, nombre: 'Nueva' }, [fila(4, TEL), fila(30, TEL)]);
    expect(r.row_number).toBe(32);
  });
  it('contacto tras 48 h (nuevoContacto) = fila nueva', () => {
    expect(decidir({ telefono: TEL, nombre: 'Ana', nuevoContacto: true }, [fila(8, TEL)]).accionPlanilla).toBe('agregar');
  });
});

describe('decisiones del 31/10: clasificación, textos, derivación y fechas', () => {
  const CLAS = [T.clasif];
  const upd = (p: J, previa: string) => decidir({ telefono: TEL, nombre: 'Ana', ...p }, [fila(8, TEL, { [T.clasif]: previa })]);
  it('«No es lead» SIEMPRE se escribe al actualizar (Tibio → No es lead), aunque sea "bajar" en la escala', () => {
    for (const previa of ['Tibio', 'Caliente', 'Frío']) expect(upd({ senales: { noEsPaciente: true } }, previa)[T.clasif], previa).toBe('No es lead');
  });
  it('sin ninguna señal verdadera no se toca una fila ya clasificada (Tibio por defecto no pisa Frío ni Caliente)', () => {
    for (const previa of ['Frío', 'Caliente', 'No es lead']) for (const senales of [{}, { aceptoAgendar: 'true', pidioLlamada: 1 }]) {
      expect(upd({ senales }, previa), previa).not.toHaveProperty(CLAS[0]);
    }
  });
  it('una fila nueva sin señales sí queda en Tibio, y una celda vacía o escrita por una persona se completa', () => {
    expect(decidir({ telefono: TEL, nombre: 'Ana', senales: {} })[T.clasif]).toBe('Tibio');
    expect(upd({ senales: {} }, '')[T.clasif]).toBe('Tibio');
    expect(upd({ senales: {} }, 'a mano')[T.clasif]).toBe('Tibio');
  });
  it('textos libres: solo un string; false, números, objetos y listas jamás llegan a la hoja', () => {
    for (const raro of [false, true, 0, 5, {}, [], ['x'], null, undefined]) {
      const r = decidir({ telefono: TEL, nombre: 'Ana', quePidio: raro, diaPreferido: raro, horarioPreferido: raro });
      for (const t of [T.quePidio, T.dia, T.horario]) expect(r, `${JSON.stringify(raro)} ${t}`).not.toHaveProperty(t);
      const u = decidir({ telefono: TEL, nombre: 'Ana', quePidio: raro, diaPreferido: raro, horarioPreferido: raro }, [fila(8, TEL)]);
      for (const t of [T.quePidio, T.dia, T.horario]) expect(u).not.toHaveProperty(t);
    }
    const todo = JSON.stringify(decidir({ telefono: TEL, nombre: 'Ana', quePidio: false, diaPreferido: {}, horarioPreferido: [{}], derivacion: {} }));
    expect(todo).not.toMatch(/false|\[object Object\]/);
  });
  it('derivación: true = «Sí», false = «No», un string = su texto acotado, lo demás = nada', () => {
    expect(decidir({ telefono: TEL, nombre: 'A', derivacion: true })[T.deriv]).toBe("'Sí");
    expect(decidir({ telefono: TEL, nombre: 'A', derivacion: false })[T.deriv]).toBe("'No");
    expect(decidir({ telefono: TEL, nombre: 'A', derivacion: 'Pasó con recepción' })[T.deriv]).toBe("'Pasó con recepción");
    expect(String(decidir({ telefono: TEL, nombre: 'A', derivacion: 'x'.repeat(500) })[T.deriv]).length).toBe(81);
    for (const raro of [0, 1, {}, [], null, undefined, 'x'.repeat(0)]) expect(decidir({ telefono: TEL, nombre: 'A', derivacion: raro }), JSON.stringify(raro)).not.toHaveProperty(T.deriv);
    expect(decidir({ telefono: TEL, nombre: 'A', derivacion: false }, [fila(8, TEL, { [T.deriv]: 'Sí' })])[T.deriv]).toBe('No');
  });
  it('fechas: fuera de 2020..2100, NaN, segundos en vez de milisegundos o no numéricas = no se escriben', () => {
    const seg = Math.floor(AHORA / 1000);
    for (const raro of [seg, Date.UTC(2019, 11, 31), Date.UTC(2100, 0, 1), NaN, Infinity, -1, 0, '1793000000000', null, {}, 8.64e15 + 1]) {
      const r = decidir({ telefono: TEL, nombre: 'A', ultimaInteraccionMs: raro });
      expect(r, String(raro)).not.toHaveProperty(T.ultima);
      expect(r).not.toHaveProperty(T.ventana);
      const u = decidir({ telefono: TEL, nombre: 'A', ultimaInteraccionMs: raro }, [fila(8, TEL)]);
      expect(u).not.toHaveProperty(T.ultima);
      expect(u).not.toHaveProperty(T.ventana);
    }
    expect(decidir({ telefono: TEL, nombre: 'A', ultimaInteraccionMs: Date.UTC(2020, 0, 1) })[T.ultima]).toBe("'2019-12-31 20:00");
  });
  it('la zona horaria cruza la medianoche: 02:30 UTC del 01/11 es 22:30 del 31/10 en La Paz, y la ventana cierra el 01/11 a las 22:30', () => {
    const r = decidir({ telefono: TEL, nombre: 'A', ultimaInteraccionMs: Date.UTC(2026, 10, 1, 2, 30) });
    expect(r[T.ultima]).toBe("'2026-10-31 22:30");
    expect(r[T.ventana]).toBe("'2026-11-01 22:30");
  });
  it('al actualizar las fechas van SIN apóstrofo (RAW) y no se reescriben si no cambian; al crear sí lo llevan', () => {
    const u = decidir({ telefono: TEL, nombre: 'A', ultimaInteraccionMs: AHORA }, [fila(8, TEL)]);
    expect(u[T.ultima]).toBe('2026-10-31 11:00');
    expect(u[T.ventana]).toBe('2026-11-01 11:00');
    const igual = decidir({ telefono: TEL, nombre: 'A', ultimaInteraccionMs: AHORA }, [fila(8, TEL, { [T.ultima]: '2026-10-31 11:00', [T.ventana]: '2026-11-01 11:00' })]);
    expect(igual).not.toHaveProperty(T.ultima);
  });
  it('NIEGA: ningún valor de una salida «actualizar» empieza con apóstrofo, con todos los campos nuevos', () => {
    const r = decidir({ telefono: TEL, nombre: 'Ana', empresa: 'T', rubro: 'Ropa', senales: { aceptoAgendar: true }, quePidio: 'Cita', diaPreferido: 'martes',
      horarioPreferido: 'tarde', derivacion: true, ultimaInteraccionMs: AHORA }, [fila(8, TEL)]);
    expect(r.accionPlanilla).toBe('actualizar');
    for (const [k, v] of Object.entries(r)) expect(String(v).startsWith("'"), k).toBe(false);
  });
  it('una fila «No es lead» no vuelve a lead por una señal débil; solo por una Caliente', () => {
    for (const senales of [{}, { llegoPorAnuncio: true }, { preguntoPrecioYCerro: true }]) expect(upd({ senales }, 'No es lead'), JSON.stringify(senales)).not.toHaveProperty(T.clasif);
    for (const senales of [{ aceptoAgendar: true }, { pidioUbicacion: true }, { pidioLlamada: true }]) expect(upd({ senales }, 'No es lead')[T.clasif]).toBe('Caliente');
  });
  it('cola con un título distinto en U (Diagnóstico renombrado) = columnas de más, no escribe', () => {
    const r = decidir({ telefono: TEL, nombre: 'A' }, [fila(8, TEL, {})].map((f) => {
      const n: J = {};
      for (const [k, v] of Object.entries(f.json)) n[k === T.diag ? 'Notas del médico' : k] = v;
      return { json: n };
    }));
    expect(r.accionPlanilla).toBe('nada');
    expect(r.veredictoPlanilla).toBe('encabezados_distintos: columnas de más en la fila 3');
  });
});
