/**
 * CAMPAÑA SALIENTE DEL CHAT — el envío (módulo `campanas` v2, PR-C, 27/11/2026).
 *
 *   node scripts/modulos/campanas/campana-saliente.mjs <subcomando> --proyecto <id|prod> --tenant <id> --linea <4 dígitos> [opciones]
 *
 *   simular          --mapa-crm <ruta> --flujo-versionado <ruta>      SOLO conteos (nunca teléfonos); no escribe.
 *   crear            --campana <id> (--mapa-crm … --flujo-versionado … | --solo-prueba --telefono-prueba <4 dígitos>) [--aplicar …]
 *                    arma la lista y crea la campaña (`creada`) con sus destinatarios `pendiente`. NO envía nada.
 *   autorizar-tanda  --campana <id> --tanda <id> --cupo <n> --calidad VERDE [--aplicar …]   UNA tanda por corrida (un botón de Andres).
 *   cerrar-tanda     --campana <id> --tanda <id> [--aplicar …]
 *   pausar           --campana <id> [--aplicar …]
 *   reanudar         --campana <id> [--aplicar …]           una campaña PAUSADA (manual, por errores o por «No»): muestra por qué se pausó y las cifras,
 *                    la deja sin pausa y quita el puntero, y deja la auditoría. NO autoriza ninguna tanda: la siguiente sigue pidiendo `autorizar-tanda`
 *                    (si había una tanda abierta, antes `cerrar-tanda`). No reanuda una campaña terminada ni cancelada.
 *   estado           --campana <id>                         conteos, «Sí» y «No» conciliados y `plantillasCampana`; solo lectura.
 *
 * QUÉ HACE Y QUÉ NO. Este script NO escribe mensajes. Escribe destinatarios en `tenants/{t}/campanasSalientes/{c}/destinatarios` y
 * AUTORIZA una tanda (la tanda en la campaña y el puntero `rutasWhatsApp/{n}.campanaSalienteEnCurso`). Quien arma y envía los
 * mensajes, con los topes, es el servidor (Core): en cada reclamo de la cola de salida, después de las personas y con los lugares
 * que queden, materializa como máximo `porReclamo` mensajes. Sin tanda autorizada no sale nada.
 *
 * LAS CIFRAS (porTanda, porDia, porReclamo, ventanaDias, pausaErroresPct, pausaMinimoEnviados, pausaNoPct) se leen de
 * `tenants/{t}/config/campanaSaliente` con `leerConfigCampana` (la misma validación del servidor); aquí no hay ninguna.
 *
 * `--proyecto prod` toma el id de las credenciales de gcloud (como `respuesta-libre.mjs`) y nunca lo imprime.
 *
 * SIN `--aplicar` NO SE ESCRIBE NADA. Contra producción, `--aplicar` exige `--confirmo-produccion <tenant>` (el id del COMERCIO, igual a
 * `--tenant`; en `registrar-plantilla.mjs` esa misma opción es OTRA cosa: la línea de 4 dígitos o el `phoneNumberId`). Nada se ejecuta contra
 * n8n sin que el subcomando lo pida (solo `simular` y `crear` sin `--solo-prueba` leen el miniCRM, por la API de n8n).
 * La salida nunca trae un teléfono, un id de hoja, una ruta de webhook ni un id de flujo.
 *
 * ENTORNO: `ENV_FILE` (el .env de n8n; se lee, nunca se imprime) y `TELEFONOS_DE_PRUEBA` (separados por coma; nunca se imprimen).
 * La línea (`--linea`) se resuelve en `rutasWhatsApp` (`tenantId == tenant`, `estado == 'activo'`, exactamente 1 coincidencia).
 *
 * SALIDA. 0: terminó. 1: en seco, queda algo por hacer. 2: uso, salvaguarda o precondición (nada escrito). 3: error de ejecución.
 * 4: rechazado por la proporción de «No». 130: Ctrl-C.
 * COSTO. Por entrega 1 plantilla (UTILITY: 0,0113 USD). 0 mensajes por conversación. Escrituras: crear ≈ 1 + una por destinatario;
 * autorizar, cerrar y reanudar, 2 cada una; n8n: 4 por `simular` o `crear`.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comprobarProyecto, ID_TENANT, esTenantExcluidoDeBandera, mensajeDeInterrupcion } from '../../plataforma/aplicar-consola-conversaciones.mjs';
import { plantillaCampanaValida } from '../../plataforma/registrar-plantilla.mjs';
import { entornoDeCredenciales, proyectoDesdeCredenciales } from '../../plataforma/respuesta-libre.mjs';
import { crearLectorDeMiniCrmN8n } from './miniCrm-n8n.mjs';
import {
  armarLista, claveDeContacto, partirEnLotes, partirEnTandas, superaNo, telefonoValido,
} from './salientes-logica.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DATOS = resolve(AQUI, '..', '..', 'datos');
const FLUJOS_CLIENTES = resolve(AQUI, '..', '..', '..', '..', 'Flujos', 'clientes');

export const SUBCOMANDOS = ['simular', 'crear', 'autorizar-tanda', 'cerrar-tanda', 'pausar', 'reanudar', 'estado'];
const ESCRIBEN = ['crear', 'autorizar-tanda', 'cerrar-tanda', 'pausar', 'reanudar'];
const CON_VALOR = ['proyecto', 'tenant', 'linea', 'campana', 'tanda', 'cupo', 'calidad', 'mapa-crm', 'flujo-versionado', 'telefono-prueba', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'solo-prueba'];
/** Copias de Core (`salidaCampana.ts`): `salientes.test.ts` las compara contra lo compilado cuando existe. */
export const CAMPANA_ID = /^[a-z0-9-]{3,40}$/;
export const TANDA_ID = /^[a-z0-9-]{1,20}$/;
/** Costo de una plantilla UTILITY entregada (USD), de `docs/base-comercial.md`. */
export const PLANTILLA_UTILIDAD_USD = 0.0113;
const TAMANO_DE_LOTE = 400;

