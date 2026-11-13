/**
 * EL GUARDADO DE MEDIOS POR EL RELÉ (P3 del plan del 02/11/2026), corriendo en el n8n de mentira contra un doble del relé B9.
 *   - la info sale de GET /v1/envio/medios/<id> (id, mime_type, file_size; sin `url`) y el contenido de GET …/contenido, solo con `file_size` dentro de 16 MiB;
 *   - NIEGA: un id vencido (502 WM-3040, no 404), un medio sin `file_size` o de más de 16 MiB (413 WM-3039) no piden `/contenido`; nada se reintenta
 *     (cada GET gasta una de las 500 descargas diarias por WABA: un medio guardado gasta 2);
 *   - un 4xx o 5xx de `/contenido` deja un item sin binario, que no llega a `guardarMedio`;
 *   - el aviso de falla sale por el relé con su Idempotency-Key y SIN neverError (un no-2xx deja la ejecución en error);
 *   - ni Graph, ni su CDN, ni `whatsAppApi`; `hallazgosDelGuardado` pasa y se queja de lo que se rompa;
 *   - el canal Graph no cambia.
 */
import { describe, expect, it } from 'vitest';
import {
  CUPO_POR_DEFECTO_RELE, cabeceraDeFuentes, FUENTE_CUPO, FUENTE_PREPARAR, hallazgosDelGuardado, injertarGuardado, manejaMedios, nodosDelGuardado, REINTENTO_GET_RELE, urlDescargaRele, urlInfoRele, URL_DESCARGA_GUARDADO, NODOS_DE_META_DEL_GUARDADO,
  type OpcionesDelGuardado,
} from '../../../../Flujos/src/core/sin-agente/guardado.mjs';
import { MARCADOR_URL_DEL_RELE } from '../../../../Flujos/src/core/sin-agente/envio.mjs';
import { crearMundo, type LlamadaDoble, type ResultadoTurno } from '../../lib/n8n-de-mentira';
import type { Flujo, J } from '../../lib/flujo';
import { CLIENTE, CRED_INGESTA, CRED_RELE, ok } from './ayuda';

const MIB16 = 16 * 1024 * 1024;
const PID = '5551234';
const REC = '7000009';
const TEL = '70000001';
const GUARDAR = 'https://consola.example/guardarMedio';
const OPC: OpcionesDelGuardado = { canal: 'rele', cliente: CLIENTE, guardarUrl: GUARDAR };

const nodoHttp = (name: string, extra: J, y: number) => ({ name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [400, y], parameters: extra['parameters'] ?? {}, ...(extra['credentials'] ? { credentials: extra['credentials'] } : {}) });

function flujoBase(): Flujo {
  return {
    name: 'prueba-medios', settings: {},
    nodes: [
      { name: 'Entrada de prueba', type: 'n8n-nodes-base.noOp', parameters: {}, position: [0, 0] },
      { name: 'Carga de entrada', type: 'n8n-nodes-base.code', parameters: { jsCode: 'return [{ json: { messages: $input.first().json.messages, ahoraMs: $input.first().json.ahoraMs } }];' }, position: [100, 0] },
      { name: 'Config del negocio', type: 'n8n-nodes-base.code', parameters: { jsCode: `return [{ json: { waGraphVersion: 'v26.0', numeroRecepcion: '${REC}', numeroRecepcionDigitos: '${REC}' } }];` }, position: [200, 0] },
      nodoHttp('Reportar mensaje (entrante)', {
        credentials: { httpHeaderAuth: { id: '', name: CRED_INGESTA } },
        parameters: { method: 'POST', url: 'https://consola.example/ingesta', headerParameters: { parameters: [{ name: 'X-NovuChat-Numero', value: `={{ '${PID}' }}` }] } },
      }, 0),
      // El nodo que baja el medio en la conversación (por el relé): lo que vuelve OBLIGATORIO la rama.
      nodoHttp('Obtener URL del medio (general)', { parameters: { method: 'GET', url: `=${MARCADOR_URL_DEL_RELE}/v1/envio/medios/{{ $json.id }}` } }, 100),
      nodoHttp('Enviar a WhatsApp', { credentials: { httpHeaderAuth: { id: '', name: CRED_RELE } }, parameters: { method: 'POST', url: `=${MARCADOR_URL_DEL_RELE}/v1/envio/mensajes/x` } }, 200),
    ],
    connections: {
      'Entrada de prueba': { main: [[{ node: 'Carga de entrada', type: 'main', index: 0 }]] },
      'Carga de entrada': { main: [[{ node: 'Config del negocio', type: 'main', index: 0 }]] },
      'Config del negocio': { main: [[{ node: 'Reportar mensaje (entrante)', type: 'main', index: 0 }]] },
      'Reportar mensaje (entrante)': { main: [[{ node: 'Obtener URL del medio (general)', type: 'main', index: 0 }]] },
    },
  } as unknown as Flujo;
}
const flujoConGuardado = (o: Partial<OpcionesDelGuardado> = {}): Flujo => injertarGuardado(flujoBase(), { ...OPC, ...o });

