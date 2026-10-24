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
 * Las marcas de bloque (`[]{}<>«»`) NO omiten un nombre: se cambian por un
 * espacio («Combo [XL]» pasa como «Combo XL»), que es lo que llega al modelo.
 * Así no se pueden forjar bloques del prompt y los nombres legítimos con
 * corchetes se conservan.
 *
 * SIN ESTADO DE NINGÚN TENANT: no se pasa `OtrosComercios`, así que el filtro
 * no lee ni delata a otros comercios.
 */
import { verificarPatrones } from '../../central/asistente/comportamiento.js';
import { TOPE_NOMBRE, pareceInstruccion, plegarNombre } from './frasesDeInstruccion.js';

const MARCAS = /[[\]{}<>«»]/gu;

/** El nombre listo para el modelo (sin marcas de bloque), o `null` si se omite. */
export function nombreParaElModelo(nombre: unknown): string | null {
  if (typeof nombre !== 'string') return null;
  const t = nombre.trim();
  if (t === '' || t.length > TOPE_NOMBRE) return null;
  const sinMarcas = t.replace(MARCAS, ' ').replace(/\s+/g, ' ').trim();
  if (sinMarcas === '' || pareceInstruccion(sinMarcas)) return null;
  const vistas = [sinMarcas.normalize('NFKC'), plegarNombre(sinMarcas)];
  for (const v of vistas) {
    if (verificarPatrones(v).nivel === 'rechazado') return null;
  }
  return sinMarcas;
}

export const nombreDeProductoApto = (nombre: unknown): boolean => nombreParaElModelo(nombre) !== null;

interface DocLeve { id: string; data: () => Record<string, unknown> }

/**
 * Los documentos del catálogo como los ve el modelo: sin los de nombre omitido
 * y con el nombre sin marcas. Devuelve también cuántos se omitieron.
 */
export function catalogoParaElPrompt(
  docs: readonly DocLeve[],
): { docs: DocLeve[]; omitidos: number } {
  const salida: DocLeve[] = [];
  let omitidos = 0;
  for (const d of docs) {
    const datos = d.data();
    const nombre = nombreParaElModelo(datos['nombre']);
    if (nombre === null) { omitidos++; continue; }
    salida.push({ id: d.id, data: () => (nombre === datos['nombre'] ? datos : { ...datos, nombre }) });
  }
  return { docs: salida, omitidos };
}
