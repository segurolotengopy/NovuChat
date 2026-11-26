/**
 * LA RÁFAGA — el injerto (`Flujos/src/core/rafaga/rafaga.mjs`) sobre un flujo SINTÉTICO (en el PR A ningún flujo real la lleva).
 *
 * Forma: ancla → ¿Esperar ráfaga? ─sí→ Esperar ráfaga → Consultar ráfaga → Agrupar ráfaga → destino, y ¿Esperar ráfaga? ─no→ destino.
 * Se prueba negando: sin ancla, sin destino, enlace inexistente, nombres repetidos, «Reportar mensaje (entrante)» que no corre antes, Continue on Fail
 * fuera del HTTP, tiempo mayor de 3000 ms, más de un reintento, credencial o URL cambiadas, código alterado, destinos que no coinciden; y que `quitar` devuelve el
 * flujo exacto (idempotencia que el ensamblador necesita).
 */
import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ_FLUJOS } from '../../scripts/ensamblar-flujo.mjs';
import { correr } from '../lib/flujo';
import {
  ANCLA_REPORTE, NODO_RAFAGA_AGRUPAR, NODO_RAFAGA_CONSULTAR, NODO_RAFAGA_ESPERAR, NODO_RAFAGA_SI, NODOS_DE_LA_RAFAGA, TIMEOUT_RAFAGA_MS,
  codigoDeLaRafaga, hallazgosDeLaRafaga, injertarRafaga, quitarRafaga,
} from '../../../Flujos/src/core/rafaga/rafaga.mjs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Flujo = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Nodo = any;

const URL_SERVIDOR = 'https://us-east1-novuchat-demo.cloudfunctions.net/configuracionFlujo';
const un = (name: string, position: [number, number], extra: Record<string, unknown> = {}): Nodo => ({ id: name, name, type: 'n8n-nodes-base.set', typeVersion: 3, position, parameters: {}, ...extra });
const enl = (...nombres: string[]) => ({ main: [nombres.map((node) => ({ node, type: 'main', index: 0 }))] });

/** Un flujo mínimo con la forma de los reales: el reporte del entrante arriba, y la rama del agente más abajo. */
function sinTipos(): Flujo {
  return {
    name: 'sintetico',
    nodes: [
      un('Webhook', [0, 300]),
      un('Normalizar entrada', [240, 300]),
      un('Config del negocio', [480, 300]),
      un('Config base', [480, 100]),
      {
        id: 'traer', name: 'Traer configuración', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [240, 100], onError: 'continueRegularOutput',
        credentials: { httpHeaderAuth: { id: '', name: 'REEMPLAZAR_credencial_ingesta' } },
        parameters: { method: 'POST', url: URL_SERVIDOR, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendHeaders: true, headerParameters: { parameters: [{ name: 'X-NovuChat-Numero', value: '={{ $json.phoneNumberId }}' }] } },
      },
      un('Reportar mensaje (entrante)', [960, 100]),
      un('¿Atención normal?', [960, 300]),
      un('Agente', [1200, 400]),
    ],
    connections: {
      Webhook: enl('Normalizar entrada'),
      'Normalizar entrada': enl('Config base', 'Reportar mensaje (entrante)'),
      'Config base': enl('Config del negocio'),
      'Config del negocio': enl('¿Atención normal?'),
      '¿Atención normal?': enl('Agente'),
    },
  };
}
/**
 * Como los flujos reales de los demos, el item del ancla sale del normalizador por nodos que LO DEJAN PASAR (IF, Switch, Filter, Wait, NoOp): aquí las dos
 * configuraciones y el ancla son NoOp / IF. Un Code, un Set o un HTTP en ese camino exige `fuente` (lista blanca; ver «con un Code o un HTTP» abajo).
 */
function sintetico(): Flujo {
  const f = sinTipos();
  for (const n of ['Config del negocio', 'Config base']) nodo(f, n).type = 'n8n-nodes-base.noOp';
  nodo(f, '¿Atención normal?').type = 'n8n-nodes-base.if';
  return f;
}
const ANCLA = { nodo: '¿Atención normal?', salida: 0, destino: 'Agente' };
const nodo = (f: Flujo, nombre: string): Nodo => f.nodes.find((n: Nodo) => n.name === nombre);
const armado = (opciones: Record<string, unknown> = {}): Flujo => injertarRafaga(sintetico(), { ancla: ANCLA, ...opciones });
const destinos = (f: Flujo, de: string, i = 0): string[] => (((f.connections[de] || {}).main || [])[i] || []).map((e: Nodo) => e.node);

