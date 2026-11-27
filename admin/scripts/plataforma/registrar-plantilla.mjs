/**
 * REGISTRAR LA PLANTILLA DE «RETOMAR» DE UN NÚMERO — seco por omisión.
 *
 * QUÉ ES. Retomar (escribirle a un cliente cuando la ventana de 24 h de Meta ya cerró) envía una plantilla aprobada.
 * Cada número vivo (cada WABA) tiene la suya, que crea y aprueba WAM (WhatsApp-Modular): aquí nunca se llama a Meta
 * (`message_templates` es de esa sesión). Este script solo ANOTA, como dato del número, lo que WAM informa:
 *
 *   rutasWhatsApp/{phoneNumberId}.plantillas.retomar = { nombre, idioma, categoria, estado, variables, registradaEn }
 *
 * Es el contrato C1 del plan de Retomar (23/11/2026). El servidor solo envía si el registro es EXACTO:
 * `nombre` ^[a-z0-9_]{1,100}$, `idioma` ^[a-z]{2,3}(_[A-Z]{2})?$, `categoria === 'UTILITY'`, `estado === 'APPROVED'`
 * y `variables === 1`. El mapa `plantillas` se llama así a propósito: otros usos (aviso a recepción, envío masivo)
 * agregan sus claves ahí. Solo se toca la clave del uso pedido; las demás se conservan.
 *
 *   node scripts/plataforma/registrar-plantilla.mjs --proyecto <id> --numero <phoneNumberId> --uso retomar \
 *        --nombre <nombre> --idioma <es> --categoria UTILITY --estado APPROVED [--variables 1] \
 *        [--aplicar --respaldo <ruta> [--confirmo-produccion <phoneNumberId>]]
 *
 * USO `campana` (PR-C de la campaña saliente del chat, 26/11/2026): la plantilla de la campaña saliente, también por número,
 * en `rutasWhatsApp/{n}.plantillas.campana = { nombre, idioma, categoria, estado, variables, cabecera, botones, registradaEn }`.
 * Se registra SOLO si es UTILITY o MARKETING (Meta puede reclasificarla), APPROVED, `--variables 0`, `--cabecera ninguna` y
 * `--botones 2` (dos respuestas rápidas). Aquí no hay modo «apagar»: un estado distinto de APPROVED no se registra; una campaña en
 * marcha se detiene con `campana-saliente.mjs pausar`. El nombre de la plantilla es DATO del número, nunca del código.
 *
 * DP4 (PR-C): en lugar de `--numero` se puede dar `--tenant <id> --linea <4 últimos dígitos>`: el número se resuelve desde
 * `rutasWhatsApp` (`tenantId == tenant`, `estado == 'activo'`, exactamente 1 coincidencia; 0 o 2 salen con 2 sin escribir). Con esa
 * forma, `--confirmo-produccion` es la línea. Nunca se pasa ni se imprime el id completo.
 *
 * REGLAS.
 *   · Con `--estado APPROVED` se exige UTILITY y `--variables 1` (lo contrario no se registra: el servidor no la usaría
 *     y dejaría una plantilla «buena» que no lo es).
 *   · Con un estado distinto de APPROVED (PAUSED, REJECTED, DISABLED, PENDING…) SÍ se permite registrar cualquier
 *     categoría: sirve para APAGAR Retomar cuando WAM avisa que Meta pausó o recategorizó la plantilla. El nombre y el
 *     idioma se validan siempre.
 *   · REGISTRAR UN ESTADO QUE NO ES APPROVED NO APAGA LA BANDERA. Solo deja anotado que el servidor ya no enviará esa plantilla
 *     (C1 deja de cumplirse). Apagar `personaPuedeRetomar` del comercio es un paso APARTE y explícito:
 *     `aplicar-persona-puede-retomar.mjs --valor false`. Este script no lo encadena.
 *   · La ruta tiene que EXISTIR (nunca se crea una ruta aquí) y no se escribe nada más que `plantillas.<uso>`.
 *   · IDEMPOTENTE: si lo registrado ya es igual (sin contar `registradaEn`), sale con 0 sin escribir.
 *   · Lee el `tenantId` de la ruta y lo muestra (también en el seco). Si ese comercio está EXCLUIDO (id o nombre de la
 *     ficha), sale con 2 sin escribir.
 *   · `--aplicar` exige `--respaldo <ruta>` (valor previo de `plantillas.<uso>`, o su ausencia; 0600 en carpeta 0700, nunca se
 *     pisa; mismas reglas que `aplicar-consola-conversaciones.mjs`).
 *   · Escribe en UN lote: el `update` de solo `plantillas.<uso>` con la precondición de la hora leída, y UN documento de
 *     auditoría en `tenants/{tenantId de la ruta}/auditoria` (`accion: plantilla_registrada`, uso, anterior y nuevo con
 *     nombre, idioma, categoría, estado y variables; script, entorno, hora del servidor; sin teléfono completo ni proyecto).
 *     Si la ruta cambió entre la lectura y la escritura, no queda ni lo uno ni lo otro. Relee y muestra lo que quedó.
 *   · Contra producción, `--aplicar` exige `--confirmo-produccion <phoneNumberId>` (igual a `--numero`). Sin `--aplicar` es
 *     seco (una lectura).
 *
 * SALIDA. 0: sin diferencias o escrito y comprobado. 1: el seco encontró diferencias. 2: uso o precondición (nada
 * escrito). 3: error de ejecución. COSTO: seco, 1 lectura (más la de la ficha); aplicar, 3 lecturas y 2 escrituras (ruta y auditoría). 0 mensajes por
 * conversación. No se corre contra producción sin el «sí» de Andres.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  comprobarProyecto, comprobarRespaldo, esTenantExcluidoDeBandera, guardarRespaldo, ID_TENANT, nombreExcluidoDeBandera,
  rutaDelRespaldoSigueIgual,
} from './aplicar-consola-conversaciones.mjs';

const USOS = ['retomar', 'campana'];
const PATRON_NOMBRE = /^[a-z0-9_]{1,100}$/;
const PATRON_IDIOMA = /^[a-z]{2,3}(_[A-Z]{2})?$/;
const PATRON_ESTADO = /^[A-Z][A-Z_]{2,29}$/;
const CATEGORIAS = ['UTILITY', 'MARKETING', 'AUTHENTICATION'];
const PATRON_NUMERO = /^[0-9]{6,20}$/;
const PATRON_LINEA = /^[0-9]{4}$/;
const CON_VALOR = ['proyecto', 'numero', 'tenant', 'linea', 'uso', 'nombre', 'idioma', 'categoria', 'estado', 'variables', 'cabecera', 'botones', 'respaldo', 'confirmo-produccion'];
/** Lo que la plantilla de campaña lleva de más que la de Retomar: la cabecera (solo `ninguna`) y los botones de respuesta rápida (exactamente 2). */
const CABECERAS = ['ninguna', 'imagen', 'video', 'documento', 'texto', 'ubicacion'];
const BANDERAS = ['aplicar'];

