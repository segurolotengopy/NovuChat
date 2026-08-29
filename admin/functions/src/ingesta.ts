import { createHmac, timingSafeEqual } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

/**
 * =========================================================================
 * PUENTE n8n -> FIRESTORE
 * =========================================================================
 *
 * EL PROBLEMA
 * -----------
 * n8n corre en una VM propia en OCI, fuera de Google Cloud. Necesita escribir
 * las conversaciones de cada negocio en Firestore. La salida "fácil" sería
 * darle una clave JSON de cuenta de servicio: PROHIBIDO. Esa clave es de larga
 * duración, no caduca sola, tiene alcance de PROYECTO ENTERO —o sea, todos los
 * tenants— y si la VM se compromete se lleva puestos a todos los clientes de
 * una. Es exactamente la credencial compartida que el diseño debe evitar.
 *
 * LA SALIDA, EN DOS TRAMOS
 * ------------------------
 * 1) n8n firma cada petición con HMAC-SHA256 usando un secreto POR TENANT que
 *    vive en Secret Manager (`ingesta-<phone_number_id>`) y en las credenciales
 *    de n8n.
 *    El secreto NO viaja en la petición: viaja una firma. Un `Authorization:
 *    Bearer <clave>` quedaría en los logs del proxy inverso; una firma, no.
 *
 * 2) El tenant se DERIVA de la clave que valida la firma, nunca del cuerpo de la
 *    petición. Este es el control anti-"diputado confundido": aunque n8n mande
 *    `{"tenantId": "otro-negocio"}`, ese campo se ignora: el comercio sale del
 *    índice /rutasWhatsApp, resuelto desde el número que valida la firma.
 *    Sin esto, cualquier tenant con una clave válida escribiría en cualquier
 *    otro, y el aislamiento se cae por el lado del backend.
 *
 * 3) La escritura no la hace el SDK Admin a lo bruto: la función emite un token
 *    de Firebase Auth EFÍMERO (1 h) para el principal `svc_<tenantId>`, con el
 *    claim `{ nc: { t: { "<tenantId>": "ingesta" } } }`. Así la escritura pasa
 *    igual por `firestore.rules` y queda acotada por la misma regla que protege
 *    al navegador. Es defensa en profundidad: un error de programación en esta
 *    función no puede cruzar tenants, porque el token no alcanza.
 *
 * Por qué HMAC y no OIDC: la federación de identidades (Workload Identity
 * Federation) necesita que el emisor tenga una identidad OIDC propia. GitHub
 * Actions la tiene, y por eso el despliegue SÍ usa OIDC. Una VM de OCI corriendo
 * n8n no la tiene sin montar un emisor adicional. Ver admin/DISENO.md,
 * §Alternativas descartadas para la ingesta.
 */

const VENTANA_MS = 5 * 60 * 1000;   // Tolerancia de reloj y de red.
const MAX_CUERPO = 64 * 1024;

// Un secreto por NÚMERO DE WHATSAPP, no por comercio.
//
// POR QUÉ CAMBIÓ EL ÍNDICE. El webhook de Meta trae `phone_number_id`, no el
// identificador del comercio. Si el secreto se indexara por tenant, n8n tendría
// que resolver número → comercio ANTES de poder firmar, y para resolverlo
// necesitaría una credencial: un círculo. Indexando por número, n8n toma el
// `phone_number_id` que ya viene en el payload, elige el secreto y firma.
//
// La propiedad que importa se conserva intacta: EL TENANT SE DERIVA DE LA CLAVE
// QUE VALIDA LA FIRMA, nunca del cuerpo de la petición. Solo cambió el paso
// intermedio — ahora la clave identifica un número, y el número resuelve a un
// comercio por el índice inverso /rutasWhatsApp.
//
// Un comercio con dos números (por ejemplo agendamiento y venta) tiene dos
// secretos. Comprometer uno no alcanza al otro ni a ningún otro comercio.
const SECRETOS_POR_NUMERO: Record<string, ReturnType<typeof defineSecret>> = {
  // '<phone_number_id>': defineSecret('INGESTA_PNID_<phone_number_id>'),
};

interface Entrante {
  telefono: string;
  direccion: 'entrante' | 'saliente';
  tipo: string;
  texto: string;
  idMeta?: string;
  nombreContacto?: string;
}

const TIPOS = new Set([
  'text', 'interactive', 'image', 'audio', 'document', 'order', 'location', 'otro',
]);

