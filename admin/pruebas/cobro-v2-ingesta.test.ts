/**
 * LA REGLA 2 DEL COBRO DE VENTA EN LA INGESTA, DE PUNTA A PUNTA (C1b, 03/10/2026).
 *
 * La función `ingesta` real y `registrarCierre` real, con su transacción,
 * contra el emulador de Firestore. La lógica pura del cobro está probada aparte
 * (`pruebas/modulos/cobros/cobro-v2.test.ts`); acá se prueba lo que solo se ve
 * con la base: que la ingesta la llama en TODO `qr_enviado`, que mezcla los
 * `cambios` después de lo de siempre, que las métricas viajan en la misma
 * escritura y que sin `reglaCobro` NADA cambia respecto de hoy.
 *
 * Contratos: `docs/arquitectura/modulos/cobros.md` §4duodecies.6.
 * Costo: 0 mensajes por conversación; 0 escrituras extra por mensaje.
 *
 * La petición se autentica con el token por número, igual que n8n (`firma.ts`);
 * el valor es de prueba, no un secreto.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN = 'valor-de-prueba-del-cobro-v2';
process.env['INGESTA_CLIENTE19'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const { ingesta } = await import('../functions/src/ingesta.ts');
const { cierreBloqueadoPorCobro } = await import('../functions/src/ingesta.ts');
const { registrarCierre } = await import('../functions/src/core/turno/cierres.ts');

const T = 'cobro-v2-ingesta';
const NUMERO = '1000000099';
const MES = new Date().toISOString().slice(0, 7);

interface Respuesta { codigo: number; cuerpo: unknown }

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
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; },
  };
  await (fn as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

const reportar = (cuerpo: Record<string, unknown>) =>
  llamar(ingesta, { direccion: 'saliente', tipo: 'image', texto: 'QR', ...cuerpo });

const metricas = async (): Promise<Record<string, number>> =>
  (await db.doc(`tenants/${T}/metricas/${MES}`).get()).data() as Record<string, number> ?? {};
const conversacion = async (tel: string): Promise<Record<string, unknown>> =>
  (await db.doc(`tenants/${T}/conversaciones/wa_${tel}`).get()).data() ?? {};
const solicitud = async (tel: string): Promise<Record<string, any> | undefined> =>
  (await conversacion(tel))['solicitud'] as Record<string, any> | undefined;
const ms = (v: unknown) => (v as { toMillis(): number }).toMillis();

/** Cuánto sumó cada contador de las métricas del mes mientras corría `fn`. */
async function delta(fn: () => Promise<unknown>): Promise<Record<string, number>> {
  const antes = await metricas();
  await fn();
  const despues = await metricas();
  const d: Record<string, number> = {};
  for (const k of new Set([...Object.keys(antes), ...Object.keys(despues)])) {
    const a = typeof antes[k] === 'number' ? antes[k] : 0;
    const b = despues[k];
    if (typeof b === 'number' && b !== a) d[k] = b - a;
  }
  return d;
}

/** Los campos que escribe una solicitud nueva HOY (sin ninguno de la regla 2). */
const CAMPOS_DE_HOY = [
  'aFavorDe', 'aFavorHasta', 'cotejos', 'desde', 'etapa', 'evento', 'monto',
  'qrEnviadoEn', 'reactivadaEn', 'seguimientoEn', 'seguimientos',
];
const CAMPOS_REGLA_2 = ['reglaCobro', 'venceEn', 'prorrogaHasta', 'intentosInvalidos', 'comprobantes', 'anulacionAvisadaEn', 'subidas'];

beforeAll(async () => {
  for (const c of ['conversaciones', 'bitacora', 'cierres']) {
    const previos = await db.collection(`tenants/${T}/${c}`).get();
    for (const d of previos.docs) await d.ref.delete();
  }
  await db.doc(`tenants/${T}/metricas/${MES}`).delete();
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({
    tenantId: T, flujo: 'venta', aliasSecreto: 'cliente19', estado: 'activo',
  });
  await db.doc(`tenants/${T}`).set({ nombre: 'Cobro v2', estado: 'activo', plan: 'basico' });
  await db.doc(`tenants/${T}/cuenta/estado`).set({ plan: 'impulso', estadoPago: 'al_dia' });
}, 120_000);

