/**
 * EL miniCRM EN EL FLUJO DE WALISUMA (módulo `crm`). Dos capas:
 *   · UNIDADES: `wlProspectoCrm` (la función pura de `wl-venta.js` que arma el prospecto desde el turno, con vocabulario cerrado) y `crmDecidirFila` (el módulo, con el adaptador de señales).
 *   · FLUJO: el JSON versionado en el n8n de mentira, con dobles de Google Sheets: qué turnos guardan y cuáles no (modo prueba, id vacío o marcador, comercio suspendido, uso extendido, pausa por Tomar,
 *     número de otro país, plan «nada»), el turno del QR (dos mensajes, UN solo prospecto), el interruptor `crm.activo`, la credencial del tenant y los rangos (nunca la U).
 * Mensajes por conversación: 0 (la rama del miniCRM no envía nada; se demuestra comparando la conversación con y sin planilla). Se prueba NEGANDO.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileFunction } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { Flujo, J } from '../../lib/flujo';
import type { Doble, Mundo, ResultadoTurno } from '../../lib/n8n-de-mentira';
// @ts-expect-error módulo .mjs sin tipos
import { hallazgosCrm, inyectarMapa } from '../../../../Flujos/experimental/comun-sin-agente/construir-crm.mjs';
// @ts-expect-error el armador es un .mjs sin tipos
import { CREDENCIAL_CRM, NODOS_DE_CRM, guardias } from '../../../../Flujos/experimental/walisuma/construir.mjs';
import { ANA, CARPETA, ENTREGA, EXTRANJERO, PRODUCCION, PRUEBA, SUSPENDIDO, COMPROBANTE, crear as crearBase, hablar, mImagen, mSticker, mTexto, modelo, panelConQr, panelOk, valorMeta, type Opciones } from './mundo';

const RAIZ = join(CARPETA, '..', '..', '..');
const leerMod = (r: string): string => readFileSync(join(RAIZ, 'Flujos', 'src', 'modulos', r), 'utf8');
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const MAPA = (JSON.parse(readFileSync(join(RAIZ, 'admin/scripts/datos/walisuma/walisuma.json'), 'utf8')) as J)['crm'] as J;

// ------------------------------------------------------------------------------------------------ las dos piezas de código, tal como corren en n8n
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WL: any = compileFunction(`${readFileSync(join(CARPETA, 'src/lib/wl-venta.js'), 'utf8')}\nreturn { wlProspectoCrm };`, [])();
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
const ENCABEZADOS = [{ json: { values: [TITULOS] } as J }];
const IDS = [{ json: { row_number: 4, 'ID Lead': 'LEAD-1010' } }];

/** Un turno ya resuelto, con lo que `Armar mensajes` le pasa a `wlProspectoCrm`. */
const turno = (o: J = {}): J => ({ from: TEL, tipo: 'modelo', plan: {}, fichaAntes: {}, anuncio: false, avisoSalio: false, nombrePerfil: 'Cliente Ejemplo W', ahoraMs: AHORA, ...o });
const prospecto = (o: J = {}): J => WL.wlProspectoCrm(turno(o)) as J;
const senal = (p: J, k: string): unknown => (p['senales'] as J)[k];
function decidir(p: J, existentes: Array<{ json: J }> = []): J {
  const salida = M.crmDecidirFila({ prospectos: [{ json: p }], busqueda: existentes, lecturaIds: IDS, encabezados: ENCABEZADOS, mapa: copia(MAPA), adaptador: M.CRM_ADAPTADOR, ahoraMs: AHORA }) as Array<{ json: J }>;
  return salida[0]!.json;
}
const celda = (r: J, campo: string): unknown => r[((MAPA['columnas'] as Record<string, Col>)[campo] as Col).titulo];

