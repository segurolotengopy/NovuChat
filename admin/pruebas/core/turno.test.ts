/**
 * El turno de una conversación (H2-1): LA REGLA PURA, ESCRITA NEGANDO
 *
 * `core/conversacion/turno.ts` no importa nada de Firebase, y esta suite tampoco abre Firebase ni
 * necesita el emulador (corre en `pnpm pruebas:puras`). Prueba lo que decide quién responde (la
 * persona o el asistente), con el reloj como argumento y los límites exactos de cada plazo, más lo
 * que no es un turno (formas rotas) y la lista de comercios excluidos de la intervención.
 *
 * Las callables, la autorización y las transacciones están en `turno-conversacion.test.ts`
 * (con emulador).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ErroresDeTurno, ID_CONVERSACION, INACTIVIDAD_MS, MARGEN_ENVIO_MS, MARGEN_RELOJ_MS, UID_DE_PERSONA, VENTANA_META_MS,
  leerTurno, milisegundosDeMomento, turnoEfectivo, turnoVigente, ventanaDeMetaAbierta,
} from '../../functions/src/core/conversacion/turno.ts';
import { personaPuedeEscribirDeFicha } from '../../functions/src/core/conversacion/turno.ts';
import {
  TENANTS_EXCLUIDOS, esTenantExcluido, habilitadoParaPersona, nombreExcluido,
} from '../../functions/src/core/conversacion/accesoPersona.ts';
import {
  CONCURRENCIA_DE_TURNO, MAX_INSTANCIAS_DE_TURNO, TOPE_DE_TURNO_POR_DIA, TOPE_DE_TURNO_POR_HORA, opcionesDeTurno, ultimos4,
} from '../../functions/src/core/conversacion/turnoServidor.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const MIN = 60_000;
const HORA = 3_600_000;
const AHORA = Date.UTC(2026, 9, 16, 15, 0, 0);

/** Una «fecha de Firestore» sin importar Firebase: lo único que el módulo puro le pide es `toMillis`. */
const ts = (ms: number) => ({ toMillis: () => ms });

/** Un turno guardado, con la persona `u-ana` que tomó hace 5 min y tuvo actividad hace 1 min. */
const guardado = (o: Record<string, unknown> = {}) => ({
  responde: 'persona', tomadoPor: 'u-ana', tomadoEn: ts(AHORA - 5 * MIN), actividadPersonaEn: ts(AHORA - 1 * MIN), ...o,
});
/** Una conversación cuyo cliente escribió hace 1 h. */
const conv = (ultimoMs: number | null = AHORA - HORA) => ({ ultimoEntranteEn: ultimoMs === null ? undefined : ts(ultimoMs) });

// ===========================================================================
describe('las constantes del contrato', () => {
  it('30 minutos de inactividad, 24 horas de ventana, 60 s de margen de envío, 5 min de tolerancia de reloj', () => {
    expect(INACTIVIDAD_MS).toBe(30 * 60 * 1000);
    expect(VENTANA_META_MS).toBe(24 * 60 * 60 * 1000);
    expect(MARGEN_ENVIO_MS).toBe(60 * 1000);
    expect(MARGEN_RELOJ_MS).toBe(5 * 60 * 1000);
  });
  it('la forma de un id de conversación y de un uid', () => {
    expect(ID_CONVERSACION.test('wa_59100000001')).toBe(true);
    for (const mal of ['59100000001', 'wa_1234567', 'wa_1234567890123456', 'wa_5910000000a', 'wa_59100000001/x', '../wa_59100000001', 'WA_59100000001', 'wa_59100000001\n']) {
      expect(ID_CONVERSACION.test(mal), mal).toBe(false);
    }
    expect(UID_DE_PERSONA.test('u-ana_1')).toBe(true);
    for (const mal of ['', 'a/b', 'a b', 'x'.repeat(129), '..', 'u\nana']) expect(UID_DE_PERSONA.test(mal), mal).toBe(false);
  });
});

