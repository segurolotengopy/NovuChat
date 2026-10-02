/**
 * INTEGRACIÓN DE «VENTA MÍNIMA v0»: las SEIS librerías REALES con los nodos de la ruta del turno, de punta a punta.
 *
 * POR QUÉ EXISTE (revisión del PR-1, R6). Cada suite de las otras ocho prueba una pieza con DOBLES de las demás
 * (`venta-minima-decision` lleva dobles de `pedido`, `reserva`, `promos` y `cobro`; `venta-minima-salida` lleva dobles de
 * `comun`, `avisos` y `reserva`). Un doble fiel al contrato que se quedó en lo que el autor creía oculta los desacoples: el
 * doble de `avDestinatarios` asignaba el rol `completo` a un número sin rol y la librería real asigna `cocina`; el panel sin
 * `aceptaDelivery` se leía como «no» en `Config del negocio` y como «sí» en el servidor. Esta suite no tiene ningún doble:
 * concatena `comun`, `pedido`, `reserva`, `promos`, `avisos` y `cobro` delante de cada nodo (como lo hace el constructor)
 * y corre `Carga de entrada`, `Config del negocio`, `Interpretar entrada`, `Decidir turno`, `Plan del turno`,
 * `Armar avisos` y `Armar mensajes`. Lo único simulado es lo que está FUERA de código: la respuesta del panel, la del
 * modelo (`Extraer`), la del servidor de cobro (`Cotejar en el servidor`) y las respuestas de Graph (`Enviar aviso`).
 *
 * Se evalúa con `ejecutar` de `./lib/flujo` (sin los globales de Node; no hay ningún `new Function` nuevo). El reloj es un
 * parámetro: `AHORA` es el lunes 05/10/2026 a las 10:00 de La Paz. Teléfonos sintéticos, con seis ceros.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar, type J, type Referencias } from './lib/flujo';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/venta-minima/src');
const leer = (r: string): string => readFileSync(join(RAIZ, r), 'utf8');
const LIBRERIAS = ['comun', 'pedido', 'reserva', 'promos', 'avisos', 'cobro'].map((n) => leer(`lib/${n}.js`));
const LIBS = LIBRERIAS.join('\n');
const CODIGO: Record<string, string> = {};
for (const n of ['carga-de-entrada', 'config-del-negocio', 'interpretar-entrada', 'decidir-turno', 'plan-del-turno', 'armar-avisos', 'armar-mensajes']) {
  CODIGO[n] = `${LIBS}\n${leer(`nodos/${n}.js`)}`;
}

const AHORA = Date.UTC(2026, 9, 5, 14); // lunes 05/10/2026, 10:00 en La Paz
const MIN = 60 * 1000;
const HORA = 60 * MIN;
const CLIENTE = '59100000011';
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

interface Mundo { g: J; base: J; panel: J; ahora: number; n: number }
const crear = (o: { base?: J; panel?: J; ahora?: number } = {}): Mundo => ({ g: {}, base: o.base ?? BASE, panel: o.panel ?? panel(), ahora: o.ahora ?? AHORA, n: 0 });
const sdDe = (m: Mundo): J => (m.g['ventaMinima'] ??= {});
const estadoDe = (m: Mundo, from = CLIENTE): J => sdDe(m)['estados']?.[from] ?? {};

const OK = (i = 1): J => ({ messaging_product: 'whatsapp', contacts: [{ wa_id: AV1 }], messages: [{ id: `wamid.AVISO${i}` }] });
const FALLA: J = { error: { message: 'Graph rechazó el envío', code: 131030 } };
const gemini = (o: J): J => ({ content: { parts: [{ text: JSON.stringify(o) }] } });

interface Entrada {
  from?: string; nombrePerfil?: string; tipo?: 'text' | 'interactive' | 'image' | 'location' | 'audio';
  texto?: string; boton?: string; mediaId?: string; ubicacion?: J;
  /** Lo que devuelve el modelo (`Extraer`). */ extraccion?: J;
  /** La respuesta del servidor de cobro (`Cotejar en el servidor`). */ cotejo?: J;
  /** La lectura del comprobante (`Interpretar lectura`). */ lectura?: J;
  /** Las respuestas de Graph a los avisos armados; por omisión todos salen bien. */ envio?: (armados: J[]) => J[];
  /** Cuánto se adelanta el reloj antes de este turno. */ despues?: number;
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
  const globales = { $getWorkflowStaticData: () => m.g, Date: relojFijo(m.ahora) };
  const correr = (nodo: string, entradas: J[], refs: Referencias): J[] => ejecutar(CODIGO[nodo]!, entradas, refs, globales);

  const [carga] = correr('carga-de-entrada', [evento], {}) as [J];
  const [cfg] = correr('config-del-negocio', [{ statusCode: 200, body: m.panel }], { 'Config base': m.base, 'Carga de entrada': carga }) as [J];
  const refs: Referencias = { 'Carga de entrada': carga, 'Config base': m.base, 'Config del negocio': cfg };
  const entrada = correr('interpretar-entrada', [{}], refs);
  const vacio: Salida = { descartado: true, t: {}, d: {}, p: {}, cfg, avisos: [], armados: [], enviados: [], mensajes: [], tiempoMs: 0 };
  if (!entrada.length) return { ...vacio, tiempoMs: performance.now() - ini };
  const t = entrada[0]!;
  refs['Interpretar entrada'] = t;
  if (e.cotejo) refs['Cotejar en el servidor'] = e.cotejo;
  if (e.lectura) refs['Interpretar lectura'] = e.lectura;
  const [d] = correr('decidir-turno', [{}], refs) as [J];
  refs['Decidir turno'] = d;
  if (String(d['accion']).startsWith('extraer') && e.extraccion) refs['Extraer'] = gemini(e.extraccion);
  const [p] = correr('plan-del-turno', [{}], refs) as [J];
  refs['Plan del turno'] = p;
  const avisos = correr('armar-avisos', [{}], refs);
  refs['Armar avisos'] = avisos;
  const armados = avisos.filter((i) => i['sinAviso'] !== true && i['payload']);
  const enviados = armados.length ? (e.envio ?? ((a: J[]) => a.map((_, i) => OK(i + 1))))(armados) : [];
  if (armados.length) refs['Enviar aviso'] = enviados;
  const mensajes = correr('armar-mensajes', [{}], refs);
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
const PROHIBIDAS = /validad|confirmad|pagad[oa]|acreditad|verificad|recibimos tu pago|ya lo prepar|lo (est[aá](n|mos)|estoy) prepar|lo preparamos|te avisa(mos|remos)|en camino|te llama(mos|remos)|te escribir[aá]n|lo consulto|acredit|recib\S* (tu|el) pago|pago (recibid|aprobad|[eé]xitos|realizad|registrad)|confirm(ó|amos|o\b)|reservad/i;

