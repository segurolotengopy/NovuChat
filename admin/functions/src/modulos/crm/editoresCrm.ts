/**
 * EDITORES DEL miniCRM: LOS CALLABLES (03/11/2026). La lógica pura y el cliente de Drive están en `editores-crm.ts`;
 * el porqué (no se vincula Google al usuario) y el contrato, en `docs/arquitectura/modulos/crm.md`.
 *
 *   registrarEditorCrm({ tenantId, idTokenGoogle, uidDestino? })   admin (cualquiera) u operador (solo él mismo)
 *   quitarEditorCrm({ tenantId, uidDestino? })                     admin (cualquiera) u operador (solo él mismo)
 *   consultarMiEdicionCrm({ tenantId })                            admin u operador: su estado y, si es editor, la hoja
 *
 * Los tres usan la autorización de siempre (`esAdminDe` / `esOperDe`: contraseña + correo verificado). Cada
 * handler se fabrica con sus dependencias (verificador del token y cliente de Drive) para probarlo con dobles.
 * El tope de editores se lee del plan (`limiteDeEditoresCrm`), nunca se escribe aquí.
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { REGION } from '../../core/region.js';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { esAdminDe, esOperDe, exigirAutenticado } from '../../core/seguridad/autorizacion.js';
import { ID_TENANT, auditar, db, texto } from '../../central/comunes.js';
import { limiteDeEditoresCrm } from '../../central/cuenta/planes.js';
import { crmActivo } from './crm.js';
import {
  ErrorPermisoNoRevocable, ErrorToken, UID_VALIDO, abreviarCorreo, archivoDeEnlace, correoCuentaCrm, crearClienteDrive, crearVerificadorGoogle,
  hayCupo, normalizarCorreo, puedeApuntarA, verificadoPorDe,
  type ClienteDrive, type EstadoEditor, type RolQueLlama, type VerificarTokenGoogle,
} from './editores-crm.js';

export interface DepsEditores {
  readonly verificar: VerificarTokenGoogle;
  /** El cliente de Drive del tenant, o `null` si no se puede armar (falla cerrada). */
  readonly drive: (tenantId: string) => ClienteDrive | null;
}

const MENSAJE = {
  token: 'No se pudo verificar la cuenta de Google.',
  correo: 'La cuenta de Google debe ser la misma con la que ingresó.',
  drive: 'No se pudo actualizar el permiso de la hoja. Intente de nuevo.',
} as const;

const coleccion = (tenantId: string) => db().collection(`tenants/${tenantId}/editoresCrm`);
const ARCHIVO_GUARDADO = /^[A-Za-z0-9_-]{10,100}$/;

function datosDe(p: CallableRequest): { tenantId: string; datos: Record<string, unknown> } {
  const datos = (p.data ?? {}) as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  return { tenantId, datos };
}

function rolDe(p: CallableRequest, tenantId: string): RolQueLlama {
  if (esAdminDe(p, tenantId)) return 'admin';
  if (esOperDe(p, tenantId)) return 'oper';
  throw new HttpsError('permission-denied', 'Solo las personas del negocio.');
}

/** El uid sobre el que se actúa: el indicado o, si falta, el propio. Solo la forma de un uid de Firebase. */
function destinoDe(datos: Record<string, unknown>, uid: string): string {
  const crudo = datos['uidDestino'];
  if (crudo === undefined || crudo === null || crudo === '') return uid;
  const d = texto(crudo, 128);
  if (!UID_VALIDO.test(d)) throw new HttpsError('invalid-argument', 'Usuario inválido.');
  return d;
}

/** Lo que identifica una alta: estado, permiso y momento del alta (una alta nueva cambia `desde` aunque repita el id). */
function huellaDe(d: Record<string, unknown> | undefined): string {
  const desde = d?.['desde'];
  const ms = typeof desde === 'object' && desde !== null && 'toMillis' in desde ? (desde as Timestamp).toMillis() : 'x';
  return `${String(d?.['estado'])}|${String(d?.['permisoId'])}|${String(ms)}`;
}

