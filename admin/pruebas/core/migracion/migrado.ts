/**
 * LA DEFINICIÓN DE «MIGRADO» (M1 a M7) Y EL TABLERO (etapa 0, 12/11/2026). Texto: `docs/arquitectura/migrado.md`; tablero:
 * `docs/arquitectura/migracion.md`. Este módulo es lo que ejecuta `migrado.test.ts`, con las rutas inyectables para probarlo en un
 * directorio temporal (una regla sin su contraprueba negando no cuenta).
 *
 * Nada aquí publica ni escribe: lee el disco y, para M2, corre el constructor del flujo en modo `--verificar` (que no escribe).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Flujo } from '../../lib/flujo';
import { CARPETA_FLUJOS_DEL_REPO } from '../../lib/flujos-de-cliente';
import { RAIZ_REPO, atiendeCliente, expresionNiegaIaDeCore, fuenteDeNiegaIa, hallazgosM4, idDeFlujo } from './comprobaciones';
import { problemasDeFlujo } from './excepciones';

export const CLASES = ['sin publicar', 'vivo', 'demo', 'barrido', 'congelado'] as const;
export const ESTADOS = ['pendiente', 'mudado'] as const;
const HUELLA = /^[0-9a-f]{8}(-[0-9a-f]{8}){7}$/;

export interface Fila { json: string; carpeta: string; clase: string; armador: string; falta: string; dueno: string; estado: string; huella: string }

const CABECERA = ['JSON', 'carpeta', 'clase', 'constructor', 'falta', 'dueño', 'estado', 'huella'];

/** La ruta del flujo relativa a `Flujos/`: la carpeta `.` es la raíz. */
export const rutaDeFila = (f: Fila): string => (f.carpeta === '.' ? f.json : `${f.carpeta}/${f.json}`);

/** Lee la tabla de `migracion.md`: UNA tabla de 8 columnas. Una tabla distinta, o una fila de otro ancho, es un error. */
export function leerTablero(texto: string): Fila[] {
  const lineas = texto.split('\n').filter((l) => l.startsWith('|'));
  const celdas = (l: string): string[] => l.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  const [cabecera, separador, ...cuerpo] = lineas;
  if (!cabecera || JSON.stringify(celdas(cabecera)) !== JSON.stringify(CABECERA)) throw new Error(`la tabla debe empezar por ${CABECERA.join(' | ')}`);
  if (!separador || !/^\|(\s*-+\s*\|){8}\s*$/.test(separador)) throw new Error('falta la línea separadora de la tabla');
  return cuerpo.map((l) => {
    const c = celdas(l);
    if (c.length !== 8) throw new Error(`la fila «${l.slice(0, 60)}» no tiene 8 columnas`);
    return { json: c[0]!, carpeta: c[1]!, clase: c[2]!, armador: c[3]!, falta: c[4]!, dueno: c[5]!, estado: c[6]!, huella: c[7]! };
  });
}

/** Una fila por cada flujo de producción del disco y viceversa; clase, estado y huella con forma válida; sin duplicados ni dueño vacío. */
export function problemasDelTablero(filas: Fila[], produccion: string[]): string[] {
  const p: string[] = [];
  const ids = new Map<string, number>();
  for (const f of filas) {
    const id = idDeFlujo(rutaDeFila(f));
    ids.set(id, (ids.get(id) ?? 0) + 1);
    if (!(CLASES as readonly string[]).includes(f.clase)) p.push(`${f.json}: la clase «${f.clase}» no es una de ${CLASES.join(', ')}`);
    if (!(ESTADOS as readonly string[]).includes(f.estado)) p.push(`${f.json}: el estado «${f.estado}» no es pendiente ni mudado`);
    if (!HUELLA.test(f.huella)) p.push(`${f.json}: la huella no es sha256 en 8 grupos de 8 caracteres hexadecimales separados por guion`);
    if (!f.dueno.trim()) p.push(`${f.json}: sin dueño`);
  }
  for (const [id, n] of ids) if (n > 1) p.push(`${id}: tiene ${n} filas`);
  const enDisco = new Set(produccion.map(idDeFlujo));
  for (const id of enDisco) if (!ids.has(id)) p.push(`${id}: es un flujo de producción del disco y no tiene fila en el tablero`);
  for (const id of ids.keys()) if (!enDisco.has(id)) p.push(`${id}: tiene fila en el tablero y no es un flujo de producción del disco`);
  return p;
}

// ---------------------------------------------------------------------------
// M1 a M7 para una fila «mudado»
// ---------------------------------------------------------------------------

export interface Contexto {
  /** `Flujos/` (la carpeta). */
  flujos: string;
  /** La raíz del repositorio (donde está `admin/scripts/ensamblar-flujo.mjs`). */
  repo: string;
  /** `docs/versiones-por-cliente.md`. */
  versiones: string;
  /** Las siete pruebas comunes de invariantes (rutas). */
  pruebas: string[];
  /** Corre un comando y devuelve su código de salida (inyectable para probar sin procesos). */
  correr: (comando: string, args: string[], cwd: string) => number;
}

