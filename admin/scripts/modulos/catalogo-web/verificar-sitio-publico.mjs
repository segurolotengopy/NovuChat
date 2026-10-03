#!/usr/bin/env node
/**
 * =============================================================================
 * VERIFICA EL PAQUETE DEL SITIO PÚBLICO DEL CATÁLOGO (web/dist-catalogo)
 * =============================================================================
 *
 * QUÉ PRUEBA, Y POR QUÉ SOBRE EL PAQUETE Y NO SOLO SOBRE EL CÓDIGO.
 * T-37 (admin/SEGURIDAD.md) separa la página pública de la consola porque el
 * origen de la consola guarda las sesiones de administrador. La separación solo
 * vale si el paquete que se publica en el segundo sitio NO trae el código de
 * esa sesión. `pruebas/modulos/catalogo-web/sitio-publico.test.ts` lo comprueba
 * leyendo los `import` del código fuente; este script lo comprueba sobre lo que
 * Vite realmente emitió, que es lo que se sube. Los dos juntos cubren el caso
 * de una dependencia que arrastra el SDK sin que ningún `import` nuestro lo diga.
 *
 * Se corre en el job `construir` (el paquete sale de ahí, y es el mismo que se
 * despliega) y a mano:
 *
 *   pnpm web:build && node scripts/modulos/catalogo-web/verificar-sitio-publico.mjs
 *
 * Sin dependencias y sin red. Salida: 0 todo en orden · 1 alguna falla.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const RAIZ = resolve(new URL('../../..', import.meta.url).pathname);
const DIST = join(RAIZ, 'web', 'dist-catalogo');

/** Direcciones que solo aparecen en el SDK de Firebase (sesión, base, App Check). */
const PROHIBIDAS = [
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firestore.googleapis.com',
  'firebaseappcheck.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebaseapp.com/__/auth',
  '__/auth/handler',
  'signInWithPopup',
  'signInWithEmailAndPassword',
];

const fallas = [];
const falla = (m) => fallas.push(m);

if (!existsSync(DIST)) {
  console.error(`No existe ${DIST}. Corra antes:  pnpm web:build`);
  process.exit(1);
}

function archivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n);
    return statSync(r).isDirectory() ? archivos(r) : [r];
  });
}
const todos = archivos(DIST);
const rel = (a) => relative(DIST, a);

// 1. La página existe y la consola NO está.
if (!existsSync(join(DIST, 'catalogo.html'))) falla('falta catalogo.html: es la página que reescribe `/c/**`');
if (existsSync(join(DIST, 'index.html'))) falla('hay un index.html: es la entrada de la consola, no debe estar en el sitio público');

// 2. Ni una línea del SDK de Firebase en lo que se sube.
const texto = todos.filter((a) => ['.js', '.html', '.css', '.mjs'].includes(extname(a)));
for (const a of texto) {
  const c = readFileSync(a, 'utf8');
  for (const p of PROHIBIDAS) {
    if (c.includes(p)) falla(`${rel(a)} contiene «${p}»: el paquete público arrastra el SDK de Firebase`);
  }
}

// 3. Sin JavaScript en línea: la CSP del sitio es `script-src 'self'`, y un
//    <script> en línea no correría (y sería señal de que alguien lo agregó
//    para esquivarla).
if (existsSync(join(DIST, 'catalogo.html'))) {
  const html = readFileSync(join(DIST, 'catalogo.html'), 'utf8');
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
    if (!/\bsrc=/.test(m[1] ?? '')) falla('catalogo.html trae un <script> en línea');
  }
  if (/\son[a-z]+\s*=/i.test(html)) falla('catalogo.html trae un manejador de evento en línea (onclick, onload…)');
}

// 4. Hay JavaScript propio, y la página lo enlaza.
const js = todos.filter((a) => extname(a) === '.js');
if (js.length === 0) falla('no hay ningún .js en el paquete');

if (fallas.length > 0) {
  console.error(`\nSitio público: ${fallas.length} falla(s)`);
  for (const f of fallas) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`Sitio público en orden: ${js.length} archivo(s) .js, ${todos.length} en total, sin SDK de Firebase ni index.html de la consola.`);
