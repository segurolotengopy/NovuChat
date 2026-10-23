/**
 * VIGILANTE DE UX de «El Puente» de Antonio (Andres, 20/10/2026). Módulo compartido por `venta.test.ts` y `negadas.test.ts` (no es una suite: vitest solo corre `*.test.ts`).
 * `vigilarUx(mundo)` envuelve `mundo.turno`: cada escenario que habla con el flujo pasa por aquí, así que los invariantes valen en TODA la batería (no en estados sueltos). Invariantes:
 *   1. UN BOTÓN (O FILA DE LISTA) YA PULSADO NO REAPARECE en ningún mensaje posterior de esa conversación, por teléfono; tampoco el del producto cuyo QR abrió un prellenado;
 *   2. NO SE OFRECE ALGO ANTES DE TIEMPO: el QR solo sale si en ese turno el cliente eligió un producto (botón, fila de la lista o prellenado del Pack o del Libro), y ningún texto de pago aparece sin QR;
 *   3. UNA SOLA PRESENTACIÓN por mensaje Y UNA POR TELÉFONO: «Soy el asistente virtual del <negocio de la Consola>» (y el saludo largo) sale a lo más una vez en toda la conversación, y NUNCA con el nombre de una persona;
 *   4. PÁRRAFOS: cada párrafo (separado por una línea en blanco) tiene a lo más DOS oraciones y, con dos, a lo más 220 caracteres; sin saltos triples ni espacios sobrantes. La partición en oraciones es la
 *      de la LIBRERÍA (`raOraciones` de `ra.js`): no puede haber desacuerdo entre quien reparte y quien vigila;
 *   5. NINGUNA PREGUNTA POR OPCIONES SIN BOTONES: un texto que pregunta por «las opciones», «¿cuál prefieres?» o «¿con cuál…?» sale con al menos un botón o una lista en ese mismo mensaje;
 *   6. LÍMITES DE WHATSAPP: título de botón ≤ 20 caracteres, de fila de lista ≤ 24, a lo más 3 botones; y NINGUNA clave `link` en ningún payload (el QR sale por `id` de medio).
 * PR-D (22/10/2026):
 *   7. NUNCA EL MISMO TEXTO DOS VECES SEGUIDAS a un teléfono (exentos: el QR, el resultado de un comprobante, la protección ante violencia o miedo, el texto a un número extranjero y la presentación);
 *   8. CON UN QR ABIERTO (el servidor dice `cobro.pendiente`) no hay un segundo QR ni botones de producto en ningún mensaje: solo texto plano (el botón de Antonio va solo al derivar, invariante 13);
 *   9. SIN CONFIGURACIÓN (el panel falló o no trae catálogo) no hay montos, ni QR, ni botones de producto, y el modelo no contesta;
 *  10. EL FLUJO NO PROMETE IMÁGENES: ningún texto dice «te envío/muestro/comparto» una foto, imagen, captura o la portada;
 *  11. UNA NOTA DE VOZ DE MENOS DE 3 PALABRAS nunca llega al modelo;
 *  12. EL MENÚ NO SALE ANTES DE TIEMPO: en las dos primeras respuestas a un teléfono, un mensaje libre (sin precio, catálogo, compra ni producto) no recibe botones de producto ni montos.
 * Botón de Antonio (23/10/2026, regla de Andres):
 *  13. EL BOTÓN DE CONTACTO VA SOLO AL DERIVAR, por tipo de plan: una respuesta RESUELTA (`PLANES_SIN_BOTON`: precio, catálogo, imágenes, resultado, menú, bonos, recordatorio del QR, saludo, conversación, puente, opciones…) sale como texto
 *      plano o con sus botones de producto, NUNCA con el botón de Antonio; un plan que deriva (`PLANES_CON_BOTON`: derivar, consulta, repetido, fuera de país, cierre del cobro…) lo lleva siempre.
 * Rehecho de Antonio sobre la Entrega 2 (23/10/2026):
 *  14. LA ETIQUETA DE UN BOTÓN CON PRECIO ES «<nombre DEL CATÁLOGO> <precio>Bs» (≤ 20 caracteres, el nombre completo o recortado por palabras): ningún nombre ni precio sale del código;
 *  15. EL BOTÓN «Ver opciones» (el del puente) NO lleva precio ni dígitos, y nunca sale junto a botones de producto;
 *  16. «Ver complementos» abre la lista de bonos: es el único botón de menú sin precio;
 *  17. LO QUE SE OFRECE SE CUMPLE: tras «¿Te muestro las opciones?» (el puente, o el precio de un producto antes de la charla), el «sí» o el botón «Ver opciones» reciben los botones de producto con precio (salvo con un QR abierto);
 *      y ese «sí» no es «el menú antes de tiempo» (invariante 12).
 */
