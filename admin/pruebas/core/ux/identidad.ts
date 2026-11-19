/**
 * INVARIANTE GLOBAL «el asistente dice que es una IA» (14/11/2026; decisión de Andres del 12/11/2026, brecha C1 del análisis de UX).
 *
 * Quien recibe el primer mensaje tiene que saber que habla con una inteligencia artificial. El hecho que se mira, de forma ESTÁTICA en el
 * JSON versionado (lo que el flujo lleva, no lo que promete un prompt): algún nodo Code INCLUYE la pieza común
 * (`Flujos/src/core/texto/identidad.js`) byte a byte Y la LLAMA (`ctConIA(`) en código que no es el de la pieza. Que el primer mensaje
 * salga bien lo prueba la suite de cada flujo (tabla del primer mensaje).
 *
 * Las piezas puras viven aquí y no en el `*.test.ts` porque importar un archivo de pruebas desde otro vuelve a ejecutar sus `describe`.
 * Los nombres de cliente no aparecen en el código: los flujos entran por su ruta, como dato.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Flujo } from '../../lib/flujo';
import { SRC_CORE } from '../migracion/comprobaciones';

export const RUTA_PIEZA_IDENTIDAD = join(SRC_CORE, 'texto', 'identidad.js');

/** El texto de la pieza común, sin el salto final (los constructores la pegan con o sin él). */
export const fuenteDeIdentidad = (ruta: string = RUTA_PIEZA_IDENTIDAD): string => readFileSync(ruta, 'utf8').replace(/\n+$/, '');

const textoDe = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));

/** ¿Algún nodo Code del flujo incluye la pieza byte a byte Y la llama fuera del código de la pieza? (Pegada sin llamarla no dice nada.) */
export function incluyeLaPiezaDeIdentidad(f: Flujo, fuente: string = fuenteDeIdentidad()): boolean {
  return f.nodes
    .map((n) => textoDe((n.parameters as Record<string, unknown> | undefined)?.['jsCode']))
    .filter((c) => c.includes(fuente))
    .map((c) => c.split(fuente).join(''))
    .some((c) => c.includes('ctConIA('));
}

/** Las funciones de los flujos que llaman a `ctConIA` en su cuerpo: donde se las LLAMA, el nodo tiene que llevar la pieza. */
export const USUARIOS_DE_LA_PIEZA = ['bmSeguro', 'wlSeguro', 'chLista'] as const;

/**
 * Los nodos Code que LLAMAN a una de esas funciones (fuera de su definición) sin llevar la pieza: ahí fallaría con `ReferenceError` en
 * pleno envío. La definición sola, que viaja con la librería del cliente en todos los nodos, no cuenta.
 */
