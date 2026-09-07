import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { iniciarTema } from './lib/tema';
import './diseno.css';
import './estilos.css';

/**
 * MONTAJE DE LA CONSOLA. Era el contenido de `main.tsx`, y se mudó acá cuando
 * apareció el sitio público del catálogo.
 *
 * POR QUÉ SE PARTIÓ. `main.tsx` importaba `App`, y `App` arrastra —por la
 * cadena de sesión— el SDK de Firebase entero: Auth, Firestore, Functions y App
 * Check. El sitio del catálogo lo abre un cliente final desde un enlace de
 * WhatsApp, casi siempre con datos móviles y un teléfono modesto, y **no
 * necesita nada de eso**: no hay sesión que abrir ni base que consultar, porque
 * todo le llega por una sola petición a una función pública.
 *
 * Con la importación dinámica de `main.tsx`, el navegador del cliente descarga
 * el trozo del catálogo y NO el de la consola. Además de los cientos de
 * kilobytes, hay una razón que no es de rendimiento: el código que gestiona
 * sesiones de administrador no tiene por qué ni siquiera existir en la página
 * que ve un desconocido.
 */
export function montarConsola(raiz: HTMLElement): void {
  iniciarTema();
  createRoot(raiz).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}
