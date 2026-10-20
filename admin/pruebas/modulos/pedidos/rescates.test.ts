/**
 * RESCATE DE 22 H — `reclamarRescates` contra el emulador de Firestore.
 *
 * Se prueba escribirle a alguien que no escribió: la suite está escrita NEGANDO.
 * Cada caso comprueba sobre todo que NO se marca ni se devuelve nada. Teléfonos
 * ficticios (591000000xx); alias de ingesta de prueba, no secretos.
 *
 * No hay un alias de la reserva libre (los veinte los usa alguna suite): se
 * comparten `cliente20` y `cliente19` con números y comercios propios de esta
 * suite. Las suites no corren en paralelo y cada una siembra y limpia lo suyo.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN_X = 'valor-de-prueba-del-rescate-x';
const TOKEN_Y = 'valor-de-prueba-del-rescate-y';
process.env['INGESTA_CLIENTE20'] = TOKEN_X;
process.env['INGESTA_CLIENTE19'] = TOKEN_Y;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const { reclamarRescates, TOPE_DIARIO_POR_COMERCIO, TOPE_POR_CORRIDA } =
  await import('../../../functions/src/modulos/pedidos/rescates.ts');

const X = 'resc-tienda-x';
const Y = 'resc-tienda-y';
const NUM_X = '1000000601';
const NUM_X2 = '1000000602';   // otra línea del mismo comercio
const NUM_Y = '1000000603';
const HORA = 60 * 60 * 1000;
const MIN = 60 * 1000;

interface Respuesta { codigo: number; cuerpo: any }

async function llamar(opciones: {
  numero?: string; token?: string | null; metodo?: string; cuerpo?: Record<string, unknown>;
} = {}): Promise<Respuesta> {
  const cuerpo = opciones.cuerpo ?? { v: 1 };
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': opciones.numero ?? NUM_X, 'content-type': 'application/json',
  };
  const token = opciones.token === undefined ? TOKEN_X : opciones.token;
  if (token !== null) cabeceras['authorization'] = `Bearer ${token}`;
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = {
    method: opciones.metodo ?? 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
  };
  const r: Respuesta = { codigo: 0, cuerpo: null };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = b; return respuesta; },
    json(b: unknown) { r.cuerpo = b; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; },
  };
  await (reclamarRescates as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

const ahora = () => Date.now();
const en = (ms: number) => Timestamp.fromMillis(ahora() - ms);
const SILENCIO_OK = 22 * HORA + 30 * MIN;

/** Siembra una conversación candidata válida, con los cambios que se pidan. */
async function sembrar(
  t: string, tel: string, extra: Record<string, unknown> = {},
  mensajes: { direccion: string; tipo: string; texto: string; hace: number }[] = [
    { direccion: 'entrante', tipo: 'text', texto: 'Hola, tengo una pastelería y quiero ordenar mis ventas', hace: SILENCIO_OK + 10 * MIN },
    { direccion: 'saliente', tipo: 'text', texto: 'Respuesta del asistente', hace: SILENCIO_OK },
  ],
) {
  const ref = db.doc(`tenants/${t}/conversaciones/wa_${tel}`);
  await ref.set({
    telefono: tel, phoneNumberId: t === Y ? NUM_Y : NUM_X, ultimoEntranteEn: en(SILENCIO_OK),
    ultimoEn: en(SILENCIO_OK), atencionEstado: 'normal', nombreContacto: 'Nombre Secreto',
    solicitud: { etapa: 'qr_enviado', cotejos: 0 },
    ...extra,
  });
  for (const m of mensajes) {
    await ref.collection('mensajes').add({
      direccion: m.direccion, tipo: m.tipo, texto: m.texto, ts: en(m.hace),
    });
  }
}

async function borrarTodo(t: string) {
  for (const c of ['conversaciones', 'bitacora']) {
    for (const d of (await db.collection(`tenants/${t}/${c}`).get()).docs) {
      await db.recursiveDelete(d.ref);
    }
  }
}
const marca = async (t: string, tel: string) =>
  (await db.doc(`tenants/${t}/conversaciones/wa_${tel}`).get()).get('rescate');
const tel = (n: number) => `591000${String(n).padStart(5, '0')}`;

