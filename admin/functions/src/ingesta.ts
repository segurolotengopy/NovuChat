import { REGION } from './region.js';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { SECRETOS_POR_ALIAS, rutaAutenticada } from './firma.js';
import {
  CAMPOS_LIBRES_AL_PROMPT, datosQueNoTenemos, horarioAtencion, instruccionesDeVoz,
  resolverFuncionarios, documentoDeVertical, rotulosCobroSimulado,
} from './prompt.js';

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
 * 1) n8n firma cada petición con HMAC-SHA256 usando un secreto POR NÚMERO DE
 *    WHATSAPP que vive en Secret Manager y en las credenciales de n8n.
 *    El secreto NO viaja en la petición: viaja una firma. Un `Authorization:
 *    Bearer <clave>` quedaría en los logs del proxy inverso; una firma, no.
 *    La verificación NO vive acá: vive en `firma.ts`, y este archivo la usa a
 *    través de `rutaAutenticada()`. Ver ahí por qué el secreto se nombra por un
 *    ALIAS (`demoA`) y no por el identificador del número.
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

// LA AUTENTICACIÓN VIVE EN `firma.ts`, NO ACÁ.
//
// Este archivo tenía su propia copia de todo: el mapa de secretos, la ventana de
// tolerancia, el tope de cuerpo, la comparación en tiempo constante y la
// verificación de la firma. Esa copia quedó INSERVIBLE: el mapa se indexaba por
// `phone_number_id`, `defineSecret` exige un nombre fijo escrito en el código, y
// un identificador de número no puede escribirse en un repositorio público. El
// mapa nunca se pudo llenar, así que ningún número autenticaba y la ingesta no
// recibía nada. `firma.ts` lo resolvió con un ALIAS guardado en
// /rutasWhatsApp/{numero}; acá se usa esa implementación y se borra la propia.
//
// Un comercio con dos números (por ejemplo agendamiento y venta) sigue teniendo
// dos secretos: comprometer uno no alcanza al otro ni a ningún otro comercio.

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

/** Forma que exige un identificador de comercio. Se comprueba ANTES de armar
 *  ninguna ruta con él: `tenantId` viene de un documento, y un documento con un
 *  valor raro no debe poder desviar una escritura a otra parte del árbol. */
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;

/**
 * Estado del comercio, leído de SU FICHA y no de la copia propagada en la ruta.
 *
 * POR QUÉ NO SE USA `ruta.estado`, que ya viene resuelto y saldría gratis. Esa
 * copia la mantiene `marcarRutasDelTenant`, que hoy corre al SUSPENDER y al
 * REACTIVAR, pero NO al dar de baja: una ruta de un comercio dado de baja sigue
 * diciendo `activo`. Leer la ficha cuesta una lectura más y es la única fuente
 * que no puede quedar desfasada. Acá se guardan datos personales de clientes
 * finales, así que el lado seguro del error es dejar de guardarlos.
 */
async function estadoDelComercio(tenantId: string): Promise<string> {
  const tenant = await getFirestore().doc(`tenants/${tenantId}`).get();
  return String(tenant.get('estado') ?? 'desconocido');
}

/**
 * Enmascara un teléfono para la bitácora: `59170000001` -> `5917****001`.
 *
 * La regla de Firestore EXIGE el patrón con asteriscos, así que un número
 * completo se rechaza en el servidor. Esta función existe para que el camino
 * correcto sea el fácil, no para ser la única defensa: la diferencia entre
 * «acordarse de enmascarar» y no poder no hacerlo.
 */
export function enmascarar(telefono: unknown): string {
  const t = typeof telefono === 'string' ? telefono.replace(/[^0-9]/g, '') : '';
  if (t.length < 7) return '****';
  return `${t.slice(0, 4)}****${t.slice(-3)}`;
}

type TipoEvento =
  | 'mensaje_entrante' | 'mensaje_saliente' | 'plantilla_enviada'
  | 'cita_agendada' | 'cita_rechazada' | 'cobro_simulado'
  | 'transferencia_humano' | 'config_publicada' | 'suspension'
  | 'reactivacion' | 'error_flujo' | 'entrada_descartada';

