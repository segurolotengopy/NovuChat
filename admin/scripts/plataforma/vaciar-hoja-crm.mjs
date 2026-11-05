/**
 * VACIAR LOS REGISTROS DEL miniCRM DE UN COMERCIO (hoja `Leads_CRM`, A4:T<última>) — seco por omisión.
 *
 * PARA QUÉ. Un comercio empieza de nuevo y sus registros eran de prueba. Esto limpia SOLO los VALORES de los datos: desde la primera fila
 * de datos hasta la última, columnas A..última letra del bot (T). NO toca: la fila de encabezados, ninguna otra pestaña (Dashboard, Kanban,
 * con sus fórmulas), la columna U (diagnóstico del equipo), ni los formatos, listas desplegables y formatos condicionales (`values:clear`
 * solo borra valores). Si el contador de ID (`LEAD-n`) queda sin filas, el flujo arranca de nuevo desde su valor inicial.
 *
 *   ENV_FILE=<.env con N8N_BASE_URL y N8N_API_KEY> SHEET_ID=<id de la hoja> \
 *   node scripts/plataforma/vaciar-hoja-crm.mjs --proyecto <id> --tenant <rroca-...>
 *        [--aplicar --respaldo <ruta absoluta> --confirmo-produccion <tenant> --confirmo-hoja <últimos 6 del SHEET_ID> [--acepto-borrar-equipo]]
 *
 * SECO: lee A3:T y reporta SOLO conteos: filas con ID, filas con algo en las columnas del EQUIPO (J..M: responsable, próxima acción, valor,
 * estado), celdas con fórmula en la zona de datos y la última fila. Nunca imprime teléfonos, nombres ni valores.
 * `--aplicar`: exige `--confirmo-produccion` igual a `--tenant` (la hoja es la real aunque Firestore sea staging) y `--respaldo` (ruta
 * absoluta, 0600, fuera de todo repositorio, nunca se pisa: lleva los valores de A3:T, datos de personas, se borra al cerrar). Además
 * conviene una copia previa de la hoja en Drive (la hace Claude con el conector, antes). REGLAS DE PARADA (nada se escribe, sale 2):
 *   · algún encabezado no es el del mapa (el equipo movió columnas);
 *   · hay celdas con fórmula en A4:T (no se borran fórmulas);
 *   · hay datos del equipo en J..M y no se pasó `--acepto-borrar-equipo`;
 *   · la última fila cambió entre la lectura y el borrado (el bot escribió).
 * Después relee: los encabezados deben seguir iguales y la zona de datos vacía.
 * La hoja pasa por un flujo TEMPORAL de n8n con la credencial «Google Sheets miniCRM (crm-<tenant>)» (se crea, se llama, se borra; retención
 * `none`). Un comercio por corrida; lista cerrada de comercios (la del relleno histórico).
 *
 * SALIDA. 0 hecho o nada que borrar; 1 el seco encontró filas; 2 uso o salvaguarda (nada escrito); 3 error de ejecución.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { comprobarProyecto, comprobarRespaldo, guardarRespaldo } from './aplicar-consola-conversaciones.mjs';
import { TENANTS, leerMapa, encabezadosEsperados, correrEnN8n, limpiarRango, estado } from './relleno-crm-historico.mjs';

const HOJA = 'Leads_CRM';
const CON_VALOR = ['proyecto', 'tenant', 'respaldo', 'confirmo-produccion', 'confirmo-hoja'];
const BANDERAS = ['aplicar', 'acepto-borrar-equipo'];

export const USO = '  ENV_FILE=… SHEET_ID=… node scripts/plataforma/vaciar-hoja-crm.mjs --proyecto <id> --tenant <rroca-evy|rroca-emma|rroca-ruben|rroca-antonio> '
  + '[--aplicar --respaldo <ruta> --confirmo-produccion <tenant> --confirmo-hoja <últimos 6 del SHEET_ID> [--acepto-borrar-equipo]]';

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
  const { proyecto, tenant, respaldo } = valores;
  const confirmo = valores['confirmo-produccion'];
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto === undefined) problemas.push('falta --proyecto'); else if (!proy.ok) problemas.push(proy.motivo);
  if (tenant === undefined) problemas.push('falta --tenant');
  else if (!TENANTS.includes(tenant)) problemas.push(`--tenant tiene que ser uno de: ${TENANTS.join(', ')} (un comercio por corrida)`);
  if (confirmo !== undefined && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  if (aplicar && confirmo === undefined) problemas.push('--aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  if (aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta absoluta> (0600, fuera del repositorio)');
  // `--confirmo-produccion` confirma el comercio, no la hoja: SHEET_ID viene del entorno y nada lo ata al comercio. Por eso se confirma también la HOJA, con los últimos 6 caracteres de su id (el seco los muestra).
  const hojaConfirmada = valores['confirmo-hoja'];
  if (aplicar && hojaConfirmada === undefined) problemas.push('--aplicar exige --confirmo-hoja <últimos 6 caracteres del SHEET_ID>');
  if (hojaConfirmada !== undefined && hojaConfirmada !== String(env.SHEET_ID ?? '').slice(-6)) problemas.push('--confirmo-hoja no coincide con el final del SHEET_ID');
  if (banderas.includes('acepto-borrar-equipo') && !aplicar) problemas.push('--acepto-borrar-equipo solo tiene sentido con --aplicar');
  if (!/^[A-Za-z0-9_-]{25,100}$/.test(env.SHEET_ID ?? '')) problemas.push('falta SHEET_ID (el id de la hoja del comercio, en el entorno)');
  if (typeof env.ENV_FILE !== 'string' || env.ENV_FILE === '') problemas.push('falta ENV_FILE (el .env de n8n)');
  let respaldoResuelto = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: false, permitirExistente: false });
    if (r.ok) respaldoResuelto = r.real; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, aplicar, hojaFin: String(env.SHEET_ID ?? '').slice(-6), aceptoEquipo: banderas.includes('acepto-borrar-equipo'), respaldo: respaldo ?? null, respaldoResuelto } };
}

const letra = (c) => c.charCodeAt(0) - 65;

/** Puro: de los valores crudos de A{filaEncabezados}:T a los conteos. `valores[0]` es la fila de encabezados. */
export function analizarHoja(valores, mapa) {
  const ultima = Object.values(mapa.columnas).map((c) => c.letra).sort().pop();
  const ancho = letra(ultima) + 1;
  const equipo = Object.values(mapa.equipo ?? {}).filter((c) => c && c.letra <= ultima).map((c) => letra(c.letra));
  const datos = valores.slice(1);
  const lleno = (v) => String(v ?? '').trim() !== '';
  let conId = 0; let conEquipo = 0; let formulas = 0; let ultimaConDatos = 0;
  datos.forEach((f, i) => {
    const fila = Array.from({ length: ancho }, (_, j) => f[j]);
    if (lleno(f[letra(mapa.columnas.id.letra)])) conId += 1;
    if (equipo.some((j) => lleno(fila[j]))) conEquipo += 1;
    formulas += fila.filter((v) => typeof v === 'string' && v.startsWith('=')).length;
    if (fila.some(lleno)) ultimaConDatos = i + 1;
  });
  return { filasLeidas: datos.length, conId, conEquipo, formulas, ultimaFila: mapa.filaEncabezados + datos.length, ultimaConDatos: mapa.filaEncabezados + ultimaConDatos, ultima };
}

