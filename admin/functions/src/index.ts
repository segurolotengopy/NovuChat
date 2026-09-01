import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { REGION } from './region.js';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { asignarRol, type Rol } from './claims.js';

initializeApp();
setGlobalOptions({ region: REGION, maxInstances: 10 });

export { ingesta, configuracionFlujo } from './ingesta.js';
export { registrarCierre } from './cierres.js';

import { registrar } from './ingesta.js';
export { notificarReclamo } from './reclamos.js';

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
// `phone_number_id` de Meta: dígitos. Se valida el formato para que jamás se
// use como parte de una ruta de Firestore un valor con barras o puntos.
const ID_NUMERO = /^[0-9]{6,25}$/;
// Un flujo por vertical. Ver DISENO.md §Varios flujos y varios números.
const VERTICALES = new Set(['agendamiento', 'venta', 'interno']);
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
  const vertical = VERTICALES.has(texto(datos['vertical'], 30))
    ? texto(datos['vertical'], 30) : 'agendamiento';
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
  lote.create(ref, {
    nombre, estado: 'activo', plan: 'basico', vertical,
    // El número de WhatsApp se asigna aparte, con `asignarNumero`: exige
    // trámites en Meta que no se pueden hacer en la misma transacción.
    waPhoneNumberId: null, waWabaId: null,
    creadoEn: Timestamp.now(), creadoPor: uid,
  });
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
// SUSPENDER Y REACTIVAR — LA PALANCA COMERCIAL
//
// Suspender NO es dar de baja. Son cosas distintas y conviene no mezclarlas:
//
//   suspender  → corta el SERVICIO (el asistente deja de atender a los clientes
//                finales y el comercio no puede editar nada), pero el comercio
//                SIGUE VIENDO SUS DATOS. Reversible en un clic.
//   dar de baja → fin de contrato. Revoca los claims y quema el identificador.
//                 Revertirlo obliga a volver a invitar a cada usuario.
//
// POR QUÉ LA SUSPENSIÓN NO TOCA LOS CLAIMS. Es lo que la hace inmediata en los
// DOS sentidos. Si suspender revocara los claims, reactivar exigiría reemitirlos
// y que cada usuario renovara su token: el comercio que acaba de pagar seguiría
// sin servicio un rato largo, que es justo el peor momento para hacerlo esperar.
// Al depender solo del campo `estado`, que las reglas consultan en cada
// operación, el corte y la reanudación son instantáneos en ambas direcciones.
// ---------------------------------------------------------------------------
export const suspenderTenant = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');

  // El motivo es para la auditoría y para la conversación comercial. NUNCA
  // viaja al cliente final: el mensaje que recibe quien escribe por WhatsApp es
  // neutro y no revela que el comercio debe dinero. Ver DISENO.md §Suspensión.
  const motivo = texto(datos['motivo'], 300) || 'sin especificar';

  const ref = db().doc(`tenants/${tenantId}`);
  const actual = await ref.get();
  if (!actual.exists) throw new HttpsError('not-found', 'No existe ese comercio.');
  if (actual.get('estado') === 'dado_de_baja') {
    throw new HttpsError('failed-precondition', 'Está dado de baja, no suspendido.');
  }

  await ref.update({
    estado: 'suspendido',
    suspendidoEn: Timestamp.now(),
    suspendidoPor: uid,
    motivoSuspension: motivo,
  });
  // La ruta del número también se marca: n8n consulta por número, no por tenant,
  // y así corta sin necesidad de una segunda lectura.
  await marcarRutasDelTenant(tenantId, 'suspendido');

  // COHERENCIA. El comercio suspendido sigue viendo sus datos, así que también
  // tiene que ver POR QUÉ. `motivoVisible` es lo que se le muestra en el panel;
  // `motivoSuspension` de la ficha es el registro interno. Ninguno de los dos
  // llega jamás al cliente final de WhatsApp.
  await db().doc(`tenants/${tenantId}/cuenta/estado`).set({
    estadoPago: 'vencido',
    motivoVisible: texto(datos['motivoVisible'], 300)
      || 'Servicio suspendido. Comuníquese con NovuChat para regularizar su cuenta.',
    actualizadoEn: Timestamp.now(),
  }, { merge: true });

  await auditar(tenantId, 'suspender', uid, { motivo });
  // La bitácora recibe el hecho SIN el motivo comercial: ese texto es interno y
  // vive en /auditoria y en la ficha. La bitácora la lee también el comercio.
  await registrar(tenantId, { tipo: 'suspension', resultado: 'ok', canal: 'panel' });
  return { estado: 'suspendido' };
});

