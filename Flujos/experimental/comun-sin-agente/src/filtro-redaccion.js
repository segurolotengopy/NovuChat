// =============================================================================
// FILTRO DE LA REDACCIÓN DEL MODELO (prefijo `cm`): lo que el modelo escribe NO sale sin pasar por aquí
// =============================================================================
// Se pega DELANTE del código de un nodo Code (marca `@@comun+filtro:…` o `@@solo+filtro:…`). Autosuficiente:
// no usa funciones `cn*` ni lee nada. Principio del flujo «sin agente»: el código calcula y el modelo conversa;
// cuando el modelo redacta, el código VERIFICA lo redactado y, si algo falla, lo descarta y usa un texto fijo.
// Ninguna regla es una instrucción al modelo: una instrucción se ignora bajo insistencia (CLAUDE.md).
//
// Sacado de `agenda-minima/src/nodos/armar-mensajes.js` (que sigue con sus copias), SIN lo que es de un negocio:
// ni lo clínico ni las horas de una agenda ni nombres de personas. Eso entra por `opciones`.
//
//   cmMotivoDeRechazo(texto, opciones) -> '' si el texto puede salir, o el MOTIVO del rechazo
//   cmRedaccionValida(texto, opciones) -> true/false
//   cmPulirRedaccion(texto, opciones)  -> el texto sin saludo repetido, sin muletillas y con el nombre del negocio bien escrito
//
// opciones de `cmMotivoDeRechazo` (todas opcionales):
//   maximo            largo máximo (900)
//   permitirMontos    false por defecto: un MONTO nunca sale de la redacción, lo dice el código con su cifra
//   enlacesPermitidos los enlaces COMPLETOS del negocio; por defecto NINGÚN enlace sale (null apaga la revisión)
//   quienPromete      sujetos (ya normalizados) cuyo «<sujeto> te…» es una promesa: ['recepcion', 'el doctor']
//   prohibidos        regex extra, probadas contra el texto NORMALIZADO (minúsculas y sin tildes)
//   textoDelCliente   lo que preguntó el cliente: a una pregunta de IDENTIDAD no se contesta empezando con «Sí»
//   extra             funciones (texto, normalizado) => motivo ('' si pasa): las reglas propias del flujo (horas, etc.)
// Las promesas sin respaldo, afirmar un hecho que solo el código puede afirmar (quedó agendado, pago acreditado…),
// negar ser una IA y los huecos de plantilla se revisan SIEMPRE, y no se pueden apagar.

