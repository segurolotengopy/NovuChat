/**
 * RESETEAR UNA FICHA DE PRUEBA EN EL staticData DE UN FLUJO DE n8n — seco por omisión.
 *
 * PARA QUÉ. Para volver a probar un flujo "como cliente nuevo" hay que borrar lo que el flujo recuerda de UN teléfono de prueba (memoria,
 * etapa, barreras de dos turnos). Esto borra SOLO, dentro de `staticData` (a cualquier profundidad): las claves iguales al teléfono y los
 * objetos con `from` igual al teléfono (también dentro de listas). Un teléfono distinto, aunque comparta prefijo, no se toca.
 *
 * LISTA CERRADA. El repositorio es público: los teléfonos de prueba NO están en el código. Se leen de la variable de entorno
 * `TELEFONOS_PRUEBA` (dígitos separados por coma) y `--tel` tiene que estar en ella. Sin la variable, no corre.
 *
 *   (con N8N_BASE_URL, N8N_API_KEY y TELEFONOS_PRUEBA en el ENTORNO del proceso) node scripts/plataforma/resetear-ficha-flujo.mjs
 *        --workflow <id> --tel <dígitos> [--aplicar --respaldo <ruta absoluta> --confirmo-produccion <id del flujo>]
 *
 * SECO: informa cuántas entradas se borrarían y en qué contenedor (con los números del camino ocultos). Nunca imprime teléfonos ni contenido.
 * `--aplicar`: exige `--confirmo-produccion <id del flujo>` (igual a `--workflow`) y `--respaldo` (ruta absoluta, 0600, fuera de todo repositorio,
 * nunca se pisa: guarda el staticData COMPLETO). Relee justo antes de escribir y, si el flujo cambió, no escribe. Solo cambia `staticData`:
 * nodos, conexiones y ajustes se reescriben TAL CUAL. Verifica al releer y de nuevo tras una espera. No agrega ni quita mensajes.
 *
 * SALIDA. 0 hecho o nada que borrar; 1 el seco encontró entradas; 2 uso o salvaguarda; 3 error de ejecución.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { comprobarRespaldo, guardarRespaldo } from './aplicar-consola-conversaciones.mjs';

export const ESPERA_FINAL_MS = 60_000;
const CON_VALOR = ['workflow', 'tel', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar'];

export const USO = '  N8N_BASE_URL=… N8N_API_KEY=… TELEFONOS_PRUEBA=… node scripts/plataforma/resetear-ficha-flujo.mjs --workflow <id> --tel <dígitos> '
  + '[--aplicar --respaldo <ruta> --confirmo-produccion <id del flujo>]';

export function analizarArgumentos(argv, env = process.env, opciones = {}) {
  const problemas = [];
  const valores = { __proto__: null };
  const banderas = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string' || !a.startsWith('--')) { problemas.push('argumento suelto (sin su opción)'); continue; }
    const n = a.slice(2);
    if (BANDERAS.includes(n)) { if (banderas.includes(n)) problemas.push(`opción repetida: --${n}`); banderas.push(n); }
    else if (CON_VALOR.includes(n)) {
      if (n in valores) problemas.push(`opción repetida: --${n}`);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) { problemas.push(`--${n} sin valor`); continue; }
      valores[n] = v; i += 1;
    } else problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40)}`);
  }
  const aplicar = banderas.includes('aplicar');
  const { workflow, tel, respaldo } = valores;
  const confirmo = valores['confirmo-produccion'];
  if (workflow === undefined || !/^[A-Za-z0-9]{6,40}$/.test(workflow)) problemas.push('falta --workflow <id del flujo> (alfanumérico)');
  // Lista cerrada: viene del entorno (el repositorio es público). Sin ella no se corre; con ella, --tel tiene que estar adentro.
  const crudo = env.TELEFONOS_PRUEBA;
  let lista = [];
  if (typeof crudo !== 'string' || crudo.trim() === '') problemas.push('falta TELEFONOS_PRUEBA en el entorno (lista cerrada de teléfonos de prueba, dígitos separados por coma)');
  else {
    lista = crudo.split(',').map((s) => s.trim());
    if (lista.some((s) => !/^\d{8,15}$/.test(s))) { problemas.push('TELEFONOS_PRUEBA: solo dígitos (8 a 15) separados por coma'); lista = []; }
  }
  if (tel === undefined) problemas.push('falta --tel <dígitos>');
  else if (!/^\d{8,15}$/.test(tel)) problemas.push('--tel: solo dígitos (8 a 15)');
  else if (lista.length && !lista.includes(tel)) problemas.push('--tel no está en la lista cerrada de teléfonos de prueba');
  if (confirmo !== undefined && confirmo !== workflow) problemas.push('--confirmo-produccion no coincide con --workflow (se confirma con el id del flujo)');
  if (aplicar && confirmo === undefined) problemas.push('--aplicar exige --confirmo-produccion <id del flujo> (igual a --workflow)');
  if (aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta absoluta> (0600, fuera del repositorio)');
  if (typeof env.N8N_BASE_URL !== 'string' || env.N8N_BASE_URL === '' || typeof env.N8N_API_KEY !== 'string' || env.N8N_API_KEY === '') problemas.push('faltan N8N_BASE_URL o N8N_API_KEY en el entorno');
  let respaldoResuelto = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: false, permitirExistente: false });
    if (r.ok) respaldoResuelto = r.real; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { workflow, tel, aplicar, respaldo: respaldo ?? null, respaldoResuelto } };
}

const esObjeto = (v) => v !== null && typeof v === 'object';
/** Un segmento del camino que son solo dígitos podría ser el teléfono de otra persona: no se imprime. */
const segmento = (k) => (/^\d+$/.test(k) ? '#' : k.slice(0, 40));
const esFicha = (k, v, tel) => k === tel || (esObjeto(v) && !Array.isArray(v) && String(v.from) === tel);

