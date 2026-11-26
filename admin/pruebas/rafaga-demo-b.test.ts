/**
 * RÁFAGAS EN EL DEMO B (venta y cobro): varios textos seguidos de un teléfono = UNA respuesta (25/11/2026).
 *
 * Corre el JSON VERSIONADO (`Flujos/demo-b-venta-cobro.json`) con el n8n de mentira: el código y las condiciones son los reales;
 * la red (panel, ingesta, Meta, modelo, servidor de ráfagas) son dobles. La lógica de la decisión está probada en
 * `core/rafaga-*.test.ts`; acá se prueba el INJERTO en este flujo: dónde cuelga, qué desvíos quedan antes, qué ve el agente, que el
 * QR, el aviso y el candado de existencias no se dupliquen ni se pierdan, y los riesgos residuales FIJADOS (se escriben negando).
 *
 * DESVÍOS DEL DEMO B (todos quedan ANTES del ancla `¿Atención normal?` salida 0 → `¿Es un comprobante?`, o no son textos):
 *   1. Comercio no operativo (409 del panel): `¿Comercio operativo?` -no-> `Comercio no operativo`, ANTES del ancla.
 *   2. Uso extendido, operador: `¿Atención normal?` -no-> `Uso extendido` (aviso fijo), ANTES del ancla.
 *   3. Uso extendido, bloqueado: ídem, sin respuesta.
 *   4. Comprobante / medios (imagen, documento, audio): no son `text`; el IF de la pieza los deja pasar sin esperar y son separadores.
 *   5. Botón e interactivos (`interactive`, `order`): no son `text`: ídem.
 *   6. El carrito del catálogo (`Carrito del catálogo`, otro disparador): no pasa por el ancla ni por el normalizador.
 *   7. Un texto con cobro pendiente NO se desvía: solo una imagen o un documento es comprobante (`esComprobante`).
 * Teléfonos ficticios con seis ceros.
 */
import { describe, expect, it } from 'vitest';
import { hallazgosDeLaRafaga, NODOS_DE_LA_RAFAGA } from '../../Flujos/src/core/rafaga/rafaga.mjs';
import { crearMundo, type Doble, type LlamadaDoble, type Mundo, type ResultadoTurno } from './lib/n8n-de-mentira.ts';
import { codigoDe, ejecutar, leerFlujo, nodo, textoDeFlujo, type J } from './lib/flujo.ts';

const f = leerFlujo('demo-b-venta-cobro.json');
const AHORA = Date.UTC(2026, 10, 25, 15, 0, 0);
const PID = '1000000001';
const TEL = '59100000011';
const T0 = 1_000_000;

// ------------------------------------------------------------------------------ el servidor de ráfagas de mentira
interface Entrada { idMeta: string; tipo: string; texto: string; ms: number }
const entrada = (idMeta: string, texto: string, ms: number, tipo = 'text'): Entrada => ({ idMeta, tipo, texto, ms });

/** Lo que contesta `configuracionFlujo` a la consulta: hasta 5 predecesores, el propio y hasta 3 sucesores, y solo lo visible a `ms propio + espera`. */
function contestar(hilo: Entrada[], idMeta: string, esperaMs = 2000): J {
  const todo = [...hilo].sort((a, b) => (a.ms - b.ms) || (a.idMeta < b.idMeta ? -1 : 1));
  const yo = todo.find((e) => e.idMeta === idMeta);
  if (!yo) return { rafaga: { v: 1, fragmentos: [] } };
  const visibles = todo.filter((e) => e.ms <= yo.ms + esperaMs);
  const i = visibles.findIndex((e) => e.idMeta === idMeta);
  const sel = visibles.slice(Math.max(0, i - 5), i + 4);
  return { rafaga: { v: 1, fragmentos: sel.map((e) => ({ idMeta: e.idMeta, tipo: e.tipo, texto: e.texto, ms: e.ms })) } };
}

