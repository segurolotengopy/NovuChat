/**
 * EL MUNDO DE PRUEBA del flujo nuevo de la Dra. Emma (tenant rroca-emma). Módulo compartido por las suites de esta carpeta (no es una suite: vitest solo corre `*.test.ts`).
 * Corre los JSON VERSIONADOS con el n8n de mentira (`../../lib/n8n-de-mentira`): la red (verificador, consola, ingesta, Graph, Gemini) son dobles; el código de los nodos es el real.
 * Reloj: lunes 05/10/2026, 10:00 en La Paz. Los teléfonos y los ids de medio se ARMAN con `join` (ningún literal de 10 dígitos o más en el repositorio).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Flujo, J } from '../../lib/flujo';
import { crearMundo, type Doble, type LlamadaDoble, type Mundo, type ResultadoTurno } from '../../lib/n8n-de-mentira';
import { doblesDelGuardado } from '../../lib/doble-guardado';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const CARPETA = join(AQUI, '../../../../Flujos/experimental/rroca-emma');
export const CARPETA_DE_DATOS = join(AQUI, '../../../scripts/datos/rroca-emma');
export const leerFlujo = (a: string): Flujo => JSON.parse(readFileSync(join(CARPETA, a), 'utf8')) as Flujo;
export const PRODUCCION = leerFlujo('rroca-emma.json');
export const PRUEBA = leerFlujo('rroca-emma.prueba.json');
export const datos = (): J => JSON.parse(readFileSync(join(CARPETA_DE_DATOS, 'rroca-emma.json'), 'utf8')) as J;
export const negocio = (): J => (JSON.parse(readFileSync(join(CARPETA_DE_DATOS, 'negocio-rroca-emma.json'), 'utf8')) as J)['negocio'] as J;

/** Un teléfono ficticio de 11 dígitos armado en la ejecución. */
export const tel = (n: number): string => ['591', '7', '00', String(n).padStart(5, '0')].join('');
export const PID = tel(42);        // phone_number_id del número del negocio
export const ANA = tel(11);
export const BETO = tel(22);
export const REC = tel(31);        // recepción: el WhatsApp de la clínica
export const AJENO = tel(99);
export const EXTRANJERO = ['54', '9', '11', '55500001'].join('');
/** Los ids de medio de las dos imágenes ACTIVAS de Emma (bata = autoridad, y antes y después), ya subidos a Meta (ficticios). La comparativa no existe: sin id, inactiva. */
export const IDS = { antes_despues: ['1234', '5678', '02'].join(''), autoridad: ['1234', '5678', '03'].join('') };
export const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);
export const SUSPENDIDO = 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.';

// ------------------------------------------------------------------------------ mensajes entrantes
let seq = 0;
export const valorMeta = (msg: J, from: string, op: { wamid?: string; phoneId?: string; nombre?: string } = {}): J => ({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: tel(1), phone_number_id: op.phoneId ?? PID },
  contacts: [{ profile: { name: op.nombre ?? 'Ana Pérez' }, wa_id: from }],
  messages: [{ from, id: op.wamid ?? `wamid.IN${++seq}`, timestamp: '1', ...msg }],
});
export const entrega = (valor: J, id?: string): J => ({
  headers: { 'x-aab1-signature': 'v1=abc', 'x-aab1-timestamp': '1', 'x-aab1-delivery-id': id ?? `entrega-${++seq}`, 'x-aab1-attempt': '1' },
  body: { field: 'messages', value: valor },
});
export const mTexto = (body: string): J => ({ type: 'text', text: { body } });
export const mImagen = (op: J = {}): J => ({ type: 'image', image: { id: 'media-img', mime_type: 'image/jpeg', caption: '', ...op } });
export const mAudio = (op: J = {}): J => ({ type: 'audio', audio: { id: 'media-aud', mime_type: 'audio/ogg; codecs=opus', voice: true, ...op } });
export const mDocumento = (op: J = {}): J => ({ type: 'document', document: { id: 'media-doc', mime_type: 'application/pdf', filename: 'doc.pdf', ...op } });
export const mSticker = (): J => ({ type: 'sticker', sticker: { id: 'media-stk', mime_type: 'image/webp' } });

