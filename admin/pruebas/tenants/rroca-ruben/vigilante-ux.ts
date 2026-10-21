/**
 * VIGILANTE DE UX de «Venta digital de Rubén» (Andres, 20/10/2026). Módulo compartido por `venta.test.ts` y `flujo.test.ts` (no es una suite: vitest solo corre `*.test.ts`).
 * `vigilarUx(mundo)` envuelve `mundo.turno`: cada escenario que habla con el flujo pasa por aquí. Invariantes:
 *   1. UN BOTÓN YA PULSADO NO REAPARECE en ningún mensaje posterior de esa conversación (ni en la respuesta al toque), por teléfono; `b_pack`/`b_libro` tampoco tras un prellenado que abrió el QR;
 *   2. NO SE OFRECE ALGO ANTES DE TIEMPO: el QR (pagar) solo sale si en ese turno el cliente eligió un producto (botón de producto o prellenado del Pack/Libro), y ningún texto de pago aparece sin QR;
 *   3. UNA SOLA PRESENTACIÓN por mensaje (contada por oración con `rrEsPresentacion`, NO por la palabra «asistente») Y UNA POR TELÉFONO (salvo a quien pregunta qué es el asistente): la presentación («asistente virtual de Rubén», el saludo largo) sale a lo más una vez en toda la conversación;
 *   4. PÁRRAFOS: cada párrafo (separado por una línea en blanco) tiene a lo más DOS oraciones y, con dos, a lo más 220 caracteres; sin saltos triples ni espacios sobrantes. La partición en oraciones es la
 *      de la LIBRERÍA (`rrOraciones` de `rr.js`): no puede haber desacuerdo entre quien reparte y quien vigila.
 *   3b. (Silvana, 20/10/2026) LA PRESENTACIÓN SE DICE UNA SOLA VEZ: a lo más una oración de presentación por mensaje y, sumando todos los mensajes de un turno, a lo más una.
 *   5. NINGUNA PREGUNTA POR OPCIONES SIN BOTONES: un texto que pregunta por «las opciones», «¿cuál prefieres?», «¿qué opción…?» o «¿con cuál…?» sale con al menos un botón en ese mismo mensaje (solo se ofrece lo que se cumple).
 *   7. (21/10/2026) NUNCA LA MISMA RESPUESTA DE TEXTO DOS VECES SEGUIDAS al mismo teléfono. Excepciones DECLARADAS (`TEXTOS_FIJOS_DE_ESPERA`): el resultado de un comprobante (cada comprobante es un hecho distinto), el texto fijo del estado «operador» y el de comercio suspendido
 *      (los configura el comercio en la consola), y lo que dice qué ES el asistente (regla dura 4: esa respuesta nunca se sustituye). El QR (imagen) no entra: su pie lleva el pedido.
 *   8. (21/10/2026) CON UN QR ABIERTO, toda pregunta que no habla de pagar recibe una respuesta de contenido: el recordatorio («Ya tienes un QR abierto…») solo sale si el cliente habló de pagar o pidió un producto.
 *   9. (21/10/2026) NINGÚN TEXTO SALIENTE PROMETE ENVIAR imágenes, fotos, capturas, pantallazos o la portada (solo existe el QR como imagen saliente): una oración que dice «no envío imágenes» no cuenta.
 *  10. (21/10/2026) NINGÚN AVISO «TARDÍO» sin un comprobante REGISTRADO: «Guardar comprobante» tiene que haber devuelto la ruta del archivo guardado.
 *   6. MEDIOS ENTRANTES (audio, imagen, documento; 20/10/2026): la respuesta a un medio SIEMPRE trae texto (nunca vacía ni solo una marca), es UN solo mensaje, nunca un QR, y jamás dice «acreditado», «verificado»,
 *      «recibimos tu pago» (el único texto con «confirmamos / validado» es el fijo de comprobante leído, que exige un pedido abierto). Un medio sin respuesta solo es válido si el plan fue callar a propósito (pausa por persona,
 *      comercio suspendido, número extranjero ya atendido hoy); lo demás es un cliente que mandó un audio y no recibió nada.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo } from '../../lib/n8n-de-mentira';

const CARPETA_LIB = join(dirname(fileURLToPath(import.meta.url)), '../../../../Flujos/experimental/rroca-ruben/src/lib');
// El código evaluado es el de los archivos del propio repositorio (src/lib), no una entrada externa: solo prueba.
// nosemgrep: devsecops.js-eval-prohibido
export const LIB = new Function(['cobro.js', 'avisos.js', 'rr.js'].map((a) => readFileSync(join(CARPETA_LIB, a), 'utf8')).join('\n') + '\nreturn { rrOraciones, rrEsPresentacion, rrNorm, rrTienePresentacionIA };')() as { rrOraciones: (b: string) => string[]; rrEsPresentacion: (o: string) => boolean; rrNorm: (t: string) => string; rrTienePresentacionIA: (t: string) => boolean };

export interface UxMsg { tipo: string; cuerpo: string; payload: J }
interface UxEstado { pulsados: Map<string, Set<string>>; presentaciones: Map<string, number>; turnos: number; ultimoTexto: Map<string, string> }
export const UX_ESTADO = new WeakMap<Mundo, UxEstado>();
export const UX_CONTADOR = { turnos: 0, mundos: new Set<Mundo>() };
export const idsDeBotones = (m: { payload: J }): string[] =>
  ((m.payload['interactive']?.action?.buttons ?? []) as J[]).map((b) => String(b['reply']?.id));
export const PARRAFO_MAX_ORACIONES = 2;
export const PARRAFO_MAX_CARACTERES = 220;
/** Las violaciones de párrafos de UN texto. Función pura, probada también con casos negativos. */
export function violacionesDeParrafos(cuerpo: string): string[] {
  const v: string[] = [];
  if (/\n{3,}/.test(cuerpo)) v.push('saltos de línea triples');
  if (cuerpo !== cuerpo.trim() || /[ \t]+\n|\n[ \t]+/.test(cuerpo)) v.push('espacios sobrantes al borde o antes de un salto');
  for (const par of cuerpo.split('\n\n')) {
    if (par.includes('\n')) continue; // listas y rótulos de líneas sueltas
    const oraciones = LIB.rrOraciones(par).length;
    if (oraciones > PARRAFO_MAX_ORACIONES) v.push(`un párrafo con ${oraciones} oraciones sin línea en blanco: «${par.slice(0, 40)}…»`);
    else if (oraciones === 2 && par.length > PARRAFO_MAX_CARACTERES) v.push(`un párrafo de 2 oraciones con ${par.length} caracteres`);
  }
  return v;
}
/** Cuántas veces se presenta el asistente en UN texto («Soy el asistente…», «asistente virtual de Rubén»), contadas por oración. Debe ser a lo más 1 por mensaje y por turno. */
export const contarPresentaciones = (cuerpo: string): number => {
  // Detector PROPIO (no `rrEsPresentacion` del flujo): cuenta «Soy el asistente de Rubén, autor de…», «Te saluda el asistente virtual», «Aquí tu asistente», «Hola, soy el asistente virtual de Rubén».
  const es = (o: string): boolean => /\b(soy|somos) (el |la |un |una |tu |su )?(asistente|ayudante)\b|\basistente (virtual |automatico |digital )?de ruben\b|\b(te saluda|te habla|aqui) (el |tu )?asistente\b/.test(LIB.rrNorm(o));
  return cuerpo.split('\n').reduce((n, linea) => n + LIB.rrOraciones(linea).filter(es).length, 0);
};
/** ¿Este mensaje contiene la presentación del asistente (la frase de presentación o el saludo largo)? */
export const esPresentacion = (cuerpo: string): boolean => /asistente virtual de rub|qu[eé] gusto saludarte|te cuento: el libro digital/i.test(cuerpo);
/**
 * Las violaciones de los invariantes para UN turno; `pulsados` se actualiza con el toque de este turno ANTES de mirar la respuesta. `presentaciones` (opcional) cuenta, por teléfono,
 * los mensajes con presentación ya enviados (se actualiza aquí). Función pura, probada también con casos negativos.
 */
