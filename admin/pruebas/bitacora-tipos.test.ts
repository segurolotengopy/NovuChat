/**
 * LOS TIPOS DE LA BITÁCORA: una lista, tres lectores.
 *
 * La ingesta (`functions/src/ingesta.ts`, `TipoEvento`) decide qué eventos se
 * escriben. Las reglas (`eventoValido()` de `/bitacora`) dicen qué tipos acepta
 * la colección, y la consola (`web/src/lib/bitacora.ts`, `TIPOS`) cuáles se
 * pueden filtrar. El 15/09 la ingesta ya escribía `derivacion_operador`,
 * `bloqueo_ventana` y `aviso_consumo`, y ninguna de las otras dos listas los
 * tenía: la regla los habría rechazado el día que la ingesta escriba sujeta a
 * reglas (Fase 2 de DISENO.md), y la consola no dejaba buscarlos.
 *
 * El criterio de las tres es el mismo —todo lo que la ingesta escribe—, así
 * que la prueba exige que sean IGUALES, no solo que una contenga a la otra.
 * No necesita emulador: lee las fuentes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TIPOS } from '../web/src/lib/bitacora.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const leer = (ruta: string) => readFileSync(join(aqui, '..', ruta), 'utf8');
const literales = (texto: string) => [...texto.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);

/** Los tipos de `type TipoEvento = ... ;` de la ingesta, sin los comentarios. */
function deLaIngesta(): string[] {
  const fuente = leer('functions/src/ingesta.ts');
  const m = fuente.match(/type TipoEvento =([\s\S]*?);/);
  if (!m) throw new Error('no se encontró `type TipoEvento` en ingesta.ts');
  return literales(m[1]!.replace(/\/\/.*$/gm, ''));
}

/** Los tipos de `d.get('tipo', '') in [...]` de la regla de la bitácora. */
function deLasReglas(): string[] {
  const reglas = leer('firestore.rules');
  const desde = reglas.indexOf('match /bitacora/{eventoId}');
  const m = reglas.slice(desde).match(/d\.get\('tipo', ''\) in \[([\s\S]*?)\]/);
  if (desde < 0 || !m) throw new Error('no se encontró la lista de tipos de /bitacora en firestore.rules');
  return literales(m[1]!.replace(/\/\/.*$/gm, ''));
}

describe('Tipos de la bitácora', () => {
  it('la ingesta declara los eventos del 15/09 (control de que el lector funciona)', () => {
    expect(deLaIngesta()).toEqual(expect.arrayContaining(
      ['mensaje_entrante', 'derivacion_operador', 'bloqueo_ventana', 'aviso_consumo']));
  });

  it('las reglas aceptan EXACTAMENTE los que la ingesta puede escribir', () => {
    expect([...deLasReglas()].sort()).toEqual([...deLaIngesta()].sort());
  });

  it('la consola deja filtrar EXACTAMENTE los que la ingesta puede escribir', () => {
    expect([...TIPOS].sort()).toEqual([...deLaIngesta()].sort());
  });

  it('ninguna lista repite un tipo', () => {
    for (const lista of [deLaIngesta(), deLasReglas(), [...TIPOS]]) {
      expect(new Set(lista).size).toBe(lista.length);
    }
  });
});
