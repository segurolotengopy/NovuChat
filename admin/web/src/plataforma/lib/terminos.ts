/**
 * Los términos de producto registrados, vistos desde la consola de Plataforma (PR 3).
 * Módulo puro: no importa Firebase. La forma es la de `listarTerminos` del servidor
 * (`functions/src/plataforma/terminosProducto.ts`); el servidor manda y esto solo la lee con cuidado.
 */
export const CALLABLES_TERMINOS = {
  listar: 'terminosProductoDeTenant',
  decidir: 'aprobarTerminoProducto',
} as const;

export const DECISIONES_TERMINO = ['aprobar', 'rechazar', 'revocar'] as const;
export type DecisionTermino = (typeof DECISIONES_TERMINO)[number];

export interface FilaTermino {
  itemId: string;
  termino: string;
  estado: 'pendiente' | 'aprobado' | 'rechazado';
  nombre: string | null;
  activo: boolean;
  hashVigente: boolean;
}

export interface ListaDeTerminos {
  filas: FilaTermino[];
  aprobados: number;
  tope: number;
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Lo que devolvió el servidor, a una lista segura; cualquier cosa rara se descarta. */
export function listaDeTerminos(crudo: unknown): ListaDeTerminos {
  const r = (crudo ?? {}) as Record<string, unknown>;
  const filas = (Array.isArray(r['filas']) ? r['filas'] as unknown[] : []).flatMap((x): FilaTermino[] => {
    const f = (x ?? {}) as Record<string, unknown>;
    const estado = f['estado'];
    if (typeof f['itemId'] !== 'string' || (estado !== 'pendiente' && estado !== 'aprobado' && estado !== 'rechazado')) return [];
    return [{
      itemId: f['itemId'], termino: texto(f['termino']), estado,
      nombre: typeof f['nombre'] === 'string' ? f['nombre'] : null,
      activo: f['activo'] === true, hashVigente: f['hashVigente'] === true,
    }];
  });
  const tope = typeof r['tope'] === 'number' && r['tope'] > 0 ? r['tope'] : 10;
  return { filas, aprobados: filas.filter((f) => f.estado === 'aprobado').length, tope };
}

/** Los textos fijos de lo que se informa tras decidir. */
export const AVISO_DE_DECISION: Record<DecisionTermino, string> = {
  aprobar: 'Término aprobado.',
  rechazar: 'Término rechazado.',
  revocar: 'Término revocado: el asistente ya no lo acepta.',
};
