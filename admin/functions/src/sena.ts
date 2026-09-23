import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { REGION } from './region.js';
import { SECRETOS_POR_ALIAS, enmascarar, rutaAutenticada } from './firma.js';
import {
  cotejarComprobante as cotejar, parsearMonto, type Cotejo, type Esperado, type Leido,
} from './cotejo.js';
import { registrar, MINUTOS_RETENCION_POR_DEFECTO, type Solicitud } from './ingesta.js';
import { documentoDeVertical } from './prompt.js';
import { periodoDe } from './planes.js';
import { comprobanteEnRevision, marcaMs, senaVencidaPorTiempo } from './retencion.js';
import {
  detalleDeLaVenta, esperadoDeLaVenta, idDeCierreDeVenta, qrDeVentaVencido, totalUtilizable,
} from './cobroVenta.js';

/**
 * =============================================================================
 * SEÑA POR QR EN LAS RESERVAS — el cotejo del comprobante y la retención vencida
 * =============================================================================
 *
 * EL PROBLEMA QUE RESUELVE (`Analisis/30` §4). Una clínica pierde horarios con
 * pacientes que reservan y no van. La seña —una fracción del tratamiento,
 * pagada por QR al reservar— los filtra. Pero introduce dinero real en el
 * chat, y con el dinero real entra la prohibición 3 de CLAUDE.md: el
 * asistente NUNCA dice que un pago está acreditado, verificado ni recibido.
 * Un comprobante es una imagen, y una imagen se edita.
 *
 * QUIÉN DECIDE QUÉ, y por qué está repartido así:
 *
 *  - EL FLUJO lee el comprobante con el modelo y manda acá lo leído (importe,
 *    cuenta, nombre, fecha, hora, banco). No compara nada. Si comparara, la
 *    regla viviría en un nodo de n8n que nadie prueba y que se edita a mano.
 *  - EL SERVIDOR (esta Function) compara con lo esperado —el importe de la
 *    seña, las cuentas del QR del comercio, la hora en que se envió el QR— y
 *    devuelve uno de tres resultados: `cuadra`, `no_cuadra`, `ilegible`.
 *    Ninguno se llama «pagado». Es la regla de CLAUDE.md §7: todo límite se
 *    hace cumplir en el servidor.
 *  - LA CLÍNICA confirma que el dinero entró, mirando su banco, con el sello
 *    `comprobadoPor` del cierre (regla `/cierres`). Ni el flujo ni este código
 *    pueden ponerlo.
 *
 * QUÉ SE GUARDA Y QUÉ NO. El JSON leído y el resultado, en el cierre. NUNCA la
 * imagen ni el PDF: no van a Storage ni a Firestore. Guardar comprobantes
 * bancarios de terceros es acumular datos financieros que NovuChat no
 * necesita para nada.
 *
 * LA RETENCIÓN VENCIDA (`senaVencida`) es el otro extremo: pasaron los
 * minutos sin comprobante, el flujo programado borró la cita del calendario y
 * lo reporta acá. Esta Function NO manda nada al paciente —ni mensaje ni
 * plantilla—: un mensaje costaría 0,0113 USD por retención vencida y además
 * provocaría el reclamo que se quiere evitar. Solo anota el estado y cuenta.
 */

/** Recorta y normaliza un texto que vino de afuera. Igual que en `cierres.ts`. */
function texto(valor: unknown, maxLargo: number): string {
  return typeof valor === 'string' ? valor.trim().slice(0, maxLargo) : '';
}

/**
 * Identificador del cierre a partir de la referencia externa. ES LA MISMA
 * CUENTA que `idDesdeReferencia` de `cierres.ts` —tipo, guion bajo, referencia
 * saneada a `[a-zA-Z0-9_-]` y recortada— y tiene que seguir siéndolo: el
 * cierre de una cita con seña y el que registraría `registrarCierre` para la
 * misma cita tienen que caer en el MISMO documento, o la cita se contaría dos
 * veces. `pruebas/sena-cotejo.test.ts` compara las dos.
 */
