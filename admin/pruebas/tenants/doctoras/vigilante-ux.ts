/**
 * VIGILANTE DE UX de las doctoras (Andres, 20/10/2026 y 11/10/2026: lo corregido «volvió»). Módulo compartido por `conversacion.test.ts` y `negadas.test.ts` (no es una suite: vitest solo corre `*.test.ts`).
 * `vigilarUx(mundo)` envuelve `mundo.turno`: cada escenario que habla con el flujo pasa por aquí, así que los invariantes valen en TODA la batería (no en estados sueltos). Invariantes:
 *   1. UN BOTÓN (O FILA DE LISTA) YA PULSADO NO REAPARECE en ningún mensaje posterior de esa conversación, por teléfono;
 *   2. NO SE OFRECE ALGO ANTES DE TIEMPO: el PRIMER turno emite exactamente DOS mensajes de texto, sin lista ni botones (el catálogo sale desde el turno siguiente); ninguna imagen sale jamás;
 *   3. UNA SOLA PRESENTACIÓN por mensaje Y UNA POR TELÉFONO: «asistente virtual de la …» sale a lo más una vez en toda la conversación;
 *   4. PÁRRAFOS: cada párrafo (separado por una línea en blanco) tiene a lo más DOS oraciones y, con dos, a lo más 220 caracteres; sin saltos triples ni espacios sobrantes. La partición en oraciones es la
 *      de la LIBRERÍA (`drOraciones` de `dr.js`): no puede haber desacuerdo entre quien reparte y quien vigila;
 *   5. NINGUNA PREGUNTA POR OPCIONES SIN BOTONES: un texto que pregunta por «las opciones», «¿cuál prefieres?» sale con al menos un botón o una lista en ese mismo mensaje;
 *   6. LÍMITES DE WHATSAPP: título de botón ≤ 20 caracteres, de fila de lista ≤ 24, a lo más 3 botones; y NINGUNA clave `link` en ningún payload;
 *   7. NADA PROHIBIDO en ninguna salida: ni monto, ni «inmediato», «primera sesión», «firmeza», «ideal para», «garantizado», «como la foto», ni enlace de mapas, ni `wa.me` en el texto, ni «acreditado/verificado».
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo } from '../../lib/n8n-de-mentira';

const CARPETA_LIB = join(dirname(fileURLToPath(import.meta.url)), '../../../../Flujos/experimental/doctoras/src/lib');
// El código evaluado es el de los archivos del propio repositorio (src/lib), no una entrada externa: solo prueba.
// nosemgrep: devsecops.js-eval-prohibido
export const LIB = new Function(['avisos.js', 'dr.js'].map((a) => readFileSync(a === 'avisos.js' ? join(CARPETA_LIB, '../../../venta-minima/src/lib/avisos.js') : join(CARPETA_LIB, a), 'utf8')).join('\n') + '\nreturn { drOraciones, drParrafos, drNorm, drSeguro, DR_TEXTO_RIESGO, DR_NIEGA_IA, DR_PROHIBIDAS, DR_TEXTOS_COMUNES, drIntencion, drEsBaja, drEsRiesgo, DR_INTENCIONES, drTextoDe };')() as {
  drOraciones: (b: string) => string[]; drParrafos: (t: string) => string; drNorm: (t: string) => string; drSeguro: (t: string) => string;
  DR_TEXTO_RIESGO: string; DR_NIEGA_IA: RegExp; DR_PROHIBIDAS: RegExp; DR_TEXTOS_COMUNES: Record<string, string>; drIntencion: (n: string) => string;
  drEsBaja: (t: string) => boolean; drEsRiesgo: (n: string) => boolean; DR_INTENCIONES: string[]; drTextoDe: (d: J, c: string, e?: J) => string;
};

export interface UxMsg { tipo: string; cuerpo: string; payload: J }
interface UxEstado { pulsados: Map<string, Set<string>>; presentaciones: Map<string, number>; turnos: Map<string, number> }
export const UX_ESTADO = new WeakMap<Mundo, UxEstado>();
export const UX_CONTADOR = { turnos: 0, mundos: new Set<Mundo>() };
export const idsDeBotones = (m: { payload: J }): string[] => {
  const i = (m.payload['interactive'] ?? {}) as J;
  const botones = ((i['action']?.buttons ?? []) as J[]).map((b) => String(b['reply']?.id));
  const filas = ((i['action']?.sections ?? []) as J[]).flatMap((s) => ((s['rows'] ?? []) as J[]).map((r) => String(r['id'])));
  return [...botones, ...filas];
};
export const PARRAFO_MAX_ORACIONES = 2;
export const PARRAFO_MAX_CARACTERES = 220;
/** Las violaciones de párrafos de UN texto. Función pura, probada también con casos negativos. */
export function violacionesDeParrafos(cuerpo: string): string[] {
  const v: string[] = [];
  if (/\n{3,}/.test(cuerpo)) v.push('saltos de línea triples');
  if (cuerpo !== cuerpo.trim() || /[ \t]+\n|\n[ \t]+/.test(cuerpo)) v.push('espacios sobrantes al borde o antes de un salto');
  for (const par of cuerpo.split('\n\n')) {
    if (par.includes('\n')) continue; // listas y rótulos de líneas sueltas
    const oraciones = LIB.drOraciones(par).length;
    if (oraciones > PARRAFO_MAX_ORACIONES) v.push(`un párrafo con ${oraciones} oraciones sin línea en blanco: «${par.slice(0, 40)}…»`);
    else if (oraciones === 2 && par.length > PARRAFO_MAX_CARACTERES) v.push(`un párrafo de 2 oraciones con ${par.length} caracteres`);
  }
  return v;
}
/** ¿Este mensaje contiene la presentación del asistente? */
export const esPresentacion = (cuerpo: string): boolean => /asistente virtual de/i.test(cuerpo);
/** Lo que ningún mensaje a la persona puede decir (el cuerpo visible; el botón de la recepción lleva `wa.me` en su `url`, no en el texto). */
export const PROHIBIDO_EN_SALIDA = /inmediat|primera sesi|firmeza|ideal para|garantiz|como la foto|lifting|\b250\b|\bbs\b|\$|https?:|wa\.me|maps\.|goo\.gl|acreditad|verificad|validad|recibimos tu pago/i;
/**
 * Las violaciones de los invariantes para UN turno; `pulsados` se actualiza con el toque de este turno ANTES de mirar la respuesta. `presentaciones` cuenta, por teléfono, los mensajes con presentación
 * ya enviados. `primerTurno`: este es el primer turno del teléfono. Función pura, probada también con casos negativos.
 */
