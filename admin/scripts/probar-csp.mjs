#!/usr/bin/env node
/**
 * =============================================================================
 * SERVIDOR DE PRUEBA DE LAS CABECERAS DE HOSTING
 * =============================================================================
 *
 * EL PROBLEMA. La política de seguridad de contenido vive en `firebase.json` y
 * la aplica **Firebase Hosting**. Ni el servidor de desarrollo de Vite ni
 * `vite preview` la ponen. O sea que un error de CSP —el iframe de Auth
 * bloqueado, App Check que no carga— **no se puede ver localmente y aparece
 * recién en producción**, con el síntoma más ingrato posible: se hace clic en
 * «Ingresar con Google» y no pasa nada, sin error en ninguna parte.
 *
 * Ya pasó: la política original tenía `default-src 'none'` sin `frame-src`, y el
 * inicio de sesión quedaba muerto.
 *
 * QUÉ HACE ESTE SCRIPT. Sirve `web/dist` aplicando **las cabeceras leídas de
 * `firebase.json`**, no una copia. Si alguien cambia la política y rompe algo,
 * este servidor lo reproduce. Leer del archivo real es lo que evita que la
 * prueba y la producción se separen.
 *
 * Uso:
 *   pnpm web:build && node scripts/probar-csp.mjs
 *   # abrir http://127.0.0.1:5240 y mirar la consola del navegador:
 *   # cualquier «Refused to ...» es una violación de la política.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const DIST = join(RAIZ, 'web', 'dist');
const PUERTO = Number(process.env.PUERTO_CSP ?? 5240);

if (!existsSync(DIST)) {
  console.error(`No existe ${DIST}. Corra antes:  pnpm web:build`);
  process.exit(1);
}

// Las cabeceras salen del archivo REAL, no de una copia.
const config = JSON.parse(readFileSync(join(RAIZ, 'firebase.json'), 'utf8'));
const bloqueGeneral = config.hosting.headers.find((h) => h.source === '**');
const CABECERAS = Object.fromEntries(
  bloqueGeneral.headers
    // HSTS molesta en localhost —el navegador recuerda el origen como HTTPS— y
    // no tiene nada que ver con lo que se quiere probar acá.
    .filter((h) => h.key !== 'Strict-Transport-Security')
    .map((h) => [h.key, h.value]),
);

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

createServer(async (peticion, respuesta) => {
  const ruta = new URL(peticion.url ?? '/', 'http://x').pathname;
  // `normalize` + comprobación de prefijo: sin esto, `/../../etc/passwd`
  // saldría del directorio servido. Es un script de prueba, pero un script de
  // prueba que escucha en un puerto igual se puede usar contra uno.
  const candidato = normalize(join(DIST, ruta));
  const destino = candidato.startsWith(DIST) && existsSync(candidato)
    && extname(candidato) !== ''
    ? candidato
    : join(DIST, 'index.html');   // SPA: todo lo demás cae al index

  try {
    const cuerpo = await readFile(destino);
    respuesta.writeHead(200, {
      ...CABECERAS,
      'Content-Type': TIPOS[extname(destino)] ?? 'application/octet-stream',
    });
    respuesta.end(cuerpo);
  } catch {
    respuesta.writeHead(404, CABECERAS).end('no encontrado');
  }
}).listen(PUERTO, '127.0.0.1', () => {
  console.log(`\nSirviendo web/dist con las cabeceras de firebase.json`);
  console.log(`  http://127.0.0.1:${PUERTO}\n`);
  console.log('Cabeceras aplicadas:');
  for (const [k, v] of Object.entries(CABECERAS)) {
    console.log(`  ${k}: ${v.length > 90 ? v.slice(0, 90) + '…' : v}`);
  }
  console.log('\nEn la consola del navegador, cualquier «Refused to» es una violación.');
});
