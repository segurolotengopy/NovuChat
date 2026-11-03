/**
 * LA CADENA DE ENVÍO POR EL RELÉ, CORRIENDO (P2 del plan del 02/11/2026) en el n8n de mentira, contra un doble del relé B9.
 *
 *   - Idempotency-Key = cliente-ejecución-rol-n: la MISMA en cada reintento del mismo mensaje, distinta entre mensajes y entre ejecuciones;
 *   - 504 WM-3041 nunca se reenvía, sin respaldo y sin reporte; 429 espera 61 a 64 s UNA vez; 409 hasta 2 veces; reintentable 2 veces;
 *   - un rechazo conocido va a respaldo (un solo intento); lo incierto no se respalda ni se reporta;
 *   - el cuerpo: sin `link`, `to` sin «+», sin claves ajenas, hasta 64 KiB; sin `n` no sale nada;
 *   - 0 mensajes por conversación agregados: los mensajes que salen son los armados, con o sin reintentos;
 *   - ningún nodo habla con Graph, su CDN ni la credencial `whatsAppApi`; la URL del relé es solo el marcador.
 */
import { describe, expect, it } from 'vitest';
import { nodosDeEnvio, injertar, llamaANumerar, MARCADOR_URL_DEL_RELE, NODOS_DEL_ENVIO_RELE } from '../../../../Flujos/experimental/comun-sin-agente/src/envio.mjs';
import { CLIENTE, WF, CRED_INGESTA, CRED_RELE, MENSAJES_JS, OPC_RELE, falla, flujoConCadena, mensaje, mundoRele, ok, turno, type Envio } from './ayuda';
import { crearMundo } from '../../lib/n8n-de-mentira';
import type { J } from '../../lib/flujo';

const Q = 'Enviar a WhatsApp';
const R = 'Enviar respaldo';
const contiene = (e: Envio[], clave: string) => e.filter((x) => x.clave === clave);

