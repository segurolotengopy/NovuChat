/**
 * =============================================================================
 * COBRO CON EL QR DEL COMERCIO — registro, y la imagen que se le manda al cliente
 * =============================================================================
 *
 * LA DIFERENCIA CON EL COBRO SIMULADO, que es lo que hay que tener claro antes
 * de leer una línea de esto: acá el dinero SÍ se mueve. El cliente paga a la
 * cuenta del comercio, NovuChat no toca la plata y no la ve pasar. Por eso el
 * sistema nunca dice «pago acreditado»: dice que recibió un comprobante y que
 * los datos coinciden. La acreditación la da el banco, y la confirma el negocio.
 *
 * EL QR NO SE GUARDA COMO IMAGEN: SE VUELVE A DIBUJAR.
 *
 * El comercio sube una foto o una captura, el navegador la lee y manda el
 * TEXTO del código. Ese texto se valida acá, se guarda, y cada vez que hay que
 * mandarle el QR a un cliente se dibuja de nuevo a partir del texto guardado.
 * Tres razones, en orden de importancia:
 *
 *  1. **No hay hueco entre lo que se validó y lo que se envía.** Si se guardara
 *     la imagen, alguien podría subir una foto que muestra un QR y declarar un
 *     texto distinto: se validaría un código y se le enviaría otro al cliente,
 *     que pagaría a una cuenta ajena. Dibujando desde el texto validado, eso no
 *     puede pasar por construcción.
 *  2. **Se lee siempre.** Una foto de la pantalla del banco, con reflejo y
 *     movida, escanea mal. Un QR dibujado limpio escanea siempre.
 *  3. No hace falta almacenamiento de archivos, ni sus reglas, ni su CORS.
 */
import { onCall, onRequest, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { REGION } from './region.js';
import { validarQrSimple } from './qrSimple.js';
import { dibujarQr } from './dibujoQr.js';

const db = () => getFirestore();
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const texto = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.slice(0, max).trim() : '';

// ---------------------------------------------------------------------------
// REGISTRO DEL QR — lo hace el ADMINISTRADOR DEL COMERCIO
// ---------------------------------------------------------------------------

/** Fecha `aaaa-mm-dd` a milisegundos del final de ese día en Bolivia (UTC−4). */
function finDelDiaBoliviano(fecha: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59) + 4 * 3_600_000;
  return Number.isFinite(t) ? t : null;
}

const DIAS = 24 * 60 * 60 * 1000;