beforeAll(async () => {
  await db.doc(`rutasWhatsApp/${NUM_X}`).set({ tenantId: X, flujo: 'venta', aliasSecreto: 'cliente20', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUM_X2}`).set({ tenantId: X, flujo: 'venta', aliasSecreto: 'cliente20', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUM_Y}`).set({ tenantId: Y, flujo: 'venta', aliasSecreto: 'cliente19', estado: 'activo' });
  for (const t of [X, Y]) {
    await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo', flujos: ['venta'] });
    await db.doc(`tenants/${t}/config/negocio`).set({ nombreNegocio: t, moneda: 'BOB', numeroRecepcion: '+591 000 00099' });
  }
});

beforeEach(async () => {
  await borrarTodo(X);
  await borrarTodo(Y);
  await db.doc(`tenants/${X}/cuenta/estado`).delete();
  await db.doc('plataforma/prepago').delete();
  await db.doc(`rutasWhatsApp/${NUM_X}`).set({ tenantId: X, flujo: 'venta', aliasSecreto: 'cliente20', estado: 'activo' });
  await db.doc(`tenants/${X}`).set({ nombre: X, estado: 'activo', flujos: ['venta'] });
});

afterAll(async () => {
  await borrarTodo(X);
  await borrarTodo(Y);
  await db.doc('plataforma/prepago').delete();
  await db.doc(`tenants/${X}/cuenta/estado`).delete();
  for (const n of [NUM_X, NUM_X2, NUM_Y]) await db.doc(`rutasWhatsApp/${n}`).delete();
  for (const t of [X, Y]) {
    await db.doc(`tenants/${t}/config/negocio`).delete();
    await db.doc(`tenants/${t}`).delete();
  }
});

describe('acceso', () => {
  it('sin credencial: 401 «no autorizado»; con credencial ajena también', async () => {
    await sembrar(X, tel(11));
    const sin = await llamar({ token: null });
    expect(sin.codigo).toBe(401);
    expect(sin.cuerpo).toBe('no autorizado');
    expect((await llamar({ token: 'otro-valor' })).codigo).toBe(401);
    expect(await marca(X, tel(11))).toBeUndefined();
  });

  it('credencial del comercio Y con el número de X: 401 y ninguna marca en X ni en Y', async () => {
    await sembrar(X, tel(11));
    await sembrar(Y, tel(11));
    const r = await llamar({ numero: NUM_X, token: TOKEN_Y });
    expect(r.codigo).toBe(401);
    expect(r.cuerpo).toBe('no autorizado');
    const r2 = await llamar({ numero: NUM_Y, token: TOKEN_X });
    expect(r2.codigo).toBe(401);
    expect(await marca(X, tel(11))).toBeUndefined();
    expect(await marca(Y, tel(11))).toBeUndefined();
  });

  it('GET: 405', async () => {
    expect((await llamar({ metodo: 'GET' })).codigo).toBe(405);
  });

  it('comercio suspendido: 409 y nada marcado', async () => {
    await sembrar(X, tel(11));
    await db.doc(`rutasWhatsApp/${NUM_X}`).set({ tenantId: X, flujo: 'venta', aliasSecreto: 'cliente20', estado: 'suspendido' });
    const r = await llamar();
    expect(r.codigo).toBe(409);
    expect(await marca(X, tel(11))).toBeUndefined();
  });

  it('flujo que no es de venta: 409 flujo_no_admitido', async () => {
    await sembrar(X, tel(11));
    await db.doc(`rutasWhatsApp/${NUM_X}`).set({ tenantId: X, flujo: 'agendamiento', aliasSecreto: 'cliente20', estado: 'activo' });
    const r = await llamar();
    expect(r.codigo).toBe(409);
    expect(r.cuerpo).toEqual({ estado: 'flujo_no_admitido' });
    expect(await marca(X, tel(11))).toBeUndefined();
  });

  it('cuerpo inválido: 400', async () => {
    expect((await llamar({ cuerpo: { v: 2 } })).codigo).toBe(400);
    expect((await llamar({ cuerpo: { v: 1, mas: 1 } })).codigo).toBe(400);
  });
});

