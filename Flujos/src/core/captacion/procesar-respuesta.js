// PROCESAR RESPUESTA: separa las marcas del agente, arma POR CODIGO lo que no
// puede depender del modelo -- las areas de referencia, los planes con sus
// precios, la confirmacion de un rubro deducido, la pregunta por lo que falta
// de la ficha -- y aplica la prohibicion 4 (el agente no niega ser una IA). Un
// modelo puede omitir una frase de las instrucciones; lo que no se negocia no
// depende de su voluntad. Las reglas del 27/09/2026 (a-e) estan explicadas
// antes del ciclo principal.
//
// LAS MARCAS, que el cliente nunca ve:
//   [LEAD]{json}[/LEAD]  los datos del prospecto que el cliente dio o corrigio
//                        en este turno. Una sola llamada al modelo por turno:
//                        la extraccion viaja en la misma respuesta.
//   [RUBROS]             se reemplaza por las AREAS DE REFERENCIA de la
//                        consola, en linea y SIN NUMERAR, con la frase que
//                        aclara que no son las unicas. Ver mas abajo.
//   [PLANES]             se reemplaza por el bloque de planes y cargos unicos,
//                        con los precios EXACTOS de la consola, SOLO si la
//                        ficha ya tiene empresa y rubro (regla c). Si la consola
//                        tiene un archivo de planes valido (imagen o PDF),
//                        los planes van en ese archivo, sean cuantos sean
//                        (Andres, 27/09/2026): el archivo es el encabezado
//                        del mensaje y el cuerpo es corto, sin la lista ni
//                        los precios en texto (ver «f» mas abajo). Sin
//                        planes cargados no hay precios: se ofrece al asesor.
//                        El mensaje sale con el boton «Hablar con un asesor».
//   [CIERRE]             el cliente pidio por escrito que lo contacten y ya
//                        estan los datos obligatorios: se avisa a una persona.
//
// UN [CIERRE] SIN LOS DATOS NO CIERRA. El modelo puede apurarse; el aviso
// interno cuesta un mensaje utility y le quita tiempo a una persona, asi que
// se exige que empresa, contacto y rubro esten de verdad registrados. En su
// lugar, la respuesta sale con el boton: tocarlo pasa al asesor con lo que haya.
//
// QUE EL BOTON SOBREVIVA AL LIMITE DE META. El cuerpo de un mensaje con botones
// admite hasta `limiteInteractivo` caracteres (1024, `Config base`). Pasarse no
// da error: `Salida` baja el mensaje a texto y el cliente se queda SIN la unica
// salida hacia una persona. Paso el 15/09/2026, con los planes en 1411
// caracteres, y la ejecucion figuro «success». Antes de resignar el boton se
// compacta, en este orden y deteniendose apenas entra:
//   1. el texto del modelo -- el envoltorio -- recortado por palabras, con «…»
//      al final (`texto_recortado`), y NUNCA por debajo de `PISO_TEXTO`;
//   2. solo si ni asi entra, el bloque de planes sin lo que incluye cada plan
//      ni el detalle de cada cargo -- nombre, precio y periodo --
//      (`planes_compactados`). Con el bloque resumido el texto se vuelve a
//      recortar desde el original, para no quitarle mas de lo necesario;
//   3. si ni asi entra, el mensaje sale entero como texto y sin boton -- lo hace
//      `Salida`, que lo anota con `boton_perdido_por_largo` --. Ahi no se
//      recorta nada: como texto caben 4096 y el boton ya esta perdido.
// LOS PRECIOS NO SE RECORTAN NUNCA: son lo que el cliente compara.
//
// EL ORDEN SE INVIRTIO el 15/09/2026 (ejecucion 2536). Estaba al reves --
// primero el bloque -- y con 380 caracteres del modelo y el bloque en 650
// (1030: SEIS caracteres de mas) el cliente recibio «Impulso (USD 25/mes).
// Crecimiento (USD 50/mes). Pro (USD 90/mes).», sin las conversaciones
// incluidas ni lo que trae cada plan, que es justo lo que se compara al elegir.
// El aviso quedo anotado, asi que el mecanismo funcionaba: lo que estaba mal
// era el orden. Lo que escribio el modelo es el envoltorio y se pierde primero;
// el precio Y EL DETALLE de cada plan son lo ultimo.
// MENSAJES POR TURNO: los mismos. Compactar no agrega ni quita un mensaje.
//
// EL BOTON «Hablar con un asesor» (respuesta, id `asesor`) va con los planes, al
// terminar el primer bloque, en un cierre sin datos y cuando pide soporte. Reemplaza al enlace a
// wa.me de antes: tocarlo dispara `Traspaso a un asesor`, sin modelo. En el
// cierre completo NO va: la persona ya fue avisada y el boton solo invitaria a
// un mensaje pagado que repite el traspaso.
//
// PERO UN CIERRE SIN AVISO NO DEJA AL PROSPECTO SIN SALIDA. «Ya fue avisada»
// vale solo si Meta acepto la plantilla, y eso lo dice `c.avisado`, que escribe
// `Confirmar envio`. El 15/09/2026 la plantilla estaba en revision, Meta la
// rechazo (132001) y los cuatro telefonos que probaron quedaron cerrados, sin
// boton y sin que nadie los llamara. Mientras `avisado` sea falso, la respuesta
// de una conversacion cerrada sigue saliendo con el boton. NO CUESTA UN MENSAJE
// MAS: el boton viaja dentro del mismo.
const entradas = $('Estado de la conversación').all();
const sd = $getWorkflowStaticData('global');
sd.conversaciones = sd.conversaciones ?? {};

const NIEGA_IA = /(no\s+soy\s+(un[ao]?\s+)?(bot|robot|m[aá]quina|programa|inteligencia\s+artificial|\bia\b|asistente\s+virtual|autom[aá]tic[ao])|soy\s+(un[ao]?\s+)?(persona|humano|humana|ser\s+humano)|habl(as|[aá]s|a)\s+con\s+(un[ao]?\s+)?(persona|humano|humana))/i;
// Sin NIT desde el 15/09. `flujos` no lo pide el modelo: se deduce del rubro,
// pero se acepta si lo manda.
const CAMPOS = ['empresa', 'contacto', 'rubro', 'area', 'personalizacion', 'consulta', 'flujos'];
const OBLIGATORIOS = ['empresa', 'contacto', 'rubro'];
// UN DATO DE RELLENO NO ES UN DATO. El 15/09 el modelo marco rubro «Pendiente»
// sin que el cliente dijera nada: contaba como registrado, y con los otros tres
// el cierre avisaba a un asesor por un prospecto a medias.
const RELLENO = /^(pendiente|por (definir|confirmar)|a definir|desconocid[oa]|no (especificad[oa]|indicad[oa]|informad[oa]|sabe|lo sabe|dijo)|sin (dato|datos|definir|especificar)|n\/?a|ninguno|null|undefined|-+|\?+|…|\.{3})$/i;

const BOTON_ASESOR = { type: 'reply', reply: { id: 'asesor', title: 'Hablar con un asesor' } };
const PIDE_ASESOR = 'Si quieres hablar con un asesor, escríbeme «asesor».';
const SUFIJO = { mes: '/mes', anio: '/año', unico: ', pago único' };
const monto = (n) => Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
const punto = (t) => /[.!?…]$/.test(t) ? t : t + '.';
const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

