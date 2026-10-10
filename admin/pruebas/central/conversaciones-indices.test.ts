/**
 * CONVERSACIONES (H1): CADA FORMA DE CONSULTA DE LA PANTALLA TIENE SU ÍNDICE.
 *
 * POR QUÉ ESTA PRUEBA EXISTE. El emulador de Firestore NO exige índices: una
 * consulta compuesta sin índice declarado pasa todas las pruebas con emulador y
 * falla en producción con `failed-precondition`, y la pantalla muestra «No se
 * pudieron leer las conversaciones» a un comercio real. La única defensa es
 * comprobar, leyendo `firestore.indexes.json`, que cada forma de consulta que la
 * pantalla puede armar (`FORMAS_CONSULTA`) está cubierta.
 *
 * LAS REGLAS DE FIRESTORE QUE SE APLICAN (documentación de índices):
 *   · una consulta que toca UN solo campo (filtro y orden sobre el mismo) usa el
 *     índice de campo único, que Firestore crea solo (salvo que un `fieldOverride`
 *     lo apague: se comprueba que ninguno lo haga);
 *   · una consulta con filtros y/u orden sobre DOS o más campos distintos pide un
 *     índice COMPUESTO: primero los campos de igualdad (`==`, `in`,
 *     `array-contains`), después los de orden en el orden de la consulta (el campo
 *     de un filtro de rango se ordena aunque no se pida).
 *
 * Es pura: lee archivos y no abre Firestore.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FORMAS_CONSULTA, type FormaConsulta } from '../../web/src/central/lib/conversaciones';

interface CampoIndice { fieldPath: string; order?: 'ASCENDING' | 'DESCENDING'; arrayConfig?: 'CONTAINS' }
interface IndiceCompuesto { collectionGroup: string; queryScope: 'COLLECTION' | 'COLLECTION_GROUP'; fields: CampoIndice[] }
interface Reemplazo { collectionGroup: string; fieldPath: string; indexes: unknown[] }
interface ArchivoIndices { indexes: IndiceCompuesto[]; fieldOverrides: Reemplazo[] }

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const indicesReales = (): ArchivoIndices => JSON.parse(readFileSync(join(ADMIN, 'firestore.indexes.json'), 'utf8')) as ArchivoIndices;

const IGUALDAD = ['==', 'in', 'array-contains'];

/** Los campos distintos que toca una forma de consulta. */
function camposDe(f: Omit<FormaConsulta, 'id'>): string[] {
  return [...new Set([...f.filtros.map((x) => x.campo), ...f.orden.map((o) => o.campo)])];
}

/**
 * El índice compuesto que una forma necesita, o `null` si le basta el de campo único.
 * Primero los campos de igualdad (`array-contains` va como `arrayConfig: CONTAINS`; `in` y `==` ascendentes), después
 * el orden: el pedido, o el campo del filtro de rango si no se pidió ninguno.
 */
export function indiceNecesario(f: Omit<FormaConsulta, 'id'>): CampoIndice[] | null {
  if (camposDe(f).length <= 1) return null;
  const campos: CampoIndice[] = [];
  for (const x of f.filtros.filter((y) => IGUALDAD.includes(y.op))) {
    if (campos.some((c) => c.fieldPath === x.campo)) continue;
    campos.push(x.op === 'array-contains' ? { fieldPath: x.campo, arrayConfig: 'CONTAINS' } : { fieldPath: x.campo, order: 'ASCENDING' });
  }
  const orden = f.orden.length > 0 ? f.orden
    : f.filtros.filter((y) => !IGUALDAD.includes(y.op)).map((y) => ({ campo: y.campo, dir: 'asc' as const }));
  for (const o of orden) {
    if (campos.some((c) => c.fieldPath === o.campo)) continue;
    campos.push({ fieldPath: o.campo, order: o.dir === 'asc' ? 'ASCENDING' : 'DESCENDING' });
  }
  return campos;
}

const mismoIndice = (a: CampoIndice[], b: CampoIndice[]) => JSON.stringify(a) === JSON.stringify(b);

/** Las formas que NO tienen cubierta su consulta en el archivo de índices que se pasa. */
export function formasSinIndice(formas: readonly FormaConsulta[], archivo: ArchivoIndices): string[] {
  const faltan: string[] = [];
  for (const forma of formas) {
    const necesario = indiceNecesario(forma);
    if (necesario === null) {
      // Campo único: lo crea Firestore solo, salvo que un `fieldOverride` de `conversaciones` lo apague.
      for (const campo of camposDe(forma)) {
        const apagado = archivo.fieldOverrides.find((o) => o.collectionGroup === 'conversaciones' && o.fieldPath === campo && o.indexes.length === 0);
        if (apagado) faltan.push(`${forma.id}: el índice de campo único de «${campo}» está apagado por un fieldOverride`);
      }
      continue;
    }
    const hay = archivo.indexes.some((i) => i.collectionGroup === 'conversaciones' && i.queryScope === 'COLLECTION' && mismoIndice(i.fields, necesario));
    if (!hay) faltan.push(`${forma.id}: falta el índice compuesto conversaciones (${necesario.map((c) => `${c.fieldPath} ${c.arrayConfig ?? c.order}`).join(', ')})`);
  }
  return faltan;
}

