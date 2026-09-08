/**
 * =============================================================================
 * CUENTAS PREPAGO — lo que NovuChat hace desde la consola
 * =============================================================================
 *
 * Editar la ficha comercial de un negocio, fijar su plan y su modalidad,
 * registrar un pago que llegó por fuera del flujo, y confirmar o rechazar uno
 * que llegó por WhatsApp. Todo por Cloud Function, todo auditado: ningún
 * navegador escribe `/cuenta/estado` ni `/pagos`.
 *
 * LA REGLA QUE SOSTIENE EL PREPAGO: **el único acto que suma meses o bolsas es
 * `aplicarPagoEnCuenta`**, y se llega a él por dos caminos —`registrarPago`
 * (pago visto por fuera) y `confirmarPago` (comprobante que llegó por el flujo
 * interno)—, los dos con rol de propietario. Quien confirma un pago queda
 * escrito en el documento del pago y en la auditoría.
 *
 * Y LA QUE PROTEGE A LOS DEMOS: `configurarCuenta` es lo único que pone una
 * modalidad. Un negocio sin modalidad es demostración y no se corta nunca.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { randomBytes } from 'node:crypto';
import { registrar } from './ingesta.js';
import { tipoCambioVigente } from './tipoCambio.js';
import { TELEFONO, auditar, exigirPropietario, tenantDe, texto } from './autorizacion.js';
import {
  MONEDA_COBRO, MONEDA_LISTA, PLAN_POR_DEFECTO, PRUEBA, aplicarPago, consumidasDe, corteDe, descripcionDe,
  esModalidad, esPeriodo, esPlan, estadoDeServicio, finDelPeriodoMs, importeBs, montoUsdDe, periodoDe,
  type TipoCambio,
  type Corte, type CuentaCruda, type EstadoServicio, type Modalidad, type Pago, type PlanId,
} from './prepago.js';

const db = () => getFirestore();

// -----------------------------------------------------------------------------
// Derivados: lo que se escribe junto con CUALQUIER cambio de la cuenta
// -----------------------------------------------------------------------------
/**
 * `estadoPago`, `montoMensual`, `proximoVencimiento` y el corte se DERIVAN del
 * estado, nunca se editan a mano. Si se pudieran fijar sueltos, la pantalla
 * podría decir «al día» con el servicio cortado.
 */
export function camposDerivados(estado: EstadoServicio, corteGuardado: Corte | null): Record<string, unknown> {
  return {
    estadoPago: estado.cubierto ? 'al_dia' : 'vencido',
    // La mensualidad se guarda EN DÓLARES, que es como está la lista. El
    // importe en bolivianos es derivado y depende del TCO del mes, así que
    // guardarlo acá lo dejaría desactualizado sin que nadie lo note.
    montoMensual: estado.mensualidadUsd,
    moneda: MONEDA_LISTA,
    proximoVencimiento: estado.cubiertoHasta
      ? Timestamp.fromMillis(finDelPeriodoMs(estado.cubiertoHasta))
      : FieldValue.delete(),
    // Un corte anotado que ya no corresponde se levanta acá mismo.
    ...(corteGuardado && estado.operativo ? { corte: FieldValue.delete() } : {}),
    actualizadoEn: Timestamp.now(),
  };
}

/** Lee un pago de su documento y lo devuelve tipado, o `null` si está mal formado. */
export function pagoDeDocumento(d: Record<string, unknown> | undefined): Pago | null {
  if (!d) return null;
  if (d['tipo'] === 'bolsa') {
    const cantidad = Number(d['cantidad']);
    return { tipo: 'bolsa', cantidad: Number.isFinite(cantidad) && cantidad >= 1 ? Math.trunc(cantidad) : 1 };
  }
  if (d['tipo'] === 'mensualidad' && esPlan(d['plan'])) {
    const meses = Number(d['meses']);
    return { tipo: 'mensualidad', plan: d['plan'], meses: Number.isFinite(meses) && meses >= 1 ? Math.trunc(meses) : 1 };
  }
  return null;
}