/**
 * ¿El cliente pregunta qué ES el asistente? LISTA INDEPENDIENTE de la del flujo (no usa `rrPreguntaPorIA`, o la excepción sería tautológica) y deliberadamente ancha: solo exime la cuenta
 * de «una presentación por teléfono» (regla dura 4 sobre la de Silvana), nunca la de «una por mensaje».
 */
export const preguntaPorIdentidad = (texto: string): boolean => {
  const n = LIB.rrNorm(texto);
  return /\b(eres|sos|es|usted|hablo|hablando|conversando|quien|hay|voce|estou|who|are you|is this|am i|me responde|me atiende|me contesta|respondiendo)\b.*\b(bot|b0t|vot|robot|robo|chatbot|chatgpt|gemini|ia|ai|inteligencia|maquina|programa|persona|pessoa|humano|humana|human|alguien|alguem|gente|automatic\w*|automated)\b|\b(eres|sos|usted es|es usted|hablo con|hablando con|conversando con|quien es|quien eres)\b.*\b(ruben|asistente|real|de verdad)\b|\bresponde\w* (una |un )?(ia|robot|bot|persona|maquina|humano)\b|\brespuestas son automatic\w*|\bde verdad\b|\b(real person|real human|persona real|alguien real|ser humano)\b|\bquien (eres|me|contesta|responde|atiende)\b|\bcon quien hablo\b|\bruben eres\b|^(bot|robot|chatbot|b0t|vot|contestador)$/.test(n);
};
/** El texto que devolvió el modelo en un turno (el doble de «Conversar con el modelo»), o ''. */
export const textoDelModelo = (registro: { nodo: string; respuesta?: unknown }[]): string => {
  const r = registro.find((x) => x.nodo === 'Conversar con el modelo')?.respuesta as J | undefined;
  return String(r?.['candidates']?.[0]?.content?.parts?.[0]?.text ?? '');
};
/**
 * ¿El texto del modelo SE DECLARA una IA / asistente virtual / no una persona? Detector PROPIO y estrecho del vigilante (no usa `rrDiceIA` ni `rrTienePresentacionIA` del flujo: sería tautológico).
 * Mira el texto oración por oración, sin el título del libro («IA para Emprendedores»).
 */
