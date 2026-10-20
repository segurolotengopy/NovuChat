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
export const LIB = new Function(['cobro.js', 'avisos.js', 'rr.js'].map((a) => readFileSync(join(CARPETA_LIB, a), 'utf8')).join('\n') + '\nreturn { rrOraciones, rrEsPresentacion, rrNorm, rrPreguntaPorIA };')() as { rrOraciones: (b: string) => string[]; rrEsPresentacion: (o: string) => boolean; rrNorm: (t: string) => string; rrPreguntaPorIA: (n: string) => boolean };

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
export const contarPresentaciones = (cuerpo: string): number =>
  cuerpo.split('\n').reduce((n, linea) => n + LIB.rrOraciones(linea).filter((o) => LIB.rrEsPresentacion(o)).length, 0);
/** ¿Este mensaje contiene la presentación del asistente (la frase de presentación o el saludo largo)? */
export const esPresentacion = (cuerpo: string): boolean => /asistente virtual de rub|qu[eé] gusto saludarte|te cuento: el libro digital/i.test(cuerpo);
/**
 * Las violaciones de los invariantes para UN turno; `pulsados` se actualiza con el toque de este turno ANTES de mirar la respuesta. `presentaciones` (opcional) cuenta, por teléfono,
 * los mensajes con presentación ya enviados (se actualiza aquí). Función pura, probada también con casos negativos.
 */
export function violacionesDeUx(pulsados: Set<string>, entrante: J, mensajes: UxMsg[], presentaciones?: { n: number }): string[] {
  const v: string[] = [];
  const inter = entrante['interactive'] as J | undefined;
  const idToque = entrante['type'] === 'interactive' && inter ? String((inter['button_reply'] ?? inter['list_reply'])?.id ?? '') : '';
  // Excepción declarada (M3): «Más información» que llega como PRIMER mensaje de un teléfono recibe el saludo, que la ofrece: el cliente aún no la ha visto, así que no cuenta como pulsada.
  const infoSinVer = idToque === 'b_info' && !!presentaciones && presentaciones.n === 0 && mensajes.some((m) => esPresentacion(m.cuerpo));
  if (idToque && !infoSinVer) pulsados.add(idToque);
  const textoEntrante = entrante['type'] === 'text' ? String((entrante['text'] as J | undefined)?.['body'] ?? '') : '';
  const preguntaIA = LIB.rrPreguntaPorIA(LIB.rrNorm(textoEntrante));
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
    if (presentaciones && esPresentacion(m.cuerpo)) {
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
    const v = violacionesDeUx(pulsados, msg, salida, pres);
    estado.presentaciones.set(from, pres.n);
    estado.turnos += 1; UX_CONTADOR.turnos += 1; UX_CONTADOR.mundos.add(mundo);
    expect(v, `invariante de UX violado: ${v.join('; ')}`).toEqual([]);
    return t;
  };
}
