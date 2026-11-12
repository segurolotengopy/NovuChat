/**
 * RESPUESTA COHERENTE DE «VENTA MÍNIMA» (Q'Taco, 12/11/2026): lo que el asistente contesta cuando el cliente dice algo fuera de protocolo.
 *
 * El arnés es el de `venta-minima-integracion.test.ts` (las seis librerías REALES, los nodos de la ruta del turno, sin dobles) más la marca `+coherente`
 * de `construir.mjs`: el filtro común de la redacción y `core/conversacion/respuesta-coherente.js` delante de «Decidir turno» y «Plan del turno».
 * Lo único simulado es lo que está fuera de código: el panel y el modelo (`Extraer`). Teléfonos sintéticos, con seis ceros.
 *
 * Se prueba NEGANDO: ningún mensaje de la batería (32) es el menú de siempre, el «no te entendí» ni el genérico; los acuses no llevan botones ni llaman al modelo; el
 * seguimiento trae el pedido REAL y jamás su estado de despacho, sin aviso; lo que el modelo escribe pasa por el filtro (pago acreditado, promesas, «en camino»,
 * montos, enlaces, negar ser IA, prohibidos del tenant) y, si no pasa o el modelo cae, sale el texto fijo con botón; el número de mensajes es el mismo que con la
 * función apagada; y con `activo: false` o sin la clave TODAS las salidas son idénticas a las de siempre.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar, type J, type Referencias } from './lib/flujo';
import { asentarCupos, comprometer, consumirCupos, crearSesion, leerSesion, type SesionDeMentira } from './lib/venta-minima-sesion';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/venta-minima/src');
const leer = (r: string): string => readFileSync(join(RAIZ, r), 'utf8');
const LIBRERIAS = ['comun', 'pedido', 'reserva', 'promos', 'avisos', 'cobro'].map((n) => leer(`lib/${n}.js`));
// El módulo común de Pedidos (qr-del-pedido.js) va detrás de las librerías propias, como lo arma construir.mjs.
const PQR = readFileSync(join(RAIZ, '../../../src/modulos/pedidos/qr-del-pedido.js'), 'utf8');
// El estado de la conversación en el servidor (PR-4a): el módulo común `sesion` lo incluyen los nodos que lo usan, como arma construir.mjs.
const SESION = readFileSync(join(RAIZ, '../../comun-sin-agente/src/sesion.js'), 'utf8');
// Y el reconocedor de anuncios por titular (core/medios), también incluido por construir.mjs.
const APT = readFileSync(join(RAIZ, '../../../src/core/medios/anuncio-por-titular.js'), 'utf8');
const LIBS = [...LIBRERIAS, PQR, APT].join('\n');
// La respuesta coherente (core): la pieza `rc*` SOLA (ya no usa el filtro común), DESPUÉS de las librerías y ANTES del nodo (la marca `+coherente` de construir.mjs).
const COHERENTE = ['core/conversacion/respuesta-coherente.js'].map((r) => readFileSync(join(RAIZ, '../../../src', r), 'utf8')).join('\n');
const CON_COHERENTE = ['decidir-turno', 'plan-del-turno'];
const CODIGO: Record<string, string> = {};
const CON_SESION = ['config-del-negocio', 'armar-avisos', 'armar-mensajes', 'soltar-mensajes'];
for (const n of ['carga-de-entrada', 'config-del-negocio', 'interpretar-entrada', 'interpretar-lectura', 'decidir-turno', 'plan-del-turno', 'armar-avisos', 'armar-mensajes', 'soltar-mensajes', 'sin-estado']) {
  CODIGO[n] = `${LIBS}\n${CON_SESION.includes(n) ? `${SESION}\n` : ''}${CON_COHERENTE.includes(n) ? `${COHERENTE}\n` : ''}${leer(`nodos/${n}.js`)}`;
}

const AHORA = Date.UTC(2026, 9, 5, 14); // lunes 05/10/2026, 10:00 en La Paz
const MIN = 60 * 1000;
const HORA = 60 * MIN;
const CLIENTE = '59100000011';
const CLIENTE_LEGIBLE = '+591 '+ CLIENTE.slice(3, 7) + ' ' + CLIENTE.slice(7); // formato de las variables y del detalle
const OTRO = '59100000012';
const AV1 = '59100000021'; // Andres (rol completo)
const AV2 = '59100000022'; // Silvana (rol cocina)
const REC = '59100000031'; // número de recepción
const PNID = 'pnid-de-prueba';
const QR = 'https://almacen.ejemplo.test/qr/qtaco.png';

function relojFijo(ms: number): unknown {
  return class extends Date {
    constructor(...a: unknown[]) { if (a.length === 0) super(ms); else super(...(a as [number])); }
    static override now(): number { return ms; }
  };
}

// --- El mundo de fuera del código ---------------------------------------------------------------
const CATALOGO = [
  { id: 'i1', nombre: 'Orden de 3 tacos de birria', precio: 55, area: 'Tacos' },
  { id: 'i2', nombre: 'Taco de birria (unidad)', precio: 21, area: 'Tacos' },
  { id: 'i3', nombre: 'Queso fundido con chorizo', precio: 40, area: 'Entradas' },
  { id: 'i4', nombre: 'Cerveza artesanal', precio: 20, area: 'Bebidas' },
  { id: 'i5', nombre: 'Nachos con queso', precio: 35, area: 'Entradas' },
  { id: 'i6', nombre: 'Guacamole con totopos', precio: 30, area: 'Entradas' },
  { id: 'i7', nombre: 'Elote asado', precio: 15, area: 'Entradas' },
  { id: 'i8', nombre: 'Quesadilla de pollo', precio: 28, area: 'Platos' },
  { id: 'i9', nombre: 'Quesadilla de hongos', precio: 26, area: 'Platos' },
  { id: 'i10', nombre: 'Burrito de res', precio: 38, area: 'Platos' },
  { id: 'i11', nombre: 'Burrito vegetariano', precio: 33, area: 'Platos' },
  { id: 'i12', nombre: 'Flan de la casa', precio: 18, area: 'Postres' },
  { id: 'i13', nombre: 'Churros con dulce de leche', precio: 22, area: 'Postres' },
  { id: 'i14', nombre: 'Ensalada fresca', precio: 25, area: 'Platos' },
];

/** El cuerpo de `configuracionFlujo`. Por omisión, SIN las claves de modalidad en `venta` (R1) y sin cobro real. */
function panel(cambios: J = {}): J {
  return {
    tenantId: 'tenant-de-prueba', estadoComercio: 'activo',
    datosDelNegocio: { nombreNegocio: "Q' Taco de prueba", direccion: 'Av. Ejemplo 123' },
    operacion: { moneda: 'BOB', numeroRecepcion: REC, horarioAtencion: 'todos los días de 9:00 a 22:00', prefijosPermitidos: ['591'] },
    voz: { nombreAsistente: '', nivelEmojis: 'pocos' },
    venta: {},
    catalogo: CATALOGO,
    campanas: [],
    cobro: { activo: false },
    atencion: { estado: 'normal' },
    ...cambios,
  };
}
/** El panel con cobro real: el QR, la cuenta y, si hay un QR esperando comprobante, su pedido. */
const conCobro = (pendiente?: { pedido: string; monto: number }, cambios: J = {}): J => panel({
  cobroReal: { nombreCuenta: 'Titular de Prueba SRL', banco: 'Banco de Prueba' },
  cobro: { activo: true, qr: { url: QR }, pendiente: !!pendiente, monto: pendiente?.monto ?? null, pedido: pendiente?.pedido ?? null },
  ...cambios,
});

const HORARIO = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'].map((d) => `${d}=09:00-22:00`).join(',');
/** «Config base»: lo que el cliente deja en el flujo (los nombres de plantilla viven acá, no en el código). */
const BASE: J = {
  nombreNegocio: "Q' Taco de prueba", pedidosActivo: true, reservasActivo: true, promosActivo: false,
  areasExcluidas: '', areasSinDelivery: 'Bebidas', zonasReserva: 'salón,terraza',
  horario: HORARIO, maxPersonasReserva: 10, anticipacionReservaMin: 60, maxDiasReserva: 30, topeReservasDia: 3,
  topeAvisosDia: 150, topeTransferenciasHora: 1, topePedidosHora: 6,
  destinatariosAviso: `completo:${AV1}:Andres,cocina:${AV2}:Silvana`,
  plantillaPedido: 'plantilla_pedido_x', idiomaPlantillaPedido: 'es',
  plantillaReserva: 'plantilla_reserva_x', idiomaPlantillaReserva: 'es',
  plantillaDerivacion: 'plantilla_derivacion_x', idiomaPlantillaDerivacion: 'es',
  phoneNumberIdEsperado: PNID, waGraphVersion: 'v26.0', respaldoNumeroRecepcion: REC,
};
const sinClaves = (...claves: string[]): J => Object.fromEntries(Object.entries(BASE).filter(([k]) => !claves.includes(k)));