describe('rafaga: la forma', () => {
  it('agrega exactamente los cuatro nodos y los conecta en línea; «no» y «Agrupar» van al destino original', () => {
    const f = armado();
    expect(f.nodes).toHaveLength(sintetico().nodes.length + 4);
    expect(NODOS_DE_LA_RAFAGA.every((n) => nodo(f, n))).toBe(true);
    expect(destinos(f, '¿Atención normal?')).toEqual([NODO_RAFAGA_SI]);
    expect(destinos(f, NODO_RAFAGA_SI, 0)).toEqual([NODO_RAFAGA_ESPERAR]);
    expect(destinos(f, NODO_RAFAGA_SI, 1)).toEqual(['Agente']);
    expect(destinos(f, NODO_RAFAGA_ESPERAR)).toEqual([NODO_RAFAGA_CONSULTAR]);
    expect(destinos(f, NODO_RAFAGA_CONSULTAR)).toEqual([NODO_RAFAGA_AGRUPAR]);
    expect(destinos(f, NODO_RAFAGA_AGRUPAR)).toEqual(['Agente']);
    expect(hallazgosDeLaRafaga(f)).toEqual([]);
  });

  it('tipos y versiones de n8n: IF 2.2, Wait 1.1 (timeInterval, segundos), HTTP 4.2 y Code 2', () => {
    const f = armado();
    expect(nodo(f, NODO_RAFAGA_SI)).toMatchObject({ type: 'n8n-nodes-base.if', typeVersion: 2.2 });
    expect(nodo(f, NODO_RAFAGA_ESPERAR)).toMatchObject({ type: 'n8n-nodes-base.wait', typeVersion: 1.1 });
    expect(nodo(f, NODO_RAFAGA_ESPERAR).parameters).toMatchObject({ resume: 'timeInterval', unit: 'seconds' });
    expect(nodo(f, NODO_RAFAGA_CONSULTAR)).toMatchObject({ type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2 });
    expect(nodo(f, NODO_RAFAGA_AGRUPAR)).toMatchObject({ type: 'n8n-nodes-base.code', typeVersion: 2 });
    expect(nodo(f, NODO_RAFAGA_AGRUPAR).parameters.jsCode).toBe(codigoDeLaRafaga());
  });

  it('la consulta: misma URL y credencial que «Traer configuración», cabecera por número, cuerpo con el idMeta, Continue on Fail y 3000 ms', () => {
    const c = nodo(armado(), NODO_RAFAGA_CONSULTAR);
    expect(c.parameters.url).toBe(URL_SERVIDOR);
    expect(c.credentials).toEqual({ httpHeaderAuth: { id: '', name: 'REEMPLAZAR_credencial_ingesta' } });
    expect(c.onError).toBe('continueRegularOutput');
    expect(c.parameters.options.timeout).toBe(TIMEOUT_RAFAGA_MS);
    expect(TIMEOUT_RAFAGA_MS).toBe(3000);
    expect(c).toMatchObject({ retryOnFail: true, maxTries: 2, waitBetweenTries: 300 }); // H2: un reintento
    expect(c.parameters.headerParameters.parameters[0].name).toBe('X-NovuChat-Numero');
    expect(c.parameters.jsonBody).toContain("rafaga: { v: 1, idMeta: String($('¿Esperar ráfaga?').first().json.mensajeId) }");
  });

  it('Continue on Fail solo en el HTTP', () => {
    const f = armado();
    for (const n of [NODO_RAFAGA_SI, NODO_RAFAGA_ESPERAR, NODO_RAFAGA_AGRUPAR]) expect(nodo(f, n).onError).toBeUndefined();
  });

  it('el diseño del lienzo: los cuatro nodos van más abajo que «Reportar mensaje (entrante)»', () => {
    const f = armado();
    const rep = nodo(f, ANCLA_REPORTE).position[1];
    for (const n of NODOS_DE_LA_RAFAGA) expect(nodo(f, n).position[1]).toBeGreaterThan(rep);
  });
});

describe('rafaga: la condición del IF (la expresión, evaluada)', () => {
  const evaluar = (f: Flujo, ctx: Record<string, unknown>, corrioReporte = true): unknown => {
    const cuerpo = nodo(f, NODO_RAFAGA_SI).parameters.conditions.conditions[0].leftValue.replace(/^=\{\{/, '').replace(/\}\}$/, '').trim();
    const $ = (nombre: string) => ({
      first: () => { if (!(nombre in ctx)) throw new Error(`sin datos de ${nombre}`); return { json: ctx[nombre] }; },
      isExecuted: nombre === ANCLA_REPORTE ? corrioReporte : true,
    });
    return vm.compileFunction(`return (${cuerpo});`, ['$', '$json', 'String'])($, ctx.item, String);
  };
  const item = { tipo: 'text', mensajeId: 'wamid.X', from: '59170000000' };
  const base = { 'Config base': {}, 'Config del negocio': {}, item };

  it('texto, con id y teléfono, reporte corrido y sin apagar → espera', () => {
    expect(evaluar(armado(), base)).toBe(true);
  });
  it('NEGADO: el interruptor apagado en «Config base» (false o "false")', () => {
    for (const v of [false, 'false']) expect(evaluar(armado(), { ...base, 'Config base': { rafagaActiva: v } })).toBe(false);
    expect(evaluar(armado(), { ...base, 'Config base': { rafagaActiva: true } })).toBe(true);
  });
  it('NEGADO: el comercio la apagó en el servidor (rafagaApagada)', () => {
    expect(evaluar(armado(), { ...base, 'Config del negocio': { rafagaApagada: true } })).toBe(false);
  });
  it('NEGADO: audio, imagen, botón o cualquier tipo que no es texto', () => {
    for (const tipo of ['audio', 'image', 'document', 'interactive', 'order', 'sticker']) {
      expect(evaluar(armado(), { ...base, item: { tipo, mensajeId: 'wamid.X', from: '59170000000' } })).toBe(false);
    }
  });
  it('NEGADO: sin mensajeId o sin teléfono', () => {
    expect(evaluar(armado(), { ...base, item: { tipo: 'text', from: '59170000000' } })).toBe(false);
    expect(evaluar(armado(), { ...base, item: { tipo: 'text', mensajeId: 'wamid.X' } })).toBe(false);
  });
  it('NEGADO: «Reportar mensaje (entrante)» no corrió', () => {
    expect(evaluar(armado(), base, false)).toBe(false);
  });
  it('la puerta del flujo se suma y también niega', () => {
    const f = armado({ puerta: "n.esComprobante !== true && n.eleccion === ''" });
    expect(evaluar(f, { ...base, item: { ...item, eleccion: '' } })).toBe(true);
    expect(evaluar(f, { ...base, item: { ...item, esComprobante: true, eleccion: '' } })).toBe(false);
    expect(hallazgosDeLaRafaga(f)).toEqual([]);
    expect(() => armado({ puerta: 'true /* x */' })).toThrow(/una línea/);
  });
  it('I1: una lectura fallida (un nodo sin ejecutar) NO rompe el turno: la condición da false', () => {
    const { 'Config base': _omitido, ...sinBase } = base;
    expect(evaluar(armado(), sinBase)).toBe(false);
    const { 'Config del negocio': _otro, ...sinConfig } = base;
    expect(evaluar(armado(), sinConfig)).toBe(false);
    expect(evaluar(armado(), { ...base, item: undefined })).toBe(false);
  });
  it('I2: el IF, la consulta y el Code leen del MISMO item (el del ancla) y con los mismos nombres de campo', () => {
    const f = armado({ campos: { mensajeId: 'idEntrante', texto: 'textoLimpio', tipo: 'clase', from: 'telefono', phoneNumberId: 'numeroId' } });
    const si = nodo(f, NODO_RAFAGA_SI).parameters.conditions.conditions[0].leftValue;
    expect(si).toContain('const n = $json;');
    expect(si).toContain("n.clase === 'text' && !!n.idEntrante && !!n.telefono");
    const http = nodo(f, NODO_RAFAGA_CONSULTAR).parameters;
    expect(http.jsonBody).toContain("$('¿Esperar ráfaga?').first().json.telefono");
    expect(http.jsonBody).toContain("$('¿Esperar ráfaga?').first().json.idEntrante");
    expect(http.headerParameters.parameters[0].value).toContain("$('¿Esperar ráfaga?').first().json.numeroId");
    const codigo = nodo(f, NODO_RAFAGA_AGRUPAR).parameters.jsCode;
    expect(codigo).toContain("const CAMPO_ID = 'idEntrante';");
    expect(codigo).toContain("const CAMPO_TEXTO = 'textoLimpio';");
    expect(hallazgosDeLaRafaga(f, { campos: { mensajeId: 'idEntrante', texto: 'textoLimpio', tipo: 'clase', from: 'telefono', phoneNumberId: 'numeroId' } })).toEqual([]);
    expect(hallazgosDeLaRafaga(f).join('|')).toMatch(/no es el nodo común/); // sin decir los campos, lo ve distinto
    expect(() => armado({ campos: { texto: 'a b' } })).toThrow(/nombre inválido/);
    expect(() => armado({ campos: { texto: "x'; process" } })).toThrow(/nombre inválido/);
  });
  it('con «Interpretar entrada» como normalizador (ascendiente) se arma y la guardia lo acepta', () => {
    const f = sintetico();
    nodo(f, 'Normalizar entrada').name = 'Interpretar entrada';
    f.connections['Interpretar entrada'] = f.connections['Normalizar entrada'];
    delete f.connections['Normalizar entrada'];
    f.connections.Webhook = enl('Interpretar entrada');
    injertarRafaga(f, { ancla: ANCLA });
    expect(hallazgosDeLaRafaga(f)).toEqual([]);
  });
  it('la espera sale de «Config base» y se acota de 1 a 5 s con 2 por defecto', () => {
    const cuerpo = nodo(armado(), NODO_RAFAGA_ESPERAR).parameters.amount.replace(/^=\{\{/, '').replace(/\}\}$/, '').trim();
    const esperar = (v: unknown) => vm.compileFunction(`return (${cuerpo});`, ['$', 'Number', 'Math'])(() => ({ first: () => ({ json: { esperaRafagaSeg: v } }) }), Number, Math);
    expect([undefined, 2, 3, 99, 0, -1, 'x', 0.2].map(esperar)).toEqual([2, 2, 3, 5, 2, 2, 2, 1]);
  });
});

