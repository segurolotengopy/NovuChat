/**
 * EL miniCRM EN EL FLUJO DE RUBEN (módulo `crm`, F4 del 02/11/2026). Dos capas:
 *   · UNIDADES: `rrProspectoCrm` (la función pura de `rr.js` que arma el prospecto desde el turno, con vocabulario cerrado) y `crmDecidirFila` (el módulo, con el adaptador de señales) sobre la tabla de leads
 *     de un vendedor: la señal neutra `inicioCompra` (decisión de Andres, 02/11/2026, opción B, la misma de Rubén), y sus negaciones.
 *   · FLUJO: el JSON versionado en el n8n de mentira, con dobles de Google Sheets: qué turnos guardan y cuáles no (modo prueba, id vacío, puerta cerrada, protección, número de otro país), las 48 h, los rangos y la credencial.
 * Mensajes por conversación: 0 (la rama del miniCRM no envía nada; se demuestra comparando la conversación con y sin planilla).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileFunction } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { Flujo, J } from '../../lib/flujo';
import type { Doble, Mundo, ResultadoTurno } from '../../lib/n8n-de-mentira';
// @ts-expect-error módulo .mjs sin tipos
import { hallazgosCrm, inyectarMapa, urlEncabezados } from '../../../../Flujos/experimental/comun-sin-agente/construir-crm.mjs';
// @ts-expect-error el armador es un .mjs sin tipos
import { CREDENCIAL_CRM, NODOS_DE_CRM, TOPE_DE_NODOS, anfitrionPermitido, guardias } from '../../../../Flujos/experimental/rroca-ruben/construir.mjs';
import { ANA, CARPETA, COMPROBANTE, PRODUCCION, PRUEBA, SUSPENDIDO, crear as crearBase, entrega, hablar, mBoton, mImagen, mTexto, panelConQr, panelOk, valorMeta, type Opciones } from './mundo';
import { respuestaDeIngesta } from '../../modulos/crm/ingesta-conversacion';

const RAIZ = join(CARPETA, '..', '..', '..');
const leerMod = (r: string): string => readFileSync(join(RAIZ, 'Flujos', 'src', 'modulos', r), 'utf8');
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const MAPA = (JSON.parse(readFileSync(join(RAIZ, 'admin/scripts/datos/rroca-ruben/rroca-ruben.json'), 'utf8')) as J)['crm'] as J;

// ------------------------------------------------------------------------------------------------ las dos piezas de código, tal como corren en n8n
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RR: any = compileFunction(`${readFileSync(join(CARPETA, 'src/lib/rr.js'), 'utf8')}\nreturn { rrProspectoCrm };`, [])();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M: any = compileFunction(`${inyectarMapa(leerMod('crm/crm.js'), MAPA)}\n${leerMod('crm/adaptador-senales.js')}\nreturn { crmDecidirFila, CRM_ADAPTADOR };`, [])();

const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);
const TEL = ['591', '00', '001234'].join('');
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
    expect(String(celda(r, 'quePidio'))).toContain('Compra: Pack completo');   // el módulo antepone un apóstrofo a todo texto libre
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
  it('una ficha VIGENTE con un QR ya emitido o un comprobante recibido sigue siendo inicio de compra', () => {
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
    const plan = { tipo: 'derivar', clave: 'hablar_con_ruben', motivo: 'consulta' };
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
    for (const t of ['no gracias', 'soy proveedor', 'no me interesa']) {
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
  it('el nombre del perfil se limita a letras, espacios, apóstrofo y guion (máx. 60)', () => {
    expect(prospecto({ nombrePerfil: '=HYPERLINK("http://x") Ana <b>Pérez</b> 😀' })['nombre']).toBe('HYPERLINKhttpx Ana bPérezb');
    expect(prospecto({ nombrePerfil: "María-José O'Brien" })['nombre']).toBe("María-José O'Brien");
    expect(String(prospecto({ nombrePerfil: 'A'.repeat(100) })['nombre']).length).toBeLessThanOrEqual(60);
    expect(String(prospecto({ nombrePerfil: '+591 70000 =1+1' })['nombre'])).not.toMatch(/[0-9=+]/);
    expect(prospecto()['nombreDePerfil']).toBe(true);
  });
  it('el texto libre del cliente jamás llega al prospecto ni a la fila', () => {
    const p = prospecto({ tipo: 'modelo', plan: { tipo: 'modelo', textoCliente: 'mi pareja y yo nos estamos separando, mi cuenta es 123456789' } });
    expect(JSON.stringify(p)).not.toMatch(/separando|123456789/);
    expect(JSON.stringify(decidir(p))).not.toMatch(/separando|123456789/);
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
/** El mundo de Rubén con los dobles de Google Sheets montados encima. */
function crear(o: Opciones & { dobles?: Record<string, Doble> } = {}): Mundo {
  const { dobles, ...resto } = o;
  const m = crearBase(resto);
  for (const [k, v] of Object.entries(dobles ?? {})) m.dobles[k] = v;
  return m;
}
const corrioLaRama = (t: ResultadoTurno): boolean => t.ejecutados.has('Prospecto para la planilla') && t.ejecutados.has('Decidir fila de la planilla');
const prospectoDe = (t: ResultadoTurno): J | undefined => (t.porNodo['Prospecto para la planilla'] ?? [])[0];
/** La negación de verdad: «Armar mensajes» CORRIÓ y su salida dice `guardarPlanilla: false` (no basta con que la rama no corra: el flujo pudo caerse antes). */
const armoSinGuardar = (t: ResultadoTurno): void => {
  expect(t.ejecutados.has('Armar mensajes')).toBe(true);
  const salida = t.porNodo['Armar mensajes'] ?? [];
  expect(salida.length).toBeGreaterThan(0);
  for (const s of salida) expect(s['guardarPlanilla']).toBe(false);
};