export const seDeclaraIA = (texto: string): boolean => {
  const t = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ia para emprendedores( independientes)?/g, ' ');
  // Primera persona + una cualidad de máquina en las palabras siguientes (ventana corta), o las formas fijas; no basta nombrar la IA («la inteligencia artificial te ayuda»).
  const ventana = /(?<![\p{L}\p{N}]no )\b(soy|somos|me presento|respondo|funciono|trabajo|opero|estoy hech[oa]|fui cread[oa])\b(?:\s+[^\s.,;:!?]+){0,4}?[\s,;:]+(ia|ai|inteligencia artificial|artificial|automatic\w*|programa|bot|chatbot|robot|maquina|virtual|digital|inteligente|hech[oa] (con|por)|impulsad[oa] por|basad[oa] en)(?![\p{L}\p{N}])/u;
  return ventana.test(t) || /\basistente virtual de ruben\b|\bno (soy )?(una |un )?(persona|humano|humana)\b|\bno soy ruben\b|\((una )ia\)/.test(t);
};
/** ¿El modelo se hizo pasar por Rubén o por una persona viva? (detector propio del vigilante). El flujo lo sustituye por la identidad, que es una presentación legítima. */
export const suplantaARuben = (texto: string): boolean => {
  const n = LIB.rrNorm(texto);
  // Criterio propio e inverso: mencionar a Rubén sin que sea tercera persona o el asistente «de Rubén», o una autodescripción humana.
  const menciona = /\b(ruben|roca)\b/.test(n);
  const tercera = /\bruben (roca )?(es|fue|escribio|creo|explica|ensena|muestra|recomienda|dice|cuenta|tiene|trabaja)\b|\bautor( del libro)? es ruben\b|\bel libro (de|del) ruben\b|habla ruben\b.*videos|videos.*habla ruben|\basistente( \w+){0,2} (de|del) ruben\b|\bno soy ruben\b.*(asistente|ia|virtual)|\bsi (prefieres|quieres|necesitas)\b.*\bruben\b.*(boton|whatsapp|chat|directo)/.test(n);
  return (menciona && !tercera) || /\b(soy|sou) (yo |el |la |un |una )?(autor|escritor|dueno|creador del libro|persona|humano|humana|ana|maria|mujer)\b|\bestoy viv[oa]\b|\bde carne y hueso\b|\bmi libro\b|\bescribi\b|\bmismisimo\b|\bme llamo\b|\bmi nombre es\b|\bsoy yo\b|\bte escribo\b|\bde los videos\b|\bpersona detras\b/.test(n);
};
/** Las oraciones del texto del modelo que (según el detector propio del vigilante) suplantan a Rubén. */
export const frasesQueSuplantan = (textoModelo: string): string[] =>
  // Solo oraciones de AUTODESCRIPCIÓN (primera persona, «te escribe/habla…», firma): «Eso lo ve Rubén directamente» (tercera persona, texto fijo del código) no es una suplantación.
  textoModelo.replace(/«[^»]*»|"[^"]*"/g, ' ').replace(/\s*\n\s*/g, ' ').split(/(?<=[.!?…])\s+/).filter((o) => o.trim().length >= 6 && /\b(soy|sou|i m|i am|me llamo|nombre es|mi libro|escribi|estoy viv|hablas con|hablando con|habla ruben|aqui ruben|ruben aqui|ruben por aqui|ordenes|carne y hueso|mismisimo|personalmente|te escribe|te habla|le escribe|le habla|te saluda|te atiende)\b/.test(LIB.rrNorm(o)) && suplantaARuben(o));

