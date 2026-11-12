/**
 * LOS FLUJOS DEL DISCO, DESCUBIERTOS (etapa 0 de la migración de flujos, 12/11/2026).
 *
 * Una sola lista para las pruebas comunes de invariantes: se descubre recorriendo `Flujos/` entero, así que un flujo
 * que se mude de `Flujos/experimental/<x>/` a `Flujos/clientes/<x>/` (o un flujo nuevo en cualquiera de las dos) entra
 * solo, sin tocar ninguna lista escrita a mano. Salió de `guardado-obligatorio.test.ts`, que ahora la importa.
 *
 *  - `flujosVersionados()`: todo `*.json` bajo `Flujos/` con `nodes` y `connections` (no plantillas, ni copias locales,
 *    ni datos). Rutas relativas a `Flujos/`, ordenadas.
 *  - `flujosDeProduccion()`: los anteriores sin las copias de prueba (`*.prueba.json`) ni de ensayo en el Demo A
 *    (`*.ensayo-demo-a.json`): las que se publican o están por publicarse, una por flujo.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
/** La carpeta `Flujos/` del repositorio (las funciones aceptan otra raíz, para las contrapruebas en un directorio temporal). */
export const CARPETA_FLUJOS_DEL_REPO = join(aqui, '../../../Flujos');

/** Los JSON de flujo versionados bajo `raiz`: rutas relativas a ella, ordenadas. */
export function flujosVersionados(raiz: string = CARPETA_FLUJOS_DEL_REPO): string[] {
  const salida: string[] = [];
  const recorrer = (dir: string): void => {
    // El tipo sale de la misma lectura del directorio (sin comprobar y después leer: CodeQL js/file-system-race); el JSON se lee una vez, con try/catch.
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const nombre = entrada.name;
      if (nombre === 'node_modules' || nombre.startsWith('.')) continue;
      const ruta = join(dir, nombre);
      if (entrada.isDirectory()) { recorrer(ruta); continue; }
      if (!entrada.isFile()) continue;
      if (!nombre.endsWith('.json') || nombre.endsWith('.plantilla.json') || nombre.endsWith('.local.json')) continue;
      let j: Record<string, unknown>;
      try { j = JSON.parse(readFileSync(ruta, 'utf8')) as Record<string, unknown>; } catch { continue; }
      if (Array.isArray(j['nodes']) && j['connections'] && typeof j['connections'] === 'object') salida.push(relative(raiz, ruta));
    }
  };
  recorrer(raiz);
  return salida.sort();
}

/** Los flujos de producción: los versionados sin las copias de prueba ni de ensayo en el Demo A. */
export function flujosDeProduccion(raiz: string = CARPETA_FLUJOS_DEL_REPO): string[] {
  return flujosVersionados(raiz).filter((a) => !a.endsWith('.prueba.json') && !a.endsWith('.ensayo-demo-a.json'));
}
