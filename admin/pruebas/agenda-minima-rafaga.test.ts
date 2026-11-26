/**
 * LA RÁFAGA EN BELLIDO (Agenda mínima v0): la pieza común del core (`Flujos/src/core/rafaga/`) sobre el JSON versionado, de punta a punta, sin red (25/11/2026).
 *
 * Ejecuta `agenda-minima.v0.json` (el de producción, el que corre en Bellido) y `agenda-minima.prueba.json` con el n8n de mentira genérico (`./lib/n8n-de-mentira`):
 * los Code corren su código de verdad, los IF evalúan su condición, el Wait anota su espera, y lo que va a la red (el servidor de la ráfaga, Meta, Gemini, Calendar)
 * responde con un doble. Cada TURNO es una ejecución del flujo (un mensaje entrante); una ráfaga son varias ejecuciones seguidas del mismo teléfono, cada una con su
 * propia consulta al servidor de mentira (que devuelve, relativo al mensaje pedido, hasta 5 anteriores, el propio y hasta 3 posteriores, como el servidor real).
 *
 * Qué se prueba, negando cada cosa:
 *  - dos y tres textos seguidos: UN solo envío, con los textos unidos; un mensaje aislado sale igual que sin la pieza;
 *  - consulta caída: responde solo (falla abierto); el interruptor `rafagaApagada` (servidor) y `rafagaActiva` (flujo) la apagan;
 *  - medios, botones y listas no esperan ni se callan; las rutas de seguridad (emergencia, recepción, baja) responden UNA vez con el texto agrupado;
 *  - el orden de las ramas: «Reportar mensaje (entrante)» corre antes de la pieza (por posición y por ejecución), y lo reportado es el texto crudo;
 *  - los riesgos residuales, FIJADOS: 7 o más textos seguidos, la consulta caída de una ejecución y los desvíos (comercio no operativo, atención de una persona).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Flujo, J } from './lib/flujo';
import { crearMundo, type Doble, type Enviado, type ResultadoTurno } from './lib/n8n-de-mentira';

const CARPETA = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/clientes/agenda-minima');
const leerJson = (archivo: string): Flujo => JSON.parse(readFileSync(join(CARPETA, archivo), 'utf8')) as Flujo;
const PRODUCCION = leerJson('agenda-minima.v0.json');
const PRUEBA = leerJson('agenda-minima.prueba.json');

// ------------------------------------------------------------------------ datos de ejemplo (números sintéticos: seis ceros seguidos)
const PID = '59100000003';
const MAMA = '59100000011';
const REC = '59100000001';
const DOC = '59100000002';
const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0); // lunes 05/10/2026, 10:00 en La Paz
const CAL = 'cal-ejemplo';

const PANEL = {
  tenantId: 'consultorio-ejemplo',
  estadoComercio: 'activo',
  datosDelNegocio: {
    nombreNegocio: 'Consultorio Ejemplo — Pediatría',
    descripcion: 'Consultorio de pediatría de ejemplo.',
    mensajeMenu: '¡Hola! Soy la asistente virtual del consultorio. Elige la opción que necesitas:',
    mensajeEmergencia: 'Comunícate AHORA con recepción tocando el botón. Ya le avisé al doctor.',
    mensajeContactoRecepcion: 'Te paso con recepción: toca el botón y escríbele directo.',
    mensajeComercioSuspendido: 'El consultorio no está atendiendo por este medio por ahora.',
  },
  operacion: { numeroDoctor: DOC, numeroRecepcion: REC, calendarioId: CAL, prefijosPermitidos: ['591'] },
  funcionarios: [{ porDefecto: true, horarioTrabajo: { lun: '11:00-18:00', mar: '11:00-18:00', mie: '11:00-18:00', jue: '14:00-18:00', vie: '11:00-18:00', sab: '09:00-12:00', dom: 'cerrado' } }],
  agendamiento: { duracionPorDefectoMin: 30, anticipacionMinimaMin: 120, anticipacionMaximaDias: 60 },
  voz: { tratamiento: 'Tutea siempre.', emojis: 'Pocos emojis.', nivelEmojis: 'pocos' },
  atencion: { estado: 'normal' },
};

let seq = 0;
const meta = (from: string, msg: J, id = `wamid.R${++seq}`): J => ({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: PID, phone_number_id: PID },
  contacts: [{ profile: { name: 'Mamá de Ana' }, wa_id: from }],
  messages: [Object.assign({ from, id, timestamp: '1' }, msg)],
});
const idDe = (entrada: J): string => String(((entrada['messages'] as J[])[0] as J)['id']);
const escrito = (from: string, body: string, id?: string): J => meta(from, { type: 'text', text: { body } }, id);
const lista = (from: string, id: string, title: string): J => meta(from, { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } });
const boton = (from: string, id: string): J => meta(from, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } });
const imagen = (from: string): J => meta(from, { type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg' } });

// ------------------------------------------------------------------------ el servidor de la ráfaga, de mentira
interface Fragmento { idMeta: string; tipo: string; texto: string; ms: number }
/** Lo que guarda el servidor del hilo y lo que devuelve la rama `rafaga` de `configuracionFlujo`: relativo al mensaje pedido, 5 anteriores, el propio y 3 posteriores. */
function servidorDelHilo() {
  const hilo: Fragmento[] = [];
  const caen = new Set<string>();
  const consultas: string[] = [];
  const doble: Doble = (llamada) => {
    const pedido = ((llamada.cuerpo as J)['rafaga'] as J)['idMeta'] as string;
    consultas.push(pedido);
    if (caen.has(pedido)) throw new Error('el servidor no responde');
    const lista = hilo.slice().sort((a, b) => (a.ms - b.ms) || (a.idMeta < b.idMeta ? -1 : 1));
    const i = lista.findIndex((f) => f.idMeta === pedido);
    return { rafaga: { v: 1, fragmentos: i < 0 ? [] : lista.slice(Math.max(0, i - 5), i + 4) } };
  };
  return { hilo, caen, consultas, doble };
}
type Servidor = ReturnType<typeof servidorDelHilo>;

