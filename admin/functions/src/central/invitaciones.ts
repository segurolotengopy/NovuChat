// ZONA CENTRAL: invitaciones con aceptación (I1, cierre del hallazgo de `invitarUsuario`).
//
// Antes, `invitarUsuario` consultaba Auth por correo (un sondeo entre negocios: respondía
// distinto si la cuenta existía) y le ponía el rol a la persona SIN su consentimiento. Ahora
// invitar solo deja un documento `tenants/{t}/invitaciones/{sha256(correo)}`; el rol (claim y
// ficha de miembro) nace cuando la persona ACEPTA, con su propia sesión. Sin aceptación no
// hay claim ni miembro. Sin correo: la persona ve la invitación al ingresar.
//
// La decisión pura (estados, vigencia, permisos, topes, mensajes) está en
// `invitacionesDecision.ts`; acá solo se lee, se llama a esas funciones y se escribe.
// `firestore.rules` NO cambia: la colección ya es de solo lectura para admin y propietario, y
// el invitado nunca la lee directo: pasa por `misInvitaciones`.
//
// LÍMITES CONOCIDOS (documentados a propósito):
//  - Aceptar NO es atómico: el claim vive en Auth y la ficha en Firestore, y no hay transacción
//    entre los dos. Por eso el orden hace inerte el estado intermedio: PRIMERO la transacción
//    (miembro + aceptada + auditoría; sin claim un miembro no puede nada) y AL FINAL el claim; si
//    el claim falla se revierte, y si ni la reversión se logra queda `compensacionPendiente: true`
//    en la invitación. El riesgo residual es de disponibilidad (una persona aceptada sin acceso),
//    nunca de escalada. `asignarRol` (claims.ts) es de Rearquitectura y no se toca.
//  - `misInvitaciones` lee hasta 100 invitaciones por correo (consulta de grupo por `correo`, un
//    solo índice simple) y filtra el estado y el plazo en memoria; no hay filtro por estado porque
//    exigiría un índice compuesto. Devuelve a lo sumo 20.
//  - Cancelar y volver a invitar reinicia el tope de 5 reenvíos: reciclaje ACEPTADO por Andres.
//  - Depende del PR-I0: la exportación en `index.ts` y el índice de `invitaciones.correo`.
import { Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { asignarRol, type Rol } from '../core/seguridad/claims.js';
import { cuentaVigenteDe } from '../core/seguridad/vigencia.js';
import {
  correoVerificado, exigirAdminDe, exigirAutenticado, proveedorDe,
} from '../core/seguridad/autorizacion.js';
import { ID_TENANT, db } from './comunes.js';
import {
  MENSAJE, aceptadaMensaje, decidirInvitar, decidirResponder, esIdInvitacion,
  estadoEfectivo, idInvitacion, msDe, normalizarCorreo, venceEnDesde, type RolInvitado,
} from './invitacionesDecision.js';
import { titularDe, titularDeFicha } from './titular.js';

const datosDe = (peticion: { data: unknown }): Record<string, unknown> =>
  (typeof peticion.data === 'object' && peticion.data !== null ? peticion.data : {}) as Record<string, unknown>;

/** `tenantId` con la forma de un id de negocio (rechaza `/`, `__proto__`, largos). */
function tenantValido(v: unknown): string {
  // Sin recortar: un id de 61 caracteres no se trunca a uno válido que sea de otro negocio.
  if (typeof v !== 'string' || !ID_TENANT.test(v) || v.length > 60) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  return v;
}

function invitacionValida(v: unknown): string {
  if (!esIdInvitacion(v)) throw new HttpsError('invalid-argument', 'Invitación inválida.');
  return v;
}

/** Sesión de la persona invitada: contraseña, correo verificado y correo en el token. */
function sesionInvitado(p: Parameters<typeof exigirAutenticado>[0]): { uid: string; correo: string } {
  const uid = exigirAutenticado(p);
  const correo = normalizarCorreo(p.auth?.token?.['email']);
  if (proveedorDe(p) !== 'password' || !correoVerificado(p) || correo === null) {
    throw new HttpsError('permission-denied', MENSAJE.sesion);
  }
  return { uid, correo };
}

/**
 * Como los callables sensibles: además del token, la cuenta debe seguir existiendo, habilitada,
 * con el rol admin de ESTE negocio y sin sesiones revocadas (el token vale hasta una hora).
 */
async function exigirAdminVigente(p: CallableRequest, uid: string, tenantId: string): Promise<void> {
  const authTime = p.auth?.token?.['auth_time'];
  const vigente = typeof authTime === 'number' && await cuentaVigenteDe(uid, authTime, 'admin', tenantId);
  if (!vigente) throw new HttpsError('permission-denied', 'Solo el administrador del negocio.');
}

const auditoriaNueva = (tenantId: string) => db().collection(`tenants/${tenantId}/auditoria`).doc();
const invitacionesDe = (tenantId: string) => db().collection(`tenants/${tenantId}/invitaciones`);

// ---------------------------------------------------------------------------
// INVITAR (un administrador). No consulta Auth, no toca claims ni `miembros`.
// ---------------------------------------------------------------------------
export const invitarUsuario = onCall(async (peticion) => {
  const datos = datosDe(peticion);
  const tenantId = tenantValido(datos['tenantId']);
  const uid = exigirAdminDe(peticion, tenantId);
  await exigirAdminVigente(peticion, uid, tenantId);

  const correo = normalizarCorreo(datos['correo']);
  if (correo === null) throw new HttpsError('invalid-argument', 'Correo inválido.');
  // La lista de roles asignables está cerrada: un administrador de negocio no crea roles de
  // plataforma ni de servicio. Un rol ausente equivale al menor (oper).
  const rol: RolInvitado = datos['rol'] === 'admin' ? 'admin' : 'oper';

  const titular = await titularDe(tenantId);
  // ¿Ya es usuaria de ESTE negocio? Solo se mira la ficha propia (`miembros`), nunca Auth:
  // la respuesta no puede depender de que la cuenta exista en otro negocio.
  const yaMiembro = !(await db().collection(`tenants/${tenantId}/miembros`)
    .where('correo', '==', correo).limit(1).get()).empty;

  const id = idInvitacion(correo);
  const ref = invitacionesDe(tenantId).doc(id);
  const ahora = Date.now();

  const resultado = await db().runTransaction(async (tx) => {
    const [propia, pendientes] = await Promise.all([
      tx.get(ref),
      tx.get(invitacionesDe(tenantId).where('estado', '==', 'pendiente').limit(100)),
    ]);
    // Las pendientes cuyo plazo pasó no cuentan para el tope y se limpian acá mismo (sin
    // tarea programada, el costo es cero mientras nadie toque el negocio).
    let vigentesOtras = 0;
    const vencidas: Array<typeof ref> = [];
    for (const d of pendientes.docs) {
      if (estadoEfectivo(d.data(), ahora) === 'pendiente') { if (d.id !== id) vigentesOtras += 1; }
      else if (d.id !== id) vencidas.push(d.ref as typeof ref);
    }
    const actual = propia.exists ? propia.data() : undefined;
    const decision = decidirInvitar({
      rol,
      hayTitular: titular !== null,
      invitadorEsTitular: titular !== null && uid === titular,
      yaMiembro,
      existente: actual
        ? { estado: estadoEfectivo(actual, ahora), reenvios: typeof actual['reenvios'] === 'number' ? actual['reenvios'] : 0 }
        : null,
      vigentesOtras,
    });
    if (!decision.ok) return decision;

    for (const v of vencidas) tx.update(v, { estado: 'vencida', resueltaEn: Timestamp.fromMillis(ahora) });
    const venceEn = Timestamp.fromMillis(venceEnDesde(ahora));
    if (decision.accion === 'renovar') {
      tx.update(ref, {
        rol, estado: 'pendiente', motivo: null, venceEn, reenvios: decision.reenvios,
        reenviadaPor: uid, reenviadaEn: Timestamp.fromMillis(ahora), resueltaEn: null, resueltaPor: null,
      });
    } else {
      tx.set(ref, {
        correo, rol, estado: 'pendiente', motivo: null, creadaPor: uid,
        creadaEn: Timestamp.fromMillis(ahora), venceEn, reenvios: 0, resueltaEn: null, resueltaPor: null,
      });
    }
    // El id es el hash del correo: el registro no lleva el correo de nadie.
    tx.create(auditoriaNueva(tenantId), {
      accion: decision.accion === 'renovar' ? 'reenviar_invitacion' : 'invitar_usuario',
      uid, en: Timestamp.fromMillis(ahora), invitacion: id, rol, reenvios: decision.reenvios,
    });
    return decision;
  });
  if (!resultado.ok) throw new HttpsError(resultado.code, resultado.mensaje);
  // Siempre lo mismo, exista o no la cuenta: la respuesta no dice nada de Auth.
  return { ok: true, mensaje: MENSAJE.invitada };
});

// ---------------------------------------------------------------------------
// MIS INVITACIONES (la persona invitada, con su propia sesión).
// ---------------------------------------------------------------------------
const MAX_MIS_INVITACIONES = 20;

export const misInvitaciones = onCall(async (peticion) => {
  const { correo } = sesionInvitado(peticion);
  const id = idInvitacion(correo);
  const ahora = Date.now();
  // Consulta de grupo por correo: necesita el índice de `invitaciones.correo` (PR-I0).
  let cand;
  try {
    cand = await db().collectionGroup('invitaciones').where('correo', '==', correo).limit(100).get();
  } catch (e) {
    // FAILED_PRECONDITION (9) = falta el índice de grupo (PR-I0): se registra y se responde claro.
    const codigo = (e as { code?: unknown }).code;
    console.error('misInvitaciones: no se pudo consultar', codigo === 9 ? 'falta el indice de invitaciones.correo' : codigo);
    throw new HttpsError('failed-precondition', 'No se pudieron leer sus invitaciones por ahora. Intente más tarde.');
  }

  const salida: Array<{ tenantId: string; invitacionId: string; nombreNegocio: string; rol: RolInvitado; venceEn: number }> = [];
  const revisadas = await Promise.all(cand.docs.map(async (d) => {
    // Solo `tenants/{t}/invitaciones/{id}` con el id esperado para ESTE correo.
    const tenantId = d.ref.parent.parent?.id ?? '';
    if (d.ref.parent.parent?.parent.id !== 'tenants' || !ID_TENANT.test(tenantId) || d.id !== id) return null;
    const inv = d.data();
    if (estadoEfectivo(inv, ahora) !== 'pendiente' || (inv['rol'] !== 'admin' && inv['rol'] !== 'oper')) return null;
    const ficha = (await db().doc(`tenants/${tenantId}`).get()).data();
    if (!ficha || ficha['estado'] === 'dado_de_baja') return null;
    const nombre = typeof ficha['nombre'] === 'string' && ficha['nombre'].trim() !== '' ? ficha['nombre'].slice(0, 120) : 'un negocio';
    return { tenantId, invitacionId: d.id, nombreNegocio: nombre, rol: inv['rol'] as RolInvitado, venceEn: msDe(inv['venceEn']) };
  }));
  for (const r of revisadas) if (r && salida.length < MAX_MIS_INVITACIONES) salida.push(r);
  salida.sort((a, b) => a.venceEn - b.venceEn);
  return { invitaciones: salida };
});

// ---------------------------------------------------------------------------
// RESPONDER (aceptar o rechazar)
// ---------------------------------------------------------------------------
/**
 * La lógica de `responderInvitacion` (el callable es lo único que se exporta).
 */
async function procesarRespuesta(
  p: { uid: string; correoToken: string; tenantId: string; invitacionId: string; respuesta: 'aceptar' | 'rechazar'; ahoraMs: number },
): Promise<{ ok: true; mensaje: string }> {
  const { uid, correoToken, tenantId, invitacionId, respuesta, ahoraMs } = p;
  // Una persona solo ve y responde LA invitación de su propio correo: cualquier otro id
  // (de otro correo, de otro negocio) es «no encontrada», sin leer nada.
  if (invitacionId !== idInvitacion(correoToken)) throw new HttpsError('not-found', MENSAJE.noEncontrada);

  const ref = invitacionesDe(tenantId).doc(invitacionId);
  const fichaRef = db().doc(`tenants/${tenantId}`);
  const [snap, fichaSnap] = await Promise.all([ref.get(), fichaRef.get()]);
  const ficha = fichaSnap.data();

  let tieneAcceso = false;
  if (respuesta === 'aceptar') {
    // Rol previo: en el claim FRESCO de Auth (el del token puede estar atrasado) o en la ficha.
    const nc = (await getAuth().getUser(uid)).customClaims?.['nc'] as { t?: Record<string, unknown> } | undefined;
    const miembro = await db().doc(`tenants/${tenantId}/miembros/${uid}`).get();
    tieneAcceso = Boolean(nc?.t && Object.hasOwn(nc.t, tenantId)) || miembro.exists;
  }

  const decision = decidirResponder({
    correoToken, inv: snap.exists ? snap.data() : undefined, ahoraMs,
    negocioDeBaja: !ficha || ficha['estado'] === 'dado_de_baja', respuesta, tieneAcceso,
  });
  if (!decision.ok) {
    if (decision.persistirVencida) {
      // «vencida» se persiste al tocarla; solo si sigue pendiente (otro pudo resolverla).
      await db().runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (s.exists && s.data()?.['estado'] === 'pendiente') {
          tx.update(ref, { estado: 'vencida', resueltaEn: Timestamp.fromMillis(ahoraMs) });
        }
      });
    }
    throw new HttpsError(decision.code, decision.mensaje);
  }
  const inv = snap.data() as Record<string, unknown>;
  const rol = inv['rol'];
  if (rol !== 'admin' && rol !== 'oper') throw new HttpsError('not-found', MENSAJE.noEncontrada);

  if (respuesta === 'rechazar') {
    const hecho = await db().runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists || estadoEfectivo(s.data(), ahoraMs) !== 'pendiente') return false;
      tx.update(ref, { estado: 'revocada', motivo: 'rechazada', resueltaEn: Timestamp.fromMillis(ahoraMs), resueltaPor: uid });
      tx.create(auditoriaNueva(tenantId), { accion: 'rechazar_invitacion', uid, en: Timestamp.fromMillis(ahoraMs), invitacion: invitacionId });
      return true;
    });
    if (!hecho) throw new HttpsError('failed-precondition', MENSAJE.noVigente);
    return { ok: true, mensaje: MENSAJE.rechazada };
  }

  // ACEPTAR. Orden pensado para que el estado intermedio sea INERTE:
  //  1. la transacción (miembro + aceptada + auditoría): sin claim, un miembro no puede nada;
  //  2. al final, el claim. Si falla, se revierte (ver `revertirAceptacion`).
  const confirmacion = await db().runTransaction(async (tx) => {
    const [s, f] = await Promise.all([tx.get(ref), tx.get(fichaRef)]);
    if (!s.exists || s.data()?.['correo'] !== correoToken || estadoEfectivo(s.data(), ahoraMs) !== 'pendiente') return 'no-vigente' as const;
    // Con titular, un admin solo entra si lo invitó el titular (el titular pudo fijarse DESPUÉS
    // de crearse la invitación): se relee acá, dentro de la transacción.
    const titular = titularDeFicha(f.data());
    if (rol === 'admin' && titular !== null && s.data()?.['creadaPor'] !== titular) return 'solo-titular' as const;
    tx.update(ref, { estado: 'aceptada', motivo: null, resueltaEn: Timestamp.fromMillis(ahoraMs), resueltaPor: uid });
    tx.set(db().doc(`tenants/${tenantId}/miembros/${uid}`), {
      correo: correoToken, rol, estado: 'activo', desde: Timestamp.fromMillis(ahoraMs),
      invitadoPor: typeof inv['creadaPor'] === 'string' ? inv['creadaPor'] : null, invitacion: invitacionId,
    });
    tx.create(auditoriaNueva(tenantId), {
      accion: 'aceptar_invitacion', uid, en: Timestamp.fromMillis(ahoraMs), invitacion: invitacionId, rol,
    });
    return 'ok' as const;
  });
  if (confirmacion === 'no-vigente') throw new HttpsError('failed-precondition', MENSAJE.noVigente);
  if (confirmacion === 'solo-titular') throw new HttpsError('permission-denied', MENSAJE.soloTitularInvitaAdmin);

  try {
    await asignarRol(uid, tenantId, rol as Rol);
  } catch {
    // Cuenta vinculada a Google, tope de claims o caída de Auth: la aceptación no quedó completa.
    await revertirAceptacion(ref, tenantId, uid, invitacionId, ahoraMs);
    throw new HttpsError('failed-precondition', 'Esta cuenta no puede recibir ese acceso. Pida ayuda a NovuChat.');
  }
  return { ok: true, mensaje: aceptadaMensaje(nombreDe(ficha)) };
}

