/**
 * RELLENAR LOS CAMPOS DERIVADOS DE LAS CONVERSACIONES ANTIGUAS DE UN COMERCIO — seco por omisión.
 *
 * QUÉ ES. Desde H1 la ingesta escribe en cada conversación dos campos que la pantalla nueva usa para
 * buscar sin leer todo (`functions/src/core/conversacion/derivados.ts`): `telefonoTrozos` (los finales de
 * 4 dígitos o más del teléfono) y `nombrePalabras` (hasta 6 palabras del nombre del contacto). Las
 * conversaciones que ya existían NO los tienen hasta que escriben otro mensaje; este script los agrega a las
 * antiguas de UN comercio, calculándolos con las MISMAS funciones de Core que usa la ingesta
 * (`core/conversacion/normalizacion.ts`, importada, no copiada) a partir de los campos que la conversación
 * ya tiene: `telefono` y `nombreContacto`.
 *
 *   node scripts/plataforma/rellenar-conversaciones.mjs --proyecto <id> --tenant <id> \
 *        [--aplicar --respaldo <ruta> [--confirmo-produccion <tenant>]]
 *   node scripts/plataforma/rellenar-conversaciones.mjs --revertir --respaldo <ruta> \
 *        --tenant <id> --proyecto <id> [--aplicar] [--confirmo-produccion <tenant>]
 *
 * QUÉ HACE.
 *   · SECO (sin `--aplicar`): recorre `tenants/{t}/conversaciones` en páginas de 300 por id de documento y
 *     cuenta cuántas tocaría, cuántas ya están al día y cuántas no tienen dato para derivar. No escribe.
 *     Nunca imprime un teléfono ni un nombre: solo cantidades.
 *   · `--aplicar`: exige `--respaldo`. Primero guarda la lista de lo que va a tocar (`{conversacionId,
 *     camposAgregados[]}` más una huella de cada valor), después escribe en lotes de a lo sumo 400 con
 *     `update` y la precondición `lastUpdateTime` de lo leído: si la conversación cambió entre la lectura y la
 *     escritura (llegó un mensaje), SE SALTA y se cuenta, no se reintenta a ciegas. Relee lo escrito.
 *   · `--revertir --aplicar`: borra SOLO los campos que este script agregó y que sigan con el valor que escribió
 *     (la huella del respaldo); lo que alguien o la ingesta cambió después no se toca.
 *   · IDEMPOTENTE: la segunda corrida encuentra todo al día y sale con 0 sin escribir (ni respaldo).
 *   · Solo AGREGA un campo que NO existe: un campo que ya está (aunque difiera) no se toca; la ingesta lo
 *     reescribe con el siguiente mensaje de esa conversación.
 *
 * LO QUE NO HACE (A PROPÓSITO).
 *   · NO inventa `ultimoEntranteEn`, `ventanaVenceEn`, `noLeidos` ni `sinLeer`: salen de un mensaje entrante y
 *     no se derivan de lo que la conversación ya tiene. Las conversaciones antiguas aparecen «sin dato» de
 *     ventana y leídas, que es lo que la consola espera de un documento viejo.
 *   · NO TOCA MENSAJES. LIMITACIÓN: los mensajes antiguos quedan sin `palabras`; la búsqueda por palabra solo
 *     hallará mensajes NUEVOS (los que entren después de que la ingesta con H1 esté desplegada). Buscar por
 *     teléfono y por nombre sí funciona sobre las conversaciones antiguas rellenadas.
 *
 * BELLIDO NO SE TOCA (decisión P1, Andres, 09/10/2026): a Bellido no se le corre el relleno. El script se NIEGA
 * (salida 2, sin abrir Firebase) si el id es de Bellido o está en la lista de exclusión (la misma de
 * `aplicar-consola-conversaciones.mjs`), y de nuevo si el NOMBRE de la ficha lo nombra.
 *
 * SALVAGUARDA DE PROYECTO y RESPALDO: las mismas de `aplicar-consola-conversaciones.mjs` (lista blanca por
 * `GCP_PROJECT_ID_STAGING` / `GCP_PROJECT_ID_PROD`; en producción `--aplicar` exige `--confirmo-produccion
 * <tenant>`; el id del proyecto real NUNCA se imprime; respaldo 0600 en carpeta 0700, nunca en `~/`: va en el
 * scratchpad o en una carpeta ignorada por git del proyecto). El respaldo contiene los ids de conversación, que
 * llevan el teléfono (`wa_<teléfono>`): por eso es privado y no se versiona.
 *
 * SALIDA. 0: nada que hacer o escrito y comprobado. 1: el seco encontró diferencias, o quedaron conversaciones
 * saltadas por la precondición (repita). 2: uso o salvaguarda (nada escrito). 3: error de ejecución (solo
 * `e.code ?? e.name`) o la relectura no coincide. 130: Ctrl-C.
 *
 * COSTO por cada 1000 conversaciones: seco = 1000 lecturas (+1 de la ficha). `--aplicar` = 1000 lecturas del
 * recorrido + a lo sumo 1000 escrituras (una por conversación a rellenar) + a lo sumo 1000 lecturas de la
 * relectura. Revertir = a lo sumo 1000 lecturas + 1000 escrituras + 1000 lecturas. 0 mensajes por conversación.
 * NO se corre contra producción sin el «sí» de Andres.
 */
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAX_PALABRAS_CONSULTA, palabrasDe, trozosDeTelefono } from '../../functions/src/core/conversacion/normalizacion.ts';
import {
  ID_TENANT, comprobarProyecto, comprobarRespaldo, esTenantExcluido, guardarRespaldo, leerRespaldoGenerico, nombreExcluido,
} from './aplicar-consola-conversaciones.mjs';

