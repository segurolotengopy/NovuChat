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
 * (`pruebas/core/destinos-f2.ts`), cuáles no la tienen, cuáles se parten, y
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
 *   - Hacia arriba: registro < core < central < plataforma < módulo <
 *     coordinador < tenants. Un módulo puede importar a otro solo si lo
 *     declara (directa o indirectamente) en `dependeDe`. Las reexportaciones de
 *     `functions/src/index.ts` no cuentan: son el inventario de despliegue.
 *
 * Es una MEDICIÓN, no una prueba: sale siempre con 0. La prueba que falla si
 * una zona importa hacia arriba es `fronteras.test.ts` (F2, PR 2).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');
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
const { REGISTRO } = await import(pathToFileURL(join(RAIZ, 'admin/functions/src/registro.ts')).href);
const { DESTINOS_F2, PREFIJOS_F2 } = await import(pathToFileURL(join(RAIZ, 'admin/pruebas/core/destinos-f2.ts')).href);
process.emitWarning = emitirOriginal;

// ------------------------------------------------------------------ el árbol
const CARPETAS = ['admin/functions/src', 'admin/web/src', 'Flujos/src', 'admin/scripts', 'admin/pruebas'];
const listar = (dir) => readdirSync(join(RAIZ, dir)).flatMap((n) => {
  if (n === 'node_modules') return [];
  const rel = `${dir}/${n}`;
  return statSync(join(RAIZ, rel)).isDirectory() ? listar(rel) : [rel];
});
const ARCHIVOS = CARPETAS.flatMap(listar).sort();
// Los JSON de los flujos no se clasifican (son salida de construcción), pero
// las pruebas los leen y eso decide su zona.
const FLUJOS_JSON = readdirSync(join(RAIZ, 'Flujos')).filter((n) => n.endsWith('.json')).map((n) => `Flujos/${n}`);
const UNIVERSO = [...ARCHIVOS, ...FLUJOS_JSON];
const esPrueba = (a) => a.startsWith('admin/pruebas/');
const esSuite = (a) => esPrueba(a) && a.endsWith('.test.ts');

// ---------------------------------------------------------- zonas y módulos
const DEPENDE = new Map(REGISTRO.map((m) => [m.modulo, m.dependeDe]));
function dependenciasDe(m, vistos = new Set()) {
  for (const d of DEPENDE.get(m) ?? []) if (!vistos.has(d)) { vistos.add(d); dependenciasDe(d, vistos); }
  return vistos;
}
const RANGO = { registro: -1, core: 0, central: 1, plataforma: 2, modulo: 3, coordinador: 4, tenants: 5 };
const etiqueta = (z) => (z.zona === 'modulo' ? `modulo:${z.modulo}` : z.zona);

function zonaDeCodigo(archivo) {
  if (DESTINOS_F2[archivo]) return DESTINOS_F2[archivo];
  const prefijo = PREFIJOS_F2.filter((p) => archivo.startsWith(p.prefijo))
    .sort((a, b) => b.prefijo.length - a.prefijo.length)[0];
  return prefijo ? prefijo.destino : null;
}

// ------------------------------------------------------------- referencias
// Un `//` pegado a `:` (una URL dentro de un texto) no es comentario.
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;])\/\/.*$/gm, '$1');
const EXTENSIONES = ['', '.ts', '.tsx', '.mjs', '.js', '.d.mts', '/index.ts'];

function resolverRelativo(desde, especificador) {
  const base = join(dirname(join(RAIZ, desde)), especificador);
  const candidatos = [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), base.replace(/\.mjs$/, '.d.mts')];
  for (const c of candidatos) for (const e of EXTENSIONES) {
    const r = c + e;
    if (existsSync(r) && statSync(r).isFile()) return relative(RAIZ, r);
  }
  return null;
}

/** Imports estáticos, reexportaciones e imports dinámicos, con «solo tipo». */
function importsDe(archivo) {
  const texto = sinComentarios(readFileSync(join(RAIZ, archivo), 'utf8'));
  const encontrados = [];
  const patrones = [
    /\b(import|export)\s+(type\s+)?[^;'"`]*?\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+()()['"]([^'"]+)['"]/g,
    /\bimport\(\s*()()['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const p of patrones) for (const m of texto.matchAll(p)) {
    const especificador = m[3];
    if (!especificador.startsWith('.')) continue;
    const destino = resolverRelativo(archivo, especificador);
    if (destino) encontrados.push({ destino, tipo: Boolean(m[2]), reexporta: m[1] === 'export' });
  }
  return encontrados;
}

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
  if (/\.(ts|mjs|js)$/.test(archivo)) for (const i of importsDe(archivo)) todas.add(i.destino);
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
const ZONA = new Map(clasificados.map((c) => [c.archivo, c.zona]));
const haciaArriba = [];
const reexportacionesDeIndice = [];
for (const archivo of ARCHIVOS) {
  if (esPrueba(archivo) || !/\.(ts|tsx|mjs|js)$/.test(archivo)) continue;
  const origen = ZONA.get(archivo);
  if (!origen || origen.zona === 'flujo-json') continue;
  for (const i of importsDe(archivo)) {
    const destino = ZONA.get(i.destino);
    if (!destino || esPrueba(i.destino)) continue;
    if (archivo === 'admin/functions/src/index.ts' && i.reexporta) { reexportacionesDeIndice.push(i.destino); continue; }
    let motivo = null;
    if (origen.zona === 'modulo' && destino.zona === 'modulo') {
      if (origen.modulo !== destino.modulo && !dependenciasDe(origen.modulo).has(destino.modulo)) {
        motivo = `módulo sin dependeDe (${origen.modulo} → ${destino.modulo})`;
      }
    } else if (RANGO[destino.zona] > RANGO[origen.zona]) {
      motivo = `${etiqueta(origen)} → ${etiqueta(destino)}`;
    }
    if (motivo) haciaArriba.push({ desde: archivo, hacia: i.destino, motivo, soloTipo: i.tipo });
  }
}

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
