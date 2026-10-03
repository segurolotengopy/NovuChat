// PROCESAR RESPUESTA: separa las marcas del agente y arma POR CODIGO lo que no
// puede depender del modelo: la lista de rubros, los planes con sus precios, la
// oferta con sus botones, la calificacion del prospecto y la prohibicion 4 (el
// agente no niega ser una IA). El prompt no es una barrera: cada regla de aqui
// se hace cumplir por lo que el modelo HIZO o el cliente HIZO, no por lo que se
// le pidio. MENSAJES POR TURNO: los mismos; todo viaja dentro de la respuesta.
//
// LAS MARCAS, que el cliente nunca ve:
//   [LEAD]{json}[/LEAD]  datos del prospecto que el cliente dio o corrigio en este turno.
//   [RUBROS]             pide la LISTA de rubros de la consola (mensaje interactivo de lista).
//   [PLANES]             se reemplaza por los planes y cargos con los precios EXACTOS de la
//                        consola, solo si hay rubro (o eligio «Otro»). Con un archivo de planes
//                        valido (imagen o PDF) el archivo es el encabezado del mensaje y el
//                        cuerpo no lleva precios en texto. Sin planes cargados, se ofrece al asesor.
//   [DESCARTE]motivo[/DESCARTE]
//                        el modelo PROPONE que no es un prospecto; el codigo la acepta solo con
//                        un motivo de la lista, en un mensaje escrito o un audio transcrito (no un
//                        toque), sin soporte ni hecho de Alta, y si la marca no la escribio el
//                        cliente. Va a la planilla como «Descalificado».
// Quien pide una persona por escrito no pasa por aqui: `Normalizar entrada` lo manda al traspaso.
//
// EL BOTON «Hablar con un asesor» (id `asesor`) va con los planes, al terminar el primer
// bloque, en la oferta, en soporte y cuando el texto promete algo; en la lista de rubros es su
// ultima fila. Tocarlo dispara `Traspaso a un asesor`. Una conversacion cerrada sigue con el
// boton mientras `c.avisado` (que escribe `Confirmar envio` cuando Meta acepto la plantilla)
// sea falso: el boton viaja dentro del mismo mensaje y no cuesta uno mas.
//
// QUE EL BOTON SOBREVIVA AL LIMITE DE META (`limiteInteractivo`, 1024): pasarse no da error,
// `Salida` baja el mensaje a texto y el cliente pierde la unica salida hacia una persona. Antes
// de resignar el boton se compacta, deteniendose apenas entra: 1) el texto del modelo, recortado
// por palabras y nunca por debajo de `PISO_TEXTO` (`texto_recortado`); 2) el bloque de planes
// sin el detalle, solo nombre, precio y periodo (`planes_compactados`); 3) si ni asi entra, sale
// como texto sin boton (lo anota `Salida`). Los precios no se recortan nunca.
const entradas = $('Estado de la conversación').all();
const sd = $getWorkflowStaticData('global');
sd.conversaciones = sd.conversaciones ?? {};

const NIEGA_IA = /(no\s+soy\s+(un[ao]?\s+)?(bot|robot|m[aá]quina|programa|inteligencia\s+artificial|\bia\b|asistente\s+virtual|autom[aá]tic[ao])|soy\s+(un[ao]?\s+)?(persona|humano|humana|ser\s+humano)|habl(as|[aá]s|a)\s+con\s+(un[ao]?\s+)?(persona|humano|humana))/i;
// Los datos que el modelo puede mandar en [LEAD]. `flujos` lo calcula el codigo del rubro.
const CAMPOS = ['empresa', 'contacto', 'rubro', 'area', 'personalizacion', 'consulta'];
// UN DATO DE RELLENO NO ES UN DATO: «Pendiente» sin que el cliente dijera nada no se registra.
const RELLENO = /^(pendiente|por (definir|confirmar)|a definir|desconocid[oa]|no (especificad[oa]|indicad[oa]|informad[oa]|sabe|lo sabe|dijo)|sin (dato|datos|definir|especificar)|n\/?a|ninguno|null|undefined|-+|\?+|…|\.{3})$/i;