/** Lleva a `from` hasta el resumen de un pedido: 1 orden de tacos, delivery con dirección y referencia (o recojo). */
function hastaResumen(m: Mundo, modalidad: 'delivery' | 'recojo' = 'delivery', from = CLIENTE): Salida {
  turno(m, { from, texto: 'hola' });
  turno(m, { from, texto: 'quiero 1 orden de tacos de birria', extraccion: {
    lineas: [{ producto: 'tacos de birria', cantidad: 1, forma: 'orden', detalle: '' }], entrega: modalidad, direccion: '', referencia: '', nombre: '',
  } });
  if (modalidad === 'recojo') return turno(m, { from, boton: 'e|recojo' });
  return turno(m, { from, texto: 'Calle Falsa 123, portón azul', extraccion: {
    lineas: [], entrega: 'delivery', direccion: 'Calle Falsa 123', referencia: 'portón azul', nombre: 'Ana Pérez',
  } });
}

// =================================================================================================
describe('integración: la ruta real de un turno con las seis librerías', () => {
  it('las seis librerías se concatenan sin chocar y cada nodo corre sin globales de Node', () => {
    const m = crear();
    const s = turno(m, { texto: 'hola' });
    expect(s.descartado).toBe(false);
    expect(s.d['accion']).toBe('menu');
    expect(cuerpos(s)[0]).toContain('¿Qué quieres hacer?');
    expect(botonesDe(clientes(s)[0]!)).toEqual(['m|pedido', 'm|reserva']);
    // Sin colisiones: cada nombre de las seis librerías se declara una sola vez en el conjunto.
    const declarados = LIBRERIAS.flatMap((l) => [...l.matchAll(/^(?:function|const|let) ([A-Za-z_]\w*)/gm)].map((x) => x[1]!));
    expect(declarados.filter((n, i) => declarados.indexOf(n) !== i)).toEqual([]);
  });
});

// =================================================================================================
describe('R1: un panel sin las claves de modalidad acepta delivery y recojo (falta = «sí», como el servidor)', () => {
  it('el pedido con delivery llega hasta el aviso y el cliente lee que se pasó al restaurante', () => {
    const m = crear(); // venta: {} — sin aceptaDelivery ni aceptaRetiroEnLocal
    const resumen = hastaResumen(m);
    expect(resumen.cfg).toMatchObject({ aceptaDelivery: true, aceptaRetiroEnLocal: true });
    expect(estadoDe(m)['paso']).toBe('pedido_confirmar');
    expect(botonesDe(clientes(resumen)[0]!)).toEqual(['p|confirmar', 'p|cambiar']);
    expect(cuerpos(resumen)[0]).toContain('Total de la comida: 55 Bs.');
    const s = turno(m, { boton: 'p|confirmar' });
    expect(s.p['ruta']).toBe('pedido:sin_qr');
    expect(s.armados.length).toBeGreaterThan(0);
    expect(s.armados.every((a) => a['tipoAviso'] === 'pedido')).toBe(true);
    expect(cuerpos(s).join('\n')).toMatch(/pas[ée] .*pedido|restaurante/i);
    expect(errores(s)).not.toContain('qr_rechazado');
  });

  it('negado: con `aceptaDelivery: false` el delivery no se ofrece y con las dos en `false` se deriva', () => {
    const soloRecojo = crear({ panel: panel({ venta: { aceptaDelivery: false } }) });
    turno(soloRecojo, { texto: 'hola' });
    const s = turno(soloRecojo, { texto: 'quiero 1 orden de tacos de birria', extraccion: { lineas: [{ producto: 'tacos de birria', cantidad: 1, forma: 'orden', detalle: '' }] } });
    expect(s.cfg).toMatchObject({ aceptaDelivery: false, aceptaRetiroEnLocal: true });
    expect(estadoDe(soloRecojo)['entrega']['entrega']).toBe('recojo'); // la única modalidad, sin preguntar
    const nada = crear({ panel: panel({ venta: { aceptaDelivery: false, aceptaRetiroEnLocal: false } }) });
    turno(nada, { texto: 'hola' });
    const d = turno(nada, { texto: 'quiero 1 orden de tacos de birria', extraccion: { lineas: [{ producto: 'tacos de birria', cantidad: 1, forma: 'orden', detalle: '' }] } });
    expect(d.p['ruta']).toContain('transferir');
    expect(d.p['aviso'].tipo).toBe('transferencia');
  });

  it('con el panel sin respuesta (500) no se afirma ni se niega el delivery: se pasa con el local', () => {
    const m = crear();
    const globales = { $getWorkflowStaticData: () => m.g, Date: relojFijo(m.ahora) };
    const [carga] = ejecutar(CODIGO['carga-de-entrada']!, [{ messages: [{ from: CLIENTE, id: 'w1', type: 'text', text: { body: 'hacen delivery?' } }], metadata: { phone_number_id: PNID } }], {}, globales) as [J];
    const [cfg] = ejecutar(CODIGO['config-del-negocio']!, [{ statusCode: 500, body: {} }], { 'Config base': BASE, 'Carga de entrada': carga }, globales) as [J];
    expect(cfg).toMatchObject({ panelSinRespuesta: true });
    expect(cfg).not.toHaveProperty('aceptaDelivery');
    const refs: Referencias = { 'Carga de entrada': carga, 'Config del negocio': cfg };
    const [t] = ejecutar(CODIGO['interpretar-entrada']!, [{}], refs, globales) as [J];
    refs['Interpretar entrada'] = t!;
    const [d] = ejecutar(CODIGO['decidir-turno']!, [{}], refs, globales) as [J];
    refs['Decidir turno'] = d!;
    const [p] = ejecutar(CODIGO['plan-del-turno']!, [{}], refs, globales) as [J];
    expect(d!['accion']).toBe('consulta');
    expect(p!['aviso'].tipo).toBe('transferencia');
    expect(JSON.stringify(p!['mensajes'])).not.toMatch(/Sí, hacemos delivery|no hacemos delivery/);
  });
});