describe('rafaga: se niega a armar (NEGATIVAS)', () => {
  it('sin el ancla, sin el destino o con un enlace que no existe', () => {
    expect(() => injertarRafaga(sintetico(), { ancla: { ...ANCLA, nodo: 'No existe' } })).toThrow(/no tiene «No existe»/);
    expect(() => injertarRafaga(sintetico(), { ancla: { ...ANCLA, destino: 'No existe' } })).toThrow(/no tiene «No existe»/);
    expect(() => injertarRafaga(sintetico(), { ancla: { nodo: '¿Atención normal?', destino: 'Config base' } })).toThrow(/no va a/);
    expect(() => injertarRafaga(sintetico(), { ancla: { ...ANCLA, salida: 1 } })).toThrow(/no va a/);
  });
  it('si ya tiene uno de los cuatro nombres (el chat de NovuChat ya tiene «Esperar ráfaga»)', () => {
    const f = sintetico();
    f.nodes.push(un(NODO_RAFAGA_ESPERAR, [0, 0]));
    expect(() => injertarRafaga(f, { ancla: ANCLA })).toThrow(/ya tiene un nodo «Esperar ráfaga»/);
    const g = armado();
    expect(() => injertarRafaga(g, { ancla: ANCLA })).toThrow(/ya tiene un nodo/);
  });
  it('si «Reportar mensaje (entrante)» no existe o no corre antes', () => {
    const sin = sintetico();
    sin.nodes = sin.nodes.filter((n: Nodo) => n.name !== ANCLA_REPORTE);
    expect(() => injertarRafaga(sin, { ancla: ANCLA })).toThrow(/Reportar mensaje/);
    const abajo = sintetico();
    nodo(abajo, ANCLA_REPORTE).position = [960, 900]; // más abajo que el destino y sin ser ascendiente: correría DESPUÉS
    expect(() => injertarRafaga(abajo, { ancla: ANCLA })).toThrow(/ANTES de la ráfaga/);
  });
  it('si el reporte es ascendiente del ancla, vale aunque esté más abajo en el lienzo', () => {
    const f = sintetico();
    nodo(f, ANCLA_REPORTE).position = [960, 900];
    f.connections['Config del negocio'] = enl('Reportar mensaje (entrante)');
    f.connections[ANCLA_REPORTE] = enl('¿Atención normal?');
    expect(() => injertarRafaga(f, { ancla: ANCLA, fuente: 'Normalizar entrada' })).not.toThrow();
  });
  it('sin normalizador, sin «Config base», sin «Config del negocio» o sin «Traer configuración»', () => {
    for (const [faltante, patron] of [['Normalizar entrada', /normaliza/], ['Config base', /Config base/], ['Config del negocio', /Config del negocio/], ['Traer configuración', /Traer configuración/]] as const) {
      const f = sintetico();
      f.nodes = f.nodes.filter((n: Nodo) => n.name !== faltante);
      expect(() => injertarRafaga(f, { ancla: ANCLA }), faltante).toThrow(patron);
    }
  });
  it('I1: el normalizador, «Config del negocio» y «Config base» tienen que ser ASCENDIENTES del ancla', () => {
    for (const aislado of ['Config base', 'Config del negocio', 'Normalizar entrada']) {
      const f = sintetico();
      for (const lista of Object.keys(f.connections)) f.connections[lista].main = f.connections[lista].main.map((l: Nodo[]) => l.filter((e: Nodo) => e.node !== aislado));
      delete f.connections[aislado];
      if (aislado === 'Config del negocio') f.connections['Config base'] = enl('¿Atención normal?');
      if (aislado === 'Config base') f.connections['Normalizar entrada'] = enl('Config del negocio', 'Reportar mensaje (entrante)');
      if (aislado === 'Normalizar entrada') { f.connections.Webhook = enl('Config base'); f.connections['Config base'] = enl('Config del negocio'); }
      expect(() => injertarRafaga(f, { ancla: ANCLA }), aislado).toThrow(new RegExp(`«${aislado}» tiene que ser ascendiente`));
    }
    // y la guardia lo vuelve a exigir en un flujo ya armado
    const armadoOk = armado();
    armadoOk.connections['Config base'] = enl('Agente');
    expect(hallazgosDeLaRafaga(armadoOk).join('|')).toMatch(/«Config base» tiene que ser ascendiente/);
  });
  it('M1: con nombres no predeterminados, la guardia no da falsos «alterado» si se los pasan por opciones', () => {
    const f = sintetico();
    const renombrar = (de: string, a: string) => {
      nodo(f, de).name = a;
      if (f.connections[de]) { f.connections[a] = f.connections[de]; delete f.connections[de]; }
      for (const o of Object.values(f.connections) as Nodo[]) o.main = o.main.map((l: Nodo[]) => l.map((e: Nodo) => (e.node === de ? { ...e, node: a } : e)));
    };
    renombrar('Config base', 'Ajustes base'); renombrar('Config del negocio', 'Datos del comercio'); renombrar('Traer configuración', 'Pedir configuración');
    const opciones = { configBase: 'Ajustes base', config: 'Datos del comercio', traerConfiguracion: 'Pedir configuración' };
    injertarRafaga(f, { ancla: ANCLA, ...opciones });
    expect(nodo(f, NODO_RAFAGA_AGRUPAR).parameters.jsCode).toContain("$('Ajustes base')");
    expect(hallazgosDeLaRafaga(f, opciones)).toEqual([]);
    expect(hallazgosDeLaRafaga(f).length).toBeGreaterThan(0); // sin las opciones no puede saber los nombres: lo dice, no lo da por bueno
  });
  it('M2: la consulta usa el mismo número que «Traer configuración»: sin cabecera X-NovuChat-Numero, o que no sale de phoneNumberId, no se arma', () => {
    for (const cambio of [
      (t: Nodo) => { t.parameters.headerParameters.parameters = []; },
      (t: Nodo) => { t.parameters.headerParameters.parameters[0].value = '={{ $json.otro }}'; },
      (t: Nodo) => { t.parameters.headerParameters.parameters[0].value = '={{ $json.modoPrueba ? 1 : $json.phoneNumberId }}'; },
      (t: Nodo) => { delete t.parameters.headerParameters; },
    ]) {
      const f = sintetico();
      cambio(nodo(f, 'Traer configuración'));
      expect(() => injertarRafaga(f, { ancla: ANCLA })).toThrow(/X-NovuChat-Numero/);
    }
    const prueba = sintetico();
    nodo(prueba, 'Traer configuración').parameters.headerParameters.parameters[0].value = "={{ $json.prueba && $json.prueba.modoPrueba === true ? String($('Config base').first().json.phoneNumberIdEsperado || '') : String($json.phoneNumberId || '') }}";
    expect(() => injertarRafaga(prueba, { ancla: ANCLA })).not.toThrow();
  });
  it('«Traer configuración» con otra URL, sin credencial o con credencial doble', () => {
    for (const cambio of [
      (t: Nodo) => { t.parameters.url = 'https://otro.example.com/otra'; },
      (t: Nodo) => { delete t.credentials; },
      (t: Nodo) => { t.credentials.otra = { id: '', name: 'x' }; },
      (t: Nodo) => { t.parameters.authentication = 'none'; },
    ]) {
      const f = sintetico();
      cambio(nodo(f, 'Traer configuración'));
      expect(() => injertarRafaga(f, { ancla: ANCLA })).toThrow(/rafaga:/);
    }
  });
});

