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
const CLI = 'asig-clinica';
const VIEJO = '1000000050';
const NUEVO = '1000000051';
const WABA_NUEVA = '1000000052';

function correr(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--operador', 'operador@ejemplo.com', ...args], {
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
  // El cliente que pasa a su propia WABA: su número viejo, con su alias.
  for (const d of [`rutasWhatsApp/${VIEJO}`, `rutasWhatsApp/${NUEVO}`]) await db.doc(d).delete();
  await db.doc(`tenants/${CLI}`).set({ nombre: 'Clínica', estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'],
    waPhoneNumberId: VIEJO, waWabaId: WABA });
  await db.doc(`rutasWhatsApp/${VIEJO}`).set({ tenantId: CLI, flujo: 'agendamiento', aliasSecreto: 'cliente05', estado: 'activo' });
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
    // Sin `--titularidad`, el número es de NovuChat (F1, `Analisis/41` §4): el lado seguro.
    expect(ruta).toMatchObject({ tenantId: T, flujo: 'onboarding', aliasSecreto: 'cliente02', wabaId: WABA, estado: 'activo', titularidad: 'novuchat', asignadoPor: 'operador@ejemplo.com' });
    expect(r.salida).toMatch(/Titular {3}: novuchat \(por defecto\)/);
    const ficha = (await db.doc(`tenants/${T}`).get()).data() ?? {};
    expect(ficha).toMatchObject({ waPhoneNumberId: NUM, waWabaId: WABA, flujos: ['onboarding'] });
    expect((await db.doc(`tenants/${T}/config/onboarding`).get()).exists).toBe(true);
    const auditoria = await db.collection(`tenants/${T}/auditoria`).where('accion', '==', 'asignar_numero').get();
    expect(auditoria.size).toBeGreaterThanOrEqual(1);
    expect(auditoria.docs[0]?.data()).toMatchObject({ uid: 'operador@ejemplo.com', origen: 'script', script: 'asignar-numero' });
  });

  it('sin --operador, o con uno que no es un correo, no conecta (LOW-3)', () => {
    for (const operador of [null, 'asignar-numero', 'andres']) {
      const args = [SCRIPT, '--proyecto', PROYECTO, '--tenant', T, '--numero', NUM, '--waba', WABA, '--flujo', 'onboarding', '--alias', 'cliente02',
        ...(operador === null ? [] : ['--operador', operador]), '--aplicar'];
      const o = spawnSync(process.execPath, args, { env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8' });
      expect(o.status, String(operador)).toBe(2);
      expect(`${o.stdout}${o.stderr}`).toMatch(/--operador <correo> es obligatorio/);
    }
  });

  it('repetir la misma asignación no rompe nada', async () => {
    const r = asignar('cliente02', ['--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/ya existía, se actualiza/);
    expect((await db.doc(`tenants/${T}`).get()).get('flujos')).toEqual(['onboarding']);
  });

  it('--titularidad comercio la escribe (el comercio trae su WABA y paga Meta); fuera de la lista, no', async () => {
    const mala = asignar('cliente02', ['--titularidad', 'byoc', '--aplicar']);
    expect(mala.codigo).toBe(2);
    expect(mala.salida).toMatch(/--titularidad desconocida: byoc. Una de: novuchat, comercio/);
    expect((await db.doc(`rutasWhatsApp/${NUM}`).get()).get('titularidad')).toBe('novuchat');
    const r = asignar('cliente02', ['--titularidad', 'comercio', '--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Titular {3}: comercio$/m);
    expect((await db.doc(`rutasWhatsApp/${NUM}`).get()).get('titularidad')).toBe('comercio');
    const auditoria = await db.collection(`tenants/${T}/auditoria`).where('titularidad', '==', 'comercio').get();
    expect(auditoria.size).toBeGreaterThanOrEqual(1);
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

  // EL CLIENTE PASA A SU PROPIA WABA (Platinum, 21/09/2026): el mismo número
  // con un Phone ID nuevo, y el mismo alias. Se escribe negando.
  describe('--reemplaza: el Phone ID nuevo de un número que cambió de WABA', () => {
    const mover = (extra: string[] = [], viejo = VIEJO, alias = 'cliente05') =>
      correr('--tenant', CLI, '--numero', NUEVO, '--waba', WABA_NUEVA, '--flujo', 'agendamiento',
        '--alias', alias, '--reemplaza', viejo, ...extra);

    it('sin --reemplaza, el alias del número viejo bloquea el nuevo (como siempre)', async () => {
      const r = correr('--tenant', CLI, '--numero', NUEVO, '--waba', WABA_NUEVA, '--flujo', 'agendamiento',
        '--alias', 'cliente05', '--aplicar');
      expect(r.codigo).not.toBe(0);
      expect(r.salida).toMatch(/El alias cliente05 ya lo usa el número/);
      expect((await db.doc(`rutasWhatsApp/${NUEVO}`).get()).exists).toBe(false);
    });

    it('NO libera la ruta de OTRO comercio', async () => {
      const r = mover(['--aplicar'], NUM_OTRO, 'cliente01');
      expect(r.codigo).not.toBe(0);
      expect(r.salida).toMatch(/es de OTRO comercio/);
      expect((await db.doc(`rutasWhatsApp/${NUM_OTRO}`).get()).get('tenantId')).toBe(OTRO);
      expect((await db.doc(`rutasWhatsApp/${NUEVO}`).get()).exists).toBe(false);
    });

    it('NO reemplaza un número que usa otro alias', async () => {
      const r = mover(['--aplicar'], VIEJO, 'cliente06');
      expect(r.codigo).not.toBe(0);
      expect(r.salida).toMatch(/usa el alias cliente05, no cliente06/);
      expect((await db.doc(`rutasWhatsApp/${VIEJO}`).get()).exists).toBe(true);
    });

    it('NO reemplaza un número que no tiene ruta', async () => {
      const r = mover(['--aplicar'], '1000000059');
      expect(r.codigo).not.toBe(0);
      expect(r.salida).toMatch(/no tiene ruta/);
    });

    it('--reemplaza igual a --numero se rechaza antes de conectar', () => {
      const r = mover([], NUEVO);
      expect(r.codigo).toBe(2);
      expect(r.salida).toMatch(/--reemplaza es el mismo número/);
    });

    it('en seco no toca ninguna de las dos rutas', async () => {
      const r = mover();
      expect(r.codigo, r.salida).toBe(0);
      expect(r.salida).toMatch(/Ruta vieja: …0050 se borra/);
      expect((await db.doc(`rutasWhatsApp/${VIEJO}`).get()).exists).toBe(true);
      expect((await db.doc(`rutasWhatsApp/${NUEVO}`).get()).exists).toBe(false);
    });

    it('con --aplicar: la ruta vieja se borra, la nueva lleva el MISMO alias, y queda en la auditoría', async () => {
      const r = mover(['--aplicar']);
      expect(r.codigo, r.salida).toBe(0);
      expect(r.salida).toMatch(/✓ Verificación/);
      expect((await db.doc(`rutasWhatsApp/${VIEJO}`).get()).exists).toBe(false);
      expect((await db.doc(`rutasWhatsApp/${NUEVO}`).get()).data()).toMatchObject(
        { tenantId: CLI, flujo: 'agendamiento', aliasSecreto: 'cliente05', wabaId: WABA_NUEVA });
      expect((await db.doc(`tenants/${CLI}`).get()).data()).toMatchObject(
        { waPhoneNumberId: NUEVO, waWabaId: WABA_NUEVA, flujos: ['agendamiento'] });
      const aud = await db.collection(`tenants/${CLI}/auditoria`).where('reemplazaA', '==', VIEJO).get();
      expect(aud.size).toBe(1);
      expect(r.salida).not.toContain(VIEJO);
      expect(r.salida).not.toContain(NUEVO);
    });
  });
});
