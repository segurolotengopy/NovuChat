/**
 * H2 «INTERVENCIÓN DE UNA PERSONA» — LA LÓGICA DE LA PANTALLA (`web/src/central/lib/turno.ts`), SIN NAVEGADOR NI RED.
 *
 * Lo que estas pruebas defienden (contrato único H2, 16/10/2026, §1, §2, §4, §5):
 *
 *  1. LECTURA TOLERANTE DEL TURNO: ausente, de otro tipo o con un valor raro = responde el asistente. La pantalla no
 *     afirma que una persona atiende si el documento no lo dice con exactitud.
 *  2. QUIÉN VE LOS BOTONES: solo admin u oper del negocio; el propietario y el soporte solo leen. «Tomar» solo si
 *     responde el asistente; «Devolver» quien la tiene o un admin; el campo de escribir solo quien la tiene.
 *  3. LA CUENTA REGRESIVA de la ventana de Meta corre desde `ultimoEntranteEn` (no desde `ventanaVenceEn`); sin dato no
 *     se envía; dentro del margen de 60 s tampoco.
 *  4. LA CLAVE DE IDEMPOTENCIA: forma válida (16–128 de `[A-Za-z0-9_.:-]`), una por envío, ESTABLE entre reintentos del
 *     mismo envío y NUEVA para otro envío. Un `incierto` no se reenvía solo.
 *  5. LOS ERRORES SALEN DE `e.code`, nunca de `e.message`, y el texto es fijo.
 *  6. EL ESTADO DEL MENSAJE de una persona (`pendiente`, `aceptado`, `rechazado`, `incierto`) y su rótulo sin uid entero.
 *  7. «EL ASISTENTE ATIENDE»: el filtro deja las que no tiene una persona y su número es todas menos las de una persona.
 *
 * Son puras: sin navegador, sin emulador y sin red (las callables se simulan con una `CapaTurno` de mentira).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AVISO_TOMAR, CLAVE_MAX, CLAVE_MIN, ESPERA_CAMBIO_MS, INACTIVIDAD_DEVOLUCION_MIN, MARGEN_ENVIO_MS, MAX_TEXTO_PERSONA,
  TEXTO_INCIERTO, VENTANA_META_MS, accionesDeTurno, cambioVisible, claveDelEnvio, codigoDeError, ejecutarEnvio, esClaveValida,
  estadoDeMensaje, estadoDelTexto, etiquetaUid, interpretarEnvio, motivoVentana, nuevaClave, resultadoDesconocido,
  rotuloDeAutor, situacionDeTurno, textoContador, textoCuentaRegresiva, textoErrorTurno, textoEstadoMensaje, textoEstadoTurno,
  turnoDeConversacion, ventanaDeEnvio, detallesDeError, textoRechazoMeta, ventanaAbiertaParaTomar, INACTIVIDAD_DEVOLUCION_MIN,
  type Borrador, type CapaTurno,
} from '../../web/src/central/lib/turno';
import {
  CONTADORES_VACIOS, FILTROS, FORMAS_CONSULTA, VENTANA_HORAS, aplicarFiltro, consultaDeFiltro, consultaDePersona, contadorAsistente,
  cumpleFiltro, turnoDeFicha, fichaDeDocumento, filtroConReloj, formaDe, puedeGestionarConversaciones, type Ficha,
} from '../../web/src/central/lib/conversaciones';

const HORA = 3_600_000;
const MIN = 60_000;
const AHORA = Date.UTC(2026, 9, 16, 16, 0, 0);
const marca = (ms: number) => ({ toMillis: () => ms });
/** El turno como lo ve la pantalla a las 16:00, con el último mensaje del cliente hace 1 h; completa las fechas si el caso no las trae. */
const turnoDeDocumento = (v: unknown) => turnoDeConversacion(
  v && typeof v === 'object' && !Array.isArray(v) && 'responde' in v && !('tomadoEn' in v)
    ? { tomadoEn: marca(AHORA - 5 * MIN), actividadPersonaEn: marca(AHORA - MIN), ...v } : v, AHORA - HORA, AHORA);
const YO = 'uidDeLaCajeraAbCdEfGhIjKlMnOp';
const OTRA = 'uidDeOtraPersonaAbCdEfGhIjKlM';

