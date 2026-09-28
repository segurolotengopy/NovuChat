/**
 * Pedir una URL que escribió un comercio sin que el servidor sirva de puente
 * hacia adentro (SSRF): solo `https`, destino público resuelto por DNS, saltos
 * seguidos a mano y con tiempo máximo. Lo usan la comprobación de la foto del
 * catálogo (Productos) y la de Captación. Salió de `imagenCatalogo.ts` en el
 * corte C2 de F2 sin cambiar una línea.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const TIEMPO_MAXIMO_MS = 8_000;
const SALTOS_MAXIMOS = 2;

export type MotivoFalla =
  | 'no_es_https' | 'destino_privado' | 'no_responde' | 'no_es_imagen'
  | 'demasiado_grande' | 'demasiados_saltos';

// ---------------------------------------------------------------------------
// 1. QUE LA DIRECCIÓN SEA SEGURA DE VISITAR
// ---------------------------------------------------------------------------

/**
 * Rangos que NO se visitan.
 *
 * La dirección la escribe el comercio y la visita NUESTRO servidor, que corre
 * dentro de la red de Google con acceso al servidor de metadatos. Sin este
 * filtro, un comercio podría pedirnos que buscáramos `http://169.254.169.254/…`
 * y usarnos de puente hacia adentro. Es el ataque que se llama SSRF y no es
 * teórico: el servidor de metadatos de la nube es su blanco clásico.
 *
 * Se comprueba sobre la IP RESUELTA y no sobre el texto del host, porque
 * `midominio.com` puede apuntar a `127.0.0.1` y el texto no lo delata.
 */
export function esDestinoPublico(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const o = ip.split('.').map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = o as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return false;              // este host, privada, bucle
    if (a === 169 && b === 254) return false;                        // enlace local y metadatos
    if (a === 172 && b >= 16 && b <= 31) return false;               // privada
    if (a === 192 && b === 168) return false;                        // privada
    if (a === 100 && b >= 64 && b <= 127) return false;              // CGNAT
    if (a === 192 && b === 0) return false;                          // reservada / documentación
    if (a >= 224) return false;                                      // multidifusión y reservada
    return true;
  }
  if (v === 6) {
    const d = ip.toLowerCase().split('%')[0] as string;
    if (d === '::' || d === '::1') return false;                     // sin especificar, bucle
    if (d.startsWith('fe8') || d.startsWith('fe9')
      || d.startsWith('fea') || d.startsWith('feb')) return false;   // enlace local
    if (d.startsWith('fc') || d.startsWith('fd')) return false;      // única local
    if (d.startsWith('ff')) return false;                            // multidifusión
    // IPv4 DISFRAZADAS DE IPv6: se juzgan por la IPv4 que llevan adentro. La
    // forma con puntos (`::ffff:127.0.0.1`) no alcanza: `new URL()` normaliza el
    // host a hexadecimal (`::ffff:7f00:1`), y esa forma pasaba el filtro y
    // llegaba al propio servidor (revisión de seguridad del 15/09/2026).
    const conPuntos = /^::(ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(d);
    if (conPuntos) return esDestinoPublico(conPuntos[2] as string);
    const h = expandirIPv6(d);
    if (!h) return false;                                            // lo que no se entiende no se visita
    const v4 = (a: number, b: number) =>
      `${h[a]! >> 8}.${h[a]! & 255}.${h[b]! >> 8}.${h[b]! & 255}`;
    if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
      return esDestinoPublico(v4(6, 7));                             // ::ffff:0:0/96 y ::/96
    }
    if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) {
      return esDestinoPublico(v4(6, 7));                             // NAT64, 64:ff9b::/96
    }
    if (h[0] === 0x2002) return esDestinoPublico(v4(1, 2));          // 6to4, 2002::/16
    return true;
  }
  return false;
}

