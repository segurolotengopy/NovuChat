/**
 * =============================================================================
 * LA FRONTERA DE ZONAS, como funciones (F2, PR 2)
 * =============================================================================
 *
 * Lo que comparten `fronteras.test.ts` (la prueba que falla) y
 * `scripts/medir-zonas.mjs` (la medición que se cita en cada informe de hito):
 * de qué zona es un archivo, qué importa, y qué importación va hacia arriba.
 * Viven en un solo lugar para que la prueba y la medición no puedan contar
 * distinto.
 *
 * LA ZONA DE UN ARCHIVO, en este orden:
 *   1. Una entrada de `DESTINOS_F2` (el inventario del §5): mientras dura F2,
 *      el archivo que todavía no se movió ya tiene la zona a la que va.
 *   2. La CARPETA (`Analisis/41` §1: carpeta = zona): `core/`, `central/`,
 *      `plataforma/` y `modulos/<m>/` bajo cada raíz de código, y
 *      `scripts/datos/` (tenants). Es la regla permanente: cuando F2 termine,
 *      `DESTINOS_F2` se borra y esto es lo único que queda.
 *   3. El prefijo más largo de `PREFIJOS_F2` (lo que el §5 ubica por carpeta
 *      entera sin que la carpeta tenga todavía el nombre de su zona).
 *
 * HACIA ARRIBA: registro < core < central < plataforma < módulo < coordinador
 * < tenants. Una zona importa solo de la suya o de las de abajo; un módulo
 * importa a otro solo si lo declara (directa o indirectamente) en `dependeDe`
 * del registro. Las reexportaciones de `functions/src/index.ts` no cuentan: son
 * el inventario de despliegue, no una dependencia.
 *
 * Un import de «solo tipo» también cuenta: acopla igual, y es el que primero
 * se esconde.
 *
 * Node carga este archivo quitando tipos (desde `medir-zonas.mjs`): nada de
 * `enum` ni de parámetros con modificador, y las importaciones relativas con
 * su extensión.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTRO } from '../../functions/src/registro.ts';
import { DESTINOS_F2, PREFIJOS_F2 } from './destinos-f2.ts';
import type { DestinoF2, ZonaF2 } from './destinos-f2.ts';

/** La raíz del repositorio. */
export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Las raíces de código: lo que tiene zona vive debajo de una de estas. */
export const RAICES = ['admin/functions/src/', 'admin/web/src/', 'Flujos/src/', 'admin/scripts/', 'admin/pruebas/'] as const;

export const RANGO: Readonly<Record<ZonaF2, number>> = {
  registro: -1, core: 0, central: 1, plataforma: 2, modulo: 3, coordinador: 4, tenants: 5,
};

/**
 * Archivos cuya zona no sale de la carpeta. El registro está en la raíz de
 * Functions a propósito (lo lee todo el mundo y no importa a nadie). El
 * coordinador de turno recibe su línea en el PR que mueva `ingesta.ts`; hasta
 * entonces lo ubica `DESTINOS_F2`, y la prueba falla si deja de haber uno.
 */
export const ZONA_POR_ARCHIVO: Readonly<Record<string, DestinoF2>> = {
  'admin/functions/src/registro.ts': { zona: 'registro', destino: 'admin/functions/src/registro.ts' },
};

/**
 * El punto de entrada de las Functions. Sus reexportaciones no cuentan (son el
 * inventario de despliegue), y una PRUEBA que lo importa para llamar a una
 * callable tampoco: es lo mismo que llamarla por la red.
 */
export const INDICE_DE_FUNCTIONS = 'admin/functions/src/index.ts';

/**
 * Pruebas que leen todas las zonas POR DISEÑO, porque comprueban el registro
 * contra el código de cada una. Una prueba de zona que no esté acá importa
 * solo de su zona y de las de abajo, como el código.
 */
export const PRUEBAS_TRANSVERSALES: readonly string[] = [
  'admin/pruebas/core/registro.test.ts',
];

export const esPrueba = (a: string): boolean => a.startsWith('admin/pruebas/');
export const esSuite = (a: string): boolean => esPrueba(a) && a.endsWith('.test.ts');
export const esCodigo = (a: string): boolean => /\.(ts|tsx|mts|mjs|js)$/.test(a);
export const etiqueta = (z: DestinoF2): string => (z.zona === 'modulo' ? `modulo:${z.modulo}` : z.zona);

