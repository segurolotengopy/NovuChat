/**
 * EL miniCRM EN EL FLUJO DE RUBÉN (módulo `crm`, F3 del 02/11/2026). Dos capas:
 *   · UNIDADES: `rrProspectoCrm` (la función pura de `rr.js` que arma el prospecto desde el turno, con vocabulario cerrado) y `crmDecidirFila` (el módulo, con el adaptador de señales) sobre la tabla de leads
 *     de un vendedor: la señal neutra `inicioCompra` (decisión de Andres, 02/11/2026, opción B), y sus negaciones.
 *   · FLUJO: el JSON versionado en el n8n de mentira, con dobles de Google Sheets: qué turnos guardan y cuáles no (modo prueba, id vacío, puerta cerrada, número de otro país), las 48 h, los rangos y la credencial.
 * Mensajes por conversación: 0 (la rama del miniCRM no envía nada; se demuestra comparando la conversación con y sin planilla).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { Flujo, J } from '../../lib/flujo';
import { crearMundo, type Doble, type Mundo, type ResultadoTurno } from '../../lib/n8n-de-mentira';
import { doblesDelGuardado } from '../../lib/doble-guardado';
// @ts-expect-error módulo .mjs sin tipos
import { hallazgosCrm, inyectarMapa, urlEncabezados } from '../../../../Flujos/experimental/comun-sin-agente/construir-crm.mjs';
// @ts-expect-error el armador es un .mjs sin tipos
import { CREDENCIAL_CRM, NODOS_DE_CRM, TOPE_DE_NODOS, anfitrionPermitido, guardias } from '../../../../Flujos/experimental/rroca-ruben/construir.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CARPETA = join(AQUI, '../../../../Flujos/experimental/rroca-ruben');
const RAIZ = join(AQUI, '../../../..');
const leerFlujo = (a: string): Flujo => JSON.parse(readFileSync(join(CARPETA, a), 'utf8')) as Flujo;
const PRODUCCION = leerFlujo('rroca-ruben.json');
const PRUEBA = leerFlujo('rroca-ruben.prueba.json');
const MAPA = (JSON.parse(readFileSync(join(AQUI, '../../../scripts/datos/rroca-ruben/rroca-ruben.json'), 'utf8')) as J)['crm'] as J;
const leerMod = (r: string): string => readFileSync(join(RAIZ, 'Flujos', 'src', 'modulos', r), 'utf8');
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ------------------------------------------------------------------------------------------------ las dos piezas de código, tal como corren en n8n
// `rr.js` declara constantes y funciones que se cierran sobre otras del mismo archivo: se compila entero.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RR: any = compileFunction(`${readFileSync(join(CARPETA, 'src/lib/rr.js'), 'utf8')}\nreturn { rrProspectoCrm };`, [])();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M: any = compileFunction(`${inyectarMapa(leerMod('crm/crm.js'), MAPA)}\n${leerMod('crm/adaptador-senales.js')}\nreturn { crmDecidirFila, CRM_ADAPTADOR };`, [])();

const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);
const tel = (n: number): string => ['591', '00', String(n).padStart(6, '0')].join('');
const TEL = tel(1234);
const PID = tel(42);
const ANA = tel(11);
const REC = tel(31);
type Col = { letra: string; titulo: string };
/** Los títulos de la fila 3 en orden de columna, de A a T (la U no se lee). */
const TITULOS: string[] = (() => {
  const todas: Col[] = [...Object.values(MAPA['columnas'] as Record<string, Col>), ...Object.values(MAPA['equipo'] as Record<string, Col>)];
  return todas.filter((c) => c.letra <= 'T').sort((a, b) => a.letra.localeCompare(b.letra)).map((c) => c.titulo);
})();
const fila = (n: number, extra: J = {}): { json: J } => ({ json: Object.fromEntries([['row_number', n], ...TITULOS.map((t) => [t, ''])].map(([k, v]) => [k, extra[k as string] ?? v])) });
const ENCABEZADOS = [{ json: { values: [TITULOS] } as J }];
const IDS = [{ json: { row_number: 4, 'ID Lead': 'LEAD-1010' } }];

/** Un turno ya resuelto, con lo que `Armar mensajes` le pasa a `rrProspectoCrm`. */
const turno = (o: J = {}): J => ({ from: TEL, tipo: 'modelo', plan: {}, fichaAntes: {}, anuncio: false, avisoSalio: false, nombrePerfil: 'Cliente Ejemplo F', nuevoContacto: true, ahoraMs: AHORA, ...o });
const prospecto = (o: J = {}): J => RR.rrProspectoCrm(turno(o)) as J;
function decidir(p: J, existentes: Array<{ json: J }> = []): J {
  const salida = M.crmDecidirFila({ prospectos: [{ json: p }], busqueda: existentes, lecturaIds: IDS, encabezados: ENCABEZADOS, mapa: copia(MAPA), adaptador: M.CRM_ADAPTADOR, ahoraMs: AHORA }) as Array<{ json: J }>;
  return salida[0]!.json;
}
const celda = (r: J, campo: string): unknown => r[((MAPA['columnas'] as Record<string, Col>)[campo] as Col).titulo];

