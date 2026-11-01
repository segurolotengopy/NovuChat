/**
 * EL miniCRM EN EL FLUJO DE EVY (módulo `crm`, F1 del 31/10/2026). Dos capas:
 *   · UNIDADES: `evProspectoCrm` (la función pura de `ev.js` que arma el prospecto desde el turno, con vocabulario cerrado) y `crmDecidirFila` (el módulo, con el adaptador de señales) sobre una tabla de seis leads,
 *     y sus negaciones (precio sin cierre, cierre sin precio, texto libre de salud, valores «false» / «[object Object]» / «No»).
 *   · FLUJO: el JSON versionado en el n8n de mentira, con dobles de Google Sheets: qué turnos guardan y cuáles no (riesgo, baja, nada, etapa de prueba, id vacío), las 48 h, los rangos y la credencial.
 * Mensajes por conversación: 0 (la rama del miniCRM no envía nada; se demuestra comparando la conversación con y sin planilla).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileFunction } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { Flujo, J } from '../../lib/flujo';
import type { Doble } from '../../lib/n8n-de-mentira';
// @ts-expect-error módulo .mjs sin tipos
import { hallazgosCrm, inyectarMapa } from '../../../../Flujos/experimental/comun-sin-agente/construir-crm.mjs';
// @ts-expect-error el armador es un .mjs sin tipos
import { CREDENCIAL_CRM, NODOS_DE_CRM, guardias } from '../../../../Flujos/experimental/rroca-evy/construir.mjs';
import { ANA, BETO, CARPETA, PRODUCCION, PRUEBA, crear, datos, hablar, mTexto } from './mundo';

const RAIZ = join(CARPETA, '..', '..', '..');
const leerMod = (r: string): string => readFileSync(join(RAIZ, 'Flujos', 'src', 'modulos', r), 'utf8');
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const MAPA = (datos()['crm'] ?? null) as J;

// ------------------------------------------------------------------------------------------------ las dos piezas de código, tal como corren en n8n
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EV: any = compileFunction(`${readFileSync(join(CARPETA, 'src/lib/ev.js'), 'utf8')}\nreturn { evProspectoCrm };`, [])();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M: any = compileFunction(`${inyectarMapa(leerMod('crm/crm.js'), MAPA)}\n${leerMod('crm/adaptador-senales.js')}\nreturn { crmDecidirFila, CRM_ADAPTADOR };`, [])();

const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);
const TEL = ['591', '7', '00', '01234'].join('');
type Col = { letra: string; titulo: string };
/** Los títulos de la fila 3 en orden de columna, de A a T (la U no se lee). */
const TITULOS: string[] = (() => {
  const todas: Col[] = [...Object.values(MAPA['columnas'] as Record<string, Col>), ...Object.values(MAPA['equipo'] as Record<string, Col>)];
  return todas.filter((c) => c.letra <= 'T').sort((a, b) => a.letra.localeCompare(b.letra)).map((c) => c.titulo);
})();
const fila = (n: number, extra: J = {}): { json: J } => ({ json: Object.fromEntries([['row_number', n], ...TITULOS.map((t) => [t, ''])].map(([k, v]) => [k, extra[k as string] ?? v])) });
const ENCABEZADOS = [fila(4)];
const IDS = [{ json: { row_number: 4, 'ID Lead': 'LEAD-1010' } }];

/** Un turno ya resuelto, con lo que `Armar mensajes` le pasa a `evProspectoCrm`. */
const turno = (o: J = {}): J => ({ from: TEL, efectivo: 'modelo', textoCliente: 'hola', historial: [], fichaAntes: {}, preferencia: '', nombre: '', nombrePerfil: 'Yeimy Ortiz', anuncio: false, llamada: false, avisoSalio: false, nuevoContacto: true, ahoraMs: AHORA, ...o });
const prospecto = (o: J = {}): J => EV.evProspectoCrm(turno(o)) as J;
/** El prospecto pasa por el módulo: lo que se escribiría en la hoja. */
function decidir(p: J, existentes: Array<{ json: J }> = []): J {
  const salida = M.crmDecidirFila({ prospectos: [{ json: p }], busqueda: existentes, lecturaIds: IDS, encabezados: ENCABEZADOS, mapa: copia(MAPA), adaptador: M.CRM_ADAPTADOR, ahoraMs: AHORA }) as Array<{ json: J }>;
  return salida[0]!.json;
}
const celda = (r: J, campo: string): unknown => r[((MAPA['columnas'] as Record<string, Col>)[campo] as Col).titulo];

