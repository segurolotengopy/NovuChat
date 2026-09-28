// EL MENSAJE FINAL DEL COMPROBANTE, CON LA CITA SI SE PUDO LEER.
//
// Todos los caminos del cotejo pasan por aca antes de `Mensaje a enviar`:
// el que no cuadro y el ilegible llegan tal cual desde `¿Cuadró la seña?`;
// el que cuadro pasa antes por `Leer cita retenida` (para saber dia, hora y
// quien atiende) y por `Confirmar cita retenida` (que le quita al titulo el
// prefijo PENDIENTE DE SEÑA, que es lo que la sacaria del barrido de señas
// vencidas). Si la lectura fallo, el texto sale sin la fecha --nunca
// inventada-- y recepcion se entera en el motivo.
//
// SI NO SE PUDO QUITAR EL PREFIJO, se dice en el aviso a recepcion: el flujo
// de señas vencidas NO borra una cita que el servidor ya tiene como agendada
// (le contesta `ya_agendada`), asi que no se pierde, pero el titulo hay que
// corregirlo a mano. Lo que el texto al paciente sigue sin decir, en todos
// los casos: «acreditado», «verificado», «recibimos tu pago» (prohibicion 3).
const base = $('Respuesta de la seña').first().json;
const cfg = $('Config del negocio').first().json;

// LA CITA SE LEE DE LA SALIDA DE EXITO, NO DE LA DE ERROR (2026-09-21).
// `Leer cita retenida` tiene dos salidas y este nodo cuelga de la de ERROR;
// `$('Leer cita retenida').first()` sin indice leia esa, que en el camino bueno
// esta vacia. Resultado, desde que existe la seña: la cita NUNCA se leia en el
// pago que cuadro --«no pude leer la cita retenida»--, y no se noto porque a
// recepcion se le avisaba siempre. Se toma primero la respuesta de `Confirmar
// cita retenida`, que es la misma cita ya sin el rotulo; y si esa fallo, la de
// `Leer cita retenida`, pidiendo explicitamente su salida 0 (la de exito).
let tituloCorregido = false;
let confirmada = null;
try {
  const u = $('Confirmar cita retenida').first().json;
  if (u && u.id && !u.error) { tituloCorregido = true; confirmada = u; }
} catch (err) { tituloCorregido = false; }
let evento = confirmada;
if (!evento) {
  try {
    const e = $('Leer cita retenida').first(0).json;
    if (e && e.id && !e.error) evento = e;
  } catch (err) { evento = null; }
}

let respuesta = String(base.respuesta || '');
let motivo = String(base.motivoTransferencia || '');

if (base.resultadoSena === 'cuadra') {
  if (evento) {
    let equipo = [];
    try { equipo = JSON.parse(cfg.funcionarios || '[]'); } catch (err) { equipo = []; }
    const calendario = String((evento.organizer && evento.organizer.email) || base.calendarioDelEvento || '');
    const f = Array.isArray(equipo) ? equipo.find((x) => x && x.calendario === calendario) : null;
    const persona = f && f.nombre ? String(f.nombre) : '';
    const titulo = String(evento.summary || '').replace(/^PENDIENTE DE SEÑA · /, '');
    // El titulo trae el servicio como lo nombra el catalogo por dentro
    // («blanqueamiento-dental-profesional»): al paciente se le escribe con
    // espacios (21/09/2026).
    const servicio = (titulo.split('—')[1] || '').trim().replace(/-/g, ' ');
    let fecha = '';
    let hora = '';
    try {
      const d = new Date(evento.start && evento.start.dateTime);
      fecha = d.toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/La_Paz' });
      hora = d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' });
    } catch (err) { fecha = ''; hora = ''; }
    if (fecha && hora) {
      const deUsted = /\busted\b/i.test(String(cfg.tratamiento || ''));
      const su = deUsted ? 'Su' : 'Tu';
      const detalle = `${su} cita${servicio ? ` de ${servicio}` : ''} queda reservada para el ${fecha} a las ${hora}`
        + `${persona ? ` con ${persona}` : ''}.`;
      respuesta = respuesta.replace(`${su} cita queda reservada.`, detalle);
      motivo += `; cita: ${[servicio, fecha, hora, persona].filter(Boolean).join(' · ')}`;
    }
  } else {
    motivo += '; no pude leer la cita retenida en el calendario: revisar la agenda a mano';
  }
  if (!tituloCorregido) {
    motivo += '; ATENCIÓN: el título de la cita sigue con el prefijo PENDIENTE DE SEÑA, quitarlo a mano en el calendario';
  }
}

// A RECEPCION, SOLO SI HAY UN PROBLEMA (Andres, 20/09/2026). Con el
// comprobante cotejado y los datos coincidiendo no se avisa: la clinica
// verifica el adelanto el dia que el paciente viene a atenderse, y un aviso por
// cada reserva pagada es ruido que termina haciendo ignorar los que importan.
// Se avisa si el comprobante no cuadro o no se leyo, y tambien si cuadro pero
// algo del calendario fallo (no se pudo leer la cita o quitarle el rotulo):
// eso SI lo tiene que arreglar una persona.
const cuadro = base.resultadoSena === 'cuadra';
const problemaDeAgenda = cuadro && (!evento || !tituloCorregido);
const transferir = !cuadro || problemaDeAgenda;

// LA UBICACION, CON EL PIN NATIVO, DESPUES DEL PAGO (Andres, 20/09/2026: «tiene
// que mandar la ubicacion, aunque sea en un segundo mensaje»). Es el momento en
// que el paciente ya tiene la cita y necesita saber a donde ir. Va como pin de
// WhatsApp y NO como enlace de Maps: el enlace corto muere en Android con
// «Invalid Dynamic Link» (19/09), y por eso el texto ya lo omite cuando hay
// coordenadas. Un mensaje mas por reserva PAGADA, aceptado por Andres; sin
// coordenadas cargadas no sale nada, y el texto ya lleva la direccion.
const coord = (v, max) => { const t = String(v ?? '').trim(); const n = Number(t);
  return t !== '' && Number.isFinite(n) && Math.abs(n) <= max ? n : null; };
const lat = coord(cfg.ubicacionLat, 90);
const lng = coord(cfg.ubicacionLng, 180);
const pin = cuadro && !!evento && lat !== null && lng !== null;

return [{ json: { ...base, respuesta, motivoTransferencia: transferir ? motivo : '', transferir, tituloCorregido,
  enviarUbicacion: pin, ubicacionLat: lat, ubicacionLng: lng,
  direccion: String(cfg.direccion ?? ''), nombreNegocio: String(cfg.nombreNegocio ?? ''),
  phoneNumberId: String(base.phoneNumberId || cfg.phoneNumberId || ''),
  waGraphVersion: String(base.waGraphVersion || cfg.waGraphVersion || 'v26.0'),
}, pairedItem: { item: 0 } }];