/** Los campos del documento de un pago que salen de su definición. */
function camposDePago(pago: Pago, tc: TipoCambio): Record<string, unknown> {
  return {
    tipo: pago.tipo,
    ...(pago.tipo === 'mensualidad' ? { plan: pago.plan, meses: pago.meses } : { cantidad: pago.cantidad }),
    // LAS DOS MONEDAS Y EL TCO APLICADO. Sin el TCO no se puede reconstruir la
    // factura: seis meses después nadie sabe con qué tipo de cambio se
    // convirtieron esos bolivianos, y una factura que no se puede reconstruir
    // no sirve para dirimir nada.
    montoUsd: montoUsdDe(pago),
    monto: importeBs(montoUsdDe(pago), tc.tco),
    moneda: MONEDA_COBRO,
    monedaLista: MONEDA_LISTA,
    tcoAplicado: tc.tco,
    tcoFuente: tc.fuente,
    tcoPeriodo: tc.periodo,
    descripcion: descripcionDe(pago),
  };
}

// -----------------------------------------------------------------------------
// APLICAR UN PAGO — la única puerta que suma meses o bolsas
// -----------------------------------------------------------------------------
export interface ResultadoPago {
  pagoId: string;
  descripcion: string;
  monto: number;
  cubiertoHasta: string;
  operativo: boolean;
  corteLevantado: boolean;
}

export async function aplicarPagoEnCuenta(
  tenantId: string,
  pago: Pago,
  meta: { uid: string; canal: 'panel' | 'whatsapp'; pagoId?: string; referencia?: string; nota?: string },
): Promise<ResultadoPago> {
  const periodo = periodoDe(Date.now());
  // El TCO con el que se convierte este pago. Se lee ANTES de la transacción y
  // se guarda con el pago: es lo que permite reconstruir la factura.
  const tc = await tipoCambioVigente(periodo);
  const refCuenta = db().doc(`tenants/${tenantId}/cuenta/estado`);
  const refMetricas = db().doc(`tenants/${tenantId}/metricas/${periodo}`);
  const refFicha = db().doc(`tenants/${tenantId}`);
  const refPago = meta.pagoId
    ? db().doc(`tenants/${tenantId}/pagos/${meta.pagoId}`)
    : db().collection(`tenants/${tenantId}/pagos`).doc();

  const resultado = await db().runTransaction(async (tx) => {
    const [ficha, cuentaDoc, metricasDoc, pagoDoc] = await Promise.all([
      tx.get(refFicha), tx.get(refCuenta), tx.get(refMetricas), tx.get(refPago),
    ]);
    if (!ficha.exists) throw new HttpsError('not-found', 'No existe ese comercio.');
    if (meta.pagoId) {
      // Un pago que llegó por el flujo se confirma UNA vez. Confirmar dos veces
      // sumaría dos meses por un solo comprobante.
      if (!pagoDoc.exists) throw new HttpsError('not-found', 'No existe ese pago.');
      const estadoPago = String(pagoDoc.get('estado') ?? '');
      if (estadoPago !== 'esperando_comprobante' && estadoPago !== 'comprobante_recibido') {
        throw new HttpsError('failed-precondition', `Ese pago ya está ${estadoPago}.`);
      }
    }

    const cuenta = (cuentaDoc.data() ?? {}) as CuentaCruda;
    const nuevo = aplicarPago(cuenta, pago, periodo);
    const cuentaNueva: CuentaCruda = {
      ...cuenta, plan: nuevo.plan, modalidad: nuevo.modalidad,
      periodoPagado: nuevo.periodoPagado, bolsa: nuevo.bolsa,
    };
    const estado = estadoDeServicio(cuentaNueva, consumidasDe(metricasDoc.data()), periodo);
    const corteGuardado = corteDe(cuenta);

    tx.set(refCuenta, {
      plan: nuevo.plan, modalidad: nuevo.modalidad,
      periodoPagado: nuevo.periodoPagado, bolsa: nuevo.bolsa,
      ...camposDerivados(estado, corteGuardado),
      pagoPendienteId: FieldValue.delete(),
      motivoVisible: '',
    }, { merge: true });
    tx.update(refFicha, { plan: nuevo.plan });
    tx.set(refPago, {
      ...camposDePago(pago, tc),
      estado: 'confirmado',
      canal: meta.canal,
      confirmadoPor: meta.uid,
      confirmadoEn: Timestamp.now(),
      cubiertoHasta: nuevo.cubiertoHasta,
      ...(meta.referencia ? { referencia: meta.referencia } : {}),
      ...(meta.nota ? { nota: meta.nota } : {}),
      ...(pagoDoc.exists ? {} : { creadoEn: Timestamp.now() }),
    }, { merge: true });

    return {
      pagoId: refPago.id, descripcion: descripcionDe(pago),
      monto: importeBs(montoUsdDe(pago), tc.tco),
      cubiertoHasta: nuevo.cubiertoHasta, operativo: estado.operativo,
      corteLevantado: corteGuardado !== null && estado.operativo,
    };
  });

  await registrar(tenantId, {
    tipo: 'pago_registrado', resultado: 'ok', canal: meta.canal, detalle: resultado.descripcion,
  });
  if (resultado.corteLevantado) {
    await registrar(tenantId, { tipo: 'reanudacion_servicio', resultado: 'ok', canal: 'sistema' });
  }
  await auditar(tenantId, 'pago_aplicado', meta.uid, {
    pagoId: resultado.pagoId, descripcion: resultado.descripcion, monto: resultado.monto,
    canal: meta.canal, cubiertoHasta: resultado.cubiertoHasta,
  });
  return resultado;
}