/**
 * REVOCA el permiso de un editor. Devuelve el estado REAL: `revocado` solo si Drive confirmó (o el permiso ya no
 * existía); si Drive falla o falta algún dato, queda `revocado_pendiente` y nunca se dice `revocado`. Lo usan
 * `quitarEditorCrm` y el gancho de `quitarUsuario`.
 */
export async function revocarEditor(
  drive: ClienteDrive | null, tenantId: string, uidDestino: string, quien: string, motivo: string,
): Promise<'revocado' | 'revocado_pendiente' | 'sin_editor'> {
  const ref = coleccion(tenantId).doc(uidDestino);
  const doc = await ref.get();
  if (!doc.exists) return 'sin_editor';
  const f = doc.data() as Record<string, unknown>;
  if (f['estado'] === 'revocado') return 'revocado';
  const archivoId = f['archivoId'];
  const permisoId = f['permisoId'];
  let confirmado = false;
  if (drive && typeof archivoId === 'string' && ARCHIVO_GUARDADO.test(archivoId) && typeof permisoId === 'string' && permisoId !== '') {
    try {
      await drive.borrarPermiso(archivoId, permisoId);
      confirmado = true;
    } catch {
      logger.warn('editoresCrm: Drive no confirmó la baja', { tenantId });
    }
  }
  // Se marca DENTRO de una transacción que exige el mismo estado, permisoId y alta que se leyeron: si una alta
  // concurrente reescribió el documento (y quizá recreó el permiso, que en Drive conserva el id), no se puede afirmar
  // «revocado»; queda `revocado_pendiente` y un nuevo quitar reintenta el borrado.
  let estado = 'revocado_pendiente' as 'revocado' | 'revocado_pendiente';
  let desaparecio = false;
  await db().runTransaction(async (tx) => {
    // Se calcula DENTRO de la función de la transacción: si Firestore la reintenta, parte de cero.
    estado = confirmado ? 'revocado' : 'revocado_pendiente';
    desaparecio = false;
    const ahora = await tx.get(ref);
    if (!ahora.exists) { desaparecio = true; return; }
    const actual = ahora.data() as Record<string, unknown>;
    if (huellaDe(actual) !== huellaDe(f)) estado = 'revocado_pendiente';
    const cambios: Record<string, unknown> = { estado };
    // No se pisa quién ni cuándo si ya constan (p. ej. `script:cambiar-correo`).
    if (actual['revocadoEn'] === undefined) cambios['revocadoEn'] = Timestamp.now();
    if (actual['revocadoPor'] === undefined) cambios['revocadoPor'] = quien;
    // Un motivo nuevo para quedar pendiente reinicia la cuenta de reintentos; el mismo motivo no (si no, nunca se agotaría).
    // («reconciliacion» es el motivo por omisión del reintento programado: no es un motivo nuevo.)
    if (estado === 'revocado_pendiente' && actual['motivoPendiente'] !== motivo && motivo !== 'reconciliacion') {
      cambios['motivoPendiente'] = motivo;
      cambios['reintentos'] = 0;
    }
    tx.update(ref, cambios);
  });
  const correo = typeof f['correoGoogle'] === 'string' ? abreviarCorreo(f['correoGoogle']) : '';
  await auditar(tenantId, 'editor_crm_baja', quien, { destino: uidDestino, correo, motivo, resultado: desaparecio ? 'sin_editor' : estado === 'revocado' ? 'revocado' : 'pendiente' });
  return estado;
}