describe('unidades: tabla de leads de un vendedor (rrProspectoCrm + crmDecidirFila)', () => {
  it('QR de cobro emitido en este turno -> Caliente, Alta, «Compra: <producto>»', () => {
    const p = prospecto({ tipo: 'qr', plan: { tipo: 'qr', producto: 'pack' }, anuncio: true });
    expect((p['senales'] as J)['inicioCompra']).toBe(true);
    const r = decidir(p);
    expect(r['accionPlanilla']).toBe('agregar');
    expect(celda(r, 'clasificacion')).toBe('Caliente');
    expect(celda(r, 'calificacion')).toBe('Alta');
    expect(String(celda(r, 'quePidio'))).toContain('Compra: Pack Completo');   // el módulo antepone un apóstrofo a todo texto libre
    expect(celda(r, 'origen')).toBe('Campaña Meta Ads');
  });
  it('comprobante recibido (cotejado o no) -> Caliente; uno ilegible o por reintentar NO', () => {
    for (const resultado of ['cuadra', 'aproximado', 'monto_distinto', 'tardio', 'ya_cotejado', 'sin_cotejo']) {
      const p = prospecto({ tipo: 'comprobante', plan: { tipo: 'comprobante', resultado } });
      expect((p['senales'] as J)['inicioCompra'], resultado).toBe(true);
      expect(celda(decidir(p), 'clasificacion')).toBe('Caliente');
    }
    for (const resultado of ['reintentar', 'ilegible']) {
      const p = prospecto({ tipo: 'comprobante', plan: { tipo: 'comprobante', resultado } });
      expect((p['senales'] as J)['inicioCompra'], resultado).toBe(false);
      expect(celda(decidir(p), 'clasificacion')).toBe('Tibio');
    }
  });
  it('una ficha con un QR ya emitido o un comprobante recibido en turnos anteriores sigue siendo inicio de compra', () => {
    expect((prospecto({ fichaAntes: { pedidos: 1 }, nuevoContacto: false })['senales'] as J)['inicioCompra']).toBe(true);
    expect((prospecto({ fichaAntes: { comprobanteMs: AHORA - 1000 }, nuevoContacto: false })['senales'] as J)['inicioCompra']).toBe(true);
    expect((prospecto({ fichaAntes: { pedidos: 0, comprobanteMs: 0 }, nuevoContacto: false })['senales'] as J)['inicioCompra']).toBe(false);
  });
  it('quien compró o pagó y vuelve tras 48 h (contacto nuevo) NO es Caliente por la ficha vieja', () => {
    for (const fichaAntes of [{ pedidos: 1 }, { comprobanteMs: AHORA - 3 * 24 * 3600 * 1000 }, { pedidos: 2, comprobanteMs: 1 }]) {
      const p = prospecto({ fichaAntes, nuevoContacto: true });
      expect((p['senales'] as J)['inicioCompra'], JSON.stringify(fichaAntes)).toBe(false);
      expect(celda(decidir(p), 'clasificacion')).toBe('Tibio');
    }
  });
  it('un cobro SIMULADO (QR de demostración o comprobante simulado) no es inicio de compra', () => {
    const qr = prospecto({ tipo: 'qr', plan: { tipo: 'qr', producto: 'pack', simulado: true } });
    expect((qr['senales'] as J)['inicioCompra']).toBe(false);
    expect(celda(decidir(qr), 'clasificacion')).toBe('Tibio');
    const comp = prospecto({ tipo: 'comprobante', plan: { tipo: 'comprobante', resultado: 'simulado' } });
    expect((comp['senales'] as J)['inicioCompra']).toBe(false);
  });
  it('pidió hablar con Rubén (derivación) -> Caliente, «Pidió hablar con Rubén» solo si el aviso salió', () => {
    const plan = { tipo: 'derivar', clave: 'hablar_con_ruben', motivo: 'hablar_boton' };
    const sinAviso = prospecto({ tipo: 'derivar', plan });
    expect((sinAviso['senales'] as J)['pidioLlamada']).toBe(true);
    expect(sinAviso['derivacion']).toBeUndefined();
    const conAviso = prospecto({ tipo: 'derivar', plan, avisoSalio: true });
    expect(conAviso['derivacion']).toBe('Pidió hablar con Rubén');
    const r = decidir(conAviso);
    expect(celda(r, 'clasificacion')).toBe('Caliente');
    expect(String(celda(r, 'derivacion'))).toContain('Rubén');
  });
  it('otra consulta derivada a Rubén NO es Caliente por sí sola (Tibio) y la derivación dice «Consulta para Rubén»', () => {
    const p = prospecto({ tipo: 'derivar', plan: { tipo: 'derivar', clave: 'factura', motivo: 'consulta' }, avisoSalio: true });
    expect((p['senales'] as J)['pidioLlamada']).toBe(false);
    expect(p['derivacion']).toBe('Consulta para Rubén');
    expect(celda(decidir(p), 'clasificacion')).toBe('Tibio');
  });
  it('solo llegó por un anuncio -> Tibio, Media; solo escribió -> Tibio, «Chatbot WhatsApp IA»', () => {
    const a = decidir(prospecto({ anuncio: true }));
    expect(celda(a, 'clasificacion')).toBe('Tibio');
    expect(celda(a, 'calificacion')).toBe('Media');
    const b = decidir(prospecto());
    expect(celda(b, 'origen')).toBe('Chatbot WhatsApp IA');
    expect(celda(b, 'etapaInicial')).toBe('1. Nuevo Lead');
    expect(b['Estado Comercial']).toBe('Activo');
  });
  it('ver los precios o la información NO es Caliente (solo un hecho de compra lo es)', () => {
    for (const tipo of ['precio', 'precios', 'catalogo', 'info', 'saludo', 'modelo']) {
      const p = prospecto({ tipo, plan: { tipo } });
      expect((p['senales'] as J)['inicioCompra'], tipo).toBe(false);
      expect(celda(decidir(p), 'clasificacion'), tipo).toBe('Tibio');
    }
    expect(prospecto({ tipo: 'precios', plan: { tipo: 'precios' } })['quePidio']).toBe('Precios');
    expect(prospecto({ tipo: 'info', plan: { tipo: 'info' } })['quePidio']).toBe('Información');
  });
  it('no hay señales «Frío» ni «No es lead»: ningún turno las produce', () => {
    for (const t of ['no gracias', 'soy proveedor', 'no me interesa', 'cuánto cuesta y listo gracias']) {
      const p = prospecto({ tipo: 'modelo', plan: { textoCliente: t } });
      expect(Object.keys(p['senales'] as J)).not.toContain('noEsPaciente');
      expect(Object.keys(p['senales'] as J)).not.toContain('preguntoPrecioYCerro');
      expect(['Tibio', 'Caliente']).toContain(celda(decidir(p), 'clasificacion'));
    }
  });
  it('una fila que el equipo marcó «No es lead» no se pisa con una señal débil, y un QR emitido sí la cambia', () => {
    const marcada = (): Array<{ json: J }> => [fila(7, { 'Teléfono WhatsApp': TEL, 'Nombre y Apellido': 'Lead', 'Calificación IA': 'Descalificado', 'Clasificación': 'No es lead' })];
    const debil = decidir(prospecto({ nuevoContacto: false, anuncio: true }), marcada());
    expect(debil['Clasificación']).toBeUndefined();
    const fuerte = decidir(prospecto({ tipo: 'qr', plan: { tipo: 'qr', producto: 'libro' }, nuevoContacto: false }), marcada());
    expect(fuerte['accionPlanilla']).toBe('actualizar');
    expect(fuerte['Clasificación']).toBe('Caliente');
  });
  it('el nombre del perfil se limita a letras, espacios, apóstrofo y guion (máx. 60) y no pisa un nombre dado', () => {
    expect(prospecto({ nombrePerfil: '=HYPERLINK("http://x") Ana <b>Pérez</b> 😀' })['nombre']).toBe('HYPERLINKhttpx Ana bPérezb');
    expect(prospecto({ nombrePerfil: "María-José O'Brien" })['nombre']).toBe("María-José O'Brien");
    expect(String(prospecto({ nombrePerfil: 'A'.repeat(100) })['nombre']).length).toBeLessThanOrEqual(60);
    expect(String(prospecto({ nombrePerfil: '+591 70000 =1+1' })['nombre'])).not.toMatch(/[0-9=+]/);
    expect(prospecto()['nombreDePerfil']).toBe(true);
  });
  it('el texto libre del cliente jamás llega al prospecto ni a la fila', () => {
    const p = prospecto({ tipo: 'modelo', plan: { tipo: 'modelo', textoCliente: 'tengo una tienda de ropa, mi cuenta es 123456789' } });
    expect(JSON.stringify(p)).not.toMatch(/tienda|123456789/);
    expect(JSON.stringify(decidir(p))).not.toMatch(/tienda|123456789/);
    expect(p['diaPreferido']).toBeUndefined();
    expect(p['horarioPreferido']).toBeUndefined();
  });
  it('ningún valor es false, «No» ni un objeto', () => {
    const casos = [prospecto(), prospecto({ tipo: 'derivar', plan: { clave: 'hablar_con_ruben' }, avisoSalio: true }), prospecto({ tipo: 'qr', plan: { producto: 'ninguno' } }), prospecto({ anuncio: true })];
    for (const c of casos) {
      for (const v of Object.values(decidir(c))) {
        expect(v).not.toBe(false);
        expect(String(v)).not.toBe('false');
        expect(String(v)).not.toContain('[object Object]');
        expect(String(v)).not.toBe('No');
      }
    }
    expect(prospecto({ tipo: 'qr', plan: { producto: 'ninguno' } })['quePidio']).toBe('Compra');
  });
});

