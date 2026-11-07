#!/usr/bin/env node
/**
 * desactivar-productos.mjs — pone `activo: false` en productos NOMBRADOS de `tenants/<t>/catalogo`, sin borrar. SECO por omisión.
 *
 * POR QUÉ. `cargar-negocio.mjs` no retira lo que el archivo no nombra, y retirar es decisión de la consola. El 07/11/2026 el catálogo nuevo de
 * Rubén («Noches Sin Insomnio») quedó cargado, pero seguían activos tres productos del libro anterior (`closer-ventas`, `libro-bonos`,
 * `videos-ia`): el asistente podía ofrecerlos. Andres decidió desactivar, no borrar. Es el inverso de `habilitar-productos.mjs`, que se toma
 * de modelo (seco, salvaguarda de proyecto, respaldo con `guardarRespaldo`, precondición de la hora leída, relectura y reversa).
 *
 *   node scripts/plataforma/desactivar-productos.mjs --proyecto <id> --tenant rroca-ruben --ids closer-ventas,libro-bonos,videos-ia \
 *        [--aplicar --respaldo <ruta> --confirmo-produccion rroca-ruben]
 *   node scripts/plataforma/desactivar-productos.mjs --proyecto <id> --tenant rroca-ruben --revertir --respaldo <ruta> \
 *        [--aplicar --confirmo-produccion rroca-ruben]
 *
 * LÍMITES. Lista cerrada de comercios (`TENANTS_PERMITIDOS`) y de ids por comercio (`IDS_PERMITIDOS`): un id fuera de la lista se rechaza.
 * Solo escribe el campo `activo` con `update` (nunca borra ni crea documentos, nunca toca otros campos). `--aplicar` exige `--respaldo`
 * (ruta absoluta fuera de todo repositorio) y, contra producción, `--confirmo-produccion <tenant>`. La reversa solo devuelve a `true`
 * lo que hoy está en `false` y está en el respaldo. Nunca imprime el id del proyecto real.
 * Salida: 0 hecho o sin diferencias · 1 el seco encontró diferencias · 2 uso o salvaguarda · 3 error de ejecución.
 * Costo: 0 mensajes por conversación; seco = una lectura por id; aplicar = N escrituras de un campo.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { comprobarProyecto, comprobarRespaldo } from './aplicar-consola-oculta.mjs';
import { guardarRespaldo } from './habilitar-productos.mjs';

export const TENANTS_PERMITIDOS = Object.freeze(['rroca-ruben']);
export const IDS_PERMITIDOS = Object.freeze({ 'rroca-ruben': Object.freeze(['closer-ventas', 'libro-bonos', 'videos-ia']) });
const CON_VALOR = ['proyecto', 'tenant', 'ids', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];

export function analizarArgumentos(argv, env = process.env) {
  const problemas = [];
  const v = { __proto__: null };
  const b = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (typeof a !== 'string' || !a.startsWith('--')) { problemas.push('argumento suelto'); continue; }
    const n = a.slice(2);
    if (BANDERAS.includes(n)) { if (b.includes(n)) problemas.push(`opción repetida: --${n}`); b.push(n); }
    else if (CON_VALOR.includes(n)) {
      if (n in v) problemas.push(`opción repetida: --${n}`);
      const x = argv[i + 1];
      if (x === undefined || x.startsWith('--')) { problemas.push(`--${n} sin valor`); continue; }
      v[n] = x; i += 1;
    } else problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40)}`);
  }
  const aplicar = b.includes('aplicar');
  const revertir = b.includes('revertir');
  const { proyecto, tenant, respaldo } = v;
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto === undefined) problemas.push('falta --proyecto'); else if (!proy.ok) problemas.push(proy.motivo);
  if (tenant === undefined) problemas.push('falta --tenant');
  else if (!TENANTS_PERMITIDOS.includes(tenant)) problemas.push(`--tenant fuera de la lista cerrada (${TENANTS_PERMITIDOS.join(', ')})`);
  let ids = [];
  if (!revertir) {
    if (v.ids === undefined) problemas.push('falta --ids');
    else {
      ids = v.ids.split(',');
      const permitidos = IDS_PERMITIDOS[tenant] ?? [];
      if (ids.some((x) => !permitidos.includes(x)) || new Set(ids).size !== ids.length) problemas.push(`--ids: solo ids de la lista cerrada y sin repetir (${permitidos.join(', ')})`);
    }
  } else if (v.ids !== undefined) problemas.push('--revertir no lleva --ids: sale del respaldo');
  const confirmo = v['confirmo-produccion'];
  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) problemas.push('contra producción, --aplicar exige --confirmo-produccion <tenant>');
  if ((aplicar || revertir) && respaldo === undefined) problemas.push('falta --respaldo <ruta>');
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { lectura: revertir, permitirExistente: false });
    if (!r.ok) problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, ids, aplicar, revertir, respaldo: respaldo ?? null } };
}

/** Puro. Qué hay que escribir: los nombrados que hoy están en `true` (y existen). */
export function planear(ids, leidos) {
  const aDesactivar = [];
  const yaInactivos = [];
  const noExisten = [];
  const noReconocidos = [];
  for (const id of ids) {
    const it = leidos.get(id);
    if (!it) noExisten.push(id);
    else if (it.activo === true) aDesactivar.push(id);
    else if (it.activo === false || it.activo === null || it.activo === undefined) yaInactivos.push(id);
    else noReconocidos.push(id);
  }
  return { aDesactivar, yaInactivos, noExisten, noReconocidos };
}

