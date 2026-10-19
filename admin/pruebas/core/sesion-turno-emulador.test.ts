/**
 * =============================================================================
 * F3b PR-2a: LAS TRANSACCIONES DEL ESTADO DE CONVERSACIÓN, CONTRA EL EMULADOR
 * =============================================================================
 *
 * `sesion.ts` decide (y se prueba sin emulador en `sesion-turno.test.ts`);
 * `sesionFirestore.ts` lee y escribe. Lo que se defiende acá, NEGANDO:
 *
 *  1. Carreras: dos `comprometer` con la misma versión -> gana exactamente uno;
 *     20 `leer` del mismo idMensaje -> un solo `nuevo`; un cupo en tope-1
 *     pedido por dos contactos a la vez -> se concede uno.
 *  2. Cupos: sin tope -> `sin_tope` sin mover la versión; datos corruptos
 *     (`usados`, `vence`) se niegan; todo o nada entre sesión y cupos.
 *  3. Aislamiento: otro número, otro contacto, otro espacio y otro comercio ven
 *     vacío; `asentar` solo toca cupos del mismo número y contacto.
 *  4. Idempotencia: `idCompromiso` repetido; `asentar` repetido.
 *  5. Vencimiento: `estado` null con la versión real.
 *  6. Ids con nombres de Object.prototype se rechazan.
 *  7. Ningún rol de la consola lee ni escribe las 3 colecciones (reglas reales,
 *     sin cambiarlas).
 *  8. El camino `sesion` NO escribe en `conversaciones/*` ni `metricas/*`
 *     (protege el conteo facturado).
 *
 * Puertos del emulador propios: 8331 / 9251.
 *   FIRESTORE_EMULATOR_PORT=8331 FIRESTORE_EMULATOR_WS_PORT=9251 bash pruebas/correr.sh pruebas/core/sesion-turno-emulador.test.ts
 * Teléfonos ficticios (seis ceros seguidos).
 */
import {
  assertFails, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc as docWeb, getDoc, getDocs, setDoc as setDocWeb, updateDoc } from 'firebase/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
const PUERTO = Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8331);
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${PUERTO}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const { atenderSesion, idCupo, idSesion, idVisto, PRESUPUESTO_MS } = await import('../../functions/src/core/turno/sesionFirestore.ts');
const { periodoDe } = await import('../../functions/src/core/turno/sesion.ts');

const aqui = dirname(fileURLToPath(import.meta.url));
const T = 'sesion-emu-a';
const OTRO = 'sesion-emu-b';
const PN = '1000000701';
const PN2 = '1000000702';
const TEL = '59100000001';
const TEL2 = '59100000002';
const AHORA = Date.UTC(2026, 9, 18, 15, 0, 0);
const MIN = 60_000;
/** Las pruebas de LÓGICA no deben depender de qué tan lento resuelve el emulador una colisión; el presupuesto real se prueba aparte. */
const PRESUPUESTO_LOGICA = 120_000;

let db: Firestore;
let entorno: RulesTestEnvironment;

beforeAll(async () => {
  if (getApps().length === 0) initializeApp({ projectId: PROYECTO });
  db = getFirestore();
  entorno = await initializeTestEnvironment({
    projectId: PROYECTO,
    firestore: { rules: readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: PUERTO },
  });
});
afterAll(async () => { await entorno.cleanup(); });
beforeEach(async () => { await entorno.clearFirestore(); });

// ------------------------------------------------------------------ ayudas

interface Ruta { tenantId: string; phoneNumberId: string }
const ruta = (tenantId = T, phoneNumberId = PN): Ruta => ({ tenantId, phoneNumberId });
let n = 0;
const ejec = (): string => `ej-${++n}`;
const comp = (): string => `compromiso-${String(++n).padStart(6, '0')}`;

type Sesion = Record<string, unknown>;
const pedir = (r: Ruta, sesion: Sesion, tel: string | null = TEL, ahora = AHORA) =>
  atenderSesion(db, r, { telefono: tel, sesion: { v: 1, espacio: 'venta', ejecucion: ejec(), ...sesion } }, ahora, { presupuestoMs: PRESUPUESTO_LOGICA });
const leer = (r: Ruta, extra: Sesion = {}, tel: string | null = TEL, ahora = AHORA) => pedir(r, { accion: 'leer', ...extra }, tel, ahora);
const comprometer = (r: Ruta, extra: Sesion, tel: string | null = TEL, ahora = AHORA) =>
  pedir(r, { accion: 'comprometer', idCompromiso: comp(), estado: { paso: 1 }, venceEnMin: 60, versionLeida: 0, ...extra }, tel, ahora);
const asentar = (r: Ruta, idCompromiso: string, extra: Sesion = {}, tel: string | null = TEL, ahora = AHORA) =>
  pedir(r, { accion: 'asentar', idCompromiso, ...extra }, tel, ahora);

const conv = (r: { json: Record<string, unknown> }) => r.json['conversacion'] as Record<string, unknown>;
const cupoDia = (extra: Record<string, unknown> = {}) =>
  ({ clave: 'avisos', alcance: 'contacto', periodo: 'dia', cantidad: 1, tope: 3, ...extra });