// ------------------------------------------------------------------------------------------------ el flujo
const ID_PLANILLA = 'PlanillaDePruebaDeRubenParaElMiniCrm01';
const CATALOGO = [
  { id: 'pack-completo', nombre: 'Pack Completo', precio: 60, activo: true },
  { id: 'libro-bonos', nombre: 'Libro + 4 bonos', precio: 32, activo: true },
  { id: 'closer-ventas', nombre: 'Prompt Closer', precio: 20, activo: true },
  { id: 'videos-ia', nombre: 'Videos con IA', precio: 25, activo: true },
];
let seq = 0;
const mTexto = (body: string): J => ({ type: 'text', text: { body } });
const mBoton = (id: string): J => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } });
const entrega = (msg: J, from: string): J => ({
  headers: { 'x-aab1-signature': 'v1=abc', 'x-aab1-timestamp': '1', 'x-aab1-delivery-id': `entrega-${++seq}`, 'x-aab1-attempt': '1' },
  body: { field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '59100000001', phone_number_id: PID },
    contacts: [{ profile: { name: 'Ana Pérez' }, wa_id: from }],
    messages: [{ from, id: `wamid.IN${++seq}`, timestamp: '1', ...msg }],
  } },
});
const geminiTexto = (t: string): J => ({ candidates: [{ content: { parts: [{ text: t }] } }] });