/**
 * Deshace la confirmación cuando el claim no se pudo poner: borra el miembro y devuelve la
 * invitación a `pendiente` (la persona puede reintentar). Reintenta una vez; si ni así, NO se
 * pierde en silencio: `compensacionPendiente: true` en la invitación y un log de error.
 */
async function revertirAceptacion(
  ref: FirebaseFirestore.DocumentReference, tenantId: string, uid: string, invitacionId: string, ahoraMs: number,
): Promise<void> {
  const miembroRef = db().doc(`tenants/${tenantId}/miembros/${uid}`);
  for (let intento = 0; intento < 2; intento += 1) {
    try {
      await db().runTransaction(async (tx) => {
        const [s, m] = await Promise.all([tx.get(ref), tx.get(miembroRef)]);
        if (s.exists && s.data()?.['estado'] === 'aceptada' && s.data()?.['resueltaPor'] === uid) {
          tx.update(ref, { estado: 'pendiente', motivo: null, resueltaEn: null, resueltaPor: null });
        }
        if (m.exists && m.data()?.['invitacion'] === invitacionId) tx.delete(miembroRef);
        tx.create(auditoriaNueva(tenantId), {
          accion: 'aceptar_invitacion_revertida', uid, en: Timestamp.fromMillis(ahoraMs), invitacion: invitacionId,
        });
      });
      return;
    } catch { /* se reintenta una vez */ }
  }
  console.error('invitacion: no se pudo revertir la aceptacion', tenantId, invitacionId);
  await ref.update({ compensacionPendiente: true }).catch(() =>
    console.error('invitacion: tampoco se pudo marcar compensacionPendiente', tenantId, invitacionId));
}