const refSesion = (t = T, pn = PN, esp = 'venta', tel = TEL) =>
  db.collection('tenants').doc(t).collection('sesionesDeTurno').doc(idSesion(pn, esp, tel));
const refCupo = (alcance: 'contacto' | 'comercio', clave = 'avisos', pn = PN, tel = TEL, t = T) =>
  db.collection('tenants').doc(t).collection('cuposDeTurno')
    .doc(idCupo(pn, clave, alcance, alcance === 'contacto' ? tel : null, periodoDe(AHORA, 'dia')));

// --------------------------------------------------------------- flujo base

describe('leer / comprometer: el camino feliz', () => {
  it('sin documento: versión 0; comprometer sube a 1 y leer devuelve el estado', async () => {
    const l0 = await leer(ruta());
    expect(l0.status).toBe(200);
    expect(conv(l0)).toEqual({ version: 0, estado: null, desde: null, vence: null, vencido: false });
    expect(l0.json['visto']).toBeNull();

    const c = await comprometer(ruta(), { estado: { paso: 'oferta', n: 2 } });
    expect(c.status).toBe(200);
    expect(c.json['resultado']).toBe('comprometido');
    expect(conv(c)['version']).toBe(1);

    const l1 = await leer(ruta());
    expect(conv(l1)).toMatchObject({ version: 1, estado: { paso: 'oferta', n: 2 }, vencido: false, desde: AHORA, vence: AHORA + 60 * MIN });
  });

  it('el documento queda con los campos del contrato y el estado como cadena opaca', async () => {
    await comprometer(ruta(), { estado: { a: 1 } });
    const d = (await refSesion().get()).data() as Record<string, unknown>;
    expect(Object.keys(d).sort()).toEqual(
      ['actualizadoEn', 'compromisos', 'espacio', 'estadoJson', 'flujo', 'phoneNumberId', 'vence', 'version']);
    expect(d['estadoJson']).toBe('{"a":1}');
    expect(d['vence']).toBeInstanceOf(Timestamp);
    expect(d['compromisos']).toHaveLength(1);
  });

  it('validación: 400 para forma mala, 413 para estado grande; el cuerpo no repite lo mandado', async () => {
    const mala = await pedir(ruta(), { accion: 'borrar' });
    expect(mala.status).toBe(400);
    expect(JSON.stringify(mala.json)).not.toContain('borrar');
    expect((await leer(ruta(), {}, null)).status).toBe(400);
    expect((await pedir(ruta(), { v: 2, accion: 'leer' })).status).toBe(400);
    expect((await leer(ruta(), { tenantId: 'x' })).status).toBe(400);
    const grande = await comprometer(ruta(), { estado: { x: 'a'.repeat(17 * 1024) } });
    expect(grande.status).toBe(413);
    expect((await refSesion().get()).exists).toBe(false);
  });

  it('un tenantId fuera de `sesion` se ignora: nada se crea en otro comercio', async () => {
    const r = await atenderSesion(db, ruta(), {
      telefono: TEL, tenantId: OTRO,
      sesion: { v: 1, accion: 'comprometer', espacio: 'venta', ejecucion: 'e1', idCompromiso: 'compromiso-xyz1', versionLeida: 0, estado: { a: 1 }, venceEnMin: 5 },
    }, AHORA);
    expect(r.json['resultado']).toBe('comprometido');
    expect((await db.collection('tenants').doc(OTRO).collection('sesionesDeTurno').get()).size).toBe(0);
    expect((await db.collection('tenants').doc(T).collection('sesionesDeTurno').get()).size).toBe(1);
  });
});

// ------------------------------------------------------------------- carreras