/** Compara en tiempo constante. Un `===` filtra el secreto por temporización. */
function firmaValida(esperada: string, recibida: string): boolean {
  const a = Buffer.from(esperada, 'hex');
  const b = Buffer.from(recibida, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Normaliza el mensaje entrante. TODO lo de acá es DATO NO CONFIABLE: lo escribió
 * un cliente final de WhatsApp. No se interpola en ninguna consulta, no se
 * evalúa, no se usa para armar una ruta. Solo se valida, se recorta y se guarda.
 */
function normalizar(cuerpo: unknown): Entrante | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null;
  const c = cuerpo as Record<string, unknown>;

  const telefono = typeof c['telefono'] === 'string' ? c['telefono'].trim() : '';
  if (!/^[0-9]{8,15}$/.test(telefono)) return null;

  const direccion = c['direccion'] === 'saliente' ? 'saliente' : 'entrante';
  const tipo = typeof c['tipo'] === 'string' && TIPOS.has(c['tipo']) ? c['tipo'] : 'otro';
  const texto = typeof c['texto'] === 'string' ? c['texto'].slice(0, 4096) : '';
  const idMeta = typeof c['idMeta'] === 'string' ? c['idMeta'].slice(0, 120) : undefined;
  const nombreContacto = typeof c['nombreContacto'] === 'string'
    ? c['nombreContacto'].slice(0, 120) : undefined;

  return { telefono, direccion, tipo, texto, ...(idMeta ? { idMeta } : {}),
           ...(nombreContacto ? { nombreContacto } : {}) };
}

/**
 * Verifica la firma HMAC de una petición de n8n y devuelve el `phone_number_id`
 * que la clave acredita, o `null`.
 *
 * Todo lo que se devuelve de acá está AUTENTICADO por la firma. Lo que venga en
 * el cuerpo de la petición sigue siendo dato no confiable.
 */
function numeroAutenticado(peticion: {
  get(nombre: string): string | undefined;
  rawBody?: Buffer;
}): string | null {
  const phoneNumberId = String(peticion.get('X-NovuChat-Numero') ?? '');
  const marca = String(peticion.get('X-NovuChat-Timestamp') ?? '');
  const firma = String(peticion.get('X-NovuChat-Signature') ?? '').replace(/^sha256=/, '');

  // El número de la cabecera solo SELECCIONA con qué clave verificar. No
  // autoriza nada por sí mismo: si la firma no cierra, se rechaza.
  const secreto = SECRETOS_POR_NUMERO[phoneNumberId];
  if (!secreto || !/^[0-9]{6,25}$/.test(phoneNumberId)) return null;

  const marcaMs = Number(marca);
  // Ventana corta: acota la reproducción de una petición capturada.
  if (!Number.isFinite(marcaMs) || Math.abs(Date.now() - marcaMs) > VENTANA_MS) return null;

  const crudo = peticion.rawBody ?? Buffer.from('');
  if (crudo.length > MAX_CUERPO) return null;

  const esperada = createHmac('sha256', secreto.value())
    .update(`${marca}.`).update(crudo).digest('hex');
  if (!firma || !firmaValida(esperada, firma)) return null;

  return phoneNumberId;
}

/** Resuelve un número autenticado a su comercio y su flujo. */
async function resolverComercio(phoneNumberId: string): Promise<
  { tenantId: string; flujo: string; estado: string } | null
> {
  const ruta = await getFirestore().doc(`rutasWhatsApp/${phoneNumberId}`).get();
  if (!ruta.exists) return null;
  const tenantId = String(ruta.get('tenantId') ?? '');
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(tenantId)) return null;
  const tenant = await getFirestore().doc(`tenants/${tenantId}`).get();
  return {
    tenantId,
    flujo: String(ruta.get('flujo') ?? 'agendamiento'),
    estado: String(tenant.get('estado') ?? 'desconocido'),
  };
}