describe('unidades: wlProspectoCrm (vocabulario cerrado) y la fila que decide el módulo', () => {
  it('QR emitido en este turno -> inicioCompra, «Compra», Caliente', () => {
    const p = prospecto({ tipo: 'qr', plan: { tipo: 'qr' } });
    expect(senal(p, 'inicioCompra')).toBe(true);
    expect(p['quePidio']).toBe('Compra');
    const r = decidir(p);
    expect(r['accionPlanilla']).toBe('agregar');
    expect(celda(r, 'clasificacion')).toBe('Caliente');
  });
  it('comprobante resuelto (cuadra o aproximado) -> inicioCompra y «Comprobante de pago»', () => {
    for (const resultado of ['cuadra', 'aproximado']) {
      const p = prospecto({ tipo: 'comprobante', plan: { resultado } });
      expect(senal(p, 'inicioCompra'), resultado).toBe(true);
      expect(p['quePidio']).toBe('Comprobante de pago');
    }
  });
  it('NEGADO: un comprobante ilegible, por reintentar o ya cotejado NO es inicio de compra', () => {
    for (const resultado of ['ilegible', 'reintentar', 'ya_cotejado']) {
      const p = prospecto({ tipo: 'comprobante', plan: { resultado } });
      expect(senal(p, 'inicioCompra'), resultado).toBe(false);
      expect(p['quePidio']).toBeUndefined();
    }
  });
  it('una ficha vigente con un pedido o un comprobante recibido sigue siendo inicio de compra; una vacía no', () => {
    expect(senal(prospecto({ fichaAntes: { pedidos: 1 } }), 'inicioCompra')).toBe(true);
    expect(senal(prospecto({ fichaAntes: { comprobanteMs: AHORA - 1000 } }), 'inicioCompra')).toBe(true);
    expect(senal(prospecto({ fichaAntes: { pedidos: 0, comprobanteMs: 0 } }), 'inicioCompra')).toBe(false);
    expect(senal(prospecto(), 'inicioCompra')).toBe(false);
  });
  it('quiere_hablar -> pidioLlamada y «Hablar con una persona»; la derivación dice solo si el aviso SALIÓ', () => {
    const sin = prospecto({ tipo: 'derivar', plan: { motivo: 'quiere_hablar' }, avisoSalio: false });
    expect(senal(sin, 'pidioLlamada')).toBe(true);
    expect(sin['quePidio']).toBe('Hablar con una persona');
    expect(sin['derivacion']).toBeUndefined();
    const con = prospecto({ tipo: 'derivar', plan: { motivo: 'quiere_hablar' }, avisoSalio: true });
    expect(con['derivacion']).toBe('Pidió hablar con una persona');
    expect(celda(decidir(con), 'clasificacion')).toBe('Caliente');
  });
  it('otras derivaciones: no son pidioLlamada y salen con su etiqueta cerrada', () => {
    const caso = (motivo: string, esperado: string): void => {
      const p = prospecto({ tipo: 'derivar', plan: { motivo }, avisoSalio: true });
      expect(senal(p, 'pidioLlamada'), motivo).toBe(false);
      expect(p['quePidio'], motivo).toBe(esperado);
      expect(p['derivacion'], motivo).toBe('Consulta para recepción');
    };
    caso('corporativo', 'Pedido corporativo o por volumen');
    caso('factura', 'Factura');
    caso('sin_precio', 'Consulta para recepción');
    caso('modelo_caido', 'Consulta para recepción');
    // Sin aviso salido, ninguna derivación.
    expect(prospecto({ tipo: 'derivar', plan: { motivo: 'factura' }, avisoSalio: false })['derivacion']).toBeUndefined();
    // Solo una derivación lleva «derivacion», aunque el aviso haya salido.
    expect(prospecto({ tipo: 'modelo', avisoSalio: true })['derivacion']).toBeUndefined();
  });
  it('llegó por un anuncio -> llegoPorAnuncio; consulta de catálogo (modelo o anuncio) -> «Consulta de catálogo»', () => {
    const p = prospecto({ anuncio: true, tipo: 'anuncio' });
    expect(senal(p, 'llegoPorAnuncio')).toBe(true);
    expect(p['quePidio']).toBe('Consulta de catálogo');
    expect(prospecto({ tipo: 'modelo' })['quePidio']).toBe('Consulta de catálogo');
    expect(prospecto({ tipo: 'cortes' })['quePidio']).toBeUndefined();
  });
  it('el nombre del perfil solo lleva letras, espacios, apóstrofo y guion; =, +, - y @ al inicio no pasan (máx. 60)', () => {
    expect(prospecto({ nombrePerfil: '=HYPERLINK("x")+@-Ana' })['nombre']).toBe('HYPERLINKx-Ana');
    expect(prospecto({ nombrePerfil: '+591 Ana-María @casa' })['nombre']).toBe('Ana-María casa');
    expect(prospecto({ nombrePerfil: "-Beto O'Neil" })['nombre']).toBe("Beto O'Neil");
    for (const n of ['=1+1', '+5', '-2', '@x']) expect(String(prospecto({ nombrePerfil: n })['nombre'])).not.toMatch(/^[=+\-@]/);
    expect(String(prospecto({ nombrePerfil: 'a'.repeat(200) })['nombre']).length).toBeLessThanOrEqual(60);
  });
  it('el teléfono sale solo con dígitos', () => {
    expect(prospecto({ from: '+591 7-000 0001' })['telefono']).toBe('59170000001');
  });
  it('NEGADO: el texto del cliente, las líneas, el monto, la dirección, el NIT y la CI jamás llegan al prospecto ni a la fila', () => {
    const secreto = ['Quiero 3 bufandas para Av. Siempre Viva 742', 'NIT 1020304050', 'CI 7654321 LP', 'Bs 12345,67', 'ZZ-PEDIDO-SECRETO'];
    const plan = { tipo: 'qr', textoCliente: secreto[0], total: 1234567, monto: 12345.67, lineas: [{ id: 'bufanda-vicuna', cantidad: 3, nombre: secreto[4] }], entrega: { modo: 'Envío', direccion: secreto[0], ciudad: 'La Paz', nombre: 'Ana' }, facturacion: { nombre: 'Ana', documento: secreto[1] }, documento: secreto[2], mensaje: secreto[3], motivo: 'factura' };
    for (const tipo of ['qr', 'comprobante', 'derivar', 'modelo', 'pedido_sin_cobro']) {
      const p = prospecto({ tipo, plan, avisoSalio: true, fichaAntes: { pedidos: 1, hist: [{ r: 'u', t: secreto[0] }], carrito: plan.lineas, entrega: plan.entrega } });
      const volcado = JSON.stringify([p, decidir(p)]);
      for (const s of [...secreto, '1234567', '12345', '1020304050', '7654321', 'Siempre Viva']) expect(volcado, `${tipo}: ${s}`).not.toContain(s);
      expect(Object.keys(p).sort()).toEqual(['anuncio', 'nombre', 'nombreDePerfil', 'quePidio', 'senales', 'telefono', 'ultimaInteraccionMs', ...(p['derivacion'] ? ['derivacion'] : [])].sort());
    }
  });
  it('ningún valor de la fila es false, «No» ni un objeto', () => {
    for (const c of [prospecto(), prospecto({ tipo: 'derivar', plan: { motivo: 'quiere_hablar' }, avisoSalio: true }), prospecto({ tipo: 'qr' }), prospecto({ anuncio: true })]) {
      for (const v of Object.values(decidir(c))) {
        expect(v).not.toBe(false);
        expect(String(v)).not.toBe('false');
        expect(String(v)).not.toContain('[object Object]');
        expect(String(v)).not.toBe('No');
      }
    }
  });
  it('una entrada que no es un objeto no lanza', () => {
    for (const x of [undefined, null, 7, 'x', []]) expect(() => WL.wlProspectoCrm(x)).not.toThrow();
  });
});

