// EL CATALOGO WEB, EN EL MISMO MENSAJE QUE LA RESPUESTA DEL AGENTE.
//
// QUE HACE. `Pedir enlace del catálogo` le pidio a `enlaceCatalogo` una
// direccion para ESTA conversacion y trajo la respuesta COMPLETA -codigo y
// cuerpo-. Aca se decide que texto sale: el del agente MAS la direccion, o el
// del agente sin ninguna promesa cuando no hubo direccion.
//
// POR QUE UN SOLO MENSAJE Y NO DOS. Desde el 01/10/2026 Meta cobra cada
// mensaje que envia el asistente (0,0113 USD por mensaje; «Base comercial» §1
// de CLAUDE.md). Mandar la direccion aparte duplicaria el costo de cada
// derivacion al catalogo, que es justamente la jugada que se hace para GASTAR
// MENOS conversacion. El mensaje se arma entero aca y sale una sola vez por
// `Responder al cliente`.
//
// SIN ENLACE NO SE PROMETE NADA (politica general de NovuChat, 21/09/2026: el
// asistente solo ofrece lo que el flujo cumple). Si el endpoint no devolvio
// una direccion usable -el comercio no lo encendio, no tiene items vendibles,
// la ruta no esta activa, se cayo la red- se QUITAN del texto del agente las
// oraciones que anuncian una pagina y se sigue por chat, que es lo que este
// flujo si sabe hacer: tomar el pedido conversando. Nunca «te lo mando en un
// rato», que no lo manda nadie.
//
// EL CODIGO SE EXAMINA, no se confia en que el nodo salio verde: `neverError`
// hace que un 409 llegue como respuesta y no como fallo, y cada codigo se
// trata por lo que es. Es la misma regla que `Config del negocio`: «nunca
// ignores el codigo».
//
// EL HOST SE COMPARA POR SEGMENTOS, NUNCA POR SUBCADENA. Reconocer un dominio
// con `includes` haria pasar por nuestra a `https://novuchat.otro-dominio.tld`.
//
// Y SE COMPARA SIN `new URL()`, QUE EN n8n NO EXISTE. El 23/09/2026 (ejecucion
// #4880, contra el telefono de Andres) `enlaceCatalogo` contesto 200 con una
// direccion buena -`items: 10`, `catalogoGrande: false`- y el cliente igual
// recibio el mensaje SIN enlace. La causa: el sandbox del nodo Code de n8n no
// trae los globales de Node, asi que `new URL(...)` lanzaba un ReferenceError,
// el `try/catch` lo tragaba y devolvia cadena vacia -indistinguible de «la URL
// no sirve»-. Aca la forma se valida con una expresion regular sobre la URL
// ENTERA, el host se parte en segmentos y se revisa segmento por segmento, y
// nada de esto necesita un global: solo `String`, `RegExp` y `Array`.
//
// Y EL FALLO INESPERADO YA NO SE CONFUNDE CON UNA URL MALA: si validar revienta
// por cualquier otro motivo, sale el aviso `catalogo_url_error` -distinto de
// `catalogo_url_invalida`-, para que la proxima vez se vea en la ejecucion en
// vez de quedar escondido.
const previos = $('Procesar respuesta').all();
const entradas = $input.all();

// El cierre invita a seguir POR CHAT, que es lo unico que este flujo cumple:
// el carrito que vuelve del sitio lo recoge otro flujo (el webhook del
// carrito), que este JSON no tiene. Prometer «tu pedido me llega solo» seria
// prometer lo que aca no ocurre.
const CIERRE = 'Cuando elijas, escríbeme por acá qué quieres y las cantidades, y cerramos el pedido.';
const SIN_ENLACE = 'Te tomo el pedido por acá mismo: dime qué quieres y las cantidades, y lo cerramos.';
// Oraciones que ANUNCIAN una direccion web. Si no hay enlace, se van enteras:
// una promesa sin respaldo se quita del texto, no se suaviza.
//
// EL PATRON SE AMPLIO EL 23/09/2026 PORQUE NO ATRAPO LO QUE EL MODELO ESCRIBIO
// DE VERDAD. Lo que le llego a Andres fue: «Puedes ver todos nuestros
// productos, fotos y precios directamente en el catalogo que te compartimos
// aqui», sin ningun enlace debajo. La version anterior pedia que «catalogo»
// viniera seguido de «web / en linea / digital», o que el VERBO viniera ANTES
// del sustantivo («te comparto el catalogo»); ahi el verbo va DESPUES («el
// catalogo que te compartimos») y el sustantivo va solo. Ninguna de las dos
// ramas cerraba.
//
// POR ESO AHORA SON SIETE RAMAS, y cada una tiene su prueba en
// `demo-b-catalogo.test.ts` («las formas con las que un modelo anuncia una
// pagina»). Se listan de lo mas literal a lo mas indirecto. Barrer de mas es
// barato -la oracion se reemplaza por `SIN_ENLACE`, que si se cumple-; barrer
// de menos es una promesa que nadie cumple, y eso es lo que la politica del
// 21/09/2026 prohibe.
// LOS LIMITES DE PALABRA SE ESCRIBEN A MANO. `\b` de JavaScript es ASCII: en
// «menú.» no hay frontera despues de la `ú` -- las dos son caracteres que `\b`
// considera «no palabra» -- asi que `\bmen[uú]\b` NO atrapa «menú». Con eso se
// escapaban dos de las formas mas comunes («acá te dejo el menú»), y por eso
// aca el principio y el final de palabra son estos dos, que si cuentan las
// vocales acentuadas y la enie.
const I = '(?<![\\wáéíóúüñÁÉÍÓÚÜÑ])';
const F = '(?![\\wáéíóúüñÁÉÍÓÚÜÑ])';
// Lo que el negocio vende, nombrado de cualquiera de estas maneras.
const LOVENDIDO = '(?:cat[aá]logo|men[uú]|carta|tienda|lista de productos|lista|'
  + 'productos|precios|fotos|nuestros productos)';
