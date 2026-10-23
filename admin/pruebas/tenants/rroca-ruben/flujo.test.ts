/**
 * «VENTA DIGITAL DE RUBÉN» (tenant rroca-ruben) — PR-1 (el esqueleto) CON LA CONVERSACIÓN DE PR-2, DE PUNTA A PUNTA, SIN RED. El cobro y la conversación de PR-2 están en `venta.test.ts`.
 *
 * Caja negra sobre los JSON VERSIONADOS (`rroca-ruben.json`, con la entrada verificada del receptor, y `rroca-ruben.prueba.json`, con la «Entrada de prueba») corridos con el n8n de
 * mentira (`../../lib/n8n-de-mentira`): la red (verificador, consola, ingesta, Graph) son dobles; el código de los nodos es el real.
 *
 * ESTA SUITE ESCRIBE NEGANDO: la sesión es el número de origen (dos teléfonos no comparten estado), los acuses de estado no pasan, los repetidos no se cuentan dos veces, la pausa
 * («bloqueado») no envía NADA aunque el entrante sí se cuenta, una carga con `modoPrueba` adentro no activa el modo prueba, y un rechazo de Meta no se reporta como enviado.
 *
 * MENSAJES: 0 agregados (un solo mensaje por turno, o ninguno). Desde PR-2 un saludo suelto recibe el saludo fijo, una conversación libre va al modelo (aquí un doble) y un medio recibe su texto fijo. Reloj: lunes 05/10/2026, 10:00 en La Paz. Teléfonos ficticios con seis ceros.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Flujo, J } from '../../lib/flujo';
import { crearMundo, type Doble, type LlamadaDoble, type Mundo, type ResultadoTurno } from '../../lib/n8n-de-mentira';
import { vigilarUx } from './vigilante-ux';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CARPETA = join(AQUI, '../../../../Flujos/experimental/rroca-ruben');
const leerFlujo = (a: string): Flujo => JSON.parse(readFileSync(join(CARPETA, a), 'utf8')) as Flujo;
const PRODUCCION = leerFlujo('rroca-ruben.json');
const PRUEBA = leerFlujo('rroca-ruben.prueba.json');

const PID = '59100000042'; // phone_number_id del número del negocio
const ANA = '59100000011';
const BETO = '59100000022';
const REC = '59100000031'; // recepción: el WhatsApp de Rubén
const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);
const SUSPENDIDO = 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.';
const SALUDO = /^¡Hola! Qué gusto saludarte 😊 Soy el asistente virtual de Rubén\./;

// ------------------------------------------------------------------------------ mensajes entrantes
let seq = 0;
const valorMeta = (msg: J, from: string, op: { wamid?: string; phoneId?: string } = {}): J => ({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: '59100000001', phone_number_id: op.phoneId ?? PID },
  contacts: [{ profile: { name: 'Ana Pérez' }, wa_id: from }],
  messages: [{ from, id: op.wamid ?? `wamid.IN${++seq}`, timestamp: '1', ...msg }],
});
const entrega = (valor: J, id?: string): J => ({
  headers: { 'x-aab1-signature': 'v1=abc', 'x-aab1-timestamp': '1', 'x-aab1-delivery-id': id ?? `entrega-${++seq}`, 'x-aab1-attempt': '1' },
  body: { field: 'messages', value: valor },
});
const mTexto = (body: string): J => ({ type: 'text', text: { body } });
const mLista = (id: string): J => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title: 'x' } } });
const mBoton = (id: string): J => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } });
const mImagen = (): J => ({ type: 'image', image: { id: 'media-img', mime_type: 'image/jpeg', caption: 'mira' } });
const mAudio = (): J => ({ type: 'audio', audio: { id: 'media-aud', mime_type: 'audio/ogg; codecs=opus', voice: true } });
const mDocumento = (): J => ({ type: 'document', document: { id: 'media-doc', mime_type: 'application/pdf', filename: 'recibo.pdf' } });

// ------------------------------------------------------------------------------ el mundo
interface Opciones {
  flujo?: Flujo;
  /** Lo que contesta la ingesta al entrante (puede traer `atencion`). */
  ingesta?: J;
  /** La consola: un código y un cuerpo, o 'cae'. */
  panel?: { statusCode: number; body: J } | 'cae';
  /** Cómo contesta Meta: 'acepta', 'error' o 'cae' (lanza). Por nodo de envío. */
  envio?: Partial<Record<'Enviar a WhatsApp' | 'Enviar respaldo', 'acepta' | 'error' | 'lanza'>>;
  verificador?: (ll: LlamadaDoble) => J;
  /** El valor de `telefonosDePrueba` en «Config base» (por omisión, ANA y BETO). */
  telefonosDePrueba?: string;
}
// Una consola SANA (22/10/2026: un panel sin catálogo ya no es configuración) cuyos cuatro productos están agotados: no hay precios que decir, pero el flujo sí ve la configuración.
const SIN_PRODUCTOS_A_LA_VENTA = [{ id: 'pack-completo', precio: 60, agotado: true }, { id: 'libro-bonos', precio: 32, agotado: true }, { id: 'closer-ventas', precio: 20, agotado: true }, { id: 'videos-ia', precio: 25, agotado: true }];
const SIN_CONFIG = /^Ahora mismo no puedo ver la información del negocio/;
const panelOk = (extra: J = {}): { statusCode: number; body: J } => ({
  statusCode: 200,
  body: { tenantId: 'rroca-ruben', estadoComercio: 'activo', datosDelNegocio: { nombreNegocio: 'Rubén Roca' }, operacion: { numeroRecepcion: REC, prefijosPermitidos: ['591'] }, voz: { nombreAsistente: '' }, atencion: { estado: 'normal' }, catalogo: SIN_PRODUCTOS_A_LA_VENTA, venta: {}, ...extra },
});
function crear(o: Opciones = {}) {
  const envio = o.envio ?? {};
  let nEnvios = 0;
  const enviar = (nodo: 'Enviar a WhatsApp' | 'Enviar respaldo'): Doble => (ll: LlamadaDoble) => {
    const modo = envio[nodo] ?? 'acepta';
    if (modo === 'lanza') throw new Error('fetch failed: red caída');
    if (modo === 'error') return { error: { message: '(#131053) Media upload error', code: 131053 } };
    return { messaging_product: 'whatsapp', messages: [{ id: `wamid.OUT${nodo.replace(/\W+/g, '')}${++nEnvios}${ll.n}` }] };
  };
  const dobles: Record<string, Doble> = {
    'Verificar firma con el receptor': o.verificador ?? ((ll) => ({ valido: true, deliveryId: ll.cuerpo?.['deliveryId'] })),
    'Traer configuración': () => (o.panel === 'cae' ? { statusCode: 503, body: {} } : (o.panel ?? panelOk())),
    'Reportar mensaje (entrante)': () => o.ingesta ?? { ok: true },
    'Reportar mensaje (saliente)': () => ({ ok: true }),
    'Conversar con el modelo': () => ({ candidates: [{ content: { parts: [{ text: 'Cuéntame un poco más de tu negocio para orientarte mejor. ¿Qué vendes hoy?' }] } }] }),
    'Enviar aviso': () => ({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.AVISO' }] }),
    // MEDIOS ENTRANTES: Meta entrega la URL, se baja el medio y Gemini no devuelve nada utilizable (el peor caso: el cliente igual recibe una respuesta cortés).
    'Obtener URL del medio': () => ({ url: 'https://lookaside.fbsbx.com/m', mime_type: 'image/jpeg', file_size: 100_000 }),
    'Descargar medio': () => ({}),
    'Transcribir audio': () => ({}),
    'Ver imagen': () => ({}),
    'Enviar a WhatsApp': enviar('Enviar a WhatsApp'),
    'Enviar respaldo': enviar('Enviar respaldo'),
  };
  const mundo: Mundo = crearMundo({
    flujo: o.flujo ?? PRODUCCION,
    dobles,
    ahoraMs: AHORA,
    configBase: { phoneNumberIdEsperado: PID, numeroRecepcion: REC, telefonosDePrueba: o.telefonosDePrueba ?? `${ANA},${BETO}` },
  });
  // Los invariantes de UX (botones que no reaparecen, una presentación por teléfono, párrafos) vigilan también los saludos de esta suite.
  vigilarUx(mundo);
  return mundo;
}
const hablar = (m: Mundo, from: string, msg: J, op: { wamid?: string; entrega?: string; phoneId?: string; toleraFallo?: boolean } = {}): ResultadoTurno =>
  m.turno(entrega(valorMeta(msg, from, op), op.entrega), op.toleraFallo ? { tolerarFallo: true } : {});
const textos = (t: ResultadoTurno): string[] => t.mensajes.map((e) => e.cuerpo);
const enviados = (t: ResultadoTurno): number => t.mensajes.filter((e) => e.nodo === 'Enviar a WhatsApp' || e.nodo === 'Enviar respaldo').length;

describe('el saludo: uno solo, armado por código, del asistente virtual', () => {
  it('un saludo suelto recibe UN saludo fijo al mismo teléfono, que se presenta como asistente virtual, no niega serlo y no promete nada', () => {
    const w = crear();
    const t = hablar(w, ANA, mTexto('hola'));
    expect(t.fallo).toBeNull();
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]!.a).toBe(ANA);
    // Saludo corto con botones en el MISMO mensaje; sin catálogo, solo «Más información» (no se ofrece «Ver precios» sin precios).
    expect(t.mensajes[0]!.tipo).toBe('interactive');
    expect(t.mensajes[0]!.cuerpo).toMatch(SALUDO);
    expect((t.mensajes[0]!.cuerpo.match(/asistente/gi) ?? []).length).toBe(1);
    expect(t.mensajes[0]!.cuerpo.toLowerCase()).not.toMatch(/no soy (un |una )?(bot|ia|asistente|robot)|soy (una )?persona|humano/);
    // Sin catálogo en la consola no hay precios que decir: ninguna cifra de dinero.
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/\bBs\b/);
    // Se reporta con el id real de Meta, y sin llamar al modelo.
    expect(t.llamadas.ingesta.some((c) => c['direccion'] === 'saliente' && /^wamid\.OUT/.test(String(c['idMeta'])))).toBe(true);
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
  });

  it('el endpoint contesta 200 al receptor y la firma se verifica con el waba FIJO, no con lo que diga la entrega', () => {
    const w = crear();
    const llamadas: J[] = [];
    w.dobles['Verificar firma con el receptor'] = (ll) => { llamadas.push(ll.cuerpo as J); return { valido: true, deliveryId: ll.cuerpo?.['deliveryId'] }; };
    const t = hablar(w, ANA, mTexto('hola'));
    expect(t.respuestasWebhook.map((r) => r.codigo)).toEqual([200]);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!['wabaIdEsperado']).toBe('REEMPLAZAR_WABA_ID_RROCA_RUBEN');
    expect(JSON.parse(String(llamadas[0]!['cuerpo'])).value.metadata.phone_number_id).toBe(PID);
  });

  it('firma inválida: 401 y NADA más (0 mensajes, 0 ingesta, 0 consola)', () => {
    const w = crear({ verificador: () => ({ valido: false }) });
    const t = hablar(w, ANA, mTexto('hola'));
    expect(t.respuestasWebhook.map((r) => r.codigo)).toEqual([401]);
    expect(t.mensajes).toHaveLength(0);
    expect(t.llamadas.ingesta).toHaveLength(0);
    expect(t.ejecutados.has('Traer configuración')).toBe(false);
  });

  it('un 503 del verificador NO se traga: el turno falla (n8n lo reintenta), sin 401 ni mensajes', () => {
    const w = crear({ verificador: () => { throw new Error('503 Service Unavailable'); } });
    expect(() => hablar(w, ANA, mTexto('hola'))).toThrow(/Verificar firma con el receptor/);
    expect(w.llamadas.ingesta).toHaveLength(0);
  });
});

