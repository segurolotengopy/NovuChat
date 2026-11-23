/**
 * `scripts/plataforma/registrar-plantilla.mjs` — anota la plantilla de Retomar de un número en
 * `rutasWhatsApp/{n}.plantillas.retomar` (contrato C1). Contra el emulador de Firestore (proyecto `demo-*`), en proceso.
 *
 * Se niega (negando): MARKETING o AUTHENTICATION con APPROVED, variables distintas de 1 con APPROVED, nombre o idioma
 * malos (siempre), producción sin `--confirmo produccion`, `--confirmo` en seco, ruta inexistente (no se crea), un
 * `plantillas` que no es un mapa. Se afirma: seco no escribe; aplicar escribe SOLO `plantillas.retomar` (con
 * `registradaEn`) y conserva el resto de la ruta y los otros usos; idempotente; con estado distinto de APPROVED se
 * puede registrar para apagar; si la ruta cambia entre la lectura y la escritura, no escribe.
 */
import { describe, expect, it } from 'vitest';

const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8281'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;
const PROYECTO = 'demo-novuchat-pruebas';

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'registrar-plantilla') ?? initializeApp({ projectId: PROYECTO }, 'registrar-plantilla');
const db = getFirestore(app);

type Cfg = Record<string, unknown>;
type Plantilla = { nombre: string; idioma: string; categoria: string; estado: string; variables: number };
const mod = await import('../../scripts/plataforma/registrar-plantilla.mjs') as unknown as {
  analizarArgumentos: (argv: string[], env?: Record<string, string>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
  plantillaRetomarValida: (p: unknown) => boolean;
  problemasDeLaPlantilla: (p: unknown) => string[];
};

const ENV_EMU = { FIRESTORE_EMULATOR_HOST: HOST };
const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };
const BUENA: Plantilla = { nombre: 'retomar_consulta', idioma: 'es', categoria: 'UTILITY', estado: 'APPROVED', variables: 1 };

let contador = 0;
const nuevoNumero = () => `5917${String(Date.now()).slice(-6)}${String(contador++).padStart(3, '0')}`;
const argv = (n: string, p: Partial<Record<keyof Plantilla, string>> = {}, extra: string[] = []) => [
  '--proyecto', PROYECTO, '--numero', n, '--uso', 'retomar',
  '--nombre', p.nombre ?? BUENA.nombre, '--idioma', p.idioma ?? BUENA.idioma, '--categoria', p.categoria ?? BUENA.categoria, '--estado', p.estado ?? BUENA.estado,
  ...(p.variables === undefined ? [] : ['--variables', p.variables]), ...extra,
];
const cfgDe = (a: string[]) => {
  const r = mod.analizarArgumentos(a, ENV_EMU);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.cfg as Cfg;
};
const corre = async (a: string[], d: Record<string, unknown> = {}) => {
  const salida: string[] = [];
  const codigo = await mod.ejecutar(cfgDe(a), { db, FieldValue, log: (x: string) => salida.push(x), ...d });
  return { codigo, texto: salida.join('\n') };
};
const ruta = async (n: string, o: Record<string, unknown> = {}) => { await db.doc(`rutasWhatsApp/${n}`).set({ tenantId: 'tienda-prueba', flujo: 'agendamiento', aliasSecreto: 'clienteZz', estado: 'activo', ...o }); };
const leer = async (n: string) => (await db.doc(`rutasWhatsApp/${n}`).get());

describe('C1 puro: plantillaRetomarValida', () => {
  it('acepta exactamente lo del contrato (registradaEn no cuenta)', () => {
    expect(mod.plantillaRetomarValida(BUENA)).toBe(true);
    expect(mod.plantillaRetomarValida({ ...BUENA, registradaEn: 'x' })).toBe(true);
    expect(mod.plantillaRetomarValida({ ...BUENA, idioma: 'es_BO' })).toBe(true);
    expect(mod.plantillaRetomarValida({ ...BUENA, idioma: 'fil' })).toBe(true);
  });

  const malas: Array<[string, unknown]> = [
    ['MARKETING', { ...BUENA, categoria: 'MARKETING' }],
    ['AUTHENTICATION', { ...BUENA, categoria: 'AUTHENTICATION' }],
    ['categoría en minúsculas', { ...BUENA, categoria: 'utility' }],
    ['PAUSED', { ...BUENA, estado: 'PAUSED' }],
    ['PENDING', { ...BUENA, estado: 'PENDING' }],
    ['estado en minúsculas', { ...BUENA, estado: 'approved' }],
    ['variables 0', { ...BUENA, variables: 0 }],
    ['variables 2', { ...BUENA, variables: 2 }],
    ['variables "1" (texto)', { ...BUENA, variables: '1' }],
    ['nombre con mayúsculas', { ...BUENA, nombre: 'Retomar' }],
    ['nombre con espacio', { ...BUENA, nombre: 'retomar consulta' }],
    ['nombre vacío', { ...BUENA, nombre: '' }],
    ['nombre de 101 caracteres', { ...BUENA, nombre: 'a'.repeat(101) }],
    ['nombre con salto de línea', { ...BUENA, nombre: 'retomar\n' }],
    ['idioma en mayúsculas', { ...BUENA, idioma: 'ES' }],
    ['idioma con guion', { ...BUENA, idioma: 'es-MX' }],
    ['idioma con región en minúsculas', { ...BUENA, idioma: 'es_mx' }],
    ['idioma largo', { ...BUENA, idioma: 'espa' }],
    ['sin nombre', { ...BUENA, nombre: undefined }],
    ['null', null],
    ['texto', 'retomar_consulta'],
  ];
  it.each(malas)('rechaza: %s', (_n, p) => { expect(mod.plantillaRetomarValida(p)).toBe(false); });
});