describe('quién se rescata', () => {
  it('con todos los descartes sembrados a la vez, solo salen las 2 válidas y solo ellas quedan marcadas', async () => {
    const validas = [tel(11), tel(12)];
    for (const t of validas) await sembrar(X, t);
    const descartes: Record<string, Record<string, unknown>> = {
      [tel(21)]: { ultimoEntranteEn: en(21 * HORA) },                    // temprano
      [tel(22)]: { ultimoEntranteEn: en(24 * HORA) },                    // tarde
      [tel(23)]: { noContactar: true },
      [tel(24)]: { atencionEstado: 'operador' },
      [tel(25)]: { atencionEstado: 'bloqueado' },
      [tel(26)]: { solicitud: { etapa: 'agendada', cotejos: 0 } },
      [tel(35)]: { solicitud: { etapa: 'qr_enviado', cotejos: 1 } },
      [tel(36)]: { solicitud: { etapa: 'qr_enviado', cotejos: 0, seguimientos: 1 } },
      [tel(37)]: { solicitud: { etapa: 'qr_enviado', cotejos: 0, seguimientoEn: en(HORA) } },
      [tel(27)]: { solicitud: { etapa: 'en_revision', cotejos: 0 } },
      [tel(28)]: { rescate: { enviadoEn: en(HORA) } },
      [tel(29)]: { phoneNumberId: NUM_X2 },
      [tel(30)]: { turno: { responde: 'persona', tomadoPor: 'uid-1', tomadoEn: en(10 * MIN), actividadPersonaEn: en(10 * MIN) } },
      [tel(31)]: { turno: 'basura' },
      [tel(32)]: { telefono: '123' },
    };
    for (const [t, extra] of Object.entries(descartes)) await sembrar(X, t, extra);
    await sembrar(X, tel(33), {}, [{ direccion: 'entrante', tipo: 'image', texto: '', hace: SILENCIO_OK + MIN }]);
    await sembrar(X, tel(34), {}, [{ direccion: 'entrante', tipo: 'text', texto: 'No me interesa', hace: SILENCIO_OK + MIN }]);
    await sembrar(X, tel(38), {}, [{ direccion: 'entrante', tipo: 'interactive', texto: 'No, gracias', hace: SILENCIO_OK + MIN }]);
    await sembrar(X, '59100000099');   // el número de recepción del comercio

    const r = await llamar();
    expect(r.codigo).toBe(200);
    expect(r.cuerpo.phoneNumberId).toBe(NUM_X);
    expect(r.cuerpo.rescates.map((x: { telefono: string }) => x.telefono).sort()).toEqual(validas);
    for (const t of validas) expect(await marca(X, t)).toBeDefined();
    // La ya rescatada conserva su marca original (sin `phoneNumberId`): no se reescribió.
    expect(await marca(X, tel(28))).not.toHaveProperty('phoneNumberId');
    for (const t of [...Object.keys(descartes).filter((k) => k !== tel(28)), tel(33), tel(34), tel(38), '59100000099']) {
      expect(await marca(X, t), t).toBeUndefined();
    }
  });

  it('la respuesta lleva solo teléfono, ancla y textos: sin nombre ni mensajes del asistente', async () => {
    await sembrar(X, tel(11));
    const r = await llamar();
    expect(Object.keys(r.cuerpo).sort()).toEqual(['phoneNumberId', 'rescates']);
    expect(Object.keys(r.cuerpo.rescates[0]).sort()).toEqual(['telefono', 'textos', 'ultimoEntranteMs']);
    expect(r.cuerpo.rescates[0].textos).toEqual(['Hola, tengo una pastelería y quiero ordenar mis ventas']);
    const crudo = JSON.stringify(r.cuerpo);
    expect(crudo).not.toContain('nombreContacto');
    expect(crudo).not.toContain('Nombre Secreto');
    expect(crudo).not.toContain('Respuesta del asistente');
  });

  it('el número de recepción del comercio se excluye aunque venga con formato', async () => {
    await sembrar(X, '59100000099');
    expect((await llamar()).cuerpo.rescates).toEqual([]);
  });

  it('el número de recepción en formato local (8 dígitos) también se excluye con el código de país', async () => {
    await db.doc(`tenants/${X}/config/negocio`).set({ nombreNegocio: X, moneda: 'BOB', numeroRecepcion: '00000088' });
    await sembrar(X, '59100000088');
    expect((await llamar()).cuerpo.rescates).toEqual([]);
    expect(await marca(X, '59100000088')).toBeUndefined();
    await db.doc(`tenants/${X}/config/negocio`).set({ nombreNegocio: X, moneda: 'BOB', numeroRecepcion: '+591 000 00099' });
  });

  it('un teléfono de `excluir` no sale', async () => {
    await sembrar(X, tel(11));
    expect((await llamar({ cuerpo: { v: 1, excluir: [tel(11)] } })).cuerpo.rescates).toEqual([]);
    expect(await marca(X, tel(11))).toBeUndefined();
  });
});

