/**
 * SEGUIMIENTO DE LA EDICIÓN DEL miniCRM (03/11/2026), con el emulador de Firestore y un Drive FALSO: nada sale a Google.
 * Cierra los huecos de `docs/arquitectura/modulos/crm.md`: baja y suspensión del negocio, `config/crm.activo = false`
 * y la reconciliación programada de `revocado_pendiente`. Se escribe NEGANDO: cada caso comprueba también lo que NO debe pasar.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (getApps().length === 0) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const {
  revocarEditoresAlCerrarTenant, manejarCambioConfigCrm, reconciliarEditoresPendientes, MAX_REINTENTOS_REVOCACION,
} = await import('../../../functions/src/modulos/crm/editoresCrm.ts');
const { ErrorDrive } = await import('../../../functions/src/modulos/crm/editores-crm.ts');
const { crearBajaTenant, crearSuspenderTenant } = await import('../../../functions/src/plataforma/tenants.ts');
type ClienteDrive = import('../../../functions/src/modulos/crm/editores-crm.ts').ClienteDrive;
type Peticion = Parameters<ReturnType<typeof crearBajaTenant>['run']>[0];
const db = getFirestore();

const A = 'seg-a';
const B = 'seg-b';
const ARCHIVO = 'hoja-segui'.padEnd(12, 'x');
const correoDe = (l: string) => [l, 'example.invalid'].join('@');

function driveFalso() {
  const estado = { falloBorrar: false };
  const llamadas: { archivoId: string; permisoId: string }[] = [];
  const cliente: ClienteDrive = {
    async crearPermiso() { throw new Error('no se crea en estas pruebas'); },
    async borrarPermiso(archivoId, permisoId) {
      llamadas.push({ archivoId, permisoId });
      if (estado.falloBorrar) throw new ErrorDrive(503);
    },
  };
  return { cliente, llamadas, estado };
}
let fake: ReturnType<typeof driveFalso>;
let pedidos: string[];
const deps = () => ({ drive: (t: string) => { pedidos.push(t); return fake.cliente; } });

const editor = async (t: string, uid: string) => (await db.doc(`tenants/${t}/editoresCrm/${uid}`).get()).data();
const sembrarEditor = (t: string, uid: string, estado: string, extra: Record<string, unknown> = {}) =>
  db.doc(`tenants/${t}/editoresCrm/${uid}`).set({ correoGoogle: correoDe(uid), estado, permisoId: `perm-${t}-${uid}`, archivoId: ARCHIVO, ...extra });
const auditorias = async (t: string, accion: string) => (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', accion).get()).docs.map((d) => d.data());

beforeEach(async () => {
  fake = driveFalso(); pedidos = [];
  for (const t of [A, B]) {
    await db.recursiveDelete(db.doc(`tenants/${t}`));
    await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo' });
    await sembrarEditor(t, 'e1', 'activo');
    await sembrarEditor(t, 'e2', 'revocado_pendiente');
    await sembrarEditor(t, 'e3', 'revocado', { permisoId: 'ya-borrado' });
  }
});

const PROPIETARIO = { uid: 'prop-seg', token: { nc: { p: true }, firebase: { sign_in_provider: 'google.com' }, auth_time: Math.floor(Date.now() / 1000) } };
const pedir = (tenantId: string) => ({ data: { tenantId, motivo: 'prueba' }, auth: PROPIETARIO, rawRequest: {} }) as unknown as Peticion;

describe('baja y suspensión del negocio revocan a TODOS los editores', () => {
  for (const [nombre, fabricar, esperado] of [
    ['bajaTenant', crearBajaTenant, 'dado_de_baja'], ['suspenderTenant', crearSuspenderTenant, 'suspendido'],
  ] as const) {
    it(`${nombre}: revoca los vigentes y los pendientes de ESE negocio y no toca a otro`, async () => {
      const f = fabricar(revocarEditoresAlCerrarTenant(deps()));
      await f.run(pedir(A));
      expect((await db.doc(`tenants/${A}`).get()).get('estado')).toBe(esperado);
      expect((await editor(A, 'e1'))?.['estado']).toBe('revocado');
      expect((await editor(A, 'e2'))?.['estado']).toBe('revocado');
      expect(fake.llamadas.map((l) => l.permisoId).sort()).toEqual([`perm-${A}-e1`, `perm-${A}-e2`]);
      expect(pedidos.every((t) => t === A)).toBe(true);
      // El otro negocio, intacto; y el ya revocado no vuelve a llamar a Drive.
      expect((await editor(B, 'e1'))?.['estado']).toBe('activo');
      expect((await editor(B, 'e2'))?.['estado']).toBe('revocado_pendiente');
      expect(fake.llamadas.some((l) => l.permisoId === 'ya-borrado')).toBe(false);
    });

    it(`${nombre}: si Drive falla, el negocio igual se cierra y los editores quedan revocado_pendiente`, async () => {
      fake.estado.falloBorrar = true;
      const f = fabricar(revocarEditoresAlCerrarTenant(deps()));
      await expect(f.run(pedir(A))).resolves.toBeDefined();
      expect((await db.doc(`tenants/${A}`).get()).get('estado')).toBe(esperado);
      expect((await editor(A, 'e1'))?.['estado']).toBe('revocado_pendiente');
      expect((await editor(B, 'e1'))?.['estado']).toBe('activo');
      const aud = await auditorias(A, 'editor_crm_baja');
      expect(aud.length).toBeGreaterThan(0);
      expect(aud.every((x) => x['resultado'] === 'pendiente')).toBe(true);
    });
  }

  it('NEGACIÓN: quien no es propietario no cierra el negocio ni revoca a nadie', async () => {
    const f = crearBajaTenant(revocarEditoresAlCerrarTenant(deps()));
    const admin = { uid: 'adm', token: { nc: { t: { [A]: 'admin' } }, firebase: { sign_in_provider: 'password' }, email_verified: true } };
    await expect(f.run({ data: { tenantId: A }, auth: admin, rawRequest: {} } as unknown as Peticion)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fake.llamadas).toEqual([]);
    expect((await editor(A, 'e1'))?.['estado']).toBe('activo');
  });

  it('ganchos.ts une los dos callables con el gancho del miniCRM, y Plataforma no importa módulos', () => {
    const g = readFileSync(fileURLToPath(new URL('../../../functions/src/ganchos.ts', import.meta.url)), 'utf8');
    expect(g).toMatch(/bajaTenant = crearBajaTenant\(revocarEditoresAlCerrarTenant\(\)\)/);
    expect(g).toMatch(/suspenderTenant = crearSuspenderTenant\(revocarEditoresAlCerrarTenant\(\)\)/);
    const t = readFileSync(fileURLToPath(new URL('../../../functions/src/plataforma/tenants.ts', import.meta.url)), 'utf8');
    expect(t).not.toMatch(/from '\.\.\/modulos\//);
  });
});

describe('config/crm.activo = false revoca', () => {
  const apagar = (t: string, antes: Record<string, unknown> | undefined, despues: Record<string, unknown> | undefined) =>
    manejarCambioConfigCrm(deps())(t, antes, despues);

  it('de encendido a apagado revoca a los editores de ESE negocio y de ningún otro', async () => {
    await apagar(A, { activo: true }, { activo: false });
    expect((await editor(A, 'e1'))?.['estado']).toBe('revocado');
    expect((await editor(A, 'e2'))?.['estado']).toBe('revocado');
    expect((await editor(B, 'e1'))?.['estado']).toBe('activo');
    expect(pedidos.every((t) => t === A)).toBe(true);
  });

  it('también cuando el documento no existía (encendido por omisión) y se crea apagado', async () => {
    await apagar(A, undefined, { activo: false });
    expect((await editor(A, 'e1'))?.['estado']).toBe('revocado');
  });

  it('NEGACIÓN: encender, otro campo, borrar el documento o repetir «apagado» no llama a Drive', async () => {
    await apagar(A, { activo: false }, { activo: true });
    await apagar(A, { activo: true }, { activo: true, hoja: 'x' });
    await apagar(A, { activo: true }, undefined);
    await apagar(A, { activo: false }, { activo: false, hoja: 'x' });
    expect(fake.llamadas).toEqual([]);
    expect((await editor(A, 'e1'))?.['estado']).toBe('activo');
  });

  it('si Drive falla queda revocado_pendiente (lo cierra la reconciliación) y no lanza', async () => {
    fake.estado.falloBorrar = true;
    await expect(apagar(A, { activo: true }, { activo: false })).resolves.toBeUndefined();
    expect((await editor(A, 'e1'))?.['estado']).toBe('revocado_pendiente');
  });
});

describe('reconciliación de revocado_pendiente', () => {
  const correr = () => reconciliarEditoresPendientes(deps())();

  it('reintenta los pendientes de cada negocio, los cierra, no toca a los activos ni a los revocados', async () => {
    const r = await correr();
    // El emulador puede traer pendientes de otras suites: se mira lo de A y B.
    expect(r.cerrados).toBeGreaterThanOrEqual(2);
    expect(r.agotados).toBe(0);
    for (const t of [A, B]) {
      expect((await editor(t, 'e2'))?.['estado']).toBe('revocado');
      expect((await editor(t, 'e1'))?.['estado']).toBe('activo');
    }
    expect(fake.llamadas.map((l) => l.permisoId).filter((p) => p.startsWith('perm-seg-')).sort()).toEqual([`perm-${A}-e2`, `perm-${B}-e2`]);
    // Idempotente: una segunda corrida no vuelve a llamar a Drive.
    fake.llamadas.length = 0;
    await correr();
    expect(fake.llamadas.filter((l) => l.permisoId.startsWith('perm-seg-'))).toEqual([]);
  });

  it('si Drive falla cuenta el reintento y sigue pendiente; sin editores pendientes no arma el cliente de Drive', async () => {
    fake.estado.falloBorrar = true;
    await correr();
    expect(await editor(A, 'e2')).toMatchObject({ estado: 'revocado_pendiente', reintentos: 1 });
    await correr();
    expect((await editor(A, 'e2'))?.['reintentos']).toBe(2);
    await db.recursiveDelete(db.collection(`tenants/${A}/editoresCrm`));
    await db.recursiveDelete(db.collection(`tenants/${B}/editoresCrm`));
    pedidos.length = 0;
    await correr();
    expect(pedidos.filter((t) => t === A || t === B)).toEqual([]);
  });

  it('respeta el tope: al agotarlo audita una vez y deja de llamar a Drive', async () => {
    fake.estado.falloBorrar = true;
    await db.doc(`tenants/${A}/editoresCrm/e2`).update({ reintentos: MAX_REINTENTOS_REVOCACION - 1 });
    const r = await correr();
    expect(r.agotados).toBeGreaterThanOrEqual(1);
    expect((await auditorias(A, 'editor_crm_reconciliacion_agotada')).length).toBe(1);
    fake.llamadas.length = 0;
    await correr();
    expect(fake.llamadas.filter((l) => l.permisoId === `perm-${A}-e2`)).toEqual([]);
    expect((await auditorias(A, 'editor_crm_reconciliacion_agotada')).length).toBe(1);
  });

  it('cierra lo que dejó el cambio de correo, con su motivo en la auditoría, y no deja acceso', async () => {
    await sembrarEditor(A, 'cambio', 'revocado_pendiente', { motivoPendiente: 'correo_cambiado', reintentos: 0 });
    await correr();
    expect((await editor(A, 'cambio'))?.['estado']).toBe('revocado');
    expect(fake.llamadas.some((l) => l.permisoId === `perm-${A}-cambio`)).toBe(true);
    const aud = await auditorias(A, 'editor_crm_baja');
    expect(aud.some((x) => x['motivo'] === 'correo_cambiado' && x['resultado'] === 'revocado')).toBe(true);
  });

  it('un negocio sin cliente de Drive no frena a los demás', async () => {
    const dep = { drive: (t: string) => (t === A ? null : fake.cliente) };
    await reconciliarEditoresPendientes(dep)();
    expect((await editor(A, 'e2'))?.['estado']).toBe('revocado_pendiente');
    expect((await editor(B, 'e2'))?.['estado']).toBe('revocado');
  });
});

describe('cambio de correo (scripts/plataforma/cambiar-correo.mjs)', () => {
  it('deja a los editores vigentes de la cuenta en revocado_pendiente con motivo correo_cambiado, en el mismo lote', () => {
    const s = readFileSync(fileURLToPath(new URL('../../../scripts/plataforma/cambiar-correo.mjs', import.meta.url)), 'utf8');
    expect(s).toMatch(/editoresCrm\/\$\{uid\}/);
    expect(s).toMatch(/estado: 'revocado_pendiente', motivoPendiente: 'correo_cambiado'/);
    // Va antes del commit del lote que cambia las membresías, y el script no habla con Drive.
    expect(s.indexOf("motivoPendiente: 'correo_cambiado'")).toBeLessThan(s.indexOf('await lote.commit()'));
    expect(s).not.toMatch(/googleapis|drive\.google/i);
  });
});
