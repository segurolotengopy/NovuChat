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
 * LAS FOTOS TIENEN DOS ORÍGENES, LOS MISMOS QUE EN PRODUCCIÓN. El conjunto
 * `resto` las ENLAZA a Pexels: libres de uso, sirven para que la vista previa se
 * vea como se va a ver, y son el caso del comercio que referencia fotos que ya
 * tiene publicadas. El conjunto `walisuma` las tiene SUBIDAS, como las guarda un
 * comercio que las cargó desde la consola: la página recibe `tieneFoto` y pide
 * cada una por su dirección, y acá se sirven de una carpeta local. Con
 * `--sin-fotos` se ve la página de un comercio que todavía no cargó ninguna.
 *
 * USO:
 *   pnpm web:build && node scripts/catalogo-demo.mjs
 *   # abrir la dirección que imprime
 *
 *   node scripts/catalogo-demo.mjs --datos walisuma    # el catálogo de Walisuma
 *   node scripts/catalogo-demo.mjs --paleta bosque     # otra paleta
 *   node scripts/catalogo-demo.mjs --sin-logo          # sin logo cargado
 *   node scripts/catalogo-demo.mjs --sin-fotos         # como un comercio que no cargó ninguna
 *   PUERTO_DEMO=5250 node scripts/catalogo-demo.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, normalize, resolve } from 'node:path';

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
// LOS DATOS DEL DEMO B SALEN DEL ARCHIVO VERSIONADO, NO DE UNA COPIA.
//
// HASTA EL 22/09/2026 ACÁ HABÍA UNA COPIA A MANO de los seis ítems que
// `scripts/sembrar-demos.mjs` siembra en `demo-venta`, con un comentario que
// admitía que iba a quedar vieja. Y quedó vieja el día que el catálogo del
// comercio pasó a diecisiete: la vista previa mostraba seis tarjetas mientras
// la página de producción mostraba diecisiete. Una vista previa que enseña otra
// cosa que el producto no es un respaldo, es una trampa en una reunión.
//
// Ahora lee `scripts/datos/negocio-demo-venta-*.json`, que son los MISMOS
// archivos que `cargar-negocio.mjs` escribe en Firestore. Una sola fuente: si el
// catálogo cambia, cambia en los dos lados o en ninguno. Es la lección que este
// proyecto ya había pagado con `build_flows.py` (`Flujos/LEEME-flujos.md`
// §0.a): una segunda fuente de verdad solo puede divergir.
//
// Se lee el archivo y no `sembrar-demos.mjs` porque ese script se ejecuta al
// cargarse —intentaría hablar con Firestore— y esto tiene que correr sin
// credenciales ni red.
// -----------------------------------------------------------------------------
//
// HAY DOS ARCHIVOS, Y LA VISTA PREVIA TIENE QUE PODER MOSTRAR LOS DOS. El Demo
// B se viste de «Resto & Tienda» para un prospecto sin rubro y de Walisuma —el
// catálogo real de una marca de artesanía de alta gama— para la reunión con esa
// marca. Son excluyentes en Firestore, pero acá no: se elige con `--datos` y se
// pueden mostrar los dos en la misma reunión sin tocar la nube.
// ---------------------------------------------------------------------------
const CONJUNTOS = {
  resto: { archivo: 'negocio-demo-venta-resto.json', logo: join(RAIZ, '..', 'Demo-Recursos', 'logo-demo-b.webp'), fotos: '' },
  // LOS DIEZ QUE ESTÁN EN PRODUCCIÓN (decisión de Andres, 22/09/2026). Es lo
  // que se le muestra a Walisuma: uno o dos por área, las siete cubiertas, de 7
  // a 590 dólares. Diez está por debajo del umbral de 40, así que el asistente
  // recita precios Y manda el enlace; con `walisuma` (los 154) pasa lo
  // contrario, y por eso conviene tener los dos a mano en la misma reunión.
  'walisuma-10': {
    archivo: 'negocio-demo-venta-walisuma-10.json',
    logo: join(RAIZ, '..', 'CLIENTES', 'WALISUMA', 'logo-walisuma.webp'),
    fotos: join(RAIZ, '..', 'CLIENTES', 'WALISUMA', 'fotos-10'),
  },
  walisuma: {
    archivo: 'negocio-demo-venta-walisuma.json',
    // Fuera del control de versiones a propósito: son fotos de producto de un
    // tercero (ver `_fotos` del JSON). Si no están, la página se ve sin ellas.
    logo: join(RAIZ, '..', 'CLIENTES', 'WALISUMA', 'logo-walisuma.webp'),
    fotos: join(RAIZ, '..', 'CLIENTES', 'WALISUMA', 'fotos'),
  },
};
const CONJUNTO = leer('--datos', 'resto');
if (!CONJUNTOS[CONJUNTO]) {
  console.error(`--datos ${CONJUNTO}: no existe. Son ${Object.keys(CONJUNTOS).join(' o ')}.`);
  process.exit(1);
}
const ARCHIVO_DATOS = join(RAIZ, 'scripts', 'datos', CONJUNTOS[CONJUNTO].archivo);

