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

return calendarios.map((calendarioARevisar) => ({ json: { ...base, calendarioARevisar, revisionAcotada } }));
