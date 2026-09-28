// EL MENSAJE DEL CARRITO: uno solo, con todo lo que hay que decir y todo lo que
// falta preguntar.
//
// CUESTA UN MENSAJE POR CARRITO CONFIRMADO, y es el unico del catalogo web que
// agrega costo (0,0113 USD, «Base comercial» §1). Vale la pena porque
// REEMPLAZA la conversacion de toma de pedido entera -producto por producto,
// cantidad por cantidad, que son muchos mas mensajes- y porque un pedido que
// llega sin que el cliente reciba ni una palabra se siente como un pedido
// perdido. Por eso tambien va TODO junto: la confirmacion, lo que no entro, lo
// que falta y la pregunta de quien es el pedido. Dos mensajes costarian el
// doble y dirian lo mismo.
//
// LO QUE ESTE MENSAJE NO PROMETE. No dice que el pedido se esta preparando -eso
// lo decide el comercio, no el flujo-, no habla de pagos ni de cobros
// (prohibicion 3: aca no se cobro nada) y no ofrece mandar nada despues. Lo
// unico que ofrece es lo que se cumple: el pedido quedo registrado -esta en
// Firestore y el comercio lo ve en su consola- y quien quiera cambiar algo
// escribe por aca, que es lo que el asistente sabe atender.
//
// LO QUE NO PODEMOS SABER, Y POR ESO SE PREGUNTA. `descartados` trae
// IDENTIFICADORES, no nombres, y desde el webhook no se distingue si un item
// se cayo porque lo dieron de baja, porque le sacaron el precio o porque se
// agoto mientras el cliente elegia. Se dice que no entro y se pregunta cual
// era. Suponerlo seria inventar.
const previos = $('Validar carrito').all();
const entradas = $input.all();

// Comparacion sin salida temprana. Ni el tenant ni el numero son secretos -el
// unico valor que mereceria tiempo constante es la firma, y esa no se puede
// verificar en el lienzo (ver «Validar carrito»)-, pero cuesta lo mismo y no
// deja un `===` sobre un valor de autenticacion listo para copiar a donde si
// importe.
const igualSinPrisa = (a, b) => {
  const x = String(a ?? '');
  const y = String(b ?? '');
  let d = x.length === y.length ? 0 : 1;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return d === 0;
};

// Cuantas lineas de pedido se escriben antes de resumir. Un carrito admite
// hasta 50 lineas y un mensaje de WhatsApp, 4096 caracteres: mas de una docena
// de lineas no se lee, y el total ya esta abajo.
const MAX_LINEAS = 12;
const monto = (v, moneda) => `${Number(v).toFixed(2).replace(/\.00$/, '')} ${moneda}`;

const out = [];