interface Mundo { g: J; base: J; panel: J; ahora: number; n: number; codigoPanel: number; sesion: SesionDeMentira }
const crear = (o: { base?: J; panel?: J; ahora?: number } = {}): Mundo => {
  const m: Mundo = { g: {}, base: o.base ?? BASE, panel: o.panel ?? panel(), ahora: o.ahora ?? AHORA, n: 0, codigoPanel: 200, sesion: undefined as unknown as SesionDeMentira };
  m.sesion = crearSesion({ pid: PNID, ahora: () => m.ahora });
  return m;
};
/** Los datos estáticos que SIGUEN en n8n (residuo de PR-4b: marcas de aviso, contador diario, reservas del día). El estado y los pedidos viven en el servidor (`m.sesion`). */
const sdDe = (m: Mundo): J => (m.g['ventaMinima'] ??= {});
const estadoDe = (m: Mundo, from = CLIENTE): J => m.sesion.estado(from);
const pedidosDe = (m: Mundo, from = CLIENTE): J => m.sesion.pedidos(from);

const OK = (i = 1): J => ({ messaging_product: 'whatsapp', contacts: [{ wa_id: AV1 }], messages: [{ id: `wamid.AVISO${i}` }] });
const FALLA: J = { error: { message: 'Graph rechazó el envío', code: 131030 } };
const gemini = (o: J): J => ({ content: { parts: [{ text: JSON.stringify(o) }] } });
/** La otra forma de la respuesta de Gemini (`generateContent` sin simplificar): `candidates[0].content.parts`. */
const geminiCandidates = (o: J): J => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] });

interface Entrada {
  from?: string; nombrePerfil?: string; tipo?: 'text' | 'interactive' | 'image' | 'location' | 'audio';
  texto?: string; boton?: string; mediaId?: string; ubicacion?: J;
  /** Cambia la decisión de `Decidir turno` antes del plan (para probar la defensa en profundidad del plan). */ decision?: (d: J) => J;
  /** Lo que devuelve el modelo (`Extraer`). */ extraccion?: J;
  /** La salida CRUDA de `Extraer` (error 500, JSON roto, forma rara): se usa tal cual. */ extraerCrudo?: J;
  /** La respuesta de Gemini con la forma `candidates` en vez de `content`. */ candidates?: boolean;
  /** La salida cruda del modelo que lee el comprobante: pasa por el nodo `Interpretar lectura` real. */ lecturaGemini?: J;
  /** La respuesta del servidor de cobro (`Cotejar en el servidor`). */ cotejo?: J;
  /** La lectura del comprobante (`Interpretar lectura`). */ lectura?: J;
  /** Las respuestas de Graph a los avisos armados; por omisión todos salen bien. */ envio?: (armados: J[]) => J[];
  /** Cuánto se adelanta el reloj antes de este turno. */ despues?: number;
  /** El carrito del catálogo web (cuerpo ya validado por `Carga de entrada`): el turno entra como `type: 'carrito'`. */ carrito?: J;
  /** Cambia el plan que sale de `Plan del turno` antes de armar avisos y mensajes (para probar `Armar mensajes` con un plan que el código real no produce). */ plan?: (p: J) => J;
}
interface Salida {
  descartado: boolean; t: J; d: J; p: J; cfg: J; avisos: J[]; armados: J[]; enviados: J[]; mensajes: J[]; tiempoMs: number;
}

/** Un turno entero, nodo por nodo, con las seis librerías reales. */
function turno(m: Mundo, e: Entrada = {}): Salida {
  if (e.despues) m.ahora += e.despues;
  m.n += 1;
  const ini = performance.now();
  const from = e.from ?? CLIENTE;
  const tipo = e.tipo ?? (e.boton ? 'interactive' : 'text');
  const msg: J = { from, id: `wamid.ENTRANTE${m.n}`, type: tipo, timestamp: String(Math.floor(m.ahora / 1000)) };
  if (tipo === 'text') msg['text'] = { body: e.texto ?? '' };
  else if (tipo === 'interactive') msg['interactive'] = { type: 'button_reply', button_reply: { id: e.boton ?? '', title: e.texto ?? 'Botón' } };
  else if (tipo === 'image') msg['image'] = { id: e.mediaId ?? 'media-1', mime_type: 'image/jpeg', caption: e.texto ?? '' };
  else if (tipo === 'location') msg['location'] = e.ubicacion ?? {};
  else if (tipo === 'audio') msg['audio'] = { id: e.mediaId ?? 'audio-1', mime_type: 'audio/ogg' };
  const evento: J = {
    messaging_product: 'whatsapp', metadata: { phone_number_id: PNID },
    contacts: [{ profile: { name: e.nombrePerfil ?? 'Ana Pérez' }, wa_id: from }], messages: [msg],
  };
  const globales = { $getWorkflowStaticData: () => m.g, Date: relojFijo(m.ahora), $execution: { id: `e${m.n}` } };
  const correr = (nodo: string, entradas: J[], refs: Referencias): J[] => ejecutar(CODIGO[nodo]!, entradas, refs, globales);

  let [carga] = correr('carga-de-entrada', [evento], {}) as [J];
  // El carrito web no es un mensaje de WhatsApp: llega por su propio webhook y `Carga de entrada` lo deja como un mensaje sintético
  // con `carritoWeb: true` (la validación del cuerpo se prueba en las suites del catálogo; acá se parte del resultado).
  if (e.carrito) {
    carga = { ...carga, carritoWeb: true, messages: [{ from, id: `carrito:${e.carrito['pedidoId']}`, timestamp: String(Math.floor(m.ahora / 1000)), type: 'carrito', carrito: e.carrito }] };
  }
  // El `leer` de la sesión viaja en la respuesta de configuración (con el id del mensaje: de ahí sale el repetido).
  const cuerpoPanel = m.codigoPanel === 200 ? { ...m.panel, ...leerSesion(m.sesion, from, String(((carga['messages'] as J[] | undefined) ?? [])[0]?.['id'] ?? ''), `e${m.n}`) } : {};
  const [cfg] = correr('config-del-negocio', [{ statusCode: m.codigoPanel, body: cuerpoPanel }], { 'Config base': m.base, 'Carga de entrada': carga }) as [J];
  const refs: Referencias = { 'Carga de entrada': carga, 'Config base': m.base, 'Config del negocio': cfg };
  if (e.carrito) refs['Traer configuración'] = { statusCode: m.codigoPanel, body: m.codigoPanel === 200 ? m.panel : {} };
  const entrada = correr('interpretar-entrada', [{}], refs);
  const vacio: Salida = { descartado: true, t: {}, d: {}, p: {}, cfg, avisos: [], armados: [], enviados: [], mensajes: [], tiempoMs: 0 };
  if (!entrada.length) return { ...vacio, tiempoMs: performance.now() - ini };
  const t = entrada[0]!;
  refs['Interpretar entrada'] = t;
  if (e.cotejo) refs['Cotejar en el servidor'] = e.cotejo;
  if (e.lectura) refs['Interpretar lectura'] = e.lectura;
  if (e.lecturaGemini) refs['Interpretar lectura'] = correr('interpretar-lectura', [e.lecturaGemini], refs)[0]!;
  // `¿Hay estado?`: sin una conversación válida del servidor no se sabe en qué paso va el cliente y sale el genérico con el botón («Sin estado»).
  const hayEstado = (cfg['sesion'] as J | undefined)?.['ok'] === true;
  let d: J = {};
  let p: J;
  if (hayEstado) {
    [d] = correr('decidir-turno', [{}], refs) as [J];
    if (e.decision) d = e.decision(d);
    refs['Decidir turno'] = d;
    if (String(d['accion']).startsWith('extraer') && (e.extraccion || e.extraerCrudo)) refs['Extraer'] = e.extraerCrudo ?? (e.candidates ? geminiCandidates : gemini)(e.extraccion!);
    [p] = correr('plan-del-turno', [{}], refs) as [J];
    if (e.plan) p = e.plan(p);
    refs['Plan del turno'] = p;
  } else {
    [p] = correr('sin-estado', [{}], refs) as [J];
    refs['Sin estado'] = p;
  }
  const avisos = correr('armar-avisos', [{}], refs);
  refs['Armar avisos'] = avisos;
  const armados = avisos.filter((i) => i['sinAviso'] !== true && i['payload']);
  // PR-4b: «Consumir cupos» (una llamada por turno, con el cuerpo que armó «Armar avisos»); solo `cupo_negado` impide los avisos.
  const consumo = armados.length ? consumirCupos(m.sesion, avisos[0]!['cupos'] as J | null) : undefined;
  if (consumo) refs['Consumir cupos'] = consumo;
  const negado = ((consumo?.['body'] ?? {}) as J)['resultado'] === 'cupo_negado';
  const enviados = armados.length && !negado ? (e.envio ?? ((a: J[]) => a.map((_, i) => OK(i + 1))))(armados) : [];
  if (armados.length && !negado) refs['Enviar aviso'] = enviados;
  // «Armar mensajes» arma el bloque y pide el compromiso ANTES de enviar; el servidor de mentira contesta y «Soltar mensajes» decide qué sale.
  const armado = correr('armar-mensajes', [{}], refs)[0]!;
  refs['Armar mensajes'] = armado;
  const respuesta = comprometer(m.sesion, armado['compromiso'] as J | null);
  if (respuesta) refs['Comprometer turno'] = respuesta;
  const mensajes = correr('soltar-mensajes', [{}], refs);
  // PR-4b: el cupo se devuelve si el servidor lo concedió y ningún aviso fue aceptado (lo manda «Confirmar envío» por «Comprometer compensación»).
  asentarCupos(m.sesion, mensajes[0]?.['asentar'] as J | null);
  return { descartado: false, t, d, p, cfg, avisos, armados, enviados, mensajes, tiempoMs: performance.now() - ini };
}

