/**
 * REAGENDAR SIN PERDER LA CITA EN SILENCIO (prueba real de Bellido del 28/09/2026).
 *
 * Ejecución #7659: la paciente pidió reagendar, el asistente le mostró su cita
 * y preguntó si era esa; contestó «Si». `cancelar_cita` BORRÓ la cita y la
 * llamada siguiente del modelo reventó con «Received tool input did not match
 * expected schema ✖ Required → at servicio»: el modelo no pasó `servicio`, y
 * n8n lo exigía. Con el error se pierden los pasos del agente, `Procesar
 * respuesta` no vio la cancelación y la paciente leyó «tuve un problema
 * técnico, ¿me repites lo último?». Se quedó sin cita y nadie lo supo.
 *
 * Dos barreras, las dos por hecho:
 *   1. `servicio` y `funcionario` son opcionales en las cuatro herramientas de
 *      agenda (`$fromAI(…, 'string', '')`): en n8n 2.36.5 un valor por defecto
 *      vuelve opcional el parámetro (`n8n-workflow`, `generateZodSchema`:
 *      `schema.default(…)`), y la agenda ya sabe resolverse sin ellos.
 *   2. Si el modelo falla y `cancelar_cita` CORRIÓ en el turno (`isExecuted`),
 *      la cita pudo quedar borrada: se le dice eso y pasa a recepción.
 *
 * Revisión de seguridad del #275: la cancelación incierta se decide por hecho
 * (no por registro y texto); el pendiente de cancelación se usa una sola vez;
 * y con `servicio` vacío en un negocio con varias agendas no se elige la
 * primera del mapa: la herramienta falla cerrado (`SIN-AGENDA-ELEGIDA`).
 *
 * MENSAJES POR CONVERSACIÓN: 0. Cambia el texto del mensaje de falla, que ya
 * salía; el aviso a recepción y el botón salen solo en ese caso, como en todo
 * lo que se transfiere.
 */
import { describe, expect, it } from 'vitest';
import { codigoDe, ejecutar, expresion, leerFlujo, type J, type Referencias } from './lib/flujo';

const FLUJOS = ['demo-a-agendamiento.json', 'platinum-agendamiento.json', 'bellido-agendamiento.json'] as const;
const TEL = '59170000001';
const CFG: J = { tratamiento: 'Trata al cliente de tú.', nombreNegocio: 'Consultorio Ficticio', numeroRecepcion: '59170000002',
  funcionarios: JSON.stringify([{ nombre: 'Dr. Tomás Quiroga', servicios: [], calendario: 'cal-ficticio-1' }]) };
const DESC = ' de control del nino sano del miércoles, 30 de septiembre a las 17:30';
/** El registro que deja `buscar_mi_cita` en el turno anterior: la cita mostrada como candidata. */
const conCandidata = (desde = Date.now(), extra: J = {}): J => ({ cancelacionesPendientes: { [TEL]: {
  eventoId: '', desc: '', desde, candidatos: { 'ev-emmanuel': DESC }, ...extra } } });
const FALLA_7659 = { error: 'Received tool input did not match expected schema\n\n✖ Required\n  → at servicio' };

