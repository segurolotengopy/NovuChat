// LA CONSOLA MANDA, PERO NUNCA DEJA AL CLIENTE SIN RESPUESTA.
//
// QUE RESUELVE. Hasta hoy el negocio escribia su configuracion en la consola y
// el asistente seguia usando la que tenia adentro: cambiar un precio o un
// horario no hacia absolutamente nada. Era EL defecto que un cliente iba a
// descubrir solo, probando, y el que dejaba sin sustento la promesa de
// «configuralo vos».
//
// COMO. `Traer configuracion` pide al panel la ficha del negocio. Si contesta,
// sus valores PISAN a los de `Config base`. Si no contesta, o contesta algo
// raro, se usan los de siempre: el peor caso es el comportamiento de ayer.
//
// POR QUE ESTE NODO SE LLAMA «Config del negocio». Porque asi se llamaba el Set
// que traia los valores escritos a mano, y hay veinte expresiones en el flujo
// -- herramientas, prompt, nodos de salida -- que lo buscan por ese nombre.
// Heredando el nombre, todas recogen la version fusionada sin tocar ninguna.
// El Set paso a llamarse «Config base».
//
// SOLO SE PISA LO QUE VIENE CON CONTENIDO. Un campo vacio en la consola no
// borra el valor de respaldo: el negocio que todavia no cargo su direccion
// tiene que comportarse como antes, no peor.
const base = $('Config base').first().json;

// ---------------------------------------------------------------------------
// EL 409 NO ES UN FALLO: ES LA RESPUESTA QUE CORTA EL SERVICIO.
//
// EL DEFECTO QUE ESTO ARREGLA (reportado el 2026-09-07, y confirmado en los
// TRES flujos). `configuracionFlujo` contesta 409 con `{estado, mensajeCortesia}`
// y SIN `tenantId` cuando el comercio no esta activo. La version anterior de
// este nodo exigia `tenantId` para dar la respuesta por buena, asi que un 409
// caia al respaldo... y el respaldo dice `estadoComercio: 'operativo'` escrito a
// mano. Resultado: **un comercio suspendido seguia siendo atendido**, y en el
// flujo de recordatorios seguia enviando plantillas que Meta cobra. Era
// exactamente el defecto que conectar el panel daba por cerrado, y yo lo habia
// afirmado por escrito sin comprobarlo.
//
// LA RAIZ ERA NO PODER DISTINGUIR «el panel dice que esta suspendido» de «el
// panel no contesto». Los dos se veian igual: un fallo. Ahora el nodo HTTP
// devuelve la respuesta completa -codigo y cuerpo- y aca se decide con el
// codigo:
//
//   200 + tenantId  -> configuracion del panel
//   409             -> SUSPENDIDO. Es una respuesta valida, no un error.
//   cualquier otra  -> no se pudo saber -> respaldo
//
// SOBRE `neverError`, QUE ESTE PROYECTO PROHIBIO EL 2026-09-01: aquel caso era
// un nodo que salia VERDE con un 401 y nadie miraba el resultado. Aca el codigo
// se examina explicitamente y lo que no se reconoce cae al respaldo dejando
// rastro. La regla real no es «nunca neverError», es «nunca ignores el codigo».

const respuesta = $input.first().json ?? {};
const codigo = Number(respuesta.statusCode);
const cuerpo = (respuesta.body ?? {});

