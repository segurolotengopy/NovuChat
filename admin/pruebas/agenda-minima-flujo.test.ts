/**
 * EL FLUJO «AGENDA MÍNIMA v0», DE PUNTA A PUNTA, SIN RED (`Flujos/experimental/agenda-minima/`).
 *
 * Principio del flujo: el código calcula, el modelo conversa. Esta suite lee los DOS JSON armados
 * (`agenda-minima.v0.json`, el de producción, y `agenda-minima.prueba.json`, el del Webhook de prueba)
 * y corre el código de CADA nodo Code con el evaluador compartido (`./lib/flujo`, que lleva la marca de
 * Semgrep y le quita al código los globales que el sandbox de n8n no tiene). No hay un `new Function`
 * nuevo acá.
 *
 * EL n8n DE MENTIRA. Recorre el grafo siguiendo `connections`, nodo por nodo:
 *   - los nodos Code corren su código de verdad;
 *   - los IF evalúan la condición que traen en sus `parameters`;
 *   - «Config base» (Set) mezcla sus asignaciones;
 *   - los nodos de red son dobles: configuración de ejemplo (sin datos reales), ingesta, Gemini con
 *     respuestas fijas por caso, un Google Calendar en memoria (getAll, create, delete) y una Graph
 *     API que responde ok o `error`. Los dobles EVALÚAN las expresiones del JSON (el cuerpo de la
 *     petición, el id del evento, el calendario): si un nodo apuntara mal, la prueba lo vería.
 *   - un nodo desactivado deja pasar su entrada, como en n8n.
 *   - `$getWorkflowStaticData` persiste entre los turnos de un mismo caso; el reloj está congelado.
 *
 * Cada caso es uno o varios turnos de una conversación, y cada caso trae su «niega»: lo contrario
 * también se prueba, para que una prueba que siempre pasa no pase por casualidad.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';
import { ejecutar, type Flujo, type J, type Nodo, type Referencias } from './lib/flujo';

const CARPETA = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/agenda-minima');
const leerJson = (archivo: string): Flujo => JSON.parse(readFileSync(join(CARPETA, archivo), 'utf8')) as Flujo;
const PRODUCCION = leerJson('agenda-minima.v0.json');
const PRUEBA = leerJson('agenda-minima.prueba.json');

// ------------------------------------------------------------------------ datos de ejemplo
// Números sintéticos (seis ceros seguidos) y un consultorio inventado: nada real.
const PID = '59100000003'; // phone_number_id del número de WhatsApp del negocio
const MAMA = '59100000011';
const OTRA = '59100000022';
const REC = '59100000001';
const DOC = '59100000002';
const PRUEBA_TEL = '59100000004';
// Lunes 05/10/2026, 10:00 en La Paz (UTC-4). Nada mira el reloj real: las pruebas no caducan.
const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);
const CAL = 'cal-ejemplo';

const PANEL = {
  tenantId: 'consultorio-ejemplo',
  estadoComercio: 'activo',
  datosDelNegocio: {
    nombreNegocio: 'Consultorio Ejemplo — Pediatría',
    descripcion: 'Consultorio de pediatría de ejemplo.',
    direccion: 'Calle Ejemplo 123, piso 1',
    direccionMaps: 'https://maps.app.goo.gl/ejemplo123',
    instruccionesExtra: 'AL CONFIRMAR LA CITA: incluye esta aclaración: "Recuerda que hay 10 minutos de tolerancia: pasado ese tiempo, el doctor puede reprogramar tu cita."',
    mensajeCierre: 'Gracias por escribirnos.',
    mensajeErrorTemporal: 'Disculpa, tuve un problema técnico momentáneo.',
    mensajeMenu: '¡Hola! Soy la asistente virtual del consultorio. Elige la opción que necesitas:',
    mensajeEmergencia: 'Comunícate AHORA con recepción tocando el botón. Ya le avisé al doctor.',
    mensajeContactoDoctor: 'Eso lo coordina el doctor. Tócale el botón y le escribes directo.',
  },
  operacion: { numeroDoctor: DOC, numeroRecepcion: REC, calendarioId: CAL, prefijosPermitidos: ['591'] },
  funcionarios: [{
    porDefecto: true,
    horarioTrabajo: { lun: '11:00-18:00', mar: '11:00-18:00', mie: '11:00-18:00', jue: '14:00-18:00', vie: '11:00-18:00', sab: '09:00-12:00', dom: 'cerrado' },
  }],
  agendamiento: { duracionPorDefectoMin: 30, anticipacionMinimaMin: 120, anticipacionMaximaDias: 60 },
  voz: { tratamiento: 'Tutea siempre.', emojis: 'Pocos emojis.', nivelEmojis: 'pocos' },
  atencion: { estado: 'normal' },
};

const iso = (fecha: string, hhmm: string): string => `${fecha}T${hhmm}:00-04:00`;
const JUEVES = '2026-10-08';
const VIERNES = '2026-10-09';
const SERV_CNS = 'control_nino_sano';
const SERV_RN = 'control_recien_nacido';
const idHueco = (fecha: string, hhmm: string, srv = SERV_CNS): string => `h|${iso(fecha, hhmm)}|${srv}`;

/** Un evento de Google Calendar, como lo devuelve el nodo (getAll). */
function evento(id: string, fecha: string, desde: string, hasta: string, resumen: string, descripcion = ''): J {
  return { id, summary: resumen, description: descripcion, status: 'confirmed', start: { dateTime: iso(fecha, desde) }, end: { dateTime: iso(fecha, hasta) } };
}
const citaDe = (tel: string, id: string, fecha: string, desde: string, hasta: string, titulo: string): J =>
  evento(id, fecha, desde, hasta, titulo, `Cliente: X\nTelefono: ${tel}\nAgendado por NovuChat.`);

// ------------------------------------------------------------------------ mensajes entrantes
let seqMsg = 0;
const valorMeta = (msg: J, from: string): J => ({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: PID, phone_number_id: PID },
  contacts: [{ profile: { name: 'Mamá de Ana' }, wa_id: from }],
  messages: [Object.assign({ from, id: `wamid.IN${++seqMsg}`, timestamp: '1' }, msg)],
});
const texto = (from: string, body: string): J => valorMeta({ type: 'text', text: { body } }, from);
const lista = (from: string, id: string, title: string): J =>
  valorMeta({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } }, from);
const boton = (from: string, id: string, title = 'x'): J =>
  valorMeta({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } }, from);
