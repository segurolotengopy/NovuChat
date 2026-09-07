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
function comprobarTodo(eventos: Evento[], ahora = AHORA): Record<string, unknown>[] {
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
    // Un solo aviso a recepción, no uno por cita.
    expect(items.filter((i) => i['transferir'] === true)).toHaveLength(1);
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
