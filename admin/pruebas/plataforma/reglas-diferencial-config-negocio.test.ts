/**
 * PRUEBA DIFERENCIAL DEL RECORTE DE `configNegocioValida` — LO QUE NO DEBE CAMBIAR, NO CAMBIA.
 *
 * El recorte reescribió, solo para gastar menos expresiones, `configNegocioValida`,
 * `horarioDiaValido`, `enlaceDeMapaValido`, `ubicacionValida`, `estadoTenant` y
 * `flujosTenant` (ver los comentarios «PRESUPUESTO» de `admin/firestore.rules`).
 * Una reescritura así puede cambiar en silencio qué se acepta. Esta prueba corre
 * los mismos casos contra
 *   · las reglas de ANTES: `firestore-base-previa-config-negocio.rules.txt`, copia
 *     congelada de `admin/firestore.rules` de main justo antes del recorte; y
 *   · las reglas de AHORA: `admin/firestore.rules`,
 * y exige CERO diferencias de aceptación y rechazo, salvo UNA clase, declarada y
 * comprobada caso por caso: el documento válido que las reglas de antes rechazaban
 * por quedarse sin presupuesto («maximum of 1000 expressions») y que ahora se
 * acepta (`antes = LIMITE`, `ahora = P`, y el caso lo da por válido: es lo que
 * el recorte vino a arreglar). Un rechazo que sigue siendo rechazo, o una
 * aceptación que sigue siéndolo, no admite excepciones.
 *
 * DOS PARTES.
 *  A. `config/negocio`: ~560 casos (CASOS, en `casos-config-negocio.ts`): cada campo
 *     en su tope y uno más, con `ñ` y emoji, cada tipo raro, cada camino del horario
 *     (`12:29-12:30`, `10:00-09:59`…), los dominios del mapa, las coordenadas, el
 *     calendario, los enumerados, las listas, el sello y el catálogo web contra
 *     catorce formas de ficha.
 *  B. Cinco documentos de OTRAS colecciones que dependen de `estadoTenant` y
 *     `flujosTenant` (`config/venta`, `config/marca`, `funcionarios/privado`, el
 *     catálogo y sus `contadores`), más `config/agendamiento`, `config/onboarding` y
 *     `config/campanas`, con veinte formas de ficha y los actores que pueden
 *     distinguir algo: si el recorte cambiara `tenantOperativo`, `tieneFlujo` o
 *     `tieneModulo`, acá se vería.
 * Y los CONTROLES: tres mutaciones deliberadas de las reglas de ahora (un `<` que
 * pasa a `<=`, un respaldo de `vertical` roto, un `tenantOperativo` más abierto)
 * tienen que producir diferencias: si no, la prueba no mide.
 *
 * RETIRO: la fixture se retira con esta prueba y con el control de
 * `reglas-presupuesto.test.ts` cuando el recorte lleve una versión en producción.
 * Las fichas y los valores son SINTÉTICOS.
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, deleteField, doc, getDoc, getDocs, increment, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { BORRAR, CASOS, type Caso } from './casos-config-negocio.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const AHORA = readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8');
const ANTES = readFileSync(join(aqui, 'firestore-base-previa-config-negocio.rules.txt'), 'utf8');
const PUERTO = Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231);

let entorno: RulesTestEnvironment | undefined;
const iniciar = async (reglas: string): Promise<RulesTestEnvironment> => {
  if (entorno) await entorno.cleanup();
  entorno = await initializeTestEnvironment({
    projectId: 'demo-novuchat-pruebas',
    firestore: { rules: reglas, host: '127.0.0.1', port: PUERTO },
  });
  return entorno;
};

const claims = (tenants: Record<string, string>, propietario = false, proveedor = 'password') => ({
  nc: { t: tenants, ...(propietario ? { p: true } : {}), v: 1 },
  firebase: { sign_in_provider: proveedor, identities: {} },
  email_verified: true,
});
const TS = Timestamp.fromMillis(1_700_000_000_000);

type Resultado = 'P' | 'N' | 'LIMITE';
type Mapa = Map<string, Resultado>;

/** Pasa, se niega, o se negó por quedarse sin presupuesto de expresiones. */
const resultadoDe = async (op: () => Promise<unknown>): Promise<Resultado> => {
  try { await op(); return 'P'; } catch (e) {
    const mensaje = String((e as { message?: string }).message ?? e);
    if (mensaje.includes('maximum of 1000')) return 'LIMITE';
    if (String((e as { code?: string }).code ?? e).includes('permission-denied')) return 'N';
    throw e;
  }
};

