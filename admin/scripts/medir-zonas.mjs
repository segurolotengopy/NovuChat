#!/usr/bin/env node
/**
 * =============================================================================
 * medir-zonas.mjs — cuánto del árbol cabe hoy en las zonas (F2, PR 1)
 * =============================================================================
 *
 *   node admin/scripts/medir-zonas.mjs           informe legible
 *   node admin/scripts/medir-zonas.mjs --json    el mismo informe en JSON
 *
 * SOLO LECTURA: no escribe nada, no abre Firebase ni la red. Se puede correr
 * desde cualquier carpeta del repositorio.
 *
 * Qué mide (`Analisis/41` §5 y §8.2, pedido de la revisora sobre H1): antes de
 * lanzar a los agentes de módulo en paralelo, cuántos archivos de
 * `admin/functions/src`, `admin/web/src`, `Flujos/src`, `admin/scripts` y
 * `admin/pruebas` tienen zona según el inventario del §5
 * (`pruebas/frontera/destinos-f2.ts`), cuáles no la tienen, cuáles se parten, y
 * qué importaciones van hacia arriba o entre módulos sin `dependeDe`.
 *
 * CÓMO CLASIFICA
 *   - Un archivo de código: la entrada de `DESTINOS_F2`, si no el prefijo más
 *     largo de `PREFIJOS_F2`, si no «sin zona».
 *   - Una prueba (o su ayudante) de `admin/pruebas`, fuera de las carpetas ya
 *     ubicadas: por su GRAFO, es decir, por lo que importa o lee (imports y
 *     rutas escritas en el texto, siguiendo a sus ayudantes). Toma la zona
 *     MÁS ALTA de lo que toca; dos módulos donde ninguno declara al otro en
 *     `dependeDe` es «sin zona» (la prueba está mal cortada); si solo lee los
 *     JSON de `Flujos/`, es «flujo-json»; si no toca nada con zona, «sin zona».
 *   - Hacia arriba: la regla de `pruebas/frontera/frontera.ts`, la MISMA que usa
 *     `fronteras.test.ts` (zona por inventario, por carpeta o por prefijo;
 *     registro < core < central < plataforma < módulo < coordinador <
 *     tenants; entre módulos, solo con `dependeDe`).
 *
 * Es una MEDICIÓN, no una prueba: sale siempre con 0. La prueba que falla si
 * una zona importa hacia arriba es `pruebas/frontera/fronteras.test.ts`; los dos
 * números del informe (sin zona y hacia arriba) son los que ella acota.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_DEL_SCRIPT = join(AQUI, '..', '..');
const JSON_SALIDA = process.argv.includes('--json');

// Node carga los .ts quitando tipos y avisa, una vez por archivo, que
// `functions/package.json` no declara "type". No se agrega (el diseño del
// registro lo prohíbe: cambiaría cómo se cargan las Functions); se calla el
// aviso solo para estas dos cargas.
const emitirOriginal = process.emitWarning;
process.emitWarning = (aviso, ...resto) => {
  const texto = String(typeof aviso === 'string' ? aviso : aviso?.message ?? '');
  const codigo = resto.map((r) => (typeof r === 'object' && r ? r.code : r));
  if (codigo.includes('MODULE_TYPELESS_PACKAGE_JSON') || /Reparsing as ES module/.test(texto)) return;
  return emitirOriginal.call(process, aviso, ...resto);
};
const {
  RAIZ, RAICES, RANGO, analizar, dependenciasDe, esPrueba, esSuite, etiqueta, importsDe,
  listarRaices, sinComentarios, zonaDeCodigo,
} = await import(pathToFileURL(join(RAIZ_DEL_SCRIPT, 'admin/pruebas/frontera/frontera.ts')).href);
process.emitWarning = emitirOriginal;

// ------------------------------------------------------------------ el árbol
const CARPETAS = RAICES.map((r) => r.slice(0, -1));
const ARCHIVOS = listarRaices();
// Los JSON de los flujos no se clasifican (son salida de construcción), pero
// las pruebas los leen y eso decide su zona.
const FLUJOS_JSON = readdirSync(join(RAIZ, 'Flujos')).filter((n) => n.endsWith('.json')).map((n) => `Flujos/${n}`);
const UNIVERSO = [...ARCHIVOS, ...FLUJOS_JSON];

// ------------------------------------------------------------- referencias

/**
 * Rutas escritas en el CÓDIGO de una prueba (no en sus comentarios, que citan
 * archivos entre comillas invertidas): literales y `join(a, 'b', 'c')`.
 */
