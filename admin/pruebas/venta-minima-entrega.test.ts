/**
 * =============================================================================
 * «SE ENTREGA LO QUE SE PROMETE» EN Q'TACO (Venta mínima v0) — R1, R3 y R5
 * =============================================================================
 *
 * EL CASO QUE LO ORIGINÓ (03/10/2026, Demo B). El QR del cobro falló porque Meta rechazó un media ID vencido; el texto iba
 * en el PIE de la imagen y el cliente no recibió nada, y n8n mostró `success`. La regla (`NOVUCHAT_plan-entrega-de-lo-prometido`,
 * PR-7 es Q'Taco) y cómo la cumple este flujo SIN NODOS NUEVOS (presupuesto de 50 nodos de producción):
 *
 *   R1  un envío cuenta como hecho solo si Meta devolvió un `messages[0].id` no vacío. `¿Falló el envío?` decide por ese id
 *       (no por `$json.error`) y el reporte saliente cuenta solo con `idMeta`;
 *   R3  si el respaldo en texto TAMBIÉN falla, la ejecución termina en ERROR (no en `success`), sin reportar nada como enviado y
 *       sin dejar el estado del teléfono en el paso nuevo: lo hace `Resumen del turno` (un Code que ya corre al final) con `throw`;
 *   R5  ningún fallo tragado: un envío con `continueRegularOutput` exige un verificador del id y `continueErrorOutput` exige su
 *       salida de error conectada. Lo hace cumplir `construir.mjs --verificar` sobre los JSON versionados.
 *
 * ESTA SUITE ESCRIBE NEGANDO. Corre el JSON VERSIONADO con el n8n de mentira (`lib/n8n-de-mentira.ts`): Meta rechaza de todas
 * las formas posibles (error, cuerpo vacío, sin `messages`, id vacío, excepción de red), y cada caso tiene su contraprueba
 * estática: se rompe una guardia en una COPIA del JSON y `--verificar` tiene que fallar.
 *
 * COSTO EN MENSAJES: 0 por conversación en el camino feliz. +1 al cliente solo en el turno en que el envío principal falla
 * (el respaldo en texto), en lugar del silencio.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';
import { type Flujo, type J } from './lib/flujo';
import { crearMundo, FalloDeNodo, type Doble, type LlamadaDoble, type ResultadoTurno } from './lib/n8n-de-mentira';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CARPETA_VM = join(AQUI, '../../Flujos/experimental/venta-minima');
const leer = (archivo: string): Flujo => JSON.parse(readFileSync(join(CARPETA_VM, archivo), 'utf8')) as Flujo;
const QTACO = leer('venta-minima.qtaco.json');

const AHORA = Date.UTC(2026, 9, 5, 14); // lunes 05/10/2026, 10:00 en La Paz
const CLIENTE = '59100000011';
const AV1 = '59100000021';
const AV2 = '59100000022';
const REC = '59100000031';
const PHONE_ID = '100000000000042';
const QR_URL = 'https://qr.ejemplo.invalid/qtaco.png';
const HORARIO_TODOS = 'lun=08:00-23:00,mar=08:00-23:00,mie=08:00-23:00,jue=08:00-23:00,vie=08:00-23:00,sab=08:00-23:00,dom=08:00-23:00';

const it_ = (id: string, nombre: string, precio: number, area: string): J => ({ id, nombre, precio, area, descripcion: `desc ${nombre}` });
const CATALOGO: J[] = [
  it_('nachos', 'Nachos Supremos', 58, 'Entradas'),
  it_('birria3', 'Tacos de Birria (orden de 3)', 55, 'Birria'),
  it_('birria1', 'Taco de Birria (unidad)', 21, 'Birria'),
  it_('horchata', 'Horchata', 20, 'Bebidas'),
];
const panel = (): J => ({
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
const RECHAZOS: Record<string, (ll: LlamadaDoble) => J> = {
  'error explícito (media ID vencido)': () => ({ error: { message: '(#131053) Media upload error', code: 131053 } }),
  'cuerpo vacío': () => ({}),
  'sin `messages`': () => ({ messaging_product: 'whatsapp', contacts: [{ wa_id: CLIENTE }] }),
  '`messages` vacío': () => ({ messaging_product: 'whatsapp', messages: [] }),
  '`messages[0].id` vacío': () => ({ messaging_product: 'whatsapp', messages: [{ id: '' }] }),
  'una respuesta cuyo `error` no viene en el cuerpo': () => ({ statusCode: 400, body: 'Bad Request' }),
};
const ACEPTA = (nodo: string) => (ll: LlamadaDoble): J => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.${nodo.replace(/\W+/g, '')}${ll.n}` }] });

type ModoDeEnvio = 'acepta' | 'lanza' | string;

function crear(envios: Partial<Record<'Enviar a WhatsApp' | 'Enviar respaldo', ModoDeEnvio>> = {}, flujo: Flujo = QTACO) {
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
type Mundial = ReturnType<typeof crear>;

let contador = 0;
function entrega(from: string, mensaje: J): J {
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
const texto = (t: string): J => ({ type: 'text', text: { body: t } });
const boton = (id: string, titulo: string): J => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: titulo } } });
const turno = (w: Mundial, m: J, tolerar = false): ResultadoTurno => w.mundo.turno(entrega(CLIENTE, m), tolerar ? { tolerarFallo: true } : {});

const botonesDe = (m: { payload: J }): { id: string; title: string }[] =>
  ((m.payload['interactive']?.action?.buttons ?? []) as J[]).map((b) => ({ id: String(b['reply']?.id), title: String(b['reply']?.title) }));
function idDeBoton(t: ResultadoTurno, titulo: string): string {
  for (const m of t.mensajes) {
    const b = botonesDe(m).find((x) => x.title === titulo);
    if (b) return b.id;
  }
  throw new Error(`no hay un botón «${titulo}»`);
}
/** Lo que se mandó a cada servicio DESDE que se llamó a `marcar` (el mundo acumula todos los turnos y el que falla lanza). */
const marcar = (w: Mundial) => ({ ingesta: w.mundo.llamadas.ingesta.length });
type Marca = ReturnType<typeof marcar>;
const salientes = (w: Mundial, desde: Marca = { ingesta: 0 }): J[] => w.mundo.llamadas.ingesta.slice(desde.ingesta).filter((x) => x['direccion'] === 'saliente');
const estadoDe = (w: Mundial): J => ((w.mundo.sd['ventaMinima'] as J | undefined)?.['estados']?.[CLIENTE] ?? {}) as J;
const cobrosAbiertos = (w: Mundial, desde: Marca = { ingesta: 0 }): J[] => w.mundo.llamadas.ingesta.slice(desde.ingesta).filter((x) => x['evento'] === 'qr_enviado');

