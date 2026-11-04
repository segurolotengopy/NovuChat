/**
 * VACIAR LOS CHATS DE UN COMERCIO (Firestore) — seco por omisión, un comercio por corrida.
 *
 * PARA QUÉ. Un comercio cambió su libro por completo y conserva su número; sus chats eran solo pruebas. Este script borra de
 * `tenants/<t>` ÚNICAMENTE la lista cerrada de abajo:
 *     conversaciones/*  con sus subcolecciones  mensajes/*  y  privado/*
 *     contactos/*
 * NUNCA toca (ni por error de tipeo, la lista es cerrada): metricas, config, ficha del tenant, rutasWhatsApp, credenciales, plantillas,
 * enlaces, miembros, cuenta, catalogo, pagos, pedidos, cierres, auditoria (solo AGREGA una línea), ni los medios (Storage y
 * mediosRecibidos tienen su propio script revisado: `borrar-medios-conversacion.mjs`). Borrar conversaciones NO baja lo ya contado en
 * `metricas` (lo facturado queda facturado).
 *
 *   node scripts/plataforma/vaciar-chats-tenant.mjs --proyecto <id> --tenant <id>
 *        [--aplicar --respaldo <ruta absoluta> --confirmo-produccion <tenant>]
 *
 * SECO: cuenta documentos de lo que borraría y, aparte, de lo que NO borra pero conviene mirar antes (pedidos, pagos, comprobantes,
 * medios, cierres): si el comercio cobra de verdad, un pedido con comprobante es dato del negocio, no de prueba. Imprime SOLO conteos.
 * `--aplicar`: exige `--confirmo-produccion` igual a `--tenant` y `--respaldo` (ruta absoluta, 0600, fuera de todo repositorio, nunca se
 * pisa). El respaldo lleva los documentos a borrar (datos de personas: se borra al cerrar la operación). Borra primero las subcolecciones
 * y después los documentos, relee que no quede nada y deja una línea en la auditoría con SOLO conteos.
 * Un solo comercio de la lista cerrada de las subcuentas (la misma del relleno histórico), y nunca uno excluido: no existe «todos» ni comodines. IRREVERSIBLE salvo por ese respaldo.
 *
 * ORDEN con las otras dos herramientas (con poco tráfico, de noche): 1) fichas del flujo en n8n, 2) chats (este script), 3) hoja del miniCRM. Si el bot recibe un mensaje durante el borrado puede recrear una conversación: la relectura lo detecta y sale 3.
 *
 * SALIDA. 0 hecho o seco sin nada que borrar; 1 el seco encontró documentos; 2 uso o salvaguarda (nada escrito); 3 error de ejecución.
 */
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { comprobarProyecto, comprobarRespaldo, guardarRespaldo, esTenantExcluido } from './aplicar-consola-conversaciones.mjs';
import { TENANTS } from './relleno-crm-historico.mjs';

/** Lista CERRADA de lo que se borra: colección -> subcolecciones. */
export const SE_BORRA = Object.freeze({ conversaciones: Object.freeze(['mensajes', 'privado']), contactos: Object.freeze([]) });
/** Lo que NO se borra, pero se cuenta en el seco para decidir. */
export const SOLO_SE_CUENTA = Object.freeze(['pedidos', 'pagos', 'comprobantesRecibidos', 'mediosRecibidos', 'cierres']);
export const LIMITE_DOCUMENTOS = 20000;

const CON_VALOR = ['proyecto', 'tenant', 'respaldo', 'confirmo-produccion'];

export const USO = '  node scripts/plataforma/vaciar-chats-tenant.mjs --proyecto <id> --tenant <id> [--aplicar --respaldo <ruta> --confirmo-produccion <tenant>]';

