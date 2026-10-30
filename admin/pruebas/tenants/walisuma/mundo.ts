/**
 * EL MUNDO DE PRUEBA del esqueleto de Walisuma (tenant walisuma). Módulo compartido por las suites de esta carpeta (no es una suite: vitest solo corre `*.test.ts`).
 * Corre los JSON VERSIONADOS con el n8n de mentira (`../../lib/n8n-de-mentira`): la red (verificador, consola, ingesta, Graph, Gemini) son dobles; el código de los nodos es el real.
 * Reloj: lunes 05/10/2026, 10:00 en La Paz. Teléfonos ficticios con seis ceros.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Flujo, J } from '../../lib/flujo';
import { crearMundo, type Doble, type LlamadaDoble, type Mundo, type ResultadoTurno } from '../../lib/n8n-de-mentira';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const CARPETA = join(AQUI, '../../../../Flujos/experimental/walisuma');
export const leerFlujo = (a: string): Flujo => JSON.parse(readFileSync(join(CARPETA, a), 'utf8')) as Flujo;
export const PRODUCCION = leerFlujo('walisuma.json');
export const PRUEBA = leerFlujo('walisuma.prueba.json');

export const PID = '59100000042'; // phone_number_id del número del negocio
export const ANA = '59100000011';
export const BETO = '59100000022';
export const EXTRANJERO = '5491100000033'; // prefijo 54: fuera de los prefijos permitidos
export const REC = '59100000031'; // recepción
export const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);
export const SUSPENDIDO = 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.';

// ------------------------------------------------------------------------------ mensajes entrantes
let seq = 0;
export const valorMeta = (msg: J, from: string, op: { wamid?: string; phoneId?: string; contacto?: string } = {}): J => ({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: '59100000001', phone_number_id: op.phoneId ?? PID },
  contacts: [{ profile: { name: 'Ana Pérez' }, wa_id: op.contacto ?? from }],
  messages: [{ from, id: op.wamid ?? `wamid.IN${++seq}`, timestamp: '1', ...msg }],
});
export const entrega = (valor: J, id?: string, campo = 'messages'): J => ({
  headers: { 'x-aab1-signature': 'v1=abc', 'x-aab1-timestamp': '1', 'x-aab1-delivery-id': id ?? `entrega-${++seq}`, 'x-aab1-attempt': '1' },
  body: { field: campo, value: valor },
});
export const mTexto = (body: string): J => ({ type: 'text', text: { body } });
export const mImagen = (op: J = {}): J => ({ type: 'image', image: { id: 'media-img', mime_type: 'image/jpeg', caption: 'mira', ...op } });
export const mAudio = (op: J = {}): J => ({ type: 'audio', audio: { id: 'media-aud', mime_type: 'audio/ogg; codecs=opus', voice: true, ...op } });
export const mDocumento = (op: J = {}): J => ({ type: 'document', document: { id: 'media-doc', mime_type: 'application/pdf', filename: 'recibo.pdf', ...op } });
export const mSticker = (): J => ({ type: 'sticker', sticker: { id: 'st-1' } });

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
  telefonosDePrueba?: string;
  /** Lo que devuelven los medios. */
  medio?: { bytes?: number; url?: string; mime?: string; transcripcion?: string | null; clasificacion?: J | null };
}
export const panelOk = (extra: J = {}): { statusCode: number; body: J } => ({
  statusCode: 200,
  body: { tenantId: 'walisuma', estadoComercio: 'activo', datosDelNegocio: { nombreNegocio: 'Tienda de prueba' }, operacion: { numeroRecepcion: REC, prefijosPermitidos: ['591'] }, atencion: { estado: 'normal' }, ...extra },
});
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
    'Obtener URL del medio (general)': () => ({ id: 'm', url: m.url ?? 'https://lookaside.fbsbx.com/whatsapp_business/attachments/medio-1', mime_type: m.mime ?? 'image/jpeg', file_size: m.bytes ?? 100_000 }),
    'Descargar medio': () => ({ descargado: true }),
    'Guardar comprobante': () => ({ statusCode: 200, body: { ruta: 'tenants/walisuma/comprobantes/2026-10-05/abc_1.jpg' } }),
    'Transcribir audio': () => (m.transcripcion === null ? { error: { message: 'sin transcripción' } } : gemini(m.transcripcion ?? 'hola, quiero una manta')),
    'Describir imagen': clasificar,
    'Describir documento': clasificar,
    'Enviar a WhatsApp': enviar('Enviar a WhatsApp'),
    'Enviar respaldo': enviar('Enviar respaldo'),
  };
  return crearMundo({
    flujo: o.flujo ?? PRODUCCION,
    dobles,
    roles: { ingesta: ['Reportar mensaje (entrante)', 'Reportar mensaje (saliente)'] },
    ahoraMs: AHORA,
    configBase: { phoneNumberIdEsperado: PID, numeroRecepcion: REC, telefonosDePrueba: o.telefonosDePrueba ?? `${ANA},${BETO}`, nombreNegocio: 'Tienda de prueba' },
  });
}
export const hablar = (m: Mundo, from: string, msg: J, op: { wamid?: string; entrega?: string; phoneId?: string; contacto?: string; toleraFallo?: boolean } = {}): ResultadoTurno =>
  m.turno(entrega(valorMeta(msg, from, op), op.entrega), op.toleraFallo ? { tolerarFallo: true } : {});
export const textos = (t: ResultadoTurno): string[] => t.mensajes.map((e) => e.cuerpo);
/** Los nodos de red que llaman a un modelo, a una descarga o al guardado de medios: con la pausa por Tomar, ninguno corre. */
export const NODOS_DE_MEDIOS_Y_MODELO = ['Obtener URL del medio (general)', 'Descargar medio', 'Transcribir audio', 'Describir imagen', 'Describir documento', 'Guardar comprobante', 'Conversar con el modelo'];
