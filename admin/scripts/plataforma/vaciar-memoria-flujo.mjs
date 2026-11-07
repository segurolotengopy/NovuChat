/**
 * VACIAR LA MEMORIA DE UN FLUJO DE n8n (solo `staticData.global.<clave>`) — seco por omisión.
 *
 * PARA QUÉ. El flujo de un comercio guarda por teléfono su memoria y su ficha (historial, etapa, pedidos, QR abierto) en
 * `staticData.global.<clave>`; para Rubén la clave es `rroca`. Si el comercio cambió su libro, un historial viejo puede ofrecer lo anterior
 * hasta 48 h. Esto borra SOLO esa clave (o las fichas que terminan en los sufijos dados), y opcionalmente los topes por hora y los
 * números extranjeros de la misma familia (`rrTopes`, `rrExtranjeros`; caducan solos, normalmente se dejan).
 *
 * NO usar `publicar-flujo.sh --reiniciar-estado` para esto: reemplaza TODO el staticData y borraría también esas claves y las fichas que no son de prueba.
 *
 *   (con N8N_BASE_URL y N8N_API_KEY en el ENTORNO del proceso, no en un archivo que el script lea) node scripts/plataforma/vaciar-memoria-flujo.mjs --workflow <id> --clave rroca
 *        (--todas-las-fichas | --sufijos 12345678,87654321) [--con-topes]
 *        [--aplicar --respaldo <ruta absoluta> --confirmo-produccion <id del flujo>]
 *
 * SECO: informa cuántas fichas hay, cuántas se borrarían, cuántas tienen pedidos o un QR abierto (cobro real: un pedido a medias pierde su
 * contexto y el contador del id de pedido vuelve a empezar). Nunca imprime teléfonos (solo los 4 últimos dígitos cuando hay pocas) ni contenido.
 * `--aplicar`: exige `--confirmo-produccion <id del flujo>` (igual a `--workflow`) y `--respaldo` (ruta absoluta, 0600, fuera de todo repositorio, nunca se pisa: guarda el
 * staticData COMPLETO, por si hay que reponerlo). Relee justo antes de escribir y, si el flujo cambió, no escribe. Solo cambia `staticData`:
 * nodos, conexiones y ajustes se reescriben TAL CUAL. Relee al final y verifica que no se perdió nada más. El PUT sobre un flujo activo puede
 * reiniciar sus webhooks: aplicarlo con poco tráfico. Lista cerrada de claves: `rroca` (el flujo del libro anterior de Rubén) y `ruben` (el flujo nuevo «Noches Sin Insomnio»: `staticData.global.ruben`, mapa teléfono → ficha, con `riesgo` y `riesgoMs` de la protección de crisis de 48 h).
 *
 * SALIDA. 0 hecho o nada que borrar; 1 el seco encontró fichas; 2 uso o salvaguarda; 3 error de ejecución.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { comprobarRespaldo, guardarRespaldo } from './aplicar-consola-conversaciones.mjs';

export const CLAVES = Object.freeze(['rroca', 'ruben']);
export const ESPERA_FINAL_MS = 150_000;
/** Claves hermanas que solo se borran con --con-topes (por clave). */
const TOPES = Object.freeze({ rroca: ['rrTopes', 'rrExtranjeros'] });
const CON_VALOR = ['workflow', 'clave', 'sufijos', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'todas-las-fichas', 'con-topes'];

export const USO = '  N8N_BASE_URL=… N8N_API_KEY=… node scripts/plataforma/vaciar-memoria-flujo.mjs --workflow <id> --clave rroca (--todas-las-fichas | --sufijos a,b) [--con-topes] '
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
  const todas = banderas.includes('todas-las-fichas');
  const conTopes = banderas.includes('con-topes');
  const { workflow, clave, respaldo } = valores;
  const confirmo = valores['confirmo-produccion'];
  if (workflow === undefined || !/^[A-Za-z0-9]{6,40}$/.test(workflow)) problemas.push('falta --workflow <id del flujo> (alfanumérico)');
  if (clave === undefined || !CLAVES.includes(clave)) problemas.push(`--clave tiene que ser una de: ${CLAVES.join(', ')}`);
  let sufijos = [];
  if (valores.sufijos !== undefined) {
    sufijos = valores.sufijos.split(',');
    if (!sufijos.length || sufijos.some((s) => !/^\d{8}$/.test(s)) || new Set(sufijos).size !== sufijos.length) problemas.push('--sufijos: los 8 dígitos finales de cada teléfono, distintos, separados por coma');
  }
  if (todas === (valores.sufijos !== undefined)) problemas.push('indique exactamente una: --todas-las-fichas o --sufijos <a,b>');
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
  return { ok: true, cfg: { workflow, clave, todas, sufijos, conTopes, aplicar, respaldo: respaldo ?? null, respaldoResuelto } };
}

/** Puro: del staticData a (nuevo staticData, qué se borra). No muta la entrada. */
export function sinFichas(staticData, cfg, ahoraMs = Date.now()) {
  const sd = JSON.parse(JSON.stringify(staticData ?? {}));
  const mapa = sd.global?.[cfg.clave];
  if (mapa === undefined || mapa === null || typeof mapa !== 'object' || Array.isArray(mapa)) return { ok: false, motivo: `no hay staticData.global.${cfg.clave}: no se toca nada` };
  const claves = Object.keys(mapa);
  for (const s of cfg.sufijos) {
    const n = claves.filter((k) => k.endsWith(s)).length;
    if (n > 1) return { ok: false, motivo: `el sufijo …${s.slice(-4)} coincide con ${n} fichas: es ambiguo, no se toca nada` };
  }
  const objetivo = cfg.todas ? claves : claves.filter((k) => cfg.sufijos.some((s) => k.endsWith(s)));
  let conPedidos = 0; let conQr = 0;
  for (const k of objetivo) {
    const f = mapa[k];
    if (f && typeof f === 'object') {
      if ((Array.isArray(f.pedidos) && f.pedidos.length) || (f.pedidos && typeof f.pedidos === 'object' && Object.keys(f.pedidos).length)) conPedidos += 1;
      if (typeof f.qrHastaMs === 'number' && f.qrHastaMs > ahoraMs) conQr += 1;
    }
    delete mapa[k];
  }
  const hermanas = [];
  if (cfg.conTopes) for (const h of TOPES[cfg.clave] ?? []) if (sd.global && h in sd.global) { delete sd.global[h]; hermanas.push(h); }
  return { ok: true, nuevo: sd, total: claves.length, aBorrar: objetivo.length, conservadas: claves.length - objetivo.length, conPedidos, conQr, hermanas, objetivo };
}

