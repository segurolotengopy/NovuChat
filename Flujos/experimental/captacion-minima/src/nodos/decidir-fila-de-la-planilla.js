// DECIDIR FILA DE LA PLANILLA: con lo que se leyo de la hoja, decide si el
// prospecto es una fila NUEVA o una que YA EXISTE, y arma lo que se escribe.
//
// SE LEE LO MINIMO (revision de seguridad del PR #237, L1). Cada ejecucion
// guarda en la base de n8n lo que devuelven los nodos, y leer la hoja entera
// guardaba los datos de TODOS los prospectos, notas del equipo incluidas. Por
// eso son dos lecturas chicas:
//   `Buscar teléfono en planilla`  solo la fila de ESTE telefono (filtro de
//                                  Google por «Teléfono WhatsApp»), y solo
//                                  A:J: nunca K a N, que son del equipo;
//   `Leer IDs de la planilla`      solo la columna A, para el ID siguiente.
// Con un rango A1, n8n numera las filas DESDE EL RANGO (la de encabezados es la
// 1): la fila real es `row_number` + (fila de encabezados - 1). No escribe: eso lo hacen
// `Agregar fila` y `Actualizar fila`, segun `accionPlanilla`. Sin modelo.
//
// LO QUE SALE: un item por prospecto, con `accionPlanilla` (agregar,
// actualizar o nada) y `veredictoPlanilla`, y -- si hay algo que escribir --
// las celdas con el NOMBRE DEL ENCABEZADO como clave. Los nodos de Google
// escriben solo las claves que son encabezados (`ignoreIt`): lo demas viaja
// para `Confirmar envio`.
//
// =============================================================================
// LA HOJA «Leads_CRM»: TODO LO QUE DEPENDE DE ELLA ESTA EN ESTE BLOQUE
// =============================================================================
// Esquema de Andres (27/09/2026). Fila 1 titulo, fila 2 subtitulo, FILA 3
// ENCABEZADOS (A3:N3), datos desde la 4. Las demas hojas (Tablero_Kanban,
// Dashboard, Configuracion) no se tocan nunca: los nodos de Google leen y
// escriben solo la hoja de `Config base` («Leads_CRM» si no dice otra).
//
// LOS VALORES DE LAS LISTAS DESPLEGABLES (G, H, I, M) TIENEN QUE SER IGUALES,
// letra por letra, a los de la hoja «Configuracion». Estan aca y en ningun
// otro lado; se verifican contra la planilla real cuando la cuenta de
// servicio tenga acceso.
const PLANILLA = {
  // Los encabezados de la fila 3, por columna. Son las claves con las que se
  // escribe, y se comprueban contra lo leido antes de escribir: si el equipo
  // renombra una columna, no se escribe a ciegas (queda el aviso).
  encabezados: {
    A: 'ID Lead', B: 'Fecha Registro', C: 'Nombre y Apellido', D: 'Empresa / Cliente',
    E: 'Teléfono WhatsApp', F: 'Rubro', G: 'Etapa Funnel', H: 'Origen / Canal',
    I: 'Calificación IA', J: 'Resumen Chatbot IA', M: 'Estado Comercial',
  },
  filaEncabezados: 3,
  prefijoId: 'LEAD-',
  primerId: 1001,
  etapaNueva: '1. Nuevo Lead',                    // G, al crear
  origenChatbot: 'Chatbot WhatsApp IA',            // H, al crear
  origenAnuncio: 'Campaña Meta Ads',               // H, al crear, si vino de un anuncio
  estadoNuevo: 'Activo',                           // M, al crear
  // F «Rubro» (Andres, 27/09/2026; antes era un enlace al chat con formula):
  // el rubro REGISTRADO POR CODIGO de la ficha. Uno deducido por el modelo y no
  // confirmado no esta en la ficha, asi que nunca llega aca.
  //
  // Lo UNICO que se actualiza en una fila que ya existe, y solo si el dato
  // nuevo no esta vacio y cambia algo. A, B, E, G, H, K, L, M y N las edita el
  // equipo comercial y NUNCA se pisan.
  actualizables: ['C', 'D', 'F', 'I', 'J'],
  // La calificacion calculada no baja la que ya tiene la fila: si el flujo
  // olvido la ficha (48 horas sin mensajes), un «Baja» no pisa un «Alta». El
  // orden es el de PRIORIDAD de abajo, que NO es el de CALIFICACION.
  noBajarCalificacion: true,
};

