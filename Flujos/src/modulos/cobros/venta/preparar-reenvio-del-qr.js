// REENVIAR EL QR DE UN PAGO QUE SIGUE PENDIENTE.
//
// POR QUÉ EXISTE. Es el caso real del 20/09/2026 en Platinum: una clienta
// escribió «con el QR por favor» porque el mensaje no le había llegado, y el
// asistente contestó que «el sistema automático de pagos por QR no está
// disponible». Era mentira: lo inventó porque NO había forma de reenviarlo. El
// QR salía solo al cerrar un pedido nuevo, así que un mensaje perdido dejaba al
// cliente sin salida y al modelo inventando.
//
// Acá no se recalcula ningún total ni se crea nada: se reenvía LA MISMA imagen
// del pago que ya está pendiente, con un pie corto. El importe y el pedido los
// sabe el servidor (`cobro.monto`, `cobro.pedido`), que ya los mandó.
//
// PROHIBICIÓN 3: no se dice nada sobre un pago recibido, acreditado ni
// verificado --todavía no pagó nadie--; y con cobro simulado el rótulo abre el
// pie, igual que en el envío original.
//
// COSTO: CERO mensajes agregados. Reemplaza a la respuesta de texto que el
// modelo daba igual en este turno, por una imagen con pie que sí resuelve.
const cfg = $('Config del negocio').first().json;
const item = $input.first().json;

const cobroReal = String(cfg.cobroRealActivo || '') === 'si';
const conEmojis = String(cfg.nivelEmojis || '') !== 'ninguno';
const e = (s) => (conEmojis ? s + ' ' : '');
const moneda = String(cfg.moneda || 'Bs').trim();
const monto = String(cfg.cobroMonto || '').trim();
const importe = monto ? `${monto} ${moneda}`.trim() : '';

const lineas = [];
if (!cobroReal) lineas.push(String(cfg.rotuloDemo || '').trim());
lineas.push(`${e('💳')}Este es el QR de tu pedido`
  + (importe ? `, por ${importe}.` : '.'));
if (cobroReal) {
  lineas.push(`${e('🧾')}Cuando termines, guardá o compartí el comprobante ANTES de salir de la `
    + 'app y mandámelo por acá, como foto o PDF.');
} else {
  lineas.push(String(cfg.captionQr || '').trim());
}

const enlace = cobroReal ? String(cfg.cobroQrUrl || '').trim() : String(cfg.qrUrl || '').trim();
const media = cobroReal ? '' : String(cfg.qrMediaId || '').trim();
const mediaUtil = media !== '' && !media.startsWith('REEMPLAZAR');

return [{ json: {
  ...item,
  captionQr: lineas.filter(Boolean).join('\n\n').slice(0, 1024),
  qrEnlace: enlace,
  qrMedia: mediaUtil ? media : '',
  qrEsReal: cobroReal,
  // UN REENVÍO NO ABRE UN PAGO NUEVO: el QR pendiente es el mismo, con su
  // mismo total y su mismo reloj. Por eso `cobroTotal` va vacío y
  // «Reportar QR (saliente)» no manda el hecho `qr_enviado`: si lo mandara,
  // la ingesta reiniciaría la solicitud y el plazo, y un cliente que pide el
  // QR cada hora tendría un pago pendiente eterno.
  cobroTotal: '',
  esReenvio: true,
  phoneNumberId: String(cfg.phoneNumberId || item.phoneNumberId || ''),
  waGraphVersion: String(cfg.waGraphVersion || item.waGraphVersion || 'v26.0'),
  from: item.from,
}, pairedItem: { item: 0 } }];
