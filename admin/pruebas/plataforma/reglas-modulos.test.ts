/**
 * REGLAS DE FIRESTORE POR MÓDULO (H2b-6) — PROBADAS NEGANDO.
 *
 * Qué verifican (admin/firestore.rules):
 *   · `tieneModulo(tenantId, m)`: si la ficha trae `modulos` (una LISTA), manda;
 *     si no, se decide por `flujos` como hasta hoy (agenda ⇒ agendamiento,
 *     pedidos y catalogo-web ⇒ venta, captacion ⇒ onboarding).
 *   · `tieneModuloComun(tenantId, m)` (productos, campanas): sin `modulos`, abre
 *     como hoy; con la lista, solo si el módulo está en ella.
 *   · `funcionarios/{id}/privado` exige agenda (decisión N2 de Andres: cerrado para
 *     un administrador sin agenda).
 *   · «solo venta → no lee ni escribe `config/onboarding`», y lo mismo para cada
 *     par de flujos: la matriz de los 8 subconjuntos, por `flujos` y por `modulos`.
 *
 * LA COLECCIÓN `agenda` (el candado de citas) NO SE TOCA y no se prueba acá:
 * la prueba de siempre vive en `pruebas/reglas.test.ts` y `candado-agenda.test.ts`.
 *
 * SE ESCRIBE NEGANDO (CLAUDE.md, base comercial §7). Cada caso es una operación
 * real contra el emulador con la petición construida a mano; como una carga
 * mal armada también da «permission-denied», cada operación tiene sus
 * controles positivos (el tenant que sí la tiene) y nunca pasa en vacío.
 *
 * MUTACIONES. Al final, cada pieza nueva de las reglas se rompe a propósito
 * (devuelve true, ignora al tenant, ignora la lista, abre con un respaldo
 * desconocido, quita la exigencia de agenda en `privado`) y se vuelve a correr
 * la batería: tiene que haber al menos un caso negativo que deje pasar. Si una
 * mutación sobrevive, la batería no cubre esa pieza.
 */
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, writeBatch, increment,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS_FLUJOS, MODULOS_COMUNES_HOY, PUENTE_DE_FLUJOS } from '../../functions/src/registro.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const REGLAS = readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8');
const PROYECTO = 'demo-novuchat-pruebas';
const PUERTO = Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231);

// ---------------------------------------------------------------------------
// Entorno. La sonda es una colección que SOLO existe en esta prueba: pregunta
// por un módulo que la tabla no conoce (ver `respaldo desconocido`).
// ---------------------------------------------------------------------------
const ANCLA = '      match /config/{documento} {';
const SONDA = `      match /sonda/{x} {
        allow get: if esAdmin(tenantId) && tieneModulo(tenantId, 'desconocido');
      }
`;
const conSonda = (reglas: string): string => {
  expect(reglas.split(ANCLA).length - 1, 'el ancla de la sonda').toBe(1);
  return reglas.replace(ANCLA, `${SONDA}${ANCLA}`);
};

let entorno: RulesTestEnvironment;

const iniciar = async (reglas: string): Promise<void> => {
  if (entorno) await entorno.cleanup();
  entorno = await initializeTestEnvironment({
    projectId: PROYECTO,
    firestore: { rules: conSonda(reglas), host: '127.0.0.1', port: PUERTO },
  });
};

const claims = (tenants: Record<string, string>, propietario = false, proveedor = 'password') => ({
  nc: { t: tenants, ...(propietario ? { p: true } : {}), v: 1 },
  firebase: { sign_in_provider: proveedor, identities: {} },
  email_verified: true,
});
const comoAdmin = (t: string, en = t) =>
  entorno.authenticatedContext(`u-admin-${t}`, claims({ [en]: 'admin' })).firestore();
const comoOper = (t: string) =>
  entorno.authenticatedContext(`u-oper-${t}`, claims({ [t]: 'oper' })).firestore();
const comoPropietario = () =>
  entorno.authenticatedContext('u-novuchat', claims({}, true, 'google.com')).firestore();

const sello = (uid: string) => ({ actualizadoPor: uid, actualizadoEn: serverTimestamp() });

