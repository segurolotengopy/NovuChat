/**
 * `rafagaApagada` POR FLUJO: la bandera por comercio llega de `configuracionFlujo` y el IF de la pieza («¿Esperar ráfaga?») la lee de
 * `$('Config del negocio')`. Si el nodo común «Config del negocio» de un flujo no la copia, la bandera no apaga nada en ese flujo.
 *
 * Para cada flujo que usa uno de los tres nodos comunes tocados (Demo A, onboarding de captación, Walisuma, Casa Bermejo) se corre el CÓDIGO REAL de su
 * «Config del negocio» (el del JSON versionado) con la respuesta del servidor, y la salida alimenta la condición REAL del IF de la pieza. Se prueba negando:
 *   - con `rafagaApagada: true` (y 200): el IF da false (no espera ni agrupa; el mensaje sigue directo);
 *   - sin la bandera, con `false`, con `'true'`, con `1` o con un 409/500: el IF da true (espera).
 */
import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { codigoDe, configBase, leerFlujo } from '../lib/flujo';
import { correr } from '../lib/flujo';
import { NODO_RAFAGA_SI, injertarRafaga } from '../../../Flujos/src/core/rafaga/rafaga.mjs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;

const FLUJOS: { nombre: string; archivo: string }[] = [
  { nombre: 'Demo A (agendamiento)', archivo: 'clientes/demo-a/demo-a-agendamiento.json' },
  { nombre: 'Onboarding de captación', archivo: 'novuchat-onboarding.json' },
  { nombre: 'Walisuma', archivo: 'clientes/walisuma/walisuma.json' },
  { nombre: 'Casa Bermejo', archivo: 'clientes/casa-bermejo/casa-bermejo.json' },
];

/** La condición REAL del IF de la pieza, tal como la deja `injertarRafaga` sobre un flujo mínimo. */
function condicionDelIf(): string {
  const un = (name: string, position: [number, number], type = 'n8n-nodes-base.noOp', parameters: J = {}): J => ({ id: name, name, type, typeVersion: 1, position, parameters });
  const enl = (...nombres: string[]) => ({ main: [nombres.map((node) => ({ node, type: 'main', index: 0 }))] });
  const flujo = {
    name: 'minimo',
    nodes: [
      un('Webhook', [0, 300]),
      un('Normalizar entrada', [240, 300], 'n8n-nodes-base.code', { jsCode: "return [{ json: { tipo: 'text', mensajeId: 'x', from: '1', phoneNumberId: '2', userInput: 't' } }];" }),
      un('Config del negocio', [480, 300]),
      un('Config base', [480, 100]),
      { ...un('Traer configuración', [240, 100], 'n8n-nodes-base.httpRequest', { method: 'POST', url: 'https://us-east1-novuchat-demo.cloudfunctions.net/configuracionFlujo', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendHeaders: true, headerParameters: { parameters: [{ name: 'X-NovuChat-Numero', value: '={{ $json.phoneNumberId }}' }] } }), typeVersion: 4.2, onError: 'continueRegularOutput', credentials: { httpHeaderAuth: { id: '', name: 'REEMPLAZAR_credencial_ingesta' } } },
      un('Reportar mensaje (entrante)', [960, 100]),
      un('¿Atención normal?', [960, 300], 'n8n-nodes-base.if'),
      un('Agente', [1200, 400], 'n8n-nodes-base.noOp', { texto: "={{ $('Agrupar ráfaga').first().json.textoDelTurno }}" }),
    ],
    connections: {
      Webhook: enl('Normalizar entrada'),
      'Normalizar entrada': enl('Config base', 'Reportar mensaje (entrante)'),
      'Config base': enl('Config del negocio'),
      'Config del negocio': enl('¿Atención normal?'),
      '¿Atención normal?': enl('Agente'),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const armado = injertarRafaga(flujo as any, { ancla: { nodo: '¿Atención normal?', salida: 0, destino: 'Agente' }, consumidor: 'Agente', campos: { texto: 'userInput' } }) as J;
  const si = armado.nodes.find((n: J) => n.name === NODO_RAFAGA_SI);
  return si.parameters.conditions.conditions[0].leftValue.replace(/^=\{\{/, '').replace(/\}\}$/, '').trim();
}

function esperaRafaga(cuerpoDelIf: string, base: J, config: J): boolean {
  const item = { tipo: 'text', mensajeId: 'wamid.X', from: '59170000000' };
  const ctx: J = { 'Config base': base, 'Config del negocio': config, item };
  const $ = (nombre: string) => ({ first: () => ({ json: ctx[nombre] ?? {} }), isExecuted: true });
  return vm.compileFunction(`return (${cuerpoDelIf});`, ['$', '$json', 'String'])($, item, String) as boolean;
}

const CUERPO_200 = { tenantId: 'tenant-de-prueba' };

describe.each(FLUJOS)('rafagaApagada: $nombre', ({ archivo }) => {
  const flujo = leerFlujo(archivo);
  const codigo = codigoDe(flujo, 'Config del negocio');
  const base = configBase(flujo);
  const IF = condicionDelIf();

  const configCon = (statusCode: number, body: J): J => correr(codigo, [{ statusCode, body }], { 'Config base': base })[0].json;

  it('con `rafagaApagada: true` y 200 el nodo la copia y el IF da false: no espera ni agrupa', () => {
    const config = configCon(200, { ...CUERPO_200, rafagaApagada: true });
    expect(config.rafagaApagada).toBe(true);
    expect(esperaRafaga(IF, base, config)).toBe(false);
  });

  it('NEGADO: sin la bandera, el IF espera (la respuesta de hoy no cambia)', () => {
    const config = configCon(200, CUERPO_200);
    expect('rafagaApagada' in config && config.rafagaApagada !== undefined).toBe(false);
    expect(esperaRafaga(IF, base, config)).toBe(true);
  });

  it("NEGADO: `false`, `'true'`, `1` y `null` no apagan: solo el true exacto", () => {
    for (const v of [false, 'true', 1, null, 'false', 0]) {
      const config = configCon(200, { ...CUERPO_200, rafagaApagada: v });
      expect(config.rafagaApagada, `valor ${JSON.stringify(v)}`).toBeUndefined();
      expect(esperaRafaga(IF, base, config), `valor ${JSON.stringify(v)}`).toBe(true);
    }
  });

  it('NEGADO: la bandera con un 409 o un 500 no se copia (solo vale con la respuesta 200 del panel)', () => {
    for (const codigoHttp of [409, 500, 0]) {
      const config = configCon(codigoHttp, { ...CUERPO_200, rafagaApagada: true });
      expect(config.rafagaApagada, `código ${codigoHttp}`).toBeUndefined();
    }
  });
});