describe('1. el turno se lee con tolerancia', () => {
  it('una persona responde solo con `responde: "persona"` exacto y un `tomadoPor` de texto', () => {
    const t = turnoDeDocumento({ responde: 'persona', tomadoPor: YO, tomadoEn: marca(AHORA - 5 * MIN), actividadPersonaEn: marca(AHORA - MIN) });
    expect(t).toMatchObject({ responde: 'persona', tomadoPor: YO, tomadoEn: AHORA - 5 * MIN, actividadPersonaEn: AHORA - MIN });
  });

  it('el veredicto es el del SERVIDOR (`turnoVigente` de Core): vencido por inactividad o por la ventana, o con fechas rotas = asistente', () => {
    const doc = (actividadHace: number) => ({ responde: 'persona', tomadoPor: YO, tomadoEn: marca(AHORA - 40 * MIN), actividadPersonaEn: marca(AHORA - actividadHace) });
    expect(turnoDeConversacion(doc(29 * MIN), AHORA - HORA, AHORA)).not.toBeNull();
    expect(turnoDeConversacion(doc(30 * MIN), AHORA - HORA, AHORA)).toBeNull();          // 30 min sin actividad
    expect(turnoDeConversacion(doc(MIN), AHORA - 24 * HORA, AHORA)).toBeNull();          // ventana cerrada
    expect(turnoDeConversacion(doc(MIN), null, AHORA)).toBeNull();                       // sin dato = cerrada
    expect(turnoDeConversacion(doc(MIN), AHORA + HORA, AHORA)).toBeNull();               // último entrante del futuro = dato malo
    expect(turnoDeConversacion({ ...doc(MIN), actividadPersonaEn: marca(AHORA + HORA) }, AHORA - HORA, AHORA)).toBeNull();
    expect(turnoDeConversacion({ responde: 'asistente', tomadoPor: YO, tomadoEn: marca(AHORA), actividadPersonaEn: marca(AHORA) }, AHORA - HORA, AHORA)).toBeNull();
    expect(INACTIVIDAD_DEVOLUCION_MIN).toBe(30);
  });

  it('ausente, vacío, de otro tipo o con valores raros = responde el asistente (`null`), sin lanzar', () => {
    const raros: unknown[] = [
      undefined, null, '', 0, 1, true, false, 'persona', ['persona'], [], {},
      { responde: 'asistente', tomadoPor: YO },
      { responde: 'Persona', tomadoPor: YO },
      { responde: 'PERSONA', tomadoPor: YO },
      { responde: ' persona', tomadoPor: YO },
      { responde: ['persona'], tomadoPor: YO },
      { responde: { x: 1 }, tomadoPor: YO },
      { responde: 'persona' },
      { responde: 'persona', tomadoPor: '' },
      { responde: 'persona', tomadoPor: '   ' },
      { responde: 'persona', tomadoPor: 42 },
      { responde: 'persona', tomadoPor: null },
      { responde: 'persona', tomadoPor: 'x'.repeat(CLAVE_MAX + 1) },
      { tomadoPor: YO },
    ];
    for (const v of raros) expect(turnoDeDocumento(v), JSON.stringify(v)).toBeNull();
  });

  it('las fechas raras del turno lo vuelven ilegible = asistente, y no rompen la lectura', () => {
    expect(turnoDeDocumento({ responde: 'persona', tomadoPor: YO, tomadoEn: 'ayer', actividadPersonaEn: { toMillis: () => NaN } })).toBeNull();
  });

  it('la ficha de una conversación de antes de H2 (sin `turno`) es del asistente; con `turno` válido es de una persona', () => {
    const quien = (d: Record<string, unknown>) => turnoDeFicha(fichaDeDocumento('wa_59100000047', { ultimoEntranteEn: marca(AHORA - HORA), ...d }), AHORA);
    expect(quien({ nombreContacto: 'X' })).toBeNull();
    expect(quien({ turno: 'persona' })).toBeNull();
    expect(quien({ turno: { responde: 'persona', tomadoPor: YO, tomadoEn: marca(AHORA - MIN), actividadPersonaEn: marca(AHORA - MIN) } })?.tomadoPor).toBe(YO);
  });

  it('el estado visible: «Responde una persona (usted)» / «(ab12cd…)» / «Responde el asistente»; el uid NUNCA entero', () => {
    const mio = turnoDeDocumento({ responde: 'persona', tomadoPor: YO });
    const ajeno = turnoDeDocumento({ responde: 'persona', tomadoPor: OTRA });
    expect(textoEstadoTurno(null, YO)).toBe('Responde el asistente');
    expect(textoEstadoTurno(mio, YO)).toBe('Responde una persona (usted)');
    expect(textoEstadoTurno(ajeno, YO)).toBe(`Responde una persona (${OTRA.slice(0, 6)}…)`);
    expect(textoEstadoTurno(ajeno, YO)).not.toContain(OTRA);
    expect(textoEstadoTurno(ajeno, null)).not.toContain(OTRA);
    expect(etiquetaUid('abc', null)).toBe('abc…');
    expect(etiquetaUid('abcdefgh', null)).toBe('abcd…');
    expect(etiquetaUid('   ', null)).toBe('una persona');
  });

  it('sin sesión (miUid vacío), una persona nunca es «mía»', () => {
    const t = turnoDeDocumento({ responde: 'persona', tomadoPor: YO });
    expect(situacionDeTurno(t, null)).toBe('ajeno');
    expect(situacionDeTurno(t, '')).toBe('ajeno');
    expect(situacionDeTurno(t, YO)).toBe('mio');
    expect(situacionDeTurno(t, OTRA)).toBe('ajeno');
    expect(situacionDeTurno(null, YO)).toBe('asistente');
  });

  it('el aviso de «Tomar» dice que el asistente deja de responder y cuándo vuelve', () => {
    expect(AVISO_TOMAR).toMatch(/el asistente deja de responder/i);
    expect(AVISO_TOMAR).toContain(`${INACTIVIDAD_DEVOLUCION_MIN} minutos`);
    expect(AVISO_TOMAR).toMatch(/24 h/);
  });
});

