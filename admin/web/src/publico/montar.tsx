import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SitioCatalogo } from './SitioCatalogo';
import '../diseno.css';
import './catalogo.css';

/**
 * Monta el sitio público. No hay enrutador: la página es una sola y la ficha ya
 * viene en la dirección, validada por `main.tsx` antes de cargar este trozo.
 * Meter `react-router` acá sería sumar una dependencia a la página que más
 * necesita ser liviana, a cambio de nada.
 *
 * NO SE IMPORTA `estilos.css`: es la hoja de la consola —tablas, menú, tablero—
 * y acá no se usa ni una de sus clases. Sí se importa `diseno.css`, que trae la
 * tipografía y los tokens: el catálogo lleva la marca del comercio, pero la
 * estructura es la misma que el resto del producto.
 */
export function montarCatalogo(raiz: HTMLElement): void {
  const ficha = window.location.pathname.slice('/c/'.length);

  // La consola sigue la preferencia del sistema con `tema.ts`. Acá NO: el
  // catálogo lleva el color de un comercio que lo eligió mirando un fondo
  // claro, y un tema oscuro automático puede dejar su marca ilegible sobre su
  // propio logo. Un catálogo es una vidriera, y una vidriera no cambia de color
  // según quién pase.
  document.documentElement.style.colorScheme = 'light';

  createRoot(raiz).render(
    <StrictMode>
      <SitioCatalogo ficha={ficha} />
    </StrictMode>,
  );
}