describe('rafaga: las guardias detectan lo alterado (NEGATIVAS)', () => {
  const alterar = (cambio: (f: Flujo) => void): string[] => { const f = armado(); cambio(f); return hallazgosDeLaRafaga(f); };

  it('sin la pieza y sin exigir: no aplica; con exigir: pide los cuatro nodos', () => {
    expect(hallazgosDeLaRafaga(sintetico())).toEqual([]);
    expect(hallazgosDeLaRafaga(sintetico(), { exigir: true })).toEqual(NODOS_DE_LA_RAFAGA.map((n) => `rafaga: falta el nodo «${n}»`));
  });
  it('falta uno solo de los nodos', () => {
    for (const n of NODOS_DE_LA_RAFAGA) expect(alterar((f) => { f.nodes = f.nodes.filter((x: Nodo) => x.name !== n); })).toContain(`rafaga: falta el nodo «${n}»`);
  });
  it('Continue on Fail en otro nodo, o sin él en el HTTP', () => {
    expect(alterar((f) => { nodo(f, NODO_RAFAGA_AGRUPAR).onError = 'continueRegularOutput'; }).join('|')).toMatch(/Agrupar ráfaga/);
    expect(alterar((f) => { nodo(f, NODO_RAFAGA_ESPERAR).continueOnFail = true; }).join('|')).toMatch(/Esperar ráfaga/);
    expect(alterar((f) => { delete nodo(f, NODO_RAFAGA_CONSULTAR).onError; }).join('|')).toMatch(/tiene que llevar Continue on Fail/);
  });
  it('tiempo mayor de 3000 ms o reintentos', () => {
    expect(alterar((f) => { nodo(f, NODO_RAFAGA_CONSULTAR).parameters.options.timeout = 60000; }).join('|')).toMatch(/tiempo máximo de 3000/);
    expect(alterar((f) => { nodo(f, NODO_RAFAGA_CONSULTAR).maxTries = 5; }).join('|')).toMatch(/reintentar UNA vez/);
    expect(alterar((f) => { delete nodo(f, NODO_RAFAGA_CONSULTAR).retryOnFail; }).join('|')).toMatch(/reintentar UNA vez/);
    expect(alterar((f) => { nodo(f, NODO_RAFAGA_CONSULTAR).waitBetweenTries = 10000; }).join('|')).toMatch(/reintentar UNA vez/);
  });
  it('credencial, URL o código cambiados a mano', () => {
    expect(alterar((f) => { nodo(f, NODO_RAFAGA_CONSULTAR).credentials.httpHeaderAuth.name = 'otra'; }).join('|')).toMatch(/no es el nodo común/);
    expect(alterar((f) => { nodo(f, NODO_RAFAGA_CONSULTAR).parameters.url = 'https://x.example.com/configuracionFlujo'; }).join('|')).toMatch(/no es el nodo común/);
    expect(alterar((f) => { nodo(f, NODO_RAFAGA_AGRUPAR).parameters.jsCode += '\n// retocado'; }).join('|')).toMatch(/Agrupar ráfaga».*no es el nodo común/);
    expect(alterar((f) => { nodo(f, NODO_RAFAGA_SI).parameters.conditions.conditions[0].leftValue = '={{ true }}'; }).join('|')).toMatch(/¿Esperar ráfaga\?».*no es el nodo común/);
  });
  it('conexiones: «no» y «Agrupar» a destinos distintos, un salto de nodo, o un segundo padre', () => {
    expect(alterar((f) => { f.connections[NODO_RAFAGA_AGRUPAR] = enl('Config base'); }).join('|')).toMatch(/MISMO destino/);
    expect(alterar((f) => { f.connections[NODO_RAFAGA_SI].main[0] = [{ node: NODO_RAFAGA_AGRUPAR, type: 'main', index: 0 }]; }).join('|')).toMatch(/tiene que ir solo a «Esperar ráfaga»/);
    expect(alterar((f) => { f.connections[NODO_RAFAGA_ESPERAR] = enl(NODO_RAFAGA_AGRUPAR); }).join('|')).toMatch(/tiene que ir solo a «Consultar ráfaga»/);
    expect(alterar((f) => { f.connections['Config del negocio'].main[0].push({ node: NODO_RAFAGA_SI, type: 'main', index: 0 }); }).join('|')).toMatch(/UN solo nodo/);
  });
  it('el reporte pasa a correr después', () => {
    expect(alterar((f) => { nodo(f, ANCLA_REPORTE).position = [0, 2000]; f.connections['Normalizar entrada'] = enl('Config del negocio'); }).join('|')).toMatch(/ANTES de la ráfaga/);
  });
});