// ===========================================================================
// PARTE A — config/negocio
// ===========================================================================
const FICHA_VENTA = { creadoEn: TS, estado: 'activo', flujos: ['venta'], vertical: 'venta', nombre: 'Q', plan: 'crecimiento' };

async function matrizNegocio(reglas: string, casos: Caso[]): Promise<Mapa> {
  const e = await iniciar(reglas);
  const fs = e.authenticatedContext('u-q', claims({ q: 'admin' })).firestore();
  const salida: Mapa = new Map();
  for (const c of casos) {
    await e.clearFirestore();
    await e.withSecurityRulesDisabled(async (cx) => {
      if (c.ficha !== null) await setDoc(doc(cx.firestore(), 'tenants/q'), c.ficha === undefined ? FICHA_VENTA : { creadoEn: TS, nombre: 'Q', plan: 'crecimiento', ...c.ficha });
      await setDoc(doc(cx.firestore(), 'tenants/q/config/negocio'), { ...c.semilla, actualizadoPor: 's', actualizadoEn: TS });
    });
    const parche: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(c.parche)) parche[k] = v === BORRAR ? deleteField() : v;
    const sello = c.sinSello ? {} : { actualizadoPor: c.otroUid ? 'otro' : 'u-q', actualizadoEn: serverTimestamp() };
    salida.set(c.nombre, await resultadoDe(() => updateDoc(doc(fs, 'tenants/q/config/negocio'), { ...parche, ...sello })));
  }
  return salida;
}

// ===========================================================================
// PARTE B — otros documentos que usan estadoTenant / flujosTenant
// ===========================================================================
const base = { creadoEn: TS, creadoPor: 'u-sintetico', estado: 'activo', plan: 'crecimiento', waPhoneNumberId: 'pnid-sintetico', waWabaId: 'waba-sintetica', nombre: 'Ficha sintetica' };
const FICHAS: Record<string, Record<string, unknown> | null> = {
  venta: { ...base, flujos: ['venta'], vertical: 'venta' },
  agenda: { ...base, flujos: ['agendamiento'], vertical: 'agendamiento' },
  doble: { ...base, flujos: ['agendamiento', 'venta'], vertical: 'agendamiento' },
  onboarding: { ...base, flujos: ['onboarding'], vertical: 'onboarding' },
  triple: { ...base, flujos: ['agendamiento', 'venta', 'onboarding'], vertical: 'venta' },
  soloVerticalVenta: { ...base, vertical: 'venta' },
  soloVerticalAgenda: { ...base, vertical: 'agendamiento' },
  soloVerticalOnb: { ...base, vertical: 'onboarding' },
  sinNada: { ...base },
  flujosNull: { ...base, flujos: null, vertical: 'agendamiento' },
  flujosMapa: { ...base, flujos: { venta: true, agendamiento: true }, vertical: 'venta' },
  flujosCadena: { ...base, flujos: 'venta', vertical: 'venta' },
  flujosVacia: { ...base, flujos: [], vertical: 'agendamiento' },
  suspendidaVenta: { ...base, estado: 'suspendido', flujos: ['venta'], vertical: 'venta' },
  suspendidaAgenda: { ...base, estado: 'suspendido', flujos: ['agendamiento'], vertical: 'agendamiento' },
  baja: { ...base, estado: 'dado_de_baja', flujos: ['agendamiento', 'venta', 'onboarding'], vertical: 'venta' },
  estadoNulo: { ...base, estado: null, flujos: ['venta'] },
  estadoAusente: (({ estado: _e, ...resto }) => ({ ...resto, flujos: ['venta'] }))(base),
  modulosLista: { ...base, flujos: ['venta'], modulos: ['pedidos', 'catalogo-web', 'productos', 'campanas'] },
  modulosSoloAgenda: { ...base, flujos: ['venta'], modulos: ['agenda'] },
  modulosVacia: { ...base, flujos: ['agendamiento', 'venta'], modulos: [] },
  modulosMapa: { ...base, flujos: ['venta'], modulos: { agenda: true } },
  modulosCadena: { ...base, flujos: ['agendamiento'], modulos: 'agenda' },
  modulosNulo: { ...base, flujos: ['agendamiento'], modulos: null },
  inexistente: null,
};