// ---------------------------------------------------------------------------
// Los tenants. `ficha` es lo que trae la ficha; `abre` es el ORACULO, escrito a
// mano y no derivado de las reglas: qué capacidades tiene que tener cada uno.
// ---------------------------------------------------------------------------
type Cap = 'agenda' | 'venta' | 'marca' | 'onb' | 'productos' | 'campanas';
type Tenant = { id: string; ficha: Record<string, unknown>; abre: Cap[] };

const TODAS: Cap[] = ['agenda', 'venta', 'marca', 'onb', 'productos', 'campanas'];
const FLUJOS_TODOS = ['agendamiento', 'venta', 'onboarding'];
const base = { nombre: 'x', estado: 'activo', plan: 'pro' };

const tenants: Tenant[] = [];
const agregar = (t: Tenant): void => { tenants.push(t); };

// Solo agenda / solo venta / solo onboarding, por `flujos` (la ficha de hoy).
agregar({ id: 'sa', ficha: { ...base, vertical: 'agendamiento', flujos: ['agendamiento'] },
  abre: ['agenda', 'productos', 'campanas'] });
agregar({ id: 'sv', ficha: { ...base, vertical: 'venta', flujos: ['venta'] },
  abre: ['venta', 'marca', 'productos', 'campanas'] });
agregar({ id: 'so', ficha: { ...base, vertical: 'onboarding', flujos: ['onboarding'] },
  abre: ['onb', 'productos', 'campanas'] });
// Ficha vieja: sin `flujos`, solo `vertical`.
agregar({ id: 'sl', ficha: { ...base, vertical: 'venta' },
  abre: ['venta', 'marca', 'productos', 'campanas'] });
// Con `modulos` que no es lista (cadena): no se lee, manda `flujos`.
agregar({ id: 'mx', ficha: { ...base, flujos: ['venta'], modulos: 'agenda' },
  abre: ['venta', 'marca', 'productos', 'campanas'] });
// Con `modulos` solo agenda (ni catalogo, ni campañas, ni venta).
agregar({ id: 'ma', ficha: { ...base, flujos: FLUJOS_TODOS, modulos: ['agenda'] }, abre: ['agenda'] });
// Con `modulos` sin agenda.
agregar({ id: 'mp', ficha: { ...base, flujos: FLUJOS_TODOS, modulos: ['pedidos', 'captacion', 'productos', 'campanas'] },
  abre: ['venta', 'onb', 'productos', 'campanas'] });
// Con `modulos` vacío: nada.
agregar({ id: 'mv', ficha: { ...base, flujos: FLUJOS_TODOS, modulos: [] }, abre: [] });
// Solo catalogo-web: el logo sí, la configuración de venta no.
agregar({ id: 'mc', ficha: { ...base, flujos: FLUJOS_TODOS, modulos: ['catalogo-web'] }, abre: ['marca'] });
// Todos los módulos.
agregar({ id: 'ab', ficha: { ...base, flujos: [], modulos: ['agenda', 'pedidos', 'catalogo-web', 'captacion', 'productos', 'campanas'] },
  abre: TODAS });

// La matriz de los 8 subconjuntos, por `flujos` y por `modulos`.
for (const bits of ['000', '100', '010', '001', '110', '101', '011', '111']) {
  const [a, v, o] = bits.split('').map((b) => b === '1');
  const flujos = [a && 'agendamiento', v && 'venta', o && 'onboarding'].filter(Boolean);
  const modulos = [a && 'agenda', v && 'pedidos', v && 'catalogo-web', o && 'captacion',
    'productos', 'campanas'].filter(Boolean);
  const abre: Cap[] = ['productos', 'campanas'];
  if (a) abre.push('agenda');
  if (v) abre.push('venta', 'marca');
  if (o) abre.push('onb');
  // Por `flujos`: la ficha de hoy, sin `modulos`.
  agregar({ id: `f${bits}`, ficha: { ...base, flujos }, abre });
  // Por `modulos`: `flujos` dice TODO a propósito; solo la lista puede explicar el resultado.
  agregar({ id: `m${bits}`, ficha: { ...base, flujos: FLUJOS_TODOS, modulos }, abre });
}

const porId = (id: string): Tenant => tenants.find((t) => t.id === id) as Tenant;

