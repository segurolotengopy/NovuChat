import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { asignarRol, type Rol } from './claims.js';

initializeApp();
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

export { ingesta } from './ingesta.js';

const db = () => getFirestore();

// --- Ayudantes de autorización del lado servidor ----------------------------
// Las Cloud Functions NO están sujetas a firestore.rules: usan el SDK Admin y se
// las saltan. Por eso cada función vuelve a comprobar el permiso a mano, desde
// los claims del token que Firebase ya verificó. Confiar en que "el panel solo
// muestra el botón al admin" sería confiar en el navegador.

const claims = (p: CallableRequest) => {
  const nc = p.auth?.token?.['nc'];
  if (typeof nc !== 'object' || nc === null) return { p: false, t: {} as Record<string, Rol> };
  const b = nc as Record<string, unknown>;
  return {
    p: b['p'] === true,
    t: (typeof b['t'] === 'object' && b['t'] !== null ? b['t'] : {}) as Record<string, Rol>,
  };
};

const exigirAutenticado = (p: CallableRequest): string => {
  if (!p.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.');
  return p.auth.uid;
};

const exigirPropietario = (p: CallableRequest): string => {
  const uid = exigirAutenticado(p);
  if (!claims(p).p) throw new HttpsError('permission-denied', 'Solo NovuChat.');
  return uid;
};

const exigirAdminDe = (p: CallableRequest, tenantId: string): string => {
  const uid = exigirAutenticado(p);
  if (claims(p).t[tenantId] !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo el administrador del negocio.');
  }
  return uid;
};

const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const texto = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.slice(0, max).trim() : '';

const auditar = (tenantId: string, accion: string, uid: string, detalle: object = {}) =>
  db().collection(`tenants/${tenantId}/auditoria`).add({
    accion, uid, en: Timestamp.now(), ...detalle,
  });

// ---------------------------------------------------------------------------
// ALTA DE UN NEGOCIO. Es lo que sostiene la promesa de instalar un cliente en
// 48 horas: crea la ficha, la configuración inicial y el primer administrador
// en una sola operación atómica.
// ---------------------------------------------------------------------------
export const altaTenant = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = peticion.data as Record<string, unknown>;

  const tenantId = texto(datos['tenantId'], 60).toLowerCase();
  const nombre = texto(datos['nombre'], 80);
  const correoAdmin = texto(datos['correoAdmin'], 254);
  if (!ID_TENANT.test(tenantId) || !nombre || !correoAdmin) {
    throw new HttpsError('invalid-argument', 'Datos incompletos.');
  }

  // NUNCA se reutiliza un identificador de tenant, ni siquiera uno dado de baja.
  // Si se reutilizara, un claim viejo que todavía diga `{"salon-x": "admin"}`
  // le daría al antiguo dueño acceso de administrador al negocio NUEVO que
  // heredó el identificador. Por eso la baja es lógica y el id queda quemado.
  const ref = db().doc(`tenants/${tenantId}`);
  if ((await ref.get()).exists) {
    throw new HttpsError('already-exists', 'Ese identificador ya se usó. Elija otro.');
  }

  const usuarioAdmin = await getAuth().getUserByEmail(correoAdmin).catch(() => null);
  if (!usuarioAdmin) {
    throw new HttpsError('failed-precondition', 'El administrador debe haber ingresado una vez.');
  }

  const lote = db().batch();
  lote.create(ref, { nombre, estado: 'activo', plan: 'basico', creadoEn: Timestamp.now(), creadoPor: uid });
  lote.create(db().doc(`tenants/${tenantId}/config/negocio`), {
    nombreNegocio: nombre,
    zonaHoraria: 'America/La_Paz',
    moneda: 'BOB',
    actualizadoPor: uid,
    actualizadoEn: Timestamp.now(),
  });
  lote.create(db().doc(`tenants/${tenantId}/miembros/${usuarioAdmin.uid}`), {
    correo: correoAdmin, rol: 'admin', estado: 'activo', desde: Timestamp.now(),
  });
  await lote.commit();

  await asignarRol(usuarioAdmin.uid, tenantId, 'admin');
  await auditar(tenantId, 'alta_tenant', uid, { admin: usuarioAdmin.uid });

  return { tenantId };
});

// ---------------------------------------------------------------------------
// BAJA. Lógica, no destructiva: `estado: 'dado_de_baja'` corta el acceso de
// inmediato por la regla `tenantActivo()`, y se revocan las sesiones para que
// nadie siga adentro con un token que todavía no caducó. El borrado real de los
// datos es un procedimiento aparte, deliberado y con plazo.
// ---------------------------------------------------------------------------
export const bajaTenant = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const tenantId = texto((peticion.data as Record<string, unknown>)['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');

  await db().doc(`tenants/${tenantId}`).update({
    estado: 'dado_de_baja', bajaEn: Timestamp.now(), bajaPor: uid,
  });

  const miembros = await db().collection(`tenants/${tenantId}/miembros`).get();
  for (const m of miembros.docs) {
    await asignarRol(m.id, tenantId, null, { revocarSesiones: true });
  }
  await auditar(tenantId, 'baja_tenant', uid, { miembros: miembros.size });
  return { ok: true };
});