describe('la forma de la cadena del relé', () => {
  const cadena = nodosDeEnvio(OPC_RELE);
  it('son 8 nodos: DOS más que la cadena de Graph (D1), y «¿Falló el envío?» ya no existe', () => {
    const graph = nodosDeEnvio({ credenciales: { graph: 'G', ingesta: 'I' }, ingestaUrl: 'https://i.example/x' });
    expect(graph.nodes).toHaveLength(6);
    expect(cadena.nodes.map((n) => n.name)).toEqual(NODOS_DEL_ENVIO_RELE);
    expect(cadena.nodes).toHaveLength(graph.nodes.length + 2);
    expect(cadena.nodes.some((n) => n.name === '¿Falló el envío?')).toBe(false);
  });
  it('los nombres y los ids no se repiten', () => {
    expect(new Set(cadena.nodes.map((n) => n.name)).size).toBe(cadena.nodes.length);
    expect(new Set(cadena.nodes.map((n) => n.id)).size).toBe(cadena.nodes.length);
  });
  it('el bucle: Enviar → Leer → Qué hacer → (Esperar → Enviar | Respaldo | listo)', () => {
    const c = cadena.connections;
    const a = (n: string, i = 0) => (c[n]?.main[i] ?? []).map((x) => x.node);
    expect(a('¿Enviar de verdad?', 0)).toEqual([Q]);
    expect(a(Q)).toEqual(['Leer respuesta del relé']);
    expect(a('Leer respuesta del relé')).toEqual(['¿Qué hacer con el envío?']);
    expect(a('¿Qué hacer con el envío?', 0)).toEqual(['Esperar reintento']);
    expect(a('¿Qué hacer con el envío?', 1)).toEqual([R]);
    expect(a('¿Qué hacer con el envío?', 2)).toEqual(['¿Reportar? (saliente)']);
    expect(a('Esperar reintento')).toEqual([Q]);
    expect(a(R)).toEqual(['¿Reportar? (saliente)']);
  });
  it('NIEGA: ni «Enviar a WhatsApp» ni el respaldo reintentan por su cuenta (retryOnFail repetiría un 504)', () => {
    for (const n of cadena.nodes) if (n.name === Q || n.name === R) expect(n['retryOnFail'], n.name).toBeUndefined();
  });
  it('los dos envíos: Header Auth «AAB1 envío · alias», 30 s, neverError SIN fullResponse, sin aborto, lote de 1 con 1,5 s', () => {
    for (const nombre of [Q, R]) {
      const n = cadena.nodes.find((x) => x.name === nombre)!;
      expect(n.credentials).toEqual({ httpHeaderAuth: { id: '', name: CRED_RELE } });
      expect(n.parameters['genericAuthType']).toBe('httpHeaderAuth');
      expect(n.parameters['options'].timeout).toBeGreaterThanOrEqual(30000);
      expect(n.parameters['options'].response).toEqual({ response: { neverError: true } });
      expect(n.parameters['options'].batching).toEqual({ batch: { batchSize: 1, batchInterval: 1500 } });
      expect(n['onError']).toBe('continueRegularOutput');
      expect(n.parameters['headerParameters'].parameters.map((h: J) => h['name'])).toEqual(['Idempotency-Key']);
    }
  });
  it('«Esperar reintento» es un Wait por intervalo en segundos, bajo los 65 s en que n8n deja de esperar en memoria', () => {
    const w = cadena.nodes.find((n) => n.name === 'Esperar reintento')!;
    expect(w.type).toBe('n8n-nodes-base.wait');
    expect(w.parameters).toMatchObject({ resume: 'timeInterval', unit: 'seconds' });
  });
  it('la Switch tiene 3 salidas: reintentar, respaldo y el resto', () => {
    const s = cadena.nodes.find((n) => n.name === '¿Qué hacer con el envío?')!;
    expect(s.parameters['rules'].values.map((v: J) => v['outputKey'])).toEqual(['reintentar', 'respaldo']);
    expect(s.parameters['options'].fallbackOutput).toBe('extra');
  });
  it('NIEGA: ningún nodo habla con Graph, su CDN ni la credencial whatsAppApi, ni lleva una URL real', () => {
    const texto = JSON.stringify(cadena);
    expect(texto).not.toMatch(/graph\.facebook\.com|lookaside|fbsbx|whatsAppApi|predefinedCredentialType/);
    for (const nombre of [Q, R]) {
      const url = String(cadena.nodes.find((x) => x.name === nombre)!.parameters['url']);
      expect(url.startsWith(`=${MARCADOR_URL_DEL_RELE}/v1/envio/mensajes/`)).toBe(true);
    }
    // Lo único que no es el marcador es la URL de la ingesta, que es de la consola.
    expect(texto.replace(/REEMPLAZAR_URL_INTERNA_DEL_RELE/g, '')).not.toMatch(/https?:\/\/(?!ingesta\.example)/);
  });
  it('NIEGA: ningún identificador, ni UUID, ni credencial por id', () => {
    const texto = JSON.stringify(cadena);
    expect(texto).not.toMatch(/\d{10,}/);
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    for (const n of cadena.nodes) if (n.credentials) expect(n.credentials['httpHeaderAuth'].id).toBe('');
  });
  it('NIEGA: ninguna expresión con `}}` adentro que n8n tomaría por el cierre', () => {
    for (const n of cadena.nodes) {
      const visitar = (v: unknown): void => {
        if (typeof v === 'string' && v.startsWith('=') && v.includes('{{')) {
          const cuerpo = v.slice(1);
          const aperturas = (cuerpo.match(/\{\{/g) ?? []).length;
          const cierres = (cuerpo.match(/\}\}/g) ?? []).length;
          expect(cierres, `${n.name}: ${v.slice(0, 80)}`).toBe(aperturas);
        } else if (v && typeof v === 'object') Object.values(v).forEach(visitar);
      };
      visitar(n.parameters);
    }
  });
  it('sin reporte: la cadena no lo arma y las salidas son el respaldo, el resto y el «no» de ¿Enviar de verdad?', () => {
    const c = nodosDeEnvio({ ...OPC_RELE, reportar: false, credenciales: { rele: CRED_RELE } });
    expect(c.nodes).toHaveLength(6);
    expect(c.salidas).toEqual([{ nodo: R, salida: 0 }, { nodo: '¿Qué hacer con el envío?', salida: 2 }, { nodo: '¿Enviar de verdad?', salida: 1 }]);
  });
  it('injertar la cuelga de «Armar mensajes» y las salidas de lo que sigue', () => {
    const p = injertar({ nodes: [{ id: 'x', name: 'Armar mensajes', type: 't', parameters: { jsCode: 'return cmNumerar(x);' } }, { id: 'y', name: 'Resumen del turno', type: 't', parameters: {} }], connections: {} as Record<string, { main: { node: string }[][] }> }, { ...OPC_RELE, siguiente: 'Resumen del turno' });
    expect(p.nodes).toHaveLength(10);
    expect(p.connections['Armar mensajes']!.main[0]!.map((c) => c.node)).toEqual(['¿Enviar de verdad?']);
    expect(p.connections['Reportar mensaje (saliente)']!.main[0]!.map((c) => c.node)).toEqual(['Resumen del turno']);
    expect(p.connections['¿Reportar? (saliente)']!.main[1]!.map((c) => c.node)).toEqual(['Resumen del turno']);
  });
});