describe('carreras: gana exactamente uno', () => {
  it('dos comprometer paralelos con la misma versión: uno comprometido, otro conflicto_version', async () => {
    const [a, b] = await Promise.all([
      comprometer(ruta(), { estado: { gana: 'a' } }),
      comprometer(ruta(), { estado: { gana: 'b' } }),
    ]);
    const res = [a.json['resultado'], b.json['resultado']].sort();
    expect(res).toEqual(['comprometido', 'conflicto_version']);
    const ganador = a.json['resultado'] === 'comprometido' ? 'a' : 'b';
    const perdedor = ganador === 'a' ? b : a;
    // El perdedor recibe el estado ganador, para replanificar.
    expect(conv(perdedor)).toMatchObject({ version: 1, estado: { gana: ganador } });
    expect((await refSesion().get()).data()?.['version']).toBe(1);
  });

  it('seis comprometer paralelos con la misma versión: exactamente uno', async () => {
    const rs = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => comprometer(ruta(), { estado: { i } })));
    expect(rs.filter((r) => r.json['resultado'] === 'comprometido')).toHaveLength(1);
    expect(rs.filter((r) => r.json['resultado'] === 'conflicto_version')).toHaveLength(5);
    expect((await refSesion().get()).data()?.['version']).toBe(1);
  });

  it('20 leer paralelos del mismo idMensaje: un solo nuevo', async () => {
    const rs = await Promise.all(Array.from({ length: 20 }, () => leer(ruta(), { idMensaje: 'wamid.HBgLAAAA1234' })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const vistos = rs.map((r) => r.json['visto']);
    expect(vistos.filter((v) => v === 'nuevo')).toHaveLength(1);
    expect(vistos.filter((v) => v === 'repetido')).toHaveLength(19);
    const doc = await db.collection('tenants').doc(T).collection('vistosDeTurno').doc(idVisto(PN, 'wamid.HBgLAAAA1234')).get();
    expect(doc.exists).toBe(true);
    expect(Object.keys(doc.data() as object).sort()).toEqual(['ejecucion', 'phoneNumberId', 'vence']);
  });

  it('el visto vale por número y es independiente por mensaje, número y comercio', async () => {
    expect((await leer(ruta(), { idMensaje: 'wamid.UNO' })).json['visto']).toBe('nuevo');
    expect((await leer(ruta(), { idMensaje: 'wamid.UNO' }, TEL2)).json['visto']).toBe('repetido'); // por número, no por contacto
    expect((await leer(ruta(), { idMensaje: 'wamid.DOS' })).json['visto']).toBe('nuevo');
    expect((await leer(ruta(T, PN2), { idMensaje: 'wamid.UNO' })).json['visto']).toBe('nuevo');
    expect((await leer(ruta(OTRO, PN), { idMensaje: 'wamid.UNO' })).json['visto']).toBe('nuevo');
  });

  it('un visto pasado de 24 h (el TTL aún no lo borró) vuelve a ser nuevo', async () => {
    await leer(ruta(), { idMensaje: 'wamid.VIEJO' });
    expect((await leer(ruta(), { idMensaje: 'wamid.VIEJO' }, TEL, AHORA + 25 * 3_600_000)).json['visto']).toBe('nuevo');
  });

  it('cupo en tope-1 pedido por dos contactos a la vez (cupo del comercio): se concede uno', async () => {
    const cupos = [cupoDia({ alcance: 'comercio', tope: 2 })];
    expect((await comprometer(ruta(), { cupos })).json['resultado']).toBe('comprometido'); // usados 1 de 2
    const [a, b] = await Promise.all([
      comprometer(ruta(), { cupos, versionLeida: 1 }, TEL), comprometer(ruta(), { cupos }, TEL2),
    ]);
    const res = [a.json, b.json];
    expect(res.filter((j) => j['resultado'] === 'comprometido')).toHaveLength(1);
    const negado = res.find((j) => j['resultado'] === 'cupo_negado');
    expect(negado).toMatchObject({ motivo: 'agotado', clave: 'avisos' });
    expect((await refCupo('comercio').get()).data()?.['usados']).toBe(2);
  });
});

// ----------------------------------------------------------------- los cupos