describe('problemasDeLaPlantilla y argumentos (puros)', () => {
  const problemas = (a: string[], env: Record<string, string> = ENV_EMU) => {
    const r = mod.analizarArgumentos(a, env);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    return (r.problemas ?? []).join(' | ');
  };

  it('la invocación completa es válida y queda en seco', () => {
    const r = mod.analizarArgumentos(argv('59170000001'), ENV_EMU);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.cfg).toMatchObject({ numero: '59170000001', uso: 'retomar', aplicar: false, entorno: 'emulador', plantilla: BUENA });
  });

  it('NEGATIVA: APPROVED con MARKETING o AUTHENTICATION no se registra', () => {
    for (const categoria of ['MARKETING', 'AUTHENTICATION']) expect(problemas(argv('59170000001', { categoria }))).toContain('UTILITY');
  });

  it('NEGATIVA: APPROVED con variables distintas de 1 no se registra (0, 2, 5)', () => {
    for (const variables of [0, 2, 5]) expect(problemas(argv('59170000001', { variables: String(variables) as never }))).toContain('--variables 1');
  });

  it('NEGATIVA: nombre e idioma malos no se registran ni con un estado que no sea APPROVED', () => {
    for (const nombre of ['Retomar', 'retomar consulta', 'retomar-consulta', 'a'.repeat(101)]) {
      expect(problemas(argv('59170000001', { nombre })), nombre).toContain('--nombre inválido');
      expect(problemas(argv('59170000001', { nombre, estado: 'PAUSED' })), nombre).toContain('--nombre inválido');
    }
    for (const idioma of ['ES', 'es-MX', 'es_mx', 'espa', 'e']) {
      expect(problemas(argv('59170000001', { idioma })), idioma).toContain('--idioma inválido');
      expect(problemas(argv('59170000001', { idioma, estado: 'PAUSED' })), idioma).toContain('--idioma inválido');
    }
  });

  it('con un estado distinto de APPROVED SÍ se registra cualquier categoría (para apagar)', () => {
    for (const estado of ['PAUSED', 'REJECTED', 'DISABLED', 'PENDING']) {
      const r = mod.analizarArgumentos(argv('59170000001', { estado, categoria: 'MARKETING' }), ENV_EMU);
      expect(r.ok, estado + JSON.stringify(r)).toBe(true);
    }
  });

  it('faltan datos, opción desconocida, repetida, número o uso malos', () => {
    expect(problemas(['--proyecto', PROYECTO])).toMatch(/falta --numero.*falta --uso|falta --uso.*falta --numero/);
    expect(problemas([...argv('59170000001'), '--raro', 'x'])).toContain('opción desconocida');
    expect(problemas([...argv('59170000001'), '--idioma', 'es'])).toContain('opción repetida: --idioma');
    expect(problemas(argv('5917abc'))).toContain('--numero inválido');
    expect(problemas(argv('59170000001').map((x) => (x === 'retomar' ? 'aviso' : x)))).toContain('--uso tiene que ser');
  });

  it('NEGATIVA producción: --aplicar sin --confirmo produccion no se acepta; con otro valor tampoco', () => {
    const base = argv('59170000001').map((x) => (x === PROYECTO ? 'proyecto-ficticio-prod' : x));
    expect(problemas([...base, '--aplicar'], ENV_REAL)).toContain('--aplicar exige --confirmo produccion');
    expect(problemas([...base, '--aplicar', '--confirmo', 'si'], ENV_REAL)).toContain('exactamente «produccion»');
    expect(mod.analizarArgumentos([...base, '--aplicar', '--confirmo', 'produccion'], ENV_REAL).ok).toBe(true);
    expect(mod.analizarArgumentos(base, ENV_REAL).ok).toBe(true);   // el seco no pide nada
  });

  it('--confirmo solo acompaña a --aplicar y solo contra producción', () => {
    expect(problemas([...argv('59170000001'), '--confirmo', 'produccion'])).toContain('solo acompaña a --aplicar');
    expect(problemas([...argv('59170000001'), '--aplicar', '--confirmo', 'produccion'])).toContain('solo se usa contra producción');
  });

  it('el proyecto tiene que estar en la lista blanca', () => {
    expect(problemas(argv('59170000001').map((x) => (x === PROYECTO ? 'otro-proyecto' : x)), ENV_REAL)).toMatch(/proyecto/i);
  });
});

