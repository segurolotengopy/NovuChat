/**
 * PREPARAR LA PLANILLA miniCRM DE BELLIDO (hoja `Leads_CRM`) PARA U, V, W NUEVAS: TRASLADA «Diagnóstico del equipo» DE LA U A LA X.
 *
 * El mapa (admin/scripts/datos/bellido/crm.json) ya dice: U «Servicio elegido», V «Agendó», W «Fecha y hora de la cita» y la X
 * «Diagnóstico del equipo». La planilla viva todavía tiene el diagnóstico (que puede llevar datos de salud) en la U. Este script
 * lo mueve SIN perderlo. Encabezados en la fila 3, datos desde la 4. Nunca toca otras columnas ni otras hojas, nunca borra filas
 * y NUNCA imprime el contenido de una celda: solo conteos y los títulos de la fila 3.
 *
 *   ENV_FILE=<.env con N8N_BASE_URL y N8N_API_KEY> SHEET_ID=<id de la planilla> \
 *   node scripts/plataforma/planilla-u-a-x-bellido.mjs <contar|respaldar|trasladar> [opciones]
 *
 *   contar                       SOLO LECTURA. Cuántas filas tienen dato en U, V, W y X; títulos de la fila 3; verifica U3.
 *   respaldar [--aplicar]        Seco: cuenta lo que guardaría. --aplicar: guarda A (ID) y U..X, valores crudos de las filas 3.., en
 *                                ~/CLAUDE_DESCARGAS/BELLIDO_planilla-respaldo_<AAAA-MM-DD-HHMM>.json (0600, nunca se pisa).
 *   trasladar [--aplicar]        Seco: valida y dice qué haría. --aplicar: copia U→X (datos y título), RELEE X y la compara
 *                                celda por celda con el respaldo (si difiere, aborta sin vaciar U), vacía U4:U y escribe los
 *                                títulos U3, V3, W3. Exige respaldo del MISMO DÍA y que U..X siga igual que en el respaldo.
 *   trasladar --revertir [--aplicar] [--acepto-perder-datos-nuevos]
 *                                REVERSA: restaura U desde el respaldo y vacía V, W, X (y sus títulos).
 *
 *   --aplicar exige además --confirmo-hoja <últimos 6 caracteres del SHEET_ID> (el seco los muestra).
 *   --respaldo <ruta>            usa ese respaldo en vez del más reciente de ~/CLAUDE_DESCARGAS.
 *
 * LA CREDENCIAL es la del miniCRM de Bellido en n8n, «Google Sheets miniCRM (crm-bellido)», por el mecanismo de
 * `relleno-crm-historico.mjs` (`correrEnN8n`: flujo temporal que se crea, se llama y se borra; el .env se lee sin ejecutarlo; la
 * clave no pasa por este proceso). Ningún valor de secreto se lee ni se imprime; el id de la planilla viene del entorno.
 *
 * EL RESPALDO lleva SOLO la columna A (ID, para identificar la fila) y U..X (lo que se mueve): el resto de la planilla (nombres,
 * teléfonos, resúmenes) no se copia. Aun así U puede llevar datos de salud: el archivo es 0600, NO es entregable, NO se sube a Drive ni
 * se comparte, y se BORRA cuando Andres confirme que el traslado quedó bien (hasta entonces es la reversa).
 *
 * VENTANA DE CARRERA. La API de Sheets no admite escrituras condicionales («escribir solo si no cambió»): entre la última relectura y la
 * escritura siguiente queda una ventana de UNA llamada. Se reduce, no se elimina, con relecturas completas (mismo número de filas, U..X
 * iguales) antes de cada escritura y antes de vaciar U; la columna A (ID) y los últimos 6 del id de la planilla viajan en el respaldo y
 * se comparan. Cualquier diferencia aborta sin vaciar U.
 *
 * SALIDA. 0 hecho (o lectura sin novedad); 1 el seco encontró trabajo pendiente; 2 uso o salvaguarda (nada escrito);
 * 3 error de ejecución o relectura que no coincide (revise; el respaldo y --revertir permiten volver).
 */