const sello = (uid: string) => ({ actualizadoPor: uid, actualizadoEn: serverTimestamp() });
type Fs = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
type Actor = 'admin' | 'oper' | 'propietario';
type Op = {
  id: string; actor: Actor;
  prep?: (db: Fs) => Promise<void>;
  correr: (fs: Fs, uid: string) => Promise<unknown>;
};
const R = (p: string) => `tenants/t/${p}`;
const borrarSinReglas = (db: Fs, ruta: string) => deleteDoc(doc(db, ruta));

const OPS: Op[] = [
  // Documentos de flujo: escribe el administrador, y se leen con cada rol.
  { id: 'update config/venta', actor: 'admin', correr: (fs, u) => updateDoc(doc(fs, R('config/venta')), { costoDelivery: 12, ...sello(u) }) },
  { id: 'update config/agendamiento', actor: 'admin', correr: (fs, u) => updateDoc(doc(fs, R('config/agendamiento')), { duracionPorDefectoMin: 30, ...sello(u) }) },
  { id: 'update config/onboarding', actor: 'admin', correr: (fs, u) => updateDoc(doc(fs, R('config/onboarding')), { topeAviso: 30, ...sello(u) }) },
  { id: 'update config/marca', actor: 'admin', correr: (fs, u) => updateDoc(doc(fs, R('config/marca')), { logo: 'data:image/png;base64,AAAA', ...sello(u) }) },
  { id: 'create config/marca', actor: 'admin', prep: (db) => borrarSinReglas(db, R('config/marca')),
    correr: (fs, u) => setDoc(doc(fs, R('config/marca')), { logo: 'data:image/png;base64,AAAA', ...sello(u) }) },
  { id: 'update config/campanas', actor: 'admin', correr: (fs, u) => setDoc(doc(fs, R('config/campanas')), { lista: [], ...sello(u) }) },
  { id: 'update config/negocio catalogoWebActivo=true', actor: 'admin', correr: (fs, u) => updateDoc(doc(fs, R('config/negocio')), { catalogoWebActivo: true, ...sello(u) }) },
  { id: 'update config/negocio catalogoWebActivo=false', actor: 'admin', correr: (fs, u) => updateDoc(doc(fs, R('config/negocio')), { catalogoWebActivo: false, ...sello(u) }) },
  { id: 'update config/negocio direccion', actor: 'admin', correr: (fs, u) => updateDoc(doc(fs, R('config/negocio')), { direccion: 'Otra 1', ...sello(u) }) },
  { id: 'update config/negocio direccion (propietario)', actor: 'propietario', correr: (fs, u) => updateDoc(doc(fs, R('config/negocio')), { direccion: 'Otra 1', ...sello(u) }) },
  // Catálogo y contadores.
  { id: 'update catalogo/item1', actor: 'admin', correr: (fs, u) => updateDoc(doc(fs, R('catalogo/item1')), { precio: 95, ...sello(u) }) },
  { id: 'create catalogo/nuevo + contador', actor: 'admin', prep: (db) => borrarSinReglas(db, R('catalogo/nuevo')),
    correr: (fs, u) => {
      const l = writeBatch(fs);
      l.set(doc(fs, R('catalogo/nuevo')), { nombre: 'Torta', precio: 90, moneda: 'BOB', activo: true, ...sello(u) });
      l.update(doc(fs, R('contadores/catalogo')), { items: increment(1), ultimoItem: 'nuevo', actualizadoEn: serverTimestamp() });
      return l.commit();
    } },
  { id: 'update contadores/catalogo (suelto)', actor: 'admin', correr: (fs) => updateDoc(doc(fs, R('contadores/catalogo')), { items: increment(1), ultimoItem: 'x', actualizadoEn: serverTimestamp() }) },
  { id: 'create fotosCatalogo/item1', actor: 'admin', correr: (fs, u) => setDoc(doc(fs, R('fotosCatalogo/item1')),
      { datos: 'data:image/webp;base64,AAAABBBB', ancho: 9, alto: 9, bytes: 9, tipo: 'image/webp', ...sello(u) }) },
  // Funcionarios y datos privados.
  { id: 'update funcionarios/f1/privado/datos', actor: 'admin', correr: (fs, u) => updateDoc(doc(fs, R('funcionarios/f1/privado/datos')), { telefono: '70000010', ...sello(u) }) },
  { id: 'create funcionarios/f1/privado/otro', actor: 'admin', correr: (fs, u) => setDoc(doc(fs, R('funcionarios/f1/privado/otro')), { telefono: '70000011', ...sello(u) }) },
  { id: 'create funcionarios/nuevo', actor: 'admin', correr: (fs, u) => setDoc(doc(fs, R('funcionarios/nuevo')),
      { nombre: 'Ana', especialidad: '', calendarioId: '', horarioTrabajo: {}, servicios: [], activo: true, ...sello(u) }) },
  // Lecturas: `tenantLegible` y las capacidades.
  { id: 'get config/venta (oper)', actor: 'oper', correr: (fs) => getDoc(doc(fs, R('config/venta'))) },
  { id: 'get config/marca (oper)', actor: 'oper', correr: (fs) => getDoc(doc(fs, R('config/marca'))) },
  { id: 'get config/negocio (oper)', actor: 'oper', correr: (fs) => getDoc(doc(fs, R('config/negocio'))) },
  { id: 'get config/onboarding (oper)', actor: 'oper', correr: (fs) => getDoc(doc(fs, R('config/onboarding'))) },
  { id: 'get funcionarios/f1/privado/datos (admin)', actor: 'admin', correr: (fs) => getDoc(doc(fs, R('funcionarios/f1/privado/datos'))) },
  { id: 'list catalogo (oper)', actor: 'oper', correr: (fs) => getDocs(collection(fs, R('catalogo'))) },
  { id: 'get contadores/catalogo (oper)', actor: 'oper', correr: (fs) => getDoc(doc(fs, R('contadores/catalogo'))) },
  { id: 'update config/venta (oper)', actor: 'oper', correr: (fs, u) => updateDoc(doc(fs, R('config/venta')), { costoDelivery: 12, ...sello(u) }) },
];

