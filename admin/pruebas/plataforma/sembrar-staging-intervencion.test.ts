/**
 * `sembrar-staging-intervencion.mjs`, PROBADO CONTRA EL EMULADOR DE FIRESTORE (nunca contra staging).
 *
 * Auth va en memoria (un doble con la misma interfaz que usa el script): el emulador de Auth no hace falta
 * para lo que se prueba y asi la suite corre con `pruebas/correr.sh` como las demas. Proyecto `demo-*`.
 * Las pruebas escriben NEGANDO: se niega fuera de la lista blanca, el seco no escribe, `--limpiar` no toca a otro
 * comercio, correr dos veces no duplica, y ni el codigo ni la salida llevan una contrasena ni un telefono entero.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const RUTA = join(ADMIN, 'scripts', 'plataforma', 'sembrar-staging-intervencion.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8281'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'siembra-intervencion') ?? initializeApp({ projectId: PROYECTO }, 'siembra-intervencion');
const db = getFirestore(app);

interface Siembra {
  TENANT_ID: string; MARCA: string; CAMPO_MARCA: string; CORREO_ADMIN: string;
  analizarArgumentos: (a: string[], env?: Record<string, string | undefined>) => { ok: boolean; motivo?: string; cfg?: Record<string, unknown> };
  conversacionesDeSiembra: (ahora: number) => Array<{
    id: string; telefono: string; ultimoEn: number; entranteEn: number; ventanaVenceEn: number;
    mensajes: Array<{ direccion: string; texto: string; minutosAtras: number }>;
  }>;
  enmascarar: (t: string) => string;
  ejecutar: (cfg: Record<string, unknown>, deps: Record<string, unknown>) => Promise<number>;
}
const S = await import('../../scripts/plataforma/sembrar-staging-intervencion.mjs') as unknown as Siembra;

// ── Un Auth en memoria, con lo que el script usa ─────────────────────────────
interface Usuario { uid: string; email: string; emailVerified: boolean; customClaims?: Record<string, unknown>; password?: string }
function authEnMemoria() {
  const usuarios = new Map<string, Usuario>();
  let n = 0;
  return {
    usuarios,
    async getUserByEmail(email: string) {
      const u = [...usuarios.values()].find((x) => x.email === email);
      if (!u) throw Object.assign(new Error('no hay'), { code: 'auth/user-not-found' });
      return structuredClone(u);
    },
    async createUser(p: { email: string; password: string; emailVerified: boolean }) {
      const u: Usuario = { uid: `uid-${++n}`, email: p.email, emailVerified: p.emailVerified, password: p.password };
      usuarios.set(u.uid, u);
      return structuredClone(u);
    },
    async setCustomUserClaims(uid: string, c: Record<string, unknown>) { (usuarios.get(uid) as Usuario).customClaims = c; },
    async deleteUser(uid: string) { usuarios.delete(uid); },
  };
}

const cfg = (extra: Record<string, unknown> = {}) => ({ proyecto: PROYECTO, emulador: true, aplicar: false, limpiar: false, ...extra });
async function correr(auth: ReturnType<typeof authEnMemoria>, extra: Record<string, unknown> = {}, ahoraMs = Date.now()) {
  const salida: string[] = [];
  const codigo = await S.ejecutar(cfg(extra), { db, auth, Timestamp, ahoraMs, imprimir: (l: string) => salida.push(l) });
  return { codigo, texto: salida.join('\n') };
}

/** Todos los documentos de un comercio (todas las subcolecciones), por ruta. */
async function rutasDe(id: string): Promise<string[]> {
  const salida: string[] = [];
  const ficha = db.doc(`tenants/${id}`);
  if ((await ficha.get()).exists) salida.push(ficha.path);
  const recorrer = async (ref: FirebaseFirestore.DocumentReference) => {
    for (const col of await ref.listCollections()) {
      for (const d of await col.listDocuments()) {
        if ((await d.get()).exists) salida.push(d.path);
        await recorrer(d);
      }
    }
  };
  await recorrer(ficha);
  return salida.sort();
}