/** Los ocho grupos de 16 bits de una IPv6 en texto, o `null` si no se entiende. */
function expandirIPv6(d: string): number[] | null {
  if (!/^[0-9a-f:]+$/.test(d) || (d.match(/::/g) ?? []).length > 1) return null;
  const [izq, der] = d.includes('::') ? d.split('::') as [string, string] : [d, null];
  const partes = (t: string) => (t === '' ? [] : t.split(':'));
  const a = partes(izq);
  const b = der === null ? [] : partes(der);
  const faltan = 8 - a.length - b.length;
  if (der === null ? faltan !== 0 : faltan < 1) return null;
  const grupos = [...a, ...Array(der === null ? 0 : faltan).fill('0'), ...b];
  if (grupos.some((g) => g.length === 0 || g.length > 4)) return null;
  return grupos.map((g) => parseInt(g, 16));
}

/** `https://` y nada más: `http` lo bloquea el navegador del cliente por contenido mixto. */
export function urlUtilizable(url: string): { ok: true; u: URL } | { ok: false; falla: MotivoFalla } {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, falla: 'no_es_https' }; }
  if (u.protocol !== 'https:') return { ok: false, falla: 'no_es_https' };
  return { ok: true, u };
}

async function destinoPermitido(u: URL): Promise<boolean> {
  const host = u.hostname.replace(/^\[|\]$/g, '');
  // Un comercio publica sus archivos con un NOMBRE de dominio. Una IP literal en
  // la URL no tiene uso legítimo acá y es la vía más corta a una dirección
  // interna: se rechaza sin juzgarla. Las IP que devuelve el DNS sí se juzgan.
  if (isIP(host)) return false;
  try {
    const direcciones = await lookup(host, { all: true });
    // TODAS tienen que ser públicas: alcanza una privada para descartar el host.
    return direcciones.length > 0 && direcciones.every((d) => esDestinoPublico(d.address));
  } catch {
    return false;
  }
}

/**
 * Baja la imagen con todos los frenos puestos.
 *
 * NO se delegan los saltos a `fetch`: con `redirect: 'follow'` el primer destino
 * puede ser público y el segundo `127.0.0.1`, y nadie lo miraría. Se siguen a
 * mano, comprobando cada uno.
 *
 * LO QUE ESTO NO CIERRA, dicho para que nadie lo dé por cerrado: entre que se
 * resuelve el nombre y que se abre la conexión, el DNS puede cambiar de
 * respuesta («DNS rebinding»). Cerrarlo exige conectarse a la IP y mandar el
 * `Host` a mano, que con `fetch` no se puede. El riesgo residual es una lectura
 * a ciegas: el contenido NUNCA se le devuelve a quien pidió la comprobación,
 * solo un veredicto de dos campos.
 */
export async function pedirConFrenos(url: string, accept: string): Promise<
  { ok: true; r: Response } | { ok: false; falla: MotivoFalla }> {
  let actual = url;
  for (let salto = 0; salto <= SALTOS_MAXIMOS; salto++) {
    const v = urlUtilizable(actual);
    if (!v.ok) return { ok: false, falla: v.falla };
    if (!await destinoPermitido(v.u)) return { ok: false, falla: 'destino_privado' };

    const corte = AbortSignal.timeout(TIEMPO_MAXIMO_MS);
    let r: Response;
    try {
      r = await fetch(v.u, { redirect: 'manual', signal: corte, headers: { accept } });
    } catch {
      return { ok: false, falla: 'no_responde' };
    }

    if (r.status >= 300 && r.status < 400) {
      const destino = r.headers.get('location');
      if (!destino) return { ok: false, falla: 'no_responde' };
      actual = new URL(destino, v.u).toString();
      continue;
    }
    if (!r.ok) return { ok: false, falla: 'no_responde' };
    return { ok: true, r };
  }
  return { ok: false, falla: 'demasiados_saltos' };
}

/** Tipo de contenido sin parámetros (`image/png; charset=…` → `image/png`). */
export function tipoDeContenido(r: Response): string {
  return (r.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