// ===========================================================================
describe('leerTurno: lo que no tiene la forma del contrato no es un turno', () => {
  it('ausente (undefined) es «sin turno»', () => {
    expect(leerTurno(undefined)).toEqual({ estado: 'ausente' });
  });

  it('un turno sano se lee con los tiempos en milisegundos', () => {
    expect(leerTurno(guardado())).toEqual({
      estado: 'ok',
      turno: { responde: 'persona', tomadoPor: 'u-ana', tomadoEn: AHORA - 5 * MIN, actividadPersonaEn: AHORA - 1 * MIN },
    });
  });

  it('con devolución: devueltoEn y motivoDevolucion se conservan', () => {
    const r = leerTurno(guardado({ responde: 'asistente', devueltoEn: ts(AHORA), motivoDevolucion: 'manual' }));
    expect(r).toMatchObject({ estado: 'ok', turno: { responde: 'asistente', devueltoEn: AHORA, motivoDevolucion: 'manual' } });
  });

  it('los tres motivos de devolución del contrato son válidos; otro no', () => {
    for (const m of ['manual', 'inactividad', 'ventana']) {
      expect(leerTurno(guardado({ responde: 'asistente', motivoDevolucion: m })).estado, m).toBe('ok');
    }
    for (const m of ['otro', '', 7, null, 'MANUAL']) {
      expect(leerTurno(guardado({ responde: 'asistente', motivoDevolucion: m })).estado, String(m)).toBe('ilegible');
    }
  });

  it('NEGATIVA: cada forma rota es ilegible', () => {
    const rotos: Array<[string, unknown]> = [
      ['null', null], ['texto', 'persona'], ['número', 5], ['lista', [guardado()]], ['verdadero', true],
      ['objeto vacío', {}],
      ['responde desconocido', guardado({ responde: 'robot' })],
      ['responde ausente', guardado({ responde: undefined })],
      ['tomadoPor ausente', guardado({ tomadoPor: undefined })],
      ['tomadoPor vacío', guardado({ tomadoPor: '' })],
      ['tomadoPor no es texto', guardado({ tomadoPor: 7 })],
      ['tomadoPor con ruta', guardado({ tomadoPor: 'a/b' })],
      ['tomadoPor demasiado largo', guardado({ tomadoPor: 'x'.repeat(129) })],
      ['tomadoEn ausente', guardado({ tomadoEn: undefined })],
      ['tomadoEn es número', guardado({ tomadoEn: AHORA })],
      ['tomadoEn es texto', guardado({ tomadoEn: '2026-10-16' })],
      ['tomadoEn NaN', guardado({ tomadoEn: { toMillis: () => Number.NaN } })],
      ['tomadoEn infinito', guardado({ tomadoEn: { toMillis: () => Infinity } })],
      ['tomadoEn toMillis no es función', guardado({ tomadoEn: { toMillis: 5 } })],
      ['tomadoEn toMillis lanza', guardado({ tomadoEn: { toMillis: () => { throw new Error('x'); } } })],
      ['tomadoEn toMillis devuelve texto', guardado({ tomadoEn: { toMillis: () => '5' } })],
      ['actividadPersonaEn ausente', guardado({ actividadPersonaEn: undefined })],
      ['actividadPersonaEn null', guardado({ actividadPersonaEn: null })],
      ['devueltoEn presente pero roto', guardado({ responde: 'asistente', devueltoEn: 'ayer' })],
    ];
    for (const [nombre, v] of rotos) expect(leerTurno(v), nombre).toEqual({ estado: 'ilegible' });
  });

  it('milisegundosDeMomento: solo lo que tiene un toMillis finito', () => {
    expect(milisegundosDeMomento(ts(5))).toBe(5);
    expect(milisegundosDeMomento(ts(0))).toBe(0);
    for (const v of [null, undefined, 5, '5', {}, [], ts(Number.NaN)]) expect(milisegundosDeMomento(v), String(v)).toBeNull();
  });
});

