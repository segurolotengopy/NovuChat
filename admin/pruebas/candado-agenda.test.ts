/**
 * EL CANDADO CONTRA LA DOBLE RESERVA, probado sobre el código que corre de verdad.
 *
 * POR QUÉ EXISTE ESTA SUITE. El 2026-09-06, en una prueba real, el agente
 * propuso las 9:00 sin consultar el calendario ni una vez —comprobado ejecución
 * por ejecución en n8n, de la #944 a la #968— y reservó encima de una cita que
 * ya existía. Un funcionario quedó con dos citas de 9 a 10.
 *
 * Se corrigió el prompt, pero un prompt es una instrucción: ya se rompió una vez
 * al cambiar de modelo, y que dos clientes se presenten a la misma hora no puede
 * depender de que el modelo obedezca. El candado vive en `Comprobar reserva`, un
 * nodo Code del flujo.
 *
 * LO QUE HACE ESPECIAL A ESTA PRUEBA: no copia la lógica, **la extrae del JSON
 * del flujo y la ejecuta**. Si alguien edita el nodo en n8n y exporta, o toca el
 * archivo, la prueba corre el código nuevo. Una copia en el archivo de pruebas
 * quedaría verde para siempre mientras el flujo se rompe en silencio.
 *
 * El primer caso son los datos REALES de la ejecución #964, con los
 * identificadores de calendario cambiados.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const flujo = JSON.parse(
  readFileSync(join(aqui, '../../Flujos/demo-a-agendamiento.json'), 'utf8'),
) as { nodes: { name: string; parameters: { jsCode?: string } }[] };

const codigo = flujo.nodes.find((n) => n.name === 'Comprobar reserva')?.parameters.jsCode;

const CAL_JOSE = 'aaaa000000aaaa@group.calendar.google.com';
const CAL_MARIA = 'bbbb000000bbbb@group.calendar.google.com';
const AHORA = new Date('2026-09-06T20:16:05.000Z');

interface Evento {
  id: string; summary: string;
  organizer: { email: string };
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  created: string;
}

const ev = (id: string, summary: string, cal: string,
            ini: string, fin: string, creado: string): Evento => ({
  id, summary, organizer: { email: cal },
  start: { dateTime: ini }, end: { dateTime: fin }, created: creado,
});

/** Corre el nodo con un `$input` y un `$()` simulados, y el reloj congelado. */
function comprobarReserva(eventos: Evento[]): Record<string, unknown> {
  const entrada = { all: () => eventos.map((json) => ({ json })) };
  const contexto = (nombre: string) => ({
    all: () => [{ json: { respuesta: 'Cita confirmada.', from: '591700', transferir: false } }],
    first: () => ({
      json: nombre === 'Config del negocio'
        ? { mensajeReservaNoConfirmada: '' }
        : { respuesta: 'Cita confirmada.', from: '591700' },
    }),
  });
  class Reloj extends Date {
    constructor(...a: unknown[]) {
      // @ts-expect-error se reenvían los argumentos tal cual
      if (a.length) { super(...a); } else { super(AHORA.getTime()); }
    }
    static override now() { return AHORA.getTime(); }
  }
  const fn = new Function('$input', '$', 'Date', codigo as string) as
    (i: unknown, c: unknown, d: unknown) => { json: Record<string, unknown> }[];
  return fn(entrada, contexto, Reloj)[0]?.json ?? {};
}

