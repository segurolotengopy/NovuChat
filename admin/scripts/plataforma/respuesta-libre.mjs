/**
 * ESCRIBIR `tenants/{id}/config/respuestaLibre` DE UN SOLO COMERCIO — seco por omisión.
 *
 * QUÉ ES. El dato por tenant de la «respuesta coherente» (PR B): `activo`, `acuse`, `textoSeguimiento`, `textoRechazo`,
 * `textoHumor` y `textoQueja`. Lo escribe NovuChat desde Plataforma: `firestore.rules` no deja que ningún navegador
 * lo escriba (ninguna rama de escritura lo nombra), y `configuracionFlujo` lo entrega al flujo solo con `activo: true`.
 * Los valores de cada comercio viven versionados en `scripts/datos/respuesta-libre/<nombre>.json` (sin identificadores
 * ni teléfonos; son textos del asistente, no secretos).
 *
 *   node scripts/plataforma/respuesta-libre.mjs --proyecto <id> --tenant <id> --datos <nombre> \
 *        [--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]
 *   node scripts/plataforma/respuesta-libre.mjs --proyecto <id> --tenant <id> --apagar \
 *        [--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]
 *
 * QUÉ HACE.
 *   · SECO (sin `--aplicar`): lee el comercio y `config/respuestaLibre`, imprime qué cambiaría (campos y LARGOS, nunca
 *     los textos) y no escribe.
 *   · `--aplicar`: exige `--respaldo` (ruta absoluta, fuera de todo repositorio, carpeta 0700, archivo 0600, nunca se
 *     pisa) con el valor previo (o su ausencia), y recién entonces UNA escritura del documento, con precondición.
 *     Relee y compara. Deshacer = `--apagar` (deja `activo: false`: el flujo vuelve a la respuesta de siempre).
 *   · El archivo de datos pasa por el MISMO saneo que usa el servidor (`sanearRespuestaLibre`): si el saneo cambiaría
 *     algo (texto largo, tipo equivocado, campo faltante), se rechaza con salida 2 sin tocar nada.
 *   · IDEMPOTENTE: si ya está escrito igual, sale con 0 sin escribir.
 *
 * SALVAGUARDA DE PROYECTO. La misma de `aplicar-consola-oculta.mjs` (lista blanca por variables de entorno; contra
 * PRODUCCIÓN, `--aplicar` exige `--confirmo-produccion <tenant>` igual a `--tenant`). Salida 0: sin diferencias o
 * escritura comprobada. 1: el seco encontró diferencias. 2: uso o salvaguarda. 3: error de ejecución.
 *
 * COSTO. Seco: dos lecturas. `--aplicar`: tres lecturas y UNA escritura. 0 mensajes por conversación. NO se corre contra
 * producción sin el «sí» de Andres, cliente por cliente.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comprobarProyecto, comprobarRespaldo, guardarRespaldo } from './aplicar-consola-oculta.mjs';
import { sanearRespuestaLibre } from '../../functions/src/core/conversacion/respuestaLibre.ts';

const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const ID_DATOS = /^[a-z0-9][a-z0-9-]{1,40}$/;
const CON_VALOR = ['proyecto', 'tenant', 'datos', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'apagar'];
const TEXTOS = ['acuse', 'textoSeguimiento', 'textoRechazo', 'textoHumor', 'textoQueja'];
const CAMPOS = ['activo', ...TEXTOS];
const DIRECTORIO_DATOS = join(dirname(fileURLToPath(import.meta.url)), '..', 'datos', 'respuesta-libre');

export const USO = '  node scripts/plataforma/respuesta-libre.mjs --proyecto <id> --tenant <id> (--datos <nombre> | --apagar) '
  + '[--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]';

/** Lee `datos/respuesta-libre/<nombre>.json` y exige que el saneo del servidor no cambie nada. Devuelve `{ok, valor|motivo}`. */
export function cargarDatos(nombre, directorio = DIRECTORIO_DATOS) {
  if (!ID_DATOS.test(nombre)) return { ok: false, motivo: '--datos inválido (minúsculas, dígitos y guiones)' };
  let crudo;
  try {
    crudo = JSON.parse(readFileSync(join(directorio, `${nombre}.json`), 'utf8'));
  } catch {
    return { ok: false, motivo: `no se pudo leer scripts/datos/respuesta-libre/${nombre}.json` };
  }
  return validarDatos(crudo);
}