// ------------------------------------------------------------------------------ el mundo
export type ModoEnvio = 'acepta' | 'error' | 'lanza';
export interface Opciones {
  flujo?: Flujo;
  /** Lo que contesta la ingesta al entrante (puede traer `atencion`). */
  ingesta?: J;
  /** La consola: un código y un cuerpo, o 'cae'. */
  panel?: { statusCode: number; body: J } | 'cae';
  /** Cómo contesta Meta: por nodo de envío. */
  envio?: Partial<Record<'Enviar a WhatsApp' | 'Enviar respaldo', ModoEnvio>>;
  /** Cómo contesta Meta a cada previo (imagen o aviso): un modo para todos, o una función por llamada. */
  previos?: ModoEnvio | ((ll: LlamadaDoble) => ModoEnvio);
  verificador?: (ll: LlamadaDoble) => J;
  /** El valor de «Config base»: cualquier clave (recepción, teléfonos de prueba, etapaPrueba, usarMarcas, ids de las imágenes, plantilla…). */
  base?: Record<string, unknown>;
  /** Lo que escribe el modelo: un texto, null (sin texto), 'cae' (error de servicio) o una función por llamada. */
  modeloDice?: string | null | 'cae' | ((ll: LlamadaDoble) => string);
  /** Lo que devuelven los medios. */
  medio?: { bytes?: number; url?: string; mime?: string; transcripcion?: string | null; vision?: J | null };
}
/** El horario de Emma como texto libre de la Consola (`operacion.horarioAtencion`): turno partido, que `negocio.horarios` (un rango por día) no admite. */
export const HORARIO_DE_LA_CONSOLA = 'lunes a viernes de 09:00 a 12:00 y de 14:00 a 18:00; sábados de 09:00 a 12:00; domingos cerrado';
/** La consola de Emma, como la devuelve la ingesta: dirección, horario (texto libre), nombre y recepción. */
export const panelOk = (extra: J = {}): { statusCode: number; body: J } => {
  const n = negocio();
  return {
    statusCode: 200,
    body: {
      tenantId: 'rroca-emma', estadoComercio: 'activo', datosDelNegocio: { nombreNegocio: n['nombreNegocio'], direccion: n['direccion'] },
      operacion: { numeroRecepcion: REC, prefijosPermitidos: ['591'], horarioAtencion: HORARIO_DE_LA_CONSOLA }, atencion: { estado: 'normal' },
      ...extra,
    },
  };
};
export function crear(o: Opciones = {}): Mundo {
  const envio = o.envio ?? {};
  const m = o.medio ?? {};
  let nEnvios = 0;
  const enviar = (nodo: 'Enviar a WhatsApp' | 'Enviar respaldo'): Doble => (ll: LlamadaDoble) => {
    const modo = envio[nodo] ?? 'acepta';
    if (modo === 'lanza') throw new Error('fetch failed: red caída');
    if (modo === 'error') return { error: { message: '(#131053) Media upload error', code: 131053 } };
    return { messaging_product: 'whatsapp', messages: [{ id: `wamid.OUT${nodo.replace(/\W+/g, '')}${++nEnvios}${ll.n}` }] };
  };
  const gemini = (t: string): J => ({ content: { parts: [{ text: t }] } });
  const dobles: Record<string, Doble> = {
    // La rama común del GUARDADO de medios: el doble del servidor responde «guardado_apagado» (la bandera por defecto), sin mensajes de más.
    ...doblesDelGuardado().dobles,
    'Verificar firma con el receptor': o.verificador ?? ((ll) => ({ valido: true, deliveryId: ll.cuerpo?.['deliveryId'] })),
    'Traer configuración': () => (o.panel === 'cae' ? { statusCode: 503, body: {} } : (o.panel ?? panelOk())),
    'Reportar mensaje (entrante)': () => o.ingesta ?? { ok: true },
    'Reportar mensaje (saliente)': () => ({ ok: true }),
    'Obtener URL del medio (general)': () => ({ id: 'm', url: m.url ?? 'https://lookaside.fbsbx.com/whatsapp_business/attachments/medio-1', mime_type: m.mime ?? 'image/jpeg', file_size: m.bytes ?? 100_000 }),
    'Descargar medio': () => ({ descargado: true }),
    'Conversar con el modelo': (ll) => {
      const d = o.modeloDice === undefined ? 'Hola, cuéntame qué te gustaría mejorar en tu rostro.' : o.modeloDice;
      if (d === 'cae') return { error: { message: 'servicio no disponible', code: 503 } };
      if (d === null) return {};
      return gemini(typeof d === 'function' ? d(ll) : d);
    },
    'Enviar aviso': (ll) => {
      const modo = typeof o.previos === 'function' ? o.previos(ll) : (o.previos ?? 'acepta');
      if (modo === 'lanza') throw new Error('fetch failed: red caída');
      if (modo === 'error') return { error: { message: '(#131053) Media upload error', code: 131053 } };
      return { messaging_product: 'whatsapp', messages: [{ id: `wamid.PREV${ll.n}` }] };
    },
    'Transcribir audio': () => (m.transcripcion === null ? { error: { message: 'sin transcripción' } } : gemini(m.transcripcion ?? 'hola, quiero información')),
    'Ver imagen': () => (m.vision === null ? { error: { message: 'no se pudo ver' } } : gemini(JSON.stringify(m.vision ?? { tipo: 'otra', texto: '', descripcion: 'una foto cualquiera' }))),
    'Enviar a WhatsApp': enviar('Enviar a WhatsApp'),
    'Enviar respaldo': enviar('Enviar respaldo'),
  };
  return crearMundo({
    flujo: o.flujo ?? PRODUCCION,
    dobles,
    roles: { ingesta: ['Reportar mensaje (entrante)', 'Reportar mensaje (saliente)'], avisos: ['Enviar aviso'] },
    ahoraMs: AHORA,
    configBase: {
      phoneNumberIdEsperado: PID, numeroRecepcion: REC, telefonosDePrueba: `${ANA},${BETO}`, etapaPrueba: '', usarMarcas: 'si',
      arteAntesDespuesMediaId: IDS.antes_despues, arteAutoridadMediaId: IDS.autoridad,
      ...(o.base ?? {}),
    },
  });
}
export const hablar = (mu: Mundo, from: string, msg: J, op: { wamid?: string; entrega?: string; phoneId?: string; nombre?: string; toleraFallo?: boolean } = {}): ResultadoTurno =>
  mu.turno(entrega(valorMeta(msg, from, op), op.entrega), op.toleraFallo ? { tolerarFallo: true } : {});
