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
export const CARPETA = join(AQUI, '../../../../Flujos/clientes/walisuma');
export const leerFlujo = (a: string): Flujo => JSON.parse(readFileSync(join(CARPETA, a), 'utf8')) as Flujo;
export const PRODUCCION = leerFlujo('walisuma.json');
export const PRUEBA = leerFlujo('walisuma.prueba.json');

export const PID = '59100000042'; // phone_number_id del número del negocio
export const ANA = '59100000011';
export const BETO = '59100000022';
export const EXTRANJERO = '5491100000033'; // prefijo 54: fuera de los prefijos permitidos
export const REC = '59100000031'; // recepción
export const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);
export const SUSPENDIDO = 'En este momento no podemos atenderle por este medio. Gracias por escribirnos.';

// ------------------------------------------------------------------------------ el flujo por omisión
// Los contratos de PR-K (ubicación, anuncio, banco de origen y operación) ya están en el código común fusionado: el mundo corre el JSON versionado tal cual, sin simulaciones.
export const CON_CONTRATOS = PRODUCCION;
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
  /** El reloj del mundo (por omisión AHORA: lunes 05/10/2026, 10:00 en La Paz). */
  ahoraMs?: number;
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
/**
 * EL CONTRATO DEL COTEJO DE PR-S (decisión 8, con `config/pedidos.montoExacto === true`), SIMULADO: un monto distinto responde `reintentar` + `monto_distinto` con
 * `montoLeido`, `montoEsperado`, `diferencia` (leído − esperado, con signo, 2 decimales), `intentos` e `intentosRestantes`; el 3.er intento pasa a `en_revision`;
 * el cierre válido trae `codigoPedido` (WAL-AAMMDD-NNN).
 */
export const cotejoMontoDistinto = (leido: number, esperado: number, intentos = 1): { statusCode: number; body: J } => ({
  statusCode: 200, body: { estado: 'reintentar', motivo: 'monto_distinto', importe: esperado, montoLeido: leido, montoEsperado: esperado, diferencia: Math.round((leido - esperado) * 100) / 100, intentos, intentosRestantes: Math.max(0, 3 - intentos) },
});
export const cotejoEnRevision = (leido: number, esperado: number): { statusCode: number; body: J } => ({
  statusCode: 200, body: { estado: 'en_revision', motivo: 'monto_distinto', importe: esperado, montoLeido: leido, montoEsperado: esperado, diferencia: Math.round((leido - esperado) * 100) / 100, intentos: 3, intentosRestantes: 0, avisarComercio: true },
});
export const cotejoValidoConCodigo = (importe: number, codigoPedido = 'WAL-261005-001'): { statusCode: number; body: J } => ({ statusCode: 200, body: { estado: 'valido', importe, avisarComercio: true, codigoPedido } });
export const COMPROBANTE = { categoria: 'comprobante', texto: 'Transferencia', monto: '450.00', cuentaDestino: '1*****9', nombreCuenta: 'WALISUMA', fecha: '05/10/2026', hora: '10:00', banco: 'Banco' };
/** Lo que contesta el modelo (JSON de salida): texto, líneas, entrega y quiereHablar. */
export const modelo = (texto: string, extra: J = {}): J => ({ texto, lineas: [], entrega: {}, facturacion: {}, quiereHablar: false, ...extra });
/** Recojo en tienda (La Paz): nombre completo y teléfono, sin dirección de entrega. */
/**
 * Decisión de Andres (23/11/2026, «Enviar el QR solo»): con el cobro real, el QR sale en el turno en que el pedido y la entrega quedan COMPLETOS, sin esperar «pagar».
 * Para probar el QR en el turno en que el cliente dice «quiero pagar», el 1.er turno trae solo el pedido (sin entrega) y la entrega llega en el 2.º.
 * El turno se reconoce por el largo del historial que recibe el modelo (1 = el primero).
 */
export const entregaEnElSegundoTurno = (d: J): ((ll: LlamadaDoble) => J) => (ll) => {
  const n = ((ll.cuerpo?.['contents'] ?? []) as unknown[]).length;
  return n <= 1 ? { ...d, entrega: {} } : d;
};
export const ENTREGA = { modo: 'Recojo en tienda', ciudad: 'La Paz', direccion: '', nombre: 'Ana Pérez', telefono: '71234567' };
/** Envío a domicilio en La Paz: nombre completo, teléfono y dirección exacta. */
export const ENVIO = { modo: 'Envío en La Paz', ciudad: 'La Paz', direccion: 'Av. Arce 2345, Sopocachi', nombre: 'Ana Pérez', telefono: '71234567' };
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
    flujo: o.flujo ?? CON_CONTRATOS,
    dobles,
    roles: { ingesta: ['Reportar mensaje (entrante)', 'Reportar mensaje (saliente)', 'Avisar al servidor'] },
    ahoraMs: o.ahoraMs ?? AHORA,
    configBase: {
      phoneNumberIdEsperado: PID, numeroRecepcion: REC, telefonosDePrueba: o.telefonosDePrueba ?? `${ANA},${BETO}`, nombreNegocio: 'Tienda de prueba',
      contactoAviso: REC, avisoPedidoPlantilla: 'aviso_pedido_equipo', avisoPedidoEstado: 'APPROVED', avisoRespaldoPlantilla: 'pedido_registrado', avisoRespaldoEstado: 'APPROVED', avisoPlantillaIdioma: 'es', modosDeEntrega: 'Envío en La Paz, Envío en Santa Cruz, Envío nacional, Recojo en tienda', envioGratisDesdeBs: 500,
      tiendaLaPaz: 'Calle Claudio Aliaga 1231, San Miguel', tiendaSantaCruz: 'Av. Marcelo Terceros (3er anillo externo) esq. Flamboyanos',
      ...(o.base ?? {}),
    },
  });
}
export const hablar = (m: Mundo, from: string, msg: J, op: { wamid?: string; entrega?: string; phoneId?: string; contacto?: string; toleraFallo?: boolean } = {}): ResultadoTurno =>
  m.turno(entrega(valorMeta(msg, from, op), op.entrega), op.toleraFallo ? { tolerarFallo: true } : {});
export const textos = (t: ResultadoTurno): string[] => t.mensajes.map((e) => e.cuerpo);
/** Los nodos de red que llaman a un modelo, a una descarga o al guardado de medios: con la pausa por Tomar, ninguno corre. */
export const NODOS_DE_MEDIOS_Y_MODELO = ['Obtener URL del medio (general)', 'Descargar medio', 'Transcribir audio', 'Describir imagen', 'Describir documento', 'Guardar comprobante', 'Conversar con el modelo'];
