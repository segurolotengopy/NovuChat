/**
 * Mundo compartido de las pruebas del flujo de Rubén (tenant rroca-ruben): el flujo versionado, el n8n de mentira con sus dobles y los ayudantes de lectura.
 * Extraído SIN cambios de `venta.test.ts` para que `comprobantes-malos.test.ts` reutilice el mismo mundo. Teléfonos ficticios con seis ceros.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { Flujo, J } from '../../lib/flujo';
import { crearMundo, type Doble, type LlamadaDoble, type Mundo, type ResultadoTurno } from '../../lib/n8n-de-mentira';
import { vigilarUx } from './vigilante-ux';

export const AQUI = dirname(fileURLToPath(import.meta.url));
export const CARPETA = join(AQUI, '../../../../Flujos/experimental/rroca-ruben');
export const leerFlujo = (a: string): Flujo => JSON.parse(readFileSync(join(CARPETA, a), 'utf8')) as Flujo;
export const PRODUCCION = leerFlujo('rroca-ruben.json');
export const PRUEBA = leerFlujo('rroca-ruben.prueba.json');

export const PID = '59100000042';
export const ANA = '59100000011';
export const BETO = '59100000022';
export const REC = '59100000031'; // el WhatsApp de Rubén
export const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);
export const MEDIA_QR = 'MEDIAQR100200';
export const URL_QR = 'https://us-east1-ejemplo.cloudfunctions.net/imagenDeCobro?f=ficha1';

// ------------------------------------------------------------------------------ mensajes entrantes
export let seq = 0;
export const valorMeta = (msg: J, from: string): J => ({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: '59100000001', phone_number_id: PID },
  contacts: [{ profile: { name: 'Ana Pérez' }, wa_id: from }],
  messages: [{ from, id: `wamid.IN${++seq}`, timestamp: '1', ...msg }],
});
export const entrega = (valor: J): J => ({
  headers: { 'x-aab1-signature': 'v1=abc', 'x-aab1-timestamp': '1', 'x-aab1-delivery-id': `entrega-${++seq}`, 'x-aab1-attempt': '1' },
  body: { field: 'messages', value: valor },
});
export const mTexto = (body: string): J => ({ type: 'text', text: { body } });
export const mBoton = (id: string): J => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } });
export const mImagen = (caption?: string): J => ({ type: 'image', image: { id: 'media-img', mime_type: 'image/jpeg', ...(caption ? { caption } : {}) } });
export const mPdf = (): J => ({ type: 'document', document: { id: 'media-pdf', mime_type: 'application/pdf', filename: 'comprobante.pdf' } });

export const PRELLENADOS = {
  pack: 'Hola Rubén, quiero el Pack Completo: libro + 4 bonos + Closer de Ventas + curso de videos con IA (60 Bs)',
  libro: 'Hola Rubén, quiero el libro IA para Emprendedores + los 4 bonos (32 Bs)',
  closer: 'Hola Rubén, quiero el Prompt Maestro de Cierre de Ventas (20 Bs)',
  videos: 'Hola Rubén, quiero los videos tutoriales para crear contenido con IA (25 Bs)',
  consulta: 'Hola Rubén, tengo una consulta sobre el libro IA para Emprendedores',
};

// ------------------------------------------------------------------------------ el mundo
export const CATALOGO = [
  { id: 'pack-completo', nombre: 'Pack Completo', precio: 60, activo: true },
  { id: 'libro-bonos', nombre: 'Libro + 4 bonos', precio: 32, activo: true },
  { id: 'closer-ventas', nombre: 'Prompt Closer', precio: 20, activo: true },
  { id: 'videos-ia', nombre: 'Videos con IA', precio: 25, activo: true },
];
/** El estado del cobro de la consola para el teléfono (lo que el servidor sabe): lo cambian los dobles como lo haría el servidor. */
export interface Cobro { pendiente: boolean; monto: number | null; pedido: string | null; enRevision: boolean; vencidoHaceMin: number | null }
export interface Opciones {
  flujo?: Flujo;
  catalogo?: J[];
  mediaIdQr?: string | null;
  /** 'real' (por omisión), 'simulado' (el servidor manda `cobroSimulado`), 'ninguno'. */
  modo?: 'real' | 'simulado' | 'ninguno';
  cobroSimuladoActivo?: boolean;
  atencion?: J;
  modelo?: Doble;
  aviso?: 'acepta' | 'error' | 'sin-id' | 'id-vacio' | 'lanza';
  lectura?: J | 'ilegible';
  cotejo?: (ll: LlamadaDoble) => J;
  tamano?: number;
  guardar?: J;
  envio?: 'acepta' | 'error';
  /** Minutos desde el último mensaje de Rubén al bot (la ventana de servicio de Meta). Por omisión 5 (ventana ABIERTA: el aviso va como texto libre). `null` = Rubén nunca escribió. */
  rubenEscribioHaceMin?: number | null;
  /** 'aprobadas': las dos plantillas de aviso en estado APPROVED en «Config base». Por omisión, lo que traen los datos (APPROVED desde el 19/10/2026); 'pendientes' fabrica PENDING. */
  plantillas?: 'aprobadas' | 'pendientes' | 'sin-nombre' | 'rechazada-consulta';
}
export const PLANTILLAS_APROBADAS = { avisoComprobanteEstado: 'APPROVED', avisoConsultaEstado: 'APPROVED' };
export const RESPUESTA_DEL_MODELO = 'Qué buen punto. El libro te enseña paso a paso a usar la IA en tu negocio, sin ser experto. ¿A qué te dedicas?';
// Lo que ve el cliente: el MISMO texto con la pregunta final en su propio párrafo (solo se reparten espacios en blanco).
export const RESPUESTA_EN_PARRAFOS = 'Qué buen punto. El libro te enseña paso a paso a usar la IA en tu negocio, sin ser experto.\n\n¿A qué te dedicas?';
export const geminiTexto = (t: string): J => ({ candidates: [{ content: { parts: [{ text: t }] } }] });
export const cotejoValido = (): J => ({ statusCode: 200, body: { estado: 'valido', importe: 60, avisarComercio: true, cierreId: 'venta_1' } });

