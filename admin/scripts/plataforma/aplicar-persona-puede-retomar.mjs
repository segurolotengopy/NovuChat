/**
 * ENCENDER O APAGAR `tenants/{id}.personaPuedeRetomar` DE UN SOLO COMERCIO — seco por omisión.
 *
 * QUÉ ES. La bandera de «Retomar» (contrato C2 del plan del 23/11/2026): dice que el comercio puede escribirle a un
 * cliente cuya ventana de 24 h de Meta ya cerró, enviando la plantilla aprobada de su número. El servidor la exige en
 * `=== true` junto con `personaPuedeEscribir` (`core/conversacion/turno.ts`): sin ella, `retomarConversacion` rechaza y
 * la consola no ofrece el botón. Ningún navegador puede escribirla (`firestore.rules`: `tenants/{id}` y
 * `rutasWhatsApp/{n}` no admiten escritura de clientes); este script es el único camino. Calcado de
 * `aplicar-persona-puede-enviar-medios.mjs`: mismas salvaguardas, mismo respaldo, mismos códigos de salida.
 *
 *   node scripts/plataforma/aplicar-persona-puede-retomar.mjs --proyecto <id> --tenant <id> --valor true|false \
 *        [--alias <clienteNN> --env <archivo>] [--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]
 *   node scripts/plataforma/aplicar-persona-puede-retomar.mjs --revertir --respaldo <ruta> \
 *        --tenant <id> --proyecto <id> [--alias <clienteNN> --env <archivo>] [--aplicar] [--confirmo-produccion <tenant>]
 *
 * PRECONDICIONES PARA ENCENDER (`--valor true`, o revertir a `true`); todas antes de escribir, nada escrito si falla:
 *   · la ficha EXISTE, el comercio NO está excluido, y tiene `personaPuedeEscribir === true` (booleano exacto),
 *     `consolaConversaciones === 'nueva'` y `estado === 'activo'`;
 *   · TODAS las rutas activas del comercio (`rutasWhatsApp` con su `tenantId`; activa = sin `estado` o `estado ===
 *     'activo'`) traen `plantillas.retomar` válida según C1 (`plantillaRetomarValida`: UTILITY, APPROVED, 1 variable,
 *     nombre e idioma con su patrón). Si falta o no cumple en alguna, sale con CÓDIGO 5, «pendiente de Meta»: se
 *     registra la plantilla con `registrar-plantilla.mjs` cuando WAM la informe aprobada;
 *   · la salida publicada admite plantillas: `verificar-salida-persona.mjs --plantillas` (4g: `Reclamar` activo con la
 *     cabecera `x-novuchat-plantillas: 1`), que necesita `--alias` y `--env`. Sin ella el servidor nunca entrega una
 *     plantilla a ese flujo y se perdería. Se verifica la salida de CADA alias distinto de las rutas activas (cada alias es un
 *     flujo n8n); `--alias` tiene que ser uno de ellos (si no, salida 2). Si alguna no la admite => salida 6.
 *   · El cambio de rutas ENTRE esta comprobación y la escritura (una ruta nueva, una plantilla pausada) no lo cubre este
 *     script: lo cubre el servidor al enviar, que vuelve a exigir C1 en la ruta del mensaje y la cabecera en el reclamo.
 *   Apagar (`--valor false`) no exige nada más: es la dirección segura y tiene que poder hacerse aunque una plantilla
 *   se haya pausado.
 *
 * QUÉ HACE.
 *   · SECO: lecturas (ficha, rutas y, con alias y env, la verificación de solo lectura); no escribe.
 *   · `--aplicar`: exige `--respaldo`; guarda el valor previo (o su AUSENCIA), lo relee y recién entonces escribe, en UN
 *     lote atómico, SOLO `personaPuedeRetomar` (con la precondición de la hora leída) y UN documento de auditoría en
 *     `tenants/{id}/auditoria` (`accion: persona_puede_retomar_cambiada`; sin teléfonos, rutas, secretos ni proyecto).
 *     Relee y compara.
 *   · `--revertir --aplicar`: restaura desde el respaldo (si no existía, ELIMINA el campo). No pisa un cambio ajeno.
 *   · IDEMPOTENTE: si el valor ya es el pedido, sale con 0 sin escribir.
 *
 * SALIDA. 0: seco sin diferencias, o escritura hecha y comprobada. 1: el seco encontró diferencias. 2: uso,
 * salvaguarda o precondición (nada escrito). 3: error de ejecución. 5: PENDIENTE DE META (falta una plantilla válida;
 * nada escrito). 6: PENDIENTE DE REPUBLICAR LA SALIDA (plantilla bien, pero la salida de algún alias no lleva la cabecera; nada
 * escrito). 130: Ctrl-C.
 *
 * COSTO. Seco: lecturas. `--aplicar`: lecturas y dos escrituras (campo y auditoría) en un lote. 0 mensajes por
 * conversación. NO se corre contra producción sin el «sí» de Andres.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ID_TENANT, comprobarProyecto, comprobarRespaldo, esTenantExcluidoDeBandera as esTenantExcluido, guardarRespaldo,
  leerRespaldoGenerico, mensajeDeInterrupcion, nombreExcluidoDeBandera as nombreExcluido, rutaDelRespaldoSigueIgual,
} from './aplicar-consola-conversaciones.mjs';
import { plantillaRetomarValida } from './registrar-plantilla.mjs';

export { comprobarProyecto, guardarRespaldo, mensajeDeInterrupcion };

const CAMPO = 'personaPuedeRetomar';
const CAMPO_PREVIO = 'personaPuedeEscribir';
export const ACCION_AUDITORIA = 'persona_puede_retomar_cambiada';
const CON_VALOR = ['proyecto', 'tenant', 'valor', 'respaldo', 'confirmo-produccion', 'alias', 'env'];
const BANDERAS = ['aplicar', 'revertir', 'sin-redespliegue'];
const ID_ALIAS = /^[A-Za-z][A-Za-z0-9]{1,29}$/;
const ARCHIVO_ENV = /^\.env(\.[a-z0-9-]+)?$/;
const AQUI = dirname(fileURLToPath(import.meta.url));

/** Salida propia: la plantilla no está lista (pendiente de Meta/WAM). El orquestador la trata como «pendiente», no como fallo. */
export const CODIGO_PENDIENTE_DE_META = 5;
/** Salida propia: la plantilla está registrada pero la salida publicada todavía no lleva la cabecera de plantillas (hay que republicar). Pendiente, no fallo. */
export const CODIGO_PENDIENTE_DE_SALIDA = 6;

