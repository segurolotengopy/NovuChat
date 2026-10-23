/**
 * INVARIANTE GLOBAL DE UX: «respuesta resuelta ⇒ sin botón de derivación» (regla de Andres, 22/10/2026). Módulo compartido (no es una suite).
 * Si una respuesta ya resuelve lo que el cliente pidió, no lleva el botón que abre el chat de una persona; el botón va solo al derivar.
 *
 * DEFINICIÓN INDEPENDIENTE DEL TEXTO. Es botón de derivación un mensaje `interactive.type === 'cta_url'` cuya URL es `https://wa.me/…` o `https://api.whatsapp.com/…`,
 * o cuyo cuerpo o respaldo (texto) trae un enlace `wa.me`. NO lo son los `cta_url` del catálogo o del mapa de Q'Taco (URL de otro dominio).
 * La clasificación (qué plan deriva y cuál resuelve) es DATO de cada flujo: una tabla por flujo que escribe su dueño (`admin/pruebas/tenants/<t>/derivacion.ts`); este módulo
 * solo trae la regla, el vigilante que envuelve `mundo.turno` (como `vigilarUx` de Antonio), la cobertura estática de planes y, en `flujos-derivacion.ts`, el registro de flujos.
 */
import { readFileSync } from 'node:fs';
import type { J } from '../../lib/flujo';
import type { Mundo, ResultadoTurno } from '../../lib/n8n-de-mentira';

export type Clase = 'deriva' | 'resuelve' | 'exento';
/** Una entrada de la tabla de un flujo: `exento` solo con su porqué (p. ej. un comprobante cuyo botón depende del resultado). */
export interface EntradaDePlan { clase: Clase; porque?: string }
export type TablaDePlanes = Record<string, EntradaDePlan>;

export interface MensajeVigilado { tipo?: string; cuerpo?: string; payload: J; respaldo?: boolean | string }

const ENLACE_WA = /^https?:\/\/(?:wa\.me|api\.whatsapp\.com)\//i;
const ENLACE_WA_ME = /https?:\/\/wa\.me\//i;

/** ¿El mensaje abre el chat de una persona? (`cta_url` a wa.me / api.whatsapp.com, o un enlace wa.me en su cuerpo o respaldo.) */
export function esBotonDeDerivacion(m: { payload: J; respaldo?: boolean | string; cuerpo?: string }): boolean {
  const inter = (m.payload?.['interactive'] ?? {}) as J;
  if (inter['type'] === 'cta_url' && ENLACE_WA.test(String(inter['action']?.parameters?.url ?? ''))) return true;
  if (ENLACE_WA_ME.test(String(m.cuerpo ?? ''))) return true;
  if (typeof m.respaldo === 'string' && ENLACE_WA_ME.test(m.respaldo)) return true;
  return ENLACE_WA_ME.test(String(inter['body']?.text ?? ''));
}

export interface ContextoDerivacion {
  /** Hay a quién derivar (número de recepción configurado). */
  hayRecepcion: boolean;
  /** Quien escribe es la recepción: `cmContactoConBoton` da texto sin botón. */
  mismoNumero?: boolean;
}

/**
 * Las violaciones de UN turno. `clase` undefined (plan sin clasificar) es violación: un plan nuevo no se escapa.
 * `exento` no se vigila. Las imágenes (QR) no cuentan como respuesta con o sin botón.
 */
export function violacionesDeDerivacion(clase: Clase | undefined, mensajes: MensajeVigilado[], ctx: ContextoDerivacion): string[] {
  if (clase === undefined) return ['el plan del turno no está clasificado en la tabla de derivación (deriva / resuelve / exento)'];
  if (clase === 'exento') return [];
  const v: string[] = [];
  const texto = mensajes.filter((m) => m.tipo !== 'image');
  if (clase === 'resuelve') {
    for (const m of texto) if (esBotonDeDerivacion(m)) v.push('una respuesta que resuelve salió con un botón o enlace de derivación');
  } else if (texto.length && ctx.hayRecepcion && !ctx.mismoNumero) {
    const principales = texto.filter((m) => !m.respaldo);
    if (!(principales.length ? principales : texto).some((m) => esBotonDeDerivacion(m))) v.push('una respuesta que deriva salió sin su botón de derivación');
  }
  return v;
}

export const claseDe = (tabla: TablaDePlanes, plan: string): Clase | undefined => tabla[plan]?.clase;

export interface OpcionesVigilar {
  /** La clase del turno (de su plan, ruta o resumen); `undefined` si no está clasificado. */
  clasificar: (t: ResultadoTurno) => Clase | undefined;
  hayRecepcion: boolean | ((t: ResultadoTurno) => boolean);
}
export const DERIVACION_CONTADOR = { turnos: 0, mundos: new Set<Mundo>() };
/** Envuelve `mundo.turno`: cada turno que habla con el flujo pasa por la regla. Devuelve el contador de turnos vigilados de ESTE mundo. */
export function vigilarDerivacion(
  mundo: Mundo, opciones: OpcionesVigilar,
  afirmar: (v: string[], t: ResultadoTurno) => void = (v) => { if (v.length) throw new Error(`invariante de derivación violado: ${v.join('; ')}`); },
): { turnos: number } {
  const original = mundo.turno.bind(mundo);
  const cuenta = { turnos: 0 };
  mundo.turno = (entrada: J, o?: Parameters<Mundo['turno']>[1]) => {
    const t = original(entrada, o);
    const hay = typeof opciones.hayRecepcion === 'function' ? opciones.hayRecepcion(t) : opciones.hayRecepcion;
    const msgs = t.mensajes.map((e) => ({ tipo: e.tipo, cuerpo: e.cuerpo, payload: e.payload, respaldo: e.respaldo }));
    cuenta.turnos += 1; DERIVACION_CONTADOR.turnos += 1; DERIVACION_CONTADOR.mundos.add(mundo);
    afirmar(violacionesDeDerivacion(opciones.clasificar(t), msgs, { hayRecepcion: hay }), t);
    return t;
  };
  return cuenta;
}

/** Las marcas de plan que `armar-mensajes.js` decide: `tipoDePlan === '…'` y `tipo === '…'`. */
export const PATRONES_DE_PLAN: RegExp[] = [/\btipoDePlan\s*===\s*'([a-z_0-9]+)'/, /(?<![A-Za-z0-9_.])tipo\s*===\s*'([a-z_0-9]+)'/];
export function planesDelCodigo(rutaArmarMensajes: string, patrones: RegExp[] = PATRONES_DE_PLAN): string[] {
  const fuente = readFileSync(rutaArmarMensajes, 'utf8');
  const planes = new Set<string>();
  for (const p of patrones) for (const m of fuente.matchAll(new RegExp(p.source, 'g'))) planes.add(m[1]!);
  return [...planes].sort();
}
/** COBERTURA ESTÁTICA: los planes del código que NO están en la tabla (y las entradas `exento` sin porqué). Vacío = cubierto. */
export function coberturaDePlanes(rutaArmarMensajes: string, tabla: TablaDePlanes, patrones?: RegExp[]): string[] {
  const faltas = planesDelCodigo(rutaArmarMensajes, patrones).filter((p) => !(p in tabla)).map((p) => `plan sin clasificar: «${p}»`);
  for (const [p, e] of Object.entries(tabla)) if (e.clase === 'exento' && !(e.porque ?? '').trim()) faltas.push(`plan exento sin porqué: «${p}»`);
  return faltas;
}
