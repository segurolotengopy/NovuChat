/**
 * =============================================================================
 * LAS COORDENADAS SALEN DEL ENLACE, NO DE LA PERSONA
 * =============================================================================
 *
 * POR QUÉ EXISTE (decisión de Andres, 19/09/2026). La pantalla pedía la latitud
 * y la longitud a mano, con la instrucción de hacer clic derecho en Google Maps
 * y copiar dos números. **Nadie va a hacer eso.** Y sin coordenadas no hay pin
 * de WhatsApp, así que al cliente le queda el enlace, que en Android se reescribe
 * a `goo.gl/app/maps` —la forma vieja de Dynamic Links, que Google apagó— y
 * muere con «Invalid Dynamic Link» (comprobado con un teléfono el 19/09).
 *
 * El comercio ya pega el enlace que le da el botón «Compartir» de Maps. De ahí
 * salen las coordenadas: este es el único paso que el navegador NO puede hacer
 * solo, porque el enlace corto responde con una redirección que el navegador no
 * deja leer desde otro origen.
 *
 * SEGURIDAD: ESTO ES UN FETCH A UNA URL QUE ESCRIBE UN USUARIO, y eso es un
 * pedido desde el servidor a donde diga el usuario (SSRF) si no se acota. Acá
 * se acota así, y las tres cosas importan:
 *   - la URL de entrada tiene que pasar `enlaceDeMapaValido`, la misma lista de
 *     dominios de Google que ya exigen las reglas y el prompt;
 *   - se siguen COMO MUCHO 3 redirecciones, y cada destino se vuelve a exigir
 *     que sea de Google: una redirección a otro sitio corta;
 *   - NO se descarga el cuerpo. Solo se leen las cabeceras (`HEAD`/`GET` con
 *     corte), porque las coordenadas viajan en la URL de destino. Así no se
 *     puede usar esto para leer una página interna ni para traer datos.
 * Y el resultado son dos números validados: nunca se devuelve nada que haya
 * dicho el servidor del otro lado.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { REGION } from './region.js';
import { enlaceDeMapaValido, ubicacionDe } from './prompt.js';

/** Los hosts a los que se acepta seguir una redirección. */
const HOSTS_DE_GOOGLE = new Set([
  'maps.app.goo.gl', 'goo.gl', 'www.google.com', 'google.com', 'maps.google.com',
]);

const MAX_REDIRECCIONES = 3;
const TOPE_MS = 6000;

/**
 * Saca `lat,lng` de una URL de Google Maps, en las formas que usa: `@lat,lng`,
 * `/search/lat,+lng`, `?q=lat,lng`, `!3dLAT!4dLNG`. Devuelve `null` si no hay
 * un par de números válido: un enlace a un nombre de lugar, sin coordenadas,
 * es un caso normal y no un error.
 */
export function coordenadasDeUrl(url: string): { lat: number; lng: number } | null {
  const patrones = [
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /\/search\/(-?\d+\.\d+),\+?(-?\d+\.\d+)/,
    /[?&]q=(-?\d+\.\d+),\+?(-?\d+\.\d+)/,
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/,
  ];
  for (const p of patrones) {
    const m = p.exec(url);
    if (!m) continue;
    const ubicacion = ubicacionDe({ lat: Number(m[1]), lng: Number(m[2]) });
    if (ubicacion) return ubicacion;
  }
  return null;
}

/** Sigue las redirecciones de Google hasta encontrar la URL con coordenadas. */
export async function resolver(url: string): Promise<{ lat: number; lng: number } | null> {
  let actual = url;
  for (let salto = 0; salto <= MAX_REDIRECCIONES; salto++) {
    const yaEstan = coordenadasDeUrl(actual);
    if (yaEstan) return yaEstan;

    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), TOPE_MS);
    let respuesta: Response;
    try {
      respuesta = await fetch(actual, { method: 'GET', redirect: 'manual', signal: control.signal });
    } catch {
      return null;   // el enlace no responde: no es un error del comercio
    } finally {
      clearTimeout(reloj);
    }
    // El cuerpo NO se lee nunca: solo interesa a dónde apunta.
    try { await respuesta.body?.cancel(); } catch { /* ya venía cerrado */ }

    const destino = respuesta.headers.get('location');
    if (!destino) return null;
    let siguiente: URL;
    try { siguiente = new URL(destino, actual); } catch { return null; }
    // UNA REDIRECCIÓN FUERA DE GOOGLE CORTA. Es la barrera que impide que un
    // enlace preparado nos lleve a pedir cualquier cosa desde el servidor.
    if (siguiente.protocol !== 'https:' || !HOSTS_DE_GOOGLE.has(siguiente.hostname)) return null;
    actual = siguiente.toString();
  }
  return coordenadasDeUrl(actual);
}

/**
 * Devuelve las coordenadas de un enlace de Google Maps. No escribe nada: la
 * pantalla las guarda junto al resto de la configuración, por las mismas reglas
 * de siempre. Exige sesión: no es un servicio abierto de resolución de enlaces.
 */
export const ubicacionDeEnlace = onCall({ region: REGION }, async (peticion: CallableRequest) => {
  if (!peticion.auth?.uid) throw new HttpsError('unauthenticated', 'Hay que iniciar sesión.');
  const datos = (peticion.data ?? {}) as Record<string, unknown>;
  const url = typeof datos['url'] === 'string' ? datos['url'].trim() : '';
  if (!enlaceDeMapaValido(url)) {
    return { ubicacion: null, motivo: 'no_es_un_enlace_de_maps' };
  }
  const ubicacion = await resolver(url);
  return ubicacion
    ? { ubicacion, motivo: null }
    : { ubicacion: null, motivo: 'sin_coordenadas' };
});
