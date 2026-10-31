/**
 * `scripts/plataforma/ensayo.mjs` — EL ENSAYO DE UN CLIENTE EN UN NÚMERO DE DEMOSTRACIÓN.
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
import { MODELO_POR_DEFECTO } from '../functions/src/central/ejes.ts';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'plataforma', 'ensayo.mjs');
const VENTA = join(aqui, '..', 'scripts', 'datos', 'negocio-demo-venta-resto.json');
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
    env: entornoDelEmulador(HOST), encoding: 'utf8',
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const preparar = (numero: string, extra: string[] = []) => correr('--numero', numero, '--preparar',
  '--cliente', 'platinum', '--archivo', PLATINUM, '--local', LOCAL, ...extra);

beforeAll(async () => {
  for (const d of [`rutasWhatsApp/${NUM_DEMO}`, `rutasWhatsApp/${NUM_CLIENTE}`]) await db.doc(d).delete();
  await db.recursiveDelete(db.doc('tenants/ensayo'));
  // Un demo es MODALIDAD demostración explícita en su cuenta (F1): el plan no lo dice.
  await db.doc(`tenants/${DEMO}`).set({ nombre: 'Demo', estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'], plan: 'pro' });
  await db.doc(`tenants/${DEMO}/cuenta/estado`).set({ plan: 'pro', modalidad: 'demostracion' });
  await db.doc(`tenants/${DEMO}/config/negocio`).set({ nombreNegocio: 'Demo de siempre' });
  // El cliente real: prepago. Y sin modalidad escrita tampoco se ensaya (se prueba abajo).
  await db.doc(`tenants/${CLIENTE_REAL}`).set({ nombre: 'Cliente', estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'], plan: 'pro' });
  await db.doc(`tenants/${CLIENTE_REAL}/cuenta/estado`).set({ plan: 'pro', modalidad: 'prepago', periodoPagado: '2099-12' });
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
    // Nace con los tres ejes, como un alta: el modelo incluido (seco de
    // migrar-ejes del 28/09, que lo vio faltar).
    expect((await db.doc('tenants/ensayo').get()).get('modelo')).toBe(MODELO_POR_DEFECTO);
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

describe('ensayo.mjs --flujo venta', () => {
  const NUM_VENTA = '485173073';
  const NUM_PAGA = '485173074';
  const NUM_SINFLUJO = '485173076';
  const AJENO = 'ens-ajeno';
  const prepararVenta = (numero: string, extra: string[] = []) => correr('--numero', numero, '--preparar',
    '--cliente', 'qtaco', '--archivo', VENTA, '--local', LOCAL, ...extra);
  const ruta = async (n: string) => (await db.doc(`rutasWhatsApp/${n}`).get()).data() ?? {};

  beforeAll(async () => {
    await db.recursiveDelete(db.doc('tenants/ensayo'));
    await db.doc(`rutasWhatsApp/${NUM_VENTA}`).set({ tenantId: DEMO, flujo: 'agendamiento', aliasSecreto: 'demoA', estado: 'activo' });
    await db.doc(`rutasWhatsApp/${NUM_PAGA}`).set({ tenantId: CLIENTE_REAL, flujo: 'agendamiento', aliasSecreto: 'cliente09', estado: 'activo' });
    await db.doc(`tenants/${AJENO}`).set({ nombre: 'Ajeno', estado: 'activo', vertical: 'venta', flujos: ['venta'], plan: 'pro' });
    await db.doc(`tenants/${AJENO}/pedidos/p1`).set({ total: 10 });
    await db.doc(`tenants/${AJENO}/conversaciones/c1`).set({ x: 1 });
  });

  it('un valor de --flujo inválido se rechaza con salida 2, y nada se escribe', async () => {
    for (const malo of ['otro', 'VENTA', '']) {
      const r = prepararVenta(NUM_VENTA, ['--flujo', malo, '--aplicar']);
      expect(r.codigo).toBe(2);
      expect(r.salida).toMatch(/--flujo debe ser venta o agendamiento/);
    }
    expect((await ruta(NUM_VENTA))['tenantId']).toBe(DEMO);
    expect((await db.doc('tenants/ensayo').get()).exists).toBe(false);
  });

  it('el número de un comercio que paga NO se desvía con --flujo venta', async () => {
    const r = prepararVenta(NUM_PAGA, ['--flujo', 'venta', '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toMatch(/no es un comercio de demostración/);
    expect(await ruta(NUM_PAGA)).toMatchObject({ tenantId: CLIENTE_REAL, flujo: 'agendamiento' });
    expect((await db.doc('tenants/ensayo').get()).exists).toBe(false);
  });

  it('un demo sin modalidad escrita tampoco se desvía', async () => {
    await db.doc('tenants/ens-sin-modalidad').set({ nombre: 'S', estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'] });
    await db.doc('rutasWhatsApp/485173075').set({ tenantId: 'ens-sin-modalidad', flujo: 'agendamiento', aliasSecreto: 'x', estado: 'activo' });
    const r = prepararVenta('485173075', ['--flujo', 'venta', '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect((await ruta('485173075'))['tenantId']).toBe('ens-sin-modalidad');
  });

  it('en seco no escribe nada (ni ficha, ni ruta)', async () => {
    const r = prepararVenta(NUM_VENTA, ['--flujo', 'venta']);
    expect(r.codigo, r.salida).toBe(0);
    expect(await ruta(NUM_VENTA)).toMatchObject({ tenantId: DEMO, flujo: 'agendamiento' });
    expect((await db.doc('tenants/ensayo').get()).exists).toBe(false);
  });

  it('`ensayo` inexistente + --flujo venta: lo crea de venta y la ruta recuerda su flujo', async () => {
    const r = prepararVenta(NUM_VENTA, ['--flujo', 'venta', '--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    const ficha = (await db.doc('tenants/ensayo').get()).data() ?? {};
    expect(ficha['flujos']).toEqual(['venta']);
    expect(ficha['vertical']).toBe('venta');
    expect(await ruta(NUM_VENTA)).toMatchObject({ tenantId: 'ensayo', flujo: 'venta', ensayoFlujoDe: 'agendamiento' });
  });

  it('con la ruta ya en ensayo solo se repite el MISMO ensayo; otro cliente u otro flujo exige --restaurar y no vacía nada', async () => {
    await db.doc('tenants/ensayo/pedidos/en-curso').set({ total: 5 });
    for (const extra of [['--cliente', 'otro-cliente', '--flujo', 'venta'], ['--flujo', 'agendamiento']]) {
      const base = ['--numero', NUM_VENTA, '--preparar', '--cliente', 'qtaco', '--archivo', VENTA, '--local', LOCAL, '--aplicar'];
      // `--cliente` repetido: gana el último en `opcion` solo si se busca el primero, así que se arma sin repetir.
      const args = extra[0] === '--cliente' ? [...base.slice(0, 3), ...extra, ...base.slice(5)] : [...base, ...extra];
      const r = correr(...args);
      expect(r.codigo, r.salida).toBe(1);
      expect(r.salida).toMatch(/primero --restaurar/);
    }
    expect((await db.doc('tenants/ensayo/pedidos/en-curso').get()).exists).toBe(true);
    expect(await ruta(NUM_VENTA)).toMatchObject({ tenantId: 'ensayo', flujo: 'venta', ensayoFlujoDe: 'agendamiento' });
  });

  it('una carga que falla con la ruta ya en ensayo lo dice: la ruta sigue y el comercio quedó vacío', async () => {
    const malo = join(tmp, 'malo.json');
    writeFileSync(malo, JSON.stringify({ negocio: { campoQueNoExiste: 1 } }));
    const r = correr('--numero', NUM_VENTA, '--preparar', '--cliente', 'qtaco', '--archivo', malo, '--local', LOCAL, '--aplicar');
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(/la ruta sigue en ensayo y el comercio quedó vacío: reintente o ejecute --restaurar/);
    expect(r.salida).not.toMatch(/la ruta NO se cambió/);
    expect(await ruta(NUM_VENTA)).toMatchObject({ tenantId: 'ensayo', flujo: 'venta', ensayoFlujoDe: 'agendamiento' });
  });

  it('el seco cuenta lo que se vacía, mensajes de conversaciones incluidos, sin duplicar', async () => {
    await db.doc('tenants/ensayo/pedidos/s1').set({ total: 1 });
    await db.doc('tenants/ensayo/conversaciones/s1').set({ x: 1 });
    await db.doc('tenants/ensayo/conversaciones/s1/mensajes/m1').set({ t: 'a' });
    await db.doc('tenants/ensayo/conversaciones/s1/mensajes/m2').set({ t: 'b' });
    const antes = (await db.collection('tenants/ensayo/catalogo').get()).size
      + (await db.collection('tenants/ensayo/funcionarios').get()).size + 4 /* config/contador: 4 refs */;
    const r = prepararVenta(NUM_VENTA, ['--flujo', 'venta']);
    expect(r.codigo, r.salida).toBe(0);
    const m = /se vacían (\d+) documento\(s\).*\((\d+) de venta/.exec(r.salida);
    expect(m, r.salida).not.toBeNull();
    // De venta: s1 (pedido) + s1 (conversación) + 2 mensajes = 4 (el pedido en-curso lo vació la carga fallida).
    expect(Number(m![2])).toBe(4);
    expect(Number(m![1])).toBe(antes + 4);
    expect((await db.doc('tenants/ensayo/conversaciones/s1/mensajes/m2').get()).exists).toBe(true);
    for (const d of ['pedidos/s1', 'conversaciones/s1', 'conversaciones/s1/mensajes/m1']) {
      await db.doc(`tenants/ensayo/${d}`).delete();
    }
    await db.doc('tenants/ensayo/conversaciones/s1/mensajes/m2').delete();
  });

  it('con --aplicar: ficha de venta, ruta con flujo venta, vacía lo de un ensayo anterior y no toca a otros', async () => {
    // Un ensayo anterior (agendamiento) deja una ficha vieja y restos de venta.
    await db.doc('tenants/ensayo').set({ nombre: 'Ensayo', estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'],
      modulos: ['productos', 'agenda'], plan: 'pro' });
    await db.doc('tenants/ensayo/cuenta/estado').set({ plan: 'pro', modalidad: 'demostracion' });
    await db.doc('tenants/ensayo/pedidos/viejo').set({ total: 1 });
    await db.doc('tenants/ensayo/cierres/viejo').set({ total: 1 });
    await db.doc('tenants/ensayo/conversaciones/viejo').set({ x: 1 });
    await db.doc('tenants/ensayo/conversaciones/viejo/mensajes/m1').set({ t: 'hola' });
    await db.doc('tenants/ensayo/auditoria/conservada').set({ a: 1 });
    const r = prepararVenta(NUM_VENTA, ['--flujo', 'venta', '--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).not.toContain(NUM_VENTA);
    expect(await ruta(NUM_VENTA)).toMatchObject({ tenantId: 'ensayo', ensayoDe: DEMO, flujo: 'venta', ensayoFlujoDe: 'agendamiento' });
    const ficha = (await db.doc('tenants/ensayo').get()).data() ?? {};
    expect(ficha['vertical']).toBe('venta');
    expect(ficha['flujos']).toEqual(['venta']);
    // H2b-7: ya no se borra; se deriva del flujo del ensayo (la lista vieja ['productos','agenda'] se reemplaza).
    expect(ficha['modulos']).toEqual(expect.arrayContaining(['productos', 'cobros', 'inventario', 'pedidos', 'catalogo-web']));
    expect(ficha['modulos']).not.toContain('agenda');
    for (const d of ['pedidos/viejo', 'cierres/viejo', 'conversaciones/viejo', 'conversaciones/viejo/mensajes/m1']) {
      expect((await db.doc(`tenants/ensayo/${d}`).get()).exists, d).toBe(false);
    }
    expect((await db.collection('tenants/ensayo/catalogo').get()).size).toBeGreaterThan(0);
    // Otros tenants, intactos.
    expect((await db.doc(`tenants/${AJENO}/pedidos/p1`).get()).exists).toBe(true);
    expect((await db.doc(`tenants/${AJENO}/conversaciones/c1`).get()).exists).toBe(true);
    expect((await db.doc(`tenants/${DEMO}/config/negocio`).get()).get('nombreNegocio')).toBe('Demo de siempre');
  });

  it('--estado muestra el flujo de `ensayo` y si la ruta está desviada', () => {
    const r = correr('--numero', NUM_VENTA, '--estado');
    expect(r.codigo).toBe(0);
    expect(r.salida).toMatch(/flujos \["venta"\] · vertical venta/);
    expect(r.salida).toMatch(/Desviada {2}: sí/);
    expect(r.salida).not.toContain(NUM_VENTA);
    expect(r.salida).not.toContain('demoA');
  });

  it('--restaurar tras un ensayo de venta devuelve ruta Y flujo de la ruta; en seco no toca', async () => {
    expect(correr('--numero', NUM_VENTA, '--restaurar').codigo).toBe(0);
    expect(await ruta(NUM_VENTA)).toMatchObject({ tenantId: 'ensayo', flujo: 'venta' });
    const r = correr('--numero', NUM_VENTA, '--restaurar', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    const despues = await ruta(NUM_VENTA);
    expect(despues['tenantId']).toBe(DEMO);
    expect(despues['flujo']).toBe('agendamiento');
    for (const k of ['ensayoDe', 'ensayoCliente', 'ensayoDesde', 'ensayoFlujoDe']) expect(despues[k], k).toBeUndefined();
    const estado = correr('--numero', NUM_VENTA, '--estado');
    expect(estado.salida).toMatch(/Desviada {2}: no/);
    // La ficha de `ensayo` sigue coherente (venta, activa) y el ajeno intacto.
    expect((await db.doc('tenants/ensayo').get()).get('flujos')).toEqual(['venta']);
    expect((await db.doc(`tenants/${AJENO}/pedidos/p1`).get()).exists).toBe(true);
  });

  it('sin --flujo nada cambia: el flujo sale de la ruta y la ruta no se toca de más; la ficha fija SOLO su flujo y vacía los restos de venta', async () => {
    await db.doc('tenants/ensayo/pedidos/de-venta-anterior').set({ total: 1 });
    await db.doc('tenants/ensayo').update({ modulos: ['productos', 'pedidos'] });
    const r = preparar(NUM_VENTA, ['--aplicar']); // negocio de agendamiento (Platinum), sin --flujo
    expect(r.codigo, r.salida).toBe(0);
    const ficha = (await db.doc('tenants/ensayo').get()).data() ?? {};
    expect(ficha['flujos']).toEqual(['agendamiento']);
    expect(ficha['vertical']).toBe('agendamiento');
    // H2b-7: `modulos` se deriva del flujo del ensayo (agendamiento), sin los restos de venta.
    expect(ficha['modulos']).toEqual(expect.arrayContaining(['productos', 'cobros', 'agenda']));
    expect(ficha['modulos']).not.toContain('pedidos');
    expect((await db.doc('tenants/ensayo/pedidos/de-venta-anterior').get()).exists).toBe(false);
    const d = await ruta(NUM_VENTA);
    expect(d).toMatchObject({ tenantId: 'ensayo', ensayoDe: DEMO, flujo: 'agendamiento' });
    expect(d['ensayoFlujoDe']).toBeUndefined();
    expect(correr('--numero', NUM_VENTA, '--restaurar', '--aplicar').codigo).toBe(0);
    expect((await ruta(NUM_VENTA))['flujo']).toBe('agendamiento');
  });

  it('si la ruta NO tenía campo `flujo`, restaurar lo borra en vez de inventar uno', async () => {
    await db.doc(`rutasWhatsApp/${NUM_SINFLUJO}`).set({ tenantId: DEMO, aliasSecreto: 'demoA', estado: 'activo' });
    const r = prepararVenta(NUM_SINFLUJO, ['--flujo', 'venta', '--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    const d = await ruta(NUM_SINFLUJO);
    expect(d).toMatchObject({ tenantId: 'ensayo', flujo: 'venta' });
    expect(d['ensayoFlujoDe']).toBeNull();
    expect(correr('--numero', NUM_SINFLUJO, '--restaurar', '--aplicar').codigo).toBe(0);
    const despues = await ruta(NUM_SINFLUJO);
    expect(despues['tenantId']).toBe(DEMO);
    expect('flujo' in despues).toBe(false);
    expect('ensayoFlujoDe' in despues).toBe(false);
  });
});
