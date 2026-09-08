/**
 * =============================================================================
 * ENDPOINTS DEL FLUJO INTERNO DE NOVUCHAT — cobro prepago y recordatorios
 * =============================================================================
 *
 * Los llama n8n desde el NÚMERO DE NOVUCHAT, no desde el número de un negocio.
 * Se autentican igual que la ingesta —`rutaAutenticada()`, secreto por número,
 * alias en `/rutasWhatsApp`— y exigen además que la ruta sea del flujo
 * `interno`. Es una diferencia de fondo con los otros endpoints: acá el
 * llamador SÍ puede actuar sobre cualquier negocio, porque el llamador es
 * NovuChat. Por eso el `tenantId` que viene en el cuerpo (en
 * `marcarRecordatorioPrepago`) se acepta, cosa que la ingesta jamás hace.
 *
 * Tres endpoints:
 *
 *   cobroPrepago              un turno del negocio que le escribe a NovuChat.
 *                             Resuelve QUIÉN es por el teléfono, decide qué
 *                             contestar (`cobroTextos.ts`, puro) y aplica los
 *                             efectos: crear el pago en curso, anotar que llegó
 *                             el comprobante.
 *   recordatoriosPrepago      qué recordatorios corresponden hoy, y a quién.
 *   marcarRecordatorioPrepago n8n avisa que uno salió, con el identificador de
 *                             mensaje que devolvió Meta. Sin ese identificador
 *                             no se marca nada: un envío fallido se reintenta
 *                             en la corrida siguiente.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { REGION } from './region.js';
import { SECRETOS_POR_ALIAS, enmascarar, rutaAutenticada } from './firma.js';
import { registrar } from './ingesta.js';
import { ID_TENANT, TELEFONO, texto } from './autorizacion.js';
import { decidirRespuesta, TEXTOS, type Contexto, type Entrada } from './cobroTextos.js';
import {
  consumidasDe, corteDe, descripcionDe, estadoDeServicio, importeBs, montoUsdDe, periodoDe,
  recordatoriosDebidos, type CuentaCruda, type EstadoServicio,
} from './prepago.js';
import { MONEDA_COBRO, MONEDA_LISTA } from './prepago.js';
import { tipoCambioVigente } from './tipoCambio.js';
import { camposDerivados } from './cuentas.js';

const db = () => getFirestore();

/** El negocio que representa a NovuChat mismo: ahí vive su QR de cobro. */
export const TENANT_NOVUCHAT = 'novuchat';

const OPCIONES = {
  region: REGION,
  secrets: Object.values(SECRETOS_POR_ALIAS),
  cors: false,
  maxInstances: 10,
} as const;

/**
 * Formas MÍNIMAS de la petición y la respuesta, estructurales: alcanzan para
 * `rutaAutenticada()` y para contestar, y evitan depender de los tipos de
 * Express, que con la instalación estricta de pnpm no están al alcance de este
 * paquete aunque `firebase-functions` los use por dentro.
 */
interface Peticion {
  method: string;
  body?: unknown;
  get(nombre: string): string | undefined;
  rawBody?: Buffer;
}
interface Respuesta {
  status(codigo: number): { send(cuerpo: string): unknown; json(cuerpo: unknown): unknown };
}

/** Autentica y exige que sea el flujo interno. Contesta por su cuenta si no. */
async function soloFlujoInterno(peticion: Peticion, respuesta: Respuesta): Promise<boolean> {
  if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return false; }
  const ruta = await rutaAutenticada(peticion);
  if (!ruta) { respuesta.status(401).send('no autorizado'); return false; }
  if (ruta.flujo !== 'interno') {
    // No se explica más: un número de un negocio no tiene por qué saber que
    // esto existe.
    respuesta.status(403).send('no autorizado');
    return false;
  }
  return true;
}

/** Busca el negocio activo que tiene este teléfono como contacto de cobro. */
async function negocioPorTelefono(telefono: string): Promise<{ tenantId: string; nombre: string } | null> {
  const encontrados = await db().collection('tenants')
    .where('telefonosCobro', 'array-contains', telefono).limit(5).get();
  const activo = encontrados.docs.find((d) => d.get('estado') === 'activo' && ID_TENANT.test(d.id));
  if (!activo) return null;
  return { tenantId: activo.id, nombre: String(activo.get('nombre') ?? '') };
}

