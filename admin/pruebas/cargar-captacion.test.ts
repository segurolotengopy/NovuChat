/**
 * `scripts/cargar-captacion.mjs` — EL CONTENIDO DE LA CAPTACIÓN, CONTRA EL EMULADOR.
 *
 * El script escribe con el SDK Admin, que se salta las reglas: lo único que
 * impide cargar diez rubros, un precio negativo o la captación en un comercio
 * que no tiene el flujo es su propia validación. Por eso se prueba ejecutándolo
 * de verdad, como proceso, y se escribe negando: lo que no debe entrar, no entra.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'cargar-captacion.mjs');
const NOVUCHAT = join(aqui, '..', 'scripts', 'datos', 'captacion-novuchat.json');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'captacion') ?? initializeApp({ projectId: PROYECTO }, 'captacion');
const db = getFirestore(app);

// Identificadores propios de esta suite, para no pisar a ninguna otra.
const T = 'capt-novuchat';
const SIN_FLUJO = 'capt-sin-onboarding';
const SUSPENDIDO = 'capt-suspendido';

const tmp = mkdtempSync(join(tmpdir(), 'cargar-captacion-'));
const base = JSON.parse(readFileSync(NOVUCHAT, 'utf8'));
function archivo(nombre: string, datos: unknown) {
  const ruta = join(tmp, `${nombre}.json`);
  writeFileSync(ruta, JSON.stringify(datos));
  return ruta;
}
function correr(tenant: string, ruta: string, ...extra: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--tenant', tenant, '--archivo', ruta, ...extra], {
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8',
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const plan = (nombre: string, precioUsd = 10) => ({ nombre, precioUsd, periodo: 'mes', incluye: '' });

beforeAll(async () => {
  for (const t of [T, SIN_FLUJO, SUSPENDIDO]) {
    for (const d of ['config/negocio', 'config/onboarding']) await db.doc(`tenants/${t}/${d}`).delete();
  }
  await db.doc(`tenants/${T}`).set({ nombre: 'NovuChat', estado: 'activo', vertical: 'onboarding', flujos: ['onboarding'] });
  await db.doc(`tenants/${T}/config/negocio`).set({ nombreNegocio: 'NovuChat', zonaHoraria: 'America/La_Paz' });
  await db.doc(`tenants/${T}/config/onboarding`).set({ topeAviso: 25, plantillaAviso: 'solicitud_contacto' });
  await db.doc(`tenants/${SIN_FLUJO}`).set({ nombre: 'Salón', estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'] });
  await db.doc(`tenants/${SUSPENDIDO}`).set({ nombre: 'Susp', estado: 'suspendido', vertical: 'onboarding', flujos: ['onboarding'] });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('cargar-captacion.mjs', () => {
  it('sin los argumentos no hace nada', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(`${r.stdout}${r.stderr}`).toMatch(/--tenant inválido/);
  });

  it('el JSON de NovuChat cumple el contrato, y en seco no escribe nada', async () => {
    const r = correr(T, NOVUCHAT);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect(r.salida).toMatch(/«—» → «Kenji»/);
    expect(r.salida).toMatch(/nuevo\s+rubros\s+5: Salud y Belleza → agendamiento/);
    expect(r.salida).toMatch(/Educación → agendamiento/);
    expect(r.salida).toMatch(/Otro \/ a medida → a_medida/);
    expect(r.salida).toMatch(/Impulso USD 25\/mes · Crecimiento USD 50\/mes · Pro USD 90\/mes/);
    expect(r.salida).toMatch(/Instalación a medida desde USD 125/);
    // Conteos y nombres, no los textos largos.
    expect(r.salida).not.toContain('24 horas continuas');
    expect((await db.doc(`tenants/${T}/config/negocio`).get()).get('nombreAsistente')).toBeUndefined();
    expect((await db.doc(`tenants/${T}/config/onboarding`).get()).get('rubros')).toBeUndefined();
  });

  it('con --aplicar escribe el nombre, la captación con su sello y la auditoría, sin tocar lo demás', async () => {
    const r = correr(T, NOVUCHAT, '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación/);
    const negocio = (await db.doc(`tenants/${T}/config/negocio`).get()).data() ?? {};
    expect(negocio).toMatchObject({ nombreAsistente: 'Kenji', nombreNegocio: 'NovuChat', zonaHoraria: 'America/La_Paz' });
    const onb = (await db.doc(`tenants/${T}/config/onboarding`).get()).data() ?? {};
    expect(onb['rubros']).toEqual(base.rubros);
    expect(onb['planes']).toEqual(base.planes);
    expect(onb['cargosUnicos']).toEqual(base.cargosUnicos);
    expect(onb['aclaraciones']).toEqual(base.aclaraciones);
    // Lo que el archivo no trae queda como estaba; las notas `_` no se escriben.
    expect(onb).toMatchObject({ topeAviso: 25, plantillaAviso: 'solicitud_contacto', actualizadoPor: 'cargar-captacion' });
    expect(onb['_fuente']).toBeUndefined();
    const auditoria = await db.collection(`tenants/${T}/auditoria`).where('accion', '==', 'cargar_captacion').get();
    expect(auditoria.size).toBeGreaterThanOrEqual(1);
    expect(auditoria.docs[0]!.get('conteos')).toMatchObject({ rubros: 5, planes: 3, cargosUnicos: 2 });
  });

  it('repetir la misma carga no cambia el contenido', () => {
    const r = correr(T, NOVUCHAT);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Sin cambios de contenido/);
    expect(r.salida).toMatch(/igual \(«Kenji»\)/);
  });

  it('una lista nueva reemplaza a la vieja, no se mezcla con ella', async () => {
    const r = correr(T, archivo('dos-planes', { planes: [plan('Uno'), plan('Dos')] }), '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect((await db.doc(`tenants/${T}/config/onboarding`).get()).get('planes')).toHaveLength(2);
    // Lo que no venía en el archivo sigue ahí.
    expect((await db.doc(`tenants/${T}/config/onboarding`).get()).get('rubros')).toHaveLength(5);
  });

  it('NO acepta 9 rubros', async () => {
    const rubros = Array.from({ length: 9 }, (_, i) => ({ ...base.rubros[0], id: `rubro-${i}` }));
    const r = correr(T, archivo('nueve-rubros', { ...base, rubros }), '--aplicar');
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/rubros: 9 elementos, el máximo es 8/);
    expect(r.salida).toMatch(/No se escribió nada/);
    expect((await db.doc(`tenants/${T}/config/onboarding`).get()).get('rubros')).toHaveLength(5);
  });

  it('NO acepta un plan con precio negativo', () => {
    const r = correr(T, archivo('negativo', { ...base, planes: [plan('Barato', -5)] }), '--aplicar');
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/planes\[0\]\.precioUsd: número mayor o igual a 0/);
  });

  it('NO acepta 6 planes sin archivo, y sí con archivo', () => {
    const seis = Array.from({ length: 6 }, (_, i) => plan(`Plan ${i + 1}`));
    const sin = correr(T, archivo('seis-sin', { ...base, planes: seis }), '--aplicar');
    expect(sin.codigo).toBe(2);
    expect(sin.salida).toMatch(/6 planes exigen archivoPlanes/);
    const con = correr(T, archivo('seis-con', {
      ...base, planes: seis,
      archivoPlanes: { url: 'https://novuchat.site/planes.pdf', tipo: 'pdf', nombreArchivo: 'Planes NovuChat.pdf' },
    }));
    expect(con.codigo, con.salida).toBe(0);
    expect(con.salida).toMatch(/archivoPlanes\s+pdf «Planes NovuChat.pdf»/);
  });

  it('NO acepta enumerados, tamaños ni claves fuera del contrato', () => {
    const r = correr(T, archivo('varios', {
      nombreAsistente: 'K'.repeat(41),
      rubros: [{ ...base.rubros[0], id: 'Salud Belleza', flujoSugerido: 'onboarding' }],
      aclaraciones: [{ tema: 'x', texto: 'y'.repeat(601) }],
      archivoPlanes: { url: 'http://inseguro.test/p.pdf', tipo: 'docx', nombreArchivo: 'p' },
      token: 'no-va',
    }));
    expect(r.codigo).toBe(2);
    for (const m of [/nombreAsistente: texto de 1 a 40/, /rubros\[0\]\.id/, /rubros\[0\]\.flujoSugerido/,
      /aclaraciones\[0\]\.texto: texto de 1 a 600/, /archivoPlanes\.url/, /archivoPlanes\.tipo/, /clave desconocida: «token»/]) {
      expect(r.salida).toMatch(m);
    }
  });

  it('NO carga la captación en un comercio sin el flujo onboarding', async () => {
    const r = correr(SIN_FLUJO, NOVUCHAT, '--aplicar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no tiene el flujo onboarding/);
    expect((await db.doc(`tenants/${SIN_FLUJO}/config/onboarding`).get()).exists).toBe(false);
    expect((await db.doc(`tenants/${SIN_FLUJO}/config/negocio`).get()).exists).toBe(false);
  });

  it('NO reconfigura un comercio suspendido ni uno que no existe', () => {
    expect(correr(SUSPENDIDO, NOVUCHAT, '--aplicar').salida).toMatch(/está suspendido: no se reconfigura/);
    const r = correr('capt-no-existe', NOVUCHAT, '--aplicar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/No existe el comercio/);
  });
});