// ---------------------------------------------------------------------------
// Semilla de UN tenant: se repone antes de cada caso para que ninguno dependa
// del anterior (las altas de catálogo mueven el contador).
// ---------------------------------------------------------------------------
const sembrar = async (t: Tenant): Promise<void> => {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const r = (p: string) => doc(db, `tenants/${t.id}/${p}`);
    const ahora = Timestamp.now();
    await setDoc(doc(db, 'tenants', t.id), t.ficha);
    await setDoc(r('cuenta/estado'), { plan: 'pro' });
    await setDoc(r('config/negocio'), {
      nombreNegocio: t.id, direccion: 'Calle Falsa 100', tratamiento: 'usted',
      estiloEmojis: 'pocos', actualizadoPor: 'seed', actualizadoEn: ahora,
    });
    await setDoc(r('config/agendamiento'), {
      duracionPorDefectoMin: 45, anticipacionMinimaMin: 60, anticipacionMaximaDias: 60,
      permitirCancelacion: true, horasRecordatorio: 24, actualizadoPor: 'seed', actualizadoEn: ahora,
    });
    await setDoc(r('config/venta'), {
      costoDelivery: 10, recargoFlota: 5, radioEntregaKm: 5, tiempoCocinaMin: 20,
      tiempoDespachoMin: 30, pedidoMinimo: 30, aceptaDelivery: true, aceptaRetiroEnLocal: true,
      actualizadoPor: 'seed', actualizadoEn: ahora,
    });
    await setDoc(r('config/marca'), { logo: '', actualizadoPor: 'seed', actualizadoEn: ahora });
    await setDoc(r('config/onboarding'), {
      topeAviso: 25, plantillaAviso: 'solicitud_contacto', actualizadoPor: 'seed', actualizadoEn: ahora,
    });
    await setDoc(r('catalogo/item1'), {
      nombre: 'Corte', precio: 50, moneda: 'BOB', activo: true, actualizadoPor: 'seed', actualizadoEn: ahora,
    });
    await deleteDoc(r('catalogo/nuevo'));
    await setDoc(r('contadores/catalogo'), { items: 1, ultimoItem: 'item1', actualizadoEn: ahora });
    await setDoc(r('funcionarios/f1'), {
      nombre: 'Dra. Rojas', especialidad: 'Odontologia', calendarioId: '',
      horarioTrabajo: { mar: '14:00-18:00' }, servicios: [], activo: true,
      actualizadoPor: 'seed', actualizadoEn: ahora,
    });
    await deleteDoc(r('funcionarios/nuevo'));
    await setDoc(r('funcionarios/f1/privado/datos'), {
      telefono: '70000009', correo: 'rojas@ejemplo.com', actualizadoPor: 'seed', actualizadoEn: ahora,
    });
    await deleteDoc(r('config/campanas'));
    await deleteDoc(r('fotosCatalogo/item1'));
  });
};

// ---------------------------------------------------------------------------
// Las operaciones. Cada una es la petición que haría un navegador.
// ---------------------------------------------------------------------------
type Operacion = {
  nombre: string; cap: Cap | 'catalogoWebActivo';
  /** Deja el estado que la operación necesita (corre después de `sembrar`, sin reglas). */
  prep?: (t: string) => Promise<void>;
  ejecutar: (t: string) => Promise<unknown>;
};
/** Lo que el oráculo espera de cada operación para un tenant. `catalogoWebActivo` (config/negocio) se decide HOY por `flujos`, no por `modulos`: TODO(H2b) con el PR que escriba `modulos`. */
const abreOp = (t: Tenant, cap: Operacion['cap']): boolean => {
  if (cap !== 'catalogoWebActivo') return t.abre.includes(cap);
  const f = t.ficha['flujos'];
  return Array.isArray(f) ? f.includes('venta') : t.ficha['vertical'] === 'venta';
};
const T = (t: string, p: string): string => `tenants/${t}/${p}`;

