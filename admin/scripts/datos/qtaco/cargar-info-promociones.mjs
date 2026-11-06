/**
 * AGREGAR LAS PROMOCIONES VIGENTES DE Q'TACO A SUS INSTRUCCIONES — EN SECO POR DEFECTO.
 *
 * POR QUÉ. El revisor de campañas del servidor (`modulos/campanas/verificarCampanas.ts`) rechazó las dos campañas de Q'Taco (tortas mexicanas y
 * Jueves de +2) porque su contexto (nombre, descripción, catálogo activo e `instruccionesVigentes`) no respalda sus promesas. `instruccionesVigentes`
 * no se escribe a mano: el comercio escribe `config/negocio.instruccionesExtra` y el servidor (`verificarComportamiento`) lo revisa y, si aprueba,
 * lo copia a vigentes. Este script AGREGA al final de `instruccionesExtra` un bloque de hechos, delimitado por un marcador, y espera el veredicto.
 *
 *   node admin/scripts/datos/qtaco/cargar-info-promociones.mjs --proyecto <id>                                                  # EN SECO
 *   node admin/scripts/datos/qtaco/cargar-info-promociones.mjs --proyecto <id> --respaldo <ruta> --aplicar [--confirmo-produccion qtaco]
 *   node admin/scripts/datos/qtaco/cargar-info-promociones.mjs --proyecto <id> --revertir --respaldo <ruta> [--aplicar] [--confirmo-produccion qtaco]
 *
 * El comercio es FIJO: `qtaco` (un `--tenant` distinto se rechaza). NUNCA reemplaza ni recorta lo existente: agrega el bloque al final. Si lo existente
 * más el bloque supera el tope del servidor (1500) o no pasa la capa 1 (patrones) del servidor, se detiene sin escribir. IDEMPOTENTE: si el marcador
 * ya está, no hace nada (sale 0).
 *
 * QUÉ ESCRIBE (solo con `--aplicar`): un `update` del campo `instruccionesExtra` de `tenants/qtaco/config/negocio`, con precondición `lastUpdateTime`
 * (si alguien escribió el documento entre la lectura y la escritura, no se escribe). NO escribe `instruccionesVigentes` ni `instruccionesRevision`:
 * los escribe SOLO el servidor. Tras escribir espera hasta ~90 s a que `instruccionesRevision.hash` sea el del texto escrito y reporta el estado.
 *
 * RESPALDO (obligatorio con `--aplicar`): ruta absoluta fuera de todo repositorio, carpeta 0700, archivo 0600, nunca pisa. Guarda el `instruccionesExtra`
 * previo completo y el `instruccionesVigentes` y el hash de revisión previos (es texto del negocio, no secreto, pero no se imprime).
 *
 * RUNBOOK. Los precios y la vigencia del bloque son hechos fijos: si cambia un precio o termina la promoción, correr `--revertir --respaldo` o publicar una
 * versión nueva del bloque (otro marcador, con otra fecha); mientras el marcador esté, el script no vuelve a escribir.
 *
 * REVERSA (`--revertir --respaldo`): restaura el `instruccionesExtra` previo SOLO si el campo sigue idéntico a lo que escribió este script.
 *
 * SALIDA. 0 correcto (seco, nada que hacer, o escritura aprobada por el servidor); 1 rechazo del comercio, de los datos o del servidor (o sin veredicto
 * a tiempo); 2 uso, salvaguarda o respaldo; 3 error de ejecución. COSTO: seco, lecturas; `--aplicar`, 1 escritura (más las del servidor). 0 mensajes por conversación.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { comprobarProyecto, comprobarRespaldo, guardarRespaldo } from '../../plataforma/aplicar-consola-oculta.mjs';

const { hashCorto, verificarPatrones, TOPE_INSTRUCCIONES } = await import('../../../functions/src/central/asistente/comportamiento.ts');

export const TENANT = 'qtaco';
export const MARCADOR = 'Promociones vigentes al 06/11/2026:';
/** Los hechos de las dos promociones. Vocabulario neutro: sin imperativos al asistente, sin nombres de producto de otros ni palabras de pago. */
export const BLOQUE = `${MARCADOR} `
  + 'Promoción Tortas mexicanas: la torta mexicana sin queso cuesta Bs 15 y con queso Bs 20; ambas incluyen salsa mexicana especial; '
  + 'se pueden pedir para recoger en el local o por delivery. '
  + 'Promoción Jueves de +2: solo los jueves, para consumo en el restaurante; '
  + "el Q'Taco Dúo regular cuesta Bs 170; los jueves, por Bs 8 más, lleva 2 tacos extra (6 en total) y cuesta Bs 178 para 2 personas; se atiende con reserva de mesa.";