const util = (v) => (typeof v === 'string' && v.trim() !== '') ? v.trim() : undefined;
const soloLlenos = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// EL CALENDARIO DE LOS PROXIMOS DIAS, MASTICADO (2026-09-23). El modelo
// escribio «el jueves 25 de septiembre» por un 25 que era viernes, y «el
// miercoles 24» por un 24 que era jueves (Bellido, #4790 y #4799): de una fecha
// al dia de la semana hay una sola respuesta, y es lo unico que el modelo tenia
// que calcular solo. Aca va servido, para que no calcule.
//
// LA FRASE ENTERA SE ARMA ACA, no en el prompt, y no es por comodidad: el
// bloque de contexto del turno tiene un tope de 700 caracteres
// (`prefijo-cacheable.test.ts`) porque se paga y se guarda en la memoria en
// CADA turno, y el de Bellido ya estaba en 686. Con el texto en el nodo, el
// prompt gasta `{{ $json.diasProximos }}` y nada mas.
//
// PERO ESO NO LO HACE GRATIS, y conviene decirlo: lo que se ahorra son
// caracteres de PLANTILLA; lo que el modelo lee y paga cada turno son los ~200
// de abajo. Por eso van DIEZ dias y no quince, y la frase es la mas corta que
// dice las dos cosas. `prefijo-cacheable.test.ts` mide ahora tambien esto, para
// que el tope no se pueda esquivar moviendo texto de lado.
//
// ES UNA AYUDA, NO LA BARRERA. La barrera esta en `Procesar respuesta`, que
// corrige la palabra contra las fechas que las herramientas tocaron de verdad.
// Esto solo hace que casi nunca tenga que actuar, y no cubre una fecha mas alla
// de la ventana (las citas de octubre, por ejemplo).
const diasProximos = (() => {
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const hoy = new Date();
  const lista = [];
  for (let i = 0; i < 10; i++) {
    const d = new Date(hoy.getTime() + i * 86400000);
    // Dia y dia-de-la-semana en la zona del negocio: el servidor corre en UTC
    // y a las 20:00 de La Paz ya seria el dia siguiente.
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/La_Paz', weekday: 'short', day: '2-digit',
    }).formatToParts(d);
    const valor = (t) => (partes.find((p) => p.type === t) || {}).value || '';
    const semana = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[valor('weekday')];
    const dia = parseInt(valor('day'), 10);
    if (Number.isFinite(semana) && Number.isFinite(dia)) lista.push(DIAS[semana] + ' ' + dia);
  }
  // Siempre una cadena: el prompt la interpola cruda y un `undefined` se veria.
  if (!lista.length) return '';
  // CON EL AÑO (24/09/2026, ejecucion #5563 de Bellido): con «Ahora: jueves 24
  // de septiembre de 2026» en el mismo turno, el modelo llamo a las
  // herramientas con 2025-09-25 y creo una cita un año atras. Son diez
  // caracteres por turno; la barrera esta en `Comprobar reserva`, que deshace
  // una cita en el pasado. Esto solo hace que casi nunca tenga que actuar.
  const anio = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric' }).format(hoy);
  return '\nQué día es cada fecha (año ' + anio + ', no lo calcules): ' + lista.join(' · ')
    + '. Si te dan un día y un número que no coinciden, pregunta cuál quieren.';
})();

// EL NOMBRE DEL ASISTENTE lo elige cada empresa en la consola y vale para todos
// sus flujos (decidido el 15/09/2026). Es TEXTO LIBRE y va al prompt: se deja en
// una sola linea, sin corchetes ni llaves -- con ellos podria imitar un bloque
// [CONTEXTO DEL SISTEMA] -- ni comillas angulares, que el prompt usa para
// citarlo, y con el tope de 40 del servidor. Vacio = el asistente de siempre.
// La regla de identidad (asistente virtual con IA, no lo niega) NO depende de
// este campo: esta escrita en el prompt y en los textos fijos, con o sin nombre.
const nombreDelAsistente = (v) => {
  if (typeof v !== 'string') return undefined;
  const t = util(v.replace(/[\u0000-\u001f\u007f\u2028\u2029\[\]{}<>«»]/g, ' ').replace(/\s+/g, ' '));
  return t ? t.slice(0, 40).trim() : undefined;
};
// Cuantos emojis llevan los TEXTOS FIJOS, los que no pasan por el modelo. Al
// modelo se lo dice `estiloEmojis`; esto es para lo que el flujo escribe solo.
const NIVELES_EMOJIS = ['ninguno', 'pocos', 'muchos'];

