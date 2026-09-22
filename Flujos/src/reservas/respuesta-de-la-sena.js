// QUE SE LE DICE AL PACIENTE SEGUN LO QUE CONTESTO EL SERVIDOR (Analisis/07 §4.5).
//
// Llega la respuesta COMPLETA de `cotejarComprobante` (codigo y cuerpo) y de
// aca sale UN mensaje fijo --sin modelo-- y el aviso a recepcion. Tres
// resultados, tres textos, y ninguno afirma un pago (CLAUDE.md, prohibicion
// 3): «los datos coinciden» no es «pago acreditado». Quien confirma que el
// dinero entro es el negocio, mirando su banco; por eso `transferir` es true
// SIEMPRE, con el motivo que le dice a recepcion que hacer.
//
//   cuadra     -> la cita queda reservada, sujeta a la verificacion del pago
//                 por el negocio. `confirmarCita` = true: mas adelante se le
//                 quita el prefijo PENDIENTE DE SEÑA al titulo de la cita y,
//                 con la cita leida, `Mensaje de la seña` completa dia, hora
//                 y persona en este mismo texto.
//   no_cuadra  -> hay un dato que no coincide; lo revisa una persona. El
//                 horario sigue reservado (la retencion sigue corriendo).
//   ilegible   -> no se pudo leer; se pide de nuevo, mas nitido o como PDF.
//   409 / caida -> se recibio un comprobante que no se pudo cotejar (no habia
//                 seña pendiente, la seña se apago, o el panel no contesto):
//                 lo mira una persona. Nunca se deja al paciente sin respuesta.
//
// COSTO: 1 mensaje al paciente (fijo, sin modelo) + 1 aviso a recepcion, que
// paga NovuChat. Los textos tratan de usted o tutean segun la configuracion.
const previos = $('Interpretar lectura').all();
const cfg = $('Config del negocio').first().json;
const items = $input.all();
const out = [];

const deUsted = /\busted\b/i.test(String(cfg.tratamiento || ''));
const conEmojis = String(cfg.nivelEmojis || '') !== 'ninguno';
const negocio = String(cfg.nombreNegocio || '').trim() || 'el negocio';
const importe = `${String(cfg.senaImporte || '').trim()} ${String(cfg.senaMoneda || 'Bs').trim()}`.trim();

