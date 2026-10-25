/**
 * ENCENDER O APAGAR `tenants/{id}.personaPuedeEscribir` DE UN SOLO COMERCIO — seco por omisión.
 *
 * QUÉ ES. La bandera que dice que la SALIDA de lo que escribe una persona está publicada para ese
 * comercio: el flujo n8n «Salida de persona» de su número. Sin ella (`=== true` EXACTO), el servidor
 * rechaza «Tomar», escribir como persona y la consola no ofrece ni el botón ni el cuadro. Devolver una
 * conversación ya tomada NO la exige (liberar es la dirección segura). Ver `accesoPersona.ts`.
 * Ningún navegador puede escribirla (`firestore.rules`: `tenants/{id}` no admite escritura de clientes);
 * este script es el único camino. Misma estructura, mismas salvaguardas y mismo respaldo que
 * `aplicar-consola-conversaciones.mjs` (del que importa lo común; ese archivo no se toca).
 *
 *   node scripts/plataforma/aplicar-persona-puede-escribir.mjs --proyecto <id> --tenant <id> \
 *        --valor true|false [--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]
 *   node scripts/plataforma/aplicar-persona-puede-escribir.mjs --revertir --respaldo <ruta> \
 *        --tenant <id> --proyecto <id> [--aplicar] [--confirmo-produccion <tenant>]
 *
 * PRECONDICIONES (todas antes de escribir; si falla una, salida 2 y nada escrito):
 *   · la ficha EXISTE (un tenant desconocido no se crea nunca);
 *   · el comercio NO es Bellido (por id, por lo que lo contenga, ni por el nombre de la ficha; la
 *     variable `NOVUCHAT_TENANTS_EXCLUIDOS` solo agrega) — vale para encender y para apagar;
 *   · para ENCENDER (`--valor true`): la ficha ya tiene `consolaConversaciones === 'nueva'` EXPLÍCITO y
 *     `estado === 'activo'`. Apagar (`--valor false`) no exige nada más: es la dirección segura y tiene
 *     que poder hacerse aunque el comercio haya vuelto a la pantalla clásica o se haya suspendido;
 *   · si la ficha ya tiene el campo con algo que no es un booleano, no se pisa (no se puede respaldar y
 *     restaurar con fidelidad).
 *
 * QUÉ HACE.
 *   · SECO: una lectura (solo los campos de arriba); imprime valor actual → nuevo; no escribe.
 *   · `--aplicar`: exige `--respaldo`; guarda el valor previo (o su AUSENCIA), lo relee y recién entonces
 *     escribe SOLO `personaPuedeEscribir` con la precondición de la hora de actualización leída (si la
 *     ficha cambió entre la lectura y la escritura, aborta sin escribir). Relee y compara. UNA escritura.
 *   · `--revertir --aplicar`: restaura desde el respaldo (si no existía, ELIMINA el campo). No pisa un
 *     cambio ajeno: si el campo de hoy no es lo que escribió este script, sale con 2 sin escribir.
 *   · IDEMPOTENTE: si el valor ya es el pedido, sale con 0 sin escribir.
 *
 * SALVAGUARDA DE PROYECTO Y RESPALDO: las mismas de `aplicar-consola-conversaciones.mjs` (lista blanca
 * de proyectos, confirmación contra producción, respaldo 0600 en carpeta 0700 fuera de `~/` y del
 * repositorio versionado, nunca se pisa). El id de un proyecto real NUNCA se imprime.
 *
 * SALIDA. 0: seco sin diferencias, o escritura hecha y comprobada. 1: el seco encontró diferencias.
 * 2: uso, salvaguarda o precondición (nada escrito). 3: error de ejecución. 130: Ctrl-C.
 *
 * COSTO. Seco: una lectura. `--aplicar`: dos lecturas y UNA escritura de un campo. 0 mensajes por
 * conversación. NO se corre contra producción sin el «sí» de Andres, y solo cuando el flujo «Salida de
 * persona» de ese número está publicado y probado.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ID_TENANT, comprobarProyecto, comprobarRespaldo, esTenantExcluido, guardarRespaldo,
  leerRespaldoGenerico, mensajeDeInterrupcion, nombreExcluido, rutaDelRespaldoSigueIgual,
} from './aplicar-consola-conversaciones.mjs';

export { comprobarProyecto, guardarRespaldo, mensajeDeInterrupcion };

const CAMPO = 'personaPuedeEscribir';
const CON_VALOR = ['proyecto', 'tenant', 'valor', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];

export const USO = '  node scripts/plataforma/aplicar-persona-puede-escribir.mjs --proyecto <id> --tenant <id> --valor true|false '
  + '[--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]\n'
  + '  node scripts/plataforma/aplicar-persona-puede-escribir.mjs --revertir --respaldo <ruta> --tenant <id> --proyecto <id> '
  + '[--aplicar] [--confirmo-produccion <tenant>]';

/** `--valor` solo acepta los textos exactos `true` y `false`. */
export function validarValor(texto) {
  if (texto === 'true') return { ok: true, valor: true };
  if (texto === 'false') return { ok: true, valor: false };
  return { ok: false, problemas: ['--valor tiene que ser exactamente true o false'] };
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
  else if (esTenantExcluido(tenant, env)) problemas.push('este comercio está EXCLUIDO (Bellido no se toca): no se escribe esta bandera');

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
// RESPALDO
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

/** LA ÚNICA ESCRITURA A FIRESTORE DE TODO EL ARCHIVO: solo `personaPuedeEscribir`, con la precondición de la hora leída. */
async function escribirCampo(ref, valor, ultimaActualizacion) {
  await ref.update({ [CAMPO]: valor }, { lastUpdateTime: ultimaActualizacion });
}

async function leerFicha(db, tenant) {
  const ref = db.doc(`tenants/${tenant}`);
  const [snap] = await db.getAll(ref, { fieldMask: [CAMPO, 'consolaConversaciones', 'nombre', 'estado'] });
  return { ref, snap };
}

/**
 * Corre la operación ya validada. `deps`: `{ db, FieldValue, log, marcarEscritura, env }`. Devuelve el código de salida.
 */
export async function ejecutar(cfg, deps) {
  const { db, FieldValue } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const marcar = deps.marcarEscritura ?? (() => {});
  const rotulo = `${cfg.entorno} · tenant ${cfg.tenant}`;

  // Segunda barrera de Bellido, antes de leer: el id también se comprueba aquí.
  if (esTenantExcluido(cfg.tenant, deps.env)) { log('\n  ✗ Este comercio está EXCLUIDO (Bellido no se toca). No se escribió nada.\n'); return 2; }

  const { ref, snap } = await leerFicha(db, cfg.tenant);
  // Un tenant desconocido NO se crea ni se toca.
  if (!snap.exists) { log(`\n  ✗ ${cfg.tenant}: no existe la ficha (${cfg.entorno}). No se escribió nada.\n`); return 2; }
  const ficha = snap.data() ?? {};
  if (nombreExcluido(ficha.nombre, deps.env)) {
    log('\n  ✗ El nombre de la ficha corresponde a un comercio EXCLUIDO (Bellido no se toca). No se escribió nada.\n');
    return 2;
  }
  const hoyPresente = Object.prototype.hasOwnProperty.call(ficha, CAMPO);

  // ------------------------------------------------------------------ revertir
  if (cfg.revertir) {
    const lectura = leerRespaldo(cfg.respaldo, cfg);
    if (!lectura.ok) { log(`\n  ✗ ${lectura.motivo}\n`); return 2; }
    const { previo, escrito } = lectura.respaldo;
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
    log(`  «${CAMPO}» antes del respaldo : ${previo.presente ? previo.valor : 'AUSENTE (se eliminaría el campo)'}`);
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
  log(`  cambio              : ${hoyPresente && esBooleano(ficha[CAMPO]) ? ficha[CAMPO] : 'AUSENTE'} → ${cfg.valor}`);

  // Precondiciones para ENCENDER. Apagar siempre se permite (salvo Bellido, arriba).
  if (cfg.valor === true) {
    if (ficha.consolaConversaciones !== 'nueva') {
      log('\n  ✗ Para encenderla, la ficha ya tiene que tener consolaConversaciones === "nueva" (explícito). No se escribió nada.\n');
      return 2;
    }
    if (ficha.estado !== 'activo') {
      log('\n  ✗ Para encenderla, el comercio tiene que estar activo. No se escribió nada.\n');
      return 2;
    }
  }

  if (hoyPresente && ficha[CAMPO] === cfg.valor) { log(`\n  ✓ «${CAMPO}» ya está escrita con ese valor: nada que hacer.\n`); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (y --respaldo) para escribir.\n'); return 1; }

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
  log(`\n  ✓ Escrito y releído: «${CAMPO}» = ${d[CAMPO]}.`);
  log('  Para deshacer: --revertir con el mismo respaldo, tenant y proyecto.\n');
  return 0;
}

/** En qué punto está la corrida: 'antes' (nada guardado), 'respaldo', 'escribiendo', 'escrito'. */
const corrida = { estado: 'antes' };

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
