/**
 * RÁFAGAS EN EL DEMO A (agendamiento): la pieza común `Flujos/src/core/rafaga/` injertada por la clave `rafaga` del manifiesto.
 *
 * Ejecuta el JSON VERSIONADO (`Flujos/clientes/demo-a/demo-a-agendamiento.json`) con el n8n de mentira: los nodos Code, IF, Wait y Set corren de
 * verdad; lo que sale a la red (servidor, WhatsApp, Gemini, Calendar) responde con un doble por nombre de nodo. «Consultar ráfaga» lo contesta un
 * servidor de mentira que cumple el contrato de `docs/arquitectura/rafagas.md` (hasta 5 predecesores, el propio y hasta 3 sucesores, solo lo ya
 * escrito a `ms propio + espera`).
 *
 * COSTO: 0 mensajes agregados; en una ráfaga de n textos quita n-1.
 *
 * LOS DESVÍOS DE ESTE FLUJO (todos ANTES del ancla `¿Atención normal?[0]`, salvo los dos de medios, que no son textos):
 *   1. `¿Es un mensaje?` (acuses de estado): no es un mensaje, no entra a la ráfaga ni deja huérfano a nadie (no se guarda).
 *   2. `¿Comercio operativo?` falso -> `Comercio no operativo`.
 *   3. `¿Atención normal?[1]` (operador / bloqueado) -> uso extendido.
 *   Después del ancla: `¿Es un comprobante?` y `¿Trae un medio?` solo desvían imágenes, audios y documentos: la pieza ni espera ni calla un medio, y
 *   un medio entre dos textos los separa.
 * Si el estado de un desvío CAMBIA entre dos textos de la misma ráfaga (el comercio se suspende, el teléfono pasa el umbral de operador), el
 * primero ya calló por el segundo y nadie lo contesta: es el riesgo residual declarado, fijado acá (`huérfano`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { crearMundo, type LlamadaDoble, type Doble } from './lib/n8n-de-mentira';
import { ejecutar, type Flujo, type J } from './lib/flujo';

const aqui = dirname(fileURLToPath(import.meta.url));
const RUTA = join(aqui, '../../Flujos/clientes/demo-a/demo-a-agendamiento.json');
const TEXTO = readFileSync(RUTA, 'utf8');

// El arnés no tiene `$now` (Luxon): se lo sustituye por un literal SOLO en la copia que corre, el resto del prompt va intacto.
const sinNow = (v: unknown): unknown => {
  if (typeof v === 'string') return v.replace(/\$now\.setZone\([^)]*\)\.setLocale\([^)]*\)\.toFormat\((?:[^()]|\([^)]*\))*\)/g, "'FECHA'");
  if (Array.isArray(v)) return v.map(sinNow);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as J).map(([k, x]) => [k, sinNow(x)]));
  return v;
};
const FLUJO = JSON.parse(TEXTO) as Flujo;
const flujoDePrueba = (): Flujo => ({ ...FLUJO, nodes: FLUJO.nodes.map((n) => ({ ...n, parameters: sinNow(n.parameters) as J })) });

const TEL = '59170000001';
const PHONE_ID = '100000000000042';
const T0 = Date.UTC(2026, 10, 25, 15, 0, 0);
const ESPERA_MS = 2000;

interface Fragmento { idMeta: string; tipo: string; texto: string; ms: number }

interface Opciones {
  /** Los mensajes del hilo, ya escritos en el servidor (con su `ms`). Los que no son textos de este teléfono no se agregan solos. */
  hilo: Fragmento[];
  /** `idMeta` cuya consulta cae (después del reintento). */
  consultaCae?: string[];
  estadoComercio?: string;
  atencion?: J;
  configBase?: Record<string, unknown>;
  agente?: (llamada: LlamadaDoble) => J;
  extras?: Record<string, Doble>;
}

