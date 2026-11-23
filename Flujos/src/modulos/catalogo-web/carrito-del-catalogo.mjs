/**
 * CARRITO DEL CATÁLOGO WEB — lo que un `construir.mjs` necesita para que su flujo reciba el carrito de la página del catálogo (módulo catalogo-web, común).
 *
 *   - `cargaConCarrito(js)`: antepone `carga-del-carrito.js` al código de «Carga de entrada» e INCLUYE `validar-carrito.js` (envuelto en la función `ccValidarCarrito`, sin una sola edición) en el lugar de su marca.
 *   - `injertarCarrito(plantilla, opciones)`: agrega el nodo Webhook «Carrito del catálogo» y su conexión. SOLO en la variante de producción; la de prueba no lo lleva.
 *   - `hallazgosDelCarrito(flujo, opciones)`: la guardia de la forma exacta del nodo (la de Q'Taco, común).
 *
 * La ruta del webhook es una URL de capacidad: en el JSON versionado va SOLO el marcador `REEMPLAZAR_RUTA_CARRITO_<TENANT>`; la reemplaza `preparar-import.sh`. La credencial va por NOMBRE (la de la ingesta del comercio).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const WEBHOOK_DEL_CARRITO = 'Carrito del catálogo';
export const MARCA_DE_LA_VALIDACION = '/* @@validar-carrito@@ */';
export const marcadorDeRuta = (tenant) => `REEMPLAZAR_RUTA_CARRITO_${String(tenant).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;

/** El código de la carga con la rama del carrito antepuesta y la validación incluida. Lanza si falta la marca o si queda alguna. */
export function cargaConCarrito(codigoComun) {
  const rama = readFileSync(join(AQUI, 'carga-del-carrito.js'), 'utf8');
  const validar = readFileSync(join(AQUI, 'validar-carrito.js'), 'utf8');
  if (rama.split(MARCA_DE_LA_VALIDACION).length !== 2) throw new Error('carga-del-carrito.js: la marca de la validación tiene que aparecer exactamente una vez');
  // Solo se SANGRA (dos espacios por línea; el contenido no cambia): un `return` en la columna 0 del prefijo haría que la regla M4 (`incluyeVariante`) tomara el código común por código muerto.
  const sangrada = validar.trimEnd().split('\n').map((l) => (l === '' ? l : '  ' + l)).join('\n');
  const incluida = `function ccValidarCarrito($input) {\n${sangrada}\n}`;
  return rama.replace(MARCA_DE_LA_VALIDACION, () => incluida).trimEnd() + '\n\n' + codigoComun;
}

/** El nodo Webhook del carrito: POST, cabecera de la ingesta, responde al recibir y la ruta como marcador. */
export function nodoWebhookDelCarrito({ tenant, credencialIngesta, posicion = [-1560, 560] }) {
  return {
    id: 'carrito-catalogo',
    name: WEBHOOK_DEL_CARRITO,
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: posicion,
    parameters: { httpMethod: 'POST', path: marcadorDeRuta(tenant), authentication: 'headerAuth', responseMode: 'onReceived', options: {} },
    credentials: { httpHeaderAuth: { id: '', name: credencialIngesta } },
    notes: 'SOLO en la variante del receptor (la de prueba no lo lleva). Recibe el carrito que el cliente confirmó en la página del catálogo web. Autentica el propio nodo con la credencial de cabecera de la ingesta (n8n contesta 403 sin ella); cuelga de «Config base» (que corre antes que «Carga de entrada»), y «Carga de entrada» valida el carrito SOLO si este nodo corrió. La ruta es una URL de capacidad: va como marcador en `path` y la reemplaza preparar-import.sh (el nombre del marcador NO se repite en este texto). Es la única entrada de producción además de la del receptor.',
  };
}

/** Agrega el nodo y su conexión a `destino` (por omisión «Config base»: la carga común lee su `phoneNumberIdEsperado`). Solo en producción. */
export function injertarCarrito(plantilla, { tenant, credencialIngesta, destino = 'Config base', prueba = false }) {
  if (prueba) return plantilla;
  if (!plantilla.nodes.some((n) => n.name === destino)) throw new Error(`injertarCarrito: no existe el nodo «${destino}»`);
  plantilla.nodes.push(nodoWebhookDelCarrito({ tenant, credencialIngesta }));
  plantilla.connections[WEBHOOK_DEL_CARRITO] = { main: [[{ node: destino, type: 'main', index: 0 }]] };
  return plantilla;
}

/** Los hallazgos de la forma del nodo en un flujo armado. `variante`: 'produccion' | 'prueba'. */
export function hallazgosDelCarrito(flujo, { tenant, credencialIngesta, variante, destino = 'Config base' }) {
  const h = [];
  const n = flujo.nodes.find((x) => x.name === WEBHOOK_DEL_CARRITO);
  if (variante === 'prueba') { if (n) h.push(`la variante de prueba no lleva el webhook «${WEBHOOK_DEL_CARRITO}»`); return h; }
  if (!n) { h.push(`falta el webhook «${WEBHOOK_DEL_CARRITO}»`); return h; }
  const p = n.parameters || {};
  const marca = marcadorDeRuta(tenant);
  if (n.type !== 'n8n-nodes-base.webhook') h.push(`«${n.name}» no es un nodo Webhook`);
  if (p.httpMethod !== 'POST') h.push(`«${n.name}» debe recibir POST`);
  if (p.authentication !== 'headerAuth') h.push(`«${n.name}» debe autenticar con headerAuth (sin eso cualquiera puede mandar un carrito)`);
  if (p.responseMode !== 'onReceived') h.push(`«${n.name}» debe responder al recibir (responseMode onReceived)`);
  if (p.path !== marca) h.push(`«${n.name}» debe llevar la ruta como marcador ${marca} (una URL de capacidad no se versiona)`);
  const cred = ((n.credentials || {}).httpHeaderAuth || {}).name;
  if (!cred || (credencialIngesta !== undefined && cred !== credencialIngesta)) h.push(`«${n.name}» debe usar la credencial de cabecera de la ingesta (${credencialIngesta}), no «${cred || 'ninguna'}»`);
  if (typeof n.webhookId === 'string') h.push(`«${n.name}» no puede traer un webhookId (compartiría la ruta de Meta)`);
  if (JSON.stringify(flujo).split(marca).length - 1 !== 1) h.push(`el marcador ${marca} debe aparecer una sola vez (en el path del webhook), no repetido en notas ni en código`);
  const sal = ((flujo.connections[WEBHOOK_DEL_CARRITO] || {}).main || []).flat().map((c) => c.node);
  if (sal.length !== 1 || sal[0] !== destino) h.push(`«${WEBHOOK_DEL_CARRITO}» debe conectar solo con «${destino}» (conecta con: ${sal.join(', ') || 'nada'})`);
  return h;
}
