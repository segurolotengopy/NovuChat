/**
 * =============================================================================
 * LOS EJES DE UNA CUENTA: asignar el modelo y la titularidad, y leerlos
 * =============================================================================
 *
 * Dos callables, con la firma que la consola (`web/src/lib/ejes.ts`, PR #203)
 * ya supone:
 *
 *   `asignarEjes({ tenantId, titularidad?: { phoneNumberId, titularidad }, modelo? })`
 *   ESCRITURA, solo el propietario. El MODELO de IA va a la ficha
 *   (`tenants/{t}.modelo`) y la TITULARIDAD al número
 *   (`rutasWhatsApp/{n}.titularidad`), en una transacción, y solo si el
 *   número es de ESE comercio: cambiar la titularidad de un número ajeno con
 *   el tenant equivocado en la petición sería mover quién paga Meta de otro
 *   cliente. Queda en la auditoría del comercio (`asignar_ejes`) con el antes
 *   y el después. El plan, la modalidad y los umbrales siguen en
 *   `actualizarEstadoCuenta` (index.ts): son la cuenta; estos dos son la
 *   ficha y el canal. `asignar-plan.mjs` escribe los cinco desde la terminal.
 *
 *   `ejesDeCuenta({ tenantId })` — LECTURA. Los tres ejes (`Analisis/41` §4)
 *   más el modelo y el contador de cambios, en una sola forma, para que la
 *   consola los pinte iguales en Cuenta, Pagar y Negocios sin calcular nada. La
 *   llama el administrador del comercio o el propietario. ES EL ÚNICO CAMINO
 *   por el que el comercio ve la titularidad de sus números: `rutasWhatsApp`
 *   sigue siendo solo del propietario en `firestore.rules`, porque el
 *   documento trae el alias del secreto, la WABA y quién lo asignó (revisión
 *   de seguridad de #207, LOW-1). Acá viaja solo lo que la pantalla necesita.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { exigirAdminOPropietario, exigirPropietario } from '../autorizacion.js';
import { limitesDeCuenta } from '../planes.js';
import { modalidadDe, type CuentaCruda } from '../prepago.js';
import {
  MODELOS, TITULARIDADES, cambiosDelMes, esModelo, esTitularidad, modeloDe, titularidadDe,
} from './ejes.js';

const db = () => getFirestore();
// Mismos formatos que `ID_TENANT` e `ID_NUMERO` en index.ts.
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const ID_NUMERO = /^[0-9]{6,25}$/;
const texto = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max).trim() : '');
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export const asignarEjes = onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = (peticion.data ?? {}) as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  const viene = (clave: string) => Object.prototype.hasOwnProperty.call(datos, clave);

  // EL MODELO: lista cerrada de `central/ejes.ts`. Cualquier otra cosa se rechaza.
  let modelo: string | null = null;
  if (viene('modelo')) {
    if (!esModelo(datos['modelo'])) {
      throw new HttpsError('invalid-argument', `Modelo desconocido. Uno de: ${MODELOS.join(', ')}.`);
    }
    modelo = datos['modelo'];
  }

  // LA TITULARIDAD: un número y un valor de la lista.
  let phoneNumberId = '';
  let titularidad: string | null = null;
  if (viene('titularidad')) {
    const t = datos['titularidad'];
    if (!esObjeto(t)) throw new HttpsError('invalid-argument', 'titularidad tiene que ser { phoneNumberId, titularidad }.');
    phoneNumberId = texto(t['phoneNumberId'], 25);
    if (!ID_NUMERO.test(phoneNumberId)) throw new HttpsError('invalid-argument', 'phone_number_id inválido.');
    if (!esTitularidad(t['titularidad'])) {
      throw new HttpsError('invalid-argument', `Titularidad desconocida. Una de: ${TITULARIDADES.join(', ')}.`);
    }
    titularidad = t['titularidad'];
  }
  if (modelo === null && titularidad === null) throw new HttpsError('invalid-argument', 'Nada que asignar.');

  const refFicha = db().doc(`tenants/${tenantId}`);
  const refRuta = titularidad !== null ? db().doc(`rutasWhatsApp/${phoneNumberId}`) : null;
  return db().runTransaction(async (tx) => {
    const [ficha, ruta] = await Promise.all([tx.get(refFicha), refRuta ? tx.get(refRuta) : Promise.resolve(null)]);
    if (!ficha.exists) throw new HttpsError('not-found', 'No existe ese comercio.');
    if (ficha.get('estado') === 'dado_de_baja') {
      throw new HttpsError('failed-precondition', 'Un comercio dado de baja no recibe ejes.');
    }
    // Un número sin ruta no es de nadie: primero se asigna (`asignarNumero`).
    // Y uno que es de OTRO comercio no se toca desde este tenant.
    if (ruta && !ruta.exists) throw new HttpsError('not-found', 'Ese número no está asignado a ningún comercio.');
    if (ruta && ruta.get('tenantId') !== tenantId) {
      throw new HttpsError('failed-precondition', 'Ese número es de otro comercio.');
    }

    const ahora = Timestamp.now();
    const auditoria: Record<string, unknown> = { accion: 'asignar_ejes', uid, en: ahora };
    if (modelo !== null) {
      tx.update(refFicha, { modelo });
      auditoria['modeloAntes'] = modeloDe(ficha.data());
      auditoria['modeloDespues'] = modelo;
    }
    if (ruta && refRuta && titularidad !== null) {
      tx.update(refRuta, { titularidad, titularidadEn: ahora, titularidadPor: uid });
      auditoria['phoneNumberId'] = phoneNumberId;
      auditoria['titularidadAntes'] = titularidadDe(ruta.data());
      auditoria['titularidadDespues'] = titularidad;
    }
    tx.create(db().collection(`tenants/${tenantId}/auditoria`).doc(), auditoria);
    return {
      ok: true, tenantId,
      ...(modelo !== null ? { modelo } : {}),
      ...(titularidad !== null ? { titularidad: { phoneNumberId, titularidad } } : {}),
    };
  });
});

export const ejesDeCuenta = onCall(async (peticion) => {
  const datos = (peticion.data ?? {}) as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  // El administrador de ESTE comercio o el propietario. Un administrador de
  // otro comercio no pasa: la titularidad y el modelo dicen cuánto cuesta
  // atender a este negocio.
  exigirAdminOPropietario(peticion, tenantId);

  const [ficha, cuentaDoc, rutas] = await Promise.all([
    db().doc(`tenants/${tenantId}`).get(),
    db().doc(`tenants/${tenantId}/cuenta/estado`).get(),
    db().collection('rutasWhatsApp').where('tenantId', '==', tenantId).get(),
  ]);
  if (!ficha.exists) throw new HttpsError('not-found', 'No existe ese comercio.');
  const cuenta = (cuentaDoc.data() ?? {}) as Record<string, unknown>;
  const limites = limitesDeCuenta(cuenta);
  const cambios = cambiosDelMes(cuenta, Date.now());

  return {
    tenantId,
    plan: typeof cuenta['plan'] === 'string' ? cuenta['plan'] : null,
    limites: {
      conversaciones: limites.conversaciones, productos: limites.productos,
      agendas: limites.agendas, cambiosIncluidos: limites.cambiosIncluidos, origen: limites.origen,
    },
    modalidad: modalidadDe(cuenta as CuentaCruda),
    modalidadExplicita: typeof cuenta['modalidad'] === 'string',
    modelo: modeloDe(ficha.data()),
    // Los números del comercio con su titularidad. El alias del secreto NO
    // viaja: no lo necesita ninguna pantalla.
    numeros: rutas.docs.map((r) => ({
      phoneNumberId: r.id,
      flujo: String(r.get('flujo') ?? ''),
      estado: String(r.get('estado') ?? ''),
      titularidad: titularidadDe(r.data()),
      titularidadExplicita: esTitularidad(r.get('titularidad')),
    })),
    cambios: {
      mes: cambios.mes, usados: cambios.usados, ilimitado: cambios.ilimitado,
      incluidos: cambios.ilimitado ? null : cambios.incluidos,
      restantes: cambios.ilimitado ? null : cambios.restantes,
    },
  };
});