// ---------------------------------------------------------------------------
// registrarEditorCrm
// ---------------------------------------------------------------------------
export const manejarRegistrar = (d: DepsEditores) => async (p: CallableRequest) => {
  const uid = exigirAutenticado(p);
  const { tenantId, datos } = datosDe(p);
  const rol = rolDe(p, tenantId);
  const idToken = texto(datos['idTokenGoogle'], 4096);
  if (idToken === '') throw new HttpsError('invalid-argument', 'Falta la cuenta de Google.');
  const destino = destinoDe(datos, uid);
  // Antes de verificar nada: un operador no apunta a otra persona.
  if (!puedeApuntarA(rol, uid, destino)) {
    throw new HttpsError('permission-denied', 'Solo el administrador da de alta a otras personas.');
  }

  let correoToken: string;
  try {
    correoToken = (await d.verificar(idToken)).correo;
  } catch (e) {
    if (e instanceof ErrorToken && e.motivo === 'sin_audiencia') {
      throw new HttpsError('failed-precondition', 'La verificación con Google no está configurada.');
    }
    throw new HttpsError(e instanceof ErrorToken && e.motivo === 'correo_no_verificado' ? 'permission-denied' : 'unauthenticated', MENSAJE.token);
  }
  const verificadoPor = verificadoPorDe(rol, uid, destino, normalizarCorreo(p.auth?.token?.['email']), correoToken);
  if (verificadoPor === null) throw new HttpsError('permission-denied', MENSAJE.correo);

  // El destino debe ser persona activa DE ESTE negocio.
  const miembro = await db().doc(`tenants/${tenantId}/miembros/${destino}`).get();
  if (!miembro.exists || miembro.data()?.['estado'] !== 'activo') {
    throw new HttpsError('failed-precondition', 'Esa persona no es miembro activo del negocio.');
  }
  const configCrm = await db().doc(`tenants/${tenantId}/config/crm`).get();
  if (!crmActivo(configCrm.exists ? configCrm.data() : null)) {
    throw new HttpsError('failed-precondition', 'El miniCRM está apagado.');
  }
  // El archivo sale SOLO del enlace validado de ESTE negocio.
  const enlace = await db().doc(`tenants/${tenantId}/enlaces/minicrm`).get();
  const archivoId = archivoDeEnlace(enlace.data()?.['enlaceHoja']);
  if (archivoId === null) throw new HttpsError('failed-precondition', 'El negocio no tiene una hoja del miniCRM.');
  const drive = d.drive(tenantId);
  if (!drive) throw new HttpsError('failed-precondition', 'La edición del miniCRM no está configurada.');

  const cuenta = await db().doc(`tenants/${tenantId}/cuenta/estado`).get();
  const limite = limiteDeEditoresCrm(cuenta.exists ? cuenta.data() as Record<string, unknown> : null);
  const previo = await coleccion(tenantId).doc(destino).get();
  const activos = await coleccion(tenantId).where('estado', '==', 'activo').get();
  const yaCuenta = previo.exists && previo.data()?.['estado'] === 'activo';
  if (!hayCupo(activos.size, limite, yaCuenta)) {
    throw new HttpsError('resource-exhausted', 'El negocio alcanzó el máximo de editores de su plan.');
  }
  // Un mismo Gmail no queda activo (ni con la baja pendiente) para dos personas: revocar a una quitaría el
  // permiso de la otra. Aquí es el rechazo rápido; la regla que vale se repite DENTRO de la transacción.
  const ocupa = (x: { id: string; data(): Record<string, unknown> | undefined }) =>
    x.id !== destino && x.data()?.['correoGoogle'] === correoToken
    && (x.data()?.['estado'] === 'activo' || x.data()?.['estado'] === 'revocado_pendiente');
  const delGmail = await coleccion(tenantId).where('correoGoogle', '==', correoToken).get();
  if (delGmail.docs.some(ocupa)) {
    throw new HttpsError('already-exists', 'Esa cuenta de Google ya es editora de otra persona.');
  }

  // Nunca se pisa un permisoId sin revocarlo: si la persona tiene un permiso vigente o con la baja pendiente en otra
  // cuenta (o en otra hoja), primero se cierra ese. Si Drive no lo confirma, se rechaza.
  const f = previo.data();
  if (previo.exists && (f?.['estado'] === 'activo' || f?.['estado'] === 'revocado_pendiente')
    && (f['correoGoogle'] !== correoToken || f['archivoId'] !== archivoId)) {
    const e = await revocarEditor(drive, tenantId, destino, uid, 'cambio_de_cuenta');
    if (e !== 'revocado') throw new HttpsError('unavailable', MENSAJE.drive);
  }

  // Lo que la transacción espera encontrar en el documento del destino (ya con la revocación de arriba hecha).
  const esperado = await coleccion(tenantId).doc(destino).get();
  const huella = (x: { exists: boolean; data(): Record<string, unknown> | undefined }) =>
    x.exists ? `${String(x.data()?.['estado'])}|${String(x.data()?.['permisoId'])}` : 'nada';

  let permisoId: string;
  let creado: boolean;
  try {
    ({ permisoId, creado } = await drive.crearPermiso(archivoId, correoToken));
  } catch (e) {
    logger.warn('editoresCrm: Drive no concedió el permiso', { tenantId });
    const noRevocable = e instanceof ErrorPermisoNoRevocable;
    await auditar(tenantId, 'editor_crm_alta', uid, {
      destino, correo: abreviarCorreo(correoToken), resultado: noRevocable ? 'rechazado_propietario' : 'fallo_drive',
    });
    if (noRevocable) throw new HttpsError('failed-precondition', 'Esa cuenta de Google ya es propietaria de la hoja: no se puede administrar su permiso.');
    throw new HttpsError('unavailable', MENSAJE.drive);
  }

  // Se vuelve a contar dentro de la transacción: dos altas a la vez no pasan el tope ni repiten el Gmail.
  const colec = coleccion(tenantId);
  const veredicto = await db().runTransaction(async (tx) => {
    const ahora = await tx.get(colec.where('estado', '==', 'activo'));
    const mismoGmail = await tx.get(colec.where('correoGoogle', '==', correoToken));
    const actual = await tx.get(colec.doc(destino));
    const miembroAhora = await tx.get(db().doc(`tenants/${tenantId}/miembros/${destino}`));
    const negocioAhora = await tx.get(db().doc(`tenants/${tenantId}`));
    const crmAhora = await tx.get(db().doc(`tenants/${tenantId}/config/crm`));
    // En Drive dos altas del mismo Gmail devuelven el MISMO id de permiso: si alguien vigente (o con la baja pendiente)
    // lo tiene, borrarlo quitaría el permiso de esa persona.
    const vigente = (x: { data(): Record<string, unknown> | undefined }) =>
      (x.data()?.['estado'] === 'activo' || x.data()?.['estado'] === 'revocado_pendiente') && x.data()?.['permisoId'] === permisoId
      // El id de permiso de un usuario es el mismo en todos los archivos: solo protege si es de ESTA hoja.
      && x.data()?.['archivoId'] === archivoId;
    const compartido = mismoGmail.docs.some(vigente) || (actual.exists && vigente(actual));
    // Si el negocio se suspendió o dio de baja, o el miniCRM se apagó mientras tanto, nadie queda con acceso: el cierre
    // y el apagado ya revocaron a los demás y no verían a este.
    if (!negocioAhora.exists || negocioAhora.data()?.['estado'] !== 'activo') return { v: 'negocio' as const, compartido };
    if (!crmActivo(crmAhora.exists ? crmAhora.data() : null)) return { v: 'crm' as const, compartido };
    // Si quitarUsuario corrió mientras tanto, la persona ya no es miembro: no queda acceso sin dueño.
    if (!miembroAhora.exists || miembroAhora.data()?.['estado'] !== 'activo') return { v: 'miembro' as const, compartido };
    if (mismoGmail.docs.some(ocupa)) return { v: 'correo' as const, compartido };
    // Otra alta para la MISMA persona se coló desde que se leyó: no se pisa su permisoId sin revocarlo.
    if (huella(actual) !== huella(esperado)) return { v: 'cambio' as const, compartido };
    if (ahora.docs.filter((x) => x.id !== destino).length >= limite) return { v: 'tope' as const, compartido };
    tx.set(colec.doc(destino), {
      correoGoogle: correoToken, estado: 'activo' satisfies EstadoEditor, permisoId, archivoId, creadoPorSistema: creado,
      registradoPor: uid, desde: Timestamp.now(), verificadoPor: verificadoPor,
    });
    return { v: 'ok' as const, compartido };
  });
  if (veredicto.v !== 'ok') {
    // Se deshace SOLO lo que creó esta llamada: un permiso que ya existía no es nuestro para borrarlo.
    let resultado = 'rechazado';
    if (creado && veredicto.compartido) resultado = 'rechazado_permiso_compartido_conservado';
    else if (creado) {
      try {
        await drive.borrarPermiso(archivoId, permisoId);
      } catch {
        logger.warn('editoresCrm: no se pudo deshacer el permiso tras rechazar el alta', { tenantId });
        resultado = 'rechazado_permiso_sin_deshacer';
        // Se deja constancia para que la reconciliación lo cierre, salvo que el documento de la persona esté vigente
        // (no se pisa un permiso que otra alta sí necesita).
        try {
          const ref = coleccion(tenantId).doc(destino);
          const guardado = await db().runTransaction(async (tx) => {
            const x = await tx.get(ref);
            const e = x.data()?.['estado'];
            if (x.exists && (e === 'activo' || e === 'revocado_pendiente')) return false;
            tx.set(ref, {
              correoGoogle: correoToken, estado: 'revocado_pendiente' satisfies EstadoEditor, permisoId, archivoId, motivoPendiente: 'alta_rechazada',
              reintentos: 0, revocadoEn: Timestamp.now(), revocadoPor: uid,
            });
            return true;
          });
          if (guardado) resultado = 'rechazado_permiso_pendiente_de_revocar';
        } catch {
          logger.error('editoresCrm: no se pudo dejar pendiente el permiso sin deshacer', { tenantId });
        }
      }
    }
    await auditar(tenantId, 'editor_crm_alta', uid, { destino, correo: abreviarCorreo(correoToken), motivo: veredicto.v, resultado });
    if (veredicto.v === 'miembro') throw new HttpsError('failed-precondition', 'Esa persona no es miembro activo del negocio.');
    if (veredicto.v === 'cambio') throw new HttpsError('aborted', 'Otra operación cambió a esta persona al mismo tiempo. Intente de nuevo.');
    if (veredicto.v === 'negocio') throw new HttpsError('failed-precondition', 'El negocio no está operativo.');
    if (veredicto.v === 'crm') throw new HttpsError('failed-precondition', 'El miniCRM está apagado.');
    throw veredicto.v === 'correo'
      ? new HttpsError('already-exists', 'Esa cuenta de Google ya es editora de otra persona.')
      : new HttpsError('resource-exhausted', 'El negocio alcanzó el máximo de editores de su plan.');
  }
  await auditar(tenantId, 'editor_crm_alta', uid, { destino, correo: abreviarCorreo(correoToken), verificadoPor, resultado: 'activo' });
  return { ok: true, estado: 'activo' as const };
};

