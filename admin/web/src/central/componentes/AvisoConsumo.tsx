import { bolsasOfrecidas } from '../lib/pagar';
import type { AvisoConsumoVista } from '../lib/planes';

/**
 * «Llegaste al 80 % de las conversaciones de tu plan».
 *
 * UNA SOLA FRASE, EN UN SOLO LUGAR, porque la dicen el tablero y el estado de
 * cuenta y tiene que ser la misma: la del sitio y la de la propuesta. La
 * palabra es «bolsa», nunca «excedente» — un excedente suena a multa, y la
 * bolsa es algo que el comercio elige comprar y que no vence.
 *
 * Los números del aviso son los que escribió el servidor al marcarlo, no una
 * cuenta hecha acá; la bolsa que se nombra es la de la tarifa de la cuenta
 * (`bolsasOfrecidas`, la misma que el servidor deja comprar): a `estandar` no se
 * le promete la de 30 por USD 10, que el servidor le rechazaría.
 */
export function AvisoConsumo({ aviso, cuenta }: {
  aviso: AvisoConsumoVista;
  /** La cuenta (`cuenta/estado`), de la que sale la tarifa. Sin campo `tarifa`: `meta_incluido`. */
  cuenta?: Record<string, unknown> | null;
  // `undefined` = no se sabe la cuenta: no se nombra ninguna bolsa. `{}` = cuenta sin tarifa: la de siempre.
}) {
  // Solo de conversaciones: la de seguimiento no es lo que se agota.
  const bolsa = cuenta === undefined || cuenta === null ? undefined : bolsasOfrecidas(cuenta).find((b) => b.tipo !== 'bolsaSalientes');
  return (
    <p className="ayuda aviso-datos aviso-consumo" role="status">
      <strong>
        Llegaste al {aviso.porcentaje} % de las conversaciones de tu plan
        ({aviso.conversaciones.toLocaleString('es-BO')} de {aviso.limite.toLocaleString('es-BO')}).
      </strong>{' '}
      {bolsa
        ? <>Si lo pasas, puedes sumar una bolsa de {bolsa.unidades} conversaciones por
          USD {bolsa.precioUsd}, que no vence.</>
        : null}
    </p>
  );
}