async function sembrarTenant(e: RulesTestEnvironment, ficha: Record<string, unknown> | null): Promise<void> {
  await e.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const ts = Timestamp.now();
    const r = (p: string) => doc(db, R(p));
    if (ficha) await setDoc(doc(db, 'tenants/t'), ficha); else await deleteDoc(doc(db, 'tenants/t'));
    await setDoc(r('cuenta/estado'), { plan: 'pro', estadoPago: 'al_dia' });
    await setDoc(r('config/negocio'), { nombreNegocio: 't', direccion: 'Calle Falsa 100', tratamiento: 'usted', estiloEmojis: 'pocos', actualizadoPor: 'seed', actualizadoEn: ts });
    await setDoc(r('config/agendamiento'), { duracionPorDefectoMin: 45, anticipacionMinimaMin: 60, anticipacionMaximaDias: 60, permitirCancelacion: true, horasRecordatorio: 24, actualizadoPor: 'seed', actualizadoEn: ts });
    await setDoc(r('config/venta'), { costoDelivery: 10, recargoFlota: 5, radioEntregaKm: 5, tiempoCocinaMin: 20, tiempoDespachoMin: 30, pedidoMinimo: 30, aceptaDelivery: true, aceptaRetiroEnLocal: true, actualizadoPor: 'seed', actualizadoEn: ts });
    await setDoc(r('config/marca'), { logo: '', actualizadoPor: 'seed', actualizadoEn: ts });
    await setDoc(r('config/onboarding'), { topeAviso: 25, plantillaAviso: 'solicitud_contacto', actualizadoPor: 'seed', actualizadoEn: ts });
    await setDoc(r('config/campanas'), { lista: [], actualizadoPor: 'seed', actualizadoEn: ts });
    await setDoc(r('catalogo/item1'), { nombre: 'Corte', precio: 50, moneda: 'BOB', activo: true, actualizadoPor: 'seed', actualizadoEn: ts });
    await setDoc(r('contadores/catalogo'), { items: 1, ultimoItem: 'item1', actualizadoEn: ts });
    await setDoc(r('funcionarios/f1'), { nombre: 'Dra. Rojas', especialidad: 'Odontologia', calendarioId: '', horarioTrabajo: { mar: '14:00-18:00' }, servicios: [], activo: true, actualizadoPor: 'seed', actualizadoEn: ts });
    await setDoc(r('funcionarios/f1/privado/datos'), { telefono: '70000009', correo: 'x@ejemplo.com', actualizadoPor: 'seed', actualizadoEn: ts });
  });
}

