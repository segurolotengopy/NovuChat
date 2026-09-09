/**
 * PUNTO DE ENTRADA. Decide cuál de las dos aplicaciones se monta y NO importa
 * ninguna de las dos de forma estática: cada `import()` es un trozo aparte, y
 * el navegador descarga solo el que le toca.
 *
 * DOS APLICACIONES EN UN MISMO SITIO:
 *
 *   /c/<ficha>   el catálogo público que ve un cliente final. Sin sesión, sin
 *                Firebase, con la marca del comercio.
 *   todo lo demás  la consola, detrás de un inicio de sesión.
 *
 * LA DECISIÓN SE TOMA POR LA RUTA Y ANTES DE CARGAR NADA. Hacerlo con el
 * enrutador —una ruta `/c/:ficha` más dentro de `App`— habría sido menos código
 * y habría cargado la consola entera para cada cliente final que abre un
 * enlace.
 */
const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Falta el nodo #raiz');

if (/^\/c\/[0-9a-f]{32}$/.test(window.location.pathname)) {
  void import('./publico/montar').then((m) => m.montarCatalogo(raiz));
} else {
  void import('./consola').then((m) => m.montarConsola(raiz));
}
