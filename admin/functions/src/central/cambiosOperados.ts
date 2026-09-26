/**
 * =============================================================================
 * CAMBIOS OPERADOS POR NOVUCHAT — el contador que hace cumplir el límite
 * =============================================================================
 *
 * POR QUÉ EXISTE (`Analisis/40` §5.2, `Analisis/41` §4.4). Ya hay un comercio
 * al que se le vendió «hasta 4 cambios de configuración al mes» operados por
 * NovuChat, y hasta F1 nadie los contaba: un límite que solo existe en el
 * contrato no existe (`CLAUDE.md`, Base comercial §7). `Analisis/40`
 * recomendaba dejar de venderlos por número; Andres decidió CONTARLOS
 * (`Analisis/41` §4.4), y contarlos en el servidor.
 *
 * QUÉ CUENTA. Un cambio que NovuChat hace A MANO por el comercio: tocar su
 * prompt, su catálogo, su horario, su agenda, a pedido. Lo que el comercio hace
 * solo en su consola NO cuenta, porque para eso está la consola. Por eso la
 * llama solo el PROPIETARIO, al terminar el cambio: es NovuChat registrando su
 * propio trabajo, y el registro es lo que después se cobra o no.
 *
 * QUÉ HACE CUMPLIR. `limites.cambiosIncluidos` de la copia de la cuenta (o del
 * plan, `limitesDeCuenta`): al cambio N+1 del mes, la callable FALLA con
 * `resource-exhausted` y no escribe nada. Con `{ forzar: true }` registra
 * igual y deja `forzado: true` en la auditoría: es el caso «se hizo y se cobra
 * aparte», y tiene que quedar escrito quién lo forzó. Un demo (modalidad
 * `demostracion`) se cuenta y nunca se niega.
 *
 * DÓNDE VIVE EL NÚMERO. `cuenta/estado.cambios.{aaaa-mm}`, un entero por mes
 * calendario de Bolivia. La consola lo lee; no lo escribe (las reglas niegan
 * `cuenta/estado` al navegador) y no lo calcula.
 *
 * COSTO: cero mensajes por conversación. Una escritura en la cuenta y una en
 * la auditoría por cambio registrado.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FieldPath, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { exigirPropietario } from '../autorizacion.js';
import { modalidadDe, type CuentaCruda } from '../prepago.js';
import { cambiosDelMes } from './ejes.js';

const db = () => getFirestore();
// Mismo formato que `ID_TENANT` en index.ts.
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const texto = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max).trim() : '');

/** Lo mínimo que tiene que decir la descripción para que el registro sirva después. */
export const DESCRIPCION_MINIMA = 10;
export const DESCRIPCION_MAXIMA = 300;

export const registrarCambioOperado = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = (peticion.data ?? {}) as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');

  // La descripción es obligatoria y tiene que decir algo: es lo único que
  // permite, en la renovación, saber qué se hizo con los cambios incluidos.
  const descripcion = texto(datos['descripcion'], DESCRIPCION_MAXIMA);
  if (descripcion.length < DESCRIPCION_MINIMA) {
    throw new HttpsError('invalid-argument', `La descripción es obligatoria (al menos ${DESCRIPCION_MINIMA} caracteres).`);
  }
  const forzar = datos['forzar'] === true;
  if (datos['forzar'] !== undefined && typeof datos['forzar'] !== 'boolean') {
    throw new HttpsError('invalid-argument', 'forzar tiene que ser verdadero o falso.');
  }

  const refFicha = db().doc(`tenants/${tenantId}`);
  const refCuenta = db().doc(`tenants/${tenantId}/cuenta/estado`);
  const refAuditoria = db().collection(`tenants/${tenantId}/auditoria`);
  const ahoraMs = Date.now();

  // UNA TRANSACCIÓN: leer el contador, decidir y escribir. Dos registros
  // simultáneos no pueden pasar los dos por el mismo hueco: el segundo se
  // reintenta y ve el número nuevo.
  return db().runTransaction(async (tx) => {
    const [ficha, cuentaDoc] = await Promise.all([tx.get(refFicha), tx.get(refCuenta)]);
    if (!ficha.exists) throw new HttpsError('not-found', 'No existe ese comercio.');
    if (ficha.get('estado') === 'dado_de_baja') {
      throw new HttpsError('failed-precondition', 'Un comercio dado de baja no recibe cambios.');
    }
    // SIN CUENTA NO SE CUENTA (revisión de seguridad de #207, LOW-4): crear
    // acá un `cuenta/estado` con solo el contador dejaría un documento parcial
    // sin plan ni copia de límites. La cuenta la escribe el alta o
    // `asignar-plan.mjs`; después se registra.
    if (!cuentaDoc.exists) {
      throw new HttpsError('failed-precondition', 'El comercio no tiene cuenta: primero asignar-plan.mjs.');
    }
    const cuenta = cuentaDoc.data() as Record<string, unknown>;
    const situacion = cambiosDelMes(cuenta, ahoraMs);

    if (!situacion.permitido && !forzar) {
      throw new HttpsError('resource-exhausted',
        `Los ${situacion.incluidos} cambios incluidos de ${situacion.mes} ya se usaron `
        + `(${situacion.usados}). Este cambio se cobra aparte: regístrelo con forzar.`);
    }

    const numero = situacion.usados + 1;
    const forzado = !situacion.permitido;
    const ahora = Timestamp.now();
    // `FieldPath` y no la notación con punto: el mes lleva un guion y como
    // texto se leería como dos claves.
    tx.update(refCuenta, new FieldPath('cambios', situacion.mes), numero, 'actualizadoEn', ahora);
    tx.create(refAuditoria.doc(), {
      accion: 'cambio_operado', uid, en: ahora,
      mes: situacion.mes, numero, descripcion, forzado,
      incluidos: situacion.ilimitado ? null : situacion.incluidos,
      modalidad: modalidadDe(cuenta as CuentaCruda),
    });
    return {
      ok: true, mes: situacion.mes, usados: numero, forzado,
      incluidos: situacion.ilimitado ? null : situacion.incluidos,
      ilimitado: situacion.ilimitado,
    };
  });
});