export const reactivarTenant = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');

  const ref = db().doc(`tenants/${tenantId}`);
  const actual = await ref.get();
  if (!actual.exists) throw new HttpsError('not-found', 'No existe ese comercio.');
  // Una baja NO se revierte con esto. Revertirla exige volver a emitir los
  // claims de cada usuario, así que es un alta, no una reactivación.
  if (actual.get('estado') === 'dado_de_baja') {
    throw new HttpsError('failed-precondition',
      'Un comercio dado de baja no se reactiva: hay que volver a invitar a sus usuarios.');
  }

  await ref.update({
    estado: 'activo',
    suspendidoEn: FieldValue.delete(),
    suspendidoPor: FieldValue.delete(),
    motivoSuspension: FieldValue.delete(),
    reactivadoEn: Timestamp.now(),
    reactivadoPor: uid,
  });
  await marcarRutasDelTenant(tenantId, 'activo');
  await db().doc(`tenants/${tenantId}/cuenta/estado`).set({
    estadoPago: 'al_dia',
    motivoVisible: '',
    actualizadoEn: Timestamp.now(),
  }, { merge: true });
  await auditar(tenantId, 'reactivar', uid);
  await registrar(tenantId, { tipo: 'reactivacion', resultado: 'ok', canal: 'panel' });
  return { estado: 'activo' };
});

/** Propaga el estado del comercio a sus rutas de WhatsApp. */
async function marcarRutasDelTenant(tenantId: string, estado: string): Promise<void> {
  const rutas = await db().collection('rutasWhatsApp').where('tenantId', '==', tenantId).get();
  const lote = db().batch();
  for (const r of rutas.docs) lote.update(r.ref, { estado });
  await lote.commit();
}

// ---------------------------------------------------------------------------
// NÚMEROS DE WHATSAPP — un comercio, su número, su flujo.
//
// El webhook de Meta no trae el identificador del comercio: trae el
// `phone_number_id`. El índice inverso /rutasWhatsApp lo resuelve en una lectura
// directa por clave, sin índice compuesto y sin abrir el listado de /tenants.
// ---------------------------------------------------------------------------
export const asignarNumero = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  const phoneNumberId = texto(datos['phoneNumberId'], 25);
  const wabaId = texto(datos['wabaId'], 25);
  const flujo = texto(datos['flujo'], 30);

  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  if (!ID_NUMERO.test(phoneNumberId)) throw new HttpsError('invalid-argument', 'phone_number_id inválido.');
  if (!VERTICALES.has(flujo)) throw new HttpsError('invalid-argument', 'Flujo desconocido.');

  const ref = db().doc(`rutasWhatsApp/${phoneNumberId}`);
  await db().runTransaction(async (tx) => {
    const existente = await tx.get(ref);
    // UNICIDAD. Si un phone_number_id pudiera apuntar a dos comercios, las
    // conversaciones de uno se escribirían en el otro: una fuga de datos
    // provocada por un error de dedo, no por un atacante.
    if (existente.exists && existente.get('tenantId') !== tenantId) {
      throw new HttpsError('already-exists',
        'Ese número ya está asignado a otro comercio. Libérelo primero.');
    }
    const tenant = await tx.get(db().doc(`tenants/${tenantId}`));
    if (!tenant.exists) throw new HttpsError('not-found', 'No existe ese comercio.');

    tx.set(ref, {
      tenantId, flujo, wabaId,
      estado: tenant.get('estado') ?? 'activo',
      asignadoEn: Timestamp.now(), asignadoPor: uid,
    });
    tx.update(tenant.ref, { waPhoneNumberId: phoneNumberId, waWabaId: wabaId, vertical: flujo });
  });

  await auditar(tenantId, 'asignar_numero', uid, { phoneNumberId, wabaId, flujo });
  return { ok: true };
});

export const liberarNumero = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const phoneNumberId = texto((peticion.data as Record<string, unknown>)['phoneNumberId'], 25);
  if (!ID_NUMERO.test(phoneNumberId)) throw new HttpsError('invalid-argument', 'phone_number_id inválido.');

  const ref = db().doc(`rutasWhatsApp/${phoneNumberId}`);
  const actual = await ref.get();
  if (!actual.exists) return { ok: true };
  const tenantId = String(actual.get('tenantId') ?? '');

  await ref.delete();
  if (ID_TENANT.test(tenantId)) {
    await db().doc(`tenants/${tenantId}`).update({
      waPhoneNumberId: null, waWabaId: null,
    });
    await auditar(tenantId, 'liberar_numero', uid, { phoneNumberId });
  }
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

  // El panel exige `email_verified` en las reglas, así que un administrador de
  // comercio sin verificar no ve nada aunque tenga el claim. Se avisa acá para
  // que quien invita entienda por qué la persona "entra pero no ve".
  const verificado = destino.emailVerified;

  await db().doc(`tenants/${tenantId}/miembros/${destino.uid}`).set({
    correo, rol, estado: verificado ? 'activo' : 'pendiente_verificacion',
    desde: Timestamp.now(), invitadoPor: uid,
  });
  // `asignarRol` rechaza la asignación si la cuenta no es de contraseña pura.
  await asignarRol(destino.uid, tenantId, rol);
  await auditar(tenantId, 'invitar_usuario', uid, { destino: destino.uid, rol, verificado });
  return { ok: true, verificado };
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
// ESTADO DE CUENTA. Lo escribe NovuChat; el comercio solo lo lee.
//
// `motivoVisible` es el texto que ve EL COMERCIO. Es su relación comercial y
// tiene derecho a conocerla. No confundir con el mensaje que recibe el CLIENTE
// FINAL por WhatsApp, que es neutro y no menciona pagos (ver T-18).
// ---------------------------------------------------------------------------
const ESTADOS_PAGO = new Set(['al_dia', 'pendiente', 'vencido']);

