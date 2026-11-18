/**
 * GUARDADO DE LA IMAGEN QUE EL ASISTENTE ENVÍA (Core, plan «ver en la consola las imágenes enviadas por el asistente», 16/11/2026, bloque 2a). Sin emulador.
 *
 * Lo que se demuestra, escrito NEGANDO:
 *   - el código del nodo «Preparar guardado (saliente)» omite todo lo que no es una imagen aceptada por Meta (texto, interactivo con imagen de encabezado,
 *     envío fallido, sin wamid, destinatario distinto, enlace no https o a un anfitrión interno, vía que el flujo no tiene);
 *   - la rama completa, en un flujo mínimo corrido en el arnés de n8n: baja la imagen por la vía correcta, llama a `guardarMedio` con el wamid del saliente y
 *     NO altera lo que recibe el cliente (mismos mensajes, mismo orden), no agrega ningún mensaje de WhatsApp y nunca hace fallar el turno;
 *   - cada flujo versionado que envía una imagen la lleva completa (nodos que agrega: 3, 4 o 6), colgada del reporte saliente, debajo de todo y con las
 *     credenciales correctas; Evy y Emma (bloque 2b) y los que mandan la imagen de encabezado de un interactivo (chat de NovuChat, captación) NO la llevan;
 *   - cada regla de la guardia tiene la mutación que la rompe.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  FUENTE_PREPARAR_SALIENTE, aristasDelGuardadoSaliente, cabeceraDeFuentesSaliente, fuentesDeLaCadenaComun, hallazgosDelGuardadoSaliente,
  injertarGuardadoSaliente, nodosQueAgrega, validarVias, type ViaDelGuardadoSaliente,
} from '../../../../Flujos/src/core/sin-agente/guardado-saliente.mjs';
import { NODOS_DEL_GUARDADO_SALIENTE, manejaMedios } from '../../../../Flujos/src/core/sin-agente/guardado.mjs';
import { doblesDelGuardado } from '../../lib/doble-guardado';
import { GLOBALES_FUERA_DEL_SANDBOX, type J } from '../../lib/flujo';
import { crearMundo, type Doble } from '../../lib/n8n-de-mentira';

const aqui = dirname(fileURLToPath(import.meta.url));
const FLUJOS = join(aqui, '../../../../Flujos');
const leer = (archivo: string): any => JSON.parse(readFileSync(join(FLUJOS, archivo), 'utf8'));
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------- 1. el código de «Preparar guardado (saliente)»
const WAMID = 'wamid.HBgLNTkxNzAwMDAwMDAVAgARGBI5';
const TEL = '59170000000';
const IMG_ID = '1234567890123456';
const ENLACE = 'https://us-east1-novuchat-demo.cloudfunctions.net/imagenDeCobro?f=abc123';

interface Fuente { meta: unknown; payload: unknown; tipoReporte: unknown; telefono: unknown; version?: unknown }
/** Corre el código del nodo (cabecera de fuentes + módulo común) con una fuente por ítem, igual que n8n: `$input.all()` y `$('Nodo').itemMatching(i)`. */
function prepararCon(vias: ViaDelGuardadoSaliente[], fuentes: Fuente[] | (() => never)): J[] {
  const cab = [
    `const GS_VIAS = ${JSON.stringify(vias)};`,
    'const GS_FUENTE = (i) => $("fuente").itemMatching(i).json;',
  ].join('\n');
  const codigo = `${cab}\n${FUENTE_PREPARAR_SALIENTE}\n`;
  const lista = typeof fuentes === 'function' ? [] : fuentes;
  const propios = ['$input', '$'];
  const vacios = GLOBALES_FUERA_DEL_SANDBOX.filter((g) => !propios.includes(g));
  const fn = vm.compileFunction(codigo, [...propios, ...vacios]) as (...a: unknown[]) => { json: J; pairedItem?: { item: number } }[];
  const entrada = { all: () => (typeof fuentes === 'function' ? [{ json: {} }] : lista.map(() => ({ json: {} }))) };
  const $ = () => ({ itemMatching: (i: number) => { if (typeof fuentes === 'function') return fuentes(); return { json: lista[i] }; } });
  return fn(entrada, $, ...vacios.map(() => undefined)).map((x) => ({ ...x.json, _par: x.pairedItem?.item as unknown as J }));
}
const imagenPorId = (extra: Partial<Fuente> = {}): Fuente => ({
  meta: { messages: [{ id: WAMID }] }, tipoReporte: 'image', telefono: TEL,
  payload: { messaging_product: 'whatsapp', to: TEL, type: 'image', image: { id: IMG_ID, caption: 'Escanea el QR' } }, ...extra,
});
const imagenPorEnlace = (enlace = ENLACE, extra: Partial<Fuente> = {}): Fuente => ({
  meta: { messages: [{ id: WAMID }] }, tipoReporte: 'image', telefono: TEL,
  payload: { messaging_product: 'whatsapp', to: TEL, type: 'image', image: { link: enlace, caption: 'Escanea el QR' } }, ...extra,
});