/** Puro: del staticData a (nuevo staticData, cuántas entradas se borran y en qué contenedor). No muta la entrada. */
export function sinFicha(staticData, tel) {
  const nuevo = JSON.parse(JSON.stringify(staticData ?? {}));
  const porContenedor = {};
  const anotar = (ruta) => { const n = ruta.join('.') || '(raíz)'; porContenedor[n] = (porContenedor[n] ?? 0) + 1; };
  const recorrer = (o, ruta) => {
    if (Array.isArray(o)) {
      for (let i = o.length - 1; i >= 0; i--) {
        if (esFicha(String(i), o[i], tel) && String(i) !== tel) { anotar(ruta.concat('[]')); o.splice(i, 1); } else if (esObjeto(o[i])) recorrer(o[i], ruta.concat('[]'));
      }
      return;
    }
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (esFicha(k, v, tel)) { anotar(ruta); delete o[k]; } else if (esObjeto(v)) recorrer(v, ruta.concat(segmento(k)));
    }
  };
  if (esObjeto(nuevo)) recorrer(nuevo, []);
  const total = Object.values(porContenedor).reduce((a, b) => a + b, 0);
  return { nuevo, total, porContenedor };
}

/** Cuántas entradas del teléfono quedan (mismo criterio exacto que el borrado; no es una búsqueda de subcadena). */
export const quedan = (staticData, tel) => sinFicha(staticData, tel).total;

/**
 * deps = { leer(): Promise<flujo>, escribir(flujo, staticData): Promise<número HTTP>, esperar?(ms): Promise<void> }
 */