for (let i = 0; i < entradas.length; i++) {
  const prev = (previos[i] ?? previos[previos.length - 1] ?? { json: {} }).json ?? {};
  const rta = entradas[i].json ?? {};
  const codigo = Number(rta.statusCode);
  const cuerpo = (rta.body && typeof rta.body === 'object') ? rta.body : {};

  // MISMA DOCTRINA QUE `Config del negocio`: 200 con tenant es el panel
  // hablando; 409 es «no operativo», que es una respuesta valida; cualquier
  // otra cosa es no saber, y no saber no puede dejar sin respuesta a alguien
  // que acaba de hacer un pedido.
  const contesto = codigo === 200 && typeof cuerpo.tenantId === 'string' && cuerpo.tenantId !== '';
  const estadoComercio = contesto
    ? (cuerpo.estadoComercio === 'activo' ? 'operativo' : 'suspendido')
    : (codigo === 409 ? 'suspendido' : 'operativo');
  const at = (contesto && typeof cuerpo.atencion === 'object' && cuerpo.atencion) ? cuerpo.atencion : {};
  const atencionEstado = ['normal', 'operador', 'bloqueado'].includes(at.estado) ? at.estado : 'normal';

  let responder = true;
  let motivo = 'ok';
  if (contesto && !igualSinPrisa(cuerpo.tenantId, prev.tenantId)) {
    // El tenant del carrito lo escribio `checkoutCatalogo` desde la ficha; el
    // del panel sale del NUMERO que autentico la peticion. Son dos caminos
    // distintos: si no coinciden, este carrito no es de este comercio y no se
    // contesta. Es la regla multi-tenant, aplicada donde se puede aplicar.
    responder = false; motivo = 'el carrito no es de este comercio';
  } else if (estadoComercio !== 'operativo') {
    responder = false; motivo = 'comercio no operativo';
  } else if (atencionEstado === 'bloqueado') {
    // Pasado el umbral de bloqueo no se le manda NADA mas a ese telefono hasta
    // que la ventana se renueve (`Analisis/27` §5). Un carrito no es una
    // excepcion: el pedido igual queda en la consola.
    responder = false; motivo = 'telefono bloqueado por uso extendido';
  } else if (prev.accion !== 'responder') {
    // VENTANA DE 24 H CERRADA. Fuera de la ventana Meta solo acepta una
    // PLANTILLA aprobada, y `carrito_te_espera` NO esta aprobada (22/09/2026).
    // Mandar texto libre seria un envio que Meta rechaza, asi que no se manda
    // nada: el pedido queda en la consola, que es lo que si se cumple.
    //
    // EL DIA QUE META LA APRUEBE: colgar de «¿Avisar del carrito?» una segunda
    // compuerta por `plantillaPendiente` y un nodo de WhatsApp en modo
    // `template` con `plantilla.nombre`, `plantilla.idioma` y
    // `plantilla.parametros`, que ya salen armados de aca. OJO: Meta rechaza
    // un parametro VACIO, asi que el {{1}} de la plantilla (el nombre, que
    // este flujo no conoce) hay que resolverlo al darla de alta -o darla de
    // alta sin ese parametro-.
    responder = false; motivo = 'ventana cerrada: la plantilla carrito_te_espera no esta aprobada';
  }

  const moneda = String(prev.moneda ?? 'Bs');
  const lineas = (Array.isArray(prev.items) ? prev.items : []).slice(0, MAX_LINEAS)
    .map((it) => `• ${it.cantidad}× ${it.nombre} — ${monto(it.subtotal, moneda)}`);
  const sobran = Math.max(0, Number(prev.itemsTotal ?? 0) - lineas.length);
  if (sobran > 0) lineas.push(`• y ${sobran} producto${sobran === 1 ? '' : 's'} más`);

  // El pedido va en UN bloque -encabezado, lineas, envio y total pegados-, y
  // cada cosa distinta en el suyo. Con una linea en blanco entre cada renglon
  // el mensaje se leia como un formulario y ocupaba tres pantallas.
  const pedido = ['Recibí tu pedido del catálogo y quedó registrado:', ...lineas];
  if (Number(prev.costoEnvio ?? 0) > 0) pedido.push(`Envío: ${monto(prev.costoEnvio, moneda)}`);
  pedido.push(`Total: ${monto(prev.total, moneda)}`);
  const partes = [pedido.join('\n')];

  const entrega = [prev.entrega === 'envio'
    ? (prev.direccion
      ? `Entrega: envío a ${prev.direccion}.`
      : 'Me falta la dirección de entrega: pásamela por acá y lo cerramos.')
    : 'Entrega: pasas a recoger.'];
  if (prev.nota) entrega.push(`Tu nota: ${prev.nota}`);
  partes.push(entrega.join('\n'));

  const fuera = Number(prev.descartados ?? 0);
  if (fuera === 1) {
    partes.push('Hay 1 producto que no pude incluir. Desde acá no puedo ver si se agotó, si lo dieron '
      + 'de baja o si quedó sin precio, así que dime cuál era y lo revisamos.');
  } else if (fuera > 1) {
    partes.push(`Hay ${fuera} productos que no pude incluir. Desde acá no puedo ver si se agotaron, si `
      + 'los dieron de baja o si quedaron sin precio, así que dime cuáles eran y los revisamos.');
  }
  if (prev.fichaCompartida === true) {
    partes.push('Este enlace se puede compartir, así que confírmame que el pedido es tuyo.');
  }
  partes.push('Cualquier cambio, escríbeme por acá.');
  const textoRespuesta = responder ? partes.filter((t) => t !== '').join('\n\n') : '';

  // EL PEDIDO TIENE QUE ENTRAR EN LA MEMORIA DEL AGENTE (23/09/2026). Esta rama
  // arma y manda el mensaje FUERA del agente: el modelo nunca lo ve. El 23/09,
  // a las 05:01, el cliente recibio su pedido completo con su total y treinta
  // segundos despues, al escribir «ok», el asistente contesto «avisame cuando
  // elijas algo del catalogo para tomar tu pedido»; al pedir pagar, le pidio
  // que dijera que productos queria. El pedido existia en Firestore y en el
  // chat del cliente, y no existia en la unica parte que el modelo lee.
  //
  // POR ESO SE ESCRIBEN ACA LOS DOS TURNOS QUE FALTAN, y los escribe este Code
  // y no el nodo de memoria: el texto se arma una sola vez, se prueba, y el
  // nodo «Recordar pedido» solo los inserta. El texto del cliente se redacta EN
  // PRIMERA PERSONA DEL CLIENTE porque asi entra al historial -es su turno-, y
  // dice todo lo que el modelo va a necesitar en el turno siguiente: que pidio,
  // cuanto es, como lo quiere recibir y que falta.
  const memoriaCliente = [
    'Acabo de enviar este pedido desde el catálogo web:',
    ...lineas,
    ...(Number(prev.costoEnvio ?? 0) > 0 ? ['Envío: ' + monto(prev.costoEnvio, moneda)] : []),
    'Total: ' + monto(prev.total, moneda),
    prev.entrega === 'envio'
      ? (prev.direccion ? 'Quiero envío a ' + prev.direccion : 'Quiero envío y todavía no te di la dirección.')
      : 'Paso a recoger.',
    ...(prev.nota ? ['Mi nota: ' + prev.nota] : []),
    ...(fuera > 0 ? [fuera + (fuera === 1 ? ' producto no entró' : ' productos no entraron') + ' en el pedido.'] : []),
  ].filter((t) => t !== '').join('\n');

  out.push({ json: {
    respuesta: textoRespuesta,
    // Los dos turnos que «Recordar pedido» inserta en la memoria del agente,
    // con la misma clave de sesion que usa el agente: el telefono.
    memoriaCliente,
    memoriaAsistente: textoRespuesta,
    responder,
    motivo,
    from: String(prev.from ?? ''),
    // El numero del panel manda sobre el de la cabecera: sale del mismo lugar
    // que valido la firma. Sin panel, el de la cabecera, que ya se autentico.
    phoneNumberId: String((contesto && cuerpo.phoneNumberId) ? cuerpo.phoneNumberId : (prev.numero ?? '')),
    pedidoId: String(prev.pedidoId ?? ''),
    tenantId: String(prev.tenantId ?? ''),
    estadoComercio,
    atencionEstado,
    panelContesto: contesto,
    // Queda armado para el dia que la plantilla exista. Hoy NO se envia.
    plantillaPendiente: prev.accion === 'plantilla_carrito_espera' && motivo.startsWith('ventana cerrada'),
    plantilla: {
      nombre: 'carrito_te_espera',
      idioma: 'es',
      parametros: ['', String(prev.itemsTotal ?? 0), monto(prev.total, moneda)],
    },
  } });
}

return out;