describe('opciones: sin lo que el relé exige no se arma', () => {
  const base = { ...OPC_RELE };
  it('NIEGA: sin cliente, con cliente raro, sin credencial del relé o con una que no es «AAB1 envío · …» no se arma', () => {
    expect(() => nodosDeEnvio({ ...base, cliente: undefined })).toThrow(/cliente/);
    for (const c of ['', 'Evy', 'a b', "x'y", 'x'.repeat(31), '-x', 'a_b']) expect(() => nodosDeEnvio({ ...base, cliente: c }), c).toThrow(/cliente/);
    expect(() => nodosDeEnvio({ ...base, credenciales: { ingesta: CRED_INGESTA } })).toThrow(/credenciales\.rele/);
    expect(() => nodosDeEnvio({ ...base, credenciales: { rele: 'Graph de Evy', ingesta: CRED_INGESTA } })).toThrow(/credenciales\.rele/);
    expect(() => nodosDeEnvio({ ...base, credenciales: { rele: 'AAB1 envío · ', ingesta: CRED_INGESTA } })).toThrow(/credenciales\.rele/);
    expect(() => nodosDeEnvio({ ...base, credenciales: { rele: "AAB1 envío · x'; y", ingesta: CRED_INGESTA } })).toThrow(/no válidos/);
    expect(() => nodosDeEnvio({ ...base, credenciales: { rele: 'AAB1 envío · ingesta', ingesta: CRED_INGESTA } })).toThrow(/ingesta/);
  });
  it('NIEGA: la URL del relé es el marcador o una base http(s) sin ruta; nada más', () => {
    for (const u of ['', 'ftp://x', 'http://x/y', 'http://x/', 'x.example', "http://x'+evil", 'REEMPLAZAR_OTRA']) expect(() => nodosDeEnvio({ ...base, releUrl: u }), u).toThrow(/releUrl/);
    // El repositorio admite SOLO el marcador; las pruebas pueden usar un host `*.example`. Cualquier host real (interno o público) es una URL que no debe versionarse.
    for (const u of ['http://relay.internal:8080', 'http://10.0.0.5', 'http://localhost:8080', 'https://relay.example.com', 'https://relay.example.org', 'http://example']) expect(() => nodosDeEnvio({ ...base, releUrl: u }), u).toThrow(/releUrl/);
    expect(() => nodosDeEnvio({ ...base, releUrl: 'http://relay.example:8080' })).not.toThrow();
    expect(() => nodosDeEnvio({ ...base, releUrl: MARCADOR_URL_DEL_RELE })).not.toThrow();
  });
  it('NIEGA: un canal desconocido no se arma, y el reporte sigue pidiendo su credencial y su URL', () => {
    expect(() => nodosDeEnvio({ ...base, canal: 'otro' as 'rele' })).toThrow(/canal desconocido/);
    expect(() => nodosDeEnvio({ ...base, credenciales: { rele: CRED_RELE } })).toThrow(/credenciales\.ingesta/);
    expect(() => nodosDeEnvio({ ...base, ingestaUrl: 'http://x.example' })).toThrow(/ingestaUrl/);
  });
  it('el canal Graph no cambia: por defecto sigue siendo la cadena de 6 nodos con «¿Falló el envío?»', () => {
    const g = nodosDeEnvio({ credenciales: { graph: 'G', ingesta: 'I' }, ingestaUrl: 'https://i.example/x' });
    expect(g.nodes.map((n) => n.name)).toContain('¿Falló el envío?');
    expect(JSON.stringify(g)).toContain('graph.facebook.com');
    expect(JSON.stringify(g)).not.toMatch(/REEMPLAZAR_URL_INTERNA_DEL_RELE|Idempotency/);
    expect(nodosDeEnvio({ credenciales: { graph: 'G', ingesta: 'I' }, ingestaUrl: 'https://i.example/x', canal: 'graph' })).toEqual(g);
  });
});