describe('2. quién ve qué', () => {
  const base = { comercioActivo: true };
  const ver = (situacion: 'asistente' | 'mio' | 'ajeno', rol: string | null, propietario = false) =>
    accionesDeTurno({ situacion, puedeGestionar: puedeGestionarConversaciones(rol, propietario), esAdmin: rol === 'admin' && !propietario, ventanaAbierta: true, ...base });

  it('admin y oper del negocio ven «Tomar» cuando responde el asistente', () => {
    for (const rol of ['admin', 'oper']) {
      const a = ver('asistente', rol);
      expect(a).toEqual({ verTomar: true, sinTomarPorVentana: false, verDevolver: false, verEscribir: false, habilitados: true });
    }
  });

  it('NEGATIVA: el propietario de NovuChat, el soporte (sin rol), la ingesta y quien no tiene rol NO ven ningún botón ni el campo', () => {
    const nadie = { verTomar: false, sinTomarPorVentana: false, verDevolver: false, verEscribir: false, habilitados: false };
    for (const situacion of ['asistente', 'mio', 'ajeno'] as const) {
      expect(ver(situacion, 'admin', true), `propietario ${situacion}`).toEqual(nadie);
      expect(ver(situacion, null), `sin rol ${situacion}`).toEqual(nadie);
      expect(ver(situacion, 'ingesta'), `ingesta ${situacion}`).toEqual(nadie);
      expect(ver(situacion, 'soporte'), `soporte ${situacion}`).toEqual(nadie);
    }
  });

  it('«Devolver» y el campo de escribir: quien la tiene; un admin puede devolver la de otra, un oper no; nadie escribe en la de otra', () => {
    expect(ver('mio', 'oper')).toEqual({ verTomar: false, sinTomarPorVentana: false, verDevolver: true, verEscribir: true, habilitados: true });
    expect(ver('mio', 'admin')).toEqual({ verTomar: false, sinTomarPorVentana: false, verDevolver: true, verEscribir: true, habilitados: true });
    expect(ver('ajeno', 'admin')).toEqual({ verTomar: false, sinTomarPorVentana: false, verDevolver: true, verEscribir: false, habilitados: true });
    expect(ver('ajeno', 'oper')).toEqual({ verTomar: false, sinTomarPorVentana: false, verDevolver: false, verEscribir: false, habilitados: true });
    expect(ver('asistente', 'oper').verEscribir).toBe(false);          // sin tomar no hay campo
  });

  it('«Tomar» se esconde con la ventana cerrada o sin dato (el servidor lo rechaza) y la pantalla lo explica', () => {
    const a = accionesDeTurno({ situacion: 'asistente', puedeGestionar: true, esAdmin: false, comercioActivo: true, ventanaAbierta: false });
    expect(a.verTomar).toBe(false);
    expect(a.sinTomarPorVentana).toBe(true);
    expect(ventanaAbiertaParaTomar(AHORA - HORA, AHORA)).toBe(true);
    expect(ventanaAbiertaParaTomar(AHORA - 24 * HORA, AHORA)).toBe(false);
    expect(ventanaAbiertaParaTomar(null, AHORA)).toBe(false);
    // quien no puede gestionar no ve ni el aviso
    expect(accionesDeTurno({ situacion: 'asistente', puedeGestionar: false, esAdmin: false, comercioActivo: true, ventanaAbierta: false }).sinTomarPorVentana).toBe(false);
  });

  it('con el comercio no activo los controles se VEN pero no se pueden usar', () => {
    const a = accionesDeTurno({ situacion: 'asistente', puedeGestionar: true, esAdmin: true, comercioActivo: false, ventanaAbierta: true });
    expect(a.verTomar).toBe(true);
    expect(a.habilitados).toBe(false);
  });

  it('tras responder el servidor, los botones esperan a que el cambio llegue por el oyente en vivo', () => {
    expect(cambioVisible('tomar', 'asistente')).toBe(false);
    expect(cambioVisible('tomar', 'mio')).toBe(true);
    expect(cambioVisible('tomar', 'ajeno')).toBe(false);
    expect(cambioVisible('devolver', 'mio')).toBe(false);
    expect(cambioVisible('devolver', 'asistente')).toBe(true);
    expect(ESPERA_CAMBIO_MS).toBeGreaterThan(0);
  });
});

