/**
 * ESCRIBIR `tenants/{id}.guardarMedios` DE UN SOLO COMERCIO — seco por omisión.
 *
 * QUÉ ES. La bandera que enciende el guardado de medios entrantes (imágenes, documentos
 * y audio) de ese comercio: la lee `functions/src/core/medios/guardarMedio.ts` y solo
 * guarda si vale exactamente `true`. Ausente o `false` = no se guarda nada. Ningún
 * navegador puede escribirla (`firestore.rules`: `tenants/{id}` no admite escritura de
 * clientes); este script es el único camino. Calcado de `aplicar-consola-conversaciones.mjs`
 * (que a su vez viene de `aplicar-consola-oculta.mjs`): seco, respaldo, precondición,
 * relectura y vuelta atrás. Reutiliza sus piezas (proyecto, respaldo, lectura del respaldo).
 *
 *   node scripts/plataforma/aplicar-guardar-medios.mjs --proyecto <id> --tenant <id> \
 *        --valor true|false [--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]
 *   node scripts/plataforma/aplicar-guardar-medios.mjs --revertir --respaldo <ruta> \
 *        --tenant <id> --proyecto <id> [--aplicar] [--confirmo-produccion <tenant>]
 *
 * QUÉ HACE.
 *   · SECO (sin `--aplicar`): lee SOLO `guardarMedios` de `tenants/{id}`; imprime valor actual →
 *     nuevo. No escribe. Si el valor pedido es `true`, recuerda las condiciones previas (no las verifica).
 *   · `--aplicar`: exige `--respaldo`; guarda el valor previo (o su AUSENCIA), lo relee y recién
 *     entonces escribe SOLO `guardarMedios` con la precondición de la hora de actualización leída
 *     (si la ficha cambió entre la lectura y la escritura, aborta sin escribir). Relee y compara.
 *   · `--revertir --aplicar`: restaura desde el respaldo (si el campo no existía, lo ELIMINA). No pisa
 *     un cambio ajeno: si el campo de hoy no es lo que escribió este script, sale con 2 sin escribir.
 *   · IDEMPOTENTE: si el valor ya es el pedido, sale con 0 sin escribir.
 *   · `--valor` acepta SOLO `true` o `false` (texto exacto, en minúsculas): cualquier otra cosa se RECHAZA.
 *
 * ANTES DE ENCENDER (no las verifica el script; las verifica quien lo corre y las autoriza Andres):
 * anexo aceptado por el comercio (o decisión de Andres para un chat propio), `N8N_DEFAULT_BINARY_MODE=filesystem`
 * y poda de ejecuciones en la VM de n8n, y `guardarMedio` y `purgarMedios` desplegadas.
 *
 * SALVAGUARDA DE PROYECTO. Lista blanca por `GCP_PROJECT_ID_STAGING` y `GCP_PROJECT_ID_PROD`; contra
 * PRODUCCIÓN, `--aplicar` exige `--confirmo-produccion <tenant>` igual a `--tenant`. Contra el emulador
 * (`demo-*`) exige `FIRESTORE_EMULATOR_HOST` local. El id de un proyecto real NUNCA se imprime.
 *
 * SALIDA. 0: seco sin diferencias, o escritura hecha y comprobada. 1: el seco encontró diferencias (o la
 * ficha no existe). 2: uso o salvaguarda (nada escrito). 3: error de ejecución (solo `e.code ?? e.name`).
 * 130: Ctrl-C.
 *
 * COSTO. Seco: una lectura. `--aplicar`: dos lecturas y UNA escritura de un campo (más el archivo local
 * del respaldo). 0 mensajes por conversación. NO se corre contra producción sin el «sí» de Andres.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ID_TENANT, comprobarProyecto, comprobarRespaldo, guardarRespaldo, leerRespaldoGenerico, rutaDelRespaldoSigueIgual,
} from './aplicar-consola-conversaciones.mjs';

const CAMPO = 'guardarMedios';
const CON_VALOR = ['proyecto', 'tenant', 'valor', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];

export const USO = '  node scripts/plataforma/aplicar-guardar-medios.mjs --proyecto <id> --tenant <id> --valor true|false '
  + '[--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]\n'
  + '  node scripts/plataforma/aplicar-guardar-medios.mjs --revertir --respaldo <ruta> --tenant <id> --proyecto <id> '
  + '[--aplicar] [--confirmo-produccion <tenant>]';

const RECORDATORIO_ENCENDER = [
  '  Antes de encender (este script NO lo verifica):',
  '    · anexo aceptado por el comercio, o decisión de Andres si es un chat propio;',
  '    · N8N_DEFAULT_BINARY_MODE=filesystem y poda de ejecuciones en la VM de n8n;',
  '    · funciones guardarMedio y purgarMedios desplegadas.',
].join('\n');

/** `true` o `false`, texto exacto. Devuelve `{ ok, valor }` o `{ ok:false, problemas }`. */
export function validarValor(texto) {
  if (texto === 'true') return { ok: true, valor: true };
  if (texto === 'false') return { ok: true, valor: false };
  return { ok: false, problemas: ['--valor tiene que ser exactamente «true» o «false»'] };
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
  const { proyecto, tenant, respaldo } = valores;
  const confirmo = valores['confirmo-produccion'];

  if (proyecto === undefined) problemas.push('falta --proyecto');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto !== undefined && !proy.ok) problemas.push(proy.motivo);

  if (tenant === undefined) problemas.push('falta --tenant');
  else if (tenant.includes(',')) problemas.push('--tenant admite UN solo comercio por corrida (sin comas)');
  else if (!ID_TENANT.test(tenant)) problemas.push('--tenant inválido (minúsculas, dígitos y guiones, de 3 a 60)');

  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) {
    problemas.push('contra producción, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  }

  let valor = null;
  if (revertir) {
    if ('valor' in valores) problemas.push('--revertir no admite --valor: restaura lo del respaldo');
    if (respaldo === undefined) problemas.push('--revertir exige --respaldo <ruta>');
  } else {
    if (!('valor' in valores)) problemas.push('falta --valor');
    else {
      const r = validarValor(valores['valor']);
      if (r.ok) valor = r.valor; else problemas.push(...r.problemas);
    }
    if (aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta> (por omisión no hay respaldo)');
  }
  let respaldoReal = null;
  let respaldoResuelto = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: revertir, permitirExistente: !revertir });
    if (r.ok) { respaldoReal = respaldo; respaldoResuelto = r.real; } else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, valor, aplicar, revertir, respaldo: respaldoReal, respaldoResuelto } };
}

