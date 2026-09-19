/**
 * =============================================================================
 * SINCRONIZAR EL FLUJO DE UN CLIENTE CON SU VERTICAL (Demo A → cliente)
 * =============================================================================
 *
 * POR QUÉ EXISTE. Cada cliente de reservas es una COPIA del Demo A con sus
 * datos (`Config base`), su prompt y sus credenciales. «Un cambio se aplica a
 * todos o a ninguno» (CLAUDE.md): cuando el vertical gana un nodo, una
 * conexión o una línea de código, el cliente tiene que ganarla igual, y su
 * suite (`bellido-flujo.test.ts`, `platinum-flujo.test.ts`) lo exige nodo por
 * nodo. Hasta el 18/09/2026 eso se hacía a mano, cliente por cliente, y el
 * alta del Dr. Bellido dejó a la vista lo que pasa cuando no: un nodo que en
 * el vertical no fusionaba `instruccionesExtra` (#110).
 *
 * QUÉ HACE. Toma el vertical y el cliente y reconstruye el cliente así:
 *   - los nodos son los del vertical (id, tipo, versión, posición, opciones
 *     de error y reintento, notas), en el mismo orden;
 *   - los PARÁMETROS son los del vertical, salvo en los nodos PROPIOS del
 *     cliente (`Config base`, el agente, las herramientas de calendario y el
 *     aviso a recepción), que conservan los del cliente;
 *   - en `Config base` se agregan las asignaciones que el vertical tiene y el
 *     cliente no (siempre nacen vacías en el vertical: son respaldos);
 *   - las CREDENCIALES son las del cliente donde el nodo ya existía; en un
 *     nodo nuevo se toman por TIPO de otro nodo del cliente (la ingesta y el
 *     envío llevan el nombre propio del cliente con id vacío; Gemini y
 *     Calendar van vacías y `publicar-flujo.sh` las hereda por tipo);
 *   - las conexiones y los settings son EXACTAMENTE los del vertical;
 *   - el nombre del flujo es el del cliente.
 *
 * LO QUE NO PUEDE HACER, y lo dice: si el vertical cambió un nodo PROPIO
 * (una regla nueva en el prompt, una expresión nueva en `agendar_cita`), el
 * cliente no la recibe sola. El informe lista esos nodos con las líneas que
 * el vertical tiene y el cliente no, para que una persona (o la suite del
 * cliente) las porte a conciencia.
 *
 * UN CLIENTE PUEDE TENER NODOS PROPIOS (el 18/09/2026 el Dr. Bellido estrenó
 * 19: menú inicial, contacto directo, emergencia, redes). Para distinguirlos de
 * lo que el vertical quitó hace falta `--base`: la versión del vertical desde
 * la que se armó el cliente que hay en disco. Sus nodos se conservan tal cual, y
 * sus dos formas de empalme se recomponen sobre el vertical de hoy.
 *
 *   node scripts/sincronizar-flujo-cliente.mjs \
 *     --vertical ../Flujos/demo-a-agendamiento.json \
 *     --cliente ../Flujos/bellido-agendamiento.json \
 *     --base origin/main [--aplicar]
 *
 * Sin `--aplicar` no escribe nada: informa qué cambiaría.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const VERTICAL = opcion('vertical');
const CLIENTE = opcion('cliente');
/**
 * La versión del VERTICAL desde la que se armó el cliente que hay en disco: una
 * referencia de git (`origin/main`, un commit) o una ruta. Sin ella, todo nodo
 * del cliente que no esté en el vertical se toma por sobrante y se quita. CON
 * ella, se distingue lo que el cliente AGREGÓ —sus nodos propios y sus dos
 * empalmes— de lo que el vertical quitó, y lo agregado se conserva.
 */
const BASE = opcion('base');
if (!VERTICAL || !CLIENTE) {
  console.error('\n  node scripts/sincronizar-flujo-cliente.mjs --vertical <json> --cliente <json> [--base <ref|json>] [--aplicar]\n');
  process.exit(2);
}

/**
 * Los nodos cuyos parámetros son del cliente. Es la misma lista que declaran
 * las suites de cliente (`PARAMETROS_QUE_PUEDEN_CAMBIAR`); si una suite la
 * amplía, se amplía acá. `Config del negocio` NO está: desde #110 es código
 * del vertical, letra por letra.
 */
const PROPIOS = new Set([
  'Config base', 'AI Agent (Sofía)', 'agendar_cita', 'consultar_disponibilidad',
  'buscar_mi_cita', 'cancelar_cita', 'Avisar a recepción',
  // El consultorio del Dr. Bellido enciende la vista previa del enlace de Maps
  // en la confirmación (18/09). Es un parámetro del envío, no lógica.
  'Responder al cliente',
]);
/** Lo que viaja con el nodo además de `parameters`, tal cual del vertical. */
const META = ['id', 'name', 'type', 'typeVersion', 'position', 'onError', 'retryOnFail',
  'maxTries', 'waitBetweenTries', 'alwaysOutputData', 'notes', 'notesInFlow', 'executeOnce',
  'disabled', 'continueOnFail'];