describe('unidades: tabla de seis leads (evProspectoCrm + crmDecidirFila)', () => {
  it('Maria Eugenia: aceptó agendar, derivada a recepción, llegó por un anuncio -> Caliente, Alta, «Solicitud de cita», «Campaña Meta Ads»', () => {
    const p = prospecto({ efectivo: 'derivar', textoCliente: 'quiero agendar el martes en la tarde', nombre: 'Maria', nombrePerfil: 'Maria Eugenia Soliz', anuncio: true, avisoSalio: true, preferencia: 'el martes en la tarde' });
    const r = decidir(p);
    expect(r['accionPlanilla']).toBe('agregar');
    expect(celda(r, 'clasificacion')).toBe('Caliente');
    expect(celda(r, 'calificacion')).toBe('Alta');
    expect(String(celda(r, 'derivacion'))).toContain('Solicitud de cita');
    expect(celda(r, 'origen')).toBe('Campaña Meta Ads');
    expect(String(celda(r, 'nombre'))).toContain('Maria Eugenia Soliz');
    expect(String(celda(r, 'diaPreferido'))).toContain('Martes');
    expect(String(celda(r, 'horarioPreferido'))).toContain('Tarde');
    expect(r['_']).toBeUndefined();
  });
  it('Rosarito: pide la ubicación -> Caliente', () => {
    const p = prospecto({ textoCliente: 'cual es la ubicación?', nombrePerfil: 'Rosarito' });
    expect((p['senales'] as J)['pidioUbicacion']).toBe(true);
    const r = decidir(p);
    expect(celda(r, 'clasificacion')).toBe('Caliente');
    expect(celda(r, 'calificacion')).toBe('Alta');
    expect(String(celda(r, 'quePidio'))).toContain('Ubicación');
  });
  it('Dunia: solo llegó por un anuncio -> Tibio, Media', () => {
    const r = decidir(prospecto({ anuncio: true, nombrePerfil: 'Dunia' }));
    expect(celda(r, 'clasificacion')).toBe('Tibio');
    expect(celda(r, 'calificacion')).toBe('Media');
    expect(celda(r, 'origen')).toBe('Campaña Meta Ads');
  });
  it('Yeimy: escribió -> Tibio, origen «Chatbot WhatsApp IA»', () => {
    const r = decidir(prospecto());
    expect(celda(r, 'clasificacion')).toBe('Tibio');
    expect(celda(r, 'origen')).toBe('Chatbot WhatsApp IA');
    expect(celda(r, 'etapaInicial')).toBe('1. Nuevo Lead');
    expect(r['Estado Comercial']).toBe('Activo');
  });
  it('Roxi: preguntó el precio y cerró (cierre amable) -> Frío, Baja', () => {
    const p = prospecto({ efectivo: 'cierre_amable', textoCliente: 'gracias, lo voy a pensar', historial: [{ r: 'u', t: 'cuánto cuesta el relleno de labios?' }, { r: 'a', t: 'La valoración es gratuita.' }], nombrePerfil: 'Roxi' });
    expect((p['senales'] as J)['preguntoPrecioYCerro']).toBe(true);
    const r = decidir(p);
    expect(celda(r, 'clasificacion')).toBe('Frío');
    expect(celda(r, 'calificacion')).toBe('Baja');
  });
  describe('Moira: una fila que el equipo marcó «No es lead» no se pisa salvo señal Caliente', () => {
    const marcada = (): Array<{ json: J }> => [fila(7, { 'Teléfono WhatsApp': TEL, 'Nombre y Apellido': 'Moira', 'Calificación IA': 'Descalificado', 'Clasificación': 'No es lead' })];
    it('una señal débil (solo escribió, o un anuncio) no la toca', () => {
      for (const o of [{ nombrePerfil: 'Moira', nuevoContacto: false }, { nombrePerfil: 'Moira', anuncio: true, nuevoContacto: false }]) {
        const r = decidir(prospecto(o), marcada());
        expect(r['Clasificación'], JSON.stringify(o)).toBeUndefined();
        expect(r['Calificación IA']).toBeUndefined();
      }
    });
    it('una señal Caliente (pidió la ubicación) sí la cambia', () => {
      const r = decidir(prospecto({ textoCliente: 'cual es la ubicación?', nombrePerfil: 'Moira', nuevoContacto: false }), marcada());
      expect(r['accionPlanilla']).toBe('actualizar');
      expect(r['Clasificación']).toBe('Caliente');
    });
  });
});