// ===========================================================================
// RESPALDO (el archivo se escribe con `guardarRespaldo`: 0700/0600, O_EXCL, O_NOFOLLOW, relectura)
// ===========================================================================
const esBooleano = (v) => typeof v === 'boolean';

/** Lo que se guarda: el valor previo (o su ausencia), el valor escrito y la etiqueta del entorno. Nada del comercio. */
export function contenidoDelRespaldo({ entorno, tenant, ficha, actualizadoEn, escrito }) {
  const presente = Object.prototype.hasOwnProperty.call(ficha, CAMPO);
  return {
    version: 1, campo: CAMPO, entorno, tenant, creadoEn: new Date().toISOString(), fichaActualizadaEn: actualizadoEn,
    previo: { presente, valor: presente ? ficha[CAMPO] : null }, escrito,
  };
}

export function leerRespaldo(ruta, { entorno, tenant }) {
  const l = leerRespaldoGenerico(ruta, { limite: 64 * 1024 });
  if (!l.ok) return l;
  const r = l.respaldo;
  if (r?.version !== 1 || r.campo !== CAMPO || typeof r.previo !== 'object' || r.previo === null) return { ok: false, motivo: 'el respaldo no tiene la forma esperada' };
  if (r.tenant !== tenant) return { ok: false, motivo: 'el respaldo es de otro comercio' };
  if (r.entorno !== entorno) return { ok: false, motivo: 'el respaldo es de otro entorno (staging, produccion o emulador)' };
  if (typeof r.previo.presente !== 'boolean') return { ok: false, motivo: `el respaldo no dice si «${CAMPO}» existía` };
  if (r.previo.presente ? !esBooleano(r.previo.valor) : r.previo.valor !== null) {
    return { ok: false, motivo: 'el respaldo no guardó el valor previo con fidelidad (un booleano)' };
  }
  if (!esBooleano(r.escrito)) return { ok: false, motivo: 'el respaldo no dice qué valor se escribió' };
  return { ok: true, respaldo: r };
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================
const iso = (t) => (t && typeof t.toDate === 'function' ? t.toDate().toISOString() : null);
const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';
const mostrar = (ficha, hay) => (hay ? (esBooleano(ficha[CAMPO]) ? String(ficha[CAMPO]) : '(no es un booleano)') : 'AUSENTE (equivale a false)');

/** LA ÚNICA ESCRITURA A FIRESTORE DE TODO EL ARCHIVO: solo `guardarMedios`, con la precondición de la hora leída. */
async function escribirCampo(ref, valor, ultimaActualizacion) {
  await ref.update({ [CAMPO]: valor }, { lastUpdateTime: ultimaActualizacion });
}

async function leerFicha(db, tenant) {
  const ref = db.doc(`tenants/${tenant}`);
  const [snap] = await db.getAll(ref, { fieldMask: [CAMPO] });
  return { ref, snap };
}

/**
 * Corre la operación ya validada. `deps`: `{ db, FieldValue, log, marcarEscritura }`. Devuelve el código de salida.
 * Importable para probar la precondición con una base que cambia entre la lectura y la escritura.
 */
export async function ejecutar(cfg, deps) {
  const { db, FieldValue } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const marcar = deps.marcarEscritura ?? (() => {});
  const rotulo = `${cfg.entorno} · tenant ${cfg.tenant}`;

  const { ref, snap } = await leerFicha(db, cfg.tenant);
  if (!snap.exists) { log(`\n  ✗ ${cfg.tenant}: no existe la ficha (${cfg.entorno})\n`); return 1; }
  const ficha = snap.data() ?? {};
  const hoyPresente = Object.prototype.hasOwnProperty.call(ficha, CAMPO);

  // ------------------------------------------------------------------ revertir
  if (cfg.revertir) {
    const lectura = leerRespaldo(cfg.respaldo, cfg);
    if (!lectura.ok) { log(`\n  ✗ ${lectura.motivo}\n`); return 2; }
    const { previo, escrito } = lectura.respaldo;
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
    log(`  «${CAMPO}» antes del respaldo : ${previo.presente ? String(previo.valor) : 'AUSENTE (se eliminaría el campo)'}`);
    log(`  «${CAMPO}» hoy                : ${mostrar(ficha, hoyPresente)}`);
    const yaIgual = previo.presente ? hoyPresente && ficha[CAMPO] === previo.valor : !hoyPresente;
    if (yaIgual) { log('\n  ✓ La ficha ya está como el respaldo: nada que revertir.\n'); return 0; }
    if (!hoyPresente || ficha[CAMPO] !== escrito) {
      log('\n  ✗ La ficha ya no tiene el valor que escribió este script: alguien lo cambió después (o este script no llegó a escribirlo). '
        + 'Revertir pisaría ese cambio. No se escribe nada; revise la ficha y corríjala a propósito.\n');
      return 2;
    }
    if (!cfg.aplicar) {
      log('\n  Seco: no se escribió nada. Queda un cambio pendiente; agregue --aplicar para revertir.\n');
      return 1;
    }
    marcar('escribiendo');
    try {
      await escribirCampo(ref, previo.presente ? previo.valor : FieldValue.delete(), snap.updateTime);
      marcar('escrito');
    } catch (e) {
      if (esPrecondicion(e)) { marcar('antes'); log('\n  ✗ La ficha cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr el seco.\n'); return 3; }
      throw e;
    }
    const { snap: despues } = await leerFicha(db, cfg.tenant);
    const d = despues.data() ?? {};
    const bien = previo.presente ? d[CAMPO] === previo.valor : !Object.prototype.hasOwnProperty.call(d, CAMPO);
    if (!bien) { log('\n  ✗ La relectura no coincide con lo esperado. Revise la ficha con el seco.\n'); return 3; }
    log(`\n  ✓ Revertido: «${CAMPO}» ${previo.presente ? 'restaurado' : 'eliminado (no existía)'}.\n`);
    return 0;
  }

  // -------------------------------------------------------- seco y aplicar
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
  log(`  «${CAMPO}» hoy      : ${mostrar(ficha, hoyPresente)}`);
  log(`  «${CAMPO}» después  : ${cfg.valor}`);
  log(`  cambio              : ${hoyPresente && esBooleano(ficha[CAMPO]) ? String(ficha[CAMPO]) : 'AUSENTE'} → ${cfg.valor}`);
  if (cfg.valor === true) log(`\n${RECORDATORIO_ENCENDER}`);

  if (hoyPresente && ficha[CAMPO] === cfg.valor) { log(`\n  ✓ «${CAMPO}» ya está escrita con ese valor: nada que hacer.\n`); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (y --respaldo) para escribir.\n'); return 1; }

  // Solo se escribe encima de un valor que se pueda respaldar con fidelidad y restaurar después.
  if (hoyPresente && !esBooleano(ficha[CAMPO])) {
    log(`\n  ✗ La ficha ya tiene «${CAMPO}» y no es un booleano: no se puede respaldar y restaurar con fidelidad. No se escribe nada.\n`);
    return 2;
  }
  try {
    guardarRespaldo(cfg.respaldo, contenidoDelRespaldo({
      entorno: cfg.entorno, tenant: cfg.tenant, ficha, actualizadoEn: iso(snap.updateTime), escrito: cfg.valor,
    }));
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa; elija otro nombre. No se escribe nada.\n'); return 2; }
    throw e;
  }
  marcar('respaldo');
  // El respaldo tiene que poder LEERSE de vuelta con la forma que --revertir exige, ANTES de tocar la ficha.
  const comprobado = (deps.leerRespaldo ?? leerRespaldo)(cfg.respaldo, cfg);
  if (!comprobado.ok) {
    log(`\n  ✗ El respaldo recién guardado no sirve para revertir (${comprobado.motivo}). No se escribe nada en la ficha; para repetir use OTRA ruta de --respaldo.\n`);
    return 2;
  }
  // Última comprobación antes de tocar la ficha: la carpeta del respaldo no cambió (enlace) desde que se validó.
  if (!rutaDelRespaldoSigueIgual(cfg, deps.comprobarRespaldo)) {
    log('\n  ✗ La ruta del respaldo cambió durante la corrida. No se escribe nada.\n');
    return 2;
  }
  log(`\n  Respaldo guardado y releído: ${cfg.respaldo}`);

  marcar('escribiendo');
  try {
    await escribirCampo(ref, cfg.valor, snap.updateTime);
    marcar('escrito');
  } catch (e) {
    if (esPrecondicion(e)) { marcar('respaldo'); log('\n  ✗ La ficha cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr el seco y repita --aplicar con OTRA ruta de --respaldo (la anterior ya existe y no se pisa).\n'); return 3; }
    throw e;
  }
  const { snap: despues } = await leerFicha(db, cfg.tenant);
  const d = despues.data() ?? {};
  if (d[CAMPO] !== cfg.valor) {
    log('\n  ✗ La relectura no coincide con lo escrito. Revise la ficha con el seco; el respaldo permite revertir.\n');
    return 3;
  }
  log(`\n  ✓ Escrito y releído: «${CAMPO}» = ${String(d[CAMPO])}.`);
  log('  Para deshacer: --revertir con el mismo respaldo, tenant y proyecto.\n');
  return 0;
}

/** En qué punto está la corrida: 'antes' (nada guardado), 'respaldo' (guardado, la ficha sin escribir), 'escribiendo', 'escrito'. */
const corrida = { estado: 'antes' };

/** Qué decirle al operador si la corrida se corta (Ctrl-C o un error) según el punto en que quedó. */
export function mensajeDeInterrupcion(estado, causa = 'Interrumpido por el operador') {
  if (estado === 'antes') return `\n  ! ${causa} antes de escribir. No se guardó respaldo ni se escribió nada en la ficha.\n`;
  if (estado === 'respaldo') {
    return `\n  ! ${causa} con el respaldo YA guardado y la ficha sin escribir. Para repetir use OTRA ruta de --respaldo (la anterior ya existe y no se pisa).\n`;
  }
  if (estado === 'escrito') {
    return `\n  ! ${causa} DESPUÉS de escribir: la escritura SÍ se hizo y la relectura no se completó. Corra el seco para verificar la ficha; `
      + 'si hay que deshacer, use --revertir con el mismo respaldo, tenant y proyecto.\n';
  }
  return `\n  ! ${causa} DURANTE la escritura: puede haberse escrito o no. Existe el respaldo: corra el seco para ver en qué estado quedó la ficha `
    + 'y, si hay que deshacer, use --revertir con el mismo respaldo, tenant y proyecto.\n';
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
  process.on('SIGINT', () => {
    console.error(mensajeDeInterrupcion(corrida.estado));
    process.exit(130);
  });
  const codigo = await ejecutar(cfg, { db, FieldValue, marcarEscritura: (v) => { corrida.estado = v; } });
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
    if (corrida.estado !== 'antes') console.error(mensajeDeInterrupcion(corrida.estado, 'Falló con un error'));
    process.exit(3);
  }
}