for (let i = 0; i < items.length; i++) {
  const previo = (previos[i] ?? previos[previos.length - 1] ?? { json: {} }).json;
  const r = items[i].json ?? {};
  const codigo = Number(r.statusCode);
  const cuerpo = (r.body && typeof r.body === 'object') ? r.body : {};
  const resultado = codigo === 200 && ['cuadra', 'no_cuadra', 'ilegible'].includes(cuerpo.resultado)
    ? cuerpo.resultado : 'sin_cotejo';
  const diferencias = Array.isArray(cuerpo.diferencias) ? cuerpo.diferencias.map(String).slice(0, 10) : [];
  const evento = (cuerpo.evento && typeof cuerpo.evento === 'object' && cuerpo.evento.id)
    ? { id: String(cuerpo.evento.id), calendario: String(cuerpo.evento.calendario || '') } : null;
  const banco = String((previo.leido && previo.leido.banco) || '').trim();
  const montoLeido = String((previo.leido && previo.leido.monto) || '').trim();

  const su = deUsted ? 'su' : 'tu';
  const cara = conEmojis ? ' 🙂' : '';
  const pin = conEmojis ? '📍 ' : '';
  // EL ENLACE DEL MAPA SOLO SI NO HAY PIN (19/09/2026). Este pie es texto FIJO
  // del flujo, no lo escribe el modelo, asi que la regla 6c del prompt no lo
  // alcanza: seguia mandando el enlace corto de Maps, que en Android se
  // reescribe a la forma vieja de Dynamic Links --apagada por Google-- y muere
  // con «Invalid Dynamic Link». Con coordenadas cargadas va la direccion sola;
  // el pin nativo sale cuando el paciente lo pide, como en el resto del flujo.
  const hayPin = String(cfg.ubicacionLat || '').trim() !== '' && String(cfg.ubicacionLng || '').trim() !== '';
  const donde = [String(cfg.direccion || '').trim(),
    hayPin ? '' : String(cfg.direccionMaps || '').trim()].filter(Boolean).join(' · ');

  let respuesta = '';
  let motivo = '';
  if (resultado === 'cuadra') {
    respuesta = `Recibí ${su} comprobante y los datos coinciden con ${su} reserva${cara} `
      // «Tu cita queda reservada», y nada mas (Andres, 20/09/2026: «porque asi
      // es la realidad»). Sin «sujeta a la verificacion del pago» ni «ya avise a
      // recepcion»: con los datos coincidiendo no se avisa, y la clinica verifica
      // el adelanto el dia de la cita. La prohibicion 3 se sigue cumpliendo: no
      // se dice que el pago se acredito, solo que el comprobante coincide.
      + `${deUsted ? 'Su' : 'Tu'} cita queda reservada.`
      + (donde ? `\n${pin}${donde}` : '');
    motivo = `mensaje de NovuChat por cita pagada: llegó el comprobante de la seña de ${importe} y sus datos `
      + `coinciden (monto leído ${montoLeido || 'sin dato'}${banco ? `, banco ${banco}` : ''}); `
      + 'confirmar en el banco que el dinero entró antes de darla por cobrada';
  } else if (resultado === 'no_cuadra') {
    const detalle = diferencias[0] ? ` (${diferencias[0].replace(/\.$/, '')})` : '';
    respuesta = `Recibí ${su} comprobante. Hay un dato que no me coincide${detalle}, así que lo va a revisar `
      + `una persona de ${negocio} y ${deUsted ? 'le' : 'te'} escribe por acá. `
      + `${deUsted ? 'Su' : 'Tu'} horario sigue reservado mientras tanto.`;
    motivo = `comprobante con diferencia: ${diferencias.join('; ') || 'sin detalle'}; la seña es de ${importe}; `
      + 'la cita sigue retenida como PENDIENTE DE SEÑA: revisar el banco y escribirle';
  } else if (resultado === 'ilegible') {
    respuesta = `Recibí ${su} comprobante pero no pude leerlo bien. `
      + (deUsted ? '¿Me lo manda de nuevo, más nítido o como PDF desde la app de su banco?'
        : '¿Me lo mandás de nuevo, más nítido o como PDF desde la app de tu banco?');
    motivo = 'llegó un comprobante ilegible; se le pidió que lo reenvíe; la cita sigue retenida como PENDIENTE DE SEÑA';
  } else {
    const porQue = codigo === 409 ? String(cuerpo.error || 'sin seña pendiente')
      : (Number.isFinite(codigo) && codigo > 0 ? `el panel contestó ${codigo}` : 'el panel no contestó');
    respuesta = `Recibí ${su} comprobante. Lo revisa una persona de ${negocio} y ${deUsted ? 'le' : 'te'} escribe por acá.`;
    motivo = `comprobante recibido sin poder cotejar (${porQue}); revisarlo a mano contra la seña de ${importe}`;
  }

  out.push({ json: {
    ...previo,
    respuesta,
    // Con los datos coincidiendo no se avisa (Andres, 20/09/2026); la decision
    // final la toma `Mensaje de la seña`, que ademas mira si el calendario fallo.
    transferir: resultado !== 'cuadra',
    motivoTransferencia: motivo,
    resultadoSena: resultado,
    diferencias,
    confirmarCita: resultado === 'cuadra' && evento !== null && evento.calendario !== '',
    eventoId: evento ? evento.id : '',
    calendarioDelEvento: evento ? evento.calendario : '',
    cierreId: String(cuerpo.cierreId || ''),
    from: previo.from,
    nombrePerfil: previo.nombrePerfil,
  }, pairedItem: { item: i } });
}
return out;