interface Mundo { r: (m: J, o?: { tamano?: number | null; info?: J | 'lanza'; contenido?: 'lanza' | 'ok'; infoSec?: string[]; contenidoSec?: string[]; servidor?: number; aviso?: 'lanza'; ahoraMs?: number }, de?: string, wamid?: string) => ResultadoTurno; llamadas: Record<'info' | 'contenido' | 'servidor' | 'aviso', LlamadaDoble[]>; sd: J }
function mundo(flujo: Flujo = flujoConGuardado()): Mundo {
  const llamadas: Mundo['llamadas'] = { info: [], contenido: [], servidor: [], aviso: [] };
  let cfg: Parameters<Mundo['r']>[1] = {};
  const mu = crearMundo({
    flujo, ahoraMs: Date.UTC(2026, 10, 2, 15, 0, 0),
    dobles: {
      'Reportar mensaje (entrante)': () => ({ ok: true }),
      'Obtener URL del medio (general)': () => ({}),
      'Pedir el medio a Meta (guardado)': (ll) => {
        llamadas.info.push(ll);
        // Una secuencia por llamada: cada texto es el error que lanza el relé en esa vuelta ('ok' = contesta bien; la última se repite).
        const sec = cfg?.infoSec?.[Math.min(llamadas.info.length, cfg.infoSec.length) - 1];
        if (sec !== undefined && sec !== 'ok') throw new Error(sec);
        if (cfg?.info === 'lanza') throw new Error('502 WM-3040 (id vencido)');
        if (cfg?.info) return cfg.info;
        return cfg?.tamano === null ? { id: 'M1', mime_type: 'image/jpeg' } : { id: 'M1', mime_type: 'image/jpeg', file_size: cfg?.tamano ?? 2048, sha256: 'x' };
      },
      'Descargar medio (guardado)': (ll) => {
        llamadas.contenido.push(ll);
        // Como n8n: una URL vacía revienta, y un no-2xx también (sin neverError): el item queda con `error` y sin binario.
        if (ll.url === '') throw new Error('Invalid URL');
        const sec = cfg?.contenidoSec?.[Math.min(llamadas.contenido.length, cfg.contenidoSec.length) - 1];
        if (sec !== undefined && sec !== 'ok') throw new Error(sec);
        if (cfg?.contenido === 'lanza') throw new Error('The service was not able to process your request (404)');
        return { data: 'binario' };
      },
      'Guardar medio': (ll) => {
        if (ll.item['error'] !== undefined) throw new Error("expects the node's input data to contain a binary file 'data'");
        llamadas.servidor.push(ll);
        return { statusCode: cfg?.servidor ?? 200, headers: {}, body: cfg?.servidor === 413 ? { error: 'demasiado_grande' } : { ruta: 'x', repetido: false } };
      },
      'Avisar falla del guardado': (ll) => {
        llamadas.aviso.push(ll);
        if (cfg?.aviso === 'lanza') throw new Error('504');
        return ok('aviso');
      },
    },
  });
  // La recepción escribe primero: abre su ventana de 24 h (la anota «Preparar guardado»), para que el aviso de falla pueda salir.
  const turno = (msg: J, o: NonNullable<Parameters<Mundo['r']>[1]> = {}, de = TEL, wamid = 'wamid.M1'): ResultadoTurno => {
    cfg = o;
    return mu.turno({ messages: [{ from: de, id: wamid, ...msg }], ahoraMs: o.ahoraMs ?? Date.UTC(2026, 10, 2, 15, 0, 0) }, { tolerarFallo: true } as never);
  };
  turno({ type: 'text', text: { body: 'hola' } }, {}, REC, 'wamid.R0');
  return { r: (m, o, de, wamid) => turno(m, o, de, wamid), llamadas, sd: mu.sd };
}
const imagen = (id = 'M1'): J => ({ type: 'image', image: { id, mime_type: 'image/jpeg' } });
const documento = (): J => ({ type: 'document', document: { id: 'D1', mime_type: 'application/pdf', filename: 'a.pdf' } });
const AVISO = (motivo: string): string => `No se pudo guardar un archivo de una conversación (${motivo}). Revísala en la Consola.`;

