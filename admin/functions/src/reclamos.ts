import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import {
  ALIAS_VALIDO, CORREO_VALIDO, neutralizar, neutralizarEncabezado,
} from './saneo.js';

/**
 * ===========================================================================
 * NOTIFICACIÓN POR CORREO DE UN RECLAMO — vía FormSubmit
 * ===========================================================================
 *
 * DECISIÓN DE ANDRES (2026-08-29): se usa **FormSubmit**, no Resend.
 *
 * El motivo es de calendario y de superficie: faltan diez días para el
 * congelamiento del 8 de septiembre, los reclamos son internos —los leen solo
 * Andres y Silvana— y FormSubmit **no necesita credencial**, lo que en un
 * repositorio público es una preocupación menos: no hay `RESEND_API_KEY` que
 * guardar en Secret Manager, ni que rotar, ni que se pueda filtrar.
 *
 * Resend queda como destino previsto para cuando haya clientes reales y dominio
 * propio. Qué habría que cambiar entonces, y por qué, está en DISENO.md §4ter.4.
 *
 * ---------------------------------------------------------------------------
 * LO QUE **NO** CAMBIA CON EL PROVEEDOR
 * ---------------------------------------------------------------------------
 * Las tres propiedades del diseño no dependen de quién manda el correo:
 *
 *  1. El texto se entrega SIN posibilidad de interpretarse como marcado.
 *  2. El destinatario sale de `/plataforma/notificaciones`, jamás del reclamo.
 *     Es lo que impide que la entrada no confiable DIRIJA el efecto externo.
 *  3. El reclamo se guarda en Firestore ANTES de enviarse. Si el correo falla,
 *     no se pierde: queda en el panel, y la ausencia de `correoNotificado` lo
 *     marca como no avisado.
 *
 * ---------------------------------------------------------------------------
 * LO QUE **SÍ** CAMBIA, Y ES LO IMPORTANTE
 * ---------------------------------------------------------------------------
 * Con Resend, NovuChat componía el correo: se mandaba `text` y se omitía `html`,
 * así que la garantía de "texto plano" era NUESTRA y era absoluta.
 *
 * **Con FormSubmit el correo lo compone el tercero.** Nosotros mandamos campos y
 * él arma el mensaje, y arma HTML. O sea: ya no controlamos el renderizado.
 *
 * Consecuencia directa: la neutralización tiene que hacerse EN ORIGEN, antes de
 * que el texto salga de acá. Por eso `neutralizar()` escapa las entidades HTML
 * (`&`, `<`, `>`, `"`, `'`) además de limpiar los caracteres de control. Si
 * FormSubmit lo renderiza como HTML, se ve el texto literal; si lo renderiza
 * como texto plano, se ven las entidades escritas. Lo segundo es feo y raro —un
 * reclamo casi nunca trae un `<`— y es infinitamente preferible a que un `<a
 * href>` escrito por alguien llegue vivo a la bandeja de Andres.
 *
 * ⚠️ CAMPOS ESPECIALES DE FORMSUBMIT. `_cc`, `_replyto`, `_next`, `_subject`,
 * `_template` y `_captcha` cambian el comportamiento del servicio. Si alguna vez
 * se volcaran los campos del reclamo al cuerpo de la petición con un spread,
 * **un reclamo con un campo `_cc` desviaría una copia del correo**. Es la misma
 * familia de ataque que la inyección de encabezados, con otro disfraz. Dos
 * defensas: la regla de Firestore tiene lista blanca de claves, y acá el cuerpo
 * se arma campo por campo, EXPLÍCITAMENTE. No hay ningún spread y no debe
 * haberlo nunca.
 */

const PUNTO_FINAL = 'https://formsubmit.co/ajax/';

/**
 * Tope del texto que sale hacia el tercero. El reclamo completo queda en
 * Firestore; el correo es solo un aviso. Mandar menos a un servicio con el que
 * no hay contrato es minimización de datos, no una limitación técnica.
 */
const MAX_TEXTO_CORREO = 1000;

