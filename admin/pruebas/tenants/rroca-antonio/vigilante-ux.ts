/**
 * VIGILANTE DE UX de «El Puente» de Antonio (Andres, 20/10/2026). Módulo compartido por `venta.test.ts` y `negadas.test.ts` (no es una suite: vitest solo corre `*.test.ts`).
 * `vigilarUx(mundo)` envuelve `mundo.turno`: cada escenario que habla con el flujo pasa por aquí, así que los invariantes valen en TODA la batería (no en estados sueltos). Invariantes:
 *   1. UN BOTÓN (O FILA DE LISTA) YA PULSADO NO REAPARECE en ningún mensaje posterior de esa conversación, por teléfono; tampoco el del producto cuyo QR abrió un prellenado;
 *   2. NO SE OFRECE ALGO ANTES DE TIEMPO: el QR solo sale si en ese turno el cliente eligió un producto (botón, fila de la lista o prellenado del Pack o del Libro), y ningún texto de pago aparece sin QR;
 *   3. UNA SOLA PRESENTACIÓN por mensaje Y UNA POR TELÉFONO: «asistente virtual de Antonio» (y el saludo largo) sale a lo más una vez en toda la conversación;
 *   4. PÁRRAFOS: cada párrafo (separado por una línea en blanco) tiene a lo más DOS oraciones y, con dos, a lo más 220 caracteres; sin saltos triples ni espacios sobrantes. La partición en oraciones es la
 *      de la LIBRERÍA (`raOraciones` de `ra.js`): no puede haber desacuerdo entre quien reparte y quien vigila;
 *   5. NINGUNA PREGUNTA POR OPCIONES SIN BOTONES: un texto que pregunta por «las opciones», «¿cuál prefieres?» o «¿con cuál…?» sale con al menos un botón o una lista en ese mismo mensaje;
 *   6. LÍMITES DE WHATSAPP: título de botón ≤ 20 caracteres, de fila de lista ≤ 24, a lo más 3 botones; y NINGUNA clave `link` en ningún payload (el QR sale por `id` de medio).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo } from '../../lib/n8n-de-mentira';

const CARPETA_LIB = join(dirname(fileURLToPath(import.meta.url)), '../../../../Flujos/experimental/rroca-antonio/src/lib');
// El código evaluado es el de los archivos del propio repositorio (src/lib), no una entrada externa: solo prueba.
// nosemgrep: devsecops.js-eval-prohibido
export const LIB = new Function(['cobro.js', 'avisos.js', 'ra.js'].map((a) => readFileSync(join(CARPETA_LIB, a), 'utf8')).join('\n') + '\nreturn { raOraciones, raParrafos, raNorm, raSeguro, RA_TEXTO_RIESGO, RA_PRODUCTOS, RA_ANGULOS, RA_NIEGA_IA };')() as {
  raOraciones: (b: string) => string[]; raParrafos: (t: string) => string; raNorm: (t: string) => string; raSeguro: (t: string) => string;
  RA_TEXTO_RIESGO: string; RA_PRODUCTOS: Record<string, { boton: string }>; RA_ANGULOS: Record<string, { fijo: string; pregunta: string }>; RA_NIEGA_IA: RegExp;
};

export interface UxMsg { tipo: string; cuerpo: string; payload: J }
interface UxEstado { pulsados: Map<string, Set<string>>; presentaciones: Map<string, number>; turnos: number }
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
    const oraciones = LIB.raOraciones(par).length;
    if (oraciones > PARRAFO_MAX_ORACIONES) v.push(`un párrafo con ${oraciones} oraciones sin línea en blanco: «${par.slice(0, 40)}…»`);
    else if (oraciones === 2 && par.length > PARRAFO_MAX_CARACTERES) v.push(`un párrafo de 2 oraciones con ${par.length} caracteres`);
  }
  return v;
}
/** ¿Este mensaje contiene la presentación del asistente (la frase de presentación o el saludo largo)? */
export const esPresentacion = (cuerpo: string): boolean => /asistente virtual de antonio|qu[eé] gusto saludarte/i.test(cuerpo);
const IDS_DE_PRODUCTO = ['b_pack', 'b_libro', 'b_workbook', 'b_guia', 'b_calendario', 'b_preguntas'];
/**
 * Las violaciones de los invariantes para UN turno; `pulsados` se actualiza con el toque de este turno ANTES de mirar la respuesta. `presentaciones` (opcional) cuenta, por teléfono,
 * los mensajes con presentación ya enviados. Función pura, probada también con casos negativos.
 */