describe('3. la ventana de Meta y su cuenta regresiva', () => {
  it('son 24 h, las mismas que usa el resto de la pantalla', () => {
    expect(VENTANA_META_MS).toBe(VENTANA_HORAS * HORA);
    expect(MARGEN_ENVIO_MS).toBe(60_000);
  });

  it('corre desde `ultimoEntranteEn` y cuenta lo que queda', () => {
    const v = ventanaDeEnvio(AHORA - 20 * HORA, AHORA);
    expect(v).toEqual({ estado: 'abierta', restanteMs: 4 * HORA });
    expect(textoCuentaRegresiva(v.restanteMs)).toBe('04:00:00');
  });

  it('SIN DATO no se puede enviar y se explica; no hay respaldo con `ventanaVenceEn`', () => {
    const v = ventanaDeEnvio(null, AHORA);
    expect(v.estado).toBe('sin-dato');
    expect(motivoVentana(v)).toMatch(/No consta cuándo escribió el cliente/);
    expect(motivoVentana(v)).toMatch(/No se puede enviar/);
    expect(ventanaDeEnvio(Number.NaN, AHORA).estado).toBe('sin-dato');
  });

  it('en el margen de 60 s antes de las 24 h, y pasadas las 24 h, está cerrada', () => {
    expect(ventanaDeEnvio(AHORA - VENTANA_META_MS + MARGEN_ENVIO_MS + 1, AHORA).estado).toBe('abierta');
    expect(ventanaDeEnvio(AHORA - VENTANA_META_MS + MARGEN_ENVIO_MS, AHORA).estado).toBe('cerrada');
    expect(ventanaDeEnvio(AHORA - VENTANA_META_MS, AHORA)).toEqual({ estado: 'cerrada', restanteMs: 0 });
    expect(ventanaDeEnvio(AHORA - 30 * HORA, AHORA)).toEqual({ estado: 'cerrada', restanteMs: 0 });
    expect(motivoVentana(ventanaDeEnvio(AHORA - 30 * HORA, AHORA))).toMatch(/ventana de 24 h de WhatsApp está cerrada/);
    expect(motivoVentana(ventanaDeEnvio(AHORA - HORA, AHORA))).toBeNull();
  });

  it('un reloj adelantado (un último mensaje "del futuro") no da más de 24 h', () => {
    expect(ventanaDeEnvio(AHORA + 5 * HORA, AHORA).estado).toBe('cerrada');       // a más de 5 min del futuro: dato malo, como en el servidor
    expect(ventanaDeEnvio(AHORA + 60_000, AHORA).restanteMs).toBe(VENTANA_META_MS);   // un adelanto chico no pasa de 24 h
  });

  it('la cuenta regresiva en horas, minutos y segundos', () => {
    expect(textoCuentaRegresiva(24 * HORA)).toBe('24:00:00');
    expect(textoCuentaRegresiva(3 * HORA + 20 * MIN + 15_000)).toBe('03:20:15');
    expect(textoCuentaRegresiva(59_999)).toBe('00:00:59');
    expect(textoCuentaRegresiva(0)).toBe('00:00:00');
    expect(textoCuentaRegresiva(-5)).toBe('00:00:00');
  });
});

describe('el texto que se escribe', () => {
  it('máximo 1.000 caracteres: 1.000 entra, 1.001 se pasa; el contador lleva el punto de miles', () => {
    expect(MAX_TEXTO_PERSONA).toBe(1000);
    expect(estadoDelTexto('a'.repeat(1000)).excede).toBe(false);
    expect(estadoDelTexto('a'.repeat(1001)).excede).toBe(true);
    expect(textoContador(0)).toBe('0 / 1.000');
    expect(textoContador(1234)).toBe('1.234 / 1.000');
    expect(textoContador(37)).toBe('37 / 1.000');
  });

  it('un texto solo de espacios y saltos no se puede enviar; lo que se envía va sin los espacios de los extremos', () => {
    expect(estadoDelTexto('').hayTexto).toBe(false);
    expect(estadoDelTexto('   \n\t ').hayTexto).toBe(false);
    const e = estadoDelTexto('  Hola, ya voy  \n');
    expect(e.hayTexto).toBe(true);
    expect(e.texto).toBe('Hola, ya voy');
  });
});