function crear(o: Opciones) {
  const envios: { a: string; texto: string }[] = [];
  const avisos: string[] = [];
  const textosAlAgente: string[] = [];
  const consultas: string[] = [];
  const panel = (): J => ({ tenantId: 'demo-a', estadoComercio: o.estadoComercio ?? 'activo', atencion: o.atencion ?? { estado: 'normal' } });
  const dobles: Record<string, Doble> = {
    'Traer configuración': () => ({ statusCode: 200, body: panel() }),
    'Reportar mensaje (entrante)': () => ({ ok: true }),
    'Reportar mensaje (saliente)': () => ({ ok: true }),
    'Registrar cierre (cita)': () => ({ ok: true }),
    'Enviar contacto': () => ({ messages: [{ id: 'wamid.CONTACTO' }] }),
    'Reportar contacto (saliente)': () => ({ ok: true }),
    'Enviar ubicación': () => ({ messages: [{ id: 'wamid.UBIC' }] }),
    'Reportar ubicación (saliente)': () => ({ ok: true }),
    'Consultar ráfaga': (ll) => {
      const idMeta = String((ll.cuerpo?.['rafaga'] as J | undefined)?.['idMeta'] ?? '');
      consultas.push(idMeta);
      if ((o.consultaCae ?? []).includes(idMeta)) throw new Error('el servidor no contestó');
      const propio = o.hilo.find((f) => f.idMeta === idMeta);
      if (!propio) return { rafaga: { v: 1, fragmentos: [] } };
      const visibles = o.hilo.filter((f) => f.ms <= propio.ms + ESPERA_MS).sort((a, b) => a.ms - b.ms);
      const i = visibles.findIndex((f) => f.idMeta === idMeta);
      // El contrato del servidor: hasta 5 predecesores, el propio y hasta 3 sucesores.
      const desde = Math.max(0, i - 5);
      return { rafaga: { v: 1, fragmentos: visibles.slice(desde, i + 4) } };
    },
    'AI Agent (Sofía)': (ll) => {
      textosAlAgente.push(String(ll.parametros['text'] ?? ''));
      return o.agente ? o.agente(ll) : { output: 'Claro, ¿para qué día y servicio?' };
    },
    'Responder al cliente': (ll) => {
      envios.push({ a: String(ll.parametros['recipientPhoneNumber'] ?? ''), texto: String(ll.parametros['textBody'] ?? '') });
      return { messaging_product: 'whatsapp', messages: [{ id: `wamid.SAL${envios.length}` }] };
    },
    'Avisar a recepción': (ll) => { avisos.push(String(ll.parametros['textBody'] ?? '')); return { messages: [{ id: 'wamid.AVISO' }] }; },
    'Verificar en el calendario': () => [{ json: {} }].map((x) => x.json),
    ...(o.extras ?? {}),
  };
  const mundo = crearMundo({
    flujo: flujoDePrueba(), dobles, ahoraMs: T0,
    roles: { ingesta: ['Reportar mensaje (entrante)', 'Reportar mensaje (saliente)'] },
    configBase: { phoneNumberIdEsperado: PHONE_ID, phoneNumberId: PHONE_ID, numeroRecepcion: '59170000009', calendarioId: 'cal-demo@group.calendar.invalid', ...(o.configBase ?? {}) },
  });
  return { mundo, envios, avisos, textosAlAgente, consultas, dobles };
}

const payload = (msg: J) => ({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: '59170000002', phone_number_id: PHONE_ID },
  contacts: [{ profile: { name: 'Cliente de prueba' }, wa_id: TEL }],
  messages: [{ from: TEL, timestamp: '0', ...msg }],
});
const texto = (id: string, cuerpo: string) => payload({ id, type: 'text', text: { body: cuerpo } });
const acuse = () => ({ messaging_product: 'whatsapp', metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: 'wamid.X', status: 'delivered', recipient_id: TEL }] });
const frag = (id: string, cuerpo: string, ms: number, tipo = 'text'): Fragmento => ({ idMeta: id, tipo, texto: cuerpo, ms: T0 + ms });
const turno = (m: ReturnType<typeof crear>, entrada: J) => m.mundo.turno(entrada, { avanzarMin: 0 });

