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
import { REGION } from './region.js';
import { CLAVE_GEMINI } from './imagenCatalogo.js';
import type { ConsultarModelo } from './comportamiento.js';
import { consultarGemini, otrosComercios } from './verificarComportamiento.js';
import { limiteDeCampanas } from './planes.js';
import {
  hashLista, leerCampanas, revisarCampanas,
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
    servicios: catalogo.docs.map((d) => texto(d.get('nombre'))).filter((n) => n !== ''),
    informacion: texto(negocio.get('instruccionesVigentes')),
  };
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
  const revision = await revisarCampanas(lista, leerCampanas(antes['lista']), anterior, limite, ahoraMs,
    contexto, otros, consultar);
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
