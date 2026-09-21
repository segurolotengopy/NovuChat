import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { REGION } from './region.js';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { asignarRol, type Rol } from './claims.js';

initializeApp();

// CUENTA PROPIA, NO LA DE CÓMPUTO POR DEFECTO (2026-09-13). La de cómputo tiene
// rol Editor: quien lograra ejecutar código en una Function tendría casi todo
// el proyecto. `sa-functions` tiene solo lo que las Functions usan —Firestore,
// Auth (getUserByEmail, setCustomUserClaims, revokeRefreshTokens), lectura de
// sus secretos, los disparadores de Firestore y logs— y NO puede cambiar
// permisos, redesplegar ni hacerse pasar por otra cuenta; verificado con Policy
// Troubleshooter. Permisos y procedimiento en .github/DESPLIEGUE-FIREBASE.md,
// «Estado real». El correo va escrito: los de cuenta de servicio están
// exceptuados de la convención de repositorio público.
// Un secreto nuevo necesita `secretAccessor` para ESTA cuenta, uno por uno
// (ver `firma.ts`, «CUANDO SE ACABEN LOS VEINTE»).
setGlobalOptions({
  region: REGION,
  maxInstances: 10,
  serviceAccount: 'sa-functions@novuchat-demo.iam.gserviceaccount.com',
});

export { ingesta, configuracionFlujo } from './ingesta.js';
export { registrarCierre } from './cierres.js';
export { registrarQrDeCobro, imagenDeCobro } from './cobro.js';
// SEÑA POR QR EN LAS RESERVAS (bloque 2). El cotejo del comprobante lo hace el
// servidor —el flujo manda lo que leyó el modelo y recibe `cuadra`,
// `no_cuadra` o `ilegible`— y la retención vencida se anota sin mandarle nada
// al paciente. El porqué de cada decisión está en `sena.ts`.
export { cotejarComprobante, senaVencida } from './sena.js';
// Las coordenadas del pin salen del enlace de Maps que pega el comercio: nadie
// carga latitud y longitud a mano (19/09/2026).
export { ubicacionDeEnlace } from './mapa.js';
// Recordatorio de solicitud pendiente (bloque 4, `Analisis/31` §4): el
// barrido de la hora pregunta a quién le toca y marca ANTES de enviar.
export { seguimientosPendientes, seguimientoEnviado } from './seguimientos.js';
// CATÁLOGO WEB PROPIO. Tres endpoints públicos y una función de configuración;
// el porqué de cada uno está en `catalogoWeb.ts`. Se exportan desde acá, como
// todo lo demás, para que exista un solo inventario de lo que se despliega.
export {
  enlaceCatalogo, catalogoPublico, checkoutCatalogo, fijarWebhookCarrito,
  vistaPreviaCatalogo, fotoDeCatalogo,
} from './catalogoWeb.js';