export const actualizarEstadoCuenta = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');

  const estadoPago = texto(datos['estadoPago'], 20);
  if (!ESTADOS_PAGO.has(estadoPago)) throw new HttpsError('invalid-argument', 'Estado de pago inválido.');

  const monto = Number(datos['montoMensual']);
  const vence = Number(datos['proximoVencimiento']);

  await db().doc(`tenants/${tenantId}/cuenta/estado`).set({
    plan: texto(datos['plan'], 40) || 'basico',
    estadoPago,
    montoMensual: Number.isFinite(monto) && monto >= 0 ? monto : 0,
    moneda: datos['moneda'] === 'USD' ? 'USD' : 'BOB',
    ...(Number.isFinite(vence) ? { proximoVencimiento: Timestamp.fromMillis(vence) } : {}),
    motivoVisible: texto(datos['motivoVisible'], 300),
    actualizadoEn: Timestamp.now(),
  }, { merge: true });

  await auditar(tenantId, 'estado_cuenta', uid, { estadoPago });
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
// VISTA PREVIA DE LO QUE VE EL ASISTENTE.
//
// n8n NO llama a esta función: usa `configuracionFlujo` (en ingesta.ts), que se
// autentica con HMAC y resuelve el comercio por `phone_number_id`. Ésta es para
// el PANEL: le muestra al comercio, con su sesión de usuario, exactamente qué
// datos recibe su asistente. Sirve para que el dueño entienda por qué el
// asistente contestó lo que contestó, sin tener que abrir n8n.
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

// ---------------------------------------------------------------------------
// RECLAMOS. El comercio los crea escribiendo Firestore (las reglas validan el
// esquema); NovuChat los mueve de estado por acá, porque el documento es
// inmutable para los clientes. Ver `reclamos.ts` para el envío del correo.
// ---------------------------------------------------------------------------
const ESTADOS_RECLAMO = new Set(['nuevo', 'en_curso', 'resuelto']);

export const moverReclamo = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  const reclamoId = texto(datos['reclamoId'], 128);
  const estado = texto(datos['estado'], 20);
  if (!ID_TENANT.test(tenantId) || !reclamoId) {
    throw new HttpsError('invalid-argument', 'Identificador inválido.');
  }
  if (!ESTADOS_RECLAMO.has(estado)) throw new HttpsError('invalid-argument', 'Estado inválido.');

  await db().doc(`tenants/${tenantId}/reclamos/${reclamoId}`).update({
    estado, movidoPor: uid, movidoEn: Timestamp.now(),
  });
  await auditar(tenantId, 'mover_reclamo', uid, { reclamoId, estado });
  return { ok: true };
});

// ---------------------------------------------------------------------------
// CONSTANCIA DE LOS CAMBIOS DE CONFIGURACIÓN
//
// La configuración la escribe el panel DIRECTAMENTE en Firestore —las reglas
// validan el esquema—, así que no hay ninguna Function por la que pase. Sin un
// disparador, el cambio que hace que el asistente empiece a decir otra cosa no
// quedaría registrado en ninguna parte.
//
// Importa porque el panel es la fuente de verdad: cuando alguien pregunte «¿por
// qué el asistente dijo eso el martes?», la respuesta está en saber qué decía la
// configuración el martes. Acá queda el CUÁNDO y el QUÉ CAMBIÓ (los nombres de
// los campos), no los valores: los valores de un campo como `direccion` o
// `instruccionesExtra` son texto del comercio y la bitácora no guarda texto.
// ---------------------------------------------------------------------------
export const registrarCambioConfig = onDocumentWritten(
  { document: 'tenants/{tenantId}/config/negocio', region: REGION, maxInstances: 5 },
  async (evento) => {
    const antes = (evento.data?.before.data() ?? {}) as Record<string, unknown>;
    const despues = (evento.data?.after.data() ?? {}) as Record<string, unknown>;
    if (!evento.data?.after.exists) return;

    const cambiados = [...new Set([...Object.keys(antes), ...Object.keys(despues)])]
      .filter((k) => k !== 'actualizadoEn' && k !== 'actualizadoPor')
      .filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))
      .sort();
    if (cambiados.length === 0) return;

    await registrar(evento.params.tenantId, {
      tipo: 'config_publicada',
      resultado: 'ok',
      canal: 'panel',
      // Solo los NOMBRES de los campos, recortados al tope de `detalle`.
      detalle: cambiados.join(','),
    });
  },
);