interface Planilla { dobles: Record<string, Doble>; escrituras: J[]; actualizaciones: J[]; lecturas: string[]; }
function planilla(o: { filas?: Array<{ json: J }>; ids?: Array<{ json: J }>; enc?: Array<{ json: J }> } = {}): Planilla {
  const p: Planilla = { dobles: {}, escrituras: [], actualizaciones: [], lecturas: [] };
  const lee = (nombre: string, datos: Array<{ json: J }>): Doble => (ll) => { p.lecturas.push(`${nombre}|${String((((ll.parametros['options'] as J)['dataLocationOnSheet'] as J)['values'] as J)['range'])}`); return datos.map((x) => x.json); };
  p.dobles['Buscar teléfono en planilla'] = lee('buscar', o.filas ?? []);
  p.dobles['Leer IDs de la planilla'] = lee('ids', o.ids ?? IDS);
  p.dobles['Leer encabezados de la planilla'] = (ll) => { p.lecturas.push(`enc|${decodeURIComponent(String(ll.parametros['url'])).replace(/^.*!(A\d+:[A-Z]+\d+)$/, '$1')}`); return (o.enc ?? ENCABEZADOS).map((x) => x.json); };
  p.dobles['Agregar fila'] = (ll) => { p.escrituras.push(ll.item); return {}; };
  p.dobles['Actualizar fila'] = (ll) => { p.actualizaciones.push(ll.item); return {}; };
  return p;
}
const BASE_CON_PLANILLA = { planillaProspectosId: ID_PLANILLA, planillaProspectosHoja: 'Leads_CRM' };

