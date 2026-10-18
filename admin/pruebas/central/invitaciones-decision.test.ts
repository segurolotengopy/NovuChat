/**
 * INVITACIONES — la decisión pura (sin emuladores ni red). Se prueba negando, con control positivo.
 */
import { describe, expect, it } from 'vitest';
import {
  MENSAJE, TOPE_PENDIENTES, TOPE_REENVIOS, VIGENCIA_INVITACION_DIAS, decidirInvitar, decidirResponder,
  esIdInvitacion, estadoEfectivo, idInvitacion, normalizarCorreo, venceEnDesde,
} from '../../functions/src/central/invitacionesDecision.ts';

const AHORA = 1_800_000_000_000;
const DIA = 24 * 60 * 60 * 1000;
const base = {
  rol: 'oper' as const, hayTitular: false, invitadorEsTitular: false, yaMiembro: false, existente: null, vigentesOtras: 0,
};

describe('correo e identificadores', () => {
  it('normaliza y rechaza lo que no es un correo', () => {
    expect(normalizarCorreo('  Ana@Ejemplo.COM ')).toBe('ana@ejemplo.com');
    for (const malo of ['', 'sin-arroba', 'a@b', 'a b@ejemplo.com', 7, null, undefined, {}, `${"x".repeat(250)}@ejemplo.com`]) {
      expect(normalizarCorreo(malo)).toBeNull();
    }
  });
  it('el id es el sha256 del correo normalizado (mismo correo = misma invitación)', () => {
    expect(idInvitacion('ana@ejemplo.com')).toMatch(/^[a-f0-9]{64}$/);
    expect(idInvitacion('ana@ejemplo.com')).toBe(idInvitacion(normalizarCorreo('ANA@ejemplo.com')!));
    expect(idInvitacion('ana@ejemplo.com')).not.toBe(idInvitacion('beto@ejemplo.com'));
  });
  it('ids hostiles se rechazan (barras, __proto__, 65 caracteres, mayúsculas, no texto)', () => {
    const ok = 'a'.repeat(64);
    expect(esIdInvitacion(ok)).toBe(true); // control
    for (const malo of ['a/b', '__proto__', 'a'.repeat(65), 'a'.repeat(63), 'A'.repeat(64), `${'a'.repeat(63)}/`, 7, null, {}, '..']) {
      expect(esIdInvitacion(malo)).toBe(false);
    }
  });
});

describe('estado efectivo y vigencia', () => {
  it('la vigencia es de 7 días', () => {
    expect(VIGENCIA_INVITACION_DIAS).toBe(7);
    expect(venceEnDesde(AHORA)).toBe(AHORA + 7 * DIA);
  });
  it('una pendiente con el plazo pasado es vencida; una vigente sigue pendiente (control)', () => {
    expect(estadoEfectivo({ estado: 'pendiente', venceEn: AHORA + DIA }, AHORA)).toBe('pendiente');
    expect(estadoEfectivo({ estado: 'pendiente', venceEn: AHORA - 1 }, AHORA)).toBe('vencida');
    expect(estadoEfectivo({ estado: 'pendiente', venceEn: AHORA }, AHORA)).toBe('vencida');
  });
  it('un documento dañado falla cerrado (sin plazo, plazo raro, estado desconocido)', () => {
    expect(estadoEfectivo({ estado: 'pendiente' }, AHORA)).toBe('vencida');
    expect(estadoEfectivo({ estado: 'pendiente', venceEn: 'mañana' }, AHORA)).toBe('vencida');
    expect(estadoEfectivo({ estado: 'activa', venceEn: AHORA + DIA }, AHORA)).toBeNull();
    expect(estadoEfectivo(undefined, AHORA)).toBeNull();
  });
  it('lo resuelto sigue resuelto aunque el plazo siga corriendo', () => {
    for (const e of ['aceptada', 'revocada', 'vencida'] as const) {
      expect(estadoEfectivo({ estado: e, venceEn: AHORA + DIA }, AHORA)).toBe(e);
    }
  });
});