// ---------------------------------------------------------------------------
// quitarEditorCrm
// ---------------------------------------------------------------------------
export const manejarQuitar = (d: Pick<DepsEditores, 'drive'>) => async (p: CallableRequest) => {
  const uid = exigirAutenticado(p);
  const { tenantId, datos } = datosDe(p);
  const rol = rolDe(p, tenantId);
  const destino = destinoDe(datos, uid);
  if (!puedeApuntarA(rol, uid, destino)) {
    throw new HttpsError('permission-denied', 'Solo el administrador quita a otras personas.');
  }
  const estado = await revocarEditor(d.drive(tenantId), tenantId, destino, uid, 'quitar_editor');
  if (estado === 'sin_editor') throw new HttpsError('not-found', 'Esa persona no es editora del miniCRM.');
  // `ok` solo si Drive confirmó: con `revocado_pendiente` la pantalla no debe decir «revocado».
  return { ok: estado === 'revocado', estado };
};

// ---------------------------------------------------------------------------
// consultarMiEdicionCrm
// ---------------------------------------------------------------------------
export const manejarConsultar = () => async (p: CallableRequest) => {
  const uid = exigirAutenticado(p);
  const { tenantId } = datosDe(p);
  rolDe(p, tenantId);
  const doc = await coleccion(tenantId).doc(uid).get();
  if (!doc.exists) return { estado: 'ninguno' as const, enlaceHoja: null };
  const f = doc.data() as Record<string, unknown>;
  const estado = f['estado'];
  if (estado !== 'activo') {
    return { estado: estado === 'revocado_pendiente' ? 'revocado_pendiente' as const : 'revocado' as const, enlaceHoja: null };
  }
  const configCrm = await db().doc(`tenants/${tenantId}/config/crm`).get();
  const enlace = await db().doc(`tenants/${tenantId}/enlaces/minicrm`).get();
  const url = enlace.data()?.['enlaceHoja'];
  const visible = crmActivo(configCrm.exists ? configCrm.data() : null) && archivoDeEnlace(url) !== null ? url as string : null;
  return {
    estado: 'activo' as const,
    correo: typeof f['correoGoogle'] === 'string' ? abreviarCorreo(f['correoGoogle']) : '',
    enlaceHoja: visible,
  };
};