const contextoDe = (e: RulesTestEnvironment, actor: Actor) => {
  switch (actor) {
    case 'admin': return e.authenticatedContext('u-admin-t', claims({ t: 'admin' }));
    case 'oper': return e.authenticatedContext('u-oper-t', claims({ t: 'oper' }));
    default: return e.authenticatedContext('u-novuchat', claims({}, true, 'google.com'));
  }
};

async function matrizOtros(reglas: string, fichas: string[], ops: Op[] = OPS): Promise<Mapa> {
  const e = await iniciar(reglas);
  const salida: Mapa = new Map();
  for (const nombre of fichas) {
    await e.clearFirestore();
    await sembrarTenant(e, FICHAS[nombre] ?? null);
    for (const op of ops) {
      if (op.prep) await e.withSecurityRulesDisabled(async (ctx) => { await op.prep!(ctx.firestore()); });
      const ctx = contextoDe(e, op.actor);
      const uid = op.actor === 'admin' ? 'u-admin-t' : op.actor === 'oper' ? 'u-oper-t' : 'u-novuchat';
      salida.set(`${nombre} | ${op.id}`, await resultadoDe(() => op.correr(ctx.firestore(), uid)));
    }
  }
  return salida;
}

// ===========================================================================
const nombresDeFichas = Object.keys(FICHAS);
let negocioAntes: Mapa;
let negocioAhora: Mapa;
let otrosAntes: Mapa;
let otrosAhora: Mapa;

/** Las claves donde la aceptación (P contra no-P) difiere. */
const diferencias = (a: Mapa, b: Mapa): string[] => [...a.keys()].filter((k) => (a.get(k) === 'P') !== (b.get(k) === 'P'));