// ------------------------------------------------------------------------------------------------ el flujo
const ID_PLANILLA = 'PlanillaDePruebaDeWalisumaParaElMiniCrm01';
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
/** El mundo de Walisuma con los dobles de Google Sheets montados encima. */
function crear(o: Opciones & { dobles?: Record<string, Doble> } = {}): Mundo {
  const { dobles, ...resto } = o;
  const m = crearBase(resto);
  for (const [k, v] of Object.entries(dobles ?? {})) m.dobles[k] = v;
  return m;
}
const corrioLaRama = (t: ResultadoTurno): boolean => t.ejecutados.has('Prospecto para la planilla') && t.ejecutados.has('Decidir fila de la planilla');
/** La negación de verdad: «Armar mensajes» CORRIÓ y todas sus salidas dicen `guardarPlanilla: false` (no basta con que la rama no corra: el flujo pudo caerse antes). */
const armoSinGuardar = (t: ResultadoTurno): void => {
  expect(t.ejecutados.has('Armar mensajes')).toBe(true);
  const salida = t.porNodo['Armar mensajes'] ?? [];
  expect(salida.length).toBeGreaterThan(0);
  for (const s of salida) expect(s['guardarPlanilla']).toBe(false);
};
const escritas = (pl: Planilla): number => pl.escrituras.length + pl.actualizaciones.length;

