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
  // La deuda que se declaró acá el 06/09 («que el código del nodo viva en un
  // `.js` versionado que se inyecte al JSON») quedó saldada a medias el
  // 20/09/2026, y a propósito: el candado vive en
  // `Flujos/src/reservas/comprobar-reserva.js`, el ensamblador
  // (`admin/scripts/ensamblar-flujo.mjs`) lo inyecta al JSON y
  // `ensamblador.test.ts` prueba que los dos son idénticos byte a byte. Lo que
  // NO cambió es esta línea: el cuerpo de un nodo Code tiene `return` al nivel
  // superior y recibe `$input` y `$` como globales, así que no es un módulo
  // importable, y envolverlo cambiaría el texto que va al JSON. Ver la
  // cabecera de `lib/flujo.ts`.
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

  it('CON EL CALENDARIO CAÍDO no deja pasar una cita inventada: Bellido, ejecución #2976 (18/09)', () => {
    // La credencial de Google falló («Client authentication failed»),
    // consultar_disponibilidad y agendar_cita devolvieron ERROR, y el modelo
    // igual escribió «Quedó agendada tu consulta… lunes 21 a las 11:00», con
    // dirección y redes. `Verificar en el calendario` salió por
    // continueRegularOutput con un único item {error}, y el candado —que falla
    // ABIERTO ante un falso negativo— lo dejó pasar. Con el calendario
    // inaccesible NO puede existir cita nueva: este caso falla CERRADO.
    const r = comprobarTodo([
      { error: 'Client authentication failed (e.g., unknown client, no client authentication included, or unsupported authentication method).' } as unknown as Evento,
    ])[0] ?? {};
    expect(String(r['respuesta'])).not.toMatch(/quedó agendada|confirmad/i);
    expect(String(r['respuesta'])).toMatch(/recepci/i);
    expect(r['reservaVerificada']).toBe(false);      // no se registra cierre facturable
    expect(r['verificacionFallo']).toBe(true);
    expect(r['transferir']).toBe(true);              // alguien tiene que ir a arreglar la credencial
    expect(String(r['motivoTransferencia'])).toContain('no se pudo consultar el calendario');
    expect(String(r['motivoTransferencia'])).toContain('Client authentication failed');
    expect(String(r['motivoTransferencia'])).toContain('NO quedo registrada');
  });

  it('con el calendario caído usa el texto que configuró el negocio, si lo hay', () => {
    const r = comprobarTodo([{ error: 'x' } as unknown as Evento], AHORA,
      { mensajeReservaNoConfirmada: 'Texto del consultorio.' })[0] ?? {};
    expect(r['respuesta']).toBe('Texto del consultorio.');
    expect(r['transferir']).toBe(true);
  });

  it('EL HUECO DEL 24/09: agendar_cita FALLÓ y el calendario SÍ responde → falla CERRADO', () => {
    // Google rechazó la creación (o la fecha, o dio 403): `Procesar respuesta`
    // vio `agendar_cita` en los pasos sin ningún evento con id
    // (`agendarSinEvento`). La verificación contesta bien —trae la cita de
    // otra paciente— y no hay ninguna cita reciente de esta conversación.
    // Antes: sin id que anclar y sin reciente, el texto «quedó agendada» salía
    // tal cual. Ahora se cierra por el hecho, como con el calendario caído.
    const r = comprobarTodo([
      ev('otra', 'Cita Otra — control', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T09:30:00-04:00', '2026-09-01T10:00:00.000Z'),
    ], AHORA, { mensajeReservaNoConfirmada: '' },
    { ...PREVIA, respuesta: 'Listo, quedó agendada tu cita para mañana a las 9:00.', agendarSinEvento: true, eventosCreados: [] })[0] ?? {};
    expect(String(r['respuesta'])).not.toMatch(/quedó agendada/i);
    expect(String(r['respuesta'])).toMatch(/recepci/i);
    expect(r['reservaVerificada']).toBe(false);
    expect(r['verificacionFallo']).toBe(true);
    expect(r['agendarFallo']).toBe(true);
    expect(r['transferir']).toBe(true);
    expect(String(r['motivoTransferencia'])).toContain('agendar_cita corrio y NO devolvio ninguna cita');
  });

  it('y NO se apropia de una cita reciente de OTRA conversación cuando la herramienta falló', () => {
    // Antes del hotfix, con `idsCreados` vacío el respaldo tomaba «la primera
    // reciente» como propia: la cita que otro paciente acababa de agendar se
    // habría verificado como si fuera de este turno, con seña y cierre.
    const r = comprobarTodo([
      ev('ajena', 'Cita Otra — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T09:30:00-04:00', '2026-09-06T20:15:30.000Z'),
    ], AHORA, { mensajeReservaNoConfirmada: '' },
    { ...PREVIA, agendarSinEvento: true, eventosCreados: [] })[0] ?? {};
    expect(r['reservaVerificada']).toBe(false);
    expect(r['eventoId']).toBeUndefined();
    expect(r['agendarFallo']).toBe(true);
  });

  it('con la herramienta fallida usa el texto que configuró el negocio, si lo hay', () => {
    const r = comprobarTodo([], AHORA, { mensajeReservaNoConfirmada: 'Texto del consultorio.' },
      { ...PREVIA, agendarSinEvento: true, eventosCreados: [] })[0] ?? {};
    expect(r['respuesta']).toBe('Texto del consultorio.');
    expect(r['transferir']).toBe(true);
  });

  it('pero si la herramienta SÍ devolvió su cita, `agendarSinEvento` no aplica y el candado sigue igual', () => {
    const r = comprobarTodo([
      ev('propia', 'Cita Ana — control', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T09:30:00-04:00', '2026-09-06T20:16:00.000Z'),
    ], AHORA, { mensajeReservaNoConfirmada: '' },
    { ...PREVIA, agendarSinEvento: false, eventosCreados: [{ id: 'propia', calendario: CAL_JOSE }] })[0] ?? {};
    expect(r['agendarFallo']).toBeUndefined();
    expect(r['reservaVerificada']).toBe(true);
    expect(r['eventoId']).toBe('propia');
  });

  it('un item de error JUNTO a eventos reales no es «calendario caído»: decide el candado normal', () => {
    // Solo cuenta como caído cuando NO vino ningún evento. Si hay eventos, la
    // consulta funcionó y el error es de otro calendario u otra cosa: se sigue
    // el camino de siempre, que en este caso confirma la cita recién creada.
    const r = comprobarTodo([
      { error: 'x' } as unknown as Evento,
      ev('j1', 'Cita Ana — control', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T09:30:00-04:00', '2026-09-06T20:16:00.000Z'),
    ])[0] ?? {};
    expect(r['verificacionFallo']).toBeUndefined();
    expect(r['reservaVerificada']).toBe(true);
    expect(r['eventoId']).toBe('j1');
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

/**
 * EL CANDADO DE HORARIO — que el asistente no agende cuando el negocio no abre.
 *
 * POR QUÉ EXISTE. El 20/09/2026 el asistente de Clínica Platinum agendó una
 * consulta un DOMINGO, con la clínica cerrada. El horario estaba bien cargado en
 * la consola y le llegaba al modelo como frase —«lunes a viernes, de 09:00 a
 * 19:00; sábado, de 09:00 a 13:00; domingo: cerrado»—, pero eso es una
 * instrucción, no una barrera. En el código no había nada que lo impidiera:
 * `consultar_disponibilidad` devuelve lo OCUPADO, así que un domingo vacío se ve
 * libre, y el candado de arriba solo mira superposiciones, que un día cerrado no
 * tiene. Es el mismo aprendizaje del candado de doble reserva, en otro eje.
 *
 * Se prueba sobre el JSON versionado, por la misma razón y con la misma
 * excepción a `devsecops.js-eval-prohibido` que el resto del archivo.
 */
describe('Candado de horario: no se agenda cuando el negocio no atiende', () => {
  // El horario real de Clínica Platinum, tal como está hoy en producción.
  const HORARIO = {
    lun: '09:00-19:00', mar: '09:00-19:00', mie: '09:00-19:00', jue: '09:00-19:00',
    vie: '09:00-19:00', sab: '09:00-13:00', dom: 'cerrado',
  };
  const CON_HORARIO = {
    mensajeReservaNoConfirmada: '',
    funcionarios: JSON.stringify([
      { nombre: 'Dr. Sandoval', servicios: [], calendario: CAL_JOSE, horario: HORARIO },
    ]),
  };
  /** Una cita creada recién, sola en la agenda: lo único que la puede tumbar es el horario. */
  const soloEsta = (ini: string, fin: string, cfg = CON_HORARIO) => comprobarTodo(
    [ev('nueva', 'Cita Silvana — consulta', CAL_JOSE, ini, fin, '2026-09-06T20:16:00.000Z')],
    AHORA, cfg,
  );

  it('EL CASO REAL: la cita del domingo se deshace, con la clínica cerrada', () => {
    const items = soloEsta('2026-09-27T10:00:00-04:00', '2026-09-27T11:00:00-04:00');
    expect(items).toHaveLength(1);
    expect(items[0]?.['citaSolapada']).toBe(true);
    expect(items[0]?.['eventoABorrar']).toBe('nueva');
    expect(items[0]?.['causaDeLaCaida']).toBe('horario');
  });

  it('y NO le dice al cliente que el horario estaba ocupado, porque no lo estaba', () => {
    const r = soloEsta('2026-09-27T10:00:00-04:00', '2026-09-27T11:00:00-04:00')[0] ?? {};
    expect(String(r['respuesta'])).toContain('ese dia no atendemos');
    expect(String(r['respuesta'])).not.toContain('ocupado');
    expect(String(r['motivoCruce'])).toContain('FUERA DEL HORARIO');
  });

  it('un lunes a las 10:00 NO se toca: es un horario bueno', () => {
    const items = soloEsta('2026-09-21T10:00:00-04:00', '2026-09-21T11:00:00-04:00');
    expect(items[0]?.['citaSolapada']).toBeUndefined();
    expect(items[0]?.['reservaVerificada']).toBe(true);
  });

  it('una cita que TERMINA después del cierre se deshace', () => {
    // Sábado: se atiende hasta las 13:00. Una consulta de 12:30 a 13:30 deja al
    // paciente media hora dentro de un consultorio cerrado.
    const r = soloEsta('2026-09-26T12:30:00-04:00', '2026-09-26T13:30:00-04:00')[0] ?? {};
    expect(r['citaSolapada']).toBe(true);
    expect(String(r['respuesta'])).toContain('fuera de nuestro horario');
  });

  it('terminar JUSTO en la hora de cierre sí entra', () => {
    const r = soloEsta('2026-09-26T12:00:00-04:00', '2026-09-26T13:00:00-04:00')[0] ?? {};
    expect(r['citaSolapada']).toBeUndefined();
  });

  it('antes de abrir también se deshace', () => {
    const r = soloEsta('2026-09-21T08:00:00-04:00', '2026-09-21T09:00:00-04:00')[0] ?? {};
    expect(r['citaSolapada']).toBe(true);
  });

  it('respeta el corte del mediodía: «09:00-12:00, 14:00-19:00»', () => {
    const partido = {
      mensajeReservaNoConfirmada: '',
      funcionarios: JSON.stringify([{
        nombre: 'Dr. Sandoval', servicios: [], calendario: CAL_JOSE,
        horario: { ...HORARIO, lun: '09:00-12:00, 14:00-19:00' },
      }]),
    };
    const almuerzo = soloEsta('2026-09-21T12:30:00-04:00', '2026-09-21T13:30:00-04:00', partido)[0] ?? {};
    expect(almuerzo['citaSolapada']).toBe(true);
    const tarde = soloEsta('2026-09-21T15:00:00-04:00', '2026-09-21T16:00:00-04:00', partido)[0] ?? {};
    expect(tarde['citaSolapada']).toBeUndefined();
  });

  it('CADA PERSONA CON SU HORARIO: el domingo del que sí trabaja no se toca', () => {
    // Una guardia de fin de semana es legítima. El candado mira el horario de
    // LA PERSONA que atiende, no un horario único del negocio.
    const dosPersonas = {
      mensajeReservaNoConfirmada: '',
      funcionarios: JSON.stringify([
        { nombre: 'Dr. Sandoval', servicios: [], calendario: CAL_JOSE, horario: HORARIO },
        { nombre: 'Dra. Guardia', servicios: [], calendario: CAL_MARIA,
          horario: { ...HORARIO, dom: '09:00-13:00' } },
      ]),
    };
    const deGuardia = comprobarTodo([ev('g', 'Cita Ana — urgencia', CAL_MARIA,
      '2026-09-27T10:00:00-04:00', '2026-09-27T11:00:00-04:00', '2026-09-06T20:16:00.000Z')],
      AHORA, dosPersonas)[0] ?? {};
    expect(deGuardia['citaSolapada']).toBeUndefined();
  });

  it('FALLA ABIERTA sin horario cargado: no se cancela por una configuración incompleta', () => {
    // Al revés que el candado de solapes, y a propósito: allá el dato es firme
    // —dos citas que existen—; acá, borrar por falta de dato sería quitarle al
    // cliente una cita buena.
    const sinDato = {
      mensajeReservaNoConfirmada: '',
      funcionarios: JSON.stringify([{ nombre: 'Dr. Sandoval', servicios: [], calendario: CAL_JOSE }]),
    };
    const r = soloEsta('2026-09-27T10:00:00-04:00', '2026-09-27T11:00:00-04:00', sinDato)[0] ?? {};
    expect(r['citaSolapada']).toBeUndefined();
  });

  it('un horario ilegible («a convenir») tampoco cancela nada', () => {
    const raro = {
      mensajeReservaNoConfirmada: '',
      funcionarios: JSON.stringify([{
        nombre: 'Dr. Sandoval', servicios: [], calendario: CAL_JOSE,
        horario: { ...HORARIO, dom: 'a convenir' },
      }]),
    };
    const r = soloEsta('2026-09-27T10:00:00-04:00', '2026-09-27T11:00:00-04:00', raro)[0] ?? {};
    expect(r['citaSolapada']).toBeUndefined();
  });

  it('el CRUCE manda sobre el horario cuando se dan los dos', () => {
    // Si además de estar fuera de horario choca con otra cita, al cliente se le
    // explica el cruce: es lo que el reintento puede resolver ofreciendo horas.
    const items = comprobarTodo([
      ev('vieja', 'Cita Ana — consulta', CAL_JOSE,
         '2026-09-27T10:00:00-04:00', '2026-09-27T11:00:00-04:00', '2026-09-06T06:00:00.000Z'),
      ev('nueva', 'Cita Sil — consulta', CAL_JOSE,
         '2026-09-27T10:00:00-04:00', '2026-09-27T11:00:00-04:00', '2026-09-06T20:16:00.000Z'),
    ], AHORA, CON_HORARIO);
    expect(items[0]?.['eventoABorrar']).toBe('nueva');
    expect(items[0]?.['causaDeLaCaida']).toBe('cruce');
    expect(String(items[0]?.['respuesta'])).toContain('ocupado');
  });

  it('la causa llega a `citasCaidas`, que es lo que lee el reintento', () => {
    const r = soloEsta('2026-09-27T10:00:00-04:00', '2026-09-27T11:00:00-04:00')[0] ?? {};
    const caidas = r['citasCaidas'] as { causa: string; persona: string }[];
    expect(caidas[0]).toMatchObject({ causa: 'cerrado', persona: 'Dr. Sandoval' });
  });

  it('los tres flujos llevan el MISMO candado de horario', () => {
    // Un cliente con el candado viejo es un defecto que nadie nota hasta que
    // agenda un domingo (CLAUDE.md: se aplica a todos o a ninguno).
    for (const cliente of ['demo-a', 'platinum', 'bellido']) {
      const otro = JSON.parse(readFileSync(
        join(aqui, `../../Flujos/${cliente}-agendamiento.json`), 'utf8'),
      ) as { nodes: { name: string; parameters: { jsCode?: string } }[] };
      const suyo = otro.nodes.find((n) => n.name === 'Comprobar reserva')?.parameters.jsCode;
      expect(suyo, cliente).toBe(codigo);
    }
  });
});

describe('El aviso no le dice al cliente que quedó algo cuando no quedó nada', () => {
  it('una sola cita, y es la que cae: sin «el resto de lo que agendamos»', () => {
    const r = comprobarReserva([
      ev('vieja', 'Cita Ana — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-06T06:00:00.000Z'),
      ev('nueva', 'Cita Sil — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-06T20:16:00.000Z'),
    ]);
    expect(String(r['respuesta'])).not.toContain('El resto');
    expect(r['reservaVerificada']).toBe(false);
  });

  it('pero con dos citas y una sobreviviente, sí lo dice: es verdad', () => {
    const r = comprobarTodo([
      ev('vieja', 'Cita Ana — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-06T06:00:00.000Z'),
      ev('choca', 'Cita Sil — corte', CAL_JOSE,
         '2026-09-07T09:00:00-04:00', '2026-09-07T10:00:00-04:00', '2026-09-06T20:16:00.000Z'),
      ev('buena', 'Cita Sil — color', CAL_MARIA,
         '2026-09-07T11:00:00-04:00', '2026-09-07T12:00:00-04:00', '2026-09-06T20:16:01.000Z'),
    ])[0] ?? {};
    expect(String(r['respuesta'])).toContain('El resto de lo que agendamos si esta bien');
    expect(r['reservaVerificada']).toBe(true);
  });
});

/**
 * LA CITA DE ESTA CONVERSACIÓN, NO LA DE OTRO PACIENTE (20/09/2026).
 *
 * Prueba real con dos teléfonos: Silvana agendó el jueves 16:00 y, un minuto
 * después, Andres agendó el lunes 15:00 en la MISMA agenda. `recien` junta todo
 * lo creado en los últimos cinco minutos en esa agenda, y se tomaba `recien[0]`:
 * la seña de Andres quedó atada a la cita de Silvana. Si él pagaba, se
 * confirmaba la de ella y la suya quedaba pendiente hasta que el barrido la
 * borrara, con el pago hecho.
 */
describe('La seña se ata a la cita que creó ESTA conversación', () => {
  const deSilvana = ev('silvana', 'Cita Silvana — blanqueamiento', CAL_JOSE,
    '2026-09-24T16:00:00-04:00', '2026-09-24T17:00:00-04:00', '2026-09-06T20:15:05.000Z');
  const deAndres = ev('andres', 'PENDIENTE DE SEÑA · Cita Andrés — blanqueamiento', CAL_JOSE,
    '2026-09-21T15:00:00-04:00', '2026-09-21T16:00:00-04:00', '2026-09-06T20:16:00.000Z');
  const conLaSuya = (id: string) => ({ ...PREVIA, eventosCreados: [{ id, calendario: CAL_JOSE,
    inicio: '2026-09-21T15:00:00-04:00', fin: '2026-09-21T16:00:00-04:00', titulo: 'x' }] });

  it('EL CASO REAL: con dos citas recientes en la agenda, toma la que agendó este turno', () => {
    // Silvana va PRIMERO en la lista, como pasó: la versión anterior la elegía a ella.
    const r = comprobarTodo([deSilvana, deAndres], AHORA, { mensajeReservaNoConfirmada: '' }, conLaSuya('andres'))[0] ?? {};
    expect(r['reservaVerificada']).toBe(true);
    expect(r['eventoId']).toBe('andres');
  });

  it('si la cita de este turno no aparece, NO toma la de otro: queda sin verificar', () => {
    // Sin inicio ni fin la cita propia no se puede inyectar desde lo que
    // devolvió agendar_cita, así que de verdad no aparece.
    const sinDatos = { ...PREVIA, eventosCreados: [{ id: 'andres', calendario: CAL_JOSE }] };
    const r = comprobarTodo([deSilvana], AHORA, { mensajeReservaNoConfirmada: '' }, sinDatos)[0] ?? {};
    expect(r['eventoId']).toBeUndefined();
    expect(r['reservaVerificada']).toBe(false);
    expect(r['citaCreadaNoEncontrada']).toBe(true);
  });

  it('sin los pasos del agente (versiones viejas), sigue tomando la primera reciente, como antes', () => {
    const r = comprobarTodo([deAndres], AHORA, { mensajeReservaNoConfirmada: '' }, PREVIA)[0] ?? {};
    expect(r['eventoId']).toBe('andres');
  });
});

/**
 * EL ALMUERZO NO ES UNA CITA, Y NO PUEDE LLENAR LAS 50 RANURAS.
 *
 * Pedido de Andres (24/09/2026), sobre un riesgo que el propio código del
 * candado tenía anotado como «límite conocido»: `Verificar en el calendario`
 * traía hasta 50 eventos de una ventana de 90 días, y el calendario del Dr.
 * Bellido tiene un evento REPETIDO todos los días de 13:00 a 14:00. Con
 * `singleEvents`, cada repetición cuenta, y con la lista saturada la detección
 * de cruces puede quedar ciega. El candado es la regla mandatoria del 17/09.
 *
 * MEDIDO DESPUÉS, y corrige lo que este comentario decía: el 24/09, con la
 * ventana vieja de 90 días, ese calendario devolvió ONCE eventos, no cincuenta
 * (ejecución #5424). El tope no se estaba alcanzando. Lo que sí quedó
 * comprobado con datos reales es que el bloqueo del mediodía es un evento
 * repetido de verdad (`recurringEventId: 6vvvcqpv…`), así que el detector de
 * abajo actúa sobre un caso real y no sobre uno imaginado.
 *
 * Se arregla por los dos lados: la ventana se acota al día de la cita (el
 * almuerzo aporta UN evento, no noventa) y un bloqueo repetido deja de contarse
 * como «otra cita» para pasar a ser lo que es, una restricción del negocio.
 */
describe('Bloqueos repetidos: una restricción, no cincuenta eventos', () => {
  const DIA = 86400000;
  const CAL_OTRO = 'dddd000000dddd@group.calendar.google.com';
  const CONFIG: Record<string, unknown> = {
    mensajeReservaNoConfirmada: '',
    calendarioId: CAL_OTRO,
    funcionarios: JSON.stringify([{ nombre: 'Dr. Sandoval', servicios: [], calendario: CAL_JOSE }]),
  };
  const creadoEn = (id: string, calendario: string, inicio: string, fin: string) =>
    ({ id, calendario, inicio, fin, titulo: `Cita ${id}` });
  const conCreados = (eventosCreados: unknown): Record<string, unknown> =>
    ({ ...PREVIA, ejecutoAgendar: true, verificarReserva: true, eventosCreados });

  it('con cita creada, la ventana se acota a SU día: el almuerzo aporta un evento, no noventa', () => {
    const { items } = calendariosARevisar(
      conCreados([creadoEn('c1', CAL_OTRO, '2026-10-07T11:00:00-04:00', '2026-10-07T11:30:00-04:00')]),
      CONFIG);
    expect(items[0]?.['ventanaAcotada']).toBe(true);
    const desde = Date.parse(String(items[0]?.['ventanaDesde']));
    const hasta = Date.parse(String(items[0]?.['ventanaHasta']));
    // Cubre la cita con un día de margen a cada lado, y nada más.
    expect(desde).toBeLessThan(Date.parse('2026-10-07T11:00:00-04:00'));
    expect(hasta).toBeGreaterThan(Date.parse('2026-10-07T11:30:00-04:00'));
    expect(hasta - desde).toBeLessThanOrEqual(3 * DIA);
  });

  it('dos citas en días distintos: la ventana las cubre a las dos, no noventa días', () => {
    const { items } = calendariosARevisar(conCreados([
      creadoEn('c1', CAL_OTRO, '2026-10-07T11:00:00-04:00', '2026-10-07T11:30:00-04:00'),
      creadoEn('c2', CAL_OTRO, '2026-10-09T16:00:00-04:00', '2026-10-09T16:30:00-04:00'),
    ]), CONFIG);
    const desde = Date.parse(String(items[0]?.['ventanaDesde']));
    const hasta = Date.parse(String(items[0]?.['ventanaHasta']));
    expect(desde).toBeLessThan(Date.parse('2026-10-07T11:00:00-04:00'));
    expect(hasta).toBeGreaterThan(Date.parse('2026-10-09T16:30:00-04:00'));
    expect(hasta - desde).toBeLessThanOrEqual(5 * DIA);
  });

  // SIN CITA CREADA NO SE ACOTA, y no es un descuido: es el camino del detector
  // de texto —el modelo DIJO que agendó y la herramienta no corrió—, donde no
  // hay fecha en la cual anclarse. Ahí la saturación no hace daño: si no se
  // creó nada, lo que se busca no existe y «no quedó registrada» es la
  // respuesta correcta.
  it('sin cita creada se conserva la ventana larga', () => {
    const { items } = calendariosARevisar({ ...PREVIA, eventosCreados: [] }, CONFIG);
    expect(items[0]?.['ventanaAcotada']).toBe(false);
    const dias = (Date.parse(String(items[0]?.['ventanaHasta']))
      - Date.parse(String(items[0]?.['ventanaDesde']))) / DIA;
    expect(dias).toBeGreaterThan(80);
  });

  it('el nodo que consulta usa esa ventana, en los tres flujos', () => {
    for (const archivo of ['demo-a-agendamiento.json', 'platinum-agendamiento.json', 'bellido-agendamiento.json']) {
      const f = JSON.parse(readFileSync(join(aqui, '../../Flujos/', archivo), 'utf8')) as
        { nodes: { name: string; parameters: { options?: Record<string, unknown> } }[] };
      const o = f.nodes.find((n) => n.name === 'Verificar en el calendario')!.parameters.options!;
      expect(o['timeMin'], archivo).toBe('={{ $json.ventanaDesde }}');
      expect(o['timeMax'], archivo).toBe('={{ $json.ventanaHasta }}');
      // Sin orden explícito, Google devuelve los eventos en un orden arbitrario:
      // con la lista recortada, cuáles llegan pasaba a ser cuestión de suerte.
      expect(o['orderBy'], archivo).toBe('startTime');
    }
  });

  // -------------------------------------------------------------------------
  const almuerzo = (extra: Record<string, unknown>) => ({
    ...ev('almuerzo', 'Sin citas - Almuerzo o Varios', CAL_JOSE,
      '2026-09-27T13:00:00-04:00', '2026-09-27T14:00:00-04:00', '2026-08-01T10:00:00.000Z'),
    ...extra,
  });
  const nuevaAlMediodia = ev('nueva', 'Cita Sil — consulta', CAL_JOSE,
    '2026-09-27T13:30:00-04:00', '2026-09-27T14:00:00-04:00', '2026-09-06T20:16:00.000Z');

  it('agendar sobre el almuerzo REPETIDO deshace la cita y lo explica como bloqueo', () => {
    // `recurringEventId` es exacto, no una heurística: Google marca así cada
    // instancia de una serie, y `agendar_cita` nunca crea eventos repetidos.
    const items = comprobarTodo([almuerzo({ recurringEventId: 'serie-almuerzo' }), nuevaAlMediodia]);
    expect(items[0]?.['eventoABorrar']).toBe('nueva');
    expect(items[0]?.['citaSolapada']).toBe(true);
    const texto = String(items[0]?.['respuesta']);
    expect(texto).toContain('reservado en la agenda');
    // Lo que NO puede decir: que otro paciente tenía esa hora.
    expect(texto).not.toContain('ocupado');
    expect(String(items[0]?.['motivoCruce'])).toContain('BLOQUEO');
  });

  it('un bloqueo cargado a mano, sin repetición, se reconoce por lo que dice', () => {
    const items = comprobarTodo([almuerzo({}), nuevaAlMediodia]);
    expect(String(items[0]?.['respuesta'])).toContain('reservado en la agenda');
  });

  it('pero una CITA de otro paciente a la misma hora sigue siendo un cruce', () => {
    const otroPaciente = ev('vieja', 'Cita Ana — consulta', CAL_JOSE,
      '2026-09-27T13:00:00-04:00', '2026-09-27T14:00:00-04:00', '2026-08-01T10:00:00.000Z');
    const items = comprobarTodo([otroPaciente, nuevaAlMediodia]);
    expect(items[0]?.['causaDeLaCaida']).toBe('cruce');
    expect(String(items[0]?.['respuesta'])).toContain('ocupado');
  });

  it('el reintento recibe «horario», que es lo que sabe explicar de un bloqueo', () => {
    // El contrato de `causaDeLaCaida` sigue siendo de dos valores: el prompt del
    // reintento distingue «horario» de todo lo demás. Un bloqueo es lo primero:
    // «en ese horario no se atiende» es verdad.
    const items = comprobarTodo([almuerzo({ recurringEventId: 'serie' }), nuevaAlMediodia]);
    expect(items[0]?.['causaDeLaCaida']).toBe('horario');
  });
});

describe('Olvidar turno fallido: borra DOS mensajes, no la memoria entera', () => {
  // VERIFICADO CONTRA EL PAQUETE `@n8n/n8n-nodes-langchain@2.36.5` el 25/09/2026
  // (`dist/node-definitions/nodes/n8n-nodes-langchain/memoryManager/v11/mode_delete.ts`):
  //   deleteMode?: 'lastN' | 'all'      (@default lastN)
  //   lastMessagesCount?: number        (@displayOptions.show { deleteMode: ["lastN"] })
  // y en `MemoryManager.node.js` el código hace `if (deleteMode === 'lastN') {...}`
  // y, si no, borra TODO. Desde el 17/09 los tres flujos de reservas declaraban
  // `lastMessages`, que no existe: en cada reintento tras un cruce se vaciaba la
  // memoria completa del paciente, justo cuando la conversación más importa.
  // Un parámetro mal nombrado no da error en n8n: el nodo corre con el valor
  // por defecto o con la rama «else». Por eso se fija acá.
  const VALIDOS = ['lastN', 'all'];
  for (const cliente of ['demo-a', 'platinum', 'bellido']) {
    it(`${cliente}: deleteMode es lastN con lastMessagesCount 2, y los dos son valores que el nodo conoce`, () => {
      const otro = JSON.parse(readFileSync(
        join(aqui, `../../Flujos/${cliente}-agendamiento.json`), 'utf8'),
      ) as { nodes: { name: string; type: string; typeVersion: number; parameters: Record<string, unknown> }[] };
      const m = otro.nodes.find((n) => n.name === 'Olvidar turno fallido');
      expect(m, cliente).toBeDefined();
      expect(m?.type).toBe('@n8n/n8n-nodes-langchain.memoryManager');
      expect(m?.typeVersion).toBe(1.1);
      expect(VALIDOS).toContain(m?.parameters['deleteMode']);
      expect(m?.parameters).toEqual({ mode: 'delete', deleteMode: 'lastN', lastMessagesCount: 2 });
    });
  }
});
