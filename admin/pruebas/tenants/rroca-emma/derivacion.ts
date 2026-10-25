/**
 * LA TABLA DE DERIVACIÓN del flujo nuevo de Emma (regla de Andres, 22/10/2026: una respuesta que ya resuelve no lleva el botón de una persona; el botón va solo al derivar). La clave es el plan del turno
 * (`efectivo` en `armar-mensajes.js`, el `plan` del resumen). La usan `derivacion.test.ts` (cobertura estática del código y vigilante en una batería) y el registro de `core/ux/flujos-derivacion.ts`.
 */
import type { TablaDePlanes } from '../../core/ux/derivacion';

export const TABLA_DE_PLANES: TablaDePlanes = {
  nada: { clase: 'resuelve' },            // sin mensajes
  suspendido: { clase: 'resuelve' },      // el texto neutro del comercio: no ofrece nada
  riesgo: { clase: 'resuelve' },          // protección: texto fijo SIN botón, sin recursos ni números
  baja: { clase: 'resuelve' },            // la confirmación breve de la baja: silencio después
  fijo: { clase: 'resuelve' },            // archivo, audio ilegible, sticker: texto cortés sin botón
  modelo: { clase: 'resuelve' },          // la conversación libre: el botón solo aparece en la derivación (la etiqueta del modelo cambia el plan a `derivar`)
  uso_extendido: { clase: 'deriva' },     // texto propio que ofrece el botón de la recepción
  medica: { clase: 'deriva' },            // consulta médica: texto fijo sin consejo + aviso + botón
  remision: { clase: 'deriva' },          // habló de salud sin remitir a la valoración: texto fijo + botón
  fallo: { clase: 'deriva' },             // el modelo cayó o su respuesta no pasó las barreras: texto fijo + botón
  gratis: { clase: 'resuelve' },          // la pregunta por la gratuidad que el modelo no pudo contestar: texto fijo, sin botón ni aviso
  derivar_corto: { clase: 'deriva' },     // el cierre ya salió (48 h) y el cliente vuelve a pedir agendar: variante corta distinta + botón, sin repetir el aviso
  derivar: { clase: 'deriva' },           // el cliente quiere agendar: cierre fijo + botón
};