function leerLead(bruto) {
  const m = bruto.match(/\[LEAD\]([\s\S]*?)\[\/LEAD\]/i);
  if (!m) return { lead: {}, invalido: false };
  try {
    const j = JSON.parse(m[1].trim());
    const lead = {};
    for (const k of CAMPOS) {
      let v = j?.[k];
      if (Array.isArray(v)) v = v.map(String).join(', ');
      if (v === undefined || v === null) continue;
      v = String(v).replace(/\s+/g, ' ').trim().slice(0, 300);
      if (v && !RELLENO.test(v)) lead[k] = v;
    }
    return { lead, invalido: false };
  } catch {
    return { lead: {}, invalido: true };
  }
}

// El bloque de planes, armado con los precios de la consola. Formato del guion:
// «Nombre (USD 25/mes): Hasta 100 conversaciones.»
// COMPACTO: solo nombre, precio y periodo (y «desde» donde corresponde). Es lo
// que sale cuando el mensaje con boton no entra en el limite: se pierde lo que
// incluye cada plan, nunca un precio.
function bloquePlanes(ent, compacto) {
  const planes = Array.isArray(ent.planes) ? ent.planes : [];
  const cargos = Array.isArray(ent.cargosUnicos) ? ent.cargosUnicos : [];
  if (!planes.length) return '';
  const lineas = ['*Planes*'];
  for (const p of planes) {
    lineas.push(p.nombre + ' (USD ' + monto(p.precioUsd) + (SUFIJO[p.periodo] ?? '') + ')' +
      (!compacto && p.incluye ? ': ' + punto(p.incluye) : '.'));
  }
  if (cargos.length) {
    lineas.push('', '*Cargos únicos*');
    for (const c of cargos) {
      lineas.push(c.nombre + ' (pago único): ' + (c.desde ? 'desde ' : '') + 'USD ' + monto(c.precioUsd) +
        (!compacto && c.detalle ? '. ' + punto(c.detalle) : '.'));
    }
  }
  lineas.push('', 'Precios en dólares; se cobran en bolivianos al tipo de cambio oficial del BCB.');
  return lineas.join('\n');
}