export function validarDatos(crudo) {
  const saneado = sanearRespuestaLibre(crudo);
  if (saneado === null) return { ok: false, motivo: 'los datos deben traer `activo: true`' };
  if (crudo === null || typeof crudo !== 'object') return { ok: false, motivo: 'los datos no son un objeto' };
  const presentes = Object.keys(crudo);
  if (presentes.some((k) => !CAMPOS.includes(k))) return { ok: false, motivo: 'los datos traen campos que no son de este documento' };
  const faltan = TEXTOS.filter((k) => saneado[k] === undefined);
  if (faltan.length) return { ok: false, motivo: `faltan textos válidos: ${faltan.join(', ')}` };
  if (JSON.stringify(saneado) !== JSON.stringify({ activo: true, ...Object.fromEntries(TEXTOS.map((k) => [k, crudo[k]])) })) {
    return { ok: false, motivo: 'el saneo del servidor cambiaría los datos (texto largo, vacío o de otro tipo): corríjalos' };
  }
  return { ok: true, valor: saneado };
}

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
  const apagar = banderas.includes('apagar');
  const { proyecto, tenant, respaldo, datos } = valores;
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

  let deseado = null;
  if (apagar && datos !== undefined) problemas.push('--apagar no admite --datos');
  else if (!apagar && datos === undefined) problemas.push('falta --datos <nombre> (o --apagar)');
  else if (!apagar) {
    const c = cargarDatos(datos, opciones.directorioDatos);
    if (c.ok) deseado = c.valor; else problemas.push(c.motivo);
  } else deseado = { activo: false };

  if (aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta> (por omisión no hay respaldo)');
  let respaldoReal = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, permitirExistente: true });
    if (r.ok) respaldoReal = respaldo; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, deseado, apagar, aplicar, respaldo: respaldoReal } };
}

const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';

/** Los campos del documento que importan, en orden fijo, para comparar y para el respaldo. */
const extraer = (snap) => {
  if (!snap.exists) return null;
  const o = {};
  for (const k of CAMPOS) { const v = snap.get(k); if (v !== undefined) o[k] = v; }
  return o;
};
const igualA = (actual, deseado) => actual !== null && CAMPOS.every((k) => JSON.stringify(actual[k]) === JSON.stringify(deseado[k]))
  && Object.keys(deseado).every((k) => JSON.stringify(actual[k]) === JSON.stringify(deseado[k]));

/** Para imprimir: nunca los textos, solo su largo. */
export const resumen = (v) => (v === null ? 'AUSENTE'
  : CAMPOS.filter((k) => v[k] !== undefined).map((k) => {
    const x = v[k];
    return `${k}=${typeof x === 'string' ? `${Array.from(x).length} car.` : Array.isArray(x) ? `${x.length} frases` : String(x)}`;
  }).join(', '));

/** Devuelve el código de salida. `deps`: `{ db, log }`. Importable para probar con una base en memoria. */
export async function ejecutar(cfg, deps) {
  const { db } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const rotulo = `${cfg.entorno} · tenant ${cfg.tenant}`;
  const ficha = db.doc(`tenants/${cfg.tenant}`);
  const ref = db.doc(`tenants/${cfg.tenant}/config/respuestaLibre`);

  const [fsnap] = await db.getAll(ficha, { fieldMask: ['estado'] });
  if (!fsnap.exists) { log(`\n  ✗ ${cfg.tenant}: no existe el comercio (${cfg.entorno})\n`); return 1; }
  const [snap] = await db.getAll(ref, { fieldMask: CAMPOS });
  const hoy = extraer(snap);

  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)'} · ${rotulo}\n`);
  log(`  documento hoy      : ${resumen(hoy)}`);
  log(`  documento después  : ${resumen(cfg.deseado)}`);

  const igual = cfg.apagar ? hoy !== null && hoy.activo === false : igualA(hoy, cfg.deseado);
  if (igual) { log('\n  ✓ Ya está así: nada que hacer.\n'); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (y --respaldo) para escribir.\n'); return 1; }

  try {
    guardarRespaldo(cfg.respaldo, {
      version: 1, entorno: cfg.entorno, tenant: cfg.tenant, creadoEn: new Date().toISOString(),
      previo: { presente: snap.exists, valor: hoy },
    });
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa; elija otro nombre. No se escribe nada.\n'); return 2; }
    throw e;
  }
  log(`\n  Respaldo guardado y releído: ${cfg.respaldo}`);

  try {
    if (snap.exists) await ref.update(cfg.deseado, { lastUpdateTime: snap.updateTime });
    else await ref.create(cfg.deseado);
  } catch (e) {
    if (esPrecondicion(e) || e?.code === 6 || e?.code === 'already-exists' || e?.code === 5 || e?.code === 'not-found') {
      log('\n  ✗ El documento cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr el seco.\n');
      return 3;
    }
    throw e;
  }
  const [despues] = await db.getAll(ref, { fieldMask: CAMPOS });
  const leido = extraer(despues);
  const bien = cfg.apagar ? leido !== null && leido.activo === false : igualA(leido, cfg.deseado);
  if (!bien) { log('\n  ✗ La relectura no coincide con lo escrito. Revise con el seco; el respaldo guarda el valor previo.\n'); return 3; }
  log(`\n  ✓ Escrito y releído: ${resumen(cfg.deseado)}.\n`);
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
