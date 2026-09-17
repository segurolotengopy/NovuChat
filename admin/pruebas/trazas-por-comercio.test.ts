/**
 * EL REGISTRO QUE PERMITE ATRIBUIR TRÁFICO Y COSTO POR COMERCIO (17/09/2026).
 *
 * EL PROBLEMA QUE ARREGLA. Las dos Functions que atienden a n8n —`ingesta` y
 * `configuracionFlujo`— no dejaban ningún renglón propio: solo el del
 * envoltorio de Cloud Run, sin decir de qué comercio era el mensaje. La
 * pregunta «cuánto tráfico y cuánto costo generó cada cliente» había que
 * contestarla leyendo Firestore comercio por comercio.
 *
 * QUÉ SE PRUEBA, y se prueba sobre lo que DE VERDAD sale: el registro de
 * firebase-functions escribe UNA línea de JSON por llamada, y esa línea es la
 * que en Cloud Logging queda en `jsonPayload`. Por eso la prueba intercepta la
 * salida y vuelve a parsear el JSON en vez de espiar la llamada: un
 * `logger.info` con un texto concatenado pasaría un espía y no permitiría
 * agrupar por campo, que es justamente lo que se quería arreglar.
 *
 * Y SE ESCRIBE NEGANDO lo que no puede aparecer nunca: el teléfono completo, el
 * texto del mensaje, el identificador de la conversación (`wa_<telefono>`, que
 * ES el teléfono) y el secreto con el que n8n firmó.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Alias reservado que ninguna otra suite usa. Valor de prueba, no un secreto.
const TOKEN = 'valor-de-prueba-de-las-trazas';
process.env['INGESTA_CLIENTE18'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

// LA CONSOLA SE INTERVIENE ANTES DE IMPORTAR LAS FUNCTIONS, y no es un capricho:
// el registro de firebase-functions se guarda una COPIA de los métodos de
// `console` al cargarse (`UNPATCHED_CONSOLE`), justamente para que nadie le
// cambie la salida después. Intervenir más tarde —o espiar
// `process.stdout.write`— no atrapa nada. Fuera de la captura, todo se reenvía
// tal cual, así que el informe de las pruebas no se pierde.
const capturado: string[] = [];
let capturando = false;
for (const nivel of ['debug', 'info', 'log', 'warn', 'error'] as const) {
  const previo = console[nivel].bind(console);
  console[nivel] = ((...args: unknown[]) => {
    if (capturando) { capturado.push(args.map((a) => String(a)).join(' ')); return; }
    previo(...args);
  }) as typeof console.info;
}

const { configuracionFlujo, ingesta } = await import('../functions/src/ingesta.ts');

const T = 'trazas-comercio';
// Números de prueba con la forma que exige el repositorio público: seis ceros
// seguidos, nunca un número real.
const NUMERO = '1000000093';
const TELEFONO = '59170000004';
const TEXTO = 'quiero reservar para el jueves';
const MES = new Date().toISOString().slice(0, 7);

type Renglon = Record<string, unknown>;

/** Llama a una Function como lo hace n8n y devuelve lo que se registró. */
async function llamar(
  cual: 'ingesta' | 'configuracion', cuerpo: Record<string, unknown>,
): Promise<{ codigo: number; renglones: Renglon[]; crudo: string }> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': NUMERO, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
  };
  let codigo = 0;
  const respuesta = {
    status(c: number) { codigo = c; return respuesta; },
    send() { return respuesta; },
    json() { return respuesta; },
    setHeader() { return respuesta; },
    getHeader() { return undefined; },
    set() { return respuesta; },
    on() { return respuesta; },
    end() { return respuesta; },
  };

  capturado.length = 0;
  capturando = true;
  try {
    const fn = (cual === 'ingesta' ? ingesta : configuracionFlujo) as unknown as
      (q: unknown, s: unknown) => Promise<void>;
    await fn(peticion, respuesta);
  } finally {
    capturando = false;
  }

  const crudo = capturado.join('\n');
  const renglones: Renglon[] = [];
  for (const linea of crudo.split('\n')) {
    if (!linea.trim().startsWith('{')) continue;
    try {
      const j = JSON.parse(linea) as Renglon;
      if (typeof j['evento'] === 'string') renglones.push(j);
    } catch { /* no es del registro estructurado */ }
  }
  return { codigo, renglones, crudo };
}

const entrante = () => llamar('ingesta', { telefono: TELEFONO, direccion: 'entrante', tipo: 'text', texto: TEXTO });
const saliente = () => llamar('ingesta', { telefono: TELEFONO, direccion: 'saliente', tipo: 'text', texto: 'Con gusto, tengo el jueves a las 10.' });