// ===========================================================================
describe('turnoVigente: responde la persona o el asistente, y por qué', () => {
  it('sin turno: responde el asistente (como siempre)', () => {
    expect(turnoVigente(undefined, conv(), AHORA)).toEqual({ responde: 'asistente', motivo: 'sin_turno' });
  });

  it('turno de persona vigente: responde la persona, y dice cuándo vence lo primero', () => {
    // actividad hace 1 min -> inactividad vence en 29 min; el cliente escribió hace 1 h -> ventana en 23 h.
    expect(turnoVigente(guardado(), conv(), AHORA)).toEqual({ responde: 'persona', motivo: 'tomado', venceEnMs: AHORA + 29 * MIN });
  });

  it('con la ventana por cerrarse antes que la inactividad, venceEnMs es el cierre de la ventana', () => {
    const ultimo = AHORA - 24 * HORA + 10 * MIN; // la ventana cierra en 10 min
    expect(turnoVigente(guardado(), conv(ultimo), AHORA)).toEqual({ responde: 'persona', motivo: 'tomado', venceEnMs: AHORA + 10 * MIN });
  });

  it('turno devuelto (responde asistente): responde el asistente, motivo «devuelto»', () => {
    const t = guardado({ responde: 'asistente', devueltoEn: ts(AHORA - MIN), motivoDevolucion: 'manual' });
    expect(turnoVigente(t, conv(), AHORA)).toEqual({ responde: 'asistente', motivo: 'devuelto' });
  });

  describe('la devolución por inactividad: 30 minutos desde la última actividad', () => {
    it('a 29 min 59 s, 999 ms sigue la persona; a los 30 min exactos ya responde el asistente', () => {
      const actividad = AHORA - 30 * MIN;
      const t = guardado({ actividadPersonaEn: ts(actividad) });
      expect(turnoVigente(t, conv(), actividad + 30 * MIN - 1).responde).toBe('persona');
      expect(turnoVigente(t, conv(), actividad + 30 * MIN)).toEqual({ responde: 'asistente', motivo: 'inactividad', venceEnMs: actividad + 30 * MIN });
    });

    it('cuenta desde la ACTIVIDAD, no desde cuándo tomó: tomó hace 2 h pero escribió hace 1 min', () => {
      const t = guardado({ tomadoEn: ts(AHORA - 2 * HORA), actividadPersonaEn: ts(AHORA - MIN) });
      expect(turnoVigente(t, conv(), AHORA).responde).toBe('persona');
    });

    it('y al revés: tomó hace 1 min pero su última actividad es de hace 31 min -> vencido', () => {
      const t = guardado({ tomadoEn: ts(AHORA - MIN), actividadPersonaEn: ts(AHORA - 31 * MIN) });
      expect(turnoVigente(t, conv(), AHORA)).toMatchObject({ responde: 'asistente', motivo: 'inactividad' });
    });
  });

  describe('la devolución por vencer la ventana de Meta: ultimoEntranteEn + 24 h', () => {
    it('un milisegundo antes del cierre sigue la persona; en el instante del cierre responde el asistente', () => {
      const ultimo = AHORA - 24 * HORA + 20 * MIN; // cierra en 20 min; la actividad (hace 1 min) sigue fresca
      const t = guardado();
      const cierra = ultimo + VENTANA_META_MS;
      expect(turnoVigente(t, conv(ultimo), cierra - 1).responde).toBe('persona');
      // a las 24 h exactas la actividad ya tiene 21 min: solo la ventana vence.
      expect(turnoVigente(t, conv(ultimo), cierra)).toEqual({ responde: 'asistente', motivo: 'ventana', venceEnMs: cierra });
    });

    it('cuenta desde el último ENTRANTE y no desde cuándo se tomó la conversación', () => {
      // Tomó hace 5 min; el cliente escribió por última vez hace 25 h (la ventana ya cerró hace 1 h).
      expect(turnoVigente(guardado(), conv(AHORA - 25 * HORA), AHORA)).toMatchObject({ responde: 'asistente', motivo: 'ventana' });
    });

    it('sin ultimoEntranteEn (sin dato = cerrada), o con un dato que no es fecha: responde el asistente', () => {
      expect(turnoVigente(guardado(), conv(null), AHORA)).toEqual({ responde: 'asistente', motivo: 'ventana' });
      expect(turnoVigente(guardado(), { ultimoEntranteEn: 'ayer' }, AHORA)).toMatchObject({ motivo: 'ventana' });
      expect(turnoVigente(guardado(), { ultimoEntranteEn: AHORA - HORA }, AHORA)).toMatchObject({ motivo: 'ventana' });
      expect(turnoVigente(guardado(), null, AHORA)).toMatchObject({ motivo: 'ventana' });
      expect(turnoVigente(guardado(), undefined, AHORA)).toMatchObject({ motivo: 'ventana' });
    });

    it('si vencieron las dos, gana la que venció PRIMERO; si coinciden, la ventana', () => {
      // Ventana cerró hace 2 h; inactividad venció hace 10 min.
      const t1 = guardado({ actividadPersonaEn: ts(AHORA - 40 * MIN) });
      expect(turnoVigente(t1, conv(AHORA - 26 * HORA), AHORA)).toMatchObject({ motivo: 'ventana' });
      // Inactividad venció hace 3 h; ventana cerró hace 10 min.
      const t2 = guardado({ tomadoEn: ts(AHORA - 4 * HORA), actividadPersonaEn: ts(AHORA - 3 * HORA - 30 * MIN) });
      expect(turnoVigente(t2, conv(AHORA - 24 * HORA - 10 * MIN), AHORA)).toMatchObject({ motivo: 'inactividad' });
      // Coinciden exactamente: ventana.
      const cierre = AHORA - 5 * MIN;
      const t3 = guardado({ tomadoEn: ts(cierre - INACTIVIDAD_MS - MIN), actividadPersonaEn: ts(cierre - INACTIVIDAD_MS) });
      expect(turnoVigente(t3, conv(cierre - VENTANA_META_MS), AHORA)).toMatchObject({ motivo: 'ventana', venceEnMs: cierre });
    });
  });

  describe('lo ilegible o del futuro nunca calla al asistente', () => {
    it('un turno ilegible: responde el asistente con el motivo «ilegible»', () => {
      for (const v of [null, 'persona', guardado({ tomadoPor: 7 }), guardado({ actividadPersonaEn: 'x' })]) {
        expect(turnoVigente(v, conv(), AHORA), JSON.stringify(v)).toEqual({ responde: 'asistente', motivo: 'ilegible' });
      }
    });

    it('un reloj que no es número: responde el asistente (ilegible), no una excepción', () => {
      for (const ahora of [Number.NaN, Infinity, -Infinity]) {
        expect(turnoVigente(guardado(), conv(), ahora)).toEqual({ responde: 'asistente', motivo: 'ilegible' });
      }
    });

    it('una actividad del futuro a más de 5 min no es una persona activa; hasta 5 min se tolera', () => {
      expect(turnoVigente(guardado({ actividadPersonaEn: ts(AHORA + MARGEN_RELOJ_MS + 1) }), conv(), AHORA)).toMatchObject({ motivo: 'ilegible' });
      expect(turnoVigente(guardado({ actividadPersonaEn: ts(AHORA + MARGEN_RELOJ_MS) }), conv(), AHORA).responde).toBe('persona');
    });

    it('un tomadoEn del futuro a más de 5 min: ilegible', () => {
      expect(turnoVigente(guardado({ tomadoEn: ts(AHORA + MARGEN_RELOJ_MS + 1) }), conv(), AHORA)).toMatchObject({ motivo: 'ilegible' });
      expect(turnoVigente(guardado({ tomadoEn: ts(AHORA + MARGEN_RELOJ_MS) }), conv(), AHORA).responde).toBe('persona');
    });

    it('un último entrante del futuro a más de 5 min no alarga la pausa: ilegible', () => {
      expect(turnoVigente(guardado(), conv(AHORA + MARGEN_RELOJ_MS + 1), AHORA)).toMatchObject({ responde: 'asistente', motivo: 'ilegible' });
      expect(turnoVigente(guardado(), conv(AHORA + MARGEN_RELOJ_MS), AHORA).responde).toBe('persona');
    });
  });
});

