/**
 * =============================================================================
 * LÍMITE DE AGENDAS POR PLAN (H2b-9; Q6=A) — la prueba se escribe NEGANDO
 * =============================================================================
 *
 * Cuentan los `calendarioId` DISTINTOS entre los funcionarios ACTIVOS; uno
 * activo con `calendarioId` vacío no cuenta. El límite sale del plan (1 / 5 / 10),
 * nunca del código, y lo hacen cumplir las reglas con `contadores/agendas`.
 *
 *  1. Una sola fuente para los números (tabla de respaldo de las reglas contra
 *     `planes.ts`) y el criterio de conteo puro.
 *  2. Las reglas contra el emulador: lo que NO puede pasar.
 *  3. `scripts/modulos/agenda/contar-agendas.mjs`: en seco no escribe.
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, serverTimestamp, Timestamp, writeBatch, type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  claveAgenda, contarAgendas, moverAgenda, superaElTope,
} from '../../../functions/src/modulos/agenda/agendasContadas.ts';
import { PLANES_ASIGNABLES, PLANES, PLAN_POR_DEFECTO, LIMITE_MAXIMO } from '../../../functions/src/central/cuenta/planes.ts';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(aqui, '..', '..', '..');
const REGLAS = readFileSync(join(RAIZ, 'firestore.rules'), 'utf8');
const PROYECTO = 'demo-novuchat-pruebas';
const PUERTO = Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231);

const cal = (c: string) => `${c.repeat(64).slice(0, 64)}@group.calendar.google.com`;
const C1 = cal('a'), C2 = cal('b'), C3 = cal('c'), C4 = cal('d'), C5 = cal('e'), C6 = cal('f');

// ===========================================================================
// 1) FUENTE ÚNICA Y CRITERIO
// ===========================================================================
describe('Los números del límite: una sola fuente', () => {
  const desde = REGLAS.indexOf('function limiteAgendas()');
  const funcion = REGLAS.slice(desde, REGLAS.indexOf('// El contador se movió', desde));

  it('la tabla de respaldo de las reglas es la de planes.ts, con el mismo mínimo', () => {
    const m = funcion.match(/\{('[^}]*)\}\s*\.get\(cuenta\.get\('plan', ''\),\s*(\d+)\)/);
    expect(m, 'no se encontró la tabla en limiteAgendas()').not.toBeNull();
    const tabla = Object.fromEntries([...m![1]!.matchAll(/'(\w+)':\s*(\d+)/g)].map((x) => [x[1], Number(x[2])]));
    expect(tabla).toEqual(Object.fromEntries(Object.entries(PLANES_ASIGNABLES).map(([id, p]) => [id, p.agendas])));
    expect(Number(m![2])).toBe(PLANES[PLAN_POR_DEFECTO].agendas);
    expect(Math.min(...Object.values(PLANES).map((p) => p.agendas))).toBe(Number(m![2]));
  });

  it('la regla acepta la copia en el MISMO rango que limitesDeCuenta (1..LIMITE_MAXIMO)', () => {
    const r = funcion.match(/propio is int && propio >= (\d+) && propio <= (\d+)/);
    expect(r).not.toBeNull();
    expect(Number(r![1])).toBe(1);
    expect(Number(r![2])).toBe(LIMITE_MAXIMO);
  });

  it('son los vendidos: 1 / 5 / 10', () => {
    expect(PLANES.impulso.agendas).toBe(1);
    expect(PLANES.crecimiento.agendas).toBe(5);
    expect(PLANES.pro.agendas).toBe(10);
  });
});

describe('El criterio de conteo (Q6=A)', () => {
  it('cuenta los calendarioId distintos entre activos; vacío e inactivo no cuentan', () => {
    const r = contarAgendas([
      { activo: true, calendarioId: C1 }, { activo: true, calendarioId: C1.toUpperCase().replace('@GROUP.CALENDAR.GOOGLE.COM', '@group.calendar.google.com') },
      { activo: true, calendarioId: C2 }, { activo: true, calendarioId: '' },
      { activo: false, calendarioId: C3 }, { activo: true },
    ]);
    expect(r.calendarios).toBe(2);
    expect(r.refs[C1]).toBe(2);
    expect(claveAgenda({ activo: true, calendarioId: '' })).toBe('');
    expect(claveAgenda({ activo: false, calendarioId: C1 })).toBe('');
  });

  it('mover: compartir no suma, el último en irse libera, y subir sobre el tope se detecta', () => {
    const c = contarAgendas([{ activo: true, calendarioId: C1 }]);
    expect(c.calendarios).toBe(1);
    expect(moverAgenda(c, '', C1).calendarios).toBe(1);
    expect(moverAgenda(c, C1, '').calendarios).toBe(0);
    expect(moverAgenda(c, '', C2).calendarios).toBe(2);
    expect(superaElTope(c, '', C2, 1)).toBe(true);
    expect(superaElTope(c, '', C1, 1)).toBe(false);
    expect(superaElTope(c, '', '', 1)).toBe(false);
    // Ya por encima (bajó de plan): quitar y mover dentro de lo contado se puede.
    const alto = contarAgendas([{ activo: true, calendarioId: C1 }, { activo: true, calendarioId: C2 }]);
    expect(superaElTope(alto, C1, '', 1)).toBe(false);
    expect(superaElTope(alto, '', C3, 1)).toBe(true);
  });
});

// ===========================================================================
// 2) LAS REGLAS, NEGANDO
// ===========================================================================
let entorno: RulesTestEnvironment;
const T = 'tag';
const claims = (t: string, rol: string) => ({
  nc: { t: { [t]: rol }, v: 1 },
  firebase: { sign_in_provider: 'password', identities: {} },
  email_verified: true,
});
const admin = (t = T): Firestore => entorno.authenticatedContext(`u-admin-${t}`, claims(t, 'admin')).firestore();
const sello = { actualizadoPor: 'u-admin-tag', actualizadoEn: serverTimestamp() };
const func = (calendarioId: string, activo = true, nombre = 'Ana') =>
  ({ nombre, especialidad: '', calendarioId, horarioTrabajo: {}, servicios: [], activo, ...sello });

type Cuenta = Record<string, unknown>;
async function sembrar(
  { cuenta = { plan: 'crecimiento' } as Cuenta | null, ficha = { nombre: 'x', estado: 'activo', plan: 'crecimiento', flujos: ['agendamiento'] } as Record<string, unknown>,
    funcionarios = [] as Array<[string, string, boolean]>, contador = true } = {},
) {
  await entorno.clearFirestore();
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `tenants/${T}`), ficha);
    if (cuenta) await setDoc(doc(db, `tenants/${T}/cuenta/estado`), cuenta);
    for (const [id, c, activo] of funcionarios) {
      await setDoc(doc(db, `tenants/${T}/funcionarios/${id}`), { ...func(c, activo), actualizadoEn: Timestamp.now() });
    }
    if (contador) {
      const real = contarAgendas(funcionarios.map(([, c, activo]) => ({ calendarioId: c, activo })));
      await setDoc(doc(db, `tenants/${T}/contadores/agendas`), {
        calendarios: real.calendarios, refs: real.refs, ultimoFuncionario: '', actualizadoEn: Timestamp.now(),
      });
    }
  });
}

/** Lote como el de la consola: funcionario + contador movido. */
const lote = (db: Firestore, id: string, datos: Record<string, unknown>, contador: Record<string, unknown> | null) => {
  const l = writeBatch(db);
  l.set(doc(db, `tenants/${T}/funcionarios/${id}`), datos);
  if (contador) l.update(doc(db, `tenants/${T}/contadores/agendas`), { ultimoFuncionario: id, actualizadoEn: serverTimestamp(), ...contador });
  return l.commit();
};
const leerContador = async () => {
  let d: Record<string, unknown> | undefined;
  await entorno.withSecurityRulesDisabled(async (ctx) => { d = (await getDoc(doc(ctx.firestore(), `tenants/${T}/contadores/agendas`))).data(); });
  return d;
};