export function idDeCierreDeCita(referencia: string): string {
  return `cita_${referencia.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120)}`;
}

export type ResultadoCotejo = 'cuadra' | 'no_cuadra' | 'ilegible';

/** Lo que se le dice al flujo y lo que queda en el cierre. */
export interface Veredicto {
  resultado: ResultadoCotejo;
  diferencias: string[];
}

export const MINUTOS_TOLERANCIA_RELOJ = 10;
export const NO_SE_PUDO_LEER = 'No se pudo leer el comprobante.';

/**
 * De lo que leyó el modelo y lo que comparó `cotejo.ts`, el veredicto.
 *
 * ES PURA. Sobre esto se le dice a un paciente si su reserva quedó o no, y se
 * le avisa a la clínica que revise el banco: la decisión se prueba sin
 * emulador, resultado por resultado, y se comprueba con una expresión regular
 * que ninguna frase que sale de acá afirme un pago (prohibición 3).
 *
 * `legible` es falso cuando el modelo no devolvió un objeto, o lo devolvió
 * vacío. Un comprobante ilegible NO es un comprobante que no cuadra: al
 * paciente se le pide que lo mande de nuevo, no se le dice que hay un dato
 * distinto. Por eso son tres resultados y no dos.
 */
export function resultadoDelCotejo(legible: boolean, cotejo: Cotejo | null): Veredicto {
  if (!legible || cotejo === null) {
    return { resultado: 'ilegible', diferencias: [NO_SE_PUDO_LEER] };
  }
  if (cotejo.consistente) return { resultado: 'cuadra', diferencias: [] };
  return { resultado: 'no_cuadra', diferencias: cotejo.diferencias.slice(0, 10) };
}

/**
 * Lo que se ESPERA del comprobante, armado desde la configuración y la
 * solicitud. Pura, para poder probar que el importe es el de la seña —y no el
 * del tratamiento— y que la ventana de fechas va desde el envío del QR hasta
 * la llegada del comprobante, con los minutos de gracia de reloj.
 */
export function esperadoDeLaSena(
  senaImporte: number,
  cobroReal: Record<string, unknown> | undefined,
  qrEnviadoEnMs: number,
  ahoraMs: number,
): Esperado {
  const cuentas = Array.isArray(cobroReal?.['cuentas'])
    ? (cobroReal['cuentas'] as unknown[]).slice(0, 5).map(String) : [];
  return {
    monto: senaImporte,
    nombreCuenta: String(cobroReal?.['nombreCuenta'] ?? ''),
    cuentas,
    qrEnviadoEn: qrEnviadoEnMs,
    comprobanteRecibidoEn: ahoraMs,
    toleranciaMin: MINUTOS_TOLERANCIA_RELOJ,
  };
}

/**
 * Lo que leyó el modelo, saneado. TODO es dato no confiable: lo produjo un
 * modelo a partir de una imagen que mandó un cliente final. Se recorta, se
 * tipa y se compara; nunca se interpola ni se guarda entero.
 */
export function leidoDelCuerpo(crudo: unknown): Leido {
  const l = (typeof crudo === 'object' && crudo !== null ? crudo : {}) as Record<string, unknown>;
  const monto = typeof l['monto'] === 'number' && Number.isFinite(l['monto'])
    ? l['monto'] : texto(l['monto'], 40);
  return {
    monto,
    cuentaDestino: texto(l['cuentaDestino'], 60),
    nombreCuenta: texto(l['nombreCuenta'], 120),
    fecha: texto(l['fecha'], 40),
    hora: texto(l['hora'], 20),
  };
}