export { comprobarProyecto, comprobarRespaldo, esTenantExcluido, guardarRespaldo };

/** Los ÚNICOS campos que este script puede escribir. */
export const CAMPOS_DERIVADOS = Object.freeze(['telefonoTrozos', 'nombrePalabras']);
export const TAMANO_PAGINA = 300;
export const TAMANO_LOTE = 400;
const MAXIMO_RESPALDO = 64 * 1024 * 1024;
const ID_CONVERSACION = /^[A-Za-z0-9_-]{1,100}$/;
const CON_VALOR = ['proyecto', 'tenant', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];

export const LIMITACION = 'LIMITACIÓN: los mensajes antiguos no se rellenan (no tienen `palabras`); la búsqueda por palabra '
  + 'solo hallará mensajes NUEVOS. Teléfono y nombre sí se hallan en las conversaciones rellenadas.';

export const USO = '  node scripts/plataforma/rellenar-conversaciones.mjs --proyecto <id> --tenant <id> '
  + '[--aplicar --respaldo <ruta> [--confirmo-produccion <tenant>]]\n'
  + '  node scripts/plataforma/rellenar-conversaciones.mjs --revertir --respaldo <ruta> --tenant <id> --proyecto <id> '
  + '[--aplicar] [--confirmo-produccion <tenant>]';

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
  else if (esTenantExcluido(tenant, env)) {
    problemas.push('este comercio está EXCLUIDO: a Bellido no se le corre el relleno de Conversaciones (decisión del 09/10/2026)');
  }

  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) {
    problemas.push('contra producción, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  }

  if (revertir) {
    if (respaldo === undefined) problemas.push('--revertir exige --respaldo <ruta>');
  } else if (aplicar && respaldo === undefined) {
    problemas.push('--aplicar exige --respaldo <ruta> (por omisión no hay respaldo)');
  }
  let respaldoReal = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: revertir, permitirExistente: !revertir });
    if (r.ok) respaldoReal = respaldo; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, aplicar, revertir, respaldo: respaldoReal } };
}

// ===========================================================================
// LO QUE SE DERIVA (puro)
// ===========================================================================
const tiene = (doc, campo) => Object.prototype.hasOwnProperty.call(doc, campo);

/** La huella de un valor escrito: el respaldo guarda esto, no los teléfonos ni las palabras. */
export const huellaDe = (valor) => createHash('sha256').update(JSON.stringify(valor)).digest('hex');