const imagen = (from: string): J => valorMeta({ type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg' } }, from);
const audio = (from: string): J => valorMeta({ type: 'audio', audio: { id: 'media-2', mime_type: 'audio/ogg' } }, from);

// ------------------------------------------------------------------------ el reloj congelado
function relojFijo(ms: number): unknown {
  return class extends Date {
    constructor(...a: unknown[]) { if (a.length === 0) super(ms); else super(...(a as [number])); }
    static override now(): number { return ms; }
  };
}

// ------------------------------------------------------------------------ el n8n de mentira
interface Item { json: J; pair: Record<string, J> }
interface Enviado { a: string; tipo: string; payload: J; cuerpo: string; respaldo: boolean }

export interface Opciones {
  flujo?: Flujo;
  /** El panel de la consola: la configuración de ejemplo, otra, o `false` = el panel no responde. */
  panel?: J | false;
  eventos?: J[];
  /** Cambios a «Config base» (el Set) antes de armar el mundo. */
  configBase?: Record<string, string>;
  desactivados?: string[];
  ingesta?: J;
  /** Tamaño que devuelve el doble de «Obtener URL del medio» (por omisión 5.000 bytes). */
  medioBytes?: number;
}
interface Fallas { leer?: boolean; crear?: boolean; releer?: boolean; borrar?: boolean; deshacer?: boolean | '404' }

type Extraccion = J | ((cuerpo: J) => J) | 'ERROR';

function mundo(op: Opciones = {}) {
  const flujo = op.flujo ?? PRODUCCION;
  const nodos = new Map<string, Nodo>(flujo.nodes.map((n) => [n.name, n]));
  // Copia de «Config base», con los cambios que pide el caso.
  const setBase = nodos.get('Config base');
  const asignaciones: J = {};
  for (const a of (setBase?.parameters['assignments'] as { assignments: { name: string; value: unknown }[] }).assignments) asignaciones[a.name] = a.value;
  Object.assign(asignaciones, op.configBase ?? {});
  const desactivados = new Set(op.desactivados ?? []);

  const sd: J = {};
  const calendario = { eventos: (op.eventos ?? []).slice(), seq: 0, fallas: {} as Fallas, despuesDeCrear: null as null | ((c: J[]) => void) };
  const gemini = { extraer: 'ERROR' as Extraccion, redactar: null as null | string | ((cuerpo: J) => string), transcripcion: null as null | string };
  const graph = { falla: (_p: J): boolean => false };
  const log = {
    enviados: [] as Enviado[], ingesta: [] as J[], cierres: [] as J[], extraer: [] as J[], redactar: [] as J[],
    bitacora: [] as string[], configPedida: [] as J[], turnos: 0,
  };
  let ahoraMs = AHORA;
  let ultimoResumen: J | null = null;
  let orden: string[] = [];

  // --- evaluar expresiones del JSON, con el mismo evaluador que los nodos -----------------------
  // `ejecutar` devuelve `.map` de un arreglo; para una expresión usamos el truco de envolver en arreglo.
  const evaluarValor = (valor: unknown, item: Item, refs: Referencias): unknown => {
    if (typeof valor !== 'string' || !valor.startsWith('=')) return valor;
    const sobre: Referencias = Object.assign({}, refs, item.pair);
    const globales = { $json: item.json, Date: relojFijo(ahoraMs) };
    const completa = /^=\{\{([\s\S]*)\}\}$/.exec(valor.trim());
    const una = (e: string): unknown => ejecutar(`return [{ json: { v: (${e}) } }];`, [], sobre, globales)[0]?.['v'];
    if (completa) return una(completa[1] as string);
    return valor.slice(1).replace(/\{\{([\s\S]*?)\}\}/g, (_m, e: string) => String(una(e)));
  };

  const respuestaGemini = (t: string): J => ({ candidates: [{ content: { parts: [{ text: t }] } }] });

  // --- el calendario en memoria ---------------------------------------------------------------
  const ms = (s: string): number => new Date(s).getTime();
  function calendarioValido(id: unknown): boolean { return String(id ?? '').trim() !== '' && id !== 'undefined'; }

  // --- un nodo --------------------------------------------------------------------------------
  function correrNodo(n: Nodo, items: Item[], refs: Referencias, entrada: { nombre: string; json: J } | null): Item[][] {
    const p = n.parameters;
    if (desactivados.has(n.name) && n.type !== 'n8n-nodes-base.if') return [items];
    const tipo = n.type.split('.').pop() ?? '';
    const cada = (f: (it: Item) => J[]): Item[] => items.flatMap((it) => f(it).map((json) => ({ json, pair: it.pair })));

    if (entrada && entrada.nombre === n.name) return [[{ json: entrada.json, pair: {} }]];

    if (tipo === 'code') {
      const salida = ejecutar(String(p['jsCode']), items.map((i) => i.json), refs, {
        $getWorkflowStaticData: () => sd, Date: relojFijo(ahoraMs),
      });
      if (n.name === 'Armar mensajes') return [salida.map((json) => ({ json, pair: { 'Armar mensajes': json } }))];
      if (n.name === 'Resumen del turno') ultimoResumen = salida[0] ?? null;
      return [salida.map((json) => ({ json, pair: {} }))];
    }
    if (tipo === 'if') {
      const cond = (p['conditions'] as { conditions: { leftValue: string }[] }).conditions[0]!.leftValue;
      const si: Item[] = []; const no: Item[] = [];
      for (const it of items) (evaluarValor(cond, it, refs) ? si : no).push(it);
      return [si, no];
    }
    if (tipo === 'set') {
      return [cada((it) => [Object.assign({}, it.json, asignaciones)])];
    }

    switch (n.name) {
      case 'Traer configuración': {
        return [cada((it) => {
          log.configPedida.push({
            numero: evaluarValor((p['headerParameters'] as { parameters: { value: string }[] }).parameters[0]!.value, it, refs),
            cuerpo: JSON.parse(String(evaluarValor(p['jsonBody'], it, refs))),
          });
          return [op.panel === false ? { statusCode: 500, body: { error: 'sin panel' } } : { statusCode: 200, body: op.panel ?? PANEL }];
        })];
      }
      case 'Reportar mensaje (entrante)':
      case 'Reportar mensaje (saliente)': {
        return [cada((it) => {
          const cuerpo = JSON.parse(String(evaluarValor(p['jsonBody'], it, refs))) as J;
          log.ingesta.push(cuerpo);
          return [Object.assign({ atencion: { estado: 'normal' }, servicio: { estado: 'activo' } }, op.ingesta ?? {})];
        })];
      }
      case 'Registrar cierre (cita)': {
        return [cada((it) => { log.cierres.push(JSON.parse(String(evaluarValor(p['jsonBody'], it, refs)))); return [{ ok: true }]; })];
      }
      case 'Obtener URL del medio': return [cada(() => [{ url: 'https://ejemplo.invalid/medio', file_size: op.medioBytes ?? 5000 }])];
      case 'Descargar medio': return [cada(() => [{ descargado: true }])];
      case 'Transcribir audio': {
        return [cada(() => [gemini.transcripcion === null ? { error: 'sin transcripcion' } : { content: { parts: [{ text: gemini.transcripcion }] } }])];
      }
      case 'Extraer': {
        return [cada((it) => {
          const cuerpo = JSON.parse(String(evaluarValor(p['jsonBody'], it, refs))) as J;
          log.extraer.push(cuerpo);
          const e = gemini.extraer;
          if (e === 'ERROR') return [{ error: { message: 'modelo caído' } }];
          return [respuestaGemini(JSON.stringify(typeof e === 'function' ? e(cuerpo) : e))];
        })];
      }
      case 'Redactar': {
        return [cada((it) => {
          const cuerpo = JSON.parse(String(evaluarValor(p['jsonBody'], it, refs))) as J;
          log.redactar.push(cuerpo);
          const r = gemini.redactar;
          if (r === null) return [{ error: { message: 'modelo caído' } }];
          return [respuestaGemini(typeof r === 'function' ? r(cuerpo) : r)];
        })];
      }
      case 'Leer agenda':
      case 'Releer el hueco': {
        return [cada((it) => {
          const cal = evaluarValor((p['calendar'] as { value: string }).value, it, refs);
          const falla = n.name === 'Leer agenda' ? calendario.fallas.leer : calendario.fallas.releer;
          if (falla || !calendarioValido(cal)) return [{ error: 'calendario no disponible' }];
          const min = ms(String(evaluarValor(p['timeMin'], it, refs)));
          const max = ms(String(evaluarValor(p['timeMax'], it, refs)));
          const vistos = calendario.eventos.filter((e) => {
            const s = ms((e['start'] as J)['dateTime'] as string ?? `${(e['start'] as J)['date']}T00:00:00-04:00`);
            const f = ms((e['end'] as J)['dateTime'] as string ?? `${(e['end'] as J)['date']}T00:00:00-04:00`);
            return s < max && f > min;
          });
          // `alwaysOutputData`: sin eventos, n8n entrega un ítem vacío.
          return vistos.length ? vistos.map((e) => JSON.parse(JSON.stringify(e)) as J) : [{}];
        })];
      }
      case 'Crear evento': {
        return [cada((it) => {
          const cal = evaluarValor((p['calendar'] as { value: string }).value, it, refs);
          if (calendario.fallas.crear || !calendarioValido(cal)) return [{ error: 'no se pudo crear' }];
          const extra = p['additionalFields'] as J;
          const e: J = {
            id: `ev-${++calendario.seq}`, status: 'confirmed',
            summary: evaluarValor(extra['summary'], it, refs), description: evaluarValor(extra['description'], it, refs),
            start: { dateTime: evaluarValor(p['start'], it, refs) }, end: { dateTime: evaluarValor(p['end'], it, refs) },
          };
          calendario.eventos.push(e);
          log.bitacora.push(`crear:${String(e['id'])}`);
          if (calendario.despuesDeCrear) calendario.despuesDeCrear(calendario.eventos);
          return [JSON.parse(JSON.stringify(e)) as J];
        })];
      }
      case 'Deshacer cita':
      case 'Borrar evento': {
        return [cada((it) => {
          const cal = evaluarValor((p['calendar'] as { value: string }).value, it, refs);
          const falla = n.name === 'Borrar evento' ? calendario.fallas.borrar : calendario.fallas.deshacer;
          const id = String(evaluarValor(p['eventId'], it, refs));
          if (falla === '404') return [{ error: { message: 'The resource you are requesting could not be found', httpCode: '404' } }];
          if (falla || !calendarioValido(cal)) return [{ error: 'no se pudo borrar' }];
          const antes = calendario.eventos.length;
          calendario.eventos = calendario.eventos.filter((e) => e['id'] !== id);
          if (calendario.eventos.length === antes) return [{ error: 'no existe' }];
          log.bitacora.push(`borrar:${id}`);
          return [{ success: true }];
        })];
      }
      case 'Enviar a WhatsApp':
      case 'Enviar respaldo': {
        return [cada((it) => {
          const payload = JSON.parse(String(evaluarValor(p['jsonBody'], it, refs))) as J;
          const respaldo = n.name === 'Enviar respaldo';
          log.enviados.push({ a: String(payload['to']), tipo: String(payload['type']), payload, cuerpo: cuerpoDe(payload), respaldo });
          if (graph.falla(payload)) return [{ error: { message: 'Meta rechazó el mensaje', code: 132000 } }];
          return [{ messaging_product: 'whatsapp', messages: [{ id: `wamid.OUT${log.enviados.length}` }] }];
        })];
      }
      case 'Resumen del turno': {
        const salida = ejecutar(String(p['jsCode']), items.map((i) => i.json), refs, { $getWorkflowStaticData: () => sd, Date: relojFijo(ahoraMs) });
        ultimoResumen = salida[0] ?? null;
        return [salida.map((json) => ({ json, pair: {} }))];
      }
      default:
        throw new Error(`el n8n de mentira no sabe correr el nodo «${n.name}» (${n.type})`);
    }
  }

  function turno(entradaJson: J, opciones: { via?: string; avanzarMin?: number } = {}) {
    ahoraMs += (opciones.avanzarMin ?? 1) * 60_000;
    log.turnos++;
    const via = opciones.via ?? (nodos.has('WhatsApp Trigger') ? 'WhatsApp Trigger' : 'Entrada de prueba');
    const refs: Referencias = {};
    orden = [];
    ultimoResumen = null;
    const desde = { env: log.enviados.length, ing: log.ingesta.length, cie: log.cierres.length, ext: log.extraer.length, red: log.redactar.length, bit: log.bitacora.length };
    const entrada = { nombre: via, json: entradaJson };

    function visitar(nombre: string, items: Item[]): void {
      if (!items.length) return;
      const n = nodos.get(nombre);
      if (!n) throw new Error(`conexión a un nodo que no existe: ${nombre}`);
      orden.push(nombre);
      const salidas = correrNodo(n, items, refs, entrada);
      refs[nombre] = salidas.flat().map((i) => i.json);
      const conex = flujo.connections[nombre]?.['main'] ?? [];
      salidas.forEach((its, idx) => {
        const destinos = [...(conex[idx] ?? [])].sort((a, b) => (nodos.get(a.node)!.position![1] - nodos.get(b.node)!.position![1]) || (nodos.get(a.node)!.position![0] - nodos.get(b.node)!.position![0]));
        for (const d of destinos) visitar(d.node, its);
      });
    }
    visitar(via, [{ json: entradaJson, pair: {} }]);

    const enviados = log.enviados.slice(desde.env);
    return {
      enviados,
      aPaciente: (tel: string) => enviados.filter((e) => e.a === tel),
      aRecepcion: enviados.filter((e) => e.a === REC),
      aDoctor: enviados.filter((e) => e.a === DOC),
      ingesta: log.ingesta.slice(desde.ing),
      cierres: log.cierres.slice(desde.cie),
      extraer: log.extraer.slice(desde.ext),
      redactar: log.redactar.slice(desde.red),
      bitacora: log.bitacora.slice(desde.bit),
      orden: orden.slice(),
      ejecutados: new Set(orden),
      resumen: ultimoResumen,
      config: (refs['Config del negocio']?.[0] ?? {}) as J,
    };
  }

  return { turno, calendario, gemini, graph, log, sd, nodos, asignaciones };
}

type Turno = ReturnType<ReturnType<typeof mundo>['turno']>;

function cuerpoDe(payload: J): string {
  if (payload['type'] === 'text') return String((payload['text'] as J)['body']);
  if (payload['type'] === 'interactive') return String(((payload['interactive'] as J)['body'] as J)['text']);
  if (payload['type'] === 'template') {
    const comp = ((payload['template'] as J)['components'] as J[])[0]!;
    return (comp['parameters'] as J[]).map((x) => String(x['text'])).join(' | ');
  }
  return JSON.stringify(payload);
}
const interactivo = (e: Enviado): J => e.payload['interactive'] as J;
const botonesDe = (e: Enviado): { id: string; title: string }[] =>
  (((interactivo(e)['action'] as J)['buttons'] as J[]) ?? []).map((b) => b['reply'] as { id: string; title: string });
const urlDe = (e: Enviado): string => String((((interactivo(e)['action'] as J)['parameters']) as J)['url']);
const CONFIRMA = /Listo, quedó agendada/;
const textos = (t: Turno): string => t.enviados.map((e) => e.cuerpo).join('\n');

/** Lo que dice el modelo al extraer, con lo mínimo obligatorio. */
const extraccion = (o: J = {}): J => Object.assign({ intencion: 'agendar', servicio: SERV_CNS, franja: 'cualquiera', fechaPreferida: null, horaPreferida: null, pacientes: [] }, o);

/** Lleva la conversación de `MAMA` hasta el punto en que el paciente tocó un hueco y falta el nombre. */
function hastaPedirNombre(m: ReturnType<typeof mundo>, srv = SERV_CNS, hora = '14:00'): Turno {
  m.turno(texto(MAMA, 'quiero cita el jueves en la tarde'));
  m.gemini.extraer = extraccion({ servicio: srv, fechaPreferida: JUEVES, franja: 'tarde' });
  m.turno(lista(MAMA, srv, 'Servicio'));
  return m.turno(boton(MAMA, idHueco(JUEVES, hora, srv)));
}

// =================================================================================================
describe('Agenda mínima v0: el flujo, de punta a punta', () => {
  // ---------------------------------------------------------------------------------------- (a)
  describe('(a) el menú', () => {
    it('un primer mensaje recibe el menú (lista con emergencia, recién nacido, niño sano y vacunas) y nada más', () => {
      const m = mundo({ eventos: [] });
      const t = m.turno(texto(MAMA, 'hola'));
      expect(t.aPaciente(MAMA)).toHaveLength(1);
      const msg = t.enviados[0]!;
      expect(interactivo(msg)['type']).toBe('list');
      const filas = ((((interactivo(msg)['action'] as J)['sections'] as J[])[0]!['rows']) as J[]).map((f) => f['id']);
      expect(filas).toEqual(['emergencia', SERV_RN, SERV_CNS, 'vacunas_otros']);
      expect(msg.cuerpo).toBe(PANEL.datosDelNegocio.mensajeMenu);
      // No se llamó a ningún modelo ni al calendario: el menú es código.
      expect(t.extraer).toHaveLength(0);
      expect(t.redactar).toHaveLength(0);
      expect(t.ejecutados.has('Leer agenda')).toBe(false);
      expect(t.resumen!['resumen']).toMatchObject({ ruta: 'menu' });
    });
    it('NIEGA: un reenvío del mismo mensaje de Meta (mismo id) no se contesta dos veces', () => {
      const m = mundo({ eventos: [] });
      const entrada = texto(MAMA, 'hola');
      expect(m.turno(entrada).enviados).toHaveLength(1);
      expect(m.turno(entrada).enviados).toHaveLength(0);
    });
    it('NIEGA: un acuse de estado (sin `messages`) se descarta antes de todo', () => {
      const m = mundo({ eventos: [] });
      const t = m.turno({ messaging_product: 'whatsapp', metadata: { phone_number_id: PID }, statuses: [{ id: 'wamid.X', status: 'delivered' }] });
      expect(t.enviados).toHaveLength(0);
      expect(t.ejecutados.has('Traer configuración')).toBe(false);
      expect(t.ingesta).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------- (b)
  describe('(b) «quiero cita el jueves en la tarde»', () => {
    it('ofrece huecos reales del jueves como botones, y el texto va en el cuerpo del MISMO interactivo', () => {
      const m = mundo({ eventos: [] });
      m.turno(texto(MAMA, 'quiero cita el jueves en la tarde'));
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES, franja: 'tarde' });
      m.gemini.redactar = 'Para el jueves en la tarde tengo estos horarios. Toca el que prefieras.';
      const t = m.turno(lista(MAMA, SERV_CNS, 'Control niño sano'));
      // Un solo mensaje al paciente: el texto NO va aparte.
      expect(t.enviados).toHaveLength(1);
      const msg = t.enviados[0]!;
      expect(interactivo(msg)['type']).toBe('button');
      expect(msg.cuerpo).toBe('Para el jueves en la tarde tengo estos horarios. Toca el que prefieras.');
      const bs = botonesDe(msg);
      expect(bs.map((b) => b.id)).toEqual([idHueco(JUEVES, '14:00'), idHueco(JUEVES, '14:30'), idHueco(JUEVES, '15:00')]);
      expect(bs.every((b) => b.title.length <= 20)).toBe(true);
      expect(bs[0]!.title).toMatch(/14:00/);
      // El modelo solo extrajo: el calendario lo leyó el código.
      expect(t.extraer).toHaveLength(1);
      expect(t.ejecutados.has('Leer agenda')).toBe(true);
      expect(t.resumen!['resumen']).toMatchObject({ ruta: 'ofrecer', huecosOfrecidos: bs.map((b) => b.id.split('|')[1]) });
    });
    it('NIEGA: un hueco OCUPADO en el calendario no se ofrece (la tarde empieza en el primer libre)', () => {
      const m = mundo({ eventos: [evento('o1', JUEVES, '14:00', '15:00', 'Otro paciente')] });
      m.turno(texto(MAMA, 'quiero cita el jueves en la tarde'));
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES, franja: 'tarde' });
      const t = m.turno(lista(MAMA, SERV_CNS, 'Control niño sano'));
      expect(botonesDe(t.enviados[0]!).map((b) => b.id)).toEqual([idHueco(JUEVES, '15:00'), idHueco(JUEVES, '15:30'), idHueco(JUEVES, '16:00')]);
    });
    it('NIEGA: si el modelo inventa una hora que no está entre los huecos, su texto se descarta y sale el texto fijo', () => {
      const m = mundo({ eventos: [] });
      m.turno(texto(MAMA, 'quiero cita el jueves en la tarde'));
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES, franja: 'tarde' });
      m.gemini.redactar = 'Te ofrezco el jueves a las 16:45 o a las 17:10.';
      const t = m.turno(lista(MAMA, SERV_CNS, 'x'));
      expect(t.enviados[0]!.cuerpo).not.toMatch(/16:45|17:10/);
      expect(t.enviados[0]!.cuerpo).toMatch(/Toca el horario que prefieras/);
      expect(botonesDe(t.enviados[0]!)).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------------------- (c)
  describe('(c) tocar un botón: nombre, título y cierre', () => {
    it('un botón sin nombre pide el nombre y NO crea nada', () => {
      const m = mundo({ eventos: [] });
      const t = hastaPedirNombre(m);
      expect(t.enviados).toHaveLength(1);
      expect(t.enviados[0]!.cuerpo).toMatch(/Cómo se llama el niño o la niña/);
      expect(m.calendario.eventos).toHaveLength(0);
      expect(t.bitacora).toEqual([]);
    });
    it('con el nombre, crea la cita «Apellidos, Nombres (CNS)», la confirma con el código y registra el cierre', () => {
      const m = mundo({ eventos: [] });
      hastaPedirNombre(m);
      m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
      const t = m.turno(texto(MAMA, 'Ana Pérez Gómez'));
      expect(m.calendario.eventos).toHaveLength(1);
      const cita = m.calendario.eventos[0]!;
      expect(cita['summary']).toBe('Pérez Gómez, Ana (CNS)');
      expect(cita['start']).toEqual({ dateTime: iso(JUEVES, '14:00') });
      expect(cita['end']).toEqual({ dateTime: iso(JUEVES, '14:30') });
      expect(String(cita['description'])).toContain(`Telefono: ${MAMA}`);
      expect(t.bitacora).toEqual(['crear:ev-1']);
      expect(t.enviados).toHaveLength(1);
      expect(t.enviados[0]!.cuerpo).toMatch(CONFIRMA);
      expect(t.enviados[0]!.cuerpo).toContain('jueves 8 de octubre a las 14:00');
      expect(t.enviados[0]!.cuerpo).toContain('10 minutos de tolerancia');
      // El cierre: una sola vez, con el id del evento y el teléfono.
      expect(t.cierres).toEqual([{ tipo: 'cita', referencia: 'ev-1', telefono: MAMA, nombreCliente: 'Mamá de Ana' }]);
      expect(t.resumen!['resumen']).toMatchObject({ accion: 'cita_creada', eventoCreadoId: 'ev-1' });
    });
    it('el recién nacido lleva «(RN)» (la marca la pone el código según el servicio)', () => {
      const m = mundo({ eventos: [] });
      hastaPedirNombre(m, SERV_RN);
      m.gemini.extraer = extraccion({ servicio: SERV_RN, pacientes: ['Luis Rojas Vaca'] });
      m.turno(texto(MAMA, 'Luis Rojas Vaca'));
      expect(m.calendario.eventos[0]!['summary']).toBe('Rojas Vaca, Luis (RN)');
    });
    it('NIEGA: un nombre sin apellido no crea la cita: se vuelve a pedir', () => {
      const m = mundo({ eventos: [] });
      hastaPedirNombre(m);
      m.gemini.extraer = extraccion({ pacientes: ['Ana'] });
      const t = m.turno(texto(MAMA, 'Ana'));
      expect(m.calendario.eventos).toHaveLength(0);
      expect(t.enviados[0]!.cuerpo).toMatch(/nombre y el apellido/);
      expect(t.cierres).toHaveLength(0);
    });
    it('NIEGA: un hueco que se ocupó entre la oferta y el botón no se crea: se le dice y se ofrece de nuevo', () => {
      const m = mundo({ eventos: [] });
      m.turno(texto(MAMA, 'quiero cita el jueves'));
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES, franja: 'tarde' });
      m.turno(lista(MAMA, SERV_CNS, 'x'));
      m.calendario.eventos.push(evento('o1', JUEVES, '14:00', '14:30', 'Otro paciente'));
      const t = m.turno(boton(MAMA, idHueco(JUEVES, '14:00')));
      expect(m.calendario.eventos).toHaveLength(1);
      expect(t.bitacora).toEqual([]);
      expect(t.enviados[0]!.cuerpo).toMatch(/ya no está disponible/);
      expect(botonesDe(t.enviados[0]!).map((b) => b.id)).not.toContain(idHueco(JUEVES, '14:00'));
    });
  });

  // ---------------------------------------------------------------------------------------- (d)
  describe('(d) un «sí» o «ya» no agenda nada', () => {
    for (const dicho of ['ya', 'sí', 'dale', 'Sí, ya']) {
      it(`«${dicho}» con una oferta pendiente NO crea nada, NO llama al modelo y pide tocar un botón`, () => {
        const m = mundo({ eventos: [] });
        m.turno(texto(MAMA, 'quiero cita el jueves'));
        m.gemini.extraer = extraccion({ fechaPreferida: JUEVES, franja: 'tarde' });
        const oferta = m.turno(lista(MAMA, SERV_CNS, 'x'));
        m.gemini.extraer = 'ERROR';
        const t = m.turno(texto(MAMA, dicho));
        expect(m.calendario.eventos).toHaveLength(0);
        expect(t.bitacora).toEqual([]);
        expect(t.extraer).toHaveLength(0);
        expect(t.ejecutados.has('Crear evento')).toBe(false);
        expect(t.enviados).toHaveLength(1);
        expect(t.enviados[0]!.cuerpo).toMatch(/toca uno de los horarios/);
        // Y se le vuelve a mandar la MISMA oferta como botones.
        expect(botonesDe(t.enviados[0]!)).toHaveLength(3);
        expect(botonesDe(t.enviados[0]!).map((b) => b.id)).toEqual(botonesDe(oferta.enviados[0]!).map((b) => b.id));
        expect(t.resumen!['resumen']).toMatchObject({ ruta: 'pedir_boton' });
      });
    }
    it('NIEGA: una frase con contenido («el jueves a las 4») SÍ pasa por el modelo y no es un «sí»', () => {
      const m = mundo({ eventos: [] });
      m.turno(texto(MAMA, 'quiero cita el jueves'));
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES, franja: 'tarde' });
      m.turno(lista(MAMA, SERV_CNS, 'x'));
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES, horaPreferida: '16:00' });
      const t = m.turno(texto(MAMA, 'mejor el jueves a las 4'));
      expect(t.extraer).toHaveLength(1);
      expect(botonesDe(t.enviados[0]!)[0]!.id).toBe(idHueco(JUEVES, '16:00'));
    });
  });

  // ---------------------------------------------------------------------------------------- (e)
  describe('(e) CANDADO: un evento aparece entre crear y releer', () => {
    it('se borra la PROPIA cita, no se confirma, no se registra cierre y se ofrece de nuevo', () => {
      const m = mundo({ eventos: [] });
      hastaPedirNombre(m);
      // Justo después de crear, otra persona reserva el mismo hueco.
      m.calendario.despuesDeCrear = (c) => { c.push(evento('rival-1', JUEVES, '14:00', '14:30', 'Otro paciente')); };
      m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
      const t = m.turno(texto(MAMA, 'Ana Pérez Gómez'));
      expect(t.bitacora).toEqual(['crear:ev-1', 'borrar:ev-1']);
      expect(m.calendario.eventos.map((e) => e['id'])).toEqual(['rival-1']);
      expect(textos(t)).not.toMatch(CONFIRMA);
      expect(textos(t)).not.toMatch(/quedó agendada|agendé/);
      expect(t.cierres).toHaveLength(0);
      expect(t.enviados).toHaveLength(1);
      expect(t.enviados[0]!.cuerpo).toMatch(/se ocupó justo ahora/);
      const ofrecidos = botonesDe(t.enviados[0]!).map((b) => b.id);
      expect(ofrecidos).toHaveLength(3);
      expect(ofrecidos).not.toContain(idHueco(JUEVES, '14:00'));
      expect(t.resumen!['resumen']).toMatchObject({ accion: 'cruce_deshecho', eventoCreadoId: '' });
    });
    it('NIEGA: sin el evento rival, la misma conversación confirma y NO borra nada', () => {
      const m = mundo({ eventos: [] });
      hastaPedirNombre(m);
      m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
      const t = m.turno(texto(MAMA, 'Ana Pérez Gómez'));
      expect(t.bitacora).toEqual(['crear:ev-1']);
      expect(textos(t)).toMatch(CONFIRMA);
    });
    it('un evento de DÍA ENTERO que aparece en el hueco también dispara el candado', () => {
      const m = mundo({ eventos: [] });
      hastaPedirNombre(m);
      m.calendario.despuesDeCrear = (c) => { c.push({ id: 'feriado', summary: 'Cerrado', status: 'confirmed', start: { date: JUEVES }, end: { date: VIERNES } }); };
      m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
      const t = m.turno(texto(MAMA, 'Ana Pérez Gómez'));
      expect(t.bitacora).toEqual(['crear:ev-1', 'borrar:ev-1']);
      expect(textos(t)).not.toMatch(CONFIRMA);
    });
    it('si la relectura FALLA no se puede comprobar: falla cerrado (se deshace y no se confirma)', () => {
      const m = mundo({ eventos: [] });
      hastaPedirNombre(m);
      m.calendario.fallas.releer = true;
      m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
      const t = m.turno(texto(MAMA, 'Ana Pérez Gómez'));
      expect(t.bitacora).toEqual(['crear:ev-1', 'borrar:ev-1']);
      expect(m.calendario.eventos).toHaveLength(0);
      expect(textos(t)).not.toMatch(CONFIRMA);
      expect(t.cierres).toHaveLength(0);
      // Sin lectura no hay oferta: pasa a recepción (aviso más botón).
      expect(t.aRecepcion).toHaveLength(1);
      expect(t.aPaciente(MAMA)[0]!.payload['type']).toBe('interactive');
      expect(urlDe(t.aPaciente(MAMA)[0]!)).toContain(`wa.me/${REC}`);
    });
    it('si la cita cruzada NO se puede borrar, recepción lo sabe (quedaron dos eventos)', () => {
      const m = mundo({ eventos: [] });
      hastaPedirNombre(m);
      m.calendario.despuesDeCrear = (c) => { c.push(evento('rival-1', JUEVES, '14:00', '14:30', 'Otro paciente')); };
      m.calendario.fallas.deshacer = true;
      m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
      const t = m.turno(texto(MAMA, 'Ana Pérez Gómez'));
      expect(textos(t)).not.toMatch(CONFIRMA);
      expect(t.aRecepcion.map((e) => e.cuerpo).join(' ')).toMatch(/no se pudo borrar del calendario/);
    });
  });

  // ---------------------------------------------------------------------------------------- (f)
  describe('(f) calendario caído: no se confirma, se transfiere', () => {
    const esTransferencia = (t: Turno): void => {
      expect(textos(t)).not.toMatch(CONFIRMA);
      expect(t.aRecepcion).toHaveLength(1); // el aviso a recepción…
      const alPaciente = t.aPaciente(MAMA);
      expect(alPaciente).toHaveLength(1);
      expect(alPaciente[0]!.payload['type']).toBe('interactive'); // …más el botón para escribirle
      expect(urlDe(alPaciente[0]!)).toContain(`wa.me/${REC}`);
      expect(alPaciente[0]!.cuerpo).toContain(PANEL.datosDelNegocio.mensajeErrorTemporal);
      expect(textos(t)).not.toMatch(/te aviso|lo consulto|te llamamos|te escribir/i);
    };
    it('«Leer agenda» con error: no hay oferta; mensajeErrorTemporal, aviso a recepción y botón', () => {
      const m = mundo({ eventos: [] });
      m.turno(texto(MAMA, 'hola'));
      m.calendario.fallas.leer = true;
      const t = m.turno(lista(MAMA, SERV_CNS, 'x'));
      esTransferencia(t);
      expect(t.bitacora).toEqual([]);
      expect(t.resumen!['resumen']).toMatchObject({ ruta: 'error' });
    });
    it('«Crear evento» con error: no hay cita ni confirmación; y la cita anterior de un reagendo NO se toca', () => {
      const vieja = citaDe(MAMA, 'vieja', JUEVES, '14:00', '14:30', 'Pérez Gómez, Ana (CNS)');
      const m = mundo({ eventos: [vieja] });
      // Reagendar: se elige la cita, se toca un hueco y el calendario falla al crear.
      // Cancelar o mover al empezar no pasa por el menú: va directo a entender el mensaje.
      m.gemini.extraer = extraccion({ intencion: 'mover' });
      m.turno(texto(MAMA, 'quiero mover mi cita'));
      m.calendario.fallas.crear = true;
      const t = m.turno(boton(MAMA, idHueco(VIERNES, '11:00')));
      esTransferencia(t);
      expect(t.bitacora).toEqual([]);
      expect(m.calendario.eventos.map((e) => e['id'])).toEqual(['vieja']);
      expect(t.cierres).toHaveLength(0);
    });
    it('NIEGA: con el calendario sano, ese mismo turno no saca el texto de error ni avisa a recepción', () => {
      const m = mundo({ eventos: [] });
      m.turno(texto(MAMA, 'hola'));
      const t = m.turno(lista(MAMA, SERV_CNS, 'x'));
      expect(textos(t)).not.toContain(PANEL.datosDelNegocio.mensajeErrorTemporal);
      expect(t.aRecepcion).toHaveLength(0);
    });
    it('el modelo caído al interpretar también termina en transferencia, sin confirmar nada', () => {
      const m = mundo({ eventos: [] });
      m.turno(texto(MAMA, 'hola'));
      m.turno(lista(MAMA, SERV_CNS, 'x'));
      m.gemini.extraer = 'ERROR';
      const t = m.turno(texto(MAMA, 'el viernes en la mañana por favor'));
      esTransferencia(t);
    });
  });

  // ---------------------------------------------------------------------------------------- (g)
  describe('(g) emergencia', () => {
    const sin168 = (t: Turno): void => {
      for (const e of t.enviados) expect(JSON.stringify(e.payload) + e.cuerpo).not.toMatch(/168/);
    };
    it('el paciente recibe el botón a recepción y el doctor, la plantilla alerta_emergencia (sin 168)', () => {
      const m = mundo({ eventos: [] });
      const t = m.turno(texto(MAMA, 'emergencia, mi bebé no respira'));
      const alPaciente = t.aPaciente(MAMA);
      expect(alPaciente).toHaveLength(1);
      expect(urlDe(alPaciente[0]!)).toContain(`wa.me/${REC}`);
      expect(alPaciente[0]!.cuerpo).toBe(PANEL.datosDelNegocio.mensajeEmergencia);
      expect(t.aDoctor).toHaveLength(1);
      const plantilla = t.aDoctor[0]!.payload['template'] as J;
      expect(t.aDoctor[0]!.tipo).toBe('template');
      expect(plantilla['name']).toBe('alerta_emergencia');
      expect(t.aDoctor[0]!.cuerpo).toContain(MAMA);
      expect(t.aDoctor[0]!.cuerpo).toContain('mi bebé no respira');
      expect(t.extraer).toHaveLength(0);
      sin168(t);
    });
    it('el botón «Emergencia» del menú hace lo mismo', () => {
      const m = mundo({ eventos: [] });
      m.turno(texto(MAMA, 'hola'));
      const t = m.turno(lista(MAMA, 'emergencia', 'Emergencia'));
      expect(t.aDoctor[0]!.payload['type']).toBe('template');
      expect(t.aDoctor[0]!.cuerpo).toMatch(/tocó el botón de emergencia/);
    });
    it('si la plantilla FALLA, sale el respaldo en texto al doctor y el mensaje al paciente no cambia', () => {
      const sano = mundo({ eventos: [] }).turno(texto(MAMA, 'emergencia'));
      const m = mundo({ eventos: [] });
      m.graph.falla = (p) => p['type'] === 'template';
      const t = m.turno(texto(MAMA, 'emergencia'));
      const alDoctor = t.aDoctor;
      expect(alDoctor.map((e) => e.tipo)).toEqual(['template', 'text']);
      expect(alDoctor[1]!.respaldo).toBe(true);
      expect(alDoctor[1]!.cuerpo).toMatch(/EMERGENCIA en el asistente/);
      expect(t.ejecutados.has('Enviar respaldo')).toBe(true);
      // El paciente: idéntico, y sin respaldo.
      expect(t.aPaciente(MAMA)).toHaveLength(1);
      expect(t.aPaciente(MAMA)[0]!.payload).toEqual(sano.aPaciente(MAMA)[0]!.payload);
      expect(t.aPaciente(MAMA)[0]!.respaldo).toBe(false);
      sin168(t);
    });
    it('aunque la consola traiga «168» en el mensaje de emergencia, no sale', () => {
      const panel = JSON.parse(JSON.stringify(PANEL)) as typeof PANEL;
      panel.datosDelNegocio.mensajeEmergencia = 'Llama al 168 ahora.';
      const t = mundo({ eventos: [], panel }).turno(texto(MAMA, 'urgente'));
      sin168(t);
      expect(t.aPaciente(MAMA)[0]!.cuerpo).toMatch(/recepción/);
    });
    it('NIEGA: un mensaje común no avisa al doctor ni manda plantilla', () => {
      const t = mundo({ eventos: [] }).turno(texto(MAMA, 'hola, buenas tardes'));
      expect(t.aDoctor).toHaveLength(0);
      expect(t.enviados.some((e) => e.tipo === 'template')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------- (h)
  describe('(h) día lleno con UNA hora libre', () => {
    const jornada = (): J[] => [evento('bloque', JUEVES, '14:00', '17:30', 'Agenda del doctor')]; // queda libre 17:30-18:00
    it('se ofrece esa hora, nunca «no quedan horarios» (aunque el modelo lo diga)', () => {
      const m = mundo({ eventos: jornada() });
      m.turno(texto(MAMA, 'cita el jueves'));
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES, franja: 'tarde' });
      m.gemini.redactar = 'Lo siento, ya no quedan horarios para el jueves.';
      const t = m.turno(lista(MAMA, SERV_CNS, 'x'));
      expect(t.enviados).toHaveLength(1);
      expect(botonesDe(t.enviados[0]!).map((b) => b.id)).toEqual([idHueco(JUEVES, '17:30')]);
      expect(t.enviados[0]!.cuerpo).not.toMatch(/no quedan|no hay horarios/i);
      expect(t.enviados[0]!.cuerpo).toMatch(/Toca el horario que prefieras/);
      expect(t.aRecepcion).toHaveLength(0);
    });
    it('NIEGA: con el día realmente lleno se dice y se ofrece el siguiente día hábil con huecos', () => {
      const m = mundo({ eventos: [evento('bloque', JUEVES, '14:00', '18:00', 'Agenda del doctor')] });
      m.turno(texto(MAMA, 'cita el jueves'));
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES, franja: 'tarde' });
      const t = m.turno(lista(MAMA, SERV_CNS, 'x'));
      expect(t.enviados[0]!.cuerpo).toMatch(/ya no queda espacio/);
      const ids = botonesDe(t.enviados[0]!).map((b) => b.id);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(id.split('|')[1]).toMatch(new RegExp(`^${VIERNES}`));
    });
  });

  // ---------------------------------------------------------------------------------------- (i)
  describe('(i) hermanos: UNA cita con los dos nombres', () => {
    it('crea un solo evento de 30 minutos con los dos nombres en el título', () => {
      const m = mundo({ eventos: [] });
      hastaPedirNombre(m);
      m.gemini.extraer = extraccion({ hermanos: true, pacientes: ['Ana Pérez Gómez', 'Luis Pérez Gómez'] });
      const t = m.turno(texto(MAMA, 'Ana Pérez Gómez y Luis Pérez Gómez'));
      expect(m.calendario.eventos).toHaveLength(1);
      const cita = m.calendario.eventos[0]!;
      expect(cita['summary']).toBe('Pérez Gómez, Ana y Luis (CNS)');
      expect((cita['end'] as J)['dateTime']).toBe(iso(JUEVES, '14:30'));
      expect(t.bitacora).toEqual(['crear:ev-1']);
      expect(t.cierres).toHaveLength(1); // un cierre, no dos
      expect(t.enviados[0]!.cuerpo).toMatch(/Ana.*Luis/);
    });
    it('NIEGA: si dice que son hermanos pero da un solo nombre, se pide el segundo antes de crear', () => {
      const m = mundo({ eventos: [] });
      hastaPedirNombre(m);
      m.gemini.extraer = extraccion({ hermanos: true, pacientes: ['Ana Pérez Gómez'] });
      const t = m.turno(texto(MAMA, 'son dos hermanos, Ana Pérez Gómez y otro'));
      expect(m.calendario.eventos).toHaveLength(0);
      expect(t.enviados[0]!.cuerpo).toMatch(/los dos niños/);
    });
  });

  // ---------------------------------------------------------------------------------------- (j)
  describe('(j) reagendar: primero la nueva, recién después se borra la vieja', () => {
    const vieja = (): J => citaDe(MAMA, 'vieja', JUEVES, '14:00', '14:30', 'Pérez Gómez, Ana (CNS)');
    function hastaElegirOtroHueco(m: ReturnType<typeof mundo>): void {
      m.gemini.extraer = extraccion({ intencion: 'mover' });
      const t = m.turno(texto(MAMA, 'quiero mover mi cita'));
      // Con UNA sola cita se ofrece directo (sin menú ni botón de «mover esta»): sale la oferta de huecos.
      expect(t.enviados).toHaveLength(1);
      expect(botonesDe(t.enviados[0]!).length).toBeGreaterThan(0);
    }
    it('crea la nueva, pasa el candado y recién entonces borra la vieja; un solo mensaje y el cierre', () => {
      const m = mundo({ eventos: [vieja()] });
      hastaElegirOtroHueco(m);
      const t = m.turno(boton(MAMA, idHueco(VIERNES, '11:00')));
      expect(t.bitacora).toEqual(['crear:ev-1', 'borrar:vieja']);
      expect(m.calendario.eventos.map((e) => e['id'])).toEqual(['ev-1']);
      expect(m.calendario.eventos[0]!['summary']).toBe('Pérez Gómez, Ana (CNS)');
      expect(t.enviados).toHaveLength(1);
      expect(t.enviados[0]!.cuerpo).toMatch(CONFIRMA);
      expect(t.cierres).toHaveLength(1);
      expect(t.resumen!['resumen']).toMatchObject({ accion: 'cita_movida', eventoCreadoId: 'ev-1', eventoBorradoId: 'vieja' });
    });
    it('NIEGA: con cruce, la nueva se deshace y la vieja NO se borra', () => {
      const m = mundo({ eventos: [vieja()] });
      hastaElegirOtroHueco(m);
      m.calendario.despuesDeCrear = (c) => { c.push(evento('rival-1', VIERNES, '11:00', '11:30', 'Otro paciente')); };
      const t = m.turno(boton(MAMA, idHueco(VIERNES, '11:00')));
      expect(t.bitacora).toEqual(['crear:ev-1', 'borrar:ev-1']);
      expect(m.calendario.eventos.map((e) => e['id']).sort()).toEqual(['rival-1', 'vieja']);
      expect(textos(t)).not.toMatch(CONFIRMA);
      expect(t.cierres).toHaveLength(0);
    });
    it('NIEGA: pedir la MISMA hora de su propia cita no la ofrece otra vez: se le dice que ya es la suya', () => {
      const m = mundo({ eventos: [vieja()] });
      hastaElegirOtroHueco(m);
      m.gemini.extraer = extraccion({ intencion: 'agendar', fechaPreferida: JUEVES, horaPreferida: '14:00' });
      const t = m.turno(texto(MAMA, 'el jueves a las 2'));
      const ids = t.enviados.length ? botonesDe(t.enviados[0]!).map((b) => b.id) : [];
      expect(ids).not.toContain(idHueco(JUEVES, '14:00'));
      expect(m.calendario.eventos.map((e) => e['id'])).toEqual(['vieja']);
    });
    it('cancelar borra la cita elegida y lo dice; sin citas a su teléfono, transfiere y no borra nada', () => {
      const m = mundo({ eventos: [vieja(), citaDe(OTRA, 'ajena', JUEVES, '15:00', '15:30', 'Rojas, Luis (CNS)')] });
      m.gemini.extraer = extraccion({ intencion: 'cancelar' });
      const lst = m.turno(texto(MAMA, 'quiero cancelar mi cita'));
      // Solo aparece la suya, nunca la de otro teléfono.
      expect(lst.enviados[0]!.cuerpo).toContain('jueves 8 de octubre a las 14:00');
      expect(botonesDe(lst.enviados[0]!).map((b) => b.id)).toEqual(['c|vieja']);
      const t = m.turno(boton(MAMA, 'c|vieja'));
      expect(t.bitacora).toEqual(['borrar:vieja']);
      expect(t.enviados[0]!.cuerpo).toMatch(/cancelé tu cita/);
      // Tocar cancelar sobre la cita de OTRO teléfono no borra nada.
      const t2 = m.turno(boton(MAMA, 'c|ajena'));
      expect(t2.bitacora).toEqual([]);
      expect(m.calendario.eventos.map((e) => e['id'])).toEqual(['ajena']);
      expect(t2.aRecepcion).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------------------- (k)
  describe('(k) vacunas pasa al doctor', () => {
    it('la palabra «vacuna» lleva al doctor con su botón, sin modelo ni calendario ni aviso a recepción', () => {
      const m = mundo({ eventos: [] });
      const t = m.turno(texto(MAMA, 'quiero la vacuna de mi hijo'));
      expect(t.enviados).toHaveLength(1);
      expect(urlDe(t.enviados[0]!)).toContain(`wa.me/${DOC}`);
      expect(t.extraer).toHaveLength(0);
      expect(t.ejecutados.has('Leer agenda')).toBe(false);
      expect(t.aRecepcion).toHaveLength(0);
    });
    it('la opción «Vacunas y otros» del menú hace lo mismo', () => {
      const m = mundo({ eventos: [] });
      m.turno(texto(MAMA, 'hola'));
      const t = m.turno(lista(MAMA, 'vacunas_otros', 'Vacunas y otros'));
      expect(urlDe(t.enviados[0]!)).toContain(`wa.me/${DOC}`);
    });
    it('NIEGA: «cita para control» NO va al doctor', () => {
      const m = mundo({ eventos: [] });
      const t = m.turno(texto(MAMA, 'quiero una cita de control'));
      expect(t.enviados.some((e) => e.cuerpo.includes(`wa.me/${DOC}`) || JSON.stringify(e.payload).includes(`wa.me/${DOC}`))).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------- (l)
  describe('(l) una foto deriva', () => {
    it('una foto no se interpreta ni se clasifica: aviso a recepción más el botón', () => {
      const m = mundo({ eventos: [] });
      const t = m.turno(imagen(MAMA));
      expect(t.extraer).toHaveLength(0);
      expect(t.aRecepcion).toHaveLength(1);
      expect(t.aPaciente(MAMA)).toHaveLength(1);
      expect(urlDe(t.aPaciente(MAMA)[0]!)).toContain(`wa.me/${REC}`);
      expect(t.ejecutados.has('Descargar medio')).toBe(false);
      // Lo que se reporta a la consola no es el contenido de la foto.
      expect(t.ingesta[0]!['texto']).toBe('(imagen) el cliente envió una foto');
    });
    it('NIEGA: un texto común no deriva a nadie', () => {
      const t = mundo({ eventos: [] }).turno(texto(MAMA, 'hola'));
      expect(t.aRecepcion).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------- (m)
  describe('(m) audio', () => {
    it('sin transcripción (nodo desactivado) no rompe: pide escribirlo', () => {
      const m = mundo({ eventos: [], desactivados: ['Transcribir audio'] });
      const t = m.turno(audio(MAMA));
      expect(t.enviados).toHaveLength(1);
      expect(t.enviados[0]!.cuerpo).toMatch(/No pude escuchar bien tu nota de voz/);
      expect(t.extraer).toHaveLength(0);
      // Una nota de voz no deja rastro escrito en la consola.
      expect(t.ingesta[0]!['texto']).toBe('(audio) el cliente envió una nota de voz');
    });
    it('NIEGA: con transcripción, el audio se trata como texto (el menú, al ser el primer mensaje)', () => {
      const m = mundo({ eventos: [] });
      m.gemini.transcripcion = 'hola quiero una cita';
      const t = m.turno(audio(MAMA));
      expect(t.enviados[0]!.payload['interactive']).toBeDefined();
      expect(interactivo(t.enviados[0]!)['type']).toBe('list');
    });
    it('una nota de voz enorme NO se descarga ni se transcribe (revisión de seguridad: costo)', () => {
      const m = mundo({ eventos: [], medioBytes: 16_000_000 });
      m.gemini.transcripcion = 'quiero cita para mañana';
      const t = m.turno(audio(MAMA));
      expect(t.ejecutados.has('Descargar medio')).toBe(false);
      expect(t.ejecutados.has('Transcribir audio')).toBe(false);
      expect(t.enviados.length).toBeGreaterThan(0);
    });
    it('NIEGA: una nota corta sí se transcribe', () => {
      const m = mundo({ eventos: [], medioBytes: 5000 });
      m.gemini.transcripcion = 'hola';
      const t = m.turno(audio(MAMA));
      expect(t.ejecutados.has('Transcribir audio')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------- (n)
  describe('(n) las tres formas de entrada', () => {
    const esperado = (t: Turno): void => {
      expect(t.enviados).toHaveLength(1);
      expect(interactivo(t.enviados[0]!)['type']).toBe('list');
      expect(t.resumen!['resumen']).toMatchObject({ ruta: 'menu' });
    };
    it('disparador de WhatsApp: los campos en la raíz', () => {
      esperado(mundo({ eventos: [] }).turno(texto(MAMA, 'hola')));
    });
    it('Webhook: la misma carga dentro de `body` (flujo de prueba)', () => {
      const m = mundo({ eventos: [], flujo: PRUEBA });
      esperado(m.turno({ headers: {}, params: {}, query: {}, body: texto(MAMA, 'hola') }));
    });
    it('carga completa de Meta (entry/changes/value), en la raíz y dentro de `body`', () => {
      const completa = (v: J): J => ({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: v }] }] });
      esperado(mundo({ eventos: [] }).turno(completa(texto(MAMA, 'hola'))));
      esperado(mundo({ eventos: [], flujo: PRUEBA }).turno({ body: completa(texto(MAMA, 'hola')) }));
    });
    it('NIEGA: una carga sin ningún mensaje no produce nada en ninguna de las formas', () => {
      const vacia = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: PID }, statuses: [] } }] }] };
      expect(mundo({ eventos: [] }).turno(vacia).enviados).toHaveLength(0);
      expect(mundo({ eventos: [], flujo: PRUEBA }).turno({ body: vacia }).enviados).toHaveLength(0);
    });
    it('el Webhook de prueba, con modoPrueba: manda solo al teléfono de prueba (con rótulo), usa el calendario de prueba y no reporta', () => {
      const m = mundo({ eventos: [], flujo: PRUEBA });
      const cuerpo = Object.assign({}, texto(MAMA, 'hola'), { modoPrueba: true, telefonoDePrueba: PRUEBA_TEL, enviarDeVerdad: true, calendarioDePrueba: 'cal-de-prueba' });
      const t = m.turno({ body: cuerpo });
      expect(t.config['modoPrueba']).toBe(true);
      expect(t.config['calendarioId']).toBe('cal-de-prueba');
      expect(t.enviados.map((e) => e.a)).toEqual([PRUEBA_TEL]);
      expect(t.ingesta).toHaveLength(0);
      // Y sin enviarDeVerdad no sale nada, pero el turno se resuelve.
      const m2 = mundo({ eventos: [], flujo: PRUEBA });
      const t2 = m2.turno({ body: Object.assign({}, texto(MAMA, 'hola'), { modoPrueba: true, telefonoDePrueba: PRUEBA_TEL }) });
      expect(t2.enviados).toHaveLength(0);
      const mensajes = (t2.resumen as J)['mensajes'] as J[];
      expect(mensajes).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------------------- (o)
  describe('(o) nodos de envío o de reporte desactivados (devuelven su entrada)', () => {
    const DESACT = ['Reportar mensaje (entrante)', 'Enviar a WhatsApp', 'Enviar respaldo', 'Reportar mensaje (saliente)', 'Registrar cierre (cita)', 'Deshacer cita', 'Borrar evento'];
    it('una conversación completa de cita llega hasta el final sin romper', () => {
      const m = mundo({ eventos: [], desactivados: DESACT.filter((n) => n !== 'Deshacer cita' && n !== 'Borrar evento') });
      hastaPedirNombre(m);
      m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
      const t = m.turno(texto(MAMA, 'Ana Pérez Gómez'));
      expect(m.calendario.eventos).toHaveLength(1);
      expect(t.resumen!['resumen']).toMatchObject({ accion: 'cita_creada' });
      expect((t.resumen!['mensajes'] as J[])[0]!['texto']).toMatch(CONFIRMA);
    });
    it('el resumen sale aunque el envío y el reporte devuelvan su entrada, también en el menú y en la emergencia', () => {
      const m = mundo({ eventos: [], desactivados: DESACT });
      expect(m.turno(texto(MAMA, 'hola')).resumen!['resumen']).toMatchObject({ ruta: 'menu' });
      expect(m.turno(texto(OTRA, 'emergencia')).resumen!['resumen']).toMatchObject({ ruta: 'emergencia' });
    });
    it('NIEGA: desactivar «Borrar evento» en un reagendo no se confunde con que la vieja se borró', () => {
      // Un nodo desactivado deja pasar su entrada, que no trae `error`: el flujo lo toma por hecho. Eso es
      // aceptable SOLO porque nadie desactiva el borrado en producción; queda documentado acá.
      const vieja = citaDe(MAMA, 'vieja', JUEVES, '14:00', '14:30', 'Pérez Gómez, Ana (CNS)');
      const m = mundo({ eventos: [vieja], desactivados: ['Borrar evento'] });
      m.gemini.extraer = extraccion({ intencion: 'mover' });
      m.turno(texto(MAMA, 'mover mi cita'));
      const t = m.turno(boton(MAMA, idHueco(VIERNES, '11:00')));
      expect(t.bitacora).toEqual(['crear:ev-1']);
    });
  });

  // ---------------------------------------------------------------------------------------- (p)
  describe('(p) dos teléfonos no comparten estado', () => {
    it('la conversación de uno no mueve la del otro, y cada uno tiene su clave', () => {
      const m = mundo({ eventos: [] });
      hastaPedirNombre(m); // MAMA queda «esperando_nombre»
      // OTRA escribe un nombre sin haber hablado antes: para ella es un primer mensaje (menú), no una cita.
      const t = m.turno(texto(OTRA, 'Ana Pérez Gómez'));
      expect(m.calendario.eventos).toHaveLength(0);
      expect(interactivo(t.enviados[0]!)['type']).toBe('list');
      expect(Object.keys((m.sd['agendaMinima'] as J)).sort()).toEqual([MAMA, OTRA].sort());
      const estados = m.sd['agendaMinima'] as Record<string, J>;
      expect(estados[MAMA]!['paso']).toBe('esperando_nombre');
      expect(estados[OTRA]!['paso']).toBe('menu');
      // Y MAMA sigue donde estaba: con su nombre, crea SU cita a SU nombre.
      m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
      m.turno(texto(MAMA, 'Ana Pérez Gómez'));
      expect(m.calendario.eventos).toHaveLength(1);
      expect(String(m.calendario.eventos[0]!['description'])).toContain(`Telefono: ${MAMA}`);
      expect(String(m.calendario.eventos[0]!['description'])).not.toContain(OTRA);
    });
    it('NIEGA: un estado vencido (más de 30 minutos) vuelve a «inicio»', () => {
      const m = mundo({ eventos: [] });
      hastaPedirNombre(m);
      m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
      const t = m.turno(texto(MAMA, 'Ana Pérez Gómez'), { avanzarMin: 45 });
      expect(m.calendario.eventos).toHaveLength(0);
      expect(interactivo(t.enviados[0]!)['type']).toBe('list');
    });
    it('la ingesta de cada turno lleva el teléfono de quien escribe', () => {
      const m = mundo({ eventos: [] });
      expect(m.turno(texto(MAMA, 'hola')).ingesta[0]!['telefono']).toBe(MAMA);
      expect(m.turno(texto(OTRA, 'hola')).ingesta[0]!['telefono']).toBe(OTRA);
    });
  });

  // ---------------------------------------------------------------------------------------- (q)
  describe('(q) producción y prueba: disparadores y modo prueba', () => {
    const tipos = (f: Flujo): string[] => f.nodes.map((n) => n.type);
    it('el JSON de producción tiene el disparador de WhatsApp y NINGÚN Webhook', () => {
      expect(tipos(PRODUCCION)).toContain('n8n-nodes-base.whatsAppTrigger');
      expect(tipos(PRODUCCION).some((t) => /webhook/i.test(t))).toBe(false);
      expect(PRODUCCION.nodes.some((n) => n.name === 'Entrada de prueba')).toBe(false);
    });
    it('el JSON de prueba tiene el Webhook y NINGÚN WhatsApp Trigger', () => {
      expect(tipos(PRUEBA).some((t) => /webhook/i.test(t))).toBe(true);
      expect(tipos(PRUEBA).some((t) => /whatsAppTrigger/i.test(t))).toBe(false);
      expect(PRUEBA.nodes.some((n) => n.name === 'WhatsApp Trigger')).toBe(false);
      // Ninguna conexión cuelga de un nodo que no existe.
      for (const f of [PRODUCCION, PRUEBA]) {
        const nombres = new Set(f.nodes.map((n) => n.name));
        for (const [de, sal] of Object.entries(f.connections)) {
          expect(nombres.has(de)).toBe(true);
          for (const s of sal['main'] ?? []) for (const c of s) expect(nombres.has(c.node)).toBe(true);
        }
      }
    });
    it('`modoPrueba` dentro del mensaje, en la raíz o en un `body` NO activa nada en producción', () => {
      const m = mundo({ eventos: [] });
      const malicioso = Object.assign({}, texto(MAMA, 'modoPrueba'), {
        modoPrueba: true, telefonoDePrueba: PRUEBA_TEL, enviarDeVerdad: false, calendarioDePrueba: 'cal-del-atacante',
        body: { modoPrueba: true, telefonoDePrueba: PRUEBA_TEL, calendarioDePrueba: 'cal-del-atacante' },
      });
      (malicioso['messages'] as J[])[0]!['modoPrueba'] = true;
      const t = m.turno(malicioso);
      expect(t.config['modoPrueba']).toBe(false);
      expect(t.config['calendarioId']).toBe(CAL);
      expect(t.enviados.map((e) => e.a)).toEqual([MAMA]); // al paciente, no al teléfono de prueba
      expect(t.ingesta).toHaveLength(2); // el entrante y el saliente se reportan, como siempre
    });
    it('NIEGA: en el flujo de prueba, el mismo `modoPrueba` dentro de un mensaje (sin el cuerpo del Webhook) tampoco lo activa si no es `=== true` en el cuerpo', () => {
      const m = mundo({ eventos: [], flujo: PRUEBA });
      const t = m.turno({ body: Object.assign({}, texto(MAMA, 'hola'), { modoPrueba: 'true', telefonoDePrueba: PRUEBA_TEL }) });
      expect(t.config['modoPrueba']).toBe(false);
      expect(t.enviados.map((e) => e.a)).toEqual([MAMA]);
    });
  });

  // ---------------------------------------------------------------------------------------- (r)
  describe('(r) el reporte del entrante va antes de la rama del modelo', () => {
    it('por conexiones: ningún camino de «Interpretar entrada» a «Extraer» o «Redactar» se salta «¿Reportar? (entrante)»', () => {
      for (const f of [PRODUCCION, PRUEBA]) {
        const sucesores = (n: string): string[] => (f.connections[n]?.['main'] ?? []).flat().map((c) => c.node);
        const alcanzaSin = (desde: string, objetivo: string, bloqueado: string): boolean => {
          const visto = new Set<string>(); const pila = [desde];
          while (pila.length) {
            const n = pila.pop()!;
            if (n === bloqueado || visto.has(n)) continue;
            visto.add(n);
            if (n === objetivo) return true;
            pila.push(...sucesores(n));
          }
          return false;
        };
        expect(alcanzaSin('Interpretar entrada', 'Extraer', '¿Reportar? (entrante)')).toBe(false);
        expect(alcanzaSin('Interpretar entrada', 'Redactar', '¿Reportar? (entrante)')).toBe(false);
        // Y sin ese bloqueo, sí llega (la prueba no es vacía).
        expect(alcanzaSin('Interpretar entrada', 'Extraer', 'Nodo que no existe')).toBe(true);
        // El reporte cuelga de la salida verdadera de «¿Reportar? (entrante)».
        expect(f.connections['¿Reportar? (entrante)']!['main']![0]!.map((c) => c.node)).toEqual(['Reportar mensaje (entrante)']);
        expect(f.settings?.['executionOrder']).toBe('v1');
        // Por posición: arriba de la rama del modelo.
        const y = (n: string): number => f.nodes.find((x) => x.name === n)!.position![1];
        expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('Extraer'));
      }
    });
    it('en una ejecución: el entrante se reporta antes de llamar al modelo y antes que cualquier saliente', () => {
      const m = mundo({ eventos: [] });
      m.turno(texto(MAMA, 'quiero cita el jueves en la tarde'));
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES, franja: 'tarde' });
      const t = m.turno(lista(MAMA, SERV_CNS, 'x'));
      const i = (n: string): number => t.orden.indexOf(n);
      expect(i('Reportar mensaje (entrante)')).toBeGreaterThan(-1);
      expect(i('Reportar mensaje (entrante)')).toBeLessThan(i('Extraer'));
      expect(i('Reportar mensaje (entrante)')).toBeLessThan(i('Reportar mensaje (saliente)'));
      expect(t.ingesta.map((x) => x['direccion'])).toEqual(['entrante', 'saliente']);
    });
    it('NIEGA: el aviso de uso extendido y el comercio suspendido cortan ANTES del modelo y del calendario', () => {
      const t = mundo({ eventos: [], panel: Object.assign({}, PANEL, { estadoComercio: 'suspendido' }) }).turno(texto(MAMA, 'hola'));
      expect(t.ejecutados.has('Decidir turno')).toBe(false);
      expect(t.enviados).toHaveLength(1);
      expect(t.enviados[0]!.cuerpo).toMatch(/no podemos atenderte/);
      const u = mundo({ eventos: [], ingesta: { atencion: { estado: 'operador', mensajeFijo: 'Te atiende una persona del equipo.', avisarRecepcion: 'operador', respuestasEnVentana: 50 } } }).turno(texto(MAMA, 'hola'));
      expect(u.ejecutados.has('Extraer')).toBe(false);
      expect(u.aPaciente(MAMA)[0]!.cuerpo).toBe('Te atiende una persona del equipo.');
      expect(u.aRecepcion).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------------------- (s)
  describe('(s) sin secuencias de 10 dígitos ni identificadores', () => {
    for (const archivo of ['agenda-minima.v0.json', 'agenda-minima.prueba.json']) {
      const texto_ = readFileSync(join(CARPETA, archivo), 'utf8');
      it(`${archivo}: ninguna secuencia de 10 dígitos o más`, () => {
        expect(texto_.match(/\d{10,}/g)).toBeNull();
      });
      it(`${archivo}: sin UUID, sin rutas de usuario y con las credenciales por nombre y sin id`, () => {
        expect(texto_).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        expect(texto_).not.toMatch(/\/home\/|\/Users\//);
        const f = JSON.parse(texto_) as Flujo;
        for (const n of f.nodes) for (const c of Object.values(n.credentials ?? {})) expect(c.id).toBe('');
        expect(texto_).toMatch(/REEMPLAZAR_/);
      });
    }
    it('NIEGA: el detector sí ve un número de teléfono de verdad (no es una prueba vacía)', () => {
      expect(('wa.me/' + '5917' + '1234567').match(/\d{10,}/g)).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------- (t)
  describe('(t) los JSON versionados son lo que arma la plantilla', () => {
    it('`construir.mjs --verificar` sale con 0', () => {
      const salida = execFileSync(process.execPath, [join(CARPETA, 'construir.mjs'), '--verificar'], { env: entornoDelEmulador(undefined), encoding: 'utf8' });
      expect(salida).toMatch(/agenda-minima\.v0\.json al día/);
      expect(salida).toMatch(/agenda-minima\.prueba\.json al día/);
    });
  });

  // ---------------------------------------------------------------------------------------- (u)
  describe('(u) sin panel de la consola', () => {
    it('recepción y doctor salen de los marcadores de «Config base» si fueron reemplazados; el calendario queda vacío', () => {
      const m = mundo({ eventos: [], panel: false, configBase: { respaldoNumeroRecepcion: REC, respaldoNumeroDoctor: DOC } });
      const t = m.turno(texto(MAMA, 'emergencia'));
      expect(t.config['panelSinRespuesta']).toBe(true);
      expect(t.config['calendarioId']).toBe('');
      expect(urlDe(t.aPaciente(MAMA)[0]!)).toContain(`wa.me/${REC}`);
      expect(t.aDoctor[0]!.payload['type']).toBe('template');
      // Sin calendario no se agenda nunca: se transfiere.
      const m2 = mundo({ eventos: [], panel: false, configBase: { respaldoNumeroRecepcion: REC, respaldoNumeroDoctor: DOC } });
      m2.turno(texto(MAMA, 'hola'));
      const t2 = m2.turno(lista(MAMA, SERV_CNS, 'x'));
      expect(m2.calendario.eventos).toHaveLength(0);
      expect(t2.bitacora).toEqual([]);
      expect(t2.ejecutados.has('Crear evento')).toBe(false);
      expect(textos(t2)).not.toMatch(CONFIRMA);
      expect(t2.aRecepcion).toHaveLength(1);
      expect(urlDe(t2.aPaciente(MAMA)[0]!)).toContain(`wa.me/${REC}`);
    });
    it('NIEGA: con los marcadores SIN reemplazar no hay a quién avisar y nunca sale un número inventado', () => {
      const m = mundo({ eventos: [], panel: false });
      const t = m.turno(texto(MAMA, 'emergencia'));
      expect(t.config['numeroRecepcion']).toBe('');
      expect(t.config['numeroDoctor']).toBe('');
      expect(t.aDoctor).toHaveLength(0);
      expect(t.aRecepcion).toHaveLength(0);
      expect(t.aPaciente(MAMA)[0]!.payload['type']).toBe('text'); // sin número no hay botón
      expect(JSON.stringify(t.enviados.map((e) => e.payload))).not.toMatch(/REEMPLAZAR|wa\.me/);
    });
    it('el menú sigue funcionando sin panel (el paciente nunca se queda sin respuesta)', () => {
      const t = mundo({ eventos: [], panel: false }).turno(texto(MAMA, 'hola'));
      expect(interactivo(t.enviados[0]!)['type']).toBe('list');
    });
    it('`calendarioForzado` de «Config base» manda sobre el calendario del panel (apuntar a uno de prueba)', () => {
      const m = mundo({ eventos: [], configBase: { calendarioForzado: 'cal-de-prueba' } });
      m.turno(texto(MAMA, 'hola'));
      m.gemini.extraer = extraccion();
      const t = m.turno(lista(MAMA, SERV_CNS, 'x'));
      expect(t.config['calendarioId']).toBe('cal-de-prueba');
    });
  });

  // ------------------------------------------------------------------------------ reglas de contrato
  describe('(v) reglas del contrato que no son un caso de la lista', () => {
    const MARTES = '2026-10-06';
    const DOMINGO = '2026-10-11';
    const pedir = (m: ReturnType<typeof mundo>, ext: J): Turno => {
      m.turno(texto(MAMA, 'quiero una cita'));
      m.gemini.extraer = extraccion(ext);
      return m.turno(lista(MAMA, SERV_CNS, 'x'));
    };
    it('sin fecha se ofrece DESDE MAÑANA (el lunes a las 10:00 todavía hay huecos hoy, y no se ofrecen)', () => {
      const t = pedir(mundo({ eventos: [] }), {});
      for (const b of botonesDe(t.enviados[0]!)) expect(b.id.split('|')[1]).toMatch(new RegExp(`^${MARTES}`));
    });
    it('NIEGA: si pide HOY, se ofrece hoy, respetando la anticipación mínima de 2 horas (12:30)', () => {
      const t = pedir(mundo({ eventos: [] }), { pidioHoy: true, fechaPreferida: '2026-10-05' });
      const ids = botonesDe(t.enviados[0]!).map((b) => b.id);
      // Son las 10:02 (el reloj avanza un minuto por turno): 2 horas de anticipación dan 12:02, o sea 12:30.
      expect(ids[0]).toBe(idHueco('2026-10-05', '12:30'));
      for (const id of ids) expect(id.split('|')[1]! >= iso('2026-10-05', '12:02')).toBe(true);
    });
    it('un domingo (cerrado) se dice y se ofrece el día siguiente con huecos; nunca un hueco en domingo', () => {
      const t = pedir(mundo({ eventos: [] }), { fechaPreferida: DOMINGO });
      expect(t.enviados[0]!.cuerpo).toMatch(/no atendemos/);
      const ids = botonesDe(t.enviados[0]!).map((b) => b.id);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(id.split('|')[1]).toMatch(/^2026-10-12/);
    });
    it('una hora concreta que está libre va primera; ocupada, se dice y se ofrecen las más cercanas', () => {
      const libre = pedir(mundo({ eventos: [] }), { fechaPreferida: VIERNES, horaPreferida: '16:00' });
      expect(botonesDe(libre.enviados[0]!)[0]!.id).toBe(idHueco(VIERNES, '16:00'));
      const ocupada = pedir(mundo({ eventos: [evento('o1', VIERNES, '16:00', '16:30', 'Otro')] }), { fechaPreferida: VIERNES, horaPreferida: '16:00' });
      const ids = botonesDe(ocupada.enviados[0]!).map((b) => b.id);
      expect(ids).not.toContain(idHueco(VIERNES, '16:00'));
      expect(ocupada.enviados[0]!.cuerpo).toMatch(/no está disponible/);
    });
    it('NADA CLÍNICO: una pregunta de dosis no se contesta: aviso a recepción más botón, sin redactar', () => {
      const m = mundo({ eventos: [] });
      m.gemini.redactar = 'Dale 5 ml de paracetamol cada 6 horas.'; // si llegara a redactarse, no puede salir
      const t = pedir(m, { intencion: 'consultar', pregunta: 'cuánta dosis de paracetamol le doy a mi bebé' });
      expect(t.redactar).toHaveLength(0);
      expect(textos(t)).not.toMatch(/paracetamol|\bml\b/i);
      expect(t.aRecepcion).toHaveLength(1);
      expect(urlDe(t.aPaciente(MAMA)[0]!)).toContain(`wa.me/${REC}`);
    });
    it('NIEGA: una pregunta de costo con respuesta en la configuración SÍ se contesta (un texto, sin recepción)', () => {
      const m = mundo({ eventos: [] });
      m.gemini.redactar = 'La consulta cuesta 250 Bs.';
      const t = pedir(m, { intencion: 'consultar', pregunta: 'cuánto cuesta la consulta' });
      expect(t.enviados).toHaveLength(1);
      expect(t.enviados[0]!.cuerpo).toBe('La consulta cuesta 250 Bs.');
      expect(t.aRecepcion).toHaveLength(0);
    });
    it('una pregunta sin respuesta (SIN_RESPUESTA) pasa con recepción: aviso más botón, nunca «te aviso»', () => {
      const m = mundo({ eventos: [] });
      m.gemini.redactar = 'SIN_RESPUESTA';
      const t = pedir(m, { intencion: 'consultar', pregunta: 'atienden seguros' });
      expect(t.aRecepcion).toHaveLength(1);
      expect(urlDe(t.aPaciente(MAMA)[0]!)).toContain(`wa.me/${REC}`);
      expect(textos(t)).not.toMatch(/te aviso|lo consulto|te llamamos|te escribir/i);
    });
    it('una redacción que PROMETE («te aviso», «lo consulto») se descarta y sale el texto fijo con los botones', () => {
      const m = mundo({ eventos: [] });
      m.gemini.redactar = 'Tengo estos horarios y te aviso si se libera otro.';
      const t = pedir(m, { fechaPreferida: VIERNES });
      expect(t.enviados[0]!.cuerpo).not.toMatch(/te aviso/);
      expect(botonesDe(t.enviados[0]!).length).toBeGreaterThan(0);
    });
    it('el modelo que extrae un servicio vacunas manda al doctor, sin calendario', () => {
      const t = pedir(mundo({ eventos: [] }), { servicio: 'vacunas_otros' });
      expect(urlDe(t.enviados[0]!)).toContain(`wa.me/${DOC}`);
      expect(t.ejecutados.has('Leer agenda')).toBe(false);
    });
    it('un campo raro del modelo se descarta, no se obedece (fecha inventada, hora fuera de rango, intención desconocida)', () => {
      const m = mundo({ eventos: [] });
      m.turno(texto(MAMA, 'quiero una cita'));
      m.gemini.extraer = extraccion({ fechaPreferida: '2026-13-45', horaPreferida: '99:99', franja: 'madrugada' });
      const t = m.turno(lista(MAMA, SERV_CNS, 'x'));
      expect(botonesDe(t.enviados[0]!).length).toBeGreaterThan(0);
      m.gemini.extraer = extraccion({ intencion: 'borrar_todo' });
      const e = m.turno(texto(MAMA, 'borra todo'));
      expect(m.calendario.eventos).toHaveLength(0);
      expect(e.aRecepcion).toHaveLength(1); // intención desconocida = error del modelo = transferencia
    });
    it('varias citas: se lista solo las suyas y cada botón cancela solo la que dice', () => {
      const m = mundo({ eventos: [
        citaDe(MAMA, 'c1', JUEVES, '14:00', '14:30', 'Pérez Gómez, Ana (CNS)'),
        citaDe(MAMA, 'c2', VIERNES, '11:00', '11:30', 'Pérez Gómez, Luis (RN)'),
        citaDe(OTRA, 'c3', VIERNES, '12:00', '12:30', 'Rojas, Eva (CNS)'),
      ] });
      m.gemini.extraer = extraccion({ intencion: 'cancelar' });
      const lst = m.turno(texto(MAMA, 'quiero cancelar una cita'));
      expect(botonesDe(lst.enviados[0]!).map((b) => b.id)).toEqual(['c|c1', 'c|c2']);
      m.turno(boton(MAMA, 'c|c2'));
      expect(m.calendario.eventos.map((e) => e['id']).sort()).toEqual(['c1', 'c3']);
    });
    it('uso extendido («bloqueado»): no se le contesta nada y recepción se entera una vez', () => {
      const t = mundo({ eventos: [], ingesta: { atencion: { estado: 'bloqueado', avisarRecepcion: 'bloqueado', respuestasEnVentana: 80 } } }).turno(texto(MAMA, 'hola'));
      expect(t.aPaciente(MAMA)).toHaveLength(0);
      expect(t.aRecepcion).toHaveLength(1);
      expect(t.ejecutados.has('Decidir turno')).toBe(false);
    });
    it('un aviso a recepción nunca va al propio número de recepción', () => {
      const t = mundo({ eventos: [] }).turno(imagen(REC));
      expect(t.enviados.filter((e) => e.a === REC)).toHaveLength(1); // solo la respuesta al paciente (que es recepción misma)
      expect(t.enviados[0]!.tipo).toBe('interactive');
    });
    it('un prefijo de país no permitido no recibe respuesta (responder a un número extranjero cuesta su tarifa)', () => {
      const t = mundo({ eventos: [] }).turno(texto('12000000077', 'hola'));
      expect(t.enviados).toHaveLength(0);
      expect(t.ejecutados.has('Decidir turno')).toBe(false);
    });
    it('un audio transcripto que es un pedido de cita entra como texto', () => {
      const m = mundo({ eventos: [] });
      m.turno(texto(MAMA, 'hola'));
      m.gemini.transcripcion = 'necesito una cita para mi bebé el viernes';
      m.gemini.extraer = extraccion({ fechaPreferida: VIERNES });
      const t = m.turno(audio(MAMA));
      expect(t.extraer).toHaveLength(1);
      expect(JSON.stringify(t.extraer[0])).toContain('necesito una cita para mi bebé el viernes');
    });
    it('el cuerpo que va a la extracción lleva la fecha y la hora de La Paz, el día de la semana y el mensaje como dato', () => {
      const m = mundo({ eventos: [] });
      m.turno(texto(MAMA, 'quiero una cita'));
      m.gemini.extraer = extraccion({});
      const t = m.turno(lista(MAMA, SERV_CNS, 'x'));
      const cuerpo = JSON.stringify(t.extraer[0]);
      expect(cuerpo).toContain('lunes 2026-10-05 10:0');
      expect(cuerpo).toContain('jueves 8 = 2026-10-08');
      expect(cuerpo).not.toMatch(/temperature|topP/);
      expect((t.extraer[0]!['generationConfig'] as J)['maxOutputTokens']).toBe(200);
    });
    it('UN mensaje reportado por cada saliente AL PACIENTE: la emergencia reporta uno aunque salgan dos mensajes', () => {
      const t = mundo({ eventos: [] }).turno(texto(MAMA, 'emergencia'));
      expect(t.enviados).toHaveLength(2);
      expect(t.ingesta.map((x) => x['direccion'])).toEqual(['entrante', 'saliente']);
      expect(t.ingesta[1]!['telefono']).toBe(MAMA);
    });
    it('INSISTIR sobre una hora ocupada: tres toques seguidos al mismo botón viejo nunca crean una cita encima de otra', () => {
      const m = mundo({ eventos: [] });
      m.turno(texto(MAMA, 'quiero cita el jueves'));
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES, franja: 'tarde' });
      m.turno(lista(MAMA, SERV_CNS, 'x'));
      m.calendario.eventos.push(evento('o1', JUEVES, '14:00', '14:30', 'Otro paciente'));
      for (let i = 0; i < 3; i++) {
        const t = m.turno(boton(MAMA, idHueco(JUEVES, '14:00')));
        expect(t.bitacora).toEqual([]);
        expect(t.enviados[0]!.cuerpo).toMatch(/ya no está disponible/);
      }
      expect(m.calendario.eventos).toHaveLength(1);
    });
    it('un doble toque del mismo botón DESPUÉS de confirmar no duplica la cita (el hueco ya es suyo)', () => {
      const m = mundo({ eventos: [] });
      hastaPedirNombre(m);
      m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
      m.turno(texto(MAMA, 'Ana Pérez Gómez'));
      expect(m.calendario.eventos).toHaveLength(1);
      const t = m.turno(boton(MAMA, idHueco(JUEVES, '14:00')));
      expect(t.bitacora).toEqual([]);
      expect(m.calendario.eventos).toHaveLength(1);
      expect(textos(t)).not.toMatch(CONFIRMA);
    });
    it('el cuerpo de todo interactivo respeta los topes de Meta (cuerpo 1024, botones 3 de 20 caracteres, ids de 256)', () => {
      const m = mundo({ eventos: [] });
      const vistos: Enviado[] = [];
      vistos.push(...m.turno(texto(MAMA, 'quiero cita el jueves')).enviados);
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES });
      vistos.push(...m.turno(lista(MAMA, SERV_CNS, 'x')).enviados);
      for (const e of vistos.filter((x) => x.tipo === 'interactive')) {
        expect(e.cuerpo.length).toBeLessThanOrEqual(1024);
        for (const b of botonesDe(e)) { expect(b.title.length).toBeLessThanOrEqual(20); expect(b.id.length).toBeLessThanOrEqual(256); }
        expect(botonesDe(e).length).toBeLessThanOrEqual(3);
      }
    });
  });

  // ------------------------------------------------------------------------- la conversación
  describe('una conversación típica de cita: cuántos mensajes salen', () => {
    it('traza: con AGM_VER=1 imprime la conversación para leerla con los ojos (sin ella no imprime nada)', () => {
      const m = mundo({ eventos: [] });
      const ver = process.env['AGM_VER'] === '1';
      const imprimir = (quien: string, t: Turno): void => {
        if (!ver) return;
        for (const e of t.enviados) console.log(`[${quien}] -> ${e.a === MAMA ? 'paciente' : e.a === REC ? 'recepción' : 'doctor'} (${e.tipo}): ${e.cuerpo.replace(/\n/g, ' / ')}${e.tipo === 'interactive' && botonesDe(e).length ? '  [' + botonesDe(e).map((b) => b.title).join(' | ') + ']' : ''}`);
      };
      imprimir('1 hola', m.turno(texto(MAMA, 'quiero cita el jueves en la tarde')));
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES, franja: 'tarde' });
      imprimir('2 servicio', m.turno(lista(MAMA, SERV_CNS, 'x')));
      imprimir('3 hueco', m.turno(boton(MAMA, idHueco(JUEVES, '14:00'))));
      m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
      const fin = m.turno(texto(MAMA, 'Ana Pérez Gómez'));
      imprimir('4 nombre', fin);
      expect(fin.enviados[0]!.cuerpo).toMatch(CONFIRMA);
    });
    it('cuatro mensajes al paciente (menú, oferta, nombre, confirmación), y ninguno de texto aparte para la oferta', () => {
      const m = mundo({ eventos: [] });
      const tipo = (t: Turno): number => t.aPaciente(MAMA).length;
      const a = m.turno(texto(MAMA, 'quiero cita el jueves en la tarde'));
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES, franja: 'tarde' });
      const b = m.turno(lista(MAMA, SERV_CNS, 'x'));
      const c = m.turno(boton(MAMA, idHueco(JUEVES, '14:00')));
      m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
      const d = m.turno(texto(MAMA, 'Ana Pérez Gómez'));
      expect([a, b, c, d].map(tipo)).toEqual([1, 1, 1, 1]);
      expect(m.log.enviados.filter((e) => e.a === MAMA)).toHaveLength(4);
      // Ni recepción ni el doctor reciben nada en el camino feliz.
      expect(m.log.enviados.filter((e) => e.a !== MAMA)).toHaveLength(0);
      // Ingesta: 4 entrantes + 4 salientes; cierre: 1.
      expect(m.log.ingesta).toHaveLength(8);
      expect(m.log.cierres).toHaveLength(1);
      // Llamadas al modelo: una extracción y una redacción como máximo por turno de texto libre.
      expect(m.log.extraer).toHaveLength(2);
    });
  });
});

// =================================================================================================
// COBERTURA ADICIONAL: pedidos del doctor y protecciones que los bloques de arriba no fijaban.
// =================================================================================================
describe('Agenda mínima v0: pedidos del doctor y protecciones (cobertura adicional)', () => {
  const MARTES = '2026-10-06'; // «desde mañana»: hoy es lunes 05/10 a las 10:00
  /** Hola, y el servicio elegido en el menú: sin texto previo, el saludo no pasa por el modelo. */
  const hastaElServicio = (m: ReturnType<typeof mundo>, srv = SERV_CNS): Turno => {
    m.turno(texto(MAMA, 'hola'));
    return m.turno(lista(MAMA, srv, 'Servicio'));
  };

  it('P8: los huecos son cada 30 minutos y lo que manda es la hora de FIN del evento', () => {
    const m = mundo({ eventos: [evento('p1', JUEVES, '14:15', '14:30', 'cita de 15 minutos'), evento('p2', JUEVES, '15:15', '15:45', 'cita de 30 minutos')] });
    hastaElServicio(m);
    m.gemini.extraer = extraccion({ fechaPreferida: JUEVES });
    const t = m.turno(texto(MAMA, 'el jueves'));
    // La de 14:15 a 14:30 deja libre las 14:30; la de 15:15 a 15:45 bloquea las 15:00 y las 15:30.
    expect(botonesDe(t.enviados[0]!).map((b) => b.id)).toEqual([idHueco(JUEVES, '14:30'), idHueco(JUEVES, '16:00'), idHueco(JUEVES, '16:30')]);
  });

  it('R2: si pide «otra hora», no se repiten las mismas tres: salen las que siguen', () => {
    const m = mundo({ eventos: [] });
    const primera = hastaElServicio(m);
    const antes = botonesDe(primera.enviados[0]!).map((b) => b.id);
    expect(antes).toEqual([idHueco(MARTES, '11:00'), idHueco(MARTES, '11:30'), idHueco(MARTES, '12:00')]);
    m.gemini.extraer = extraccion({ masOpciones: true });
    const t = m.turno(texto(MAMA, 'otra hora por favor'));
    const despues = botonesDe(t.enviados[0]!).map((b) => b.id);
    expect(despues).toEqual([idHueco(MARTES, '12:30'), idHueco(MARTES, '13:00'), idHueco(MARTES, '13:30')]);
    for (const id of despues) expect(antes).not.toContain(id);
  });

  it('R13: ningún texto sale con un hueco («a las )»): la redacción se descarta y sale el texto fijo con las horas', () => {
    for (const malo of ['Tengo estos horarios: a las ). Toca uno.', 'Te espero (por ejemplo, a las ) el jueves.']) {
      const m = mundo({ eventos: [] });
      hastaElServicio(m);
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES });
      m.gemini.redactar = malo;
      const t = m.turno(texto(MAMA, 'el jueves'));
      expect(t.enviados[0]!.cuerpo).not.toMatch(/a las\s*\)|\(\s*\)/);
      expect(t.enviados[0]!.cuerpo).toContain('a las 14:00');
    }
  });

  it('la aritmética: «no quedan horarios» con huecos calculados se descarta', () => {
    const m = mundo({ eventos: [] });
    hastaElServicio(m);
    m.gemini.extraer = extraccion({ fechaPreferida: JUEVES });
    m.gemini.redactar = 'Lo siento, no quedan horarios para esa fecha.';
    const t = m.turno(texto(MAMA, 'el jueves'));
    expect(t.enviados[0]!.cuerpo).not.toMatch(/no quedan horarios/);
    expect(botonesDe(t.enviados[0]!)).toHaveLength(3);
  });

  it('las redes del doctor van DENTRO del mensaje de confirmación: un solo mensaje, no dos', () => {
    const redes = 'Síguenos en nuestras redes: https://ejemplo.org/consultorio';
    const m = mundo({ eventos: [], panel: { ...PANEL, datosDelNegocio: { ...PANEL.datosDelNegocio, mensajeRedes: redes } } });
    hastaPedirNombre(m);
    m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
    const t = m.turno(texto(MAMA, 'Ana Pérez Gómez'));
    expect(t.aPaciente(MAMA)).toHaveLength(1);
    expect(t.enviados[0]!.cuerpo).toMatch(CONFIRMA);
    expect(t.enviados[0]!.cuerpo).toContain(redes);
  });

  it('cancelar al empezar una conversación nueva no pasa por el menú: va directo al botón de la cita', () => {
    const m = mundo({ eventos: [citaDe(MAMA, 'c1', JUEVES, '15:00', '15:30', 'Pérez Gómez, Ana (CNS)')] });
    m.gemini.extraer = extraccion({ intencion: 'cancelar' });
    const t = m.turno(texto(MAMA, 'quiero cancelar mi cita'));
    expect(interactivo(t.enviados[0]!)['type']).toBe('button');
    expect(botonesDe(t.enviados[0]!).map((b) => b.id)).toEqual(['c|c1']);
    expect(m.calendario.eventos).toHaveLength(1); // todavía no se cancela
  });

  it('un saludo antes del menú no pasa por el modelo al elegir el servicio; un pedido concreto sí', () => {
    const a = mundo({ eventos: [] });
    const t = hastaElServicio(a);
    expect(t.extraer).toHaveLength(0);
    expect(botonesDe(t.enviados[0]!)).toHaveLength(3);
    const b = mundo({ eventos: [] });
    b.turno(texto(MAMA, 'quiero cita el jueves en la tarde'));
    b.gemini.extraer = extraccion({ fechaPreferida: JUEVES, franja: 'tarde' });
    expect(b.turno(lista(MAMA, SERV_CNS, 'Servicio')).extraer).toHaveLength(1);
  });

  it('el servicio lo elige el menú (o el botón), no el modelo: si el modelo dice «niño sano» y tocó «recién nacido», la cita lleva (RN)', () => {
    const m = mundo({ eventos: [] });
    hastaPedirNombre(m, SERV_RN);
    m.gemini.extraer = extraccion({ servicio: SERV_CNS, pacientes: ['Luis Rojas Vaca'] });
    m.turno(texto(MAMA, 'Luis Rojas Vaca'));
    expect(m.calendario.eventos[0]!['summary']).toBe('Rojas Vaca, Luis (RN)');
  });

  it('el costo de la consulta no sale al ofrecer horarios ni al confirmar (solo si preguntan)', () => {
    const panel = { ...PANEL, datosDelNegocio: { ...PANEL.datosDelNegocio, instruccionesExtra: `${PANEL.datosDelNegocio.instruccionesExtra} COSTO: la consulta cuesta 250 Bs; dilo SOLO si preguntan.` } };
    const m = mundo({ eventos: [], panel });
    const oferta = hastaElServicio(m);
    hastaPedirNombre(m);
    m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
    const conf = m.turno(texto(MAMA, 'Ana Pérez Gómez'));
    expect(textos(oferta) + textos(conf)).not.toMatch(/250|Bs\b|cuesta/);
  });
});

describe('Agenda mínima v0: el pulido de la redacción (prueba real en n8n del 30/09)', () => {
  const ofertaCon = (redaccion: string): Turno => {
    const m = mundo({ eventos: [] });
    m.turno(texto(MAMA, 'quiero cita el jueves en la tarde'));
    m.gemini.extraer = extraccion({ fechaPreferida: JUEVES, franja: 'tarde' });
    m.gemini.redactar = redaccion;
    return m.turno(lista(MAMA, SERV_CNS, 'Control niño sano'));
  };
  it('el menú ya saludó: la oferta no vuelve a decir «¡Hola! Soy la asistente…»', () => {
    const t = ofertaCon('¡Hola! Soy la asistente virtual del consultorio. Para el jueves en la tarde tengo estos horarios.');
    expect(t.enviados[0]!.cuerpo).toBe('Para el jueves en la tarde tengo estos horarios.');
  });
  it('P1: un nombre del negocio con otros acentos vuelve a la forma de la configuración', () => {
    const t = ofertaCon('En el Consultório Éjemplo tengo estos horarios para el jueves en la tarde.');
    expect(t.enviados[0]!.cuerpo).toContain('Consultorio Ejemplo');
    expect(t.enviados[0]!.cuerpo).not.toMatch(/Consultório|Éjemplo/);
  });
  it('NIEGA: un texto sin saludo ni nombre queda igual', () => {
    const t = ofertaCon('Para el jueves en la tarde tengo estos horarios. Toca el que prefieras.');
    expect(t.enviados[0]!.cuerpo).toBe('Para el jueves en la tarde tengo estos horarios. Toca el que prefieras.');
  });
});

// =================================================================================================
// Ronda 2 de la revisora: HB2 (escribir la hora ofrecida la elige), HB3 (cancelar o mover con una
// oferta pendiente) y HB4 (tres rechazos seguidos pasan con recepción).
// =================================================================================================
describe('Agenda mínima v0: ronda 2 de la revisora', () => {
  const MARTES = '2026-10-06';
  const MIERCOLES = '2026-10-07';
  /** Hola y el servicio elegido en el menú: la oferta «desde mañana» (martes 11:00, 11:30 y 12:00). */
  const conOferta = (m: ReturnType<typeof mundo>, srv = SERV_CNS): Turno => {
    m.turno(texto(MAMA, 'hola'));
    return m.turno(lista(MAMA, srv, 'Servicio'));
  };
  /** Una oferta del jueves en la tarde, con las 14:00 a las 16:00 ocupadas: 16:00, 16:30 y 17:00. */
  const ofertaDelJueves = (): { m: ReturnType<typeof mundo>; oferta: Turno } => {
    const m = mundo({ eventos: [evento('bloqueo', JUEVES, '14:00', '16:00', 'Otro paciente')] });
    m.turno(texto(MAMA, 'quiero cita el jueves'));
    m.gemini.extraer = extraccion({ fechaPreferida: JUEVES });
    const oferta = m.turno(lista(MAMA, SERV_CNS, 'Servicio'));
    return { m, oferta };
  };
  const idsDe = (t: Turno): string[] => (t.enviados.length && t.enviados[0]!.tipo === 'interactive' && interactivo(t.enviados[0]!)['type'] === 'button' ? botonesDe(t.enviados[0]!).map((b) => b.id) : []);

  // ------------------------------------------------------------------------------------- HB2
  describe('HB2: escribir la hora ofrecida equivale a tocar ese botón', () => {
    it('«a las 11:30», con el modelo caído: toma el botón de las 11:30, pide el nombre y al darlo crea esa cita', () => {
      const m = mundo({ eventos: [] });
      const oferta = conOferta(m);
      expect(idsDe(oferta)).toEqual([idHueco(MARTES, '11:00'), idHueco(MARTES, '11:30'), idHueco(MARTES, '12:00')]);
      m.gemini.extraer = 'ERROR';
      const t = m.turno(texto(MAMA, 'a las 11:30'));
      expect(t.enviados).toHaveLength(1);
      expect(t.enviados[0]!.cuerpo).toMatch(/Cómo se llama el niño o la niña/);
      expect(m.calendario.eventos).toHaveLength(0);
      m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
      const c = m.turno(texto(MAMA, 'Ana Pérez Gómez'));
      expect(m.calendario.eventos).toHaveLength(1);
      expect(m.calendario.eventos[0]!['start']).toEqual({ dateTime: iso(MARTES, '11:30') });
      expect(c.enviados[0]!.cuerpo).toMatch(CONFIRMA);
    });

    for (const [dicho, hora] of [['11:30', '11:30'], ['a las 12:00', '12:00'], ['la primera que tengas', '11:00'], ['la segunda', '11:30'],
      ['la última', '12:00'], ['la primera', '11:00'], ['sí, la tercera', '12:00']] as const) {
      it(`«${dicho}» elige el botón de las ${hora} (sin el modelo) y NO vuelve a ofrecer`, () => {
        const m = mundo({ eventos: [] });
        conOferta(m);
        m.gemini.extraer = 'ERROR';
        const t = m.turno(texto(MAMA, dicho));
        expect(t.extraer).toHaveLength(0);
        expect(t.enviados).toHaveLength(1);
        expect(t.enviados[0]!.cuerpo).toMatch(/Cómo se llama el niño o la niña/);
        expect(idsDe(t)).toHaveLength(0);
        const estado = (m.sd['agendaMinima'] as J)[MAMA] as J;
        expect(estado['huecoElegido']).toBe(iso(MARTES, hora));
      });
    }

    it('«a las 11:30 y el paciente es Juan Pérez»: usa el nombre, no lo vuelve a pedir y crea la cita', () => {
      const m = mundo({ eventos: [] });
      conOferta(m);
      m.gemini.extraer = 'ERROR';
      const t = m.turno(texto(MAMA, 'a las 11:30 y el paciente es Juan Pérez'));
      expect(m.calendario.eventos).toHaveLength(1);
      expect(m.calendario.eventos[0]!['summary']).toBe('Pérez, Juan (CNS)');
      expect(m.calendario.eventos[0]!['start']).toEqual({ dateTime: iso(MARTES, '11:30') });
      expect(t.enviados[0]!.cuerpo).toMatch(CONFIRMA);
      expect(t.bitacora).toEqual(['crear:ev-1']);
    });

    it('el nombre puede ir ANTES de la hora: «el paciente es Juan Pérez a las 11:30»', () => {
      const m = mundo({ eventos: [] });
      conOferta(m);
      m.gemini.extraer = 'ERROR';
      const t = m.turno(texto(MAMA, 'el paciente es Juan Pérez a las 11:30'));
      expect(m.calendario.eventos[0]!['summary']).toBe('Pérez, Juan (CNS)');
      expect(m.calendario.eventos[0]!['start']).toEqual({ dateTime: iso(MARTES, '11:30') });
      expect(t.enviados[0]!.cuerpo).toMatch(CONFIRMA);
    });

    it('«el jueves a las 16:30» con el jueves ofrecido: elige ESE día y esa hora', () => {
      const { m, oferta } = ofertaDelJueves();
      expect(idsDe(oferta)).toEqual([idHueco(JUEVES, '16:00'), idHueco(JUEVES, '16:30'), idHueco(JUEVES, '17:00')]);
      m.gemini.extraer = 'ERROR';
      const t = m.turno(texto(MAMA, 'el jueves a las 16:30'));
      expect(t.enviados[0]!.cuerpo).toMatch(/Cómo se llama el niño o la niña/);
      expect(((m.sd['agendaMinima'] as J)[MAMA] as J)['huecoElegido']).toBe(iso(JUEVES, '16:30'));
    });

    it('«la de las 3» es la de las 15:00 (en la tarde), no la de las 03:00', () => {
      const m = mundo({ eventos: [] });
      m.turno(texto(MAMA, 'quiero cita el jueves'));
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES });
      const oferta = m.turno(lista(MAMA, SERV_CNS, 'Servicio'));
      expect(idsDe(oferta)).toContain(idHueco(JUEVES, '15:00'));
      m.gemini.extraer = 'ERROR';
      m.turno(texto(MAMA, 'la de las 3'));
      expect(((m.sd['agendaMinima'] as J)[MAMA] as J)['huecoElegido']).toBe(iso(JUEVES, '15:00'));
    });

    it('«esa», si se ofreció UNA sola hora, es esa hora; con varias, se pide tocar el botón', () => {
      const m = mundo({ eventos: [evento('bloqueo', JUEVES, '14:00', '17:30', 'Otro paciente')] });
      m.turno(texto(MAMA, 'quiero cita el jueves'));
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES });
      const oferta = m.turno(lista(MAMA, SERV_CNS, 'Servicio'));
      expect(idsDe(oferta)).toEqual([idHueco(JUEVES, '17:30')]);
      m.gemini.extraer = 'ERROR';
      const t = m.turno(texto(MAMA, 'esa'));
      expect(t.enviados[0]!.cuerpo).toMatch(/Cómo se llama el niño o la niña/);
      expect(((m.sd['agendaMinima'] as J)[MAMA] as J)['huecoElegido']).toBe(iso(JUEVES, '17:30'));
      // NIEGA: con tres horas ofrecidas, «esa» no dice cuál.
      const otro = mundo({ eventos: [] });
      conOferta(otro);
      otro.gemini.extraer = 'ERROR';
      const n = otro.turno(texto(MAMA, 'esa'));
      expect(n.enviados[0]!.cuerpo).toMatch(/toca uno de los horarios/);
      expect(((otro.sd['agendaMinima'] as J)[MAMA] as J)['huecoElegido']).toBeFalsy();
    });

    it('con el modelo: la extracción da horaPreferida y fechaPreferida de una frase que el código no entiende', () => {
      const { m } = ofertaDelJueves();
      m.gemini.extraer = extraccion({ fechaPreferida: JUEVES, horaPreferida: '16:30', pacientes: ['Juan Pérez'] });
      const t = m.turno(texto(MAMA, 'para el jueves a las cuatro y media, es para Juan Pérez por favor'));
      expect(m.calendario.eventos).toHaveLength(2);
      expect(m.calendario.eventos[1]!['start']).toEqual({ dateTime: iso(JUEVES, '16:30') });
      expect(t.enviados[0]!.cuerpo).toMatch(CONFIRMA);
    });

    it('reagendar: escribir la hora ofrecida crea la nueva y borra la vieja (el mismo camino del botón)', () => {
      const m = mundo({ eventos: [citaDe(MAMA, 'vieja', JUEVES, '14:00', '14:30', 'Pérez Gómez, Ana (CNS)')] });
      m.gemini.extraer = extraccion({ intencion: 'mover' });
      const oferta = m.turno(texto(MAMA, 'quiero mover mi cita'));
      expect(idsDe(oferta)).toEqual([idHueco(MARTES, '11:00'), idHueco(MARTES, '11:30'), idHueco(MARTES, '12:00')]);
      m.gemini.extraer = 'ERROR';
      const t = m.turno(texto(MAMA, 'a las 11:30'));
      expect(t.bitacora).toEqual(['crear:ev-1', 'borrar:vieja']);
      expect(m.calendario.eventos.map((e) => e['id'])).toEqual(['ev-1']);
      expect(t.enviados[0]!.cuerpo).toMatch(CONFIRMA);
    });

    it('NIEGA: una hora que NO se ofreció no agenda nada: se vuelve a ofrecer', () => {
      const m = mundo({ eventos: [] });
      conOferta(m);
      m.gemini.extraer = extraccion({ horaPreferida: '15:00' });
      const t = m.turno(texto(MAMA, 'a las 15:00'));
      expect(m.calendario.eventos).toHaveLength(0);
      expect(((m.sd['agendaMinima'] as J)[MAMA] as J)['huecoElegido']).toBeFalsy();
      expect(botonesDe(t.enviados[0]!)[0]!.id).toBe(idHueco(MARTES, '15:00'));
    });

    it('NIEGA: una hora ofrecida con un «no» («no puedo a las 11:30») NO la elige', () => {
      const m = mundo({ eventos: [] });
      conOferta(m);
      m.gemini.extraer = extraccion({ horaPreferida: '11:30', masOpciones: true });
      const t = m.turno(texto(MAMA, 'no puedo a las 11:30, tienes otra'));
      expect(m.calendario.eventos).toHaveLength(0);
      expect(((m.sd['agendaMinima'] as J)[MAMA] as J)['huecoElegido']).toBeFalsy();
      expect(t.enviados[0]!.cuerpo).not.toMatch(/Cómo se llama/);
    });

    it('NIEGA: el mismo día y hora en dos ofertas es ambiguo: se pide tocar el botón y no se crea nada', () => {
      const m = mundo({ eventos: [] });
      conOferta(m);
      ((m.sd['agendaMinima'] as J)[MAMA] as J)['ultimaOferta'] = [iso(MARTES, '11:30'), iso(MIERCOLES, '11:30'), iso(JUEVES, '14:00')];
      m.gemini.extraer = 'ERROR';
      const t = m.turno(texto(MAMA, 'a las 11:30'));
      expect(t.enviados[0]!.cuerpo).toMatch(/toca uno de los horarios/);
      expect(m.calendario.eventos).toHaveLength(0);
      // Con el día, deja de serlo.
      const d = m.turno(texto(MAMA, 'el miércoles a las 11:30'));
      expect(d.enviados[0]!.cuerpo).toMatch(/Cómo se llama el niño o la niña/);
      expect(((m.sd['agendaMinima'] as J)[MAMA] as J)['huecoElegido']).toBe(iso(MIERCOLES, '11:30'));
    });

    it('NIEGA: escribir la hora de un hueco que se ocupó entre tanto no lo crea (se revalida)', () => {
      const m = mundo({ eventos: [] });
      conOferta(m);
      m.calendario.eventos.push(evento('rival', MARTES, '11:30', '12:00', 'Otro paciente'));
      m.gemini.extraer = 'ERROR';
      const t = m.turno(texto(MAMA, 'a las 11:30 y el paciente es Juan Pérez'));
      expect(m.calendario.eventos).toHaveLength(1);
      expect(t.bitacora).toEqual([]);
      expect(t.enviados[0]!.cuerpo).toMatch(/ya no está disponible/);
    });

    it('NIEGA: un «sí», «ya» o «dale» sigue sin agendar (regla de oro)', () => {
      for (const dicho of ['sí', 'ya', 'dale', 'listo, sí']) {
        const m = mundo({ eventos: [] });
        conOferta(m);
        m.gemini.extraer = 'ERROR';
        const t = m.turno(texto(MAMA, dicho));
        expect(m.calendario.eventos).toHaveLength(0);
        expect(t.enviados[0]!.cuerpo).toMatch(/toca uno de los horarios/);
      }
    });
  });

  // ------------------------------------------------------------------------------------- HB3
  describe('HB3: cancelar o mover una cita existente gana sobre una oferta pendiente', () => {
    const CUANDO: [string, string, string][] = [
      ['hoy', '2026-10-05', '16:00'], ['dentro de una semana', '2026-10-12', '14:00'], ['dentro de un mes', '2026-11-05', '15:00'],
    ];
    for (const [cuando, fecha, hora] of CUANDO) {
      for (const previa of [false, true]) {
        for (const modelo of ['bien', 'agendar']) {
          const eleccion = (intencion: string): J => extraccion(modelo === 'bien' ? { intencion } : { intencion: 'agendar' });
          const fin = (hora.startsWith('16') ? '16:30' : (hora === '14:00' ? '14:30' : '15:30'));
          const cita = (): J => citaDe(MAMA, 'vieja', fecha, hora, fin, 'Pérez Gómez, Ana (CNS)');
          const sufijo = `cita ${cuando}, ${previa ? 'DESPUÉS de una oferta' : 'sin oferta previa'}, modelo ${modelo === 'bien' ? 'acierta' : 'lo toma por «agendar»'}`;

          it(`reagendar: ${sufijo} → ofrece horas para MOVER esa cita y al tocar una crea la nueva y borra la vieja`, () => {
            const m = mundo({ eventos: [cita()] });
            if (previa) conOferta(m);
            m.gemini.extraer = eleccion('mover');
            const t = m.turno(texto(MAMA, 'quiero reagendar mi cita'));
            expect(t.enviados).toHaveLength(1);
            expect(t.ejecutados.has('Leer agenda')).toBe(true);
            const ids = idsDe(t);
            expect(ids.length).toBeGreaterThan(0);
            expect(t.enviados[0]!.cuerpo).not.toMatch(/No encuentro ninguna cita/);
            const c = m.turno(boton(MAMA, ids[0]!));
            expect(c.bitacora).toEqual(['crear:ev-1', 'borrar:vieja']);
            expect(m.calendario.eventos.map((e) => e['id'])).toEqual(['ev-1']);
          });

          it(`cancelar: ${sufijo} → muestra la cita con su botón y al tocarlo la borra`, () => {
            const m = mundo({ eventos: [cita(), citaDe(OTRA, 'ajena', JUEVES, '15:00', '15:30', 'Rojas, Luis (CNS)')] });
            if (previa) conOferta(m);
            m.gemini.extraer = eleccion('cancelar');
            const t = m.turno(texto(MAMA, 'quiero cancelar mi cita'));
            expect(t.enviados).toHaveLength(1);
            expect(t.enviados[0]!.cuerpo).not.toMatch(/No encuentro ninguna cita/);
            expect(idsDe(t)).toEqual(['c|vieja']);
            expect(t.aRecepcion).toHaveLength(0);
            const c = m.turno(boton(MAMA, 'c|vieja'));
            expect(c.bitacora).toEqual(['borrar:vieja']);
            expect(c.enviados[0]!.cuerpo).toMatch(/cancelé tu cita/);
            expect(m.calendario.eventos.map((e) => e['id'])).toEqual(['ajena']);
          });
        }
      }
    }

    it('con DOS citas, «quiero reagendar» después de una oferta lista las dos con su botón de mover', () => {
      const m = mundo({ eventos: [citaDe(MAMA, 'a', '2026-10-12', '14:00', '14:30', 'Pérez Gómez, Ana (CNS)'), citaDe(MAMA, 'b', '2026-11-05', '15:00', '15:30', 'Pérez Gómez, Luis (CNS)')] });
      conOferta(m);
      m.gemini.extraer = extraccion({ intencion: 'agendar' });
      const t = m.turno(texto(MAMA, 'quiero reagendar mi cita'));
      expect(idsDe(t)).toEqual(['m|a', 'm|b']);
    });

    it('la lectura para buscar las citas cubre hasta anticipacionMaximaDias (una cita dentro de 59 días se encuentra)', () => {
      const m = mundo({ eventos: [citaDe(MAMA, 'lejana', '2026-12-03', '14:00', '14:30', 'Pérez Gómez, Ana (CNS)')] });
      conOferta(m);
      m.gemini.extraer = extraccion({ intencion: 'cancelar' });
      const t = m.turno(texto(MAMA, 'quiero cancelar mi cita'));
      expect(idsDe(t)).toEqual(['c|lejana']);
    });

    it('con el modelo CAÍDO, cancelar y reagendar tras una oferta siguen funcionando: la intención la fija el código', () => {
      const m = mundo({ eventos: [citaDe(MAMA, 'vieja', JUEVES, '14:00', '14:30', 'Pérez Gómez, Ana (CNS)')] });
      conOferta(m);
      m.gemini.extraer = 'ERROR';
      const c = m.turno(texto(MAMA, 'quiero cancelar mi cita'));
      expect(idsDe(c)).toEqual(['c|vieja']);
      const r = m.turno(texto(MAMA, 'mejor quiero reagendar mi cita'));
      expect(r.aRecepcion).toHaveLength(0);
      expect(idsDe(r).length).toBeGreaterThan(0);
    });

    it('NIEGA: sin cita a su teléfono, cancelar tras una oferta pasa con recepción y no borra nada', () => {
      const m = mundo({ eventos: [citaDe(OTRA, 'ajena', JUEVES, '15:00', '15:30', 'Rojas, Luis (CNS)')] });
      conOferta(m);
      m.gemini.extraer = extraccion({ intencion: 'cancelar' });
      const t = m.turno(texto(MAMA, 'quiero cancelar mi cita'));
      expect(t.enviados[0]!.cuerpo).toMatch(/No encuentro ninguna cita/);
      expect(t.aRecepcion).toHaveLength(1);
      expect(t.bitacora).toEqual([]);
    });

    it('NIEGA: «quiero otra hora» tras una oferta NO es cancelar ni mover: sigue la oferta', () => {
      const m = mundo({ eventos: [citaDe(MAMA, 'vieja', JUEVES, '14:00', '14:30', 'Pérez Gómez, Ana (CNS)')] });
      conOferta(m);
      m.gemini.extraer = extraccion({ masOpciones: true });
      const t = m.turno(texto(MAMA, 'quiero cambiar la hora por favor'));
      expect(t.enviados[0]!.cuerpo).not.toMatch(/No encuentro ninguna cita/);
      expect(idsDe(t).every((id) => id.startsWith('h|'))).toBe(true);
    });
  });

  // ------------------------------------------------------------------------------------- HB4
  describe('HB4: tres rechazos seguidos pasan con recepción', () => {
    const rechazar = (m: ReturnType<typeof mundo>, dicho: string, ext: J = { masOpciones: true }): Turno => {
      m.gemini.extraer = extraccion(ext);
      return m.turno(texto(MAMA, dicho));
    };
    it('«ninguno me sirve», «ninguno, dame otros» y «tampoco me sirven»: las dos primeras ofrecen, la tercera transfiere (aviso más botón)', () => {
      const m = mundo({ eventos: [] });
      conOferta(m);
      const a = rechazar(m, 'ninguno me sirve');
      const b = rechazar(m, 'ninguno, dame otros');
      expect(idsDe(a)).toHaveLength(3);
      expect(idsDe(b)).toHaveLength(3);
      expect(a.aRecepcion).toHaveLength(0);
      expect(b.aRecepcion).toHaveLength(0);
      const c = rechazar(m, 'tampoco me sirven');
      expect(c.aRecepcion).toHaveLength(1);
      expect(c.aRecepcion[0]!.cuerpo).toMatch(/necesita atención humana/);
      expect(c.aPaciente(MAMA)).toHaveLength(1);
      expect(urlDe(c.aPaciente(MAMA)[0]!)).toContain(REC);
      expect(idsDe(c)).toHaveLength(0);
      expect(m.calendario.eventos).toHaveLength(0);
      expect(c.resumen!['resumen']).toMatchObject({ ruta: 'transferir' });
    });
    it('aunque el modelo no marque «masOpciones», las tres frases de rechazo cuentan (lo decide el código)', () => {
      const m = mundo({ eventos: [] });
      conOferta(m);
      rechazar(m, 'ninguno me sirve', {});
      rechazar(m, 'ninguno, dame otros', { intencion: 'otro' });
      const c = rechazar(m, 'tampoco me sirven', {});
      expect(c.aRecepcion).toHaveLength(1);
    });
    it('NIEGA: dos rechazos no transfieren, y un cambio de tema (pedir un día) reinicia la cuenta', () => {
      const m = mundo({ eventos: [] });
      conOferta(m);
      rechazar(m, 'ninguno me sirve');
      rechazar(m, 'ninguno, dame otros');
      const d = rechazar(m, 'mejor el viernes en la tarde', { fechaPreferida: VIERNES, franja: 'tarde' });
      expect(idsDe(d).length).toBeGreaterThan(0);
      const e = rechazar(m, 'ninguno me sirve');
      const f = rechazar(m, 'tampoco me sirven');
      expect(e.aRecepcion).toHaveLength(0);
      expect(f.aRecepcion).toHaveLength(0);
      expect(idsDe(f).length).toBeGreaterThan(0);
      // El tercero desde el cambio de tema sí transfiere.
      const g = rechazar(m, 'ninguno de esos');
      expect(g.aRecepcion).toHaveLength(1);
    });
    it('NIEGA: un rechazo con una preferencia nueva («ninguno, mejor el viernes a las 4») no cuenta como rechazo vacío', () => {
      const m = mundo({ eventos: [] });
      conOferta(m);
      for (let i = 0; i < 4; i++) {
        const t = rechazar(m, 'ninguno me sirve, mejor el viernes', { fechaPreferida: VIERNES });
        expect(t.aRecepcion).toHaveLength(0);
      }
    });
    it('NIEGA: tocar un botón (elegir) reinicia la cuenta: después de elegir, hacen falta otros tres', () => {
      const m = mundo({ eventos: [] });
      const oferta = conOferta(m);
      rechazar(m, 'ninguno me sirve');
      rechazar(m, 'ninguno, dame otros');
      m.turno(boton(MAMA, idsDe(oferta)[0]!)); // elige: pide el nombre
      expect(((m.sd['agendaMinima'] as J)[MAMA] as J)['rechazos'] ?? 0).toBe(0);
    });
  });
});

