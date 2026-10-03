// LA CONSOLA MANDA, con la misma regla que en el flujo de agendamiento: si el
// panel contesta, sus valores pisan; si no, se usan los de siempre.
//
// Este nodo se llama «Config del negocio» a proposito: es el nombre que buscan
// las expresiones que ya existen en el flujo. El Set con los valores de
// respaldo paso a llamarse «Config base».
//
// LO QUE NO SE TOCA NUNCA, Y ES LO MAS IMPORTANTE DE ESTE ARCHIVO: los rotulos
// del cobro simulado. `rotuloDemo`, `captionQr` y `textoPagoSimulado` NO se
// pisan con nada que venga de afuera, aunque el panel los mandara. Son la
// prohibicion 3 de CLAUDE.md hecha codigo: un cobro de demostracion no puede
// presentarse como real, y esa garantia no puede depender de un campo editable
// ni de que un endpoint conteste bien.
//
// Y DESDE EL 23/09/2026 HAY UN SEGUNDO MODO, QUE ES EXCLUYENTE DEL PRIMERO.
// El mismo flujo sirve al cobro REAL --el QR es del comercio y el dinero va a
// su cuenta-- y ahi los rotulos NO van, porque el cobro no es simulado. Los dos
// modos no conviven: o el dinero se mueve o no se mueve, y mezclarlos daria el
// peor resultado posible (un cobro real rotulado como simulacro, o al reves).
//
// QUIEN DECIDE CUAL DE LOS DOS: EL SERVIDOR, y nada mas que el servidor.
// `configuracionFlujo` manda `cobroReal` O `cobroSimulado`, nunca los dos, y
// exige para el real que este encendido Y tenga ficha Y tenga codigo. Aca no se
// vuelve a decidir: se obedece. Y la regla de los rotulos pasa a ser
// CONDICIONAL con una sola condicion, escrita una sola vez mas abajo:
//
//   los rotulos se reponen SI Y SOLO SI el servidor mando `cobroSimulado`.
//
// EL FALLO POR OMISION SIGUE CAYENDO DEL LADO DEL ROTULO: sin respuesta del
// panel, con 409, con un cuerpo que no se entiende o con un cobro real a medio
// configurar, el modo es SIMULADO y los rotulos vuelven. El sistema falla hacia
// el rotulo, jamas hacia el silencio.
const base = $('Config base').first().json;

// ---------------------------------------------------------------------------
// EL 409 NO ES UN FALLO: ES LA RESPUESTA QUE CORTA EL SERVICIO.
//
// EL DEFECTO QUE ESTO ARREGLA (reportado el 2026-09-07, y confirmado en los
// TRES flujos). `configuracionFlujo` contesta 409 con `{estado, mensajeCortesia}`
// y SIN `tenantId` cuando el comercio no esta activo. La version anterior de
// este nodo exigia `tenantId` para dar la respuesta por buena, asi que un 409
// caia al respaldo... y el respaldo dice `estadoComercio: 'operativo'` escrito a
// mano. Resultado: **un comercio suspendido seguia siendo atendido**, y en el
// flujo de recordatorios seguia enviando plantillas que Meta cobra. Era
// exactamente el defecto que conectar el panel daba por cerrado, y yo lo habia
// afirmado por escrito sin comprobarlo.
//
// LA RAIZ ERA NO PODER DISTINGUIR «el panel dice que esta suspendido» de «el
// panel no contesto». Los dos se veian igual: un fallo. Ahora el nodo HTTP
// devuelve la respuesta completa -codigo y cuerpo- y aca se decide con el
// codigo:
//
//   200 + tenantId  -> configuracion del panel
//   409             -> SUSPENDIDO. Es una respuesta valida, no un error.
//   cualquier otra  -> no se pudo saber -> respaldo
//
// SOBRE `neverError`, QUE ESTE PROYECTO PROHIBIO EL 2026-09-01: aquel caso era
// un nodo que salia VERDE con un 401 y nadie miraba el resultado. Aca el codigo
// se examina explicitamente y lo que no se reconoce cae al respaldo dejando
// rastro. La regla real no es «nunca neverError», es «nunca ignores el codigo».

const respuesta = $input.first().json ?? {};
const codigo = Number(respuesta.statusCode);
const cuerpo = (respuesta.body ?? {});