// ---------------------------------------------------------------------------
// ESTADO DE ATENCION DEL TELEFONO: los umbrales de uso extendido
// (`Analisis/27` §5, decididos el 13/09/2026).
//
// `Traer configuracion` manda el telefono que escribio, y el panel contesta en
// `atencion` cuantas respuestas lleva ese cliente en su ventana de 24 h y que
// hacer con ESTE turno:
//   normal    -> al modelo, como siempre.
//   operador  -> paso el umbral de operador (50 por defecto): NO se llama al
//                modelo; se responde un aviso fijo y, la primera vez, se avisa
//                al negocio para que una persona tome la conversacion.
//   bloqueado -> paso el umbral de bloqueo (100 por defecto): no se envia nada
//                hasta que la ventana se renueve.
// Los umbrales los fija NovuChat por empresa en el panel. El flujo no cuenta
// nada: obedece. Quien decide es el servidor (`atencion.ts`).
//
// ANTE LA DUDA, NORMAL. Si el panel no contesta, contesta 409 o manda un
// estado que no se reconoce, el estado es `normal`: el mismo criterio de
// arriba, una caida del panel no puede dejar sin respuesta a un cliente. El
// techo de costo lo vuelve a poner el servidor en el primer turno que conteste.
// ---------------------------------------------------------------------------
const at = (codigo === 200 && cuerpo && typeof cuerpo.atencion === 'object' && cuerpo.atencion)
  ? cuerpo.atencion : {};
const atencion = {
  atencionEstado: ['normal', 'operador', 'bloqueado'].includes(at.estado) ? at.estado : 'normal',
  // El texto lo pone el panel; este es el respaldo, identico al del servidor
  // (`MENSAJE_USO_EXTENDIDO` en atencion.ts). Neutro: no habla de limites, de
  // mensajes ni de dinero, porque quien lo lee es un tercero.
  atencionMensajeFijo: util(at.mensajeFijo)
    || 'Gracias por su paciencia. Para atenderle mejor, una persona del equipo va a continuar esta conversación en breve.',
  atencionAvisarRecepcion: ['operador', 'bloqueado'].includes(at.avisarRecepcion) ? at.avisarRecepcion : '',
  atencionRespuestas: (typeof at.respuestasEnVentana === 'number' && Number.isFinite(at.respuestasEnVentana))
    ? at.respuestasEnVentana : 0,
  atencionVenceEn: util(at.ventanaVenceEn) || '',
};

if (codigo === 409) {
  return [{ json: { ...base, ...atencion, diasProximos,
    estadoComercio: 'suspendido',
    // El texto neutro lo pone el panel: no menciona pagos ni deudas, porque el
    // cliente final no tiene por que enterarse de que el negocio debe dinero.
    mensajeComercioSuspendido: util(cuerpo.mensajeCortesia)
      || base.mensajeComercioSuspendido,
    configDeLaConsola: false,
    panelDice: 'no operativo',
  } }];
}

const contesto = codigo === 200 && cuerpo && typeof cuerpo.tenantId === 'string';
if (!contesto) {
// Sin respuesta no se corta: una caida del panel no puede dejar sin asistente a
// todos los comercios. Un cliente escribiendo merece una respuesta.
  return [{ json: { ...base, ...atencion, diasProximos,
    estadoComercio: base.estadoComercio ?? 'operativo',
    configDeLaConsola: false,
    panelSinRespuesta: true,
    codigoDelPanel: Number.isFinite(codigo) ? codigo : 0,
  } }];
}

const r = cuerpo;

const dn = r.datosDelNegocio ?? {};
const op = r.operacion ?? {};