/** Un mundo mínimo: la consola operativa, Meta acepta todo, el modelo conversa, el servidor de cobros de mentira. */
function crear(o: { base?: J; dobles?: Record<string, Doble>; flujo?: Flujo; atencion?: J; panel?: { statusCode: number; body: J } } = {}): { mundo: Mundo } {
  let n = 0;
  const panel = o.panel ?? { statusCode: 200, body: {
    tenantId: 'rroca-ruben', estadoComercio: 'activo', datosDelNegocio: { nombreNegocio: 'Rubén Roca' }, operacion: { numeroRecepcion: REC, prefijosPermitidos: ['591'] }, voz: { nombreAsistente: '' },
    atencion: o.atencion ?? { estado: 'normal' }, catalogo: CATALOGO, anuncios: [], venta: { mediaIdQr: 'MEDIAQR100200' },
    cobroReal: { nombreCuenta: 'Titular Ejemplo', banco: 'Banco Ejemplo', cuentas: ['59100000077'], venceEl: '2027-12-31', moneda: 'BOB', montoFijo: null, fichaQr: 'ficha1' },
    cobro: { activo: true, moneda: 'BOB', qr: { url: 'https://us-east1-ejemplo.cloudfunctions.net/imagenDeCobro?f=ficha1', nombreCuenta: 'Titular Ejemplo', banco: 'Banco Ejemplo' }, regla: 2, pendiente: false, monto: null, pedido: null, enRevision: false, vencidoHaceMin: null },
  } };
  const enviar = (nodo: string): Doble => () => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.OUT${nodo.replace(/\W+/g, '')}${++n}` }] });
  const dobles: Record<string, Doble> = {
    ...doblesDelGuardado().dobles,
    'Verificar firma con el receptor': (ll) => ({ valido: true, deliveryId: ll.cuerpo?.['deliveryId'] }),
    'Traer configuración': () => panel,
    'Reportar mensaje (entrante)': () => ({ ok: true }),
    'Reportar mensaje (saliente)': () => ({ ok: true }),
    'Conversar con el modelo': geminiTexto('Qué buen punto. El libro te enseña paso a paso a usar la IA en tu negocio, sin ser experto. ¿A qué te dedicas?'),
    'Enviar aviso': () => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.AVISO${++n}` }] }),
    'Enviar a WhatsApp': enviar('Enviar a WhatsApp'),
    'Enviar respaldo': enviar('Enviar respaldo'),
    ...(o.dobles ?? {}),
  };
  const mundo = crearMundo({ flujo: o.flujo ?? PRODUCCION, dobles, ahoraMs: AHORA, configBase: { phoneNumberIdEsperado: PID, numeroRecepcion: REC, telefonosDePrueba: ANA, ...(o.base ?? {}) } });
  const rec = (mundo.sd as J);
  rec['rroca'] = { [REC]: { ultimoMs: AHORA - 5 * 60_000, turnos: 1 } };
  return { mundo };
}
const hablar = (w: { mundo: Mundo }, from: string, msg: J, tolerar = false): ResultadoTurno => w.mundo.turno(entrega(msg, from), tolerar ? { tolerarFallo: true } : {});
const corrioLaRama = (t: ResultadoTurno): boolean => t.ejecutados.has('Prospecto para la planilla') && t.ejecutados.has('Decidir fila de la planilla');
const prospectoDe = (t: ResultadoTurno): J | undefined => (t.porNodo['Prospecto para la planilla'] ?? [])[0];
/** La negación de verdad: «Armar mensajes» CORRIÓ y su salida dice `guardarPlanilla: false` (no basta con que la rama no corra: el flujo pudo caerse antes). */
const armoSinGuardar = (t: ResultadoTurno): void => {
  expect(t.ejecutados.has('Armar mensajes')).toBe(true);
  const salida = t.porNodo['Armar mensajes'] ?? [];
  expect(salida.length).toBeGreaterThan(0);
  for (const s of salida) expect(s['guardarPlanilla']).toBe(false);
};