const util = (v) => (typeof v === 'string' && v.trim() !== '') ? v.trim() : undefined;
const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? String(v) : undefined;
const soloLlenos = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// EL NOMBRE DEL ASISTENTE lo elige cada empresa en la consola y vale para todos
// sus flujos (decidido el 15/09/2026). Es TEXTO LIBRE y va al prompt: se deja en
// una sola linea, sin corchetes ni llaves -- con ellos podria imitar un bloque
// [CONTEXTO DEL SISTEMA] -- ni comillas angulares, que el prompt usa para
// citarlo, y con el tope de 40 del servidor. Vacio = el asistente de siempre.
// La regla de identidad (asistente virtual con IA, no lo niega) NO depende de
// este campo: esta escrita en el prompt y en los textos fijos, con o sin nombre.
const nombreDelAsistente = (v) => {
  if (typeof v !== 'string') return undefined;
  const t = util(v.replace(/[\u0000-\u001f\u007f\u2028\u2029\[\]{}<>«»]/g, ' ').replace(/\s+/g, ' '));
  return t ? t.slice(0, 40).trim() : undefined;
};
// Cuantos emojis llevan los TEXTOS FIJOS, los que no pasan por el modelo. Al
// modelo se lo dice `estiloEmojis`; esto es para lo que el flujo escribe solo.
const NIVELES_EMOJIS = ['ninguno', 'pocos', 'muchos'];

// LA BIENVENIDA ES UN TEXTO FIJO: no pasa por el modelo, asi que el nombre y el
// nivel de emojis se aplican aca y no en el prompt. Sale SIEMPRE del respaldo de
// `Config base` -- el panel no la manda -- y se recalcula en los tres caminos de
// este nodo. Sin nombre y con emojis «muchos» queda EXACTAMENTE como estaba.
//   ninguno -> sin emojis;  pocos -> como mucho uno;  muchos -> como esta.
const EMOJI = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*\uFE0F?/gu;
const ajustarEmojis = (texto, nivel) => {
  if (nivel === 'ninguno') return texto.replace(EMOJI, '').replace(/ {2,}/g, ' ').replace(/^ +/, '');
  if (nivel === 'pocos') {
    let uno = false;
    return texto.replace(EMOJI, (e) => { if (uno) return ''; uno = true; return e; })
      .replace(/ {2,}/g, ' ').replace(/^ +/, '');
  }
  return texto;
};
const conPresentacion = (cfg) => {
  const nombre = util(cfg.nombreAsistente);
  let texto = String(base.textoBienvenida ?? '');
  // Funcion y no cadena de reemplazo: un `$&` dentro del nombre no se expande.
  if (nombre) texto = texto.replace(/\bSoy el asistente virtual\b/, () => `Soy ${nombre}, el asistente virtual`);
  return { ...cfg, textoBienvenida: ajustarEmojis(texto, cfg.nivelEmojis) };
};

// EL MODO DE COBRO CUANDO NO SE SABE NADA. Se escribe una vez y se usa en los
// dos caminos de respaldo, para que ninguno pueda olvidarse de declararlo: un
// `cobroRealActivo` ausente se leeria como cadena vacia --o sea, simulado-- pero
// dejarlo implicito es pedirle al proximo que lo deduzca.
const COBRO_SIMULADO_DE_RESPALDO = {
  cobroRealActivo: '',
  cobroPendiente: '',
  cobroMonto: '',
  cobroPedido: '',
  cobroQrUrl: '',
  cobroNombreCuenta: '',
  cobroBanco: '',
  cobroQrEnviadoEn: '',
  cobroVencidoHaceMin: '',
  rotuloDemo: base.rotuloDemo,
  captionQr: base.captionQr,
  textoPagoSimulado: base.textoPagoSimulado,
};

