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
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MENSAJE_USO_EXTENDIDO } from '../functions/src/atencion.ts';

const aqui = dirname(fileURLToPath(import.meta.url));

interface Nodo { name: string; type: string; parameters: Record<string, unknown> }
interface Flujo { nodes: Nodo[]; connections: Record<string, { main?: { node: string }[][] }> }

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

/** `Config del negocio` con una respuesta HTTP simulada del panel. */
function fusionar(f: Flujo, respuesta: unknown): Record<string, unknown> {
  return ejecutar(String(nodo(f, 'Config del negocio').parameters['jsCode']),
    [respuesta as Record<string, unknown>], { 'Config base': configBase(f) })[0] ?? {};
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

const FLUJOS = [
  {
    archivo: 'demo-a-agendamiento.json', agente: 'AI Agent (Sofía)',
    compuertaAviso: '¿Transferir a humano?', campoAviso: 'transferir', envioAviso: 'Avisar a recepción',
  },
  {
    archivo: 'demo-b-venta-cobro.json', agente: 'AI Agent NovuChat',
    compuertaAviso: '¿Avisar uso extendido?', campoAviso: 'avisar', envioAviso: 'Avisar al dueño',
  },
] as const;

describe('El mensaje fijo de uso extendido', () => {
  it('es neutro: no habla de límites, de mensajes ni de dinero', () => {
    expect(MENSAJE_USO_EXTENDIDO).not.toMatch(/l[ií]mite|mensajes|pago|cobr|deuda|plan/i);
  });
});

describe.each(FLUJOS)('$archivo', ({ archivo, agente, compuertaAviso, campoAviso, envioAviso }) => {
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
      expect(origenes(f, agente)).toEqual(['¿Atención normal?']);
      expect(destinos(f, '¿Atención normal?', 0)).toEqual([agente]);
      expect(destinos(f, '¿Atención normal?', 1)).toEqual(['Uso extendido']);
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

    it('la respuesta fija sale al cliente y se reporta como saliente, porque cuenta', () => {
      expect(destinos(f, 'Uso extendido')).toContain('¿Responder uso extendido?');
      expect([...destinos(f, '¿Responder uso extendido?', 0)].sort())
        .toEqual(['Reportar mensaje (saliente)', 'Responder al cliente']);
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

  it('la compuerta del aviso de uso extendido solo deja pasar `avisar: true`', () => {
    const condicion = (nodo(f, '¿Avisar uso extendido?').parameters['conditions'] as
      { conditions: { leftValue: string }[] }).conditions[0]?.leftValue;
    expect(expresion(condicion, { avisar: true })).toBe(true);
    expect(expresion(condicion, { avisar: false })).toBe(false);
  });
});