describe('R2: con la ventana cerrada, la plantilla de pedido lleva el detalle por rol (plan B con delivery)', () => {
  it('completo: dirección, quien recibe y celular; cocina: ítems con notas, sin teléfono ni dirección', () => {
    const m = crear();
    turno(m, { texto: 'hola' });
    turno(m, { texto: 'quiero 1 orden de tacos de birria sin cebolla y 1 queso fundido', extraccion: {
      lineas: [{ producto: 'tacos de birria', cantidad: 1, forma: 'orden', detalle: 'sin cebolla' }, { producto: 'queso fundido con chorizo', cantidad: 1, forma: '', detalle: '' }],
      entrega: 'delivery', direccion: '', referencia: '', nombre: '',
    } });
    turno(m, { texto: 'Calle Falsa 123, portón azul', extraccion: { lineas: [], entrega: 'delivery', direccion: 'Calle Falsa 123', referencia: 'portón azul', nombre: 'Ana Pérez' } });
    const s = turno(m, { boton: 'p|confirmar' });
    // Sin ventana abierta (nadie de los avisos escribió): solo plantillas, una por destinatario.
    expect(s.armados.map((a) => a['clase'])).toEqual(['plantilla', 'plantilla']);
    const completo = s.armados.find((a) => a['para'] === AV1)!;
    const cocina = s.armados.find((a) => a['para'] === AV2)!;
    expect(params(completo)[2]).toBe(`Delivery a Calle Falsa 123 (portón azul) · recibe Ana Pérez · cel ${CLIENTE}`);
    expect(params(cocina)[2]).toMatch(/^Delivery · 1 × Orden de 3 tacos de birria \(sin cebolla\), 1 × Queso fundido con chorizo$/);
    // Negado: cocina no recibe teléfono ni dirección en ninguna variable.
    const todoCocina = params(cocina).join('\n');
    expect(todoCocina).not.toContain(CLIENTE);
    expect(todoCocina).not.toMatch(/Calle Falsa|portón|\bcel\b/);
    // El cliente solo lee que se pasó el pedido porque la plantilla salió (por hecho).
    expect(cuerpos(s).join('\n')).toMatch(/pas[ée]/i);
  });

  it('con la ventana abierta sale además el texto de detalle, con dirección solo para completo', () => {
    const m = crear();
    turno(m, { from: AV1, texto: 'hola' });
    turno(m, { from: AV2, texto: 'hola' });
    hastaResumen(m);
    const s = turno(m, { boton: 'p|confirmar' });
    expect(s.armados.map((a) => a['clase'])).toEqual(['plantilla', 'detalle', 'plantilla', 'detalle']);
    const detalles = s.armados.filter((a) => a['clase'] === 'detalle');
    expect(cuerpoDe(detalles.find((a) => a['para'] === AV1)!)).toContain('Calle Falsa 123');
    expect(cuerpoDe(detalles.find((a) => a['para'] === AV2)!)).not.toMatch(/Calle Falsa|portón|\btel\b/);
  });
});

describe('R4: el texto del cliente no traba el mensaje entero', () => {
  it('«Calle 3 en camino a Obrajes» como dirección: el resumen sale con botones y el estado avanza', () => {
    const m = crear();
    turno(m, { texto: 'hola' });
    turno(m, { texto: 'quiero 1 orden de tacos de birria', extraccion: { lineas: [{ producto: 'tacos de birria', cantidad: 1, forma: 'orden', detalle: 'sin cebolla, pago confirmado' }], entrega: 'delivery' } });
    const s = turno(m, { texto: 'Calle 3 en camino a Obrajes', extraccion: { lineas: [], entrega: 'delivery', direccion: 'Calle 3 en camino a Obrajes', referencia: 'portón validado', nombre: 'Ana ya lo preparan' } });
    expect(errores(s).filter((e) => e.startsWith('texto_reemplazado'))).toEqual([]);
    expect(estadoDe(m)['paso']).toBe('pedido_confirmar');
    const msg = clientes(s)[0]!;
    expect(botonesDe(msg)).toEqual(['p|confirmar', 'p|cambiar']);
    expect(cuerpoDe(msg)).toContain('Obrajes');
    expect(cuerpoDe(msg)).toContain('Total de la comida: 55 Bs.');
    expect(cuerpoDe(msg).normalize('NFKC')).not.toMatch(PROHIBIDAS);
    // Y el pedido sigue: confirmar y que el aviso al restaurante no traiga la frase.
    const c = turno(m, { boton: 'p|confirmar' });
    for (const a of c.armados) expect(params(a).join('\n')).not.toMatch(PROHIBIDAS);
  });

  it('negado: el texto FIJO con una palabra prohibida sí se reemplaza por la derivación genérica (la red sigue)', () => {
    // Un nombre de negocio con la palabra es configuración, no texto de un tercero: el menú lo trae y se reemplaza.
    const m = crear({ panel: panel({ datosDelNegocio: { nombreNegocio: 'Taquería pagado', direccion: 'Av. Ejemplo 123' } }) });
    const s = turno(m, { texto: 'hola' });
    expect(errores(s)).toContain('texto_reemplazado_por_palabra_prohibida');
    expect(cuerpos(s)[0]).toContain('Eso lo ve directamente el restaurante');
  });
});