describe('la planilla NUNCA tumba la atención: si calcular el prospecto lanza, el turno responde y no se escribe en la hoja', () => {
  const CIERRE = '} catch (e) { prospectoPlanilla = null; }';
  const conFalla = (protegido: boolean): Flujo => {
    const f = structuredClone(PRODUCCION) as Flujo;
    const n = f.nodes.find((x) => x.name === 'Armar mensajes')!;
    const js = String((n.parameters as J)['jsCode']);
    expect(js.includes(CIERRE)).toBe(true);
    // La declaración de más abajo pisa a la de la biblioteca (las declaraciones se elevan; gana la última): el cálculo del prospecto lanza.
    (n.parameters as J)['jsCode'] = `${protegido ? js : js.replace(CIERRE, '} finally { }')}\nfunction rrProspectoCrm() { throw new Error('prospecto inesperado'); }`;
    return f;
  };
  it('PROTEGIDO: el mensaje al cliente sale, no se escribe en Sheets y la rama de la planilla no corre', () => {
    const pl = planilla();
    const t = hablar(crear({ flujo: conFalla(true), base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('hola'));
    expect(t.mensajes.length).toBeGreaterThan(0);
    expect(pl.escrituras).toEqual([]);
    expect(pl.actualizaciones).toEqual([]);
    expect(corrioLaRama(t)).toBe(false);
  });
  it('MUTACIÓN: sin el try/catch, el mismo fallo tumba el turno (el cliente no recibe respuesta): la prueba de arriba sí detecta la protección', () => {
    const pl = planilla();
    let t: ReturnType<typeof hablar> | null = null;
    let lanzo = false;
    try { t = hablar(crear({ flujo: conFalla(false), base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('hola')); } catch { lanzo = true; }
    expect(lanzo || t!.mensajes.length === 0).toBe(true);
  });
});

describe('flujo: quién guarda y quién no', () => {
  it('una conversación normal (id y hoja) agrega UNA fila con el prospecto', () => {
    const pl = planilla();
    const t = hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('hola'));
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
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles });
    hablar(m, ANA, mTexto('hola'));
    hablar(m, ANA, mTexto('me cuesta dormir por las noches'));
    pl.escrituras.length = 0; pl.actualizaciones.length = 0;
    const t = hablar(m, ANA, mBoton('b_libro'));
    expect(prospectoDe(t)?.['quePidio']).toMatch(/^Compra/);
    expect((prospectoDe(t)?.['senales'] as J)['inicioCompra']).toBe(true);
    expect(pl.escrituras).toHaveLength(1);   // y lo que se ESCRIBE dice Caliente
    expect(pl.escrituras[0]!['Clasificación']).toBe('Caliente');
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
    const t = hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ['54', '9', '11', '55500001'].join(''), mTexto('hola'), { toleraFallo: true });
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
  it('la protección ante una crisis (riesgo) no guarda, ni ese turno ni los siguientes', () => {
    const pl = planilla();
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles });
    const t = hablar(m, ANA, mTexto('ya no quiero vivir'), { toleraFallo: true });
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    const t2 = hablar(m, ANA, mTexto('hola otra vez'), { toleraFallo: true });
    armoSinGuardar(t2);
    expect(corrioLaRama(t2)).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
  describe('el comprobante no se salta la protección (en ese turno «Decidir turno» no mira el riesgo; la planilla sí)', () => {
    const conCobroAbierto = (pl: Planilla): Mundo => crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, panel: panelConQr(), medio: { clasificacion: { ...COMPROBANTE } } });
    it('control: un comprobante normal con el cobro abierto SÍ guarda («Comprobante de pago», Caliente)', () => {
      const pl = planilla();
      const t = hablar(conCobroAbierto(pl), ANA, mImagen());
      expect(corrioLaRama(t)).toBe(true);
      expect(prospectoDe(t)?.['quePidio']).toBe('Comprobante de pago');
      expect(pl.escrituras).toHaveLength(1);
      expect(pl.escrituras[0]!['Clasificación']).toBe('Caliente');
    });
    it('con la protección ya activa en la ficha, un comprobante posterior NO guarda (lo único que lo impide es `fichaAntes.riesgo`)', () => {
      const pl = planilla();
      const m = conCobroAbierto(pl);
      armoSinGuardar(hablar(m, ANA, mTexto('ya no quiero vivir'), { toleraFallo: true }));
      const t = hablar(m, ANA, mImagen(), { toleraFallo: true });
      expect(String((t.porNodo['Decidir turno'] ?? [])[0] && ((t.porNodo['Decidir turno']![0]!['plan'] as J)['tipo']))).toBe('comprobante');   // el riesgo no cambió el plan: lo corta solo la barrera de la planilla
      armoSinGuardar(t);
      expect(corrioLaRama(t)).toBe(false);
      expect(pl.escrituras).toEqual([]);
    });
    it('un comprobante cuyo pie de foto habla de una crisis NO guarda, aunque sea el primer turno', () => {
      const pl = planilla();
      const t = hablar(conCobroAbierto(pl), ANA, mImagen({ caption: 'ya no quiero vivir' }), { toleraFallo: true });
      armoSinGuardar(t);
      expect(corrioLaRama(t)).toBe(false);
      expect(pl.escrituras).toEqual([]);
    });
  });
  it('un pedido de baja (no me escribas más) no guarda', () => {
    const pl = planilla();
    const t = hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('no me escribas más'), { toleraFallo: true });
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
  it('el uso extendido (operador) no guarda', () => {
    const pl = planilla();
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, ingesta: { ok: true, atencion: { estado: 'operador', mensajeFijo: 'Una persona del equipo va a continuar esta conversación.', respuestasEnVentana: 55 } } });
    const t = hablar(m, ANA, mTexto('hola'));
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
  it('la pausa por persona (estado bloqueado: cero envío) no guarda', () => {
    const pl = planilla();
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, ingesta: { ok: true, atencion: { estado: 'bloqueado', respuestasEnVentana: 30 } } });
    const t = hablar(m, ANA, mTexto('hola'), { toleraFallo: true });
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
  it('el comercio suspendido no guarda', () => {
    const pl = planilla();
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, panel: { statusCode: 409, body: { mensajeCortesia: SUSPENDIDO } } });
    const t = hablar(m, ANA, mTexto('hola'), { toleraFallo: true });
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
  // La variante de prueba (id vacío en el JSON) con el id forzado por `configBase`: con modo prueba no escribe, y «Armar mensajes» sí corrió (la negación es de verdad).
  const turnoDePrueba = (m: Mundo): ResultadoTurno => m.turno({ headers: {}, body: { modoPrueba: true, telefonoDePrueba: ANA, enviarDeVerdad: false, ...valorMeta(mTexto('hola'), ANA) } }, { tolerarFallo: true });
  // (El gemelo positivo es la primera prueba de este bloque, con el JSON de producción y el mismo id: la entrada de prueba de Rubén solo responde con `modoPrueba`.)
  it('el modo prueba (entrada de prueba) no guarda', () => {
    const pl = planilla();
    const t = turnoDePrueba(crear({ flujo: PRUEBA, base: { ...BASE_CON_PLANILLA }, dobles: pl.dobles }));
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
});

describe('flujo: una fila por conversación (24 h fijas) y la fila más reciente', () => {
  const previa = (n: number, extra: J = {}): { json: J } => fila(n, { 'Teléfono WhatsApp': ANA, 'Nombre y Apellido': 'Ana', ...extra });
  const lp = (ms: number): string => new Date(ms - 4 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
  // El contrato de la ingesta (helper único): `atencion.conversacionDesde` y `conversacionNueva`. Una fila es de la conversación si su ventana cierra 24 h después del ancla.
  const conAncla = (anclaMs: number, nueva = false): J => respuestaDeIngesta({ desdeMs: anclaMs, nueva });
  const deConv = (desdeMs: number): J => ({ 'Se cierra la ventana de 24 h': lp(desdeMs + 24 * 3600_000) });
  it('NIEGA: un segundo mensaje DENTRO de la ventana no crea fila: se ACTUALIZA la más reciente', () => {
    const pl = planilla({ filas: [previa(5, { 'Clasificación': 'Tibio', ...deConv(AHORA - 3600_000) }), previa(9, { 'Clasificación': 'Tibio', ...deConv(AHORA - 1800_000) })] });
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, ingesta: conAncla(AHORA - 3600_000) });
    hablar(m, ANA, mTexto('hola'));
    pl.escrituras.length = 0; pl.actualizaciones.length = 0;
    m.avanzar(60);
    const t = hablar(m, ANA, mTexto('me cuesta dormir por las noches'));
    expect(prospectoDe(t)?.['conversacionDesdeMs']).toBe(AHORA - 3600_000);
    expect(pl.escrituras).toHaveLength(0);
    expect(pl.actualizaciones).toHaveLength(1);
    expect(pl.actualizaciones[0]!['row_number']).toBe(9 + 2);   // la más reciente (fila 9 de la lectura -> fila 11 en la hoja: el desfase de los encabezados)
  });
  it('NIEGA: a las 23 h 59 del ancla NO crea fila', () => {
    const ancla = AHORA - (24 * 60 - 1) * 60_000;
    const pl = planilla({ filas: [previa(5, { 'Clasificación': 'Tibio', ...deConv(ancla) })] });
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, ingesta: conAncla(ancla) });
    hablar(m, ANA, mTexto('hola'));
    expect(pl.escrituras).toHaveLength(0);
  });
  it('a las 24 h exactas del ancla anterior la conversación es otra y se AGREGA una fila (con el ID siguiente)', () => {
    const pl = planilla({ filas: [previa(5, { 'Clasificación': 'Tibio', ...deConv(AHORA - 24 * 3600_000) })] });
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, ingesta: conAncla(AHORA) });
    const t = hablar(m, ANA, mTexto('hola de nuevo'));
    expect(prospectoDe(t)?.['conversacionDesdeMs']).toBe(AHORA);
    expect(pl.escrituras).toHaveLength(1);
    expect(pl.actualizaciones).toHaveLength(0);
    expect(pl.escrituras[0]!['ID Lead']).toBe('LEAD-1011');
  });
  it('NIEGA: con la ingesta caída (sin ancla) se actualiza la más reciente y NO se crea', () => {
    const pl = planilla({ filas: [previa(5, { 'Clasificación': 'Tibio', ...deConv(AHORA - 72 * 3600_000) })] });
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles });
    const t = hablar(m, ANA, mTexto('me cuesta dormir por las noches'));
    expect(prospectoDe(t)?.['conversacionDesdeMs']).toBeNull();
    expect(pl.escrituras).toHaveLength(0);
  });
  it('NIEGA: `nuevoContacto` verdadero con la ventana vigente NO crea fila (regresión de la regla de 48 h)', () => {
    const pl = planilla({ filas: [previa(5, { 'Clasificación': 'Tibio', ...deConv(AHORA - 1800_000) })] });
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, ingesta: conAncla(AHORA - 3600_000) });
    const t = hablar(m, ANA, mTexto('hola'));
    expect(prospectoDe(t)?.['nuevoContacto']).toBe(true);
    expect(pl.escrituras).toHaveLength(0);
  });
  it('el primer contacto de un teléfono también crea la fila', () => {
    const pl = planilla();
    hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, ingesta: conAncla(AHORA) }), ANA, mTexto('hola'));
    expect(pl.escrituras).toHaveLength(1);
  });
});