import { expect } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo } from '../../lib/n8n-de-mentira';
import { cargarLibrerias } from './librerias';

export const LIB = cargarLibrerias('raOraciones, raParrafos, raNorm, raSeguro, RA_TEXTO_RIESGO, RA_PRODUCTOS, RA_ANGULOS, RA_NIEGA_IA') as {
  raOraciones: (b: string) => string[]; raParrafos: (t: string) => string; raNorm: (t: string) => string; raSeguro: (t: string) => string;
  RA_TEXTO_RIESGO: string; RA_PRODUCTOS: Record<string, { boton: string }>; RA_ANGULOS: Record<string, { fijo: string; pregunta: string }>; RA_NIEGA_IA: RegExp;
};

export interface UxMsg { tipo: string; cuerpo: string; payload: J }
interface UxEstado { pulsados: Map<string, Set<string>>; presentaciones: Map<string, number>; turnos: number; ultimo: Map<string, string>; respuestas: Map<string, number> }
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
export const esPresentacion = (cuerpo: string): boolean => /soy el asistente virtual|qu[eé] gusto saludarte/i.test(cuerpo);
/** Los planes que resuelven (no derivan): jamás llevan el botón de contacto de Antonio. El de `comprobante` depende del resultado y no se vigila aquí. */
export const PLANES_SIN_BOTON = ['saludo', 'angulo', 'angulo_fijo', 'modelo', 'modelo_caido', 'puente', 'puente_fijo', 'charla_fija', 'opciones', 'opciones_fijo', 'precio', 'catalogo', 'imagenes', 'resultado', 'menu', 'bonos', 'complemento', 'qr', 'qr_pendiente', 'imagen_descrita', 'imagen_otra', 'audio_fijo', 'archivo', 'otro', 'riesgo', 'suspendido'];
/** Los planes que derivan a Antonio: siempre con el botón. */
export const PLANES_CON_BOTON = ['derivar', 'consulta', 'cancelacion', 'sin_configuracion', 'fuera_pais', 'repetido', 'cobro_cerrado', 'cobro_ya_cerrado', 'uso_extendido'];
/** ¿El mensaje lleva el botón que abre el chat de Antonio (`cta_url`)? */
export const llevaBotonDeContacto = (m: { payload: J }): boolean => (m.payload['interactive'] as J | undefined)?.['type'] === 'cta_url';
const IDS_DE_PRODUCTO = ['b_pack', 'b_libro', 'b_workbook', 'b_guia', 'b_calendario', 'b_preguntas'];
/** Los botones de producto o de la lista de bonos (con un QR abierto o sin configuración no sale ninguno). */
const IDS_DE_MENU = [...IDS_DE_PRODUCTO, 'b_comp', 'b_bonos'];
/**
 * Las violaciones de los invariantes para UN turno; `pulsados` se actualiza con el toque de este turno ANTES de mirar la respuesta. `presentaciones` (opcional) cuenta, por teléfono,
 * los mensajes con presentación ya enviados. Función pura, probada también con casos negativos.
 */
