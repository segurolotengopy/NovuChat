/**
 * INVARIANTES GLOBALES DE UX SOBRE LO QUE SE LE ESCRIBE AL CLIENTE (27/11/2026): piezas puras.
 *
 *  - PÁRRAFOS: ningún bloque (separado por línea en blanco) de un texto del asistente junta más de 2 oraciones. Las listas con viñetas
 *    («• Nombre — precio») y los bloques de varias líneas no se parten. Usa la MISMA partición de oraciones que la pieza común
 *    (`ctOraciones`, `Flujos/src/core/texto/parrafos.js`): quien reparte y quien vigila no pueden discrepar.
 *  - OPCIONES: toda pregunta por opciones («¿A o B?», «1) … 2) …») sale con botón o lista, nunca como texto plano.
 *
 * Origen: las invariantes de la batería del chat de NovuChat, subidas a una prueba común sobre los flujos de producción.
 */
import { cargarFuente } from '../fuente-vm';

const PARRAFOS = cargarFuente<{ ctOraciones: (b: string) => string[] }>(['Flujos/src/core/texto/parrafos.js'], ['ctOraciones']);

export const MAX_ORACIONES_POR_PARRAFO = 2;

/** Los bloques de `texto` con más de 2 oraciones (solo bloques de una línea; viñetas y listas no cuentan). */
export function parrafosLargos(texto: string): string[] {
  return String(texto ?? '').replace(/\r\n?/g, '\n').split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b !== '' && !b.includes('\n') && !b.startsWith('•') && PARRAFOS.ctOraciones(b).length > MAX_ORACIONES_POR_PARRAFO);
}

export interface MensajeDeSalida { texto?: string; payload?: { type?: string; text?: { body?: string }; interactive?: { type?: string } } }

/** ¿El mensaje es interactivo (botones, lista o enlace)? */
export const esInteractivo = (m: MensajeDeSalida): boolean => m.payload?.type === 'interactive' && typeof m.payload.interactive?.type === 'string';

/** ¿El texto pregunta por opciones? «¿… A o B?» (la pregunta final con «o» entre alternativas) o una enumeración «1) … 2) …» / «1. … 2. …». */
export function preguntaPorOpciones(texto: string): boolean {
  const t = String(texto ?? '');
  if (/(?:^|\n)\s*1[.)]\s.+\n\s*2[.)]\s/.test(t)) return true;
  const preguntas = t.match(/¿[^?]*\?/g) ?? [];
  const ultima = preguntas[preguntas.length - 1] ?? '';
  return /¿\s*(?:quieres|prefieres|prefiere|desea|deseas|te gustar[ií]a|le gustar[ií]a|cu[aá]l|qu[eé] (?:opci[oó]n|prefieres))[^?]*\s+o\s+[^?]+\?/i.test(ultima);
}

/** Los problemas de un mensaje de salida contra las dos reglas. */
export function problemasDeMensaje(m: MensajeDeSalida): string[] {
  const texto = m.texto ?? m.payload?.text?.body ?? '';
  const out = parrafosLargos(texto).map((p) => `párrafo con más de ${MAX_ORACIONES_POR_PARRAFO} oraciones: «${p.slice(0, 60)}…»`);
  if (preguntaPorOpciones(texto) && !esInteractivo(m)) out.push('pregunta por opciones sin botón ni lista');
  return out;
}