// ------------------------------------------------------------------------ el mundo
interface EventoDeMentira { id: string; summary: string; description: string; start: { dateTime: string }; end: { dateTime: string }; status: string }
interface OpcionesMundo {
  flujo?: Flujo;
  panel?: J;
  configBase?: Record<string, unknown>;
  /** La respuesta de «Reportar mensaje (entrante)» (de ahí salen la atención y el estado del servicio). */
  ingesta?: J | (() => J);
}
const respuestaGemini = (t: unknown): J => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(t) }] } }] });
const extraccionDesconocida = respuestaGemini({ intencion: 'agendar', servicio: 'desconocido', franja: 'cualquiera', fechaPreferida: null, horaPreferida: null, pacientes: [] });

function crear(op: OpcionesMundo = {}) {
  const srv = servidorDelHilo();
  let panel: J = op.panel ?? PANEL;
  const config = { panel: () => panel };
  const extraidos: J[] = [];
  const eventos: EventoDeMentira[] = [];
  let extraccion: J = extraccionDesconocida;
  const dobles: Record<string, Doble> = {
    'Traer configuración': () => ({ statusCode: 200, body: config.panel() }),
    'Reportar mensaje (entrante)': () => (typeof op.ingesta === 'function' ? op.ingesta() : Object.assign({ atencion: { estado: 'normal' }, servicio: { estado: 'activo' } }, op.ingesta ?? {})),
    'Reportar mensaje (saliente)': { ok: true },
    'Consultar ráfaga': srv.doble,
    Extraer: (ll) => { extraidos.push(ll.cuerpo as J); return extraccion; },
    'Enviar a WhatsApp': (ll) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.OUT${ll.n}` }] }),
    'Enviar respaldo': (ll) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.RESP${ll.n}` }] }),
    'Obtener URL del medio (general)': { url: 'https://lookaside.fbsbx.com/medio', file_size: 5000, mime_type: 'image/jpeg' },
    'Descargar medio': { descargado: true },
    'Describir imagen': { content: { parts: [{ text: JSON.stringify({ categoria: 'otro', descripcion: '', texto: '' }) }] } },
    'Describir documento': { content: { parts: [{ text: JSON.stringify({ categoria: 'otro', descripcion: '', texto: '' }) }] } },
    'Indicador de escritura': { success: true },
    'Pedir el medio a Meta (guardado)': { id: 'm', url: 'https://lookaside.fbsbx.com/guardado', mime_type: 'image/jpeg', file_size: 1000 },
    'Descargar medio (guardado)': { descargado: true },
    'Guardar medio': { statusCode: 409, headers: {}, body: { error: 'guardado_apagado' } },
    'Reintentar el guardado': { statusCode: 409, headers: {}, body: { error: 'guardado_apagado' } },
    'Avisar falla del guardado': { messaging_product: 'whatsapp', messages: [{ id: 'wamid.GUARDADO' }] },
    'Registrar cierre (cita)': { ok: true },
    'Leer agenda': () => (eventos.length ? eventos.map((e) => ({ ...e })) : [{}]),
    'Releer el hueco': () => (eventos.length ? eventos.map((e) => ({ ...e })) : [{}]),
    'Crear evento': (ll) => {
      const extra = (ll.parametros['additionalFields'] ?? {}) as J;
      const e: EventoDeMentira = { id: `ev-${eventos.length + 1}`, status: 'confirmed', summary: String(extra['summary'] ?? ''), description: String(extra['description'] ?? ''), start: { dateTime: String(ll.parametros['start']) }, end: { dateTime: String(ll.parametros['end']) } };
      eventos.push(e);
      return { ...e };
    },
    'Deshacer cita': (ll) => { const i = eventos.findIndex((e) => e.id === ll.parametros['eventId']); if (i >= 0) eventos.splice(i, 1); return { success: true }; },
    Redactar: { candidates: [{ content: { parts: [{ text: 'Estos son los horarios. Toca el que prefieras.' }] } }] },
    'Buscar teléfono en planilla': [], 'Leer IDs de la planilla': [], 'Leer encabezados de la planilla': [], 'Agregar fila': [], 'Actualizar fila': [],
  };
  const mundo = crearMundo({ flujo: op.flujo ?? PRODUCCION, dobles, ahoraMs: AHORA, configBase: op.configBase });
  return { mundo, srv, config, extraidos, eventos, ponerExtraccion: (e: J) => { extraccion = e; }, ponerPanel: (p: J) => { panel = p; } };
}
type M = ReturnType<typeof crear>;

