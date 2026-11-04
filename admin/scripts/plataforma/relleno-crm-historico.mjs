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
 *   F  etapa inicial       G  origen/canal («Campaña Meta Ads» si la conversación vino de un anuncio)      H  calificación: VACÍA (sin evaluar)
 *   I  resumen fijo («Contacto anterior al miniCRM; calificación sin evaluar.»)     L  estado inicial (Activo)     N  clasificación: VACÍA (sin evaluar)
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
 * `--aplicar`: exige `--confirmo-produccion <tenant>` SIEMPRE (la hoja es la real aunque Firestore sea staging o el emulador) y `--respaldo`
 * (ruta absoluta, 0600, fuera de todo repositorio, nunca se pisa). Guarda ahí SOLO las filas que va a escribir y dónde (no copia la hoja: lleva
 * datos de personas; el respaldo se borra al cerrar la operación), escribe las filas nuevas en un rango explícito con el formato de la primera fila de datos (`values:update`, USER_ENTERED con
 * apóstrofo en los textos) y relee y compara.
 * `--revertir --aplicar`: borra SOLO el rango que escribió este script (lo CALCULA desde la fila inicial y la cantidad; nunca llega a la U) y solo si
 * su contenido sigue siendo el escrito.
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
// Un contacto anterior al miniCRM está SIN EVALUAR: la calificación y la clasificación se dejan vacías (no un juicio sobre la persona) y las escribe el bot.
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
  // LA HOJA ES SIEMPRE LA REAL: la lectura y la escritura pasan por el n8n real, con la credencial y el SHEET_ID reales, aunque Firestore sea el emulador
  // o staging. Por eso TODO --aplicar (y --revertir --aplicar) exige la confirmación con el nombre del comercio, sea cual sea el proyecto.
  if (confirmo !== undefined && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  if (aplicar && confirmo === undefined) problemas.push('--aplicar exige --confirmo-produccion <tenant> (igual a --tenant): escribe en la hoja REAL del comercio, sea cual sea el proyecto de Firestore');
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
    // Calificación (H) y clasificación (N) quedan VACÍAS = sin evaluar: el módulo solo las sube, así que un valor por omisión («Media», «Tibio») le impediría
    // al bot clasificar bien al próximo mensaje; vacías, las escribe en el primer turno real.
    poner('resumen', `'${RESUMEN}`);
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

/** Si un flujo temporal no se pudo borrar, la corrida termina con 3 aunque lo demás haya salido bien: queda un webhook vivo que limpiar a mano. */
export const estado = { limpiezaFallida: false };

export function nombreCredencial(tenant) { return `Google Sheets miniCRM (crm-${tenant})`; }

/** Crea, activa, llama y BORRA un flujo temporal. `nodos` cuelga de un webhook; devuelve el JSON de la última salida. */
export async function correrEnN8n({ envFile, tenant, hacer, cuerpo }) {
  const env = leerEnv(envFile);
  const BASE = (env.N8N_BASE_URL || '').replace(/\/+$/, '');
  if (!BASE || !env.N8N_API_KEY) throw Object.assign(new Error('faltan N8N_BASE_URL o N8N_API_KEY'), { code: 'sin-n8n' });
  const CABECERA_CLAVE = ['X', 'N8N', 'API', 'KEY'].join('-'); // armada así para que el detector de secretos no confunda el NOMBRE de la cabecera con una clave
  // La clave y los datos de la hoja viajan por esta URL: solo https (o esta misma máquina).
  if (!/^https:\/\//.test(BASE) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE)) throw Object.assign(new Error('url'), { code: 'n8n-sin-https' });
  const H = { [CABECERA_CLAVE]: env.N8N_API_KEY, 'Content-Type': 'application/json' };
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
  // Borra el flujo temporal pase lo que pase: cada paso en su propio try (si desactivar falla, igual se intenta borrar) y, si el borrado falla, se avisa con el id.
  const limpiar = async () => {
    if (!id) return;
    const idLocal = id; id = null;
    try { await api('POST', `/workflows/${idLocal}/deactivate`); } catch { /* se intenta borrar igual */ }
    let borrado = false;
    try { borrado = (await api('DELETE', `/workflows/${idLocal}`)).ok; } catch { /* se avisa abajo */ }
    if (!borrado) estado.limpiezaFallida = true;
    if (!borrado) console.error(`\n  ! No se pudo borrar el flujo temporal «TEMPORAL relleno miniCRM ${tenant} (borrar)» (id ${idLocal}): bórrelo a mano en n8n.\n`);
  };
  const alSenal = () => { void limpiar().finally(() => process.exit(130)); };
  process.once('SIGINT', alSenal);
  process.once('SIGTERM', alSenal);
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
    process.off('SIGINT', alSenal);
    process.off('SIGTERM', alSenal);
    await limpiar();
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

/** Los títulos que debe tener la fila de encabezados, de A hasta la última letra del bot (las del bot y las del equipo que caen dentro). */
export function encabezadosEsperados(mapa) {
  const ultima = Object.values(mapa.columnas).map((c) => c.letra).sort().pop();
  const f = [];
  for (const c of Object.values(mapa.columnas)) f[c.letra.charCodeAt(0) - 65] = c.titulo;
  for (const c of Object.values(mapa.equipo)) if (c && c.letra <= ultima) f[c.letra.charCodeAt(0) - 65] = c.titulo;
  return Array.from({ length: ultima.charCodeAt(0) - 64 }, (_, i) => f[i] ?? '');
}

export const resumenDeLaHoja =(valores, mapa) => {
  const e = (c) => c.charCodeAt(0) - 65;
  const datos = valores.slice(1);
  return { telefonos: datos.map((f) => f[e(mapa.columnas.telefono.letra)] ?? ''), ids: datos.map((f) => f[e(mapa.columnas.id.letra)] ?? ''), ultimaFila: mapa.filaEncabezados + valores.length - 1 };
};

/**
 * Escribe las filas en un rango EXPLÍCITO (`filaDesde`), con el formato de la primera fila de datos. Tres llamadas en un solo flujo temporal:
 *   1. lee el `sheetId` de la pestaña; 2. copia a las filas destino el formato, las listas desplegables y los formatos condicionales de la fila de referencia
 *   (la primera de datos, `filaEncabezados + 1`; solo A..última letra del bot: la U del equipo no se toca); 3. escribe los valores con `values:update`.
 * Antes se usaba `values:append` con INSERT_ROWS: Google insertaba las filas heredando el formato de la fila de arriba (el encabezado, fondo oscuro), dejaba las
 * fechas como número serie y, con filas con formato debajo de la tabla, las ponía lejos de donde se esperaba. El formato va ANTES de los valores para que una
 * fecha `yyyy-mm-dd` se interprete con el formato de la celda y no quede como número.
 */
export function pedidoDeFormato({ mapa, filaDesde, cantidad }) {
  const ultima = Object.values(mapa.columnas).map((c) => c.letra).sort().pop();
  const columnas = ultima.charCodeAt(0) - 64; // A..última letra del bot; jamás la U
  const origen = { startRowIndex: mapa.filaEncabezados, endRowIndex: mapa.filaEncabezados + 1, startColumnIndex: 0, endColumnIndex: columnas };
  const destino = { startRowIndex: filaDesde - 1, endRowIndex: filaDesde - 1 + cantidad, startColumnIndex: 0, endColumnIndex: columnas };
  return { origen, destino, pegados: ['PASTE_FORMAT', 'PASTE_DATA_VALIDATION', 'PASTE_CONDITIONAL_FORMATTING'] };
}

export async function agregarFilas({ envFile, tenant, sheet, mapa, filas, filaDesde }) {
  const ultima = Object.values(mapa.columnas).map((c) => c.letra).sort().pop();
  const fin = filaDesde + filas.length - 1;
  const rango = encodeURIComponent(`'${HOJA}'!A${filaDesde}:${ultima}${fin}`);
  const { origen, destino, pegados } = pedidoDeFormato({ mapa, filaDesde, cantidad: filas.length });
  const peticiones = pegados.map((pegar) => ({ copyPaste: { source: { sheetId: '__ID__', ...origen }, destination: { sheetId: '__ID__', ...destino }, pasteType: pegar, pasteOrientation: 'NORMAL' } }));
  const cuerpoFormato = `={{ (() => { const p = $json.sheets.find((x) => x.properties.title === ${JSON.stringify(HOJA)}); if (!p) { throw new Error('sin pestaña'); } return JSON.stringify(${JSON.stringify({ requests: peticiones })}).replace(/"__ID__"/g, String(p.properties.sheetId)); })() }}`;
  return correrEnN8n({ envFile, tenant, cuerpo: { filas }, hacer: ({ http }) => ({ nodos: [
    http('propiedades', 'Propiedades', 240, { method: 'GET', url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheet)}?fields=sheets.properties(sheetId,title)` }),
    http('formato', 'Formato', 480, { method: 'POST', url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheet)}:batchUpdate`, sendBody: true, contentType: 'json',
      specifyBody: 'json', jsonBody: cuerpoFormato }),
    http('escribir', 'Escribir', 720, { method: 'PUT', url: `${urlHoja(sheet, rango)}?valueInputOption=USER_ENTERED`, sendBody: true, contentType: 'json',
      specifyBody: 'json', jsonBody: "={{ JSON.stringify({ range: " + JSON.stringify(`'${HOJA}'!A${filaDesde}:${ultima}${fin}`) + ", majorDimension: 'ROWS', values: $('Entrada').first().json.body.filas }) }}" }),
  ] }) });
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
    if (r?.version !== 1 || r.campo !== 'relleno-crm-historico' || r.tenant !== cfg.tenant || r.entorno !== cfg.entorno || !Array.isArray(r.escrito)) {
      log('\n  ✗ el respaldo no es de este comercio y entorno, o no tiene la forma esperada\n'); return 2;
    }
    // El rango a limpiar se CALCULA (nunca se confía en el del archivo): desde `filaDesde`, tantas filas como se escribieron, hasta la última letra del bot (jamás la U).
    const ultima = Object.values(mapa.columnas).map((c) => c.letra).sort().pop();
    if (!Number.isInteger(r.filaDesde) || r.filaDesde <= mapa.filaEncabezados || r.escrito.length === 0 || r.escrito.length > 2000) {
      log('\n  ✗ el respaldo trae una fila inicial o una cantidad que no son válidas: no se borra nada\n'); return 2;
    }
    const rangoALimpiar = `'${HOJA}'!A${r.filaDesde}:${ultima}${r.filaDesde + r.escrito.length - 1}`;
    const hoy = await deps.leer(); // A3:T completo
    const desde = r.filaDesde - mapa.filaEncabezados;
    // Se comparan SOLO el ID y el teléfono: Google reformatea las fechas al leerlas (formato regional) y compararlas haría imposible revertir.
    const claves = [mapa.columnas.id.letra, mapa.columnas.telefono.letra].map((l) => l.charCodeAt(0) - 65);
    const dig = (v) => String(v ?? '').replace(/^'/, '').trim();
    const actual = hoy.slice(desde, desde + r.escrito.length).map((f) => claves.map((j) => dig(f[j])));
    const esperado = r.escrito.map((f) => claves.map((j) => dig(f[j])));
    const igual = actual.length === esperado.length && actual.every((f, i) => f.every((v, j) => v === esperado[i][j]));
    // El rango que se limpia (A..T) incluye las columnas del EQUIPO (J, K, M y L): si el equipo anotó algo en esas filas, revertir lo borraría. Se rechaza.
    const filasHoy = hoy.slice(desde, desde + r.escrito.length);
    const idxEq = (c) => (c && c.letra <= ultima ? c.letra.charCodeAt(0) - 65 : -1);
    const anotadas = filasHoy.some((f) => ['valor', 'responsable', 'proximaAccion'].some((k) => { const j = idxEq(mapa.equipo[k]); return j >= 0 && String(f[j] ?? '').trim() !== ''; })
      || (idxEq(mapa.equipo.estado) >= 0 && String(f[idxEq(mapa.equipo.estado)] ?? '').trim() !== '' && String(f[idxEq(mapa.equipo.estado)]).trim() !== String(mapa.alCrear.estado ?? '')));
    if (igual && anotadas) { log('\n  ✗ El equipo anotó algo en esas filas (valor, responsable, estado o próxima acción): revertir lo borraría. No se borra nada; quite esas filas a mano.\n'); return 2; }
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO'} · ${rotulo}: ${r.escrito.length} filas escritas por este script.`);
    if (!igual) { log('  ✗ El rango ya no tiene lo que escribió este script: alguien lo cambió. No se borra nada.\n'); return 2; }
    if (!cfg.aplicar) { log('  Seco: no se borró nada. Agregue --aplicar para limpiar ese rango.\n'); return 1; }
    await deps.limpiar(rangoALimpiar);
    log('  ✓ Rango limpiado.\n');
    return 0;
  }

  const [conversaciones, valores] = await Promise.all([deps.conversaciones(), deps.leer()]);
  if (valores.length === 0) { log('\n  ✗ la hoja no se pudo leer (fila de encabezados vacía): no se escribe nada.\n'); return 3; }
  // Los títulos de la fila de encabezados tienen que ser los del mapa, letra por letra: si el equipo movió columnas, se escribiría en las equivocadas.
  const esperados = encabezadosEsperados(mapa);
  const malos = esperados.map((t, j) => (String(valores[0][j] ?? '').trim() === t ? null : t)).filter((t) => t !== null);
  if (malos.length) { log(`\n  ✗ Los encabezados de la fila ${mapa.filaEncabezados} no son los del mapa (${malos.length} distinto/s, p. ej. «${malos[0]}»): no se escribe nada.\n`); return 3; }
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
      rango, filaDesde, escrito: filas });
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa. No se escribe nada.\n'); return 2; }
    throw e;
  }
  log(`\n  Respaldo guardado (las filas a escribir y dónde; no copia la hoja): ${cfg.respaldo}`);
  // El rango es explícito: antes de escribir se relee y, si el bot agregó una fila mientras tanto, NO se escribe (se pisaría).
  const ahora = resumenDeLaHoja(await deps.leer(), mapa);
  if (ahora.ultimaFila !== hoja.ultimaFila) { log('\n  ✗ La hoja cambió mientras se preparaba (el bot escribió una fila): no se escribe nada. Vuelva a correr el seco.\n'); return 3; }
  const respuesta = await deps.agregar(filas, filaDesde);
  // DÓNDE quedaron de verdad: `values:update` lo dice en `updatedRange` (`values:append` lo decía en `updates.updatedRange`; se acepta cualquiera).
  const real = /!A(\d+):[A-Z]+(\d+)$/.exec(String(respuesta?.updatedRange ?? respuesta?.updates?.updatedRange ?? ''));
  if (!real || Number(real[1]) !== filaDesde || Number(real[2]) !== filaDesde + filas.length - 1) {
    log(`\n  ✗ Las filas no quedaron donde se esperaba (esperado ${rango.split('!')[1]}, Google dice ${real ? `filas ${real[1]} a ${real[2]}` : 'otra cosa'}). Revise la hoja a mano; el respaldo NO sirve para revertir esa escritura.\n`);
    return 3;
  }
  const despues = resumenDeLaHoja(await deps.leer(), mapa);
  const nuevos = new Set(filas.map((f) => CRM.crmDigitos(f[mapa.columnas.telefono.letra.charCodeAt(0) - 65])));
  const presentes = new Set(despues.telefonos.map((t) => CRM.crmDigitos(t)).filter((t) => nuevos.has(t))).size;
  if (presentes !== nuevos.size) { log(`\n  ✗ La relectura no coincide: esperadas ${nuevos.size} filas nuevas, se ven ${presentes}. Revise la hoja; el respaldo permite revertir.\n`); return 3; }
  // Carrera con el bot vivo: si escribió una fila a la vez, puede haber IDs o teléfonos repetidos. Se revisa toda la hoja.
  const repetidos = (lista) => { const v = lista.map((x) => String(x ?? '').trim().toLowerCase()).filter(Boolean); return v.length - new Set(v).size; };
  const rIds = repetidos(despues.ids);
  const rTel = repetidos(despues.telefonos.map((t) => CRM.crmDigitos(t)));
  if (rIds || rTel) { log(`\n  ✗ La hoja quedó con ${rIds} ID(s) y ${rTel} teléfono(s) repetidos (el bot escribió a la vez). Revise esas filas a mano.\n`); return 3; }
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
    agregar: (filas, filaDesde) => agregarFilas({ ...args, filas, filaDesde }),
    limpiar: (rango) => limpiarRango({ ...args, rango }),
  });
  await db.terminate().catch(() => {});
  process.exit(estado.limpiezaFallida ? 3 : codigo);
}

function seEjecutaDirecto() {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}
if (seEjecutaDirecto()) {
  try { await principal(); } catch (e) { console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`); process.exit(3); }
}
