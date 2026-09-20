#!/usr/bin/env node
/**
 * =============================================================================
 * EL ENSAMBLADOR DE FLUJOS — MÓDULOS ⇄ JSON, BYTE A BYTE
 * =============================================================================
 *
 * POR QUÉ EXISTE. Al 20/09/2026 los ocho JSON de `Flujos/` llevan adentro
 * 1,28 MB de JavaScript en 85 nodos Code, y los 18 nodos Code del vertical de
 * reservas están copiados LETRA POR LETRA en el Demo A, en Platinum y en
 * Bellido. Cada cliente nuevo congela una copia más, y «un cambio se aplica a
 * todos o a ninguno» (CLAUDE.md, Analisis/20 §5) pasa a depender de portar
 * texto entre archivos. Este script saca ese código —y los prompts de los
 * agentes— a módulos versionados en `Flujos/src/` y `Flujos/prompts/`, y vuelve
 * a producir los JSON idénticos a los que hay hoy.
 *
 * POR QUÉ NO ES EL GENERADOR QUE SE RETIRÓ EN AGOSTO (`Flujos/LEEME-flujos.md` §0).
 * Aquel producía la topología entera desde Python y divergió del lienzo en
 * silencio. Este:
 *   1. NO produce topología, ni nodos, ni conexiones, ni credenciales, ni
 *      posiciones. Parsea el JSON que YA existe y muta en sitio exactamente dos
 *      cosas: `parameters.jsCode` de un nodo Code y `parameters.options.systemMessage`
 *      / `parameters.text` de un agente. Nunca reconstruye el objeto, así que el
 *      orden de claves de cada archivo se conserva (a `demo-a-recordatorios.json`
 *      le importa: tiene otro orden de primer nivel).
 *   2. Exige identidad BYTE A BYTE: `verificar` ensambla en memoria y compara
 *      con el archivo; si difiere, sale con código 1 y dice qué nodo. Con eso
 *      el JSON y los módulos no pueden divergir sin que se note.
 *   3. Trae la operación inversa, `extraer`, que aquel nunca tuvo: alguien edita
 *      en n8n, exporta, y `extraer` lleva a los módulos lo que cambió. El ciclo
 *      «editar en n8n → exportar → reemplazar el archivo» sigue existiendo y
 *      termina en un `extraer` en vez de en una divergencia.
 *
 * DÓNDE SE DECLARAN LOS PUNTOS DE INYECCIÓN. En un manifiesto externo por flujo,
 * `Flujos/manifiestos/<flujo>.json`, POR NOMBRE DE NODO, y nunca con comentarios
 * marcadores dentro del código: un marcador en el código sería texto que viaja
 * al JSON, y el JSON tiene que quedar idéntico. Va en una carpeta propia y no
 * al lado de los módulos porque un manifiesto es metadato de UN JSON (qué nodo
 * toma qué archivo), mientras que `Flujos/src/comun/` es código que comparten
 * varios; mezclarlos sugeriría que el manifiesto también se comparte, y no.
 *
 *   {
 *     "flujo": "demo-a-agendamiento.json",
 *     "conservanMarcadores": { "Config base": "REEMPLAZAR_" },
 *     "codigo":  { "Normalizar entrada": "comun/normalizar-entrada.js",
 *                  "Uso extendido": { "archivo": "comun/uso-extendido.js", "saltoFinal": true } },
 *     "prompts": { "AI Agent (Sofía)": { "systemMessage": "reservas/demo-a.md",
 *                                        "text": "reservas/turno-del-cliente.md" } }
 *   }
 *
 *   - `codigo`: nodo Code → archivo bajo `Flujos/src/`.
 *   - `prompts`: agente → archivos bajo `Flujos/prompts/` para cada campo.
 *   - `conservanMarcadores`: nodos que se quedan en el JSON a propósito, con el
 *     prefijo que tienen que conservar. Es el nodo `Config base` con sus
 *     `REEMPLAZAR_*`: no entra en ningún módulo, `preparar-import.sh` y
 *     `verificar-saneo.sh` lo siguen encontrando donde siempre, y `verificar`
 *     comprueba que el prefijo sigue ahí.
 *   - Si un nodo del manifiesto no existe en el JSON, error ruidoso con el
 *     nombre: es un nodo renombrado en n8n que hay que renombrar acá.
 *
 * EL SALTO DE LÍNEA FINAL. Los editores y el gancho `end-of-file-fixer` dejan
 * cada archivo con exactamente UN salto de línea final, y el cuerpo de casi
 * todos los nodos no termina en salto de línea. Convención: el archivo del
 * módulo es el contenido más un `\n`, que el ensamblador quita. Cuando el
 * contenido real SÍ termina en `\n` (dos nodos de reservas), el manifiesto lo
 * dice con `saltoFinal: true` y el archivo es el contenido tal cual. `extraer`
 * pone la marca solo; un contenido que termine en dos saltos no se puede
 * representar y `extraer` lo rechaza en vez de perderlo en silencio.
 *
 * LO QUE NO HACE. No inyecta valores reales (los `REEMPLAZAR_*` siguen siendo
 * de `preparar-import.sh`), no publica nada en n8n, no toca `scripts/`, no
 * agrega dependencias. Sin manifiesto, un JSON se verifica como «idéntico por
 * definición»: no hay nada que ensamblar.
 *
 *   node admin/scripts/ensamblar-flujo.mjs verificar [flujo.json ...]   # 0 si todo es idéntico
 *   node admin/scripts/ensamblar-flujo.mjs ensamblar [flujo.json ...]   # módulos → JSON
 *   node admin/scripts/ensamblar-flujo.mjs extraer <flujo.json> [--nuevo <carpeta>]
 *                                                                        # JSON → módulos
 *
 * `extraer --nuevo reservas` crea el manifiesto de un flujo que no lo tiene,
 * con un archivo por nodo bajo esa carpeta; después se edita a mano para
 * apuntar a `comun/` lo que se comparte y se vuelve a correr `extraer`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));

/** La carpeta `Flujos/` del repositorio; las pruebas pasan otra. */
export const RAIZ_FLUJOS = resolve(aqui, '../../Flujos');