/**
 * deps = { leer(): Promise<string[][]> (A{filaEncabezados}:T, fórmulas sin evaluar), leerFormateado?(): lo mismo con los valores como se ven (respaldo de las fechas), limpiar(rango): Promise<void> }
 */
export async function ejecutar(cfg, deps, mapa, log = (t) => console.log(t)) {
  const valores = await deps.leer();
  if (valores.length === 0) { log('\n  ✗ la hoja no se pudo leer (fila de encabezados vacía): no se escribe nada.\n'); return 3; }
  const esperados = encabezadosEsperados(mapa);
  const malos = esperados.map((t, j) => (String(valores[0][j] ?? '').trim() === t ? null : t)).filter((t) => t !== null);
  if (malos.length) { log(`\n  ✗ Los encabezados de la fila ${mapa.filaEncabezados} no son los del mapa (${malos.length} distinto/s): no se escribe nada.\n`); return 2; }
  const h = analizarHoja(valores, mapa);
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)'} · ${cfg.tenant} · hoja ${HOJA} (id termina en …${cfg.hojaFin ?? '??????'})`);
  log(`  filas de datos leídas       : ${h.filasLeidas}  (hasta la fila ${h.ultimaFila})`);
  log(`  filas con ID                : ${h.conId}`);
  log(`  filas con datos del EQUIPO  : ${h.conEquipo}  (columnas J..M: responsable, próxima acción, valor, estado)`);
  log(`  celdas con fórmula en datos : ${h.formulas}`);
  if (h.ultimaConDatos < mapa.filaEncabezados + 1) { log('\n  ✓ La zona de datos ya está vacía.\n'); return 0; }
  if (h.formulas > 0) { log('\n  ✗ Hay fórmulas en la zona de datos: este script no borra fórmulas. Revise la hoja a mano.\n'); return 2; }
  if (!cfg.aplicar) { log('\n  Seco: no se borró nada. Agregue --aplicar --respaldo <ruta> --confirmo-produccion <tenant> --confirmo-hoja <últimos 6 del SHEET_ID>.\n'); return 1; }
  if (h.conEquipo > 0 && !cfg.aceptoEquipo) { log('\n  ✗ Hay datos del equipo en J..M (trabajo humano): para borrarlos, agregue --acepto-borrar-equipo. No se escribe nada.\n'); return 2; }
  try {
    guardarRespaldo(cfg.respaldo, { version: 1, campo: 'vaciar-hoja-crm', tenant: cfg.tenant, creadoEn: new Date().toISOString(), filaEncabezados: mapa.filaEncabezados, valores, valoresFormateados: deps.leerFormateado ? await deps.leerFormateado() : undefined });
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa. No se escribe nada.\n'); return 2; }
    throw e;
  }
  log(`\n  Respaldo de A${mapa.filaEncabezados}:${h.ultima} (datos de personas, se borra al cerrar): ${cfg.respaldo}`);
  // El bot sigue vivo: si agregó una fila entre la lectura y ahora, esa fila NO estaba en el seco ni en el respaldo. No se borra.
  const otra = await deps.leer();
  if (JSON.stringify(otra) !== JSON.stringify(valores)) { log('\n  ✗ La hoja cambió mientras se preparaba (el bot escribió): no se borra nada. Vuelva a correr el seco.\n'); return 3; }
  const rango = `'${HOJA}'!A${mapa.filaEncabezados + 1}:${h.ultima}${h.ultimaFila}`;
  await deps.limpiar(rango);
  const despues = await deps.leer();
  const d = analizarHoja(despues, mapa);
  const mismosEncabezados = JSON.stringify(despues[0]) === JSON.stringify(valores[0]);
  if (!mismosEncabezados || d.ultimaConDatos >= mapa.filaEncabezados + 1) { log('\n  ✗ La relectura no coincide (encabezados cambiados o quedan datos): revise la hoja; el respaldo permite reponer.\n'); return 3; }
  log(`\n  ✓ Vaciado ${rango.split('!')[1]} y releído: encabezados iguales, zona de datos vacía. Dashboard, Kanban y la columna U no se tocaron.`);
  log('  Compruebe en la hoja que Dashboard y Kanban no muestren #REF!.\n');
  return 0;
}

