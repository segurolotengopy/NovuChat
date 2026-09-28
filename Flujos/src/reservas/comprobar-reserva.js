// COMPUERTA DE VERIFICACION DE RESERVA — y CANDADO CONTRA LA DOBLE RESERVA.
//
// Historia, porque el diseño cambio por evidencia y no por gusto: la primera
// version reemplazaba la respuesta por una disculpa cuando no podia verificar
// la cita. Fallo cuatro veces por falso negativo, y CADA vez el daño real no lo
// hizo la compuerta sino la reaccion en cadena: el cliente leia la disculpa,
// insistia, y el agente volvia a llamar a agendar_cita. Asi aparecieron tres
// pedicures, tres ortodoncias y dos pares de citas duplicadas.
//
// Por eso, cuando NO puede verificar, no toca el mensaje: avisa a recepcion y
// sigue. Falla ABIERTA. Un falso negativo solo genera un aviso de mas.
//
// ---------------------------------------------------------------------------
// EL CANDADO (2026-09-06). Falla CERRADA, al reves que lo de arriba, y por una
// razon distinta.
//
// QUE PASO. En una prueba real el agente propuso las 9:00 sin consultar el
// calendario ni una vez -- comprobado ejecucion por ejecucion, de la #944 a la
// #968 -- y reservo encima de una cita que ya existia. Un funcionario quedo con
// dos citas de 9 a 10. Se corrigio el prompt, pero un prompt es una instruccion
// y ya se rompio una vez al cambiar de modelo: dos clientes presentandose a la
// misma hora no puede depender de que el modelo obedezca.
//
// COMO FUNCIONA, sin una sola consulta extra. `Verificar en el calendario` ya
// trae TODOS los eventos de TODOS los calendarios, y cada evento viene con
// `organizer.email`, que es el identificador del calendario donde vive. Con eso
// alcanza: si la cita recien creada se superpone con otra del MISMO calendario,
// hay doble reserva. Distinto calendario no es conflicto -- Maria y Jose pueden
// atender los dos a las 10:00, que es justamente para lo que existen las
// agendas por persona.
//
// QUIEN CEDE. Se borra la MAS NUEVA. Asi dos conversaciones simultaneas no se
// borran mutuamente: la que llego primero se queda con el horario.
//
// LIMITE CONOCIDO: la consulta trae hasta 50 eventos por calendario en 90 dias.
// Un negocio con mas citas que eso podria dejar una superposicion sin ver. Hay
// que subir el limite o acotar la ventana antes del primer cliente grande.
const previos = $('Procesar respuesta').all();
const VENTANA_MS = 5 * 60 * 1000;
const ahora = Date.now();

const todos = $input.all().map(i => i.json).filter(e => e && e.id);

const item = previos[0].json;

// --- EL CALENDARIO NO CONTESTO (2026-09-18, ejecucion #2976 de Bellido) ------
// La regla de arriba --«cuando NO puede verificar, no toca el mensaje»-- vale
// para un falso negativo: la cita existe y la consulta no la trajo. Hoy paso
// otra cosa: la credencial de Google fallo («Client authentication failed»),
// consultar_disponibilidad y agendar_cita devolvieron ERROR, y el modelo igual
// escribio «Quedo agendada tu consulta... lunes 21 a las 11:00», con direccion
// y redes. El paciente habria ido a una cita que no existe.
//
// Con el calendario inaccesible NO PUEDE haber cita nueva: agendar_cita
// tambien falla. Corregir al cliente aca no arriesga la cascada de duplicados
// que motivo la regla de arriba (no hay nada que duplicar), y callarse es
// presentar algo como lo que no es. Asi que ESTE caso falla CERRADO: se
// reemplaza la respuesta por el texto configurado y se avisa a recepcion con
// el error real, que es lo que alguien tiene que ir a arreglar.
const fallos = $input.all().map(i => i.json).filter(e => e && e.error && !e.id);
if (fallos.length > 0 && todos.length === 0) {
  const detalle = String(fallos[0].error || 'sin detalle').slice(0, 160);
  const configurado = String(cfgCampo('mensajeReservaNoConfirmada') || '').trim();
  const aviso = configurado
    || 'Disculpa, en este momento no puedo confirmar tu cita en la agenda. Te paso con recepcion para que lo resuelva contigo ahora mismo.';
  return [{ json: { ...item,
    respuesta: aviso,
    reservaVerificada: false,
    verificacionFallo: true,
    transferir: true,
    motivoTransferencia: 'no se pudo consultar el calendario (' + detalle + '); el cliente pidio una cita y NO quedo registrada',
  }, pairedItem: { item: 0 } }];
}

// LOS EVENTOS QUE agendar_cita DEVOLVIO (2026-09-17, ejecucion #2936). Vienen
// de `Procesar respuesta`, que los saca de los pasos intermedios del agente.
// Cuentan como «recien creados» por su id, aunque la marca `created` cayera
// fuera de la ventana de cinco minutos (reloj corrido, ejecucion lenta): el
// ancla es la cita que la herramienta dijo haber creado, y la ventana queda
// como respaldo para cuando esos pasos no vengan. Si ninguno de los ids
// aparece en lo que trajo el calendario, queda anotado para auditarlo.
const idsCreados = new Set((Array.isArray(item.eventosCreados) ? item.eventosCreados : [])
  .map((e) => String((e && e.id) || '')).filter(Boolean));
const citaCreadaNoEncontrada = idsCreados.size > 0
  && ![...idsCreados].some((id) => todos.some((e) => String(e.id) === id));