export interface ContextoUx {
  /** Lo último que se le dijo a este teléfono (texto). */
  ultimoTexto?: string;
  /** Cuántas respuestas ha recibido ya este teléfono. */
  respuestasPrevias?: number;
  /** Hay un QR abierto según el servidor (`cobro.pendiente`). */
  qrAbierto?: boolean;
  /** El panel de la consola falló o no trae catálogo. */
  sinConfig?: boolean;
  /** El modelo de conversación corrió en este turno. */
  llamoAlModelo?: boolean;
  /** El plan que decidió el turno (`Armar mensajes`). */
  plan?: string;
  /** El turno fue una nota de voz. */
  esAudio?: boolean;
  /** Los nombres del catálogo de la consola en este momento (el de cada botón con precio sale de ahí). */
  nombresDelCatalogo?: string[];
}
/** Los mensajes EXENTOS del invariante 7, POR PLAN (no por palabras): el QR, el resultado del cotejo, la protección ante violencia o miedo y el texto a un número extranjero; y la presentación. */
const PLANES_EXENTOS = ['qr', 'comprobante', 'riesgo', 'fuera_pais'];
const EXENTO_REPETIDO = (m: UxMsg, plan: string): boolean => m.tipo === 'image' || PLANES_EXENTOS.includes(plan) || esPresentacion(m.cuerpo);
const TRIGGER_DE_OPCIONES = /precio|cu[aá]nto|cuesta|vale\b|cat[aá]logo|vend|lista|opciones|compr|pagar|pago|adquirir|llevo|pack|libro|workbook|calendario|preguntas|bono|^hola, (quiero|me interesa)|garant|resultado|imagen|foto/i;
export function violacionesDeUx(pulsados: Set<string>, entrante: J, mensajes: UxMsg[], presentaciones?: { n: number }, transcripcion = '', ctx: ContextoUx = {}): string[] {
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
  let ultimoTexto = ctx.ultimoTexto ?? '';
  const palabrasDeVoz = LIB.raNorm(transcripcion).split(' ').filter(Boolean).length;
  if (ctx.esAudio && palabrasDeVoz < 3 && ctx.llamoAlModelo) v.push('una nota de voz de menos de 3 palabras llegó al modelo');
  // El «sí» (o el botón «Ver opciones») a «¿Te muestro las opciones?» pide las opciones: no son «antes de tiempo» y SE DEBEN cumplir (invariante 17).
  const dijoSi = /^\s*(s[ií]|claro|dale|ok|okey|bueno|por favor|me interesa|adelante|s[ií],? por favor)\s*[.!]*\s*$/i.test(dicho);
  const respondeAlPuente = /¿Te muestro las opciones\?\s*$/.test(ultimoTexto) && (idToque === 'b_opciones' || dijoSi);
  if (respondeAlPuente && !ctx.qrAbierto && !mensajes.some((m) => m.tipo === 'image' || idsDeBotones(m).some((id) => IDS_DE_MENU.includes(id)))) v.push('se ofreció «¿Te muestro las opciones?» y la respuesta no trae los botones de producto');
  const abierto = !ctx.qrAbierto && !respondeAlPuente && (ctx.respuestasPrevias ?? 99) < 2 && entrante['type'] === 'text' && !TRIGGER_DE_OPCIONES.test(textoEntrante);
  for (const m of mensajes) {
    if (ultimoTexto !== '' && m.cuerpo === ultimoTexto && !EXENTO_REPETIDO(m, ctx.plan ?? '')) v.push(`el mismo texto dos veces seguidas: «${m.cuerpo.slice(0, 40)}…»`);
    ultimoTexto = m.cuerpo;
    const botonesDeProducto = idsDeBotones(m).filter((id) => IDS_DE_MENU.includes(id));
    if (ctx.qrAbierto) {
      if (m.tipo === 'image') v.push('con un QR abierto salió un segundo QR');
      if (botonesDeProducto.length) v.push(`con un QR abierto salieron botones de producto: ${botonesDeProducto.join(', ')}`);
    }
    if (ctx.plan && m.tipo !== 'image') {
      if (PLANES_SIN_BOTON.includes(ctx.plan) && llevaBotonDeContacto(m)) v.push(`el plan «${ctx.plan}» resuelve y no deriva, pero salió con el botón de Antonio`);
      if (PLANES_CON_BOTON.includes(ctx.plan) && !llevaBotonDeContacto(m)) v.push(`el plan «${ctx.plan}» deriva a Antonio, pero salió sin su botón`);
    }
    if (ctx.sinConfig) {
      if (m.tipo === 'image') v.push('sin configuración salió un QR');
      if (botonesDeProducto.length) v.push('sin configuración salieron botones de producto');
      if (/\d\s*Bs\b/i.test(m.cuerpo)) v.push('sin configuración salió un monto');
      if (ctx.llamoAlModelo) v.push('sin configuración contestó el modelo');
    }
    if (/\b(te (muestro|envio|envío|mando|comparto|paso|adjunto)|aqu[ií] (tienes|te dejo))\b[^.?!]{0,40}\b(imagen|im[aá]genes|foto|fotos|captura|capturas|portada)\b/i.test(m.cuerpo)) v.push('el texto promete una imagen que el flujo no envía');
    if (abierto && m.tipo !== 'image' && (botonesDeProducto.length || /\d\s*Bs\b/i.test(m.cuerpo))) v.push('el menú o un monto salió antes de tiempo (en las dos primeras respuestas a un mensaje libre)');
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
        // Un botón con precio es «<nombre del catálogo> <monto>Bs»: el nombre es el del catálogo (completo o recortado por palabras), sin palabras cortadas ni preposición colgando.
        const mm = /^(.*?) (\d+(?:,\d+)?)Bs$/.exec(titulo);
        if (!mm) v.push(`botón con precio que no termina en « <monto>Bs»: «${titulo}»`);
        else {
          const nombre = mm[1]!;
          const nombres = [...(ctx.nombresDelCatalogo ?? []), 'Mejor Pack'];
          const esDelCatalogo = nombres.some((n) => n === nombre || n.startsWith(nombre + ' '));
          if (ctx.nombresDelCatalogo && !esDelCatalogo) v.push(`la etiqueta «${titulo}» no usa el nombre del catálogo (${nombres.join(' | ')})`);
          if (/\b(de|del|el|la|y)$/i.test(nombre) && !nombres.includes(nombre)) v.push(`botón con una preposición colgando: «${titulo}»`);
        }
      }
      if (b['reply']?.id === 'b_opciones') {
        if (/\d/.test(titulo)) v.push('el botón «Ver opciones» lleva un precio');
        if (botones.some((x) => IDS_DE_MENU.includes(String(x['reply']?.id)))) v.push('«Ver opciones» salió junto a botones de producto');
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
  const estado: UxEstado = { pulsados: new Map(), presentaciones: new Map(), turnos: 0, ultimo: new Map(), respuestas: new Map() };
  UX_ESTADO.set(mundo, estado);
  mundo.turno = (entrada: J, opciones?: Parameters<Mundo['turno']>[1]) => {
    // Lo que dice el servidor ANTES del turno: un QR abierto, o la configuración caída (el doble de la consola; es una función pura de la prueba).
    const dp = mundo.dobles['Traer configuración'];
    const panel = (typeof dp === 'function' ? dp({} as never) : dp) as J | undefined;
    const cuerpoPanel = (panel?.['body'] ?? {}) as J;
    const sinConfig = !panel || Number(panel['statusCode']) !== 200 || !Array.isArray(cuerpoPanel['catalogo']) || (cuerpoPanel['catalogo'] as unknown[]).length === 0;
    const qrAbierto = !sinConfig && cuerpoPanel['cobro']?.pendiente === true;
    const t = original(entrada, opciones);
    const msg = ((entrada['body']?.value?.messages ?? [])[0] ?? {}) as J;
    const from = String(msg['from'] ?? '');
    const pulsados = estado.pulsados.get(from) ?? new Set<string>();
    estado.pulsados.set(from, pulsados);
    const pres = { n: estado.presentaciones.get(from) ?? 0 };
    // Los mensajes al cliente de este turno (sin los avisos a Antonio ni los respaldos de texto).
    const salida = t.mensajes.filter((e) => !e.respaldo).map((e) => ({ tipo: e.tipo, cuerpo: e.cuerpo, payload: e.payload }));
    const trans = String((t.porNodo['Preparar transcripción']?.[0]?.['userInput'] ?? '')).replace(/^\(audio transcripto\) /, '').split('\n')[0]!;
    const nombresDelCatalogo = Array.isArray(cuerpoPanel['catalogo']) ? (cuerpoPanel['catalogo'] as J[]).map((c) => String(c['nombre'] ?? '')).filter((n) => n !== '') : undefined;
    const v = violacionesDeUx(pulsados, msg, salida, pres, trans, {
      nombresDelCatalogo: nombresDelCatalogo && nombresDelCatalogo.length ? nombresDelCatalogo : undefined,
      ultimoTexto: estado.ultimo.get(from), respuestasPrevias: estado.respuestas.get(from) ?? 0, qrAbierto, sinConfig: sinConfig && Number(panel?.['statusCode']) !== 409, llamoAlModelo: t.ejecutados.has('Conversar con el modelo'), esAudio: msg['type'] === 'audio', plan: String((t.porNodo['Armar mensajes']?.[0]?.['plan'] ?? '')),
    });
    if (salida.length) { estado.ultimo.set(from, salida[salida.length - 1]!.cuerpo); estado.respuestas.set(from, (estado.respuestas.get(from) ?? 0) + salida.length); }
    estado.presentaciones.set(from, pres.n);
    estado.turnos += 1; UX_CONTADOR.turnos += 1; UX_CONTADOR.mundos.add(mundo);
    expect(v, `invariante de UX violado: ${v.join('; ')}`).toEqual([]);
    return t;
  };
}