function rutasEscritas(archivo) {
  const crudo = sinComentarios(readFileSync(join(RAIZ, archivo), 'utf8'));
  const unido = crudo.replace(/(['"`])\s*,\s*(['"`])/g, '/');
  const literales = new Set();
  for (const t of [crudo, unido]) for (const m of t.matchAll(/(['"`])([^'"`\n]{3,200})\1/g)) literales.add(m[2]);
  const refs = new Set();
  let leeFlujos = false;
  for (const lit of literales) {
    if (/(^|\/)Flujos\/?$/.test(lit) || (lit.includes('${') && lit.includes('Flujos'))) leeFlujos = true;
    if (lit.includes('${')) continue;
    const limpio = lit.replace(/^(\.\.?\/)+/, '');
    if (!/\.[a-z]{2,5}$/.test(limpio)) continue;
    const coinciden = limpio.includes('/')
      ? UNIVERSO.filter((u) => u === limpio || u.endsWith(`/${limpio}`))
      : UNIVERSO.filter((u) => basename(u) === limpio);
    if (coinciden.length === 1) refs.add(coinciden[0]);
  }
  return { refs, leeFlujos };
}

// --------------------------------------------------------- las pruebas, por grafo
const cacheRefs = new Map();
function referenciasDePrueba(archivo, visitando = new Set()) {
  if (cacheRefs.has(archivo)) return cacheRefs.get(archivo);
  visitando.add(archivo);
  const { refs, leeFlujos } = rutasEscritas(archivo);
  const todas = new Set(refs);
  let flujos = leeFlujos;
  if (/\.(ts|mjs|js)$/.test(archivo)) for (const i of importsDe(archivo)) if (i.destino) todas.add(i.destino);
  // Se sigue a los ayudantes de la carpeta de pruebas (lib/, dobles/).
  for (const r of [...todas]) {
    if (esPrueba(r) && !esSuite(r) && r !== archivo && !visitando.has(r)) {
      const sub = referenciasDePrueba(r, visitando);
      for (const s of sub.refs) todas.add(s);
      flujos ||= sub.leeFlujos;
    }
  }
  const resultado = { refs: todas, leeFlujos: flujos };
  cacheRefs.set(archivo, resultado);
  return resultado;
}

/** La zona que HEREDA una prueba: la de lo que toca, sin su destino ni sus partes. */
const heredada = (z) => (z.zona === 'modulo' ? { zona: 'modulo', modulo: z.modulo, destino: '' } : { zona: z.zona, destino: '' });

function zonaDePrueba(archivo) {
  const ubicada = zonaDeCodigo(archivo);
  if (ubicada) return { zona: ubicada, motivo: 'carpeta ya ubicada' };
  const { refs, leeFlujos } = referenciasDePrueba(archivo);
  const zonas = [];
  let flujosJson = leeFlujos;
  for (const r of refs) {
    if (r.startsWith('Flujos/') && r.endsWith('.json') && !r.startsWith('Flujos/src/')) { flujosJson = true; continue; }
    if (esPrueba(r)) continue;
    const z = zonaDeCodigo(r);
    if (z) zonas.push(z);
  }
  if (zonas.length === 0) {
    if (flujosJson) return { zona: { zona: 'flujo-json', destino: '' }, motivo: 'solo lee JSON de Flujos/' };
    const leeReglas = /firestore\.rules|storage\.rules|rules-unit-testing/.test(readFileSync(join(RAIZ, archivo), 'utf8'));
    return { zona: null, motivo: leeReglas ? 'solo reglas (emulador): toca todas las zonas' : 'no toca nada con zona' };
  }
  const tope = Math.max(...zonas.map((z) => RANGO[z.zona]));
  const arriba = zonas.filter((z) => RANGO[z.zona] === tope);
  if (tope === RANGO.modulo) {
    const modulos = [...new Set(arriba.map((z) => z.modulo))];
    const dueno = modulos.find((m) => modulos.every((o) => o === m || dependenciasDe(m).has(o)));
    if (!dueno) return { zona: null, motivo: `módulos sin dependeDe entre sí: ${modulos.join(', ')}` };
    return { zona: heredada(arriba.find((z) => z.modulo === dueno)), motivo: 'grafo' };
  }
  return { zona: heredada(arriba[0]), motivo: 'grafo' };
}

// ---------------------------------------------------------------- clasificar
const clasificados = ARCHIVOS.map((archivo) => {
  if (esPrueba(archivo)) {
    const { zona, motivo } = zonaDePrueba(archivo);
    return { archivo, zona, motivo };
  }
  return { archivo, zona: zonaDeCodigo(archivo), motivo: 'inventario §5' };
});

const cuentas = {};
const porModulo = {};
for (const c of clasificados) {
  const z = c.zona ? c.zona.zona : 'sin-zona';
  cuentas[z] = (cuentas[z] ?? 0) + 1;
  if (c.zona?.zona === 'modulo') porModulo[c.zona.modulo] = (porModulo[c.zona.modulo] ?? 0) + 1;
}
const sinZona = clasificados.filter((c) => !c.zona);
const seParten = clasificados.filter((c) => c.zona?.seParte?.length);

// --------------------------------------------------------- hacia arriba
// La regla de `pruebas/frontera/frontera.ts`: la misma que hace fallar a
// `fronteras.test.ts`. Además de lo que medía el PR 1, recorre las pruebas que
// ya están en una carpeta de zona (`pruebas/core/`, `pruebas/central/`).
const { cruces: haciaArriba, sinResolver } = analizar(ARCHIVOS);
const reexportacionesDeIndice = importsDe('admin/functions/src/index.ts')
  .filter((i) => i.reexporta && i.destino).map((i) => i.destino);

// ------------------------------------------------------------------- salida
const informe = {
  fecha: new Date().toISOString().slice(0, 10),
  archivos: ARCHIVOS.length,
  suites: ARCHIVOS.filter(esSuite).length,
  cuentas,
  porModulo,
  sinZona: sinZona.map((c) => ({ archivo: c.archivo, motivo: c.motivo })),
  seParten: seParten.map((c) => ({ archivo: c.archivo, zona: etiqueta(c.zona), conPiezasDe: c.zona.seParte })),
  haciaArriba,
  sinResolver,
  reexportacionesDeIndiceIgnoradas: [...new Set(reexportacionesDeIndice)].length,
  pruebas: clasificados.filter((c) => esPrueba(c.archivo))
    .map((c) => ({ archivo: c.archivo, zona: c.zona ? etiqueta(c.zona) : 'sin-zona', motivo: c.motivo })),
};

if (JSON_SALIDA) {
  process.stdout.write(`${JSON.stringify(informe, null, 2)}\n`);
} else {
  const pct = (n) => `${((100 * n) / informe.archivos).toFixed(0)} %`;
  const orden = ['core', 'coordinador', 'registro', 'central', 'plataforma', 'modulo', 'tenants', 'flujo-json', 'sin-zona'];
  console.log(`Medición de zonas — ${informe.fecha}`);
  console.log(`${informe.archivos} archivos en ${CARPETAS.join(', ')}; ${informe.suites} suites.\n`);
  console.log('Cuentas por zona:');
  for (const z of orden) if (cuentas[z]) console.log(`  ${z.padEnd(12)} ${String(cuentas[z]).padStart(4)}  (${pct(cuentas[z])})`);
  console.log(`  módulos: ${Object.entries(porModulo).map(([m, n]) => `${m} ${n}`).join(', ')}\n`);
  console.log(`Sin zona (${sinZona.length}):`);
  const porCarpeta = {};
  for (const c of sinZona) (porCarpeta[dirname(c.archivo)] ??= []).push(c);
  for (const [dir, lista] of Object.entries(porCarpeta)) {
    console.log(`  ${dir}/`);
    for (const c of lista) console.log(`    ${basename(c.archivo)}${esPrueba(c.archivo) ? `  — ${c.motivo}` : ''}`);
  }
  console.log(`\nSe parten (${seParten.length}):`);
  for (const c of seParten) console.log(`  ${c.archivo}  [${etiqueta(c.zona)} + ${c.zona.seParte.join(', ')}]`);
  console.log(`\nImportaciones hacia arriba o entre módulos sin dependeDe (${haciaArriba.length}):`);
  for (const h of haciaArriba) console.log(`  ${h.desde} → ${h.hacia}  (${h.motivo}${h.soloTipo ? ', solo tipo' : ''})`);
  console.log(`\n(${informe.reexportacionesDeIndiceIgnoradas} archivos reexportados por functions/src/index.ts: inventario de despliegue, no cuentan.)`);
}
