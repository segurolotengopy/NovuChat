import type { AvisoConsumo as Aviso } from '../lib/planes';

/**
 * «Llegaste al 80 % de las conversaciones de tu plan».
 *
 * UNA SOLA FRASE, EN UN SOLO LUGAR, porque la dicen el tablero y el estado de
 * cuenta y tiene que ser la misma: la del sitio y la de la propuesta. La
 * palabra es «bolsa», nunca «excedente» — un excedente suena a multa, y la
 * bolsa es algo que el comercio elige comprar y que no vence.
 *
 * Los números son los que escribió el servidor al marcar el aviso, no una
 * cuenta hecha acá.
 */
export function AvisoConsumo({ aviso }: { aviso: Aviso }) {
  return (
    <p className="ayuda aviso-datos aviso-consumo" role="status">
      <strong>
        Llegaste al {aviso.porcentaje} % de las conversaciones de tu plan
        ({aviso.conversaciones.toLocaleString('es-BO')} de {aviso.limite.toLocaleString('es-BO')}).
      </strong>{' '}
      Si lo pasas, puedes sumar una bolsa de 30 conversaciones por USD 10, que no vence.
    </p>
  );
}
