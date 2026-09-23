/**
 * LOS UMBRALES DE USO EXTENDIDO, APLICADOS POR LOS FLUJOS (`Analisis/27` §5).
 *
 * El servidor decide el estado de atención de un teléfono —normal, operador o
 * bloqueado— y lo entrega en `configuracionFlujo`. Estas pruebas comprueban la
 * otra mitad: que los dos flujos de atención lo OBEDECEN antes de llamar al
 * modelo. Sin esta mitad, los umbrales se cuentan pero no cortan nada.
 *
 * COMO EN `estado-comercio.test.ts`, el código se extrae del JSON versionado y
 * se ejecuta: si alguien edita un nodo en n8n y exporta, la prueba corre el
 * código nuevo. Las expresiones `={{ … }}` de los nodos también se evalúan.
 *
 * Se prueba negando: en estado operador o bloqueado el agente NO es alcanzable,
 * y en estado bloqueado NO sale ningún mensaje al cliente.
 *
 * EL ORDEN DE EJECUCIÓN ES PARTE DEL CONTRATO (defecto encontrado al revisar el
 * PR #66). Los flujos corren con `executionOrder: v1`: n8n termina una rama
 * antes de empezar la siguiente, de arriba hacia abajo en el lienzo. Si la
 * respuesta se reporta antes que el mensaje del cliente, la marca que evita el
 * doble aviso ya está puesta al empezar el turno siguiente y el aviso al
 * negocio no sale NUNCA; además la primera respuesta de cada ventana se pierde.
 * La simulación turno a turno del final lo muestra con las funciones reales.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  MENSAJE_USO_EXTENDIDO, avisoDeTransicion, estadoDeAtencion, umbralesDeAtencion,
} from '../functions/src/atencion.ts';
import { contadoresDelMensaje } from '../functions/src/ingesta.ts';

const aqui = dirname(fileURLToPath(import.meta.url));

interface Nodo {
  name: string; type: string; parameters: Record<string, unknown>;
  position?: [number, number]; onError?: string; retryOnFail?: boolean;
  maxTries?: number; waitBetweenTries?: number;
}
interface Flujo {
  nodes: Nodo[];
  connections: Record<string, { main?: { node: string }[][] }>;
  settings?: { executionOrder?: string };
}

const flujo = (archivo: string) => JSON.parse(
  readFileSync(join(aqui, '../../Flujos/', archivo), 'utf8'),
) as Flujo;

function nodo(f: Flujo, nombre: string): Nodo {
  const n = f.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`sin nodo ${nombre}`);
  return n;
}

const destinos = (f: Flujo, desde: string, salida = 0) =>
  (f.connections[desde]?.main?.[salida] ?? []).map((x) => x.node);

/** Quién entra a un nodo, por cualquier salida. */
const origenes = (f: Flujo, hacia: string) => Object.entries(f.connections)
  .filter(([, c]) => (c.main ?? []).some((s) => s.some((x) => x.node === hacia)))
  .map(([origen]) => origen);

/** Todo lo alcanzable desde un nodo, por cualquier salida. */
function alcanzables(f: Flujo, desde: string): Set<string> {
  const vistos = new Set<string>();
  const pendientes = [desde];
  while (pendientes.length) {
    const actual = pendientes.pop() as string;
    for (const salida of f.connections[actual]?.main ?? []) {
      for (const x of salida) {
        if (!vistos.has(x.node)) { vistos.add(x.node); pendientes.push(x.node); }
      }
    }
  }
  return vistos;
}

/** Evalúa una expresión simple de n8n (`={{ … }}`) con el `$json` dado. */
function expresion(texto: unknown, $json: Record<string, unknown>): unknown {
  const m = /^=\{\{([\s\S]*)\}\}$/.exec(String(texto).trim());
  if (!m) throw new Error(`no es una expresión simple: ${String(texto).slice(0, 60)}`);
  // Se evalúa la expresión VERSIONADA, por la misma razón que el código de los
  // nodos: copiarla dejaría la prueba en verde mientras el flujo se rompe.
  // nosemgrep: devsecops.js-eval-prohibido
  const fn = new Function('$json', `return (${m[1]});`) as (j: unknown) => unknown;
  return fn($json);
}