describe('R5: un pedido largo no pierde el total ni los botones', () => {
  const LINEAS = [
    'nachos con queso', 'guacamole con totopos', 'elote asado', 'quesadilla de pollo', 'quesadilla de hongos', 'burrito de res',
    'burrito vegetariano', 'flan de la casa', 'churros con dulce de leche', 'ensalada fresca', 'queso fundido con chorizo', 'tacos de birria',
  ];
  const largo = (m: Mundo): Salida => {
    turno(m, { texto: 'hola' });
    turno(m, { texto: 'pedido grande', extraccion: {
      lineas: LINEAS.map((p, i) => ({ producto: p, cantidad: 1, forma: 'orden', detalle: `nota ${i}: sin picante, bien caliente y con la salsa aparte por favor` })),
      entrega: 'delivery', direccion: '', referencia: '', nombre: '',
    } });
    return turno(m, { texto: 'Avenida Siempre Viva 742, casa verde', extraccion: { lineas: [], entrega: 'delivery', direccion: 'Avenida Siempre Viva 742', referencia: 'casa verde', nombre: 'Ana Pérez' } });
  };

  it('12 líneas con nota más delivery: el detalle en texto y un mensaje corto con el total, el delivery y los botones', () => {
    const m = crear();
    const s = largo(m);
    const ms = clientes(s);
    expect(estadoDe(m)['paso']).toBe('pedido_confirmar');
    expect(ms.length).toBeGreaterThanOrEqual(2);
    const ultimo = ms[ms.length - 1]!;
    expect(ultimo['payload'].type).toBe('interactive');
    expect(botonesDe(ultimo)).toEqual(['p|confirmar', 'p|cambiar']);
    expect(cuerpoDe(ultimo).length).toBeLessThanOrEqual(1024);
    expect(cuerpoDe(ultimo)).toMatch(/^Total de la comida: \d+(,\d+)? Bs\./);
    expect(cuerpoDe(ultimo)).toContain('El delivery no está incluido');
    // Las líneas llegaron enteras en los textos previos, sin recortes.
    const detalle = ms.slice(0, -1).map(cuerpoDe).join('\n');
    expect(detalle).toContain('nota 0:');
    expect(detalle).toContain('nota 11:');
    for (const previo of ms.slice(0, -1)) expect(previo['payload'].type).toBe('text');
    expect(ms.map(cuerpoDe).join('\n')).not.toContain('…'); // nada recortado por el límite de Meta
  });

  it('negado: un pedido corto sigue en UN mensaje', () => {
    expect(clientes(hastaResumen(crear()))).toHaveLength(1);
  });
});

// =================================================================================================
describe('R3: la marca de derivación es por hecho, y el tope respeta el 0', () => {
  const pide = 'quiero hablar con una persona';

  it('primera derivación con Graph en error: no deja marca y la segunda, un minuto después, SÍ avisa', () => {
    const m = crear();
    const a = turno(m, { texto: pide, envio: (arm) => arm.map(() => FALLA) });
    expect(a.p['aviso'].tipo).toBe('transferencia');
    expect(a.armados.length).toBeGreaterThan(0);
    expect(sdDe(m)['transferencias']).toBeUndefined();
    expect(sdDe(m)['estados'][CLIENTE]['transferencias']).toEqual([]);
    // El cliente igual recibe la derivación honesta: el botón, sin «ya pasé».
    expect(cuerpos(a).join('\n')).toContain('Toca el botón para escribirles');
    const b = turno(m, { despues: MIN, texto: pide });
    expect(b.armados.length).toBeGreaterThan(0);
    expect(erroresAvisos(b).filter((e) => e.startsWith('derivacion_repetida'))).toEqual([]);
  });

  it('negado: si el primer aviso SÍ salió, el segundo del mismo teléfono dentro de la hora no se arma', () => {
    const m = crear();
    turno(m, { texto: pide });
    expect(sdDe(m)['transferencias'][CLIENTE]).toEqual([m.ahora]);
    const b = turno(m, { despues: MIN, texto: pide });
    expect(b.armados).toEqual([]);
    expect(erroresAvisos(b).some((e) => e.startsWith('derivacion_repetida'))).toBe(true);
    // Pasada la hora vuelve a avisar, y otro teléfono tiene su propio tope.
    expect(turno(m, { despues: 61 * MIN, texto: pide }).armados.length).toBeGreaterThan(0);
    expect(turno(m, { from: OTRO, texto: pide }).armados.length).toBeGreaterThan(0);
  });

  it('topeTransferenciasHora = 0 significa «ninguna derivación avisa» (antes caía a 1)', () => {
    const m = crear({ base: { ...BASE, topeTransferenciasHora: 0 } });
    const a = turno(m, { texto: pide });
    expect(a.cfg['topeTransferenciasHora']).toBe(0);
    expect(a.armados).toEqual([]);
    expect(cuerpos(a).join('\n')).toContain('Toca el botón para escribirles'); // el botón sí sale
  });
});

