/**
 * LA VALIDACIÓN DE URL DE IMAGEN, en su propio archivo (B3) para que `fuenteExterna.ts` la use sin importar
 * `catalogoWeb.ts` (que a su vez importa la fuente): un ciclo en ESM deja constantes sin inicializar.
 * Mismo cuerpo que tenía en `catalogoWeb.ts`, que la reexporta.
 */
/**
 * Una URL de imagen sirve si —y solo si— es `https://`, no trae credenciales
 * embebidas y no apunta a un nombre que resuelva dentro de la red privada.
 *
 * Las tres condiciones responden a cosas distintas:
 *
 *  - **`https` y nada más.** `javascript:` y `data:` en un atributo `src` son
 *    dos vías de ejecución conocidas; `http://` haría que la página del
 *    catálogo cargue contenido mixto y el navegador lo bloquee sin avisar, que
 *    para el comercio se ve como «no se ven las fotos» sin ninguna pista.
 *  - **Sin usuario ni contraseña en la URL.** Es una forma clásica de
 *    disfrazar el destino real de un enlace.
 *  - **Sin destinos internos.** Nadie las va a buscar desde el servidor —el
 *    navegador del cliente es quien las carga— pero dejar entrar
 *    `http://169.254.169.254/…` al catálogo es sembrar el día que alguien
 *    agregue una miniatura del lado servidor.
 *
 * Se exporta porque la consola valida lo mismo antes de guardar: el navegador
 * avisa, el servidor decide.
 */
export function urlImagenValida(valor: unknown): boolean {
  if (typeof valor !== 'string' || valor === '' || valor.length > 500) return false;
  let u: URL;
  try { u = new URL(valor); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  if (u.username !== '' || u.password !== '') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (/^(127|10|169\.254)\./.test(h)) return false;
  if (/^192\.168\./.test(h)) return false;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return false;
  if (h === '[::1]' || h === '0.0.0.0') return false;
  return true;
}

