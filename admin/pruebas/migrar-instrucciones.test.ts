/**
 * `scripts/migrar-instrucciones.mjs` — LO PROPUESTO PASA A VIGENTE, UNA VEZ.
 *
 * Al desplegar el contrato del 17/09 (`functions/src/comportamiento.ts`), un
 * comercio con texto en `instruccionesExtra` y nada en `instruccionesVigentes`
 * se quedaría sin instrucciones: el flujo lee solo lo vigente. El script copia
 * lo propuesto a vigente con la revisión aprobada, y nada más:
 *
 *   - en seco no escribe;
 *   - migra SOLO a quien tiene texto y no tiene vigente;
 *   - no toca a quien ya tiene vigente (aunque sea distinto de lo propuesto);
 *   - no toca a quien no tiene texto;
 *   - repetirlo no cambia nada;
 *   - nunca imprime el texto.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'migrar-instrucciones.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'migrar') ?? initializeApp({ projectId: PROYECTO }, 'migrar');
const db = getFirestore(app);
const { hashCorto } = await import('../functions/src/comportamiento.ts');

// Identificadores propios de esta suite.
const SIN_VIGENTE = 'mig-sin-vigente';
const CON_VIGENTE = 'mig-con-vigente';
const SIN_TEXTO = 'mig-sin-texto';
const CON_MARCAS = 'mig-con-marcas';
const TEXTO = 'Promoción de temporada: 2x1 en manicure los martes. Un texto secreto del comercio.';
const CON_ANGULARES = 'Ante «cuánto dura», distingue la sesión del resultado.';

function correr(...extra: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...extra], {
    encoding: 'utf8', env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, timeout: 60_000,
  });
  return { codigo: r.status, salida: (r.stdout ?? '') + (r.stderr ?? '') };
}
const negocio = async (t: string) => (await db.doc(`tenants/${t}/config/negocio`).get()).data() ?? {};

beforeEach(async () => {
  for (const t of [SIN_VIGENTE, CON_VIGENTE, SIN_TEXTO, CON_MARCAS]) {
    await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo', flujos: ['agendamiento'] });
    for (const d of (await db.collection(`tenants/${t}/auditoria`).get()).docs) await d.ref.delete();
  }
  await db.doc(`tenants/${SIN_VIGENTE}/config/negocio`).set({ nombreNegocio: 'A', instruccionesExtra: TEXTO });
  await db.doc(`tenants/${CON_VIGENTE}/config/negocio`).set({
    nombreNegocio: 'B', instruccionesExtra: 'propuesto nuevo', instruccionesVigentes: 'vigente viejo',
  });
  await db.doc(`tenants/${SIN_TEXTO}/config/negocio`).set({ nombreNegocio: 'C', instruccionesExtra: '' });
  await db.doc(`tenants/${CON_MARCAS}/config/negocio`).set({ nombreNegocio: 'D', instruccionesExtra: CON_ANGULARES });
});

describe('migrar-instrucciones.mjs', () => {
  it('sin --proyecto no hace nada', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(r.status).toBe(2);
  });

  it('en seco dice a quién migraría, no escribe y no muestra el texto', async () => {
    const r = correr();
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain('Seco: no se escribió nada');
    expect(r.salida).toContain(SIN_VIGENTE);
    expect(r.salida).toContain(`${TEXTO.length} caracteres`);
    expect(r.salida).not.toContain('texto secreto');
    expect(r.salida).not.toContain('cuánto dura');
    expect((await negocio(SIN_VIGENTE))['instruccionesVigentes']).toBeUndefined();
  });

  it('avisa, sin negar, cuando el texto no pasaría la capa de patrones', () => {
    const r = correr();
    expect(r.salida).toMatch(new RegExp(`${CON_MARCAS}[\\s\\S]*la capa de patrones lo rechazaría`));
  });

  it('con --aplicar copia lo propuesto a vigente con la revisión aprobada, y solo a quien corresponde', async () => {
    const r = correr('--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación: releídos 2 comercio\(s\)/);

    const a = await negocio(SIN_VIGENTE);
    expect(a['instruccionesVigentes']).toBe(TEXTO);
    expect(a['instruccionesRevision']).toMatchObject({
      estado: 'aprobado', hash: hashCorto(TEXTO), revisadoPor: 'migrar-instrucciones',
      motivo: 'migración 17/09: texto cargado por NovuChat',
    });
    const auditoria = await db.collection(`tenants/${SIN_VIGENTE}/auditoria`).where('accion', '==', 'migrar_instrucciones').get();
    expect(auditoria.size).toBe(1);
    expect(JSON.stringify(auditoria.docs[0]!.data())).not.toContain('texto secreto');

    // El que ya tenía vigente queda como estaba: lo propuesto nuevo lo revisa la Function.
    const b = await negocio(CON_VIGENTE);
    expect(b['instruccionesVigentes']).toBe('vigente viejo');
    expect(b['instruccionesRevision']).toBeUndefined();

    // Sin texto no hay nada que migrar.
    const c = await negocio(SIN_TEXTO);
    expect(c['instruccionesVigentes']).toBeUndefined();
    expect(c['instruccionesRevision']).toBeUndefined();

    // El de las comillas angulares se migra igual: ya rige y lo revisó NovuChat.
    expect((await negocio(CON_MARCAS))['instruccionesVigentes']).toBe(CON_ANGULARES);
  });

  it('repetirlo no cambia nada', async () => {
    correr('--aplicar');
    const antes = await negocio(SIN_VIGENTE);
    const r = correr('--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain('a migrar: 0');
    expect(await negocio(SIN_VIGENTE)).toEqual(antes);
    const auditoria = await db.collection(`tenants/${SIN_VIGENTE}/auditoria`).where('accion', '==', 'migrar_instrucciones').get();
    expect(auditoria.size).toBe(1);
  });
});