describe('cupos', () => {
  it('sin tope: cupo_negado/sin_tope, la versión no se mueve y nada se escribe', async () => {
    const r = await comprometer(ruta(), { cupos: [{ clave: 'avisos', alcance: 'contacto', periodo: 'dia', cantidad: 1 }] });
    expect(r.json).toMatchObject({ resultado: 'cupo_negado', motivo: 'sin_tope', clave: 'avisos' });
    expect(conv(r)['version']).toBe(0);
    expect((await refSesion().get()).exists).toBe(false);
    expect((await refCupo('contacto').get()).exists).toBe(false);
  });

  it('tope 0 equivale a sin tope', async () => {
    const r = await comprometer(ruta(), { cupos: [cupoDia({ tope: 0 })] });
    expect(r.json).toMatchObject({ resultado: 'cupo_negado', motivo: 'sin_tope' });
  });

  it('agotado: se concede hasta el tope y el siguiente se niega sin mover la versión', async () => {
    for (let v = 0; v < 3; v++) {
      const ok = await comprometer(ruta(), { versionLeida: v, cupos: [cupoDia()] });
      expect(ok.json['resultado']).toBe('comprometido');
    }
    const no = await comprometer(ruta(), { versionLeida: 3, cupos: [cupoDia()] });
    expect(no.json).toMatchObject({ resultado: 'cupo_negado', motivo: 'agotado' });
    expect(conv(no)['version']).toBe(3);
    expect((await refSesion().get()).data()?.['version']).toBe(3);
    expect((await refCupo('contacto').get()).data()?.['usados']).toBe(3);
  });

  it('todo o nada: si el segundo cupo se niega, el primero no se consume ni la sesión avanza', async () => {
    const r = await comprometer(ruta(), { cupos: [cupoDia(), cupoDia({ clave: 'otro', tope: 0 })] });
    expect(r.json['resultado']).toBe('cupo_negado');
    expect((await refCupo('contacto').get()).exists).toBe(false);
    expect((await refSesion().get()).exists).toBe(false);
  });

  it('el cupo es por número y contacto; el del comercio lo comparten todos los contactos', async () => {
    await comprometer(ruta(), { cupos: [cupoDia({ tope: 1 })] }, TEL);
    // otro contacto: su propio cupo
    expect((await comprometer(ruta(), { cupos: [cupoDia({ tope: 1 })] }, TEL2)).json['resultado']).toBe('comprometido');
    // otro número: su propio cupo
    expect((await comprometer(ruta(T, PN2), { cupos: [cupoDia({ tope: 1 })] }, TEL)).json['resultado']).toBe('comprometido');
    // el mismo contacto, otro espacio: el MISMO cupo (no se esquiva cambiando de espacio)
    const otroEsp = await comprometer(ruta(), { espacio: 'cobros', cupos: [cupoDia({ tope: 1 })] }, TEL);
    expect(otroEsp.json).toMatchObject({ resultado: 'cupo_negado', motivo: 'agotado' });
  });

  it('un cupo con `usados` corrupto se niega como datos_invalidos y no se mueve', async () => {
    await refCupo('contacto').set({ usados: 'tres', tope: 3, por: {}, vence: Timestamp.fromMillis(AHORA + 9 * 3_600_000) });
    const r = await comprometer(ruta(), { cupos: [cupoDia()] });
    expect(r.json).toMatchObject({ resultado: 'cupo_negado', motivo: 'datos_invalidos' });
    expect((await refCupo('contacto').get()).data()?.['usados']).toBe('tres');
    expect((await refSesion().get()).exists).toBe(false);
  });

  it('un cupo con `vence` corrupto se niega como datos_invalidos (no se lee como vencido ni se concede)', async () => {
    await refCupo('contacto').set({ usados: 3, tope: 3, por: {}, vence: 'mañana' });
    const r = await comprometer(ruta(), { cupos: [cupoDia()] });
    expect(r.json).toMatchObject({ resultado: 'cupo_negado', motivo: 'datos_invalidos' });
    expect((await refCupo('contacto').get()).data()?.['usados']).toBe(3);
  });

  it('un cupo vencido que el TTL no borró cuenta como vacío', async () => {
    await refCupo('contacto').set({ usados: 3, tope: 3, por: {}, vence: Timestamp.fromMillis(AHORA - 1) });
    const r = await comprometer(ruta(), { cupos: [cupoDia()] });
    expect(r.json['resultado']).toBe('comprometido');
    expect((await refCupo('contacto').get()).data()?.['usados']).toBe(1);
  });

  it('si la poda de `por` se llevara la entrada del propio compromiso: datos_invalidos y nada se escribe', async () => {
    // 50 entradas más nuevas que el ahora del pedido: la del compromiso nuevo es la más vieja y la poda la descarta.
    const por: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) por[`previo-${String(i).padStart(4, '0')}`] = { cantidad: 1, en: AHORA + 1_000_000 + i, tel: TEL };
    await refCupo('contacto').set({ usados: 1, tope: 3, por, vence: Timestamp.fromMillis(AHORA + 9 * 3_600_000) });
    const r = await comprometer(ruta(), { cupos: [cupoDia()] });
    expect(r.json).toMatchObject({ resultado: 'datos_invalidos' });
    expect((await refCupo('contacto').get()).data()?.['usados']).toBe(1);
    expect(Object.keys((await refCupo('contacto').get()).data()?.['por'] as object)).toHaveLength(50);
    expect((await refSesion().get()).exists).toBe(false);
  });

  it('una clave de cupo con nombre heredado (`constructor`) funciona como cualquier otra, sin leer del prototipo', async () => {
    const cupos = [cupoDia({ clave: 'constructor', tope: 1 })];
    expect((await comprometer(ruta(), { cupos })).json['resultado']).toBe('comprometido');
    expect((await comprometer(ruta(), { versionLeida: 1, cupos })).json).toMatchObject({ resultado: 'cupo_negado', motivo: 'agotado' });
  });
});

// -------------------------------------------------------------- idempotencia

