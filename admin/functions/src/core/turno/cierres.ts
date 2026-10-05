import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { REGION } from '../region.js';
import { SECRETOS_POR_ALIAS, enmascarar, rutaAutenticada } from '../seguridad/firma.js';

/**
 * =============================================================================
 * REGISTRO DE CIERRES — el endpoint que llama n8n cuando algo TERMINÓ BIEN
 * =============================================================================
 *
 * Un cierre NO se factura: desde el 13/09/2026 la unidad de cobro es la
 * conversación (`docs/base-comercial.md` §2; los comentarios que decían lo
 * contrario se corrigieron el 03/10). El cierre es el registro verificable de
 * lo que terminó bien —el indicador de Consumo y, en Cobros, el respaldo del
 * importe que el comercio cobró a su cliente—, y por eso tiene que ser exacto:
 * un indicador inflado o un importe duplicado se discuten con el comercio igual
 * que una factura.
 *
 * TRES DEFENSAS CONTRA CONTAR DE MÁS, en orden de importancia:
 *
 *  1. REFERENCIA OBLIGATORIA. Sin un identificador de algo externo que lo
 *     pruebe —el evento del calendario, el mensaje del comprobante, la fila de
 *     la planilla— no hay cierre. Es lo que deja afuera los casos que no
 *     terminaron bien: mandar información que nadie confirmó, mandar el QR sin
 *     que el cliente pague, una conversación incompleta.
 *
 *  2. IDEMPOTENCIA POR REFERENCIA. El identificador del documento se DERIVA de
 *     la referencia, no se genera al azar. Si n8n reintenta —y n8n reintenta:
 *     el flujo tiene reintentos configurados— el segundo intento escribe sobre
 *     el mismo documento y el contador no se mueve. Sin esto, un error de red
 *     transitorio cuenta dos veces el mismo cierre, y es el tipo de defecto que
 *     descubre el comercio mirando Consumo y no la prueba.
 *
 *  3. EL TENANT SALE DE LA FIRMA. Nunca del cuerpo. Un flujo mal configurado
 *     —o alguien con el secreto de un comercio— no puede anotarle un cierre a
 *     otro negocio.
 *
 * PRIVACIDAD. El documento que NovuChat puede leer lleva el teléfono
 * ENMASCARADO y ni una palabra de la conversación. Lo que identifica a la
 * persona va a `/privado`, que solo abre el administrador del negocio.
 */

const TIPOS = new Set(['cita', 'venta', 'registro']);

/** Recorta y normaliza un texto que vino de afuera. */
function texto(valor: unknown, maxLargo: number): string {
  return typeof valor === 'string' ? valor.trim().slice(0, maxLargo) : '';
}

/**
 * Identificador estable del documento a partir de la referencia externa.
 *
 * Se sanea a `[a-zA-Z0-9_-]` porque un id de Firestore no admite barras: un
 * identificador de evento de Google con una `/` partiría la ruta y escribiría
 * en una subcolección inesperada.
 */
function idDesdeReferencia(tipo: string, referencia: string): string {
  const limpio = referencia.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
  return `${tipo}_${limpio}`;
}

/**
 * Una lectura de SOLO LECTURA de un documento del tenant que firmó la llamada.
 * `rutaRelativa` es `<colección>/<documento>` (por ejemplo `config/venta`) y
 * Core la ancla bajo `tenants/<tenant de la firma>/` con `rutaDelTenant`.
 *
 * POR QUÉ UN LECTOR Y NO LA `Transaction` NI `db`: un gancho que recibe la
 * transacción puede escribir en ella (y en cualquier tenant, con `db`), y
 * Firestore reintenta la transacción entera cuando hay contención: un gancho con
 * efectos se ejecutaría dos veces. El gancho decide, Core escribe.
 */
export type LeerDelTenant = (rutaRelativa: string) => Promise<FirebaseFirestore.DocumentSnapshot>;

/**
 * LO QUE COBROS APORTA AL CIERRE: cuándo el cierre de una venta no lo hace este
 * endpoint sino el cotejo del comprobante (cobro REAL de regla 2).
 */
