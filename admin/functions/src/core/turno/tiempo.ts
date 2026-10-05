/**
 * El tiempo en las marcas que guarda Firestore. Puro: no importa nada.
 *
 * F3b-1a (05/10/2026): vivía en `ingesta.ts`; baja a Core porque lo usan Agenda
 * (`seguimientos.ts`, la solicitud) y el coordinador, y un módulo no puede
 * importar el archivo del coordinador. Sin cambio de lógica.
 */

/** Milisegundos de un Timestamp (o de algo que se le parezca), o `null`. */
export function milisegundosDe(v: unknown): number | null {
  const t = v as { toMillis?: () => number; seconds?: unknown } | null | undefined;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?.seconds === 'number') return t.seconds * 1000;
  return null;
}