describe('flujo: la fila MÍNIMA NEUTRA cuando el contenido se filtra (protección, comprobante, modo prueba, otro país)', () => {
  const LP = (ms: number): string => new Date(ms - 4 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
  const PERMITIDAS = ['accionPlanilla', 'veredictoPlanilla', 'ID Lead', 'Fecha Registro', 'Teléfono WhatsApp', 'Última interacción', 'Se cierra la ventana de 24 h', 'Estado Comercial'];
  const apertura = (): J => respuestaDeIngesta({ desdeMs: AHORA, nueva: true });
  const despues = (): J => respuestaDeIngesta({ desdeMs: AHORA, nueva: false });
  /** Exactamente 1 fila, solo las claves permitidas, Etapa/Origen/clasificación vacíos, Estado «Sin seguimiento», y NADA del contenido ni del nombre de perfil ni del plan. */
  const unaFilaNeutra = (pl: Planilla, ts: ResultadoTurno[], contenido: RegExp, telefono: string): void => {
    expect(pl.escrituras).toHaveLength(1);
    const f = pl.escrituras[0]!;
    expect(Object.keys(f).filter((k) => !PERMITIDAS.includes(k) && f[k] !== '' && f[k] !== undefined)).toEqual([]);
    for (const k of ['Etapa Funnel', 'Origen / Canal', 'Clasificación', 'Nombre y Apellido', 'Calificación IA', 'Resumen Chatbot IA']) expect([undefined, ''], k).toContain(f[k]);
    expect(f['Estado Comercial']).toBe('Sin seguimiento');
    expect(String(f['Teléfono WhatsApp'])).toBe("'" + telefono);
    const todo = JSON.stringify([f, ...ts.flatMap((t) => [t.porNodo['Prospecto para la planilla'] ?? [], t.porNodo['Decidir fila de la planilla'] ?? []])]);
    expect(todo).not.toMatch(contenido);
    expect(todo).not.toMatch(/Cliente Ejemplo|nombrePerfil|"plan"|riesgo/);
  };
  it('protección: la apertura crea exactamente 1 fila neutra y los turnos siguientes no crean otra', () => {
    const pl = planilla();
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, ingesta: apertura() });
    const t1 = hablar(m, ANA, mTexto('ya no quiero vivir'), { toleraFallo: true });
    armoSinGuardar(t1);
    m.avanzar(10);   // pasan 10 min: ya no es la ráfaga de la apertura
    m.dobles['Reportar mensaje (entrante)'] = () => despues();
    const t2 = hablar(m, ANA, mTexto('hola otra vez'), { toleraFallo: true });
    armoSinGuardar(t2);
    unaFilaNeutra(pl, [t1, t2], /vivir|hola otra vez/, ANA);
    expect(pl.actualizaciones).toEqual([]);
  });
  it('protección con comprobante: la imagen y su pie de foto no agregan fila ni texto', () => {
    const pl = planilla();
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, panel: panelConQr(), medio: { clasificacion: { ...COMPROBANTE } }, ingesta: apertura() });
    const t1 = hablar(m, ANA, mTexto('ya no quiero vivir'), { toleraFallo: true });
    m.avanzar(10);   // pasan 10 min: ya no es la ráfaga de la apertura
    m.dobles['Reportar mensaje (entrante)'] = () => despues();
    const t2 = hablar(m, ANA, mImagen({ caption: 'ya no quiero vivir' }), { toleraFallo: true });
    armoSinGuardar(t2);
    unaFilaNeutra(pl, [t1, t2], /vivir|Comprobante/, ANA);
  });
  it('otro país: el número fuera del país crea 1 fila neutra en la apertura y nada más', () => {
    const pl = planilla();
    const otro = ['54', '9', '11', '55500001'].join('');
    const t = hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, ingesta: apertura() }), otro, mTexto('hola'), { toleraFallo: true });
    armoSinGuardar(t);
    unaFilaNeutra(pl, [t], /hola/, otro);
  });
  it('modo prueba: la entrada de prueba no reporta a la ingesta (no hay ancla de conversación), así que no escribe ni la fila mínima', () => {
    const pl = planilla();
    const t = m_prueba(crear({ flujo: PRUEBA, base: { ...BASE_CON_PLANILLA }, dobles: pl.dobles, ingesta: apertura() }));
    armoSinGuardar(t);
    expect(t.ejecutados.has('Reportar mensaje (entrante)')).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
  it('NIEGA: sin que este mensaje abra la conversación (`conversacionNueva` falso) o sin ancla, la protección no escribe nada', () => {
    for (const ingesta of [respuestaDeIngesta({ desdeMs: AHORA - 10 * 60_000, nueva: false }), { ok: true }, respuestaDeIngesta({ desdeMs: null, nueva: true })]) {
      const pl = planilla();
      const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, ingesta });
      armoSinGuardar(hablar(m, ANA, mTexto('ya no quiero vivir'), { toleraFallo: true }));
      expect(pl.escrituras).toEqual([]);
      expect(pl.lecturas).toEqual([]);
    }
  });
  void LP;
});
const m_prueba = (m: Mundo): ResultadoTurno => m.turno({ headers: {}, body: { modoPrueba: true, telefonoDePrueba: ANA, enviarDeVerdad: false, ...valorMeta(mTexto('hola'), ANA) } }, { tolerarFallo: true });

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
  const conversacion = (base: Record<string, unknown>): string[] => {
    const pl = planilla();
    const m = crear({ base, dobles: pl.dobles });
    const salida: string[] = [];
    for (const q of ['hola', 'me cuesta dormir por las noches', 'cuánto cuesta?', 'gracias']) {
      const t = hablar(m, ANA, mTexto(q), { toleraFallo: true });
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
  it('«Prospecto para la planilla» debajo de «Resumen del turno» es hallazgo (el resumen es la última rama)', () => {
    const f = copia(PRODUCCION); nodo(f, 'Prospecto para la planilla').position = [6200, 1500];
    expect(g('produccion', f).join(' ')).toMatch(/tiene que ir debajo de «Armar mensajes» y encima de «Resumen del turno»/);
  });
  it('los datos sin el mapa `crm` son hallazgo', () => {
    expect((guardias('produccion', PRODUCCION, {}) as string[]).join(' ')).toMatch(/faltan los datos `crm`/);
  });
  it('conteo de nodos: 64 en producción (el tope sube de 56 a 64, aprobado por Andres el 31/10/2026) y 59 en la prueba', () => {
    expect(PRODUCCION.nodes.length).toBe(64);
    expect(PRUEBA.nodes.length).toBe(59);
    expect(TOPE_DE_NODOS).toBe(64);
  });
});

// El panel por omisión sigue siendo el de Rubén: este archivo no cambia su mundo.
void panelOk; void entrega;