export interface GanchoDeCobroAlCierre {
  /** ¿El comercio tiene cobro real encendido, con ficha y código? Lee `config/venta` por el lector dado. */
  cobroRealActivo(leer: LeerDelTenant): Promise<boolean>;
  /** ¿El cierre de una venta con cobro real lo debe hacer solo el cotejo? Pura sobre la `solicitud` previa. */
  cierreDeVentaLoHaceElCotejo(previa: unknown, ahoraMs: number): boolean;
}

/** LO QUE AGENDA APORTA AL CIERRE: qué `solicitud` queda tras un cierre de cita. `null` = no se toca. Pura. */
export interface GanchoDeSolicitudAlCierre {
  solicitudTrasElCierre(previa: unknown, ahoraMs: number, datos: { readonly cobroReal: boolean }): object | null;
}

/**
 * LOS DOS PUERTOS DEL CIERRE, OBLIGATORIOS Y SIN VALORES POR DEFECTO.
 *
 * Sin campos opcionales a propósito: un gancho olvidado no es «un cierre sin
 * solicitud», es un cierre que deja de cerrar la solicitud en silencio y
 * entonces el barrido de seguimientos le escribe a quien ya agendó. Por eso
 * olvidarlo no compila (`satisfies GanchosDelCierre` en `ganchos.ts`), y si de
 * todos modos llega vacío en ejecución, `crearRegistrarCierre` lanza AL CARGAR,
 * antes de que exista el endpoint. Lista cerrada de dos puertos, no una lista
 * genérica de módulos: eso es F3b-2 y exige `tenants.modulos`.
 */
export interface GanchosDelCierre {
  readonly cobro: GanchoDeCobroAlCierre;
  readonly solicitud: GanchoDeSolicitudAlCierre;
}

const FORMA_DE_RUTA_RELATIVA = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;

/**
 * La ruta COMPLETA de un documento del tenant que firmó, a partir de la
 * relativa que pidió un gancho. Solo acepta `<colección>/<documento>` con
 * `[A-Za-z0-9_-]`: un gancho no puede salirse del tenant (`../otro/x`), ni
 * pedir una subcolección ni un documento con barras. Cualquier otra forma lanza.
 */
export function rutaDelTenant(tenantId: string, rutaRelativa: string): string {
  if (typeof rutaRelativa !== 'string' || !FORMA_DE_RUTA_RELATIVA.test(rutaRelativa)) {
    throw new Error('rutaDelTenant: la ruta relativa debe ser <colección>/<documento> con letras, números, «_» o «-»');
  }
  return `tenants/${tenantId}/${rutaRelativa}`;
}

/**
 * Comprueba que cada función de cada puerto exista. Lanza al cargar, nombrando
 * lo que falta, y devuelve las funciones YA CAPTURADAS (ligadas a su puerto):
 * mutar el objeto de ganchos después de crear el endpoint no cambia nada.
 */
function capturarGanchos(ganchos: GanchosDelCierre) {
  const funcion = (puerto: 'cobro' | 'solicitud', nombre: string): ((...a: never[]) => unknown) => {
    const objeto = (ganchos as unknown as Record<string, Record<string, unknown> | undefined> | undefined)?.[puerto];
    const f = objeto?.[nombre];
    if (typeof f !== 'function') throw new Error(`registrarCierre: falta el gancho ${puerto}.${nombre}`);
    return (f as (...a: never[]) => unknown).bind(objeto);
  };
  return {
    cobroRealActivo: funcion('cobro', 'cobroRealActivo') as GanchoDeCobroAlCierre['cobroRealActivo'],
    loHaceElCotejo: funcion('cobro', 'cierreDeVentaLoHaceElCotejo') as GanchoDeCobroAlCierre['cierreDeVentaLoHaceElCotejo'],
    solicitudTrasElCierre: funcion('solicitud', 'solicitudTrasElCierre') as GanchoDeSolicitudAlCierre['solicitudTrasElCierre'],
  };
}