// ------------------------------------------------------------------------------ el mundo
interface Opciones {
  hilo?: Entrada[];
  panel?: () => J;
  consulta?: (id: string) => 'cae' | 'ok';
  modelo?: (ll: LlamadaDoble) => string;
  base?: J;
}
const panelBase = (extra: J = {}): J => ({
  statusCode: 200,
  body: {
    tenantId: 'un-negocio', estadoComercio: 'activo', phoneNumberId: PID,
    operacion: { moneda: 'BOB', horarioAtencion: 'lunes a sábado' }, datosDelNegocio: { nombreNegocio: 'Un Negocio' },
    catalogo: [
      { id: 'a', nombre: 'Hamburguesa', precio: 35, moneda: 'BOB', area: 'Comidas' },
      { id: 'b', nombre: 'Gaseosa', precio: 8, moneda: 'BOB', area: 'Bebidas', agotado: true },
    ],
    funcionarios: [], voz: {}, atencion: { estado: 'normal', respuestasEnVentana: 3 },
    ...extra,
  },
});
const conBody = (extra: J): J => { const p = panelBase(); return { statusCode: 200, body: { ...(p['body'] as J), ...extra } }; };

function crear(o: Opciones = {}) {
  const hilo = o.hilo ?? [];
  const consultas: string[] = [];
  const ll: LlamadaDoble[] = [];
  let panel = o.panel ?? (() => panelBase());
  const dobles: Record<string, Doble> = {
    'Traer configuración': () => panel(),
    'Reportar mensaje (entrante)': () => ({ ok: true }),
    'Reportar mensaje (saliente)': () => ({ ok: true }),
    'Indicador de escritura': () => ({ ok: true }),
    'Consultar ráfaga': (l) => {
      const id = String((l.cuerpo?.['rafaga'] as J).idMeta);
      consultas.push(id);
      if ((o.consulta ?? (() => 'ok'))(id) === 'cae') throw new Error('timeout');
      return contestar(hilo, id);
    },
    'AI Agent NovuChat': (l) => { ll.push(l); return { output: (o.modelo ?? (() => 'Claro, ¿qué te sirvo?'))(l) }; },
    'Responder al cliente': () => ({ messages: [{ id: 'wamid.OUT1' }] }),
    'Responder con botón': () => ({ messages: [{ id: 'wamid.OUT2' }] }),
    'Enviar QR de cobro': () => ({ messages: [{ id: 'wamid.QR1' }] }),
    'Reportar QR (saliente)': () => ({ ok: true }),
    'Avisar al dueño': () => ({ messages: [{ id: 'wamid.AV1' }] }),
    'Avisar al dueño (transferencia)': () => ({ messages: [{ id: 'wamid.AV2' }] }),
    'Pedir enlace del catálogo': () => ({ enlace: '' }),
    'Registrar cierre (venta)': () => ({ ok: true }),
    'Obtener URL del medio (general)': () => ({ id: 'm', url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/m1', mime_type: 'audio/ogg', file_size: 1000 }),
    'Descargar medio': () => ({ descargado: true }),
    'Transcribir audio': () => ({ content: { parts: [{ text: 'quiero una hamburguesa' }] } }),
  };
  const mundo: Mundo = crearMundo({
    flujo: f, dobles, ahoraMs: AHORA,
    roles: { ingesta: ['Reportar mensaje (entrante)', 'Reportar mensaje (saliente)'], mensajes: ['Responder al cliente', 'Responder con botón'], avisos: ['Avisar al dueño', 'Avisar al dueño (transferencia)'] },
    configBase: { phoneNumberId: PID, numeroDueno: '59100000099', ...(o.base ?? {}) },
  });
  return { mundo, hilo, consultas, agente: ll, cambiarPanel: (p: () => J) => { panel = p; } };
}

const payload = (msg: J, from = TEL): J => ({
  messaging_product: 'whatsapp', metadata: { display_phone_number: '59100000001', phone_number_id: PID },
  contacts: [{ profile: { name: 'Ana' }, wa_id: from }],
  messages: [{ from, timestamp: '1', ...msg }],
});
const texto = (id: string, body: string): J => payload({ id, type: 'text', text: { body } });
const audio = (id: string): J => payload({ id, type: 'audio', audio: { id: 'media-aud', mime_type: 'audio/ogg; codecs=opus', voice: true } });
const boton = (id: string): J => payload({ id, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'b1', title: 'Sí' } } });

const nodoConteo = (r: ResultadoTurno, nombre: string): number => (r.porNodo[nombre] ?? []).length;
/** Los envíos de texto o botón al cliente (lo que cuesta dinero), sin el QR ni los avisos al negocio. */
const envios = (r: ResultadoTurno): number => nodoConteo(r, 'Responder al cliente') + nodoConteo(r, 'Responder con botón');
const total = (rs: ResultadoTurno[], g: (r: ResultadoTurno) => number): number => rs.reduce((n, r) => n + g(r), 0);

