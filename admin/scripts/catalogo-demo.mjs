#!/usr/bin/env node
/**
 * =============================================================================
 * VISTA PREVIA LOCAL DEL CATÁLOGO WEB — para mostrárselo a un cliente
 * =============================================================================
 *
 * QUÉ RESUELVE. El catálogo web necesita Cloud Functions y una ficha emitida
 * desde una conversación de WhatsApp. Nada de eso existe hasta que haya un
 * proyecto de nube creado, así que **la página no se podía mostrar a nadie**.
 * Este script sirve `web/dist` —la misma compilación que iría a producción— y
 * responde el API del catálogo con los datos del Demo B.
 *
 * QUÉ ES REAL Y QUÉ NO, dicho antes de que alguien lo muestre en una reunión:
 *
 *   REAL   la página entera: el HTML, el CSS, el JavaScript, el carrito, el
 *          filtro por área, el detalle, el formulario de entrega, y las
 *          cabeceras de seguridad leídas de `firebase.json`.
 *   REAL   el checkout: manda al servidor SOLO identificadores y cantidades.
 *          Se imprime en la consola para que se pueda verificar en vivo.
 *   FALSO  el backend. No hay ficha, no hay caducidad, no se guarda ningún
 *          pedido y no se despierta ningún flujo de n8n.
 *
 * O sea: sirve para ver y para vender, no para probar el back.
 *
 * USO:
 *   pnpm web:build && node scripts/catalogo-demo.mjs
 *   # abrir la dirección que imprime
 *
 *   node scripts/catalogo-demo.mjs --color '#1b7f4f'   # otra marca
 *   PUERTO_DEMO=5250 node scripts/catalogo-demo.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const DIST = join(RAIZ, 'web', 'dist');
const PUERTO = Number(process.env['PUERTO_DEMO'] ?? 5241);

const args = process.argv.slice(2);
const leer = (bandera, porDefecto) => {
  const i = args.indexOf(bandera);
  return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto;
};

if (!existsSync(DIST)) {
  console.error(`No existe ${DIST}. Corra antes:  pnpm web:build`);
  process.exit(1);
}

// -----------------------------------------------------------------------------
// LOS DATOS DEL DEMO B.
//
// Son una COPIA de `scripts/sembrar-demos.mjs`, comercio `demo-venta`. No se
// importan de allá porque ese script se ejecuta al cargarse —intentaría hablar
// con Firestore— y esto tiene que correr sin credenciales ni red.
//
// Si el catálogo del Demo B cambia, esta copia queda vieja. Es una vista previa,
// no una fuente: el daño de que se desfase es que la demostración muestre un
// precio de la semana pasada, y por eso el script lo dice al arrancar.
// -----------------------------------------------------------------------------
const CATALOGO_DEMO_B = [
  { nombre: 'Hamburguesa doble', area: 'gastronomia', precio: 35,
    descripcion: 'Doble carne, queso cheddar y papas' },
  { nombre: 'Hamburguesa clásica', area: 'gastronomia', precio: 28,
    descripcion: 'Carne, lechuga, tomate y papas' },
  { nombre: 'Salchipapa', area: 'gastronomia', precio: 20,
    descripcion: 'Porción personal' },
  { nombre: 'Gaseosa (normal o zero)', area: 'gastronomia', precio: 8,
    descripcion: '500 ml' },
  { nombre: 'Chaqueta negra (S, M, L)', area: 'retail', precio: 180,
    descripcion: 'Indicá la talla al pedir' },
  { nombre: 'Audífonos inalámbricos', area: 'retail', precio: 95,
    descripcion: 'Bluetooth, con estuche de carga' },
];

/** Mismo identificador que deriva la consola a partir del nombre. */
const idDe = (nombre) => nombre.trim().toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '').slice(0, 60);