describe('unidades: negaciones', () => {
  it('preguntar el precio SIN cerrar no es Frío', () => {
    const p = prospecto({ textoCliente: 'cuánto cuesta el relleno de labios?' });
    expect((p['senales'] as J)['preguntoPrecioYCerro']).toBe(false);
    expect(celda(decidir(p), 'clasificacion')).toBe('Tibio');
  });
  it('un cierre amable SIN haber preguntado el precio no es Frío', () => {
    const p = prospecto({ efectivo: 'cierre_amable', textoCliente: 'gracias, hasta luego' });
    expect((p['senales'] as J)['preguntoPrecioYCerro']).toBe(false);
    expect(celda(decidir(p), 'clasificacion')).toBe('Tibio');
  });
  it('«el martes en la tarde, tengo diabetes»: solo el día y la franja; la salud no llega al prospecto ni a la fila', () => {
    const p = prospecto({ efectivo: 'derivar', avisoSalio: true, preferencia: 'el martes en la tarde, tengo diabetes' });
    expect(p['diaPreferido']).toBe('Martes');
    expect(p['horarioPreferido']).toBe('Tarde');
    expect(JSON.stringify(p)).not.toMatch(/diabet/i);
    expect(JSON.stringify(decidir(p))).not.toMatch(/diabet/i);
  });
  it('una preferencia sin día ni franja reconocibles no deja nada (el texto libre no pasa)', () => {
    const p = prospecto({ preferencia: 'tengo diabetes y presión alta' });
    expect(p['diaPreferido']).toBeUndefined();
    expect(p['horarioPreferido']).toBeUndefined();
  });
  it('la derivación no existe sin aviso salido, y jamás es false, «No» ni un objeto', () => {
    const sin = prospecto({ efectivo: 'derivar', avisoSalio: false });
    expect(sin['derivacion']).toBeUndefined();
    const casos = [prospecto(), sin, prospecto({ efectivo: 'derivar', avisoSalio: true }), prospecto({ efectivo: 'derivar', llamada: true, avisoSalio: true }), prospecto({ efectivo: 'medica', avisoSalio: true }), prospecto({ anuncio: true, preferencia: 'hoy a las 15' })];
    for (const c of casos) {
      const r = decidir(c);
      for (const v of Object.values(r)) {
        expect(v).not.toBe(false);
        expect(String(v)).not.toBe('false');
        expect(String(v)).not.toContain('[object Object]');
        expect(String(v)).not.toBe('No');
      }
      expect(JSON.stringify(c)).not.toMatch(/"derivacion":(false|"No")/);
    }
    expect(prospecto({ efectivo: 'derivar', llamada: true, avisoSalio: true })['derivacion']).toBe('Pidió llamada');
    expect(prospecto({ efectivo: 'medica', avisoSalio: true })['derivacion']).toBe('Consulta para recepción');
  });
  it('NO hay señal «noEsPaciente» (DP4): ningún turno marca «No es lead» por sí solo', () => {
    for (const t of ['soy proveedor', 'no soy paciente, vendo insumos', 'quiero vender mis productos']) {
      const p = prospecto({ textoCliente: t });
      expect(Object.keys(p['senales'] as J)).not.toContain('noEsPaciente');
      expect(celda(decidir(p), 'clasificacion')).not.toBe('No es lead');
    }
  });
});

// ------------------------------------------------------------------------------------------------ el flujo
const ID_PLANILLA = 'PlanillaDePruebaDeEvyParaElMiniCrm01';
interface Planilla { dobles: Record<string, Doble>; escrituras: J[]; actualizaciones: J[]; lecturas: string[]; }
/** Dobles de Google Sheets: `filas` = lo que devuelve la búsqueda del teléfono, `ids` = la columna del ID, `enc` = la fila de encabezados con la primera de datos. */
function planilla(o: { filas?: Array<{ json: J }>; ids?: Array<{ json: J }>; enc?: Array<{ json: J }> } = {}): Planilla {
  const p: Planilla = { dobles: {}, escrituras: [], actualizaciones: [], lecturas: [] };
  const lee = (nombre: string, datos: Array<{ json: J }>): Doble => (ll) => { p.lecturas.push(`${nombre}|${String((((ll.parametros['options'] as J)['dataLocationOnSheet'] as J)['values'] as J)['range'])}`); return datos.map((x) => x.json); };
  p.dobles['Buscar teléfono en planilla'] = lee('buscar', o.filas ?? []);
  p.dobles['Leer IDs de la planilla'] = lee('ids', o.ids ?? IDS);
  p.dobles['Leer encabezados de la planilla'] = lee('enc', o.enc ?? ENCABEZADOS);
  p.dobles['Agregar fila'] = (ll) => { p.escrituras.push(ll.item); return {}; };
  p.dobles['Actualizar fila'] = (ll) => { p.actualizaciones.push(ll.item); return {}; };
  return p;
}
const BASE_CON_PLANILLA = { planillaProspectosId: ID_PLANILLA, planillaProspectosHoja: 'Leads_CRM' };
const corrioLaRama = (t: { ejecutados: Set<string> }): boolean => t.ejecutados.has('Prospecto para la planilla') && t.ejecutados.has('Decidir fila de la planilla');
const planDe = (t: { porNodo: Record<string, J[]> }): string => String((((t.porNodo['Resumen del turno'] ?? [])[0] ?? {})['resumen'] as J | undefined)?.['plan']);
const prospectoDe = (t: { porNodo: Record<string, J[]> }): J | undefined => (t.porNodo['Prospecto para la planilla'] ?? [])[0];

