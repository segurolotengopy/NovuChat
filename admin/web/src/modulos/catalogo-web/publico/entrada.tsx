import { montarCatalogo } from './montar';

/**
 * PUNTO DE ENTRADA DEL SITIO PÚBLICO DEL CATÁLOGO (segundo sitio de Hosting).
 *
 * Es lo ÚNICO que importa este paquete, y por eso es lo único que existe en
 * `web/dist-catalogo/`: nada de `consola`, `App`, `react-router-dom` ni del SDK
 * de Firebase. Si alguien importa algo de la consola desde acá o desde
 * `publico/`, `pruebas/modulos/catalogo-web/sitio-publico.test.ts` lo corta, y
 * `scripts/modulos/catalogo-web/verificar-sitio-publico.mjs` lo vuelve a mirar sobre el paquete ya
 * compilado. Es lo que T-37 (admin/SEGURIDAD.md) pide: el código de sesión de un
 * administrador no tiene que existir en el origen que abre un desconocido.
 *
 * Antes esta decisión la tomaba `main.tsx` mirando la ruta (`/c/<ficha>`) y
 * cargaba uno de dos trozos del MISMO sitio; con dos sitios, cada uno monta lo
 * suyo y la ruta solo valida.
 */
const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Falta el nodo #raiz');

if (/^\/c\/[0-9a-f]{32}$/.test(window.location.pathname)) {
  montarCatalogo(raiz);
} else {
  // Hosting solo reescribe `/c/**` a esta página, pero una ruta como `/c/algo`
  // llega hasta acá. Se dice con `textContent` —nunca con HTML— y sin pedir
  // nada al servidor: una ficha mal formada no puede existir.
  const mensaje = document.createElement('p');
  mensaje.style.cssText = 'font-family: system-ui, sans-serif; padding: 2rem; text-align: center;';
  mensaje.textContent = 'Este enlace no es válido. Escríbenos por WhatsApp y te mandamos uno nuevo.';
  raiz.replaceChildren(mensaje);
}