describe('rafaga: quitar e injertar son idempotentes (lo que el ensamblador necesita)', () => {
  it('quitar devuelve el flujo original exacto', () => {
    const f = armado();
    expect(quitarRafaga(f)).toEqual(sintetico());
    expect(JSON.stringify(f)).toBe(JSON.stringify(sintetico()));
  });
  it('quitar sobre un flujo sin la pieza no cambia nada', () => {
    expect(JSON.stringify(quitarRafaga(sintetico()))).toBe(JSON.stringify(sintetico()));
  });
  it('quitar + injertar reproduce el JSON canónico byte a byte, aunque alguien lo haya retocado', () => {
    const canonico = JSON.stringify(armado(), null, 2);
    const retocado = armado();
    nodo(retocado, NODO_RAFAGA_AGRUPAR).parameters.jsCode = 'return [];';
    nodo(retocado, NODO_RAFAGA_CONSULTAR).parameters.options.timeout = 99999;
    expect(JSON.stringify(injertarRafaga(quitarRafaga(retocado), { ancla: ANCLA }), null, 2)).toBe(canonico);
  });
  it('con una puerta propia también se reproduce (la lee del propio nodo)', () => {
    const op = { ancla: ANCLA, puerta: 'n.eleccion === ""' };
    const canonico = JSON.stringify(armado(op), null, 2);
    expect(JSON.stringify(injertarRafaga(quitarRafaga(armado(op)), op), null, 2)).toBe(canonico);
  });
  it('con varias conexiones en la misma salida solo se toca la del destino', () => {
    const f = sintetico();
    f.connections['¿Atención normal?'] = enl('Config base', 'Agente');
    injertarRafaga(f, { ancla: ANCLA });
    expect(destinos(f, '¿Atención normal?')).toEqual(['Config base', NODO_RAFAGA_SI]);
    quitarRafaga(f);
    expect(destinos(f, '¿Atención normal?')).toEqual(['Config base', 'Agente']);
  });
});