describe('4. la clave de idempotencia', () => {
  it('tiene la forma que exige el servidor (16–128 de `[A-Za-z0-9_.:-]`) y es distinta cada vez', () => {
    const claves = new Set(Array.from({ length: 200 }, () => nuevaClave()));
    expect(claves.size).toBe(200);
    for (const c of claves) {
      expect(esClaveValida(c), c).toBe(true);
      expect(c.length).toBeGreaterThanOrEqual(CLAVE_MIN);
      expect(c.length).toBeLessThanOrEqual(CLAVE_MAX);
      expect(c).toMatch(/^[A-Za-z0-9_.:-]+$/);
    }
  });

  it('las claves inválidas se rechazan', () => {
    for (const c of ['', 'corta', 'x'.repeat(15), 'x'.repeat(129), 'con espacios 123456789', 'ñandú-ñandú-ñandú-1', 'a/b/c/d/e/f/g/h/i/j', 'a'.repeat(16) + '\n', null, undefined, 12345678901234567]) {
      expect(esClaveValida(c), String(c)).toBe(false);
    }
    expect(esClaveValida('a'.repeat(16))).toBe(true);
    expect(esClaveValida('A_b.c:d-' + 'x'.repeat(120))).toBe(true);
  });

  it('con una fuente de bytes fija, la clave es determinista (la fuente se reemplaza en las pruebas)', () => {
    expect(nuevaClave(() => new Uint8Array(16).fill(255))).toBe('env_' + 'ff'.repeat(16));
  });

  it('ESTABLE entre reintentos del mismo envío; NUEVA si cambia el texto', () => {
    let n = 0;
    const generar = () => `clave-numero-${String(++n).padStart(6, '0')}`;
    const a = claveDelEnvio(null, 'Hola', generar);
    const b = claveDelEnvio(a, 'Hola', generar);
    expect(b).toBe(a);
    expect(n).toBe(1);
    const c = claveDelEnvio(a, 'Hola, ¿sigue ahí?', generar);
    expect(c.clave).not.toBe(a.clave);
    expect(n).toBe(2);
    // un borrador con una clave inválida no se reutiliza
    expect(claveDelEnvio({ texto: 'Hola', clave: 'mala' }, 'Hola', generar).clave).toBe('clave-numero-000003');
  });

  describe('un envío completo (`ejecutarEnvio`) contra una capa simulada', () => {
    const entrada = { tenantId: 'comercio-x', conversacionId: 'wa_59100000047', texto: 'Hola' };
    const capaCon = (enviar: CapaTurno['enviar']): CapaTurno => ({ tomar: vi.fn(), devolver: vi.fn(), enviar });
    const error = (code?: string) => Object.assign(new Error('DETALLE-INTERNO-QUE-NO-SE-MUESTRA'), code === undefined ? {} : { code });

    it('manda SOLO lo del contrato: tenantId, conversacionId, texto y claveIdempotencia (nunca el teléfono)', async () => {
      const enviar = vi.fn(async () => ({ estado: 'pendiente', mensajeId: 'm1' }));
      const r = await ejecutarEnvio(capaCon(enviar), entrada, null, () => 'clave-de-prueba-0001');
      expect(enviar).toHaveBeenCalledTimes(1);
      expect(enviar).toHaveBeenCalledWith({
        tenantId: 'comercio-x', conversacionId: 'wa_59100000047', texto: 'Hola', claveIdempotencia: 'clave-de-prueba-0001',
      });
      expect(Object.keys(enviar.mock.calls[0]![0] as object).sort()).toEqual(['claveIdempotencia', 'conversacionId', 'tenantId', 'texto']);
      expect(r.salida).toEqual({ tipo: 'enviado' });
      expect(r.borrador).toBeNull();                                // el servidor contestó: ese envío está cerrado
    });

    it('sin respuesta del servidor (red, tiempo agotado) el envío sigue abierto y el reintento usa LA MISMA clave', async () => {
      const enviar = vi.fn()
        .mockRejectedValueOnce(error('functions/deadline-exceeded'))
        .mockResolvedValueOnce({ estado: 'enviado' });
      const capa = capaCon(enviar);
      const primero = await ejecutarEnvio(capa, entrada, null);
      expect(primero.salida.tipo).toBe('error');
      expect(primero.salida).toMatchObject({ desconocido: true });
      expect(primero.borrador).not.toBeNull();
      const segundo = await ejecutarEnvio(capa, entrada, primero.borrador);
      expect(segundo.clave).toBe(primero.clave);
      expect(enviar.mock.calls[0]![0].claveIdempotencia).toBe(enviar.mock.calls[1]![0].claveIdempotencia);
      expect(segundo.salida).toEqual({ tipo: 'enviado' });
      expect(segundo.borrador).toBeNull();
    });

    it('un error SIN código (fallo de red) también deja el envío abierto', async () => {
      const r = await ejecutarEnvio(capaCon(async () => { throw error(); }), entrada, null);
      expect(r.salida).toMatchObject({ tipo: 'error', codigo: '', desconocido: true });
      expect(r.borrador).not.toBeNull();
    });

    it('un error del servidor que no deja dudas cierra el envío: el siguiente clic es OTRO envío, con clave nueva', async () => {
      for (const code of ['functions/failed-precondition', 'permission-denied', 'resource-exhausted', 'invalid-argument', 'unauthenticated', 'not-found']) {
        const r = await ejecutarEnvio(capaCon(async () => { throw error(code); }), entrada, null);
        expect(r.salida, code).toMatchObject({ tipo: 'error', desconocido: false });
        expect(r.borrador, code).toBeNull();
      }
    });

    it('un resultado `incierto` NO se reenvía solo: una sola llamada, y el envío queda cerrado (reenviar es decisión de la persona)', async () => {
      const enviar = vi.fn(async () => ({ estado: 'incierto' }));
      const r = await ejecutarEnvio(capaCon(enviar), entrada, null);
      expect(enviar).toHaveBeenCalledTimes(1);
      expect(r.salida).toEqual({ tipo: 'incierto' });
      expect(r.borrador).toBeNull();
      // y escribirlo otra vez es un envío nuevo, con clave nueva
      const otra = await ejecutarEnvio(capaCon(enviar), entrada, r.borrador);
      expect(otra.clave).not.toBe(r.clave);
    });

    it('un `fallido` del servidor se dice como fallido; una respuesta que no se entiende NO se da por enviada', async () => {
      expect((await ejecutarEnvio(capaCon(async () => ({ estado: 'fallido' })), entrada, null)).salida).toEqual({ tipo: 'fallido' });
      for (const rara of [undefined, null, {}, 'ok', 7, { estado: 'quizá' }, { estado: ['enviado'] }]) {
        expect(interpretarEnvio(rara), String(JSON.stringify(rara))).toBe('incierto');
      }
    });

    it('el texto del error no trae el `message` del servidor', async () => {
      const r = await ejecutarEnvio(capaCon(async () => { throw error('permission-denied'); }), entrada, null);
      expect(JSON.stringify(r)).not.toContain('DETALLE-INTERNO');
    });
  });
});

