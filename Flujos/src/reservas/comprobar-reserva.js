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
    // `created` no viene en la respuesta de la herramienta: se toma AHORA, que
    // es cuando se creo. Con marcas iguales el desempate es por id, asi que el
    // candado sigue siendo determinista.
    created: new Date(ahora).toISOString(),
    deLaHerramienta: true,
  });
}

const recien = todos.filter(e => {
  if (idsCreados.has(String(e.id))) return true;
  const c = Date.parse(e.created || e.updated || '');
  return Number.isFinite(c) && (ahora - c) >= 0 && (ahora - c) < VENTANA_MS;
});

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

// Una cita se deshace por DOS causas, y se anota cual: el cruce con otra cita
// (lo de siempre) y el horario en el que el negocio no atiende (2026-09-20).
// La causa cambia lo que se le dice al cliente: «ya estaba ocupado» cuando en
// realidad la clinica estaba cerrada es una explicacion falsa.
const ceden = [];
const causaDe = {};
for (const nueva of recien) {
  const r = rango(nueva);
  const calendario = nueva.organizer && nueva.organizer.email;
  if (!r || !calendario) continue;

  const choque = todos.find((otro) => {
    if (otro.id === nueva.id) return false;
    if (!otro.organizer || otro.organizer.email !== calendario) return false;
    const ro = rango(otro);
    return ro && seSuperponen(r, ro) && ganaPrioridad(otro, nueva);
  });

  if (choque) { ceden.push(nueva); causaDe[String(nueva.id)] = 'cruce'; continue; }

  const quien = delCalendario(calendario);
  const mal = quien ? fueraDeHorario(nueva.start && nueva.start.dateTime,
    nueva.end && nueva.end.dateTime, quien.horario) : '';
  if (mal) { ceden.push(nueva); causaDe[String(nueva.id)] = mal; }
}

if (ceden.length) {
  // Las que NO ceden siguen siendo citas validas. Importa para el cobro: si el
  // cliente pidio tres y solo una choco, hubo cierre igual.
  const sobreviven = recien.filter((e) => !ceden.some((c) => c.id === e.id));

  // Nombre y hora de cada cita caida, para poder decirle al cliente CUAL fue.
  // Un "hubo un cruce" a secas, cuando se agendaron tres, no le dice a quien
  // tiene que volver a llamar.
  const describir = (e) => {
    const quien = String(e.summary || '').replace(/^Cita\s+/i, '').split('—')[0].trim();
    let hora = '';
    try {
      hora = new Date(e.start.dateTime).toLocaleTimeString('es-BO', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz',
      });
    } catch (err) { hora = ''; }
    return quien && hora ? `${quien} a las ${hora}` : (quien || hora || 'una de las citas');
  };
  const caidas = ceden.map(describir).join(' y ');

  // POR QUE NO QUEDO. El texto configurado por el comercio, si lo hay, manda;
  // si no, se arma con la causa REAL. Decirle «ya estaba ocupado» a quien pidio
  // un domingo con la clinica cerrada es explicarle algo que no paso.
  const causas = new Set(ceden.map((e) => causaDe[String(e.id)] || 'cruce'));
  const porQue = causas.has('cruce')
    ? 'ese horario ya estaba ocupado con la misma persona'
    : (causas.size === 1 && causas.has('cerrado')
      ? 'ese dia no atendemos'
      : 'ese horario esta fuera de nuestro horario de atencion');
  // «El resto de lo que agendamos si esta bien» SOLO si de verdad quedo alguna:
  // cuando el cliente pidio una sola cita y esa es la que cayo, esa frase le
  // dice que algo quedo cuando no quedo nada (2026-09-20).
  const configurado = String(cfgCampo('mensajeReservaNoConfirmada') || '').trim();
  const aviso = configurado
    || `Disculpa, tengo que corregirte algo: la cita de ${caidas} no quedo, `
     + `porque ${porQue}. `
     + (sobreviven.length > 0 ? 'El resto de lo que agendamos si esta bien. ' : '')
     + 'Le paso este pedido a recepcion para darte otro horario enseguida.';

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
    let hora = '';
    let fecha = '';
    try {
      const d = new Date(e.start.dateTime);
      hora = d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' });
      fecha = d.toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/La_Paz' });
    } catch (err) { hora = ''; fecha = ''; }
    const servicio = String(e.summary || '').split('—')[1];
    return { hora, fecha, persona: personaDe(e.organizer.email), servicio: servicio ? servicio.trim() : '',
      inicio: e.start.dateTime || '', causa: causaDe[String(e.id)] || 'cruce' };
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
  const motivoCruce = (causas.has('cruce')
    ? 'se intento agendar sobre un horario YA OCUPADO de la misma persona '
    : 'se intento agendar FUERA DEL HORARIO DE ATENCION de esa persona ')
    + `(${ceden.map((c) => c.summary || 'sin titulo').join('; ')}); la cita nueva se deshizo`;
  return ceden.map((e) => ({ json: { ...item,
    respuesta: aviso,
    reservaVerificada: sobreviven.length > 0,
    eventoId: sobreviven.length > 0 ? sobreviven[0].id : undefined,
    citaSolapada: true,
    eventoABorrar: e.id,
    calendarioDelBorrado: e.organizer.email,
    citasCaidas,
    transferir: false,
    motivoTransferencia: '',
    motivoCruce,
    causaDeLaCaida: causas.has('cruce') ? 'cruce' : 'horario',
  }, pairedItem: { item: 0 } }));
}

function cfgCampo(nombre) {
  try { return $('Config del negocio').first().json[nombre]; }
  catch (e) { return ''; }
}

// Duplicado por titulo: la cita existe, al cliente se le confirma igual --
// negarlo seria mentirle -- pero recepcion tiene que borrar la sobrante.
const porTitulo = {};
for (const e of recien) porTitulo[e.summary || ''] = (porTitulo[e.summary || ''] || 0) + 1;
const repetidos = Object.entries(porTitulo).filter(([, n]) => n > 1);

if (repetidos.length) {
  // El evento queda igual (bloque 2): con seña activa el QR se manda para la
  // cita que sobrevive; recepcion borra las repetidas con el aviso de abajo.
  return [{ json: { ...item, reservaVerificada: true, eventoId: recien[0].id, duplicados: repetidos.length,
    transferir: true,
    motivoTransferencia: `se crearon citas DUPLICADAS (${repetidos.map(([t, n]) => `${n}x ${t}`).join('; ')}), hay que borrar las sobrantes` }, pairedItem: { item: 0 } }];
}

// AVISO POR "NO VERIFICADA": DESACTIVADO. La consulta de verificacion fallaba
// siempre cuando se escribio esto; hoy si encuentra las citas (comprobado en la
// ejecucion #964), pero el aviso se deja apagado hasta tener mas evidencia de
// que no genera ruido. El registro queda en el item para poder auditarlo.
if (recien.length === 0) {
  return [{ json: { ...item, reservaVerificada: false, verificacionSinDatos: true, citaCreadaNoEncontrada }, pairedItem: { item: 0 } }];
}

return [{ json: { ...item, reservaVerificada: true, eventoId: recien[0].id, citaCreadaNoEncontrada }, pairedItem: { item: 0 } }];