// -------------------------------------------------------------------- módulos
const DEPENDE = new Map<string, readonly string[]>(REGISTRO.map((m) => [m.modulo, m.dependeDe]));

/** Los módulos de los que `m` depende, directa o indirectamente. */
export function dependenciasDe(m: string, vistos: Set<string> = new Set()): Set<string> {
  for (const d of DEPENDE.get(m) ?? []) if (!vistos.has(d)) { vistos.add(d); dependenciasDe(d, vistos); }
  return vistos;
}

// ---------------------------------------------------------------------- zonas
/** La zona que da la carpeta, sin mirar el inventario. */
export function zonaPorCarpeta(archivo: string): DestinoF2 | null {
  if (ZONA_POR_ARCHIVO[archivo]) return ZONA_POR_ARCHIVO[archivo];
  const raiz = RAICES.find((r) => archivo.startsWith(r));
  if (!raiz) return null;
  const partes = archivo.slice(raiz.length).split('/');
  if (partes.length < 2) return null; // un archivo suelto en la raíz no está en una carpeta de zona
  const [primera, segunda] = partes;
  const destino = `${raiz}${primera}/`;
  if (primera === 'core') return { zona: 'core', destino };
  if (primera === 'central') return { zona: 'central', destino };
  if (primera === 'plataforma') return { zona: 'plataforma', destino };
  if (primera === 'modulos' && partes.length >= 3) return { zona: 'modulo', modulo: segunda, destino: `${destino}${segunda}/` };
  if (raiz === 'admin/scripts/' && primera === 'datos') return { zona: 'tenants', destino };
  return null;
}

/** La zona de un archivo de código: inventario, carpeta, prefijo (ver arriba). */
export function zonaDeCodigo(archivo: string): DestinoF2 | null {
  if (DESTINOS_F2[archivo]) return DESTINOS_F2[archivo];
  const porCarpeta = zonaPorCarpeta(archivo);
  if (porCarpeta) return porCarpeta;
  const prefijo = PREFIJOS_F2.filter((p) => archivo.startsWith(p.prefijo))
    .sort((a, b) => b.prefijo.length - a.prefijo.length)[0];
  return prefijo ? prefijo.destino : null;
}

// ---------------------------------------------------------------- el árbol
/** Lo que el análisis necesita del disco; la prueba negativa pasa uno de mentira. */
export interface Arbol {
  leer(archivo: string): string;
  existe(archivo: string): boolean;
}

export const ARBOL_REAL: Arbol = {
  leer: (a) => readFileSync(join(RAIZ, a), 'utf8'),
  existe: (a) => existsSync(join(RAIZ, a)) && statSync(join(RAIZ, a)).isFile(),
};

/** Todos los archivos de las raíces de código, relativos a la raíz, ordenados. */
export function listarRaices(): string[] {
  const listar = (dir: string): string[] => readdirSync(join(RAIZ, dir)).flatMap((n) => {
    if (n === 'node_modules') return [];
    const rel = `${dir}/${n}`;
    return statSync(join(RAIZ, rel)).isDirectory() ? listar(rel) : [rel];
  });
  return RAICES.flatMap((r) => listar(r.slice(0, -1))).sort();
}

// ------------------------------------------------------------ importaciones
/** Un `//` pegado a `:` (una URL dentro de un texto) no es comentario. */
export const sinComentarios = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;])\/\/.*$/gm, '$1');

const EXTENSIONES = ['', '.ts', '.tsx', '.mjs', '.js', '.d.mts', '/index.ts', '/index.tsx'];

/** La ruta del archivo al que apunta un import relativo, o null si no existe. */
export function resolverRelativo(desde: string, especificador: string, arbol: Arbol = ARBOL_REAL): string | null {
  let base = posix.normalize(posix.join(posix.dirname(desde), especificador.replace(/\?.*$/, '')));
  if (base.startsWith('../')) return null;
  // Los scripts importan las Functions COMPILADAS (`functions/lib/*.js`), que
  // no están en el repositorio: la dependencia real es con su fuente.
  if (base.startsWith('admin/functions/lib/')) base = base.replace('admin/functions/lib/', 'admin/functions/src/');
  const candidatos = [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), base.replace(/\.mjs$/, '.d.mts')];
  for (const c of candidatos) for (const e of EXTENSIONES) if (arbol.existe(c + e)) return c + e;
  return null;
}