export function analizarArgumentos(argv, env = process.env, opciones = {}) {
  const problemas = [];
  const valores = { __proto__: null };
  let aplicar = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string' || !a.startsWith('--')) { problemas.push('argumento suelto (sin su opción)'); continue; }
    const nombre = a.slice(2);
    if (nombre === 'aplicar') { if (aplicar) problemas.push('opción repetida: --aplicar'); aplicar = true; }
    else if (CON_VALOR.includes(nombre)) {
      if (nombre in valores) problemas.push(`opción repetida: --${nombre}`);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) { problemas.push(`--${nombre} sin valor`); continue; }
      valores[nombre] = v; i += 1;
    } else problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40)}`);
  }
  const { proyecto, tenant, respaldo } = valores;
  const confirmo = valores['confirmo-produccion'];
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto === undefined) problemas.push('falta --proyecto'); else if (!proy.ok) problemas.push(proy.motivo);
  if (tenant === undefined) problemas.push('falta --tenant (un comercio por corrida; no existe «todos»)');
  else if (!TENANTS.includes(tenant)) problemas.push(`--tenant tiene que ser uno de: ${TENANTS.join(', ')} (un comercio por corrida; no existe «todos»)`);
  else if (esTenantExcluido(tenant, env)) problemas.push('--tenant está excluido de las herramientas de la plataforma');
  if (confirmo !== undefined && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  if (aplicar && confirmo === undefined) problemas.push('--aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  if (aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta absoluta> (0600, fuera del repositorio)');
  let respaldoResuelto = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: false, permitirExistente: false });
    if (r.ok) respaldoResuelto = r.real; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, aplicar, respaldo: respaldo ?? null, respaldoResuelto } };
}

/**
 * deps = {
 *   listar(coleccion): Promise<{ruta, datos}[]>      documentos de tenants/<t>/<coleccion> (sin subcolecciones)
 *   listarSub(rutaDoc, sub): Promise<{ruta, datos}[]>
 *   contar(coleccion): Promise<number>               solo conteo de lo que NO se borra
 *   borrar(rutas: string[]): Promise<number | void>   devuelve cuántos borrados FALLARON (0 o nada = todos bien)
 *   auditar(conteos): Promise<void>
 * }
 */
export async function ejecutar(cfg, deps, log = (t) => console.log(t)) {
  const plan = { documentos: {} };
  const aBorrar = []; // {ruta, datos, nivel}: nivel 0 = subcolección, 1 = documento
  for (const [col, subs] of Object.entries(SE_BORRA)) {
    const docs = await deps.listar(col);
    plan.documentos[col] = docs.length;
    for (const d of docs) {
      for (const s of subs) {
        const hijos = await deps.listarSub(d.ruta, s);
        plan.documentos[`${col}/*/${s}`] = (plan.documentos[`${col}/*/${s}`] ?? 0) + hijos.length;
        for (const h of hijos) aBorrar.push({ ...h, nivel: 0 });
      }
      aBorrar.push({ ...d, nivel: 1 });
    }
  }
  const total = aBorrar.length;
  const noSeBorra = {};
  for (const c of SOLO_SE_CUENTA) noSeBorra[c] = await deps.contar(c);
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)'} · ${cfg.tenant} · proyecto ${cfg.proyecto}`);
  for (const [k, n] of Object.entries(plan.documentos)) log(`  se borraría  ${k.padEnd(28)} ${n}`);
  log(`  se borraría  TOTAL${' '.repeat(23)}${total}`);
  for (const [k, n] of Object.entries(noSeBorra)) log(`  NO se borra  ${k.padEnd(28)} ${n}   (solo se cuenta)`);
  if (noSeBorra.pedidos > 0 || noSeBorra.comprobantesRecibidos > 0 || noSeBorra.pagos > 0) {
    log('  ! Hay pedidos, pagos o comprobantes: si el comercio cobra de verdad pueden ser reales. Este script no los toca; decídalo antes.');
  }
  if (total === 0) { log('\n  ✓ Nada que borrar.\n'); return 0; }
  if (total > LIMITE_DOCUMENTOS) { log(`\n  ✗ ${total} documentos superan el límite de seguridad (${LIMITE_DOCUMENTOS}): no se borra nada.\n`); return 2; }
  if (!cfg.aplicar) { log('\n  Seco: no se borró nada. Agregue --aplicar --respaldo <ruta> --confirmo-produccion <tenant>.\n'); return 1; }

  try {
    guardarRespaldo(cfg.respaldo, { version: 1, campo: 'vaciar-chats-tenant', entorno: cfg.entorno, tenant: cfg.tenant, creadoEn: new Date().toISOString(),
      documentos: aBorrar.map((d) => ({ ruta: d.ruta, datos: d.datos })) });
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa. No se borra nada.\n'); return 2; }
    throw e;
  }
  log(`\n  Respaldo guardado (los documentos a borrar; datos de personas, se borra al cerrar): ${cfg.respaldo}`);
  // Solo rutas que cuelgan de tenants/<tenant>/<colección de la lista cerrada>: una última guarda antes del borrado.
  const prefijos = Object.keys(SE_BORRA).map((c) => `tenants/${cfg.tenant}/${c}/`);
  const seguras = aBorrar.every((d) => prefijos.some((p) => d.ruta.startsWith(p)));
  if (!seguras) { log('\n  ✗ Una ruta quedó fuera de la lista cerrada: no se borra nada.\n'); return 2; }
  const fallos = ((await deps.borrar(aBorrar.filter((d) => d.nivel === 0).map((d) => d.ruta))) ?? 0)
    + ((await deps.borrar(aBorrar.filter((d) => d.nivel === 1).map((d) => d.ruta))) ?? 0);
  if (fallos > 0) { log(`\n  ✗ Fallaron ${fallos} borrados (no se imprimen rutas): revise y vuelva a correr; lo ya borrado está en el respaldo.\n`); return 3; }
  let quedan = 0;
  for (const [col, subs] of Object.entries(SE_BORRA)) {
    const docs = await deps.listar(col);
    quedan += docs.length;
    for (const s of subs) for (const d of docs) quedan += (await deps.listarSub(d.ruta, s)).length;
  }
  await deps.auditar({ borrados: plan.documentos });
  if (quedan > 0) { log(`\n  ✗ Quedan ${quedan} documentos tras el borrado: revise (el respaldo permite reponer lo borrado). Si el bot sigue activo, un mensaje nuevo puede haber recreado una conversación: corra de nuevo con poco tráfico.\n`); return 3; }
  log(`\n  ✓ Borrados ${total} documentos y releído: no queda nada en la lista cerrada. metricas, config y el resto no se tocaron.\n`);
  return 0;
}