describe('S2: sin plantilla configurada no se inventa un nombre; con ella, sale la configurada', () => {
  const SIN = sinClaves('plantillaPedido', 'plantillaReserva', 'plantillaDerivacion', 'idiomaPlantillaPedido', 'idiomaPlantillaReserva', 'idiomaPlantillaDerivacion');
  const reservar = (m: Mundo, from = CLIENTE): Salida => {
    turno(m, { from, boton: 'm|reserva' });
    turno(m, { from, texto: 'mesa para 4 el viernes a las 8 de la noche en la terraza', extraccion: { personas: 4, fecha: '2026-10-09', hora: '20:00', zona: 'terraza', nombre: 'Ana Pérez', celebracion: '', requerimiento: '' } });
    return turno(m, { from, boton: 'r|enviar' });
  };
  const nombresDePlantilla = (s: Salida): string[] => plantillas(s).map((a) => a['payload'].template.name);

  it('reserva con plantilla configurada y ventana cerrada: dos plantillas, y el cliente lee que llegó', () => {
    const s = reservar(crear());
    expect(nombresDePlantilla(s)).toEqual(['plantilla_reserva_x', 'plantilla_reserva_x']);
    expect(cuerpos(s).join('\n')).toContain('tu solicitud de reserva llegó al restaurante');
    expect(s.armados.map((a) => a['para']).sort()).toEqual([AV1, AV2]);
  });

  it('reserva SIN plantilla y ventana cerrada: ningún ítem de plantilla, y el cliente NO lee que llegó', () => {
    const s = reservar(crear({ base: SIN }));
    expect(s.p['aviso'].tipo).toBe('reserva');
    expect(plantillas(s)).toEqual([]);
    expect(s.armados).toEqual([]);
    expect(erroresAvisos(s)).toContain('plantilla_no_configurada_reserva');
    expect(cuerpos(s).join('\n')).toContain('No pude hacer llegar tu solicitud al restaurante');
    expect(cuerpos(s).join('\n')).not.toContain('llegó al restaurante');
  });

  it('reserva SIN plantilla pero con la ventana abierta: cae al texto de detalle, que sí salió', () => {
    const m = crear({ base: SIN });
    turno(m, { from: AV1, texto: 'hola' });
    const s = reservar(m);
    expect(plantillas(s)).toEqual([]);
    expect(s.armados.map((a) => [a['para'], a['clase']])).toEqual([[AV1, 'detalle']]);
    expect(cuerpoDe(s.armados[0]!)).toContain('Solicitud de reserva');
    expect(cuerpos(s).join('\n')).toContain('tu solicitud de reserva llegó al restaurante');
  });

  it('derivación SIN plantilla y ventana cerrada: ningún ítem de plantilla; la heredada de reserva, solo si está configurada', () => {
    const sin = turno(crear({ base: SIN }), { texto: 'quiero hablar con una persona' });
    expect(sin.armados).toEqual([]);
    expect(erroresAvisos(sin)).toContain('plantilla_no_configurada_derivacion');
    expect(cuerpos(sin).join('\n')).toContain('Toca el botón para escribirles');
    const hereda = turno(crear({ base: sinClaves('plantillaDerivacion', 'idiomaPlantillaDerivacion') }), { texto: 'quiero hablar con una persona' });
    expect(nombresDePlantilla(hereda)).toEqual(['plantilla_reserva_x', 'plantilla_reserva_x']);
    const propia = turno(crear(), { texto: 'quiero hablar con una persona' });
    expect(nombresDePlantilla(propia)).toEqual(['plantilla_derivacion_x', 'plantilla_derivacion_x']);
  });

  it('pedido SIN plantilla y ventana cerrada: no se arma ningún aviso y el cliente lee «no pude pasarle…»', () => {
    const m = crear({ base: SIN });
    hastaResumen(m, 'recojo');
    const s = turno(m, { boton: 'p|confirmar' });
    expect(s.armados).toEqual([]);
    expect(erroresAvisos(s)).toContain('plantilla_no_configurada_pedido');
    expect(cuerpos(s).join('\n')).toContain('No pude pasarle tu pedido al restaurante');
    expect(cuerpos(s).join('\n')).not.toMatch(/pas[ée] tu pedido|ya pas/i);
  });

  it('ningún nombre de plantilla de Meta sale del código: ni «pedido_registrado» ni «appointment_confirmed»', () => {
    const m = crear({ base: SIN });
    const salidas = [reservar(m), turno(m, { from: OTRO, texto: 'quiero hablar con una persona' }), turno(crear({ base: SIN }), { texto: 'tengo una queja' })];
    for (const s of salidas) expect(JSON.stringify(s.armados)).not.toMatch(/pedido_registrado|appointment_confirmed|"template"/);
  });
});

describe('S4: «Reenviar QR» sí reenvía el QR, sin reabrir el cobro', () => {
  it('el QR del pedido sale con el evento; al reenviarlo sale la imagen con monto y referencia y SIN evento', () => {
    const m = crear({ panel: conCobro() });
    hastaResumen(m);
    const c = turno(m, { boton: 'p|confirmar' });
    const primero = clientes(c)[0]!;
    expect(primero['payload'].type).toBe('image');
    expect(primero).toMatchObject({ evento: 'qr_enviado', monto: 55 });
    expect(estadoDe(m)['paso']).toBe('esperando_comprobante');
    m.panel = conCobro({ pedido: String(primero['referencia']), monto: 55 });
    const r = turno(m, { boton: 'q|reenviar' });
    expect(r.d['accion']).toBe('reenviar_qr');
    const reenviado = clientes(r)[0]!;
    expect(reenviado['payload']).toMatchObject({ type: 'image', image: { link: QR } });
    expect(reenviado).toMatchObject({ referencia: primero['referencia'], monto: 55 });
    expect(reenviado['evento']).toBeUndefined();
    expect(errores(r).filter((e) => e.startsWith('qr_rechazado'))).toEqual([]);
    expect(cuerpoDe(reenviado)).toContain('Total a pagar por QR: 55 Bs');
    expect(estadoDe(m)['paso']).toBe('esperando_comprobante');
  });

  it('negado: sin cobro real encendido no hay QR que reenviar y se deriva', () => {
    const m = crear({ panel: conCobro() });
    hastaResumen(m);
    turno(m, { boton: 'p|confirmar' });
    m.panel = panel();
    const r = turno(m, { boton: 'q|reenviar' });
    expect(clientes(r).every((j) => j['payload'].type !== 'image')).toBe(true);
    expect(r.p['aviso'].tipo).toBe('transferencia');
  });
});

