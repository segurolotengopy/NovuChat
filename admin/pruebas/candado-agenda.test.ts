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
const codigoCalendarios = flujo.nodes.find((n) => n.name === 'Calendarios a revisar')?.parameters.jsCode;

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

/** El item que `Procesar respuesta` deja antes del candado, cuando no importa. */
const PREVIA: Record<string, unknown> = { respuesta: 'Cita confirmada.', from: '591700', transferir: false };

/** Corre el nodo con un `$input` y un `$()` simulados, y el reloj congelado. */
function comprobarTodo(
  eventos: Evento[], ahora = AHORA,
  config: Record<string, unknown> = { mensajeReservaNoConfirmada: '' },
  previa: Record<string, unknown> = PREVIA,
): Record<string, unknown>[] {
  const entrada = { all: () => eventos.map((json) => ({ json })) };
  const contexto = (nombre: string) => ({
    all: () => [{ json: previa }],
    first: () => ({ json: nombre === 'Config del negocio' ? config : previa }),
  });
  class Reloj extends Date {
    constructor(...a: unknown[]) {
      // @ts-expect-error se reenvían los argumentos tal cual
      if (a.length) { super(...a); } else { super(ahora.getTime()); }
    }
    static override now() { return ahora.getTime(); }
  }
  // EXCEPCIÓN DELIBERADA a `devsecops.js-eval-prohibido`, y acotada a esta línea.
  //
  // La regla prohíbe la ejecución dinámica de código, y tiene toda la razón
  // donde importa: en producción, con datos de terceros. Acá no hay nada de
  // eso. Lo que se ejecuta es un archivo NUESTRO, versionado en el repositorio
  // —`Flujos/demo-a-agendamiento.json`—, dentro de una prueba que no corre en
  // ningún servidor. La alternativa sería copiar la lógica del candado a este
  // archivo, y entonces la prueba comprobaría la copia: quedaría en verde para
  // siempre mientras el flujo se rompe en silencio. Eso es peor.
  //
  // DEUDA: lo correcto a futuro es que el código del nodo viva en un `.js`
  // versionado que se inyecte al JSON al preparar el import. Así habría una
  // sola fuente y la prueba lo importaría sin nada dinámico. Es un cambio en la
  // canalización de los flujos y no entra antes del congelamiento del 8.
  //
  // nosemgrep: devsecops.js-eval-prohibido
  const fn = new Function('$input', '$', 'Date', codigo as string) as
    (i: unknown, c: unknown, d: unknown) => { json: Record<string, unknown> }[];
  return fn(entrada, contexto, Reloj).map((i) => i.json);
}

/** El primer item, que es el que decide el mensaje al cliente. */
function comprobarReserva(eventos: Evento[]): Record<string, unknown> {
  return comprobarTodo(eventos)[0] ?? {};
}

/**
 * Corre `Calendarios a revisar` con el item de `Procesar respuesta` y la
 * configuración del negocio, y devuelve los calendarios que emite, en orden.
 * Misma ejecución del JSON versionado, y misma excepción a
 * `devsecops.js-eval-prohibido`, por la misma razón que arriba.
 */
