/**
 * LOS CSV DE LA CONSOLA NO EJECUTAN FÓRMULAS (OWASP «CSV injection»), Y
 * PEDIDOS MUESTRA Y EXPORTA LA REFERENCIA PARA LLEGAR.
 *
 * Pedidos exporta texto escrito por el cliente final (nota, dirección,
 * referencia). Una nota «=HYPERLINK(...)» entrecomillada igual se ejecuta al
 * abrir el archivo en Excel o Sheets. Esta suite lo demuestra NEGANDO: ninguna
 * celda de TEXTO sale empezando con `=`, `+`, `-`, `@`, tabulación o retorno;
 * los NÚMEROS reales (un monto negativo) no se tocan; y el catálogo exportado
 * se vuelve a leer idéntico (ida y vuelta).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  aCsvGenerico, neutralizarFormula, quitarNeutralizacion,
} from '../../../web/src/central/lib/exportar.ts';
import { aCsv, partirCsv, validarCsv, type FilaCatalogo } from '../../../web/src/central/lib/csv.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const PEDIDOS = readFileSync(join(aqui, '../../../web/src/modulos/pedidos/Pedidos.tsx'), 'utf8');

const PELIGROSAS = [
  '=HYPERLINK("https://malo.example","clic")', '=1+1', '+1', '-2', '@x', '@SUM(A1)',
  '\t=1+1', '\r=1+1', '\t', '=cmd|\' /C calc\'!A0', '-2+3', '+591 70000000',
];

/** Las filas de datos de un CSV generado por `aCsvGenerico` (sin `sep=;` ni encabezado). */
function leer(csv: string): string[][] {
  const filas = partirCsv(csv);
  return filas.slice(2);
}

describe('exportar.ts: el texto no puede ser una fórmula', () => {
  it('cada texto peligroso sale con «\'» delante', () => {
    for (const t of PELIGROSAS) {
      expect(neutralizarFormula(t)).toBe(`'${t}`);
      expect(neutralizarFormula(t)).not.toMatch(/^[=+\-@\t\r]/);
    }
  });

  it('el texto común no cambia', () => {
    for (const t of ['', 'Calle 1', 'sin cebolla', '1× pizza', 'a=b', 'x-y', 'a@b', ' =x']) {
      expect(neutralizarFormula(t)).toBe(t);
    }
  });

  it('en el archivo, ninguna celda de texto del cliente empieza peligrosa (nota, dirección, referencia)', () => {
    const filas = PELIGROSAS.map((t) => ['2026-10-06', t, t, t, 'ok']);
    const csv = aCsvGenerico(['Cuándo', 'Nota', 'Dirección', 'Referencia', 'Estado'], filas);
    expect(csv.startsWith('﻿sep=;')).toBe(true);
    // Mirada directa al archivo: toda celda entrecomillada empieza por una
    // comilla doble y luego por un carácter que NO es peligroso.
    for (const celda of csv.matchAll(/(?:^|;)"((?:[^"]|"")*)"/gm)) {
      expect(celda[1]).not.toMatch(/^[=+\-@\t\r]/);
    }
    for (const f of leer(csv)) {
      expect(f.length).toBe(5);
      for (const v of f.slice(1, 4)) expect(v).toMatch(/^'/);
    }
  });

  it('una celda de texto con comillas y punto y coma sigue siendo UNA celda', () => {
    const csv = aCsvGenerico(['A', 'B'], [['=1;2";3', 'x']]);
    const [fila] = leer(csv);
    expect(fila).toEqual(['\'=1;2";3', 'x']);
  });

  it('un número real no se toca: un monto negativo sigue siendo número', () => {
    const csv = aCsvGenerico(['Monto', 'Texto'], [[-25.5, '-25.5'], [0, '+3'], [120, '@a']]);
    const filas = leer(csv);
    expect(filas[0]).toEqual(['-25.5', '\'-25.5']);
    expect(filas[1]).toEqual(['0', '\'+3']);
    expect(filas[2]).toEqual(['120', '\'@a']);
  });

  it('null, undefined y fechas pasan por su camino de siempre', () => {
    const csv = aCsvGenerico(['A', 'B', 'C'], [[null, undefined, new Date(Date.UTC(2026, 9, 6, 12))]]);
    const [fila] = leer(csv);
    expect(fila[2]).toMatch(/^\d/);
  });

  it('quitarNeutralizacion devuelve exactamente lo que había (ida y vuelta)', () => {
    for (const t of [...PELIGROSAS, "'=x", "''=x", "'", "'a", 'normal', '', "'-1"]) {
      expect(quitarNeutralizacion(neutralizarFormula(t))).toBe(t);
    }
  });

  it('el texto que ya empieza con «\'» y luego peligroso no se confunde con una neutralización', () => {
    expect(neutralizarFormula("'=x")).toBe("''=x");
    expect(quitarNeutralizacion("''=x")).toBe("'=x");
    // «'abc» no lo puso nadie al neutralizar: se lee tal cual.
    expect(quitarNeutralizacion("'abc")).toBe("'abc");
  });
});

