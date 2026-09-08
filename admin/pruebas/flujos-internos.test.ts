/**
 * LOS DOS FLUJOS INTERNOS DE NOVUCHAT, probados sobre el código que corre.
 *
 * Como en `estado-comercio.test.ts`, la lógica de los nodos Code **se extrae
 * del JSON y se ejecuta**, no se copia: si alguien edita el nodo en n8n y
 * exporta, la prueba corre el código nuevo.
 *
 * Lo que importa acá:
 *  - `Despachar respuesta` no inventa nada ante un error del servidor: sin un
 *    200 con `respuesta`, sale el texto de error temporal y NADA de menú ni QR.
 *    Hay dinero de por medio; ante la duda no se cobra.
 *  - `Preparar envíos` no manda ninguna plantilla si el panel no contestó 200.
 *  - Los dos JSON pasan el saneo: traen marcadores `REEMPLAZAR_` y ningún
 *    teléfono real.
 *  - Todo nodo conectado existe (el defecto del nodo huérfano del 07/09).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));

interface Nodo { name: string; type: string; parameters: Record<string, unknown>; credentials?: Record<string, unknown> }
interface Flujo { nodes: Nodo[]; connections: Record<string, { main?: { node: string }[][] }> }
const leer = (archivo: string): Flujo =>
  JSON.parse(readFileSync(join(aqui, '../../Flujos/', archivo), 'utf8')) as Flujo;
const crudo = (archivo: string) => readFileSync(join(aqui, '../../Flujos/', archivo), 'utf8');

const COBRO = 'novuchat-cobro-prepago.json';
const RECORDATORIOS = 'novuchat-recordatorios-prepago.json';

function codigoDe(archivo: string, nodo: string): string {
  const c = leer(archivo).nodes.find((n) => n.name === nodo)?.parameters['jsCode'];
  if (typeof c !== 'string') throw new Error(`sin nodo ${nodo} en ${archivo}`);
  return c;
}

/** Corre un nodo Code con `$input` y `$()` simulados. */
function correr(codigo: string, entrada: unknown[], contexto: Record<string, unknown[]>) {
  const $input = { all: () => entrada.map((json) => ({ json })), first: () => ({ json: entrada[0] }) };
  const $ = (nombre: string) => ({
    all: () => (contexto[nombre] ?? []).map((json) => ({ json })),
    first: () => ({ json: (contexto[nombre] ?? [])[0] }),
  });
  // Se ejecuta el flujo VERSIONADO dentro de una prueba, como en las otras
  // suites de flujos. La marca va en la línea de arriba del código.
  // nosemgrep: devsecops.js-eval-prohibido
  const fn = new Function('$input', '$', codigo) as (i: unknown, c: unknown) => { json: Record<string, unknown> }[];
  return fn($input, $).map((x) => x.json);
}

describe.each([COBRO, RECORDATORIOS])('%s · forma', (archivo) => {
  it('todo nodo conectado existe', () => {
    const f = leer(archivo);
    const nombres = new Set(f.nodes.map((n) => n.name));
    for (const [origen, salidas] of Object.entries(f.connections)) {
      expect(nombres.has(origen), origen).toBe(true);
      for (const rama of salidas.main ?? []) for (const d of rama) expect(nombres.has(d.node), d.node).toBe(true);
    }
  });

  it('está saneado: marcadores REEMPLAZAR_ y ningún teléfono real', () => {
    const texto = crudo(archivo);
    expect(texto).toMatch(/REEMPLAZAR_PHONE_NUMBER_ID_NOVUCHAT/);
    // Un teléfono boliviano real tiene 11 dígitos y empieza por 591.
    expect(texto).not.toMatch(/591[0-9]{8}/);
  });

  it('los nodos HTTP al panel miran el código: fullResponse y neverError', () => {
    const f = leer(archivo);
    const alPanel = f.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest'
      && String(n.parameters['url']).includes('cloudfunctions') === false
      && String(n.parameters['url']).includes('url'));
    for (const n of alPanel) {
      const r = (n.parameters['options'] as { response?: { response?: Record<string, unknown> } })?.response?.response;
      if (n.name === 'Marcar como enviado') continue;   // escribe; su fallo debe verse en rojo
      expect(r?.['fullResponse'], n.name).toBe(true);
      expect(r?.['neverError'], n.name).toBe(true);
    }
  });
});