export function crear(o: Opciones = {}) {
  // El estado del cobro es POR TELÉFONO (lo calcula el servidor mirando la solicitud de cada uno).
  const cobros: Record<string, Cobro> = {};
  const de = (tel: string): Cobro => (cobros[tel] ??= { pendiente: false, monto: null, pedido: null, enRevision: false, vencidoHaceMin: null });
  const modo = o.modo ?? 'real';
  const panel = (tel: string): J => { const cobro = de(tel); return ({
    statusCode: 200,
    body: {
      tenantId: 'rroca-ruben',
      estadoComercio: 'activo',
      datosDelNegocio: { nombreNegocio: 'Rubén Roca' },
      operacion: { numeroRecepcion: REC, prefijosPermitidos: ['591'] },
      voz: { nombreAsistente: '' },
      atencion: o.atencion ?? { estado: 'normal' },
      catalogo: o.catalogo ?? CATALOGO,
      venta: o.mediaIdQr === null ? {} : { mediaIdQr: o.mediaIdQr ?? MEDIA_QR },
      ...(modo === 'real' ? { cobroReal: { nombreCuenta: 'Titular Ejemplo', banco: 'Banco Ejemplo', cuentas: ['59100000077'], venceEl: '2027-12-31', moneda: 'BOB', montoFijo: null, fichaQr: 'ficha1' } } : {}),
      ...(modo === 'simulado' ? { cobroSimulado: { mediaIdQr: o.mediaIdQr ?? MEDIA_QR } } : {}),
      cobro: { activo: modo === 'real', moneda: 'BOB', qr: modo === 'real' ? { url: URL_QR, nombreCuenta: 'Titular Ejemplo', banco: 'Banco Ejemplo' } : null, regla: 2, pendiente: cobro.pendiente, monto: cobro.monto, pedido: cobro.pedido, enRevision: cobro.enRevision, vencidoHaceMin: cobro.vencidoHaceMin },
    },
  }); };
  let nEnvios = 0;
  const enviar = (nodo: string): Doble => (ll: LlamadaDoble) => {
    if (o.envio === 'error' && nodo === 'Enviar a WhatsApp') return { error: { message: '(#131053) Media upload error', code: 131053 } };
    return { messaging_product: 'whatsapp', messages: [{ id: `wamid.OUT${nodo.replace(/\W+/g, '')}${++nEnvios}${ll.n}` }] };
  };
  const dobles: Record<string, Doble> = {
    'Verificar firma con el receptor': (ll) => ({ valido: true, deliveryId: ll.cuerpo?.['deliveryId'] }),
    'Traer configuración': (ll) => panel(String(ll.cuerpo?.['telefono'] ?? '')),
    'Reportar mensaje (entrante)': () => ({ ok: true }),
    // Como el servidor: el evento `qr_enviado` abre el cobro con el monto y el pedido reportados.
    'Reportar mensaje (saliente)': (ll) => {
      const c = ll.cuerpo ?? {};
      if (c['evento'] === 'qr_enviado') { const cobro = de(String(c['telefono'])); cobro.pendiente = true; cobro.monto = Number(c['monto']); cobro.pedido = String(c['referencia']); }
      return { ok: true };
    },
    'Conversar con el modelo': o.modelo ?? geminiTexto(RESPUESTA_DEL_MODELO),
    'Enviar aviso': () => {
      const m = o.aviso ?? 'acepta';
      if (m === 'lanza') throw new Error('fetch failed');
      if (m === 'error') return { error: { message: '(#131047) Re-engagement message', code: 131047 } };
      if (m === 'sin-id') return { messaging_product: 'whatsapp', contacts: [{ wa_id: REC }] };
      if (m === 'id-vacio') return { messaging_product: 'whatsapp', messages: [{ id: '' }] };
      return { messaging_product: 'whatsapp', messages: [{ id: `wamid.AVISO${++nEnvios}` }] };
    },
    'Enviar a WhatsApp': enviar('Enviar a WhatsApp'),
    'Enviar respaldo': enviar('Enviar respaldo'),
    'Obtener URL del medio': () => ({ url: 'https://lookaside.fbsbx.com/m', mime_type: 'image/jpeg', file_size: o.tamano ?? 100_000 }),
    'Descargar medio': () => ({}),
    'Guardar comprobante': () => o.guardar ?? { statusCode: 200, body: { ruta: 'tenants/rroca-ruben/comprobantes/2026-10-05/abc_1.jpg' } },
    'Leer comprobante (imagen)': () => (o.lectura === 'ilegible' ? {} : geminiTexto(JSON.stringify(o.lectura ?? { monto: '60.00', cuentaDestino: '59100000077', nombreCuenta: 'Titular Ejemplo', fecha: '05/10/2026', hora: '10:02', banco: 'Banco Ejemplo' }))),
    'Leer comprobante (PDF)': () => geminiTexto(JSON.stringify({ monto: '60.00', cuentaDestino: '59100000077', nombreCuenta: 'Titular Ejemplo', fecha: '05/10/2026', hora: '10:02', banco: 'Banco Ejemplo' })),
    // Como el servidor: un cotejo que RESUELVE el cobro (válido, aproximado, tardío, en revisión, ya resuelto) lo cierra; «reintentar» lo deja abierto.
    'Cotejar en el servidor': (ll) => {
      const r = (o.cotejo ?? cotejoValido)(ll);
      const estado = String((r['body'] as J | undefined)?.['estado'] ?? '');
      if (r['statusCode'] === 200 && estado !== 'reintentar') {
        const tel = ll.cuerpo?.['telefono'];
        for (const [t, c] of Object.entries(cobros)) if (tel === undefined || t === String(tel)) c.pendiente = false;
      }
      return r;
    },
  };
  const mundo: Mundo = crearMundo({
    flujo: o.flujo ?? PRODUCCION,
    dobles,
    ahoraMs: AHORA,
    configBase: {
      phoneNumberIdEsperado: PID, numeroRecepcion: REC, telefonosDePrueba: ANA, ...(o.cobroSimuladoActivo !== undefined ? { cobroSimuladoActivo: o.cobroSimuladoActivo } : {}),
      ...(o.plantillas === 'aprobadas' ? PLANTILLAS_APROBADAS : {}),
      ...(o.plantillas === 'pendientes' ? { avisoComprobanteEstado: 'PENDING', avisoConsultaEstado: 'PENDING' } : {}),
      ...(o.plantillas === 'sin-nombre' ? { ...PLANTILLAS_APROBADAS, avisoComprobantePlantilla: '', avisoConsultaPlantilla: '' } : {}),
      ...(o.plantillas === 'rechazada-consulta' ? { avisoComprobanteEstado: 'APPROVED', avisoConsultaEstado: 'REJECTED' } : {}),
    },
  });
  // La ventana de Rubén: su ficha (clave = su número) guarda cuándo fue su último mensaje al bot.
  const haceMin = o.rubenEscribioHaceMin === undefined ? 5 : o.rubenEscribioHaceMin;
  if (haceMin !== null) (mundo.sd as J)['rroca'] = { [REC]: { ultimoMs: AHORA - haceMin * 60_000, turnos: 1 } };
  vigilarUx(mundo);
  return { mundo, cobro: de(ANA), cobros, de };
}
export type Mundial = ReturnType<typeof crear>;
export const hablar = (w: Mundial, from: string, msg: J, opciones: { tolerar?: boolean; avanzarMin?: number } = {}): ResultadoTurno =>
  w.mundo.turno(entrega(valorMeta(msg, from)), { ...(opciones.tolerar ? { tolerarFallo: true } : {}), ...(opciones.avanzarMin !== undefined ? { avanzarMin: opciones.avanzarMin } : {}) });