describe('idempotencia', () => {
  it('el mismo idCompromiso repetido responde `repetido` aunque la versión sea vieja, y no cobra otra vez', async () => {
    const id = 'compromiso-fijo-0001';
    const a = await comprometer(ruta(), { idCompromiso: id, cupos: [cupoDia()] });
    expect(a.json['resultado']).toBe('comprometido');
    const b = await comprometer(ruta(), { idCompromiso: id, cupos: [cupoDia()], versionLeida: 0 });
    expect(b.json['resultado']).toBe('repetido');
    expect(conv(b)['version']).toBe(1);
    expect((await refCupo('contacto').get()).data()?.['usados']).toBe(1);
  });

  it('se recuerdan los últimos 5 compromisos', async () => {
    for (let v = 0; v < 7; v++) await comprometer(ruta(), { versionLeida: v, idCompromiso: `compromiso-orden-${v}` });
    const d = (await refSesion().get()).data() as { compromisos: string[] };
    expect(d.compromisos).toEqual([2, 3, 4, 5, 6].map((v) => `compromiso-orden-${v}`));
  });

  it('asentar devuelve el cupo; repetirlo no hace nada', async () => {
    const id = 'compromiso-asentar-01';
    await comprometer(ruta(), { idCompromiso: id, cupos: [cupoDia({ cantidad: 2 }), cupoDia({ clave: 'dia-comercio', alcance: 'comercio', tope: 9 })] });
    expect((await refCupo('contacto').get()).data()?.['usados']).toBe(2);
    const a = await asentar(ruta(), id);
    expect(a.json['resultado']).toBe('asentado');
    expect((await refCupo('contacto').get()).data()).toMatchObject({ usados: 0, por: {} });
    expect((await refCupo('comercio', 'dia-comercio').get()).data()?.['usados']).toBe(0);
    const b = await asentar(ruta(), id);
    expect(b.json['resultado']).toBe('nada_que_asentar');
    expect((await refCupo('contacto').get()).data()?.['usados']).toBe(0);
    // tras devolver, el cupo vuelve a estar disponible
    expect((await comprometer(ruta(), { versionLeida: 1, cupos: [cupoDia({ cantidad: 3 })] })).json['resultado']).toBe('comprometido');
  });

  it('asentar de un compromiso desconocido, o sin cupos, es nada_que_asentar', async () => {
    expect((await asentar(ruta(), 'compromiso-nunca-existio')).json['resultado']).toBe('nada_que_asentar');
    const id = 'compromiso-sin-cupos1';
    await comprometer(ruta(), { idCompromiso: id });
    expect((await asentar(ruta(), id)).json['resultado']).toBe('nada_que_asentar');
  });

  it('asentar en paralelo: se devuelve una sola vez', async () => {
    const id = 'compromiso-paralelo-1';
    await comprometer(ruta(), { idCompromiso: id, cupos: [cupoDia({ cantidad: 2 })] });
    await comprometer(ruta(), { versionLeida: 1, cupos: [cupoDia({ cantidad: 1 })] }); // otro consumo del mismo cupo
    const rs = await Promise.all([asentar(ruta(), id), asentar(ruta(), id), asentar(ruta(), id)]);
    expect(rs.filter((r) => r.json['resultado'] === 'asentado')).toHaveLength(1);
    expect((await refCupo('contacto').get()).data()?.['usados']).toBe(1);
  });

  it('asentar solo toca cupos del mismo número y del mismo contacto, aunque otro lleve el mismo idCompromiso', async () => {
    const id = 'compromiso-compartido1';
    await comprometer(ruta(), { idCompromiso: id, cupos: [cupoDia()] }, TEL);
    await comprometer(ruta(), { idCompromiso: id, cupos: [cupoDia()] }, TEL2);
    await comprometer(ruta(T, PN2), { idCompromiso: id, cupos: [cupoDia()] }, TEL);
    await asentar(ruta(), id, {}, TEL);
    expect((await refCupo('contacto', 'avisos', PN, TEL).get()).data()?.['usados']).toBe(0);
    expect((await refCupo('contacto', 'avisos', PN, TEL2).get()).data()?.['usados']).toBe(1);
    expect((await refCupo('contacto', 'avisos', PN2, TEL).get()).data()?.['usados']).toBe(1);
  });

  it('cupo del comercio: asentar desde OTRO contacto con el mismo idCompromiso no devuelve nada', async () => {
    const id = 'compromiso-comercio-01';
    await comprometer(ruta(), { idCompromiso: id, cupos: [cupoDia({ alcance: 'comercio', tope: 5 })] }, TEL);
    const entrada = ((await refCupo('comercio').get()).data()?.['por'] as Record<string, { tel?: string }>)[id];
    expect(entrada?.tel).toBe(TEL);
    const ajeno = await asentar(ruta(), id, {}, TEL2);
    expect(ajeno.json['resultado']).toBe('nada_que_asentar');
    expect((await refCupo('comercio').get()).data()?.['usados']).toBe(1);
    // el dueño sí lo devuelve
    expect((await asentar(ruta(), id, {}, TEL)).json['resultado']).toBe('asentado');
    expect((await refCupo('comercio').get()).data()?.['usados']).toBe(0);
  });

  it('cupo del comercio con entrada vieja sin `tel`: nadie la devuelve (queda consumida)', async () => {
    const id = 'compromiso-viejo-0001';
    await refCupo('comercio').set({ usados: 1, tope: 5, por: { [id]: { cantidad: 1, en: AHORA } }, vence: Timestamp.fromMillis(AHORA + 9 * 3_600_000) });
    for (const tel of [TEL, TEL2]) expect((await asentar(ruta(), id, {}, tel)).json['resultado']).toBe('nada_que_asentar');
    expect((await refCupo('comercio').get()).data()?.['usados']).toBe(1);
  });

  it('asentar nunca toca otro comercio', async () => {
    const id = 'compromiso-ajeno-0001';
    await comprometer(ruta(OTRO), { idCompromiso: id, cupos: [cupoDia()] });
    const r = await asentar(ruta(T), id);
    expect(r.json['resultado']).toBe('nada_que_asentar');
    expect((await refCupo('contacto', 'avisos', PN, TEL, OTRO).get()).data()?.['usados']).toBe(1);
  });

  it('asentar revalida `por`: una entrada corrupta ajena no entra al documento ni rompe la devolución', async () => {
    const id = 'compromiso-revalida-01';
    await comprometer(ruta(), { idCompromiso: id, cupos: [cupoDia({ cantidad: 2 })] });
    const ref = refCupo('contacto');
    const por = (await ref.get()).data()?.['por'] as Record<string, unknown>;
    await ref.update({ por: { ...por, 'basura-1234': { cantidad: 'x', en: 'y' }, 'ok-aaaa-0001': { cantidad: 1, en: 5 } }, usados: 3 });
    const r = await asentar(ruta(), id);
    expect(r.json['resultado']).toBe('asentado');
    const d = (await ref.get()).data() as { usados: number; por: Record<string, unknown> };
    expect(d.usados).toBe(1);
    expect(Object.keys(d.por)).toEqual(['ok-aaaa-0001']);
  });

  it('asentar con `usados` corrupto no escribe nada (queda consumido)', async () => {
    const id = 'compromiso-corrupto-01';
    await comprometer(ruta(), { idCompromiso: id, cupos: [cupoDia()] });
    await refCupo('contacto').update({ usados: -4 });
    expect((await asentar(ruta(), id)).json['resultado']).toBe('nada_que_asentar');
    expect((await refCupo('contacto').get()).data()?.['usados']).toBe(-4);
  });
});