/** Cuenta lo que se le mandó a la mamá (no al personal): el costo real de la conversación. */
const aLaMama = (r: ResultadoTurno): string[] => r.mensajesA(MAMA).map((e) => e.cuerpo);
const huboEspera = (r: ResultadoTurno): boolean => r.esperas.some((e) => e.nodo === 'Esperar ráfaga');
const corrio = (r: ResultadoTurno, nodo: string): boolean => r.ejecutados.has(nodo);

/** Corre una ráfaga: todos los mensajes ya están en el hilo del servidor (llegaron con `pasoMs` de diferencia) y cada uno dispara SU ejecución, en orden. */
function rafaga(m: M, entradas: J[], opciones: { pasoMs?: number; desde?: number; tipo?: string } = {}): ResultadoTurno[] {
  const paso = opciones.pasoMs ?? 700;
  const base = opciones.desde ?? 1_000_000;
  entradas.forEach((e, i) => {
    const msg = (e['messages'] as J[])[0] as J;
    const tipo = String(msg['type']);
    m.srv.hilo.push({ idMeta: idDe(e), tipo, texto: tipo === 'text' ? String((msg['text'] as J)['body']) : '', ms: base + i * paso });
  });
  return entradas.map((e) => m.mundo.turno(e, { avanzarMin: 0 }));
}
const envios = (rs: ResultadoTurno[]): string[] => rs.flatMap(aLaMama);

// =================================================================================================
describe('Bellido (Agenda mínima v0) con la ráfaga: la forma del flujo', () => {
  it('suma EXACTAMENTE los cuatro nodos de la pieza: 73 + 4 = 77 nodos, en las dos variantes', () => {
    expect(PRODUCCION.nodes).toHaveLength(77);
    expect(PRUEBA.nodes).toHaveLength(77);
    for (const f of [PRODUCCION, PRUEBA]) {
      const nombres = f.nodes.map((n) => n.name);
      for (const n of ['¿Esperar ráfaga?', 'Esperar ráfaga', 'Consultar ráfaga', 'Agrupar ráfaga']) expect(nombres.filter((x) => x === n), n).toHaveLength(1);
    }
  });
  it('el tope de nodos de Bellido (77) está declarado en el construir.mjs con la autorización de Andres del 25/11', () => {
    const fuente = readFileSync(join(CARPETA, 'construir.mjs'), 'utf8');
    expect(fuente).toMatch(/const TOPE_DE_NODOS = 77;/);
    expect(fuente).toMatch(/Andres el 25\/11\/2026/);
    expect(fuente).toMatch(/Sí, \+4 nodos por flujo/);
  });
  it('el ancla va DESPUÉS de los desvíos (¿Atención normal? → ráfaga → ¿Bajar medio?) y «Reportar mensaje (entrante)» va ARRIBA, por posición', () => {
    const c = PRODUCCION.connections;
    const destinos = (de: string, i: number): string[] => (c[de]?.['main']?.[i] ?? []).map((x) => x.node);
    expect(destinos('¿Atención normal?', 0)).toEqual(['¿Esperar ráfaga?']);
    expect(destinos('¿Atención normal?', 1)).toEqual(['Uso extendido']);
    expect(destinos('¿Comercio operativo?', 0)).toEqual(['¿Atención normal?']);
    expect(destinos('¿Comercio operativo?', 1)).toEqual(['Comercio no operativo']);
    expect(destinos('¿Esperar ráfaga?', 0)).toEqual(['Esperar ráfaga']);
    expect(destinos('¿Esperar ráfaga?', 1)).toEqual(['¿Bajar medio?']);
    expect(destinos('Agrupar ráfaga', 0)).toEqual(['¿Bajar medio?']);
    const y = (nombre: string): number => (PRODUCCION.nodes.find((n) => n.name === nombre)!.position as number[])[1] as number;
    expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('¿Esperar ráfaga?'));
    expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('Decidir turno'));
  });
  it('lee el mensaje de «Normalizar entrada» (el item del ancla es la respuesta del reporte, un HTTP en línea) y el texto del campo `texto`', () => {
    const si = PRODUCCION.nodes.find((n) => n.name === '¿Esperar ráfaga?')!;
    const izquierda = JSON.stringify(si.parameters);
    expect(izquierda).toContain("$('Normalizar entrada').first().json");
    const agrupar = String(PRODUCCION.nodes.find((n) => n.name === 'Agrupar ráfaga')!.parameters['jsCode']);
    expect(agrupar).toContain("const FUENTE = 'Normalizar entrada';");
    expect(agrupar).toContain("const CAMPO_TEXTO = 'texto';");
  });
  it('«Config del negocio» propaga `rafagaApagada` desde la respuesta de configuracionFlujo (solo con `true`)', () => {
    const codigo = String(PRODUCCION.nodes.find((n) => n.name === 'Config del negocio')!.parameters['jsCode']);
    expect(codigo).toContain('rafagaApagada: codigo === 200 && cuerpo.rafagaApagada === true');
  });
});

