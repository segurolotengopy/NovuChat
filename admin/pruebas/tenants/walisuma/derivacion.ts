/**
 * LA TABLA DE DERIVACIÓN del flujo de Walisuma (regla de Andres, 22/10/2026: una respuesta que ya resuelve no lleva el botón de una persona; el botón va solo al derivar).
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
  anuncio_meta: { clase: 'resuelve' },      // el anuncio de Meta por su source_id: las piezas con su precio del catálogo y el enlace del catálogo (fase 1)
  ubicacion: { clase: 'resuelve' },         // el pin de ubicación guardado: un agradecimiento fijo (fase 1)
  pedir_ubicacion: { clase: 'resuelve' },   // un envío sin GPS: el resumen y el botón «Enviar ubicación» (no es derivación) (fase 1)
  factura_sin: { clase: 'resuelve' },       // «sin factura» / «a mi nombre nomás» tras el pago: S/N, sin insistir (fase 1)
  factura_pedir: { clase: 'resuelve' },
  factura_al_confirmar: { clase: 'resuelve' }, // factura ANTES de pagar con el NIT escrito: «se la pedimos al confirmar» (Andres, 19/11/2026)     // vuelve a pedir la razón social y el NIT tras el pago (fase 1)
  factura_datos: { clase: 'deriva' },       // los datos de factura van a nuestra encargada: aviso + botón (fase 1)
  carrito_listo: { clase: 'resuelve' },     // el pedido del catálogo web completo: el resumen «listo para confirmar», sin QR ni botón (el paso final se conectará al botón común «Confirmar pedido»)
  carrito_pide: { clase: 'resuelve' },      // el pedido del catálogo web con la entrega incompleta: las piezas, el total y lo que falta, sin botón
  qr: { clase: 'resuelve' },                // el resumen del pedido y el QR del comercio
  qr_pendiente: { clase: 'resuelve' },      // el recordatorio del QR abierto
  comprobante_pedir: { clase: 'resuelve' }, // el comprobante no coincide o no se lee: pide el correcto
  comprobante: { clase: 'deriva' },         // «Pedido confirmado», «llegó y los datos coinciden»: nuestra encargada lo revisa en su cuenta (aviso + botón)
  pedido_sin_cobro: { clase: 'deriva' },    // sin QR de cobro real: recepción coordina el pago (aviso + botón)
  derivar: { clase: 'deriva' },             // pasar con recepción: error, volumen, factura, pieza sin precio, comprobante sin pedido…
  uso_extendido: { clase: 'deriva' },       // el texto de la puerta promete una persona: aviso + botón
};