// ===========================================================================
describe('turnoEfectivo: el turno como está AHORA', () => {
  it('sin turno o ilegible: turno null', () => {
    expect(turnoEfectivo(undefined, conv(), AHORA).turno).toBeNull();
    expect(turnoEfectivo({ basura: 1 }, conv(), AHORA).turno).toBeNull();
  });

  it('vigente: el turno guardado, sin cambios', () => {
    expect(turnoEfectivo(guardado(), conv(), AHORA).turno).toEqual({
      responde: 'persona', tomadoPor: 'u-ana', tomadoEn: AHORA - 5 * MIN, actividadPersonaEn: AHORA - MIN,
    });
  });

  it('vencido por inactividad: responde asistente, devueltoEn = cuándo venció, motivo «inactividad»; conserva quién y cuándo', () => {
    const act = AHORA - 45 * MIN;
    const { veredicto, turno } = turnoEfectivo(guardado({ actividadPersonaEn: ts(act) }), conv(), AHORA);
    expect(veredicto.motivo).toBe('inactividad');
    expect(turno).toEqual({
      responde: 'asistente', tomadoPor: 'u-ana', tomadoEn: AHORA - 5 * MIN, actividadPersonaEn: act,
      devueltoEn: act + INACTIVIDAD_MS, motivoDevolucion: 'inactividad',
    });
  });

  it('vencido por la ventana: devueltoEn = el cierre de la ventana, motivo «ventana»', () => {
    const ultimo = AHORA - 30 * HORA;
    const { turno } = turnoEfectivo(guardado(), conv(ultimo), AHORA);
    expect(turno).toMatchObject({ responde: 'asistente', devueltoEn: ultimo + VENTANA_META_MS, motivoDevolucion: 'ventana' });
  });

  it('vencido por la ventana sin dato de ella: devueltoEn = ahora', () => {
    expect(turnoEfectivo(guardado(), conv(null), AHORA).turno).toMatchObject({ responde: 'asistente', devueltoEn: AHORA, motivoDevolucion: 'ventana' });
  });

  it('ya devuelto: se devuelve tal cual (no se le agrega un vencimiento)', () => {
    const t = guardado({ responde: 'asistente', devueltoEn: ts(AHORA - MIN), motivoDevolucion: 'manual' });
    expect(turnoEfectivo(t, conv(), AHORA).turno).toMatchObject({ responde: 'asistente', devueltoEn: AHORA - MIN, motivoDevolucion: 'manual' });
  });

  it('ilegible por fechas del futuro: turno null', () => {
    expect(turnoEfectivo(guardado({ actividadPersonaEn: ts(AHORA + HORA) }), conv(), AHORA).turno).toBeNull();
  });
});