const operaciones: Operacion[] = [
  { nombre: 'el administrador edita config/agendamiento', cap: 'agenda',
    ejecutar: (t) => updateDoc(doc(comoAdmin(t), T(t, 'config/agendamiento')),
      { duracionPorDefectoMin: 30, ...sello(`u-admin-${t}`) }) },
  { nombre: 'el administrador crea un funcionario', cap: 'agenda',
    ejecutar: (t) => setDoc(doc(comoAdmin(t), T(t, 'funcionarios/nuevo')), {
      nombre: 'Ana', especialidad: '', calendarioId: '', horarioTrabajo: {}, servicios: [],
      activo: true, ...sello(`u-admin-${t}`) }) },
  { nombre: 'el administrador escribe funcionarios/*/privado (update)', cap: 'agenda',
    ejecutar: (t) => updateDoc(doc(comoAdmin(t), T(t, 'funcionarios/f1/privado/datos')),
      { telefono: '70000010', ...sello(`u-admin-${t}`) }) },
  { nombre: 'el administrador escribe funcionarios/*/privado (create)', cap: 'agenda',
    ejecutar: (t) => setDoc(doc(comoAdmin(t), T(t, 'funcionarios/f1/privado/otro')),
      { telefono: '70000011', ...sello(`u-admin-${t}`) }) },
  { nombre: 'el administrador edita config/venta', cap: 'venta',
    ejecutar: (t) => updateDoc(doc(comoAdmin(t), T(t, 'config/venta')),
      { costoDelivery: 12, ...sello(`u-admin-${t}`) }) },
  { nombre: 'el administrador cambia el logo (config/marca)', cap: 'marca',
    ejecutar: (t) => updateDoc(doc(comoAdmin(t), T(t, 'config/marca')),
      { logo: 'data:image/png;base64,AAAA', ...sello(`u-admin-${t}`) }) },
  { nombre: 'el administrador enciende el catálogo web en config/negocio', cap: 'catalogoWebActivo',
    ejecutar: (t) => updateDoc(doc(comoAdmin(t), T(t, 'config/negocio')),
      { catalogoWebActivo: true, ...sello(`u-admin-${t}`) }) },
  { nombre: 'el administrador edita config/onboarding', cap: 'onb',
    ejecutar: (t) => updateDoc(doc(comoAdmin(t), T(t, 'config/onboarding')),
      { topeAviso: 30, ...sello(`u-admin-${t}`) }) },
  { nombre: 'el propietario edita config/onboarding', cap: 'onb',
    ejecutar: (t) => setDoc(doc(comoPropietario(), T(t, 'config/onboarding')),
      { topeAviso: 30, ...sello('u-novuchat') }, { merge: true }) },
  { nombre: 'el administrador CREA config/marca (el logo nace con el primer upload)', cap: 'marca',
    prep: async (t) => { await entorno.withSecurityRulesDisabled(async (ctx) => { await deleteDoc(doc(ctx.firestore(), T(t, 'config/marca'))); }); },
    ejecutar: (t) => setDoc(doc(comoAdmin(t), T(t, 'config/marca')),
      { logo: 'data:image/png;base64,AAAA', ...sello(`u-admin-${t}`) }) },
  { nombre: 'el administrador BORRA la foto de un producto', cap: 'productos',
    prep: async (t) => { await entorno.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), T(t, 'fotosCatalogo/item1')), {
        datos: 'data:image/webp;base64,AAAABBBB', ancho: 9, alto: 9, bytes: 9, tipo: 'image/webp',
        actualizadoPor: 'seed', actualizadoEn: Timestamp.now() }); }); },
    ejecutar: (t) => deleteDoc(doc(comoAdmin(t), T(t, 'fotosCatalogo/item1'))) },
  { nombre: 'el administrador da de BAJA un producto (catálogo + contador)', cap: 'productos',
    ejecutar: (t) => {
      const fs = comoAdmin(t);
      const lote = writeBatch(fs);
      lote.delete(doc(fs, T(t, 'catalogo/item1')));
      lote.update(doc(fs, T(t, 'contadores/catalogo')),
        { items: increment(-1), ultimoItem: 'item1', actualizadoEn: serverTimestamp() });
      return lote.commit();
    } },
  { nombre: 'el propietario lee config/onboarding', cap: 'onb',
    ejecutar: (t) => getDoc(doc(comoPropietario(), T(t, 'config/onboarding'))) },
  { nombre: 'el administrador da de alta un producto (catálogo + contador)', cap: 'productos',
    ejecutar: (t) => {
      const fs = comoAdmin(t);
      const lote = writeBatch(fs);
      lote.set(doc(fs, T(t, 'catalogo/nuevo')), {
        nombre: 'Torta', precio: 90, moneda: 'BOB', activo: true, ...sello(`u-admin-${t}`) });
      lote.update(doc(fs, T(t, 'contadores/catalogo')),
        { items: increment(1), ultimoItem: 'nuevo', actualizadoEn: serverTimestamp() });
      return lote.commit();
    } },
  { nombre: 'el administrador edita un producto', cap: 'productos',
    ejecutar: (t) => updateDoc(doc(comoAdmin(t), T(t, 'catalogo/item1')),
      { precio: 95, ...sello(`u-admin-${t}`) }) },
  { nombre: 'el administrador sube la foto de un producto', cap: 'productos',
    ejecutar: (t) => setDoc(doc(comoAdmin(t), T(t, 'fotosCatalogo/item1')), {
      datos: 'data:image/webp;base64,AAAABBBB', ancho: 900, alto: 675, bytes: 1000,
      tipo: 'image/webp', ...sello(`u-admin-${t}`) }) },
  { nombre: 'el administrador guarda config/campanas', cap: 'campanas',
    ejecutar: (t) => setDoc(doc(comoAdmin(t), T(t, 'config/campanas')),
      { lista: [], ...sello(`u-admin-${t}`) }) },
];