export function nodosQueLlamanSinLaPieza(f: Flujo, fuente: string = fuenteDeIdentidad()): string[] {
  const definicion = (c: string, fn: string): RegExpExecArray | null => new RegExp(`^function ${fn}\\([\\s\\S]*?\\n\\}\\n`, 'm').exec(c);
  const sinDefinir = (c: string): string => USUARIOS_DE_LA_PIEZA.reduce((acc, fn) => acc.replace(new RegExp(`^function ${fn}\\([\\s\\S]*?\\n\\}\\n`, 'm'), ''), c);
  // Una función cuya definición (en el mismo nodo) ya NO llama a `ctConIA` no necesita la pieza (p. ej. un flujo con excepción permanente que la quitó).
  const usaLaPieza = (c: string, fn: string): boolean => { const d = definicion(c, fn); return d === null || d[0].includes('ctConIA('); };
  return f.nodes
    .map((n) => [n.name, textoDe((n.parameters as Record<string, unknown> | undefined)?.['jsCode'])] as const)
    .filter(([, c]) => c !== '' && !c.includes(fuente))
    .filter(([, c]) => USUARIOS_DE_LA_PIEZA.some((fn) => usaLaPieza(c, fn) && new RegExp(`\\b${fn}\\(`).test(sinDefinir(c))))
    .map(([nombre]) => nombre);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// EXCEPCIONES: lista CERRADA, propia de esta regla, que SOLO BAJA. Cambiar `TOPE_IDENTIDAD`, `ALTA_IDENTIDAD` o un `vence` exige pasar
// por el agente `seguridad`.
// ---------------------------------------------------------------------------------------------------------------------------------
/**
 * Una excepción vence (`vence`, AAAA-MM-DD, con el límite de 90 días) o es PERMANENTE (`permanente: true`, decisión de Andres del 19/11/2026 para Walisuma):
 * la permanente exige motivo y dueño, `permanente` solo como el booleano `true` y NUNCA `vence` a la vez.
 */
export type ExcepcionDeIdentidad = { motivo: string; dueno: string; vence: string; permanente?: undefined } | { motivo: string; dueno: string; permanente: true; vence?: undefined };

export const ALTA_IDENTIDAD = '2026-11-14';
/** Ninguna excepción vence más de 90 días después del alta. */
export const LIMITE_IDENTIDAD = '2027-02-12';
const VENCE = '2027-01-31';

const CONGELADO_CONSULTORIO = 'Flujo vivo congelado por orden de Andres: recibe el saludo con IA con su mudanza, en una sola republicación (botón del 13/11/2026).';
const CONGELADO_CAPTACION = 'Congelado: Andres decidió el 13/11/2026 retirarlo al final; no recibe cambios.';
const CON_AGENTE = 'Flujo con el agente de n8n: excepción declarada por Andres el 13/11/2026; ya se presenta como IA por prompt y red; no se toca hasta su retiro o su mudanza.';
const IA_SI_PREGUNTAN = 'Decisión 2 de Andres (18/11/2026): dice que es una IA solo si le preguntan (texto fijo del código que SÍ lo dice) y nunca lo niega; saludo «asistente de atención y ventas». Sin fecha de fin (Andres, 19/11/2026).';
const COPIA_DECLARADA = 'Ya se presenta como asistente virtual con IA con su propio texto (otro prefijo): pasa a la pieza común en la etapa 1 de la migración.';

/** Clave: la ruta del JSON relativa a `Flujos/` SIN la carpeta de nivel superior (`idDeFlujo`), para que sobreviva a una mudanza. */
export const EXCEPCIONES_DE_IDENTIDAD: Record<string, ExcepcionDeIdentidad> = {
  'agenda-minima/agenda-minima.v0.json': { motivo: CONGELADO_CONSULTORIO, dueno: 'Rearquitectura (mudanza)', vence: VENCE },
  'captacion-minima/captacion-minima.novuchat.json': { motivo: CONGELADO_CAPTACION, dueno: 'Principal', vence: VENCE },
  'bellido-agendamiento.json': { motivo: CON_AGENTE, dueno: 'Principal', vence: VENCE },
  'demo-a-agendamiento.json': { motivo: CON_AGENTE, dueno: 'Principal', vence: VENCE },
  'demo-b-venta-cobro.json': { motivo: CON_AGENTE, dueno: 'Principal', vence: VENCE },
  'novuchat-onboarding.json': { motivo: CON_AGENTE, dueno: 'Principal', vence: VENCE },
  'rroca-antonio/rroca-antonio.json': { motivo: COPIA_DECLARADA, dueno: 'Rearquitectura (etapa 1)', vence: VENCE },
  'rroca-ruben/rroca-ruben.json': { motivo: COPIA_DECLARADA, dueno: 'Rearquitectura (etapa 1)', vence: VENCE },
  'rroca-emma/rroca-emma.json': { motivo: COPIA_DECLARADA, dueno: 'Rearquitectura (etapa 1)', vence: VENCE },
  'rroca-evy/rroca-evy.json': { motivo: COPIA_DECLARADA, dueno: 'Rearquitectura (etapa 1)', vence: VENCE },
  'doctoras/doctoras.rroca-emma.json': { motivo: COPIA_DECLARADA, dueno: 'Rearquitectura (etapa 1)', vence: VENCE },
  'doctoras/doctoras.rroca-evy.json': { motivo: COPIA_DECLARADA, dueno: 'Rearquitectura (etapa 1)', vence: VENCE },
  'walisuma/walisuma.json': { motivo: IA_SI_PREGUNTAN, dueno: 'Andres', permanente: true },
};
/** Cuántos flujos tienen excepción hoy. SOLO BAJA: un flujo nuevo nace con la pieza. 12 → 13 el 19/11/2026: Walisuma, excepción permanente decidida por Andres. */
export const TOPE_IDENTIDAD = 13;

const AAAA_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Cruza lo medido hoy (`faltan`: ids de los flujos que NO incluyen la pieza) con las excepciones: toda falta tiene su excepción, toda
 * excepción sigue siendo una falta (una que ya se cumple SOBRA: hay que borrarla) y la forma de cada una es válida.
 */
export function problemasDeIdentidad(
  faltan: Set<string>, excepciones: Record<string, ExcepcionDeIdentidad> = EXCEPCIONES_DE_IDENTIDAD,
  tope: number = TOPE_IDENTIDAD, hoy: string = new Date().toISOString().slice(0, 10), limite: string = LIMITE_IDENTIDAD,
): string[] {
  const p: string[] = [];
  const claves = Object.keys(excepciones);
  if (claves.length > tope) p.push(`hay ${claves.length} excepciones y el tope es ${tope}: el tope solo baja`);
  for (const [id, e] of Object.entries(excepciones)) {
    if (!e.motivo.trim()) p.push(`${id}: excepción sin motivo`);
    if (!e.dueno.trim()) p.push(`${id}: excepción sin dueño`);
    const x = e as { permanente?: unknown; vence?: unknown };
    if (x.permanente !== undefined) {
      if (x.permanente !== true) p.push(`${id}: «permanente» solo admite el booleano true`);
      if (x.vence !== undefined) p.push(`${id}: una excepción permanente no lleva «vence»`);
    }
    else if (!AAAA_MM_DD.test(String(x.vence ?? ''))) p.push(`${id}: «vence» no es una fecha AAAA-MM-DD`);
    else if (String(x.vence) > limite) p.push(`${id}: vence después del límite (${limite})`);
    else if (String(x.vence) < hoy) p.push(`${id}: excepción VENCIDA el ${String(x.vence)}: o el flujo adopta la pieza común, o se renueva con una decisión de Andres`);
    if (!faltan.has(id)) p.push(`${id}: SOBRA, el flujo no existe o ya incluye la pieza común; hay que borrarla`);
  }
  for (const id of faltan) if (!excepciones[id]) p.push(`${id}: no incluye la pieza de identidad y no tiene excepción declarada`);
  return p;
}
