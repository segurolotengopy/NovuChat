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
//   enlacesPermitidos lista de textos: todo enlace http(s) del texto tiene que estar entre ellos (null = no se revisa)
//   quienPromete      sujetos (ya normalizados) cuyo «<sujeto> te…» es una promesa: ['recepcion', 'el doctor']
//   prohibidos        regex extra, probadas contra el texto NORMALIZADO (minúsculas y sin tildes)
//   textoDelCliente   lo que preguntó el cliente: a una pregunta de IDENTIDAD no se contesta empezando con «Sí»
//   extra             funciones (texto, normalizado) => motivo ('' si pasa): las reglas propias del flujo (horas, etc.)
// Las promesas sin respaldo, afirmar un hecho que solo el código puede afirmar (quedó agendado, pago acreditado…),
// negar ser una IA y los huecos de plantilla se revisan SIEMPRE, y no se pueden apagar.

function cmNorm(t) {
  return String(t === undefined || t === null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
// «Política: el asistente solo ofrece lo que el flujo cumple»: ninguna promesa sin un mecanismo detrás.
const CM_PROMESAS = /lo consulto|lo consultar[eé]|te aviso|te avisar[eé]|te avisamos|te llamamos|te llamar[eé]|te escribir[aá]n|te escribiremos|te contactar[eé]|nos comunicaremos|te confirmo luego/;
// Lo que SOLO el código puede afirmar: una reserva o un pedido registrado, un pago recibido (el comprobante no
// es una acreditación bancaria: prohibición 3), y ser una persona (prohibición 4: nunca negar ser una IA).
const CM_AFIRMA = /\b(qued[oa]|esta|estan) (agendad|confirmad|reservad|registrad|list|hech|fij|pagad|recibid|acreditad|verificad)|\bagende\b|\breserve\b|\bte (agende|reserve)\b|confirm(o|ada|ado) (tu|la|su) (cita|reserva|pedido)|tu (cita|reserva|pedido) (ya )?(esta|quedo|queda)|pago (acreditad|verificad|confirmad)|recibimos tu pago|no soy (una |un )?(ia|inteligencia|bot|robot|asistente virtual)|soy (una |un )?(persona|humana|humano)\b/;
const CM_MONTO = /\b\d[\d.,]*\s*(bs|bolivianos?|usd|dolares)\b|\bbs\.?\s*\d|\$\s*\d/;
// Un hueco de plantilla («a las )», «{{x}}», «undefined») nunca sale.
const CM_HUECO = /\(\s*\)|\ba las?\s*[).,;:!?]|\ba las?\s*$|\bde\s*\)|«\s*»|\{\{|undefined|null\b/;
const CM_PREGUNTA_DE_IDENTIDAD = /\b(eres|es|sos) (el |la )?(doctor|doctora|dr|dra|persona|humano|humana|bot|robot)\b|\bquien (eres|es)\b/;

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
  if (Array.isArray(o.enlacesPermitidos)) {
    const propios = o.enlacesPermitidos.map((x) => String(x || '')).join(' ');
    const enlaces = s.match(/https?:\/\/\S+/gi) || [];
    if (enlaces.some((e) => propios.indexOf(e.replace(/[).,;:!?]+$/, '')) < 0)) return 'enlace_ajeno';
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
  const trozos = String(texto || '').trim().split(/(?<=[.!?…])\s+/);
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