describe('5. los errores salen de `e.code`, nunca de `e.message`', () => {
  it('el código se lee con o sin el prefijo `functions/` y nunca lanza', () => {
    expect(codigoDeError({ code: 'functions/permission-denied' })).toBe('permission-denied');
    expect(codigoDeError({ code: 'permission-denied' })).toBe('permission-denied');
    for (const v of [undefined, null, 'x', 5, {}, { code: 5 }, { message: 'permission-denied' }]) expect(codigoDeError(v)).toBe('');
  });

  it('cada acción tiene un texto fijo por código; ninguno repite un mensaje del servidor ni un «ocurrió un error» genérico', () => {
    const codigos = ['unauthenticated', 'permission-denied', 'failed-precondition', 'invalid-argument', 'resource-exhausted', 'not-found', 'otro-codigo'];
    for (const accion of ['tomar', 'devolver', 'enviar'] as const) {
      const textos = new Set(codigos.map((c) => textoErrorTurno(accion, c)));
      for (const t of textos) {
        expect(t.length, t).toBeGreaterThan(20);
        expect(t, t).not.toMatch(/ocurri[óo] un error|algo sali[óo] mal|error desconocido/i);
        expect(t, t).not.toMatch(/\bvos\b|\bpodés\b|\btenés\b|\bintentá\b/i);
      }
      expect(textos.size).toBeGreaterThanOrEqual(5);
    }
  });

  it('«ya la tiene otra persona» al tomar (con `details.tomadoPor`, abreviado); sin el detalle, un texto que también nombra la ventana', () => {
    expect(textoErrorTurno('tomar', 'failed-precondition', { tomadoPor: OTRA })).toBe(`No se pudo tomar: ya la tiene otra persona (${OTRA.slice(0, 6)}…).`);
    expect(textoErrorTurno('tomar', 'failed-precondition', { tomadoPor: OTRA })).not.toContain(OTRA);
    expect(textoErrorTurno('tomar', 'failed-precondition')).toMatch(/otra persona, o la ventana de 24 h/);
    expect(textoErrorTurno('tomar', 'failed-precondition', { tomadoPor: 5 })).toMatch(/ventana de 24 h/);
    expect(textoErrorTurno('enviar', 'failed-precondition')).toMatch(/ventana de 24 h/);
    expect(textoErrorTurno('enviar', 'invalid-argument')).toContain('1.000');
    expect(textoErrorTurno('tomar', 'permission-denied')).toMatch(/no está habilitada para su comercio/);
  });

  it('el tope de envíos (`details.tope`): minuto con sus segundos, conversación y día sin prometer que esperar sirve; sin detalle, texto neutro', () => {
    const t = (d?: Record<string, unknown>) => textoErrorTurno('enviar', 'resource-exhausted', d);
    expect(t({ tope: 'minuto', esperaSegundos: 42 })).toBe('Límite de envíos por minuto; intente en 42 s.');
    expect(t({ tope: 'minuto' })).toMatch(/unos segundos/);
    for (const raro of [0, -3, 1.5, 99999, '42', null, NaN]) expect(t({ tope: 'minuto', esperaSegundos: raro })).toMatch(/unos segundos/);
    expect(t({ tope: 'conversacion' })).toMatch(/esta conversación en esta ventana de 24 h/);
    expect(t({ tope: 'conversacion' })).toMatch(/no lo cambia/);
    expect(t({ tope: 'dia' })).toMatch(/por día/);
    expect(t({ tope: 'dia' })).toMatch(/no lo cambia/);
    expect(t({ tope: 'dia', esperaSegundos: 5 })).not.toMatch(/ 5 s/);
    for (const neutro of [undefined, {}, { tope: 'otro' }, { tope: 5 }]) {
      expect(t(neutro as Record<string, unknown> | undefined)).toBe('Alcanzó un límite de envíos. Consulte con su administrador antes de intentar de nuevo.');
    }
    // los tres dicen cosas distintas, y ninguno es el viejo «espere unos segundos» genérico
    expect(new Set([t({ tope: 'minuto' }), t({ tope: 'conversacion' }), t({ tope: 'dia' })]).size).toBe(3);
    // tomar/devolver tienen su propio tope
    expect(textoErrorTurno('tomar', 'resource-exhausted', { tope: 'dia' })).toMatch(/cambios de atención/);
  });

  it('un error de envío con `details.tope` llega al texto (la capa lee `details`, no `message`)', async () => {
    const capa: CapaTurno = { tomar: async () => ({}), devolver: async () => ({}),
      enviar: async () => { throw Object.assign(new Error('NO-SE-LEE'), { code: 'functions/resource-exhausted', details: { tope: 'dia' } }); } };
    const r = await ejecutarEnvio(capa, { tenantId: 'c', conversacionId: 'wa_59100000047', texto: 'x' }, null);
    expect(r.salida).toMatchObject({ tipo: 'error', codigo: 'resource-exhausted' });
    expect((r.salida as { texto: string }).texto).toMatch(/por día/);
    expect(JSON.stringify(r)).not.toContain('NO-SE-LEE');
  });

  it('los `details` del error son un objeto o nada; nunca el `message`', () => {
    expect(detallesDeError({ details: { tope: 'dia' } })).toEqual({ tope: 'dia' });
    for (const v of [undefined, null, 'x', {}, { details: 'dia' }, { details: ['dia'] }, { details: null }, { message: 'tope dia' }]) expect(detallesDeError(v)).toEqual({});
  });

  it('el motivo de un rechazo de Meta: texto fijo por código (131047, 130429, 131026, 131049, 131051, 131052, 131053, WM-3037)', () => {
    const codigos = ['131047', '130429', '131026', '131049', '131051', '131052', '131053', 'WM-3037'];
    const textos = codigos.map((c) => textoRechazoMeta(c));
    expect(new Set(textos).size).toBe(codigos.length);                          // cada código, su texto
    for (const x of textos) { expect(x.length).toBeGreaterThan(25); expect(x).not.toMatch(/^\d{6}$/); }
    expect(textoRechazoMeta('131047')).toMatch(/^Pasaron más de 24 horas/);
    for (const c of codigos) expect(textoRechazoMeta(c), c).not.toBe('WhatsApp no aceptó el mensaje.');   // todos los códigos del contrato tienen su texto
    expect(textoRechazoMeta('131053')).toMatch(/formato o tamaño/);
    expect(textoRechazoMeta('131052')).toMatch(/descargar/);
    expect(textoRechazoMeta('131026')).toMatch(/no tiene WhatsApp/);
    expect(textoRechazoMeta('WM-3037', 12)).toBe('Límite de envíos; intente en 12 s.');
    expect(textoRechazoMeta('WM-3037')).toBe('Límite de envíos; intente de nuevo en unos instantes.');
    expect(textoRechazoMeta('WM-3037', 'doce')).not.toMatch(/ s\./);
    expect(textoRechazoMeta('131047', 12)).not.toMatch(/ 12 /);                  // los segundos solo valen para WM-3037
  });

  it('NEGATIVA: un código que no se conoce (o raro) no se muestra tal cual ni se inventa su motivo', () => {
    for (const raro of ['999999', '<img src=x>', '', undefined, null, 131047, {}, 'WM-9999']) {
      expect(textoRechazoMeta(raro), String(raro)).toBe('WhatsApp no aceptó el mensaje.');
    }
  });

  it('un envío sin respuesta dice «No se pudo confirmar si llegó» y que repetirlo no duplica; sin reenvío automático', () => {
    for (const c of ['', 'deadline-exceeded', 'unavailable', 'internal', 'unknown']) {
      expect(resultadoDesconocido(c), c).toBe(true);
      const t = textoErrorTurno('enviar', c);
      expect(t).toContain(TEXTO_INCIERTO);
      expect(t).toMatch(/no se duplica/);
    }
    for (const c of ['permission-denied', 'failed-precondition', 'resource-exhausted', 'invalid-argument', 'unauthenticated', 'not-found']) {
      expect(resultadoDesconocido(c), c).toBe(false);
    }
    // tomar/devolver con un error de red NO dicen «no se pudo confirmar si llegó» (eso es de los mensajes)
    expect(textoErrorTurno('tomar', 'unavailable')).not.toContain(TEXTO_INCIERTO);
  });
});

