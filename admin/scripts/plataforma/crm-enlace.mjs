/**
 * ESCRIBIR `tenants/{id}/config/crmEnlace` DE UN SOLO COMERCIO — seco por omisión.
 *
 * QUÉ ES. El enlace a la hoja de Google del miniCRM de ese comercio (carpeta MiniCRM_CLIENTES), que la Consola
 * muestra como el botón «Abrir miniCRM» del Tablero al administrador del comercio. Lo escribe NovuChat desde
 * Plataforma: `firestore.rules` no deja que ningún navegador lo escriba, y solo el admin de ese comercio lo lee.
 * Es una URL, nunca un secreto; no se guarda en el repositorio, solo en Firestore.
 *
 *   node scripts/plataforma/crm-enlace.mjs --proyecto <id> --tenant <id> --enlace <url> \
 *        [--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]
 *   node scripts/plataforma/crm-enlace.mjs --proyecto <id> --tenant <id> --quitar \
 *        [--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]
 *
 * QUÉ HACE.
 *   · SECO (sin `--aplicar`): lee SOLO `config/crmEnlace`, imprime si hay enlace (nunca el enlace entero: el
 *     identificador de la hoja se abrevia) y qué cambiaría. No escribe.
 *   · `--aplicar`: exige `--respaldo` (ruta absoluta, fuera de todo repositorio, carpeta 0700, archivo 0600, nunca
 *     se pisa) con el valor previo (o su ausencia), y recién entonces UNA escritura del documento. Relee y compara.
 *     Deshacer = volver a correr con el enlace previo del respaldo, o con `--quitar`.
 *   · El enlace tiene que pasar `esEnlaceDeHoja` (https://docs.google.com/spreadsheets/d/<id>…); otra cosa se
 *     rechaza con salida 2 sin tocar nada.
 *   · IDEMPOTENTE: si ya está escrito igual, sale con 0 sin escribir.
 *
 * SALVAGUARDA DE PROYECTO. La misma de `aplicar-consola-oculta.mjs` (lista blanca por variables de entorno;
 * contra PRODUCCIÓN, `--aplicar` exige `--confirmo-produccion <tenant>` igual a `--tenant`; el id de un proyecto
 * real nunca se imprime). Salida 0: sin diferencias o escritura comprobada. 1: el seco encontró diferencias.
 * 2: uso o salvaguarda. 3: error de ejecución.
 *
 * COSTO. Seco: una lectura. `--aplicar`: dos lecturas y UNA escritura. 0 mensajes por conversación. NO se corre
 * contra producción sin el «sí» de Andres, cliente por cliente.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { comprobarProyecto, comprobarRespaldo, guardarRespaldo } from './aplicar-consola-oculta.mjs';
import { esEnlaceDeHoja } from '../../functions/src/central/enlace-minicrm.ts';

const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const CON_VALOR = ['proyecto', 'tenant', 'enlace', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'quitar'];

export const USO = '  node scripts/plataforma/crm-enlace.mjs --proyecto <id> --tenant <id> (--enlace <url> | --quitar) '
  + '[--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]';

/** Para imprimir: nunca el enlace entero. */
export const abreviado = (u) => (typeof u === 'string' && u.length > 0 ? `${u.slice(0, 45)}…(${u.length} caracteres)` : '(ninguno)');

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
  const quitar = banderas.includes('quitar');
  const { proyecto, tenant, respaldo, enlace } = valores;
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

  if (quitar && enlace !== undefined) problemas.push('--quitar no admite --enlace');
  else if (!quitar && enlace === undefined) problemas.push('falta --enlace <url> (o --quitar)');
  else if (!quitar && !esEnlaceDeHoja(enlace)) problemas.push('--enlace no es un enlace a una hoja de Google (https://docs.google.com/spreadsheets/d/<id>…)');

  if (aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta> (por omisión no hay respaldo)');
  let respaldoReal = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, permitirExistente: true });
    if (r.ok) respaldoReal = respaldo; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, enlace: quitar ? null : enlace, quitar, aplicar, respaldo: respaldoReal } };
}

const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';

/** Devuelve el código de salida. `deps`: `{ db, log }`. Importable para probar con una base en memoria. */
export async function ejecutar(cfg, deps) {
  const { db } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const rotulo = `${cfg.entorno} · tenant ${cfg.tenant}`;
  const ficha = db.doc(`tenants/${cfg.tenant}`);
  const ref = db.doc(`tenants/${cfg.tenant}/config/crmEnlace`);

  const [fsnap] = await db.getAll(ficha, { fieldMask: ['estado'] });
  if (!fsnap.exists) { log(`\n  ✗ ${cfg.tenant}: no existe el comercio (${cfg.entorno})\n`); return 1; }
  const [snap] = await db.getAll(ref, { fieldMask: ['enlaceHoja'] });
  const hoy = snap.exists ? snap.get('enlaceHoja') : undefined;
  const hoyTexto = snap.exists ? (typeof hoy === 'string' ? abreviado(hoy) : '(valor no válido)') : 'AUSENTE';

  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)'} · ${rotulo}\n`);
  log(`  enlace hoy      : ${hoyTexto}`);
  log(`  enlace después  : ${cfg.quitar ? 'AUSENTE (se elimina el documento)' : abreviado(cfg.enlace)}`);

  const igual = cfg.quitar ? !snap.exists : snap.exists && hoy === cfg.enlace;
  if (igual) { log('\n  ✓ Ya está así: nada que hacer.\n'); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (y --respaldo) para escribir.\n'); return 1; }

  try {
    guardarRespaldo(cfg.respaldo, {
      version: 1, entorno: cfg.entorno, tenant: cfg.tenant, creadoEn: new Date().toISOString(),
      previo: { presente: snap.exists, valor: snap.exists && typeof hoy === 'string' ? hoy : null },
    });
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa; elija otro nombre. No se escribe nada.\n'); return 2; }
    throw e;
  }
  log(`\n  Respaldo guardado y releído: ${cfg.respaldo}`);

  try {
    if (cfg.quitar) await ref.delete({ exists: true });
    else if (snap.exists) await ref.update({ enlaceHoja: cfg.enlace }, { lastUpdateTime: snap.updateTime });
    else await ref.create({ enlaceHoja: cfg.enlace });
  } catch (e) {
    if (esPrecondicion(e) || e?.code === 6 || e?.code === 'already-exists' || e?.code === 5 || e?.code === 'not-found') {
      log('\n  ✗ El documento cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr el seco.\n');
      return 3;
    }
    throw e;
  }
  const [despues] = await db.getAll(ref, { fieldMask: ['enlaceHoja'] });
  const bien = cfg.quitar ? !despues.exists : despues.exists && despues.get('enlaceHoja') === cfg.enlace;
  if (!bien) { log('\n  ✗ La relectura no coincide con lo escrito. Revise con el seco; el respaldo guarda el valor previo.\n'); return 3; }
  log(`\n  ✓ Escrito y releído: ${cfg.quitar ? 'enlace eliminado' : abreviado(cfg.enlace)}.\n`);
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
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  process.on('SIGINT', () => { console.error('\n  ! Interrumpido. Corra el seco para ver el estado.\n'); process.exit(130); });
  const codigo = await ejecutar(cfg, { db });
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