describe('la sesión es el número de origen', () => {
  it('dos teléfonos no comparten estado: cada uno tiene su ficha, sus ids y su cuenta de turnos', () => {
    const w = crear();
    hablar(w, ANA, mTexto('hola'), { wamid: 'wamid.ANA1' });
    hablar(w, BETO, mTexto('buenas'), { wamid: 'wamid.BETO1' });
    hablar(w, ANA, mTexto('otra'), { wamid: 'wamid.ANA2' });
    const fichas = w.sd['rroca'] as Record<string, J>;
    expect(Object.keys(fichas).sort()).toEqual([ANA, BETO]);
    expect(fichas[ANA]!['turnos']).toBe(2);
    expect(fichas[BETO]!['turnos']).toBe(1);
    expect(fichas[ANA]!['ultimosIds']).toEqual(['wamid.ANA1', 'wamid.ANA2']);
    expect(fichas[BETO]!['ultimosIds']).toEqual(['wamid.BETO1']);
  });

  it('el id de Meta de un teléfono NO descarta el mismo id en otro: la clave es el origen', () => {
    const w = crear();
    const a = hablar(w, ANA, mTexto('hola'), { wamid: 'wamid.COMPARTIDO' });
    const b = hablar(w, BETO, mTexto('hola'), { wamid: 'wamid.COMPARTIDO' });
    expect(a.mensajes).toHaveLength(1);
    expect(b.mensajes).toHaveLength(1);
    expect(b.mensajes[0]!.a).toBe(BETO);
  });

  it('el mensaje responde al `from`, nunca a otro campo de la carga (el nombre de perfil o el `wa_id` ajeno)', () => {
    const w = crear();
    const v = valorMeta(mTexto('hola'), ANA);
    v['contacts'] = [{ profile: { name: 'Ana' }, wa_id: BETO }];
    const t = w.turno(entrega(v));
    expect(t.mensajes.map((e) => e.a)).toEqual([ANA]);
  });

  it('un origen que no son solo dígitos (6 a 20) se descarta sin responder', () => {
    const w = crear();
    for (const raro of ['abc', '59100000011; drop', '5910']) {
      const t = hablar(w, raro, mTexto('hola'));
      expect(t.mensajes, raro).toHaveLength(0);
    }
  });

  it('un prefijo de país no permitido YA NO se descarta en silencio: recibe UN texto fijo con el botón de Rubén (modo prueba: al teléfono de prueba), y dentro del día ningún otro', () => {
    // 'Entrada de prueba' manda al teléfono de prueba; el número extranjero es solo el ORIGEN. Se prueba con la lista que lo permite.
    const w = crear({ telefonosDePrueba: `${ANA},54100000011` });
    const t = hablar(w, '54100000011', mTexto('hola'));
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]!.cuerpo).toMatch(/^Hola, soy el asistente virtual de Rubén\. El pago del libro se hace con un QR boliviano/);
    expect(t.porNodo['Interpretar entrada']![0]!['extranjero']).toBe(true);
    // Sin descarga, sin modelo, sin aviso, sin QR.
    for (const n of ['Obtener URL del medio', 'Conversar con el modelo', 'Enviar aviso', 'Ver imagen', 'Transcribir audio']) expect(t.ejecutados.has(n), n).toBe(false);
    // Dentro del día: nada (acota el costo de un barrido de números).
    expect(hablar(w, '54100000011', mTexto('hola otra vez')).mensajes).toHaveLength(0);
  });
});

