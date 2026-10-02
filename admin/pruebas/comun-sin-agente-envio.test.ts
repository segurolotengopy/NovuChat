/**
 * LA CADENA DE ENVÍO (`Flujos/experimental/comun-sin-agente/src/envio.mjs`).
 *
 * Tres cosas:
 *  1. EQUIVALENCIA con «Agenda mínima»: con las mismas credenciales y la misma URL, los seis nodos generados
 *     son IGUALES (parámetros, tipo, versión, política de errores y reintentos) a los de su plantilla, que
 *     solo se LEE. Es lo que prueba que el lote de 1 con 1,5 s, el respaldo y el reporte no cambiaron al
 *     sacarlos de ahí.
 *  2. LA FORMA: lote de 1 con 1,5 s en los dos nodos que envían (sin él, Meta entregaba la confirmación y las redes
 *     fuera de orden), ningún rechazo de Meta corta el turno, todo camino llega a una salida, y la cadena
 *     no lleva ningún identificador ni credencial por id.
 *  3. LA EXPRESIÓN que decide si se envía de verdad, EJECUTADA.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { injertar, nodosDeEnvio, type OpcionesDeEnvio } from '../../Flujos/experimental/comun-sin-agente/src/envio.mjs';
import { expresion, type J } from './lib/flujo';

const aqui = dirname(fileURLToPath(import.meta.url));
const AGENDA = JSON.parse(readFileSync(join(aqui, '../../Flujos/experimental/agenda-minima/flujo.plantilla.json'), 'utf8')) as {
  nodes: { name: string; type: string; typeVersion: number; parameters: J; credentials?: J; onError?: string; alwaysOutputData?: boolean; retryOnFail?: boolean; maxTries?: number; waitBetweenTries?: number }[];
  connections: Record<string, { main: { node: string }[][] }>;
};
const deAgenda = (n: string) => AGENDA.nodes.find((x) => x.name === n)!;

const OPC: OpcionesDeEnvio = {
  credenciales: { graph: deAgenda('Enviar a WhatsApp').credentials!['httpHeaderAuth'].name, ingesta: deAgenda('Reportar mensaje (saliente)').credentials!['httpHeaderAuth'].name },
  ingestaUrl: deAgenda('Reportar mensaje (saliente)').parameters['url'] as string,
};
const NOMBRES = ['¿Enviar de verdad?', 'Enviar a WhatsApp', '¿Falló el envío?', 'Enviar respaldo', '¿Reportar? (saliente)', 'Reportar mensaje (saliente)'];

describe('equivalencia con los nodos de Agenda mínima', () => {
  // Tres diferencias A PROPÓSITO (revisión de seguridad del 01/10), que se prueban abajo: el `phoneNumberId` y la versión
  // de Graph se validan antes de entrar a la URL, y lo que no salió ni por el respaldo no se reporta como enviado
  // (`reportarFallidos: true` lo devuelve a lo de Agenda mínima). Todo lo demás es IGUAL.
  const cadena = nodosDeEnvio({ ...OPC, reportarFallidos: true });
  const sinUrl = (p: J): J => { const { url, ...resto } = p; void url; return resto; };
  for (const nombre of NOMBRES) {
    it(`«${nombre}»`, () => {
      const g = cadena.nodes.find((n) => n.name === nombre)!;
      const a = deAgenda(nombre);
      expect(g.type).toBe(a.type);
      expect(g.typeVersion).toBe(a.typeVersion);
      if (nombre === 'Enviar a WhatsApp' || nombre === 'Enviar respaldo') expect(sinUrl(g.parameters)).toEqual(sinUrl(a.parameters));
      else expect(g.parameters).toEqual(a.parameters);
      expect(g.credentials ?? null).toEqual(a.credentials ?? null);
      expect(g.onError ?? null).toBe(a.onError ?? null);
      expect(g.alwaysOutputData ?? null).toBe(a.alwaysOutputData ?? null);
      expect(g.retryOnFail ?? null).toBe(a.retryOnFail ?? null);
      expect(g.maxTries ?? null).toBe(a.maxTries ?? null);
      expect(g.waitBetweenTries ?? null).toBe(a.waitBetweenTries ?? null);
    });
  }
  it('las conexiones internas son las mismas (salvo el empalme con lo que sigue)', () => {
    for (const nombre of NOMBRES) {
      const a = (AGENDA.connections[nombre]?.main ?? []).map((s) => s.map((c) => c.node).filter((n) => NOMBRES.includes(n)));
      const g = (cadena.connections[nombre]?.main ?? []).map((s) => s.map((c) => c.node));
      expect(g.length ? g : a.map(() => [])).toEqual(a.length ? a : g.map(() => []));
    }
  });
});

describe('la forma de la cadena', () => {
  const cadena = nodosDeEnvio(OPC);
  it('lote de 1 con 1,5 s en los DOS nodos que envían, y en ninguno más', () => {
    for (const nombre of ['Enviar a WhatsApp', 'Enviar respaldo']) {
      expect(cadena.nodes.find((n) => n.name === nombre)!.parameters['options']).toMatchObject({ batching: { batch: { batchSize: 1, batchInterval: 1500 } } });
    }
    expect(cadena.nodes.filter((n) => 'batching' in (n.parameters['options'] ?? {})).map((n) => n.name)).toEqual(['Enviar a WhatsApp', 'Enviar respaldo']);
  });
  it('el lote se puede cambiar', () => {
    const c = nodosDeEnvio({ ...OPC, lote: { tamano: 2, intervaloMs: 3000 } });
    expect(c.nodes[1]!.parameters['options']).toMatchObject({ batching: { batch: { batchSize: 2, batchInterval: 3000 } } });
  });
  it('un rechazo de Meta NUNCA corta el turno: los envíos siguen y siempre dejan salida', () => {
    for (const nombre of ['Enviar a WhatsApp', 'Enviar respaldo', 'Reportar mensaje (saliente)']) {
      const n = cadena.nodes.find((x) => x.name === nombre)!;
      expect(n['onError'], nombre).toBe('continueRegularOutput');
      expect(n['alwaysOutputData'], nombre).toBe(true);
    }
  });
  it('el reporte reintenta 3 veces cada 2 s; el envío NO reintenta (reenviar duplicaría el mensaje)', () => {
    const r = cadena.nodes.find((n) => n.name === 'Reportar mensaje (saliente)')!;
    expect([r['retryOnFail'], r['maxTries'], r['waitBetweenTries']]).toEqual([true, 3, 2000]);
    for (const nombre of ['Enviar a WhatsApp', 'Enviar respaldo']) expect(cadena.nodes.find((n) => n.name === nombre)!['retryOnFail']).toBeUndefined();
  });
  it('todo camino desde la entrada llega a una salida; nada queda colgado', () => {
    const alcanzados = new Set<string>();
    const visitar = (n: string): void => { if (alcanzados.has(n)) return; alcanzados.add(n); for (const s of cadena.connections[n]?.main ?? []) for (const c of s) visitar(c.node); };
    visitar(cadena.entrada);
    expect([...alcanzados].sort()).toEqual([...NOMBRES].sort());
    for (const nombre of NOMBRES) {
      const salidas = cadena.connections[nombre]?.main ?? [];
      const sinDestino = salidas.map((s, i) => (s.length ? -1 : i)).filter((i) => i >= 0);
      // Una salida sin destino solo puede ser una de las que el llamador conecta a lo que sigue.
      for (const i of sinDestino) expect(cadena.salidas.some((s) => s.nodo === nombre && s.salida === i), `${nombre}[${i}]`).toBe(true);
    }
  });
  it('el envío fallido pasa por el respaldo y luego al reporte; el exitoso va directo al reporte', () => {
    expect(cadena.connections['¿Falló el envío?']!.main.map((s) => s.map((c) => c.node))).toEqual([['Enviar respaldo'], ['¿Reportar? (saliente)']]);
    expect(cadena.connections['Enviar a WhatsApp']!.main[0]!.map((c) => c.node)).toEqual(['¿Falló el envío?']);
    expect(cadena.connections['Enviar respaldo']!.main[0]!.map((c) => c.node)).toEqual(['¿Reportar? (saliente)']);
  });
  it('NIEGA: ningún identificador ni credencial por id (se emparejan por nombre)', () => {
    const texto = JSON.stringify(cadena);
    expect(texto).not.toMatch(/\d{10,}/);
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    for (const n of cadena.nodes) if (n.credentials) expect(n.credentials['httpHeaderAuth'].id).toBe('');
  });
  it('los nombres de nodo y los ids no se repiten', () => {
    expect(new Set(cadena.nodes.map((n) => n.name)).size).toBe(cadena.nodes.length);
    expect(new Set(cadena.nodes.map((n) => n.id)).size).toBe(cadena.nodes.length);
  });
});

describe('opciones', () => {
  it('NIEGA: sin la credencial de Graph, sin la de la ingesta o sin su URL no se arma', () => {
    expect(() => nodosDeEnvio({ credenciales: {} as OpcionesDeEnvio['credenciales'] })).toThrow(/credenciales\.graph/);
    expect(() => nodosDeEnvio({ credenciales: { graph: 'G' }, ingestaUrl: 'https://x.example' })).toThrow(/credenciales\.ingesta/);
    expect(() => nodosDeEnvio({ credenciales: { graph: 'G', ingesta: 'I' } })).toThrow(/ingestaUrl/);
    expect(() => nodosDeEnvio({ credenciales: { graph: 'G', ingesta: 'I' }, ingestaUrl: 'http://x.example' })).toThrow(/ingestaUrl/);
  });
  it('los nombres de los nodos de los que lee se pueden cambiar', () => {
    const c = nodosDeEnvio({ ...OPC, armado: 'Armar', config: 'Config', entrada: 'Entrada' });
    const texto = JSON.stringify(c);
    expect(texto).toContain("$('Armar')");
    expect(texto).toContain("$('Config')");
    expect(texto).toContain("$('Entrada')");
    expect(texto).not.toContain('Armar mensajes');
    expect(texto).not.toContain('Config del negocio');
  });
  it('reportar:false quita el reporte y no pide la ingesta', () => {
    const c = nodosDeEnvio({ credenciales: { graph: 'G' }, reportar: false });
    expect(c.nodes.map((n) => n.name)).toEqual(['¿Enviar de verdad?', 'Enviar a WhatsApp', '¿Falló el envío?', 'Enviar respaldo']);
    expect(c.salidas).toEqual([{ nodo: 'Enviar respaldo', salida: 0 }, { nodo: '¿Falló el envío?', salida: 1 }]);
  });
  it('las credenciales y la URL de la ingesta que se pasan son las que salen', () => {
    const c = nodosDeEnvio({ credenciales: { graph: 'Graph X', ingesta: 'Ingesta Y' }, ingestaUrl: 'https://ingesta.example/x' });
    expect(c.nodes.find((n) => n.name === 'Enviar a WhatsApp')!['credentials']).toEqual({ httpHeaderAuth: { id: '', name: 'Graph X' } });
    expect(c.nodes.find((n) => n.name === 'Enviar respaldo')!['credentials']).toEqual({ httpHeaderAuth: { id: '', name: 'Graph X' } });
    expect(c.nodes.find((n) => n.name === 'Reportar mensaje (saliente)')!['credentials']).toEqual({ httpHeaderAuth: { id: '', name: 'Ingesta Y' } });
    expect(c.nodes.find((n) => n.name === 'Reportar mensaje (saliente)')!.parameters['url']).toBe('https://ingesta.example/x');
  });
});

describe('lo que la revisión de seguridad encontró (01/10): URL validada y reporte solo de lo que salió', () => {
  const cadena = nodosDeEnvio(OPC);
  const urlDe = (n: string): string => cadena.nodes.find((x) => x.name === n)!.parameters['url'] as string;
  const evaluarUrl = (nombre: string, item: J): string => {
    const m = /^=(.*)$/s.exec(urlDe(nombre))![1]!;
    return m.replace(/\{\{([\s\S]*?)\}\}/g, (_: string, e: string) => {
      // nosemgrep: devsecops.js-eval-prohibido
      const f = new Function('$json', '$', `return (${e});`) as (j: J, r: unknown) => unknown;
      return String(f(item, () => ({ item: { json: item } })));
    });
  };
  it('el `phoneNumberId` y la versión de Graph no pueden alterar la URL del envío', () => {
    expect(evaluarUrl('Enviar a WhatsApp', { phoneNumberId: '12345', waGraphVersion: 'v26.0' })).toBe('https://graph.facebook.com/v26.0/12345/messages');
    // Un valor con `/`, `?`, `@` o letras se limpia o se descarta: la petición nunca sale a otro host o ruta.
    expect(evaluarUrl('Enviar a WhatsApp', { phoneNumberId: '12345/../x?a=b@evil', waGraphVersion: 'v26.0/../x' })).toBe('https://graph.facebook.com/v26.0/12345/messages');
    expect(evaluarUrl('Enviar a WhatsApp', { phoneNumberId: '12345', waGraphVersion: undefined })).toBe('https://graph.facebook.com/v26.0/12345/messages');
  });
  it('el respaldo valida igual (lee del nodo de armado)', () => {
    expect(evaluarUrl('Enviar respaldo', { phoneNumberId: '9@x', waGraphVersion: 'latest' })).toBe('https://graph.facebook.com/v26.0/9/messages');
  });
  const condicion = (c: ReturnType<typeof nodosDeEnvio>): string => c.nodes.find((n) => n.name === '¿Reportar? (saliente)')!.parameters['conditions'].conditions[0].leftValue as string;
  const evaluarReporte = (c: ReturnType<typeof nodosDeEnvio>, json: J): unknown => expresion(condicion(c), json, { 'Armar mensajes': { reportar: true } });
  it('por defecto NO se reporta un mensaje que ni el respaldo pudo enviar (sin idMeta no se cuenta como enviado)', () => {
    expect(evaluarReporte(cadena, { messages: [{ id: 'wamid.X' }] })).toBe(true);
    expect(evaluarReporte(cadena, { error: { message: 'rechazado' } })).toBe(false);
  });
  it('`reportarFallidos: true` conserva lo de Agenda mínima (se reporta igual)', () => {
    expect(evaluarReporte(nodosDeEnvio({ ...OPC, reportarFallidos: true }), { error: { message: 'x' } })).toBe(true);
  });
  it('un item que NO se debe reportar no se reporta, salga o no', () => {
    expect(expresion(condicion(cadena), { messages: [{ id: 'a' }] }, { 'Armar mensajes': { reportar: false } })).toBe(false);
  });
});

describe('¿Enviar de verdad?, con su expresión EJECUTADA', () => {
  const cond = nodosDeEnvio(OPC).nodes[0]!.parameters['conditions'].conditions[0].leftValue as string;
  const evaluar = (config: J, json: J = {}): unknown => expresion(cond, json, { 'Config del negocio': config });
  it('en producción (modoPrueba falso) envía', () => { expect(evaluar({ modoPrueba: false })).toBe(true); });
  it('NIEGA: un item `sinMensajes` no se envía', () => { expect(evaluar({ modoPrueba: false }, { sinMensajes: true })).toBe(false); });
  it('NIEGA: en modo prueba SIN enviarDeVerdad no se envía', () => { expect(evaluar({ modoPrueba: true })).toBe(false); });
  it('NIEGA: en modo prueba con enviarDeVerdad pero SIN teléfono de prueba, no se envía', () => {
    expect(evaluar({ modoPrueba: true, enviarDeVerdad: true })).toBe(false);
  });
  it('en modo prueba con enviarDeVerdad y teléfono de prueba, envía', () => {
    expect(evaluar({ modoPrueba: true, enviarDeVerdad: true, telefonoDePrueba: '71234567' })).toBe(true);
  });
});

describe('injertar en una plantilla', () => {
  const plantilla = () => ({
    nodes: [{ id: 'x', name: 'Armar mensajes', type: 't', parameters: {} }, { id: 'y', name: 'Resumen del turno', type: 't', parameters: {} }],
    connections: {} as Record<string, { main: { node: string }[][] }>,
  });
  it('cuelga la entrada del armado y las salidas de lo que sigue', () => {
    const p = injertar(plantilla(), { ...OPC, siguiente: 'Resumen del turno' });
    expect(p.nodes).toHaveLength(8);
    expect(p.connections['Armar mensajes']!.main[0]!.map((c) => c.node)).toEqual(['¿Enviar de verdad?']);
    expect(p.connections['Reportar mensaje (saliente)']!.main[0]!.map((c) => c.node)).toEqual(['Resumen del turno']);
    expect(p.connections['¿Reportar? (saliente)']!.main[1]!.map((c) => c.node)).toEqual(['Resumen del turno']);
  });
  it('NIEGA: no pisa un nodo que ya existe, ni arma sin el nodo de armado, ni conecta a uno que no existe', () => {
    const repetida = plantilla();
    repetida.nodes.push({ id: 'z', name: 'Enviar respaldo', type: 't', parameters: {} });
    expect(() => injertar(repetida, OPC)).toThrow(/ya tiene un nodo/);
    expect(() => injertar({ nodes: [], connections: {} }, OPC)).toThrow(/no tiene el nodo/);
    expect(() => injertar(plantilla(), { ...OPC, siguiente: 'No existe' })).toThrow(/no tiene el nodo/);
  });
  it('conserva lo que el armado ya tenía conectado', () => {
    const p = plantilla();
    p.connections['Armar mensajes'] = { main: [[{ node: 'Resumen del turno' }]] };
    injertar(p, OPC);
    expect(p.connections['Armar mensajes']!.main[0]!.map((c) => c.node)).toEqual(['Resumen del turno', '¿Enviar de verdad?']);
  });
});