// ===========================================================================
describe('ventanaDeMetaAbierta', () => {
  const ultimo = AHORA - HORA;
  it('abierta a las 23 h, cerrada a las 24 h exactas (sin margen)', () => {
    expect(ventanaDeMetaAbierta(ts(AHORA - 23 * HORA), AHORA)).toBe(true);
    expect(ventanaDeMetaAbierta(ts(AHORA - VENTANA_META_MS + 1), AHORA)).toBe(true);
    expect(ventanaDeMetaAbierta(ts(AHORA - VENTANA_META_MS), AHORA)).toBe(false);
  });
  it('con el margen de envío de 60 s, cierra 60 s antes', () => {
    const u = AHORA - VENTANA_META_MS + MARGEN_ENVIO_MS;
    expect(ventanaDeMetaAbierta(ts(u + 1), AHORA, MARGEN_ENVIO_MS)).toBe(true);
    expect(ventanaDeMetaAbierta(ts(u), AHORA, MARGEN_ENVIO_MS)).toBe(false);
  });
  it('sin dato, con un dato que no es fecha, o con una fecha del futuro a más de 5 min: cerrada', () => {
    expect(ventanaDeMetaAbierta(undefined, AHORA)).toBe(false);
    expect(ventanaDeMetaAbierta(null, AHORA)).toBe(false);
    expect(ventanaDeMetaAbierta(ultimo, AHORA)).toBe(false);
    expect(ventanaDeMetaAbierta(ts(AHORA + MARGEN_RELOJ_MS + 1), AHORA)).toBe(false);
    expect(ventanaDeMetaAbierta(ts(AHORA + MARGEN_RELOJ_MS), AHORA)).toBe(true);
    expect(ventanaDeMetaAbierta(ts(ultimo), Number.NaN)).toBe(false);
  });
});