function calendariosARevisar(
  previa: Record<string, unknown>, config: Record<string, unknown>,
): { calendarios: string[]; items: Record<string, unknown>[] } {
  const entrada = { first: () => ({ json: previa }), all: () => [{ json: previa }] };
  const contexto = (nombre: string) => ({
    first: () => ({ json: nombre === 'Config del negocio' ? config : previa }),
    all: () => [{ json: nombre === 'Config del negocio' ? config : previa }],
  });
  // nosemgrep: devsecops.js-eval-prohibido
  const fn = new Function('$input', '$', codigoCalendarios as string) as
    (i: unknown, c: unknown) => { json: Record<string, unknown> }[];
  const items = fn(entrada, contexto).map((i) => i.json);
  return { calendarios: items.map((i) => String(i['calendarioARevisar'])), items };
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
    // Recepción se entera, pero YA NO desde acá (17/09/2026): el motivo viaja
    // en `motivoCruce` y la transferencia la deciden «Retomar respuesta» y
    // «Procesar reintento», después de darle al modelo UN turno para ofrecer
    // alternativas. Si el flujo transfiriera acá, el aviso saldría también
    // cuando el reintento resolvió, y diría algo falso («necesita atención
    // humana») por un mensaje pagado.
    expect(r['transferir']).toBe(false);
    expect(r['motivoTransferencia']).toBe('');
    expect(String(r['motivoCruce'])).toContain('YA OCUPADO');
    expect(String(r['motivoCruce'])).toContain('Cita Sil — corte');
  });

  it('dice QUIÉN y CUÁNDO chocó, para que el reintento pueda ofrecer alternativas', () => {
    // La persona sale del calendario donde vivía la cita, cruzado con los
    // funcionarios de la configuración: el título solo trae el nombre del
    // cliente. La hora y la fecha van en la zona de Bolivia.
    const items = comprobarTodo([
      ev('j1', 'Cita Andrés A. — corte', CAL_JOSE,
         '2026-09-07T14:00:00-04:00', '2026-09-07T15:00:00-04:00', '2026-09-06T06:22:34.000Z'),
      ev('j2', 'Cita Ruben — corte', CAL_JOSE,
         '2026-09-07T14:30:00-04:00', '2026-09-07T15:30:00-04:00', '2026-09-06T20:16:00.000Z'),
    ], AHORA, {
      mensajeReservaNoConfirmada: '',
      funcionarios: JSON.stringify([{ nombre: 'José', servicios: ['corte'], calendario: CAL_JOSE }]),
    });
    expect(items).toHaveLength(1);
    const caidas = items[0]?.['citasCaidas'] as { hora: string; fecha: string; persona: string; servicio: string }[];
    expect(caidas).toHaveLength(1);
    expect(caidas[0]).toMatchObject({ hora: '14:30', persona: 'José', servicio: 'corte' });
    expect(caidas[0]?.fecha).toContain('7 de septiembre');
  });

  it('sin funcionarios en la configuración, la persona queda vacía y nada se rompe', () => {
    const r = comprobarReserva([
      ev('j1', 'Cita Ana — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-06T06:00:00.000Z'),
      ev('j2', 'Cita Sil — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-06T20:16:00.000Z'),
    ]);
    const caidas = r['citasCaidas'] as { hora: string; persona: string }[];
    expect(caidas[0]).toMatchObject({ hora: '09:00', persona: '' });
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

  it('CON LA MISMA MARCA DE TIEMPO igual cede una: el caso que se escapó', () => {
    // EL DEFECTO REAL, ejecución #1076 del 2026-09-06. El agente agendó tres
    // citas en un mismo mensaje y las dos que chocaban quedaron con el MISMO
    // `created` —Google lo guarda con resolución de segundos—. La regla exigía
    // que la otra fuera ESTRICTAMENTE anterior, ninguna cedió, y un funcionario
    // quedó con dos citas de 9 a 10. La prueba anterior usaba marcas separadas
    // por cuatro segundos, así que pasaba sin probar nada de esto.
    const MISMO = '2026-09-07T00:20:52.000Z';
    const items = comprobarTodo([
      ev('j-padre', 'Cita Andrés A. — corte', CAL_JOSE,
         '2026-09-08T09:00:00-04:00', '2026-09-08T10:00:00-04:00', MISMO),
      ev('j-hijo', 'Cita Hijo de Andrés A. — corte', CAL_JOSE,
         '2026-09-08T09:00:00-04:00', '2026-09-08T10:00:00-04:00', MISMO),
      ev('m-esposa', 'Cita Esposa de Andrés A. — corte', CAL_MARIA,
         '2026-09-08T09:00:00-04:00', '2026-09-08T10:00:00-04:00', MISMO),
    ], new Date('2026-09-07T00:20:55.000Z'));
    // Cede EXACTAMENTE una: ni las dos, que dejaría al negocio sin ninguna,
    // ni ninguna, que es lo que pasó.
    expect(items).toHaveLength(1);
    expect(items[0]?.['citaSolapada']).toBe(true);
    // Desempata el identificador: gana el menor («j-hijo» < «j-padre»), así que
    // cede el otro. Cuál sobrevive es arbitrario; lo que importa es que sea
    // SIEMPRE el mismo, para que dos ejecuciones no tomen decisiones opuestas.
    expect(items[0]?.['eventoABorrar']).toBe('j-padre');
    // Las otras dos citas son válidas, así que sigue habiendo cierre.
    expect(items[0]?.['reservaVerificada']).toBe(true);
    // Y el mensaje dice CUÁL cayó, no un «hubo un cruce» a secas.
    expect(String(items[0]?.['respuesta'])).toMatch(/Andrés A\./);
    expect(String(items[0]?.['respuesta'])).toMatch(/09:00/);
  });

  it('la cita de María a la misma hora NO cede: es otra agenda', () => {
    const MISMO = '2026-09-07T00:20:52.000Z';
    const items = comprobarTodo([
      ev('j-padre', 'Cita Andrés A. — corte', CAL_JOSE,
         '2026-09-08T09:00:00-04:00', '2026-09-08T10:00:00-04:00', MISMO),
      ev('m-esposa', 'Cita Esposa de Andrés A. — corte', CAL_MARIA,
         '2026-09-08T09:00:00-04:00', '2026-09-08T10:00:00-04:00', MISMO),
    ], new Date('2026-09-07T00:20:55.000Z'));
    expect(items).toHaveLength(1);
    expect(items[0]?.['citaSolapada']).toBeUndefined();
  });

  it('con tres citas iguales en la misma agenda, sobrevive UNA', () => {
    const MISMO = '2026-09-07T00:20:52.000Z';
    const items = comprobarTodo([
      ev('a', 'Cita Uno — corte', CAL_JOSE, '2026-09-08T09:00:00-04:00', '2026-09-08T10:00:00-04:00', MISMO),
      ev('b', 'Cita Dos — corte', CAL_JOSE, '2026-09-08T09:00:00-04:00', '2026-09-08T10:00:00-04:00', MISMO),
      ev('c', 'Cita Tres — corte', CAL_JOSE, '2026-09-08T09:00:00-04:00', '2026-09-08T10:00:00-04:00', MISMO),
    ], new Date('2026-09-07T00:20:55.000Z'));
    // Ceden dos, queda la de identificador menor.
    expect(items).toHaveLength(2);
    expect(items.map((i) => i['eventoABorrar']).sort()).toEqual(['b', 'c']);
    // Ningún item transfiere desde acá: el aviso —uno solo, nunca uno por
    // cita— lo decide «Procesar reintento» sobre el primer item que retoma
    // «Retomar respuesta». Las dos citas caídas viajan juntas en `citasCaidas`.
    expect(items.every((i) => i['transferir'] === false)).toBe(true);
    expect((items[0]?.['citasCaidas'] as unknown[]).length).toBe(2);
    expect(String(items[0]?.['motivoCruce'])).toContain('Cita Dos — corte; Cita Tres — corte');
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

/**
 * `Calendarios a revisar` decide CUÁNTAS llamadas a Google hace el turno que
 * agenda: el nodo de Calendar corre una vez por item. Hasta el 17/09/2026
 * emitía un item por cada calendario configurado, y `Comprobar reserva`
 * descartaba los eventos de los calendarios distintos al de la cita nueva: con
 * 7 odontólogos, 7 llamadas para tirar 6. Ese costo lineal es lo que ponía
 * techo a las agendas por plan (`Analisis/24` §2.4 y §4).
 *
 * Ahora emite SOLO el calendario donde `agendar_cita` escribió, que
 * `Procesar respuesta` trae en `eventosCreados[].calendario` (el
 * `organizer.email` del evento devuelto). Y si no lo sabe, TODOS, como antes:
 * nunca cero, porque el candado no puede dejar de correr.
 */
describe('Calendarios a revisar: solo el que recibió la cita', () => {
  const CAL_DR1 = 'cccc000000cccc@group.calendar.google.com';
  const CAL_DR2 = 'dddd000000dddd@group.calendar.google.com';
  /** La forma de Platinum: dos odontólogos con agenda propia; la del negocio es la 1. */
  const PLATINUM: Record<string, unknown> = {
    mensajeReservaNoConfirmada: '',
    calendarioId: CAL_DR1,
    calendariosPorServicio: JSON.stringify({ 'blanqueamiento dental profesional': CAL_DR1, 'valoracion clinica': CAL_DR1 }),
    funcionarios: JSON.stringify([
      { nombre: 'Dr. Christyan Sandoval', servicios: ['blanqueamiento dental profesional', 'valoracion clinica'], calendario: CAL_DR1 },
      { nombre: 'Dr. Juan Pérez', servicios: ['blanqueamiento dental profesional', 'valoracion clinica'], calendario: CAL_DR2 },
    ]),
  };
  const creado = (id: string, calendario: string, inicio = '2026-09-07T10:00:00-04:00', fin = '2026-09-07T10:30:00-04:00') =>
    ({ id, calendario, inicio, fin, titulo: `Cita ${id}` });
  const previaCon = (eventosCreados: unknown): Record<string, unknown> =>
    ({ ...PREVIA, ejecutoAgendar: true, verificarReserva: true, eventosCreados });
  /** Lo que `Verificar en el calendario` traería: solo los eventos de los calendarios emitidos. */
  const traidosDe = (calendarios: string[], eventos: Evento[]) =>
    eventos.filter((e) => calendarios.includes(e.organizer.email));

  it('el nodo existe y trae código', () => {
    expect(typeof codigoCalendarios).toBe('string');
    expect(codigoCalendarios).toContain('eventosCreados');
  });

  it('una cita en el calendario 2 → UN item, el 2', () => {
    const { calendarios, items } = calendariosARevisar(previaCon([creado('c1', CAL_DR2)]), PLATINUM);
    expect(calendarios).toEqual([CAL_DR2]);
    expect(items[0]?.['revisionAcotada']).toBe(true);
    // El item conserva lo que venía de `Procesar respuesta`.
    expect(items[0]?.['from']).toBe('591700');
  });

  it('dos citas en calendarios distintos → dos items, uno por calendario', () => {
    const { calendarios } = calendariosARevisar(
      previaCon([creado('c1', CAL_DR1), creado('c2', CAL_DR2, '2026-09-07T11:00:00-04:00', '2026-09-07T11:30:00-04:00')]),
      PLATINUM);
    expect([...calendarios].sort()).toEqual([CAL_DR1, CAL_DR2].sort());
  });

  it('dos citas en el MISMO calendario → un solo item: una llamada, no dos', () => {
    const { calendarios } = calendariosARevisar(
      previaCon([creado('c1', CAL_DR2), creado('c2', CAL_DR2, '2026-09-07T11:00:00-04:00', '2026-09-07T11:30:00-04:00')]),
      PLATINUM);
    expect(calendarios).toEqual([CAL_DR2]);
  });

  it('RESPALDO: sin `eventosCreados` se revisan TODOS, como antes (los 2 de Platinum)', () => {
    // La verificación pudo abrirse por el texto del modelo, o por `isExecuted`
    // sin observación: no se sabe dónde quedó la cita, se mira en todos lados.
    for (const previa of [
      PREVIA,                                              // sin el campo
      previaCon([]),                                       // vacío
      previaCon([{ id: 'x', calendario: '' }]),            // sin calendario
      previaCon([{ id: 'x' }]),                            // sin el campo calendario
      previaCon('no es una lista'),                        // de otro tipo
      previaCon([null, undefined, 'x']),                   // basura
    ]) {
      const { calendarios, items } = calendariosARevisar(previa, PLATINUM);
      expect([...calendarios].sort(), JSON.stringify(previa['eventosCreados'])).toEqual([CAL_DR1, CAL_DR2].sort());
      expect(items.every((i) => i['revisionAcotada'] === false)).toBe(true);
    }
  });

  it('NUNCA cero items: aunque la configuración no tenga calendarios, si el evento trae uno se revisa ese', () => {
    const { calendarios } = calendariosARevisar(previaCon([creado('c1', CAL_DR2)]), { mensajeReservaNoConfirmada: '' });
    expect(calendarios).toEqual([CAL_DR2]);
  });

  it('el calendario del evento se revisa aunque NO figure en la configuración: es donde la herramienta escribió', () => {
    const OTRO = 'eeee000000eeee@group.calendar.google.com';
    const { calendarios } = calendariosARevisar(previaCon([creado('c1', OTRO)]), PLATINUM);
    expect(calendarios).toEqual([OTRO]);
  });

  it('LA MEDIDA: con 7 odontólogos, 7 llamadas antes y 1 después', () => {
    // Antes: un item por calendario configurado. Después: uno por cita. El
    // número de agendas del negocio deja de pesar en el turno que agenda.
    const equipo = Array.from({ length: 7 }, (_, i) =>
      ({ nombre: `Dr. ${i + 1}`, servicios: ['valoracion clinica'], calendario: `odonto${i + 1}000000@group.calendar.google.com` }));
    const clinica = { ...PLATINUM, calendarioId: equipo[0]!.calendario,
      calendariosPorServicio: JSON.stringify({ 'valoracion clinica': equipo[0]!.calendario }),
      funcionarios: JSON.stringify(equipo) };
    expect(calendariosARevisar(PREVIA, clinica).calendarios).toHaveLength(7);
    expect(calendariosARevisar(previaCon([creado('c1', equipo[4]!.calendario)]), clinica).calendarios)
      .toEqual([equipo[4]!.calendario]);
  });

  it('EL CASO MANDATORIO: dos citas del mismo odontólogo a la misma hora → el candado la deshace, revisando SOLO su agenda', () => {
    // La paciente insistió, el modelo agendó a las 10:00 dentro de la cita de
    // 10:00 a 11:00 del Dr. 1. `created` de la nueva cae fuera de la ventana
    // de cinco minutos: la ancla es el id que devolvió la herramienta.
    const yaEstaba = ev('existente', 'Cita OTRA PACIENTE — valoración', CAL_DR1,
      '2026-09-07T10:00:00-04:00', '2026-09-07T11:00:00-04:00', '2026-09-05T12:00:00.000Z');
    const nueva = ev('ev-nuevo', 'Cita Paciente — valoración', CAL_DR1,
      '2026-09-07T10:00:00-04:00', '2026-09-07T10:30:00-04:00', '2026-09-06T19:00:00.000Z');
    const enLaOtraAgenda = ev('dr2', 'Cita Alguien — blanqueamiento', CAL_DR2,
      '2026-09-07T10:00:00-04:00', '2026-09-07T11:00:00-04:00', '2026-09-05T12:00:00.000Z');
    const previa = previaCon([creado('ev-nuevo', CAL_DR1)]);

    const { calendarios } = calendariosARevisar(previa, PLATINUM);
    expect(calendarios).toEqual([CAL_DR1]);
    const traidos = traidosDe(calendarios, [yaEstaba, nueva, enLaOtraAgenda]);
    expect(traidos.map((e) => e.id)).toEqual(['existente', 'ev-nuevo']);   // la otra agenda ni se consulta

    const items = comprobarTodo(traidos, AHORA, PLATINUM, previa);
    expect(items).toHaveLength(1);
    expect(items[0]?.['citaSolapada']).toBe(true);
    expect(items[0]?.['eventoABorrar']).toBe('ev-nuevo');
    expect(items[0]?.['calendarioDelBorrado']).toBe(CAL_DR1);
    expect(items[0]?.['reservaVerificada']).toBe(false);
    expect((items[0]?.['citasCaidas'] as { persona: string; hora: string }[])[0])
      .toMatchObject({ persona: 'Dr. Christyan Sandoval', hora: '10:00' });
  });

  it('dos odontólogos DISTINTOS a la misma hora → no es cruce, y la agenda del otro ni se consulta', () => {
    const delDr1 = ev('existente', 'Cita OTRA PACIENTE — valoración', CAL_DR1,
      '2026-09-07T10:00:00-04:00', '2026-09-07T11:00:00-04:00', '2026-09-05T12:00:00.000Z');
    const nuevaDr2 = ev('ev-nuevo', 'Cita Paciente — valoración', CAL_DR2,
      '2026-09-07T10:00:00-04:00', '2026-09-07T10:30:00-04:00', '2026-09-06T19:00:00.000Z');
    const previa = previaCon([creado('ev-nuevo', CAL_DR2)]);

    const { calendarios } = calendariosARevisar(previa, PLATINUM);
    expect(calendarios).toEqual([CAL_DR2]);
    const traidos = traidosDe(calendarios, [delDr1, nuevaDr2]);
    expect(traidos.map((e) => e.id)).toEqual(['ev-nuevo']);

    const r = comprobarTodo(traidos, AHORA, PLATINUM, previa)[0] ?? {};
    expect(r['citaSolapada']).toBeUndefined();
    expect(r['reservaVerificada']).toBe(true);
    expect(r['eventoId']).toBe('ev-nuevo');
    expect(r['citaCreadaNoEncontrada']).toBe(false);
  });

  it('con el respaldo (sin dato) el candado sigue viendo el cruce en cualquiera de las agendas', () => {
    // Si el modelo dijo «quedó agendada» sin que se sepa dónde, se revisan
    // todas y el cruce se detecta por la ventana de cinco minutos, como antes.
    const yaEstaba = ev('existente', 'Cita OTRA — valoración', CAL_DR2,
      '2026-09-07T10:00:00-04:00', '2026-09-07T11:00:00-04:00', '2026-09-05T12:00:00.000Z');
    const nueva = ev('n', 'Cita Paciente — valoración', CAL_DR2,
      '2026-09-07T10:00:00-04:00', '2026-09-07T10:30:00-04:00', '2026-09-06T20:15:30.000Z');
    const { calendarios } = calendariosARevisar(PREVIA, PLATINUM);
    const traidos = traidosDe(calendarios, [yaEstaba, nueva]);
    expect(traidos).toHaveLength(2);
    const r = comprobarTodo(traidos, AHORA, PLATINUM, PREVIA)[0] ?? {};
    expect(r['citaSolapada']).toBe(true);
    expect(r['eventoABorrar']).toBe('n');
  });
});