describe('flujo: quién guarda', () => {
  it('una conversación normal (id y hoja) agrega UNA fila con el prospecto, con el nombre del perfil y sin texto del cliente', () => {
    const pl = planilla();
    const t = hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('hola, mi NIT es 1020304050'));
    expect(corrioLaRama(t)).toBe(true);
    expect(pl.escrituras).toHaveLength(1);
    expect(pl.actualizaciones).toHaveLength(0);
    const f = pl.escrituras[0]!;
    expect(f['ID Lead']).toBe('LEAD-1011');
    expect(f['Clasificación']).toBe('Tibio');
    expect(f['Origen / Canal']).toBe('Chatbot WhatsApp IA');
    expect(String(f['Nombre y Apellido'])).toMatch(/^'?Ana Pérez$/);
    expect(String(f['Teléfono WhatsApp'])).toBe(`'${ANA}`);
    expect(JSON.stringify(f)).not.toContain('1020304050');
  });
  it('el turno del QR manda DOS mensajes (resumen e imagen) y guarda UN solo prospecto, Caliente', () => {
    const pl = planilla();
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, modeloDice: modelo('Con gusto, lo anoto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA }) });
    hablar(m, ANA, mTexto('una billetera'));
    pl.escrituras.length = 0; pl.actualizaciones.length = 0;
    const t = hablar(m, ANA, mTexto('quiero pagar'));
    expect(t.mensajes.length).toBe(2);
    expect(t.mensajes.some((x) => x.tipo === 'image')).toBe(true);
    const salidas = t.porNodo['Armar mensajes'] ?? [];
    expect(salidas.map((s) => s['guardarPlanilla'])).toEqual([true, false]);
    expect(salidas[1]!['prospectoPlanilla']).toBeNull();
    expect((t.porNodo['Prospecto para la planilla'] ?? [])).toHaveLength(1);
    expect(escritas(pl)).toBe(1);
    expect((pl.actualizaciones[0] ?? pl.escrituras[0])!['Clasificación']).toBe('Caliente');
  });
  it('el comprobante cotejado deja el prospecto con «Comprobante de pago»', () => {
    const pl = planilla();
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, medio: { clasificacion: COMPROBANTE }, modeloDice: modelo('Con gusto, lo anoto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA }) });
    hablar(m, ANA, mTexto('una billetera'));
    hablar(m, ANA, mTexto('quiero pagar'));
    m.dobles['Traer configuración'] = () => panelConQr(450);
    const t = hablar(m, ANA, mImagen({ caption: '' }));
    expect(((t.porNodo['Prospecto para la planilla'] ?? [])[0] ?? {})['quePidio']).toBe('Comprobante de pago');
  });
  it('las lecturas llegan hasta la T (nunca a la U) y la de los IDs solo a la A', () => {
    const pl = planilla();
    hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('hola'));
    expect(pl.lecturas).toContain('buscar|A3:T');
    expect(pl.lecturas).toContain('ids|A3:A');
    expect(pl.lecturas).toContain('enc|A3:T3');
    expect(pl.lecturas.some((l) => /:U|:V/.test(l))).toBe(false);
  });
  it('NEGADO: sin id de planilla (vacío, como en la variante de prueba) no guarda y ni consulta Google', () => {
    const pl = planilla();
    const t = hablar(crear({ base: { planillaProspectosId: '' }, dobles: pl.dobles }), ANA, mTexto('hola'));
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.lecturas).toEqual([]);
    expect(escritas(pl)).toBe(0);
  });
  it('NEGADO: un marcador REEMPLAZAR_* (el valor del repositorio) tampoco guarda ni consulta Google', () => {
    const pl = planilla();
    const t = hablar(crear({ base: { planillaProspectosId: 'REEMPLAZAR_PLANILLA_PROSPECTOS_ID_WALISUMA', planillaProspectosHoja: 'Leads_CRM' }, dobles: pl.dobles }), ANA, mTexto('hola'));
    armoSinGuardar(t);
    expect(pl.lecturas).toEqual([]);
    expect(escritas(pl)).toBe(0);
  });
  it('NEGADO: la variante de PRUEBA lleva el id vacío (Config base) y la de producción el marcador; el modo prueba no guarda aunque se fuerce un id', () => {
    const id = (f: Flujo): unknown => (((((f.nodes.find((n) => n.name === 'Config base')!.parameters) as J)['assignments'] as J)['assignments']) as J[]).find((a) => a['name'] === 'planillaProspectosId')?.['value'];
    expect(id(PRUEBA)).toBe('');
    expect(String(id(PRODUCCION))).toMatch(/^REEMPLAZAR_/);
    const pl = planilla();
    const m = crear({ flujo: PRUEBA, base: { ...BASE_CON_PLANILLA }, dobles: pl.dobles });
    const t = m.turno({ headers: {}, body: { modoPrueba: true, telefonoDePrueba: ANA, enviarDeVerdad: false, ...valorMeta(mTexto('hola'), ANA) } }, { tolerarFallo: true });
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(escritas(pl)).toBe(0);
  });
  it('NEGADO: el comercio suspendido no guarda', () => {
    const pl = planilla();
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, panel: { statusCode: 409, body: { mensajeCortesia: SUSPENDIDO } } });
    const t = hablar(m, ANA, mTexto('hola'), { toleraFallo: true });
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(escritas(pl)).toBe(0);
  });
  it('NEGADO: el uso extendido (operador) no guarda, aunque sí sale el aviso a recepción', () => {
    const pl = planilla();
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, ingesta: { ok: true, atencion: { estado: 'operador' } } });
    const t = hablar(m, ANA, mTexto('hola'), { toleraFallo: true });
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(escritas(pl)).toBe(0);
  });
  it('NEGADO: la pausa por persona (estado bloqueado: cero envío) no guarda', () => {
    const pl = planilla();
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, ingesta: { ok: true, atencion: { estado: 'bloqueado' } } });
    const t = hablar(m, ANA, mTexto('hola'), { toleraFallo: true });
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(escritas(pl)).toBe(0);
  });
  it('NEGADO: un número de otro país no guarda', () => {
    const pl = planilla();
    const t = hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), EXTRANJERO, mTexto('hola'), { toleraFallo: true });
    armoSinGuardar(t);
    expect(corrioLaRama(t)).toBe(false);
    expect(escritas(pl)).toBe(0);
  });
  it('NEGADO: un turno sin mensaje (plan «nada»: el mismo entrante repetido y un sticker sin respuesta) no guarda', () => {
    const pl = planilla();
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles });
    hablar(m, ANA, mTexto('hola'), { wamid: 'wamid.REPETIDO1', entrega: 'entrega-r1' });
    pl.escrituras.length = 0; pl.actualizaciones.length = 0;
    const t = hablar(m, ANA, mTexto('hola'), { wamid: 'wamid.REPETIDO1', entrega: 'entrega-r2', toleraFallo: true });
    expect(corrioLaRama(t)).toBe(false);
    expect(escritas(pl)).toBe(0);
    for (const s of t.porNodo['Armar mensajes'] ?? []) expect(s['guardarPlanilla']).toBe(false);
    void mSticker;
  });
  it('crm.activo = false (config de la consola) no guarda y Google ni se consulta', () => {
    const pl = planilla();
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, panel: panelOk({ crm: { activo: false } }) });
    const t = hablar(m, ANA, mTexto('hola'));
    expect(t.mensajes.length).toBeGreaterThan(0);
    expect(pl.lecturas).toEqual([]);
    expect(escritas(pl)).toBe(0);
    expect(t.ejecutados.has('Agregar fila')).toBe(false);
  });
  it('lo que se lee mal NO escribe: encabezados distintos -> no agrega y la conversación sigue', () => {
    const pl = planilla({ enc: [{ json: { values: [['ID Lead', 'Otra cosa']] } as J }] });
    const t = hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('hola'));
    expect(corrioLaRama(t)).toBe(true);
    expect(pl.escrituras).toEqual([]);
    expect(t.mensajes.length).toBeGreaterThan(0);
  });
});