describe('flujo: quién guarda y quién no', () => {
  it('una conversación normal (id y hoja) agrega UNA fila con el prospecto', () => {
    const pl = planilla();
    const w = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles });
    const t = hablar(w, ANA, mTexto('hola'));
    expect(corrioLaRama(t)).toBe(true);
    expect(pl.escrituras).toHaveLength(1);
    expect(pl.actualizaciones).toHaveLength(0);
    const f = pl.escrituras[0]!;
    expect(f['ID Lead']).toBe('LEAD-1011');
    expect(f['Clasificación']).toBe('Tibio');
    expect(f['Origen / Canal']).toBe('Chatbot WhatsApp IA');
    expect(String(f['Teléfono WhatsApp'])).toBe(`'${ANA}`);
  });
  it('el botón de un producto emite el QR y el prospecto sale Caliente con «Compra: …»', () => {
    const pl = planilla();
    const w = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles });
    hablar(w, ANA, mTexto('hola'));
    hablar(w, ANA, mTexto('tengo una tienda de ropa'));
    pl.escrituras.length = 0; pl.actualizaciones.length = 0;
    const t = hablar(w, ANA, mBoton('b_libro'));
    expect(prospectoDe(t)?.['quePidio']).toMatch(/^Compra/);
    expect((prospectoDe(t)?.['senales'] as J)['inicioCompra']).toBe(true);
  });
  it('las lecturas llegan hasta la T (nunca a la U) y la de los IDs solo a la A', () => {
    const pl = planilla();
    hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('hola'));
    expect(pl.lecturas).toContain('buscar|A3:T');
    expect(pl.lecturas).toContain('ids|A3:A');
    expect(pl.lecturas).toContain('enc|A3:T3');
    expect(pl.lecturas.some((l) => /:U|:V/.test(l))).toBe(false);
  });
  it('sin id de planilla (vacío, como en la variante de prueba) NO guarda y ni consulta Google', () => {
    const pl = planilla();
    const t = hablar(crear({ base: { planillaProspectosId: '' }, dobles: pl.dobles }), ANA, mTexto('hola'));
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.lecturas).toEqual([]);
    expect(pl.escrituras).toEqual([]);
  });
  it('un marcador REEMPLAZAR_* tampoco guarda (el id no es válido)', () => {
    const pl = planilla();
    const t = hablar(crear({ base: { planillaProspectosId: 'REEMPLAZAR_PLANILLA_PROSPECTOS_ID_RROCA_RUBEN' }, dobles: pl.dobles }), ANA, mTexto('hola'));
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.lecturas).toEqual([]);
  });
  it('la variante de PRUEBA lleva el id VACÍO (Config base) y la de producción un marcador', () => {
    const idDe = (f: Flujo): unknown => ((f.nodes.find((n) => n.name === 'Config base')!.parameters as J)['assignments'] as { assignments: Array<{ name: string; value: unknown }> }).assignments.find((a) => a.name === 'planillaProspectosId')!.value;
    expect(idDe(PRUEBA)).toBe('');
    expect(String(idDe(PRODUCCION))).toMatch(/^REEMPLAZAR_/);
  });
  it('un número de otro país no guarda', () => {
    const pl = planilla();
    const t = hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ['54', '9', '11', '55500001'].join(''), mTexto('hola'), true);
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
  it('el uso extendido (operador) no guarda', () => {
    const pl = planilla();
    const w = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, atencion: { estado: 'operador', mensajeFijo: 'Una persona del equipo va a continuar esta conversación.', respuestasEnVentana: 40 } });
    const t = hablar(w, ANA, mTexto('hola'));
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
  it('la pausa por persona (estado bloqueado: cero envío) no guarda', () => {
    const pl = planilla();
    const w = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, atencion: { estado: 'bloqueado' } });
    const t = hablar(w, ANA, mTexto('hola'), true);
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
  it('el comercio suspendido no guarda', () => {
    const pl = planilla();
    const w = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, panel: { statusCode: 409, body: { mensajeCortesia: 'En este momento no podemos atenderte por este medio. Gracias por escribirnos.' } } });
    const t = hablar(w, ANA, mTexto('hola'), true);
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
  // La variante de prueba (id vacío en el JSON) con el id forzado por `configBase`: SIN modo prueba escribe (gemelo positivo); CON modo prueba, no.
  const turnoDePrueba = (w: { mundo: Mundo }, modoPrueba: boolean): ResultadoTurno => w.mundo.turno({ headers: {}, body: {
    // La forma de «Entrada de prueba» (la de venta.test.ts): el valor de Meta va PLANO en el cuerpo, con `modoPrueba` al lado.
    ...(modoPrueba ? { modoPrueba: true, telefonoDePrueba: ANA, enviarDeVerdad: false } : {}),
    messaging_product: 'whatsapp', metadata: { phone_number_id: PID }, contacts: [{ profile: { name: 'Ana' }, wa_id: ANA }], messages: [{ from: ANA, id: `wamid.P${++seq}`, timestamp: '1', type: 'text', text: { body: 'hola' } }],
  } }, { tolerarFallo: true });
  it('gemelo positivo: la variante de prueba con id forzado y SIN modo prueba sí corre la rama', () => {
    const pl = planilla();
    const t = turnoDePrueba(crear({ flujo: PRUEBA, base: { ...BASE_CON_PLANILLA }, dobles: pl.dobles }), false);
    expect(t.ejecutados.has('Armar mensajes')).toBe(true);
    expect(corrioLaRama(t)).toBe(true);
  });
  it('el modo prueba (entrada de prueba) no guarda', () => {
    const pl = planilla();
    const t = turnoDePrueba(crear({ flujo: PRUEBA, base: { ...BASE_CON_PLANILLA }, dobles: pl.dobles }), true);
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
});

describe('flujo: 48 horas y la fila más reciente', () => {
  const previa = (n: number, extra: J = {}): { json: J } => fila(n, { 'Teléfono WhatsApp': ANA, 'Nombre y Apellido': 'Ana', ...extra });
  it('con la ficha VIGENTE (menos de 48 h) el contacto no es nuevo y se ACTUALIZA la fila más reciente', () => {
    const pl = planilla({ filas: [previa(5, { 'Clasificación': 'Tibio' }), previa(9, { 'Clasificación': 'Tibio' })] });
    const w = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles });
    hablar(w, ANA, mTexto('hola'));
    pl.escrituras.length = 0; pl.actualizaciones.length = 0;
    w.mundo.avanzar(60);
    const t = hablar(w, ANA, mTexto('tengo una tienda de ropa'));
    expect(prospectoDe(t)?.['nuevoContacto']).toBe(false);
    expect(pl.escrituras).toHaveLength(0);
    expect(pl.actualizaciones).toHaveLength(1);
    expect(pl.actualizaciones[0]!['row_number']).toBe(9 + 2);
  });
  it('con 48 h vencidas el contacto es nuevo y se AGREGA una fila (con el ID siguiente)', () => {
    const pl = planilla({ filas: [previa(5, { 'Clasificación': 'Tibio' })] });
    const w = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles });
    hablar(w, ANA, mTexto('hola'));
    pl.escrituras.length = 0; pl.actualizaciones.length = 0;
    w.mundo.avanzar(49 * 60);
    const t = hablar(w, ANA, mTexto('hola de nuevo'));
    expect(prospectoDe(t)?.['nuevoContacto']).toBe(true);
    expect(pl.escrituras).toHaveLength(1);
    expect(pl.actualizaciones).toHaveLength(0);
    expect(pl.escrituras[0]!['ID Lead']).toBe('LEAD-1011');
  });
  it('el primer contacto de un teléfono también es nuevo', () => {
    const pl = planilla();
    const t = hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('hola'));
    expect(prospectoDe(t)?.['nuevoContacto']).toBe(true);
  });
});

