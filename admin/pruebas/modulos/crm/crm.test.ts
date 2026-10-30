import { describe, expect, it } from 'vitest';
import { crmActivo, recordatoriosActivos } from '../../../functions/src/modulos/crm/crm.js';
import {
  CAMPOS_DEL_BOT, CAMPOS_DEL_EQUIPO, COLUMNAS_V1, columnasEscribibles, neutralizarTexto,
} from '../../../functions/src/modulos/crm/columnas.js';

describe('crm: encendido por defecto', () => {
  it('sin documento o sin `activo`, está encendido; solo `false` lo apaga', () => {
    expect(crmActivo(null)).toBe(true);
    expect(crmActivo(undefined)).toBe(true);
    expect(crmActivo({})).toBe(true);
    expect(crmActivo({ activo: 'no' })).toBe(true);
    expect(crmActivo({ activo: true })).toBe(true);
    expect(crmActivo({ activo: false })).toBe(false);
  });
  it('los recordatorios ausentes o ilegibles están APAGADOS', () => {
    expect(recordatoriosActivos(null)).toBe(false);
    expect(recordatoriosActivos({})).toBe(false);
    expect(recordatoriosActivos({ recordatorios: {} })).toBe(false);
    expect(recordatoriosActivos({ recordatorios: { activo: 'true' } })).toBe(false);
    expect(recordatoriosActivos({ recordatorios: { activo: true } })).toBe(true);
  });
});

describe('crm: el bot nunca escribe lo del equipo', () => {
  const todo = Object.fromEntries(COLUMNAS_V1.map((c, i) => [c.campo, String.fromCharCode(65 + i)]));
  it('con un mapa que trae todo, solo salen los campos del bot', () => {
    const e = Object.keys(columnasEscribibles(todo));
    expect(e.sort()).toEqual([...CAMPOS_DEL_BOT].sort());
    for (const c of CAMPOS_DEL_EQUIPO) expect(e).not.toContain(c);
  });
  it('el contrato: 4 del equipo y las 6 nuevas son del bot', () => {
    expect(CAMPOS_DEL_EQUIPO).toEqual(['valor', 'responsable', 'estado', 'proximaAccion']);
    expect(COLUMNAS_V1.filter((c) => c.nueva).map((c) => c.dueno)).toEqual(Array(6).fill('bot'));
  });
  it('letras inválidas, campos desconocidos y letras repetidas no se escriben', () => {
    const e = columnasEscribibles({ nombre: 'b', telefono: 'b', empresa: 'xx1', raro: 'Z', origen: 'C', valor: 'D' });
    expect(e).toEqual({ origen: 'C' });
    expect(columnasEscribibles(null)).toEqual({});
  });
  it('ninguna columna del contrato nombra salud ni comprobantes', () => {
    for (const c of COLUMNAS_V1) expect(c.titulo + c.campo).not.toMatch(/salud|diagn|receta|historia|comprobante|pago/i);
  });
});

describe('crm: un texto del cliente nunca es una fórmula', () => {
  it.each(['=SUMA(A1)', '+591', '-1', '@usuario', '  =1+1', '\t=cmd', '\n=1', '\r\n=1', '\u00A0=1', '\uFEFF=1', '\u200B=1', '\u200B\u00A0@x'])('%s se neutraliza', (t) => {
    expect(neutralizarTexto(t).startsWith("'")).toBe(true);
  });
  it('un texto normal queda igual, lo no textual da vacío y se acota el largo', () => {
    expect(neutralizarTexto('Ana Pérez')).toBe('Ana Pérez');
    expect(neutralizarTexto(42)).toBe('');
    expect(neutralizarTexto('x'.repeat(900)).length).toBe(500);
  });
});