describe('cada forma de consulta de la pantalla tiene su índice declarado', () => {
  it('FORMAS_CONSULTA no está vacía y cada forma tiene un id único', () => {
    expect(FORMAS_CONSULTA.length).toBeGreaterThanOrEqual(7);
    expect(new Set(FORMAS_CONSULTA.map((f) => f.id)).size).toBe(FORMAS_CONSULTA.length);
  });

  it('firestore.indexes.json cubre TODAS (la prueba lee el archivo real)', () => {
    expect(formasSinIndice(FORMAS_CONSULTA, indicesReales())).toEqual([]);
  });

  it('las dos formas compuestas son estas y piden estos índices', () => {
    const compuestas = FORMAS_CONSULTA.filter((f) => indiceNecesario(f) !== null).map((f) => [f.id, indiceNecesario(f)]);
    expect(compuestas).toEqual([
      ['humano', [{ fieldPath: 'atencionEstado', order: 'ASCENDING' }, { fieldPath: 'ultimoEn', order: 'DESCENDING' }]],
      ['noLeidas', [{ fieldPath: 'sinLeer', order: 'ASCENDING' }, { fieldPath: 'ultimoEn', order: 'DESCENDING' }]],
    ]);
  });

  it('las formas de campo único: «todas», «por vencer», teléfono (trozos y prefijo) y nombre', () => {
    const unicas = FORMAS_CONSULTA.filter((f) => indiceNecesario(f) === null).map((f) => f.id);
    expect(unicas).toEqual(['todas', 'vencer', 'telefono-trozos', 'telefono-prefijo', 'nombre']);
  });

  it('el archivo declara el compuesto de «no leídas» y el de «necesita humano» sobre `conversaciones`, ámbito COLLECTION', () => {
    const real = indicesReales();
    for (const campo of ['sinLeer', 'atencionEstado']) {
      const i = real.indexes.find((x) => x.collectionGroup === 'conversaciones' && x.fields[0]?.fieldPath === campo);
      expect(i, campo).toBeDefined();
      expect(i?.queryScope).toBe('COLLECTION');
      expect(i?.fields).toEqual([{ fieldPath: campo, order: 'ASCENDING' }, { fieldPath: 'ultimoEn', order: 'DESCENDING' }]);
    }
  });

  it('NEGATIVA: sin el índice de «no leídas» la prueba lo CAZA (el verificador no es un sello de goma)', () => {
    const real = indicesReales();
    const sinNoLeidas: ArchivoIndices = { ...real, indexes: real.indexes.filter((i) => !(i.collectionGroup === 'conversaciones' && i.fields[0]?.fieldPath === 'sinLeer')) };
    expect(formasSinIndice(FORMAS_CONSULTA, sinNoLeidas)).toEqual([expect.stringMatching(/^noLeidas: falta el índice compuesto/)]);
    const sinHumano: ArchivoIndices = { ...real, indexes: real.indexes.filter((i) => !(i.collectionGroup === 'conversaciones' && i.fields[0]?.fieldPath === 'atencionEstado')) };
    expect(formasSinIndice(FORMAS_CONSULTA, sinHumano)).toEqual([expect.stringMatching(/^humano: falta el índice compuesto/)]);
    // Un índice con el sentido del orden cambiado tampoco vale.
    const alReves: ArchivoIndices = { ...real, indexes: real.indexes.map((i) => (i.fields[0]?.fieldPath === 'sinLeer'
      ? { ...i, fields: [{ fieldPath: 'sinLeer', order: 'ASCENDING' as const }, { fieldPath: 'ultimoEn', order: 'ASCENDING' as const }] } : i)) };
    expect(formasSinIndice(FORMAS_CONSULTA, alReves)).toHaveLength(1);
    // Un índice de otro ámbito (grupo de colecciones) tampoco: la pantalla consulta una colección.
    const otroAmbito: ArchivoIndices = { ...real, indexes: real.indexes.map((i) => (i.fields[0]?.fieldPath === 'sinLeer' ? { ...i, queryScope: 'COLLECTION_GROUP' as const } : i)) };
    expect(formasSinIndice(FORMAS_CONSULTA, otroAmbito)).toHaveLength(1);
  });

  it('NEGATIVA: una forma compuesta NUEVA sin índice se caza (p. ej. «no leídas» de un solo canal)', () => {
    const nueva: FormaConsulta = {
      id: 'inventada',
      filtros: [{ campo: 'canal', op: '==' }, { campo: 'sinLeer', op: '==' }],
      orden: [{ campo: 'ultimoEn', dir: 'desc' }],
    };
    expect(formasSinIndice([nueva], indicesReales())).toHaveLength(1);
  });

  it('NEGATIVA: ningún fieldOverride apaga el índice de campo único de un campo que la pantalla consulta', () => {
    const real = indicesReales();
    const campos = new Set(FORMAS_CONSULTA.flatMap((f) => camposDe(f)));
    for (const o of real.fieldOverrides.filter((x) => x.collectionGroup === 'conversaciones')) {
      expect(campos.has(o.fieldPath) && o.indexes.length === 0, `fieldOverride apaga ${o.fieldPath}`).toBe(false);
    }
    // y si uno lo apagara, el verificador lo vería
    const apagado: ArchivoIndices = { ...real, fieldOverrides: [...real.fieldOverrides, { collectionGroup: 'conversaciones', fieldPath: 'telefonoTrozos', indexes: [] }] };
    expect(formasSinIndice(FORMAS_CONSULTA, apagado)).toEqual([expect.stringMatching(/^telefono-trozos: .*telefonoTrozos.* apagado/)]);
  });

  it('los índices de los mensajes (palabras) son de la callable y no de esta pantalla: la pantalla no consulta `mensajes` por palabra', () => {
    // La búsqueda por palabra va por la Function; ninguna forma de la pantalla toca `palabras` ni `tenantId`.
    const campos = new Set(FORMAS_CONSULTA.flatMap((f) => camposDe(f)));
    expect(campos.has('palabras')).toBe(false);
    expect(campos.has('tenantId')).toBe(false);
  });
});