// ---------------------------------------------------------------- aislamiento

describe('aislamiento: otro número, contacto, espacio o comercio ven vacío', () => {
  it('lo comprometido en un lugar no se ve en los demás', async () => {
    await comprometer(ruta(), { estado: { secreto: 1 } });
    expect(conv(await leer(ruta()))['version']).toBe(1);
    for (const otra of [
      await leer(ruta(T, PN2)), await leer(ruta(), {}, TEL2), await leer(ruta(), { espacio: 'cobros' }), await leer(ruta(OTRO, PN)),
    ]) {
      expect(conv(otra)).toEqual({ version: 0, estado: null, desde: null, vence: null, vencido: false });
    }
  });

  it('los espacios son particiones del mismo número: cada uno lleva su versión', async () => {
    await comprometer(ruta(), { estado: { e: 'venta' } });
    expect((await comprometer(ruta(), { espacio: 'cobros', estado: { e: 'cobros' } })).json['resultado']).toBe('comprometido');
    expect(conv(await leer(ruta(), { espacio: 'cobros' }))['estado']).toEqual({ e: 'cobros' });
    expect(conv(await leer(ruta()))['estado']).toEqual({ e: 'venta' });
  });
});

// ---------------------------------------------------------------- vencimiento

describe('vencimiento y datos corruptos', () => {
  it('vencido: estado null, vencido true y la versión real; comprometer sigue desde esa versión', async () => {
    await comprometer(ruta(), { estado: { a: 1 }, venceEnMin: 1 });
    const l = await leer(ruta(), {}, TEL, AHORA + 2 * MIN);
    expect(conv(l)).toMatchObject({ version: 1, estado: null, vencido: true });
    const c = await comprometer(ruta(), { versionLeida: 1, estado: { b: 2 } }, TEL, AHORA + 2 * MIN);
    expect(c.json['resultado']).toBe('comprometido');
    expect(conv(c)['version']).toBe(2);
  });

  it('igual al instante de vencer cuenta como vencido', async () => {
    await comprometer(ruta(), { venceEnMin: 1 });
    expect(conv(await leer(ruta(), {}, TEL, AHORA + MIN))['vencido']).toBe(true);
    expect(conv(await leer(ruta(), {}, TEL, AHORA + MIN - 1))['vencido']).toBe(false);
  });

  it('`vence` corrupto en la sesión: comprometer responde datos_invalidos y no escribe', async () => {
    await refSesion().set({ version: 4, estadoJson: '{"a":1}', vence: 'nunca', actualizadoEn: Timestamp.fromMillis(AHORA), compromisos: [] });
    const r = await comprometer(ruta(), { versionLeida: 4 });
    expect(r.json['resultado']).toBe('datos_invalidos');
    expect((await refSesion().get()).data()?.['version']).toBe(4);
    // leer no lanza ni inventa un estado
    const l = await leer(ruta());
    expect(l.status).toBe(200);
    expect(conv(l)['estado']).toBeNull();
  });

  it('sesión corrupta + versionLeida 0: se AUTORREPARA (versión 1, reparadoEn, compromisos viejos fuera)', async () => {
    await refSesion().set({ version: -1, estadoJson: null, vence: Timestamp.fromMillis(AHORA + MIN), compromisos: ['viejo-0000001'] });
    const l = await leer(ruta());
    expect(conv(l)).toMatchObject({ version: 0, estado: null, corrupta: true });
    const r = await comprometer(ruta(), { versionLeida: 0, estado: { ok: 1 } });
    expect(r.json['resultado']).toBe('comprometido');
    expect(conv(r)['version']).toBe(1);
    const d = (await refSesion().get()).data() as Record<string, unknown>;
    expect(d['version']).toBe(1);
    expect(d['reparadoEn']).toBeInstanceOf(Timestamp);
    expect(d['compromisos']).not.toContain('viejo-0000001');
    // ya sana: leer no marca `corrupta`
    const sana = conv(await leer(ruta()));
    expect(sana['version']).toBe(1);
    expect(sana['corrupta']).toBeUndefined();
  });

  it('sesión corrupta + versionLeida distinta de 0: datos_invalidos SIN escribir', async () => {
    const datos = { version: -1, estadoJson: null, vence: Timestamp.fromMillis(AHORA + MIN), compromisos: [] };
    await refSesion().set(datos);
    for (const v of [1, 5]) {
      const r = await comprometer(ruta(), { versionLeida: v });
      expect(r.json['resultado']).toBe('datos_invalidos');
      expect(conv(r)).toMatchObject({ corrupta: true });
    }
    expect((await refSesion().get()).data()).toMatchObject({ version: -1 });
    expect((await refSesion().get()).data()?.['reparadoEn']).toBeUndefined();
  });

  it('autorreparación con un cupo agotado: no concede de más ni escribe la sesión', async () => {
    await refCupo('contacto').set({ usados: 3, tope: 3, por: {}, vence: Timestamp.fromMillis(AHORA + 9 * 3_600_000) });
    await refSesion().set({ version: 'x', vence: Timestamp.fromMillis(AHORA + MIN) });
    const r = await comprometer(ruta(), { versionLeida: 0, cupos: [cupoDia()] });
    expect(r.json).toMatchObject({ resultado: 'cupo_negado', motivo: 'agotado' });
    expect((await refSesion().get()).data()?.['version']).toBe('x');
  });

  it('`compromisos` con elementos que no son cadenas: sesión corrupta', async () => {
    await refSesion().set({ version: 3, estadoJson: null, vence: Timestamp.fromMillis(AHORA + MIN), compromisos: ['ok-00000001', 7, null] });
    expect(conv(await leer(ruta()))).toMatchObject({ corrupta: true });
    expect((await comprometer(ruta(), { versionLeida: 3 })).json['resultado']).toBe('datos_invalidos');
  });

  it('`estadoJson` que no es cadena: sesión corrupta', async () => {
    await refSesion().set({ version: 3, estadoJson: { a: 1 }, vence: Timestamp.fromMillis(AHORA + MIN), compromisos: [] });
    expect(conv(await leer(ruta()))).toMatchObject({ corrupta: true });
    expect((await comprometer(ruta(), { versionLeida: 3 })).json['resultado']).toBe('datos_invalidos');
  });

  it('un visto con `vence` corrupto cuenta como repetido y no se reescribe', async () => {
    const ref = db.collection('tenants').doc(T).collection('vistosDeTurno').doc(idVisto(PN, 'wamid.ROTO'));
    await ref.set({ ejecucion: 'x', vence: 'siempre', phoneNumberId: PN });
    expect((await leer(ruta(), { idMensaje: 'wamid.ROTO' })).json['visto']).toBe('repetido');
    expect((await ref.get()).data()?.['vence']).toBe('siempre');
  });

  it('un estadoJson corrupto se lee como null sin marcar vencido', async () => {
    await refSesion().set({ version: 2, estadoJson: '{no es json', vence: Timestamp.fromMillis(AHORA + MIN), actualizadoEn: Timestamp.fromMillis(AHORA), compromisos: [] });
    expect(conv(await leer(ruta()))).toMatchObject({ version: 2, estado: null, vencido: false });
  });
});

