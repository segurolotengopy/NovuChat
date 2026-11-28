/**
 * ENCENDER O APAGAR EL ENVÍO DE LA NOTA DEL CLIENTE A NOVUTIENDA — seco por omisión.
 *
 * QUÉ ES. El dato `tenants/{id}/config/pedidos.notaANovuTienda` (booleano; AUSENTE = apagado). Lo lee `enviarNotaDe` en
 * `functions/src/modulos/pedidos/confirmarExterno.ts`: solo `true` estricto hace que `confirmarPedidoExterno` agregue
 * el campo `nota` al cuerpo firmado. NovuTienda rechaza con 400 cualquier clave que no conoce, así que el campo NO se
 * enciende hasta que NovuTienda avise que ya acepta `nota`. Vive junto a `catalogoExterno`, NO dentro de él:
 * `aplicar-catalogo-externo.mjs` reescribe ese objeto entero y borraría la bandera.
 *
 *   node scripts/modulos/pedidos/fijar-nota-novutienda.mjs --proyecto <id> --tenant <id> --activar \
 *        [--aplicar --respaldo <ruta> --confirmo <tenant>]
 *   node scripts/modulos/pedidos/fijar-nota-novutienda.mjs --proyecto <id> --tenant <id> --desactivar \
 *        [--aplicar --respaldo <ruta> --confirmo <tenant>]
 *   node scripts/modulos/pedidos/fijar-nota-novutienda.mjs --proyecto <id> --tenant <id> --revertir --respaldo <ruta> \
 *        [--aplicar --confirmo <tenant>]
 *
 * (en lugar de `--proyecto <id>`: `--entorno staging|produccion`, con el id en GCP_PROJECT_ID_STAGING/_PROD del entorno.)
 *
 * QUÉ HACE.
 *   · SECO (sin `--aplicar`): lee SOLO `notaANovuTienda` de `config/pedidos` (y el nombre de la ficha, para las
 *     exclusiones) e imprime hoy → después. No escribe.
 *   · `--aplicar`: exige `--respaldo` (guarda el valor previo, o su AUSENCIA) y `--confirmo <comercio>` (el mismo
 *     de `--tenant`, escrito a mano). Escribe SOLO el campo `notaANovuTienda` (un `update` con la precondición de la hora
 *     leída; nunca toca `catalogoExterno` ni otro campo) y deja una entrada en `tenants/{id}/auditoria`, en el mismo lote.
 *   · `--desactivar`: escribe `false`. Si el campo ya está ausente o en `false`, no hace nada.
 *   · `--revertir --aplicar`: restaura desde el respaldo (si el campo no existía, lo ELIMINA). No pisa un cambio ajeno.
 *   · IDEMPOTENTE. Si `config/pedidos` no existe, sale con 1: este script no crea documentos.
 *   · Rechaza NovuChat, los demos y el ensayo, y los comercios de `NOVUCHAT_TENANTS_EXCLUIDOS`.
 *   · No imprime números de teléfono, ids de proyecto ni secretos.
 *
 * SALIDA. 0: sin diferencias, o escritura hecha y comprobada. 1: el seco encontró diferencias (o falta la ficha o
 * `config/pedidos`). 2: uso o salvaguarda (nada escrito). 3: error de ejecución. 130: Ctrl-C.
 *
 * COSTO. Seco: una lectura (dos documentos en un `getAll`). `--aplicar`: dos lecturas y UN lote de dos escrituras (el campo
 * y la auditoría). 0 mensajes por conversación. NO se corre contra producción sin el «sí» de Andres.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ID_TENANT, comprobarProyecto, comprobarRespaldo, guardarRespaldo, leerRespaldoGenerico, rutaDelRespaldoSigueIgual,
  esTenantExcluido, nombreExcluido,
} from '../../plataforma/aplicar-consola-conversaciones.mjs';

export const CAMPO = 'notaANovuTienda';
const CON_VALOR = ['proyecto', 'entorno', 'tenant', 'respaldo', 'confirmo'];
const BANDERAS = ['aplicar', 'revertir', 'activar', 'desactivar'];
/** Demos, ensayo y la cuenta de NovuChat: nunca se les corre este script (la misma regla que el reinicio de teléfonos de prueba). */
const RESERVADO = /^(novuchat.*|ensayo|demo(-.*)?)$/;