describe('la rama armada para el relé', () => {
  const flujo = flujoConGuardado();
  const nodo = (n: string) => flujo.nodes.find((x) => x.name === n)!;
  it('la rama tiene sus nueve nodos y `hallazgosDelGuardado` no encuentra nada', () => {
    expect(hallazgosDelGuardado(flujo)).toEqual([]);
    expect(manejaMedios(flujoBase())).toBe(true);
  });
  it('info: GET /v1/envio/medios/<id>; contenido: …/contenido; las dos con la credencial «AAB1 envío · alias» y con reintento propio', () => {
    expect(nodo('Pedir el medio a Meta (guardado)').parameters['url']).toBe(urlInfoRele());
    expect(nodo('Pedir el medio a Meta (guardado)').parameters['url']).toBe(`=${MARCADOR_URL_DEL_RELE}/v1/envio/medios/{{ String($('Preparar guardado').first().json.mediaId || '').replace(/[^A-Za-z0-9_-]/g, '') }}`);
    expect(nodo('Descargar medio (guardado)').parameters['url']).toBe(urlDescargaRele());
    for (const n of NODOS_DE_META_DEL_GUARDADO) {
      expect(nodo(n).credentials).toEqual({ httpHeaderAuth: { id: '', name: CRED_RELE } });
      if (n !== 'Avisar falla del guardado') expect(nodo(n)['retryOnFail']).toBe(true);
      else expect(nodo(n)['retryOnFail']).toBeUndefined();
    }
    expect(nodo('Pedir el medio a Meta (guardado)').parameters['options'].timeout).toBeGreaterThanOrEqual(30000);
    expect(nodo('Descargar medio (guardado)').parameters['options'].timeout).toBe(60000);
  });
  it('NIEGA: la descarga no lleva neverError (un 4xx o 5xx no puede pasar por un binario)', () => {
    expect(JSON.stringify(nodo('Descargar medio (guardado)').parameters['options'])).not.toMatch(/neverError|fullResponse/);
  });
  it('NIEGA: ni Graph, ni su CDN, ni whatsAppApi en los tres nodos que hablaban con Meta; tampoco una URL real', () => {
    for (const n of NODOS_DE_META_DEL_GUARDADO) {
      const texto = JSON.stringify({ p: nodo(n).parameters, c: nodo(n).credentials });
      expect(texto, n).not.toMatch(/graph\.facebook\.com|lookaside|fbsbx|whatsAppApi|predefinedCredentialType/);
      expect(texto.replace(/REEMPLAZAR_URL_INTERNA_DEL_RELE/g, ''), n).not.toMatch(/https?:\/\//);
    }
  });
  it('el aviso: POST /v1/envio/mensajes/<phone_number_id> con Idempotency-Key, 30 s, sin onError y sin neverError', () => {
    const a = nodo('Avisar falla del guardado');
    expect(a.parameters['url']).toContain(`${MARCADOR_URL_DEL_RELE}/v1/envio/mensajes/`);
    expect(a.parameters['headerParameters'].parameters[0].name).toBe('Idempotency-Key');
    expect(a.parameters['headerParameters'].parameters[0].value).toContain(`'${CLIENTE}-'`);
    expect(a.parameters['headerParameters'].parameters[0].value).toContain('-avisoguardado-');
    expect(a.parameters['options'].timeout).toBeGreaterThanOrEqual(30000);
    expect(JSON.stringify(a.parameters['options'])).not.toMatch(/neverError/);
    expect(a['onError']).toBeUndefined();
    expect(a['retryOnFail']).toBeUndefined();
  });
  it('la credencial del relé se toma de «Enviar a WhatsApp» si no se da, y la de ingesta de «Reportar mensaje (entrante)»', () => {
    expect(nodo('Guardar medio').credentials).toEqual({ httpHeaderAuth: { id: '', name: CRED_INGESTA } });
  });
  it('NIEGA: sin cliente, sin la credencial «AAB1 envío · …», o con la de ingesta, la rama no se arma', () => {
    expect(() => injertarGuardado(flujoBase(), { ...OPC, cliente: undefined })).toThrow(/cliente/);
    expect(() => injertarGuardado(flujoBase(), { ...OPC, credenciales: { ingesta: CRED_INGESTA, rele: 'Graph de Evy' } })).toThrow(/credenciales\.rele/);
    expect(() => injertarGuardado(flujoBase(), { ...OPC, credenciales: { ingesta: CRED_INGESTA, rele: CRED_INGESTA } })).toThrow();
    expect(() => injertarGuardado(flujoBase(), { ...OPC, credenciales: { ingesta: CRED_INGESTA } })).toThrow(/credenciales\.rele/);
    expect(() => injertarGuardado(flujoBase(), { ...OPC, releUrl: 'http://x/y' })).toThrow(/releUrl/);
    // Solo el marcador (o un host *.example en las pruebas): una base real, interna o pública, no se versiona.
    for (const u of ['http://relay.internal:8080', 'http://10.0.0.5:8080', 'https://relay.example.com']) {
      expect(() => injertarGuardado(flujoBase(), { ...OPC, releUrl: u }), u).toThrow(/releUrl/);
    }
    expect(() => injertarGuardado(flujoBase(), { ...OPC, canal: 'otro' as 'rele' })).toThrow(/canal desconocido/);
    const f = flujoBase();
    f.nodes.find((n) => n.name === 'Enviar a WhatsApp')!.credentials = { httpHeaderAuth: { id: '', name: 'Graph de Evy' } };
    expect(() => injertarGuardado(f, OPC)).toThrow(/AAB1 envío/);
  });
  it('urlDescargaRele no deja colar una base con comillas', () => {
    expect(() => nodosDelGuardado({ ...OPC, releUrl: "http://x';alert(1);'", credenciales: { ingesta: CRED_INGESTA, rele: CRED_RELE }, numero: "'1'" })).toThrow(/releUrl/);
  });
});

describe('los cambios que se hagan a la rama los nota `hallazgosDelGuardado`', () => {
  const romper = (f: (fl: Flujo) => void): string[] => { const fl = flujoConGuardado(); f(fl); return hallazgosDelGuardado(fl); };
  const n = (fl: Flujo, nombre: string) => fl.nodes.find((x) => x.name === nombre)!;
  it('NIEGA: volver a Graph en cualquiera de los tres', () => {
    expect(romper((f) => { n(f, 'Pedir el medio a Meta (guardado)').parameters['url'] = '=https://graph.facebook.com/v26.0/x'; }).join('\n')).toMatch(/llama a Meta|no llama al relé|no pide/);
    expect(romper((f) => { n(f, 'Descargar medio (guardado)').parameters['url'] = URL_DESCARGA_GUARDADO; }).join('\n')).toMatch(/llama a Meta/);
    expect(romper((f) => { n(f, 'Avisar falla del guardado').parameters['url'] = '=https://graph.facebook.com/v26.0/1/messages'; }).join('\n')).toMatch(/llama a Meta|no llama al relé/);
  });
  it('NIEGA: la credencial whatsAppApi, o una que no es «AAB1 envío · …»', () => {
    expect(romper((f) => { n(f, 'Descargar medio (guardado)').credentials = { whatsAppApi: { id: '', name: 'x' } }; }).length).toBeGreaterThan(0);
    expect(romper((f) => { n(f, 'Pedir el medio a Meta (guardado)').credentials = { httpHeaderAuth: { id: '', name: 'Otra' } }; }).join('\n')).toMatch(/AAB1 envío/);
  });
  it('NIEGA: un reintento fuera de lo acordado (la espera de 3 s y 2 intentos) en la info o en el contenido', () => {
    for (const nombre of ['Pedir el medio a Meta (guardado)', 'Descargar medio (guardado)']) {
      expect(romper((f) => { n(f, nombre)['maxTries'] = 5; }).join('\n'), nombre).toMatch(/maxTries 2/);
    }
  });
  it('NIEGA: neverError en la descarga o en el aviso; un aviso sin Idempotency-Key o sin tiempo suficiente', () => {
    expect(romper((f) => { n(f, 'Descargar medio (guardado)').parameters['options'].response.response.neverError = true; }).join('\n')).toMatch(/neverError/);
    expect(romper((f) => { n(f, 'Avisar falla del guardado').parameters['options'].response = { response: { neverError: true } }; }).join('\n')).toMatch(/neverError/);
    expect(romper((f) => { n(f, 'Avisar falla del guardado').parameters['headerParameters'] = { parameters: [] }; }).join('\n')).toMatch(/Idempotency-Key/);
    expect(romper((f) => { n(f, 'Avisar falla del guardado').parameters['options'].timeout = 10000; }).join('\n')).toMatch(/30 s/);
  });
  it('NIEGA: pedir /contenido sin mirar file_size', () => {
    expect(romper((f) => { n(f, 'Descargar medio (guardado)').parameters['url'] = `=${MARCADOR_URL_DEL_RELE}/v1/envio/medios/{{ $json.id }}/contenido`; }).join('\n')).toMatch(/\/contenido solo con file_size/);
  });
});

describe('manejaMedios reconoce al relé', () => {
  const con = (url: string, metodo = 'GET'): boolean => manejaMedios({
    nodes: [{ name: 'X', type: 'n8n-nodes-base.httpRequest', parameters: { method: metodo, url } }, { name: 'Y', type: 'n8n-nodes-base.noOp', parameters: {} }],
    connections: { Y: { main: [[{ node: 'X', type: 'main', index: 0 }]] } },
  });
  it('un GET a /v1/envio/medios/<id> baja medios; el marcador o un host http(s) valen', () => {
    expect(con(`=${MARCADOR_URL_DEL_RELE}/v1/envio/medios/{{ $json.id }}`)).toBe(true);
    expect(con('=http://relay.internal:8080/v1/envio/medios/abc/contenido')).toBe(true);
  });
  it('NIEGA: la SUBIDA (POST …/medios/<pnid>) y el envío de mensajes no cuentan', () => {
    expect(con(`=${MARCADOR_URL_DEL_RELE}/v1/envio/medios/{{ $json.pn }}`, 'POST')).toBe(false);
    expect(con(`=${MARCADOR_URL_DEL_RELE}/v1/envio/mensajes/{{ $json.pn }}`)).toBe(false);
    expect(con('https://consola.example/guardarMedio')).toBe(false);
  });
  it('lo de Graph se reconoce como antes', () => {
    expect(con('=https://graph.facebook.com/v26.0/{{ $json.mediaId }}')).toBe(true);
    expect(con('=https://lookaside.fbsbx.com/x')).toBe(true);
    expect(con('=https://graph.facebook.com/v26.0/123/messages')).toBe(false);
  });
});

describe('corriendo: dos GET por medio guardado, nada a ciegas', () => {
  it('una imagen de 2 KiB: info, contenido y guardarMedio; exactamente 2 GET al relé', () => {
    const m = mundo();
    m.r(imagen());
    expect(m.llamadas.info.map((x) => x.url)).toEqual([`${MARCADOR_URL_DEL_RELE}/v1/envio/medios/M1`]);
    expect(m.llamadas.contenido.map((x) => x.url)).toEqual([`${MARCADOR_URL_DEL_RELE}/v1/envio/medios/M1/contenido`]);
    expect(m.llamadas.servidor).toHaveLength(1);
    expect(m.llamadas.info.length + m.llamadas.contenido.length).toBe(2);
    expect(m.llamadas.aviso).toHaveLength(0);
  });
  it('justo 16 MiB se baja; 16 MiB + 1 NO: sin /contenido, sin guardarMedio, y avisa a la recepción (413)', () => {
    const justo = mundo();
    justo.r(documento(), { tamano: MIB16 });
    expect(justo.llamadas.contenido.map((x) => x.url)).toHaveLength(1);
    expect(justo.llamadas.contenido[0]!.url).toMatch(/\/contenido$/);
    const mas = mundo();
    mas.r(documento(), { tamano: MIB16 + 1 });
    expect(mas.llamadas.contenido.map((x) => x.url)).toEqual(['']);
    expect(mas.llamadas.servidor).toHaveLength(0);
    expect(mas.llamadas.aviso.map((x) => x.cuerpo?.['text']?.['body'])).toEqual([AVISO('el archivo supera el tamaño permitido')]);
  });
  it('NIEGA: sin `file_size` (o en cero, o ilegible) no se baja el contenido', () => {
    for (const tamano of [null, 0, -5]) {
      const m = mundo();
      m.r(imagen(), { tamano });
      expect(m.llamadas.contenido.map((x) => x.url), String(tamano)).toEqual(['']);
      expect(m.llamadas.servidor).toHaveLength(0);
    }
    const m = mundo();
    m.r(imagen(), { info: { id: 'M1', file_size: 'grande' } });
    expect(m.llamadas.contenido.map((x) => x.url)).toEqual(['']);
  });
  it('NIEGA: un id vencido (502 WM-3040, no 404) no baja contenido, no llega a guardarMedio y la info NO se repite', () => {
    const m = mundo();
    const r = m.r(imagen(), { info: 'lanza' });
    expect(m.llamadas.info).toHaveLength(1);
    expect(m.llamadas.contenido.map((x) => x.url)).toEqual(['']);
    expect(m.llamadas.servidor).toHaveLength(0);
    expect(r.fallo).toBeNull();
  });
  it('NIEGA: un 4xx o 5xx de /contenido deja un item sin binario que no llega a guardarMedio, y nada se reintenta', () => {
    const m = mundo();
    m.r(imagen(), { contenido: 'lanza' });
    expect(m.llamadas.contenido).toHaveLength(1);
    expect(m.llamadas.servidor).toHaveLength(0);
    expect(m.llamadas.info).toHaveLength(1);
  });
  it('NIEGA: el id del medio no puede alterar la URL: uno con barras o signos no entra en la rama', () => {
    for (const id of ['../x', 'a/b', 'a?b=c', 'a b', 'x'.repeat(101), '']) {
      const m = mundo();
      m.r({ type: 'image', image: { id, mime_type: 'image/jpeg' } });
      expect(m.llamadas.info, id).toHaveLength(0);
      expect(m.llamadas.contenido, id).toHaveLength(0);
    }
  });
  it('un 413 de guardarMedio avisa a la recepción por el relé, con su clave, y el aviso va solo a la recepción', () => {
    const m = mundo();
    m.r(imagen(), { servidor: 413 });
    expect(m.llamadas.aviso).toHaveLength(1);
    const a = m.llamadas.aviso[0]!;
    expect(a.url).toBe(`${MARCADOR_URL_DEL_RELE}/v1/envio/mensajes/${PID}`);
    expect(a.encabezados['Idempotency-Key']).toBe(`${CLIENTE}-wf-de-mentira-ejecucion-de-mentira-avisoguardado-1`);
    expect(a.cuerpo).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: REC, type: 'text', text: { preview_url: false, body: AVISO('el archivo supera el tamaño permitido') } });
  });
  it('un aviso que el relé rechaza (sin neverError) deja la ejecución en error y no se reintenta', () => {
    const m = mundo();
    const r = m.r(imagen(), { servidor: 413, aviso: 'lanza' });
    expect(r.fallo?.nodo).toBe('Avisar falla del guardado');
    expect(m.llamadas.aviso).toHaveLength(1);
  });
  it('un texto, o un mensaje sin medio, no toca el relé de medios', () => {
    const m = mundo();
    m.r({ type: 'text', text: { body: 'hola' } });
    expect(m.llamadas.info.length + m.llamadas.contenido.length + m.llamadas.servidor.length).toBe(0);
  });
});