const hilo2 = (): Entrada[] => [entrada('wamid.A', 'quiero una hamburguesa', T0), entrada('wamid.B', 'doble por favor', T0 + 800)];
const hilo3 = (): Entrada[] => [...hilo2(), entrada('wamid.C', 'sin cebolla', T0 + 1600)];

// ===========================================================================

describe('(1) La pieza está injertada como lo manda el manifiesto: 97 nodos, bien armada', () => {
  it('97 nodos: 93 + los 4 de la ráfaga (+4 autorizado por Andres el 25/11/2026)', () => {
    expect(f.nodes.length).toBe(97);
    for (const n of NODOS_DE_LA_RAFAGA) expect(f.nodes.some((x) => x.name === n), n).toBe(true);
  });

  it('el flujo versionado pasa la guardia común y la ráfaga cuelga del ancla ¿Atención normal? (salida 0) → ¿Es un comprobante?', () => {
    expect(hallazgosDeLaRafaga(f, { exigir: true, fuente: 'Normalizar entrada' })).toEqual([]);
    const con = f.connections;
    const sal0 = (con['¿Atención normal?']?.['main']?.[0] ?? []).map((e) => e.node);
    expect(sal0).toContain('¿Esperar ráfaga?');
    expect(sal0).not.toContain('¿Es un comprobante?');
    expect((con['¿Esperar ráfaga?']?.['main']?.[1] ?? []).map((e) => e.node)).toEqual(['¿Es un comprobante?']);
    expect((con['Agrupar ráfaga']?.['main']?.[0] ?? []).map((e) => e.node)).toEqual(['¿Es un comprobante?']);
  });

  it('«Reportar mensaje (entrante)» va por posición más arriba que la ráfaga (executionOrder v1) y la ráfaga va DESPUÉS de los desvíos', () => {
    const y = (n: string) => nodo(f, n).position?.[1] ?? Number.NaN;
    expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('¿Esperar ráfaga?'));
    // Los desvíos que responden por otra rama cuelgan ANTES del ancla: la ráfaga no es ascendiente de ellos.
    const con = f.connections;
    expect((con['¿Atención normal?']?.['main']?.[1] ?? []).map((e) => e.node)).toEqual(['¿Comprobante en uso extendido?']);
    expect((con['¿Comercio operativo?']?.['main']?.[1] ?? []).map((e) => e.node)).toEqual(['Comercio no operativo']);
  });

  it('el agente lee el texto del turno agrupado y, si no hay, el texto del mensaje; la memoria sigue por teléfono', () => {
    const t = String(nodo(f, 'AI Agent NovuChat').parameters['text']);
    expect(t).toContain('$json.textoDelTurno || $json.userInput');
    expect(JSON.stringify(nodo(f, 'Memoria por teléfono').parameters)).toContain("$('Normalizar entrada').item.json.from");
  });

  it('«Config del negocio» propaga rafagaApagada solo si el servidor la mandó en true', () => {
    const base = { REEMPLAZAR: 'x', textoBienvenida: 'Soy el asistente virtual', nivelEmojis: 'muchos' };
    const correr = (cuerpo: J): J => ejecutar(codigoDe(f, 'Config del negocio'), [{ statusCode: 200, body: { tenantId: 't', ...cuerpo } }], { 'Config base': base })[0] ?? {};
    expect(correr({ rafagaApagada: true })['rafagaApagada']).toBe(true);
    expect(correr({})['rafagaApagada']).toBeUndefined();
    expect(correr({ rafagaApagada: 'si' })['rafagaApagada']).toBeUndefined();
  });

  it('el JSON versionado no lleva datos de ejecución ni credenciales en claro', () => {
    expect(textoDeFlujo('demo-b-venta-cobro.json')).not.toMatch(/Bearer [A-Za-z0-9]{10,}/);
    expect(f.settings?.['saveDataSuccessExecution']).toBe('none');
  });
});

