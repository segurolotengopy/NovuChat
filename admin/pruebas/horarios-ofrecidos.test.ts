/**
 * LAS HORAS QUE SE OFRECEN, LA CONFIRMACIÓN Y LO YA OFRECIDO (27/09/2026).
 *
 * Reclamos de un consultorio real sobre su flujo de reservas, el mismo día
 * (ejecuciones #6509 a #6587 de n8n). Los textos de abajo son los reales, con
 * los nombres propios cambiados por ficticios (el repositorio es público):
 *
 *   · #6509, 00:06 de un DOMINGO, con el domingo «cerrado»: «tengo disponibles
 *     hoy domingo 27 los siguientes turnos: 11:00, 11:30 o 12:00», SIN llamar a
 *     consultar_disponibilidad.                                         → H1
 *   · #6555: el paciente preguntó «A las 17 no tiene?» y el turno consultó y
 *     AGENDÓ las 17:00 sin que nadie lo confirmara.                      → H2
 *   · #6523, #6527, #6551, #6578, #6583: pidió otra hora, otra franja, «a las
 *     13», «a las 19», y recibió las mismas tres opciones una y otra vez: «Ya
 *     me diste 3 veces los mismos y no quiero».                          → M1
 *
 * Todo se hace cumplir por HECHO en el código (`Procesar respuesta`,
 * `Comprobar reserva`, `Retomar respuesta`, `Procesar reintento`): el prompt ya
 * decía «NUNCA propongas un horario que no hayas verificado en ESTE MISMO
 * mensaje» y el modelo lo ignoró (CLAUDE.md: el prompt no es una barrera).
 *
 * Como en las demás suites de flujos, el código se EXTRAE del JSON versionado y
 * se ejecuta, en los TRES flujos de reservas. Las fechas se calculan desde hoy
 * en La Paz (`proximo`), nunca se escriben: una fecha fija caduca sola.
 *
 * MENSAJES POR CONVERSACIÓN: 0 por turno; +1 donde H2 actúa. H1 y M1 cambian
 * el texto del mensaje que ya iba a salir; H2 reemplaza la confirmación por la
 * pregunta («¿Te la agendo?») en el MISMO mensaje, sin aviso a recepción ni
 * botón, y la confirmación llega después del «sí»: ese es el +1, solo en las
 * conversaciones donde el modelo agendó sin confirmación.
 */
import { describe, expect, it } from 'vitest';
import { codigoDe, destinos, ejecutar, leerFlujo, nodo, plantilla, type J } from './lib/flujo';

const FLUJOS = ['demo-a-agendamiento.json', 'platinum-agendamiento.json', 'bellido-agendamiento.json'] as const;

// --- Fechas calculadas desde hoy, en La Paz ----------------------------------
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
interface Fecha { iso: string; dia: number; semana: number; nombre: string }
function fechaEnLaPaz(ms: number): Fecha {
  const d = new Date(ms - 4 * 3600000);
  return { iso: d.toISOString().slice(0, 10), dia: d.getUTCDate(), semana: d.getUTCDay(), nombre: DIAS[d.getUTCDay()]! };
}
/** El próximo día con ese día de la semana (0 = domingo), de mañana en adelante. */
function proximo(semana: number): Fecha {
  for (let i = 1; i <= 14; i++) {
    const f = fechaEnLaPaz(Date.now() + i * 86400000);
    if (f.semana === semana) return f;
  }
  throw new Error('sin fecha');
}
const LUNES = proximo(1);
const DOMINGO = proximo(0);
const L = `${LUNES.nombre} ${LUNES.dia}`;          // «lunes 28»
const D = `${DOMINGO.nombre} ${DOMINGO.dia}`;      // «domingo 4»
const hora = (f: Fecha, hhmm: string) => `${f.iso}T${hhmm}:00-04:00`;

// --- Un consultorio ficticio de una sola persona -----------------------------
const DOCTOR = 'Dr. Tomás Quiroga';
const CAL = 'cal-ficticio-1';
const HORARIO = { lun: '11:00-18:00', mar: '11:00-18:00', mie: '11:00-18:00', jue: '14:00-18:00',
  vie: '11:00-18:00', sab: '09:00-12:00', dom: 'cerrado' };
const CFG: J = {
  funcionarios: JSON.stringify([{ nombre: DOCTOR, servicios: [], calendario: CAL, horario: HORARIO }]),
  tratamiento: 'Trata al cliente de tú.',
  mensajeReservaNoConfirmada: 'Disculpa, ese horario ya estaba tomado y no pude dejar tu cita registrada.',
  nombreNegocio: 'Consultorio Ficticio',
};
const USTED: J = { ...CFG, tratamiento: 'Trata al cliente de usted.' };
const TEL = '59170000001';

/** El almuerzo: un evento repetido de 13:00 a 14:00, como en la agenda real. */
const almuerzo = (f: Fecha): J => ({ id: `alm-${f.iso}`, summary: 'Sin citas - Almuerzo', recurringEventId: 'serie-alm',
  organizer: { email: CAL }, start: { dateTime: hora(f, '13:00') }, end: { dateTime: hora(f, '14:00') } });
const consulta = (f: Fecha, ocupados: J[] = [almuerzo(f)]): J => ({
  action: { tool: 'consultar_disponibilidad', toolInput: { inicio: hora(f, '09:00'), fin: hora(f, '19:00'), funcionario: DOCTOR } },
  observation: JSON.stringify(ocupados),
});
/** Una cita recién creada, como la devuelve Google: con `created` de ahora. */
const cita = (id: string, f: Fecha, desde: string, hasta: string): J => ({ id, summary: 'Cita Lucas Méndez — consulta',
  organizer: { email: CAL }, start: { dateTime: hora(f, desde) }, end: { dateTime: hora(f, hasta) },
  created: new Date().toISOString() });
const agendo = (ev: J): J => ({ action: { tool: 'agendar_cita',
  toolInput: { inicio: ev['start'].dateTime, fin: ev['end'].dateTime, funcionario: DOCTOR } }, observation: JSON.stringify([ev]) });

