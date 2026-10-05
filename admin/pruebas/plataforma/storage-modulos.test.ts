/**
 * REGLAS DE STORAGE POR MÓDULO (H2b-6) — EL ARCHIVO DE PLANES, PROBADO NEGANDO.
 *
 * `tieneOnboardingEn(ficha)` (admin/storage.rules): si la ficha trae `modulos`
 * (una LISTA) manda `'captacion' in modulos`; si no, se decide por `flujos`
 * (o `[vertical]`) como hasta hoy. Lo que se prueba, con el emulador de Storage
 * resolviendo `firestore.get()` contra el de Firestore:
 *   · la matriz de los 8 subconjuntos de flujos, por `flujos` y por `modulos`:
 *     solo los que incluyen captación suben, reemplazan, borran y leen (el
 *     propietario);
 *   · `modulos` vacío, sin captación, o que no es lista (cadena);
 *   · ficha sin `flujos` ni `vertical`, suspendido y tenant inexistente niegan;
 *   · aislamiento: el administrador de un comercio no toca la carpeta de otro;
 *   · mutaciones: la regla ignora la lista, o abre siempre, y la batería lo nota.
 *
 * Se SALTA sin STORAGE_EMULATOR_PORT. Se corre con
 *   `pruebas/correr-storage.sh pruebas/plataforma/storage-modulos.test.ts`
 * (el script ya corre `storage-reglas.test.ts`; el argumento se le suma).
 */
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { deleteObject, getMetadata, ref, uploadBytes } from 'firebase/storage';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const PUERTO_STORAGE = process.env['STORAGE_EMULATOR_PORT'];
const PUERTO_FIRESTORE = process.env['FIRESTORE_EMULATOR_PORT'];
const REGLAS_FS = readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8');
const REGLAS_ST = readFileSync(join(aqui, '..', '..', 'storage.rules'), 'utf8');

let entorno: RulesTestEnvironment;

const iniciar = async (storageRules: string): Promise<void> => {
  if (entorno) await entorno.cleanup();
  entorno = await initializeTestEnvironment({
    projectId: 'demo-novuchat-pruebas',
    firestore: { rules: REGLAS_FS, host: '127.0.0.1', port: Number(PUERTO_FIRESTORE ?? 8233) },
    storage: { rules: storageRules, host: '127.0.0.1', port: Number(PUERTO_STORAGE) },
  });
};

const claims = (tenants: Record<string, string>, propietario = false, proveedor = 'password') => ({
  nc: { t: tenants, ...(propietario ? { p: true } : {}), v: 1 },
  firebase: { sign_in_provider: proveedor, identities: {} },
  email_verified: true,
});
const comoAdmin = (t: string) => entorno.authenticatedContext(`u-admin-${t}`, claims({ [t]: 'admin' })).storage();
const comoOper = (t: string) => entorno.authenticatedContext(`u-oper-${t}`, claims({ [t]: 'oper' })).storage();
const comoPropietario = () => entorno.authenticatedContext('u-novuchat', claims({}, true, 'google.com')).storage();

type Storage = ReturnType<typeof comoAdmin>;
const camino = (t: string) => `tenants/${t}/captacion/planes.pdf`;
const subir = (s: Storage, t: string) =>
  uploadBytes(ref(s, camino(t)), new Uint8Array(1024), { contentType: 'application/pdf' });

