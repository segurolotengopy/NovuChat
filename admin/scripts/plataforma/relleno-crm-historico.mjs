/**
 * RELLENO HISTÓRICO DEL miniCRM — una fila por cada contacto anterior de UNA subcuenta. Seco por omisión.
 *
 * QUÉ ES. Antes de publicar el miniCRM, cada subcuenta ya tenía contactos (Firestore `tenants/{t}/conversaciones`). Este script
 * crea en la hoja oficial del comercio (hoja `Leads_CRM`) una fila por cada contacto que todavía NO tiene fila, con SOLO los campos
 * que existen y un vocabulario cerrado. Un comercio por corrida (evy, emma, ruben o antonio); nada se comparte entre iteraciones.
 *
 *   ENV_FILE=<.env con N8N_BASE_URL y N8N_API_KEY> SHEET_ID=<id de la hoja del comercio> \
 *   node scripts/plataforma/relleno-crm-historico.mjs --proyecto <id> --tenant <rroca-...> \
 *        [--aplicar --respaldo <ruta> [--confirmo-produccion <tenant>]]
 *   ENV_FILE=… SHEET_ID=… node scripts/plataforma/relleno-crm-historico.mjs --revertir --respaldo <ruta> --tenant <t> --proyecto <id> [--aplicar]
 *
 * QUÉ ESCRIBE (por fila nueva; el resto de las columnas queda vacío, y J..M y U son del equipo: no se tocan):
 *   A  ID correlativo (LEAD-n, a continuación del mayor que ya haya en la hoja)      B  fecha del PRIMER mensaje (La Paz)
 *   C  nombre del contacto (el de su perfil de WhatsApp, sin signos de fórmula)       E  teléfono
 *   F  etapa inicial       G  origen/canal («Campaña Meta Ads» si la conversación vino de un anuncio)      H  calificación: Media (SIN EVALUAR)
 *   I  resumen fijo («Contacto anterior al miniCRM; calificación sin evaluar.»)     L  estado inicial (Activo)     N  clasificación: Tibio (SIN EVALUAR)
 *   S  última interacción (La Paz)
 * NUNCA escribe: lo que dijo el cliente, datos de salud, motivos ni montos; «qué pidió», día, horario, derivación y diagnóstico quedan
 * vacíos (no se inventan). Ninguna fila dice que alguien pagó.
 *
 * LO QUE NUNCA LEE: el texto de un mensaje (de cada conversación solo pide la hora del primero, `select('ts')`), ni la columna U de la hoja.
 *
 * IDEMPOTENTE POR TELÉFONO: un contacto cuyo teléfono ya está en la hoja se SALTA (jamás se actualiza una fila existente). Correr dos veces
 * escribe una vez. Los teléfonos se comparan solo por sus dígitos.
 *
 * SECO: lee la hoja (A3:T, sin la U) y Firestore y IMPRIME SOLO CONTEOS (nunca teléfonos ni nombres).
 * `--aplicar`: exige `--respaldo` (ruta absoluta, 0600, fuera de todo repositorio, nunca se pisa). Guarda ahí las filas de la hoja ANTES (A..T) y el
 * rango que va a escribir, agrega las filas nuevas en UNA llamada (`values:append`, USER_ENTERED con apóstrofo en los textos) y relee y compara.
 * `--revertir --aplicar`: borra SOLO el rango que escribió este script y solo si su contenido sigue siendo el escrito.
 *
 * LA CREDENCIAL. La cuenta `crm-<tenant>` no tiene clave en este equipo (vive en n8n). La lectura y la escritura de la hoja pasan por un flujo
 * TEMPORAL de n8n que usa la credencial «Google Sheets miniCRM (crm-<tenant>)»: se crea, se activa, se llama y se BORRA, con la retención de
 * ejecuciones en `none`. Cuesta una escritura en n8n por llamada y 0 mensajes por conversación.
 *
 * SALIDA. 0 hecho o seco sin diferencias; 1 el seco encontró filas por crear; 2 uso o salvaguarda (nada escrito); 3 error de ejecución.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comprobarProyecto, comprobarRespaldo, guardarRespaldo, leerRespaldoGenerico } from './aplicar-consola-conversaciones.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..', '..');
export const TENANTS = Object.freeze(['rroca-evy', 'rroca-emma', 'rroca-ruben', 'rroca-antonio']);
const HOJA = 'Leads_CRM';
// «Media» (calificación) y «Tibio» (clasificación) son el valor por OMISIÓN de un contacto anterior al miniCRM: SIN EVALUAR, no un juicio sobre la persona.
const RESUMEN = 'Contacto anterior al miniCRM; calificación sin evaluar.';
const CON_VALOR = ['proyecto', 'tenant', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];

export const USO = '  ENV_FILE=… SHEET_ID=… node scripts/plataforma/relleno-crm-historico.mjs --proyecto <id> --tenant <rroca-evy|rroca-emma|rroca-ruben|rroca-antonio> '
  + '[--aplicar --respaldo <ruta> [--confirmo-produccion <tenant>]]\n'
  + '  ENV_FILE=… SHEET_ID=… node scripts/plataforma/relleno-crm-historico.mjs --revertir --respaldo <ruta> --tenant <t> --proyecto <id> [--aplicar] [--confirmo-produccion <tenant>]';

// Las rutinas de texto y fecha son las del módulo `crm` (se cargan del mismo archivo que corre en n8n, no se copian).
const CRM = runInNewContext(`${readFileSync(join(RAIZ, 'Flujos', 'src', 'modulos', 'crm', 'crm.js'), 'utf8')}\n({ crmDigitos, crmSeguro, crmComoTexto, crmFechaLaPaz, crmFechaHoraLaPaz })`, {});

export function leerMapa(tenant, raiz = RAIZ) {
  if (!TENANTS.includes(tenant)) throw new Error('tenant fuera de la lista');
  const m = JSON.parse(readFileSync(join(raiz, 'admin', 'scripts', 'datos', tenant, `${tenant}.json`), 'utf8')).crm;
  delete m._nota;
  return m;
}

// ===========================================================================
// ARGUMENTOS
// ===========================================================================
export function analizarArgumentos(argv, env = process.env, opciones = {}) {
  const problemas = [];
  const valores = { __proto__: null };
  const banderas = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string' || !a.startsWith('--')) { problemas.push('argumento suelto (sin su opción)'); continue; }
    const nombre = a.slice(2);
    if (BANDERAS.includes(nombre)) { if (banderas.includes(nombre)) problemas.push(`opción repetida: --${nombre}`); banderas.push(nombre); }
    else if (CON_VALOR.includes(nombre)) {
      if (nombre in valores) problemas.push(`opción repetida: --${nombre}`);
      const valor = argv[i + 1];
      if (valor === undefined || valor.startsWith('--')) { problemas.push(`--${nombre} sin valor`); continue; }
      valores[nombre] = valor; i += 1;
    } else problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40)}`);
  }
  const aplicar = banderas.includes('aplicar');
  const revertir = banderas.includes('revertir');
  const { proyecto, tenant, respaldo } = valores;
  const confirmo = valores['confirmo-produccion'];
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto === undefined) problemas.push('falta --proyecto'); else if (!proy.ok) problemas.push(proy.motivo);
  if (tenant === undefined) problemas.push('falta --tenant');
  else if (!TENANTS.includes(tenant)) problemas.push(`--tenant tiene que ser uno de: ${TENANTS.join(', ')} (un comercio por corrida)`);
  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) problemas.push('contra producción, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  if (!/^[A-Za-z0-9_-]{25,100}$/.test(env.SHEET_ID ?? '')) problemas.push('falta SHEET_ID (el id de la hoja del comercio, en el entorno)');
  if (typeof env.ENV_FILE !== 'string' || env.ENV_FILE === '') problemas.push('falta ENV_FILE (el .env de n8n)');
  if (revertir) {
    if (respaldo === undefined) problemas.push('--revertir exige --respaldo <ruta>');
  } else if (aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta>');
  let respaldoResuelto = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: revertir, permitirExistente: !revertir });
    if (r.ok) respaldoResuelto = r.real; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, aplicar, revertir, respaldo: respaldo ?? null, respaldoResuelto } };
}

// ===========================================================================
// FILAS (puro)
// ===========================================================================
const finito = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * De las conversaciones + lo que ya hay en la hoja a las filas nuevas.
 *   conversaciones: [{ telefono, nombre?, origen?, primeroMs?, ultimoMs? }]   (sin ningún texto de mensaje)
 *   hoja: { telefonos: string[] (solo dígitos o crudos), ids: string[], ultimaFila: number }
 * Devuelve { filas: string[][] (A..ultima letra del bot), omitidos, conteos }.
 */