import { chmodSync, closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { correrEnN8n, estado } from './relleno-crm-historico.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const TENANT = 'bellido';
export const HOJA = 'Leads_CRM';
export const MODOS = ['contar', 'respaldar', 'trasladar'];
const COL = { U: 20, V: 21, W: 22, X: 23 };
const ANCHO = 24; // A..X
const NOMBRE_RESPALDO = /^BELLIDO_planilla-respaldo_(\d{4}-\d{2}-\d{2})-(\d{4})\.json$/;
export const DIR_RESPALDOS = join(homedir(), 'CLAUDE_DESCARGAS');

export const USO = '  ENV_FILE=… SHEET_ID=… node scripts/plataforma/planilla-u-a-x-bellido.mjs <contar|respaldar|trasladar> '
  + '[--aplicar --confirmo-hoja <últimos 6 del SHEET_ID>] [--revertir [--acepto-perder-datos-nuevos]] [--respaldo <ruta>]';

export function leerMapa(raiz = join(AQUI, '..', 'datos', 'bellido', 'crm.json')) {
  return JSON.parse(readFileSync(raiz, 'utf8')).crm;
}

// ===========================================================================
// ARGUMENTOS
// ===========================================================================
const CON_VALOR = ['confirmo-hoja', 'respaldo'];
const BANDERAS = ['aplicar', 'revertir', 'acepto-perder-datos-nuevos'];

export function analizarArgumentos(argv, env = process.env) {
  const problemas = [];
  const [modo, ...resto] = argv;
  if (!MODOS.includes(modo)) problemas.push(`el primer argumento tiene que ser ${MODOS.join(' | ')}`);
  const valores = { __proto__: null };
  const banderas = [];
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    if (typeof a !== 'string' || !a.startsWith('--')) { problemas.push('argumento suelto (sin su opción)'); continue; }
    const n = a.slice(2);
    if (BANDERAS.includes(n)) { if (banderas.includes(n)) problemas.push(`opción repetida: --${n}`); banderas.push(n); }
    else if (CON_VALOR.includes(n)) {
      if (n in valores) problemas.push(`opción repetida: --${n}`);
      const v = resto[i + 1];
      if (v === undefined || v.startsWith('--')) { problemas.push(`--${n} sin valor`); continue; }
      valores[n] = v; i += 1;
    } else problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40)}`);
  }
  const aplicar = banderas.includes('aplicar');
  const revertir = banderas.includes('revertir');
  if (modo === 'contar' && (aplicar || revertir || banderas.length || 'respaldo' in valores)) problemas.push('contar es solo lectura y no admite opciones');
  if (revertir && modo !== 'trasladar') problemas.push('--revertir solo vale con trasladar');
  if (banderas.includes('acepto-perder-datos-nuevos') && !revertir) problemas.push('--acepto-perder-datos-nuevos solo vale con --revertir');
  if (modo === 'respaldar' && 'respaldo' in valores) problemas.push('respaldar elige solo el nombre del archivo');
  const sheet = String(env.SHEET_ID ?? '');
  if (!/^[A-Za-z0-9_-]{25,100}$/.test(sheet)) problemas.push('falta SHEET_ID (el id de la planilla, en el entorno)');
  if (typeof env.ENV_FILE !== 'string' || env.ENV_FILE === '') problemas.push('falta ENV_FILE (el .env de n8n)');
  const confirmo = valores['confirmo-hoja'];
  if (aplicar && confirmo === undefined) problemas.push('--aplicar exige --confirmo-hoja <últimos 6 caracteres del SHEET_ID>');
  if (confirmo !== undefined && confirmo !== sheet.slice(-6)) problemas.push('--confirmo-hoja no coincide con el final del SHEET_ID');
  if (confirmo !== undefined && !aplicar) problemas.push('--confirmo-hoja solo tiene sentido con --aplicar');
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { modo, aplicar, revertir, aceptoPerder: banderas.includes('acepto-perder-datos-nuevos'), hojaFin: sheet.slice(-6), respaldo: valores.respaldo ?? null } };
}

// ===========================================================================
// PURO: matrices y comparaciones (nunca se imprimen celdas)
// ===========================================================================
const lleno = (v) => String(v ?? '').trim() !== '';
const celda = (v) => (v === undefined || v === null ? '' : v);
/** Lleva cada fila al ancho A..X con '' donde la API recortó (Sheets omite las celdas vacías del final). */
export function normalizar(valores) {
  return (Array.isArray(valores) ? valores : []).map((f) => Array.from({ length: ANCHO }, (_, j) => celda(Array.isArray(f) ? f[j] : undefined)));
}
const columna = (m, j, n = m.length) => Array.from({ length: n }, (_, i) => celda(m[i]?.[j]));
const iguales = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const filas = (m) => m.slice(1);
const contarCol = (m, j) => filas(m).filter((f) => lleno(f[j])).length;
const noTexto = (m, j) => filas(m).filter((f) => lleno(f[j]) && typeof f[j] !== 'string').length;
const hayFormula = (m, j) => filas(m).some((f) => typeof f[j] === 'string' && f[j].startsWith('='));

/** Cuántas celdas difieren entre dos columnas (solo el número). */
function diferencias(a, b) {
  const n = Math.max(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i++) if (JSON.stringify(celda(a[i])) !== JSON.stringify(celda(b[i]))) d += 1;
  return d;
}

/** Los títulos de A..T tienen que ser los del mapa: si el equipo movió columnas, se escribiría en las equivocadas. */
export function encabezadosAT(encabezado, mapa) {
  const esperados = [];
  for (const c of [...Object.values(mapa.columnas), ...Object.values(mapa.equipo)]) {
    const j = c.letra.charCodeAt(0) - 65;
    if (j <= 19) esperados[j] = c.titulo;
  }
  return esperados.map((t, j) => (t !== undefined && String(encabezado[j] ?? '').trim() !== t ? j : null)).filter((j) => j !== null);
}

function titulos(mapa) {
  return {
    u: mapa.columnas.servicioElegido.titulo, v: mapa.columnas.agendo.titulo, w: mapa.columnas.fechaCita.titulo,
    diag: mapa.equipo.diagnostico.titulo,
  };
}

const rango = (letra, desde, hasta) => (desde === hasta ? `${letra}${desde}` : `${letra}${desde}:${letra}${hasta}`);

// ===========================================================================
// RESPALDOS (archivo 0600, nunca se pisa; no se imprime su contenido)
// ===========================================================================
export function nombreRespaldo(ahora) {
  const lp = new Date(ahora.getTime() - 4 * 3600 * 1000); // America/La_Paz, UTC-4 fijo
  const p = (n) => String(n).padStart(2, '0');
  return `BELLIDO_planilla-respaldo_${lp.getUTCFullYear()}-${p(lp.getUTCMonth() + 1)}-${p(lp.getUTCDate())}-${p(lp.getUTCHours())}${p(lp.getUTCMinutes())}.json`;
}
export const diaDe = (ahora) => nombreRespaldo(ahora).match(NOMBRE_RESPALDO)[1];

export function respaldosEnDisco(dir = DIR_RESPALDOS) {
  const guardar = (nombre, objeto) => {
    if (!NOMBRE_RESPALDO.test(nombre)) throw new Error('nombre de respaldo inválido');
    const ruta = join(dir, nombre);
    const fd = openSync(ruta, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeSync(fd, JSON.stringify(objeto)); chmodSync(ruta, 0o600); } finally { closeSync(fd); }
    return ruta;
  };
  const listar = () => {
    try { return readdirSync(dir).filter((n) => NOMBRE_RESPALDO.test(n)).sort().map((nombre) => ({ nombre, ruta: join(dir, nombre) })); } catch { return []; }
  };
  const leer = (ruta) => {
    let fd;
    try {
      const l = lstatSync(ruta);
      if (!l.isFile()) return { ok: false, motivo: 'el respaldo no es un archivo regular (¿enlace?)' };
      fd = openSync(ruta, constants.O_RDONLY | constants.O_NOFOLLOW);
      const s = fstatSync(fd);
      if ((s.mode & 0o077) !== 0) return { ok: false, motivo: 'el respaldo tiene permisos de más (debe ser 0600)' };
      if (s.size > 64 * 1024 * 1024) return { ok: false, motivo: 'el respaldo es demasiado grande' };
      return { ok: true, respaldo: JSON.parse(readFileSync(fd, 'utf8')) };
    } catch { return { ok: false, motivo: 'no se pudo leer el respaldo' }; } finally { if (fd !== undefined) closeSync(fd); }
  };
  return { guardar, listar, leer, dir };
}

/** Forma del respaldo; devuelve la matriz normalizada o null. */
function matrizDeRespaldo(r, mapa, hojaFin) {
  if (r?.hojaFin !== hojaFin) return null;
  if (r?.version !== 1 || r.campo !== 'planilla-u-a-x' || r.tenant !== TENANT || r.hoja !== HOJA || r.filaEncabezados !== mapa.filaEncabezados
      || !Array.isArray(r.valores) || r.valores.length === 0) return null;
  return normalizar(r.valores);
}

/** La columna A (ID) de la hoja tiene que ser la del respaldo en las filas que el respaldo tiene (y la hoja no puede tener menos). */
const mismaA = (hoja, resp) => hoja.length >= resp.length && diferencias(columna(hoja, 0, resp.length), columna(resp, 0)) === 0;

/** Elige el respaldo: el pedido, o el más reciente (con `mismoDia`, solo uno de hoy). */
function elegirRespaldo({ cfg, deps, ahora, mismoDia }) {
  const lista = deps.respaldos.listar();
  let ruta = cfg.respaldo;
  if (ruta === null) {
    const candidatos = mismoDia ? lista.filter((x) => x.nombre.match(NOMBRE_RESPALDO)[1] === diaDe(ahora)) : lista;
    if (candidatos.length === 0) return { ok: false, motivo: mismoDia ? 'no hay un respaldo de HOY: corra primero «respaldar --aplicar»' : 'no hay respaldos en la carpeta de descargas' };
    ruta = candidatos.at(-1).ruta;
  } else if (mismoDia) {
    const m = String(ruta).split('/').at(-1).match(NOMBRE_RESPALDO);
    if (!m || m[1] !== diaDe(ahora)) return { ok: false, motivo: 'el respaldo indicado no es del mismo día' };
  }
  const l = deps.respaldos.leer(ruta);
  if (!l.ok) return l;
  return { ok: true, respaldo: l.respaldo, ruta };
}

// ===========================================================================
// NÚCLEO
// deps = { leer(): Promise<valores A{fila}:X crudos>, escribir(rango A1, valores2D): Promise, limpiar(rango A1): Promise,
//          respaldos: {guardar, listar, leer}, ahora(): Date }
// Los rangos son A1 sin el nombre de la hoja (la dependencia real lo agrega): U4:U120.
// ===========================================================================
export async function ejecutar(cfg, deps, mapa, log = (t) => console.log(t)) {
  const ahora = deps.ahora ? deps.ahora() : new Date();
  const fe = mapa.filaEncabezados; // 3
  const T = titulos(mapa);
  const leerNorm = async () => normalizar(await deps.leer());

  const hoja = await leerNorm();
  if (hoja.length === 0) { log('\n  ✗ la hoja no se pudo leer (fila de encabezados vacía): no se escribe nada.\n'); return 3; }
  const enc = hoja[0];
  const malos = encabezadosAT(enc, mapa);
  if (malos.length) { log(`\n  ✗ Los encabezados de la fila ${fe} en A..T no son los del mapa (${malos.length} distinto/s): no se escribe nada.\n`); return 2; }

  const cuenta = { U: contarCol(hoja, COL.U), V: contarCol(hoja, COL.V), W: contarCol(hoja, COL.W), X: contarCol(hoja, COL.X) };
  const ultima = fe + hoja.length - 1;
  const rotulo = `${cfg.aplicar ? 'APLICAR' : 'SECO'} · ${cfg.modo}${cfg.revertir ? ' --revertir' : ''} · hoja ${HOJA} (id termina en …${cfg.hojaFin ?? '??????'})`;
  const resumen = () => {
    log(`  filas de datos leídas : ${hoja.length - 1} (hasta la fila ${ultima})`);
    log(`  títulos fila ${fe}      : U=«${enc[COL.U]}» · V=«${enc[COL.V]}» · W=«${enc[COL.W]}» · X=«${enc[COL.X]}»`);
    log(`  filas con dato        : U=${cuenta.U} · V=${cuenta.V} · W=${cuenta.W} · X=${cuenta.X}`);
  };

  // ---------------------------------------------------------------- contar
  if (cfg.modo === 'contar') {
    log(`\n  LECTURA · contar · hoja ${HOJA} (id termina en …${cfg.hojaFin ?? '??????'})`);
    resumen();
    log(`  celdas de U que no son texto (números, fechas, booleanos): ${noTexto(hoja, COL.U)}`);
    const u3 = String(enc[COL.U]).trim();
    const estadoU = u3 === T.diag ? 'U3 es «Diagnóstico del equipo»: falta trasladar' : u3 === T.u ? 'U3 ya es «Servicio elegido»' : 'U3 tiene un título inesperado';
    log(`  ${u3 === T.diag ? '✓' : '!'} ${estadoU}\n`);
    return u3 === T.diag || u3 === T.u ? 0 : 2;
  }

  // ------------------------------------------------------------- respaldar
  if (cfg.modo === 'respaldar') {
    log(`\n  ${rotulo}`);
    resumen();
    if (hayFormula(hoja, COL.U) || hayFormula(hoja, COL.X)) { log('\n  ✗ Hay fórmulas en U o X: este script no las traslada. Revise la hoja a mano.\n'); return 2; }
    if (!cfg.aplicar) { log('\n  Seco: no se guardó nada. Agregue --aplicar --confirmo-hoja <últimos 6>.\n'); return 1; }
    const nombre = nombreRespaldo(ahora);
    let ruta;
    try {
      ruta = deps.respaldos.guardar(nombre, { version: 1, campo: 'planilla-u-a-x', tenant: TENANT, hoja: HOJA, filaEncabezados: fe, hojaFin: cfg.hojaFin, rango: `A${fe}:X`, creadoEn: ahora.toISOString(), valores: hoja.map((f) => f.map((v, j) => (j === 0 || j >= COL.U ? v : ''))) });
    } catch (e) {
      if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un respaldo con ese nombre (mismo minuto): un respaldo nunca se pisa. Espere un minuto.\n'); return 2; }
      throw e;
    }
    log(`\n  ✓ Respaldo de A${fe}:X (datos de personas, modo 600): ${ruta}\n`);
    return 0;
  }

  // ------------------------------------------------------------- trasladar
  if (cfg.revertir) return revertir({ cfg, deps, mapa, log, ahora, hoja, enc, cuenta, rotulo, resumen, T, fe });

  log(`\n  ${rotulo}`);
  resumen();
  if (String(enc[COL.U]).trim() !== T.diag) { log(`\n  ✗ U${fe} no es «${T.diag}»: no hay nada que trasladar (¿ya se hizo?). No se escribe nada.\n`); return 2; }
  if (cuenta.X > 0 || lleno(enc[COL.X])) { log('\n  ✗ La columna X ya tiene datos o título: no se pisa. No se escribe nada.\n'); return 2; }
  if (cuenta.V > 0 || cuenta.W > 0 || lleno(enc[COL.V]) || lleno(enc[COL.W])) { log('\n  ✗ V o W ya tienen datos o título (inesperado). No se escribe nada.\n'); return 2; }
  if (hayFormula(hoja, COL.U)) { log('\n  ✗ Hay fórmulas en U: este script no las traslada. No se escribe nada.\n'); return 2; }
  const r = elegirRespaldo({ cfg, deps, ahora, mismoDia: true });
  if (!r.ok) { log(`\n  ✗ ${r.motivo}. No se escribe nada.\n`); return 2; }
  const resp = matrizDeRespaldo(r.respaldo, mapa, cfg.hojaFin);
  if (resp === null) { log('\n  ✗ el respaldo no es de esta planilla o no tiene la forma esperada. No se escribe nada.\n'); return 2; }
  if (!mismaA(hoja, resp)) { log('\n  ✗ La columna A (ID) de la hoja no coincide con la del respaldo (¿otra planilla, filas movidas o borradas?). No se escribe nada.\n'); return 2; }
  if (noTexto(hoja, COL.U) > 0) { log(`\n  ✗ ${noTexto(hoja, COL.U)} celda/s de U no son texto (número, fecha o booleano): RAW podría cambiarlas. No se escribe nada.\n`); return 2; }
  const n = Math.max(hoja.length, resp.length);
  for (const j of [COL.U, COL.V, COL.W, COL.X]) {
    if (diferencias(columna(resp, j, n), columna(hoja, j, n)) > 0) {
      log('\n  ✗ Las columnas U..X de la hoja ya no son las del respaldo (alguien las cambió después): vuelva a «respaldar --aplicar». No se escribe nada.\n'); return 2;
    }
  }
  log(`  ✓ respaldo de hoy coincide con U..X de la hoja (${r.ruta.split('/').at(-1)})`);
  if (!cfg.aplicar) { log(`\n  Seco: copiaría U${fe}:U${ultima} a X${fe}:X${ultima}, vaciaría U${fe + 1}:U${ultima} y pondría los títulos U..W. Agregue --aplicar --confirmo-hoja <últimos 6>.\n`); return 1; }

  // El bot sigue vivo: si U..X cambió entre la primera lectura y ahora, se corta.
  const otra = await leerNorm();
  for (const j of [COL.U, COL.V, COL.W, COL.X]) {
    if (otra.length !== hoja.length || !iguales(columna(otra, j), columna(hoja, j))) { log('\n  ✗ La hoja cambió mientras se preparaba: no se escribe nada. Vuelva a correr el seco.\n'); return 3; }
  }
  const aU = hoja.length; // filas fe..ultima
  await deps.escribir(rango('X', fe, ultima), columna(hoja, COL.U, aU).map((v) => [v]));
  const tras = await leerNorm();
  const esperado = columna(resp, COL.U, Math.max(tras.length, resp.length));
  const dif = diferencias(columna(tras, COL.X, esperado.length), esperado);
  // Antes de vaciar U: la hoja tiene las mismas filas y U sigue siendo, celda por celda, la del respaldo (nadie escribió en el medio).
  const uCambio = tras.length !== hoja.length || diferencias(columna(tras, COL.U, esperado.length), esperado) > 0;
  if (uCambio) {
    log('\n  ✗ Entre la copia y el vaciado la hoja cambió (otro número de filas o U distinta del respaldo). NO se vació U. Revise; X ya tiene la copia: trasladar --revertir la quita.\n');
    return 3;
  }
  if (dif > 0) {
    log(`\n  ✗ La relectura de X no coincide con el respaldo (${dif} celda/s distintas). NO se vació U. Revise; si hace falta, trasladar --revertir.\n`);
    return 3;
  }
  log(`  ✓ X releída: ${aU} celdas iguales al respaldo (celda por celda)`);
  if (ultima > fe) await deps.limpiar(rango('U', fe + 1, ultima));
  await deps.escribir(`U${fe}:W${fe}`, [[T.u, T.v, T.w]]);
  const fin = await leerNorm();
  const t = (j) => String(fin[0][j]).trim();
  const bien = t(COL.U) === T.u && t(COL.V) === T.v && t(COL.W) === T.w && t(COL.X) === T.diag
    && contarCol(fin, COL.U) === 0 && contarCol(fin, COL.V) === 0 && contarCol(fin, COL.W) === 0
    && diferencias(columna(fin, COL.X, esperado.length), esperado) === 0;
  if (!bien) { log('\n  ✗ La relectura final no coincide (títulos, U vacía o X). Revise la hoja; «trasladar --revertir» la devuelve al respaldo.\n'); return 3; }
  log(`  ✓ U${fe + 1}:U${ultima} vaciada, títulos U..W escritos; X conserva el diagnóstico (${contarCol(fin, COL.X)} filas).`);
  log('  Reversa lista: trasladar --revertir (restaura U desde el respaldo y vacía V, W, X). Otras columnas y hojas no se tocaron.\n');
  return 0;
}

async function revertir({ cfg, deps, mapa, log, ahora, hoja, enc, cuenta, rotulo, resumen, T, fe }) {
  log(`\n  ${rotulo}`);
  resumen();
  const r = elegirRespaldo({ cfg, deps, ahora, mismoDia: false });
  if (!r.ok) { log(`\n  ✗ ${r.motivo}. No se escribe nada.\n`); return 2; }
  const resp = matrizDeRespaldo(r.respaldo, mapa, cfg.hojaFin);
  if (resp === null) { log('\n  ✗ el respaldo no es de esta planilla o no tiene la forma esperada. No se escribe nada.\n'); return 2; }
  if (String(resp[0][COL.U]).trim() !== T.diag) { log('\n  ✗ el respaldo no trae «Diagnóstico del equipo» en U: no sirve para revertir. No se escribe nada.\n'); return 2; }
  if (!mismaA(hoja, resp)) { log('\n  ✗ La columna A (ID) de la hoja no coincide con la del respaldo: no se revierte, ni siquiera con --acepto-perder-datos-nuevos. No se escribe nada.\n'); return 2; }
  const n = Math.max(hoja.length, resp.length);
  const respU = columna(resp, COL.U, n);
  // Lo que se va a pisar o vaciar: U (si ya tiene datos distintos), V, W y X (si no es copia del respaldo). Todo lo que no es «nuestro» se protege.
  const hoyU = columna(hoja, COL.U, n);
  const uDistinta = !hoyU.slice(1).every((v) => !lleno(v)) && diferencias(hoyU.slice(1), respU.slice(1)) > 0;
  const xAjena = cuenta.X > 0 && diferencias(columna(hoja, COL.X, n), respU) > 0;
  const nuevos = cuenta.V + cuenta.W + (uDistinta ? 1 : 0) + (xAjena ? 1 : 0);
  if (nuevos > 0 && !cfg.aceptoPerder) {
    log('\n  ✗ Revertir pisaría datos que NO están en el respaldo (V/W con datos, U con datos nuevos o X distinta de lo respaldado). No se escribe nada. --acepto-perder-datos-nuevos lo permite.\n');
    return 2;
  }
  const ultima = fe + n - 1;
  if (!cfg.aplicar) { log(`\n  Seco: restauraría U${fe}:U${ultima} desde el respaldo y vaciaría V${fe}:X${ultima}. Agregue --aplicar --confirmo-hoja <últimos 6>.\n`); return 1; }
  await deps.escribir(rango('U', fe, ultima), respU.map((v) => [v]));
  await deps.limpiar(`V${fe}:X${ultima}`);
  const fin = await normalizar(await deps.leer());
  const bien = diferencias(columna(fin, COL.U, n), respU) === 0
    && [COL.V, COL.W, COL.X].every((j) => columna(fin, j, n).every((v) => !lleno(v)));
  if (!bien) { log('\n  ✗ La relectura tras revertir no coincide: revise la hoja a mano (el respaldo sigue intacto).\n'); return 3; }
  log(`  ✓ Revertido: U restaurada desde el respaldo (${contarCol(fin, COL.U)} filas) y V, W, X vacías.\n`);
  return 0;
}

// ===========================================================================
// RED: la hoja pasa por un flujo TEMPORAL de n8n con la credencial del miniCRM de Bellido
// ===========================================================================
const urlHoja = (sheet, ruta) => `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheet)}/values/${ruta}`;

/**
 * REGLA de las expresiones de n8n: el analizador corta en el PRIMER «}}». Por eso la expresión NO lleva JSON incrustado con llaves
 * seguidas: el dato viaja en el cuerpo de la entrada y la expresión solo lo lee. Prueba: «una sola llave doble de cierre».
 */
export const expresionEscribir = (rangoA1) => `={{ JSON.stringify({ range: ${JSON.stringify(`'${HOJA}'!${rangoA1}`)}, majorDimension: 'ROWS', values: $('Entrada').first().json.body.valores }) }}`;

/**
 * EL ERROR DE GOOGLE, VISIBLE SIN FILTRAR NADA. El nodo HTTP del flujo temporal no corta ante un 4xx/5xx (`neverError` + respuesta completa)
 * y un nodo Code posterior deja pasar, si fue un error, SOLO: el estado HTTP numérico, `error.status` y el primer `reason` de Google, y
 * solo si tienen forma de constante (MAYÚSCULAS_Y_GUIONES). Nunca el mensaje (puede nombrar el id o el rango), nunca el cuerpo, nunca la URL.
 * Si la respuesta es 2xx, pasa el cuerpo tal cual (los valores de la hoja, que solo se usan en memoria).
 */
export const CODIGO_FILTRO = `const r = $input.first().json;
const cte = (v) => (typeof v === 'string' && /^[A-Z][A-Z0-9_]{2,59}$/.test(v) ? v : null);
const st = Number.isInteger(r.statusCode) ? r.statusCode : (r.error && Number.isInteger(Number(r.error.httpCode)) ? Number(r.error.httpCode) : 0);
if (st >= 200 && st < 300 && r.body !== undefined) return [{ json: (r.body && typeof r.body === 'object') ? r.body : {} }];
const e = (r.body && typeof r.body === 'object' && r.body.error && typeof r.body.error === 'object') ? r.body.error : {};
const d = Array.isArray(e.details) ? e.details.find((x) => x && cte(x.reason)) : null;
return [{ json: { __errorGoogle: true, estado: st, google: cte(e.status), razon: d ? cte(d.reason) : null } }];`;

/** Un paso contra Google: el nodo HTTP que no corta ante errores y el filtro que deja solo el motivo. */
export function pasoSeguro(http, id, nombre, x, parametros) {
  const h = http(id, nombre, x, { ...parametros, options: { timeout: 30000, response: { response: { neverError: true, fullResponse: true, responseFormat: 'json' } } } });
  h.onError = 'continueRegularOutput';
  const filtro = { id: `${id}-motivo`, name: `${nombre} (motivo)`, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x + 120, 0], parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: CODIGO_FILTRO } };
  return [h, filtro];
}

/** Si el resultado es el motivo de un error de Google, lanza con un texto sin id ni celdas; si no, lo devuelve. */
export function interpretar(r) {
  if (r && r.__errorGoogle === true) {
    const cte = (v) => (typeof v === 'string' && /^[A-Z][A-Z0-9_]{2,59}$/.test(v) ? v : null);
    const estado = Number.isInteger(r.estado) ? r.estado : 0;
    const partes = [estado ? String(estado) : 'sin respuesta', cte(r.google), cte(r.razon) ? `(${cte(r.razon)})` : null].filter(Boolean);
    throw Object.assign(new Error('google'), { code: `google-${estado}`, motivo: `Google respondió ${partes.join(' ')}` });
  }
  return r;
}

export function depsDeRed({ envFile, sheet }) {
  const base = { envFile, tenant: TENANT };
  const urlRango = (a1) => encodeURIComponent(`'${HOJA}'!${a1}`);
  return {
    leer: async () => {
      const r = interpretar(await correrEnN8n({ ...base, hacer: ({ http }) => ({ nodos: pasoSeguro(http, 'leer', 'Leer', 240, { method: 'GET', url: `${urlHoja(sheet, urlRango('A3:X'))}?valueRenderOption=FORMULA` }) }) }));
      return Array.isArray(r.values) ? r.values : [];
    },
    escribir: async (a1, valores) => interpretar(await correrEnN8n({ ...base, cuerpo: { valores }, hacer: ({ http }) => ({ nodos: pasoSeguro(http, 'escribir', 'Escribir', 240, {
      method: 'PUT', url: `${urlHoja(sheet, urlRango(a1))}?valueInputOption=RAW`, sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expresionEscribir(a1) }) }) })),
    limpiar: async (a1) => interpretar(await correrEnN8n({ ...base, hacer: ({ http }) => ({ nodos: pasoSeguro(http, 'limpiar', 'Limpiar', 240, { method: 'POST', url: `${urlHoja(sheet, urlRango(a1))}:clear` }) }) })),
    respaldos: respaldosEnDisco(),
    ahora: () => new Date(),
  };
}

async function principal() {
  const a = analizarArgumentos(process.argv.slice(2));
  if (!a.ok) { console.error(`\n  ✗ ${a.problemas.join('\n  ✗ ')}\n\n${USO}\n`); process.exit(2); }
  const codigo = await ejecutar(a.cfg, depsDeRed({ envFile: process.env.ENV_FILE, sheet: process.env.SHEET_ID }), leerMapa());
  process.exit(estado.limpiezaFallida ? 3 : codigo);
}

function seEjecutaDirecto() {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}
if (seEjecutaDirecto()) {
  try { await principal(); } catch (e) { console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}${e?.motivo ? ` · ${e.motivo}` : ''}\n`); process.exit(3); }
}