// =================================================================================================
describe('un solo envío por ráfaga', () => {
  it('DOS textos seguidos: UN solo mensaje a la mamá, con los dos textos juntos en el turno que responde; la otra ejecución termina callada', () => {
    const m = crear();
    const rs = rafaga(m, [escrito(MAMA, 'hola'), escrito(MAMA, 'quiero cita el jueves')]);
    expect(rs.every((r) => r.fallo === null)).toBe(true);
    expect(envios(rs)).toHaveLength(1);
    // La primera ejecución esperó, consultó y calló: nunca llegó al código que decide el turno.
    expect(huboEspera(rs[0]!)).toBe(true);
    expect(corrio(rs[0]!, 'Agrupar ráfaga')).toBe(true);
    expect(corrio(rs[0]!, 'Decidir turno')).toBe(false);
    expect(aLaMama(rs[0]!)).toHaveLength(0);
    // La segunda decide con los dos textos: lo que dijo antes del menú se guarda entero para no hacérselo repetir.
    expect(corrio(rs[1]!, 'Decidir turno')).toBe(true);
    expect(rs[1]!.porNodo['Agrupar ráfaga']![0]!['textoDelTurno']).toBe('hola\nquiero cita el jueves');
    expect(rs[1]!.porNodo['Decidir turno']![0]!['texto']).toBe('hola\nquiero cita el jueves');
    expect((m.mundo.sd as J)).toBeTruthy();
  });
  it('TRES textos seguidos: UN solo mensaje, y el modelo extrae sobre los tres textos juntos (una sola llamada)', () => {
    const m = crear();
    const primero = m.mundo.turno(escrito(MAMA, 'hola'), { avanzarMin: 0 }); // paso 'inicio': el menú
    expect(aLaMama(primero)).toHaveLength(1);
    const rs = rafaga(m, [escrito(MAMA, 'quiero cita'), escrito(MAMA, 'para mi hija'), escrito(MAMA, 'el jueves en la tarde')], { desde: 2_000_000 });
    expect(envios(rs)).toHaveLength(1);
    expect(rs.map((r) => corrio(r, 'Decidir turno'))).toEqual([false, false, true]);
    expect(m.extraidos).toHaveLength(1);
    const cuerpo = JSON.stringify(m.extraidos[0]);
    for (const frase of ['quiero cita', 'para mi hija', 'el jueves en la tarde']) expect(cuerpo, frase).toContain(frase);
  });
  it('lo que se REPORTA y guarda es el texto crudo de CADA mensaje (la pieza no lo toca) y «Reportar» corre ANTES de la espera', () => {
    const m = crear();
    const rs = rafaga(m, [escrito(MAMA, 'hola'), escrito(MAMA, 'quiero cita el jueves')]);
    const entrantes = rs.flatMap((r) => r.llamadas.ingesta).filter((c) => c['direccion'] === 'entrante');
    expect(entrantes.map((c) => c['texto'])).toEqual(['hola', 'quiero cita el jueves']);
    for (const r of rs) {
      const orden = r.orden;
      expect(orden.indexOf('Reportar mensaje (entrante)')).toBeGreaterThanOrEqual(0);
      expect(orden.indexOf('Reportar mensaje (entrante)')).toBeLessThan(orden.indexOf('¿Esperar ráfaga?'));
      expect(orden.indexOf('¿Esperar ráfaga?')).toBeLessThan(orden.indexOf('Esperar ráfaga'));
    }
  });
  it('un mensaje AISLADO sale igual que sin la pieza (mismo texto, mismo botón), con la espera de 2 s y sin `textoDelTurno`', () => {
    const con = crear();
    const sin = crear({ panel: { ...PANEL, rafagaApagada: true } });
    const a = rafaga(con, [escrito(MAMA, 'hola')])[0]!;
    const b = rafaga(sin, [escrito(MAMA, 'hola')])[0]!;
    expect(a.mensajes.map((e) => e.payload)).toEqual(b.mensajes.map((e) => e.payload));
    expect(aLaMama(a)).toHaveLength(1);
    expect(a.esperas).toEqual([{ nodo: 'Esperar ráfaga', segundos: 2 }]);
    expect(a.porNodo['Agrupar ráfaga']![0]!['rafaga']).toMatchObject({ accion: 'solo' });
    expect(a.porNodo['Agrupar ráfaga']![0]!['textoDelTurno']).toBeUndefined();
    expect(b.esperas).toHaveLength(0);
  });
  it('dos mensajes separados por MÁS de la espera NO se juntan: dos respuestas, como hoy', () => {
    const m = crear();
    const rs = rafaga(m, [escrito(MAMA, 'hola'), escrito(MAMA, 'quiero cita el jueves')], { pasoMs: 6000 });
    expect(rs.map((r) => aLaMama(r).length)).toEqual([1, 1]);
  });
  it('la consulta caída: el turno responde SOLO (falla abierto), nunca se queda sin contestar', () => {
    const m = crear();
    const e = escrito(MAMA, 'hola');
    m.srv.caen.add(idDe(e));
    const r = rafaga(m, [e])[0]!;
    expect(r.fallo).toBeNull();
    expect(m.srv.consultas).toEqual([idDe(e)]);
    expect(aLaMama(r)).toHaveLength(1);
    expect(r.porNodo['Agrupar ráfaga']![0]!['rafaga']).toMatchObject({ accion: 'solo' });
  });
});