// ---------------------------------------------------------------------------
// Armado real
// ---------------------------------------------------------------------------
/*
 * POR QUÉ SE LEEN DEL ENTORNO Y NO COMO PARÁMETRO DE firebase-functions (06/11/2026). Con `--non-interactive`,
 * firebase-tools exige que TODO parámetro declarado tenga su valor en `functions/.env`: el `default` no cuenta
 * (`lib/deploy/functions/params.js`, `resolveParams`, 15.28.1). Declarados con `default: ''`, los dos de abajo
 * tumbaron el despliegue a staging en cada fusión desde #776, y en producción no pueden agregarse al `.env`, que el
 * workflow exige de exactamente dos líneas. Leídos de `process.env` (como `CPU_FRACCIONARIA` en
 * `core/opcionesGlobales.ts`), firebase-tools no los ve y el comportamiento es el mismo: ausente o vacía = apagado.
 * La prueba `pruebas/parametros-del-despliegue.test.ts` impide volver a declararlos como parámetro.
 */
/** El cliente OAuth web del proyecto. Ausente o vacío = la verificación falla cerrada. No es un secreto. */
const audienciaGoogle = (): string => process.env['GOOGLE_OAUTH_CLIENT_ID'] ?? '';
/** El proyecto de GCP que aloja las cuentas `crm-<tenant>`; si falta, el de la propia Function. */
const proyectoCrm = (): string => process.env['CRM_PROYECTO_GCP'] ?? '';

