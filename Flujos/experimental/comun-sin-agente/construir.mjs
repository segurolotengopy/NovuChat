#!/usr/bin/env node
/**
 * =============================================================================
 * construir.mjs — ARMADOR GENÉRICO de flujos «sin agente» (el código calcula, el modelo conversa)
 * =============================================================================
 *
 *   node construir.mjs --proyecto <carpeta>              escribe los JSON de cada variante
 *   node construir.mjs --proyecto <carpeta> --verificar  no escribe: sale 1 si algún JSON versionado difiere
 *   (nada se lee fuera de `Flujos/`, ni siquiera por enlaces simbólicos; `--tope <carpeta>` lo ensancha, solo para pruebas)
 *
 * Sacado de `agenda-minima/construir.mjs`, que sigue siendo suyo y no se toca. Aquí el flujo se describe en un
 * `construir.config.json` dentro de la carpeta del proyecto y el armador no sabe nada de agenda.
 *
 * QUÉ HACE. La plantilla (`plantilla`) es el flujo sin el código: cada nodo Code lleva un `jsCode` que empieza
 * con `@@`. El armador lo reemplaza por el código de un archivo, con lo que haga falta DELANTE (el nodo Code de
 * n8n no tiene módulos). La marca tiene la forma
 *
 *     @@<modo>[+<paquete>]*:<ruta>
 *
 *   modo `todo`   librerías + comunes + los paquetes pedidos + el archivo   (`@@nodos/x.js` es lo mismo; así lo
 *                 escribe agenda-minima, y el armador lo arma igual)
 *   modo `comun`  comunes + los paquetes pedidos + el archivo
 *   modo `solo`   los paquetes pedidos + el archivo
 *
 * Los PAQUETES son nombres de la sección `paquetes` del config: cada uno es un archivo o una lista de archivos
 * (por ejemplo `mensajes` o `filtro` de esta carpeta). Se pegan en el orden en que se piden. Ejemplos:
 *   `@@comun+mensajes:nodos/armar.js`     `@@solo+mensajes+filtro:nodos/armar.js`
 *
 * `construir.config.json` (todas las rutas son relativas a la carpeta del proyecto):
 *   {
 *     "plantilla": "flujo.plantilla.json",
 *     "raiz": ".",                                  carpeta fuera de la cual no se lee nada (por defecto, el proyecto)
 *     "librerias": ["src/lib/algo.js"],             delante en el modo `todo`
 *     "comun": ["src/nodos/_comun.js"],             delante en los modos `todo` y `comun`
 *     "paquetes": { "mensajes": ["../comun-sin-agente/src/mensajes.js"] },
 *     "variantes": [ { "archivo": "x.v0.json", "quitar": "Entrada de prueba", "nombre": "…" } ]
 *   }
 * `quitar` (texto o lista) saca esos nodos y sus conexiones: la variante de producción lleva el disparador de
 * WhatsApp y no «Entrada de prueba»; la de prueba, al revés (activar un WhatsApp Trigger en n8n registra el
 * disparador en Meta y le quita el webhook al flujo vivo).
 *
 * NO HACE NADA MÁS: no lee `.env`, no llama a la red, no importa nada de fuera de `node:`.
 */
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Nada se lee fuera de `Flujos/`: este módulo vive en `Flujos/experimental/comun-sin-agente/`. Las pruebas pasan otro tope.
const TOPE_POR_DEFECTO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Lee `construir.config.json` y comprueba su forma. Devuelve el proyecto listo para armar. */
export function leerProyecto(carpeta, configEnMemoria = null, { tope = TOPE_POR_DEFECTO } = {}) {
  const dir = resolve(carpeta);
  const rutaConfig = join(dir, 'construir.config.json');
  // `configEnMemoria` sirve para armar con el config de otro sin escribir un archivo en su carpeta (las pruebas).
  if (!configEnMemoria && !existsSync(rutaConfig)) throw new Error(`no existe ${rutaConfig}`);
  let cfg = configEnMemoria;
  if (!cfg) {
    if (lstatSync(rutaConfig).isSymbolicLink()) throw new Error('construir.config.json no puede ser un enlace simbólico');
    // Sin el texto del archivo en el mensaje: si no es JSON, no se muestran sus bytes.
    try { cfg = JSON.parse(readFileSync(rutaConfig, 'utf8')); } catch (e) { throw new Error('construir.config.json no es un JSON válido'); }
  }
  // Se compara por la RUTA REAL: un enlace simbólico dentro de la raíz que apunte afuera no se sigue.
  const real = (r) => { try { return realpathSync(r); } catch (e) { return resolve(r); } };
  const fuera = (base, abs) => { const rel = relative(base, abs); return rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel); };
  if (cfg.raiz !== undefined && (typeof cfg.raiz !== 'string' || isAbsolute(cfg.raiz))) throw new Error('raiz: tiene que ser una ruta relativa a la carpeta del proyecto');
  const raiz = real(resolve(dir, cfg.raiz || '.'));
  if (fuera(real(tope), real(dir)) || fuera(real(tope), raiz)) throw new Error(`la carpeta del proyecto y su raíz tienen que estar dentro de ${tope}`);
  const dentro = (ruta, que) => {
    const abs = isAbsolute(ruta) ? ruta : resolve(dir, ruta);
    // Primero el camino escrito (sin tocar el disco: no se averigua si un archivo de afuera existe), y después la ruta REAL.
    if (fuera(raiz, resolve(abs))) throw new Error(`${que}: «${ruta}» queda fuera de la raíz permitida`);
    if (!existsSync(abs)) throw new Error(`${que}: no existe ${ruta}`);
    if (fuera(raiz, real(abs))) throw new Error(`${que}: «${ruta}» queda fuera de la raíz permitida`);
    return abs;
  };
  const lista = (v) => (v === undefined || v === null ? [] : (Array.isArray(v) ? v : [v]));
  const leerLista = (rutas, que) => lista(rutas).map((r) => readFileSync(dentro(r, que), 'utf8').trimEnd());
  const paquetes = {};
  for (const [nombre, rutas] of Object.entries(cfg.paquetes || {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(nombre)) throw new Error(`paquete «${nombre}»: el nombre solo lleva minúsculas, números y guiones`);
    paquetes[nombre] = leerLista(rutas, `paquete ${nombre}`);
  }
  if (!Array.isArray(cfg.variantes) || !cfg.variantes.length) throw new Error('el config no declara variantes');
  for (const v of cfg.variantes) {
    if (!v.archivo || !/^[\w.-]+\.json$/.test(v.archivo)) throw new Error(`variante con archivo no válido: ${JSON.stringify(v.archivo)}`);
    if (!v.nombre) throw new Error(`${v.archivo}: falta el nombre del flujo`);
  }
  const archivos = cfg.variantes.map((v) => v.archivo);
  if (new Set(archivos).size !== archivos.length) throw new Error('dos variantes escriben el mismo archivo');
  // Una variante nunca pisa el config ni la plantilla (ni el código del que se arma).
  const reservados = new Set([resolve(dir, 'construir.config.json'), resolve(dir, cfg.plantilla || 'flujo.plantilla.json')]);
  for (const v of cfg.variantes) if (reservados.has(resolve(dir, v.archivo))) throw new Error(`${v.archivo}: es un archivo del proyecto y no se puede escribir`);
  return {
    dir,
    plantilla: JSON.parse(readFileSync(dentro(cfg.plantilla || 'flujo.plantilla.json', 'plantilla'), 'utf8')),
    librerias: leerLista(cfg.librerias, 'librería'),
    comun: leerLista(cfg.comun, 'común'),
    paquetes,
    variantes: cfg.variantes,
    // El código de un nodo se lee SIEMPRE dentro de la raíz.
    leerNodo: (ruta, nodo) => {
      if (/[\\]|(^|\/)\.\.(\/|$)/.test(ruta) || isAbsolute(ruta)) throw new Error(`${nodo}: ruta de código no válida: ${ruta}`);
      return readFileSync(dentro(join('src', ruta), nodo), 'utf8').trimEnd();
    },
  };
}