// El texto del turno: el del modelo -- con la marca de los planes -- y el bloque
// que le toca. El mensaje de los planes termina siempre con la pregunta por el
// especialista, la haya escrito el modelo o no. Es una funcion y no dos lineas
// sueltas porque el texto se vuelve a armar con el bloque compacto o con el
// texto recortado cuando no entra en el limite.
const PREGUNTA_ESPECIALISTA = '¿Te gustaría hablar con un especialista?';
function armar(conMarca, bloque) {
  if (!bloque) return conMarca.replace(/\u0002/g, '').replace(/\n{3,}/g, '\n\n').trim();
  let t = conMarca.replace('\u0002', '\n' + bloque + '\n').replace(/\u0002/g, '');
  const cola = t.slice(t.lastIndexOf(bloque) + bloque.length);
  if (!/\?/.test(cola)) t = t.trimEnd() + '\n\n' + PREGUNTA_ESPECIALISTA;
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

// Recorta por palabras y cierra con «…»: una palabra cortada por la mitad se
// lee como un error del asistente.
function recortar(t, max) {
  if (t.length <= max) return t;
  if (max < 2) return '';
  const corte = t.slice(0, max - 1);
  const hasta = corte.search(/\s+\S*$/);
  return (hasta > 0 ? corte.slice(0, hasta) : corte).trimEnd().replace(/[,;:.\-]+$/, '') + '…';
}

// PISO DEL TEXTO DEL MODELO. Por debajo de estos caracteres el envoltorio deja
// de ser un mensaje: 150 son dos oraciones cortas -- la frase que presenta el
// bloque y la pregunta del final --, que es el minimo para que los precios
// lleguen dentro de algo dicho por alguien. Si con el texto en el piso el
// mensaje sigue sin entrar, NO se recorta mas: se resume el bloque, que aun
// resumido conserva todos los precios.
const PISO_TEXTO = 150;

// Arma el texto contra un bloque dado y, si no entra en el limite, recorta solo
// el texto del modelo -- lo de antes y lo de despues del bloque --, por
// palabras y empezando por la porcion mas larga (casi siempre el enganche que
// va antes de los precios), para no perder entera la frase del final. El bloque
// NO se toca. Nunca baja del piso: lo que falte lo resuelve quien llama,
// resumiendo el bloque.
function ajustar(conMarca, bloque, limite, piso) {
  const entero = armar(conMarca, bloque);
  if (entero.length <= limite) return { texto: entero, recortado: false };
  const k = conMarca.indexOf('\u0002');
  let pre = k >= 0 ? conMarca.slice(0, k) : conMarca;
  let post = k >= 0 ? conMarca.slice(k + 1) : '';
  const rehacer = () => armar(pre + '\u0002' + post, bloque);
  // Lo que se puede quitar sin bajar del piso.
  let margen = Math.max(0, pre.length + post.length - piso);
  for (const cual of pre.length >= post.length ? ['pre', 'post'] : ['post', 'pre']) {
    const sobra = Math.min(rehacer().length - limite, margen);
    if (sobra <= 0) break;
    if (cual === 'pre' && pre.trim()) {
      const antes = pre.length; pre = recortar(pre, pre.length - sobra); margen -= antes - pre.length;
    }
    if (cual === 'post' && post.trim()) {
      const antes = post.length; post = recortar(post, post.length - sobra); margen -= antes - post.length;
    }
  }
  const texto = rehacer();
  return { texto, recortado: texto.length < entero.length };
}

// =============================================================================
// LO QUE EL PROMPT NO GARANTIZA Y EL CODIGO SI (Andres, 27/09/2026)
// =============================================================================
// Tres fallas leidas en n8n, las tres con la regla ya escrita en el prompt:
//   #4160 (21/09) «Veo que la empresa se llama La Colmena, y por el nombre
//         parece ser una pasteleria; si me equivoque, dime 🧁.» y debajo
//         «1. Salud y Belleza / 2. Gastronomia / … / 5. Otro / a medida», sin
//         ninguna instruccion: una deduccion afirmada, un menu numerado y un
//         mensaje que termina en punto.
//   #4817 (23/09) tras el boton de la bienvenida mostro de una los planes de
//         gastronomia -- un rubro arrastrado de la memoria del chat anterior --
//         sin pedir nombre, empresa ni rubro.
// Como el candado de las citas, esto se hace cumplir por lo que el modelo HIZO
// (la lista que escribio, el rubro que mando en [LEAD], la marca [PLANES]), no
// por lo que se le pidio:
//   a. una ENUMERACION de los rubros de la consola (numerada o con viñetas) se
//      reescribe como areas en una linea, sin numerar, sin el rubro «a medida»,
//      con la salida abierta y terminando en pregunta;
//   b. un rubro que el modelo DEDUJO -- el que manda en [LEAD] sin que el
//      cliente lo haya dicho -- no se registra: se guarda como deduccion y el
//      mensaje pide confirmarla con una pregunta. «si me equivoque, dime.» no
//      es una pregunta y se quita;
//   c. los planes (el bloque que arma el flujo) y los precios que haya escrito
//      el modelo no salen mientras la ficha del telefono no tenga empresa y
//      rubro: en su lugar sale la pregunta por lo que falta. La ficha es la de
//      los datos estaticos; lo que el modelo recuerde de otra ventana no cuenta.
// Y dos del 27/09 que tampoco dependen del modelo:
//   d. el primer mensaje de la ventana se presenta como asistente virtual con
//      inteligencia artificial y pide nombre y empresa, terminando en pregunta;
//   e. a quien dice que ya es cliente o pide soporte no se le piden datos de
//      prospecto, y su respuesta sale con el boton «Hablar con un asesor».
// Y seis de la prueba real del 27/09 (ejecuciones #6619 a #6648, dos telefonos):
//   1. #6627 «Soy Andrés Rojas, pediatra»: el modelo mando rubro «pediatría»
//      y el codigo lo descarto porque no estaba LETRA POR LETRA en el mensaje.
//      Ahora vale lo que el cliente dijo con otra forma de la misma palabra
//      (raiz comun de 5 letras o mas, sin tildes) o nombrando el oficio
//      («dentista» -> odontologia). Lo deducido del NOMBRE DE LA EMPRESA sigue
//      sin valer: las palabras de la empresa y del contacto no cuentan.
//   2. #6627 pidio el nombre del consultorio Y el codigo le sumo la lista con
//      «¿a que se dedica?»; #6640 el modelo ya preguntaba el rubro y la marca
//      [RUBROS] le sumo la misma pregunta. UN MENSAJE PIDE UN DATO: si el
//      mensaje pide empresa o nombre, la lista no va; si ya pregunta el rubro,
//      la lista va delante de ESA pregunta, sin una pregunta propia. Nunca dos
//      signos de pregunta sobre el rubro.
//   3. #6635: la respuesta a «¿como se llama tu consultorio?» quedo como rubro.
//      Lo que coincide con la empresa no es un rubro, y el turno recuerda EN
//      ORDEN que datos pidio (`c.pidio`): la respuesta va al primero
//      (`Estado de la conversacion`).
//   4. #6648: rubro «Es una tienda de ropa para niños». Se guarda limpio
//      (`limpiarRubro`, la misma funcion que en `Estado de la conversacion`).
//   5. #6619 y #6623: un parrafo que era solo un emoji. Una linea de solo
//      emojis se une al parrafo anterior, y «¿…? 🏢» cuenta como terminar en
//      pregunta (moverla dejaba el emoji solo).
//   6. Planes con archivo: ver «f» en [PLANES].
// MENSAJES: ninguno de mas. Todo se escribe dentro de la respuesta del turno.

// Texto comparable: sin tildes, sin mayusculas y sin signos.
const plano = (t) => norm(t).replace(/[^a-z0-9ñ]+/g, ' ').trim();
// El mensaje del cliente sin las palabras de su empresa ni de su nombre: lo
// que se deduce de «Salon Rosa» no lo dijo el cliente, lo dice el nombre.
// Se quita el nombre ENTERO donde aparece, no sus palabras sueltas: asi
// «tenemos un salon de belleza», de Salon Rosa, conserva el «salon de belleza»
// que el cliente SI dijo.
function sinNombres(dicho, nombres) {
  let t = ' ' + plano(dicho) + ' ';
  for (const n of nombres) {
    const k = plano(n);
    if (k) t = t.split(' ' + k + ' ').join(' ');
  }
  return t.split(' ').filter(Boolean).join(' ');
}
// 1. Otra forma de la misma palabra: raiz comun de 5 letras o mas
// (pediatra / pediatria). Sin las palabras de relleno, que comparten raiz con
// cualquier cosa («negocio» / «negocios de comida»).
const GENERICAS = new Set(['negocio', 'negocios', 'empresa', 'empresas', 'emprendimiento', 'servicio', 'servicios',
  'trabajo', 'trabajamos', 'nombre', 'llamo', 'quiero', 'queremos', 'necesito', 'gracias', 'buenas', 'buenos',
  'tardes', 'noches', 'informacion', 'planes', 'precio', 'precios', 'consulta', 'asistente', 'whatsapp', 'cliente',
  'clientes', 'atencion', 'tenemos', 'somos', 'hacemos', 'dedico', 'dedicamos', 'tengo', 'ayuda', 'sobre',
  'tambien', 'ahora', 'mucho', 'gusto', 'saber', 'conocer', 'bolivia']);
const raiz = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
// 1. El cliente nombro un oficio y el rubro es ese oficio con otra palabra.
// Solo los pares que no comparten raiz (los otros los cubre la raiz).
const EDUCACION = ['educac', 'clase', 'ensenanza', 'academi', 'colegio', 'escuela', 'tutori', 'capacitac'];
const GASTRONOMIA = ['gastronom', 'restauran', 'comida', 'cocina', 'catering'];
const OFICIOS = [
  [['dentist', 'odontolog'], ['odontolog', 'dental', 'dentist']],
  [['medic', 'doctor', 'pediatr', 'ginecolog', 'cardiolog', 'dermatolog'], ['medic', 'clinic', 'consultorio', 'salud']],
  [['abogad'], ['juridic', 'legal', 'derecho', 'abogad', 'bufete']],
  [['contador'], ['contab', 'contador', 'auditor', 'impuest']],
  [['psicolog', 'terapeut'], ['psicolog', 'terapi', 'salud']],
  [['nutricion'], ['nutric', 'dietet', 'salud']],
  [['veterinari'], ['veterinar', 'mascota']],
  [['estilist', 'peluquer', 'manicur', 'cosmetolog'], ['peluquer', 'estetic', 'belleza', 'salon', 'unas']],
  [['cociner', 'chef'], GASTRONOMIA],
  [['panader', 'pasteler', 'reposter'], ['panader', 'pasteler', 'reposter', ...GASTRONOMIA]],
  [['mecanic'], ['mecanic', 'taller', 'automotr']],
  [['arquitect'], ['arquitect', 'construc']],
  [['profesor', 'profesora', 'maestro', 'maestra', 'docente', 'tutor'], EDUCACION],
  [['kinesiolog', 'fisioterapeut'], ['kinesiolog', 'fisioterap', 'rehabilit', 'salud']],
  [['enfermer'], ['enfermer', 'salud']],
  [['costurer', 'sastre', 'modist'], ['costur', 'confecc', 'ropa', 'sastrer', 'modist']],
  [['carpinter'], ['carpinter', 'mueble']],
  [['plomer', 'gasfiter'], ['plomer', 'gasfiter']],
];
// UNA MENCION NO ES EL NEGOCIO (revision de seguridad del PR #238, L3): «no
// vendo ropa», «mi mama es medica». La palabra no cuenta si la precede un «no»
// (hasta dos palabras antes) o un pariente (hasta tres).
const PARIENTES = new Set(['mama', 'papa', 'madre', 'padre', 'hijo', 'hija', 'hijos', 'hijas', 'esposo', 'esposa',
  'marido', 'mujer', 'hermano', 'hermana', 'tio', 'tia', 'abuelo', 'abuela', 'primo', 'prima', 'novio', 'novia',
  'suegro', 'suegra', 'cunado', 'cunada', 'amigo', 'amiga']);
function ajena(palabras, k) {
  const antes = palabras.slice(Math.max(0, k - 3), k);
  return antes.slice(-2).some((p) => p === 'no' || p === 'nunca' || p === 'ni') || antes.some((p) => PARIENTES.has(p));
}
// ¿El rubro lo nombro el cliente, aunque con otra forma? `suyo` es el mensaje
// ya sin los nombres propios (`sinNombres`). La RAIZ COMUN (pediatra /
// pediatria) vale solo en la respuesta a la pregunta por el rubro (`conRaiz`):
// en cualquier otro mensaje una palabra parecida es una mencion («mi
// farmaceutico me recomendo»), no el negocio. La palabra entera y el oficio
// de la tabla valen siempre, salvo que sean ajenos.
function loNombro(rubro, suyo, conRaiz) {
  const deEl = suyo.split(' ').filter(Boolean);
  const k = plano(rubro).split(' ').filter(Boolean);
  if (k.join(' ').length >= 3) {
    for (let i = 0; i + k.length <= deEl.length; i++) {
      if (deEl.slice(i, i + k.length).join(' ') === k.join(' ') && !ajena(deEl, i)) return true;
    }
  }
  const larga = (p) => p.length >= 5 && !GENERICAS.has(p);
  const delRubro = k.filter(larga);
  if (conRaiz && deEl.some((s, i) => larga(s) && !ajena(deEl, i) && delRubro.some((r) => raiz(r, s) >= 5))) return true;
  return OFICIOS.some(([oficios, campos]) => deEl.some((s, i) => !ajena(deEl, i) && oficios.some((o) => s.startsWith(o)))
    && [...campos, ...oficios].some((c) => k.some((p) => p.startsWith(c))));
}

// 4. EL RUBRO SE GUARDA LIMPIO (#6648: «Es una tienda de ropa para niños»).
// Se quita al principio «es un/una», «somos», «tengo/tenemos un/una», «me
// dedico a», «trabajo en» y la puntuacion del final; «vendo ropa» queda
// «venta de ropa». Lo que no empieza asi no se toca. MISMA FUNCION, letra por
// letra, que en `Estado de la conversacion` (la prueba lo verifica): el rubro
// que registra el codigo y el que manda el modelo se escriben igual.
function limpiarRubro(v) {
  const original = String(v ?? '').replace(/\s+/g, ' ').trim();
  let t = original
    .replace(/^[\s¡¿"'«]+/u, '')
    .replace(/[\s.,;:!¡?¿…"'»\p{Extended_Pictographic}‍️]+$/u, '')
    .trim();
  const ART = '(?:un|una|unos|unas|el|la|los|las)\\s+';
  const PREFIJOS = [
    new RegExp('^(?:(?:mi|nuestro|nuestra)\\s+(?:negocio|empresa|emprendimiento)\\s+)?(?:es|son|somos)\\s+(?:' + ART + ')?', 'i'),
    new RegExp('^(?:tengo|tenemos)\\s+' + ART, 'i'),
    new RegExp('^(?:me\\s+dedico|nos\\s+dedicamos)\\s+(?:a|al)\\s+(?:' + ART + ')?', 'i'),
    new RegExp('^(?:trabajo|trabajamos)\\s+en\\s+(?:' + ART + ')?', 'i'),
  ];
  const vende = t.match(/^(?:vendo|vendemos)\s+(.+)$/i);
  if (vende) t = 'venta de ' + vende[1].replace(new RegExp('^' + ART, 'i'), '');
  else {
    const re = PREFIJOS.find((p) => p.test(t));
    if (re) t = t.replace(re, '');
  }
  t = t.trim();
  return t.length >= 2 ? t : original;
}

// 5. Los emojis de un mensaje. Una pregunta seguida de emojis («¿…? 🏢")
// TERMINA en pregunta: tratarla como si no dejo el emoji solo en #6619.
const EMOJIS = '\\p{Extended_Pictographic}\\p{Emoji_Modifier}\\p{Regional_Indicator}\\u200d\\ufe0f\\u20e3';
const SOLO_EMOJIS = new RegExp('^[\\s' + EMOJIS + ']+$', 'u');
const FIN_PREGUNTA = new RegExp('\\?[\\s' + EMOJIS + ']*$', 'u');
const terminaEnPregunta = (t) => FIN_PREGUNTA.test(String(t));
// Una linea que solo tiene emojis se une a la ultima linea con texto; si no
// hay ninguna antes, se quita. Sin dejar lineas vacias dobles.
function sinEmojisSueltos(t) {
  const lineas = [];
  for (const l of String(t).split('\n')) {
    if (l.trim() && SOLO_EMOJIS.test(l)) {
      let k = lineas.length - 1;
      while (k >= 0 && !lineas[k].trim()) k--;
      if (k >= 0) { lineas[k] = lineas[k].trimEnd() + ' ' + l.trim(); lineas.length = k + 1; }
      continue;
    }
    lineas.push(l);
  }
  return lineas.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// a. Una linea de lista: «1. X», «2) X», «- X», «• X». El texto del item se
// compara sin lo que venga despues de «:» o de « - » (la descripcion).
const ITEM = /^\s*(?:\d{1,2}\s*[.)\-:]|[-•*·◦▪])\s*(.+?)\s*$/;
function esNombreDeRubro(texto, rubros) {
  const t = plano(String(texto).replace(/[*_~]/g, '').split(/:|\s[-–—]\s/)[0]);
  if (!t) return false;
  if (/(^|\s)(a medida|otro|otros)(\s|$)/.test(t)) return true;
  return rubros.some((r) => plano(r.nombre) === t || plano(r.id) === t);
}
// Devuelve el texto con la enumeracion reemplazada por la marca de rubros
// (\u0001) en el lugar del primer item, o null si no hay enumeracion.
function sinEnumeracion(t, rubros) {
  const lineas = t.split('\n');
  const items = [];
  lineas.forEach((l, k) => { const m = l.match(ITEM); if (m && esNombreDeRubro(m[1], rubros)) items.push(k); });
  if (items.length < 2) return null;
  return lineas.map((l, k) => (k === items[0] ? '\u0001' : l))
    .filter((_, k) => k === items[0] || !items.includes(k)).join('\n');
}

// b. Formas de decir una deduccion. Es la red SECUNDARIA: la principal es el
// hecho -- un rubro en [LEAD] que el cliente no dijo --.
const DEDUCE = /(por\s+el\s+nombre|parece\s+ser\s+(una?\s|el\s|la\s|de\s)|veo\s+que\s+(es|son)\s+(una?\s|el\s|la\s|de\s)|deduzco|si\s+me\s+equivoqu)/i;
const SI_ME_EQUIVOQUE = /[,;:]?\s*(y\s+)?si\s+me\s+equivoqu[eé][^.!?\n]*/gi;
// La deduccion se pregunta UNA vez (regla 2: nunca dos signos de pregunta
// sobre el rubro). Si el texto ya pregunta el rubro, o la oracion que deduce
// ya es una pregunta, no se toca. Si no, la pregunta va al final -- pegada a la
// deduccion cuando es lo ultimo del mensaje -- y las areas de referencia, si
// van, delante de ella y sin pregunta propia (`referencia`).
function conConfirmacion(t, rubro, referencia) {
  if (datosPedidos(t).includes('rubro')) return t;
  const confirma = rubro ? '¿Tu negocio es de ' + rubro + ', o a qué se dedica?' : '¿Acerté, o a qué se dedica tu negocio?';
  const pre = referencia ? referencia + ' ' : '';
  let k = -1;
  const m = t.match(DEDUCE);
  if (m) k = m.index;
  else if (rubro) { const i = norm(t).indexOf(norm(rubro)); if (i >= 0) k = i; }
  if (k < 0) {
    const cola = rubro ? confirma : '¿A qué se dedica tu negocio?';
    return t.trimEnd() + (t.trim() ? '\n\n' : '') + pre + cola;
  }
  const resto = t.slice(k);
  const fin = resto.search(/[.!?…](\s|$)|\n/);
  const corte = fin < 0 ? t.length : k + fin + (/[.!?…]/.test(resto[fin]) ? 1 : 0);
  if (t[corte - 1] === '?') return t;
  const antes = t.slice(0, corte).trimEnd();
  const despues = t.slice(corte).trim();
  const sep = /[.!…]$/.test(antes) ? ' ' : '. ';
  // Despues de la deduccion el modelo pregunta OTRA cosa: la confirmacion
  // queda pegada a la deduccion, corta.
  if (/\?/.test(despues)) return antes + sep + '¿Es así?' + t.slice(corte);
  if (!despues && !referencia) return antes + sep + '¿Es así, o a qué se dedica tu negocio?';
  return (antes + (despues ? ' ' + despues : '')).trimEnd() + '\n\n' + pre + confirma;
}

// c. Una oracion con un precio.
const PRECIO = /(USD|US\$|\$us|\$\s?\d|\d+([.,]\d+)?\s*(d[oó]lares|bs\.?|bolivianos))/i;
function sinPrecios(t) {
  return t.split('\n').map((l) => l.split(/(?<=[.!?…])\s+/).filter((o) => !PRECIO.test(o)).join(' '))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
// Si una pieza quedo en el medio y lo que le sigue no pregunta nada, va al
// final: el mensaje termina en la pregunta.
function alFinal(t, pieza) {
  const k = t.indexOf(pieza);
  if (k < 0) return t;
  if (/\?/.test(t.slice(k + pieza.length))) return t;
  return (t.slice(0, k) + t.slice(k + pieza.length)).replace(/\n{3,}/g, '\n\n').trim() + '\n\n' + pieza;
}
// ¿El texto ya pregunta por esto?
const oraciones = (t) => t.split(/(?<=[.!?…])\s+|\n+/);
const preguntaPor = (t, re) => oraciones(t).some((o) => terminaEnPregunta(o.trim()) && re.test(o));
// 2 y 3. QUE DATOS PIDE UN MENSAJE, EN ORDEN. Solo en las oraciones que
// preguntan, y desde el «¿»: «Gracias por el nombre de tu empresa, ¿a que se
// dedica?» pide el rubro, no la empresa. «¿Me dices tu nombre y el de tu
// empresa?» pide contacto y empresa, en ese orden.
const PIDE = {
  contacto: /(tu\s+nombre|c[oó]mo\s+te\s+llamas|qui[eé]n\s+(eres|me\s+escribe)|con\s+qui[eé]n\s+(hablo|tengo))/i,
  empresa: /(nombre\s+(de|del)\s|el\s+de\s+(tu|su)\s|c[oó]mo\s+se\s+llama)/i,
  rubro: /(dedica|rubro|a\s+qu[eé]\s+se|tipo\s+de\s+(negocio|empresa|emprendimiento)|qu[eé]\s+(hace|hacen|vende|venden|ofrece|ofrecen)\s+(tu|su|tus|sus)\s|de\s+qu[eé]\s+(es|se\s+trata|trata)\s+(tu|su)\s|giro\s+de|actividad|sector)/i,
};
function datosPedidos(t) {
  const hallados = [];
  let desde = 0;
  for (const o of oraciones(String(t))) {
    const k = t.indexOf(o, desde);
    if (k >= 0) desde = k + o.length;
    if (!/\?/.test(o)) continue;
    const i = Math.max(0, o.indexOf('¿'));
    const q = o.slice(i);
    for (const [dato, re] of Object.entries(PIDE)) {
      const m = q.match(re);
      if (m) hallados.push({ dato, pos: Math.max(0, k) + i + m.index });
    }
  }
  return [...new Set(hallados.sort((a, b) => a.pos - b.pos).map((h) => h.dato))];
}
// 2. Las areas de referencia delante de la pregunta por el rubro que ya esta,
// en su propio parrafo: la pregunta es una sola, la del modelo.
function referenciaAntesDeLaPregunta(t, referencia) {
  const q = oraciones(t).filter((o) => /\?/.test(o) && PIDE.rubro.test(o.slice(Math.max(0, o.indexOf('¿'))))).pop();
  if (!q) return t;
  const k = t.lastIndexOf(q);
  return (t.slice(0, k).trimEnd() + '\n\n' + referencia + '\n\n' + t.slice(k)).replace(/\n{3,}/g, '\n\n').trim();
}
// La pregunta que ya estaba, movida al final si el mensaje no termina en ella.
function preguntaAlFinal(t, re) {
  if (terminaEnPregunta(t)) return t;
  const q = oraciones(t).filter((o) => terminaEnPregunta(o.trim()) && re.test(o)).pop();
  if (!q) return t;
  const k = t.lastIndexOf(q);
  return (t.slice(0, k) + t.slice(k + q.length)).replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim() +
    '\n\n' + q.trim();
}

const out = [];
const items = $input.all();
for (let i = 0; i < items.length; i++) {
  // Emparejamiento por indice: nunca .first(), que le pondria el telefono del
  // primer mensaje a todos los items si llegaran dos a la vez.
  const ent = (entradas[i] ?? entradas[entradas.length - 1]).json;
  const bruto = String(items[i].json.output ?? items[i].json.text ?? '').trim();

  const { lead, invalido } = leerLead(bruto);
  const pideCierre = /\[CIERRE\]/i.test(bruto);
  let conRubros = /\[RUBROS\]/i.test(bruto);
  const conPlanes = /\[PLANES\]/i.test(bruto);
  const rubros = Array.isArray(ent.rubros) ? ent.rubros : [];
  const hayPlanes = Array.isArray(ent.planes) && ent.planes.length > 0;
  const archivo = hayPlanes && ent.planesEnArchivo === true && ent.archivoPlanes && ent.archivoPlanes.url
    ? ent.archivoPlanes : null;

  const avisos = [];
  if (invalido) avisos.push('lead_invalido');

  // Lo que el modelo escribe no lleva la oferta: las marcas se reemplazan
  // DESPUES de revisar su texto, para que la correccion de la prohibicion 4 no
  // toque un precio.
  let texto = bruto
    .replace(/\[LEAD\][\s\S]*?\[\/LEAD\]/gi, '')
    .replace(/\[\/?LEAD\]/gi, '')
    .replace(/\[CIERRE\]/gi, '')
    .replace(/\[RUBROS\]/gi, '\u0001')
    .replace(/\[PLANES\]/gi, '\u0002')
    .replace(/\[[A-ZÁÉÍÓÚÑ_ ]{3,30}\]/g, '')
    .trim();
  // 5. Lo que quedo de una marca -- «😊 [LEAD]…» -- no es un parrafo.
  texto = sinEmojisSueltos(texto);

  // --- Prohibicion 4: el agente no niega ser una IA ---------------------
  if (NIEGA_IA.test(texto)) {
    texto = texto.replace(new RegExp(NIEGA_IA.source, 'gi'), 'sí, soy un asistente virtual con inteligencia artificial');
    avisos.push('correccion_ia');
  }

  // --- Un precio que el modelo escribio por su cuenta ---------------------
  // Se anota si no coincide con ningun precio de la consola: es la señal de
  // que el modelo tomo un precio del corpus o lo invento.
  const permitidos = new Set([...(ent.planes ?? []), ...(ent.cargosUnicos ?? [])].map((p) => monto(p.precioUsd)));
  for (const m of texto.matchAll(/(?:USD|US\$|\$us|\$)\s?(\d+(?:[.,]\d{1,2})?)/gi)) {
    if (!permitidos.has(m[1].replace('.', ','))) { avisos.push('precio_fuera_de_la_consola'); break; }
  }

  // --- La ficha del telefono y lo que trae este turno ----------------------
  const c = sd.conversaciones[ent.from];
  const previo = c?.lead ?? ent.leadConocido ?? {};
  const dicho = ent.tipo === 'text' ? String(ent.userInput ?? '') : '';
  // Pidio soporte en este mensaje o antes en la ventana: ya es cliente.
  const soporte = ent.pideSoporte === true || ent.soporteEnVentana === true;
  const cerrada = ent.etapa === 'cerrado' || c?.etapa === 'cerrado';
  // UNA sola condicion para el texto que invita a tocar el boton y para el
  // boton mismo (revision del PR #237, L2): nunca uno sin el otro.
  const botonSoporte = soporte && !cerrada && !(c && c.avisado === true);

  // b. EL RUBRO DEL [LEAD]: registrado solo si el cliente lo dijo en este
  // mensaje -- con esa palabra, con otra forma de ella o nombrando el oficio
  // (regla 1) -- o si confirmo la deduccion del turno anterior. Si no, es una
  // deduccion del modelo y queda a la espera de confirmacion. Lo que dice el
  // nombre de la empresa no lo dijo el cliente, y un rubro igual a la empresa
  // no es un rubro (regla 3, #6635).
  const esArea = (v) => rubros.some((r) => plano(r.nombre) === plano(v));
  const empresaTurno = lead.empresa || previo.empresa || '';
  const esLaEmpresa = (v) => !!plano(empresaTurno) && plano(v) === plano(empresaTurno);
  let rubroModelo = lead.rubro ? limpiarRubro(lead.rubro) : undefined;
  if (rubroModelo && esLaEmpresa(rubroModelo)) { rubroModelo = undefined; avisos.push('rubro_igual_a_la_empresa'); }
  const areaModelo = lead.area;
  delete lead.rubro;
  delete lead.area;
  const suyo = sinNombres(dicho, [empresaTurno, lead.contacto || previo.contacto || '']);
  // ¿Este mensaje respondia a la pregunta por el rubro? (L3). Un estado de
  // antes del 27/09 no trae `pidio`: ahi vale `pidioRubro`.
  const respondeAlRubro = !!c && (Array.isArray(c.pidio) && c.pidio.length ? c.pidio[0] === 'rubro' : c.pidioRubro === true);
  let deducido = null;
  if (rubroModelo) {
    if (loNombro(rubroModelo, suyo, respondeAlRubro) || (ent.confirmoRubro === true && !previo.rubro)) {
      lead.rubro = rubroModelo;
      if (areaModelo) lead.area = areaModelo;
    } else if (previo.rubro) {
      // Con el rubro ya registrado, el modelo solo puede ubicarlo en un area.
      if (esArea(rubroModelo)) lead.area = rubroModelo;
      else if (areaModelo) lead.area = areaModelo;
    } else {
      deducido = { rubro: rubroModelo.slice(0, 60), area: areaModelo ? areaModelo.slice(0, 60) : '' };
    }
  } else if (areaModelo && previo.rubro) {
    lead.area = areaModelo;
  }
  const combinado = { ...previo, ...lead };
  delete combinado.nit;

  // --- [RUBROS]: areas de referencia, NO un menu de servicios --------------
  // Decision de Andres del 22/09/2026: en linea, sin numerar, sin el rubro «a
  // medida» -- no es un area, es la ausencia de una -- y con la salida
  // explicita. TERMINA EN PREGUNTA: este flujo existe para LLENAR UNA FICHA, y
  // una enumeracion que termina en punto es un anuncio, que no se contesta.
  // Separadas por comas y sin «y» final: los nombres de rubro ya traen su
  // propia «y» («Salud y belleza»).
  //
  // UN MENSAJE PIDE UN DATO (regla 2, #6627 y #6640). La lista va:
  //  - con su pregunta, donde el modelo puso la marca, si el mensaje no pide
  //    otro dato;
  //  - SIN pregunta propia (`referencia`) delante de la pregunta por el rubro,
  //    si el mensaje ya la hace;
  //  - nunca si el mensaje pide la empresa o el nombre: ese es el dato del turno.
  const esAMedida = (r) => /medida|^otro/i.test(String(r.id) + ' ' + String(r.nombre));
  const areas = rubros.filter((r) => !esAMedida(r)).map((r) => r.nombre);
  const ejemplos = areas.length ? 'Trabajamos con negocios de todo tipo, por ejemplo ' + areas.join(', ').toLowerCase() : '';
  const listaRubros = ejemplos ? ejemplos + '. Si lo tuyo no está en esa lista, cuéntamelo igual: ¿a qué se dedica tu negocio?' : '';
  const referencia = ejemplos ? ejemplos + '. Si lo tuyo no está en esa lista, igual te podemos ayudar.' : '';

  // a. La lista que el modelo escribio por su cuenta se trata como la marca.
  const reescrito = sinEnumeracion(texto, rubros);
  if (reescrito !== null) {
    texto = reescrito;
    conRubros = true;
    avisos.push('rubros_reescritos_en_linea');
  }

  // b. ¿Hay una deduccion sin confirmar en este mensaje? Por el hecho (un
  // rubro en [LEAD] que el cliente no dijo) o, como red, por la forma. Solo
  // con la empresa sabida: se deduce del nombre de la empresa, y un rubro sin
  // empresa viene de otra parte -- la memoria de otra ventana, #4817 -- y se
  // descarta.
  if (deducido && !combinado.empresa) { deducido = null; avisos.push('rubro_del_modelo_descartado'); }
  const deduce = !combinado.rubro && !soporte && !!combinado.empresa && (deducido !== null || DEDUCE.test(texto));

  // c. Los planes y los precios, solo con la ficha.
  const fichaLista = !!combinado.empresa && !!combinado.rubro;
  const planesMostrados = conPlanes && fichaLista;
  let retenidos = false;
  if (conPlanes && !fichaLista) {
    texto = texto.replace(/\u0002/g, '');
    retenidos = true;
    avisos.push('planes_retenidos_sin_ficha');
  }
  if (!fichaLista && PRECIO.test(texto.replace(/[\u0001\u0002]/g, ''))) {
    texto = sinPrecios(texto);
    retenidos = true;
    avisos.push('precios_retenidos_sin_ficha');
  }

  // Lo que el texto del modelo ya pide, en orden, sin contar la marca.
  const pedidosModelo = datosPedidos(texto.replace(/[\u0001\u0002]/g, ''));
  const pideNombre = pedidosModelo.includes('contacto') || pedidosModelo.includes('empresa');
  const pideRubro = pedidosModelo.includes('rubro');

  // b. La deduccion se pregunta. «si me equivoqué, dime.» no es una pregunta.
  // Va ANTES de poner las areas, para que la palabra del rubro se busque en lo
  // que escribio el modelo y no en la lista. Con la marca, las areas van sin
  // pregunta propia, delante de la confirmacion, que es la unica pregunta.
  if (deduce) {
    const antes = texto;
    const conMarcaRubros = texto.includes('\u0001') && !!referencia && !pideNombre;
    texto = texto.replace(SI_ME_EQUIVOQUE, '').replace(/[ \t]+([.!?…])/g, '$1')
      .replace(/\u0001/g, '').replace(/\n{3,}/g, '\n\n').trim();
    const yaPregunta = datosPedidos(texto).includes('rubro');
    texto = conConfirmacion(texto, deducido ? deducido.rubro : '', conMarcaRubros ? referencia : '');
    if (conMarcaRubros && yaPregunta) texto = referenciaAntesDeLaPregunta(texto, referencia);
    if (texto !== antes.replace(/\u0001/g, '').trim()) avisos.push('deduccion_con_pregunta');
  }

  // Las areas donde el modelo puso la marca (o la lista), segun la regla 2.
  if (texto.includes('\u0001')) {
    if (!listaRubros || pideNombre || soporte || combinado.rubro) {
      texto = texto.replace(/\u0001/g, '');
      if (listaRubros && pideNombre) avisos.push('rubros_omitidos_pide_otro_dato');
    } else if (pideRubro) {
      texto = referenciaAntesDeLaPregunta(texto.replace(/\u0001/g, ''), referencia);
      avisos.push('rubros_antes_de_la_pregunta');
    } else {
      texto = texto.replace('\u0001', '\n' + listaRubros + '\n').replace(/\u0001/g, '');
    }
    texto = texto.replace(/\n{3,}/g, '\n\n').trim();
  }

  // La pregunta por lo que falta. Una sola, y solo si el texto no la hace ya:
  //  - en el primer mensaje de la ventana y cuando se retuvieron los planes,
  //    el nombre y la empresa (d y c);
  //  - con los planes retenidos y la empresa sabida, el rubro (c);
  //  - LA RED DE SIEMPRE: sabida la empresa o el nombre, sin rubro, sin
  //    deduccion y sin la marca, las areas de referencia. Medido el 22/09/2026:
  //    el modelo pone [RUBROS] en el 83 % de los turnos, y en el 93 % con la
  //    indicacion del turno; el resto es un prospecto al que habria que volver
  //    a preguntarle. DESDE EL 27/09 (regla 2) la red no suma una segunda
  //    pregunta: si el mensaje ya pregunta el rubro, las areas van delante de
  //    esa pregunta; si no pregunta nada, van con la suya; si pide la empresa,
  //    el nombre u otra cosa, no van.
  const PIDE_EMPRESA = /(empresa|negocio|emprendimiento|nombre|llamas)/i;
  const faltanDatos = !combinado.empresa;
  let agregado = '';
  if (!soporte && !cerrada && faltanDatos && (ent.primeraDeVentana === true || retenidos)
      && !preguntaPor(texto, PIDE_EMPRESA)) {
    const q = !combinado.contacto ? '¿me dices tu nombre y el de tu empresa?' : '¿cómo se llama tu empresa?';
    agregado = retenidos ? 'Para mostrarte los planes que le sirven a tu negocio, ' + q
      : q.charAt(0).toUpperCase() === '¿' ? '¿' + q.charAt(1).toUpperCase() + q.slice(2) : q;
    avisos.push('pide_empresa_por_codigo');
  } else if (!soporte && !cerrada && !deduce && !combinado.rubro && retenidos
      && !conRubros && !pideRubro && !pideNombre) {
    agregado = 'Para mostrarte los planes que le sirven a tu negocio, necesito saber a qué se dedica.' +
      (listaRubros ? '\n' + listaRubros : ' ¿Me cuentas?');
    avisos.push('pide_rubro_por_codigo');
  } else if (!soporte && !cerrada && !deduce && !conRubros && listaRubros && !combinado.rubro
      && (combinado.empresa || combinado.contacto) && !pideNombre) {
    if (pideRubro) {
      texto = referenciaAntesDeLaPregunta(texto, referencia);
      avisos.push('rubros_agregados_por_codigo');
    } else if (!/\?/.test(texto)) {
      agregado = listaRubros;
      avisos.push('rubros_agregados_por_codigo');
    }
  }
  if (agregado) texto = texto.trimEnd() + (texto.trim() ? '\n\n' : '') + agregado;
  if (listaRubros && texto.includes(listaRubros)) texto = alFinal(texto, listaRubros);
  // El mensaje que pide un dato termina en esa pregunta.
  if (!soporte && !cerrada && faltanDatos && (ent.primeraDeVentana === true || retenidos)) {
    texto = preguntaAlFinal(texto, PIDE_EMPRESA);
  }
  if (deduce && !terminaEnPregunta(texto)) {
    const movida = preguntaAlFinal(texto, /(es\s+as[ií]|dedica|acert)/i);
    texto = movida !== texto ? movida : texto.trimEnd() + '\n\n¿Es así, o a qué se dedica tu negocio?';
  }

  // d. El primer mensaje de la ventana dice que es una IA (prohibicion 4, y la
  // presentacion del 27/09). Si el modelo no lo dijo, se agrega.
  if (ent.primeraDeVentana === true && !/inteligencia\s+artificial|\bIA\b/i.test(texto)) {
    const k = texto.search(/asistente\s+virtual/i);
    if (k >= 0) {
      const fin = k + texto.slice(k).match(/asistente\s+virtual/i)[0].length;
      texto = texto.slice(0, fin) + ' con inteligencia artificial' + texto.slice(fin);
    } else {
      texto = '¡Hola! Soy ' + (ent.presentacion || 'el asistente virtual') + ', con inteligencia artificial.' +
        (texto ? ' ' + texto : '');
    }
    avisos.push('presentacion_ia_agregada');
  }

  // e. Soporte: la salida es un asesor, y el mensaje lo ofrece.
  if (botonSoporte && !/(asesor|especialista|una\s+persona)/i.test(texto)) {
    texto = texto.trimEnd() + (texto.trim() ? '\n\n' : '') + '¿Quieres hablar con un asesor? Toca el botón.';
  }

  // 5. Al final, que ningun emoji quede solo en su linea.
  texto = sinEmojisSueltos(texto);

  // QUE SE PREGUNTO, EN ORDEN (regla 3). Lo que el cliente conteste en el
  // proximo turno lo registra `Estado de la conversacion`, por codigo, en el
  // PRIMER dato que pidio este mensaje: si fue la empresa, la respuesta no es
  // el rubro (#6635). Un mensaje que no pide nada no borra lo pendiente.
  const pedidos = datosPedidos(texto);
  if (c) {
    if (pedidos.length) c.pidio = pedidos;
    if (deducido) c.rubroDeducido = deducido;
    if (combinado.rubro) { delete c.rubroDeducido; c.confirmaRubro = false; c.pidioRubro = false; }
    else if (deduce) { c.pidioRubro = true; c.confirmaRubro = true; c.pidio = ['rubro']; }
    else if (pedidos[0] === 'rubro') { c.pidioRubro = true; c.confirmaRubro = false; delete c.rubroDeducido; }
    else if (pedidos.length) { c.pidioRubro = false; }
  }

  // --- [PLANES]: el bloque armado por codigo --------------------------------
  // `conMarca` -- lo que escribio el modelo, con la marca de los planes -- y
  // `bloqueLargo` se guardan: con ellos se vuelve a armar el texto si hay que
  // compactarlo para que el boton entre (ver el encabezado).
  //
  // f. LOS PLANES EN ARCHIVO (Andres, 27/09/2026). Con un archivo de planes
  // valido en la consola (`archivo`), los planes salen en ese archivo aunque
  // sean 5 o menos: el mensaje es UN interactivo con la imagen o el PDF de
  // encabezado, un cuerpo corto y el boton. El cuerpo no lleva la lista, ni
  // los cargos unicos, ni la aclaracion de la moneda -- estan en el archivo --,
  // y una oracion con un precio que haya escrito el modelo se quita: un precio
  // en texto que no coincide con la imagen es peor que ninguno. Si Meta rechaza
  // el interactivo, el respaldo en texto lleva el enlace del archivo. CERO
  // mensajes de mas: el archivo viaja en el mismo mensaje.
  const conArchivo = planesMostrados && hayPlanes && !!archivo;
  let conMarca = texto;
  if (conArchivo && PRECIO.test(conMarca.replace(/[\u0001\u0002]/g, ''))) {
    conMarca = sinPrecios(conMarca);
    avisos.push('precios_del_modelo_en_el_archivo');
  }
  const enElArchivo = archivo && archivo.tipo === 'imagen' ? 'en la imagen' : 'en el documento';
  const bloqueLargo = !planesMostrados ? ''
    : !hayPlanes ? 'Los precios te los confirma un asesor de ' + (ent.nombreNegocio || 'NovuChat') + '.'
    : conArchivo ? 'Te comparto los planes y sus precios ' + enElArchivo + '.'
    : bloquePlanes(ent, false);
  // El mismo mensaje sin el archivo encima: el enlace en el texto.
  const bloqueEnlace = conArchivo ? 'Te comparto los planes y sus precios en este enlace: ' + archivo.url : '';
  texto = armar(conMarca, bloqueLargo);

  if (!texto) {
    texto = 'Disculpa, no pude generar la respuesta. ¿Me lo repites?';
    avisos.push('respuesta_vacia');
  }

  // --- Datos del prospecto: se acumulan en la conversacion ----------------
  // `flujos` se deduce del rubro, cuando el rubro es uno de la lista. `area` la
  // manda el modelo cuando el negocio encaja en una de la lista: en `rubro`
  // queda lo que dijo el cliente («pastelería»), en `area` la de la lista
  // («Gastronomía»). Sin `area`, se intenta por nombre exacto y despues por
  // subcadena, que cubre «salón de belleza» contra «Salud y belleza».
  const claveArea = combinado.area || combinado.rubro;
  if (claveArea && (lead.rubro || lead.area || !combinado.flujos)) {
    const k = norm(claveArea);
    const r = rubros.find((x) => norm(x.nombre) === k || norm(x.id) === k)
      ?? rubros.find((x) => k.includes(norm(x.nombre)) || norm(x.nombre).includes(k));
    if (r && r.flujoSugerido) combinado.flujos = r.flujoSugerido;
  }
  const cambios = Object.keys(combinado).filter((k) => previo[k] !== combinado[k]);
  const completo = OBLIGATORIOS.every((k) => combinado[k]);
  const cierre = pideCierre && completo;
  if (pideCierre && !cierre) avisos.push('cierre_sin_datos');
  const avisar = cierre && !(c?.avisado);

  if (c) {
    c.lead = combinado;
    // `c.avisado` NO se marca aca: lo marca `Confirmar envio` cuando Meta acepto
    // la plantilla. Marcado al decidirlo, un aviso rechazado dejaba al prospecto
    // por avisado y sin boton para siempre.
    if (cierre) c.etapa = 'cerrado';
  }

  // --- El boton «Hablar con un asesor» -------------------------------------
  const yaCerrado = cierre || c?.etapa === 'cerrado' || ent.etapa === 'cerrado';
  // Cerrado, pero con el aviso sin confirmar y sin uno saliendo en este turno:
  // la salida hacia una persona se sigue ofreciendo en cada respuesta.
  const cerradoSinAviso = !avisar && !!c && c.etapa === 'cerrado' && c.avisado !== true;
  // SOLO SE OFRECE LO QUE SE CUMPLE (politica de NovuChat, 21/09/2026). Si el
  // texto remite a un asesor o promete que alguien le va a responder, y en este
  // turno no sale el aviso a una persona, el mensaje lleva el boton: es la unica
  // forma de que esa promesa se cumpla. Una pregunta no promete nada.
  const PROMESA = /(consult|averigu|pregunt|verific|revis|coordin)[a-záéíóúñ]*\s+(lo\s+|eso\s+)?(con|a)\s+(recepci|la\s+cl[ií]nica|el\s+equipo|el\s+personal|(el|la)\s+(doctor|doctora|dr|dra)(?![a-záéíóúñ])|administraci|caja|alguien|una\s+persona|la\s+empresa|el\s+negocio|mis\s+compa)|(te|le)\s+(avis|escrib|llam|contact|confirm|mand|env[ií]|respond)[a-záéíóúñ]*\s+(luego|despu[eé]s|m[aá]s\s+tarde|ma[ñn]ana|en\s+cuanto|apenas|pronto|en\s+un\s+rato|en\s+breve|a\s+la\s+brevedad)|(te|le)\s+(avisar|escribir|llamar|contactar|confirmar|responder)([eé]|[aá]n?)(?![a-záéíóúñ])|voy\s+a\s+(consultar|averiguar|preguntar|avisar|escribir|llamar|contactar|confirmar)/i;
  const REMITE_ASESOR = /(asesor|especialista|una\s+persona\s+del\s+equipo)[^.!?\n]{0,40}(confirm|respond|escrib|contact|llam|avis|ayud|explic|cotiz)|(te|le)\s+(paso|pongo|comunico)\s+con/i;
  const prometeSinAviso = !avisar && texto.split(/(?<=[.!?…])\s+|\n+/)
    .some((o) => o.trim() && !/\?\s*$/.test(o.trim()) && (PROMESA.test(o) || REMITE_ASESOR.test(o)));
  if (prometeSinAviso) avisos.push('promesa_con_boton_asesor');
  const conBoton = cerradoSinAviso || (prometeSinAviso && !(c && c.avisado === true))
    || botonSoporte
    || (!yaCerrado && (planesMostrados || ent.finBloque === true || (pideCierre && !cierre)));

  // --- Que el boton sobreviva al limite de Meta ----------------------------
  // Ver el encabezado: primero el texto del modelo recortado, despues -- solo
  // si ni asi entra -- el bloque de planes resumido, y recien entonces se
  // resigna el boton (en `Salida`).
  const limite = Number(ent.limiteInteractivo) || 0;
  if (conBoton && limite > 0 && texto.length > limite) {
    // 1. El envoltorio: lo que escribio el modelo, por palabras y sin bajar del
    //    piso. Los precios y el detalle de cada plan quedan intactos.
    let pasos = [];
    let intento = ajustar(conMarca, bloqueLargo, limite, PISO_TEXTO);
    if (intento.recortado) pasos.push('texto_recortado');
    // 2. Recien ahora los planes, sin lo que incluye cada uno ni el detalle de
    //    cada cargo. Solo cuando el bloque ES la lista.
    const compacto = (planesMostrados && hayPlanes && !archivo) ? bloquePlanes(ent, true) : '';
    if (intento.texto.length > limite && compacto && compacto.length < bloqueLargo.length) {
      intento = ajustar(conMarca, compacto, limite, PISO_TEXTO);
      pasos = intento.recortado ? ['texto_recortado', 'planes_compactados'] : ['planes_compactados'];
    }
    // 3. Si entra, se manda ajustado, y los avisos van EN EL ORDEN EN QUE SE
    //    APLICARON. Si no entra ni asi, se manda el texto ENTERO: `Salida` lo
    //    baja a texto y lo anota.
    if (intento.texto.length <= limite) {
      texto = intento.texto;
      for (const a of pasos) avisos.push(a);
    }
  }

  // f. Sin boton (cierre ya avisado) no hay interactivo que lleve el archivo
  // de encabezado: el texto lleva el enlace, nunca «en la imagen» sin imagen.
  if (conArchivo && !conBoton) texto = armar(conMarca, bloqueEnlace);
  const encabezado = conBoton && conArchivo
    ? (archivo.tipo === 'imagen'
      ? { type: 'image', image: { link: archivo.url } }
      : { type: 'document', document: { link: archivo.url, filename: archivo.nombreArchivo || 'Planes.pdf' } })
    : null;

  out.push({ json: { ...ent,
    respuesta: texto,
    cuerpoMeta: conBoton ? {
      messaging_product: 'whatsapp', recipient_type: 'individual', to: ent.from,
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(encabezado ? { header: encabezado } : {}),
        body: { text: texto },
        action: { buttons: [BOTON_ASESOR] },
      },
    } : undefined,
    // Si Meta rechaza el interactivo, el texto lleva el enlace del archivo y la
    // forma de pedir el asesor sin boton (`Normalizar entrada` lo reconoce).
    textoRespaldo: conBoton
      ? (encabezado ? armar(conMarca, bloqueEnlace) : texto) + '\n\n' + PIDE_ASESOR
      : texto,
    lead: combinado,
    guardarLead: cambios.length > 0 || ent.fichaPorCodigo === true || ent.primeraVez === true || avisar,
    estadoLead: cierre ? 'cerrado' : 'en_conversacion',
    avisar,
    estadoAviso: 'datos completos',
    avisos,
  }, pairedItem: { item: i } });
}
return out;
