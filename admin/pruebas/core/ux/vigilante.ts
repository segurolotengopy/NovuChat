/**
 * VIGILANTE DE UX COMÚN (27/11/2026; estándar del asistente de venta v1.1, §3.1, §3.4, §4.3 y UX-5): sube a `admin/pruebas/core/` lo que hasta hoy vivía copiado
 * en `tenants/<t>/vigilante-ux.ts` (doctoras, rroca-*). Sin vocabulario de ningún comercio: mide la FORMA de lo que el cliente recibe.
 *
 *   3.1  párrafos de 2 oraciones como máximo, sin saltos triples ni espacios al borde (la partición es la de la pieza común `ctOraciones`);
 *   3.4  límites de WhatsApp: texto 4096, cuerpo interactivo 1024, botón 20 (3 botones como máximo), fila 24 con descripción 72 (10 filas como máximo) y ninguna clave `link`;
 *   4.3  un botón o fila ya pulsado no reaparece en ningún mensaje posterior de esa conversación, por teléfono;
 *   UX-5 toda pregunta por opciones sale con botón o lista en ese mismo mensaje.
 *
 * `vigilarUx(mundo)` envuelve `mundo.turno`: cada turno que se hable pasa por aquí. Las funciones puras se prueban también con casos negativos.
 */
import type { J } from '../../lib/flujo';
import type { Enviado, Mundo, OpcionesTurno, ResultadoTurno } from '../../lib/n8n-de-mentira';
import { parrafosLargos, preguntaPorOpciones } from './catalogo';

export const LIMITES_WHATSAPP = { texto: 4096, cuerpoInteractivo: 1024, boton: 20, botones: 3, titulo: 24, descripcion: 72, filas: 10 } as const;

const interactivo = (p: J): J => ((p['interactive'] ?? {}) as J);
const accion = (p: J): J => ((interactivo(p)['action'] ?? {}) as J);
/** Los ids de botones y de filas de un payload. */
export function idsDeOpciones(payload: J): string[] {
  const botones = ((accion(payload)['buttons'] ?? []) as J[]).map((b) => String((b['reply'] as J | undefined)?.['id']));
  const filas = ((accion(payload)['sections'] ?? []) as J[]).flatMap((s) => ((s['rows'] ?? []) as J[]).map((r) => String(r['id'])));
  return [...botones, ...filas];
}
/** Los problemas de límites de WhatsApp (§3.4) de UN payload. */
export function problemasDeLimites(payload: J): string[] {
  const v: string[] = [];
  if ('link' in payload) v.push('clave `link` en el payload');
  const tipo = String(payload['type'] ?? '');
  if (tipo === 'text') {
    const largo = String((payload['text'] as J | undefined)?.['body'] ?? '').length;
    if (largo > LIMITES_WHATSAPP.texto) v.push(`texto de ${largo} caracteres (máximo ${LIMITES_WHATSAPP.texto})`);
  } else if (tipo === 'interactive') {
    const cuerpo = String((interactivo(payload)['body'] as J | undefined)?.['text'] ?? '').length;
    if (cuerpo > LIMITES_WHATSAPP.cuerpoInteractivo) v.push(`cuerpo interactivo de ${cuerpo} caracteres (máximo ${LIMITES_WHATSAPP.cuerpoInteractivo})`);
    const botones = (accion(payload)['buttons'] ?? []) as J[];
    if (botones.length > LIMITES_WHATSAPP.botones) v.push(`${botones.length} botones (máximo ${LIMITES_WHATSAPP.botones})`);
    for (const b of botones) {
      const t = String((b['reply'] as J | undefined)?.['title'] ?? '');
      if (t.length > LIMITES_WHATSAPP.boton) v.push(`título de botón de ${t.length} caracteres (máximo ${LIMITES_WHATSAPP.boton})`);
    }
    const filas = ((accion(payload)['sections'] ?? []) as J[]).flatMap((s) => ((s['rows'] ?? []) as J[]));
    if (filas.length > LIMITES_WHATSAPP.filas) v.push(`${filas.length} filas (máximo ${LIMITES_WHATSAPP.filas})`);
    for (const f of filas) {
      if (String(f['title'] ?? '').length > LIMITES_WHATSAPP.titulo) v.push(`título de fila de más de ${LIMITES_WHATSAPP.titulo} caracteres`);
      if (String(f['description'] ?? '').length > LIMITES_WHATSAPP.descripcion) v.push(`descripción de fila de más de ${LIMITES_WHATSAPP.descripcion} caracteres`);
    }
  }
  return v;
}
/** Los problemas de forma del texto visible (§3.1). */
export function problemasDeForma(cuerpo: string): string[] {
  const v = parrafosLargos(cuerpo).map((p) => `párrafo con más de 2 oraciones: «${p.slice(0, 40)}…»`);
  if (/\n{3,}/.test(cuerpo)) v.push('saltos de línea triples');
  if (cuerpo !== cuerpo.trim()) v.push('espacios sobrantes al borde');
  return v;
}