// ---------------------------------------------------------------------------
// ESTADO DE ATENCION DEL TELEFONO: los umbrales de uso extendido
// (`Analisis/27` §5, decididos el 13/09/2026).
//
// `Traer configuracion` manda el telefono que escribio, y el panel contesta en
// `atencion` cuantas respuestas lleva ese cliente en su ventana de 24 h y que
// hacer con ESTE turno:
//   normal    -> al modelo, como siempre.
//   operador  -> paso el umbral de operador (50 por defecto): NO se llama al
//                modelo; se responde un aviso fijo y, la primera vez, se avisa
//                al negocio para que una persona tome la conversacion.
//   bloqueado -> paso el umbral de bloqueo (100 por defecto): no se envia nada
//                hasta que la ventana se renueve.
// Los umbrales los fija NovuChat por empresa en el panel. El flujo no cuenta
// nada: obedece. Quien decide es el servidor (`atencion.ts`).
//
// ANTE LA DUDA, NORMAL. Si el panel no contesta, contesta 409 o manda un
// estado que no se reconoce, el estado es `normal`: el mismo criterio de
// arriba, una caida del panel no puede dejar sin respuesta a un cliente. El
// techo de costo lo vuelve a poner el servidor en el primer turno que conteste.
// ---------------------------------------------------------------------------
const at = (codigo === 200 && cuerpo && typeof cuerpo.atencion === 'object' && cuerpo.atencion)
  ? cuerpo.atencion : {};
const atencion = {
  atencionEstado: ['normal', 'operador', 'bloqueado'].includes(at.estado) ? at.estado : 'normal',
  // El texto lo pone el panel; este es el respaldo, identico al del servidor
  // (`MENSAJE_USO_EXTENDIDO` en atencion.ts). Neutro: no habla de limites, de
  // mensajes ni de dinero, porque quien lo lee es un tercero.
  atencionMensajeFijo: util(at.mensajeFijo)
    || 'Gracias por su paciencia. Para atenderle mejor, una persona del equipo va a continuar esta conversación en breve.',
  atencionAvisarRecepcion: ['operador', 'bloqueado'].includes(at.avisarRecepcion) ? at.avisarRecepcion : '',
  atencionRespuestas: (typeof at.respuestasEnVentana === 'number' && Number.isFinite(at.respuestasEnVentana))
    ? at.respuestasEnVentana : 0,
  atencionVenceEn: util(at.ventanaVenceEn) || '',
};

if (codigo === 409) {
  return [{ json: conPresentacion({ ...base, ...atencion,
    estadoComercio: 'suspendido',
    // El texto neutro lo pone el panel: no menciona pagos ni deudas, porque el
    // cliente final no tiene por que enterarse de que el negocio debe dinero.
    mensajeComercioSuspendido: util(cuerpo.mensajeCortesia)
      || base.mensajeComercioSuspendido,
    configDeLaConsola: false,
    panelDice: 'no operativo',
    // Sin configuracion no hay cobro real posible: modo SIMULADO, con rotulos.
    ...COBRO_SIMULADO_DE_RESPALDO,
  }) }];
}

const contesto = codigo === 200 && cuerpo && typeof cuerpo.tenantId === 'string';
if (!contesto) {
// Sin respuesta no se corta: una caida del panel no puede dejar sin asistente a
// todos los comercios. Un cliente escribiendo merece una respuesta.
  return [{ json: conPresentacion({ ...base, ...atencion,
    estadoComercio: base.estadoComercio ?? 'operativo',
    configDeLaConsola: false,
    panelSinRespuesta: true,
    codigoDelPanel: Number.isFinite(codigo) ? codigo : 0,
    // Idem: el panel no contesto, asi que el modo es SIMULADO y con rotulos.
    ...COBRO_SIMULADO_DE_RESPALDO,
  }) }];
}

const r = cuerpo;

const dn = r.datosDelNegocio ?? {};
const op = r.operacion ?? {};
const venta = r.venta ?? {};

// --- EL COBRO: REAL O SIMULADO, NUNCA LOS DOS -------------------------------
//
// `cobroReal` y `cobroSimulado` son excluyentes en el servidor (`ingesta.ts`) y
// aca se exige ademas que el real venga USABLE: con la direccion de su imagen.
// Un cobro real a medio armar no se convierte en «cobro real sin QR» --eso seria
// pedirle plata a alguien sin darle a donde pagarla--: cae a simulado, que es el
// modo que no mueve dinero.
//
// `cobro` es otra cosa y sale en los DOS modos: es el estado de ESTE telefono
// --si hay un QR esperando su comprobante, por cuanto, y de que pedido--. Lo
// calcula el servidor mirando la solicitud, y caduca solo (`cobroVenta.ts`).
const cr = (r.cobroReal && typeof r.cobroReal === 'object') ? r.cobroReal : null;
const cb = (r.cobro && typeof r.cobro === 'object') ? r.cobro : {};
const qrUrlDelPanel = typeof (cb.qr || {}).url === 'string' ? cb.qr.url.trim() : '';
const cobroRealUsable = cr !== null && /^https:\/\//.test(qrUrlDelPanel);
const cs = (r.cobroSimulado && typeof r.cobroSimulado === 'object') ? r.cobroSimulado : {};

