/**
 * RESETEAR EL ESTADO DE CONVERSACIÓN DEL SERVIDOR DE UN TELÉFONO DE PRUEBA (flujo venta-minima, Q'Taco) — seco por omisión.
 *
 * PARA QUÉ. Desde PR-4a/PR-4b el estado de venta-minima (paso, carrito, pedidos del teléfono, reservas del día) ya no vive en el
 * `staticData` de n8n sino en Firestore (contrato: docs/arquitectura/estado-de-conversacion.md §5), así que `resetear-ficha-flujo.mjs` no
 * alcanza. Para volver a probar «como cliente nuevo» con un teléfono de prueba hay que borrar lo que el servidor guarda de ESE teléfono.
 *
 * QUÉ BORRA (solo bajo `tenants/{tenant}`; una pasada por colección; nunca bajo `conversaciones` ni `metricas`):
 *   · `sesionesDeTurno/{pnid}~{espacio}~wa_{tel}` con espacio `venta-minima` o `venta-minima-prueba`: el bloque por teléfono (estado, pedidos y
 *     `reservas` del día: el cupo de reservas por teléfono vive DENTRO de este documento, PR-4b).
 *   · `cuposDeTurno/{pnid}~{clave}~wa_{tel}~{periodo}` con clave `transferencias` o `pedidos` (cupos por contacto y hora de PR-4b).
 *   En ambos, el prefijo del id (`pnid`) tiene que ser igual al campo `phoneNumberId` del propio documento.
 *
 * QUÉ NO BORRA, Y POR QUÉ.
 *   · `vistosDeTurno` (mensajes ya vistos): su id es `sha256(pnid|idMensaje)`, sin el teléfono: no se puede atar a un teléfono. Vencen a las 24 h
 *     y solo marcan el id de un mensaje concreto de Meta; un mensaje nuevo trae otro id, así que no impide probar de nuevo.
 *   · Cupos del COMERCIO (`avisos`, alcance `_`): son de todos los contactos, no de este teléfono (el ledger `por` de cada uno guarda el teléfono,
 *     pero devolver cupo del comercio es asunto de `asentar`, no de un reseteo).
 *   · Sesiones de otros espacios del mismo teléfono (por ejemplo, el chat) y las efímeras `vmc-…`/`vmcp-…` (solo cupos, vencen a 1 minuto):
 *     se cuentan como «de otros espacios» y no se tocan.
 *   · Otra forma de clave del mismo teléfono (`wa_+{tel}`, el exacto en un id mal formado, o sin código de país): «posibles restos»,
 *     se informan sin imprimirlos y no se borran. Un teléfono vecino (mismo prefijo o sufijo, pero otro número) es ajeno y no se toca nunca.
 *   · El `staticData` de n8n (eso es `resetear-ficha-flujo.mjs`) y las marcas locales de caída (`av.dia`, `transferencias`, `avisosPedido`).
 *
 * LISTA CERRADA. El repositorio es público: los teléfonos de prueba NO están en el código. Se leen de `TELEFONOS_PRUEBA` (dígitos separados por
 * coma) y `--tel` tiene que estar en ella. El tenant es de una lista cerrada (`TENANTS_PERMITIDOS`).
 *
 *   TELEFONOS_PRUEBA=… GCP_PROJECT_ID_STAGING=… GCP_PROJECT_ID_PROD=… node scripts/plataforma/resetear-estado-turno.mjs \
 *        --proyecto <id> --tenant qtaco --tel <dígitos> [--aplicar --respaldo <ruta absoluta> --confirmo-produccion qtaco]
 *   … --revertir --respaldo <ruta> --proyecto <id> --tenant qtaco --tel <dígitos> [--aplicar --confirmo-produccion qtaco]
 *
 * SECO: informa cuántos documentos se borrarían por colección. Nunca imprime teléfonos, ids ni contenido.
 * `--aplicar`: exige `--respaldo` (ruta absoluta, carpeta 0700, archivo 0600, fuera de todo repositorio, nunca se pisa; guarda los documentos
 * COMPLETOS, que contienen datos de personas: se destruye al cerrar la prueba) y, contra producción, `--confirmo-produccion <tenant>`.
 * Relee justo antes de escribir (si algo cambió, no escribe), guarda el respaldo, borra cada documento con la precondición de la hora leída,
 * relee y verifica que no quede ninguno y que nada más haya cambiado.
 * `--revertir --aplicar`: recrea los documentos del respaldo (`create`: si ya existe uno, no lo pisa). Un estado vencido que se repone lo limpia el TTL.
 * AVISO: borrar el estado a mitad de una conversación real la reinicia; úselo solo con los teléfonos de prueba y sin tráfico de ese teléfono.
 *
 * SALIDA. 0 hecho o nada que hacer; 1 el seco encontró documentos; 2 uso o salvaguarda; 3 error de ejecución; 130 Ctrl-C.
 * COSTO. Seco: lecturas de dos colecciones del tenant (solo `phoneNumberId`). `--aplicar`: dos lecturas más, N lecturas completas, N borrados y una
 * relectura. 0 mensajes por conversación. NO se corre contra producción sin el «sí» de Andres.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { comprobarProyecto, comprobarRespaldo } from './aplicar-consola-oculta.mjs';
import { guardarRespaldo } from './habilitar-productos.mjs';
import { leerRespaldoGenerico } from './aplicar-consola-conversaciones.mjs';

export const TENANTS_PERMITIDOS = Object.freeze(['qtaco']);
export const ESPACIOS_SESION = Object.freeze(['venta-minima', 'venta-minima-prueba']);
export const CLAVES_CUPO = Object.freeze(['transferencias', 'pedidos']);
export const COLECCIONES = Object.freeze(['sesionesDeTurno', 'cuposDeTurno']);
export const MAX_ESCANEO = 20000;
export const MAX_DOCUMENTOS = 200;
const CAMPO = 'resetear-estado-turno';
const CON_VALOR = ['proyecto', 'tenant', 'tel', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];

export const USO = '  node scripts/plataforma/resetear-estado-turno.mjs --proyecto <id> --tenant qtaco --tel <dígitos> '
  + '[--aplicar --respaldo <ruta> --confirmo-produccion qtaco]\n'
  + '  node scripts/plataforma/resetear-estado-turno.mjs --revertir --respaldo <ruta> --proyecto <id> --tenant qtaco --tel <dígitos> '
  + '[--aplicar --confirmo-produccion qtaco]\n'
  + `  (con TELEFONOS_PRUEBA, GCP_PROJECT_ID_STAGING y GCP_PROJECT_ID_PROD en el entorno; tenants permitidos: ${TENANTS_PERMITIDOS.join(', ')})`;

export function analizarArgumentos(argv, env = process.env, opciones = {}) {
  const problemas = [];
  const valores = { __proto__: null };
  const banderas = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string' || !a.startsWith('--')) { problemas.push('argumento suelto (sin su opción)'); continue; }
    const n = a.slice(2);
    if (BANDERAS.includes(n)) { if (banderas.includes(n)) problemas.push(`opción repetida: --${n}`); banderas.push(n); }
    else if (CON_VALOR.includes(n)) {
      if (n in valores) problemas.push(`opción repetida: --${n}`);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) { problemas.push(`--${n} sin valor`); continue; }
      valores[n] = v; i += 1;
    } else problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40)}`);
  }
  const aplicar = banderas.includes('aplicar');
  const revertir = banderas.includes('revertir');
  const { proyecto, tenant, tel, respaldo } = valores;
  const confirmo = valores['confirmo-produccion'];

  if (proyecto === undefined) problemas.push('falta --proyecto');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto !== undefined && !proy.ok) problemas.push(proy.motivo);

  if (tenant === undefined) problemas.push('falta --tenant');
  else if (!TENANTS_PERMITIDOS.includes(tenant)) problemas.push(`--tenant fuera de la lista cerrada (${TENANTS_PERMITIDOS.join(', ')})`);

  // Lista cerrada de teléfonos: del entorno (el repositorio es público). Sin ella no se corre; --tel tiene que estar adentro.
  const crudo = env.TELEFONOS_PRUEBA;
  let lista = [];
  if (typeof crudo !== 'string' || crudo.trim() === '') problemas.push('falta TELEFONOS_PRUEBA en el entorno (lista cerrada de teléfonos de prueba, dígitos separados por coma)');
  else {
    lista = crudo.split(',').map((s) => s.trim());
    if (lista.some((s) => !/^\d{8,15}$/.test(s))) { problemas.push('TELEFONOS_PRUEBA: solo dígitos (8 a 15) separados por coma'); lista = []; }
  }
  if (tel === undefined) problemas.push('falta --tel <dígitos>');
  else if (!/^\d{8,15}$/.test(tel)) problemas.push('--tel: solo dígitos (8 a 15)');
  else if (lista.length && !lista.includes(tel)) problemas.push('--tel no está en la lista cerrada de teléfonos de prueba');

  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) {
    problemas.push('contra producción, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  }
  if (revertir && respaldo === undefined) problemas.push('--revertir exige --respaldo <ruta>');
  if (!revertir && aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta absoluta> (0600, fuera del repositorio)');
  let respaldoReal = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: revertir, permitirExistente: false });
    if (r.ok) respaldoReal = respaldo; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, tel, aplicar, revertir, respaldo: respaldoReal } };
}

/**
 * Puro: ¿qué hacer con un documento? `coleccion` ∈ COLECCIONES; `id`; `phoneNumberId` (campo del documento).
 * Devuelve 'borrar' (forma exacta, de este teléfono y de venta-minima), 'otro' (de este teléfono pero de otro espacio o clave: no se toca),
 * 'resto' (posible resto: otra forma de clave del mismo teléfono, o su `phoneNumberId` no coincide: no se toca) o 'ajeno'.
 */