export const USO = '  node scripts/plataforma/registrar-plantilla.mjs --proyecto <id> (--numero <phoneNumberId> | --tenant <id> --linea <4 dígitos>) --uso retomar|campana '
  + '--nombre <nombre> --idioma <es> --categoria UTILITY --estado APPROVED [--variables 1] [--cabecera ninguna --botones 2 (solo campana; --variables 0)] [--aplicar --respaldo <ruta> [--confirmo-produccion <phoneNumberId>]]';

const cola = (n) => `…${String(n).slice(-4)}`;

/**
 * C1 EXACTO, puro: ¿este registro autoriza a enviar? `registradaEn` no cuenta. Todo es `===`: `'1'`, `1.0` en
 * texto, `'utility'` o un estado en minúsculas no valen.
 */
export function plantillaRetomarValida(p) {
  return typeof p === 'object' && p !== null
    && typeof p.nombre === 'string' && PATRON_NOMBRE.test(p.nombre)
    && typeof p.idioma === 'string' && PATRON_IDIOMA.test(p.idioma)
    && p.categoria === 'UTILITY' && p.estado === 'APPROVED' && p.variables === 1;
}

/**
 * Problemas para REGISTRAR (puro). Vacío = se puede escribir. Con APPROVED exige lo mismo que C1; con otro estado
 * permite cualquier categoría y cualquier cantidad de variables entera (para poder apagar).
 */