/** Un pedido armado hasta «Confirmar pedido»: la confirmación es el turno que manda el QR. */
function pedidoListoParaConfirmar(envios: Partial<Record<'Enviar a WhatsApp' | 'Enviar respaldo', ModoDeEnvio>> = {}) {
  const w = crear();
  turno(w, texto('hola'));
  turno(w, texto('hola'));
  w.estado.extraccion = { lineas: [{ producto: 'tacos de birria', cantidad: 4, forma: 'unidad', detalle: 'sin cebolla' }], entrega: 'recojo', direccion: '', referencia: '', nombre: '', quiereHablar: false };
  const resumen = turno(w, texto('quiero 4 tacos de birria'));
  const idConfirmar = idDeBoton(resumen, 'Confirmar pedido');
  // A partir de acá Meta rechaza como diga el caso.
  Object.assign(w.envios, envios);
  return { w, idConfirmar, estadoAntes: JSON.parse(JSON.stringify(estadoDe(w))) as J };
}

// =====================================================================================================
// 1. EL CAMINO FELIZ NO CAMBIA
// =====================================================================================================
describe('entrega: lo que Meta acepta sigue igual (0 mensajes de más)', () => {
  it('con Meta aceptando, el QR sale una sola vez, se reporta con su `idMeta`, abre el cobro una vez y la ejecución no falla', () => {
    const { w, idConfirmar } = pedidoListoParaConfirmar();
    const desde = marcar(w);
    const t = turno(w, boton(idConfirmar, 'Confirmar pedido'));
    expect(t.fallo).toBeNull();
    expect(t.mensajes.map((m) => [m.nodo, m.ok, m.tipo])).toEqual([['Enviar a WhatsApp', true, 'image']]);
    expect(t.ejecutados.has('Enviar respaldo')).toBe(false);
    expect(cobrosAbiertos(w, desde)).toHaveLength(1);
    const rep = salientes(w, desde);
    expect(rep.length).toBeGreaterThan(0);
    for (const r of rep) expect(String(r['idMeta']), JSON.stringify(r)).toMatch(/^wamid\./);
    expect(estadoDe(w)['paso']).toBe('esperando_comprobante');
  });
});