/** Ejecuta un nodo Code; `$(nombre).first()` devuelve `referencias[nombre]`. */
function ejecutar(
  codigo: string, items: Record<string, unknown>[],
  referencias: Record<string, Record<string, unknown>> = {},
): Record<string, unknown>[] {
  const entrada = { all: () => items.map((json) => ({ json })), first: () => ({ json: items[0] }) };
  const $ = (n: string) => ({ first: () => ({ json: referencias[n] ?? {} }) });
  // nosemgrep: devsecops.js-eval-prohibido
  const fn = new Function('$input', '$', codigo) as (i: unknown, r: unknown) => { json: Record<string, unknown> }[];
  return fn(entrada, $).map((x) => x.json);
}

/** Los valores de respaldo del Set `Config base`. */
function configBase(f: Flujo): Record<string, unknown> {
  const set = nodo(f, 'Config base').parameters as
    { assignments: { assignments: { name: string; value: unknown }[] } };
  return Object.fromEntries(set.assignments.assignments.map((a) => [a.name, a.value]));
}

/**
 * `Config del negocio` con una respuesta HTTP simulada del panel. `webhook`
 * son los campos que `Config base` arrastra del disparador (includeOtherFields).
 */
function fusionar(f: Flujo, respuesta: unknown, webhook: Record<string, unknown> = {}): Record<string, unknown> {
  return ejecutar(String(nodo(f, 'Config del negocio').parameters['jsCode']),
    [respuesta as Record<string, unknown>], { 'Config base': { ...configBase(f), ...webhook } })[0] ?? {};
}

const activo = (atencion: unknown) => ({
  statusCode: 200,
  body: {
    tenantId: 'un-negocio', estadoComercio: 'activo', phoneNumberId: '1000000001',
    operacion: { moneda: 'BOB', horarioAtencion: 'lunes a viernes, de 09:00 a 18:00' },
    datosDelNegocio: { nombreNegocio: 'Un Negocio' },
    catalogo: [], funcionarios: [], voz: {},
    atencion,
  },
});

/**
 * `antesDelAgente`: en los flujos de agendamiento, la rama verdadera de
 * «¿Atención normal?» pasa por una CADENA de compuertas antes del agente.
 * «¿Es un comprobante?» (bloque 2): la foto o el PDF de un teléfono con un QR
 * pendiente se lee y se coteja sin modelo. «¿Trae un medio?» (bloque 3):
 * cualquier otro audio, imagen o PDF se convierte en TEXTO antes de entrar.
 * La propiedad que se conserva es la misma: al agente se entra por un solo
 * lugar efectivo, lo que entra es texto, y desde «Uso extendido» no se llega.
 * `entradasAlAgente` son las conexiones que quedan: la salida falsa de la
 * última compuerta y los dos nodos que ya convirtieron el medio en texto.
 *
 * `salidaAlCliente`: en los flujos de agendamiento, desde el 17/09/2026 todo
 * lo que se envía pasa por «Mensaje a enviar» y el reporte saliente cuelga
 * DESPUÉS de «Responder al cliente» (la consola mostraba lo que el modelo
 * dijo y no lo que el cliente recibió, ejecución #2867 de Platinum).
 *
 * EL DEMO B NO TIENE PUNTO ÚNICO DE SALIDA, y desde el 22/09/2026 tampoco
 * conserva el cableado viejo. Su reporte también cuelga del envío, pero por
 * «Texto enviado» (`primeroTrasElEnvio`), un nodo que averigua cuál de los
 * cuatro caminos armó el texto que salió. Hizo falta al agregar el catálogo
 * web: en ese turno el texto del modelo NO es el que se envía, así que la
 * consola —donde se mira lo que Meta cobra— habría registrado otra cosa. La
 * propiedad que se defiende es la misma en los cuatro flujos: se reporta lo
 * enviado, una sola vez, y después de enviarlo.
 */
