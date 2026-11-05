/**
 * LA FUNCTION QUE VERIFICA LAS CAMPAÑAS ANTES DE APLICARLAS (24/09/2026).
 *
 * Se dispara con cada escritura de `tenants/{t}/config/campanas` y actúa solo
 * cuando cambió `lista` (lo que el comercio propone). Corre `revisarCampanas`
 * y escribe, donde el navegador NO puede:
 *
 *   - `revision`  el veredicto de cada campaña, con el hash de la lista;
 *   - `vigentes`  las aprobadas. `configuracionFlujo` lee SOLO esto.
 *
 * Mismo diseño que `verificarComportamiento`, y por la misma razón: la consola
 * escribe directo en Firestore, así que un disparador es lo único que no se
 * puede saltear con una petición armada a mano (CLAUDE.md, base comercial §7).
 * El tope del plan lo pone la regla con el tamaño de la lista; acá se vuelve a
 * mirar por si el plan bajó después de cargarlas.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { REGION } from '../../core/region.js';
import { CLAVE_GEMINI } from '../../central/servicios/gemini.js';
import type { ConsultarModelo } from '../../central/asistente/comportamiento.js';
import { consultarGemini, otrosComercios } from '../../central/asistente/verificarComportamiento.js';
import { limiteDeCampanas } from '../../central/cuenta/planes.js';
import { terminosAprobados } from '../../central/asistente/terminos.js';
import { nombreDeProductoApto, nombreParaElModelo } from '../productos/nombreSeguro.js';
import {
  hashLista, leerCampanas, type Campana, productoIdValido, revisarCampanas,
  type ContextoDelNegocio, type ResultadoCampanas, type RevisionCampana,
} from './campanas.js';

/** Quién firma la revisión de las campañas en el documento y en la auditoría. */
export const REVISOR_CAMPANAS = 'verificarCampanas';

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Lo que el modelo necesita saber del negocio: identidad, catálogo e información aprobada. */
export async function contextoDelNegocio(db: Firestore, tenantId: string): Promise<ContextoDelNegocio> {
  const [negocio, catalogo] = await Promise.all([
    db.doc(`tenants/${tenantId}/config/negocio`).get(),
    db.collection(`tenants/${tenantId}/catalogo`).where('activo', '==', true).select('nombre').limit(200).get(),
  ]);
  return {
    nombreNegocio: texto(negocio.get('nombreNegocio')),
    descripcion: texto(negocio.get('descripcion')),
    // Un nombre que es una frase de instrucción NO llega al modelo (Productos, `nombreSeguro.ts`).
    servicios: catalogo.docs.map((d) => nombreParaElModelo(d.get('nombre')) ?? '').filter((n) => n !== ''),
    informacion: texto(negocio.get('instruccionesVigentes')),
  };
}

/**
 * Los ids de producto que las campañas referencian y que existen ACTIVOS en el
 * catálogo de ESTE tenant (a lo sumo diez lecturas, solo en el disparador y solo
 * si alguna campaña referencia un producto). El tenant sale de la ruta del
 * documento, nunca del contenido.
 */
export async function productosActivosReferenciados(
  db: Firestore, tenantId: string, lista: readonly { productoId?: string }[],
): Promise<Set<string>> {
  const ids = [...new Set(lista.map((c) => c.productoId)
    .filter(productoIdValido))];
  if (ids.length === 0) return new Set();
  const docs = await db.getAll(...ids.map((i) => db.doc(`tenants/${tenantId}/catalogo/${i}`)));
  return new Set(docs.filter((d) => d.exists && d.get('activo') === true).map((d) => d.id));
}

export type ResultadoAplicarCampanas = 'aplicado' | 'obsoleto' | 'sin_documento';

/**
 * Escribe el veredicto en una transacción, con una condición: la lista revisada
 * tiene que seguir siendo la propuesta. Si el comercio guardó otra vez mientras
 * el modelo pensaba, este veredicto es de una lista que ya no existe; la
 * escritura nueva disparó su propia revisión.
 */
