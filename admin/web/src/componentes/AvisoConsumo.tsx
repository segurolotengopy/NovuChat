import { BOLSA, type AvisoConsumoVista } from '../lib/planes';

/**
 * «Llegaste al 80 % de las conversaciones de tu plan».
 *
 * UNA SOLA FRASE, EN UN SOLO LUGAR, porque la dicen el tablero y el estado de
 * cuenta y tiene que ser la misma: la del sitio y la de la propuesta. La
 * palabra es «bolsa», nunca «excedente» — un excedente suena a multa, y la
 * bolsa es algo que el comercio elige comprar y que no vence.
 *
 * Los números del aviso son los que escribió el servidor al marcarlo, no una
 * cuenta hecha acá; los de la bolsa salen de `BOLSA` (`functions/src/planes.ts`).
 */
export function AvisoConsumo({ aviso }: { aviso: AvisoConsumoVista }) {
  return (
    <p className="ayuda aviso-datos aviso-consumo" role="status">
      <strong>
        Llegaste al {aviso.porcentaje} % de las conversaciones de tu plan
        ({aviso.conversaciones.toLocaleString('es-BO')} de {aviso.limite.toLocaleString('es-BO')}).
      </strong>{' '}
      Si lo pasas, puedes sumar una bolsa de {BOLSA.conversaciones} conversaciones por
      USD {BOLSA.precioUsd}, que no vence.
    </p>
  );
}
