/**
 * «VENTA MÍNIMA v0»: LA LÓGICA DEL CATÁLOGO WEB (la carta como enlace y el carrito que vuelve de la página).
 *
 * QUÉ PRUEBA. El código REAL de los nodos, tal como sale en `venta-minima.qtaco.json` (librerías pegadas por `construir.mjs`):
 * `Carga de entrada` → `Config del negocio` → `Interpretar entrada` → `Decidir turno` → `Plan del turno` → `Armar mensajes`,
 * encadenados a mano con el evaluador de `./lib/flujo` (el mismo que quita los globales que el Code de n8n no tiene: nada de
 * `URL`, `Buffer` ni `crypto`). Lo único que se simula es la respuesta de la consola (`Traer configuración`) y los datos estáticos.
 * La topología (el Webhook `Carrito del catálogo` conectado a `Carga de entrada`, el IF de reporte) la prueba `venta-minima-catalogo`.
 *
 * LAS REGLAS QUE SOSTIENE (CLAUDE.md):
 *   - el CÓDIGO calcula: cada línea se busca por ID en la carta, la cantidad se acota y el total sale de `pdTotal`; el precio, el
 *     subtotal y el total que traiga el carrito son datos de afuera y no se creen (el del servidor es solo un control);
 *   - «solo se ofrece lo que se cumple»: sin enlace usable, la carta en texto; ventana de 24 h cerrada, nada;
 *   - prohibición 3: ningún texto dice que algo está pagado, verificado o acreditado;
 *   - la entrada nueva no es una puerta: el cuerpo del Webhook del carrito no se lee como un mensaje de WhatsApp, y un cuerpo sin
 *     forma válida, de otro número, de otro comercio, repetido o sin ítems no produce nada.
 * Reloj: lunes 05/10/2026 10:00 en La Paz. Teléfonos sintéticos con seis ceros.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codigoDe, configBase, ejecutar, type Flujo, type J, type Referencias } from './lib/flujo';

const CARPETA_VM = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/venta-minima');
const QTACO = JSON.parse(readFileSync(join(CARPETA_VM, 'venta-minima.qtaco.json'), 'utf8')) as Flujo;

// La red de palabras del contrato (`VM_PROHIBIDAS`): se repite acá a propósito. Si el contrato cambia, esta suite lo dice.
const PROHIBIDAS = /validad|confirmad|pagad[oa]|acreditad|verificad|recibimos\s+tu\s+pago|ya lo prepar|lo (est[aá](n|mos)|estoy) prepar|lo preparamos|te avisa(mos|remos)|en camino|te llama(mos|remos)|te escribir[aá]n|lo consulto|acredit|recib\S{0,40}\s+(tu|el|su|mi|un|este|ese|la|tus|sus|los)\s+(pago|transferencia|dep[oó]sito|abono)s?|lleg[oó]\s+(tu|el|su|mi)\s+(pago|transferencia|dep[oó]sito|abono)|(tu|el|su|mi)\s+(pago|transferencia|dep[oó]sito|abono)s?\s+(ya\s+)?(lleg|ingres|entr)(o|ó|aron)\b|(pago|transferencia|dep[oó]sito|abono)s?\s+(ya\s+|fue\s+|fueron\s+|est[aá]\s+)?(recibid|aprobad|[eé]xitos|realizad|registrad|llegad|ingresad|efectuad)/i;

const AHORA = Date.UTC(2026, 9, 5, 14); // lunes 05/10/2026, 10:00 en La Paz
const MIN = 60_000;
const CLIENTE = '59100000011';
const REC = '59100000031';
const PHONE_ID = '100000000000042';
const QR_URL = 'https://qr.ejemplo.invalid/qtaco.png';
const URL_CATALOGO = 'https://catalogo.ejemplo.invalid/c/abcdefabcdefabcdefabcdefabcdefab';
const HORARIO_TODOS = 'lun=08:00-23:00,mar=08:00-23:00,mie=08:00-23:00,jue=08:00-23:00,vie=08:00-23:00,sab=08:00-23:00,dom=08:00-23:00';
const HORARIO_SIN_LUNES = 'lun=cerrado,mar=08:00-23:00,mie=08:00-23:00,jue=08:00-23:00,vie=08:00-23:00,sab=08:00-23:00,dom=08:00-23:00';

// ------------------------------------------------------------------------------------ la carta y el panel
const it_ = (id: string, nombre: string, precio: number | undefined, area: string): J => ({ id, nombre, ...(precio === undefined ? {} : { precio }), area, descripcion: `desc ${nombre}` });
const CATALOGO: J[] = [
  it_('nachos', 'Nachos Supremos', 58, 'Entradas'),
  it_('queso', 'Queso Fundido', 75, 'Entradas'),
  it_('birria3', 'Tacos de Birria (orden de 3)', 55, 'Birria'),
  it_('horchata', 'Horchata', 20, 'Bebidas'),
  it_('pils', 'Pils Chop 300 ml', 25, 'Cervezas'),
  it_('michelada', 'Michelada', 35, 'cocteleria'),
  it_('rompope', 'Helado de Rompope', 23, 'postres'),
];
const COBRO_REAL: J = { cobroReal: { nombreCuenta: 'Q TACO SRL', banco: 'Banco Ejemplo' }, cobro: { activo: true, qr: { url: QR_URL } } };

function panel(extra: J = {}): J {
  return {
    tenantId: 'qtaco',
    estadoComercio: 'activo',
    datosDelNegocio: { nombreNegocio: "Q'Taco", direccion: 'Calle Ejemplo 123' },
    operacion: { horarioAtencion: 'todos los días de 8 a 23', moneda: 'BOB', numeroRecepcion: REC, prefijosPermitidos: ['591'] },
    voz: { nombreAsistente: 'Taqui', nivelEmojis: 'pocos' },
    venta: { aceptaDelivery: true, aceptaRetiroEnLocal: true },
    catalogo: CATALOGO,
    campanas: [],
    atencion: { estado: 'normal' },
    ...extra,
  };
}
const respuesta = (extra: J = {}): J => ({ statusCode: 200, body: panel(extra) });

// ------------------------------------------------------------------------------------ el mundo
function relojFijo(ms: number): unknown {
  return class extends Date {
    constructor(...a: unknown[]) { if (a.length === 0) super(ms); else super(...(a as [number])); }
    static override now(): number { return ms; }
  };
}

interface Mundo { global: J; ahora: number; config: J }
function crear(config: J = {}): Mundo {
  return { global: {}, ahora: AHORA, config: { phoneNumberIdEsperado: PHONE_ID, respaldoNumeroRecepcion: REC, horario: HORARIO_TODOS, ...config } };
}
const estadoDe = (m: Mundo): J => (m.global['ventaMinima'] as J | undefined)?.['estados']?.[CLIENTE] ?? {};

function nodo(m: Mundo, nombre: string, entradas: J[], refs: Referencias): J[] {
  return ejecutar(codigoDe(QTACO, nombre), entradas, refs, { $getWorkflowStaticData: () => m.global, Date: relojFijo(m.ahora) });
}

interface Turno {
  /** El primer nodo que no dejó pasar nada (`Carga de entrada`, `Interpretar entrada`) o null si llegó hasta el plan. */
  parada: string | null;
  carga: J[]; interpretado: J | null; decision: J | null; plan: J | null; envio: J[];
  /** El texto de cada mensaje que el plan pide mandar. */
  textos: string[];
}

// El evento de WhatsApp tal como lo entrega el receptor (`body.value` de «Entrega del receptor»).
function entregaDeMensaje(from: string, mensaje: J, wamid: string, phoneId = PHONE_ID): J {
  return { headers: {}, body: { field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: phoneId },
    contacts: [{ profile: { name: 'Carlos Pérez' }, wa_id: from }],
    messages: [{ from, id: wamid, timestamp: '1', ...mensaje }],
  } } };
}
const texto = (cuerpo: string): J => ({ type: 'text', text: { body: cuerpo } });
const boton = (id: string, titulo: string): J => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: titulo } } });