export interface EstadoUx { pulsados: Map<string, Set<string>> }
export const estadoUxNuevo = (): EstadoUx => ({ pulsados: new Map() });
/** El id que el cliente tocó en el mensaje entrante (botón o fila), si lo hubo: [teléfono, id]. */
export function toqueDeEntrada(entrada: J): [string, string] | null {
  const m = (((entrada['body'] as J | undefined)?.['value'] as J | undefined)?.['messages'] ?? []) as J[];
  const msg = m[0];
  if (!msg) return null;
  const i = (msg['interactive'] ?? {}) as J;
  const id = (i['button_reply'] as J | undefined)?.['id'] ?? (i['list_reply'] as J | undefined)?.['id'];
  return typeof id === 'string' ? [String(msg['from']), id] : null;
}
/** Las violaciones de UN turno: lo pulsado se registra ANTES de mirar la respuesta. Pura. */
export function violacionesDeTurno(estado: EstadoUx, toque: [string, string] | null, mensajes: Array<Pick<Enviado, 'a' | 'cuerpo' | 'payload'>>): string[] {
  const v: string[] = [];
  if (toque) { const s = estado.pulsados.get(toque[0]) ?? new Set<string>(); s.add(toque[1]); estado.pulsados.set(toque[0], s); }
  for (const m of mensajes) {
    const p = (m.payload ?? {}) as J;
    const pulsados = estado.pulsados.get(m.a) ?? new Set<string>();
    for (const id of idsDeOpciones(p)) if (pulsados.has(id)) v.push(`4.3 el botón o fila «${id}» ya pulsado reapareció`);
    for (const x of problemasDeForma(m.cuerpo)) v.push(`3.1 ${x}`);
    for (const x of problemasDeLimites(p)) v.push(`3.4 ${x}`);
    if (preguntaPorOpciones(m.cuerpo) && p['type'] !== 'interactive') v.push('UX-5 pregunta por opciones sin botón ni lista');
  }
  return v;
}

/** Envuelve `mundo.turno`: cada turno se vigila y una violación lo rompe. Devuelve el contador de turnos vigilados. */
export function vigilarUx(mundo: Mundo, opciones: { tolerar?: (v: string) => boolean } = {}): { turnos: number } {
  const estado = estadoUxNuevo();
  const cuenta = { turnos: 0 };
  const original = mundo.turno.bind(mundo);
  mundo.turno = (entrada: J, op?: OpcionesTurno): ResultadoTurno => {
    const r = original(entrada, op);
    cuenta.turnos++;
    const v = violacionesDeTurno(estado, toqueDeEntrada(entrada), r.mensajes).filter((x) => !(opciones.tolerar?.(x)));
    if (v.length) throw new Error(`vigilante de UX violado: ${v.join('; ')}`);
    return r;
  };
  return cuenta;
}