export function construirFilas({ conversaciones, hoja, mapa }) {
  const col = (c) => mapa.columnas[c];
  const letras = Object.values(mapa.columnas).map((c) => c.letra).sort();
  const ultima = letras[letras.length - 1];
  const idx = (letra) => letra.charCodeAt(0) - 65;
  const ancho = idx(ultima) + 1;
  const estado = mapa.equipo.estado;
  const tieneEstado = estado && estado.letra <= ultima;
  const existentes = new Set(hoja.telefonos.map((t) => CRM.crmDigitos(t)).filter(Boolean));
  const re = new RegExp(`^\\s*${mapa.prefijoId.replace(/[^A-Za-z0-9]/g, '\\$&')}(\\d+)\\s*$`, 'i');
  let proximo = Math.max(mapa.primerId - 1, ...hoja.ids.map((v) => { const m = re.exec(String(v ?? '')); return m ? Number(m[1]) : 0; })) + 1;
  const omitidos = { sinTelefono: 0, yaTienenFila: 0, repetidos: 0 };
  const vistos = new Set();
  const filas = [];
  let conAnuncio = 0; let conNombre = 0;
  // Orden estable: el contacto más antiguo recibe el ID más bajo.
  const ordenadas = [...conversaciones].sort((a, b) => (finito(a.primeroMs) ? a.primeroMs : Infinity) - (finito(b.primeroMs) ? b.primeroMs : Infinity));
  for (const c of ordenadas) {
    const tel = CRM.crmDigitos(c.telefono);
    if (tel.length < 8 || tel.length > 15) { omitidos.sinTelefono += 1; continue; }
    if (existentes.has(tel)) { omitidos.yaTienenFila += 1; continue; }
    if (vistos.has(tel)) { omitidos.repetidos += 1; continue; }
    vistos.add(tel);
    const fila = new Array(ancho).fill('');
    const poner = (campo, valor) => { if (col(campo) && valor !== '') fila[idx(col(campo).letra)] = valor; };
    const anuncio = c.origen === 'anuncio';
    if (anuncio) conAnuncio += 1;
    const nombre = CRM.crmComoTexto(String(c.nombre ?? '').slice(0, 120));
    if (nombre) conNombre += 1;
    poner('id', `${mapa.prefijoId}${proximo}`);
    poner('fecha', finito(c.primeroMs) ? CRM.crmFechaLaPaz(c.primeroMs) : '');
    poner('nombre', nombre);
    poner('telefono', `'${tel}`);
    poner('etapaInicial', mapa.alCrear.etapaInicial);
    poner('origen', anuncio ? mapa.alCrear.origenAnuncio : mapa.alCrear.origen);
    poner('calificacion', 'Media');
    poner('resumen', `'${RESUMEN}`);
    poner('clasificacion', 'Tibio');
    poner('ultimaInteraccion', finito(c.ultimoMs) ? CRM.crmFechaHoraLaPaz(c.ultimoMs) : '');
    if (tieneEstado && mapa.alCrear.estado) fila[idx(estado.letra)] = mapa.alCrear.estado;
    filas.push(fila);
    proximo += 1;
  }
  return { filas, omitidos, conteos: { conversaciones: conversaciones.length, aCrear: filas.length, conAnuncio, conNombre, ancho, ultima } };
}