describe('reglas: el recorte de config/negocio decide IGUAL que la base anterior', () => {
  afterAll(async () => { await entorno?.cleanup(); });

  it('parte A: config/negocio — cero diferencias de aceptación y rechazo (salvo lo que el límite impedía)', async () => {
    negocioAntes = await matrizNegocio(ANTES, CASOS);
    negocioAhora = await matrizNegocio(AHORA, CASOS);
    const difs = diferencias(negocioAntes, negocioAhora);
    const porCaso = new Map(CASOS.map((c) => [c.nombre, c]));
    console.log(
      `DIFERENCIAL config/negocio: ${CASOS.length} casos; aceptados (ahora) ${[...negocioAhora.values()].filter((v) => v === 'P').length}, `
      + `rechazados ${[...negocioAhora.values()].filter((v) => v !== 'P').length}; `
      + `antes con LIMITE de expresiones: ${[...negocioAntes.values()].filter((v) => v === 'LIMITE').length}; diferencias de aceptación: ${difs.length}`
      + (difs.length ? `\n${difs.map((k) => `  ${k}: antes ${negocioAntes.get(k)} -> ahora ${negocioAhora.get(k)}`).join('\n')}` : ''));
    // La ÚNICA diferencia admitida: lo válido que antes no cabía en el presupuesto.
    for (const k of difs) {
      expect(negocioAntes.get(k), `${k}: antes no fue por presupuesto`).toBe('LIMITE');
      expect(negocioAhora.get(k), k).toBe('P');
      expect(porCaso.get(k)?.esperado, `${k}: el caso no está declarado como válido`).toBe('P');
    }
    // Y ningún caso que el recorte rechaza por presupuesto: la mejora no puede traer su propio límite.
    expect([...negocioAhora].filter(([, v]) => v === 'LIMITE').map(([k]) => k)).toEqual([]);
    // Los casos con árbitro: ahora dan exactamente lo que merecen.
    for (const c of CASOS.filter((x) => x.esperado)) expect(negocioAhora.get(c.nombre), c.nombre).toBe(c.esperado);
    // Todo lo que no es un caso de presupuesto ya decidía igual, sin excepción: contra la base, tal cual.
    for (const c of CASOS) {
      if (negocioAntes.get(c.nombre) === 'LIMITE') continue;
      expect(negocioAhora.get(c.nombre), `${c.nombre}: antes ${negocioAntes.get(c.nombre)}`).toBe(negocioAntes.get(c.nombre));
    }
  }, 1_800_000);

  it('parte A no es trivial: hay centenares de casos aceptados y de rechazados, y los pesados', () => {
    expect(CASOS.length).toBeGreaterThanOrEqual(430);
    expect(new Set(CASOS.map((c) => c.nombre)).size, 'nombres de caso únicos').toBe(CASOS.length);
    const v = [...negocioAntes.values()];
    expect(v.filter((x) => x === 'P').length).toBeGreaterThan(80);
    // Un rechazo de las reglas de antes puede llegar etiquetado como LIMITE (el emulador reevalúa al denegar): cuenta como rechazo.
    expect(v.filter((x) => x !== 'P').length).toBeGreaterThan(300);
    // El caso del encargo: la forma de Q'Taco con siete días no cabía antes y ahora sí.
    expect(negocioAntes.get('OK:consola-7d-enciende-cw'), 'consola de 7 días antes').toBe('LIMITE');
    expect(negocioAhora.get('OK:consola-7d-enciende-cw'), 'consola de 7 días ahora').toBe('P');
  });

  it('parte B: otros documentos y fichas — cero diferencias (tenantOperativo, tieneFlujo y tieneModulo intactos)', async () => {
    otrosAntes = await matrizOtros(ANTES, nombresDeFichas);
    otrosAhora = await matrizOtros(AHORA, nombresDeFichas);
    const difs = diferencias(otrosAntes, otrosAhora);
    console.log(`DIFERENCIAL otros documentos: ${otrosAntes.size} operaciones (${nombresDeFichas.length} fichas × ${OPS.length}); `
      + `permitidas ${[...otrosAhora.values()].filter((v) => v === 'P').length}; diferencias: ${difs.length}`
      + (difs.length ? `\n${difs.map((k) => `  ${k}: antes ${otrosAntes.get(k)} -> ahora ${otrosAhora.get(k)}`).join('\n')}` : ''));
    expect(difs).toEqual([]);
    expect([...otrosAhora.values()].filter((v) => v === 'LIMITE')).toEqual([]);
  }, 1_800_000);

  it('parte B no es trivial: la matriz tiene permitidas y negadas, y mira los cinco documentos', () => {
    expect(otrosAntes.size).toBe(nombresDeFichas.length * OPS.length);
    expect([...otrosAntes.values()].filter((v) => v === 'P').length).toBeGreaterThan(100);
    expect([...otrosAntes.values()].filter((v) => v === 'N').length).toBeGreaterThan(100);
    for (const doc5 of ['config/venta', 'config/marca', 'funcionarios/f1/privado', 'catalogo', 'contadores']) {
      const ids = [...otrosAntes.keys()].filter((k) => k.includes(doc5));
      expect(ids.length, doc5).toBeGreaterThan(0);
      expect(ids.some((k) => otrosAntes.get(k) === 'P'), `${doc5}: alguna permitida`).toBe(true);
      expect(ids.some((k) => otrosAntes.get(k) === 'N'), `${doc5}: alguna negada`).toBe(true);
    }
  });

  // CONTROLES: la prueba tiene que ver un cambio de verdad. Cada mutación se aplica a las reglas de AHORA.
  const mutar = (reglas: string, de: string, a: string): string => {
    expect(reglas.split(de).length - 1, `el trozo a mutar está una vez: ${de.slice(0, 50)}`).toBe(1);
    return reglas.replace(de, a);
  };

  it('control 1: un horario `desde <= hasta` en vez de `<` SÍ lo ve la parte A', async () => {
    const mutada = mutar(AHORA, '&& v[0:5] < v[6:11]);', '&& v[0:5] <= v[6:11]);');
    const casos = CASOS.filter((c) => c.nombre.startsWith('hor='));
    const antes = await matrizNegocio(ANTES, casos);
    const ahora = await matrizNegocio(mutada, casos);
    expect(diferencias(antes, ahora), 'la mutación del horario pasó inadvertida').toContain('hor=igual');
  }, 600_000);

  it('control 2: un respaldo de `vertical` roto en flujosTenant SÍ lo ve la parte B', async () => {
    const mutada = mutar(AHORA, "[get(ruta).data.get('vertical', '')]", "['']");
    const fichas = ['soloVerticalVenta', 'soloVerticalAgenda', 'venta'];
    const antes = await matrizOtros(ANTES, fichas);
    const ahora = await matrizOtros(mutada, fichas);
    expect(diferencias(antes, ahora).filter((k) => k.startsWith('soloVertical')).length, 'la mutación de flujosTenant pasó inadvertida').toBeGreaterThan(0);
  }, 600_000);

  it('control 3: un tenantOperativo que deja pasar a la suspendida SÍ lo ve la parte B', async () => {
    const mutada = mutar(AHORA, "return estadoTenant(tenantId) == 'activo';", "return estadoTenant(tenantId) in ['activo', 'suspendido'];");
    const fichas = ['venta', 'suspendidaVenta'];
    const antes = await matrizOtros(ANTES, fichas);
    const ahora = await matrizOtros(mutada, fichas);
    expect(diferencias(antes, ahora).filter((k) => k.startsWith('suspendidaVenta')).length, 'la mutación de tenantOperativo pasó inadvertida').toBeGreaterThan(0);
  }, 600_000);

  it('control 4: la prueba no es una comparación de las reglas consigo mismas', () => {
    expect(ANTES).not.toBe(AHORA);
    expect(ANTES).toContain("return estadoTenant(tenantId) == 'activo';");
    expect(AHORA).toContain('function textosNegocioValidos(d)');
    expect(ANTES).not.toContain('function textosNegocioValidos(d)');
  });
});
