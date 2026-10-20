/**
 * EL MUNDO DE PRUEBA de «El Puente» de Antonio (tenant rroca-antonio). Módulo compartido por `flujo.test.ts` y `medios.test.ts` (no es una suite: vitest solo corre `*.test.ts`).
 * Corre los JSON VERSIONADOS con el n8n de mentira (`../../lib/n8n-de-mentira`): la red (verificador, consola, ingesta, Graph, Gemini) son dobles; el código de los nodos es el real.
 * Reloj: lunes 05/10/2026, 10:00 en La Paz. Teléfonos ficticios con seis ceros.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Flujo, J } from '../../lib/flujo';
import { crearMundo, type Doble, type LlamadaDoble, type Mundo, type ResultadoTurno } from '../../lib/n8n-de-mentira';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const CARPETA = join(AQUI, '../../../../Flujos/experimental/rroca-antonio');
export const leerFlujo = (a: string): Flujo => JSON.parse(readFileSync(join(CARPETA, a), 'utf8')) as Flujo;
export const PRODUCCION = leerFlujo('rroca-antonio.json');
export const PRUEBA = leerFlujo('rroca-antonio.prueba.json');

export const PID = '59100000042'; // phone_number_id del número del negocio
export const ANA = '59100000011';
export const BETO = '59100000022';
export const REC = '59100000031'; // recepción: el WhatsApp de Antonio
export const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);
export const SUSPENDIDO = 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.';

// ------------------------------------------------------------------------------ mensajes entrantes
let seq = 0;
export const valorMeta = (msg: J, from: string, op: { wamid?: string; phoneId?: string } = {}): J => ({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: '59100000001', phone_number_id: op.phoneId ?? PID },
  contacts: [{ profile: { name: 'Ana Pérez' }, wa_id: from }],
  messages: [{ from, id: op.wamid ?? `wamid.IN${++seq}`, timestamp: '1', ...msg }],
});
export const entrega = (valor: J, id?: string): J => ({
  headers: { 'x-aab1-signature': 'v1=abc', 'x-aab1-timestamp': '1', 'x-aab1-delivery-id': id ?? `entrega-${++seq}`, 'x-aab1-attempt': '1' },
  body: { field: 'messages', value: valor },
});
export const mTexto = (body: string): J => ({ type: 'text', text: { body } });
export const mLista = (id: string): J => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title: 'x' } } });
export const mBoton = (id: string): J => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } });
export const mImagen = (op: J = {}): J => ({ type: 'image', image: { id: 'media-img', mime_type: 'image/jpeg', caption: 'mira', ...op } });
export const mAudio = (op: J = {}): J => ({ type: 'audio', audio: { id: 'media-aud', mime_type: 'audio/ogg; codecs=opus', voice: true, ...op } });
export const mDocumento = (op: J = {}): J => ({ type: 'document', document: { id: 'media-doc', mime_type: 'application/pdf', filename: 'recibo.pdf', ...op } });

// ------------------------------------------------------------------------------ el mundo
export interface Opciones {
  flujo?: Flujo;
  /** Lo que contesta la ingesta al entrante (puede traer `atencion`). */
  ingesta?: J;
  /** La consola: un código y un cuerpo, o 'cae'. */
  panel?: { statusCode: number; body: J } | 'cae';
  /** Cómo contesta Meta: 'acepta', 'error' o 'lanza'. Por nodo de envío. */
  envio?: Partial<Record<'Enviar a WhatsApp' | 'Enviar respaldo', 'acepta' | 'error' | 'lanza'>>;
  verificador?: (ll: LlamadaDoble) => J;
  /** El valor de `telefonosDePrueba` en «Config base» (por omisión, ANA y BETO). */
  telefonosDePrueba?: string;
  /** El valor de las claves de «Config base» que la prueba quiera cambiar (plantillas, plazo, línea de protección…). */
  base?: Record<string, unknown>;
  /** Lo que contesta `cotejarComprobanteVenta`: un código y un cuerpo, o 'cae'. */
  cotejo?: { statusCode: number; body: J } | 'cae';
  /** Lo que escribe el modelo de conversación: un texto, null (sin texto), 'cae' (error de servicio) o una función. */
  modeloDice?: string | null | 'cae' | ((ll: LlamadaDoble) => string);
  /** Cómo contesta Meta al aviso a Antonio: 'acepta' (por omisión), 'error' o 'lanza'. */
  aviso?: 'acepta' | 'error' | 'lanza';
  /** Lo que devuelven los medios. */
  medio?: { bytes?: number; url?: string; mime?: string; transcripcion?: string | null; clasificacion?: J | null };
}
/** El catálogo de la consola de Antonio: ids que salen de `idDe(nombre)`; los precios son del catálogo, nunca del flujo. */
export const CATALOGO = [
  { id: 'pack-completo', precio: 49 }, { id: 'libro', precio: 35 }, { id: 'workbook', precio: 20 },
  { id: 'guia-de-conversaciones', precio: 19 }, { id: 'calendario-de-conexion', precio: 17 }, { id: 'preguntas-profundas', precio: 15 },
];
export const MEDIA_QR = 'media-qr-1';
export const panelOk = (extra: J = {}): { statusCode: number; body: J } => ({
  statusCode: 200,
  body: {
    tenantId: 'rroca-antonio', estadoComercio: 'activo', datosDelNegocio: { nombreNegocio: 'El Puente' }, operacion: { numeroRecepcion: REC, prefijosPermitidos: ['591'] }, atencion: { estado: 'normal' },
    catalogo: CATALOGO.map((c) => ({ ...c })),
    venta: { mediaIdQr: MEDIA_QR },
    cobroReal: { nombreCuenta: 'Cuenta del comercio', banco: 'Banco' },
    cobro: { activo: true, qr: { url: 'https://qr.example.com/q.png' }, pendiente: false, regla: 2 },
    ...extra,
  },
});
/** El panel con un QR abierto (el servidor lo dice): monto del pedido y regla 2. */
export const panelConQr = (monto = 49, extra: J = {}): { statusCode: number; body: J } => panelOk({ cobro: { activo: true, qr: { url: 'https://qr.example.com/q.png' }, pendiente: true, monto, pedido: 'AN1', regla: 2 }, ...extra });
/** El panel con productos marcados `agotado` (dato conmutable de la consola). */
export const panelConAgotados = (...ids: string[]): { statusCode: number; body: J } => panelOk({ catalogo: CATALOGO.map((c) => ({ ...c, ...(ids.includes(c.id) ? { agotado: true } : {}) })) });
export const COTEJO_VALIDO = { statusCode: 200, body: { estado: 'valido', importe: 49, avisarComercio: true } };
export const COMPROBANTE = { categoria: 'comprobante', texto: 'Transferencia', monto: '49.00', cuentaDestino: '1*****9', nombreCuenta: 'ANTONIO', fecha: '05/10/2026', hora: '10:00', banco: 'Banco' };
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
  const clasificar = (): J => (m.clasificacion === null ? { error: { message: 'no se pudo describir' } } : gemini(JSON.stringify(m.clasificacion ?? { categoria: 'otro', texto: '' })));
  const dobles: Record<string, Doble> = {
    'Verificar firma con el receptor': o.verificador ?? ((ll) => ({ valido: true, deliveryId: ll.cuerpo?.['deliveryId'] })),
    'Traer configuración': () => (o.panel === 'cae' ? { statusCode: 503, body: {} } : (o.panel ?? panelOk())),
    'Reportar mensaje (entrante)': () => o.ingesta ?? { ok: true },
    'Reportar mensaje (saliente)': () => ({ ok: true }),
    'Reportar protección': () => ({ ok: true }),
    'Obtener URL del medio (general)': () => ({ id: 'm', url: m.url ?? 'https://lookaside.fbsbx.com/whatsapp_business/attachments/medio-1', mime_type: m.mime ?? 'image/jpeg', file_size: m.bytes ?? 100_000 }),
    'Descargar medio': () => ({ descargado: true }),
    'Cotejar en el servidor': () => (o.cotejo === 'cae' ? { statusCode: 503, body: {} } : (o.cotejo ?? COTEJO_VALIDO)),
    'Conversar con el modelo': (ll) => {
      const d = o.modeloDice === undefined ? 'Gracias por contármelo. Se nota que es importante para ti. ¿Desde cuándo sienten esa distancia?' : o.modeloDice;
      if (d === 'cae') return { error: { message: 'servicio no disponible', code: 503 } };
      if (d === null) return {};
      return gemini(typeof d === 'function' ? d(ll) : d);
    },
    'Enviar aviso': (ll) => {
      if (o.aviso === 'lanza') throw new Error('fetch failed: red caída');
      if (o.aviso === 'error') return { error: { message: '(#131047) fuera de la ventana', code: 131047 } };
      return { messaging_product: 'whatsapp', messages: [{ id: `wamid.AVISO${ll.n}` }] };
    },
    'Transcribir audio': () => (m.transcripcion === null ? { error: { message: 'sin transcripción' } } : gemini(m.transcripcion ?? 'hola, quiero el libro')),
    'Describir imagen': clasificar,
    'Describir documento': clasificar,
    'Enviar a WhatsApp': enviar('Enviar a WhatsApp'),
    'Enviar respaldo': enviar('Enviar respaldo'),
  };
  return crearMundo({
    flujo: o.flujo ?? PRODUCCION,
    dobles,
    roles: { ingesta: ['Reportar mensaje (entrante)', 'Reportar mensaje (saliente)', 'Reportar protección'] },
    ahoraMs: AHORA,
    configBase: {
      phoneNumberIdEsperado: PID, numeroRecepcion: REC, telefonosDePrueba: o.telefonosDePrueba ?? `${ANA},${BETO}`,
      avisoComprobantePlantilla: 'aviso_comprobante_recibido', avisoComprobanteEstado: 'APPROVED', avisoConsultaPlantilla: 'aviso_consulta_para_antonio', avisoConsultaEstado: 'APPROVED',
      ...(o.base ?? {}),
    },
  });
}
export const hablar = (m: Mundo, from: string, msg: J, op: { wamid?: string; entrega?: string; phoneId?: string; toleraFallo?: boolean } = {}): ResultadoTurno =>
  m.turno(entrega(valorMeta(msg, from, op), op.entrega), op.toleraFallo ? { tolerarFallo: true } : {});
export const textos = (t: ResultadoTurno): string[] => t.mensajes.map((e) => e.cuerpo);

// ------------------------------------------------------------------------------ las entradas de la landing y de los anuncios
export const PRELLENADOS = {
  pack: 'Hola, quiero conocer el Pack de Reconexión del Método PUENTE (Bs 49)',
  libro: 'Hola, quiero el libro El Puente que nos vuelve a unir (Bs 35)',
  info: 'Hola, quiero más información sobre el Método PUENTE',
  workbook: 'Hola, me interesa el Workbook de Transformación de Pareja',
  calendario: 'Hola, quiero saber más del Calendario o de las 100 Preguntas',
};
export const ANGULOS: Record<string, string> = {
  perder: '¿Tienes miedo de perder tu relación?',
  mismo: '¿Siempre terminan discutiendo por lo mismo?',
  cuarto: '¿Sientes que viven como compañeros de cuarto?',
  plan30: '¿Ya no hablan como antes? Un plan de 30 días para volver a conectar en pareja',
  entienden: '¿Se aman, pero ya no se entienden?',
  herir: 'Aprende a hablar sin herir ni callarte',
  preguntas: '100 preguntas para salir del piloto automático',
};