// =================================================================================================
// Ronda 2 de la revisora, lo que corrigió la sesión coordinadora en «Armar mensajes»: HB1 (el recorte
// del saludo quita oraciones completas; «Dr.» no cierra oración), el aviso de HB3 al mover (el paciente
// ve su cita actual) y la disculpa de HB4.
describe('Agenda mínima v0: ronda 2, lo de «Armar mensajes»', () => {
  const conOferta = (m: ReturnType<typeof mundo>): Turno => { m.turno(texto(MAMA, 'hola')); return m.turno(lista(MAMA, SERV_CNS, 'Servicio')); };
  const ofertaCon = (redaccion: string): Turno => {
    const m = mundo({ eventos: [] });
    m.gemini.redactar = redaccion;
    return conOferta(m);
  };
  it('HB1: «¡Hola! Soy la asistente virtual del Dr. … y estoy aquí…» se quita ENTERO, sin dejar un trozo', () => {
    const t = ofertaCon('¡Hola! Soy la asistente virtual del Dr. Consultorio Ejemplo y estoy aquí para ayudarte a cuidar lo más valioso. Puedes elegir tu cita tocando uno de los horarios.');
    expect(t.enviados[0]!.cuerpo).toBe('Puedes elegir tu cita tocando uno de los horarios.');
  });
  it('HB1: «Soy una asistente virtual y estoy aquí…» también se quita', () => {
    const t = ofertaCon('Soy una asistente virtual y estoy aquí para ayudarte. Tengo estos horarios; toca el que prefieras.');
    expect(t.enviados[0]!.cuerpo).toBe('Tengo estos horarios; toca el que prefieras.');
  });
  it('HB1 NIEGA: «Dr.» en medio de una oración útil no la corta', () => {
    const t = ofertaCon('El Dr. Ejemplo atiende estos horarios; toca el que prefieras.');
    expect(t.enviados[0]!.cuerpo).toBe('El Dr. Ejemplo atiende estos horarios; toca el que prefieras.');
  });
  it('HB3: al mover, el mensaje nombra la cita actual y dice que no se pierde hasta confirmar la nueva', () => {
    const m = mundo({ eventos: [citaDe(MAMA, 'vieja', JUEVES, '15:00', '15:30', 'Pérez Gómez, Ana (CNS)')] });
    m.gemini.extraer = extraccion({ intencion: 'mover' });
    m.gemini.redactar = 'Tengo estos horarios; toca el que prefieras.';
    const t = m.turno(texto(MAMA, 'quiero reagendar mi cita'));
    expect(t.enviados).toHaveLength(1);
    expect(t.enviados[0]!.cuerpo).toMatch(/^Tu cita actual es el .*15:00/);
    expect(t.enviados[0]!.cuerpo).toMatch(/la actual se mantiene hasta que la nueva quede confirmada/);
    expect(t.enviados[0]!.cuerpo.length).toBeLessThanOrEqual(1024);
  });
  it('HB3 NIEGA: una oferta para una cita NUEVA no habla de «tu cita actual»', () => {
    const t = ofertaCon('Tengo estos horarios; toca el que prefieras.');
    expect(t.enviados[0]!.cuerpo).not.toMatch(/cita actual/);
  });
  it('HB4: al tercer rechazo, el paciente recibe una disculpa con el botón a recepción', () => {
    const m = mundo({ eventos: [] });
    conOferta(m);
    for (const dicho of ['ninguno me sirve', 'ninguno, dame otros']) { m.gemini.extraer = extraccion({ masOpciones: true }); m.turno(texto(MAMA, dicho)); }
    m.gemini.extraer = extraccion({ masOpciones: true });
    const c = m.turno(texto(MAMA, 'tampoco me sirven'));
    expect(c.aPaciente(MAMA)[0]!.cuerpo).toMatch(/^Disculpa que ninguno de los horarios te sirva/);
    expect(c.aRecepcion).toHaveLength(1);
  });
});

