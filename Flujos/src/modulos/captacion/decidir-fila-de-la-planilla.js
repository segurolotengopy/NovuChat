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
  // olvido la ficha (48 horas sin mensajes), un «Baja» no pisa un «Alta».
  noBajarCalificacion: true,
};

// I «Calificación IA», POR CODIGO. Tabla de reglas, de arriba hacia abajo: la
// primera que se cumple gana. Para ajustarla se edita solo esta tabla.
const CALIFICACION = [
  { valor: 'Alta', si: (p) => p.pidioAsesor || (!!p.empresa && !!p.rubro) },
  { valor: 'Media', si: (p) => !!p.empresa || !!p.rubro },
  { valor: 'Baja', si: () => true },
];
// J «Resumen Chatbot IA», POR CODIGO: el interes, la consulta y el estado. El
// rubro ya no va aca: tiene su columna, F.
const RESUMEN_ESTADO = {
  cerrado: 'Pidió hablar con un asesor.',
  en_conversacion: 'En conversación con el asistente.',
  operador: 'Pasó a atención de una persona.',
  bloqueado: 'Llegó al límite de respuestas del día.',
};
// =============================================================================

const H = PLANILLA.encabezados;
const limpio = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
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
function resumir(p, conEstado) {
  const partes = [];
  if (p.flujos) partes.push('Interés: ' + p.flujos + '.');
  if (p.consulta) partes.push('Consulta: ' + p.consulta + '.');
  // Sin ningun dato del negocio, el resumen no dice nada que valga pisar.
  if (!partes.length && !conEstado) return '';
  if (RESUMEN_ESTADO[p.estado]) partes.push(RESUMEN_ESTADO[p.estado]);
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
  const prospecto = { ...p, pidioAsesor: p.estado === 'cerrado' };
  const calificacion = calificar(prospecto);

  if (actual) {
    // YA EXISTE: solo C, D, F, I y J, solo si el dato nuevo no esta vacio y
    // cambia algo. `Actualizar fila` escribe por `row_number`, como texto
    // crudo (RAW): nada se interpreta.
    const nuevo = { C: seguro(p.nombre), D: seguro(p.empresa), F: seguro(p.rubro), I: calificacion,
      J: seguro(resumir(prospecto, false)) };
    const orden = (v) => CALIFICACION.findIndex((x) => x.valor === limpio(v));
    const celdas = {};
    for (const l of PLANILLA.actualizables) {
      const v = nuevo[l];
      const antes = actual[H[l]];
      if (!v || limpio(antes) === v) continue;
      if (l === 'I' && PLANILLA.noBajarCalificacion && orden(antes) >= 0 && orden(v) > orden(antes)) continue;
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
    [H.J]: comoTexto(resumir(prospecto, true)),
    [H.M]: PLANILLA.estadoNuevo,
  }, pairedItem: { item: i } });
});
return out;