// --- Lectura de resultados ------------------------------------------------------------------------
const cuerpoDe = (j: J): string => {
  const pl = (j['payload'] ?? {}) as J;
  if (pl['text']) return String(pl['text'].body);
  if (pl['interactive']) return String(pl['interactive'].body.text);
  if (pl['image']) return String(pl['image'].caption);
  return '';
};
const clientes = (s: Salida): J[] => s.mensajes.filter((j) => j['sinMensajes'] !== true);
const cuerpos = (s: Salida): string[] => clientes(s).map(cuerpoDe);
const botonesDe = (j: J): string[] => ((j['payload']?.interactive?.action?.buttons ?? []) as J[]).map((b) => String(b['reply'].id));
const params = (j: J): string[] => j['payload'].template.components[0].parameters.map((x: J) => String(x.text));
const plantillas = (s: Salida): J[] => s.armados.filter((i) => i['payload'].type === 'template');
const errores = (s: Salida): string[] => (s.mensajes[0]?.['errores'] ?? []) as string[];
const erroresAvisos = (s: Salida): string[] => (s.avisos[0]?.['errores'] ?? []) as string[];
/** El pin nativo de WhatsApp (07/11/2026: en delivery la ubicación compartida es obligatoria, además de la dirección escrita). */
const PIN = { tipo: 'location', ubicacion: { latitude: -16.5, longitude: -68.15 } } as const;
const PROHIBIDAS = /validad|confirmad|pagad[oa]|acreditad|verificad|recibimos\s+tu\s+pago|ya lo prepar|lo (est[aá](n|mos)|estoy) prepar|lo preparamos|te avisa(mos|remos)|en camino|te llama(mos|remos)|te escribir[aá]n|lo consulto|acredit|recib\S{0,40}\s+(tu|el|su|mi|un|este|ese|la|tus|sus|los)\s+(pago|transferencia|dep[oó]sito|abono)s?|lleg[oó]\s+(tu|el|su|mi)\s+(pago|transferencia|dep[oó]sito|abono)|(tu|el|su|mi)\s+(pago|transferencia|dep[oó]sito|abono)s?\s+(ya\s+)?(lleg|ingres|entr)(o|ó|aron)\b|(pago|transferencia|dep[oó]sito|abono)s?\s+(ya\s+|fue\s+|fueron\s+|est[aá]\s+)?(recibid|aprobad|[eé]xitos|realizad|registrad|llegad|ingresad|efectuad)|confirm(amos|ó|o)\s+(tu|tus|su|sus|la|el|lo|los|las)\b|\b(?:est[aá]n?|qued[oó]|queda|quedan|quedaron|fue|fueron|ya)\s+(?:ya\s+)?reservad|reserva\s+((est[aá]|qued[oó])\s+)?(registrad|agendad)|reservamos tu|\b(?:te|le|les|se|lo|la|ya)\s+confirm(?:o|amos|é|ó|aron)\b|gracias\s+por\s+(tu|su|el)\s+(pago|transferencia|dep[oó]sito|abono)s?|\b(lleg|ingres|entr)(o|ó|aron)\s+(tu|tus|el|los|su|sus|mi|la|las)\s+(pago|transferencia|dep[oó]sito|abono|dinero|plata|monto)|\b(tu|tus|el|los|su|sus|mi|la|las)\s+(pago|transferencia|dep[oó]sito|abono|dinero|plata|monto)s?\s+(ya\s+)?(lleg|ingres|entr)(o|ó|aron)\b|\brecib(imos|i|í|ido)\s+(el|la|tu|su)\s+(dinero|plata|monto)|(pago|transferencia|dep[oó]sito|abono|cobro)s?\s+(ya\s+|fue\s+|fueron\s+|est[aá]\s+|qued[oó]\s+|se\s+)?(ya\s+)?(recibid|aprobad|[eé]xitos|realizad|registrad|llegad|ingresad|efectuad|aceptad|completad|procesad|reflejad|comprobad)|\breflej(o|ó)\s+(tu|el|su)\s+(pago|transferencia|dep[oó]sito|abono)|\b(verificamos|comprobamos|validamos|aceptamos|tenemos|vimos|cobramos)\s+(tu|tus|su|sus|el|la)\s+(pago|transferencia|dep[oó]sito|abono|dinero|plata)|\bpago\s+(listo|ok)\b|\b(tu|su|el)\s+pago\s+(ya\s+)?(est[aá]|qued[oó])\s+(ya\s+)?(listo|ok|en\s+orden|bien|correcto|completo|hecho)\b|en\s+orden\s+con\s+(tu|su|el)\s+pago|\bsaldad[oa]s?\b|\b(pedido|cuenta|pago|total|orden|deuda)s?\s+((ya\s+)?(est[aá]n?|qued[oó]|fue|queda)\s+)?(ya\s+)?cancelad[oa]s?\b|\bya\s+nos\s+pag(aste|o|ó|aron)\b|\bgracias\s+por\s+pagar\b|\bya\s+pagaste\W{0,3}\s*(muchas\s+)?gracias|\brecib(imos|i|í|ido)\s+(bs\.?\s*|bob\s*)?\d+([.,]\d+)?\s*(bs|bob|bolivianos)\b|\bconfirm(amos|e|é)\s+que\s+(ya\s+)?pag|(pago|transferencia|dep[oó]sito|abono)s?\s+(ya\s+)?se\s+reflej/i;

/** Lleva a `from` hasta el resumen de un pedido: 1 orden de tacos, delivery con dirección y referencia (o recojo). */
function hastaResumen(m: Mundo, modalidad: 'delivery' | 'recojo' = 'delivery', from = CLIENTE, conPin = true): Salida {
  turno(m, { from, texto: 'hola' });
  turno(m, { from, texto: 'quiero 1 orden de tacos de birria', extraccion: {
    lineas: [{ producto: 'tacos de birria', cantidad: 1, forma: 'orden', detalle: '' }], entrega: modalidad, direccion: '', referencia: '', nombre: '',
  } });
  if (modalidad === 'recojo') return turno(m, { from, boton: 'e|recojo' });
  const dir = turno(m, { from, texto: 'Calle Falsa 123, portón azul', extraccion: {
    lineas: [], entrega: 'delivery', direccion: 'Calle Falsa 123', referencia: 'portón azul', nombre: 'Ana Pérez',
  } });
  if (!conPin) return dir; // solo la dirección escrita: falta la ubicación (el mensaje que la pide)
  // 07/11: en delivery la dirección escrita no basta; el resumen llega con la ubicación compartida (el pin).
  return turno(m, { from, tipo: 'location', ubicacion: { latitude: -16.5, longitude: -68.15 } });
}


// =================================================================================================
// El dato del tenant (lo que versiona `admin/scripts/datos/respuesta-libre/qtaco.json`) y el panel que lo trae.
const RL: J = {
  activo: true,
  acuse: '¡Gracias a ti! 🌮 Aquí estoy si necesitas algo más.',
  textoSeguimiento: 'El seguimiento del pedido lo hace directamente el local. Si quieres consultarlo, toca «Escribir al local».',
  textoRechazo: 'Eso no lo puedo responder por aquí.',
  textoHumor: '¡Jaja! 🌮 Mejor te cuento qué te puedo ofrecer.',
  textoQueja: 'Lamento que hayas tenido esa experiencia. Si quieres contárselo al local, toca «Escribir al local».',
};
const mundoCon = (rl: J | null = RL): Mundo => crear({ panel: panel(rl ? { respuestaLibre: rl } : {}) });
/** Un mundo con un pedido de recojo YA pasado al local (confirmado sin QR): el cliente puede preguntar por él. */
function mundoConPedido(rl: J | null = RL): { m: Mundo; pedido: J } {
  const m = mundoCon(rl);
  hastaResumen(m, 'recojo');
  const c = turno(m, { boton: 'p|confirmar' });
  expect(c.p['ruta']).toBe('pedido:sin_qr');
  const pedido = Object.values(pedidosDe(m)).find((p) => (p as J)['resultado']) as J;
  expect(pedido).toBeTruthy();
  return { m, pedido };
}
/** Lo que el modelo (simulado) devolvería: SOLO una intención del enum. */
const modelo = (intencion: string): J => ({ intencion });