/** La frase del detalle privado del cierre, por resultado. Sin «acreditado». */
export function detalleDeLaSena(importe: number, moneda: string, resultado: ResultadoCotejo): string {
  const palabra = resultado === 'cuadra' ? 'los datos coinciden'
    : resultado === 'no_cuadra' ? 'con una diferencia' : 'ilegible';
  return `Seña de ${importe} ${moneda === 'BOB' ? 'Bs' : moneda}, comprobante ${palabra}`;
}

const TELEFONO = /^[0-9]{8,15}$/;

// La ventana de revisión, la marca de tiempo y el vencimiento por reloj viven
// en `retencion.ts`: los necesita también `ingesta.ts`, que no puede importar
// de acá (este archivo ya importa de ella).
export { MINUTOS_DE_REVISION, comprobanteEnRevision } from './retencion.js';

/**
 * Lo que decide la transacción de `senaVencida`. Va escrito porque las ramas
 * devuelven formas distintas --con motivo o sin él, con `conComprobante` o sin
 * él-- y sin el tipo, TypeScript infiere una unión donde `motivo` no existe en
 * todas: el `tsc -b` del pipeline no compila, aunque `--noEmit` pase.
 */
interface SalidaDeVencimiento {
  registrado: boolean;
  repetido: boolean;
  motivo?: string;
  /** Se liberó un horario por el que alguien había mandado un comprobante. */
  conComprobante?: boolean;
}

/** La forma mínima de la solicitud que estas Functions miran. */
type SolicitudGuardada = Partial<Solicitud> & { qrEnviadoEn?: { toMillis?: () => number } | null };

function solicitudDe(conversacion: { get(campo: string): unknown }): SolicitudGuardada | null {
  const s = conversacion.get('solicitud');
  return typeof s === 'object' && s !== null ? (s as SolicitudGuardada) : null;
}

// ---------------------------------------------------------------------------
// COTEJAR EL COMPROBANTE
// ---------------------------------------------------------------------------