describe('la planilla NUNCA tumba la atención: si calcular el prospecto lanza, el turno responde y no se escribe en la hoja', () => {
  const CIERRE = '} catch (e) { prospectoPlanilla = null; }';
  const conFalla = (protegido: boolean): Flujo => {
    const f = structuredClone(PRODUCCION) as Flujo;
    const n = f.nodes.find((x) => x.name === 'Armar mensajes')!;
    const js = String((n.parameters as J)['jsCode']);
    expect(js.includes(CIERRE)).toBe(true);
    // La declaración de más abajo pisa a la de la biblioteca (las declaraciones se elevan; gana la última): el cálculo del prospecto lanza.
    (n.parameters as J)['jsCode'] = `${protegido ? js : js.replace(CIERRE, '} finally { }')}\nfunction wlProspectoCrm() { throw new Error('prospecto inesperado'); }`;
    return f;
  };
  it('PROTEGIDO: el mensaje al cliente sale, no se escribe en Sheets y la rama de la planilla no corre', () => {
    const pl = planilla();
    const t = hablar(crear({ flujo: conFalla(true), base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('hola'));
    expect(t.mensajes.length).toBeGreaterThan(0);
    expect(escritas(pl)).toBe(0);
    expect(corrioLaRama(t)).toBe(false);
  });
  it('MUTACIÓN: sin el try/catch, el mismo fallo tumba el turno: la prueba de arriba sí detecta la protección', () => {
    const pl = planilla();
    let t: ReturnType<typeof hablar> | null = null;
    let lanzo = false;
    try { t = hablar(crear({ flujo: conFalla(false), base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('hola')); } catch { lanzo = true; }
    expect(lanzo || t!.mensajes.length === 0).toBe(true);
  });
});

describe('flujo: 0 mensajes agregados y la credencial del tenant', () => {
  const conversacion = (base: Record<string, unknown>): string[] => {
    const pl = planilla();
    const m = crear({ base, dobles: pl.dobles });
    const salida: string[] = [];
    for (const q of ['hola', 'busco una billetera', 'cuánto cuesta?', 'gracias']) {
      const t = hablar(m, ANA, mTexto(q), { toleraFallo: true });
      salida.push(...t.mensajes.map((e) => e.cuerpo), `avisos:${t.avisos.length}`);
    }
    return salida;
  };
  it('la misma conversación con planilla y sin planilla manda exactamente lo mismo', () => {
    expect(conversacion(BASE_CON_PLANILLA)).toEqual(conversacion({ planillaProspectosId: '' }));
  });
  it('la rama no tiene ningún nodo que envíe a WhatsApp (solo Google Sheets, el código y el interruptor)', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      const rama = f.nodes.filter((n) => (NODOS_DE_CRM as string[]).includes(n.name));
      expect(rama).toHaveLength(8);
      for (const n of rama) expect(['n8n-nodes-base.code', 'n8n-nodes-base.googleSheets', 'n8n-nodes-base.switch', 'n8n-nodes-base.httpRequest']).toContain(n.type);
      expect(rama.filter((n) => n.type === 'n8n-nodes-base.httpRequest').map((n) => n.name)).toEqual(['Leer encabezados de la planilla']);
    }
  });
  it('la credencial de Google es la del tenant en todos los nodos de la hoja', () => {
    expect(CREDENCIAL_CRM('walisuma')).toBe('Google Sheets miniCRM (crm-walisuma)');
    for (const f of [PRODUCCION, PRUEBA]) {
      const hojas = f.nodes.filter((x) => x.type === 'n8n-nodes-base.googleSheets');
      expect(hojas.length).toBeGreaterThan(0);
      for (const n of hojas) expect(((n.credentials as J)['googleApi'] as J)['name']).toBe('Google Sheets miniCRM (crm-walisuma)');
    }
  });
});

describe('flujo: las barreras de la rama se NIEGAN con mutaciones', () => {
  const g = (v: 'produccion' | 'prueba', f: Flujo): string[] => guardias(v, f, { mapaCrm: MAPA }) as string[];
  const nodo = (f: Flujo, n: string) => f.nodes.find((x) => x.name === n)!;
  const rango = (f: Flujo, n: string, r: string): void => { (((((nodo(f, n).parameters as J)['options'] as J)['dataLocationOnSheet'] as J)['values']) as J)['range'] = r; };
  it('lo versionado no tiene hallazgos', () => {
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
  it('los datos sin el mapa `crm` son hallazgo', () => {
    expect((guardias('produccion', PRODUCCION, { mapaCrm: {} }) as string[]).join(' ')).toMatch(/faltan los datos `crm`/);
  });
});
