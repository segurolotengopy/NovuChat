/**
 * EL MUNDO DE PRUEBA DE Q'TACO (Venta mínima v0), COMPARTIDO por las suites de entrega y de topología del catálogo web.
 *
 * Corre el JSON VERSIONADO con el n8n de mentira (`./n8n-de-mentira`): la red (consola, Meta, Gemini, receptor) son dobles, todo
 * lo demás es el código real del flujo. `crear({...envios})` arma el mundo; `envios` dice cómo contesta Meta en cada nodo de
 * envío (`'acepta'`, `'lanza'` o una de las formas de `RECHAZOS`). Una sola fuente de verdad para no copiar la décima variante.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';
import { type Flujo, type J } from './flujo';
import { crearMundo, type Doble, type LlamadaDoble, type ResultadoTurno } from './n8n-de-mentira';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const CARPETA_PRUEBAS = join(AQUI, '..');
export const CARPETA_VM = join(AQUI, '../../../Flujos/experimental/venta-minima');
export const leer = (archivo: string): Flujo => JSON.parse(readFileSync(join(CARPETA_VM, archivo), 'utf8')) as Flujo;
export const QTACO = leer('venta-minima.qtaco.json');

export const AHORA = Date.UTC(2026, 9, 5, 14); // lunes 05/10/2026, 10:00 en La Paz
export const CLIENTE = '59100000011';
export const AV1 = '59100000021';
export const AV2 = '59100000022';
export const REC = '59100000031';
export const PHONE_ID = '100000000000042';
export const QR_URL = 'https://qr.ejemplo.invalid/qtaco.png';
export const HORARIO_TODOS = 'lun=08:00-23:00,mar=08:00-23:00,mie=08:00-23:00,jue=08:00-23:00,vie=08:00-23:00,sab=08:00-23:00,dom=08:00-23:00';

export const it_ = (id: string, nombre: string, precio: number, area: string): J => ({ id, nombre, precio, area, descripcion: `desc ${nombre}` });
export const CATALOGO: J[] = [
  it_('nachos', 'Nachos Supremos', 58, 'Entradas'),
  it_('birria3', 'Tacos de Birria (orden de 3)', 55, 'Birria'),
  it_('birria1', 'Taco de Birria (unidad)', 21, 'Birria'),
  it_('horchata', 'Horchata', 20, 'Bebidas'),
];
export const panel = (): J => ({
  tenantId: 'qtaco',
  estadoComercio: 'activo',
  datosDelNegocio: { nombreNegocio: "Q'Taco", direccion: 'Calle Ejemplo 123' },
  operacion: { horarioAtencion: 'todos los días de 8 a 23', moneda: 'BOB', numeroRecepcion: REC, prefijosPermitidos: ['591'] },
  voz: { nombreAsistente: 'Taqui', nivelEmojis: 'pocos' },
  venta: { aceptaDelivery: true, aceptaRetiroEnLocal: true },
  catalogo: CATALOGO,
  campanas: [],
  atencion: { estado: 'normal' },
  cobroReal: { nombreCuenta: 'Q TACO SRL', banco: 'Banco Ejemplo' },
  cobro: { activo: true, qr: { url: QR_URL } },
});

// ------------------------------------------------------------------------------ cómo puede rechazar Meta
/** Cada forma de «Meta no entregó»: ninguna de ellas es un `messages[0].id`. */
export const RECHAZOS: Record<string, (ll: LlamadaDoble) => J> = {
  'error explícito (media ID vencido)': () => ({ error: { message: '(#131053) Media upload error', code: 131053 } }),
  'cuerpo vacío': () => ({}),
  'sin `messages`': () => ({ messaging_product: 'whatsapp', contacts: [{ wa_id: CLIENTE }] }),
  '`messages` vacío': () => ({ messaging_product: 'whatsapp', messages: [] }),
  '`messages[0].id` vacío': () => ({ messaging_product: 'whatsapp', messages: [{ id: '' }] }),
  'una respuesta cuyo `error` no viene en el cuerpo': () => ({ statusCode: 400, body: 'Bad Request' }),
};
export const ACEPTA = (nodo: string) => (ll: LlamadaDoble): J => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.${nodo.replace(/\W+/g, '')}${ll.n}` }] });

export type ModoDeEnvio = 'acepta' | 'lanza' | string;

export function crear(envios: Partial<Record<'Enviar a WhatsApp' | 'Enviar respaldo', ModoDeEnvio>> = {}, flujo: Flujo = QTACO) {
  const estado = { extraccion: null as J | null };
  const doble = (nodo: 'Enviar a WhatsApp' | 'Enviar respaldo'): Doble => (ll: LlamadaDoble) => {
    const modo = envios[nodo] ?? 'acepta';
    if (modo === 'acepta') return ACEPTA(nodo)(ll);
    if (modo === 'lanza') throw new Error('fetch failed: red caída');
    const r = RECHAZOS[modo];
    if (!r) throw new Error(`modo de rechazo desconocido: ${modo}`);
    return r(ll);
  };
  const dobles: Record<string, Doble> = {
    'Verificar firma con el receptor': (ll) => ({ valido: true, deliveryId: ll.cuerpo?.['deliveryId'] }),
    'Traer configuración': () => ({ statusCode: 200, body: panel() }),
    'Reportar mensaje (entrante)': () => ({ ok: true }),
    'Reportar mensaje (saliente)': () => ({ ok: true }),
    'Registrar cierre': () => ({ ok: true }),
    'Obtener URL del medio': () => ({ url: 'https://medios.ejemplo.invalid/m', mime_type: 'image/jpeg', file_size: 100_000 }),
    'Descargar medio': () => ({}),
    'Transcribir audio': () => ({ content: { parts: [{ text: 'quiero 4 tacos de birria' }] } }),
    'Leer comprobante (imagen)': () => ({}),
    'Leer comprobante (PDF)': () => ({}),
    'Cotejar en el servidor': () => ({ statusCode: 200, body: { resultado: 'cuadra', diferencias: [], cierreId: 'venta_prueba' } }),
    Extraer: () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(estado.extraccion ?? {}) }] } }] }),
    'Enviar a WhatsApp': doble('Enviar a WhatsApp'),
    'Enviar respaldo': doble('Enviar respaldo'),
    'Enviar aviso': ACEPTA('Enviar aviso'),
    'Aviso de respaldo': ACEPTA('Aviso de respaldo'),
  };
  const mundo = crearMundo({
    flujo,
    dobles,
    ahoraMs: AHORA,
    configBase: {
      phoneNumberIdEsperado: PHONE_ID,
      destinatariosAviso: `completo:${AV1},cocina:${AV2}`,
      respaldoNumeroRecepcion: REC,
      horario: HORARIO_TODOS,
    },
  });
  return { mundo, estado, envios };
}
export type Mundial = ReturnType<typeof crear>;

let contador = 0;
export function entrega(from: string, mensaje: J): J {
  const msg = { from, id: `wamid.ENT${++contador}`, timestamp: '1', ...mensaje };
  return {
    headers: { 'x-aab1-signature': 'v1=abc', 'x-aab1-timestamp': '1', 'x-aab1-delivery-id': `entrega-${++contador}`, 'x-aab1-attempt': '1' },
    body: {
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '59100000001', phone_number_id: PHONE_ID },
        contacts: [{ profile: { name: 'Carlos Pérez' }, wa_id: from }],
        messages: [msg],
      },
    },
  };
}
export const texto = (t: string): J => ({ type: 'text', text: { body: t } });
export const boton = (id: string, titulo: string): J => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: titulo } } });
export const turno = (w: Mundial, m: J, tolerar = false): ResultadoTurno => w.mundo.turno(entrega(CLIENTE, m), tolerar ? { tolerarFallo: true } : {});

export const botonesDe = (m: { payload: J }): { id: string; title: string }[] =>
  ((m.payload['interactive']?.action?.buttons ?? []) as J[]).map((b) => ({ id: String(b['reply']?.id), title: String(b['reply']?.title) }));
export function idDeBoton(t: ResultadoTurno, titulo: string): string {
  for (const m of t.mensajes) {
    const b = botonesDe(m).find((x) => x.title === titulo);
    if (b) return b.id;
  }
  throw new Error(`no hay un botón «${titulo}»`);
}
/** Lo que se mandó a cada servicio DESDE que se llamó a `marcar` (el mundo acumula todos los turnos y el que falla lanza). */
export const marcar = (w: Mundial) => ({ ingesta: w.mundo.llamadas.ingesta.length });
export type Marca = ReturnType<typeof marcar>;
export const salientes = (w: Mundial, desde: Marca = { ingesta: 0 }): J[] => w.mundo.llamadas.ingesta.slice(desde.ingesta).filter((x) => x['direccion'] === 'saliente');
export const estadoDe = (w: Mundial): J => ((w.mundo.sd['ventaMinima'] as J | undefined)?.['estados']?.[CLIENTE] ?? {}) as J;
export const cobrosAbiertos = (w: Mundial, desde: Marca = { ingesta: 0 }): J[] => w.mundo.llamadas.ingesta.slice(desde.ingesta).filter((x) => x['evento'] === 'qr_enviado');


// ------------------------------------------------------------------------------ `construir.mjs --verificar` sobre una COPIA
/** Copia la carpeta del flujo y los datos a un temporal, deja que `modifica` los cambie y corre `construir.mjs` ahí (nunca toca el repositorio). */
export function verificarEnCopia(modifica: (vm: string) => void, args: string[] = ['--verificar']) {
  const tmp = mkdtempSync(join(tmpdir(), 'vm-copia-'));
  try {
    const vm = join(tmp, 'Flujos/experimental/venta-minima');
    const datos = join(tmp, 'admin/scripts/datos/venta-minima');
    mkdirSync(vm, { recursive: true });
    mkdirSync(datos, { recursive: true });
    cpSync(CARPETA_VM, vm, { recursive: true, filter: (src) => !src.endsWith('.local.json') }); // un `.local.json` lleva valores reales: nunca a un temporal
    cpSync(join(AQUI, '../../scripts/datos/venta-minima'), datos, { recursive: true });
    modifica(vm);
    return spawnSync(process.execPath, [join(vm, 'construir.mjs'), ...args], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
export const editarJson = (vm: string, archivo: string, f: (flujo: Flujo) => void): void => {
  const ruta = join(vm, archivo);
  const flujo = JSON.parse(readFileSync(ruta, 'utf8')) as Flujo;
  f(flujo);
  writeFileSync(ruta, JSON.stringify(flujo, null, 2) + '\n');
};
export const nodoDe = (f: Flujo, nombre: string) => f.nodes.find((n) => n.name === nombre) as NonNullable<Flujo['nodes'][number]>;