export const cotejarComprobante = onRequest(
  {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    // Servidor a servidor, como la ingesta: sin CORS.
    cors: false,
    maxInstances: 10,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    // El comercio sale de la firma o del token del número, NUNCA del cuerpo.
    const ruta = await rutaAutenticada(peticion);
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }
    if (ruta.estado !== 'activo') { respuesta.status(409).json({ estado: ruta.estado }); return; }

    const cuerpo = (typeof peticion.body === 'object' && peticion.body !== null
      ? peticion.body : {}) as Record<string, unknown>;
    const telefono = texto(cuerpo['telefono'], 25);
    if (!TELEFONO.test(telefono)) { respuesta.status(400).json({ error: 'telefono invalido' }); return; }
    const legible = cuerpo['legible'] === true;
    const leido = leidoDelCuerpo(cuerpo['leido']);
    const idMeta = texto(cuerpo['idMeta'], 120);
    const banco = texto((cuerpo['leido'] as Record<string, unknown> | undefined)?.['banco'], 80);

    const db = getFirestore();
    const { tenantId } = ruta;
    const docVertical = documentoDeVertical(ruta.flujo || 'agendamiento') ?? 'agendamiento';
    const idConversacion = `wa_${telefono}`;
    const refConversacion = db.doc(`tenants/${tenantId}/conversaciones/${idConversacion}`);
    const refMetricas = db.doc(`tenants/${tenantId}/metricas/${periodoDe()}`);
    const ahoraMs = Date.now();

    // La configuración se lee fuera de la transacción: no cambia con el cotejo
    // y leerla adentro solo alargaría el bloqueo de la conversación.
    const [especifica, negocio] = await Promise.all([
      db.doc(`tenants/${tenantId}/config/${docVertical}`).get(),
      db.doc(`tenants/${tenantId}/config/negocio`).get(),
    ]);
    // ¿RESERVA O VENTA? Es la única bifurcación de esta Function, y cambia una
    // sola cosa: DE DÓNDE SALE EL IMPORTE ESPERADO. En una reserva es la seña,
    // fija, escrita en la configuración del comercio; en una venta es el total
    // del pedido, que se fijó cuando salió el QR y vive en `solicitud.monto`
    // (`cobroVenta.ts`). Todo lo demás —quién coteja, qué se guarda, qué se
    // responde y qué NO se dice nunca— es idéntico, y tiene que seguir
    // siéndolo: son el mismo problema.
    const esVenta = docVertical === 'venta';
    const importeCrudo = especifica.get('senaImporte');
    const importe = typeof importeCrudo === 'number' && Number.isInteger(importeCrudo) && importeCrudo > 0
      ? importeCrudo : 0;
    const moneda = String(negocio.get('moneda') ?? 'BOB');
    const cobroReal = especifica.get('cobroReal') as Record<string, unknown> | undefined;

    // TODO EN UNA TRANSACCIÓN: el cierre, su detalle privado, el contador del
    // mes y la solicitud. Si se escribiera el cierre y fallara la solicitud, el
    // paciente vería «los datos coinciden» y el siguiente archivo que mandara
    // se volvería a cotejar como pago. Y al revés, una solicitud cerrada sin
    // cierre es una seña que la clínica nunca ve en su pantalla de cobros.
    const salida = await db.runTransaction(async (tx) => {
      const conversacion = await tx.get(refConversacion);
      const solicitud = solicitudDe(conversacion);
      if (!conversacion.exists || solicitud?.etapa !== 'qr_enviado') {
        // Sin QR pendiente no hay con qué comparar: la imagen es una imagen.
        return { codigo: 409 as const, cuerpo: { error: 'sin_sena_pendiente' } };
      }
      // LA SEÑA VENCIDA POR RELOJ NO SE COTEJA (Andres, 20/09/2026: la reserva
      // pendiente de pago se suelta a los 15 minutos, es la regla). Antes solo la
      // vencía el flujo del calendario, y si la cita no coincidía la seña quedaba
      // pendiente para siempre y cualquier imagen se cotejaba como pago. Se deja
      // anotada como vencida acá mismo, contada una vez; el flujo ve entonces un
      // pago TARDÍO y lo pasa a una persona, que es lo que corresponde.
      const minutosPedidos = especifica.get('senaMinutosRetencion');
      const minutosRet = typeof minutosPedidos === 'number' && Number.isInteger(minutosPedidos)
        && minutosPedidos >= 5 && minutosPedidos <= 180 ? minutosPedidos : MINUTOS_RETENCION_POR_DEFECTO;
      // EN VENTA EL PLAZO ES OTRO y la razón es distinta: no hay horario
      // bloqueado que otro cliente quiera, así que el QR vive las 24 h de la
      // ventana de la conversación (`MINUTOS_QR_VENTA`). Lo que sí se conserva
      // es que CADUQUE: un pendiente eterno convierte cualquier imagen en un
      // pago, que es el defecto que este cambio viene a cerrar.
      const porReloj = esVenta
        ? (() => { const v = qrDeVentaVencido(solicitud, ahoraMs);
                   return { vencida: v.vencido, venceMs: v.venceMs }; })()
        : senaVencidaPorTiempo(solicitud, minutosRet, ahoraMs);
      if (porReloj.vencida) {
        tx.set(refConversacion, {
          solicitud: { ...solicitud, etapa: 'vencida', desde: Timestamp.fromMillis(porReloj.venceMs ?? ahoraMs) },
        }, { merge: true });
        tx.set(refMetricas, esVenta
          ? { cobrosVencidos: FieldValue.increment(1) }
          : { senasVencidas: FieldValue.increment(1) }, { merge: true });
        return { codigo: 409 as const, cuerpo: { error: 'sin_sena_pendiente' } };
      }

      // EL IMPORTE ESPERADO. Acá está toda la diferencia entre los dos
      // verticales, y está escrita una sola vez.
      //
      // En VENTA es el total que se cotizó al mandar el QR. Si el pedido vino
      // del carrito web, el total que manda es el del PEDIDO —lo calculó el
      // servidor, con el costo de envío incluido, y no pasó por el navegador ni
      // por el modelo—; si no, el que el flujo reportó junto al QR.
      let esperado = importe;
      const pedidoId = String(solicitud.evento?.id ?? '').trim();
      if (esVenta) {
        let delPedido: number | null = null;
        if (pedidoId.startsWith('cat_')) {
          const pedido = await tx.get(db.doc(`tenants/${tenantId}/pedidos/${pedidoId}`));
          delPedido = pedido.exists ? totalUtilizable(pedido.get('total')) : null;
        }
        esperado = delPedido ?? totalUtilizable(solicitud.monto) ?? 0;
      }
      if (esperado <= 0) {
        // Sin importe no se coteja contra cero: con cero, el flujo le diría al
        // cliente «el comprobante dice 350 y el pedido es de 0», que es un
        // motivo falso. En reservas, la seña se apagó entre el QR y el
        // comprobante; en venta, el total no llegó o no es utilizable. En los
        // dos casos lo resuelve una persona, y se lo dice tal cual.
        return { codigo: 409 as const, cuerpo: { error: esVenta ? 'sin_total' : 'sena_inactiva' } };
      }

      const eventoId = pedidoId;
      // La referencia externa del cierre: la cita retenida —o el pedido, en
      // venta—; si no la hubiera, el mensaje del comprobante, que también es
      // una prueba verificable (`cierres.ts`, defensa 1). Sin ninguna de las
      // dos no hay cierre.
      const referencia = eventoId || idMeta;
      if (!referencia) return { codigo: 400 as const, cuerpo: { error: 'falta referencia' } };

      const qrEnviadoEn = typeof solicitud.qrEnviadoEn?.toMillis === 'function'
        ? solicitud.qrEnviadoEn.toMillis() : ahoraMs;
      const cotejo = legible
        ? cotejar(esVenta
            ? esperadoDeLaVenta(esperado, cobroReal, qrEnviadoEn, ahoraMs, MINUTOS_TOLERANCIA_RELOJ)
            : esperadoDeLaSena(esperado, cobroReal, qrEnviadoEn, ahoraMs), leido)
        : null;
      const veredicto = resultadoDelCotejo(legible, cotejo);
      const intentos = (typeof solicitud.cotejos === 'number' ? solicitud.cotejos : 0) + 1;

      const idCierre = esVenta ? idDeCierreDeVenta(referencia) : idDeCierreDeCita(referencia);
      const refCierre = db.doc(`tenants/${tenantId}/cierres/${idCierre}`);
      const previo = await tx.get(refCierre);

      // Lo leído, como número, para que la pantalla de cobros muestre «dice
      // 40 y la seña es 50» sin volver a interpretar el texto del banco.
      const montoLeido = legible ? parsearMonto(String(leido.monto ?? '')) : null;
      const registroCotejo = {
        resultado: veredicto.resultado,
        diferencias: veredicto.diferencias,
        montoLeido,
        banco,
        idMeta,
        intentos,
        en: Timestamp.fromMillis(ahoraMs),
      };

      if (previo.exists) {
        // Segundo comprobante para la misma cita: se reescribe el cotejo y
        // nada más. El cierre ya se contó; no se cuenta dos veces.
        tx.update(refCierre, { cotejo: registroCotejo });
      } else {
        tx.set(refCierre, {
          tipo: esVenta ? 'venta' : 'cita',
          ocurridoEn: Timestamp.fromMillis(ahoraMs),
          referencia,
          telefonoEnmascarado: enmascarar(telefono),
          monto: esperado,
          moneda,
          cotejo: registroCotejo,
        });
        // El detalle que identifica a la persona: del negocio, y de nadie más.
        // `conversacionId` es el teléfono completo y por eso va acá y no arriba.
        const nombre = texto(conversacion.get('nombreContacto'), 120);
        tx.set(refCierre.collection('privado').doc('datos'), {
          telefono,
          conversacionId: idConversacion,
          ...(nombre ? { nombreCliente: nombre } : {}),
          detalle: esVenta
            ? detalleDeLaVenta(esperado, moneda, veredicto.resultado)
            : detalleDeLaSena(esperado, moneda, veredicto.resultado),
        });
      }

      tx.set(refMetricas, {
        ...(esVenta ? { cobrosCotejados: FieldValue.increment(1) }
          : { senasCotejadas: FieldValue.increment(1) }),
        ...(previo.exists ? {} : { cierres: FieldValue.increment(1) }),
      }, { merge: true });

      // La solicitud avanza SOLO si cuadra. Si no cuadra o es ilegible sigue
      // en `qr_enviado`: el próximo archivo se vuelve a cotejar, y la
      // retención sigue corriendo para `senaVencida`.
      tx.set(refConversacion, {
        solicitud: {
          ...solicitud,
          cotejos: intentos,
          ...(veredicto.resultado === 'cuadra'
            ? { etapa: 'agendada', desde: Timestamp.fromMillis(ahoraMs) } : {}),
        },
      }, { merge: true });

      return {
        codigo: 200 as const,
        cuerpo: {
          resultado: veredicto.resultado,
          diferencias: veredicto.diferencias,
          // El importe contra el que se cotejó: la seña, o el total del pedido.
          // El flujo lo repite en el aviso al negocio, así que tiene que ser el
          // que se usó, no el de la configuración.
          importe: esperado,
          moneda,
          evento: solicitud.evento ?? null,
          cierreId: idCierre,
        },
      };
    });

    if (salida.codigo === 200) {
      await registrar(tenantId, {
        tipo: 'cobro_cotejado', resultado: 'ok', telefono, conversacionId: idConversacion,
        codigo: salida.cuerpo.resultado,
      });
    }
    respuesta.status(salida.codigo).json(salida.cuerpo);
  },
);

