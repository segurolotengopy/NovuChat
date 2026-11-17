/**
 * CAMPANA POR AD ID Y POR TEXTO en el flujo de Q'Taco (familia venta-minima), contrato del 17/11/2026.
 * `Interpretar entrada` entrega `anuncio` (idAnuncio, ctwaClid), `campana` {id, texto, por} y las salidas planas `adId/campanaId/campanaPor`: primero el Ad ID, luego el texto.
 * Una campana solo por Ad ID (texto vacio) SOLO se vincula: no salta ningun menu ni cambia la respuesta. 0 mensajes agregados; nodos agregados 0.
 */
import { voz } from './lib/venta-minima-voz';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { configBase, type Flujo, type J } from './lib/flujo';
import { crearMundo, type Doble, type LlamadaDoble, type Mundo, type ResultadoTurno } from './lib/n8n-de-mentira';
import { doblesDelGuardado } from './lib/doble-guardado';
import { crearSesion, type SesionDeMentira } from './lib/venta-minima-sesion';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CARPETA_VM = join(AQUI, '../../Flujos/experimental/venta-minima');
const QTACO = JSON.parse(readFileSync(join(CARPETA_VM, 'venta-minima.qtaco.json'), 'utf8')) as Flujo;
const DATOS = configBase(QTACO);

const AHORA = Date.UTC(2026, 10, 5, 14); // jueves 05/11/2026, 10:00 en La Paz
const DIA = 86_400_000;
const CLIENTE = '59100000011';
const PHONE_ID = '100000000000042';
const REC = '59100000031';
const URL_CATALOGO = 'https://catalogo.ejemplo.com/c/ficha123';

const TORTAS = String(DATOS['campanaPedidoTexto']);
const JUEVES = String(DATOS['campanaReservaTexto']);
const iso = (ms: number): string => new Date(ms).toISOString();
const campana = (id: string, texto: string, desdeMs = AHORA - DIA, hastaMs = AHORA + 5 * DIA): J => ({ id, texto, inicio: iso(desdeMs), fin: iso(hastaMs) });
const CATALOGO: J[] = [
  { id: 'torta-sin', nombre: 'Torta mexicana sin queso', precio: 15, area: 'Promociones', descripcion: '' },
  { id: 'torta-con', nombre: 'Torta mexicana con queso', precio: 20, area: 'Promociones', descripcion: '' },
  { id: 'nachos', nombre: 'Nachos Supremos', precio: 58, area: 'Entradas', descripcion: '' },
  { id: 'taco', nombre: 'Taco de Birria (unidad)', precio: 21, area: 'Birria', descripcion: '' },
];
const ANUNCIOS: J[] = [
  { id: 'tortas', titulares: ['Tortas Mexicanas', 'Mañanas Tortas Mexicanas'], angulo: '', producto: null },
  { id: 'jueves', titulares: ['Jueves de +2'], angulo: '', producto: null },
];
const CAMPANAS: J[] = [campana('tortas', TORTAS), campana('jueves', JUEVES)];
const VIERNES = Date.UTC(2026, 10, 6, 14); // viernes 06/11/2026, 10:00 en La Paz

function panel(extra: J = {}): J {
  return {
    tenantId: 'qtaco', estadoComercio: 'activo',
    datosDelNegocio: { nombreNegocio: "Q'Taco", direccion: 'Calle Ejemplo 123' },
    operacion: { horarioAtencion: 'todos los días de 8 a 23', moneda: 'BOB', numeroRecepcion: REC, prefijosPermitidos: ['591'] },
    voz: { nombreAsistente: 'Taqui', nivelEmojis: 'pocos' },
    venta: { aceptaDelivery: true, aceptaRetiroEnLocal: true },
    catalogo: CATALOGO, campanas: CAMPANAS, anuncios: ANUNCIOS, catalogoWeb: { enlace: URL_CATALOGO },
    atencion: { estado: 'normal' },
    ...extra,
  };
}