export const registrarQrDeCobro = onCall({ region: REGION }, async (peticion: CallableRequest) => {
  const uid = peticion.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Hay que iniciar sesión.');
  const datos = (peticion.data ?? {}) as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');

  // El QR decide a qué cuenta va la plata de los clientes de ESTE negocio, así
  // que lo registra su administrador y nadie más. Ni el operador, ni NovuChat.
  const nc = (peticion.auth?.token?.['nc'] ?? {}) as { t?: Record<string, string> };
  if ((nc.t ?? {})[tenantId] !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo el administrador del negocio.');
  }

  const cargaUtil = texto(datos['cargaUtil'], 1200);
  const nombreCuenta = texto(datos['nombreCuenta'], 120);
  const banco = texto(datos['banco'], 80);
  const venceEl = texto(datos['venceEl'], 10);
  const cuentaDeclarada = texto(datos['cuentaDeclarada'], 30);
  const aceptaMontoFijo = datos['aceptaMontoFijo'] === true;
  const confirmaReutilizable = datos['confirmaReutilizable'] === true;
  const confirmaMontoAbierto = datos['confirmaMontoAbierto'] === true;

  if (nombreCuenta === '') {
    throw new HttpsError('invalid-argument',
      'Falta el nombre a nombre de quién está la cuenta. Es el dato con el que '
      + 'se compara el comprobante que manda el cliente.');
  }

  // --- Vencimiento -------------------------------------------------------
  // Un QR vencido no cobra, y el modo de fallo es el peor posible: el cliente
  // intenta pagar, no puede, y el negocio se entera por un reclamo.
  const problemas: string[] = [];
  const advertencias: string[] = [];
  const vence = finDelDiaBoliviano(venceEl);
  const ahora = Date.now();
  if (vence === null) {
    problemas.push('Falta la fecha de vencimiento del QR, o no tiene el formato aaaa-mm-dd.');
  } else if (vence <= ahora) {
    problemas.push('Ese QR ya venció. Genera uno nuevo en tu banco, con la fecha más lejana que te permita.');
  } else if (vence - ahora < 30 * DIAS) {
    advertencias.push('Ese QR vence en menos de un mes. Cuando venza, tus clientes no '
      + 'van a poder pagar. Conviene generar uno con la fecha más lejana que permita tu banco.');
  } else if (vence - ahora < 180 * DIAS) {
    advertencias.push('Ese QR vence en menos de seis meses. Te vamos a avisar antes, '
      + 'pero si tu banco permite una fecha más lejana, mejor.');
  }

  // --- El código en sí ---------------------------------------------------
  const resultado = validarQrSimple(cargaUtil, {
    nombreDeclarado: nombreCuenta, cuentaDeclarada,
    confirmaReutilizable, confirmaMontoAbierto, aceptaMontoFijo,
  });
  problemas.push(...resultado.problemas);
  advertencias.push(...resultado.advertencias);

  if (problemas.length > 0) {
    return { registrado: false, problemas, advertencias };
  }

  // Ficha aparte en `/config/venta`, que el comercio NO puede escribir desde el
  // navegador: la lista blanca de las reglas no incluye `cobroReal`. La única
  // puerta es esta función, que es la que valida.
  await db().doc(`tenants/${tenantId}/config/venta`).set({
    cobroReal: {
      // Se registra APAGADO. Encenderlo es un acto aparte y deliberado: entre
      // registrar un QR y empezar a cobrar de verdad con él tiene que haber
      // una decisión, no un efecto secundario de guardar un formulario.
      activo: false,
      cargaUtil,
      nombreCuenta,
      nombreEnElQr: resultado.datos?.nombreEnElQr ?? '',
      // Las cuentas son EL ancla para verificar los comprobantes: en los QR
      // cifrados es la única, porque del código no se puede leer nada.
      cuentas: resultado.datos?.cuentas ?? [],
      familia: resultado.familia ?? '',
      banco,
      venceEl,
      moneda: resultado.datos?.moneda ?? '',
      montoFijo: resultado.datos?.montoFijo ?? null,
      // Ficha pública de la imagen. Va un valor al azar y no el identificador
      // del comercio, para que la dirección de la imagen no se pueda adivinar
      // recorriendo la cartera de clientes.
      ficha: randomBytes(16).toString('hex'),
      registradoPor: uid,
      registradoEn: Timestamp.now(),
    },
  }, { merge: true });

  await db().collection(`tenants/${tenantId}/auditoria`).add({
    accion: 'registrar_qr_cobro', uid, en: Timestamp.now(),
    nombreCuenta, venceEl, banco,
  });

  return { registrado: true, problemas: [], advertencias, datos: resultado.datos };
});

// ---------------------------------------------------------------------------
// LA IMAGEN — la pide WhatsApp, no una persona
// ---------------------------------------------------------------------------

/**
 * Devuelve el PNG del QR de un comercio.
 *
 * ES PÚBLICA A PROPÓSITO: los servidores de Meta tienen que poder descargarla
 * para reenviarla al cliente, y no traen ninguna credencial nuestra. Lo que la
 * protege es que la dirección lleva una ficha al azar de 128 bits, y que lo que
 * hay del otro lado es el mismo QR que el comercio le muestra en el mostrador a
 * cualquiera que entra. No hay nada que filtrar que el comercio no publique.
 *
 * Se sirve por ficha y no por identificador de comercio para que nadie pueda
 * recorrer la cartera de clientes probando nombres.
 */
export const imagenDeCobro = onRequest(
  { region: REGION, cors: false, maxInstances: 10 },
  async (peticion, respuesta) => {
    const ficha = String(peticion.query['f'] ?? '').trim();
    if (!/^[0-9a-f]{32}$/.test(ficha)) { respuesta.status(404).send('no encontrado'); return; }

    const encontrados = await db().collectionGroup('config')
      .where('cobroReal.ficha', '==', ficha).limit(1).get();
    const cobro = encontrados.docs[0]?.get('cobroReal') as
      { cargaUtil?: string; activo?: boolean } | undefined;
    if (!cobro?.cargaUtil || cobro.activo !== true) {
      respuesta.status(404).send('no encontrado'); return;
    }

    // Se vuelve a validar antes de dibujar. Es redundante —se validó al
    // registrarlo— y va igual: es la última compuerta antes de que una persona
    // le transfiera dinero a alguien, y el costo es de microsegundos.
    if (!validarQrSimple(cobro.cargaUtil, { aceptaMontoFijo: true }).valido) {
      respuesta.status(409).send('el codigo guardado ya no es valido'); return;
    }

    const png = dibujarQr(cobro.cargaUtil);
    respuesta.set('Content-Type', 'image/png');
    respuesta.set('Cache-Control', 'public, max-age=300');
    respuesta.set('X-Content-Type-Options', 'nosniff');
    respuesta.status(200).send(png);
  },
);