/** Interpreta lo que manda la consola como un pago, o lanza. */
function pagoDePeticion(datos: Record<string, unknown>): Pago {
  if (datos['tipo'] === 'bolsa') {
    const cantidad = Number(datos['cantidad'] ?? 1);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 20) {
      throw new HttpsError('invalid-argument', 'La cantidad de bolsas va de 1 a 20.');
    }
    return { tipo: 'bolsa', cantidad };
  }
  if (datos['tipo'] === 'mensualidad') {
    const plan = datos['plan'];
    if (!esPlan(plan)) throw new HttpsError('invalid-argument', 'Plan desconocido.');
    const meses = Number(datos['meses'] ?? 1);
    if (!Number.isInteger(meses) || meses < 1 || meses > 12) {
      throw new HttpsError('invalid-argument', 'Los meses van de 1 a 12.');
    }
    return { tipo: 'mensualidad', plan, meses };
  }
  throw new HttpsError('invalid-argument', 'Tipo de pago desconocido.');
}

// -----------------------------------------------------------------------------
// CALLABLES
// -----------------------------------------------------------------------------

/** Pago visto por fuera del flujo (transferencia, efectivo): se registra y se aplica. */
export const registrarPago = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = tenantDe(datos);
  const pago = pagoDePeticion(datos);
  return aplicarPagoEnCuenta(tenantId, pago, {
    uid, canal: 'panel',
    referencia: texto(datos['referencia'], 120) || undefined,
    nota: texto(datos['nota'], 300) || undefined,
  });
});

/** Comprobante que llegó por WhatsApp: NovuChat lo miró y lo da por bueno. */
export const confirmarPago = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = tenantDe(datos);
  const pagoId = texto(datos['pagoId'], 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(pagoId)) throw new HttpsError('invalid-argument', 'Falta el pago.');

  const doc = await db().doc(`tenants/${tenantId}/pagos/${pagoId}`).get();
  const pago = pagoDeDocumento(doc.data());
  if (!doc.exists || !pago) throw new HttpsError('not-found', 'No existe ese pago, o está mal formado.');

  return aplicarPagoEnCuenta(tenantId, pago, {
    uid, canal: 'whatsapp', pagoId, nota: texto(datos['nota'], 300) || undefined,
  });
});