const RESPUESTA = {
  negocio: {
    nombre: 'Resto & Tienda Demo NovuChat',
    descripcion: 'Gastronomía y retail. Toma pedidos y cobra por WhatsApp.',
    // El Demo B NO tiene dirección cargada, a propósito: está en
    // `datosQueNoTenemos`. Se respeta acá para que la vista previa no prometa
    // un dato que el asistente dice no tener.
    direccion: '',
    moneda: 'BOB',
    logoUrl: '',
    colorMarca: leer('--color', '#c2410c'),
  },
  // De `/config/venta` del mismo comercio sembrado.
  entrega: {
    costoDelivery: 7, pedidoMinimo: 0,
    aceptaDelivery: true, aceptaRetiroEnLocal: true,
  },
  items: CATALOGO_DEMO_B.map((i) => ({
    id: idDe(i.nombre), nombre: i.nombre, descripcion: i.descripcion,
    area: i.area, precio: i.precio, moneda: 'BOB', imagenUrl: '',
  })),
  caducaEn: new Date(Date.now() + 72 * 3_600_000).toISOString(),
};

// --- Cabeceras reales, por ruta, leídas de firebase.json ---------------------
const config = JSON.parse(readFileSync(join(RAIZ, 'firebase.json'), 'utf8'));
const aExpresion = (patron) => new RegExp('^' + patron
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*/g, 'CUALQUIER_RUTA').replace(/\*/g, '[^/]*')
  .replace(/CUALQUIER_RUTA/g, '.*') + '$');
const GLOBOS = config.hosting.headers.map((h) => ({
  prueba: aExpresion(h.source),
  cabeceras: Object.fromEntries(h.headers
    .filter((c) => c.key !== 'Strict-Transport-Security')
    .map((c) => [c.key, c.value])),
}));
const cabecerasDe = (ruta) => GLOBOS.reduce(
  (acc, g) => (g.prueba.test(ruta) ? { ...acc, ...g.cabeceras } : acc), {});

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

const FICHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

createServer(async (peticion, respuesta) => {
  const ruta = new URL(peticion.url ?? '/', 'http://x').pathname;

  if (ruta.startsWith('/api/catalogo/')) {
    if (ruta.endsWith('/checkout')) {
      let cuerpo = '';
      for await (const trozo of peticion) cuerpo += trozo;
      // SE IMPRIME A PROPÓSITO. Es la demostración de que el navegador manda
      // identificadores y cantidades, y ni un solo precio: se puede mostrar en
      // vivo, al lado de la pantalla del cliente.
      console.log('\n  ⟶ CHECKOUT, tal como sale del navegador:');
      console.log(`    ${cuerpo}\n`);
      respuesta.writeHead(200, { 'Content-Type': 'application/json' });
      respuesta.end(JSON.stringify({
        ok: true, pedidoId: 'cat_vista_previa', total: 0, moneda: 'BOB',
        descartados: [], siguiente: 'respuesta',
      }));
      return;
    }
    respuesta.writeHead(200,
      { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    respuesta.end(JSON.stringify(RESPUESTA));
    return;
  }

  const candidato = normalize(join(DIST, ruta));
  const destino = candidato.startsWith(DIST) && existsSync(candidato)
    && extname(candidato) !== ''
    ? candidato
    : join(DIST, 'index.html');
  try {
    const cuerpo = await readFile(destino);
    respuesta.writeHead(200, {
      ...cabecerasDe(ruta),
      'Content-Type': TIPOS[extname(destino)] ?? 'application/octet-stream',
    });
    respuesta.end(cuerpo);
  } catch {
    respuesta.writeHead(404, cabecerasDe(ruta)).end('no encontrado');
  }
}).listen(PUERTO, '127.0.0.1', () => {
  console.log('\n  Vista previa del catálogo web · datos del Demo B\n');
  console.log(`    http://127.0.0.1:${PUERTO}/c/${FICHA}\n`);
  console.log(`  ${RESPUESTA.items.length} productos en ${new Set(RESPUESTA.items.map((i) => i.area)).size} áreas`
    + ` · envío ${RESPUESTA.entrega.costoDelivery} Bs · marca ${RESPUESTA.negocio.colorMarca}`);
  console.log('  Los datos son una COPIA de sembrar-demos.mjs: si el catálogo del');
  console.log('  Demo B cambió, esta vista previa muestra lo de antes.');
  console.log('  El backend es simulado: no se guarda ningún pedido.\n');
});