export function clasificar(coleccion, id, phoneNumberId, tel) {
  const partes = String(id).split('~');
  const exacto = `wa_${tel}`;
    const esperadas = coleccion === 'sesionesDeTurno' ? 3 : 4;
  if (partes.length === esperadas && partes[2] === exacto) {
    if (typeof phoneNumberId !== 'string' || phoneNumberId !== partes[0]) return 'resto';
    if (coleccion === 'sesionesDeTurno') return ESPACIOS_SESION.includes(partes[1]) ? 'borrar' : 'otro';
    return CLAVES_CUPO.includes(partes[1]) ? 'borrar' : 'otro';
  }
  // Posibles restos = OTRA FORMA DE CLAVE del mismo teléfono: la forma exacta en un id mal formado, con «+» o con otro agregado, o el teléfono
  // sin el código de país (los 8 o más últimos dígitos, más corto que el completo). Un teléfono distinto —aunque comparta prefijo o sufijo— es ajeno.
  for (const seg of partes.slice(1)) {
    if (seg === exacto) return 'resto';
    const d = seg.replace(/\D/g, '');
    if (d !== '' && (d === tel || (d.length >= 8 && d.length < tel.length && tel.endsWith(d)))) return 'resto';
  }
  return 'ajeno';
}

const esObjeto = (v) => v !== null && typeof v === 'object';
const rutaColeccion = (tenant, c) => `tenants/${tenant}/${c}`;
const sello = (t) => (t && typeof t.toDate === 'function' ? t.toDate().toISOString() : String(t ?? ''));