// =====================================================================================================
// 2. R1 y la réplica del caso del 03/10: el envío principal falla y el respaldo en texto SÍ sale
// =====================================================================================================
describe('R1: el envío falla por cualquiera de sus formas y el cliente recibe el respaldo en texto', () => {
  for (const modo of [...Object.keys(RECHAZOS), 'lanza']) {
    it(`QR rechazado por Meta (${modo}): sale el mismo texto con el enlace al QR, se reporta SOLO el respaldo y el cobro se abre una vez`, () => {
      const { w, idConfirmar } = pedidoListoParaConfirmar({ 'Enviar a WhatsApp': modo });
      const desde = marcar(w);
      const t = turno(w, boton(idConfirmar, 'Confirmar pedido'));
      expect(t.fallo).toBeNull();
      // Por nodo, no por `ok`: una respuesta VACÍA no trae `error` y el arnés la da por `ok`, pero no es un envío hecho.
      expect(t.mensajes.map((m) => m.nodo)).toEqual(['Enviar a WhatsApp', 'Enviar respaldo']);
      expect(t.mensajes[1]?.ok).toBe(true);
      // El texto que iba en el PIE de la imagen (caso del 03/10) llega entero, más el enlace para abrir el QR.
      const imagen = t.mensajes[0]?.payload['image']?.caption as string;
      const respaldo = t.mensajes[1]?.cuerpo ?? '';
      expect(typeof imagen).toBe('string');
      expect(respaldo).toContain(imagen.slice(0, 60));
      expect(respaldo).toContain(`Abre el QR aquí: ${QR_URL}`);
      // Reporte por hecho: uno, con el id del respaldo; el rechazado no cuenta.
      const rep = salientes(w, desde);
      expect(rep).toHaveLength(1);
      expect(String(rep[0]?.['idMeta'])).toMatch(/^wamid\.Enviarrespaldo/);
      expect(cobrosAbiertos(w, desde)).toHaveLength(1);
      expect(estadoDe(w)['paso']).toBe('esperando_comprobante');
    });
  }
});