describe('Candado contra la doble reserva', () => {
  it('el nodo existe y trae código: si no, no hay candado que probar', () => {
    expect(typeof codigo).toBe('string');
    expect(codigo).toContain('organizer');
  });

  it('EL CASO REAL: detecta las dos citas de 9 a 10 en la misma agenda', () => {
    const r = comprobarReserva([
      ev('m1', 'Cita Silvana S. — pedicure', CAL_MARIA,
         '2026-09-07T14:00:00-04:00', '2026-09-07T16:00:00-04:00', '2026-09-06T16:46:23.000Z'),
      ev('j1', 'Cita Andrés A. — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-06T06:22:34.000Z'),
      ev('j2', 'Cita Sil — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-06T20:16:00.000Z'),
    ]);
    expect(r['citaSolapada']).toBe(true);
    // Cede la MÁS NUEVA: la que ya estaba se queda con el horario.
    expect(r['eventoABorrar']).toBe('j2');
    expect(r['calendarioDelBorrado']).toBe(CAL_JOSE);
  });

  it('no le confirma al cliente una cita que va a deshacer', () => {
    // El defecto más caro sería borrar la cita y decirle igual «confirmada»:
    // el cliente se presenta y no hay nada anotado.
    const r = comprobarReserva([
      ev('j1', 'Cita Andrés A. — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-06T06:22:34.000Z'),
      ev('j2', 'Cita Sil — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-06T20:16:00.000Z'),
    ]);
    expect(String(r['respuesta'])).not.toMatch(/confirmad/i);
    expect(r['reservaVerificada']).toBe(false);   // no se registra cierre facturable
    expect(r['transferir']).toBe(true);           // recepción se entera
  });

  it('DOS PERSONAS DISTINTAS a la misma hora NO son conflicto', () => {
    // Es la razón de ser de las agendas por persona. Tratarlo como choque haría
    // perder turnos buenos, que es el defecto que tenía el prompt.
    const r = comprobarReserva([
      ev('m1', 'Cita Ana — manicure', CAL_MARIA,
         '2026-09-07T10:00:00-04:00', '2026-09-07T11:00:00-04:00', '2026-09-06T06:00:00.000Z'),
      ev('j1', 'Cita Sil — corte', CAL_JOSE,
         '2026-09-07T10:00:00-04:00', '2026-09-07T11:00:00-04:00', '2026-09-06T20:16:00.000Z'),
    ]);
    expect(r['citaSolapada']).toBeUndefined();
    expect(r['reservaVerificada']).toBe(true);
  });

  it('citas PEGADAS en la misma agenda no se superponen', () => {
    // 9 a 10 y 10 a 11 es una agenda llena, no un error.
    const r = comprobarReserva([
      ev('j1', 'Cita Ana — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-06T06:00:00.000Z'),
      ev('j2', 'Cita Sil — corte', CAL_JOSE,
         '2026-09-07T10:00:00-04:00', '2026-09-07T11:00:00-04:00', '2026-09-06T20:16:00.000Z'),
    ]);
    expect(r['citaSolapada']).toBeUndefined();
  });

  it('detecta la superposición PARCIAL, no solo la exacta', () => {
    const r = comprobarReserva([
      ev('j1', 'Cita Ana — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-06T06:00:00.000Z'),
      ev('j2', 'Cita Sil — corte', CAL_JOSE,
         '2026-09-07T09:30:00-04:00', '2026-09-07T10:30:00-04:00', '2026-09-06T20:16:00.000Z'),
    ]);
    expect(r['citaSolapada']).toBe(true);
  });

  it('con dos citas creadas a la vez cede UNA sola, no las dos', () => {
    // Si las dos cedieran, dos clientes que escriben al mismo tiempo perderían
    // los dos el horario y el negocio se quedaría sin ninguna cita.
    const r = comprobarReserva([
      ev('j1', 'Cita Ana — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-06T20:16:04.000Z'),
      ev('j2', 'Cita Sil — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-06T20:16:00.000Z'),
    ]);
    expect(r['eventoABorrar']).toBe('j1');   // la posterior
  });

  it('un evento de DÍA COMPLETO no bloquea la agenda entera', () => {
    // «Feriado» o «cerrado por inventario» son notas del negocio. Tomarlas como
    // ocupación dejaría al asistente sin poder agendar nada ese día.
    const r = comprobarReserva([
      { id: 'f', summary: 'Feriado', organizer: { email: CAL_JOSE },
        start: { date: '2026-09-07' }, end: { date: '2026-09-08' },
        created: '2026-09-01T00:00:00.000Z' },
      ev('j2', 'Cita Sil — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-06T20:16:00.000Z'),
    ]);
    expect(r['citaSolapada']).toBeUndefined();
  });

  it('una cita vieja que se vuelve a leer no dispara nada', () => {
    // Solo se juzgan las citas creadas en los últimos cinco minutos. Sin eso,
    // cada mensaje del cliente reevaluaría la agenda entera.
    const r = comprobarReserva([
      ev('j1', 'Cita Ana — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-05T06:00:00.000Z'),
      ev('j2', 'Cita Sil — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-05T07:00:00.000Z'),
    ]);
    expect(r['citaSolapada']).toBeUndefined();
    expect(r['verificacionSinDatos']).toBe(true);
  });
});
