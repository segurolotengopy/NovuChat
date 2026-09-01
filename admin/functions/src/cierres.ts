import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { REGION } from './region.js';
import { SECRETOS_POR_ALIAS, enmascarar, rutaAutenticada } from './firma.js';

/**
 * =============================================================================
 * REGISTRO DE CIERRES — el endpoint que llama n8n cuando algo TERMINÓ BIEN
 * =============================================================================
 *
 * Un cierre es la unidad que se factura, así que este endpoint es el más
 * delicado del sistema en términos comerciales: lo que entra acá es lo que el
 * cliente va a pagar.
 *
 * TRES DEFENSAS CONTRA COBRAR DE MÁS, en orden de importancia:
 *
 *  1. REFERENCIA OBLIGATORIA. Sin un identificador de algo externo que lo
 *     pruebe —el evento del calendario, el mensaje del comprobante, la fila de
 *     la planilla— no hay cierre. Es lo que deja afuera los casos que el
 *     negocio no debe pagar: mandar información que nadie confirmó, mandar el
 *     QR sin que el cliente pague, una conversación incompleta.
 *
 *  2. IDEMPOTENCIA POR REFERENCIA. El identificador del documento se DERIVA de
 *     la referencia, no se genera al azar. Si n8n reintenta —y n8n reintenta:
 *     el flujo tiene reintentos configurados— el segundo intento escribe sobre
 *     el mismo documento y el contador no se mueve. Sin esto, un error de red
 *     transitorio se factura dos veces, y es el tipo de defecto que se descubre
 *     en la factura y no en la prueba.
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

export const registrarCierre = onRequest(
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
      // Un comercio suspendido deja de acumular cierres. No es solo cobranza:
      // es dejar de facturar un servicio que no se está prestando.
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
    // mostraría un número y el detalle mostraría otro, y sobre eso se factura.
    const yaEstaba = await db.runTransaction(async (t) => {
      const previo = await t.get(refCierre);
      if (previo.exists) return true;     // reintento de n8n: no se cuenta dos veces

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

    respuesta.status(200).json({ registrado: !yaEstaba, repetido: yaEstaba, id: idCierre });
  },
);
