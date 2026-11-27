/**
 * CAMPAÑA SALIENTE DEL CHAT DE NOVUCHAT — el envío (módulo `campanas` v2, PR-C, 26/11/2026).
 *
 *   node scripts/modulos/campanas/campana-saliente.mjs <subcomando> --proyecto <id> --tenant <id> [opciones]
 *
 *   simular       --workflow <id>                       SOLO conteos (nada de teléfonos); no escribe en Firestore.
 *   crear         --workflow <id> --numero <n> --campana <id> [--aplicar --confirmo-produccion <tenant>]
 *                 arma la lista y crea `campanasSalientes/{id}` con sus `destinatarios` (no envía nada).
 *   prueba        --numero <n> --campana <id> [--aplicar ...]   solo a TELEFONOS_DE_PRUEBA del entorno (sin él, sale con 2).
 *   enviar-tanda  --campana <id> --calidad VERDE [--tamano 40..50] [--aplicar ...]
 *   pausar        --campana <id> [--aplicar ...]
 *   estado        --campana <id>                        conteos, respuestas conciliadas y `plantillasCampana`; solo lectura.
 *
 * SIN `--aplicar --confirmo-produccion <tenant>` (la confirmación, solo contra producción) NO SE ESCRIBE NADA. El proyecto se valida
 * contra la lista blanca de los demás scripts (`comprobarProyecto`). El tenant es UNO por corrida.
 *
 * CÓMO SALE UN MENSAJE. Se copia el contrato de `retomarConversacion`: un mensaje `pendiente` de tipo `plantilla` con `autor: 'campana'`,
 * `plantilla {nombre, idioma, parametros: [], botones: [{indice, payload}]}` en `tenants/{t}/conversaciones/wa_<tel>/mensajes/camp_<campana>_<tel>`.
 * Lo envía el flujo «Salida de persona» (su barrido corre cada 15 s: este script NO toca el timbre) y lo confirma `confirmarSalidaPersona`,
 * que suma `plantillasCampana`. Cada mensaje se crea en UNA transacción que vuelve a comprobar: baja, bloqueada, noContactar, las 24 h,
 * que la conversación exista (y sea de esa línea), que la campaña no esté pausada y el tope diario (`topesDeEnvio/c_{tenant}`, 200).
 * Se escribe en sub-lotes de 10 y se espera a que salgan de `pendiente` antes del siguiente (ninguno caduca por los 2 min del reclamo).
 *
 * EL NOMBRE DE LA PLANTILLA es dato del número (`rutasWhatsApp/{n}.plantillas.campana`, `registrar-plantilla.mjs --uso campana`): nunca va aquí.
 * `CAMPANA_ID` y los payloads repiten a Core; `salientes.test.ts` los compara contra sus exports.
 *
 * SALIDA. 0: hecho (o seco sin diferencias). 1: seco, queda algo por aplicar. 2: uso, salvaguarda o precondición (nada escrito).
 * 3: error de ejecución. 4: la campaña se pausó o la tanda se rechazó por el 25 % de «No». 130: Ctrl-C.
 * COSTO. Por entrega, 1 plantilla (cifra en Central). 0 mensajes por conversación de los flujos. Escrituras: crear ≈ 1 + una por destinatario;
 * cada envío ≈ 4 (mensaje, destinatario, tope, y la actualización del estado final).
 */
import { realpathSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comprobarProyecto, ID_TENANT, esTenantExcluidoDeBandera, mensajeDeInterrupcion } from '../../plataforma/aplicar-consola-conversaciones.mjs';
import { plantillaCampanaValida } from '../../plataforma/registrar-plantilla.mjs';
import { crearLectorDeMiniCrmN8n } from './miniCrm-n8n.mjs';
import {
  TAMANO_DE_SUBLOTE, TANDA_MAXIMA, TANDA_MINIMA, TOPE_DIARIO, armarLista, evaluarPausa, milisegundosDe, partirEnLotes, telefonoValido,
} from './salientes-logica.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const SUBCOMANDOS = ['simular', 'crear', 'prueba', 'enviar-tanda', 'pausar', 'estado'];
const ESCRIBEN = ['crear', 'prueba', 'enviar-tanda', 'pausar'];
const CON_VALOR = ['proyecto', 'tenant', 'numero', 'campana', 'calidad', 'tamano', 'workflow', 'confirmo-produccion'];
const BANDERAS = ['aplicar'];
/** Repetido de Core (`bajas.ts`: CAMPANA_ID) y de `PAYLOAD_DE_BOTON`: la prueba los compara. */
export const CAMPANA_ID = /^[a-z0-9-]{3,40}$/;
export const NUMERO_ID = /^[0-9]{6,25}$/;
export const payloadsDe = (campanaId) => ({ si: `cs:si:${campanaId}`, no: `cs:no:${campanaId}` });
/** El id del mensaje: cumple `CLAVE_DE_ENVIO` de Core (16 a 128 caracteres). */
export const claveDeMensaje = (campanaId, telefono) => `camp_${campanaId}_${telefono}`;
export const ESPERA_SUBLOTE_MS = 180_000;
const SONDEO_MS = 3_000;