const FLUJOS = [
  {
    archivo: 'demo-a-agendamiento.json', agente: 'AI Agent (Sofía)',
    compuertaAviso: '¿Transferir a humano?', campoAviso: 'transferir', envioAviso: 'Avisar a recepción',
    campoTexto: 'motivoTransferencia', salidaAlCliente: 'Mensaje a enviar',
    primeroTrasElEnvio: 'Reportar mensaje (saliente)',
    antesDelAgente: ['¿Es un comprobante?', '¿Trae un medio?'],
    entradasAlAgente: ['¿Trae un medio?', 'Preparar transcripción', 'Preparar imagen'],
  },
  {
    archivo: 'demo-b-venta-cobro.json', agente: 'AI Agent NovuChat',
    compuertaAviso: '¿Avisar uso extendido?', campoAviso: 'avisar', envioAviso: 'Avisar al dueño',
    campoTexto: 'textoAviso', salidaAlCliente: null, primeroTrasElEnvio: 'Texto enviado',
    // Desde el 23/09/2026 la venta también desvía el comprobante ANTES del
    // agente (cobro real, `cobroVenta.ts`): entre la compuerta de los umbrales
    // y el modelo hay un eslabón, igual que en los tres de reservas.
    antesDelAgente: ['¿Es un comprobante?'],
    entradasAlAgente: ['¿Es un comprobante?'],
  },
  // El flujo de reservas de Clínica Platinum es el Demo A con los datos del
  // cliente: obedece los umbrales por los mismos nodos.
  {
    archivo: 'platinum-agendamiento.json', agente: 'AI Agent (Sofía)',
    compuertaAviso: '¿Transferir a humano?', campoAviso: 'transferir', envioAviso: 'Avisar a recepción',
    campoTexto: 'motivoTransferencia', salidaAlCliente: 'Mensaje a enviar',
    primeroTrasElEnvio: 'Reportar mensaje (saliente)',
    antesDelAgente: ['¿Es un comprobante?', '¿Trae un medio?'],
    entradasAlAgente: ['¿Trae un medio?', 'Preparar transcripción', 'Preparar imagen'],
  },
  // Reservas del consultorio del Dr. Bellido: también es el Demo A con los datos
  // del cliente, y obedece los umbrales por los mismos nodos. Desde el 18/09
  // tiene, ENTRE la compuerta y el agente, el estado de la conversación y las
  // tres compuertas sin modelo (menú, contacto directo, emergencia): el agente
  // sigue siendo alcanzable SOLO desde la rama verdadera de «¿Atención normal?».
  {
    archivo: 'bellido-agendamiento.json', agente: 'AI Agent (Sofía)',
    compuertaAviso: '¿Transferir a humano?', campoAviso: 'transferir', envioAviso: 'Avisar a recepción',
    campoTexto: 'motivoTransferencia', salidaAlCliente: 'Mensaje a enviar',
    primeroTrasElEnvio: 'Reportar mensaje (saliente)',
    antesDelAgente: ['¿Es un comprobante?', '¿Trae un medio?', 'Estado de la conversación',
      '¿Menú inicial?', '¿Contacto directo?', '¿Emergencia?'],
    // En el consultorio, lo que convirtió el medio en texto no le habla al
    // agente: entra por su estado de la conversación, como cualquier turno.
    entradasAlAgente: ['¿Emergencia?'],
  },
] as const;

describe('El mensaje fijo de uso extendido', () => {
  it('es neutro: no habla de límites, de mensajes ni de dinero', () => {
    expect(MENSAJE_USO_EXTENDIDO).not.toMatch(/l[ií]mite|mensajes|pago|cobr|deuda|plan/i);
  });
});