beforeAll(async () => {
  for (const c of ['conversaciones', 'bitacora', 'catalogo', 'funcionarios']) {
    for (const d of (await db.collection(`tenants/${T}/${c}`).get()).docs) await d.ref.delete();
  }
  await db.doc(`tenants/${T}/metricas/${MES}`).delete();
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({
    tenantId: T, flujo: 'agendamiento', aliasSecreto: 'cliente18', estado: 'activo',
  });
  await db.doc(`tenants/${T}`).set({ nombre: 'Trazas', estado: 'activo', flujos: ['agendamiento'] });
  await db.doc(`tenants/${T}/cuenta/estado`).set({ plan: 'impulso', estadoPago: 'al_dia' });
  await db.doc(`tenants/${T}/config/negocio`).set({
    nombreNegocio: 'Trazas', zonaHoraria: 'America/La_Paz', moneda: 'BOB',
  });
  await db.doc(`tenants/${T}/catalogo/consulta`).set({ nombre: 'Consulta', activo: true, precio: 100 });
});

describe('ingesta: un renglón por mensaje, con el comercio adentro', () => {
  it('el entrante deja el comercio, el flujo y el período, sin nada del cliente', async () => {
    const r = await entrante();
    expect(r.codigo).toBe(200);
    const t = r.renglones.filter((x) => x['evento'] === 'ingesta_mensaje');
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({
      evento: 'ingesta_mensaje',
      tenantId: T,
      flujo: 'agendamiento',
      periodo: MES,
      direccion: 'entrante',
      tipo: 'text',
      telefonoUlt4: TELEFONO.slice(-4),
      atencionEstado: 'normal',
      tamanoTexto: TEXTO.length,
    });
    // LO QUE NO PUEDE APARECER NUNCA, mirado sobre la línea cruda.
    expect(r.crudo).not.toContain(TELEFONO);
    expect(r.crudo).not.toContain(TEXTO);
    expect(r.crudo).not.toContain(`wa_${TELEFONO}`);
    expect(r.crudo).not.toContain(TOKEN);
  });

  it('el saliente trae lo que ya se contaba de la ventana: es lo que predice la factura de Meta', async () => {
    const r = await saliente();
    expect(r.codigo).toBe(200);
    const t = r.renglones.find((x) => x['evento'] === 'ingesta_mensaje')!;
    expect(t).toMatchObject({
      tenantId: T, direccion: 'saliente', mensajesVentana: 1, bloqueNuevo: false,
    });
    // La conversación ya la abrió el entrante: este saliente no factura otra.
    expect(t['conversacion']).toBe(false);
  });

  it('cada mensaje deja un renglón, así que sumarlos por comercio cuenta los mensajes del mes', async () => {
    const antes = (await db.doc(`tenants/${T}/metricas/${MES}`).get()).get('mensajes') as number;
    const salientes = [await saliente(), await saliente()]
      .flatMap((r) => r.renglones)
      .filter((x) => x['evento'] === 'ingesta_mensaje' && x['direccion'] === 'saliente' && x['tenantId'] === T);
    expect(salientes).toHaveLength(2);
    expect(salientes.map((x) => x['mensajesVentana'])).toEqual([2, 3]);
    // El registro y el agregado que ya escribía la ingesta cuentan lo mismo.
    expect((await db.doc(`tenants/${T}/metricas/${MES}`).get()).get('mensajes')).toBe(antes + 2);
  });
});

describe('configuracionFlujo: un renglón por turno', () => {
  it('deja el comercio, el flujo y el estado de la ventana, sin el teléfono entero', async () => {
    const r = await llamar('configuracion', { telefono: TELEFONO });
    expect(r.codigo).toBe(200);
    const t = r.renglones.filter((x) => x['evento'] === 'configuracion_flujo');
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({
      evento: 'configuracion_flujo',
      tenantId: T,
      flujo: 'agendamiento',
      estadoComercio: 'activo',
      telefonoUlt4: TELEFONO.slice(-4),
      atencionEstado: 'normal',
      catalogoItems: 1,
      catalogoResumido: false,
    });
    expect(r.crudo).not.toContain(TELEFONO);
    expect(r.crudo).not.toContain(TOKEN);
  });

  it('sin teléfono en el cuerpo, el renglón sale igual y lo del cliente queda en nulo', async () => {
    const r = await llamar('configuracion', {});
    const t = r.renglones.find((x) => x['evento'] === 'configuracion_flujo')!;
    expect(t).toMatchObject({ tenantId: T, telefonoUlt4: null, atencionEstado: null, mensajesVentana: null });
  });
});