// =====================================================================================================
// 3. R3: Meta rechaza el envío principal Y el respaldo
// =====================================================================================================
describe('R3: si el respaldo también falla, la ejecución termina en ERROR, sin reportes y sin estado nuevo', () => {
  for (const principal of [...Object.keys(RECHAZOS), 'lanza']) {
    for (const respaldo of [...Object.keys(RECHAZOS), 'lanza']) {
      // 7 x 7 = 49 combinaciones es mucho ruido: se prueban las diagonales y los extremos.
      if (principal !== respaldo && !(principal === 'lanza' || respaldo === 'lanza' || principal.startsWith('error') || respaldo.startsWith('cuerpo'))) continue;
      it(`principal «${principal}» y respaldo «${respaldo}»: error visible (Entrega fallida), 0 reportes salientes, el cobro NO se abre y el estado vuelve al previo`, () => {
        const { w, idConfirmar, estadoAntes } = pedidoListoParaConfirmar({ 'Enviar a WhatsApp': principal, 'Enviar respaldo': respaldo });
        // Sin tolerar el fallo, el turno LANZA: es lo que n8n marca como ejecución con error.
        const desde = marcar(w);
        expect(() => turno(w, boton(idConfirmar, 'Confirmar pedido'))).toThrow(/Entrega fallida/);
        expect(salientes(w, desde)).toHaveLength(0);
        expect(cobrosAbiertos(w, desde)).toHaveLength(0);
        // El estado no quedó en el paso que el cliente nunca vio (un QR que no llegó).
        expect(estadoDe(w)['paso']).not.toBe('esperando_comprobante');
        expect(estadoDe(w)['paso']).toBe(estadoAntes['paso']);
      });
    }
  }

  it('el fallo queda en «Resumen del turno» (el último nodo), el error no lleva texto ni teléfono del cliente, y ese nodo es el único que lo lanza', () => {
    const { w, idConfirmar } = pedidoListoParaConfirmar({ 'Enviar a WhatsApp': 'cuerpo vacío', 'Enviar respaldo': 'cuerpo vacío' });
    const t = turno(w, boton(idConfirmar, 'Confirmar pedido'), true);
    expect(t.fallo?.nodo).toBe('Resumen del turno');
    expect(t.fallo?.mensaje).toMatch(/Entrega fallida/);
    expect(t.fallo?.mensaje).not.toContain(CLIENTE);
    expect(t.fallo?.mensaje).not.toMatch(/birria|Q'Taco|QR/i);
    expect(t.orden[t.orden.length - 1]).toBe('Resumen del turno');
    // Todo lo anterior corrió: los envíos se intentaron antes de dar el turno por fallido.
    expect(t.mensajes.map((m) => m.nodo)).toEqual(['Enviar a WhatsApp', 'Enviar respaldo']);
  });

  it('el mismo turno que falla se puede reintentar: el cliente toca «Confirmar» otra vez y, con Meta de vuelta, recibe el QR y se abre UN cobro', () => {
    const { w, idConfirmar } = pedidoListoParaConfirmar({ 'Enviar a WhatsApp': 'cuerpo vacío', 'Enviar respaldo': 'cuerpo vacío' });
    expect(() => turno(w, boton(idConfirmar, 'Confirmar pedido'))).toThrow(/Entrega fallida/);
    w.envios['Enviar a WhatsApp'] = 'acepta';
    w.envios['Enviar respaldo'] = 'acepta';
    const desde = marcar(w);
    const t = turno(w, boton(idConfirmar, 'Confirmar pedido'));
    expect(t.fallo).toBeNull();
    expect(t.mensajes.some((m) => m.ok && m.tipo === 'image')).toBe(true);
    expect(cobrosAbiertos(w, desde)).toHaveLength(1);
    expect(estadoDe(w)['paso']).toBe('esperando_comprobante');
  });

  it('un turno cuyos mensajes sí salieron (aunque sea por el respaldo) nunca falla, y un turno SIN mensajes tampoco', () => {
    const { w } = pedidoListoParaConfirmar();
    expect(turno(w, texto('hola')).fallo).toBeNull();
    // Acuse de estado: no es un mensaje, no pasa por los envíos.
    const acuse = w.mundo.turno({ headers: { 'x-aab1-delivery-id': 'acuse-1' }, body: { field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: 'x', status: 'delivered' }] } } }, { tolerarFallo: true });
    expect(acuse.fallo).toBeNull();
  });
});

