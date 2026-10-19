// ARMAR AVISOS (PR-2: el aviso MÍNIMO a Rubén, solo TEXTO LIBRE): un mensaje a la persona de recepción (el WhatsApp de Rubén) cuando hay un comprobante para revisar o una consulta que solo él ve.
//
// SIN PLANTILLAS (son de PR-3, que las agrega aquí mismo con `avPlantilla`): un texto libre solo entra si Rubén escribió al número en las últimas 24 h; si no, Meta lo rechaza y NO hay `wamid`:
// «Armar mensajes» lo sabe y al cliente le dice la verdad («no pude avisarle a Rubén»), nunca «ya pasé tu comprobante». El aviso NUNCA reenvía la imagen del comprobante ni dice «pago acreditado».
// Lee el plan de «Decidir turno» (`plan.aviso`: { tipo: 'comprobante' | 'consulta', ... }); todo texto pasa por `avLimpio` (sin enlaces, sin llaves, sin palabras prohibidas, con tope).
// En modo prueba el aviso va al teléfono de prueba, nunca al de Rubén. Un destinatario igual a quien escribe se descarta (`avDestinatarios`).
const cfg = cnCfg();
const turno = cnPrimero('Decidir turno') || {};
const plan = turno.plan && typeof turno.plan === 'object' ? turno.plan : {};
const aviso = plan.aviso && typeof plan.aviso === 'object' ? plan.aviso : null;
const t = cnPrimero('Interpretar entrada') || {};
const from = String(turno.from || t.from || '');
const sinAviso = () => [{ json: { sinAviso: true, plan: plan.tipo || '' } }];
if (!aviso || !cnClaveValida(from)) return sinAviso();

const prueba = cfg.modoPrueba === true;
let destinatarios = [];
if (prueba) {
  const tel = cnDigitos(cfg.telefonoDePrueba);
  if (tel) destinatarios = [{ rol: 'completo', tel: tel, nombre: '' }];
} else {
  destinatarios = avDestinatarios('completo:' + cnDigitos(cfg.numeroRecepcion), from, cfg.prefijosPermitidos, false);
}
if (!destinatarios.length) return sinAviso();

const nombre = avPrimerNombre(t.nombrePerfil) || 'sin nombre';
const cliente = nombre + ' (+' + from + ')';
let texto = '';
if (aviso.tipo === 'comprobante') {
  const prod = avLimpio(aviso.producto, 80) || 'producto';
  const monto = typeof aviso.monto === 'number' && aviso.monto > 0 ? cbMonto(aviso.monto) + ' Bs' : 'sin monto';
  const estado = cbEstadoParaAviso(aviso.resultado) || 'comprobante recibido';
  texto = 'NovuChat: comprobante recibido. Cliente: ' + cliente + '. Producto: ' + prod + ' por ' + monto + '. Estado: ' + estado
    + '. Revisa el depósito en tu cuenta antes de enviarle el material por este chat. La imagen queda guardada en la consola.';
} else if (aviso.tipo === 'consulta') {
  texto = 'NovuChat: consulta para Rubén. Cliente: ' + cliente + '. Motivo: ' + (avLimpio(aviso.motivo, 80) || 'consulta') + '.'
    + (aviso.mensaje ? ' Mensaje del cliente: «' + avLimpio(aviso.mensaje, 160) + '».' : '') + ' Respóndele directamente por WhatsApp.';
} else {
  return sinAviso();
}
texto = avLimpio(texto, 900);
if (!texto) return sinAviso();

const base = { phoneNumberId: String(cfg.phoneNumberId || ''), waGraphVersion: cfg.waGraphVersion || 'v26.0', sinAviso: false, plan: plan.tipo || '' };
return destinatarios.map((d) => ({ json: Object.assign({}, base, { para: d.tel, rol: d.rol, payload: avTexto(d.tel, texto) }) }));