/**
 * Qué se le agregaría a una conversación: SOLO campos que NO tiene y que se derivan de los que sí tiene, con
 * las funciones de Core. `sinTelefono`: no hay dígitos suficientes para `telefonoTrozos`.
 */
export function derivarDe(doc) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const campos = {};
  const trozos = trozosDeTelefono(d.telefono);
  const sinTelefono = trozos.length === 0;
  if (!tiene(d, 'telefonoTrozos') && !sinTelefono) campos.telefonoTrozos = trozos;
  const palabras = palabrasDe(d.nombreContacto, MAX_PALABRAS_CONSULTA);
  if (!tiene(d, 'nombrePalabras') && palabras.length) campos.nombrePalabras = palabras;
  return { campos, sinTelefono };
}

/** LA GUARDA DE LA ÚNICA ESCRITURA: ningún campo fuera de la lista cerrada. */
export function soloCamposDerivados(datos) {
  for (const k of Object.keys(datos)) {
    if (!CAMPOS_DERIVADOS.includes(k)) throw Object.assign(new Error('campo fuera de la lista cerrada'), { code: 'campo-no-permitido' });
  }
  return datos;
}

// ===========================================================================
// ESCRITURA EN LOTES (con precondición por documento)
// ===========================================================================
const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';
const esNoExiste = (e) => e?.code === 5 || e?.code === 'not-found' || e?.code === 'NOT_FOUND';
const sePuedeSaltar = (e) => esPrecondicion(e) || esNoExiste(e);

/**
 * Escribe un lote (≤ TAMANO_LOTE) de `{ ref, datos, updateTime }`. Cada `update` lleva la precondición de la hora
 * leída. Un lote es atómico: si UNA conversación cambió, falla entero sin escribir nada; entonces se prueba una
 * por una, con la misma precondición, y las que cambiaron se SALTAN y se cuentan (no se reintentan). Devuelve los
 * índices escritos y los saltados. Cualquier otro error se propaga.
 */
export async function escribirLote(db, lote) {
  const batch = db.batch();
  for (const it of lote) batch.update(it.ref, soloCamposDerivados(it.datos), { lastUpdateTime: it.updateTime });
  try {
    await batch.commit();
    return { escritas: lote.map((_, i) => i), saltadas: [] };
  } catch (e) {
    if (!sePuedeSaltar(e)) throw e;
  }
  const escritas = [];
  const saltadas = [];
  for (let i = 0; i < lote.length; i++) {
    const it = lote[i];
    try {
      await it.ref.update(soloCamposDerivados(it.datos), { lastUpdateTime: it.updateTime });
      escritas.push(i);
    } catch (e) {
      if (!sePuedeSaltar(e)) throw e;
      saltadas.push(i);
    }
  }
  return { escritas, saltadas };
}

// ===========================================================================
// LECTURA
// ===========================================================================
const refDe = (db, tenant, id) => db.doc(`tenants/${tenant}/conversaciones/${id}`);

async function leerFicha(db, tenant) {
  const [snap] = await db.getAll(db.doc(`tenants/${tenant}`), { fieldMask: ['nombre'] });
  return snap;
}

/** Recorre la subcolección en páginas por id de documento; entrega cada página (arreglo de snapshots). */
async function* paginas(db, FieldPath, tenant, tamano) {
  let ultimo = null;
  for (;;) {
    let q = db.collection(`tenants/${tenant}/conversaciones`)
      .orderBy(FieldPath.documentId()).limit(tamano).select('telefono', 'nombreContacto', ...CAMPOS_DERIVADOS);
    if (ultimo) q = q.startAfter(ultimo);
    const s = await q.get();
    if (s.empty) return;
    yield s.docs;
    if (s.docs.length < tamano) return;
    ultimo = s.docs[s.docs.length - 1];
  }
}

