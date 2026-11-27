/**
 * LAS PIEZAS COMUNES DEL CATÁLOGO Y SUS EXCEPCIONES CON VENCIMIENTO (Estándar v1.1, 27/11/2026; revisión del PR #1147: I2 e I3).
 *
 * Un flujo de venta con catálogo debe USAR las tres piezas comunes: la intención (`icIntencion` o `icPideListado`), la lista (`icMensajeLista`)
 * y el botón del catálogo (`cwConBotonCatalogo`). «Usar» es LLAMARLAS desde el código de un nodo (sin comentarios): una pieza solo incluida,
 * o una llamada anulada, no cuenta. Un flujo que no las usa figura en `SIN_PIEZAS_COMUNES` con su porqué y su vencimiento; sin eso, la prueba falla.
 *
 * Toda excepción de la invariante (esta lista, `SIN_ADAPTADOR`, `DADOS_DE_BAJA` y las de cada punto) lleva `vence` a más tardar el 31/01/2027, como
 * `core/migracion/excepciones.ts`. Vencida, la prueba falla: o se cierra, o se renueva con una decisión de Andres.
 *
 * Aquí NO hay datos ni nombres de comercios más que las claves de las excepciones (el nombre del JSON, como en las demás listas).
 */
import type { Flujo } from '../../lib/flujo';
import { sinComentarios } from '../migracion/comprobaciones';

/** Una excepción declarada: su porqué y la fecha (AAAA-MM-DD) en que vence. */
export interface ExcepcionConVencimiento { motivo: string; vence: string }

/** El tope de vencimiento de toda excepción de esta invariante (igual que `VENCE` de `core/migracion/excepciones.ts`). */
export const VENCE_MAXIMO = '2027-01-31';

const AAAA_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const instante = (f: string): number => (AAAA_MM_DD.test(f) ? new Date(`${f}T00:00:00Z`).getTime() : NaN);

/** La forma y la vigencia de un mapa de excepciones: motivo con sustancia, `vence` válido, no pasado de `VENCE_MAXIMO` y no vencido a `hoy`. Vacío = en regla. */
export function problemasDeVencimiento(excepciones: Record<string, ExcepcionConVencimiento>, hoy: Date = new Date()): string[] {
  const p: string[] = [];
  for (const [k, e] of Object.entries(excepciones)) {
    if (e.motivo.trim().length <= 30) p.push(`${k}: la excepción necesita su porqué`);
    const t = instante(e.vence);
    if (Number.isNaN(t)) p.push(`${k}: «vence» no es una fecha AAAA-MM-DD`);
    else if (t > instante(VENCE_MAXIMO)) p.push(`${k}: vence ${e.vence}, después del tope ${VENCE_MAXIMO}`);
    else if (hoy.getTime() > t + 86_400_000) p.push(`${k}: VENCIÓ el ${e.vence}: o se cierra, o se renueva con una decisión de Andres`);
  }
  return p;
}

/** Las piezas que un flujo con catálogo debe llamar. Cada una se cumple con CUALQUIERA de sus funciones. */
export const PIEZAS_COMUNES: ReadonlyArray<{ pieza: string; funciones: readonly string[] }> = [
  { pieza: 'intención de catálogo', funciones: ['icIntencion', 'icPideListado'] },
  { pieza: 'lista de catálogo', funciones: ['icMensajeLista'] },
  { pieza: 'botón del catálogo', funciones: ['cwConBotonCatalogo'] },
];

/** ¿`codigo` (ya sin comentarios) LLAMA a `nombre`? Las declaraciones `function nombre(` no son llamadas. */
const llama = (codigo: string, nombre: string): boolean => new RegExp(`(?<!function\\s)\\b${nombre}\\s*\\(`).test(codigo);

/** Las piezas comunes que el flujo NO llama desde ningún nodo de código. Vacío = las usa todas. */
export function piezasFaltantes(f: Flujo): string[] {
  const codigo = sinComentarios(f.nodes.map((n) => String((n.parameters as { jsCode?: unknown } | undefined)?.jsCode ?? '')).join('\n'));
  return PIEZAS_COMUNES.filter((p) => !p.funciones.some((fn) => llama(codigo, fn))).map((p) => p.pieza);
}

const BAJA_RROCA = 'Dado de baja el 23/11/2026 (Rubén y sus subcuentas rroca-*): no se mide ni se publica; sus JSON siguen en el repositorio hasta su retiro.';
/** Flujos de producción con cobro dados de baja: el estándar de venta no los mide mientras sigan en el repositorio. */
export const DADOS_DE_BAJA: Record<string, ExcepcionConVencimiento> = {
  'rroca-antonio.json': { motivo: BAJA_RROCA, vence: VENCE_MAXIMO },
  'rroca-ruben.json': { motivo: BAJA_RROCA, vence: VENCE_MAXIMO },
};

/**
 * Flujos de venta que todavía NO usan las piezas comunes del catálogo. SOLO BAJA, con vencimiento. Cada uno nombra qué PR lo conecta o por qué no se migra aquí.
 * Este PR (B1) crea las piezas; ningún flujo las usa todavía: la migración es por comercio, un PR cada uno.
 */
export const SIN_PIEZAS_COMUNES: Record<string, ExcepcionConVencimiento> = {
  'casa-bermejo.json': { vence: VENCE_MAXIMO, motivo: 'Se conecta en el bloque B2 (PR de Casa Bermejo), que RETIRA esta excepción: hoy tiene su propia intención, su propio botón (`bmConBotonCatalogo`) y el modelo contesta los listados.' },
  'walisuma.json': { vence: VENCE_MAXIMO, motivo: 'NO se migra en este PR (B1 solo crea las piezas): conserva su intención y su botón propios (`wl-venta.js`); su adopción es de otro PR, con su revisión y su publicación.' },
  'demo-b-venta-cobro.json': { vence: VENCE_MAXIMO, motivo: 'NO se migra en este PR: es el demo de venta con su propia lógica de catálogo (`venta-minima`); su adopción es de otro PR del dueño del flujo.' },
  'venta-minima.qtaco.json': { vence: VENCE_MAXIMO, motivo: 'NO se migra en este PR: Q\'Taco conserva su intención y su catálogo propios (`venta-minima`); su adopción es de otro PR, con su revisión y sin tocar el flujo vivo desde aquí.' },
  'venta-minima.qtaco-3727.json': { vence: VENCE_MAXIMO, motivo: 'Misma base que `venta-minima.qtaco.json` (Q\'Taco): NO se migra en este PR; se adopta junto con el flujo principal de Q\'Taco.' },
};