// El ORÁCULO, escrito a mano: `captacion` = tiene captación.
type Tenant = { id: string; ficha: Record<string, unknown> | null; captacion: boolean };
const base = { nombre: 'x', plan: 'basico', estado: 'activo' };
const FLUJOS_TODOS = ['agendamiento', 'venta', 'onboarding'];
const tenants: Tenant[] = [
  { id: 'sa', ficha: { ...base, vertical: 'agendamiento', flujos: ['agendamiento'] }, captacion: false },
  { id: 'sv', ficha: { ...base, vertical: 'venta', flujos: ['venta'] }, captacion: false },
  { id: 'so', ficha: { ...base, vertical: 'onboarding', flujos: ['onboarding'] }, captacion: true },
  { id: 'sl', ficha: { ...base, vertical: 'onboarding' }, captacion: true },
  { id: 'sl2', ficha: { ...base, vertical: 'venta' }, captacion: false },
  { id: 'vacia', ficha: { ...base }, captacion: false },
  { id: 'mx', ficha: { ...base, flujos: ['onboarding'], modulos: 'captacion' }, captacion: true },
  { id: 'mx2', ficha: { ...base, flujos: ['venta'], modulos: 'captacion' }, captacion: false },
  { id: 'ma', ficha: { ...base, flujos: FLUJOS_TODOS, modulos: ['agenda'] }, captacion: false },
  { id: 'mv', ficha: { ...base, flujos: FLUJOS_TODOS, modulos: [] }, captacion: false },
  { id: 'mp', ficha: { ...base, flujos: ['venta'], modulos: ['captacion'] }, captacion: true },
  { id: 'ab', ficha: { ...base, flujos: [], modulos: ['agenda', 'pedidos', 'catalogo-web', 'captacion', 'productos', 'campanas'] },
    captacion: true },
  { id: 'susp', ficha: { ...base, estado: 'suspendido', flujos: [], modulos: ['captacion'] }, captacion: false },
  { id: 'fantasma', ficha: null, captacion: false },
];
for (const bits of ['000', '100', '010', '001', '110', '101', '011', '111']) {
  const [a, v, o] = bits.split('').map((b) => b === '1');
  const flujos = [a && 'agendamiento', v && 'venta', o && 'onboarding'].filter(Boolean);
  const modulos = [a && 'agenda', v && 'pedidos', o && 'captacion', 'productos'].filter(Boolean);
  tenants.push({ id: `f${bits}`, ficha: { ...base, flujos }, captacion: o });
  // `flujos` dice TODO a propósito: solo la lista puede explicar el resultado.
  tenants.push({ id: `m${bits}`, ficha: { ...base, flujos: FLUJOS_TODOS, modulos }, captacion: o });
}

const sembrar = async (t: Tenant, conArchivo: boolean): Promise<void> => {
  // Sin `clear*` por caso (cada uno cuesta segundos): la ficha se reescribe
  // entera y el archivo se deja o se quita según el caso.
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    if (t.ficha) await setDoc(doc(ctx.firestore(), 'tenants', t.id), t.ficha);
    const archivo = ref(ctx.storage(), camino(t.id));
    if (conArchivo) {
      await uploadBytes(archivo, new Uint8Array(512), { contentType: 'application/pdf' });
    } else {
      await deleteObject(archivo).catch(() => undefined);
    }
  });
};

const permitida = async (op: () => Promise<unknown>): Promise<boolean> => {
  try { await op(); return true; } catch (e) {
    const c = String((e as { code?: string }).code ?? e);
    if (c.includes('unauthorized') || c.includes('permission-denied')) return false;
    throw e;
  }
};

