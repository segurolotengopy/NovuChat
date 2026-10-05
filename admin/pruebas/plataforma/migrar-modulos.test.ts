/**
 * `scripts/plataforma/migrar-modulos.mjs` (H2b-3) — EL SECO DE LA MIGRACIÓN `flujos` → `modulos`.
 *
 * Dos partes:
 *   A. `comparar(ficha)` sobre las fichas esperadas (sin Firestore): Demo A, Platinum y Bellido
 *      `['agendamiento']`; Demo B y Q'Taco `['venta']`; NovuChat `['onboarding']` dan CERO diferencias en los
 *      siete chequeos. Y las fichas raras dan diferencias (los chequeos no son decorativos).
 *   B. El script como proceso contra el emulador: es un seco, así que NO escribe (`updateTime` iguales antes
 *      y después, y sin métodos de escritura en su texto); `--aplicar` y `--revertir` terminan con 2; un
 *      tenant con `flujos: null` y otro con dos flujos se informan; sale ≠ 0 si hay diferencias; no imprime
 *      datos del comercio.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', 'scripts', 'plataforma', 'migrar-modulos.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { comparar, notas, CHEQUEOS } = await import('../../scripts/plataforma/migrar-modulos.mjs') as unknown as {
  comparar: (f: unknown) => { modulos: string[]; diferencias: { chequeo: string; antes: unknown; despues: unknown }[] };
  notas: (f: unknown) => { flujosNoLista: boolean; variosFlujos: boolean; conModulosYa: boolean };
  CHEQUEOS: string[];
};
const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'migrar-modulos') ?? initializeApp({ projectId: PROYECTO }, 'migrar-modulos');
const db = getFirestore(app);

describe('A. comparar(ficha): las fichas esperadas dan cero diferencias', () => {
  it('hay ocho entradas de chequeo (los siete; el de pestañas en conjunto y orden)', () => {
    expect(CHEQUEOS).toHaveLength(8);
  });

  const esperadas: [string, Record<string, unknown>][] = [
    ['Demo A', { vertical: 'agendamiento', flujos: ['agendamiento'] }],
    ['Platinum', { vertical: 'agendamiento', flujos: ['agendamiento'] }],
    ['Bellido', { vertical: 'agendamiento', flujos: ['agendamiento'] }],
    ['Demo B', { vertical: 'venta', flujos: ['venta'] }],
    ["Q'Taco", { vertical: 'venta', flujos: ['venta'] }],
    ['NovuChat', { vertical: 'onboarding', flujos: ['onboarding'] }],
    ['solo vertical (ficha anterior a la lista): venta', { vertical: 'venta' }],
    ['solo vertical (ficha anterior a la lista): onboarding', { vertical: 'onboarding' }],
    ['solo vertical (ficha anterior a la lista): agendamiento', { vertical: 'agendamiento' }],
    ["Q'Taco con la ficha exacta de 9 campos (valores sintéticos)", {
      creadoEn: '2026-01-01T00:00:00Z', creadoPor: 'uid-sintetico', estado: 'activo', flujos: ['venta'],
      nombre: 'Comercio de venta de prueba', plan: 'impulso', vertical: 'venta',
      waPhoneNumberId: '1000000001', waWabaId: '1000000002',
    }],
  ];
  it.each(esperadas)('%s: cero diferencias', (_n, ficha) => {
    expect(comparar(ficha).diferencias).toEqual([]);
  });

  it("Q'Taco (venta) conserva el enlace de la carta: catálogo web y pedidos", () => {
    const r = comparar({ vertical: 'venta', flujos: ['venta'] });
    expect(r.modulos).toContain('catalogo-web');
    expect(r.modulos).toContain('pedidos');
  });

  it('un `modulos` que ya existe en la ficha y difiere de los flujos se informa', () => {
    const r = comparar({ vertical: 'venta', flujos: ['venta'], modulos: ['productos', 'campanas'] });
    // Lista EXACTA: borrar el chequeo 1 o el 2 hace fallar esta prueba.
    expect(r.diferencias.map((d) => d.chequeo)).toEqual([
      CHEQUEOS[0], CHEQUEOS[1], CHEQUEOS[2], CHEQUEOS[3], CHEQUEOS[5], CHEQUEOS[7]]);
    expect(notas({ flujos: ['venta'], modulos: [] }).conModulosYa).toBe(true);
  });

  it('flujos null: el registro cierra y los lectores de hoy caen a vertical → diferencias (documento de cobro, pestañas, etiqueta)', () => {
    const r = comparar({ flujos: null, vertical: 'agendamiento' });
    const nombres = r.diferencias.map((d) => d.chequeo);
    expect(nombres).toEqual([CHEQUEOS[2], CHEQUEOS[5], CHEQUEOS[7]]);
    expect(notas({ flujos: null }).flujosNoLista).toBe(true);
    // Una ficha sin `flujos` (solo vertical) NO es «flujos que no es lista».
    expect(notas({ vertical: 'venta' }).flujosNoLista).toBe(false);
  });

  // El orden de pestañas del registro es el declarado (`orden`), no el de la lista de `flujos` de la ficha:
  // con 2 o más flujos la cabecera de la consola CAMBIA de orden (visible). Lo decide H2b-5 (consola); el
  // seco lo informa como diferencia de orden y nunca de conjunto.
  it.each([
    [['agendamiento', 'venta'], [6]],
    [['venta', 'agendamiento'], [6]],
    [['agendamiento', 'onboarding'], []],
    [['onboarding', 'agendamiento'], [6]],
    [['venta', 'onboarding'], []],
    [['onboarding', 'venta'], [6]],
    [['agendamiento', 'venta', 'onboarding'], [6]],
    [['onboarding', 'venta', 'agendamiento'], [6]],
  ] as [string[], number[]][])('flujos %j: diferencias solo de orden de pestañas', (flujos, indices) => {
    const r = comparar({ flujos, vertical: flujos[0] });
    expect(r.diferencias.map((d) => d.chequeo)).toEqual(indices.map((i) => CHEQUEOS[i]));
    expect(notas({ flujos }).variosFlujos).toBe(true);
  });

  it('flujos repetidos o desconocidos no cuentan como 2 flujos', () => {
    expect(notas({ flujos: ['venta', 'venta'] }).variosFlujos).toBe(false);
    expect(notas({ flujos: ['venta', 'interno'] }).variosFlujos).toBe(false);
    expect(notas({ flujos: ['venta', 'agendamiento', 'interno'] }).variosFlujos).toBe(true);
  });

  it('un `flujos` mapa (`{venta: true}`) abre las reglas por sus claves: se detecta por los chequeos 1, 2, 3, 6a y 7', () => {
    const r = comparar({ flujos: { venta: true }, vertical: 'agendamiento' });
    expect(r.diferencias.map((d) => d.chequeo)).toEqual([CHEQUEOS[0], CHEQUEOS[1], CHEQUEOS[2], CHEQUEOS[5], CHEQUEOS[7]]);
    expect(notas({ flujos: { venta: true } }).flujosNoLista).toBe(true);
  });

  it('flujos desconocidos, listas vacías y repetidos', () => {
    expect(comparar({ flujos: ['interno'] }).diferencias).toEqual([]);
    expect(comparar({ flujos: [], vertical: 'venta' }).diferencias).toEqual([]);
    expect(comparar({ flujos: ['venta', 'venta'] }).diferencias).toEqual([]);
  });

  it("(lo que le pasaría a un comercio de venta con `flujos` mal tipado) cambia la venta del catálogo web; NO es el caso de Q'Taco, cuya ficha trae una lista", () => {
    const r = comparar({ flujos: 'venta', vertical: 'venta' });
    expect(r.diferencias.map((d) => d.chequeo)).toContain(CHEQUEOS[3]);
  });
});

describe('B. el script como proceso: solo lee', () => {
  const T_OK = 'mig-mod-ok';
  const T_NULO = 'mig-mod-nulo';
  const T_DOS = 'mig-mod-dos';
  const T_VENTA = 'mig-mod-venta';
  const TENANTS = [T_OK, T_NULO, T_DOS, T_VENTA];
  const SECRETO = 'dato-personal-que-no-debe-salir';

  function correr(...extra: string[]) {
    const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...extra], {
      encoding: 'utf8', env: entornoDelEmulador(HOST), timeout: 60_000,
    });
    return { codigo: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  }
  const tiempos = async (rutas: string[]) => Promise.all(rutas.map(async (r) => {
    const d = await db.doc(r).get();
    return `${r}:${d.exists ? d.updateTime?.toMillis() : 'no existe'}`;
  }));

  const RUTAS = [
    ...TENANTS.map((t) => `tenants/${t}`),
    `tenants/${T_VENTA}/funcionarios/f1`, `tenants/${T_VENTA}/funcionarios/f1/privado/p1`,
  ];

  beforeAll(async () => {
    for (const t of TENANTS) await db.recursiveDelete(db.doc(`tenants/${t}`));
    await db.doc(`tenants/${T_OK}`).set({ nombre: SECRETO, estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'] });
    await db.doc(`tenants/${T_NULO}`).set({ nombre: SECRETO, estado: 'activo', vertical: 'agendamiento', flujos: null });
    await db.doc(`tenants/${T_DOS}`).set({ nombre: SECRETO, estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento', 'venta'] });
    await db.doc(`tenants/${T_VENTA}`).set({ nombre: SECRETO, estado: 'activo', vertical: 'venta', flujos: ['venta'] });
    await db.doc(`tenants/${T_VENTA}/funcionarios/f1`).set({ nombre: SECRETO });
    await db.doc(`tenants/${T_VENTA}/funcionarios/f1/privado/p1`).set({ telefono: SECRETO });
  });

  it('--aplicar y --revertir terminan con 2 y no abren Firestore', () => {
    for (const bandera of ['--aplicar', '--revertir']) {
      const r = correr('--tenant', T_OK, bandera);
      expect(r.codigo, r.salida).toBe(2);
      expect(r.salida).toContain('SOLO un seco');
    }
  });

  it('invocado por un enlace simbólico también corre: sin --proyecto sale 2, no un falso «0»', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-enlace-'));
    try {
      // El enlace queda FUERA del directorio del script: `import.meta.url` y `argv[1]` difieren.
      const enlace = join(dir, 'migrar-modulos-enlace.mjs');
      symlinkSync(SCRIPT, enlace);
      const r = spawnSync(process.execPath, [enlace], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
      expect(r.status, `${r.stdout}${r.stderr}`).toBe(2);
      expect(r.stderr).toContain('falta --proyecto');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('un error de ejecución sale con 3 (no con 1, que es «hay diferencias») y no imprime el mensaje', () => {
    // Sin emulador y sin credenciales (`entornoDelEmulador` las apunta a la nada): la lectura falla de inmediato,
    // sin llegar a ninguna red. El host del emulador se quita solo durante este lanzamiento síncrono.
    const host = process.env['FIRESTORE_EMULATOR_HOST'];
    delete process.env['FIRESTORE_EMULATOR_HOST'];
    let r;
    try {
      r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--tenant', T_OK],
        { env: entornoDelEmulador(undefined), encoding: 'utf8', timeout: 15_000 });
    } finally {
      if (host !== undefined) process.env['FIRESTORE_EMULATOR_HOST'] = host;
    }
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(3);
    expect(r.stderr).toContain('error de ejecución');
  });

  it('--tenant repetido se lee una sola vez', () => {
    const r = correr('--tenant', `${T_OK},${T_OK}`);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain('fichas leídas            : 1');
  });

  it('sin --proyecto o con --tenant inválido: código 2', () => {
    expect(spawnSync(process.execPath, [SCRIPT], { env: entornoDelEmulador(HOST), encoding: 'utf8' }).status).toBe(2);
    expect(correr('--tenant', 'AB').codigo).toBe(2);
  });

  it('el seco no escribe: updateTime iguales antes y después, aun con diferencias', async () => {
    const antes = await tiempos(RUTAS);
    const r = correr('--tenant', TENANTS.join(','));
    expect(r.codigo, r.salida).toBe(1);
    expect(await tiempos(RUTAS)).toEqual(antes);
    expect(r.salida).toContain('no se escribió nada');
  });

  it('su texto no tiene ningún método de escritura', () => {
    const codigo = readFileSync(SCRIPT, 'utf8');
    const sinComentarios = codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(sinComentarios).not.toMatch(/\.(set|update|create|delete|add|commit|batch|bulkWriter|runTransaction|recursiveDelete|writeFile\w*)\s*\(/);
    expect(sinComentarios).not.toMatch(/\bFieldValue\b|\bwriteFile|\bappendFile/);
  });

  it('informa el tenant con flujos null y el de dos flujos, y marca el que no difiere', () => {
    const r = correr('--tenant', TENANTS.join(','));
    expect(r.salida).toMatch(new RegExp(`✓ ${T_OK}: igual`));
    expect(r.salida).toMatch(new RegExp(`✗ ${T_NULO}:`));
    expect(r.salida).toMatch(new RegExp(`✗ ${T_DOS}:`));
    expect(r.salida).toMatch(new RegExp(`flujos que no es lista   : 1 \\(${T_NULO}\\)`));
    expect(r.salida).toMatch(new RegExp(`con 2 o más flujos       : 1 \\(${T_DOS}\\)`));
    expect(r.salida).toContain(CHEQUEOS[6]);
  });

  it('cuenta los funcionarios/*/privado de los comercios sin agenda y no imprime datos', () => {
    const r = correr('--tenant', TENANTS.join(','));
    expect(r.salida).toMatch(new RegExp(`${T_VENTA}: 1 documento\\(s\\)`));
    expect(r.salida).not.toContain(SECRETO);
  });

  it('con solo fichas iguales sale con 0; una ficha inexistente sale con 1', () => {
    const ok = correr('--tenant', `${T_OK},${T_VENTA}`);
    expect(ok.codigo, ok.salida).toBe(0);
    const falta = correr('--tenant', `${T_OK},mig-mod-no-existe`);
    expect(falta.codigo, falta.salida).toBe(1);
    expect(falta.salida).toContain('mig-mod-no-existe: no existe la ficha');
  });
});