/** Habla con el flujo YA EN CONVERSACIÓN: primero un «hola» (el primer contacto sin nombre no cierra, ni siquiera con la etiqueta del modelo) y devuelve el turno siguiente. */
export const hablarYa = (mu: Mundo, from: string, msg: J, op: { wamid?: string; entrega?: string; phoneId?: string; nombre?: string; toleraFallo?: boolean } = {}): ResultadoTurno => {
  hablar(mu, from, mTexto('hola'), { toleraFallo: true });
  return hablar(mu, from, msg, op);
};
export const textos = (t: ResultadoTurno): string[] => t.mensajes.map((e) => e.cuerpo);
/** Las imágenes que salieron como previos, por el id de medio de cada una. */
export const imagenes = (t: ResultadoTurno): string[] => t.avisos.filter((a) => a.tipo === 'image').map((a) => String(((a.payload['image'] ?? {}) as J)['id']));
/** Los avisos a la recepción (no imágenes). */
export const avisosARecepcion = (t: ResultadoTurno): ResultadoTurno['avisos'] => t.avisos.filter((a) => a.tipo !== 'image');
/** Un modelo que dice lo mismo siempre. */
export const dice = (t: string): ((ll: LlamadaDoble) => string) => () => t;
/**
 * Observaciones de Rubén (28/10/2026): antes del cierre el CÓDIGO pregunta qué día y horario le quedan mejor (con el nombre si falta). Si el turno es esa pregunta, la persona contesta `PREFERENCIA`
 * (y, si solo se le pidió el nombre y el día y contestó el nombre, el día en el turno siguiente) y se devuelve el turno del cierre. Si el turno no es la pregunta, se devuelve tal cual.
 */
export const PREFERENCIA = 'el martes en la tarde';
export const esPreguntaDePreferencia = (t: ResultadoTurno): boolean => textos(t).some((x) => /qué día y horario te (?:quedan mejor|acomodan más)/i.test(x));
export const conPreferencia = (mu: Mundo, from: string, t: ResultadoTurno, op: { wamid?: string; entrega?: string; phoneId?: string; nombre?: string; toleraFallo?: boolean } = {}): ResultadoTurno =>
  (esPreguntaDePreferencia(t) ? hablar(mu, from, mTexto(PREFERENCIA), op) : t);