// ------------------------------------------------------------------------------ lectura de lo enviado
export const unico = (t: ResultadoTurno): ResultadoTurno['mensajes'][number] => {
  expect(t.fallo).toBeNull();
  expect(t.mensajes.filter((e) => !e.respaldo)).toHaveLength(1);
  return t.mensajes[0]!;
};
export const botones = (m: { payload: J }): { id: string; title: string }[] =>
  ((m.payload['interactive']?.action?.buttons ?? []) as J[]).map((b) => ({ id: String(b['reply']?.id), title: String(b['reply']?.title) }));
export const titulos = (m: { payload: J }): string[] => botones(m).map((b) => b.title);
export const ids = (m: { payload: J }): string[] => botones(m).map((b) => b.id);
export const eventosQr = (w: Mundial): J[] => w.mundo.llamadas.ingesta.filter((c) => c['evento'] === 'qr_enviado');
export const avisosDe = (t: ResultadoTurno): string[] => t.avisos.map((a) => a.cuerpo);
/** ¿Hay una clave `link` en algún lugar de un valor, a cualquier profundidad? */
export function tieneClaveLink(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(tieneClaveLink);
  if (v && typeof v === 'object') return Object.entries(v as J).some(([k, x]) => k.toLowerCase() === 'link' || tieneClaveLink(x));
  return false;
}
export const PROHIBIDAS = /acreditad|verificad|validad|recibimos tu pago|pago (recibido|confirmado|aprobado)|tu pago (lleg|ingres|est[aá] (list|ok))/i;
// Textos de derivación del 19/10/2026 (F5 y F): factura/garantía/devolución, otros medios de pago, reclamos y la queja de no entrega pasan con el autor.
export const D_FACTURA = 'Sobre factura, garantía o devolución puedes conversar directamente con el autor, Rubén; desde aquí no puedo prometerte nada de eso.';
export const D_OTRO = 'Eso lo ve directamente el autor, Rubén, y puedes conversarlo con él.';
export const D_NO_ENTREGA = 'Lamento la espera. Rubén revisa el pago y envía el material por este chat hasta en 6 horas; desde aquí no puedo confirmarte si ya salió.';
export const CON_AVISO = ' Le avisé; también puedes escribirle directo con el botón.';
export const SIN_AVISO = ' No pude avisarle; escríbele directo con el botón.';
// La queja de no entrega ya trae dos oraciones: el aviso va en su propio párrafo.
export const NE_CON_AVISO = '\n\nLe avisé; también puedes escribirle directo con el botón.';
export const NE_SIN_AVISO = '\n\nNo pude avisarle; escríbele directo con el botón.';
// El texto de «comprobante recibido» (cuadra, aviso salido): decisión del 19/10/2026, «hasta en 6 horas».
export const IGUAL_QUE_ANTES = 'Recibí tu comprobante y los datos coinciden con tu compra. Ya pasé tu comprobante a Rubén: él revisará el pago y te enviará los enlaces del material por este chat hasta en 6 horas.';
export const SIN_BANCO = /banco|ejemplo|titular|cuenta|\b59100000077\b/i;

// El QR de un pedido: lo que se ve y lo que se reporta.
export function pedirQr(w: Mundial, producto: keyof typeof PRELLENADOS = 'pack', de = ANA): ResultadoTurno {
  const t = hablar(w, de, mTexto(PRELLENADOS[producto]));
  expect(unico(t).tipo).toBe('image');
  return t;
}