export const ESPERA_REVISION_MS = 90_000;
export const PAUSA_REVISION_MS = 2_000;
const CON_VALOR = ['proyecto', 'tenant', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];
const SEPARADOR = '\n\n';

export const USO = '  node admin/scripts/datos/qtaco/cargar-info-promociones.mjs --proyecto <id> [--respaldo <ruta> --aplicar] [--confirmo-produccion qtaco]\n'
  + '  node admin/scripts/datos/qtaco/cargar-info-promociones.mjs --proyecto <id> --revertir --respaldo <ruta> [--aplicar] [--confirmo-produccion qtaco]';

// ===========================================================================
// PURAS
// ===========================================================================
const texto = (v) => (typeof v === 'string' ? v : '');

/** El texto final: lo existente intacto + el bloque al final. Si ya trae el marcador, devuelve lo existente (nada que agregar). */
export function textoFinal(existente) {
  const actual = texto(existente);
  if (actual.includes(MARCADOR)) return actual;
  return actual.trim() === '' ? BLOQUE : `${actual.trimEnd()}${SEPARADOR}${BLOQUE}`;
}

/** Los problemas del texto final frente al servidor (tope y capa 1). `otros`: ids y nombres de los demás comercios. Lista vacía si pasa. */
export function problemasDelTexto(final, otros = { ids: [], nombres: [] }) {
  const p = [];
  if (final.length > TOPE_INSTRUCCIONES) p.push(`el texto final tendría ${final.length} caracteres y el tope del servidor es ${TOPE_INSTRUCCIONES}: no se recorta nada ajeno; hay que decidir qué ceder`);
  const r = verificarPatrones(final, otros);
  if (r.nivel === 'rechazado') p.push(`la capa 1 del servidor (patrones) lo rechazaría: ${String(r.motivo).slice(0, 200)}`);
  return p;
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
      problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40)}`);
    }
  }
  const aplicar = banderas.includes('aplicar');
  const revertir = banderas.includes('revertir');
  const { proyecto, respaldo } = valores;
  const confirmo = valores['confirmo-produccion'];
  if ('tenant' in valores && valores.tenant !== TENANT) problemas.push(`este script es SOLO del comercio «${TENANT}»: --tenant distinto, no se escribe nada`);
  if (proyecto === undefined) problemas.push('falta --proyecto');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto !== undefined && !proy.ok) problemas.push(proy.motivo);
  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== TENANT) problemas.push(`--confirmo-produccion tiene que ser «${TENANT}»`);
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) {
    problemas.push(`contra producción, --aplicar exige --confirmo-produccion ${TENANT}`);
  }
  if (revertir && respaldo === undefined) problemas.push('--revertir exige --respaldo <ruta>');
  if (!revertir && aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta> (por omisión no hay respaldo)');
  let respaldoReal = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: revertir });
    if (r.ok) respaldoReal = respaldo; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, aplicar, revertir, respaldo: respaldoReal } };
}

// ===========================================================================
// RESPALDO
// ===========================================================================
/** Lo que se guarda: lo previo completo de los tres campos y lo que se escribió. Texto del negocio, sin secretos. */
export function contenidoDelRespaldo({ entorno, previo, escrito }) {
  return {
    version: 1, entorno, tenant: TENANT, creadoEn: new Date().toISOString(),
    previo: { presente: previo.presente, instruccionesExtra: previo.extra, instruccionesVigentes: previo.vigentes, revisionHash: previo.revisionHash },
    escrito: { instruccionesExtra: escrito, hash: hashCorto(escrito) },
  };
}

const MAXIMO_RESPALDO = 64 * 1024;
const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const cadenaOpcional = (v) => v === null || (typeof v === 'string' && v.length <= TOPE_INSTRUCCIONES * 4);

/** El respaldo se LEE con desconfianza: lo que trae se vuelve a escribir en producción. */
export function validarContenidoDelRespaldo(r) {
  if (!esObjeto(r) || r.version !== 1 || !esObjeto(r.previo) || !esObjeto(r.escrito)) return 'el respaldo no tiene la forma esperada';
  if (typeof r.previo.presente !== 'boolean' || !cadenaOpcional(r.previo.instruccionesExtra) || !cadenaOpcional(r.previo.instruccionesVigentes)) return 'el respaldo trae un texto previo con forma inválida';
  if (r.previo.presente !== (r.previo.instruccionesExtra !== null)) return 'el respaldo es incoherente: presencia y texto previo no coinciden';
  const e = r.escrito.instruccionesExtra;
  if (typeof e !== 'string' || !e.includes(MARCADOR) || e.length > TOPE_INSTRUCCIONES || r.escrito.hash !== hashCorto(e)) return 'el respaldo trae un texto escrito que no es el de este script';
  if (r.previo.instruccionesExtra !== null && r.previo.instruccionesExtra.includes(MARCADOR)) return 'el respaldo es incoherente: el texto previo ya traía el marcador';
  return null;
}

export function leerRespaldoDeInfo(ruta, entorno) {
  let r;
  let fd;
  try {
    fd = openSync(ruta, constants.O_RDONLY | constants.O_NOFOLLOW);
    const st = fstatSync(fd);
    if (!st.isFile()) return { ok: false, motivo: 'el respaldo no es un archivo regular' };
    if (st.size > MAXIMO_RESPALDO) return { ok: false, motivo: 'el respaldo es demasiado grande' };
    r = JSON.parse(readFileSync(fd, 'utf8'));
  } catch { return { ok: false, motivo: 'el respaldo no se pudo abrir ni leer como JSON' }; } finally { if (fd !== undefined) closeSync(fd); }
  if (esObjeto(r) && r.tenant !== TENANT) return { ok: false, motivo: 'el respaldo es de otro comercio' };
  if (esObjeto(r) && r.entorno !== entorno) return { ok: false, motivo: 'el respaldo es de otro entorno (staging, produccion o emulador)' };
  const malo = validarContenidoDelRespaldo(r);
  if (malo) return { ok: false, motivo: malo };
  return { ok: true, respaldo: r };
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================
async function otrosComercios(db) {
  const todos = await db.collection('tenants').select('nombre').get();
  const ids = [];
  const nombres = [];
  for (const d of todos.docs) {
    if (d.id === TENANT) continue;
    ids.push(d.id);
    const nombre = d.get('nombre');
    if (typeof nombre === 'string') nombres.push(nombre);
  }
  return { ids, nombres };
}

/** Corre la operación ya validada. Devuelve el código de salida. `deps`: `{ db, FieldValue, log, esperaMs, pausaMs }`. */
export async function ejecutar(cfg, deps) {
  const { db, FieldValue } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const rotulo = `${cfg.entorno} · tenant ${TENANT}`;
  const ref = db.doc(`tenants/${TENANT}/config/negocio`);
  const refTenant = db.doc(`tenants/${TENANT}`);

  // ------------------------------------------------------------------ revertir
  if (cfg.revertir) {
    const lectura = leerRespaldoDeInfo(cfg.respaldo, cfg.entorno);
    if (!lectura.ok) { log(`\n  ✗ ${lectura.motivo}\n`); return 2; }
    const { previo, escrito } = lectura.respaldo;
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO (solo lecturas)'} · ${rotulo}\n`);
    const snap = await ref.get();
    if (!snap.exists) { log('  ✗ No existe config/negocio: nada que revertir.\n'); return 2; }
    const actual = texto(snap.get('instruccionesExtra'));
    if (actual !== escrito.instruccionesExtra) {
      log(actual.includes(MARCADOR)
        ? '  ✗ El texto de hoy ya no es el que escribió este script: alguien lo cambió después. Revertir pisaría ese cambio. No se escribe nada.\n'
        : '  ✓ El bloque ya no está en las instrucciones: nada que revertir.\n');
      return actual.includes(MARCADOR) ? 2 : 0;
    }
    log(`  restaura las instrucciones previas (${previo.presente ? `${previo.instruccionesExtra.length} caracteres` : 'el campo no existía'}) · quita ${escrito.instruccionesExtra.length - (previo.instruccionesExtra ?? '').length} caracteres`);
    if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar para revertir.\n'); return 0; }
    try {
      await ref.update({ instruccionesExtra: previo.presente ? previo.instruccionesExtra : FieldValue.delete() }, { lastUpdateTime: snap.updateTime });
    } catch (e) { log(`  ✗ no se escribió (${e?.code ?? e?.name ?? 'desconocido'}): el documento cambió o hubo un error. Vuelva a correr.\n`); return 3; }
    log('  ✓ Revertido. El servidor vuelve a revisar el texto restaurado (no se espera su veredicto).\n');
    return 0;
  }

  // -------------------------------------------------------- seco y aplicar
  const tenant = await refTenant.get();
  if (!tenant.exists) { log(`\n  ✗ No existe el comercio «${TENANT}».\n`); return 1; }
  if ((tenant.get('estado') ?? 'activo') !== 'activo') { log(`\n  ✗ «${TENANT}» no está activo: no se reconfigura.\n`); return 1; }
  const snap = await ref.get();
  if (!snap.exists) { log(`\n  ✗ No existe config/negocio de «${TENANT}»: este script no lo crea.\n`); return 1; }
  const existente = texto(snap.get('instruccionesExtra'));
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)'} · ${rotulo}\n`);

  if (existente.includes(MARCADOR)) {
    const rev = snap.get('instruccionesRevision');
    const estado = rev && typeof rev === 'object' && rev.hash === hashCorto(existente) ? String(rev.estado) : 'sin revisión de este texto';
    log(`  ✓ El bloque ya está en las instrucciones (${existente.length} caracteres; revisión del servidor: ${estado}). Nada que hacer.\n`);
    return 0;
  }
  const final = textoFinal(existente);
  log(`  longitud actual: ${existente.length} · longitud añadida: ${final.length - existente.length} · longitud final: ${final.length} (tope ${TOPE_INSTRUCCIONES})`);
  log(`\n  Bloque a agregar al final:\n    ${BLOQUE}\n`);
  const problemas = problemasDelTexto(final, await otrosComercios(db));
  if (problemas.length) { log(`  ✗ No se escribe nada:\n    - ${problemas.join('\n    - ')}\n`); return 1; }
  log('  ✓ El texto final cabe y pasa la capa 1 (patrones) del servidor; la capa 2 (modelo) solo se sabe al escribir.');
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --respaldo <ruta> y --aplicar.\n'); return 0; }

  try {
    guardarRespaldo(cfg.respaldo, contenidoDelRespaldo({
      entorno: cfg.entorno, escrito: final,
      previo: {
        presente: snap.get('instruccionesExtra') !== undefined && typeof snap.get('instruccionesExtra') === 'string',
        extra: typeof snap.get('instruccionesExtra') === 'string' ? snap.get('instruccionesExtra') : null,
        vigentes: typeof snap.get('instruccionesVigentes') === 'string' ? snap.get('instruccionesVigentes') : null,
        revisionHash: snap.get('instruccionesRevision')?.hash ?? null,
      },
    }));
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa; elija otro nombre. No se escribe nada.\n'); return 2; }
    throw e;
  }
  log(`\n  Respaldo guardado y releído: ${cfg.respaldo}`);

  try {
    await ref.update({ instruccionesExtra: final }, { lastUpdateTime: snap.updateTime });
  } catch (e) { log(`  ✗ no se escribió (${e?.code ?? e?.name ?? 'desconocido'}): el documento cambió entre la lectura y la escritura, o hubo un error. Vuelva a correr el seco.\n`); return 3; }
  const hash = hashCorto(final);
  log(`  ✓ Escrito (hash ${hash}). Para deshacer: --revertir --respaldo ${cfg.respaldo}`);

  const espera = deps.esperaMs ?? ESPERA_REVISION_MS;
  const pausa = deps.pausaMs ?? PAUSA_REVISION_MS;
  let rev = null;
  for (let t = 0; ; t += pausa) {
    const r = (await ref.get()).get('instruccionesRevision');
    if (r && typeof r === 'object' && r.hash === hash) { rev = r; if (r.estado !== 'pendiente') break; }
    if (t >= espera) break;
    await new Promise((res) => setTimeout(res, pausa));
  }
  if (!rev) {
    log(`\n  ✗ El servidor no escribió su revisión en ${Math.round(espera / 1000)} s (estado: pendiente). El texto quedó escrito pero sin comprobar: corra el seco más tarde (o --revertir).\n`);
    return 1;
  }
  const motivo = typeof rev.motivo === 'string' && rev.motivo ? ` — ${rev.motivo}` : '';
  log(`\n  revisión del servidor: ${rev.estado} (capa ${String(rev.capa)})${motivo}`);
  if (rev.estado === 'aprobado') { log('  ✓ El servidor aprobó el texto: ya es vigente.\n'); return 0; }
  log(`  ✗ El servidor NO lo aprobó (${rev.estado}): sigue vigente lo último aprobado. Corrija el bloque o use --revertir.\n`);
  return 1;
}

async function principal() {
  const analisis = analizarArgumentos(process.argv.slice(2));
  if (!analisis.ok) {
    console.error(`\n  ✗ ${analisis.problemas.join('\n  ✗ ')}\n\n${USO}\n`);
    process.exit(2);
  }
  const { cfg } = analisis;
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  const codigo = await ejecutar(cfg, { db, FieldValue });
  await db.terminate().catch(() => {});
  process.exit(codigo);
}

function seEjecutaDirecto() {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}
if (seEjecutaDirecto()) {
  try { await principal(); } catch (e) {
    console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`);
    process.exit(3);
  }
}