export const DEPS_REALES: DepsEditores = {
  verificar: crearVerificadorGoogle(audienciaGoogle),
  drive: (tenantId) => {
    const proyecto = proyectoCrm() || process.env['GCLOUD_PROJECT'] || '';
    const cuenta = correoCuentaCrm(tenantId, proyecto);
    return cuenta ? crearClienteDrive({ cuentaServicio: cuenta }) : null;
  },
};

export const registrarEditorCrm = onCall(manejarRegistrar(DEPS_REALES));
export const quitarEditorCrm = onCall(manejarQuitar(DEPS_REALES));
export const consultarMiEdicionCrm = onCall(manejarConsultar());

/**
 * EL GANCHO DE `quitarUsuario`: revoca la edición de quien se quita. Nunca lanza: si Drive falla, el editor queda
 * `revocado_pendiente` (y `quitarEditorCrm` lo reintenta); lo armado lo une `ganchos.ts`.
 */
export const revocarEditorAlQuitarUsuario = (d: Pick<DepsEditores, 'drive'> = DEPS_REALES) =>
  async (tenantId: string, uidDestino: string, quien: string): Promise<void> => {
    try {
      await revocarEditor(d.drive(tenantId), tenantId, uidDestino, quien, 'quitar_usuario');
    } catch {
      logger.error('editoresCrm: no se pudo revocar al quitar al usuario', { tenantId });
    }
  };

