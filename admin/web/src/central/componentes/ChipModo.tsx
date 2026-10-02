import type { ModoComercio } from '../lib/modoComercio';

/**
 * EL CHIP «PRUEBA» / «PRODUCCIÓN». Pedido explícito: que se vea, pero no con
 * letras grandes. Es una pastilla del tamaño de las demás (`.tag`, 12 px), con
 * el detalle de la modalidad en el `title`.
 *
 * Solo dibuja: no lee Firestore ni decide nada. El modo lo calcula
 * `modoDelComercio`, que usa `modalidadDe` del módulo del servidor. Por eso se
 * puede dibujar en una prueba sin navegador ni emulador.
 */
export function ChipModo({ modo }: { modo: ModoComercio }) {
  return (
    <span
      className={`tag ${modo.produccion ? 'tag-modo-produccion' : 'tag-modo-prueba'}`}
      title={modo.detalle}
    >
      {modo.etiqueta}
    </span>
  );
}