describe('el camino feliz: tres mensajes, tres claves', () => {
  it('cada mensaje sale una vez, con su clave cliente-ejecución-enviar-n, y se reporta con su id', () => {
    const m = mundoRele((e) => ok(e.clave));
    const r = turno(m, [mensaje(1), mensaje(2), mensaje(3)]);
    expect(m.porNodo(Q).map((e) => e.clave)).toEqual([`${CLIENTE}-${WF}-E1-enviar-1`, `${CLIENTE}-${WF}-E1-enviar-2`, `${CLIENTE}-${WF}-E1-enviar-3`]);
    expect(m.porNodo(R)).toHaveLength(0);
    expect(r.mensajes).toHaveLength(3);
    expect(r.llamadas.ingesta.map((c) => c['idMeta'])).toEqual([1, 2, 3].map((n) => `wamid.${CLIENTE}-${WF}-E1-enviar-${n}`));
    expect(r.esperas).toEqual([]);
  });
  it('NIEGA: dos ejecuciones distintas no comparten clave; dos mensajes del mismo turno tampoco', () => {
    const m = mundoRele((e) => ok(e.clave));
    turno(m, [mensaje(1), mensaje(2)], { idEjecucion: 'EA' });
    turno(m, [mensaje(1), mensaje(2)], { idEjecucion: 'EB' });
    const claves = m.porNodo(Q).map((e) => e.clave);
    expect(new Set(claves).size).toBe(4);
    expect(claves.filter((c) => c.includes('-EA-'))).toHaveLength(2);
  });
  it('el id de ejecución con caracteres raros no rompe la clave (solo letras, números, punto, guion y guion bajo)', () => {
    const m = mundoRele((e) => ok(e.clave));
    turno(m, [mensaje(1)], { idEjecucion: 'E 1/../x\r\n' });
    expect(m.porNodo(Q)[0]!.clave).toMatch(/^[A-Za-z0-9_.-]+$/);
  });
  it('NIEGA: dos flujos con la misma ejecución y el mismo cliente no comparten clave (entra `$workflow.id`), y un id raro se sanea', () => {
    const claves = (id: string): string[] => {
      const flujo = flujoConCadena();
      (flujo as unknown as { id: string }).id = id;
      const vistas: string[] = [];
      const mu = crearMundo({
        flujo, ahoraMs: Date.UTC(2026, 10, 2, 15, 0, 0),
        dobles: { [Q]: (ll) => { vistas.push(ll.encabezados['Idempotency-Key'] ?? ''); return ok('x'); }, 'Reportar mensaje (saliente)': () => ({ ok: true }) },
      });
      mu.turno({ mensajes: [mensaje(1)] }, { idEjecucion: 'E1' });
      return vistas;
    };
    expect(claves('WFa')).toEqual([`${CLIENTE}-WFa-E1-enviar-1`]);
    expect(claves('WFb')).toEqual([`${CLIENTE}-WFb-E1-enviar-1`]);
    expect(claves('a b/../x\r\n')[0]).toMatch(/^[A-Za-z0-9_.-]+$/);
    const nodo = nodosDeEnvio(OPC_RELE).nodes.find((n) => n.name === Q)!;
    expect(JSON.stringify(nodo.parameters)).toContain('$workflow.id');
  });
  it('0 mensajes agregados: los que salen son los armados, con el relé o con un reintento', () => {
    const limpio = mundoRele((e) => ok(e.clave));
    const rl = turno(limpio, [mensaje(1), mensaje(2)]);
    const conReintento = mundoRele((e) => (e.clave.endsWith('-1') && e.vez === 1 ? falla('WM-3037') : ok(e.clave)));
    const rc = turno(conReintento, [mensaje(1), mensaje(2)]);
    expect(rl.llamadas.ingesta).toHaveLength(2);
    expect(rc.llamadas.ingesta).toHaveLength(2);
    expect(new Set(rc.llamadas.ingesta.map((c) => c['idMeta'])).size).toBe(2);
  });
});

describe('guardia: con el relé, «Armar mensajes» tiene que llamar a cmNumerar(', () => {
  const plantilla = (jsCode: string) => ({
    nodes: [{ name: 'Armar mensajes', type: 'n8n-nodes-base.code', parameters: { jsCode } }, { name: 'Config del negocio', type: 'n8n-nodes-base.code', parameters: { jsCode: '' } }],
    connections: {},
  });
  it('NIEGA: sin la llamada no se injerta, ni siquiera con la DEFINICIÓN de mensajes.js, un comentario o un texto', () => {
    for (const js of ['return [];', MENSAJES_JS, `${MENSAJES_JS}\n// cmNumerar(lista)\nreturn [];`, "/* cmNumerar(x) */ return [];", 'const f = function cmNumerar(items) { return items; }; return [];',
      "const t = 'cmNumerar(x)'; return [];", 'const t = `cmNumerar(${x})`; return [];', 'return [{ json: { texto: "cmNumerar(x)" } }];',
      'if (false) cmNumerar([]); return [];', 'if (false) { return cmNumerar([]); } return lista;', 'const f = () => { return cmNumerar(x); }; return lista;',
      "return lista; // return cmNumerar(x)"]) {
      expect(() => injertar(plantilla(js), OPC_RELE), js.slice(0, 40)).toThrow(/cmNumerar/);
      expect(llamaANumerar(js), js.slice(0, 40)).toBe(false);
    }
  });
  it('con la llamada sí se injerta, y el canal Graph no la exige', () => {
    expect(() => injertar(plantilla(`${MENSAJES_JS}\nreturn cmNumerar(lista).map((json) => ({ json }));`), OPC_RELE)).not.toThrow();
    expect(llamaANumerar('if (x) return [];\nreturn (e.sinNumerar === true ? lista : cmNumerar(lista)).map((json) => ({ json }));')).toBe(true);
    expect(() => injertar(plantilla('return [];'), { credenciales: { graph: 'G', ingesta: 'I' }, ingestaUrl: 'https://i.example/x' })).not.toThrow();
  });
});