// --- LA HERRAMIENTA FALLO Y EL CALENDARIO SI RESPONDE (2026-09-25) ---------
// El caso de arriba cubre la credencial caida: nada responde. Este es el otro:
// `Verificar en el calendario` contesta bien, pero `agendar_cita` corrio y NO
// devolvio ninguna cita (Google rechazo la creacion, o la fecha, o dio 403).
// n8n le entrega al modelo una observacion vacia (#5553) y el modelo escribe
// «quedo agendada» igual. Hasta hoy el candado fallaba ABIERTO aca: sin id que
// anclar y sin cita reciente que verificar, no tocaba el texto, y el paciente
// leia una confirmacion de una cita que no existe. Quedo anotado el 24/09 al
// cerrar el caso de la fecha pasada, y se cierra aca.
//
// Falla CERRADO por la misma razon que el calendario caido: si la herramienta
// no creo nada, no hay cita que duplicar, y callarse es presentar algo como lo
// que no es. Se dispara POR EL HECHO --la herramienta corrio y no trajo evento--
// y no por lo que el modelo dijo: asi cubre tambien el verbo que ninguna lista
// preve. Y va ANTES de mirar `recien`: una cita reciente de OTRA conversacion
// no es la de esta, y el respaldo de «la primera reciente» la tomaria como
// propia. Sin los pasos del agente (`agendarSinEvento` ausente) no se puede
// afirmar el fallo, y sigue el camino de siempre.
if (item.agendarSinEvento === true && idsCreados.size === 0) {
  const configurado = String(cfgCampo('mensajeReservaNoConfirmada') || '').trim();
  const aviso = configurado
    || 'Disculpa, en este momento no puedo confirmar tu cita en la agenda. Te paso con recepcion para que lo resuelva contigo ahora mismo.';
  return [{ json: { ...item,
    respuesta: aviso,
    reservaVerificada: false,
    verificacionFallo: true,
    agendarFallo: true,
    transferir: true,
    motivoTransferencia: 'agendar_cita corrio y NO devolvio ninguna cita (la herramienta fallo; devolvio: '
      + String(item.observacionAgendar || 'vacia').slice(0, 160)
      + '); la cita NO quedo registrada y el cliente recibio el aviso de que no se pudo confirmar',
  }, pairedItem: { item: 0 } }];
}

// --- LA LISTA DE GOOGLE TARDA EN VER LO RECIEN CREADO (2026-09-20) ----------
// `agendar_cita` creo la cita y Google la devolvio con su id, su calendario y
// su horario. Segundos despues, `events.list` sobre ESE mismo calendario no la
// trajo: la lista es de consistencia eventual y la cita recien nacida puede no
// estar todavia. Resultado: la reserva quedaba SIN verificar, y con seña activa
// eso apaga el QR, asi que el cliente recibia «te llega el QR» y no le llegaba
// nada (Silvana, 00:56 del 20/09).
//
// La respuesta de la herramienta ES un hecho de Google, no algo que dijo el
// modelo: vale como prueba de que la cita existe. Se agrega a `todos` lo que
// la lista todavia no trajo, con la forma de un evento, para que valga igual
// para verificar Y para detectar cruces. Si la lista SI la trajo, no se
// duplica: manda lo que vino del calendario.
for (const e of (Array.isArray(item.eventosCreados) ? item.eventosCreados : [])) {
  const id = String((e && e.id) || '');
  if (!id || todos.some((t) => String(t.id) === id)) continue;
  if (!e.inicio || !e.fin || !e.calendario) continue;
  todos.push({
    id,
    summary: String(e.titulo || ''),
    start: { dateTime: String(e.inicio) },
    end: { dateTime: String(e.fin) },
    organizer: { email: String(e.calendario) },
    // La marca de Google si vino en la respuesta de la herramienta (27/09); si
    // no, AHORA, que es cuando se creo. Con marcas iguales el desempate es por
    // id, asi que el candado sigue siendo determinista.
    created: (e.creado && Number.isFinite(Date.parse(e.creado))) ? String(e.creado) : new Date(ahora).toISOString(),
    deLaHerramienta: true,
  });
}

// --- LA CITA DE ESTA CONVERSACION, NO LA DE OTRO PACIENTE (2026-09-20) -----
// Prueba real con dos telefonos: Silvana agendo el jueves 16:00 y, UN MINUTO
// despues, Andres agendo el lunes 15:00 en la MISMA agenda. `recien` junta todo
// lo creado en los ultimos cinco minutos en esa agenda, sea de quien sea, y se
// tomaba `recien[0]` como la cita de esta conversacion: la seña de Andres quedo
// atada a la cita de Silvana. Si el pagaba, se confirmaba la de ella y la suya
// quedaba «pendiente de seña» hasta que el barrido la borrara, con el pago
// hecho. Ahora se elige la cita que agendar_cita DIJO haber creado en ESTE
// turno (`idsCreados`); `recien[0]` queda solo como respaldo para cuando esos
// pasos no vienen, que es como funcionaba antes.
//
// Y SI EL MODELO SOLO LO DIJO (revision de seguridad de 98796fd): con los pasos
// del agente a la vista y agendar_cita sin ejecutar, este turno no creo nada.
// Lo que haya en la ventana es de OTROS —recepcion cargando hermanos a mano,
// otro paciente—: no es propio, no se juzga, no se borra y no se nombra. Pasa
// por la red de siempre de «dijo que agendo y no agendo».
// `agendarEjecutado === false` explicito (lo manda `Procesar respuesta`) es el
// mismo hecho aunque los pasos no vinieran: n8n dice que la herramienta no corrio.
const soloLoDijo = item.agendarEjecutado === false
  || (item.pasosDelAgente === true && item.agendarEjecutado !== true);
// Los ids del turno sirven de ancla solo si TODAS las llamadas a agendar_cita
// trajeron el suyo. Si una no lo trajo, esa cita no se puede identificar y se
// vuelve a la ventana de cinco minutos (respaldo), con aviso a recepcion.
const idsCompletos = idsCreados.size > 0 && !(Number(item.agendarPasosSinId) > 0);
const respaldo = !soloLoDijo && !idsCompletos;
const propia = (lista) => (soloLoDijo ? undefined : (lista.find((e) => idsCreados.has(String(e.id)))
  || (idsCreados.size === 0 ? lista[0] : undefined)));

const recien = todos.filter(e => {
  if (idsCreados.has(String(e.id))) return true;
  const c = Date.parse(e.created || e.updated || '');
  return Number.isFinite(c) && (ahora - c) >= 0 && (ahora - c) < VENTANA_MS;
});

// --- SIN IDS FIABLES, NO SE BORRA NADA (Andres, 27/09/2026) -----------------
// agendar_cita corrio pero no se sabe que cita creo: una observacion sin id, o
// la herramienta figura como ejecutada sin los pasos del agente. Borrar «la
// mas nueva de la ventana» podia llevarse la cita de otro paciente. Decision
// de Andres: en ese caso el candado NO borra ninguna cita, no nombra citas
// ajenas, no le confirma nada al paciente —recepcion confirma el horario, con
// el boton: solo se ofrece lo que se cumple— y pasa a recepcion con el motivo.
// Con los ids completos todo sigue igual: se deshace la del turno que choca.
// Y cuando el llamador no dice si agendar_cita corrio (`agendarEjecutado`
// ausente), tambien (revision de f962cef): el respaldo que juzgaba toda la
// ventana no se reabre con otro llamador.
const sinIdsFiables = !soloLoDijo && (Number(item.agendarPasosSinId) > 0
  || (item.agendarEjecutado === true && idsCreados.size === 0)
  || item.agendarEjecutado === undefined);