describe('(2) Una ráfaga recibe UNA sola respuesta; un mensaje aislado, igual que hoy', () => {
  it('2 textos seguidos: un solo envío, el agente ve los dos textos y lo reportado sigue siendo el texto crudo de cada uno', () => {
    const w = crear({ hilo: hilo2() });
    const a = w.mundo.turno(texto('wamid.A', 'quiero una hamburguesa'));
    const b = w.mundo.turno(texto('wamid.B', 'doble por favor'));
    expect(total([a, b], envios)).toBe(1);
    expect(envios(a)).toBe(0); // la primera calló: su vecino siguiente cubre su texto
    expect(w.agente.length).toBe(1);
    expect(String(w.agente[0]!.parametros['text'])).toContain('quiero una hamburguesa\ndoble por favor');
    // El reporte entrante de cada uno lleva SU texto (nada de textoDelTurno).
    expect((a.llamadas.ingesta[0] as J)['texto']).toBe('quiero una hamburguesa');
    expect((b.llamadas.ingesta[0] as J)['texto']).toBe('doble por favor');
    expect(b.ejecutados.has('Agrupar ráfaga')).toBe(true);
  });

  it('3 textos seguidos: un solo envío con los tres textos', () => {
    const w = crear({ hilo: hilo3() });
    const rs = [w.mundo.turno(texto('wamid.A', 'quiero una hamburguesa')), w.mundo.turno(texto('wamid.B', 'doble por favor')), w.mundo.turno(texto('wamid.C', 'sin cebolla'))];
    expect(total(rs, envios)).toBe(1);
    expect(String(w.agente[0]!.parametros['text'])).toContain('quiero una hamburguesa\ndoble por favor\nsin cebolla');
  });

  it('un mensaje aislado responde como hoy: un envío, sin texto agrupado', () => {
    const w = crear({ hilo: [entrada('wamid.A', 'hola', T0)] });
    const r = w.mundo.turno(texto('wamid.A', 'hola'));
    expect(envios(r)).toBe(1);
    expect(String(w.agente[0]!.parametros['text'])).toContain('hola');
    expect(r.salidas['Agrupar ráfaga']?.[0]?.[0]?.['textoDelTurno']).toBeUndefined();
    expect(r.orden.indexOf('Reportar mensaje (entrante)')).toBeLessThan(r.orden.indexOf('Agrupar ráfaga'));
  });

  it('la espera es de 2 segundos por defecto y se puede subir con esperaRafagaSeg', () => {
    const w = crear({ hilo: [entrada('wamid.A', 'hola', T0)] });
    expect(w.mundo.turno(texto('wamid.A', 'hola')).esperas).toEqual([{ nodo: 'Esperar ráfaga', segundos: 2 }]);
    const w2 = crear({ hilo: [entrada('wamid.A', 'hola', T0)], base: { esperaRafagaSeg: 4 } });
    expect(w2.mundo.turno(texto('wamid.A', 'hola')).esperas).toEqual([{ nodo: 'Esperar ráfaga', segundos: 4 }]);
  });

  it('el interruptor: rafagaApagada del servidor o rafagaActiva=false en Config base apagan la pieza (cada texto responde solo)', () => {
    for (const apagado of [{ panel: () => conBody({ rafagaApagada: true }) }, { base: { rafagaActiva: false } }]) {
      const w = crear({ hilo: hilo2(), ...apagado });
      const rs = [w.mundo.turno(texto('wamid.A', 'quiero una hamburguesa')), w.mundo.turno(texto('wamid.B', 'doble por favor'))];
      expect(total(rs, envios)).toBe(2);
      expect(w.consultas).toEqual([]);
      expect(rs[0]!.esperas).toEqual([]);
    }
  });
});