// ------------------------------------------------------ nombres heredados

describe('ids con nombres de Object.prototype', () => {
  const heredados = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__', '__defineGetter__'];
  it.each(heredados)('idCompromiso «%s» se rechaza (400) en comprometer y asentar, sin escribir', async (nombre) => {
    expect((await comprometer(ruta(), { idCompromiso: nombre })).status).toBe(400);
    expect((await asentar(ruta(), nombre)).status).toBe(400);
    expect((await db.collection('tenants').doc(T).collection('sesionesDeTurno').get()).size).toBe(0);
  });

  it('una clave de cupo con forma de nombre heredado en minúsculas no se concede por herencia', async () => {
    const r = await comprometer(ruta(), { cupos: [cupoDia({ clave: 'tostring', tope: 1 })] });
    expect(r.json['resultado']).toBe('comprometido');
  });
});

// ------------------------------------------------------------ presupuesto

describe('presupuesto de tiempo', () => {
  it('con el presupuesto agotado responde 503 con mensaje fijo y NO escribe', async () => {
    const cuerpo = (sesion: Sesion) => ({ telefono: TEL, sesion: { v: 1, espacio: 'venta', ejecucion: ejec(), ...sesion } });
    const cero = { presupuestoMs: 0 };
    const c = await atenderSesion(db, ruta(), cuerpo({ accion: 'comprometer', idCompromiso: comp(), estado: { a: 1 }, venceEnMin: 5, versionLeida: 0, cupos: [cupoDia()] }), AHORA, cero);
    expect(c.status).toBe(503);
    expect(c.json).toEqual({ error: 'sesion: ocupada, reintente' });
    const l = await atenderSesion(db, ruta(), cuerpo({ accion: 'leer', idMensaje: 'wamid.TIEMPO' }), AHORA, cero);
    expect(l.status).toBe(503);
    const a = await atenderSesion(db, ruta(), cuerpo({ accion: 'asentar', idCompromiso: comp() }), AHORA, cero);
    expect(a.status).toBe(503);
    expect((await refSesion().get()).exists).toBe(false);
    expect((await refCupo('contacto').get()).exists).toBe(false);
    expect((await db.collection('tenants').doc(T).collection('vistosDeTurno').get()).size).toBe(0);
  });

  it('con contención real y el presupuesto por defecto: 200 o 503, nunca 500, y a lo sumo un `nuevo`', async () => {
    const cuerpo = () => ({ telefono: TEL, sesion: { v: 1, accion: 'leer', espacio: 'venta', ejecucion: ejec(), idMensaje: 'wamid.PRESUPUESTO' } });
    const inicio = Date.now();
    const rs = await Promise.all(Array.from({ length: 20 }, () => atenderSesion(db, ruta(), cuerpo(), AHORA, { presupuestoMs: PRESUPUESTO_MS })));
    expect(rs.every((r) => r.status === 200 || r.status === 503)).toBe(true);
    expect(rs.filter((r) => r.json['visto'] === 'nuevo').length).toBeLessThanOrEqual(1);
    // Cada intento ya iniciado puede terminar (el emulador tarda ~3 s en resolver una colisión), pero no se inician otros.
    expect(Date.now() - inicio).toBeLessThan(10_000);
  });
});