describe('uno solo, siempre', () => {
  it('una segunda llamada inmediata devuelve 0', async () => {
    await sembrar(X, tel(11));
    expect((await llamar()).cuerpo.rescates).toHaveLength(1);
    expect((await llamar()).cuerpo.rescates).toEqual([]);
  });

  it('dos llamadas simultáneas dejan como máximo una marca por conversación', async () => {
    for (let i = 0; i < 6; i++) await sembrar(X, tel(40 + i));
    const [a, b] = await Promise.all([llamar(), llamar()]);
    const salidas = [...a.cuerpo.rescates, ...b.cuerpo.rescates].map((x: { telefono: string }) => x.telefono);
    const esperadas = Array.from({ length: 6 }, (_, i) => tel(40 + i));
    // Exactamente las 6, cada una una sola vez entre las dos llamadas.
    expect([...salidas].sort()).toEqual(esperadas);
    for (const t of esperadas) expect(await marca(X, t), t).toBeDefined();
    const bitacora = await db.collection(`tenants/${X}/bitacora`).where('codigo', '==', 'rescate').get();
    expect(bitacora.size).toBe(6);
  });

  it('la marca se escribe con merge: no borra el resto de la conversación', async () => {
    await sembrar(X, tel(11));
    await llamar();
    const d = (await db.doc(`tenants/${X}/conversaciones/wa_${tel(11)}`).get()).data() ?? {};
    expect(d['nombreContacto']).toBe('Nombre Secreto');
    expect(d['rescate']).toMatchObject({ phoneNumberId: NUM_X });
  });
});

describe('multi-tenant', () => {
  it('el mismo teléfono en dos comercios: con la credencial de X solo vuelve el de X', async () => {
    await sembrar(X, tel(11));
    await sembrar(Y, tel(11));
    const r = await llamar();
    expect(r.cuerpo.rescates).toHaveLength(1);
    expect(await marca(X, tel(11))).toBeDefined();
    expect(await marca(Y, tel(11))).toBeUndefined();
    const ry = await llamar({ numero: NUM_Y, token: TOKEN_Y });
    expect(ry.cuerpo.phoneNumberId).toBe(NUM_Y);
    expect(ry.cuerpo.rescates).toHaveLength(1);
    expect(await marca(Y, tel(11))).toBeDefined();
  });

  it('con otra línea del mismo comercio no sale lo que escribió a la primera', async () => {
    await sembrar(X, tel(11));
    const r = await llamar({ numero: NUM_X2 });
    expect(r.cuerpo.phoneNumberId).toBe(NUM_X2);
    expect(r.cuerpo.rescates).toEqual([]);
    expect(await marca(X, tel(11))).toBeUndefined();
  });

  it('el tope diario de un comercio no cuenta las marcas de otro', async () => {
    await sembrar(Y, tel(11), { rescate: { enviadoEn: en(HORA) } });
    await sembrar(X, tel(12));
    expect((await llamar()).cuerpo.rescates).toHaveLength(1);
  });
});

