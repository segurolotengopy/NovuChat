/**
 * LA TABLA DE DERIVACIÓN del flujo de Walisuma (regla de Andres, 22/10/2026: una respuesta que ya resuelve no lleva el botón de una persona; el botón va solo al derivar).
 * La clave es el `plan` del resumen de `armar-mensajes.js`. PROVISIONAL (PR-2, esqueleto): solo trae los planes que el esqueleto sabe armar; el PR-3 agrega los de la
 * venta (carrito, cobro, cotejo, derivación a una persona) con su cobertura estática y el vigilante en la batería.
 */
import type { TablaDePlanes } from '../../core/ux/derivacion';

export const TABLA_DE_PLANES: TablaDePlanes = {
  nada: { clase: 'resuelve' },          // sin mensajes
  sigue: { clase: 'resuelve' },         // el turno continúa hacia la conversación (PR-3); el esqueleto no emite nada
  bloqueado: { clase: 'resuelve' },     // Tomar: una persona atiende, cero envíos
  suspendido: { clase: 'resuelve' },    // el texto neutro del comercio: no ofrece nada
  fuera_de_pais: { clase: 'resuelve' }, // número de otro país: texto cortés sin botón
  cortes: { clase: 'resuelve' },        // tipo de mensaje no leído: texto cortés sin botón
  uso_extendido: { clase: 'deriva' },   // el texto propio de la puerta ofrece el contacto con una persona
};