// ---------------------------------------------------------------------------
// SEGUIMIENTO (03/11/2026): revocar a todos, config apagada, reconciliación
// ---------------------------------------------------------------------------
/**
 * Revoca a TODOS los editores vigentes o con la baja pendiente de UN tenant (`driveDe` arma su cliente; solo lee y escribe su subcolección).
 * Nunca lanza: un editor que falla queda `revocado_pendiente` y lo cierra la reconciliación.
 */
export async function revocarTodosLosEditores(
  driveDe: () => ClienteDrive | null, tenantId: string, quien: string, motivo: string,
  estados: readonly string[] = ['activo', 'revocado_pendiente'],
): Promise<{ revocados: number; pendientes: number; tocados: string[] }> {
  let revocados = 0;
  let pendientes = 0;
  const vigentes = await coleccion(tenantId).where('estado', 'in', [...estados]).get();
  // PRIMERO se deja constancia durable (`revocado_pendiente` con su motivo): si algo lanza antes o durante Drive, la
  // reconciliación ya sabe a quién cerrar. Un `activo` que no se marcó se perdería (el disparador no reintenta).
  for (const d of vigentes.docs) {
    try {
      await marcarPendiente(tenantId, d.id, motivo);
    } catch {
      logger.error('editoresCrm: no se pudo dejar la revocación pendiente', { tenantId });
    }
  }
  // El cliente de Drive se arma solo si hay a quién revocar; si no se puede armar, todos quedan pendientes.
  let drive: ClienteDrive | null = null;
  if (!vigentes.empty) {
    try { drive = driveDe(); } catch { logger.error('editoresCrm: no se pudo armar el cliente de Drive', { tenantId }); }
  }
  for (const d of vigentes.docs) {
    try {
      const e = await revocarEditor(drive, tenantId, d.id, quien, motivo);
      if (e === 'revocado') revocados++; else if (e === 'revocado_pendiente') pendientes++;
    } catch {
      pendientes++;
      logger.error('editoresCrm: no se pudo revocar a un editor', { tenantId });
    }
  }
  return { revocados, pendientes, tocados: vigentes.docs.map((x) => x.id) };
}

/** Deja a un editor `activo` como `revocado_pendiente` (con motivo y reintentos en cero). Otro estado no se toca. */
async function marcarPendiente(tenantId: string, uid: string, motivo: string): Promise<void> {
  const ref = coleccion(tenantId).doc(uid);
  await db().runTransaction(async (tx) => {
    const d = await tx.get(ref);
    if (!d.exists || d.data()?.['estado'] !== 'activo') return;
    tx.update(ref, { estado: 'revocado_pendiente' satisfies EstadoEditor, motivoPendiente: motivo, reintentos: 0 });
  });
}

/** EL GANCHO DE `bajaTenant` Y `suspenderTenant` (lo une `ganchos.ts`). Nunca lanza. */
export const revocarEditoresAlCerrarTenant = (d: Pick<DepsEditores, 'drive'> = DEPS_REALES) =>
  async (tenantId: string, quien: string, motivo: 'baja' | 'suspension'): Promise<void> => {
    try {
      await revocarTodosLosEditores(() => d.drive(tenantId), tenantId, quien, motivo === 'baja' ? 'baja_tenant' : 'suspension_tenant');
    } catch {
      logger.error('editoresCrm: no se pudo revocar a los editores al cerrar el negocio', { tenantId });
    }
  };

/** Al pasar `config/crm.activo` a `false` (de encendido o ausente) se revoca a todos. Reencender NO restituye accesos. */
export const manejarCambioConfigCrm = (d: Pick<DepsEditores, 'drive'> = DEPS_REALES) =>
  async (tenantId: string, antes: Record<string, unknown> | undefined, despues: Record<string, unknown> | undefined): Promise<void> => {
    if (!despues || crmActivo(despues) || !crmActivo(antes ?? null)) return;
    try {
      await revocarTodosLosEditores(() => d.drive(tenantId), tenantId, 'sistema', 'crm_apagado');
    } catch {
      // El disparador no reintenta: lo que no se alcanzó a marcar lo cierra la reconciliación (crm.activo = false).
      logger.error('editoresCrm: no se pudo revocar a los editores al apagar el miniCRM', { tenantId });
    }
  };