type Caso = { nombre: string; esperado: boolean; correr: () => Promise<boolean> };
const casos = (nucleo: boolean): Caso[] => {
  const lista: Caso[] = [];
  for (const t of tenants.filter((x) => !nucleo || !/^[fm][01]{3}$/.test(x.id))) {
    lista.push({ nombre: `${t.id}: el administrador sube planes.pdf`, esperado: t.captacion,
      correr: async () => { await sembrar(t, false); return permitida(() => subir(comoAdmin(t.id), t.id)); } });
    lista.push({ nombre: `${t.id}: el propietario sube planes.pdf`, esperado: t.captacion,
      correr: async () => { await sembrar(t, false); return permitida(() => subir(comoPropietario(), t.id)); } });
    lista.push({ nombre: `${t.id}: el administrador borra planes.pdf`, esperado: t.captacion,
      correr: async () => { await sembrar(t, true); return permitida(() => deleteObject(ref(comoAdmin(t.id), camino(t.id)))); } });
    // El propietario LEE solo si el comercio tiene captación (como config/onboarding).
    lista.push({ nombre: `${t.id}: el propietario lee planes.pdf`, esperado: t.captacion,
      correr: async () => { await sembrar(t, true); return permitida(() => getMetadata(ref(comoPropietario(), camino(t.id)))); } });
  }
  // Controles que no dependen del módulo.
  const ab = tenants.find((t) => t.id === 'ab') as Tenant;
  const mv = tenants.find((t) => t.id === 'mv') as Tenant;
  lista.push({ nombre: 'mv: el administrador SÍ lee su propio archivo (miembro; control)', esperado: true,
    correr: async () => { await sembrar(mv, true); return permitida(() => getMetadata(ref(comoAdmin('mv'), camino('mv')))); } });
  lista.push({ nombre: 'ab: un OPERADOR no sube, aunque tenga captación', esperado: false,
    correr: async () => { await sembrar(ab, false); return permitida(() => subir(comoOper('ab'), 'ab')); } });
  lista.push({ nombre: 'aislamiento: el administrador de mv no sube a la carpeta de ab', esperado: false,
    correr: async () => { await sembrar(ab, false); return permitida(() => subir(comoAdmin('mv'), 'ab')); } });
  lista.push({ nombre: 'aislamiento: el administrador de ab no sube a la carpeta de mv', esperado: false,
    correr: async () => { await sembrar(mv, false); return permitida(() => subir(comoAdmin('ab'), 'mv')); } });
  return lista;
};

const violados = async (nucleo: boolean): Promise<string[]> => {
  const malos: string[] = [];
  for (const c of casos(nucleo)) {
    if ((await c.correr()) !== c.esperado) malos.push(`${c.nombre} (esperado ${c.esperado ? 'permite' : 'niega'})`);
  }
  return malos;
};

describe.skipIf(!PUERTO_STORAGE)('storage.rules por módulo: archivo de planes', () => {
  afterAll(async () => { await entorno?.cleanup(); });

  it('línea base: toda la batería da lo esperado (matriz por flujos y por modulos)', async () => {
    await iniciar(REGLAS_ST);
    expect(await violados(false)).toEqual([]);
  }, 600_000);

  it('el oráculo no es vacío: hay tenants que abren y tenants que niegan', () => {
    expect(tenants.filter((t) => t.captacion).length).toBeGreaterThan(3);
    expect(tenants.filter((t) => !t.captacion).length).toBeGreaterThan(3);
  });

  const mutaciones: Array<[string, (r: string) => string]> = [
    ['tieneOnboardingEn ignora la lista `modulos` (solo lee flujos)',
      (r) => r.replace("ficha.data.get('modulos', null) is list", "ficha.data.get('modulos', null) is string")],
    ['tieneOnboardingEn abre con cualquier lista (`modulos` presente basta)',
      (r) => r.replace("'captacion' in ficha.data.modulos", 'true')],
    ['tieneOnboardingEn devuelve true para toda ficha',
      (r) => r.replace('return ficha != null\n        && (ficha.data.get(\'modulos\'', 'return true || ficha != null\n        && (ficha.data.get(\'modulos\'')],
  ];
  for (const [nombre, cambio] of mutaciones) {
    it(`mutación: ${nombre}`, async () => {
      const mutadas = cambio(REGLAS_ST);
      expect(mutadas, 'la mutación cambia algo').not.toBe(REGLAS_ST);
      await iniciar(mutadas);
      expect((await violados(true)).length, `ningún caso detectó «${nombre}»`).toBeGreaterThan(0);
    }, 600_000);
  }

  it('las reglas vuelven a quedar sin mutar', async () => {
    await iniciar(REGLAS_ST);
    expect(await violados(true)).toEqual([]);
  }, 600_000);
});