// =================================================================================================
// Revisión de seguridad del flujo: (1) una regex de costo cuadrático sobre el texto del paciente
// dejaba 10 a 15 s por mensaje con 80.000 espacios, (2) una PREGUNTA por una hora ofrecida agendaba
// (o movía la cita sin tocar el botón), (3) el nombre de perfil entra limpio.
// =================================================================================================
describe('Agenda mínima v0: revisión de seguridad (texto hostil y preguntas)', () => {
  const MARTES = '2026-10-06'; // la oferta «desde mañana»: martes 11:00, 11:30 y 12:00
  const conOferta = (m: ReturnType<typeof mundo>): Turno => {
    m.turno(texto(MAMA, 'hola'));
    return m.turno(lista(MAMA, SERV_CNS, 'Servicio'));
  };
  const idsDe = (t: Turno): string[] => (t.enviados.length && t.enviados[0]!.tipo === 'interactive' && interactivo(t.enviados[0]!)['type'] === 'button' ? botonesDe(t.enviados[0]!).map((b) => b.id) : []);
  const estadoDe = (m: ReturnType<typeof mundo>): J => (m.sd['agendaMinima'] as J)[MAMA] as J;

  // ------------------------------------------------------------------------------ (1) el costo
  describe('un texto de 80.000 caracteres se procesa en milisegundos, de punta a punta', () => {
    const ESP = ' '.repeat(80_000);
    const hostiles: [string, string][] = [
      ['80.000 espacios', ESP],
      ['«hola» y 80.000 espacios', `hola${ESP}`],
      ['espacios y un carácter final', `${ESP}x`],
      ['«el paciente es Ana Pérez» + espacios + gracias', `el paciente es Ana Pérez${ESP}gracias`],
      ['«el paciente es» + espacios + hora', `a las 11:30 y el paciente es Ana Pérez${ESP}a las 11:30`],
      ['nombre, espacios y puntuación', `el paciente es Ana Pérez${ESP}.!?,;${ESP}x`],
      ['un dígito y espacios sueltos', `el paciente es Ana Pérez ${'1 '.repeat(40_000)}`],
      ['tabulaciones y saltos', `a las 11:30\t\n\r ${'\t\n '.repeat(27_000)}x`],
      ['espacios Unicode', `la primera${'   '.repeat(27_000)}x`],
    ];
    for (const [nombre, dicho] of hostiles) {
      it(`${nombre}: el turno entero (los tres nodos de decisión incluidos) tarda menos de 300 ms y no rompe nada`, () => {
        expect(dicho.length).toBeGreaterThanOrEqual(80_000);
        const m = mundo({ eventos: [] });
        conOferta(m);
        m.gemini.extraer = extraccion({});
        const desde = performance.now();
        const t = m.turno(texto(MAMA, dicho));
        const ms = performance.now() - desde;
        expect(ms).toBeLessThan(300);
        expect(t.ejecutados.has('Interpretar entrada')).toBe(true);
        expect(t.ejecutados.has('Decidir turno')).toBe(true);
        expect(t.ejecutados.has('Plan del turno')).toBe(true);
        // Y al modelo nunca llega el texto entero: se recortó en el borde.
        for (const e of t.extraer) expect(JSON.stringify(e).length).toBeLessThan(20_000);
      });
    }
    it('el mismo texto en el primer mensaje (paso «inicio») también tarda menos de 300 ms', () => {
      const m = mundo({ eventos: [] });
      const desde = performance.now();
      m.turno(texto(MAMA, `quiero una cita${ESP}x`));
      expect(performance.now() - desde).toBeLessThan(300);
    });
    it('NIEGA: un texto normal sigue intacto (el recorte es de 1.500, no de 15)', () => {
      const m = mundo({ eventos: [] });
      conOferta(m);
      m.gemini.extraer = 'ERROR';
      m.turno(texto(MAMA, 'a las 11:30 y el paciente es Juan Pérez'));
      expect(m.calendario.eventos).toHaveLength(1);
      expect(m.calendario.eventos[0]!['summary']).toBe('Pérez, Juan (CNS)');
    });
  });

  // ------------------------------------------------------------------------------ (2) preguntas
  describe('una PREGUNTA por una hora ofrecida no agenda ni mueve', () => {
    const preguntas: [string, string][] = [
      ['¿tienes a las 9:30?', '09:30'],
      ['¿tienes a las 11:30?', '11:30'],
      ['¿a las 11:30 hay?', '11:30'],
      ['¿y a las 12 se puede?', '12:00'],
      ['a las 11 está libre?', '11:00'],
      ['a las 12:00 hay lugar', '12:00'],
      ['a las 11:30 esta disponible', '11:30'],
    ];
    for (const [dicho, hora] of preguntas) {
      it(`«${dicho}» no crea ni borra nada: se contesta con la disponibilidad y los botones`, () => {
        const m = mundo({ eventos: [] });
        conOferta(m);
        m.gemini.extraer = extraccion({ horaPreferida: hora });
        const t = m.turno(texto(MAMA, dicho));
        expect(t.extraer).toHaveLength(1); // fue al modelo: el código NO la tomó por una elección
        expect(m.calendario.eventos).toHaveLength(0);
        expect(t.bitacora).toEqual([]);
        expect(estadoDe(m)['huecoElegido']).toBeFalsy();
        expect(t.enviados).toHaveLength(1);
        expect(t.enviados[0]!.cuerpo).not.toMatch(CONFIRMA);
        expect(t.enviados[0]!.cuerpo).not.toMatch(/Cómo se llama el niño o la niña/);
      });
    }
    it('MOVER: «¿tienes a las 11:30?» con una cita existente y moverId NO mueve la cita (ni crea ni borra)', () => {
      const m = mundo({ eventos: [citaDe(MAMA, 'vieja', JUEVES, '14:00', '14:30', 'Pérez Gómez, Ana (CNS)')] });
      m.gemini.extraer = extraccion({ intencion: 'mover' });
      const oferta = m.turno(texto(MAMA, 'quiero mover mi cita'));
      expect(idsDe(oferta)).toEqual([idHueco(MARTES, '11:00'), idHueco(MARTES, '11:30'), idHueco(MARTES, '12:00')]);
      expect(estadoDe(m)['moverId']).toBe('vieja');
      for (const dicho of ['¿tienes a las 11:30?', 'a las 11 está libre?', '¿y a las 12 se puede?']) {
        m.gemini.extraer = extraccion({ horaPreferida: dicho.includes('12') ? '12:00' : (dicho.includes('11:30') ? '11:30' : '11:00') });
        const t = m.turno(texto(MAMA, dicho));
        expect(t.bitacora, dicho).toEqual([]);
        expect(m.calendario.eventos.map((e) => e['id']), dicho).toEqual(['vieja']);
        expect(t.enviados[0]!.cuerpo, dicho).not.toMatch(CONFIRMA);
      }
    });
    it('POSITIVO: «a las 11:30» sin pregunta sigue agendando (el mismo camino del botón)', () => {
      const m = mundo({ eventos: [] });
      conOferta(m);
      m.gemini.extraer = 'ERROR';
      const t = m.turno(texto(MAMA, 'a las 11:30'));
      expect(t.extraer).toHaveLength(0);
      expect(estadoDe(m)['huecoElegido']).toBe(iso(MARTES, '11:30'));
    });
    it('POSITIVO en el plan (con el modelo): «mejor a las once y media» elige; la misma frase en pregunta no', () => {
      const m = mundo({ eventos: [] });
      conOferta(m);
      m.gemini.extraer = extraccion({ horaPreferida: '11:30' });
      m.turno(texto(MAMA, 'mejor a las once y media'));
      expect(estadoDe(m)['huecoElegido']).toBe(iso(MARTES, '11:30'));
      const q = mundo({ eventos: [] });
      conOferta(q);
      q.gemini.extraer = extraccion({ horaPreferida: '11:30' });
      const t = q.turno(texto(MAMA, '¿mejor a las once y media?'));
      expect(estadoDe(q)['huecoElegido']).toBeFalsy();
      expect(q.calendario.eventos).toHaveLength(0);
      expect(t.enviados[0]!.cuerpo).not.toMatch(/Cómo se llama el niño o la niña/);
    });
    it('NIEGA (plan): «mejor a las once y media, ¿tienes?» no elige aunque el modelo entienda la hora', () => {
      const m = mundo({ eventos: [] });
      conOferta(m);
      m.gemini.extraer = extraccion({ horaPreferida: '11:30' });
      m.turno(texto(MAMA, 'mejor a las once y media, hay?'));
      expect(estadoDe(m)['huecoElegido']).toBeFalsy();
      expect(m.calendario.eventos).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------------------ (3) el perfil
  describe('el nombre de perfil entra limpio', () => {
    const conPerfil = (nombre: string): J => {
      const v = texto(MAMA, 'hola');
      (v['contacts'] as J[])[0]!['profile']['name'] = nombre;
      return v;
    };
    it('sin <, >, &, saltos de línea ni controles, y de 60 caracteres como máximo', () => {
      const m = mundo({ eventos: [] });
      m.turno(conPerfil(`Ana<br>Telefono: ${OTRA} & <b>x</b>\nlinea\r\n${'z'.repeat(200)}`));
      const cliente = m.log.ingesta.map((i) => JSON.stringify(i)).join('');
      expect(cliente).not.toMatch(/<br>|<b>|<\/b>/);
      // La cita que crea el flujo lleva el nombre ya limpio y una sola línea «Telefono:».
      conOferta(m);
      m.gemini.extraer = 'ERROR';
      m.turno(texto(MAMA, 'a las 11:30 y el paciente es Juan Pérez'));
      const d = String(m.calendario.eventos[0]!['description']);
      expect(d.split('\n').filter((l) => /^Telefono:/.test(l))).toEqual([`Telefono: ${MAMA}`]);
      expect(d).not.toMatch(/[<>&]/);
      expect((d.split('\n')[0] ?? '').length).toBeLessThanOrEqual('Cliente: '.length + 60);
    });
    it('NIEGA: un nombre de perfil normal («Mamá de Ana») no se altera', () => {
      const m = mundo({ eventos: [] });
      conOferta(m);
      m.gemini.extraer = 'ERROR';
      m.turno(texto(MAMA, 'a las 11:30 y el paciente es Juan Pérez'));
      expect(String(m.calendario.eventos[0]!['description']).split('\n')[0]).toBe('Cliente: Mamá de Ana');
    });
  });
});

// =================================================================================================
// Revisión de seguridad del candidato B, lo de la sesión coordinadora («Armar mensajes»).
describe('Agenda mínima v0: revisión de seguridad, «Armar mensajes»', () => {
  const ofertaCon = (redaccion: string, op: Opciones = {}): Turno => {
    const m = mundo(Object.assign({ eventos: [] }, op));
    m.gemini.redactar = redaccion;
    m.turno(texto(MAMA, 'hola'));
    return m.turno(lista(MAMA, SERV_CNS, 'Servicio'));
  };
  for (const falso of ['Listo, tu cita quedó agendada para el martes.', 'Ya te reservé el martes a las 11:00.',
    'Te confirmo tu cita del martes.', 'No soy una IA, soy una persona del consultorio.']) {
    it(`la redacción que afirma algo que no existe se descarta: «${falso}»`, () => {
      const t = ofertaCon(falso);
      expect(t.enviados[0]!.cuerpo).not.toBe(falso);
      expect(textos(t)).not.toMatch(/quedó agendada|reservé|confirmo tu cita|no soy una ia/i);
    });
  }
  it('NIEGA: una redacción normal pasa', () => {
    const t = ofertaCon('Tengo estos horarios; toca el que prefieras.');
    expect(t.enviados[0]!.cuerpo).toBe('Tengo estos horarios; toca el que prefieras.');
  });
  it('emergencia SIN número del doctor: no dice «ya le avisé al doctor» y avisa a recepción marcado EMERGENCIA', () => {
    const panel = JSON.parse(JSON.stringify(PANEL)) as J;
    delete ((panel['operacion'] as J)['numeroDoctor']);
    const m = mundo({ eventos: [], panel });
    const t = m.turno(texto(MAMA, 'emergencia'));
    expect(textos(t)).not.toMatch(/avis[eé] al doctor/i);
    expect(t.aDoctor).toHaveLength(0);
    expect(t.aRecepcion.map((e) => e.cuerpo).join(' ')).toMatch(/EMERGENCIA/);
    expect(textos(t)).not.toMatch(/\b168\b/);
  });
  it('NIEGA: con número del doctor, el aviso sale y el texto lo dice', () => {
    const t = mundo({ eventos: [] }).turno(texto(MAMA, 'emergencia'));
    expect(t.aDoctor.length).toBeGreaterThan(0);
    expect(textos(t)).toMatch(/avis[eé] al doctor/i);
  });
  it('deshacer con 404 de Google cuenta como ya borrado: no se avisa a recepción de dos eventos', () => {
    const m = mundo({ eventos: [] });
    hastaPedirNombre(m);
    m.calendario.despuesDeCrear = (c) => { c.push(evento('rival-1', JUEVES, '14:00', '14:30', 'Otro paciente')); };
    m.calendario.fallas.deshacer = '404';
    m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
    const t = m.turno(texto(MAMA, 'Ana Pérez Gómez'));
    expect(t.aRecepcion.map((e) => e.cuerpo).join(' ')).not.toMatch(/no se pudo borrar del calendario/);
  });
  it('deshacer que falla SIN número de recepción: el aviso va al doctor', () => {
    const panel = JSON.parse(JSON.stringify(PANEL)) as J;
    delete ((panel['operacion'] as J)['numeroRecepcion']);
    const m = mundo({ eventos: [], panel, configBase: { respaldoNumeroRecepcion: '' } });
    hastaPedirNombre(m);
    m.calendario.despuesDeCrear = (c) => { c.push(evento('rival-1', JUEVES, '14:00', '14:30', 'Otro paciente')); };
    m.calendario.fallas.deshacer = true;
    m.gemini.extraer = extraccion({ pacientes: ['Ana Pérez Gómez'] });
    const t = m.turno(texto(MAMA, 'Ana Pérez Gómez'));
    expect(t.aDoctor.map((e) => e.cuerpo).join(' ')).toMatch(/no se pudo borrar del calendario/);
  });
});