interface Evento {
  tipo: TipoEvento;
  resultado: 'ok' | 'fallo' | 'rechazado' | 'reintento';
  canal?: 'whatsapp' | 'panel' | 'sistema';
  telefono?: string;
  conversacionId?: string;
  codigo?: string;
  detalle?: string;
  tamanoTexto?: number;
  latenciaMs?: number;
}

/**
 * Escribe un evento en la bitácora del comercio.
 *
 * NUNCA EL TEXTO DEL MENSAJE. Solo metadatos. El motivo está en la cabecera de
 * la colección en `firestore.rules`: si la bitácora llevara el contenido, sería
 * una puerta trasera a lo que T-5 impide — el propietario de NovuChat leyendo
 * conversaciones de todos los comercios sin ninguna ventana de soporte.
 * `tamanoTexto` da la magnitud sin dar el contenido.
 *
 * NO FALLA LA OPERACIÓN. Si la bitácora no se puede escribir, se registra en el
 * log y se sigue: perder un renglón de evidencia es malo, pero no atender a un
 * cliente por eso es peor. La bitácora observa el sistema, no lo gobierna.
 */
export async function registrar(tenantId: string, evento: Evento): Promise<void> {
  try {
    await getFirestore().collection(`tenants/${tenantId}/bitacora`).add({
      ts: Timestamp.now(),
      tipo: evento.tipo,
      resultado: evento.resultado,
      canal: evento.canal ?? 'whatsapp',
      ...(evento.telefono ? { destinoEnmascarado: enmascarar(evento.telefono) } : {}),
      ...(evento.conversacionId ? { conversacionId: evento.conversacionId.slice(0, 80) } : {}),
      ...(evento.codigo ? { codigo: String(evento.codigo).slice(0, 24) } : {}),
      ...(evento.detalle ? { detalle: evento.detalle.slice(0, 120) } : {}),
      ...(typeof evento.tamanoTexto === 'number'
        ? { tamanoTexto: Math.max(0, Math.min(100000, Math.trunc(evento.tamanoTexto))) } : {}),
      ...(typeof evento.latenciaMs === 'number'
        ? { latenciaMs: Math.max(0, Math.min(600000, Math.trunc(evento.latenciaMs))) } : {}),
    });
  } catch {
    console.error(`No se pudo registrar en la bitacora de ${tenantId}: ${evento.tipo}`);
  }
}

/**
 * ===========================================================================
 * ATENCIONES E INTERACCIONES — dos de las tres cifras de la oferta comercial
 * ===========================================================================
 *
 * Las definiciones son las de `web/src/paginas/Cierres.tsx` y no se
 * reinterpretan acá:
 *
 *   ATENCIÓN     una conversación iniciada con un cliente. Cuenta el arranque,
 *                haya terminado bien o no.
 *   INTERACCIÓN  una conversación en la que el cliente recibió MÁS DE UNA
 *                respuesta. Mide las que pasaron de un saludo suelto a un ida y
 *                vuelta de verdad.
 *
 * POR QUÉ ESTA FUNCIÓN ES PURA Y NO TOCA FIRESTORE. Sobre estos números se
 * factura, así que un incremento de más es cobrarle de más a un cliente. La
 * decisión de sumar o no sumar es lo único que puede equivocarse, y separada de
 * la base se puede probar exhaustivamente sin emulador ni red: la suite recorre
 * el mes entero de una conversación mensaje por mensaje. Quien la llama solo
 * aplica lo que esta función decidió, dentro de la transacción.
 *
 * LA DEDUPLICACIÓN, que es la parte difícil. Un `FieldValue.increment(1)` no
 * sabe deduplicar: cuenta mensajes. Se usa la misma clase de marca que ya
 * resolvía `personasAtendidas` —un campo en el documento de la conversación, que
 * ya está indexado por teléfono y ya se escribe en cada mensaje—, con una marca
 * por cifra:
 *
 *   `periodoContado`       último período en que esta conversación ya sumó su
 *                          atención. Si no es el actual, es el primer mensaje
 *                          del mes: suma UNA atención y se actualiza la marca.
 *   `respuestasDelPeriodo` cuántas respuestas salientes lleva la conversación en
 *                          el período. Arranca de cero al cambiar de mes.
 *   `periodoInteraccion`   último período en que esta conversación ya sumó su
 *                          interacción. Se pone al llegar a la SEGUNDA
 *                          respuesta, y por eso la tercera y la cuarta no suman
 *                          nada: es exactamente el caso que cobraría de más.
 *
 * POR QUÉ `personasAtendidas` Y `atenciones` COMPARTEN LA MARCA. Hoy disparan
 * con el mismo hecho —el primer mensaje del período en una conversación cuyo
 * identificador ES el teléfono (`wa_<telefono>`)—, así que una persona y una
 * conversación son la misma cosa y dos marcas idénticas solo podrían
 * desincronizarse. Si algún día una persona pudiera tener más de una
 * conversación abierta, las dos cifras dejarían de coincidir y ahí sí harían
 * falta dos marcas: es el momento de partir esto, y no antes.
 *
 * NO SE CREA NINGÚN REGISTRO NUEVO DE TELÉFONOS y no se agrega ni una lectura:
 * los tres campos viajan en el documento que la transacción ya leía y ya
 * escribía. El costo de las dos cifras nuevas es cero lecturas y cero
 * escrituras extra, salvo el documento de métricas que ya se escribía igual.
 */