export function problemasDeLaPlantilla(p, uso = 'retomar') {
  const problemas = [];
  if (typeof p !== 'object' || p === null) return ['no hay datos de la plantilla'];
  if (typeof p.nombre !== 'string' || !PATRON_NOMBRE.test(p.nombre)) problemas.push('--nombre inválido (minúsculas, dígitos y guion bajo, de 1 a 100)');
  if (typeof p.idioma !== 'string' || !PATRON_IDIOMA.test(p.idioma)) problemas.push('--idioma inválido (por ejemplo es, o es_MX)');
  if (typeof p.categoria !== 'string' || !CATEGORIAS.includes(p.categoria)) problemas.push(`--categoria tiene que ser una de ${CATEGORIAS.join(', ')}`);
  if (typeof p.estado !== 'string' || !PATRON_ESTADO.test(p.estado)) problemas.push('--estado inválido (en mayúsculas, como lo informa WAM: APPROVED, PAUSED…)');
  if (!Number.isInteger(p.variables) || p.variables < 0 || p.variables > 10) problemas.push('--variables tiene que ser un entero de 0 a 10');
  if (uso === 'campana') {
    // La campaña no tiene modo «apagar»: solo se registra lo que el servidor puede enviar.
    if (p.estado !== 'APPROVED') problemas.push('la plantilla de campaña se registra solo APPROVED (para detener una campaña use campana-saliente.mjs pausar)');
    if (p.categoria !== 'UTILITY' && p.categoria !== 'MARKETING') problemas.push('la plantilla de campaña tiene que ser UTILITY o MARKETING');
    if (p.variables !== 0) problemas.push('la plantilla de campaña no lleva variables: --variables 0');
    if (p.cabecera !== 'ninguna') problemas.push('la plantilla de campaña no lleva cabecera: --cabecera ninguna');
    if (p.botones !== 2) problemas.push('la plantilla de campaña lleva exactamente 2 botones de respuesta rápida: --botones 2');
    return problemas;
  }
  if (p.estado === 'APPROVED') {
    if (p.categoria !== 'UTILITY') problemas.push('una plantilla APPROVED tiene que ser UTILITY (Meta la tomó como otra categoría: el servidor no la enviaría; registre el estado real, no APPROVED)');
    if (p.variables !== 1) problemas.push('Retomar usa exactamente UNA variable (el nombre del comercio): --variables 1');
  }
  return problemas;
}

/**
 * El contrato de la plantilla de CAMPAÑA, puro y exacto (todo `===`): lo que el envío de la campaña exige antes de crear un
 * mensaje. `registradaEn` no cuenta.
 */
export function plantillaCampanaValida(p) {
  return typeof p === 'object' && p !== null
    && typeof p.nombre === 'string' && PATRON_NOMBRE.test(p.nombre)
    && typeof p.idioma === 'string' && PATRON_IDIOMA.test(p.idioma)
    && (p.categoria === 'UTILITY' || p.categoria === 'MARKETING') && p.estado === 'APPROVED'
    && p.variables === 0 && p.cabecera === 'ninguna' && p.botones === 2;
}