export async function ejecutar(cfg, deps, log = (t) => console.log(t)) {
  const vivo = await deps.leer();
  const r = sinFicha(vivo.staticData, cfg.tel);
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)'} · flujo «${String(vivo.name).slice(0, 60)}» activo=${vivo.active} nodos=${vivo.nodes?.length}`);
  log(`  entradas del teléfono que se borrarían: ${r.total}`);
  for (const [c, n] of Object.entries(r.porContenedor)) log(`    ${c}: ${n}`);
  if (r.total === 0) { log('\n  ✓ Nada que borrar.\n'); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar --respaldo <ruta> --confirmo-produccion <id del flujo>.\n'); return 1; }
  // El GET y el PUT no son atómicos y el PUT reemplaza TODO el staticData: si una conversación escribió entre ambos, se perdería.
  const justo = await deps.leer();
  const huella = (f) => JSON.stringify([f.staticData, f.nodes, f.connections, f.settings, f.active]);
  if (huella(justo) !== huella(vivo)) {
    log('\n  ✗ El flujo cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correrlo con poco tráfico.\n'); return 3;
  }
  try {
    guardarRespaldo(cfg.respaldo, { version: 1, campo: 'resetear-ficha-flujo', workflow: cfg.workflow, creadoEn: new Date().toISOString(), staticData: vivo.staticData ?? {} });
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa. No se escribe nada.\n'); return 2; }
    throw e;
  }
  log(`\n  Respaldo del staticData completo (datos de personas, se borra al cerrar): ${cfg.respaldo}`);
  const http = await deps.escribir(vivo, r.nuevo);
  const despues = await deps.leer();
  const restantes = quedan(despues.staticData, cfg.tel);
  const nodosIguales = JSON.stringify(despues.nodes) === JSON.stringify(vivo.nodes)
    && JSON.stringify(despues.connections) === JSON.stringify(vivo.connections) && JSON.stringify(despues.settings) === JSON.stringify(vivo.settings);
  const sigueActivo = despues.active === vivo.active;
  log(`  PUT HTTP ${http} · entradas restantes=${restantes} · nodos, conexiones y ajustes iguales=${nodosIguales} · activo=${despues.active}`);
  if (!sigueActivo) { log(`\n  ✗ El flujo quedó ${despues.active ? 'activo' : 'DESACTIVADO'} y estaba ${vivo.active ? 'activo' : 'desactivado'}: reactívelo y revise. El respaldo permite reponer el estado.\n`); return 3; }
  if (restantes !== 0 || !nodosIguales) { log('\n  ✗ La verificación no coincide: revise el flujo; el respaldo permite reponer el estado.\n'); return 3; }
  // Una ejecución que empezó ANTES del PUT y termina después guarda su propio staticData y puede reponer la ficha: se espera y se relee.
  if (deps.esperar) await deps.esperar(ESPERA_FINAL_MS);
  const tarde = await deps.leer();
  if (quedan(tarde.staticData, cfg.tel) !== 0) { log('\n  ✗ Tras la espera, la ficha reapareció (una ejecución en curso repuso el estado): corra el script de nuevo con poco tráfico.\n'); return 3; }
  log('\n  ✓ Ficha borrada y releída (también tras la espera). El resto del flujo y del estado no cambió.\n');
  return 0;
}

async function principal() {
  const a = analizarArgumentos(process.argv.slice(2));
  if (!a.ok) { console.error(`\n  ✗ ${a.problemas.join('\n  ✗ ')}\n\n${USO}\n`); process.exit(2); }
  const { cfg } = a;
  // La dirección y la clave vienen del ENTORNO del proceso. La dirección se valida: solo https (o esta misma máquina), sin credenciales ni ruta.
  let origen;
  try { origen = new URL(process.env.N8N_BASE_URL ?? ''); } catch { throw Object.assign(new Error('url'), { code: 'n8n-url-invalida' }); }
  const local = origen.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origen.hostname);
  if ((origen.protocol !== 'https:' && !local) || origen.username || origen.password) throw Object.assign(new Error('url'), { code: 'n8n-sin-https' });
  const BASE = origen.origin;
  const cab = { [['X', 'N8N', 'API', 'KEY'].join('-')]: process.env.N8N_API_KEY, 'Content-Type': 'application/json' };
  const llamar = async (metodo, cuerpo) => {
    const r = await fetch(`${BASE}/api/v1/workflows/${cfg.workflow}`, { method: metodo, headers: cab, body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw Object.assign(new Error('n8n'), { code: `n8n-${metodo}-${r.status}` });
    return { status: r.status, json: await r.json() };
  };
  const codigo = await ejecutar(cfg, {
    leer: async () => (await llamar('GET')).json,
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
    escribir: async (vivo, staticData) => (await llamar('PUT', { name: vivo.name, nodes: vivo.nodes, connections: vivo.connections, settings: vivo.settings ?? {}, staticData })).status,
  });
  process.exit(codigo);
}

function seEjecutaDirecto() {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}
if (seEjecutaDirecto()) {
  try { await principal(); } catch (e) { console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`); process.exit(3); }
}
