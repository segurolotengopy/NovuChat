/**
 * `Flujos/vigilancia-numero-demos.json`: avisa si el número de Demo A o de Demo B deja de existir en Meta.
 *
 * Por qué existe (decisión de Andres, 14/11/2026, sobre la sección 8 del diseño del monitor de n8n): el 13/11 un
 * número de prueba de Meta dejó de existir y nada lo avisó. n8n sigue respondiendo; lo que cambia es el registro del
 * número en Meta. Lee `GET /{phone-number-id}?fields=status` con la credencial PROPIA de cada demo (la misma que el
 * flujo del demo ya usa para enviar) y avisa a un chequeo externo: «bien», «falló» (con la causa) o silencio.
 *
 * Se prueba NEGANDO:
 *  - solo LEE: el único POST del flujo es el aviso al chequeo externo; ningún nodo de WhatsApp ni envío (0 mensajes);
 *  - cada demo se consulta con SU credencial y ninguna otra;
 *  - un error temporal de Meta o de la red no es un veredicto: ni «falló» ni «bien», solo silencio;
 *  - lo que dice Meta (cuerpos, mensajes, ids, trazas) nunca llega al texto que sale a un tercero;
 *  - ningún id, host ni UUID real en el repositorio público.
 */
import { describe, expect, it } from 'vitest';
import { codigoDe, destinos, ejecutar, leerFlujo, nodo, textoDeFlujo } from '../lib/flujo';

const f = leerFlujo('vigilancia-numero-demos.json');
const texto = textoDeFlujo('vigilancia-numero-demos.json');
const codigo = codigoDe(f, 'Evaluar números');
const A = 'Consultar número Demo A';
const B = 'Consultar número Demo B';
const PING = 'https://hc-ping.com/REEMPLAZAR_ID_PING_NUMERO_DEMOS';

type Resp = Record<string, unknown>;
const respuesta = (statusCode: number, body: unknown): Resp => ({ statusCode, body, headers: {} });
// Armados por partes: una secuencia larga de dígitos en el repositorio público la rechaza el saneo.
const ID_FALSO = ['1010', '1010', '1010', '10'].join('');
const TEL_FALSO = ['5491', '1000', '0000'].join('');
const BIEN = respuesta(200, { status: 'CONNECTED', id: ID_FALSO });
const eMeta = (http: number, code: number, extra: Record<string, unknown> = {}): Resp =>
  respuesta(http, { error: { message: 'Unsupported get request. Object with ID does not exist', type: 'GraphMethodException', code, ...extra } });

/** Corre el nodo con la respuesta de cada demo y devuelve los items que emite (vacío = silencio). */
const evaluar = (a: Resp | undefined, b: Resp | undefined) => {
  const referencias: Record<string, Record<string, unknown>> = { 'Config base': { urlPing: PING } };
  if (a !== undefined) referencias[A] = a;
  if (b !== undefined) referencias[B] = b;
  return ejecutar(codigo, [{}], referencias);
};