const MARCA = /^@@(?:(todo|comun|solo)((?:\+[a-z][a-z0-9-]*)*):)?(.+)$/;

/** El código con que se reemplaza una marca `@@…`. Lanza si la marca o la ruta no son válidas. */
export function codigoDe(p, marca, nodo) {
  const m = MARCA.exec(marca);
  if (!m) throw new Error(`${nodo}: marca no válida: ${marca}`);
  const modo = m[1] || 'todo';
  const pedidos = m[2] ? m[2].slice(1).split('+') : [];
  const ruta = m[3];
  if (!m[1] && !/^nodos\//.test(ruta)) throw new Error(`${nodo}: marca no válida: ${marca}`);
  if (!/^nodos\/[a-z0-9-]+\.js$/.test(ruta) && !/^[a-z0-9-]+\/[a-z0-9-]+\.js$/.test(ruta)) throw new Error(`${nodo}: ruta de código no válida: ${marca}`);
  for (const pk of pedidos) if (!p.paquetes[pk]) throw new Error(`${nodo}: el config no declara el paquete «${pk}»`);
  const delante = [];
  if (modo === 'todo') delante.push(...p.librerias);
  if (modo !== 'solo') delante.push(...p.comun);
  for (const pk of pedidos) delante.push(...p.paquetes[pk]);
  return [...delante, p.leerNodo(ruta, nodo)].join('\n\n') + '\n';
}

/** Arma UNA variante: devuelve el texto del JSON. */
export function armarVariante(p, v) {
  const flujo = JSON.parse(JSON.stringify(p.plantilla));
  flujo.name = v.nombre;
  const quitar = new Set(v.quitar === undefined ? [] : (Array.isArray(v.quitar) ? v.quitar : [v.quitar]));
  const antes = new Set(flujo.nodes.map((n) => n.name));
  for (const q of quitar) if (!antes.has(q)) throw new Error(`${v.archivo}: no hay un nodo «${q}» que quitar`);
  flujo.nodes = flujo.nodes.filter((n) => !quitar.has(n.name));
  for (const n of flujo.nodes) {
    const js = n.parameters && n.parameters.jsCode;
    if (typeof js === 'string' && js.startsWith('@@')) n.parameters.jsCode = codigoDe(p, js, n.name);
  }
  const vivos = new Set(flujo.nodes.map((n) => n.name));
  const conexiones = {};
  for (const [de, salidas] of Object.entries(flujo.connections || {})) {
    if (!vivos.has(de)) continue;
    conexiones[de] = { main: (salidas.main || []).map((s) => (s || []).filter((c) => vivos.has(c.node))) };
  }
  flujo.connections = conexiones;
  const texto = JSON.stringify(flujo, null, 2) + '\n';
  if (texto.includes('"@@')) throw new Error(`${v.archivo}: quedó una marca @@ sin reemplazar`);
  const ids = flujo.nodes.map((n) => n.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${v.archivo}: ids de nodo repetidos`);
  const nombres = flujo.nodes.map((n) => n.name);
  if (new Set(nombres).size !== nombres.length) throw new Error(`${v.archivo}: nombres de nodo repetidos`);
  return texto;
}

/** Arma todas las variantes de una carpeta. Con `verificar` no escribe: devuelve las que difieren. */
export function construir(carpeta, { verificar = false, config = null, tope } = {}) {
  const p = leerProyecto(carpeta, config, tope ? { tope } : {});
  const resultado = [];
  for (const v of p.variantes) {
    const texto = armarVariante(p, v);
    const ruta = join(p.dir, v.archivo);
    const actual = existsSync(ruta) ? readFileSync(ruta, 'utf8') : null;
    // Nunca se escribe a través de un enlace simbólico (pisaría un archivo de afuera).
    if (existsSync(ruta) && lstatSync(ruta).isSymbolicLink()) throw new Error(`${v.archivo}: es un enlace simbólico y no se escribe`);
    if (!verificar) writeFileSync(ruta, texto);
    resultado.push({ archivo: v.archivo, nodos: JSON.parse(texto).nodes.length, alDia: actual === texto, existia: actual !== null });
  }
  return resultado;
}

// ----------------------------------------------------------------- línea de comandos
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--proyecto');
  const carpeta = i >= 0 ? args[i + 1] : undefined;
  if (!carpeta) {
    console.error('✗ falta --proyecto <carpeta con construir.config.json>');
    process.exit(2);
  }
  const verificar = args.includes('--verificar');
  // `--tope <carpeta>` ensancha lo que se puede leer (las pruebas arman proyectos en una carpeta temporal); solo desde la línea de
  // comandos: un config no puede pedirlo.
  const j = args.indexOf('--tope');
  const tope = j >= 0 ? args[j + 1] : undefined;
  try {
    let difiere = false;
    for (const r of construir(carpeta, { verificar, tope })) {
      if (verificar) {
        if (r.alDia) console.log(`✓ ${r.archivo} al día`);
        else { difiere = true; console.error(`✗ ${r.archivo} ${r.existia ? 'difiere de lo que arma la plantilla' : 'no existe'}: corra «node construir.mjs --proyecto ${carpeta}»`); }
      } else {
        console.log(`✓ ${r.archivo} escrito (${r.nodos} nodos)`);
      }
    }
    process.exit(difiere ? 1 : 0);
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