function cmNorm(t) {
  // NFKC junta las formas de ancho completo («ｑｕｅｄó» → «quedó»); se quitan los caracteres invisibles (U+200B a U+200D,
  // U+2060, U+FEFF) y el guion blando, que partían una palabra sin que se viera («agen​dé»).
  return String(t === undefined || t === null ? '' : t).normalize('NFKC').replace(/[​-‍⁠﻿­]/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
// «Política: el asistente solo ofrece lo que el flujo cumple»: ninguna promesa sin un mecanismo detrás.
const CM_PROMESAS = /lo consulto|lo consultar[eé]|consultar[eé]|\b(te|le) avis(o|ar[eé]|amos)\b|\b(te|le) llam(amos|ar[eé]|aremos)\b|te vamos a (llamar|avisar|escribir|contactar)|te van a (llamar|contactar|escribir|avisar)|te escribir[aá]n|te escribiremos|\b(te|le) contactar[eé]|nos comunicaremos|\b(te|le) confirm(o|ar[eé]) (luego|despues|mas tarde|manana)|te confirmar[eé]/;
// Lo que SOLO el código puede afirmar. Por defecto se rechaza todo lo que SUENA a confirmación: un falso rechazo
// cae en el texto fijo del código (barato); un falso «quedó agendada» es una cita que no existe (CLAUDE.md).
//   - participios de lo que el código hace o confirma: agendada, reservado, registrado, confirmada, anotado,
//     reprogramada, cancelada, acreditado, aprobado, verificado, pagado, recibido (de un pago)…
//   - primera persona: «agendé», «reservé», «registré», «confirmé», «anoté», «reprogramé», «he reservado»…
//   - el pago: «recibimos tu pago», «pago recibido/acreditado/aprobado», «tu pago fue…»
//   - marcas de visto bueno que pone el código: ✅ ✔ ☑
// Y negar ser una IA (prohibición 4: NUNCA): «no soy un bot / una máquina / un asistente», «soy una persona»,
// «hablas con una persona», «persona real», «de carne y hueso».
const CM_AFIRMA = /\b(agendad|reservad|registrad|confirmad|anotad|reprogramad|cancelad|acreditad|aprobad|verificad|pagad)[oa]s?\b|\b(agende|reserve|registre|confirme|anote|reprograme|cancele)\b|\bte (agende|reserve|registre|confirme|anote)\b|\b(qued[oa]|esta|estan|fue|fueron|ha sido|han sido) (list|hech|fij|recibid|ya)[oa]s?\b|\b(pago|abono|deposito|comprobante) (recibid|acreditad|aprobad|confirmad|verificad|registrad)|\brecib(i|imos|ido) (tu|el|su) (pago|abono|deposito|comprobante)|\btu (cita|reserva|pedido|pago) (ya )?(esta|quedo|queda|fue|ha sido)\b|\bconfirm(o|amos) (tu|la|su|el) (cita|reserva|pedido|pago)\b|[✅✔☑]|no soy (una |un )?(ia|inteligencia|bot|chatbot|robot|maquina|programa|asistente|virtual)|\bsoy (una |un )?(persona|humana|humano|ser humano)\b|\bhablas con (una |un )?(persona|humano|humana)\b|\bpersona (real|de verdad)\b|carne y hueso/;
const CM_PALABRA_DE_NUMERO = 'un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|quinientos|mil|medio';
const CM_MONTO = new RegExp('\\b\\d[\\d.,]*\\s*(bs|bob|bolivianos?|usd|usdt|dolar(es)?|\\$us)\\b|\\b(?:bs|bob|usd)\\.?\\s*\\d|\\$\\s*\\d|\\b(?:' + CM_PALABRA_DE_NUMERO + ')\\s+(bolivianos?|dolar(es)?|bs|bob|usdt)\\b');
// Un hueco de plantilla («a las )», «{{x}}», «undefined») nunca sale.
const CM_HUECO = /\(\s*\)|\ba las?\s*[).,;:!?]|\ba las?\s*$|\bde\s*\)|«\s*»|\{\{|undefined|null\b/;
const CM_PREGUNTA_DE_IDENTIDAD = /\b(eres|es|sos) (el |la )?(doctor|doctora|dr|dra|persona|humano|humana|bot|robot)\b|\bquien (eres|es)\b/;

// Los enlaces de un texto: con esquema, con `www.`, o un dominio suelto con una terminación conocida.
const CM_TERMINACIONES = 'com|net|org|bo|app|io|me|ly|link|info|biz|co|site|online|shop|store|xyz|top|gl|page|dev|edu|gob';
const CM_ENLACE = new RegExp('(?:https?:\\/\\/|www\\.)\\S+|\\b[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:' + CM_TERMINACIONES + ')(?![a-z0-9-])(?:\\/\\S*)?', 'gi');
function cmEnlacesDe(texto) {
  const t = String(texto || '').normalize('NFKC').replace(/[​-‍⁠﻿­]/g, '');
  return (t.match(CM_ENLACE) || []).map((e) => e.replace(/[).,;:!?»”"']+$/, ''));
}
function cmNormEnlace(e) {
  return String(e || '').normalize('NFKC').trim().replace(/[).,;:!?»”"']+$/, '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').toLowerCase();
}

function cmMotivoDeRechazo(texto, opciones) {
  const o = opciones || {};
  const s = String(texto || '').trim();
  if (!s) return 'vacio';
  if (/^SIN_RESPUESTA/.test(s)) return 'sin_respuesta';
  if (s.length > (o.maximo || 900)) return 'largo';
  const n = cmNorm(s);
  if (!o.permitirMontos && CM_MONTO.test(n)) return 'monto';
  if (CM_PROMESAS.test(n)) return 'promesa';
  const sujetos = (o.quienPromete || []).map((x) => String(x).replace(/[.*+?^${}()[\]\\|]/g, '\\$&'));
  if (sujetos.length && new RegExp('\\b(?:' + sujetos.join('|') + ') te\\b').test(n)) return 'promesa';
  if (CM_AFIRMA.test(n)) return 'afirma_un_hecho';
  if (CM_HUECO.test(n)) return 'hueco';
  const pregunta = cmNorm(o.textoDelCliente || '');
  if (pregunta && CM_PREGUNTA_DE_IDENTIDAD.test(pregunta) && /^\W*si\b/.test(n)) return 'identidad';
  for (const re of (o.prohibidos || [])) if (re.test(n)) return 'prohibido';
  // ENLACES: por defecto NINGUNO sale. `enlacesPermitidos` es la lista de enlaces COMPLETOS del negocio (mapa, redes,
  // wa.me). Se detectan `https?://…`, `www.…` y los dominios sueltos más comunes (wa.me/…, bit.ly/…, algo.com); un
  // enlace sale solo si es IGUAL a uno de la lista o cuelga de él (`/`, `?` o `#` después). `null` apaga la revisión
  // y debe ser una decisión escrita del flujo.
  if (o.enlacesPermitidos !== null) {
    const lista = (o.enlacesPermitidos || []).map((x) => cmNormEnlace(x)).filter(Boolean);
    for (const e of cmEnlacesDe(s)) {
      const n = cmNormEnlace(e);
      if (!lista.some((p) => n === p || (n.startsWith(p) && /[\/?#]/.test(n.charAt(p.length))))) return 'enlace_ajeno';
    }
  }
  for (const f of (o.extra || [])) {
    const m = f(s, n);
    if (m) return String(m);
  }
  return '';
}
function cmRedaccionValida(texto, opciones) {
  return cmMotivoDeRechazo(texto, opciones) === '';
}
// Pulido, en código. Se trabaja por ORACIONES COMPLETAS, nunca por trozos (cortar en el punto de «Dr.» dejaba
// la oferta empezando por «Andres Bellido y estoy aquí…»). Las abreviaturas de trato no cierran oración.
//   - fuera, al principio, toda oración que solo saluda o presenta (el menú ya saludó);
//   - fuera las muletillas de apertura («Claro que sí,», «Por supuesto,»…);
//   - toda palabra del nombre del negocio escrita con otros acentos vuelve a la forma de la configuración.
// opciones: { nombreNegocio }
function cmPulirRedaccion(texto, opciones) {
  const o = opciones || {};
  const ABREV = /\b(Dr|Dra|Sr|Sra|Srta|Lic|Ing|Prof|Esp|Av|Edif|Of|No|Nro)\.$/i;
  // Tope de largo: el pulido parte por oraciones y un texto enorme lo volvía cuadrático. Una redacción válida mide ≤ 900.
  const trozos = String(texto || '').slice(0, 5000).trim().split(/(?<=[.!?…])\s+/);
  const oraciones = [];
  for (const t of trozos) {
    if (oraciones.length && ABREV.test(oraciones[oraciones.length - 1])) oraciones[oraciones.length - 1] += ' ' + t;
    else oraciones.push(t);
  }
  const SALUDO = /^[¡!]?\s*(hola|buen[oa]s?\s+(d[ií]as|tardes|noches)|qu[eé] tal)\b/i;
  const PRESENTA = /\b(soy|somos)\s+(la|el|una|un|tu)\s+(asistente|secretaria|recepcionista)\b|\bestoy aqu[ií] para\b|\best(oy|amos) para (ayudarte|servirte)\b/i;
  while (oraciones.length > 1 && (SALUDO.test(oraciones[0]) || PRESENTA.test(oraciones[0]))) oraciones.shift();
  if (oraciones.length) oraciones[0] = oraciones[0].replace(/^[¡!]?\s*(claro que s[ií]|claro|por supuesto|con gusto|perfecto|listo|dale|genial)\s*[!,.:]+\s*/i, '');
  if (oraciones.length) oraciones[0] = oraciones[0].replace(/^[¡!]?\s*hola\s*[!.,]\s*/i, '');
  let t = oraciones.join(' ').trim();
  const sinTilde = (w) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const palabras = String(o.nombreNegocio || '').split(/[^A-Za-zÀ-ÿ]+/).filter((w) => w.length >= 4);
  for (const w of palabras) {
    t = t.replace(/[A-Za-zÀ-ÿ]+/g, (x) => (x !== w && sinTilde(x) === sinTilde(w)) ? w : x);
  }
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}
// LO QUE SALE es lo PULIDO, así que se valida lo pulido (pulir puede dejar un «Sí» al principio de lo que era
// «Hola. Sí, soy yo»). Devuelve { texto, motivo }: si `motivo` no es '', se descarta y se usa el texto fijo del código.
function cmRevisarRedaccion(texto, opciones) {
  const pulido = cmPulirRedaccion(texto, opciones);
  return { texto: pulido, motivo: cmMotivoDeRechazo(pulido, opciones) };
}
