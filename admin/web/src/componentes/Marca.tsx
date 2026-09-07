import { Link } from 'react-router-dom';

/**
 * MARCA DE NOVUCHAT: logotipo y nombre, y la vuelta al inicio.
 *
 * POR QUÉ ES UN ENLACE. En cualquier panel, el nombre de arriba a la izquierda
 * lleva al inicio: es una convención tan asentada que la gente la usa sin
 * pensarla, y cuando no funciona se queda mirando la pantalla sin saber cómo
 * salir. Pasaba en «Mi cuenta», que no tenía ninguna salida.
 *
 * EL SÍMBOLO ES UN SVG EN LÍNEA, no un archivo. Son doce líneas, no agrega una
 * petición al cargar la página, y —lo que importa— usa `currentColor`, así que
 * hereda el color del tema: en claro se ve oscuro y en oscuro se ve claro, sin
 * mantener dos imágenes que se desincronizan.
 */
export function Marca() {
  return (
    <Link to="/" className="nav-brand" aria-label="NovuChat, ir al inicio">
      <svg width="26" height="26" viewBox="0 0 24 24" role="presentation" focusable="false">
        {/* Globo de conversación: el producto es un asistente de WhatsApp. */}
        <path
          d="M4 3h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4V4a1 1 0 0 1 1-1z"
          fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"
        />
        {/* Tres puntos: está escribiendo. */}
        <circle cx="8.5" cy="9.5" r="1.15" fill="currentColor" />
        <circle cx="12" cy="9.5" r="1.15" fill="currentColor" />
        <circle cx="15.5" cy="9.5" r="1.15" fill="currentColor" />
      </svg>
      <span>NovuChat</span>
    </Link>
  );
}