describe('emparejamiento tras «Esperar reintento» (revisión del PR #757)', () => {
  // Tras el Switch el pairedItem de cada ítem es su índice en la ENTRADA del Switch, y el Wait lo devuelve sin tocarlo: si el 2 y el 3 se reintentan,
  // llegan al envío como los ítems 0 y 1 con pairedItem 1 y 2. Un `$('Armar mensajes').item` ahí apunta a OTRO mensaje (o a ninguno).
  it('NIEGA: 3 mensajes, el 2 y el 3 reintentados y uno termina en respaldo: cada envío, respaldo y reporte lleva SU teléfono, SU texto y SU clave', () => {
    const guion = (e: Envio) => {
      if (e.clave.endsWith('-enviar-1')) return ok(e.clave);
      if (e.clave.endsWith('-enviar-2')) return e.vez === 1 ? falla('WM-3035') : falla('WM-3032'); // reintenta y luego pide respaldo
      if (e.clave.endsWith('-enviar-3')) return e.vez === 1 ? falla('WM-3035') : ok(e.clave); // reintenta y sale
      return ok(e.clave); // el respaldo del 2
    };
    const m = mundoRele(guion);
    const r = turno(m, [mensaje(1), mensaje(2), mensaje(3)]);
    expect(m.porNodo(Q).map((e) => [e.clave, e.cuerpo['to']])).toEqual([
      [`${CLIENTE}-${WF}-E1-enviar-1`, '70000001'], [`${CLIENTE}-${WF}-E1-enviar-2`, '70000002'], [`${CLIENTE}-${WF}-E1-enviar-3`, '70000003'],
      [`${CLIENTE}-${WF}-E1-enviar-2`, '70000002'], [`${CLIENTE}-${WF}-E1-enviar-3`, '70000003'],
    ]);
    expect(m.porNodo(R)).toHaveLength(1);
    expect(m.porNodo(R)[0]!.clave).toBe(`${CLIENTE}-${WF}-E1-respaldo-2`);
    expect(m.porNodo(R)[0]!.cuerpo).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '70000002', type: 'text', text: { preview_url: true, body: 'respaldo 2' } });
    const reportes = r.llamadas.ingesta.map((c) => [c['telefono'], c['texto'], c['idMeta']]).sort();
    expect(reportes).toEqual([
      ['+70000001', 'texto 1', `wamid.${CLIENTE}-${WF}-E1-enviar-1`],
      ['+70000002', 'texto 2', `wamid.${CLIENTE}-${WF}-E1-respaldo-2`],
      ['+70000003', 'texto 3', `wamid.${CLIENTE}-${WF}-E1-enviar-3`],
    ]);
  });
  it('NIEGA: tres mensajes, el 3 es el único reintentado y cae en respaldo: el respaldo es del 3, no del 1', () => {
    const m = mundoRele((e) => (e.clave.endsWith('-enviar-3') ? (e.vez === 1 ? falla('WM-3035') : falla('WM-3032')) : ok(e.clave)));
    const r = turno(m, [mensaje(1), mensaje(2), mensaje(3)]);
    expect(m.porNodo(R).map((e) => [e.clave, e.cuerpo['to']])).toEqual([[`${CLIENTE}-${WF}-E1-respaldo-3`, '70000003']]);
    expect(r.llamadas.ingesta.map((c) => c['texto']).sort()).toEqual(['texto 1', 'texto 2', 'texto 3']);
  });
  it('NIEGA: ningún nodo posterior al Wait lee de «Armar mensajes» salvo la rama «no» de ¿Enviar de verdad? (que lee $json)', () => {
    for (const n of nodosDeEnvio(OPC_RELE).nodes) {
      expect(JSON.stringify(n.parameters), n.name).not.toContain("$('Armar mensajes')");
    }
  });
});

describe('504 WM-3041: incierto, nunca se reenvía', () => {
  it('un solo envío, sin respaldo, sin espera y sin reporte; el otro mensaje sigue su camino', () => {
    const m = mundoRele((e) => (e.clave.endsWith('-1') ? falla('WM-3041', { reintentable: true }) : ok(e.clave)));
    const r = turno(m, [mensaje(1), mensaje(2)]);
    expect(contiene(m.envios, `${CLIENTE}-${WF}-E1-enviar-1`)).toHaveLength(1);
    expect(m.porNodo(R)).toHaveLength(0);
    expect(r.esperas).toEqual([]);
    expect(r.llamadas.ingesta.map((c) => c['telefono'])).toEqual(['+70000002']);
  });
});

