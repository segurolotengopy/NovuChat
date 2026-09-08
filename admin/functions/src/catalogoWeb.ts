/**
 * =============================================================================
 * CATÁLOGO WEB PROPIO — el enlace, el sitio y el carrito que vuelve
 * =============================================================================
 *
 * QUÉ RESUELVE, dicho en una línea: que el pedido que arma un cliente final
 * llegue al asistente SIN PASAR POR SU TELÉFONO.
 *
 * Es la diferencia entera con las plataformas externas de
 * `Analisis/10-catalogo-plataformas-externas.md`. Ahí el pedido vuelve como un
 * mensaje de WhatsApp que el cliente puede editar antes de mandarlo: un pedido
 * de 350 Bs llega diciendo 35, y el comercio se entera cuando ya despachó. Acá
 * el carrito viaja de servidor a servidor —del sitio del catálogo a esta
 * función— y **el navegador nunca manda precios**: manda identificadores y
 * cantidades. El precio lo vuelve a leer esta función del catálogo de la
 * consola, que es la única fuente de verdad. No hay nada que falsificar porque
 * no hay ningún número del cliente en el que confiar.
 *
 * LAS TRES PIEZAS
 * ---------------
 *   enlaceCatalogo    n8n pide un enlace para ESTA conversación. Devuelve una
 *                     URL con una ficha opaca que caduca.
 *   catalogoPublico   el navegador del cliente pide qué vender. Sin sesión,
 *                     con la ficha como única llave.
 *   checkoutCatalogo  vuelve el carrito. Se recalcula, se guarda como pedido y
 *                     se despierta al flujo de n8n.
 *
 * LA FICHA, Y POR QUÉ NO EL TELÉFONO EN LA URL
 * --------------------------------------------
 * Un enlace con el número adentro termina en el historial del navegador, en el
 * `Referer` de cualquier imagen alojada por terceros y en los registros de todo
 * intermediario. La ficha es un identificador opaco de 128 bits que no dice
 * nada por sí mismo y que solo esta función sabe traducir a una conversación.
 *
 * Y CADUCA. Un enlace de WhatsApp se reenvía sin pensarlo. Sin caducidad, el
 * carrito que arma un desconocido tres semanas después entraría en la
 * conversación de otra persona: el comercio vería un pedido a nombre de quien
 * no lo hizo. Con caducidad, el daño tiene fecha de vencimiento; y como además
 * se cuenta cuántos carritos llegaron por la misma ficha, un enlace que se
 * compartió se marca como tal y el asistente lo confirma antes de despachar.
 *
 * LO QUE ESTA FUNCIÓN NO HACE, A PROPÓSITO
 * ----------------------------------------
 * No manda ningún mensaje de WhatsApp. Quien habla con Meta es n8n y nadie más:
 * meter un segundo emisor de mensajes crearía un segundo lugar donde se puede
 * violar la prohibición 3 de CLAUDE.md. Acá se guarda el pedido y se despierta
 * al flujo; el flujo decide qué decir, con qué voz y —si la ventana de 24 horas
 * se cerró— con qué plantilla.
 */