describe('cupo de descargas (500 por día y por WABA, 2 GET por medio): solo en el canal rele', () => {
  const tel = (i: number): string => `591700000${String(i).padStart(2, '0')}`;
  const D1 = Date.UTC(2026, 10, 2, 15, 0, 0);
  it('el cupo por defecto es de 10 medios por teléfono y 30 por flujo (hasta 4 GET por medio con los reintentos) (decisión de Andres, 03/11/2026)', () => {
    expect(CUPO_POR_DEFECTO_RELE).toEqual({ porTelefono: 10, global: 30 });
    expect(cabeceraDeFuentes('Carga de entrada', 'Config del negocio', {})).toContain('porTelefono: 10, global: 30');
  });
  it('NIEGA: un teléfono que manda 25 imágenes guarda 10; las 15 últimas no piden ni la info ni el contenido, y quedan contadas', () => {
    const m = mundo();
    for (let i = 0; i < 25; i++) m.r(imagen(`M${i}`), {}, tel(1));
    expect(m.llamadas.info).toHaveLength(10);
    expect(m.llamadas.contenido).toHaveLength(10);
    // Lo omitido se ve en el estado del flujo (junto a sinAcceso, sinDescarga…), sin un mensaje más.
    const hoy = '2026-11-02';
    expect((m.sd['cupoDeMedios'] as J)['omitidos']).toBe(15);
    expect(((m.sd['guardadoDeMedios'] as J)['omitidoPorCupo'] as J)).toEqual({ dia: hoy, n: 15 });
    expect(m.llamadas.aviso).toHaveLength(0);
    // Otro teléfono sigue con su propio cupo.
    m.r(imagen('OTRO'), {}, tel(2));
    expect(m.llamadas.info).toHaveLength(11);
  });
  it('NIEGA: lo que «Preparar guardado» descarta (teléfono, id de mensaje o id de medio inválidos) NO gasta cupo', () => {
    const m = mundo(flujoConGuardado({ cupo: { porTelefono: 2, global: 3 } }));
    for (let i = 0; i < 6; i++) m.r(imagen(`M${i}`), {}, '123');
    for (let i = 0; i < 6; i++) m.r(imagen('a b'), {}, tel(1));
    for (let i = 0; i < 6; i++) m.r(imagen(`N${i}`), {}, tel(2), '');
    for (let i = 0; i < 6; i++) m.r({ type: 'image', image: 'x' }, {}, tel(3));
    expect(m.llamadas.info).toHaveLength(0);
    expect((m.sd['cupoDeMedios'] as J | undefined)?.['total'] ?? 0).toBe(0);
    // El cupo sigue entero para lo válido.
    m.r(imagen('V1'), {}, tel(1));
    m.r(imagen('V2'), {}, tel(1));
    m.r(imagen('V3'), {}, tel(1));
    expect(m.llamadas.info).toHaveLength(2);
  });
  it('el cupo sin GM_CUPO definido (cabecera vieja) no revienta y usa los valores por defecto (10 y 30)', () => {
    const f = flujoConGuardado();
    const prep = f.nodes.find((n) => n.name === 'Preparar guardado')!;
    prep.parameters['jsCode'] = String(prep.parameters['jsCode']).replace(/const GM_CUPO = [^\n]*\n/, '');
    const m = mundo(f);
    for (let i = 0; i < 12; i++) m.r(imagen(`M${i}`), {}, tel(1));
    expect(m.llamadas.info).toHaveLength(10);
  });
  it('NIEGA: el tope global por flujo (30): con 3 teléfonos de 10 se agota y el cuarto ya no guarda nada', () => {
    const m = mundo();
    for (const t of [1, 2, 3]) for (let i = 0; i < 10; i++) m.r(imagen(`M${t}-${i}`), {}, tel(t));
    expect(m.llamadas.info).toHaveLength(30);
    m.r(imagen('X'), {}, tel(4));
    m.r(documento(), {}, tel(5));
    expect(m.llamadas.info).toHaveLength(30);
  });
  it('el cupo se reinicia al cambiar el día de La Paz (UTC-4), no a las 00:00 UTC', () => {
    const m = mundo();
    for (let i = 0; i < 11; i++) m.r(imagen(`M${i}`), { ahoraMs: D1 }, tel(1));
    expect(m.llamadas.info).toHaveLength(10);
    // 02/11 23:30 La Paz = 03/11 03:30 UTC: sigue siendo el mismo día del negocio.
    m.r(imagen('T'), { ahoraMs: Date.UTC(2026, 10, 3, 3, 30, 0) }, tel(1));
    expect(m.llamadas.info).toHaveLength(10);
    // 03/11 00:30 La Paz = 03/11 04:30 UTC: día nuevo.
    m.r(imagen('N'), { ahoraMs: Date.UTC(2026, 10, 3, 4, 30, 0) }, tel(1));
    expect(m.llamadas.info).toHaveLength(11);
  });
  it('NIEGA: no cuentan los textos ni lo que escribe la recepción del negocio (es la ventana de las 24 h, no un cliente)', () => {
    const m = mundo(flujoConGuardado({ cupo: { porTelefono: 3, global: 3 } }));
    for (let i = 0; i < 10; i++) m.r({ type: 'text', text: { body: 'hola' } }, {}, tel(1));
    for (let i = 0; i < 10; i++) m.r(imagen(`R${i}`), {}, REC);
    // Si los 20 anteriores hubieran contado, el cupo global de 3 estaría agotado.
    for (const t of [1, 2, 3]) m.r(imagen(`C${t}`), {}, tel(t));
    expect(m.llamadas.info).toHaveLength(3);
  });
  it('el cupo se parametriza (`cupo`) y se rechaza lo absurdo', () => {
    const m = mundo(flujoConGuardado({ cupo: { porTelefono: 2, global: 3 } }));
    for (let i = 0; i < 3; i++) m.r(imagen(`A${i}`), {}, tel(1));
    m.r(imagen('B0'), {}, tel(2));
    m.r(imagen('B1'), {}, tel(2));
    expect(m.llamadas.info).toHaveLength(3);
    for (const cupo of [{ porTelefono: 0 }, { porTelefono: 1.5 }, { global: 126 }, { global: 251 }, { porTelefono: 30, global: 20 }, { global: -1 }]) {
      expect(() => flujoConGuardado({ cupo }), JSON.stringify(cupo)).toThrow(/cupo/);
    }
    expect(() => flujoConGuardado({ cupo: { porTelefono: 10, global: 125 } })).not.toThrow();
  });
  it('NIEGA: una imagen o un sticker de más de 5 MiB no pide /contenido (el servidor la rechazaría); un documento de 6 MiB sí', () => {
    const grande = 5 * 1024 * 1024 + 1;
    const m = mundo();
    m.r(imagen(), { tamano: grande }, tel(1));
    m.r({ type: 'sticker', sticker: { id: 'S1', mime_type: 'image/webp' } }, { tamano: grande }, tel(2));
    expect(m.llamadas.contenido.map((x) => x.url)).toEqual(['', '']);
    m.r(imagen(), { tamano: 5 * 1024 * 1024 }, tel(3));
    expect(m.llamadas.contenido[2]!.url).toMatch(/\/contenido$/);
    m.r(documento(), { tamano: 6 * 1024 * 1024 }, tel(4));
    expect(m.llamadas.contenido[3]!.url).toMatch(/\/contenido$/);
  });
  it('NIEGA: el canal Graph no cambia ni un byte: sin cupo, sin GM_CUPO y con la cabecera de siempre', () => {
    const f = flujoBase();
    f.nodes.find((n) => n.name === 'Obtener URL del medio (general)')!.parameters['url'] = '=https://graph.facebook.com/v26.0/{{ $json.id }}';
    f.nodes.find((n) => n.name === 'Enviar a WhatsApp')!.credentials = { httpHeaderAuth: { id: '', name: 'Graph de prueba' } };
    f.nodes.push({ name: 'Descargar medio', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [400, 300], parameters: {}, credentials: { httpHeaderAuth: { id: '', name: 'Graph de prueba' } } } as never);
    injertarGuardado(f, { guardarUrl: GUARDAR });
    const js = String(f.nodes.find((n) => n.name === 'Preparar guardado')!.parameters['jsCode']);
    expect(js).toBe(`${cabeceraDeFuentes('Carga de entrada', 'Config del negocio')}\n\n${FUENTE_PREPARAR}\n`);
    expect(js).not.toMatch(/GM_CUPO|cupoDeMedios/);
    expect(cabeceraDeFuentes('Carga de entrada', 'Config del negocio')).not.toContain('GM_CUPO');
  });
  it('NIEGA: sin el cupo el canal rele no pasa `hallazgosDelGuardado`', () => {
    const f = flujoConGuardado();
    const prep = f.nodes.find((n) => n.name === 'Preparar guardado')!;
    prep.parameters['jsCode'] = String(prep.parameters['jsCode']).replace(FUENTE_CUPO, '');
    expect(hallazgosDelGuardado(f).join('\n')).toMatch(/cupo/);
  });
  it('el cupo no usa nada que el Code de n8n no tenga', () => {
    expect(FUENTE_CUPO.replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/\b(require|URL|URLSearchParams|Buffer|crypto|process|setTimeout|fetch)\b/);
  });
  it('NIEGA: `hallazgosDelGuardado` revisa la cabecera, las constantes y el ORDEN (cabecera + cupo + preparar), no solo que el cupo esté', () => {
    const rompe = (f: (js: string) => string): string => {
      const fl = flujoConGuardado();
      const prep = fl.nodes.find((n) => n.name === 'Preparar guardado')!;
      prep.parameters['jsCode'] = f(String(prep.parameters['jsCode']));
      return hallazgosDelGuardado(fl).join('\n');
    };
    expect(hallazgosDelGuardado(flujoConGuardado())).toEqual([]);
    // Sin la constante GM_CUPO.
    expect(rompe((js) => js.replace(/const GM_CUPO = [^\n]*\n/, ''))).toMatch(/cabecera de fuentes que define GM_FUENTES y GM_CUPO/);
    // Constantes fuera de rango.
    expect(rompe((js) => js.replace(/porTelefono: \d+, global: \d+/, 'porTelefono: 0, global: 60'))).toMatch(/fuera de rango/);
    expect(rompe((js) => js.replace(/porTelefono: \d+, global: \d+/, 'porTelefono: 90, global: 60'))).toMatch(/fuera de rango/);
    expect(rompe((js) => js.replace(/porTelefono: \d+, global: \d+/, 'porTelefono: 10, global: 9999'))).toMatch(/fuera de rango/);
    expect(rompe((js) => js.replace(/porTelefono: \d+, global: \d+/, 'porTelefono: 10, global: 126'))).toMatch(/fuera de rango/);
    // El cupo DESPUÉS de preparar.
    expect(rompe((js) => js.replace(FUENTE_CUPO, '').replace(FUENTE_PREPARAR, `${FUENTE_PREPARAR}\n\n${FUENTE_CUPO}`))).toMatch(/ANTES de guardado-preparar|DESPUÉS del cupo/);
    // Algo entre la cabecera y el cupo.
    expect(rompe((js) => js.replace(FUENTE_CUPO, `// nada\n\n${FUENTE_CUPO}`))).toMatch(/justo después de la cabecera/);
    // Sin cabecera.
    expect(rompe((js) => js.slice(js.indexOf(FUENTE_CUPO)))).toMatch(/cabecera/);
  });
});

