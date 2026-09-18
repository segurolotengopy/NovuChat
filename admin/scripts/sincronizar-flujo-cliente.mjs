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
 *   node scripts/sincronizar-flujo-cliente.mjs \
 *     --vertical ../Flujos/demo-a-agendamiento.json \
 *     --cliente ../Flujos/bellido-agendamiento.json [--aplicar]
 *
 * Sin `--aplicar` no escribe nada: informa qué cambiaría.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const VERTICAL = opcion('vertical');
const CLIENTE = opcion('cliente');
if (!VERTICAL || !CLIENTE) {
  console.error('\n  node scripts/sincronizar-flujo-cliente.mjs --vertical <json> --cliente <json> [--aplicar]\n');
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
]);
/** Lo que viaja con el nodo además de `parameters`, tal cual del vertical. */
const META = ['id', 'name', 'type', 'typeVersion', 'position', 'onError', 'retryOnFail',
  'maxTries', 'waitBetweenTries', 'alwaysOutputData', 'notes', 'notesInFlow', 'executeOnce',
  'disabled', 'continueOnFail'];

const leer = (p) => JSON.parse(readFileSync(p, 'utf8'));
const vertical = leer(VERTICAL);
const cliente = leer(CLIENTE);
const delCliente = new Map(cliente.nodes.map((n) => [n.name, n]));

// Credencial por TIPO, tomada de los nodos que el cliente ya tiene.
const credPorTipo = new Map();
for (const n of cliente.nodes) {
  for (const [tipo, ref] of Object.entries(n.credentials ?? {})) {
    if (!credPorTipo.has(tipo)) credPorTipo.set(tipo, ref);
  }
}

const informe = { nuevos: [], quitados: [], codigo: [], propiosDistintos: [], credenciales: [], configBase: [] };

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
for (const n of cliente.nodes) if (!vertical.nodes.some((v) => v.name === n.name)) informe.quitados.push(n.name);

const resultado = { ...cliente, name: cliente.name, nodes: nodos, connections: vertical.connections, settings: vertical.settings };

// Las líneas del prompt del vertical que el cliente no tiene: es lo que hay
// que portar a mano (una regla nueva, una marca nueva).
const prompt = (f) => String(f.nodes.find((n) => PROPIOS.has(n.name) && n.type.endsWith('.agent'))?.parameters?.options?.systemMessage ?? '');
const lineasFaltantes = prompt(vertical).split('\n').filter((l) => l.trim() && !prompt(cliente).includes(l.trim()));

console.log(`\n  Vertical : ${VERTICAL} (${vertical.nodes.length} nodos)`);
console.log(`  Cliente  : ${CLIENTE} (${cliente.nodes.length} nodos) → ${nodos.length} nodos\n`);
const lista = (t, xs) => { if (xs.length) console.log(`  ${t}:\n    ${xs.join('\n    ')}`); };
lista('Nodos nuevos que entran del vertical', informe.nuevos);
lista('Nodos del cliente que ya no existen en el vertical (se quitan)', informe.quitados);
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