describe('Demo A + ráfaga: la pieza en el flujo versionado', () => {
  it('el flujo tiene 86 nodos: los 82 de antes y los 4 de la pieza, y ningún nodo propio más', () => {
    expect(FLUJO.nodes).toHaveLength(86);
    const nuevos = ['¿Esperar ráfaga?', 'Esperar ráfaga', 'Consultar ráfaga', 'Agrupar ráfaga'];
    for (const n of nuevos) expect(FLUJO.nodes.filter((x) => x.name === n), n).toHaveLength(1);
  });

  it('«Reportar mensaje (entrante)» corre ANTES de la pieza: por posición y en una ejecución real', () => {
    const y = (n: string) => (FLUJO.nodes.find((x) => x.name === n)?.position ?? [0, 0])[1];
    expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('¿Esperar ráfaga?'));
    expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('¿Comercio operativo?'));
    const m = crear({ hilo: [frag('wamid.A', 'hola', 0)] });
    const r = turno(m, texto('wamid.A', 'hola'));
    const orden = r.orden;
    expect(orden.indexOf('Reportar mensaje (entrante)')).toBeGreaterThan(-1);
    expect(orden.indexOf('Reportar mensaje (entrante)')).toBeLessThan(orden.indexOf('¿Esperar ráfaga?'));
  });

  it('el ancla va DESPUÉS de los desvíos que responden por otra rama: la pieza cuelga de «¿Atención normal?» (salida normal) y entra a «¿Es un comprobante?»', () => {
    const c = FLUJO.connections;
    expect(c['¿Atención normal?']?.['main']?.[0]?.map((x) => x.node)).toContain('¿Esperar ráfaga?');
    expect(c['¿Atención normal?']?.['main']?.[0]?.map((x) => x.node)).not.toContain('¿Es un comprobante?');
    expect(c['¿Esperar ráfaga?']?.['main']?.[1]?.map((x) => x.node)).toEqual(['¿Es un comprobante?']);
    expect(c['Agrupar ráfaga']?.['main']?.[0]?.map((x) => x.node)).toEqual(['¿Es un comprobante?']);
    // Ningún desvío de respuesta queda DESPUÉS del ancla salvo los de medios.
    expect(c['¿Comercio operativo?']?.['main']?.[1]?.map((x) => x.node)).toEqual(['Comercio no operativo']);
    expect(c['¿Atención normal?']?.['main']?.[1]?.map((x) => x.node)).toEqual(['¿Comprobante en uso extendido?']);
  });
});