export const rechazarPago = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = tenantDe(datos);
  const pagoId = texto(datos['pagoId'], 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(pagoId)) throw new HttpsError('invalid-argument', 'Falta el pago.');
  const motivo = texto(datos['motivo'], 300) || 'sin especificar';

  const refPago = db().doc(`tenants/${tenantId}/pagos/${pagoId}`);
  const refCuenta = db().doc(`tenants/${tenantId}/cuenta/estado`);
  await db().runTransaction(async (tx) => {
    const [pago, cuenta] = await Promise.all([tx.get(refPago), tx.get(refCuenta)]);
    if (!pago.exists) throw new HttpsError('not-found', 'No existe ese pago.');
    if (pago.get('estado') === 'confirmado') {
      throw new HttpsError('failed-precondition', 'Un pago confirmado no se rechaza: se compensa con otro asiento.');
    }
    tx.update(refPago, { estado: 'rechazado', motivoRechazo: motivo, rechazadoPor: uid, rechazadoEn: Timestamp.now() });
    if (cuenta.get('pagoPendienteId') === pagoId) {
      tx.set(refCuenta, { pagoPendienteId: FieldValue.delete(), actualizadoEn: Timestamp.now() }, { merge: true });
    }
  });
  await auditar(tenantId, 'pago_rechazado', uid, { pagoId, motivo });
  return { ok: true };
});

/**
 * Plan, modalidad y saldos, fijados a mano por NovuChat. Es el alta de la parte
 * comercial de un negocio y también la corrección de cualquier cosa.
 *
 *   modalidad 'prueba'   → `periodoPrueba` (el mes en curso si no se indica)
 *                          y `bolsaPrueba` (20 si no se indica).
 *   modalidad 'prepago'  → `periodoPagado` tal cual se indique; vacío = nada
 *                          cubierto, o sea cortado hasta que pague.
 *   modalidad 'demostracion' → sin corte, sin cobro.
 */
export const configurarCuenta = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = tenantDe(datos);
  const resultado = await escribirCuenta(tenantId, datos, uid);
  await auditar(tenantId, 'configurar_cuenta', uid, resultado.cambios);
  return resultado.resumen;
});

export interface CambiosDeCuenta {
  plan?: unknown; modalidad?: unknown; periodoPrueba?: unknown; periodoPagado?: unknown;
  bolsa?: unknown; bolsaPrueba?: unknown; motivoVisible?: unknown;
}

/**
 * Escribe la cuenta con lo que venga en `datos` y recalcula los derivados. Lo
 * usa `configurarCuenta` y también el alta, que arranca la cuenta con su
 * modalidad. Devuelve qué cambió (para la auditoría) y el estado resultante.
 */