// =====================================================================================================
// 3b. LOS DEFECTOS VIEJOS, REPRODUCIDOS: la prueba de que estas pruebas sí los verían
// =====================================================================================================
describe('contrapruebas: con el defecto viejo puesto, el cliente se queda sin nada y la ejecución sale en success', () => {
  const sin = (cambio: (f: Flujo) => void): Flujo => {
    const f = JSON.parse(JSON.stringify(QTACO)) as Flujo;
    cambio(f);
    return f;
  };
  const nodoDe = (f: Flujo, nombre: string) => f.nodes.find((n) => n.name === nombre) as NonNullable<Flujo['nodes'][number]>;

  it('IF que mira solo `$json.error`: Meta contesta sin id y sin error, NO se manda el respaldo y nadie lo nota (el flujo real SÍ lo manda)', () => {
    const viejo = sin((f) => { nodoDe(f, '¿Falló el envío?').parameters['conditions'].conditions[0].leftValue = '={{ !!($json && $json.error) }}'; });
    const w = crear({ 'Enviar a WhatsApp': 'sin `messages`' }, viejo);
    const t = turno(w, texto('hola'), true);
    // El cliente no recibió nada: ni respaldo ni nada. (Solo el último recurso de `Resumen del turno` evita que la ejecución salga en success.)
    expect(t.mensajes.map((m) => m.nodo)).toEqual(['Enviar a WhatsApp']);
    // El flujo versionado, con el mismo rechazo, manda el respaldo.
    const real = crear({ 'Enviar a WhatsApp': 'sin `messages`' });
    const tr = turno(real, texto('hola'), true);
    expect(tr.mensajes.map((m) => m.nodo)).toEqual(['Enviar a WhatsApp', 'Enviar respaldo']);
  });

  it('respaldo sin `throw`: el principal y el respaldo fallan y la ejecución termina en success (el flujo real termina en error)', () => {
    const viejo = sin((f) => { const n = nodoDe(f, 'Resumen del turno'); n.parameters['jsCode'] = String(n.parameters['jsCode']).replace(/throw new Error\(/g, 'void ('); });
    const w = crear({ 'Enviar a WhatsApp': 'sin `messages`', 'Enviar respaldo': 'cuerpo vacío' }, viejo);
    const t = turno(w, texto('hola'), true);
    expect(t.fallo).toBeNull(); // success con el cliente sin respuesta: el defecto del 03/10
    expect(t.mensajes.map((m) => m.nodo)).toEqual(['Enviar a WhatsApp', 'Enviar respaldo']);
    const real = crear({ 'Enviar a WhatsApp': 'sin `messages`', 'Enviar respaldo': 'cuerpo vacío' });
    expect(turno(real, texto('hola'), true).fallo?.nodo).toBe('Resumen del turno');
  });

  it('el reporte saliente sin la condición del id contaría un mensaje que no salió (el flujo real no reporta nada)', () => {
    const viejo = sin((f) => { nodoDe(f, '¿Reportar? (saliente)').parameters['conditions'].conditions[0].leftValue = "={{ $('Armar mensajes').item.json.reportar === true }}"; });
    const w = crear({ 'Enviar a WhatsApp': 'cuerpo vacío', 'Enviar respaldo': 'cuerpo vacío' }, viejo);
    const desde = marcar(w);
    const t = turno(w, texto('hola'), true);
    expect(salientes(w, desde).length).toBeGreaterThan(0); // reportó como enviado lo que Meta rechazó
    expect(t.fallo).not.toBeNull();
    const real = crear({ 'Enviar a WhatsApp': 'cuerpo vacío', 'Enviar respaldo': 'cuerpo vacío' });
    const d2 = marcar(real);
    turno(real, texto('hola'), true);
    expect(salientes(real, d2)).toHaveLength(0);
  });
});

// =====================================================================================================
// 4. Las guardias de `construir.mjs --verificar` (R1, R3, R5): cada una con su negativo sobre una COPIA del JSON versionado
// =====================================================================================================
describe('las guardias de entrega de `construir.mjs --verificar` (sobre los JSON versionados)', () => {
  function verificarEnCopia(modifica: (vm: string) => void, args: string[] = ['--verificar']) {
    const tmp = mkdtempSync(join(tmpdir(), 'vm-ent-'));
    try {
      const vm = join(tmp, 'Flujos/experimental/venta-minima');
      const datos = join(tmp, 'admin/scripts/datos/venta-minima');
      mkdirSync(vm, { recursive: true });
      mkdirSync(datos, { recursive: true });
      cpSync(CARPETA_VM, vm, { recursive: true, filter: (src) => !src.endsWith('.local.json') });
      cpSync(join(AQUI, '../scripts/datos/venta-minima'), datos, { recursive: true });
      modifica(vm);
      return spawnSync(process.execPath, [join(vm, 'construir.mjs'), ...args], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  const editar = (vm: string, archivo: string, f: (flujo: Flujo) => void): void => {
    const ruta = join(vm, archivo);
    const flujo = JSON.parse(readFileSync(ruta, 'utf8')) as Flujo;
    f(flujo);
    writeFileSync(ruta, JSON.stringify(flujo, null, 2) + '\n');
  };
  const nodo = (f: Flujo, nombre: string) => f.nodes.find((n) => n.name === nombre) as NonNullable<Flujo['nodes'][number]>;
  const rompe = (etiqueta: string, cambio: (f: Flujo) => void, mensaje: RegExp, archivo = 'venta-minima.qtaco.json') => {
    it(`FALLA: ${etiqueta}`, () => {
      const r = verificarEnCopia((vm) => editar(vm, archivo, cambio));
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(mensaje);
    });
  };

  it('contraprueba: sin tocar nada, `--verificar` sale con 0 (las tres variantes al día)', () => {
    const r = verificarEnCopia(() => undefined);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('venta-minima.qtaco.json al día');
  });

  // R1
  rompe('`¿Falló el envío?` mira SOLO `$json.error` (la forma vieja)', (f) => {
    const c = nodo(f, '¿Falló el envío?').parameters['conditions'].conditions[0];
    c.leftValue = '={{ !!($json && $json.error) }}';
  }, /R1: «¿Falló el envío\?»/);
  rompe('`¿Falló el envío?` mira el id Y el `error`', (f) => {
    const c = nodo(f, '¿Falló el envío?').parameters['conditions'].conditions[0];
    c.leftValue = '={{ !!($json.error) || !((($json.messages || [])[0] || {}).id) }}';
  }, /R1: «¿Falló el envío\?» mira `error`/);
  rompe('`¿Reportar? (saliente)` ya no exige el id de Meta', (f) => {
    nodo(f, '¿Reportar? (saliente)').parameters['conditions'].conditions[0].leftValue = "={{ $('Armar mensajes').item.json.reportar === true }}";
  }, /R1: «¿Reportar\? \(saliente\)» no exige/);
  rompe('`Reportar mensaje (saliente)` no manda `idMeta` desde el id de Meta', (f) => {
    const n = nodo(f, 'Reportar mensaje (saliente)');
    n.parameters['jsonBody'] = String(n.parameters['jsonBody']).replace("((($json || {}).messages || [])[0] || {}).id || ''", "''");
  }, /R1: «Reportar mensaje \(saliente\)» no manda `idMeta`/);

  // R3
  rompe('`Resumen del turno` sin `throw` (el respaldo falla y la ejecución termina en success)', (f) => {
    const n = nodo(f, 'Resumen del turno');
    n.parameters['jsCode'] = String(n.parameters['jsCode']).replace(/throw new Error\(/g, 'console.log(');
  }, /R3: «Resumen del turno» no lanza error/);
  rompe('`Resumen del turno` ya no mira el respaldo', (f) => {
    const n = nodo(f, 'Resumen del turno');
    n.parameters['jsCode'] = String(n.parameters['jsCode']).replace(/Enviar respaldo/g, 'Otro nodo');
  }, /R3: «Resumen del turno» no lanza error/);
  rompe('`Resumen del turno` queda ARRIBA de los envíos (correría antes de enviar)', (f) => {
    nodo(f, 'Resumen del turno').position = [7400, 100];
  }, /R3: «Resumen del turno» debe estar por debajo/);
  rompe('alguien agrega un nodo «Entrega fallida» (consume presupuesto de nodos; el último recurso va en Resumen)', (f) => {
    f.nodes.push({ id: 'entrega-fallida', name: 'Entrega fallida', type: 'n8n-nodes-base.code', parameters: { jsCode: 'throw new Error("x")' } } as Flujo['nodes'][number]);
  }, /R3: no hay nodo «Entrega fallida»/);

  // R5
  rompe('un envío con `continueErrorOutput` y la salida de error VACÍA', (f) => {
    nodo(f, 'Enviar a WhatsApp').onError = 'continueErrorOutput';
    f.connections['Enviar a WhatsApp'] = { main: [(f.connections['Enviar a WhatsApp'] as J).main[0], []] };
  }, /R5: «Enviar a WhatsApp» usa continueErrorOutput con la salida de error desconectada/);
  rompe('el respaldo con `continueErrorOutput` y la salida de error desconectada', (f) => {
    nodo(f, 'Enviar respaldo').onError = 'continueErrorOutput';
  }, /R5: «Enviar respaldo» usa continueErrorOutput con la salida de error desconectada/);
  rompe('un envío NUEVO a Meta con `continueRegularOutput` y sin verificador del id', (f) => {
    const molde = nodo(f, 'Enviar a WhatsApp');
    f.nodes.push({ ...molde, id: 'enviar-otro', name: 'Enviar otro', position: [7640, 900] });
  }, /R5: «Enviar otro» \(envío a Meta con continueRegularOutput\) no tiene un verificador/);
  rompe('el verificador del envío ya no lee el id (`¿Falló el envío?` decide por un campo cualquiera)', (f) => {
    nodo(f, '¿Falló el envío?').parameters['conditions'].conditions[0].leftValue = '={{ $json.ok !== true }}';
  }, /R5: el verificador «¿Falló el envío\?» de «Enviar a WhatsApp» no lee messages\[0\]\.id/);
  rompe('el verificador del respaldo ya no corre después de él (su rama pasa ARRIBA)', (f) => {
    nodo(f, 'Resumen del turno').position = [7400, 100];
  }, /R5: el verificador «Resumen del turno» no corre después de «Enviar respaldo»/);
  rompe('el envío principal con `continueOnFail`', (f) => {
    (nodo(f, 'Enviar a WhatsApp') as unknown as J)['continueOnFail'] = true;
  }, /R5: «Enviar a WhatsApp» es un envío a Meta con continueOnFail/);

  // Variantes: las guardias valen para las tres salidas
  for (const archivo of ['venta-minima.prueba.json', 'venta-minima.ensayo-demo-a.json']) {
    rompe(`(${archivo}) `+ '`¿Falló el envío?` mira solo `error`', (f) => {
      nodo(f, '¿Falló el envío?').parameters['conditions'].conditions[0].leftValue = '={{ !!($json && $json.error) }}';
    }, /R1: «¿Falló el envío\?»/, archivo);
  }
});

// =====================================================================================================
// 5. El presupuesto de nodos: la regla de entrega NO sumó ningún nodo
// =====================================================================================================
describe('presupuesto de nodos de producción (Andres, 03/10/2026): 50 como máximo', () => {
  it('el JSON de Q\'Taco tiene como máximo 50 nodos y NO tiene un nodo «Entrega fallida» (R3 va dentro de «Resumen del turno»)', () => {
    expect(QTACO.nodes.length).toBeLessThanOrEqual(50);
    expect(QTACO.nodes.map((n) => n.name)).not.toContain('Entrega fallida');
  });

  it('`--verificar` FALLA si un JSON de producción crece por encima de 50 nodos', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vm-tope-'));
    try {
      const vm = join(tmp, 'Flujos/experimental/venta-minima');
      const datos = join(tmp, 'admin/scripts/datos/venta-minima');
      mkdirSync(vm, { recursive: true });
      mkdirSync(datos, { recursive: true });
      cpSync(CARPETA_VM, vm, { recursive: true, filter: (src) => !src.endsWith('.local.json') });
      cpSync(join(AQUI, '../scripts/datos/venta-minima'), datos, { recursive: true });
      const ruta = join(vm, 'venta-minima.qtaco.json');
      const f = JSON.parse(readFileSync(ruta, 'utf8')) as Flujo;
      f.nodes.push({ id: 'uno-de-mas', name: 'Uno de más', type: 'n8n-nodes-base.noOp', parameters: {} } as Flujo['nodes'][number]);
      writeFileSync(ruta, JSON.stringify(f, null, 2) + '\n');
      const r = spawnSync(process.execPath, [join(vm, 'construir.mjs'), '--verificar'], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/tiene 51 nodos y el tope de producción es 50/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('el error de entrega es de verdad un error de n8n: `FalloDeNodo` (y no un `success` con un aviso adentro)', () => {
    const { w, idConfirmar } = pedidoListoParaConfirmar({ 'Enviar a WhatsApp': 'cuerpo vacío', 'Enviar respaldo': 'cuerpo vacío' });
    let capturado: unknown = null;
    try { turno(w, boton(idConfirmar, 'Confirmar pedido')); } catch (e) { capturado = e; }
    expect(capturado).toBeInstanceOf(FalloDeNodo);
  });
});