// ===========================================================================
// ARGUMENTOS (puro)
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
      problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40).replace(/[^\w-]/g, '?')}`);
    }
  }
  const aplicar = banderas.includes('aplicar');
  const { proyecto, numero, uso, tenant, linea } = valores;

  if (proyecto === undefined) problemas.push('falta --proyecto');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto !== undefined && !proy.ok) problemas.push(proy.motivo);

  // DP4: el número se da entero (--numero) o se resuelve desde rutasWhatsApp con --tenant + --linea <4 últimos dígitos>. Nunca las dos.
  const porLinea = tenant !== undefined || linea !== undefined;
  if (porLinea) {
    if (numero !== undefined) problemas.push('use --numero o --tenant con --linea, no ambos');
    if (tenant === undefined) problemas.push('--linea exige --tenant');
    else if (!ID_TENANT.test(tenant)) problemas.push('--tenant inválido');
    if (linea === undefined) problemas.push('--tenant exige --linea <4 últimos dígitos>');
    else if (!PATRON_LINEA.test(linea)) problemas.push('--linea tiene que ser de exactamente 4 dígitos');
  } else if (numero === undefined) problemas.push('falta --numero (o --tenant con --linea)');
  else if (!PATRON_NUMERO.test(numero)) problemas.push('--numero inválido (el phoneNumberId: solo dígitos)');
  if (uso === undefined) problemas.push('falta --uso');
  else if (!USOS.includes(uso)) problemas.push(`--uso tiene que ser uno de: ${USOS.join(', ')}`);
  for (const k of ['nombre', 'idioma', 'categoria', 'estado']) if (!(k in valores)) problemas.push(`falta --${k}`);

  const esCampana = uso === 'campana';
  if (!esCampana && ('cabecera' in valores || 'botones' in valores)) problemas.push('--cabecera y --botones solo valen con --uso campana');
  let variables = esCampana ? 0 : 1;
  if ('variables' in valores) {
    if (!/^[0-9]{1,2}$/.test(valores['variables'])) problemas.push('--variables tiene que ser un entero de 0 a 10');
    else variables = Number(valores['variables']);
  }
  const plantilla = { nombre: valores['nombre'], idioma: valores['idioma'], categoria: valores['categoria'], estado: valores['estado'], variables };
  if (esCampana) {
    // La cabecera y los botones se informan siempre: lo que WAM no declara no se da por bueno.
    if (!('cabecera' in valores)) problemas.push('falta --cabecera (ninguna, imagen, video, documento, texto o ubicacion)');
    else if (!CABECERAS.includes(valores['cabecera'])) problemas.push(`--cabecera tiene que ser una de ${CABECERAS.join(', ')}`);
    else plantilla.cabecera = valores['cabecera'];
    if (!('botones' in valores)) problemas.push('falta --botones (cuántos botones de respuesta rápida lleva)');
    else if (!/^[0-9]{1,2}$/.test(valores['botones'])) problemas.push('--botones tiene que ser un entero');
    else plantilla.botones = Number(valores['botones']);
  }
  if (['nombre', 'idioma', 'categoria', 'estado'].every((k) => k in valores)) problemas.push(...problemasDeLaPlantilla(plantilla, uso));

  const confirmo = valores['confirmo-produccion'];
  if (confirmo !== undefined) {
    if (!aplicar) problemas.push('--confirmo-produccion solo acompaña a --aplicar');
    else if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (confirmo !== (porLinea ? linea : numero)) problemas.push(porLinea ? '--confirmo-produccion no coincide con --linea' : '--confirmo-produccion no coincide con --numero (escriba el phoneNumberId)');
  } else if (aplicar && proy.ok && proy.entorno === 'produccion') {
    problemas.push(porLinea ? 'contra producción, --aplicar exige --confirmo-produccion <linea> (igual a --linea)' : 'contra producción, --aplicar exige --confirmo-produccion <phoneNumberId> (igual a --numero)');
  }

  const { respaldo } = valores;
  if (aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta> (por omisión no hay respaldo)');
  let respaldoReal = null;
  let respaldoResuelto = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: false, permitirExistente: true });
    if (r.ok) { respaldoReal = respaldo; respaldoResuelto = r.real; } else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, numero: numero ?? null, tenant: tenant ?? null, linea: linea ?? null, uso, plantilla, aplicar, respaldo: respaldoReal, respaldoResuelto } };
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================
const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';
const CLAVES = ['nombre', 'idioma', 'categoria', 'estado', 'variables', 'cabecera', 'botones'];
// `cabecera` y `botones` solo existen en la plantilla de campaña; en la de Retomar ambos son `undefined` a los dos lados.
const igual = (a, b) => typeof a === 'object' && a !== null && CLAVES.every((k) => a[k] === b[k]);
const linea = (p) => (p ? `${p.nombre} · ${p.idioma} · ${p.categoria} · ${p.estado} · ${p.variables} variable(s)${p.botones === undefined ? '' : ` · cabecera ${p.cabecera} · ${p.botones} botón(es)`}` : 'AUSENTE');

const iso = (t) => (t && typeof t.toDate === 'function' ? t.toDate().toISOString() : null);
/** Solo lo que importa de un registro (sin `registradaEn`), para el respaldo y la auditoría. */
const resumen = (p) => (typeof p === 'object' && p !== null
  ? { nombre: p.nombre ?? null, idioma: p.idioma ?? null, categoria: p.categoria ?? null, estado: p.estado ?? null, variables: p.variables ?? null,
    ...(p.botones !== undefined || p.cabecera !== undefined ? { cabecera: p.cabecera ?? null, botones: p.botones ?? null } : {}) } : null);

/**
 * LA ÚNICA ESCRITURA DEL ARCHIVO: UN lote atómico con (1) `update` de solo `plantillas.<uso>` con la precondición de la hora
 * leída y (2) UN documento de auditoría en `tenants/{tenantId}/auditoria`. Sin teléfono completo ni proyecto.
 */
async function escribir(db, ref, tenantId, cfg, anterior, ultimaActualizacion, FieldValue) {
  const lote = db.batch();
  lote.update(ref, { [`plantillas.${cfg.uso}`]: { ...cfg.plantilla, registradaEn: FieldValue.serverTimestamp() } }, { lastUpdateTime: ultimaActualizacion });
  lote.create(db.collection(`tenants/${tenantId}/auditoria`).doc(), {
    accion: 'plantilla_registrada', uid: 'script', script: 'registrar-plantilla', en: FieldValue.serverTimestamp(), origen: 'script',
    uso: cfg.uso, numero: cola(cfg.numero), anterior: resumen(anterior), nuevo: resumen(cfg.plantilla), entorno: cfg.entorno,
  });
  await lote.commit();
}

/** `deps`: `{ db, FieldValue, log, env }`. Devuelve el código de salida. */
export async function ejecutar(cfgEntrada, deps) {
  const { db, FieldValue } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  let cfg = cfgEntrada;
  if (cfg.numero === null || cfg.numero === undefined) {
    // DP4: la ruta del comercio con esa terminación, activa y única. Nunca se pasa un id; nunca se imprime el número.
    const q = await db.collection('rutasWhatsApp').where('tenantId', '==', cfg.tenant).where('estado', '==', 'activo').get();
    const coinciden = q.docs.filter((d) => d.id.endsWith(cfg.linea));
    if (coinciden.length !== 1) {
      log(`\n  ✗ Con --tenant y --linea se esperaba exactamente 1 ruta activa y hay ${coinciden.length}. No se escribió nada.\n`);
      return 2;
    }
    cfg = { ...cfg, numero: coinciden[0].id };
  }
  const ref = db.doc(`rutasWhatsApp/${cfg.numero}`);
  const snap = await ref.get();
  const rotulo = `${cfg.entorno} · número ${cola(cfg.numero)} · uso ${cfg.uso}`;
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
  if (!snap.exists) { log('  ✗ No existe la ruta de ese número (nunca se crea aquí; se asigna con asignar-numero). No se escribió nada.\n'); return 2; }
  const tenantId = snap.get('tenantId');
  if (typeof tenantId !== 'string' || !ID_TENANT.test(tenantId)) { log('  ✗ La ruta no tiene un tenantId válido: no hay comercio al cual auditar. No se escribió nada.\n'); return 2; }
  log(`  comercio : ${tenantId}`);
  if (esTenantExcluidoDeBandera(tenantId, deps.env)) { log('\n  ✗ Ese comercio está EXCLUIDO (NOVUCHAT_TENANTS_EXCLUIDOS): no se escribe su plantilla. No se escribió nada.\n'); return 2; }
  const fichaComercio = await db.doc(`tenants/${tenantId}`).get();
  if (fichaComercio.exists && nombreExcluidoDeBandera(fichaComercio.get('nombre'), deps.env)) {
    log('\n  ✗ El nombre de la ficha de ese comercio corresponde a uno EXCLUIDO: no se toca. No se escribió nada.\n');
    return 2;
  }
  const hoy = snap.get(`plantillas.${cfg.uso}`);
  log(`  hoy      : ${linea(hoy)}`);
  log(`  después  : ${linea(cfg.plantilla)}`);
  if (cfg.uso === 'retomar' && cfg.plantilla.estado !== 'APPROVED') {
    log('\n  AVISO: el estado no es APPROVED, así que el servidor dejará de enviar esta plantilla. Registrarlo NO apaga la bandera del comercio: '
      + 'apagar personaPuedeRetomar es un paso aparte (aplicar-persona-puede-retomar.mjs --valor false).');
  }
  if (igual(hoy, cfg.plantilla)) { log('\n  ✓ Ya está registrada así: nada que hacer.\n'); return 0; }
  if (hoy !== undefined && (typeof hoy !== 'object' || hoy === null)) {
    log('\n  ✗ Lo que hay hoy en ese lugar no es un registro (no es un mapa): no se pisa. No se escribió nada.\n');
    return 2;
  }
  const otro = snap.get('plantillas');
  if (otro !== undefined && (typeof otro !== 'object' || otro === null || Array.isArray(otro))) {
    log('\n  ✗ «plantillas» de la ruta no es un mapa: no se pisa. No se escribió nada.\n');
    return 2;
  }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar --respaldo <ruta> (y --confirmo-produccion <phoneNumberId>) para escribir.\n'); return 1; }
  try {
    guardarRespaldo(cfg.respaldo, {
      version: 1, campo: `plantillas.${cfg.uso}`, entorno: cfg.entorno, tenant: tenantId, numero: cola(cfg.numero), creadoEn: new Date().toISOString(),
      rutaActualizadaEn: iso(snap.updateTime), previo: { presente: hoy !== undefined, valor: resumen(hoy) }, escrito: resumen(cfg.plantilla),
    });
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa; elija otro nombre. No se escribió nada.\n'); return 2; }
    throw e;
  }
  if (!rutaDelRespaldoSigueIgual(cfg, deps.comprobarRespaldo)) { log('\n  ✗ La ruta del respaldo cambió durante la corrida. No se escribió nada.\n'); return 2; }
  log(`\n  Respaldo guardado: ${cfg.respaldo}`);
  try {
    await escribir(db, ref, tenantId, cfg, hoy, snap.updateTime, FieldValue);
  } catch (e) {
    if (esPrecondicion(e)) { log('\n  ✗ La ruta cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr (con OTRA ruta de --respaldo: la anterior ya existe).\n'); return 3; }
    throw e;
  }
  const despues = (await ref.get()).get(`plantillas.${cfg.uso}`);
  if (!igual(despues, cfg.plantilla)) { log('\n  ✗ La relectura no coincide con lo escrito. Revise la ruta con el seco.\n'); return 3; }
  log(`\n  ✓ Escrito y releído: ${linea(despues)}.`);
  if (cfg.uso === 'campana') {
    log(plantillaCampanaValida(despues)
      ? '  Cumple el contrato de la campaña: el envío puede usarla (campana-saliente.mjs).\n'
      : '  NO cumple el contrato de la campaña: el envío no la usará.\n');
    return 0;
  }
  log(plantillaRetomarValida(despues)
    ? '  Cumple C1: el servidor puede enviarla. Falta encender la bandera (aplicar-persona-puede-retomar.mjs).\n'
    : '  NO cumple C1 (no es APPROVED/UTILITY/1 variable): el servidor no la enviará. La bandera del comercio sigue como estaba: apáguela aparte con aplicar-persona-puede-retomar.mjs --valor false.\n');
  return 0;
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
  const codigo = await ejecutar(cfg, { db, FieldValue, env: process.env });
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
    process.exit(3);
  }
}