interface Opciones { extraccion?: J; ahoraMs?: number; panel?: J; clasifica?: J | string | null; config?: J }
let contador = 0;
function crear(op: Opciones = {}) {
  const sesion: SesionDeMentira = crearSesion({ pid: PHONE_ID, ahora: () => op.ahoraMs ?? AHORA });
  const clasificaciones: LlamadaDoble[] = [];
  const clasifica = op.clasifica === undefined ? null : op.clasifica;
  const dobles: Record<string, Doble> = {
    ...doblesDelGuardado().dobles,
    ...sesion.dobles,
    'Verificar firma con el receptor': (ll) => ({ valido: true, deliveryId: ll.cuerpo?.['deliveryId'] }),
    'Traer configuración': () => ({ statusCode: 200, body: op.panel ?? panel() }),
    'Reportar mensaje (entrante)': () => ({ ok: true }),
    'Reportar mensaje (saliente)': () => ({ ok: true }),
    'Registrar cierre': () => ({ ok: true }),
    'Obtener URL del medio': () => ({ url: 'https://medios.ejemplo.invalid/m', mime_type: 'image/jpeg', file_size: 100_000 }),
    'Descargar medio': () => ({}),
    'Guardar comprobante': () => ({ statusCode: 200, body: { ruta: 'tenants/qtaco/comprobantes/x.jpg' } }),
    'Transcribir audio': () => ({ content: { parts: [{ text: 'hola' }] } }),
    'Leer comprobante (imagen)': () => ({ content: { parts: [{ text: JSON.stringify({ monto: '63.00', cuentaDestino: '***4321', nombreCuenta: 'Q TACO SRL', fecha: '05/11/2026', hora: '10:05', banco: 'X' }) }] } }),
    'Leer comprobante (PDF)': () => ({ content: { parts: [{ text: '{}' }] } }),
    'Cotejar en el servidor': () => ({ statusCode: 200, body: { resultado: 'cuadra', diferencias: [], cierreId: 'venta_prueba' } }),
    'Clasificar imagen': (ll) => {
      // Como n8n 2.36.5 (`baseAnalyze`): sin el campo binario pedido, el nodo falla ANTES de llamar a Gemini (no hay llamada ni costo).
      if (ll.parametros['binaryPropertyName'] !== 'data') throw new Error('no binary field ' + String(ll.parametros['binaryPropertyName']));
      clasificaciones.push(ll);
      if (clasifica === null) return { error: { message: 'sin saldo' } };
      return { content: { parts: [{ text: typeof clasifica === 'string' ? clasifica : JSON.stringify(clasifica) }] } };
    },
    Extraer: () => (op.extraccion ? { candidates: [{ content: { parts: [{ text: JSON.stringify(op.extraccion) }] } }] } : { error: { message: 'sin extracción declarada' } }),
    'Enviar a WhatsApp': (ll) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.EW${ll.n}` }] }),
    'Enviar respaldo': (ll) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.ER${ll.n}` }] }),
    'Enviar aviso': (ll) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.EA${ll.n}` }] }),
    'Aviso de respaldo': (ll) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.EB${ll.n}` }] }),
  };
  const mundo: Mundo = crearMundo({
    flujo: QTACO, dobles, alResponder: sesion.alResponder, ahoraMs: op.ahoraMs ?? AHORA,
    configBase: {
      phoneNumberIdEsperado: PHONE_ID, destinatariosAviso: `completo:59100000021,cocina:59100000022`, respaldoNumeroRecepcion: REC,
      horario: 'lun=08:00-23:00,mar=08:00-23:00,mie=08:00-23:00,jue=08:00-23:00,vie=08:00-23:00,sab=08:00-23:00,dom=08:00-23:00',
      plantillasPedidoLineas: '', ...(op.config ?? {}),
    },
  });
  return { mundo, sesion, clasificaciones };
}

interface Mensaje { type: string; [k: string]: unknown }
const entrega = (mensaje: Mensaje, referral?: J): J => ({
  headers: { 'x-aab1-signature': 'v1=abc', 'x-aab1-timestamp': '1', 'x-aab1-delivery-id': `entrega-${++contador}`, 'x-aab1-attempt': '1' },
  body: {
    field: 'messages',
    value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: '59100000001', phone_number_id: PHONE_ID },
      contacts: [{ profile: { name: 'Carlos Pérez' }, wa_id: CLIENTE }],
      messages: [{ from: CLIENTE, id: `wamid.ENT${++contador}`, timestamp: '1', ...mensaje, ...(referral ? { referral } : {}) }],
    },
  },
});
function conversacion(w: ReturnType<typeof crear>) {
  const turno = (m: Mensaje, referral?: J): ResultadoTurno => w.mundo.turno(entrega(m, referral), {});
  return {
    escribe: (t: string, referral?: J) => turno({ type: 'text', text: { body: t } }, referral),
    toca: (id: string, titulo = 'x') => turno({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: titulo } } }),
    imagen: (pie?: string, mime = 'image/jpeg') => turno({ type: 'image', image: { id: 'media-1', mime_type: mime, ...(pie ? { caption: pie } : {}) } }),
    documento: () => turno({ type: 'document', document: { id: 'media-2', mime_type: 'application/pdf' } }),
  };
}
const cuerpos = (t: ResultadoTurno): string[] => t.mensajes.map((m) => m.cuerpo);
const botonesDe = (m: { payload: J }): { id: string; title: string }[] =>
  ((m.payload['interactive']?.action?.buttons ?? []) as J[]).map((b) => ({ id: String(b['reply']?.id), title: String(b['reply']?.title) }));
