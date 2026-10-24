/**
 * TÉRMINOS DE PRODUCTO REGISTRADOS: EL LECTOR Y EL PUNTO DE ENTRADA (Central).
 *
 * El principio y el mecanismo están en `comportamiento.ts` («TÉRMINO DE PRODUCTO
 * REGISTRADO»); acá viven dos cosas:
 *
 *   1. Las reexportaciones de lo que el resto del sistema necesita para registrar
 *      y citar un término (`terminoRegistrable`, `sustituirTerminos`,
 *      `citarTerminos`, `MARCADOR_TERMINO`): un solo lugar de importación para los
 *      módulos (Productos, Campañas) y para el coordinador. Central vive en
 *      `comportamiento.ts` porque ahí están las listas que la validación reutiliza.
 *   2. `terminosAprobados`: el LECTOR, contrato con quien escribe el registro.
 *
 * EL DOCUMENTO (`tenants/{t}/terminosProducto/{itemId}`; el id del documento ES el
 * id del ítem del catálogo al que el término está ligado; uno por ítem):
 *
 *   { termino,        // normalizado: lo que devolvió `terminoRegistrable`
 *     nombreHash,     // hashCorto(normalizar(catalogo/{itemId}.nombre)) al registrar
 *     estado,         // 'pendiente' | 'aprobado' | 'rechazado'
 *     motivo,         // por qué; nunca el término
 *     revisadoPor?, revisadoEn? }   // Plataforma, al aprobar o rechazar
 *
 * Solo el SDK Admin escribe esos documentos (el PR 2 de Productos/Plataforma
 * agrega la regla que se lo niega a todo rol del navegador, con su negativa).
 *
 * UN TÉRMINO APROBADO VALE SOLO SI, AHORA MISMO:
 *   - su documento sigue siendo válido (`terminoApto`: la forma estricta se
 *     revalida; un documento corrupto se descarta);
 *   - el ítem `catalogo/{itemId}` existe, está `activo == true` y su nombre
 *     actual produce el MISMO `nombreHash` (una aprobación vieja o un nombre
 *     editado queda sin efecto, sin que nadie tenga que borrar nada);
 *   - el término está contenido en ese nombre (frontera de palabra): el registro
 *     no puede aprobar una frase que el ítem no dice.
 * Con tope de `MAX_TERMINOS_POR_TENANT` (seguridad; más adelante, por plan).
 *
 * COSTO. Casi ningún turno agrega lecturas: solo se consulta Firestore si el
 * texto normalizado contiene «prompt». Con el término la lectura son 1 consulta
 * por `estado == 'aprobado'` más las lecturas de los ítems (en lote).
 *
 * MULTI-TENANT. La ruta sale del `tenantId` del disparador autenticado; el
 * término de un comercio no existe para otro. El marcador no lleva datos.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { hashCorto, normalizar, expresionDeTerminos, terminoApto } from './comportamiento.js';

export {
  MARCADOR_TERMINO, DESBLOQUEABLES, citarTerminos, sustituirTerminos, terminoRegistrable,
} from './comportamiento.js';

/** Constante de seguridad (no un límite comercial): términos aprobados que se consideran por comercio. */
export const MAX_TERMINOS_POR_TENANT = 10;
/** Cuántos documentos aprobados se leen como máximo: holgura sobre el tope para descartar vencidos. */
const MAX_DOCUMENTOS_LEIDOS = 50;
export const COLECCION_TERMINOS = 'terminosProducto';

export type EstadoTermino = 'pendiente' | 'aprobado' | 'rechazado';

/** Forma del documento `tenants/{t}/terminosProducto/{itemId}`. */
export interface TerminoProducto {
  termino: string;
  nombreHash: string;
  estado: EstadoTermino;
  motivo: string;
  revisadoPor?: string;
  revisadoEn?: unknown;
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/** ¿El término (normalizado) aparece en el nombre (normalizado) como palabras enteras? */
function contenidoEn(termino: string, nombreNormalizado: string): boolean {
  const re = expresionDeTerminos([termino]);
  return re !== null && re.test(nombreNormalizado);
}

/**
 * Los términos aprobados y VIGENTES del comercio `tenantId`, normalizados y sin
 * repetir, a lo sumo `MAX_TERMINOS_POR_TENANT`. Devuelve `[]` sin leer nada si el
 * texto no contiene «prompt». Si Firestore falla, la excepción sube: quien llama
 * decide (`revisarYAplicar` deja la revisión `pendiente`, que es no aplicar).
 */
export async function terminosAprobados(
  db: Firestore, tenantId: string, textoAnalizado: string,
): Promise<string[]> {
  if (typeof tenantId !== 'string' || tenantId === '' || tenantId.includes('/')) return [];
  if (!normalizar(textoAnalizado).includes('prompt')) return [];

  const registro = await db.collection('tenants').doc(tenantId).collection(COLECCION_TERMINOS)
    .where('estado', '==', 'aprobado').limit(MAX_DOCUMENTOS_LEIDOS).get();
  if (registro.empty) return [];

  const candidatos = registro.docs
    .map((d) => ({ id: d.id, termino: texto(d.get('termino')), nombreHash: texto(d.get('nombreHash')) }))
    // Un documento corrupto o no normalizado se descarta antes de gastar una lectura.
    .filter((c) => c.nombreHash !== '' && terminoApto(c.termino))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (candidatos.length === 0) return [];

  const items = await db.getAll(
    ...candidatos.map((c) => db.collection('tenants').doc(tenantId).collection('catalogo').doc(c.id)),
  );
  const vigentes: string[] = [];
  candidatos.forEach((c, i) => {
    const item = items[i];
    if (!item?.exists || item.get('activo') !== true) return;
    const nombre = normalizar(texto(item.get('nombre')));
    if (nombre === '' || hashCorto(nombre) !== c.nombreHash) return;
    if (!contenidoEn(c.termino, nombre)) return;
    if (!vigentes.includes(c.termino)) vigentes.push(c.termino);
  });
  return vigentes.slice(0, MAX_TERMINOS_POR_TENANT);
}