describe('csv.ts: el catálogo exportado no ejecuta fórmulas y se lee igual', () => {
  const fila = (extra: Partial<FilaCatalogo>): FilaCatalogo => ({
    nombre: 'Pizza', descripcion: '', area: 'gastronomia', precio: 45.5, moneda: 'BOB',
    duracionMin: 30, imagenUrl: 'https://e.com/p.jpg', activo: true, cantidad: 7, ...extra,
  });

  it('nombre, descripción y área peligrosos salen neutralizados y los números no', () => {
    const csv = aCsv([fila({
      nombre: '=HYPERLINK("https://malo.example","x")', descripcion: '+1', area: '@x',
      precio: 10, cantidad: 0,
    })]);
    for (const celda of csv.matchAll(/(?:^|,)"((?:[^"]|"")*)"/gm)) {
      expect(celda[1]).not.toMatch(/^[=+\-@\t\r]/);
    }
    const [, datos] = partirCsv(csv);
    expect(datos?.[0]).toBe('\'=HYPERLINK("https://malo.example","x")');
    expect(datos?.[1]).toBe("'+1");
    expect(datos?.[3]).toBe('10');
    expect(datos?.[7]).toBe('0');
  });

  it('ida y vuelta: lo exportado se importa idéntico, también el texto peligroso', () => {
    const nombres = ['=SUMA(1;2)', '+591 combo', '-Promo', '@oferta', "'=raro", 'Normal'];
    const csv = aCsv(nombres.map((nombre, i) => fila({
      nombre, descripcion: nombre, area: 'gastronomia', precio: i, cantidad: i + 1,
    })));
    const vuelta = validarCsv(csv, false);
    expect(vuelta.error).toBe(null);
    expect(vuelta.filas.map((f) => f.fila.nombre)).toEqual(nombres);
    expect(vuelta.filas.map((f) => f.fila.descripcion)).toEqual(nombres);
    expect(vuelta.filas.map((f) => f.fila.precio)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(vuelta.filas.map((f) => f.fila.cantidad)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const f of vuelta.filas) expect(f.problemas).toEqual([]);
  });

  it('un archivo ajeno con «=x» en el nombre se importa como texto y se re-exporta neutralizado', () => {
    const entrada = 'nombre,precio\r\n"=1+1",5\r\n';
    const dentro = validarCsv(entrada, false).filas[0]!.fila;
    expect(dentro.nombre).toBe('=1+1');
    const fuera = aCsv([fila({ nombre: dentro.nombre })]);
    expect(partirCsv(fuera)[1]?.[0]).toBe("'=1+1");
  });

  it('un nombre de 80 caracteres que empieza con «=» sobrevive a la vuelta sin recortarse', () => {
    const nombre = `=${'a'.repeat(79)}`;
    const vuelta = validarCsv(aCsv([fila({ nombre })]), false);
    expect(vuelta.filas[0]?.fila.nombre).toBe(nombre);
  });
});

describe('Pedidos: la referencia para llegar', () => {
  it('se lee del pedido, se muestra solo si hay y va por TextoSeguro', () => {
    expect(PEDIDOS).toMatch(/referencia\?: unknown/);
    expect(PEDIDOS).toMatch(/typeof p\.referencia === 'string' && p\.referencia !== ''/);
    expect(PEDIDOS).toMatch(/Referencia: <TextoSeguro valor=\{p\.referencia\} maxLargo=\{200\} \/>/);
  });

  it('entra a la exportación, en su columna, y la exportación pasa por aCsvGenerico (neutraliza)', () => {
    expect(PEDIDOS).toContain("'Dirección', 'Referencia', 'Ítems'");
    expect(PEDIDOS).toMatch(/p\.direccion,\s*p\.referencia,/);
    expect(PEDIDOS).toContain("import { descargarCsv } from '../../central/lib/exportar'");
  });

  it('la fila de un pedido real: nota, dirección y referencia hostiles salen neutralizadas; sin referencia, columna vacía', () => {
    const encabezado = ['Cuándo', 'Cliente', 'Entrega', 'Dirección', 'Referencia', 'Ítems', 'Nota', 'Total', 'Moneda', 'Estado'];
    const pedido = (extra: Record<string, unknown>) => [
      '06/10/2026', '+591 7***000', 'envio', extra['direccion'], extra['referencia'],
      '1× Pizza', extra['nota'], extra['total'], 'BOB', 'recibido',
    ];
    const csv = aCsvGenerico(encabezado, [
      pedido({ direccion: '=Av 1', referencia: '@media cuadra del gas', nota: '=HYPERLINK("x")', total: -5 }),
      pedido({ direccion: 'Calle 1', total: 50 }), // pedido viejo, sin referencia ni nota
    ]);
    const [a, b] = leer(csv);
    expect(a?.[3]).toBe("'=Av 1");
    expect(a?.[4]).toBe("'@media cuadra del gas");
    expect(a?.[6]).toBe('\'=HYPERLINK("x")');
    expect(a?.[7]).toBe('-5');
    expect(b?.[4] ?? '').toBe('');
    expect(b?.[3]).toBe('Calle 1');
  });
});