// ===========================================================================
describe('personaPuedeEscribirDeFicha: solo `true` exacto', () => {
  it('true habilita; todo lo demás (ausente, false, texto, número, objeto, ficha ausente) no', () => {
    expect(personaPuedeEscribirDeFicha({ personaPuedeEscribir: true })).toBe(true);
    for (const v of [false, 'true', 'TRUE', 1, 0, null, undefined, {}, [true]]) {
      expect(personaPuedeEscribirDeFicha({ personaPuedeEscribir: v }), String(v)).toBe(false);
    }
    expect(personaPuedeEscribirDeFicha({})).toBe(false);
    expect(personaPuedeEscribirDeFicha(null)).toBe(false);
    expect(personaPuedeEscribirDeFicha(undefined)).toBe(false);
  });
});

// ===========================================================================
describe('los errores fijos', () => {
  it('la lista cerrada de códigos y mensajes (el contrato con la consola)', () => {
    expect(ErroresDeTurno).toEqual({
      sinSesion: { code: 'unauthenticated', message: 'Inicie sesión.' },
      sinPermiso: { code: 'permission-denied', message: 'No tiene permiso para atender esta conversación.' },
      noHabilitado: { code: 'permission-denied', message: 'Esta función no está habilitada para su comercio.' },
      sinSalida: { code: 'permission-denied', message: 'Esta función todavía no está activa para su negocio.' },
      solicitudInvalida: { code: 'invalid-argument', message: 'Solicitud inválida.' },
      noExiste: { code: 'not-found', message: 'La conversación no existe.' },
      ocupada: { code: 'failed-precondition', message: 'Esta conversación la atiende otra persona.' },
      noEsSuya: { code: 'failed-precondition', message: 'Solo quien atiende la conversación, o un administrador, puede devolverla.' },
      contactoBloqueado: { code: 'failed-precondition', message: 'Este contacto está bloqueado. Desbloquéelo para atenderlo.' },
      turnoVigente: { code: 'failed-precondition', message: 'Devuelva la conversación antes de bloquear el contacto.' },
      ventanaCerrada: { code: 'failed-precondition', message: 'La ventana de 24 horas de esta conversación está cerrada.' },
      tope: { code: 'resource-exhausted', message: 'Alcanzó el tope de cambios de atención por hora o por día.' },
      noDisponible: { code: 'unavailable', message: 'No se pudo completar la operación. Intente de nuevo.' },
    });
  });
  it('ningún mensaje lleva un id, un teléfono, una ruta ni voseo', () => {
    for (const { message } of Object.values(ErroresDeTurno)) {
      expect(message).not.toMatch(/wa_|tenants\/|\d{6,}|\bvos\b|\btenés\b|\bpodés\b/);
    }
  });
});