export const revocarEditoresAlApagarCrm = onDocumentWritten(
  { document: 'tenants/{tenantId}/config/crm', region: REGION, maxInstances: 5 },
  async (evento) => {
    await manejarCambioConfigCrm()(evento.params.tenantId, evento.data?.before.data(), evento.data?.after.data());
  },
);

/** Intentos máximos de la reconciliación por editor (a la hora: un día). Pasado el tope queda a mano y se audita. */
export const MAX_REINTENTOS_REVOCACION = 24;

/**
 * RECONCILIACIÓN de `revocado_pendiente`: por cada tenant, por separado y sin estado compartido, reintenta la
 * revocación de sus editores pendientes. Idempotente (`revocarEditor` no toca a un `revocado`), con tope de reintentos.
 */
export const reconciliarEditoresPendientes = (d: Pick<DepsEditores, 'drive'> = DEPS_REALES) =>
  async (): Promise<{ intentados: number; cerrados: number; agotados: number }> => {
    const r = { intentados: 0, cerrados: 0, agotados: 0 };
    const tenants = await db().collection('tenants').select('estado').get();
    for (const t of tenants.docs) {
      try {
        // Red de seguridad: un editor `activo` en un negocio suspendido o dado de baja, o con el miniCRM apagado, no debe
        // existir (el gancho o el disparador pudieron fallar sin dejar rastro).
        const estadoNegocio = t.get('estado');
        const cerrado = estadoNegocio === 'suspendido' || estadoNegocio === 'dado_de_baja';
        const configCrm = await db().doc(`tenants/${t.id}/config/crm`).get();
        // Los que se acaban de marcar y tocar en esta corrida no se reintentan en ella.
        let recien = new Set<string>();
        if (cerrado || !crmActivo(configCrm.exists ? configCrm.data() : null)) {
          const x = await revocarTodosLosEditores(() => d.drive(t.id), t.id, 'sistema', cerrado ? 'negocio_cerrado' : 'crm_apagado', ['activo']);
          r.cerrados += x.revocados;
          recien = new Set(x.tocados);
        }
        const pendientes = await coleccion(t.id).where('estado', '==', 'revocado_pendiente').get();
        for (const doc of pendientes.docs) {
          // Un editor que falla no salta a los demás del mismo negocio.
          if (recien.has(doc.id)) continue;
          try {
            const f = doc.data();
            const hechos = typeof f['reintentos'] === 'number' ? f['reintentos'] : 0;
            if (hechos >= MAX_REINTENTOS_REVOCACION) continue;
            r.intentados++;
            const motivo = typeof f['motivoPendiente'] === 'string' ? f['motivoPendiente'] : 'reconciliacion';
            let e: string;
            try {
              e = await revocarEditor(d.drive(t.id), t.id, doc.id, 'sistema', motivo);
            } catch {
              e = 'revocado_pendiente';
            }
            if (e === 'revocado') { r.cerrados++; continue; }
            await doc.ref.update({ reintentos: FieldValue.increment(1) });
            if (hechos + 1 >= MAX_REINTENTOS_REVOCACION) {
              r.agotados++;
              logger.error('editoresCrm: la revocación agotó sus reintentos', { tenantId: t.id });
              await auditar(t.id, 'editor_crm_reconciliacion_agotada', 'sistema', { destino: doc.id, reintentos: hechos + 1 });
            }
          } catch {
            logger.error('editoresCrm: la reconciliación falló en un editor', { tenantId: t.id });
          }
        }
      } catch {
        logger.error('editoresCrm: la reconciliación falló en un negocio', { tenantId: t.id });
      }
    }
    return r;
  };

export const reconciliarEditoresCrm = onSchedule(
  { schedule: '17 * * * *', timeZone: 'America/La_Paz', region: REGION, timeoutSeconds: 540, maxInstances: 1 },
  async () => { await reconciliarEditoresPendientes()(); },
);
