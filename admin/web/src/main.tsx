/**
 * PUNTO DE ENTRADA DE LA CONSOLA. Monta la consola y nada más.
 *
 * HASTA T-37 ESTE ARCHIVO ELEGÍA ENTRE DOS APLICACIONES según la ruta: `/c/<ficha>`
 * montaba el catálogo público y todo lo demás, la consola. Las dos vivían en el
 * mismo sitio de Hosting, o sea en el mismo origen del navegador, y el origen es
 * donde el SDK de Firebase guarda las sesiones de administrador (admin/SEGURIDAD.md,
 * T-37).
 *
 * AHORA SON DOS SITIOS DE HOSTING CON ORÍGENES DISTINTOS:
 *
 *   consola   `index.html` → este archivo → `consola.tsx`. Detrás de inicio de sesión.
 *   catálogo  `catalogo.html` → `modulos/catalogo-web/publico/entrada.tsx`, con su
 *             propia compilación (`vite.catalogo.config.ts` → `dist-catalogo/`).
 *
 * Una ruta `/c/<ficha>` pedida a la consola ya NO monta el catálogo: cae en la
 * pantalla de ingreso, que no muestra datos de ningún comercio. Es deliberado:
 * si la consola siguiera sirviendo la página pública, la separación de orígenes
 * sería solo de nombre.
 *
 * El `import()` dinámico se conserva (la consola sigue partida en fragmentos y
 * `scripts/humo-staging.sh` lee el paquete a través de ellos).
 */
const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Falta el nodo #raiz');

void import('./consola').then((m) => m.montarConsola(raiz));