// ===========================================================================
describe('comercios excluidos de la intervención (Bellido)', () => {
  it('la lista fija es la de Bellido', () => {
    expect([...TENANTS_EXCLUIDOS]).toEqual(['bellido']);
  });

  it('coincide si el id ES el excluido o LO CONTIENE, sin mayúsculas ni tildes', () => {
    for (const id of ['bellido', 'consultorio-bellido', 'bellido2', 'bellido-sur', 'xbellidox', 'BELLIDO', 'Béllido']) {
      expect(esTenantExcluido(id), id).toBe(true);
    }
    for (const id of ['tienda-a', 'qtaco', 'bello', 'belido', 'dhermacore', '', 'platinum']) {
      expect(esTenantExcluido(id), id).toBe(false);
    }
    for (const v of [undefined, null, 7, {}, ['bellido']]) expect(esTenantExcluido(v), String(v)).toBe(false);
  });

  it('el NOMBRE de la ficha es la segunda barrera', () => {
    expect(nombreExcluido('Consultorio Bellido')).toBe(true);
    expect(nombreExcluido('CONSULTORIO BÉLLIDO')).toBe(true);
    expect(nombreExcluido('Tienda A')).toBe(false);
    for (const v of [undefined, null, 7, {}]) expect(nombreExcluido(v), String(v)).toBe(false);
  });

  it('habilitado SOLO con `consolaConversaciones === "nueva"` y sin ser excluido (ni por id ni por nombre)', () => {
    const ok = { consolaConversaciones: 'nueva', nombre: 'Tienda A', estado: 'activo' };
    expect(habilitadoParaPersona('tienda-a', ok)).toBe(true);
    for (const bandera of ['clasica', 'Nueva', 'NUEVA', 'nueva ', '', true, 1, null, undefined, {}]) {
      expect(habilitadoParaPersona('tienda-a', { ...ok, consolaConversaciones: bandera }), String(bandera)).toBe(false);
    }
    expect(habilitadoParaPersona('tienda-a', { nombre: 'Tienda A' })).toBe(false); // bandera ausente
    expect(habilitadoParaPersona('tienda-a', null)).toBe(false);
    expect(habilitadoParaPersona('tienda-a', undefined)).toBe(false);
    expect(habilitadoParaPersona('consultorio-bellido', ok)).toBe(false); // el id
    expect(habilitadoParaPersona('tienda-a', { ...ok, nombre: 'Consultorio Bellido' })).toBe(false); // el nombre
  });

  it('la lista es la MISMA que usa el script de plataforma que enciende la bandera (se lee su texto: Core no lo importa)', () => {
    const script = readFileSync(join(aqui, '..', '..', 'scripts', 'plataforma', 'aplicar-consola-conversaciones.mjs'), 'utf8');
    const lista = /export const TENANTS_EXCLUIDOS = Object\.freeze\(\[([^\]]*)\]\)/.exec(script);
    expect(lista, 'el script ya no declara TENANTS_EXCLUIDOS como antes').not.toBeNull();
    const delScript = (lista?.[1] ?? '').split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
    expect([...TENANTS_EXCLUIDOS]).toEqual(delScript);
    // Y la misma regla de coincidencia: el id ES uno de la lista o LO CONTIENE; el nombre solo lo contiene.
    expect(script).toContain('excluidos(env).some((x) => t === x || t.includes(x))');
    expect(script).toContain('excluidos(env).some((x) => n.includes(x))');
  });
});

// ===========================================================================
describe('las opciones de despliegue', () => {
  it('producción: us-east1, 5 instancias, concurrencia 10, App Check', () => {
    expect(opcionesDeTurno({})).toEqual({ region: 'us-east1', maxInstances: 5, concurrency: 10, enforceAppCheck: true });
  });
  it('staging (CPU fraccionaria): sin concurrencia y sin App Check', () => {
    const o = opcionesDeTurno({ CPU_FRACCIONARIA: 'si' });
    expect(o).toEqual({ region: 'us-east1', maxInstances: 5, enforceAppCheck: false });
    expect('concurrency' in o).toBe(false);
  });
  it('emulador: sin App Check', () => {
    expect(opcionesDeTurno({ FUNCTIONS_EMULATOR: 'true' }).enforceAppCheck).toBe(false);
  });
  it('las constantes de despliegue y de tope', () => {
    expect([MAX_INSTANCIAS_DE_TURNO, CONCURRENCIA_DE_TURNO, TOPE_DE_TURNO_POR_HORA, TOPE_DE_TURNO_POR_DIA]).toEqual([5, 10, 60, 300]);
  });
  it('del teléfono, solo los últimos 4 dígitos, y solo de un id de conversación válido', () => {
    expect(ultimos4('wa_59100000001')).toBe('0001');
    for (const v of ['59100000001', 'wa_12', undefined, 7, 'wa_5910000000a']) expect(ultimos4(v), String(v)).toBeUndefined();
  });
  it('turno.ts no importa NADA (ni Firebase ni otro archivo)', () => {
    const fuente = readFileSync(join(aqui, '..', '..', 'functions', 'src', 'core', 'conversacion', 'turno.ts'), 'utf8');
    expect(fuente.replace(/\/\*[\s\S]*?\*\//g, '').match(/^\s*import\s/gm)).toBeNull();
  });
});