describe('Demo A + ráfaga: lo que se gana', () => {
  it('ráfaga de 2 textos: UN solo envío, y el agente recibe los dos textos', () => {
    const hilo = [frag('wamid.A', 'hola', 0), frag('wamid.B', 'quiero una cita', 900)];
    const m = crear({ hilo });
    const r1 = turno(m, texto('wamid.A', 'hola'));
    const r2 = turno(m, texto('wamid.B', 'quiero una cita'));
    expect(m.envios).toHaveLength(1);
    expect(m.envios[0]?.a).toBe(TEL);
    expect(r1.esperas).toEqual([{ nodo: 'Esperar ráfaga', segundos: 2 }]);
    expect(r2.esperas).toEqual([{ nodo: 'Esperar ráfaga', segundos: 2 }]);
    expect(m.textosAlAgente).toHaveLength(1);
    expect(m.textosAlAgente[0]).toContain('[MENSAJE DEL CLIENTE]\nhola\nquiero una cita');
    // El primero terminó en silencio: nunca llegó al agente.
    expect(r1.ejecutados.has('AI Agent (Sofía)')).toBe(false);
    expect(r2.ejecutados.has('AI Agent (Sofía)')).toBe(true);
  });

  it('DE PUNTA A PUNTA: ráfaga de dos textos → el primero calla (nada llega al envío) y el turno del segundo lleva AMBOS textos con UN envío al cliente', () => {
    const hilo = [frag('wamid.A', 'hola', 0), frag('wamid.B', 'quiero una cita', 900)];
    const m = crear({ hilo });
    const r1 = turno(m, texto('wamid.A', 'hola'));
    // El primero: pasó el ancla, esperó, consultó, y «Agrupar ráfaga» no devolvió nada; después de la pieza no corrió ningún nodo.
    expect(r1.ejecutados.has('Agrupar ráfaga')).toBe(true);
    expect(r1.porNodo['Agrupar ráfaga'] ?? []).toEqual([]);
    expect(r1.ejecutados.has('¿Es un comprobante?')).toBe(false);
    expect(r1.ejecutados.has('Responder al cliente')).toBe(false);
    expect(m.envios).toHaveLength(0);
    const r2 = turno(m, texto('wamid.B', 'quiero una cita'));
    // El segundo: «Agrupar ráfaga» emite textoDelTurno con los dos, el agente lo recibe y sale UN envío.
    expect(r2.porNodo['Agrupar ráfaga']?.[0]?.['textoDelTurno']).toBe('hola\nquiero una cita');
    expect(m.textosAlAgente).toHaveLength(1);
    expect(m.textosAlAgente[0]?.endsWith('[MENSAJE DEL CLIENTE]\nhola\nquiero una cita')).toBe(true);
    expect(m.envios).toHaveLength(1);
    expect(m.envios[0]?.a).toBe(TEL);
  });

  it('ráfaga de 3 textos: UN solo envío con los tres', () => {
    const hilo = [frag('wamid.A', 'hola', 0), frag('wamid.B', 'quiero una cita', 900), frag('wamid.C', 'para mañana', 1800)];
    const m = crear({ hilo });
    for (const f of hilo) turno(m, texto(f.idMeta, f.texto));
    expect(m.envios).toHaveLength(1);
    expect(m.textosAlAgente).toHaveLength(1);
    expect(m.textosAlAgente[0]).toContain('hola\nquiero una cita\npara mañana');
  });

  it('lo que se reporta y se guarda es el texto CRUDO de cada mensaje, no el agrupado', () => {
    const hilo = [frag('wamid.A', 'hola', 0), frag('wamid.B', 'quiero una cita', 900)];
    const m = crear({ hilo });
    const r1 = turno(m, texto('wamid.A', 'hola'));
    const r2 = turno(m, texto('wamid.B', 'quiero una cita'));
    const guardados = [...r1.llamadas.ingesta, ...r2.llamadas.ingesta].filter((c) => c['direccion'] === 'entrante').map((c) => c['texto']);
    expect(guardados).toEqual(['hola', 'quiero una cita']);
  });

  it('mensaje aislado: igual que hoy (un envío, el texto propio), con la espera de 2 s y una sola consulta', () => {
    const m = crear({ hilo: [frag('wamid.A', 'hola', 0)] });
    const r = turno(m, texto('wamid.A', 'hola'));
    expect(m.envios).toHaveLength(1);
    expect(m.textosAlAgente[0]).toContain('[MENSAJE DEL CLIENTE]\nhola');
    expect(m.textosAlAgente[0]).not.toContain('hola\n');
    expect(m.consultas).toEqual(['wamid.A']);
    expect(r.esperas).toHaveLength(1);
  });

  it('dos mensajes separados por más de la espera NO se agrupan: cada uno se responde', () => {
    const hilo = [frag('wamid.A', 'hola', 0), frag('wamid.B', 'quiero una cita', 9000)];
    const m = crear({ hilo });
    for (const f of hilo) turno(m, texto(f.idMeta, f.texto));
    expect(m.envios).toHaveLength(2);
  });

  it('el interruptor por flujo (`rafagaActiva` en «Config base») apaga la pieza: sin espera, sin consulta, un envío por texto como hoy', () => {
    const hilo = [frag('wamid.A', 'hola', 0), frag('wamid.B', 'quiero una cita', 900)];
    const m = crear({ hilo, configBase: { rafagaActiva: 'false' } });
    const rs = hilo.map((f) => turno(m, texto(f.idMeta, f.texto)));
    expect(m.envios).toHaveLength(2);
    expect(m.consultas).toEqual([]);
    for (const r of rs) expect(r.esperas).toEqual([]);
  });

  it('el interruptor por comercio (`rafagaApagada` que el servidor pone en la configuración) apaga la pieza cuando «Config del negocio» la trae', () => {
    const hilo = [frag('wamid.A', 'hola', 0), frag('wamid.B', 'quiero una cita', 900)];
    // «Config del negocio» es del core y hoy no copia `rafagaApagada` de la respuesta (ver la prueba siguiente): acá se la agrega al item
    // para demostrar que el IF de la pieza SÍ la obedece cuando llega.
    const m = crear({ hilo });
    const nodo = m.mundo.flujo.nodes.find((n) => n.name === 'Config del negocio');
    (nodo!.parameters as J)['jsCode'] = String((nodo!.parameters as J)['jsCode']).replace(/return \[\{ json: \{ \.\.\.base, \.\.\.atencion, diasProximos, \.\.\.laCancelacion, \.\.\.deLaConsola/, 'return [{ json: { rafagaApagada: true, ...base, ...atencion, diasProximos, ...laCancelacion, ...deLaConsola');
    const rs = hilo.map((f) => turno(m, texto(f.idMeta, f.texto)));
    expect(m.envios).toHaveLength(2);
    expect(m.consultas).toEqual([]);
    for (const r of rs) expect(r.esperas).toEqual([]);
  });

  it('LIMITACIÓN VIVA: el «Config del negocio» común (core) hoy NO propaga `rafagaApagada` de la respuesta del servidor; sin eso la bandera por comercio no apaga nada', () => {
    const m = crear({ hilo: [frag('wamid.A', 'hola', 0)], extras: { 'Traer configuración': () => ({ statusCode: 200, body: { tenantId: 'demo-a', estadoComercio: 'activo', rafagaApagada: true } }) } });
    const r = turno(m, texto('wamid.A', 'hola'));
    expect(r.porNodo['Config del negocio']?.[0]?.['rafagaApagada']).toBeUndefined();
    expect(r.ejecutados.has('Consultar ráfaga')).toBe(true);
  });
});

describe('Demo A + ráfaga: fallas y riesgos residuales declarados', () => {
  it('consulta caída: responde (falla abierto), no se queda mudo', () => {
    const m = crear({ hilo: [frag('wamid.A', 'hola', 0)], consultaCae: ['wamid.A'] });
    turno(m, texto('wamid.A', 'hola'));
    expect(m.envios).toHaveLength(1);
    expect(m.textosAlAgente[0]).toContain('[MENSAJE DEL CLIENTE]\nhola');
  });

  it('RIESGO (b): si cae la consulta de la ejecución ANTERIOR, esa responde sola y la siguiente la incluye: el texto se contesta dos veces (lado seguro)', () => {
    const hilo = [frag('wamid.A', 'hola', 0), frag('wamid.B', 'quiero una cita', 900)];
    const m = crear({ hilo, consultaCae: ['wamid.A'] });
    for (const f of hilo) turno(m, texto(f.idMeta, f.texto));
    expect(m.envios).toHaveLength(2);
    expect(m.textosAlAgente).toHaveLength(2);
    expect(m.textosAlAgente[0]).toContain('[MENSAJE DEL CLIENTE]\nhola');
    expect(m.textosAlAgente[1]).toContain('hola\nquiero una cita');
  });

  it('RIESGO: si cae la consulta de quien debía responder el grupo, responde solo y el texto callado por él no se contesta (se pierde)', () => {
    const hilo = [frag('wamid.A', 'hola', 0), frag('wamid.B', 'quiero una cita', 900)];
    const m = crear({ hilo, consultaCae: ['wamid.B'] });
    for (const f of hilo) turno(m, texto(f.idMeta, f.texto));
    expect(m.envios).toHaveLength(1);
    expect(m.textosAlAgente[0]).toContain('[MENSAJE DEL CLIENTE]\nquiero una cita');
    expect(m.textosAlAgente[0]).not.toContain('hola');
  });

  it('RIESGO (a): 8 textos seguidos a 1 s: responde UNO solo y los dos más viejos quedan fuera (el servidor entrega a lo sumo 5 predecesores)', () => {
    const hilo = Array.from({ length: 8 }, (_, i) => frag(`wamid.M${i + 1}`, `texto ${i + 1}`, i * 1000));
    const m = crear({ hilo });
    for (const f of hilo) turno(m, texto(f.idMeta, f.texto));
    expect(m.envios).toHaveLength(1);
    const visto = m.textosAlAgente[0] ?? '';
    expect(visto).toContain('texto 8');
    expect(visto).toContain('texto 3');
    expect(visto).not.toContain('texto 1\n');
    expect(visto).not.toContain('texto 2\n');
  });

  it('un reintento de Meta (mismo idMeta repetido en el hilo) cuenta una sola vez', () => {
    const hilo = [frag('wamid.A', 'hola', 0), frag('wamid.A', 'hola', 100), frag('wamid.B', 'quiero una cita', 900)];
    const m = crear({ hilo });
    turno(m, texto('wamid.A', 'hola'));
    turno(m, texto('wamid.B', 'quiero una cita'));
    expect(m.envios).toHaveLength(1);
    expect(m.textosAlAgente[0]).toContain('[MENSAJE DEL CLIENTE]\nhola\nquiero una cita');
    expect(m.textosAlAgente[0]).not.toContain('hola\nhola');
  });
});

describe('Demo A + ráfaga: un caso por desvío (nadie queda huérfano, o el huérfano está fijado)', () => {
  it('desvío 1 · acuse de estado: no es mensaje, no consulta, no envía, y no rompe la ráfaga de sus vecinos', () => {
    const hilo = [frag('wamid.A', 'hola', 0), frag('wamid.B', 'quiero una cita', 900)];
    const m = crear({ hilo });
    turno(m, texto('wamid.A', 'hola'));
    const ra = turno(m, acuse());
    turno(m, texto('wamid.B', 'quiero una cita'));
    expect(ra.ejecutados.has('Consultar ráfaga')).toBe(false);
    expect(ra.ejecutados.has('Config base')).toBe(false);
    expect(m.envios).toHaveLength(1);
    expect(m.textosAlAgente[0]).toContain('hola\nquiero una cita');
  });

  it('desvío 2 · comercio no operativo estable: cada texto se contesta como hoy, sin espera ni consulta ni agente', () => {
    const hilo = [frag('wamid.A', 'hola', 0), frag('wamid.B', 'quiero una cita', 900)];
    const m = crear({ hilo, estadoComercio: 'suspendido' });
    const rs = hilo.map((f) => turno(m, texto(f.idMeta, f.texto)));
    expect(m.envios).toHaveLength(2);
    expect(m.consultas).toEqual([]);
    expect(m.textosAlAgente).toEqual([]);
    for (const r of rs) expect(r.esperas).toEqual([]);
  });

  it('desvío 2 · HUÉRFANO declarado: si el comercio se suspende ENTRE los dos textos, el primero ya calló por el segundo y solo sale el aviso de no operativo', () => {
    const hilo = [frag('wamid.A', 'hola', 0), frag('wamid.B', 'quiero una cita', 900)];
    const m = crear({ hilo });
    turno(m, texto('wamid.A', 'hola'));
    m.mundo.dobles['Traer configuración'] = () => ({ statusCode: 200, body: { tenantId: 'demo-a', estadoComercio: 'suspendido', atencion: { estado: 'normal' } } });
    turno(m, texto('wamid.B', 'quiero una cita'));
    expect(m.envios).toHaveLength(1);
    expect(m.textosAlAgente).toEqual([]);
  });

  it('desvío 3 · atención de un operador estable: cada texto recibe el aviso fijo como hoy, sin espera ni agente', () => {
    const hilo = [frag('wamid.A', 'hola', 0), frag('wamid.B', 'quiero una cita', 900)];
    const m = crear({ hilo, atencion: { estado: 'operador', mensajeFijo: 'Una persona le atiende en breve.', respuestasEnVentana: 51 } });
    const rs = hilo.map((f) => turno(m, texto(f.idMeta, f.texto), ));
    expect(m.consultas).toEqual([]);
    expect(m.textosAlAgente).toEqual([]);
    for (const r of rs) { expect(r.esperas).toEqual([]); expect(r.ejecutados.has('Uso extendido')).toBe(true); }
  });

  it('desvío 3 · HUÉRFANO declarado: si el teléfono pasa al umbral de operador ENTRE los dos textos, el primero calló y el segundo recibe el aviso fijo', () => {
    const hilo = [frag('wamid.A', 'hola', 0), frag('wamid.B', 'quiero una cita', 900)];
    const m = crear({ hilo });
    turno(m, texto('wamid.A', 'hola'));
    m.mundo.dobles['Traer configuración'] = () => ({ statusCode: 200, body: { tenantId: 'demo-a', estadoComercio: 'activo', atencion: { estado: 'bloqueado', respuestasEnVentana: 100 } } });
    const r = turno(m, texto('wamid.B', 'quiero una cita'));
    expect(m.textosAlAgente).toEqual([]);
    expect(r.ejecutados.has('Uso extendido')).toBe(true);
    expect(m.envios.length).toBeLessThanOrEqual(1);
  });
});

const audio = (id: string) => payload({ id, type: 'audio', audio: { id: 'media-audio-1', mime_type: 'audio/ogg; codecs=opus' } });
const DOBLES_AUDIO: Record<string, Doble> = {
  'Obtener URL del medio (general)': () => ({ url: 'https://medios.ejemplo.invalid/a', mime_type: 'audio/ogg', file_size: 20000 }),
  'Descargar medio': () => ({}),
  'Transcribir audio': () => ({ content: { parts: [{ text: 'quiero cortarme el pelo' }] } }),
};

describe('Demo A + ráfaga: medios entre textos (después del ancla solo desvían medios)', () => {
  it('texto, audio, texto: el audio separa y cada uno se responde como hoy (3 envíos, ninguno callado)', () => {
    const hilo = [frag('wamid.A', 'hola', 0), frag('wamid.AU', '', 700, 'audio'), frag('wamid.B', 'quiero una cita', 1400)];
    const m = crear({ hilo, extras: DOBLES_AUDIO });
    const r1 = turno(m, texto('wamid.A', 'hola'));
    const r2 = turno(m, audio('wamid.AU'));
    const r3 = turno(m, texto('wamid.B', 'quiero una cita'));
    expect(m.envios).toHaveLength(3);
    // El audio ni espera ni consulta: la pieza solo mira textos.
    expect(r2.ejecutados.has('Esperar ráfaga')).toBe(false);
    expect(r2.ejecutados.has('Consultar ráfaga')).toBe(false);
    expect(r1.ejecutados.has('Agrupar ráfaga')).toBe(true);
    expect(r3.ejecutados.has('Agrupar ráfaga')).toBe(true);
    expect(m.textosAlAgente[0]).toContain('[MENSAJE DEL CLIENTE]\nhola');
    expect(m.textosAlAgente[1]).toContain('quiero cortarme el pelo');
    expect(m.textosAlAgente[2]).toContain('[MENSAJE DEL CLIENTE]\nquiero una cita');
    expect(m.textosAlAgente[2]).not.toContain('hola');
  });

  it('un audio solo responde igual que antes de la pieza', () => {
    const m = crear({ hilo: [frag('wamid.AU', '', 0, 'audio')], extras: DOBLES_AUDIO });
    const r = turno(m, audio('wamid.AU'));
    expect(r.esperas).toEqual([]);
    expect(m.envios).toHaveLength(1);
  });
});

describe('Demo A + ráfaga: candado de reservas y aviso a recepción, sin duplicar ni perderse', () => {
  it('ráfaga de 2 con [TRANSFERIR]: UNA respuesta y UN aviso a recepción (no uno por texto)', () => {
    const hilo = [frag('wamid.A', 'quiero hablar con alguien', 0), frag('wamid.B', 'es urgente', 900)];
    const m = crear({ hilo, agente: () => ({ output: 'Te paso con una persona del equipo. [TRANSFERIR]' }) });
    for (const f of hilo) turno(m, texto(f.idMeta, f.texto));
    expect(m.envios).toHaveLength(1);
    expect(m.avisos).toHaveLength(1);
    expect(m.avisos[0]).toContain(TEL);
  });

  it('el mismo caso SIN ráfaga (interruptor apagado) manda dos respuestas y dos avisos: la pieza es la que quita el duplicado', () => {
    const hilo = [frag('wamid.A', 'quiero hablar con alguien', 0), frag('wamid.B', 'es urgente', 900)];
    const m = crear({ hilo, configBase: { rafagaActiva: 'false' }, agente: () => ({ output: 'Te paso con una persona del equipo. [TRANSFERIR]' }) });
    for (const f of hilo) turno(m, texto(f.idMeta, f.texto));
    expect(m.envios).toHaveLength(2);
    expect(m.avisos).toHaveLength(2);
  });

  it('CANDADO POR HECHO dentro de una ráfaga: agendar_cita corrió sin crear la cita y el modelo dice «quedó agendada»: no sale esa frase, UNA respuesta y UN aviso', () => {
    const hilo = [frag('wamid.A', 'quiero una cita mañana', 0), frag('wamid.B', 'a las 9 con María', 900)];
    const agente = (): J => ({
      output: 'Listo, quedó agendada tu cita para mañana a las 9:00.',
      intermediateSteps: [{ action: { tool: 'agendar_cita', toolInput: {} }, observation: '' }],
    });
    const m = crear({ hilo, agente });
    for (const f of hilo) turno(m, texto(f.idMeta, f.texto));
    expect(m.envios).toHaveLength(1);
    expect(m.envios[0]?.texto).not.toMatch(/quedó agendada/i);
    expect(m.envios[0]?.texto).toMatch(/recepci/i);
    expect(m.avisos).toHaveLength(1);
  });

  it('el reintento tras un cruce de horario vuelve a entrar con el texto AGRUPADO (`textoDelTurno`), no solo con el último mensaje', () => {
    const codigo = String(FLUJO.nodes.find((n) => n.name === 'Retomar respuesta')?.parameters['jsCode']);
    const base = { from: TEL, respuesta: 'Listo, quedó agendada.', citasCaidas: [{ causa: 'cruce', hora: '09:00', fecha: 'mañana' }], avisoDelTurno: '', motivoCruce: 'cruce' };
    const correr = (agrupado: string | null) => ejecutar(codigo, [{ error: undefined }], {
      'Comprobar reserva': [base],
      'Normalizar entrada': [{ userInput: 'a las 9 con María' }],
      'Procesar respuesta': [{ respuesta: 'x' }],
      ...(agrupado === null ? {} : { 'Agrupar ráfaga': [{ rafaga: { accion: 'agrupado', ids: ['a', 'b'] }, textoDelTurno: agrupado }] }),
    })[0] as J;
    expect(correr('quiero una cita mañana\na las 9 con María')['userInput']).toBe('quiero una cita mañana\na las 9 con María');
    // Sin la pieza en esta ejecución (o si no agrupó) queda el texto crudo de siempre.
    expect(correr(null)['userInput']).toBe('a las 9 con María');
    expect(correr('')['userInput']).toBe('a las 9 con María');
  });

  it('el prompt del turno lee `textoDelTurno` y, sin él, el texto crudo', () => {
    const t = String(FLUJO.nodes.find((n) => n.name === 'AI Agent (Sofía)')?.parameters['text']);
    expect(t).toContain('{{ $json.textoDelTurno || $json.userInput }}');
  });
});