describe('el filtro de eventos', () => {
  it('un acuse de estado (sin `messages`) se descarta ANTES de traer la configuración: 0 mensajes, 0 ingesta', () => {
    const w = crear();
    const acuse = { messaging_product: 'whatsapp', metadata: { phone_number_id: PID }, statuses: [{ id: 'wamid.X', status: 'delivered', recipient_id: ANA }] };
    const t = w.turno(entrega(acuse));
    expect(t.respuestasWebhook.map((r) => r.codigo)).toEqual([200]);
    expect(t.ejecutados.has('Traer configuración')).toBe(false);
    expect(t.mensajes).toHaveLength(0);
    expect(w.llamadas.ingesta).toHaveLength(0);
  });

  it('una carga con `messages` Y `statuses` a la vez tampoco pasa', () => {
    const w = crear();
    const v = valorMeta(mTexto('hola'), ANA);
    v['statuses'] = [{ id: 'wamid.X', status: 'read' }];
    expect(w.turno(entrega(v)).mensajes).toHaveLength(0);
  });

  it('un mensaje de OTRO número de la misma WABA se descarta', () => {
    const w = crear();
    const t = hablar(w, ANA, mTexto('hola'), { phoneId: '59100000099' });
    expect(t.mensajes).toHaveLength(0);
    expect(t.ejecutados.has('Traer configuración')).toBe(false);
  });

  it('un campo del receptor que no es `messages` (cambio de plantilla, de calidad) no se lee como un mensaje', () => {
    const w = crear();
    const e = entrega(valorMeta(mTexto('hola'), ANA));
    (e['body'] as J)['field'] = 'message_template_status_update';
    const t = w.turno(e);
    expect(t.mensajes).toHaveLength(0);
  });

  it('reacciones, mensajes de sistema y bienvenida no son una conversación: sin respuesta', () => {
    const w = crear();
    for (const m of [{ type: 'reaction', reaction: { message_id: 'wamid.X', emoji: '👍' } }, { type: 'system', system: { body: 'x' } }, { type: 'request_welcome' }]) {
      expect(hablar(w, ANA, m).mensajes, String(m.type)).toHaveLength(0);
    }
  });

  it('un texto vacío (solo espacios) no es una conversación', () => {
    expect(hablar(crear(), ANA, mTexto('   ')).mensajes).toHaveLength(0);
  });
});