describe('comprobante: cuadra, no cuadra e ilegible, de punta a punta', () => {
  const pagando = (extra: J = {}): { m: Mundo; ref: string } => {
    const m = crear({ panel: conCobro(), ...extra });
    hastaResumen(m);
    const c = turno(m, { boton: 'p|confirmar' });
    const ref = String(clientes(c)[0]!['referencia']);
    m.panel = conCobro({ pedido: ref, monto: 55 });
    return { m, ref };
  };
  const comprobante = (m: Mundo, cotejo: J, e: Entrada = {}): Salida => turno(m, { tipo: 'image', mediaId: 'media-9', cotejo, ...e });

  it('cuadra: el cliente lee que los datos coinciden (nunca «pagado»), y el aviso lleva el estado y la imagen con ventana abierta', () => {
    const { m } = pagando();
    turno(m, { from: AV1, texto: 'hola' });
    const s = comprobante(m, { statusCode: 200, body: { resultado: 'cuadra', cierreId: 'cierre-1' } });
    expect(s.d['accion']).toBe('comprobante');
    const texto = cuerpos(s).join('\n');
    expect(texto).toContain('los datos coinciden');
    expect(texto).toMatch(/pas[ée] tu pedido/i);
    expect(texto).not.toMatch(PROHIBIDAS);
    expect(params(plantillas(s).find((a) => a['para'] === AV1)!)[3]).toBe('comprobante: datos coinciden');
    const clases = s.armados.filter((a) => a['para'] === AV1).map((a) => a['clase']);
    expect(clases).toEqual(['plantilla', 'detalle', 'imagen']);
    expect(s.armados.find((a) => a['clase'] === 'imagen')!['payload'].image.id).toBe('media-9');
    expect(estadoDe(m)['paso']).toBe('menu');
  });

  it('no cuadra: el cliente lee que algunos datos no coinciden; completo ve las diferencias y cocina no', () => {
    const { m } = pagando();
    turno(m, { from: AV1, texto: 'hola' });
    turno(m, { from: AV2, texto: 'hola' });
    const s = comprobante(m, { statusCode: 200, body: { resultado: 'no_cuadra', diferencias: ['El comprobante dice 50 y el pedido es de 55'] } });
    expect(cuerpos(s).join('\n')).toContain('no coinciden');
    expect(cuerpos(s).join('\n')).not.toMatch(PROHIBIDAS);
    expect(params(plantillas(s)[0]!)[3]).toBe('comprobante: NO coinciden los datos');
    const detalleCompleto = cuerpoDe(s.armados.find((a) => a['para'] === AV1 && a['clase'] === 'detalle')!);
    const detalleCocina = cuerpoDe(s.armados.find((a) => a['para'] === AV2 && a['clase'] === 'detalle')!);
    expect(detalleCompleto).toContain('Diferencias:');
    expect(detalleCocina).not.toContain('Diferencias');
  });

  it('ilegible: la primera vez se pide de nuevo sin avisar; la segunda se avisa', () => {
    const { m } = pagando();
    const a = comprobante(m, { statusCode: 200, body: { resultado: 'ilegible' } });
    expect(a.armados).toEqual([]);
    expect(cuerpos(a).join('\n')).toContain('no pude leerlo bien');
    expect(estadoDe(m)['paso']).toBe('esperando_comprobante');
    const b = comprobante(m, { statusCode: 200, body: { resultado: 'ilegible' } });
    expect(b.armados.length).toBeGreaterThan(0);
    expect(params(plantillas(b)[0]!)[3]).toBe('comprobante ilegible');
    expect(estadoDe(m)['paso']).toBe('menu');
  });

  it('sin respuesta del servidor se avisa «sin cotejar», nunca «cuadra»', () => {
    const { m } = pagando();
    const s = comprobante(m, { statusCode: 500, body: {} });
    expect(params(plantillas(s)[0]!)[3]).toBe('comprobante sin cotejar');
    expect(cuerpos(s).join('\n')).not.toContain('los datos coinciden');
  });

  it('S7: la referencia del servidor de otro teléfono no se coteja contra el pedido de este: se deriva', () => {
    const { m } = pagando();
    // Un pedido guardado de OTRO teléfono; el servidor (o alguien) manda su referencia para este teléfono.
    sdDe(m)['pedidos']['ped-ajeno'] = { pedidoId: 'ped-ajeno', from: OTRO, codigo: 'ZZZZ', total: 10, lineas: [], modalidad: 'recojo' };
    m.panel = conCobro({ pedido: 'ped-ajeno', monto: 10 });
    const s = comprobante(m, { statusCode: 200, body: { resultado: 'cuadra' } });
    expect(s.p['ruta']).toContain('comprobante sin pedido en el flujo');
    expect(s.p['aviso'].tipo).toBe('transferencia');
    for (const ref of ['__proto__', 'constructor']) {
      const n = pagando().m;
      n.panel = conCobro({ pedido: ref, monto: 55 });
      expect(comprobante(n, { statusCode: 200, body: { resultado: 'cuadra' } }).p['aviso'].tipo, ref).toBe('transferencia');
    }
  });
});

describe('destinatarios: el rol por omisión es el de menos privilegio (el doble de las suites asignaba `completo`)', () => {
  it('un número sin rol queda como cocina: sin dirección ni celular del cliente en la plantilla', () => {
    const m = crear({ base: { ...BASE, destinatariosAviso: `${AV1}:Andres,${AV2}` } });
    hastaResumen(m);
    const s = turno(m, { boton: 'p|confirmar' });
    expect(s.armados.map((a) => a['rol'])).toEqual(['cocina', 'cocina']);
    for (const a of s.armados) {
      expect(params(a).join('\n')).not.toMatch(/Calle Falsa|portón|\bcel\b/);
      expect(params(a).join('\n')).not.toContain(CLIENTE);
    }
  });

  it('un rol desconocido también es cocina, y «completo» (con cualquier mayúscula) es el único que ve el celular', () => {
    const m = crear({ base: { ...BASE, destinatariosAviso: `jefe:${AV1},COMPLETO:${AV2}:Silvana` } });
    hastaResumen(m);
    const s = turno(m, { boton: 'p|confirmar' });
    expect(s.armados.map((a) => [a['para'], a['rol']])).toEqual([[AV1, 'cocina'], [AV2, 'completo']]);
    expect(params(s.armados[1]!).join('\n')).toContain(`cel ${CLIENTE}`);
    expect(params(s.armados[0]!).join('\n')).not.toContain(CLIENTE);
  });
});