export interface MarcasDeConteo {
  periodoContado?: unknown;
  respuestasDelPeriodo?: unknown;
  periodoInteraccion?: unknown;
  /**
   * Cuándo EMPEZÓ la atención vigente. Es el ancla de la ventana de 24 horas,
   * no la marca del último mensaje.
   *
   * La diferencia con medir el silencio entre mensajes es la que decidió
   * Andres, y cambia la factura: con el ancla, una conversación que se estira
   * todo el día es UNA atención por más idas y vueltas que tenga, y a las 24
   * horas de haber empezado se renueva. Con el silencio, en cambio, una charla
   * larga con pausas se habría partido en varias.
   */
  atencionDesde?: { toMillis?: () => number } | unknown;
}

/**
 * SEPARACIÓN ENTRE UNA ATENCIÓN Y LA SIGUIENTE.
 *
 * Una ATENCIÓN es un inicio de flujo, no una persona ni un mes: el mismo
 * teléfono que consulta tres veces son TRES atenciones y UNA persona atendida.
 * Pero WhatsApp no marca dónde termina una consulta y empieza otra —no hay
 * "colgar"—, así que el corte lo tiene que poner el sistema, y el único dato
 * disponible es el silencio entre mensajes.
 *
 * VEINTICUATRO HORAS DESDE LA PRIMERA INTERACCIÓN, decidido por Andres.
 *
 * Una atención se abre con la primera consulta del cliente y dura un día
 * entero: todo lo que pase dentro de esa ventana es la misma atención, y
 * recién el mensaje que llega pasadas las 24 horas abre otra.
 *
 * No es un número arbitrario: es exactamente la ventana de atención al cliente
 * de WhatsApp, la misma con la que Meta factura sus conversaciones. Que
 * nuestra unidad coincida con la suya hace que la factura que recibimos y la
 * que emitimos se puedan comparar renglón por renglón, en vez de tener que
 * explicar por qué no coinciden.
 *
 * ES UN VALOR COMERCIAL: subirlo cobra menos y bajarlo cobra más, así que se
 * cambia con Andres y no en una revisión de código.
 */
export const HORAS_VENTANA_ATENCION = 24;

/**
 * ¿Este mensaje es SOLO una cortesía?
 *
 * Un «gracias» o un «ok» después del recordatorio no es una consulta: el
 * cliente no vino a pedir nada, está acusando recibo. Contarlo abriría una
 * atención por cada persona educada, y encima justamente por un mensaje que
 * provocamos nosotros. Sería cobrar por nuestra propia notificación.
 *
 * EL RIESGO DE ESTO ES PASARSE, no quedarse corto. Si el filtro fuera amplio se
 * tragaría consultas reales y cobraríamos de menos sin enterarnos, que es un
 * error invisible. Por eso es deliberadamente estrecho: el mensaje entero,
 * quitados los emojis y los signos, tiene que ser UNA de estas fórmulas. Basta
 * que agregue cualquier otra cosa —«gracias, quiero otra cita»— para que cuente
 * como atención.
 */
