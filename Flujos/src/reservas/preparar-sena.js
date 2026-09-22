// EL QR DE LA SEÑA, CON EL RESUMEN DE LA CITA EN EL PIE (bloque 2, Analisis/30 §4).
//
// Llega el item de `Comprobar reserva` (la cita ya esta verificada en el
// calendario, la seña esta activa y no hubo cruce). Aca se arma el caption
// del mensaje de imagen: que cita es --servicio, dia, hora, quien atiende--,
// cuanto es la seña, que hacer con el comprobante y cuantos minutos queda
// retenido el horario. Los datos de la cita salen del evento que
// `Verificar en el calendario` ya trajo: NINGUNA consulta extra.
//
// LA PERSONA se deduce del calendario donde vive la cita, cruzado con
// `funcionarios` de la configuracion, como hace `Comprobar reserva`: el
// titulo solo trae el nombre del cliente y el servicio.
//
// LO QUE ESTE TEXTO NO DICE, A PROPOSITO (CLAUDE.md, prohibicion 3): nada de
// «acreditado», «verificado» ni «recibido» sobre un pago, y nada de
// «simulado»: este QR es el del comercio y el dinero va a su cuenta.
//
// COSTO: +1 mensaje por conversacion, SOLO en las que llegan a reservar con
// la seña activa. Se reporta como saliente `image` en `Reportar QR (saliente)`.
const item = $input.first().json;
const cfg = $('Config del negocio').first().json;

let eventos = [];
try {
  eventos = $('Verificar en el calendario').all().map((i) => i.json).filter((e) => e && e.id);
} catch (e) { eventos = []; }
const eventoId = String(item.eventoId || '');
const ev = eventos.find((e) => String(e.id) === eventoId) || null;

let equipo = [];
try { equipo = JSON.parse(cfg.funcionarios || '[]'); } catch (e) { equipo = []; }
const creados = Array.isArray(item.eventosCreados) ? item.eventosCreados : [];
const creado = creados.find((e) => e && String(e.id) === eventoId) || null;
const calendario = String((ev && ev.organizer && ev.organizer.email)
  || (creado && creado.calendario) || item.calendarioDelEvento || '');
const f = Array.isArray(equipo) ? equipo.find((x) => x && x.calendario === calendario) : null;
const persona = f && f.nombre ? String(f.nombre) : '';

const titulo = String((ev && ev.summary) || (creado && creado.titulo) || '')
  .replace(/^PENDIENTE DE SEÑA · /, '');
const servicio = (titulo.split('—')[1] || '').trim();
const inicio = String((ev && ev.start && ev.start.dateTime) || (creado && creado.inicio) || '');
let fecha = '';
let hora = '';
if (inicio) {
  try {
    const d = new Date(inicio);
    fecha = d.toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/La_Paz' });
    hora = d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' });
  } catch (err) { fecha = ''; hora = ''; }
}

// El trato sale de la configuracion, como en el prompt: «usted» si el negocio
// lo pidio, y si no, tuteo. Los emojis, solo si el negocio no los apago.
const deUsted = /\busted\b/i.test(String(cfg.tratamiento || ''));
const conEmojis = String(cfg.nivelEmojis || '') !== 'ninguno';
const e = (s) => (conEmojis ? s + ' ' : '');
const importe = `${String(cfg.senaImporte || '').trim()} ${String(cfg.senaMoneda || 'Bs').trim()}`.trim();
const minutos = String(cfg.senaMinutosRetencion || '30').trim();

const cuando = [fecha, hora].filter(Boolean).join(' ');
const resumen = [servicio || 'su cita', cuando, persona].filter(Boolean).join(' · ');
const lineas = [
  `${e('📅')}Reserva: ${resumen}`,
  `${e('💳')}Seña: ${importe} (se descuenta del tratamiento). `
    + (deUsted ? 'Escanee el QR con la app de su banco.' : 'Escaneá el QR con la app de tu banco.'),
  `${e('🧾')}` + (deUsted
    ? 'Cuando termine, guarde o comparta el comprobante ANTES de salir de la app y mándemelo por acá, como foto o PDF.'
    : 'Cuando termines, guardá o compartí el comprobante ANTES de salir de la app y mandámelo por acá, como foto o PDF.'),
  `${e('⏳')}El horario queda reservado ${minutos} minutos.`,
];
// Meta acepta hasta 1.024 caracteres de caption.
const captionQr = lineas.join('\n').slice(0, 1024);

return [{ json: {
  ...item,
  captionQr,
  eventoId,
  calendarioDelEvento: calendario,
  senaQrUrl: String(cfg.senaQrUrl || ''),
  senaImporte: String(cfg.senaImporte || ''),
  phoneNumberId: String(cfg.phoneNumberId || item.phoneNumberId || ''),
  waGraphVersion: String(cfg.waGraphVersion || item.waGraphVersion || 'v26.0'),
  from: item.from,
}, pairedItem: { item: 0 } }];