const ANUNCIA_ENLACE = new RegExp([
  // 1. Nombra una direccion, una pagina o una version en linea de lo que vende.
  I + '(?:enlaces?|links?|url|p[aá]ginas?|sitio web|nuestra web|en l[ií]nea|online|'
  + 'cat[aá]logo (?:web|en l[ií]nea|digital|virtual|online)|'
  + 'tienda (?:en l[ií]nea|virtual|online)|men[uú] (?:digital|en l[ií]nea|virtual))' + F,
  // 2. Invita a tocar o a entrar a algo.
  I + '(?:haz|haga|hac[eé]|dale) (?:clic|click)' + F,
  I + '(?:ingresa|ingrese|entra|entre|and[aá]|met[eé]te|visita|visite|navega|revisa|revis[aá])'
  + ' (?:a|al|en|nuestro|nuestra|el|la)' + F,
  // 3. «te comparto / mando / paso / envio / dejo / adjunto ... el catalogo».
  I + '(?:te|le|les) (?:comparto|compartimos|comparte|comparten|mando|mandamos|paso|pasamos|'
  + 'env[ií]o|enviamos|dejo|dejamos|adjunto|adjuntamos|muestro|mostramos)' + F
  + '[^.!?]{0,80}' + I + LOVENDIDO + F,
  // 4. El MISMO anuncio con el orden invertido, que es el que se escapo:
  //    «el catalogo que te compartimos», «la lista que te mando».
  I + LOVENDIDO + F + '[^.!?]{0,80}' + I + 'que (?:te|le|les) '
  + '(?:comparto|compartimos|comparte|comparten|mando|mandamos|paso|pasamos|'
  + 'env[ií]o|enviamos|dejo|dejamos|adjunto|adjuntamos)' + F,
  // 5. «puedes ver / revisar / mirar ... el catalogo, las fotos, los precios».
  I + '(?:pod[eé]s|puedes|puede|pueden|podr[aá]s|podr[aá]|pod[eé]is)'
  + ' (?:ver|verlo|verlos|verlas|revisar|mirar|consultar|explorar|navegar|recorrer|elegir)' + F
  + '[^.!?]{0,80}' + I + LOVENDIDO + F,
  // 6. «aca / aqui / abajo / a continuacion» apuntando a algo que se adjunta.
  I + '(?:ac[aá]|aqu[ií]|abajo|m[aá]s abajo|a continuaci[oó]n|adjunto|adjunta|seguidamente)' + F
  + '[^.!?]{0,60}' + I + LOVENDIDO + F,
  I + '(?:cat[aá]logo|men[uú]|carta)' + F
  + '[^.!?]{0,60}' + I + '(?:ac[aá]|aqu[ií]|abajo|m[aá]s abajo|a continuaci[oó]n|adjunto|adjunta)' + F,
  // 7. «en el siguiente/este enlace», «a traves de esta pagina».
  I + '(?:este|esta|el siguiente|la siguiente|a trav[eé]s de)' + F
  + '[^.!?]{0,30}' + I + '(?:enlace|link|p[aá]gina|cat[aá]logo|men[uú])' + F,
].join('|'), 'i');