import { registrar } from './ingesta.js';
import { umbralValido, umbralesDeAtencion } from './atencion.js';
import {
  CATALOGO_PLANES, PLANES_ASIGNABLES, cuentaInicial, esIdPlan, limitesDe, periodoDe, type IdPlan,
} from './planes.js';
// PREPAGO (bloque A-0, `DISENO.md` §4undecies): la modalidad de la cuenta y los
// campos derivados de la situación de pago, que se recalculan y nunca se
// escriben a mano; y la bandera del modo observación (`fijarCortePrepago`).
import {
  MODALIDADES, PRUEBA, camposDerivados, consumidasDe, esModalidad, esPeriodo, estadoDeServicio,
  mesBolivia, modalidadDe, type CuentaCruda,
} from './prepago.js';
// COBRANZA DEL PREPAGO: el barrido de la hora del número de NovuChat pregunta a
// qué comercios les toca un recordatorio y marca ANTES de enviar (molde de
// `seguimientos.ts`). El porqué en `cobranza.ts`.
export { recordatoriosPrepago, recordatorioPrepagoEnviado } from './cobranza.js';
import { documentoDeVertical } from './prompt.js';
export { notificarReclamo } from './reclamos.js';
// COMPROBACIÓN DE LAS FOTOS DEL CATÁLOGO. Un disparador que se ocupa de las
// altas de a una y de las importaciones de doscientas por igual, y una función
// para reintentar cuando la primera vez falló por algo pasajero. El porqué de
// que avise en vez de bloquear está en `imagenCatalogo.ts`.
export { comprobarImagenDelCatalogo, recomprobarImagen } from './imagenCatalogo.js';
// MINI INVENTARIO. El descuento por venta lo hace el checkout; acá van los dos
// movimientos que pide la consola. El comercio NO escribe `stock` a mano: si
// pudiera, el saldo y su historial discreparían y el reporte dejaría de servir.
export { ajustarStock, dejarDeControlarStock } from './inventario.js';
// FLUJO DE CAPTACIÓN. Comprueba, a pedido de la consola, que el archivo de
// planes que el asistente manda por WhatsApp se pueda mandar: responde, es del
// tipo declarado y cabe en los límites de Meta. El porqué en `captacion.ts`.
export { comprobarArchivoPlanes } from './captacion.js';
// COMPORTAMIENTO GENERAL DEL ASISTENTE, VERIFICADO ANTES DE APLICARSE (reglas de
// Andres del 17/09/2026). Lo propuesto (`instruccionesExtra`) pasa por dos capas
// del servidor y recién entonces se copia a `instruccionesVigentes`, que es lo
// único que lee el flujo. El contrato y el porqué en `comportamiento.ts`.
export { verificarComportamiento } from './verificarComportamiento.js';

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