/** Una lectura barata de cada colección (solo `phoneNumberId`) y su clasificación. No devuelve contenido. */
export async function escanear(db, tenant, tel) {
  const r = { borrar: [], otro: 0, resto: 0, porColeccion: {} };
  for (const c of COLECCIONES) {
    const s = await db.collection(rutaColeccion(tenant, c)).select('phoneNumberId').limit(MAX_ESCANEO + 1).get();
    if (s.docs.length > MAX_ESCANEO) throw Object.assign(new Error('escaneo'), { code: 'escaneo-demasiado-grande' });
    r.porColeccion[c] = 0;
    for (const d of s.docs) {
      const k = clasificar(c, d.id, d.get ? d.get('phoneNumberId') : d.data?.()?.phoneNumberId, tel);
      if (k === 'borrar') { r.borrar.push({ coleccion: c, id: d.id, ref: d.ref, sello: sello(d.updateTime), updateTime: d.updateTime }); r.porColeccion[c] += 1; }
      else if (k === 'otro') r.otro += 1;
      else if (k === 'resto') r.resto += 1;
    }
  }
  return r;
}

const clave = (b) => b.map((x) => `${x.coleccion}/${x.id}@${x.sello}`).sort().join('|');

/** Los documentos de `borrar` se codifican para el respaldo: las fechas de Firestore pasan a `{ __ts: ISO }` y vuelven al revertir. */
export const codificar = (v) => {
  if (v && typeof v.toDate === 'function') return { __ts: v.toDate().toISOString() };
  if (v instanceof Date) return { __ts: v.toISOString() };
  if (Array.isArray(v)) return v.map(codificar);
  if (esObjeto(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, codificar(x)]));
  return v;
};
export const decodificar = (v) => {
  if (Array.isArray(v)) return v.map(decodificar);
  if (esObjeto(v)) {
    const k = Object.keys(v);
    if (k.length === 1 && k[0] === '__ts' && typeof v.__ts === 'string' && !Number.isNaN(Date.parse(v.__ts))) return new Date(v.__ts);
    return Object.fromEntries(Object.entries(v).map(([n, x]) => [n, decodificar(x)]));
  }
  return v;
};

