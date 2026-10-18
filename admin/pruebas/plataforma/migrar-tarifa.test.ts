/**
 * `scripts/plataforma/migrar-tarifa.mjs`, CONTRA EL EMULADOR (PR-4b del Bloque 1).
 *
 * El script escribe con el SDK Admin, que se salta las reglas: lo único que impide tocar un comercio que
 * nadie nombró, o la copia `limites` de uno, es su propia lógica. Por eso se ejecuta de verdad, como proceso,
 * y se escribe negando. El caso de control es una cuenta como la de Bellido: Impulso, copia de 100, sin el
 * campo `tarifa`, que rige `meta_incluido`; el seco no la cambia en nada y el servicio que lee el servidor
 * (`estadoDeServicio`) da lo mismo antes y después, campo por campo.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CATALOGO_PLANES, limitesDe } from '../../functions/src/central/cuenta/planes.ts';
import { consumidasDe, estadoDeServicio } from '../../functions/src/central/cuenta/prepago.ts';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', 'scripts', 'plataforma', 'migrar-tarifa.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'migrar-tarifa') ?? initializeApp({ projectId: PROYECTO }, 'migrar-tarifa');
const db = getFirestore(app);

const BELLIDO = 'mt-bellido';
const OTRO = 'mt-otro';
const ESTANDAR = 'mt-ya-estandar';
const BAJA = 'mt-baja';
const SIN_CUENTA = 'mt-sin-cuenta';
const AUSENTE = 'mt-no-existe';
const NUM = '1000000091';
const AHORA = Date.UTC(2026, 9, 17, 16, 0, 0);

const OPERADOR = ['--operador', 'operador@ejemplo.com'];
function correr(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const base = ['--proyecto', PROYECTO, ...OPERADOR];
const cuenta = async (t: string) => (await db.doc(`tenants/${t}/cuenta/estado`).get()).data() ?? {};
const auditorias = async (t: string) =>
  (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', 'migrar_tarifa').get()).docs.map((d) => d.data());
const servicio = (c: Record<string, unknown>) => estadoDeServicio(c, consumidasDe(undefined), AHORA);

const COPIA_BELLIDO = limitesDe('impulso', 'meta_incluido');

beforeAll(async () => {
  for (const t of [BELLIDO, OTRO, ESTANDAR, BAJA, SIN_CUENTA]) await db.recursiveDelete(db.doc(`tenants/${t}`));
  await db.doc(`rutasWhatsApp/${NUM}`).delete();
  await db.doc(`tenants/${BELLIDO}`).set({ nombre: 'Como Bellido', estado: 'activo', plan: 'impulso', flujos: ['agendamiento'] });
  await db.doc(`tenants/${BELLIDO}/cuenta/estado`).set({
    plan: 'impulso', limites: COPIA_BELLIDO, catalogoPlanes: CATALOGO_PLANES, modalidad: 'prepago', periodoPagado: '2026-10',
    bolsa: 7, precioPorContrato: 80, estadoPago: 'al_dia', montoMensual: 80, moneda: 'USD',
  });
  await db.doc(`rutasWhatsApp/${NUM}`).set({ tenantId: BELLIDO, flujo: 'agendamiento', aliasSecreto: 'x', estado: 'activo', titularidad: 'comercio' });
  await db.doc(`tenants/${OTRO}`).set({ nombre: 'Otro', estado: 'activo', plan: 'pro' });
  await db.doc(`tenants/${OTRO}/cuenta/estado`).set({
    plan: 'pro', limites: limitesDe('pro', 'meta_incluido'), catalogoPlanes: CATALOGO_PLANES, modalidad: 'prepago',
  });
  await db.doc(`tenants/${ESTANDAR}`).set({ nombre: 'Ya estándar', estado: 'activo', plan: 'impulso' });
  await db.doc(`tenants/${ESTANDAR}/cuenta/estado`).set({
    plan: 'impulso', limites: limitesDe('impulso', 'estandar'), catalogoPlanes: CATALOGO_PLANES, modalidad: 'prepago', tarifa: 'estandar',
  });
  await db.doc(`tenants/${BAJA}`).set({ nombre: 'Se fue', estado: 'dado_de_baja', plan: 'impulso' });
  await db.doc(`tenants/${BAJA}/cuenta/estado`).set({ plan: 'impulso' });
  await db.doc(`tenants/${SIN_CUENTA}`).set({ nombre: 'Sin cuenta', estado: 'activo', plan: 'impulso' });
});

describe('migrar-tarifa.mjs: argumentos (salida 2, antes de leer la nube)', () => {
  it('sin --proyecto, sin --operador (o uno que no es correo): nada', () => {
    expect(correr('--operador', 'operador@ejemplo.com').codigo).toBe(2);
    expect(correr('--proyecto', PROYECTO).codigo).toBe(2);
    expect(correr('--proyecto', PROYECTO, '--operador', 'no-es-correo').codigo).toBe(2);
  });

  it('--tarifa fuera de la lista sale con 2 y no toca nada', async () => {
    const antes = await cuenta(BELLIDO);
    for (const t of ['premium', '', 'ESTANDAR', 'meta']) {
      const r = correr(...base, '--tenant', BELLIDO, '--tarifa', t, '--aplicar');
      expect(r.codigo, t).toBe(2);
      expect(r.salida).toContain('--tarifa desconocida');
    }
    expect(await cuenta(BELLIDO)).toEqual(antes);
  });

  it('--aplicar sin --tenant, o --tarifa sin --tenant, o --tenant sin --tarifa: sale con 2 y no escribe', async () => {
    const antes = [await cuenta(BELLIDO), await cuenta(OTRO)];
    expect(correr(...base, '--aplicar').codigo).toBe(2);
    expect(correr(...base, '--tarifa', 'estandar', '--aplicar').codigo).toBe(2);
    expect(correr(...base, '--tarifa', 'estandar').codigo).toBe(2);
    expect(correr(...base, '--tenant', BELLIDO, '--aplicar').codigo).toBe(2);
    expect([await cuenta(BELLIDO), await cuenta(OTRO)]).toEqual(antes);
    expect(await auditorias(BELLIDO)).toEqual([]);
  });
});

describe('migrar-tarifa.mjs: el seco', () => {
  it('sin --tenant lista todo (plan, copia, precio, titularidad, bolsa, tarifa) y no escribe', async () => {
    const antes = await cuenta(BELLIDO);
    const r = correr(...base);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain(BELLIDO);
    expect(r.salida).toContain('plan impulso');
    expect(r.salida).toContain('copia 100 conv');
    expect(r.salida).toContain('USD 80 por contrato');
    expect(r.salida).toContain('bolsa 7');
    expect(r.salida).toContain('…0091:comercio');
    expect(r.salida).toContain('sin campo: rige meta_incluido');
    expect(r.salida).not.toContain(NUM);
    expect(await cuenta(BELLIDO)).toEqual(antes);
  });

  it('EL CASO BELLIDO: el seco con --tenant no escribe nada y estadoDeServicio da igual antes y después, campo por campo', async () => {
    const antes = await cuenta(BELLIDO);
    const servicioAntes = servicio(antes);
    const r = correr(...base, '--tenant', BELLIDO, '--tarifa', 'estandar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain('sin campo');
    expect(r.salida).toContain('→ estandar');
    expect(r.salida).toContain('Seco: no se escribió nada');
    const despues = await cuenta(BELLIDO);
    expect(despues).toEqual(antes);
    expect(despues).not.toHaveProperty('tarifa');
    const servicioDespues = servicio(despues);
    for (const k of Object.keys(servicioAntes) as (keyof typeof servicioAntes)[]) {
      expect(servicioDespues[k], `estadoDeServicio.${String(k)}`).toEqual(servicioAntes[k]);
    }
    expect(await auditorias(BELLIDO)).toEqual([]);
  });
});

describe('migrar-tarifa.mjs: --aplicar', () => {
  it('rechaza, sin escribir NADA, si uno de los nombrados no existe, está de baja o no tiene cuenta (aunque otro sea válido)', async () => {
    const antes = await cuenta(BELLIDO);
    for (const malo of [AUSENTE, BAJA, SIN_CUENTA]) {
      const r = correr(...base, '--tenant', BELLIDO, '--tenant', malo, '--tarifa', 'estandar', '--aplicar');
      expect(r.codigo, malo).toBe(1);
      expect(r.salida).toContain('No se escribe nada');
      expect(await cuenta(BELLIDO), malo).toEqual(antes);
      expect(await auditorias(BELLIDO)).toEqual([]);
    }
    expect((await db.doc(`tenants/${AUSENTE}/cuenta/estado`).get()).exists).toBe(false);
  });

  it('escribe SOLO `tarifa` y la auditoría; la copia, el plan, el precio, la bolsa y los derivados quedan idénticos; el ajeno no se toca', async () => {
    const antes = await cuenta(BELLIDO);
    const ajeno = await cuenta(OTRO);
    const ruta = (await db.doc(`rutasWhatsApp/${NUM}`).get()).data();
    const r = correr(...base, '--tenant', BELLIDO, '--tarifa', 'estandar', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain('✓ releído: tarifa estandar');
    const despues = await cuenta(BELLIDO);
    expect(despues['tarifa']).toBe('estandar');
    const { tarifa: _t, ...resto } = despues;
    expect(resto).toEqual(antes);
    expect(despues['limites']).toEqual(COPIA_BELLIDO);
    expect(await cuenta(OTRO)).toEqual(ajeno);
    expect(await auditorias(OTRO)).toEqual([]);
    expect((await db.doc(`rutasWhatsApp/${NUM}`).get()).data()).toEqual(ruta);
    const a = await auditorias(BELLIDO);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      accion: 'migrar_tarifa', uid: 'operador@ejemplo.com', origen: 'script',
      antes: { tarifa: null, rige: 'meta_incluido' }, despues: { tarifa: 'estandar', rige: 'estandar' },
    });
  });

  it('repetirlo no escribe ni deja otra auditoría; y un comercio que ya la tiene no se toca', async () => {
    const r = correr(...base, '--tenant', BELLIDO, '--tenant', ESTANDAR, '--tarifa', 'estandar', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain('ya tiene tarifa estandar');
    expect(await auditorias(BELLIDO)).toHaveLength(1);
    expect(await auditorias(ESTANDAR)).toEqual([]);
  });

  it('se puede volver a meta_incluido y queda auditado el antes; solo nombrados', async () => {
    const r = correr(...base, '--tenant', BELLIDO, '--tarifa', 'meta_incluido', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect((await cuenta(BELLIDO))['tarifa']).toBe('meta_incluido');
    const a = (await auditorias(BELLIDO)).find((x) => (x['despues'] as { tarifa: string }).tarifa === 'meta_incluido');
    expect(a?.['antes']).toMatchObject({ tarifa: 'estandar' });
    expect((await cuenta(OTRO))).not.toHaveProperty('tarifa');
  });
});