// VÍNCULO ROL ↔ PROVEEDOR, igual que `esPropietario()` en firestore.rules (T-19):
// el claim de propietario solo vale con una sesión de Google. Sin esto, un `nc.p`
// puesto por error en una cuenta de contraseña quedaba inerte en las reglas pero
// ACTIVO en las Functions, que cambian planes y límites (revisión de seguridad
// del 15/09/2026, MEDIUM preexistente).
const exigirPropietario = (p: CallableRequest): string => {
  const uid = exigirAutenticado(p);
  const proveedor = (p.auth?.token?.['firebase'] as { sign_in_provider?: unknown } | undefined)
    ?.sign_in_provider;
  if (!claims(p).p || proveedor !== 'google.com') {
    throw new HttpsError('permission-denied', 'Solo NovuChat.');
  }
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
const VERTICALES = new Set(['agendamiento', 'venta', 'onboarding']);
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
  // FLUJOS: una lista, no un valor. Un negocio puede tener reservas Y pedidos.
  // `vertical` queda como el flujo principal (el primero) y como respaldo para
  // todo lo que todavía lee el valor único. Ver DISENO.md §4sexies.
  const flujosPedidos = Array.isArray(datos['flujos'])
    ? (datos['flujos'] as unknown[]).map((f) => texto(f, 30)).filter((f) => VERTICALES.has(f))
    : [];
  const verticalPedido = texto(datos['vertical'], 30);
  const flujos = flujosPedidos.length > 0
    ? [...new Set(flujosPedidos)]
    : [VERTICALES.has(verticalPedido) ? verticalPedido : 'agendamiento'];
  const vertical = flujos[0] as string;
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

  // El plan inicial es el más chico, con su copia de límites (`cuentaInicial`,
  // planes.ts). Antes se escribía `plan: 'basico'`, que no es del catálogo.
  const cuenta = cuentaInicial();
  const lote = db().batch();
  lote.create(db().doc(`tenants/${tenantId}/cuenta/estado`), {
    ...cuenta, actualizadoEn: Timestamp.now(),
  });
  // El contador del catálogo nace en cero: sin él las reglas no dejan dar de
  // alta ni de baja un producto. Exactamente estos tres campos.
  lote.create(db().doc(`tenants/${tenantId}/contadores/catalogo`), {
    items: 0, ultimoItem: '', actualizadoEn: Timestamp.now(),
  });
  lote.create(ref, {
    nombre, estado: 'activo', plan: cuenta.plan, vertical, flujos,
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
  // El documento de configuración de CADA flujo nace acá, vacío. Las reglas
  // no dejan que el navegador lo cree (`allow create: if false`), así que si
  // el alta no lo crea, la pestaña del flujo no puede guardar nunca. Faltaba.
  for (const flujo of flujos) {
    const documento = documentoDeVertical(flujo);
    if (documento) {
      lote.create(db().doc(`tenants/${tenantId}/config/${documento}`), {
        actualizadoPor: uid, actualizadoEn: Timestamp.now(),
      });
    }
  }
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

  // LA RUTA TAMBIÉN. Faltaba, y era un agujero de facturación: `suspenderTenant`
  // y `reactivarTenant` propagaban el estado a /rutasWhatsApp y la baja no, así
  // que un comercio dado de baja conservaba su ruta diciendo `activo`.
  //
  // Importa porque `registrarCierre` decide con `ruta.estado`: un comercio ya
  // dado de baja podía seguir acumulando CIERRES, que es la unidad que se
  // factura. Cobrarle a alguien que se fue es peor que cualquier error de
  // cálculo.
  //
  // Va ANTES de quitar los roles: si algo fallara entre las dos operaciones,
  // prefiero que el corte de servicio ya esté hecho y queden roles por limpiar,
  // y no al revés.
  await marcarRutasDelTenant(tenantId, 'dado_de_baja');

  const miembros = await db().collection(`tenants/${tenantId}/miembros`).get();
  for (const m of miembros.docs) {
    await asignarRol(m.id, tenantId, null, { revocarSesiones: true });
  }
  await auditar(tenantId, 'baja_tenant', uid, { miembros: miembros.size, rutasCortadas: true });
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

    // Asignar un número con un flujo SUMA ese flujo al negocio; no reemplaza
    // los que ya tenía. Antes se sobreescribía `vertical`, y un negocio con
    // reservas y pedidos cambiaba de consola cada vez que se le asignaba un
    // número. Y el documento de configuración del flujo nuevo se crea si no
    // estaba: el navegador no puede crearlo. (Lecturas antes que escrituras:
    // es lo que exige la transacción.)
    const documento = documentoDeVertical(flujo);
    const refConfig = documento ? db().doc(`tenants/${tenantId}/config/${documento}`) : null;
    const config = refConfig ? await tx.get(refConfig) : null;

    tx.set(ref, {
      tenantId, flujo, wabaId,
      estado: tenant.get('estado') ?? 'activo',
      asignadoEn: Timestamp.now(), asignadoPor: uid,
    });
    tx.update(tenant.ref, {
      waPhoneNumberId: phoneNumberId, waWabaId: wabaId,
      vertical: tenant.get('vertical') ?? flujo,
      flujos: FieldValue.arrayUnion(flujo),
    });
    if (refConfig && config && !config.exists) {
      tx.set(refConfig, { actualizadoPor: uid, actualizadoEn: Timestamp.now() });
    }
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
//
// ESCRITURA PARCIAL (15/09/2026, `Analisis/29` §2.4). Antes escribía
// `plan: 'basico'`, `montoMensual: 0`, `moneda: 'BOB'` y `motivoVisible: ''` en
// CADA llamada, vinieran o no, y exigía `estadoPago` siempre: una llamada para
// ajustar solo los umbrales le devolvía el plan a 'basico' a un comercio real y
// le dejaba la mensualidad en cero. Ahora cada campo se toca SOLO si viene en
// la petición, y lo que viene mal se RECHAZA en vez de cambiarse por un valor
// por defecto: el valor por defecto silencioso es exactamente cómo se pisaba
// el plan.
//
// EL PLAN ES CERRADO: tiene que ser un identificador de `planes.ts`. Al
// asignarlo se escribe en la cuenta una COPIA de sus límites (`limites`) y la
// versión del catálogo (`catalogoPlanes`), que es lo que leen quienes hacen
// cumplir un límite. `tenants/{t}.plan` es un ESPEJO para pintar la lista: se
// escribe acá, en la misma transacción, y ninguna regla ni ningún límite lo lee.
// El cambio de plan queda en la auditoría con el antes y el después.
// ---------------------------------------------------------------------------
const ESTADOS_PAGO = new Set(['al_dia', 'pendiente', 'vencido']);

export const actualizarEstadoCuenta = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = (peticion.data ?? {}) as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');

  const viene = (clave: string) => Object.prototype.hasOwnProperty.call(datos, clave);
  const cambios: Record<string, unknown> = {};

  if (viene('estadoPago')) {
    const estadoPago = datos['estadoPago'];
    if (typeof estadoPago !== 'string' || !ESTADOS_PAGO.has(estadoPago)) {
      throw new HttpsError('invalid-argument', 'Estado de pago inválido.');
    }
    cambios['estadoPago'] = estadoPago;
  }
  if (viene('montoMensual')) {
    const monto = datos['montoMensual'];
    if (typeof monto !== 'number' || !Number.isFinite(monto) || monto < 0) {
      throw new HttpsError('invalid-argument', 'Monto mensual inválido.');
    }
    cambios['montoMensual'] = monto;
  }
  if (viene('moneda')) {
    const moneda = datos['moneda'];
    if (moneda !== 'USD' && moneda !== 'BOB') {
      throw new HttpsError('invalid-argument', 'Moneda inválida: USD o BOB.');
    }
    cambios['moneda'] = moneda;
  }
  if (viene('proximoVencimiento')) {
    const vence = datos['proximoVencimiento'];
    if (vence === null) cambios['proximoVencimiento'] = FieldValue.delete();
    else if (typeof vence === 'number' && Number.isFinite(vence)) {
      cambios['proximoVencimiento'] = Timestamp.fromMillis(vence);
    } else throw new HttpsError('invalid-argument', 'Vencimiento inválido.');
  }
  if (viene('motivoVisible')) {
    if (typeof datos['motivoVisible'] !== 'string') {
      throw new HttpsError('invalid-argument', 'Motivo visible inválido.');
    }
    cambios['motivoVisible'] = texto(datos['motivoVisible'], 300);
  }

  // UMBRALES DE ATENCIÓN POR EMPRESA (`Analisis/27`): a cuántas respuestas en
  // la ventana de 24 h el asistente pasa al operador y a cuántas deja de
  // responder. Son OPCIONALES: ausentes, no se tocan; `null`, se borran y
  // vuelven a regir los de respaldo; presentes, se aceptan solo si forman una
  // pareja coherente (`umbralesDeAtencion`), igual que los lee el servidor. Lo
  // que la ingesta no aceptaría, no se guarda.
  const umbrales: Record<string, unknown> = {};
  for (const clave of ['umbralOperador', 'umbralBloqueo'] as const) {
    if (!viene(clave)) continue;
    const v = datos[clave];
    if (v === null) { umbrales[clave] = FieldValue.delete(); continue; }
    if (!umbralValido(v)) throw new HttpsError('invalid-argument', `${clave} inválido.`);
    umbrales[clave] = v;
  }

  let plan: IdPlan | null = null;
  if (viene('plan')) {
    const pedido = datos['plan'];
    if (!esIdPlan(pedido)) {
      throw new HttpsError('invalid-argument',
        `Plan desconocido. Tiene que ser uno del catálogo: ${Object.keys(PLANES_ASIGNABLES).join(', ')}.`);
    }
    plan = pedido;
  }

  // EL PREPAGO (bloque A-0, `DISENO.md` §4undecies.2). La MODALIDAD es
  // cerrada: demostración, prueba o prepago. `periodoPrueba` (`aaaa-mm`) es
  // opcional: al pasar a prueba sin él, es el mes en curso de Bolivia; `null`
  // lo borra. `corteActivo` es un booleano (enciende el corte en ESTE tenant
  // antes que en toda la plataforma; `null` lo borra) y no cambia ningún
  // derivado. Cualquier otra cosa se RECHAZA, como todo lo demás de acá.
  //
  // `periodoPagado` NO se acepta: solo lo escribe un pago (A-1) o la migración
  // (`scripts/migrar-prepago.mjs`, uno por uno, con el OK de Andres).
  const prepago: Record<string, unknown> = {};
  if (viene('modalidad')) {
    const m = datos['modalidad'];
    if (!esModalidad(m)) {
      throw new HttpsError('invalid-argument', `Modalidad desconocida. Una de: ${MODALIDADES.join(', ')}.`);
    }
    prepago['modalidad'] = m;
  }
  if (viene('periodoPrueba')) {
    const p = datos['periodoPrueba'];
    if (p === null) prepago['periodoPrueba'] = FieldValue.delete();
    else if (esPeriodo(p)) prepago['periodoPrueba'] = p;
    else throw new HttpsError('invalid-argument', 'periodoPrueba inválido: aaaa-mm.');
  }
  if (viene('corteActivo')) {
    const c = datos['corteActivo'];
    if (c === null) prepago['corteActivo'] = FieldValue.delete();
    else if (typeof c === 'boolean') prepago['corteActivo'] = c;
    else throw new HttpsError('invalid-argument', 'corteActivo tiene que ser verdadero o falso.');
  }
  // Los campos que ENTRAN en `estadoDeServicio`: si alguno cambia, los
  // derivados se recalculan en la misma transacción (`recalcular`, abajo, con
  // la cuenta ya leída). Los demás (umbrales, motivo, bandera) no los mueven,
  // y no se toca lo que no hace falta.
  const leerMetricas = plan !== null || viene('modalidad') || viene('periodoPrueba');

  const otros = [...Object.keys(cambios), ...Object.keys(umbrales), ...Object.keys(prepago)].sort();
  if (otros.length === 0 && plan === null) {
    throw new HttpsError('invalid-argument', 'Nada que actualizar.');
  }

  const refCuenta = db().doc(`tenants/${tenantId}/cuenta/estado`);
  const refFicha = db().doc(`tenants/${tenantId}`);
  const refAuditoria = db().collection(`tenants/${tenantId}/auditoria`);
  const ahoraMs = Date.now();
  const refMetricas = db().doc(`tenants/${tenantId}/metricas/${periodoDe(ahoraMs)}`);

  // UNA TRANSACCIÓN: la cuenta, el espejo de la ficha y la auditoría se
  // escriben juntos o no se escribe nada. Lecturas antes que escrituras.
  const limites = await db().runTransaction(async (tx) => {
    const [cuentaDoc, ficha, metricasDoc] = await Promise.all([
      tx.get(refCuenta), tx.get(refFicha),
      leerMetricas ? tx.get(refMetricas) : Promise.resolve(null),
    ]);
    if (!ficha.exists) throw new HttpsError('not-found', 'No existe ese comercio.');
    const actual = cuentaDoc.data() ?? {};
    const ahora = Timestamp.now();

    if (Object.keys(umbrales).length > 0) {
      const combinados: Record<string, unknown> = { ...actual };
      for (const [k, v] of Object.entries(umbrales)) {
        if (v instanceof FieldValue) delete combinados[k]; else combinados[k] = v;
      }
      const resultado = umbralesDeAtencion(combinados);
      const cargados = ['umbralOperador', 'umbralBloqueo'].some((k) => combinados[k] !== undefined);
      if (cargados && resultado.origen !== 'cuenta') {
        throw new HttpsError('invalid-argument',
          'El umbral de bloqueo tiene que ser mayor que el de operador.');
      }
    }

    const escritura: Record<string, unknown> = { ...cambios, ...umbrales, ...prepago, actualizadoEn: ahora };
    const nuevos = plan ? limitesDe(plan) : null;
    if (plan && nuevos) {
      escritura['plan'] = plan;
      escritura['limites'] = nuevos;
      escritura['catalogoPlanes'] = CATALOGO_PLANES;
      tx.update(refFicha, { plan });
      tx.create(refAuditoria.doc(), {
        accion: 'cambiar_plan', uid, en: ahora,
        planAntes: actual['plan'] ?? null, planDespues: plan,
        limitesAntes: actual['limites'] ?? null, limitesDespues: nuevos,
        catalogoPlanes: CATALOGO_PLANES,
      });
    }

    // Al pasar a PRUEBA sin período, la prueba es el mes en curso de Bolivia,
    // con su bolsa de 20 conversaciones; si ya tenía una, no se reinicia.
    if (prepago['modalidad'] === 'prueba' && !viene('periodoPrueba') && !esPeriodo(actual['periodoPrueba'])) {
      escritura['periodoPrueba'] = mesBolivia(ahoraMs);
      escritura['bolsaPrueba'] = PRUEBA.conversaciones;
    }

    // LOS DERIVADOS se recalculan con la cuenta COMO VA A QUEDAR: lo que ya
    // había, más lo que trae esta llamada. Sobre eso decide `estadoDeServicio`
    // (`prepago.ts`, puro), y lo que decide se escribe, no lo que mande nadie.
    // Se recalculan cuando cambia la modalidad o la prueba, y cuando cambia el
    // plan de una cuenta CON modalidad; un cambio de plan en una cuenta sin
    // modalidad (los comercios de hoy, y los demos) no toca lo que había: el
    // prepago no la gobierna todavía.
    const combinada: Record<string, unknown> = { ...actual };
    for (const [k, v] of Object.entries(escritura)) {
      if (v instanceof FieldValue) delete combinada[k]; else combinada[k] = v;
    }
    // Borrar `periodoPrueba` de una cuenta que queda en PRUEBA la dejaría
    // incoherente (`estadoDeServicio` la atendería sin límite): se rechaza.
    if (viene('periodoPrueba') && datos['periodoPrueba'] === null && combinada['modalidad'] === 'prueba') {
      throw new HttpsError('invalid-argument', 'Una cuenta en prueba necesita su periodoPrueba.');
    }
    const recalcular = viene('modalidad') || viene('periodoPrueba')
      || (plan !== null && modalidadDe(combinada as CuentaCruda) !== 'demostracion');
    if (recalcular) {
      const servicio = estadoDeServicio(combinada as CuentaCruda, consumidasDe(metricasDoc?.data()), ahoraMs);
      const d = camposDerivados(servicio, combinada as CuentaCruda);
      escritura['estadoPago'] = d.estadoPago;
      escritura['montoMensual'] = d.montoMensual;
      escritura['moneda'] = d.moneda;
      escritura['proximoVencimiento'] = d.proximoVencimientoMs === null
        ? FieldValue.delete() : Timestamp.fromMillis(d.proximoVencimientoMs);
    }

    // `update` y no `set` con `merge`: reemplaza `limites` ENTERO en vez de
    // mezclarlo con una copia vieja. Si la cuenta no existía, se crea sin los
    // borrados (no hay nada que borrar).
    if (cuentaDoc.exists) tx.update(refCuenta, escritura);
    else {
      tx.set(refCuenta, Object.fromEntries(
        Object.entries(escritura).filter(([, v]) => !(v instanceof FieldValue))));
    }

    if (otros.length > 0) {
      // El registro lleva QUÉ campos cambiaron y el valor de los que no son
      // texto libre. `motivoVisible` va solo por nombre: es texto.
      const valor = (v: unknown) => v instanceof FieldValue ? null
        : v instanceof Timestamp ? v.toMillis() : v;
      tx.create(refAuditoria.doc(), {
        accion: 'estado_cuenta', uid, en: ahora, campos: otros,
        valores: Object.fromEntries(otros
          .filter((k) => k !== 'motivoVisible')
          .map((k) => [k, valor(k in cambios ? cambios[k] : k in umbrales ? umbrales[k] : prepago[k])])),
      });
    }
    return nuevos;
  });

  return { ok: true, ...(plan && limites ? { plan, limites } : {}) };
});

// ---------------------------------------------------------------------------
// LA BANDERA DEL MODO OBSERVACIÓN DEL PREPAGO (`DISENO.md` §4undecies.4).
//
// `plataforma/prepago.corteActivo` es la compuerta global: A-0 entra a `main`
// con ella apagada y así se queda hasta que Andres decida, «después del demo y
// con un pago confirmado de punta a punta». `cuenta/estado.corteActivo` es la
// de UN tenant, para el ensayo de extremo a extremo: se enciende en uno solo,
// se observa un ciclo completo, y recién después la global. Apagada, la
// ingesta calcula el corte, lo anota con `aplicado: false` y atiende igual;
// encendida, `configuracionFlujo` responde 409 y la ingesta no cuenta nada.
//
// Solo el propietario, y queda quién y cuándo: cada cambio deja una entrada
// en `plataforma/prepago/historial` (y, por tenant, en su auditoría). Ningún
// script con `--aplicar` la toca: es una decisión, no una operación.
// ---------------------------------------------------------------------------
export const fijarCortePrepago = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = (peticion.data ?? {}) as Record<string, unknown>;
  const corteActivo = datos['corteActivo'];
  if (typeof corteActivo !== 'boolean') {
    throw new HttpsError('invalid-argument', 'corteActivo tiene que ser verdadero o falso.');
  }
  // El motivo es obligatorio y tiene que decir algo: es lo que queda en el
  // historial junto a quién y cuándo, y encender el corte es una decisión.
  const motivo = texto(datos['motivo'], 300);
  if (motivo.length < 10) {
    throw new HttpsError('invalid-argument', 'El motivo es obligatorio (al menos 10 caracteres).');
  }
  const tenantId = texto(datos['tenantId'], 60);
  if (tenantId !== '' && !ID_TENANT.test(tenantId)) {
    throw new HttpsError('invalid-argument', 'Identificador inválido.');
  }
  const ahora = Timestamp.now();
  const refPlataforma = db().doc('plataforma/prepago');
  const refHistorial = refPlataforma.collection('historial');

  await db().runTransaction(async (tx) => {
    if (tenantId === '') {
      tx.set(refPlataforma, { corteActivo, actualizadoEn: ahora, actualizadoPor: uid, motivo }, { merge: true });
      tx.create(refHistorial.doc(), { corteActivo, uid, en: ahora, motivo });
      return;
    }
    const ficha = await tx.get(db().doc(`tenants/${tenantId}`));
    if (!ficha.exists) throw new HttpsError('not-found', 'No existe ese comercio.');
    tx.set(db().doc(`tenants/${tenantId}/cuenta/estado`), { corteActivo, actualizadoEn: ahora }, { merge: true });
    tx.create(db().collection(`tenants/${tenantId}/auditoria`).doc(), {
      accion: 'corte_prepago', uid, en: ahora, corteActivo, motivo,
    });
    tx.create(refHistorial.doc(), { corteActivo, uid, en: ahora, motivo, tenantId });
  });

  return { ok: true, corteActivo, ...(tenantId ? { tenantId } : {}) };
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

export { importarCatalogo } from './limiteCatalogo.js'; // límite de productos por plan: ver limiteCatalogo.ts

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

    // Lo vigente y su revisión los escribe SOLO el servidor (la Function
    // `verificarComportamiento` o un script de NovuChat): las reglas se lo
    // niegan al navegador. Si eso es lo único que cambió, el canal es
    // `sistema`, no el panel. Ver `comportamiento.ts`.
    const soloDelServidor = cambiados.every((k) => k === 'instruccionesVigentes' || k === 'instruccionesRevision');

    await registrar(evento.params.tenantId, {
      tipo: 'config_publicada',
      resultado: 'ok',
      canal: soloDelServidor ? 'sistema' : 'panel',
      // Solo los NOMBRES de los campos, recortados al tope de `detalle`.
      detalle: cambiados.join(','),
    });
  },
);