// I «Calificación IA», POR CODIGO Y POR HECHOS (Bloque 1, 03/10/2026). Lo que el
// prospecto HIZO, no lo que el modelo dijo: los hechos los deja `Procesar
// respuesta` y llegan saneados por `Salida` en `prospectoPlanilla.hechos`.
// Tabla de reglas, de arriba hacia abajo: la primera que se cumple gana. Para
// ajustarla se edita solo esta tabla.
//   Alta          pidio una persona (boton, fila o escrito) o pidio los planes
//   Descalificado el modelo propuso un motivo de la lista y el codigo lo acepto
//                 (un hecho de Alta posterior gana: va primero)
//   Media         eligio su rubro (o «Otro») e INTERACTUO despues de la explicacion (§16, documento comercial del 07/10/2026): escribio o dijo algo
//                 sustantivo —una pregunta de fondo, un comentario sobre su negocio, su necesidad—, no un saludo ni un acuse; en «Otro», respondio el cierre
//                 investigativo. El hecho se sigue llamando `respondioDolor` (nombre historico: ya no hay pregunta de dolor en los rubros estandar).
//   Baja          el resto: eligio rubro y no continuo
const CALIFICACION = [
  { valor: 'Alta', si: (p) => p.pidioAsesor === true || p.pidioPlanes === true },
  { valor: 'Descalificado', si: (p) => Object.hasOwn(MOTIVOS_DESCARTE, p.descarte) },
  { valor: 'Media', si: (p) => (!!p.rubro || p.eligioOtro === true) && p.respondioDolor === true },
  { valor: 'Baja', si: () => true },
];
// LA PRIORIDAD de la celda, de menor a mayor: Media no pisa Descalificado,
// Descalificado no pisa Alta, Alta pisa todo. Se escribe solo si la nueva es
// mayor que la de la celda (o igual y distinta no existe). Un valor que no esta
// aca -- lo escribio una persona -- se sobrescribe.
const PRIORIDAD = ['Baja', 'Media', 'Descalificado', 'Alta'];
// Los motivos de descarte, como los propone el modelo en [DESCARTE] -- la lista
// de `Procesar respuesta` y de `Salida`: una prueba compara las claves -- y la
// etiqueta que se lee en la hoja.
const MOTIVOS_DESCARTE = {
  numero_equivocado: 'Número equivocado',
  vende_o_busca_trabajo: 'Ofrece algo o busca trabajo',
  sin_negocio: 'No tiene negocio',
  spam_o_prueba: 'Spam o prueba',
};
// J «Resumen Chatbot IA», POR CODIGO (§16): «Rubro X. Necesidad: …. Preguntó por: …. Pidió: planes y hablar con el equipo.», con lo que haya (hasta 400 caracteres). La
// necesidad ya viene saneada de `Armar mensajes` (sin enlaces, formulas ni datos personales) y aca se recorta de nuevo; los temas son de un vocabulario CERRADO (nunca
// un texto del cliente). La celda no empieza nunca con lo que una planilla toma por formula: arranca con «Rubro», «Necesidad» o «Descalificado».
const TEMAS_PREGUNTADOS = {
  costos: 'costos', consumo: 'consumo de mensajes', integraciones: 'integraciones', pagos: 'pagos y comprobantes', dudas: 'otras dudas',
};
const RESUMEN_ESTADO = {
  cerrado: 'Pidió hablar con un asesor.',
  en_conversacion: 'En conversación con el asistente.',
  operador: 'Pasó a atención de una persona.',
  bloqueado: 'Llegó al límite de respuestas del día.',
};
// =============================================================================