export const TIPO_CODE = 'n8n-nodes-base.code';
export const TIPO_AGENTE = '@n8n/n8n-nodes-langchain.agent';

/** Las cuatro carpetas que usa el ensamblador, a partir de la raíz `Flujos/`. */
export const carpetas = (raiz = RAIZ_FLUJOS) => ({
  flujos: raiz,
  src: join(raiz, 'src'),
  prompts: join(raiz, 'prompts'),
  manifiestos: join(raiz, 'manifiestos'),
});

/** «AI Agent (Sofía)» → «ai-agent-sofia»: el nombre del nodo como nombre de archivo. */
export const slug = (nombre) => nombre
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Los JSON de flujo de la raíz (no los manifiestos, no los `.local.json`). */
export const listarFlujos = (raiz = RAIZ_FLUJOS) => readdirSync(raiz)
  .filter((f) => f.endsWith('.json') && !f.endsWith('.local.json'))
  .sort();

export const rutaDeManifiesto = (archivoFlujo, raiz = RAIZ_FLUJOS) =>
  join(carpetas(raiz).manifiestos, archivoFlujo);

export function leerManifiesto(archivoFlujo, raiz = RAIZ_FLUJOS) {
  const ruta = rutaDeManifiesto(archivoFlujo, raiz);
  if (!existsSync(ruta)) return null;
  const m = JSON.parse(readFileSync(ruta, 'utf8'));
  if (m.flujo !== archivoFlujo) {
    throw new Error(`${ruta}: declara "flujo": "${m.flujo}" pero es el manifiesto de ${archivoFlujo}`);
  }
  return m;
}

const escribirManifiesto = (m, raiz) => {
  const ruta = rutaDeManifiesto(m.flujo, raiz);
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, JSON.stringify(m, null, 2) + '\n');
  return ruta;
};

/** Una entrada del manifiesto, como `"ruta.js"` o `{ archivo, saltoFinal }`, normalizada. */
const entrada = (valor) => (typeof valor === 'string'
  ? { archivo: valor, saltoFinal: false }
  : { archivo: valor.archivo, saltoFinal: valor.saltoFinal === true });