export const USO = '  node scripts/modulos/campanas/campana-saliente.mjs simular|crear|autorizar-tanda|cerrar-tanda|pausar|reanudar|estado --proyecto <id|prod> --tenant <id> --linea <4 dígitos> '
  + '[--campana <id>] [--tanda <id> --cupo <n> --calidad VERDE] [--mapa-crm <ruta> --flujo-versionado <ruta>] [--solo-prueba --telefono-prueba <4 dígitos>] [--aplicar --confirmo-produccion <tenant>]\n  (--confirmo-produccion es el id del COMERCIO, igual a --tenant; en registrar-plantilla.mjs es la línea de 4 dígitos o el phoneNumberId)';

// ===========================================================================
// ARGUMENTOS (puro)
// ===========================================================================
/** Los teléfonos de prueba del entorno (solo los válidos); nunca se imprimen. */
export function telefonosDePruebaDe(env) {
  const lista = typeof env.TELEFONOS_DE_PRUEBA === 'string' ? env.TELEFONOS_DE_PRUEBA.split(',').map((x) => telefonoValido(x.trim())).filter(Boolean) : [];
  return new Set(lista);
}

/** La ruta absoluta de `ruta` si cae DENTRO de `base` y termina en .json; si no, `null`. */
export function rutaBajo(ruta, base) {
  if (typeof ruta !== 'string' || ruta === '' || ruta.includes('\u0000')) return null;
  const r = resolve(ruta);
  return r.startsWith(base + sep) && r.endsWith('.json') ? r : null;
}

