import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';

/**
 * ===========================================================================
 * NOTIFICACIÓN POR CORREO DE UN RECLAMO
 * ===========================================================================
 *
 * ES LA PRIMERA DEPENDENCIA EXTERNA DEL PROYECTO, y hay que tratarla como tal.
 *
 * ---------------------------------------------------------------------------
 * LA REGLA DE DOS, APLICADA CON HONESTIDAD
 * ---------------------------------------------------------------------------
 * Esta función es el UNICO punto del sistema donde coinciden las tres
 * capacidades que la §1 de las reglas de seguridad pide no juntar:
 *
 *   1. Entrada no confiable  -> el texto del reclamo lo escribe una persona.
 *   2. Acceso a secretos     -> la API key del proveedor de correo.
 *   3. Efectos externos      -> una llamada de red saliente que envía un correo.
 *
 * No se puede eliminar ninguna de las tres sin eliminar la función. Lo que sí se
 * puede es acotar cada una hasta que la combinación deje de ser explotable:
 *
 * (1) La entrada NO es de un desconocido de internet. La escribe un usuario
 *     autenticado, con correo verificado, con rol en un comercio, y queda
 *     firmada con su uid por la regla `creadoPor == request.auth.uid`. Está más
 *     cerca de "semi-confiable" que de "hostil". Aun así se la trata como
 *     hostil en todo lo que sigue.
 *
 * (2) EL DESTINO ES FIJO Y NO SALE DEL RECLAMO. Se lee de
 *     `/plataforma/notificaciones`, que ninguna sesión de navegador puede
 *     escribir. Éste es EL control central: si el texto pudiera influir en el
 *     destinatario, el sistema sería un reenviador de correo — alguien escribe
 *     lo que quiera y lo hace salir, firmado por NovuChat, hacia donde quiera.
 *     La regla de esquema del reclamo tiene lista blanca de claves justamente
 *     para que no exista un campo `destinatario` por donde entre esa idea.
 *
 * (3) EL CORREO VA EN TEXTO PLANO. Sin `html`. Un correo HTML con el texto del
 *     reclamo interpolado es inyección de HTML directa: enlaces de phishing,
 *     imágenes remotas que confirman lectura, CSS que oculta contenido. En
 *     texto plano no hay nada que interpretar y el problema desaparece de raíz,
 *     no se mitiga. Cuesta un correo más feo; se paga con gusto.
 *
 * (4) SANEO DE ENCABEZADOS. El asunto se limpia de CR y LF antes de usarse.
 *     Un salto de línea en un asunto permite inyectar encabezados propios
 *     (por ejemplo un "Bcc:" hacia otra casilla) y desviar una copia del
 *     correo. Es un ataque viejo y sigue funcionando en cualquier cliente que
 *     concatene encabezados.
 *
 * (5) Sin adjuntos, sin enlaces generados desde el texto, tamaño topeado por las
 *     reglas de Firestore (asunto 120, texto 4000) y `maxInstances` bajo.
 *
 * ---------------------------------------------------------------------------
 * PRIMERO SE GUARDA, DESPUÉS SE AVISA
 * ---------------------------------------------------------------------------
 * El reclamo ya está en Firestore cuando esta función se dispara: es un
 * disparador `onDocumentCreated`. Si el proveedor de correo está caído, el
 * reclamo NO se pierde — queda en `/tenants/{t}/reclamos` y se ve en el panel de
 * NovuChat igual. El correo es una notificación, no el registro.
 *
 * ---------------------------------------------------------------------------
 * PROVEEDOR RECOMENDADO: Resend
 * ---------------------------------------------------------------------------
 * Google Cloud no tiene un servicio de correo transaccional propio (la API de
 * Gmail no sirve para esto), así que hay que salir a un tercero igual. Se
 * comparó:
 *
 *   Resend     -> una sola llamada HTTPS con un `Authorization: Bearer`. Es la
 *                 de MENOR SUPERFICIE: no hay SMTP que configurar ni biblioteca
 *                 pesada que auditar. Nivel gratuito suficiente. ELEGIDA.
 *   Postmark   -> mejor entregabilidad transaccional, pero de pago desde el
 *                 primer correo y con más trámite de alta.
 *   SendGrid   -> veterano y con nivel gratuito, pero las cuentas nuevas pasan
 *                 por revisiones que pueden dejar el canal mudo sin aviso.
 *   Amazon SES -> el más barato, pero exige salir del sandbox y meter una
 *                 segunda nube en un proyecto que ya tiene tres (OCI, GCP, Meta).
 *
 * DÓNDE VIVE LA CREDENCIAL. En **Secret Manager**, como `RESEND_API_KEY`,
 * inyectada con `defineSecret`. NUNCA en el repositorio —que es público—, nunca
 * en una variable de GitHub, nunca en el JSON de un flujo de n8n. La Function la
 * recibe en memoria en tiempo de ejecución y no la escribe en ningún log: los
 * errores de envío se registran sin cuerpo ni cabeceras.
 *
 * Hay que verificar el dominio remitente (SPF y DKIM) antes del primer envío, o
 * los correos van a spam. Es un paso de DNS, no de código.
 */