describe('6. el estado del mensaje saliente de una persona', () => {
  it('`pendiente`, `aceptado`, `rechazado` e `incierto`; `enviando` se ve como `pendiente`; lo raro o ausente no inventa un estado', () => {
    expect(estadoDeMensaje('pendiente')).toBe('pendiente');
    expect(estadoDeMensaje('enviando')).toBe('pendiente');
    expect(estadoDeMensaje('aceptado')).toBe('aceptado');
    expect(estadoDeMensaje('rechazado')).toBe('rechazado');
    expect(estadoDeMensaje('incierto')).toBe('incierto');
    for (const v of [undefined, null, '', 'enviado', 'entregado', 'leido', 'ACEPTADO', 3, {}, ['aceptado']]) expect(estadoDeMensaje(v), String(v)).toBeNull();
  });

  it('«incierto» dice exactamente «No se pudo confirmar si llegó»; «aceptado» no dice entregado ni leído', () => {
    expect(textoEstadoMensaje('incierto')).toBe('No se pudo confirmar si llegó');
    expect(TEXTO_INCIERTO).toBe('No se pudo confirmar si llegó');
    expect(textoEstadoMensaje('aceptado')).not.toMatch(/entregad|le[ií]d|acreditad/i);
    expect(textoEstadoMensaje('pendiente')).toBe('Enviando…');
    expect(textoEstadoMensaje('rechazado')).toMatch(/no se envió/);
  });

  it('el rótulo de quien escribió: «Persona (usted)», «Persona (ab12cd…)», «Asistente»; sin autor, nada', () => {
    expect(rotuloDeAutor('persona', YO, YO)).toBe('Persona (usted)');
    expect(rotuloDeAutor('persona', OTRA, YO)).toBe(`Persona (${OTRA.slice(0, 6)}…)`);
    expect(rotuloDeAutor('persona', OTRA, YO)).not.toContain(OTRA);
    expect(rotuloDeAutor('persona', '', YO)).toBe('Persona');
    expect(rotuloDeAutor('asistente', '', YO)).toBe('Asistente');
    expect(rotuloDeAutor('', '', YO)).toBe('');
    expect(rotuloDeAutor('otro', OTRA, YO)).toBe('');
  });
});