export function violacionesDeUx(pulsados: Set<string>, entrante: J, mensajes: UxMsg[], presentaciones?: { n: number }, primerTurno = false): string[] {
  const v: string[] = [];
  const inter = entrante['interactive'] as J | undefined;
  const idToque = entrante['type'] === 'interactive' && inter ? String((inter['button_reply'] ?? inter['list_reply'])?.id ?? '') : '';
  if (idToque) pulsados.add(idToque);
  // El PRIMER turno: exactamente DOS mensajes de texto (la presentación y la pregunta), sin lista ni botones. (Salvo que sea una baja, un riesgo o una consulta médica, que mandan sobre la presentación.)
  if (primerTurno && mensajes.length > 0 && mensajes.some((m) => esPresentacion(m.cuerpo))) {
    if (mensajes.length !== 2) v.push(`el primer turno emitió ${mensajes.length} mensajes y tiene que emitir exactamente 2`);
    if (mensajes.some((m) => m.tipo !== 'text')) v.push('el primer turno trae lista o botones antes del catálogo');
  }
  for (const m of mensajes) {
    for (const id of idsDeBotones(m)) if (pulsados.has(id)) v.push(`el botón pulsado «${id}» reapareció`);
    if (m.tipo === 'image') v.push('salió una imagen (el asistente no envía artes)');
    if (/opciones|¿cu[aá]l prefieres|¿con cu[aá]l/i.test(m.cuerpo) && m.tipo !== 'interactive') v.push('el texto pregunta por opciones pero el mensaje no trae ningún botón');
    v.push(...violacionesDeParrafos(m.cuerpo));
    if ((m.cuerpo.match(/asistente virtual/gi) ?? []).length > 1) v.push('el mensaje se presenta más de una vez («asistente virtual» repetido)');
    if (presentaciones && esPresentacion(m.cuerpo)) {
      presentaciones.n += 1;
      if (presentaciones.n > 1) v.push('la presentación del asistente salió más de una vez en la conversación');
    }
    if (PROHIBIDO_EN_SALIDA.test(m.cuerpo.normalize('NFD').replace(/[̀-ͯ]/g, '')) && m.tipo !== 'interactive_url') v.push(`una salida lleva algo prohibido: «${(PROHIBIDO_EN_SALIDA.exec(m.cuerpo.normalize('NFD').replace(/[̀-ͯ]/g, '')) ?? [''])[0]}»`);
    const botones = ((m.payload['interactive']?.action?.buttons ?? []) as J[]);
    if (botones.length > 3) v.push('más de 3 botones');
    for (const b of botones) if (String(b['reply']?.title).length > 20) v.push(`título de botón de más de 20 caracteres: «${b['reply']?.title}»`);
    for (const s of ((m.payload['interactive']?.action?.sections ?? []) as J[])) for (const r of ((s['rows'] ?? []) as J[])) if (String(r['title']).length > 24) v.push(`título de fila de más de 24 caracteres: «${r['title']}»`);
    const cta = m.payload['interactive']?.action?.parameters?.display_text;
    if (cta !== undefined && String(cta).length > 20) v.push(`texto del botón de la recepción de más de 20 caracteres: «${cta}»`);
    if (/"link"\s*:/.test(JSON.stringify(m.payload))) v.push('el payload lleva una clave `link`');
    if (/wa\.me/.test(JSON.stringify({ ...m.payload, interactive: undefined })) ) v.push('wa.me fuera del botón de la recepción');
  }
  return v;
}
export function vigilarUx(mundo: Mundo): void {
  const original = mundo.turno.bind(mundo);
  const estado: UxEstado = { pulsados: new Map(), presentaciones: new Map(), turnos: new Map() };
  UX_ESTADO.set(mundo, estado);
  mundo.turno = (entrada: J, opciones?: Parameters<Mundo['turno']>[1]) => {
    const t = original(entrada, opciones);
    const msg = ((entrada['body']?.value?.messages ?? [])[0] ?? {}) as J;
    const from = String(msg['from'] ?? '');
    const pulsados = estado.pulsados.get(from) ?? new Set<string>();
    estado.pulsados.set(from, pulsados);
    const pres = { n: estado.presentaciones.get(from) ?? 0 };
    const nTurno = estado.turnos.get(from) ?? 0;
    // Los mensajes a la persona de este turno (sin los avisos a la recepción ni los respaldos de texto).
    const salida = t.mensajes.filter((e) => !e.respaldo).map((e) => ({ tipo: e.tipo, cuerpo: e.cuerpo, payload: e.payload }));
    const v = violacionesDeUx(pulsados, msg, salida, pres, nTurno === 0);
    estado.presentaciones.set(from, pres.n);
    estado.turnos.set(from, nTurno + 1);
    UX_CONTADOR.turnos += 1; UX_CONTADOR.mundos.add(mundo);
    expect(v, `invariante de UX violado: ${v.join('; ')}`).toEqual([]);
    return t;
  };
}
