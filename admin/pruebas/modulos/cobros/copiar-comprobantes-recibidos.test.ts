/**
 * `scripts/modulos/cobros/copiar-comprobantes-recibidos.mjs`, CONTRA EL EMULADOR, ejecutado como proceso.
 *
 * Se prueba negando: el seco no escribe ni imprime teléfonos; sin `--proyecto` o sin `--operador` no
 * corre; `--aplicar` crea los documentos con el id del servidor, vence = en + 90 días, relee y deja
 * respaldo fuera del repositorio; una segunda pasada crea 0; un documento existente no se pisa; un
 * comercio dado de baja y las conversaciones sin regla 2 no se tocan; el respaldo dentro del repo se rechaza.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nombreDeObjeto } from '../../../functions/src/modulos/cobros/comprobantes.ts';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', '..', 'scripts', 'modulos', 'cobros', 'copiar-comprobantes-recibidos.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'copiar-recibidos') ?? initializeApp({ projectId: PROYECTO }, 'copiar-recibidos');
const db = getFirestore(app);

const A = 'copia-rec-a';
const B = 'copia-rec-b';
const BAJA = 'copia-rec-baja';
const TENANTS = [A, B, BAJA];
const DIA = 86_400_000;
// Teléfonos armados en ejecución: el saneo del repo público no admite 10+ dígitos seguidos.
const tel = (n: number) => ['5917', '3000', String(n).padStart(3, '0')].join('');
const EN = Timestamp.fromMillis(Date.UTC(2026, 9, 10, 15, 0));

const entrada = (idMeta: string, extra: Record<string, unknown> = {}) => ({
  idMeta, estado: 'invalido', motivo: 'monto_menor', en: EN, ruta: `tenants/x/comprobantes/2026-10-10/${nombreDeObjeto(idMeta)}.jpg`,
  avisar: true, importe: 100, montoLeido: 50, montoDistinto: false, intentos: 1, ...extra,
});
const conv = (t: string, n: number, comprobantes: unknown[], extra: Record<string, unknown> = {}, regla = 2) =>
  db.doc(`tenants/${t}/conversaciones/wa_${tel(n)}`).set({
    nombreContacto: `Cliente ${n}`, solicitud: { reglaCobro: regla, etapa: 'en_revision', comprobantes }, ...extra,
  });

let carpeta = '';
const respaldo = () => join(carpeta, 'respaldo.json');
function correr(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const base = ['--proyecto', PROYECTO, '--operador', 'operador@ejemplo.com'];
const filas = async (t: string) => (await db.collection(`tenants/${t}/comprobantesRecibidos`).get()).docs;
const auditorias = async (t: string) =>
  (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', 'copiar_comprobantes_recibidos').get()).docs;

beforeAll(async () => {
  carpeta = mkdtempSync(join(tmpdir(), 'copiar-recibidos-'));
  for (const t of TENANTS) await db.recursiveDelete(db.doc(`tenants/${t}`));
  await db.doc(`tenants/${A}`).set({ nombre: 'A', estado: 'activo' });
  await db.doc(`tenants/${B}`).set({ nombre: 'B', estado: 'activo' });
  await db.doc(`tenants/${BAJA}`).set({ nombre: 'Baja', estado: 'dado_de_baja' });
  await conv(A, 1, [entrada('wamid.a1'), entrada('wamid.a2', { estado: 'tardio', motivo: 'tardio', ruta: null }), { sin: 'idMeta' }, entrada('wamid.sinfecha', { en: 'ayer' })]);
  await db.doc(`tenants/${A}/conversaciones/wa_${tel(2)}`).set({
    solicitud: { reglaCobro: 2, etapa: 'agendada', comprobantes: [entrada('wamid.a3', { estado: 'valido', motivo: 'ok' })] },
  });
  await conv(A, 3, [entrada('wamid.regla1')], {}, 1);            // regla 1: no se copia
  await conv(B, 4, [entrada('wamid.b1')]);
  await conv(BAJA, 5, [entrada('wamid.baja1')]);                  // dado de baja: no se toca
});
afterAll(() => { rmSync(carpeta, { recursive: true, force: true }); });

describe('seco por omisión', () => {
  it('cuenta por comercio, no escribe nada y no imprime teléfonos ni conversaciones', async () => {
    const r = correr(...base);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain(`${A}: 2 conversación(es)`);
    expect(r.salida).toMatch(new RegExp(`${A}.*3 comprobante\\(s\\).*ya copiados 0.*a crear 3.*omitidos sin idMeta o fecha 2`));
    expect(r.salida).toMatch(new RegExp(`${B}.*1 comprobante\\(s\\).*a crear 1`));
    expect(r.salida).toContain(`${BAJA}: dado de baja, no se toca`);
    expect(r.salida).toContain('Seco: no se escribió nada');
    expect(r.salida).not.toMatch(/wa_|5917|Cliente \d/);
    for (const t of TENANTS) expect((await filas(t)).length).toBe(0);
    expect(existsSync(respaldo())).toBe(false);
  });
  it('sin --proyecto o sin --operador (o con uno que no es correo) no corre', () => {
    expect(correr('--operador', 'operador@ejemplo.com').codigo).toBe(2);
    expect(correr('--proyecto', PROYECTO).codigo).toBe(2);
    expect(correr('--proyecto', PROYECTO, '--operador', 'no-es-correo').codigo).toBe(2);
  });
  it('--aplicar con el respaldo DENTRO del repositorio se rechaza y no escribe', async () => {
    const r = correr(...base, '--aplicar', '--respaldo', join(aqui, 'respaldo-prohibido.json'));
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('FUERA del repositorio');
    expect((await filas(A)).length).toBe(0);
  });
});

describe('--aplicar', () => {
  it('crea con el id del servidor, vence = en + 90 días, relee y deja respaldo y constancia sin teléfonos', async () => {
    const r = correr(...base, '--aplicar', '--respaldo', respaldo());
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain(`${A}: 3 creado(s) y releído(s)`);
    expect(r.salida).not.toMatch(/wa_|5917/);

    const a1 = (await db.doc(`tenants/${A}/comprobantesRecibidos/${nombreDeObjeto('wamid.a1')}`).get()).data();
    expect(a1).toMatchObject({
      idMeta: 'wamid.a1', conversacionId: `wa_${tel(1)}`, estado: 'invalido', motivo: 'monto_menor',
      importe: 100, montoLeido: 50, montoDistinto: false, intentos: 1, nombreContacto: 'Cliente 1',
    });
    expect(a1?.['en'].toMillis()).toBe(EN.toMillis());
    expect(a1?.['vence'].toMillis()).toBe(EN.toMillis() + 90 * DIA);
    expect(Object.keys(a1 ?? {}).sort()).toEqual([
      'conversacionId', 'en', 'estado', 'idMeta', 'importe', 'intentos', 'montoDistinto', 'montoLeido', 'motivo',
      'nombreContacto', 'ruta', 'vence',
    ]);
    expect(a1).not.toHaveProperty('avisar');
    const a2 = (await db.doc(`tenants/${A}/comprobantesRecibidos/${nombreDeObjeto('wamid.a2')}`).get()).data();
    expect(a2?.['ruta']).toBeNull();
    const a3 = (await db.doc(`tenants/${A}/comprobantesRecibidos/${nombreDeObjeto('wamid.a3')}`).get()).data();
    expect(a3).not.toHaveProperty('nombreContacto');

    expect((await filas(A)).length).toBe(3);
    expect((await filas(B)).length).toBe(1);
    // Ni regla 1, ni dado de baja, ni entradas sin idMeta o fecha.
    expect((await filas(BAJA)).length).toBe(0);
    expect((await filas(A)).some((d) => d.get('idMeta') === 'wamid.regla1' || d.get('idMeta') === 'wamid.sinfecha')).toBe(false);

    const salvado = JSON.parse(readFileSync(respaldo(), 'utf8'));
    expect(salvado.crear).toHaveLength(4);
    const auditoriaA = await auditorias(A);
    expect(auditoriaA).toHaveLength(1);
    expect(auditoriaA[0]?.data()).toMatchObject({ uid: 'operador@ejemplo.com', origen: 'script', creados: 3, saltados: 0 });
    expect(JSON.stringify(auditoriaA[0]?.data())).not.toMatch(/5917|wa_/);
  });

  it('una segunda pasada crea 0: en seco dice «a crear 0» y con --aplicar no escribe ni deja constancia nueva', async () => {
    const seco = correr(...base);
    expect(seco.salida).toMatch(new RegExp(`${A}.*ya copiados 3.*a crear 0`));
    const antesAuditorias = (await auditorias(A)).length;
    const r = correr(...base, '--aplicar', '--respaldo', respaldo());
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('Nada que copiar');
    expect((await filas(A)).length).toBe(3);
    expect((await auditorias(A)).length).toBe(antesAuditorias);
  });

  it('un documento que ya existe no se pisa (create, no set)', async () => {
    const ref = db.doc(`tenants/${A}/comprobantesRecibidos/${nombreDeObjeto('wamid.a1')}`);
    await ref.update({ estado: 'valido', centinela: 'intacto' });
    await conv(A, 6, [entrada('wamid.a4')]);
    const r = correr(...base, '--aplicar', '--respaldo', respaldo());
    expect(r.codigo).toBe(0);
    expect((await ref.get()).get('centinela')).toBe('intacto');
    expect((await ref.get()).get('estado')).toBe('valido');
    expect((await filas(A)).length).toBe(4);
  });

  it('--tenant acota a un comercio', async () => {
    await conv(B, 7, [entrada('wamid.b2')]);
    await conv(A, 8, [entrada('wamid.a5')]);
    const r = correr(...base, '--tenant', B, '--aplicar', '--respaldo', respaldo());
    expect(r.codigo).toBe(0);
    expect((await filas(B)).length).toBe(2);
    expect((await filas(A)).length).toBe(4);
  });

  it('un comercio que no existe: sale con 1 y no escribe', () => {
    expect(correr(...base, '--tenant', 'no-existe-este').codigo).toBe(1);
  });
});