const usarUsted = /\busted\b/i.test(String(cfgCampo('tratamiento') || ''));
const DIAS_LP = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const diaHora = (iso) => {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return '';
  const d = new Date(t - 4 * 3600000);
  return `${DIAS_LP[d.getUTCDay()]} ${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
// Lo unico que se le dice al paciente cuando el candado no puede asegurar nada:
// no se confirma; recepcion revisa y confirma (aviso y boton).
const NO_SE_CONFIRMA = usarUsted
  ? 'Todavía no le puedo confirmar la cita: recepción revisa la agenda y le confirma el horario por este chat.'
  : 'Todavía no te puedo confirmar la cita: recepción revisa la agenda y te confirma el horario por este chat.';
const motivoSinIds = () => {
  const horarios = Array.from(new Set([
    ...(Array.isArray(item.agendarInicios) ? item.agendarInicios : []),
    ...(Array.isArray(item.eventosCreados) ? item.eventosCreados.map((e) => e && e.inicio) : []),
  ].map(diaHora).filter(Boolean)));
  return 'posible cruce: agendar_cita no devolvió el id; revisar la agenda de '
    + (horarios.length ? horarios.join(' y ') : 'la cita que se intentó agendar en este turno')
    + '. No se borró ninguna cita ajena y al cliente no se le confirmó nada: confirmarle el horario';
};

// Instante de inicio y fin de un evento. Los de dia completo (`start.date`) se
// dejan afuera a proposito: suelen ser notas del negocio -- "feriado", "cerrado
// por inventario" -- y tomarlos como ocupacion bloquearia el dia entero.
const rango = (e) => {
  const i = Date.parse(e?.start?.dateTime || '');
  const f = Date.parse(e?.end?.dateTime || '');
  return Number.isFinite(i) && Number.isFinite(f) ? { i, f } : null;
};
// Media abierta: una cita de 9 a 10 y otra de 10 a 11 NO se superponen.
const seSuperponen = (a, b) => a.i < b.f && b.i < a.f;
const creado = (e) => Date.parse(e.created || e.updated || '') || 0;

// --- EL HORARIO DE ATENCION, POR CODIGO (2026-09-20) ------------------------
// QUE PASO. El modelo agendo una consulta un DOMINGO, con la clinica cerrada.
// El horario estaba bien cargado en la consola y le llegaba al prompt como
// frase -- «lunes a viernes, de 09:00 a 19:00; sabado, de 09:00 a 13:00;
// domingo: cerrado» --, pero eso es una instruccion, no una barrera, y ya
// sabemos como termina (CLAUDE.md). En el codigo no habia NADA que lo
// impidiera: `consultar_disponibilidad` devuelve lo OCUPADO, y un domingo
// vacio le contesta «libre»; el candado de abajo solo mira superposiciones, y
// un dia cerrado no se superpone con nada.
//
// Desde aca la cita creada se comprueba contra el horario de LA PERSONA que la
// atiende. Si cae fuera, se deshace por la MISMA via que un cruce -- que ya
// borra la cita y le da al modelo un turno para ofrecer alternativas --, asi
// que no cuesta ningun mensaje nuevo.
//
// FALLA ABIERTA CUANDO NO HAY DATO: sin horario cargado, o ilegible, no se
// deshace nada. Al reves que el candado de solapes, y a proposito: alla el dato
// es firme -- dos citas que existen en la agenda -- y aca borrar por una
// configuracion incompleta seria cancelarle al cliente una cita buena.
//
// LA ZONA ES FIJA, UTC-4 (CLAUDE.md): se resta el desfase y se lee en UTC, en
// vez de depender de la base de zonas horarias de la imagen de n8n.
const DIA_CORTO = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
const MIN_LA_PAZ = 4 * 60;
const enLaPaz = (iso) => {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  const d = new Date(t - MIN_LA_PAZ * 60 * 1000);
  return { dia: DIA_CORTO[d.getUTCDay()], min: d.getUTCHours() * 60 + d.getUTCMinutes() };
};
const aMinutos = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h <= 24 && mi < 60 ? h * 60 + mi : null;
};
// Un dia trae «09:00-19:00», «cerrado», o varios tramos separados por coma
// («09:00-12:00, 14:00-19:00»): el corte del mediodia es comun en Bolivia.
// `null` significa NO SE PUEDE JUZGAR; lista vacia significa cerrado.
const tramosDelDia = (horario, dia) => {
  const v = horario && typeof horario === 'object' ? horario[dia] : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t === '') return null;
  if (/^cerrad[oa]s?$/i.test(t)) return [];
  const tramos = [];
  for (const parte of t.split(/[,;]/)) {
    const m = /^(\d{1,2}:\d{2})\s*[-\u2013a]\s*(\d{1,2}:\d{2})$/.exec(parte.trim());
    if (!m) continue;
    const i = aMinutos(m[1]);
    const f = aMinutos(m[2]);
    if (i !== null && f !== null && f > i) tramos.push({ i, f });
  }
  return tramos.length ? tramos : null;
};
// '' si la cita entra; 'cerrado' o 'fuera' si no. La cita ENTERA tiene que
// caber en UN tramo: una consulta de 12:30 a 13:30 un sabado que cierra a las
// 13:00 no entra. Terminar justo en el cierre si entra (media abierta).
const fueraDeHorario = (inicioIso, finIso, horario) => {
  const a = enLaPaz(inicioIso);
  const b = enLaPaz(finIso);
  if (!a || !b) return '';
  const tramos = tramosDelDia(horario, a.dia);
  if (tramos === null) return '';
  if (tramos.length === 0) return 'cerrado';
  // Una cita que cruza la medianoche no cabe en ningun tramo del dia.
  const finMin = b.dia === a.dia ? b.min : 24 * 60 + 1;
  return tramos.some((t) => a.min >= t.i && finMin <= t.f) ? '' : 'fuera';
};

// El equipo, que hace falta para DOS cosas: el horario de cada persona (aca) y
// su nombre para el reintento (mas abajo). Se lee una sola vez.
let equipo = [];
try { equipo = JSON.parse(cfgCampo('funcionarios') || '[]'); } catch (err) { equipo = []; }
const delCalendario = (calendario) => (Array.isArray(equipo)
  ? equipo.find((x) => x && x.calendario === calendario) : null) || null;

// --- CANDADO ---------------------------------------------------------------
// Quien se queda con el horario: la cita creada ANTES.
//
// EL DESEMPATE NO ES UN DETALLE, es lo que hacia que el candado no sirviera.
// La primera version exigia que la otra cita fuera ESTRICTAMENTE anterior. El
// 2026-09-06, en la ejecucion #1076, el agente agendo tres citas en un mismo
// mensaje y las dos que chocaban quedaron con el MISMO `created`
// -- 00:20:52 las dos, porque Google guarda ese campo con resolucion de
// segundos --. Ninguna era anterior a la otra, ninguna cedio, y las dos
// sobrevivieron: un funcionario con dos citas de 9 a 10, que es justo lo que
// esto tenia que impedir.
//
// Ahora, con marcas iguales, desempata el identificador. Cualquier criterio
// sirve mientras sea DETERMINISTA: lo que no puede pasar es que las dos se
// crean con derecho al horario, ni que las dos cedan y el negocio se quede sin
// ninguna.
const ganaPrioridad = (a, b) => {
  const ca = creado(a);
  const cb = creado(b);
  if (ca !== cb) return ca < cb;
  return String(a.id) < String(b.id);
};

// UN BLOQUE FIJO NO ES UNA CITA (Andres, 24/09/2026). El calendario del
// consultorio tiene un evento REPETIDO todos los dias de 13:00 a 14:00 --el
// almuerzo-- y hasta hoy el candado lo trataba como «otra cita»: si el modelo
// agendaba a las 13:30, la cita se deshacia y al paciente se le decia que «ese
// horario ya estaba ocupado con la misma persona». Deshacerla esta BIEN; la
// explicacion era falsa, y ademas confundia dos cosas distintas en los avisos
// y en las metricas: un choque con otro paciente es un problema de agenda, un
// choque con el almuerzo es una restriccion del negocio.
//
// COMO SE RECONOCE, y el primero es exacto y no una heuristica: Google marca
// cada instancia de una serie con `recurringEventId`, y `agendar_cita` NUNCA
// crea eventos repetidos. Un repetido en una agenda de reservas es, siempre,
// un bloqueo que puso el negocio. La segunda via es para el bloqueo cargado a
// mano dia por dia, sin repeticion, que se reconoce por como lo escriben.
const esBloqueoFijo = (e) => {
  if (!e) return false;
  if (e.recurringEventId) return true;
  return /\b(bloq|almuerzo|no atender|sin citas?|feriado|vacacion|vacación|receso|reuni[oó]n)/i
    .test(String(e.summary || ''));
};

// Una cita se deshace por DOS causas, y se anota cual: el cruce con otra cita
// (lo de siempre) y el horario en el que el negocio no atiende (2026-09-20).
// La causa cambia lo que se le dice al cliente: «ya estaba ocupado» cuando en
// realidad la clinica estaba cerrada es una explicacion falsa.
const ceden = [];
const causaDe = {};
// SIN NOMBRE (Andres, 27/09/2026): hora elegida, pero el nombre del titulo no
// es uno que el cliente haya dicho. Misma via, otra pregunta: solo el nombre.
const sinNombre = new Set((Array.isArray(item.agendaSinNombre) ? item.agendaSinNombre : [])
  .map((id) => String(id || '')).filter(Boolean));
const sinConfirmar = new Set((Array.isArray(item.agendaSinConfirmar) ? item.agendaSinConfirmar : [])
  .map((id) => String(id || '')).filter(Boolean));
// SE JUZGA SOLO LO QUE CREO ESTE TURNO, cuando se sabe que fue (27/09/2026).
// El negocio carga citas a mano —cada 15 minutos, y a veces dos a la misma
// hora, hermanos—, y `recien` junta todo lo creado en cinco minutos en esa
// agenda: sin esto, dos citas manuales a la misma hora cargadas hace un
// minuto se tomaban por un cruce y el candado borraba una. Si la herramienta
// devolvio sus ids, se juzgan esos (contra TODO lo que hay en la agenda, que
// es lo que protege); si no, la ventana de siempre.
// SIN IDS FIABLES (Andres, 27/09/2026, y revision de f0c6957): se juzgan SOLO
// las citas con id conocido del turno —esas si se deshacen por cruce, pasado,
// grilla…—; ninguna otra de la ventana se toca.
const delTurno = recien.filter((e) => idsCreados.has(String(e.id)));
const aJuzgar = soloLoDijo ? [] : ((idsCompletos || sinIdsFiables) ? delTurno : recien);
// DOBLE RESERVA SIMULTANEA (revision de f0c6957): la cita del turno gana el
// desempate, pero la pisa otra MAS NUEVA, ajena y de la ventana (la lista de
// Google atrasada, o dos conversaciones a la vez). No se borra ninguna: lo
// resuelve recepcion.
const simultaneas = [];
for (const nueva of aJuzgar) {
  const r = rango(nueva);
  const calendario = nueva.organizer && nueva.organizer.email;
  if (!r || !calendario) continue;

  // --- UNA CITA EN EL PASADO NO ES UNA CITA (24/09/2026, ejecucion #5563 de
  // Bellido). El modelo llamo a agendar_cita con `2025-09-25T15:30` --un año
  // atras-- y Google creo el evento sin chistar: la paciente leyo «quedo
  // agendada para mañana» y en la agenda de mañana no habia nada. Ni el cruce
  // ni el horario lo ven: un jueves de 2025 a las 15:30 cae dentro del horario
  // y no choca con nadie. Se deshace por la MISMA via que un cruce --se borra y
  // el reintento le dice al modelo que la fecha ya paso, con la de hoy-- y no
  // cuesta un mensaje mas. Y el modelo no se entera del error de la
  // herramienta aunque se lo lanzaramos: en esta version de n8n una
  // herramienta que falla le devuelve una observacion VACIA (#5553), asi que
  // rechazar la fecha en la herramienta no sirve; el hecho se corrige aca.
  //
  // SOLO PARA LA CITA QUE agendar_cita DEVOLVIO EN ESTE TURNO (`idsCreados`).
  // La ventana de cinco minutos tambien trae lo que recepcion cargo a mano
  // hace un momento, y una cita de las 15:00 anotada a las 15:10 es de un
  // paciente que ya esta en la sala, no un error.
  if (idsCreados.has(String(nueva.id)) && r.i < ahora) {
    ceden.push(nueva);
    causaDe[String(nueva.id)] = 'pasado';
    continue;
  }

  const choque = todos.find((otro) => {
    if (otro.id === nueva.id) return false;
    if (!otro.organizer || otro.organizer.email !== calendario) return false;
    const ro = rango(otro);
    return ro && seSuperponen(r, ro) && ganaPrioridad(otro, nueva);
  });

  if (choque) {
    ceden.push(nueva);
    causaDe[String(nueva.id)] = esBloqueoFijo(choque) ? 'bloqueado' : 'cruce';
    continue;
  }
  const pisadaPor = todos.find((otro) => {
    if (otro.id === nueva.id || idsCreados.has(String(otro.id)) || esBloqueoFijo(otro)) return false;
    if (!otro.organizer || otro.organizer.email !== calendario) return false;
    if (!recien.some((x) => x.id === otro.id)) return false;
    const ro = rango(otro);
    return ro && seSuperponen(r, ro);
  });

  const quien = delCalendario(calendario);
  const mal = quien ? fueraDeHorario(nueva.start && nueva.start.dateTime,
    nueva.end && nueva.end.dateTime, quien.horario) : '';
  if (mal) { ceden.push(nueva); causaDe[String(nueva.id)] = mal; continue; }

  // --- LA GRILLA DEL CHAT: EN PUNTO O Y MEDIA (27/09/2026) -------------------
  // Pedido del doctor de un consultorio, para todos: el negocio carga a mano
  // citas cada 15 minutos, pero por el chat solo se agenda a las :00 o :30.
  // Una cita que agendar_cita creo a las 16:45 se deshace por la misma via,
  // despues del cruce (si ademas choca, se le dice eso). SOLO la que creo este
  // turno: una cita de las 16:15 que recepcion cargo hace un minuto es del
  // negocio, no un error del chat.
  const GRILLA_MIN = 30;
  const alInicio = enLaPaz(nueva.start && nueva.start.dateTime);
  if (idsCreados.has(String(nueva.id)) && alInicio && alInicio.min % GRILLA_MIN !== 0) {
    ceden.push(nueva);
    causaDe[String(nueva.id)] = 'fuera_de_grilla';
    continue;
  }

  // --- SIN CONFIRMACION NO HAY CITA (27/09/2026, ejecucion #6555) -----------
  // El paciente pregunto «A las 17 no tiene?» y el turno consulto y AGENDO las
  // 17:00: nadie lo habia confirmado. `Procesar respuesta` decide, por lo que
  // el paciente ESCRIBIO y no por lo que el modelo dijo, que citas de este
  // turno no tienen confirmacion; aca se deshacen por la MISMA via que un
  // cruce, y el paciente recibe la pregunta («Si, a las 17:00 hay espacio.
  // ¿Te la agendo?»). Va DESPUES del cruce y del horario a proposito: si la
  // hora estaba ocupada o cerrada, lo que hay que decirle es eso, no que hay
  // espacio. Solo las citas que agendar_cita devolvio en ESTE turno.
  if (idsCreados.has(String(nueva.id)) && sinConfirmar.has(String(nueva.id))) {
    ceden.push(nueva);
    causaDe[String(nueva.id)] = 'sin_confirmar';
  } else if (idsCreados.has(String(nueva.id)) && sinNombre.has(String(nueva.id))) {
    ceden.push(nueva);
    causaDe[String(nueva.id)] = 'sin_nombre';
  } else if (pisadaPor && idsCreados.has(String(nueva.id))) {
    simultaneas.push({ nueva, otro: pisadaPor });
  }
}

if (ceden.length) {
  // Las que NO ceden siguen siendo citas validas. Importa para el cobro: si el
  // cliente pidio tres y solo una choco, hubo cierre igual.
  // Las que sobreviven son de ESTE turno: una cita manual reciente no es «el
  // resto de lo que agendamos» (27/09/2026).
  // Y SOLO las que el turno creo con id (revision de f0c6957, caso C4): en el
  // respaldo, una cita de otro paciente no puede quedar «agendada» ni contar
  // como cierre.
  const sobreviven = aJuzgar.filter((e) => idsCreados.has(String(e.id)) && !ceden.some((c) => c.id === e.id));

  // Nombre y hora de cada cita caida, para poder decirle al cliente CUAL fue.
  // Un "hubo un cruce" a secas, cuando se agendaron tres, no le dice a quien
  // tiene que volver a llamar.
  // El NOMBRE solo de una cita de ESTE turno (revision de 98796fd): en el
  // respaldo la que cae puede ser de otro paciente, y su nombre no se revela.
  const describir = (e) => {
    const quien = idsCreados.has(String(e.id))
      ? String(e.summary || '').replace(/^.*?Cita\s+/i, '').split('—')[0].trim() : '';
    let hora = '';
    try {
      hora = new Date(e.start.dateTime).toLocaleTimeString('es-BO', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz',
      });
    } catch (err) { hora = ''; }
    return quien && hora ? `${quien} a las ${hora}` : (quien || (hora ? `las ${hora}` : 'una de las citas'));
  };
  const caidas = ceden.map(describir).join(' y ');

  // POR QUE NO QUEDO. El texto configurado por el comercio, si lo hay, manda;
  // si no, se arma con la causa REAL. Decirle «ya estaba ocupado» a quien pidio
  // un domingo con la clinica cerrada es explicarle algo que no paso.
  const causas = new Set(ceden.map((e) => causaDe[String(e.id)] || 'cruce'));
  const porQue = causas.has('pasado')
    ? 'la fecha de esa cita ya paso'
    : causas.has('cruce')
    ? 'ese horario ya estaba ocupado con la misma persona'
    : (causas.size === 1 && causas.has('cerrado')
      ? 'ese dia no atendemos'
      // La grilla, cuando esta, antes que cualquier otra causa de horario
      // (revision de 98796fd): con causas mezcladas decia «fuera de horario».
      : (causas.has('fuera_de_grilla')
        ? 'por este chat las citas son en punto o y media'
        : (causas.size === 1 && causas.has('bloqueado')
          ? 'ese horario esta reservado en la agenda'
          : 'ese horario esta fuera de nuestro horario de atencion')));
  // «El resto de lo que agendamos si esta bien» SOLO si de verdad quedo alguna:
  // cuando el cliente pidio una sola cita y esa es la que cayo, esa frase le
  // dice que algo quedo cuando no quedo nada (2026-09-20).
  const configurado = String(cfgCampo('mensajeReservaNoConfirmada') || '').trim();
  // SIN CONFIRMAR NO ES UN ERROR DE AGENDA (27/09/2026): la hora esta libre y
  // dentro del horario --el cruce y el horario se miraron antes--, solo falta
  // que el paciente diga que si. El texto no es una disculpa ni el aviso del
  // comercio: es la pregunta. El dia de la semana lo pone el codigo.
  // «Solo falta el cliente»: toda cita que cede es sin confirmar o sin nombre.
  const soloSinConfirmar = [...causas].every((c) => c === 'sin_confirmar' || c === 'sin_nombre');
  const todasSinNombre = [...causas].every((c) => c === 'sin_nombre');
  const usted = /\busted\b/i.test(String(cfgCampo('tratamiento') || ''));
  const cuandoEs = (e) => {
    const p = enLaPaz(e.start && e.start.dateTime);
    if (!p) return '';
    const d = new Date(Date.parse(e.start.dateTime) - MIN_LA_PAZ * 60 * 1000);
    const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    return `el ${dias[d.getUTCDay()]} ${d.getUTCDate()} a las ${String(Math.floor(p.min / 60)).padStart(2, '0')}:${String(p.min % 60).padStart(2, '0')}`;
  };
  const sinConf = ceden.filter((e) => causaDe[String(e.id)] === 'sin_confirmar');
  const sinNom = ceden.filter((e) => causaDe[String(e.id)] === 'sin_nombre');
  // La hora sin «el»: «las 17:00 del lunes 28».
  const horaDel = (e) => cuandoEs(e).replace(/^el (\S+ \d+) a (las \d{2}:\d{2})$/, '$2 del $1');
  // Dijo «si» ante VARIAS opciones: se le pregunta cual (Andres, 27/09/2026).
  const opciones = item.opcionesSinElegir && typeof item.opcionesSinElegir === 'object'
    && item.opcionesSinElegir.horas ? item.opcionesSinElegir : null;
  // Al SEGUNDO sin nombre seguido el mensaje es SOLO el paso a recepcion: no se
  // junta con un «¿Te la agendo?» (revision de f0c6957).
  const aRecepcionPorNombre = item.sinNombreRepetido === true && sinNom.length > 0;
  const preguntaSinConfirmar = aRecepcionPorNombre
    ? (usted ? 'No logro dejar la reserva a su nombre por este chat: le paso con recepción para terminarla.'
      : 'No logro dejar la reserva a tu nombre por este chat: te paso con recepción para terminarla.')
    : [
    sinConf.length ? (opciones
      ? `¿Cuál de estas horas del ${opciones.dia} ${usted ? 'prefiere' : 'prefieres'}: ${opciones.horas}?`
      : 'Sí, ' + sinConf.map(cuandoEs).filter(Boolean).join(' y ') + ' hay espacio. '
        + (sinConf.length > 1 ? (usted ? '¿Se las agendo?' : '¿Te las agendo?') : (usted ? '¿Se la agendo?' : '¿Te la agendo?'))) : '',
    // Falta solo el nombre: no se repiten horarios, se pide el nombre.
    // Al SEGUNDO sin nombre seguido no se pregunta otra vez: pasa a recepcion.
    sinNom.length ? 'Para reservar ' + sinNom.map(horaDel).filter(Boolean).join(' y ')
      + (sinNom.length > 1 ? ', ¿a nombre de quién las agendo?' : ', ¿a nombre de quién la agendo?') : '',
  ].filter(Boolean).join(' ');
  // SI EN EL MISMO TURNO SE CANCELO LA VIEJA (revision de seguridad del PR
  // #244): cancelar la cita anterior y agendar la nueva sin confirmar deja al
  // paciente SIN cita. Se le dice antes de la pregunta, con la descripcion que
  // trae `Procesar respuesta`; callarlo es dejarlo creyendo que la vieja sigue.
  const canceladas = Array.isArray(item.canceladasEnElTurno) ? item.canceladasEnElTurno : [];
  const avisoCanceladas = canceladas.map((c) => {
    const desc = String((c && c.desc) || '').trim();
    return usted
      ? `Su cita${desc ? ' ' + desc : ' anterior'} quedó cancelada.`
      : `Tu cita${desc ? ' ' + desc : ' anterior'} quedó cancelada.`;
  }).join(' ');
  // Sin ids fiables, o con una doble reserva simultanea, no se confirma nada.
  const aviso = (sinIdsFiables || simultaneas.length) ? NO_SE_CONFIRMA
    : soloSinConfirmar
    ? (avisoCanceladas ? avisoCanceladas + ' ' : '')
      + (sobreviven.length > 0 ? `La cita de ${sobreviven.map(describir).join(' y ')} quedó agendada. ` : '') + preguntaSinConfirmar
    : (configurado
    || `Disculpa, tengo que corregirte algo: la cita de ${caidas} no quedo, `
     + `porque ${porQue}. `
     + (sobreviven.length > 0 ? 'El resto de lo que agendamos si esta bien. ' : '')
     + 'Le paso este pedido a recepcion para darte otro horario enseguida.');

  // QUIEN Y CUANDO, para el reintento (2026-09-17). Cuando la cita nueva cede,
  // el flujo ya no manda el texto fijo de una: le da al modelo UN turno mas
  // (`Reintento tras cruce`) para ofrecer alternativas, y ese turno necesita
  // saber que horario y que persona chocaron. La persona sale del calendario
  // donde vivia la cita, cruzado con `funcionarios` de la configuracion: es el
  // dato firme; el titulo de la cita solo trae el nombre del cliente.
  const personaDe = (calendario) => {
    const f = delCalendario(calendario);
    return f && f.nombre ? String(f.nombre) : '';
  };
  const citasCaidas = ceden.map((e) => {
    const causa = causaDe[String(e.id)] || 'cruce';
    let hora = '';
    let fecha = '';
    let anio = '';
    try {
      const d = new Date(e.start.dateTime);
      hora = d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' });
      // Una cita caida POR LA FECHA se describe con el año y SIN el dia de la
      // semana: «jueves 25» era el dia del 25 de 2025, y repetirselo al modelo
      // es invitarlo a escribir «jueves» por un viernes. Para las otras causas,
      // la forma de siempre.
      fecha = causa === 'pasado'
        ? d.toLocaleDateString('es-BO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/La_Paz' })
        : d.toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/La_Paz' });
      anio = d.toLocaleDateString('es-BO', { year: 'numeric', timeZone: 'America/La_Paz' });
    } catch (err) { hora = ''; fecha = ''; anio = ''; }
    const servicio = String(e.summary || '').split('—')[1];
    return { hora, fecha, anio, persona: personaDe(e.organizer.email), servicio: servicio ? servicio.trim() : '',
      inicio: e.start.dateTime || '', causa };
  });

  // LA TRANSFERENCIA YA NO SE DECIDE ACA. Antes el primer item salia con
  // `transferir: true` y la rama directa a `¿Transferir a humano?` avisaba a
  // recepcion siempre. Ahora el motivo viaja en `motivoCruce` y deciden
  // `Retomar respuesta` y `Procesar reintento`: si el modelo logro ofrecer
  // alternativas, el cliente no esta esperando a nadie y el aviso seria un
  // mensaje pagado que dice algo falso («necesita atencion humana»); si el
  // reintento no sale, ahi si va el aviso, con este mismo motivo.
  //
  // Un item por cita a deshacer: el nodo de Calendar borra uno por item.
  const motivoCruce = (todasSinNombre
    ? 'se agendo SIN EL NOMBRE que dijo el cliente (el titulo lleva un nombre que el cliente no escribio, o ninguno) '
    : soloSinConfirmar
    ? 'se agendo SIN QUE EL CLIENTE CONFIRMARA ese horario (su mensaje era una pregunta o no nombraba esa hora) '
    : causas.has('pasado')
    ? 'se intento agendar en una FECHA YA PASADA (el modelo uso un año anterior al de hoy) '
    : causas.has('cruce')
    ? 'se intento agendar sobre un horario YA OCUPADO de la misma persona '
    : (causas.has('fuera_de_grilla')
      ? 'se intento agendar FUERA DE LA GRILLA del chat (solo en punto o y media) '
      : (causas.size === 1 && causas.has('bloqueado')
        ? 'se intento agendar sobre un BLOQUEO de la agenda (un horario que el negocio no abre a citas) '
        : 'se intento agendar FUERA DEL HORARIO DE ATENCION de esa persona ')))
    + `(${ceden.map((c) => c.summary || 'sin titulo').join('; ')}); la cita nueva se deshizo`;
  // Las que el candado deshace dejan de ser evidencia de una cita existente.
  try {
    const sd = $getWorkflowStaticData('global');
    const reg = sd.agendaPorTelefono && sd.agendaPorTelefono[String(item.from || '')];
    if (reg && reg.creadas) for (const e of ceden) delete reg.creadas[String(e.id)];
  } catch (err) { /* sin datos estaticos */ }
  return ceden.map((e) => ({ json: { ...item,
    respuesta: aviso,
    reservaVerificada: sobreviven.length > 0,
    eventoId: sobreviven.length > 0 ? (propia(sobreviven) || {}).id : undefined,
    citaSolapada: true,
    eventoABorrar: e.id,
    calendarioDelBorrado: e.organizer.email,
    citasCaidas,
    // UN SOLO AVISO A RECEPCION POR TURNO (revision de f0c6957): los items que
    // ceden no transfieren desde aca —serian un aviso por item—; el motivo viaja
    // en `avisoDelTurno` y lo manda el final del camino (`Retomar respuesta` o
    // `Procesar reintento`), una vez.
    transferir: false,
    motivoTransferencia: '',
    ...(sinIdsFiables ? { sinIdsFiables: true } : {}),
    ...(simultaneas.length ? { dobleReservaSimultanea: true } : {}),
    avisoDelTurno: [
      sinIdsFiables ? motivoSinIds() : '',
      respaldo && !sinIdsFiables ? 'el candado no supo con certeza que cita creo este turno y deshizo la mas nueva de la agenda '
        + `(${ceden.map((c) => c.summary || 'sin titulo').join('; ')}): revisar que no se haya borrado la cita de otro paciente` : '',
      simultaneas.length ? motivoSimultanea() : '',
      aRecepcionPorNombre ? 'el cliente eligió la hora pero dos veces seguidas la cita quedó sin un nombre que él haya dicho: '
        + 'terminar la reserva con él por este chat' : '',
    ].filter(Boolean).join('; '),
    motivoCruce,
    causaDeLaCaida: todasSinNombre ? 'sin_nombre' : soloSinConfirmar ? 'sin_confirmar'
      : (causas.has('pasado') ? 'pasado' : (causas.has('cruce') ? 'cruce'
        : (causas.has('fuera_de_grilla') ? 'fuera_de_grilla' : 'horario'))),
  }, pairedItem: { item: 0 } }));
}

// SIN IDS FIABLES o DOBLE RESERVA SIMULTANEA, y nada del turno cedio: no se
// borra ninguna cita, no se confirma nada y pasa a recepcion, con el boton.
if (sinIdsFiables || simultaneas.length) {
  return [{ json: { ...item,
    respuesta: NO_SE_CONFIRMA,
    reservaVerificada: false,
    eventoId: undefined,
    ...(sinIdsFiables ? { sinIdsFiables: true } : {}),
    ...(simultaneas.length ? { dobleReservaSimultanea: true } : {}),
    transferir: true,
    motivoTransferencia: [sinIdsFiables ? motivoSinIds() : '', simultaneas.length ? motivoSimultanea() : '']
      .filter(Boolean).join('; '),
  }, pairedItem: { item: 0 } }];
}

function motivoSimultanea() {
  return 'posible doble reserva simultánea: la cita de este turno ('
    + simultaneas.map((x) => diaHora(x.nueva.start && x.nueva.start.dateTime)).join(' y ')
    + ') se superpone con otra creada después en la misma agenda; no se borró ninguna: revisar cuál queda y avisar al otro paciente';
}

function cfgCampo(nombre) {
  try { return $('Config del negocio').first().json[nombre]; }
  catch (e) { return ''; }
}

// Duplicado por titulo Y HORA: la cita existe, al cliente se le confirma igual
// -- negarlo seria mentirle -- pero recepcion tiene que borrar la sobrante.
//
// POR TITULO SOLO ERA UN FALSO POSITIVO (26/09/2026, ejecucion #6072 del Demo
// A): el mismo cliente agendo un corte a las 10:00 y otro a las 14:00 dentro
// de cinco minutos, con el mismo titulo «Cita <nombre> — corte», y salio el
// aviso «citas DUPLICADAS» con el boton para el cliente. Una madre que agenda
// dos hijos, o dos servicios iguales en horas distintas, no es un duplicado.
// Duplicado es la MISMA cita dos veces: mismo titulo y misma hora de inicio
// (en la misma agenda ya lo resuelve el candado de solapes de arriba; aca
// queda el caso de dos agendas distintas, o de dos creadas en el mismo
// segundo que el candado dejo pasar).
const porTituloYHora = {};
const creadasPorClave = new Set();
for (const e of recien) {
  if (idsCreados.has(String(e.id))) creadasPorClave.add((e.summary || '') + '|' + String((e.start && e.start.dateTime) || ''));
  const clave = (e.summary || '') + '|' + String((e.start && e.start.dateTime) || '');
  porTituloYHora[clave] = (porTituloYHora[clave] || 0) + 1;
}
// Con los ids de este turno a la vista, un duplicado tiene que incluir una
// cita de ESTE turno: dos manuales iguales de recepcion no son del chat.
// Y si el modelo solo lo dijo, este turno no creo nada que pueda estar repetido.
const repetidos = soloLoDijo ? [] : Object.entries(porTituloYHora)
  .filter(([clave, n]) => n > 1 && (idsCreados.size === 0 || creadasPorClave.has(clave)))
  .map(([clave, n]) => [clave.split('|')[0], n]);

if (repetidos.length) {
  // El evento queda igual (bloque 2): con seña activa el QR se manda para la
  // cita que sobrevive; recepcion borra las repetidas con el aviso de abajo.
  return [{ json: { ...item, reservaVerificada: true, eventoId: (propia(recien) || recien[0]).id, duplicados: repetidos.length,
    transferir: true,
    motivoTransferencia: `se crearon citas DUPLICADAS (${repetidos.map(([t, n]) => `${n}x ${t}`).join('; ')}), hay que borrar las sobrantes` }, pairedItem: { item: 0 } }];
}

// AVISO POR "NO VERIFICADA": DESACTIVADO. La consulta de verificacion fallaba
// siempre cuando se escribio esto; hoy si encuentra las citas (comprobado en la
// ejecucion #964), pero el aviso se deja apagado hasta tener mas evidencia de
// que no genera ruido. El registro queda en el item para poder auditarlo.
// UNA CITA SIN CONFIRMAR QUE NO SE PUEDE DESHACER (revision de seguridad del
// PR #244): si el paciente no confirmo y la cita creada no aparece para
// borrarla, puede haber quedado en la agenda sin que nadie la quiera. No se
// falla abierto en silencio: pasa a recepcion con el motivo.
const sinConfirmarNoEncontrada = () => (sinConfirmar.size > 0 || sinNombre.size > 0 ? {
  transferir: true,
  motivoTransferencia: 'agendar_cita creo una cita SIN que el cliente '
    + (sinConfirmar.size > 0 ? 'confirmara ese horario' : 'dijera a nombre de quién')
    + ' y no aparecio en el calendario para deshacerla: revisar la agenda y borrarla si quedo, y confirmar con el cliente',
} : {});
if (recien.length === 0) {
  return [{ json: { ...item, reservaVerificada: false, verificacionSinDatos: true, citaCreadaNoEncontrada,
    ...sinConfirmarNoEncontrada() }, pairedItem: { item: 0 } }];
}

// Si esta conversacion creo una cita y no aparece entre las recientes, NO se
// toma la de otro: la reserva queda sin verificar (y sin seña), que es lo que
// ya pasa cuando la verificacion no encuentra nada.
const laPropia = propia(recien);
if (!laPropia) {
  return [{ json: { ...item, reservaVerificada: false, verificacionSinDatos: true, citaCreadaNoEncontrada: !soloLoDijo,
    ...(soloLoDijo ? { soloLoDijo: true } : {}), ...sinConfirmarNoEncontrada() }, pairedItem: { item: 0 } }];
}
// EL ADELANTO A FAVOR SE APLICA A ESTA CITA (Andres, 21/09/2026), en los dos
// casos en que existe: el servidor ya lo tenia a favor (canceló una cita
// pagada en un mensaje anterior), o se cancelo una pagada EN ESTE MISMO TURNO
// --«cambia mi cita al martes»: cancela y agenda a la vez--, que es como se
// reagenda casi siempre. No sale QR (`¿Enviar QR de la seña?`), `Quitar rotulo
// (adelanto)` le saca a la cita nueva el PENDIENTE DE SEÑA, y el servidor
// recibe el hecho y decide (`adelanto_aplicado` o `reprogramada`). El texto se
// corrige si el modelo hablo de seña o de QR: pedir que pague dos veces es lo
// peor que puede pasar en este camino, y el prompt no es una barrera.
const cancelada = item.eventoSena && item.eventoSena.evento === 'cita_cancelada' ? item.eventoSena : null;
const hecho = cfgCampo('senaActiva') !== 'si' ? null
  : (cfgCampo('senaAFavor') === 'si'
    ? { evento: 'adelanto_aplicado', referencia: String(laPropia.id),
        calendario: String((laPropia.organizer && laPropia.organizer.email) || '') }
    : (cancelada
      ? { evento: 'reprogramada', referencia: String(cancelada.referencia || ''), inicio: String(cancelada.inicio || ''),
          nueva: String(laPropia.id), calendario: String((laPropia.organizer && laPropia.organizer.email) || '') }
      : null));
if (hecho) {
  const usted = /\busted\b/i.test(String(cfgCampo('tratamiento') || ''));
  const oraciones = String(item.respuesta || '').split(/(?<=[.!?:])\s+/)
    .filter((o) => !/se[ñn]a|\bQR\b|comprobante|RESERVADO por|adelanto que pag|queda a (tu|su) favor/i.test(o));
  // Sin «queda reservada»: el modelo ya lo dijo con fecha y hora (21/09/2026).
  const aplicada = usted ? 'Su adelanto de la cita anterior se aplica a esta: no paga otra seña.'
    : 'Tu adelanto de la cita anterior se aplica a esta: no pagas otra seña.';
  return [{ json: { ...item, reservaVerificada: true, eventoId: laPropia.id, citaCreadaNoEncontrada,
    respuesta: (oraciones.join(' ').trim() + '\n\n' + aplicada).trim(),
    aplicarAdelanto: true,
    // UNA CITA PAGADA CON EL ADELANTO ES UNA CITA PAGADA: sale el pin, igual
    // que cuando el comprobante cuadra (Andres, 20/09/2026). Las coordenadas
    // ya vienen en el item desde `Procesar respuesta`; sin ellas, nada.
    enviarUbicacion: item.ubicacionLat !== null && item.ubicacionLat !== undefined
      && item.ubicacionLng !== null && item.ubicacionLng !== undefined,
    calendarioDelAdelanto: String((laPropia.organizer && laPropia.organizer.email) || ''),
    tituloDelAdelanto: String(laPropia.summary || ''),
    eventoSena: hecho }, pairedItem: { item: 0 } }];
}
return [{ json: { ...item, reservaVerificada: true, eventoId: laPropia.id, citaCreadaNoEncontrada }, pairedItem: { item: 0 } }];
