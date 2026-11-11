/**
 * RESETEAR UNA FICHA DE PRUEBA EN EL staticData DE UN FLUJO DE n8n — seco por omisión.
 *
 * PARA QUÉ. Para volver a probar un flujo "como cliente nuevo" hay que borrar lo que el flujo recuerda de UN teléfono de prueba (memoria,
 * etapa, barreras de dos turnos). Esto borra SOLO, dentro de `staticData` (a cualquier profundidad): las claves iguales al teléfono y los
 * objetos con `from` igual al teléfono (también dentro de listas). Un teléfono distinto, aunque comparta prefijo, no se toca.
 *
 * FORMA DE LA CLAVE. Espera el teléfono completo en dígitos, tal cual lo guarda el flujo (`messages[0].from`). Formas distintas (+591…, c_591…,
 * solo los 8 últimos dígitos, el teléfono suelto en una lista) no se borran: se informan como «posibles restos» (sin imprimirlos) y el resultado
 * dice ⚠ en vez de ✓. No se entra en la ficha de otro teléfono ni se borra un contenedor entero por su `from`.
 *
 * LISTA CERRADA. El repositorio es público: los teléfonos de prueba NO están en el código. Se leen de la variable de entorno
 * `TELEFONOS_PRUEBA` (dígitos separados por coma) y `--tel` tiene que estar en ella. Sin la variable, no corre. La lista la declara el operador:
 * solo protege de errores de tipeo, no es una barrera contra quien controla el entorno.
 *
 *   (con N8N_BASE_URL, N8N_API_KEY y TELEFONOS_PRUEBA en el ENTORNO del proceso) node scripts/plataforma/resetear-ficha-flujo.mjs
 *        --workflow <id> --tel <dígitos> [--aplicar --respaldo <ruta absoluta> --confirmo-produccion <id del flujo>]
 *
 * SECO: informa cuántas entradas se borrarían y en qué contenedor (con los números del camino ocultos). Nunca imprime teléfonos ni contenido.
 * `--aplicar`: exige `--confirmo-produccion <id del flujo>` (igual a `--workflow`) y `--respaldo` (ruta absoluta, 0600, fuera de la copia de trabajo o en una carpeta ignorada por git,
 * nunca se pisa: guarda el staticData COMPLETO). Relee justo antes de escribir y, si el flujo cambió, no escribe. Solo cambia `staticData`:
 * nodos, conexiones y ajustes se reescriben TAL CUAL. Verifica al releer y de nuevo tras una espera. AVISO: un PUT sobre un flujo activo puede reiniciar sus webhooks; córralo con poco tráfico. Si sale con 3, la ficha pudo reaparecer o una conversación escribió justo en medio: revise y reponga desde el respaldo. No agrega ni quita mensajes.
 *
 * SALIDA. 0 hecho o nada que borrar; 1 el seco encontró entradas; 2 uso o salvaguarda; 3 error de ejecución.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { comprobarRespaldo, guardarRespaldo } from './aplicar-consola-conversaciones.mjs';

export const ESPERA_FINAL_MS = 150_000; // más que la ejecución más larga del flujo, como vaciar-memoria-flujo
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
/** Un segmento del camino puede traer un teléfono (también en claves mixtas, p. ej. «tel_…»): toda secuencia de 6+ dígitos sale como #. */
const segmento = (k) => k.replace(/\d{6,}/g, '#').slice(0, 40);
/** Una clave de teléfono completo (solo dígitos): la ficha de ALGUIEN; si no es la del teléfono pedido, no se entra ni se toca. */
const esClaveDeTelefono = (k) => /^\d{8,}$/.test(k);
export const canon = (v) => JSON.stringify(v, (_k, x) => (esObjeto(x) && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/** Valida la dirección de n8n: https (o http solo en esta misma máquina), sin credenciales, ruta, consulta ni fragmento. Pura. */
export function validarBaseUrl(valor) {
  let u;
  try { u = new URL(valor ?? ''); } catch { return { ok: false, codigo: 'n8n-url-invalida' }; }
  const local = u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if ((u.protocol !== 'https:' && !local) || u.username || u.password) return { ok: false, codigo: 'n8n-sin-https' };
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return { ok: false, codigo: 'n8n-url-con-ruta' };
  return { ok: true, origen: u.origin };
}

/**
 * Puro: del staticData a (nuevo staticData, cuántas entradas se borran y en qué contenedor). No muta la entrada.
 * Qué forma de clave espera: el teléfono COMPLETO en dígitos, tal cual lo guarda el flujo (`messages[0].from`, sin «+» ni prefijo), ya sea como
 * clave de un mapa de fichas o como `from` de un objeto. Otras formas (+591…, c_591…, solo los 8 últimos dígitos, el teléfono suelto en una
 * lista) NO se borran: se informan como «posibles restos» (`restos`) para que el operador las revise.
 * Reglas de seguridad: (1) se borra por clave solo dentro de un contenedor (nunca una clave de la raíz del staticData); (2) se borra por
 * `from` solo un VALOR de un mapa o un ELEMENTO de una lista a profundidad 2 o más (nunca `global` ni `node:*`) y nunca un objeto que
 * guarde fichas de otros (con claves de teléfono): borraría un contenedor entero; (3) no se entra en la ficha de OTRO teléfono (clave de
 * teléfono distinta, o `from` distinto), porque lo que haya adentro es de ese otro.
 */
export function sinFicha(staticData, tel) {
  const nuevo = JSON.parse(JSON.stringify(staticData ?? {}));
  const porContenedor = {};
  const anotar = (ruta) => { const n = ruta.join('.') || '(raíz)'; porContenedor[n] = (porContenedor[n] ?? 0) + 1; };
  const guardaFichas = (o) => esObjeto(o) && !Array.isArray(o) && Object.keys(o).some(esClaveDeTelefono);
  const deTelefono = (v) => esObjeto(v) && !Array.isArray(v) && 'from' in v && String(v.from) === tel && !guardaFichas(v);
  const deOtro = (k, v) => (esClaveDeTelefono(k) && k !== tel) || (esObjeto(v) && !Array.isArray(v) && 'from' in v && String(v.from) !== tel);
  // `prof` es la profundidad del contenedor `o` (la raíz es 0; `global` es 1).
  const recorrer = (o, ruta, prof) => {
    if (Array.isArray(o)) {
      for (let i = o.length - 1; i >= 0; i--) {
        if (prof >= 1 && deTelefono(o[i])) { anotar(ruta.concat('[]')); o.splice(i, 1); } else if (esObjeto(o[i]) && !deOtro('', o[i])) recorrer(o[i], ruta.concat('[]'), prof + 1);
      }
      return;
    }
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (prof >= 1 && k === tel) { anotar(ruta); delete o[k]; } else if (prof >= 1 && prof + 1 >= 2 && deTelefono(v)) { anotar(ruta); delete o[k]; } else if (esObjeto(v) && !deOtro(k, v)) recorrer(v, ruta.concat(segmento(k)), prof + 1);
    }
  };
  if (esObjeto(nuevo)) recorrer(nuevo, [], 0);
  const total = Object.values(porContenedor).reduce((a, b) => a + b, 0);
  const sufijo = tel.slice(-8);
  let restos = 0;
  const buscar = (o) => {
    for (const k of Array.isArray(o) ? o.keys() : Object.keys(o)) {
      const v = o[k];
      if (String(k).includes(sufijo) && !Array.isArray(o)) restos += 1;
      if (esObjeto(v)) buscar(v); else if (typeof v === 'string' || typeof v === 'number') { if (String(v).includes(sufijo)) restos += 1; }
    }
  };
  if (esObjeto(nuevo)) buscar(nuevo);
  return { nuevo, total, porContenedor, restos };
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
  log(`  posibles restos (otra forma de clave, no se borran): ${r.restos}`);
  if (r.total === 0) { log(r.restos > 0 ? '\n  ⚠ Nada que borrar con el teléfono exacto, pero hay posibles restos: revíselos.\n' : '\n  ✓ Nada que borrar.\n'); return 0; }
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
  // Todo lo que no está en los caminos borrados tiene que seguir IGUAL (como `igualRestoDeGlobal` de vaciar-memoria-flujo).
  const restoIgual = canon(despues.staticData ?? {}) === canon(r.nuevo);
  const nodosIguales = JSON.stringify(despues.nodes) === JSON.stringify(vivo.nodes)
    && JSON.stringify(despues.connections) === JSON.stringify(vivo.connections) && JSON.stringify(despues.settings) === JSON.stringify(vivo.settings);
  const sigueActivo = despues.active === vivo.active;
  log(`  PUT HTTP ${http} · entradas restantes=${restantes} · resto del estado igual=${restoIgual} · nodos, conexiones y ajustes iguales=${nodosIguales} · activo=${despues.active}`);
  if (!sigueActivo) { log(`\n  ✗ El flujo quedó ${despues.active ? 'activo' : 'DESACTIVADO'} y estaba ${vivo.active ? 'activo' : 'desactivado'}: reactívelo y revise. El respaldo permite reponer el estado.\n`); return 3; }
  if (restantes !== 0 || !nodosIguales || !restoIgual) { log('\n  ✗ La verificación no coincide: revise el flujo; el respaldo permite reponer el estado.\n'); return 3; }
  // Una ejecución que empezó ANTES del PUT y termina después guarda su propio staticData y puede reponer la ficha: se espera y se relee.
  if (deps.esperar) await deps.esperar(ESPERA_FINAL_MS);
  const tarde = await deps.leer();
  if (quedan(tarde.staticData, cfg.tel) !== 0) { log('\n  ✗ Tras la espera, la ficha reapareció (una ejecución en curso repuso el estado): corra el script de nuevo con poco tráfico.\n'); return 3; }
  log(r.restos > 0 ? `\n  ⚠ Ficha exacta borrada y releída, pero quedan ${r.restos} posibles restos (otra forma de clave): revíselos.\n` : '\n  ✓ Ficha borrada y releída (también tras la espera). El resto del flujo y del estado no cambió.\n');
  return 0;
}

async function principal() {
  const a = analizarArgumentos(process.argv.slice(2));
  if (!a.ok) { console.error(`\n  ✗ ${a.problemas.join('\n  ✗ ')}\n\n${USO}\n`); process.exit(2); }
  const { cfg } = a;
  // La dirección y la clave vienen del ENTORNO del proceso. La dirección se valida (validarBaseUrl): solo https (o esta misma máquina), sin credenciales, ruta, consulta ni fragmento.
  const v = validarBaseUrl(process.env.N8N_BASE_URL);
  if (!v.ok) throw Object.assign(new Error('url'), { code: v.codigo });
  const BASE = v.origen;
  const cab = { [['X', 'N8N', 'API', 'KEY'].join('-')]: process.env.N8N_API_KEY, 'Content-Type': 'application/json' };
  const llamar = async (metodo, cuerpo) => {
    const r = await fetch(`${BASE}/api/v1/workflows/${cfg.workflow}`, { method: metodo, headers: cab, redirect: 'error', body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(60000) });
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
export const AVISO_UNICO = '\n  ! Hay UN solo reseteo de un teléfono de prueba (Andres, 07/11/2026): `node scripts/plataforma/resetear-telefono-prueba.mjs --proyecto <id> --tenant <tenant> --tel <dígitos>` limpia ficha de n8n, sesiones, cupos, cobro/QR pendiente, atención y pausa Tomar, y dice ESTADO LIMPIO. Este script ya no se usa para eso.\n';
if (seEjecutaDirecto()) {
  console.error(AVISO_UNICO);
  process.exit(2);
  try { await principal(); } catch (e) { console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`); process.exit(3); }
}