// ===========================================================================
// n8n: flujo temporal que lee o escribe la hoja con la credencial del comercio
// ===========================================================================
function leerEnv(ruta) {
  const env = {};
  for (const l of readFileSync(ruta, 'utf8').split('\n')) { const m = /^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(l); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); }
  return env;
}

export function nombreCredencial(tenant) { return `Google Sheets miniCRM (crm-${tenant})`; }

/** Crea, activa, llama y BORRA un flujo temporal. `nodos` cuelga de un webhook; devuelve el JSON de la última salida. */
export async function correrEnN8n({ envFile, tenant, hacer, cuerpo }) {
  const env = leerEnv(envFile);
  const BASE = (env.N8N_BASE_URL || '').replace(/\/+$/, '');
  if (!BASE || !env.N8N_API_KEY) throw Object.assign(new Error('faltan N8N_BASE_URL o N8N_API_KEY'), { code: 'sin-n8n' });
  const H = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
  const api = async (met, ruta, c) => {
    const r = await fetch(`${BASE}/api/v1${ruta}`, { method: met, headers: H, body: c ? JSON.stringify(c) : undefined, signal: AbortSignal.timeout(30000) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
    return { ok: r.ok, estado: r.status, j };
  };
  const lc = await api('GET', '/credentials?limit=250');
  const cred = (lc.j?.data || []).filter((c) => c.name === nombreCredencial(tenant));
  if (!lc.ok || cred.length !== 1) throw Object.assign(new Error('credencial del comercio: se esperaba 1'), { code: 'sin-credencial' });
  const credencial = { googleApi: { id: String(cred[0].id), name: nombreCredencial(tenant) } };
  const camino = `prueba-crm-${randomBytes(16).toString('hex')}`;
  const http = (id, name, x, parametros) => ({ id, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x, 0], credentials: credencial,
    parameters: { authentication: 'predefinedCredentialType', nodeCredentialType: 'googleApi', options: { timeout: 30000 }, ...parametros } });
  const { nodos, salida } = hacer({ http });
  const flujo = { name: `TEMPORAL relleno miniCRM ${tenant} (borrar)`,
    nodes: [{ id: 'entrada', name: 'Entrada', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: randomBytes(8).toString('hex'),
      parameters: { httpMethod: 'POST', path: camino, responseMode: 'lastNode', options: {} } }, ...nodos],
    connections: Object.fromEntries(['Entrada', ...nodos.map((n) => n.name)].slice(0, -1).map((n, i) => [n, { main: [[{ node: nodos[i].name, type: 'main', index: 0 }]] }])),
    settings: { executionOrder: 'v1', saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false } };
  void salida;
  let id = null;
  try {
    const c = await api('POST', '/workflows', flujo);
    if (!c.ok) throw Object.assign(new Error('crear'), { code: `n8n-crear-${c.estado}` });
    id = c.j.id;
    const a = await api('POST', `/workflows/${id}/activate`);
    if (!a.ok) throw Object.assign(new Error('activar'), { code: `n8n-activar-${a.estado}` });
    await new Promise((r) => setTimeout(r, 4000));
    const r = await fetch(`${BASE}/webhook/${camino}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo ?? {}), signal: AbortSignal.timeout(90000) });
    const texto = await r.text();
    if (!r.ok) throw Object.assign(new Error('llamada'), { code: `n8n-llamada-${r.status}` });
    try { return JSON.parse(texto); } catch { throw Object.assign(new Error('respuesta'), { code: 'n8n-respuesta-no-json' }); }
  } finally {
    if (id) { await api('POST', `/workflows/${id}/deactivate`); await api('DELETE', `/workflows/${id}`); }
  }
}

const urlHoja = (sheet, ruta) => `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheet)}/values/${ruta}`;

/** Lee A{fila}:{ultima} (NUNCA la columna del equipo U). */
export async function leerHoja({ envFile, tenant, sheet, mapa }) {
  const ultima = Object.values(mapa.columnas).map((c) => c.letra).sort().pop();
  const rango = encodeURIComponent(`'${HOJA}'!A${mapa.filaEncabezados}:${ultima}`);
  const r = await correrEnN8n({ envFile, tenant, hacer: ({ http }) => ({ nodos: [http('leer', 'Leer', 240, { method: 'GET', url: `${urlHoja(sheet, rango)}?valueRenderOption=FORMATTED_VALUE` })] }) });
  return Array.isArray(r.values) ? r.values : [];
}

export const resumenDeLaHoja = (valores, mapa) => {
  const e = (c) => c.charCodeAt(0) - 65;
  const datos = valores.slice(1);
  return { telefonos: datos.map((f) => f[e(mapa.columnas.telefono.letra)] ?? ''), ids: datos.map((f) => f[e(mapa.columnas.id.letra)] ?? ''), ultimaFila: mapa.filaEncabezados + valores.length - 1 };
};

export async function agregarFilas({ envFile, tenant, sheet, mapa, filas }) {
  const ultima = Object.values(mapa.columnas).map((c) => c.letra).sort().pop();
  const rango = encodeURIComponent(`'${HOJA}'!A${mapa.filaEncabezados + 1}:${ultima}`);
  return correrEnN8n({ envFile, tenant, cuerpo: { filas }, hacer: ({ http }) => ({ nodos: [http('agregar', 'Agregar', 240, {
    method: 'POST', url: `${urlHoja(sheet, rango)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, sendBody: true, contentType: 'json',
    specifyBody: 'json', jsonBody: '={{ JSON.stringify({ values: $json.body.filas }) }}' })] }) });
}