export function leerRespaldo(ruta, { entorno, tenant, tel }) {
  const l = leerRespaldoGenerico(ruta, { limite: 4 * 1024 * 1024 });
  if (!l.ok) return l;
  const r = l.respaldo;
  if (r?.version !== 1 || r.campo !== CAMPO || !Array.isArray(r.docs)) return { ok: false, motivo: 'el respaldo no tiene la forma esperada' };
  if (r.tenant !== tenant) return { ok: false, motivo: 'el respaldo es de otro comercio' };
  if (r.entorno !== entorno) return { ok: false, motivo: 'el respaldo es de otro entorno (staging, produccion o emulador)' };
  if (r.docs.length > MAX_DOCUMENTOS) return { ok: false, motivo: 'el respaldo trae demasiados documentos' };
  const vistos = new Set();
  for (const d of r.docs) {
    const ok = esObjeto(d) && COLECCIONES.includes(d.coleccion) && typeof d.id === 'string' && esObjeto(d.data) && !Array.isArray(d.data)
      && clasificar(d.coleccion, d.id, d.data.phoneNumberId, tel) === 'borrar' && !vistos.has(`${d.coleccion}/${d.id}`);
    if (!ok) return { ok: false, motivo: 'el respaldo trae un documento que no es de ese teléfono y de venta-minima (o está repetido)' };
    vistos.add(`${d.coleccion}/${d.id}`);
  }
  return { ok: true, docs: r.docs };
}

const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';

export function mensajeDeInterrupcion(estado) {
  if (estado === 'antes') return '\n  ! Interrumpido por el operador antes de escribir. No se escribió nada.\n';
  if (estado === 'escrito') return '\n  ! Interrumpido entre escrituras: algunas SÍ se hicieron. Corra el seco; para deshacer, --revertir con el mismo respaldo.\n';
  return '\n  ! Interrumpido DURANTE una escritura: puede haberse hecho o no. Corra el seco para ver el estado.\n';
}

function resumenSeco(log, e, rotulo) {
  log(`\n  ${rotulo}`);
  for (const c of COLECCIONES) log(`    ${c}: ${e.porColeccion[c]} documento(s) del teléfono`);
  log(`  de otros espacios o claves del mismo teléfono (no se tocan): ${e.otro}`);
  log(`  posibles restos (otra forma de clave, no se borran): ${e.resto}`);
  log('  vistosDeTurno: no se puede atar a un teléfono (id con hash); vencen a las 24 h y no impiden probar de nuevo');
}

/** deps = { db, log?, marcarEscritura? }. Devuelve el código de salida. */
export async function ejecutar(cfg, deps) {
  const { db } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const marcar = deps.marcarEscritura ?? (() => {});
  return cfg.revertir ? revertir(cfg, db, log, marcar) : borrar(cfg, db, log, marcar);
}