export const USO = '  node scripts/modulos/campanas/campana-saliente.mjs simular|crear|prueba|enviar-tanda|pausar|estado --proyecto <id> --tenant <id> '
  + '[--workflow <id>] [--numero <phoneNumberId>] [--campana <id>] [--calidad VERDE] [--tamano 40..50] [--aplicar --confirmo-produccion <tenant>]';

// ===========================================================================
// ARGUMENTOS (puro)
// ===========================================================================
export function analizarArgumentos(argv, env = process.env) {
  const problemas = [];
  const sub = argv[0];
  if (!SUBCOMANDOS.includes(sub)) return { ok: false, problemas: [`el subcomando tiene que ser uno de: ${SUBCOMANDOS.join(', ')}`] };
  const valores = { __proto__: null };
  const banderas = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string' || !a.startsWith('--')) { problemas.push('argumento suelto (sin su opción)'); continue; }
    const nombre = a.slice(2);
    if (BANDERAS.includes(nombre)) {
      if (banderas.includes(nombre)) problemas.push(`opción repetida: --${nombre}`);
      banderas.push(nombre);
    } else if (CON_VALOR.includes(nombre)) {
      if (nombre in valores) problemas.push(`opción repetida: --${nombre}`);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) { problemas.push(`--${nombre} sin valor`); continue; }
      valores[nombre] = v; i += 1;
    } else problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40)}`);
  }
  const escribe = ESCRIBEN.includes(sub);
  const aplicar = banderas.includes('aplicar');
  if (aplicar && !escribe) problemas.push(`${sub} no escribe: no admite --aplicar`);
  const { proyecto, tenant, numero, campana, calidad, tamano, workflow } = valores;
  const confirmo = valores['confirmo-produccion'];

  if (proyecto === undefined) problemas.push('falta --proyecto');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto !== undefined && !proy.ok) problemas.push(proy.motivo);
  if (tenant === undefined) problemas.push('falta --tenant');
  else if (!ID_TENANT.test(tenant)) problemas.push('--tenant inválido (UN comercio por corrida)');
  else if (esTenantExcluidoDeBandera(tenant, env)) problemas.push('este comercio está EXCLUIDO (NOVUCHAT_TENANTS_EXCLUIDOS)');
  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) problemas.push('contra producción, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');

  if (sub !== 'simular') {
    if (campana === undefined) problemas.push('falta --campana');
    else if (!CAMPANA_ID.test(campana)) problemas.push('--campana inválida (minúsculas, dígitos y guiones, de 3 a 40)');
  }
  if (['crear', 'prueba'].includes(sub)) {
    if (numero === undefined) problemas.push('falta --numero');
    else if (!NUMERO_ID.test(numero)) problemas.push('--numero inválido');
  } else if (numero !== undefined && sub !== 'simular') problemas.push(`${sub} no admite --numero (sale de la campaña)`);
  if (['simular', 'crear'].includes(sub)) {
    const permitidos = typeof env.N8N_WORKFLOWS_PERMITIDOS === 'string' ? env.N8N_WORKFLOWS_PERMITIDOS.split(',').map((x) => x.trim()).filter(Boolean) : [];
    if (workflow === undefined) problemas.push('falta --workflow (el flujo vivo del chat, de donde sale la hoja del miniCRM)');
    else if (!permitidos.includes(workflow)) problemas.push('--workflow no está en la lista cerrada N8N_WORKFLOWS_PERMITIDOS');
  } else if (workflow !== undefined) problemas.push(`${sub} no admite --workflow`);
  if (sub === 'enviar-tanda') {
    if (calidad !== 'VERDE') problemas.push('enviar-tanda exige --calidad VERDE (la informa WAM antes de cada tanda; sin ella no se envía)');
  } else if (calidad !== undefined) problemas.push(`${sub} no admite --calidad`);
  let tamanoTanda = TANDA_MAXIMA;
  if (tamano !== undefined) {
    if (sub !== 'enviar-tanda') problemas.push(`${sub} no admite --tamano`);
    else if (!/^[0-9]{2}$/.test(tamano) || Number(tamano) < TANDA_MINIMA || Number(tamano) > TANDA_MAXIMA) problemas.push(`--tamano va de ${TANDA_MINIMA} a ${TANDA_MAXIMA}`);
    else tamanoTanda = Number(tamano);
  }
  const telefonosDePrueba = telefonosDePruebaDe(env);
  if (sub === 'prueba' && telefonosDePrueba.size === 0) return { ok: false, codigo: 2, problemas: [...problemas, 'prueba exige TELEFONOS_DE_PRUEBA en el entorno (teléfonos válidos separados por coma)'] };
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { sub, proyecto, entorno: proy.entorno, tenant, numero: numero ?? null, campana: campana ?? null, workflow: workflow ?? null, tamano: tamanoTanda, aplicar, telefonosDePrueba } };
}

/** Los teléfonos de prueba del entorno (solo los válidos); nunca se imprimen. */
export function telefonosDePruebaDe(env) {
  const lista = typeof env.TELEFONOS_DE_PRUEBA === 'string' ? env.TELEFONOS_DE_PRUEBA.split(',').map((x) => telefonoValido(x.trim())).filter(Boolean) : [];
  return new Set(lista);
}

// ===========================================================================
// EL MENSAJE Y SU TRANSACCIÓN
// ===========================================================================
const diaDe = (ms) => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);
const HORA_MS = 3_600_000;

/** El documento del mensaje: el contrato de `retomarConversacion`, con `autor: 'campana'`, sin parámetros y con 2 botones. */
export function documentoDelMensaje({ campanaId, telefono, numero, tenant, plantilla, ts }) {
  const p = payloadsDe(campanaId);
  return {
    direccion: 'saliente', tipo: 'plantilla', texto: '', ts, autor: 'campana', estadoEnvio: 'pendiente',
    to: telefono, phoneNumberId: numero, tenantId: tenant,
    plantilla: { nombre: plantilla.nombre, idioma: plantilla.idioma, parametros: [], botones: [{ indice: 0, payload: p.si }, { indice: 1, payload: p.no }] },
  };
}

/**
 * Crea UN mensaje en UNA transacción que vuelve a comprobar todo. `{ ok: true }` o `{ ok: false, motivo }` (nada escrito).
 * `ctx`: { db, Timestamp, tenant, numero, campanaId, plantilla, ahoraMs, conCampana }.
 */
export async function crearMensaje(ctx, telefono) {
  const { db, Timestamp, tenant, numero, campanaId, plantilla, ahoraMs, conCampana } = ctx;
  const refConv = db.doc(`tenants/${tenant}/conversaciones/wa_${telefono}`);
  const refMsg = refConv.collection('mensajes').doc(claveDeMensaje(campanaId, telefono));
  const refBaja = db.doc(`tenants/${tenant}/bajas/wa_${telefono}`);
  const refTope = db.doc(`topesDeEnvio/c_${tenant}`);
  const refCamp = db.doc(`tenants/${tenant}/campanasSalientes/${campanaId}`);
  const refDest = refCamp.collection('destinatarios').doc(`wa_${telefono}`);
  return db.runTransaction(async (tx) => {
    const [conv, msg, baja, tope, camp, dest] = await tx.getAll(refConv, refMsg, refBaja, refTope, refCamp, refDest);
    if (msg.exists) return { ok: false, motivo: 'repetido' };
    if (conCampana) {
      if (!camp.exists) return { ok: false, motivo: 'sinCampana' };
      if (camp.get('estado') !== 'activa') return { ok: false, motivo: 'pausada' };
      if (!dest.exists || dest.get('estado') !== 'pendiente') return { ok: false, motivo: 'noPendiente' };
    }
    if (!conv.exists) return { ok: false, motivo: 'sinConversacion' };
    const linea = conv.get('phoneNumberId');
    if (linea !== undefined && linea !== numero) return { ok: false, motivo: 'otraLinea' };
    if (baja.exists) return { ok: false, motivo: 'baja' };
    if (conv.get('bloqueada') === true) return { ok: false, motivo: 'bloqueada' };
    if (conv.get('noContactar') === true) return { ok: false, motivo: 'noContactar' };
    const entrante = milisegundosDe(conv.get('ultimoEntranteEn'));
    if (entrante === null) return { ok: false, motivo: 'sinConversacion' };
    if (ahoraMs - entrante < 24 * HORA_MS) return { ok: false, motivo: 'reciente' };
    const dia = diaDe(ahoraMs);
    const n = tope.exists && tope.get('dia') === dia ? tope.get('nDia') : 0;
    if (!Number.isInteger(n) || n < 0) return { ok: false, motivo: 'topeIlegible' };
    if (n >= TOPE_DIARIO) return { ok: false, motivo: 'tope' };
    const ts = Timestamp.fromMillis(ahoraMs);
    tx.create(refMsg, documentoDelMensaje({ campanaId, telefono, numero, tenant, plantilla, ts }));
    tx.set(refTope, { dia, nDia: n + 1, actualizadoEn: ts }, { merge: true });
    if (conCampana) tx.update(refDest, { estado: 'creado', mensajeId: refMsg.id, creadoEn: ts });
    return { ok: true };
  });
}

// ===========================================================================
// LECTURAS
// ===========================================================================
const lotesDe = (refs, n = 300) => partirEnLotes(refs, n);

/** Las conversaciones que EXISTEN (con lo mínimo) y las bajas, de una lista de teléfonos. */
async function leerContexto(db, tenant, telefonos, numero) {
  const conversaciones = new Map();
  const bajas = new Set();
  for (const lote of lotesDe(telefonos)) {
    const snaps = await db.getAll(...lote.map((t) => db.doc(`tenants/${tenant}/conversaciones/wa_${t}`)), { fieldMask: ['ultimoEntranteEn', 'bloqueada', 'noContactar', 'phoneNumberId'] });
    snaps.forEach((s, i) => {
      if (!s.exists) return;
      const linea = s.get('phoneNumberId');
      if (numero && linea !== undefined && linea !== numero) return; // de otra línea: no se le escribe por esta
      conversaciones.set(lote[i], { ultimoEntranteEn: s.get('ultimoEntranteEn'), bloqueada: s.get('bloqueada'), noContactar: s.get('noContactar') });
    });
    const sb = await db.getAll(...lote.map((t) => db.doc(`tenants/${tenant}/bajas/wa_${t}`)), { fieldMask: ['canal'] });
    sb.forEach((s, i) => { if (s.exists) bajas.add(lote[i]); });
  }
  return { conversaciones, bajas };
}

async function construirLista(cfg, deps) {
  const filas = await deps.leerFilasDelMiniCrm();
  const telefonos = [...new Set(filas.map((f) => telefonoValido(String(f.telefono ?? '').trim())).filter(Boolean))];
  const { conversaciones, bajas } = await leerContexto(deps.db, cfg.tenant, telefonos, cfg.numero);
  return armarLista({ filas, conversaciones, bajas, telefonosDePrueba: cfg.telefonosDePrueba, ahoraMs: deps.ahoraMs() });
}

const ROTULOS = {
  filas: 'filas del miniCRM', telefonos: 'teléfonos distintos', filasRepetidas: 'filas repetidas (un solo envío)', invalido: 'excluidos: teléfono inválido',
  cerrada: 'excluidos: Ganado o Perdido', fechaIlegible: 'excluidos: fecha ilegible', prueba: 'excluidos: teléfono de prueba', baja: 'excluidos: con baja',
  bloqueada: 'excluidos: bloqueada', noContactar: 'excluidos: no contactar', fueraDeVentana: 'excluidos: fuera de los 60 días',
  sinConversacion: 'excluidos: sin conversación', reciente: 'excluidos: escribió en las últimas 24 h', destinatarios: 'DESTINATARIOS',
};
function imprimirConteos(log, conteos) { for (const [k, r] of Object.entries(ROTULOS)) log(`  ${r.padEnd(44)} ${conteos[k]}`); }

/** `plantillas.campana` de la ruta, validada por el mismo contrato que `registrar-plantilla.mjs`. */
async function leerPlantilla(db, tenant, numero) {
  const ruta = await db.doc(`rutasWhatsApp/${numero}`).get();
  if (!ruta.exists || ruta.get('tenantId') !== tenant || ruta.get('estado') !== 'activo') return { ok: false, motivo: 'la ruta no existe, no es de este comercio o no está activa' };
  const p = ruta.get('plantillas.campana');
  if (!plantillaCampanaValida(p)) return { ok: false, motivo: 'la ruta no tiene una plantilla de campaña válida (registrar-plantilla.mjs --uso campana)' };
  return { ok: true, plantilla: { nombre: p.nombre, idioma: p.idioma } };
}

/** Respuestas conciliadas desde `campanaRespuesta` de las conversaciones. */
export async function conciliarRespuestas(db, tenant, campanaId) {
  const snap = await db.collection(`tenants/${tenant}/conversaciones`).where('campanaRespuesta.campanaId', '==', campanaId).select('campanaRespuesta.respuesta').get();
  let si = 0; let no = 0;
  for (const d of snap.docs) { const r = d.get('campanaRespuesta.respuesta'); if (r === 'si') si += 1; else if (r === 'no') no += 1; }
  return { si, no };
}

// ===========================================================================
// SUBCOMANDOS
// ===========================================================================
const dormirReal = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function crear(cfg, deps, log) {
  const { db, Timestamp } = deps;
  const pl = await leerPlantilla(db, cfg.tenant, cfg.numero);
  if (!pl.ok) { log(`\n  ✗ ${pl.motivo}. No se escribió nada.\n`); return 2; }
  const ref = db.doc(`tenants/${cfg.tenant}/campanasSalientes/${cfg.campana}`);
  if ((await ref.get()).exists) { log('\n  ✗ Ya existe una campaña con ese id: use otro. No se escribió nada.\n'); return 2; }
  const { destinatarios, conteos } = await construirLista(cfg, deps);
  log(`\n  ${cfg.aplicar ? 'CREAR' : 'SECO (solo lecturas)'} · campaña ${cfg.campana}\n`);
  imprimirConteos(log, conteos);
  if (destinatarios.length === 0) { log('\n  ✗ No quedó ningún destinatario: no se crea la campaña.\n'); return 2; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar para crear la campaña.\n'); return 1; }
  deps.marcarEscritura?.('escribiendo');
  const ahora = Timestamp.fromMillis(deps.ahoraMs());
  await ref.create({
    estado: 'activa', phoneNumberId: cfg.numero, plantilla: pl.plantilla, creadaEn: ahora, total: destinatarios.length, conteos,
    enviados: 0, errores: 0, inciertos: 0, omitidos: 0, tandas: 0, respondioSi: 0, respondioNo: 0, ultimaTanda: null,
  });
  for (const lote of partirEnLotes(destinatarios, 400)) {
    const b = db.batch();
    for (const d of lote) b.create(ref.collection('destinatarios').doc(`wa_${d.telefono}`), { estado: 'pendiente', fechaMax: Timestamp.fromMillis(d.fechaMaxMs) });
    await b.commit();
  }
  deps.marcarEscritura?.('escrito');
  log(`\n  ✓ Campaña creada con ${destinatarios.length} destinatarios. Falta enviar-tanda (con --calidad VERDE).\n`);
  return 0;
}

async function simular(cfg, deps, log) {
  const { conteos } = await construirLista(cfg, deps);
  log('\n  SIMULACRO (solo conteos; no escribe en Firestore)\n');
  imprimirConteos(log, conteos);
  log('');
  return 0;
}

/** Espera a que ningún mensaje del sub-lote siga `pendiente` ni `enviando`; devuelve el estado de cada uno. */
async function esperarSubLote(db, refs, deps) {
  const limite = deps.ahoraMs() + (deps.esperaMs ?? ESPERA_SUBLOTE_MS);
  for (;;) {
    const snaps = await db.getAll(...refs);
    const estados = snaps.map((s) => (s.exists ? s.get('estadoEnvio') : 'desaparecido'));
    if (!estados.some((e) => e === 'pendiente' || e === 'enviando') || deps.ahoraMs() >= limite) return estados;
    await (deps.dormir ?? dormirReal)(deps.sondeoMs ?? SONDEO_MS);
  }
}

async function enviarTanda(cfg, deps, log) {
  const { db, Timestamp } = deps;
  const refCamp = db.doc(`tenants/${cfg.tenant}/campanasSalientes/${cfg.campana}`);
  const camp = await refCamp.get();
  if (!camp.exists) { log('\n  ✗ La campaña no existe. No se escribió nada.\n'); return 2; }
  if (camp.get('estado') !== 'activa') { log(`\n  ✗ La campaña está ${camp.get('estado')}: no se envía. No se escribió nada.\n`); return 2; }
  const numero = camp.get('phoneNumberId');
  const pl = await leerPlantilla(db, cfg.tenant, numero);
  if (!pl.ok) { log(`\n  ✗ ${pl.motivo}. No se escribió nada.\n`); return 2; }
  const previa = camp.get('ultimaTanda');
  if (previa) {
    const { no } = await conciliarRespuestas(db, cfg.tenant, cfg.campana);
    const v = evaluarPausa({ enviados: previa.enviados, errores: 0, no: Math.min(no, previa.enviados) });
    if (v.pausar) { log(`\n  ✗ La tanda anterior superó el límite de respuestas «No» (${no} de ${previa.enviados}): la siguiente se rechaza. Revise el mensaje con Andres. No se escribió nada.\n`); return 4; }
  }
  const pendientes = await refCamp.collection('destinatarios').where('estado', '==', 'pendiente').limit(cfg.tamano).get();
  log(`\n  ${cfg.aplicar ? 'ENVIAR TANDA' : 'SECO (solo lecturas)'} · campaña ${cfg.campana} · ${pendientes.size} destinatario(s) en esta tanda (tamaño ${cfg.tamano}, tope diario ${TOPE_DIARIO})`);
  if (pendientes.empty) { log('\n  ✓ No quedan destinatarios pendientes: la campaña terminó.\n'); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se envió nada. Agregue --aplicar con la calidad confirmada por WAM.\n'); return 1; }

  const telefonos = pendientes.docs.map((d) => d.id.slice(3));
  const t = { enviados: 0, errores: 0, inciertos: 0, omitidos: {} };
  let corte = null;
  deps.marcarEscritura?.('escribiendo');
  for (const lote of partirEnLotes(telefonos, TAMANO_DE_SUBLOTE)) {
    const ctx = { db, Timestamp, tenant: cfg.tenant, numero, campanaId: cfg.campana, plantilla: pl.plantilla, ahoraMs: deps.ahoraMs(), conCampana: true };
    const creados = [];
    for (const tel of lote) {
      const r = await crearMensaje({ ...ctx, ahoraMs: deps.ahoraMs() }, tel);
      if (r.ok) { creados.push(tel); continue; }
      t.omitidos[r.motivo] = (t.omitidos[r.motivo] ?? 0) + 1;
      if (r.motivo === 'tope') { corte = 'tope'; break; }
      if (r.motivo === 'pausada' || r.motivo === 'sinCampana') { corte = 'pausada'; break; }
      if (!['repetido', 'noPendiente', 'topeIlegible'].includes(r.motivo)) {
        await db.doc(`tenants/${cfg.tenant}/campanasSalientes/${cfg.campana}/destinatarios/wa_${tel}`).update({ estado: 'omitido', motivo: r.motivo });
      }
    }
    if (creados.length > 0) {
      const refs = creados.map((tel) => db.doc(`tenants/${cfg.tenant}/conversaciones/wa_${tel}/mensajes/${claveDeMensaje(cfg.campana, tel)}`));
      const estados = await esperarSubLote(db, refs, deps);
      let atascado = false;
      const marcas = [];
      estados.forEach((e, i) => {
        t.enviados += 1;
        let final = e;
        if (e === 'rechazado' || e === 'desaparecido') t.errores += 1;
        else if (e === 'incierto' || e === 'enviando') { t.inciertos += 1; final = 'incierto'; }
        else if (e === 'pendiente') { atascado = true; t.errores += 1; }
        marcas.push(db.doc(`tenants/${cfg.tenant}/campanasSalientes/${cfg.campana}/destinatarios/wa_${creados[i]}`).update({ estado: final }));
      });
      await Promise.all(marcas);
      const v = atascado ? { pausar: true, motivo: 'salida' } : evaluarPausa({ enviados: t.enviados, errores: t.errores });
      if (v.pausar) { corte = `pausa:${v.motivo}`; break; }
    }
    if (corte !== null) break;
  }
  const resp = await conciliarRespuestas(db, cfg.tenant, cfg.campana);
  const base = camp.data();
  const cambios = {
    enviados: base.enviados + t.enviados, errores: base.errores + t.errores, inciertos: base.inciertos + t.inciertos,
    omitidos: base.omitidos + Object.values(t.omitidos).reduce((a, b) => a + b, 0), tandas: base.tandas + 1,
    respondioSi: resp.si, respondioNo: resp.no, ultimaTanda: { enviados: t.enviados, errores: t.errores, inciertos: t.inciertos, en: Timestamp.fromMillis(deps.ahoraMs()) },
    ...(corte && corte.startsWith('pausa:') ? { estado: 'pausada', motivoPausa: corte.slice(6), pausadaEn: Timestamp.fromMillis(deps.ahoraMs()) } : {}),
  };
  await refCamp.update(cambios);
  deps.marcarEscritura?.('escrito');
  log(`\n  Tanda: ${t.enviados} enviados · ${t.errores} con error · ${t.inciertos} inciertos · omitidos ${JSON.stringify(t.omitidos)}`);
  log(`  Respuestas hasta ahora: ${resp.si} «Sí» y ${resp.no} «No».`);
  if (corte && corte.startsWith('pausa:')) { log(`\n  ⏸ La campaña SE PAUSÓ (${corte.slice(6)}). Revise antes de continuar.\n`); return 4; }
  if (corte === 'tope') log(`\n  Se llegó al tope diario de ${TOPE_DIARIO}: la tanda se corta; siga mañana (día de La Paz).`);
  if (corte === 'pausada') log('\n  La campaña se pausó mientras corría la tanda: se cortó.');
  log('');
  return 0;
}

async function pausar(cfg, deps, log) {
  const { db, Timestamp } = deps;
  const ref = db.doc(`tenants/${cfg.tenant}/campanasSalientes/${cfg.campana}`);
  const camp = await ref.get();
  if (!camp.exists) { log('\n  ✗ La campaña no existe. No se escribió nada.\n'); return 2; }
  if (camp.get('estado') === 'pausada') { log('\n  ✓ La campaña ya está pausada: nada que hacer.\n'); return 0; }
  if (!cfg.aplicar) { log(`\n  SECO: la campaña está ${camp.get('estado')}. Agregue --aplicar para pausarla.\n`); return 1; }
  deps.marcarEscritura?.('escribiendo');
  await db.runTransaction(async (tx) => {
    const c = await tx.get(ref);
    if (c.get('estado') !== 'pausada') tx.update(ref, { estado: 'pausada', motivoPausa: 'manual', pausadaEn: Timestamp.fromMillis(deps.ahoraMs()) });
  });
  deps.marcarEscritura?.('escrito');
  log('\n  ✓ Campaña pausada. Los mensajes ya creados (hasta 10) salen igual en el siguiente barrido; no se crea ninguno nuevo.\n');
  return 0;
}

async function estado(cfg, deps, log) {
  const { db } = deps;
  const ref = db.doc(`tenants/${cfg.tenant}/campanasSalientes/${cfg.campana}`);
  const camp = await ref.get();
  if (!camp.exists) { log('\n  ✗ La campaña no existe.\n'); return 2; }
  const dest = await ref.collection('destinatarios').select('estado').get();
  const porEstado = {};
  for (const d of dest.docs) { const e = d.get('estado'); porEstado[e] = (porEstado[e] ?? 0) + 1; }
  const resp = await conciliarRespuestas(db, cfg.tenant, cfg.campana);
  const periodo = new Date(deps.ahoraMs()).toISOString().slice(0, 7);
  const metricas = await db.doc(`tenants/${cfg.tenant}/metricas/${periodo}`).get();
  log(`\n  ESTADO · campaña ${cfg.campana} · ${camp.get('estado')}${camp.get('motivoPausa') ? ` (${camp.get('motivoPausa')})` : ''}`);
  log(`  destinatarios: total ${camp.get('total')} · ${JSON.stringify(porEstado)}`);
  log(`  tandas ${camp.get('tandas')} · enviados ${camp.get('enviados')} · errores ${camp.get('errores')} · inciertos ${camp.get('inciertos')} · omitidos ${camp.get('omitidos')}`);
  log(`  respuestas conciliadas: ${resp.si} «Sí» · ${resp.no} «No»`);
  log(`  plantillasCampana del mes (costo; la consola aún no lo lee): ${metricas.get('plantillasCampana') ?? 0}\n`);
  return 0;
}

/** Los teléfonos de prueba: solo a ellos, sin campaña ni lista. */
async function prueba(cfg, deps, log) {
  const { db, Timestamp } = deps;
  const pl = await leerPlantilla(db, cfg.tenant, cfg.numero);
  if (!pl.ok) { log(`\n  ✗ ${pl.motivo}. No se escribió nada.\n`); return 2; }
  const telefonos = [...cfg.telefonosDePrueba];
  log(`\n  ${cfg.aplicar ? 'PRUEBA' : 'SECO (solo lecturas)'} · ${telefonos.length} teléfono(s) de prueba · campaña de prueba ${cfg.campana}`);
  if (!cfg.aplicar) { log('\n  Seco: no se envió nada. Agregue --aplicar.\n'); return 1; }
  deps.marcarEscritura?.('escribiendo');
  const omitidos = {};
  let creados = 0;
  for (const tel of telefonos) {
    const r = await crearMensaje({ db, Timestamp, tenant: cfg.tenant, numero: cfg.numero, campanaId: cfg.campana, plantilla: pl.plantilla, ahoraMs: deps.ahoraMs(), conCampana: false }, tel);
    if (r.ok) creados += 1; else omitidos[r.motivo] = (omitidos[r.motivo] ?? 0) + 1;
  }
  deps.marcarEscritura?.('escrito');
  log(`\n  ✓ ${creados} mensaje(s) creado(s); omitidos ${JSON.stringify(omitidos)}. Salen en el siguiente barrido (≤ 15 s).\n`);
  return 0;
}

/**
 * Corre el subcomando ya validado. `deps`: { db, Timestamp, log, ahoraMs, leerFilasDelMiniCrm, dormir, marcarEscritura, esperaMs, sondeoMs }.
 */
export async function ejecutar(cfg, deps) {
  const log = deps.log ?? ((t) => console.log(t));
  const d = { ahoraMs: () => Date.now(), ...deps };
  switch (cfg.sub) {
    case 'simular': return simular(cfg, d, log);
    case 'crear': return crear(cfg, d, log);
    case 'prueba': return prueba(cfg, d, log);
    case 'enviar-tanda': return enviarTanda(cfg, d, log);
    case 'pausar': return pausar(cfg, d, log);
    case 'estado': return estado(cfg, d, log);
    default: return 2;
  }
}

// ===========================================================================
// PUNTO DE ENTRADA
// ===========================================================================
const corrida = { estado: 'antes' };

async function principal() {
  const analisis = analizarArgumentos(process.argv.slice(2));
  if (!analisis.ok) {
    console.error(`\n  ✗ ${analisis.problemas.join('\n  ✗ ')}\n\n${USO}\n`);
    process.exit(analisis.codigo ?? 2);
  }
  const { cfg } = analisis;
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  process.on('SIGINT', () => { console.error(mensajeDeInterrupcion(corrida.estado)); process.exit(130); });
  let leerFilasDelMiniCrm;
  if (['simular', 'crear'].includes(cfg.sub)) {
    const { N8N_BASE_URL, N8N_API_KEY } = process.env;
    if (!N8N_BASE_URL || !N8N_API_KEY) { console.error('\n  ✗ faltan N8N_BASE_URL o N8N_API_KEY en el entorno\n'); process.exit(2); }
    const crm = JSON.parse(readFileSync(join(AQUI, '..', '..', 'datos', 'chat-novuchat', 'novuchat.json'), 'utf8')).crm;
    leerFilasDelMiniCrm = crearLectorDeMiniCrmN8n({ baseUrl: N8N_BASE_URL, apiKey: N8N_API_KEY, workflowId: cfg.workflow, crm }, { aviso: (t) => console.error(`\n  ⚠ ${t}\n`) });
  }
  const codigo = await ejecutar(cfg, { db, Timestamp, leerFilasDelMiniCrm, marcarEscritura: (v) => { corrida.estado = v; } });
  await db.terminate().catch(() => {});
  process.exit(codigo);
}

function seEjecutaDirecto() {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}
if (seEjecutaDirecto()) {
  try { await principal(); } catch (e) {
    console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`);
    if (corrida.estado !== 'antes') console.error(mensajeDeInterrupcion(corrida.estado, 'Falló con un error'));
    process.exit(3);
  }
}