describe.each(FLUJOS)('$archivo', (entrada) => {
  const { archivo, agente, compuertaAviso, campoAviso, envioAviso, campoTexto, salidaAlCliente,
    primeroTrasElEnvio } = entrada;
  const f = flujo(archivo);

  describe('Traer configuración', () => {
    it('manda el teléfono que escribió, tomado del webhook', () => {
      const cuerpo = expresion(nodo(f, 'Traer configuración').parameters['jsonBody'],
        { messages: [{ from: '59170000001' }], phoneNumberId: '1000000001' });
      expect(JSON.parse(String(cuerpo))).toEqual({ telefono: '59170000001' });
    });

    it('sin mensaje en el webhook manda un teléfono vacío, sin romperse', () => {
      const cuerpo = expresion(nodo(f, 'Traer configuración').parameters['jsonBody'], {});
      expect(JSON.parse(String(cuerpo))).toEqual({ telefono: '' });
    });
  });

  describe('Config del negocio: el estado de atención', () => {
    it('baja el estado, el aviso fijo y el aviso a recepción que manda el panel', () => {
      const salida = fusionar(f, activo({
        estado: 'operador', mensajeFijo: 'Texto del panel', avisarRecepcion: 'operador',
        respuestasEnVentana: 50, ventanaVenceEn: '2026-10-06T18:00:00.000Z',
      }));
      expect(salida).toMatchObject({
        estadoComercio: 'operativo', atencionEstado: 'operador',
        atencionMensajeFijo: 'Texto del panel', atencionAvisarRecepcion: 'operador',
        atencionRespuestas: 50, atencionVenceEn: '2026-10-06T18:00:00.000Z',
      });
    });

    it('sin `atencion` en la respuesta, normal y con el aviso fijo del servidor', () => {
      const salida = fusionar(f, activo(null));
      expect(salida['atencionEstado']).toBe('normal');
      expect(salida['atencionMensajeFijo']).toBe(MENSAJE_USO_EXTENDIDO);
      expect(salida['atencionAvisarRecepcion']).toBe('');
    });

    it('un estado o un aviso que no se reconoce cae a normal', () => {
      const salida = fusionar(f, activo({ estado: 'cortado', avisarRecepcion: 'siempre' }));
      expect(salida['atencionEstado']).toBe('normal');
      expect(salida['atencionAvisarRecepcion']).toBe('');
    });

    it('si el panel no contesta o suspende, el estado de atención es normal', () => {
      for (const r of [{ statusCode: 409, body: { estado: 'suspendido' } }, { statusCode: 500, body: {} }, {}]) {
        expect(fusionar(f, r)['atencionEstado']).toBe('normal');
      }
    });
  });

  describe('La compuerta, antes del agente', () => {
    it('«¿Comercio operativo?» ya no va directo al agente: pasa por «¿Atención normal?»', () => {
      expect(destinos(f, '¿Comercio operativo?', 0)).toEqual(['¿Atención normal?']);
      expect(destinos(f, '¿Comercio operativo?', 1)).toEqual(['Comercio no operativo']);
    });

    it('el agente SOLO es alcanzable desde la rama verdadera de «¿Atención normal?»', () => {
      // Entre la compuerta y el agente hay una CADENA de eslabones sin modelo:
      // las compuertas de medios del vertical (bloques 2 y 3) y, en el
      // consultorio, su estado de la conversación y su menú. Lo que no cambia
      // es que la cadena ARRANCA en la rama verdadera, que cada eslabón lleva
      // al siguiente, y que al agente se entra por los lugares DECLARADOS: los
      // que ya convirtieron el medio en TEXTO, nunca uno con un binario.
      const antes = ('antesDelAgente' in entrada ? entrada.antesDelAgente : null) as readonly string[] | null;
      if (antes) {
        const cadena = [...antes, agente];
        expect(destinos(f, '¿Atención normal?', 0)).toEqual([cadena[0]]);
        expect(origenes(f, cadena[0]!)).toEqual(['¿Atención normal?']);
        for (let i = 0; i < cadena.length - 1; i++) {
          expect(alcanzables(f, cadena[i]!).has(cadena[i + 1]!), `${cadena[i]} → ${cadena[i + 1]}`).toBe(true);
        }
        const entradas = (entrada as { entradasAlAgente?: readonly string[] }).entradasAlAgente ?? [antes[antes.length - 1]!];
        expect(origenes(f, agente).sort()).toEqual([...entradas].sort());
      } else {
        expect(origenes(f, agente)).toEqual(['¿Atención normal?']);
        expect(destinos(f, '¿Atención normal?', 0)).toEqual([agente]);
      }
      // LA RAMA FALSA NUNCA LLEGA A UN MODELO DE CONVERSACIÓN. Antes esto se
      // afirmaba por su FORMA —«la salida falsa va directo a Uso extendido»— y
      // la forma cambió el 20/09/2026: un comprobante con seña pendiente se
      // desvía al cotejo, porque en uso extendido se ignoraba un pago real
      // (prueba con teléfono). Lo que importa es lo que la forma protegía, y se
      // afirma directo: desde la rama falsa, por NINGÚN camino se alcanza un
      // agente. Es más fuerte que la versión anterior —cubre cualquier desvío
      // futuro, no solo el de hoy— y mira TODOS los agentes, incluido el del
      // reintento tras un cruce, que también llama al modelo.
      const desdeLaRamaFalsa = new Set<string>();
      for (const d of destinos(f, '¿Atención normal?', 1)) {
        desdeLaRamaFalsa.add(d);
        for (const x of alcanzables(f, d)) desdeLaRamaFalsa.add(x);
      }
      const agentes = f.nodes.filter((n) => n.type.endsWith('.agent')).map((n) => n.name);
      expect(agentes.length).toBeGreaterThan(0);
      for (const a of agentes) {
        expect(desdeLaRamaFalsa.has(a), `la rama falsa alcanza «${a}»`).toBe(false);
      }
      expect(desdeLaRamaFalsa.has('Uso extendido')).toBe(true);
    });

    it('desde «Uso extendido» no se llega al agente por NINGÚN camino', () => {
      expect(alcanzables(f, 'Uso extendido').has(agente)).toBe(false);
    });

    it.each([[undefined], [''], ['normal']])('con estado %s va al modelo', (estado) => {
      const condicion = (nodo(f, '¿Atención normal?').parameters['conditions'] as
        { conditions: { leftValue: string }[] }).conditions[0]?.leftValue;
      expect(expresion(condicion, { atencionEstado: estado })).toBe(true);
    });

    it.each([['operador'], ['bloqueado']])('con estado %s NO va al modelo', (estado) => {
      const condicion = (nodo(f, '¿Atención normal?').parameters['conditions'] as
        { conditions: { leftValue: string }[] }).conditions[0]?.leftValue;
      expect(expresion(condicion, { atencionEstado: estado })).toBe(false);
    });
  });

  describe('Uso extendido', () => {
    const uso = (j: Record<string, unknown>) =>
      ejecutar(String(nodo(f, 'Uso extendido').parameters['jsCode']), [{
        from: '59170000001', nombrePerfil: 'Ana', phoneNumberId: '1000000001', numeroDueno: '59170000009',
        atencionMensajeFijo: MENSAJE_USO_EXTENDIDO, atencionRespuestas: 50,
        atencionVenceEn: '2026-10-06T18:00:00.000Z', ...j,
      }])[0] ?? {};

    it('en operador responde el aviso fijo y, la primera vez, avisa', () => {
      const s = uso({ atencionEstado: 'operador', atencionAvisarRecepcion: 'operador' });
      expect(s).toMatchObject({ responder: true, respuesta: MENSAJE_USO_EXTENDIDO, [campoAviso]: true, from: '59170000001' });
    });

    it('en operador, las veces siguientes responde pero NO vuelve a avisar', () => {
      const s = uso({ atencionEstado: 'operador', atencionAvisarRecepcion: '' });
      expect(s['responder']).toBe(true);
      expect(s[campoAviso]).toBe(false);
    });

    it('en bloqueado NO responde nada y, la primera vez, avisa', () => {
      const s = uso({ atencionEstado: 'bloqueado', atencionAvisarRecepcion: 'bloqueado', atencionRespuestas: 100 });
      expect(s).toMatchObject({ responder: false, respuesta: '', [campoAviso]: true });
    });

    it('en bloqueado, las veces siguientes no hace nada', () => {
      const s = uso({ atencionEstado: 'bloqueado', atencionAvisarRecepcion: '' });
      expect(s['responder']).toBe(false);
      expect(s[campoAviso]).toBe(false);
    });

    it('el aviso habla de la ventana de 24 horas y dice bien hasta cuándo', () => {
      const conFecha = String(uso({ atencionEstado: 'bloqueado', atencionAvisarRecepcion: 'bloqueado' })[campoTexto]);
      const sinFecha = String(uso({ atencionEstado: 'bloqueado', atencionAvisarRecepcion: 'bloqueado', atencionVenceEn: '' })[campoTexto]);
      const operador = String(uso({ atencionEstado: 'operador', atencionAvisarRecepcion: 'operador' })[campoTexto]);
      for (const t of [conFecha, sinFecha, operador]) {
        expect(t).toContain('ventana de 24 horas');
        expect(t).not.toMatch(/\bhoy\b|en el día|el mañana/);
      }
      expect(conFecha).toContain('hasta el ');
      expect(sinFecha).toContain('hasta mañana');
    });

    it('la respuesta fija sale al cliente y se reporta como saliente, porque cuenta', () => {
      expect(destinos(f, 'Uso extendido')).toContain('¿Responder uso extendido?');
      // El aviso fijo sale por el MISMO envío que todo lo demás —con su paso
      // previo donde lo hay— y el reporte cuelga DESPUÉS del envío: se reporta
      // lo que salió, no lo que se pensaba mandar. Antes, en el Demo B, el
      // reporte colgaba en paralelo al envío y contaba un mensaje que Meta
      // podía haber rechazado.
      expect(destinos(f, '¿Responder uso extendido?', 0)).toEqual([salidaAlCliente ?? 'Responder al cliente']);
      if (salidaAlCliente) expect(destinos(f, salidaAlCliente)).toEqual(['Responder al cliente']);
      // Del envío cuelgan, PRIMERO, el reporte del texto —o el nodo que lo
      // alimenta— y, DEBAJO, lo que cada flujo agregue: la compuerta del pin
      // (Analisis/34 §2) y, en Bellido, la de su segundo mensaje. Con orden v1
      // el texto se reporta antes que nada.
      expect(destinos(f, 'Responder al cliente')[0]).toBe(primeroTrasElEnvio);
      expect(primeroTrasElEnvio === 'Reportar mensaje (saliente)'
        || alcanzables(f, primeroTrasElEnvio).has('Reportar mensaje (saliente)')).toBe(true);
      for (const d of destinos(f, 'Responder al cliente').slice(1)) {
        // Todo lo que cuelga debajo del reporte es una COMPUERTA que solo
        // pasa a pedido: el pin, el contacto, el reenvío del QR, las redes.
        expect(d, d).toMatch(/^¿(Enviar|Reenviar) /);
      }
      const condicion = (nodo(f, '¿Responder uso extendido?').parameters['conditions'] as
        { conditions: { leftValue: string }[] }).conditions[0]?.leftValue;
      expect(expresion(condicion, { responder: true })).toBe(true);
      expect(expresion(condicion, { responder: false })).toBe(false);
    });

    it('el aviso al negocio sale por el nodo de envío que ya existe', () => {
      expect(destinos(f, 'Uso extendido')).toContain(compuertaAviso);
      expect(destinos(f, compuertaAviso, 0)).toContain(envioAviso);
    });
  });

  describe('En cadena: panel → Config del negocio → Normalizar entrada → Uso extendido', () => {
    const webhook = {
      messages: [{ from: '59170000001', id: 'wamid.PRUEBA', type: 'text', text: { body: 'y otra cosa más' } }],
      contacts: [{ profile: { name: 'Ana' } }],
    };
    const cadena = (atencion: unknown) => {
      const config = fusionar(f, activo(atencion), webhook);
      const normalizada = ejecutar(String(nodo(f, 'Normalizar entrada').parameters['jsCode']), [config]);
      return ejecutar(String(nodo(f, 'Uso extendido').parameters['jsCode']), normalizada)[0] ?? {};
    };

    it('el item que llega a los envíos trae todo lo que esos nodos leen', () => {
      const s = cadena({ estado: 'operador', avisarRecepcion: 'operador', respuestasEnVentana: 50 });
      expect(s).toMatchObject({ from: '59170000001', nombrePerfil: 'Ana', responder: true, [campoAviso]: true });
      expect(s['respuesta']).toBe(MENSAJE_USO_EXTENDIDO);
      if (archivo === 'demo-b-venta-cobro.json') {
        // `Responder al cliente` y `Avisar al dueño` de B leen estos dos del item.
        expect(s['phoneNumberId']).toBe('1000000001');
        expect(String(s['numeroDueno'] ?? '')).not.toBe('');
      }
    });
  });

  describe('El orden de ejecución', () => {
    const y = (nombre: string) => nodo(f, nombre).position?.[1] ?? Number.NaN;

    it('corre con executionOrder v1: una rama entera antes que la siguiente', () => {
      expect(f.settings?.executionOrder).toBe('v1');
    });

    it('el mensaje del cliente se reporta ANTES que la respuesta: su rama está más arriba', () => {
      const hijos = destinos(f, 'Normalizar entrada');
      expect(hijos).toContain('Reportar mensaje (entrante)');
      expect(hijos).toContain('¿Comercio operativo?');
      expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('¿Comercio operativo?'));
    });

    it('ese reporte corre antes de responder, así que tiene tope de tiempo y un solo reintento', () => {
      const r = nodo(f, 'Reportar mensaje (entrante)');
      const opciones = r.parameters['options'] as { timeout?: number } | undefined;
      expect(opciones?.timeout).toBeGreaterThan(0);
      expect(opciones?.timeout).toBeLessThanOrEqual(4000);
      expect(r.maxTries ?? 1).toBeLessThanOrEqual(2);
      // Si la ingesta falla, el cliente igual recibe su respuesta.
      expect(r.onError).toBe('continueRegularOutput');
    });

    it('la respuesta se reporta DESPUÉS de enviarla, y un envío rechazado corta antes del reporte', () => {
      // Cada saliente cuenta como respuesta del bloque (`ingesta.ts`). El nodo
      // oficial de WhatsApp lanza el error de Meta y, sin `onError`, la
      // ejecución termina en ERROR antes de llegar al reporte, que cuelga más
      // abajo: un mensaje rechazado no se cuenta y la falla se ve en n8n. Es la
      // garantía que la captación tuvo que construir con «Confirmar envío»
      // porque su envío usa `neverError` (aceptación del 15/09/2026).
      const envio = nodo(f, 'Responder al cliente');
      expect(envio.type).toBe('n8n-nodes-base.whatsApp');
      expect(envio.onError ?? 'stopWorkflow').toBe('stopWorkflow');
      const padres = origenes(f, 'Reportar mensaje (saliente)');
      expect(padres.length).toBeGreaterThan(0);
      // El ÚNICO padre del reporte está DESPUÉS del envío, y el cuerpo lee el
      // texto del nodo por el que pasó lo enviado, nunca el `$json` de quien
      // lo generó. Así la consola no puede volver a mostrar la confirmación
      // que el candado deshizo, ni —en el Demo B— el texto del modelo en vez
      // del mensaje con el enlace del catálogo.
      const cuerpo = String(nodo(f, 'Reportar mensaje (saliente)').parameters['jsonBody']);
      expect(cuerpo).not.toContain('$json.respuesta');
      if (salidaAlCliente) {
        expect(padres).toEqual(['Responder al cliente']);
        expect(cuerpo).toContain(`$('${salidaAlCliente}').item.json.respuesta`);
      } else {
        // Demo B (22/09/2026): sin punto único de salida, quien averigua qué
        // texto salió es «Texto enviado», que corre después del envío y solo
        // alimenta al reporte.
        expect(padres).toEqual(['Texto enviado']);
        expect(origenes(f, 'Texto enviado')).toEqual(['Responder al cliente']);
        expect(destinos(f, 'Texto enviado')).toEqual(['Reportar mensaje (saliente)']);
        expect(cuerpo).toContain('$json.texto');
      }
      for (const padre of padres) {
        for (const hermano of destinos(f, padre)) {
          if (hermano === 'Reportar mensaje (saliente)') continue;
          if (hermano === 'Responder al cliente' || alcanzables(f, hermano).has('Responder al cliente')) {
            expect(y(hermano), `${padre} → ${hermano}`).toBeLessThan(y('Reportar mensaje (saliente)'));
          }
        }
      }
    });
  });
});