beforeAll(async () => {
  entorno = await initializeTestEnvironment({
    projectId: PROYECTO, firestore: { rules: REGLAS, host: '127.0.0.1', port: PUERTO },
  });
});
afterAll(async () => { await entorno?.cleanup(); });

describe('Reglas: el tope del plan, negando', () => {
  it('plan Crecimiento (5): la sexta agenda distinta NO entra, ni con el contador mentido', async () => {
    await sembrar({ funcionarios: [['f1', C1, true], ['f2', C2, true], ['f3', C3, true], ['f4', C4, true], ['f5', C5, true]] });
    const refs = { [C1]: 1, [C2]: 1, [C3]: 1, [C4]: 1, [C5]: 1, [C6]: 1 };
    await assertFails(lote(admin(), 'f6', func(C6), { calendarios: 6, refs }));
    // Mentir: decir 5 con la sexta clave dentro.
    await assertFails(lote(admin(), 'f6', func(C6), { calendarios: 5, refs }));
    // Sin tocar el contador.
    await assertFails(lote(admin(), 'f6', func(C6), null));
    expect((await leerContador())!['calendarios']).toBe(5);
  });

  it('la quinta SÍ entra, y compartir un calendario no suma', async () => {
    await sembrar({ funcionarios: [['f1', C1, true], ['f2', C2, true], ['f3', C3, true], ['f4', C4, true]] });
    await assertSucceeds(lote(admin(), 'f5', func(C5), { calendarios: 5, refs: { [C1]: 1, [C2]: 1, [C3]: 1, [C4]: 1, [C5]: 1 } }));
    // Con 5 de 5, otro funcionario sobre un calendario YA contado entra (calendarios sigue en 5).
    await assertSucceeds(lote(admin(), 'f6', func(C1, true, 'Beto'), { calendarios: 5, refs: { [C1]: 2, [C2]: 1, [C3]: 1, [C4]: 1, [C5]: 1 } }));
  });

  it('un funcionario activo con calendarioId vacío NO cuenta ni toca el contador (con el tope lleno)', async () => {
    await sembrar({ cuenta: { plan: 'impulso' }, funcionarios: [['f1', C1, true]] });
    await assertSucceeds(setDoc(doc(admin(), `tenants/${T}/funcionarios/f2`), func('', true, 'Sin agenda')));
    expect((await leerContador())!['calendarios']).toBe(1);
  });

  it('plan Impulso (1): una segunda agenda distinta NO entra', async () => {
    await sembrar({ cuenta: { plan: 'impulso' }, funcionarios: [['f1', C1, true]] });
    await assertFails(lote(admin(), 'f2', func(C2), { calendarios: 2, refs: { [C1]: 1, [C2]: 1 } }));
  });

  it('el límite sale del plan: cuenta.limites.agendas manda sobre la tabla, y uno corrupto no', async () => {
    await sembrar({ cuenta: { plan: 'impulso', limites: { agendas: 2 } }, funcionarios: [['f1', C1, true]] });
    await assertSucceeds(lote(admin(), 'f2', func(C2), { calendarios: 2, refs: { [C1]: 1, [C2]: 1 } }));
    await sembrar({ cuenta: { plan: 'impulso', limites: { agendas: 0 } }, funcionarios: [['f1', C1, true]] });
    await assertFails(lote(admin(), 'f2', func(C2), { calendarios: 2, refs: { [C1]: 1, [C2]: 1 } }));
    // Sin cuenta ni plan: el más chico.
    await sembrar({ cuenta: null, funcionarios: [['f1', C1, true]] });
    await assertFails(lote(admin(), 'f2', func(C2), { calendarios: 2, refs: { [C1]: 1, [C2]: 1 } }));
  });

  it('reactivar a un funcionario inactivo cuenta como alta: con el tope lleno NO se puede', async () => {
    await sembrar({ cuenta: { plan: 'impulso' }, funcionarios: [['f1', C1, true], ['f2', C2, false]] });
    await assertFails(lote(admin(), 'f2', func(C2, true), { calendarios: 2, refs: { [C1]: 1, [C2]: 1 } }));
  });

  it('mover un funcionario a otra agenda con el tope lleno NO se puede; dar de baja SÍ, y libera', async () => {
    await sembrar({ cuenta: { plan: 'impulso' }, funcionarios: [['f1', C1, true], ['f2', C1, true]] });
    await assertFails(lote(admin(), 'f2', func(C2), { calendarios: 2, refs: { [C1]: 1, [C2]: 1 } }));
    await assertSucceeds(lote(admin(), 'f2', func(C1, false), { calendarios: 1, refs: { [C1]: 1 } }));
    await assertSucceeds(lote(admin(), 'f1', func(C1, false), { calendarios: 0, refs: { [C1]: 0 } }));
    await assertSucceeds(lote(admin(), 'f3', func(C2), { calendarios: 1, refs: { [C1]: 0, [C2]: 1 } }));
  });

  it('un comercio que bajó de plan (por encima del tope) no suma, pero sí quita', async () => {
    await sembrar({ cuenta: { plan: 'impulso' }, funcionarios: [['f1', C1, true], ['f2', C2, true], ['f3', C3, true]] });
    await assertFails(lote(admin(), 'f4', func(C4), { calendarios: 4, refs: { [C1]: 1, [C2]: 1, [C3]: 1, [C4]: 1 } }));
    await assertSucceeds(lote(admin(), 'f3', func(C3, false), { calendarios: 2, refs: { [C1]: 1, [C2]: 1, [C3]: 0 } }));
  });

  it('el contador no se mueve por su cuenta, ni se baja a mano para colar una agenda', async () => {
    await sembrar({ cuenta: { plan: 'impulso' }, funcionarios: [['f1', C1, true]] });
    const db = admin();
    const l = writeBatch(db);
    l.update(doc(db, `tenants/${T}/contadores/agendas`), { calendarios: 0, refs: {}, ultimoFuncionario: 'f1', actualizadoEn: serverTimestamp() });
    await assertFails(l.commit());
    // Tampoco con un funcionario que no cambia su aporte en el lote.
    await assertFails(lote(admin(), 'f1', func(C1, true, 'Ana María'), { calendarios: 0, refs: { [C1]: 0 } }));
    expect(await leerContador()).toMatchObject({ calendarios: 1 });
  });

  it('un lote no puede colar DOS agendas con un solo movimiento del contador', async () => {
    await sembrar({ cuenta: { plan: 'crecimiento' }, funcionarios: [] });
    const db = admin();
    const l = writeBatch(db);
    l.set(doc(db, `tenants/${T}/funcionarios/f1`), func(C1));
    l.set(doc(db, `tenants/${T}/funcionarios/f2`), func(C2, true, 'Beto'));
    l.update(doc(db, `tenants/${T}/contadores/agendas`), { calendarios: 1, refs: { [C1]: 1 }, ultimoFuncionario: 'f1', actualizadoEn: serverTimestamp() });
    await assertFails(l.commit());
  });

  it('sin contador no se cambia un calendario desde el navegador; el contador no se crea ni se borra', async () => {
    await sembrar({ contador: false });
    await assertFails(setDoc(doc(admin(), `tenants/${T}/funcionarios/f1`), func(C1)));
    await assertFails(setDoc(doc(admin(), `tenants/${T}/contadores/agendas`),
      { calendarios: 0, refs: {}, ultimoFuncionario: '', actualizadoEn: serverTimestamp() }));
  });

  it('un operador, otro comercio y un comercio sin el módulo agenda no mueven el contador', async () => {
    await sembrar({ funcionarios: [] });
    const refs = { [C1]: 1 };
    const oper = entorno.authenticatedContext('u-oper', claims(T, 'oper')).firestore();
    await assertFails(lote(oper, 'f1', func(C1), { calendarios: 1, refs }));
    await assertFails(lote(admin('otro'), 'f1', func(C1), { calendarios: 1, refs }));
    await sembrar({ ficha: { nombre: 'x', estado: 'activo', plan: 'crecimiento', flujos: ['venta'] }, funcionarios: [] });
    await assertFails(lote(admin(), 'f1', func(C1), { calendarios: 1, refs }));
    // Comercio suspendido.
    await sembrar({ ficha: { nombre: 'x', estado: 'suspendido', plan: 'crecimiento', flujos: ['agendamiento'] }, funcionarios: [] });
    await assertFails(lote(admin(), 'f1', func(C1), { calendarios: 1, refs }));
  });

  it('el contador no admite claves de más ni un ultimoFuncionario que no existe', async () => {
    await sembrar({ funcionarios: [] });
    await assertFails(lote(admin(), 'f1', func(C1), { calendarios: 1, refs: { [C1]: 1 }, extra: 1 }));
    const db = admin();
    const l = writeBatch(db);
    l.set(doc(db, `tenants/${T}/funcionarios/f1`), func(C1));
    l.update(doc(db, `tenants/${T}/contadores/agendas`), { calendarios: 1, refs: { [C1]: 1 }, ultimoFuncionario: 'fantasma', actualizadoEn: serverTimestamp() });
    await assertFails(l.commit());
  });

  it('el camino feliz funciona: alta, y el contador queda con el nombre del funcionario', async () => {
    await sembrar({ funcionarios: [] });
    await assertSucceeds(lote(admin(), 'f1', func(C1), { calendarios: 1, refs: { [C1]: 1 } }));
    expect(await leerContador()).toMatchObject({ calendarios: 1, ultimoFuncionario: 'f1', refs: { [C1]: 1 } });
  });
});