const leer = (p) => JSON.parse(readFileSync(p, 'utf8'));
/** Una referencia de git (`origin/main`, un commit) o una ruta en el disco. */
const leerBase = (ref, ruta) => {
  try { return leer(ref); } catch { /* no es una ruta: se prueba como referencia */ }
  return JSON.parse(execFileSync('git', ['show', `${ref}:${ruta}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
};
const vertical = leer(VERTICAL);
const cliente = leer(CLIENTE);
const base = BASE ? leerBase(BASE, VERTICAL) : null;
/**
 * LOS NODOS PROPIOS DEL CLIENTE: los que no están ni en el vertical de hoy ni
 * en el de la base. Son suyos (el menú inicial del Dr. Bellido, su emergencia,
 * sus redes) y se conservan tal cual, con sus conexiones.
 */
const delVertical = new Set(vertical.nodes.map((n) => n.name));
const deLaBase = new Set((base?.nodes ?? []).map((n) => n.name));
const nodosDelCliente = base
  ? cliente.nodes.filter((n) => !delVertical.has(n.name) && !deLaBase.has(n.name))
  : [];
const esDelCliente = new Set(nodosDelCliente.map((n) => n.name));
const delCliente = new Map(cliente.nodes.map((n) => [n.name, n]));

// Credencial por TIPO, tomada de los nodos que el cliente ya tiene.
const credPorTipo = new Map();
for (const n of cliente.nodes) {
  for (const [tipo, ref] of Object.entries(n.credentials ?? {})) {
    if (!credPorTipo.has(tipo)) credPorTipo.set(tipo, ref);
  }
}

const informe = { nuevos: [], quitados: [], codigo: [], propiosDistintos: [], credenciales: [],
  configBase: [], propiosDelCliente: [], empalmes: [] };

const nodos = vertical.nodes.map((v) => {
  const c = delCliente.get(v.name);
  const nodo = {};
  for (const k of META) if (v[k] !== undefined) nodo[k] = v[k];

  if (c && PROPIOS.has(v.name)) {
    nodo.parameters = c.parameters;
    if (v.name === 'Config base') {
      // Las asignaciones nuevas del vertical entran con su valor de respaldo.
      const mias = new Set((c.parameters?.assignments?.assignments ?? []).map((a) => a.name));
      for (const a of v.parameters?.assignments?.assignments ?? []) {
        if (!mias.has(a.name)) {
          nodo.parameters.assignments.assignments.push(a);
          informe.configBase.push(a.name);
        }
      }
    } else if (JSON.stringify(c.parameters) !== JSON.stringify(v.parameters)) {
      informe.propiosDistintos.push(v.name);
    }
  } else {
    if (c && JSON.stringify(c.parameters) !== JSON.stringify(v.parameters)) informe.codigo.push(v.name);
    nodo.parameters = v.parameters;
  }

  if (c?.credentials) {
    nodo.credentials = c.credentials;
  } else if (v.credentials) {
    nodo.credentials = {};
    for (const [tipo, ref] of Object.entries(v.credentials)) {
      const propia = credPorTipo.get(tipo);
      // Un nombre vacío en el vertical (Gemini, Calendar) se hereda por tipo al
      // publicar; uno con nombre (ingesta, envío) tiene que ser el del cliente.
      nodo.credentials[tipo] = propia ?? { id: '', name: ref?.name ? '' : '' };
      if (!propia && ref?.name) informe.credenciales.push(`${v.name}: sin credencial ${tipo} propia del cliente`);
    }
  }
  if (!c) informe.nuevos.push(v.name);
  return nodo;
});
for (const n of cliente.nodes) {
  if (!delVertical.has(n.name) && !esDelCliente.has(n.name)) informe.quitados.push(n.name);
}
for (const n of nodosDelCliente) { nodos.push(n); informe.propiosDelCliente.push(n.name); }

/**
 * LAS CONEXIONES: las del vertical, más lo que el cliente empalmó.
 *
 * Un empalme del cliente es una diferencia contra la BASE, y hay dos formas:
 *   - AGREGA un destino propio a una salida que ya existía (del envío cuelga
 *     además su compuerta de redes): se agrega al final de esa misma salida;
 *   - INTERCALA un nodo suyo DELANTE de otro (entre «¿Atención normal?» y el
 *     agente): entonces TODO camino que llegue a ese otro nodo pasa primero por
 *     el suyo, también los que el vertical agregó después (las compuertas de
 *     medios). Por eso el reemplazo se aplica a todas las entradas de ese nodo,
 *     salvo las que salen del subgrafo del propio cliente, que es lo que le
 *     devuelve el control al vertical.
 */
const conexiones = JSON.parse(JSON.stringify(vertical.connections));
const intercalados = new Map();   // destino del vertical -> nodo propio que va delante
if (base) {
  const rama = (c, src, tipo, i) => c?.[src]?.[tipo]?.[i]?.map((x) => x.node) ?? null;
  for (const [src, salidas] of Object.entries(cliente.connections ?? {})) {
    if (esDelCliente.has(src)) { conexiones[src] = salidas; continue; }
    for (const [tipo, ramas] of Object.entries(salidas)) {
      ramas.forEach((r, i) => {
        const antes = rama(base.connections, src, tipo, i);
        const ahora = r.map((x) => x.node);
        if (!antes || JSON.stringify(antes) === JSON.stringify(ahora)) return;
        const agregados = ahora.filter((d) => !antes.includes(d) && esDelCliente.has(d));
        const quitados = antes.filter((d) => !ahora.includes(d));
        if (agregados.length === 1 && quitados.length === 1) {
          intercalados.set(quitados[0], agregados[0]);
          informe.empalmes.push(`${agregados[0]} va delante de ${quitados[0]} (toda entrada)`);
          return;
        }
        if (agregados.length && !quitados.length) {
          const destino = conexiones[src]?.[tipo]?.[i];
          if (!destino) { informe.empalmes.push(`✗ ${src}[${i}] ya no existe en el vertical: el empalme se perdió`); return; }
          for (const d of agregados) destino.push({ node: d, type: tipo, index: 0 });
          informe.empalmes.push(`${agregados.join(', ')} cuelga(n) de ${src}[${i}]`);
          return;
        }
        informe.empalmes.push(`✗ ${src}[${i}] cambió de una forma que no sé componer: base=${antes} cliente=${ahora}`);
      });
    }
  }
  for (const [destino, propio] of intercalados) {
    for (const [src, salidas] of Object.entries(conexiones)) {
      if (esDelCliente.has(src)) continue;   // el subgrafo del cliente sí llega al destino
      // SOLO el cableado `main`: los sub-nodos (el modelo, la memoria, las
      // herramientas) se enganchan al agente por `ai_*` y ahí no se intercala
      // nada. Redirigirlos dejaba al agente sin modelo.
      for (const r of salidas['main'] ?? []) {
        for (const x of r ?? []) if (x.node === destino) x.node = propio;
      }
    }
  }
}

const resultado = { ...cliente, name: cliente.name, nodes: nodos, connections: conexiones, settings: vertical.settings };

// Las líneas del prompt del vertical que el cliente no tiene: es lo que hay
// que portar a mano (una regla nueva, una marca nueva).
const prompt = (f) => String(f.nodes.find((n) => PROPIOS.has(n.name) && n.type.endsWith('.agent'))?.parameters?.options?.systemMessage ?? '');
const lineasFaltantes = prompt(vertical).split('\n').filter((l) => l.trim() && !prompt(cliente).includes(l.trim()));

console.log(`\n  Vertical : ${VERTICAL} (${vertical.nodes.length} nodos)`);
console.log(`  Cliente  : ${CLIENTE} (${cliente.nodes.length} nodos) → ${nodos.length} nodos\n`);
const lista = (t, xs) => { if (xs.length) console.log(`  ${t}:\n    ${xs.join('\n    ')}`); };
lista('Nodos nuevos que entran del vertical', informe.nuevos);
lista('Nodos del cliente que ya no existen en el vertical (se quitan)', informe.quitados);
lista('Nodos PROPIOS del cliente, que se conservan con sus conexiones', informe.propiosDelCliente);
lista('Empalmes del cliente, recompuestos sobre el vertical de hoy', informe.empalmes);
lista('Nodos comunes cuyo código o parámetros se reponen del vertical', informe.codigo);
lista('Config base: asignaciones nuevas con su valor de respaldo', informe.configBase);
lista('Credenciales que no se pudieron resolver', informe.credenciales);
lista('NODOS PROPIOS que difieren del vertical (revisar a mano si el vertical cambió algo ahí)', informe.propiosDistintos);
if (lineasFaltantes.length) {
  console.log(`\n  Líneas del prompt del vertical que el cliente NO tiene (portar a mano si son reglas nuevas):`);
  for (const l of lineasFaltantes) console.log(`    · ${l.slice(0, 140)}`);
}
if (!APLICAR) { console.log('\n  Seco: no se escribió nada. Agregue --aplicar.\n'); process.exit(0); }
writeFileSync(CLIENTE, JSON.stringify(resultado, null, 2) + '\n', 'utf8');
console.log(`\n  ✓ ${CLIENTE} reescrito con ${nodos.length} nodos.\n`);