describe('demo-b-venta-cobro.json: «Avisar al dueño» sirve a los dos avisos', () => {
  const f = flujo('demo-b-venta-cobro.json');
  const texto = nodo(f, 'Avisar al dueño').parameters['textBody'];

  it('con `textoAviso` manda el aviso de uso extendido', () => {
    expect(expresion(texto, { textoAviso: 'aviso de uso extendido' })).toBe('aviso de uso extendido');
  });

  it('sin `textoAviso` manda EXACTAMENTE el aviso de pedido de siempre, con su rótulo de simulado', () => {
    expect(expresion(texto, { nombrePerfil: 'Ana', from: '59170000001', respuesta: 'Resumen' })).toBe(
      '🚨 NUEVO PEDIDO CONFIRMADO — DEMOSTRACIÓN\n'
      + '⚠️ Cobro SIMULADO: no hay acreditación bancaria, no entró dinero.\n\n'
      + 'Cliente: Ana (59170000001)\n\n'
      + 'Resumen enviado al cliente:\nResumen',
    );
    expect(expresion(texto, { from: '591', respuesta: 'x' })).toContain('sin nombre de perfil');
  });

  it('el pedido confirmado sigue llegando a «Avisar al dueño»', () => {
    expect(destinos(f, '¿Pedido confirmado?', 0)).toContain('Avisar al dueño');
  });

  it('la compuerta del aviso de uso extendido solo deja pasar `avisar: true`', () => {
    const condicion = (nodo(f, '¿Avisar uso extendido?').parameters['conditions'] as
      { conditions: { leftValue: string }[] }).conditions[0]?.leftValue;
    expect(expresion(condicion, { avisar: true })).toBe(true);
    expect(expresion(condicion, { avisar: false })).toBe(false);
  });

  it('la disculpa por respuesta vacía no usa voseo (llega al cliente)', () => {
    const codigo = String(nodo(f, 'Procesar respuesta').parameters['jsCode']);
    expect(codigo).not.toMatch(/Disculpá|repetís/);
    expect(codigo).toContain('¿Me lo repites?');
  });
});