// -----------------------------------------------------------------------------
// cobroPrepago — un turno de la conversación de cobro
// -----------------------------------------------------------------------------
export const cobroPrepago = onRequest(OPCIONES, async (peticion, respuesta) => {
  if (!await soloFlujoInterno(peticion, respuesta)) return;

  const cuerpo = (peticion.body ?? {}) as Record<string, unknown>;
  const telefono = texto(cuerpo['telefono'], 20).replace(/\D/g, '');
  if (!TELEFONO.test(telefono)) { respuesta.status(400).json({ error: 'telefono invalido' }); return; }

  const entrada: Entrada = {
    tipo: texto(cuerpo['tipo'], 20) || 'text',
    texto: texto(cuerpo['texto'], 500),
    seleccionId: texto(cuerpo['seleccionId'], 60),
    nombrePerfil: texto(cuerpo['nombrePerfil'], 60),
  };
  const idMeta = texto(cuerpo['idMeta'], 120);
  const mediaId = texto(cuerpo['mediaId'], 120);

  const negocio = await negocioPorTelefono(telefono);
  if (!negocio) {
    respuesta.status(200).json({ tenantId: null, respuesta: TEXTOS.desconocido, lista: null,
      enviarQr: false, avisoAdmin: null });
    return;
  }

  const periodo = periodoDe(Date.now());
  const [cuentaDoc, metricasDoc, qrDoc] = await Promise.all([
    db().doc(`tenants/${negocio.tenantId}/cuenta/estado`).get(),
    db().doc(`tenants/${negocio.tenantId}/metricas/${periodo}`).get(),
    db().doc(`tenants/${TENANT_NOVUCHAT}/config/venta`).get(),
  ]);
  const cuenta = (cuentaDoc.data() ?? {}) as CuentaCruda;
  const estado = estadoDeServicio(cuenta, consumidasDe(metricasDoc.data()), periodo);

  // El pago en curso: el que el negocio eligió y todavía no mandó el comprobante.
  const pagoPendienteId = typeof cuenta.pagoPendienteId === 'string' ? cuenta.pagoPendienteId : '';
  let pagoEnCurso: Contexto['pagoEnCurso'] = null;
  if (/^[A-Za-z0-9_-]{1,128}$/.test(pagoPendienteId)) {
    const pago = await db().doc(`tenants/${negocio.tenantId}/pagos/${pagoPendienteId}`).get();
    const estadoPago = String(pago.get('estado') ?? '');
    if (pago.exists && (estadoPago === 'esperando_comprobante' || estadoPago === 'comprobante_recibido')) {
      pagoEnCurso = {
        id: pago.id,
        descripcion: String(pago.get('descripcion') ?? ''),
        monto: Number(pago.get('monto') ?? 0),
      };
    }
  }

  // El QR de NovuChat: registrado como cobro real del negocio `novuchat` y
  // ENCENDIDO. Apagado o ausente, no se manda ningún QR y se avisa al equipo.
  const cobro = qrDoc.get('cobroReal') as Record<string, unknown> | undefined;
  const fichaQr = String(cobro?.['ficha'] ?? '');
  const qrDisponible = cobro?.['activo'] === true && /^[0-9a-f]{32}$/.test(fichaQr)
    && String(cobro?.['cargaUtil'] ?? '') !== '';

  // El tipo de cambio con el que se cotiza en ESTE turno. Si no hay uno
  // válido no se cotiza: ver `tipoCambio.ts`, regla 1.
  const tc = await tipoCambioVigente(periodo);

  const decision = decidirRespuesta(
    entrada, { negocio, estado, pagoEnCurso, qrDisponible, tco: tc.tco },
  );

  // --- Efectos ---------------------------------------------------------------
  const refCuenta = db().doc(`tenants/${negocio.tenantId}/cuenta/estado`);
  let epigrafeQr = '';
  if (decision.crearPago) {
    const pago = decision.crearPago;
    const refPago = db().collection(`tenants/${negocio.tenantId}/pagos`).doc();
    const lote = db().batch();
    lote.set(refPago, {
      tipo: pago.tipo,
      ...(pago.tipo === 'mensualidad' ? { plan: pago.plan, meses: pago.meses } : { cantidad: pago.cantidad }),
      // EL PAGO SE REGISTRA EN LAS DOS MONEDAS Y CON EL TCO APLICADO. Sin el
      // TCO, seis meses después nadie puede reconstruir por qué se cobraron
      // esos bolivianos, y una factura que no se puede reconstruir no sirve
      // para dirimir nada.
      montoUsd: montoUsdDe(pago),
      monto: importeBs(montoUsdDe(pago), tc.tco),
      moneda: MONEDA_COBRO, monedaLista: MONEDA_LISTA,
      tcoAplicado: tc.tco, tcoFuente: tc.fuente, tcoPeriodo: tc.periodo,
      descripcion: descripcionDe(pago),
      estado: 'esperando_comprobante', canal: 'whatsapp',
      telefonoEnmascarado: enmascarar(telefono),
      creadoEn: Timestamp.now(),
    });
    // Reemplaza al pago en curso anterior, si lo había: el negocio cambió de
    // idea y el comprobante que llegue es del último que eligió.
    lote.set(refCuenta, { pagoPendienteId: refPago.id, actualizadoEn: Timestamp.now() }, { merge: true });
    await lote.commit();
    epigrafeQr = TEXTOS.epigrafeQr(descripcionDe(pago), importeBs(montoUsdDe(pago), tc.tco));
  }
  if (decision.marcarComprobante && pagoEnCurso) {
    await db().doc(`tenants/${negocio.tenantId}/pagos/${pagoEnCurso.id}`).set({
      estado: 'comprobante_recibido',
      comprobanteRecibidoEn: Timestamp.now(),
      ...(idMeta ? { idMetaComprobante: idMeta } : {}),
      ...(mediaId ? { mediaIdComprobante: mediaId } : {}),
      tipoComprobante: entrada.tipo,
    }, { merge: true });
    await registrar(negocio.tenantId, {
      tipo: 'cobro_simulado', resultado: 'ok', canal: 'whatsapp',
      telefono, detalle: `comprobante prepago ${pagoEnCurso.id}`,
    });
  }

  respuesta.status(200).json({
    tenantId: negocio.tenantId,
    respuesta: decision.respuesta,
    lista: decision.lista,
    enviarQr: decision.enviarQr && qrDisponible,
    // La imagen no viaja: viaja su ficha. El flujo arma la dirección con la
    // base de la consola, igual que hace el flujo de venta con el cobro real.
    fichaQr: decision.enviarQr && qrDisponible ? fichaQr : '',
    epigrafeQr,
    avisoAdmin: decision.avisoAdmin,
    avisoMediaId: decision.marcarComprobante && mediaId ? mediaId : '',
  });
});