describe('rafaga: `fuente` (el ancla viene tras un nodo que NO trae los campos del mensaje)', () => {
  /** Normalizar → Config base → Config del negocio → «Puerta del turno» (Code que solo emite {ruta, texto…}) → ancla (IF) → Agente. */
  function tras(tipo: 'code' | 'http' = 'code', codigo = "return $input.all().map(() => ({ json: { ruta: 'sigue', texto: 'x', responder: false } }));"): Flujo {
    const f = sintetico();
    const puerta = tipo === 'code'
      ? { ...un('Puerta del turno', [720, 300]), type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: codigo } }
      : { ...un('Puerta del turno', [720, 300]), type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2 };
    f.nodes.push(puerta);
    nodo(f, '¿Atención normal?').type = 'n8n-nodes-base.if';
    f.connections['Config del negocio'] = enl('Puerta del turno');
    f.connections['Puerta del turno'] = enl('¿Atención normal?');
    return f;
  }
  const CAMPOS = { texto: 'texto' };

  it('sin fuente y con un ancla que viene tras un Code o un HTTP que no traen los campos: se niega (no queda apagada en silencio)', () => {
    expect(() => injertarRafaga(tras('code'), { ancla: ANCLA, campos: CAMPOS }), 'code').toThrow(/lo impide «Puerta del turno».*apagada en silencio.*fuente/);
    expect(() => injertarRafaga(tras('http'), { ancla: ANCLA, campos: CAMPOS }), 'http').toThrow(/lo impide «Puerta del turno»/);
    expect(() => injertarRafaga(tras('http'), { ancla: { nodo: 'Puerta del turno', destino: '¿Atención normal?' }, campos: CAMPOS }), 'ancla http').toThrow(/lo impide «Puerta del turno»/);
  });

  it('LISTA BLANCA: sin `fuente` NINGÚN Code, Set, HTTP o Merge entre el normalizador y el ancla se tolera, aunque copie la entrada o mencione el id', () => {
    for (const codigo of ["return $input.all().map((i) => ({ json: { ...i.json, ruta: 'sigue' } }));", "return $input.all().map((i) => ({ json: Object.assign({}, i.json, { ruta: 'sigue' }) }));", "return [{ json: { mensajeId: $('Normalizar entrada').first().json.mensajeId } }];", 'return $input.all();']) {
      expect(() => injertarRafaga(tras('code', codigo), { ancla: ANCLA }), codigo).toThrow(/lo impide «Puerta del turno».*apagada en silencio/);
      expect(() => injertarRafaga(tras('code', codigo), { ancla: ANCLA, fuente: 'Normalizar entrada' }), `${codigo} con fuente`).not.toThrow();
    }
    for (const tipo of ['n8n-nodes-base.set', 'n8n-nodes-base.merge', 'n8n-nodes-base.httpRequest', 'n8n-nodes-base.code']) {
      const f = tras('code');
      nodo(f, 'Puerta del turno').type = tipo;
      expect(() => injertarRafaga(f, { ancla: ANCLA }), tipo).toThrow(/apagada en silencio/);
    }
  });

  it('se arma sin `fuente` solo si TODO camino del ancla al normalizador pasa por IF, Switch, Filter, Wait o NoOp', () => {
    for (const tipo of ['n8n-nodes-base.if', 'n8n-nodes-base.switch', 'n8n-nodes-base.filter', 'n8n-nodes-base.wait', 'n8n-nodes-base.noOp']) {
      const f = tras('code');
      nodo(f, 'Puerta del turno').type = tipo;
      expect(() => injertarRafaga(f, { ancla: ANCLA }), tipo).not.toThrow();
    }
    expect(() => injertarRafaga(sintetico(), { ancla: ANCLA })).not.toThrow();
    // Un solo camino con un nodo no transparente basta para negarse (la otra rama sí llega limpia).
    const f = sintetico();
    f.nodes.push({ ...un('Desvio', [600, 500]), type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: 'return [];' } });
    f.connections['Normalizar entrada'].main[0].push({ node: 'Desvio', type: 'main', index: 0 });
    f.connections.Desvio = enl('¿Atención normal?');
    expect(() => injertarRafaga(f, { ancla: ANCLA })).toThrow(/lo impide «Desvio»/);
  });

  it('con fuente, se arma, y el IF, la consulta y el Code leen de ESA fuente; la guardia lo acepta (la infiere del propio nodo)', () => {
    const f = injertarRafaga(tras('code'), { ancla: ANCLA, fuente: 'Normalizar entrada', campos: CAMPOS });
    expect(nodo(f, NODO_RAFAGA_SI).parameters.conditions.conditions[0].leftValue).toContain("const n = $('Normalizar entrada').first().json;");
    const http = nodo(f, NODO_RAFAGA_CONSULTAR).parameters;
    expect(http.jsonBody).toContain("$('Normalizar entrada').first().json.from");
    expect(http.jsonBody).toContain("$('Normalizar entrada').first().json.mensajeId");
    expect(http.headerParameters.parameters[0].value).toContain("$('Normalizar entrada').first().json.phoneNumberId");
    expect(nodo(f, NODO_RAFAGA_AGRUPAR).parameters.jsCode).toContain("const FUENTE = 'Normalizar entrada';");
    expect(hallazgosDeLaRafaga(f, { campos: CAMPOS })).toEqual([]);
    expect(JSON.stringify(injertarRafaga(quitarRafaga(structuredClone(f)), { ancla: ANCLA, fuente: 'Normalizar entrada', campos: CAMPOS }))).toBe(JSON.stringify(f));
  });

  it('sin `fuente` el comportamiento sigue igual: lee `$json` y `FUENTE` queda vacía', () => {
    const f = armado();
    expect(nodo(f, NODO_RAFAGA_SI).parameters.conditions.conditions[0].leftValue).toContain('const n = $json;');
    expect(nodo(f, NODO_RAFAGA_AGRUPAR).parameters.jsCode).toContain("const FUENTE = '';");
  });

  it('NEGATIVAS: una fuente que no existe, que no es ascendiente del ancla o con nombre peligroso', () => {
    expect(() => injertarRafaga(tras(), { ancla: ANCLA, fuente: 'No existe' })).toThrow(/no tiene «No existe»/);
    expect(() => injertarRafaga(tras(), { ancla: ANCLA, fuente: 'Agente' })).toThrow(/«Agente» tiene que ser ascendiente/);
    expect(() => injertarRafaga(tras(), { ancla: ANCLA, fuente: 'Traer configuración' })).toThrow(/«Traer configuración» tiene que ser ascendiente/);
    for (const mala of ["x'); process", 'a\\b', 'a\nb']) expect(() => injertarRafaga(tras(), { ancla: ANCLA, fuente: mala })).toThrow();
    // armado con una fuente y luego movida a un nodo que no es ascendiente: la guardia lo ve
    const f = injertarRafaga(tras(), { ancla: ANCLA, fuente: 'Normalizar entrada', campos: CAMPOS });
    f.connections['Normalizar entrada'] = enl('Reportar mensaje (entrante)');
    expect(hallazgosDeLaRafaga(f, { campos: CAMPOS }).join('|')).toMatch(/tiene que ser ascendiente/);
  });

  it('la puerta puede leer OTRO nodo: se valida que exista y sea ascendiente del ancla', () => {
    const puerta = "$('Puerta del turno').first().json.ruta === 'sigue'";
    const f = injertarRafaga(tras(), { ancla: ANCLA, fuente: 'Normalizar entrada', campos: CAMPOS, puerta });
    expect(hallazgosDeLaRafaga(f, { campos: CAMPOS })).toEqual([]);
    expect(() => injertarRafaga(tras(), { ancla: ANCLA, fuente: 'Normalizar entrada', puerta: "$('Agente').first().json.ruta === 'sigue'" })).toThrow(/«Agente» tiene que ser ascendiente/);
    expect(() => injertarRafaga(tras(), { ancla: ANCLA, fuente: 'Normalizar entrada', puerta: "$('No existe').first().json.ok" })).toThrow(/la puerta lee «No existe»/);
    const roto = injertarRafaga(tras(), { ancla: ANCLA, fuente: 'Normalizar entrada', campos: CAMPOS, puerta });
    roto.nodes = roto.nodes.filter((n: Nodo) => n.name !== 'Puerta del turno');
    expect(hallazgosDeLaRafaga(roto, { campos: CAMPOS }).join('|')).toMatch(/la puerta lee «Puerta del turno»/);
  });

  describe('ejecutados con ítems reales', () => {
    const puerta = "$('Puerta del turno').first().json.ruta === 'sigue'";
    const f = injertarRafaga(tras(), { ancla: ANCLA, fuente: 'Normalizar entrada', campos: CAMPOS, puerta });
    const ancla = { ruta: 'sigue', texto: 'hola', responder: false, transferir: false, motivo: '', from: '59170000000' }; // lo que emite «Puerta del turno»: sin tipo, sin mensajeId, sin phoneNumberId
    const mensaje = { tipo: 'text', mensajeId: 'wamid.X', from: '59170000000', phoneNumberId: '123456789', texto: 'hola' };
    const evaluar = (ctx: Record<string, unknown>, item: unknown = ancla, corrio = true): unknown => {
      const cuerpo = nodo(f, NODO_RAFAGA_SI).parameters.conditions.conditions[0].leftValue.replace(/^=\{\{/, '').replace(/\}\}$/, '').trim();
      const $ = (n: string) => ({ first: () => { if (!(n in ctx)) throw new Error(`sin ${n}`); return { json: ctx[n] }; }, isExecuted: n === ANCLA_REPORTE ? corrio : true });
      return vm.compileFunction(`return (${cuerpo});`, ['$', '$json', 'String'])($, item, String);
    };
    const ctx = { 'Config base': {}, 'Config del negocio': {}, 'Normalizar entrada': mensaje, 'Puerta del turno': ancla };

    it('el ítem del ancla NO trae los campos y aun así la ráfaga espera (la fuente sí los trae)', () => {
      expect(evaluar(ctx)).toBe(true);
    });
    it('sin la fuente, esos mismos ítems habrían dado siempre «no» (el caso que se evita)', () => {
      const sin = injertarRafaga(sintetico(), { ancla: ANCLA });
      const cuerpo = nodo(sin, NODO_RAFAGA_SI).parameters.conditions.conditions[0].leftValue.replace(/^=\{\{/, '').replace(/\}\}$/, '').trim();
      const $ = (n: string) => ({ first: () => ({ json: (ctx as Record<string, unknown>)[n] }), isExecuted: true });
      expect(vm.compileFunction(`return (${cuerpo});`, ['$', '$json', 'String'])($, ancla, String)).toBe(false);
    });
    it('NEGADO: la puerta (otro nodo) dice que no sigue, o el mensaje de la fuente no es texto', () => {
      expect(evaluar({ ...ctx, 'Puerta del turno': { ...ancla, ruta: 'transferir' } })).toBe(false);
      expect(evaluar({ ...ctx, 'Normalizar entrada': { ...mensaje, tipo: 'audio' } })).toBe(false);
      expect(evaluar({ ...ctx, 'Normalizar entrada': { ...mensaje, mensajeId: '' } })).toBe(false);
      expect(evaluar(ctx, ancla, false)).toBe(false);
      const { 'Normalizar entrada': _quitado, ...sinFuente } = ctx;
      expect(evaluar(sinFuente)).toBe(false);
    });
    it('«Agrupar ráfaga» decide con id y texto de la fuente y emite el ítem DEL ANCLA más textoDelTurno', () => {
      const codigo = nodo(f, NODO_RAFAGA_AGRUPAR).parameters.jsCode;
      const frag = (idMeta: string, texto: string, ms: number) => ({ idMeta, tipo: 'text', texto, ms });
      const salida = correr(codigo, [{ rafaga: { v: 1, fragmentos: [frag('wamid.A', 'buenas', 1000), frag('wamid.X', 'hola', 1800)] } }], {
        '¿Esperar ráfaga?': ancla, 'Normalizar entrada': { ...mensaje, texto: 'hola crudo' }, 'Config base': {},
      }).map((i) => i.json);
      expect(salida).toHaveLength(1);
      expect(salida[0]).toMatchObject({ ...ancla, rafaga: { accion: 'agrupado', ids: ['wamid.A', 'wamid.X'] }, textoDelTurno: 'buenas\nhola crudo' });
      // El anterior calla y un aislado responde solo, sin textoDelTurno.
      expect(correr(codigo, [{ rafaga: { v: 1, fragmentos: [frag('wamid.X', 'hola', 1000), frag('wamid.Z', 'otro', 1800)] } }], { '¿Esperar ráfaga?': ancla, 'Normalizar entrada': mensaje, 'Config base': {} })).toEqual([]);
      const solo = correr(codigo, [{ error: { message: 'x' } }], { '¿Esperar ráfaga?': ancla, 'Normalizar entrada': mensaje, 'Config base': {} }).map((i) => i.json);
      expect(solo[0]).toMatchObject({ ...ancla, rafaga: { accion: 'solo', ids: ['wamid.X'] } });
      expect('textoDelTurno' in solo[0]).toBe(false);
    });
  });
});