/** Lee un respaldo propio: 0600, del usuario, no enlace, con la forma exacta. */
export function leerRespaldoPropio(ruta, { entorno, tenant }) {
  let fd;
  try {
    fd = openSync(ruta, constants.O_RDONLY | constants.O_NOFOLLOW);
    const s = fstatSync(fd);
    if (!s.isFile() || (s.mode & 0o077) !== 0 || s.size > 65536) return { ok: false, motivo: 'el respaldo no es un archivo regular 0600 razonable' };
    if (typeof process.getuid === 'function' && s.uid !== process.getuid()) return { ok: false, motivo: 'el respaldo no es del usuario' };
    const r = JSON.parse(readFileSync(fd, 'utf8'));
    if (r?.version !== 1 || r.tenant !== tenant || r.entorno !== entorno || !Array.isArray(r.items)) return { ok: false, motivo: 'el respaldo es de otro comercio o entorno, o no tiene la forma esperada' };
    const permitidos = IDS_PERMITIDOS[tenant] ?? [];
    const ids = r.items.map((x) => x?.id);
    if (ids.some((x) => !permitidos.includes(x)) || new Set(ids).size !== ids.length || r.items.some((x) => x?.previo !== true)) {
      return { ok: false, motivo: 'el respaldo nombra ids fuera de la lista cerrada, repetidos, o un valor previo distinto de true' };
    }
    return { ok: true, ids };
  } catch {
    return { ok: false, motivo: 'el respaldo no se pudo abrir ni leer' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const ruta = (t) => `tenants/${t}/catalogo`;
const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';

export async function ejecutar(cfg, { db, log = (t) => console.log(t) }) {
  const rotulo = `${cfg.entorno} · tenant ${cfg.tenant}`;
  const leer = async (ids) => {
    const m = new Map();
    for (const id of ids) {
      const d = await db.doc(`${ruta(cfg.tenant)}/${id}`).get();
      if (d.exists) m.set(id, { activo: d.get('activo'), nombre: d.get('nombre'), updateTime: d.updateTime, ref: d.ref });
    }
    return m;
  };
  const escribir = async (lista, valor, m) => {
    let hechas = 0;
    for (const id of lista) {
      try { await m.get(id).ref.update({ activo: valor }, { lastUpdateTime: m.get(id).updateTime }); hechas += 1; }
      catch (e) {
        log(`\n  ✗ ${esPrecondicion(e) ? 'un ítem cambió entre la lectura y la escritura' : `error de escritura (${e?.code ?? e?.name ?? 'desconocido'})`}: se escribieron ${hechas} de ${lista.length}. Corra el seco${hechas ? '; para deshacer, --revertir con el mismo respaldo' : ''}.\n`);
        return 3;
      }
    }
    return null;
  };

  if (cfg.revertir) {
    const r = leerRespaldoPropio(cfg.respaldo, cfg);
    if (!r.ok) { log(`\n  ✗ ${r.motivo}\n`); return 2; }
    const m = await leer(r.ids);
    const aRevertir = r.ids.filter((id) => m.get(id)?.activo === false);
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO'} · ${rotulo}\n  ítems del respaldo: ${r.ids.length} · se vuelven a activar: ${aRevertir.length}`);
    if (!aRevertir.length) { log('\n  ✓ Nada que revertir.\n'); return 0; }
    if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar.\n'); return 1; }
    const f = await escribir(aRevertir, true, m);
    if (f !== null) return f;
    const d = await leer(aRevertir);
    if (!aRevertir.every((id) => d.get(id)?.activo === true)) { log('\n  ✗ La relectura no coincide. Revise con el seco.\n'); return 3; }
    log(`\n  ✓ Revertido: ${aRevertir.length} ítem(s) vuelven a estar activos.\n`);
    return 0;
  }

  const m = await leer(cfg.ids);
  const p = planear(cfg.ids, m);
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)'} · ${rotulo}\n`);
  for (const id of p.aDesactivar) log(`  se desactiva : ${id} (${String(m.get(id).nombre ?? '(sin nombre)').slice(0, 60)}) true -> false`);
  for (const id of p.yaInactivos) log(`  ya inactivo  : ${id}`);
  for (const id of p.noExisten) log(`  ✗ no existe  : ${id}`);
  for (const id of p.noReconocidos) log(`  ✗ valor de «activo» no reconocido, no se toca: ${id}`);
  if (p.noExisten.length || p.noReconocidos.length) { log('\n  ✗ Hay ids que no existen o con valor raro: no se escribe nada.\n'); return 2; }
  if (!p.aDesactivar.length) { log('\n  ✓ Nada que desactivar.\n'); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar --respaldo <ruta> --confirmo-produccion <tenant>.\n'); return 1; }
  guardarRespaldo(cfg.respaldo, { version: 1, entorno: cfg.entorno, tenant: cfg.tenant, creadoEn: new Date().toISOString(), items: p.aDesactivar.map((id) => ({ id, previo: true })) });
  const f = await escribir(p.aDesactivar, false, m);
  if (f !== null) return f;
  const d = await leer(p.aDesactivar);
  if (!p.aDesactivar.every((id) => d.get(id)?.activo === false)) { log('\n  ✗ La relectura no coincide. Revise con el seco.\n'); return 3; }
  log(`\n  ✓ Desactivados: ${p.aDesactivar.length} ítem(s); relectura coincide. Deshacer: --revertir con el mismo respaldo.\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const a = analizarArgumentos(process.argv.slice(2));
  if (!a.ok) { console.error(`\n  ✗ ${a.problemas.join('\n  ✗ ')}\n`); process.exit(2); }
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: a.cfg.proyecto });
  process.exit(await ejecutar(a.cfg, { db: getFirestore() }));
}