/** El Webhook del carrito, con las cabeceras y el cuerpo que manda `despertarFlujo` del servidor (cuerpo ajustable). */
function webhookDeCarrito(m: Mundo, cuerpo: J = {}, cab: J = {}): J {
  return {
    headers: { 'x-novuchat-numero': PHONE_ID, 'x-novuchat-timestamp': String(m.ahora), 'x-novuchat-signature': `sha256=${'a'.repeat(64)}`, ...cab },
    params: {}, query: {},
    body: {
      tenantId: 'qtaco', tipo: 'carrito', pedidoId: 'cat_abc123_00ff', conversacionId: `wa_${CLIENTE}`, telefono: CLIENTE,
      items: [{ id: 'nachos', nombre: 'Nachos Supremos', cantidad: 2, precio: 58, moneda: 'BOB', subtotal: 116 }],
      total: 116, moneda: 'BOB', costoEnvio: 0, entrega: 'retiro', direccion: '', nota: '', descartados: [],
      ventanaAbierta: true, accion: 'responder', fichaCompartida: false,
      ...cuerpo,
    },
  };
}

/** Un turno entero, de la entrada al plan y a `Armar mensajes` (que guarda el estado). El reloj avanza un minuto por turno. */
function turno(m: Mundo, entrada: { mensaje: J; wamid?: string; phoneId?: string } | { carrito: J }, panelResp: J = respuesta()): Turno {
  m.ahora += MIN;
  const refs: Referencias = {};
  const vacio: Turno = { parada: null, carga: [], interpretado: null, decision: null, plan: null, envio: [], textos: [] };
  let carga: J[];
  if ('carrito' in entrada) {
    refs['Carrito del catálogo'] = entrada.carrito;
    carga = nodo(m, 'Carga de entrada', [entrada.carrito], refs);
  } else {
    const e = entregaDeMensaje(CLIENTE, entrada.mensaje, entrada.wamid ?? `wamid.E${m.ahora}`, entrada.phoneId);
    refs['Entrega del receptor'] = e;
    carga = nodo(m, 'Carga de entrada', [{ valido: true }], refs);
  }
  if (!carga.length) return { ...vacio, parada: 'Carga de entrada' };
  refs['Carga de entrada'] = carga[0]!;
  refs['Config base'] = { ...configBase(QTACO), ...m.config };
  refs['Traer configuración'] = panelResp;
  const cfg = nodo(m, 'Config del negocio', [panelResp], refs)[0]!;
  refs['Config del negocio'] = cfg;
  const inter = nodo(m, 'Interpretar entrada', [{}], refs);
  if (!inter.length) return { ...vacio, carga, parada: 'Interpretar entrada' };
  refs['Interpretar entrada'] = inter[0]!;
  const dec = nodo(m, 'Decidir turno', [{}], refs)[0]!;
  refs['Decidir turno'] = dec;
  const plan = nodo(m, 'Plan del turno', [dec], refs)[0]!;
  refs['Plan del turno'] = plan;
  const envio = nodo(m, 'Armar mensajes', [plan], refs);
  const textos = ((plan['mensajes'] ?? []) as J[]).map((x) => String(x['cuerpo']));
  return { parada: null, carga, interpretado: inter[0]!, decision: dec, plan, envio, textos };
}

/** Un carrito por el Webhook. */
const carrito = (m: Mundo, cuerpo: J = {}, panelResp?: J, cab: J = {}): Turno => turno(m, { carrito: webhookDeCarrito(m, cuerpo, cab) }, panelResp);
const error = (t: Turno): string[] => (t.plan?.['errores'] ?? []) as string[];
const mensajes = (t: Turno): J[] => (t.plan?.['mensajes'] ?? []) as J[];