describe('manejaMedios no se esconde tras una URL del relé con otra forma (segunda revisión del PR #757)', () => {
  const conUrl = (url: string, metodo = 'GET'): Flujo => {
    const f = flujoBase();
    // Con otro nombre: manejaMedios tiene que mirar la URL y el método, no el nombre del nodo.
    const n = f.nodes.find((x) => x.name === 'Obtener URL del medio (general)')!;
    n.name = 'Llamar al relé';
    n.parameters = { method: metodo, url };
    (f.connections['Reportar mensaje (entrante)'] as J)['main'] = [[{ node: 'Llamar al relé', type: 'main', index: 0 }]];
    return f;
  };
  it('detecta la base marcador, una calculada, con ruta, con usuario, con puerto y con expresión', () => {
    for (const u of [
      `=${MARCADOR_URL_DEL_RELE}/v1/envio/medios/{{ $json.id }}`,
      '={{ $json.base }}/v1/envio/medios/{{ $json.id }}',
      '=https://h/api/v1/envio/medios/{{ $json.id }}',
      '=https://usuario@host/v1/envio/medios/{{ $json.id }}',
      '=https://usuario:clave@host:8443/prefijo/v1/envio/medios/abc',
      "={{ $('Config del negocio').first().json.releUrl }}/v1/envio/medios/{{ $json.id }}",
      'http://relay/v1/envio/medios/abc/contenido',
    ]) expect(manejaMedios(conUrl(u)), u).toBe(true);
  });
  it('NIEGA: la subida (POST) y otras rutas del relé no cuentan como bajar un medio', () => {
    expect(manejaMedios(conUrl('=https://h/v1/envio/medios/123', 'POST'))).toBe(false);
    expect(manejaMedios(conUrl('=https://h/v1/envio/mensajes/123'))).toBe(false);
  });
});