// ---------------------------------------------------------------------------
// LA RETENCIÓN VENCIÓ
// ---------------------------------------------------------------------------

export const senaVencida = onRequest(
  {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    cors: false,
    maxInstances: 10,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    const ruta = await rutaAutenticada(peticion);
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }
    if (ruta.estado !== 'activo') { respuesta.status(409).json({ estado: ruta.estado }); return; }

    const cuerpo = (typeof peticion.body === 'object' && peticion.body !== null
      ? peticion.body : {}) as Record<string, unknown>;
    const telefono = texto(cuerpo['telefono'], 25);
    const referencia = texto(cuerpo['referencia'], 200);
    if (!TELEFONO.test(telefono) || !referencia) {
      respuesta.status(400).json({ error: 'faltan telefono o referencia' }); return;
    }
    // CUÁNDO SE CREÓ LA CITA, según Google, y cuánto se retiene. El flujo ya
    // filtró por tiempo, pero esto se vuelve a exigir acá: un límite que solo
    // vive en el flujo no existe (CLAUDE.md §7), y lo que se autoriza es
    // BORRAR la cita de un cliente.
    const creadoEnMs = Date.parse(texto(cuerpo['creadoEn'], 40));
    const minutosPedidos = Number(cuerpo['minutosRetencion']);
    const minutosRetencion = Number.isInteger(minutosPedidos)
      && minutosPedidos >= 5 && minutosPedidos <= 180 ? minutosPedidos : MINUTOS_RETENCION_POR_DEFECTO;

    const db = getFirestore();
    const { tenantId } = ruta;
    const idConversacion = `wa_${telefono}`;
    const refConversacion = db.doc(`tenants/${tenantId}/conversaciones/${idConversacion}`);
    const refMetricas = db.doc(`tenants/${tenantId}/metricas/${periodoDe()}`);
    const refCierreDeLaCita = db.doc(`tenants/${tenantId}/cierres/${idDeCierreDeCita(referencia)}`);
    const ahoraMs = Date.now();

    // IDEMPOTENTE POR CONSTRUCCIÓN: el flujo programado corre cada diez
    // minutos y puede reportar dos veces la misma cita si el borrado falló a
    // medias. Solo la PRIMERA vez mueve algo; la segunda ve `vencida` y
    // contesta `repetido`, sin contar de nuevo.
    const salida = await db.runTransaction(async (tx): Promise<SalidaDeVencimiento> => {
      const conversacion = await tx.get(refConversacion);
      const solicitud = solicitudDe(conversacion);
      const mismaCita = String(solicitud?.evento?.id ?? '') === referencia;
      if (!conversacion.exists || !solicitud || !mismaCita) {
        // --- LA CITA HUÉRFANA (decisión de Andres, 20/09/2026) --------------
        // Una cita con el rótulo «PENDIENTE DE SEÑA» y SIN seña pendiente en
        // el servidor es un horario bloqueado que nadie va a pagar: pasa
        // cuando el QR no llegó a salir, que es justo lo que ocurrió el 20/09.
        // Antes se dejaba ahí para siempre, porque el servidor no autorizaba
        // borrarla y el flujo obedece.
        //
        // PERO NO SE BORRA A CIEGAS. Si esa cita YA SE PAGÓ y lo que falló fue
        // quitarle el rótulo, borrarla destruiría una cita paga: por eso se
        // mira el cierre. Con un cotejo que cuadró, NO se autoriza y queda
        // dicho por qué, para que lo vea una persona.
        const cierre = await tx.get(refCierreDeLaCita);
        const cotejo = cierre.get('cotejo') as { resultado?: unknown } | undefined;
        if (cotejo?.resultado === 'cuadra') {
          return { registrado: false, repetido: false, motivo: 'cita_pagada' };
        }
        // UNA HUÉRFANA CON COMPROBANTE TAMBIÉN TIENE MOTIVO (Andres, 20/09).
        // Que el servidor no retenga la seña no quiere decir que no haya nadie
        // esperando: si hay cotejo, alguien mandó un comprobante. Se protege
        // mientras una persona puede resolverlo, y después se libera igual,
        // contada aparte para que se vea que hubo un pago reclamado.
        if (comprobanteEnRevision(cotejo, ahoraMs, creadoEnMs)) {
          return { registrado: false, repetido: false, motivo: 'comprobante_en_revision' };
        }
        const conComprobante = typeof cotejo?.resultado === 'string';
        // Y el tiempo se exige acá también: sin saber cuándo se creó, o si
        // todavía no pasó la retención, no se autoriza nada.
        //
        // EL MOTIVO NO PUEDE SER `sin_sena_pendiente` (2026-09-20). Ese motivo
        // está en la lista con la que el flujo SÍ borra --viene de antes de las
        // huérfanas, cuando significaba «el servidor ya no la retiene»--, así
        // que este «todavía no» terminaba en un borrado, y la comprobación de
        // tiempo no protegía nada: solo la salvaba el filtro previo del flujo.
        if (!Number.isFinite(creadoEnMs)) {
          return { registrado: false, repetido: false, motivo: 'sin_fecha_de_creacion' };
        }
        if ((ahoraMs - creadoEnMs) < minutosRetencion * 60 * 1000) {
          return { registrado: false, repetido: false, motivo: 'todavia_no_vence' };
        }
        tx.set(refMetricas, {
          senasHuerfanas: FieldValue.increment(1),
          ...(conComprobante ? { senasHuerfanasConComprobante: FieldValue.increment(1) } : {}),
        }, { merge: true });
        return { registrado: true, repetido: false, motivo: 'huerfana',
          ...(conComprobante ? { conComprobante: true } : {}) };
      }
      if (solicitud.etapa === 'vencida') return { registrado: false, repetido: true };
      if (solicitud.etapa !== 'qr_enviado') {
        // Ya se agendó (el comprobante cuadró): no hay nada que vencer, y el
        // flujo NO debería haber borrado la cita. Se contesta con el motivo
        // para que quede a la vista en el registro de n8n.
        return { registrado: false, repetido: false, motivo: 'ya_agendada' };
      }
      // --- UN COMPROBANTE EN REVISIÓN NO VENCE (2026-09-20) -----------------
      // Prueba real con el teléfono: el paciente pagó 1 Bs de verdad, mandó el
      // comprobante, y el cotejo dijo «no cuadra» porque no entendió la fecha
      // --«20 de Septiembre, 2026»--. El flujo le contestó, con toda razón,
      // «lo va a revisar una persona; tu horario sigue reservado mientras
      // tanto», y a recepción «la cita sigue retenida, revisar el banco». Y
      // este endpoint, cinco minutos después, autorizaba BORRARLA: solo miraba
      // la etapa, y un cotejo que no cuadra no la cambia.
      //
      // La retención existe para quien NO pagó. Quien mandó un comprobante,
      // cuadre o no, está esperando a una persona, y la decisión es de esa
      // persona: borrarle el turno a alguien que pagó por un error de lectura
      // nuestro es lo peor que puede pasar acá. Si el comprobante era falso,
      // recepción lo ve y borra la cita a mano.
      const cierreDeLaCita = await tx.get(refCierreDeLaCita);
      const cotejoDeLaCita = cierreDeLaCita.get('cotejo') as { resultado?: unknown; en?: unknown } | undefined;
      const hayComprobante = (typeof solicitud.cotejos === 'number' && solicitud.cotejos > 0)
        || typeof cotejoDeLaCita?.resultado === 'string';
      // La MISMA ventana que la huérfana: mientras una persona puede resolver,
      // la cita se protege; después vence igual, y queda contada aparte.
      if (hayComprobante && comprobanteEnRevision(
        cotejoDeLaCita ?? { resultado: 'no_cuadra' }, ahoraMs, marcaMs(solicitud.qrEnviadoEn))) {
        return { registrado: false, repetido: false, motivo: 'comprobante_en_revision' };
      }
      tx.set(refConversacion, {
        solicitud: { ...solicitud, etapa: 'vencida', desde: Timestamp.fromMillis(ahoraMs) },
      }, { merge: true });
      tx.set(refMetricas, {
        senasVencidas: FieldValue.increment(1),
        ...(hayComprobante ? { senasVencidasConComprobante: FieldValue.increment(1) } : {}),
      }, { merge: true });
      return { registrado: true, repetido: false, ...(hayComprobante ? { conComprobante: true } : {}) };
    });

    if (salida.registrado) {
      await registrar(tenantId, {
        tipo: 'sena_vencida', resultado: 'ok', telefono, conversacionId: idConversacion,
        // Una huérfana se libera igual, pero queda dicho que lo era: no hubo
        // nadie esperando para pagar, y eso explica el horario recuperado.
        ...(salida.motivo === 'huerfana' ? { codigo: 'huerfana' } : {}),
        // LO QUE HAY QUE IR A MIRAR: se liberó un horario por el que alguien
        // mandó un comprobante. No es lo mismo que uno que nadie pagó nunca.
        ...(salida.conComprobante ? { codigo: 'liberada_con_comprobante' } : {}),
      });
    }
    // Y lo que NO se autorizó porque la cita ya estaba paga se anota también:
    // es un rótulo que quedó puesto de más, y alguien tiene que mirarlo.
    if (!salida.registrado && salida.motivo === 'cita_pagada') {
      await registrar(tenantId, {
        tipo: 'sena_vencida', resultado: 'rechazado', telefono, conversacionId: idConversacion,
        codigo: 'cita_pagada_con_rotulo',
      });
    }
    // NUNCA se manda nada al paciente desde acá: ni mensaje ni plantilla.
    respuesta.status(200).json(salida);
  },
);