/** Lo mismo, en la forma más corta que lo representa. */
const compactar = ({ archivo, saltoFinal }) => (saltoFinal ? { archivo, saltoFinal: true } : archivo);

/** El contenido que va al JSON, leído del archivo del módulo según la convención del salto final. */
function contenidoDeModulo(ruta, saltoFinal) {
  if (!existsSync(ruta)) throw new Error(`falta el módulo ${ruta}`);
  const t = readFileSync(ruta, 'utf8');
  if (saltoFinal) return t;
  if (!t.endsWith('\n')) throw new Error(`${ruta}: el archivo de un módulo termina en un salto de línea`);
  return t.slice(0, -1);
}

/** El archivo del módulo a partir del contenido del JSON, y si lleva la marca `saltoFinal`. */
function archivoDeContenido(contenido, donde) {
  if (contenido.endsWith('\n\n')) {
    throw new Error(`${donde}: el contenido termina en dos saltos de línea y un archivo no puede conservarlos`);
  }
  const saltoFinal = contenido.endsWith('\n');
  return { texto: saltoFinal ? contenido : contenido + '\n', saltoFinal };
}

/**
 * Recorre los puntos de inyección de un manifiesto sobre un JSON parseado y
 * llama a `visitar({ nodo, campo, leer, escribir, ruta, saltoFinal, clave })`
 * por cada uno. `leer()` devuelve el valor actual en el JSON; `escribir(v)` lo
 * reemplaza EN SITIO, sin crear claves nuevas.
 */
function recorrer(j, manifiesto, raiz, visitar) {
  const c = carpetas(raiz);
  const porNombre = new Map(j.nodes.map((n) => [n.name, n]));
  const nodoDe = (nombre, seccion) => {
    const n = porNombre.get(nombre);
    if (!n) {
      throw new Error(`${manifiesto.flujo}: la sección "${seccion}" del manifiesto nombra el nodo «${nombre}» `
        + 'y el JSON no lo tiene. Si se renombró en n8n, renómbrelo también en '
        + `${rutaDeManifiesto(manifiesto.flujo, raiz)}.`);
    }
    return n;
  };
  for (const [nombre, valor] of Object.entries(manifiesto.codigo ?? {})) {
    const n = nodoDe(nombre, 'codigo');
    if (n.type !== TIPO_CODE) throw new Error(`${manifiesto.flujo}: «${nombre}» no es un nodo Code (${n.type})`);
    const e = entrada(valor);
    visitar({
      nodo: n, campo: 'jsCode', clave: `codigo/${nombre}`, ...e, ruta: join(c.src, e.archivo),
      leer: () => n.parameters.jsCode,
      escribir: (v) => { n.parameters.jsCode = v; },
      anotar: (nuevaEntrada) => { manifiesto.codigo[nombre] = compactar(nuevaEntrada); },
    });
  }
  for (const [nombre, campos] of Object.entries(manifiesto.prompts ?? {})) {
    const n = nodoDe(nombre, 'prompts');
    if (n.type !== TIPO_AGENTE) throw new Error(`${manifiesto.flujo}: «${nombre}» no es un agente (${n.type})`);
    for (const campo of ['systemMessage', 'text']) {
      if (!(campo in campos)) continue;
      const e = entrada(campos[campo]);
      const leer = campo === 'text' ? () => n.parameters.text : () => n.parameters.options?.systemMessage;
      if (typeof leer() !== 'string') {
        throw new Error(`${manifiesto.flujo}: «${nombre}» no tiene el campo ${campo} en el JSON`);
      }
      visitar({
        nodo: n, campo, clave: `prompts/${nombre}.${campo}`, ...e, ruta: join(c.prompts, e.archivo),
        leer,
        escribir: campo === 'text'
          ? (v) => { n.parameters.text = v; }
          : (v) => { n.parameters.options.systemMessage = v; },
        anotar: (nuevaEntrada) => { campos[campo] = compactar(nuevaEntrada); },
      });
    }
  }
  for (const [nombre, prefijo] of Object.entries(manifiesto.conservanMarcadores ?? {})) {
    const n = nodoDe(nombre, 'conservanMarcadores');
    if (!JSON.stringify(n.parameters).includes(prefijo)) {
      throw new Error(`${manifiesto.flujo}: «${nombre}» tenía que conservar valores ${prefijo}* y no tiene ninguno`);
    }
  }
}