describe('(3) Falla ABIERTO y riesgos residuales FIJADOS (docs/arquitectura/rafagas.md)', () => {
  it('consulta caída: responde solo (nadie queda sin respuesta)', () => {
    const w = crear({ hilo: hilo2(), consulta: () => 'cae' });
    const rs = [w.mundo.turno(texto('wamid.A', 'quiero una hamburguesa')), w.mundo.turno(texto('wamid.B', 'doble por favor'))];
    expect(total(rs, envios)).toBe(2);
    expect(String(w.agente[1]!.parametros['text'])).not.toContain('quiero una hamburguesa');
  });

  it('(b) la consulta de la ejecución ANTERIOR cae: su texto se contesta dos veces (lado seguro: duplica, no pierde)', () => {
    const w = crear({ hilo: hilo2(), consulta: (id) => (id === 'wamid.A' ? 'cae' : 'ok') });
    const rs = [w.mundo.turno(texto('wamid.A', 'quiero una hamburguesa')), w.mundo.turno(texto('wamid.B', 'doble por favor'))];
    expect(total(rs, envios)).toBe(2);
    expect(String(w.agente[0]!.parametros['text'])).toContain('quiero una hamburguesa');
    expect(String(w.agente[1]!.parametros['text'])).toContain('quiero una hamburguesa\ndoble por favor');
  });

  it('(a) 7 textos seguidos a menos de 1,5 s: el más viejo queda sin respuesta (declarado); responde uno solo con los otros seis', () => {
    const hilo = Array.from({ length: 7 }, (_, i) => entrada(`wamid.T${i + 1}`, `texto ${i + 1}`, T0 + i * 1000));
    const w = crear({ hilo });
    const rs = hilo.map((e) => w.mundo.turno(texto(e.idMeta, e.texto)));
    expect(total(rs, envios)).toBe(1);
    const visto = String(w.agente[0]!.parametros['text']);
    expect(visto).toContain('texto 2\ntexto 3\ntexto 4\ntexto 5\ntexto 6\ntexto 7');
    expect(visto).not.toContain('texto 1');
  });

  it('6 textos seguidos caben: uno solo responde con los seis', () => {
    const hilo = Array.from({ length: 6 }, (_, i) => entrada(`wamid.T${i + 1}`, `texto ${i + 1}`, T0 + i * 1000));
    const w = crear({ hilo });
    const rs = hilo.map((e) => w.mundo.turno(texto(e.idMeta, e.texto)));
    expect(total(rs, envios)).toBe(1);
    expect(String(w.agente[0]!.parametros['text'])).toContain('texto 1\ntexto 2\ntexto 3\ntexto 4\ntexto 5\ntexto 6');
  });
});

describe('(4) Medios y botones en ráfaga responden como hoy (son separadores, no esperan)', () => {
  it('un texto seguido de un audio: el texto responde solo y el audio, por su camino', () => {
    const hilo = [entrada('wamid.A', 'hola', T0), entrada('wamid.V', '', T0 + 500, 'audio')];
    const w = crear({ hilo });
    const a = w.mundo.turno(texto('wamid.A', 'hola'));
    const v = w.mundo.turno(audio('wamid.V'));
    expect(envios(a)).toBe(1);
    expect(v.ejecutados.has('¿Esperar ráfaga?')).toBe(true); // el IF corre, pero da «no»: el audio no espera ni consulta
    expect(v.ejecutados.has('Esperar ráfaga')).toBe(false);
    expect(v.ejecutados.has('Consultar ráfaga')).toBe(false);
    expect(envios(v)).toBe(1);
  });

  it('un texto seguido de un botón: el texto responde solo; el botón no consulta', () => {
    const hilo = [entrada('wamid.A', 'hola', T0), entrada('wamid.K', 'Sí', T0 + 500, 'interactive')];
    const w = crear({ hilo });
    const a = w.mundo.turno(texto('wamid.A', 'hola'));
    const k = w.mundo.turno(boton('wamid.K'));
    expect(envios(a)).toBe(1);
    expect(k.ejecutados.has('Consultar ráfaga')).toBe(false);
  });
});

