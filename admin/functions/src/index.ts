// PRIMERO, antes que cualquier otro módulo propio: fija las opciones globales.
import './opcionesGlobales.js';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { REGION } from './region.js';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { asignarRol } from './claims.js';
import { claimsDe as claims, exigirAdminDe, exigirPropietario, exigirSesionReciente } from './autorizacion.js';
import { derivadosGobernados } from './pagos.js';

initializeApp();

// Las opciones globales (región, instancias, cuenta sa-functions) se fijan en
// opcionesGlobales.ts, que es el PRIMER import de este archivo: ver ahí por qué.

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
  CATALOGO_PLANES, CLAVES_POR_CONTRATO, MAXIMO_PRECIO_POR_CONTRATO_USD, PLANES, RANGO_POR_CONTRATO, copiaDeLimites,
  cuentaInicial, esPlanVendible, mismoMarcador, periodoDe, porContratoDe, precioMensualDe, precioPorContratoDe,
  precioPorContratoValido, valorPorContratoValido, type ClavePorContrato, type IdPlanVendible,
} from './planes.js';
// LOS TRES EJES DE LA CUENTA (F1, `Analisis/41` §4). El alta escribe el modelo
// por defecto y `asignarNumero` la titularidad del número; cambiarlos después
// es `asignarEjes`, y contar los cambios operados es `registrarCambioOperado`,
// los dos en `central/`. El plan, la modalidad y los umbrales siguen en
// `actualizarEstadoCuenta`, más abajo.
import { MODELO_POR_DEFECTO, TITULARIDADES, TITULARIDAD_POR_DEFECTO, esTitularidad } from './central/ejes.js';
export { registrarCambioOperado } from './central/cambiosOperados.js';
export { asignarEjes, ejesDeCuenta } from './central/ejesDeCuenta.js';
// PREPAGO (bloque A-0, `DISENO.md` §4undecies): la modalidad de la cuenta y los
// campos derivados de la situación de pago, que se recalculan y nunca se
// escriben a mano; y la bandera del modo observación (`fijarCortePrepago`).
import {
  BOLSA_PRUEBA_MAXIMA, MODALIDADES, PruebaInvalida, bolsaPruebaValida, camposDerivados, consumidasDe, esModalidad,
  esPeriodo, estadoDeServicio, montoFueraDeContrato, pruebaActual, pruebaNueva,
  type CuentaCruda, type PedidoDePrueba, type PruebaNueva,
} from './prepago.js';
// COBRANZA DEL PREPAGO: el barrido de la hora del número de NovuChat pregunta a
// qué comercios les toca un recordatorio y marca ANTES de enviar (molde de
// `seguimientos.ts`). El porqué en `cobranza.ts`.
export { recordatoriosPrepago, recordatorioPrepagoEnviado } from './cobranza.js';
// PAGOS DEL PREPAGO (bloque A-1, `DISENO.md` §4undecies.1): la carga manual del
// propietario con evidencia y auditoría, la anulación del pendiente, la
// consulta al abrir la pantalla y los teléfonos que pueden pagar. Lo que suma
// meses vive en `pagos.ts` y es una sola puerta; el porqué está ahí.
// Pagos del prepago (A-1) con el cobrador (A-2) enchufado: ver pagosConCobrador.ts.
export { registrarPagoManual, anularPagoPendiente, consultarPagoPendiente } from './pagosConCobrador.js';
export { fijarTelefonosPago } from './pagos.js';
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
// CAMPAÑAS DE META (Andres, 24/09/2026). El comercio las carga en la consola
// (`config/campanas.lista`); este disparador las verifica —fechas, duplicados,
// palabras de emergencia, inyección y, con el modelo, que sean de ESTE negocio—
// y copia las aprobadas a `vigentes`, lo único que viaja al flujo.
export { verificarCampanas } from './verificarCampanas.js';
// PREPAGO: EL CLIENTE DEL COBRADOR (bloque A-2, 20/09/2026). NovuChat le cobra
// al comercio por QR a través del proyecto de cobros; el aviso del cobrador
// solo dispara la consulta autenticada, que es la única que confirma. Dos
// secretos nuevos (`COBRADOR_TOKEN`, `COBRADOR_AVISO_SECRETO`) y el Scheduler
// del barrido esperan la compuerta del demo (.github/DESPLIEGUE-FIREBASE.md).
// El sondeo de cada 5 minutos acredita rápido mientras C no mande aviso.
export { crearCobroPrepago, avisoCobrador, sondeoCobros, barridoCobros, imagenDePago } from './cobroPrepago.js';
export { tipoCambioBcb } from './tipoCambioBcb.js';