export interface Importacion {
  readonly especificador: string;
  /** null si el import relativo no lleva a ningún archivo. */
  readonly destino: string | null;
  readonly soloTipo: boolean;
  readonly reexporta: boolean;
}

/** Imports estáticos, reexportaciones e imports dinámicos RELATIVOS de un archivo. */
export function importsDe(archivo: string, arbol: Arbol = ARBOL_REAL): Importacion[] {
  const texto = sinComentarios(arbol.leer(archivo));
  const encontrados: Importacion[] = [];
  const patrones = [
    /\b(import|export)\s+(type\s+)?[^;'"`]*?\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+()()['"]([^'"]+)['"]/g,
    /\bimport\(\s*()()['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*()()['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const p of patrones) for (const m of texto.matchAll(p)) {
    const especificador = m[3];
    if (!especificador.startsWith('.')) continue;
    encontrados.push({
      especificador, destino: resolverRelativo(archivo, especificador, arbol),
      soloTipo: Boolean(m[2]), reexporta: m[1] === 'export',
    });
  }
  return encontrados;
}

// ----------------------------------------------------------------- la frontera
export interface Cruce {
  readonly desde: string;
  readonly hacia: string;
  readonly motivo: string;
  readonly soloTipo: boolean;
}

/**
 * Por qué `origen` no puede importar a `destino`, o null si puede. Es LA
 * regla: la prueba negativa la ejerce con zonas inventadas.
 */
export function motivoDeCruce(origen: DestinoF2, destino: DestinoF2): string | null {
  if (origen.zona === 'modulo' && destino.zona === 'modulo') {
    if (origen.modulo === destino.modulo) return null;
    if (dependenciasDe(origen.modulo ?? '').has(destino.modulo ?? '')) return null;
    return `módulo sin dependeDe (${origen.modulo} → ${destino.modulo})`;
  }
  return RANGO[destino.zona] > RANGO[origen.zona] ? `${etiqueta(origen)} → ${etiqueta(destino)}` : null;
}

export interface Analisis {
  readonly cruces: Cruce[];
  /** Imports relativos que no llevan a ningún archivo: el lector se equivocó o el archivo no existe. */
  readonly sinResolver: { desde: string; especificador: string }[];
}

/**
 * Recorre los imports de `archivos` (los que tienen zona; una prueba solo si
 * está en una carpeta de zona) y devuelve los cruces hacia arriba. `zonaDe`
 * se inyecta para que la prueba negativa pueda inventar zonas.
 */
export function analizar(
  archivos: readonly string[],
  zonaDe: (a: string) => DestinoF2 | null = zonaDeCodigo,
  arbol: Arbol = ARBOL_REAL,
): Analisis {
  const cruces: Cruce[] = [];
  const sinResolver: { desde: string; especificador: string }[] = [];
  for (const archivo of archivos) {
    if (!esCodigo(archivo)) continue;
    const prueba = esPrueba(archivo);
    if (prueba && PRUEBAS_TRANSVERSALES.includes(archivo)) continue;
    const origen = prueba ? zonaPorCarpeta(archivo) : zonaDe(archivo);
    if (!origen) continue;
    for (const i of importsDe(archivo, arbol)) {
      if (!i.destino) { sinResolver.push({ desde: archivo, especificador: i.especificador }); continue; }
      if (archivo === INDICE_DE_FUNCTIONS && i.reexporta) continue;
      if (prueba && i.destino === INDICE_DE_FUNCTIONS) continue;
      if (esPrueba(i.destino)) continue; // los ayudantes de prueba no son código de zona
      const destino = zonaDe(i.destino);
      if (!destino) continue;
      const motivo = motivoDeCruce(origen, destino);
      if (motivo) cruces.push({ desde: archivo, hacia: i.destino, motivo, soloTipo: i.soloTipo });
    }
  }
  return { cruces, sinResolver };
}

export const claveDeCruce = (c: { desde: string; hacia: string }): string => `${c.desde} → ${c.hacia}`;