// =================================================================================================
describe('los interruptores', () => {
  it('`rafagaApagada` en la ficha del tenant (la lee el servidor y llega por «Config del negocio»): sin espera, sin consulta, una respuesta por mensaje', () => {
    const m = crear({ panel: { ...PANEL, rafagaApagada: true } });
    const rs = rafaga(m, [escrito(MAMA, 'hola'), escrito(MAMA, 'quiero cita el jueves')]);
    expect(rs.some(huboEspera)).toBe(false);
    expect(m.srv.consultas).toHaveLength(0);
    expect(rs.map((r) => aLaMama(r).length)).toEqual([1, 1]);
  });
  it('NIEGA: `rafagaApagada: false` (o cualquier valor que no sea `true`) NO apaga la pieza', () => {
    for (const valor of [false, 'true', 1, null]) {
      const m = crear({ panel: { ...PANEL, rafagaApagada: valor } });
      const rs = rafaga(m, [escrito(MAMA, 'hola'), escrito(MAMA, 'quiero cita el jueves')]);
      expect(envios(rs), String(valor)).toHaveLength(1);
    }
  });
  it('`rafagaActiva: false` en «Config base» apaga la pieza del flujo; `esperaRafagaSeg` fija la espera (acotada a 1-5)', () => {
    const apagada = crear({ configBase: { rafagaActiva: 'false' } });
    expect(rafaga(apagada, [escrito(MAMA, 'hola'), escrito(MAMA, 'quiero cita')]).map((r) => aLaMama(r).length)).toEqual([1, 1]);
    const larga = crear({ configBase: { esperaRafagaSeg: 4 } });
    expect(rafaga(larga, [escrito(MAMA, 'hola')])[0]!.esperas).toEqual([{ nodo: 'Esperar ráfaga', segundos: 4 }]);
    const excesiva = crear({ configBase: { esperaRafagaSeg: 60 } });
    expect(rafaga(excesiva, [escrito(MAMA, 'hola')])[0]!.esperas).toEqual([{ nodo: 'Esperar ráfaga', segundos: 5 }]);
  });
  it('sin respuesta del panel no se apaga la pieza (la respuesta de la configuración no es `200`, `rafagaApagada` queda en `false`)', () => {
    const m = crear({ panel: { error: 'x' } });
    const r = rafaga(m, [escrito(MAMA, 'hola')])[0]!;
    expect(r.porNodo['Config del negocio']![0]!['rafagaApagada']).toBe(false);
  });
  it('en el modo de prueba (Webhook de ensayo) no se reporta y por eso la ráfaga ni se arma: sin espera, sin consulta', () => {
    const m = crear({ flujo: PRUEBA });
    const cuerpo = (t: string): J => ({ body: Object.assign({}, escrito(MAMA, t), { modoPrueba: true, telefonoDePrueba: '59100000004', enviarDeVerdad: true, calendarioDePrueba: 'cal-de-prueba' }) });
    const rs = [m.mundo.turno(cuerpo('hola'), { avanzarMin: 0 }), m.mundo.turno(cuerpo('quiero cita'), { avanzarMin: 0 })];
    expect(rs.some(huboEspera)).toBe(false);
    expect(m.srv.consultas).toHaveLength(0);
    expect(corrio(rs[0]!, 'Reportar mensaje (entrante)')).toBe(false);
  });
});