/** Los planes que callan a propósito: la pausa por persona, el comercio suspendido y el número de otro país al que ya se le respondió hoy. */
export const PLANES_QUE_CALLAN = ['nada', 'bloqueado', 'suspendido', 'uso_extendido', 'extranjero_repetido'];
const TEXTO_DE_COMPROBANTE_LEIDO = /Ya recibí tu comprobante, dame un momento mientras confirmamos tu pago/;
const ACREDITACION = /acreditad|verificad|recibimos tu pago|pago (recibido|confirmado|aprobado)|tu pago (lleg|ingres)/i;
/** Las violaciones del invariante 6 para UN turno. `entrante` = el mensaje de Meta; `plan` = el plan del resumen del turno. Función pura, probada también con casos negativos. */
export function violacionesDeMedio(entrante: J, mensajes: UxMsg[], plan: string): string[] {
  const v: string[] = [];
  if (!['audio', 'voice', 'image', 'document'].includes(String(entrante['type'] ?? ''))) return v;
  if (mensajes.length === 0 && !PLANES_QUE_CALLAN.includes(plan)) v.push(`un medio (${String(entrante['type'])}) se quedó sin respuesta (plan «${plan}»)`);
  if (mensajes.length > 1) v.push(`un medio recibió ${mensajes.length} mensajes en el mismo turno`);
  for (const m of mensajes) {
    if (m.cuerpo.trim() === '') v.push('la respuesta a un medio no trae texto');
    if (m.tipo === 'image') v.push('la respuesta a un medio es un QR');
    const sinFijo = m.cuerpo.replace(TEXTO_DE_COMPROBANTE_LEIDO, ' ');
    if (ACREDITACION.test(sinFijo)) v.push('la respuesta a un medio dice que un pago está acreditado, verificado o recibido (prohibición 3)');
  }
  return v;
}