export const USO = '  node scripts/plataforma/aplicar-persona-puede-retomar.mjs --proyecto <id> --tenant <id> --valor true|false '
  + '[--alias <clienteNN> --env <archivo>] [--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]\n'
  + '  node scripts/plataforma/aplicar-persona-puede-retomar.mjs --revertir --respaldo <ruta> --tenant <id> --proyecto <id> '
  + '[--alias <clienteNN> --env <archivo>] [--aplicar] [--confirmo-produccion <tenant>]';

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

  const { alias, env: archivoEnv } = valores;
  if (alias !== undefined && !ID_ALIAS.test(alias)) problemas.push('--alias inválido (letras y dígitos, de 2 a 30, empieza con letra)');
  if (archivoEnv !== undefined && !ARCHIVO_ENV.test(archivoEnv)) problemas.push('--env tiene que ser un archivo .env de la raíz del repositorio (.env o .env.<nombre>)');
  if ((alias === undefined) !== (archivoEnv === undefined)) problemas.push('--alias y --env van juntos (los pide la verificación de la salida publicada)');

  let valor = null;
  if (revertir) {
    if ('valor' in valores) problemas.push('--revertir no admite --valor: restaura lo del respaldo');
    if (respaldo === undefined) problemas.push('--revertir exige --respaldo <ruta>');
  } else {
    if (!('valor' in valores)) problemas.push('falta --valor');
    else {
      const r = validarValor(valores['valor']);
      if (r.ok) valor = r.valor; else problemas.push(...r.problemas);
      if (valor === true && alias === undefined) problemas.push('para encender, --alias y --env son obligatorios: la salida publicada se verifica con --plantillas');
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
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, valor, aplicar, revertir, respaldo: respaldoReal, respaldoResuelto, alias: alias ?? null, envArchivo: archivoEnv ?? null, sinRedespliegue: banderas.includes('sin-redespliegue') } };
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
  '  ANTES DE ENCENDER (lo que este script SÍ verifica: C1 en todas las rutas activas y la salida con --plantillas; lo que no):',
  '    · la Function retomarConversacion desplegada y abierta a invocación (scripts/nube-visor.sh);',
  '    · el texto de la plantilla aprobado en Meta es el que WAM informó (D-R4).',
].join('\n');

