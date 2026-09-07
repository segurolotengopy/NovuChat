/**
 * SUSPENDER UN COMERCIO TIENE QUE CORTARLE EL ASISTENTE.
 *
 * POR QUÉ EXISTE ESTA SUITE. El 2026-09-07 se reportó —y se confirmó— que no lo
 * cortaba. `configuracionFlujo` contesta **409** con `{estado, mensajeCortesia}`
 * y SIN `tenantId` cuando el comercio no está activo; los nodos de fusión
 * exigían `tenantId` para dar la respuesta por buena, así que un 409 caía al
 * respaldo, y el respaldo dice `estadoComercio: 'operativo'` escrito a mano. Un
 * comercio suspendido seguía siendo atendido, y el flujo de recordatorios
 * seguía enviando plantillas que Meta cobra.
 *
 * Lo peor no fue el defecto: fue que se había AFIRMADO POR ESCRITO que el panel
 * cortaba el servicio, sin comprobarlo. Estas pruebas existen para que esa
 * afirmación pueda verificarse sola de acá en adelante.
 *
 * COMO EN EL CANDADO DE LA AGENDA, la lógica **se extrae del JSON del flujo y se
 * ejecuta**, no se copia: si alguien edita el nodo en n8n y exporta, la prueba
 * corre el código nuevo.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));

interface Nodo { name: string; parameters: { jsCode?: string; options?: unknown } }
const flujo = (archivo: string) => JSON.parse(
  readFileSync(join(aqui, '../../Flujos/', archivo), 'utf8'),
) as { nodes: Nodo[] };

/** Los tres flujos, con el nombre de su nodo de fusión y su política ante silencio. */
const FLUJOS = [
  { archivo: 'demo-a-agendamiento.json', fusion: 'Config del negocio', base: 'Config base', cortaSinRespuesta: false },
  { archivo: 'demo-b-venta-cobro.json', fusion: 'Config del negocio', base: 'Config base', cortaSinRespuesta: false },
  { archivo: 'demo-a-recordatorios.json', fusion: 'Config del recordatorio', base: 'Config base del recordatorio', cortaSinRespuesta: true },
] as const;

/** Ejecuta el nodo de fusión con una respuesta HTTP simulada. */
function fusionar(archivo: string, fusion: string, base: string, respuesta: unknown) {
  const f = flujo(archivo);
  const codigo = f.nodes.find((n) => n.name === fusion)?.parameters.jsCode;
  if (!codigo) throw new Error(`sin nodo ${fusion} en ${archivo}`);
  const set = f.nodes.find((n) => n.name === base) as unknown as {
    parameters: { assignments: { assignments: { name: string; value: unknown }[] } };
  };
  const valores = Object.fromEntries(
    set.parameters.assignments.assignments.map((a) => [a.name, a.value]),
  );
  const entrada = { first: () => ({ json: respuesta }) };
  const contexto = () => ({ first: () => ({ json: valores }) });
  // Se ejecuta el flujo VERSIONADO dentro de una prueba; copiar la lógica
  // dejaría la prueba en verde mientras el flujo se rompe. Misma justificación
  // que en `candado-agenda.test.ts`. La marca va en la línea de arriba del
  // código a propósito: `nosemgrep` solo alcanza a la línea siguiente, y
  // ponerla más arriba no surte efecto —comprobado en el pipeline—.
  // nosemgrep: devsecops.js-eval-prohibido
  const fn = new Function('$input', '$', codigo) as
    (i: unknown, c: unknown) => { json: Record<string, unknown> }[];
  return { salida: fn(entrada, contexto)[0]?.json ?? {}, base: valores };
}

/** Una respuesta del panel con el comercio activo, mínima pero suficiente. */
const ACTIVO = {
  statusCode: 200,
  body: {
    tenantId: 'un-negocio', flujo: 'agendamiento', estadoComercio: 'activo',
    phoneNumberId: '1000000001',
    operacion: { moneda: 'BOB', horarioAtencion: 'lunes a viernes, de 09:00 a 18:00' },
    datosDelNegocio: { nombreNegocio: 'Un Negocio' },
    catalogo: [], funcionarios: [], instruccionesDeVoz: {},
  },
};

