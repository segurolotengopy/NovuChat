import { describe, expect, it } from 'vitest';
// Las pruebas de la planilla de las subcuentas (PR-E) viven en crm-planilla.ts, sin sufijo .test para no pedir otra entrada en SUITES_PURAS: corren aquí.
import './crm-planilla.ts';
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
  const todo = Object.fromEntries(COLUMNAS_V1.map((c, i) => [c.campo, i < 26 ? String.fromCharCode(65 + i) : `A${String.fromCharCode(65 + i - 26)}`]));
  it('con un mapa que trae todo, solo salen los campos del bot', () => {
    const e = Object.keys(columnasEscribibles(todo));
    expect(e.sort()).toEqual([...CAMPOS_DEL_BOT].sort());
    for (const c of CAMPOS_DEL_EQUIPO) expect(e).not.toContain(c);
  });
  it('el contrato: 5 del equipo (con el diagnóstico); de las 14 nuevas, 13 son del bot y solo el diagnóstico es del equipo', () => {
    expect(CAMPOS_DEL_EQUIPO).toEqual(['valor', 'responsable', 'estado', 'proximaAccion', 'diagnostico']);
    const nuevas = COLUMNAS_V1.filter((c) => c.nueva);
    expect(nuevas.filter((c) => c.dueno === 'bot')).toHaveLength(13);
    expect(nuevas.filter((c) => c.dueno === 'equipo').map((c) => c.campo)).toEqual(['diagnostico']);
    for (const c of ['clasificacion', 'quePidio', 'diaPreferido', 'horarioPreferido', 'derivacion', 'ultimaInteraccion', 'ventana24h']) expect(CAMPOS_DEL_BOT).toContain(c);
    expect(CAMPOS_DEL_BOT).not.toContain('diagnostico');
    expect(columnasEscribibles({ diagnostico: 'U', clasificacion: 'N' })).toEqual({ clasificacion: 'N' });
    expect(CAMPOS_DEL_BOT).toContain('interes');
  });
  it('letras inválidas, campos desconocidos y letras repetidas no se escriben', () => {
    const e = columnasEscribibles({ nombre: 'b', telefono: 'b', empresa: 'xx1', raro: 'Z', origen: 'C', valor: 'D' });
    expect(e).toEqual({ origen: 'C' });
    expect(columnasEscribibles(null)).toEqual({});
  });
  it('ninguna columna del contrato nombra salud ni comprobantes', () => {
    // `diagnostico` es una columna del EQUIPO (notas suyas, el bot no la escribe): lo que se vigila es lo que el bot escribe.
    for (const c of COLUMNAS_V1.filter((x) => x.dueno === 'bot')) expect(c.titulo + c.campo).not.toMatch(/salud|diagn|receta|historia|comprobante|pago/i);
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
