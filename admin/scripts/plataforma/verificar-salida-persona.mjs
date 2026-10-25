/**
 * VERIFICAR LA «SALIDA DE PERSONA» DE UN NÚMERO — SOLO LECTURA.
 *
 * QUÉ ES. Antes de encender `tenants/{id}.personaPuedeEscribir` (el botón «Tomar» de la consola), la
 * salida de lo que escribe una persona tiene que estar COMPLETA de punta a punta: la ruta del número en
 * Firestore, el timbre en Secret Manager, las Functions activas y el flujo n8n «Salida de persona» de ese
 * alias, publicado y con sus credenciales. Hoy eso se comprobaba a mano en cinco lugares. Este script lo
 * comprueba por comercio y dice SÍ o NO por cada eslabón, sin mostrar nunca un valor.
 *
 *   node scripts/plataforma/verificar-salida-persona.mjs --proyecto <id> --alias <clienteNN> --tenant <id> \
 *        [--env <archivo>] [--probar-timbre] \
 *        [--encender [--aplicar --respaldo <ruta> --confirmo-produccion <tenant>]]
 *
 * CHEQUEOS (cada uno: OK / FALLA / NO SE PUDO, con una línea de porqué sin datos sensibles):
 *   1a ruta del número (`rutasWhatsApp`)        1b ficha del comercio
 *   2  secreto `SALIDA_PERSONA_RUTAS` (versión fijada de la Function)
 *   3  las cinco Functions ACTIVE
 *   4a flujo n8n activo y publicado  4b credenciales por rol y tipo  4c ingesta distinta de envío
 *   4d el timbre coincide con la ruta del secreto  4e phoneNumberId del flujo = id de la ruta
 *   5a ejecuciones recientes sin error  5b sin 401 de reclamarSalidaPersona (10 min)
 *   6  (solo con --probar-timbre) clave equivocada => 403
 * Los chequeos 1 a 4 son OBLIGATORIOS para `--encender`; 5 y 6 informan.
 *
 * SOLO LECTURA. Cero escrituras en Firestore, n8n y Secret Manager. Las únicas llamadas con efecto son
 * (a) `--probar-timbre`: UN POST sin datos con la clave EQUIVOCADA (nunca la correcta: podría disparar un
 * envío real) y (b) `--encender`, que NO escribe aquí: invoca `aplicar-persona-puede-escribir.mjs`
 * (EN SECO si no se pasa `--aplicar`) con todas sus salvaguardas, sin duplicar su lógica.
 *
 * SECRETOS. El secreto se lee EN MEMORIA dentro de este proceso (como `rotar-ingesta.sh`) y de él solo
 * sale un booleano. Nunca se imprime la ruta, la clave, el id del proyecto, la clave de la API de n8n ni
 * una parte de ellas: todos los mensajes son texto fijo.
 *
 * SALIDA. 0: todo OK (y, con --encender, el seco o la escritura terminaron bien). 1: hay FALLAs.
 * 2: uso o salvaguarda (Bellido, proyecto fuera de la lista blanca). 3: error de ejecución, o no se pudo
 * verificar algo (NO SE PUDO) y nada falló. Un NO SE PUDO nunca cuenta como OK.
 *
 * COSTO. Lecturas: 1 consulta + 1 documento de Firestore, 2 a 3 llamadas a gcloud, 3 a 5 GET a n8n.
 * 0 mensajes por conversación.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esTenantExcluido, nombreExcluido, ID_TENANT } from './aplicar-consola-conversaciones.mjs';
import { comprobarProyecto } from './aplicar-consola-oculta.mjs';

export const OK = 'OK';
export const FALLA = 'FALLA';
export const NO_SE_PUDO = 'NO SE PUDO';

const REGION = 'us-east1';
const SECRETO = 'SALIDA_PERSONA_RUTAS';
export const FUNCIONES = Object.freeze(['enviarComoPersona', 'tomarConversacion', 'devolverConversacion', 'reclamarSalidaPersona', 'confirmarSalidaPersona']);
const ALIAS = /^[A-Za-z][A-Za-z0-9]{1,29}$/;
const CLAVE_MINIMA = 8;
const VENTANA_EJECUCIONES_MS = 60 * 60_000;
const ESPERA_MS = 30_000;
const CON_VALOR = ['proyecto', 'alias', 'tenant', 'env', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['probar-timbre', 'encender', 'aplicar'];

export const USO = '  node scripts/plataforma/verificar-salida-persona.mjs --proyecto <id> --alias <clienteNN> --tenant <id> [--env <archivo>] '
  + '[--probar-timbre] [--encender [--aplicar --respaldo <ruta> --confirmo-produccion <tenant>]]';

export const nombreDelFlujo = (alias) => `NovuChat — Salida de persona (${alias})`;
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const hay = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

// ===========================================================================
// ARGUMENTOS (puros)
// ===========================================================================
export function analizarArgumentos(argv, env = process.env) {
  const problemas = [];
  const valores = { __proto__: null };
  const banderas = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string' || !a.startsWith('--')) { problemas.push('argumento suelto (sin su opción)'); continue; }
    const nombre = a.slice(2);
    if (BANDERAS.includes(nombre)) {
      if (banderas.includes(nombre)) problemas.push(`opción repetida: --${nombre}`);
      banderas.push(nombre);
    } else if (CON_VALOR.includes(nombre)) {
      if (nombre in valores) problemas.push(`opción repetida: --${nombre}`);
      const valor = argv[i + 1];
      if (valor === undefined || valor.startsWith('--')) { problemas.push(`--${nombre} sin valor`); continue; }
      valores[nombre] = valor;
      i += 1;
    } else {
      problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40).replace(/[^\w-]/g, '?')}`);
    }
  }
  const encender = banderas.includes('encender');
  const aplicar = banderas.includes('aplicar');
  const probarTimbre = banderas.includes('probar-timbre');
  const { proyecto, alias, tenant, respaldo } = valores;
  const confirmo = valores['confirmo-produccion'];

  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto === undefined) problemas.push('falta --proyecto');
  else if (!proy.ok) problemas.push(proy.motivo);

  if (alias === undefined) problemas.push('falta --alias');
  else if (!ALIAS.test(alias)) problemas.push('--alias inválido (letras y dígitos, de 2 a 30, empieza con letra)');

  if (tenant === undefined) problemas.push('falta --tenant');
  else if (tenant.includes(',')) problemas.push('--tenant admite UN solo comercio por corrida (sin comas)');
  else if (!ID_TENANT.test(tenant)) problemas.push('--tenant inválido (minúsculas, dígitos y guiones, de 3 a 60)');
  else if (esTenantExcluido(tenant, env)) problemas.push('este comercio está EXCLUIDO (Bellido no se toca)');

  if (aplicar && !encender) problemas.push('--aplicar solo acompaña a --encender');
  if (!encender && (respaldo !== undefined || confirmo !== undefined)) problemas.push('--respaldo y --confirmo-produccion solo acompañan a --encender --aplicar');
  if (aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta>');
  if (encender && !aplicar && (respaldo !== undefined || confirmo !== undefined)) problemas.push('--respaldo y --confirmo-produccion solo se usan con --aplicar');
  if (aplicar && proy.ok && proy.entorno === 'produccion' && confirmo !== tenant) problemas.push('contra producción, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  if (confirmo !== undefined && proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');

  if (problemas.length) return { ok: false, problemas };
  return {
    ok: true,
    cfg: { proyecto, entorno: proy.entorno, alias, tenant, envArchivo: valores['env'] ?? null, probarTimbre, encender, aplicar, respaldo: respaldo ?? null, confirmo: confirmo ?? null },
  };
}

/** ¿El host es apto para recibir la clave de la API? https, ni IP literal ni localhost. */
export function hostAptoParaClave(base) {
  let u;
  try { u = new URL(base); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return false;
  if (h.includes(':') || h.startsWith('[')) return false; // IPv6 literal
  if (/^[0-9.]+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return false; // IPv4 literal (decimal, octal o hex)
  return true;
}

/**
 * Lee SOLO N8N_BASE_URL y N8N_API_KEY por nombre (sin ejecutar el archivo). Los DOS valores salen de la MISMA
 * fuente: el archivo `--env` si se pasó, o el entorno del proceso si no; nunca mezclados (si no, un `--env`
 * ajeno mandaría la clave real del entorno a otro host). Si falta uno o el host no es apto, devuelve vacíos.
 */
export function leerEntornoN8n(archivo, env = process.env) {
  let base = (env['N8N_BASE_URL'] ?? '').trim();
  let clave = (env['N8N_API_KEY'] ?? '').trim();
  if (archivo) {
    base = '';
    clave = '';
    const texto = readFileSync(archivo, 'utf8');
    const ultimo = (k) => texto.split('\n').filter((l) => l.startsWith(`${k}=`)).pop();
    const lb = ultimo('N8N_BASE_URL');
    const lc = ultimo('N8N_API_KEY');
    if (lb !== undefined) base = lb.slice('N8N_BASE_URL='.length).trim().replace(/^["']|["']$/g, '');
    if (lc !== undefined) clave = lc.slice('N8N_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  }
  const baseOk = /^https:\/\/[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{2,5})?$/.test(base) && hostAptoParaClave(base);
  const claveOk = /^[A-Za-z0-9._-]+$/.test(clave);
  return baseOk && claveOk ? { base, clave } : { base: '', clave: '' };
}

// ===========================================================================
// CHEQUEOS
// ===========================================================================
const res = (id, titulo, estado, motivo, extra = {}) => ({ id, titulo, estado, motivo, obligatorio: /^[1-4]/.test(id), ...extra });
const noSePudo = (id, titulo, motivo) => res(id, titulo, NO_SE_PUDO, motivo);

/** 1a y 1b. Devuelve también el id del documento de la ruta (es el phoneNumberId; no es un secreto, pero no se imprime). */
export async function chequeoFirestore(cfg, db, env = process.env) {
  const salida = { resultados: [], phoneId: null };
  let rutas;
  let ficha;
  try {
    rutas = await db.collection('rutasWhatsApp').where('aliasSecreto', '==', cfg.alias).get();
    ficha = await db.doc(`tenants/${cfg.tenant}`).get();
  } catch (e) {
    salida.resultados.push(noSePudo('1a', 'Ruta del número', `Firestore no respondió (${e?.code ?? e?.name ?? 'error'})`));
    salida.resultados.push(noSePudo('1b', 'Ficha del comercio', 'Firestore no respondió'));
    return salida;
  }
  // 1a
  const docs = rutas.docs ?? [];
  if (docs.length === 0) salida.resultados.push(res('1a', 'Ruta del número', FALLA, 'no existe una ruta con ese alias'));
  else if (docs.length > 1) salida.resultados.push(res('1a', 'Ruta del número', FALLA, 'hay más de una ruta con ese alias: no se elige una'));
  else {
    const d = docs[0].data() ?? {};
    const fallas = [];
    if (d.tenantId !== cfg.tenant) fallas.push('la ruta es de otro comercio');
    if (d.estado !== 'activo') fallas.push('la ruta no está activa');
    if (d.aliasSecreto !== cfg.alias) fallas.push('el alias no coincide');
    const canal = d.canalSalida;
    if (canal !== undefined && canal !== 'graph' && canal !== 'rele') fallas.push('canalSalida tiene un valor desconocido');
    if (fallas.length) salida.resultados.push(res('1a', 'Ruta del número', FALLA, fallas.join('; ')));
    else {
      salida.phoneId = docs[0].id;
      salida.resultados.push(res('1a', 'Ruta del número', OK, `tenant coincide, activa, alias coincide, canal de salida ${canal === 'rele' ? 'relé' : 'graph'}`,
        canal === 'rele' ? { aviso: 'el canal de salida es el relé, no graph: confirme que es lo deseado' } : {}));
    }
  }
  // 1b
  if (!ficha.exists) { salida.resultados.push(res('1b', 'Ficha del comercio', FALLA, 'no existe la ficha del comercio')); return salida; }
  const f = ficha.data() ?? {};
  const fallas = [];
  if (f.estado !== 'activo') fallas.push('el comercio no está activo');
  if (f.consolaConversaciones !== 'nueva') fallas.push('consolaConversaciones no es "nueva"');
  if (esTenantExcluido(cfg.tenant, env) || nombreExcluido(f.nombre, env)) fallas.push('comercio EXCLUIDO (Bellido)');
  const actual = hay(f, 'personaPuedeEscribir') ? (typeof f.personaPuedeEscribir === 'boolean' ? String(f.personaPuedeEscribir) : 'no booleano') : 'ausente';
  if (fallas.length) salida.resultados.push(res('1b', 'Ficha del comercio', FALLA, fallas.join('; ')));
  else salida.resultados.push(res('1b', 'Ficha del comercio', OK, `activo, consola nueva, no excluido; personaPuedeEscribir hoy: ${actual}`));
  return salida;
}

function ejecutarGcloud(deps, args) {
  try {
    const r = deps.gcloud(args);
    return r && r.code === 0 ? { ok: true, stdout: String(r.stdout ?? '') } : { ok: false, stdout: '' };
  } catch {
    return { ok: false, stdout: '' };
  }
}

/** 3. Las cinco Functions ACTIVE. Devuelve también la versión fijada del secreto en `enviarComoPersona`. */
export function chequeoFunciones(cfg, deps) {
  const salida = { resultado: null, versionSecreto: null, descripcion: null };
  const inactivas = [];
  let noLeidas = 0;
  for (const nombre of FUNCIONES) {
    const r = ejecutarGcloud(deps, ['functions', 'describe', nombre, '--gen2', '--region', REGION, '--project', cfg.proyecto, '--format=json']);
    let j = null;
    if (r.ok) { try { j = JSON.parse(r.stdout); } catch { j = null; } }
    if (!j) { noLeidas += 1; continue; }
    if (j.state !== 'ACTIVE') inactivas.push(nombre);
    if (nombre === 'enviarComoPersona') {
      salida.descripcion = j;
      const v = (j.serviceConfig?.secretEnvironmentVariables ?? []).find((x) => x?.key === SECRETO || x?.secret === SECRETO);
      salida.versionSecreto = typeof v?.version === 'string' && v.version !== '' ? v.version : null;
    }
  }
  if (inactivas.length) salida.resultado = res('3', 'Functions activas', FALLA, `no están ACTIVE: ${inactivas.join(', ')}`);
  else if (noLeidas) salida.resultado = noSePudo('3', 'Functions activas', `no pude leer ${noLeidas} de las ${FUNCIONES.length} Functions (gcloud)`);
  else salida.resultado = res('3', 'Functions activas', OK, `las ${FUNCIONES.length} están ACTIVE`);
  return salida;
}

function entradaDelAlias(texto, alias) {
  let m;
  try { m = JSON.parse(texto); } catch { return { ok: false, motivo: 'el secreto no es JSON' }; }
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return { ok: false, motivo: 'el secreto no es un objeto' };
  if (!hay(m, alias)) return { ok: false, motivo: 'el secreto no tiene la clave del alias' };
  const e = m[alias];
  if (e === null || typeof e !== 'object') return { ok: false, motivo: 'la entrada del alias no es un objeto' };
  return { ok: true, ruta: e.ruta, clave: e.clave };
}

/** 2. El secreto de la versión fijada. Devuelve la ruta (en memoria) para 4d y 6; nunca se imprime. */
export function chequeoSecreto(cfg, deps, versionFijada, base) {
  const salida = { resultado: null, ruta: null, hostAjeno: false };
  if (versionFijada === null) {
    salida.resultado = noSePudo('2', 'Secreto del timbre', 'no pude saber qué versión del secreto tiene fijada enviarComoPersona');
    return salida;
  }
  const leer = (version) => ejecutarGcloud(deps, ['secrets', 'versions', 'access', version, '--secret', SECRETO, '--project', cfg.proyecto]);
  const fijada = leer(versionFijada);
  if (!fijada.ok) { salida.resultado = noSePudo('2', 'Secreto del timbre', 'no pude leer la versión fijada del secreto'); return salida; }
  const e = entradaDelAlias(fijada.stdout, cfg.alias);
  if (!e.ok) { salida.resultado = res('2', 'Secreto del timbre', FALLA, e.motivo); return salida; }
  const fallas = [];
  let url = null;
  try { url = new URL(String(e.ruta)); } catch { url = null; }
  if (!url || url.protocol !== 'https:') fallas.push('la ruta no es https');
  if (typeof e.clave !== 'string' || e.clave.length < CLAVE_MINIMA) fallas.push(`la clave tiene menos de ${CLAVE_MINIMA} caracteres`);
  let hostOk = null;
  if (url && base) { hostOk = url.host === new URL(base).host; if (!hostOk) { fallas.push('el host de la ruta no es el de N8N_BASE_URL'); salida.hostAjeno = true; } }
  if (fallas.length) { salida.resultado = res('2', 'Secreto del timbre', FALLA, fallas.join('; ')); return salida; }
  salida.ruta = url.toString();
  const avisos = [];
  if (hostOk === null) avisos.push('no se pudo comparar el host (falta N8N_BASE_URL válido)');
  if (versionFijada !== 'latest') {
    const ultima = leer('latest');
    if (!ultima.ok) avisos.push('no pude leer latest para compararla');
    else {
      const u = entradaDelAlias(ultima.stdout, cfg.alias);
      const igual = u.ok && sha(u.ruta) === sha(e.ruta) && sha(u.clave) === sha(e.clave);
      if (!igual) avisos.push('la versión fijada DIFIERE de latest para este alias (un despliegue nuevo la cambiaría)');
    }
  }
  salida.resultado = res('2', 'Secreto del timbre', hostOk === null ? NO_SE_PUDO : OK,
    hostOk === null ? 'alias presente, ruta https y clave suficiente, pero no se pudo comparar el host con n8n'
      : 'alias presente, ruta https del host de n8n y clave suficiente',
    avisos.length ? { aviso: avisos.join('; ') } : {});
  return salida;
}

const nodoPor = (nodos, nombre) => nodos.find((n) => n?.name === nombre);
const credDe = (nodo) => {
  const c = nodo?.credentials;
  if (!c || typeof c !== 'object') return null;
  const tipos = Object.keys(c);
  if (tipos.length !== 1) return null;
  const ref = c[tipos[0]];
  return { tipo: tipos[0], id: String(ref?.id ?? ''), nombre: String(ref?.name ?? '') };
};

/** 4a a 4e, 5a. `n8n(ruta)` devuelve `{ status, json }` (solo GET). */
export async function chequeoN8n(cfg, n8n, rutaDelSecreto, phoneId, ahora = Date.now()) {
  const R = [];
  const todos = (motivo) => ['4a', '4b', '4c', '4d', '4e', '5a'].map((id) => noSePudo(id, TITULOS_N8N[id], motivo));
  let lista = [];
  let cursor = null;
  try {
    for (let pagina = 0; pagina < 10; pagina++) {
      const r = await n8n(`/workflows?limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (r.status !== 200 || !Array.isArray(r.json?.data)) return { resultados: todos(`n8n no respondió como se esperaba (HTTP ${r.status || 'sin respuesta'})`), flujoId: null };
      lista = lista.concat(r.json.data);
      cursor = r.json.nextCursor ?? null;
      if (!cursor) break;
    }
    if (cursor) return { resultados: todos('la lista de flujos de n8n no terminó en 10 páginas'), flujoId: null };
  } catch {
    return { resultados: todos('n8n no es accesible'), flujoId: null };
  }
  const nombre = nombreDelFlujo(cfg.alias);
  const coinciden = lista.filter((w) => w?.name === nombre);
  if (coinciden.length !== 1) {
    const m = coinciden.length === 0 ? 'no existe el flujo de este alias' : 'hay más de un flujo con ese nombre';
    return { resultados: [res('4a', TITULOS_N8N['4a'], FALLA, m), ...['4b', '4c', '4d', '4e'].map((id) => noSePudo(id, TITULOS_N8N[id], 'sin flujo que revisar')), noSePudo('5a', TITULOS_N8N['5a'], 'sin flujo que revisar')], flujoId: null };
  }
  let w;
  try {
    const r = await n8n(`/workflows/${encodeURIComponent(String(coinciden[0].id))}`);
    if (r.status !== 200 || !r.json || !Array.isArray(r.json.nodes)) return { resultados: todos(`no pude leer el flujo (HTTP ${r.status || 'sin respuesta'})`), flujoId: null };
    w = r.json;
  } catch {
    return { resultados: todos('n8n dejó de responder al leer el flujo'), flujoId: null };
  }
  const nodos = w.nodes;
  // 4a
  const f4a = [];
  if (w.active !== true) f4a.push('el flujo no está activo');
  if (typeof w.activeVersionId !== 'string' || w.activeVersionId === '') f4a.push('no hay versión publicada (activeVersionId)');
  else if (w.versionId !== w.activeVersionId) f4a.push('el borrador es distinto de la versión publicada (falta Publish)');
  R.push(f4a.length ? res('4a', TITULOS_N8N['4a'], FALLA, f4a.join('; ')) : res('4a', TITULOS_N8N['4a'], OK, 'existe una vez, activo y versionId igual a activeVersionId'));
  // 4b
  const esperado = [['Timbre', ['httpHeaderAuth']], ['Reclamar', ['httpHeaderAuth']], ['Confirmar', ['httpHeaderAuth']],
    ['Enviar por el relé', ['httpHeaderAuth']], ['Enviar por Graph', ['whatsAppApi', 'httpHeaderAuth']]];
  const f4b = [];
  const creds = {};
  for (const [nom, tipos] of esperado) {
    const n = nodoPor(nodos, nom);
    if (!n) { f4b.push(`falta el nodo ${nom}`); continue; }
    const c = credDe(n);
    if (!c || c.id === '' || c.nombre === '') f4b.push(`${nom} no tiene exactamente una credencial con id y nombre`);
    else if (!tipos.includes(c.tipo)) f4b.push(`${nom} usa una credencial de tipo inesperado`);
    else if (/REEMPLAZAR/.test(c.nombre)) f4b.push(`${nom} conserva un marcador sin reponer`);
    else creds[nom] = c;
  }
  const tipoEnvio = creds['Enviar por Graph']?.tipo;
  R.push(f4b.length ? res('4b', TITULOS_N8N['4b'], FALLA, f4b.join('; '))
    : res('4b', TITULOS_N8N['4b'], OK, `las cinco credenciales por nombre y tipo; tipo de la del rol envío: ${tipoEnvio}`, { tipoEnvio }));
  // 4c
  if (!creds['Reclamar'] || !creds['Confirmar'] || !creds['Enviar por Graph'] || !creds['Enviar por el relé']) R.push(noSePudo('4c', TITULOS_N8N['4c'], 'faltan credenciales que comparar (ver 4b)'));
  else {
    const ing = creds['Reclamar'];
    const f = [];
    if (creds['Confirmar'].id !== ing.id) f.push('Reclamar y Confirmar no usan la misma credencial de ingesta');
    for (const rol of ['Enviar por Graph', 'Enviar por el relé', 'Timbre']) {
      if (creds[rol] && (creds[rol].id === ing.id || creds[rol].nombre === ing.nombre)) f.push(`${rol} usa la credencial de ingesta`);
    }
    R.push(f.length ? res('4c', TITULOS_N8N['4c'], FALLA, f.join('; ')) : res('4c', TITULOS_N8N['4c'], OK, 'la credencial de ingesta no es la de envío, ni la del relé, ni la del timbre'));
  }
  // 4d
  const timbre = nodoPor(nodos, 'Timbre');
  const path = timbre?.parameters?.path;
  if (rutaDelSecreto === null) R.push(noSePudo('4d', TITULOS_N8N['4d'], 'sin la ruta del secreto (ver 2)'));
  else if (typeof path !== 'string' || path === '' || /REEMPLAZAR/.test(path)) R.push(res('4d', TITULOS_N8N['4d'], FALLA, 'el nodo Timbre no tiene un path real'));
  else {
    const cola = new URL(rutaDelSecreto).pathname.replace(/^\/webhook\//, '').replace(/^\/+|\/+$/g, '');
    const limpio = path.replace(/^\/+|\/+$/g, '');
    R.push(sha(cola) === sha(limpio) && new URL(rutaDelSecreto).pathname.startsWith('/webhook/')
      ? res('4d', TITULOS_N8N['4d'], OK, 'el path del Timbre coincide con la ruta del secreto (sha256 en memoria)')
      : res('4d', TITULOS_N8N['4d'], FALLA, 'el path del Timbre NO coincide con la ruta del secreto'));
  }
  // 4e
  const config = nodoPor(nodos, 'Config base');
  const asig = config?.parameters?.assignments?.assignments;
  const idFlujo = Array.isArray(asig) ? asig.find((a) => a?.name === 'phoneNumberId')?.value : undefined;
  if (phoneId === null) R.push(noSePudo('4e', TITULOS_N8N['4e'], 'sin el id de la ruta (ver 1a)'));
  else if (typeof idFlujo !== 'string' || idFlujo === '' || /REEMPLAZAR/.test(idFlujo)) R.push(res('4e', TITULOS_N8N['4e'], FALLA, 'Config base no tiene un phoneNumberId real'));
  else R.push(idFlujo === phoneId ? res('4e', TITULOS_N8N['4e'], OK, 'el phoneNumberId del flujo coincide con la ruta')
    : res('4e', TITULOS_N8N['4e'], FALLA, 'el phoneNumberId del flujo NO coincide con la ruta'));
  // 5a
  try {
    const r = await n8n(`/executions?workflowId=${encodeURIComponent(String(coinciden[0].id))}&limit=50`);
    if (r.status !== 200 || !Array.isArray(r.json?.data)) R.push(noSePudo('5a', TITULOS_N8N['5a'], `no pude leer las ejecuciones (HTTP ${r.status || 'sin respuesta'})`));
    else {
      const recientes = r.json.data.filter((x) => { const t = Date.parse(x?.startedAt ?? ''); return Number.isFinite(t) && ahora - t <= VENTANA_EJECUCIONES_MS; });
      const malas = recientes.filter((x) => x.status === 'error' || x.status === 'crashed').length;
      if (recientes.length === 0) R.push(noSePudo('5a', TITULOS_N8N['5a'], 'no hay ejecuciones en la última hora (el barrido corre cada minuto)'));
      else R.push(malas ? res('5a', TITULOS_N8N['5a'], FALLA, `${malas} de ${recientes.length} ejecuciones de la última hora terminaron en error`)
        : res('5a', TITULOS_N8N['5a'], OK, `${recientes.length} ejecuciones en la última hora, ninguna con error`));
    }
  } catch {
    R.push(noSePudo('5a', TITULOS_N8N['5a'], 'n8n dejó de responder al leer las ejecuciones'));
  }
  return { resultados: R, flujoId: coinciden[0].id };
}

const TITULOS_N8N = {
  '4a': 'Flujo n8n activo y publicado', '4b': 'Credenciales por rol y tipo', '4c': 'Ingesta distinta de envío',
  '4d': 'Timbre = ruta del secreto', '4e': 'phoneNumberId del flujo = ruta', '5a': 'Ejecuciones recientes sin error',
};

/** 5b. Solo conteos. Primero las solicitudes TOTALES (el barrido corre cada minuto): con 0 el filtro no sirve. */
export function chequeoLogs(cfg, deps) {
  const T = 'Sin 401 de reclamarSalidaPersona (10 min)';
  const base = 'resource.type="cloud_run_revision" AND resource.labels.service_name="reclamarsalidapersona" AND httpRequest.status>=100';
  const contar = (filtro) => {
    const r = ejecutarGcloud(deps, ['logging', 'read', filtro, '--project', cfg.proyecto, '--freshness=10m', '--limit=1000', '--format=json']);
    if (!r.ok) return null;
    try { const j = JSON.parse(r.stdout || '[]'); return Array.isArray(j) ? j.length : null; } catch { return null; }
  };
  const total = contar(base);
  if (total === null) return noSePudo('5b', T, 'Cloud Logging no es accesible o su respuesta no se entendió');
  if (total === 0) return noSePudo('5b', T, 'cero solicitudes totales en 10 minutos: el filtro o el servicio no coinciden (no se puede afirmar que no hay 401)');
  const n = contar(`${base} AND httpRequest.status=401`);
  if (n === null) return noSePudo('5b', T, 'no pude contar los 401');
  return n === 0 ? res('5b', T, OK, `cero 401 de ${total} solicitudes en los últimos 10 minutos`)
    : res('5b', T, FALLA, `${n} respuestas 401 de ${total} solicitudes en los últimos 10 minutos (la ingesta del flujo no autentica)`);
}

/** 6. Clave EQUIVOCADA => 403. Nunca la correcta. */
export async function chequeoTimbre(rutaDelSecreto, post) {
  const t = 'Timbre rechaza la clave equivocada';
  if (rutaDelSecreto === null) return noSePudo('6', t, 'sin la ruta del secreto (ver 2)');
  const falsa = `incorrecta-${randomBytes(12).toString('hex')}`;
  try {
    const status = await post(rutaDelSecreto, falsa);
    if (status === 403) return res('6', t, OK, 'respondió 403 a una clave equivocada');
    if (status === 200 || status === 201 || status === 204) return res('6', t, FALLA, 'el timbre ACEPTÓ una clave equivocada: está abierto');
    return res('6', t, FALLA, `respondió HTTP ${status} en vez de 403 (¿flujo inactivo o ruta distinta?)`);
  } catch {
    return noSePudo('6', t, 'el timbre no respondió');
  }
}

// ===========================================================================
// ORQUESTA
// ===========================================================================
/**
 * `deps`: `{ db, gcloud(args)->{code,stdout}, n8n(ruta)->{status,json}, n8nEntorno:{base,clave}, postTimbre(url,clave)->status,
 *            encender(args)->codigo, env, log, ahora }`. Devuelve el código de salida.
 */
export async function verificar(cfg, deps) {
  const log = deps.log ?? ((t) => console.log(t));
  const env = deps.env ?? process.env;
  if (esTenantExcluido(cfg.tenant, env)) { log('\n  ✗ Este comercio está EXCLUIDO (Bellido no se toca).\n'); return 2; }
  log(`\n  VERIFICAR SALIDA DE PERSONA (solo lectura) · ${cfg.entorno} · alias ${cfg.alias} · tenant ${cfg.tenant}\n`);

  const R = [];
  const fs = await chequeoFirestore(cfg, deps.db, env);
  R.push(...fs.resultados);
  const fn = chequeoFunciones(cfg, deps);
  const sec = chequeoSecreto(cfg, deps, fn.versionSecreto, deps.n8nEntorno?.base ?? '');
  R.push(sec.resultado, fn.resultado);

  let rN8n;
  if (!deps.n8nEntorno?.base || !deps.n8nEntorno?.clave) {
    rN8n = { resultados: ['4a', '4b', '4c', '4d', '4e', '5a'].map((id) => noSePudo(id, TITULOS_N8N[id], 'faltan N8N_BASE_URL o N8N_API_KEY válidas')) };
  } else if (sec.hostAjeno === true || (sec.ruta !== null && new URL(sec.ruta).host !== new URL(deps.n8nEntorno.base).host)) {
    rN8n = { resultados: ['4a', '4b', '4c', '4d', '4e', '5a'].map((id) => noSePudo(id, TITULOS_N8N[id], 'el host de N8N_BASE_URL no es el de la ruta del secreto: no se envía la clave de la API')) };
  } else {
    rN8n = await chequeoN8n(cfg, deps.n8n, sec.ruta, fs.phoneId, deps.ahora ?? Date.now());
  }
  R.push(...rN8n.resultados);
  R.push(chequeoLogs(cfg, deps));
  if (cfg.probarTimbre) R.push(await chequeoTimbre(sec.ruta, deps.postTimbre));

  R.sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const r of R) {
    log(`  [${r.estado.padEnd(10)}] ${r.id.padEnd(3)} ${r.titulo}: ${r.motivo}`);
    if (r.aviso) log(`                   aviso: ${r.aviso}`);
  }
  const hayFallas = R.some((r) => r.estado === FALLA);
  const hayNoPudo = R.some((r) => r.estado === NO_SE_PUDO);
  const obligatoriosOk = R.filter((r) => r.obligatorio).every((r) => r.estado === OK);
  log(`\n  Resumen: ${R.filter((r) => r.estado === OK).length} OK, ${R.filter((r) => r.estado === FALLA).length} FALLA, ${R.filter((r) => r.estado === NO_SE_PUDO).length} NO SE PUDO.`);
  let codigo = hayFallas ? 1 : hayNoPudo ? 3 : 0;

  if (cfg.encender) {
    if (!obligatoriosOk) {
      log('  --encender: NO se invoca nada, porque los chequeos obligatorios (1 a 4) no están todos en OK.\n');
      return codigo === 0 ? 1 : codigo;
    }
    log(`  --encender: los chequeos obligatorios están en OK; se invoca aplicar-persona-puede-escribir ${cfg.aplicar ? 'CON --aplicar' : 'EN SECO'}.\n`);
    const args = ['--proyecto', cfg.proyecto, '--tenant', cfg.tenant, '--valor', 'true'];
    if (cfg.aplicar) args.push('--aplicar', '--respaldo', cfg.respaldo, ...(cfg.confirmo ? ['--confirmo-produccion', cfg.confirmo] : []));
    const c = deps.encender(args);
    if (c === 0 || (c === 1 && !cfg.aplicar)) { /* el seco con un cambio pendiente (1) es lo esperado */ } else codigo = codigo === 0 ? (c === 2 ? 2 : 3) : codigo;
    log(`\n  aplicar-persona-puede-escribir terminó con salida ${c}.\n`);
  } else log('');
  return codigo;
}

// ===========================================================================
// PROCESO
// ===========================================================================
async function principal() {
  const analisis = analizarArgumentos(process.argv.slice(2));
  if (!analisis.ok) {
    console.error(`\n  ✗ ${analisis.problemas.join('\n  ✗ ')}\n\n${USO}\n`);
    process.exit(2);
  }
  const { cfg } = analisis;
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  const n8nEntorno = leerEntornoN8n(cfg.envArchivo);
  const aqui = dirname(fileURLToPath(import.meta.url));
  const deps = {
    db,
    n8nEntorno,
    gcloud: (args) => {
      const r = spawnSync('gcloud', [...args, '--quiet'], { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
      return { code: r.status ?? 1, stdout: r.stdout ?? '' };
    },
    n8n: async (ruta) => {
      try {
        const r = await fetch(`${n8nEntorno.base}/api/v1${ruta}`, { method: 'GET', headers: { 'X-N8N-API-KEY': n8nEntorno.clave, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(ESPERA_MS) });
        let json = null;
        try { json = await r.json(); } catch { json = null; }
        return { status: r.status, json };
      } catch { return { status: 0, json: null }; }
    },
    postTimbre: async (url, clave) => {
      const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${clave}` }, redirect: 'manual', signal: AbortSignal.timeout(ESPERA_MS) });
      return r.status;
    },
    encender: (args) => spawnSync(process.execPath, [join(aqui, 'aplicar-persona-puede-escribir.mjs'), ...args], { stdio: 'inherit', env: process.env }).status ?? 3,
  };
  const codigo = await verificar(cfg, deps);
  await db.terminate().catch(() => {});
  process.exit(codigo);
}

function seEjecutaDirecto() {
  try {
    return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (seEjecutaDirecto()) {
  try {
    await principal();
  } catch (e) {
    console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`);
    process.exit(3);
  }
}