describe('la normalización de entrada: ningún tipo rompe el flujo ni se queda sin respuesta cortés', () => {
  const SALUDO_O_MODELO = /^(¡Hola! Qué gusto saludarte 😊 Soy el asistente virtual de Rubén\.|Cuéntame un poco más)/;
  const casos: Array<[string, J, string, RegExp]> = [
    ['texto', mTexto('hola'), 'conversacion', SALUDO],
    ['toque de lista', mLista('opcion:uno'), 'conversacion', SALUDO],
    ['toque de botón', mBoton('boton:uno'), 'conversacion', SALUDO],
    ['botón de plantilla', { type: 'button', button: { text: 'Hola', payload: 'p' } }, 'conversacion', SALUDO_O_MODELO],
    ['imagen', mImagen(), 'medio', /^Recibí tu imagen/],
    ['audio', mAudio(), 'medio', /^Recibí tu nota de voz, pero no se escuchó bien/],
    ['nota de voz', { type: 'voice', voice: { id: 'media-voz' } }, 'medio', /^Recibí tu nota de voz, pero no se escuchó bien/],
    ['documento', mDocumento(), 'medio', /^Recibí tu archivo/],
    ['ubicación', { type: 'location', location: { latitude: -16.5, longitude: -68.1 } }, 'otro', /^Por aquí solo puedo leer mensajes de texto/],
    ['sticker', { type: 'sticker', sticker: { id: 'media-stk' } }, 'otro', /^Por aquí solo puedo leer mensajes de texto/],
    ['contactos', { type: 'contacts', contacts: [{ name: { formatted_name: 'X' } }] }, 'otro', /^Por aquí solo puedo leer mensajes de texto/],
    ['un pedido del catálogo', { type: 'order', order: { catalog_id: 'c', product_items: [] } }, 'otro', /^Por aquí solo puedo leer mensajes de texto/],
    ['un tipo que no existe', { type: 'holograma', holograma: {} }, 'otro', /^Por aquí solo puedo leer mensajes de texto/],
  ];
  for (const [nombre, msg, categoria, esperado] of casos) {
    it(`${nombre}: UNA respuesta cortés (${esperado.source.slice(0, 30)}…) y la categoría «${categoria}»`, () => {
      const w = crear();
      const t = hablar(w, ANA, msg);
      expect(t.fallo).toBeNull();
      expect(t.mensajes).toHaveLength(1);
      expect(t.mensajes[0]!.cuerpo).toMatch(esperado);
      expect(t.porNodo['Interpretar entrada']![0]!['categoria']).toBe(categoria);
    });
  }

  it('nunca se lee `.text.body` de lo que no es texto: un toque de botón con `text` raro no lo toma por una conversación libre', () => {
    const t = hablar(crear(), ANA, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'a b <script>', title: 'x' } }, text: { body: 'inyección' } });
    expect(t.porNodo['Interpretar entrada']![0]!['texto']).toBe('');
    expect(t.porNodo['Interpretar entrada']![0]!['texto']).not.toContain('inyección');
  });

  it('el nombre del perfil llega sin <, >, & ni saltos de línea y con 60 caracteres a lo más', () => {
    const w = crear();
    const v = valorMeta(mTexto('hola'), ANA);
    v['contacts'] = [{ profile: { name: `<b>Ana</b> & \n${'x'.repeat(100)}` }, wa_id: ANA }];
    const t = w.turno(entrega(v));
    const nombre = String(t.porNodo['Interpretar entrada']![0]!['nombrePerfil']);
    expect(nombre).not.toMatch(/[<>&\n]/);
    expect(nombre.length).toBeLessThanOrEqual(60);
  });
});