describe('EQUIVALENCIA: sin reglaCobro, la ingesta escribe lo de siempre', () => {
  it('agenda: la solicitud tiene exactamente los campos de hoy, ninguno de la regla 2, y suma senasEnviadas', async () => {
    const tel = '5910000001001';
    const d = await delta(async () => {
      expect((await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'evento-1', calendario: 'cal-1' })).codigo).toBe(200);
    });
    const s = await solicitud(tel);
    expect(Object.keys(s!).sort()).toEqual(CAMPOS_DE_HOY);
    expect(s).toMatchObject({ etapa: 'qr_enviado', evento: { id: 'evento-1', calendario: 'cal-1' }, monto: null,
      cotejos: 0, seguimientos: 0, seguimientoEn: null, reactivadaEn: null, aFavorHasta: null, aFavorDe: null });
    // Mismos contadores de siempre: el mensaje, el saliente de ese tipo y la seña.
    expect(d['senasEnviadas']).toBe(1);
    expect(Object.keys(d).filter((k) => /^cobros/.test(k))).toEqual([]);
  });

  it('venta: el total cotizado queda en solicitud.monto, con los mismos campos y la misma seña contada', async () => {
    const tel = '5910000001002';
    const d = await delta(async () => {
      await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_abc', monto: 200 });
    });
    const s = await solicitud(tel);
    expect(Object.keys(s!).sort()).toEqual(CAMPOS_DE_HOY);
    expect(s).toMatchObject({ etapa: 'qr_enviado', evento: { id: 'cat_abc', calendario: '' }, monto: 200 });
    expect(d['senasEnviadas']).toBe(1);
    expect(Object.keys(d).filter((k) => /^cobros/.test(k))).toEqual([]);
  });

  it('un reglaCobro que no es el número 2 se toma como regla 1, sin 400 y sin campos de regla 2', async () => {
    for (const [i, valor] of ([3, '2', 1, null, true, [2]] as unknown[]).entries()) {
      const tel = `591000000101${i}`;
      const r = await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_x', monto: 50, reglaCobro: valor, idMeta: 'wamid.X' });
      expect(r.codigo, String(valor)).toBe(200);
      const s = await solicitud(tel);
      expect(Object.keys(s!).sort(), String(valor)).toEqual(CAMPOS_DE_HOY);
    }
  });

  it('un reglaCobro: 2 que acompaña a OTRO evento se toma como regla 1: no abre cobro ni cuenta', async () => {
    const tel = '5910000001020';
    const d = await delta(async () => {
      expect((await reportar({ telefono: tel, evento: 'horarios_ofrecidos', reglaCobro: 2, idMeta: 'wamid.H' })).codigo).toBe(200);
    });
    const s = await solicitud(tel);
    expect(s!['etapa']).toBe('horarios');
    for (const c of CAMPOS_REGLA_2) expect(s, c).not.toHaveProperty(c);
    expect(Object.keys(d).filter((k) => /^cobros|^senas/.test(k))).toEqual([]);
  });
});