describe('flujo: lo que se lee mal NO escribe', () => {
  it('encabezados distintos (la fila 3 de la hoja viva no coincide) -> no agrega', () => {
    const pl = planilla({ enc: [{ json: { values: [['ID Lead', 'Otra cosa']] } as J }] });
    const t = hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('hola'));
    expect(corrioLaRama(t)).toBe(true);
    expect(pl.escrituras).toEqual([]);
    expect(String((t.porNodo['Decidir fila de la planilla'] ?? [])[0]?.['veredictoPlanilla'])).toMatch(/^encabezados_distintos/);
  });
  it('la excepción de anfitrión es solo para ese nodo y esa URL exacta', () => {
    const ok = urlEncabezados('A3:T3');
    expect(anfitrionPermitido(ok, 'Leer encabezados de la planilla')).toBe(true);
    expect(anfitrionPermitido(ok, 'Enviar a WhatsApp')).toBe(false);
    expect(anfitrionPermitido(ok.replace('sheets.googleapis.com', 'example.com'), 'Leer encabezados de la planilla')).toBe(false);
    expect(anfitrionPermitido(ok.replace('A3:T3', 'A3:T3&x=1'), 'Leer encabezados de la planilla')).toBe(false);
    expect(anfitrionPermitido(ok.replace('A3:T3', "A3:T3') + 'x"), 'Leer encabezados de la planilla')).toBe(false);
  });
  it('encabezados completos con la primera fila de datos VACÍA o corta: SÍ agrega (la comprobación lee solo la fila 3)', () => {
    const pl = planilla({ enc: [{ json: { values: [TITULOS] } as J }] });
    const t = hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('hola'));
    expect(pl.escrituras.length).toBe(1);
    expect(String((t.porNodo['Decidir fila de la planilla'] ?? [])[0]?.['accionPlanilla'])).toBe('agregar');
  });
  it.each([
    ['la fila 3 vacía (Google no devuelve values)', [{ json: {} as J }]],
    ['la fila 3 con celdas vacías', [{ json: { values: [['', '']] } as J }]],
    ['un título de menos (falta la T)', [{ json: { values: [TITULOS.slice(0, -1)] } as J }]],
    ['un título renombrado en la mitad', [{ json: { values: [TITULOS.map((x, i) => (i === 6 ? 'Otro' : x))] } as J }]],
    ['una columna de más antes de la U', [{ json: { values: [[...TITULOS, 'Sobrante']] } as J }]],
    ['la lectura falló (error de Google)', [{ json: { error: { message: 'PERMISSION_DENIED' } } as J }]],
  ])('NO agrega con %s', (_nombre, enc) => {
    const pl = planilla({ enc: enc as Array<{ json: J }> });
    const t = hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('hola'));
    expect(pl.escrituras).toEqual([]);
    expect(String((t.porNodo['Decidir fila de la planilla'] ?? [])[0]?.['accionPlanilla'])).toBe('nada');
  });
  it('si Google falla (permiso denegado) no agrega y la conversación sigue igual', () => {
    const pl = planilla();
    pl.dobles['Buscar teléfono en planilla'] = { error: { message: 'PERMISSION_DENIED', code: 403 } };
    const t = hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('hola'));
    expect(pl.escrituras).toEqual([]);
    expect(t.mensajes.length).toBeGreaterThan(0);
  });
});