describe('el canal Graph no cambia', () => {
  it('por defecto sigue hablando con Graph y su CDN, con retryOnFail en la info', () => {
    const f = flujoBase();
    f.nodes.find((n) => n.name === 'Obtener URL del medio (general)')!.parameters['url'] = '=https://graph.facebook.com/v26.0/{{ $json.id }}';
    f.nodes.find((n) => n.name === 'Enviar a WhatsApp')!.credentials = { httpHeaderAuth: { id: '', name: 'Graph de prueba' } };
    f.nodes.push({ name: 'Descargar medio', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [400, 300], parameters: {}, credentials: { httpHeaderAuth: { id: '', name: 'Graph de prueba' } } } as never);
    injertarGuardado(f, { guardarUrl: GUARDAR });
    const pedir = f.nodes.find((n) => n.name === 'Pedir el medio a Meta (guardado)')!;
    expect(String(pedir.parameters['url'])).toContain('graph.facebook.com');
    expect((pedir as J)['retryOnFail']).toBe(true);
    expect(f.nodes.find((n) => n.name === 'Descargar medio (guardado)')!.parameters['url']).toBe(URL_DESCARGA_GUARDADO);
    expect(hallazgosDelGuardado(f)).toEqual([]);
  });
  it('una URL de relé sigue sin ser un pedido a Meta para el resto: urlInfoRele y urlDescargaRele llevan el marcador por defecto', () => {
    expect(urlInfoRele()).toContain(MARCADOR_URL_DEL_RELE);
    expect(urlDescargaRele()).toContain(`'${MARCADOR_URL_DEL_RELE}/v1/envio/medios/'`);
  });
});

