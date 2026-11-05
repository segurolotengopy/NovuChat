/**
 * EL MUNDO DE PRUEBA del esqueleto de Walisuma (tenant walisuma). Módulo compartido por las suites de esta carpeta (no es una suite: vitest solo corre `*.test.ts`).
 * Corre los JSON VERSIONADOS con el n8n de mentira (`../../lib/n8n-de-mentira`): la red (verificador, consola, ingesta, Graph, Gemini) son dobles; el código de los nodos es el real.
 * Reloj: lunes 05/10/2026, 10:00 en La Paz. Teléfonos ficticios con seis ceros.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Flujo, J } from '../../lib/flujo';
import { doblesDelGuardado } from '../../lib/doble-guardado';
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
  /** Lo que escribe el modelo de conversación: el JSON de salida, un texto crudo, null (sin texto), 'cae' (error de servicio) o una función. */
  modeloDice?: J | string | null | 'cae' | ((ll: LlamadaDoble) => J | string);
  /** Lo que contesta `cotejarComprobanteVenta`, `guardarComprobante` y la ingesta al evento `cobro_cancelado`: un código y un cuerpo, o 'cae'. */
  cotejo?: { statusCode: number; body: J } | 'cae';
  guardado?: { statusCode: number; body: J } | 'cae';
  cancelar?: { statusCode: number; body: J } | 'cae';
  /** Cómo contesta Meta al aviso al comercio: 'acepta' (por omisión), 'error' o 'lanza'. */
  aviso?: 'acepta' | 'error' | 'lanza';
  /** Valores de «Config base» que la prueba quiera cambiar. */
  base?: Record<string, unknown>;
  /** Lo que devuelven los medios. */
  medio?: { bytes?: number; url?: string; mime?: string; transcripcion?: string | null; clasificacion?: J | null };
}
/** El catálogo de PRUEBA (no es el real): piezas con precio, un tapiz SIN precio (a consultar) y un licor apagado. */
export const CATALOGO = [
  { id: 'bufanda-vicuna', nombre: 'Bufanda de vicuña', descripcion: 'Punto diagonal, 100 % vicuña.', area: 'Accesorios · Bufandas y chales', precio: 7795, moneda: 'BOB', activo: true },
  { id: 'billetera-cuero', nombre: 'Billetera de cuero', descripcion: 'Cuero curtido, tres compartimentos.', area: 'Accesorios · Billeteras', precio: 450, moneda: 'BOB', activo: true },
  { id: 'llavero-llama', nombre: 'Llavero de llama', descripcion: 'Hilo de alpaca.', area: 'Hogar y oficina · Llaveros', precio: 35.5, moneda: 'BOB', activo: true },
  { id: 'tapiz-mujer-rio', nombre: 'Tapiz mujer río 66 x 31 cm', descripcion: 'Tapiz tejido a mano.', area: 'Hogar y oficina · Tapices', activo: true },
  { id: 'licor-de-coca', nombre: 'Licor de coca 50 ml', descripcion: 'Licor.', area: 'Hogar y oficina · Gourmet', precio: 60, moneda: 'BOB', activo: false },
];
export const MEDIA_QR = 'media-qr-1';
export const panelOk = (extra: J = {}): { statusCode: number; body: J } => ({
  statusCode: 200,
  body: {
    tenantId: 'walisuma', estadoComercio: 'activo', datosDelNegocio: { nombreNegocio: 'Tienda de prueba' }, operacion: { numeroRecepcion: REC, prefijosPermitidos: ['591'] }, atencion: { estado: 'normal' },
    catalogo: CATALOGO.map((c) => ({ ...c })),
    venta: { mediaIdQr: MEDIA_QR },
    cobroReal: { nombreCuenta: 'Cuenta del comercio', banco: 'Banco' },
    cobro: { activo: true, qr: { url: 'https://qr.example.com/q.png' }, pendiente: false, regla: 2 },
    ...extra,
  },
});
/** El panel con un QR abierto (lo dice el servidor): monto del pedido y regla 2. */
export const panelConQr = (monto: number, extra: J = {}): { statusCode: number; body: J } => panelOk({ cobro: { activo: true, qr: { url: 'https://qr.example.com/q.png' }, pendiente: true, monto, pedido: 'WL1', regla: 2 }, ...extra });
/** El panel sin cobro real (sin `cobroReal`): no hay QR utilizable. */
export const panelSinCobro = (): { statusCode: number; body: J } => { const p = panelOk(); const { cobroReal: _c, cobro: _o, ...resto } = p.body as J; return { statusCode: 200, body: resto }; };
export const RUTA_GUARDADA = { statusCode: 200, body: { ruta: 'tenants/walisuma/comprobantes/2026-10-05/abc_1.jpg' } };
export const COTEJO_VALIDO = { statusCode: 200, body: { estado: 'valido', importe: 45, avisarComercio: true } };
export const COMPROBANTE = { categoria: 'comprobante', texto: 'Transferencia', monto: '450.00', cuentaDestino: '1*****9', nombreCuenta: 'WALISUMA', fecha: '05/10/2026', hora: '10:00', banco: 'Banco' };
/** Lo que contesta el modelo (JSON de salida): texto, líneas, entrega y quiereHablar. */
export const modelo = (texto: string, extra: J = {}): J => ({ texto, lineas: [], entrega: {}, facturacion: {}, quiereHablar: false, ...extra });
export const ENTREGA = { modo: 'Retiro en tienda', ciudad: 'La Paz', direccion: '', nombre: 'Ana Pérez' };
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
    // La rama común del GUARDADO de medios: el doble del servidor responde «guardado_apagado» (la bandera por defecto), sin mensajes de más.
    ...doblesDelGuardado().dobles,
    'Verificar firma con el receptor': o.verificador ?? ((ll) => ({ valido: true, deliveryId: ll.cuerpo?.['deliveryId'] })),
    'Traer configuración': () => (o.panel === 'cae' ? { statusCode: 503, body: {} } : (o.panel ?? panelOk())),
    'Reportar mensaje (entrante)': () => o.ingesta ?? { ok: true },
    'Reportar mensaje (saliente)': () => ({ ok: true }),
    'Obtener URL del medio (general)': () => ({ id: 'm', url: m.url ?? 'https://lookaside.fbsbx.com/whatsapp_business/attachments/medio-1', mime_type: m.mime ?? 'image/jpeg', file_size: m.bytes ?? 100_000 }),
    'Descargar medio': () => ({ descargado: true }),
    'Guardar comprobante': () => (o.guardado === 'cae' ? { statusCode: 503, body: {} } : (o.guardado ?? RUTA_GUARDADA)),
    'Cotejar en el servidor': () => (o.cotejo === 'cae' ? { statusCode: 503, body: {} } : (o.cotejo ?? COTEJO_VALIDO)),
    'Avisar al servidor': () => (o.cancelar === 'cae' ? { statusCode: 503, body: {} } : (o.cancelar ?? { statusCode: 200, body: { atencion: { estado: 'normal' } } })),
    'Conversar con el modelo': (ll) => {
      const d = o.modeloDice === undefined ? modelo('Con gusto. ¿Qué pieza te interesa?') : o.modeloDice;
      if (d === 'cae') return { error: { message: 'servicio no disponible', code: 503 } };
      if (d === null) return {};
      const v = typeof d === 'function' ? d(ll) : d;
      return gemini(typeof v === 'string' ? v : JSON.stringify(v));
    },
    'Enviar aviso': (ll) => {
      if (o.aviso === 'lanza') throw new Error('fetch failed: red caída');
      if (o.aviso === 'error') return { error: { message: '(#131047) fuera de la ventana', code: 131047 } };
      return { messaging_product: 'whatsapp', messages: [{ id: `wamid.AVISO${ll.n}` }] };
    },
    'Transcribir audio': () => (m.transcripcion === null ? { error: { message: 'sin transcripción' } } : gemini(m.transcripcion ?? 'hola, quiero una manta')),
    'Describir imagen': clasificar,
    'Describir documento': clasificar,
    'Enviar a WhatsApp': enviar('Enviar a WhatsApp'),
    'Enviar respaldo': enviar('Enviar respaldo'),
  };
  return crearMundo({
    flujo: o.flujo ?? PRODUCCION,
    dobles,
    roles: { ingesta: ['Reportar mensaje (entrante)', 'Reportar mensaje (saliente)', 'Avisar al servidor'] },
    ahoraMs: AHORA,
    configBase: {
      phoneNumberIdEsperado: PID, numeroRecepcion: REC, telefonosDePrueba: o.telefonosDePrueba ?? `${ANA},${BETO}`, nombreNegocio: 'Tienda de prueba',
      contactoAviso: REC, avisoPedidoPlantilla: 'pedido_registrado', avisoPedidoEstado: 'APPROVED', avisoPlantillaIdioma: 'es', modosDeEntrega: 'Retiro en tienda, Envío', costoDeEntrega: '',
      ...(o.base ?? {}),
    },
  });
}
export const hablar = (m: Mundo, from: string, msg: J, op: { wamid?: string; entrega?: string; phoneId?: string; contacto?: string; toleraFallo?: boolean } = {}): ResultadoTurno =>
  m.turno(entrega(valorMeta(msg, from, op), op.entrega), op.toleraFallo ? { tolerarFallo: true } : {});
export const textos = (t: ResultadoTurno): string[] => t.mensajes.map((e) => e.cuerpo);
/** Los nodos de red que llaman a un modelo, a una descarga o al guardado de medios: con la pausa por Tomar, ninguno corre. */
export const NODOS_DE_MEDIOS_Y_MODELO = ['Obtener URL del medio (general)', 'Descargar medio', 'Transcribir audio', 'Describir imagen', 'Describir documento', 'Guardar comprobante', 'Conversar con el modelo'];