describe('R7: la ubicación compartida se toma como dirección del delivery', () => {
  it('con delivery, tras pedir la dirección, compartir la ubicación avanza al resumen y el restaurante recibe las coordenadas', () => {
    const m = crear();
    turno(m, { texto: 'hola' });
    const pide = turno(m, { texto: 'quiero 1 orden de tacos de birria', extraccion: {
      lineas: [{ producto: 'tacos de birria', cantidad: 1, forma: 'orden', detalle: '' }], entrega: 'delivery', direccion: '', referencia: 'portón azul', nombre: 'Ana Pérez',
    } });
    expect(estadoDe(m)['paso']).toBe('pedido_datos');
    expect(cuerpos(pide).join('\n')).toContain('la dirección exacta');
    const s = turno(m, { tipo: 'location', ubicacion: { latitude: -16.5, longitude: -68.15, name: '', address: '' } });
    expect(s.d['motivo']).toBe('ubicacion');
    expect(estadoDe(m)['entrega']['ubicacion']).toEqual({ lat: -16.5, lng: -68.15 });
    expect(estadoDe(m)['paso']).toBe('pedido_confirmar');
    expect(cuerpos(s).join('\n')).toContain('ubicación compartida');
    expect(botonesDe(clientes(s)[0]!)).toEqual(['p|confirmar', 'p|cambiar']);
    const c = turno(m, { boton: 'p|confirmar' });
    const completo = c.armados.find((a) => a['para'] === AV1)!;
    expect(params(completo)[2]).toContain('ubicación compartida (-16,50000; -68,15000)');
    expect(params(completo)[2]).not.toContain('[enlace omitido]');
  });

  it('negado: una ubicación fuera de rango, o en un pedido de recojo, no sirve y se vuelve a pedir la dirección', () => {
    const m = crear();
    turno(m, { texto: 'hola' });
    turno(m, { texto: 'quiero 1 orden de tacos de birria', extraccion: {
      lineas: [{ producto: 'tacos de birria', cantidad: 1, forma: 'orden', detalle: '' }], entrega: 'delivery', referencia: 'portón azul', nombre: 'Ana Pérez',
    } });
    turno(m, { tipo: 'location', ubicacion: { latitude: 120, longitude: -68.15 } });
    expect(estadoDe(m)['entrega']['ubicacion']).toBeUndefined();
    expect(estadoDe(m)['paso']).toBe('pedido_datos');
    const recojo = crear();
    hastaResumen(recojo, 'recojo');
    turno(recojo, { tipo: 'location', ubicacion: { latitude: -16.5, longitude: -68.15 } });
    expect(estadoDe(recojo)['entrega']['ubicacion']).toBeUndefined();
  });
});

// =================================================================================================
describe('S6: los topes por teléfono y por hora, de punta a punta', () => {
  const pedirYConfirmar = (m: Mundo, from = CLIENTE): Salida => {
    hastaResumen(m, 'recojo', from);
    return turno(m, { from, boton: 'p|confirmar' });
  };

  it('el séptimo aviso de pedido del mismo teléfono dentro de la hora no se arma; otro teléfono y la hora siguiente, sí', () => {
    const m = crear();
    for (let i = 0; i < 6; i++) {
      const s = pedirYConfirmar(m);
      expect(s.armados.length, `pedido ${i + 1}`).toBeGreaterThan(0);
      m.ahora += MIN;
    }
    expect(sdDe(m)['avisosPedido'][CLIENTE]).toHaveLength(6);
    const septimo = pedirYConfirmar(m);
    expect(septimo.armados).toEqual([]);
    expect(erroresAvisos(septimo).some((e) => e.startsWith('tope_pedidos_hora'))).toBe(true);
    // El cliente no lee que se pasó el pedido: lo que sale es el aviso honesto con el botón.
    expect(cuerpos(septimo).join('\n')).toContain('No pude pasarle tu pedido al restaurante');
    expect(pedirYConfirmar(m, OTRO).armados.length).toBeGreaterThan(0);
    m.ahora += 61 * MIN;
    expect(pedirYConfirmar(m).armados.length).toBeGreaterThan(0);
  });

  it('un aviso de pedido que falló en Graph no cuenta para el tope', () => {
    const m = crear({ base: { ...BASE, topePedidosHora: 1 } });
    hastaResumen(m, 'recojo');
    const cayo = turno(m, { boton: 'p|confirmar', envio: (arm) => arm.map(() => FALLA) });
    expect(cayo.armados.length).toBeGreaterThan(0);
    expect(sdDe(m)['avisosPedido']).toBeUndefined();
    const otra = pedirYConfirmar(m);
    expect(otra.armados.length).toBeGreaterThan(0);
  });

  it('`sd.pedidos` no pasa de 500: con 520 pedidos guardados, el nuevo entra y los más antiguos salen', () => {
    const m = crear({ panel: conCobro() });
    const viejos: J = {};
    for (let i = 0; i < 520; i++) viejos[`ped-${i}`] = { pedidoId: `ped-${i}`, from: OTRO, total: 10, guardadoMs: m.ahora - 60 * MIN + i };
    sdDe(m)['pedidos'] = viejos;
    hastaResumen(m);
    const c = turno(m, { boton: 'p|confirmar' });
    const claves = Object.keys(sdDe(m)['pedidos']);
    expect(claves).toHaveLength(500);
    expect(claves).toContain(String(clientes(c)[0]!['referencia']));
    expect(claves).not.toContain('ped-0');
  });
});

