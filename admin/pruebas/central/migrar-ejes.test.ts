/**
 * `scripts/migrar-ejes.mjs`, CONTRA EL EMULADOR, ejecutado como proceso.
 *
 * Es el script que la sesión corre en producción con el OK de Andres después
 * del despliegue de F1 (`Analisis/41` §8.5, H1: «migración aplicada y
 * releída»). Lo que se prueba: que en seco lista y cuenta sin escribir; que
 * con `--aplicar` convierte el plan viejo «demostracion» en modalidad +
 * plan, da titularidad `comercio` a los números de un BYOC y `novuchat` al
 * resto, pone el modelo por defecto y completa `cambiosIncluidos`; que RELEE;
 * que NO toca un demo cuyo catálogo no cabe en el plan elegido (sale con 1);
 * que no toca un comercio sin plan del catálogo; y que repetirlo no cambia nada.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CATALOGO_PLANES, limitesDe } from '../../functions/src/planes.ts';
import { MODELO_POR_DEFECTO } from '../../functions/src/central/ejes.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', 'scripts', 'migrar-ejes.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'migrar-ejes') ?? initializeApp({ projectId: PROYECTO }, 'migrar-ejes');
const db = getFirestore(app);

const DEMO = 'mej-demo';
const DEMO_GRANDE = 'mej-demo-grande';
const BYOC = 'mej-byoc';
const REAL = 'mej-real';
const VIEJO = 'mej-viejo';
const LISTO = 'mej-listo';
const TENANTS = [DEMO, DEMO_GRANDE, BYOC, REAL, VIEJO, LISTO];
const NUM = { demo: '1000000061', grande: '1000000062', byoc1: '1000000063', byoc2: '1000000064', real: '1000000065', listo: '1000000066' };

function correr(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...args], {
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8',
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const cuenta = async (t: string) => (await db.doc(`tenants/${t}/cuenta/estado`).get()).data() ?? {};
const ficha = async (t: string) => (await db.doc(`tenants/${t}`).get()).data() ?? {};
const ruta = async (n: string) => (await db.doc(`rutasWhatsApp/${n}`).get()).data() ?? {};
const auditorias = async (t: string) =>
  (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', 'migrar_ejes').get()).size;

const LIMITES_VIEJOS_DEMO = { conversaciones: 500, productos: 500, agendas: 10 };
const TRES = (p: string) => { const { cambiosIncluidos: _c, ...tres } = limitesDe(p); return tres; };

beforeAll(async () => {
  for (const t of TENANTS) await db.recursiveDelete(db.doc(`tenants/${t}`));
  for (const n of Object.values(NUM)) await db.doc(`rutasWhatsApp/${n}`).delete();

  // Un demo como quedó en producción antes de F1: plan «demostracion» en la
  // cuenta y en la ficha, sin modalidad, límites de Pro, BOB, 3 ítems.
  await db.doc(`tenants/${DEMO}`).set({ nombre: 'Demo', estado: 'activo', plan: 'demostracion', flujos: ['venta'] });
  await db.doc(`tenants/${DEMO}/cuenta/estado`).set({
    plan: 'demostracion', limites: LIMITES_VIEJOS_DEMO, catalogoPlanes: '2026-09-15',
    estadoPago: 'sin_cargo', montoMensual: 0, moneda: 'BOB',
  });
  await db.doc(`tenants/${DEMO}/contadores/catalogo`).set({ items: 3, ultimoItem: 'x' });
  await db.doc(`rutasWhatsApp/${NUM.demo}`).set({ tenantId: DEMO, flujo: 'venta', aliasSecreto: 'demoA', estado: 'activo' });

  // El Demo B: 170 ítems, más que los 20 de Impulso.
  await db.doc(`tenants/${DEMO_GRANDE}`).set({ nombre: 'Demo B', estado: 'activo', plan: 'demostracion', flujos: ['venta'] });
  await db.doc(`tenants/${DEMO_GRANDE}/cuenta/estado`).set({ plan: 'demostracion', limites: LIMITES_VIEJOS_DEMO, modalidad: 'demostracion' });
  await db.doc(`tenants/${DEMO_GRANDE}/contadores/catalogo`).set({ items: 170, ultimoItem: 'x' });
  await db.doc(`rutasWhatsApp/${NUM.grande}`).set({ tenantId: DEMO_GRANDE, flujo: 'venta', aliasSecreto: 'demoB', estado: 'activo' });

  // Un BYOC con dos números: los dos pasan a titularidad `comercio`.
  await db.doc(`tenants/${BYOC}`).set({ nombre: 'BYOC', estado: 'activo', plan: 'byoc', flujos: ['agendamiento', 'venta'] });
  await db.doc(`tenants/${BYOC}/cuenta/estado`).set({
    plan: 'byoc', limites: TRES('byoc'), catalogoPlanes: '2026-09-24', modalidad: 'prepago', periodoPagado: '2099-12',
    estadoPago: 'al_dia', montoMensual: 50, moneda: 'USD',
  });
  await db.doc(`rutasWhatsApp/${NUM.byoc1}`).set({ tenantId: BYOC, flujo: 'agendamiento', aliasSecreto: 'cliente40', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUM.byoc2}`).set({ tenantId: BYOC, flujo: 'venta', aliasSecreto: 'cliente41', estado: 'activo' });

  // Un comercio real migrado al prepago, con el modelo ya escrito: solo le falta cambiosIncluidos y la titularidad.
  await db.doc(`tenants/${REAL}`).set({ nombre: 'Real', estado: 'activo', plan: 'crecimiento', flujos: ['agendamiento'], modelo: MODELO_POR_DEFECTO });
  await db.doc(`tenants/${REAL}/cuenta/estado`).set({
    plan: 'crecimiento', limites: TRES('crecimiento'), catalogoPlanes: '2026-09-24', modalidad: 'prepago', periodoPagado: '2099-12',
    estadoPago: 'al_dia', montoMensual: 50, moneda: 'USD',
  });
  await db.doc(`rutasWhatsApp/${NUM.real}`).set({ tenantId: REAL, flujo: 'agendamiento', aliasSecreto: 'cliente42', estado: 'activo' });

  // Uno con el «basico» de las altas viejas: no se toca (asignar-plan.mjs).
  await db.doc(`tenants/${VIEJO}`).set({ nombre: 'Viejo', estado: 'activo', plan: 'basico' });
  await db.doc(`tenants/${VIEJO}/cuenta/estado`).set({ plan: 'basico' });

  // Uno ya con los ejes: sin cambios.
  await db.doc(`tenants/${LISTO}`).set({ nombre: 'Listo', estado: 'activo', plan: 'pro', modelo: MODELO_POR_DEFECTO });
  await db.doc(`tenants/${LISTO}/cuenta/estado`).set({ plan: 'pro', limites: limitesDe('pro'), modalidad: 'demostracion' });
  await db.doc(`rutasWhatsApp/${NUM.listo}`).set({ tenantId: LISTO, flujo: 'venta', aliasSecreto: 'demoC', estado: 'activo', titularidad: 'novuchat' });
});

describe('migrar-ejes.mjs', () => {
  it('sin --proyecto o con un plan de demos que no existe, no hace nada', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--tenant', DEMO], { env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(`${r.stdout}${r.stderr}`).toMatch(/falta --proyecto/);
    const p = correr('--plan-demos', 'demostracion');
    expect(p.codigo).toBe(2);
    expect(p.salida).toMatch(/--plan-demos desconocido/);
  });

  it('en SECO lista y cuenta los tenants de verdad, dice qué cambiaría y NO escribe nada', async () => {
    const r = correr();
    expect(r.salida).toMatch(/Tenants en Firestore: \d+/);
    const total = Number(/Tenants en Firestore: (\d+)/.exec(r.salida)?.[1]);
    expect(total).toBeGreaterThanOrEqual(TENANTS.length);
    expect(r.salida).toMatch(new RegExp(`${DEMO} .*ERA DEMO POR PLAN`));
    expect(r.salida).toMatch(new RegExp(`${VIEJO} [\\s\\S]*?plan «basico» no es del catálogo: no se toca`));
    expect(r.salida).toMatch(new RegExp(`${LISTO} [\\s\\S]*?= sin cambios`));
    expect(r.salida).toMatch(new RegExp(`${DEMO_GRANDE} [\\s\\S]*?✗ NO SE TOCA: el catálogo tiene 170 ítems y el plan impulso admite 20`));
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    // Nunca un número completo en pantalla.
    for (const n of Object.values(NUM)) expect(r.salida).not.toContain(n);
    expect(r.salida).toMatch(/número …0061 titularidad \(ninguna\)/);
    // Nada cambió.
    expect(await cuenta(DEMO)).toMatchObject({ plan: 'demostracion', moneda: 'BOB' });
    expect((await ficha(DEMO))['modelo']).toBeUndefined();
    expect((await ruta(NUM.byoc1))['titularidad']).toBeUndefined();
    expect(await auditorias(DEMO)).toBe(0);
  });

  it('con --aplicar y --tenant, el demo pasa a modalidad demostración con el plan elegido, su copia, el espejo, el modelo y la titularidad; y RELEE', async () => {
    const r = correr('--tenant', DEMO, '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ releído: plan impulso · espejo impulso · modalidad demostracion · modelo gemini-3\.5-flash-lite · cambiosIncluidos 0 · estadoPago sin_cargo/);
    expect(r.salida).toMatch(/número …0061 titularidad novuchat/);
    expect(await cuenta(DEMO)).toMatchObject({
      plan: 'impulso', limites: limitesDe('impulso'), catalogoPlanes: CATALOGO_PLANES, modalidad: 'demostracion',
      estadoPago: 'sin_cargo', montoMensual: 0, moneda: 'USD',
    });
    expect((await cuenta(DEMO))['proximoVencimiento']).toBeUndefined();
    expect(await ficha(DEMO)).toMatchObject({ plan: 'impulso', modelo: MODELO_POR_DEFECTO });
    expect(await ruta(NUM.demo)).toMatchObject({ titularidad: 'novuchat', titularidadPor: 'migrar-ejes' });
    expect(await auditorias(DEMO)).toBe(1);
    // Solo ese tenant: los demás siguen como estaban.
    expect((await ruta(NUM.byoc1))['titularidad']).toBeUndefined();
  });

  it('NO toca el demo cuyo catálogo no cabe en Impulso, y sale con 1; con --plan-demos pro sí lo migra', async () => {
    const r = correr('--tenant', DEMO_GRANDE, '--aplicar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/NO SE TOCA: el catálogo tiene 170 ítems/);
    expect((await cuenta(DEMO_GRANDE))['plan']).toBe('demostracion');
    expect(await auditorias(DEMO_GRANDE)).toBe(0);

    const ok = correr('--tenant', DEMO_GRANDE, '--plan-demos', 'pro', '--aplicar');
    expect(ok.codigo, ok.salida).toBe(0);
    expect(await cuenta(DEMO_GRANDE)).toMatchObject({ plan: 'pro', limites: limitesDe('pro'), modalidad: 'demostracion' });
    expect((await ficha(DEMO_GRANDE))['plan']).toBe('pro');
  });

  it('un BYOC recibe titularidad `comercio` en TODOS sus números y cambiosIncluidos en la copia, sin tocar su prepago', async () => {
    const r = correr('--tenant', BYOC, '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/número …0063 titularidad comercio/);
    expect(r.salida).toMatch(/número …0064 titularidad comercio/);
    for (const n of [NUM.byoc1, NUM.byoc2]) expect((await ruta(n))['titularidad']).toBe('comercio');
    expect(await cuenta(BYOC)).toMatchObject({
      plan: 'byoc', limites: limitesDe('byoc'), modalidad: 'prepago', periodoPagado: '2099-12', estadoPago: 'al_dia', montoMensual: 50,
    });
    expect((await ficha(BYOC))['modelo']).toBe(MODELO_POR_DEFECTO);
  });

  it('un comercio real solo gana cambiosIncluidos y la titularidad `novuchat`; el modelo que ya tenía no se pisa', async () => {
    const r = correr('--tenant', REAL, '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    // La copia gana `cambiosIncluidos`; el vencimiento derivado, que faltaba, se completa.
    expect(r.salida).toMatch(/cambia {2}: cuenta \[limites, proximoVencimiento\] · ficha \[—\] · rutas 1/);
    expect((await cuenta(REAL))['limites']).toEqual(limitesDe('crecimiento'));
    expect((await ruta(NUM.real))['titularidad']).toBe('novuchat');
    expect(await cuenta(REAL)).toMatchObject({ modalidad: 'prepago', estadoPago: 'al_dia', montoMensual: 50 });
  });

  it('un comercio sin plan del catálogo no se toca, y uno ya migrado dice «sin cambios»', async () => {
    const v = correr('--tenant', VIEJO, '--aplicar');
    expect(v.codigo, v.salida).toBe(0);
    expect(v.salida).toMatch(/no es del catálogo: no se toca/);
    expect(await cuenta(VIEJO)).toEqual({ plan: 'basico' });
    expect((await ficha(VIEJO))['modelo']).toBe(MODELO_POR_DEFECTO);
    const l = correr('--tenant', LISTO, '--aplicar');
    expect(l.codigo, l.salida).toBe(0);
    expect(l.salida).toMatch(/= sin cambios/);
    expect(await auditorias(LISTO)).toBe(0);
  });

  it('repetirlo sobre los ya migrados no escribe nada más', async () => {
    for (const t of [DEMO, BYOC, REAL]) {
      const r = correr('--tenant', t, '--aplicar');
      expect(r.codigo, r.salida).toBe(0);
      expect(r.salida).toMatch(/= sin cambios/);
      expect(await auditorias(t)).toBe(1);
    }
  });

  it('un tenant que no existe se dice', () => {
    const r = correr('--tenant', 'mej-no-existe');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/No existe el comercio/);
  });
});
