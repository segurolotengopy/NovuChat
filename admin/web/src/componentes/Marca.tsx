import { Link } from 'react-router-dom';

/**
 * ISOTIPO DE NOVUCHAT: el dibujo suelto, sin el nombre ni el enlace.
 *
 * ES EL MISMO DE `novuchat.site/isotipo.svg`: burbuja de conversación en
 * pizarra, con el aro exterior hueco y los tres puntos en verde menta. Antes
 * había acá otro globo, dibujado a mano y sin relación con el del sitio, así
 * que el cliente veía dos logotipos distintos de la misma empresa entre un
 * clic y el siguiente.
 *
 * VA EN LÍNEA Y NO COMO `<img src="/isotipo.svg">`, que es como lo sirve el
 * sitio, por una razón concreta: un SVG cargado con `<img>` no ve las hojas de
 * estilo del documento, así que el sitio tiene que quemar `#2f3a44` dentro del
 * archivo. Esa pizarra sobre el fondo casi negro del tema oscuro casi no se ve.
 * Acá el cuerpo de la burbuja usa `currentColor` —lo tiñe el CSS, y en oscuro
 * toma el color del texto— y los tres puntos conservan el verde de la marca,
 * que contrasta bien contra los dos fondos.
 *
 * Se exporta aparte de `Marca` porque la pantalla de ingreso también lo
 * necesita, y ahí no puede ser un enlace: quien está en `/ingresar` todavía no
 * entró a ningún lado.
 */
export function Isotipo({ tamano = 30 }: { tamano?: number }) {
  return (
    <svg width={tamano} height={tamano} viewBox="0 0 120 120" role="presentation" focusable="false">
      <g fill="none" fillRule="evenodd">
        {/* Cola de la burbuja */}
        <path fill="currentColor" d="M97 79 112.5 112.5 83 93z" />
        {/* Aro exterior: el hueco entre el aro y el disco queda TRANSPARENTE a
            propósito, para que el fondo se vea a través en los dos temas. */}
        <circle cx="60" cy="56" r="47.5" stroke="currentColor" strokeWidth="9" />
        {/* Disco interior */}
        <circle cx="60" cy="56" r="36" fill="currentColor" />
        {/* Los tres puntos: está escribiendo. */}
        <g fill="#35e2a0">
          <circle cx="43.5" cy="56" r="6.6" />
          <circle cx="60" cy="56" r="6.6" />
          <circle cx="76.5" cy="56" r="6.6" />
        </g>
      </g>
    </svg>
  );
}

/**
 * MARCA DE LA CABECERA: isotipo y nombre, y la vuelta al inicio.
 *
 * POR QUÉ ES UN ENLACE. En cualquier panel, el nombre de arriba a la izquierda
 * lleva al inicio: es una convención tan asentada que la gente la usa sin
 * pensarla, y cuando no funciona se queda mirando la pantalla sin saber cómo
 * salir. Pasaba en «Mi cuenta», que no tenía ninguna salida.
 */
export function Marca() {
  return (
    <Link to="/" className="nav-brand" aria-label="NovuChat, ir al inicio">
      <Isotipo />
      <span>NovuChat</span>
    </Link>
  );
}
