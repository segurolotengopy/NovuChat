/**
 * EL AVISO DE CONSUMO AL 80 %, DE PUNTA A PUNTA: la función `ingesta` real,
 * con su transacción, contra el emulador de Firestore.
 *
 * La decisión (79 no, 80 sí, una vez por mes) está probada sin emulador en
 * `planes.test.ts`. Acá se prueba lo que esa prueba no ve: que la ingesta la
 * aplica dentro de la transacción que cuenta, con el agregado del mes que ya
 * escribía, y que deja la marca en la cuenta, una auditoría y un renglón de
 * bitácora. Y que NO se manda nada al cliente: la respuesta a n8n es la misma.
 *
 * La petición se autentica con el token por número, igual que n8n
 * (`firma.ts`): el valor del secreto sale del entorno, como en producción.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Alias reservado que ninguna otra suite usa. Valor de prueba, no un secreto.
const TOKEN = 'valor-de-prueba-del-aviso';
process.env['INGESTA_CLIENTE19'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { ingesta } = await import('../functions/src/ingesta.ts');

const T = 'aviso-consumo';
const NUMERO = '1000000091';
const MES = new Date().toISOString().slice(0, 7);   // el mismo período que usa la ingesta

interface Respuesta { codigo: number; cuerpo: unknown }

/** Un mensaje entrante de un teléfono nuevo: abre una atención, suma una conversación. */
async function entrante(telefono: string): Promise<Respuesta> {
  const cuerpo = { telefono, direccion: 'entrante', tipo: 'text', texto: 'hola, quiero reservar' };
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': NUMERO, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
  };
  const r: Respuesta = { codigo: 0, cuerpo: null };
  // Lo mínimo de una respuesta de Express que usan la ingesta y el
  // envoltorio de firebase-functions (el middleware de CORS escucha `finish`).
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = b; return respuesta; },
    json(b: unknown) { r.cuerpo = b; return respuesta; },
    setHeader() { return respuesta; },
    getHeader() { return undefined; },
    set() { return respuesta; },
    on() { return respuesta; },
    end() { return respuesta; },
  };
  await (ingesta as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

const cuenta = async () => (await db.doc(`tenants/${T}/cuenta/estado`).get()).data() ?? {};
const metricas = async () => (await db.doc(`tenants/${T}/metricas/${MES}`).get()).data() ?? {};
const auditorias = async () =>
  (await db.collection(`tenants/${T}/auditoria`).where('accion', '==', 'aviso_consumo').get()).docs.map((d) => d.data());
const bitacora = async () =>
  (await db.collection(`tenants/${T}/bitacora`).where('tipo', '==', 'aviso_consumo').get()).docs.map((d) => d.data());

// DOS MINUTOS DE MARGEN, Y NO ES LENTITUD DE ESTA SUITE. `asignar-numero.mjs`
// lanza DENTRO de su transacción en los casos que rechaza (alias repetido,
// número ajeno, comercio inexistente), y esa transacción consulta
// `rutasWhatsApp`. El SDK manda el rollback sin esperarlo y el proceso termina
// antes: el emulador conserva el bloqueo hasta que vence (medido el 15/09: 67 s).
// Si esta suite corre justo después, su escritura en `rutasWhatsApp` espera ese
// tiempo. El arreglo de fondo está en ese script (devolver el rechazo en vez de
// lanzarlo, como hace `asignar-plan.mjs`); mientras tanto, se espera.
beforeAll(async () => {
  for (const c of ['auditoria', 'bitacora', 'conversaciones']) {
    const previos = await db.collection(`tenants/${T}/${c}`).get();
    for (const d of previos.docs) await d.ref.delete();
  }
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({
    tenantId: T, flujo: 'agendamiento', aliasSecreto: 'cliente19', estado: 'activo',
  });
  await db.doc(`tenants/${T}`).set({ nombre: 'Aviso', estado: 'activo', plan: 'basico' });
  // Un comercio VIEJO: plan del catálogo, SIN copia de límites. Tiene que
  // medirse contra Impulso (100 conversaciones: avisa en la 80).
  await db.doc(`tenants/${T}/cuenta/estado`).set({ plan: 'impulso', estadoPago: 'al_dia' });
  // Ya van 78 conversaciones este mes.
  await db.doc(`tenants/${T}/metricas/${MES}`).set({ conversaciones: 78, mensajes: 300 });
}, 120_000);

describe('Aviso de consumo en la ingesta', () => {
  it('la conversación 79 (79 %) NO avisa', async () => {
    const r = await entrante('5910000000791');
    expect(r.codigo).toBe(200);
    expect((await metricas()).conversaciones).toBe(79);
    expect((await cuenta()).avisoConsumo).toBeUndefined();
    expect(await auditorias()).toHaveLength(0);
  });

  it('la conversación 80 (80 %) avisa: marca en la cuenta, auditoría y bitácora', async () => {
    const r = await entrante('5910000000801');
    expect(r.codigo).toBe(200);
    expect((await metricas()).conversaciones).toBe(80);
    const aviso = (await cuenta()).avisoConsumo;
    expect(aviso).toMatchObject({ mes: MES, umbral: 0.8, conversaciones: 80, limite: 100 });
    expect(aviso.en).toBeDefined();
    expect(await auditorias()).toHaveLength(1);
    expect((await auditorias())[0]).toMatchObject({ uid: 'ingesta', mes: MES, conversaciones: 80, limite: 100 });
    const renglones = await bitacora();
    expect(renglones).toHaveLength(1);
    expect(renglones[0]).toMatchObject({ canal: 'sistema', resultado: 'ok', detalle: '80/100' });
    // Sin teléfono: el aviso es del comercio, no de quien escribió.
    expect(renglones[0]?.['destinoEnmascarado']).toBeUndefined();
  });

  it('NO cambia lo que recibe n8n: 0 mensajes agregados', async () => {
    const r = await entrante('5910000000802');
    expect(Object.keys(r.cuerpo as object).sort()).toEqual(['atencion', 'avisarRecepcion']);
  });

  it('las conversaciones 81 y 82 NO vuelven a avisar', async () => {
    await entrante('5910000000811');
    expect((await metricas()).conversaciones).toBe(82);
    expect(await auditorias()).toHaveLength(1);
    expect(await bitacora()).toHaveLength(1);
    expect((await cuenta()).avisoConsumo).toMatchObject({ conversaciones: 80 });
  });

  it('un mensaje que no suma conversación no avisa (ni lee el agregado)', async () => {
    // El mismo teléfono de recién, dentro de su ventana: no abre nada.
    await db.doc(`tenants/${T}/cuenta/estado`).update({ avisoConsumo: { mes: '2000-01' } });
    await entrante('5910000000811');
    expect((await metricas()).conversaciones).toBe(82);
    expect(await auditorias()).toHaveLength(1);
  });

  it('con el aviso de OTRO mes anotado, vuelve a avisar este mes', async () => {
    await entrante('5910000000831');
    expect((await metricas()).conversaciones).toBe(83);
    expect((await cuenta()).avisoConsumo).toMatchObject({ mes: MES, conversaciones: 83, limite: 100 });
    expect(await auditorias()).toHaveLength(2);
  });

  it('NO toca nada más de la cuenta', async () => {
    expect(await cuenta()).toMatchObject({ plan: 'impulso', estadoPago: 'al_dia' });
    expect((await cuenta()).limites).toBeUndefined();
  });
});