describe('(5) QR, aviso y candado de existencias: ni duplicados ni perdidos en una ráfaga', () => {
  it('[ENVIAR_QR] en una ráfaga de 2: un solo QR', () => {
    const w = crear({ hilo: hilo2(), modelo: () => 'Perfecto, te envío el QR. [ENVIAR_QR]' });
    const rs = [w.mundo.turno(texto('wamid.A', 'quiero una hamburguesa')), w.mundo.turno(texto('wamid.B', 'doble por favor'))];
    expect(total(rs, (r) => nodoConteo(r, 'Enviar QR de cobro'))).toBe(1);
    expect(w.agente.length).toBe(1);
  });

  it('[PEDIDO_CONFIRMADO] en una ráfaga de 3: un solo aviso al dueño', () => {
    const w = crear({ hilo: hilo3(), modelo: () => 'Pedido confirmado. [PEDIDO_CONFIRMADO]' });
    const rs = [w.mundo.turno(texto('wamid.A', 'quiero una hamburguesa')), w.mundo.turno(texto('wamid.B', 'doble por favor')), w.mundo.turno(texto('wamid.C', 'sin cebolla'))];
    expect(total(rs, (r) => nodoConteo(r, 'Avisar al dueño'))).toBe(1);
  });

  it('candado de existencias (#1112) NEGANDO: un agotado en una ráfaga NO manda QR ni confirma, y pasa con recepción UNA vez', () => {
    const w = crear({ hilo: hilo2(), modelo: () => 'Listo, una gaseosa y la hamburguesa. [ENVIAR_QR] [PEDIDO_CONFIRMADO]' });
    const rs = [w.mundo.turno(texto('wamid.A', 'quiero una gaseosa')), w.mundo.turno(texto('wamid.B', 'y una hamburguesa'))];
    expect(total(rs, (r) => nodoConteo(r, 'Enviar QR de cobro'))).toBe(0);
    expect(total(rs, (r) => nodoConteo(r, 'Avisar al dueño'))).toBe(0);
    expect(total(rs, (r) => nodoConteo(r, 'Avisar al dueño (transferencia)'))).toBe(1);
    expect(total(rs, envios)).toBe(1);
  });
});

describe('(6) Desvíos antes del ancla: qué pasa con el anterior (fijado; ver «Requisitos de cada flujo»)', () => {
  it('uso extendido (operador) en el segundo texto: el segundo recibe el aviso fijo (un envío) y el primero NO se contesta (declarado)', () => {
    const w = crear({ hilo: hilo2() });
    const a = w.mundo.turno(texto('wamid.A', 'quiero una hamburguesa'));
    w.cambiarPanel(() => conBody({ atencion: { estado: 'operador', respuestasEnVentana: 50 } }));
    const b = w.mundo.turno(texto('wamid.B', 'doble por favor'));
    expect(b.ejecutados.has('Uso extendido')).toBe(true);
    expect(b.ejecutados.has('Agrupar ráfaga')).toBe(false);
    expect(b.ejecutados.has('AI Agent NovuChat')).toBe(false);
    expect(envios(a)).toBe(0);
    expect(envios(b)).toBe(1); // el aviso fijo: un mensaje, no dos
    expect(w.agente.length).toBe(0); // el contenido del primero no llegó al modelo
  });

  it('uso extendido (bloqueado) en el segundo texto: no sale nada y el primero queda sin respuesta (declarado)', () => {
    const w = crear({ hilo: hilo2() });
    const a = w.mundo.turno(texto('wamid.A', 'quiero una hamburguesa'));
    w.cambiarPanel(() => conBody({ atencion: { estado: 'bloqueado', respuestasEnVentana: 100 } }));
    const b = w.mundo.turno(texto('wamid.B', 'doble por favor'));
    expect(total([a, b], envios)).toBe(0);
    expect(w.agente.length).toBe(0);
  });

  it('comercio no operativo (409) en el segundo texto: el segundo recibe el aviso de suspensión y el primero queda sin respuesta (declarado)', () => {
    const w = crear({ hilo: hilo2() });
    const a = w.mundo.turno(texto('wamid.A', 'quiero una hamburguesa'));
    w.cambiarPanel(() => ({ statusCode: 409, body: { estado: 'suspendido', mensajeCortesia: 'Por ahora no atendemos por este medio.' } }));
    const b = w.mundo.turno(texto('wamid.B', 'doble por favor'));
    expect(b.ejecutados.has('Comercio no operativo')).toBe(true);
    expect(b.ejecutados.has('Agrupar ráfaga')).toBe(false);
    expect(total([a, b], envios)).toBe(1);
    expect(w.agente.length).toBe(0);
  });

  it('con el comercio no operativo desde el inicio, un texto no consulta ni espera: la ráfaga no se arma antes del desvío', () => {
    const w = crear({ hilo: hilo2(), panel: () => ({ statusCode: 409, body: { estado: 'suspendido', mensajeCortesia: 'Por ahora no atendemos.' } }) });
    const rs = [w.mundo.turno(texto('wamid.A', 'quiero una hamburguesa')), w.mundo.turno(texto('wamid.B', 'doble por favor'))];
    expect(w.consultas).toEqual([]);
    expect(rs.every((r) => r.esperas.length === 0)).toBe(true);
    expect(total(rs, envios)).toBe(2); // sin la pieza, cada texto recibe el aviso: igual que hoy
  });
});
