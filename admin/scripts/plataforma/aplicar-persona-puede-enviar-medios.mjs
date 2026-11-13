/**
 * ENCENDER O APAGAR `tenants/{id}.personaPuedeEnviarMedios` DE UN SOLO COMERCIO — seco por omisión.
 *
 * QUÉ ES. La segunda bandera de la salida de persona: dice que el comercio puede ENVIAR ADJUNTOS desde la
 * consola (imagen, audio, video, documento) como persona. El servidor exige las DOS banderas en `=== true`
 * (`personaPuedeEscribir` y esta; `core/conversacion/turno.ts`): sin esta, `enviarAdjuntoComoPersona`
 * rechaza y la consola no ofrece el clip. Ningún navegador puede escribirla (`firestore.rules`: `tenants/{id}`
 * no admite escritura de clientes); este script es el único camino. Calcado de
 * `aplicar-persona-puede-escribir.mjs`: mismas salvaguardas, mismo respaldo, mismos códigos de salida.
 *
 *   node scripts/plataforma/aplicar-persona-puede-enviar-medios.mjs --proyecto <id> --tenant <id> \
 *        --valor true|false [--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]
 *   node scripts/plataforma/aplicar-persona-puede-enviar-medios.mjs --revertir --respaldo <ruta> \
 *        --tenant <id> --proyecto <id> [--aplicar] [--confirmo-produccion <tenant>]
 *
 * ANTES DE ENCENDER (no lo verifica el script; lo verifica quien lo corre y lo autoriza Andres):
 *   · las Functions `enviarAdjuntoComoPersona` y `leerAdjuntoPersona` abiertas a invocación
 *     (`scripts/nube-visor.sh`);
 *   · el flujo «Salida de persona» de ese número publicado CON la rama de adjuntos: la verificación 4f de
 *     `verificar-salida-persona.mjs --medios`;
 *   · que el número envía por Graph, no por el relé (el relé no sube adjuntos).
 *
 * PRECONDICIONES (todas antes de escribir; si falla una, salida 2 y nada escrito):
 *   · la ficha EXISTE (un tenant desconocido no se crea nunca);
 *   · el comercio NO está excluido: la lista fija de la bandera (`TENANTS_EXCLUIDOS_BANDERA`, hoy vacía) más
 *     lo que agregue la variable `NOVUCHAT_TENANTS_EXCLUIDOS`, por id, por lo que lo contenga o por el nombre
 *     de la ficha — vale para encender y para apagar;
 *   · para ENCENDER (`--valor true`): la ficha ya tiene `personaPuedeEscribir === true` (booleano exacto),
 *     `consolaConversaciones === 'nueva'` y `estado === 'activo'`; el mensaje dice cuál falta. Lo mismo
 *     vale para `--revertir` cuando restaurar significa volver a ENCENDER (el respaldo guardó `true`), sobre
 *     la misma lectura. Si la bandera YA está en `true` y hoy falta alguna precondición, `--valor true` sale
 *     con 2 igualmente (las precondiciones se evalúan antes que la idempotencia; no se «perdona» una ficha
 *     que ya no las cumple). Apagar (`--valor false`) no exige nada más: es la dirección segura;
 *   · si la ficha ya tiene el campo con algo que no es un booleano, no se pisa.
 *
 * QUÉ HACE.
 *   · SECO: una lectura; imprime valor actual → nuevo; no escribe.
 *   · Cuando el valor a escribir es `true` (aplicar o revertir), el seco y `--aplicar` (antes de escribir)
 *     imprimen el bloque «ANTES DE ENCENDER (este script no lo verifica)».
 *   · `--aplicar`: exige `--respaldo`; guarda el valor previo (o su AUSENCIA), lo relee y recién entonces
 *     escribe, en UN lote atómico, SOLO `personaPuedeEnviarMedios` (con la precondición de la hora de
 *     actualización leída) y UN documento de auditoría en `tenants/{id}/auditoria`
 *     (`accion: persona_puede_enviar_medios_cambiada`, valor anterior, valor nuevo, origen `script`, `script`, entorno;
 *     sin teléfonos, rutas, secretos ni id de proyecto). Si la ficha cambió, no queda ni el campo ni la
 *     auditoría. Relee y compara.
 *   · `--revertir --aplicar`: restaura desde el respaldo (si no existía, ELIMINA el campo) y audita igual,
 *     en el mismo lote. No pisa un cambio ajeno.
 *   · IDEMPOTENTE: si el valor ya es el pedido, sale con 0 sin escribir (tampoco audita).
 *
 * SALVAGUARDA DE PROYECTO Y RESPALDO: las de `aplicar-consola-conversaciones.mjs` (lista blanca de proyectos,
 * confirmación contra producción, respaldo 0600 en carpeta 0700 fuera de `~/` y del repositorio versionado,
 * nunca se pisa). El id de un proyecto real NUNCA se imprime.
 *
 * SALIDA. 0: seco sin diferencias, o escritura hecha y comprobada. 1: el seco encontró diferencias.
 * 2: uso, salvaguarda o precondición (nada escrito). 3: error de ejecución. 130: Ctrl-C.
 *
 * COSTO. Seco: una lectura. `--aplicar`: dos lecturas y dos escrituras (campo y auditoría) en un lote.
 * 0 mensajes por conversación. NO se corre contra producción sin el «sí» de Andres.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ID_TENANT, comprobarProyecto, comprobarRespaldo, esTenantExcluidoDeBandera as esTenantExcluido, guardarRespaldo,
  leerRespaldoGenerico, mensajeDeInterrupcion, nombreExcluidoDeBandera as nombreExcluido, rutaDelRespaldoSigueIgual,
} from './aplicar-consola-conversaciones.mjs';

export { comprobarProyecto, guardarRespaldo, mensajeDeInterrupcion };

const CAMPO = 'personaPuedeEnviarMedios';
const CAMPO_PREVIO = 'personaPuedeEscribir';
export const ACCION_AUDITORIA = 'persona_puede_enviar_medios_cambiada';
const CON_VALOR = ['proyecto', 'tenant', 'valor', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];

export const USO = '  node scripts/plataforma/aplicar-persona-puede-enviar-medios.mjs --proyecto <id> --tenant <id> --valor true|false '
  + '[--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]\n'
  + '  node scripts/plataforma/aplicar-persona-puede-enviar-medios.mjs --revertir --respaldo <ruta> --tenant <id> --proyecto <id> '
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
  else if (esTenantExcluido(tenant, env)) problemas.push('este comercio está EXCLUIDO (NOVUCHAT_TENANTS_EXCLUIDOS): no se escribe esta bandera');

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
/** Lo que falta en la ficha para ENCENDER (lista vacía = se puede). Una sola lectura, una sola regla. */
function faltantesParaEncender(ficha) {
  const faltan = [];
  if (ficha[CAMPO_PREVIO] !== true) faltan.push(`${CAMPO_PREVIO} === true (booleano exacto; se enciende primero con aplicar-persona-puede-escribir.mjs)`);
  if (ficha.consolaConversaciones !== 'nueva') faltan.push('consolaConversaciones === "nueva" (explícito)');
  if (ficha.estado !== 'activo') faltan.push('estado === "activo"');
  return faltan;
}