async function principal() {
  const a = analizarArgumentos(process.argv.slice(2));
  if (!a.ok) { console.error(`\n  ✗ ${a.problemas.join('\n  ✗ ')}\n\n${USO}\n`); process.exit(2); }
  const { cfg } = a;
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  initializeApp({ credential: applicationDefault(), projectId: cfg.proyecto });
  const db = getFirestore();
  const serializar = (v) => {
    if (v && typeof v.toMillis === 'function') return { __ts: v.toMillis() };
    if (Array.isArray(v)) return v.map(serializar);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, serializar(x)]));
    return v;
  };
  const leer = async (refs) => (await Promise.all(refs.map(async (r) => ({ ruta: r.path, datos: serializar((await r.get()).data() ?? {}) }))));
  const codigo = await ejecutar(cfg, {
    listar: async (c) => leer(await db.collection(`tenants/${cfg.tenant}/${c}`).listDocuments()),
    listarSub: async (ruta, s) => leer(await db.doc(ruta).collection(s).listDocuments()),
    contar: async (c) => (await db.collection(`tenants/${cfg.tenant}/${c}`).count().get()).data().count,
    borrar: async (rutas) => { const w = db.bulkWriter(); const res = await Promise.allSettled(rutas.map((r) => w.delete(db.doc(r)))); await w.close(); return res.filter((x) => x.status === 'rejected').length; },
    auditar: async (c) => { await db.collection(`tenants/${cfg.tenant}/auditoria`).add({ accion: 'vaciar_chats', en: Timestamp.now(), ...c }); },
  });
  process.exit(codigo);
}

function seEjecutaDirecto() {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}
if (seEjecutaDirecto()) {
  try { await principal(); } catch (e) { console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`); process.exit(3); }
}
