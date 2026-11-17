// PREPARAR GUARDADO SALIENTE (módulo común de medios, plan «imágenes enviadas por el asistente», 16/11/2026, bloque 2a): decide si lo que el flujo ACABA de
// enviar al cliente es una IMAGEN del asistente que se guarda en la consola para el control de calidad, y con qué datos se baja.
//
// Corre en su PROPIA rama, colgada de «Reportar mensaje (saliente)» (el servidor exige el saliente YA registrado por la ingesta: mismo `idMeta`, tipo `image`,
// 30 minutos) y DESPUÉS de todo envío al cliente: nada de lo que pase acá cambia lo que recibe el cliente, ni su orden, ni suma un mensaje. Devuelve `[]` (la
// rama termina en silencio) para cualquier ítem que no sea una imagen aceptada por Meta; un texto, un botón, una lista o una imagen que viaja de encabezado
// de un interactivo NO se guardan (el servidor solo admite un saliente de tipo `image`).
//
// QUÉ SE GUARDA, y por qué vía se obtiene (la bajan los nodos que siguen; este NO toca el binario ni hace llamadas):
//   `enlace` ... el envío fue por enlace https (`image.link`: el QR de cobro de `imagenDeCobro?f=…`): se hace GET del mismo enlace, sin credencial.
//   `media` .... el envío fue por media id de Meta (`image.id`): Graph, con la MISMA credencial de envío del flujo (GET /{id} → url → GET con la credencial).
// `GS_VIAS` (la cabecera que arma `guardado-saliente.mjs` para cada flujo) dice cuáles vías tiene la rama de ESE flujo: una imagen cuya vía no está se omite.
//
// LA VOZ DEL SERVIDOR MANDA: la bandera `guardarMedios` de la ficha y los topes (tamaño, cupo diario, 30 minutos) los aplica `guardarMedio`; esta rama no
// reintenta nada y registra nada más. Nunca corta el turno: todo nodo de red de la rama sigue con `onError: continueRegularOutput`.
//
// `GS_FUENTE(i)` la define la cabecera: para el ítem `i` de la entrada devuelve { meta, payload, tipoReporte, telefono, version? } con los NOMBRES DE NODO
// LITERALES de cada flujo (el task runner de n8n solo precarga los nodos nombrados así). Un ítem cuya fuente falla se omite (no hay cómo saber qué se envió).
// JavaScript plano del nodo Code de n8n: sin require, URL, Buffer ni crypto.
const gsVias = Array.isArray(GS_VIAS) ? GS_VIAS.map((v) => String(v)) : [];
const gsEntrada = $input.all();
const gsSalida = [];
// Solo https, con un anfitrión de nombre (sin usuario, sin IP ni «localhost»: el enlace sale de la configuración del negocio, pero el flujo no se vuelve un cliente HTTP
// a cualquier parte). Sin espacios ni controles; hasta 2000 caracteres.
const gsEnlaceSeguro = (t) => typeof t === 'string' && t.length <= 2000 && /^https:\/\/([a-z0-9-]+\.)+[a-z][a-z0-9-]*(:\d{1,5})?([/?#][\x21-\x7e]*)?$/i.test(t) && !/^https:\/\/(localhost|[0-9.]+)([:/?#]|$)/i.test(t);
for (let gsI = 0; gsI < gsEntrada.length; gsI++) {
  try {
    const gsF = GS_FUENTE(gsI) || {};
    // Solo lo que el armado del flujo reportó como imagen Y lo que de verdad se envió como imagen (no un interactivo con la imagen de encabezado).
    if (gsF.tipoReporte !== 'image') continue;
    const gsPayload = gsF.payload && typeof gsF.payload === 'object' ? gsF.payload : null;
    if (!gsPayload || gsPayload.type !== 'image' || !gsPayload.image || typeof gsPayload.image !== 'object') continue;
    // Meta tiene que haberlo aceptado: el id del mensaje (wamid) sale de SU respuesta; sin él no hay mensaje registrado que guardar.
    const gsMeta = gsF.meta && typeof gsF.meta === 'object' ? gsF.meta : {};
    if (gsMeta.error) continue;
    const gsIdMeta = String((((gsMeta.messages || [])[0]) || {}).id || '');
    const gsTelefono = String(gsF.telefono || '');
    // Lo que el servidor exige: teléfono de 8 a 15 dígitos y el id del MENSAJE sin espacios ni controles. Si el payload trae el destinatario, es el mismo.
    if (!/^\d{8,15}$/.test(gsTelefono) || !/^[\x21-\x7e]{1,200}$/.test(gsIdMeta)) continue;
    if (gsPayload.to !== undefined && String(gsPayload.to).replace(/\D/g, '') !== gsTelefono) continue;
    const gsImagen = gsPayload.image;
    const gsMediaId = typeof gsImagen.id === 'string' ? gsImagen.id : '';
    const gsEnlace = typeof gsImagen.link === 'string' ? gsImagen.link : '';
    const gsVersion = /^v\d+\.\d$/.test(String(gsF.version || '')) ? String(gsF.version) : 'v26.0';
    let gsVia = '';
    if (/^[A-Za-z0-9_-]{1,100}$/.test(gsMediaId) && !gsEnlace) gsVia = 'media';
    else if (gsEnlaceSeguro(gsEnlace) && !gsMediaId) gsVia = 'enlace';
    if (!gsVia || gsVias.indexOf(gsVia) < 0) continue;
    gsSalida.push({ json: {
      telefono: gsTelefono,
      idMeta: gsIdMeta,
      tipo: 'image',
      via: gsVia,
      mediaId: gsVia === 'media' ? gsMediaId : '',
      enlace: gsVia === 'enlace' ? gsEnlace : '',
      waGraphVersion: gsVersion,
    }, pairedItem: { item: gsI } });
  } catch (gsError) {
    // Sin respuesta que reconstruir: este ítem no se guarda y el turno sigue.
  }
}
return gsSalida;