if (!existsSync(ARCHIVO_DATOS)) {
  console.error(`No existe ${ARCHIVO_DATOS}: la vista previa sale de ese archivo.`);
  process.exit(1);
}

/**
 * Los ítems que la página mostraría, con el MISMO criterio que
 * `catalogoPublico`: solo los activos y con precio. Un ítem sin precio no se
 * publica —no se puede cobrar lo que no tiene precio— y uno dado de baja
 * tampoco. Filtrarlo acá es lo que hace que la vista previa se parezca a la
 * página de verdad y no a la pantalla de edición.
 */
const datos = JSON.parse(readFileSync(ARCHIVO_DATOS, 'utf8'));
const CATALOGO_DEMO_B = (Array.isArray(datos.catalogo) ? datos.catalogo : [])
  .filter((i) => i.activo !== false && Number.isFinite(i.precio));

/** Mismo identificador que deriva la consola a partir del nombre. */
const idDe = (nombre) => nombre.trim().toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '').slice(0, 60);

/**
 * LAS FOTOS SUBIDAS, como las entrega producción: la página NO las recibe en el
 * JSON, recibe un `tieneFoto` y pide cada una por `…/foto/<id>`. Acá se sirven
 * desde una carpeta local. Si la carpeta no está —o con `--sin-fotos`— la página
 * se ve como la de un comercio que todavía no cargó ninguna, que también es algo
 * que conviene poder mostrar.
 */