const AVISO_ENCENDER = [
  '  ANTES DE ENCENDER (este script no lo verifica):',
  '    · verificar-salida-persona con --medios, con 4a y 4f en OK;',
  '    · las Functions enviarAdjuntoComoPersona y leerAdjuntoPersona abiertas a invocación;',
  '    · el número envía por Graph, no por el relé.',
].join('\n');

const mostrar = (ficha, hay) => (hay ? (esBooleano(ficha[CAMPO]) ? String(ficha[CAMPO]) : '(no es un booleano)') : 'AUSENTE (equivale a false)');

/**
 * LA ÚNICA ESCRITURA A FIRESTORE DE TODO EL ARCHIVO: UN lote atómico con (1) `update` de solo
 * `personaPuedeEnviarMedios`, con la precondición de la hora leída, y (2) UN documento de auditoría.
 * Si la precondición falla, el lote entero falla: no queda ni el campo ni la auditoría.
 * `anterior` y `nuevo` van como booleano o `null` (= ausente). Nada del comercio, ni teléfonos, ni proyecto.
 */
async function escribirCampoYAuditar(db, ref, valor, ultimaActualizacion, { FieldValue, entorno, operacion, anterior }) {
  const lote = db.batch();
  lote.update(ref, { [CAMPO]: valor }, { lastUpdateTime: ultimaActualizacion });
  lote.create(ref.collection('auditoria').doc(), {
    // `uid` queda en 'script': el patrón de `asignar-plan`/`fijar-flujos` exige `--operador <correo>`, y este script no
    // tiene esa opción (ni debe guardar un correo). `script` nombra la herramienta, como en `fijar-flujos`.
    accion: ACCION_AUDITORIA, uid: 'script', script: 'aplicar-persona-puede-enviar-medios', en: FieldValue.serverTimestamp(),
    campo: CAMPO, anterior, nuevo: typeof valor === 'boolean' ? valor : null, origen: 'script', entorno, operacion,
  });
  await lote.commit();
}