describe('rafaga: referencias a nodos que n8n puede precargar (`problemasDeReferencias`)', () => {
  const CAMPOS = { texto: 'texto' };
  const conFuente = (): Flujo => {
    const f = sintetico();
    f.nodes.push({ ...un('Puerta del turno', [720, 300]), type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "return $input.all().map(() => ({ json: { ruta: 'sigue' } }));" } });
    nodo(f, '¿Atención normal?').type = 'n8n-nodes-base.if';
    f.connections['Config del negocio'] = enl('Puerta del turno');
    f.connections['Puerta del turno'] = enl('¿Atención normal?');
    return injertarRafaga(f, { ancla: ANCLA, fuente: 'Normalizar entrada', campos: CAMPOS });
  };

  it('sin fuente y con fuente: ninguna referencia dinámica ni a un nodo que no es antecesor', async () => {
    const { problemasDeReferencias } = await import('../../../Flujos/src/core/sin-agente/referencias.mjs');
    // `¿Esperar ráfaga?` pregunta `$('Reportar mensaje (entrante)').isExecuted`: en el lienzo el reporte es una rama hermana (corre antes, no es antecesor), y es lo
    // que la pieza exige a propósito; el verificador lo objeta en ese fixture, y es lo ÚNICO que se tolera aquí.
    const sinElReporte = (p: string[]) => p.filter((x) => !x.includes('«Reportar mensaje (entrante)», que existe pero NO es su antecesor'));
    expect(sinElReporte(problemasDeReferencias(armado()))).toEqual([]);
    expect(sinElReporte(problemasDeReferencias(conFuente()))).toEqual([]);
  });

  it('con fuente, el Code escribe `$(\'<fuente>\').first().json` LITERAL y sin fuente `mensaje = entrada`', () => {
    const codigo = nodo(conFuente(), NODO_RAFAGA_AGRUPAR).parameters.jsCode;
    expect(codigo).toContain("const mensaje = $('Normalizar entrada').first().json;");
    expect(codigo).not.toContain('$(FUENTE)');
    expect(nodo(armado(), NODO_RAFAGA_AGRUPAR).parameters.jsCode).toContain('const mensaje = entrada;');
  });

  it('NEGATIVA: la versión vieja (`$(FUENTE)` dinámico junto a literales) la rechaza el verificador', async () => {
    const { problemasDeReferencias } = await import('../../../Flujos/src/core/sin-agente/referencias.mjs');
    const f = conFuente();
    const code = nodo(f, NODO_RAFAGA_AGRUPAR);
    code.parameters.jsCode = code.parameters.jsCode.replace("const mensaje = $('Normalizar entrada').first().json;", 'const mensaje = FUENTE !== \'\' ? $(FUENTE).first().json : entrada;');
    expect(problemasDeReferencias(f).join('|')).toMatch(/Agrupar ráfaga».*mezcla referencias literales con referencias dinámicas/);
    expect(hallazgosDeLaRafaga(f, { campos: CAMPOS }).join('|')).toMatch(/Agrupar ráfaga».*no es el nodo común/); // y la guardia de la pieza también lo ve
  });
});