describe('429 WM-3037: una espera de 61 a 64 s y la MISMA clave', () => {
  it('reintenta una vez con la misma clave tras 61 a 64 s y reporta el éxito', () => {
    const m = mundoRele((e) => (e.vez === 1 ? falla('WM-3037') : ok(e.clave)));
    const r = turno(m, [mensaje(1)]);
    expect(m.porNodo(Q)).toHaveLength(2);
    expect(new Set(m.porNodo(Q).map((e) => e.clave)).size).toBe(1);
    expect(r.esperas).toHaveLength(1);
    expect(r.esperas[0]!.segundos).toBeGreaterThanOrEqual(61);
    expect(r.esperas[0]!.segundos).toBeLessThanOrEqual(64);
    expect(r.llamadas.ingesta).toHaveLength(1);
  });
  it('NIEGA: si el segundo intento también da 429 queda agotado: 2 envíos, sin respaldo, sin reporte', () => {
    const m = mundoRele(() => falla('WM-3037'));
    const r = turno(m, [mensaje(1)]);
    expect(m.porNodo(Q)).toHaveLength(2);
    expect(m.porNodo(R)).toHaveLength(0);
    expect(r.llamadas.ingesta).toHaveLength(0);
    expect(r.esperas).toHaveLength(1);
  });
});

describe('409 WM-3035: hasta 2 veces tras 2 a 3 s', () => {
  it('con tres 409 seguidos hace 3 envíos (el original y 2 reintentos) y queda agotado', () => {
    const m = mundoRele(() => falla('WM-3035'));
    const r = turno(m, [mensaje(1)]);
    expect(m.porNodo(Q)).toHaveLength(3);
    expect(new Set(m.porNodo(Q).map((e) => e.clave)).size).toBe(1);
    expect(r.esperas).toHaveLength(2);
    for (const e of r.esperas) { expect(e.segundos).toBeGreaterThanOrEqual(2); expect(e.segundos).toBeLessThanOrEqual(3); }
    expect(m.porNodo(R)).toHaveLength(0);
    expect(r.llamadas.ingesta).toHaveLength(0);
  });
  it('un 409 y luego éxito: reporta', () => {
    const m = mundoRele((e) => (e.vez === 1 ? falla('WM-3035') : ok(e.clave)));
    const r = turno(m, [mensaje(1)]);
    expect(r.llamadas.ingesta).toHaveLength(1);
  });
});

describe('reintentable: 2 reintentos con 2 s y 8 s', () => {
  it('WM-3038 siempre: 3 envíos, esperas 2 y 8, agotado', () => {
    const m = mundoRele(() => falla('WM-3038', { reintentable: true }));
    const r = turno(m, [mensaje(1)]);
    expect(m.porNodo(Q)).toHaveLength(3);
    expect(r.esperas.map((e) => e.segundos)).toEqual([2, 8]);
    expect(m.porNodo(R)).toHaveLength(0);
    expect(r.llamadas.ingesta).toHaveLength(0);
  });
  it('las causas distintas llevan cuentas distintas: un 409 y luego un 429 y luego éxito', () => {
    const guion = [falla('WM-3035'), falla('WM-3037')];
    const m = mundoRele((e) => guion[e.vez - 1] ?? ok(e.clave));
    const r = turno(m, [mensaje(1)]);
    expect(m.porNodo(Q)).toHaveLength(3);
    expect(r.llamadas.ingesta).toHaveLength(1);
  });
});