// -----------------------------------------------------------------------------
// recordatoriosPrepago — qué hay que mandar hoy
// -----------------------------------------------------------------------------
interface RecordatorioParaEnviar {
  tenantId: string;
  negocio: string;
  telefono: string;
  clave: string;
  tipo: string;
  plantilla: string;
  parametros: string[];
}

export const recordatoriosPrepago = onRequest(OPCIONES, async (peticion, respuesta) => {
  if (!await soloFlujoInterno(peticion, respuesta)) return;

  const ahoraMs = Date.now();
  const periodo = periodoDe(ahoraMs);
  // Los recordatorios dicen un importe, así que sin TCO no salen. Es preferible
  // a mandarle a un negocio un monto inventado: ver `tipoCambio.ts`, regla 1.
  const tc = await tipoCambioVigente(periodo);
  const activos = await db().collection('tenants').where('estado', '==', 'activo').limit(500).get();

  const salida: RecordatorioParaEnviar[] = [];
  const sinTelefono: string[] = [];
  for (const ficha of activos.docs) {
    const tenantId = ficha.id;
    if (!ID_TENANT.test(tenantId)) continue;
    const [cuentaDoc, metricasDoc] = await Promise.all([
      db().doc(`tenants/${tenantId}/cuenta/estado`).get(),
      db().doc(`tenants/${tenantId}/metricas/${periodo}`).get(),
    ]);
    let cuenta = (cuentaDoc.data() ?? {}) as CuentaCruda;
    let estado: EstadoServicio = estadoDeServicio(cuenta, consumidasDe(metricasDoc.data()), periodo);
    if (estado.modalidad === 'demostracion') continue;

    // El corte se materializa acá si nadie lo anotó todavía —por ejemplo, el 1
    // del mes a las 09:00, antes de que escriba ningún cliente—. Así el aviso
    // lleva la fecha real del corte y la cuenta muestra «cortado» en el panel.
    const corteGuardado = corteDe(cuenta);
    if (!estado.operativo && corteGuardado?.motivo !== estado.motivo) {
      const corte = { motivo: estado.motivo, desde: Timestamp.now(), perdidas: 0 };
      await cuentaDoc.ref.set({ corte, ...camposDerivados(estado, null) }, { merge: true });
      await registrar(tenantId, {
        tipo: 'corte_servicio', resultado: 'ok', canal: 'sistema', detalle: String(estado.motivo),
      });
      cuenta = { ...cuenta, corte };
      estado = estadoDeServicio(cuenta, consumidasDe(metricasDoc.data()), periodo);
    } else if (estado.operativo && corteGuardado) {
      await cuentaDoc.ref.set(camposDerivados(estado, corteGuardado), { merge: true });
      await registrar(tenantId, { tipo: 'reanudacion_servicio', resultado: 'ok', canal: 'sistema' });
    }

    const nombre = String(ficha.get('nombre') ?? '');
    const debidos = recordatoriosDebidos(cuenta, estado, nombre, ahoraMs, tc.tco);
    if (debidos.length === 0) continue;

    const telefonos = Array.isArray(ficha.get('telefonosCobro')) ? ficha.get('telefonosCobro') as unknown[] : [];
    const dueno = (ficha.get('dueno') ?? {}) as Record<string, unknown>;
    const telefono = [...telefonos, dueno['telefono']]
      .map((t) => String(t ?? '').replace(/\D/g, '')).find((t) => TELEFONO.test(t));
    if (!telefono) { sinTelefono.push(tenantId); continue; }

    for (const r of debidos) {
      salida.push({ tenantId, negocio: nombre, telefono, clave: r.clave, tipo: r.tipo,
        plantilla: r.plantilla, parametros: r.parametros });
    }
  }

  respuesta.status(200).json({ periodo, recordatorios: salida, sinTelefono });
});

