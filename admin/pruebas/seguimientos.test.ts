/**
 * RECORDATORIO DE SOLICITUD PENDIENTE — la decisión pura y las Functions reales.
 *
 * Acá se prueba MANDARLE UN MENSAJE A ALGUIEN QUE NO ESCRIBIÓ. Es lo más
 * delicado que hace el sistema: un recordatorio de más no lo corrige nadie —la
 * persona ya lo leyó— y lo que se arriesga es el número de WhatsApp del
 * comercio, que es su canal entero. Por eso la suite está escrita NEGANDO: la
 * mayoría de los casos comprueban que NO se escribe.
 *
 *   1. `esPendienteDeSeguimiento`, caso por caso: quién entra, y sobre todo
 *      quién no. Es pura y no necesita emulador.
 *   2. `solicitudTras` con las etapas nuevas (`horarios`, `cita_agendada`) y
 *      `reactivaTras`, que es lo que cuenta si el recordatorio sirvió.
 *   3. `seguimientosPendientes` contra el emulador: devuelve SOLO lo que
 *      corresponde, con todos los descartes sembrados a la vez.
 *   4. `seguimientoEnviado` es idempotente: la segunda llamada contesta
 *      `repetido` y no vuelve a contar ni deja mandar otra vez.
 *
 * Las reglas —quién puede escribir `noContactar`, qué etapas admite la
 * solicitud, qué contadores acepta el mes— se prueban en `reglas.test.ts`,
 * §7bis, con el arnés de reglas.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Alias reservado que ninguna otra suite usa. Valor de prueba, no un secreto.
const TOKEN = 'valor-de-prueba-de-los-seguimientos';
process.env['INGESTA_CLIENTE20'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const { seguimientosPendientes, seguimientoEnviado, esPendienteDeSeguimiento, VENTANAS } =
  await import('../functions/src/seguimientos.ts');
const { solicitudTras, reactivaTras } = await import('../functions/src/ingesta.ts');

const T = 'seg-clinica';
const NUMERO = '1000000098';
const MES = new Date().toISOString().slice(0, 7);
const HORA = 60 * 60 * 1000;

interface Respuesta { codigo: number; cuerpo: unknown }

/** Llama a una Function HTTP como lo hace n8n: token por número en la cabecera. */
async function llamar(fn: unknown, cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': NUMERO, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
  };
  const r: Respuesta = { codigo: 0, cuerpo: null };
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
  await (fn as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

// ---------------------------------------------------------------------------
// 1. LA DECISIÓN PURA
// ---------------------------------------------------------------------------

const AHORA = Date.UTC(2026, 8, 17, 15, 0, 0);
/** Una conversación con la solicitud pendiente y el silencio que se le pida. */
const conv = (horasDeSilencio: number, extra: Record<string, unknown> = {}) => ({
  ultimoEn: Timestamp.fromMillis(AHORA - horasDeSilencio * HORA),
  atencionEstado: 'normal',
  solicitud: {
    etapa: 'horarios', desde: Timestamp.fromMillis(AHORA - horasDeSilencio * HORA),
    qrEnviadoEn: null, evento: null, cotejos: 0, seguimientos: 0,
    seguimientoEn: null, reactivadaEn: null,
  },
  ...extra,
});

describe('1. esPendienteDeSeguimiento: quién entra, y sobre todo quién no', () => {
  it('las dos ventanas, con sus dos modos', () => {
    expect(esPendienteDeSeguimiento(conv(2), AHORA)).toBe('texto');
    expect(esPendienteDeSeguimiento(conv(3), AHORA)).toBe('texto');
    expect(esPendienteDeSeguimiento(conv(24), AHORA)).toBe('plantilla');
    expect(esPendienteDeSeguimiento(conv(47), AHORA)).toBe('plantilla');
  });

  it('los bordes son cerrados abajo y abiertos arriba, sin superponerse', () => {
    expect(VENTANAS.texto).toEqual({ desde: 2 * HORA, hasta: 4 * HORA });
    expect(VENTANAS.plantilla).toEqual({ desde: 24 * HORA, hasta: 48 * HORA });
    expect(esPendienteDeSeguimiento(conv(1.99), AHORA)).toBeNull();
    expect(esPendienteDeSeguimiento(conv(4), AHORA)).toBeNull();
    expect(esPendienteDeSeguimiento(conv(23.99), AHORA)).toBeNull();
    expect(esPendienteDeSeguimiento(conv(48), AHORA)).toBeNull();
  });

  it('NO se le escribe a quien está entre las 4 y las 24 horas, ni a los tres días', () => {
    for (const horas of [5, 8, 12, 20, 23, 72, 24 * 30]) {
      expect(esPendienteDeSeguimiento(conv(horas), AHORA), `${horas} h`).toBeNull();
    }
  });

  it('NO a quien ya agendó, ni a una retención vencida, ni a una etapa inventada', () => {
    for (const etapa of ['agendada', 'vencida', 'elegido', '']) {
      expect(esPendienteDeSeguimiento(conv(3, { solicitud: { etapa, seguimientos: 0 } }), AHORA), etapa)
        .toBeNull();
    }
    // Y la seña pendiente SÍ entra: es el otro estado a medio camino.
    expect(esPendienteDeSeguimiento(
      conv(3, { solicitud: { etapa: 'qr_enviado', seguimientos: 0 } }), AHORA)).toBe('texto');
  });

  it('NUNCA dos veces a la misma solicitud', () => {
    expect(esPendienteDeSeguimiento(
      conv(3, { solicitud: { etapa: 'horarios', seguimientos: 1 } }), AHORA)).toBeNull();
    expect(esPendienteDeSeguimiento(
      conv(30, { solicitud: { etapa: 'horarios', seguimientos: 1 } }), AHORA)).toBeNull();
    // Y si el contador viniera con basura tampoco: ante la duda, no se escribe.
    for (const seguimientos of [undefined, null, '0', -1, Number.NaN]) {
      expect(esPendienteDeSeguimiento(
        conv(3, { solicitud: { etapa: 'horarios', seguimientos } }), AHORA)).toBeNull();
    }
  });

  it('NUNCA a quien pidió que no le escriban', () => {
    expect(esPendienteDeSeguimiento(conv(3, { noContactar: true }), AHORA)).toBeNull();
    expect(esPendienteDeSeguimiento(conv(30, { noContactar: true }), AHORA)).toBeNull();
    // `false` y ausente no bloquean nada: solo el `true` explícito.
    expect(esPendienteDeSeguimiento(conv(3, { noContactar: false }), AHORA)).toBe('texto');
  });

  it('NUNCA a un teléfono en operador o bloqueado', () => {
    expect(esPendienteDeSeguimiento(conv(3, { atencionEstado: 'operador' }), AHORA)).toBeNull();
    expect(esPendienteDeSeguimiento(conv(3, { atencionEstado: 'bloqueado' }), AHORA)).toBeNull();
    expect(esPendienteDeSeguimiento(conv(30, { atencionEstado: 'operador' }), AHORA)).toBeNull();
  });

  it('sin solicitud, sin fecha del último mensaje o sin documento, no se escribe', () => {
    expect(esPendienteDeSeguimiento(conv(3, { solicitud: undefined }), AHORA)).toBeNull();
    expect(esPendienteDeSeguimiento(conv(3, { solicitud: 'horarios' }), AHORA)).toBeNull();
    expect(esPendienteDeSeguimiento(conv(3, { ultimoEn: undefined }), AHORA)).toBeNull();
    expect(esPendienteDeSeguimiento(conv(3, { ultimoEn: 'ayer' }), AHORA)).toBeNull();
    expect(esPendienteDeSeguimiento(null, AHORA)).toBeNull();
    expect(esPendienteDeSeguimiento(undefined, AHORA)).toBeNull();
  });

  it('un `ultimoEn` en el futuro —reloj torcido— no dispara nada', () => {
    expect(esPendienteDeSeguimiento(conv(-1), AHORA)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. LAS ETAPAS NUEVAS DE LA SOLICITUD
// ---------------------------------------------------------------------------

const previa = (etapa: string, desdeMs: number, extra: Record<string, unknown> = {}) => ({
  etapa, desde: Timestamp.fromMillis(desdeMs), qrEnviadoEn: null, evento: null,
  cotejos: 0, seguimientos: 0, seguimientoEn: null, reactivadaEn: null, ...extra,
});

describe('2. solicitudTras con las etapas del seguimiento', () => {
  it('`horarios_ofrecidos` sin solicitud previa abre una en `horarios`, con todo en cero', () => {
    const s = solicitudTras(undefined, 'horarios_ofrecidos', AHORA, {});
    expect(s).toEqual({
      etapa: 'horarios', desde: Timestamp.fromMillis(AHORA), qrEnviadoEn: null,
      evento: null, cotejos: 0, seguimientos: 0, seguimientoEn: null, reactivadaEn: null,
    });
  });

  it('sobre una `horarios` ya abierta NO mueve nada: el reloj del recordatorio no se reinicia', () => {
    // Si `desde` se moviera con cada turno que ofrece horarios, una
    // conversación larga no cumpliría nunca las 2 h y el recordatorio no
    // saldría jamás. Se devuelve `null`: la solicitud guardada no se toca.
    expect(solicitudTras(previa('horarios', AHORA - 3 * HORA), 'horarios_ofrecidos', AHORA, {})).toBeNull();
  });

  it('sobre una seña pendiente tampoco: la seña manda', () => {
    expect(solicitudTras(previa('qr_enviado', AHORA - HORA), 'horarios_ofrecidos', AHORA, {})).toBeNull();
  });

  it('sobre una cerrada hace menos de 24 h no abre nada; hace más, sí', () => {
    for (const etapa of ['agendada', 'vencida']) {
      expect(solicitudTras(previa(etapa, AHORA - 3 * HORA), 'horarios_ofrecidos', AHORA, {}), etapa)
        .toBeNull();
      const nueva = solicitudTras(previa(etapa, AHORA - 25 * HORA), 'horarios_ofrecidos', AHORA, {});
      expect(nueva?.etapa, etapa).toBe('horarios');
      expect(nueva?.seguimientos, etapa).toBe(0);
    }
  });

  it('`cita_agendada` cierra la pendiente y conserva lo que ya se hizo sobre ella', () => {
    const s = solicitudTras(
      previa('horarios', AHORA - 5 * HORA, { seguimientos: 1, seguimientoEn: Timestamp.fromMillis(AHORA - HORA) }),
      'cita_agendada', AHORA, {});
    expect(s?.etapa).toBe('agendada');
    expect(s?.desde).toEqual(Timestamp.fromMillis(AHORA));
    // El seguimiento ya salió: no se olvida, o la próxima solicitud que
    // reutilizara este documento podría mandar otro.
    expect(s?.seguimientos).toBe(1);
  });

  it('`cita_agendada` es idempotente sobre una ya agendada, y nace `agendada` si no había nada', () => {
    expect(solicitudTras(previa('agendada', AHORA - HORA), 'cita_agendada', AHORA, {})).toBeNull();
    expect(solicitudTras(undefined, 'cita_agendada', AHORA, {})?.etapa).toBe('agendada');
  });

  it('`no_contactar` no toca la solicitud: solo enciende la lista de no molestar', () => {
    expect(solicitudTras(previa('horarios', AHORA - HORA), 'no_contactar', AHORA, {})).toBeNull();
    expect(solicitudTras(undefined, 'no_contactar', AHORA, {})).toBeNull();
  });

  it('`qr_enviado` sigue abriendo una solicitud nueva, con el seguimiento en cero', () => {
    const s = solicitudTras(
      previa('horarios', AHORA - 5 * HORA, { seguimientos: 1 }), 'qr_enviado', AHORA,
      { referencia: 'ev1', calendario: 'agenda@ejemplo.com' });
    expect(s?.etapa).toBe('qr_enviado');
    expect(s?.seguimientos).toBe(0);
    expect(s?.seguimientoEn).toBeNull();
    expect(s?.evento).toEqual({ id: 'ev1', calendario: 'agenda@ejemplo.com' });
  });
});

describe('2bis. reactivaTras: el paciente que vuelve después del recordatorio', () => {
  const conSeguimiento = (haceMs: number, reactivadaEn: unknown = null) =>
    previa('horarios', AHORA - 30 * HORA, {
      seguimientos: 1, seguimientoEn: Timestamp.fromMillis(AHORA - haceMs), reactivadaEn,
    });

  it('un entrante dentro de las 24 h del seguimiento cuenta una reactivación', () => {
    expect(reactivaTras(conSeguimiento(2 * HORA), 'entrante', AHORA)).toBe(true);
  });

  it('pero SOLO el primero: el segundo mensaje del mismo paciente no cuenta otra', () => {
    expect(reactivaTras(conSeguimiento(2 * HORA, Timestamp.fromMillis(AHORA - HORA)), 'entrante', AHORA))
      .toBe(false);
  });

  it('no cuenta un saliente, ni después de las 24 h, ni sin seguimiento previo', () => {
    expect(reactivaTras(conSeguimiento(2 * HORA), 'saliente', AHORA)).toBe(false);
    expect(reactivaTras(conSeguimiento(25 * HORA), 'entrante', AHORA)).toBe(false);
    expect(reactivaTras(previa('horarios', AHORA - HORA), 'entrante', AHORA)).toBe(false);
    expect(reactivaTras(undefined, 'entrante', AHORA)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3 y 4. LAS FUNCTIONS REALES
// ---------------------------------------------------------------------------

/** Siembra una conversación con el silencio y los campos que se le pidan. */
async function sembrar(tel: string, horas: number, extra: Record<string, unknown> = {}) {
  const ms = Date.now() - horas * HORA;
  await db.doc(`tenants/${T}/conversaciones/wa_${tel}`).set({
    telefono: tel, canal: 'whatsapp', nombreContacto: `Paciente ${tel.slice(-1)}`,
    ultimoMensaje: 'Y el jueves?', ultimoEn: Timestamp.fromMillis(ms), mensajesTotal: 4,
    atencionEstado: 'normal',
    solicitud: {
      etapa: 'horarios', desde: Timestamp.fromMillis(ms), qrEnviadoEn: null, evento: null,
      cotejos: 0, seguimientos: 0, seguimientoEn: null, reactivadaEn: null,
    },
    ...extra,
  });
}

const conversacion = async (tel: string) =>
  (await db.doc(`tenants/${T}/conversaciones/wa_${tel}`).get()).data() ?? {};
const metricas = async () => (await db.doc(`tenants/${T}/metricas/${MES}`).get()).data() ?? {};
const bitacora = async (tipo: string) =>
  (await db.collection(`tenants/${T}/bitacora`).where('tipo', '==', tipo).get()).docs.map((d) => d.data());

// Teléfonos de prueba, todos del rango reservado de la documentación.
const EN_VENTANA = '59170000001';      // 3 h → texto
const FUERA = '59170000002';           // 30 h → plantilla
const CON_SENA = '59170000003';        // 3 h, etapa qr_enviado → texto, con importe
const YA_SEGUIDO = '59170000004';      // 3 h pero seguimientos: 1
const NO_CONTACTAR = '59170000005';    // 3 h y noContactar
const EN_OPERADOR = '59170000006';     // 3 h y atencionEstado operador
const AGENDADO = '59170000007';        // 3 h pero ya agendó
const RECIEN = '59170000008';          // 40 min: todavía no
const LIMBO = '59170000009';           // 10 h: entre las dos ventanas
// Los teléfonos de prueba llevan SEIS ceros seguidos a propósito: es la forma
// que `scripts/verificar-saneo.sh` reconoce como inventada. Por eso el décimo
// y el undécimo cambian de prefijo en vez de seguir la numeración.
const VIEJO = '59160000001';           // 5 días: ya no
const SIN_SOLICITUD = '59160000002';   // una conversación sin solicitud

beforeAll(async () => {
  for (const c of ['conversaciones', 'bitacora']) {
    for (const d of (await db.collection(`tenants/${T}/${c}`).get()).docs) await d.ref.delete();
  }
  await db.doc(`tenants/${T}/metricas/${MES}`).delete();
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({
    tenantId: T, flujo: 'agendamiento', aliasSecreto: 'cliente20', estado: 'activo',
  });
  await db.doc(`tenants/${T}`).set({ nombre: 'Clínica', estado: 'activo', flujos: ['agendamiento'] });
  await db.doc(`tenants/${T}/config/negocio`).set({ nombreNegocio: 'Clínica', moneda: 'BOB' });
  await db.doc(`tenants/${T}/config/agendamiento`).set({ senaImporte: 50 });

  await sembrar(EN_VENTANA, 3);
  await sembrar(FUERA, 30);
  await sembrar(CON_SENA, 3, {
    solicitud: {
      etapa: 'qr_enviado', desde: Timestamp.fromMillis(Date.now() - 3 * HORA),
      qrEnviadoEn: Timestamp.fromMillis(Date.now() - 3 * HORA),
      evento: { id: 'ev-77', calendario: 'agenda@ejemplo.com' },
      cotejos: 0, seguimientos: 0, seguimientoEn: null, reactivadaEn: null,
    },
  });
  await sembrar(YA_SEGUIDO, 3, {
    solicitud: {
      etapa: 'horarios', desde: Timestamp.fromMillis(Date.now() - 3 * HORA), qrEnviadoEn: null,
      evento: null, cotejos: 0, seguimientos: 1,
      seguimientoEn: Timestamp.fromMillis(Date.now() - HORA), reactivadaEn: null,
    },
  });
  await sembrar(NO_CONTACTAR, 3, { noContactar: true });
  await sembrar(EN_OPERADOR, 3, { atencionEstado: 'operador' });
  await sembrar(AGENDADO, 3, {
    solicitud: {
      etapa: 'agendada', desde: Timestamp.fromMillis(Date.now() - 3 * HORA), qrEnviadoEn: null,
      evento: null, cotejos: 0, seguimientos: 0, seguimientoEn: null, reactivadaEn: null,
    },
  });
  await sembrar(RECIEN, 0.66);
  await sembrar(LIMBO, 10);
  await sembrar(VIEJO, 24 * 5);
}, 120_000);

describe('3. seguimientosPendientes devuelve SOLO lo que corresponde', () => {
  let pendientes: Record<string, unknown>[] = [];

  it('lista los tres que están a medio camino, y ninguno más', async () => {
    const r = await llamar(seguimientosPendientes, {});
    expect(r.codigo).toBe(200);
    pendientes = (r.cuerpo as { pendientes: Record<string, unknown>[] }).pendientes;
    const telefonos = pendientes.map((p) => p['telefono']).sort();
    expect(telefonos).toEqual([EN_VENTANA, FUERA, CON_SENA].sort());
  });

  it('ninguno de los siete descartes aparece, y cada uno por su motivo', () => {
    const telefonos = pendientes.map((p) => p['telefono']);
    for (const [tel, motivo] of [
      [YA_SEGUIDO, 'ya recibió su recordatorio'],
      [NO_CONTACTAR, 'pidió que no le escriban'],
      [EN_OPERADOR, 'está con una persona'],
      [AGENDADO, 'ya agendó'],
      [RECIEN, 'escribió hace 40 minutos'],
      [LIMBO, 'está entre las dos ventanas'],
      [VIEJO, 'escribió hace cinco días'],
    ] as [string, string][]) {
      expect(telefonos, motivo).not.toContain(tel);
    }
  });

  it('cada pendiente trae su modo, su etapa y el nombre del contacto', () => {
    const porTelefono = Object.fromEntries(pendientes.map((p) => [p['telefono'], p]));
    expect(porTelefono[EN_VENTANA]).toMatchObject({ modo: 'texto', etapa: 'horarios' });
    expect(porTelefono[FUERA]).toMatchObject({ modo: 'plantilla', etapa: 'horarios' });
    expect(porTelefono[CON_SENA]).toMatchObject({
      modo: 'texto', etapa: 'qr_enviado', importe: 50,
      evento: { id: 'ev-77', calendario: 'agenda@ejemplo.com' },
    });
    expect(String(porTelefono[EN_VENTANA]?.['nombreContacto'])).toContain('Paciente');
    // `ultimoEn` viaja como ISO: el flujo arma la fecha del mensaje con él.
    expect(String(porTelefono[FUERA]?.['ultimoEn'])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('sin token, ni GET, ni nada: 401 y 405', async () => {
    const r = await llamar(seguimientosPendientes, {});
    expect(r.codigo).toBe(200);     // control positivo del arnés
    const sinAuth = { method: 'POST', body: {}, headers: {}, get: () => undefined, header: () => undefined };
    let codigo = 0;
    const respuesta = {
      status(c: number) { codigo = c; return respuesta; },
      send() { return respuesta; }, json() { return respuesta; },
      setHeader() { return respuesta; }, getHeader() { return undefined; },
      set() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; },
    };
    await (seguimientosPendientes as unknown as (q: unknown, s: unknown) => Promise<void>)(sinAuth, respuesta);
    expect(codigo).toBe(401);
  });
});

describe('4. seguimientoEnviado marca una sola vez', () => {
  it('la primera marca cuenta el seguimiento y anota cuándo salió', async () => {
    const r = await llamar(seguimientoEnviado, { telefono: EN_VENTANA, modo: 'texto', idMeta: 'wamid.sg1' });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toMatchObject({ marcado: true, repetido: false });
    const s = (await conversacion(EN_VENTANA))['solicitud'] as Record<string, unknown>;
    expect(s['seguimientos']).toBe(1);
    expect(s['seguimientoEn']).not.toBeNull();
    // Y lo que ya tenía la solicitud sigue ahí.
    expect(s['etapa']).toBe('horarios');
    expect((await metricas())['seguimientos']).toBe(1);
    expect(await bitacora('seguimiento_enviado')).toEqual([
      expect.objectContaining({ codigo: 'texto', resultado: 'ok' }),
    ]);
  });

  it('la segunda contesta `repetido` y no cuenta ni marca de nuevo', async () => {
    const antes = (await conversacion(EN_VENTANA))['solicitud'] as Record<string, unknown>;
    const r = await llamar(seguimientoEnviado, { telefono: EN_VENTANA, modo: 'texto' });
    expect(r.cuerpo).toMatchObject({ marcado: false, repetido: true });
    const despues = (await conversacion(EN_VENTANA))['solicitud'] as Record<string, unknown>;
    expect(despues['seguimientos']).toBe(1);
    expect(despues['seguimientoEn']).toEqual(antes['seguimientoEn']);
    expect((await metricas())['seguimientos']).toBe(1);
    expect(await bitacora('seguimiento_enviado')).toHaveLength(1);
  });

  it('y ese teléfono ya no vuelve a salir en la lista', async () => {
    const r = await llamar(seguimientosPendientes, {});
    const telefonos = (r.cuerpo as { pendientes: Record<string, unknown>[] })
      .pendientes.map((p) => p['telefono']);
    expect(telefonos).not.toContain(EN_VENTANA);
    expect(telefonos).toContain(FUERA);
  });

  it('sin solicitud no marca nada: no se inventa una para poder escribir', async () => {
    await db.doc(`tenants/${T}/conversaciones/wa_${SIN_SOLICITUD}`).set({
      telefono: SIN_SOLICITUD, canal: 'whatsapp', ultimoEn: Timestamp.now(), mensajesTotal: 1,
    });
    const r = await llamar(seguimientoEnviado, { telefono: SIN_SOLICITUD, modo: 'texto' });
    expect(r.cuerpo).toMatchObject({ marcado: false, motivo: 'sin_solicitud' });
    expect((await conversacion(SIN_SOLICITUD))['solicitud']).toBeUndefined();
  });

  it('rechaza un teléfono o un modo que no son', async () => {
    expect((await llamar(seguimientoEnviado, { telefono: 'abc', modo: 'texto' })).codigo).toBe(400);
    expect((await llamar(seguimientoEnviado, { telefono: FUERA, modo: 'carta' })).codigo).toBe(400);
    expect((await llamar(seguimientoEnviado, { telefono: FUERA })).codigo).toBe(400);
    // Y nada de eso movió la solicitud de FUERA.
    const s = (await conversacion(FUERA))['solicitud'] as Record<string, unknown>;
    expect(s['seguimientos']).toBe(0);
  });
});
