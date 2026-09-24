// Emite un item por cada calendario que hay que revisar: SOLO el que recibio
// la cita y, si no se sabe cual fue, TODOS los configurados.
//
// POR QUE EXISTE. `agendar_cita` escribe en el calendario del servicio o de
// la persona -- el de belleza o el de odontologia -- mientras que la
// verificacion leia el calendario por defecto. Nunca encontraba nada, la
// compuerta mandaba la disculpa, el cliente insistia y el agente volvia a
// agendar: el 2026-08-30 eso produjo TRES pedicures y TRES ortodoncias
// identicas. Y LAS AGENDAS DE LOS FUNCIONARIOS TAMBIEN: si una persona tiene
// calendario propio y la verificacion no lo mira, pasa lo mismo.
//
// POR QUE YA NO SE REVISAN TODOS (2026-09-17, `Analisis/24` §4). El nodo de
// Calendar corre una vez por item, asi que cada calendario emitido es UNA
// llamada a Google en el turno que agenda, que ya es el mas lento. Y
// `Comprobar reserva` descarta los eventos de calendarios distintos al de la
// cita nueva: dos personas a la misma hora no se pisan. Con 7 odontologos
// eran 7 llamadas para descartar 6. Ese costo, lineal en el numero de agendas,
// es lo que ponia techo a las agendas por plan (1 / 5 / hasta 10).
//
// Desde el 17/09 `Procesar respuesta` trae en `eventosCreados` los eventos que
// `agendar_cita` devolvio en esta vuelta, con `calendario` = `organizer.email`
// del evento, que es el identificador del calendario donde vive. Con eso
// alcanza: se revisa ese calendario y ninguno mas. Una cita, una llamada; dos
// citas en agendas distintas, dos. El numero de agendas del negocio deja de
// pesar en la latencia.
//
// RESPALDO OBLIGATORIO: si `eventosCreados` viene vacio o ningun evento trae
// calendario -- la verificacion se abrio por el texto del modelo, o por
// `isExecuted` sin observacion, o la herramienta fallo y la observacion no es
// un evento -- se emiten TODOS, como antes. NUNCA cero items: el candado no
// puede dejar de correr por no saber en que calendario quedo la cita. Un
// calendario de mas es una llamada; uno de menos es una cita encima de otra.
//
// El calendario que trae el evento se usa AUNQUE no figure en la configuracion:
// es donde la herramienta escribio de verdad, y eso es lo que hay que mirar.
const cfg = $('Config del negocio').first().json;

let equipoCal = [];
try {
  equipoCal = JSON.parse(cfg.funcionarios || '[]')
    .map((f) => f && f.calendario).filter(Boolean);
} catch (e) { equipoCal = []; }

let mapa = {};
try { mapa = JSON.parse(cfg.calendariosPorServicio || '{}'); } catch (e) { mapa = {}; }

const todos = [...new Set([cfg.calendarioId, ...Object.values(mapa), ...equipoCal].filter(Boolean))];

const base = $input.first().json;
const creados = Array.isArray(base.eventosCreados) ? base.eventosCreados : [];
const delEvento = [...new Set(creados
  .map((e) => String((e && e.calendario) || '').trim())
  .filter(Boolean))];

const calendarios = delEvento.length ? delEvento : todos;
const revisionAcotada = delEvento.length > 0;

// --- LA VENTANA TAMBIEN SE ACOTA, NO SOLO EL CALENDARIO (Andres, 24/09/2026) -
//
// EL PROBLEMA, con nombre y apellido. `Verificar en el calendario` traia hasta
// 50 eventos de una ventana de 90 dias. El calendario del Dr. Bellido tiene un
// evento REPETIDO TODOS LOS DIAS de 13:00 a 14:00 --el almuerzo-- y con
// `singleEvents` cada repeticion cuenta como un evento, y con la lista saturada
// la deteccion de cruces puede quedar CIEGA -- el candado es la regla
// mandatoria del 17/09.
//
// CUANTO FALTABA DE VERDAD, medido despues de escribir esto: el 24/09, con la
// ventana vieja de 90 dias, ese calendario devolvio ONCE eventos, no cincuenta
// (ejecucion #5424). El tope NO se estaba alcanzando, y decir que «el almuerzo
// solo ya lo llena» fue una afirmacion sin medir. El arreglo se queda igual
// --una ventana de un dia es mas barata y mas rapida que una de noventa, y el
// limite existe--, pero la urgencia era del que escribia, no del calendario.
//
// LA SALIDA NO ES SUBIR EL LIMITE, es no pedir 90 dias. Para saber si la cita
// que se acaba de crear se superpone con otra, alcanza con mirar SU DIA. Con la
// ventana del dia, el almuerzo aporta UN evento en vez de noventa, y las 50
// ranuras pasan a ser holgadas para cualquier consultorio. Ademas la consulta
// es mas rapida, que es lo que `CLAUDE.md` pedia para poder prometer mas
// agendas por plan.
//
// CUANDO NO HAY CITA CREADA se conserva la ventana larga, y no es un descuido:
// ese es el camino del detector de texto --el modelo DIJO que agendo y la
// herramienta no corrio--, donde no hay fecha en la cual anclarse. Ahi la
// saturacion no hace daño: si no se creo nada, lo que se busca no existe y la
// respuesta correcta es justamente «no quedo registrada».
const DIA_MS = 86400000;
const instantes = creados.flatMap((e) => [Date.parse(String((e && e.inicio) || '')),
  Date.parse(String((e && e.fin) || ''))]).filter((n) => Number.isFinite(n));
const ahora = Date.now();
const ventanaDesde = instantes.length
  ? new Date(Math.min(...instantes) - DIA_MS).toISOString()
  : new Date(ahora - DIA_MS).toISOString();
const ventanaHasta = instantes.length
  ? new Date(Math.max(...instantes) + DIA_MS).toISOString()
  : new Date(ahora + 90 * DIA_MS).toISOString();
const ventanaAcotada = instantes.length > 0;

return calendarios.map((calendarioARevisar) => ({
  json: { ...base, calendarioARevisar, revisionAcotada, ventanaDesde, ventanaHasta, ventanaAcotada },
}));