describe('regla 2: qr_enviado', () => {
  it('con idMeta abre el cobro: venceEn = envío + 15 min, cuenta cobrosQrEnviados y NO senasEnviadas', async () => {
    const tel = '5910000002001';
    const d = await delta(async () => {
      expect((await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_r2', monto: 120, reglaCobro: 2, idMeta: 'wamid.QR1' })).codigo).toBe(200);
    });
    const s = await solicitud(tel);
    expect(s).toMatchObject({ etapa: 'qr_enviado', reglaCobro: 2, intentosInvalidos: 0, comprobantes: [], subidas: [],
      prorrogaHasta: null, anulacionAvisadaEn: null, monto: 120, evento: { id: 'cat_r2', calendario: '' } });
    expect(ms(s!['venceEn']) - ms(s!['qrEnviadoEn'])).toBe(15 * 60_000);
    expect(d['cobrosQrEnviados']).toBe(1);
    expect(d['senasEnviadas']).toBeUndefined();
    // El mensaje se cuenta como siempre: 0 mensajes agregados o quitados.
    expect(d['mensajes']).toBe(1);
  });

  it('NIEGA: sin idMeta no abre cobro ni cuenta (ni solicitud, ni cobrosQrEnviados, ni senasEnviadas)', async () => {
    const tel = '5910000002002';
    const d = await delta(async () => {
      expect((await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_sin', monto: 90, reglaCobro: 2 })).codigo).toBe(200);
    });
    expect(await solicitud(tel)).toBeUndefined();
    expect(d['cobrosQrEnviados']).toBeUndefined();
    expect(d['senasEnviadas']).toBeUndefined();
    // El mensaje sí se contó: el QR salió o no, eso lo dice el flujo, no la ingesta.
    expect(d['mensajes']).toBe(1);
  });

  it('NIEGA: un reenvío (misma referencia y monto) no mueve venceEn, no vuelve a contar y conserva los intentos', async () => {
    const tel = '5910000002003';
    await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_re', monto: 75, reglaCobro: 2, idMeta: 'wamid.A' });
    const antes = (await solicitud(tel))!;
    // Un intento ya anotado: el reenvío no puede borrarlo.
    await db.doc(`tenants/${T}/conversaciones/wa_${tel}`).update({ 'solicitud.intentosInvalidos': 1 });
    await new Promise((r) => setTimeout(r, 15));
    const d = await delta(async () => {
      await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_re', monto: 75, reglaCobro: 2, idMeta: 'wamid.B' });
    });
    const despues = (await solicitud(tel))!;
    expect(ms(despues['venceEn'])).toBe(ms(antes['venceEn']));
    expect(ms(despues['qrEnviadoEn'])).toBe(ms(antes['qrEnviadoEn']));
    expect(despues['intentosInvalidos']).toBe(1);
    expect(d['cobrosQrEnviados']).toBeUndefined();
    expect(d['senasEnviadas']).toBeUndefined();
  });

  it('otro total u otro pedido es un cobro NUEVO, con plazo nuevo y cuenta de nuevo', async () => {
    const tel = '5910000002004';
    await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_n', monto: 75, reglaCobro: 2, idMeta: 'wamid.A' });
    const antes = (await solicitud(tel))!;
    await new Promise((r) => setTimeout(r, 15));
    const d = await delta(async () => {
      await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_n', monto: 80, reglaCobro: 2, idMeta: 'wamid.B' });
    });
    const despues = (await solicitud(tel))!;
    expect(ms(despues['venceEn'])).toBeGreaterThan(ms(antes['venceEn']));
    expect(despues['monto']).toBe(80);
    expect(d['cobrosQrEnviados']).toBe(1);
  });

  it('NIEGA: regla 1 después de regla 2 mezcla CAMPOS_REGLA_2_EN_NULO (el reglaCobro: 2 anterior no sobrevive)', async () => {
    const tel = '5910000002005';
    await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_a', monto: 60, reglaCobro: 2, idMeta: 'wamid.A' });
    expect((await solicitud(tel))!['reglaCobro']).toBe(2);
    const d = await delta(async () => {
      await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_b', monto: 61 });
    });
    const s = (await solicitud(tel))!;
    for (const c of CAMPOS_REGLA_2) expect(s[c], c).toBeNull();
    expect(s).toMatchObject({ etapa: 'qr_enviado', monto: 61, evento: { id: 'cat_b', calendario: '' } });
    // La regla 1 sigue contando la seña como siempre.
    expect(d['senasEnviadas']).toBe(1);
    expect(d['cobrosQrEnviados']).toBeUndefined();
  });
});

describe('regla 2: una solicitud nueva posterior no arrastra los restos', () => {
  it('NIEGA: una solicitud horarios posterior a un cobro de regla 2 no conserva reglaCobro/venceEn/prorrogaHasta/subidas/comprobantes', async () => {
    const tel = '5910000005001';
    await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_h', monto: 20, reglaCobro: 2, idMeta: 'wamid.H1' });
    // El cobro termina hace más de 24 h: una solicitud horarios nueva es posible.
    await db.doc(`tenants/${T}/conversaciones/wa_${tel}`).update({
      'solicitud.etapa': 'cancelada', 'solicitud.desde': Timestamp.fromMillis(Date.now() - 30 * 3_600_000) });
    expect((await reportar({ telefono: tel, evento: 'horarios_ofrecidos' })).codigo).toBe(200);
    const s = (await solicitud(tel))!;
    expect(s['etapa']).toBe('horarios');
    for (const c of CAMPOS_REGLA_2) expect(s[c], c).toBeNull();
  });
});

describe('regla 2: cobro_cancelado y anulacion_avisada', () => {
  it('cobro_cancelado cancela el cobro abierto y cuenta cobrosCancelados', async () => {
    const tel = '5910000003001';
    await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_c', monto: 40, reglaCobro: 2, idMeta: 'wamid.C' });
    const d = await delta(async () => {
      expect((await reportar({ telefono: tel, direccion: 'entrante', tipo: 'text', texto: 'cancelar', evento: 'cobro_cancelado' })).codigo).toBe(200);
    });
    expect((await solicitud(tel))!['etapa']).toBe('cancelada');
    expect(d['cobrosCancelados']).toBe(1);
  });

  it('NIEGA: cobro_cancelado sobre una solicitud de regla 1 no toca nada', async () => {
    const tel = '5910000003002';
    await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_d', monto: 40 });
    const antes = (await solicitud(tel))!;
    const d = await delta(async () => {
      expect((await reportar({ telefono: tel, evento: 'cobro_cancelado' })).codigo).toBe(200);
    });
    const despues = (await solicitud(tel))!;
    expect(despues['etapa']).toBe('qr_enviado');
    expect(ms(despues['desde'])).toBe(ms(antes['desde']));
    expect(d['cobrosCancelados']).toBeUndefined();
  });

  it('NIEGA: cobro_cancelado sin ninguna solicitud no crea una', async () => {
    const tel = '5910000003003';
    expect((await reportar({ telefono: tel, evento: 'cobro_cancelado' })).codigo).toBe(200);
    expect(await solicitud(tel)).toBeUndefined();
  });

  it('anulacion_avisada materializa el vencimiento perezoso: vencida, con el aviso anotado, una sola vez', async () => {
    const tel = '5910000003004';
    await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_e', monto: 40, reglaCobro: 2, idMeta: 'wamid.E' });
    // Nadie lo anotó, pero el plazo ya pasó: vence por reloj.
    const hace = Timestamp.fromMillis(Date.now() - 20 * 60_000);
    await db.doc(`tenants/${T}/conversaciones/wa_${tel}`).update({
      'solicitud.venceEn': hace, 'solicitud.qrEnviadoEn': Timestamp.fromMillis(Date.now() - 35 * 60_000) });
    const d = await delta(async () => {
      expect((await reportar({ telefono: tel, evento: 'anulacion_avisada' })).codigo).toBe(200);
    });
    const s = (await solicitud(tel))!;
    expect(s['etapa']).toBe('vencida');
    expect(s['anulacionAvisadaEn']).not.toBeNull();
    expect(ms(s['desde'])).toBe(ms(hace));
    expect(d['cobrosVencidos']).toBe(1);
    // Repetido: no vuelve a contar ni a mover nada.
    const d2 = await delta(async () => { await reportar({ telefono: tel, evento: 'anulacion_avisada' }); });
    expect(d2['cobrosVencidos']).toBeUndefined();
  });
});

describe('regla 2: cita_agendada (registrarCierre) no resucita un cobro que ya no está en curso', () => {
  const cerrar = (tel: string, referencia: string) =>
    llamar(registrarCierre, { tipo: 'cita', referencia, telefono: tel });

  async function abrir(tel: string, ref: string) {
    await reportar({ telefono: tel, evento: 'qr_enviado', referencia: ref, monto: 30, reglaCobro: 2, idMeta: `wamid.${ref}` });
  }

  it('NIEGA: sobre en_revision, cancelada y vencida (escrita) la etapa no pasa a agendada', async () => {
    const casos: Array<[string, string]> = [['5910000004001', 'en_revision'], ['5910000004002', 'cancelada'], ['5910000004003', 'vencida']];
    for (const [tel, etapa] of casos) {
      await abrir(tel, `cat_${etapa}`);
      await db.doc(`tenants/${T}/conversaciones/wa_${tel}`).update({ 'solicitud.etapa': etapa });
      expect((await cerrar(tel, `ev-${etapa}`)).codigo, etapa).toBe(200);
      expect((await solicitud(tel))!['etapa'], etapa).toBe(etapa);
    }
  });

  it('NIEGA: sobre un qr_enviado vencido por reloj (nadie lo anotó) tampoco pasa a agendada', async () => {
    const tel = '5910000004004';
    await abrir(tel, 'cat_reloj');
    await db.doc(`tenants/${T}/conversaciones/wa_${tel}`).update({
      'solicitud.venceEn': Timestamp.fromMillis(Date.now() - 60_000) });
    expect((await cerrar(tel, 'ev-reloj')).codigo).toBe(200);
    expect((await solicitud(tel))!['etapa']).toBe('qr_enviado');
  });

  it('un cobro de regla 2 todavía a tiempo SÍ se cierra como agendada, y la regla 1 no cambia', async () => {
    const tel = '5910000004005';
    await abrir(tel, 'cat_ok');
    await cerrar(tel, 'ev-ok');
    expect((await solicitud(tel))!['etapa']).toBe('agendada');
    const tel1 = '5910000004006';
    await reportar({ telefono: tel1, evento: 'qr_enviado', referencia: 'ev-1', calendario: 'cal' });
    await cerrar(tel1, 'ev-1b');
    expect((await solicitud(tel1))!['etapa']).toBe('agendada');
  });
});

describe('regla 2: el camino ignorado y sus bordes', () => {
  const abrir = (tel: string, ref: string, monto = 30) =>
    reportar({ telefono: tel, evento: 'qr_enviado', referencia: ref, monto, reglaCobro: 2, idMeta: `wamid.${ref}.${monto}` });
  const fijar = (tel: string, campos: Record<string, unknown>) =>
    db.doc(`tenants/${T}/conversaciones/wa_${tel}`).update(campos);

  it('NIEGA: un qr_enviado del MISMO pedido sobre un cobro en_revision lo deja intacto y no cuenta; un pedido DISTINTO abre un cobro nuevo', async () => {
    const tel = '5910000006001';
    await abrir(tel, 'cat_rev');
    await fijar(tel, { 'solicitud.etapa': 'en_revision', 'solicitud.intentosInvalidos': 3 });
    const antes = (await solicitud(tel))!;
    const d = await delta(async () => {
      await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_rev', monto: 30, reglaCobro: 2, idMeta: 'wamid.OTRO' });
    });
    const despues = (await solicitud(tel))!;
    expect(despues).toEqual(antes);
    expect(d['cobrosQrEnviados']).toBeUndefined();
    expect(d['senasEnviadas']).toBeUndefined();
    const d2 = await delta(async () => { await abrir(tel, 'cat_rev_2', 55); });
    const nuevo = (await solicitud(tel))!;
    expect(nuevo).toMatchObject({ etapa: 'qr_enviado', intentosInvalidos: 0, monto: 55, evento: { id: 'cat_rev_2' } });
    expect(d2['cobrosQrEnviados']).toBe(1);
  });

  it('NIEGA: un sin_id_meta CON solicitud previa no la toca', async () => {
    const tel = '5910000006002';
    await abrir(tel, 'cat_prev');
    const antes = (await solicitud(tel))!;
    const d = await delta(async () => {
      await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_otro', monto: 99, reglaCobro: 2 });
    });
    expect(await solicitud(tel)).toEqual(antes);
    expect(d['cobrosQrEnviados']).toBeUndefined();
    expect(d['senasEnviadas']).toBeUndefined();
  });

  it('NIEGA: con regla 2, una referencia vacía o igual al idMeta no abre cobro (se trata como sin_id_meta)', async () => {
    for (const [i, cuerpo] of ([
      { monto: 30 }, { referencia: 'wamid.IGUAL', monto: 30 },
    ] as Array<Record<string, unknown>>).entries()) {
      const tel = `591000000600${3 + i}`;
      const d = await delta(async () => {
        await reportar({ telefono: tel, evento: 'qr_enviado', reglaCobro: 2, idMeta: 'wamid.IGUAL', ...cuerpo });
      });
      expect(await solicitud(tel), String(i)).toBeUndefined();
      expect(d['cobrosQrEnviados'], String(i)).toBeUndefined();
    }
  });

  it('NIEGA: horarios_ofrecidos, aun pasadas 24 h, NO reemplaza un cobro en_revision (conserva comprobantes y subidas)', async () => {
    const tel = '5910000006005';
    await abrir(tel, 'cat_hr');
    await fijar(tel, { 'solicitud.etapa': 'en_revision', 'solicitud.desde': Timestamp.fromMillis(Date.now() - 30 * 3_600_000),
      'solicitud.subidas': [{ idMeta: 'wamid.S', ruta: 'x' }] });
    expect((await reportar({ telefono: tel, evento: 'horarios_ofrecidos' })).codigo).toBe(200);
    const s = (await solicitud(tel))!;
    expect(s['etapa']).toBe('en_revision');
    expect(s['reglaCobro']).toBe(2);
    expect(s['subidas']).toEqual([{ idMeta: 'wamid.S', ruta: 'x' }]);
  });

  it('registrarCierre tipo venta en modo SIMULADO (sin cobro real) sobre cada etapa bloqueada: la etapa no se mueve y el cierre se crea', async () => {
    const casos: Array<[string, string]> = [['5910000006006', 'en_revision'], ['5910000006007', 'cancelada'], ['5910000006008', 'vencida']];
    for (const [tel, etapa] of casos) {
      await abrir(tel, `cat_v_${etapa}`);
      await fijar(tel, { 'solicitud.etapa': etapa });
      const d = await delta(async () => {
        expect((await llamar(registrarCierre, { tipo: 'venta', referencia: `v-${etapa}`, telefono: tel })).codigo, etapa).toBe(200);
      });
      expect((await solicitud(tel))!['etapa'], etapa).toBe(etapa);
      // Sin cobro real, quien cierra la venta es `registrarCierre`.
      expect(d['cierres'], etapa).toBe(1);
    }
  });

  it('reactivada con cambios parciales del cobro: escribe reactivadaEn y cuenta UNA vez', async () => {
    const tel = '5910000006009';
    await abrir(tel, 'cat_re2');
    await fijar(tel, { 'solicitud.seguimientoEn': Timestamp.fromMillis(Date.now() - 3_600_000), 'solicitud.seguimientos': 1 });
    const d = await delta(async () => {
      await reportar({ telefono: tel, direccion: 'entrante', tipo: 'text', texto: 'cancelar', evento: 'cobro_cancelado' });
    });
    const s = (await solicitud(tel))!;
    expect(s['etapa']).toBe('cancelada');
    expect(s['reactivadaEn']).not.toBeNull();
    expect(d['reactivadas']).toBe(1);
    const d2 = await delta(async () => {
      await reportar({ telefono: tel, direccion: 'entrante', tipo: 'text', texto: 'hola', evento: 'cobro_cancelado' });
    });
    expect(d2['reactivadas']).toBeUndefined();
  });
});

describe('cierreBloqueadoPorCobro (puro)', () => {
  const ahora = Date.now();
  const r2 = (etapa: string, venceEnMs: number) => ({ etapa, reglaCobro: 2, venceEn: Timestamp.fromMillis(venceEnMs) });
  it('regla 2: en_revision, cancelada, vencida y qr_enviado vencido por reloj bloquean', () => {
    for (const e of ['en_revision', 'cancelada', 'vencida']) expect(cierreBloqueadoPorCobro(r2(e, ahora + 60_000), ahora), e).toBe(true);
    expect(cierreBloqueadoPorCobro(r2('qr_enviado', ahora - 1), ahora)).toBe(true);
    expect(cierreBloqueadoPorCobro(r2('qr_enviado', ahora), ahora)).toBe(true);
  });
  it('NIEGA: a tiempo, agendada, regla 1 y entradas raras no bloquean', () => {
    expect(cierreBloqueadoPorCobro(r2('qr_enviado', ahora + 60_000), ahora)).toBe(false);
    expect(cierreBloqueadoPorCobro(r2('agendada', ahora - 60_000), ahora)).toBe(false);
    expect(cierreBloqueadoPorCobro({ etapa: 'en_revision' }, ahora)).toBe(false);
    expect(cierreBloqueadoPorCobro({ etapa: 'vencida', reglaCobro: null }, ahora)).toBe(false);
    for (const v of [null, undefined, 'x', 3]) expect(cierreBloqueadoPorCobro(v, ahora)).toBe(false);
  });
});

describe('registrarCierre de venta con COBRO REAL de regla 2: solo cierra el cotejo', () => {
  const COBRO_REAL = { activo: true, ficha: 'ficha-de-prueba', cargaUtil: 'carga-de-prueba', nombreCuenta: 'Tienda' };
  const refVenta = db.doc(`tenants/${T}/config/venta`);
  const abrir = (tel: string, ref: string) =>
    reportar({ telefono: tel, evento: 'qr_enviado', referencia: ref, monto: 30, reglaCobro: 2, idMeta: `wamid.${ref}` });
  const fijar = (tel: string, campos: Record<string, unknown>) =>
    db.doc(`tenants/${T}/conversaciones/wa_${tel}`).update(campos);
  const cerrar = (tel: string, referencia: string, tipo = 'venta') =>
    llamar(registrarCierre, { tipo, referencia, telefono: tel });
  const conCobroReal = async (fn: () => Promise<void>) => {
    await refVenta.set({ cobroReal: COBRO_REAL });
    try { await fn(); } finally { await refVenta.delete(); }
  };

  it('NIEGA: regla 2, cobro real, qr_enviado en plazo: 409, sin cierre y sin sumar cierres', async () => {
    const tel = '5910000007001';
    await abrir(tel, 'cat_real');
    await conCobroReal(async () => {
      const d = await delta(async () => { expect((await cerrar(tel, 'v-real')).codigo).toBe(409); });
      expect(d['cierres']).toBeUndefined();
      expect((await db.doc(`tenants/${T}/cierres/venta_v-real`).get()).exists).toBe(false);
      expect((await solicitud(tel))!['etapa']).toBe('qr_enviado');
    });
  });

  it('NIEGA: regla 2, cobro real, en_revision, cancelada y vencida: 409 y sin cierre', async () => {
    const casos: Array<[string, string]> = [['5910000007002', 'en_revision'], ['5910000007003', 'cancelada'], ['5910000007004', 'vencida']];
    for (const [tel, etapa] of casos) {
      await abrir(tel, `cat_r_${etapa}`);
      await fijar(tel, { 'solicitud.etapa': etapa });
      await conCobroReal(async () => {
        const d = await delta(async () => { expect((await cerrar(tel, `v-r-${etapa}`)).codigo, etapa).toBe(409); });
        expect(d['cierres'], etapa).toBeUndefined();
        expect((await solicitud(tel))!['etapa'], etapa).toBe(etapa);
      });
    }
  });

  it('el modo SIMULADO (sin cobro real) sigue cerrando por registrarCierre, también en regla 2', async () => {
    const tel = '5910000007005';
    await abrir(tel, 'cat_sim');
    const d = await delta(async () => { expect((await cerrar(tel, 'v-sim')).codigo).toBe(200); });
    expect(d['cierres']).toBe(1);
    expect((await solicitud(tel))!['etapa']).toBe('agendada');
  });

  it('EQUIVALENCIA: sin reglaCobro (regla 1), con cobro real, registrarCierre cierra y mueve la solicitud como siempre', async () => {
    const tel = '5910000007006';
    await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'cat_r1', monto: 30 });
    await conCobroReal(async () => {
      const d = await delta(async () => { expect((await cerrar(tel, 'v-r1')).codigo).toBe(200); });
      expect(d['cierres']).toBe(1);
    });
    expect((await solicitud(tel))!['etapa']).toBe('agendada');
  });
});

describe('el bloqueo de un cierre dura 24 h: pasado el plazo es otra conversación', () => {
  const abrir = (tel: string, ref: string) =>
    reportar({ telefono: tel, evento: 'qr_enviado', referencia: ref, monto: 30, reglaCobro: 2, idMeta: `wamid.${ref}` });
  const venceHace = (tel: string, horas: number, extra: Record<string, unknown> = {}) =>
    db.doc(`tenants/${T}/conversaciones/wa_${tel}`).update({
      'solicitud.venceEn': Timestamp.fromMillis(Date.now() - horas * 3_600_000), ...extra });

  it('NIEGA: un cierre de cita 2 días después de una vencida SÍ pasa a agendada, sin restos de regla 2', async () => {
    const tel = '5910000008001';
    await abrir(tel, 'cat_dias');
    await venceHace(tel, 48, { 'solicitud.etapa': 'vencida' });
    expect((await llamar(registrarCierre, { tipo: 'cita', referencia: 'ev-dias', telefono: tel })).codigo).toBe(200);
    const s = (await solicitud(tel))!;
    expect(s['etapa']).toBe('agendada');
    for (const c of CAMPOS_REGLA_2) expect(s[c], c).toBeNull();
  });

  it('dentro de las 24 h del límite sigue bloqueado; pasadas, también un qr_enviado vencido por reloj cierra', async () => {
    const dentro = '5910000008002';
    await abrir(dentro, 'cat_dentro');
    await venceHace(dentro, 23, { 'solicitud.etapa': 'vencida' });
    await llamar(registrarCierre, { tipo: 'cita', referencia: 'ev-dentro', telefono: dentro });
    expect((await solicitud(dentro))!['etapa']).toBe('vencida');
    const fuera = '5910000008003';
    await abrir(fuera, 'cat_fuera');
    await venceHace(fuera, 25);
    await llamar(registrarCierre, { tipo: 'cita', referencia: 'ev-fuera', telefono: fuera });
    expect((await solicitud(fuera))!['etapa']).toBe('agendada');
  });

  it('el predicado: en_revision bloquea SIEMPRE (no vence por reloj); cancelada y vencida, solo 24 h desde el límite', () => {
    const ahora = Date.now();
    const rev = (hace: number) => ({ etapa: 'en_revision', reglaCobro: 2, venceEn: Timestamp.fromMillis(ahora - 99 * 3_600_000),
      desde: Timestamp.fromMillis(ahora - hace * 3_600_000) });
    for (const h of [1, 23, 25, 240]) expect(cierreBloqueadoPorCobro(rev(h), ahora), String(h)).toBe(true);
    const ven = (etapa: string, hace: number) => ({ etapa, reglaCobro: 2, venceEn: Timestamp.fromMillis(ahora - hace * 3_600_000) });
    for (const e of ['vencida', 'cancelada']) {
      expect(cierreBloqueadoPorCobro(ven(e, 23), ahora), e).toBe(true);
      expect(cierreBloqueadoPorCobro(ven(e, 25), ahora), e).toBe(false);
    }
    expect(cierreBloqueadoPorCobro(ven('qr_enviado', 25), ahora)).toBe(false);
  });
});

describe('referencia contra idMeta, con espacios', () => {
  it('NIEGA: con regla 2, una referencia igual al idMeta aunque este traiga espacios no abre cobro', async () => {
    const tel = '5910000009001';
    const d = await delta(async () => {
      await reportar({ telefono: tel, evento: 'qr_enviado', referencia: 'wamid.ESP', monto: 30, reglaCobro: 2, idMeta: '  wamid.ESP  ' });
    });
    expect(await solicitud(tel)).toBeUndefined();
    expect(d['cobrosQrEnviados']).toBeUndefined();
  });
});

describe('registrarCierre con cobro real: bordes del bloqueo, tipo cita y teléfono', () => {
  const COBRO_REAL = { activo: true, ficha: 'ficha-de-prueba', cargaUtil: 'carga-de-prueba', nombreCuenta: 'Tienda' };
  const refVenta = db.doc(`tenants/${T}/config/venta`);
  const abrir = (tel: string, ref: string) =>
    reportar({ telefono: tel, evento: 'qr_enviado', referencia: ref, monto: 30, reglaCobro: 2, idMeta: `wamid.${ref}` });
  const fijar = (tel: string, campos: Record<string, unknown>) =>
    db.doc(`tenants/${T}/conversaciones/wa_${tel}`).update(campos);
  const cerrar = (tel: string | undefined, referencia: string, tipo: string) =>
    llamar(registrarCierre, { tipo, referencia, ...(tel !== undefined ? { telefono: tel } : {}) });
  const conConfig = async (cobroReal: Record<string, unknown>, fn: () => Promise<void>) => {
    await refVenta.set({ cobroReal });
    try { await fn(); } finally { await refVenta.delete(); }
  };
  const hace = (h: number) => Timestamp.fromMillis(Date.now() - h * 3_600_000);

  it('NIEGA: en_revision de 25 h y de 10 días, con cobro real: venta 409 sin cierre; cita no mueve la solicitud ni borra comprobantes y subidas', async () => {
    for (const [tel, horas] of [['5910000010001', 25], ['5910000010002', 240]] as Array<[string, number]>) {
      await abrir(tel, `cat_rv_${horas}`);
      await fijar(tel, { 'solicitud.etapa': 'en_revision', 'solicitud.desde': hace(horas), 'solicitud.venceEn': hace(horas + 1),
        'solicitud.comprobantes': [{ idMeta: 'wamid.C1', estado: 'invalido' }], 'solicitud.subidas': [{ idMeta: 'wamid.C1', ruta: 'x' }] });
      await conConfig(COBRO_REAL, async () => {
        const d = await delta(async () => { expect((await cerrar(tel, `v-rv-${horas}`, 'venta')).codigo, String(horas)).toBe(409); });
        expect(d['cierres'], String(horas)).toBeUndefined();
        expect((await db.doc(`tenants/${T}/cierres/venta_v-rv-${horas}`).get()).exists).toBe(false);
        // El cierre de la cita se registra (su propio conteo) sin mover la solicitud.
        expect((await cerrar(tel, `c-rv-${horas}`, 'cita')).codigo).toBe(200);
      });
      const s = (await solicitud(tel))!;
      expect(s['etapa'], String(horas)).toBe('en_revision');
      expect(s['comprobantes'], String(horas)).toEqual([{ idMeta: 'wamid.C1', estado: 'invalido' }]);
      expect(s['subidas'], String(horas)).toEqual([{ idMeta: 'wamid.C1', ruta: 'x' }]);
    }
  });

  it('con cobro real y el bloqueo vencido (más de 24 h): cancelada, vencida y qr_enviado vencido cierran con 200', async () => {
    const casos: Array<[string, string]> = [['5910000010003', 'cancelada'], ['5910000010004', 'vencida'], ['5910000010005', 'qr_enviado']];
    for (const [tel, etapa] of casos) {
      await abrir(tel, `cat_bv_${etapa}`);
      await fijar(tel, { 'solicitud.etapa': etapa, 'solicitud.venceEn': hace(30) });
      await conConfig(COBRO_REAL, async () => {
        const d = await delta(async () => { expect((await cerrar(tel, `v-bv-${etapa}`, 'venta')).codigo, etapa).toBe(200); });
        expect(d['cierres'], etapa).toBe(1);
      });
      expect((await solicitud(tel))!['etapa'], etapa).toBe('agendada');
    }
  });

  it('un cobroReal sin ficha o sin cargaUtil NO es cobro real: la venta cierra con 200', async () => {
    const casos: Array<[string, Record<string, unknown>]> = [
      ['5910000010006', { activo: true, cargaUtil: 'c' }], ['5910000010007', { activo: true, ficha: 'f' }],
      ['5910000010008', { activo: false, ficha: 'f', cargaUtil: 'c' }],
    ];
    for (const [tel, cfg] of casos) {
      await abrir(tel, `cat_sf_${tel}`);
      await conConfig(cfg, async () => {
        expect((await cerrar(tel, `v-sf-${tel}`, 'venta')).codigo, tel).toBe(200);
      });
    }
  });

  it('NIEGA: cierre tipo cita sobre un qr_enviado de regla 2 a tiempo con cobro real: la solicitud no se mueve, la cita sí se registra', async () => {
    const tel = '5910000010009';
    await abrir(tel, 'cat_cita');
    await conConfig(COBRO_REAL, async () => {
      const d = await delta(async () => { expect((await cerrar(tel, 'c-cita', 'cita')).codigo).toBe(200); });
      expect(d['cierres']).toBe(1);
    });
    expect((await solicitud(tel))!['etapa']).toBe('qr_enviado');
    expect((await solicitud(tel))!['reglaCobro']).toBe(2);
    expect((await db.doc(`tenants/${T}/cierres/cita_c-cita`).get()).exists).toBe(true);
  });

  it('EQUIVALENCIA: la cita ordinaria (regla 1, y regla 2 en modo simulado) sigue pasando a agendada', async () => {
    const t1 = '5910000010010';
    await reportar({ telefono: t1, evento: 'qr_enviado', referencia: 'ev-eq', calendario: 'cal' });
    await conConfig(COBRO_REAL, async () => { expect((await cerrar(t1, 'c-eq1', 'cita')).codigo).toBe(200); });
    expect((await solicitud(t1))!['etapa']).toBe('agendada');
    const t2 = '5910000010011';
    await abrir(t2, 'cat_eq2');
    expect((await cerrar(t2, 'c-eq2', 'cita')).codigo).toBe(200);
    expect((await solicitud(t2))!['etapa']).toBe('agendada');
  });

  it('NIEGA: con cobro real, una venta sin teléfono o con teléfono inválido responde 400 y no cierra; sin cobro real, 200 como siempre', async () => {
    await conConfig(COBRO_REAL, async () => {
      for (const tel of [undefined, 'abc', '123']) {
        const d = await delta(async () => { expect((await cerrar(tel, `v-sin-${tel ?? 'nada'}`, 'venta')).codigo, String(tel)).toBe(400); });
        expect(d['cierres'], String(tel)).toBeUndefined();
      }
    });
    expect((await cerrar(undefined, 'v-sin-real', 'venta')).codigo).toBe(200);
  });
});
