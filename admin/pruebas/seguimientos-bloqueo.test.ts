/**
 * CONTACTO BLOQUEADO EN LOS SEGUIMIENTOS (Andres, 31/10/2026): una conversación con
 * `bloqueada === true` queda fuera de todo envío automático de Agenda. Escrita NEGANDO.
 *
 *   1. `esPendienteDeSeguimiento`: bloqueada nunca; false/ausente/basura, como hoy.
 *   2. `seguimientosPendientes` (emulador): el bloqueado no sale; otro comercio no se ve afectado.
 *   3. `seguimientoEnviado`: bloqueo ENTRE el armado de la lista y el envío => no marca, no cuenta.
 *   4. Desbloquear (la marca vuelve a false) lo incluye de nuevo.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN = 'valor-de-prueba-del-bloqueo-en-seguimientos';
process.env['INGESTA_CLIENTE20'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const { seguimientosPendientes, seguimientoEnviado, esPendienteDeSeguimiento } =
  await import('../functions/src/modulos/agenda/seguimientos.ts');

const A = 'seg-bloq-a';
const B = 'seg-bloq-b';
const NUM_A = '1000000071';
const NUM_B = '1000000072';
const HORA = 60 * 60 * 1000;
const MES = new Date().toISOString().slice(0, 7);

// Mismo teléfono en dos comercios: el bloqueo de uno no debe tocar al otro.
const MISMO = '591700031';
const OTRO = '591700032';

async function llamar(fn: unknown, numero: string, cuerpo: Record<string, unknown>) {
  const cab: Record<string, string> = {
    'x-novuchat-numero': numero, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cab[n.toLowerCase()];
  const peticion = { method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)), headers: cab, get: leer, header: leer };
  const r: { codigo: number; cuerpo: unknown } = { codigo: 0, cuerpo: null };
  const res: Record<string, unknown> = {
    status(c: number) { r.codigo = c; return res; },
    send(b: unknown) { r.cuerpo = b; return res; },
    json(b: unknown) { r.cuerpo = b; return res; },
    setHeader() { return res; }, getHeader() { return undefined; }, set() { return res; },
    on() { return res; }, end() { return res; },
  };
  await (fn as (q: unknown, s: unknown) => Promise<void>)(peticion, res);
  return r;
}

async function sembrar(t: string, tel: string, horas: number, extra: Record<string, unknown> = {}) {
  const ms = Date.now() - horas * HORA;
  await db.doc(`tenants/${t}/conversaciones/wa_${tel}`).set({
    telefono: tel, canal: 'whatsapp', nombreContacto: 'Paciente', ultimoMensaje: 'Y el jueves?',
    ultimoEn: Timestamp.fromMillis(ms), mensajesTotal: 4, atencionEstado: 'normal',
    solicitud: {
      etapa: 'horarios', desde: Timestamp.fromMillis(ms), qrEnviadoEn: null, evento: null,
      cotejos: 0, seguimientos: 0, seguimientoEn: null, reactivadaEn: null,
    },
    ...extra,
  });
}
const lista = async (numero: string) =>
  ((await llamar(seguimientosPendientes, numero, {})).cuerpo as { pendientes: { telefono: string }[] })
    .pendientes.map((p) => p.telefono);
const seg = async (t: string, tel: string) =>
  ((await db.doc(`tenants/${t}/conversaciones/wa_${tel}`).get()).get('solicitud') as Record<string, unknown>)['seguimientos'];

const AHORA = Date.UTC(2026, 9, 31, 15, 0, 0);
const conv = (extra: Record<string, unknown> = {}) => ({
  ultimoEn: Timestamp.fromMillis(AHORA - 3 * HORA), atencionEstado: 'normal',
  solicitud: { etapa: 'horarios', desde: Timestamp.fromMillis(AHORA - 3 * HORA), qrEnviadoEn: null, evento: null,
    cotejos: 0, seguimientos: 0, seguimientoEn: null, reactivadaEn: null },
  ...extra,
});

describe('1. esPendienteDeSeguimiento con la marca bloqueada', () => {
  it('bloqueada === true nunca recibe seguimiento, en ninguna de las dos ventanas', () => {
    expect(esPendienteDeSeguimiento(conv({ bloqueada: true }), AHORA)).toBeNull();
    const fuera = conv({ bloqueada: true, ultimoEn: Timestamp.fromMillis(AHORA - 30 * HORA) });
    expect(esPendienteDeSeguimiento(fuera, AHORA)).toBeNull();
  });
  it('sin la marca, false o basura: igual que hoy (solo el true exacto bloquea)', () => {
    expect(esPendienteDeSeguimiento(conv(), AHORA)).toBe('texto');
    expect(esPendienteDeSeguimiento(conv({ bloqueada: false }), AHORA)).toBe('texto');
    expect(esPendienteDeSeguimiento(conv({ bloqueada: 'true' }), AHORA)).toBe('texto');
    expect(esPendienteDeSeguimiento(conv({ bloqueada: 1 }), AHORA)).toBe('texto');
  });
});

describe('2 a 4. contra el emulador', () => {
  beforeAll(async () => {
    for (const t of [A, B]) {
      for (const c of ['conversaciones', 'bitacora']) {
        for (const d of (await db.collection(`tenants/${t}/${c}`).get()).docs) await d.ref.delete();
      }
      await db.doc(`tenants/${t}/metricas/${MES}`).delete();
      await db.doc(`tenants/${t}`).set({ nombre: 'Clínica', estado: 'activo', flujos: ['agendamiento'] });
      await db.doc(`tenants/${t}/config/negocio`).set({ nombreNegocio: 'Clínica', moneda: 'BOB' });
    }
    await db.doc(`rutasWhatsApp/${NUM_A}`).set({ tenantId: A, flujo: 'agendamiento', aliasSecreto: 'cliente20', estado: 'activo' });
    await db.doc(`rutasWhatsApp/${NUM_B}`).set({ tenantId: B, flujo: 'agendamiento', aliasSecreto: 'cliente20', estado: 'activo' });
    await sembrar(A, MISMO, 3, { bloqueada: true });
    await sembrar(A, OTRO, 3);
    await sembrar(B, MISMO, 3);            // el mismo teléfono en OTRO comercio, sin bloquear
  }, 120_000);

  it('el bloqueado no sale en la lista; el que no lo está, sí', async () => {
    const l = await lista(NUM_A);
    expect(l).not.toContain(MISMO);
    expect(l).toContain(OTRO);
  });

  it('un comercio nunca excluye contactos de otro: el mismo teléfono en B sigue saliendo', async () => {
    expect(await lista(NUM_B)).toContain(MISMO);
  });

  it('bloqueo ENTRE el armado y el envío: el aviso no marca, no cuenta y no deja mandar', async () => {
    expect(await lista(NUM_A)).toContain(OTRO);          // armado: sale
    await db.doc(`tenants/${A}/conversaciones/wa_${OTRO}`).update({ bloqueada: true });   // se bloquea
    const r = await llamar(seguimientoEnviado, NUM_A, { telefono: OTRO, modo: 'texto' });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toMatchObject({ marcado: false, motivo: 'bloqueado' });
    expect(await seg(A, OTRO)).toBe(0);
    const m = (await db.doc(`tenants/${A}/metricas/${MES}`).get()).data() ?? {};
    expect(m['seguimientos'] ?? 0).toBe(0);
    const bit = await db.collection(`tenants/${A}/bitacora`).where('tipo', '==', 'seguimiento_enviado').get();
    expect(bit.size).toBe(0);
  });

  it('el bloqueo de A no frena el envío de B para el mismo teléfono', async () => {
    const r = await llamar(seguimientoEnviado, NUM_B, { telefono: MISMO, modo: 'texto' });
    expect(r.cuerpo).toMatchObject({ marcado: true });
    expect(await seg(B, MISMO)).toBe(1);
  });

  it('desbloquear vuelve a incluirlo, en la lista y en el envío', async () => {
    await db.doc(`tenants/${A}/conversaciones/wa_${OTRO}`).update({ bloqueada: false });
    expect(await lista(NUM_A)).toContain(OTRO);
    const r = await llamar(seguimientoEnviado, NUM_A, { telefono: OTRO, modo: 'texto' });
    expect(r.cuerpo).toMatchObject({ marcado: true });
    expect(await seg(A, OTRO)).toBe(1);
  });
});