/** Las siete pruebas comunes de invariantes que deben recorrer todo flujo (relativas a `admin/pruebas/`). */
export const PRUEBAS_COMUNES = [
  'core/entregas.test.ts', 'core/ux-derivacion.test.ts', 'capacidades-comunes.test.ts', 'flujos-origen.test.ts', 'core/niega-ia.test.ts',
  'core/error-workflow-por-nombre.test.ts', 'guardado-obligatorio.test.ts',
];

export const contextoReal = (): Contexto => ({
  flujos: CARPETA_FLUJOS_DEL_REPO,
  repo: RAIZ_REPO,
  versiones: join(RAIZ_REPO, 'docs', 'versiones-por-cliente.md'),
  pruebas: PRUEBAS_COMUNES.map((r) => join(RAIZ_REPO, 'admin', 'pruebas', r)),
  correr: (comando, args, cwd) => spawnSync(comando, args, { cwd, encoding: 'utf8', timeout: 300_000 }).status ?? 1,
});

const sha256 = (ruta: string): string => createHash('sha256').update(readFileSync(ruta)).digest('hex');

/**
 * Aplica M1 a M7 a UNA fila. Devuelve lo que falla, con el punto delante (`M3: …`); lista vacía = migrado.
 *  - M1: el flujo vive en `Flujos/clientes/<t>/` y esa carpeta tiene `PROPIO.md`.
 *  - M2: su constructor sale 0 con `--verificar` (o el ensamblador dice «idéntico»); sin constructor no hay mudanza.
 *  - M3: el sha256 del JSON es la huella de su fila (una mudanza no cambia un byte).
 *  - M4: cada nodo común presente incluye una variante declarada de core, o tiene excepción vigente.
 *  - M5: NIEGA_IA sale de core, o tiene excepción vigente (solo si el flujo atiende a un cliente).
 *  - M6: las siete pruebas comunes lo recorren: el flujo está entre los de producción del disco y cada prueba descubre con la lista única.
 *  - M7: tiene fila en `docs/versiones-por-cliente.md`.
 */
export function problemasDeMigrado(fila: Fila, ctx: Contexto = contextoReal()): string[] {
  const p: string[] = [];
  const ruta = rutaDeFila(fila);
  const archivo = join(ctx.flujos, ruta);
  const carpeta = join(ctx.flujos, fila.carpeta);

  if (!/^clientes\/[^/]+$/.test(fila.carpeta) || !existsSync(join(carpeta, 'PROPIO.md'))) p.push(`M1: ${ruta} no está en Flujos/clientes/<t>/ con su PROPIO.md`);
  if (!existsSync(archivo)) return [...p, `M2: ${ruta} no existe en el disco`];

  const partes = fila.armador.split(/\s+/).filter(Boolean);
  if (fila.armador === 'ninguno' || partes.length === 0) p.push('M2: sin constructor ni ensamblador, el JSON no se puede verificar');
  else if (fila.armador === 'ensamblador') {
    if (ctx.correr('node', [join(ctx.repo, 'admin', 'scripts', 'ensamblar-flujo.mjs'), 'verificar'], join(ctx.repo, 'admin')) !== 0) p.push('M2: el ensamblador no dice «idéntico»');
  } else if (ctx.correr('node', [...partes, '--verificar'], carpeta) !== 0) p.push(`M2: «${fila.armador} --verificar» no sale 0`);

  if (sha256(archivo) !== fila.huella.replace(/-/g, '')) p.push(`M3: el sha256 de ${ruta} no es la huella de su fila (una mudanza no cambia un byte)`);

  const flujo = JSON.parse(readFileSync(archivo, 'utf8')) as Flujo;
  const m4 = problemasDeFlujo('nucleo-comun', ruta, hallazgosM4(flujo));
  p.push(...m4.map((x) => `M4: ${x}`));
  if (atiendeCliente(flujo)) {
    const fuente = fuenteDeNiegaIa(flujo, expresionNiegaIaDeCore());
    p.push(...problemasDeFlujo('niega-ia', ruta, fuente === 'core' ? [] : ['NIEGA_IA']).map((x) => `M5: ${x}`));
  }

  for (const prueba of ctx.pruebas) {
    if (!existsSync(prueba) || !readFileSync(prueba, 'utf8').includes('flujos-de-cliente')) p.push(`M6: ${prueba.split('/').pop()} no descubre los flujos con la lista única (lib/flujos-de-cliente)`);
  }

  const nombre = fila.json;
  const hayFila = existsSync(ctx.versiones) && readFileSync(ctx.versiones, 'utf8').split('\n').some((l) => l.startsWith('|') && l.includes(nombre));
  if (!hayFila) p.push(`M7: ${nombre} no tiene fila en docs/versiones-por-cliente.md`);
  return p;
}