describe('Cobro · Normalizar entrada', () => {
  const codigo = () => codigoDe(COBRO, 'Normalizar entrada');
  const cfg = { phoneNumberId: 'REEMPLAZAR', urlBaseQr: 'https://x/?f=' };

  it('texto, fila tocada, imagen y documento', () => {
    const base = { ...cfg, contacts: [{ profile: { name: 'Ana' } }] };
    const [texto] = correr(codigo(), [{ ...base, messages: [{ from: '59170000001', id: 'm1', type: 'text', text: { body: 'pagar' } }] }], {});
    expect(texto).toMatchObject({ from: '59170000001', tipo: 'text', texto: 'pagar', seleccionId: '', nombrePerfil: 'Ana', mensajeId: 'm1' });

    const [fila] = correr(codigo(), [{ ...base, messages: [{ from: '59170000001', type: 'interactive', interactive: { list_reply: { id: 'bolsa', title: 'Bolsa' } } }] }], {});
    expect(fila).toMatchObject({ tipo: 'interactive', seleccionId: 'bolsa', texto: 'Bolsa' });

    const [img] = correr(codigo(), [{ ...base, messages: [{ from: '59170000001', type: 'image', image: { id: 'media-9' } }] }], {});
    expect(img).toMatchObject({ tipo: 'image', mediaId: 'media-9' });

    const [pdf] = correr(codigo(), [{ ...base, messages: [{ from: '59170000001', type: 'document', document: { id: 'media-7' } }] }], {});
    expect(pdf).toMatchObject({ tipo: 'document', mediaId: 'media-7' });
  });

  it('arrastra la configuración y descarta el payload de Meta', () => {
    const [salida] = correr(codigo(), [{ ...cfg, messages: [{ from: '5917', type: 'text', text: { body: 'x' } }], statuses: [] }], {});
    expect(salida?.['urlBaseQr']).toBe('https://x/?f=');
    expect(salida?.['messages']).toBeUndefined();
  });
});