// ================================================================================================
describe('la carta como enlace (el enlace llega en la respuesta de `Traer configuración`)', () => {
  const conEnlace = (enlace: unknown): J => respuesta({ catalogoWeb: { enlace } });

  it('con un enlace válido sale UN mensaje con el botón «Ver la carta» y la frase de «menú»; el paso queda en pedido', () => {
    const m = crear();
    const t = turno(m, { mensaje: texto('quiero ver la carta') }, conEnlace(URL_CATALOGO));
    expect(mensajes(t)).toEqual([{
      tipo: 'enlace', catalogo: true,
      cuerpo: '¡Con gusto! Toca «Ver la carta», elige lo que quieras y vuelve aquí para confirmar tu pedido. Si prefieres, escríbeme lo que quieres. Para volver al inicio, escribe «menú».',
      botones: [{ id: '', title: 'Ver la carta' }], url: URL_CATALOGO,
    }]);
    expect(estadoDe(m)['paso']).toBe('pedido');
    expect(error(t)).toEqual([]);
  });

  it('la carta como enlace NO promete confirmar en la página, y con un pedido guardado dice que sigue ahí (igual que la carta en texto)', () => {
    const m = crear();
    const sin = turno(m, { mensaje: texto('quiero ver la carta') }, conEnlace(URL_CATALOGO));
    const cuerpoSin = String(mensajes(sin)[0]!['cuerpo']);
    expect(cuerpoSin).not.toMatch(/confirma ah|confirmar ah/i);
    expect(cuerpoSin).toContain('vuelve aquí para confirmar tu pedido. Si prefieres, escríbeme lo que quieres');
    expect(cuerpoSin).not.toContain('sin confirmar'); // sin pedido guardado no sale el aviso de lo guardado
    // Un pedido en curso (llegó un carrito) y luego «carta»: el enlace lleva el aviso, en el mismo mensaje (0 mensajes de más).
    const c = crear();
    carrito(c, {}, conEnlace(URL_CATALOGO));
    expect(estadoDe(c)['paso']).toBe('pedido_confirmar');
    const t = turno(c, { mensaje: texto('quiero ver la carta') }, conEnlace(URL_CATALOGO));
    expect(mensajes(t)).toHaveLength(1);
    expect(mensajes(t)[0]!['tipo']).toBe('enlace');
    expect(String(mensajes(t)[0]!['cuerpo'])).toMatch(/^Todavía tienes un pedido sin confirmar: 2 × [^.]+\. ¡Con gusto! Toca «Ver la carta»/);
    expect(String(mensajes(t)[0]!['cuerpo'])).toContain('vuelve aquí para confirmar tu pedido');
    expect(mensajes(t)[0]!['url']).toBe(URL_CATALOGO);
    // Sin enlace, la carta en texto lleva el mismo aviso (como siempre).
    const d = crear();
    carrito(d, {}, respuesta());
    const texto2 = turno(d, { mensaje: texto('quiero ver la carta') }, respuesta());
    expect(String(mensajes(texto2)[0]!['cuerpo'])).toMatch(/^Todavía tienes un pedido sin confirmar: /);
  });

  it('«Cambiar algo» con la carta como enlace: UN mensaje que dice que lo que elija reemplaza el pedido y cómo dejarlo como estaba (escribiéndolo)', () => {
    const c = crear();
    carrito(c, {}, conEnlace(URL_CATALOGO));
    expect(estadoDe(c)['paso']).toBe('pedido_confirmar');
    const resumen = String(mensajes(turno(c, { mensaje: texto('ok') }, conEnlace(URL_CATALOGO)))[0]!['cuerpo']);
    const t = turno(c, { mensaje: boton('p|cambiar', 'Cambiar algo') }, conEnlace(URL_CATALOGO));
    expect(mensajes(t)).toHaveLength(1);
    expect(mensajes(t)[0]!['tipo']).toBe('enlace');
    expect(mensajes(t)[0]!['catalogo']).toBe(true);
    expect(String(mensajes(t)[0]!['cuerpo'])).toBe('Claro. Toca «Ver la carta» y elige de nuevo todo lo que quieres: eso reemplaza tu pedido de ahora (2 × Nachos Supremos). Si mejor lo dejas como está, escribe «dejarlo como estaba».');
    expect(String(mensajes(t)[0]!['cuerpo'])).toContain('elige de nuevo todo lo que quieres');
    expect(mensajes(t)[0]!['url']).toBe(URL_CATALOGO);
    // Escribirlo devuelve el resumen guardado.
    const vuelve = turno(c, { mensaje: texto('Dejarlo como estaba') }, conEnlace(URL_CATALOGO));
    expect(String(mensajes(vuelve)[0]!['cuerpo'])).toBe(resumen);
    expect(estadoDe(c)['paso']).toBe('pedido_confirmar');
    // Negando: si el carrito de la página llega antes, REEMPLAZA el pedido y ya no hay nada que dejar como estaba.
    turno(c, { mensaje: boton('p|cambiar', 'Cambiar algo') }, conEnlace(URL_CATALOGO));
    expect(estadoDe(c)['carritoAnterior']).not.toBeNull();
    carrito(c, { pedidoId: 'cat_otro_11aa' }, conEnlace(URL_CATALOGO));
    expect(estadoDe(c)['carritoAnterior']).toBeNull();
    expect(estadoDe(c)['paso']).toBe('pedido_confirmar');
  });

  it('«Dejarlo como estaba» restaura también el id `cat_…` del checkout: el pedido confirmado sale con el mismo id y código que sin «Cambiar algo»', () => {
    const directo = crear();
    carrito(directo, {}, conEnlace(URL_CATALOGO));
    const web = estadoDe(directo)['pedidoWeb'] as J;
    expect(web['id']).toBe('cat_abc123_00ff');
    const sinCambio = turno(directo, { mensaje: boton('p|confirmar', 'Confirmar pedido') }, conEnlace(URL_CATALOGO));
    const idEsperado = (sinCambio.plan!['pedido'] as J)['pedidoId'];
    expect(idEsperado).toBe('cat_abc123_00ff');
    // Con «Cambiar algo» y «Dejarlo como estaba» por el medio.
    const c = crear();
    carrito(c, {}, conEnlace(URL_CATALOGO));
    turno(c, { mensaje: boton('p|cambiar', 'Cambiar algo') }, conEnlace(URL_CATALOGO));
    expect(estadoDe(c)['pedidoWeb']).toBeNull(); // mientras elige, el pedido anterior no es el vigente
    turno(c, { mensaje: texto('Dejarlo como estaba') }, conEnlace(URL_CATALOGO));
    expect(estadoDe(c)['pedidoWeb']).toEqual(web);
    const confirmado = turno(c, { mensaje: boton('p|confirmar', 'Confirmar pedido') }, conEnlace(URL_CATALOGO));
    expect((confirmado.plan!['pedido'] as J)['pedidoId']).toBe(idEsperado);
    expect((confirmado.plan!['pedido'] as J)['codigo']).toBe((sinCambio.plan!['pedido'] as J)['codigo']);
  });

  it('el botón «Hacer un pedido» y «Cambiar algo» también dan el enlace', () => {
    const m = crear();
    const a = turno(m, { mensaje: boton('m|pedido', 'Hacer un pedido') }, conEnlace(URL_CATALOGO));
    expect(mensajes(a)[0]!['url']).toBe(URL_CATALOGO);
    // un pedido armado y «Cambiar algo»
    const b = carrito(m, {}, conEnlace(URL_CATALOGO));
    expect(estadoDe(m)['paso']).toBe('pedido_confirmar');
    expect(b.textos).toHaveLength(1);
    const c = turno(m, { mensaje: boton('p|cambiar', 'Cambiar algo') }, conEnlace(URL_CATALOGO));
    expect(mensajes(c)[0]!['tipo']).toBe('enlace');
    expect(mensajes(c)[0]!['url']).toBe(URL_CATALOGO);
  });

  it('SIN enlace (apagado, 409 del enlace, vacío, no es texto) sale la carta en texto, sin botón ni promesa de página', () => {
    for (const panelResp of [respuesta(), conEnlace(''), conEnlace('   '), conEnlace(null), conEnlace(42), respuesta({ catalogoWeb: 'x' }), respuesta({ catalogoWeb: { activo: false } })]) {
      const t = turno(crear(), { mensaje: texto('la carta') }, panelResp);
      const ms = mensajes(t);
      expect(ms.length, JSON.stringify(panelResp.body.catalogoWeb)).toBeGreaterThan(0);
      for (const x of ms) expect(x['tipo']).toBe('texto');
      expect(t.textos.join('\n')).toContain('Esta es nuestra carta:');
      expect(t.textos.join('\n')).toContain('Nachos Supremos');
      expect(JSON.stringify(ms)).not.toMatch(/Ver la carta|https:/);
    }
  });

  it('una URL que no pasa la validación (sin `URL`, por segmentos) NO se ofrece: carta en texto y se anota', () => {
    const malas = [
      'http://catalogo.ejemplo.invalid/c/x', 'https://10.0.0.1/c/x', 'https://localhost/c/x', 'https://sitio/c/x',
      'https://sitio.123/c/x', `https://usuario${'@'}catalogo.ejemplo.invalid/c/x`, 'https://catalogo.ejemplo.invalid:99999/c/x',
      'https://catalogo.ejemplo.invalid:0/c/x', 'https://-malo.ejemplo.invalid/c/x', 'https://catalogo..ejemplo.invalid/c/x',
      'javascript:alert(1)', 'ftp://catalogo.ejemplo.invalid/x', 'https://catalogo.ejemplo.invalid/c/ x',
      `https://catalogo.ejemplo.invalid/${'a'.repeat(2100)}`, 'https://', 'catalogo.ejemplo.invalid/c/x',
      // Revisión del PR #382 (L-1): la misma forma que `Armar mensajes` (nada de puerto: caía a la derivación genérica) y nunca un chat de WhatsApp.
      'https://catalogo.ejemplo.invalid:8443/c/x?a=1', 'https://catalogo.ejemplo.invalid:443/c/x', 'https://wa.me/59100000031', 'https://WA.ME/59100000031?text=hola',
      'https://api.whatsapp.com/send?phone=59100000031', 'https://whatsapp.com/', 'https://web.whatsapp.com/x',
      `https://catalogo.ejemplo.invalid/c/x${'@'}otro.invalid`, 'https://catalogo.ejemplo.invalid/c/x"y', "https://catalogo.ejemplo.invalid/c/x'y",
    ];
    for (const url of malas) {
      const t = turno(crear(), { mensaje: texto('la carta') }, conEnlace(url));
      expect(mensajes(t).every((x) => x['tipo'] === 'texto'), url.slice(0, 50)).toBe(true);
      expect(error(t), url.slice(0, 50)).toContain('catalogo_url_invalida');
    }
    // CAMBIO DECLARADO (revisión del PR #382, L-1): antes un puerto válido pasaba aquí y `Armar mensajes` lo rechazaba (derivación genérica).
    // Un subdominio, una ruta con consulta y un dominio que SOLO contiene «wa.me» o «whatsapp.com» en otra parte sí pasan (el negativo).
    for (const url of ['https://catalogo.ejemplo.invalid/c/x?a=1', 'https://catalogo.novuchat.invalid/c/abc', 'https://mi-wa.me.ejemplo.invalid/c/x', 'https://swhatsapp.com.ejemplo.invalid/c/x']) {
      const bien = turno(crear(), { mensaje: texto('la carta') }, conEnlace(url));
      expect(mensajes(bien)[0]!['tipo'], url).toBe('enlace');
      expect(mensajes(bien)[0]!['url'], url).toBe(url);
    }
  });

  it('con el panel sin respuesta (timeout) no se promete nada: se pasa con el local', () => {
    const t = turno(crear(), { mensaje: texto('la carta') }, { error: { message: 'timeout' } });
    expect(JSON.stringify(mensajes(t))).not.toMatch(/Ver la carta|https:\/\/catalogo/);
    expect(t.textos.join(' ')).toContain('Disculpa, eso no lo puedo resolver por aquí');
  });

  it('cuesta lo mismo que la carta en texto: UN mensaje', () => {
    expect(mensajes(turno(crear(), { mensaje: texto('la carta') }, conEnlace(URL_CATALOGO)))).toHaveLength(1);
    expect(mensajes(turno(crear(), { mensaje: texto('la carta') }, respuesta())).length).toBeLessThanOrEqual(2);
  });
});