// Lo que NUNCA debe salir de un mensaje fuera de protocolo (el respaldo literal de hoy).
const MENU_AHORA = '¿Qué te gustaría hacer ahora?';
const MENU_DE_NUEVO = '¡Hola de nuevo! 👋 ¿Qué te gustaría hacer?';
const NO_TE_ENTENDI = 'Disculpa, no te entendí bien';
const GENERICO = 'Disculpa, eso no lo puedo resolver por aquí 🙏';
const sinRespaldoLiteral = (s: Salida): void => {
  const todo = cuerpos(s).join('\n');
  for (const malo of [MENU_AHORA, MENU_DE_NUEVO, NO_TE_ENTENDI, GENERICO]) expect(todo).not.toContain(malo);
};
const DESPACHO = /sali[oó]|en camino|ya llega|est[aá] listo|lo (est[aá]n|estoy) preparando/i;
const IDS_DEL_MENU = ['m|pedido', 'm|reserva', 'm|promos'];
const botonesDelPrimero = (s: Salida): string[] => botonesDe(clientes(s)[0]!);

// =================================================================================================
describe('A. acuses (6): una frase fija, sin menú, sin modelo y sin tocar el estado', () => {
  it.each(['gracias', 'ok', 'muchas gracias', '👍', 'perfecto', 'listo, gracias'])('«%s» en el menú', (texto) => {
    const m = mundoCon();
    turno(m, { texto: 'hola' });
    const antes = estadoDe(m)['paso'];
    const s = turno(m, { texto });
    expect(s.d['accion']).toBe('acuse');
    expect(s.d['cuerpoExtraccion']).toBeNull(); // 0 llamadas a «Extraer»
    expect(cuerpos(s)).toEqual([RL['acuse']]);
    expect(clientes(s)).toHaveLength(1);
    expect(botonesDelPrimero(s)).toEqual([]); // sin ids m|pedido, m|reserva, m|promos
    for (const id of IDS_DEL_MENU) expect(JSON.stringify(clientes(s))).not.toContain(id);
    expect(s.p['aviso']).toBeNull();
    expect(s.armados).toHaveLength(0);
    expect(s.p['ruta']).toBe('acuse');
    expect(estadoDe(m)['paso']).toBe(antes);
    sinRespaldoLiteral(s);
  });
  it('también como primer mensaje de la conversación (no pasa a menú ni saluda)', () => {
    const m = mundoCon();
    const s = turno(m, { texto: 'gracias' });
    expect(s.d['accion']).toBe('acuse');
    expect(cuerpos(s)).toEqual([RL['acuse']]);
  });
  it('NEGADO: «ok, quiero 2 tacos» no es un acuse y sigue su camino de siempre', () => {
    const m = mundoCon();
    turno(m, { texto: 'hola' });
    const s = turno(m, { texto: 'ok, quiero 2 tacos', extraccion: { lineas: [{ producto: 'tacos de birria', cantidad: 2, forma: 'unidad', detalle: '' }] } });
    expect(s.d['accion']).toBe('extraer_pedido');
  });
  it.each(['ok?', 'listo?', 'de', 'mil', 'de de', 'ya llegó mi pedido', 'ya llegó', 'llegó'])('NEGADO: «%s» no es acuse ni seguimiento', (texto) => {
    const m = mundoCon();
    turno(m, { texto: 'hola' });
    const s = turno(m, { texto, extraccion: { lineas: [] } });
    expect(['acuse', 'seguimiento']).not.toContain(s.d['accion']);
  });
  it('NEGADO: tras «Cambiar algo» (carrito vacío y `carritoAnterior`), «dale» no es acuse', () => {
    const m = mundoCon();
    hastaResumen(m, 'recojo');
    turno(m, { boton: 'p|cambiar' });
    expect(estadoDe(m)['carritoAnterior']).toBeTruthy();
    const s = turno(m, { texto: 'dale', extraccion: { lineas: [] } });
    expect(s.d['accion']).not.toBe('acuse');
    const apagada = mundoCon({ ...RL, activo: false });
    hastaResumen(apagada, 'recojo');
    turno(apagada, { boton: 'p|cambiar' });
    const base = turno(apagada, { texto: 'dale', extraccion: { lineas: [] } });
    expect(cuerpos(s)).toEqual(cuerpos(base));
  });
  it('sin acuse configurado, «Con gusto.»', () => {
    const m = mundoCon({ activo: true });
    turno(m, { texto: 'hola' });
    expect(cuerpos(turno(m, { texto: 'gracias' }))).toEqual(['Con gusto.']);
  });
  it('NEGADO: con un QR esperando comprobante, «gracias» no se contesta como acuse (rige el recordatorio)', () => {
    const m = crear({ panel: conCobro(undefined, { respuestaLibre: RL }) });
    hastaResumen(m, 'recojo');
    turno(m, { boton: 'p|confirmar' });
    expect(estadoDe(m)['paso']).toBe('esperando_comprobante');
    const s = turno(m, { texto: 'gracias' });
    expect(s.d['accion']).not.toBe('acuse');
    expect(estadoDe(m)['paso']).toBe('esperando_comprobante');
  });
});

// =================================================================================================
describe('B. seguimiento (6): el pedido real, sin estado de despacho, con botón y sin aviso', () => {
  it.each(['¿ya salió mi pedido?', '¿cuánto demora?', 'cómo va mi pedido'])('con un pedido ya pasado: «%s»', (texto) => {
    const { m, pedido } = mundoConPedido();
    const s = turno(m, { texto });
    expect(s.d['accion']).toBe('seguimiento');
    expect(s.d['cuerpoExtraccion']).toBeNull();
    const c = cuerpos(s);
    expect(c).toHaveLength(1);
    expect(c[0]).toContain(`#${String(pedido['codigo'])}`);
    expect(c[0]).toContain('1 × Orden de 3 tacos de birria');
    expect(c[0]).toContain('Total: 55 Bs.');
    expect(c[0]).toContain(String(RL['textoSeguimiento']));
    expect(c[0]).not.toMatch(DESPACHO);
    expect(botonesDelPrimero(s)).toEqual(['m|persona', 'm|menu']); // «Escribir al local» + «Volver a inicio»
    expect(s.p['aviso']).toBeNull(); // sin aviso al local (excepción de Andres, 08/11)
    expect(s.armados).toHaveLength(0);
    expect(s.p['ruta']).toBe('seguimiento:con_pedido');
    expect(String(s.p['ruta'])).not.toMatch(/^pedido:/); // el miniCRM no lo cuenta como pedido
    sinRespaldoLiteral(s);
    expect(PROHIBIDAS.test(c[0]!)).toBe(false);
  });
  it.each(['¿ya salió mi pedido?', 'dónde está mi pedido', 'cómo va mi orden'])('sin ningún pedido pasado: «%s»', (texto) => {
    const m = mundoCon();
    turno(m, { texto: 'hola' });
    const s = turno(m, { texto });
    expect(s.d['accion']).toBe('seguimiento');
    expect(cuerpos(s)[0]).toBe(`No encuentro un pedido tuyo de los últimos 3 días por aquí.\n\n${String(RL['textoSeguimiento'])}`);
    expect(botonesDelPrimero(s)).toEqual(['m|persona', 'm|menu']);
    expect(s.p['aviso']).toBeNull();
    expect(s.p['ruta']).toBe('seguimiento:sin_pedido');
  });
  it('insistir NO deriva con aviso: cada vez sale el seguimiento', () => {
    const { m } = mundoConPedido();
    for (let i = 0; i < 3; i++) {
      const s = turno(m, { texto: '¿ya salió mi pedido?' });
      expect(s.d['accion']).toBe('seguimiento');
      expect(s.p['aviso']).toBeNull();
    }
  });
  it('tocar «Escribir al local» deriva como siempre (con aviso)', () => {
    const { m } = mundoConPedido();
    turno(m, { texto: '¿ya salió mi pedido?' });
    const s = turno(m, { boton: 'm|persona' });
    expect(s.p['aviso']).toMatchObject({ tipo: 'transferencia' });
  });
});