// =================================================================================================
describe('medios, botones y listas: no esperan ni se callan', () => {
  it('un toque de lista y un toque de botón no esperan, no consultan y responden como hoy', () => {
    const m = crear();
    const l = m.mundo.turno(lista(MAMA, 'control_nino_sano', 'Control niño sano'), { avanzarMin: 0 });
    const b = m.mundo.turno(boton(MAMA, 'h|2026-10-08T14:00:00-04:00|control_nino_sano'), { avanzarMin: 0 });
    expect(huboEspera(l) || huboEspera(b)).toBe(false);
    expect(m.srv.consultas).toHaveLength(0);
    expect(corrio(l, 'Decidir turno') && corrio(b, 'Decidir turno')).toBe(true);
  });
  it('un texto y una imagen seguidos: el texto NO la espera (la imagen es separador) y los dos responden, como hoy', () => {
    const m = crear();
    const t = escrito(MAMA, 'hola');
    const i = imagen(MAMA);
    const rs = rafaga(m, [t, i]);
    expect(corrio(rs[1]!, 'Decidir turno')).toBe(true);
    expect(corrio(rs[0]!, 'Decidir turno')).toBe(true);
    expect(rs.map((r) => aLaMama(r).length)).toEqual([1, 1]);
    expect(huboEspera(rs[1]!)).toBe(false); // la imagen no espera
    expect(rs[0]!.porNodo['Agrupar ráfaga']![0]!['rafaga']).toMatchObject({ accion: 'solo' });
  });
  it('un texto, una imagen en medio y otro texto: no se juntan (el separador los desconecta)', () => {
    const m = crear();
    const rs = rafaga(m, [escrito(MAMA, 'hola'), imagen(MAMA), escrito(MAMA, 'quiero cita el jueves')], { pasoMs: 400 });
    expect(rs.map((r) => aLaMama(r).length)).toEqual([1, 1, 1]);
  });
});

// =================================================================================================
describe('las rutas de seguridad y los avisos se cumplen UNA vez con el texto agrupado (sin duplicar ni perderse)', () => {
  const alPersonal = (rs: ResultadoTurno[]): Enviado[] => rs.flatMap((r) => r.mensajes).filter((e) => e.a !== MAMA);
  it('EMERGENCIA en una ráfaga: UN solo mensaje a la mamá (con el botón a recepción) y UNA sola alerta al doctor', () => {
    const m = crear();
    const rs = rafaga(m, [escrito(MAMA, 'mi hija no respira'), escrito(MAMA, 'sigue igual, es urgente')]);
    expect(envios(rs)).toHaveLength(1);
    expect(aLaMama(rs[1]!)[0]).toContain('recepción');
    expect(alPersonal(rs).map((e) => e.a)).toEqual([DOC]);
    expect(rs[1]!.resumen!['resumen']).toMatchObject({ ruta: 'emergencia' });
  });
  it('NIEGA: con la pieza apagada la misma emergencia avisa DOS veces al doctor y escribe DOS veces a la mamá (lo que la ráfaga evita)', () => {
    const m = crear({ panel: { ...PANEL, rafagaApagada: true } });
    const rs = rafaga(m, [escrito(MAMA, 'mi hija no respira'), escrito(MAMA, 'sigue igual, es urgente')]);
    expect(envios(rs)).toHaveLength(2);
    expect(alPersonal(rs).map((e) => e.a)).toEqual([DOC, DOC]);
  });
  it('palabra de recepción en el segundo texto: UN mensaje a la mamá con el botón y UN solo camino de transferencia', () => {
    const m = crear({ configBase: { palabrasClaveRecepcion: 'recepcion|secretaria' } });
    const rs = rafaga(m, [escrito(MAMA, 'hola buenas'), escrito(MAMA, 'necesito hablar con recepcion')]);
    expect(envios(rs)).toHaveLength(1);
    expect(rs[1]!.resumen!['resumen']).toMatchObject({ ruta: 'contacto_recepcion' });
    expect(alPersonal(rs).length).toBeLessThanOrEqual(1);
  });
  it('una BAJA en el primer texto de la ráfaga se cumple aunque el último texto diga otra cosa (se evalúa línea por línea)', () => {
    const m = crear();
    const rs = rafaga(m, [escrito(MAMA, 'no me escriban más'), escrito(MAMA, 'gracias')]);
    expect(envios(rs)).toHaveLength(1);
    expect(rs[1]!.resumen!['resumen']).toMatchObject({ ruta: 'baja' });
    // El reporte de CADA mensaje marca por su cuenta (la baja se registra por el texto crudo del primero).
    const marcas = rs.flatMap((r) => r.llamadas.ingesta).filter((c) => c['direccion'] === 'entrante').map((c) => c['evento']);
    expect(marcas).toEqual(['no_contactar', undefined]);
  });
  it('NIEGA: una baja suelta sin ráfaga sigue siendo una baja (la línea que la dice basta)', () => {
    const m = crear({ panel: { ...PANEL, rafagaApagada: true } });
    const r = rafaga(m, [escrito(MAMA, 'no me escriban más')])[0]!;
    expect(r.resumen!['resumen']).toMatchObject({ ruta: 'baja' });
  });
});