describe('lista de prueba', () => {
  it('lista vacía: 0, lista_vacia y ninguna escritura', async () => {
    await sembrar(X, tel(11));
    const r = await llamar({ cuerpo: { v: 1, soloTelefonos: [] } });
    expect(r.cuerpo).toEqual({ phoneNumberId: NUM_X, rescates: [], motivo: 'lista_vacia' });
    expect(await marca(X, tel(11))).toBeUndefined();
  });

  it('lista con A: solo A; B queda sin marcar y disponible', async () => {
    await sembrar(X, tel(11));
    await sembrar(X, tel(12));
    const r = await llamar({ cuerpo: { v: 1, soloTelefonos: [tel(11)] } });
    expect(r.cuerpo.rescates.map((x: { telefono: string }) => x.telefono)).toEqual([tel(11)]);
    expect(await marca(X, tel(12))).toBeUndefined();
    const despues = await llamar();
    expect(despues.cuerpo.rescates.map((x: { telefono: string }) => x.telefono)).toEqual([tel(12)]);
  });
});

describe('topes', () => {
  const marcadas = async (n: number) => {
    const lote = db.batch();
    for (let i = 0; i < n; i++) {
      lote.set(db.doc(`tenants/${X}/conversaciones/wa_591000${String(70000 + i)}`), {
        telefono: `591000${70000 + i}`, phoneNumberId: NUM_X, ultimoEntranteEn: en(40 * HORA),
        rescate: { enviadoEn: en(HORA), phoneNumberId: NUM_X, anclaMs: 0 },
      });
      if ((i + 1) % 400 === 0) { await lote.commit(); }
    }
    await lote.commit();
  };

  it('el tope diario es 150', () => {
    expect(TOPE_DIARIO_POR_COMERCIO).toBe(150);
    expect(TOPE_POR_CORRIDA).toBe(20);
  });

  it('con 150 marcas en 24 h: nada y tope_diario', async () => {
    await marcadas(150);
    await sembrar(X, tel(11));
    const r = await llamar();
    expect(r.cuerpo).toEqual({ phoneNumberId: NUM_X, rescates: [], motivo: 'tope_diario' });
    expect(await marca(X, tel(11))).toBeUndefined();
  });

  it('con 149: como máximo 1', async () => {
    await marcadas(149);
    await sembrar(X, tel(11));
    await sembrar(X, tel(12));
    expect((await llamar()).cuerpo.rescates).toHaveLength(1);
  });

  it('una marca de hace más de 24 h no cuenta para el tope diario', async () => {
    await marcadas(149);
    await db.doc(`tenants/${X}/conversaciones/wa_${tel(900)}`).set({
      telefono: tel(900), phoneNumberId: NUM_X, ultimoEntranteEn: en(80 * HORA),
      rescate: { enviadoEn: en(30 * HORA), phoneNumberId: NUM_X, anclaMs: 0 },
    });
    await sembrar(X, tel(11));
    await sembrar(X, tel(12));
    expect((await llamar()).cuerpo.rescates).toHaveLength(1);
  });

  it('con 25 válidas: 20 la primera vez y 5 la segunda', async () => {
    for (let i = 0; i < 25; i++) await sembrar(X, tel(100 + i), {}, []);
    expect((await llamar()).cuerpo.rescates).toHaveLength(20);
    expect((await llamar()).cuerpo.rescates).toHaveLength(5);
    expect((await llamar()).cuerpo.rescates).toHaveLength(0);
  });

  it('`tope` del cuerpo lo baja', async () => {
    for (let i = 0; i < 4; i++) await sembrar(X, tel(100 + i), {}, []);
    expect((await llamar({ cuerpo: { v: 1, tope: 3 } })).cuerpo.rescates).toHaveLength(3);
  });
});