/**
 * deps = { leer(): Promise<flujo>, escribir(flujo, staticData): Promise<número HTTP>, esperar?(ms): Promise<void> }
 */
export async function ejecutar(cfg, deps, log = (t) => console.log(t)) {
  const vivo = await deps.leer();
  const r = sinFichas(vivo.staticData, cfg);
  if (!r.ok) { log(`\n  ✗ ${r.motivo}\n`); return 2; }
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)'} · flujo «${String(vivo.name).slice(0, 60)}» activo=${vivo.active} nodos=${vivo.nodes?.length}`);
  log(`  fichas en ${cfg.clave}        : ${r.total}`);
  log(`  se borrarían             : ${r.aBorrar}${cfg.todas ? ' (todas)' : ''}`);
  log(`  se conservan             : ${r.conservadas}`);
  log(`  con pedidos guardados    : ${r.conPedidos}   con QR abierto: ${r.conQr}   (cobro real: decida antes)`);
  log(`  topes/extranjeros        : ${cfg.conTopes ? `se borran (${r.hermanas.join(', ') || 'no había'})` : 'se conservan'}`);
  if (r.aBorrar === 0 && r.hermanas.length === 0) { log('\n  ✓ Nada que borrar.\n'); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar --respaldo <ruta> --confirmo-produccion <id del flujo>.\n'); return 1; }
  // El GET y el PUT no son atómicos y el PUT reemplaza TODO el staticData: si una conversación escribió su ficha entre ambos, se perdería.
  const justo = await deps.leer();
  const huella = (f) => JSON.stringify([f.staticData, f.nodes, f.connections, f.settings, f.active]);
  if (huella(justo) !== huella(vivo)) {
    log('\n  ✗ El flujo cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correrlo con poco tráfico.\n'); return 3;
  }
  try {
    guardarRespaldo(cfg.respaldo, { version: 1, campo: 'vaciar-memoria-flujo', clave: cfg.clave, workflow: cfg.workflow, creadoEn: new Date().toISOString(), staticData: vivo.staticData ?? {} });
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa. No se escribe nada.\n'); return 2; }
    throw e;
  }
  log(`\n  Respaldo del staticData completo (datos de personas, se borra al cerrar): ${cfg.respaldo}`);
  const http = await deps.escribir(vivo, r.nuevo);
  const despues = await deps.leer();
  const m2 = despues.staticData?.global?.[cfg.clave] ?? {};
  const esperado = r.conservadas;
  const igualRestoDeGlobal = Object.keys(vivo.staticData.global ?? {}).filter((k) => k !== cfg.clave && !(cfg.conTopes && (TOPES[cfg.clave] ?? []).includes(k)))
    .every((k) => JSON.stringify(despues.staticData.global?.[k]) === JSON.stringify(vivo.staticData.global[k]));
  const nodosIguales = JSON.stringify(despues.nodes) === JSON.stringify(vivo.nodes);
  const sigueActivo = despues.active === vivo.active;
  log(`  PUT HTTP ${http} · fichas ahora=${Object.keys(m2).length} (esperadas ${esperado}) · resto del estado igual=${igualRestoDeGlobal} · nodos iguales=${nodosIguales} · activo=${despues.active}`);
  if (!sigueActivo) { log(`\n  ✗ El flujo quedó ${despues.active ? 'activo' : 'DESACTIVADO'} y estaba ${vivo.active ? 'activo' : 'desactivado'}: reactívelo y revise. El respaldo permite reponer el estado.\n`); return 3; }
  if (Object.keys(m2).length !== esperado || !igualRestoDeGlobal || !nodosIguales) { log('\n  ✗ La verificación no coincide: revise el flujo; el respaldo permite reponer el estado.\n'); return 3; }
  // Una ejecución que empezó ANTES del PUT y termina después guarda su propio staticData y puede reponer las fichas viejas: se espera más que la ejecución más larga y se relee.
  if (deps.esperar) await deps.esperar(ESPERA_FINAL_MS);
  const tarde = (await deps.leer()).staticData?.global?.[cfg.clave] ?? {};
  if (r.objetivo.some((k) => k in tarde)) { log('\n  ✗ Tras la espera, las fichas reaparecieron (una ejecución en curso repuso el estado): corra el script de nuevo con poco tráfico.\n'); return 3; }
  log('\n  ✓ Fichas borradas y releídas (también tras la espera). El resto del flujo y del estado no cambió.\n');
  return 0;
}

async function principal() {
  const a = analizarArgumentos(process.argv.slice(2));
  if (!a.ok) { console.error(`\n  ✗ ${a.problemas.join('\n  ✗ ')}\n\n${USO}\n`); process.exit(2); }
  const { cfg } = a;
  // La dirección y la clave vienen del ENTORNO del proceso (no se leen de un archivo). La dirección se valida: solo https (o esta misma máquina), sin credenciales ni ruta.
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