async function principal() {
  const a = analizarArgumentos(process.argv.slice(2));
  if (!a.ok) { console.error(`\n  ✗ ${a.problemas.join('\n  ✗ ')}\n\n${USO}\n`); process.exit(2); }
  const { cfg } = a;
  const mapa = leerMapa(cfg.tenant);
  const args = { envFile: process.env.ENV_FILE, tenant: cfg.tenant, sheet: process.env.SHEET_ID };
  const ultima = Object.values(mapa.columnas).map((c) => c.letra).sort().pop();
  const rango = encodeURIComponent(`'${HOJA}'!A${mapa.filaEncabezados}:${ultima}`);
  const leerComo = async (modo) => {
    const r = await correrEnN8n({ ...args, hacer: ({ http }) => ({ nodos: [http('leer', 'Leer', 240, { method: 'GET',
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(args.sheet)}/values/${rango}?valueRenderOption=${modo}` })] }) });
    return Array.isArray(r.values) ? r.values : [];
  };
  const codigo = await ejecutar(cfg, {
    leer: () => leerComo('FORMULA'),
    leerFormateado: () => leerComo('FORMATTED_VALUE'),
    limpiar: (r) => limpiarRango({ ...args, rango: r }),
  }, mapa);
  process.exit(estado.limpiezaFallida ? 3 : codigo);
}

function seEjecutaDirecto() {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}
if (seEjecutaDirecto()) {
  try { await principal(); } catch (e) { console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`); process.exit(3); }
}