describe('flujo: quién guarda y quién no', () => {
  it('una conversación normal (id y hoja) agrega UNA fila con el prospecto y no envía nada de más', () => {
    const pl = planilla();
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles });
    const t = hablar(m, ANA, mTexto('hola'), { nombre: 'Yeimy Ortiz' });
    expect(corrioLaRama(t)).toBe(true);
    expect(pl.escrituras).toHaveLength(1);
    expect(pl.actualizaciones).toHaveLength(0);
    const f = pl.escrituras[0]!;
    expect(f['ID Lead']).toBe('LEAD-1011');
    expect(f['Clasificación']).toBe('Tibio');
    expect(f['Origen / Canal']).toBe('Chatbot WhatsApp IA');
    expect(String(f['Teléfono WhatsApp'])).toBe(`'${ANA}`);
  });
  it('las lecturas llegan hasta la T (nunca a la U) y la de los IDs solo a la A', () => {
    const pl = planilla();
    hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('hola'));
    expect(pl.lecturas).toContain('buscar|A3:T');
    expect(pl.lecturas).toContain('ids|A3:A');
    expect(pl.lecturas).toContain('enc|A3:T4');
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
    const t = hablar(crear({ base: { planillaProspectosId: 'REEMPLAZAR_PLANILLA_PROSPECTOS_ID_RROCA_EVY' }, dobles: pl.dobles }), ANA, mTexto('hola'));
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.lecturas).toEqual([]);
  });
  it('la variante de PRUEBA lleva el id VACÍO (Config base) y la de producción un marcador', () => {
    const idDe = (f: Flujo): unknown => ((f.nodes.find((n) => n.name === 'Config base')!.parameters as J)['assignments'] as { assignments: Array<{ name: string; value: unknown }> }).assignments.find((a) => a.name === 'planillaProspectosId')!.value;
    expect(idDe(PRUEBA)).toBe('');
    expect(String(idDe(PRODUCCION))).toMatch(/^REEMPLAZAR_/);
  });
  it('la etapa de prueba (etapaPrueba = si) no guarda, aunque haya id', () => {
    const pl = planilla();
    const t = hablar(crear({ base: { ...BASE_CON_PLANILLA, etapaPrueba: 'si', telefonosDePrueba: `${ANA},${BETO}` }, dobles: pl.dobles }), ANA, mTexto('hola'));
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.lecturas).toEqual([]);
  });
  it('riesgo (violencia): no guarda', () => {
    const pl = planilla();
    const t = hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('mi pareja me golpea'));
    expect(planDe(t)).toBe('riesgo');
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
  it('baja (stop): no guarda', () => {
    const pl = planilla();
    const t = hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('stop'));
    expect(planDe(t)).toBe('baja');
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
  it('un turno sin respuesta (plan «nada»: el contacto ya dado de baja que vuelve a escribir) no guarda', () => {
    const pl = planilla();
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles });
    hablar(m, ANA, mTexto('stop'));
    const t = hablar(m, ANA, mTexto('hola otra vez'));
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
  it('el uso extendido (operador) no guarda', () => {
    const pl = planilla();
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles, ingesta: { atencion: { estado: 'operador', mensajeFijo: 'Una persona del equipo va a continuar esta conversación.', respuestasEnVentana: 40 } } });
    const t = hablar(m, ANA, mTexto('hola'));
    expect(planDe(t)).toBe('uso_extendido');
    expect(corrioLaRama(t)).toBe(false);
    expect(pl.escrituras).toEqual([]);
  });
});