/** Recorre todo y arma el plan: qué se agregaría a cuáles. Sin imprimir nada de las conversaciones. */
async function escanear(db, FieldPath, tenant, tamano) {
  const cuenta = { total: 0, tocan: 0, alDia: 0, sinDato: 0, porCampo: { telefonoTrozos: 0, nombrePalabras: 0 } };
  const plan = [];
  for await (const pagina of paginas(db, FieldPath, tenant, tamano)) {
    for (const snap of pagina) {
      cuenta.total += 1;
      const { campos, sinTelefono } = derivarDe(snap.data() ?? {});
      const nombres = Object.keys(campos);
      if (nombres.length) {
        cuenta.tocan += 1;
        for (const k of nombres) cuenta.porCampo[k] += 1;
        plan.push({ id: snap.id, ref: snap.ref, updateTime: snap.updateTime, campos });
      } else if (sinTelefono) cuenta.sinDato += 1;
      else cuenta.alDia += 1;
    }
  }
  return { cuenta, plan };
}

// ===========================================================================
// RESPALDO
// ===========================================================================
/** Lo que se guarda: por conversación, qué campos se agregan y la huella de cada valor. Nada de los valores. */
export function contenidoDelRespaldo({ entorno, tenant, plan }) {
  return {
    version: 1, tipo: 'relleno-conversaciones', entorno, tenant, creadoEn: new Date().toISOString(),
    items: plan.map((p) => ({
      conversacionId: p.id,
      camposAgregados: Object.keys(p.campos),
      huellas: Object.fromEntries(Object.entries(p.campos).map(([k, v]) => [k, huellaDe(v)])),
    })),
  };
}

