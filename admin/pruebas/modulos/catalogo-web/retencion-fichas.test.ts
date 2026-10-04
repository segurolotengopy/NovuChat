/**
 * RETENCIÓN DE LAS FICHAS DEL CATÁLOGO WEB (revisión de seguridad del PR #380).
 *
 * `fichasCatalogo` guarda el teléfono completo del cliente en cada ficha y en el
 * puntero `ult_<comercio>_<teléfono>`, y desde que el servidor reutiliza la ficha
 * por conversación se escribe una vez por cada conversación. Sin vencimiento, esa
 * colección acumula números de teléfono para siempre. El vencimiento es una
 * política TTL de Firestore sobre `caducaEn`.
 *
 * Esta prueba es pura (no abre Firestore): un TTL que alguien quite del archivo de
 * índices no rompe nada a la vista, solo deja de borrar. Por eso se prueba
 * negando: la misma comprobación, aplicada a una copia SIN el TTL, tiene que fallar.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(aqui, '..', '..', '..');

interface Override { collectionGroup: string; fieldPath: string; ttl?: unknown; indexes?: unknown[] }
interface ConfigIndices { fieldOverrides?: Override[] }

const config: ConfigIndices = JSON.parse(readFileSync(join(RAIZ, 'firestore.indexes.json'), 'utf8'));

/** ¿Declara el archivo un TTL (booleano `true`) sobre `fichasCatalogo.caducaEn`? */
function tieneTtlDeFichas(c: ConfigIndices): boolean {
  return (c.fieldOverrides ?? []).some((o) =>
    o.collectionGroup === 'fichasCatalogo' && o.fieldPath === 'caducaEn' && o.ttl === true);
}

describe('Retención de `fichasCatalogo`: TTL sobre `caducaEn`', () => {
  it('firestore.indexes.json declara el override TTL de fichasCatalogo.caducaEn', () => {
    expect(tieneTtlDeFichas(config)).toBe(true);
  });

  it('el override declara también sus índices (firebase-tools exige `indexes` en todo override)', () => {
    const o = config.fieldOverrides!.find((x) => x.collectionGroup === 'fichasCatalogo' && x.fieldPath === 'caducaEn')!;
    expect(Array.isArray(o.indexes)).toBe(true);
  });

  it('negando: sin `ttl`, con `ttl: false`, con otro campo u otra colección, la comprobación falla', () => {
    const sinTtl: ConfigIndices = { fieldOverrides: config.fieldOverrides!.map((o) => {
      const { ttl: _ttl, ...resto } = o; return resto;
    }) };
    expect(tieneTtlDeFichas(sinTtl)).toBe(false);
    expect(tieneTtlDeFichas({ fieldOverrides: config.fieldOverrides!.map((o) => ({ ...o, ttl: false })) })).toBe(false);
    expect(tieneTtlDeFichas({ fieldOverrides: config.fieldOverrides!.map((o) => ({ ...o, fieldPath: 'creadaEn' })) })).toBe(false);
    expect(tieneTtlDeFichas({ fieldOverrides: config.fieldOverrides!.map((o) => ({ ...o, collectionGroup: 'otra' })) })).toBe(false);
    expect(tieneTtlDeFichas({})).toBe(false);
  });

  it('el TTL solo actúa sobre un Timestamp: el servidor nunca escribe `caducaEn` de otra forma', () => {
    const fuente = readFileSync(join(RAIZ, 'functions', 'src', 'modulos', 'catalogo-web', 'catalogoWeb.ts'), 'utf8');
    // Toda escritura de `caducaEn` en el servidor sale de `Timestamp.fromMillis`
    // o de `Timestamp.now`; ninguna es un número ni un texto.
    expect(fuente).not.toMatch(/caducaEn:\s*(?:Date\.now\(\)|new Date|\d)/);
    expect(fuente).toContain('caducaEn: Timestamp.fromMillis(Date.now() + VIDA_FICHA_HORAS');
  });
});