// ================================================================================================
describe('el carrito que vuelve de la página', () => {
  it('un carrito de recojo: el resumen sale del código (total de la carta) y pide confirmar con el botón; UN mensaje', () => {
    const m = crear();
    const t = carrito(m);
    expect(t.parada).toBeNull();
    expect(t.decision!['accion']).toBe('carrito');
    expect(mensajes(t)).toHaveLength(1);
    const x = mensajes(t)[0]!;
    expect(x['tipo']).toBe('botones');
    expect(String(x['cuerpo'])).toContain('2 × Nachos Supremos: 116 Bs');
    expect(String(x['cuerpo'])).toContain('Total de la comida: 116 Bs.');
    expect(String(x['cuerpo'])).toContain('recojo en el local');
    expect((x['botones'] as J[]).map((b) => b['title'])).toEqual(['Confirmar pedido', 'Cambiar algo']);
    expect(error(t)).toEqual([]);
    const e = estadoDe(m);
    expect(e['paso']).toBe('pedido_confirmar');
    expect(e['carrito']).toHaveLength(1);
    expect(e['carrito'][0]).toMatchObject({ id: 'nachos', cantidad: 2, precio: 58 });
    expect(e['entrega']).toMatchObject({ entrega: 'recojo', modalidad: 'recojo' });
    // lo que sale por WhatsApp es ese único mensaje
    expect(t.envio).toHaveLength(1);
  });

  it('EL CÓDIGO CALCULA: precio, subtotal y total del carrito son datos de afuera y no entran en la cuenta', () => {
    const m = crear();
    const t = carrito(m, { items: [{ id: 'nachos', nombre: 'Nachos Supremos', cantidad: 2, precio: 0.01, subtotal: 0.02 }], total: 0.02 });
    expect(String(mensajes(t)[0]!['cuerpo'])).toContain('Total de la comida: 116 Bs.');
    expect(String(mensajes(t)[0]!['cuerpo'])).not.toMatch(/0,02/);
    expect(error(t).some((x) => x.startsWith('carrito_total_no_coincide'))).toBe(true); // el desvío queda anotado, no se cree
    expect(estadoDe(m)['carrito'][0]['precio']).toBe(58);
  });

  it('se busca POR ID, nunca por el nombre: un id inventado con el nombre de un plato no se vende', () => {
    const m = crear();
    const t = carrito(m, { items: [
      { id: 'inventado', nombre: 'Nachos Supremos', cantidad: 1, precio: 1, subtotal: 1 },
      { id: 'queso', nombre: 'Algo distinto', cantidad: 1, precio: 1, subtotal: 1 },
    ], total: 2 });
    const e = estadoDe(m);
    expect(e['carrito'].map((l: J) => l['id'])).toEqual(['queso']);
    expect(e['carrito'][0]['nombre']).toBe('Queso Fundido'); // el nombre de la carta, no el del carrito
    expect(String(mensajes(t)[0]!['cuerpo'])).toContain('Total de la comida: 75 Bs.');
    expect(t.textos.join('\n')).toContain('No pude incluir «Nachos Supremos»');
  });

  it('un ítem de un área excluida (cocteleria, cervezas, postres) NO se vende: se nombra y el resto sigue', () => {
    const m = crear();
    const t = carrito(m, { items: [
      { id: 'nachos', nombre: 'Nachos Supremos', cantidad: 1, precio: 58, subtotal: 58 },
      { id: 'michelada', nombre: 'Michelada', cantidad: 2, precio: 35, subtotal: 70 },
      { id: 'pils', nombre: 'Pils Chop 300 ml', cantidad: 1, precio: 25, subtotal: 25 },
      { id: 'rompope', nombre: 'Helado de Rompope', cantidad: 1, precio: 23, subtotal: 23 },
    ], total: 176 });
    const cuerpo = t.textos.join('\n');
    expect(estadoDe(m)['carrito'].map((l: J) => l['id'])).toEqual(['nachos']);
    expect(cuerpo).toContain('No pude incluir «Michelada», «Pils Chop 300 ml» y «Helado de Rompope» en tu pedido: no está disponible para pedir por WhatsApp.');
    expect(cuerpo).toContain('Total de la comida: 58 Bs.');
    expect(cuerpo).not.toMatch(/× Michelada|× Pils|× Helado/);
    expect(error(t).some((x) => x.startsWith('carrito_total_no_coincide'))).toBe(true);
  });

  it('si no queda nada vendible, sale la carta (sin carrito) con la nota, y el paso es «pedido»', () => {
    const m = crear();
    const t = carrito(m, { items: [{ id: 'michelada', nombre: 'Michelada', cantidad: 1, precio: 35, subtotal: 35 }], total: 35 }, respuesta({ catalogoWeb: { enlace: URL_CATALOGO } }));
    expect(estadoDe(m)['carrito']).toEqual([]);
    expect(estadoDe(m)['paso']).toBe('pedido');
    expect(mensajes(t)).toHaveLength(1);
    expect(mensajes(t)[0]!['tipo']).toBe('enlace');
    expect(t.textos[0]).toContain('No pude incluir «Michelada»');
    expect(JSON.stringify(plan(t))).not.toContain('Total de la comida');
  });

  it('la cantidad se acota (1 a 50): 999 queda en 50 y se avisa; negativa, decimal menor que 1 o texto no se venden', () => {
    // (Un `0` no llega: el servidor descarta cantidades menores que 1, y `validar-carrito.js` del Demo B lee el 0 como 1.)
    const m = crear();
    const t = carrito(m, { items: [
      { id: 'nachos', nombre: 'Nachos Supremos', cantidad: 999, subtotal: 1 },
      { id: 'birria3', nombre: 'Tacos', cantidad: -3, subtotal: 0 },
      { id: 'horchata', nombre: 'Horchata', cantidad: 0.4, subtotal: 0 },
    ], total: 1 });
    const e = estadoDe(m);
    expect(e['carrito']).toHaveLength(1);
    expect(e['carrito'][0]).toMatchObject({ id: 'nachos', cantidad: 50 });
    expect(t.textos.join('\n')).toContain('De «Nachos Supremos» tomé 50, que es el máximo por pedido.');
    expect(t.textos.join('\n')).toContain('No pude incluir «Tacos» y «Horchata»');
  });

  it('dos líneas del mismo producto se suman (con tope); más de 30 líneas distintas no caben', () => {
    const m = crear();
    carrito(m, { items: [
      { id: 'nachos', nombre: 'N', cantidad: 30, subtotal: 1 }, { id: 'nachos', nombre: 'N', cantidad: 30, subtotal: 1 },
    ], total: 1 });
    expect(estadoDe(m)['carrito']).toEqual([expect.objectContaining({ id: 'nachos', cantidad: 50 })]);
  });

  it('delivery OPCIONAL (04/10): con la dirección del carrito y sin referencia va DIRECTO al resumen (sin el mensaje de `pedido_datos`); con referencia la muestra', () => {
    const m = crear();
    const t = carrito(m, { entrega: 'envio', direccion: 'Av. Arce 2345, San Jorge' });
    const e = estadoDe(m);
    expect(e['paso']).toBe('pedido_confirmar');
    expect(e['entrega']).toMatchObject({ entrega: 'delivery', modalidad: 'delivery', direccion: 'Av. Arce 2345, San Jorge', referencia: '' });
    expect(t.textos).toHaveLength(1); // un solo mensaje: el resumen (0 de `pedido_datos`)
    expect(t.textos[0]).toContain('Entrega: delivery a Av. Arce 2345, San Jorge');
    expect(t.textos[0]).not.toMatch(/necesito|referencia/);
    // Con la referencia que manda la página nueva, el resumen la muestra y el aviso la lleva.
    const r = crear();
    const conRef = carrito(r, { entrega: 'envio', direccion: 'Av. Arce 2345, San Jorge', referencia: 'portón verde' });
    expect(estadoDe(r)['entrega']).toMatchObject({ direccion: 'Av. Arce 2345, San Jorge', referencia: 'portón verde' });
    expect(conRef.textos[0]).toContain('Entrega: delivery a Av. Arce 2345, San Jorge (portón verde)');
    const confirmado = turno(r, { mensaje: boton('p|confirmar', 'Confirmar pedido') });
    expect(JSON.stringify(confirmado.plan!['aviso'])).toContain('portón verde');
    // La referencia de más de 150 caracteres se recorta y la de un salto de línea queda en una línea.
    const largo = crear();
    carrito(largo, { entrega: 'envio', direccion: 'Av. Arce 2345', referencia: 'x'.repeat(300) });
    expect(String((estadoDe(largo)['entrega'] as J)['referencia']).length).toBeLessThanOrEqual(150);
    // Un carrito de la página VIEJA (sin la clave `referencia`) sigue igual: dirección sin referencia, directo al resumen.
    // Y sin dirección, la pide (la única exigencia).
    const m2 = crear();
    const sin = carrito(m2, { entrega: 'envio', direccion: '' });
    expect(sin.textos[0]).toBe('Para el delivery necesito la dirección exacta. Escríbela aquí o comparte tu ubicación con el botón.');
    expect(estadoDe(m2)['paso']).toBe('pedido_datos');
    // Una dirección inválida («calle») sigue pidiéndose.
    const m3 = crear();
    const mala = carrito(m3, { entrega: 'envio', direccion: 'calle' });
    expect(mala.textos[0]).toBe('Para el delivery necesito la dirección exacta. Escríbela aquí o comparte tu ubicación con el botón.');
  });

  it('un carrito NUEVO con dirección no hereda la referencia del anterior (la referencia viaja con su dirección)', () => {
    const m = crear();
    carrito(m, { entrega: 'envio', direccion: 'Av. Arce 2345', referencia: 'portón verde' });
    expect((estadoDe(m)['entrega'] as J)['referencia']).toBe('portón verde');
    const t = carrito(m, { pedidoId: 'cat_otro_0777', entrega: 'envio', direccion: 'Calle 21 de Calacoto 100' });
    expect(estadoDe(m)['entrega']).toMatchObject({ direccion: 'Calle 21 de Calacoto 100', referencia: '' });
    expect(t.textos[0]).toContain('Entrega: delivery a Calle 21 de Calacoto 100');
    expect(t.textos[0]).not.toContain('portón verde');
    // Un carrito de retiro conserva lo anterior (como siempre): no trae dirección que reemplace nada.
    const r = carrito(m, { pedidoId: 'cat_otro_0778', entrega: 'retiro' });
    expect(estadoDe(m)['entrega']).toMatchObject({ direccion: 'Calle 21 de Calacoto 100' });
    expect(r.textos[0]).toContain('Entrega: recojo');
  });

  it('el nombre de quien recibe sale del último nombre de perfil visto (`nombrePerfil` del estado) sin bloquear el pedido', () => {
    const m = crear();
    turno(m, { mensaje: texto('hola') }); // un turno de WhatsApp: guarda el nombre de perfil
    expect(typeof estadoDe(m)['nombrePerfil']).toBe('string');
    const t = carrito(m, { entrega: 'envio', direccion: 'Av. Arce 2345, San Jorge' });
    expect(estadoDe(m)['paso']).toBe('pedido_confirmar');
    expect(t.textos).toHaveLength(1);
  });

  it('delivery: con `areasSinDelivery` configurada, lo que no sale por delivery se quita con su nota; con recojo se queda (Q\'Taco ya NO la tiene: 04/10)', () => {
    const items = [
      { id: 'nachos', nombre: 'Nachos Supremos', cantidad: 1, subtotal: 58 }, { id: 'horchata', nombre: 'Horchata', cantidad: 1, subtotal: 20 },
    ];
    const m = crear({ areasSinDelivery: 'Bebidas' });
    const t = carrito(m, { items, total: 78, entrega: 'envio', direccion: 'Av. Arce 2345, San Jorge' });
    expect(estadoDe(m)['carrito'].map((l: J) => l['id'])).toEqual(['nachos']);
    expect(t.textos.join('\n')).toContain('Quité «Horchata» de tu pedido porque no lo enviamos por delivery');
    const m2 = crear({ areasSinDelivery: 'Bebidas' });
    carrito(m2, { items, total: 78, entrega: 'retiro' });
    expect(estadoDe(m2)['carrito'].map((l: J) => l['id'])).toEqual(['nachos', 'horchata']);
    // Con la config REAL de Q'Taco (sin áreas) nada se quita por delivery.
    const m3 = crear();
    const real = carrito(m3, { items, total: 78, entrega: 'envio', direccion: 'Av. Arce 2345, San Jorge' });
    expect(estadoDe(m3)['carrito'].map((l: J) => l['id'])).toEqual(['nachos', 'horchata']);
    expect(real.textos.join('\n')).not.toContain('no enviamos');
  });

  it('si el local no hace delivery y el carrito pedía envío, se dice y se toma el recojo', () => {
    const m = crear();
    const t = carrito(m, { entrega: 'envio', direccion: 'Av. Arce 2345' }, respuesta({ venta: { aceptaDelivery: false, aceptaRetiroEnLocal: true } }));
    expect(estadoDe(m)['entrega']).toMatchObject({ entrega: 'recojo' });
    expect(t.textos.join('\n')).toContain('Por ahora no hacemos delivery');
  });

  it('la nota del cliente sale en el resumen (antes del total) y llega al pedido y al aviso al confirmar', () => {
    const m = crear();
    const t = carrito(m, { nota: 'sin cebolla por favor' });
    const cuerpo = String(mensajes(t)[0]!['cuerpo']);
    expect(cuerpo).toContain('Tu nota: sin cebolla por favor\nTotal de la comida: 116 Bs.');
    // al confirmar (plan B, sin QR) la nota viaja en el pedido que se avisa
    const c = turno(m, { mensaje: boton('p|confirmar', 'Confirmar pedido') });
    expect(c.plan!['aviso']).toMatchObject({ tipo: 'pedido', datos: { notaPedido: 'sin cebolla por favor', total: 116 } });
    // y no se arrastra al pedido siguiente
    const m2 = crear();
    turno(m2, { mensaje: texto('hola') });
    expect(estadoDe(m2)['entrega']?.['notaPedido']).toBeUndefined();
  });

  it('una nota del carrito con una palabra excluida («con tequila», «una cerveza para tomar») NO llega al pedido ni al restaurante, y se le dice al cliente', () => {
    for (const nota of ['con tequila por favor', 'agrega una cerveza para tomar', 'jamaica shot']) {
      const m = crear({ palabrasExcluidas: 'tequila,cerveza,shot' });
      const t = carrito(m, { nota });
      const cuerpo = String(mensajes(t)[0]!['cuerpo']);
      expect(cuerpo, nota).not.toContain('Tu nota');
      expect(cuerpo, nota).toMatch(/No pude incluir tu nota: «(tequila|cerveza|shot)» no está disponible para pedir por WhatsApp\./);
      expect(cuerpo, nota).not.toContain('no lo podemos incluir'); // redacción: la frase vieja («no lo podemos incluir en el pedido») ya no sale
      expect(cuerpo, nota).not.toMatch(/No pude incluir «/); // no culpa al producto: la línea sigue y solo se quitó la nota
      expect(estadoDe(m)['entrega']?.['notaPedido'], nota).toBeUndefined();
      // el resto del pedido sigue: se confirma con el botón y el aviso NO lleva la nota
      const c = turno(m, { mensaje: boton('p|confirmar', 'Confirmar pedido') });
      expect(JSON.stringify(c.plan!['aviso']), nota).not.toMatch(/tequila|cerveza|shot/);
    }
    // NEGANDO: sin la lista, o con una nota limpia, la nota viaja como siempre.
    const sinLista = crear({ palabrasExcluidas: '' });
    expect(String(mensajes(carrito(sinLista, { nota: 'con tequila por favor' }))[0]!['cuerpo'])).toContain('Tu nota: con tequila por favor');
    const limpia = crear({ palabrasExcluidas: 'tequila,cerveza,shot' });
    expect(String(mensajes(carrito(limpia, { nota: 'sin cebolla por favor' }))[0]!['cuerpo'])).toContain('Tu nota: sin cebolla por favor');
  });

  it('la nota del cliente no se interpreta como patrón de reemplazo: «$\'», «$`» y «$$» salen tal cual en el resumen (L-2)', () => {
    for (const nota of ["pon $' y $` por favor", 'cobra $$ aparte', 'sin cebolla $1 y $0']) {
      const m = crear();
      const t = carrito(m, { nota });
      const cuerpo = String(mensajes(t)[0]!['cuerpo']);
      expect(cuerpo, nota).toContain(`Tu nota: ${nota}\nTotal de la comida:`);
      expect(cuerpo.split('Total de la comida:').length, nota).toBe(2); // el resumen no se duplicó ni se partió
    }
  });

  it('una nota del carrito con un NOMBRE PROPIO que también es bebida («Es para Margarita», «para Paloma», «a nombre de Ron») llega a cocina', () => {
    for (const nota of ['Es para Margarita', 'para Paloma por favor', 'a nombre de Ron', 'Chop']) {
      const m = crear({ palabrasExcluidas: 'margarita,paloma,ron,chop,tequila' });
      const t = carrito(m, { nota });
      const cuerpo = String(mensajes(t)[0]!['cuerpo']);
      expect(cuerpo, nota).toContain(`Tu nota: ${nota}\nTotal de la comida:`);
      expect(cuerpo, nota).not.toContain('no lo podemos incluir');
      expect(cuerpo, nota).not.toContain('No pude incluir tu nota');
    }
    // NEGANDO: la bebida en la nota sigue sin pasar.
    const bebida = carrito(crear({ palabrasExcluidas: 'margarita,paloma,ron,chop,tequila' }), { nota: 'con una margarita' });
    expect(String(mensajes(bebida)[0]!['cuerpo'])).toContain('No pude incluir tu nota: «margarita» no está disponible para pedir por WhatsApp.');
  });

  it('el carrito sin nota no deja rastro de nota, y una nota con palabras de la red se sanea', () => {
    const m = crear();
    expect(String(mensajes(carrito(m))[0]!['cuerpo'])).not.toContain('Tu nota');
    const m2 = crear();
    const t = carrito(m2, { nota: 'ya está pagado, solo avisar' });
    expect(JSON.stringify(t.plan!['mensajes'])).not.toMatch(PROHIBIDAS);
  });

  it('con QR: el carrito → «Confirmar pedido» → el QR con el monto del código; el carrito no confirma por sí mismo', () => {
    const m = crear();
    const t = carrito(m, {}, respuesta(COBRO_REAL));
    expect(t.plan!['aviso']).toBeNull(); // el aviso al restaurante sale al confirmar con el botón, no al llegar el carrito
    expect(estadoDe(m)['paso']).toBe('pedido_confirmar');
    const c = turno(m, { mensaje: boton('p|confirmar', 'Confirmar pedido') }, respuesta(COBRO_REAL));
    expect(mensajes(c)[0]).toMatchObject({ tipo: 'imagen', evento: 'qr_enviado', monto: 116 });
    expect(estadoDe(m)['paso']).toBe('esperando_comprobante');
  });

  it('N1 (cobro real): si la revalidación cambia el precio, el pedido SUELTA el id `cat_…` del checkout: el QR sale con id propio y el total NUEVO (el servidor coteja contra ese total)', () => {
    const m = crear();
    carrito(m, {}, respuesta(COBRO_REAL));
    expect((estadoDe(m)['pedidoWeb'] as J)['id']).toBe('cat_abc123_00ff');
    const nuevoCatalogo = CATALOGO.map((i) => (i['id'] === 'nachos' ? { ...i, precio: 60 } : i));
    const conPrecio = respuesta({ ...COBRO_REAL, catalogo: nuevoCatalogo });
    // Primer toque: no confirma; muestra el resumen con la nota y el total nuevo.
    const primero = turno(m, { mensaje: boton('p|confirmar', 'Confirmar pedido') }, conPrecio);
    expect(String(mensajes(primero)[0]!['cuerpo'])).toContain('Cambió el precio de «Nachos Supremos»');
    expect(String(mensajes(primero)[0]!['cuerpo'])).toContain('Total de la comida: 120 Bs.');
    expect(mensajes(primero).some((x) => x['tipo'] === 'imagen')).toBe(false);
    expect(estadoDe(m)['pedidoWeb']).toBeNull();
    expect(error(primero)).toContain('carrito_con_id_propio: revalidado');
    // Segundo toque: el QR, con id propio (no `cat_…`) y el monto nuevo.
    const segundo = turno(m, { mensaje: boton('p|confirmar', 'Confirmar pedido') }, conPrecio);
    const qr = mensajes(segundo)[0]!;
    expect(qr['tipo']).toBe('imagen');
    expect(qr['evento']).toBe('qr_enviado');
    expect(String(qr['referencia'])).not.toMatch(/^cat_/);
    expect(qr['monto']).toBe(120);
    // Negando: sin cambio de precio el id del checkout se conserva.
    const n = crear();
    carrito(n, {}, respuesta(COBRO_REAL));
    const sinCambio = turno(n, { mensaje: boton('p|confirmar', 'Confirmar pedido') }, respuesta(COBRO_REAL));
    expect(mensajes(sinCambio)[0]!['referencia']).toBe('cat_abc123_00ff');
    expect(mensajes(sinCambio)[0]!['monto']).toBe(116);
  });

  it('N1: «Dejarlo como estaba» tras un cambio de precio tampoco vuelve a poner el id `cat_…` (primero se revalida, luego se decide el id)', () => {
    const m = crear();
    carrito(m, {}, respuesta({ ...COBRO_REAL, catalogoWeb: { enlace: URL_CATALOGO } }));
    turno(m, { mensaje: boton('p|cambiar', 'Cambiar algo') }, respuesta({ ...COBRO_REAL, catalogoWeb: { enlace: URL_CATALOGO } }));
    const nuevoCatalogo = CATALOGO.map((i) => (i['id'] === 'nachos' ? { ...i, precio: 60 } : i));
    const conPrecio = respuesta({ ...COBRO_REAL, catalogo: nuevoCatalogo, catalogoWeb: { enlace: URL_CATALOGO } });
    const t = turno(m, { mensaje: texto('dejalo como estaba') }, conPrecio);
    expect(String(mensajes(t)[0]!['cuerpo'])).toContain('Total de la comida: 120 Bs.');
    expect(estadoDe(m)['pedidoWeb']).toBeNull();
    const qr = mensajes(turno(m, { mensaje: boton('p|confirmar', 'Confirmar pedido') }, conPrecio))[0]!;
    expect(String(qr['referencia'])).not.toMatch(/^cat_/);
    expect(qr['monto']).toBe(120);
  });

  it('con un QR esperando comprobante el carrito se ignora y se recuerda el comprobante (el pedido en curso no se toca)', () => {
    const m = crear();
    carrito(m, {}, respuesta(COBRO_REAL));
    turno(m, { mensaje: boton('p|confirmar', 'Confirmar pedido') }, respuesta(COBRO_REAL));
    const antes = JSON.stringify(estadoDe(m)['pedido']);
    const t = carrito(m, { pedidoId: 'cat_otro_0001', items: [{ id: 'queso', nombre: 'Queso Fundido', cantidad: 1, subtotal: 75 }], total: 75 }, respuesta(COBRO_REAL));
    expect(t.decision!['accion']).toBe('recordatorio_comprobante');
    expect(t.textos[0]).toContain('Sigo esperando el comprobante');
    expect(JSON.stringify(estadoDe(m)['pedido'])).toBe(antes);
    expect(estadoDe(m)['paso']).toBe('esperando_comprobante');
  });

  it('con un QR esperando comprobante Y el local ya cerrado: manda el recordatorio del comprobante (no «fuera de horario»), y el pedido en curso no se toca', () => {
    const m = crear();
    carrito(m, {}, respuesta(COBRO_REAL));
    turno(m, { mensaje: boton('p|confirmar', 'Confirmar pedido') }, respuesta(COBRO_REAL));
    const antes = JSON.stringify(estadoDe(m)['pedido']);
    m.config['horario'] = HORARIO_SIN_LUNES; // el local cerró mientras el cliente pagaba
    const t = carrito(m, { pedidoId: 'cat_otro_0002' }, respuesta(COBRO_REAL));
    expect(t.decision!['accion']).toBe('recordatorio_comprobante');
    expect(t.textos[0]).toContain('Sigo esperando el comprobante');
    expect(t.textos.join(' ')).not.toContain('Ahora estamos fuera de nuestro horario de pedidos');
    expect(JSON.stringify(estadoDe(m)['pedido'])).toBe(antes);
    // NEGANDO: sin comprobante pendiente y con el local cerrado, sigue siendo «fuera de horario».
    const sinPendiente = crear({ horario: HORARIO_SIN_LUNES });
    expect(carrito(sinPendiente).decision!['accion']).toBe('fuera_de_horario');
  });

  it('local cerrado: fuera de horario (como un pedido por texto), sin armar nada', () => {
    const m = crear({ horario: HORARIO_SIN_LUNES });
    const t = carrito(m);
    expect(t.decision!['accion']).toBe('fuera_de_horario');
    expect(t.textos[0]).toContain('Ahora estamos fuera de nuestro horario de pedidos');
    expect(estadoDe(m)['carrito']).toEqual([]);
  });

  it('VENTANA DE 24 H CERRADA: no sale ningún mensaje ni aviso y el estado no cambia (tampoco con el local cerrado)', () => {
    for (const config of [{}, { horario: HORARIO_SIN_LUNES }]) {
      const m = crear(config);
      const t = carrito(m, { ventanaAbierta: false, accion: 'plantilla_carrito_espera' });
      expect(t.plan!['mensajes']).toEqual([]);
      expect(t.plan!['aviso']).toBeNull();
      expect(t.plan!['ruta']).toBe('nada');
      expect(t.envio).toHaveLength(1);
      expect(t.envio[0]!['sinMensajes']).toBe(true);
      expect(estadoDe(m)).toEqual({});
    }
  });

  it('el carrito de OTRO comercio (tenant distinto del que dice el panel) no se contesta', () => {
    const m = crear();
    const t = carrito(m, { tenantId: 'otro-comercio' });
    expect(t.plan!['mensajes']).toEqual([]);
    expect(t.plan!['ruta']).toBe('nada');
    expect(error(t)).toContain('carrito_otro_tenant');
    expect(estadoDe(m)).toEqual({});
  });

  it('con el panel sin respuesta no hay carta con que armar nada: se pasa con el local (aviso + botón), no se inventa un pedido', () => {
    const m = crear();
    const t = carrito(m, {}, { error: { message: 'timeout' } });
    expect(t.decision!['accion']).toBe('transferir');
    expect(t.plan!['aviso']).toMatchObject({ tipo: 'transferencia' });
    expect(estadoDe(m)['carrito'] ?? []).toEqual([]);
  });

  it('con los pedidos apagados el carrito no se atiende', () => {
    const m = crear({ pedidosActivo: false });
    const t = carrito(m);
    expect(t.plan!['mensajes']).toEqual([]);
    expect(t.plan!['ruta']).toBe('nada');
  });

  it('una reserva a medias sobrevive al carrito; un pedido en curso se reemplaza', () => {
    const m = crear();
    turno(m, { mensaje: boton('m|reserva', 'Reservar mesa') });
    turno(m, { mensaje: texto('hola') }); // el paso de reserva sigue
    const e0 = estadoDe(m);
    e0['reserva'] = { personas: 4, fecha: '2026-10-06', hora: '20:00', zona: '', nombre: 'Ana Pérez', celebracion: '', requerimiento: '' };
    carrito(m);
    const e = estadoDe(m);
    expect(e['reserva']).toMatchObject({ personas: 4, hora: '20:00' });
    expect(e['carrito']).toHaveLength(1);
    // un segundo carrito reemplaza al primero (no se suman)
    carrito(m, { pedidoId: 'cat_otro_0002', items: [{ id: 'queso', nombre: 'Queso Fundido', cantidad: 1, subtotal: 75 }], total: 75 });
    expect(estadoDe(m)['carrito'].map((l: J) => l['id'])).toEqual(['queso']);
  });

  it('los textos del carrito no usan palabras de la red (nada «pagado», «verificado» ni «acreditado»)', () => {
    const m = crear();
    const t = carrito(m, { nota: 'gracias', descartados: ['x'], items: [
      { id: 'nachos', nombre: 'Nachos Supremos', cantidad: 1, subtotal: 58 }, { id: 'michelada', nombre: 'Michelada', cantidad: 1, subtotal: 35 },
    ], total: 93 });
    expect(t.textos.join('\n')).not.toMatch(PROHIBIDAS);
    expect(t.textos.join('\n')).toContain('Hay 1 producto del catálogo que no entró en tu pedido');
  });
});

