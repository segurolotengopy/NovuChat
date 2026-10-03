// QUÉ SE LE DICE AL CLIENTE SEGÚN LO QUE CONTESTÓ EL SERVIDOR (`Analisis/07` §4.5).
//
// Llega la respuesta COMPLETA de `cotejarComprobante` (código y cuerpo) y de acá
// sale UN mensaje fijo --sin modelo-- y, cuando corresponde, el aviso al
// negocio. Cuatro resultados, cuatro textos, y NINGUNO afirma un pago
// (CLAUDE.md, prohibición 3): «los datos coinciden» no es «pago acreditado».
// Una imagen se edita, y un comprobante editado con los tres datos correctos
// pasa cualquier cotejo. Quien confirma que el dinero entró es el negocio,
// mirando su banco.
//
//   cuadra     -> los datos coinciden. El cierre ya lo creó el servidor, con
//                 el monto y el resultado adentro, y el negocio lo ve en su
//                 pantalla de Cobros con el botón para marcarlo comprobado
//                 contra el banco. Ese botón lo aprieta una PERSONA.
//   no_cuadra  -> hay un dato que no coincide; se le dice cuál sin dramatizar y se
//                 le invita a escribirle directo al negocio.
//   ilegible   -> no se pudo leer; se pide de nuevo, más nítido o como PDF.
//   sin cotejo -> 409 o el panel no contestó: llegó un comprobante que no se
//                 pudo cotejar (no había pago pendiente, el QR ya venció, o no
//                 se sabe el total). Lo mira una persona. Nunca se deja al
//                 cliente sin respuesta.
//
// SOLO SE OFRECE LO QUE SE CUMPLE (política de NovuChat, 21/09/2026): los tres
// casos que invitan a escribirle al negocio salen con `transferir: true` y el
// botón de escribirle directo. El texto NO afirma que el aviso salió («avisé»):
// `Mensaje a enviar` corre antes que `¿Avisar del cobro?`, el aviso puede fallar
// y el cliente puede ser el propio dueño. Con `numeroDueno` vacío o igual al
// cliente no hay a quién invitar a escribir, y el texto no lo ofrece.
//
// COSTO: 1 mensaje al cliente (fijo, sin modelo) --el mismo que hoy escribe el
// modelo al recibir el comprobante, así que no agrega ninguno-- más el aviso al
// negocio, que paga NovuChat y no se le cuenta al comercio.
const previos = $('Interpretar lectura').all();
const items = $input.all();
const out = [];

for (let i = 0; i < items.length; i++) {
  const previo = (previos[i] ?? previos[previos.length - 1] ?? { json: {} }).json;
  const r = items[i].json ?? {};
  const codigo = Number(r.statusCode);
  const cuerpo = (r.body && typeof r.body === 'object') ? r.body : {};
  const resultado = codigo === 200 && ['cuadra', 'no_cuadra', 'ilegible'].includes(cuerpo.resultado)
    ? cuerpo.resultado : 'sin_cotejo';
  const diferencias = Array.isArray(cuerpo.diferencias) ? cuerpo.diferencias.map(String).slice(0, 10) : [];

  const negocio = String(previo.nombreNegocio || '').trim() || 'el negocio';
  const moneda = String(previo.moneda || 'Bs').trim();
  const importe = (() => {
    const n = typeof cuerpo.importe === 'number' ? cuerpo.importe : Number(previo.cobroMonto);
    return Number.isFinite(n) && n > 0 ? `${n} ${moneda}`.trim() : '';
  })();
  const banco = String((previo.leido && previo.leido.banco) || '').trim();
  const montoLeido = String((previo.leido && previo.leido.monto) || '').trim();

  // Solo se invita a escribir si hay un número de negocio distinto del cliente.
  const dueno = String(previo.numeroDueno || '').replace(/\D/g, '');
  const puedeEscribir = dueno !== '' && dueno !== String(previo.from || '').replace(/\D/g, '');

  let respuesta = '';
  let motivo = '';
  if (resultado === 'cuadra') {
    // «Los datos coinciden con tu pedido», y nada más. NO «pago acreditado»,
    // NO «recibimos tu pago», NO «verificado»: ninguna de las tres es cierta
    // mirando una imagen. Lo que sí es cierto, y es lo que el cliente necesita
    // saber, es que los datos coinciden.
    respuesta = 'Recibí tu comprobante y los datos coinciden con tu pedido. '
      + 'Quien confirma que el pago entró es el negocio, en su banco.';
    motivo = `llegó el comprobante de un pedido de ${importe || 'monto no registrado'} y sus datos `
      + `coinciden (monto leído ${montoLeido || 'sin dato'}${banco ? `, banco ${banco}` : ''}); `
      + 'confirmar en el banco que el dinero entró antes de darlo por cobrado';
  } else if (resultado === 'no_cuadra') {
    const detalle = diferencias[0] ? ` (${diferencias[0].replace(/\.$/, '')})` : '';
    respuesta = `Recibí tu comprobante. Hay un dato que no me coincide${detalle}. `
      + (puedeEscribir ? `Para resolverlo, escríbele directo a ${negocio}.` : `Quien lo revisa es ${negocio}.`);
    motivo = `comprobante con diferencia: ${diferencias.join('; ') || 'sin detalle'}; `
      + `el pedido es de ${importe || 'monto no registrado'}; revisar el banco y escribirle`;
  } else if (resultado === 'ilegible') {
    respuesta = 'Recibí tu comprobante pero no pude leerlo bien. '
      + '¿Me lo mandas de nuevo, más nítido o como PDF desde la app de tu banco?';
    motivo = 'llegó un comprobante ilegible y se le pidió que lo reenvíe';
  } else {
    const porQue = codigo === 409 ? String(cuerpo.error || 'sin pago pendiente')
      : (Number.isFinite(codigo) && codigo > 0 ? `el panel contestó ${codigo}` : 'el panel no contestó');
    respuesta = 'Recibí tu comprobante, pero no pude cotejarlo. '
      + (puedeEscribir ? `Para revisarlo, escríbele directo a ${negocio}.` : `Quien lo revisa es ${negocio}.`);
    motivo = `comprobante recibido sin poder cotejar (${porQue}); revisarlo a mano`;
  }

  out.push({ json: {
    ...previo,
    respuesta,
    // Con los datos coincidiendo NO se avisa: el cierre ya está en la consola
    // con su cotejo, y el negocio confirma el pago en su banco cuando prepara
    // el pedido. Avisar por cada venta que sí cuadra sería ruido, y el ruido
    // hace que los avisos que importan no se lean.
    transferir: resultado !== 'cuadra',
    motivoTransferencia: motivo,
    textoAviso: `🔔 NovuChat (${negocio}): comprobante de ${previo.nombrePerfil || 'sin nombre de perfil'} `
      + `(${previo.from}). ${motivo}.`,
    resultadoCobro: resultado,
    diferencias,
    cierreId: String(cuerpo.cierreId || ''),
    from: previo.from,
    nombrePerfil: previo.nombrePerfil,
    phoneNumberId: previo.phoneNumberId,
    numeroDueno: previo.numeroDueno,
    waGraphVersion: previo.waGraphVersion,
  }, pairedItem: { item: i } });
}
return out;