describe.each(FLUJOS)('%s · horarios ofrecidos, confirmación y lo ya ofrecido (27/09/2026)', (archivo) => {
  const f = leerFlujo(archivo);
  const cod = (n: string) => codigoDe(f, n);
  /** `Procesar respuesta` con los datos estáticos del flujo sobre `estado`. */
  const procesar = (userInput: string, output: string, pasos: J[] = [], estado: J | null = {}, cfg: J = CFG): J =>
    ejecutar(cod('Procesar respuesta'), [{ output, intermediateSteps: pasos }],
      { 'Normalizar entrada': [{ from: TEL, nombrePerfil: 'Lucas', userInput }], 'Config del negocio': [cfg] },
      estado === null ? {} : { $getWorkflowStaticData: () => estado })[0]!;
  const comprobar = (previa: J, eventos: J[], cfg: J = CFG) =>
    ejecutar(cod('Comprobar reserva'), eventos, { 'Procesar respuesta': [previa], 'Config del negocio': [cfg] });
  const retomar = (comprobado: J, borrado: J, previa: J) =>
    ejecutar(cod('Retomar respuesta'), [borrado], { 'Comprobar reserva': [comprobado],
      'Normalizar entrada': [{ from: TEL, userInput: String(previa['__userInput'] ?? '') }], 'Procesar respuesta': [previa] })[0]!;
  const reintento = (salida: J, retomado: J, estado: J = {}, cfg: J = CFG) =>
    ejecutar(cod('Procesar reintento'), [salida], { 'Retomar respuesta': [retomado], 'Config del negocio': [cfg] },
      { $getWorkflowStaticData: () => estado })[0]!;

  describe('H1 · una hora ofrecida sale de consultar_disponibilidad de ESE turno', () => {
    it('#6509: domingo cerrado y SIN consulta → ninguna hora sale; se dice que ese día no atiende y se pregunta', () => {
      const r = procesar('El cliente seleccionó la opción del menú: Recién nacido',
        `Soy la asistente virtual del consultorio. Para atender a tu recién nacido con el ${DOCTOR}, tengo disponibles el ${D} `
        + 'los siguientes turnos: 11:00, 11:30 o 12:00. ¿Cuál de estos horarios prefieres y cuál es el nombre completo de tu bebé?');
      const t = String(r['respuesta']);
      for (const h of ['11:00', '11:30', '12:00']) expect(t, h).not.toContain(h);
      expect(t).toContain(`El ${D} no atendemos.`);
      expect(t).toContain('¿Para qué día y en qué horario te acomoda? Reviso la agenda');
      // Lo que no habla de horas se queda: la presentación.
      expect(t.startsWith('Soy la asistente virtual del consultorio.')).toBe(true);
      expect(r['avisos']).toContain('horario_sin_consulta');
      expect(r['transferir']).toBe(false);
    });

    it('sin consulta en un día abierto: tampoco sale ninguna hora, y no se inventa que esté cerrado', () => {
      const r = procesar('Prefiero el lunes', `Para este ${L}, el ${DOCTOR} tiene disponibles a las 11:00, 11:30 o 14:00. ¿Cuál prefieres?`);
      const t = String(r['respuesta']);
      expect(t).not.toMatch(/\d{1,2}:\d{2}/);
      expect(t).not.toContain('no atendemos');
      expect(t).toContain('¿Para qué día y en qué horario te acomoda?');
    });

    it('el mismo día consultado en el turno: las horas libres salen tal cual', () => {
      const texto = `Para este ${L}, el ${DOCTOR} tiene disponibles los siguientes turnos: 11:00, 11:30 o 14:00. ¿Cuál prefieres?`;
      const r = procesar('Prefiero el lunes', texto, [consulta(LUNES)]);
      expect(r['respuesta']).toBe(texto);
      expect((r['avisos'] as string[]).filter((a) => a.startsWith('horario_'))).toEqual([]);
    });

    it('una hora OCUPADA (el almuerzo de 13:00 a 14:00) se quita de la lista; las otras quedan en su lugar', () => {
      const r = procesar('Prefiero el lunes', `Para este ${L} tengo 11:00, 13:00 o 14:00. ¿Cuál prefieres?`, [consulta(LUNES)]);
      expect(r['respuesta']).toBe(`Para este ${L} tengo 11:00 o 14:00. ¿Cuál prefieres?`);
      expect(r['avisos']).toContain('horario_ocupado');
    });

    it('una hora FUERA del horario del día (cierra a las 18:00) se quita', () => {
      const r = procesar('Prefiero el lunes', `El ${L} hay espacio a las 17:00, 17:30 o 18:30. ¿Cuál prefieres?`, [consulta(LUNES)]);
      expect(r['respuesta']).toBe(`El ${L} hay espacio a las 17:00 o 17:30. ¿Cuál prefieres?`);
      expect(r['avisos']).toContain('horario_fuera');
    });

    it('consultó el domingo y la agenda volvió VACÍA: un día cerrado se ve libre, y aun así no se ofrece', () => {
      const r = procesar('¿Y el domingo?', `El ${D} tengo libre todo el día: 11:00, 11:30 o 12:00. ¿Cuál prefieres?`, [consulta(DOMINGO, [])]);
      const t = String(r['respuesta']);
      expect(t).not.toMatch(/\d{1,2}:\d{2}/);
      expect(t).toContain(`El ${D} no atendemos.`);
      expect(r['avisos']).toContain('horario_cerrado');
    });

    it('antes de la anticipación mínima no se ofrece (el día lo calcula el código)', () => {
      // Mañana con una anticipación de 7 días: ninguna hora de mañana llega.
      const manana = fechaEnLaPaz(Date.now() + 86400000);
      const r = procesar('para mañana', 'Mañana tengo 11:00 o 11:30. ¿Cuál prefieres?', [consulta(manana)], {},
        { ...CFG, anticipacionMinimaMin: '10080' });
      expect(String(r['respuesta'])).not.toMatch(/\d{1,2}:\d{2}/);
      expect(r['avisos']).toContain('horario_pasado');
    });

    it('una cita CANCELADA en el mismo turno ya no ocupa: su hora se puede ofrecer (#6547)', () => {
      const propia = cita('ev-propia', LUNES, '11:30', '12:00');
      const pasos = [consulta(LUNES, [propia, almuerzo(LUNES)]),
        { action: { tool: 'buscar_mi_cita', toolInput: {} }, observation: JSON.stringify([propia]) },
        { action: { tool: 'cancelar_cita', toolInput: { eventoId: 'ev-propia' } }, observation: JSON.stringify({ success: true }) }];
      const r = procesar('Sí', `Listo, cancelé la anterior. Para el ${L} tengo 11:00, 11:30 o 14:00. ¿Cuál prefieres?`, pasos);
      expect(String(r['respuesta'])).toContain('11:00, 11:30 o 14:00');
    });

    it('lo que NO es una oferta no se toca: el horario de atención, una negación y una cita confirmada', () => {
      for (const texto of [
        'Atendemos de 11:00 a 18:00 de lunes a viernes.',
        'A las 13:00 no tenemos atención: es el almuerzo del doctor.',
        `Encontré tu cita del ${L} a las 11:30. ¿Confirmas que es esa?`,
      ]) {
        expect(procesar('hola', texto)['respuesta'], texto).toBe(texto);
      }
      // Una confirmación de una cita que SÍ se agendó en el turno tampoco se toca.
      const confirmo = `Listo, quedó agendada tu consulta para el ${L} a las 11:30.`;
      expect(procesar('hola', confirmo, [agendo(cita('ev-x', LUNES, '11:30', '12:00'))])['respuesta']).toBe(confirmo);
    });

    it('«a las 13:00 no hay, pero tengo 12:30 o 14:00»: la negada no cuenta como oferta', () => {
      const texto = `El ${L} a las 13:00 no hay, pero tengo 12:30 o 14:00. ¿Te sirve alguna?`;
      const r = procesar('Prefiero el lunes', texto, [consulta(LUNES)]);
      expect(r['respuesta']).toBe(texto);
    });

    it('«a las 5» es de la tarde si a la tarde vale; «2 horas» es una duración y no se toca', () => {
      const texto = `El ${L} tengo espacio a las 5 o a las 5 y media. ¿Te sirve alguna?`;
      expect(procesar('¿en la tarde?', texto, [consulta(LUNES)], null)['respuesta']).toBe(texto);
      const aviso = 'Para cancelar sin costo, avísanos con al menos 2 horas de anticipación.';
      expect(procesar('¿y si no llego?', aviso)['respuesta']).toBe(aviso);
    });

    it('«con el Dr. X» no corta la oración: la lista se juzga entera', () => {
      const r = procesar('Prefiero el lunes', `Para el ${L}, con el ${DOCTOR}, tengo 11:00, 13:00 o 14:00. ¿Cuál prefieres?`, [consulta(LUNES)]);
      expect(r['respuesta']).toBe(`Para el ${L}, con el ${DOCTOR}, tengo 11:00 o 14:00. ¿Cuál prefieres?`);
    });
  });

  describe('H2 · agendar exige HORA ELEGIDA y NOMBRE DICHO por el cliente (regla de Andres, 27/09)', () => {
    const ev17 = cita('ev17', LUNES, '17:00', '17:30');
    const DIJO = `Listo, quedó agendada la consulta para Lucas Méndez con el ${DOCTOR} para este ${L} a las 17:00.`;
    /** Lo que NO quedó en pie: sin hora elegida o sin nombre. */
    const noAgenda = (r: J): string[] => [...(r['agendaSinConfirmar'] as string[]), ...(r['agendaSinNombre'] as string[])];
    /** El cliente dijo el nombre del paciente en un turno anterior. */
    const dijoElNombre = (estado: J) => procesar('Es para Lucas Méndez', '¿Para qué día lo quieres?', [], estado);
    /** El asistente ofreció esas horas del lunes. */
    const ofrecio = (estado: J, horas: string) =>
      procesar('Prefiero el lunes', `El ${L} tengo ${horas}. ¿Cuál prefieres?`, [consulta(LUNES)], estado);
    const cita1130 = cita('ev1130', LUNES, '11:30', '12:00');

    it('oferta de 3 horas → el cliente nombra una, con el nombre conocido → AGENDA', () => {
      for (const [escribio, ev] of [['16.30', cita('ev1630', LUNES, '16:30', '17:00')], ['11.30 por favor', cita1130],
        ['la de las 11 y media', cita1130], ['agéndame a las 5 de la tarde', ev17]] as [string, J][]) {
        const estado: J = {};
        dijoElNombre(estado);
        ofrecio(estado, '11:30, 16:30 o 17:00');
        expect(noAgenda(procesar(escribio, 'Quedó agendada.', [consulta(LUNES), agendo(ev)], estado)), escribio).toEqual([]);
      }
    });

    it('oferta de 3 horas → «sí» → se DESHACE y se pregunta cuál', () => {
      const estado: J = {};
      dijoElNombre(estado);
      ofrecio(estado, '11:00, 11:30 o 17:00');
      const previa = procesar('sí', DIJO, [consulta(LUNES), agendo(ev17)], estado);
      expect(previa['agendaSinConfirmar']).toEqual(['ev17']);
      const c = comprobar(previa, [ev17])[0]!;
      expect(c).toMatchObject({ citaSolapada: true, causaDeLaCaida: 'sin_confirmar', reservaVerificada: false });
      expect(c['respuesta']).toBe(`¿Cuál de estas horas del ${L} prefieres: 11:00, 11:30 o 17:00?`);
    });

    it('oferta de 1 hora → «sí», con el nombre conocido → AGENDA', () => {
      const estado: J = {};
      dijoElNombre(estado);
      procesar('A las 17 no tiene?', `Sí, el ${L} a las 17:00 hay espacio. ¿Te la agendo?`, [consulta(LUNES)], estado);
      expect(noAgenda(procesar('sí', DIJO, [consulta(LUNES), agendo(ev17)], estado))).toEqual([]);
    });

    it('oferta de 1 hora → «sí», SIN nombre → `sin_nombre`: pide solo el nombre, y el turno siguiente con el nombre agenda', () => {
      const estado: J = {};
      procesar('A las 17 no tiene?', `Sí, el ${L} a las 17:00 hay espacio. ¿Te la agendo?`, [consulta(LUNES)], estado);
      const previa: J = { ...procesar('sí', DIJO, [consulta(LUNES), agendo(ev17)], estado), __userInput: 'sí' };
      expect(previa['agendaSinConfirmar']).toEqual([]);
      expect(previa['agendaSinNombre']).toEqual(['ev17']);
      expect(previa['avisos']).toContain('agendo_sin_nombre');
      const c = comprobar(previa, [ev17])[0]!;
      expect(c).toMatchObject({ citaSolapada: true, eventoABorrar: 'ev17', causaDeLaCaida: 'sin_nombre', transferir: false });
      // Solo el nombre: sin repetir horarios.
      expect(c['respuesta']).toBe(`Para reservar las 17:00 del ${L}, ¿a nombre de quién la agendo?`);
      expect(String(c['motivoCruce'])).toContain('SIN EL NOMBRE');
      const r = retomar(c, { success: true }, previa);
      expect(r['reintentar']).toBe(true);
      expect(String(r['notaCruce'])).toContain('todavía NO dijo a nombre de quién');
      const p = reintento({ output: 'x', intermediateSteps: [] }, r, estado);
      expect(p['respuesta']).toBe(c['respuesta']);
      expect(p['transferir']).toBe(false);
      expect(p['reintentoTrasCruce']).toBe('sin-confirmar');
      // La hora quedó ELEGIDA: con el nombre, se agenda sin preguntar otra vez.
      expect(estado['agendaPorTelefono'][TEL]['elegido']).toMatchObject({ fecha: LUNES.iso, min: 1020 });
      expect(noAgenda(procesar('Lucas Méndez', DIJO, [consulta(LUNES), agendo(ev17)], estado))).toEqual([]);
    });

    it('solo el NOMBRE, sin hora elegida → NO agenda', () => {
      const estado: J = {};
      ofrecio(estado, '11:00, 11:30 o 17:00');
      expect(procesar('Lucas Méndez', DIJO, [consulta(LUNES), agendo(ev17)], estado)['agendaSinConfirmar']).toEqual(['ev17']);
      // Ni siquiera sin nada guardado.
      expect(procesar('Lucas Méndez', DIJO, [consulta(LUNES), agendo(ev17)], {})['agendaSinConfirmar']).toEqual(['ev17']);
    });

    it('solo la HORA, sin nombre dicho → NO agenda (la hora sola no da el nombre)', () => {
      const estado: J = {};
      ofrecio(estado, '11:00, 11:30 o 17:00');
      const r = procesar('a las 17', DIJO, [consulta(LUNES), agendo(ev17)], estado);
      expect(r['agendaSinConfirmar']).toEqual([]);
      expect(r['agendaSinNombre']).toEqual(['ev17']);
    });

    it.each([
      ['¿a las 17?'], ['¿hay a las 17?'], ['tienes a las 17'], ['no tiene a las 17'], ['A las 17 no tiene'],
      ['(audio transcripto) y a las 5 de la tarde tendrá'], ['si tiene a las 17?'], ['Gracias. ¿Hay a las 17?'],
    ])('una PREGUNTA sobre horarios nunca elige, aunque la hora se haya ofrecido y el nombre se sepa: «%s»', (escribio) => {
      const estado: J = {};
      dijoElNombre(estado);
      ofrecio(estado, '11:00, 11:30 o 17:00');
      expect(procesar(escribio, DIJO, [consulta(LUNES), agendo(ev17)], estado)['agendaSinConfirmar']).toEqual(['ev17']);
    });

    it('el nombre del TÍTULO distinto del dicho por el cliente → se deshace; ni inventado ni del perfil de WhatsApp', () => {
      const estado: J = {};
      dijoElNombre(estado);
      ofrecio(estado, '11:00, 11:30 o 17:00');
      const otroNombre = { ...ev17, id: 'ev-otro', summary: 'Cita Lucía Méndez — consulta' };
      expect(procesar('a las 17', 'Quedó agendada.', [consulta(LUNES), agendo(otroNombre)], JSON.parse(JSON.stringify(estado)))['agendaSinNombre']).toEqual(['ev-otro']);
      // El perfil de WhatsApp se llama «Lucas» (ver `procesar`): sin haberlo escrito, no vale.
      const soloOferta: J = {};
      ofrecio(soloOferta, '11:00, 11:30 o 17:00');
      const delPerfil = { ...ev17, id: 'ev-perfil', summary: 'Cita Lucas — consulta' };
      expect(procesar('a las 17', 'Quedó agendada.', [consulta(LUNES), agendo(delPerfil)], soloOferta)['agendaSinNombre']).toEqual(['ev-perfil']);
      // Positiva: el mismo nombre que escribió, con o sin tildes, vale.
      const igual = { ...ev17, id: 'ev-igual', summary: 'Cita Lucas Mendez — consulta' };
      expect(noAgenda(procesar('a las 17', 'Quedó agendada.', [consulta(LUNES), agendo(igual)], estado))).toEqual([]);
    });

    it('el título se lee ANCLADO: «Cita — consulta» no tiene nombre, y «consulta» no es un nombre (revisión de ca88ced)', () => {
      for (const titulo of ['Cita — consulta', 'Cita— consulta', 'Cita Consulta — consulta', 'Cita Paciente — consulta',
        'PENDIENTE DE SEÑA · Cita — consulta', 'Cita Control del niño sano — control']) {
        const estado: J = {};
        procesar('quiero una consulta de control del niño sano para el paciente', 'Claro.', [], estado);
        ofrecio(estado, '11:00 o 17:00');
        const ev = { ...ev17, id: 'ev-t', summary: titulo };
        const r = procesar('a las 17', 'Quedó agendada.', [consulta(LUNES), agendo(ev)], estado);
        expect(r['agendaSinNombre'], titulo).toEqual(['ev-t']);
      }
      // Positiva: con el rótulo de la seña delante, el nombre dicho vale.
      const estado: J = {};
      dijoElNombre(estado);
      ofrecio(estado, '11:00 o 17:00');
      const conSena = { ...ev17, id: 'ev-s', summary: 'PENDIENTE DE SEÑA · Cita Lucas Méndez — consulta' };
      expect(noAgenda(procesar('a las 17', 'Quedó agendada.', [consulta(LUNES), agendo(conSena)], estado))).toEqual([]);
    });

    it('las palabras del SISTEMA no pasan por un nombre dicho: «(imagen) el cliente envió una foto» (revisión de ca88ced)', () => {
      for (const delSistema of ['(imagen) el cliente envió una foto', '(documento) el cliente envió un archivo',
        'AVISO_SISTEMA: el cliente envió su ubicación. Agradécela y sigue con la consulta.']) {
        const estado: J = {};
        procesar(delSistema, 'Gracias.', [], estado);
        ofrecio(estado, '11:00 o 17:00');
        const ev = { ...ev17, id: 'ev-c', summary: 'Cita Cliente — consulta' };
        const r = procesar('a las 17', 'Quedó agendada.', [consulta(LUNES), agendo(ev)], estado);
        expect(r['agendaSinNombre'], delSistema).toEqual(['ev-c']);
      }
      // Del menú interactivo cuenta el título de la opción, no el envoltorio.
      const menu: J = {};
      procesar('El cliente seleccionó la opción del menú: Recién nacido (id: control_recien_nacido)', 'Claro.', [], menu);
      const guardadas = menu['agendaPorTelefono'][TEL]['palabras'] as string[];
      expect(guardadas).toEqual(['recien', 'nacido']);
      for (const w of ['cliente', 'selecciono', 'opcion', 'menu', 'id', 'control_recien_nacido']) expect(guardadas).not.toContain(w);
    });

    it('del audio cuenta la TRANSCRIPCIÓN (de `Preparar transcripción`), sin el aviso que la acompaña', () => {
      const estado: J = {};
      ofrecio(estado, '11:00 o 17:00');
      const r = ejecutar(cod('Procesar respuesta'), [{ output: 'Quedó agendada.', intermediateSteps: [consulta(LUNES), agendo(ev17)] }],
        { 'Normalizar entrada': [{ from: TEL, nombrePerfil: 'Lucas', userInput: '(audio) el cliente envió una nota de voz' }],
          'Preparar transcripción': [{ userInput: '(audio transcripto) a las 17 por favor, para Lucas Méndez\n'
            + 'AVISO_SISTEMA: antes de ofrecer horarios o agendar, repite en una línea lo que entendiste del audio.' }],
          'Config del negocio': [CFG] }, { $getWorkflowStaticData: () => estado })[0]!;
      expect(noAgenda(r)).toEqual([]);
      expect(estado['agendaPorTelefono'][TEL]['palabras']).not.toContain('aviso');
      // Negativa: sin transcripción, la marca «(audio)» no elige ni nombra nada.
      const sinTexto: J = {};
      ofrecio(sinTexto, '11:00 o 17:00');
      expect(procesar('(audio) el cliente envió una nota de voz', 'Quedó agendada.', [consulta(LUNES), agendo(ev17)], sinTexto)['agendaSinConfirmar']).toEqual(['ev17']);
    });

    it('si la cita sin NOMBRE no aparece para deshacerla, el motivo lo dice así (revisión de ca88ced)', () => {
      const previa: J = { ...procesar('a las 17', DIJO, [consulta(LUNES), agendo(ev17)]),
        agendaSinConfirmar: [], agendaSinNombre: ['ev17'], eventosCreados: [{ id: 'ev17', calendario: '', inicio: '', fin: '' }] };
      const r = comprobar(previa, [])[0]!;
      expect(r['transferir']).toBe(true);
      expect(String(r['motivoTransferencia'])).toContain('SIN que el cliente dijera a nombre de quién');
      expect(String(r['motivoTransferencia'])).not.toContain('confirmara ese horario');
    });

    it('EL PRIMER NOMBRE ALCANZA (Andres, 27/09): «Lucas» dicho y «Lucas Méndez» en el título vale; «Lucía» por «Lucas», no', () => {
      const estado: J = {};
      procesar('Es para Lucas', '¿Para qué día?', [], estado);
      ofrecio(estado, '11:00 o 17:00');
      expect(noAgenda(procesar('a las 17', DIJO, [consulta(LUNES), agendo(ev17)], JSON.parse(JSON.stringify(estado))))).toEqual([]);
      const lucia = { ...ev17, id: 'ev-lucia', summary: 'Cita Lucía Méndez — consulta' };
      expect(procesar('a las 17', 'Quedó agendada.', [consulta(LUNES), agendo(lucia)], estado)['agendaSinNombre']).toEqual(['ev-lucia']);
      // La primera palabra de NOMBRE: «Consulta» no cuenta, «Lucas» sí.
      const conServicio = { ...ev17, id: 'ev-cs', summary: 'Cita Consulta Lucas — consulta' };
      const otro: J = {};
      procesar('Es para Lucas', '¿Para qué día?', [], otro);
      ofrecio(otro, '11:00 o 17:00');
      expect(noAgenda(procesar('a las 17', 'Quedó agendada.', [consulta(LUNES), agendo(conServicio)], otro))).toEqual([]);
    });

    it('#6555 de punta a punta: «A las 17 no tiene?» + agendar_cita → se deshace y sale «¿Te la agendo?»; el «sí» siguiente agenda', () => {
      const estado: J = {};
      dijoElNombre(estado);
      const previa: J = { ...procesar('A las 17 no tiene?', DIJO, [consulta(LUNES), agendo(ev17)], estado), __userInput: 'A las 17 no tiene?' };
      expect(previa['agendaSinConfirmar']).toEqual(['ev17']);
      expect(previa['verificarReserva']).toBe(true);              // el candado corre igual
      const c = comprobar(previa, [almuerzo(LUNES), ev17]);
      expect(c).toHaveLength(1);
      expect(c[0]).toMatchObject({ citaSolapada: true, eventoABorrar: 'ev17', calendarioDelBorrado: CAL,
        reservaVerificada: false, causaDeLaCaida: 'sin_confirmar', transferir: false });
      expect(c[0]!['respuesta']).toBe(`Sí, el ${L} a las 17:00 hay espacio. ¿Te la agendo?`);
      expect(destinos(f, '¿Deshacer cita solapada?', 0)).toEqual(['Deshacer cita solapada']);
      const r = retomar(c[0]!, { success: true }, previa);
      expect(r['reintentar']).toBe(true);
      expect(String(r['notaCruce'])).toContain('NO había confirmado');
      const p = reintento({ output: 'Claro, te cuento que sí hay espacio.', intermediateSteps: [] }, r, estado);
      expect(p['respuesta']).toBe(`Sí, el ${L} a las 17:00 hay espacio. ¿Te la agendo?`);
      expect(p['ejecutoAgendar']).toBe(false);
      expect(noAgenda(procesar('Sí', DIJO, [consulta(LUNES), agendo(ev17)], estado))).toEqual([]);
    });

    it('VERBO NO PREVISTO y la herramienta SÍ corrió: se deshace igual, por el hecho', () => {
      const previa = procesar('A las 17 no tiene?', `Perfecto, te dejé anotadito para el ${L} a las 17:00.`,
        [consulta(LUNES), agendo(ev17)]);
      expect(previa['afirmaAgendo']).toBe(false);
      expect(previa['ejecutoAgendar']).toBe(true);
      expect(previa['agendaSinConfirmar']).toEqual(['ev17']);
      expect(comprobar(previa, [ev17])[0]).toMatchObject({ citaSolapada: true, causaDeLaCaida: 'sin_confirmar' });
    });

    it('una hora que nadie le ofreció no queda elegida por nombrarla: primero se le dice si hay', () => {
      const estado: J = {};
      dijoElNombre(estado);
      expect(procesar('quiero a las 17', DIJO, [consulta(LUNES), agendo(ev17)], estado)['agendaSinConfirmar']).toEqual(['ev17']);
    });

    it('nombrar OTRA hora no confirma la que se agendó', () => {
      const estado: J = {};
      dijoElNombre(estado);
      ofrecio(estado, '16:30 o 17:00');
      expect(procesar('a las 16:30 por favor', DIJO, [consulta(LUNES), agendo(ev17)], estado)['agendaSinConfirmar']).toEqual(['ev17']);
    });

    it('una confirmación seguida de OTRA pregunta sigue confirmando (revisión del #244)', () => {
      const una: J = {};
      dijoElNombre(una);
      procesar('¿a las 11:30?', `Sí, el ${L} a las 11:30 hay espacio. ¿Te la agendo?`, [consulta(LUNES)], una);
      expect(noAgenda(procesar('Sí, la de 11:30. ¿Tengo que llevar algo?', 'Quedó agendada.', [consulta(LUNES), agendo(cita1130)], JSON.parse(JSON.stringify(una))))).toEqual([]);
      expect(noAgenda(procesar('Sí, perfecto. ¿Hay estacionamiento?', 'Quedó agendada.', [consulta(LUNES), agendo(cita1130)], una))).toEqual([]);
    });

    it('«la segunda» elige la segunda hora de la oferta; sin agendar queda elegida para el turno del nombre', () => {
      const estado: J = {};
      ofrecio(estado, '11:00, 11:30 o 14:00');
      const ev1100 = cita('ev1100', LUNES, '11:00', '11:30');
      const conNombre = JSON.parse(JSON.stringify(estado)) as J;
      dijoElNombre(conNombre);
      ofrecio(conNombre, '11:00, 11:30 o 14:00');
      expect(noAgenda(procesar('la segunda', 'Quedó agendada.', [consulta(LUNES), agendo(cita1130)], JSON.parse(JSON.stringify(conNombre))))).toEqual([]);
      expect(procesar('la segunda', 'Quedó agendada.', [consulta(LUNES), agendo(ev1100)], JSON.parse(JSON.stringify(conNombre)))['agendaSinConfirmar']).toEqual(['ev1100']);
      procesar('la segunda', 'Perfecto. ¿Cuál es el nombre completo del paciente?', [], estado);
      expect(estado['agendaPorTelefono'][TEL]['elegido']).toMatchObject({ fecha: LUNES.iso, min: 690 });
      expect(noAgenda(procesar('Lucas Méndez', 'Quedó agendada.', [consulta(LUNES), agendo(cita1130)], estado))).toEqual([]);
    });

    it('cancelar la vieja y agendar la nueva SIN elegir: el mensaje dice que la vieja quedó cancelada (revisión del #244)', () => {
      const estado: J = {};
      ofrecio(estado, '11:00, 14:00 o 17:00');
      const vieja = cita('ev-vieja', LUNES, '11:30', '12:00');
      const pasos = [
        { action: { tool: 'buscar_mi_cita', toolInput: {} }, observation: JSON.stringify([vieja]) },
        { action: { tool: 'cancelar_cita', toolInput: { eventoId: 'ev-vieja' } }, observation: JSON.stringify({ success: true }) },
        consulta(LUNES), agendo(ev17)];
      const previa = procesar('Sí', 'Listo, cancelé la anterior y te agendé a las 17:00.', pasos, estado);
      expect(previa['agendaSinConfirmar']).toEqual(['ev17']);
      expect(previa['canceladasEnElTurno']).toEqual([{ id: 'ev-vieja', desc: expect.stringContaining('11:30') }]);
      const c = comprobar(previa, [ev17])[0]!;
      expect(String(c['respuesta'])).toMatch(/^Tu cita de consulta del .*11:30 quedó cancelada\. ¿Cuál de estas horas del .* prefieres: 11:00, 14:00 o 17:00\?$/);
      // Negativa: sin cancelación en el turno, la pregunta sale sola.
      const sola = comprobar(procesar('A las 17 no tiene?', DIJO, [consulta(LUNES), agendo(ev17)]), [ev17])[0]!;
      expect(sola['respuesta']).toBe(`Sí, el ${L} a las 17:00 hay espacio. ¿Te la agendo?`);
    });

    it('sin confirmar y la cita creada no aparece para deshacerla: pasa a recepción (revisión del #244)', () => {
      const previa = procesar('A las 17 no tiene?', DIJO, [consulta(LUNES), agendo(ev17)]);
      const sinCalendario = { ...previa, eventosCreados: [{ id: 'ev17', calendario: '', inicio: '', fin: '' }] };
      const r = comprobar(sinCalendario, [])[0]!;
      expect(r['transferir']).toBe(true);
      expect(String(r['motivoTransferencia'])).toContain('SIN que el cliente confirmara');
      const confirmada = { ...sinCalendario, agendaSinConfirmar: [], agendaSinNombre: [] };
      expect(comprobar(confirmada, [])[0]!['transferir']).not.toBe(true);
    });

    it('LA REGLA MANDATORIA SIGUE PRIMERO: si además choca con la cita de OTRA persona, cede por CRUCE', () => {
      const otra = { id: 'otra', summary: 'Cita OTRA PACIENTE — consulta', organizer: { email: CAL },
        start: { dateTime: hora(LUNES, '17:00') }, end: { dateTime: hora(LUNES, '17:30') }, created: '2026-09-01T12:00:00.000Z' };
      for (const escribio of ['A las 17 no tiene?', 'a las 17']) {
        const estado: J = {};
        ofrecio(estado, '11:00 o 17:00');
        const c = comprobar(procesar(escribio, DIJO, [consulta(LUNES), agendo(ev17)], estado), [otra, ev17])[0]!;
        expect(c, escribio).toMatchObject({ citaSolapada: true, eventoABorrar: 'ev17', causaDeLaCaida: 'cruce' });
        expect(c['respuesta']).toBe(CFG['mensajeReservaNoConfirmada']);
      }
    });

    it('si no se pudo deshacer, no se le pregunta nada falso: sale lo agendado y recepción confirma', () => {
      const previa: J = { ...procesar('A las 17 no tiene?', DIJO, [consulta(LUNES), agendo(ev17)]), __userInput: 'A las 17 no tiene?' };
      const c = comprobar(previa, [ev17])[0]!;
      const r = retomar(c, { error: 'Google 403' }, previa);
      expect(r['reintentar']).toBe(false);
      expect(r['transferir']).toBe(true);
      expect(r['respuesta']).toBe(DIJO);
      expect(String(r['motivoTransferencia'])).toContain('NO SE PUDO DESHACER');
    });

    it('de usted: «¿Se la agendo?»', () => {
      const previa = procesar('¿A las 17 no tiene?', DIJO, [consulta(LUNES), agendo(ev17)], {}, USTED);
      expect(comprobar(previa, [ev17], USTED)[0]!['respuesta']).toBe(`Sí, el ${L} a las 17:00 hay espacio. ¿Se la agendo?`);
    });

    it('el reintento recibe la instrucción de repetir la pregunta, en los dos casos, y su sistema lo sabe', () => {
      const linea = String(nodo(f, 'Reintento tras cruce').parameters['text']).split('\n')
        .find((l) => l.includes("['sin_confirmar', 'sin_nombre'].includes("))!;
      for (const causa of ['sin_confirmar', 'sin_nombre']) {
        const texto = plantilla('=' + linea, {}, {
          'Retomar respuesta': [{ causaDeLaCaida: causa, notaCruce: 'nota',
            respuesta: `Para reservar las 17:00 del ${L}, ¿a nombre de quién la agendo?`, userInput: 'sí' }] });
        expect(texto, causa).toContain(`Respóndele EXACTAMENTE esto, sin agregar nada: «Para reservar las 17:00 del ${L}, ¿a nombre de quién la agendo?»`);
        expect(texto).toContain('En este turno NO puedes agendar ni confirmar nada.');
      }
      const sistema = String(nodo(f, 'Reintento tras cruce').parameters['options'].systemMessage);
      expect(sistema).toContain("['sin_confirmar', 'sin_nombre'].includes(");
    });

    it('el prompt dice la regla: hora elegida y nombre dicho, nunca el del perfil', () => {
      const p = String(nodo(f, 'AI Agent (Sofía)').parameters['options'].systemMessage);
      expect(p).toContain('AGENDAS SOLO CON DOS COSAS DICHAS POR EL CLIENTE');
      expect(p).toContain('nunca el del perfil de WhatsApp');
    });
  });

  describe('Grilla del chat: solo en punto o y media (pedido del doctor, 27/09; vale para todos)', () => {
    /** Una cita que recepción cargó a mano, hace `haceMin` minutos. */
    const manual = (id: string, desde: string, hasta: string, haceMin = 60, titulo = 'Cita Hermano Uno — consulta'): J => ({
      id, summary: titulo, organizer: { email: CAL }, start: { dateTime: hora(LUNES, desde) }, end: { dateTime: hora(LUNES, hasta) },
      created: new Date(Date.now() - haceMin * 60000).toISOString() });
    const M1615 = manual('m1615', '16:15', '16:30');
    /** El cliente eligió esa hora de una oferta y dijo su nombre: H2 no la deshace. */
    const elegida = (hhmm: string, ocupados: J[]): J => {
      const [h, m] = hhmm.split(':').map(Number) as [number, number];
      const min = h * 60 + m;
      const estado: J = { agendaPorTelefono: { [TEL]: { ofrecidos: { [LUNES.iso]: [min, 600] },
        ultima: { fecha: LUNES.iso, mins: [min, 600], desde: Date.now() }, elegido: null, palabras: ['lucas', 'mendez'], desde: Date.now() } } };
      const fin = new Date(Date.parse(hora(LUNES, hhmm)) + 30 * 60000 - 4 * 3600000).toISOString().slice(11, 16);
      const ev = cita(`ev${h}${m}`, LUNES, hhmm, fin);
      const previa = procesar(hhmm, 'Quedó agendada.', [consulta(LUNES, [almuerzo(LUNES), ...ocupados]), agendo(ev)], estado);
      expect(noAgenda(previa), hhmm).toEqual([]);
      return { previa, ev };
    };
    const noAgenda = (r: J): string[] => [...(r['agendaSinConfirmar'] as string[]), ...(r['agendaSinNombre'] as string[])];

    it('con una manual de 16:15 a 16:30: se ofrece 16:30, y NUNCA 16:00 (se superpone), 16:15 ni 16:45', () => {
      const r = procesar('Prefiero el lunes', `El ${L} tengo 16:00, 16:15, 16:30 o 16:45. ¿Cuál prefieres?`,
        [consulta(LUNES, [almuerzo(LUNES), M1615])]);
      expect(r['respuesta']).toBe(`El ${L} tengo 16:30. ¿Cuál prefieres?`);
      expect(r['avisos']).toEqual(expect.arrayContaining(['horario_ocupado', 'horario_fuera_de_grilla']));
    });

    it('agendada a las 16:30 queda; a las 16:00 cede por CRUCE con la manual', () => {
      const bien = elegida('16:30', [M1615]);
      const c = comprobar(bien.previa, [M1615, bien.ev])[0]!;
      expect(c['reservaVerificada']).toBe(true);
      expect(c['citaSolapada']).toBeUndefined();
      const mal = elegida('16:00', [M1615]);
      expect(comprobar(mal.previa, [M1615, mal.ev])[0]).toMatchObject({ citaSolapada: true, eventoABorrar: mal.ev['id'], causaDeLaCaida: 'cruce' });
    });

    it('agendada a las 16:45 se DESHACE (fuera de grilla); a las 16:15, por cruce con la manual', () => {
      const c = elegida('16:45', [M1615]);
      const r = comprobar(c.previa, [M1615, c.ev])[0]!;
      expect(r).toMatchObject({ citaSolapada: true, eventoABorrar: c.ev['id'], causaDeLaCaida: 'fuera_de_grilla' });
      expect(String(r['motivoCruce'])).toContain('FUERA DE LA GRILLA');
      const ret = retomar(r, { success: true }, c.previa);
      expect(ret['reintentar']).toBe(true);
      expect(String(ret['notaCruce'])).toContain('no cae en punto ni y media');
      const q = elegida('16:15', [M1615]);
      expect(comprobar(q.previa, [M1615, q.ev])[0]).toMatchObject({ citaSolapada: true, causaDeLaCaida: 'cruce' });
      // Negativa: sin la manual, 16:15 igual cede por la grilla.
      const sola = elegida('16:15', []);
      expect(comprobar(sola.previa, [sola.ev])[0]).toMatchObject({ citaSolapada: true, causaDeLaCaida: 'fuera_de_grilla' });
    });

    it('con una manual de 16:15 a 16:45, 16:30 tampoco: ni ofrecida ni agendada', () => {
      const larga = manual('m-larga', '16:15', '16:45');
      const r = procesar('Prefiero el lunes', `El ${L} tengo 16:30 o 17:00. ¿Cuál prefieres?`, [consulta(LUNES, [almuerzo(LUNES), larga])]);
      expect(r['respuesta']).toBe(`El ${L} tengo 17:00. ¿Cuál prefieres?`);
      const c = elegida('16:30', [larga]);
      expect(comprobar(c.previa, [larga, c.ev])[0]).toMatchObject({ citaSolapada: true, causaDeLaCaida: 'cruce' });
    });

    it('dos citas manuales a la MISMA hora (hermanos), cargadas hace un minuto, no rompen nada', () => {
      const h1 = manual('h1', '16:15', '16:30', 1, 'Cita Hermanos — consulta');
      const h2 = manual('h2', '16:15', '16:30', 1, 'Cita Hermanos — consulta');
      const c = elegida('16:30', [h1, h2]);
      const r = comprobar(c.previa, [h1, h2, c.ev]);
      expect(r).toHaveLength(1);
      expect(r[0]!['reservaVerificada']).toBe(true);
      expect(r[0]!['citaSolapada']).toBeUndefined();     // no se borra ninguna de las manuales
      expect(r[0]!['transferir']).not.toBe(true);         // ni se avisa de «duplicadas»
      expect(r[0]!['eventoId']).toBe(c.ev['id']);
      // Y ofrecer 16:30 al lado de ellas sigue valiendo.
      const o = procesar('Prefiero el lunes', `El ${L} tengo 16:30. ¿Te sirve?`, [consulta(LUNES, [almuerzo(LUNES), h1, h2])]);
      expect(o['respuesta']).toBe(`El ${L} tengo 16:30. ¿Te sirve?`);
    });

    it('«¿a las 16:15?» se contesta con la grilla y lo más cercano libre', () => {
      const r = procesar('¿a las 16:15?', `Sí, a las 16:15 hay espacio el ${L}. ¿Te la agendo?`, [consulta(LUNES, [almuerzo(LUNES), M1615])]);
      expect(r['respuesta']).toBe(`Por este chat las citas son en punto o y media: las 16:15 no te la puedo dar. Lo más cercano libre ese día es 15:30 o 16:30. ¿Te sirve alguna?`);
    });

    it('el prompt lo dice, en los tres flujos, y el del reintento también', () => {
      expect(String(nodo(f, 'AI Agent (Sofía)').parameters['options'].systemMessage)).toContain('OFRECE SOLO HORAS EN PUNTO O Y MEDIA');
      expect(String(nodo(f, 'Reintento tras cruce').parameters['options'].systemMessage)).toContain('solo en punto o y media');
    });
  });

  describe('Las reglas del prompt están UNA vez cada una, y la vieja no está', () => {
    it('AGENDAS SOLO…, SI PIDE OTRA HORA… y OFRECE SOLO HORAS EN PUNTO… una vez; «UNA PREGUNTA NO ES UNA CONFIRMACIÓN», nunca', () => {
      const p = String(nodo(f, 'AI Agent (Sofía)').parameters['options'].systemMessage);
      for (const r of ['- AGENDAS SOLO CON DOS COSAS DICHAS POR EL CLIENTE', '- SI PIDE OTRA HORA U OTRA FRANJA',
        '- OFRECE SOLO HORAS EN PUNTO O Y MEDIA']) {
        expect(p.split(r).length - 1, r).toBe(1);
      }
      expect(p).not.toContain('UNA PREGUNTA NO ES UNA CONFIRMACIÓN');
    });
  });

  describe('M1 · si pide otra cosa, no se le repite lo mismo', () => {
    /** La conversación real hasta el primer pedido: se ofrecieron 11:00, 11:30 y 14:00 del lunes. */
    const conOferta = (): J => {
      const estado: J = {};
      procesar('Prefiero el lunes', `Para este ${L}, el ${DOCTOR} tiene disponibles: 11:00, 11:30 o 14:00. ¿Cuál prefieres?`,
        [consulta(LUNES)], estado);
      return estado;
    };
    const REPITE = `Para este ${L}, el ${DOCTOR} tiene disponibles a las 11:00, 11:30 o 14:00. ¿Cuál prefieres?`;

    it('#6527 «Tienes a las 13?» con consulta: se contesta sobre las 13 (ocupado) y lo más cercano libre', () => {
      const r = procesar('Tienes a las 13?', `A las 13:00 no tenemos atención disponible. ${REPITE}`, [consulta(LUNES)], conOferta());
      expect(r['respuesta']).toBe(`El ${L} a las 13:00 ya está ocupado. Lo más cercano libre ese día es 12:30 o 14:00. ¿Te sirve alguna?`);
      expect(r['avisos']).toContain('hora_pedida_respondida');
    });

    it('#6527 SIN consulta: no se repiten las tres horas; se pregunta por la que pidió', () => {
      const r = procesar('Tienes a las 13?', `A las 13:00 no tenemos atención disponible. ${REPITE}`, [], conOferta());
      expect(r['respuesta']).toBe(`¿Quieres el ${L} a las 13:00? Así reviso la agenda del ${DOCTOR}.`);
    });

    it('«A las 17 no tiene?» y el modelo repite la lista: si está libre, se le dice que sí y se pregunta', () => {
      const r = procesar('A las 17 no tiene?', REPITE, [consulta(LUNES)], conOferta());
      expect(r['respuesta']).toBe(`Sí, el ${L} a las 17:00 hay espacio. ¿Te la agendo?`);
    });

    it('#6551 «En la tarde?»: horas de la tarde que no se le dieron', () => {
      const r = procesar('En la tarde?', `Para este ${L} en la tarde, el ${DOCTOR} tiene disponibles a las 14:00, 14:30 o 15:00. ¿Cuál prefieres?`,
        [consulta(LUNES)], conOferta());
      expect(r['respuesta']).toBe(`El ${L} en la tarde hay espacio a las 14:30, 15:00 o 15:30. ¿Cuál prefieres?`);
      expect(r['avisos']).toContain('franja_sin_repetir');
    });

    it('#6583 «Ya me diste 3 veces los mismos»: horas nuevas del mismo día', () => {
      const r = procesar(`Que otros horarios tienes el ${LUNES.dia}? Ya me diste 3 veces los mismos y no quiero`, REPITE,
        [consulta(LUNES)], conOferta());
      expect(r['respuesta']).toBe(`El ${L} también hay espacio a las 12:00, 12:30 o 14:30. ¿Cuál prefieres?`);
      expect(r['avisos']).toContain('otros_horarios_sin_repetir');
    });

    it('#6578 «Quiero a las 19» (cierra a las 18:00): no se atiende a esa hora, y la más cercana', () => {
      const r = procesar('Quiero a las 19', `A las 19:00 el consultorio ya se encuentra cerrado. ${REPITE}`, [consulta(LUNES)], conOferta());
      expect(r['respuesta']).toBe(`El ${L} a las 19:00 no atendemos. Lo más cercano libre ese día es 17:30. ¿Te sirve?`);
    });

    it('si el modelo ya ofreció horas nuevas de la franja, su texto queda', () => {
      const texto = `El ${L} en la tarde tengo 15:00 o 16:00. ¿Cuál prefieres?`;
      expect(procesar('¿en la tarde?', texto, [consulta(LUNES)], conOferta())['respuesta']).toBe(texto);
    });

    it('lo ofrecido queda por teléfono y por fecha; sin datos estáticos no se filtra nada', () => {
      const estado = conOferta();
      expect(estado['agendaPorTelefono'][TEL]['ofrecidos'][LUNES.iso]).toEqual([660, 690, 840]);
      expect(procesar('¿otro horario?', REPITE, [consulta(LUNES)], null)['respuesta']).toBe(REPITE);
    });
  });

  describe('Retomar respuesta con causas mezcladas (revisión del #244)', () => {
    it('la cita sin confirmar no se describe como ocupada ni fuera de horario', () => {
      const base = { respuesta: 'x', motivoCruce: 'm', citasCaidas: [
        { hora: '10:00', fecha: 'lunes, 5', persona: DOCTOR, causa: 'cruce' },
        { hora: '17:00', fecha: 'lunes, 5', persona: DOCTOR, causa: 'sin_confirmar' }] };
      const r = retomar(base, { success: true }, { respuesta: 'x' });
      const nota = String(r['notaCruce']);
      expect(nota).toContain('el horario de las 10:00 del lunes, 5');
      expect(nota).toContain('ya estaba ocupado');
      expect(nota).toContain('NO había confirmado las 17:00 del lunes, 5');
      // Negativa: las 17:00 NO aparecen en la parte de «ocupado».
      expect(nota.split('; además,')[0]).not.toContain('17:00');
      const horario = retomar({ ...base, citasCaidas: [{ ...base.citasCaidas[0], causa: 'cerrado' }, base.citasCaidas[1]] },
        { success: true }, { respuesta: 'x' });
      expect(String(horario['notaCruce']).split('; además,')[0]).toBe(`las 10:00 del lunes, 5 con ${DOCTOR} cae fuera del horario de atencion`);
    });
  });

  describe('El registro por teléfono vencido no se reutiliza (revisión del #244)', () => {
    it('Procesar reintento barre el registro de hace más de una hora antes de escribir', () => {
      const estado: J = { agendaPorTelefono: { [TEL]: { ofrecidos: { '2000-01-01': [600] }, ultima: null,
        elegido: { fecha: '2000-01-01', min: 600, desde: 0 }, desde: Date.now() - 2 * 3600000 } } };
      const r = retomar({ respuesta: `Sí, el ${L} a las 17:00 hay espacio. ¿Te la agendo?`, causaDeLaCaida: 'sin_confirmar',
        citasCaidas: [{ hora: '17:00', causa: 'sin_confirmar' }], from: TEL }, { success: true }, { respuesta: 'x' });
      reintento({ output: 'ok' }, { ...r, from: TEL }, estado);
      const reg = estado['agendaPorTelefono'][TEL];
      expect(Object.keys(reg['ofrecidos'])).toEqual([LUNES.iso]);
      expect(reg['elegido']).toBeNull();
      // Negativa: uno vigente se conserva y se le suma.
      const vigente: J = { agendaPorTelefono: { [TEL]: { ofrecidos: { [LUNES.iso]: [660] }, ultima: null, elegido: null, desde: Date.now() } } };
      reintento({ output: 'ok' }, { ...r, from: TEL }, vigente);
      expect(vigente['agendaPorTelefono'][TEL]['ofrecidos'][LUNES.iso]).toEqual([660, 1020]);
    });
  });

  describe('El reintento tras un cruce también ofrece solo lo que consultó', () => {
    const base: J = { respuesta: CFG['mensajeReservaNoConfirmada'], motivoCruce: 'se intento agendar sobre un horario YA OCUPADO',
      causaDeLaCaida: 'cruce', from: TEL, avisos: [] };
    it('las horas que no pasan se quitan; si no queda ninguna, va la red de siempre (texto fijo y recepción)', () => {
      const parcial = reintento({ output: `Ese horario ya estaba ocupado. El ${L} tengo 11:00, 13:00 o 14:00. ¿Cuál prefieres?`,
        intermediateSteps: [consulta(LUNES)] }, base);
      expect(parcial['respuesta']).toBe(`Ese horario ya estaba ocupado. El ${L} tengo 11:00 o 14:00. ¿Cuál prefieres?`);
      expect(parcial['reintentoTrasCruce']).toBe('ok');
      const nada = reintento({ output: `Ese horario ya estaba ocupado. El ${L} tengo 11:00 o 11:30. ¿Cuál prefieres?`,
        intermediateSteps: [] }, base);
      expect(nada['reintentoTrasCruce']).toBe('horario-no-verificado');
      expect(nada['respuesta']).toBe(CFG['mensajeReservaNoConfirmada']);
      expect(nada['transferir']).toBe(true);
    });
  });

  describe('Mensajes por conversación: 0 por turno; +1 donde H2 actúa', () => {
    it('H2 sale por el camino del reintento, con un solo mensaje y sin aviso a recepción ni botón', () => {
      expect(destinos(f, 'Procesar reintento')).toEqual(['Mensaje a enviar', '¿Transferir a humano?']);
      const salida = ejecutar(cod('Mensaje a enviar'), [{ from: TEL, respuesta: `Sí, el ${L} a las 17:00 hay espacio. ¿Te la agendo?`,
        transferir: false }], { 'Normalizar entrada': [{ recibidoEn: Date.now() }], 'Config del negocio': [{ numeroRecepcion: '59170000002' }] });
      expect(salida).toHaveLength(1);
      expect(salida[0]!['enviarContacto']).toBe(false);
    });
  });

  describe('Ensayo del 28/09 en el Demo A: lo que falló con el teléfono real', () => {
    const DRA = 'Dra. Ana Pérez';
    const CFG2: J = { ...CFG, funcionarios: JSON.stringify([
      { nombre: DOCTOR, servicios: [], calendario: CAL, horario: HORARIO },
      { nombre: DRA, servicios: [], calendario: 'cal-ficticio-2', horario: HORARIO }]) };
    const consultaDe = (quien: string, f: Fecha): J => ({ action: { tool: 'consultar_disponibilidad',
      toolInput: { inicio: hora(f, '09:00'), fin: hora(f, '19:00'), funcionario: quien } }, observation: JSON.stringify([almuerzo(f)]) });

    it('#7167: eligió las 15:30, dio el nombre y el modelo agendó OTRA hora ⇒ se deshace y se pregunta por las 15:30', () => {
      const estado: J = { agendaPorTelefono: { [TEL]: { ofrecidos: { [LUNES.iso]: [930] },
        ultima: { fecha: LUNES.iso, mins: [930], desde: Date.now() }, elegido: { fecha: LUNES.iso, min: 930, desde: Date.now() },
        palabras: [], desde: Date.now() } } };
      const ev = { ...cita('ev-11', LUNES, '11:00', '11:30'), summary: 'Cita Andres — consulta' };
      const r = procesar('Andres', `Queda confirmada tu cita el ${L} a las 11:00.`, [consulta(LUNES), agendo(ev)], estado);
      expect(r['agendaSinConfirmar']).toEqual(['ev-11']);
      expect(r['eleccionPendiente']).toEqual({ dia: L, hora: '15:30' });
      // Su «sí» del turno siguiente confirma las 15:30, no las 11:00.
      expect(estado['agendaPorTelefono'][TEL].ultima.mins).toEqual([930]);
      expect(estado['agendaPorTelefono'][TEL].elegido).toMatchObject({ fecha: LUNES.iso, min: 930 });
      const c = comprobar(r, [ev])[0]!;
      expect(String(c['respuesta'])).toContain(`¿Te la reservo el ${L} a las 15:30?`);
      expect(String(c['respuesta'])).not.toContain('11:00');
      // Negativa: sin hora elegida antes, la pregunta sigue siendo por la agendada.
      const sinEleccion = procesar('Andres', `Queda confirmada tu cita el ${L} a las 11:00.`, [consulta(LUNES), agendo(ev)], {});
      expect(sinEleccion['eleccionPendiente']).toBeNull();
    });

    it('#7117: se consultó la agenda de UNO y la oferta dice «con los dos» ⇒ se ofrece solo con el consultado', () => {
      const dijo = `El ${L} hay espacio a las 14:00, 15:30 o 17:00 con el ${DOCTOR} y con la ${DRA}. ¿Cuál prefieres?`;
      const r = procesar('Prefiero el lunes', dijo, [consultaDe(DOCTOR, LUNES)], {}, CFG2);
      expect(r['respuesta']).toBe(`El ${L} hay espacio a las 14:00, 15:30 o 17:00 con el ${DOCTOR}. ¿Cuál prefieres?`);
      expect(r['avisos']).toContain('horario_persona_sin_consulta');
      // Positiva: con las dos agendas consultadas, sale tal cual.
      expect(procesar('Prefiero el lunes', dijo, [consultaDe(DOCTOR, LUNES), consultaDe(DRA, LUNES)], {}, CFG2)['respuesta']).toBe(dijo);
    });

    it('#7122: «¿y a las 14?» consultando a uno y ofreciendo con los dos ⇒ «Sí, … con el consultado»', () => {
      const r = procesar('¿y a las 14?', `Sí, a las 14:00 hay espacio el ${L} con el ${DOCTOR} y con la ${DRA}. ¿Con cuál te la agendo?`,
        [consultaDe(DOCTOR, LUNES)], {}, CFG2);
      expect(r['respuesta']).toBe(`Sí, el ${L} a las 14:00 hay espacio con el ${DOCTOR}. ¿Te la agendo?`);
    });

    it('#7126: «a las 16:15 con perez» sin consulta ⇒ la grilla con el día y la doctora, nunca «¿para qué día y horario?»', () => {
      const estado: J = { agendaPorTelefono: { [TEL]: { ofrecidos: { [LUNES.iso]: [840] },
        ultima: { fecha: LUNES.iso, mins: [840], desde: Date.now() }, elegido: null, palabras: [], desde: Date.now() } } };
      const r = procesar('a las 16:15 con perez',
        `Para brindarte una atención precisa, por este chat agendamos en horarios en punto o y media. A las 16:00 o a las 16:30 `
        + `tenemos disponibilidad con la ${DRA} el ${L}.\n\n¿Cuál de estos dos horarios te agendo?`, [], estado, CFG2);
      expect(r['respuesta']).toBe(`Por este chat las citas son en punto o y media: ¿quieres el ${L} a las 16:00 o a las 16:30? `
        + `Así reviso la agenda de la ${DRA}.`);
      expect(String(r['respuesta'])).not.toContain('¿Para qué día y en qué horario');
      expect(estado['agendaPorTelefono'][TEL].ultima.mins).toEqual([960, 990]);
    });

    it('«el lunes 5.» con punto final es ese lunes, no hoy', () => {
      const dijo = `Hay espacio a las 11:00 o 11:30 el ${L}.`;
      const r = procesar('Prefiero el lunes', dijo, [consulta(LUNES)]);
      expect(r['respuesta']).toBe(dijo);
    });

    it('consultar_disponibilidad no le trae al modelo el título de las citas (el nombre de otro paciente)', () => {
      const fields = String(nodo(f, 'consultar_disponibilidad').parameters['options'].fields ?? '');
      expect(fields).toMatch(/items\(/);
      for (const c of ['id', 'start', 'end']) expect(fields).toContain(c);
      for (const c of ['summary', 'description', 'attendees', 'creator', 'organizer', 'location']) expect(fields).not.toContain(c);
    });
  });
});

describe('Los tres flujos corren el mismo código para esto', () => {
  it('Procesar respuesta, Comprobar reserva, Retomar respuesta y Procesar reintento son idénticos en los tres', () => {
    const [a, ...otros] = FLUJOS.map(leerFlujo);
    for (const n of ['Procesar respuesta', 'Comprobar reserva', 'Retomar respuesta', 'Procesar reintento', 'Config del negocio']) {
      for (const o of otros) expect(codigoDe(o, n), n).toBe(codigoDe(a!, n));
    }
  });
});