// --- CATALOGO -------------------------------------------------------------
// Se parte por PRECIO, no por rubro, porque es lo que cambia como habla el
// asistente: lo que tiene precio se cotiza en el chat; lo que no, se cotiza
// despues de evaluar. Un servicio sin precio no es un dato faltante.
const items = Array.isArray(r.catalogo) ? r.catalogo : [];
const conPrecio = items.filter((i) => typeof i.precio === 'number');
const sinPrecio = items.filter((i) => typeof i.precio !== 'number');
// «BOB» es el codigo ISO y no se le dice a un cliente: en Bolivia se dice
// «Bs». El asistente lee esta lista en voz alta.
const simbolo = (m) => (m === 'USD' ? 'USD' : 'Bs');
const monedaNegocio = simbolo(util(op.moneda));
const listaConPrecio = conPrecio
  .map((i) => `${i.nombre} ${i.precio} ${i.moneda ? simbolo(i.moneda) : monedaNegocio}`).join(' · ');
const listaSinPrecio = sinPrecio.map((i) => i.nombre).join(', ');

// --- FUNCIONARIOS ---------------------------------------------------------
// El panel los devuelve como objetos; el flujo los lee como texto JSON con las
// claves que ya usan las herramientas de calendario.
const equipo = Array.isArray(r.funcionarios) ? r.funcionarios.map((f) => ({
  nombre: f.nombre,
  servicios: Array.isArray(f.servicios) ? f.servicios : [],
  calendario: f.calendario || f.calendarioId || '',
  // EL HORARIO DE CADA PERSONA, QUE ANTES SE TIRABA (2026-09-20). El servidor
  // ya lo manda --el propio, o el del negocio si esa persona no tiene uno--, y
  // este nodo se quedaba con nombre, servicios y calendario. Sin el, el modelo
  // no sabe que dias trabaja cada quien y `Comprobar reserva` no tiene con que
  // comprobar nada: ese dia se agendo un DOMINGO con la clinica cerrada.
  horario: (f.horarioTrabajo && typeof f.horarioTrabajo === 'object') ? f.horarioTrabajo : {},
})).filter((f) => f.nombre) : [];