const AJENO = 'comercio-ajeno-prueba';
async function sembrarAjeno() {
  await db.doc(`tenants/${AJENO}`).set({ nombre: 'Ajeno', estado: 'activo', creadoPor: 'otro-script' });
  await db.doc(`tenants/${AJENO}/conversaciones/wa_59100000099`).set({ telefono: '59100000099', ultimoMensaje: 'hola' });
  await db.doc(`tenants/${AJENO}/conversaciones/wa_59100000099/mensajes/m0`).set({ texto: 'hola', direccion: 'entrante' });
  await db.doc(`tenants/${AJENO}/miembros/u-ajeno`).set({ correo: 'otro@ejemplo.com', rol: 'admin' });
}

beforeEach(async () => {
  await db.recursiveDelete(db.doc(`tenants/${S.TENANT_ID}`));
  await db.recursiveDelete(db.doc(`tenants/${AJENO}`));
});
afterAll(async () => {
  await db.recursiveDelete(db.doc(`tenants/${S.TENANT_ID}`));
  await db.recursiveDelete(db.doc(`tenants/${AJENO}`));
});

// ── La salvaguarda de proyecto ───────────────────────────────────────────────
describe('salvaguarda: solo staging o un emulador demo-*', () => {
  const STG = 'proyecto-ficticio-staging';
  const base = { GCP_PROJECT_ID_STAGING: STG, GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };
  const analizar = (a: string[], env: Record<string, string | undefined>) => S.analizarArgumentos(a, env);

  it('acepta el proyecto de la lista blanca, tambien tomado de la variable', () => {
    expect(analizar(['--proyecto', STG], base).ok).toBe(true);
    const r = analizar(['--aplicar'], base);
    expect(r.ok).toBe(true);
    expect(r.cfg).toMatchObject({ proyecto: STG, emulador: false, aplicar: true, limpiar: false });
  });
  it('rechaza produccion, otro proyecto, un nombre sin «staging» y la variable ausente', () => {
    expect(analizar(['--proyecto', 'proyecto-ficticio-prod'], base).ok).toBe(false);
    expect(analizar(['--proyecto', 'otro-proyecto-staging'], base).ok).toBe(false);
    expect(analizar(['--proyecto', STG], { ...base, GCP_PROJECT_ID_STAGING: undefined }).ok).toBe(false);
    expect(analizar(['--proyecto', STG], { ...base, GCP_PROJECT_ID_STAGING: '   ' }).ok).toBe(false);
    expect(analizar(['--proyecto', STG], { GCP_PROJECT_ID_STAGING: STG }).ok).toBe(false); // sin GCP_PROJECT_ID_PROD no se puede descartar
    expect(analizar(['--proyecto', 'proyecto-sin-la-palabra'], { ...base, GCP_PROJECT_ID_STAGING: 'proyecto-sin-la-palabra' }).ok).toBe(false);
    expect(analizar([], {}).ok).toBe(false);
  });
  it('rechaza si la lista blanca coincide con produccion o con demos, y un emulador a medias', () => {
    expect(analizar(['--proyecto', STG], { ...base, GCP_PROJECT_ID_PROD: STG }).ok).toBe(false);
    expect(analizar(['--proyecto', STG], { ...base, GCP_PROJECT_ID: STG }).ok).toBe(false);
    expect(analizar(['--proyecto', STG], { ...base, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }).ok).toBe(false);
    expect(analizar(['--proyecto', 'demo-x'], base).ok).toBe(false);
    expect(analizar(['--proyecto', 'demo-x'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' }).ok).toBe(false); // falta Auth
  });
  it('un demo-* con Firestore y Auth del emulador pasa; los argumentos raros no', () => {
    const emu = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:1' };
    expect(analizar(['--proyecto', 'demo-x'], emu)).toMatchObject({ ok: true, cfg: { emulador: true } });
    expect(analizar(['--proyecto', 'demo-x', '--forzar'], emu).ok).toBe(false);
    expect(analizar(['--proyecto'], emu).ok).toBe(false);
    expect(analizar(['--proyecto', '--aplicar'], emu).ok).toBe(false);
  });
  it('el motivo nunca nombra el id del proyecto', () => {
    const r = analizar(['--proyecto', 'proyecto-ficticio-prod'], base);
    expect(r.motivo).not.toContain('proyecto-ficticio-prod');
  });
  it('como proceso: un proyecto que no es demo-* con el emulador puesto sale con 2, sin escribir ni imprimir el id', () => {
    const p = spawnSync(process.execPath, [RUTA, '--proyecto', 'proyecto-ficticio-staging', '--aplicar'], {
      encoding: 'utf8', timeout: 30000,
      env: entornoDelEmulador(HOST, { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' }),
    });
    expect(p.status).toBe(2);
    expect(p.stdout + p.stderr).not.toContain('proyecto-ficticio-staging');
    expect(p.stdout + p.stderr).toContain('rechazado');
  });
  it('como proceso: sin proyecto ni variable sale con 2', () => {
    const p = spawnSync(process.execPath, [RUTA], {
      encoding: 'utf8', timeout: 30000, env: entornoDelEmulador(HOST, { GCP_PROJECT_ID_STAGING: '' }),
    });
    expect(p.status).toBe(2);
  });
});

// ── Los datos ────────────────────────────────────────────────────────────────
describe('las tres conversaciones', () => {
  const ahora = 1_800_000_000_000;
  const cs = S.conversacionesDeSiembra(ahora);
  it('son tres, de 4 a 6 mensajes, con telefonos de formato valido (wa_ + 8 a 15 digitos) y distintos', () => {
    expect(cs).toHaveLength(3);
    for (const c of cs) {
      expect(c.mensajes.length).toBeGreaterThanOrEqual(4);
      expect(c.mensajes.length).toBeLessThanOrEqual(6);
      expect(`wa_${c.telefono}`).toMatch(/^wa_[0-9]{8,15}$/);
      expect(c.telefono).toMatch(/^591000/); // rango ficticio: seis digitos que ningun numero real empieza asi
    }
    expect(new Set(cs.map((c) => c.telefono)).size).toBe(3);
  });
  it('una con la ventana abierta, una por vencer (menos de 1 hora) y una vencida', () => {
    const resta = Object.fromEntries(cs.map((c) => [c.id, c.ventanaVenceEn - ahora]));
    expect(resta['ventana-abierta']).toBeGreaterThan(6 * 3_600_000);
    expect(resta['por-vencer']).toBeGreaterThan(0);
    expect(resta['por-vencer']).toBeLessThan(3_600_000);
    expect(resta['ventana-vencida']).toBeLessThan(0);
  });
  it('`ultimoEntranteEn` es la hora del ultimo mensaje del cliente y `ultimoEn` la del ultimo mensaje', () => {
    for (const c of cs) {
      const e = Math.max(...c.mensajes.filter((m) => m.direccion === 'entrante').map((m) => ahora - m.minutosAtras * 60_000));
      expect(c.entranteEn).toBe(e);
      expect(c.ventanaVenceEn).toBe(e + 24 * 3_600_000);
      expect(c.ultimoEn).toBe(Math.max(...c.mensajes.map((m) => ahora - m.minutosAtras * 60_000)));
    }
  });
  it('enmascara el telefono a los 4 ultimos digitos', () => {
    expect(S.enmascarar('59100000021')).toBe('***0021');
  });
});

// ── La siembra, contra el emulador ───────────────────────────────────────────
describe('siembra y limpieza', () => {
  it('SECO: no escribe nada (ni Firestore ni Auth) y no imprime telefonos enteros', async () => {
    const auth = authEnMemoria();
    const { codigo, texto } = await correr(auth);
    expect(codigo).toBe(0);
    expect(await rutasDe(S.TENANT_ID)).toEqual([]);
    expect(auth.usuarios.size).toBe(0);
    expect(texto).toContain('Seco');
    expect(texto).not.toMatch(/591000000\d{2}/);
    expect(texto).toContain('***0021');
  });

  it('--aplicar deja el comercio, el plan, la bandera, el admin sin contrasena a la vista y las conversaciones', async () => {
    const auth = authEnMemoria();
    const { codigo, texto } = await correr(auth, { aplicar: true });
    expect(codigo).toBe(0);
    const ficha = (await db.doc(`tenants/${S.TENANT_ID}`).get()).data() ?? {};
    expect(ficha).toMatchObject({ estado: 'activo', plan: 'pro', consolaConversaciones: 'nueva', [S.CAMPO_MARCA]: S.MARCA });
    expect(ficha['nombre']).toMatch(/PRUEBA/);
    const cuenta = (await db.doc(`tenants/${S.TENANT_ID}/cuenta/estado`).get()).data() ?? {};
    expect(cuenta).toMatchObject({ plan: 'pro' });
    expect(cuenta['limites']).toBeTruthy();

    const convs = await db.collection(`tenants/${S.TENANT_ID}/conversaciones`).get();
    expect(convs.size).toBe(3);
    for (const d of convs.docs) {
      expect(d.id).toMatch(/^wa_591000/);
      expect(d.get(S.CAMPO_MARCA)).toBe(S.MARCA);
      expect(d.get('ultimoEntranteEn').toMillis()).toBeLessThan(Date.now() + 1000);
      expect(d.get('ventanaVenceEn').toMillis() - d.get('ultimoEntranteEn').toMillis()).toBe(24 * 3_600_000);
      expect(d.get('telefonoTrozos')).toContain(d.id.replace(/^wa_/, '').slice(-4));
      const ms = await d.ref.collection('mensajes').get();
      expect(ms.size).toBeGreaterThanOrEqual(4);
      expect(ms.size).toBeLessThanOrEqual(6);
      for (const m of ms.docs) expect(m.get(S.CAMPO_MARCA)).toBe(S.MARCA);
    }
    // Todo documento del comercio lleva la marca (es lo que `--limpiar` usa).
    for (const ruta of await rutasDe(S.TENANT_ID)) {
      expect((await db.doc(ruta).get()).get(S.CAMPO_MARCA), ruta).toBe(S.MARCA);
    }

    const [u] = [...auth.usuarios.values()];
    expect(auth.usuarios.size).toBe(1);
    expect(u?.email).toMatch(/@ejemplo\.com$/);
    expect(u?.emailVerified).toBe(true);
    expect((u?.customClaims as { nc: { t: Record<string, string> } }).nc.t[S.TENANT_ID]).toBe('admin');
    const miembro = await db.doc(`tenants/${S.TENANT_ID}/miembros/${u?.uid}`).get();
    expect(miembro.get('rol')).toBe('admin');

    // Ni la clave generada ni un telefono entero en la salida; si dice que la contrasena va por otro camino.
    expect(texto).not.toContain(u?.password as string);
    expect(texto).not.toMatch(/591000000\d{2}/);
    expect(texto).toMatch(/CONTRASENA/);
  });

  it('es idempotente: dos --aplicar dejan los mismos documentos y UN solo usuario', async () => {
    const auth = authEnMemoria();
    await correr(auth, { aplicar: true }, Date.now());
    const primera = await rutasDe(S.TENANT_ID);
    const { codigo } = await correr(auth, { aplicar: true }, Date.now() + 5 * 60_000);
    expect(codigo).toBe(0);
    expect(await rutasDe(S.TENANT_ID)).toEqual(primera);
    expect(auth.usuarios.size).toBe(1);
    const u = [...auth.usuarios.values()][0];
    expect((u?.customClaims as { nc: { t: object } }).nc.t).toEqual({ [S.TENANT_ID]: 'admin' });
  });

  it('--limpiar sin --aplicar es seco: no borra nada', async () => {
    const auth = authEnMemoria();
    await correr(auth, { aplicar: true });
    const antes = await rutasDe(S.TENANT_ID);
    const { codigo } = await correr(auth, { limpiar: true });
    expect(codigo).toBe(0);
    expect(await rutasDe(S.TENANT_ID)).toEqual(antes);
    expect(auth.usuarios.size).toBe(1);
  });

  it('--limpiar --aplicar borra lo sembrado y NO toca a otro comercio (ni su Auth); repetirlo no falla', async () => {
    const auth = authEnMemoria();
    await sembrarAjeno();
    const ajenoAntes = await rutasDe(AJENO);
    await auth.createUser({ email: 'otro@ejemplo.com', password: 'x', emailVerified: true });
    await correr(auth, { aplicar: true });
    expect(auth.usuarios.size).toBe(2);

    const { codigo } = await correr(auth, { limpiar: true, aplicar: true });
    expect(codigo).toBe(0);
    expect(await rutasDe(S.TENANT_ID)).toEqual([]);
    expect(await rutasDe(AJENO)).toEqual(ajenoAntes);
    expect([...auth.usuarios.values()].map((u) => u.email)).toEqual(['otro@ejemplo.com']);

    const otra = await correr(auth, { limpiar: true, aplicar: true });
    expect(otra.codigo).toBe(0);
    expect(await rutasDe(AJENO)).toEqual(ajenoAntes);
  });

  it('--limpiar no borra la cuenta del correo fijo si tiene rol en OTRO comercio', async () => {
    const auth = authEnMemoria();
    await correr(auth, { aplicar: true });
    const u = [...auth.usuarios.values()][0] as Usuario;
    (u.customClaims as { nc: { t: Record<string, string> } }).nc.t['otro-comercio'] = 'admin';
    await correr(auth, { limpiar: true, aplicar: true });
    expect(await rutasDe(S.TENANT_ID)).toEqual([]);
    expect(auth.usuarios.size).toBe(1);
  });

  it('si el id ya existe y NO lo sembro este script: salida 1 y no se toca nada (ni sembrando ni limpiando)', async () => {
    const auth = authEnMemoria();
    await db.doc(`tenants/${S.TENANT_ID}`).set({ nombre: 'De otro', estado: 'activo' });
    await db.doc(`tenants/${S.TENANT_ID}/conversaciones/wa_59100000055`).set({ telefono: '59100000055' });
    const antes = await rutasDe(S.TENANT_ID);
    for (const extra of [{ aplicar: true }, { limpiar: true, aplicar: true }]) {
      const { codigo } = await correr(auth, extra);
      expect(codigo).toBe(1);
    }
    expect(await rutasDe(S.TENANT_ID)).toEqual(antes);
    expect(auth.usuarios.size).toBe(0);
  });
});

// ── Sin contrasena en el codigo ──────────────────────────────────────────────
describe('el codigo no lleva contrasenas ni ids de proyecto', () => {
  const fuente = readFileSync(RUTA, 'utf8');
  it('la unica clave es aleatoria y descartada: no hay literal de contrasena ni se imprime', () => {
    const lineas = fuente.split('\n').filter((l) => /password/i.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l));
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toContain('randomBytes(32)');
    // Ninguna interpolacion de texto toca la clave ni un enlace (las lineas solo la nombran en prosa).
    expect(fuente).not.toMatch(/\$\{\s*[\w.]*(password|link|oob)/i);
    expect(fuente).not.toMatch(/(di|console\.(log|error))\(\s*[a-z.]*(password|link)/i);
    expect(fuente).not.toMatch(/generatePasswordResetLink/);
  });
  it('no escribe un id de proyecto real: el destino viene de la variable', () => {
    expect(fuente).not.toMatch(/GCP_PROJECT_ID_STAGING\s*=\s*['"]/);
    expect(fuente).not.toMatch(/--proyecto\s+[a-z0-9]+-[a-z0-9-]*staging\b(?!>)/);
  });
});
