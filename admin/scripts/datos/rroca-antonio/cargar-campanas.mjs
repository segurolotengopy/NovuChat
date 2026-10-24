/**
 * CARGAR LOS ANUNCIOS DE ANTONIO (módulo Campañas) DESDE UN JSON — EN SECO POR DEFECTO.
 *
 * POR QUÉ EXISTE. Los anuncios (titular principal, titulares secundarios, producto y ángulo) son dato del tenant (el flujo de Antonio todavía conserva
 * `RA_ANGULOS` como respaldo por código hasta que estas campañas estén cargadas), en `tenants/{t}/config/campanas.lista`, y el flujo los recibe en la clave `anuncios` de «Traer configuración».
 * Se pueden cargar a mano desde la pestaña Campañas de la consola; este script los carga desde un archivo versionado y revisable
 * (`campanas-rroca-antonio.json`), en una operación repetible.
 *
 *   node admin/scripts/datos/rroca-antonio/cargar-campanas.mjs --proyecto <id> --tenant rroca-antonio [--archivo <json>]            # EN SECO
 *   node admin/scripts/datos/rroca-antonio/cargar-campanas.mjs --proyecto <id> --tenant rroca-antonio [--archivo <json>] --aplicar   # escribe
 *
 * QUÉ ESCRIBE (solo con `--aplicar`, en UNA transacción): `config/campanas.lista` (los anuncios del archivo, reemplazando los de igual `id`
 * y conservando las demás campañas del comercio), el sello `actualizadoPor: 'cargar-campanas'` y una entrada en `auditoria`. NO escribe
 * `revision` ni `vigentes`: los escribe SOLO el servidor (`verificarCampanas`, disparado por esta misma escritura) después de revisar cada
 * anuncio (forma, fechas, duplicados, montos, patrones y el revisor de modelo). Un anuncio que el servidor rechace queda cargado y NO viaja al flujo.
 *
 * EL SDK ADMIN SE SALTA LAS REGLAS DE FIRESTORE. Por eso este script valida antes, con las mismas comprobaciones sin modelo que el servidor
 * (`anuncios-validar.mjs`, comparado con `revisarSinModelo` por `pruebas/tenants/rroca-antonio/campanas.test.ts`), y comprueba contra Firestore:
 * que el comercio exista y esté activo, que cada `productoId` sea un documento ACTIVO de su catálogo y que el total no pase el tope de su plan.
 * Sin `--aplicar` no escribe nada. Los textos largos no se imprimen: se dice cuántos anuncios, sus titulares canónicos y los conteos.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_ANUNCIOS, armarLista, diaBolivia, validarArchivo } from './anuncios-validar.mjs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const ARCHIVO = opcion('archivo') ?? join(dirname(fileURLToPath(import.meta.url)), 'campanas-rroca-antonio.json');
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
// Los topes por plan, los mismos de `firestore.rules` (RESPALDO-CAMPANAS-POR-PLAN) y de `limiteDeCampanas`.
const POR_PLAN = { impulso: 0, crecimiento: 3, pro: 10, byoc: 10 };

const desconocidos = args.filter((a) => a.startsWith('--') && !['--proyecto', '--tenant', '--archivo', '--aplicar'].includes(a));
const problemasArgs = [];
if (!PROYECTO) problemasArgs.push('falta --proyecto');
if (!ID_TENANT.test(TENANT)) problemasArgs.push('--tenant inválido (minúsculas, guiones, 3 a 60)');
if (desconocidos.length) problemasArgs.push(`argumento desconocido: ${desconocidos.join(' ').slice(0, 60)}`);
if (problemasArgs.length) {
  console.error('\n  ✗ ' + problemasArgs.join('\n  ✗ '));
  console.error('\n  node admin/scripts/datos/rroca-antonio/cargar-campanas.mjs --proyecto <id> --tenant <id> [--archivo <json>] [--aplicar]\n');
  process.exit(2);
}

let datos;
try { datos = JSON.parse(readFileSync(ARCHIVO, 'utf8')); } catch (e) {
  console.error(`\n  ✗ No se pudo leer ${ARCHIVO} como JSON: ${e.message}\n`);
  process.exit(2);
}
if (typeof datos.tenant === 'string' && datos.tenant !== TENANT) {
  console.error(`\n  ✗ El archivo es del comercio «${datos.tenant}» y se pidió «${TENANT}»: no se escribe nada.\n`);
  process.exit(2);
}
// Un anuncio marcado `pendiente_de_termino_registrado` (su titular lleva un término que el servidor aún no admite) NO viaja en el lote: se informa y se deja fuera.
const pendientes = Array.isArray(datos.anuncios) ? datos.anuncios.filter((a) => a && a.pendiente_de_termino_registrado === true) : [];
if (pendientes.length) datos = { ...datos, anuncios: datos.anuncios.filter((a) => !(a && a.pendiente_de_termino_registrado === true)) };
const antes = validarArchivo(datos);
if (antes.length) {
  console.error(`\n  ✗ El archivo no cumple las reglas del servidor (${antes.length}):\n    - ${antes.join('\n    - ')}\n\n  No se escribió nada.\n`);
  process.exit(2);
}

// --- Firestore ---------------------------------------------------------------
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const refTenant = db.doc(`tenants/${TENANT}`);
const refCuenta = db.doc(`tenants/${TENANT}/cuenta/estado`);
const refCamp = db.doc(`tenants/${TENANT}/config/campanas`);

const canonico = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const hoy = diaBolivia(Date.now());
console.log(`\n  Comercio  : ${TENANT}`);
console.log(`  Archivo   : ${ARCHIVO}`);
console.log(`  Proyecto  : ${PROYECTO}\n`);

let plan;
let rechazo = null;
try {
  await db.runTransaction(async (tx) => {
    const [tenant, cuenta, camp] = await Promise.all([tx.get(refTenant), tx.get(refCuenta), tx.get(refCamp)]);
    if (!tenant.exists) { rechazo = `No existe el comercio «${TENANT}».`; return; }
    if ((tenant.get('estado') ?? 'activo') !== 'activo') { rechazo = `«${TENANT}» no está activo: no se reconfigura.`; return; }
    // El tope del plan: la copia de los límites de la cuenta, o el del plan (y 0 si no es del catálogo).
    const propio = cuenta.get('limites.campanas');
    const limite = Number.isInteger(propio) && propio >= 0 && propio <= MAX_ANUNCIOS ? propio : (POR_PLAN[cuenta.get('plan')] ?? 0);
    // Los productos que los anuncios referencian: documentos ACTIVOS del catálogo de ESTE comercio.
    const ids = [...new Set(datos.anuncios.map((a) => a.productoId).filter((x) => typeof x === 'string'))];
    const docs = ids.length ? await tx.getAll(...ids.map((i) => db.doc(`tenants/${TENANT}/catalogo/${i}`))) : [];
    const activos = new Set(docs.filter((d) => d.exists && d.get('activo') === true).map((d) => d.id));
    const problemas = validarArchivo(datos, { productosActivos: activos, limite });
    if (problemas.length) { rechazo = `El archivo no cabe en este comercio:\n    - ${problemas.join('\n    - ')}`; return; }

    const existentes = Array.isArray(camp.get('lista')) ? camp.get('lista') : [];
    const delArchivo = armarLista(datos, hoy);
    const porId = new Map(existentes.map((c) => [c && c.id, c]));
    // Un anuncio que ya estaba conserva su fecha de inicio (el servidor admite un inicio pasado SOLO si no cambia).
    const nuevos = delArchivo.map((c) => { const viejo = porId.get(c.id); return viejo && typeof viejo.inicio === 'string' && viejo.inicio <= hoy ? { ...c, inicio: viejo.inicio } : c; });
    const idsNuevos = new Set(nuevos.map((c) => c.id));
    const lista = [...nuevos, ...existentes.filter((c) => c && !idsNuevos.has(c.id))];
    if (lista.length > Math.min(limite, MAX_ANUNCIOS)) {
      rechazo = `Con las campañas que el comercio ya tiene (${existentes.length}), la lista tendría ${lista.length} y su plan admite ${limite}. Es una decisión comercial: no se recorta nada en silencio.`;
      return;
    }
    plan = {
      limite, creaDocumento: !camp.exists,
      filas: nuevos.map((c) => ({ id: c.id, titular: c.titulares[0], estado: !porId.has(c.id) ? 'nuevo' : canonico({ t: c.titulares, p: c.productoId, a: c.angulo }) === canonico({ t: porId.get(c.id).titulares, p: porId.get(c.id).productoId, a: porId.get(c.id).angulo }) ? 'igual' : 'cambia' })),
      conservadas: lista.length - nuevos.length,
    };
    if (!APLICAR) return;
    const ahora = Timestamp.now();
    tx.set(refCamp, { lista, actualizadoPor: 'cargar-campanas', actualizadoEn: ahora }, { mergeFields: ['lista', 'actualizadoPor', 'actualizadoEn'] });
    tx.create(db.collection(`tenants/${TENANT}/auditoria`).doc(), { accion: 'cargar_campanas', uid: 'cargar-campanas', en: ahora, campos: ['lista'], conteos: { anuncios: nuevos.length, conservadas: lista.length - nuevos.length } });
  });
} catch (e) {
  console.error(`  ✗ ${e.message}\n`);
  process.exit(1);
}
if (rechazo) { console.error(`  ✗ ${rechazo}\n`); process.exit(1); }

if (pendientes.length) console.log(`  Fuera del lote (pendientes de término registrado): ${pendientes.map((a) => a.id).join(', ')}`);
console.log(`  config/campanas${plan.creaDocumento ? ' (se crea)' : ''} · tope del plan: ${plan.limite} · anuncios del archivo: ${plan.filas.length} · otras campañas que se conservan: ${plan.conservadas}`);
for (const f of plan.filas) console.log(`    ${f.estado.padEnd(6)} ${f.id.padEnd(28)} «${f.titular}»`);
if (!APLICAR) {
  console.log('\n  Seco: no se escribió nada. Agrega --aplicar (el servidor revisará cada anuncio al escribirse).\n');
  process.exit(0);
}
const rel = await refCamp.get();
const falla = !Array.isArray(rel.get('lista')) || plan.filas.some((f) => !rel.get('lista').some((c) => c && c.id === f.id)) || rel.get('actualizadoPor') !== 'cargar-campanas';
console.log(`\n  ${falla ? '✗' : '✓'} Verificación por relectura: ${falla ? 'no coincide' : `${plan.filas.length} anuncio(s) cargados; el servidor los revisa ahora (revision y vigentes los escribe él)`}\n`);
if (falla) process.exit(1);