export async function aplicarCampanas(
  db: Firestore, tenantId: string, hash: string, r: ResultadoCampanas, revisadoPor: string,
): Promise<ResultadoAplicarCampanas> {
  const ref = db.doc(`tenants/${tenantId}/config/campanas`);
  const resultado = await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return 'sin_documento' as const;
    if (hashLista(leerCampanas(doc.get('lista'))) !== hash) return 'obsoleto' as const;
    tx.update(ref, {
      revision: { hash, porCampana: r.porCampana, revisadoPor, revisadoEn: Timestamp.now() },
      vigentes: r.vigentes,
    });
    return 'aplicado' as const;
  });
  if (resultado === 'aplicado') {
    const estados = Object.values(r.porCampana).map((x) => x.estado);
    await db.collection(`tenants/${tenantId}/auditoria`).add({
      accion: 'revisar_campanas', uid: revisadoPor, en: Timestamp.now(), hash,
      campanas: estados.length,
      aprobadas: estados.filter((e) => e === 'aprobada').length,
      rechazadas: estados.filter((e) => e === 'rechazada').length,
      pendientes: estados.filter((e) => e === 'pendiente').length,
      fueraDelPlan: estados.filter((e) => e === 'fuera_del_plan').length,
    });
  }
  return resultado;
}

/**
 * Los términos de producto aprobados de ESTE comercio para los textos de la lista:
 * UNA sola lectura por verificación (los campos van juntos, no uno por uno) y
 * ninguna si ningún campo contiene «prompt». Si Firestore falla, la excepción
 * sube; `revisarYAplicarCampanas` la atrapa y falla cerrado (sin términos).
 */
export async function terminosDeLaLista(
  db: Firestore, tenantId: string, lista: readonly Campana[],
): Promise<string[]> {
  const campos = lista.flatMap((c) => [c.texto, ...(c.titulares ?? []), c.angulo ?? '']);
  return terminosAprobados(db, tenantId, campos.join('\n'), nombreDeProductoApto);
}

/** La revisión y la escritura juntas: lo que corre el disparador y lo que prueban las suites. */
export async function revisarYAplicarCampanas(
  db: Firestore, tenantId: string, antes: Record<string, unknown>, despues: Record<string, unknown>,
  consultar: ConsultarModelo, ahoraMs: number = Date.now(), revisadoPor: string = REVISOR_CAMPANAS,
): Promise<{ hash: string; resultado: ResultadoAplicarCampanas; revision: ResultadoCampanas }> {
  const lista = leerCampanas(despues['lista']);
  const hash = hashLista(lista);
  const [cuenta, contexto, otros] = await Promise.all([
    db.doc(`tenants/${tenantId}/cuenta/estado`).get(),
    contextoDelNegocio(db, tenantId),
    otrosComercios(db, tenantId),
  ]);
  const limite = limiteDeCampanas(cuenta.exists ? cuenta.data() as Record<string, unknown> : null);
  const previa = despues['revision'];
  const anterior = typeof previa === 'object' && previa !== null
    ? (previa as { porCampana?: Record<string, RevisionCampana> }).porCampana : undefined;
  const productos = await productosActivosReferenciados(db, tenantId, lista);
  // Falla cerrado: si no se pueden leer los términos, ninguno vale (las campañas con «prompts» las
  // rechaza la capa 1) y el resto de la lista se aplica normal, sin dejar vigente lo anterior.
  let terminos: string[] = [];
  try {
    terminos = await terminosDeLaLista(db, tenantId, lista);
  } catch {
    logger.warn('verificarCampanas: no se pudieron leer los términos de producto');
  }
  const revision = await revisarCampanas(lista, leerCampanas(antes['lista']), anterior, limite, ahoraMs,
    contexto, otros, consultar, productos, terminos);
  const resultado = await aplicarCampanas(db, tenantId, hash, revision, revisadoPor);
  return { hash, resultado, revision };
}

/**
 * ¿Hay que revisar esta escritura? Solo si cambió la lista propuesta. Las
 * escrituras del propio servidor (`revision`, `vigentes`) no la cambian, así
 * que no vuelven a disparar la revisión: sin esto sería un bucle.
 */
export function hayQueRevisarCampanas(antes: Record<string, unknown>, despues: Record<string, unknown>): boolean {
  return hashLista(leerCampanas(antes['lista'])) !== hashLista(leerCampanas(despues['lista']));
}

export const verificarCampanas = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/config/campanas',
    region: REGION,
    secrets: [CLAVE_GEMINI],
    maxInstances: 3,
    timeoutSeconds: 120,
  },
  async (evento) => {
    if (!evento.data?.after.exists) return;
    const antes = (evento.data.before.data() ?? {}) as Record<string, unknown>;
    const despues = (evento.data.after.data() ?? {}) as Record<string, unknown>;
    if (!hayQueRevisarCampanas(antes, despues)) return;
    const tenantId = evento.params.tenantId;
    const { hash, resultado, revision } = await revisarYAplicarCampanas(getFirestore(), tenantId, antes, despues, consultarGemini);
    logger.info('verificarCampanas', {
      tenantId, hash, resultado, vigentes: revision.vigentes.length,
      estados: Object.values(revision.porCampana).map((r) => r.estado),
    });
  },
);