const elCobro = cobroRealUsable
  ? {
      cobroRealActivo: 'si',
      cobroQrUrl: qrUrlDelPanel,
      cobroNombreCuenta: String(cr.nombreCuenta || '').trim().slice(0, 120),
      cobroBanco: String(cr.banco || '').trim().slice(0, 80),
      // LOS ROTULOS DE SIMULADO SE APAGAN. No se dejan «por las dudas»: si
      // quedaran, el primer texto que los use estaria diciendo que un cobro de
      // verdad no cobra. Cadena vacia, y `Procesar respuesta` cambia de red.
      rotuloDemo: '',
      captionQr: '',
      textoPagoSimulado: '',
      qrMediaId: '',
      qrUrl: qrUrlDelPanel,
    }
  : {
      cobroRealActivo: '',
      cobroQrUrl: '',
      cobroNombreCuenta: '',
      cobroBanco: '',
      // Los de siempre, de `Config base`: de NovuChat, no del comercio.
      rotuloDemo: base.rotuloDemo,
      captionQr: base.captionQr,
      textoPagoSimulado: base.textoPagoSimulado,
      // El QR de demostracion: el media id que el panel tenga, y si no, el del
      // respaldo. Es QUE imagen se manda, no QUE dice: los rotulos son los de
      // arriba en los dos casos.
      qrMediaId: (typeof cs.mediaIdQr === 'string' && cs.mediaIdQr.trim() !== '')
        ? cs.mediaIdQr.trim() : base.qrMediaId,
      qrUrl: base.qrUrl,
    };

// El estado del QR de ESTE telefono. Va en los dos modos.
const elPendiente = {
  cobroPendiente: cb.pendiente === true ? 'si' : '',
  cobroMonto: (typeof cb.monto === 'number' && Number.isFinite(cb.monto) && cb.monto > 0)
    ? String(cb.monto) : '',
  cobroPedido: typeof cb.pedido === 'string' ? cb.pedido.slice(0, 200) : '',
  cobroQrEnviadoEn: typeof cb.qrEnviadoEn === 'string' ? cb.qrEnviadoEn : '',
  cobroVencidoHaceMin: (typeof cb.vencidoHaceMin === 'number' && cb.vencidoHaceMin >= 0)
    ? String(cb.vencidoHaceMin) : '',
};

// --- EL CATALOGO, AGRUPADO POR SUS AREAS REALES -----------------------------
//
// EL DEFECTO QUE ESTO ARREGLA (23/09/2026, Andres contra su telefono). Este
// nodo armaba DOS listas, y las armaba filtrando por DOS AREAS FIJAS escritas
// aca adentro: `gastronomia` y `retail`. El comercio `demo-venta` paso a ser
// Walisuma, con diez piezas de artesania en las areas `abrigos`, `cuero`,
// `sweaters`, `accesorios`, `hogar y oficina`, `ruanas y chales` y
// `souvenirs`. Ninguna de las siete es `gastronomia` ni `retail`, asi que las
// dos listas quedaban vacias, `soloLlenos` las descartaba y el prompt caia a
// los valores de respaldo de `Config base`: el asistente de una marca de baby
// alpaca ofrecia «hamburguesas, salchipapas y gaseosas».
//
// LA CAUSA DE FONDO no era el filtro: era que el flujo de venta estaba
// CABLEADO a un comercio de gastronomia y retail. NovuChat atiende CUALQUIER
// RUBRO -- es politica del proyecto, la misma por la que los rubros de la
// captacion son referencia y no un menu --, asi que el catalogo se agrupa por
// las areas que el comercio realmente cargo, sean las que sean, y el prompt
// habla «del catalogo de este negocio» y no de una carta y una tienda.
//
// UN ITEM SIN PRECIO no entra: no se puede cobrar lo que no tiene precio, asi
// que simplemente no se ofrece, igual que un item dado de baja.
const items = (Array.isArray(r.catalogo) ? r.catalogo : [])
  .filter((i) => i && typeof i.precio === 'number');
