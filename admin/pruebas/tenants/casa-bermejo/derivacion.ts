/**
 * LA TABLA DE DERIVACIÓN del flujo de Casa Bermejo (regla de Andres, 22/10/2026: una respuesta que ya resuelve no lleva el botón de una persona; el botón va solo al derivar).
 * La clave es el `plan` del resumen de `armar-mensajes.js` (`tipoDePlan`). La cobertura estática (`pruebas/core/ux-derivacion.test.ts`) exige que todo plan del código esté aquí.
 */
import type { TablaDePlanes } from '../../core/ux/derivacion';

export const TABLA_DE_PLANES: TablaDePlanes = {
  nada: { clase: 'resuelve' },              // sin mensajes
  sigue: { clase: 'resuelve' },             // el turno continúa; no emite por sí mismo
  bloqueado: { clase: 'resuelve' },         // Tomar: una persona atiende, cero envíos
  suspendido: { clase: 'resuelve' },        // el texto neutro del comercio: no ofrece nada
  fuera_de_pais: { clase: 'resuelve' },     // número de otro país: texto fijo sin botón
  cortes: { clase: 'resuelve' },            // tipo de mensaje no leído: texto cortés sin botón
  identidad: { clase: 'resuelve' },         // «¿eres un bot?»: dice que es una IA; no ofrece nada
  audio_fijo: { clase: 'resuelve' },        // nota de voz larga o ilegible: pide texto
  archivo: { clase: 'resuelve' },           // medio pesado o que no abrió: pide otro
  imagen_otra: { clase: 'resuelve' },       // foto o captura que no es un comprobante: pide que cuente por escrito
  anuncio: { clase: 'resuelve' },           // el producto del anuncio con su precio del catálogo
  modelo: { clase: 'resuelve' },            // la conversación: la redacción del modelo, revisada, sin botón
  qr: { clase: 'resuelve' },                // el resumen del pedido y el QR del comercio
  qr_pendiente: { clase: 'resuelve' },      // el recordatorio del QR abierto
  comprobante_pedir: { clase: 'resuelve' }, // el comprobante no se lee (pide una foto más nítida) o, en Argentina, el alias no coincide (pide el correcto)
  comprobante: { clase: 'deriva' },         // «llegó y los datos coinciden» o «NO coinciden» (todas las diferencias, B2/D3): recepción lo revisa (aviso + botón)
  pedido_sin_cobro: { clase: 'exento', porque: 'Bolivia sin QR: aviso + botón de recepción (lo exige la prueba «Bolivia sin QR» de alias-ar.test.ts). Argentina con el aviso ya enviado: el mensaje lleva el botón de respuesta «Pagar» (pedido:alias), que no puede ir junto al enlace a recepción en un mismo mensaje (B2/D6); su respaldo en texto SÍ lleva el enlace.' },
  derivar: { clase: 'deriva' },             // pasar con recepción: error, volumen, factura, pieza sin precio, comprobante sin pedido…
  uso_extendido: { clase: 'deriva' },       // el texto de la puerta promete una persona: aviso + botón
};