const nombreDe = (ficha: Record<string, unknown> | undefined): string =>
  typeof ficha?.['nombre'] === 'string' && ficha['nombre'].trim() !== '' ? ficha['nombre'].slice(0, 120) : 'el negocio';

export const responderInvitacion = onCall(async (peticion) => {
  const { uid, correo } = sesionInvitado(peticion);
  const datos = datosDe(peticion);
  const tenantId = tenantValido(datos['tenantId']);
  const invitacionId = invitacionValida(datos['invitacionId']);
  const respuesta = datos['respuesta'];
  if (respuesta !== 'aceptar' && respuesta !== 'rechazar') throw new HttpsError('invalid-argument', 'Respuesta inválida.');
  return procesarRespuesta({ uid, correoToken: correo, tenantId, invitacionId, respuesta, ahoraMs: Date.now() });
});

// ---------------------------------------------------------------------------
// CANCELAR (un administrador)
// ---------------------------------------------------------------------------
export const cancelarInvitacion = onCall(async (peticion) => {
  const datos = datosDe(peticion);
  const tenantId = tenantValido(datos['tenantId']);
  const uid = exigirAdminDe(peticion, tenantId);
  await exigirAdminVigente(peticion, uid, tenantId);
  const invitacionId = invitacionValida(datos['invitacionId']);
  const ahora = Date.now();
  const ref = invitacionesDe(tenantId).doc(invitacionId);

  const hecho = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const estado = s.exists ? estadoEfectivo(s.data(), ahora) : null;
    // Se cancela una pendiente o una vencida (para limpiarla); lo ya resuelto no se toca.
    if (estado !== 'pendiente' && estado !== 'vencida') return false;
    tx.update(ref, { estado: 'revocada', motivo: 'cancelada', resueltaEn: Timestamp.fromMillis(ahora), resueltaPor: uid });
    tx.create(auditoriaNueva(tenantId), { accion: 'cancelar_invitacion', uid, en: Timestamp.fromMillis(ahora), invitacion: invitacionId });
    return true;
  });
  if (!hecho) throw new HttpsError('not-found', MENSAJE.noEncontrada);
  return { ok: true, mensaje: MENSAJE.cancelada };
});