describe('flujo «Vigilancia del número de los demos»: forma', () => {
  it('son exactamente seis nodos, en fila: disparar, configurar, consultar A, consultar B, evaluar, avisar', () => {
    expect(f.nodes.map((n: { name: string }) => n.name)).toEqual([
      'Cada 6 horas', 'Config base', A, B, 'Evaluar números', 'Avisar al monitor externo',
    ]);
    expect(destinos(f, 'Cada 6 horas')).toEqual(['Config base']);
    expect(destinos(f, 'Config base')).toEqual([A]);
    expect(destinos(f, A)).toEqual([B]);
    expect(destinos(f, B)).toEqual(['Evaluar números']);
    expect(destinos(f, 'Evaluar números')).toEqual(['Avisar al monitor externo']);
    expect(destinos(f, 'Avisar al monitor externo')).toEqual([]);
  });

  it('corre cada 6 horas', () => {
    expect(nodo(f, 'Cada 6 horas').parameters.rule.interval).toEqual([{ field: 'hours', hoursInterval: 6 }]);
  });

  it('«Config base» lleva SOLO marcadores: el ping, la versión de Graph de los demos y los dos ids de número', () => {
    const a = nodo(f, 'Config base').parameters.assignments.assignments as Array<{ name: string; value: string }>;
    expect(Object.fromEntries(a.map((x) => [x.name, x.value]))).toEqual({
      urlPing: PING,
      waGraphVersion: 'v26.0',
      phoneNumberIdA: 'REEMPLAZAR_PHONE_NUMBER_ID',
      phoneNumberIdB: 'REEMPLAZAR_PHONE_NUMBER_ID_B',
    });
    // Lo mismo que usan los flujos de los demos: la misma versión de Graph y los mismos marcadores.
    expect(configDe('demo-a-agendamiento.json')).toMatchObject({ waGraphVersion: 'v26.0', phoneNumberId: 'REEMPLAZAR_PHONE_NUMBER_ID' });
    expect(configDe('demo-b-venta-cobro.json')).toMatchObject({ waGraphVersion: 'v26.0', phoneNumberId: 'REEMPLAZAR_PHONE_NUMBER_ID_B' });
  });

  it('ningún valor real en el repositorio: solo marcadores, ningún UUID y solo dos hosts', () => {
    expect([...new Set(texto.match(/REEMPLAZAR_[A-Z0-9_]+/g))].sort()).toEqual([
      'REEMPLAZAR_ID_PING_NUMERO_DEMOS', 'REEMPLAZAR_PHONE_NUMBER_ID', 'REEMPLAZAR_PHONE_NUMBER_ID_B',
    ]);
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(texto).not.toMatch(/[0-9]{10,}/);
    expect([...new Set(texto.match(/https?:\/\/[^"/\s{]+/g))].sort()).toEqual(['https://graph.facebook.com', 'https://hc-ping.com']);
  });
});

function configDe(archivo: string): Record<string, string> {
  const a = nodo(leerFlujo(archivo), archivo.startsWith('demo-a-agendamiento') ? 'Config base' : 'Config base')
    .parameters.assignments.assignments as Array<{ name: string; value: string }>;
  return Object.fromEntries(a.map((x) => [x.name, x.value]));
}

describe('flujo «Vigilancia del número de los demos»: solo lee, con la credencial de cada demo', () => {
  it('cada consulta es un GET a graph.facebook.com pidiendo solo `status`, sin cuerpo, sin redirecciones y sin fallar por el código HTTP', () => {
    for (const [nombre, idvar] of [[A, 'phoneNumberIdA'], [B, 'phoneNumberIdB']] as const) {
      const n = nodo(f, nombre);
      expect(n.parameters.method).toBe('GET');
      expect(n.parameters.url).toBe(
        `=https://graph.facebook.com/{{ $('Config base').first().json.waGraphVersion }}/{{ $('Config base').first().json.${idvar} }}`,
      );
      expect(n.parameters.queryParameters.parameters).toEqual([{ name: 'fields', value: 'status' }]);
      expect(n.parameters.sendBody).toBeUndefined();
      expect(n.parameters.sendHeaders).toBeUndefined();
      expect(n.parameters.options.redirect.redirect.followRedirects).toBe(false);
      expect(n.parameters.options.response.response).toEqual({ fullResponse: true, neverError: true });
      expect(n.parameters.options.timeout).toBe(10000);
      // Un error de red no corta el flujo: sale como «sin veredicto».
      expect(n.onError).toBe('continueRegularOutput');
      expect(n.retryOnFail).toBe(true);
      expect(n.maxTries).toBe(3);
    }
  });

  it('cada demo usa SU credencial de WhatsApp (por nombre, sin id) y ninguna otra', () => {
    expect(nodo(f, A).credentials).toEqual({ whatsAppApi: { id: '', name: 'WhatsApp account' } });
    expect(nodo(f, B).credentials).toEqual({ whatsAppApi: { id: '', name: 'WhatsApp account 2' } });
    expect(nodo(f, A).parameters.nodeCredentialType).toBe('whatsAppApi');
    // Son las mismas credenciales que ya usan los nodos de envío de cada demo.
    const usa = (archivo: string, nombre: string) =>
      leerFlujo(archivo).nodes.some((n: { credentials?: Record<string, { name?: string }> }) => n.credentials?.whatsAppApi?.name === nombre);
    expect(usa('demo-b-venta-cobro.json', 'WhatsApp account 2')).toBe(true);
    // El Demo A deja el nombre vacío (se resuelve por tipo de su flujo de referencia): su nombre vivo es «WhatsApp account».
    expect(usa('demo-a-agendamiento.json', 'WhatsApp account 2')).toBe(false);
  });

  it('0 mensajes de WhatsApp: ningún nodo de WhatsApp, ningún envío, y el ÚNICO POST es el aviso al chequeo externo', () => {
    for (const n of f.nodes) expect(n.type, n.name).not.toMatch(/whatsApp|langchain|webhook/i);
    expect(texto).not.toMatch(/messaging_product|\/messages|subscribed_apps|\/subscriptions|register|message_templates/);
    const posts = f.nodes.filter((n: { parameters: { method?: string } }) => n.parameters.method === 'POST').map((n: { name: string }) => n.name);
    expect(posts).toEqual(['Avisar al monitor externo']);
    const ping = nodo(f, 'Avisar al monitor externo');
    expect(ping.credentials).toBeUndefined();
    expect(ping.parameters.url).toBe("={{ $json.urlPing + ($json.destino === 'fail' ? '/fail' : '') }}");
    expect(ping.parameters.body).toBe('={{ $json.cuerpo }}');
    expect(ping.parameters.options.redirect.redirect.followRedirects).toBe(false);
  });

  it('no guarda ejecuciones (el token y el cuerpo de Meta no quedan), no cuelga del errorWorkflow y cabe en su tiempo', () => {
    expect(f.settings).toEqual({
      executionOrder: 'v1', timezone: 'America/La_Paz', executionTimeout: 180,
      saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false,
    });
    // Peor caso: 2 consultas × (3 intentos × 10 s + 2 esperas × 3 s) + aviso (3 × 10 s + 2 × 5 s) = 112 s.
    expect(f.settings.executionTimeout).toBeGreaterThanOrEqual(2 * (3 * 10 + 2 * 3) + (3 * 10 + 2 * 5));
  });
});

describe('«Evaluar números»: qué es un veredicto y qué no', () => {
  it('los dos CONNECTED: «ok», con el texto fijo y la URL de ping de «Config base»', () => {
    expect(evaluar(BIEN, BIEN)).toEqual([{ destino: 'ok', cuerpo: 'Demo A: ok | Demo B: ok', urlPing: PING }]);
  });

  it('el número no existe: error 100 de Meta (código y subcódigo 33) => falla, con la causa y SOLO del demo afectado', () => {
    const r = evaluar(eMeta(400, 100, { error_subcode: 33 }), BIEN);
    expect(r).toEqual([{ destino: 'fail', cuerpo: 'Demo A: no_existe_o_sin_acceso | Demo B: ok', urlPing: PING }]);
    expect(evaluar(BIEN, eMeta(400, 100, { error_subcode: 33 }))[0]?.cuerpo).toBe('Demo A: ok | Demo B: no_existe_o_sin_acceso');
    // Meta usa el mismo código si el token no puede leerlo: el texto lo dice, no afirma que «no existe».
    expect(r[0]?.cuerpo).toContain('no_existe_o_sin_acceso');
  });

  it('otro estado distinto de CONNECTED: falla con el estado, pero solo si es una palabra en mayúsculas', () => {
    for (const estado of ['DISCONNECTED', 'PENDING', 'DELETED', 'MIGRATED', 'BANNED', 'RESTRICTED', 'FLAGGED', 'RATE_LIMITED', 'UNKNOWN']) {
      expect(evaluar(respuesta(200, { status: estado }), BIEN)[0]).toMatchObject({ destino: 'fail', cuerpo: `Demo A: estado_${estado} | Demo B: ok` });
    }
    for (const raro of ['connected', 'CONNECTED ', 'X', 'A'.repeat(31), 'CONNECTED\n- @todos', '<b>', 'ok; rm -rf']) {
      expect(evaluar(respuesta(200, { status: raro }), BIEN)[0]?.cuerpo, raro).toBe('Demo A: estado_otro | Demo B: ok');
    }
  });

  it('200 sin `status` o con un cuerpo que no es un objeto: falla como «respuesta_sin_estado»', () => {
    for (const body of [{}, { id: '1' }, { status: 7 }, { status: null }, 'CONNECTED', [], null]) {
      expect(evaluar(respuesta(200, body), BIEN)[0]?.cuerpo, JSON.stringify(body)).toBe('Demo A: respuesta_sin_estado | Demo B: ok');
    }
  });

  it('token vencido o inválido (190) y errores de permiso (10, 200 a 299) tienen su causa; un 401/403 sin código es «token»', () => {
    expect(evaluar(eMeta(400, 190), BIEN)[0]?.cuerpo).toBe('Demo A: token | Demo B: ok');
    expect(evaluar(eMeta(401, 190), BIEN)[0]?.cuerpo).toBe('Demo A: token | Demo B: ok');
    for (const c of [10, 200, 283, 299]) expect(evaluar(eMeta(403, c), BIEN)[0]?.cuerpo, String(c)).toBe('Demo A: permiso | Demo B: ok');
    for (const h of [401, 403]) expect(evaluar(respuesta(h, {}), BIEN)[0]?.cuerpo, String(h)).toBe('Demo A: token | Demo B: ok');
  });

  it('un error de Meta que no se reconoce falla como «error_de_meta», sin copiar su mensaje', () => {
    expect(evaluar(respuesta(404, { error: { code: 803, message: 'mensaje-que-no-sale' } }), BIEN)[0]?.cuerpo).toBe('Demo A: error_de_meta | Demo B: ok');
    expect(evaluar(respuesta(400, 'texto'), BIEN)[0]?.cuerpo).toBe('Demo A: error_de_meta | Demo B: ok');
  });

  it('un error TEMPORAL no es un veredicto: sin falla en el otro demo, no sale NADA (el silencio lo vigila el chequeo externo)', () => {
    const temporales: Array<[string, Resp | undefined]> = [
      ['500', respuesta(500, {})], ['502', respuesta(502, '<html>')], ['503', respuesta(503, {})], ['429', respuesta(429, {})],
      ['código 1', eMeta(400, 1)], ['código 2', eMeta(500, 2)], ['código 4', eMeta(400, 4)], ['código 17', eMeta(400, 17)],
      ['código 32', eMeta(400, 32)], ['código 613', eMeta(400, 613)], ['código 80007', eMeta(400, 80007)],
      ['red (sin código HTTP)', { error: 'ECONNRESET' }], ['red con texto', { error: 'getaddrinfo ENOTFOUND' }],
      ['vacío', {}], ['el nodo no corrió', undefined],
    ];
    for (const [nombre, t] of temporales) {
      expect(evaluar(t, BIEN), nombre).toEqual([]);
      expect(evaluar(BIEN, t), nombre).toEqual([]);
      expect(evaluar(t, t), nombre).toEqual([]);
    }
  });

  it('una falla real PESA MÁS que la duda del otro demo: avisa «falló» aunque el otro no haya podido consultarse', () => {
    expect(evaluar(eMeta(400, 100), respuesta(503, {}))[0]).toMatchObject({ destino: 'fail', cuerpo: 'Demo A: no_existe_o_sin_acceso | Demo B: transitorio' });
    expect(evaluar({ error: 'ECONNRESET' }, respuesta(200, { status: 'DISCONNECTED' }))[0]).toMatchObject({ destino: 'fail' });
  });

  it('nada de lo que dice Meta llega al texto: ni mensajes, ni ids, ni trazas, ni tokens', () => {
    const SECRETOS = ['EAAB-token-falso', TEL_FALSO, 'fbtrace-falso', 'mensaje-de-meta', 'Nombre del negocio', 'GraphMethodException'];
    const sucia = respuesta(400, {
      status: 'CONNECTED-no',
      error: { message: 'mensaje-de-meta EAAB-token-falso', type: 'GraphMethodException', code: 100, error_subcode: 33, fbtrace_id: 'fbtrace-falso', error_data: { phone: TEL_FALSO } },
      verified_name: 'Nombre del negocio', display_phone_number: TEL_FALSO,
    });
    for (const r of [evaluar(sucia, BIEN), evaluar(BIEN, sucia), evaluar(sucia, sucia)]) {
      const salida = JSON.stringify(r);
      for (const s of SECRETOS) expect(salida, s).not.toContain(s);
      // Solo el vocabulario cerrado y los nombres fijos.
      expect(r[0]?.cuerpo).toMatch(/^Demo A: [a-zA-Z_]+ \| Demo B: [a-zA-Z_]+$/);
      expect(Object.keys(r[0] ?? {}).sort()).toEqual(['cuerpo', 'destino', 'urlPing']);
    }
  });

  it('la salida del demo A no se confunde con la del B (cada uno se lee de SU nodo)', () => {
    expect(evaluar(BIEN, respuesta(200, { status: 'DISCONNECTED' }))[0]?.cuerpo).toBe('Demo A: ok | Demo B: estado_DISCONNECTED');
    expect(evaluar(respuesta(200, { status: 'DISCONNECTED' }), BIEN)[0]?.cuerpo).toBe('Demo A: estado_DISCONNECTED | Demo B: ok');
  });
});