export const USO = '  (en lugar de --proyecto <id>: --entorno staging|produccion, con el id en GCP_PROJECT_ID_STAGING/_PROD del entorno)\n'
  + '  node scripts/modulos/pedidos/fijar-nota-novutienda.mjs --proyecto <id> --tenant <id> --activar|--desactivar '
  + '[--aplicar --respaldo <ruta> --confirmo <tenant>]\n'
  + '  node scripts/modulos/pedidos/fijar-nota-novutienda.mjs --proyecto <id> --tenant <id> --revertir --respaldo <ruta> '
  + '[--aplicar --confirmo <tenant>]';

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
  const activar = banderas.includes('activar');
  const desactivar = banderas.includes('desactivar');
  const { tenant, respaldo, confirmo } = valores;
  let { proyecto } = valores;
  if (valores['entorno'] !== undefined) {
    // El id sale del ENTORNO del proceso (lista blanca), nunca de argv. `comprobarProyecto` lo vuelve a validar abajo.
    const VARIABLE = { staging: 'GCP_PROJECT_ID_STAGING', produccion: 'GCP_PROJECT_ID_PROD' }[valores['entorno']];
    if (proyecto !== undefined) problemas.push('--entorno no se combina con --proyecto');
    else if (VARIABLE === undefined) problemas.push('--entorno admite solo staging o produccion');
    else {
      const id = typeof env[VARIABLE] === 'string' ? env[VARIABLE].trim() : '';
      if (id === '') problemas.push(`--entorno ${valores['entorno']}: falta ${VARIABLE} en el entorno`);
      else proyecto = id;
    }
  }
  if (proyecto === undefined && valores['entorno'] === undefined) problemas.push('falta --proyecto (o --entorno)');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto !== undefined && !proy.ok) problemas.push(proy.motivo);

  if (tenant === undefined) problemas.push('falta --tenant');
  else if (tenant.includes(',')) problemas.push('--tenant admite UN solo comercio por corrida (sin comas)');
  else if (!ID_TENANT.test(tenant)) problemas.push('--tenant inválido (minúsculas, dígitos y guiones, de 3 a 60)');
  else if (RESERVADO.test(tenant)) problemas.push('--tenant: NovuChat, los demos y el ensayo no llevan este dato');
  else if (esTenantExcluido(tenant, env)) problemas.push('este comercio está EXCLUIDO (NOVUCHAT_TENANTS_EXCLUIDOS): no se le corre este script sin una orden expresa de Andres');

  const modos = [activar, desactivar, revertir].filter(Boolean).length;
  if (modos === 0) problemas.push('falta --activar, --desactivar o --revertir');
  else if (modos > 1) problemas.push('--activar, --desactivar y --revertir son excluyentes');
  if (revertir && respaldo === undefined) problemas.push('--revertir exige --respaldo <ruta>');
  if (aplicar && !revertir && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta> (por omisión no hay respaldo)');
  if (aplicar) {
    if (confirmo === undefined) problemas.push('--aplicar exige --confirmo <comercio> (el mismo de --tenant, escrito a mano)');
    else if (confirmo !== tenant) problemas.push('--confirmo no coincide con --tenant');
  } else if (confirmo !== undefined && confirmo !== tenant) {
    problemas.push('--confirmo no coincide con --tenant');
  }

  let respaldoReal = null;
  let respaldoResuelto = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: revertir, permitirExistente: !revertir });
    if (r.ok) { respaldoReal = respaldo; respaldoResuelto = r.real; } else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return {
    ok: true,
    cfg: {
      proyecto, entorno: proy.entorno, tenant, aplicar, revertir, valor: revertir ? null : activar,
      respaldo: respaldoReal, respaldoResuelto,
    },
  };
}

// ===========================================================================
// RESPALDO
// ===========================================================================
const esBooleano = (v) => typeof v === 'boolean';

