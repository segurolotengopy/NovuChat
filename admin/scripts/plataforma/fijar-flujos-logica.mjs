/**
 * LA DECISIÓN DE `fijar-flujos.mjs`, SIN NUBE: dado el estado de un comercio y la lista de flujos que se pide,
 * qué se haría o por qué se rechaza. Pura (sin Firebase ni disco) para poder probarla negando.
 *
 * REGLAS. Se rechaza, sin escribir, cuando:
 *   · no se pide ningún flujo, se repite uno o no es un flujo del registro;
 *   · la ficha no existe;
 *   · la ficha ya tiene `modulos` (la lista nueva derivada del registro: cambiar `flujos` sola la dejaría incoherente);
 *   · se QUITA un flujo que usa una ruta de WhatsApp del comercio (el número dejaría de tener a dónde ir).
 * No se borra la configuración de un flujo quitado (`config/<doc>`): se informa y queda sin uso.
 */
/** Cuántas rutas se leen como máximo; con más, se rechaza (no se puede asegurar que ninguna use el flujo quitado). */
export const MAX_RUTAS = 50;

/** Texto fijo de la negativa para una ficha que ya tiene `modulos`. */
export const MENSAJE_CON_MODULOS = 'la ficha ya tiene modulos: use aplicar-modulos-tenant.mjs';

export function planearFlujos({ ficha, pedidos, rutas = [], esFlujo }) {
  const problemas = [];
  if (!ficha) return { error: 'el comercio no existe' };
  // Doble escritura (H2b-7): con `modulos` (lista) cambiar `flujos` sola cerraría capacidades en silencio.
  // Sale antes que cualquier otra validación, con código 2 (llamada mal hecha para esta ficha).
  if (ficha.modulos !== undefined && ficha.modulos !== null) return { error: MENSAJE_CON_MODULOS, codigo: 2 };
  if (!Array.isArray(pedidos) || pedidos.length === 0) problemas.push('falta --flujos (al menos uno)');
  const lista = Array.isArray(pedidos) ? pedidos.map((f) => String(f).trim()) : [];
  if (new Set(lista).size !== lista.length) problemas.push('--flujos repite un flujo');
  for (const f of lista) if (!esFlujo(f)) problemas.push(`flujo desconocido: ${f || '(vacío)'}`);
  const antes = Array.isArray(ficha.flujos) ? ficha.flujos.map(String) : [ficha.vertical].filter(Boolean).map(String);
  const quitados = antes.filter((f) => !lista.includes(f));
  const agregados = lista.filter((f) => !antes.includes(f));
  if (rutas.length > MAX_RUTAS) problemas.push(`el comercio tiene más de ${MAX_RUTAS} rutas de WhatsApp: verificar a mano`);
  for (const r of rutas) {
    // Una ruta sin flujo, o con uno que el registro no conoce, no se puede descartar como «no usa el quitado».
    if (!esFlujo(r.flujo)) { problemas.push(`una ruta (…${String(r.numero ?? '').slice(-4)}) tiene un flujo ausente o desconocido: verificar a mano`); continue; }
    if (quitados.includes(String(r.flujo))) {
      problemas.push(`una ruta de WhatsApp (…${String(r.numero ?? '').slice(-4)}) usa el flujo ${r.flujo}: no se puede quitar`);
    }
  }
  if (problemas.length) return { error: problemas.join('; ') };
  const igual = antes.length === lista.length && antes.every((f, i) => f === lista[i]) && ficha.vertical === lista[0];
  return { antes, despues: lista, quitados, agregados, vertical: lista[0], sinCambios: igual };
}