// =================================================================================================
// La batería fuera de protocolo: el modelo (simulado) SOLO clasifica; el texto lo escribe el código.
interface CasoLibre { texto: string; intencion: string; verifica: (c: string, s: Salida) => void }
const sinAviso = (s: Salida): void => { expect(s.p['aviso']).toBeNull(); expect(s.armados).toHaveLength(0); };
const conBotonLocal = (s: Salida): void => { expect(botonesDelPrimero(s)).toContain('m|persona'); };
const CASOS: CasoLibre[] = [
  { texto: 'cuándo los puedo visitar', intencion: 'horario', verifica: (c) => expect(c).toMatch(/^Atendemos /) },
  { texto: 'a partir de qué momento atienden al público', intencion: 'horario', verifica: (c) => expect(c).toMatch(/^Atendemos /) },
  { texto: 'estoy perdido, cómo hago para visitarlos', intencion: 'direccion', verifica: (c) => expect(c).toMatch(/^Estamos en /) },
  { texto: 'a cuántas cuadras de la plaza están', intencion: 'direccion', verifica: (c) => expect(c).toMatch(/^Estamos en /) },
  { texto: 'me lo traen hasta la casa?', intencion: 'modalidades', verifica: (c) => expect(c).toMatch(/delivery/i) },
  { texto: 'puedo pasar yo a llevármelo?', intencion: 'modalidades', verifica: (c) => { expect(c).toMatch(/delivery/i); expect(c).toMatch(/recoger/i); } },
  { texto: 'gracias amigo', intencion: 'acuse', verifica: (c) => expect(c).toBe(RL['acuse']) },
  { texto: 'thanks', intencion: 'acuse', verifica: (c) => expect(c).toBe(RL['acuse']) },
  { texto: 'okis', intencion: 'acuse', verifica: (c) => expect(c).toBe(RL['acuse']) },
  { texto: 'gracias, muy amable', intencion: 'acuse', verifica: (c) => expect(c).toBe(RL['acuse']) },
  { texto: 'ok 😀', intencion: 'acuse', verifica: (c) => expect(c).toBe(RL['acuse']) },
  { texto: 'gracias 🙂', intencion: 'acuse', verifica: (c) => expect(c).toBe(RL['acuse']) },
  { texto: 'qué se puede comer ahí', intencion: 'carta', verifica: (c) => expect(c.length).toBeGreaterThan(10) },
  { texto: 'jajaja qué chistoso el nombre del local', intencion: 'humor', verifica: (c) => expect(c).toBe(RL['textoHumor']) },
  { texto: 'cuéntame un chiste de tacos', intencion: 'humor', verifica: (c) => expect(c).toBe(RL['textoHumor']) },
  { texto: 'qué hambre tengo, me muero', intencion: 'humor', verifica: (c) => expect(c).toBe(RL['textoHumor']) },
  { texto: 'eres más lento que el tráfico de la Ceja', intencion: 'humor', verifica: (c) => expect(c).toBe(RL['textoHumor']) },
  { texto: 'la última vez me atendieron muy mal', intencion: 'queja', verifica: (c, s) => { expect(c).toBe(RL['textoQueja']); conBotonLocal(s); } },
  { texto: 'estoy molesto, el taco estaba frío', intencion: 'queja', verifica: (c, s) => { expect(c).toBe(RL['textoQueja']); conBotonLocal(s); } },
  { texto: 'qué mala atención la de ayer', intencion: 'queja', verifica: (c, s) => { expect(c).toBe(RL['textoQueja']); conBotonLocal(s); } },
  { texto: 'tienen estacionamiento', intencion: 'otro', verifica: (c, s) => { expect(c).toBe(RL['textoRechazo']); conBotonLocal(s); } },
  { texto: 'aceptan mascotas', intencion: 'otro', verifica: (c, s) => { expect(c).toBe(RL['textoRechazo']); conBotonLocal(s); } },
  { texto: 'hay wifi para clientes', intencion: 'otro', verifica: (c, s) => { expect(c).toBe(RL['textoRechazo']); conBotonLocal(s); } },
  { texto: 'tienen sillas para bebés', intencion: 'otro', verifica: (c, s) => { expect(c).toBe(RL['textoRechazo']); conBotonLocal(s); } },
  { texto: 'platícame de la historia del taco', intencion: 'identidad', verifica: (c) => expect(c).toMatch(/^Soy un asistente virtual con inteligencia artificial de /) },
];
describe('C. fuera de protocolo en inicio o menú (25): el modelo solo clasifica y el texto es del código', () => {
  it.each(CASOS)('«$texto» → $intencion', ({ texto, intencion, verifica }) => {
    const m = mundoCon();
    turno(m, { texto: 'hola' });
    const s = turno(m, { texto, extraccion: modelo(intencion) });
    expect(s.d['accion']).toBe('extraer_libre');
    // La llamada pide SOLO un enum cerrado, con muy pocos tokens, y el mensaje va como dato.
    const cuerpo = s.d['cuerpoExtraccion'] as J;
    expect(Object.keys(cuerpo.generationConfig.responseSchema.properties)).toEqual(['intencion']);
    expect(cuerpo.generationConfig.responseSchema.properties.intencion.enum).toEqual(['horario', 'direccion', 'carta', 'modalidades', 'humor', 'queja', 'identidad', 'acuse', 'otro']);
    expect(cuerpo.generationConfig.responseSchema.required).toEqual(['intencion']);
    // Tope holgado (el mismo de la extracción de pedidos, 400): si el modelo razona antes de contestar, un tope de 20 se agotaría y todo turno libre caería en el rechazo.
    expect(cuerpo.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(64);
    expect(cuerpo.generationConfig.responseMimeType).toBe('application/json');
    expect(s.p['ruta']).toMatch(/^libre:/);
    expect(s.p['ruta']).not.toMatch(/^pedido:/); // el miniCRM cuenta `pedido:*`
    expect(cuerpo.contents[0].parts[0].text).toContain(`«${texto}»`);
    const c = cuerpos(s);
    expect(c).toHaveLength(1);
    expect(clientes(s)).toHaveLength(1);
    verifica(c[0]!, s);
    sinAviso(s);
    sinRespaldoLiteral(s);
    expect(c[0]).not.toMatch(DESPACHO);
    expect(PROHIBIDAS.test(c[0]!)).toBe(false);
  });
  it('la carta por intención es la misma que la de «la carta»', () => {
    const a = mundoCon();
    turno(a, { texto: 'hola' });
    const b = mundoCon();
    turno(b, { texto: 'hola' });
    expect(cuerpos(turno(a, { texto: 'qué se puede comer ahí', extraccion: modelo('carta') }))).toEqual(cuerpos(turno(b, { texto: 'la carta' })));
  });
  it('sin dato cargado (sin horario o sin dirección) la intención cae al rechazo con botón, no deriva con aviso', () => {
    for (const [intencion, quita] of [['horario', 'horario'], ['direccion', 'direccion']] as const) {
      const base = { ...BASE };
      delete (base as J)[quita];
      const m = crear({ base, panel: panel({ respuestaLibre: RL, ...(quita === 'direccion' ? { direccion: '' } : { horarioAtencion: '' }) }) });
      turno(m, { texto: 'hola' });
      const s = turno(m, { texto: 'una duda rara sobre el local', extraccion: modelo(intencion) });
      if (s.d['accion'] !== 'extraer_libre') continue;
      sinAviso(s);
      expect(clientes(s)).toHaveLength(1);
    }
  });
  it('como primer mensaje: el paso pasa a menú y no se antepone prosa', () => {
    const m = mundoCon();
    const s = turno(m, { texto: 'jajaja qué chistoso', extraccion: modelo('humor') });
    expect(cuerpos(s)).toEqual([RL['textoHumor']]);
    expect(estadoDe(m)['paso']).toBe('menu');
  });
  it.each(['holi', 'Hola!', '¡Hola!', 'qué tal', 'saludos', 'Holaaa', 'hey'])('el saludo «%s» no llama al modelo', (texto) => {
    expect(turno(mundoCon(), { texto }).d['accion']).not.toBe('extraer_libre');
  });
  it('sin textoHumor ni textoQueja del tenant, el código usa su texto de siempre (queja con botón local)', () => {
    const m = mundoCon({ activo: true });
    turno(m, { texto: 'hola' });
    const h = turno(m, { texto: 'jajaja qué chistoso', extraccion: modelo('humor') });
    expect(cuerpos(h)[0]).toMatch(/^¡Jaja!/);
    const q = turno(m, { texto: 'estoy molesto, el taco estaba frío', extraccion: modelo('queja') });
    expect(cuerpos(q)[0]).toMatch(/Escribir al local/);
    conBotonLocal(q);
  });
});

// =================================================================================================
// La expresión de la prohibición 4, tomada de la fuente de la variante de venta (la misma que verifica `core/niega-ia.test.ts`); y su contraprueba: SÍ detecta las negaciones.
const NIEGA_IA_DE_VENTA = (0, eval)(readFileSync(join(RAIZ, '../../../src/core/venta/procesar-respuesta.js'), 'utf8').split('\n').find((l) => l.trimStart().startsWith('const NIEGA_IA'))!.trim().replace(/^const NIEGA_IA = /, '').replace(/;$/, '')) as RegExp;
describe('D0. la identidad: texto fijo por código, sin llamar al modelo, en 6 idiomas (prohibición 4)', () => {
  it('contraprueba: la regla NIEGA_IA detecta «soy una persona», «no soy un bot» y «hablas con una persona»', () => {
    for (const malo of ['Soy una persona de Q Taco.', 'No soy un bot.', 'Hablas con una persona.']) expect(NIEGA_IA_DE_VENTA.test(malo), malo).toBe(true);
  });
  it.each([
    '¿eres persona?', '¿eres real?', '¿hay alguien ahí?', '¿hablo con un humano?', 'eres un bot?', 'hablo con una persona real?', '¿con quién hablo?', 'quién eres', 'quién me atiende',
    'are you a bot', 'are you human', 'who are you', 'am I talking to a real person', 'você é um robô?', 'com quem falo?', 'es-tu un robot', 'qui es tu', 'bist du ein mensch', 'wer bist du', 'chi sei', 'con chi parlo',
  ])('«%s»', (texto) => {
    const m = mundoCon();
    turno(m, { texto: 'hola' });
    const s = turno(m, { texto, extraccion: modelo('otro') });
    expect(s.d['accion']).toBe('identidad');
    expect(s.d['cuerpoExtraccion']).toBeNull();
    // El texto COMPLETO producido (no el código fuente): exacto, y sin que lo alcance la regla `NIEGA_IA` de la prohibición 4.
    expect(cuerpos(s)[0]).toBe("Soy un asistente virtual con inteligencia artificial de Q' Taco de prueba. Si prefieres hablar con una persona de nuestro equipo, toca el botón. Para volver al inicio, escribe «inicio».");
    expect(NIEGA_IA_DE_VENTA.test(cuerpos(s)[0]!)).toBe(false);
    sinAviso(s);
  });
  it('NEGADO: «¿es real la promo del 2x1?», «¿es de verdad que hay delivery?» y «la carne es de verdad de res» NO son preguntas de identidad', () => {
    for (const texto of ['¿es real la promo del 2x1?', '¿es de verdad que hay delivery?', 'la carne es de verdad de res']) {
      const m = mundoCon();
      turno(m, { texto: 'hola' });
      expect(turno(m, { texto, extraccion: modelo('otro') }).d['accion'], texto).not.toBe('identidad');
    }
  });
  it('con la función apagada (o sin la clave) las formas ampliadas NO se interceptan: sale lo mismo que en `main`', () => {
    for (const texto of ['¿hay alguien ahí?', '¿con quién hablo?', 'who are you', 'quién eres']) {
      for (const rl of [null, { ...RL, activo: false }]) {
        const m = mundoCon(rl);
        turno(m, { texto: 'hola' });
        expect(turno(m, { texto, extraccion: { lineas: [] } }).d['accion'], texto).not.toBe('identidad');
      }
    }
  });
});

// =================================================================================================
// Un modelo que escribe lo que quiere: nada de eso llega al cliente. Lo que sale es SIEMPRE texto del código.
const MALICIOSOS: { nombre: string; extraccion?: J; extraerCrudo?: J; texto?: string }[] = [
  { nombre: 'prosa sin intención', extraccion: { respuesta: 'Te habla Pedro, del local', reencauzar: true } },
  { nombre: 'intención válida con prosa de despacho y campos extra', extraccion: { intencion: 'humor', respuesta: 'tu pedido está en camino', reencauzar: false, extra: 1 } },
  { nombre: 'otro con pago acreditado', extraccion: { intencion: 'otro', respuesta: 'Tu pago fue acreditado' } },
  { nombre: 'queja con identidad humana', extraccion: { intencion: 'queja', respuesta: 'Soy Pedro, una persona real', texto: 'Soy Pedro' } },
  { nombre: 'enum desconocido', extraccion: { intencion: 'regalar_descuento' } },
  { nombre: 'enum con otra capitalización', extraccion: { intencion: 'Horario' } },
  { nombre: 'enum dentro de una lista', extraccion: { intencion: ['horario'] } },
  { nombre: 'intención numérica', extraccion: { intencion: 7 } },
  { nombre: 'objeto vacío', extraccion: {} },
  { nombre: 'error 500', extraerCrudo: { error: { code: 500, message: 'caído' } } },
  { nombre: 'texto que no es JSON', extraerCrudo: { content: { parts: [{ text: 'Te habla Pedro, del local' }] } } },
  { nombre: 'JSON como texto con prosa', extraerCrudo: { content: { parts: [{ text: JSON.stringify({ respuesta: 'Pago acreditado', intencion: 'otro' }) }] } } },
];
const FRAGMENTOS_MALOS = /Pedro|acreditad|camino|persona real|descuento|Paiement|Zahlung|pagadito/i;
describe('D. un modelo malicioso o caído: lo que sale al cliente es texto del código, 1 mensaje, sin aviso', () => {
  it.each(MALICIOSOS)('$nombre', ({ extraccion, extraerCrudo }) => {
    const m = mundoCon();
    turno(m, { texto: 'hola' });
    const s = turno(m, { texto: 'jajaja qué chistoso', ...(extraccion ? { extraccion } : { extraerCrudo }) });
    expect(s.d['accion']).toBe('extraer_libre');
    expect(clientes(s)).toHaveLength(1);
    const c = cuerpos(s).join('\n');
    expect(c).not.toMatch(FRAGMENTOS_MALOS);
    // Es uno de los textos del código para ese caso: humor (intención válida), o el rechazo con botón local.
    if (extraccion && extraccion['intencion'] === 'humor') expect(c).toBe(RL['textoHumor']);
    else if (extraccion && extraccion['intencion'] === 'queja') expect(c).toBe(RL['textoQueja']);
    else { expect(c).toBe(RL['textoRechazo']); conBotonLocal(s); expect(s.p['ruta']).toBe('libre:rechazada'); }
    expect(s.p['ruta']).not.toMatch(/^pedido:/);
    sinAviso(s);
    sinRespaldoLiteral(s);
  });
  it('ESTRUCTURAL: ningún campo del modelo salvo `intencion` llega al plan', () => {
    const plan = readFileSync(join(RAIZ, 'nodos/plan-del-turno.js'), 'utf8');
    const pieza = readFileSync(join(RAIZ, '../../../src/core/conversacion/respuesta-coherente.js'), 'utf8');
    expect(plan).not.toMatch(/rcLeerRespuesta|rcMotivoDeRechazoLibre|\br\.respuesta\b/);
    expect(pieza).not.toMatch(/rcLeerRespuesta|rcMotivoDeRechazoLibre|rcMotivoDeDespacho|RC_NIEGA_IA|rcMotivoDePagoAjeno|cmNorm|cmMotivoDeRechazo/);
    const i = plan.indexOf('function aExtraerLibre');
    const cuerpo = plan.slice(i, plan.indexOf('function aExtraerPedido'));
    expect(cuerpo).toContain('rcLeerIntencion(vmJsonDeGemini(vmPrimero(\'Extraer\')))');
    expect(cuerpo.match(/vmJsonDeGemini|vmPrimero/g)).toHaveLength(2);
  });
  it('ESTRUCTURAL: una marca única puesta por el modelo en cualquier campo no aparece en ningún payload', () => {
    for (const intencion of ['horario', 'direccion', 'carta', 'modalidades', 'humor', 'queja', 'identidad', 'otro']) {
      const m = mundoCon();
      turno(m, { texto: 'hola' });
      const s = turno(m, { texto: 'una cosa rara del local', extraccion: { intencion, respuesta: 'MARCA_DEL_MODELO', texto: 'MARCA_DEL_MODELO', cuerpo: 'MARCA_DEL_MODELO', reencauzar: true } });
      expect(JSON.stringify(s.mensajes), intencion).not.toContain('MARCA_DEL_MODELO');
      expect(clientes(s), intencion).toHaveLength(1);
    }
  });
  it('un rechazo sin texto del tenant usa el de siempre', () => {
    const m = mundoCon({ activo: true });
    turno(m, { texto: 'hola' });
    expect(cuerpos(turno(m, { texto: 'jajaja qué chistoso', extraccion: { respuesta: 'Tu pedido va en camino.' } }))).toEqual(['Eso no lo puedo responder por aquí.']);
  });
});

// =================================================================================================
describe('E. dentro de un pedido en curso la función NO actúa: la salida es idéntica con `activo: true` y con `activo: false`', () => {
  type Preparar = (m: Mundo) => void;
  const salidaDe = (rl: J | null, preparar: Preparar, textos: string[]): string[] => {
    // Cada texto en un mundo NUEVO en ese paso (una derivación intermedia deja el paso en `menu`, donde la función sí actúa).
    return textos.map((texto) => {
      const m = mundoCon(rl);
      preparar(m);
      const s = turno(m, { texto, extraccion: { lineas: [] } });
      return JSON.stringify({ accion: s.d['accion'], mensajes: s.mensajes.map((x) => x['payload']), ruta: s.p['ruta'], estado: estadoDe(m), aviso: s.p['aviso'], errores: s.p['errores'] });
    });
  };
  const TEXTOS = ['👍', 'genial', 'excelente', 'muchas gracias', 'ok', 'dale', 'listo', 'gracias', '¿ya salió mi pedido?', '¿cuánto demora?', 'jajaja qué chistoso'];
  const PASOS: [string, Preparar][] = [
    ['pedido con el carrito lleno (resumen)', (m) => { hastaResumen(m, 'recojo'); }],
    ['pedido_datos (delivery a medias: dirección escrita, falta la ubicación)', (m) => { hastaResumen(m, 'delivery', CLIENTE, false); expect(String(estadoDe(m)['paso'])).toMatch(/^pedido/); expect(estadoDe(m)['entrega']).toMatchObject({ entrega: 'delivery' }); }],
    ['pedido_entrega', (m) => {
      turno(m, { texto: 'hola' });
      turno(m, { texto: 'quiero 1 orden de tacos de birria', extraccion: { lineas: [{ producto: 'tacos de birria', cantidad: 1, forma: 'orden', detalle: '' }], entrega: '', direccion: '', referencia: '', nombre: '' } });
    }],
    ['pedido con la carta recién mostrada y el carrito vacío', (m) => { turno(m, { texto: 'hola' }); turno(m, { boton: 'm|pedido' }); }],
  ];
  it.each(PASOS)('%s', (_n, preparar) => {
    expect(salidaDe(RL, preparar, TEXTOS)).toEqual(salidaDe({ ...RL, activo: false }, preparar, TEXTOS));
  });
  it('guion «hola → Hacer un pedido → ok → ok»: como en main, carta y luego derivación con aviso (no «¡Gracias a ti!» dos veces)', () => {
    const corre = (rl: J | null): { cuerpos: string[]; aviso: unknown }[] => {
      const m = mundoCon(rl);
      turno(m, { texto: 'hola' });
      turno(m, { boton: 'm|pedido' });
      return ['ok', 'ok'].map((texto) => { const s = turno(m, { texto, extraccion: { lineas: [] } }); return { cuerpos: cuerpos(s), aviso: s.p['aviso'] }; });
    };
    const encendida = corre(RL);
    expect(encendida).toEqual(corre({ ...RL, activo: false }));
    expect(encendida.map((x) => x.cuerpos.join(' ')).join(' ')).not.toContain(String(RL['acuse']));
    expect(encendida[1]!.aviso).toBeTruthy();
  });
  it('la extracción de un pedido nunca pide `respuesta` ni `reencauzar`, ni encendida', () => {
    const m = mundoCon();
    turno(m, { texto: 'hola' });
    const s = turno(m, { texto: 'quiero 2 tacos', extraccion: { lineas: [] } });
    expect(s.d['accion']).toBe('extraer_pedido');
    expect(Object.keys((s.d['cuerpoExtraccion'] as J).generationConfig.responseSchema.properties)).not.toContain('respuesta');
    expect(JSON.stringify(s.d['cuerpoExtraccion'])).not.toContain('reencauzar');
  });
});

// =================================================================================================
describe('N. carta sin cargar, `carritoAnterior` y menú con carrito: la función no pisa ni cambia nada', () => {
  it('intención `carta` con la carta VACÍA: rechazo con botón local, 1 mensaje, SIN aviso y sin ruta `transferir:` pisada', () => {
    const m = crear({ panel: panel({ respuestaLibre: RL, catalogo: [] }) });
    turno(m, { texto: 'hola' });
    const s = turno(m, { texto: 'qué se puede comer ahí', extraccion: modelo('carta') });
    if (s.d['accion'] !== 'extraer_libre') return; // sin carta, `Decidir turno` ya lo resuelve como siempre
    expect(clientes(s)).toHaveLength(1);
    expect(s.p['aviso']).toBeNull();
    expect(s.p['ruta']).toBe('libre:rechazada');
    expect(cuerpos(s)).toEqual([RL['textoRechazo']]);
    conBotonLocal(s);
  });
  const hastaMenuConCarritoAnterior = (m: Mundo): void => {
    hastaResumen(m, 'recojo');
    turno(m, { boton: 'p|cambiar' });
    turno(m, { boton: 'm|menu' });
  };
  it('en `menu` con `carritoAnterior` guardado, «gracias» y un mensaje libre salen EXACTAMENTE como con la función apagada (ni acuse ni `extraer_libre`)', () => {
    for (const texto of ['gracias', 'gracias amigo', 'ok', 'jajaja qué chistoso']) {
      const corre = (rl: J | null): { accion: unknown; cuerpos: string[]; paso: unknown; carritoAnterior: boolean } => {
        const m = mundoCon(rl);
        hastaMenuConCarritoAnterior(m);
        const e = estadoDe(m);
        const s = turno(m, { texto, extraccion: modelo('humor') });
        return { accion: s.d['accion'], cuerpos: cuerpos(s), paso: e['paso'], carritoAnterior: !!e['carritoAnterior'] };
      };
      const enc = corre(RL);
      expect(enc.carritoAnterior, texto).toBe(true);
      expect(enc.accion, texto).not.toBe('acuse');
      expect(enc.accion, texto).not.toBe('extraer_libre');
      expect(enc, texto).toEqual(corre({ ...RL, activo: false }));
    }
  });
  it('en `menu` con el carrito LLENO (tras una derivación), un mensaje libre sale como con la función apagada', () => {
    const corre = (rl: J | null): { accion: unknown; cuerpos: string[] } => {
      const m = mundoCon(rl);
      hastaResumen(m, 'recojo');
      turno(m, { texto: 'jaja qué día', extraccion: { lineas: [] } });
      turno(m, { texto: 'qué calor', extraccion: { lineas: [] } }); // dos vacías: deriva y deja el paso en `menu` con el carrito
      expect((estadoDe(m)['carrito'] as unknown[]).length).toBeGreaterThan(0);
      const s = turno(m, { texto: 'jajaja qué chistoso', extraccion: modelo('humor') });
      return { accion: s.d['accion'], cuerpos: cuerpos(s) };
    };
    const enc = corre(RL);
    expect(enc.accion).not.toBe('extraer_libre');
    expect(enc).toEqual(corre({ ...RL, activo: false }));
  });
});

// =================================================================================================
describe('N2. defensa en profundidad del plan', () => {
  it('aunque `Decidir turno` dejara pasar una crisis o una baja, la intención `humor` NUNCA recibe `textoHumor`: rechazo con botón y sin aviso', () => {
    for (const texto of ['quiero morir', 'no me escribas más', 'dame de baja']) {
      const m = mundoCon();
      turno(m, { texto: 'hola' });
      const s = turno(m, { texto, decision: (d) => ({ ...d, accion: 'extraer_libre' }), extraccion: modelo('humor') });
      expect(s.d['accion']).toBe('extraer_libre');
      expect(cuerpos(s)).toEqual([RL['textoRechazo']]);
      expect(s.p['ruta']).toBe('libre:rechazada');
      conBotonLocal(s);
      sinAviso(s);
    }
  });
});

describe('M. textos delicados con la función encendida: no se presentan como atendidos ni cancelados por error', () => {
  const TEXTOS = ['no me escribas más', 'quiero morir', 'gracias, cancela todo', 'ok gracias, eso es todo', 'quiero matarme', 'dejen de escribirme', 'dame de baja', 'stop'];
  const SENAL = ['no me escribas más', 'quiero morir', 'quiero matarme', 'dejen de escribirme', 'dame de baja', 'stop'];
  it.each(SENAL)('crisis o baja «%s»: NUNCA llama al modelo ni recibe `textoHumor` ni `textoQueja`; el turno queda como siempre (el menú)', (texto) => {
    const apagada = mundoCon({ ...RL, activo: false });
    turno(apagada, { texto: 'hola' });
    const base = turno(apagada, { texto, extraccion: { lineas: [] } });
    for (const intencion of ['humor', 'queja', 'otro', 'acuse']) {
      const m = mundoCon();
      turno(m, { texto: 'hola' });
      const s = turno(m, { texto, extraccion: modelo(intencion) });
      expect(s.d['accion'], intencion).toBe(base.d['accion']);
      expect(s.d['cuerpoExtraccion'] ?? null, intencion).toBeNull();
      const c = cuerpos(s).join(' ');
      expect(c).not.toContain(String(RL['textoHumor']));
      expect(c).not.toContain(String(RL['textoQueja']));
      expect(cuerpos(s)).toEqual(cuerpos(base));
    }
  });
  it.each(TEXTOS)('«%s»', (texto) => {
    const apagada = mundoCon({ ...RL, activo: false });
    turno(apagada, { texto: 'hola' });
    const base = turno(apagada, { texto, extraccion: { lineas: [] } });
    for (const intencion of ['otro', 'queja', 'humor']) {
      const m = mundoCon();
      turno(m, { texto: 'hola' });
      const s = turno(m, { texto, extraccion: modelo(intencion) });
      expect(clientes(s)).toHaveLength(clientes(base).length);
      if (base.d['accion'] !== 'menu') {
        // Los caminos que ya existen (baja, crisis, derivación) siguen siendo los mismos.
        expect(s.d['accion']).toBe(base.d['accion']);
        expect(cuerpos(s)).toEqual(cuerpos(base));
      } else if (s.d['accion'] === 'extraer_libre') {
        const c = cuerpos(s).join(' ');
        expect(c).not.toMatch(/cancelad|atendid|resuelt|registrad|anotad|pedido/i);
        if (intencion !== 'humor') conBotonLocal(s);
      }
      expect(s.p['aviso']).toEqual(base.p['aviso']);
    }
  });
});

// =================================================================================================
describe('F. cero mensajes de diferencia, y con la función apagada todo igual a hoy', () => {
  const TEXTOS: { texto: string; extraccion: J }[] = [
    ...['gracias', 'ok', 'muchas gracias', '👍', 'perfecto', 'listo, gracias', '¿ya salió mi pedido?', 'dónde está mi pedido', '¿cuánto demora?'].map((texto) => ({ texto, extraccion: { lineas: [] } })),
    ...CASOS.map((c) => ({ texto: c.texto, extraccion: { lineas: [] } })),
  ];
  const corrida = (rl: J | null, texto: string, extraccion: J, intencion?: string): Salida => {
    const m = mundoCon(rl);
    turno(m, { texto: 'hola' });
    return turno(m, { texto, extraccion: intencion ? modelo(intencion) : extraccion });
  };
  it('cada texto sale en un solo mensaje, igual que con la función apagada', () => {
    for (const { texto, extraccion } of TEXTOS) {
      const encendida = corrida(RL, texto, extraccion, CASOS.find((c) => c.texto === texto)?.intencion);
      const apagada = corrida({ ...RL, activo: false }, texto, extraccion);
      expect(clientes(encendida).length, texto).toBe(clientes(apagada).length);
      expect(clientes(encendida).length, texto).toBe(1);
    }
  });
  it('con `activo: false`, sin la clave o con basura, TODAS las salidas son idénticas, mensaje por mensaje', () => {
    const variantes: (J | null)[] = [null, { activo: false, acuse: 'x', textoSeguimiento: 'y' }, { activo: 'true' }, { activo: 1 }, {}];
    const guion = ['hola', 'gracias', '¿ya salió mi pedido?', 'jajaja qué chistoso', 'quiero pedir 2 tacos', 'menú', '¿tienen estacionamiento?'];
    const salidas = variantes.map((rl) => {
      const m = mundoCon(rl);
      return guion.map((texto) => {
        const s = turno(m, { texto, extraccion: { lineas: texto.startsWith('quiero') ? [{ producto: 'tacos de birria', cantidad: 2, forma: 'unidad', detalle: '' }] : [] } });
        return JSON.stringify({ accion: s.d['accion'], cuerpos: s.mensajes.map((x) => x['payload']), ruta: s.p['ruta'], estado: estadoDe(m), aviso: s.p['aviso'], errores: s.p['errores'] });
      });
    });
    for (let i = 1; i < salidas.length; i++) expect(salidas[i]).toEqual(salidas[0]);
    // Y esa salida de siempre es la de hoy: «gracias» muestra el menú y «¿ya salió mi pedido?» va a la extracción.
    expect(salidas[0]![1]).toContain(MENU_AHORA);
    expect(JSON.parse(salidas[0]![2]!).accion).toBe('extraer_pedido');
  });
  it('apagada, la extracción de pedido es idéntica a la de siempre (sin `respuesta` ni `reencauzar`)', () => {
    const m = mundoCon(null);
    turno(m, { texto: 'hola' });
    const s = turno(m, { texto: 'quiero 2 tacos', extraccion: { lineas: [] } });
    const props = (s.d['cuerpoExtraccion'] as J).generationConfig.responseSchema.properties;
    expect(Object.keys(props)).not.toContain('respuesta');
    expect(JSON.stringify(s.d['cuerpoExtraccion'])).not.toContain('reencauzar');
  });
  it('un `respuestaLibre` hostil en el panel no rompe el turno (se sanea)', () => {
    const m = mundoCon({ activo: true, acuse: 'x'.repeat(5000), textoHumor: { a: 1 } as unknown as string });
    turno(m, { texto: 'hola' });
    const s = turno(m, { texto: 'gracias' });
    expect(s.d['accion']).toBe('menu'); // un tipo raro la apaga
  });
});

// =================================================================================================
describe('G. los flujos armados', () => {
  const CARPETA = join(RAIZ, '..');
  const salidas = readdirSync(CARPETA).filter((f) => /^venta-minima\..+\.json$/.test(f));
  it.each(salidas)('%s tiene 81 nodos o menos y el modelo sigue siendo un sub-nodo «Extraer» sin nodos nuevos', (f) => {
    const flujo = JSON.parse(readFileSync(join(CARPETA, f), 'utf8')) as J;
    expect(flujo.nodes.length).toBeLessThanOrEqual(81);
    const nombres = flujo.nodes.map((n: J) => n.name);
    expect(nombres.filter((n: string) => n === 'Extraer')).toHaveLength(1);
    const decidir = flujo.nodes.find((n: J) => n.name === 'Decidir turno').parameters.jsCode as string;
    expect(decidir).not.toContain('function cmMotivoDeRechazo'); // la pieza ya no usa el filtro común
    expect(decidir.indexOf('const rl = rcConfig(')).toBeGreaterThan(decidir.indexOf('function rcConfig'));
    expect(decidir.indexOf('const rl = rcConfig(')).toBeLessThan(decidir.indexOf('function extraerPedido'));
  });
  it('las salidas llevan la pieza incluida, no una copia propia en el nodo', () => {
    const fuente = readFileSync(join(RAIZ, '../../../src/core/conversacion/respuesta-coherente.js'), 'utf8').trimEnd();
    for (const f of salidas) {
      const flujo = JSON.parse(readFileSync(join(CARPETA, f), 'utf8')) as J;
      for (const n of ['Decidir turno', 'Plan del turno']) expect(flujo.nodes.find((x: J) => x.name === n).parameters.jsCode).toContain(fuente);
      expect(readFileSync(join(RAIZ, 'nodos/decidir-turno.js'), 'utf8')).not.toContain('function rcEsAcuse');
    }
  });
});

// =================================================================================================
describe('H. la batería de pedidos existente, con la respuesta libre ENCENDIDA', () => {
  it("todos los casos del flujo armado de Q'Taco pasan igual con `respuestaLibre.activo: true` en el panel (sin red)", async () => {
    const CARPETA_VM_ = join(RAIZ, '..');
    const B = (await import(pathToFileURL(join(CARPETA_VM_, 'herramientas/bateria.mjs')).href)) as { main(a: string[], d?: J): Promise<number>; leerCasosDeCarpeta(): { casos: J[]; global: J | null } };
    const casosDe = (a: string): string[] => ((JSON.parse(readFileSync(join(CARPETA_VM_, 'herramientas/bateria-casos', a), 'utf8')) as J)['casos'] as J[]).map((c) => String(c['id']));
    const cancelarEnElFlujo = readFileSync(join(CARPETA_VM_, 'venta-minima.qtaco.json'), 'utf8').includes('no_cancela');
    const pendientes = new Set([...casosDe('A-pendiente-de-rama.json'), ...(cancelarEnElFlujo ? [] : casosDe('C-cancelar-guardado.json'))]);
    const ids = B.leerCasosDeCarpeta().casos.map((c) => String(c['id'])).filter((x) => !pendientes.has(x));
    const salida: string[] = [];
    const red: string[] = [];
    const globalFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error('el fetch global no se toca en --seco'); }) as typeof fetch;
    let codigo: number;
    try {
      codigo = await B.main(['--seco', '--json', '--casos', ids.join(',')], {
        salida: (t: string) => { salida.push(t); }, error: (t: string) => { salida.push(t); },
        fetch: (u: string) => { red.push(String(u)); throw new Error('sin red'); },
        leerCasos: () => {
          const t = B.leerCasosDeCarpeta();
          return { ...t, casos: t.casos.map((c) => ({ ...c, panel: { ...((c['panel'] as J | undefined) ?? {}), respuestaLibre: RL } })) };
        },
      });
    } finally { globalThis.fetch = globalFetch; }
    const r = JSON.parse(salida.join('')) as J;
    expect(r.fallaron, JSON.stringify(r.casos.filter((c: J) => !c.ok).map((c: J) => [c.id, c.por])).slice(0, 3000)).toBe(0);
    expect(codigo).toBe(0);
    expect(red).toHaveLength(0);
    expect(r.total.turnos).toBeGreaterThan(0);
  }, 120_000);
});
