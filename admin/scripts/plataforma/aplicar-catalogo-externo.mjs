/**
 * ESCRIBIR `tenants/{id}/config/pedidos.catalogoExterno` DE UN SOLO COMERCIO — seco por omisión.
 *
 * QUÉ ES. El dato que enciende el catálogo externo (NovuTienda) en los pedidos de WhatsApp de ese comercio:
 * `catalogoExterno = { activo: true, monedas: ['BOB'|'ARS', …] }`. Lo lee `configExternaDe` en
 * `functions/src/modulos/pedidos/pedidoDelQr.ts`; sin él, el pedido se arma como siempre. Solo el servidor lo
 * escribe (las reglas no abren `config/pedidos` al cliente); este script es el camino. Calcado de
 * `aplicar-guardar-medios.mjs` (seco, respaldo, precondición, relectura y vuelta atrás) y reutiliza las piezas
 * de `aplicar-consola-conversaciones.mjs`. Escribe SOLO ese campo del documento, nunca otro, y NO escribe
 * `config/cobros` ni alias de cobro.
 *
 *   node scripts/plataforma/aplicar-catalogo-externo.mjs --proyecto <id> --tenant <id> --monedas BOB,ARS \
 *        [--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]
 *   node scripts/plataforma/aplicar-catalogo-externo.mjs --proyecto <id> --tenant <id> --desactivar [...]
 *   node scripts/plataforma/aplicar-catalogo-externo.mjs --revertir --respaldo <ruta> --tenant <id> --proyecto <id> \
 *        [--aplicar] [--confirmo-produccion <tenant>]
 *
 * QUÉ HACE.
 *   · `--monedas`: lista EXACTA de `BOB` y/o `ARS`, separada por comas, sin repetidos ni vacíos. Escribe
 *     `{ activo: true, monedas }`. `--desactivar` (sin `--monedas`) escribe `{ activo: false, monedas: [] }`.
 *   · SECO (sin `--aplicar`): lee SOLO `catalogoExterno` de `config/pedidos` (y el nombre de la ficha, para la
 *     exclusión); imprime valor actual → nuevo. No escribe. Con `ARS` recuerda (sin verificar) que el alias de
 *     cobro de Argentina va aparte.
 *   · `--aplicar`: exige `--respaldo`; guarda el valor previo (o su AUSENCIA), lo relee y recién entonces escribe
 *     SOLO `catalogoExterno` con la precondición de la hora de actualización leída. Relee y compara.
 *   · `--revertir --aplicar`: restaura desde el respaldo (si el campo no existía, lo ELIMINA). No pisa un cambio
 *     ajeno: si el campo de hoy no es lo que escribió este script, sale con 2 sin escribir.
 *   · IDEMPOTENTE: si el valor ya es el pedido, sale con 0 sin escribir.
 *   · Si `config/pedidos` no existe, sale con 1: este script no crea documentos (los crea el módulo Pedidos).
 *
 * SALVAGUARDA DE PROYECTO. Lista blanca por `GCP_PROJECT_ID_STAGING` y `GCP_PROJECT_ID_PROD`; contra
 * PRODUCCIÓN, `--aplicar` exige `--confirmo-produccion <tenant>` igual a `--tenant`. Contra el emulador
 * (`demo-*`) exige `FIRESTORE_EMULATOR_HOST` local. El id de un proyecto real NUNCA se imprime.
 *
 * SALIDA. 0: seco sin diferencias, o escritura hecha y comprobada. 1: el seco encontró diferencias (o falta la
 * ficha o `config/pedidos`). 2: uso o salvaguarda (nada escrito). 3: error de ejecución (solo `e.code ?? e.name`).
 * 130: Ctrl-C.
 *
 * COSTO. Seco: una lectura (dos documentos en un `getAll`). `--aplicar`: dos lecturas y UNA escritura de un campo
 * (más el archivo local del respaldo). 0 mensajes por conversación. NO se corre contra producción sin el «sí» de Andres.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ID_TENANT, comprobarProyecto, comprobarRespaldo, guardarRespaldo, leerRespaldoGenerico, rutaDelRespaldoSigueIgual,
  esTenantExcluido, nombreExcluido,
} from './aplicar-consola-conversaciones.mjs';

const CAMPO = 'catalogoExterno';
const MONEDAS_VALIDAS = ['BOB', 'ARS'];
const CON_VALOR = ['proyecto', 'tenant', 'monedas', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir', 'desactivar'];

export const USO = '  node scripts/plataforma/aplicar-catalogo-externo.mjs --proyecto <id> --tenant <id> --monedas BOB,ARS '
  + '[--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]\n'
  + '  node scripts/plataforma/aplicar-catalogo-externo.mjs --proyecto <id> --tenant <id> --desactivar '
  + '[--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]\n'
  + '  node scripts/plataforma/aplicar-catalogo-externo.mjs --revertir --respaldo <ruta> --tenant <id> --proyecto <id> '
  + '[--aplicar] [--confirmo-produccion <tenant>]';

const RECORDATORIO_ARS = [
  '  Con ARS (este script NO lo verifica ni lo escribe):',
  '    · el alias de cobro de Argentina va aparte, en la configuración de cobros del comercio.',
].join('\n');

/** Lista exacta de BOB/ARS separada por comas, sin repetidos ni vacíos. Devuelve `{ ok, monedas }` o `{ ok:false, problemas }`. */
export function validarMonedas(texto) {
  if (typeof texto !== 'string' || texto === '') return { ok: false, problemas: ['--monedas no puede estar vacío'] };
  const partes = texto.split(',');
  const malas = partes.filter((m) => !MONEDAS_VALIDAS.includes(m));
  if (malas.length) return { ok: false, problemas: ['--monedas admite SOLO BOB y/o ARS (mayúsculas, separadas por comas, sin espacios ni vacíos)'] };
  if (new Set(partes).size !== partes.length) return { ok: false, problemas: ['--monedas no admite monedas repetidas'] };
  return { ok: true, monedas: partes };
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
  const desactivar = banderas.includes('desactivar');
  const { proyecto, tenant, respaldo } = valores;
  const confirmo = valores['confirmo-produccion'];

  if (proyecto === undefined) problemas.push('falta --proyecto');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto !== undefined && !proy.ok) problemas.push(proy.motivo);

  if (tenant === undefined) problemas.push('falta --tenant');
  else if (tenant.includes(',')) problemas.push('--tenant admite UN solo comercio por corrida (sin comas)');
  else if (!ID_TENANT.test(tenant)) problemas.push('--tenant inválido (minúsculas, dígitos y guiones, de 3 a 60)');
  else if (esTenantExcluido(tenant, env)) {
    problemas.push('este comercio está EXCLUIDO (Bellido o NOVUCHAT_TENANTS_EXCLUIDOS): no se le corre este script sin una orden expresa de Andres');
  }

  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) {
    problemas.push('contra producción, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  }

  let valor = null;
  if (revertir) {
    if ('monedas' in valores || desactivar) problemas.push('--revertir no admite --monedas ni --desactivar: restaura lo del respaldo');
    if (respaldo === undefined) problemas.push('--revertir exige --respaldo <ruta>');
  } else {
    if (desactivar && 'monedas' in valores) problemas.push('--desactivar no se combina con --monedas');
    else if (desactivar) valor = { activo: false, monedas: [] };
    else if (!('monedas' in valores)) problemas.push('falta --monedas (o --desactivar)');
    else {
      const r = validarMonedas(valores['monedas']);
      if (r.ok) valor = { activo: true, monedas: r.monedas }; else problemas.push(...r.problemas);
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
// FORMA DEL DATO Y RESPALDO (el archivo se escribe con `guardarRespaldo`: 0700/0600, O_EXCL, O_NOFOLLOW, relectura)
// ===========================================================================
/** Forma cerrada que este script sabe respaldar y restaurar con fidelidad: `{ activo:boolean, monedas:('BOB'|'ARS')[] }`. */
export function esFormaValida(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const claves = Object.keys(v);
  if (claves.length !== 2 || !claves.includes('activo') || !claves.includes('monedas')) return false;
  return typeof v.activo === 'boolean' && Array.isArray(v.monedas) && v.monedas.every((m) => MONEDAS_VALIDAS.includes(m));
}
export const iguales = (a, b) => esFormaValida(a) && esFormaValida(b) && a.activo === b.activo
  && a.monedas.length === b.monedas.length && [...a.monedas].sort().join() === [...b.monedas].sort().join();
const copia = (v) => ({ activo: v.activo, monedas: [...v.monedas] });

/** Lo que se guarda: el valor previo (o su ausencia), el valor escrito y la etiqueta del entorno. Nada del comercio. */
export function contenidoDelRespaldo({ entorno, tenant, config, actualizadoEn, escrito }) {
  const presente = Object.prototype.hasOwnProperty.call(config, CAMPO);
  return {
    version: 1, campo: CAMPO, entorno, tenant, creadoEn: new Date().toISOString(), configActualizadaEn: actualizadoEn,
    previo: { presente, valor: presente ? copia(config[CAMPO]) : null }, escrito: copia(escrito),
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
  if (r.previo.presente ? !esFormaValida(r.previo.valor) : r.previo.valor !== null) {
    return { ok: false, motivo: 'el respaldo no guardó el valor previo con fidelidad ({ activo, monedas })' };
  }
  if (!esFormaValida(r.escrito)) return { ok: false, motivo: 'el respaldo no dice qué valor se escribió' };
  return { ok: true, respaldo: r };
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================
const iso = (t) => (t && typeof t.toDate === 'function' ? t.toDate().toISOString() : null);
const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';
const texto = (v) => (esFormaValida(v) ? `activo=${v.activo} monedas=[${v.monedas.join(',')}]` : '(forma no reconocida)');
const mostrar = (config, hay) => (hay ? texto(config[CAMPO]) : 'AUSENTE (catálogo externo apagado)');

/** LA ÚNICA ESCRITURA A FIRESTORE DE TODO EL ARCHIVO: solo `catalogoExterno`, con la precondición de la hora leída. */
async function escribirCampo(ref, valor, ultimaActualizacion) {
  await ref.update({ [CAMPO]: valor }, { lastUpdateTime: ultimaActualizacion });
}

/** Lee SOLO el campo del documento de pedidos y el nombre de el documento (para la exclusión por nombre). */
async function leerConfig(db, tenant) {
  const ref = db.doc(`tenants/${tenant}/config/pedidos`);
  const fichaRef = db.doc(`tenants/${tenant}`);
  const [snap, ficha] = await db.getAll(ref, fichaRef, { fieldMask: [CAMPO, 'nombre'] });
  return { ref, snap, ficha };
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

  const { ref, snap, ficha: fichaSnap } = await leerConfig(db, cfg.tenant);
  // Segunda barrera: el NOMBRE de el documento también puede nombrar a un comercio excluido (si el id no fuera el esperado).
  if (esTenantExcluido(cfg.tenant, deps.env) || nombreExcluido(fichaSnap.data()?.nombre, deps.env)) {
    log('\n  ✗ Este comercio está EXCLUIDO: no se toca. No se escribió nada.\n');
    return 2;
  }
  if (!fichaSnap.exists) { log(`\n  ✗ ${cfg.tenant}: no existe la ficha del comercio (${cfg.entorno})\n`); return 1; }
  if (!snap.exists) { log(`\n  ✗ ${cfg.tenant}: no existe config/pedidos (${cfg.entorno}); este script no crea documentos\n`); return 1; }
  const config = snap.data() ?? {};
  const hoyPresente = Object.prototype.hasOwnProperty.call(config, CAMPO);

  // ------------------------------------------------------------------ revertir
  if (cfg.revertir) {
    const lectura = leerRespaldo(cfg.respaldo, cfg);
    if (!lectura.ok) { log(`\n  ✗ ${lectura.motivo}\n`); return 2; }
    const { previo, escrito } = lectura.respaldo;
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
    log(`  «${CAMPO}» antes del respaldo : ${previo.presente ? texto(previo.valor) : 'AUSENTE (se eliminaría el campo)'}`);
    log(`  «${CAMPO}» hoy                : ${mostrar(config, hoyPresente)}`);
    const yaIgual = previo.presente ? hoyPresente && iguales(config[CAMPO], previo.valor) : !hoyPresente;
    if (yaIgual) { log('\n  ✓ El documento ya está como el respaldo: nada que revertir.\n'); return 0; }
    if (!hoyPresente || !iguales(config[CAMPO], escrito)) {
      log('\n  ✗ El documento ya no tiene el valor que escribió este script: alguien lo cambió después (o este script no llegó a escribirlo). '
        + 'Revertir pisaría ese cambio. No se escribe nada; revise el documento y corríjalo a propósito.\n');
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
      if (esPrecondicion(e)) { marcar('antes'); log('\n  ✗ El documento cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr el seco.\n'); return 3; }
      throw e;
    }
    const { snap: despues } = await leerConfig(db, cfg.tenant);
    const d = despues.data() ?? {};
    const bien = previo.presente ? iguales(d[CAMPO], previo.valor) : !Object.prototype.hasOwnProperty.call(d, CAMPO);
    if (!bien) { log('\n  ✗ La relectura no coincide con lo esperado. Revise el documento con el seco.\n'); return 3; }
    log(`\n  ✓ Revertido: «${CAMPO}» ${previo.presente ? 'restaurado' : 'eliminado (no existía)'}.\n`);
    return 0;
  }

  // -------------------------------------------------------- seco y aplicar
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
  log(`  «${CAMPO}» hoy      : ${mostrar(config, hoyPresente)}`);
  log(`  «${CAMPO}» después  : ${texto(cfg.valor)}`);
  if (cfg.valor.activo && cfg.valor.monedas.includes('ARS')) log(`\n${RECORDATORIO_ARS}`);

  if (hoyPresente && iguales(config[CAMPO], cfg.valor)) { log(`\n  ✓ «${CAMPO}» ya está escrito con ese valor: nada que hacer.\n`); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (y --respaldo) para escribir.\n'); return 1; }

  // Solo se escribe encima de un valor que se pueda respaldar con fidelidad y restaurar después.
  if (hoyPresente && !esFormaValida(config[CAMPO])) {
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
  // El respaldo tiene que poder LEERSE de vuelta con la forma que --revertir exige, ANTES de tocar el documento.
  const comprobado = (deps.leerRespaldo ?? leerRespaldo)(cfg.respaldo, cfg);
  if (!comprobado.ok) {
    log(`\n  ✗ El respaldo recién guardado no sirve para revertir (${comprobado.motivo}). No se escribe nada; para repetir use OTRA ruta de --respaldo.\n`);
    return 2;
  }
  // Última comprobación antes de tocar el documento: la carpeta del respaldo no cambió (enlace) desde que se validó.
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
    if (esPrecondicion(e)) { marcar('respaldo'); log('\n  ✗ El documento cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr el seco y repita --aplicar con OTRA ruta de --respaldo (la anterior ya existe y no se pisa).\n'); return 3; }
    throw e;
  }
  const { snap: despues } = await leerConfig(db, cfg.tenant);
  const d = despues.data() ?? {};
  if (!iguales(d[CAMPO], cfg.valor)) {
    log('\n  ✗ La relectura no coincide con lo escrito. Revise el documento con el seco; el respaldo permite revertir.\n');
    return 3;
  }
  log(`\n  ✓ Escrito y releído: «${CAMPO}» = ${texto(d[CAMPO])}.`);
  log('  Para deshacer: --revertir con el mismo respaldo, tenant y proyecto.\n');
  return 0;
}

/** En qué punto está la corrida: 'antes' (nada guardado), 'respaldo' (guardado, el documento sin escribir), 'escribiendo', 'escrito'. */
const corrida = { estado: 'antes' };

/** Qué decirle al operador si la corrida se corta (Ctrl-C o un error) según el punto en que quedó. */
export function mensajeDeInterrupcion(estado, causa = 'Interrumpido por el operador') {
  if (estado === 'antes') return `\n  ! ${causa} antes de escribir. No se guardó respaldo ni se escribió nada en el documento.\n`;
  if (estado === 'respaldo') {
    return `\n  ! ${causa} con el respaldo YA guardado y el documento sin escribir. Para repetir use OTRA ruta de --respaldo (la anterior ya existe y no se pisa).\n`;
  }
  if (estado === 'escrito') {
    return `\n  ! ${causa} DESPUÉS de escribir: la escritura SÍ se hizo y la relectura no se completó. Corra el seco para verificar el documento; `
      + 'si hay que deshacer, use --revertir con el mismo respaldo, tenant y proyecto.\n';
  }
  return `\n  ! ${causa} DURANTE la escritura: puede haberse escrito o no. Existe el respaldo: corra el seco para ver en qué estado quedó el documento `
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