describe('los repetidos', () => {
  it('la MISMA entrega del receptor (mismo deliveryId) se descarta entre ejecuciones: un solo saludo', () => {
    const w = crear();
    const v = valorMeta(mTexto('hola'), ANA, { wamid: 'wamid.R1' });
    const a = w.turno(entrega(v, 'entrega-fija'));
    const b = w.turno(entrega(v, 'entrega-fija'));
    expect(a.mensajes).toHaveLength(1);
    expect(b.mensajes).toHaveLength(0);
    expect(b.respuestasWebhook.map((r) => r.codigo)).toEqual([200]);
  });

  it('el MISMO mensaje de Meta reenviado en OTRA entrega (otro deliveryId) lo frena la ficha: un solo saludo', () => {
    const w = crear();
    const a = hablar(w, ANA, mTexto('hola'), { wamid: 'wamid.R2', entrega: 'entrega-a' });
    const b = hablar(w, ANA, mTexto('hola'), { wamid: 'wamid.R2', entrega: 'entrega-b' });
    expect(a.mensajes).toHaveLength(1);
    expect(b.mensajes).toHaveLength(0);
    expect((w.sd['rroca'] as J)[ANA].turnos).toBe(1);
  });

  it('el reporte entrante de un repetido tampoco se repite (no cuenta dos veces en la ventana de uso)', () => {
    const w = crear();
    hablar(w, ANA, mTexto('hola'), { wamid: 'wamid.R3', entrega: 'entrega-c' });
    const antes = w.llamadas.ingesta.filter((c) => c['direccion'] === 'entrante').length;
    hablar(w, ANA, mTexto('hola'), { wamid: 'wamid.R3', entrega: 'entrega-d' });
    expect(w.llamadas.ingesta.filter((c) => c['direccion'] === 'entrante')).toHaveLength(antes);
  });
});