/** Corre una operación y dice si las reglas la dejaron pasar. */
const permitida = async (op: () => Promise<unknown>): Promise<boolean> => {
  try { await op(); return true; } catch (e) {
    if (String((e as { code?: string }).code ?? e).includes('permission-denied')) return false;
    throw e;
  }
};

type Caso = { nombre: string; esperado: boolean; correr: () => Promise<boolean> };

/** La batería completa: tenant × operación, más los casos sueltos. */
const casos = (nucleo = false): Caso[] => {
  const lista: Caso[] = [];
  // `nucleo` deja afuera la matriz de los 8 subconjuntos (ya corre entera en la
  // línea base): las mutaciones se miden con los tenants con nombre, que bastan
  // para delatar cada una y cuestan un tercio del tiempo.
  for (const t of tenants.filter((x) => !nucleo || !/^[fm][01]{3}$/.test(x.id))) {
    for (const op of operaciones) {
      lista.push({
        nombre: `${t.id}: ${op.nombre}`,
        esperado: abreOp(t, op.cap),
        correr: async () => {
          await sembrar(t);
          if (op.prep) await op.prep(t.id);
          return permitida(() => op.ejecutar(t.id));
        },
      });
    }
  }
  const ab = porId('ab');
  const mv = porId('mv');
  const ma = porId('ma');
  const sa = porId('sa');
  // Controles que no dependen de ningún módulo: la configuración común sigue
  // abierta aunque `modulos` esté vacío (no se rompió lo que no se debía tocar).
  lista.push({
    nombre: 'mv: sin módulos, el administrador sí edita config/negocio (control)',
    esperado: true,
    correr: async () => { await sembrar(mv); return permitida(() => updateDoc(doc(comoAdmin('mv'), T('mv', 'config/negocio')),
      { catalogoWebActivo: false, ...sello('u-admin-mv') })); },
  });
  // Un operador nunca escribe, ni con todos los módulos.
  lista.push({
    nombre: 'ab: un OPERADOR no edita config/venta aunque el comercio tenga el módulo',
    esperado: false,
    correr: async () => { await sembrar(ab); return permitida(() => updateDoc(doc(comoOper('ab'), T('ab', 'config/venta')),
      { costoDelivery: 12, ...sello('u-oper-ab') })); },
  });
  lista.push({
    nombre: 'ab: un OPERADOR no escribe funcionarios/*/privado',
    esperado: false,
    correr: async () => { await sembrar(ab); return permitida(() => updateDoc(doc(comoOper('ab'), T('ab', 'funcionarios/f1/privado/datos')),
      { telefono: '70000010', ...sello('u-oper-ab') })); },
  });
  // Aislamiento entre tenants: ni con todos los módulos del ajeno.
  lista.push({
    nombre: 'aislamiento: el administrador de ma no escribe config/venta de ab',
    esperado: false,
    correr: async () => { await sembrar(ab); await sembrar(ma);
      return permitida(() => updateDoc(doc(comoAdmin('ma', 'ma'), T('ab', 'config/venta')),
        { costoDelivery: 12, ...sello('u-admin-ma') })); },
  });
  lista.push({
    nombre: 'aislamiento: el administrador de sa no escribe funcionarios/*/privado de ab',
    esperado: false,
    correr: async () => { await sembrar(ab); await sembrar(sa);
      return permitida(() => updateDoc(doc(comoAdmin('sa'), T('ab', 'funcionarios/f1/privado/datos')),
        { telefono: '70000010', ...sello('u-admin-sa') })); },
  });
  // Un tenant sin ficha no abre nada (ni con un rol que dice ser su admin).
  lista.push({
    nombre: 'un tenant SIN ficha no abre config/agendamiento ni productos',
    esperado: false,
    correr: async () => {
      await entorno.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), T('fantasma', 'config/agendamiento')),
          { duracionPorDefectoMin: 45, actualizadoPor: 'seed', actualizadoEn: Timestamp.now() });
      });
      const a = await permitida(() => updateDoc(doc(comoAdmin('fantasma'), T('fantasma', 'config/agendamiento')),
        { duracionPorDefectoMin: 30, ...sello('u-admin-fantasma') }));
      const b = await permitida(() => setDoc(doc(comoAdmin('fantasma'), T('fantasma', 'fotosCatalogo/i')), {
        datos: 'data:image/webp;base64,AAAABBBB', ancho: 9, alto: 9, bytes: 9, tipo: 'image/webp',
        ...sello('u-admin-fantasma') }));
      return a || b;
    },
  });
  // Respaldo desconocido: la sonda pregunta por un módulo que la tabla no
  // conoce. Tiene que negar en TODA ficha: con lista (sin ese módulo), con
  // `flujos`, y sobre todo con una ficha vacía, donde `''` está «en» `['']`.
  const sonda = (t: Tenant) => async () => {
    await sembrar(t);
    return permitida(() => getDoc(doc(comoAdmin(t.id), T(t.id, 'sonda/s'))));
  };
  const vacio: Tenant = { id: 'vacio', ficha: { ...base }, abre: [] };
  const vacioFlujos: Tenant = { id: 'vacio2', ficha: { ...base, flujos: [''] }, abre: [] };
  for (const t of [vacio, vacioFlujos, ab, porId('sv'), porId('mx')]) {
    lista.push({ nombre: `${t.id}: un módulo desconocido niega (respaldo null)`, esperado: false, correr: sonda(t) });
  }
  return lista;
};