async function borrar(cfg, db, log, marcar) {
  const e1 = await escanear(db, cfg.tenant, cfg.tel);
  resumenSeco(log, e1, `${cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)'} · ${cfg.entorno} · tenant ${cfg.tenant}`);
  if (e1.borrar.length === 0) { log(e1.resto > 0 ? '\n  ⚠ Nada que borrar con el teléfono exacto, pero hay posibles restos: revíselos.\n' : '\n  ✓ Nada que borrar.\n'); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar --respaldo <ruta> (y --confirmo-produccion <tenant> contra producción).\n'); return 1; }
  if (e1.borrar.length > MAX_DOCUMENTOS) { log(`\n  ✗ Hay más de ${MAX_DOCUMENTOS} documentos del teléfono: no es un reseteo de prueba. No se escribió nada.\n`); return 3; }

  // Relectura justo antes de escribir: mismos documentos y misma hora de actualización, o no se escribe.
  const e2 = await escanear(db, cfg.tenant, cfg.tel);
  if (clave(e1.borrar) !== clave(e2.borrar)) { log('\n  ✗ El estado cambió entre la lectura y la escritura (hay tráfico de ese teléfono): no se escribió nada. Vuelva a correrlo.\n'); return 3; }
  const completos = await db.getAll(...e2.borrar.map((b) => b.ref));
  const respaldo = [];
  for (let i = 0; i < completos.length; i++) {
    const s = completos[i]; const b = e2.borrar[i];
    if (!s.exists || sello(s.updateTime) !== b.sello) { log('\n  ✗ Un documento cambió o desapareció al leerlo completo: no se escribió nada. Vuelva a correrlo.\n'); return 3; }
    respaldo.push({ coleccion: b.coleccion, id: b.id, data: codificar(s.data()) });
  }
  try {
    guardarRespaldo(cfg.respaldo, { version: 1, campo: CAMPO, entorno: cfg.entorno, tenant: cfg.tenant, creadoEn: new Date().toISOString(), docs: respaldo });
  } catch (err) {
    if (err?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa. No se escribe nada.\n'); return 2; }
    throw err;
  }
  log(`\n  Respaldo de los documentos COMPLETOS (datos de personas, se destruye al cerrar la prueba): ${cfg.respaldo}`);

  let hechas = 0;
  for (const b of e2.borrar) {
    marcar('escribiendo');
    try {
      await b.ref.delete({ lastUpdateTime: b.updateTime });
      hechas += 1; marcar('escrito');
    } catch (err) {
      marcar(hechas === 0 ? 'antes' : 'escrito');
      const causa = esPrecondicion(err) ? 'un documento cambió entre la lectura y el borrado' : `error de escritura (${err?.code ?? err?.name ?? 'desconocido'})`;
      log(hechas === 0 ? `\n  ✗ ${causa}: no se borró nada.\n` : `\n  ✗ ${causa}: SÍ se borraron ${hechas} de ${e2.borrar.length}. Corra el seco; para deshacer, --revertir con el mismo respaldo.\n`);
      return 3;
    }
  }
  const e3 = await escanear(db, cfg.tenant, cfg.tel);
  const igualRestos = e3.otro === e2.otro && e3.resto === e2.resto;
  log(`  Borrados: ${hechas} · quedan ${e3.borrar.length} del teléfono · el resto de los documentos igual=${igualRestos}`);
  if (e3.borrar.length !== 0 || !igualRestos) { log('\n  ✗ La verificación no coincide (¿una conversación de ese teléfono escribió justo en medio?): revise; el respaldo permite reponer.\n'); return 3; }
  log(e3.resto > 0 ? `\n  ⚠ Estado borrado y releído, pero quedan ${e3.resto} posibles restos (otra forma de clave): revíselos.\n` : '\n  ✓ Estado borrado y releído. No se tocó nada más.\n');
  return 0;
}

async function revertir(cfg, db, log, marcar) {
  const l = leerRespaldo(cfg.respaldo, { entorno: cfg.entorno, tenant: cfg.tenant, tel: cfg.tel });
  if (!l.ok) { log(`\n  ✗ ${l.motivo}\n`); return 2; }
  const refs = l.docs.map((d) => db.doc(`${rutaColeccion(cfg.tenant, d.coleccion)}/${d.id}`));
  const hoy = refs.length ? await db.getAll(...refs) : [];
  const faltan = l.docs.filter((_d, i) => !hoy[i].exists);
  log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO de la reversa (solo lecturas)'} · ${cfg.entorno} · tenant ${cfg.tenant}`);
  log(`  documentos del respaldo: ${l.docs.length} · por reponer: ${faltan.length} · ya existen (no se pisan): ${l.docs.length - faltan.length}`);
  if (faltan.length === 0) { log('\n  ✓ Nada que reponer.\n'); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (y --confirmo-produccion <tenant> contra producción).\n'); return 1; }
  let hechas = 0;
  for (const d of faltan) {
    marcar('escribiendo');
    try {
      await db.doc(`${rutaColeccion(cfg.tenant, d.coleccion)}/${d.id}`).create(decodificar(d.data));
      hechas += 1; marcar('escrito');
    } catch (err) {
      marcar(hechas === 0 ? 'antes' : 'escrito');
      log(`\n  ✗ error al reponer (${err?.code ?? err?.name ?? 'desconocido'}): SÍ se repusieron ${hechas} de ${faltan.length}. Repita la reversa con el mismo respaldo.\n`);
      return 3;
    }
  }
  const despues = await db.getAll(...refs);
  const faltantes = despues.filter((s) => !s.exists).length;
  log(`  Repuestos: ${hechas} · faltan tras releer: ${faltantes}`);
  if (faltantes !== 0) { log('\n  ✗ La verificación no coincide: repita la reversa.\n'); return 3; }
  log('\n  ✓ Estado repuesto y releído.\n');
  return 0;
}

async function principal() {
  const a = analizarArgumentos(process.argv.slice(2));
  if (!a.ok) { console.error(`\n  ✗ ${a.problemas.join('\n  ✗ ')}\n\n${USO}\n`); process.exit(2); }
  const { cfg } = a;
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  let estado = 'antes';
  process.on('SIGINT', () => { console.error(mensajeDeInterrupcion(estado)); process.exit(130); });
  const codigo = await ejecutar(cfg, { db, marcarEscritura: (v) => { estado = v; } });
  await db.terminate().catch(() => {});
  process.exit(codigo);
}

function seEjecutaDirecto() {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}
if (seEjecutaDirecto()) {
  try { await principal(); } catch (e) { console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`); process.exit(3); }
}