describe('ejecutar contra el emulador', () => {
  it('seco: no escribe nada (la ruta queda idéntica) y sale 1', async () => {
    const n = nuevoNumero();
    await ruta(n);
    const antes = await leer(n);
    const r = await corre(argv(n));
    expect(r.codigo).toBe(1);
    expect(r.texto).toContain('Seco');
    const despues = await leer(n);
    expect(despues.updateTime?.toMillis()).toBe(antes.updateTime?.toMillis());
    expect(despues.data()).not.toHaveProperty('plantillas');
  });

  it('aplicar: escribe SOLO plantillas.retomar con registradaEn, conserva el resto y los otros usos; la relee', async () => {
    const n = nuevoNumero();
    await ruta(n, { plantillas: { aviso: { nombre: 'aviso_x', idioma: 'es', categoria: 'UTILITY', estado: 'APPROVED', variables: 2 } } });
    const antes = (await leer(n)).data() as Record<string, unknown>;
    const r = await corre(argv(n, {}, ['--aplicar']));
    expect(r.codigo, r.texto).toBe(0);
    const d = (await leer(n)).data() as Record<string, unknown> & { plantillas: Record<string, Record<string, unknown>> };
    expect(d.plantillas['retomar']).toMatchObject(BUENA);
    expect(d.plantillas['retomar']?.['registradaEn']).toBeDefined();
    expect(d.plantillas['aviso']).toEqual((antes['plantillas'] as Record<string, unknown>)['aviso']);
    const { plantillas: _a, ...restoAntes } = antes;
    const { plantillas: _d, ...restoDespues } = d;
    expect(restoDespues).toEqual(restoAntes);
    expect(r.texto).toContain('Cumple C1');
  });

  it('idempotente: registrar lo mismo otra vez sale 0 y no escribe (la hora de la ruta no cambia)', async () => {
    const n = nuevoNumero();
    await ruta(n);
    expect((await corre(argv(n, {}, ['--aplicar']))).codigo).toBe(0);
    const h = (await leer(n)).updateTime?.toMillis();
    const r = await corre(argv(n, {}, ['--aplicar']));
    expect(r.codigo).toBe(0);
    expect(r.texto).toContain('nada que hacer');
    expect((await leer(n)).updateTime?.toMillis()).toBe(h);
  });

  it('cambiar el estado a PAUSED (con la categoría recategorizada) se registra y deja de cumplir C1 (para apagar)', async () => {
    const n = nuevoNumero();
    await ruta(n);
    expect((await corre(argv(n, {}, ['--aplicar']))).codigo).toBe(0);
    const r = await corre(argv(n, { estado: 'PAUSED', categoria: 'MARKETING' }, ['--aplicar']));
    expect(r.codigo, r.texto).toBe(0);
    const p = (await leer(n)).get('plantillas.retomar');
    expect(p).toMatchObject({ estado: 'PAUSED', categoria: 'MARKETING' });
    expect(mod.plantillaRetomarValida(p)).toBe(false);
    expect(r.texto).toContain('NO cumple C1');
  });

  it('NEGATIVA: una ruta inexistente no se crea, sale 2', async () => {
    const n = nuevoNumero();
    const r = await corre(argv(n, {}, ['--aplicar']));
    expect(r.codigo).toBe(2);
    expect((await leer(n)).exists).toBe(false);
  });

  it('NEGATIVA: si `plantillas` no es un mapa, no se pisa (2)', async () => {
    const n = nuevoNumero();
    await ruta(n, { plantillas: 'roto' });
    const r = await corre(argv(n, {}, ['--aplicar']));
    expect(r.codigo).toBe(2);
    expect((await leer(n)).get('plantillas')).toBe('roto');
  });

  it('NEGATIVA: si la ruta cambia entre la lectura y la escritura, no escribe (3)', async () => {
    const n = nuevoNumero();
    await ruta(n);
    const real = db.doc(`rutasWhatsApp/${n}`);
    const carrera = {
      doc: () => ({
        get: async () => { const s = await real.get(); await real.update({ otro: 1 }); return s; },
        update: (...a: unknown[]) => (real.update as (...x: unknown[]) => Promise<unknown>)(...a),
      }),
    };
    const r = await corre(argv(n, {}, ['--aplicar']), { db: carrera });
    expect(r.codigo).toBe(3);
    expect((await leer(n)).data()).not.toHaveProperty('plantillas');
  });
});