describe('reintento propio de los dos GET de medios por el relé: 0 nodos nuevos (PR #757, ronda 3b)', () => {
  const GETS = ['Pedir el medio a Meta (guardado)', 'Descargar medio (guardado)'];
  const nodoDe = (f: Flujo, nombre: string) => f.nodes.find((n) => n.name === nombre)! as unknown as J;
  it('la rama del relé sigue con sus nueve nodos y la info y el contenido llevan retryOnFail, maxTries 2 y 3000 ms', () => {
    const f = flujoConGuardado();
    expect(f.nodes.length).toBe(flujoBase().nodes.length + 9);
    expect(hallazgosDelGuardado(f)).toEqual([]);
    expect(REINTENTO_GET_RELE).toEqual({ retryOnFail: true, maxTries: 2, waitBetweenTries: 3000 });
    for (const nombre of GETS) {
      const n = nodoDe(f, nombre);
      expect(n['retryOnFail'], nombre).toBe(true);
      expect(n['maxTries'], nombre).toBe(2);
      expect(n['waitBetweenTries'], nombre).toBeGreaterThanOrEqual(2000);
      expect(n['waitBetweenTries'], nombre).toBeLessThanOrEqual(3000);
    }
  });
  it('la descarga de /contenido sigue sin seguir redirecciones; el guardado, el reintento y el aviso no reintentan por su cuenta', () => {
    const f = flujoConGuardado();
    expect(nodoDe(f, 'Descargar medio (guardado)')['parameters'].options.redirect).toEqual({ redirect: { followRedirects: false } });
    for (const nombre of ['Guardar medio', 'Reintentar el guardado', 'Avisar falla del guardado']) expect(nodoDe(f, nombre)['retryOnFail'], nombre).toBeUndefined();
  });
  it('NIEGA: sin el reintento, con otro número de intentos o con otra espera, `hallazgosDelGuardado` se queja', () => {
    for (const nombre of GETS) {
      for (const cambio of [{ retryOnFail: undefined }, { maxTries: 3 }, { waitBetweenTries: 1000 }, { waitBetweenTries: 5000 }] as const) {
        const f = flujoConGuardado();
        Object.assign(nodoDe(f, nombre), cambio);
        expect(hallazgosDelGuardado(f).join('\n'), `${nombre} ${JSON.stringify(cambio)}`).toMatch(/retryOnFail, maxTries 2 y waitBetweenTries/);
      }
    }
    for (const nombre of GETS) {
      const g = flujoConGuardado();
      expect(nodoDe(g, nombre)['parameters'].options.redirect, nombre).toEqual({ redirect: { followRedirects: false } });
      nodoDe(g, nombre)['parameters'].options.redirect = { redirect: { followRedirects: true } };
      expect(hallazgosDelGuardado(g).join('\n'), nombre).toContain(`guardado: «${nombre}» no puede seguir redirecciones`);
      const h = flujoConGuardado();
      delete nodoDe(h, nombre)['parameters'].options.redirect;
      expect(hallazgosDelGuardado(h).join('\n'), nombre).toMatch(/no puede seguir redirecciones/);
    }
  });
  it('NIEGA: el aviso no reintenta (un aviso repetido llegaría dos veces)', () => {
    const f = flujoConGuardado();
    nodoDe(f, 'Avisar falla del guardado')['retryOnFail'] = true;
    expect(hallazgosDelGuardado(f).join('\n')).toMatch(/no reintenta/);
  });
  it('el canal Graph no cambia: la descarga no reintenta y la info conserva su reintento de siempre (1000 ms)', () => {
    const f = flujoBase();
    f.nodes.find((n) => n.name === 'Obtener URL del medio (general)')!.parameters['url'] = '=https://graph.facebook.com/v26.0/{{ $json.id }}';
    f.nodes.find((n) => n.name === 'Enviar a WhatsApp')!.credentials = { httpHeaderAuth: { id: '', name: 'Graph de prueba' } };
    f.nodes.push({ name: 'Descargar medio', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [400, 300], parameters: {}, credentials: { httpHeaderAuth: { id: '', name: 'Graph de prueba' } } } as never);
    injertarGuardado(f, { guardarUrl: GUARDAR });
    expect(nodoDe(f, 'Descargar medio (guardado)')['retryOnFail']).toBeUndefined();
    expect(nodoDe(f, 'Pedir el medio a Meta (guardado)')['waitBetweenTries']).toBe(1000);
  });
});