const BOTON_ASESOR = { type: 'reply', reply: { id: 'asesor', title: 'Hablar con un asesor' } };
// «Ver planes» (id `planes`): el boton de la oferta. Tocarlo es un hecho de Alta.
const BOTON_PLANES = { type: 'reply', reply: { id: 'planes', title: 'Ver planes' } };
// LA CALIFICACION POR HECHOS (Bloque 1, 03/10/2026). El motivo que propone el
// modelo en [DESCARTE]: lista cerrada, la misma que sanea `Salida` y la que
// traduce `Decidir fila de la planilla` a una etiqueta.
const MOTIVOS_DESCARTE = ['numero_equivocado', 'vende_o_busca_trabajo', 'sin_negocio', 'spam_o_prueba'];
// Quien pide los planes o los precios escribiendo, con rubro registrado.
const PIDE_PLANES = /(precio|precios|planes?|cu[aá]nto\s+(cuesta|sale|cobran|vale)|costo|tarifa|cotiza)/i;
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
// REGLAS QUE EL CODIGO HACE CUMPLIR
// =============================================================================
//   a. Una enumeracion de rubros escrita por el modelo se quita: los rubros salen en la lista.
//   b. Un rubro en [LEAD] que el cliente no dijo no se registra: vale la misma palabra, otra
//      forma de ella (raiz comun de 5 letras) o un oficio («dentista» -> odontologia); las
//      palabras de la empresa y del contacto no cuentan.
//   c. Sin rubro (o «Otro») no salen planes ni precios: sale la lista de rubros.
//   d. El primer mensaje de la ventana se presenta como asistente virtual con IA.
//   e. A quien ya es cliente no se le piden datos de prospecto y su respuesta lleva el boton.
//   f. El rubro se guarda limpio (`limpiarRubro`, igual que en `Estado de la conversación`).
//   g. Un parrafo de solo emojis se une al anterior; «¿…? 🏢» cuenta como pregunta.

// Texto comparable: sin tildes, sin mayusculas y sin signos.
const plano = (t) => norm(t).replace(/[^a-z0-9ñ]+/g, ' ').trim();
// El mensaje del cliente sin el nombre de su empresa ni el suyo (enteros, no palabras
// sueltas): lo que se deduce del nombre no lo dijo el cliente.
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
// UNA MENCION NO ES EL NEGOCIO: «no
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

// El rubro se guarda limpio: se quita «es un/una», «somos», «tengo un/una», «me dedico a»,
// «trabajo en» y la puntuacion final; «vendo ropa» queda «venta de ropa». MISMA FUNCION,
// letra por letra, que en `Estado de la conversacion` (una prueba lo verifica).
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

// Una pregunta seguida de emojis («¿…? 🏢») TERMINA en pregunta.
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