async function leerFicha(db, tenant) {
  const ref = db.doc(`tenants/${tenant}`);
  const [snap] = await db.getAll(ref, { fieldMask: [CAMPO, CAMPO_PREVIO, 'consolaConversaciones', 'nombre', 'estado'] });
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

  // Segunda barrera de exclusión, antes de leer: el id también se comprueba aquí.
  if (esTenantExcluido(cfg.tenant, deps.env)) { log('\n  ✗ Este comercio está EXCLUIDO (NOVUCHAT_TENANTS_EXCLUIDOS). No se escribió nada.\n'); return 2; }

  const { ref, snap } = await leerFicha(db, cfg.tenant);
  // Un tenant desconocido NO se crea ni se toca.
  if (!snap.exists) { log(`\n  ✗ ${cfg.tenant}: no existe la ficha (${cfg.entorno}). No se escribió nada.\n`); return 2; }
  const ficha = snap.data() ?? {};
  if (nombreExcluido(ficha.nombre, deps.env)) {
    log('\n  ✗ El nombre de la ficha corresponde a un comercio EXCLUIDO (no se toca). No se escribió nada.\n');
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
    if (previo.presente && previo.valor === true) {
      // Revertir a «encendida» ES encender: mismas precondiciones, sobre la misma lectura.
      const faltan = faltantesParaEncender(ficha);
      if (faltan.length) {
        log(`\n  ✗ Revertir volvería a ENCENDER la bandera y a la ficha le falta: ${faltan.join('; ')}. No se escribió nada.\n`);
        return 2;
      }
      log(`\n${AVISO_ENCENDER}`);
    }
    if (!cfg.aplicar) {
      log('\n  Seco: no se escribió nada. Queda un cambio pendiente; agregue --aplicar para revertir.\n');
      return 1;
    }
    marcar('escribiendo');
    try {
      await escribirCampoYAuditar(db, ref, previo.presente ? previo.valor : FieldValue.delete(), snap.updateTime, {
        FieldValue, entorno: cfg.entorno, operacion: 'revertir', anterior: hoyPresente && esBooleano(ficha[CAMPO]) ? ficha[CAMPO] : null,
      });
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

  // Precondiciones para ENCENDER. Apagar siempre se permite (salvo un comercio excluido, arriba).
  if (cfg.valor === true) {
    const faltan = faltantesParaEncender(ficha);
    if (faltan.length) {
      log(`\n  ✗ Para encenderla falta en la ficha: ${faltan.join('; ')}. No se escribió nada.\n`);
      return 2;
    }
  }

  if (hoyPresente && ficha[CAMPO] === cfg.valor) { log(`\n  ✓ «${CAMPO}» ya está escrita con ese valor: nada que hacer.\n`); return 0; }
  if (cfg.valor === true) log(`\n${AVISO_ENCENDER}`);
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
    await escribirCampoYAuditar(db, ref, cfg.valor, snap.updateTime, {
      FieldValue, entorno: cfg.entorno, operacion: 'aplicar', anterior: hoyPresente && esBooleano(ficha[CAMPO]) ? ficha[CAMPO] : null,
    });
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