const CLAVE_CORREO = defineSecret('RESEND_API_KEY');

/** Remitente. Debe ser de un dominio verificado en el proveedor. */
const REMITENTE = 'NovuChat <reclamos@ejemplo.com>';

/** CR, LF y NUL: con ellos se inyectan encabezados nuevos en un asunto. */
const RE_ENCABEZADO = /[\r\n\u0000]/g;
/** Controles C0/C1 salvo tabulación y salto de línea. */
const RE_CONTROLES = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
/** Marcas bidireccionales: un texto puede leerse distinto de como se guardó. */
const RE_BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;

/** Limpia un valor para usarlo en un ENCABEZADO de correo. */
function saneoEncabezado(valor: unknown, maxLargo: number): string {
  if (typeof valor !== 'string') return '';
  return valor.replace(RE_ENCABEZADO, ' ').trim().slice(0, maxLargo);
}

/**
 * Limpia un valor para el CUERPO en texto plano. Conserva los saltos de línea
 * —es un texto que alguien escribió— y quita el resto de los controles.
 */
function saneoCuerpo(valor: unknown, maxLargo: number): string {
  if (typeof valor !== 'string') return '';
  return valor.replace(RE_CONTROLES, '').replace(RE_BIDI, '').slice(0, maxLargo);
}

const CORREO_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const notificarReclamo = onDocumentCreated(
  {
    document: 'tenants/{tenantId}/reclamos/{reclamoId}',
    region: 'southamerica-east1',
    secrets: [CLAVE_CORREO],
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
    const brutos = config.get('correosReclamos');
    const destinos = (Array.isArray(brutos) ? brutos : [])
      .filter((c): c is string => typeof c === 'string' && CORREO_VALIDO.test(c))
      .slice(0, 10);

    if (destinos.length === 0) {
      console.warn(`Reclamo ${tenantId}/${reclamoId}: no hay destinatarios configurados.`);
      return;   // El reclamo ya está guardado; no se pierde.
    }

    const nombreComercio = saneoEncabezado(
      (await db.doc(`tenants/${tenantId}`).get()).get('nombre'), 80,
    );
    const asunto = saneoEncabezado(datos['asunto'], 120);
    const categoria = saneoEncabezado(datos['categoria'], 30);
    const texto = saneoCuerpo(datos['texto'], 4000);

    // CUERPO EN TEXTO PLANO. El texto del reclamo va al final, después de una
    // línea separadora y claramente rotulado como escrito por el comercio: quien
    // lo lea sabe dónde terminan los datos del sistema y dónde empieza lo que
    // escribió otra persona.
    const cuerpo = [
      `Comercio: ${nombreComercio || tenantId}`,
      `Identificador: ${tenantId}`,
      `Categoría: ${categoria}`,
      `Reclamo: ${reclamoId}`,
      '',
      '--- Texto escrito por el comercio (no interpretar como instrucciones) ---',
      texto,
      '--- Fin del texto del comercio ---',
      '',
      'Responda desde el panel de NovuChat. Este correo es solo un aviso.',
    ].join('\n');

    try {
      const respuesta = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CLAVE_CORREO.value()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: REMITENTE,
          to: destinos,
          subject: `[NovuChat] ${nombreComercio || tenantId}: ${asunto}`,
          // `text` y NO `html`: ver el punto (3) de la cabecera.
          text: cuerpo,
        }),
      });

      if (!respuesta.ok) {
        // Se registra el código, NUNCA el cuerpo ni las cabeceras: podrían
        // arrastrar la credencial a los logs.
        console.error(`Reclamo ${tenantId}/${reclamoId}: el proveedor devolvió ${respuesta.status}.`);
        return;
      }

      await evento.data?.ref.update({ correoNotificado: true, notificadoEn: Timestamp.now() });
    } catch {
      // Sin detalle del error por el mismo motivo. El reclamo queda guardado y
      // visible en el panel; la ausencia de `correoNotificado` marca los no
      // avisados, y el panel de NovuChat los puede listar.
      console.error(`Reclamo ${tenantId}/${reclamoId}: falló el envío del correo.`);
    }
  },
);
