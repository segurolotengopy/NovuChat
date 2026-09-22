/**
 * ¿ESTE COMERCIO ESTÁ EN PRUEBA O EN PRODUCCIÓN? Lo que dice la cabecera de la
 * consola y la columna «Modo» de la cartera.
 *
 * Pedido de Andres (22/09/2026): arriba de la consola tiene que verse el nombre
 * del comercio y si es PRUEBA o PRODUCCIÓN, sin letras grandes. Quien administra
 * dos negocios —o el propietario, que entra a todos— tiene que saber de un
 * vistazo si lo que toca le llega a clientes que pagan.
 *
 * LA REGLA NO SE ESCRIBE ACÁ. La modalidad la decide `modalidadDe` del módulo
 * compartido con el servidor (`functions/src/prepago.ts`, reexportado por
 * `lib/prepago.ts`): ausente = demostración, y `plan: 'demostracion'` también
 * es demostración (`DISENO.md` §4undecies.2). Si la pantalla comparara el
 * campo `modalidad` a mano, el día que esa regla cambie la cabecera diría
 * PRODUCCIÓN de un comercio que el servidor trata como demostración.
 *
 * Solo `prepago` es PRODUCCIÓN: es el único en el que el comercio paga y el
 * servidor puede cortarle el servicio. Demostración y mes de prueba son PRUEBA.
 *
 * Módulo puro, sin Firebase: lo prueba `pruebas/encabezado-comercio.test.ts`
 * sin emulador ni navegador.
 */
import { modalidadDe, type CuentaCruda, type Modalidad } from './prepago';

export type EtiquetaModo = 'PRUEBA' | 'PRODUCCIÓN';

export interface ModoComercio {
  etiqueta: EtiquetaModo;
  /** El detalle para el `title`: qué modalidad es exactamente. */
  detalle: string;
  /** Para elegir la clase del chip. */
  produccion: boolean;
}

const DETALLE: Record<Modalidad, string> = {
  demostracion: 'Demostración',
  prueba: 'Mes de prueba',
  prepago: 'Prepago',
};

export function modoDelComercio(cuenta: CuentaCruda | null | undefined): ModoComercio {
  const modalidad = modalidadDe(cuenta);
  const produccion = modalidad === 'prepago';
  return {
    etiqueta: produccion ? 'PRODUCCIÓN' : 'PRUEBA',
    detalle: DETALLE[modalidad],
    produccion,
  };
}
