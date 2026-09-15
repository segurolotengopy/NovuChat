/**
 * Neutralización del texto que sale del sistema hacia un tercero.
 *
 * POR QUÉ ESTE MÓDULO EXISTE APARTE. Con Resend, NovuChat componía el correo:
 * se mandaba `text`, se omitía `html`, y la garantía de "nada interpretable"
 * era nuestra y absoluta. **Con FormSubmit el correo lo compone el tercero**, y
 * lo compone en HTML. Ya no controlamos el renderizado.
 *
 * Por eso la neutralización se hace EN ORIGEN. Y por eso vive en su propio
 * archivo, sin dependencias de Firebase: para poder probarla de verdad, sin
 * emulador ni red. Un control sin prueba es una afirmación.
 */

/** CR, LF y NUL: con ellos se inyectan encabezados nuevos en un asunto. */
const RE_ENCABEZADO = /[\r\n\u0000]/g;
/** Controles C0/C1 salvo tabulación y salto de línea. */
const RE_CONTROLES = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
/** Marcas bidireccionales: un texto puede leerse distinto de como se guardó. */
const RE_BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;

const ENTIDADES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

/**
 * Deja un texto incapaz de ser interpretado como marcado por QUIEN SEA que lo
 * renderice después.
 *
 * El escapado de entidades es deliberado aunque el correo pudiera terminar en
 * texto plano: si el tercero lo renderiza como HTML, se lee el texto literal; si
 * lo renderiza como texto, se leen las entidades escritas. Lo segundo es feo y
 * raro —un reclamo casi nunca trae un `<`— y es infinitamente preferible a que
 * un enlace escrito por otra persona llegue vivo a la bandeja de entrada.
 */
export function neutralizar(valor: unknown, maxLargo: number): string {
  if (typeof valor !== 'string') return '';
  return valor
    .replace(RE_CONTROLES, '')
    .replace(RE_BIDI, '')
    .replace(/[&<>"']/g, (c) => ENTIDADES[c] ?? c)
    .slice(0, maxLargo);
}

/**
 * Para valores que van a un encabezado (el asunto): además, sin separadores de
 * línea.
 *
 * EL ORDEN IMPORTA Y NO ES CASUAL. Los separadores se convierten en espacio
 * ANTES de que `neutralizar` barra los caracteres de control, porque ese barrido
 * los BORRA. Con el orden inverso, «Falla del bot\rBcc: …» quedaba como
 * «Falla del botBcc: …»: seguro, pero con las palabras pegadas y —peor— con dos
 * comportamientos distintos para CR y para LF. Un control debe hacer siempre lo
 * mismo; si no, nadie puede razonar sobre él. Lo destapó la prueba
 * «elimina el retorno de carro solo y el NUL».
 */
export function neutralizarEncabezado(valor: unknown, maxLargo: number): string {
  if (typeof valor !== 'string') return '';
  return neutralizar(valor.replace(RE_ENCABEZADO, ' '), maxLargo).trim();
}

/** Separadores de línea y tabulación: en un texto de una sola línea, valen espacio. */
const RE_SEPARADORES = /[\r\n\t\u2028\u2029]+/g;
/** Todos los controles C0/C1, incluidos el salto de línea y la tabulación. */
const RE_TODO_CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Recorta por CARACTERES y no por unidades de UTF-16: `slice` a secas puede
 * partir un emoji por la mitad y dejar un sustituto suelto, que WhatsApp pinta
 * como un rombo con signo de pregunta.
 */
export function recortar(texto: string, maxLargo: number): string {
  const c = Array.from(texto);
  return c.length <= maxLargo ? texto : c.slice(0, maxLargo).join('');
}

/**
 * Texto de UNA línea, para lo que el asistente o un flujo repiten tal cual: sin
 * saltos de línea, sin caracteres de control ni marcas bidireccionales, con los
 * espacios colapsados y recortado a su largo. No escapa marcado: el destino es
 * WhatsApp o el prompt, no un HTML (para eso está `neutralizar`).
 *
 * El salto se convierte en espacio ANTES de barrer los controles, por la misma
 * razón que en `neutralizarEncabezado`: si no, «Plan\nPro» quedaría «PlanPro».
 */
export function textoPlano(valor: unknown, maxLargo: number): string {
  if (typeof valor !== 'string') return '';
  const limpio = valor
    .replace(RE_SEPARADORES, ' ')
    .replace(RE_TODO_CONTROL, '')
    .replace(RE_BIDI, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  return recortar(limpio, maxLargo).trim();
}

/**
 * Texto de VARIAS líneas (un mensaje fijo que sale por WhatsApp tal cual):
 * conserva el salto de línea, que ahí es formato, y barre el resto de los
 * controles. Más de una línea en blanco seguida se colapsa en una.
 */
export function textoConSaltos(valor: unknown, maxLargo: number): string {
  if (typeof valor !== 'string') return '';
  const limpio = valor
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(/\t/g, ' ')
    .replace(RE_CONTROLES, '')
    .replace(RE_BIDI, '')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return recortar(limpio, maxLargo).trim();
}

/**
 * Correo con forma válida. Lista blanca de caracteres, DELIBERADAMENTE MÁS
 * ESTRICTA QUE EL RFC.
 *
 * EL DEFECTO QUE ARREGLA. El patrón anterior era `^[^@\s]+@[^@\s]+\.[^@\s]+$`
 * —"lo que no sea arroba ni espacio"— y aceptaba
 * `reclamos@ejemplo.com/../otro`, `reclamos@ejemplo.com?x=1` y
 * `reclamos@ejemplo.com#frag`. Como este valor se concatena a la URL del punto
 * final de FormSubmit, eso es **inyección de ruta**: cambiaba a qué servicio
 * salían los avisos. Lo destapó la prueba «rechaza valores que podrían alterar
 * la RUTA del punto final».
 *
 * Un patrón de correo perfectamente conforme al RFC sería más permisivo, no
 * menos. Acá no se busca aceptar todo correo legal: se busca aceptar solo lo que
 * es seguro pegar en una URL.
 */
export const CORREO_VALIDO = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/;

/**
 * Alias opaco de FormSubmit. Patrón CERRADO a propósito: sin `/`, `?` ni `#`.
 * Sin esto, quien pudiera escribir la configuración cambiaría la RUTA del punto
 * final y redirigiría los avisos a otro servicio.
 */
export const ALIAS_VALIDO = /^[A-Za-z0-9]{8,64}$/;

/** Campos que FormSubmit interpreta como instrucciones de servicio. */
export const CAMPOS_RESERVADOS_FORMSUBMIT = [
  '_subject', '_template', '_captcha', '_cc', '_replyto', '_next',
  '_autoresponse', '_honey', '_blacklist', '_format', '_url',
] as const;