// =================================================================================================
describe('la reserva: el candado y la cita no se duplican ni se pierden con una ráfaga', () => {
  const JUEVES = '2026-10-08';
  const SERV = 'control_nino_sano';
  /** Lleva la conversación hasta que la mamá tiene los tres horarios del jueves en la tarde en pantalla. */
  function hastaLasOfertas(m: M): ResultadoTurno {
    m.mundo.turno(escrito(MAMA, 'quiero cita el jueves en la tarde'), { avanzarMin: 0 });
    m.ponerExtraccion(respuestaGemini({ intencion: 'agendar', servicio: SERV, franja: 'tarde', fechaPreferida: JUEVES, horaPreferida: null, pacientes: [] }));
    return m.mundo.turno(lista(MAMA, SERV, 'Control niño sano'), { avanzarMin: 0 });
  }
  it('la oferta sale como botones de hueco (el punto de partida de la prueba)', () => {
    const m = crear();
    const o = hastaLasOfertas(m);
    expect(aLaMama(o)).toHaveLength(1);
    expect(JSON.stringify(o.mensajes[0]!.payload)).toContain(`h|${JUEVES}T14:00:00-04:00|${SERV}`);
  });
  it('dos textos que eligen la hora y dan el nombre: UNA cita en el calendario, UNA respuesta, y el candado corre sobre ella', () => {
    const m = crear();
    hastaLasOfertas(m);
    const rs = rafaga(m, [escrito(MAMA, 'la de las 14:00'), escrito(MAMA, 'a nombre de Ana Pérez')], { desde: 3_000_000 });
    expect(rs.every((r) => r.fallo === null)).toBe(true);
    // Una sola cita; la confirmación (y el cierre que la sigue, dos mensajes del flujo mismo) salen UNA vez, del turno que responde.
    expect(m.eventos).toHaveLength(1);
    expect(m.eventos[0]!.start.dateTime).toContain(`${JUEVES}T14:00`);
    expect(rs[1]!.ejecutados.has('Candado')).toBe(true);
    expect(aLaMama(rs[0]!)).toHaveLength(0);
    expect(envios(rs).filter((t) => /quedó agendada/.test(t))).toHaveLength(1);
    expect(envios(rs)).toHaveLength(2);
  });
  it('NIEGA: la ejecución que calló por la siguiente no crea nada ni toca el calendario (el candado no corre dos veces sobre el mismo turno)', () => {
    const m = crear();
    hastaLasOfertas(m);
    const rs = rafaga(m, [escrito(MAMA, 'la de las 14:00'), escrito(MAMA, 'a nombre de Ana Pérez')], { desde: 3_000_000 });
    for (const nodo of ['Leer agenda', 'Crear evento', 'Releer el hueco', 'Candado', 'Deshacer cita', 'Registrar cierre (cita)']) expect(rs[0]!.ejecutados.has(nodo), nodo).toBe(false);
  });
});

