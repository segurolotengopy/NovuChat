import {
  collection, collectionGroup, endAt, limit, orderBy, query, startAfter,
  where, type Firestore, type Query, type QueryDocumentSnapshot,
} from 'firebase/firestore';

/**
 * =============================================================================
 * CONSULTAS DE LA BITÁCORA — declaradas en un solo lugar, a propósito
 * =============================================================================
 *
 * EL PROBLEMA QUE ESTE ARCHIVO RESUELVE
 * -------------------------------------
 * **El emulador de Firestore NO exige índices compuestos: responde cualquier
 * consulta.** El servicio real, en cambio, rechaza con
 * «The query requires an index» toda consulta que combine un filtro de igualdad
 * con un orden por otro campo si ese índice no está declarado.
 *
 * O sea: una pantalla de filtros puede pasar todas las pruebas locales y fallar
 * la primera vez que alguien la usa en producción. Es exactamente la clase de
 * sorpresa que ya costó tiempo con `orderBy('__name__','desc')`, que el emulador
 * sí rechazaba y por eso se detectó a tiempo. Acá no habría esa suerte.
 *
 * LA DEFENSA
 * ----------
 * Las formas de consulta posibles se declaran ACÁ, en `FORMAS`, y de acá salen
 * dos cosas: la consulta que arma la pantalla, y la prueba
 * `pruebas/indices.test.ts`, que verifica que cada forma tenga su índice en
 * `firestore.indexes.json`. La pantalla no puede construir una consulta que la
 * prueba no haya visto, porque las dos leen la misma lista.
 *
 * SI AGREGA UN FILTRO NUEVO: agréguelo a `FORMAS`, corra `pnpm pruebas:reglas` y
 * la prueba le va a decir qué índice falta.
 *
 * SOBRE EL FILTRO «POR COMERCIO»
 * ------------------------------
 * No es un `where`. Filtrar por comercio significa consultar la subcolección de
 * ESE comercio; ver todos es una consulta de grupo de colecciones. Así el tenant
 * sigue viviendo en la RUTA y no en un campo, que es la decisión que sostiene
 * todo el aislamiento (ver SEGURIDAD.md, T-2). En la vista de todos los
 * comercios, a qué comercio pertenece cada fila se saca del path del documento,
 * no de un campo que alguien pudiera escribir.
 */

export const TIPOS = [
  'mensaje_entrante', 'mensaje_saliente', 'plantilla_enviada',
  'cita_agendada', 'cita_rechazada', 'cobro_simulado',
  'transferencia_humano', 'config_publicada', 'suspension',
  'reactivacion', 'error_flujo', 'entrada_descartada',
] as const;

export const RESULTADOS = ['ok', 'fallo', 'rechazado', 'reintento'] as const;

export type Tipo = (typeof TIPOS)[number];
export type Resultado = (typeof RESULTADOS)[number];

export interface Filtros {
  /** `null` = todos los comercios (consulta de grupo de colecciones). */
  tenantId: string | null;
  tipo?: Tipo | null;
  resultado?: Resultado | null;
  desde?: Date | null;
  hasta?: Date | null;
}

/**
 * Forma de consulta: qué campos van con filtro de IGUALDAD, además del orden
 * por `ts` descendente que llevan todas.
 *
 * `requiereIndice: false` significa que alcanza con el índice de un solo campo
 * que Firestore mantiene solo. El rango sobre `ts` no agrega requisitos porque
 * es el MISMO campo por el que se ordena.
 */
export interface Forma {
  igualdades: readonly string[];
  grupo: boolean;
  requiereIndice: boolean;
}

export const CAMPO_ORDEN = 'ts';

export const FORMAS: readonly Forma[] = [
  // --- Un comercio ---
  { igualdades: [], grupo: false, requiereIndice: false },
  { igualdades: ['tipo'], grupo: false, requiereIndice: true },
  { igualdades: ['resultado'], grupo: false, requiereIndice: true },
  { igualdades: ['tipo', 'resultado'], grupo: false, requiereIndice: true },
  // --- Todos los comercios (solo el propietario) ---
  { igualdades: [], grupo: true, requiereIndice: false },
  { igualdades: ['tipo'], grupo: true, requiereIndice: true },
  { igualdades: ['resultado'], grupo: true, requiereIndice: true },
  { igualdades: ['tipo', 'resultado'], grupo: true, requiereIndice: true },
];

/** La forma que corresponde a unos filtros dados. */
export function formaDe(filtros: Filtros): Forma {
  const igualdades: string[] = [];
  if (filtros.tipo) igualdades.push('tipo');
  if (filtros.resultado) igualdades.push('resultado');
  const grupo = filtros.tenantId === null;
  const forma = FORMAS.find(
    (f) => f.grupo === grupo
      && f.igualdades.length === igualdades.length
      && f.igualdades.every((c, i) => c === igualdades[i]),
  );
  if (!forma) {
    // No debería pasar: `FORMAS` cubre las cuatro combinaciones por cada
    // alcance. Si pasa, es que alguien agregó un filtro sin declararlo.
    throw new Error(`Forma de consulta no declarada: ${igualdades.join('+')} grupo=${grupo}`);
  }
  return forma;
}

/** Tamaño de página. Una bitácora crece sin techo: nunca se trae entera. */
export const POR_PAGINA = 50;

export function construirConsulta(
  db: Firestore,
  filtros: Filtros,
  cursor?: QueryDocumentSnapshot | null,
): Query {
  formaDe(filtros);   // valida que la combinación esté declarada

  const base = filtros.tenantId === null
    ? collectionGroup(db, 'bitacora')
    : collection(db, 'tenants', filtros.tenantId, 'bitacora');

  const partes = [];
  if (filtros.tipo) partes.push(where('tipo', '==', filtros.tipo));
  if (filtros.resultado) partes.push(where('resultado', '==', filtros.resultado));
  if (filtros.desde) partes.push(where(CAMPO_ORDEN, '>=', filtros.desde));
  if (filtros.hasta) partes.push(where(CAMPO_ORDEN, '<=', filtros.hasta));
  partes.push(orderBy(CAMPO_ORDEN, 'desc'));
  if (cursor) partes.push(startAfter(cursor));
  partes.push(limit(POR_PAGINA));

  return query(base, ...partes);
}

/** A qué comercio pertenece una fila: sale del PATH, nunca de un campo. */
export function tenantDe(doc: QueryDocumentSnapshot): string {
  return doc.ref.parent.parent?.id ?? '(desconocido)';
}

// `endAt` no se usa; se importa para que quede a la vista que la paginación es
// por cursor (`startAfter`) y no por desplazamiento numérico, que en Firestore
// obligaría a leer y pagar todos los documentos salteados.
void endAt;