describe('flujo: 0 mensajes agregados', () => {
  const conversacion = (base: J): string[] => {
    const pl = planilla();
    const w = crear({ base, dobles: pl.dobles });
    const salida: string[] = [];
    for (const q of ['hola', 'tengo una tienda de ropa', 'cuánto cuesta?', 'gracias']) {
      const t = hablar(w, ANA, mTexto(q), true);
      salida.push(...t.mensajes.map((e) => e.cuerpo), `avisos:${t.avisos.length}`);
    }
    return salida;
  };
  it('la misma conversación con planilla y sin planilla manda exactamente lo mismo', () => {
    expect(conversacion(BASE_CON_PLANILLA)).toEqual(conversacion({ planillaProspectosId: '' }));
  });
  it('la rama no tiene ningún nodo que envíe (solo Google Sheets, el código y el interruptor)', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      const rama = f.nodes.filter((n) => (NODOS_DE_CRM as string[]).includes(n.name));
      expect(rama).toHaveLength(8);
      for (const n of rama) expect(['n8n-nodes-base.code', 'n8n-nodes-base.googleSheets', 'n8n-nodes-base.switch', 'n8n-nodes-base.httpRequest']).toContain(n.type);
      const http = rama.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
      expect(http.map((n) => n.name)).toEqual(['Leer encabezados de la planilla']);
      expect((http[0]!.parameters as J)['method']).toBe('GET');
      expect(String((http[0]!.parameters as J)['url'])).toMatch(/^=\{\{ 'https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\//);
    }
  });
});

describe('flujo: la rama, sus rangos y su credencial se NIEGAN con mutaciones', () => {
  const g = (v: 'produccion' | 'prueba', f: Flujo): string[] => guardias(v, f, MAPA) as string[];
  const nodo = (f: Flujo, n: string) => f.nodes.find((x) => x.name === n)!;
  const rango = (f: Flujo, n: string, r: string): void => { (((((nodo(f, n).parameters as J)['options'] as J)['dataLocationOnSheet'] as J)['values']) as J)['range'] = r; };
  it('lo versionado no tiene hallazgos (ni de guardias ni de hallazgosCrm)', () => {
    expect(g('produccion', PRODUCCION)).toEqual([]);
    expect(g('prueba', PRUEBA)).toEqual([]);
    expect(hallazgosCrm(PRODUCCION, MAPA)).toEqual([]);
    expect(hallazgosCrm(PRUEBA, MAPA)).toEqual([]);
  });
  for (const r of ['A3:U', 'A3:V', 'A3:U4']) {
    it(`un rango de lectura ${r} (llega al Diagnóstico del equipo) es hallazgo`, () => {
      const f = copia(PRODUCCION); rango(f, 'Buscar teléfono en planilla', r);
      expect(hallazgosCrm(f, MAPA).join(' ')).toMatch(/diagnostico del equipo/);
      expect(g('produccion', f).join(' ')).toMatch(/miniCRM/);
    });
  }
  it('la credencial de otro tenant en un nodo de Google es hallazgo', () => {
    const f = copia(PRODUCCION);
    (nodo(f, 'Agregar fila').credentials as J)['googleApi'] = { id: '', name: CREDENCIAL_CRM('otro-tenant') };
    expect(g('produccion', f).join(' ')).toMatch(/credencial de Google que no es la de este negocio/);
  });
  it('la credencial de Rubén es la de su tenant', () => {
    expect(CREDENCIAL_CRM('rroca-ruben')).toBe('Google Sheets miniCRM (crm-rroca-ruben)');
    for (const n of PRODUCCION.nodes.filter((x) => x.type === 'n8n-nodes-base.googleSheets')) expect(((n.credentials as J)['googleApi'] as J)['name']).toBe('Google Sheets miniCRM (crm-rroca-ruben)');
  });
  it('retención de ejecuciones distinta de none es hallazgo', () => {
    const f = copia(PRODUCCION); (f as unknown as { settings: J }).settings['saveDataSuccessExecution'] = 'all';
    expect(g('produccion', f).join(' ')).toMatch(/retencion/);
  });
  it('sin un nodo de la rama, o desconectada de «Armar mensajes», es hallazgo', () => {
    const a = copia(PRODUCCION); a.nodes = a.nodes.filter((n) => n.name !== 'Leer IDs de la planilla');
    expect(g('produccion', a).join(' ')).toMatch(/falta el nodo «Leer IDs de la planilla»/);
    const b = copia(PRODUCCION); (b.connections as J)['Armar mensajes'] = { main: [[{ node: 'Resumen del turno', type: 'main', index: 0 }]] };
    expect(g('produccion', b).join(' ')).toMatch(/no está conectado/);
  });
  it('«Prospecto para la planilla» arriba de «Armar mensajes» o debajo de «Resumen del turno» es hallazgo (el resumen es la última rama)', () => {
    const f = copia(PRODUCCION); nodo(f, 'Prospecto para la planilla').position = [5480, 900];
    expect(g('produccion', f).join(' ')).toMatch(/tiene que ir debajo de «Armar mensajes» y encima de «Resumen del turno»/);
  });
  it('los datos sin el mapa `crm` son hallazgo', () => {
    expect((guardias('produccion', PRODUCCION, {}) as string[]).join(' ')).toMatch(/faltan los datos `crm`/);
  });
  it('conteo de nodos: 63 en producción (el tope sube de 55 a 63, aprobado por Andres el 02/11/2026) y 58 en la prueba', () => {
    expect(PRODUCCION.nodes.length).toBe(63);
    expect(PRUEBA.nodes.length).toBe(58);
    expect(TOPE_DE_NODOS).toBe(63);
  });
});