describe('rafaga: la guardia contra el apagado silencioso sobre los JSON REALES (lista blanca)', () => {
  // Se parte del flujo SIN la pieza: los flujos que ya la adoptaron (Bellido, 25/11/2026) la traen puesta y `quitarRafaga` es idempotente.
  const real = (ruta: string): Flujo => quitarRafaga(JSON.parse(readFileSync(join(RAIZ_FLUJOS, ruta), 'utf8')));
  const REALES: [string, { nodo: string; salida: number; destino: string }][] = [
    ['clientes/walisuma/walisuma.json', { nodo: '¿Bajar medio?', salida: 1, destino: 'Decidir turno' }], // tras «Puerta del turno»
    ['clientes/agenda-minima/agenda-minima.v0.json', { nodo: '¿Atención normal?', salida: 0, destino: '¿Bajar medio?' }], // Bellido
  ];

  it.each(REALES)('%s: sin `fuente` se NIEGA a armar (el item del ancla no sale del normalizador por nodos transparentes)', (ruta, ancla) => {
    expect(() => injertarRafaga(real(ruta), { ancla })).toThrow(/apagada en silencio/);
  });
  it.each(REALES)('%s: con `fuente: \'Normalizar entrada\'` arma y la guardia queda en verde', (ruta, ancla) => {
    const f = injertarRafaga(real(ruta), { ancla, fuente: 'Normalizar entrada' });
    expect(hallazgosDeLaRafaga(f)).toEqual([]);
    expect(hallazgosDeLaRafaga(f, { exigir: true })).toEqual([]);
    expect(nodo(f, NODO_RAFAGA_SI).parameters.conditions.conditions[0].leftValue).toContain("const n = $('Normalizar entrada').first().json;");
  });
  it.each([['clientes/demo-a/demo-a-agendamiento.json'], ['demo-b-venta-cobro.json']])('%s: el item del ancla SÍ sale del normalizador por IF, así que arma sin `fuente`', (ruta) => {
    const f = injertarRafaga(real(ruta), { ancla: { nodo: '¿Atención normal?', salida: 0, destino: '¿Es un comprobante?' } });
    expect(hallazgosDeLaRafaga(f)).toEqual([]);
  });
  it('sin fuente, la guardia sobre un flujo ya armado también lo dice (`hallazgosDeLaRafaga`)', () => {
    const [ruta, ancla] = REALES[0];
    const f = injertarRafaga(real(ruta), { ancla, fuente: 'Normalizar entrada' });
    nodo(f, NODO_RAFAGA_SI).parameters.conditions.conditions[0].leftValue = nodo(f, NODO_RAFAGA_SI).parameters.conditions.conditions[0].leftValue.replace("$('Normalizar entrada').first().json", '$json');
    nodo(f, NODO_RAFAGA_CONSULTAR).parameters.jsonBody = nodo(f, NODO_RAFAGA_CONSULTAR).parameters.jsonBody.split("$('Normalizar entrada').first().json").join("$('¿Esperar ráfaga?').first().json");
    nodo(f, NODO_RAFAGA_CONSULTAR).parameters.headerParameters.parameters[0].value = nodo(f, NODO_RAFAGA_CONSULTAR).parameters.headerParameters.parameters[0].value.split("$('Normalizar entrada').first().json").join("$('¿Esperar ráfaga?').first().json");
    nodo(f, NODO_RAFAGA_AGRUPAR).parameters.jsCode = codigoDeLaRafaga('Config base', undefined, '');
    const h = hallazgosDeLaRafaga(f);
    expect(h.join('|')).toMatch(/apagada en silencio/);
  });
});