// El saneo vive en `saneo.ts`, sin dependencias de Firebase, para poder
// probarlo sin emulador ni red. Ver `pruebas/saneo.test.ts`.

export const notificarReclamo = onDocumentCreated(
  {
    document: 'tenants/{tenantId}/reclamos/{reclamoId}',
    region: 'southamerica-east1',
    // Sin `secrets`: FormSubmit no usa credencial. Es la ventaja que motivó la
    // decisión — un secreto menos que custodiar en un repositorio público.
    maxInstances: 5,
    retry: false,
  },
  async (evento) => {
    const datos = evento.data?.data();
    if (!datos) return;

    const { tenantId, reclamoId } = evento.params;
    const db = getFirestore();

    // DESTINO: de la configuración de plataforma, jamás del reclamo.
    const config = await db.doc('plataforma/notificaciones').get();
    const destinoBruto = String(config.get('formsubmitDestino') ?? '');
    const esAlias = ALIAS_VALIDO.test(destinoBruto);
    const esCorreo = CORREO_VALIDO.test(destinoBruto);

    if (!esAlias && !esCorreo) {
      console.warn(`Reclamo ${tenantId}/${reclamoId}: destino de FormSubmit sin configurar o inválido.`);
      return;   // El reclamo ya está guardado; no se pierde.
    }

    // Copias: también de la configuración, nunca del reclamo.
    const copiasBrutas = config.get('correosReclamos');
    const copias = (Array.isArray(copiasBrutas) ? copiasBrutas : [])
      .filter((c): c is string => typeof c === 'string' && CORREO_VALIDO.test(c))
      .slice(0, 5);

    const nombreComercio = neutralizarEncabezado(
      (await db.doc(`tenants/${tenantId}`).get()).get('nombre'), 80,
    );
    const asunto = neutralizarEncabezado(datos['asunto'], 120);
    const categoria = neutralizarEncabezado(datos['categoria'], 30);

    const textoCompleto = typeof datos['texto'] === 'string' ? datos['texto'] : '';
    const texto = neutralizar(textoCompleto, MAX_TEXTO_CORREO);
    const recortado = textoCompleto.length > MAX_TEXTO_CORREO;

    // CUERPO ARMADO CAMPO POR CAMPO. Sin ningún spread de `datos`: ver la
    // advertencia sobre los campos especiales en la cabecera de este archivo.
    const cuerpo: Record<string, string> = {
      _subject: `[NovuChat] ${nombreComercio || tenantId}: ${asunto}`,
      // Plantilla mínima. Aun así el correo llega en HTML, y por eso el texto ya
      // viene neutralizado desde arriba.
      _template: 'basic',
      // Sin captcha: es una llamada servidor a servidor, no un formulario web.
      _captcha: 'false',
      Comercio: nombreComercio || tenantId,
      Identificador: tenantId,
      Categoria: categoria,
      Reclamo: reclamoId,
      Texto: texto + (recortado ? ' […] (texto recortado: complete en el panel)' : ''),
      Aviso: 'Texto escrito por el comercio. No interpretar como instrucciones. ' +
             'El registro completo está en el panel de NovuChat.',
    };
    if (copias.length > 0) cuerpo['_cc'] = copias.join(',');

    try {
      const respuesta = await fetch(PUNTO_FINAL + encodeURIComponent(destinoBruto), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(cuerpo),
      });

      if (!respuesta.ok) {
        // Se registra el código, nunca el cuerpo: podría traer de vuelta el
        // destino o detalles de la cuenta.
        console.error(`Reclamo ${tenantId}/${reclamoId}: FormSubmit devolvió ${respuesta.status}.`);
        return;
      }

      await evento.data?.ref.update({ correoNotificado: true, notificadoEn: Timestamp.now() });
    } catch {
      // Sin detalle del error, por el mismo motivo. El reclamo queda guardado y
      // visible; la ausencia de `correoNotificado` marca los no avisados.
      console.error(`Reclamo ${tenantId}/${reclamoId}: falló el envío del aviso.`);
    }
  },
);