const DIR_FOTOS = leer('--fotos', CONJUNTOS[CONJUNTO].fotos);
const FOTOS = new Map();
if (!args.includes('--sin-fotos') && DIR_FOTOS && existsSync(DIR_FOTOS)) {
  const TIPOS_FOTO = { '.webp': 'image/webp', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png' };
  for (const f of readdirSync(DIR_FOTOS)) {
    const tipo = TIPOS_FOTO[extname(f).toLowerCase()];
    if (tipo) FOTOS.set(basename(f, extname(f)), { tipo, ruta: join(DIR_FOTOS, f) });
  }
}

const RESPUESTA = {
  negocio: {
    nombre: datos.negocio?.nombreNegocio ?? 'Resto & Tienda Demo NovuChat',
    descripcion: datos.negocio?.descripcion ?? 'Gastronomía y retail. Toma pedidos y cobra por WhatsApp.',
    // El Demo B NO tiene dirección cargada, a propósito: está en
    // `datosQueNoTenemos`. Se respeta acá para que la vista previa no prometa
    // un dato que el asistente dice no tener.
    direccion: '',
    moneda: datos.negocio?.moneda === 'USD' ? 'USD' : 'BOB',
    // El logo va INCRUSTADO, igual que en producción: la consola lo recorta a
    // 320 px y lo guarda en `/config/marca`, y la página lo recibe en la misma
    // respuesta que el catálogo. Acá se lee del archivo para no depender de la
    // nube. Con `--sin-logo` se ve la página de un comercio que no subió
    // ninguno.
    logo: args.includes('--sin-logo') ? '' : logoIncrustado(),
    // La del archivo, que es la que se carga en Firestore. `--paleta` la pisa
    // para probar cómo se ve el mismo catálogo con otra.
    paleta: leer('--paleta', datos.negocio?.paleta ?? 'terracota'),
  },
  // De `/config/venta` del mismo comercio sembrado.
  entrega: {
    costoDelivery: 7, pedidoMinimo: 0,
    aceptaDelivery: true, aceptaRetiroEnLocal: true,
  },
  items: CATALOGO_DEMO_B.map((i) => ({
    id: idDe(i.nombre), nombre: i.nombre, descripcion: i.descripcion,
    area: i.area, precio: i.precio, moneda: i.moneda === 'USD' ? 'USD' : 'BOB',
    imagenUrl: args.includes('--sin-fotos') ? '' : (i.imagenUrl ?? ''),
    // La foto SUBIDA gana sobre el enlace, igual que en `SitioCatalogo.tsx`.
    tieneFoto: FOTOS.has(idDe(i.nombre)),
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

/**
 * El logo del Demo B, como lo entrega la consola: `data:image/webp;base64,…`.
 *
 * Se lee del archivo y no se genera acá porque Node no tiene canvas — el
 * recorte de verdad lo hace el navegador en `Configuracion.tsx`. Este archivo
 * salió exactamente de ese camino: un canvas de 320 px exportado a WebP.
 */
function logoIncrustado() {
  const ruta = CONJUNTOS[CONJUNTO].logo;
  if (!existsSync(ruta)) return '';
  return `data:image/webp;base64,${readFileSync(ruta).toString('base64')}`;
}

createServer(async (peticion, respuesta) => {
  const ruta = new URL(peticion.url ?? '/', 'http://x').pathname;

  if (ruta.startsWith('/api/catalogo/')) {
    // `…/foto/<itemId>`: los mismos bytes y las mismas cabeceras que devuelve
    // `fotoDeCatalogo` en producción, para que la página no note la diferencia.
    const foto = /\/foto\/([^/]+)$/.exec(ruta);
    if (foto) {
      const f = FOTOS.get(decodeURIComponent(foto[1]));
      if (!f) { respuesta.writeHead(404).end('sin foto'); return; }
      respuesta.writeHead(200, {
        'Content-Type': f.tipo, 'Cache-Control': 'private, max-age=900',
        'X-Content-Type-Options': 'nosniff',
      });
      respuesta.end(await readFile(f.ruta));
      return;
    }
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
  console.log(`\n  Vista previa del catálogo web · Demo B · datos «${CONJUNTO}»\n`);
  console.log(`    http://127.0.0.1:${PUERTO}/c/${FICHA}\n`);
  console.log(`  ${RESPUESTA.items.length} productos en ${new Set(RESPUESTA.items.map((i) => i.area)).size} áreas`
    + ` · ${RESPUESTA.items.filter((i) => i.tieneFoto || i.imagenUrl).length} con foto`
    + ` · envío ${RESPUESTA.entrega.costoDelivery} Bs · paleta ${RESPUESTA.negocio.paleta}`
    + ` · logo ${RESPUESTA.negocio.logo ? 'sí' : 'no'}`);
  console.log('  Paletas: terracota · bosque · indigo · vino · oceano   (--paleta <nombre>)');
  console.log(`  Conjuntos: ${Object.keys(CONJUNTOS).join(' · ')}   (--datos <nombre>)`);
  console.log(`  Datos: scripts/datos/${CONJUNTOS[CONJUNTO].archivo}, el mismo archivo que se`);
  console.log('  carga en Firestore. Lo que se ve acá es lo que va a ver el cliente.');
  console.log('  El backend es simulado: no se guarda ningún pedido.\n');
});