describe.each(FLUJOS)('%s · reagendar sin perder la cita en silencio (28/09/2026)', (archivo) => {
  const f = leerFlujo(archivo);
  const procesar = (userInput: string, dato: J, estado: J, cfg: J = CFG, extra: Referencias = {}): J =>
    ejecutar(codigoDe(f, 'Procesar respuesta'), [dato],
      { 'Normalizar entrada': [{ from: TEL, nombrePerfil: 'Sil', userInput }], 'Config del negocio': [cfg], ...extra },
      { $getWorkflowStaticData: () => estado })[0]!;
  /** `cancelar_cita` corrió en el turno: n8n lo sabe aunque el agente reviente. */
  const CANCELO: Referencias = { cancelar_cita: [{ response: [{ success: true }] }] };

  it('#7659: confirmó con «Si», el modelo falló ⇒ se le dice que la cita pudo quedar cancelada y pasa a recepción', () => {
    const r = procesar('Si', FALLA_7659, conCandidata(), CFG, CANCELO);
    expect(String(r['respuesta'])).toBe(`Tuve un problema técnico mientras gestionaba tu cita${DESC}, y puede que ya haya quedado `
      + 'cancelada. Te paso con recepción para que la revisen y te la confirmen.');
    expect(r['transferir']).toBe(true);
    expect(String(r['motivoTransferencia'])).toContain('PUEDE haber quedado cancelada');
    expect(r['avisos']).toContain('cancelacion_incierta');
    // Y sale con el botón de recepción, como todo lo que se transfiere.
    const salida = ejecutar(codigoDe(f, 'Mensaje a enviar'), [r],
      { 'Normalizar entrada': [{ recibidoEn: Date.now() }], 'Config del negocio': [CFG] });
    expect(salida[0]!['enviarContacto']).toBe(true);
  });

  it('con la cita ya mostrada como pendiente, nombra esa; de usted, «su cita»', () => {
    const estado = conCandidata(Date.now(), { eventoId: 'ev-emmanuel', desc: DESC });
    const r = procesar('sí, por favor', FALLA_7659, estado, { ...CFG, tratamiento: 'Trata al cliente de usted.' }, CANCELO);
    expect(String(r['respuesta'])).toContain(`gestionaba su cita${DESC}`);
    expect(String(r['respuesta'])).toContain('Le paso con recepción');
  });

  it('revisión del #275, por hecho: buscó y canceló en el MISMO turno, sin registro previo ⇒ igual se avisa', () => {
    const r = procesar('Sí, por favor', FALLA_7659, {}, CFG, CANCELO);
    expect(String(r['respuesta'])).toBe('Tuve un problema técnico mientras gestionaba tu cita, y puede que ya haya quedado '
      + 'cancelada. Te paso con recepción para que la revisen y te la confirmen.');
    expect(r['transferir']).toBe(true);
  });

  it('revisión del #275, por hecho: con candidatas y un «Sí», si cancelar_cita NO corrió ⇒ la falla de siempre', () => {
    const r = procesar('Si', FALLA_7659, conCandidata());
    expect(String(r['respuesta'])).toMatch(/problema t[eé]cnico/i);
    expect(r['avisos']).not.toContain('cancelacion_incierta');
    expect(r['transferir']).toBe(false);
  });

  it('revisión del #275: el pendiente se usa una sola vez (tres turnos: cambiar la del lunes, cancelar la del martes)', () => {
    const cita = (id: string, dia: string) => ({ id, summary: `Cita Ana — consulta`,
      start: { dateTime: `2026-10-${dia}T11:00:00-04:00` }, end: { dateTime: `2026-10-${dia}T11:30:00-04:00` } });
    const buscar = (...c: J[]) => ({ action: { tool: 'buscar_mi_cita', toolInput: {} }, observation: JSON.stringify(c) });
    const estado: J = {};
    procesar('¿qué cita tengo?', { output: 'Tienes la del lunes 5. ¿Deseas cambiarla?', intermediateSteps: [buscar(cita('ev-A', '05'))] }, estado);
    expect(estado['cancelacionesPendientes'][TEL].eventoId).toBe('ev-A');
    procesar('no, cancela la del martes', { output: '¿Confirmas que cancelo la del martes 6?',
      intermediateSteps: [buscar(cita('ev-A', '05'), cita('ev-B', '06'))] }, estado);
    expect(estado['cancelacionesPendientes'][TEL].eventoId).toBe('');
    // Positiva: la pregunta de la compuerta que nombra el pendiente lo conserva.
    const vigente: J = { cancelacionesPendientes: { [TEL]: { eventoId: 'ev-A', desc: ' del lunes', desde: Date.now(), candidatos: {} } } };
    // «quiero cancelar» no confirma: la compuerta mandó SIN-CONFIRMAR y la pregunta nombra el pendiente.
    const r = procesar('quiero cancelar mi cita', { output: 'Listo, cancelada.', intermediateSteps: [{ action: { tool: 'cancelar_cita',
      toolInput: { eventoId: 'ev-no-vista' } }, observation: JSON.stringify({ error: 'Not Found' }) }] }, vigente);
    expect(String(r['respuesta'])).toContain('del lunes');
    expect(vigente['cancelacionesPendientes'][TEL].eventoId).toBe('ev-A');
  });

  it('revisión del #275: servicio vacío ya no elige la PRIMERA agenda del mapa; sin elección, la del negocio', () => {
    const cfg: J = { calendarioId: 'cal-negocio', calendariosPorServicio: JSON.stringify({ belleza: 'cal-belleza', dental: 'cal-dental' }),
      funcionarios: JSON.stringify([{ nombre: 'Dra. Ana Pérez', calendario: 'cal-ana' }]) };
    for (const n of f.nodes.filter((x) => x.type.endsWith('googleCalendarTool'))) {
      const cal = (ia: J) => expresion(n.parameters['calendar'].value, {}, { 'Config del negocio': [cfg] }, ia);
      expect(cal({}), n.name).toBe('cal-negocio');
      expect(cal({ servicio: '' }), n.name).toBe('cal-negocio');
      expect(cal({ servicio: 'Dental' }), n.name).toBe('cal-dental');
      expect(cal({ funcionario: 'Dra. Ana Pérez' }), n.name).toBe('cal-ana');
    }
  });

  it('negativas: sin nada pendiente, sin confirmar, o con el registro vencido ⇒ la falla de siempre, sin transferir', () => {
    for (const [dice, estado] of [
      ['Si', {}],
      ['hola', conCandidata()],
      ['¿qué horarios tienes?', conCandidata()],
      ['Si', conCandidata(Date.now() - 31 * 60 * 1000)],
    ] as [string, J][]) {
      const r = procesar(dice, FALLA_7659, estado);
      expect(String(r['respuesta']), dice).toMatch(/problema t[eé]cnico/i);
      expect(String(r['respuesta']), dice).not.toContain('cancelada');
      expect(r['avisos'], dice).not.toContain('cancelacion_incierta');
    }
  });

  it('#7655: «¿confirmas que es esa la cita que deseas cambiar?» con UNA cita encontrada ⇒ queda como pendiente', () => {
    const cita = { id: 'ev-emmanuel', summary: 'Cita Emmanuel Barrera — control-del-nino-sano',
      start: { dateTime: '2026-09-30T17:30:00-04:00' }, end: { dateTime: '2026-09-30T18:00:00-04:00' } };
    const estado: J = {};
    procesar('Necesito re-agendar', { output: 'Encontré la cita de Emmanuel Barrera. ¿Confirmas que es esa la cita que deseas cambiar?',
      intermediateSteps: [{ action: { tool: 'buscar_mi_cita', toolInput: {} }, observation: JSON.stringify([cita]) }] }, estado);
    expect(estado['cancelacionesPendientes'][TEL].eventoId).toBe('ev-emmanuel');
  });

  it('sin falla del modelo no se toca nada: la cancelación la juzga lo de siempre', () => {
    const r = procesar('Si', { output: '¿Para qué día quieres la nueva cita?', intermediateSteps: [] }, conCandidata());
    expect(r['avisos']).not.toContain('cancelacion_incierta');
    expect(String(r['respuesta'])).toBe('¿Para qué día quieres la nueva cita?');
  });

  it('`servicio` y `funcionario` son opcionales en las cuatro herramientas de agenda', () => {
    const herramientas = f.nodes.filter((n) => n.type.endsWith('googleCalendarTool'));
    expect(herramientas.map((n) => n.name).sort()).toEqual(['agendar_cita', 'buscar_mi_cita', 'cancelar_cita', 'consultar_disponibilidad']);
    for (const n of herramientas) {
      const s = JSON.stringify(n.parameters);
      const usos = s.match(/\$fromAI\('(?:servicio|funcionario)'[^)]*\)/g) ?? [];
      expect(usos.length, n.name).toBeGreaterThan(0);
      for (const u of usos) expect(u, `${n.name}: ${u}`).toMatch(/, 'string', ''\)$/);
    }
  });
});