export function analizarArgumentos(argv, env = process.env) {
  const problemas = [];
  const sub = argv[0];
  if (!SUBCOMANDOS.includes(sub)) return { ok: false, codigo: 2, problemas: [`el subcomando tiene que ser uno de: ${SUBCOMANDOS.join(', ')}`] };
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
    } else problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40).replace(/[^\w-]/g, '?')}`);
  }
  const aplicar = banderas.includes('aplicar');
  const soloPrueba = banderas.includes('solo-prueba');
  if (aplicar && !ESCRIBEN.includes(sub)) problemas.push(`${sub} no escribe: no admite --aplicar`);
  if (soloPrueba && sub !== 'crear') problemas.push('--solo-prueba solo vale con crear');
  const { proyecto, tenant, linea, campana, tanda, cupo, calidad } = valores;
  const confirmo = valores['confirmo-produccion'];

  if (proyecto === undefined) problemas.push('falta --proyecto');
  let proy = { ok: false };
  let dirCredenciales = null;
  let proyectoReal = proyecto;
  if (proyecto === 'prod') {
    const c = proyectoDesdeCredenciales(env);
    if (!c.ok) problemas.push(c.motivo);
    else {
      proyectoReal = c.id; dirCredenciales = c.dir;
      proy = comprobarProyecto(c.id, c.env);
      if (!proy.ok) problemas.push(proy.motivo);
    }
  } else if (proyecto !== undefined) {
    proy = comprobarProyecto(proyecto, env);
    if (!proy.ok) problemas.push(proy.motivo);
  }
  if (tenant === undefined) problemas.push('falta --tenant');
  else if (!ID_TENANT.test(tenant)) problemas.push('--tenant inválido (UN comercio por corrida)');
  else if (esTenantExcluidoDeBandera(tenant, env)) problemas.push('este comercio está EXCLUIDO (NOVUCHAT_TENANTS_EXCLUIDOS)');
  if (linea === undefined) problemas.push('falta --linea (los 4 últimos dígitos del número del comercio)');
  else if (!/^[0-9]{4}$/.test(linea)) problemas.push('--linea tiene que ser de exactamente 4 dígitos');
  if (confirmo !== undefined) {
    if (!aplicar) problemas.push('--confirmo-produccion solo acompaña a --aplicar');
    else if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) problemas.push('contra producción, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');

  if (sub !== 'simular') {
    if (campana === undefined) problemas.push('falta --campana');
    else if (!CAMPANA_ID.test(campana)) problemas.push('--campana inválida (minúsculas, dígitos y guiones, de 3 a 40)');
  } else if (campana !== undefined) problemas.push('simular no admite --campana');

  // La tanda: un botón por tanda. Sin tanda, cupo y calidad no se autoriza nada.
  if (sub === 'autorizar-tanda') {
    if (tanda === undefined) problemas.push('falta --tanda'); else if (!TANDA_ID.test(tanda)) problemas.push('--tanda inválida (minúsculas, dígitos y guiones, hasta 20)');
    if (cupo === undefined) problemas.push('falta --cupo'); else if (!/^[0-9]{1,4}$/.test(cupo) || Number(cupo) < 1) problemas.push('--cupo tiene que ser un entero positivo');
    if (calidad === undefined) problemas.push('falta --calidad (la informa WAM antes de cada tanda)');
    else if (calidad !== 'VERDE') problemas.push('autorizar-tanda exige --calidad VERDE (sin ella no se autoriza)');
  } else if (sub === 'cerrar-tanda') {
    if (tanda === undefined) problemas.push('falta --tanda'); else if (!TANDA_ID.test(tanda)) problemas.push('--tanda inválida');
    if (cupo !== undefined) problemas.push(`${sub} no admite --cupo`);
    if (calidad !== undefined) problemas.push(`${sub} no admite --calidad`);
  } else {
    for (const [k, v] of [['tanda', tanda], ['cupo', cupo], ['calidad', calidad]]) if (v !== undefined) problemas.push(`${sub} no admite --${k}`);
  }

  // La lista: del miniCRM (mapa de columnas y flujo versionado, solo bajo sus carpetas) o, con --solo-prueba, de UN teléfono de prueba.
  const conMiniCrm = sub === 'simular' || (sub === 'crear' && !soloPrueba);
  let mapaCrm = null; let flujoVersionado = null;
  if (conMiniCrm) {
    mapaCrm = rutaBajo(valores['mapa-crm'], DATOS);
    if (valores['mapa-crm'] === undefined) problemas.push('falta --mapa-crm'); else if (mapaCrm === null) problemas.push('--mapa-crm tiene que ser un .json bajo admin/scripts/datos/');
    flujoVersionado = rutaBajo(valores['flujo-versionado'], FLUJOS_CLIENTES);
    if (valores['flujo-versionado'] === undefined) problemas.push('falta --flujo-versionado'); else if (flujoVersionado === null) problemas.push('--flujo-versionado tiene que ser un .json bajo Flujos/clientes/');
  } else {
    for (const k of ['mapa-crm', 'flujo-versionado']) if (valores[k] !== undefined && !(sub === 'crear' && soloPrueba)) problemas.push(`${sub} no admite --${k}`);
  }

  const telefonosDePrueba = telefonosDePruebaDe(env);
  let telefonoPrueba = null;
  const filtro = valores['telefono-prueba'];
  if (soloPrueba && sub === 'crear') {
    // La prueba va SOLO a un teléfono: el que termina en esos 4 dígitos, y tiene que ser exactamente uno. Nunca se imprime ni el número ni el filtro.
    if (filtro === undefined) problemas.push('--solo-prueba exige --telefono-prueba <4 dígitos>: nunca se envía a la lista de prueba completa');
    else if (!/^[0-9]{4}$/.test(filtro)) problemas.push('--telefono-prueba tiene que ser de exactamente 4 dígitos');
    else {
      const coinciden = [...telefonosDePrueba].filter((t) => t.endsWith(filtro));
      if (coinciden.length !== 1) problemas.push(`--telefono-prueba tiene que coincidir con exactamente 1 teléfono de TELEFONOS_DE_PRUEBA (coinciden ${coinciden.length})`);
      else telefonoPrueba = new Set(coinciden);
    }
  } else if (filtro !== undefined) problemas.push('--telefono-prueba solo vale con crear --solo-prueba');

  if (problemas.length) return { ok: false, codigo: 2, problemas };
  return {
    ok: true,
    cfg: {
      sub, proyecto: proyectoReal, dirCredenciales, entorno: proy.entorno, tenant, linea, campana: campana ?? null, tanda: tanda ?? null, cupo: cupo === undefined ? null : Number(cupo),
      calidad: calidad ?? null, mapaCrm, flujoVersionado, soloPrueba, telefonoPrueba, telefonosDePrueba, aplicar,
    },
  };
}

// ===========================================================================
// LECTURAS
// ===========================================================================
const lotesDe = (refs, n = 300) => partirEnLotes(refs, n);
const diaDeLaPaz = (ms) => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);
const refCampana = (db, tenant, campana) => db.doc(`tenants/${tenant}/campanasSalientes/${campana}`);

/** `{ ok, numero, ruta }`: la ruta ACTIVA del comercio que termina en `linea`, exactamente una (DP4). Nunca se imprime el número. */
export async function resolverLinea(db, tenant, linea) {
  const q = await db.collection('rutasWhatsApp').where('tenantId', '==', tenant).where('estado', '==', 'activo').get();
  const coinciden = q.docs.filter((d) => d.id.endsWith(linea));
  if (coinciden.length !== 1) return { ok: false, motivo: `con --tenant y --linea se esperaba exactamente 1 ruta activa y hay ${coinciden.length}` };
  return { ok: true, numero: coinciden[0].id, ruta: coinciden[0] };
}

/** La configuración de la campaña, validada por `leerConfigCampana` (la del servidor). `null` si falta o es ilegible. */
async function leerConfig(db, tenant, deps) {
  const s = await db.doc(`tenants/${tenant}/config/campanaSaliente`).get();
  return s.exists ? deps.leerConfigCampana(s.data()) : null;
}

/** `plantillas.campana` de la ruta, con el contrato exacto del registro. */
function plantillaDeLaRuta(ruta) {
  const p = ruta.get('plantillas.campana');
  if (!plantillaCampanaValida(p)) return null;
  return { nombre: p.nombre, idioma: p.idioma, categoria: p.categoria };
}

/** Las conversaciones que EXISTEN y las bajas de una lista de teléfonos, por `claveDeContacto`. */
async function leerContexto(db, tenant, telefonos) {
  const conversaciones = new Map();
  const bajas = new Set();
  for (const lote of lotesDe(telefonos)) {
    const claves = lote.map(claveDeContacto);
    const snaps = await db.getAll(...claves.map((c) => db.doc(`tenants/${tenant}/conversaciones/${c}`)), { fieldMask: ['ultimoEntranteEn', 'bloqueada', 'noContactar', 'riesgoEn', 'phoneNumberId'] });
    snaps.forEach((s, i) => {
      if (!s.exists) return;
      conversaciones.set(claves[i], {
        ultimoEntranteEn: s.get('ultimoEntranteEn'), bloqueada: s.get('bloqueada'), noContactar: s.get('noContactar'), riesgoEn: s.get('riesgoEn'), phoneNumberId: s.get('phoneNumberId'),
      });
    });
    const sb = await db.getAll(...claves.map((c) => db.doc(`tenants/${tenant}/bajas/${c}`)), { fieldMask: ['canal'] });
    sb.forEach((s, i) => { if (s.exists) bajas.add(claves[i]); });
  }
  return { conversaciones, bajas };
}

async function construirLista(cfg, deps, numero, config) {
  let filas;
  let telefonosDePrueba = cfg.telefonosDePrueba;
  if (cfg.soloPrueba) {
    // La prueba: UN teléfono; pasa por las mismas exclusiones de Firestore (baja, marcas, otra línea, 24 h) y su fecha vale hoy.
    const hoy = diaDeLaPaz(deps.ahoraMs());
    filas = [...cfg.telefonoPrueba].map((telefono) => ({ telefono, fecha: hoy, etapa: '' }));
    telefonosDePrueba = new Set();
  } else filas = await deps.leerFilasDelMiniCrm();
  const telefonos = [...new Set(filas.map((f) => telefonoValido(String(f.telefono ?? '').trim())).filter(Boolean))];
  const { conversaciones, bajas } = await leerContexto(deps.db, cfg.tenant, telefonos);
  return armarLista({ filas, conversaciones, bajas, telefonosDePrueba, ahoraMs: deps.ahoraMs(), ventanaDias: config.ventanaDias, numero });
}

const ROTULOS = {
  filas: 'filas del miniCRM', telefonos: 'teléfonos distintos', filasRepetidas: 'filas repetidas (un solo envío)', invalido: 'excluidos: teléfono inválido',
  cerrada: 'excluidos: Ganado o Perdido', fechaIlegible: 'excluidos: fecha ilegible', prueba: 'excluidos: teléfono de prueba', baja: 'excluidos: con baja',
  bloqueada: 'excluidos: bloqueada', noContactar: 'excluidos: no contactar', riesgo: 'excluidos: con marca de riesgo', fueraDeVentana: 'excluidos: fuera de la ventana de días',
  sinConversacion: 'excluidos: sin conversación', otraLinea: 'excluidos: conversación de otra línea', reciente: 'excluidos: escribió en las últimas 24 h', destinatarios: 'DESTINATARIOS',
};
function imprimirConteos(log, conteos) { for (const [k, r] of Object.entries(ROTULOS)) log(`  ${r.padEnd(44)} ${conteos[k]}`); }

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
async function contexto(cfg, deps, log, { conConfig }) {
  const lin = await resolverLinea(deps.db, cfg.tenant, cfg.linea);
  if (!lin.ok) { log(`\n  ✗ ${lin.motivo}. No se escribió nada.\n`); return { codigo: 2 }; }
  let config = null;
  if (conConfig) {
    config = await leerConfig(deps.db, cfg.tenant, deps);
    if (config === null) { log('\n  ✗ Falta `config/campanaSaliente` del comercio o es ilegible (campana-saliente-config.mjs): la campaña queda cerrada. No se escribió nada.\n'); return { codigo: 2 }; }
  }
  return { numero: lin.numero, ruta: lin.ruta, config };
}

async function simular(cfg, deps, log) {
  const c = await contexto(cfg, deps, log, { conConfig: true });
  if (c.codigo) return c.codigo;
  const { destinatarios, conteos } = await construirLista(cfg, deps, c.numero, c.config);
  const tandas = partirEnTandas(destinatarios.length, c.config.porTanda);
  log('\n  SIMULACRO (solo conteos; no escribe en Firestore)\n');
  imprimirConteos(log, conteos);
  log(`  ${'tandas'.padEnd(44)} ${tandas.length} (de hasta ${c.config.porTanda})`);
  log(`  ${'días que lleva (tope diario)'.padEnd(44)} ${Math.ceil(destinatarios.length / c.config.porDia)} (hasta ${c.config.porDia} por día)`);
  log('');
  return 0;
}

async function crear(cfg, deps, log) {
  const { db, Timestamp } = deps;
  const c = await contexto(cfg, deps, log, { conConfig: true });
  if (c.codigo) return c.codigo;
  const plantilla = plantillaDeLaRuta(c.ruta);
  if (plantilla === null) { log('\n  ✗ La ruta no tiene una plantilla de campaña válida (registrar-plantilla.mjs --uso campana). No se escribió nada.\n'); return 2; }
  const ref = refCampana(db, cfg.tenant, cfg.campana);
  if ((await ref.get()).exists) { log('\n  ✗ Ya existe una campaña con ese id: use otro. No se escribió nada.\n'); return 2; }
  const { destinatarios, conteos } = await construirLista(cfg, deps, c.numero, c.config);
  log(`\n  ${cfg.aplicar ? 'CREAR' : 'SECO (solo lecturas)'}${cfg.soloPrueba ? ' · PRUEBA (un solo teléfono)' : ''}\n`);
  imprimirConteos(log, conteos);
  if (destinatarios.length === 0) { log('\n  ✗ No quedó ningún destinatario: no se crea la campaña.\n'); return 2; }
  if (cfg.soloPrueba && destinatarios.length !== 1) { log('\n  ✗ La prueba tiene que quedar con exactamente 1 destinatario. No se escribió nada.\n'); return 2; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar para crear la campaña.\n'); return 1; }
  deps.marcarEscritura?.('escribiendo');
  await ref.create({
    estado: 'creada', phoneNumberId: c.numero, plantilla, prueba: cfg.soloPrueba, creadaEn: Timestamp.fromMillis(deps.ahoraMs()), total: destinatarios.length, conteos,
    tanda: null, tandasHechas: [], materializados: 0, aceptados: 0, rechazados: 0, inciertos: 0,
  });
  for (const lote of partirEnLotes(destinatarios, TAMANO_DE_LOTE)) {
    const b = db.batch();
    for (const d of lote) b.create(ref.collection('destinatarios').doc(claveDeContacto(d.telefono)), { estado: 'pendiente', fechaBase: Timestamp.fromMillis(d.fechaMaxMs) });
    await b.commit();
  }
  deps.marcarEscritura?.('escrito');
  log(`\n  ✓ Campaña creada con ${destinatarios.length} destinatario(s). No sale nada hasta autorizar una tanda (autorizar-tanda).\n`);
  return 0;
}

const yaHecha = (hechas, id) => Array.isArray(hechas) && hechas.some((t) => t === id || t?.id === id);
const enVuelo = (camp) => (camp.get('materializados') ?? 0) - (camp.get('aceptados') ?? 0) - (camp.get('rechazados') ?? 0) - (camp.get('inciertos') ?? 0);

/** Lo que se comprueba antes de autorizar una tanda: `{ codigo, motivo }` si no se puede, `null` si sí. Puro sobre los datos leídos. */
export function motivoDeRechazoDeTanda({ camp, numero, ruta, cfg, config, pendientes, destinatariosTotal, no }) {
  if (!camp.exists) return { codigo: 2, motivo: 'la campaña no existe' };
  if (camp.get('phoneNumberId') !== numero) return { codigo: 2, motivo: 'la campaña es de otra línea' };
  const estado = camp.get('estado');
  if (estado !== 'creada' && estado !== 'enCurso') return { codigo: 2, motivo: `la campaña está ${estado}: no se autoriza una tanda` };
  if (camp.get('tanda') !== null && camp.get('tanda') !== undefined) return { codigo: 2, motivo: 'la tanda anterior no se cerró (cerrar-tanda)' };
  if (yaHecha(camp.get('tandasHechas'), cfg.tanda)) return { codigo: 2, motivo: 'esa tanda ya se hizo: use otro id' };
  if (cfg.cupo > config.porTanda) return { codigo: 2, motivo: 'el cupo supera porTanda de la configuración' };
  if (plantillaDeLaRuta(ruta) === null) return { codigo: 2, motivo: 'la ruta no tiene una plantilla de campaña válida' };
  const otra = ruta.get('campanaSalienteEnCurso');
  if (otra !== undefined && otra !== null && otra !== cfg.campana) return { codigo: 2, motivo: 'otra campaña está en curso en este número' };
  if (destinatariosTotal !== camp.get('total')) return { codigo: 2, motivo: 'la campaña está incompleta (faltan destinatarios): no se autoriza' };
  if (pendientes === 0) return { codigo: 2, motivo: 'no quedan destinatarios pendientes' };
  if ((camp.get('tandasHechas') ?? []).length > 0) { // desde la segunda tanda, la proporción de «No» de las anteriores decide
    const enviados = (camp.get('aceptados') ?? 0) + (camp.get('inciertos') ?? 0);
    if (superaNo({ no, enviados, pausaNoPct: config.pausaNoPct })) return { codigo: 4, motivo: 'la proporción de «No» supera el límite: no se autoriza la tanda siguiente (revise el mensaje con Andres)' };
  }
  return null;
}

async function autorizarTanda(cfg, deps, log) {
  const { db, Timestamp } = deps;
  const c = await contexto(cfg, deps, log, { conConfig: true });
  if (c.codigo) return c.codigo;
  const ref = refCampana(db, cfg.tenant, cfg.campana);
  const leer = async () => {
    const camp = await ref.get();
    const ruta = await db.doc(`rutasWhatsApp/${c.numero}`).get();
    if (!camp.exists) return { camp, ruta, pendientes: 0, destinatariosTotal: 0, no: 0 };
    const pend = await ref.collection('destinatarios').where('estado', '==', 'pendiente').limit(1).get();
    const total = await ref.collection('destinatarios').count().get();
    const { no } = await conciliarRespuestas(db, cfg.tenant, cfg.campana);
    return { camp, ruta, pendientes: pend.size, destinatariosTotal: total.data().count, no };
  };
  const previo = await leer();
  const rechazo = motivoDeRechazoDeTanda({ ...previo, numero: c.numero, cfg, config: c.config });
  log(`\n  ${cfg.aplicar ? 'AUTORIZAR TANDA' : 'SECO (solo lecturas)'} · cupo ${cfg.cupo} de ${c.config.porTanda} · calidad ${cfg.calidad}`);
  if (rechazo) { log(`\n  ✗ ${rechazo.motivo}. No se escribió nada.\n`); return rechazo.codigo; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar para autorizar esta tanda.\n'); return 1; }
  deps.marcarEscritura?.('escribiendo');
  const hecho = await db.runTransaction(async (tx) => {
    // Precondición: nada cambió desde la lectura (la campaña y la ruta se vuelven a leer dentro de la transacción).
    const camp = await tx.get(ref);
    const refRuta = db.doc(`rutasWhatsApp/${c.numero}`);
    const ruta = await tx.get(refRuta);
    const r = motivoDeRechazoDeTanda({ camp, numero: c.numero, ruta, cfg, config: c.config, pendientes: previo.pendientes, destinatariosTotal: previo.destinatariosTotal, no: previo.no });
    if (r) return r;
    tx.update(ref, { estado: 'enCurso', tanda: { id: cfg.tanda, cupo: cfg.cupo, usados: 0, calidad: cfg.calidad, autorizadaEn: Timestamp.fromMillis(deps.ahoraMs()) } });
    tx.update(refRuta, { campanaSalienteEnCurso: cfg.campana });
    return null;
  });
  if (hecho) { log(`\n  ✗ ${hecho.motivo}. No se escribió nada.\n`); return hecho.codigo; }
  deps.marcarEscritura?.('escrito');
  log('\n  ✓ Tanda autorizada. El servidor la materializa de a pocos mensajes por reclamo; siga con `estado` y cierre con cerrar-tanda.\n');
  return 0;
}

async function cerrarTanda(cfg, deps, log) {
  const { db, FieldValue, Timestamp } = deps;
  const lin = await resolverLinea(db, cfg.tenant, cfg.linea);
  if (!lin.ok) { log(`\n  ✗ ${lin.motivo}. No se escribió nada.\n`); return 2; }
  const ref = refCampana(db, cfg.tenant, cfg.campana);
  const refRuta = db.doc(`rutasWhatsApp/${lin.numero}`);
  const camp = await ref.get();
  const malo = (m) => { log(`\n  ✗ ${m}. No se escribió nada.\n`); return 2; };
  if (!camp.exists) return malo('la campaña no existe');
  if (camp.get('phoneNumberId') !== lin.numero) return malo('la campaña es de otra línea');
  const tanda = camp.get('tanda');
  if (!tanda || tanda.id !== cfg.tanda) return malo('esa no es la tanda abierta de la campaña');
  if (enVuelo(camp) > 0) return malo('todavía hay mensajes en vuelo: espere a que el servidor los confirme');
  const pend = await ref.collection('destinatarios').where('estado', '==', 'pendiente').limit(1).get();
  log(`\n  ${cfg.aplicar ? 'CERRAR TANDA' : 'SECO (solo lecturas)'} · ${tanda.usados} de ${tanda.cupo} usados · ${pend.empty ? 'no quedan pendientes: la campaña terminaría' : 'quedan pendientes'}`);
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar para cerrar la tanda.\n'); return 1; }
  deps.marcarEscritura?.('escribiendo');
  const r = await db.runTransaction(async (tx) => {
    const c2 = await tx.get(ref);
    const ruta = await tx.get(refRuta);
    const t = c2.get('tanda');
    if (!t || t.id !== cfg.tanda || enVuelo(c2) > 0) return false;
    tx.update(ref, {
      tanda: null, tandasHechas: [...(c2.get('tandasHechas') ?? []), { ...t, cerradaEn: Timestamp.fromMillis(deps.ahoraMs()) }],
      ...(pend.empty ? { estado: 'terminada' } : {}),
    });
    if (ruta.get('campanaSalienteEnCurso') === cfg.campana) tx.update(refRuta, { campanaSalienteEnCurso: FieldValue.delete() });
    return true;
  });
  if (!r) return malo('la campaña cambió durante el cierre');
  deps.marcarEscritura?.('escrito');
  log(pend.empty ? '\n  ✓ Tanda cerrada y campaña TERMINADA.\n' : '\n  ✓ Tanda cerrada. Para la siguiente: calidad de WAM y autorizar-tanda.\n');
  return 0;
}

async function pausar(cfg, deps, log) {
  const { db, FieldValue } = deps;
  const lin = await resolverLinea(db, cfg.tenant, cfg.linea);
  if (!lin.ok) { log(`\n  ✗ ${lin.motivo}. No se escribió nada.\n`); return 2; }
  const ref = refCampana(db, cfg.tenant, cfg.campana);
  const refRuta = db.doc(`rutasWhatsApp/${lin.numero}`);
  const camp = await ref.get();
  if (!camp.exists) { log('\n  ✗ La campaña no existe. No se escribió nada.\n'); return 2; }
  if (camp.get('phoneNumberId') !== lin.numero) { log('\n  ✗ La campaña es de otra línea. No se escribió nada.\n'); return 2; }
  const estado = camp.get('estado');
  if (estado === 'terminada') { log('\n  ✗ La campaña ya terminó. No se escribió nada.\n'); return 2; }
  const punteroAqui = (await refRuta.get()).get('campanaSalienteEnCurso') === cfg.campana;
  if (estado === 'pausada' && !punteroAqui) { log('\n  ✓ La campaña ya está pausada: nada que hacer.\n'); return 0; }
  if (!cfg.aplicar) { log(`\n  SECO: la campaña está ${estado}. Agregue --aplicar para pausarla.\n`); return 1; }
  deps.marcarEscritura?.('escribiendo');
  await db.runTransaction(async (tx) => {
    const c2 = await tx.get(ref);
    const ruta = await tx.get(refRuta);
    if (c2.get('estado') !== 'pausada') tx.update(ref, { estado: 'pausada', motivoPausa: 'manual' });
    if (ruta.get('campanaSalienteEnCurso') === cfg.campana) tx.update(refRuta, { campanaSalienteEnCurso: FieldValue.delete() });
  });
  deps.marcarEscritura?.('escrito');
  log('\n  ✓ Campaña pausada y puntero quitado. Lo que ya estaba en vuelo termina de confirmarse; no se materializa nada más.\n');
  return 0;
}

/** Lo que se comprueba antes de reanudar: `{ codigo, motivo }` si no se puede, `null` si sí. Puro sobre los datos leídos. */
export function motivoDeRechazoDeReanudar({ camp, numero }) {
  if (!camp.exists) return { codigo: 2, motivo: 'la campaña no existe' };
  if (camp.get('phoneNumberId') !== numero) return { codigo: 2, motivo: 'la campaña es de otra línea' };
  const estado = camp.get('estado');
  if (estado === 'terminada' || estado === 'cancelada') return { codigo: 2, motivo: `la campaña está ${estado}: no se reanuda` };
  if (estado !== 'pausada') return { codigo: 2, motivo: `la campaña no está pausada (está ${estado})` };
  return null;
}

async function reanudar(cfg, deps, log) {
  const { db, FieldValue, Timestamp } = deps;
  const lin = await resolverLinea(db, cfg.tenant, cfg.linea);
  if (!lin.ok) { log(`\n  ✗ ${lin.motivo}. No se escribió nada.\n`); return 2; }
  const ref = refCampana(db, cfg.tenant, cfg.campana);
  const refRuta = db.doc(`rutasWhatsApp/${lin.numero}`);
  const camp = await ref.get();
  const rechazo = motivoDeRechazoDeReanudar({ camp, numero: lin.numero });
  if (rechazo) { log(`\n  ✗ ${rechazo.motivo}. No se escribió nada.\n`); return rechazo.codigo; }
  const n = (k) => camp.get(k) ?? 0;
  const tanda = camp.get('tanda');
  log(`\n  ${cfg.aplicar ? 'REANUDAR' : 'SECO (solo lecturas)'} · pausada por: ${camp.get('motivoPausa') ?? 'motivo no registrado'}${camp.get('prueba') ? ' · PRUEBA' : ''}`);
  log(`  materializados ${n('materializados')} · aceptados ${n('aceptados')} · rechazados ${n('rechazados')} · inciertos ${n('inciertos')} · en vuelo ${enVuelo(camp)} de ${n('total')} destinatarios`);
  log(`  tanda abierta: ${tanda ? `${tanda.usados} de ${tanda.cupo} (hay que cerrarla con cerrar-tanda antes de autorizar otra)` : 'ninguna'} · tandas hechas ${(camp.get('tandasHechas') ?? []).length}`);
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar para reanudar (no autoriza ninguna tanda).\n'); return 1; }
  deps.marcarEscritura?.('escribiendo');
  const r = await db.runTransaction(async (tx) => {
    const c2 = await tx.get(ref);
    const ruta = await tx.get(refRuta);
    const otra = motivoDeRechazoDeReanudar({ camp: c2, numero: lin.numero });
    if (otra) return otra;
    const arrancada = (c2.get('materializados') ?? 0) > 0 || c2.get('tanda') != null || (c2.get('tandasHechas') ?? []).length > 0;
    tx.update(ref, {
      estado: arrancada ? 'enCurso' : 'creada', motivoPausa: FieldValue.delete(),
      reanudaciones: [...(c2.get('reanudaciones') ?? []), { en: Timestamp.fromMillis(deps.ahoraMs()), motivoPausa: c2.get('motivoPausa') ?? null }],
    });
    // Sin puntero el servidor no materializa nada: reanudar nunca autoriza. Una pausa por errores lo deja puesto (solo cambia el estado), por eso se quita aquí.
    if (ruta.get('campanaSalienteEnCurso') === cfg.campana) tx.update(refRuta, { campanaSalienteEnCurso: FieldValue.delete() });
    return null;
  });
  if (r) { log(`\n  ✗ ${r.motivo}. No se escribió nada.\n`); return r.codigo; }
  deps.marcarEscritura?.('escrito');
  log('\n  ✓ Campaña reanudada (sin pausa, sin puntero, con auditoría). NO se autorizó ninguna tanda: la siguiente pide cerrar-tanda (si había una abierta) y autorizar-tanda.\n');
  return 0;
}

async function estado(cfg, deps, log) {
  const { db } = deps;
  const lin = await resolverLinea(db, cfg.tenant, cfg.linea);
  if (!lin.ok) { log(`\n  ✗ ${lin.motivo}.\n`); return 2; }
  const ref = refCampana(db, cfg.tenant, cfg.campana);
  const camp = await ref.get();
  if (!camp.exists) { log('\n  ✗ La campaña no existe.\n'); return 2; }
  if (camp.get('phoneNumberId') !== lin.numero) { log('\n  ✗ La campaña es de otra línea.\n'); return 2; }
  const dest = await ref.collection('destinatarios').select('estado').get();
  const porEstado = {};
  for (const d of dest.docs) { const e = d.get('estado'); porEstado[e] = (porEstado[e] ?? 0) + 1; }
  const resp = await conciliarRespuestas(db, cfg.tenant, cfg.campana);
  const periodo = new Date(deps.ahoraMs()).toISOString().slice(0, 7);
  const metricas = await db.doc(`tenants/${cfg.tenant}/metricas/${periodo}`).get();
  const n = (k) => camp.get(k) ?? 0;
  const tanda = camp.get('tanda');
  log(`\n  ESTADO · ${camp.get('estado')}${camp.get('motivoPausa') ? ` (${camp.get('motivoPausa')})` : ''}${camp.get('prueba') ? ' · PRUEBA' : ''}`);
  log(`  destinatarios: total ${n('total')} · ${JSON.stringify(porEstado)}`);
  log(`  materializados ${n('materializados')} · aceptados ${n('aceptados')} · rechazados ${n('rechazados')} · inciertos ${n('inciertos')} · en vuelo ${enVuelo(camp)}`);
  log(`  tanda abierta: ${tanda ? `${tanda.usados} de ${tanda.cupo}` : 'ninguna'} · tandas hechas ${(camp.get('tandasHechas') ?? []).length}`);
  log(`  respuestas conciliadas: ${resp.si} «Sí» · ${resp.no} «No»`);
  log(`  plantillasCampana del mes (${periodo}, UTC): ${metricas.get('plantillasCampana') ?? 0}`);
  const categoria = camp.get('plantilla.categoria');
  const entregas = n('aceptados') + n('inciertos');
  if (categoria === 'UTILITY') log(`  categoría UTILITY · costo estimado: ${entregas} × ${PLANTILLA_UTILIDAD_USD} USD = ${(entregas * PLANTILLA_UTILIDAD_USD).toFixed(4)} USD`);
  else log(`  categoría ${categoria ?? 'desconocida'}: el costo por entrega es mayor que el de UTILITY; no se estima aquí (ver docs/base-comercial.md).`);
  log('');
  return 0;
}

/**
 * Corre el subcomando ya validado. `deps`: { db, Timestamp, FieldValue, log, ahoraMs, leerFilasDelMiniCrm, leerConfigCampana, marcarEscritura }.
 */
export async function ejecutar(cfg, deps) {
  const log = deps.log ?? ((t) => console.log(t));
  const d = { ahoraMs: () => Date.now(), ...deps };
  switch (cfg.sub) {
    case 'simular': return simular(cfg, d, log);
    case 'crear': return crear(cfg, d, log);
    case 'autorizar-tanda': return autorizarTanda(cfg, d, log);
    case 'cerrar-tanda': return cerrarTanda(cfg, d, log);
    case 'pausar': return pausar(cfg, d, log);
    case 'reanudar': return reanudar(cfg, d, log);
    case 'estado': return estado(cfg, d, log);
    default: return 2;
  }
}

// ===========================================================================
// PUNTO DE ENTRADA
// ===========================================================================
const corrida = { estado: 'antes' };

/**
 * Ctrl-C (SIGINT) y SIGTERM: ESPERA a que el lector borre el flujo temporal de n8n y recién entonces sale con 130. Si saliera antes,
 * quedaría vivo un webhook sin autenticación que devuelve la hoja. `proceso` y `lector` se inyectan en las pruebas.
 */
export function instalarInterrupcion(proceso, estadoCorrida, lector, escribir = (t) => console.error(t)) {
  let atendida = false;
  const alSenal = () => {
    if (atendida) return;
    atendida = true;
    escribir(mensajeDeInterrupcion(estadoCorrida.estado));
    Promise.resolve().then(() => lector?.limpiar?.()).catch(() => {}).finally(() => proceso.exit(130));
  };
  proceso.once('SIGINT', alSenal);
  proceso.once('SIGTERM', alSenal);
}

function leerJsonBajo(ruta, base) {
  const real = realpathSync(ruta);
  if (!real.startsWith(`${realpathSync(base)}${sep}`)) throw Object.assign(new Error('ruta fuera de su carpeta'), { code: 'ruta-fuera' });
  return JSON.parse(readFileSync(real, 'utf8'));
}

async function principal() {
  const analisis = analizarArgumentos(process.argv.slice(2));
  if (!analisis.ok) {
    console.error(`\n  ✗ ${analisis.problemas.join('\n  ✗ ')}\n\n${USO}\n`);
    process.exit(analisis.codigo ?? 2);
  }
  const { cfg } = analisis;
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp, FieldValue } = await import('firebase-admin/firestore');
  // La validación de la configuración es la del servidor, compilada (como en migrar-prepago.mjs): si falta, se pide compilar.
  let leerConfigCampana;
  try {
    ({ leerConfigCampana } = await import('../../../functions/lib/core/conversacion/salidaCampana.js'));
  } catch (e) {
    const falta = !existsSync(new URL('../../../functions/lib/core/conversacion/salidaCampana.js', import.meta.url));
    console.error(falta ? '\n  ✗ No se encuentra functions/lib/core/conversacion/salidaCampana.js. Compile primero: pnpm functions:build\n' : `\n  ✗ No se pudo cargar salidaCampana.js: ${e?.code ?? e?.name ?? 'error'}\n`);
    process.exit(2);
  }
  Object.assign(process.env, entornoDeCredenciales(cfg));
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  let leerFilasDelMiniCrm;
  if (cfg.mapaCrm !== null) {
    if (!process.env.ENV_FILE) { console.error('\n  ✗ falta ENV_FILE en el entorno (el .env de n8n)\n'); process.exit(2); }
    const crm = leerJsonBajo(cfg.mapaCrm, DATOS).crm;
    const nombreFlujo = leerJsonBajo(cfg.flujoVersionado, FLUJOS_CLIENTES).name;
    leerFilasDelMiniCrm = crearLectorDeMiniCrmN8n({ envFile: process.env.ENV_FILE, nombreFlujo, crm }, { aviso: (t) => console.error(`\n  ⚠ ${t}\n`) });
  }
  instalarInterrupcion(process, corrida, leerFilasDelMiniCrm);
  const codigo = await ejecutar(cfg, { db, Timestamp, FieldValue, leerFilasDelMiniCrm, leerConfigCampana, marcarEscritura: (v) => { corrida.estado = v; } });
  await db.terminate().catch(() => {});
  process.exit(leerFilasDelMiniCrm?.estado?.limpiezaFallida ? 3 : codigo);
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
