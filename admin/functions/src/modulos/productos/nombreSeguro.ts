/**
 * QUÉ NOMBRES DE PRODUCTO LLEGAN AL MODELO (módulo Productos).
 *
 * Decisión de diseño (24/10/2026, seguridad): el nombre de un producto es TEXTO
 * ESCRITO POR EL COMERCIO que viaja al prompt de todos los flujos del negocio y
 * al contexto de la capa 2 de campañas. Las reglas de Firestore solo miden su
 * largo. Defensa en profundidad:
 *
 *  1. LECTURA (este archivo, quien manda): al armar lo que va al prompt o al
 *     contexto, un nombre que dispara la capa 1 (`verificarPatrones`, nivel
 *     «rechazado») o una frase de instrucción (`frasesDeInstruccion.ts`) se
 *     OMITE. El producto sigue en la Consola y en el catálogo; no se borra, no
 *     se manda ningún mensaje, y el motivo no se dice (ni al comercio ni al
 *     modelo): solo se cuenta cuántos se omitieron.
 *  2. IMPORTACIÓN (`importarCatalogo`): el servidor rechaza la fila con el
 *     motivo `nombre_no_permitido`, igual para cualquier patrón.
 *  3. CONSOLA: avisa al escribir el nombre y marca el ítem omitido. Solo avisa;
 *     las reglas no pueden correr esta lista.
 *
 * Los nombres dudosos (solo patrones débiles: «Herramientas», «Consolas»,
 * «Reglas del torneo») PASAN: una ferretería los vende. «prompt» en singular o
 * «system» omiten; «prompts» pasa solo como producto contado («Pack 100
 * prompts»), por la excepción de `promptsSinContexto` del comportamiento.
 *
 * TAMBIÉN `descripcion` y `area` (texto libre del ítem que viaja al prompt): lo que
 * no pasa se QUITA como CAMPO, el producto queda. La prosa usa una lista más
 * corta (`pareceInstruccionEnProsa`) para no tocar lenguaje comercial. Y el
 * identificador del documento: la consola lo arma con el nombre.
 *
 * Los invisibles y los controles bidi (\p{Cf}) se QUITAN del texto que sale.
 *
 * Las marcas de bloque (`[]{}<>«»`) NO omiten un nombre: se cambian por un
 * espacio («Combo [XL]» pasa como «Combo XL»), que es lo que llega al modelo.
 * Así no se pueden forjar bloques del prompt y los nombres legítimos con
 * corchetes se conservan.
 *
 * SIN ESTADO DE NINGÚN TENANT: no se pasa `OtrosComercios`, así que el filtro
 * no lee ni delata a otros comercios.
 */
import { verificarPatrones } from '../../central/asistente/comportamiento.js';
import {
  TOPE_NOMBRE, pareceInstruccion, pareceInstruccionEnProsa, plegarNombre,
} from './frasesDeInstruccion.js';

const MARCAS = /[[\]{}<>«»]/gu;
const CF = /\p{Cf}/gu;
const CC = /\p{Cc}/gu;
const TOPE_PROSA = 600;

/** Las vistas del texto sobre las que se corren los patrones: invisibles quitados y como espacio, marcas como espacio. */
function vistas(t: string): string[] {
  const a = t.replace(CF, '').replace(CC, ' ').replace(MARCAS, ' ');
  const b = t.replace(CF, ' ').replace(CC, ' ').replace(MARCAS, ' ');
  return [...new Set([a, b])];
}

function rechazaCapa1(v: string): boolean {
  return [v.normalize('NFKC'), plegarNombre(v)].some((x) => verificarPatrones(x).nivel === 'rechazado');
}

/** El nombre listo para el modelo (sin marcas de bloque ni invisibles), o `null` si se omite. */
export function nombreParaElModelo(nombre: unknown): string | null {
  if (typeof nombre !== 'string') return null;
  if (nombre.trim() === '' || nombre.length > TOPE_NOMBRE) return null;
  for (const v of vistas(nombre)) {
    if (pareceInstruccion(v) || rechazaCapa1(v)) return null;
  }
  const limpio = nombre.replace(CF, '').replace(CC, ' ').replace(MARCAS, ' ').replace(/\s+/g, ' ').trim();
  return limpio === '' ? null : limpio;
}

export const nombreDeProductoApto = (nombre: unknown): boolean => nombreParaElModelo(nombre) !== null;

/**
 * Texto libre del ítem (descripción, área): el texto limpio, o `null` si el
 * CAMPO se quita. Conserva paréntesis, signos, emojis, cifras y saltos de línea.
 */
export function textoLibreParaElModelo(texto: unknown): string | null {
  if (typeof texto !== 'string') return null;
  if (texto.length > TOPE_PROSA) return null;
  for (const v of vistas(texto)) {
    if (pareceInstruccionEnProsa(v) || rechazaCapa1(v)) return null;
  }
  const limpio = texto.replace(CF, '').replace(/(?![\n\t])\p{Cc}/gu, ' ').replace(MARCAS, ' ').trim();
  return limpio === '' ? null : limpio;
}

interface DocLeve { id: string; data: () => Record<string, unknown> }

/** El identificador de un documento leído como frase (la consola lo arma con el nombre). */
const idComoFrase = (id: string): string => id.replace(/[-_]+/g, ' ');

/**
 * Los documentos del catálogo como los ve el modelo: sin los de nombre o
 * identificador omitido, con el nombre limpio, y con `descripcion` y `area`
 * quitadas si no pasan. Devuelve también cuántos productos se omitieron.
 */
export function catalogoParaElPrompt(
  docs: readonly DocLeve[],
): { docs: DocLeve[]; omitidos: number } {
  const salida: DocLeve[] = [];
  let omitidos = 0;
  for (const d of docs) {
    const datos = d.data();
    const nombre = nombreParaElModelo(datos['nombre']);
    if (nombre === null || nombreParaElModelo(idComoFrase(d.id)) === null) { omitidos++; continue; }
    const limpio: Record<string, unknown> = { ...datos, nombre };
    for (const campo of ['descripcion', 'area']) {
      if (!(campo in limpio)) continue;
      const t = textoLibreParaElModelo(limpio[campo]);
      if (t === null) delete limpio[campo]; else limpio[campo] = t;
    }
    salida.push({ id: d.id, data: () => limpio });
  }
  return { docs: salida, omitidos };
}