describe('falla cerrado si falta el límite de tamaño (GM_LIMITE) y el cupo cuenta un voice con solo la clave audio (PR #757, ronda 3)', () => {
  it('NIEGA: sin `limite` en «Preparar guardado» (NaN) NO se descarga nada, aunque la info traiga un tamaño', () => {
    const f = flujoConGuardado();
    const prep = f.nodes.find((n) => n.name === 'Preparar guardado')!;
    const js = String(prep.parameters['jsCode']);
    expect(js).toContain('limite: GM_LIMITE,');
    prep.parameters['jsCode'] = js.replace('limite: GM_LIMITE,', '');
    const m = mundo(f);
    m.r(imagen());
    expect(m.llamadas.info).toHaveLength(1);
    expect(m.llamadas.contenido.map((x) => x.url)).toEqual(['']);
    expect(m.llamadas.servidor).toHaveLength(0);
  });
  it('NIEGA: con `limite` no numérico tampoco; con el límite puesto sí se baja', () => {
    const f = flujoConGuardado();
    const prep = f.nodes.find((n) => n.name === 'Preparar guardado')!;
    prep.parameters['jsCode'] = String(prep.parameters['jsCode']).replace('limite: GM_LIMITE,', "limite: 'mucho',");
    const m = mundo(f);
    m.r(imagen());
    expect(m.llamadas.contenido.map((x) => x.url)).toEqual(['']);
    const bien = mundo();
    bien.r(imagen());
    expect(bien.llamadas.contenido[0]!.url).toMatch(/\/contenido$/);
  });
  const voz = (id: string): J => ({ type: 'voice', audio: { id, mime_type: 'audio/ogg' } });
  it('un mensaje `voice` con SOLO la clave audio se guarda y gasta cupo: con 12 del mismo teléfono se guardan 10', () => {
    const m = mundo();
    for (let i = 0; i < 12; i++) m.r(voz(`V${i}`), {}, '59170000001', `wamid.V${i}`);
    expect(m.llamadas.info).toHaveLength(10);
    expect(m.llamadas.servidor).toHaveLength(10);
  });
  it('y al revés: un `audio` con solo la clave voice gasta cupo igual', () => {
    const m = mundo();
    for (let i = 0; i < 12; i++) m.r({ type: 'audio', voice: { id: `V${i}`, mime_type: 'audio/ogg' } }, {}, '59170000002', `wamid.W${i}`);
    expect(m.llamadas.info).toHaveLength(10);
  });
});
