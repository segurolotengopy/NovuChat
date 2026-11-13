/**
 * `Flujos/latido-n8n.json`: el latido que n8n envía cada 5 minutos a un interruptor de hombre muerto EXTERNO.
 *
 * Por qué existe (política del 11/10/2026 y diseño del 12/11/2026, docs/produccion/monitor-n8n.md): una sonda de la
 * ruta de salud dice que n8n RESPONDE, no que PROCESA. Este flujo prueba que el planificador, el motor y la salida a
 * internet funcionan; si calla 15 minutos, avisa un servicio que no vive en la VM ni pasa por n8n.
 *
 * Pruebas negando: el flujo no puede escribirle a nadie por WhatsApp, no guarda ejecuciones, no lleva la URL de
 * ping (es una URL de capacidad: solo el marcador) y no tiene nada que no sea disparar, configurar y avisar.
 */
import { describe, expect, it } from 'vitest';
import { destinos, leerFlujo, nodo } from '../lib/flujo';

const f = leerFlujo('latido-n8n.json');
const texto = JSON.stringify(f);

describe('flujo «Latido de n8n»', () => {
  it('son exactamente tres nodos: disparar, configurar, avisar', () => {
    expect(f.nodes.map((n: { name: string }) => n.name)).toEqual(['Cada 5 minutos', 'Config base', 'Avisar al monitor externo']);
    expect(f.nodes.map((n: { type: string }) => n.type)).toEqual([
      'n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.set', 'n8n-nodes-base.httpRequest',
    ]);
    expect(destinos(f, 'Cada 5 minutos')).toEqual(['Config base']);
    expect(destinos(f, 'Config base')).toEqual(['Avisar al monitor externo']);
    expect(destinos(f, 'Avisar al monitor externo')).toEqual([]);
  });

  it('late cada 5 minutos (el chequeo externo espera 5 y tolera 10)', () => {
    expect(nodo(f, 'Cada 5 minutos').parameters.rule.interval).toEqual([{ field: 'minutes', minutesInterval: 5 }]);
  });

  it('la URL de ping NO está en el repositorio: solo el marcador, y solo en «Config base»', () => {
    const valor = nodo(f, 'Config base').parameters.assignments.assignments;
    expect(valor).toHaveLength(1);
    expect(valor[0].name).toBe('urlPing');
    expect(valor[0].value).toBe('https://hc-ping.com/REEMPLAZAR_ID_PING_LATIDO_N8N');
    expect(texto.match(/REEMPLAZAR_[A-Z0-9_]+/g)).toEqual(['REEMPLAZAR_ID_PING_LATIDO_N8N']);
    // Ningún identificador real: ni un UUID ni un host distinto del servicio de ping.
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(texto.match(/https?:\/\/[^"/\s]+/g)).toEqual(['https://hc-ping.com']);
  });

  it('avisa con un GET sin cuerpo, sin cabeceras ni credenciales, con tope de tiempo y sin seguir redirecciones', () => {
    const n = nodo(f, 'Avisar al monitor externo');
    expect(n.parameters.method).toBe('GET');
    expect(n.parameters.url).toBe('={{ $json.urlPing }}');
    expect(n.parameters.sendBody).toBeUndefined();
    expect(n.parameters.sendHeaders).toBeUndefined();
    expect(n.parameters.sendQuery).toBeUndefined();
    expect(n.credentials).toBeUndefined();
    expect(n.parameters.options.timeout).toBe(10000);
    expect(n.parameters.options.redirect.redirect.followRedirects).toBe(false);
    // Un parpadeo de red se reintenta; si igual falla, la ejecución queda en error y el silencio es la alerta.
    expect(n.retryOnFail).toBe(true);
    expect(n.maxTries).toBe(3);
    expect(n.onError).toBeUndefined();
    expect(n.continueOnFail).toBeUndefined();
  });

  it('0 mensajes de WhatsApp: no hay nodo de WhatsApp, de Graph, de agente ni de código', () => {
    expect(texto).not.toMatch(/whatsApp|graph\.facebook|langchain|n8n-nodes-base\.code|webhook/i);
    for (const n of f.nodes) expect(n.credentials).toBeUndefined();
  });

  it('no guarda ejecuciones (288 al día) y no cuelga del errorWorkflow', () => {
    expect(f.settings).toEqual({
      executionOrder: 'v1', timezone: 'America/La_Paz', executionTimeout: 60,
      saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false,
    });
    // Con errorWorkflow, una caída de internet de la VM mandaría una alerta por Resend cada 5 minutos.
    expect(f.settings.errorWorkflow).toBeUndefined();
  });
});
