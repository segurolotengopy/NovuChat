/**
 * `scripts/plataforma/registrar-plantilla.mjs` — anota la plantilla de Retomar de un número en
 * `rutasWhatsApp/{n}.plantillas.retomar` (contrato C1). Contra el emulador de Firestore (proyecto `demo-*`), en proceso.
 *
 * Se niega (negando): MARKETING o AUTHENTICATION con APPROVED, variables distintas de 1 con APPROVED, nombre o idioma
 * malos (siempre), producción sin `--confirmo-produccion <numero>`, `--confirmo-produccion` en seco, comercio excluido, sin `--respaldo`, ruta inexistente (no se crea), un
 * `plantillas` que no es un mapa. Se afirma: seco no escribe; aplicar escribe SOLO `plantillas.retomar` (con
 * `registradaEn`) y conserva el resto de la ruta y los otros usos; idempotente; con estado distinto de APPROVED se
 * puede registrar para apagar; si la ruta cambia entre la lectura y la escritura, no escribe.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

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
  analizarArgumentos: (argv: string[], env?: Record<string, string>, op?: Record<string, unknown>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
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
const dirs: string[] = [];
const rutaRespaldo = () => { const d = mkdtempSync(join('/tmp', 'plantilla-')); chmodSync(d, 0o700); dirs.push(d); return join(d, 'respaldo.json'); };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
/** `--aplicar` exige respaldo: las pruebas de escritura lo traen por omisión. */
const aplicar = (n: string, p: Partial<Record<keyof Plantilla, string>> = {}) => argv(n, p, ['--aplicar', '--respaldo', rutaRespaldo()]);
const cfgDe = (a: string[]) => {
  const r = mod.analizarArgumentos(a, ENV_EMU);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.cfg as Cfg;
};
const corre = async (a: string[], d: Record<string, unknown> = {}) => {
  const salida: string[] = [];
  const codigo = await mod.ejecutar(cfgDe(a), { db, FieldValue, env: ENV_EMU, log: (x: string) => salida.push(x), ...d });
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

  it('NEGATIVA producción: --aplicar sin --confirmo-produccion no se acepta; con otro valor tampoco; con el número, sí', () => {
    const base = argv('59170000001').map((x) => (x === PROYECTO ? 'proyecto-ficticio-prod' : x));
    const resp = ['--respaldo', rutaRespaldo()];
    expect(problemas([...base, '--aplicar', ...resp], ENV_REAL)).toContain('--aplicar exige --confirmo-produccion');
    expect(problemas([...base, '--aplicar', ...resp, '--confirmo-produccion', 'produccion'], ENV_REAL)).toContain('no coincide con --numero');
    expect(problemas([...base, '--aplicar', ...resp, '--confirmo-produccion', '59170000002'], ENV_REAL)).toContain('no coincide con --numero');
    expect(mod.analizarArgumentos([...base, '--aplicar', ...resp, '--confirmo-produccion', '59170000001'], ENV_REAL).ok).toBe(true);
    expect(mod.analizarArgumentos(base, ENV_REAL).ok).toBe(true);   // el seco no pide nada
  });

  it('--aplicar exige --respaldo', () => {
    expect(problemas([...argv('59170000001'), '--aplicar'])).toContain('--aplicar exige --respaldo');
  });

  it('--confirmo-produccion solo acompaña a --aplicar y solo contra producción', () => {
    expect(problemas([...argv('59170000001'), '--confirmo-produccion', '59170000001'])).toContain('solo acompaña a --aplicar');
    expect(problemas([...argv('59170000001'), '--aplicar', '--respaldo', rutaRespaldo(), '--confirmo-produccion', '59170000001'])).toContain('solo se usa contra producción');
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
    const r = await corre(aplicar(n));
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
    expect((await corre(aplicar(n))).codigo).toBe(0);
    const h = (await leer(n)).updateTime?.toMillis();
    const r = await corre(aplicar(n));
    expect(r.codigo).toBe(0);
    expect(r.texto).toContain('nada que hacer');
    expect((await leer(n)).updateTime?.toMillis()).toBe(h);
  });

  it('cambiar el estado a PAUSED (con la categoría recategorizada) se registra y deja de cumplir C1 (para apagar)', async () => {
    const n = nuevoNumero();
    await ruta(n);
    expect((await corre(aplicar(n))).codigo).toBe(0);
    const r = await corre(aplicar(n, { estado: 'PAUSED', categoria: 'MARKETING' }));
    expect(r.codigo, r.texto).toBe(0);
    const p = (await leer(n)).get('plantillas.retomar');
    expect(p).toMatchObject({ estado: 'PAUSED', categoria: 'MARKETING' });
    expect(mod.plantillaRetomarValida(p)).toBe(false);
    expect(r.texto).toContain('NO cumple C1');
  });

  it('NEGATIVA: una ruta inexistente no se crea, sale 2', async () => {
    const n = nuevoNumero();
    const r = await corre(aplicar(n));
    expect(r.codigo).toBe(2);
    expect((await leer(n)).exists).toBe(false);
  });

  it('NEGATIVA: si `plantillas` no es un mapa, no se pisa (2)', async () => {
    const n = nuevoNumero();
    await ruta(n, { plantillas: 'roto' });
    const r = await corre(aplicar(n));
    expect(r.codigo).toBe(2);
    expect((await leer(n)).get('plantillas')).toBe('roto');
  });

  it('NEGATIVA: si la ruta cambia entre la lectura y la escritura, no escribe (3)', async () => {
    const n = nuevoNumero();
    await ruta(n);
    const real = db.doc(`rutasWhatsApp/${n}`);
    const refCarrera = new Proxy(real, {
      get: (t, k) => {
        if (k === 'get') return async () => { const sn = await t.get(); await t.update({ otro: 1 }); return sn; };
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    });
    const carrera = { doc: (p: string) => (p === `rutasWhatsApp/${n}` ? refCarrera : db.doc(p)), collection: (p: string) => db.collection(p), batch: () => db.batch() };
    const r = await corre(aplicar(n), { db: carrera });
    expect(r.codigo).toBe(3);
    expect((await leer(n)).data()).not.toHaveProperty('plantillas');
  });

  const auditorias = async (t: string) => (await db.collection(`tenants/${t}/auditoria`).get()).docs.map((d) => d.data());

  it('AUDITORÍA: un documento en tenants/{tenantId de la ruta}/auditoria, con anterior y nuevo, sin teléfono completo ni proyecto; el seco y lo idempotente no auditan', async () => {
    const n = nuevoNumero();
    const t = `aud-${n}`;
    await ruta(n, { tenantId: t });
    expect((await corre(argv(n))).codigo).toBe(1);
    expect(await auditorias(t)).toHaveLength(0);
    expect((await corre(aplicar(n))).codigo).toBe(0);
    expect((await corre(aplicar(n, { estado: 'PAUSED' }))).codigo).toBe(0);
    expect((await corre(aplicar(n, { estado: 'PAUSED' }))).codigo).toBe(0);   // idempotente: no audita
    const a = (await auditorias(t)).sort((x, y) => (x['nuevo'].estado < y['nuevo'].estado ? -1 : 1));
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ accion: 'plantilla_registrada', uso: 'retomar', script: 'registrar-plantilla', origen: 'script', entorno: 'emulador', anterior: null, nuevo: BUENA });
    expect(a[1]).toMatchObject({ anterior: BUENA, nuevo: { ...BUENA, estado: 'PAUSED' } });
    expect(JSON.stringify(a)).not.toContain(n);
    expect(JSON.stringify(a)).not.toContain(PROYECTO);
  });

  it('el seco muestra el comercio de la ruta', async () => {
    const n = nuevoNumero();
    await ruta(n, { tenantId: 'comercio-visible' });
    expect((await corre(argv(n))).texto).toContain('comercio : comercio-visible');
  });

  it('NEGATIVA: un comercio excluido (por id o por el nombre de su ficha) sale 2 y no escribe ni audita', async () => {
    const n = nuevoNumero();
    await ruta(n, { tenantId: 'comercio-vetado' });
    const r1 = await corre(aplicar(n), { env: { ...ENV_EMU, NOVUCHAT_TENANTS_EXCLUIDOS: 'vetado' } });
    expect(r1.codigo).toBe(2);
    expect(r1.texto).toContain('EXCLUIDO');
    const n2 = nuevoNumero();
    await ruta(n2, { tenantId: 'comercio-normal-1' });
    await db.doc('tenants/comercio-normal-1').set({ nombre: 'Tienda Vetada', estado: 'activo' });
    expect((await corre(aplicar(n2), { env: { ...ENV_EMU, NOVUCHAT_TENANTS_EXCLUIDOS: 'vetada' } })).codigo).toBe(2);
    for (const [num, t] of [[n, 'comercio-vetado'], [n2, 'comercio-normal-1']] as const) {
      expect((await leer(num)).data()).not.toHaveProperty('plantillas');
      expect(await auditorias(t)).toHaveLength(0);
    }
  });

  it('NEGATIVA: una ruta sin tenantId válido sale 2', async () => {
    const n = nuevoNumero();
    await ruta(n, { tenantId: 'X' });
    expect((await corre(aplicar(n))).codigo).toBe(2);
    expect((await leer(n)).data()).not.toHaveProperty('plantillas');
  });

  it('un estado distinto de APPROVED avisa que apagar la bandera es un paso aparte y NO toca la ficha del comercio', async () => {
    const n = nuevoNumero();
    const t = `ficha-${n}`;
    await ruta(n, { tenantId: t });
    await db.doc(`tenants/${t}`).set({ nombre: 'Sintetica', estado: 'activo', personaPuedeRetomar: true });
    const antes = (await db.doc(`tenants/${t}`).get()).updateTime?.toMillis();
    const r = await corre(aplicar(n, { estado: 'PAUSED' }));
    expect(r.codigo, r.texto).toBe(0);
    expect(r.texto).toContain('paso aparte');
    expect(r.texto).toContain('aplicar-persona-puede-retomar.mjs --valor false');
    const d = await db.doc(`tenants/${t}`).get();
    expect(d.updateTime?.toMillis()).toBe(antes);
    expect(d.get('personaPuedeRetomar')).toBe(true);
  });

  it('el respaldo guarda el valor previo y nunca se pisa (un segundo intento con la misma ruta sale 2)', async () => {
    const n = nuevoNumero();
    await ruta(n);
    const resp = rutaRespaldo();
    expect((await corre(argv(n, {}, ['--aplicar', '--respaldo', resp]))).codigo).toBe(0);
    const n2 = nuevoNumero();
    await ruta(n2);
    const r = await corre(argv(n2, {}, ['--aplicar', '--respaldo', resp]));
    expect(r.codigo).toBe(2);
    expect((await leer(n2)).data()).not.toHaveProperty('plantillas');
  });
});
