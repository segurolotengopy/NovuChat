/**
 * CORRECCIONES DE LA PRUEBA EN VIVO DE ANDRES (07/11/2026) SOBRE Q'TACO, DE PUNTA A PUNTA: el JSON ARMADO de Q'Taco con los DATOS REALES de
 * `qtaco.json`, corrido con el n8n de mentira (solo la red es doble). Cada bloque reproduce lo que pasó y NIEGA primero.
 *
 *   A. Un solo aviso al local por pedido: el segundo comprobante del mismo pedido no avisa de nuevo (salvo que el primer aviso no haya salido).
 *   C. La promo escrita con variaciones («promo de jueves +2», «promo tortas», «promo tortaa») se reconoce; un pedido de carta no.
 *   D. Las reservas no dependen del horario de pedidos: se validan contra su horario propio (`horarioReservas`).
 *   E. «Volver a inicio» siempre responde (los casos del informe de las 03:51).
 *   F. El aviso de una derivación se lee como lo que es con la plantilla de pedido (sus variables).
 * (B, el arte de una campaña con un QR pendiente, está en `venta-minima-anuncio-campanas.test.ts`.)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { configBase, ejecutar, type Flujo, type J } from './lib/flujo';
import { crearMundo, type Doble, type Mundo, type ResultadoTurno } from './lib/n8n-de-mentira';
import { doblesDelGuardado } from './lib/doble-guardado';
import { editarJson, verificarEnCopia } from './lib/venta-minima-mundo';
import { hallazgosDeExpresiones } from '../../Flujos/experimental/comun-sin-agente/src/expresiones.mjs';
import { crearSesion, type SesionDeMentira } from './lib/venta-minima-sesion';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CARPETA_VM = join(AQUI, '../../Flujos/experimental/venta-minima');
const QTACO = JSON.parse(readFileSync(join(CARPETA_VM, 'venta-minima.qtaco.json'), 'utf8')) as Flujo;
const DATOS = configBase(QTACO);

const JUEVES_10 = Date.UTC(2026, 10, 5, 14); // jueves 05/11/2026, 10:00 en La Paz
const JUEVES_23 = Date.UTC(2026, 10, 6, 3); // jueves 05/11/2026, 23:00 en La Paz
const DIA = 86_400_000;
const CLIENTE = '59100000011';
const PHONE_ID = '100000000000042';
const REC = '59100000031';
const URL_CATALOGO = 'https://catalogo.ejemplo.com/c/ficha123';
const HORARIO_PEDIDOS = 'lun=12:00-22:00,mar=12:00-22:00,mie=12:00-22:00,jue=12:00-22:00,vie=12:00-22:00,sab=12:00-22:00,dom=12:00-22:00';
const HORARIO_24H = 'lun=00:00-24:00,mar=00:00-24:00,mie=00:00-24:00,jue=00:00-24:00,vie=00:00-24:00,sab=00:00-24:00,dom=00:00-24:00';

const TORTAS = String(DATOS['campanaPedidoTexto']);
const JUEVES = String(DATOS['campanaReservaTexto']);
const A = String(DATOS['campanaPedidoMensaje']);
const B = String(DATOS['campanaReservaMensaje']);
const iso = (ms: number): string => new Date(ms).toISOString();
const campana = (id: string, texto: string, base: number): J => ({ id, texto, inicio: iso(base - DIA), fin: iso(base + 5 * DIA) });
const CATALOGO: J[] = [
  { id: 'torta-sin', nombre: 'Torta mexicana sin queso', precio: 15, area: 'Promociones', descripcion: '' },
  { id: 'torta-con', nombre: 'Torta mexicana con queso', precio: 20, area: 'Promociones', descripcion: '' },
  { id: 'nachos', nombre: 'Nachos Supremos', precio: 58, area: 'Entradas', descripcion: '' },
  { id: 'taco', nombre: 'Taco de Birria (unidad)', precio: 21, area: 'Birria', descripcion: '' },
];
const ANUNCIOS: J[] = [
  { id: 'tortas', titulares: ['Tortas Mexicanas'], angulo: '', producto: null },
  { id: 'jueves', titulares: ['Jueves de +2'], angulo: '', producto: null },
];

function panel(base: number, extra: J = {}): J {
  return {
    tenantId: 'qtaco', estadoComercio: 'activo',
    datosDelNegocio: { nombreNegocio: "Q'Taco", direccion: 'Calle Ejemplo 123' },
    operacion: { horarioAtencion: 'todos los días de 12 a 22', moneda: 'BOB', numeroRecepcion: REC, prefijosPermitidos: ['591'] },
    voz: { nombreAsistente: 'Taqui', nivelEmojis: 'pocos' },
    venta: { aceptaDelivery: true, aceptaRetiroEnLocal: true },
    catalogo: CATALOGO, campanas: [campana('tortas', TORTAS, base), campana('jueves', JUEVES, base)], anuncios: ANUNCIOS, catalogoWeb: { enlace: URL_CATALOGO },
    atencion: { estado: 'normal' },
    ...extra,
  };
}

interface Opciones { ahoraMs?: number; panel?: J; config?: J; extraccion?: J; flujo?: Flujo; clasifica?: J }
let contador = 0;
function crear(op: Opciones = {}) {
  const ahora = op.ahoraMs ?? JUEVES_10;
  const sesion: SesionDeMentira = crearSesion({ pid: PHONE_ID, ahora: () => w.mundo.ahora() });
  const dobles: Record<string, Doble> = {
    ...doblesDelGuardado().dobles,
    ...sesion.dobles,
    'Verificar firma con el receptor': (ll) => ({ valido: true, deliveryId: ll.cuerpo?.['deliveryId'] }),
    'Traer configuración': () => ({ statusCode: 200, body: op.panel ?? panel(ahora) }),
    'Reportar mensaje (entrante)': () => ({ ok: true }),
    'Reportar mensaje (saliente)': () => ({ ok: true }),
    'Registrar cierre': () => ({ ok: true }),
    'Obtener URL del medio': () => ({ url: 'https://medios.ejemplo.invalid/m', mime_type: 'image/jpeg', file_size: 100_000 }),
    'Descargar medio': () => ({}),
    'Guardar comprobante': () => ({ statusCode: 200, body: { ruta: 'tenants/qtaco/comprobantes/2026-11-05/x.jpg' } }),
    'Transcribir audio': () => ({ content: { parts: [{ text: 'hola' }] } }),
    'Leer comprobante (imagen)': () => ({ content: { parts: [{ text: JSON.stringify({ monto: '63.00', cuentaDestino: '***4321', nombreCuenta: 'Q TACO SRL', fecha: '05/11/2026', hora: '10:05', banco: 'X' }) }] } }),
    'Leer comprobante (PDF)': () => ({ content: { parts: [{ text: '{}' }] } }),
    'Cotejar en el servidor': () => ({ statusCode: 200, body: { resultado: 'cuadra', diferencias: [], cierreId: 'venta_prueba' } }),
    'Clasificar imagen': (ll) => {
      if (ll.parametros['binaryPropertyName'] !== 'data') throw new Error('no binary field');
      return { content: { parts: [{ text: JSON.stringify(op.clasifica ?? { categoria: 'otro', titular_principal: '', campana: 'ninguna' }) }] } };
    },
    Extraer: () => (w.extraccion ? { candidates: [{ content: { parts: [{ text: JSON.stringify(w.extraccion) }] } }] } : { error: { message: 'sin extracción declarada' } }),
    'Enviar a WhatsApp': (ll) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.EW${ll.n}` }] }),
    'Enviar respaldo': (ll) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.ER${ll.n}` }] }),
    'Enviar aviso': (ll) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.EA${ll.n}` }] }),
    'Aviso de respaldo': (ll) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.EB${ll.n}` }] }),
  };
  const mundo: Mundo = crearMundo({
    flujo: op.flujo ?? QTACO, dobles, alResponder: sesion.alResponder, ahoraMs: ahora,
    configBase: {
      phoneNumberIdEsperado: PHONE_ID, destinatariosAviso: `completo:59100000021,cocina:59100000022`, respaldoNumeroRecepcion: REC,
      horario: HORARIO_PEDIDOS, plantillasPedidoLineas: '', ...(op.config ?? {}),
    },
  });
  const w = { mundo, sesion, extraccion: op.extraccion as J | undefined };
  return w;
}
type W = ReturnType<typeof crear>;

interface Mensaje { type: string; [k: string]: unknown }
const entrega = (mensaje: Mensaje): J => ({
  headers: { 'x-aab1-signature': 'v1=abc', 'x-aab1-timestamp': '1', 'x-aab1-delivery-id': `entrega-${++contador}`, 'x-aab1-attempt': '1' },
  body: {
    field: 'messages',
    value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: '59100000001', phone_number_id: PHONE_ID },
      contacts: [{ profile: { name: 'Carlos Pérez' }, wa_id: CLIENTE }],
      messages: [{ from: CLIENTE, id: `wamid.ENT${++contador}`, timestamp: '1', ...mensaje }],
    },
  },
});
function conversacion(w: W) {
  const turno = (m: Mensaje): ResultadoTurno => w.mundo.turno(entrega(m), {});
  return {
    escribe: (t: string) => turno({ type: 'text', text: { body: t } }),
    toca: (id: string, titulo = 'x') => turno({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: titulo } } }),
    imagen: (id = 'media-1') => turno({ type: 'image', image: { id, mime_type: 'image/jpeg' } }),
  };
}
const cuerpos = (t: ResultadoTurno): string[] => t.mensajes.map((m) => m.cuerpo);
const botonesDe = (m: { payload: J }): { id: string; title: string }[] =>
  ((m.payload['interactive']?.action?.buttons ?? []) as J[]).map((b) => ({ id: String(b['reply']?.id), title: String(b['reply']?.title) }));
const titulos = (t: ResultadoTurno): string[] => t.mensajes.flatMap((m) => botonesDe(m).map((b) => b.title));
const idDe = (t: ResultadoTurno, titulo: string): string => {
  for (const m of t.mensajes) { const b = botonesDe(m).find((x) => x.title === titulo); if (b) return b.id; }
  throw new Error(`no hay un botón «${titulo}» en ${JSON.stringify(titulos(t))}`);
};
const estadoDe = (w: W): J => w.sesion.estado(CLIENTE);
const ruta = (t: ResultadoTurno): string => String(t.resumen?.['ruta'] ?? '');
const plantillas = (t: ResultadoTurno): ResultadoTurno['avisos'] => t.avisos.filter((a) => a.tipo === 'template' && a.ok);
const variables = (a: { payload: J }): string[] =>
  ((a.payload['template']?.components ?? []) as J[]).flatMap((c) => ((c['parameters'] ?? []) as J[]).map((p) => String(p['text'] ?? '')));
const RESERVA = (hora: string, fecha = '2026-11-06'): J => ({ personas: 4, fecha, hora, zona: '', nombre: 'Carlos Pérez', celebracion: '', requerimiento: '' });

// -------------------------------------------------------------------------------------------------------------------------------- A
describe('A. Un aviso al local por pedido, y otro solo si cambia el resultado (decisiones de Andres, 07/11/2026)', () => {
  const COBRO = { cobroReal: { nombreCuenta: 'Q TACO SRL', banco: 'Banco Ejemplo' }, cobro: { activo: true, qr: { url: 'https://qr.ejemplo.invalid/qtaco.png' }, pendiente: true, monto: 63, pedido: 'ped1' } };
  const PED = (id = 'ped1', codigo = 'OXJL'): J => ({ pedidoId: id, from: CLIENTE, codigo, total: 63, lineas: [{ id: 'taco', nombre: 'Taco de Birria (unidad)', cantidad: 3, precio: 21 }], modalidad: 'recojo', resultado: 'qr_enviado' });
  const conQr = (extra: J = {}) => {
    const w = crear({ panel: panel(JUEVES_10, { ...COBRO, ...extra }) });
    w.sesion.sembrar(CLIENTE, { paso: 'esperando_comprobante', pedido: PED(), carrito: [], ultimoMensajeMs: JUEVES_10 - 60_000 }, { ped1: { ...PED(), guardadoMs: JUEVES_10 - 60_000 } });
    return w;
  };
  const cotejo = (w: W, resultado: string) => {
    w.mundo.dobles['Cotejar en el servidor'] = () => ({ statusCode: 200, body: { resultado, diferencias: resultado === 'no_cuadra' ? ['El comprobante dice 60.00 y el pedido es de 63.00'] : [], cierreId: 'venta_prueba' } });
  };
  // El cliente nunca lee que se pasó algo sin un aviso con `wamid` en ESE turno.
  const PASE = /ya lo pas[eé]|lo pas[eé] a nuestro equipo/i;
  const avisosOk = (t: ResultadoTurno): number => t.avisos.filter((a) => a.ok).length;
  it('el caso OXJL (decisión «Re-avisar si cambia el resultado»): «no coinciden» y después «coinciden» → DOS avisos (el segundo, de actualización); el segundo se coteja', () => {
    const w = conQr();
    const c = conversacion(w);
    cotejo(w, 'no_cuadra');
    const t1 = c.imagen('media-1');
    expect(plantillas(t1).length).toBeGreaterThan(0);
    expect(variables(plantillas(t1)[0]!).join(' ')).toContain('OXJL');
    expect(w.sesion.pedidos(CLIENTE)['ped1']['comprobanteAvisadoResultado']).toBe('no_cuadra');
    cotejo(w, 'cuadra');
    const t2 = c.imagen('media-2');
    expect(t2.ejecutados.has('Cotejar en el servidor')).toBe(true);
    expect(plantillas(t2).length).toBeGreaterThan(0);
    expect(variables(plantillas(t2)[0]!).join(' ')).toMatch(/datos coinciden/);
    expect(w.sesion.pedidos(CLIENTE)['ped1']['comprobanteAvisadoResultado']).toBe('cuadra');
    expect(t2.mensajes).toHaveLength(1);
  });
  it('el MISMO resultado otra vez no avisa: «no coinciden» dos veces → un aviso; el segundo se coteja y el cliente NO lee «ya lo pasé»', () => {
    const w = conQr();
    const c = conversacion(w);
    cotejo(w, 'no_cuadra');
    expect(avisosOk(c.imagen('media-1'))).toBeGreaterThan(0);
    const t2 = c.imagen('media-2');
    expect(t2.ejecutados.has('Cotejar en el servidor')).toBe(true);
    expect(t2.avisos).toHaveLength(0);
    expect(t2.mensajes).toHaveLength(1);
    expect(cuerpos(t2)[0]).not.toMatch(PASE);
    expect(cuerpos(t2)[0]).toContain('mismo resultado');
    expect(JSON.stringify(t2.mensajes[0]!.payload)).toContain('wa.me/'); // el botón «Escribir al local»
  });
  it('ilegible → ilegible: el segundo ilegible avisa (pide revisar), un tercero ilegible NO avisa; ilegible ×2 → legible SÍ avisa', () => {
    const w = conQr();
    const c = conversacion(w);
    cotejo(w, 'ilegible');
    const i1 = c.imagen('media-1');
    expect(i1.avisos).toHaveLength(0); // el primero se pide de nuevo, como siempre
    const i2 = c.imagen('media-2');
    expect(avisosOk(i2)).toBeGreaterThan(0);
    expect(w.sesion.pedidos(CLIENTE)['ped1']['comprobanteAvisadoResultado']).toBe('ilegible');
    const i3 = c.imagen('media-3');
    expect(i3.avisos).toHaveLength(0);
    expect(cuerpos(i3).join(' ')).not.toMatch(PASE);
    cotejo(w, 'cuadra');
    const leg = c.imagen('media-4');
    expect(avisosOk(leg)).toBeGreaterThan(0);
    expect(cuerpos(leg).join(' ')).toMatch(PASE); // ESTE turno sí tiene aviso con wamid
  });
  it('en toda la secuencia, cada mensaje que dice «ya lo pasé» va en un turno con un aviso aceptado por Meta', () => {
    const w = conQr();
    const c = conversacion(w);
    for (const r of ['no_cuadra', 'no_cuadra', 'ilegible', 'ilegible', 'cuadra', 'cuadra']) {
      cotejo(w, r);
      const t = c.imagen('media-' + r);
      if (PASE.test(cuerpos(t).join(' '))) expect(avisosOk(t), r).toBeGreaterThan(0);
    }
  });
  it('NEGANDO: si el PRIMER aviso no salió (Meta sin wamid, ni el respaldo), no hay marca y el comprobante siguiente SÍ avisa', () => {
    const w = conQr();
    const c = conversacion(w);
    cotejo(w, 'no_cuadra');
    w.mundo.dobles['Enviar aviso'] = () => ({ error: { message: 'Meta caído' } });
    w.mundo.dobles['Aviso de respaldo'] = () => ({ error: { message: 'Meta caído' } });
    const t1 = c.imagen('media-1');
    expect(t1.avisos.some((a) => a.ok)).toBe(false);
    expect(w.sesion.pedidos(CLIENTE)['ped1']?.['comprobanteAvisadoMs']).toBeUndefined();
    w.mundo.dobles['Enviar aviso'] = (ll) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.EA${ll.n}` }] });
    w.mundo.dobles['Aviso de respaldo'] = (ll) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.EB${ll.n}` }] });
    cotejo(w, 'cuadra');
    const t2 = c.imagen('media-2');
    expect(plantillas(t2).length).toBeGreaterThan(0);
  });
  it('NEGANDO: la marca es del pedido: el comprobante de OTRO pedido del mismo cliente sí avisa', () => {
    const w = conQr();
    const c = conversacion(w);
    cotejo(w, 'cuadra');
    expect(plantillas(c.imagen('media-1')).length).toBeGreaterThan(0);
    // Un pedido nuevo (ped2) con su QR pendiente.
    w.mundo.dobles['Traer configuración'] = () => ({ statusCode: 200, body: panel(JUEVES_10, { ...COBRO, cobro: { ...COBRO.cobro, pedido: 'ped2' } }) });
    w.sesion.sembrar(CLIENTE, { ...estadoDe(w), paso: 'esperando_comprobante', pedido: PED('ped2', 'ZQ7K') }, { ...w.sesion.pedidos(CLIENTE), ped2: { ...PED('ped2', 'ZQ7K'), guardadoMs: JUEVES_10 } });
    const t2 = c.imagen('media-2');
    expect(plantillas(t2).length).toBeGreaterThan(0);
    expect(variables(plantillas(t2)[0]!).join(' ')).toContain('ZQ7K');
  });
  it('0 mensajes agregados al cliente: cada comprobante recibe UN mensaje, con o sin aviso', () => {
    const w = conQr();
    const c = conversacion(w);
    cotejo(w, 'no_cuadra');
    expect(c.imagen('media-1').mensajes).toHaveLength(1);
    expect(c.imagen('media-2').mensajes).toHaveLength(1);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------- C
describe('C. La promo escrita con variaciones se reconoce por código (y un pedido de carta no)', () => {
  const B_TEXTOS = ['Quiero la promo de jueves +2', 'quiero la promo jueves', 'jueves de más 2', 'jueves +2', 'JUEVES MAS 2', 'la promo del jueves', 'quiero la promo de jueves de 2 mas', 'Promoción de los jueves', 'jueves de 2 mas'];
  const A_TEXTOS = ['Quiero la promo tortas', 'Quiero la promo tortaa', 'promo tortas', 'la promo de tortas', 'quiero la promo tortas mexicanas', 'Promoción de tortas', 'promo torta mexicana', 'PROMO DE LAS TORTAS', 'oferta de tortas', 'tortas de la promo'];
  it('B (Jueves de +2): cada variación muestra el mensaje de la campaña B', () => {
    for (const texto of B_TEXTOS) expect(cuerpos(conversacion(crear()).escribe(texto))[0], texto).toBe(B);
  });
  it('B es de RESERVA: a las 23:00, con los pedidos cerrados, «Quiero la promo de jueves +2» muestra la campaña, no «fuera de horario» (el caso del 07/11)', () => {
    const t = conversacion(crear({ ahoraMs: JUEVES_23 })).escribe('Quiero la promo de jueves +2');
    expect(cuerpos(t)[0]).toBe(B);
    expect(cuerpos(t).join(' ')).not.toMatch(/fuera de nuestro horario/);
    expect(titulos(t)).toContain('Reservar mesa');
  });
  it('A (Tortas mexicanas): cada variación, con mayúsculas, tildes o una letra de más o de menos, muestra el mensaje de la campaña A', () => {
    for (const texto of A_TEXTOS) expect(cuerpos(conversacion(crear()).escribe(texto))[0], texto).toBe(A);
  });
  it('también desde el menú (después de «hola»): «Quiero la promo tortaa» ya no devuelve «¿Qué te gustaría hacer ahora?»', () => {
    const c = conversacion(crear());
    c.escribe('hola');
    expect(cuerpos(c.escribe('Quiero la promo tortaa'))[0]).toBe(A);
    expect(cuerpos(c.escribe('promo de jueves +2'))[0]).toBe(B);
  });
  it('NEGANDO (falsos positivos): un pedido de carta, un horario, una mesa para 2 o la promo que no está pegada a la palabra NO activan nada', () => {
    const NEG = ['quiero una torta mexicana con queso', 'quiero 2 tortas mexicanas con queso', 'quiero tortas', 'qué tienen de tortas', 'tengo reserva el jueves de 2 a 4',
      'quiero una mesa el jueves de 2 personas, vi su promo', 'mesa para el jueves de 2 mas personas', 'quiero una torta con mi promo', 'el jueves quiero tortas', 'promo de tacos',
      // Revisión del PR #842: «el jueves más 2 amigos» sin palabra de promoción no es la promo; «tarta» y «tosta» no son «torta».
      'el jueves más 2 amigos', 'reservo el jueves mas 2 personas', 'promo tarta', 'promo tostas', 'promo de tartas'];
    for (const texto of NEG) {
      const t = conversacion(crear()).escribe(texto);
      expect([A, B].includes(cuerpos(t)[0] ?? ''), texto).toBe(false);
    }
  });
  it('NEGANDO: nombrar las dos a la vez es ambiguo; y sin campaña vigente del servidor nada se activa', () => {
    expect([A, B].includes(cuerpos(conversacion(crear()).escribe('promo tortas y promo jueves'))[0] ?? '')).toBe(false);
    const sin = crear({ panel: panel(JUEVES_10, { campanas: [] }) });
    expect([A, B].includes(cuerpos(conversacion(sin).escribe('promo tortas'))[0] ?? '')).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------- D
describe('D. Las reservas NO dependen del horario de pedidos (Andres, 07/11/2026)', () => {
  it('a las 23:00 (pedidos cerrados) se reserva una mesa para mañana de punta a punta: resumen, «Reservar» y «Anotamos tu reserva» con el aviso al local', () => {
    const w = crear({ ahoraMs: JUEVES_23, extraccion: RESERVA('20:00') });
    const c = conversacion(w);
    const r = c.escribe('quiero reservar una mesa para 4 mañana a las 20:00 a nombre de Carlos Pérez');
    expect(cuerpos(r)[0]).toContain('Tu reserva');
    const fin = c.toca(idDe(r, 'Reservar'), 'Reservar');
    expect(cuerpos(fin).join(' ')).toContain('Anotamos tu reserva');
    expect(fin.avisos.some((a) => a.ok)).toBe(true);
  });
  it('desde el botón «Reservar mesa» del mensaje de fuera de horario de pedidos', () => {
    const w = crear({ ahoraMs: JUEVES_23, extraccion: RESERVA('20:00') });
    const c = conversacion(w);
    const fuera = c.escribe('quiero 2 tacos de birria');
    expect(cuerpos(fuera)[0]).toMatch(/fuera de nuestro horario de pedidos/);
    const r = c.toca(idDe(fuera, 'Reservar mesa'), 'Reservar mesa');
    expect(cuerpos(r)[0]).toMatch(/Para tu reserva/);
    expect(cuerpos(c.escribe('somos 4 mañana a las 20:00, Carlos Pérez'))[0]).toContain('Tu reserva');
  });
  it('la hora se valida contra el horario PROPIO de las reservas (`horarioReservas` = 10:00-22:00 → de 10:00 a 21:30), no contra el de pedidos', () => {
    // Pedidos de 12 a 22: una reserva a las 10:30 se acepta (y es «de mañana», #831).
    const t1030 = conversacion(crear({ ahoraMs: JUEVES_23, extraccion: RESERVA('10:30') })).escribe('mesa para 4 mañana 10:30');
    expect(cuerpos(t1030)[0]).toContain('Tu reserva');
    expect(cuerpos(conversacion(crear({ ahoraMs: JUEVES_23, extraccion: RESERVA('21:30') })).escribe('mesa para 4 mañana 21:30'))[0]).toContain('Tu reserva');
    // Pedidos 24 h (el valor temporal de producción): las 03:00 y las 21:45 se siguen rechazando, como antes.
    for (const hora of ['03:00', '09:30', '21:45']) {
      const t = conversacion(crear({ ahoraMs: JUEVES_23, config: { horario: HORARIO_24H }, extraccion: RESERVA(hora) })).escribe('mesa para 4 mañana ' + hora);
      expect(cuerpos(t)[0], hora).toContain('recibe reservas de 10:00 a 21:30');
    }
  });
  it('el día que el horario de pedidos marca CERRADO no se reserva', () => {
    const conDomingoCerrado = HORARIO_PEDIDOS.replace('dom=12:00-22:00', 'dom=cerrado');
    const t = conversacion(crear({ ahoraMs: JUEVES_23, config: { horario: conDomingoCerrado }, extraccion: RESERVA('20:00', '2026-11-08') })).escribe('mesa para 4 el domingo a las 20:00');
    expect(cuerpos(t)[0]).toMatch(/no abre el domingo/);
  });
  it('NEGANDO: sin `horarioReservas` (dato opcional) rige el horario de pedidos, como hasta hoy', () => {
    const t = conversacion(crear({ ahoraMs: JUEVES_23, config: { horarioReservas: '' }, extraccion: RESERVA('10:30') })).escribe('mesa para 4 mañana 10:30');
    expect(cuerpos(t)[0]).toContain('recibe reservas de 12:00 a 21:30');
  });
  it('NEGANDO (revisión del PR #842): un `horarioReservas` que no sirve («25:00-22:00», texto ilegible) vuelve al horario de pedidos y queda ANOTADO; no rechaza todo en silencio', () => {
    for (const malo of ['25:00-22:00', 'todos los dias', '22:00-10:00']) {
      const t = conversacion(crear({ ahoraMs: JUEVES_23, config: { horarioReservas: malo }, extraccion: RESERVA('20:00') })).escribe('mesa para 4 mañana 20:00');
      expect(cuerpos(t)[0], malo).toContain('Tu reserva'); // con el horario de pedidos (12 a 22) las 20:00 valen
      expect(JSON.stringify(t.porNodo['Plan del turno'] ?? []), malo).toContain('horario_reservas_invalido');
    }
    // La librería: un arreglo, un rango imposible o un rango sin días abiertos caen al horario de pedidos y se marcan; el vacío no es un error.
    const FUENTE = readFileSync(join(CARPETA_VM, 'src/lib/reserva.js'), 'utf8');
    const L = ejecutar(`${FUENTE}\nreturn [{ json: { rsHorarioDeReservas, rsHorarioDeReservasInvalido } }];`, [{}])[0] as Record<string, (...a: unknown[]) => unknown>;
    for (const malo of [['10:00-22:00'], '25:00-22:00', 'cualquier cosa', { lun: 'x' }]) {
      expect(L['rsHorarioDeReservas']!(malo, HORARIO_PEDIDOS), JSON.stringify(malo)).toBe(HORARIO_PEDIDOS);
      expect(L['rsHorarioDeReservasInvalido']!(malo, HORARIO_PEDIDOS), JSON.stringify(malo)).toBe(true);
    }
    expect(L['rsHorarioDeReservasInvalido']!('10:00-22:00', 'lun=cerrado,mar=cerrado')).toBe(true); // sin días abiertos
    expect(L['rsHorarioDeReservasInvalido']!('', HORARIO_PEDIDOS)).toBe(false);
    expect(L['rsHorarioDeReservasInvalido']!('10:00-22:00', HORARIO_PEDIDOS)).toBe(false);
  });
  it('el dato de Q\'Taco es «10:00-22:00» y el horario de pedidos no se tocó (sigue siendo el marcador)', () => {
    expect(DATOS['horarioReservas']).toBe('10:00-22:00');
    expect(DATOS['horario']).toBe('REEMPLAZAR_HORARIO_PEDIDOS_QTACO');
  });
});

// -------------------------------------------------------------------------------------------------------------------------------- E
describe('E. «Volver a inicio» siempre responde (informe de Andres, 03:51)', () => {
  const volver = (c: ReturnType<typeof conversacion>, t: ResultadoTurno): ResultadoTurno => c.toca(idDe(t, 'Volver a inicio'), 'Volver a inicio');
  it('tras «¿qué horarios tienen?»', () => {
    const c = conversacion(crear());
    c.escribe('hola');
    const h = c.escribe('¿qué horarios tienen?');
    const t = volver(c, h);
    expect(t.mensajes).toHaveLength(1);
    expect(titulos(t)).toEqual(['Hacer un pedido', 'Reservar mesa']);
  });
  it('tras una promo (A y B no llevan «Volver a inicio»: se toca el botón del menú de un mensaje anterior, y también se escribe)', () => {
    const c = conversacion(crear());
    const hola = c.escribe('hola');
    c.escribe(TORTAS);
    const t = c.toca('m|menu', 'Volver a inicio');
    expect(t.mensajes).toHaveLength(1);
    expect(titulos(t)).toContain('Reservar mesa');
    c.escribe(JUEVES);
    expect(c.escribe('volver a inicio').mensajes).toHaveLength(1);
    expect(titulos(hola)).toContain('Hacer un pedido');
  });
  it('fuera del horario de pedidos, con el botón del propio mensaje de «fuera de horario»', () => {
    const c = conversacion(crear({ ahoraMs: JUEVES_23 }));
    const fuera = c.escribe('quiero 2 tacos de birria');
    const t = volver(c, fuera);
    expect(t.mensajes).toHaveLength(1);
    expect(titulos(t)).toEqual(['Hacer un pedido', 'Reservar mesa']);
  });
  it('con un comprobante en espera: responde con el recordatorio (no saca del cobro)', () => {
    const w = crear({ panel: panel(JUEVES_10, { cobroReal: { nombreCuenta: 'Q TACO SRL', banco: 'Banco Ejemplo' }, cobro: { activo: true, qr: { url: 'https://qr.ejemplo.invalid/qtaco.png' }, pendiente: true, monto: 63, pedido: 'ped1' } }) });
    const ped = { pedidoId: 'ped1', from: CLIENTE, codigo: 'OXJL', total: 63, lineas: [], modalidad: 'recojo' };
    w.sesion.sembrar(CLIENTE, { paso: 'esperando_comprobante', pedido: ped, carrito: [], ultimoMensajeMs: JUEVES_10 - 60_000 }, { ped1: { ...ped, guardadoMs: JUEVES_10 } });
    const c = conversacion(w);
    const t = c.toca('m|menu', 'Volver a inicio');
    expect(t.mensajes).toHaveLength(1);
    expect(cuerpos(t)[0]).toContain('OXJL');
    expect(c.escribe('Volver a inicio').mensajes).toHaveLength(1);
  });
  it('un toque DOBLE (dos ejecuciones que leen el mismo estado): una responde y la otra cede en silencio (diseño de la carrera); entre las dos, UNA respuesta', () => {
    const w = crear();
    const c = conversacion(w);
    const h = c.escribe('¿qué horarios tienen?');
    const id = idDe(h, 'Volver a inicio');
    const primera = c.toca(id, 'Volver a inicio');
    w.sesion.servidor.antesDeComprometer = (ll) => {
      w.sesion.servidor.antesDeComprometer = null;
      if ((ll['sesion'] as J)['accion'] === 'comprometer') w.sesion.sembrar(CLIENTE, { ...estadoDe(w), paso: 'menu' }, w.sesion.pedidos(CLIENTE));
    };
    const segunda = c.toca(id, 'Volver a inicio');
    expect(primera.mensajes.length + segunda.mensajes.length).toBe(1);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------- F
describe('F. El aviso de una derivación se lee como lo que es con la plantilla de pedido (variables reescritas)', () => {
  it('«quiero hablar con una persona»: {{1}} dice «NO ES UN PEDIDO — consulta …», {{2}} «sin cobro», {{3}} «responder a <cliente> por WhatsApp» (con el teléfono solo para el rol completo), {{4}} «no aplica»', () => {
    const t = conversacion(crear()).escribe('quiero hablar con una persona');
    const p = plantillas(t);
    expect(p.length).toBeGreaterThan(0);
    for (const a of p) {
      const v = variables(a);
      expect(v).toHaveLength(4);
      expect(v[0]).toMatch(/^NO ES UN PEDIDO — consulta [A-Z0-9]+: /);
      expect(v[1]).toBe('sin cobro');
      // El local sabe a quién responder (Andres, 07/11/2026 08:55): nombre de perfil y, solo para `completo`, el teléfono legible.
      expect(v[2]).toMatch(a.a === '59100000021' ? /^responder a Carlos Pérez · \+591 0000 0011 por WhatsApp$/ : /^responder a Carlos por WhatsApp$/);
      expect(v[3]).toBe('no aplica');
      expect(v.join(' ')).not.toMatch(/CONSULTA|el cliente pide hablar con una persona\b.*Modalidad/);
    }
  });
});


// -------------------------------------------------------------------------------------------------------------------------------- SANDBOX
describe('El sandbox de EXPRESIONES de n8n no deja leer prototype/__proto__/constructor (causa de las imágenes perdidas del 07/11/2026)', () => {
  const RX = /\b(prototype|__proto__|constructor)\b/;
  const expresionesProhibidas = (f: Flujo): string[] => {
    const h: string[] = [];
    const recorrer = (v: unknown, nodo: string): void => {
      if (typeof v === 'string') { if (v.startsWith('=') && RX.test(v)) h.push(nodo); }
      else if (v && typeof v === 'object') for (const x of Object.values(v as J)) recorrer(x, nodo);
    };
    for (const n of f.nodes) recorrer(n.parameters ?? {}, n.name);
    return h;
  };
  it('ninguna expresión de las cuatro salidas armadas, de la plantilla ni de los derivados que comparten nodos (Emma, Evy, doctoras) lee esas propiedades', () => {
    const archivos = ['flujo.plantilla.json', 'venta-minima.qtaco.json', 'venta-minima.qtaco-3727.json', 'venta-minima.prueba.json', 'venta-minima.ensayo-demo-a.json',
      '../rroca-emma/rroca-emma.json', '../rroca-emma/rroca-emma.prueba.json', '../rroca-evy/rroca-evy.json', '../rroca-evy/rroca-evy.prueba.json',
      '../doctoras/doctoras.rroca-emma.json', '../doctoras/doctoras.rroca-emma.prueba.json', '../doctoras/doctoras.rroca-evy.json', '../doctoras/doctoras.rroca-evy.prueba.json'];
    for (const a of archivos) {
      const f = JSON.parse(readFileSync(join(CARPETA_VM, a), 'utf8')) as Flujo;
      expect(expresionesProhibidas(f), a).toEqual([]);
      expect(hallazgosDeExpresiones(f), a).toEqual([]); // la misma regla que usa `construir.mjs --verificar`
    }
    // NEGANDO: la regla común reconoce la construcción en una copia, y no la confunde con el jsCode de un nodo Code (otro sandbox).
    const copia = JSON.parse(JSON.stringify(QTACO)) as Flujo;
    const c = ((copia.nodes.find((x) => x.name === '¿Es comprobante?')!.parameters as J)['conditions']['conditions'][0]) as J;
    c['leftValue'] = String(c['leftValue']).replace('Object.keys(a.titulares).indexOf(k) >= 0', 'Object.prototype.hasOwnProperty.call(a.titulares, k)');
    expect(hallazgosDeExpresiones(copia).map((h) => h.nodo)).toEqual(['¿Es comprobante?']);
    expect(expresionesProhibidas(copia)).toEqual(['¿Es comprobante?']);
  });
  it('NEGANDO: `construir.mjs --verificar` FALLA si una expresión lee `Object.prototype.hasOwnProperty` (en el JSON versionado o en la plantilla)', () => {
    const meter = (f: Flujo): void => {
      const n = f.nodes.find((x) => x.name === '¿Es comprobante?')!;
      const c = (n.parameters as J)['conditions']['conditions'][0];
      c.leftValue = String(c.leftValue).replace('Object.keys(a.titulares).indexOf(k) >= 0', 'Object.prototype.hasOwnProperty.call(a.titulares, k)');
      expect(String(c.leftValue)).toContain('Object.prototype.hasOwnProperty');
    };
    const r = verificarEnCopia((vm) => editarJson(vm, 'venta-minima.qtaco-3727.json', meter));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/lee «prototype»/);
    const r2 = verificarEnCopia((vm) => editarJson(vm, 'flujo.plantilla.json', meter), []);
    expect(r2.status).not.toBe(0);
    expect(r2.stderr).toMatch(/lee «prototype»/);
  });
  it('el n8n de mentira rechaza la expresión como n8n: con la expresión vieja del IF, una imagen con QR pendiente y campañas vigentes hace fallar el turno; con la de hoy, no', () => {
    const viejo = JSON.parse(JSON.stringify(QTACO)) as Flujo;
    const n = viejo.nodes.find((x) => x.name === '¿Es comprobante?')!;
    const c = (n.parameters as J)['conditions']['conditions'][0];
    c.leftValue = String(c.leftValue).replace('Object.keys(a.titulares).indexOf(k) >= 0', 'Object.prototype.hasOwnProperty.call(a.titulares, k)');
    const COBRO = { cobroReal: { nombreCuenta: 'Q TACO SRL', banco: 'Banco Ejemplo' }, cobro: { activo: true, qr: { url: 'https://qr.ejemplo.invalid/qtaco.png' }, pendiente: true, monto: 63, pedido: 'ped1' } };
    const PED = { pedidoId: 'ped1', from: CLIENTE, codigo: 'OXJL', total: 63, lineas: [], modalidad: 'recojo' };
    const lectura = { categoria: 'publicidad', titular_principal: 'Jueves de +2', campana: 'B' };
    const conQr = (flujo?: Flujo, clasifica: J = lectura) => {
      const w = crear({ panel: panel(JUEVES_10, COBRO), flujo, clasifica });
      w.sesion.sembrar(CLIENTE, { paso: 'esperando_comprobante', pedido: PED, carrito: [], ultimoMensajeMs: JUEVES_10 - 60_000 }, { ped1: { ...PED, guardadoMs: JUEVES_10 } });
      return w;
    };
    // Sin `onError` (como estaba el 07/11) la ejecución muere; con `onError` (desde la segunda ronda) el IF manda el ítem por su salida falsa y el turno sigue.
    const sinOnError = JSON.parse(JSON.stringify(viejo)) as Flujo;
    delete (sinOnError.nodes.find((x) => x.name === '¿Es comprobante?') as J)['onError'];
    expect(() => conversacion(conQr(sinOnError)).imagen()).toThrow(/Cannot access "prototype" due to security concerns/);
    expect(conversacion(conQr(viejo)).imagen().mensajes).toHaveLength(1);
    // El escenario del 07/11 con la expresión vieja y `onError` (revisión de #848): un COMPROBANTE real (el clasificador dice «otro») con el QR pendiente y
    // campañas vigentes llega al local como comprobante (aviso con el código del pedido), y el cliente nunca lee que el pago entró.
    const comp = conversacion(conQr(viejo, { categoria: 'otro', titular_principal: '', campana: 'ninguna' })).imagen();
    expect(comp.mensajes).toHaveLength(1);
    expect(comp.avisos.some((a) => a.ok)).toBe(true);
    expect(JSON.stringify(comp.avisos)).toContain('OXJL');
    expect(cuerpos(comp).join(' ')).not.toMatch(/pago (acreditado|verificado|confirmado)|recibimos tu pago|tu pago (ya )?(entr|lleg|ingres)|ya pagaste/i);
    expect(cuerpos(comp).join(' ')).toMatch(/comprobante/i);
    const hoy = conversacion(conQr()).imagen();
    expect(hoy.mensajes).toHaveLength(1);
    expect(cuerpos(hoy)[0]).toContain('agrandar');
  });
});

// -------------------------------------------------------------------------------------------------------------------------------- G
describe('G. Avisos en viñetas de punta a punta (plantillas nuevas por tipo, 07/11/2026): la nueva sale; si Meta la rechaza, cae a la de hoy en el mismo turno', () => {
  // Las claves EXACTAS que trae el 3727 (la fuente de verdad es su archivo de datos, armado en el JSON versionado).
  const D3727 = configBase(JSON.parse(readFileSync(join(CARPETA_VM, 'venta-minima.qtaco-3727.json'), 'utf8')) as Flujo);
  const DE_3727: J = Object.fromEntries(Object.entries(D3727).filter(([k]) => /^plantilla(PedidoMapa|PedidoLista|ReservaLista|ConsultaAtencion)|^idiomaPlantillasVinetas$/.test(k)));
  // 07/11 20:47: Q'Taco volvió al formato por líneas y el 3727 trae las tres plantillas en viñetas DESACTIVADAS. Estas pruebas cubren el código de viñetas con SU PROPIA config de prueba (las tres en APPROVED).
  const VINETAS: J = { ...DE_3727, plantillaPedidoMapaEstado: 'APPROVED', plantillaPedidoListaEstado: 'APPROVED', plantillaReservaListaEstado: 'APPROVED' };
  const COBRO = { cobroReal: { nombreCuenta: 'Q TACO SRL', banco: 'Banco Ejemplo' }, cobro: { activo: true, qr: { url: 'https://qr.ejemplo.invalid/qtaco.png' }, pendiente: true, monto: 63, pedido: 'ped1' } };
  const PED: J = { pedidoId: 'ped1', from: CLIENTE, codigo: 'OXJL', total: 63, lineas: [{ id: 'taco', nombre: 'Taco de Birria (unidad)', cantidad: 3, precio: 21 }], modalidad: 'recojo', resultado: 'qr_enviado' };
  const PASE = /ya lo pas[eé]|lo pas[eé] a nuestro equipo/i;
  const conQr = (config: J = VINETAS) => {
    const w = crear({ panel: panel(JUEVES_10, COBRO), config });
    w.sesion.sembrar(CLIENTE, { paso: 'esperando_comprobante', pedido: PED, carrito: [], ultimoMensajeMs: JUEVES_10 - 60_000 }, { ped1: { ...PED, guardadoMs: JUEVES_10 - 60_000 } });
    w.mundo.dobles['Cotejar en el servidor'] = () => ({ statusCode: 200, body: { resultado: 'cuadra', diferencias: [], cierreId: 'venta_prueba' } });
    return w;
  };
  const nombre = (a: { payload: J }): string => String(a.payload['template']?.name ?? '');
  const rechaza = (prefijo: string, soloA?: string): Doble => (ll) => {
    const p = (ll.cuerpo ?? {}) as J;
    if (String(p['template']?.name ?? '').startsWith(prefijo) && (soloA === undefined || p['to'] === soloA)) return { error: { message: '(#132001) Template name does not exist in the translation' } };
    return { messaging_product: 'whatsapp', messages: [{ id: `wamid.EA${ll.n}` }] };
  };

  it('el 3727 trae las tres en viñetas DESACTIVADAS (formato por líneas vigente) y consulta_atencion en PENDING; la config de prueba las trae APPROVED', () => {
    expect(DE_3727).toEqual({
      plantillaPedidoMapa: 'pedido_lista_mapa', plantillaPedidoMapaEstado: 'DESACTIVADA', plantillaPedidoLista: 'pedido_lista', plantillaPedidoListaEstado: 'DESACTIVADA',
      plantillaReservaLista: 'reserva_lista', plantillaReservaListaEstado: 'DESACTIVADA', plantillaConsultaAtencion: 'consulta_atencion', plantillaConsultaAtencionEstado: 'PENDING',
      idiomaPlantillasVinetas: 'es',
    });
    expect(VINETAS).toEqual({
      plantillaPedidoMapa: 'pedido_lista_mapa', plantillaPedidoMapaEstado: 'APPROVED', plantillaPedidoLista: 'pedido_lista', plantillaPedidoListaEstado: 'APPROVED',
      plantillaReservaLista: 'reserva_lista', plantillaReservaListaEstado: 'APPROVED', plantillaConsultaAtencion: 'consulta_atencion', plantillaConsultaAtencionEstado: 'PENDING',
      idiomaPlantillasVinetas: 'es',
    });
  });
  it('comprobante en recojo: sale `pedido_lista` (6 variables) a cada destinatario, UNA vez, sin respaldo; la marca del aviso queda puesta', () => {
    const w = conQr();
    const t = conversacion(w).imagen('media-1');
    const p = plantillas(t);
    expect(p.map((a) => [a.a, nombre(a)]).sort()).toEqual([['59100000021', 'pedido_lista'], ['59100000022', 'pedido_lista']]);
    for (const a of p) expect(variables(a)).toHaveLength(6);
    expect(t.avisos.filter((a) => a.respaldo)).toHaveLength(0);
    expect(w.sesion.pedidos(CLIENTE)['ped1']['comprobanteAvisadoResultado']).toBe('cuadra');
    expect(t.mensajes).toHaveLength(1);
    expect(cuerpos(t).join(' ')).toMatch(PASE);
  });
  it('Meta RECHAZA la nueva: en el mismo turno sale la de hoy (`pedido_registrado`) por «Aviso de respaldo», una por destinatario; el cliente lee el pase y la marca queda', () => {
    const w = conQr();
    w.mundo.dobles['Enviar aviso'] = rechaza('pedido_lista');
    const c = conversacion(w);
    const t = c.imagen('media-1');
    expect(t.avisos.filter((a) => !a.respaldo).map(nombre)).toEqual(['pedido_lista', 'pedido_lista']);
    expect(t.avisos.filter((a) => !a.respaldo).every((a) => !a.ok)).toBe(true);
    const resp = t.avisos.filter((a) => a.respaldo);
    expect(resp.map((a) => [a.a, nombre(a), a.ok]).sort()).toEqual([['59100000021', 'pedido_registrado', true], ['59100000022', 'pedido_registrado', true]]);
    for (const a of resp) expect(variables(a)).toHaveLength(4);
    expect(cuerpos(t).join(' ')).toMatch(PASE);
    expect(w.sesion.pedidos(CLIENTE)['ped1']['comprobanteAvisadoResultado']).toBe('cuadra');
    // La marca de #842 se respeta: el mismo resultado otra vez no avisa, ni por la nueva ni por la de hoy.
    const t2 = c.imagen('media-2');
    expect(t2.avisos).toHaveLength(0);
  });
  it('delivery con ubicación: el rol completo recibe `pedido_lista_mapa` y «Armar avisos» deja INTACTO el parámetro del botón (no lo trata como texto)', () => {
    const conUbicacion: J = { ...PED, modalidad: 'delivery', direccion: 'Calle Ejemplo 123', ubicacion: { lat: -16.5, lng: -68.15 } };
    const w = crear({ panel: panel(JUEVES_10, COBRO), config: VINETAS });
    w.sesion.sembrar(CLIENTE, { paso: 'esperando_comprobante', pedido: conUbicacion, carrito: [], ultimoMensajeMs: JUEVES_10 - 60_000 }, { ped1: { ...conUbicacion, guardadoMs: JUEVES_10 - 60_000 } });
    w.mundo.dobles['Cotejar en el servidor'] = () => ({ statusCode: 200, body: { resultado: 'cuadra', diferencias: [], cierreId: 'venta_prueba' } });
    const t = conversacion(w).imagen('media-1');
    const completo = plantillas(t).find((a) => a.a === '59100000021')!;
    expect(nombre(completo)).toBe('pedido_lista_mapa');
    const comp = (completo.payload['template']?.components ?? []) as J[];
    expect(comp.map((c) => c['type'])).toEqual(['body', 'button']);
    expect(comp[1]).toEqual({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '-16.500000%2C-68.150000' }] });
    expect(nombre(plantillas(t).find((a) => a.a === '59100000022')!)).toBe('pedido_lista');
  });
  it('NEGANDO un envío de más: si la nueva sale para uno y falla para el otro, el respaldo va SOLO al que falló', () => {
    const w = conQr();
    w.mundo.dobles['Enviar aviso'] = rechaza('pedido_lista', '59100000022');
    const t = conversacion(w).imagen('media-1');
    const resp = t.avisos.filter((a) => a.respaldo);
    expect(resp.map((a) => [a.a, nombre(a)])).toEqual([['59100000022', 'pedido_registrado']]);
    expect(t.avisos.filter((a) => a.ok)).toHaveLength(2);
  });
  it('NEGANDO: con la plantilla en PENDING (o sin las claves) sale directo la de hoy, sin intento ni respaldo', () => {
    for (const config of [{ ...VINETAS, plantillaPedidoListaEstado: 'PENDING' }, {}]) {
      const t = conversacion(conQr(config)).imagen('media-1');
      expect(t.avisos.map(nombre)).toEqual(['pedido_registrado', 'pedido_registrado']);
      expect(t.avisos.every((a) => a.ok && !a.respaldo)).toBe(true);
    }
  });
  it('la derivación sigue con la plantilla de hoy mientras consulta_atencion esté PENDING (mismas 4 variables del caso F)', () => {
    const t = conversacion(crear({ config: VINETAS })).escribe('quiero hablar con una persona');
    const p = plantillas(t);
    expect(p.length).toBeGreaterThan(0);
    for (const a of p) {
      expect(nombre(a)).toBe('pedido_registrado');
      expect(variables(a)[0]).toMatch(/^NO ES UN PEDIDO — consulta [A-Z0-9]+: /);
    }
  });
  it('reserva: sale `reserva_lista` (5 variables); si Meta la rechaza, cae a la de hoy y el cliente igual lee «Anotamos tu reserva»', () => {
    for (const falla of [false, true]) {
      const w = crear({ ahoraMs: JUEVES_23, extraccion: RESERVA('20:00'), config: VINETAS });
      if (falla) w.mundo.dobles['Enviar aviso'] = rechaza('reserva_lista');
      const c = conversacion(w);
      const r = c.escribe('quiero reservar una mesa para 4 mañana a las 20:00 a nombre de Carlos Pérez');
      const fin = c.toca(idDe(r, 'Reservar'), 'Reservar');
      expect(cuerpos(fin).join(' '), String(falla)).toContain('Anotamos tu reserva');
      const principales = fin.avisos.filter((a) => !a.respaldo && a.tipo === 'template');
      expect(principales.map(nombre)).toEqual(['reserva_lista', 'reserva_lista']);
      for (const a of principales) expect(variables(a)).toHaveLength(5);
      expect(variables(principales.find((a) => a.a === '59100000021')!)[3]).toBe('+591 0000 0011');
      expect(variables(principales.find((a) => a.a === '59100000022')!)[3]).toBe('—');
      const resp = fin.avisos.filter((a) => a.respaldo);
      if (!falla) expect(resp).toHaveLength(0);
      else expect(resp.map((a) => [a.a, nombre(a)]).sort()).toEqual([['59100000021', 'solicitud_reserva'], ['59100000022', 'pedido_registrado']]);
    }
  });
});

// -------------------------------------------------------------------------------------------------------------------------------- ONERROR
describe('Una excepción en los IF del camino de los medios NO mata la ejecución sin rastro (revisión del PR #842): ante la duda, comprobante', () => {
  const COBRO = { cobroReal: { nombreCuenta: 'Q TACO SRL', banco: 'Banco Ejemplo' }, cobro: { activo: true, qr: { url: 'https://qr.ejemplo.invalid/qtaco.png' }, pendiente: true, monto: 63, pedido: 'ped1' } };
  const PED = { pedidoId: 'ped1', from: CLIENTE, codigo: 'OXJL', total: 63, lineas: [], modalidad: 'recojo' };
  const conFalla = (onError: boolean): Flujo => {
    const f = JSON.parse(JSON.stringify(QTACO)) as Flujo;
    const n = f.nodes.find((x) => x.name === '¿Es comprobante?')!;
    ((n.parameters as J)['conditions']['conditions'][0] as J)['leftValue'] = "={{ (() => { throw new Error('falla de prueba'); })() }}";
    if (!onError) delete (n as J)['onError'];
    return f;
  };
  const turno = (flujo: Flujo) => {
    const w = crear({ panel: panel(JUEVES_10, { ...COBRO, campanas: [] }), flujo });
    w.sesion.sembrar(CLIENTE, { paso: 'esperando_comprobante', pedido: PED, carrito: [], ultimoMensajeMs: JUEVES_10 - 60_000 }, { ped1: { ...PED, guardadoMs: JUEVES_10 } });
    return conversacion(w).imagen();
  };
  it('los cinco IF del camino de los medios llevan `onError: continueRegularOutput`, y la expresión de «¿Es comprobante?» cae en «comprobante» si lanza', () => {
    for (const nombre of ['¿Bajar medio?', '¿Tamaño aceptable?', '¿Es audio?', '¿Es PDF?', '¿Es comprobante?']) {
      expect((QTACO.nodes.find((x) => x.name === nombre) as J)['onError'], nombre).toBe('continueRegularOutput');
    }
    const v = String(((QTACO.nodes.find((x) => x.name === '¿Es comprobante?')!.parameters as J)['conditions']['conditions'][0] as J)['leftValue']);
    expect(v.startsWith('={{ (() => { try { ')).toBe(true);
    expect(v.endsWith(' } catch (e) { return true; } })() }}')).toBe(true);
  });
  it('si «¿Es comprobante?» lanza, el turno sigue: la foto llega al local como comprobante (aviso) y el cliente recibe UN mensaje', () => {
    const t = turno(conFalla(true));
    expect(t.mensajes).toHaveLength(1);
    expect(t.avisos.some((a) => a.ok)).toBe(true);
    expect(JSON.stringify(t.avisos)).toContain('OXJL');
  });
  it('NEGANDO: sin `onError`, la misma falla mata la ejecución (lo que pasaba antes)', () => {
    expect(() => turno(conFalla(false))).toThrow(/falla de prueba/);
  });
});