/** Lo que se guarda: el valor previo (o su ausencia), el valor escrito y la etiqueta del entorno. Nada del comercio. */
export function contenidoDelRespaldo({ entorno, tenant, config, actualizadoEn, escrito }) {
  const presente = Object.prototype.hasOwnProperty.call(config, CAMPO);
  return {
    version: 1, campo: CAMPO, entorno, tenant, creadoEn: new Date().toISOString(), configActualizadaEn: actualizadoEn,
    previo: { presente, valor: presente ? config[CAMPO] : null }, escrito,
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
  if (r.previo.presente ? !esBooleano(r.previo.valor) : r.previo.valor !== null) return { ok: false, motivo: 'el respaldo no guardó el valor previo con fidelidad (un booleano)' };
  if (!esBooleano(r.escrito)) return { ok: false, motivo: 'el respaldo no dice qué valor se escribió' };
  return { ok: true, respaldo: r };
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================
const iso = (t) => (t && typeof t.toDate === 'function' ? t.toDate().toISOString() : null);
const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';
const texto = (v) => (v === true ? 'true (ENCENDIDO: la nota sale a NovuTienda)' : v === false ? 'false (apagado)' : '(forma no reconocida; cuenta como apagado)');
const mostrar = (config, hay) => (hay ? texto(config[CAMPO]) : 'AUSENTE (apagado)');

/** Lee SOLO el campo del documento de pedidos y el nombre de la ficha (para la exclusión por nombre). */
async function leerConfig(db, tenant) {
  const ref = db.doc(`tenants/${tenant}/config/pedidos`);
  const fichaRef = db.doc(`tenants/${tenant}`);
  const [snap, ficha] = await db.getAll(ref, fichaRef, { fieldMask: [CAMPO, 'nombre'] });
  return { ref, snap, ficha };
}

/**
 * LA ÚNICA ESCRITURA A FIRESTORE DE TODO EL ARCHIVO: un lote con `update` de SOLO `notaANovuTienda` (con la
 * precondición de la hora leída) y la entrada de auditoría.
 */
async function escribirCampo(db, ref, tenant, valor, ultimaActualizacion, auditoria) {
  const lote = db.batch();
  lote.update(ref, { [CAMPO]: valor }, { lastUpdateTime: ultimaActualizacion });
  lote.create(db.collection(`tenants/${tenant}/auditoria`).doc(), auditoria);
  await lote.commit();
}

/** Corre la operación ya validada. `deps`: `{ db, FieldValue, log, marcarEscritura, env }`. Devuelve el código de salida. */
export async function ejecutar(cfg, deps) {
  const { db, FieldValue } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const marcar = deps.marcarEscritura ?? (() => {});
  const rotulo = `${cfg.entorno} · tenant ${cfg.tenant}`;

  const { ref, snap, ficha: fichaSnap } = await leerConfig(db, cfg.tenant);
  if (esTenantExcluido(cfg.tenant, deps.env) || nombreExcluido(fichaSnap.data()?.nombre, deps.env)) {
    log('\n  ✗ Este comercio está EXCLUIDO: no se toca. No se escribió nada.\n');
    return 2;
  }
  if (!fichaSnap.exists) { log(`\n  ✗ ${cfg.tenant}: no existe la ficha del comercio (${cfg.entorno})\n`); return 1; }
  if (!snap.exists) { log(`\n  ✗ ${cfg.tenant}: no existe config/pedidos (${cfg.entorno}); este script no crea documentos\n`); return 1; }
  const config = snap.data() ?? {};
  const hoyPresente = Object.prototype.hasOwnProperty.call(config, CAMPO);
  const auditoria = (accion, antes, despues) => ({
    accion, uid: 'script', origen: 'script', script: 'fijar-nota-novutienda', en: deps.ahora ? deps.ahora() : new Date(),
    antes: antes === undefined ? null : antes, despues: despues === undefined ? null : despues,
  });

  // ------------------------------------------------------------------ revertir
  if (cfg.revertir) {
    const lectura = leerRespaldo(cfg.respaldo, cfg);
    if (!lectura.ok) { log(`\n  ✗ ${lectura.motivo}\n`); return 2; }
    const { previo, escrito } = lectura.respaldo;
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
    log(`  «${CAMPO}» antes del respaldo : ${previo.presente ? texto(previo.valor) : 'AUSENTE (se eliminaría el campo)'}`);
    log(`  «${CAMPO}» hoy                : ${mostrar(config, hoyPresente)}`);
    const yaIgual = previo.presente ? hoyPresente && config[CAMPO] === previo.valor : !hoyPresente;
    if (yaIgual) { log('\n  ✓ El documento ya está como el respaldo: nada que revertir.\n'); return 0; }
    if (!hoyPresente || config[CAMPO] !== escrito) {
      log('\n  ✗ El documento ya no tiene el valor que escribió este script: alguien lo cambió después. '
        + 'Revertir pisaría ese cambio. No se escribe nada; revise el documento y corríjalo a propósito.\n');
      return 2;
    }
    if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Queda un cambio pendiente; agregue --aplicar para revertir.\n'); return 1; }
    marcar('escribiendo');
    try {
      await escribirCampo(db, ref, cfg.tenant, previo.presente ? previo.valor : FieldValue.delete(), snap.updateTime,
        auditoria('revertir_nota_novutienda', config[CAMPO], previo.presente ? previo.valor : null));
      marcar('escrito');
    } catch (e) {
      if (esPrecondicion(e)) { marcar('antes'); log('\n  ✗ El documento cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr el seco.\n'); return 3; }
      throw e;
    }
    const { snap: despues } = await leerConfig(db, cfg.tenant);
    const d = despues.data() ?? {};
    const bien = previo.presente ? d[CAMPO] === previo.valor : !Object.prototype.hasOwnProperty.call(d, CAMPO);
    if (!bien) { log('\n  ✗ La relectura no coincide con lo esperado. Revise el documento con el seco.\n'); return 3; }
    log(`\n  ✓ Revertido: «${CAMPO}» ${previo.presente ? 'restaurado' : 'eliminado (no existía)'}.\n`);
    return 0;
  }

  // -------------------------------------------------------- seco y aplicar
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
  log(`  «${CAMPO}» hoy      : ${mostrar(config, hoyPresente)}`);
  log(`  «${CAMPO}» después  : ${texto(cfg.valor)}`);
  // Apagar lo que ya está apagado (ausente o `false`) no escribe nada; encender lo ya encendido, tampoco.
  const yaEstaAsi = cfg.valor ? config[CAMPO] === true : (!hoyPresente || config[CAMPO] === false);
  if (yaEstaAsi) { log('\n  ✓ Ya estaba así: nada que hacer.\n'); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (con --respaldo y --confirmo) para escribir.\n'); return 1; }

  // Solo se escribe encima de un valor que se pueda respaldar con fidelidad y restaurar después.
  if (hoyPresente && !esBooleano(config[CAMPO])) {
    log(`\n  ✗ El documento ya tiene «${CAMPO}» con una forma que este script no reconoce: no se puede respaldar y restaurar con fidelidad. No se escribe nada.\n`);
    return 2;
  }
  try {
    guardarRespaldo(cfg.respaldo, contenidoDelRespaldo({
      entorno: cfg.entorno, tenant: cfg.tenant, config, actualizadoEn: iso(snap.updateTime), escrito: cfg.valor,
    }));
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa; elija otro nombre. No se escribe nada.\n'); return 2; }
    throw e;
  }
  marcar('respaldo');
  const comprobado = (deps.leerRespaldo ?? leerRespaldo)(cfg.respaldo, cfg);
  if (!comprobado.ok) {
    log(`\n  ✗ El respaldo recién guardado no sirve para revertir (${comprobado.motivo}). No se escribe nada; para repetir use OTRA ruta de --respaldo.\n`);
    return 2;
  }
  if (!rutaDelRespaldoSigueIgual(cfg, deps.comprobarRespaldo)) {
    log('\n  ✗ La ruta del respaldo cambió durante la corrida. No se escribe nada.\n');
    return 2;
  }
  log(`\n  Respaldo guardado y releído: ${cfg.respaldo}`);

  marcar('escribiendo');
  try {
    await escribirCampo(db, ref, cfg.tenant, cfg.valor, snap.updateTime,
      auditoria(cfg.valor ? 'activar_nota_novutienda' : 'desactivar_nota_novutienda', hoyPresente ? config[CAMPO] : null, cfg.valor));
    marcar('escrito');
  } catch (e) {
    if (esPrecondicion(e)) { marcar('respaldo'); log('\n  ✗ El documento cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr el seco y repita --aplicar con OTRA ruta de --respaldo (la anterior ya existe y no se pisa).\n'); return 3; }
    throw e;
  }
  const { snap: despues } = await leerConfig(db, cfg.tenant);
  if ((despues.data() ?? {})[CAMPO] !== cfg.valor) {
    log('\n  ✗ La relectura no coincide con lo escrito. Revise el documento con el seco; el respaldo permite revertir.\n');
    return 3;
  }
  log(`\n  ✓ Escrito y releído: «${CAMPO}» = ${texto(cfg.valor)}.`);
  log('  Para deshacer: --revertir con el mismo respaldo, tenant y proyecto.\n');
  return 0;
}

/** En qué punto está la corrida: 'antes', 'respaldo' (guardado, documento sin escribir), 'escribiendo', 'escrito'. */
const corrida = { estado: 'antes' };

export function mensajeDeInterrupcion(estado, causa = 'Interrumpido por el operador') {
  if (estado === 'antes') return `\n  ! ${causa} antes de escribir. No se guardó respaldo ni se escribió nada en el documento.\n`;
  if (estado === 'respaldo') return `\n  ! ${causa} con el respaldo YA guardado y el documento sin escribir. Para repetir use OTRA ruta de --respaldo.\n`;
  if (estado === 'escrito') return `\n  ! ${causa} DESPUÉS de escribir: la escritura SÍ se hizo. Corra el seco para verificar; para deshacer, --revertir con el mismo respaldo.\n`;
  return `\n  ! ${causa} DURANTE la escritura: puede haberse escrito o no. Corra el seco y, si hay que deshacer, use --revertir con el respaldo.\n`;
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
  process.on('SIGINT', () => { console.error(mensajeDeInterrupcion(corrida.estado)); process.exit(130); });
  const codigo = await ejecutar(cfg, { db, FieldValue, env: process.env, marcarEscritura: (v) => { corrida.estado = v; } });
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