describe('Cobro · Despachar respuesta', () => {
  const codigo = () => codigoDe(COBRO, 'Despachar respuesta');
  const ent = { from: '59170000001', nombrePerfil: 'Ana', phoneNumberId: 'P', waGraphVersion: 'v26.0',
    numeroAdminNovuChat: 'ADMIN', urlBaseQr: 'https://consola/api/qr?f=', mensajeErrorTemporal: 'Tuve un problema.' };
  const ficha = 'a'.repeat(32);

  it('con un 200 completo despacha texto, menú, QR y aviso', () => {
    const cuerpo = { tenantId: 'salon-rosa', respuesta: 'Hola', lista: { secciones: [{ titulo: 'x', filas: [] }] },
      enviarQr: true, fichaQr: ficha, epigrafeQr: 'QR', avisoAdmin: 'aviso', avisoMediaId: 'media-1' };
    const [s] = correr(codigo(), [{ statusCode: 200, body: cuerpo }], { 'Normalizar entrada': [ent] });
    expect(s).toMatchObject({ respuesta: 'Hola', enviarLista: true, enviarQr: true,
      qrUrl: `https://consola/api/qr?f=${ficha}`, epigrafeQr: 'QR', avisoAdmin: 'aviso', avisoMediaId: 'media-1',
      from: '59170000001', numeroAdminNovuChat: 'ADMIN', tenantId: 'salon-rosa' });
  });

  it('ante CUALQUIER error del servidor: texto de error temporal, sin menú, sin QR, sin aviso', () => {
    for (const roto of [{ statusCode: 500, body: {} }, { statusCode: 401, body: 'no autorizado' }, { error: 'timeout' }, {}]) {
      const [s] = correr(codigo(), [roto], { 'Normalizar entrada': [ent] });
      expect(s?.['respuesta']).toBe('Tuve un problema.');
      expect(s?.['enviarLista']).toBe(false);
      expect(s?.['enviarQr']).toBe(false);
      expect(s?.['avisoAdmin']).toBe('');
      expect(s?.['qrUrl']).toBe('');
    }
  });

  it('un 200 sin respuesta también es un error', () => {
    const [s] = correr(codigo(), [{ statusCode: 200, body: { respuesta: '' } }], { 'Normalizar entrada': [ent] });
    expect(s?.['respuesta']).toBe('Tuve un problema.');
  });

  it('no manda el QR si la ficha no tiene la forma de una ficha', () => {
    const [s] = correr(codigo(), [{ statusCode: 200, body: { respuesta: 'ok', enviarQr: true, fichaQr: '../otra' } }],
      { 'Normalizar entrada': [ent] });
    expect(s?.['enviarQr']).toBe(false);
    expect(s?.['qrUrl']).toBe('');
  });

  it('empareja por índice cuando llegan dos mensajes a la vez', () => {
    const otra = { ...ent, from: '59170000002' };
    const salidas = correr(codigo(), [
      { statusCode: 200, body: { respuesta: 'A' } }, { statusCode: 200, body: { respuesta: 'B' } },
    ], { 'Normalizar entrada': [ent, otra] });
    expect(salidas.map((s) => [s['from'], s['respuesta']])).toEqual([['59170000001', 'A'], ['59170000002', 'B']]);
  });
});

describe('Recordatorios · Preparar envíos', () => {
  const codigo = () => codigoDe(RECORDATORIOS, 'Preparar envíos');
  const cfg = { phoneNumberId: 'P', waGraphVersion: 'v26.0', idiomaPlantilla: 'es', urlMarcar: 'https://m' };

  it('un item por recordatorio, con la configuración del número de NovuChat', () => {
    const cuerpo = { periodo: '2026-09', recordatorios: [
      { tenantId: 'salon-rosa', negocio: 'Salón Rosa', telefono: '59170000001', clave: 'renovacion_2026-10_1',
        tipo: 'renovacion', plantilla: 'nc_renovacion_pendiente', parametros: ['Salón Rosa', 'Plan Base', '30/09/2026', 250] },
    ] };
    const salidas = correr(codigo(), [{ statusCode: 200, body: cuerpo }], { 'Config base del recordatorio': [cfg] });
    expect(salidas).toHaveLength(1);
    expect(salidas[0]).toMatchObject({ tenantId: 'salon-rosa', telefono: '59170000001', plantilla: 'nc_renovacion_pendiente',
      parametros: ['Salón Rosa', 'Plan Base', '30/09/2026', '250'], phoneNumberId: 'P', urlMarcar: 'https://m' });
  });

  it('sin un 200 no se manda NADA: las plantillas las cobra Meta', () => {
    for (const roto of [{ statusCode: 500, body: {} }, { error: 'timeout' }, {}, { statusCode: 200, body: {} }]) {
      expect(correr(codigo(), [roto], { 'Config base del recordatorio': [cfg] })).toEqual([]);
    }
  });

  it('descarta un recordatorio sin teléfono válido o sin plantilla', () => {
    const cuerpo = { recordatorios: [
      { tenantId: 't', telefono: 'sin', clave: 'a', plantilla: 'p', parametros: [] },
      { tenantId: 't', telefono: '59170000001', clave: 'a', plantilla: '', parametros: [] },
    ] };
    expect(correr(codigo(), [{ statusCode: 200, body: cuerpo }], { 'Config base del recordatorio': [cfg] })).toEqual([]);
  });
});