const db = () => getFirestore();

// --- Ayudantes de autorización del lado servidor ----------------------------
// Las Cloud Functions NO están sujetas a firestore.rules: usan el SDK Admin y se
// las saltan. Por eso cada función vuelve a comprobar el permiso a mano, desde
// los claims del token que Firebase ya verificó. Confiar en que "el panel solo
// muestra el botón al admin" sería confiar en el navegador.
//
// Viven en `autorizacion.ts` desde el 20/09 (bloque A-1), para que `pagos.ts` y
// lo que venga apliquen EXACTAMENTE el mismo vínculo rol ↔ proveedor que las
// reglas (T-19): el propietario solo con Google; el administrador solo con
// contraseña y correo verificado. Antes `exigirAdminDe` miraba solo el claim
// (`Analisis/29` §4.1).

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
    // El modelo de IA es una decisión de NovuChat por tenant (`central/ejes.ts`):
    // nace con el que corre en todos los flujos y se cambia con
    // `asignarEjes`, nunca desde el navegador.
    modelo: MODELO_POR_DEFECTO,
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
  //
  // SIN `estadoPago` (20/09, `DISENO.md` §4undecies.2): suspender corta el
  // SERVICIO y no afirma nada sobre el pago. `estadoPago` se deriva de los
  // pagos (`camposDerivados`), y escribir `vencido` acá pisaba esa verdad.
  await db().doc(`tenants/${tenantId}/cuenta/estado`).set({
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
  // Tampoco `estadoPago: 'al_dia'`: no se afirma «al día» sin un pago que lo
  // respalde. Reactivar devuelve el servicio; lo que se debe sigue derivándose.
  await db().doc(`tenants/${tenantId}/cuenta/estado`).set({
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
  // TITULARIDAD DEL CANAL (F1, `Analisis/41` §4): de quién es la WABA y quién
  // le paga a Meta este número. Opcional: sin ella, de NovuChat, que es el
  // lado seguro. Con ella, tiene que ser de la lista; cualquier otra cosa se
  // rechaza como todo lo demás. Se cambia después con `asignarEjes`.
  const titularidad = datos['titularidad'] === undefined ? TITULARIDAD_POR_DEFECTO : datos['titularidad'];

  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  if (!ID_NUMERO.test(phoneNumberId)) throw new HttpsError('invalid-argument', 'phone_number_id inválido.');
  if (!VERTICALES.has(flujo)) throw new HttpsError('invalid-argument', 'Flujo desconocido.');
  if (!esTitularidad(titularidad)) {
    throw new HttpsError('invalid-argument', `Titularidad desconocida. Una de: ${TITULARIDADES.join(', ')}.`);
  }

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
      tenantId, flujo, wabaId, titularidad,
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

  await auditar(tenantId, 'asignar_numero', uid, { phoneNumberId, wabaId, flujo, titularidad });
  return { ok: true, titularidad };
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
//
// LOS VALORES POR CONTRATO (`planes.ts`, `copiaDeLimites`). `cambiosIncluidos`
// fija por contrato los cambios operados incluidos al mes (entero de 0 a
// `MAXIMO_CAMBIOS_INCLUIDOS`) y, desde F1b, `conversaciones` las incluidas al
// mes (entero de 1 a `LIMITE_MAXIMO`): la MISMA validación con que se leen.
// `null` quita el valor y vuelve a regir el del plan. Un cambio de plan
// CONSERVA lo que va por contrato: antes reescribía la copia entera y un
// contrato volvía al número del plan sin que nadie lo decidiera. Cada
// fijación o retiro deja `limites_por_contrato` en la auditoría; lo
// conservado va en `cambiar_plan`.
//
// EL PRECIO Y LA PRUEBA POR CONTRATO (F1b). `precioPorContrato` (USD, con
// centavos, hasta `MAXIMO_PRECIO_POR_CONTRATO_USD`) es la mensualidad pactada
// y manda sobre la del plan en todo lo que cobra (`precioMensualDe`); `null`
// la quita. `periodoPrueba` fija o extiende el último mes de la prueba y
// `bolsaPrueba` sus conversaciones, solo con modalidad prueba (`pruebaNueva`).
// Todo con sesión reciente y con el antes y el después en la auditoría.
// ---------------------------------------------------------------------------
// LOS CAMPOS QUE SE DERIVAN DE LOS PAGOS (20/09, bloque A-1, `DISENO.md`
// §4undecies.2). Hasta el 20/09 esta callable los aceptaba escritos a mano;
// ahora los RECHAZA: `estadoPago`, `montoMensual`, `moneda` y
// `proximoVencimiento` los calcula `camposDerivados` a partir de la modalidad,
// el mes pagado y el plan, en cada llamada. Un «al día» que no sale de un pago
// no significa nada, y era lo que pisaba `suspenderTenant`.
const CAMPOS_DERIVADOS = ['estadoPago', 'montoMensual', 'moneda', 'proximoVencimiento'] as const;

export const actualizarEstadoCuenta = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = (peticion.data ?? {}) as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');

  const viene = (clave: string) => Object.prototype.hasOwnProperty.call(datos, clave);
  const cambios: Record<string, unknown> = {};

  for (const clave of CAMPOS_DERIVADOS) {
    if (viene(clave)) {
      throw new HttpsError('invalid-argument', `${clave} se deriva de los pagos: no se escribe a mano.`);
    }
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

  let plan: IdPlanVendible | null = null;
  if (viene('plan')) {
    const pedido = datos['plan'];
    if (!esPlanVendible(pedido)) {
      throw new HttpsError('invalid-argument',
        `Plan desconocido. Tiene que ser uno del catálogo: ${Object.keys(PLANES).join(', ')}.`);
    }
    plan = pedido;
  }
  // LOS VALORES POR CONTRATO DE LA COPIA (`CLAVES_POR_CONTRATO`: los cambios
  // incluidos y, desde F1b, las conversaciones). Cada uno con LA validación
  // con que se lee (`valorPorContratoValido`); `null` lo quita y vuelve a
  // regir el del plan.
  const valoresPorContrato: Partial<Record<ClavePorContrato, number | null>> = {};
  for (const clave of CLAVES_POR_CONTRATO) {
    if (!viene(clave)) continue;
    const v = datos[clave];
    if (v !== null && !valorPorContratoValido(clave, v)) {
      throw new HttpsError('invalid-argument',
        `${clave} tiene que ser ${RANGO_POR_CONTRATO[clave]}, o null para volver al del plan.`);
    }
    valoresPorContrato[clave] = v as number | null;
  }
  const pideCopiaPorContrato = Object.keys(valoresPorContrato).length > 0;
  // EL PRECIO POR CONTRATO (F1b): la mensualidad pactada, en USD, que manda
  // sobre la del plan (`precioMensualDe`, `planes.ts`); `null` la quita.
  let precioPorContrato: number | null | undefined;
  if (viene('precioPorContrato')) {
    const v = datos['precioPorContrato'];
    if (v !== null && !precioPorContratoValido(v)) {
      throw new HttpsError('invalid-argument',
        `precioPorContrato tiene que ser un monto en dólares mayor que 0 y de hasta ${MAXIMO_PRECIO_POR_CONTRATO_USD}, `
        + 'con dos decimales como mucho; o null para volver al precio del plan.');
    }
    precioPorContrato = v;
  }
  // EL MODELO DE IA y la TITULARIDAD del número NO van por acá: son
  // `asignarEjes` (`central/ejesDeCuenta.ts`), con la firma que usa la consola.

  // EL PREPAGO (bloque A-0, `DISENO.md` §4undecies.2). La MODALIDAD es
  // cerrada: demostración, prueba o prepago. `corteActivo` es un booleano
  // (enciende el corte en ESTE tenant antes que en toda la plataforma; `null`
  // lo borra) y no cambia ningún derivado. Cualquier otra cosa se RECHAZA,
  // como todo lo demás de acá.
  //
  // LA PRUEBA (F1b): `periodoPrueba` (`aaaa-mm`) es el ÚLTIMO mes de la prueba
  // —la fija o la extiende, nunca a un mes pasado—; `bolsaPrueba` (1 a
  // `BOLSA_PRUEBA_MAXIMA`), las conversaciones de prueba que quedan. Las dos
  // solo con modalidad prueba. Acá se valida la FORMA; lo que depende de la
  // cuenta (la modalidad que queda, el mes en curso, el primer mes) lo decide
  // `pruebaNueva` (`prepago.ts`) dentro de la transacción, la misma función
  // que usa `asignar-plan.mjs`. `null` en `periodoPrueba` la borra, solo si
  // la cuenta no queda en prueba.
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
  const pedidoPrueba: PedidoDePrueba = {};
  const camposPrueba: string[] = [];
  if (viene('periodoPrueba')) {
    const p = datos['periodoPrueba'];
    if (p !== null && !esPeriodo(p)) throw new HttpsError('invalid-argument', 'periodoPrueba inválido: aaaa-mm.');
    pedidoPrueba.periodoPrueba = p as string | null;
    camposPrueba.push('periodoPrueba');
  }
  if (viene('bolsaPrueba')) {
    const b = datos['bolsaPrueba'];
    if (!bolsaPruebaValida(b)) {
      throw new HttpsError('invalid-argument', `bolsaPrueba tiene que ser un entero de 1 a ${BOLSA_PRUEBA_MAXIMA}.`);
    }
    pedidoPrueba.bolsaPrueba = b;
    camposPrueba.push('bolsaPrueba');
  }
  if (viene('corteActivo')) {
    const c = datos['corteActivo'];
    if (c === null) prepago['corteActivo'] = FieldValue.delete();
    else if (typeof c === 'boolean') prepago['corteActivo'] = c;
    else throw new HttpsError('invalid-argument', 'corteActivo tiene que ser verdadero o falso.');
  }
  const otros = [...Object.keys(cambios), ...Object.keys(umbrales), ...Object.keys(prepago), ...camposPrueba].sort();
  if (otros.length === 0 && plan === null && !pideCopiaPorContrato && precioPorContrato === undefined) {
    throw new HttpsError('invalid-argument', 'Nada que actualizar.');
  }
  // SESIÓN RECIENTE PARA LO QUE MUEVE DINERO (revisión de seguridad de #212,
  // LOW 3 de las dos vueltas): cambiar el plan cambia la mensualidad; los
  // valores por contrato (cambios incluidos, conversaciones) son trabajo y
  // consumo que NovuChat regala o cobra; el precio por contrato ES la
  // mensualidad; y la modalidad, la prueba (su período y su bolsa) y el corte
  // deciden si se cobra y si se atiende. Como `registrarPagoManual`: un token
  // robado y usado desde otro lado no alcanza. Los umbrales y el motivo
  // visible no la piden. Se pide DESPUÉS de validar la forma, para que una
  // petición mal armada diga qué tiene mal. La consola responde con
  // `reauthenticateWithPopup` y repite.
  if (plan !== null || pideCopiaPorContrato || precioPorContrato !== undefined
      || Object.keys(prepago).length > 0 || camposPrueba.length > 0) {
    try {
      exigirSesionReciente(peticion, Date.now());
    } catch {
      throw new HttpsError('unauthenticated',
        'Por seguridad, vuelva a iniciar sesión para cambiar el plan, la modalidad, la prueba, el precio o los límites por contrato.');
    }
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
      tx.get(refCuenta), tx.get(refFicha), tx.get(refMetricas),
    ]);
    if (!ficha.exists) throw new HttpsError('not-found', 'No existe ese comercio.');
    const actual = cuentaDoc.data() ?? {};
    const ahora = Timestamp.now();

    // UN QR VIVO DE OTRO PLAN FRENA EL CAMBIO DE PLAN (revisión de seguridad
    // de #212, LOW 2): si el comercio tiene pendiente una mensualidad de otro
    // plan y se cambia el plan acá, al confirmarse el QR la cuenta quedaría
    // con dos verdades. Primero se anula el cobro pendiente (Pagar o
    // `anularPagoPendiente`), después se cambia el plan.
    //
    // Y UN QR VIVO FRENA EL CAMBIO DE PRECIO (F1b): si hay una mensualidad
    // pendiente y el precio nuevo la deja fuera de contrato
    // (`montoFueraDeContrato`, más abajo, con la cuenta como va a quedar), el
    // banco la cobraría a un precio que la cuenta ya no tiene. Se lee acá, con
    // las demás lecturas; se decide cuando la cuenta nueva esté armada.
    const pendienteId = actual['pagoPendienteId'];
    let pendienteVivo: Record<string, unknown> | null = null;
    if ((plan || precioPorContrato !== undefined) && typeof pendienteId === 'string' && /^[A-Za-z0-9_-]{22}$/.test(pendienteId)) {
      const pendiente = (await tx.get(db().doc(`tenants/${tenantId}/pagos/${pendienteId}`))).data();
      if (pendiente && pendiente['estado'] === 'pendiente' && pendiente['tipo'] === 'mensualidad') {
        if (plan && pendiente['plan'] !== plan) {
          throw new HttpsError('failed-precondition',
            'Hay un cobro pendiente de una mensualidad de otro plan: anule el cobro pendiente primero y después cambie el plan.');
        }
        pendienteVivo = pendiente;
      }
    }

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
    // Un valor o un precio por contrato sin cuenta ni plan dejaría un
    // `cuenta/estado` parcial, con una copia de una sola clave y sin plan:
    // primero el plan.
    if ((pideCopiaPorContrato || precioPorContrato !== undefined) && !plan && !cuentaDoc.exists) {
      throw new HttpsError('failed-precondition', 'El comercio no tiene cuenta: primero se le asigna un plan.');
    }
    const copia = plan || pideCopiaPorContrato
      ? copiaDeLimites(actual, { ...(plan ? { plan } : {}), ...valoresPorContrato })
      : null;
    const nuevos = copia ? copia.limites : null;
    if (copia) {
      escritura['limites'] = copia.limites;
      if (!mismoMarcador(actual, copia.porContrato)) {
        escritura['limitesPorContrato'] = copia.porContrato.length ? copia.porContrato : FieldValue.delete();
      }
    }
    if (plan && copia) {
      escritura['plan'] = plan;
      escritura['catalogoPlanes'] = CATALOGO_PLANES;
      tx.update(refFicha, { plan });
      tx.create(refAuditoria.doc(), {
        accion: 'cambiar_plan', uid, en: ahora,
        planAntes: actual['plan'] ?? null, planDespues: plan,
        limitesAntes: actual['limites'] ?? null, limitesDespues: copia.limites,
        catalogoPlanes: CATALOGO_PLANES,
        ...(Object.keys(copia.conservados).length ? { conservadosPorContrato: copia.conservados } : {}),
      });
    }
    // `limites_por_contrato` SOLO SI ALGO CAMBIA (el valor o su origen), una
    // por clave, con la misma condición que `asignar-plan.mjs`: repetir la
    // misma fijación no deja una auditoría que diga que se fijó (observación
    // de #212).
    const copiaAntes = actual['limites'] as Record<string, unknown> | undefined;
    const porContratoAntes = porContratoDe(actual);
    for (const clave of CLAVES_POR_CONTRATO) {
      const pedido = valoresPorContrato[clave];
      if (pedido === undefined || !copia) continue;
      const contratoAntes = porContratoAntes.includes(clave);
      if (contratoAntes === (pedido !== null) && copiaAntes?.[clave] === copia.limites[clave]) continue;
      tx.create(refAuditoria.doc(), {
        accion: 'limites_por_contrato', uid, en: ahora, clave,
        antes: { valor: copiaAntes?.[clave] ?? null, porContrato: contratoAntes },
        despues: { valor: copia.limites[clave], porContrato: pedido !== null },
        plan: plan ?? actual['plan'] ?? null, delPlan: copia.delPlan[clave],
      });
    }

    // EL PRECIO POR CONTRATO (F1b). Un campo propio, que ningún escritor del
    // plan toca: por eso un cambio de plan lo conserva sin hacer nada.
    // `precio_por_contrato` en la auditoría solo si cambia, con la mensualidad
    // que regía antes y la que rige después.
    const precioAntes = precioPorContratoDe(actual);
    if (precioPorContrato !== undefined && precioPorContrato !== precioAntes) {
      escritura['precioPorContrato'] = precioPorContrato === null ? FieldValue.delete() : precioPorContrato;
    } else if (precioPorContrato === null && actual['precioPorContrato'] !== undefined) {
      // Un valor roto (que no regía) se limpia igual al pedir el del plan.
      escritura['precioPorContrato'] = FieldValue.delete();
    }

    // LA PRUEBA (F1b): su último mes, su primer mes y su bolsa, decididos por
    // `pruebaNueva` con la modalidad que queda. Al pasar a prueba sin período,
    // la prueba es el mes en curso con la bolsa de lista, como siempre.
    const pideAlgoDePrueba = camposPrueba.length > 0 || prepago['modalidad'] !== undefined;
    let prueba: PruebaNueva = {};
    if (pideAlgoDePrueba) {
      try {
        prueba = pruebaNueva(actual, {
          ...(esModalidad(prepago['modalidad']) ? { modalidad: prepago['modalidad'] } : {}), ...pedidoPrueba,
        }, ahoraMs);
      } catch (e) {
        if (e instanceof PruebaInvalida) throw new HttpsError('invalid-argument', e.message);
        throw e;
      }
      for (const [k, v] of Object.entries(prueba)) escritura[k] = v === null ? FieldValue.delete() : v;
    }

    // LOS DERIVADOS se recalculan SIEMPRE, con la cuenta COMO VA A QUEDAR: lo
    // que ya había, más lo que trae esta llamada. Sobre eso decide
    // `estadoDeServicio` (`prepago.ts`, puro), y lo que decide se escribe, no
    // lo que mande nadie. Incondicional desde el 20/09 (A-1): como esta
    // callable ya no acepta los derivados a mano, la única forma de que estén
    // bien es calcularlos en cada escritura.
    //
    // SALVO un comercio SIN MIGRAR (sin `modalidad`): para el módulo sería
    // demostración y derivaría «Sin cargo» con monto cero, cambiándole el
    // estado de cuenta sin que nada hubiera pasado. Sus derivados no se tocan
    // hasta que `scripts/migrar-prepago.mjs` (un comercio real) o
    // `scripts/migrar-ejes.mjs` (un demo con el plan viejo) le dé su
    // modalidad (`derivadosGobernados`, revisión de seguridad de A-1, LOW 8).
    const combinada: Record<string, unknown> = { ...actual };
    for (const [k, v] of Object.entries(escritura)) {
      if (v instanceof FieldValue) delete combinada[k]; else combinada[k] = v;
    }
    // UN PRECIO FUERA DE CONTRATO SE RECHAZA (F1b): la mensualidad pendiente
    // se emitió a un importe que la cuenta, como va a quedar, ya no cobraría.
    // Primero se anula el cobro pendiente; después se cambia el precio.
    if (pendienteVivo && montoFueraDeContrato(pendienteVivo, combinada)) {
      throw new HttpsError('failed-precondition',
        `Hay un cobro pendiente de una mensualidad por USD ${String(pendienteVivo['montoUsd'])}, que con este cambio quedaría `
        + `fuera de contrato (la cuenta cobraría USD ${precioMensualDe(combinada, pendienteVivo['plan'])} al mes): `
        + 'anule el cobro pendiente primero.');
    }
    if (precioPorContrato !== undefined && precioPorContrato !== precioAntes) {
      tx.create(refAuditoria.doc(), {
        accion: 'precio_por_contrato', uid, en: ahora,
        antes: { valor: precioAntes, porContrato: precioAntes !== null, mensualUsd: precioMensualDe(actual) },
        despues: { valor: precioPorContrato, porContrato: precioPorContrato !== null, mensualUsd: precioMensualDe(combinada) },
        plan: combinada['plan'] ?? null, delPlanUsd: precioMensualDe({ plan: combinada['plan'] }),
      });
    }
    if (derivadosGobernados(combinada)) {
      const servicio = estadoDeServicio(combinada as CuentaCruda, consumidasDe(metricasDoc.data()), ahoraMs);
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
      // El registro lleva QUÉ campos se pidieron, el valor de los que no son
      // texto libre y, desde F1b, el ANTES de cada uno (`antes`), para que la
      // auditoría diga qué había sin reconstruirlo. `motivoVisible` va solo
      // por nombre: es texto. Si la prueba cambió (también su primer mes y su
      // bolsa, que se deciden solos), va entera antes y después (`prueba`).
      const valor = (v: unknown) => v instanceof FieldValue ? null
        : v instanceof Timestamp ? v.toMillis() : v;
      const pedidoDe = (k: string) => k in cambios ? cambios[k] : k in umbrales ? umbrales[k]
        : k in prepago ? prepago[k] : datos[k];
      const conValor = otros.filter((k) => k !== 'motivoVisible');
      tx.create(refAuditoria.doc(), {
        accion: 'estado_cuenta', uid, en: ahora, campos: otros,
        valores: Object.fromEntries(conValor.map((k) => [k, valor(pedidoDe(k))])),
        antes: Object.fromEntries(conValor.map((k) => [k, valor(actual[k] ?? null)])),
        ...(Object.keys(prueba).length ? { prueba: { antes: pruebaActual(actual), despues: pruebaActual(combinada) } } : {}),
      });
    }
    return nuevos;
  });

  return { ok: true, ...(plan ? { plan } : {}), ...(limites ? { limites } : {}) };
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
  // EL ALCANCE ES EXPLÍCITO (revisión de seguridad de #203, 25/09/2026). La
  // compuerta GLOBAL se pide con `{ alcance: 'global' }`, o con `tenantId`
  // ausente o `null` (así la llama la consola). La de UN tenant, con su
  // identificador. Una CADENA VACÍA no es «global»: es un formulario que se
  // mandó sin el comercio, y antes encendía el corte para todos.
  const alcance = datos['alcance'];
  const crudo = datos['tenantId'];
  if (alcance !== undefined && alcance !== 'global' && alcance !== 'tenant') {
    throw new HttpsError('invalid-argument', 'alcance tiene que ser global o tenant.');
  }
  const global = alcance === 'global' || (alcance === undefined && (crudo === undefined || crudo === null));
  if (global && typeof crudo === 'string' && crudo !== '') {
    throw new HttpsError('invalid-argument', 'La compuerta global no lleva tenantId.');
  }
  const tenantId = global ? '' : texto(crudo, 60);
  if (!global && !ID_TENANT.test(tenantId)) {
    throw new HttpsError('invalid-argument', 'Identificador inválido: para la compuerta global, alcance global.');
  }
  const ahora = Timestamp.now();
  const refPlataforma = db().doc('plataforma/prepago');
  const refHistorial = refPlataforma.collection('historial');

  await db().runTransaction(async (tx) => {
    if (global) {
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

  return { ok: true, corteActivo, alcance: global ? 'global' : 'tenant', ...(global ? {} : { tenantId }) };
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