describe('Preparar guardado (saliente): solo una imagen que Meta aceptó, por la vía que el flujo tiene', () => {
  it('una imagen por media id sale con su wamid, su teléfono y la vía media', () => {
    const r = prepararCon(['media'], [imagenPorId()]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ telefono: TEL, idMeta: WAMID, tipo: 'image', via: 'media', mediaId: IMG_ID, enlace: '', waGraphVersion: 'v26.0', _par: 0 });
  });
  it('una imagen por enlace https sale con la vía enlace y el mismo enlace', () => {
    const r = prepararCon(['enlace'], [imagenPorEnlace()]);
    expect(r[0]).toMatchObject({ via: 'enlace', enlace: ENLACE, mediaId: '', idMeta: WAMID });
  });
  it('con varios ítems, solo el de la imagen pasa y conserva su índice (el pareo de n8n)', () => {
    const texto: Fuente = { meta: { messages: [{ id: 'wamid.T' }] }, tipoReporte: 'text', telefono: TEL, payload: { type: 'text', to: TEL, text: { body: 'hola' } } };
    const r = prepararCon(['media'], [texto, imagenPorId(), texto]);
    expect(r).toHaveLength(1);
    expect(r[0]!['_par']).toBe(1);
  });
  it('la versión de Graph de la fuente viaja si tiene la forma vNN.N; si no, v26.0', () => {
    expect(prepararCon(['media'], [imagenPorId({ version: 'v25.0' })])[0]!['waGraphVersion']).toBe('v25.0');
    expect(prepararCon(['media'], [imagenPorId({ version: 'v25.0/../x' })])[0]!['waGraphVersion']).toBe('v26.0');
  });

  describe('NEGANDO: lo que NO se guarda', () => {
    const omite = (f: Fuente, vias: ViaDelGuardadoSaliente[] = ['media', 'enlace']) => expect(prepararCon(vias, [f])).toEqual([]);
    it('un texto', () => omite({ meta: { messages: [{ id: WAMID }] }, tipoReporte: 'text', telefono: TEL, payload: { type: 'text', to: TEL, text: { body: 'Hola' } } }));
    it('un texto aunque se reporte mal como image (el payload manda)', () => omite({ meta: { messages: [{ id: WAMID }] }, tipoReporte: 'image', telefono: TEL, payload: { type: 'text', to: TEL, text: { body: 'Hola' } } }));
    it('un botón, una lista o un interactivo con la imagen de encabezado (el servidor solo admite tipo image)', () => {
      omite({ meta: { messages: [{ id: WAMID }] }, tipoReporte: 'interactive', telefono: TEL, payload: { type: 'interactive', to: TEL, interactive: { header: { type: 'image', image: { link: ENLACE } } } } });
      omite({ meta: { messages: [{ id: WAMID }] }, tipoReporte: 'image', telefono: TEL, payload: { type: 'interactive', to: TEL, interactive: { header: { type: 'image', image: { link: ENLACE } } } } });
    });
    it('un documento y un audio', () => {
      omite({ meta: { messages: [{ id: WAMID }] }, tipoReporte: 'document', telefono: TEL, payload: { type: 'document', to: TEL, document: { id: IMG_ID } } });
      omite({ meta: { messages: [{ id: WAMID }] }, tipoReporte: 'audio', telefono: TEL, payload: { type: 'audio', to: TEL, audio: { id: IMG_ID } } });
    });
    it('un envío que falló: con error de Meta, sin respuesta o sin wamid', () => {
      omite(imagenPorId({ meta: { error: { message: '(#131047) Re-engagement message' } } }));
      omite(imagenPorId({ meta: {} }));
      omite(imagenPorId({ meta: { messages: [] } }));
      omite(imagenPorId({ meta: { messages: [{ id: '' }] } }));
      omite(imagenPorId({ meta: { messages: [{ id: 'con espacio' }] } }));
      omite(imagenPorId({ meta: { error: 'x', messages: [{ id: WAMID }] } }));
    });
    it('un teléfono inválido o un destinatario distinto del que se reporta', () => {
      omite(imagenPorId({ telefono: '123' }));
      omite(imagenPorId({ telefono: 'recepcion' }));
      omite(imagenPorId({ payload: { type: 'image', to: '59170000009', image: { id: IMG_ID } } }));
    });
    it('una vía que el flujo no tiene: el enlace en un flujo de media id, y al revés', () => {
      expect(prepararCon(['media'], [imagenPorEnlace()])).toEqual([]);
      expect(prepararCon(['enlace'], [imagenPorId()])).toEqual([]);
    });
    it('un id de medio inválido, o con id y enlace a la vez (no se sabe qué se envió)', () => {
      omite(imagenPorId({ payload: { type: 'image', to: TEL, image: { id: '../x?y=1' } } }));
      omite(imagenPorId({ payload: { type: 'image', to: TEL, image: { id: IMG_ID, link: ENLACE } } }));
      omite(imagenPorId({ payload: { type: 'image', to: TEL, image: {} } }));
      omite(imagenPorId({ payload: { type: 'image', to: TEL } }));
    });
    it('un enlace que no es https de un anfitrión con nombre', () => {
      for (const malo of [
        'http://us-east1-novuchat-demo.cloudfunctions.net/imagenDeCobro?f=a', 'https://localhost/imagen.png', 'https://127.0.0.1/imagen.png', 'https://10.0.0.5/x.png',
        'https://usuario:clave@ejemplo.com/x.png', 'https://ejemplo.com/con espacio.png', 'ftp://ejemplo.com/x.png', 'https://sinpunto/x.png',
        `https://ejemplo.com/${'a'.repeat(2100)}`, '', 'javascript:alert(1)',
      ]) expect(prepararCon(['enlace'], [imagenPorEnlace(malo)]), malo.slice(0, 40)).toEqual([]);
    });
    it('una fuente que lanza (sin ítem emparejado) no rompe el turno: el ítem se omite', () => {
      expect(prepararCon(['media'], () => { throw new Error('Paired item data unavailable'); })).toEqual([]);
    });
    it('una fuente sin nada', () => {
      expect(prepararCon(['media'], [{} as Fuente])).toEqual([]);
      expect(prepararCon(['media'], [{ meta: null, payload: null, tipoReporte: null, telefono: null }])).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------- 2. la rama corrida en el arnés, sobre un flujo mínimo de envío y reporte
const pos = (x: number, y: number): [number, number] => [x, y];
const baseDelFlujo = (): any => ({
  name: 'Mínimo de envío', settings: { executionOrder: 'v1' },
  nodes: [
    { id: 'x', name: 'Entrada', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: pos(-240, 0), parameters: {} },
    { id: 'a', name: 'Armar mensajes', type: 'n8n-nodes-base.code', typeVersion: 2, position: pos(0, 0), parameters: {
      jsCode: 'const e = $input.first().json; return e.mensajes.map((m) => ({ json: Object.assign({ phoneNumberId: "111", waGraphVersion: "v26.0" }, m), pairedItem: { item: 0 } }));' } },
    { id: 'e', name: 'Enviar a WhatsApp', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos(240, 0), onError: 'continueRegularOutput',
      credentials: { httpHeaderAuth: { id: '', name: 'Graph WhatsApp Prueba (Bearer)' } },
      parameters: { method: 'POST', url: '=https://graph.facebook.com/v26.0/{{ $json.phoneNumberId }}/messages', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.payload) }}' } },
    { id: 'm', name: '¿Meta aceptó?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos(480, 0), parameters: {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 }, conditions: [{ id: 'c1', leftValue: '={{ !!($json && !$json.error && Array.isArray($json.messages) && $json.messages[0] && $json.messages[0].id) }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } },
    { id: 'r', name: 'Reportar mensaje (saliente)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos(720, 0), onError: 'continueRegularOutput', alwaysOutputData: true,
      credentials: { httpHeaderAuth: { id: '', name: 'NovuChat ingesta (Prueba)' } },
      parameters: { method: 'POST', url: 'https://us-east1-novuchat-demo.cloudfunctions.net/ingesta', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendHeaders: true,
        headerParameters: { parameters: [{ name: 'X-NovuChat-Numero', value: "={{ $('Armar mensajes').first().json.phoneNumberId }}" }] },
        sendBody: true, specifyBody: 'json',
        jsonBody: "={{ (() => { const m = $('Armar mensajes').item.json; return JSON.stringify({ telefono: m.para, direccion: 'saliente', tipo: m.tipoReporte, texto: m.texto || '', idMeta: ((($json || {}).messages || [])[0] || {}).id || '' }); })() }}" } },
  ],
  connections: {
    Entrada: { main: [[{ node: 'Armar mensajes', type: 'main', index: 0 }]] },
    'Armar mensajes': { main: [[{ node: 'Enviar a WhatsApp', type: 'main', index: 0 }]] },
    'Enviar a WhatsApp': { main: [[{ node: '¿Meta aceptó?', type: 'main', index: 0 }]] },
    '¿Meta aceptó?': { main: [[{ node: 'Reportar mensaje (saliente)', type: 'main', index: 0 }], []] },
    'Reportar mensaje (saliente)': { main: [[]] },
  },
});
const conRama = (vias: ViaDelGuardadoSaliente[]): any => injertarGuardadoSaliente(baseDelFlujo(), {
  guardarUrl: 'https://us-east1-novuchat-demo.cloudfunctions.net/guardarMedio', vias, fuentes: fuentesDeLaCadenaComun(),
});
const mensajeDe = (tipo: string, extra: J = {}): J => ({ para: TEL, tipoReporte: tipo, texto: 'texto', ...extra });
const imagenId = (id = IMG_ID): J => mensajeDe('image', { payload: { messaging_product: 'whatsapp', recipient_type: 'individual', to: TEL, type: 'image', image: { id, caption: 'QR' } } });
const imagenEnlace = (enlace = ENLACE): J => mensajeDe('image', { payload: { messaging_product: 'whatsapp', recipient_type: 'individual', to: TEL, type: 'image', image: { link: enlace, caption: 'QR' } } });
const textoMsg = (): J => mensajeDe('text', { payload: { messaging_product: 'whatsapp', recipient_type: 'individual', to: TEL, type: 'text', text: { body: 'Hola' } } });
const interactivoConImagen = (): J => mensajeDe('interactive', { payload: { messaging_product: 'whatsapp', to: TEL, type: 'interactive', interactive: { type: 'button', header: { type: 'image', image: { link: ENLACE } }, body: { text: 'Planes' } } } });

function mundoDe(flujo: any, opciones: { respuesta?: Parameters<typeof doblesDelGuardado>[0]; envio?: Doble } = {}) {
  const { dobles, llamadas } = doblesDelGuardado(opciones.respuesta ?? {});
  let n = 0;
  const base: Record<string, Doble> = {
    ...dobles,
    'Enviar a WhatsApp': opciones.envio ?? (() => ({ messaging_product: 'whatsapp', messages: [{ id: `${WAMID.slice(0, -2)}${String(++n).padStart(2, '0')}` }] })),
    'Reportar mensaje (saliente)': { ok: true },
  };
  return { mundo: crearMundo({ flujo, dobles: base, ahoraMs: Date.UTC(2026, 10, 16, 15, 0, 0) }), llamadas };
}

describe('la rama corrida en el arnés de n8n, sobre un flujo mínimo de envío y reporte', () => {
  it('una imagen por media id: Graph pide la info con la credencial de envío, baja del CDN y guarda con el wamid reportado', () => {
    const { mundo, llamadas } = mundoDe(conRama(['media']), { respuesta: { respuesta: { statusCode: 200, body: { ruta: 'x', repetido: false } } } });
    const r = mundo.turno({ mensajes: [imagenId()] });
    expect(r.fallo).toBeNull();
    expect(llamadas.salientePedir).toHaveLength(1);
    expect(llamadas.salientePedir[0]!.url).toBe(`https://graph.facebook.com/v26.0/${IMG_ID}`);
    expect(llamadas.salienteBajar).toHaveLength(1);
    expect(llamadas.salienteBajar[0]!.url).toMatch(/^https:\/\/lookaside\.fbsbx\.com\//);
    expect(llamadas.salienteEnlace).toHaveLength(0);
    expect(llamadas.salienteGuardar).toHaveLength(1);
    const g = llamadas.salienteGuardar[0]!;
    expect(g.url).toBe('https://us-east1-novuchat-demo.cloudfunctions.net/guardarMedio');
    expect(g.metodo).toBe('POST');
    expect(g.encabezados['X-NovuChat-Numero']).toBe('111');
    expect(g.encabezados['X-NovuChat-Telefono']).toBe(TEL);
    expect(g.encabezados['X-NovuChat-Tipo']).toBe('image');
    // El MISMO wamid que «Reportar mensaje (saliente)» registró: el servidor exige que coincida.
    const reportado = r.llamadas.ingesta.find((x) => (x as any).direccion === 'saliente') as any;
    expect(reportado.idMeta).toBe(g.encabezados['X-NovuChat-IdMeta']);
    expect(reportado.idMeta).toMatch(/^wamid\./);
  });
  it('una imagen por enlace: se baja el MISMO enlace, sin pasar por Graph', () => {
    const { mundo, llamadas } = mundoDe(conRama(['enlace']));
    const r = mundo.turno({ mensajes: [imagenEnlace()] });
    expect(r.fallo).toBeNull();
    expect(llamadas.salienteEnlace.map((x) => x.url)).toEqual([ENLACE]);
    expect(llamadas.salientePedir).toHaveLength(0);
    expect(llamadas.salienteBajar).toHaveLength(0);
    expect(llamadas.salienteGuardar).toHaveLength(1);
  });
  it('con las dos vías, cada imagen toma la suya (un enlace y un media id en el mismo turno)', () => {
    const { mundo, llamadas } = mundoDe(conRama(['enlace', 'media']));
    const r = mundo.turno({ mensajes: [imagenEnlace(), imagenId()] });
    expect(r.fallo).toBeNull();
    expect(llamadas.salienteEnlace).toHaveLength(1);
    expect(llamadas.salientePedir).toHaveLength(1);
    expect(llamadas.salienteBajar).toHaveLength(1);
    expect(llamadas.salienteGuardar).toHaveLength(2);
    const ids = llamadas.salienteGuardar.map((x) => x.encabezados['X-NovuChat-IdMeta']);
    expect(new Set(ids).size).toBe(2);
  });
  it('NEGANDO: un texto, un botón con la imagen de encabezado y un documento no llaman a nada de la rama', () => {
    for (const m of [textoMsg(), interactivoConImagen(), mensajeDe('document', { payload: { type: 'document', to: TEL, document: { id: IMG_ID } } })]) {
      const { mundo, llamadas } = mundoDe(conRama(['enlace', 'media']));
      const r = mundo.turno({ mensajes: [m] });
      expect(r.fallo).toBeNull();
      expect(r.ejecutados.has('Preparar guardado (saliente)')).toBe(true);
      expect(llamadas.salienteEnlace.length + llamadas.salientePedir.length + llamadas.salienteBajar.length + llamadas.salienteGuardar.length).toBe(0);
    }
  });
  it('NEGANDO: un envío que falló no se guarda (la rama ni empieza: no hay reporte saliente)', () => {
    const { mundo, llamadas } = mundoDe(conRama(['media']), { envio: () => ({ error: { message: '(#131047) Re-engagement message' } }) });
    const r = mundo.turno({ mensajes: [imagenId()] });
    expect(r.ejecutados.has('Reportar mensaje (saliente)')).toBe(false);
    expect(r.ejecutados.has('Preparar guardado (saliente)')).toBe(false);
    expect(llamadas.salienteGuardar).toHaveLength(0);
  });
  it('NEGANDO: la rama corre DESPUÉS del reporte y de todo envío al cliente', () => {
    const { mundo } = mundoDe(conRama(['media']));
    const r = mundo.turno({ mensajes: [textoMsg(), imagenId(), textoMsg()] });
    const iPrep = r.orden.indexOf('Preparar guardado (saliente)');
    expect(iPrep).toBeGreaterThan(-1);
    expect(iPrep).toBeGreaterThan(r.orden.lastIndexOf('Enviar a WhatsApp'));
    expect(iPrep).toBeGreaterThan(r.orden.lastIndexOf('Reportar mensaje (saliente)'));
  });
  it('NEGANDO: no altera lo que recibe el cliente (mismos mensajes, mismo orden y mismo contenido) ni agrega un mensaje', () => {
    const mensajes = [textoMsg(), imagenId(), textoMsg(), imagenEnlace()];
    const sin = mundoDe(baseDelFlujo()).mundo.turno({ mensajes });
    const con = mundoDe(conRama(['enlace', 'media'])).mundo.turno({ mensajes });
    expect(con.mensajes.map((x) => x.payload)).toEqual(sin.mensajes.map((x) => x.payload));
    expect(con.mensajes.map((x) => x.a)).toEqual(sin.mensajes.map((x) => x.a));
    expect(con.mensajes).toHaveLength(4);
    expect(con.avisos).toHaveLength(sin.avisos.length);
    expect(con.llamadas.ingesta).toEqual(sin.llamadas.ingesta);
    // 0 envíos de WhatsApp agregados: ningún nodo de la rama llama a /messages.
    const envios = (f: any) => f.nodes.filter((n: any) => /\/messages\b/.test(String((n.parameters || {}).url || '')) || n.type === 'n8n-nodes-base.whatsApp').length;
    expect(envios(conRama(['enlace', 'media']))).toBe(envios(baseDelFlujo()));
  });
  it('NEGANDO: el servidor que dice no (apagado, 413, 415, 429, 5xx) o no responde NO hace fallar el turno ni se reintenta', () => {
    const respuestas: Array<Parameters<typeof doblesDelGuardado>[0]> = [
      {}, // apagado por omisión (409 guardado_apagado)
      { respuesta: { statusCode: 413, body: { error: 'demasiado_grande' } } }, { respuesta: { statusCode: 415, body: { error: 'tipo_no_admitido' } } },
      { respuesta: { statusCode: 429, body: { error: 'cupo_diario_lleno' } } }, { respuesta: { statusCode: 502, body: { error: 'no_se_guardo' } } },
      { respuesta: { statusCode: 409, body: { error: 'sin_mensaje' } } }, { respuesta: 'lanza' },
    ];
    for (const respuesta of respuestas) {
      const { mundo, llamadas } = mundoDe(conRama(['media']), { respuesta });
      const r = mundo.turno({ mensajes: [imagenId()] });
      expect(r.fallo, JSON.stringify(respuesta)).toBeNull();
      expect(r.mensajes).toHaveLength(1);
      expect(llamadas.salienteGuardar, 'un solo intento: el servidor decide').toHaveLength(1);
      expect(r.avisos).toHaveLength(0);
    }
  });
  it('NEGANDO: Meta que no deja bajar la imagen (URL fuera de su CDN o más de 5 MiB) no llama al CDN y el turno sigue', () => {
    for (const o of [{ url: 'https://otro.example/imagen.png' }, { bytes: 6 * 1024 * 1024 }]) {
      const { mundo, llamadas } = mundoDe(conRama(['media']), { respuesta: o });
      const r = mundo.turno({ mensajes: [imagenId()] });
      expect(r.fallo).toBeNull();
      expect(llamadas.salienteBajar.every((x) => x.url === '' ), JSON.stringify(o)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- 3. los flujos versionados
const CON_RAMA: Array<{ archivo: string; vias: ViaDelGuardadoSaliente[]; reportero?: string; envio?: string }> = [
  ...['venta-minima.qtaco.json', 'venta-minima.qtaco-3727.json', 'venta-minima.prueba.json', 'venta-minima.ensayo-demo-a.json'].map((a) => ({ archivo: `experimental/venta-minima/${a}`, vias: ['enlace'] as ViaDelGuardadoSaliente[] })),
  ...['rroca-ruben.json', 'rroca-ruben.prueba.json', 'rroca-ruben.ensayo-demo-a.json'].map((a) => ({ archivo: `experimental/rroca-ruben/${a}`, vias: ['media'] as ViaDelGuardadoSaliente[] })),
  ...['rroca-antonio.json', 'rroca-antonio.prueba.json'].map((a) => ({ archivo: `clientes/rroca-antonio/${a}`, vias: ['media'] as ViaDelGuardadoSaliente[] })),
  ...['walisuma.json', 'walisuma.prueba.json'].map((a) => ({ archivo: `clientes/walisuma/${a}`, vias: ['media'] as ViaDelGuardadoSaliente[] })),
  ...['casa-bermejo.json', 'casa-bermejo.prueba.json'].map((a) => ({ archivo: `clientes/casa-bermejo/${a}`, vias: ['media'] as ViaDelGuardadoSaliente[] })),
  // Bloque 2b (16/11/2026): las FOTOS de catálogo de Evy y Emma salen por «Enviar aviso» y se reportan SIN CONTEO desde «Reportar foto (saliente)» (reporte-sin-conteo.mjs).
  ...['experimental/rroca-evy/rroca-evy.json', 'experimental/rroca-evy/rroca-evy.prueba.json', 'experimental/rroca-evy/rroca-evy.ensayo-demo-a.json', 'experimental/rroca-emma/rroca-emma.json', 'experimental/rroca-emma/rroca-emma.prueba.json']
    .map((archivo) => ({ archivo, vias: ['media'] as ViaDelGuardadoSaliente[], reportero: 'Reportar foto (saliente)', envio: 'Enviar aviso' })),
  { archivo: 'demo-a-agendamiento.json', vias: ['enlace'], reportero: 'Reportar QR (saliente)', envio: 'Enviar QR de la seña' },
  { archivo: 'demo-b-venta-cobro.json', vias: ['enlace', 'media'], reportero: 'Reportar QR (saliente)', envio: 'Enviar QR de cobro' },
];
const SIN_RAMA = [
  // Los flujos viejos de las doctoras (Evy y Emma ya tienen la rama: ver CON_RAMA).
  'experimental/doctoras/doctoras.rroca-evy.json', 'experimental/doctoras/doctoras.rroca-emma.json',
  // La imagen sale de ENCABEZADO de un interactivo (se reporta `interactive` o `text`): el servidor solo admite un saliente de tipo `image`.
  'clientes/novuchat/chat-novuchat.novuchat.json', 'experimental/captacion-minima/captacion-minima.novuchat.json',
  // No envían imágenes del asistente (Agenda mínima no manda QR; el flujo A de Bellido está descartado y el de onboarding es histórico).
  'experimental/agenda-minima/agenda-minima.v0.json', 'bellido-agendamiento.json', 'novuchat-onboarding.json',
];

describe('cada flujo versionado que envía una imagen del asistente lleva la rama completa', () => {
  it.each(CON_RAMA)('$archivo: rama completa, colgada del reporte saliente, debajo de todo y con sus credenciales', ({ archivo, vias, reportero, envio }) => {
    const f = leer(archivo);
    expect(hallazgosDelGuardadoSaliente(f, { exigir: true, vias, reportero, envio })).toEqual([]);
    const nombres = f.nodes.map((n: any) => n.name);
    const propios = nombres.filter((n: string) => NODOS_DEL_GUARDADO_SALIENTE.includes(n));
    expect(propios, 'nodos que agrega').toHaveLength(nodosQueAgrega(vias));
    expect(new Set(nombres).size, 'nombres únicos').toBe(nombres.length);
    // Nada de la rama manda un mensaje de WhatsApp.
    for (const n of f.nodes.filter((x: any) => propios.includes(x.name))) {
      expect(JSON.stringify(n.parameters), n.name).not.toMatch(/\/messages\b/);
      expect(n.retryOnFail, n.name).not.toBe(true);
    }
    // El único que entra a la rama es el reporte saliente.
    const entran = Object.entries(f.connections as Record<string, any>).filter(([de, s]) => !propios.includes(de) && JSON.stringify(s).includes('"Preparar guardado (saliente)"')).map(([de]) => de);
    expect(entran).toEqual([reportero ?? 'Reportar mensaje (saliente)']);
    // Los nodos del guardado no los toma por un medio entrante `manejaMedios` (no exige por ellos la rama del entrante).
    const sinRama = copia(f);
    sinRama.nodes = sinRama.nodes.filter((n: any) => !propios.includes(n.name));
    expect(manejaMedios(f)).toBe(manejaMedios(sinRama));
  });
  it('los nodos que agrega cada flujo: 3 (enlace), 4 (media id) o 6 (las dos vías)', () => {
    expect(nodosQueAgrega(['enlace'])).toBe(3);
    expect(nodosQueAgrega(['media'])).toBe(4);
    expect(nodosQueAgrega(['enlace', 'media'])).toBe(6);
  });
  it('los totales de nodos de cada flujo publicable (tope documentado en docs/versiones-por-cliente.md)', () => {
    const total = (a: string): number => leer(a).nodes.length;
    expect(total('experimental/venta-minima/venta-minima.qtaco.json')).toBe(76);
    expect(total('experimental/venta-minima/venta-minima.qtaco-3727.json')).toBe(84);
    expect(total('experimental/rroca-ruben/rroca-ruben.json')).toBe(68);
    expect(total('clientes/rroca-antonio/rroca-antonio.json')).toBe(68);
    expect(total('clientes/walisuma/walisuma.json')).toBe(68);
    expect(total('clientes/casa-bermejo/casa-bermejo.json')).toBe(61);
    expect(total('demo-a-agendamiento.json')).toBe(80);
    expect(total('demo-b-venta-cobro.json')).toBe(91);
  });
  it.each(SIN_RAMA)('%s NO la lleva (bloque 2b o imagen de encabezado: ver el plan)', (archivo) => {
    expect(copia(leer(archivo)).nodes.filter((n: any) => NODOS_DEL_GUARDADO_SALIENTE.includes(n.name))).toEqual([]);
  });
  it('las dos pruebas de tamaño: el guardado entrante sigue con sus nueve nodos y la rama saliente no toca su retención de ejecuciones', () => {
    for (const { archivo } of CON_RAMA) {
      const f = leer(archivo);
      if (f.nodes.some((n: any) => n.name === 'Preparar guardado')) {
        expect(f.settings.saveDataSuccessExecution, archivo).toBe('none');
        expect(f.settings.saveDataErrorExecution, archivo).toBe('none');
        expect(f.settings.saveExecutionProgress, archivo).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------- 4. NEGANDO: cada regla de la guardia tiene la mutación que la rompe
describe('la guardia del guardado saliente, NEGANDO', () => {
  const BASE = 'clientes/rroca-antonio/rroca-antonio.json';
  const BASE_B = 'demo-b-venta-cobro.json';
  const conBase = (cambio: (f: any) => void, archivo = BASE, opciones: any = {}): string => {
    const f = copia(leer(archivo)); cambio(f);
    return hallazgosDelGuardadoSaliente(f, { vias: undefined, ...opciones }).join(' | ');
  };
  const nodo = (f: any, n: string): any => f.nodes.find((x: any) => x.name === n);
  const P = 'Preparar guardado (saliente)';
  const M = 'Pedir imagen a Meta (guardado saliente)';
  const B = 'Descargar imagen de Meta (guardado saliente)';
  const G = 'Guardar imagen enviada';

  it('el flujo sin cambios pasa', () => {
    expect(conBase(() => undefined)).toBe('');
    expect(conBase(() => undefined, BASE_B, { reportero: 'Reportar QR (saliente)', envio: 'Enviar QR de cobro' })).toBe('');
  });
  it('un nodo de la rama que falta, o uno que sobra', () => {
    expect(conBase((f) => { f.nodes = f.nodes.filter((n: any) => n.name !== B); })).toMatch(/falta el nodo «Descargar imagen de Meta/);
    expect(conBase((f) => { f.nodes.push({ ...copia(nodo(f, G)), id: 'x', name: 'Descargar enlace (guardado saliente)' }); })).toMatch(/sobra «Descargar enlace/);
  });
  it('la rama no cuelga del reporte saliente, o está arriba de él', () => {
    expect(conBase((f) => { f.connections['Reportar mensaje (saliente)'].main[0] = []; })).toMatch(/no cuelga de «Reportar mensaje \(saliente\)»/);
    expect(conBase((f) => { nodo(f, P).position = [0, 0]; })).toMatch(/tiene que ir arriba|DEBAJO de todo/);
  });
  it('un nodo del flujo más abajo que la rama (correría después)', () => {
    expect(conBase((f) => { nodo(f, 'Armar mensajes').position = [0, 99999]; })).toMatch(/DEBAJO de todo el flujo/);
  });
  it('una arista cortada o un nodo de la rama que sigue hacia afuera', () => {
    expect(conBase((f) => { f.connections[M].main[0] = []; })).toMatch(/«Pedir imagen a Meta \(guardado saliente\)» \(salida 0\) no está conectado/);
    expect(conBase((f) => { f.connections[G] = { main: [[{ node: 'Enviar a WhatsApp', type: 'main', index: 0 }]] }; })).toMatch(/sigue hacia «Enviar a WhatsApp», fuera de la rama/);
  });
  it('un nodo de la rama que llama a /messages (mandaría un mensaje de WhatsApp)', () => {
    expect(conBase((f) => { nodo(f, M).parameters.url = '=https://graph.facebook.com/v26.0/{{ $json.phoneNumberId }}/messages'; })).toMatch(/llama a \/messages/);
  });
  it('un reintento (la rama no insiste: el servidor decide)', () => {
    for (const n of [M, B, G]) expect(conBase((f) => { nodo(f, n).retryOnFail = true; }), n).toMatch(/no reintenta/);
  });
  it('un nodo que corta el turno (sin onError continueRegularOutput o sin alwaysOutputData)', () => {
    for (const n of [M, B, G]) {
      expect(conBase((f) => { delete nodo(f, n).onError; }), n).toMatch(/onError continueRegularOutput/);
      expect(conBase((f) => { delete nodo(f, n).alwaysOutputData; }), n).toMatch(/alwaysOutputData/);
    }
  });
  it('una credencial equivocada: la de ingesta hacia Meta, o la de Meta hacia guardarMedio', () => {
    const ing = nodo(copia(leer(BASE)), 'Reportar mensaje (saliente)').credentials.httpHeaderAuth.name as string;
    expect(conBase((f) => { nodo(f, M).credentials = { httpHeaderAuth: { id: '', name: ing } }; })).toMatch(/MISMA credencial de Meta|credencial de ingesta/);
    expect(conBase((f) => { nodo(f, B).credentials = { httpHeaderAuth: { id: '', name: 'Graph WhatsApp Otra (Bearer)' } }; })).toMatch(/MISMA credencial de Meta/);
    expect(conBase((f) => { nodo(f, G).credentials = { httpHeaderAuth: { id: '', name: 'Graph WhatsApp Antonio (Bearer)' } }; })).toMatch(/SOLO la credencial de ingesta/);
  });
  it('el enlace se baja CON credencial de Meta (el token iría a otro anfitrión) o siguiendo redirecciones', () => {
    const B2 = 'Descargar enlace (guardado saliente)';
    expect(conBase((f) => { nodo(f, B2).credentials = { httpHeaderAuth: { id: '', name: 'Graph WhatsApp Demo B (Bearer)' } }; }, BASE_B, { reportero: 'Reportar QR (saliente)', envio: 'Enviar QR de cobro' })).toMatch(/no lleva credencial/);
    expect(conBase((f) => { nodo(f, B2).parameters.authentication = 'predefinedCredentialType'; }, BASE_B, { reportero: 'Reportar QR (saliente)', envio: 'Enviar QR de cobro' })).toMatch(/no lleva credencial/);
    expect(conBase((f) => { nodo(f, B2).parameters.url = '={{ $json.url }}'; }, BASE_B, { reportero: 'Reportar QR (saliente)', envio: 'Enviar QR de cobro' })).toMatch(/baja solo el enlace que se envió/);
    expect(conBase((f) => { nodo(f, B2).parameters.options.redirect.redirect.followRedirects = true; }, BASE_B, { reportero: 'Reportar QR (saliente)', envio: 'Enviar QR de cobro' })).toMatch(/no puede seguir redirecciones/);
  });
  it('la descarga de Meta a otro anfitrión o siguiendo redirecciones', () => {
    expect(conBase((f) => { nodo(f, B).parameters.url = '={{ $json.url }}'; })).toMatch(/llama a otro anfitrión/);
    expect(conBase((f) => { nodo(f, B).parameters.options.redirect.redirect.followRedirects = true; })).toMatch(/no puede seguir redirecciones/);
    expect(conBase((f) => { nodo(f, M).parameters.url = '=https://evil.example/{{ $json.mediaId }}'; })).toMatch(/llama a otro anfitrión/);
  });
  it('guardarMedio: otra URL, una firma, sin bytes, sin respuesta completa, otro número, otro tipo o el mime sin sanear', () => {
    expect(conBase((f) => { nodo(f, G).parameters.url = 'https://otro.example/guardarMedio'; })).toMatch(/otro anfitrión que «Reportar mensaje \(saliente\)»/);
    expect(conBase((f) => { nodo(f, G).parameters.url = 'http://x.example/guardarMedio'; })).toMatch(/no llama a guardarMedio/);
    expect(conBase((f) => { nodo(f, G).parameters.headerParameters.parameters.push({ name: 'X-NovuChat-Signature', value: 'x' }); })).toMatch(/manda una firma/);
    expect(conBase((f) => { nodo(f, G).parameters.sendBody = false; })).toMatch(/manda los bytes/);
    expect(conBase((f) => { nodo(f, G).parameters.options.response.response.neverError = false; })).toMatch(/respuesta completa sin error/);
    expect(conBase((f) => { nodo(f, G).parameters.headerParameters.parameters.find((x: any) => x.name === 'X-NovuChat-Numero').value = '={{ "999" }}'; })).toMatch(/MISMO X-NovuChat-Numero/);
    expect(conBase((f) => { nodo(f, G).parameters.headerParameters.parameters.find((x: any) => x.name === 'X-NovuChat-Tipo').value = 'document'; })).toMatch(/siempre X-NovuChat-Tipo: image/);
    expect(conBase((f) => { nodo(f, G).parameters.headerParameters.parameters.find((x: any) => x.name === 'Content-Type').value = 'application/json'; })).toMatch(/mime del binario saneado/);
    expect(conBase((f) => { nodo(f, G).parameters.headerParameters.parameters.find((x: any) => x.name === 'X-NovuChat-IdMeta').value = '={{ "otro" }}'; })).toMatch(/teléfono y el wamid/);
  });
  it('el código del nodo Code alterado, o que lee el contenido del binario', () => {
    expect(conBase((f) => { nodo(f, P).parameters.jsCode = String(nodo(f, P).parameters.jsCode).replace("gsPayload.type !== 'image'", 'false'); })).toMatch(/no incluye guardado-saliente-preparar\.js tal cual/);
    expect(conBase((f) => { nodo(f, P).parameters.jsCode += '\nconst x = this.helpers.getBinaryDataBuffer(0, "data");\n'; })).toMatch(/lee el contenido del binario/);
  });
  it('las vías: las que se esperan no son las del flujo', () => {
    expect(conBase(() => undefined, BASE, { vias: ['enlace'] })).toMatch(/las vías son \["media"\] y se esperaban \["enlace"\]/);
  });
  it('sin la rama, con `exigir`, falla', () => {
    expect(hallazgosDelGuardadoSaliente(leer('experimental/doctoras/doctoras.rroca-evy.json'), { exigir: true }).join(' ')).toMatch(/falta la rama/);
    expect(hallazgosDelGuardadoSaliente(leer('experimental/doctoras/doctoras.rroca-evy.json'))).toEqual([]);
  });
  it('injertar: sin reporte saliente, sin nodo de envío, la rama ya injertada, vías inválidas, URL ajena, ingesta como credencial de Meta', () => {
    const url = 'https://us-east1-novuchat-demo.cloudfunctions.net/guardarMedio';
    const ok = { guardarUrl: url, vias: ['media'] as ViaDelGuardadoSaliente[], fuentes: fuentesDeLaCadenaComun() };
    expect(() => injertarGuardadoSaliente({ nodes: [], connections: {} }, ok)).toThrow(/no tiene «Reportar mensaje \(saliente\)»/);
    const sinEnvio = baseDelFlujo(); sinEnvio.nodes = sinEnvio.nodes.filter((n: any) => n.name !== 'Enviar a WhatsApp');
    expect(() => injertarGuardadoSaliente(sinEnvio, ok)).toThrow(/no tiene «Enviar a WhatsApp»/);
    expect(() => injertarGuardadoSaliente(conRama(['media']), ok)).toThrow(/ya tiene/);
    expect(() => injertarGuardadoSaliente(baseDelFlujo(), { ...ok, vias: [] })).toThrow(/faltan las vías/);
    expect(() => injertarGuardadoSaliente(baseDelFlujo(), { ...ok, vias: ['ftp'] as any })).toThrow(/vía desconocida/);
    expect(() => injertarGuardadoSaliente(baseDelFlujo(), { ...ok, guardarUrl: 'http://x.example/guardarMedio' })).toThrow(/guardarUrl/);
    const trampa = baseDelFlujo(); nodo(trampa, 'Enviar a WhatsApp').credentials = { httpHeaderAuth: { id: '', name: 'NovuChat ingesta (Prueba)' } };
    expect(() => injertarGuardadoSaliente(trampa, ok)).toThrow(/la trampa del 15\/09/);
  });
  it('las fuentes: faltantes, con globales que el Code de n8n no tiene o que no compilan', () => {
    const f = fuentesDeLaCadenaComun();
    expect(() => cabeceraDeFuentesSaliente(['media'], { ...f, meta: '' })).toThrow(/tiene que ser una expresión/);
    expect(() => cabeceraDeFuentesSaliente(['media'], { ...f, payload: 'new URL("https://x").href' })).toThrow(/global/);
    expect(() => cabeceraDeFuentesSaliente(['media'], { ...f, payload: 'Buffer.from("x")' })).toThrow(/global/);
    expect(() => cabeceraDeFuentesSaliente(['media'], { ...f, telefono: 'a b c' })).toThrow(/no compila/);
    expect(() => cabeceraDeFuentesSaliente(['media'], { ...f, telefono: '1;\n2' })).toThrow(/saltos de línea/);
  });
  it('las aristas y las vías están completas', () => {
    expect(validarVias(['media', 'enlace', 'media'])).toEqual(['enlace', 'media']);
    expect(aristasDelGuardadoSaliente(['enlace'])).toHaveLength(2);
    expect(aristasDelGuardadoSaliente(['media'])).toHaveLength(3);
    expect(aristasDelGuardadoSaliente(['enlace', 'media'])).toHaveLength(6);
  });
});