/** Los alias son del secreto de rutas: en pantalla solo la cola. */
const cola = (v) => (v ? `…${String(v).slice(-4)}` : '—');

/** Rutas activas del comercio (solo lectura). Activa = sin `estado` o `estado === 'activo'`. */
export async function rutasActivasDelComercio(db, tenant) {
  const snap = await db.collection('rutasWhatsApp').where('tenantId', '==', tenant).get();
  return snap.docs
    .filter((d) => { const e = d.get('estado'); return e === undefined || e === null || e === 'activo'; })
    .map((d) => ({ id: d.id, plantilla: d.get('plantillas.retomar'), alias: d.get('aliasSecreto') }));
}

/** Rutas sin C1 válido (puro). */
export const rutasSinPlantilla = (rutas) => rutas.filter((r) => !plantillaRetomarValida(r.plantilla));

/**
 * Verifica la salida publicada con `verificar-salida-persona.mjs --plantillas` (solo lectura) como proceso hijo.
 * Sale 0 si 1a a 4e y 4g están en OK. Nunca imprime valores: el verificador ya no los muestra.
 */
export function verificarSalidaReal(cfg, { log = (t) => console.log(t) } = {}) {
  const args = [join(AQUI, 'verificar-salida-persona.mjs'), '--proyecto', cfg.proyecto, '--alias', cfg.alias, '--tenant', cfg.tenant,
    '--env', cfg.envArchivo, '--plantillas', ...(cfg.sinRedespliegue ? ['--sin-redespliegue'] : [])];
  const r = spawnSync(process.execPath, args, { cwd: join(AQUI, '..', '..', '..'), encoding: 'utf8', env: process.env, maxBuffer: 32 * 1024 * 1024, timeout: 15 * 60_000 });
  const salida = `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd();
  if (salida) log(salida);
  return { ok: r.status === 0, codigo: r.status ?? 3 };
}

/**
 * Las precondiciones de ENCENDER que no son de la ficha: C1 en TODAS las rutas activas (5 si falta) y la salida con
 * plantillas (2 si no). `null` = se puede. Solo lecturas.
 */
async function comprobarParaEncender(cfg, deps, log) {
  const rutas = await rutasActivasDelComercio(deps.db, cfg.tenant);
  if (rutas.length === 0) {
    log('\n  ✗ El comercio no tiene ninguna ruta activa en rutasWhatsApp: no hay número desde el cual retomar. No se escribió nada.\n');
    return 2;
  }
  const malas = rutasSinPlantilla(rutas);
  if (malas.length) {
    log(`\n  ⏳ PENDIENTE DE META: ${malas.length} de ${rutas.length} ruta(s) activa(s) no tienen una plantilla «retomar» válida `
      + '(UTILITY, APPROVED, 1 variable). Cuando WAM la informe aprobada, regístrela con registrar-plantilla.mjs y repita. No se escribió nada.');
    log(`  Rutas sin plantilla: ${malas.map((r) => `…${String(r.id).slice(-4)}`).join(', ')}\n`);
    return CODIGO_PENDIENTE_DE_META;
  }
  // La salida que verifica es la de CADA alias distinto de las rutas activas (cada alias es un flujo n8n): con dos números y
  // una sola salida republicada, la otra perdería la plantilla.
  const aliases = [...new Set(rutas.map((r) => r.alias))];
  if (aliases.some((a) => typeof a !== 'string' || a === '')) {
    log('\n  ✗ Una ruta activa no tiene alias (aliasSecreto): no se puede verificar su salida. No se escribió nada.\n');
    return 2;
  }
  if (typeof deps.verificarSalida !== 'function' || !cfg.alias || !cfg.envArchivo) {
    log('\n  ✗ No se puede verificar la salida publicada (faltan --alias y --env): sin la cabecera de plantillas el flujo la perdería. No se escribió nada.\n');
    return 2;
  }
  if (!aliases.includes(cfg.alias)) {
    log('\n  ✗ --alias no es el de ninguna ruta activa del comercio (los alias de sus rutas activas son otros). No se escribió nada.\n');
    return 2;
  }
  for (const alias of aliases) {
    log(`\n  Verificando la salida publicada con --plantillas (solo lectura) · alias ${cola(alias)}…`);
    const v = await deps.verificarSalida({ ...cfg, alias });
    if (!v?.ok) {
      log(`\n  ⏳ PENDIENTE DE REPUBLICAR LA SALIDA: la del alias ${cola(alias)} NO admite plantillas (4g) o falló otra puerta. `
        + 'Republique el flujo con x-novuchat-plantillas: 1 y repita. No se escribió nada.\n');
      return CODIGO_PENDIENTE_DE_SALIDA;
    }
  }
  return null;
}

const mostrar = (ficha, hay) => (hay ? (esBooleano(ficha[CAMPO]) ? String(ficha[CAMPO]) : '(no es un booleano)') : 'AUSENTE (equivale a false)');

/**
 * LA ÚNICA ESCRITURA A FIRESTORE DE TODO EL ARCHIVO: UN lote atómico con (1) `update` de solo
 * `personaPuedeRetomar`, con la precondición de la hora leída, y (2) UN documento de auditoría.
 * Si la precondición falla, el lote entero falla: no queda ni el campo ni la auditoría.
 * `anterior` y `nuevo` van como booleano o `null` (= ausente). Nada del comercio, ni teléfonos, ni proyecto.
 */
async function escribirCampoYAuditar(db, ref, valor, ultimaActualizacion, { FieldValue, entorno, operacion, anterior }) {
  const lote = db.batch();
  lote.update(ref, { [CAMPO]: valor }, { lastUpdateTime: ultimaActualizacion });
  lote.create(ref.collection('auditoria').doc(), {
    // `uid` queda en 'script': el patrón de `asignar-plan`/`fijar-flujos` exige `--operador <correo>`, y este script no
    // tiene esa opción (ni debe guardar un correo). `script` nombra la herramienta, como en `fijar-flujos`.
    accion: ACCION_AUDITORIA, uid: 'script', script: 'aplicar-persona-puede-retomar', en: FieldValue.serverTimestamp(),
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
      const no = await comprobarParaEncender(cfg, deps, log);
      if (no !== null) return no;
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
    // Las precondiciones se evalúan antes que la idempotencia: una ficha con la bandera ya en true pero sin plantilla NO se «perdona».
    const no = await comprobarParaEncender(cfg, deps, log);
    if (no !== null) return no;
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
  const codigo = await ejecutar(cfg, { db, FieldValue, verificarSalida: verificarSalidaReal, marcarEscritura: (v) => { corrida.estado = v; } });
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
