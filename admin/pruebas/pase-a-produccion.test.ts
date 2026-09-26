/**
 * `scripts/pase-a-produccion.mjs` — ¿ESTÁ LISTO ESTE COMERCIO PARA PRODUCCIÓN?
 *
 * Es solo lectura, y eso es lo primero que se prueba: con `--aplicar` se
 * niega, y después de correrlo ningún documento cambió. Lo demás se prueba
 * negando, con un comercio por caso sembrado en el emulador: el listo pasa;
 * el que no tiene plan, el que tiene marcadores y supuestos, el que comparte
 * WABA, el que está en prueba y el que encendió el corte sin sus
 * precondiciones NO pasan; los demos y `novuchat` no pasan nunca. Ninguna
 * salida muestra un número completo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { limitesDe } from '../functions/src/planes.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'pase-a-produccion.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'pase') ?? initializeApp({ projectId: PROYECTO }, 'pase');
const db = getFirestore(app);

const LISTO = 'pase-listo';
const SIN_PLAN = 'pase-sin-plan';
const DEMO = 'pase-demo';
const MARCADORES = 'pase-marcadores';
const EN_PRUEBA = 'pase-en-prueba';
const TENANTS = [LISTO, SIN_PLAN, DEMO, MARCADORES, EN_PRUEBA, 'novuchat'];

// Números con seis ceros seguidos (convención del repositorio público).
const NUM_LISTO = '1000000081';
const NUM_SIN_PLAN = '1000000082';
const NUM_MARCADORES = '1000000083';
const NUM_PRUEBA = '1000000084';
const WABA_LISTO = '2000000081';
const WABA_COMPARTIDA = '2000000082';
const WABA_PRUEBA = '2000000084';
const RECEPCION = '59100000071';
const PAGADOR = '59100000072';

const ahora = Date.now();
const mesBolivia = new Date(ahora - 4 * 3_600_000).toISOString().slice(0, 7);
const hoyBolivia = new Date(ahora - 4 * 3_600_000).toISOString().slice(0, 10);
const LIMITES_CRECIMIENTO = { conversaciones: 220, productos: 100, agendas: 5 };

// Un repositorio de mentira: los flujos y los datos de cada comercio.
const repo = mkdtempSync(join(tmpdir(), 'pase-repo-'));
mkdirSync(join(repo, 'Flujos'));
mkdirSync(join(repo, 'admin', 'scripts', 'datos'), { recursive: true });
const flujo = (conTelefono: boolean) => JSON.stringify({
  nodes: [{
    name: 'Traer configuración', type: 'n8n-nodes-base.httpRequest',
    parameters: { jsonBody: conTelefono ? '={{ JSON.stringify({ telefono: $json.from }) }}' : '={{ JSON.stringify({}) }}' },
  }],
});
writeFileSync(join(repo, 'Flujos', `${LISTO}-agendamiento.json`), flujo(true));
writeFileSync(join(repo, 'Flujos', `${EN_PRUEBA}-agendamiento.json`), flujo(true));
writeFileSync(join(repo, 'Flujos', `${MARCADORES}-agendamiento.json`), flujo(false));
writeFileSync(join(repo, 'admin', 'scripts', 'datos', `negocio-${LISTO}.json`), JSON.stringify({ negocio: { nombreNegocio: 'Listo' } }));
writeFileSync(join(repo, 'admin', 'scripts', 'datos', `negocio-${MARCADORES}.json`),
  JSON.stringify({ _supuestos: 'El horario es SUPUESTO.', negocio: { nombreNegocio: 'Con marcadores' } }));

const ACEPTACION_COMPLETA = join(repo, 'aceptacion-completa.md');
const ACEPTACION_A_MEDIAS = join(repo, 'aceptacion-a-medias.md');
const tabla = (resultados: string[]) => [
  '| # | Prueba | Esperado | Resultado real | Msj |', '|---|---|---|---|---|',
  ...resultados.map((r, i) => `| ${i + 1} | prueba ${i + 1} | algo | ${r} | 1 |`), '',
].join('\n');
writeFileSync(ACEPTACION_COMPLETA, tabla(['OK', 'OK', 'OK']));
writeFileSync(ACEPTACION_A_MEDIAS, tabla(['OK', '', '']));

function correr(tenant: string, ...extra: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--tenant', tenant, '--repo', repo, ...extra], {
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8',
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}

async function sembrarComercio(id: string, cuenta: Record<string, unknown>, negocio: Record<string, unknown>, plan: string) {
  await db.doc(`tenants/${id}`).set({ nombre: id, estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'], plan });
  await db.doc(`tenants/${id}/cuenta/estado`).set(cuenta);
  await db.doc(`tenants/${id}/config/negocio`).set(negocio);
  await db.doc(`tenants/${id}/config/agendamiento`).set({ duracionMin: 30 });
  await db.doc(`tenants/${id}/funcionarios/agenda-1`).set({ nombre: 'Agenda', activo: true });
  await db.doc(`tenants/${id}/catalogo/item-1`).set({ nombre: 'Consulta', activo: true });
}
const ruta = (numero: string, tenant: string, waba: string, alias: string) =>
  db.doc(`rutasWhatsApp/${numero}`).set({ tenantId: tenant, flujo: 'agendamiento', wabaId: waba, aliasSecreto: alias, estado: 'activo' });

const negocioSano = {
  nombreNegocio: 'Consultorio', numeroRecepcion: RECEPCION,
  instruccionesExtra: 'Trato cordial.', instruccionesVigentes: 'Trato cordial.',
};

beforeAll(async () => {
  for (const t of TENANTS) await db.recursiveDelete(db.doc(`tenants/${t}`));
  for (const n of [NUM_LISTO, NUM_SIN_PLAN, NUM_MARCADORES, NUM_PRUEBA]) await db.doc(`rutasWhatsApp/${n}`).delete();
  await db.doc('plataforma/tipoCambio').set({ tco: 12.6, fecha: hoyBolivia, fuente: 'BCB' });
  await db.doc('plataforma/prepago').set({ corteActivo: false });

  // LISTO: prepago con un pago del banco, un ciclo observado y el corte encendido solo acá.
  await sembrarComercio(LISTO, {
    plan: 'crecimiento', limites: LIMITES_CRECIMIENTO, catalogoPlanes: '2026-09-15',
    modalidad: 'prepago', periodoPagado: mesBolivia, telefonosPago: [PAGADOR],
    recordatorios: { 'vence_pronto_2026-10': true, 'vence_manana_2026-10': true },
    corteActivo: true,
  }, negocioSano, 'crecimiento');
  await db.doc(`tenants/${LISTO}/pagos/pago-banco-1`).set({
    tipo: 'mensualidad', estado: 'confirmado', medio: 'qr', confirmadoPor: { origen: 'banco', cobroId: 'cons-x' },
  });
  await ruta(NUM_LISTO, LISTO, WABA_LISTO, 'cliente20');

  // SIN PLAN: el `basico` de las altas viejas, sin copia de límites.
  await sembrarComercio(SIN_PLAN, { plan: 'basico' }, negocioSano, 'basico');
  await ruta(NUM_SIN_PLAN, SIN_PLAN, WABA_COMPARTIDA, 'cliente21');

  // DEMO: modalidad demostración con un plan del catálogo (F1: el plan no dice que es un demo).
  await sembrarComercio(DEMO, { plan: 'pro', limites: limitesDe('pro'), modalidad: 'demostracion' }, negocioSano, 'pro');

  // NOVUCHAT: la propia NovuChat, aunque tuviera un plan vendible.
  await sembrarComercio('novuchat', { plan: 'impulso' }, negocioSano, 'impulso');

  // MARCADORES: configuración con un marcador sin resolver y un supuesto, flujo sin telefono, WABA compartida.
  await sembrarComercio(MARCADORES, {
    plan: 'crecimiento', limites: LIMITES_CRECIMIENTO, catalogoPlanes: '2026-09-15', modalidad: 'prueba', periodoPrueba: mesBolivia,
  }, {
    ...negocioSano, numeroRecepcion: 'REEMPLAZAR_NUMERO_RECEPCION_X',
    horarioTexto: 'Lun a vie 9 a 19 (supuesto)',
  }, 'crecimiento');
  await ruta(NUM_MARCADORES, MARCADORES, WABA_COMPARTIDA, 'cliente22');

  // EN PRUEBA: todo bien, pero todavía sin el primer pago.
  await sembrarComercio(EN_PRUEBA, {
    plan: 'crecimiento', limites: LIMITES_CRECIMIENTO, catalogoPlanes: '2026-09-15',
    modalidad: 'prueba', periodoPrueba: mesBolivia, bolsaPrueba: 20, telefonosPago: [PAGADOR],
  }, negocioSano, 'crecimiento');
  await ruta(NUM_PRUEBA, EN_PRUEBA, WABA_PRUEBA, 'cliente23');
});

afterAll(async () => {
  for (const t of TENANTS) await db.recursiveDelete(db.doc(`tenants/${t}`));
  for (const n of [NUM_LISTO, NUM_SIN_PLAN, NUM_MARCADORES, NUM_PRUEBA]) await db.doc(`rutasWhatsApp/${n}`).delete();
  await db.doc('plataforma/tipoCambio').delete();
  await db.doc('plataforma/prepago').delete();
  rmSync(repo, { recursive: true, force: true });
});

describe('pase-a-produccion.mjs', () => {
  it('se niega a escribir: --aplicar no existe', () => {
    const r = correr(LISTO, '--aplicar');
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/no escribe/);
  });

  it('sin --tenant válido no corre', () => {
    expect(correr('X').codigo).toBe(2);
  });

  it('el comercio listo pasa: etapa 4, con el corte encendido solo en él', () => {
    const r = correr(LISTO, '--aceptacion', ACEPTACION_COMPLETA);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Etapa del pase: 4/);
    expect(r.salida).toMatch(/0 faltan/);
    expect(r.salida).toMatch(/la consola dice «PRODUCCIÓN»/);
    expect(r.salida).toMatch(/corte APLICADO \(tenant encendido, global apagado\)/);
    expect(r.salida).toMatch(/WABA …0081 exclusiva/);
  });

  it('NO MUESTRA ningún número completo: ni el del comercio, ni la WABA, ni recepción, ni el que paga', () => {
    const r = correr(LISTO, '--aceptacion', ACEPTACION_COMPLETA);
    for (const n of [NUM_LISTO, WABA_LISTO, RECEPCION, PAGADOR]) expect(r.salida).not.toContain(n);
    expect(r.salida).toContain('…0072');
  });

  it('es solo lectura: después de correrlo, ningún documento cambió', async () => {
    const leer = async () => Promise.all([
      db.doc(`tenants/${LISTO}`).get(), db.doc(`tenants/${LISTO}/cuenta/estado`).get(),
      db.doc(`tenants/${LISTO}/config/negocio`).get(), db.doc(`rutasWhatsApp/${NUM_LISTO}`).get(),
      db.doc('plataforma/prepago').get(), db.doc('plataforma/tipoCambio').get(),
    ]);
    const antes = (await leer()).map((d) => d.updateTime?.toMillis());
    const auditoriaAntes = (await db.collection(`tenants/${LISTO}/auditoria`).get()).size;
    correr(LISTO);
    const despues = (await leer()).map((d) => d.updateTime?.toMillis());
    expect(despues).toEqual(antes);
    expect((await db.collection(`tenants/${LISTO}/auditoria`).get()).size).toBe(auditoriaAntes);
  });

  it('un comercio sin plan del catálogo NO pasa, y lo dice', () => {
    const r = correr(SIN_PLAN);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/Etapa del pase: 1/);
    expect(r.salida).toMatch(/✗ plan «basico» no es del catálogo/);
    expect(r.salida).toMatch(/✗ modalidad demostracion \(sin modalidad/);
    expect(r.salida).toMatch(/✗ no hay Flujos\/pase-sin-plan-\*\.json/);
  });

  it('un demo NO pasa nunca (salida 3), y novuchat tampoco: es el número de captación', () => {
    const d = correr(DEMO);
    expect(d.codigo).toBe(3);
    expect(d.salida).toMatch(/los demos no pasan a producción/);
    const n = correr('novuchat');
    expect(n.codigo).toBe(3);
    expect(n.salida).toMatch(/número de captación de la propia NovuChat/);
  });

  it('marcadores, supuestos, WABA compartida y un flujo sin telefono NO pasan', () => {
    const r = correr(MARCADORES);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/✗ sin número de recepción válido/);
    expect(r.salida).toMatch(/✗ 1 texto\(s\) con un marcador REEMPLAZAR_/);
    expect(r.salida).toMatch(/✗ 1 texto\(s\) que dicen «supuesto»/);
    expect(r.salida).toMatch(/✗ negocio-pase-marcadores\.json tiene 1 nota\(s\) de supuestos/);
    expect(r.salida).toMatch(/✗ la WABA …0082 la usa también otro comercio/);
    expect(r.salida).toMatch(/NO manda telefono a Traer configuración/);
    expect(r.salida).toMatch(/✗ sin teléfonos de pago/);
  });

  it('un comercio en prueba con todo lo demás en orden está en la etapa 2: le falta el primer pago', () => {
    const r = correr(EN_PRUEBA, '--aceptacion', ACEPTACION_COMPLETA);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/Etapa del pase: 2/);
    expect(r.salida).toMatch(/la consola dice «PRUEBA»/);
    expect(r.salida).toMatch(/✗ ningún pago confirmado/);
    expect(r.salida).toMatch(/el corte NO se enciende todavía/);
  });

  it('un corte encendido SIN sus precondiciones se marca como falta', async () => {
    await db.doc(`tenants/${EN_PRUEBA}/cuenta/estado`).update({ corteActivo: true });
    try {
      const r = correr(EN_PRUEBA);
      expect(r.codigo).toBe(1);
      expect(r.salida).toMatch(/✗ corte APLICADO .* SIN sus precondiciones/);
    } finally {
      await db.doc(`tenants/${EN_PRUEBA}/cuenta/estado`).update({ corteActivo: false });
    }
  });

  it('sin TCO vigente lo dice: sin TCO no se emite ningún cobro', async () => {
    await db.doc('plataforma/tipoCambio').set({ tco: 12.6, fecha: '2026-01-02', fuente: 'BCB' });
    try {
      const r = correr(LISTO);
      expect(r.codigo).toBe(1);
      expect(r.salida).toMatch(/✗ sin TCO vigente/);
    } finally {
      await db.doc('plataforma/tipoCambio').set({ tco: 12.6, fecha: hoyBolivia, fuente: 'BCB' });
    }
  });

  it('una aceptación a medias NO pasa: cuenta las pruebas sin resultado real', () => {
    const r = correr(LISTO, '--aceptacion', ACEPTACION_A_MEDIAS);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/✗ 2 de 3 pruebas sin resultado real anotado/);
  });
});