// ---------------------------------------------------------------------------
// USUARIOS DEL NEGOCIO
// ---------------------------------------------------------------------------
export const invitarUsuario = onCall(async (peticion) => {
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  const uid = exigirAdminDe(peticion, tenantId);

  const correo = texto(datos['correo'], 254).toLowerCase();
  const rol = datos['rol'] === 'admin' ? 'admin' : 'oper';
  // Un administrador de negocio NO puede crear roles de plataforma ni de
  // servicio: la lista de roles asignables está cerrada acá arriba.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
    throw new HttpsError('invalid-argument', 'Correo inválido.');
  }

  const destino = await getAuth().getUserByEmail(correo).catch(() => null);
  if (!destino) throw new HttpsError('failed-precondition', 'La persona debe ingresar una vez primero.');

  await db().doc(`tenants/${tenantId}/miembros/${destino.uid}`).set({
    correo, rol, estado: 'activo', desde: Timestamp.now(), invitadoPor: uid,
  });
  await asignarRol(destino.uid, tenantId, rol);
  await auditar(tenantId, 'invitar_usuario', uid, { destino: destino.uid, rol });
  return { ok: true };
});

export const quitarUsuario = onCall(async (peticion) => {
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  const uid = exigirAdminDe(peticion, tenantId);
  const destino = texto(datos['uid'], 128);
  if (!destino) throw new HttpsError('invalid-argument', 'Falta el usuario.');

  await db().doc(`tenants/${tenantId}/miembros/${destino}`).delete();
  // Revocación inmediata: sin esto el usuario retirado sigue leyendo hasta una
  // hora, que es lo que dura su ID token.
  await asignarRol(destino, tenantId, null, { revocarSesiones: true });
  await auditar(tenantId, 'quitar_usuario', uid, { destino });
  return { ok: true };
});

// ---------------------------------------------------------------------------
// ACCESO DE SOPORTE. NovuChat no lee conversaciones de sus clientes por defecto.
// Cuando hace falta para resolver un problema, el ADMIN DEL NEGOCIO abre una
// ventana con vencimiento. El propietario no puede abrírsela solo.
// ---------------------------------------------------------------------------
export const otorgarAccesoSoporte = onCall(async (peticion) => {
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  const uid = exigirAdminDe(peticion, tenantId);

  const uidSoporte = texto(datos['uidSoporte'], 128);
  const horas = Math.min(Math.max(Number(datos['horas']) || 2, 1), 24);
  if (!uidSoporte) throw new HttpsError('invalid-argument', 'Falta el usuario de soporte.');

  const destino = await getAuth().getUser(uidSoporte).catch(() => null);
  const ncDestino = destino?.customClaims?.['nc'] as { p?: boolean } | undefined;
  if (ncDestino?.p !== true) {
    throw new HttpsError('invalid-argument', 'Ese usuario no es personal de NovuChat.');
  }

  const expira = Timestamp.fromMillis(Date.now() + horas * 3600_000);
  await db().doc(`tenants/${tenantId}/accesosSoporte/${uidSoporte}`).set({
    expira, otorgadoPor: uid, otorgadoEn: Timestamp.now(),
  });
  await auditar(tenantId, 'acceso_soporte', uid, { uidSoporte, horas });
  return { expira: expira.toMillis() };
});

export const revocarAccesoSoporte = onCall(async (peticion) => {
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  const uid = exigirAdminDe(peticion, tenantId);
  const uidSoporte = texto(datos['uidSoporte'], 128);

  await db().doc(`tenants/${tenantId}/accesosSoporte/${uidSoporte}`).delete();
  await auditar(tenantId, 'revocar_acceso_soporte', uid, { uidSoporte });
  return { ok: true };
});

// ---------------------------------------------------------------------------
// CONFIGURACIÓN QUE CONSUME n8n. El flujo pide la configuración por acá en vez
// de tenerla escrita en el nodo `Config del negocio`: es lo que permite que el
// cliente cambie sus horarios sin que nadie toque n8n.
//
// La respuesta viene con los campos SEPARADOS y rotulados. `instruccionesExtra`
// se entrega en su propia clave para que el flujo la inserte en una sección
// delimitada del prompt, marcada como dato del negocio. Nunca concatenada por
// delante de las reglas de comportamiento del agente.
// ---------------------------------------------------------------------------
export const configuracionParaFlujo = onCall(async (peticion) => {
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  const c = claims(peticion);
  if (!c.t[tenantId] && !c.p) throw new HttpsError('permission-denied', 'Sin acceso.');

  const [tenant, config, catalogo] = await Promise.all([
    db().doc(`tenants/${tenantId}`).get(),
    db().doc(`tenants/${tenantId}/config/negocio`).get(),
    db().collection(`tenants/${tenantId}/catalogo`).where('activo', '==', true).limit(200).get(),
  ]);
  if (tenant.get('estado') !== 'activo') throw new HttpsError('failed-precondition', 'Negocio inactivo.');

  return {
    negocio: config.data() ?? {},
    catalogo: catalogo.docs.map((d) => ({ id: d.id, ...d.data() })),
    generadoEn: FieldValue.serverTimestamp(),
  };
});
