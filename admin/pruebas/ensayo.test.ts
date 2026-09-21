/**
 * `scripts/ensayo.mjs` — EL ENSAYO DE UN CLIENTE EN UN NÚMERO DE DEMOSTRACIÓN.
 *
 * Escribe con el SDK Admin, que se salta las reglas: lo único que impide
 * desviar el número de un cliente que paga, o cargarle a un ensayo la agenda
 * real del cliente, son sus propios cerrojos. Se prueba ejecutándolo como
 * proceso contra el emulador, y se escribe negando.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'ensayo.mjs');
const PLATINUM = join(aqui, '..', 'scripts', 'datos', 'negocio-platinum.json');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'ensayo') ?? initializeApp({ projectId: PROYECTO }, 'ensayo');
const db = getFirestore(app);

const DEMO = 'ens-demo';
const CLIENTE_REAL = 'ens-cliente-real';
const NUM_DEMO = '1000000071';
const NUM_CLIENTE = '1000000072';
const TESTER = '59100000099';
const CAL_ENSAYO_1 = 'c'.repeat(64) + '@group.calendar.google.com';
const CAL_ENSAYO_2 = 'd'.repeat(64) + '@group.calendar.google.com';
const CAL_CLIENTE = 'e'.repeat(64) + '@group.calendar.google.com';

const tmp = mkdtempSync(join(tmpdir(), 'ensayo-prueba-'));
const LOCAL = join(tmp, 'CONFIGURACION.local.md');
// La tabla trae TAMBIÉN las filas reales del cliente: el ensayo no las tiene
// que usar nunca.
writeFileSync(LOCAL, [
  '| Marcador | Valor | Nota |', '|---|---|---|',
  `| \`REEMPLAZAR_NUMERO_RECEPCION_ENSAYO\` | ${TESTER} | quien prueba |`,
  `| \`REEMPLAZAR_CALENDARIO_ENSAYO_1\` | ${CAL_ENSAYO_1} | agenda de prueba 1 |`,
  `| \`REEMPLAZAR_CALENDARIO_ENSAYO_2\` | ${CAL_ENSAYO_2} | agenda de prueba 2 |`,
  '| `REEMPLAZAR_NUMERO_RECEPCION_PLATINUM` | 59170000001 | recepción REAL |',
  `| \`REEMPLAZAR_CALENDARIO_PLATINUM_1\` | ${CAL_CLIENTE} | agenda REAL |`,
  `| \`REEMPLAZAR_CALENDARIO_PLATINUM_2\` | ${CAL_CLIENTE} | agenda REAL |`, '',
].join('\n'));

function correr(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...args], {
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8',
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const preparar = (numero: string, extra: string[] = []) => correr('--numero', numero, '--preparar',
  '--cliente', 'platinum', '--archivo', PLATINUM, '--local', LOCAL, ...extra);

beforeAll(async () => {
  for (const d of [`rutasWhatsApp/${NUM_DEMO}`, `rutasWhatsApp/${NUM_CLIENTE}`]) await db.doc(d).delete();
  await db.recursiveDelete(db.doc('tenants/ensayo'));
  await db.doc(`tenants/${DEMO}`).set({ nombre: 'Demo', estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'], plan: 'demostracion' });
  await db.doc(`tenants/${DEMO}/config/negocio`).set({ nombreNegocio: 'Demo de siempre' });
  await db.doc(`tenants/${CLIENTE_REAL}`).set({ nombre: 'Cliente', estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'], plan: 'pro' });
  await db.doc(`rutasWhatsApp/${NUM_DEMO}`).set({ tenantId: DEMO, flujo: 'agendamiento', aliasSecreto: 'demoA', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUM_CLIENTE}`).set({ tenantId: CLIENTE_REAL, flujo: 'agendamiento', aliasSecreto: 'cliente09', estado: 'activo' });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('ensayo.mjs', () => {
  it('sin modo, o con dos, no hace nada', () => {
    expect(correr('--numero', NUM_DEMO).codigo).toBe(2);
    expect(correr('--numero', NUM_DEMO, '--preparar', '--restaurar').codigo).toBe(2);
  });

  it('NUNCA desvía el número de un cliente que paga', async () => {
    const r = preparar(NUM_CLIENTE, ['--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/no es un comercio de demostración/);
    expect((await db.doc(`rutasWhatsApp/${NUM_CLIENTE}`).get()).get('tenantId')).toBe(CLIENTE_REAL);
    expect((await db.doc('tenants/ensayo').get()).exists).toBe(false);
  });

  it('en seco no escribe nada', async () => {
    const r = preparar(NUM_DEMO);
    expect(r.codigo, r.salida).toBe(0);
    expect((await db.doc(`rutasWhatsApp/${NUM_DEMO}`).get()).get('tenantId')).toBe(DEMO);
    expect((await db.doc('tenants/ensayo').get()).exists).toBe(false);
  });

  it('con --aplicar: crea `ensayo`, carga al cliente con los datos del ENSAYO y desvía el número', async () => {
    const r = preparar(NUM_DEMO, ['--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    const ruta = (await db.doc(`rutasWhatsApp/${NUM_DEMO}`).get()).data() ?? {};
    expect(ruta).toMatchObject({ tenantId: 'ensayo', ensayoDe: DEMO, ensayoCliente: 'platinum', aliasSecreto: 'demoA' });
    const negocio = (await db.doc('tenants/ensayo/config/negocio').get()).data() ?? {};
    const base = JSON.parse(readFileSync(PLATINUM, 'utf8'));
    expect(negocio['nombreNegocio']).toBe(base.negocio.nombreNegocio);
    // Recepción y agendas: las del ensayo, JAMÁS las del cliente.
    expect(negocio['numeroRecepcion']).toBe(TESTER);
    const funcionarios = (await db.collection('tenants/ensayo/funcionarios').get()).docs.map((d) => d.get('calendarioId'));
    expect(funcionarios.sort()).toEqual([CAL_ENSAYO_1, CAL_ENSAYO_2].sort());
    expect(JSON.stringify(funcionarios)).not.toContain(CAL_CLIENTE);
    // El demo de siempre no se tocó.
    expect((await db.doc(`tenants/${DEMO}/config/negocio`).get()).get('nombreNegocio')).toBe('Demo de siempre');
    expect(r.salida).not.toContain(NUM_DEMO);
  });

  it('un segundo ensayo vacía el anterior: no quedan productos de otro cliente', async () => {
    await db.doc('tenants/ensayo/catalogo/sobrante-de-otro').set({ nombre: 'De otro cliente', activo: true });
    const r = preparar(NUM_DEMO, ['--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect((await db.doc('tenants/ensayo/catalogo/sobrante-de-otro').get()).exists).toBe(false);
    // Y el origen sigue siendo el demo, no `ensayo`.
    expect((await db.doc(`rutasWhatsApp/${NUM_DEMO}`).get()).get('ensayoDe')).toBe(DEMO);
  });

  it('--estado dice a quién apunta, sin el número completo', () => {
    const r = correr('--numero', NUM_DEMO, '--estado');
    expect(r.codigo).toBe(0);
    expect(r.salida).toMatch(/en ensayo; su comercio es ens-demo, cliente platinum/);
    expect(r.salida).not.toContain(NUM_DEMO);
  });

  it('--restaurar vuelve SOLO al comercio de origen, y en seco no toca nada', async () => {
    expect(correr('--numero', NUM_DEMO, '--restaurar').codigo).toBe(0);
    expect((await db.doc(`rutasWhatsApp/${NUM_DEMO}`).get()).get('tenantId')).toBe('ensayo');
    const r = correr('--numero', NUM_DEMO, '--restaurar', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    const ruta = (await db.doc(`rutasWhatsApp/${NUM_DEMO}`).get()).data() ?? {};
    expect(ruta['tenantId']).toBe(DEMO);
    expect(ruta['ensayoDe']).toBeUndefined();
  });

  it('restaurar un número que no está en ensayo no hace nada', async () => {
    const r = correr('--numero', NUM_CLIENTE, '--restaurar', '--aplicar');
    expect(r.codigo).toBe(0);
    expect(r.salida).toMatch(/No está en ensayo/);
    expect((await db.doc(`rutasWhatsApp/${NUM_CLIENTE}`).get()).get('tenantId')).toBe(CLIENTE_REAL);
  });
});
