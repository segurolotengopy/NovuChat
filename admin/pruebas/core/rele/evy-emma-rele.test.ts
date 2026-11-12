/**
 * EVY (cliente08) Y EMMA (cliente07) POR EL RELÉ B9 (PR 2, 03/11/2026), sobre los JSON versionados de sus constructores.
 *
 *   - 56 nodos en producción y 51 en la prueba (tope 56, aprobado por Andres el 03/11/2026), con «Detener por envío incierto» (I4);
 *   - la cadena de envío del flujo es la del módulo común, nodo por nodo, con la credencial «AAB1 envío · clienteNN» y el prefijo de la clave del tenant;
 *   - TODO lo que hablaba con Graph (envío, respaldo, aviso, descarga para Gemini, guardado) va por el relé: ni Graph, ni su CDN, ni una URL real;
 *   - el marcador de la URL del relé se tolera SOLO en `guardias()` y solo pegado a `/v1/envio/`; la guardia de publicación lo sigue rechazando;
 *   - la misma Idempotency-Key en los reintentos, 504 no se reenvía, sin `link`, I4 corta sin mensaje extra (el mundo de mentira corre la cadena con la
 *     clave y la credencial reales de cada cliente);
 *   - «Aceptar (200)» antes de cualquier Wait o llamada al relé, y un evento de otra WABA nunca da 200 (`wabaIdEsperado` fijo, la verificación sin Continue on Fail).
 *   Cero mensajes por conversación agregados o quitados.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { nodosDeEnvio, MARCADOR_URL_DEL_RELE, hallazgosDelEnvioRele } from '../../../../Flujos/experimental/comun-sin-agente/src/envio.mjs';
import { hallazgosDelGuardado } from '../../../../Flujos/experimental/comun-sin-agente/src/guardado.mjs';
import * as evy from '../../../../Flujos/experimental/rroca-evy/construir.mjs';
import * as emma from '../../../../Flujos/experimental/rroca-emma/construir.mjs';
import type { J } from '../../lib/flujo';
import { falla, mensaje, mundoRele, ok, turno, turnoConError } from './ayuda';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
interface Nodo { name: string; type: string; parameters: J; credentials?: J; position: [number, number]; [k: string]: unknown }
interface Flujo { nodes: Nodo[]; connections: Record<string, { main: Array<Array<{ node: string }>> }>; settings: J }
type Constructor = typeof evy;

const CLIENTES: Array<{ nombre: string; carpeta: string; archivo: string; cliente: string; cred: string; c: Constructor }> = [
  { nombre: 'Evy', carpeta: 'rroca-evy', archivo: 'rroca-evy', cliente: 'rroca-evy', cred: 'AAB1 envío · cliente08', c: evy },
  { nombre: 'Emma', carpeta: 'rroca-emma', archivo: 'rroca-emma', cliente: 'rroca-emma', cred: 'AAB1 envío · cliente07', c: emma as unknown as Constructor },
];
const leerFlujo = (carpeta: string, archivo: string): Flujo => JSON.parse(readFileSync(join(RAIZ, 'Flujos', 'experimental', carpeta, `${archivo}.json`), 'utf8')) as Flujo;
const leerPrueba = (carpeta: string, archivo: string): Flujo => JSON.parse(readFileSync(join(RAIZ, 'Flujos', 'experimental', carpeta, `${archivo}.prueba.json`), 'utf8')) as Flujo;
const copia = (f: Flujo): Flujo => JSON.parse(JSON.stringify(f)) as Flujo;
const nodo = (f: Flujo, n: string): Nodo => { const x = f.nodes.find((y) => y.name === n); if (!x) throw new Error(`falta ${n}`); return x; };

// Tanda 1 de Evy (07/11/2026): mientras CANAL_DE_ENVIO sea 'graph', Evy no va por el relé y sus pruebas del relé no aplican (las de graph están en tenants/rroca-evy/armado.test.ts); Emma sigue por el relé.
describe.each(CLIENTES.filter((x) => (x.nombre !== 'Evy' || evy.ES_RELE) && (x.nombre !== 'Emma' || emma.ES_RELE)))('$nombre por el relé', ({ carpeta, archivo, cliente, cred, c }) => {
  const prod = leerFlujo(carpeta, archivo);
  const prueba = leerPrueba(carpeta, archivo);
  const mapa = (f: Flujo) => JSON.parse(JSON.stringify(f)) as Flujo;

  it('56 nodos en producción y 51 en la prueba (tope 56, aprobado por Andres el 03/11/2026) y guardias() vacío', () => {
    expect(c.TOPE_DE_NODOS).toBe(56);
    expect(prod.nodes).toHaveLength(56);
    expect(prueba.nodes).toHaveLength(51);
    expect(c.guardias('produccion', prod)).toEqual([]);
    expect(c.guardias('prueba', prueba)).toEqual([]);
  });
  it('incluye «Detener por envío incierto» (Stop and Error) y la cadena del relé completa; executionTimeout 300', () => {
    for (const f of [prod, prueba]) {
      expect(nodo(f, 'Detener por envío incierto').type).toBe('n8n-nodes-base.stopAndError');
      expect(hallazgosDelEnvioRele(f)).toEqual([]);
      expect(f.settings['executionTimeout']).toBe(300);
    }
  });
  it('la cadena de envío del flujo es la del módulo común, nodo por nodo (parámetros idénticos), con la credencial y el cliente del tenant', () => {
    const comun = nodosDeEnvio({ canal: 'rele', cliente, credenciales: { rele: cred, ingesta: 'x' }, ingestaUrl: 'https://x.example/ingesta', entrada: 'Normalizar entrada' });
    for (const n of ['¿Enviar de verdad?', 'Enviar a WhatsApp', 'Leer respuesta del relé', '¿Qué hacer con el envío?', 'Esperar reintento', 'Enviar respaldo', 'Detener por envío incierto']) {
      const esperado = comun.nodes.find((x) => x.name === n)!;
      expect(JSON.stringify(nodo(prod, n).parameters), n).toBe(JSON.stringify(esperado.parameters));
    }
    expect(nodo(prod, 'Enviar a WhatsApp').parameters['headerParameters']).toBeDefined();
    expect(JSON.stringify(nodo(prod, 'Enviar a WhatsApp').parameters)).toContain(`'${cliente}-'`);
    expect(nodo(prod, 'Enviar a WhatsApp').credentials).toEqual({ httpHeaderAuth: { id: '', name: cred } });
    expect(nodo(prod, 'Enviar respaldo').credentials).toEqual({ httpHeaderAuth: { id: '', name: cred } });
  });
  it('NIEGA: ni un nodo habla con Graph, su CDN o whatsAppApi, y el marcador de la URL del relé solo va pegado a /v1/envio/', () => {
    for (const f of [prod, prueba]) {
      for (const n of f.nodes) {
        const t = JSON.stringify({ p: n.parameters, t: n.type });
        expect(t, n.name).not.toMatch(/graph\.facebook\.com|lookaside|fbsbx|whatsAppApi/);
        const sinRele = t.split(`${MARCADOR_URL_DEL_RELE}/v1/envio/`).join('');
        expect(sinRele, n.name).not.toContain(MARCADOR_URL_DEL_RELE);
      }
    }
  });
  it('los tres nodos que bajaban o mandaban por Graph (aviso, URL del medio, descarga) y el guardado hablan con el relé con la credencial del tenant', () => {
    for (const n of ['Enviar aviso', 'Obtener URL del medio (general)', 'Descargar medio', 'Pedir el medio a Meta (guardado)', 'Descargar medio (guardado)', 'Avisar falla del guardado']) {
      expect(JSON.stringify(nodo(prod, n).parameters), n).toContain(`${MARCADOR_URL_DEL_RELE}/v1/envio/`);
      expect(nodo(prod, n).credentials, n).toEqual({ httpHeaderAuth: { id: '', name: cred } });
    }
    expect(String(nodo(prod, 'Descargar medio').parameters['url'])).toMatch(/\/contenido$/);
    expect(JSON.stringify(nodo(prod, '¿Tamaño aceptable?').parameters)).not.toMatch(/lookaside|\.url/);
    expect(hallazgosDelGuardado(prod)).toEqual([]);
    expect(JSON.stringify(nodo(prod, 'Enviar aviso').parameters)).toContain("-aviso-");
  });
  it('cupo del guardado: 10 por teléfono y 30 por flujo (#757)', () => {
    expect(String(nodo(prod, 'Preparar guardado').parameters['jsCode'])).toContain('const GM_CUPO = { porTelefono: 10, global: 30 };');
  });
  it('«Armar mensajes» numera con cmNumerar y «Armar previos» numera cada envío (n), que es lo que usa la Idempotency-Key', () => {
    expect(String(nodo(prod, 'Armar mensajes').parameters['jsCode'])).toMatch(/return cmNumerar\(/);
    expect(String(nodo(prod, 'Armar previos').parameters['jsCode'])).toContain('it.json.n = i + 1');
  });
  it('el reporte saliente: solo lo que Meta aceptó con id (idMeta o messages[0].id) y el evento no_contactar solo cuando lo es', () => {
    const condicion = JSON.stringify(nodo(prod, '¿Reportar? (saliente)').parameters);
    expect(condicion).toContain('j.idMeta');
    expect(condicion).toContain('j.messages[0].id');
    const cuerpo = String(nodo(prod, 'Reportar mensaje (saliente)').parameters['jsonBody']);
    expect(cuerpo).toContain("if (m.evento === 'no_contactar')");
    expect(cuerpo).not.toContain('evento: m.evento');
  });

  describe('guardias', () => {
    it('NIEGA: volver a Graph en cualquier nodo, o un marcador suelto fuera de /v1/envio/, rompe guardias()', () => {
      const a = copia(prod);
      nodo(a, 'Enviar aviso').parameters['url'] = '=https://graph.facebook.com/v26.0/x/messages';
      expect(c.guardias('produccion', a).join('\n')).toMatch(/Meta directo|no habla con el relé|anfitrión/);
      const b = copia(prod);
      nodo(b, 'Armar mensajes').parameters['jsCode'] += `\n// ${MARCADOR_URL_DEL_RELE}`;
      expect(c.guardias('produccion', b).join('\n')).toMatch(/marcador REEMPLAZAR_/);
      const d = copia(prod);
      nodo(d, 'Armar mensajes').parameters['jsCode'] += '\n// REEMPLAZAR_OTRA_COSA';
      expect(c.guardias('produccion', d).join('\n')).toMatch(/marcador REEMPLAZAR_/);
    });
    it('NIEGA: pasar de 56 nodos, o sin «Detener por envío incierto», o con otra credencial del relé, rompe guardias()', () => {
      const a = copia(prod);
      a.nodes.push({ name: 'Nodo de más', type: 'n8n-nodes-base.noOp', parameters: {}, position: [0, 0] });
      expect(c.guardias('produccion', a).join('\n')).toMatch(/tiene 57 nodos y el tope es 56/);
      const b = copia(prod);
      b.nodes = b.nodes.filter((n) => n.name !== 'Detener por envío incierto');
      expect(c.guardias('produccion', b).join('\n')).toMatch(/Detener por envío incierto/);
      const d = copia(prod);
      nodo(d, 'Enviar aviso').credentials = { httpHeaderAuth: { id: '', name: 'AAB1 envío · cliente99' } };
      expect(c.guardias('produccion', d).join('\n')).toMatch(/no lleva la credencial/);
    });
    it('NIEGA (multi-tenant): la credencial del relé del OTRO cliente en cualquier nodo que lleve una del relé rompe guardias(), en producción y en la prueba', () => {
      const otra = cred === 'AAB1 envío · cliente08' ? 'AAB1 envío · cliente07' : 'AAB1 envío · cliente08';
      for (const [variante, base] of [['produccion', prod], ['prueba', prueba]] as const) {
        const conRele = base.nodes.filter((n) => Object.values(n.credentials ?? {}).some((x) => String((x as J)['name']).startsWith('AAB1 envío · ')));
        for (const n of ['Enviar a WhatsApp', 'Enviar respaldo', 'Enviar aviso', 'Obtener URL del medio (general)', 'Descargar medio', 'Pedir el medio a Meta (guardado)', 'Descargar medio (guardado)', 'Avisar falla del guardado']) expect(conRele.map((x) => x.name), n).toContain(n);
        for (const n of conRele) {
          const m = copia(base);
          nodo(m, n.name).credentials = { httpHeaderAuth: { id: '', name: otra } };
          expect(c.guardias(variante, m).join('\n'), `${variante} · ${n.name}`).toMatch(/credencial del relé que no es la de este cliente/);
        }
      }
    });
    it('NIEGA: en cada uno de los 8 nodos del relé, un nombre distinto del exacto (otra grafía, otro cliente, sin tilde) rompe guardias(); y una credencial «aab1 envio» en un nodo ajeno también', () => {
      const ocho = ['Enviar a WhatsApp', 'Enviar respaldo', 'Enviar aviso', 'Obtener URL del medio (general)', 'Descargar medio', 'Pedir el medio a Meta (guardado)', 'Descargar medio (guardado)', 'Avisar falla del guardado'];
      const malos = ['AAB1 envio · cliente99', 'aab1 envío · ' + cred.slice(-9), 'AAB1  envío · ' + cred.slice(-9), `${cred} `, 'Otra credencial'];
      for (const n of ocho) {
        for (const nombre of malos) {
          const m = copia(prod);
          nodo(m, n).credentials = { httpHeaderAuth: { id: '', name: nombre } };
          expect(c.guardias('produccion', m).join('\n'), `${n} · ${nombre}`).toMatch(/no lleva la credencial|que no es la de este cliente/);
        }
      }
      const ajeno = copia(prod);
      nodo(ajeno, 'Traer configuración').credentials = { httpHeaderAuth: { id: '', name: 'AAB1 envio · cliente08' } };
      expect(c.guardias('produccion', ajeno).join('\n')).toMatch(/que no es la de este cliente/);
    });
    it('NIEGA: un header Authorization escrito en headerParameters de cualquier nodo HTTP rompe guardias() (cualquier grafía)', () => {
      const http = prod.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
      expect(http.length).toBeGreaterThan(10);
      for (const n of http) {
        for (const nombre of ['Authorization', 'authorization', ' AUTHORIZATION ']) {
          const m = copia(prod);
          const x = nodo(m, n.name);
          x.parameters['sendHeaders'] = true;
          const previo = ((x.parameters['headerParameters'] as J | undefined)?.['parameters'] as J[] | undefined) ?? [];
          x.parameters['headerParameters'] = { parameters: [...previo, { name: nombre, value: 'Bearer x' }] };
          expect(c.guardias('produccion', m).join('\n'), `${n.name} · ${nombre}`).toMatch(/header Authorization/);
        }
      }
      expect(c.guardias('produccion', prod)).toEqual([]);
    });
    it('NIEGA: la guardia de PUBLICACIÓN sigue rechazando el marcador de la URL del relé (el publicador debe sustituirlo)', () => {
      const datos = c.cargarDatos(c.ARCHIVO_DE_DATOS);
      const hallazgos = c.guardiaDePublicacion({ flujo: prod, datos, negocio: JSON.parse(readFileSync(c.ARCHIVO_DE_NEGOCIO, 'utf8')) as J, etapa: 'crear' });
      expect(hallazgos.join('\n')).toContain('marcador sin sustituir: REEMPLAZAR_URL_INTERNA_DEL_RELE');
    });
    it('la prueba: «Entrada de prueba» exige cabecera y no es el receptor (responde al final); nada del relé corre antes de «Config base»', () => {
      const e = nodo(prueba, 'Entrada de prueba');
      expect(e.parameters['authentication']).toBe('headerAuth');
      expect(e.parameters['responseMode']).toBe('lastNode');
      const sig = (prueba.connections['Entrada de prueba']?.main ?? []).flatMap((s) => (s ?? []).map((x) => x.node));
      expect(sig).toEqual(['Config base']);
      expect(prueba.nodes.some((n) => n.name === 'Aceptar (200)')).toBe(false);
    });
    it('«Aceptar (200)» va antes de toda espera y de toda llamada al relé, y la verificación del receptor sigue fija y sin Continue on Fail', () => {
      const f = mapa(prod);
      const hijos = (n: string): string[] => (f.connections[n]?.main ?? []).flatMap((s) => (s ?? []).map((x) => x.node));
      const alcanza = new Set<string>();
      const pila = ['Entrega del receptor'];
      while (pila.length) { const n = pila.pop()!; if (alcanza.has(n) || n === 'Aceptar (200)') continue; alcanza.add(n); pila.push(...hijos(n)); }
      for (const n of alcanza) {
        const x = nodo(f, n);
        expect(x.type, n).not.toBe('n8n-nodes-base.wait');
        expect(JSON.stringify(x.parameters), n).not.toContain('/v1/envio/');
      }
      const v = nodo(f, 'Verificar firma con el receptor');
      expect(v['onError']).toBeUndefined();
      expect(String(v.parameters['jsonBody'])).toMatch(/wabaIdEsperado: "(REEMPLAZAR_[A-Z0-9_]+|\d{6,25})"/);
      const x = copia(f);
      nodo(x, 'Verificar firma con el receptor')['onError'] = 'continueRegularOutput';
      expect(c.guardias('produccion', x).join('\n')).toMatch(/Continue on Fail/);
    });
  });

  describe('la cadena corriendo en el n8n de mentira, con la clave y la credencial de este tenant', () => {
    const op = { cliente, credenciales: { rele: cred, ingesta: 'Ingesta de prueba' } };
    it('la misma Idempotency-Key en el reintento (429), prefijada con el tenant, y se reporta una sola vez', () => {
      const m = mundoRele((e) => (e.vez === 1 ? falla('WM-3037') : ok(e.clave)), op);
      const r = turno(m, [mensaje(1)]);
      const claves = m.porNodo('Enviar a WhatsApp').map((e) => e.clave);
      expect(claves).toHaveLength(2);
      expect(new Set(claves).size).toBe(1);
      expect(claves[0]).toMatch(new RegExp(`^${cliente}-.+-enviar-1$`));
      expect(r.llamadas.ingesta).toHaveLength(1);
    });
    it('504 WM-3041 no se reenvía, y I4 termina la ejecución en error sin respaldo, sin reporte y sin mensaje extra', () => {
      const m = mundoRele(() => falla('WM-3041', { reintentable: true }), op);
      const r = turnoConError(m, [mensaje(1), mensaje(2)]);
      expect(r.fallo?.nodo).toBe('Detener por envío incierto');
      expect(m.porNodo('Enviar a WhatsApp')).toHaveLength(2);
      expect(m.porNodo('Enviar respaldo')).toHaveLength(0);
      expect(r.llamadas.ingesta).toHaveLength(0);
    });
    it('un mensaje con `link` sale sin `link` por el relé (a cualquier nivel)', () => {
      const m = mundoRele((e) => ok(e.clave), op);
      turno(m, [mensaje(1, { payload: { messaging_product: 'whatsapp', to: '+70000001', type: 'image', image: { id: 'M1', link: 'https://x.example/a.jpg' } } })]);
      expect(JSON.stringify(m.porNodo('Enviar a WhatsApp')[0]!.cuerpo)).not.toMatch(/link/);
    });
    it('0 mensajes agregados: con tres mensajes y un reintento, salen exactamente tres distintos', () => {
      const m = mundoRele((e) => (e.clave.endsWith('-2') && e.vez === 1 ? falla('WM-3035') : ok(e.clave)), op);
      const r = turno(m, [mensaje(1), mensaje(2), mensaje(3)]);
      expect(new Set(m.porNodo('Enviar a WhatsApp').map((e) => e.clave)).size).toBe(3);
      expect(r.llamadas.ingesta).toHaveLength(3);
    });
  });
});

// Mientras un cliente declare CANAL_DE_ENVIO = 'graph' (Evy desde el 07/11/2026, Emma desde el 11/11/2026), sus pruebas del relé no aplican (las de graph viven en tenants/<cliente>/armado.test.ts); este bloque
// mantiene la suite con al menos una prueba y exige que el canal sea uno de los dos conocidos.
describe('canal de envío declarado por cada cliente', () => {
  it('Evy y Emma declaran graph o rele, y ES_RELE concuerda', () => {
    for (const x of [evy, emma]) {
      expect(['graph', 'rele']).toContain(x.CANAL_DE_ENVIO);
      expect(x.ES_RELE).toBe(x.CANAL_DE_ENVIO === 'rele');
    }
  });
});