export async function escribirCuenta(
  tenantId: string,
  datos: CambiosDeCuenta,
  uid: string,
): Promise<{ cambios: Record<string, unknown>; resumen: Record<string, unknown> }> {
  const periodo = periodoDe(Date.now());
  const refCuenta = db().doc(`tenants/${tenantId}/cuenta/estado`);
  const refMetricas = db().doc(`tenants/${tenantId}/metricas/${periodo}`);
  const refFicha = db().doc(`tenants/${tenantId}`);

  const cambios: Record<string, unknown> = {};
  if (datos.plan !== undefined) {
    if (!esPlan(datos.plan)) throw new HttpsError('invalid-argument', 'Plan desconocido.');
    cambios['plan'] = datos.plan;
  }
  if (datos.modalidad !== undefined) {
    if (!esModalidad(datos.modalidad)) throw new HttpsError('invalid-argument', 'Modalidad desconocida.');
    cambios['modalidad'] = datos.modalidad;
  }
  for (const campo of ['periodoPrueba', 'periodoPagado'] as const) {
    const v = datos[campo];
    if (v === undefined) continue;
    if (v !== '' && !esPeriodo(v)) throw new HttpsError('invalid-argument', `${campo} debe ser aaaa-mm.`);
    cambios[campo] = v;
  }
  for (const campo of ['bolsa', 'bolsaPrueba'] as const) {
    const v = datos[campo];
    if (v === undefined) continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw new HttpsError('invalid-argument', `${campo} inválida.`);
    cambios[campo] = n;
  }
  if (datos.motivoVisible !== undefined) cambios['motivoVisible'] = texto(datos.motivoVisible, 300);

  const resumen = await db().runTransaction(async (tx) => {
    const [ficha, cuentaDoc, metricasDoc] = await Promise.all([
      tx.get(refFicha), tx.get(refCuenta), tx.get(refMetricas),
    ]);
    if (!ficha.exists) throw new HttpsError('not-found', 'No existe ese comercio.');
    const anterior = (cuentaDoc.data() ?? {}) as CuentaCruda;
    const modalidad = (cambios['modalidad'] ?? anterior.modalidad) as unknown;

    // Arrancar una prueba sin decir el mes es arrancarla AHORA, con su bolsa.
    if (modalidad === 'prueba') {
      if (cambios['periodoPrueba'] === undefined && !esPeriodo(anterior.periodoPrueba)) {
        cambios['periodoPrueba'] = periodo;
      }
      if (cambios['bolsaPrueba'] === undefined && typeof anterior.bolsaPrueba !== 'number') {
        cambios['bolsaPrueba'] = PRUEBA.conversaciones;
      }
    }
    if (cambios['plan'] === undefined && !esPlan(anterior.plan)) cambios['plan'] = PLAN_POR_DEFECTO;

    const cuentaNueva = { ...anterior, ...cambios } as CuentaCruda;
    const estado = estadoDeServicio(cuentaNueva, consumidasDe(metricasDoc.data()), periodo);
    tx.set(refCuenta, { ...cambios, ...camposDerivados(estado, corteDe(anterior)) }, { merge: true });
    tx.update(refFicha, { plan: estado.plan });
    return {
      plan: estado.plan, modalidad: estado.modalidad, operativo: estado.operativo,
      motivo: estado.motivo, disponibles: Number.isFinite(estado.disponibles) ? estado.disponibles : null,
      cubiertoHasta: estado.cubiertoHasta,
    };
  });
  await registrar(tenantId, {
    tipo: 'config_publicada', resultado: 'ok', canal: 'panel',
    detalle: `cuenta:${Object.keys(cambios).sort().join(',')}`,
  });
  return { cambios: { ...cambios, por: uid }, resumen };
}

/** Ficha comercial: razón social, NIT, dueño y teléfonos de cobro. */
export const editarTenant = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = peticion.data as Record<string, unknown>;
  const tenantId = tenantDe(datos);
  const cambios = fichaComercialDe(datos);
  if (Object.keys(cambios).length === 0) throw new HttpsError('invalid-argument', 'Nada que cambiar.');

  const ref = db().doc(`tenants/${tenantId}`);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'No existe ese comercio.');
  await ref.update({ ...cambios, editadoEn: Timestamp.now(), editadoPor: uid });
  await auditar(tenantId, 'editar_tenant', uid, { campos: Object.keys(cambios).sort() });
  return { ok: true };
});

/**
 * Valida los campos comerciales de la ficha. Devuelve solo los que vinieron.
 * Lo usan el alta y la edición, para que las dos validen igual.
 */