// -----------------------------------------------------------------------------
// marcarRecordatorioPrepago — salió de verdad
// -----------------------------------------------------------------------------
export const marcarRecordatorioPrepago = onRequest(OPCIONES, async (peticion, respuesta) => {
  if (!await soloFlujoInterno(peticion, respuesta)) return;

  const cuerpo = (peticion.body ?? {}) as Record<string, unknown>;
  const tenantId = texto(cuerpo['tenantId'], 60);
  const clave = texto(cuerpo['clave'], 80);
  const idMensaje = texto(cuerpo['idMensaje'], 120);
  const telefono = texto(cuerpo['telefono'], 20);
  if (!ID_TENANT.test(tenantId) || !/^[a-z0-9_-]{1,80}$/.test(clave)) {
    respuesta.status(400).json({ error: 'datos invalidos' }); return;
  }
  // SIN IDENTIFICADOR DE MENSAJE NO SE MARCA. Es la lección del recordatorio de
  // citas: marcar antes de saber que salió vuelve el fallo permanente e
  // invisible.
  if (!idMensaje) { respuesta.status(400).json({ error: 'falta idMensaje' }); return; }

  await db().doc(`tenants/${tenantId}/cuenta/estado`).set({
    recordatorios: { [clave]: { en: Timestamp.now(), idMensaje } },
    // Un aviso de renovación deja la cuenta en «pendiente»: el comercio lo ve
    // en su panel antes de que se le corte.
    ...(clave.startsWith('renovacion_') ? { estadoPago: 'pendiente' } : {}),
    actualizadoEn: Timestamp.now(),
  }, { merge: true });
  await registrar(tenantId, {
    tipo: 'plantilla_enviada', resultado: 'ok', canal: 'whatsapp',
    ...(telefono ? { telefono } : {}), detalle: clave,
  });
  await db().doc(`tenants/${tenantId}/cuenta/estado`).update({ actualizadoEn: FieldValue.serverTimestamp() });
  respuesta.status(200).json({ ok: true });
});