describe('decidirInvitar', () => {
  it('CONTROL: un operador nuevo se crea', () => {
    expect(decidirInvitar(base)).toEqual({ ok: true, accion: 'crear', reenvios: 0 });
  });
  it('invitar a un miembro (o al titular, que es miembro) se rechaza', () => {
    expect(decidirInvitar({ ...base, yaMiembro: true })).toEqual({ ok: false, code: 'already-exists', mensaje: MENSAJE.yaEsMiembro });
    expect(decidirInvitar({ ...base, rol: 'admin', hayTitular: true, invitadorEsTitular: true, yaMiembro: true }))
      .toMatchObject({ ok: false, mensaje: MENSAJE.yaEsMiembro });
  });
  it('un admin que no es titular no invita admins si el negocio tiene titular', () => {
    expect(decidirInvitar({ ...base, rol: 'admin', hayTitular: true })).toMatchObject({ ok: false, code: 'permission-denied' });
  });
  it('CONTROL: sin titular un admin invita admins; el titular también; oper siempre', () => {
    expect(decidirInvitar({ ...base, rol: 'admin' })).toMatchObject({ ok: true });
    expect(decidirInvitar({ ...base, rol: 'admin', hayTitular: true, invitadorEsTitular: true })).toMatchObject({ ok: true });
    expect(decidirInvitar({ ...base, hayTitular: true })).toMatchObject({ ok: true });
  });
  it('tope de pendientes: la 21 se rechaza y la 20 pasa', () => {
    expect(TOPE_PENDIENTES).toBe(20);
    expect(decidirInvitar({ ...base, vigentesOtras: 19 })).toMatchObject({ ok: true });
    expect(decidirInvitar({ ...base, vigentesOtras: 20 })).toEqual({ ok: false, code: 'resource-exhausted', mensaje: MENSAJE.topePendientes });
  });
  it('renovar una pendiente vigente no suma al tope aunque el negocio esté lleno', () => {
    expect(decidirInvitar({ ...base, vigentesOtras: 20, existente: { estado: 'pendiente', reenvios: 0 } }))
      .toEqual({ ok: true, accion: 'renovar', reenvios: 1 });
  });
  it('renovar una vencida SÍ suma al tope', () => {
    expect(decidirInvitar({ ...base, vigentesOtras: 20, existente: { estado: 'vencida', reenvios: 0 } }))
      .toMatchObject({ ok: false, mensaje: MENSAJE.topePendientes });
  });
  it('reenvíos: el 5.º pasa y el 6.º se rechaza', () => {
    expect(TOPE_REENVIOS).toBe(5);
    expect(decidirInvitar({ ...base, existente: { estado: 'pendiente', reenvios: 4 } })).toEqual({ ok: true, accion: 'renovar', reenvios: 5 });
    expect(decidirInvitar({ ...base, existente: { estado: 'pendiente', reenvios: 5 } }))
      .toEqual({ ok: false, code: 'resource-exhausted', mensaje: MENSAJE.topeReenvios });
    expect(decidirInvitar({ ...base, existente: { estado: 'vencida', reenvios: 5 } })).toMatchObject({ ok: false });
  });
  it('reenvios corruptos (negativo, NaN, texto) no abren ni cierran de más', () => {
    for (const r of [-3, Number.NaN, Number.POSITIVE_INFINITY * 0]) {
      expect(decidirInvitar({ ...base, existente: { estado: 'pendiente', reenvios: r } })).toMatchObject({ ok: true, reenvios: 1 });
    }
  });
  it('tras cancelar o aceptar-y-quitar se crea de nuevo con reenvíos en cero', () => {
    for (const estado of ['revocada', 'aceptada'] as const) {
      expect(decidirInvitar({ ...base, existente: { estado, reenvios: 5 } })).toEqual({ ok: true, accion: 'crear', reenvios: 0 });
    }
  });
});

describe('decidirResponder', () => {
  const correo = 'ana@ejemplo.com';
  const vigente = { correo, estado: 'pendiente', venceEn: AHORA + DIA };
  const p = { correoToken: correo, inv: vigente, ahoraMs: AHORA, negocioDeBaja: false, respuesta: 'aceptar' as const, tieneAcceso: false };
  it('CONTROL: pendiente, vigente, del mismo correo y sin rol previo se acepta', () => {
    expect(decidirResponder(p)).toEqual({ ok: true });
    expect(decidirResponder({ ...p, respuesta: 'rechazar', tieneAcceso: true })).toEqual({ ok: true });
  });
  it('otro correo, ausente o dañada: not-found uniforme', () => {
    for (const inv of [{ ...vigente, correo: 'beto@ejemplo.com' }, undefined, { ...vigente, correo: 7 }, { correo, estado: 'rara' }]) {
      expect(decidirResponder({ ...p, inv })).toEqual({ ok: false, code: 'not-found', mensaje: MENSAJE.noEncontrada });
    }
  });
  it('vencida: no vigente y pide persistir; aceptada o revocada: no vigente sin persistir', () => {
    expect(decidirResponder({ ...p, ahoraMs: AHORA + 8 * DIA })).toEqual({
      ok: false, code: 'failed-precondition', mensaje: MENSAJE.noVigente, persistirVencida: true,
    });
    for (const estado of ['aceptada', 'revocada', 'vencida']) {
      const r = decidirResponder({ ...p, inv: { ...vigente, estado } });
      expect(r).toMatchObject({ ok: false, mensaje: MENSAJE.noVigente });
      expect(r).not.toHaveProperty('persistirVencida');
    }
  });
  it('negocio dado de baja: no encontrada; ya tiene acceso: solo al aceptar', () => {
    expect(decidirResponder({ ...p, negocioDeBaja: true })).toMatchObject({ code: 'not-found' });
    expect(decidirResponder({ ...p, tieneAcceso: true })).toEqual({ ok: false, code: 'already-exists', mensaje: MENSAJE.yaTieneAcceso });
  });
});

describe('mensajes exactos del diseño', () => {
  it('no cambian sin pasar por el diseño', () => {
    expect(MENSAJE.invitada).toBe('Si ese correo corresponde a una cuenta de NovuChat, la persona verá la invitación al ingresar. Vence en 7 días.');
    expect(MENSAJE.yaEsMiembro).toBe('Esa persona ya es usuaria de este negocio.');
    expect(MENSAJE.topePendientes).toBe('Este negocio tiene 20 invitaciones pendientes. Cancele alguna antes de invitar de nuevo.');
    expect(MENSAJE.topeReenvios).toBe('Esta invitación ya se reenvió 5 veces. Cancélela y vuelva a invitar.');
    expect(MENSAJE.noEncontrada).toBe('Invitación no encontrada o ya no disponible.');
    expect(MENSAJE.noVigente).toBe('Esta invitación ya no está vigente. Pida que se la envíen de nuevo.');
    expect(MENSAJE.yaTieneAcceso).toBe('Ya tiene acceso a este negocio.');
    expect(MENSAJE.sesion).toBe('Ingrese con su correo y contraseña, con el correo verificado, para responder invitaciones.');
    expect(MENSAJE.rechazada).toBe('Invitación rechazada.');
    expect(MENSAJE.cancelada).toBe('Invitación cancelada.');
  });
});