// =================================================================================================
describe('riesgos residuales FIJADOS (comportamiento declarado en docs/arquitectura/rafagas.md)', () => {
  it('(a) 7 o más textos seguidos a menos de 1,5 s: responde UNO, con los 6 más nuevos; el más viejo queda SIN respuesta (declarado)', () => {
    const m = crear();
    const textos = ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete'];
    const rs = rafaga(m, textos.map((t) => escrito(MAMA, `quiero ${t}`)), { pasoMs: 700 });
    expect(envios(rs)).toHaveLength(1);
    const ultimo = rs[6]!;
    const decidido = String(ultimo.porNodo['Agrupar ráfaga']![0]!['textoDelTurno']);
    expect(decidido).toContain('quiero siete');
    expect(decidido).toContain('quiero dos');
    expect(decidido).not.toContain('quiero uno');
    expect(rs.slice(0, 6).every((r) => aLaMama(r).length === 0)).toBe(true);
  });
  it('(a) con SEIS textos seguidos caben todos y se contestan juntos', () => {
    const m = crear();
    const rs = rafaga(m, ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'].map((t) => escrito(MAMA, `quiero ${t}`)), { pasoMs: 700 });
    expect(envios(rs)).toHaveLength(1);
    expect(String(rs[5]!.porNodo['Agrupar ráfaga']![0]!['textoDelTurno']).split('\n')).toHaveLength(6);
  });
  it('(b) la consulta caída de UNA ejecución DUPLICA su texto (lado seguro): A responde solo y el grupo de C lo incluye otra vez', () => {
    const m = crear();
    const a = escrito(MAMA, 'quiero cita');
    m.srv.caen.add(idDe(a));
    const rs = rafaga(m, [a, escrito(MAMA, 'para mi hija'), escrito(MAMA, 'el jueves')]);
    expect(envios(rs)).toHaveLength(2);
    expect(aLaMama(rs[0]!)).toHaveLength(1); // A, sola
    expect(aLaMama(rs[1]!)).toHaveLength(0); // B calla por C
    expect(String(rs[2]!.porNodo['Agrupar ráfaga']![0]!['textoDelTurno'])).toContain('quiero cita'); // el texto de A, dos veces
  });
  it('(b) la consulta caída de quien debía RESPONDER el grupo PIERDE los textos callados (declarado): responde solo con el suyo', () => {
    const m = crear();
    const b = escrito(MAMA, 'el jueves');
    m.srv.caen.add(idDe(b));
    const rs = rafaga(m, [escrito(MAMA, 'quiero cita'), b]);
    expect(envios(rs)).toHaveLength(1);
    expect(rs[1]!.porNodo['Decidir turno']![0]!['texto']).toBe('el jueves'); // 'quiero cita' calló por B y nadie lo contestó
  });
  it('(c) DESVÍO «Comercio no operativo»: si el comercio se corta entre dos textos, el segundo sale por el aviso de cortesía; el primero (callado por él) queda sin respuesta propia, pero la mamá NO queda sin nada', () => {
    const m = crear();
    const a = escrito(MAMA, 'hola');
    const b = escrito(MAMA, 'quiero cita');
    // La primera ejecución consulta cuando el segundo ya está en el hilo y calla por él.
    m.srv.hilo.push({ idMeta: idDe(a), tipo: 'text', texto: 'hola', ms: 1_000_000 }, { idMeta: idDe(b), tipo: 'text', texto: 'quiero cita', ms: 1_000_700 });
    const r1 = m.mundo.turno(a, { avanzarMin: 0 });
    m.ponerPanel({ ...PANEL, estadoComercio: 'suspendido' });
    const r2 = m.mundo.turno(b, { avanzarMin: 0 });
    expect(aLaMama(r1)).toHaveLength(0);
    expect(corrio(r2, 'Comercio no operativo')).toBe(true);
    expect(corrio(r2, '¿Esperar ráfaga?')).toBe(false); // el desvío va ANTES del ancla: el mensaje desviado ni espera ni consulta
    expect(aLaMama(r2)).toEqual([PANEL.datosDelNegocio.mensajeComercioSuspendido]);
  });
  it('(c) DESVÍO «Uso extendido» (atención de una persona): el mensaje desviado sale por el aviso fijo y no por la ráfaga; el anterior, callado por él, queda sin respuesta del asistente', () => {
    let atencion: J = { estado: 'normal' };
    const m = crear({ ingesta: () => ({ atencion, servicio: { estado: 'activo' } }) });
    const a = escrito(MAMA, 'hola');
    const b = escrito(MAMA, 'quiero cita');
    m.srv.hilo.push({ idMeta: idDe(a), tipo: 'text', texto: 'hola', ms: 1_000_000 }, { idMeta: idDe(b), tipo: 'text', texto: 'quiero cita', ms: 1_000_700 });
    const r1 = m.mundo.turno(a, { avanzarMin: 0 });
    atencion = { estado: 'operador', respuestasEnVentana: 30, avisarRecepcion: 'operador' };
    const r2 = m.mundo.turno(b, { avanzarMin: 0 });
    expect(aLaMama(r1)).toHaveLength(0);
    expect(corrio(r2, 'Uso extendido')).toBe(true);
    expect(corrio(r2, '¿Esperar ráfaga?')).toBe(false);
    expect(corrio(r2, 'Decidir turno')).toBe(false);
    expect(aLaMama(r2)).toHaveLength(1);
  });
  it('(c) DESVÍO de un número extranjero (filtro de país de «Interpretar entrada»): ninguno de la ráfaga llega a la pieza ni se contesta (no hay huérfano: nadie responde)', () => {
    const m = crear();
    const rs = rafaga(m, [escrito('12000000100', 'hola'), escrito('12000000100', 'quiero cita')]);
    expect(rs.every((r) => !corrio(r, '¿Esperar ráfaga?'))).toBe(true);
    expect(envios(rs)).toHaveLength(0);
    expect(m.srv.consultas).toHaveLength(0);
  });
  it('(c) DESVÍO «reenvío de Meta» (mismo id): el reenvío del último texto no se contesta dos veces', () => {
    const m = crear();
    const b = escrito(MAMA, 'quiero cita el jueves');
    const rs = rafaga(m, [escrito(MAMA, 'hola'), b]);
    expect(envios(rs)).toHaveLength(1);
    const reenvio = m.mundo.turno(b, { avanzarMin: 0 });
    expect(aLaMama(reenvio)).toHaveLength(0);
  });
});
