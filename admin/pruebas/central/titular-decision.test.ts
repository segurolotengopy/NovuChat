/**
 * TITULAR DE LA CUENTA — la decisión pura (sin emuladores ni red).
 * Negando: quitar al titular se rechaza siempre; invitarlo como oper también.
 * Controles: sin titular, otro destino y reinvitarlo como admin se permiten.
 */
import { describe, expect, it } from 'vitest';
import { MOTIVO_TITULAR, decidirSobreTitular, titularDeFicha } from '../../functions/src/central/titular.ts';

describe('decidirSobreTitular', () => {
  it('quitar al titular se rechaza con el motivo', () => {
    expect(decidirSobreTitular({ accion: 'quitar', destino: 'TA', titular: 'TA' })).toBe(MOTIVO_TITULAR);
  });
  it('invitar al titular como oper (o sin rol, o con un rol raro) se rechaza', () => {
    for (const rol of ['oper', undefined, '', 'propietario']) {
      expect(decidirSobreTitular({ accion: 'invitar', destino: 'TA', titular: 'TA', rol })).toBe(MOTIVO_TITULAR);
    }
  });
  it('CONTROL: reinvitar al titular como admin se permite', () => {
    expect(decidirSobreTitular({ accion: 'invitar', destino: 'TA', titular: 'TA', rol: 'admin' })).toBeNull();
  });
  it('CONTROL: otro destino se permite en las dos acciones y cualquier rol', () => {
    expect(decidirSobreTitular({ accion: 'quitar', destino: 'otro', titular: 'TA' })).toBeNull();
    for (const rol of ['admin', 'oper']) {
      expect(decidirSobreTitular({ accion: 'invitar', destino: 'otro', titular: 'TA', rol })).toBeNull();
    }
  });
  it('CONTROL: sin titular todo se permite (como hoy)', () => {
    expect(decidirSobreTitular({ accion: 'quitar', destino: 'TA', titular: null })).toBeNull();
    expect(decidirSobreTitular({ accion: 'invitar', destino: 'TA', titular: null, rol: 'oper' })).toBeNull();
  });
});

describe('titularDeFicha', () => {
  it('un texto no vacío es el titular', () => {
    expect(titularDeFicha({ titularCuentaUid: 'TA' })).toBe('TA');
  });
  it('devuelve el uid RECORTADO (con espacios no falla abierto)', () => {
    expect(titularDeFicha({ titularCuentaUid: '  TA \n' })).toBe('TA');
    expect(decidirSobreTitular({ accion: 'quitar', destino: 'TA', titular: titularDeFicha({ titularCuentaUid: ' TA ' }) })).toBe(MOTIVO_TITULAR);
  });
  it('campo ausente, ficha ausente, vacío, solo espacios, número, objeto, lista o booleano = sin titular', () => {
    for (const v of [undefined, '', '   ', 7, {}, ['TA'], true, null]) {
      expect(titularDeFicha({ titularCuentaUid: v })).toBeNull();
    }
    expect(titularDeFicha({})).toBeNull();
    expect(titularDeFicha(undefined)).toBeNull();
  });
});