// --- DONDE QUEDA EL LOCAL (Analisis/34 §2) ----------------------------------
// El enlace de Google Maps va en el MISMO mensaje que la direccion -- en la
// confirmacion de la cita y ante «donde quedan?» --: cero mensajes nuevos. El
// servidor ya lo filtro por dominio (`enlaceDeMapaValido`, prompt.ts); aca se
// vuelve a mirar porque es lo unico que el asistente reenvia TAL CUAL a un
// cliente, y un enlace ajeno con el nombre del negocio no puede salir por una
// caida de la validacion de arriba. Las coordenadas del pin llegan en
// `operacion.ubicacion` como numeros y se guardan como texto, porque Config
// base es un Set de textos; `Procesar respuesta` las vuelve numero. Sin
// coordenadas no hay pin: el texto ya lleva la direccion y el enlace.
const ENLACE_MAPA = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.com\/maps|google\.com\/maps|maps\.google\.com)([/?][A-Za-z0-9._~:/?#@!$&()*+,;=%-]*)?$/;
const enlaceDeMapa = (v) => { const t = util(v); return t && t.length <= 200 && ENLACE_MAPA.test(t) ? t : undefined; };
const coordenada = (u, clave, max) => (u && typeof u === 'object' && typeof u[clave] === 'number'
  && Number.isFinite(u[clave]) && Math.abs(u[clave]) <= max) ? String(u[clave]) : undefined;

const deLaConsola = soloLlenos({
  nombreNegocio: util(dn.nombreNegocio),
  descripcion: util(dn.descripcion),
  direccion: util(dn.direccion),
  direccionMaps: enlaceDeMapa(dn.direccionMaps),
  ubicacionLat: coordenada(op.ubicacion, 'lat', 90),
  ubicacionLng: coordenada(op.ubicacion, 'lng', 180),
  politicaCancelacion: util(dn.politicaCancelacion),
  // INSTRUCCIONES EXTRA: texto libre del negocio (hasta 1.500 caracteres en
  // la consola, y verificado en el servidor antes de regir). El prompt lo
  // inserta en su seccion delimitada y rotulada como DATO, nunca delante de
  // las reglas. Vacio en la consola = queda el respaldo de `Config base`.
  instruccionesExtra: util(dn.instruccionesExtra),
  mensajeCierre: util(dn.mensajeCierre),
  mensajeErrorTemporal: util(dn.mensajeErrorTemporal),
  mensajeReservaNoConfirmada: util(dn.mensajeReservaNoConfirmada),
  mensajeComercioSuspendido: util(dn.mensajeComercioSuspendido),
  // Textos fijos del menu inicial, los contactos directos, la emergencia y la
  // despedida en dos mensajes, y las reglas de agenda: la consola todavia no
  // los edita; cuando lo haga, pisan al respaldo como los demas textos.
  mensajeMenu: util(dn.mensajeMenu),
  mensajeContactoRecepcion: util(dn.mensajeContactoRecepcion),
  mensajeContactoDoctor: util(dn.mensajeContactoDoctor),
  mensajeEmergencia: util(dn.mensajeEmergencia),
  mensajeRedes: util(dn.mensajeRedes),
  reglasAgenda: util(dn.reglasAgenda),
  numeroDoctor: util(op.numeroDoctor),
  numeroRecepcion: util(op.numeroRecepcion),
  calendarioId: util(op.calendarioId),
  horarioAtencion: util(op.horarioAtencion),
  // `datosQueNoTenemos` lo calcula el panel mirando que campos quedaron vacios.
  datosQueNoTenemos: Array.isArray(dn.datosQueNoTenemos) && dn.datosQueNoTenemos.length
    ? dn.datosQueNoTenemos.join(', ') : undefined,
  funcionarios: equipo.length ? JSON.stringify(equipo) : undefined,
  catalogoConPrecio: listaConPrecio || undefined,
  catalogoSinPrecio: listaSinPrecio || undefined,
  // La voz sale de opciones cerradas del panel, nunca de texto libre.
  // La voz sale ROTULADA del panel (`voz`), no del arreglo
  // `instruccionesDeVoz`: leerlo por posicion se rompe el dia que
  // aparezca una tercera frase.
  tratamiento: util((r.voz ?? {}).tratamiento),
  estiloEmojis: util((r.voz ?? {}).emojis),
  nombreAsistente: nombreDelAsistente((r.voz ?? {}).nombreAsistente),
  nivelEmojis: NIVELES_EMOJIS.includes((r.voz ?? {}).nivelEmojis) ? r.voz.nivelEmojis : undefined,
});

// --- SEÑA PARA RESERVAR (bloque 2, Analisis/30 §4) -------------------------
// El panel manda `sena` solo al flujo de agendamiento: `activa` exige un
// importe mayor que cero Y el QR del comercio registrado y encendido (el
// servidor lo decide; aca se vuelve a exigir la URL del QR porque es lo que
// se manda TAL CUAL en el mensaje de imagen). Todo viaja como texto, porque
// Config base es un Set de textos. `pendiente`, `evento` son de ESTE telefono:
// si hay un QR pendiente, la proxima foto o PDF es el comprobante
// (`Normalizar entrada`). Sin `sena` en la respuesta, o con el panel caido,
// queda el respaldo de Config base: seña inactiva, y el flujo agenda como
// siempre, sin mandar ningun mensaje de mas.
const sn = (r.sena && typeof r.sena === 'object') ? r.sena : {};
const qrSena = (sn.qr && typeof sn.qr === 'object') ? sn.qr : {};
const senaActiva = sn.activa === true && typeof sn.importe === 'number' && Number.isFinite(sn.importe)
  && sn.importe > 0 && typeof qrSena.url === 'string' && /^https:\/\//.test(qrSena.url);
const evSena = (sn.evento && typeof sn.evento === 'object') ? sn.evento : {};
const minutosSena = (typeof sn.minutosRetencion === 'number' && Number.isInteger(sn.minutosRetencion)
  && sn.minutosRetencion >= 5 && sn.minutosRetencion <= 180) ? String(sn.minutosRetencion) : undefined;
const laSena = {
  senaActiva: senaActiva ? 'si' : '',
  senaImporte: senaActiva ? String(sn.importe) : '',
  senaMoneda: simbolo(util(sn.moneda) || util(op.moneda)),
  senaMinutosRetencion: minutosSena || String(base.senaMinutosRetencion || '30'),
  senaQrUrl: senaActiva ? qrSena.url.trim() : '',
  senaNombreCuenta: senaActiva ? String(qrSena.nombreCuenta || '').trim().slice(0, 120) : '',
  senaBanco: senaActiva ? String(qrSena.banco || '').trim().slice(0, 80) : '',
  senaPendiente: sn.pendiente === true ? 'si' : '',
  // Cuando salio el QR: con los minutos de retencion da la hora limite
  // del reenvio, sin ninguna consulta extra.
  senaQrEnviadoEn: typeof sn.qrEnviadoEn === 'string' ? sn.qrEnviadoEn : '',
  // EL PAGO TARDIO (19/09/2026): minutos desde que el horario se libero por
  // falta de pago, dentro del dia. Con esto el flujo distingue «comprobante de
  // la nada» de «pago que llego tarde», que es un caso con plata de por medio
  // y una persona esperando: se le dice la verdad y pasa a recepcion.
  senaVencidaHaceMin: (typeof sn.vencidaHaceMin === 'number' && sn.vencidaHaceMin >= 0)
    ? String(sn.vencidaHaceMin) : '',
  senaEventoId: typeof evSena.id === 'string' ? evSena.id.slice(0, 200) : '',
  senaEventoCalendario: typeof evSena.calendario === 'string' ? evSena.calendario.slice(0, 200) : '',
  // EL ADELANTO A FAVOR (Andres, 21/09/2026): el servidor dice si este
  // telefono tiene el adelanto de una cita pagada que cancelo con
  // anticipacion, y hasta cuando vale. Con el, la proxima cita no pide seña.
  senaAFavor: (sn.aFavor && typeof sn.aFavor.hasta === 'string') ? 'si' : '',
  senaAFavorHasta: (sn.aFavor && typeof sn.aFavor.hasta === 'string') ? sn.aFavor.hasta.slice(0, 40) : '',
};

// `estadoComercio` NO se toma del respaldo: si el panel dice que el comercio no
// esta operativo, manda el panel. Es lo que corta el servicio a quien dejo de
// pagar, y no puede depender de un valor escrito adentro del flujo.
const estadoComercio = util(r.estadoComercio) === 'activo' ? 'operativo'
  : (util(r.estadoComercio) ? 'suspendido' : base.estadoComercio);

// --- CAMPAÑAS VIGENTES (Andres, 24/09/2026) ---------------------------------
// El servidor manda en `campanas` SOLO las que estan aplicadas (pasaron la
// verificacion) y vigentes hoy, con el tope del plan ya cumplido. Aca se vuelve
// a mirar la vigencia contra el reloj, porque es barato y porque una campaña
// vencida que se colara le saltaria el menu a alguien que escribio lo mismo por
// su cuenta. Viaja como texto JSON: `Normalizar entrada` compara el texto.
// Sin `campanas`, o con el panel caido (las otras dos salidas de este nodo),
// no hay campañas: el menu sale como siempre, que es el peor caso aceptable.
const campanasActivas = JSON.stringify((Array.isArray(r.campanas) ? r.campanas : [])
  .filter((k) => k && typeof k.texto === 'string' && k.texto.trim() !== '' && k.texto.length <= 300)
  .filter((k) => {
    const desde = Date.parse(String(k.inicio || ''));
    const hasta = Date.parse(String(k.fin || ''));
    const ahora = Date.now();
    return Number.isFinite(desde) && Number.isFinite(hasta) && desde <= ahora && ahora < hasta;
  })
  .slice(0, 10)
  .map((k) => ({ id: String(k.id || '').slice(0, 60), texto: k.texto.trim() })));

return [{ json: { ...base, ...atencion, diasProximos, ...deLaConsola, ...laSena, campanasActivas, estadoComercio, configDeLaConsola: true } }];
