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

// TODAS LAS DIFERENCIAS AL CLIENTE, el destinatario primero (Andres, 07/11/2026: condicion general del sistema). El servidor lista TODAS en `diferencias`; antes el texto al cliente mostraba solo la
// primera y, peor, copiaba lo leido de la imagen («El deposito fue a la cuenta <la que leyo>», «figura a <el nombre que leyo>»). Ahora cada diferencia conocida sale en su frase FIJA (nada leido de la
// imagen; solo los dos importes que el servidor ya tradujo) y una que no se reconoce sale como «otro dato del comprobante» (nunca cruda: el detalle va solo a Recepcion). Recepcion sigue recibiendo el detalle completo en el motivo.
const frasesParaElCliente = (lista, referencia) => {
  const grupo = (d) => (/^El dep[oó]sito (fue a la cuenta|figura a)|^El comprobante no muestra a qu[eé] cuenta/.test(d) ? 0 : (/^(El comprobante dice|No se pudo leer el importe)/.test(d) ? 1 : 2));
  const traducir = (d) => {
    if (/^El dep[oó]sito fue a la cuenta/.test(d)) return 'la cuenta de destino no es la del QR';
    if (/^El dep[oó]sito figura a/.test(d)) return 'el nombre del destinatario no coincide con el de la cuenta';
    if (/^El comprobante no muestra a qu[eé] cuenta/.test(d)) return 'en el comprobante no se ve a qué cuenta se depositó';
    const m = /^El comprobante dice (\d+(?:[.,]\d+)*) y (?:el pedido|la seña) es de (\d+(?:[.,]\d+)*)/i.exec(d);
    if (m) return `el comprobante dice ${m[1]} y ${referencia} es de ${m[2]}`;
    if (/^No se pudo leer el importe/.test(d)) return 'no pude leer el importe';
    if (/^No se pudo leer la fecha/.test(d)) return 'no pude leer la fecha';
    if (/^El comprobante es anterior al pedido/.test(d)) return `la fecha del comprobante es anterior a ${referencia === 'la seña' ? 'la reserva' : 'tu pedido'}`;
    if (/^El comprobante tiene una fecha posterior/.test(d)) return 'la fecha del comprobante no es correcta';
    return 'otro dato del comprobante';
  };
  const orden = lista.map((d, i) => ({ d, i })).sort((a, b) => grupo(a.d) - grupo(b.d) || a.i - b.i).map((x) => traducir(x.d));
  return orden.filter((f, i) => f !== '' && orden.indexOf(f) === i);
};
const detalleDeDiferencias = (frases) => (frases.length > 1
  ? { plural: true, texto: ` (${frases.slice(0, -1).join(', ')} y ${frases[frases.length - 1]})` }
  : { plural: false, texto: frases[0] ? ` (${frases[0]})` : '' });

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
    const dif = detalleDeDiferencias(frasesParaElCliente(diferencias, 'la seña'));
    respuesta = `Recibí ${su} comprobante. ${dif.plural ? 'Hay varios datos que no me coinciden' : 'Hay un dato que no me coincide'}${dif.texto}, así que lo va a revisar `
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
