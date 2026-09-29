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
 *   2. Si el modelo falla y el mensaje CONFIRMA una cancelación pendiente, la
 *      cita pudo quedar borrada: se le dice eso y pasa a recepción.
 *
 * MENSAJES POR CONVERSACIÓN: 0. Cambia el texto del mensaje de falla, que ya
 * salía; el aviso a recepción y el botón salen solo en ese caso, como en todo
 * lo que se transfiere.
 */
import { describe, expect, it } from 'vitest';
import { codigoDe, ejecutar, leerFlujo, type J } from './lib/flujo';

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
  const procesar = (userInput: string, dato: J, estado: J, cfg: J = CFG): J =>
    ejecutar(codigoDe(f, 'Procesar respuesta'), [dato],
      { 'Normalizar entrada': [{ from: TEL, nombrePerfil: 'Sil', userInput }], 'Config del negocio': [cfg] },
      { $getWorkflowStaticData: () => estado })[0]!;

  it('#7659: confirmó con «Si», el modelo falló ⇒ se le dice que la cita pudo quedar cancelada y pasa a recepción', () => {
    const r = procesar('Si', FALLA_7659, conCandidata());
    expect(String(r['respuesta'])).toBe(`Tuve un problema al terminar el cambio de tu cita${DESC}, y puede que ya haya quedado `
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
    const r = procesar('sí, por favor', FALLA_7659, estado, { ...CFG, tratamiento: 'Trata al cliente de usted.' });
    expect(String(r['respuesta'])).toContain(`el cambio de su cita${DESC}`);
    expect(String(r['respuesta'])).toContain('Le paso con recepción');
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