/** Corre toda la batería y devuelve los casos cuyo resultado no es el esperado. */
type Violado = { texto: string; esperado: boolean };
const violados = async (): Promise<Violado[]> => {
  const malos: Violado[] = [];
  for (const c of casos(true)) {
    if ((await c.correr()) !== c.esperado) {
      malos.push({ texto: `${c.nombre} (esperado ${c.esperado ? 'permite' : 'niega'})`, esperado: c.esperado });
    }
  }
  return malos;
};

// ---------------------------------------------------------------------------
describe('reglas por módulo: batería de capacidades (emulador)', () => {
  beforeAll(async () => { await iniciar(REGLAS); });
  afterAll(async () => { await entorno?.cleanup(); });

  // Un `it` por caso: un fallo dice cuál. Se generan al cargar el archivo.
  // (El entorno se crea en `beforeAll`: `casos()` solo arma las funciones.)
  for (const c of casos()) {
    it(`${c.esperado ? 'PERMITE' : 'NIEGA'} · ${c.nombre}`, async () => {
      expect(await c.correr()).toBe(c.esperado);
    });
  }

  it('el oráculo no es vacío: hay casos que permiten y casos que niegan por cada operación', () => {
    for (const op of operaciones) {
      const permiten = tenants.filter((t) => abreOp(t, op.cap)).length;
      expect(permiten, `${op.nombre}: tenants que la abren`).toBeGreaterThan(0);
      expect(tenants.length - permiten, `${op.nombre}: tenants que la niegan`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Cada mutación rompe UNA pieza de las reglas. La batería tiene que notarlo.
// ---------------------------------------------------------------------------

/** Aplica `cambio` solo dentro del cuerpo de la función `nombre` (4 espacios de sangría). */
const mutarFuncion = (reglas: string, nombre: string, cambio: (cuerpo: string) => string): string => {
  const inicio = reglas.indexOf(`    function ${nombre}(`);
  expect(inicio, `función ${nombre}`).toBeGreaterThan(-1);
  const fin = reglas.indexOf('\n    }\n', inicio) + '\n    }\n'.length;
  const cuerpo = reglas.slice(inicio, fin);
  const nuevo = cambio(cuerpo);
  expect(nuevo, `la mutación de ${nombre} cambia algo`).not.toBe(cuerpo);
  return reglas.slice(0, inicio) + nuevo + reglas.slice(fin);
};

/** Cambia UN trozo exacto de las reglas (falla si no está una sola vez). */
const sustituir = (trozo: string, por: string): string => {
  expect(REGLAS.split(trozo).length - 1, `el trozo a mutar está una vez: ${trozo.slice(0, 50)}`).toBe(1);
  return REGLAS.replace(trozo, por);
};

const mutaciones: Array<{ nombre: string; reglas: () => string }> = [
  { nombre: 'tieneModulo devuelve true',
    reglas: () => mutarFuncion(REGLAS, 'tieneModulo', (c) => c.replace(/return [\s\S]*;\n\s*\}\n$/, 'return true;\n    }\n')) },
  { nombre: 'tieneModulo ignora al tenant (mira siempre la ficha del de todos los módulos)',
    reglas: () => mutarFuncion(REGLAS, 'tieneModulo', (c) => c.replace('tenants/$(tenantId)', 'tenants/ab')) },
  { nombre: 'tieneModulo ignora la lista `modulos`',
    reglas: () => mutarFuncion(REGLAS, 'tieneModulo', (c) => c.replace(".get('modulos', null) is list", ".get('modulos', null) is string")) },
  { nombre: 'tieneModulo: con respaldo desconocido abre (la tabla ya no cierra con false)',
    reglas: () => mutarFuncion(REGLAS, 'tieneModulo', (c) => c.replace(': false);', ": tieneFlujo(tenantId, ''));")) },
  { nombre: 'tieneModuloComun devuelve true',
    reglas: () => mutarFuncion(REGLAS, 'tieneModuloComun', (c) => c.replace('return !(', 'return true || !(')) },
  { nombre: 'tieneModuloComun ignora al tenant (mira siempre al de todos los módulos)',
    reglas: () => mutarFuncion(REGLAS, 'tieneModuloComun', (c) => c.replaceAll('tenants/$(tenantId)', 'tenants/ab')) },
  { nombre: 'tieneModuloComun ignora la lista `modulos`',
    reglas: () => mutarFuncion(REGLAS, 'tieneModuloComun', (c) => c.replace(".get('modulos', null) is list", ".get('modulos', null) is string")) },
  { nombre: 'funcionarios/*/privado deja de exigir agenda',
    reglas: () => {
      const trozo = '                                && tieneAgenda(tenantId)\n                                && datosPersonalesValidos();';
      expect(REGLAS.split(trozo).length - 1).toBe(1);
      return REGLAS.replace(trozo, '                                && datosPersonalesValidos();');
    } },
  { nombre: 'tieneAgenda vuelve a leer solo `flujos` (ignora modulos)',
    reglas: () => mutarFuncion(REGLAS, 'tieneAgenda', (c) => c.replace("tieneModulo(tenantId, 'agenda')", "tieneFlujo(tenantId, 'agendamiento')")) },
  { nombre: 'tieneOnboarding vuelve a leer solo `flujos` (ignora modulos)',
    reglas: () => mutarFuncion(REGLAS, 'tieneOnboarding', (c) => c.replace("tieneModulo(tenantId, 'captacion')", "tieneFlujo(tenantId, 'onboarding')")) },
  { nombre: 'catalogo-web (config/marca) se abre con cualquier ficha',
    reglas: () => REGLAS.replaceAll("tieneModulo(tenantId, 'catalogo-web')", 'true') },
  { nombre: 'catálogo: se quita la exigencia del módulo productos',
    reglas: () => REGLAS.replaceAll("&& tieneModuloComun(tenantId, 'productos')", '') },
  { nombre: 'config/marca (CREATE): se quita la exigencia de catalogo-web',
    reglas: () => sustituir("documento == 'marca' && tieneModulo(tenantId, 'catalogo-web')\n                      && logoValido();",
      "documento == 'marca' && logoValido();") },
  { nombre: 'fotosCatalogo (DELETE): se quita la exigencia de productos',
    reglas: () => sustituir("allow delete: if esAdmin(tenantId) && tenantOperativo(tenantId)\n                      && tieneModuloComun(tenantId, 'productos');",
      'allow delete: if esAdmin(tenantId) && tenantOperativo(tenantId);') },
  // El alta y la baja de un producto van SIEMPRE con el contador en el mismo
  // lote, y las dos reglas (la del producto y la del contador) exigen
  // `productos` por su cuenta: quitar la exigencia de UNA sola es una mutación
  // equivalente, no observable (la otra sigue negando). Es defensa en
  // profundidad. Quitarlas de las dos (la mutación de arriba, que las borra
  // todas) sí se detecta, con la edición suelta del producto y las fotos.
  { nombre: 'campañas: se quita la exigencia del módulo campanas',
    reglas: () => REGLAS.replaceAll("&& tieneModuloComun(tenantId, 'campanas')", '') },
];

describe('reglas por módulo: mutaciones (cada una debe dejar pasar una negativa)', () => {
  afterAll(async () => { await entorno?.cleanup(); });

  it('la batería sin mutar no tiene ningún caso violado (línea base de las mutaciones)', async () => {
    await iniciar(REGLAS);
    expect(await violados()).toEqual([]);
  }, 600_000);

  for (const m of mutaciones) {
    it(`mutación: ${m.nombre}`, async () => {
      await iniciar(m.reglas());
      const malos = await violados();
      // Tiene que dejar pasar al menos una NEGATIVA: que solo se rompa un caso positivo no prueba que la regla niegue.
      expect(malos.filter((v) => !v.esperado).length, `ninguna negativa detectó «${m.nombre}»: ${JSON.stringify(malos.map((v) => v.texto).slice(0, 3))}`).toBeGreaterThan(0);
    }, 600_000);
  }

  it('las reglas vuelven a quedar sin mutar al terminar', async () => {
    await iniciar(REGLAS);
    expect(await violados()).toEqual([]);
  }, 600_000);
});

// ---------------------------------------------------------------------------
// La tabla de respaldo de `tieneModulo` es PARCIAL a propósito (solo módulos
// propios de un flujo) y tiene que coincidir con el registro. `registro.test.ts`
// no la compara; esta prueba lee el cuerpo de la función en las reglas y lo
// contrasta con `PUENTE_DE_FLUJOS`: si se invierte o se desfasa, falla.
// ---------------------------------------------------------------------------
describe('reglas: la tabla de respaldo de tieneModulo coincide con el registro', () => {
  const cuerpo = (): string => {
    const i = REGLAS.indexOf('    function tieneModulo(');
    expect(i, 'existe tieneModulo').toBeGreaterThan(-1);
    return REGLAS.slice(i, REGLAS.indexOf('\n    }\n', i));
  };

  /** Módulos de `f` que no son comunes ni de otro flujo: lo que `tieneModulo` puede resolver por `flujos`. */
  const propiosDe = (f: keyof typeof PUENTE_DE_FLUJOS): string[] =>
    (PUENTE_DE_FLUJOS[f].modulos as readonly string[]).filter((m) =>
      !(MODULOS_COMUNES_HOY as readonly string[]).includes(m)
      && !IDS_FLUJOS.some((o) => o !== f && (PUENTE_DE_FLUJOS[o].modulos as readonly string[]).includes(m)));

  it('cada flujo resuelve exactamente sus módulos propios, y el resto da false', () => {
    const texto = cuerpo();
    const tabla = new Map<string, string[]>();
    const re = /((?:m == '[\w-]+'(?:\s*\|\|\s*)?)+)\)?\s*\?\s*tieneFlujo\(tenantId,\s*'(\w+)'\)/g;
    for (const g of texto.matchAll(re)) {
      const mods = [...(g[1] as string).matchAll(/m == '([\w-]+)'/g)].map((x) => x[1] as string);
      tabla.set(g[2] as string, [...(tabla.get(g[2] as string) ?? []), ...mods]);
    }
    expect([...tabla.keys()].sort(), 'flujos de la tabla de respaldo').toEqual([...IDS_FLUJOS].sort());
    for (const f of IDS_FLUJOS) {
      expect((tabla.get(f) ?? []).sort(), `módulos propios de ${f}`).toEqual(propiosDe(f).sort());
    }
    expect(texto, 'la tabla se cierra con false').toMatch(/:\s*false\);\s*$/);
  });
});