describe('entradas hostiles: doce textos de 1.500 caracteres, cada turno en menos de 50 ms y sin romper nada', () => {
  const HOSTILES: [string, string][] = [
    ['ceros de ancho', '​'.repeat(1500)],
    ['puntos medios', '·'.repeat(1500)],
    ['puntos medios con espacios', ' · '.repeat(500)],
    ['palabras con punto', 'a.'.repeat(750)],
    ['saltos de línea', '\n'.repeat(1500)],
    ['espacios y una letra', ' '.repeat(1499) + 'x'],
    ['palabras prohibidas', 'pago validado y acreditado, ya lo preparan '.repeat(40)],
    ['formato de WhatsApp', '*_~`'.repeat(375)],
    ['enlaces', 'https://malo.test/a?b=c www.malo.test bit.ly/x '.repeat(32)],
    ['HTML y llaves', '<script>{{1}}</script>&'.repeat(65)],
    ['ancho completo y bidireccional', 'ｖａｌｉｄａｄｏ‮'.repeat(115)],
    ['guiones y puntos', 'a-'.repeat(375) + '.'.repeat(750)],
  ];
  const recorte = (s: string): string => Array.from(s).slice(0, 1500).join('');

  it('como mensaje suelto en el menú, como pedido de una persona y como motivo de la derivación', () => {
    expect(HOSTILES).toHaveLength(12);
    for (const [nombre, h] of HOSTILES) {
      const texto = recorte(h);
      // 1. Un mensaje cualquiera en el menú.
      const a = turno(crear(), { texto });
      expect(a.tiempoMs, `${nombre} (menú)`).toBeLessThan(50);
      expect(a.descartado).toBe(false);
      for (const c of cuerpos(a)) expect(c.normalize('NFKC'), nombre).not.toMatch(PROHIBIDAS);
      // 2. Pide una persona con ese texto de motivo: el aviso con el detalle sale limpio.
      const m = crear();
      turno(m, { from: AV1, texto: 'hola' }); // abre la ventana: sale el detalle además de la plantilla
      const b = turno(m, { texto: 'quiero hablar con una persona ' + recorte(h).slice(0, 1470) });
      expect(b.tiempoMs, `${nombre} (derivación)`).toBeLessThan(50);
      expect(b.armados.length, nombre).toBeGreaterThan(0);
      for (const arm of b.armados) {
        const textos = arm['payload'].type === 'template' ? params(arm) : [cuerpoDe(arm)];
        for (const t of textos) {
          expect(t.normalize('NFKC').replace(/\p{Cf}/gu, ''), nombre).not.toMatch(PROHIBIDAS);
          expect(t, nombre).not.toMatch(/https?:\/\/|www\.|bit\.ly|[{}<>&]/);
          if (arm['payload'].type === 'template') expect(t, nombre).not.toMatch(/[\r\n\t]/);
        }
      }
      // 3. Como dirección, referencia y nota de un pedido: el resumen sale con botones y el estado avanza.
      const p = crear();
      turno(p, { texto: 'hola' });
      turno(p, { texto: 'quiero 1 orden de tacos de birria', extraccion: { lineas: [{ producto: 'tacos de birria', cantidad: 1, forma: 'orden', detalle: texto.slice(0, 120) }], entrega: 'delivery' } });
      const r = turno(p, { texto: 'mi dirección', extraccion: { lineas: [], entrega: 'delivery', direccion: texto.slice(0, 200), referencia: texto.slice(0, 150), nombre: texto.slice(0, 80) } });
      expect(r.tiempoMs, `${nombre} (pedido)`).toBeLessThan(50);
      expect(r.descartado).toBe(false);
      for (const c of cuerpos(r)) expect(c.normalize('NFKC'), nombre).not.toMatch(PROHIBIDAS);
    }
  });

  it('también el nombre de perfil hostil: sin palabras prohibidas y sin romper el turno', () => {
    for (const [nombre, h] of HOSTILES) {
      const s = turno(crear(), { texto: 'hola', nombrePerfil: recorte(h) });
      expect(s.tiempoMs, nombre).toBeLessThan(50);
      expect(String(s.t['nombrePerfil']).length, nombre).toBeLessThanOrEqual(60);
      expect(String(s.t['nombrePerfil']).normalize('NFKC'), nombre).not.toMatch(PROHIBIDAS);
    }
  });
});

// =================================================================================================
describe('las tres copias de la red de prohibidas y las expresiones regulares', () => {
  const FUENTES: [string, string][] = [['VM_PROHIBIDAS', 'comun'], ['AV_PROHIBIDAS', 'avisos'], ['CB_PROHIBIDAS', 'cobro']];
  const literal = (nombre: string, lib: string): string => {
    const m = new RegExp(`const ${nombre} = /(.+)/i;`).exec(leer(`lib/${lib}.js`));
    if (!m) throw new Error(`sin ${nombre} en ${lib}.js`);
    return m[1]!;
  };

  it('VM_PROHIBIDAS, AV_PROHIBIDAS y CB_PROHIBIDAS son idénticas por `source`, y con la bandera `i` sola', () => {
    const fuentes = FUENTES.map(([n, l]) => literal(n, l));
    expect(new Set(fuentes).size).toBe(1);
    expect(fuentes[0]).toContain('|acredit|');
    expect(fuentes[0]).toContain('reservad');
    // La copia que usan las pruebas de esta suite coincide con las tres.
    expect(PROHIBIDAS.source).toBe(fuentes[0]);
    // Sin la bandera `g` ni `y` (con ellas, `.test` guardaría estado entre llamadas): el literal termina en `/i;`.
    for (const [n, l] of FUENTES) expect(new RegExp(`const ${n} = /.+/i;`).test(leer(`lib/${l}.js`)), n).toBe(true);
  });

  it('ninguna librería ni nodo trae un cuantificador anidado del tipo `(\\s*X\\s*)+` (retroceso exponencial)', () => {
    const archivos = ['comun', 'pedido', 'reserva', 'promos', 'avisos', 'cobro'].map((n) => [`lib/${n}.js`, leer(`lib/${n}.js`)] as const)
      .concat(['carga-de-entrada', 'config-del-negocio', 'interpretar-entrada', 'decidir-turno', 'plan-del-turno', 'armar-avisos', 'armar-mensajes']
        .map((n) => [`nodos/${n}.js`, leer(`nodos/${n}.js`)] as const));
    for (const [nombre, fuente] of archivos) {
      const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      // Un grupo que EMPIEZA con un átomo cuantificado (`\s*`, `\w+`, `.*`, `[a-z]+`), repetido con `+` o `*`: `(\s*·\s*)+`,
      // `(.*)*`, `([a-z]+)+`. Los grupos con un separador obligatorio, como `\d+(?:[.,]\d+)*`, no son ambiguos y no entran.
      expect(sinComentarios, nombre).not.toMatch(/\((?:\?:)?(?:\\[sSwWdD]|\.|\[[^\]\n]*\])[*+][^()\n]*\)[*+]/);
    }
  });
});