/**
 * El endpoint `registrarCierre`, con los ganchos de los módulos inyectados. Lo
 * arma `ganchos.ts` (el único archivo que conoce a los módulos); el nombre
 * exportado, las opciones (`region`, `secrets`, `cors: false`, `maxInstances`) y
 * los secretos son los de siempre.
 */
export function crearRegistrarCierre(ganchos: GanchosDelCierre): ReturnType<typeof onRequest> {
  const { cobroRealActivo, loHaceElCotejo, solicitudTrasElCierre } = capturarGanchos(ganchos);
  return onRequest(
    {
      region: REGION,
      secrets: Object.values(SECRETOS_POR_ALIAS),
      // Servidor a servidor. Que un navegador no pueda llamarlo elimina de raíz
      // el abuso desde una página cualquiera.
      cors: false,
      maxInstances: 10,
    },
    async (peticion, respuesta) => {
      if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

      const ruta = await rutaAutenticada(peticion);
      if (!ruta) { respuesta.status(401).send('no autorizado'); return; }

      if (ruta.estado !== 'activo') {
        // Un comercio suspendido deja de acumular cierres: un servicio que no se
        // está prestando no tiene resultados que registrar.
        respuesta.status(409).json({ estado: ruta.estado });
        return;
      }

      const cuerpo = (peticion.body ?? {}) as Record<string, unknown>;
      const tipo = texto(cuerpo['tipo'], 20);
      const referencia = texto(cuerpo['referencia'], 200);
      const telefono = texto(cuerpo['telefono'], 25);

      if (!TIPOS.has(tipo)) { respuesta.status(400).json({ error: 'tipo invalido' }); return; }
      if (!referencia) {
        // El rechazo se explica, porque acá el que se equivoca es nuestro propio
        // flujo y quien lo lea tiene que entender qué le faltó.
        respuesta.status(400).json({
          error: 'falta referencia',
          detalle: 'Un cierre necesita el identificador de algo verificable: el evento '
                 + 'del calendario, el mensaje del comprobante o la fila de la planilla. '
                 + 'Sin eso no es un cierre y no se registra.',
        });
        return;
      }

      const db = getFirestore();
      const { tenantId } = ruta;
      const idCierre = idDesdeReferencia(tipo, referencia);
      const refCierre = db.doc(`tenants/${tenantId}/cierres/${idCierre}`);
      const periodo = new Date().toISOString().slice(0, 7);   // 'aaaa-mm'
      const refMetricas = db.doc(`tenants/${tenantId}/metricas/${periodo}`);

      const monto = typeof cuerpo['monto'] === 'number' && Number.isFinite(cuerpo['monto'])
        ? cuerpo['monto'] : null;

      // Transacción: el documento y el contador se mueven juntos o no se mueve
      // ninguno. Si se escribiera el cierre y fallara el contador, la pantalla
      // mostraría un número y el detalle mostraría otro, y el comercio vería dos
      // cifras distintas para lo mismo.
      // LA SOLICITUD PENDIENTE DEL TELÉFONO SE CIERRA CON LA CITA (bloque 4).
      // Un cierre tipo `cita` con teléfono marca `solicitud.etapa = 'agendada'`
      // en la conversación: es lo que saca a ese paciente del barrido de
      // seguimientos («nunca a quien ya agendó»). Va en la MISMA transacción que
      // el cierre, y solo la primera vez: un reintento de n8n no toca nada.
      const telefonoLimpio = telefono.replace(/\D/g, '');
      // LO MISMO CON UNA VENTA COBRADA EN SIMULADO (25/09/2026). En venta el
      // cierre simulado nace de un QR pendiente y del archivo del cliente
      // (`¿Hay comprobante?` del Demo B); si la solicitud seguía en `qr_enviado`,
      // el servidor seguía diciendo `cobro.pendiente` 24 h, y CADA imagen
      // siguiente de ese teléfono se tomaba como otro pago: un cierre de venta
      // más por foto. Con cobro real la cierra el cotejo que cuadra (`sena.ts`).
      const refConversacion = (tipo === 'cita' || tipo === 'venta') && /^[0-9]{8,15}$/.test(telefonoLimpio)
        ? db.doc(`tenants/${tenantId}/conversaciones/wa_${telefonoLimpio}`) : null;
      const ahoraMs = Date.now();

      // Con COBRO REAL de regla 2, el único que cierra una venta es
      // `cotejarComprobanteVenta`: este endpoint no crea cierre ni suma `cierres`
      // mientras el cobro está a tiempo o ya no está en curso (`cobros.md`
      // §4duodecies.6). El modo simulado, y la regla 1, siguen como siempre.
      // CON COBRO REAL una venta sin teléfono utilizable no se puede cruzar con su
      // cobro: no se registra (400), o el cierre esquivaría al cotejo.
      // La lectura es la de FUERA de la transacción de siempre (una lectura, la
      // misma de antes): el gancho recibe un lector anclado al tenant de la firma.
      if (tipo === 'venta' && refConversacion === null
        && await cobroRealActivo((rel) => db.doc(rutaDelTenant(tenantId, rel)).get())) {
        respuesta.status(400).json({ error: 'falta_telefono', detalle: 'Con cobro real, el cierre de una venta necesita el teléfono del cliente.' });
        return;
      }
      let loCierraElCotejo = false;
      const yaEstaba = await db.runTransaction(async (t) => {
        loCierraElCotejo = false;
        // Todas las lecturas antes de la primera escritura: lo exige Firestore.
        const [previo, conversacion] = await Promise.all([
          t.get(refCierre), refConversacion ? t.get(refConversacion) : Promise.resolve(null),
        ]);
        if (previo.exists) return true;     // reintento de n8n: no se cuenta dos veces

        // Con cobro real, un cobro de regla 2 a tiempo o bloqueado lo cierra solo
        // `cotejarComprobanteVenta`: una venta aquí responde 409, y un cierre de
        // otro tipo (cita del mismo teléfono) no mueve la solicitud.
        let cobroReal = false;
        if (conversacion?.exists && loHaceElCotejo(conversacion.get('solicitud'), ahoraMs)) {
          // Sigue siendo una lectura de la transacción, antes de cualquier escritura.
          cobroReal = await cobroRealActivo((rel) => t.get(db.doc(rutaDelTenant(tenantId, rel))));
          if (cobroReal && tipo === 'venta') { loCierraElCotejo = true; return false; }
        }

        const solicitud = conversacion?.exists
          ? solicitudTrasElCierre(conversacion.get('solicitud'), ahoraMs, { cobroReal }) : null;
        if (refConversacion && solicitud) t.set(refConversacion, { solicitud }, { merge: true });

        t.set(refCierre, {
          tipo,
          ocurridoEn: Timestamp.now(),
          referencia,
          telefonoEnmascarado: enmascarar(telefono),
          ...(monto !== null ? { monto, moneda: texto(cuerpo['moneda'], 8) || 'BOB' } : {}),
          // `conversacionId` NO va acá aunque parezca un identificador inocente:
          // es `wa_<telefono>`, o sea el número COMPLETO. Enmascarar el teléfono
          // en un campo y publicarlo entero en otro no protege nada. Va a
          // /privado, junto al resto de lo que identifica a la persona.
        });

        // El detalle que identifica a la persona o al servicio: del negocio, y de
        // nadie más. NovuChat no lo lee.
        const detalle = texto(cuerpo['detalle'], 300);
        const nombre = texto(cuerpo['nombreCliente'], 120);
        if (detalle || nombre || telefono) {
          t.set(refCierre.collection('privado').doc('datos'), {
            ...(detalle ? { detalle } : {}),
            ...(nombre ? { nombreCliente: nombre } : {}),
            ...(telefono ? {
              telefono: telefono.replace(/\D/g, ''),
              conversacionId: `wa_${telefono.replace(/\D/g, '')}`,
            } : {}),
          });
        }

        t.set(refMetricas, { cierres: FieldValue.increment(1) }, { merge: true });
        return false;
      });

      if (loCierraElCotejo) { respuesta.status(409).json({ error: 'cobro_real_lo_cierra_el_cotejo' }); return; }

      respuesta.status(200).json({ registrado: !yaEstaba, repetido: yaEstaba, id: idCierre });
    },
  );
}