/**
 * Ensambla un flujo en memoria: el JSON del disco con los módulos inyectados.
 * Sin manifiesto devuelve el texto del archivo tal cual (`conManifiesto: false`).
 */
export function ensamblarEnMemoria(archivoFlujo, raiz = RAIZ_FLUJOS) {
  const rutaJson = join(carpetas(raiz).flujos, archivoFlujo);
  const original = readFileSync(rutaJson, 'utf8');
  const manifiesto = leerManifiesto(archivoFlujo, raiz);
  if (!manifiesto) return { archivo: archivoFlujo, texto: original, original, conManifiesto: false };
  const j = JSON.parse(original);
  const inyectados = [];
  recorrer(j, manifiesto, raiz, ({ clave, ruta, saltoFinal, escribir }) => {
    escribir(contenidoDeModulo(ruta, saltoFinal));
    inyectados.push(clave);
  });
  return { archivo: archivoFlujo, texto: JSON.stringify(j, null, 2) + '\n', original, conManifiesto: true, inyectados };
}

/**
 * Compara byte a byte lo ensamblado con el archivo. Devuelve
 * `{ estado: 'sin-manifiesto' | 'identico' | 'difiere', diferencias }`, donde
 * `diferencias` nombra los puntos de inyección cuyo contenido no coincide.
 */
export function verificarFlujo(archivoFlujo, raiz = RAIZ_FLUJOS) {
  const r = ensamblarEnMemoria(archivoFlujo, raiz);
  if (!r.conManifiesto) return { archivo: archivoFlujo, estado: 'sin-manifiesto', diferencias: [] };
  if (Buffer.from(r.texto, 'utf8').equals(Buffer.from(r.original, 'utf8'))) {
    return { archivo: archivoFlujo, estado: 'identico', diferencias: [], inyectados: r.inyectados };
  }
  // Qué punto de inyección difiere, para no dejar a nadie con un «difiere» a secas.
  const manifiesto = leerManifiesto(archivoFlujo, raiz);
  const diferencias = [];
  recorrer(JSON.parse(r.original), manifiesto, raiz, ({ clave, ruta, saltoFinal, leer }) => {
    if (leer() !== contenidoDeModulo(ruta, saltoFinal)) diferencias.push(clave);
  });
  return { archivo: archivoFlujo, estado: 'difiere', diferencias, inyectados: r.inyectados };
}

/** Escribe el JSON ensamblado si cambia. Devuelve `true` si escribió. */
export function ensamblarFlujo(archivoFlujo, raiz = RAIZ_FLUJOS) {
  const r = ensamblarEnMemoria(archivoFlujo, raiz);
  if (!r.conManifiesto || r.texto === r.original) return false;
  writeFileSync(join(carpetas(raiz).flujos, archivoFlujo), r.texto);
  return true;
}

/** El manifiesto inicial de un flujo: un archivo por nodo Code y por campo de agente, bajo `carpeta`. */
export function manifiestoInicial(archivoFlujo, carpeta, raiz = RAIZ_FLUJOS) {
  const j = JSON.parse(readFileSync(join(carpetas(raiz).flujos, archivoFlujo), 'utf8'));
  const m = { flujo: archivoFlujo, conservanMarcadores: {}, codigo: {}, prompts: {} };
  for (const n of j.nodes) {
    if (JSON.stringify(n.parameters).includes('REEMPLAZAR_')) m.conservanMarcadores[n.name] = 'REEMPLAZAR_';
    if (n.type === TIPO_CODE && typeof n.parameters.jsCode === 'string') {
      m.codigo[n.name] = `${carpeta}/${slug(n.name)}.js`;
    } else if (n.type === TIPO_AGENTE) {
      const p = {};
      if (typeof n.parameters.options?.systemMessage === 'string') p.systemMessage = `${carpeta}/${slug(n.name)}.md`;
      if (typeof n.parameters.text === 'string') p.text = `${carpeta}/${slug(n.name)}.turno.md`;
      if (Object.keys(p).length) m.prompts[n.name] = p;
    }
  }
  return m;
}