const moneda = util(op.moneda) === 'USD' ? 'USD' : (util(base.moneda) || 'Bs');

// Sin tildes y en minusculas, para poder comparar un area contra un vocabulario
// sin repetir cada palabra con y sin acento. `normalize` es del lenguaje, no de
// Node: esta en el sandbox del nodo Code.
const plano = (v) => String(v == null ? '' : v)
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// El area tal como la escribio el comercio, en una linea y acotada. Lo que no
// trae area cae en un grupo neutro: se sigue ofreciendo, que es lo importante.
const areaDe = (i) => {
  const a = String((i && i.area) || '').replace(/\s+/g, ' ').trim();
  return a === '' ? 'Otros' : a.slice(0, 40);
};

// AGRUPADO EN EL ORDEN EN QUE VIENE. `configuracionFlujo` entrega el catalogo
// ordenado por nombre, asi que el resultado es estable entre turnos: si el
// texto del prompt cambiara de orden en cada mensaje, el modelo veria un
// catalogo distinto cada vez.
const porArea = new Map();
for (const i of items) {
  const a = areaDe(i);
  if (!porArea.has(a)) porArea.set(a, []);
  porArea.get(a).push(`${i.nombre} ${i.precio} ${i.moneda === 'USD' ? 'USD' : moneda}`);
}
const catalogoPorArea = Array.from(porArea.entries())
  .map(([area, l]) => `${area}: ${l.join(' · ')}`).join('\n');
const areasDelCatalogo = Array.from(porArea.keys()).join(', ');

// --- QUE REGLAS DE VENTA CORRESPONDEN A ESTE CATALOGO -----------------------
//
// El prompt traia unas REGLAS RESTAURANTE (la nota especial «sin cebolla», el
// tiempo de cocina) y unas REGLAS RETAIL (la talla obligatoria, el envio por
// flota con nombre y CI). A un comercio de artesania no le sirven ninguna de
// las dos, y preguntarle «sin cebolla» a quien compra una ruana de alpaca es
// exactamente lo que se vio el 23/09. Asi que cada bloque aparece SOLO si el
// catalogo tiene items de esa clase, y quien lo decide es el dato, no el
// prompt: el mismo patron condicional que ya usaba el bloque del catalogo web.
//
// ANTE LA DUDA, NO APARECE. Un bloque de mas es una pregunta absurda que el
// cliente ve; un bloque de menos es una regla de estilo que no se aplica. La
// primera se nota y la segunda no hace dano.
const GASTRONOMIA = new Set(('gastronomia comida comidas cocina cocinas menu menus carta cartas '
  + 'plato platos bebida bebidas postre postres cafe cafeteria panaderia pasteleria '
  + 'heladeria pizza pizzas hamburguesa hamburguesas sandwich sandwiches salchipapa '
  + 'almuerzo almuerzos desayuno desayunos cena cenas merienda snack snacks sushi '
  + 'parrilla parrillas restaurante pique piques saltena saltenas api tragos trago '
  + 'coctel cocteles vino vinos cerveza cervezas jugo jugos refresco refrescos gaseosa '
  + 'gaseosas entrada entradas guarnicion guarniciones sopa sopas ensalada ensaladas '
  + 'pollo pollos carne carnes pescado pescados marisco mariscos helado helados '
  + 'reposteria panificados').split(' '));
// Se compara POR SEGMENTOS del nombre del area, nunca por subcadena: con
// `includes`, un area «cocinas de madera» -- un mueble -- pasaria por comida.
const claseGastronomia = items.some((i) => plano(areaDe(i)).split(/[^a-z0-9]+/)
  .some((seg) => seg !== '' && GASTRONOMIA.has(seg)));