describe('lectura de candidatas y de mensajes', () => {
  it('100 conversaciones ya rescatadas que ocupan el inicio de la franja no dejan sin leer a la nueva', async () => {
    for (let i = 0; i < 4; i++) {
      const lote = db.batch();
      for (let j = 0; j < 25; j++) {
        const n = 80000 + i * 25 + j;
        lote.set(db.doc(`tenants/${X}/conversaciones/wa_591000${n}`), {
          telefono: `591000${n}`, phoneNumberId: NUM_X, ultimoEntranteEn: en(23 * HORA),
          rescate: { enviadoEn: en(30 * HORA), phoneNumberId: NUM_X, anclaMs: 0 },
        });
      }
      await lote.commit();
    }
    await sembrar(X, tel(11));
    expect((await llamar()).cuerpo.rescates.map((x: { telefono: string }) => x.telefono)).toEqual([tel(11)]);
  });

  const relleno = (n: number) => Array.from({ length: n }, (_, i) => (
    { direccion: 'saliente', tipo: 'text', texto: `relleno ${i}`, hace: SILENCIO_OK + (i + 1) * MIN }));

  it('una imagen entrante que es el mensaje 60 de la ventana excluye (límite MENSAJES_A_LEER)', async () => {
    await sembrar(X, tel(11), {}, [
      ...relleno(59), { direccion: 'entrante', tipo: 'image', texto: '', hace: SILENCIO_OK + 20 * HORA },
    ]);
    expect((await llamar()).cuerpo.rescates).toEqual([]);
    expect(await marca(X, tel(11))).toBeUndefined();
  });

  it('LÍMITE CONOCIDO: una imagen que es el mensaje 61 de la ventana ya no se lee', async () => {
    await sembrar(X, tel(11), {}, [
      ...relleno(60), { direccion: 'entrante', tipo: 'image', texto: '', hace: SILENCIO_OK + 20 * HORA },
    ]);
    expect((await llamar()).cuerpo.rescates).toHaveLength(1);
  });

  it('una imagen de hace más de 24 h antes del último mensaje del cliente no excluye', async () => {
    await sembrar(X, tel(11), {}, [
      { direccion: 'entrante', tipo: 'image', texto: '', hace: SILENCIO_OK + 25 * HORA },
      { direccion: 'entrante', tipo: 'text', texto: 'Hola, quiero ordenar mis ventas', hace: SILENCIO_OK + MIN },
    ]);
    expect((await llamar()).cuerpo.rescates).toHaveLength(1);
  });

  it('un «no me interesa» antiguo (mensaje 40 de la ventana) excluye', async () => {
    await sembrar(X, tel(11), {}, [
      ...relleno(39), { direccion: 'entrante', tipo: 'text', texto: 'No me interesa', hace: SILENCIO_OK + 10 * HORA },
    ]);
    expect((await llamar()).cuerpo.rescates).toEqual([]);
  });
});

describe('cuenta cortada', () => {
  it('con corte aplicable y sin cobertura: servicio_no_operativo y nada marcado', async () => {
    await sembrar(X, tel(11));
    await db.doc(`tenants/${X}/cuenta/estado`).set({ modalidad: 'prepago', corteActivo: true });
    const r = await llamar();
    expect(r.cuerpo).toEqual({ phoneNumberId: NUM_X, rescates: [], motivo: 'servicio_no_operativo' });
    expect(await marca(X, tel(11))).toBeUndefined();
  });

  it('una demostración nunca se corta', async () => {
    await sembrar(X, tel(11));
    await db.doc(`tenants/${X}/cuenta/estado`).set({ modalidad: 'demostracion', corteActivo: true });
    expect((await llamar()).cuerpo.rescates).toHaveLength(1);
  });
});

describe('bitácora', () => {
  it('un seguimiento_enviado con codigo «rescate» por cada marca, sin el teléfono completo ni texto', async () => {
    await sembrar(X, tel(11));
    await sembrar(X, tel(12));
    await sembrar(X, tel(13), { noContactar: true });
    expect((await llamar()).cuerpo.rescates).toHaveLength(2);
    const b = (await db.collection(`tenants/${X}/bitacora`).where('tipo', '==', 'seguimiento_enviado').get()).docs.map((d) => d.data());
    expect(b).toHaveLength(2);
    for (const e of b) {
      expect(e['codigo']).toBe('rescate');
      // El teléfono completo solo aparece en `conversacionId` (el id del documento, como en
      // `seguimientos.ts` y la ingesta); el destino va enmascarado y no hay texto.
      const { conversacionId, ...resto } = e;
      expect(conversacionId).toMatch(/^wa_/);
      const crudo = JSON.stringify(resto);
      expect(crudo).not.toContain('pastelería');
      expect(crudo).not.toContain(tel(11));
      expect(crudo).not.toContain(tel(12));
      expect(e['destinoEnmascarado']).toMatch(/\*/);
    }
  });
});