export function leerRespaldo(ruta, { entorno, tenant }) {
  const l = leerRespaldoGenerico(ruta, { limite: MAXIMO_RESPALDO });
  if (!l.ok) return l;
  const r = l.respaldo;
  if (r?.version !== 1 || r.tipo !== 'relleno-conversaciones' || !Array.isArray(r.items)) return { ok: false, motivo: 'el respaldo no tiene la forma esperada' };
  if (r.tenant !== tenant) return { ok: false, motivo: 'el respaldo es de otro comercio' };
  if (r.entorno !== entorno) return { ok: false, motivo: 'el respaldo es de otro entorno (staging, produccion o emulador)' };
  const huella = /^[0-9a-f]{64}$/;
  const vistas = new Set();
  for (const it of r.items) {
    const bien = it && typeof it === 'object' && typeof it.conversacionId === 'string' && ID_CONVERSACION.test(it.conversacionId)
      && !vistas.has(it.conversacionId)
      && Array.isArray(it.camposAgregados) && it.camposAgregados.length > 0 && it.camposAgregados.length <= CAMPOS_DERIVADOS.length
      && it.camposAgregados.every((c, i) => CAMPOS_DERIVADOS.includes(c) && it.camposAgregados.indexOf(c) === i)
      && it.huellas && typeof it.huellas === 'object'
      && it.camposAgregados.every((c) => typeof it.huellas[c] === 'string' && huella.test(it.huellas[c]));
    if (!bien) return { ok: false, motivo: 'el respaldo tiene una conversación con forma inválida' };
    vistas.add(it.conversacionId);
  }
  return { ok: true, respaldo: r };
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================
export function mensajeDeInterrupcion(estado) {
  if (estado === 'antes') return '\n  ! Interrumpido antes de escribir. No se escribió nada en las conversaciones.\n';
  return '\n  ! Interrumpido DURANTE la escritura: parte de los lotes pudo escribirse. Es seguro: corra el seco para ver qué falta '
    + '(el relleno es idempotente) o --revertir con el mismo respaldo, que solo borra lo que este script escribió.\n';
}

const trozos = (arreglo, n) => Array.from({ length: Math.ceil(arreglo.length / n) }, (_, i) => arreglo.slice(i * n, (i + 1) * n));

/**
 * Relee `ids` (de a 300) y cuenta los que NO coinciden con `quedo(datos)`. Lecturas con máscara de campos.
 */
async function releer(db, tenant, ids, quedo) {
  let mal = 0;
  for (const grupo of trozos(ids, TAMANO_PAGINA)) {
    const snaps = await db.getAll(...grupo.map((id) => refDe(db, tenant, id)), { fieldMask: [...CAMPOS_DERIVADOS] });
    snaps.forEach((s, i) => { if (!quedo(grupo[i], s.exists ? (s.data() ?? {}) : null)) mal += 1; });
  }
  return mal;
}

/**
 * Corre la operación ya validada. `deps`: `{ db, FieldValue, FieldPath, log, marcarEscritura, env, pagina, lote }`
 * (`pagina` y `lote` solo para las pruebas). Devuelve el código de salida.
 */
export async function ejecutar(cfg, deps) {
  const { db, FieldValue, FieldPath } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const marcar = deps.marcarEscritura ?? (() => {});
  const pagina = deps.pagina ?? TAMANO_PAGINA;
  const tamLote = Math.min(deps.lote ?? TAMANO_LOTE, TAMANO_LOTE);
  const rotulo = `${cfg.entorno} · tenant ${cfg.tenant}`;

  if (esTenantExcluido(cfg.tenant, deps.env)) { log('\n  ✗ Este comercio está EXCLUIDO (Bellido): no se toca.\n'); return 2; }
  const ficha = await leerFicha(db, cfg.tenant);
  if (!ficha.exists) { log(`\n  ✗ ${cfg.tenant}: no existe la ficha (${cfg.entorno})\n`); return 1; }
  if (nombreExcluido((ficha.data() ?? {}).nombre, deps.env)) {
    log('\n  ✗ El nombre de la ficha corresponde a un comercio EXCLUIDO (Bellido): no se toca. No se escribió nada.\n');
    return 2;
  }

  // ------------------------------------------------------------------ revertir
  if (cfg.revertir) {
    const lectura = leerRespaldo(cfg.respaldo, cfg);
    if (!lectura.ok) { log(`\n  ✗ ${lectura.motivo}\n`); return 2; }
    const { items } = lectura.respaldo;
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO (solo lecturas)'} · ${rotulo}\n`);
    const cuenta = { enRespaldo: items.length, aRevertir: 0, yaSinCampo: 0, sinConversacion: 0, camposConservados: 0 };
    const plan = [];
    for (const grupo of trozos(items, pagina)) {
      const snaps = await db.getAll(...grupo.map((it) => refDe(db, cfg.tenant, it.conversacionId)), { fieldMask: [...CAMPOS_DERIVADOS] });
      snaps.forEach((s, i) => {
        const it = grupo[i];
        if (!s.exists) { cuenta.sinConversacion += 1; return; }
        const d = s.data() ?? {};
        const borrar = [];
        for (const c of it.camposAgregados) {
          if (!tiene(d, c)) continue;
          if (huellaDe(d[c]) === it.huellas[c]) borrar.push(c); else cuenta.camposConservados += 1;
        }
        if (borrar.length) { cuenta.aRevertir += 1; plan.push({ id: it.conversacionId, ref: s.ref, updateTime: s.updateTime, borrar }); }
        else if (!it.camposAgregados.some((c) => tiene(d, c))) cuenta.yaSinCampo += 1;
      });
    }
    log(`  conversaciones en el respaldo        : ${cuenta.enRespaldo}`);
    log(`  se les borrarían campos (siguen igual): ${cuenta.aRevertir}`);
    log(`  ya sin el campo                       : ${cuenta.yaSinCampo}`);
    log(`  campos que cambiaron después (se conservan): ${cuenta.camposConservados}`);
    log(`  conversaciones que ya no existen      : ${cuenta.sinConversacion}`);
    if (plan.length === 0) { log('\n  ✓ Nada que revertir.\n'); return 0; }
    if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar para revertir.\n'); return 1; }

    marcar('escribiendo');
    let escritas = 0;
    let saltadas = 0;
    const borradas = [];
    for (const grupo of trozos(plan, tamLote)) {
      const lote = grupo.map((p) => ({
        ref: p.ref, updateTime: p.updateTime,
        datos: Object.fromEntries(p.borrar.map((c) => [c, FieldValue.delete()])),
      }));
      const r = await escribirLote(db, lote);
      escritas += r.escritas.length;
      saltadas += r.saltadas.length;
      for (const i of r.escritas) borradas.push(grupo[i]);
    }
    marcar('escrito');
    const porId = new Map(borradas.map((p) => [p.id, p]));
    const mal = await releer(db, cfg.tenant, [...porId.keys()], (id, d) => d !== null && porId.get(id).borrar.every((c) => !tiene(d, c)));
    log(`\n  Revertidas: ${escritas} · saltadas por precondición: ${saltadas} · relectura que no coincide: ${mal}`);
    if (mal > 0) { log('  ✗ La relectura no coincide en algunas. Revise con el seco.\n'); return 3; }
    if (saltadas > 0) { log('  Quedan conversaciones que cambiaron durante la corrida: repita el seco y --aplicar.\n'); return 1; }
    log('  ✓ Revertido y releído.\n');
    return 0;
  }

  // -------------------------------------------------------- seco y aplicar
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)'} · ${rotulo}\n`);
  const { cuenta, plan } = await escanear(db, FieldPath, cfg.tenant, pagina);
  log(`  conversaciones leídas                  : ${cuenta.total}`);
  log(`  se tocarían (campos que agregar)       : ${cuenta.tocan}`);
  log(`    · telefonoTrozos                     : ${cuenta.porCampo.telefonoTrozos}`);
  log(`    · nombrePalabras                     : ${cuenta.porCampo.nombrePalabras}`);
  log(`  ya al día                              : ${cuenta.alDia}`);
  log(`  se saltarían (sin teléfono que derivar): ${cuenta.sinDato}`);
  log(`  escrituras si se aplica                : ${cuenta.tocan} (una por conversación)`);
  log(`  ${LIMITACION}`);

  if (plan.length === 0) { log('\n  ✓ Todo está al día: nada que hacer.\n'); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (y --respaldo) para escribir.\n'); return 1; }

  try {
    guardarRespaldo(cfg.respaldo, contenidoDelRespaldo({ entorno: cfg.entorno, tenant: cfg.tenant, plan }));
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa; elija otro nombre. No se escribe nada.\n'); return 2; }
    throw e;
  }
  log(`\n  Respaldo guardado y releído: ${cfg.respaldo}`);

  marcar('escribiendo');
  let escritas = 0;
  let saltadas = 0;
  const hechas = [];
  for (const grupo of trozos(plan, tamLote)) {
    const r = await escribirLote(db, grupo.map((p) => ({ ref: p.ref, datos: p.campos, updateTime: p.updateTime })));
    escritas += r.escritas.length;
    saltadas += r.saltadas.length;
    for (const i of r.escritas) hechas.push(grupo[i]);
  }
  marcar('escrito');
  const porId = new Map(hechas.map((p) => [p.id, p]));
  const mal = await releer(db, cfg.tenant, [...porId.keys()], (id, d) => d !== null
    && Object.entries(porId.get(id).campos).every(([c, v]) => tiene(d, c) && huellaDe(d[c]) === huellaDe(v)));
  log(`\n  Escritas: ${escritas} · saltadas por precondición (cambiaron durante la corrida): ${saltadas} · relectura que no coincide: ${mal}`);
  if (mal > 0) { log('  ✗ La relectura no coincide en algunas. Revise con el seco; el respaldo permite revertir.\n'); return 3; }
  if (saltadas > 0) { log('  Las saltadas no se reintentan solas: repita el seco y --aplicar (es idempotente).\n'); return 1; }
  log('  ✓ Escrito y releído. Para deshacer: --revertir con el mismo respaldo, tenant y proyecto.\n');
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
  const { getFirestore, FieldValue, FieldPath } = await import('firebase-admin/firestore');
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  let estado = 'antes';
  process.on('SIGINT', () => {
    console.error(mensajeDeInterrupcion(estado));
    process.exit(130);
  });
  const codigo = await ejecutar(cfg, { db, FieldValue, FieldPath, marcarEscritura: (v) => { estado = v; } });
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