const CORTESIAS = new Set([
  'gracias', 'muchas gracias', 'mil gracias', 'gracias!', 'graciass',
  'ok', 'oka', 'okey', 'okay', 'listo', 'listo gracias', 'perfecto',
  'perfecto gracias', 'dale', 'bueno', 'buenisimo', 'excelente', 'genial',
  'de nada', 'ya', 'ya esta', 'entendido', 'enterado', 'copiado',
  'si', 'no', 'confirmado', 'buenas', 'saludos', 'chau', 'adios', 'hasta luego',
  'ok gracias', 'ok listo', 'muy bien', 'barbaro', 'joya',
]);

export function esCortesia(texto: string): boolean {
  const limpio = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')          // tildes
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')        // emojis, signos y puntuación
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  // Un mensaje vacío tras la limpieza es un emoji suelto: un pulgar arriba.
  if (limpio === '') return true;
  // Corte por largo antes de mirar el diccionario: una consulta de verdad no
  // entra en veinticinco caracteres, y esto evita que una frase larga que
  // empiece con «gracias» se cuele por alguna coincidencia.
  if (limpio.length > 25) return false;
  return CORTESIAS.has(limpio);
}

export interface Conteo {
  /** ¿Este mensaje abre una atención nueva? (inicio de flujo) */
  atencion: boolean;
  /** ¿Es un mensaje del cliente con contenido, y no una cortesía? */
  esConsulta: boolean;
  /** ¿Es la primera vez que esta persona escribe en el período? */
  personaNueva: boolean;
  /** ¿Con este mensaje el cliente llega a su segunda respuesta del período? */
  interaccion: boolean;
  /** Valor que hay que dejar guardado en la conversación. */
  respuestasDelPeriodo: number;
}

/**
 * Decide qué contadores mueve UN mensaje, a partir de las marcas que trae la
 * conversación. `marcas` es lo que hay guardado; todo lo demás se deriva.
 */
export function contadoresDelMensaje(
  marcas: MarcasDeConteo,
  periodo: string,
  direccion: 'entrante' | 'saliente',
  ahoraMs: number = Date.now(),
  texto = '',
): Conteo {
  const mismoPeriodo = marcas.periodoContado === periodo;

  // PERSONA ATENDIDA y ATENCIÓN son cifras distintas y se cuentan distinto.
  // Un teléfono que consulta tres veces es UNA persona atendida y TRES
  // atenciones, siempre que esas tres veces caigan en ventanas distintas.
  const ancla = marcas.atencionDesde as { toMillis?: () => number } | undefined;
  const anclaMs = typeof ancla?.toMillis === 'function' ? ancla.toMillis() : null;
  // Sin ancla es la primera consulta de esta conversación, así que abre.
  const vencida = anclaMs === null
    || ahoraMs - anclaMs >= HORAS_VENTANA_ATENCION * 60 * 60 * 1000;

  // Solo un mensaje ENTRANTE abre una atención. Una respuesta nuestra no inicia
  // nada: si contara, un recordatorio saliente inventaría una consulta que el
  // cliente nunca hizo, y eso es cobrar por algo que no ocurrió.
  // Una cortesía no abre nada: ver `esCortesia`.
  const consulta = direccion === 'entrante' && !esCortesia(texto);
  const atencion = consulta && vencida;

  // Al cambiar de mes el contador de respuestas vuelve a cero: la definición es
  // POR PERÍODO, y arrastrar el saldo del mes anterior haría que la primera
  // respuesta de enero cobrara la interacción de diciembre.
  const guardadas = marcas.respuestasDelPeriodo;
  const previas = mismoPeriodo && typeof guardadas === 'number' && Number.isFinite(guardadas)
    ? Math.max(0, Math.trunc(guardadas))
    : 0;
  const respuestasDelPeriodo = previas + (direccion === 'saliente' ? 1 : 0);

  return {
    atencion,
    /**
     * Una cortesía tampoco mueve la marca de silencio. Si la moviera, un
     * «gracias» dejaría la conversación como recién activa y la consulta de
     * verdad que llegara una hora después NO se contaría — el filtro terminaría
     * haciendo perder atenciones en vez de evitar las falsas.
     */
    esConsulta: consulta,
    personaNueva: !mismoPeriodo,
    // La marca manda sobre el conteo. Que `respuestasDelPeriodo` llegue a tres o
    // a treinta no vuelve a sumar: la interacción ya está anotada en este
    // período. El `>= 2` y no `== 2` es para que un recuento manual o un
    // arreglo de datos que dejara el contador adelantado tampoco se pierda la
    // interacción; la marca sigue impidiendo que se cuente dos veces.
    interaccion: marcas.periodoInteraccion !== periodo && respuestasDelPeriodo >= 2,
    respuestasDelPeriodo,
  };
}