export async function limpiarRango({ envFile, tenant, sheet, rango }) {
  return correrEnN8n({ envFile, tenant, hacer: ({ http }) => ({ nodos: [http('limpiar', 'Limpiar', 240, { method: 'POST', url: `${urlHoja(sheet, encodeURIComponent(rango))}:clear` })] }) });
}

// ===========================================================================
// FIRESTORE: solo metadatos (nunca el texto de un mensaje)
// ===========================================================================
async function leerConversaciones(db, tenant) {
  const docs = (await db.collection(`tenants/${tenant}/conversaciones`).select('telefono', 'nombreContacto', 'origen', 'ultimoEn').get()).docs;
  const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null);
  const salida = [];
  for (const d of docs) {
    const x = d.data();
    // De cada conversación SOLO la hora del primer mensaje (`ts`): el texto nunca se lee.
    const primero = (await d.ref.collection('mensajes').orderBy('ts', 'asc').limit(1).select('ts').get()).docs[0];
    salida.push({ telefono: x.telefono ?? d.id.replace(/^wa_/, ''), nombre: x.nombreContacto, origen: x.origen, primeroMs: ms(primero?.get('ts')) ?? ms(x.ultimoEn), ultimoMs: ms(x.ultimoEn) });
  }
  return salida;
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================
export async function ejecutar(cfg, deps) {
  const log = deps.log ?? ((t) => console.log(t));
  const mapa = deps.mapa ?? leerMapa(cfg.tenant);
  const rotulo = `${cfg.entorno} · ${cfg.tenant}`;

  if (cfg.revertir) {
    const l = leerRespaldoGenerico(cfg.respaldo, { limite: 512 * 1024 });
    if (!l.ok) { log(`\n  ✗ ${l.motivo}\n`); return 2; }
    const r = l.respaldo;
    if (r?.version !== 1 || r.campo !== 'relleno-crm-historico' || r.tenant !== cfg.tenant || r.entorno !== cfg.entorno || typeof r.rango !== 'string' || !Array.isArray(r.escrito)) {
      log('\n  ✗ el respaldo no es de este comercio y entorno, o no tiene la forma esperada\n'); return 2;
    }
    const hoy = await deps.leer(); // A3:T completo
    const desde = r.filaDesde - mapa.filaEncabezados;
    const actual = hoy.slice(desde, desde + r.escrito.length).map((f) => f.map((v) => String(v ?? '')));
    const esperado = r.escrito.map((f) => f.map((v) => String(v ?? '').replace(/^'/, '')));
    const igual = actual.length === esperado.length && actual.every((f, i) => esperado[i].every((v, j) => (f[j] ?? '') === v));
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO'} · ${rotulo}: ${r.escrito.length} filas escritas por este script.`);
    if (!igual) { log('  ✗ El rango ya no tiene lo que escribió este script: alguien lo cambió. No se borra nada.\n'); return 2; }
    if (!cfg.aplicar) { log('  Seco: no se borró nada. Agregue --aplicar para limpiar ese rango.\n'); return 1; }
    await deps.limpiar(r.rango);
    log('  ✓ Rango limpiado.\n');
    return 0;
  }

  const [conversaciones, valores] = await Promise.all([deps.conversaciones(), deps.leer()]);
  if (valores.length === 0) { log('\n  ✗ la hoja no se pudo leer (fila de encabezados vacía): no se escribe nada.\n'); return 3; }
  const hoja = resumenDeLaHoja(valores, mapa);
  const { filas, omitidos, conteos } = construirFilas({ conversaciones, hoja, mapa });
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)'} · ${rotulo}\n`);
  log(`  conversaciones en Firestore : ${conteos.conversaciones}`);
  log(`  filas ya en la hoja         : ${hoja.telefonos.filter((t) => String(t).trim() !== '').length}`);
  log(`  se saltan (ya tienen fila)  : ${omitidos.yaTienenFila}`);
  log(`  se saltan (sin teléfono)    : ${omitidos.sinTelefono + omitidos.repetidos}`);
  log(`  filas a crear               : ${conteos.aCrear}  (con anuncio: ${conteos.conAnuncio}; con nombre: ${conteos.conNombre})`);
  if (conteos.aCrear === 0) { log('\n  ✓ Nada que crear: la hoja ya tiene a todos.\n'); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar --respaldo <ruta> para escribir.\n'); return 1; }

  const filaDesde = hoja.ultimaFila + 1;
  const rango = `'${HOJA}'!A${filaDesde}:${conteos.ultima}${filaDesde + filas.length - 1}`;
  try {
    guardarRespaldo(cfg.respaldo, { version: 1, campo: 'relleno-crm-historico', entorno: cfg.entorno, tenant: cfg.tenant, creadoEn: new Date().toISOString(),
      rango, filaDesde, escrito: filas, antes: valores });
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa. No se escribe nada.\n'); return 2; }
    throw e;
  }
  log(`\n  Respaldo guardado (la hoja A..${conteos.ultima} antes y las filas a escribir): ${cfg.respaldo}`);
  await deps.agregar(filas);
  const despues = resumenDeLaHoja(await deps.leer(), mapa);
  const nuevos = new Set(filas.map((f) => CRM.crmDigitos(f[mapa.columnas.telefono.letra.charCodeAt(0) - 65])));
  const presentes = despues.telefonos.map((t) => CRM.crmDigitos(t)).filter((t) => nuevos.has(t)).length;
  if (presentes !== nuevos.size) { log(`\n  ✗ La relectura no coincide: esperadas ${nuevos.size} filas nuevas, se ven ${presentes}. Revise la hoja; el respaldo permite revertir.\n`); return 3; }
  log(`\n  ✓ Escritas y releídas: ${filas.length} filas (${rango.split('!')[1]}).`);
  log('  Para deshacer: --revertir con el mismo respaldo, comercio y proyecto.\n');
  return 0;
}

async function principal() {
  const a = analizarArgumentos(process.argv.slice(2));
  if (!a.ok) { console.error(`\n  ✗ ${a.problemas.join('\n  ✗ ')}\n\n${USO}\n`); process.exit(2); }
  const { cfg } = a;
  const mapa = leerMapa(cfg.tenant);
  const args = { envFile: process.env.ENV_FILE, tenant: cfg.tenant, sheet: process.env.SHEET_ID, mapa };
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  const codigo = await ejecutar(cfg, {
    mapa,
    conversaciones: () => leerConversaciones(db, cfg.tenant),
    leer: () => leerHoja(args),
    agregar: (filas) => agregarFilas({ ...args, filas }),
    limpiar: (rango) => limpiarRango({ ...args, rango }),
  });
  await db.terminate().catch(() => {});
  process.exit(codigo);
}

function seEjecutaDirecto() {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}
if (seEjecutaDirecto()) {
  try { await principal(); } catch (e) { console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`); process.exit(3); }
}