/**
 * La inversa: del JSON a los módulos. Con manifiesto, escribe cada módulo con
 * lo que el JSON tiene hoy y ajusta las marcas `saltoFinal`; sin manifiesto,
 * hace falta `nuevo` (la carpeta) para crearlo primero. Devuelve las rutas
 * escritas y los avisos (un módulo compartido que cambia de contenido).
 */
export function extraerFlujo(archivoFlujo, { raiz = RAIZ_FLUJOS, nuevo = null } = {}) {
  let manifiesto = leerManifiesto(archivoFlujo, raiz);
  if (!manifiesto) {
    if (!nuevo) throw new Error(`${archivoFlujo} no tiene manifiesto; use --nuevo <carpeta> para crearlo`);
    manifiesto = manifiestoInicial(archivoFlujo, nuevo, raiz);
  }
  const j = JSON.parse(readFileSync(join(carpetas(raiz).flujos, archivoFlujo), 'utf8'));
  const escritos = [];
  const avisos = [];
  recorrer(j, manifiesto, raiz, ({ clave, ruta, leer, anotar, archivo }) => {
    const { texto, saltoFinal } = archivoDeContenido(leer(), clave);
    if (existsSync(ruta) && readFileSync(ruta, 'utf8') !== texto) {
      avisos.push(`${archivo} cambia de contenido (${clave}); si otro flujo lo comparte, su verificación va a fallar`);
    }
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, texto);
    anotar({ archivo, saltoFinal });
    escritos.push(ruta);
  });
  escritos.push(escribirManifiesto(manifiesto, raiz));
  return { escritos, avisos, manifiesto };
}

// ---------------------------------------------------------------------------
// Línea de comandos
// ---------------------------------------------------------------------------
function principal(argv) {
  const [comando, ...resto] = argv;
  const opcion = (n) => { const i = resto.indexOf(`--${n}`); return i >= 0 ? resto[i + 1] : null; };
  const archivos = resto.filter((a, i) => !a.startsWith('--') && resto[i - 1] !== '--nuevo');
  const lista = archivos.length ? archivos.map((a) => a.replace(/^.*\//, '')) : listarFlujos();

  if (comando === 'verificar') {
    let fallas = 0;
    for (const a of lista) {
      const r = verificarFlujo(a);
      if (r.estado === 'sin-manifiesto') console.log(`  · ${a}: sin manifiesto, idéntico por definición`);
      else if (r.estado === 'identico') console.log(`  ✓ ${a}: idéntico (${r.inyectados.length} puntos de inyección)`);
      else { fallas++; console.log(`  ✗ ${a}: difiere en ${r.diferencias.join(', ') || 'algo fuera de los puntos de inyección'}`); }
    }
    console.log(fallas ? `\n${fallas} flujo(s) no coinciden con sus módulos.` : '\nTodos los flujos coinciden con sus módulos.');
    return fallas ? 1 : 0;
  }
  if (comando === 'ensamblar') {
    for (const a of lista) console.log(`  ${ensamblarFlujo(a) ? '✎' : '='} ${a}`);
    return 0;
  }
  if (comando === 'extraer') {
    if (archivos.length !== 1) { console.error('extraer toma exactamente un flujo'); return 2; }
    const r = extraerFlujo(lista[0], { nuevo: opcion('nuevo') });
    for (const e of r.escritos) console.log(`  ✎ ${e}`);
    for (const v of r.avisos) console.log(`  ! ${v}`);
    return 0;
  }
  console.error('Uso: ensamblar-flujo.mjs verificar|ensamblar [flujo.json ...]  |  extraer <flujo.json> [--nuevo <carpeta>]');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exit(principal(process.argv.slice(2)));
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