// LO QUE EL AGENTE YA DIJO NO SE VUELVE A DECIR. `CIERRE` invita a volver por
// chat con lo elegido; si el propio texto del agente ya lo pide -«avisame
// cuando elijas», «escribeme que quieres y las cantidades»-, agregarlo seria
// la misma frase dos veces en un mensaje que se paga una sola vez. El patron
// es ESTRECHO a proposito: pide un verbo de pedido dirigido al asistente Y un
// complemento que hable de elegir o de que quiere. De menos se repite una
// linea; de mas se pierde la unica indicacion de como seguir.
const YA_INVITA_A_ESCRIBIR = new RegExp(
  I + '(?:escr[ií]beme|escr[ií]benos|av[ií]same|av[ií]sanos|d[ií]me|d[ií]nos|cu[eé]ntame|m[aá]ndame|p[aá]same|conf[ií]rmame)' + F
  + '[^.!?]{0,90}' + I + '(?:cuando (?:elijas|decidas|sepas|veas|termines|hayas)|'
  + 'qu[eé] (?:quieres|prefieres|te gust[oó]|elegiste|necesitas)|'
  + 'lo que (?:elijas|quieras|prefieras|elegiste|te guste))' + F,
  'i');

// La URL ENTERA, en una sola expresion: `https://`, host, puerto opcional y
// resto. El host se captura aparte para revisarlo por segmentos. Sin
// cuantificadores anidados sobre el mismo alfabeto, para que no haya vuelta
// atras cara con una entrada larga; y el largo se acota antes de mirar nada.
const RE_ENLACE = /^https:\/\/([A-Za-z0-9.-]{1,253})(?::(\d{1,5}))?([/?#][^\s]*)?$/;
const RE_SEGMENTO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const RE_TLD = /^[A-Za-z]{2,63}$/;

// Devuelve `{url, falla}`: `falla` separa «no vino ninguna url» de «vino una
// que no sirve», que es justo lo que el `catch` de antes borraba.
const enlaceUsable = (v) => {
  if (typeof v !== 'string' || v.trim() === '') return { url: '', falla: 'sin url' };
  const t = v.trim();
  if (t.length > 2048) return { url: '', falla: 'url no valida' };
  const m = RE_ENLACE.exec(t);
  if (!m) return { url: '', falla: 'url no valida' };
  const host = m[1].toLowerCase();
  const puerto = m[2] ? Number(m[2]) : 443;
  if (!(puerto >= 1 && puerto <= 65535)) return { url: '', falla: 'url no valida' };
  const segmentos = host.split('.');
  // Dos segmentos como minimo: con eso `localhost` y cualquier nombre suelto de
  // una red interna quedan afuera sin necesidad de nombrarlos.
  if (segmentos.length < 2) return { url: '', falla: 'url no valida' };
  if (!segmentos.every((s) => RE_SEGMENTO.test(s))) return { url: '', falla: 'url no valida' };
  // El ultimo segmento es el dominio de primer nivel y es alfabetico: con eso
  // una direccion IP (`https://10.0.0.1/c/...`) tampoco pasa.
  if (!RE_TLD.test(segmentos[segmentos.length - 1])) return { url: '', falla: 'url no valida' };
  return { url: t, falla: '' };
};

const sinAnuncios = (texto) => {
  const oraciones = String(texto).split(/(?<=[.!?…])\s+/).filter((o) => o.trim() !== '');
  const quedan = oraciones.filter((o) => !ANUNCIA_ENLACE.test(o));
  return { texto: quedan.join(' ').trim(), quitadas: quedan.length < oraciones.length };
};

const out = [];

for (let i = 0; i < entradas.length; i++) {
  // Emparejamiento por indice y nunca `.first()`: despues de un Code el
  // emparejamiento hacia atras se rompe, y con dos mensajes a la vez
  // `.first()` le pondria el texto del primer cliente al segundo.
  const prev = (previos[i] ?? previos[previos.length - 1] ?? { json: {} }).json ?? {};
  const rta = entradas[i].json ?? {};
  const codigo = Number(rta.statusCode);
  // 405, 401 y 404 contestan TEXTO plano; 409, 400 y 500 contestan JSON.
  const cuerpo = (rta.body && typeof rta.body === 'object') ? rta.body : {};
  const cuerpoTexto = typeof rta.body === 'string' ? rta.body.trim().slice(0, 40) : '';

  // Validar no puede lanzar -son cadenas y expresiones regulares-, pero si algun
  // dia lanzara, el aviso lo dice con su propio nombre en vez de hacerlo pasar
  // por una URL mala. Ese fue el defecto del 23/09/2026.
  let evaluado;
  try {
    evaluado = codigo === 200 ? enlaceUsable(cuerpo.url) : { url: '', falla: '' };
  } catch (e) {
    evaluado = { url: '', falla: 'error al validar la url: ' + String((e && e.message) || e).slice(0, 80) };
  }
  const url = evaluado.url;
  const grande = cuerpo.catalogoGrande === true;
  const cuantos = (typeof cuerpo.items === 'number' && cuerpo.items > 0) ? cuerpo.items : 0;
  const delAgente = String(prev.respuesta ?? '').trim();
  const avisos = [];
  let texto;

  // SE MIDE UNA SOLA VEZ Y SIRVE PARA LAS DOS RAMAS: con enlace decide que NO
  // se repite; sin enlace, que se quita.
  const yaAnuncia = ANUNCIA_ENLACE.test(delAgente);

  if (url) {
    // EL NODO NO REPITE LO QUE EL AGENTE YA DIJO (23/09/2026). Lo que recibio
    // Andres fue «…en el enlace del catálogo que te compartimos.» y, pegado
    // abajo, «Acá puedes verlo todo (10 productos) y elegir con calma:»: dos
    // frases para lo mismo dentro del mismo mensaje pagado. El prompt ya le
    // pide al agente que no anuncie la pagina -la linea la pone el sistema-,
    // pero un prompt no es una barrera: aca se comprueba con el MISMO patron
    // que sirve para quitar promesas cuando no hay enlace.
    //
    // CATALOGO GRANDE: el asistente NO recibio la lista -`configuracionFlujo`
    // manda `catalogo: []` y un resumen cuando pasa el umbral-, asi que el
    // mensaje TIENE que decir que el detalle esta en el enlace. Si no lo
    // dijera, el cliente le pediria por chat una lista que no puede recitar y
    // la conversacion se alarga justo donde se queria acortar. Cuando el agente
    // YA anuncio la pagina, de esa linea queda lo unico que el no puede saber:
    // cuantos productos son.
    const invita = grande
      ? (yaAnuncia
        ? (cuantos ? 'Son ' + cuantos + ' productos en total:' : '')
        : ('Tenemos más productos de los que puedo escribirte por acá'
          + (cuantos ? ' (' + cuantos + ' en total)' : '')
          + ': el detalle completo, con precios, está en este enlace:'))
      : (yaAnuncia
        ? ''
        : ('Acá puedes verlo todo' + (cuantos ? ' (' + cuantos + ' productos)' : '')
          + ' y elegir con calma:'));
    // El enlace SIEMPRE sale; lo que se omite es la linea que lo presenta.
    const bloque = invita ? invita + '\n' + url : url;
    const cierre = YA_INVITA_A_ESCRIBIR.test(delAgente) ? '' : CIERRE;
    texto = [delAgente, bloque, cierre].filter((t) => t !== '').join('\n\n');
    avisos.push(grande ? 'catalogo_enlace_grande' : 'catalogo_enlace');
    if (yaAnuncia) avisos.push('catalogo_invitacion_no_repetida');
    if (cierre === '') avisos.push('catalogo_cierre_no_repetido');
  } else {
    const limpio = sinAnuncios(delAgente);
    if (limpio.quitadas) avisos.push('anuncio_de_enlace_quitado');
    texto = [limpio.texto, SIN_ENLACE].filter((t) => t !== '').join('\n\n');
    if (evaluado.falla === 'url no valida') avisos.push('catalogo_url_invalida');
    else if (evaluado.falla.indexOf('error al validar') === 0) avisos.push('catalogo_url_error');
    avisos.push('catalogo_sin_enlace');
  }

  const motivo = url ? 'ok'
    : (typeof cuerpo.error === 'string' && cuerpo.error !== '') ? cuerpo.error
      : (typeof cuerpo.estado === 'string' && cuerpo.estado !== '') ? cuerpo.estado
        : cuerpoTexto !== '' ? cuerpoTexto
          : codigo === 200 ? (evaluado.falla || 'sin url')
            : Number.isFinite(codigo) ? 'http ' + codigo : 'sin respuesta';

  // Se arrastra TODO lo que traia el item -telefono, phoneNumberId, rotulos- y
  // se pisa `respuesta`: `Responder al cliente` y el reporte del saliente leen
  // de aca y no del emparejamiento hacia atras.
  out.push({ json: Object.assign({}, prev, {
    respuesta: texto,
    // Queda en los datos de la ejecucion para poder auditar el ensayo: que
    // contesto el endpoint y por que el cliente vio lo que vio.
    catalogoUrl: url,
    catalogoCodigo: Number.isFinite(codigo) ? codigo : 0,
    catalogoMotivo: motivo,
    catalogoGrande: grande,
    catalogoItems: cuantos,
    caducaCatalogoEn: typeof cuerpo.caducaEn === 'string' ? cuerpo.caducaEn : '',
    avisos: (Array.isArray(prev.avisos) ? prev.avisos : []).concat(avisos),
  }) });
}

return out;