const titulos = (t: ResultadoTurno): string[] => t.mensajes.flatMap((m) => botonesDe(m).map((b) => b.title));
const idDe = (t: ResultadoTurno, titulo: string): string => {
  for (const m of t.mensajes) { const b = botonesDe(m).find((x) => x.title === titulo); if (b) return b.id; }
  throw new Error(`no hay un botón «${titulo}»`);
};
const urlDeEnlace = (t: ResultadoTurno): string => String(t.mensajes.map((m) => m.payload['interactive']?.action?.parameters?.url).find((u) => typeof u === 'string') ?? '');
const estadoDe = (w: ReturnType<typeof crear>): J => w.sesion.estado(CLIENTE);

const A = String(DATOS['campanaPedidoMensaje']);
const B = String(DATOS['campanaReservaMensaje']);
const DETALLE = String(DATOS['campanaReservaDetalle']);
const SOLO_DELIVERY = String(DATOS['campanaPedidoEntrega']);
// Lo que sale al cliente lleva la voz común (identidad «con IA» y párrafos separados: `Armar mensajes`): el texto del negocio se compara ya con ella.
const esA = (t: ResultadoTurno): boolean => cuerpos(t)[0] === voz(A);
const esB = (t: ResultadoTurno): boolean => cuerpos(t)[0] === voz(B);
const ninguna = (t: ResultadoTurno): boolean => !t.mensajes.some((m) => [A, B, DETALLE, SOLO_DELIVERY].some((x) => m.cuerpo === x || m.cuerpo === voz(x)));


const AD_1 = '100000000000001';
const AD_2 = '100000000000002';
const SOLO_AD: J = { id: 'solo-ad', texto: '', adIds: [AD_1], inicio: iso(AHORA - DIA), fin: iso(AHORA + 5 * DIA) };
const conAd = (id: string, texto: string, adIds: string[], desdeMs = AHORA - DIA, hastaMs = AHORA + 5 * DIA): J => ({ id, texto, adIds, inicio: iso(desdeMs), fin: iso(hastaMs) });
const entrante = (t: ResultadoTurno): J => (t.salidas['Interpretar entrada']?.[0]?.[0] ?? {}) as J;
const reporteEntrante = (t: ResultadoTurno): J => (t.llamadas.ingesta.find((c) => (c as J)['direccion'] === 'entrante') ?? {}) as J;