// LA TALLA SE PIDE SOLO SI EL CATALOGO LA DECLARA. No se adivina por el rubro:
// Walisuma vende abrigos y sweaters, y sin embargo «tallas y medidas» esta en
// su lista de datos que NO tiene. Pedir una talla obligatoria ahi seria pedir
// un dato que el negocio no puede usar, y prometer un envio con CI que nadie
// cargo. Si el catalogo nombra tallas o colores, la regla vuelve sola.
const RE_VARIANTE = /(?:^|[^a-z])(tallas?|talles?|numeraci[oó]n|medidas?|colou?res?|color|tama[nñ]os?)(?:$|[^a-z])/i;
const claseVariantes = items.some((i) => RE_VARIANTE.test(plano(
  `${(i && i.nombre) || ''} ${(i && i.descripcion) || ''}`)));

// EL RESUMEN DEL CATALOGO llega como objeto (`resumirCatalogo`, prompt.ts) y
// al prompt va como UNA frase: el modelo lee texto, no estructuras. Solo llega
// cuando el catalogo paso el umbral de 40 items Y el catalogo web esta
// encendido; en ese caso `catalogo` viene VACIO a proposito, asi que sin esta
// frase el asistente se queda sin nada que decir de lo que vende.
const resumenDeCatalogo = (v) => {
  if (!v || typeof v !== 'object') return undefined;
  const total = (typeof v.total === 'number' && v.total > 0) ? v.total : 0;
  if (!total) return undefined;
  const areas = Array.isArray(v.areas)
    ? v.areas.filter((a) => typeof a === 'string' && a.trim() !== '') : [];
  const mon = v.moneda === 'USD' ? 'USD' : moneda;
  const partes = [total + ' productos'];
  if (areas.length) partes.push('en ' + areas.join(', '));
  if (typeof v.precioMin === 'number' && typeof v.precioMax === 'number') {
    partes.push(v.precioMin === v.precioMax
      ? ('a ' + v.precioMin + ' ' + mon)
      : ('con precios de ' + v.precioMin + ' a ' + v.precioMax + ' ' + mon));
  }
  if (v.hayACotizar === true) partes.push('y algunos a cotizar');
  return partes.join(' ') + '.';
};

const deLaConsola = soloLlenos({
  nombreNegocio: util(dn.nombreNegocio),
  horarioAtencion: util(op.horarioAtencion),
  numeroDueno: util(op.numeroRecepcion),
  phoneNumberId: util(r.phoneNumberId),
  zonaHoraria: util(op.zonaHoraria),
  costoDelivery: num(venta.costoDelivery),
  recargoFlota: num(venta.recargoFlota),
  // Los tiempos viven en el panel como minutos y en el prompt como frase. El de
  // despacho no se leia y quedaba clavado en el respaldo («hoy a las 17:00»), que
  // es un plazo inventado para cualquier comercio que no sea el de la demo.
  tiempoCocina: typeof venta.tiempoCocinaMin === 'number'
    ? `${venta.tiempoCocinaMin} minutos` : undefined,
  despachoRetail: typeof venta.tiempoDespachoMin === 'number'
    ? `${venta.tiempoDespachoMin} minutos` : undefined,
  // CATALOGO WEB PROPIO (`ingesta.ts`). `catalogoWeb: {activo, derivar}` sale
  // solo cuando el comercio lo encendio, y `catalogoResumen` solo cuando ademas
  // el catalogo es grande y por eso vino vacio. Sin leerlos, el asistente no
  // sabe que existe la pagina -y con un catalogo grande no sabe ni que vende-.
  // El valor por defecto es APAGADO: si el panel no contesta, no se ofrece una
  // pagina que quiza no existe.
  catalogoWebActivo: ((r.catalogoWeb ?? {}).activo === true) ? true : undefined,
  catalogoResumen: resumenDeCatalogo(r.catalogoResumen),
  // La voz sale ROTULADA del panel (`voz`), no del arreglo
  // `instruccionesDeVoz`: leerlo por posicion se rompe el dia que
  // aparezca una tercera frase.
  tratamiento: util((r.voz ?? {}).tratamiento),
  estiloEmojis: util((r.voz ?? {}).emojis),
  nombreAsistente: nombreDelAsistente((r.voz ?? {}).nombreAsistente),
  nivelEmojis: NIVELES_EMOJIS.includes((r.voz ?? {}).nivelEmojis) ? r.voz.nivelEmojis : undefined,
  // LA DIRECCION Y LO QUE FALTA. Se agrego el 2026-09-07 despues de ver al
  // asistente inventarse una: «Nuestra tienda esta ubicada en la zona central
  // de La Paz», con el campo vacio en el panel. Es EL MISMO incidente del 28 de
  // agosto en el flujo de agendamiento, que ahi ya estaba resuelto y aca no: la
  // leccion no habia cruzado de un flujo al otro.
  direccion: util(dn.direccion),
  datosQueNoTenemos: Array.isArray(dn.datosQueNoTenemos) && dn.datosQueNoTenemos.length
    ? dn.datosQueNoTenemos.join(', ') : undefined,
  // EL COMPORTAMIENTO GENERAL DEL COMERCIO, que este flujo no estaba leyendo y
  // los tres de agendamiento si (23/09/2026). Es lo que el comercio escribio en
  // su consola y la verificacion del servidor aprobo (`instruccionesVigentes`,
  // ingesta.ts); el prompt lo inserta DELIMITADO y marcado como DATO, nunca por
  // delante de las reglas. Sin esto, el rubro, el tono y lo que el negocio dice
  // no saber se quedaban en la consola sin llegar al asistente.
  instruccionesExtra: util(dn.instruccionesExtra),
});