/** Los planes cuyo texto se repite A PROPÓSITO (declarados): el resultado de un comprobante y el texto fijo que el comercio configura en la consola para el estado «operador» (uso extendido) o la suspensión. */
export const TEXTOS_FIJOS_DE_ESPERA = ['comprobante', 'uso_extendido', 'suspendido'];
/** Invariante 7. `anterior` = el último texto (normalizado) que se le envió a ese teléfono, o ''. Función pura, probada también con casos negativos. */
export function violacionesDeRepeticion(anterior: string, mensajes: UxMsg[], plan: string): string[] {
  const v: string[] = [];
  if (TEXTOS_FIJOS_DE_ESPERA.includes(plan)) return v;
  for (const m of mensajes) {
    if (m.tipo === 'image' || m.cuerpo.trim() === '' || seDeclaraIA(m.cuerpo)) continue;
    if (anterior !== '' && LIB.rrNorm(m.cuerpo) === anterior) v.push(`la misma respuesta dos veces seguidas: «${m.cuerpo.slice(0, 40)}…»`);
  }
  return v;
}
/** Invariante 8. Detector PROPIO de «habla de pagar» (no usa `rrHablaDePagar` del flujo). */
export const hablaDePagar = (texto: string): boolean => /\b(pague|pagado|pagando|transferi|transferencia|transfiero|deposite|deposito|comprobante|qr|monto|como (te |lo )?(pago|pagar)|donde (pago|pagar)|quiero (el|la|los|las)|dame|comprar|compro)\b/.test(LIB.rrNorm(texto));
export function violacionesDeQrAbierto(entrante: J, mensajes: UxMsg[]): string[] {
  const v: string[] = [];
  const inter = entrante['interactive'] as J | undefined;
  const id = entrante['type'] === 'interactive' && inter ? String((inter['button_reply'] ?? inter['list_reply'])?.id ?? '') : '';
  const texto = entrante['type'] === 'text' ? String((entrante['text'] as J | undefined)?.['body'] ?? '') : '';
  const preguntaDeContenido = (texto.includes('?') && !hablaDePagar(texto)) || id === 'b_info' || id === 'b_precios';
  if (preguntaDeContenido && mensajes.some((m) => /Ya tienes un QR abierto/.test(m.cuerpo))) v.push('con un QR abierto, una pregunta que no habla de pagar recibió el recordatorio en vez de una respuesta de contenido');
  return v;
}
/** Invariante 9. */
export function violacionesDePromesaDeImagen(mensajes: UxMsg[]): string[] {
  const v: string[] = [];
  const OBJETO = /\b(imagen|imagenes|foto|fotos|fotografia|fotografias|captura|capturas|pantallazo|pantallazos|screenshot|screenshots|portada)\b/;
  const PROMETE = /\b(te (muestro|envio|mando|comparto|paso|adjunto|enviare|mandare|mostrare)|(puedo|podria|podemos|voy a) (mostrar|enviar|mandar|compartir|pasar|adjuntar)(te)?|aqui (tienes|te dejo)|te dejo|adjunto)\b/;
  for (const m of mensajes) {
    if (m.tipo === 'image') continue;
    for (const o of m.cuerpo.split(/(?<=[.!?…])\s+|\n+/)) {
      const n = LIB.rrNorm(o);
      if (/\bno\b/.test(n)) continue; // «no tengo imágenes para mostrarte», «no envío imágenes»
      if (PROMETE.test(n) && OBJETO.test(n)) v.push(`un texto promete enviar imágenes: «${o.slice(0, 50)}»`);
    }
  }
  return v;
}
/** Invariante 10: `guardada` = «Guardar comprobante» devolvió la ruta del archivo; `avisos`/`mensajes` = lo que salió en el turno. */
export function violacionesDeAvisoTardio(avisos: string[], mensajes: UxMsg[], guardada: boolean): string[] {
  const v: string[] = [];
  if (guardada) return v;
  if (avisos.some((a) => /comprobante tard[ií]o/i.test(a))) v.push('salió un aviso «tardío» a Rubén sin un comprobante guardado');
  if (mensajes.some((m) => /despu[eé]s de los 15 minutos del QR[^]*(Ya lo pas[eé]|Le avis[eé])/i.test(m.cuerpo))) v.push('el texto «tardío» dice que se pasó a Rubén sin un comprobante guardado');
  return v;
}
export function violacionesDeUx(pulsados: Set<string>, entrante: J, mensajes: UxMsg[], presentaciones?: { n: number }, textoModelo = ''): string[] {
  const v: string[] = [];
  const inter = entrante['interactive'] as J | undefined;
  const idToque = entrante['type'] === 'interactive' && inter ? String((inter['button_reply'] ?? inter['list_reply'])?.id ?? '') : '';
  // Excepción declarada (M3): «Más información» que llega como PRIMER mensaje de un teléfono recibe el saludo, que la ofrece: el cliente aún no la ha visto, así que no cuenta como pulsada.
  const infoSinVer = (idToque === 'b_info' || idToque === 'b_precios') && !!presentaciones && presentaciones.n === 0 && mensajes.some((m) => esPresentacion(m.cuerpo));
  if (idToque && !infoSinVer) pulsados.add(idToque);
  const textoEntrante = entrante['type'] === 'text' ? String((entrante['text'] as J | undefined)?.['body'] ?? '') : '';
  const modeloDijoIA = seDeclaraIA(textoModelo);
  const preguntaIA = preguntaPorIdentidad(textoEntrante) || modeloDijoIA || suplantaARuben(textoModelo);
  // INVARIANTE (regla dura 4, ronda 5): si el texto del modelo suplanta a Rubén, NINGÚN mensaje saliente puede contener esa oración.
  for (const f of frasesQueSuplantan(textoModelo)) {
    const nf = LIB.rrNorm(f);
    // «no soy Rubén ni una persona» (la identidad fija) contiene «soy Rubén» negado: no cuenta.
    if (mensajes.some((m) => LIB.rrNorm(m.cuerpo).replace(/\bno (soy|es|somos) (el mismo |el propio )?ruben\b/g, ' ').includes(nf))) v.push(`salió una oración que suplanta a Rubén: «${f.slice(0, 40)}»`);
  }
  // INVARIANTE (regla dura 4): si el modelo dijo qué es el asistente (IA, virtual…), el mensaje que salió lo trae; jamás se pierde esa respuesta.
  if (modeloDijoIA && mensajes.length && !mensajes.some((m) => seDeclaraIA(m.cuerpo))) v.push('el modelo reconoció ser un asistente virtual/IA y el mensaje que salió no lo trae (regla dura 4)');
  const eligioProducto = ['b_pack', 'b_libro', 'b_closer', 'b_videos'].includes(idToque) || /^Hola Rubén, quiero (el Pack Completo|el libro IA para Emprendedores)/.test(textoEntrante);
  const enElTurno = mensajes.reduce((n, m) => n + contarPresentaciones(m.cuerpo), 0);
  if (enElTurno > 1) v.push(`la presentación del asistente salió ${enElTurno} veces en el mismo turno`);
  for (const m of mensajes) {
    for (const id of idsDeBotones(m)) if (pulsados.has(id)) v.push(`el botón pulsado «${id}» reapareció`);
    if (m.tipo === 'image' && !eligioProducto) v.push('se ofreció el QR (pagar) sin que el cliente eligiera un producto en este turno');
    if (m.tipo !== 'image' && /escanea el qr/i.test(m.cuerpo)) v.push('un texto de pago fuera del QR');
    if (m.tipo === 'interactive' && idsDeBotones(m).length && !eligioProducto && /(pagar|\bqr\b)/i.test(((m.payload['interactive']?.action?.buttons ?? []) as J[]).map((b) => String(b['reply']?.title)).join(' '))) v.push('un botón de pago antes de elegir producto');
    if (/opciones|¿cu[aá]l prefieres|¿qu[eé] opci[oó]n|¿con cu[aá]l/i.test(m.cuerpo) && m.tipo !== 'interactive') v.push('el texto pregunta por opciones pero el mensaje no trae ningún botón');
    v.push(...violacionesDeParrafos(m.cuerpo));
    // (La cuenta es de PRESENTACIONES, no de la palabra «asistente»: el capítulo 9 del libro dice «asistente personal de IA».) Ver `enElTurno` arriba.
    // La cuenta por teléfono usa `contarPresentaciones` (ve también «Soy el asistente de Rubén, autor de…»), no solo la frase «asistente virtual de Rubén».
    if (presentaciones && (esPresentacion(m.cuerpo) || contarPresentaciones(m.cuerpo) > 0)) {
      presentaciones.n += 1;
      // Quien PREGUNTA qué es el asistente («¿eres un bot?») recibe la presentación aunque ya la haya leído (prohibición 4).
      if (presentaciones.n > 1 && !preguntaIA) v.push('la presentación del asistente salió más de una vez en la conversación');
    }
    // Un prellenado del Pack o del Libro que abrió el QR "usa" su botón: no reaparece después.
    if (m.tipo === 'image') {
      if (/^Hola Rubén, quiero el Pack Completo/.test(textoEntrante)) pulsados.add('b_pack');
      if (/^Hola Rubén, quiero el libro IA para Emprendedores/.test(textoEntrante)) pulsados.add('b_libro');
    }
  }
  return v;
}
export function vigilarUx(mundo: Mundo): void {
  const original = mundo.turno.bind(mundo);
  const estado: UxEstado = { pulsados: new Map(), presentaciones: new Map(), turnos: 0, ultimoTexto: new Map() };
  UX_ESTADO.set(mundo, estado);
  mundo.turno = (entrada: J, opciones?: Parameters<Mundo['turno']>[1]) => {
    const t = original(entrada, opciones);
    const msg = ((entrada['body']?.value?.messages ?? [])[0] ?? {}) as J;
    const from = String(msg['from'] ?? '');
    const pulsados = estado.pulsados.get(from) ?? new Set<string>();
    estado.pulsados.set(from, pulsados);
    const pres = { n: estado.presentaciones.get(from) ?? 0 };
    // Los mensajes al cliente de este turno (sin los avisos a Rubén ni los respaldos de texto).
    const salida = t.mensajes.filter((e) => !e.respaldo).map((e) => ({ tipo: e.tipo, cuerpo: e.cuerpo, payload: e.payload }));
    const v = violacionesDeUx(pulsados, msg, salida, pres, textoDelModelo(t.registro));
    // Invariante 6: los medios. Un QR abierto + comprobante es el único caso en que la respuesta a una imagen es el texto de «comprobante leído» (permitido arriba por su frase exacta).
    v.push(...violacionesDeMedio(msg, salida, String((t.resumen ?? {})['plan'] ?? 'nada')));
    // Invariantes 7 a 10 (21/10/2026). El plan está en `resumen.resumen.plan` del nodo «Resumen del turno».
    const plan = String(((t.resumen ?? {})['resumen'] as J | undefined)?.['plan'] ?? 'nada');
    v.push(...violacionesDeRepeticion(estado.ultimoTexto.get(from) ?? '', salida, plan));
    const ultimo = [...salida].reverse().find((m) => m.tipo !== 'image' && m.cuerpo.trim() !== '');
    if (salida.some((m) => m.tipo === 'image')) estado.ultimoTexto.set(from, '');
    else if (ultimo) estado.ultimoTexto.set(from, LIB.rrNorm(ultimo.cuerpo));
    v.push(...violacionesDeQrAbierto(msg, salida));
    v.push(...violacionesDePromesaDeImagen(salida));
    const guardado = t.registro.find((x) => x.nodo === 'Guardar comprobante')?.respuesta as J | undefined;
    v.push(...violacionesDeAvisoTardio(t.avisos.map((a) => a.cuerpo), salida, typeof guardado?.['body']?.['ruta'] === 'string'));
    estado.presentaciones.set(from, pres.n);
    estado.turnos += 1; UX_CONTADOR.turnos += 1; UX_CONTADOR.mundos.add(mundo);
    expect(v, `invariante de UX violado: ${v.join('; ')}`).toEqual([]);
    return t;
  };
}