export const ingesta = onRequest(
  {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    // Sin CORS: este endpoint es servidor a servidor. Que un navegador no pueda
    // llamarlo elimina de raíz el abuso desde una página cualquiera.
    cors: false,
    maxInstances: 10,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    // RESOLUCIÓN NÚMERO → COMERCIO, EN UN SOLO PASO. La firma (o el token) se
    // verifica contra el secreto de ESE número y el comercio sale del índice
    // /rutasWhatsApp, NUNCA del cuerpo: aunque n8n mandara
    // `{"tenantId": "otro-negocio"}`, ese campo se ignora por completo.
    const ruta = await rutaAutenticada(peticion);
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }

    const { tenantId } = ruta;
    // Un identificador con forma rara no arma ninguna ruta de escritura.
    if (!ID_TENANT.test(tenantId)) { respuesta.status(404).send('numero no asignado'); return; }

    const mensaje = normalizar(peticion.body);
    if (!mensaje) {
      // Entrada descartada: queda registrada para poder responder «nunca nos
      // llegó» con evidencia, sin guardar lo que vino.
      await registrar(tenantId, {
        tipo: 'entrada_descartada', resultado: 'rechazado',
        detalle: 'payload no valido',
      });
      respuesta.status(400).send('mensaje invalido'); return;
    }

    const db = getFirestore();

    // ESTADO DEL COMERCIO. Uno suspendido o dado de baja deja de acumular
    // conversaciones. No es solo la palanca de cobranza: es dejar de guardar
    // datos personales de terceros de un servicio que ya no se presta. El 409 le
    // dice a n8n que mande el mensaje de cortesía —neutro, sin revelar el motivo
    // comercial— y corte el turno.
    const estado = await estadoDelComercio(tenantId);
    if (estado !== 'activo') {
      // SE REGISTRA IGUAL. La bitácora admite escrituras con el comercio
      // suspendido justamente para esto: el tramo del corte de servicio es el
      // más conflictivo y es donde la evidencia no puede tener agujeros.
      await registrar(tenantId, {
        tipo: 'entrada_descartada', resultado: 'rechazado',
        telefono: mensaje.telefono, codigo: '409', detalle: estado,
      });
      respuesta.status(409).json({ estado });
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
    // LAS ATENCIONES Y LAS INTERACCIONES VIAJAN EN LA MISMA TRANSACCIÓN, con
    // marcas de la misma clase y por el mismo motivo. Quién decide qué se suma
    // está en `contadoresDelMensaje`, arriba, que es pura y está probada aparte.
    // Que las marcas y los contadores se muevan en una sola transacción es lo
    // que impide que queden desfasados: si se escribiera la marca y fallara el
    // contador, la conversación quedaría contada y la cifra que se factura, no.
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
      const conteo = contadoresDelMensaje(
        (conversacion.data() ?? {}) as MarcasDeConteo, periodo, mensaje.direccion,
        Date.now(), mensaje.texto,
      );

      tx.set(refConversacion, {
        telefono: mensaje.telefono,
        canal: 'whatsapp',
        ultimoMensaje: mensaje.texto.slice(0, 300),
        ultimoEn: FieldValue.serverTimestamp(),
        // Solo lo mueve un mensaje del cliente: ver `ultimoEntranteEn` arriba.
        // El ancla se escribe SOLO al abrir una atención. Refrescarla con cada
        // mensaje convertiría la ventana fija en una ventana deslizante, y una
        // conversación activa nunca se renovaría: el cliente que escribe todos
        // los días quedaría contado una sola vez, para siempre.
        ...(conteo.atencion ? { atencionDesde: FieldValue.serverTimestamp() } : {}),
        mensajesTotal: FieldValue.increment(1),
        periodoContado: periodo,
        // El contador de respuestas se calcula, no se incrementa: dentro de la
        // transacción el valor leído es el que vale, y así el número guardado y
        // la decisión que se tomó con él no pueden discrepar.
        respuestasDelPeriodo: conteo.respuestasDelPeriodo,
        ...(conteo.interaccion ? { periodoInteraccion: periodo } : {}),
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
        // Son los números que sostienen la facturación por uso.
        // Se cuentan por separado, a propósito. `personasAtendidas` es una vez
        // por teléfono y por mes; `atenciones` es una por cada consulta nueva
        // del mismo teléfono. Ver `contadoresDelMensaje`.
        ...(conteo.personaNueva ? { personasAtendidas: FieldValue.increment(1) } : {}),
        ...(conteo.atencion ? { atenciones: FieldValue.increment(1) } : {}),
        ...(conteo.interaccion ? { interacciones: FieldValue.increment(1) } : {}),
      }, { merge: true });
    });

    await registrar(tenantId, {
      tipo: mensaje.direccion === 'entrante' ? 'mensaje_entrante' : 'mensaje_saliente',
      resultado: 'ok',
      telefono: mensaje.telefono,
      conversacionId: idConversacion,
      // El TAMAÑO del texto, nunca el texto.
      tamanoTexto: mensaje.texto.length,
      ...(typeof peticion.body === 'object' && peticion.body !== null
          && typeof (peticion.body as Record<string, unknown>)['latenciaMs'] === 'number'
        ? { latenciaMs: (peticion.body as Record<string, number>)['latenciaMs'] } : {}),
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
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    cors: false,
    maxInstances: 10,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    const ruta = await rutaAutenticada(peticion);
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }
    if (!ID_TENANT.test(ruta.tenantId)) {
      respuesta.status(404).send('numero no asignado'); return;
    }

    // `flujo` cae en `agendamiento` si la ruta no lo trae. Es el vertical que ya
    // tenían las rutas viejas, escritas antes de que hubiera un segundo: dejarlo
    // vacío haría que el comercio no recibiera NINGUNA configuración de vertical
    // y el flujo se quedaría sin datos sin decir por qué.
    const phoneNumberId = ruta.phoneNumberId;
    const comercio = {
      tenantId: ruta.tenantId,
      flujo: ruta.flujo || 'agendamiento',
      estado: await estadoDelComercio(ruta.tenantId),
    };

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

    // Tres lecturas en paralelo. n8n resuelve «quién atiende una limpieza
    // facial» EN MEMORIA sobre estas listas, sin consultas adicionales: son
    // colecciones chicas (200 servicios, 50 funcionarios como tope) y traerlas
    // enteras cuesta menos que cualquier consulta con índice por servicio.
    // Documento específico del vertical, si le corresponde uno. Un comercio de
    // gastronomía no lee configuración de agenda y viceversa: no hace falta
    // filtrar después porque directamente no se pide.
    const docVertical = documentoDeVertical(comercio.flujo);

    const [config, catalogo, funcionarios, especifica, rotulos] = await Promise.all([
      db.doc(`tenants/${comercio.tenantId}/config/negocio`).get(),
      db.collection(`tenants/${comercio.tenantId}/catalogo`)
        .where('activo', '==', true).limit(200).get(),
      db.collection(`tenants/${comercio.tenantId}/funcionarios`)
        .where('activo', '==', true).limit(50).get(),
      docVertical
        ? db.doc(`tenants/${comercio.tenantId}/config/${docVertical}`).get()
        : Promise.resolve(null),
      // Rótulos del cobro simulado: los mismos para TODOS los comercios.
      comercio.flujo === 'venta'
        ? db.doc('plataforma/cobroSimulado').get()
        : Promise.resolve(null),
    ]);

    const negocio = (config.data() ?? {}) as Record<string, unknown>;

    // --- CAMPOS DERIVADOS -------------------------------------------------
    // Se calculan acá y NUNCA se leen de la configuración, aunque aparecieran.
    // Las reglas ya impiden guardarlos; esto es la segunda barrera sobre el
    // vector más serio: un comercio que se fija `estadoComercio: 'activo'` y
    // sigue siendo atendido después de que lo suspendieron.
    const derivados = {
      estadoComercio: comercio.estado,          // de la ficha del tenant
      phoneNumberId,                            // del número que validó la firma
      horarioAtencion: horarioAtencion(negocio['horarios']),
      datosQueNoTenemos: datosQueNoTenemos(negocio),
    };

    // --- TEXTO LIBRE, ROTULADO --------------------------------------------
    // Sale en su propia sección para que el flujo lo inserte delimitado y
    // marcado como DATO DEL NEGOCIO. Nunca por delante de las reglas de
    // comportamiento del agente.
    const datosDelNegocio: Record<string, unknown> = {};
    for (const clave of CAMPOS_LIBRES_AL_PROMPT) {
      if (negocio[clave] !== undefined) datosDelNegocio[clave] = negocio[clave];
    }
    datosDelNegocio['datosQueNoTenemos'] = derivados.datosQueNoTenemos;

    respuesta.status(200).json({
      tenantId: comercio.tenantId,
      flujo: comercio.flujo,
      estadoComercio: derivados.estadoComercio,
      phoneNumberId: derivados.phoneNumberId,

      // Operación: valores estructurados, sin texto libre.
      operacion: {
        zonaHoraria: negocio['zonaHoraria'] ?? 'America/La_Paz',
        moneda: negocio['moneda'] ?? 'BOB',
        numeroRecepcion: negocio['numeroRecepcion'] ?? '',
        calendarioId: negocio['calendarioId'] ?? '',
        horarioAtencion: derivados.horarioAtencion,
        prefijosPermitidos: Array.isArray(negocio['prefijosPermitidos'])
          ? (negocio['prefijosPermitidos'] as unknown[]).slice(0, 10)
          : [],
      },

      // Voz del agente: FRASES NUESTRAS, elegidas por un enumerado del comercio.
      // El valor que escribió el cliente no se interpola en ninguna parte.
      instruccionesDeVoz: instruccionesDeVoz(negocio),

      // Todo lo que escribió el comercio, junto y rotulado.
      datosDelNegocio,

      catalogo: catalogo.docs.map((d) => ({ id: d.id, ...d.data() })),

      // Configuración del vertical, en su propia clave. El flujo del Demo A no
      // recibe `venta` y el del Demo B no recibe `agendamiento`: cada uno ve
      // solo lo que sabe usar.
      ...(docVertical && especifica?.exists
        ? { [docVertical]: especifica.data() }
        : {}),

      // PROHIBICIÓN 3. Los rótulos van SIEMPRE que el vertical sea de cobro, y
      // salen de plataforma, nunca de la configuración del comercio. Si el
      // documento faltara, rigen los de respaldo: el sistema falla hacia el
      // rótulo, jamás hacia el silencio.
      ...(comercio.flujo === 'venta'
        ? { cobroSimulado: {
              ...rotulosCobroSimulado(rotulos?.data()),
              // Sin media ID no hay QR que enviar, y eso es lo correcto: mejor
              // no mandar nada que mandar una imagen sin rotular.
              mediaIdQr: String(especifica?.get('mediaIdQr') ?? ''),
            } }
        : {}),

      // Siempre al menos uno. Si el comercio no cargó ninguno, viene el
      // funcionario por defecto con el calendario del negocio: el flujo tiene un
      // solo camino de código y el comercio de una sola persona no configura nada.
      funcionarios: resolverFuncionarios(
        funcionarios.docs.map((d) => ({ id: d.id, datos: d.data() })),
        negocio,
        new Set(catalogo.docs.map((d) => d.id)),
      ),
    });
  },
);
