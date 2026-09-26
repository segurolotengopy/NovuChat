/**
 * `registrarCambioOperado` (functions/src/central/cambiosOperados.ts), LA
 * CALLABLE REAL, contra el emulador de Firestore.
 *
 * Es el límite de `cambiosIncluidos` HECHO CUMPLIR EN EL SERVIDOR (`CLAUDE.md`,
 * Base comercial §7; `Analisis/41` §4.4). Se escribe negando: con el plan
 * chico, el cambio número N+1 NO entra ni construyendo la petición a mano; un
 * administrador del comercio NO puede llamarla; y lo que se niega no deja
 * rastro. Se invoca con `.run()`, que es la misma función que despliega
 * Firebase, con un contexto de autenticación fabricado.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { limitesDe } from '../../functions/src/planes.ts';
import { mesBolivia } from '../../functions/src/prepago.ts';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const { registrarCambioOperado } = await import('../../functions/src/index.ts');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const T = 'cambios-op';
const PROPIETARIO = { uid: 'prop-c', token: { nc: { p: true }, firebase: { sign_in_provider: 'google.com' } } };
const PROPIETARIO_CON_CONTRASENA = { uid: 'prop-c2', token: { nc: { p: true }, firebase: { sign_in_provider: 'password' } } };
const ADMIN_DEL_COMERCIO = {
  uid: 'adm-c', token: { nc: { t: { [T]: 'admin' } }, firebase: { sign_in_provider: 'password' }, email_verified: true },
};

type Peticion = Parameters<typeof registrarCambioOperado.run>[0];
const llamar = (data: Record<string, unknown>, auth: object | null = PROPIETARIO) =>
  registrarCambioOperado.run({ data, auth, rawRequest: {} } as unknown as Peticion);
async function rechaza(p: Promise<unknown>, codigo: string) {
  await expect(p).rejects.toMatchObject({ code: codigo });
}
const cuenta = async () => (await db.doc(`tenants/${T}/cuenta/estado`).get()).data() ?? {};
const auditoria = async () =>
  (await db.collection(`tenants/${T}/auditoria`).where('accion', '==', 'cambio_operado').get()).docs.map((d) => d.data());
const MES = mesBolivia(Date.now());
const DESCRIPCION = 'Cambio del horario de atención a pedido del comercio';

async function sembrar(datos: Record<string, unknown> | null) {
  const previas = await db.collection(`tenants/${T}/auditoria`).get();
  for (const d of previas.docs) await d.ref.delete();
  await db.doc(`tenants/${T}`).set({ nombre: 'Cambios', estado: 'activo', plan: 'crecimiento' });
  if (datos) await db.doc(`tenants/${T}/cuenta/estado`).set(datos);
  else await db.doc(`tenants/${T}/cuenta/estado`).delete();
}

// Crecimiento incluye 1 cambio al mes; en prepago, cubierto.
const CRECIMIENTO = { plan: 'crecimiento', limites: limitesDe('crecimiento'), modalidad: 'prepago', periodoPagado: '2099-12' };

beforeEach(() => sembrar(CRECIMIENTO));

describe('Quién puede llamarla', () => {
  it('el administrador del comercio NO puede, ni sobre su propio comercio', async () => {
    await rechaza(llamar({ tenantId: T, descripcion: DESCRIPCION }, ADMIN_DEL_COMERCIO), 'permission-denied');
    expect((await cuenta())['cambios']).toBeUndefined();
    expect(await auditoria()).toHaveLength(0);
  });

  it('el claim de propietario con una sesión de CONTRASEÑA no alcanza (T-19)', async () => {
    await rechaza(llamar({ tenantId: T, descripcion: DESCRIPCION }, PROPIETARIO_CON_CONTRASENA), 'permission-denied');
  });

  it('sin sesión, NO', async () => {
    await rechaza(llamar({ tenantId: T, descripcion: DESCRIPCION }, null), 'unauthenticated');
  });
});

describe('La forma de la petición', () => {
  it('sin descripción, o con una de menos de 10 caracteres, NO registra', async () => {
    for (const descripcion of [undefined, '', 'corto', 7, null]) {
      await rechaza(llamar({ tenantId: T, descripcion }), 'invalid-argument');
    }
    expect((await cuenta())['cambios']).toBeUndefined();
  });

  it('un tenant inválido o inexistente NO registra', async () => {
    await rechaza(llamar({ tenantId: 'Con Espacios', descripcion: DESCRIPCION }), 'invalid-argument');
    await rechaza(llamar({ tenantId: 'cambios-no-existe', descripcion: DESCRIPCION }), 'not-found');
    expect((await db.doc('tenants/cambios-no-existe/cuenta/estado').get()).exists).toBe(false);
  });

  it('`forzar` tiene que ser booleano', async () => {
    await rechaza(llamar({ tenantId: T, descripcion: DESCRIPCION, forzar: 'sí' }), 'invalid-argument');
  });
});

describe('El límite se hace cumplir en el servidor', () => {
  it('el primero del mes entra; el segundo (N+1 con Crecimiento) NO, y no deja rastro', async () => {
    const r = await llamar({ tenantId: T, descripcion: DESCRIPCION });
    expect(r).toMatchObject({ ok: true, mes: MES, usados: 1, incluidos: 1, forzado: false, ilimitado: false });
    expect((await cuenta())['cambios']).toEqual({ [MES]: 1 });

    await rechaza(llamar({ tenantId: T, descripcion: 'Otro cambio pedido el mismo mes' }), 'resource-exhausted');
    expect((await cuenta())['cambios']).toEqual({ [MES]: 1 });
    const a = await auditoria();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ uid: 'prop-c', mes: MES, numero: 1, incluidos: 1, forzado: false, descripcion: DESCRIPCION, modalidad: 'prepago' });
  });

  it('con `forzar: true` el N+1 entra, y queda escrito que fue forzado', async () => {
    await llamar({ tenantId: T, descripcion: DESCRIPCION });
    const r = await llamar({ tenantId: T, descripcion: 'Cambio extra, se cobra aparte', forzar: true });
    expect(r).toMatchObject({ ok: true, usados: 2, incluidos: 1, forzado: true });
    expect((await cuenta())['cambios']).toEqual({ [MES]: 2 });
    const forzados = (await auditoria()).filter((x) => x['forzado'] === true);
    expect(forzados).toHaveLength(1);
    expect(forzados[0]).toMatchObject({ numero: 2, descripcion: 'Cambio extra, se cobra aparte' });
    // `forzar: false` explícito no fuerza.
    await rechaza(llamar({ tenantId: T, descripcion: 'Un tercero sin forzar', forzar: false }), 'resource-exhausted');
  });

  it('manda la COPIA de la cuenta: con `limites.cambiosIncluidos: 0` NO entra ni el primero; con 3, entran tres', async () => {
    await sembrar({ ...CRECIMIENTO, limites: { ...limitesDe('crecimiento'), cambiosIncluidos: 0 } });
    await rechaza(llamar({ tenantId: T, descripcion: DESCRIPCION }), 'resource-exhausted');
    expect((await cuenta())['cambios']).toBeUndefined();

    // Lo vendido a medida («hasta 4 al mes» era un caso real): la copia manda sobre el plan.
    await sembrar({ plan: 'impulso', limites: { ...limitesDe('impulso'), cambiosIncluidos: 3 }, modalidad: 'prepago', periodoPagado: '2099-12' });
    for (let i = 1; i <= 3; i += 1) {
      expect((await llamar({ tenantId: T, descripcion: `Cambio número ${i} del contrato` })).usados).toBe(i);
    }
    await rechaza(llamar({ tenantId: T, descripcion: 'El cuarto no entra' }), 'resource-exhausted');
    expect((await cuenta())['cambios']).toEqual({ [MES]: 3 });
  });

  it('sin copia, rige el plan: Impulso incluye 0 y NO entra ninguno', async () => {
    await sembrar({ plan: 'impulso', modalidad: 'prepago', periodoPagado: '2099-12' });
    await rechaza(llamar({ tenantId: T, descripcion: DESCRIPCION }), 'resource-exhausted');
  });

  it('el mes anterior no cuenta: con 5 registrados en otro mes, el primero de este entra', async () => {
    await sembrar({ ...CRECIMIENTO, cambios: { '2020-01': 5 } });
    const r = await llamar({ tenantId: T, descripcion: DESCRIPCION });
    expect(r.usados).toBe(1);
    expect((await cuenta())['cambios']).toEqual({ '2020-01': 5, [MES]: 1 });
  });

  it('una DEMOSTRACIÓN se cuenta y nunca se niega, con cualquier plan', async () => {
    await sembrar({ plan: 'impulso', limites: limitesDe('impulso'), modalidad: 'demostracion' });
    for (let i = 1; i <= 3; i += 1) {
      const r = await llamar({ tenantId: T, descripcion: `Ajuste ${i} del demo` });
      expect(r).toMatchObject({ usados: i, incluidos: null, ilimitado: true, forzado: false });
    }
    expect((await cuenta())['cambios']).toEqual({ [MES]: 3 });
    expect((await auditoria())[0]).toMatchObject({ incluidos: null, modalidad: 'demostracion' });
  });

  it('un comercio SIN cuenta (o sin modalidad) es demostración por ausencia: se le crea la cuenta con el contador', async () => {
    await sembrar(null);
    const r = await llamar({ tenantId: T, descripcion: DESCRIPCION });
    expect(r).toMatchObject({ usados: 1, ilimitado: true });
    expect(await cuenta()).toMatchObject({ cambios: { [MES]: 1 } });
  });
});