export function violacionesDeUx(pulsados: Set<string>, entrante: J, mensajes: UxMsg[], presentaciones?: { n: number }, transcripcion = ''): string[] {
  const v: string[] = [];
  const inter = entrante['interactive'] as J | undefined;
  const idToque = entrante['type'] === 'interactive' && inter ? String((inter['button_reply'] ?? inter['list_reply'])?.id ?? '') : '';
  if (idToque) pulsados.add(idToque);
  const textoEntrante = entrante['type'] === 'text' ? String((entrante['text'] as J | undefined)?.['body'] ?? '') : '';
  // Una confirmación en texto (o por voz) de UN producto («quiero el libro», «me llevo el pack») también es elegirlo.
  const dicho = textoEntrante || transcripcion;
  const confirmacion = /\b(me llevo|lo compro|quiero (comprar |pagar )?(el|la)\b|quiero comprar)/i.test(dicho) && /\b(pack|libro|workbook|calendario|preguntas)\b/i.test(dicho) && !/informaci|saber|incluye|cu[aá]nto|precio/i.test(dicho);
  const prellenadoDeProducto = /^Hola, quiero conocer el Pack de Reconexi[oó]n/.test(dicho) ? 'b_pack' : (/^Hola, quiero el libro El Puente/.test(dicho) ? 'b_libro' : '');
  const eligioProducto = IDS_DE_PRODUCTO.includes(idToque) || prellenadoDeProducto !== '' || confirmacion;
  for (const m of mensajes) {
    for (const id of idsDeBotones(m)) if (pulsados.has(id)) v.push(`el botón pulsado «${id}» reapareció`);
    if (m.tipo === 'image' && !eligioProducto) v.push('se ofreció el QR (pagar) sin que el cliente eligiera un producto en este turno');
    if (m.tipo !== 'image' && /escanea el qr/i.test(m.cuerpo)) v.push('un texto de pago fuera del QR');
    if (/opciones|¿cu[aá]l prefieres|¿qu[eé] opci[oó]n|¿con cu[aá]l/i.test(m.cuerpo) && m.tipo !== 'interactive') v.push('el texto pregunta por opciones pero el mensaje no trae ningún botón');
    v.push(...violacionesDeParrafos(m.cuerpo));
    if ((m.cuerpo.match(/asistente virtual/gi) ?? []).length > 1) v.push('el mensaje se presenta más de una vez («asistente virtual» repetido)');
    if (presentaciones && esPresentacion(m.cuerpo)) {
      presentaciones.n += 1;
      if (presentaciones.n > 1) v.push('la presentación del asistente salió más de una vez en la conversación');
    }
    const botones = ((m.payload['interactive']?.action?.buttons ?? []) as J[]);
    if (botones.length > 3) v.push('más de 3 botones');
    for (const b of botones) {
      const titulo = String(b['reply']?.title);
      if (/\d/.test(titulo)) {
        // Un botón con precio termina SIEMPRE en « <monto> Bs», sin palabras cortadas ni preposición colgando.
        const m = /^(.*?) (\d+(?:,\d+)?) Bs$/.exec(titulo);
        if (!m) v.push(`botón con precio que no termina en « <monto> Bs»: «${titulo}»`);
        else {
          const vocabulario = new Set(['Mejor', 'el', 'Pack', ...Object.values(LIB.RA_PRODUCTOS).flatMap((p) => String((p as { titulo?: string }).titulo ?? '').split(' '))]);
          for (const palabra of m[1]!.split(' ')) if (!vocabulario.has(palabra)) v.push(`botón con una palabra cortada o desconocida «${palabra}» en «${titulo}»`);
          if (/\b(de|del|el|la|y)$/i.test(m[1]!)) v.push(`botón con una preposición colgando: «${titulo}»`);
        }
      }
    }
    for (const b of botones) if (String(b['reply']?.title).length > 20) v.push(`título de botón de más de 20 caracteres: «${b['reply']?.title}»`);
    for (const s of ((m.payload['interactive']?.action?.sections ?? []) as J[])) for (const r of ((s['rows'] ?? []) as J[])) if (String(r['title']).length > 24) v.push(`título de fila de más de 24 caracteres: «${r['title']}»`);
    if (/"link"\s*:/.test(JSON.stringify(m.payload))) v.push('el payload lleva una clave `link` (el QR sale por id de medio)');
    // Un prellenado del Pack o del Libro que abrió el QR "usa" su botón: no reaparece después.
    if (m.tipo === 'image' && prellenadoDeProducto) pulsados.add(prellenadoDeProducto);
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
    // Los mensajes al cliente de este turno (sin los avisos a Antonio ni los respaldos de texto).
    const salida = t.mensajes.filter((e) => !e.respaldo).map((e) => ({ tipo: e.tipo, cuerpo: e.cuerpo, payload: e.payload }));
    const trans = String((t.porNodo['Preparar transcripción']?.[0]?.['userInput'] ?? '')).replace(/^\(audio transcripto\) /, '').split('\n')[0]!;
    const v = violacionesDeUx(pulsados, msg, salida, pres, trans);
    estado.presentaciones.set(from, pres.n);
    estado.turnos += 1; UX_CONTADOR.turnos += 1; UX_CONTADOR.mundos.add(mundo);
    expect(v, `invariante de UX violado: ${v.join('; ')}`).toEqual([]);
    return t;
  };
}