describe('Turno a turno, con las funciones reales del servidor', () => {
  // Umbrales bajos para recorrer los tres estados en pocos turnos.
  const U = umbralesDeAtencion({ umbralOperador: 3, umbralBloqueo: 5 });
  const T0 = Date.UTC(2026, 9, 5, 14, 0, 0);
  const ts = (ms: number) => ({ toMillis: () => ms });
  type Marcas = Record<string, unknown>;

  /**
   * Lo que la ingesta deja escrito con un mensaje: `contadoresDelMensaje` y,
   * como marca, el estado calculado sobre lo guardado ANTES de ese mensaje.
   * Es el mismo cálculo de `ingesta.ts`; acá solo se arma la escritura.
   */
  function reportar(m: Marcas, direccion: 'entrante' | 'saliente', t: number, texto: string): Marcas {
    const c = contadoresDelMensaje(m, '2026-10', direccion, t, texto);
    return {
      ...m, periodoContado: '2026-10', respuestasDelPeriodo: c.respuestasDelPeriodo,
      mensajesVentana: c.mensajesVentana, atencionEstado: estadoDeAtencion(m, U, t).estado,
      ...(c.atencion ? { atencionDesde: ts(t) } : {}),
    };
  }

  /** Un turno: `configuracionFlujo` primero, y después las dos ramas en el orden dado. */
  function recorrer(entranteAntes: boolean, turnos: number) {
    let m: Marcas = {};
    const pasos: { estado: string; aviso: string | null; enVentana: number }[] = [];
    for (let i = 0; i < turnos; i++) {
      const t = T0 + i * 60_000;
      const at = estadoDeAtencion(m, U, t);
      const aviso = avisoDeTransicion(m['atencionEstado'], at.estado);
      const entrante = () => { m = reportar(m, 'entrante', t, 'quiero otra cosa más'); };
      const saliente = () => { if (at.estado !== 'bloqueado') m = reportar(m, 'saliente', t + 1000, 'respuesta'); };
      if (entranteAntes) { entrante(); saliente(); } else { saliente(); entrante(); }
      pasos.push({ estado: at.estado, aviso, enVentana: Number(m['mensajesVentana'] ?? 0) });
    }
    return pasos;
  }

  it('con el entrante primero: avisa UNA vez al pasar a operador y UNA al pasar a bloqueado', () => {
    const pasos = recorrer(true, 9);
    expect(pasos.map((p) => p.estado)).toEqual([
      'normal', 'normal', 'normal', 'operador', 'operador', 'bloqueado', 'bloqueado', 'bloqueado', 'bloqueado',
    ]);
    expect(pasos.map((p) => p.aviso).filter(Boolean)).toEqual(['operador', 'bloqueado']);
    expect(pasos[3]?.aviso).toBe('operador');
    expect(pasos[5]?.aviso).toBe('bloqueado');
  });

  it('con el entrante primero, la primera respuesta de la ventana se cuenta', () => {
    expect(recorrer(true, 2).map((p) => p.enVentana)).toEqual([1, 2]);
  });

  it('con el orden viejo (respuesta antes que el entrante) el aviso no sale NUNCA y se pierde una respuesta', () => {
    // Documenta el defecto que corrigió la revisión del PR #66: por eso la
    // prueba de posiciones de arriba no es cosmética.
    const pasos = recorrer(false, 9);
    expect(pasos.every((p) => p.aviso === null)).toBe(true);
    expect(pasos[0]?.enVentana).toBe(0);
  });
});