describe('7. el filtro «El asistente atiende»', () => {
  const ficha = (id: string, persona: boolean): Ficha => fichaDeDocumento(id, {
    ultimoEntranteEn: marca(AHORA - HORA),
    ...(persona ? { turno: { responde: 'persona', tomadoPor: OTRA, tomadoEn: marca(AHORA - 5 * MIN), actividadPersonaEn: marca(AHORA - MIN) } } : {}),
  });
  const lista = [ficha('wa_59100000001', false), ficha('wa_59100000002', true), ficha('wa_59100000003', false), ficha('wa_59100000004', true)];

  it('deja las que no tiene una persona (ausente = asistente)', () => {
    expect(aplicarFiltro(lista, 'asistente', AHORA).map((f) => f.id)).toEqual(['wa_59100000001', 'wa_59100000003']);
    expect(cumpleFiltro(ficha('wa_59100000009', true), 'asistente', AHORA)).toBe(false);
    expect(aplicarFiltro(lista, 'todas', AHORA)).toHaveLength(4);
  });

  it('un turno VENCIDO (30 min sin actividad) o con la ventana cerrada cuenta como «el asistente atiende», igual que en el servidor', () => {
    const viejo = fichaDeDocumento('wa_59100000005', {
      ultimoEntranteEn: marca(AHORA - HORA),
      turno: { responde: 'persona', tomadoPor: OTRA, tomadoEn: marca(AHORA - 2 * HORA), actividadPersonaEn: marca(AHORA - 31 * MIN) },
    });
    const cerrada = fichaDeDocumento('wa_59100000006', {
      ultimoEntranteEn: marca(AHORA - 25 * HORA),
      turno: { responde: 'persona', tomadoPor: OTRA, tomadoEn: marca(AHORA - 5 * MIN), actividadPersonaEn: marca(AHORA - MIN) },
    });
    for (const f of [viejo, cerrada]) {
      expect(turnoDeFicha(f, AHORA)).toBeNull();
      expect(cumpleFiltro(f, 'asistente', AHORA)).toBe(true);
    }
  });

  it('está en la lista de filtros, justo después de «Todas», con su rótulo', () => {
    expect(FILTROS.map((f) => f.id).slice(0, 2)).toEqual(['todas', 'asistente']);
    expect(FILTROS[1]?.rotulo).toBe('El asistente atiende');
    expect(filtroConReloj('asistente')).toBe(false);
  });

  it('pide la MISMA página que «Todas» (no se puede consultar «el campo no existe» en Firestore)', () => {
    expect(consultaDeFiltro('asistente', AHORA, 50)).toEqual(consultaDeFiltro('todas', AHORA, 50));
  });

  it('su número = todas − las de una persona (por una consulta de un solo campo, `turno.responde == "persona"`); sin alguno de los dos, sin número', () => {
    expect(contadorAsistente(10, 3)).toBe(7);
    expect(contadorAsistente(3, 3)).toBe(0);
    expect(contadorAsistente(2, 5)).toBe(0);               // un recuento atrasado no da un número negativo
    expect(contadorAsistente(null, 3)).toBeNull();
    expect(contadorAsistente(10, null)).toBeNull();
    expect(CONTADORES_VACIOS.asistente).toBeNull();
    const c = consultaDePersona();
    expect(c.restricciones).toEqual([{ campo: 'turno.responde', op: '==', valor: 'persona' }]);
    expect(c.orden).toEqual([]);
    expect(FORMAS_CONSULTA.some((f) => JSON.stringify({ filtros: f.filtros, orden: f.orden }) === JSON.stringify(formaDe(c)))).toBe(true);
  });
});
