/**
 * `scripts/asignar-numero.mjs` — EL PASO 3 DEL ALTA, CONTRA EL EMULADOR.
 *
 * El script escribe en producción con el SDK Admin, que se salta las reglas: lo
 * único que impide asignar un número a otro comercio o repetir un alias es su
 * propia transacción. Por eso se prueba ejecutándolo de verdad, como proceso,
 * contra el emulador que levanta `pruebas/correr.sh`, y se escribe negando:
 * lo que no debe pasar, no pasa.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
// La variable permite correr esta suite contra otra versión del script (así se
// comprobó que la prueba del bloqueo falla con la versión que lanzaba).
const SCRIPT = process.env['ASIGNAR_NUMERO_SCRIPT'] ?? join(aqui, '..', 'scripts', 'asignar-numero.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'asignar') ?? initializeApp({ projectId: PROYECTO }, 'asignar');
const db = getFirestore(app);

// Identificadores propios de esta suite, para no pisar a ninguna otra.
const T = 'asig-novuchat';
const OTRO = 'asig-otro';
const NUM = '1000000033';
const NUM_OTRO = '1000000011';
const WABA = '1000000048';

function correr(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...args], {
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8',
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const asignar = (alias: string, extra: string[] = [], numero = NUM, tenant = T) =>
  correr('--tenant', tenant, '--numero', numero, '--waba', WABA, '--flujo', 'onboarding', '--alias', alias, ...extra);

beforeAll(async () => {
  for (const d of [`rutasWhatsApp/${NUM}`, `tenants/${T}/config/onboarding`]) await db.doc(d).delete();
  await db.doc(`tenants/${T}`).set({ nombre: 'NovuChat', estado: 'activo', vertical: 'onboarding', flujos: ['onboarding'] });
  await db.doc(`tenants/${OTRO}`).set({ nombre: 'Otro', estado: 'activo', vertical: 'venta', flujos: ['venta'] });
  // Un número AJENO que ya usa el alias cliente01.
  await db.doc(`rutasWhatsApp/${NUM_OTRO}`).set({ tenantId: OTRO, flujo: 'venta', aliasSecreto: 'cliente01', estado: 'activo' });
});

describe('asignar-numero.mjs', () => {
  it('sin los argumentos no hace nada', () => {
    const r = correr('--tenant', T);
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/--numero no es un phone_number_id/);
  });

  it('solo acepta alias de la reserva de firma.ts', () => {
    const r = asignar('cualquiera');
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/--alias no está en la reserva/);
  });

  it('--listar muestra los alias tomados y el siguiente libre', () => {
    const r = correr('--listar');
    expect(r.codigo).toBe(0);
    expect(r.salida).toMatch(/alias cliente01/);
    expect(r.salida).toMatch(/Siguiente para un cliente: cliente02/);
    // Nunca un identificador completo en pantalla.
    expect(r.salida).not.toContain(NUM_OTRO);
  });

  it('en seco no escribe nada', async () => {
    const r = asignar('cliente02');
    expect(r.codigo).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect((await db.doc(`rutasWhatsApp/${NUM}`).get()).exists).toBe(false);
  });

  it('con --aplicar escribe la ruta con su alias, la ficha, la config y la auditoría', async () => {
    const r = asignar('cliente02', ['--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación/);
    const ruta = (await db.doc(`rutasWhatsApp/${NUM}`).get()).data() ?? {};
    expect(ruta).toMatchObject({ tenantId: T, flujo: 'onboarding', aliasSecreto: 'cliente02', wabaId: WABA, estado: 'activo' });
    const ficha = (await db.doc(`tenants/${T}`).get()).data() ?? {};
    expect(ficha).toMatchObject({ waPhoneNumberId: NUM, waWabaId: WABA, flujos: ['onboarding'] });
    expect((await db.doc(`tenants/${T}/config/onboarding`).get()).exists).toBe(true);
    const auditoria = await db.collection(`tenants/${T}/auditoria`).where('accion', '==', 'asignar_numero').get();
    expect(auditoria.size).toBeGreaterThanOrEqual(1);
  });

  it('repetir la misma asignación no rompe nada', async () => {
    const r = asignar('cliente02', ['--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/ya existía, se actualiza/);
    expect((await db.doc(`tenants/${T}`).get()).get('flujos')).toEqual(['onboarding']);
  });

  it('NO reutiliza un alias que ya usa otro número', async () => {
    const r = asignar('cliente01', ['--aplicar'], '1000000034');
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/El alias cliente01 ya lo usa el número/);
    expect((await db.doc('rutasWhatsApp/1000000034').get()).exists).toBe(false);
  });

  it('NO se lleva el número de otro comercio', async () => {
    const r = asignar('cliente03', ['--aplicar'], NUM_OTRO);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/ya está asignado a OTRO comercio/);
    expect((await db.doc(`rutasWhatsApp/${NUM_OTRO}`).get()).get('tenantId')).toBe(OTRO);
  });

  it('NO asigna a un comercio que no existe', () => {
    const r = asignar('cliente04', ['--aplicar'], '1000000035', 'asig-no-existe');
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/No existe el comercio/);
  });

  // UN RECHAZO NO DEJA BLOQUEOS. Antes el script lanzaba dentro de la
  // transacción y salía con `process.exit` antes de que el rollback (que el SDK
  // manda sin esperar) llegara: la ruta y la ficha que había leído quedaban
  // bloqueadas ~67 s en el emulador, y la escritura siguiente sobre ellas
  // esperaba ese tiempo o fallaba con `Transaction lock timeout`. Ahora el
  // rechazo se devuelve y la transacción cierra limpia. Si vuelve a lanzar,
  // esta prueba excede su tiempo y falla.
  it('después de un rechazo, la ruta y la ficha que leyó se escriben al instante', async () => {
    const r = asignar('cliente03', ['--aplicar'], NUM_OTRO);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/ya está asignado a OTRO comercio/);
    const inicio = Date.now();
    await db.runTransaction(async (tx) => {
      const [ruta, ficha] = await Promise.all([
        tx.get(db.doc(`rutasWhatsApp/${NUM_OTRO}`)), tx.get(db.doc(`tenants/${T}`)),
      ]);
      tx.update(ruta.ref, { revisadoEn: Date.now() });
      tx.update(ficha.ref, { revisadoEn: Date.now() });
    });
    expect(Date.now() - inicio).toBeLessThan(10_000);
  }, 20_000);
});