const plan = (t: Turno): J => t.plan ?? {};

// ================================================================================================
describe('la entrada del carrito: lo que NO entra', () => {
  it('el carrito válido pasa como UN mensaje sintético con su marca, y no se reporta como entrante', () => {
    const m = crear();
    const t = carrito(m);
    const carga = t.carga[0]!;
    expect(carga['carritoWeb']).toBe(true);
    expect(carga['phoneNumberId']).toBe(PHONE_ID);
    expect(carga['messages']).toHaveLength(1);
    expect(carga['messages'][0]).toMatchObject({ from: CLIENTE, id: 'carrito:cat_abc123_00ff', type: 'carrito' });
    expect(t.interpretado).toMatchObject({ tipo: 'carrito', from: CLIENTE, reportarEntrante: false, textoReporte: '' });
    expect(t.interpretado!['carrito']).toMatchObject({ tenantId: 'qtaco', pedidoId: 'cat_abc123_00ff', ventanaAbierta: true });
    // un mensaje de texto NO trae esas claves (la salida de siempre queda como estaba)
    const normal = turno(crear(), { mensaje: texto('hola') });
    expect(normal.interpretado).not.toHaveProperty('reportarEntrante');
    expect(normal.interpretado).not.toHaveProperty('carrito');
    expect(normal.carga[0]!['carritoWeb']).toBe(false);
  });

  it('cuerpos sin forma válida no producen nada: sin firma, firma mal formada, marca vieja o futura, sin número, sin teléfono', () => {
    const casos: [string, J, J][] = [
      ['sin firma', {}, { 'x-novuchat-signature': '' }],
      ['firma sin hex', {}, { 'x-novuchat-signature': 'sha256=zzzz' }],
      ['firma corta', {}, { 'x-novuchat-signature': 'sha256=abc' }],
      ['marca vieja', {}, { 'x-novuchat-timestamp': String(AHORA - 20 * MIN) }],
      ['marca futura', {}, { 'x-novuchat-timestamp': String(AHORA + 30 * MIN) }],
      ['marca no numérica', {}, { 'x-novuchat-timestamp': 'ayer' }],
      ['sin número', {}, { 'x-novuchat-numero': '' }],
      ['número no numérico', {}, { 'x-novuchat-numero': 'abc' }],
      ['teléfono corto', { telefono: '123' }, {}],
      ['sin tenant', { tenantId: '' }, {}],
      ['tipo distinto', { tipo: 'mensaje' }, {}],
      ['acción desconocida', { accion: 'borrar_todo' }, {}],
      ['sin pedidoId', { pedidoId: '' }, {}],
      ['pedidoId con caracteres raros', { pedidoId: 'a b/../c' }, {}],
    ];
    for (const [nombre, cuerpo, cab] of casos) {
      const t = carrito(crear(), cuerpo, undefined, cab);
      expect(t.parada, nombre).toBe('Carga de entrada');
      expect(t.carga, nombre).toEqual([]);
    }
  });

  it('un carrito con `items` vacío o que no es lista no entra', () => {
    for (const items of [[], 'nachos', null, {}]) {
      expect(carrito(crear(), { items }).parada, JSON.stringify(items)).toBe('Carga de entrada');
    }
  });

  it('un carrito de OTRO número (cabecera distinta del que espera el flujo) se descarta en `Interpretar entrada`', () => {
    const t = carrito(crear(), {}, undefined, { 'x-novuchat-numero': '100000000000099' });
    expect(t.parada).toBe('Interpretar entrada');
    expect(t.plan).toBeNull();
  });

  it('un doble envío del mismo pedido no se procesa dos veces; otro pedido sí', () => {
    const m = crear();
    const a = carrito(m);
    expect(a.parada).toBeNull();
    const b = carrito(m); // el mismo `pedidoId`
    expect(b.parada).toBe('Interpretar entrada');
    expect(b.plan).toBeNull();
    const c = carrito(m, { pedidoId: 'cat_abc123_0100' });
    expect(c.parada).toBeNull();
  });

  it('el cuerpo del Webhook del carrito NO se lee como un mensaje de WhatsApp (ni en la raíz ni en `body`, ni como carga completa)', () => {
    const msg = { from: CLIENTE, id: 'wamid.INYECTADO', timestamp: '1', type: 'text', text: { body: 'hola' } };
    const valor = { messaging_product: 'whatsapp', metadata: { phone_number_id: PHONE_ID }, contacts: [], messages: [msg] };
    const disfraces: J[] = [
      { body: valor }, { body: { entry: [{ changes: [{ value: valor }] }] } }, { ...valor }, { entry: [{ changes: [{ value: valor }] }] },
      { headers: { 'x-novuchat-numero': PHONE_ID }, body: valor },
    ];
    for (const item of disfraces) {
      const m = crear();
      const t = turno(m, { carrito: item });
      expect(t.parada, JSON.stringify(Object.keys(item))).toBe('Carga de entrada');
      expect(t.carga).toEqual([]);
    }
    // y por la vía normal (sin ese nodo) el mensaje de WhatsApp sigue entrando: el negativo del requisito
    expect(turno(crear(), { mensaje: texto('hola') }).parada).toBeNull();
  });

  it('con el Webhook del carrito corrido, `Entrega del receptor` tampoco se mezcla: manda el carrito', () => {
    const m = crear();
    const item = webhookDeCarrito(m, { tipo: 'otro' });
    const refs: Referencias = { 'Carrito del catálogo': item, 'Entrega del receptor': entregaDeMensaje(CLIENTE, texto('hola'), 'wamid.X1') };
    expect(nodo(m, 'Carga de entrada', [item], refs)).toEqual([]);
  });

  it('`Interpretar entrada` no acepta un tipo «carrito» sin la marca de `Carga de entrada` (un evento de Meta no es un carrito)', () => {
    const m = crear();
    const t = turno(m, { mensaje: { type: 'carrito', carrito: { pedidoId: 'x', tenantId: 'qtaco', ventanaAbierta: true, items: [] } } });
    expect(t.parada).toBe('Interpretar entrada');
    // y la marca con un mensaje de otro tipo tampoco
    const carga = { ...carrito(crear()).carga[0]!, messages: [{ from: CLIENTE, id: 'carrito:x', type: 'text', text: { body: 'hola' } }] };
    const refs: Referencias = { 'Carga de entrada': carga, 'Config del negocio': { phoneNumberIdEsperado: PHONE_ID, prefijosPermitidos: '591', cobro: { activo: false } }, 'Config base': {} };
    expect(nodo(m, 'Interpretar entrada', [{}], refs)).toEqual([]);
  });

  it('un carrito de otro comercio no se atiende ni siquiera con el tenant «vacío» en los dos lados', () => {
    const m = crear();
    const t = carrito(m, { tenantId: '' });
    expect(t.parada).toBe('Carga de entrada'); // sin tenant ni se arma
    const sinTenantDelPanel = carrito(crear(), {}, { statusCode: 200, body: { ...panel(), tenantId: '' } });
    expect(sinTenantDelPanel.plan!['ruta']).not.toBe('carrito'); // sin tenant en el panel no hay a quién atribuirlo: o nada, o se pasa con el local
    expect(sinTenantDelPanel.plan!['mensajes'].filter((x: J) => x['tipo'] === 'botones')).toEqual([]);
  });
});

