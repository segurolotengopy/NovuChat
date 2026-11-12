// ZONA PLATAFORMA: la lógica de DAR DE BAJA un negocio, sin Cloud Functions ni autorización.
//
// La comparten DOS llamadores, y por eso vive aparte (una sola copia de la lógica):
//   · el callable `bajaTenant` (`tenants.ts`), que autoriza al propietario por sus claims;
//   · el script `admin/scripts/plataforma/baja-comercio.mjs`, que corre un operador con las credenciales de la consola.
//
// SIN IMPORTACIONES LOCALES, A PROPÓSITO: el script la carga con `node` directamente (como `registro.ts`), y `node` no
// traduce los `.js` de los imports de `functions/src`. Todo lo que necesita (la base, los claims, la auditoría, el gancho)
// llega por `deps`. Solo `import type`, que se borra al ejecutar.
import type { Firestore, Timestamp } from 'firebase-admin/firestore';

/**
 * GANCHO AL CERRAR UN NEGOCIO (baja o suspensión, 03/11/2026): lo que otra zona debe hacer cuando el negocio deja de
 * tener servicio. Hoy lo usa el miniCRM para revocar a TODOS los editores de la hoja. Plataforma no importa módulos,
 * así que lo recibe armado de `ganchos.ts`. NO debe lanzar: si no completa su parte la deja anotada
 * (`revocado_pendiente`, que cierra la reconciliación programada).
 */
export type GanchoAlCerrarTenant = (tenantId: string, quien: string, motivo: 'baja' | 'suspension') => Promise<void>;

export interface DepsBaja {
  db: Firestore;
  ahora: () => Timestamp;
  /** Quita el rol del miembro en ese negocio y revoca sus sesiones (`asignarRol(uid, tenantId, null, { revocarSesiones: true })`). */
  quitarRol: (uid: string, tenantId: string) => Promise<unknown>;
  auditar: (tenantId: string, accion: string, uid: string, detalle: object) => Promise<unknown>;
  gancho?: GanchoAlCerrarTenant;
}

/** Propaga el estado del comercio a sus rutas de WhatsApp. */
export async function marcarRutasDelTenant(db: Firestore, tenantId: string, estado: string): Promise<void> {
  const rutas = await db.collection('rutasWhatsApp').where('tenantId', '==', tenantId).get();
  const lote = db.batch();
  for (const r of rutas.docs) lote.update(r.ref, { estado });
  await lote.commit();
}

/**
 * LA BAJA. Lógica, no destructiva: `estado: 'dado_de_baja'` corta el acceso de inmediato por la regla `tenantActivo()`, y
 * se revocan las sesiones para que nadie siga adentro con un token que todavía no caducó. El borrado real de los datos es
 * un procedimiento aparte, deliberado y con plazo (12 meses): esta función NO borra ningún documento.
 *
 * El orden es el de siempre y importa: primero la ficha y las rutas (el corte de servicio), después el gancho y por último
 * los roles. Si algo fallara en medio, prefiero que el corte ya esté hecho y queden roles por limpiar, y no al revés.
 *
 * `ultimaActualizacion` (opcional, lo usa el script): precondición de la ficha, para no pisar un cambio ajeno entre la
 * lectura y la escritura. `soloCompletar` (lo usa el script ante una baja cortada a medias): la ficha YA está
 * `dado_de_baja`, así que no se reescribe (se conservan `bajaEn` y `bajaPor`) y se repiten los pasos siguientes, que son
 * idempotentes (quitar un rol que ya no está no hace nada).
 */
export async function ejecutarBajaTenant(
  deps: DepsBaja,
  tenantId: string,
  uid: string,
  opciones: { ultimaActualizacion?: Timestamp; soloCompletar?: boolean } = {},
): Promise<{ miembros: number }> {
  const ref = deps.db.doc(`tenants/${tenantId}`);
  if (!opciones.soloCompletar) {
    const cambios = { estado: 'dado_de_baja', bajaEn: deps.ahora(), bajaPor: uid };
    if (opciones.ultimaActualizacion) await ref.update(cambios, { lastUpdateTime: opciones.ultimaActualizacion });
    else await ref.update(cambios);
  }

  // LA RUTA TAMBIÉN. Un comercio dado de baja no debe conservar su ruta diciendo `activo`: `registrarCierre` decide con
  // `ruta.estado`, y un comercio que se fue no debe seguir sumando registros ni recibir servicio.
  await marcarRutasDelTenant(deps.db, tenantId, 'dado_de_baja');
  // La edición de la hoja del miniCRM con Gmail no depende de los claims: se revoca aparte (no lanza).
  if (deps.gancho) await deps.gancho(tenantId, uid, 'baja');

  const miembros = await deps.db.collection(`tenants/${tenantId}/miembros`).get();
  for (const m of miembros.docs) await deps.quitarRol(m.id, tenantId);
  await deps.auditar(tenantId, 'baja_tenant', uid, { miembros: miembros.size, rutasCortadas: true });
  return { miembros: miembros.size };
}