/** Lo que devuelve el endpoint cuando el comercio no está activo. */
const SUSPENDIDO = {
  statusCode: 409,
  body: {
    estado: 'suspendido',
    mensajeCortesia: 'Gracias por escribirnos. En este momento no podemos atenderle por '
      + 'este medio. Le pedimos comunicarse directamente con el negocio.',
  },
};

describe.each(FLUJOS)('$archivo', ({ archivo, fusion, base, cortaSinRespuesta }) => {
  it('el nodo HTTP pide la respuesta COMPLETA: sin el código no se puede decidir', () => {
    // Es la mitad del arreglo. Sin `fullResponse`, el 409 llega como un fallo
    // indistinguible de una caída de red, que es lo que causaba el defecto.
    const http = flujo(archivo).nodes.find((n) => n.name === 'Traer configuración');
    const opciones = http?.parameters.options as
      { response?: { response?: { fullResponse?: boolean; neverError?: boolean } } };
    expect(opciones?.response?.response?.fullResponse).toBe(true);
    expect(opciones?.response?.response?.neverError).toBe(true);
  });

  it('un 409 SUSPENDE, y no cae al respaldo', () => {
    const { salida } = fusionar(archivo, fusion, base, SUSPENDIDO);
    expect(salida['estadoComercio']).toBe('suspendido');
  });

  it('el aviso al cliente sale del panel y NO menciona el motivo', () => {
    // El cliente final no tiene por qué enterarse de que el negocio debe dinero.
    const { salida } = fusionar(archivo, fusion, base, SUSPENDIDO);
    const aviso = String(salida['mensajeComercioSuspendido'] ?? '');
    expect(aviso).not.toBe('');
    expect(aviso.toLowerCase()).not.toMatch(/deuda|deb[eo]|pago|suspend|mora|impago/);
  });

  it('con el comercio activo, opera', () => {
    const { salida } = fusionar(archivo, fusion, base, ACTIVO);
    expect(salida['estadoComercio']).toBe('operativo');
    expect(salida['configDeLaConsola']).toBe(true);
  });

  it(`sin respuesta del panel ${cortaSinRespuesta ? 'CORTA' : 'sigue atendiendo'}`, () => {
    // Política deliberada y distinta por flujo: en una conversación hay alguien
    // esperando y una caída del panel no puede dejarlo sin respuesta; en los
    // recordatorios no espera nadie, y mandar plantillas que Meta cobra por un
    // comercio que quizá está suspendido es peor que saltarse un día.
    for (const roto of [{ error: 'timeout' }, { statusCode: 500, body: {} }, {}]) {
      const { salida } = fusionar(archivo, fusion, base, roto);
      expect(salida['estadoComercio']).toBe(cortaSinRespuesta ? 'suspendido' : 'operativo');
      expect(salida['configDeLaConsola']).toBe(false);
    }
  });
});

describe('La compuerta que aplica el estado', () => {
  it.each([
    ['demo-a-agendamiento.json'],
    ['demo-b-venta-cobro.json'],
  ])('%s corta ANTES del agente', (archivo) => {
    // El Demo B no tenía ninguna compuerta: atendía siempre, cobrara o no el
    // negocio. Cortar antes del agente además evita gastar tokens.
    const f = flujo(archivo);
    const nombres = f.nodes.map((n) => n.name);
    expect(nombres).toContain('¿Comercio operativo?');
    expect(nombres).toContain('Comercio no operativo');

    const conexiones = (JSON.parse(
      readFileSync(join(aqui, '../../Flujos/', archivo), 'utf8'),
    ) as { connections: Record<string, { main?: { node: string }[][] }> }).connections;
    const salidas = conexiones['¿Comercio operativo?']?.main ?? [];
    // Rama falsa: al aviso neutro, nunca al agente.
    expect((salidas[1] ?? []).map((x) => x.node)).toEqual(['Comercio no operativo']);
    expect((salidas[0] ?? []).map((x) => x.node).join()).not.toBe('Comercio no operativo');
  });
});