// ---------------------------------------------------------------- las reglas

describe('ningún rol de la consola lee ni escribe las 3 colecciones (reglas reales)', () => {
  const claims = (tenants: Record<string, string>, p = false, prov = 'password') => ({
    nc: { t: tenants, ...(p ? { p: true } : {}), v: 1 },
    firebase: { sign_in_provider: prov, identities: {} }, email_verified: true,
  });
  const actores: [string, (t: string) => ReturnType<RulesTestEnvironment['unauthenticatedContext']>][] = [
    ['admin', (t) => entorno.authenticatedContext('u-admin', claims({ [t]: 'admin' }))],
    ['oper', (t) => entorno.authenticatedContext('u-oper', claims({ [t]: 'oper' }))],
    ['ingesta', (t) => entorno.authenticatedContext('u-ing', claims({ [t]: 'ingesta' }, false, 'custom'))],
    ['propietario', () => entorno.authenticatedContext('u-novuchat', claims({}, true, 'google.com'))],
    ['ajeno', () => entorno.authenticatedContext('u-ajeno', claims({ [OTRO]: 'admin' }))],
    ['anonimo', () => entorno.unauthenticatedContext()],
  ];

  it.each(actores)('%s: ni get, ni list, ni create, ni update, ni delete', async (_nombre, contexto) => {
    // Los documentos los crea la propia capa (Admin SDK), no la semilla a mano.
    await comprometer(ruta(), { idCompromiso: 'compromiso-reglas-01', cupos: [cupoDia()] });
    await leer(ruta(), { idMensaje: 'wamid.REGLAS' });
    const fs = contexto(T).firestore();
    const rutas = [
      ['sesionesDeTurno', idSesion(PN, 'venta', TEL)],
      ['vistosDeTurno', idVisto(PN, 'wamid.REGLAS')],
      ['cuposDeTurno', idCupo(PN, 'avisos', 'contacto', TEL, periodoDe(AHORA, 'dia'))],
    ] as const;
    for (const [col, id] of rutas) {
      await assertFails(getDoc(docWeb(fs, 'tenants', T, col, id)));
      await assertFails(getDocs(collection(fs, 'tenants', T, col)));
      await assertFails(setDocWeb(docWeb(fs, 'tenants', T, col, id), { version: 99 }));
      await assertFails(setDocWeb(docWeb(fs, 'tenants', T, col, 'nuevo'), { version: 1 }));
      await assertFails(updateDoc(docWeb(fs, 'tenants', T, col, id), { version: 99 }));
      await assertFails(deleteDoc(docWeb(fs, 'tenants', T, col, id)));
    }
  });
});

// ------------------------------------------------------------------- conteo

describe('el camino `sesion` no toca el conteo facturado', () => {
  it('no escribe en conversaciones/* ni metricas/*, ni crea otras colecciones', async () => {
    const tenant = db.collection('tenants').doc(T);
    const conversacion = tenant.collection('conversaciones').doc(`wa_${TEL}`);
    await conversacion.set({ telefono: TEL, mensajesTotal: 7, ventanaVenceEn: Timestamp.fromMillis(AHORA) });
    await conversacion.collection('mensajes').doc('m1').set({ texto: 'hola' });
    await tenant.collection('metricas').doc('2026-10').set({ conversaciones: 3, mensajes: 42 });
    const foto = async () => {
      const c = await conversacion.get();
      const m = await tenant.collection('metricas').doc('2026-10').get();
      const ms = await conversacion.collection('mensajes').get();
      return { c: [c.data(), c.updateTime?.toMillis()], m: [m.data(), m.updateTime?.toMillis()], ms: ms.size };
    };
    const antes = await foto();

    const id = 'compromiso-conteo-001';
    await leer(ruta(), { idMensaje: 'wamid.CONTEO' });
    await comprometer(ruta(), { idCompromiso: id, cupos: [cupoDia(), cupoDia({ clave: 'c', alcance: 'comercio', tope: 5 })] });
    await comprometer(ruta(), { versionLeida: 1, cupos: [cupoDia({ tope: 0 })] }); // negado
    await asentar(ruta(), id);
    await leer(ruta());

    expect(await foto()).toEqual(antes);
    const colecciones = (await tenant.listCollections()).map((c) => c.id).sort();
    expect(colecciones).toEqual(['conversaciones', 'cuposDeTurno', 'metricas', 'sesionesDeTurno', 'vistosDeTurno']);
    expect((await tenant.collection('conversaciones').get()).size).toBe(1);
    expect((await tenant.collection('metricas').get()).size).toBe(1);
  });

  it('la fuente de la capa no nombra conversaciones ni metricas, ni usa new Function', () => {
    const fuente = readFileSync(join(aqui, '..', '..', 'functions', 'src', 'core', 'turno', 'sesionFirestore.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(fuente).not.toMatch(/['"`](conversaciones|metricas|bitacora|contadores)['"`]/);
    expect(fuente).not.toMatch(/\bnew Function\b|\beval\(/);
  });
});