describe("Q'Taco: la campana por Ad ID y por texto", () => {
  it('coincide el Ad ID: campana por adId, con idAnuncio y ctwaClid, y el reporte lleva adId/campanaId/campanaPor', () => {
    const w = crear({ panel: panel({ campanas: [...CAMPANAS, conAd('por-ad', '', [AD_1])] }) });
    const r = conversacion(w).escribe('hola', { source_id: AD_1, source_type: 'ad', ctwa_clid: 'clic-1', headline: 'Titular' });
    const e = entrante(r);
    expect(e['campana']).toEqual({ id: 'por-ad', texto: '', por: 'adId' });
    expect(e['anuncio']).toMatchObject({ titular: 'Titular', fuente: 'ad', idAnuncio: AD_1, ctwaClid: 'clic-1' });
    expect([e['adId'], e['campanaId'], e['campanaPor']]).toEqual([AD_1, 'por-ad', 'adId']);
    expect(reporteEntrante(r)).toMatchObject({ adId: AD_1, campanaId: 'por-ad', campanaPor: 'adId' });
  });
  it('coincide el texto: campana por texto y sin Ad ID', () => {
    const r = conversacion(crear()).escribe(TORTAS);
    const e = entrante(r);
    expect(e['campana']).toMatchObject({ id: 'tortas', por: 'texto' });
    expect([e['adId'], e['campanaId'], e['campanaPor']]).toEqual(['', 'tortas', 'texto']);
    expect(reporteEntrante(r)).toMatchObject({ campanaId: 'tortas', campanaPor: 'texto' });
    expect(reporteEntrante(r)['adId']).toBeUndefined();
  });
  it('coinciden el Ad ID y el texto: gana el Ad ID', () => {
    const w = crear({ panel: panel({ campanas: [conAd('tortas', TORTAS, []), conAd('por-ad', '', [AD_1])] }) });
    const e = entrante(conversacion(w).escribe(TORTAS, { source_id: AD_1 }));
    expect(e['campana']).toMatchObject({ id: 'por-ad', por: 'adId' });
  });
  it('no coincide ninguno: sin campana, y el mensaje se cuenta igual', () => {
    const w = crear({ panel: panel({ campanas: [...CAMPANAS, conAd('por-ad', '', [AD_1])] }) });
    const r = conversacion(w).escribe('hola', { source_id: AD_2 });
    const e = entrante(r);
    expect(e['campana']).toBeNull();
    expect([e['adId'], e['campanaId'], e['campanaPor']]).toEqual([AD_2, '', '']);
    expect(reporteEntrante(r)).toMatchObject({ adId: AD_2 });
    expect(reporteEntrante(r)['campanaId']).toBeUndefined();
  });
  it('sin referral: anuncio null y adId vacio; el reporte no lleva los campos', () => {
    const w = crear({ panel: panel({ campanas: [...CAMPANAS, conAd('por-ad', '', [AD_1])] }) });
    const r = conversacion(w).escribe('hola');
    const e = entrante(r);
    expect(e['anuncio']).toBeNull();
    expect(e['campana']).toBeNull();
    expect([e['adId'], e['campanaId'], e['campanaPor']]).toEqual(['', '', '']);
    expect(reporteEntrante(r)['adId']).toBeUndefined();
  });
  it('un Ad ID de una campana NO vigente no coincide', () => {
    const w = crear({ panel: panel({ campanas: [conAd('vieja', '', [AD_1], AHORA - 9 * DIA, AHORA - 2 * DIA)] }) });
    const e = entrante(conversacion(w).escribe('hola', { source_id: AD_1 }));
    expect(e['campana']).toBeNull();
    expect(e['adId']).toBe(AD_1);
  });
  it('una campana con texto y Ad ID por la que llega solo el Ad ID se vincula por adId', () => {
    const w = crear({ panel: panel({ campanas: [conAd('tortas', TORTAS, [AD_2]), campana('jueves', JUEVES)] }) });
    const e = entrante(conversacion(w).escribe('hola', { source_id: AD_2 }));
    expect(e['campana']).toMatchObject({ id: 'tortas', por: 'adId' });
  });
  it('el Ad ID solo (texto vacio) NO salta ningun menu ni cambia la respuesta: igual que sin la campana', () => {
    for (const t of ['hola', 'quiero reservar una mesa', 'quiero hacer un pedido']) {
      const sin = conversacion(crear()).escribe(t, { source_id: AD_1 });
      const con = conversacion(crear({ panel: panel({ campanas: [...CAMPANAS, SOLO_AD] }) })).escribe(t, { source_id: AD_1 });
      expect(entrante(con)['campana']).toMatchObject({ id: 'solo-ad', por: 'adId' });
      expect(cuerpos(con), t).toEqual(cuerpos(sin));
      expect(titulos(con), t).toEqual(titulos(sin));
      expect(ninguna(con), t).toBe(true);
    }
  });
});

describe("Q'Taco: el miniCRM recibe el Ad ID y la campana sin cambiar nada mas", () => {
  it('el prospecto lleva adId y campanaId solo si son validos; sin ellos, como antes', () => {
    const base = { from: CLIENTE, plan: { ruta: 'menu', pedido: null }, pedidoEstado: null, nombrePerfil: 'Carlos', avisoSalio: false, ahoraMs: AHORA, anteriorMs: null };
    const lib = (n: string): string => readFileSync(join(CARPETA_VM, 'src/lib', n), 'utf8');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L: any = new Function(`${lib('comun.js')}\n${lib('pedido.js')}\n${lib('crm.js')}\nreturn { vmProspectoCrm };`)();
    expect(L.vmProspectoCrm({ ...base, adId: AD_1, campanaId: 'por-ad' })).toMatchObject({ adId: AD_1, campanaId: 'por-ad' });
    const mal = L.vmProspectoCrm({ ...base, adId: 'no es', campanaId: 'con espacios' });
    expect('adId' in mal || 'campanaId' in mal).toBe(false);
    const sin = L.vmProspectoCrm(base);
    expect('adId' in sin || 'campanaId' in sin).toBe(false);
  });
});