import { onRequest, onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { defineString } from 'firebase-functions/params';
import { REGION } from './region.js';
import { SECRETOS_POR_ALIAS, rutaAutenticada } from './firma.js';
// `enmascarar` sale de `ingesta.ts` y no de `firma.ts`, que tiene la suya con
// otro recorte. Las dos pasan la regla, pero un mismo teléfono se vería
// enmascarado de dos formas distintas según qué lo escribió, y eso hace
// imposible cruzar un pedido con su bitácora de un vistazo.
import { registrar, enmascarar } from './ingesta.js';
// El umbral vive en `prompt.ts` y no acá: lo usan este módulo y
// `configuracionFlujo`, y si viviera en uno de los dos el otro tendría que
// importar a su propio importador. Un ciclo en ESM se resuelve en un orden
// donde la constante todavía no está inicializada, y falla en ejecución.
import { UMBRAL_CATALOGO_AL_PROMPT } from './prompt.js';

const db = () => getFirestore();

const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const FICHA = /^[0-9a-f]{32}$/;
const TELEFONO = /^[0-9]{8,15}$/;

/**
 * DÓNDE VIVE EL SITIO PÚBLICO. Se configura al desplegar
 * (`SITIO_PUBLICO=https://catalogo.ejemplo.com`) y, si no se configura, se
 * deriva del proyecto: `https://<proyecto>.web.app`. El valor por defecto
 * existe para que el sistema funcione recién desplegado y sin ceremonia; el
 * parámetro existe porque el día que el catálogo tenga dominio propio, cambiarlo
 * no puede exigir tocar código.
 */
const SITIO_PUBLICO = defineString('SITIO_PUBLICO', { default: '' });

function baseDelSitio(): string {
  const configurado = SITIO_PUBLICO.value().trim().replace(/\/+$/, '');
  if (configurado.startsWith('https://')) return configurado;
  const proyecto = process.env['GCLOUD_PROJECT'] ?? process.env['GCP_PROJECT'] ?? '';
  return proyecto ? `https://${proyecto}.web.app` : '';
}

/**
 * VIDA DE LA FICHA: 72 HORAS.
 *
 * El número sale de una tensión concreta y no de un redondeo. Por abajo lo
 * empuja la ventana de atención de WhatsApp: si la ficha durara 24 horas, el
 * caso que motivó decidir la plantilla de «tu carrito te espera» —el cliente
 * que navega, se distrae y vuelve al día siguiente— no llegaría nunca a
 * ocurrir, porque el enlace ya estaría muerto. Por arriba lo empuja el reenvío:
 * cuanto más vive un enlace, más probable es que termine en un grupo.
 *
 * Tres días cubren el fin de semana, que es cuando un comercio de gastronomía
 * factura, y no llegan a la semana siguiente.
 */
const VIDA_FICHA_HORAS = 72;

/**
 * CUÁNTOS CARRITOS ADMITE UNA MISMA FICHA: cinco.
 *
 * No es uno. Un cliente que pide, se arrepiente y vuelve a pedir es normal, y
 * una ficha de un solo uso convertiría eso en «el enlace ya no funciona», que
 * es una falla que el cliente atribuye al comercio. Cinco alcanza para el uso
 * legítimo y hace que un enlace reenviado a un grupo no se convierta en un
 * generador de pedidos falsos. A partir del segundo, el pedido viaja marcado
 * con `fichaCompartida` y el asistente lo confirma antes de despachar.
 */
const MAX_CHECKOUTS_POR_FICHA = 5;

/** Tope de líneas de un carrito y de unidades por línea. */
const MAX_LINEAS = 50;
const MAX_UNIDADES = 99;

/**
 * VENTANA DE ATENCIÓN DE WHATSAPP. Mismo valor que `ingesta.ts`, y no se
 * importa de allá para no arrastrar todo ese módulo: son 24 horas fijadas por
 * Meta, no un parámetro nuestro.
 */
const HORAS_VENTANA = 24;

const texto = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.slice(0, max).trim() : '';

/**
 * =============================================================================
 * SIN PRECIO NO SE PUBLICA
 * =============================================================================
 *
 * Un ítem sin precio significa «a consultar»: hay que evaluar, medir, ver el
 * stock o hablar con alguien antes de poder venderlo. En la consola y en el
 * prompt del asistente eso está perfecto —el asistente tiene que saber que el
 * negocio lo ofrece, para no decir que no existe—. En una página con botón de
 * comprar, no.
 *
 * EL PORQUÉ, y es comercial antes que técnico
 * (`Analisis/19-catalogo-web-y-precio-por-flujo.md` §5):
 *
 *   «Publicar en el catálogo web algo que no se puede comprar es la forma más
 *    cara de generar una conversación: el cliente pregunta, el asistente no
 *    puede cerrar, y son mensajes pagados sin venta.»
 *
 * Desde el 1 de octubre cada mensaje del asistente se paga, así que un ítem sin
 * precio en la vitrina no es una oportunidad de venta: es una conversación
 * garantizada que no puede terminar en nada.
 *
 * LO QUE ESTA REGLA NO CUBRE, dicho para que nadie suponga de más. El análisis
 * nombra tres clases que tampoco deberían publicarse —sin stock, a medida, y lo
 * que necesita instalación— y de las tres el sistema solo sabe reconocer esta.
 * Distinguir las otras exige una marca por ítem en la consola, que no existe.
 * Mientras tanto, el comercio las saca dándolas de baja.
 */
/*
 * `Number.isFinite` y no `typeof === 'number'`, que fue la primera versión.
 * En JavaScript `typeof NaN` es `'number'`, así que un precio `NaN` —de un
 * script viejo, de una importación mal hecha— pasaba el filtro, se publicaba, y
 * el checkout calculaba `NaN * cantidad`: un pedido con total `NaN` guardado en
 * la base y mandado al flujo. Las reglas de Firestore ya lo rechazan por el
 * lado de la consola (`precio >= 0` es falso para `NaN`), pero el SDK Admin se
 * las saltea. Lo destapó escribir la prueba, no leer el código.
 */
export const sePuedeComprar = (d: Record<string, unknown> | undefined): boolean =>
  Number.isFinite(d?.['precio']);

// ---------------------------------------------------------------------------
// URL DE IMAGEN — la validación que decide qué puede pintar el navegador
// ---------------------------------------------------------------------------

/**
 * Una URL de imagen sirve si —y solo si— es `https://`, no trae credenciales
 * embebidas y no apunta a un nombre que resuelva dentro de la red privada.
 *
 * Las tres condiciones responden a cosas distintas:
 *
 *  - **`https` y nada más.** `javascript:` y `data:` en un atributo `src` son
 *    dos vías de ejecución conocidas; `http://` haría que la página del
 *    catálogo cargue contenido mixto y el navegador lo bloquee sin avisar, que
 *    para el comercio se ve como «no se ven las fotos» sin ninguna pista.
 *  - **Sin usuario ni contraseña en la URL.** Es una forma clásica de
 *    disfrazar el destino real de un enlace.
 *  - **Sin destinos internos.** Nadie las va a buscar desde el servidor —el
 *    navegador del cliente es quien las carga— pero dejar entrar
 *    `http://169.254.169.254/…` al catálogo es sembrar el día que alguien
 *    agregue una miniatura del lado servidor.
 *
 * Se exporta porque la consola valida lo mismo antes de guardar: el navegador
 * avisa, el servidor decide.
 */
export function urlImagenValida(valor: unknown): boolean {
  if (typeof valor !== 'string' || valor === '' || valor.length > 500) return false;
  let u: URL;
  try { u = new URL(valor); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  if (u.username !== '' || u.password !== '') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (/^(127|10|169\.254)\./.test(h)) return false;
  if (/^192\.168\./.test(h)) return false;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return false;
  if (h === '[::1]' || h === '0.0.0.0') return false;
  return true;
}

/**
 * Color de marca del comercio. SOLO `#rrggbb`.
 *
 * Se pinta metiéndolo en una propiedad personalizada de CSS, así que un valor
 * libre es una inyección de CSS: `red;} body{background:url(http://…)` filtra
 * la visita a un tercero sin ejecutar una línea de JavaScript. Un enumerado de
 * seis hexadecimales elimina el problema en vez de intentar limpiarlo, que es
 * el mismo criterio con el que la voz del asistente es un enumerado y no texto
 * libre.
 */
export function colorValido(valor: unknown): boolean {
  return typeof valor === 'string' && /^#[0-9a-fA-F]{6}$/.test(valor);
}

// ---------------------------------------------------------------------------
// LECTURA DE LA FICHA
// ---------------------------------------------------------------------------

interface Ficha {
  id: string;
  tenantId: string;
  telefono: string;
  phoneNumberId: string;
  checkouts: number;
  caducaEn: Timestamp;
}

/**
 * Devuelve la ficha si existe, no caducó y su comercio sigue activo. `null` en
 * cualquier otro caso, y SIN decir cuál: distinguir «no existe» de «caducó» le
 * regala a quien prueba fichas al azar la confirmación de que acertó una.
 */
async function fichaVigente(id: string): Promise<Ficha | null> {
  if (!FICHA.test(id)) return null;
  const doc = await db().doc(`fichasCatalogo/${id}`).get();
  if (!doc.exists) return null;

  const caducaEn = doc.get('caducaEn') as Timestamp | undefined;
  if (!caducaEn || caducaEn.toMillis() <= Date.now()) return null;

  const tenantId = String(doc.get('tenantId') ?? '');
  if (!ID_TENANT.test(tenantId)) return null;

  const tenant = await db().doc(`tenants/${tenantId}`).get();
  if (!tenant.exists || tenant.get('estado') !== 'activo') return null;

  return {
    id,
    tenantId,
    telefono: String(doc.get('telefono') ?? ''),
    phoneNumberId: String(doc.get('phoneNumberId') ?? ''),
    checkouts: Number(doc.get('checkouts') ?? 0),
    caducaEn,
  };
}

// ---------------------------------------------------------------------------
// 1) enlaceCatalogo — lo llama n8n cuando el asistente decide derivar al sitio
// ---------------------------------------------------------------------------

/**
 * Entrada: `{ telefono }`. Autenticación: la misma de la ingesta —firma HMAC o
 * token, por número—, así que el comercio sale de `/rutasWhatsApp` y JAMÁS del
 * cuerpo. Aunque n8n mandara `tenantId`, se ignora.
 *
 * Salida: `{ url, caducaEn, items, catalogoGrande }`.
 *
 * `items` y `catalogoGrande` viajan de vuelta para que el flujo sepa —sin hacer
 * otra consulta— si el catálogo ya lo tiene en el prompt o si tiene que
 * apoyarse en el enlace. Es el punto 7 del diseño, resuelto donde se sabe la
 * respuesta: la consola es la que cuenta cuántos ítems hay.
 */
export const enlaceCatalogo = onRequest(
  {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    // Servidor a servidor. Que un navegador no pueda llamarlo elimina de raíz
    // que una página cualquiera fabrique enlaces a conversaciones ajenas.
    cors: false,
    maxInstances: 10,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    const ruta = await rutaAutenticada(peticion);
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }
    if (!ID_TENANT.test(ruta.tenantId)) { respuesta.status(404).send('numero no asignado'); return; }
    if (ruta.estado !== 'activo') { respuesta.status(409).json({ estado: ruta.estado }); return; }

    const cuerpo = (peticion.body ?? {}) as Record<string, unknown>;
    const telefono = texto(cuerpo['telefono'], 20).replace(/\D/g, '');
    if (!TELEFONO.test(telefono)) {
      respuesta.status(400).json({ error: 'telefono' }); return;
    }

    const base = baseDelSitio();
    if (base === '') {
      // Falla ruidosa y temprana. Un enlace a medio armar mandaría al cliente a
      // una página que no existe, y eso se descubre con el cliente adentro.
      respuesta.status(500).json({ error: 'sitio no configurado' }); return;
    }

    const [config, catalogo] = await Promise.all([
      db().doc(`tenants/${ruta.tenantId}/config/negocio`).get(),
      db().collection(`tenants/${ruta.tenantId}/catalogo`)
        .where('activo', '==', true).limit(501).get(),
    ]);

    // EL COMERCIO TIENE QUE HABERLO ENCENDIDO. Publicar el catálogo de alguien
    // que no lo pidió es publicar sus precios en una dirección adivinable por
    // quien tenga un enlace viejo. El valor por defecto es apagado.
    if (config.get('catalogoWebActivo') !== true) {
      respuesta.status(409).json({ error: 'catalogo web apagado' }); return;
    }
    // NO ALCANZA CON QUE HAYA ÍTEMS: tiene que haber al menos uno CON PRECIO.
    // Un salón cuyo catálogo entero se cotiza tiene ítems activos y una vitrina
    // vacía, y mandar a alguien a una tienda vacía es peor que no mandarlo.
    // Antes esto se comprobaba con `catalogo.empty` y se le habría mandado el
    // enlace igual.
    const vendibles = catalogo.docs.filter(
      (d) => sePuedeComprar(d.data() as Record<string, unknown>)).length;
    if (vendibles === 0) {
      respuesta.status(409).json({ error: 'catalogo sin items vendibles' }); return;
    }

    const id = randomBytes(16).toString('hex');
    const caducaEn = Timestamp.fromMillis(Date.now() + VIDA_FICHA_HORAS * 3_600_000);

    await db().doc(`fichasCatalogo/${id}`).create({
      tenantId: ruta.tenantId,
      telefono,
      phoneNumberId: ruta.phoneNumberId,
      flujo: ruta.flujo,
      creadaEn: Timestamp.now(),
      caducaEn,
      checkouts: 0,
    });

    await registrar(ruta.tenantId, {
      tipo: 'catalogo_enlace', resultado: 'ok', telefono,
      conversacionId: `wa_${telefono}`, detalle: `items=${vendibles}/${catalogo.size}`,
    });

    respuesta.status(200).json({
      url: `${base}/c/${id}`,
      caducaEn: caducaEn.toDate().toISOString(),
      // `items` es lo que el cliente va a VER, no lo que el comercio tiene
      // cargado. Si el flujo dijera «tenemos 300 productos» y la página muestra
      // 40, el asistente queda mintiendo por un dato nuestro.
      items: vendibles,
      catalogoGrande: catalogo.size > UMBRAL_CATALOGO_AL_PROMPT,
    });
  },
);

// ---------------------------------------------------------------------------
// 2) catalogoPublico — lo pide el navegador del cliente final
// ---------------------------------------------------------------------------

interface ItemPublico {
  id: string; nombre: string; descripcion: string; area: string;
  precio: number | null; moneda: string; imagenUrl: string;
}

/** Lo que se publica de cada ítem: nada de sellos de auditoría ni de duración. */
function itemPublico(id: string, d: Record<string, unknown>): ItemPublico {
  const precio = typeof d['precio'] === 'number' ? d['precio'] : null;
  return {
    id,
    nombre: texto(d['nombre'], 80),
    descripcion: texto(d['descripcion'], 300),
    area: texto(d['area'], 40),
    precio,
    moneda: precio === null ? '' : (d['moneda'] === 'USD' ? 'USD' : 'BOB'),
    imagenUrl: urlImagenValida(d['imagenUrl']) ? String(d['imagenUrl']) : '',
  };
}

export const catalogoPublico = onRequest(
  { region: REGION, cors: false, maxInstances: 20 },
  async (peticion, respuesta) => {
    if (peticion.method !== 'GET') { respuesta.status(405).send('metodo'); return; }

    // La ficha viene en el último segmento: /api/catalogo/<ficha>
    const id = String(peticion.path.split('/').filter(Boolean).pop() ?? '');
    const ficha = await fichaVigente(id);
    if (!ficha) { respuesta.status(404).json({ error: 'enlace vencido' }); return; }

    const [config, venta, catalogo] = await Promise.all([
      db().doc(`tenants/${ficha.tenantId}/config/negocio`).get(),
      db().doc(`tenants/${ficha.tenantId}/config/venta`).get(),
      // SIN `orderBy`, Y NO ES UN DESCUIDO. Combinar un filtro de igualdad con
      // un orden por OTRO campo exige un índice compuesto en Firestore. El
      // emulador no lo exige —responde cualquier consulta— así que el fallo no
      // aparecería en ninguna prueba local: aparecería en producción, con «The
      // query requires an index», la primera vez que un cliente real abriera el
      // enlace. Es exactamente el agujero que documenta `pruebas/indices.test.ts`.
      //
      // Ordenar acá cuesta cero: son 500 documentos como mucho, ya están en
      // memoria, y así el catálogo no le agrega un índice más —con su costo en
      // cada escritura— a una colección que el comercio edita todas las semanas.
      db().collection(`tenants/${ficha.tenantId}/catalogo`)
        .where('activo', '==', true).limit(500).get(),
    ]);

    if (config.get('catalogoWebActivo') !== true) {
      respuesta.status(404).json({ error: 'enlace vencido' }); return;
    }

    const logoUrl = config.get('logoUrl');
    const colorMarca = config.get('colorMarca');

    // NADA DE CACHÉ. La respuesta está atada a una conversación: en un teléfono
    // prestado o en un proxy compartido, una copia guardada es el catálogo —y
    // el enlace— de otra persona.
    respuesta.set('Cache-Control', 'no-store');
    respuesta.set('X-Content-Type-Options', 'nosniff');
    respuesta.status(200).json({
      negocio: {
        nombre: texto(config.get('nombreNegocio'), 80),
        descripcion: texto(config.get('descripcion'), 400),
        direccion: texto(config.get('direccion'), 200),
        moneda: config.get('moneda') === 'USD' ? 'USD' : 'BOB',
        logoUrl: urlImagenValida(logoUrl) ? String(logoUrl) : '',
        colorMarca: colorValido(colorMarca) ? String(colorMarca) : '',
      },
      // Condiciones de entrega, si el comercio vende. Se muestran ANTES del
      // checkout: enterarse del costo de envío después de confirmar es la queja
      // más común de cualquier tienda, y acá además la contestaría el asistente.
      //
      // LOS NOMBRES SON LOS DE `/config/venta` y no unos propios. Traducir
      // `costoDelivery` a `costoEnvio` en la frontera habría creado dos
      // vocabularios para lo mismo, y el día que alguien agregue un campo va a
      // tener que acordarse de traducirlo en tres archivos.
      //
      // `recargoFlota` NO viaja, a propósito: es un recargo que el asistente
      // aplica cuando el reparto lo hace un tercero, y depende de la
      // conversación. Mostrarlo acá como si fuera parte del precio del envío
      // sería anunciar un costo que quizá no corresponda.
      entrega: {
        costoDelivery: typeof venta.get('costoDelivery') === 'number'
          ? venta.get('costoDelivery') : null,
        pedidoMinimo: typeof venta.get('pedidoMinimo') === 'number'
          ? venta.get('pedidoMinimo') : null,
        aceptaDelivery: venta.get('aceptaDelivery') !== false,
        aceptaRetiroEnLocal: venta.get('aceptaRetiroEnLocal') !== false,
      },
      // Por área y después por nombre: el sitio agrupa por área, y dentro de un
      // área una lista alfabética es la única que una persona puede recorrer.
      // `localeCompare` con 'es' para que «Ñoquis» caiga entre «Nachos» y
      // «Papas», y no al final de todo como haría una comparación de bytes.
      items: catalogo.docs
        .filter((d) => sePuedeComprar(d.data() as Record<string, unknown>))
        .map((d) => itemPublico(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => a.area.localeCompare(b.area, 'es')
          || a.nombre.localeCompare(b.nombre, 'es')),
      caducaEn: ficha.caducaEn.toDate().toISOString(),
    });
  },
);

// ---------------------------------------------------------------------------
// 3) checkoutCatalogo — vuelve el carrito
// ---------------------------------------------------------------------------

interface LineaPedida { id: string; cantidad: number }

/** Lee del cuerpo SOLO identificadores y cantidades. Ningún precio. */
function lineasPedidas(cuerpo: Record<string, unknown>): LineaPedida[] {
  const crudas = Array.isArray(cuerpo['items']) ? cuerpo['items'] : [];
  const vistas = new Set<string>();
  const lineas: LineaPedida[] = [];
  for (const cruda of crudas.slice(0, MAX_LINEAS)) {
    if (typeof cruda !== 'object' || cruda === null) continue;
    const c = cruda as Record<string, unknown>;
    const id = texto(c['id'], 80);
    // El identificador del ítem ES un segmento de ruta de Firestore. Que no
    // pueda traer barras ni puntos no es cosmética: es lo que impide que un
    // `id` fabricado apunte a otro documento.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id) || id.includes('..')) continue;
    if (vistas.has(id)) continue;
    const cantidad = Math.trunc(Number(c['cantidad']));
    if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > MAX_UNIDADES) continue;
    vistas.add(id);
    lineas.push({ id, cantidad });
  }
  return lineas;
}

export const checkoutCatalogo = onRequest(
  {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    cors: false,
    maxInstances: 20,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    // /api/catalogo/<ficha>/checkout
    const partes = peticion.path.split('/').filter(Boolean);
    const ficha = await fichaVigente(String(partes[partes.length - 2] ?? ''));
    if (!ficha) { respuesta.status(404).json({ error: 'enlace vencido' }); return; }

    if (ficha.checkouts >= MAX_CHECKOUTS_POR_FICHA) {
      respuesta.status(429).json({ error: 'demasiados pedidos con este enlace' }); return;
    }

    const cuerpo = (peticion.body ?? {}) as Record<string, unknown>;
    const lineas = lineasPedidas(cuerpo);
    if (lineas.length === 0) { respuesta.status(400).json({ error: 'carrito vacio' }); return; }

    const entrega = cuerpo['entrega'] === 'envio' ? 'envio' : 'retiro';
    const direccion = texto(cuerpo['direccion'], 200);
    const nota = texto(cuerpo['nota'], 300);
    if (entrega === 'envio' && direccion === '') {
      respuesta.status(400).json({ error: 'falta la direccion' }); return;
    }

    // -----------------------------------------------------------------------
    // AQUÍ ESTÁ LA GARANTÍA ENTERA DEL DISEÑO.
    //
    // Cada línea se resuelve leyendo el catálogo del comercio. El precio, el
    // nombre y la moneda salen de la consola; del navegador solo salieron un
    // identificador y una cantidad. Un cliente que edite el JavaScript de la
    // página no puede cambiar un precio, porque no hay ningún precio suyo que
    // esta función lea.
    //
    // Y se descarta lo que ya no se ofrece: un ítem dado de baja mientras el
    // cliente navegaba NO entra al pedido. La alternativa —cobrarlo igual—
    // haría que el comercio se comprometa a vender algo que retiró.
    // -----------------------------------------------------------------------
    const refs = lineas.map((l) => db().doc(`tenants/${ficha.tenantId}/catalogo/${l.id}`));
    const docs = await db().getAll(...refs);

    const items: Array<Record<string, unknown>> = [];
    const descartados: string[] = [];
    let total = 0;
    let monedaPedido = '';

    for (let i = 0; i < lineas.length; i += 1) {
      const linea = lineas[i] as LineaPedida;
      const doc = docs[i];
      if (!doc || !doc.exists || doc.get('activo') !== true) {
        descartados.push(linea.id); continue;
      }
      const d = doc.data() as Record<string, unknown>;

      // SE FUE EL PRECIO ENTRE LA VISITA Y EL CHECKOUT. Pasa si el comercio lo
      // borró mientras el cliente elegía. Se trata igual que un ítem dado de
      // baja —se descarta y se avisa— porque es lo mismo: dejó de poder
      // comprarse por acá. Aceptarlo obligaría a arrastrar un pedido sin total,
      // que es justo lo que la regla de arriba existe para evitar.
      if (!sePuedeComprar(d)) { descartados.push(linea.id); continue; }

      const precio = d['precio'] as number;
      const moneda = d['moneda'] === 'USD' ? 'USD' : 'BOB';

      // MONEDAS MEZCLADAS NO SE SUMAN. Un total que suma bolivianos con dólares
      // es un número falso, y un número falso en un pedido es una promesa de
      // precio equivocada. Se rechaza el pedido entero, que es lo honesto.
      if (monedaPedido === '') monedaPedido = moneda;
      else if (monedaPedido !== moneda) {
        respuesta.status(409).json({ error: 'monedas mezcladas' }); return;
      }

      total += precio * linea.cantidad;

      items.push({
        id: linea.id,
        nombre: texto(d['nombre'], 80),
        cantidad: linea.cantidad,
        precio,
        moneda,
        subtotal: Number((precio * linea.cantidad).toFixed(2)),
        ...(urlImagenValida(d['imagenUrl']) ? { imagenUrl: String(d['imagenUrl']) } : {}),
      });
    }

    if (items.length === 0) {
      respuesta.status(409).json({ error: 'nada de lo pedido sigue disponible' }); return;
    }

    // Costo de envío: también del servidor, nunca del navegador.
    const venta = await db().doc(`tenants/${ficha.tenantId}/config/venta`).get();
    const costoEnvio = entrega === 'envio' && typeof venta.get('costoDelivery') === 'number'
      ? (venta.get('costoDelivery') as number) : 0;
    total = Number((total + costoEnvio).toFixed(2));

    const conversacionId = `wa_${ficha.telefono}`;
    const refConversacion = db().doc(`tenants/${ficha.tenantId}/conversaciones/${conversacionId}`);
    const conversacion = await refConversacion.get();

    // ¿SIGUE ABIERTA LA VENTANA DE 24 HORAS? Se calcula acá, con la misma ancla
    // que usa la ingesta (`atencionDesde`), y viaja al flujo. Que la decida esta
    // función y no n8n evita que dos relojes distintos den dos respuestas
    // distintas sobre el mismo pedido.
    const atencionDesde = conversacion.get('atencionDesde') as Timestamp | undefined;
    const ventanaAbierta = atencionDesde !== undefined
      && Date.now() - atencionDesde.toMillis() < HORAS_VENTANA * 3_600_000;

    const pedidoId = `cat_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
    const resumen = resumenDelPedido(items, entrega, total, monedaPedido);

    const lote = db().batch();
    lote.create(db().doc(`tenants/${ficha.tenantId}/pedidos/${pedidoId}`), {
      origen: 'catalogo-web',
      creadoEn: Timestamp.now(),
      conversacionId,
      // El teléfono completo ya vive en la conversación, que es donde
      // corresponde. Acá va enmascarado: el pedido se lista en pantalla y no
      // hay ninguna razón para repetir un dato personal en dos colecciones.
      telefonoEnmascarado: enmascarar(ficha.telefono),
      items,
      total,
      moneda: monedaPedido || (venta.get('moneda') === 'USD' ? 'USD' : 'BOB'),
      costoEnvio,
      entrega,
      ...(direccion ? { direccion } : {}),
      ...(nota ? { nota } : {}),
      ...(descartados.length ? { descartados } : {}),
      estado: 'recibido',
      ventanaAbierta,
      // Segundo carrito o más con la misma ficha: puede ser un cliente que se
      // arrepintió, o un enlace que se compartió. El asistente lo confirma.
      fichaCompartida: ficha.checkouts > 0,
      entregadoAlFlujo: false,
    });

    // El pedido entra en el hilo como mensaje de tipo `order`, que es el tipo
    // que ya existía para el carrito nativo de Meta. Así el visor de
    // conversaciones lo muestra en su lugar, en orden, sin pantalla nueva.
    lote.create(refConversacion.collection('mensajes').doc(), {
      direccion: 'entrante', tipo: 'order', texto: resumen, ts: Timestamp.now(),
    });
    // Solo el resumen del hilo. NO se tocan los contadores de facturación:
    // `atenciones` e `interacciones` las cuenta la ingesta con sus propias
    // marcas, y un carrito que entra por la web no debe moverlas por un camino
    // paralelo. Si algún día se decide que un carrito es una interacción, se
    // decide una vez y se cuenta allá.
    lote.set(refConversacion, {
      ultimoMensaje: resumen.slice(0, 300),
      ultimoEn: Timestamp.now(),
      mensajesTotal: FieldValue.increment(1),
    }, { merge: true });

    lote.update(db().doc(`fichasCatalogo/${ficha.id}`), {
      checkouts: FieldValue.increment(1),
      ultimoEn: Timestamp.now(),
    });

    await lote.commit();

    await registrar(ficha.tenantId, {
      tipo: 'carrito_recibido', resultado: 'ok', telefono: ficha.telefono,
      conversacionId, detalle: `items=${items.length} ventana=${ventanaAbierta ? 'abierta' : 'cerrada'}`,
    });

    // DESPERTAR AL FLUJO. Si falla, el pedido YA está guardado: la consola lo
    // muestra y el comercio no pierde la venta. Por eso se contesta 200 igual y
    // el fallo se anota, en vez de devolverle un error al cliente por algo que
    // no le compete.
    const entregado = await despertarFlujo(ficha, {
      tipo: 'carrito',
      pedidoId, conversacionId, telefono: ficha.telefono,
      items, total, moneda: monedaPedido, costoEnvio, entrega, direccion, nota,
      descartados,
      ventanaAbierta,
      // Fuera de la ventana, el flujo NO puede mandar un mensaje libre. Se le
      // dice qué plantilla usar; el texto y el idioma los decide él, que es
      // quien habla con Meta.
      accion: ventanaAbierta ? 'responder' : 'plantilla_carrito_espera',
      fichaCompartida: ficha.checkouts > 0,
    });

    if (entregado) {
      await db().doc(`tenants/${ficha.tenantId}/pedidos/${pedidoId}`)
        .update({ entregadoAlFlujo: true });
    } else {
      await registrar(ficha.tenantId, {
        tipo: 'error_flujo', resultado: 'fallo', telefono: ficha.telefono,
        conversacionId, detalle: 'no se pudo despertar el flujo',
      });
    }

    respuesta.set('Cache-Control', 'no-store');
    respuesta.status(200).json({
      ok: true,
      pedidoId,
      total,
      moneda: monedaPedido,
      descartados,
      // Lo que la página le dice al cliente. Distinto según la ventana, porque
      // la experiencia es distinta: con la ventana abierta el asistente le
      // contesta en segundos; con la ventana cerrada le va a llegar una
      // notificación y tiene que responderla para seguir.
      siguiente: ventanaAbierta ? 'respuesta' : 'notificacion',
    });
  },
);

/**
 * Resumen legible del pedido. Es lo que se ve en el visor de conversaciones y
 * lo que queda como `ultimoMensaje`, así que se arma acá una sola vez.
 */
function resumenDelPedido(
  items: Array<Record<string, unknown>>, entrega: string,
  total: number, moneda: string,
): string {
  const lineas = items.map((i) => `${String(i['cantidad'])}× ${String(i['nombre'])}`);
  return `Pedido desde el catálogo web (${entrega === 'envio' ? 'envío' : 'retiro'}): `
    + `${lineas.join(', ')} — total ${total} ${moneda || 'BOB'}`;
}

// ---------------------------------------------------------------------------
// DESPERTAR AL FLUJO DE n8n
// ---------------------------------------------------------------------------

/**
 * POST al webhook del flujo, autenticado con EL MISMO secreto por número que ya
 * usa la ingesta en el sentido contrario.
 *
 * POR QUÉ EL MISMO SECRETO Y NO UNO NUEVO. Es una clave compartida entre dos
 * partes que ya se autentican con ella; agregar una segunda duplicaría el
 * inventario de secretos, la rotación y el tramo de la puesta en marcha, a
 * cambio de ninguna propiedad nueva: quien tiene una tiene la otra.
 *
 * VAN LAS DOS FORMAS, y no es indecisión. `Authorization: Bearer` es lo que n8n
 * sabe verificar hoy con una credencial de autenticación por cabecera, sin
 * escribir código en el lienzo —y la prohibición 2 de CLAUDE.md dice que un
 * secreto no anda suelto en un nodo—. La firma HMAC viaja además para el día
 * que el flujo la verifique: cubre cuerpo y marca de tiempo, así que impide
 * reproducir una petición capturada. Poner las dos hoy hace que ese día no haya
 * que tocar esta función.
 *
 * EL DESTINO NO ES LIBRE. Sale de `/rutasWhatsApp`, que NINGÚN navegador
 * escribe —ni el del propietario—, y se vuelve a validar antes de usarlo. Si el
 * destino fuera configurable desde la consola, el primer comercio curioso
 * apuntaría el webhook a un servidor suyo y se llevaría el secreto en la
 * cabecera.
 */
async function despertarFlujo(ficha: Ficha, carga: Record<string, unknown>): Promise<boolean> {
  try {
    const ruta = await db().doc(`rutasWhatsApp/${ficha.phoneNumberId}`).get();
    const destino = String(ruta.get('webhookCarrito') ?? '');
    if (!destinoValido(destino)) return false;

    const alias = String(ruta.get('aliasSecreto') ?? '');
    const secreto = SECRETOS_POR_ALIAS[alias];
    if (!secreto) return false;

    const cuerpo = JSON.stringify({ tenantId: ficha.tenantId, ...carga });
    const marca = String(Date.now());
    const firma = createHmac('sha256', secreto.value())
      .update(`${marca}.`).update(cuerpo).digest('hex');

    const r = await fetch(destino, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secreto.value()}`,
        'X-NovuChat-Numero': ficha.phoneNumberId,
        'X-NovuChat-Timestamp': marca,
        'X-NovuChat-Signature': `sha256=${firma}`,
      },
      body: cuerpo,
      // Sin tope, un webhook colgado deja la función esperando y el cliente
      // final mirando una ruedita por algo que ya se guardó.
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Mismo criterio que las URL de imagen, con `http` prohibido por igual. */
function destinoValido(url: string): boolean {
  return urlImagenValida(url);
}

// ---------------------------------------------------------------------------
// 4) fijarWebhookCarrito — configuración, solo NovuChat
// ---------------------------------------------------------------------------

/**
 * Registra a dónde avisar cuando llega un carrito. Lo hace el propietario de
 * NovuChat y nadie más, por la razón de arriba: ese destino recibe una cabecera
 * con el secreto del número.
 *
 * Va en función aparte y no como un parámetro de `asignarNumero` porque
 * `asignarNumero` reemplaza el documento de la ruta: agregarlo ahí haría que
 * reasignar un número borrara el webhook en silencio.
 */
export const fijarWebhookCarrito = onCall({ region: REGION }, async (peticion: CallableRequest) => {
  const nc = (peticion.auth?.token?.['nc'] ?? {}) as { p?: boolean };
  if (!peticion.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.');
  if (nc.p !== true) throw new HttpsError('permission-denied', 'Solo NovuChat.');

  const datos = (peticion.data ?? {}) as Record<string, unknown>;
  const phoneNumberId = texto(datos['phoneNumberId'], 25);
  const url = texto(datos['url'], 500);
  if (!/^[0-9]{6,25}$/.test(phoneNumberId)) {
    throw new HttpsError('invalid-argument', 'phone_number_id inválido.');
  }
  // Cadena vacía = quitar el webhook. Es la manera de apagar la derivación sin
  // borrar la ruta entera.
  if (url !== '' && !destinoValido(url)) {
    throw new HttpsError('invalid-argument',
      'El webhook tiene que ser una URL https pública. Una dirección interna o '
      + 'un http no se acepta: por ahí viaja el secreto del número.');
  }

  const ref = db().doc(`rutasWhatsApp/${phoneNumberId}`);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'Ese número no está asignado.');
  await ref.update({ webhookCarrito: url === '' ? FieldValue.delete() : url });
  return { ok: true };
});

/**
 * Comparación en tiempo constante, disponible para quien tenga que verificar
 * una firma de vuelta. Se exporta desde acá y no se reimplementa en cada sitio:
 * un `===` sobre un secreto lo filtra por temporización.
 */
export function igualEnTiempoConstante(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