// El estado siempre sale del panel: es lo que corta el servicio.
const estadoComercio = util(r.estadoComercio) === 'activo' ? 'operativo'
  : (util(r.estadoComercio) ? 'suspendido' : (base.estadoComercio ?? 'operativo'));

// EL CATALOGO DEL PANEL PISA SIEMPRE, INCLUSO VACIO, y por eso va por fuera de
// `soloLlenos`. Es la otra mitad del defecto del 23/09/2026: mientras estas
// claves pasaban por `soloLlenos`, un valor vacio se descartaba y el respaldo de
// `Config base` volvia a ganar, asi que un comercio que no vende hamburguesas
// terminaba ofreciendo hamburguesas. Si el panel contesto, lo que vale es lo que
// el panel dijo: si no hay catalogo cargado, el asistente lo dice y no nombra ni
// un producto -- es la regla 12, no inventar, aplicada al catalogo entero.
const delCatalogo = {
  moneda,
  catalogoPorArea,
  areasDelCatalogo,
  claseGastronomia,
  claseVariantes,
};

// --- CAMPAÑAS VIGENTES (Andres, 02/10/2026, D4) ------------------------------
// Copia de `core/config-del-negocio.js`: el servidor manda en `campanas` SOLO las
// aplicadas y vigentes con el tope del plan cumplido; aca se vuelve a mirar la
// vigencia contra el reloj. Viaja como texto JSON y `Normalizar entrada` compara
// el texto. Sin `campanas` o con el panel caido no hay campañas.
const campanasActivas = JSON.stringify((Array.isArray(r.campanas) ? r.campanas : [])
  .filter((k) => k && typeof k.texto === 'string' && k.texto.trim() !== '' && k.texto.length <= 300)
  .filter((k) => {
    const desde = Date.parse(String(k.inicio || ''));
    const hasta = Date.parse(String(k.fin || ''));
    const ahora = Date.now();
    return Number.isFinite(desde) && Number.isFinite(hasta) && desde <= ahora && ahora < hasta;
  })
  .slice(0, 10)
  .map((k) => ({ id: String(k.id || '').slice(0, 60), texto: k.texto.trim() })));

return [{ json: conPresentacion({
  ...base,
  ...atencion,
  ...deLaConsola,
  ...delCatalogo,
  campanasActivas,
  estadoComercio,
  configDeLaConsola: true,
  // EL COBRO VA AL FINAL, DESPUES DE TODO, por la misma razon por la que antes
  // iban los rotulos solos: ninguna clave de arriba puede pisarlo. Y es UN solo
  // objeto, no tres campos sueltos, para que no exista ningun estado intermedio
  // en el que el modo diga una cosa y los rotulos otra.
  //
  // LA REGLA, ESCRITA UNA SOLA VEZ: con cobro real, los tres rotulos salen
  // VACIOS; sin el, salen los de `Config base`, que son de NovuChat y no los
  // toca nadie. `elCobro` es lo uno o lo otro y no hay tercera forma.
  ...elCobro,
  ...elPendiente,
}) }];
