/**
 * EL MUNDO DE PRUEBA del esqueleto de Casa Bermejo (tenant casa-bermejo). Módulo compartido por las suites de esta carpeta (no es una suite: vitest solo corre `*.test.ts`).
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
export const CARPETA = join(AQUI, '../../../../Flujos/clientes/casa-bermejo');
export const leerFlujo = (a: string): Flujo => JSON.parse(readFileSync(join(CARPETA, a), 'utf8')) as Flujo;
export const PRODUCCION = leerFlujo('casa-bermejo.json');
export const PRUEBA = leerFlujo('casa-bermejo.prueba.json');

export const PID = '59100000042'; // phone_number_id del número del negocio
export const ANA = '59100000011';
export const BETO = '59100000022';
export const EXTRANJERO = '5511900000033'; // prefijo 55 (Brasil): fuera de los prefijos permitidos (591 y 54)
export const REC = '59100000031'; // recepción
export const ARGENTINO = ['54', '9', '11', '5550', '0001'].join(''); // el teléfono de Argentina de las suites (prefijo 54)
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
  /** El catálogo de la plataforma de la tienda: un código y un cuerpo, o 'cae'. */
  catalogo?: { statusCode: number; body: J } | 'cae';
  /** Cómo contesta Meta: 'acepta', 'error' o 'lanza'. Por nodo de envío. */
  envio?: Partial<Record<'Enviar a WhatsApp' | 'Enviar respaldo', 'acepta' | 'error' | 'lanza'>>;
  verificador?: (ll: LlamadaDoble) => J;
  telefonosDePrueba?: string;
  /** El enlace del catálogo web del comercio (`enlaceCatalogo` de «Config base»); sin él, no hay botón de catálogo. */
  enlaceCatalogo?: string;
  /** Lo que escribe el modelo de conversación: el JSON de salida, un texto crudo, null (sin texto), 'cae' (error de servicio) o una función. */
  modeloDice?: J | string | null | 'cae' | ((ll: LlamadaDoble) => J | string);
  /** Lo que contesta `cotejarComprobanteVenta`, `guardarComprobante` y la ingesta al evento `cobro_cancelado`: un código y un cuerpo, o 'cae'. */
  cotejo?: { statusCode: number; body: J } | 'cae';
  guardado?: { statusCode: number; body: J } | 'cae';
  cancelar?: { statusCode: number; body: J } | 'cae';
  /** Cómo contesta Meta al aviso al comercio: 'acepta' (por omisión), 'error' o 'lanza'. */
  aviso?: 'acepta' | 'error' | 'lanza';
  /** Una entrega que ya estaba en la ficha de ANA, BETO y el argentino ANTES del turno (sembrado EXPLÍCITO; ver `sembrarEntrega`). El modelo ya no puede meter una entrega con modo: el código la ignora. */
  entregaPrevia?: Record<string, string>;
  /** Sin efecto (el sembrado desde la respuesta del modelo se quitó el 25/11/2026); se conserva para no tocar las suites que lo declaran. */
  sinSembrar?: boolean;
  /** Valores de «Config base» que la prueba quiera cambiar. */
  base?: Record<string, unknown>;
  /** Lo que devuelven los medios. */
  medio?: { bytes?: number; url?: string; mime?: string; transcripcion?: string | null; clasificacion?: J | null };
}
/** El catálogo de PRUEBA (no es el real): piezas con precio, una pieza sin precio (no se vende) y una apagada. */
export const CATALOGO = [
  { id: 'bufanda-vicuna', nombre: 'Bufanda de vicuña', descripcion: 'Punto diagonal, 100 % vicuña.', area: 'Accesorios · Bufandas y chales', precio: 7795, moneda: 'BOB', activo: true },
  { id: 'billetera-cuero', nombre: 'Billetera de cuero', descripcion: 'Cuero curtido, tres compartimentos.', area: 'Accesorios · Billeteras', precio: 450, moneda: 'BOB', activo: true },
  { id: 'llavero-llama', nombre: 'Llavero de llama', descripcion: 'Hilo de alpaca.', area: 'Hogar y oficina · Llaveros', precio: 36, moneda: 'BOB', activo: true },
  { id: 'tapiz-mujer-rio', nombre: 'Tapiz mujer río 66 x 31 cm', descripcion: 'Tapiz tejido a mano.', area: 'Hogar y oficina · Tapices', activo: true },
  { id: 'licor-de-coca', nombre: 'Licor de coca 50 ml', descripcion: 'Licor.', area: 'Hogar y oficina · Gourmet', precio: 60, moneda: 'BOB', activo: false },
];
export const MEDIA_QR = 'media-qr-1';
/** La respuesta del catálogo de la plataforma de la tienda (contrato v1, mercado BO): lo vendible de CATALOGO con precio final, stock y `disponible`. */
export const catalogoOk = (extra: J = {}, items?: J[]): { statusCode: number; body: J } => ({
  statusCode: 200,
  body: {
    version: 1, mercado: 'BO', moneda: 'BOB', generadoEn: new Date(AHORA).toISOString(), cotizacion: { id: 'c1', par: 'USD/BOB', valor: 12, fecha: '2026-10-05', fuente: 'prueba', estado: 'vigente' },
    items: items ?? CATALOGO.filter((c) => c.activo && typeof (c as J)['precio'] === 'number').map((c) => ({ ...c, precioCentavos: Math.round(((c as J)['precio'] as number) * 100), stock: 10, disponible: true })),
    ...extra,
  },
});
export const panelOk = (extra: J = {}): { statusCode: number; body: J } => ({
  statusCode: 200,
  body: {
    tenantId: 'casa-bermejo', estadoComercio: 'activo', datosDelNegocio: { nombreNegocio: 'Tienda de prueba' }, operacion: { numeroRecepcion: REC, prefijosPermitidos: ['591', '54'] }, atencion: { estado: 'normal' },
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
export const RUTA_GUARDADA = { statusCode: 200, body: { ruta: 'tenants/casa-bermejo/comprobantes/2026-10-05/abc_1.jpg' } };
export const COTEJO_VALIDO = { statusCode: 200, body: { estado: 'valido', importe: 45, avisarComercio: true } };
export const COMPROBANTE = { categoria: 'comprobante', texto: 'Transferencia', monto: '450.00', cuentaDestino: '1*****9', nombreCuenta: 'TIENDA DE PRUEBA', fecha: '05/10/2026', hora: '10:00', banco: 'Banco' };
/** Lo que contesta el modelo (JSON de salida): texto, líneas, entrega y quiereHablar. */
export const modelo = (texto: string, extra: J = {}): J => ({ texto, lineas: [], entrega: {}, facturacion: {}, quiereHablar: false, ...extra });
export const ENTREGA = { modo: 'Retiro en tienda', nombre: 'Ana Pérez' };
/** Un envío YA completo (sembrado): Bolivia y Argentina. */
export const ENVIO_BO = { modo: 'Envío', departamento: 'dep:cb', ciudad: 'Cochabamba', aclaracion: 'oficina Zona Sur', nombre: 'Ana Pérez', documento: '4412345' };
export const ENVIO_AR = { modo: 'Envío', region: 'reg:centro', provincia: 'prov:ar-x', ciudad: 'Córdoba', aclaracion: 'sucursal Palermo', nombre: 'Ana Pérez', documento: '30123456' };
export function crear(o: Opciones = {}): Mundo {
  let mundo: Mundo | undefined;
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
    'Traer catálogo': () => (o.catalogo === 'cae' ? { statusCode: 503, body: { error: 'sin_cotizacion' } } : (o.catalogo ?? catalogoOk())),
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
  mundo = crearMundo({
    flujo: o.flujo ?? PRODUCCION,
    dobles,
    roles: { ingesta: ['Reportar mensaje (entrante)', 'Reportar mensaje (saliente)', 'Avisar al servidor'] },
    ahoraMs: AHORA,
    configBase: {
      phoneNumberIdEsperado: PID, numeroRecepcion: REC, telefonosDePrueba: o.telefonosDePrueba ?? `${ANA},${BETO}`, nombreNegocio: 'Tienda de prueba',
      contactoAviso: REC, avisoPedidoPlantilla: 'aviso_pedido_equipo', avisoPedidoEstado: 'PENDING', avisoRespaldoPlantilla: 'pedido_registrado', avisoRespaldoEstado: 'APPROVED', avisoPlantillaIdioma: 'es', modosDeEntrega: 'Retiro en tienda, Envío', costoDeEntrega: '', enlaceCatalogo: o.enlaceCatalogo ?? '',
      ...(o.base ?? {}),
    },
  });
  if (o.entregaPrevia) for (const tel of [ANA, BETO, ARGENTINO]) sembrarEntrega(mundo, tel, o.entregaPrevia);
  return mundo;
}
/**
 * SEMBRADO EXPLÍCITO de la entrega de una ficha ANTES del turno («el cliente ya eligió el modo y dio sus datos en una charla anterior»). Solo acepta lo que el código aceptaría de un cliente:
 * un modo de la lista, un nombre sin cifras y de 60 caracteres o menos, un CI de 5 a 13 dígitos; cualquier otra cosa lanza. NO sale de la respuesta del modelo (el 25/11/2026 se quitó ese atajo: escondía defectos de `bmEntregaDeTurno`).
 */
export function sembrarEntrega(m: Mundo, from: string, entrega: Record<string, string>): void {
  if (entrega['modo'] && !['Retiro en tienda', 'Envío'].includes(entrega['modo'])) throw new Error('sembrarEntrega: modo no válido');
  if (entrega['nombre'] && (!/^[\p{L} .'-]{1,60}$/u.test(entrega['nombre']))) throw new Error('sembrarEntrega: el nombre no lo aceptaría el código');
  if (entrega['documento'] && !/^\d{5,13}$/.test(entrega['documento'])) throw new Error('sembrarEntrega: el CI no lo aceptaría el código');
  if (entrega['departamento'] && !/^dep:[a-z]{2}$/.test(entrega['departamento'])) throw new Error('sembrarEntrega: el departamento tiene que ser un id de la lista');
  if (entrega['region'] && !/^reg:[a-z]+$/.test(entrega['region'])) throw new Error('sembrarEntrega: la región tiene que ser un id de la lista');
  if (entrega['provincia'] && !/^prov:ar-[a-z]$/.test(entrega['provincia'])) throw new Error('sembrarEntrega: la provincia tiene que ser un id de la lista');
  for (const k of Object.keys(entrega)) if (!['modo', 'nombre', 'documento', 'departamento', 'region', 'provincia', 'ciudad', 'aclaracion'].includes(k)) throw new Error(`sembrarEntrega: «${k}» ya no es un dato de la entrega (no se pide: dirección, teléfono, ubicación ni flota)`);
  const mapa = ((m.sd['casabermejo'] ??= {}) as Record<string, J>);
  const previa = (mapa[from] ?? {}) as J;
  mapa[from] = { ultimoMs: AHORA - 1000, ...previa, entrega: { modo: '', departamento: '', region: '', provincia: '', ciudad: '', aclaracion: '', nombre: '', documento: '', ...(previa['entrega'] as J | undefined), ...entrega } };
}
export const hablar = (m: Mundo, from: string, msg: J, op: { wamid?: string; entrega?: string; phoneId?: string; contacto?: string; toleraFallo?: boolean } = {}): ResultadoTurno =>
  (m.turno(entrega(valorMeta(msg, from, op), op.entrega), op.toleraFallo ? { tolerarFallo: true } : {}));
export const textos = (t: ResultadoTurno): string[] => t.mensajes.map((e) => e.cuerpo);
/** Los nodos de red que llaman a un modelo, a una descarga o al guardado de medios: con la pausa por Tomar, ninguno corre. */
export const NODOS_DE_MEDIOS_Y_MODELO = ['Obtener URL del medio (general)', 'Descargar medio', 'Transcribir audio', 'Describir imagen', 'Describir documento', 'Guardar comprobante', 'Conversar con el modelo'];

// ------------------------------------------------------------------------------ los modelos de las suites del rediseño de la entrega (25/11/2026)
/** El último texto del cliente tal como llega al modelo (sin los delimitadores <<< >>>). */
export const textoAlModelo = (ll: LlamadaDoble): string => {
  const cs = (ll.cuerpo?.['contents'] ?? []) as { parts?: { text?: string }[] }[];
  return String(cs[cs.length - 1]?.parts?.[0]?.text ?? '').replace(/^<<<\s*|\s*>>>$/g, '').trim();
};
export const BILLETERA = [{ id: 'billetera-cuero', cantidad: 1 }];
/**
 * El modelo SANO: en el primer turno agrega la billetera; en los demás repite el pedido y devuelve en `entrega` lo que `entregaDe(texto del cliente)` diga (la extracción que haría un modelo bien portado). Nunca propone `quiereHablar`.
 * `entregaDe` por omisión no devuelve nada (el modelo «no encontró» datos en el texto).
 */
export function modeloSano(entregaDe: (texto: string) => J = () => ({}), texto = 'Listo.'): (ll: LlamadaDoble) => J {
  let n = 0;
  return (ll) => { n++; return n === 1 ? modelo('Con gusto, lo anoto.', { lineas: BILLETERA }) : modelo(texto, { lineas: BILLETERA, entrega: entregaDe(textoAlModelo(ll)) }); };
}
/** El modelo sano que devuelve como `nombre` el texto entero del cliente (el cliente acaba de responder «¿a nombre de quién?»). */
export const modeloDeNombre = (): ((ll: LlamadaDoble) => J) => modeloSano((t) => ({ nombre: t }));
/** El modelo ADVERSO: agrega la billetera en el primer turno; los demás devuelven `lineas: []`, `entrega: {}` y `quiereHablar: true` con la derivación. */
export function modeloAdverso(): (ll: LlamadaDoble) => J {
  let n = 0;
  return () => { n++; return n === 1 ? modelo('Con gusto, lo anoto.', { lineas: BILLETERA }) : modelo('Una persona del equipo se encargará.', { lineas: [], entrega: {}, quiereHablar: true }); };
}
/** El toque de un botón de respuesta. */
export const mToque = (id: string, title: string): J => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
/** La opción tocada de una LISTA interactiva (entrante `list_reply` de Meta: id, title y description). */
export const mLista = (id: string, title: string): J => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title, description: '' } } });
/** Una ubicación compartida (entrante `location` de Meta): el flujo NO la pide ni la guarda. */
export const mUbicacion = (): J => ({ type: 'location', location: { latitude: -16.5, longitude: -68.15 } });

/**
 * COMPLETA LOS DATOS DEL ENVÍO por la captura real, paso a paso, con lo que el cliente tocaría o escribiría («Intermedio», 26/11/2026). Se llama DESPUÉS del toque de «Envío».
 * Bolivia (3 pasos): departamento (lista) → ciudad y aclaración (un texto) → nombre y cédula (un texto). Argentina (4 pasos): región (lista) → provincia (lista) → ciudad y aclaración → nombre y DNI. Devuelve el último turno (el resumen con «Confirmar pedido»).
 */
export function completarEnvio(m: Mundo, from: string, mercado: 'BO' | 'AR' = 'BO'): ResultadoTurno {
  if (mercado === 'AR') {
    hablar(m, from, mLista('reg:centro', 'Centro'));
    hablar(m, from, mLista('prov:ar-x', 'Córdoba'));
    hablar(m, from, mTexto('Córdoba, sucursal Palermo'));
    return hablar(m, from, mTexto('Ana Pérez 30123456'));
  }
  hablar(m, from, mLista('dep:cb', 'Cochabamba'));
  hablar(m, from, mTexto('Cochabamba, oficina Zona Sur'));
  return hablar(m, from, mTexto('Ana Pérez 4412345'));
}
/**
 * Un mundo con el pedido LISTO por la CAPTURA REAL: la billetera, el botón «Recojo en tienda» y el nombre que devuelve el modelo (validado por el código). Termina en el resumen con «Confirmar pedido» y «Corregir datos».
 * El modelo es `modeloDeNombre()` salvo que `o.modeloDice` diga otro.
 */
export function conPedidoListo(o: Opciones = {}, from = ANA): Mundo {
  const m = crear({ modeloDice: modeloDeNombre(), ...o });
  hablar(m, from, mTexto('quiero una billetera'));
  hablar(m, from, mToque('entrega:retiro', 'Recojo en tienda'));
  hablar(m, from, mTexto('Ana Pérez'));
  return m;
}