describe('flujo: 48 horas y la fila más reciente', () => {
  const previa = (n: number, extra: J = {}): { json: J } => fila(n, { 'Teléfono WhatsApp': ANA, 'Nombre y Apellido': 'Ana', ...extra });
  it('con la ficha VIGENTE (menos de 48 h) el contacto no es nuevo y se ACTUALIZA la fila más reciente', () => {
    const pl = planilla({ filas: [previa(5, { 'Clasificación': 'Tibio' }), previa(9, { 'Clasificación': 'Tibio' })] });
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles });
    hablar(m, ANA, mTexto('hola'));
    pl.escrituras.length = 0; pl.actualizaciones.length = 0;
    m.avanzar(60);
    const t = hablar(m, ANA, mTexto('cual es la ubicación?'));
    expect(prospectoDe(t)?.['nuevoContacto']).toBe(false);
    expect(pl.escrituras).toHaveLength(0);
    expect(pl.actualizaciones).toHaveLength(1);
    expect(pl.actualizaciones[0]!['row_number']).toBe(9 + 2);   // la más reciente (fila 9 de la lectura -> fila 11 en la hoja: el desfase de los encabezados)
    expect(pl.actualizaciones[0]!['Clasificación']).toBe('Caliente');
  });
  it('con 48 h vencidas el contacto es nuevo y se AGREGA una fila (con el ID siguiente)', () => {
    const pl = planilla({ filas: [previa(5, { 'Clasificación': 'Tibio' })] });
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles });
    hablar(m, ANA, mTexto('hola'));
    pl.escrituras.length = 0; pl.actualizaciones.length = 0;
    m.avanzar(49 * 60);
    const t = hablar(m, ANA, mTexto('hola de nuevo'));
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
    const rara = { json: { row_number: 4, 'ID Lead': '', 'Otra cosa': '' } };
    const pl = planilla({ enc: [rara] });
    const t = hablar(crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles }), ANA, mTexto('hola'));
    expect(corrioLaRama(t)).toBe(true);
    expect(pl.escrituras).toEqual([]);
    expect(String((t.porNodo['Decidir fila de la planilla'] ?? [])[0]?.['veredictoPlanilla'])).toMatch(/^encabezados_distintos/);
  });
  it('si Google falla (permiso denegado) no agrega y la conversación sigue igual', () => {
    const pl = planilla();
    pl.dobles['Buscar teléfono en planilla'] = { error: { message: 'PERMISSION_DENIED', code: 403 } };
    const m = crear({ base: BASE_CON_PLANILLA, dobles: pl.dobles });
    const t = hablar(m, ANA, mTexto('hola'));
    expect(pl.escrituras).toEqual([]);
    expect(t.mensajes.length).toBeGreaterThan(0);
  });
});

describe('flujo: 0 mensajes agregados', () => {
  const conversacion = (base: Record<string, unknown>): string[] => {
    const pl = planilla();
    const m = crear({ base, dobles: pl.dobles });
    const salida: string[] = [];
    for (const q of ['hola', 'cuánto cuesta el relleno?', 'quiero agendar el martes en la tarde, soy Ana', 'gracias']) {
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
      for (const n of rama) expect(['n8n-nodes-base.code', 'n8n-nodes-base.googleSheets', 'n8n-nodes-base.switch']).toContain(n.type);
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
  it('la credencial de Evy es la de su tenant', () => {
    expect(CREDENCIAL_CRM('rroca-evy')).toBe('Google Sheets miniCRM (crm-rroca-evy)');
    for (const n of PRODUCCION.nodes.filter((x) => x.type === 'n8n-nodes-base.googleSheets')) expect(((n.credentials as J)['googleApi'] as J)['name']).toBe('Google Sheets miniCRM (crm-rroca-evy)');
  });
  it('retención de ejecuciones distinta de none es hallazgo', () => {
    const f = copia(PRODUCCION); (f as unknown as { settings: J }).settings['saveDataSuccessExecution'] = 'all';
    expect(g('produccion', f).join(' ')).toMatch(/retencion/);
  });
  it('sin un nodo de la rama, o desconectada de «Armar mensajes», es hallazgo', () => {
    const a = copia(PRODUCCION); a.nodes = a.nodes.filter((n) => n.name !== 'Leer IDs de la planilla');
    expect(g('produccion', a).join(' ')).toMatch(/falta el nodo «Leer IDs de la planilla»/);
    const b = copia(PRODUCCION); delete (b.connections as J)['Armar mensajes'];
    expect(g('produccion', b).join(' ')).toMatch(/no está conectado/);
  });
  it('los datos sin el mapa `crm` son hallazgo', () => {
    expect((guardias('produccion', PRODUCCION, {}) as string[]).join(' ')).toMatch(/faltan los datos `crm`/);
  });
  it('conteo de nodos: 53 en producción y 48 en la prueba (el tope sube de 45 a 53, DP1 del 31/10/2026)', () => {
    expect(PRODUCCION.nodes.length).toBe(53);
    expect(PRUEBA.nodes.length).toBe(48);
  });
});