export function fichaComercialDe(datos: Record<string, unknown>): Record<string, unknown> {
  const cambios: Record<string, unknown> = {};
  if (datos['nombre'] !== undefined) {
    const nombre = texto(datos['nombre'], 80);
    if (!nombre) throw new HttpsError('invalid-argument', 'El nombre no puede quedar vacío.');
    cambios['nombre'] = nombre;
  }
  if (datos['razonSocial'] !== undefined) cambios['razonSocial'] = texto(datos['razonSocial'], 160);
  if (datos['nit'] !== undefined) {
    const nit = texto(datos['nit'], 20);
    if (nit && !/^[0-9]{5,15}$/.test(nit)) throw new HttpsError('invalid-argument', 'El NIT son solo dígitos.');
    cambios['nit'] = nit;
  }
  if (datos['dueno'] !== undefined) {
    const d = (typeof datos['dueno'] === 'object' && datos['dueno'] !== null ? datos['dueno'] : {}) as Record<string, unknown>;
    const telefono = texto(d['telefono'], 15).replace(/\D/g, '');
    if (telefono && !TELEFONO.test(telefono)) throw new HttpsError('invalid-argument', 'Teléfono del dueño inválido.');
    const correo = texto(d['correo'], 254).toLowerCase();
    if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new HttpsError('invalid-argument', 'Correo del dueño inválido.');
    cambios['dueno'] = { nombre: texto(d['nombre'], 120), telefono, correo };
  }
  if (datos['telefonosCobro'] !== undefined) {
    const lista = Array.isArray(datos['telefonosCobro']) ? datos['telefonosCobro'] : [];
    const telefonos = [...new Set(lista.map((t) => texto(t, 20).replace(/\D/g, '')).filter(Boolean))];
    if (telefonos.length > 5) throw new HttpsError('invalid-argument', 'Hasta cinco teléfonos de cobro.');
    for (const t of telefonos) {
      if (!TELEFONO.test(t)) throw new HttpsError('invalid-argument', `Teléfono de cobro inválido: ${t}`);
    }
    cambios['telefonosCobro'] = telefonos;
  }
  return cambios;
}

// -----------------------------------------------------------------------------
// LA CUENTA DEL ADMINISTRADOR, creada desde el alta
// -----------------------------------------------------------------------------
/**
 * Crea la cuenta de correo y contraseña del administrador si no existe, con una
 * clave aleatoria que nadie ve, y devuelve el enlace para que ponga la suya.
 * Es lo que hacía `scripts/alta-comercio.mjs`; ahora lo hace también la
 * consola. Completar el enlace marca el correo como verificado, que es lo que
 * las reglas exigen para cualquier rol de comercio.
 */
export async function cuentaDelAdministrador(
  correo: string,
  nombre: string,
): Promise<{ uid: string; creada: boolean; enlace: string | null }> {
  const auth = getAuth();
  const existente = await auth.getUserByEmail(correo).catch(() => null);
  if (existente) return { uid: existente.uid, creada: false, enlace: null };
  const usuario = await auth.createUser({
    email: correo,
    ...(nombre ? { displayName: nombre } : {}),
    password: randomBytes(32).toString('base64url'),
    emailVerified: false,
  });
  const enlace = await auth.generatePasswordResetLink(correo);
  return { uid: usuario.uid, creada: true, enlace };
}

/** Modalidad y plan iniciales de un alta. Se validan acá para fallar ANTES de crear nada. */
export function cuentaInicialDe(datos: Record<string, unknown>): {
  plan: PlanId; modalidad: Modalidad; primerMesPagado: boolean;
} {
  const plan = datos['plan'] === undefined ? PLAN_POR_DEFECTO : datos['plan'];
  if (!esPlan(plan)) throw new HttpsError('invalid-argument', 'Plan desconocido.');
  const modalidad = datos['modalidad'] === undefined ? 'prueba' : datos['modalidad'];
  if (!esModalidad(modalidad)) throw new HttpsError('invalid-argument', 'Modalidad desconocida.');
  return { plan, modalidad, primerMesPagado: datos['primerMesPagado'] === true };
}
