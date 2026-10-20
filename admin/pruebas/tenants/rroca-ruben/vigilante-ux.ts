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
interface UxEstado { pulsados: Map<string, Set<string>>; presentaciones: Map<string, number>; turnos: number }
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
  // Primera persona: «soy el asistente virtual…», «soy una IA», «asistente virtual de Rubén», «no soy una persona»; no basta nombrar la IA («la inteligencia artificial te ayuda»).
  return /(?<!\bno )\b(soy|somos) (el |la |un |una |su |tu )?asistente (virtual|automatico|digital|artificial|de ia|con ia)\b|\basistente virtual de ruben\b|(?<!\bno )\bsoy (una |un )?(ia|bot|chatbot|robot|programa|inteligencia artificial)\b|\bno (soy )?(una |un )?(persona|humano|humana)\b|\bno soy ruben\b|\b(funciono|trabajo) con (ia|inteligencia artificial)\b|\b(impulsad|basad)[oa] (por|en) (ia|inteligencia artificial)\b|\((una )?ia\)/.test(t);
};
/** ¿El modelo se hizo pasar por Rubén o por una persona viva? (detector propio del vigilante). El flujo lo sustituye por la identidad, que es una presentación legítima. */
export const suplantaARuben = (texto: string): boolean => /\b(soy|sou|i m|i am|yo|hablas con|hablando con|te escribo|te escribe|te habla|me llamo|mi nombre es)\b(?! (el|la|un|una|su|tu) asistente)[^.?!]{0,25}\bruben\b|\b(soy|sou) (yo |el |la |un |una )?(autor|escritor|dueno|creador|persona|humano|humana|ana|maria)\b|\bestoy viv[oa]\b|\ba tus ordenes\b|\bescribi (el|este) libro\b|\baqui ruben\b/.test(LIB.rrNorm(texto));
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
  const estado: UxEstado = { pulsados: new Map(), presentaciones: new Map(), turnos: 0 };
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
    estado.presentaciones.set(from, pres.n);
    estado.turnos += 1; UX_CONTADOR.turnos += 1; UX_CONTADOR.mundos.add(mundo);
    expect(v, `invariante de UX violado: ${v.join('; ')}`).toEqual([]);
    return t;
  };
}
