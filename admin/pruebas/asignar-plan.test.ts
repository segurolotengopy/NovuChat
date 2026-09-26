/**
 * `scripts/asignar-plan.mjs`, CONTRA EL EMULADOR.
 *
 * El script escribe con el SDK Admin, que se salta las reglas: lo único que
 * impide asignar un plan inventado, pisar la mensualidad de un comercio o
 * cambiar la titularidad de un número ajeno es su propia validación. Por eso
 * se prueba ejecutándolo de verdad, como proceso, contra el emulador que
 * levanta `pruebas/correr.sh`, y se escribe negando.
 *
 * Desde F1 (`Analisis/41` §4) el script escribe los tres ejes más el modelo y
 * los umbrales; el plan sigue siendo lo primero que se prueba, y
 * `demostracion` YA NO ES UN PLAN: un demo es `--plan <del catálogo>
 * --modalidad demostracion`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CATALOGO_PLANES, MAXIMO_CAMBIOS_INCLUIDOS, limitesDe } from '../functions/src/planes.ts';
import { PRUEBA, estadoDeServicio, mesBolivia, sumarMeses } from '../functions/src/prepago.ts';
import { cambiosDelMes } from '../functions/src/central/ejes.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'asignar-plan.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'asignar-plan') ?? initializeApp({ projectId: PROYECTO }, 'asignar-plan');
const db = getFirestore(app);

// Identificadores propios de esta suite, para no pisar a ninguna otra.
const T = 'plan-demo';
const BAJA = 'plan-baja';
const SIN_CUENTA = 'plan-sin-cuenta';
const OTRO = 'plan-otro';
const CONTRATO = 'plan-contrato';
const CONTRATO_SIN_CUENTA = 'plan-contrato-sin-cuenta';
const NUM_T = '1000000071';
const NUM_OTRO = '1000000072';
const NUM_SIN_RUTA = '1000000073';

function correr(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--operador', 'operador@ejemplo.com', ...args], {
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8',
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const cuenta = async (t = T) => (await db.doc(`tenants/${t}/cuenta/estado`).get()).data() ?? {};
const ficha = async (t = T) => (await db.doc(`tenants/${t}`).get()).data() ?? {};
const ruta = async (n: string) => (await db.doc(`rutasWhatsApp/${n}`).get()).data() ?? {};
const auditorias = async (accion: string, t = T) =>
  (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', accion).get()).docs.map((d) => d.data());

beforeAll(async () => {
  for (const t of [T, BAJA, SIN_CUENTA, OTRO, CONTRATO, CONTRATO_SIN_CUENTA]) {
    const previas = await db.collection(`tenants/${t}/auditoria`).get();
    for (const d of previas.docs) await d.ref.delete();
    await db.doc(`tenants/${t}/cuenta/estado`).delete();
  }
  // Un demo como los de hoy: plan viejo, sin copia de límites, sin modalidad,
  // con umbrales y estado de pago cargados que el script NO debe tocar.
  await db.doc(`tenants/${T}`).set({ nombre: 'Demo', estado: 'activo', plan: 'basico', flujos: ['venta'] });
  await db.doc(`tenants/${T}/cuenta/estado`).set({
    plan: 'basico', estadoPago: 'sin_cargo', montoMensual: 0, moneda: 'BOB',
    motivoVisible: 'Comercio de demostración', umbralOperador: 3, umbralBloqueo: 5,
  });
  await db.doc(`tenants/${BAJA}`).set({ nombre: 'Se fue', estado: 'dado_de_baja', plan: 'basico' });
  await db.doc(`tenants/${SIN_CUENTA}`).set({ nombre: 'Nuevo', estado: 'activo', plan: 'basico' });
  await db.doc(`tenants/${OTRO}`).set({ nombre: 'Otro', estado: 'activo', plan: 'pro' });
  await db.doc(`rutasWhatsApp/${NUM_T}`).set({ tenantId: T, flujo: 'venta', aliasSecreto: 'demoB', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUM_OTRO}`).set({ tenantId: OTRO, flujo: 'venta', aliasSecreto: 'cliente50', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUM_SIN_RUTA}`).delete();
  // Un comercio en producción con Pro (2 cambios al mes), sin contrato todavía.
  await db.doc(`tenants/${CONTRATO}`).set({ nombre: 'Contrato', estado: 'activo', plan: 'pro', flujos: ['agendamiento'] });
  await db.doc(`tenants/${CONTRATO}/cuenta/estado`).set({
    plan: 'pro', limites: limitesDe('pro'), catalogoPlanes: CATALOGO_PLANES, modalidad: 'prepago', periodoPagado: '2099-12',
  });
  await db.doc(`tenants/${CONTRATO_SIN_CUENTA}`).set({ nombre: 'Sin cuenta', estado: 'activo', plan: 'basico' });
});

describe('asignar-plan.mjs: el plan', () => {
  it('sin ningún eje no hace nada; sin --operador (o con uno que no es un correo) tampoco (LOW-3)', () => {
    const r = correr('--tenant', T);
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/nada que asignar/);
    for (const args of [[], ['--operador', 'asignar-plan'], ['--operador', 'andres']]) {
      const o = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--tenant', T, '--plan', 'pro', ...args],
        { env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8' });
      expect(o.status, args.join(' ')).toBe(2);
      expect(`${o.stdout}${o.stderr}`).toMatch(/--operador <correo> es obligatorio/);
    }
  });

  it('NO acepta un plan que no está en el catálogo: ni el viejo «basico» ni el viejo «demostracion»', async () => {
    for (const plan of ['basico', 'premium', 'Pro', 'toString', 'demostracion']) {
      const r = correr('--tenant', T, '--plan', plan, '--aplicar');
      expect(r.codigo, plan).toBe(2);
      expect(r.salida).toMatch(/Del catálogo: impulso, crecimiento, pro, byoc$/m);
    }
    expect((await cuenta()).plan).toBe('basico');
  });

  it('en seco no escribe nada, y muestra el antes y el después', async () => {
    const r = correr('--tenant', T, '--plan', 'pro');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect(r.salida).toMatch(/Antes {5}: plan basico/);
    expect(r.salida).toMatch(/500 conversaciones · 500 productos · 10 agendas · 2 cambios\/mes/);
    expect((await cuenta()).plan).toBe('basico');
    expect(await auditorias('cambiar_plan')).toHaveLength(0);
  });

  it('con --aplicar escribe plan, copia de límites (con cambiosIncluidos), catálogo, espejo y auditoría', async () => {
    const r = correr('--tenant', T, '--plan', 'pro', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación/);
    expect(await cuenta()).toMatchObject({ plan: 'pro', limites: limitesDe('pro'), catalogoPlanes: CATALOGO_PLANES });
    expect((await ficha()).plan).toBe('pro');
    const a = await auditorias('cambiar_plan');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      uid: 'operador@ejemplo.com', origen: 'script', script: 'asignar-plan', planAntes: 'basico', planDespues: 'pro', limitesAntes: null, limitesDespues: limitesDe('pro'),
    });
  });

  it('NO toca el estado de pago, la mensualidad, la moneda, el motivo ni los umbrales de una cuenta SIN modalidad (LOW 8)', async () => {
    expect(await cuenta()).toMatchObject({
      estadoPago: 'sin_cargo', montoMensual: 0, moneda: 'BOB',
      motivoVisible: 'Comercio de demostración', umbralOperador: 3, umbralBloqueo: 5,
    });
  });

  it('repetirlo no escribe nada ni deja otra auditoría', async () => {
    const r = correr('--tenant', T, '--plan', 'pro', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Sin cambios/);
    expect(await auditorias('cambiar_plan')).toHaveLength(1);
  });

  it('cambiar de plan reemplaza la copia entera y audita el antes', async () => {
    const r = correr('--tenant', T, '--plan', 'crecimiento', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect((await cuenta()).limites).toEqual(limitesDe('crecimiento'));
    const a = (await auditorias('cambiar_plan')).find((x) => x['planDespues'] === 'crecimiento');
    expect(a).toMatchObject({ planAntes: 'pro', limitesAntes: limitesDe('pro') });
  });

  it('crea la cuenta si el comercio no la tenía', async () => {
    const r = correr('--tenant', SIN_CUENTA, '--plan', 'impulso', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(await cuenta(SIN_CUENTA)).toMatchObject({ plan: 'impulso', limites: limitesDe('impulso') });
  });

  it('NO asigna plan a un comercio que no existe', () => {
    const r = correr('--tenant', 'plan-no-existe', '--plan', 'pro', '--aplicar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/No existe el comercio/);
  });

  it('NO asigna plan a un comercio dado de baja', async () => {
    const r = correr('--tenant', BAJA, '--plan', 'pro', '--aplicar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/dado de baja/);
    expect((await db.doc(`tenants/${BAJA}/cuenta/estado`).get()).exists).toBe(false);
    expect((await db.doc(`tenants/${BAJA}`).get()).get('plan')).toBe('basico');
  });

  it('un rechazo NO deja documentos bloqueados: escribirlos enseguida no espera', async () => {
    // Si el script lanzara dentro de la transacción y terminara, el rollback
    // (que el SDK no espera) no llegaría y el emulador retendría el bloqueo de
    // la ficha y la cuenta hasta que venza (~60 s). Se mide el tiempo de una
    // escritura sobre esos mismos documentos justo después del rechazo.
    expect(correr('--tenant', BAJA, '--plan', 'pro', '--aplicar').codigo).toBe(1);
    const t0 = Date.now();
    await db.doc(`tenants/${BAJA}`).update({ tocadoPorLaPrueba: true });
    await db.doc(`tenants/${BAJA}/cuenta/estado`).set({ tocadoPorLaPrueba: true });
    await db.doc(`tenants/${BAJA}/cuenta/estado`).delete();
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 15_000);
});

describe('asignar-plan.mjs: los otros ejes (F1)', () => {
  it('--modalidad demostracion convierte al demo: sin cargo, monto cero, USD; con auditoría estado_cuenta', async () => {
    const r = correr('--tenant', T, '--modalidad', 'demostracion', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Derivados : \{"estadoPago":"sin_cargo","montoMensual":0,"moneda":"USD"\}/);
    expect(await cuenta()).toMatchObject({
      plan: 'crecimiento', modalidad: 'demostracion', estadoPago: 'sin_cargo', montoMensual: 0, moneda: 'USD',
      motivoVisible: 'Comercio de demostración', umbralOperador: 3, umbralBloqueo: 5,
    });
    const [a] = await auditorias('estado_cuenta');
    expect(a).toMatchObject({ uid: 'operador@ejemplo.com', origen: 'script', campos: ['modalidad'], valores: { modalidad: 'demostracion' } });
  });

  it('--modalidad fuera de la lista no entra; --modalidad prueba inicializa el mes y la bolsa', async () => {
    const mala = correr('--tenant', T, '--modalidad', 'gratis', '--aplicar');
    expect(mala.codigo).toBe(2);
    expect(mala.salida).toMatch(/--modalidad desconocida/);
    const r = correr('--tenant', SIN_CUENTA, '--modalidad', 'prueba', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(await cuenta(SIN_CUENTA)).toMatchObject({
      modalidad: 'prueba', periodoPrueba: mesBolivia(Date.now()), bolsaPrueba: PRUEBA.conversaciones, montoMensual: 0,
    });
  });

  it('--modelo escribe la ficha, con la auditoría asignar_ejes; uno fuera de la lista, no', async () => {
    const mal = correr('--tenant', T, '--modelo', 'gemini', '--aplicar');
    expect(mal.codigo).toBe(2);
    expect(mal.salida).toMatch(/--modelo desconocido/);
    expect((await ficha()).modelo).toBeUndefined();
    const r = correr('--tenant', T, '--modelo', 'claude-haiku-4-5', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect((await ficha()).modelo).toBe('claude-haiku-4-5');
    const [a] = await auditorias('asignar_ejes');
    expect(a).toMatchObject({ modeloAntes: 'gemini-3.5-flash-lite', modeloDespues: 'claude-haiku-4-5' });
    // No toca la cuenta.
    expect((await cuenta()).modalidad).toBe('demostracion');
  });

  it('--titularidad exige --numero, el número tiene que tener ruta y ser de ESTE comercio', async () => {
    expect(correr('--tenant', T, '--titularidad', 'comercio', '--aplicar').codigo).toBe(2);
    expect(correr('--tenant', T, '--numero', NUM_T, '--aplicar').codigo).toBe(2);
    expect(correr('--tenant', T, '--titularidad', 'byoc', '--numero', NUM_T, '--aplicar').codigo).toBe(2);
    const ajeno = correr('--tenant', T, '--titularidad', 'comercio', '--numero', NUM_OTRO, '--aplicar');
    expect(ajeno.codigo).toBe(1);
    expect(ajeno.salida).toMatch(/es de OTRO comercio/);
    expect((await ruta(NUM_OTRO))['titularidad']).toBeUndefined();
    const sinRuta = correr('--tenant', T, '--titularidad', 'comercio', '--numero', NUM_SIN_RUTA, '--aplicar');
    expect(sinRuta.codigo).toBe(1);
    expect(sinRuta.salida).toMatch(/no tiene ruta/);
  });

  it('--titularidad comercio escribe la ruta, sin mostrar el número completo, y audita', async () => {
    const r = correr('--tenant', T, '--titularidad', 'comercio', '--numero', NUM_T, '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).not.toContain(NUM_T);
    expect(r.salida).toMatch(/…0071 → titularidad comercio/);
    expect(await ruta(NUM_T)).toMatchObject({ titularidad: 'comercio', titularidadPor: 'operador@ejemplo.com', tenantId: T });
    const a = (await auditorias('asignar_ejes')).find((x) => x['phoneNumberId'] === NUM_T);
    expect(a).toMatchObject({ titularidadAntes: 'novuchat', titularidadDespues: 'comercio' });
    // Repetir: sin cambios.
    expect(correr('--tenant', T, '--titularidad', 'comercio', '--numero', NUM_T, '--aplicar').salida).toMatch(/Sin cambios/);
  });

  it('los umbrales se validan como en atencion.ts: bloqueo mayor que operador, o nada', async () => {
    const mal = correr('--tenant', T, '--umbral-operador', '5', '--umbral-bloqueo', '3', '--aplicar');
    expect(mal.codigo).toBe(1);
    expect(mal.salida).toMatch(/mayor que el de operador/);
    expect(await cuenta()).toMatchObject({ umbralOperador: 3, umbralBloqueo: 5 });
    expect(correr('--tenant', T, '--umbral-operador', 'x', '--aplicar').codigo).toBe(2);
    const r = correr('--tenant', T, '--umbral-operador', '10', '--umbral-bloqueo', '20', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(await cuenta()).toMatchObject({ umbralOperador: 10, umbralBloqueo: 20 });
  });

  it('todo junto, en una sola corrida, en seco y aplicado', async () => {
    const seco = correr('--tenant', SIN_CUENTA, '--plan', 'byoc', '--modalidad', 'prepago', '--modelo', 'claude-sonnet-5');
    expect(seco.codigo, seco.salida).toBe(0);
    expect(seco.salida).toMatch(/Seco/);
    expect((await cuenta(SIN_CUENTA)).plan).toBe('impulso');
    const r = correr('--tenant', SIN_CUENTA, '--plan', 'byoc', '--modalidad', 'prepago', '--modelo', 'claude-sonnet-5', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(await cuenta(SIN_CUENTA)).toMatchObject({
      plan: 'byoc', limites: limitesDe('byoc'), modalidad: 'prepago', estadoPago: 'vencido', montoMensual: 50,
    });
    expect(await ficha(SIN_CUENTA)).toMatchObject({ plan: 'byoc', modelo: 'claude-sonnet-5' });
  });
});

describe('asignar-plan.mjs: --cambios, los cambios incluidos por contrato', () => {
  const c = CONTRATO;

  it('un valor fuera de rango o que no es un entero NO entra (misma validación que el servidor), y no escribe nada', async () => {
    for (const malo of ['-1', String(MAXIMO_CAMBIOS_INCLUIDOS + 1), '2.5', '4a', 'x', '', 'Plan']) {
      const r = correr('--tenant', c, '--cambios', malo, '--aplicar');
      expect(r.codigo, malo).toBe(2);
      expect(r.salida).toMatch(new RegExp(`--cambios inválido.*de 0 a ${MAXIMO_CAMBIOS_INCLUIDOS}`));
    }
    expect((await cuenta(c)).limites).toEqual(limitesDe('pro'));
    expect((await cuenta(c)).limitesPorContrato).toBeUndefined();
  });

  it('sin cuenta NO fija un contrato suelto: primero --plan', async () => {
    const r = correr('--tenant', CONTRATO_SIN_CUENTA, '--cambios', '4', '--aplicar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no tiene cuenta: primero --plan/);
    expect((await db.doc(`tenants/${CONTRATO_SIN_CUENTA}/cuenta/estado`).get()).exists).toBe(false);
  });

  it('en seco dice el antes y el después, y no escribe', async () => {
    const r = correr('--tenant', c, '--cambios', '4');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Contrato  : cambiosIncluidos 2 del plan → 4 por contrato/);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect((await cuenta(c)).limites).toEqual(limitesDe('pro'));
    expect(await auditorias('limites_por_contrato', c)).toHaveLength(0);
  });

  it('con --aplicar fija la copia y el marcador, audita, relee; y el contador la respeta (4, no los 2 del plan)', async () => {
    const r = correr('--tenant', c, '--cambios', '4', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación: .* 4 cambios\/mes · por contrato: cambiosIncluidos/);
    const cu = await cuenta(c);
    expect(cu.limites).toEqual({ ...limitesDe('pro'), cambiosIncluidos: 4 });
    expect(cu.limitesPorContrato).toEqual(['cambiosIncluidos']);
    // No es un cambio de plan.
    expect(await auditorias('cambiar_plan', c)).toHaveLength(0);
    expect(await auditorias('estado_cuenta', c)).toHaveLength(0);
    const [a] = await auditorias('limites_por_contrato', c);
    expect(a).toMatchObject({
      uid: 'operador@ejemplo.com', origen: 'script', script: 'asignar-plan', clave: 'cambiosIncluidos', plan: 'pro', delPlan: 2,
      antes: { valor: 2, porContrato: false }, despues: { valor: 4, porContrato: true },
    });
    expect(cambiosDelMes(cu, Date.now())).toMatchObject({ incluidos: 4 });
    // Repetirlo no escribe ni audita otra vez.
    expect(correr('--tenant', c, '--cambios', '4', '--aplicar').salida).toMatch(/Sin cambios/);
    expect(await auditorias('limites_por_contrato', c)).toHaveLength(1);
  });

  it('UN CAMBIO DE PLAN NO PISA EL CONTRATO: el seco lo anuncia y el aplicado lo conserva, con constancia', async () => {
    const seco = correr('--tenant', c, '--plan', 'crecimiento');
    expect(seco.codigo, seco.salida).toBe(0);
    expect(seco.salida).toMatch(/se conserva cambiosIncluidos 4 por contrato \(el plan crecimiento trae 1\)/);
    expect(seco.salida).toMatch(/Queda     : 220 conversaciones · 100 productos · 5 agendas · 4 cambios\/mes · por contrato: cambiosIncluidos/);
    const r = correr('--tenant', c, '--plan', 'crecimiento', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación/);
    const cu = await cuenta(c);
    expect(cu).toMatchObject({ plan: 'crecimiento', limites: { ...limitesDe('crecimiento'), cambiosIncluidos: 4 } });
    expect(cu.limitesPorContrato).toEqual(['cambiosIncluidos']);
    expect(cambiosDelMes(cu, Date.now())).toMatchObject({ incluidos: 4 });
    const [a] = await auditorias('cambiar_plan', c);
    expect(a).toMatchObject({
      planAntes: 'pro', planDespues: 'crecimiento', conservadosPorContrato: { cambiosIncluidos: 4 },
      limitesDespues: { ...limitesDe('crecimiento'), cambiosIncluidos: 4 },
    });
  });

  it('quitarlo es explícito (--cambios plan): vuelve al del plan, se borra el marcador, y el siguiente plan ya manda', async () => {
    const seco = correr('--tenant', c, '--cambios', 'plan');
    expect(seco.salida).toMatch(/Contrato  : cambiosIncluidos 4 por contrato → 1 del plan crecimiento/);
    const r = correr('--tenant', c, '--cambios', 'plan', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    let cu = await cuenta(c);
    expect(cu.limites).toEqual(limitesDe('crecimiento'));
    expect(cu.limitesPorContrato).toBeUndefined();
    const quita = (await auditorias('limites_por_contrato', c)).find((x) => x['despues']?.['porContrato'] === false);
    expect(quita).toMatchObject({ antes: { valor: 4, porContrato: true }, despues: { valor: 1, porContrato: false } });
    expect(correr('--tenant', c, '--plan', 'pro', '--aplicar').codigo).toBe(0);
    cu = await cuenta(c);
    expect(cu.limites).toEqual(limitesDe('pro'));
    expect(cambiosDelMes(cu, Date.now())).toMatchObject({ incluidos: 2 });
  });

  it('0 es un contrato válido (autoservicio), y plan y contrato juntos se escriben en una sola corrida', async () => {
    const r = correr('--tenant', c, '--plan', 'impulso', '--cambios', '0', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    const cu = await cuenta(c);
    expect(cu).toMatchObject({ plan: 'impulso', limites: limitesDe('impulso'), limitesPorContrato: ['cambiosIncluidos'] });
    // Y subir de plan conserva el 0 por contrato: el plan Pro trae 2, pero el contrato dice 0.
    expect(correr('--tenant', c, '--plan', 'pro', '--aplicar').codigo).toBe(0);
    expect((await cuenta(c)).limites).toEqual({ ...limitesDe('pro'), cambiosIncluidos: 0 });
  });
});

describe('asignar-plan.mjs: un QR vivo de otro plan frena --plan (tercera vuelta de #212, LOW 1)', () => {
  // La MISMA guarda que `actualizarEstadoCuenta` (index.ts): si la cuenta
  // tiene pendiente una mensualidad de otro plan --un QR vivo, o uno que el
  // banco ya confirmó y espera en revisión-- el cambio de plan se rechaza, en
  // seco y al aplicar, y no se escribe nada.
  const Q = 'plan-qr-vivo';
  const PAGO = 'QrVivoDeOtroPlan000001';
  const CUENTA_Q = { plan: 'pro', limites: limitesDe('pro'), catalogoPlanes: CATALOGO_PLANES, modalidad: 'prepago', pagoPendienteId: PAGO };

  async function sembrar(cobroEstado: string, estado = 'pendiente') {
    for (const d of (await db.collection(`tenants/${Q}/auditoria`).get()).docs) await d.ref.delete();
    await db.doc(`tenants/${Q}`).set({ nombre: 'QR vivo', estado: 'activo', plan: 'pro', flujos: ['venta'] });
    await db.doc(`tenants/${Q}/cuenta/estado`).set(CUENTA_Q);
    await db.doc(`tenants/${Q}/pagos/${PAGO}`).set({
      tipo: 'mensualidad', plan: 'crecimiento', meses: 1, monto: 630, estado, medio: 'qr',
      cobro: { id: 'cobro-de-prueba', estado: cobroEstado },
    });
  }
  const nadaCambio = async () => {
    expect(await cuenta(Q)).toEqual(CUENTA_Q);
    expect((await ficha(Q)).plan).toBe('pro');
    expect(await auditorias('cambiar_plan', Q)).toHaveLength(0);
  };

  it('con un QR vivo de Crecimiento, --plan impulso se rechaza en seco y al aplicar, sin escribir', async () => {
    await sembrar('QR_ACTIVO');
    for (const args of [['--plan', 'impulso'], ['--plan', 'impulso', '--aplicar']]) {
      const r = correr('--tenant', Q, ...args);
      expect(r.codigo, r.salida).toBe(1);
      expect(r.salida).toContain('Hay un cobro pendiente de una mensualidad de otro plan (crecimiento');
      expect(r.salida).toContain('anule el cobro pendiente primero');
      // Ni el identificador completo del pago.
      expect(r.salida).not.toContain(PAGO);
    }
    await nadaCambio();
  });

  it('con el pago EN REVISIÓN (el banco ya confirmó) también, y dice que se confirma en Negocios', async () => {
    await sembrar('CONFIRMADO');
    const r = correr('--tenant', Q, '--plan', 'impulso', '--aplicar');
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toContain('el banco ya lo confirmó y espera en revisión');
    expect(r.salida).toContain('confírmelo en Negocios');
    await nadaCambio();
  });

  it('el MISMO plan del QR, un pago ya cerrado o un eje que no es el plan no se frenan', async () => {
    await sembrar('QR_ACTIVO');
    expect(correr('--tenant', Q, '--plan', 'crecimiento').codigo).toBe(0);
    expect(correr('--tenant', Q, '--modalidad', 'prueba').codigo).toBe(0);
    await sembrar('CONFIRMADO', 'confirmado');
    expect(correr('--tenant', Q, '--plan', 'impulso').codigo).toBe(0);
    await nadaCambio();
  });
});

// ===========================================================================
// F1b (decisión de Andres del 26/09/2026): conversaciones, precio y prueba por
// contrato, con --operador y auditoría con el antes y el después. Las mismas
// reglas que la callable (`central/contrato-f1b.test.ts`), porque el script
// usa las mismas funciones puras (`copiaDeLimites`, `precioPorContratoValido`,
// `pruebaNueva`, `montoFueraDeContrato`).
// ===========================================================================
describe('asignar-plan.mjs F1b: --conversaciones, --precio, --periodo-prueba y --bolsa-prueba', () => {
  const P = 'plan-f1b';
  const PR = 'plan-f1b-prueba';
  const MES = mesBolivia(Date.now());
  const MES_SIGUIENTE = sumarMeses(MES, 1);
  const MES_PASADO = sumarMeses(MES, -1);
  const PRO_PREPAGO = { plan: 'pro', limites: limitesDe('pro'), catalogoPlanes: CATALOGO_PLANES, modalidad: 'prepago', periodoPagado: '2099-12' };
  const EN_PRUEBA = { plan: 'pro', limites: limitesDe('pro'), catalogoPlanes: CATALOGO_PLANES, modalidad: 'prueba', periodoPrueba: MES, bolsaPrueba: 7 };

  async function sembrarF1b(t: string, datos: Record<string, unknown>) {
    for (const col of ['auditoria', 'pagos']) {
      for (const d of (await db.collection(`tenants/${t}/${col}`).get()).docs) await d.ref.delete();
    }
    await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo', plan: datos['plan'], flujos: ['agendamiento'] });
    await db.doc(`tenants/${t}/cuenta/estado`).set(datos);
  }

  it('valores mal formados NO entran (código 2), y sin --operador tampoco', async () => {
    await sembrarF1b(P, PRO_PREPAGO);
    const casos: [string, string, RegExp][] = [
      ...['0', '-1', '2.5', '100001', 'x', ''].map((v): [string, string, RegExp] => ['--conversaciones', v, /--conversaciones inválido.*de 1 a 100000/]),
      ...['0', '-1', '12.345', '1000.01', '120,5', 'x', ''].map((v): [string, string, RegExp] => ['--precio', v, /--precio inválido/]),
      ...['2026-1', 'octubre', ''].map((v): [string, string, RegExp] => ['--periodo-prueba', v, /--periodo-prueba inválido/]),
      ...['0', '1001', '2.5', 'x', ''].map((v): [string, string, RegExp] => ['--bolsa-prueba', v, /--bolsa-prueba inválida/]),
    ];
    for (const [opcion, valor, mensaje] of casos) {
      const r = correr('--tenant', P, opcion, valor, '--aplicar');
      expect(r.codigo, `${opcion} ${valor}`).toBe(2);
      expect(r.salida, `${opcion} ${valor}`).toMatch(mensaje);
    }
    const sinOperador = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--tenant', P, '--precio', '120', '--aplicar'],
      { env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8' });
    expect(sinOperador.status).toBe(2);
    expect(await cuenta(P)).toEqual(PRO_PREPAGO);
  });

  it('--conversaciones y --precio: el seco dice el antes y el después y no escribe', async () => {
    await sembrarF1b(P, PRO_PREPAGO);
    const r = correr('--tenant', P, '--conversaciones', '800', '--precio', '120');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Contrato  : conversaciones 500 del plan → 800 por contrato/);
    expect(r.salida).toMatch(/Precio    : USD 90 del plan → USD 120 por contrato/);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect(await cuenta(P)).toEqual(PRO_PREPAGO);
  });

  it('con --aplicar: la copia, el marcador, el precio y la mensualidad derivada, con auditoría del operador', async () => {
    await sembrarF1b(P, PRO_PREPAGO);
    const r = correr('--tenant', P, '--conversaciones', '800', '--precio', '120', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación: .* 800 conversaciones .* por contrato: conversaciones/);
    expect(r.salida).toMatch(/USD 120 al mes por contrato · montoMensual 120/);
    const c = await cuenta(P);
    expect(c).toMatchObject({
      limites: { ...limitesDe('pro'), conversaciones: 800 }, limitesPorContrato: ['conversaciones'], precioPorContrato: 120, montoMensual: 120,
    });
    const [conv] = await auditorias('limites_por_contrato', P);
    expect(conv).toMatchObject({
      uid: 'operador@ejemplo.com', origen: 'script', clave: 'conversaciones',
      antes: { valor: 500, porContrato: false }, despues: { valor: 800, porContrato: true }, delPlan: 500,
    });
    const [precio] = await auditorias('precio_por_contrato', P);
    expect(precio).toMatchObject({
      uid: 'operador@ejemplo.com', origen: 'script',
      antes: { valor: null, porContrato: false, mensualUsd: 90 }, despues: { valor: 120, porContrato: true, mensualUsd: 120 },
    });
    // Repetirlo no escribe nada ni deja otra constancia.
    expect(correr('--tenant', P, '--conversaciones', '800', '--precio', '120', '--aplicar').salida).toMatch(/Sin cambios/);
    expect(await auditorias('precio_por_contrato', P)).toHaveLength(1);
  });

  it('LA COPIA Y EL PRECIO MANDAN SOBRE EL PLAN: --plan crecimiento conserva 800 y USD 120, y el seco lo anuncia', async () => {
    await sembrarF1b(P, { ...PRO_PREPAGO, limites: { ...limitesDe('pro'), conversaciones: 800 }, limitesPorContrato: ['conversaciones'], precioPorContrato: 120 });
    const seco = correr('--tenant', P, '--plan', 'crecimiento');
    expect(seco.salida).toMatch(/se conserva conversaciones 800 por contrato \(el plan crecimiento trae 220\)/);
    expect(seco.salida).toMatch(/Precio    : USD 120 por contrato → USD 120 por contrato \(se conserva: el cambio de plan no toca el precio por contrato\)/);
    expect(correr('--tenant', P, '--plan', 'crecimiento', '--aplicar').codigo).toBe(0);
    const c = await cuenta(P);
    expect(c).toMatchObject({
      plan: 'crecimiento', limites: { ...limitesDe('crecimiento'), conversaciones: 800 }, precioPorContrato: 120, montoMensual: 120,
    });
    // Y quitarlos es explícito: vuelve el plan.
    expect(correr('--tenant', P, '--conversaciones', 'plan', '--precio', 'plan', '--aplicar').codigo).toBe(0);
    const d = await cuenta(P);
    expect(d['limites']).toEqual(limitesDe('crecimiento'));
    expect(d['precioPorContrato']).toBeUndefined();
    expect(d['montoMensual']).toBe(50);
  });

  it('UN PRECIO FUERA DE CONTRATO SE RECHAZA: con una mensualidad pendiente de USD 90, --precio 120 no se escribe', async () => {
    const PAGO = 'PendienteF1bDeLista001';
    expect(PAGO).toMatch(/^[A-Za-z0-9_-]{22}$/);
    await sembrarF1b(P, { ...PRO_PREPAGO, pagoPendienteId: PAGO });
    await db.doc(`tenants/${P}/pagos/${PAGO}`).set({
      tipo: 'mensualidad', plan: 'pro', meses: 1, montoUsd: 90, monto: 1134, estado: 'pendiente', medio: 'qr',
      cobro: { id: 'cobro-de-prueba', estado: 'QR_ACTIVO' },
    });
    for (const args of [['--precio', '120'], ['--precio', '120', '--aplicar']]) {
      const r = correr('--tenant', P, ...args);
      expect(r.codigo, r.salida).toBe(1);
      expect(r.salida).toContain('quedaría fuera de contrato');
      expect(r.salida).toContain('anule el cobro pendiente primero');
      expect(r.salida).not.toContain(PAGO);
    }
    expect((await cuenta(P))['precioPorContrato']).toBeUndefined();
    expect(await auditorias('precio_por_contrato', P)).toHaveLength(0);
  });

  it('--periodo-prueba y --bolsa-prueba SIN modalidad prueba se rechazan; un mes pasado también', async () => {
    await sembrarF1b(P, PRO_PREPAGO);
    for (const args of [['--periodo-prueba', MES_SIGUIENTE], ['--bolsa-prueba', '40']]) {
      const r = correr('--tenant', P, ...args, '--aplicar');
      expect(r.codigo, r.salida).toBe(1);
      expect(r.salida).toMatch(/solo vale con modalidad prueba/);
    }
    expect(await cuenta(P)).toEqual(PRO_PREPAGO);
    await sembrarF1b(PR, EN_PRUEBA);
    const pasado = correr('--tenant', PR, '--periodo-prueba', MES_PASADO, '--aplicar');
    expect(pasado.codigo).toBe(1);
    expect(pasado.salida).toMatch(/mes pasado/);
    expect(await cuenta(PR)).toEqual(EN_PRUEBA);
  });

  it('--periodo-prueba EXTIENDE sin huecos y sin reiniciar la bolsa; --bolsa-prueba fija la que usa estadoDeServicio', async () => {
    await sembrarF1b(PR, EN_PRUEBA);
    const seco = correr('--tenant', PR, '--periodo-prueba', MES_SIGUIENTE);
    expect(seco.salida).toContain(`Prueba    : ${MES} · bolsa 7 → de ${MES} a ${MES_SIGUIENTE} · bolsa 7`);
    const r = correr('--tenant', PR, '--periodo-prueba', MES_SIGUIENTE, '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación/);
    let c = await cuenta(PR);
    expect(c).toMatchObject({ periodoPrueba: MES_SIGUIENTE, pruebaDesde: MES, bolsaPrueba: 7, estadoPago: 'al_dia', montoMensual: 0 });
    expect(estadoDeServicio(c, 0, Date.now())).toMatchObject({ cubierto: true, enPrueba: true, operativo: true });
    const [a] = await auditorias('estado_cuenta', PR);
    expect(a).toMatchObject({
      uid: 'operador@ejemplo.com', origen: 'script', campos: ['periodoPrueba', 'pruebaDesde'],
      antes: { periodoPrueba: MES, pruebaDesde: null },
      prueba: { antes: { periodoPrueba: MES, bolsaPrueba: 7 }, despues: { periodoPrueba: MES_SIGUIENTE, pruebaDesde: MES, bolsaPrueba: 7 } },
    });
    expect(correr('--tenant', PR, '--bolsa-prueba', '40', '--aplicar').codigo).toBe(0);
    c = await cuenta(PR);
    expect(c['bolsaPrueba']).toBe(40);
    expect(estadoDeServicio(c, 0, Date.now())).toMatchObject({ bolsaPrueba: 40, disponibles: 40 });
  });

  it('--modalidad prueba con --periodo-prueba y --bolsa-prueba pasa una cuenta de producción a una prueba pactada', async () => {
    await sembrarF1b(P, PRO_PREPAGO);
    const r = correr('--tenant', P, '--modalidad', 'prueba', '--periodo-prueba', MES_SIGUIENTE, '--bolsa-prueba', '50', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(await cuenta(P)).toMatchObject({ modalidad: 'prueba', periodoPrueba: MES_SIGUIENTE, pruebaDesde: MES, bolsaPrueba: 50 });
  });
});