// c. Una oracion con un precio.
const PRECIO = /(USD|US\$|\$us|\$\s?\d|\d+([.,]\d+)?\s*(d[oó]lares|bs\.?|bolivianos))/i;
function sinPrecios(t) {
  return t.split('\n').map((l) => l.split(/(?<=[.!?…])\s+/).filter((o) => !PRECIO.test(o)).join(' '))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
// ¿El texto ya pregunta por esto?
const oraciones = (t) => t.split(/(?<=[.!?…])\s+|\n+/);
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
// La pregunta que ya estaba, movida al final si el mensaje no termina en ella.
function preguntaAlFinal(t, re) {
  if (terminaEnPregunta(t)) return t;
  const q = oraciones(t).filter((o) => terminaEnPregunta(o.trim()) && re.test(o)).pop();
  if (!q) return t;
  const k = t.lastIndexOf(q);
  return (t.slice(0, k) + t.slice(k + q.length)).replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim() +
    '\n\n' + q.trim();
}

// =============================================================================
// LA LISTA DE RUBROS: lo que Meta admite (mensaje interactivo de lista)
// =============================================================================
// Hasta 10 filas EN TOTAL entre todas las secciones; titulo de fila hasta 24
// caracteres; descripcion de fila hasta 72; texto del boton que abre la lista
// hasta 20; id de fila hasta 200; cuerpo hasta 1024 (el limite de
// `limiteInteractivo`). La lista NO admite un encabezado de imagen. Los
// limites se fijan en `admin/pruebas/core/captacion-interactivos.test.ts`.
const MAX_FILAS = 10;
const TITULO_FILA = 24;
const DESCRIPCION_FILA = 72;
const BOTON_LISTA = 'Ver rubros';
// El id del rubro de la consola, tal cual, dentro de `rubro:<id>`: un id que
// `Normalizar entrada` no dejaria pasar (otros caracteres) no se ofrece como
// fila, porque su toque no se podria registrar.
const ID_RUBRO = /^[a-z0-9_-]{1,40}$/;
// La misma prueba que `Estado de la conversación` y `limpiarOferta`: el rubro
// «a medida» no es un area, es la ausencia de una.
const esAMedida = (r) => /medida|^otro/i.test(String(r.id) + ' ' + String(r.nombre));

// El nombre del rubro como titulo de fila: hasta 24 caracteres, recortado por
// palabras (una palabra cortada por la mitad se lee como un error).
function tituloDeFila(nombre) {
  const n = String(nombre).replace(/\s+/g, ' ').trim();
  if (n.length <= TITULO_FILA) return { titulo: n, recortado: false };
  let t = '';
  for (const p of n.split(' ')) {
    const sig = t ? t + ' ' + p : p;
    if (sig.length > TITULO_FILA) break;
    t = sig;
  }
  if (!t) t = n.slice(0, TITULO_FILA);
  return { titulo: t.replace(/[\s,;:.\-/]+$/, ''), recortado: true };
}

// Las filas: los rubros de la consola en su orden -- el «a medida» al final, que
// ya viene asi de `Config del negocio` --, y la fila del asesor solo si este
// turno llevaria el boton del asesor. Si no caben, se quitan rubros comunes: el
// «a medida» y el asesor son las salidas y no se pierden.
function filasDeRubros(rubros, conAsesor) {
  const cupo = MAX_FILAS - (conAsesor ? 1 : 0);
  const aMedida = rubros.filter(esAMedida).slice(0, cupo);
  const comunes = rubros.filter((r) => !esAMedida(r)).slice(0, cupo - aMedida.length);
  const filas = [...comunes, ...aMedida].map((r) => {
    const { titulo, recortado } = tituloDeFila(r.nombre);
    return { id: 'rubro:' + r.id, title: titulo,
      ...(recortado ? { description: String(r.nombre).replace(/\s+/g, ' ').trim().slice(0, DESCRIPCION_FILA) } : {}) };
  });
  if (conAsesor) filas.push({ id: 'asesor', title: BOTON_ASESOR.reply.title });
  return filas;
}

const out = [];
const items = $input.all();
for (let i = 0; i < items.length; i++) {
  // Emparejamiento por indice: nunca .first(), que le pondria el telefono del
  // primer mensaje a todos los items si llegaran dos a la vez.
  const ent = (entradas[i] ?? entradas[entradas.length - 1]).json;
  const bruto = String(items[i].json.output ?? items[i].json.text ?? '').trim();
  // Gemini devuelve 500/503 en picos y el agente (onError: continueRegularOutput)
  // entrega el item con `error` o sin `output`. Se distingue de una respuesta
  // vacia, pero las dos terminan igual: texto fijo CON el boton al asesor
  // (politica «solo se ofrece lo que se cumple»). Cuesta un mensaje en el turno
  // en que el modelo falla; antes el cliente no recibia nada.
  const fallo = items[i].json.error !== undefined
    || (items[i].json.output === undefined && items[i].json.text === undefined);

  const { lead, invalido } = leerLead(bruto);
  const modeloPusoRubros = /\[RUBROS\]/i.test(bruto);
  const conPlanes = /\[PLANES\]/i.test(bruto);
  const rubros = Array.isArray(ent.rubros) ? ent.rubros : [];
  const hayPlanes = Array.isArray(ent.planes) && ent.planes.length > 0;
  const archivo = hayPlanes && ent.planesEnArchivo === true && ent.archivoPlanes && ent.archivoPlanes.url
    ? ent.archivoPlanes : null;

  const avisos = [];
  if (invalido) avisos.push('lead_invalido');

  // Lo que el modelo escribe no lleva la oferta: las marcas se reemplazan
  // DESPUES de revisar su texto, para que la correccion de la prohibicion 4 no
  // toque un precio. `[DESCARTE]` se lee ANTES de quitarlo (mas abajo) y se
  // quita entero antes del limpiado generico, que solo se llevaria la apertura.
  const marcaDeDescarte = bruto.match(/\[DESCARTE\]\s*([a-z_]{3,40})\s*\[\/DESCARTE\]/i);
  const hayMarcaDeDescarte = /\[\/?DESCARTE\]/i.test(bruto);
  let texto = bruto
    .replace(/\[LEAD\][\s\S]*?\[\/LEAD\]/gi, '')
    .replace(/\[\/?LEAD\]/gi, '')
    .replace(/\[DESCARTE\][\s\S]*?\[\/DESCARTE\]/gi, '')
    .replace(/\[\/?DESCARTE\]/gi, '')
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
  // Estado de antes del 03/10/2026: la deduccion del rubro ya no existe.
  if (c) { delete c.confirmaRubro; delete c.rubroDeducido; }
  const previo = c?.lead ?? ent.leadConocido ?? {};
  // Lo que dijo el cliente, escrito o en un audio (la transcripcion que dejo
  // `Preparar transcripcion`, sin sus lineas de instruccion).
  const audioTranscrito = ['audio', 'voice'].includes(ent.tipo) && ent.esMedioAudio === true
    && /^\(audio transcripto\)/.test(String(ent.userInput ?? ''));
  const dicho = ent.tipo === 'text' ? String(ent.userInput ?? '')
    : (audioTranscrito
      ? String(ent.userInput).replace(/^\(audio transcripto\)\s*/, '').split('\nAVISO_SISTEMA')[0].trim() : '');
  // Pidio soporte en este mensaje o antes en la ventana: ya es cliente.
  const soporte = ent.pideSoporte === true || ent.soporteEnVentana === true;
  const cerrada = ent.etapa === 'cerrado' || c?.etapa === 'cerrado';
  // UNA sola condicion para el texto que invita a tocar el boton y para el
  // boton mismo: nunca uno sin el otro.
  const botonSoporte = soporte && !cerrada && !(c && c.avisado === true);

  // LOS HECHOS (Bloque 1). Lo que el prospecto HIZO, no lo que el modelo dijo:
  // `Estado de la conversación` los trae (y los guarda en `c.hechos`); aca se
  // completan con lo que solo se sabe despues de la respuesta del modelo.
  const h0 = ent.hechos && typeof ent.hechos === 'object' ? ent.hechos : {};
  const hechos = {
    pidioAsesor: h0.pidioAsesor === true,
    pidioPlanes: h0.pidioPlanes === true,
    eligioOtro: h0.eligioOtro === true || ent.eligioOtroEsteTurno === true,
    respondioDolor: h0.respondioDolor === true || ent.respondioDolorEsteTurno === true,
    descarte: MOTIVOS_DESCARTE.includes(h0.descarte) ? h0.descarte : '',
  };

  // b. EL RUBRO DEL [LEAD]: se registra solo si el cliente lo dijo en este mensaje (ver
  // `loNombro`). El rubro que toco ya esta en la ficha (`previo`), registrado por `Estado de la
  // conversación`, que tambien separa la empresa del rubro cuando se pide en el traspaso.
  const esArea = (v) => rubros.some((r) => plano(r.nombre) === plano(v));
  const empresaTurno = lead.empresa || previo.empresa || '';
  const rubroModelo = lead.rubro ? limpiarRubro(lead.rubro) : undefined;
  const areaModelo = lead.area;
  delete lead.rubro;
  delete lead.area;
  const suyo = sinNombres(dicho, [empresaTurno, lead.contacto || previo.contacto || '']);
  // ¿Este mensaje respondia a la pregunta por el rubro? Solo ahi vale la raiz comun.
  const respondeAlRubro = c?.pidio?.[0] === 'rubro' || c?.pidioRubro === true;
  if (rubroModelo) {
    if (loNombro(rubroModelo, suyo, respondeAlRubro)) {
      lead.rubro = rubroModelo;
      if (areaModelo) lead.area = areaModelo;
    } else if (previo.rubro) {
      // Con el rubro ya registrado, el modelo solo puede ubicarlo en un area.
      if (esArea(rubroModelo)) lead.area = rubroModelo;
      else if (areaModelo) lead.area = areaModelo;
    } else {
      avisos.push('rubro_del_modelo_descartado');
    }
  } else if (areaModelo && previo.rubro) {
    lead.area = areaModelo;
  }
  const combinado = { ...previo, ...lead };
  // ¿Se registro un rubro en ESTE turno? Por el toque (`Estado`) o por el
  // [LEAD] validado.
  const rubroDelTurno = String(ent.rubroElegido ?? '') !== '' || (!!lead.rubro && lead.rubro !== previo.rubro);

  // a. Una lista de rubros que el modelo escribio por su cuenta se quita: la
  // lista de verdad es el interactivo.
  const reescrito = sinEnumeracion(texto, rubros);
  const enumero = reescrito !== null;
  if (enumero) { texto = reescrito; avisos.push('enumeracion_de_rubros_quitada'); }
  texto = texto.replace(/\u0001/g, '').replace(/\n{3,}/g, '\n\n').trim();

  // c. Los planes y los precios, solo con rubro (o «Otro»). Desde el 03/10/2026
  // la empresa ya no se pide al inicio y no es condicion. Quien toco «Ver
  // planes» los recibe aunque el modelo olvide la marca.
  const toquePlanes = ent.tocoPlanesEsteTurno === true;
  const fichaLista = !!combinado.rubro || hechos.eligioOtro === true;
  const queriaPlanes = conPlanes || toquePlanes;
  const planesMostrados = queriaPlanes && fichaLista;
  let retenidos = false;
  if (queriaPlanes && !fichaLista) {
    texto = texto.replace(/\u0002/g, '');
    retenidos = true;
    avisos.push('planes_retenidos_sin_ficha');
  }
  if (!fichaLista && PRECIO.test(texto.replace(/\u0002/g, ''))) {
    texto = sinPrecios(texto);
    retenidos = true;
    avisos.push('precios_retenidos_sin_ficha');
  }
  if (planesMostrados && !texto.includes('\u0002')) texto = texto.trimEnd() + '\n\u0002';

  // HECHO: pidio los planes. El toque en «Ver planes», o el texto que los pide
  // con rubro (o «Otro») al cerrar el turno. Un toque sin rubro (una campaña
  // con destino `planes`) no es un hecho hasta que haya rubro (C22).
  if (toquePlanes && !fichaLista) hechos.pidioPlanes = false;
  if ((toquePlanes && fichaLista) || (fichaLista && PIDE_PLANES.test(dicho))) hechos.pidioPlanes = true;

  // HECHO: el modelo propone descartar; el codigo decide. Se acepta solo con un
  // motivo de la lista, en un mensaje ESCRITO o en un AUDIO TRANSCRITO (decision
  // de Andres, 03/10/2026; no un toque, una imagen ni un documento), que no sea de
  // soporte, sin un hecho de Alta y sin que la marca la haya escrito el propio
  // cliente. Un hecho de Alta posterior gana (`Decidir fila de la planilla`).
  let descarteNuevo = '';
  if (hayMarcaDeDescarte) {
    const motivo = String(marcaDeDescarte?.[1] ?? '').toLowerCase();
    const marcaDelCliente = /\[\/?DESCARTE\]/i.test(String(ent.userInput ?? ''));
    if (MOTIVOS_DESCARTE.includes(motivo) && (ent.tipo === 'text' || audioTranscrito) && !soporte
        && !hechos.pidioAsesor && !hechos.pidioPlanes && !marcaDelCliente && !fallo) {
      if (hechos.descarte !== motivo) descarteNuevo = motivo;
      hechos.descarte = motivo;
    } else {
      avisos.push('descarte_rechazado');
    }
  }

  // Lo que el texto del modelo ya pide, en orden.
  const pedidosModelo = datosPedidos(texto.replace(/\u0002/g, ''));
  const pideRubro = pedidosModelo.includes('rubro');

  // --- LA LISTA DE RUBROS -----------------------------------------------------
  // Los rubros de la consola salen en un mensaje interactivo de LISTA; el toque registra el
  // rubro POR CODIGO (`Estado de la conversación`, id `rubro:<id>`). Sale sin rubro (ni «Otro»)
  // cuando es el primer mensaje, el modelo la pidio o pregunto el rubro, enumero rubros, el
  // cliente toco una opcion vencida o se retuvieron los planes. Nunca en soporte, en una
  // conversacion cerrada ni si el modelo fallo. Sin rubros con id valido, la pregunta queda abierta.
  const rubrosConId = rubros.filter((r) => ID_RUBRO.test(String(r.id)));
  const quiereLista = rubrosConId.length > 0 && !combinado.rubro && !hechos.eligioOtro
    && !soporte && !cerrada && !fallo
    && (ent.primeraDeVentana === true || modeloPusoRubros || enumero || pideRubro
      || ent.opcionVencida === true || retenidos);
  const preguntaRubro = retenidos ? 'Para mostrarte los planes que te sirven, ¿de qué rubro es tu negocio?'
    : '¿De qué rubro es tu negocio?';
  // Con los planes retenidos y sin lista (sin rubros cargados) la pregunta
  // tambien se hace: no se calla lo que se pidio.
  if (quiereLista || (retenidos && !combinado.rubro && !soporte && !cerrada && !fallo)) {
    if (!pideRubro) texto = texto.trimEnd() + (texto.trim() ? '\n\n' : '') + preguntaRubro;
    else texto = preguntaAlFinal(texto, PIDE.rubro);
    avisos.push(quiereLista ? 'lista_de_rubros' : 'pide_rubro_por_codigo');
  }

  // d. El primer mensaje de la ventana dice que es una IA; si el modelo no lo dijo, se agrega.
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

  // --- LA OFERTA (turno en que contesto la pregunta por su negocio) ----------
  // El mensaje lleva dos botones: «Ver planes» (solo con planes cargados y si
  // no los pidio ya) y el del asesor. Termina en pregunta. Con el rubro
  // registrado en este mismo turno no se vuelve a preguntar por el negocio.
  const esOferta = ent.respondioDolorEsteTurno === true && fichaLista && !planesMostrados
    && !soporte && !cerrada && !fallo && texto.replace(/[\u0001\u0002]/g, '').trim() !== '';
  const botonPlanes = esOferta && hayPlanes && !h0.pidioPlanes && !hechos.pidioPlanes;
  if (esOferta && !terminaEnPregunta(texto)) {
    texto = texto.trimEnd() + '\n\n' + (botonPlanes
      ? '¿Quieres ver los planes o prefieres hablar con una persona del equipo?'
      : '¿Quieres hablar con una persona del equipo?');
    avisos.push('oferta_con_pregunta');
  }

  // 5. Al final, que ningun emoji quede solo en su linea.
  texto = sinEmojisSueltos(texto);

  // QUE SE PREGUNTO, EN ORDEN: la respuesta del proximo turno la registra `Estado de la
  // conversación` en el PRIMER dato que pidio este mensaje. Un mensaje que no pide nada no borra lo pendiente.
  const pedidos = datosPedidos(texto);
  if (c) {
    if (quiereLista) { c.pidio = ['rubro']; c.pidioRubro = true; }
    else {
      if (pedidos.length) c.pidio = pedidos;
      if (combinado.rubro) c.pidioRubro = false;
      else if (pedidos[0] === 'rubro') c.pidioRubro = true;
      else if (pedidos.length) c.pidioRubro = false;
    }
  }

  // --- [PLANES]: el bloque armado por codigo --------------------------------
  // `conMarca` (el texto del modelo con la marca) y `bloqueLargo` se guardan para volver a
  // armar el texto si hay que compactarlo (ver el encabezado).
  // f. PLANES EN ARCHIVO: con un archivo valido en la consola los planes salen en el archivo
  // (encabezado del interactivo) y el cuerpo no lleva precios: el que escriba el modelo se quita,
  // porque un precio que no coincide con la imagen es peor que ninguno. Si Meta rechaza el
  // interactivo, el respaldo lleva el enlace del archivo.
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

  const TEXTO_FALLO = 'Disculpa, tuve un problema para responderte. Si prefieres, toca el botón y te paso con una persona del equipo.';
  // Cerrado y ya avisado, el boton no sale (no hay a quien avisar de nuevo): el texto no lo ofrece.
  const TEXTO_FALLO_SIN_BOTON = 'Disculpa, tuve un problema para responderte. ¿Me lo repites?';
  if (fallo) {
    texto = TEXTO_FALLO;
    avisos.push('fallo_modelo');
  } else if (!texto) {
    texto = TEXTO_FALLO;
    avisos.push('respuesta_vacia');
  }
  const sinRespuesta = avisos.includes('fallo_modelo') || avisos.includes('respuesta_vacia');

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

  if (c) {
    c.lead = combinado;
    // Lo que solo se sabe aca. `Estado de la conversación` guarda el resto de
    // los hechos al inicio del turno.
    c.hechos = { ...(c.hechos || {}), pidioPlanes: hechos.pidioPlanes, descarte: hechos.descarte };
    // LA PREGUNTA DE DOLOR: con el rubro registrado en este turno (o «Otro») y
    // sin planes, esta conversacion espera la respuesta a la pregunta por su
    // negocio. Quien ya la esta contestando (turno de la oferta) no se
    // vuelve a preguntar.
    if ((rubroDelTurno || ent.eligioOtroEsteTurno === true) && !planesMostrados && !esOferta
        && !ent.respondioDolorEsteTurno && !soporte && !cerrada && !sinRespuesta) {
      c.pidioDolor = true;
    }
  }

  // --- El boton «Hablar con un asesor» -------------------------------------
  const yaCerrado = c?.etapa === 'cerrado' || ent.etapa === 'cerrado';
  // Cerrado, pero con el aviso sin confirmar: la salida hacia una persona se
  // sigue ofreciendo en cada respuesta.
  const falloSinBoton = sinRespuesta && yaCerrado && c?.avisado === true;
  if (falloSinBoton) texto = TEXTO_FALLO_SIN_BOTON;
  const cerradoSinAviso = !!c && c.etapa === 'cerrado' && c.avisado !== true;
  // SOLO SE OFRECE LO QUE SE CUMPLE (politica de NovuChat, 21/09/2026). Si el
  // texto remite a un asesor o promete que alguien le va a responder, y en este
  // turno no sale el aviso a una persona, el mensaje lleva el boton: es la unica
  // forma de que esa promesa se cumpla. Una pregunta no promete nada.
  const PROMESA = /(consult|averigu|pregunt|verific|revis|coordin)[a-záéíóúñ]*\s+(lo\s+|eso\s+)?(con|a)\s+(recepci|la\s+cl[ií]nica|el\s+equipo|el\s+personal|(el|la)\s+(doctor|doctora|dr|dra)(?![a-záéíóúñ])|administraci|caja|alguien|una\s+persona|la\s+empresa|el\s+negocio|mis\s+compa)|(te|le)\s+(avis|escrib|llam|contact|confirm|mand|env[ií]|respond)[a-záéíóúñ]*\s+(luego|despu[eé]s|m[aá]s\s+tarde|ma[ñn]ana|en\s+cuanto|apenas|pronto|en\s+un\s+rato|en\s+breve|a\s+la\s+brevedad)|(te|le)\s+(avisar|escribir|llamar|contactar|confirmar|responder)([eé]|[aá]n?)(?![a-záéíóúñ])|voy\s+a\s+(consultar|averiguar|preguntar|avisar|escribir|llamar|contactar|confirmar)/i;
  const REMITE_ASESOR = /(asesor|especialista|una\s+persona\s+del\s+equipo)[^.!?\n]{0,40}(confirm|respond|escrib|contact|llam|avis|ayud|explic|cotiz)|(te|le)\s+(paso|pongo|comunico)\s+con/i;
  const prometeSinAviso = texto.split(/(?<=[.!?…])\s+|\n+/)
    .some((o) => o.trim() && !/\?\s*$/.test(o.trim()) && (PROMESA.test(o) || REMITE_ASESOR.test(o)));
  if (prometeSinAviso) avisos.push('promesa_con_boton_asesor');
  // ¿Este turno lleva el boton del asesor? (en la lista, es su ultima fila).
  const conBotonAsesor = cerradoSinAviso || (prometeSinAviso && !(c && c.avisado === true))
    || botonSoporte
    || (sinRespuesta && !falloSinBoton)
    || esOferta
    // CAMPAÑA CON DESTINO `asesor` (Andres, 03/10/2026): el contexto del turno le
    // dice al modelo que el mensaje sale con el boton; aqui se GARANTIZA por
    // codigo, sin depender de que el texto prometa algo. No dispara el traspaso
    // ni la plantilla: solo ofrece el boton. Cerrada y ya avisada, no (no hay a
    // quien avisar de nuevo y el texto no lo ofrece).
    || (ent.porCampana === true && ent.idElegido === 'asesor' && !(yaCerrado && c?.avisado === true))
    || (!yaCerrado && (planesMostrados || ent.finBloque === true));
  const filas = quiereLista ? filasDeRubros(rubrosConId, conBotonAsesor) : [];
  const conLista = filas.length > 0;
  const conBoton = conBotonAsesor && !conLista;

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
  if (conArchivo && !conBotonAsesor) texto = armar(conMarca, bloqueEnlace);
  const encabezado = conBoton && conArchivo
    ? (archivo.tipo === 'imagen'
      ? { type: 'image', image: { link: archivo.url } }
      : { type: 'document', document: { link: archivo.url, filename: archivo.nombreArchivo || 'Planes.pdf' } })
    : null;

  // El interactivo: la lista de rubros, o el boton (o los dos de la oferta).
  const botones = botonPlanes ? [BOTON_PLANES, BOTON_ASESOR] : [BOTON_ASESOR];
  const interactivo = conLista
    ? { type: 'list', body: { text: texto }, action: { button: BOTON_LISTA, sections: [{ rows: filas }] } }
    : (conBoton ? {
      type: 'button',
      ...(encabezado ? { header: encabezado } : {}),
      body: { text: texto },
      action: { buttons: botones },
    } : null);
  // Si Meta rechaza el interactivo, el texto lleva el enlace del archivo, las
  // areas de la lista y la forma de pedir el asesor sin boton (`Normalizar
  // entrada` reconoce lo escrito).
  const areas = rubrosConId.filter((r) => !esAMedida(r)).map((r) => r.nombre);
  const respaldo = conLista
    ? texto + (areas.length ? '\n\nPor ejemplo: ' + areas.join(', ') + '. Si es otro, cuéntame a qué se dedica.' : '')
      + (filas.some((f) => f.id === 'asesor') ? '\n\n' + PIDE_ASESOR : '')
    : (conBoton ? (encabezado ? armar(conMarca, bloqueEnlace) : texto) + '\n\n' + PIDE_ASESOR : texto);

  out.push({ json: { ...ent,
    respuesta: texto,
    cuerpoMeta: interactivo ? {
      messaging_product: 'whatsapp', recipient_type: 'individual', to: ent.from,
      type: 'interactive',
      interactive: interactivo,
    } : undefined,
    textoRespaldo: respaldo,
    lead: combinado,
    hechos,
    // Se guarda la ficha cuando cambio algo -- los datos o los hechos de la
    // calificacion --: un descarte o un pedido de planes nuevos van a la planilla.
    guardarLead: cambios.length > 0 || ent.fichaPorCodigo === true || ent.primeraVez === true
      || ent.hechosCambiaron === true || descarteNuevo !== ''
      || (hechos.pidioPlanes && !h0.pidioPlanes),
    estadoLead: 'en_conversacion',
    // El aviso a recepcion ya no sale de aqui: lo dispara el traspaso (el
    // boton), que es el unico camino a una persona.
    avisar: false,
    avisos,
  }, pairedItem: { item: i } });
}
return out;