export const ingesta = onRequest(
  {
    region: 'southamerica-east1',
    secrets: Object.values(SECRETOS_POR_NUMERO),
    // Sin CORS: este endpoint es servidor a servidor. Que un navegador no pueda
    // llamarlo elimina de raíz el abuso desde una página cualquiera.
    cors: false,
    maxInstances: 10,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    const phoneNumberId = numeroAutenticado(peticion);
    if (!phoneNumberId) { respuesta.status(401).send('no autorizado'); return; }

    const mensaje = normalizar(peticion.body);
    if (!mensaje) { respuesta.status(400).send('mensaje invalido'); return; }

    const db = getFirestore();

    // RESOLUCIÓN NÚMERO → COMERCIO. El tenant sale de acá y NUNCA del cuerpo de
    // la petición: aunque n8n mandara `{"tenantId": "otro-negocio"}`, ese campo
    // se ignora por completo.
    const comercio = await resolverComercio(phoneNumberId);
    if (!comercio) { respuesta.status(404).send('numero no asignado'); return; }
    const { tenantId } = comercio;

    // ESTADO DEL COMERCIO. Uno suspendido o dado de baja deja de acumular
    // conversaciones. No es solo la palanca de cobranza: es dejar de guardar
    // datos personales de terceros de un servicio que ya no se presta. El 409 le
    // dice a n8n que mande el mensaje de cortesía —neutro, sin revelar el motivo
    // comercial— y corte el turno.
    if (comercio.estado !== 'activo') {
      respuesta.status(409).json({ estado: comercio.estado });
      return;
    }

    // Token efímero acotado a ESTE comercio. La escritura queda sujeta a
    // firestore.rules, igual que la del navegador. (Ver Fase 2 en DISENO.md.)
    await getAuth().createCustomToken(`svc_${tenantId}`, {
      nc: { t: { [tenantId]: 'ingesta' }, v: 1 },
    });

    const idConversacion = `wa_${mensaje.telefono}`;
    const refConversacion = db.doc(`tenants/${tenantId}/conversaciones/${idConversacion}`);
    const periodo = new Date().toISOString().slice(0, 7);   // 'aaaa-mm'
    const refMetricas = db.doc(`tenants/${tenantId}/metricas/${periodo}`);

    // -----------------------------------------------------------------------
    // CONTEO DE PERSONAS ATENDIDAS (ÚNICOS)
    //
    // EL PROBLEMA. `FieldValue.increment(1)` no sabe deduplicar: cuenta
    // mensajes, no personas. Una persona que escribe treinta veces en el mes
    // sumaría treinta.
    //
    // LO QUE NO SE HIZO, Y POR QUÉ. La solución de manual es un conjunto de
    // hashes de teléfono por período (`/metricas/{p}/vistos/{hash}`). Se
    // descartó por dos motivos:
    //
    //  a) PRIVACIDAD. Un hash de teléfono NO es anonimización. El espacio de
    //     números bolivianos es del orden de 10^8: enumerarlo entero y comparar
    //     hashes es cuestión de segundos en una laptop. Sin sal secreta, ese
    //     conjunto es una segunda copia de los teléfonos, disfrazada. Y con sal
    //     secreta hay que custodiar y rotar la sal, que es otro secreto más.
    //  b) COSTO Y BASURA. Crea un documento por persona y por mes que después
    //     hay que purgar.
    //
    // LO QUE SÍ SE HACE. Se aprovecha que el documento de la conversación YA
    // ESTÁ indexado por teléfono (`wa_<telefono>`) y YA SE ESCRIBE en cada
    // mensaje. Se le agrega un campo `periodoContado`. Si el período que trae no
    // es el actual, esta persona todavía no fue contada este mes: se incrementa
    // `personasAtendidas` y se actualiza la marca. Todo dentro de una
    // transacción, para que dos mensajes simultáneos de la misma persona no la
    // cuenten dos veces.
    //
    // NO SE CREA NINGÚN REGISTRO NUEVO DE TELÉFONOS. Es minimización de datos:
    // se reutiliza el identificador personal que ya existía en vez de sembrar
    // una segunda copia en la colección de métricas.
    //
    // COSTO EN FIRESTORE, por mensaje entrante:
    //   +1 lectura   (el documento de la conversación, dentro de la transacción)
    //   +0 escrituras en el caso común (la conversación ya se escribía; solo se
    //      le agrega un campo)
    //   +1 escritura SOLO la primera vez que esa persona escribe en el mes
    //
    // Para un comercio con 500 mensajes/mes de 80 personas distintas: 500
    // lecturas y 80 escrituras extra al mes. A la tarifa de Firestore eso es del
    // orden de una milésima de dólar. El conteo exacto sale prácticamente gratis.
    //
    // RECUENTO. Si alguna vez hay que recalcular un período (por una corrección
    // o una disputa de factura), se recorre /conversaciones filtrando por
    // `ultimoEn` dentro del mes. Es caro pero puntual, y no exige haber guardado
    // ninguna estructura extra.
    // -----------------------------------------------------------------------
    await db.runTransaction(async (tx) => {
      const conversacion = await tx.get(refConversacion);
      const yaContada = conversacion.get('periodoContado') === periodo;

      tx.set(refConversacion, {
        telefono: mensaje.telefono,
        canal: 'whatsapp',
        ultimoMensaje: mensaje.texto.slice(0, 300),
        ultimoEn: FieldValue.serverTimestamp(),
        mensajesTotal: FieldValue.increment(1),
        periodoContado: periodo,
        ...(mensaje.nombreContacto ? { nombreContacto: mensaje.nombreContacto } : {}),
      }, { merge: true });

      tx.create(refConversacion.collection('mensajes').doc(), {
        direccion: mensaje.direccion,
        tipo: mensaje.tipo,
        texto: mensaje.texto,
        ts: Timestamp.now(),
        ...(mensaje.idMeta ? { idMeta: mensaje.idMeta } : {}),
      });

      tx.set(refMetricas, {
        mensajes: FieldValue.increment(1),
        ...(mensaje.direccion === 'entrante' ? { entrantes: FieldValue.increment(1) } : {}),
        // El incremento de personas atendidas ocurre UNA sola vez por persona y
        // por mes. Es el número que sostiene la facturación por uso.
        ...(yaContada ? {} : { personasAtendidas: FieldValue.increment(1) }),
      }, { merge: true });
    });

    respuesta.status(204).send('');
  },
);

