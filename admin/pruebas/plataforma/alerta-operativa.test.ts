/**
 * ALERTA OPERATIVA («envío incierto»): `functions/src/plataforma/alertaOperativa.ts`, probada NEGANDO.
 *
 * Sin emulador ni red: el almacén es de memoria con la MISMA semántica que el de Firestore (reserva
 * atómica de cupo, `create` que falla si existe) y el envío es un doble que registra lo que habría ido a
 * Resend. Las reglas de Firestore se prueban aparte (`alerta-operativa-reglas.test.ts`, con emulador).
 * Valores sintéticos: el secreto de abajo existe solo en esta prueba.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  TOPE_DIARIO, inmediatosDe, topeValido, atenderAlerta, armarCorreo, armarResumen, enviarPorResend, enviarResumenDiario, sanearTexto,
  validarEvento, verificarFirmaAlerta,
  type AlmacenAlertas, type Enviar, type Envio, type EventoGuardado,
} from '../../functions/src/plataforma/alertaOperativa.ts';

const SECRETO = 'secreto-de-prueba-solo-para-esta-suite';
const AHORA = Date.parse('2026-11-07T15:00:00Z');
const HOSTS = ['consola.ejemplo.test'];
const HORA = 3_600_000;

function almacenEnMemoria(): AlmacenAlertas & { eventos: Map<string, EventoGuardado>; dias: Map<string, number>; tipos: Map<string, number> } {
  const eventos = new Map<string, EventoGuardado>();
  const dias = new Map<string, number>();
  const tipos = new Map<string, number>();
  return {
    eventos, dias, tipos,
    async crear(e) { if (eventos.has(e.id_unico)) return false; eventos.set(e.id_unico, { ...e }); return true; },
    async poner(id, estado) { const e = eventos.get(id); if (e) e.estado = estado; },
    async reservar(tipo, dia, ahora, tope) {
      const usados = dias.get(dia) ?? 0;
      const ultimo = tipos.has(tipo) ? tipos.get(tipo)! : null;
      if (usados >= inmediatosDe(tope) || (ultimo !== null && ahora - ultimo < HORA)) return { ok: false, previoUltimoMs: ultimo };
      dias.set(dia, usados + 1); tipos.set(tipo, ahora);
      return { ok: true, previoUltimoMs: ultimo };
    },
    async liberar(tipo, dia, previo) { dias.set(dia, Math.max(0, (dias.get(dia) ?? 0) - 1)); tipos.set(tipo, previo ?? 0); },
    async desde(ms) { return [...eventos.values()].filter((e) => e.ocurrido_ms >= ms); },
  };
}

const buenEvento = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  nivel: 'critico', proyecto: 'novuchat', asunto: 'Envío incierto en un flujo',
  que_paso: 'Un flujo con relé terminó con error en el nodo de envío.',
  que_se_espera_de_andres: 'Revisar el flujo en n8n y reintentar si hace falta.',
  enlace: 'docs/produccion/error-workflow-envio-incierto.md',
  ocurrido_en: '2026-11-07T14:59:00Z', id_unico: 'evt-0001-abcdef', tipo_error: 'envio_incierto',
  flujo: 'demo-a', nodo: 'Enviar respuesta', ...extra,
});

function firmar(cuerpo: unknown, marca = AHORA, secreto = SECRETO): { crudo: Buffer; cabeceras: Record<string, string> } {
  const crudo = Buffer.from(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo));
  const firma = createHmac('sha256', secreto).update(`${marca}.`).update(crudo).digest('hex');
  return { crudo, cabeceras: { 'x-novuchat-alerta-timestamp': String(marca), 'x-novuchat-alerta-signature': `sha256=${firma}` } };
}

function llamar(
  almacen: AlmacenAlertas, enviar: Enviar | null, cuerpo: unknown,
  op: { marca?: number; secreto?: string; sinFirma?: boolean; ahora?: number; metodo?: string; tope?: number } = {},
) {
  const f = firmar(cuerpo, op.marca ?? AHORA, op.secreto ?? SECRETO);
  const cab: Record<string, string> = op.sinFirma ? {} : f.cabeceras;
  return atenderAlerta(
    { metodo: op.metodo ?? 'POST', cabecera: (n) => cab[n.toLowerCase()], crudo: f.crudo },
    { almacen, enviar, secreto: SECRETO, hostsEnlace: HOSTS, ahoraMs: op.ahora ?? AHORA, ...(op.tope !== undefined ? { tope: op.tope } : {}) });
}

const envioFalso = () => {
  const enviados: Envio[] = [];
  const enviar: Enviar = async (e) => { enviados.push(e); };
  return { enviados, enviar };
};

describe('firma HMAC propia', () => {
  it('sin firma, con firma de otro secreto, vieja o futura: 401 y no se guarda ni se envía nada', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    for (const op of [
      { sinFirma: true }, { secreto: 'otro-secreto' }, { marca: AHORA - 3 * 60_000 }, { marca: AHORA + 3 * 60_000 },
    ]) {
      const r = await llamar(a, enviar, buenEvento(), op);
      expect(r.status).toBe(401);
      expect(r.cuerpo).toBe('no autorizado');
    }
    expect(a.eventos.size).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it('cuerpo alterado después de firmar: 401; firma mal formada: 401; método distinto de POST: 405', async () => {
    const a = almacenEnMemoria(); const { enviar } = envioFalso();
    const f = firmar(buenEvento());
    const alterado = Buffer.from(f.crudo.toString().replace('demo-a', 'demo-b'));
    const r = await atenderAlerta(
      { metodo: 'POST', cabecera: (n) => f.cabeceras[n.toLowerCase()], crudo: alterado },
      { almacen: a, enviar, secreto: SECRETO, hostsEnlace: HOSTS, ahoraMs: AHORA });
    expect(r.status).toBe(401);
    expect(verificarFirmaAlerta(SECRETO, String(AHORA), 'sha256=zz', f.crudo, AHORA)).toBe(false);
    expect(verificarFirmaAlerta(SECRETO, String(AHORA), `sha256=${'0'.repeat(64)}`, f.crudo, AHORA)).toBe(false);
    expect(verificarFirmaAlerta('', String(AHORA), f.cabeceras['x-novuchat-alerta-signature']!, f.crudo, AHORA)).toBe(false);
    expect((await llamar(a, enviar, buenEvento(), { metodo: 'GET' })).status).toBe(405);
    expect(a.eventos.size).toBe(0);
  });

  it('con firma válida dentro de la ventana: 200 y la firma de ingesta (por número) no aplica', async () => {
    const a = almacenEnMemoria(); const { enviar } = envioFalso();
    expect((await llamar(a, enviar, buenEvento(), { marca: AHORA - 60_000 })).status).toBe(200);
    // Una firma con la forma de ingesta (cabeceras X-NovuChat-Signature) no es esta firma.
    const f = firmar(buenEvento());
    const r = await atenderAlerta(
      { metodo: 'POST', cabecera: (n) => ({ 'x-novuchat-timestamp': String(AHORA), 'x-novuchat-signature': f.cabeceras['x-novuchat-alerta-signature']! } as Record<string, string>)[n.toLowerCase()], crudo: f.crudo },
      { almacen: almacenEnMemoria(), enviar, secreto: SECRETO, hostsEnlace: HOSTS, ahoraMs: AHORA });
    expect(r.status).toBe(401);
  });
});

describe('contrato y sin PII', () => {
  it('un campo fuera del contrato (telefono, ejecucion, texto_cliente) se rechaza y no se guarda', async () => {
    for (const extra of [{ telefono: '59171234567' }, { ejecucion: '98765432' }, { texto_cliente: 'hola' }, { tenantId: 'x' }]) {
      const a = almacenEnMemoria();
      const r = await llamar(a, null, buenEvento(extra));
      expect(r.status, JSON.stringify(extra)).toBe(400);
      expect(a.eventos.size).toBe(0);
    }
  });

  it('falta un campo, nivel o proyecto inválidos, id_unico que parece id de ejecución: 400', () => {
    for (const mal of [
      { asunto: undefined }, { nivel: 'urgente' }, { proyecto: 'wam' }, { ocurrido_en: '07/11/2026' },
      { id_unico: '123456789' }, { id_unico: 'abc' }, { tipo_error: 'Tiene Espacios' },
    ]) {
      expect(() => validarEvento(buenEvento(mal), HOSTS), JSON.stringify(mal)).toThrow();
    }
  });

  it('teléfonos en cualquier formato, correos, uuid y ids largos en los textos libres se saneados', () => {
    const sucios = [
      'Falló el envío a 59171234567', 'Falló el envío a +591 7123 4567', 'Cliente 712-34567 sin respuesta',
      'escribió juan@correo.test', 'ejecución 8765432', 'id 3f2c1b7a-1111-4222-8333-444455556666',
      'hash 0123456789abcdef0123',
    ];
    for (const t of sucios) {
      const { evento, saneado } = validarEvento(buenEvento({ que_paso: t }), HOSTS);
      expect(saneado, t).toBe(true);
      expect(evento.que_paso, t).toContain('[omitido]');
      expect(evento.que_paso, t).not.toMatch(/\d{6,}|@|[0-9a-f]{16}/);
    }
    // En los tres textos libres, no solo en uno.
    const e = validarEvento(buenEvento({ asunto: 'a 59171234567', que_se_espera_de_andres: 'llamar al 71234567' }), HOSTS).evento;
    expect(JSON.stringify(e)).not.toMatch(/\d{6,}/);
    expect(sanearTexto('Todo bien, nodo 3').saneado).toBe(false);
  });

  it('un campo estructural (flujo, nodo, tipo_error) con un dato personal se RECHAZA, no se sanea', () => {
    for (const mal of [{ flujo: '59171234567' }, { nodo: 'a@b.test' }, { flujo: 'x'.repeat(61) }, { tipo_error: 'error_59171234567' }]) {
      expect(() => validarEvento(buenEvento(mal), HOSTS), JSON.stringify(mal)).toThrowError(/dato_personal|tipo_error_invalido/);
    }
  });

  it('un texto largo (suele ser el de un cliente) se rechaza con 422', async () => {
    const a = almacenEnMemoria();
    const r = await llamar(a, null, buenEvento({ que_paso: 'palabra '.repeat(40) }));
    expect(r.status).toBe(422);
    expect(a.eventos.size).toBe(0);
  });

  it('el enlace es solo consola o runbook: URL interna, http, IP, host no listado o con puerto se rechazan', () => {
    for (const mal of [
      'http://consola.ejemplo.test/x', 'https://10.0.0.5/x', 'https://localhost/x', 'https://n8n.internal/x',
      'https://otro.test/x', 'https://consola.ejemplo.test:5678/x', 'https://u:p@consola.ejemplo.test/x',
      'docs/../secreto', '/etc/passwd', 'javascript:alert(1)',
    ]) {
      expect(() => validarEvento(buenEvento({ enlace: mal }), HOSTS), mal).toThrowError(/enlace_invalido/);
    }
    expect(validarEvento(buenEvento({ enlace: 'https://consola.ejemplo.test/plataforma' }), HOSTS).evento.enlace).toContain('https://');
    // Sin hosts configurados, ninguna URL pasa: solo el runbook relativo.
    expect(() => validarEvento(buenEvento({ enlace: 'https://consola.ejemplo.test/x' }), [])).toThrow();
  });

  it('el evento guardado y el correo no llevan ningún dato personal aunque el llamador lo intentó', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    await llamar(a, enviar, buenEvento({ que_paso: 'Falló para 59171234567 (juan@correo.test)' }));
    const guardado = JSON.stringify([...a.eventos.values()]);
    const correo = JSON.stringify(enviados);
    for (const v of [guardado, correo]) expect(v).not.toMatch(/59171234567|juan@/);
  });
});

describe('topes, agrupado e idempotencia', () => {
  it('1 correo inmediato por hora por tipo: el segundo del mismo tipo va al resumen, otro tipo sale', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'evt-a-000001' }))).cuerpo).toBe('enviado');
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'evt-a-000002' }), { ahora: AHORA + 30 * 60_000, marca: AHORA + 30 * 60_000 })).cuerpo).toBe('en_resumen');
    expect(a.eventos.get('evt-a-000002')!.estado).toBe('en_resumen');
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'evt-b-000001', tipo_error: 'otro_tipo' }))).cuerpo).toBe('enviado');
    expect(enviados).toHaveLength(2);
    // Pasada la hora, el mismo tipo vuelve a salir.
    const t = AHORA + 61 * 60_000;
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'evt-a-000003' }), { ahora: t, marca: t })).cuerpo).toBe('enviado');
  });

  it('tope diario: 5 por día en total (4 inmediatos + 1 del resumen); desde el quinto crítico todo va al resumen', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    const estados: string[] = [];
    for (let i = 0; i < 8; i++) {
      estados.push((await llamar(a, enviar, buenEvento({ id_unico: `evt-tope-${i}00000`, tipo_error: `tipo_${i}` }))).cuerpo);
    }
    expect(estados.filter((s) => s === 'enviado')).toHaveLength(inmediatosDe(TOPE_DIARIO));
    expect(estados.slice(inmediatosDe(TOPE_DIARIO)).every((s) => s === 'en_resumen')).toBe(true);
    expect(enviados).toHaveLength(4);
    expect(a.eventos.size).toBe(8); // nada se pierde
    // Un día nuevo reinicia el cupo.
    const manana = AHORA + 24 * HORA;
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'evt-tope-manana', tipo_error: 'tipo_9' }), { ahora: manana, marca: manana })).cuerpo).toBe('enviado');
  });

  it('el tope sale de la configuración (plataforma/alertas.topeDiario), no está fijo en el código', async () => {
    for (const [tope, esperados] of [[8, 7], [3, 2], [1, 0]] as const) {
      const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
      for (let i = 0; i < 10; i++) {
        await llamar(a, enviar, buenEvento({ id_unico: `evt-cfg-${tope}-${i}0000`, tipo_error: `tipo_${i}` }), { tope });
      }
      expect(enviados, `tope ${tope}`).toHaveLength(esperados);
      expect(a.eventos.size).toBe(10);
    }
    // Valores inválidos o ausentes caen al 5 por defecto; nunca abren el tope.
    for (const mal of [undefined, 0, -3, 4.5, 51, '8', null, NaN]) expect(topeValido(mal), String(mal)).toBe(5);
    expect(topeValido(8)).toBe(8);
    // Sin configuración, `atenderAlerta` usa el 5 por defecto: 4 inmediatos.
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    for (let i = 0; i < 9; i++) await llamar(a, enviar, buenEvento({ id_unico: `evt-def-${i}00000`, tipo_error: `tipo_${i}` }));
    expect(enviados).toHaveLength(4);
  });

  it('solo el nivel crítico manda correo inmediato: aviso e info van al resumen', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    expect((await llamar(a, enviar, buenEvento({ nivel: 'aviso' }))).cuerpo).toBe('en_resumen');
    expect((await llamar(a, enviar, buenEvento({ nivel: 'info', id_unico: 'evt-info-0001' }))).cuerpo).toBe('en_resumen');
    expect(enviados).toHaveLength(0);
  });

  it('idempotencia: el mismo id_unico no se guarda ni se reenvía, aunque pase la hora', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    expect((await llamar(a, enviar, buenEvento())).cuerpo).toBe('enviado');
    const t = AHORA + 2 * HORA;
    expect((await llamar(a, enviar, buenEvento(), { ahora: t, marca: t })).cuerpo).toBe('duplicado');
    expect(enviados).toHaveLength(1);
    expect(a.eventos.size).toBe(1);
    expect(enviados[0]!.idempotencia).toBe('evt-0001-abcdef');
  });

  it('el envío falla: el evento NO se pierde, queda envio_fallido y el cupo no se gasta', async () => {
    const a = almacenEnMemoria();
    const enviar: Enviar = async () => { throw new Error('resend_500'); };
    const r = await llamar(a, enviar, buenEvento());
    expect(r.status).toBe(200);
    expect(r.cuerpo).toBe('envio_fallido');
    expect(a.eventos.get('evt-0001-abcdef')!.estado).toBe('envio_fallido');
    expect(a.dias.get('2026-11-07')).toBe(0);                       // el tope no cuenta el que falló
    expect(a.tipos.get('envio_incierto')).toBe(0);                  // y la hora del tipo se devuelve
    // Un crítico del mismo tipo, justo después, SÍ puede salir: no quedó bloqueado por el fallo.
    const { enviados, enviar: bien } = envioFalso();
    expect((await llamar(a, bien, buenEvento({ id_unico: 'evt-0002-abcdef' }))).cuerpo).toBe('enviado');
    expect(enviados).toHaveLength(1);
  });

  it('sin remitente ni destinatario configurados guarda el evento y no envía', async () => {
    const a = almacenEnMemoria();
    expect((await llamar(a, null, buenEvento())).cuerpo).toBe('en_resumen');
    expect(a.eventos.size).toBe(1);
  });
});

describe('correo y resumen diario', () => {
  it('lo esencial está en los primeros 400 caracteres, en español y sin voseo', () => {
    const peor = validarEvento(buenEvento({
      asunto: 'x'.repeat(70), que_paso: 'y'.repeat(150), que_se_espera_de_andres: 'z'.repeat(130),
    }), HOSTS).evento;
    const t = armarCorreo(peor).texto;
    const cabeza = t.slice(0, 400);
    expect(cabeza).toContain('Se espera de Andres');
    expect(cabeza).toContain('Qué pasó');
    expect(cabeza).toContain('z'.repeat(130));
    expect(t).not.toMatch(/\b(tenés|querés|podés|revisá|vos)\b/i);
  });

  it('el resumen sale con 0 eventos y lo dice («0 errores en 24 h»)', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    const r = await enviarResumenDiario({ almacen: a, enviar, ahoraMs: AHORA });
    expect(r).toEqual({ eventos: 0, enviado: true });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.asunto).toContain('0 errores en 24 h');
    expect(enviados[0]!.texto).toContain('latido');
    expect(enviados[0]!.idempotencia).toBe('resumen-2026-11-07');
  });

  it('el resumen con eventos cuenta por tipo y solo toma las últimas 24 h', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    await llamar(a, null, buenEvento({ id_unico: 'evt-r-000001' }));
    await llamar(a, null, buenEvento({ id_unico: 'evt-r-000002', tipo_error: 'otro_tipo' }));
    await llamar(a, null, buenEvento({ id_unico: 'evt-r-viejo01', ocurrido_en: '2026-11-05T10:00:00Z' }));
    await enviarResumenDiario({ almacen: a, enviar, ahoraMs: AHORA });
    expect(enviados[0]!.asunto).toContain('2 errores en 24 h');
    expect(enviados[0]!.texto).toContain('- envio_incierto: 1');
    expect(armarResumen([], AHORA).asunto).toContain('0 errores');
  });

  it('si el envío del resumen falla, lanza (el programador reintenta) y no se traga el error', async () => {
    const a = almacenEnMemoria();
    await expect(enviarResumenDiario({ almacen: a, enviar: async () => { throw new Error('resend_503'); }, ahoraMs: AHORA })).rejects.toThrow('resend_503');
  });
});

describe('Resend y secretos', () => {
  it('la llamada a Resend lleva Idempotency-Key = id_unico y la clave solo en Authorization', async () => {
    const f = vi.fn(async (_u: string, _i: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    try {
      await enviarPorResend('clave-de-prueba-xyz', 'NovuChat <a@dominio.test>', 'dest@dominio.test')(armarCorreo(validarEvento(buenEvento(), HOSTS).evento));
      const [url, init] = f.mock.calls[0]!;
      expect(url).toBe('https://api.resend.com/emails');
      const h = init.headers as Record<string, string>;
      expect(h['Idempotency-Key']).toBe('evt-0001-abcdef');
      expect(h['Authorization']).toBe('Bearer clave-de-prueba-xyz');
      expect(String(init.body)).not.toContain('clave-de-prueba-xyz');
    } finally { vi.unstubAllGlobals(); }
  });

  it('ningún valor de secreto, cuerpo ni respuesta de Resend llega a los registros', async () => {
    const logs: string[] = [];
    const espias = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...x: unknown[]) => { logs.push(x.map(String).join(' ')); }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('cuerpo-secreto-de-resend', { status: 422 })));
    try {
      const a = almacenEnMemoria();
      const enviar = enviarPorResend('clave-de-prueba-xyz', 'N <a@dominio.test>', 'dest@dominio.test');
      await llamar(a, enviar, buenEvento({ que_paso: 'Falló para 59171234567' }));              // envío que falla
      await llamar(a, enviar, buenEvento({ id_unico: 'evt-x-000001' }), { sinFirma: true });    // firma ausente
      await llamar(a, enviar, '{no es json', {});                                                // firma válida, cuerpo roto
      const alm = { ...almacenEnMemoria(), crear: async () => { throw new Error(`boom ${SECRETO} 59171234567`); } };
      const r = await llamar(alm, enviar, buenEvento({ id_unico: 'evt-y-000001' }));            // fallo interno
      expect(r.status).toBe(500);
      expect(r.cuerpo).toBe('error');
    } finally { espias.forEach((e) => e.mockRestore()); vi.unstubAllGlobals(); }
    const todo = logs.join('\n');
    for (const prohibido of [SECRETO, 'clave-de-prueba-xyz', 'cuerpo-secreto-de-resend', '59171234567', 'dest@dominio.test']) {
      expect(todo).not.toContain(prohibido);
    }
  });

  it('el código no escribe dominios ni correos reales ni claves', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const aqui = dirname(fileURLToPath(import.meta.url));
    const fuente = readFileSync(join(aqui, '..', '..', 'functions', 'src', 'plataforma', 'alertaOperativa.ts'), 'utf8');
    expect(fuente).not.toMatch(/re_[A-Za-z0-9]{10,}/);
    expect(fuente).not.toMatch(/aab1\.website/);
    expect(fuente).not.toMatch(/[\w.-]+@(?!\$\{)[\w-]+\.(com|bo|website|net)\b/);
    expect(fuente).toContain("defineSecret('ALERTA_OPERATIVA_HMAC')");
    expect(fuente).toContain("defineSecret('RESEND_API_KEY_ALERTAS')");
  });
});
