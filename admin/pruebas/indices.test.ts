/**
 * Verifica que cada forma de consulta de la bitácora tenga su índice compuesto
 * declarado en `firestore.indexes.json`.
 *
 * POR QUÉ ESTA PRUEBA EXISTE
 * --------------------------
 * **El emulador de Firestore no exige índices: responde cualquier consulta.** El
 * servicio real rechaza con «The query requires an index» toda consulta que
 * combine un filtro de igualdad con un orden por otro campo si el índice no está
 * declarado.
 *
 * O sea que las 99 pruebas contra el emulador NO pueden detectar este fallo. Una
 * pantalla de filtros puede pasar todo lo local y romperse la primera vez que
 * alguien la usa en producción, que es el peor momento posible para enterarse.
 *
 * Esta prueba es el control compensatorio: no corre consultas, compara la lista
 * de formas declaradas en `web/src/lib/bitacora.ts` contra el archivo de
 * índices. Es pura, no necesita emulador ni red.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMPO_ORDEN, FORMAS, type Forma } from '../web/src/lib/bitacora.ts';

const aqui = dirname(fileURLToPath(import.meta.url));

interface Campo { fieldPath: string; order?: string; arrayConfig?: string }
interface Indice { collectionGroup: string; queryScope: string; fields: Campo[] }

const indices: Indice[] = JSON.parse(
  readFileSync(join(aqui, '..', 'firestore.indexes.json'), 'utf8'),
).indexes;

/** ¿Hay un índice que sirva EXACTAMENTE para esta forma? */
function tieneIndice(forma: Forma): boolean {
  const alcance = forma.grupo ? 'COLLECTION_GROUP' : 'COLLECTION';
  return indices.some((i) => {
    if (i.collectionGroup !== 'bitacora' || i.queryScope !== alcance) return false;
    // Firestore exige: primero las igualdades (ascendente), después el campo de
    // orden con su dirección. El ORDEN de los campos importa.
    const esperado = [
      ...forma.igualdades.map((c) => ({ fieldPath: c, order: 'ASCENDING' })),
      { fieldPath: CAMPO_ORDEN, order: 'DESCENDING' },
    ];
    if (i.fields.length !== esperado.length) return false;
    return esperado.every((e, n) =>
      i.fields[n]?.fieldPath === e.fieldPath && i.fields[n]?.order === e.order);
  });
}

describe('Índices de la bitácora', () => {
  it('cada forma que lo necesita tiene su índice compuesto declarado', () => {
    const faltantes = FORMAS
      .filter((f) => f.requiereIndice && !tieneIndice(f))
      .map((f) => `${f.grupo ? 'grupo' : 'coleccion'}: ${f.igualdades.join('+')} + ${CAMPO_ORDEN} desc`);
    expect(faltantes).toEqual([]);
  });

  it('las formas de un solo campo NO declaran índice compuesto (sería inútil)', () => {
    // Un índice de un solo campo lo mantiene Firestore solo. Declararlo además
    // como compuesto no es posible y sugerirlo confunde: si esta prueba falla,
    // alguien marcó mal una forma.
    for (const f of FORMAS.filter((x) => !x.requiereIndice)) {
      expect(f.igualdades.length).toBe(0);
    }
  });

  it('cubre las cuatro combinaciones de filtros en los dos alcances', () => {
    // Sin esto, un filtro que la pantalla ofrece pero que nadie declaró
    // reventaría en `formaDe()` recién al hacer clic.
    const combinaciones = FORMAS.map((f) => `${f.grupo}:${f.igualdades.join('+')}`).sort();
    expect(combinaciones).toEqual([
      'false:', 'false:resultado', 'false:tipo', 'false:tipo+resultado',
      'true:', 'true:resultado', 'true:tipo', 'true:tipo+resultado',
    ].sort());
  });

  it('ningún índice de la bitácora ordena por ts ascendente', () => {
    // La pantalla siempre muestra lo más reciente primero. Un índice ascendente
    // sería peso muerto: se paga su mantenimiento en cada escritura y no lo usa
    // ninguna consulta.
    const ascendentes = indices.filter((i) =>
      i.collectionGroup === 'bitacora'
      && i.fields.some((c) => c.fieldPath === CAMPO_ORDEN && c.order === 'ASCENDING'));
    expect(ascendentes).toEqual([]);
  });
});