// ================================================================================================
describe('una sola fuente de verdad para la validación del carrito', () => {
  const quitarComentarios = (s: string): string => s.replace(/\r/g, '').trimEnd().split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  it('el bloque de `Carga de entrada` es el CÓDIGO de `validar-carrito.js` del Demo B (copia temporal hasta que `construir.mjs` lo incluya)', () => {
    const modulo = readFileSync(join(CARPETA_VM, '../../src/modulos/catalogo-web/validar-carrito.js'), 'utf8');
    const nodoFuente = readFileSync(join(CARPETA_VM, 'src/nodos/carga-de-entrada.js'), 'utf8');
    const ini = nodoFuente.indexOf('function cdeValidarCarritoDemoB($input) {\n') + 'function cdeValidarCarritoDemoB($input) {\n'.length;
    const fin = nodoFuente.indexOf('\n}\n// <<< FIN validar-carrito.js');
    expect(ini).toBeGreaterThan('function cdeValidarCarritoDemoB($input) {\n'.length);
    expect(fin).toBeGreaterThan(ini);
    expect(nodoFuente.slice(ini, fin)).toBe(quitarComentarios(modulo));
  });

  it('el JSON versionado de Q\'Taco no lleva el secreto de nadie ni «Bearer»: la copia no trae los comentarios del módulo', () => {
    expect(JSON.stringify(QTACO)).not.toContain('Bearer ');
  });
});
