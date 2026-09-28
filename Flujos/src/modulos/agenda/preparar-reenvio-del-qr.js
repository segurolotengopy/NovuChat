// REENVIAR EL QR DE UNA SEÑA QUE SIGUE PENDIENTE (2026-09-20).
//
// POR QUE EXISTE. Una clienta escribio «con el QR por favor» porque el mensaje
// no le habia llegado, y el asistente contesto que «el sistema automatico de
// pagos por QR no esta disponible». Era mentira: lo invento porque NO habia
// forma de reenviarlo. El QR solo salia al crear una reserva nueva, asi que un
// mensaje perdido dejaba al paciente sin salida y al modelo inventando.
//
// Aca no se consulta el calendario ni se crea nada: se reenvia LA MISMA imagen
// de la seña que ya esta pendiente, con un pie corto que dice lo que hace
// falta. La fecha limite sale de `senaQrEnviadoEn` + los minutos de retencion,
// dos datos que el servidor ya manda: ninguna llamada extra.
//
// PROHIBICION 3: no se dice nada sobre un pago recibido, acreditado ni
// verificado. Solo que el QR es el de su reserva y hasta cuando queda.
const cfg = $('Config del negocio').first().json;
const item = $('Mensaje a enviar').first().json;

const usa = String(cfg.trato || '').toLowerCase() === 'usted';
const conEmojis = String(cfg.emojis || '') !== 'no';
const e = (x) => (conEmojis ? x + ' ' : '');

const importe = `${String(cfg.senaImporte || '').trim()} ${(cfg.senaMoneda || 'Bs').trim()}`.trim();
const minutos = Number(cfg.senaMinutosRetencion || 30);

// Hasta que hora queda el horario, en la zona del negocio. Si no se puede
// calcular, no se inventa ninguna hora: se dice en minutos.
let limite = '';
const enviado = Date.parse(String(cfg.senaQrEnviadoEn || ''));
if (Number.isFinite(enviado) && Number.isFinite(minutos)) {
  const vence = new Date(enviado + minutos * 60 * 1000);
  try {
    limite = vence.toLocaleTimeString('es-BO', {
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: String(cfg.zonaHoraria || 'America/La_Paz'),
    });
  } catch (err) { limite = ''; }
}

const lineas = [
  `${e('💳')}Este es el QR de la seña de ${importe} de ${usa ? 'su' : 'tu'} reserva.`,
  `${e('🧾')}` + (usa
    ? 'Cuando termine, guarde o comparta el comprobante ANTES de salir de la app y mandemelo por aca, como foto o PDF.'
    : 'Cuando termines, guardá o compartí el comprobante ANTES de salir de la app y mandámelo por acá, como foto o PDF.'),
  limite
    ? `${e('⏳')}El horario queda reservado hasta las ${limite}.`
    : `${e('⏳')}El horario queda reservado ${minutos} minutos desde que se envió el primer QR.`,
];

return [{ json: {
  ...item,
  captionQr: lineas.join('\n').slice(0, 1024),
  senaQrUrl: String(cfg.senaQrUrl || ''),
  phoneNumberId: String(cfg.phoneNumberId || item.phoneNumberId || ''),
  waGraphVersion: String(cfg.waGraphVersion || item.waGraphVersion || 'v26.0'),
  from: item.from,
}, pairedItem: { item: 0 } }];