describe('respaldo: un rechazo conocido sale como texto, una sola vez', () => {
  it('WM-3032 (link): respaldo con clave -respaldo-n, UN intento, texto plano y se reporta con el id del respaldo', () => {
    const m = mundoRele((e) => (e.nodo === Q ? falla('WM-3032') : ok(e.clave)));
    const r = turno(m, [mensaje(1)]);
    expect(m.porNodo(Q)).toHaveLength(1);
    expect(m.porNodo(R)).toHaveLength(1);
    const e = m.porNodo(R)[0]!;
    expect(e.clave).toBe(`${CLIENTE}-${WF}-E1-respaldo-1`);
    expect(e.cuerpo).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '70000001', type: 'text', text: { preview_url: true, body: 'respaldo 1' } });
    expect(r.llamadas.ingesta.map((c) => c['idMeta'])).toEqual([`wamid.${CLIENTE}-${WF}-E1-respaldo-1`]);
    expect(r.esperas).toEqual([]);
  });
  it('NIEGA: si el respaldo también falla, no se reintenta ni se reporta', () => {
    const m = mundoRele((e) => (e.nodo === Q ? falla('WM-3040', { metaCodigo: '131047' }) : falla('WM-3040', { metaCodigo: '131047' })));
    const r = turno(m, [mensaje(1)]);
    expect(m.porNodo(R)).toHaveLength(1);
    expect(r.llamadas.ingesta).toHaveLength(0);
  });
  it('NIEGA: un respaldo que da 504 no se reenvía', () => {
    const m = mundoRele((e) => (e.nodo === Q ? falla('WM-3032') : falla('WM-3041')));
    const r = turno(m, [mensaje(1)]);
    expect(m.porNodo(R)).toHaveLength(1);
    expect(r.llamadas.ingesta).toHaveLength(0);
  });
  it('con `reportarFallidos` el respaldo caído se reporta como en Agenda mínima, pero un incierto sigue sin reportarse', () => {
    const m = mundoRele((e) => (e.nodo === Q ? falla('WM-3032') : falla('WM-3040', { metaCodigo: '131047' })), { reportarFallidos: true });
    expect(turno(m, [mensaje(1)]).llamadas.ingesta).toHaveLength(1);
    const n = mundoRele(() => falla('WM-3041'), { reportarFallidos: true });
    expect(turno(n, [mensaje(1)]).llamadas.ingesta).toHaveLength(0);
  });
});

describe('incierto: ni respaldo ni reenvío ni reporte', () => {
  const CASOS: [string, () => J][] = [
    ['error de red', () => ({ error: 'ECONNRESET' })],
    ['tiempo agotado', () => ({ error: 'timeout of 30000ms exceeded' })],
    ['2xx sin id', () => ({ messages: [] })],
    ['cuerpo HTML del proxy', () => ({ data: '<html>502</html>' })],
    ['código WM desconocido', () => falla('WM-3999', { reintentable: true })],
    ['WM-3040 con código de Meta desconocido (id vencido: 502, no 404)', () => falla('WM-3040', { metaCodigo: '131030', reintentable: true })],
    ['respuesta vacía', () => ({})],
  ];
  for (const [nombre, resp] of CASOS) {
    it(nombre, () => {
      const m = mundoRele(() => resp());
      const r = turno(m, [mensaje(1)]);
      expect(m.envios).toHaveLength(1);
      expect(r.esperas).toEqual([]);
      expect(r.llamadas.ingesta).toHaveLength(0);
    });
  }
});

describe('el cuerpo que sale al relé', () => {
  const payloadSucio = (i: number): J => ({
    messaging_product: 'meta', recipient_type: 'individual', to: `+7000000${i}`, type: 'image',
    image: { id: 'MEDIA1', link: 'https://x.example/a.jpg', caption: 'hola' },
    interactive: { type: 'cta_url', body: { text: 'b' }, action: { name: 'cta_url', parameters: { display_text: 'ir', url: 'https://x.example', link: 'x' } } },
    biz_opaque_callback_data: 'x', context: { message_id: 'wamid.Z' }, evil: 'x',
  });
  it('NIEGA: sin `link` en ningún nivel, `to` sin «+», messaging_product fijo y sin claves ajenas', () => {
    const m = mundoRele((e) => ok(e.clave));
    turno(m, [mensaje(1, { payload: payloadSucio(1) })]);
    const c = m.porNodo(Q)[0]!.cuerpo;
    expect(JSON.stringify(c)).not.toMatch(/"link"/);
    expect(c['to']).toBe('70000001');
    expect(c['messaging_product']).toBe('whatsapp');
    expect(Object.keys(c).sort()).toEqual(['image', 'interactive', 'messaging_product', 'recipient_type', 'to', 'type']);
    expect(c['image']).toEqual({ id: 'MEDIA1', caption: 'hola' });
    expect(c['interactive'].action.parameters).toEqual({ display_text: 'ir', url: 'https://x.example' });
  });
  it('`to` son solo dígitos aunque venga con espacios, guiones o letras', () => {
    const m = mundoRele((e) => ok(e.clave));
    turno(m, [mensaje(1, { payload: { type: 'text', to: ' +7 000-0001 x', text: { body: 'a' } } })]);
    expect(m.porNodo(Q)[0]!.cuerpo['to']).toBe('70000001');
  });
  it('la URL lleva el phone_number_id limpio y el marcador del relé', () => {
    const m = mundoRele((e) => ok(e.clave));
    turno(m, [mensaje(1, { phoneNumberId: '555/../1?x=y' })]);
    expect(m.porNodo(Q)[0]!.url).toBe(`${MARCADOR_URL_DEL_RELE}/v1/envio/mensajes/5551`);
  });
  it('NIEGA: un mensaje de más de 64 KiB no sale (ni respaldo) ni se reporta; uno justo debajo sí sale', () => {
    const m = mundoRele((e) => ok(e.clave));
    const grande = mensaje(1, { payload: { type: 'text', to: '7000001', text: { body: 'x'.repeat(70000) } } });
    const r = turno(m, [grande]);
    expect(m.envios).toHaveLength(0);
    expect(r.llamadas.ingesta).toHaveLength(0);
    const justo = mensaje(1, { payload: { type: 'text', to: '7000001', text: { body: 'x'.repeat(65000) } } });
    expect(turno(mundoRele((e) => ok(e.clave)), [justo]).mensajes).toHaveLength(1);
    // Los 64 KiB son BYTES: 25.000 emojis (4 bytes cada uno) pasan de 64 KiB aunque tengan menos de 64.000 caracteres.
    const emojis = mensaje(1, { payload: { type: 'text', to: '7000001', text: { body: '😀'.repeat(25000) } } });
    const m2 = mundoRele((e) => ok(e.clave));
    turno(m2, [emojis]);
    expect(m2.envios).toHaveLength(0);
  });
  it('NIEGA: sin el número `n` del mensaje no sale NADA (dos mensajes sin número compartirían clave y el relé tomaría el segundo por un repetido)', () => {
    const m = mundoRele((e) => ok(e.clave));
    const r = turno(m, [mensaje(1), mensaje(2)], { sinNumerar: true });
    expect(m.envios).toHaveLength(0);
    expect(r.llamadas.ingesta).toHaveLength(0);
  });
  it('NIEGA: un `n` que no es un entero positivo tampoco sale', () => {
    for (const n of [0, -1, 1.5, '1', null]) {
      const m = mundoRele((e) => ok(e.clave));
      turno(m, [mensaje(1, { n })], { sinNumerar: true });
      expect(m.envios, String(n)).toHaveLength(0);
    }
  });
});