// ===========================================================================
// 3) EL SCRIPT, EN SECO
// ===========================================================================
describe('contar-agendas.mjs', () => {
  const correr = (...args: string[]) => spawnSync(process.execPath, ['scripts/modulos/agenda/contar-agendas.mjs', ...args], {
    cwd: RAIZ, encoding: 'utf8', env: entornoDelEmulador(`127.0.0.1:${PUERTO}`),
  });

  beforeEach(async () => { await sembrar({ funcionarios: [['f1', C1, true], ['f2', C1, true], ['f3', '', true]], contador: false }); });

  it('sin --proyecto se niega; en seco informa y NO escribe; con --aplicar crea el contador verdadero', async () => {
    expect(correr().status).toBe(2);
    const seco = correr('--proyecto', PROYECTO, '--tenant', T);
    expect(seco.status, seco.stderr).toBe(0);
    expect(seco.stdout).toMatch(/FALTA/);
    expect(seco.stdout).toMatch(/seco/);
    expect(await leerContador()).toBeUndefined();
    const hecho = correr('--proyecto', PROYECTO, '--tenant', T, '--aplicar');
    expect(hecho.status, hecho.stderr).toBe(0);
    expect(await leerContador()).toMatchObject({ calendarios: 1, refs: { [C1]: 2 }, ultimoFuncionario: '' });
    expect(correr('--proyecto', PROYECTO, '--tenant', T).stdout).toMatch(/al día/);
  });
});