describe('la puerta del turno: pausa por persona, uso extendido y comercio no operativo', () => {
  const atencion = (estado: string, extra: J = {}): J => ({ ok: true, atencion: { estado, respuestasEnVentana: 30, ...extra } });

  it('PAUSA («bloqueado»): CERO envío, el entrante SÍ se cuenta, no se llama a ningún modelo y la ficha recuerda el id', () => {
    const w = crear({ ingesta: atencion('bloqueado') });
    const t = hablar(w, ANA, mTexto('hola'), { wamid: 'wamid.P1' });
    expect(t.fallo).toBeNull();
    expect(enviados(t)).toBe(0);
    expect(t.mensajes).toHaveLength(0);
    expect(t.ejecutados.has('Enviar a WhatsApp')).toBe(false);
    expect(t.ejecutados.has('Enviar respaldo')).toBe(false);
    // El entrante se reportó: sin eso la ventana de uso no cuenta.
    expect(w.llamadas.ingesta.filter((c) => c['direccion'] === 'entrante')).toHaveLength(1);
    expect(w.llamadas.ingesta.filter((c) => c['direccion'] === 'saliente')).toHaveLength(0);
    expect((w.sd['rroca'] as J)[ANA].ultimosIds).toEqual(['wamid.P1']);
    // Y una entrega repetida de la pausa tampoco responde.
    expect(hablar(w, ANA, mTexto('hola'), { wamid: 'wamid.P1' }).mensajes).toHaveLength(0);
  });

  it('PAUSA: ni el texto, ni un medio, ni un toque de botón envían nada', () => {
    const w = crear({ ingesta: atencion('bloqueado') });
    for (const m of [mTexto('hola'), mImagen(), mAudio(), mDocumento(), mBoton('boton:uno'), mLista('opcion:uno')]) {
      expect(enviados(hablar(w, ANA, m))).toBe(0);
    }
  });

  it('la pausa es por persona: otro teléfono sigue recibiendo su saludo cuando la ingesta lo deja pasar', () => {
    const w = crear();
    w.dobles['Reportar mensaje (entrante)'] = (ll) => (String(ll.cuerpo?.['telefono']) === ANA ? atencion('bloqueado') : { ok: true });
    expect(enviados(hablar(w, ANA, mTexto('hola')))).toBe(0);
    expect(enviados(hablar(w, BETO, mTexto('hola')))).toBe(1);
  });

  it('falla abierta, declarada: si la ingesta y la consola caen en el MISMO turno, la puerta devuelve «normal» y la persona en pausa recibe el saludo (PR-3 evaluará volverlo cerrado)', () => {
    // Con la ingesta sana, la pausa se respeta…
    expect(enviados(hablar(crear({ ingesta: atencion('bloqueado') }), ANA, mTexto('hola')))).toBe(0);
    // …pero sin ninguna de las dos fuentes de atención no hay estado y se contesta (comportamiento ACTUAL, fijado a propósito).
    const w = crear({ panel: 'cae', ingesta: { ok: true } });
    const t = hablar(w, ANA, mTexto('hola'));
    expect(t.fallo).toBeNull();
    expect(t.porNodo['Puerta del turno']![0]!['ruta']).toBe('sigue');
    expect(textos(t)).toHaveLength(1);
    // (22/10/2026) Sin la consola ya no hay saludo ni modelo: la persona recibe el texto honesto de «sin configuración», con el botón de Rubén.
    expect(textos(t)[0]).toMatch(SIN_CONFIG);
  });

  it('cruce declarado: «suspendido» se evalúa antes que «bloqueado»: una persona en pausa con el comercio suspendido recibe el texto neutro', () => {
    const w = crear({ ingesta: atencion('bloqueado'), panel: panelOk({ estadoComercio: 'suspendido' }) });
    expect(textos(hablar(w, ANA, mTexto('hola')))).toEqual([SUSPENDIDO]);
  });

  it('USO EXTENDIDO («operador»): UN aviso fijo (cuenta como respuesta) y nada más; sin saludo encima', () => {
    const w = crear({ ingesta: atencion('operador', { mensajeFijo: 'Una persona del equipo seguirá aquí.' }) });
    // PR-3: el texto promete atención humana, así que AVISA a Rubén (su ventana de 24 h está abierta: texto libre) y trae el botón para escribirle.
    (w.sd as J)['rroca'] = { [REC]: { ultimoMs: AHORA - 5 * 60_000, turnos: 1 } };
    const t = hablar(w, ANA, mTexto('hola'));
    expect(textos(t)).toEqual(['Una persona del equipo seguirá aquí.']);
    expect(t.mensajes[0]!.payload['interactive']?.type).toBe('cta_url');
    expect(t.avisos).toHaveLength(1);
    expect(t.avisos[0]!.a).toBe(REC);
  });

  it('el estado de la ingesta manda sobre el de la consola; sin respuesta de la ingesta, vale el de la consola', () => {
    const w = crear({ ingesta: { ok: true }, panel: panelOk({ atencion: { estado: 'bloqueado' } }) });
    expect(enviados(hablar(w, ANA, mTexto('hola')))).toBe(0);
    // La ingesta es la fuente fresca: si dice «normal» (la pausa se levantó), manda sobre la consola.
    const w2 = crear({ ingesta: atencion('normal'), panel: panelOk({ atencion: { estado: 'bloqueado' } }) });
    expect(enviados(hablar(w2, ANA, mTexto('hola')))).toBe(1);
    // Y si la ingesta bloquea, bloquea aunque la consola diga «normal».
    const w3 = crear({ ingesta: atencion('bloqueado'), panel: panelOk() });
    expect(enviados(hablar(w3, ANA, mTexto('hola')))).toBe(0);
  });

  it('COMERCIO NO OPERATIVO (409): texto neutro, sin revelar el motivo, sin saludo', () => {
    const w = crear({ panel: { statusCode: 409, body: { mensajeCortesia: 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.' } } });
    const t = hablar(w, ANA, mTexto('hola'));
    expect(textos(t)).toEqual([SUSPENDIDO]);
    expect(t.mensajes[0]!.cuerpo.toLowerCase()).not.toMatch(/deuda|pago|suspend|mora|factura/);
  });

  it('consola suspendida por estado: lo mismo; consola caída: SIN CONFIGURACIÓN (22/10/2026): no improvisa, deriva a Rubén con aviso y botón (no se queda sin responder)', () => {
    const w = crear({ panel: panelOk({ estadoComercio: 'suspendido' }) });
    expect(textos(hablar(w, ANA, mTexto('hola')))).toEqual([SUSPENDIDO]);
    const w2 = crear({ panel: 'cae' });
    const t = hablar(w2, ANA, mTexto('hola'));
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]!.cuerpo).toMatch(SIN_CONFIG);
    expect(t.mensajes[0]!.cuerpo).not.toMatch(SALUDO);
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
  });

  it('un reporte entrante de la ingesta que cortó el servicio («cortado») también cierra el turno con el texto neutro', () => {
    const w = crear({ ingesta: { ok: true, servicio: { estado: 'cortado' } } });
    expect(textos(hablar(w, ANA, mTexto('hola')))).toEqual([SUSPENDIDO]);
  });
});

describe('el orden de las ramas: el reporte entrante va ANTES que la puerta y que el saludo', () => {
  it('«Reportar mensaje (entrante)» corre antes de «Puerta del turno», de «Armar mensajes» y de «Enviar a WhatsApp»', () => {
    const t = hablar(crear(), ANA, mTexto('hola'));
    const o = t.orden;
    const i = (n: string): number => o.indexOf(n);
    expect(i('Reportar mensaje (entrante)')).toBeGreaterThanOrEqual(0);
    expect(i('Reportar mensaje (entrante)')).toBeLessThan(i('Puerta del turno'));
    expect(i('Puerta del turno')).toBeLessThan(i('Armar mensajes'));
    expect(i('Armar mensajes')).toBeLessThan(i('Enviar a WhatsApp'));
    // El resumen es lo último: corre después de los envíos.
    expect(i('Resumen del turno')).toBeGreaterThan(i('Enviar a WhatsApp'));
    expect(i('Resumen del turno')).toBeGreaterThan(i('Reportar mensaje (saliente)'));
  });
});

describe('solo se reporta como enviado lo que Meta aceptó', () => {
  it('Meta rechaza el envío: sale el MISMO texto como respaldo y se reporta SOLO el respaldo, con su id', () => {
    const w = crear({ envio: { 'Enviar a WhatsApp': 'error' } });
    const t = hablar(w, ANA, mTexto('hola'));
    expect(t.fallo).toBeNull();
    expect(t.mensajes.map((e) => e.nodo)).toEqual(['Enviar a WhatsApp', 'Enviar respaldo']);
    const salientes = w.llamadas.ingesta.filter((c) => c['direccion'] === 'saliente');
    expect(salientes).toHaveLength(1);
    expect(String(salientes[0]!['idMeta'])).toMatch(/^wamid\.OUTEnviarrespaldo/);
  });

  it('Meta rechaza el envío Y el respaldo: la ejecución termina en ERROR («Entrega fallida») y no se reporta NADA como enviado', () => {
    const w = crear({ envio: { 'Enviar a WhatsApp': 'error', 'Enviar respaldo': 'error' } });
    expect(() => hablar(w, ANA, mTexto('hola'))).toThrow(/Entrega fallida/);
    expect(w.llamadas.ingesta.filter((c) => c['direccion'] === 'saliente')).toHaveLength(0);
    const t = hablar(crear({ envio: { 'Enviar a WhatsApp': 'lanza', 'Enviar respaldo': 'lanza' } }), BETO, mTexto('hola'), { toleraFallo: true });
    expect(t.fallo?.nodo).toBe('Resumen del turno');
    expect(t.ejecutados.has('Reportar mensaje (saliente)')).toBe(false);
  });

  it('un turno sin mensaje (pausa) no es una entrega fallida: no hay nada que entregar', () => {
    const w = crear({ ingesta: { ok: true, atencion: { estado: 'bloqueado', respuestasEnVentana: 30 } }, envio: { 'Enviar a WhatsApp': 'error', 'Enviar respaldo': 'error' } });
    expect(hablar(w, ANA, mTexto('hola'), { toleraFallo: true }).fallo).toBeNull();
  });
});

describe('el modo prueba y el JSON de prueba', () => {
  const prueba = (op: J = {}): J => ({ headers: {}, body: { modoPrueba: true, telefonoDePrueba: ANA, ...op, ...valorMeta(mTexto('hola'), ANA) } });

  it('una carga de WhatsApp con `modoPrueba` adentro NO activa el modo prueba en producción (ni existe «Entrada de prueba»)', () => {
    const w = crear();
    const v = valorMeta(mTexto('hola'), ANA);
    (v['messages'] as J[])[0]!['modoPrueba'] = true;
    v['modoPrueba'] = true;
    const t = w.turno(entrega(v));
    // Sale de verdad y se reporta: no es modo prueba.
    expect(t.mensajes).toHaveLength(1);
    expect(t.porNodo['Config del negocio']![0]!['modoPrueba']).toBe(false);
    expect(w.llamadas.ingesta.some((c) => c['direccion'] === 'saliente')).toBe(true);
  });

  it('«Entrada de prueba» con enviarDeVerdad falso: el saludo NO sale a Graph, no se reporta y el resumen lo devuelve', () => {
    const w = crear({ flujo: PRUEBA });
    const t = w.turno(prueba({ enviarDeVerdad: false }));
    expect(t.fallo).toBeNull();
    expect(t.ejecutados.has('Enviar a WhatsApp')).toBe(false);
    expect(w.llamadas.ingesta).toHaveLength(0);
    const r = t.resumen as J;
    expect(r['modoPrueba']).toBe(true);
    expect(r['mensajes']).toHaveLength(1);
    expect(r['mensajes'][0].texto).toMatch(SALUDO);
    // En prueba el destino es el teléfono de prueba.
    expect(r['mensajes'][0].payload.to).toBe(ANA);
  });

  it('el modo prueba NIEGA POR DEFECTO: sin `telefonosDePrueba` (vacío o con el marcador) no sale nada, ni al teléfono pedido, y el resumen dice 0 mensajes', () => {
    for (const lista of ['', 'REEMPLAZAR_TELEFONOS_DE_PRUEBA']) {
      const w = crear({ flujo: PRUEBA, telefonosDePrueba: lista });
      const t = w.turno(prueba({ enviarDeVerdad: true }));
      expect(t.fallo).toBeNull();
      expect(t.porNodo['Config del negocio']![0]!['telefonoDePrueba']).toBe('');
      expect(t.porNodo['Config del negocio']![0]!['enviarDeVerdad']).toBe(false);
      expect(t.ejecutados.has('Enviar a WhatsApp')).toBe(false);
      expect(w.llamadas.ingesta).toHaveLength(0);
      expect((t.resumen as J)['mensajes']).toHaveLength(0);
    }
  });

  it('`resumen.mensajes` se calcula DESPUÉS de decidir el número: con la lista restrictiva y un teléfono no permitido, dice 0 y no hay mensaje', () => {
    const w = crear({ flujo: PRUEBA, telefonosDePrueba: REC });
    const t = w.turno(prueba({ enviarDeVerdad: false, telefonoDePrueba: ANA }));
    expect(t.fallo).toBeNull();
    expect((t.resumen as J)['mensajes']).toHaveLength(0);
    const armado = t.porNodo['Armar mensajes']![0]!;
    expect(armado['sinMensajes']).toBe(true);
    expect((armado['resumen'] as J)['mensajes']).toBe(0);
    // Y con el teléfono en la lista, sale 1 y el resumen dice 1.
    const w2 = crear({ flujo: PRUEBA, telefonosDePrueba: ANA });
    const t2 = w2.turno(prueba({ enviarDeVerdad: false, telefonoDePrueba: ANA }));
    expect(((t2.porNodo['Armar mensajes']![0]!['resumen']) as J)['mensajes']).toBe(1);
    expect((t2.resumen as J)['mensajes']).toHaveLength(1);
  });

  it('en modo prueba el `phone_number_id` del cuerpo se ignora y el destino es solo el teléfono de prueba', () => {
    const w = crear({ flujo: PRUEBA });
    const t = w.turno(prueba({ enviarDeVerdad: false, telefonoDePrueba: BETO }));
    expect((t.resumen as J)['mensajes'][0].payload.to).toBe(BETO);
  });
});