describe('¿Enviar de verdad? y el modo prueba no pasan por el relé', () => {
  it('en modo prueba sin enviarDeVerdad no se envía y el item sigue al reporte, como antes', () => {
    const flujo = flujoConCadena();
    flujo.nodes.find((n) => n.name === 'Config del negocio')!.parameters['jsCode'] = 'return [{ json: { modoPrueba: true } }];';
    const envios: unknown[] = [];
    const mu = crearMundo({ flujo, ahoraMs: Date.UTC(2026, 10, 2), dobles: { [Q]: () => { envios.push(1); return ok('x'); }, [R]: () => ok('y'), 'Reportar mensaje (saliente)': () => ({ ok: true }) } });
    const r = mu.turno({ mensajes: [mensaje(1)] });
    expect(envios).toHaveLength(0);
    expect(r.llamadas.ingesta).toHaveLength(1);
  });
  it('un item `sinMensajes` no se envía ni se reporta', () => {
    const m = mundoRele((e) => ok(e.clave));
    const r = turno(m, [mensaje(1, { sinMensajes: true, reportar: false })]);
    expect(m.envios).toHaveLength(0);
    expect(r.llamadas.ingesta).toHaveLength(0);
  });
});

describe('cmNumerar (P4)', () => {
  const { cmNumerar } = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vm = require('node:vm') as typeof import('node:vm');
    return vm.runInNewContext(`${MENSAJES_JS}\n({ cmNumerar })`, Object.create(null)) as { cmNumerar: (x: unknown) => J[] };
  })();
  it('numera 1, 2, 3… en orden y no muta los items', () => {
    const a = { para: 'x' }; const b = { para: 'y' };
    expect(cmNumerar([a, b]).map((i) => i['n'])).toEqual([1, 2]);
    expect(a).toEqual({ para: 'x' });
    expect(b).toEqual({ para: 'y' });
  });
  it('NIEGA: siempre renumera: una `n` que ya traía un item no se respeta (dos items con la misma n compartirían clave)', () => {
    expect(cmNumerar([{ n: 7 }, { n: 7 }, { n: 7 }]).map((i) => i['n'])).toEqual([1, 2, 3]);
  });
  it('NIEGA: descarta lo que no es un objeto y devuelve [] si no es arreglo', () => {
    expect(cmNumerar([null, 5, 'x', [1], { a: 1 }]).map((i) => i['n'])).toEqual([1]);
    for (const x of [undefined, null, 5, 'x', {}]) expect(cmNumerar(x)).toEqual([]);
  });
  it('no usa nada que el Code de n8n no tenga', () => {
    expect(MENSAJES_JS.replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/\b(require|URL|Buffer|crypto|process)\b/);
  });
});