const H = PLANILLA.encabezados;
// §18 (B2): también sin invisibles ni marcas de dirección (U+00AD, U+061C, U+200B a U+200F, U+202A a U+202E, U+2060 a U+2069, BOM): nada que el cliente no ve llega a la hoja.
const limpio = (v) => String(v ?? '').replace(/[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
const digitos = (v) => String(v ?? '').replace(/\D/g, '');
// Un texto del cliente nunca empieza con lo que una planilla toma por formula
// («=», «+», «-», «@»): se quita en los DOS caminos (revision del PR #237, L3).
const seguro = (v) => limpio(v).replace(/^[=+\-@]+\s*/, '');
// `Agregar fila` escribe con USER_ENTERED para que «Fecha Registro» quede como
// fecha de verdad (la usan el tablero y los filtros por mes). Con USER_ENTERED
// un texto se interpreta como si lo tipeara una persona, y «591…» seria un
// numero: el apostrofo inicial lo deja como texto y no se ve en la celda.
const comoTexto = (v) => (seguro(v) ? "'" + seguro(v) : '');
const fechaLaPaz = () => new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);

function calificar(p) {
  return CALIFICACION.find((r) => r.si(p)).valor;
}
// `calificacionFinal` es la que QUEDA en la columna I: si la celda sigue en «Alta», el
// resumen no dice que se descalifico.
function resumir(p, conEstado, calificacionFinal) {
  const partes = [];
  if (calificacionFinal === 'Descalificado') partes.push('Descalificado por el asistente: ' + MOTIVOS_DESCARTE[p.descarte] + '.');
  if (limpio(p.rubro)) partes.push('Rubro ' + limpio(p.rubro).slice(0, 60) + '.');
  if (p.flujos) partes.push('Interés: ' + p.flujos + '.');
  const necesidad = limpio(p.necesidad).slice(0, 160);
  if (necesidad) partes.push('Necesidad: ' + necesidad.replace(/[.!?…]+$/, '') + '.');
  const temas = (Array.isArray(p.temas) ? p.temas : []).filter((t) => Object.hasOwn(TEMAS_PREGUNTADOS, t)).map((t) => TEMAS_PREGUNTADOS[t]);
  if (temas.length) partes.push('Preguntó por: ' + temas.join(', ') + '.');
  const pidio = [p.pidioPlanes === true ? 'planes' : '', p.pidioAsesor === true ? 'hablar con el equipo' : ''].filter(Boolean);
  if (pidio.length) partes.push('Pidió: ' + pidio.join(' y ') + '.');
  else if (p.consulta) partes.push('Consulta: ' + p.consulta + '.');
  // Sin ningun dato del negocio, el resumen no dice nada que valga pisar.
  if (!partes.length && !conEstado) return '';
  // «Pidió hablar con un asesor» ya lo dice la linea «Pidió: …».
  if (RESUMEN_ESTADO[p.estado] && !(p.estado === 'cerrado' && pidio.length)) partes.push(RESUMEN_ESTADO[p.estado]);
  return partes.join(' ').slice(0, 400);
}
// Por que no se pudo leer: SOLO el tipo y el codigo del error, nunca su
// mensaje, que podria repetir un dato del cliente (revision del PR #237).
const ESTADOS_GOOGLE = /\b(PERMISSION_DENIED|NOT_FOUND|INVALID_ARGUMENT|RESOURCE_EXHAUSTED|UNAUTHENTICATED|UNAVAILABLE|FAILED_PRECONDITION|DEADLINE_EXCEEDED|INTERNAL)\b/;
function porque(err) {
  if (!err || typeof err !== 'object') return 'error';
  const tipo = /^[A-Za-z]{1,40}$/.test(String(err.name ?? '')) ? err.name : 'error';
  const codigo = [err.httpCode, err.context?.httpCode, err.status, err.statusCode]
    .map((v) => String(v ?? '')).find((v) => /^\d{3}$/.test(v))
    || (/\b([45]\d{2})\b/.exec(String(err.message ?? '')) || [])[1] || '';
  const estado = (ESTADOS_GOOGLE.exec(String(err.message ?? '') + ' ' + String(err.description ?? '')) || [])[1] || '';
  return [tipo, codigo && 'HTTP ' + codigo, estado].filter(Boolean).join(' ');
}
// Un nodo de Google que fallo con `continueRegularOutput` devuelve el item de
// entrada con `error` al lado de `json`.
const fallido = (x) => x.error || (x.json && x.json.error !== undefined && x.json.row_number === undefined);

const prospectos = $('Prospecto para la planilla').all();
const busqueda = $('Buscar teléfono en planilla').all();
const lecturaIds = $input.all();
const fallo = [...busqueda, ...lecturaIds].find(fallido);
const coincidencias = busqueda.map((x) => x.json).filter((f) => f && f.row_number !== undefined);
const ids = lecturaIds.map((x) => x.json).filter((f) => f && f.row_number !== undefined);
const DESFASE = PLANILLA.filaEncabezados - 1;
// Los encabezados que se pueden comprobar con lo leido: A en la lectura de
// IDs; A a J en la fila encontrada. «Teléfono WhatsApp» lo comprueba Google
// al filtrar (si no existe, la busqueda falla y no se escribe).
const LEIDAS = 'ABCDEFGHIJ'.split('').filter((l) => H[l]);
const faltan = [
  ...(ids.length && !(H.A in ids[0]) ? [H.A] : []),
  ...(coincidencias.length ? LEIDAS.map((l) => H[l]).filter((n) => !(n in coincidencias[0])) : []),
];

const out = [];
prospectos.forEach((it, i) => {
  const p = it.json;
  const nada = (veredicto) => out.push({ json: { accionPlanilla: 'nada', veredictoPlanilla: veredicto },
    pairedItem: { item: i } });
  if (!p || !p.telefono) return nada('sin_telefono');
  if (fallo) return nada('no_leida: ' + porque(fallo.error ?? fallo.json.error));
  if (faltan.length) return nada('encabezados_distintos: la fila ' + PLANILLA.filaEncabezados + ' no tiene «' +
    faltan[0] + '»');

  const actual = coincidencias.find((f) => digitos(f[H.E]) === p.telefono);
  // Los hechos viajan dentro del prospecto (`Salida`); un item de antes de ese
  // cambio no los trae, y `cerrado` sigue siendo un pedido de una persona.
  const prospecto = { ...p, ...(p.hechos && typeof p.hechos === 'object' ? p.hechos : {}),
    pidioAsesor: p.estado === 'cerrado' || p.hechos?.pidioAsesor === true };
  const calificacion = calificar(prospecto);

  if (actual) {
    // YA EXISTE: solo C, D, F, I y J, solo si el dato nuevo no esta vacio y
    // cambia algo. `Actualizar fila` escribe por `row_number`, como texto
    // crudo (RAW): nada se interpreta.
    const prioridad = (v) => PRIORIDAD.indexOf(limpio(v));
    // La que queda en I: la celda no baja (`noBajarCalificacion`), y el resumen (J)
    // se arma con ESA, no con la calculada.
    const quedaEnI = PLANILLA.noBajarCalificacion && prioridad(actual[H.I]) >= 0 && prioridad(calificacion) < prioridad(actual[H.I])
      ? limpio(actual[H.I]) : calificacion;
    const nuevo = { C: seguro(p.nombre), D: seguro(p.empresa), F: seguro(p.rubro), I: calificacion,
      J: seguro(resumir(prospecto, false, quedaEnI)) };
    const celdas = {};
    for (const l of PLANILLA.actualizables) {
      const v = nuevo[l];
      const antes = actual[H[l]];
      if (!v || limpio(antes) === v) continue;
      if (l === 'I' && PLANILLA.noBajarCalificacion && prioridad(antes) >= 0 && prioridad(v) < prioridad(antes)) continue;
      celdas[H[l]] = v;
    }
    if (!Object.keys(celdas).length) return nada('sin_cambios');
    out.push({ json: { accionPlanilla: 'actualizar', veredictoPlanilla: 'actualizar',
      row_number: Number(actual.row_number) + DESFASE, ...celdas }, pairedItem: { item: i } });
    return;
  }

  // NUEVA: el ID que sigue al mayor que haya, y la fila entera. K, L y N no
  // se escriben: las llena el equipo.
  // AGREGAR, NO ESCRIBIR EN UN NUMERO DE FILA: `Agregar fila` usa el agregado
  // de la API (`useAppend`), que no pisa la fila de otro prospecto si dos
  // llegan al mismo tiempo.
  const numeros = ids.map((f) => (/^\s*LEAD-(\d+)\s*$/i.exec(String(f[H.A] ?? '')) || [])[1])
    .filter(Boolean).map(Number);
  const siguiente = numeros.length ? Math.max(...numeros) + 1 : PLANILLA.primerId;
  out.push({ json: {
    accionPlanilla: 'agregar',
    veredictoPlanilla: 'agregar',
    [H.A]: PLANILLA.prefijoId + siguiente,
    [H.B]: fechaLaPaz(),
    [H.C]: comoTexto(p.nombre),
    [H.D]: comoTexto(p.empresa),
    [H.E]: "'" + p.telefono,
    [H.F]: comoTexto(p.rubro),
    [H.G]: PLANILLA.etapaNueva,
    [H.H]: p.anuncio ? PLANILLA.origenAnuncio : PLANILLA.origenChatbot,
    [H.I]: calificacion,
    [H.J]: comoTexto(resumir(prospecto, true, calificacion)),
    [H.M]: PLANILLA.estadoNuevo,
  }, pairedItem: { item: i } });
});
return out;
