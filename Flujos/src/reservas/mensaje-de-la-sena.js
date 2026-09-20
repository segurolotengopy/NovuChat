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

let evento = null;
try {
  const e = $('Leer cita retenida').first().json;
  if (e && e.id && !e.error) evento = e;
} catch (err) { evento = null; }
let tituloCorregido = false;
try {
  const u = $('Confirmar cita retenida').first().json;
  tituloCorregido = !!(u && u.id && !u.error);
} catch (err) { tituloCorregido = false; }

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
    const servicio = (titulo.split('—')[1] || '').trim();
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
        + `${persona ? ` con ${persona}` : ''}, sujeta a la verificación del pago por`;
      respuesta = respuesta.replace(`${su} cita queda reservada, sujeta a la verificación del pago por`, detalle);
      motivo += `; cita: ${[servicio, fecha, hora, persona].filter(Boolean).join(' · ')}`;
    }
  } else {
    motivo += '; no pude leer la cita retenida en el calendario: revisar la agenda a mano';
  }
  if (!tituloCorregido) {
    motivo += '; ATENCIÓN: el título de la cita sigue con el prefijo PENDIENTE DE SEÑA, quitarlo a mano en el calendario';
  }
}

return [{ json: { ...base, respuesta, motivoTransferencia: motivo, transferir: true, tituloCorregido }, pairedItem: { item: 0 } }];