/**
 * ===========================================================================
 * CONFIGURACIÓN DEL COMERCIO PARA n8n, RESUELTA POR NÚMERO
 * ===========================================================================
 *
 * Es lo que reemplaza a los valores escritos a mano en el nodo `Config del
 * negocio`. n8n llama acá al empezar cada turno con el `phone_number_id` que
 * viene en el webhook, y recibe con qué comercio está hablando, con qué flujo y
 * con qué datos.
 *
 * TRES COSAS QUE CONVIENE ENTENDER:
 *
 * 1. LA RESPUESTA VIENE ROTULADA. `instruccionesExtra` va en su propia clave,
 *    separada del resto, para que el flujo la inserte en una sección delimitada
 *    del prompt marcada como DATO DEL NEGOCIO. Nunca concatenada por delante de
 *    las reglas de comportamiento del agente. Sin esa separación, lo que un
 *    comercio escribe en el panel se convierte en instrucciones para el modelo
 *    (inyección de segundo orden; ver SEGURIDAD.md §3).
 *
 * 2. EL ESTADO VIAJA EN CADA RESPUESTA. Si el comercio no está activo se
 *    devuelve 409 con el estado y un `mensajeCortesia` NEUTRO. n8n debe enviar
 *    ese texto y cortar el turno. **PROHIBIDO revelarle al cliente final que el
 *    comercio debe dinero**: quien escribe por WhatsApp es un tercero que no
 *    tiene nada que ver con la relación comercial, y enterarlo dañaría al
 *    comercio y a NovuChat por igual.
 *
 * 3. n8n NO DEBE CACHEAR ESTO MÁS DE 60 SEGUNDOS. La suspensión es una palanca
 *    comercial y tiene que surtir efecto ya. Un caché largo la vuelve inútil.
 */
export const configuracionFlujo = onRequest(
  {
    region: 'southamerica-east1',
    secrets: Object.values(SECRETOS_POR_NUMERO),
    cors: false,
    maxInstances: 10,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    const phoneNumberId = numeroAutenticado(peticion);
    if (!phoneNumberId) { respuesta.status(401).send('no autorizado'); return; }

    const comercio = await resolverComercio(phoneNumberId);
    if (!comercio) { respuesta.status(404).send('numero no asignado'); return; }

    const db = getFirestore();

    if (comercio.estado !== 'activo') {
      respuesta.status(409).json({
        estado: comercio.estado,
        // Texto neutro. No menciona pagos, deudas ni suspensiones.
        mensajeCortesia:
          'Gracias por escribirnos. En este momento no podemos atenderle por ' +
          'este medio. Le pedimos comunicarse directamente con el negocio.',
      });
      return;
    }

    const [config, catalogo] = await Promise.all([
      db.doc(`tenants/${comercio.tenantId}/config/negocio`).get(),
      db.collection(`tenants/${comercio.tenantId}/catalogo`)
        .where('activo', '==', true).limit(200).get(),
    ]);

    const negocio = config.data() ?? {};
    // Se separa deliberadamente el texto libre del resto de la configuración.
    const { instruccionesExtra, ...datosDelNegocio } = negocio as Record<string, unknown>;

    respuesta.status(200).json({
      tenantId: comercio.tenantId,
      flujo: comercio.flujo,
      estado: comercio.estado,
      negocio: datosDelNegocio,
      catalogo: catalogo.docs.map((d) => ({ id: d.id, ...d.data() })),
      // Clave aparte, con nombre que recuerda qué es: dato, no instrucción.
      datosLibresDelNegocio: typeof instruccionesExtra === 'string' ? instruccionesExtra : '',
    });
  },
);
