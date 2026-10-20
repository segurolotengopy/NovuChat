/**
 * COPIAR LOS COMPROBANTES YA RECIBIDOS A `comprobantesRecibidos` (fase 2), EN SECO POR DEFECTO.
 *
 * POR QUÉ EXISTE. Desde la fase 2, `cotejarComprobanteVenta` registra cada comprobante en
 * `tenants/{t}/comprobantesRecibidos/{nombreDeObjeto(idMeta)}`. Los que llegaron antes solo
 * están en `conversaciones/{wa_<tel>}.solicitud.comprobantes[]` (hasta 6 por solicitud). Sin
 * esta copia, la lista de la consola y el visor de fotos (que ya leen solo la colección nueva)
 * los perderían. Este script los copia, una vez, a la vista.
 *
 * QUÉ HACE, comercio por comercio (los dados de baja no se tocan):
 *   - recorre las conversaciones con `solicitud.reglaCobro == 2` y toma cada entrada de
 *     `solicitud.comprobantes[]` que tenga `idMeta` y una fecha `en`;
 *   - calcula el id con la MISMA fórmula que el servidor (sha256 en base64url de
 *     `idMeta.trim().slice(0, 120)`), `vence = en + 90 días` y, si la conversación tiene
 *     `nombreContacto`, lo copia (≤ 120);
 *   - NO copia el teléfono (sale de `conversacionId`), ni lo leído de la imagen, ni `avisar`.
 *
 * EN SECO (por omisión) cuenta, por comercio, cuántos comprobantes hay, cuántos ya están
 * copiados y cuántos se crearían. No escribe nada y NUNCA imprime teléfonos ni conversaciones.
 *
 * CON `--aplicar`:
 *   1. guarda un RESPALDO JSON de lo que va a crear, fuera del repositorio (`--respaldo
 *      <ruta>`, o un archivo en el directorio temporal del sistema). Una ruta dentro del
 *      repositorio se rechaza: el respaldo trae ids de conversación;
 *   2. escribe con `create()`: si el documento ya existe lo salta (idempotente; una segunda
 *      pasada crea 0 y no deja constancia);
 *   3. RELEE cada documento escrito y compara;
 *   4. deja una auditoría `copiar_comprobantes_recibidos` por comercio, con solo cuentas
 *      (sin teléfonos).
 *
 * `--proyecto <id>` y `--operador <correo>` son OBLIGATORIOS (el operador queda en la
 * auditoría, como en `migrar-ejes.mjs`). `--tenant <id>` acota a un comercio.
 *
 *   node scripts/modulos/cobros/copiar-comprobantes-recibidos.mjs --proyecto <id> --operador <correo>
 *   node scripts/modulos/cobros/copiar-comprobantes-recibidos.mjs --proyecto <id> --operador <correo> --tenant <id> --aplicar
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const PROYECTO = opcion('proyecto');
const SOLO = (opcion('tenant') ?? '').toLowerCase();
const OPERADOR = (opcion('operador') ?? '').trim().toLowerCase();

const DIA_MS = 86_400_000;
const DIAS_DE_RECIBIDOS = 90;
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RAIZ_DEL_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** El nombre del objeto de Storage: la misma fórmula que `nombreDeObjeto` de `comprobantes.ts`. */
const nombreDeObjeto = (idMeta) =>
  createHash('sha256').update(String(idMeta ?? '').trim().slice(0, 120)).digest('base64url');

const fueraDelRepo = (ruta) => {
  const r = relative(RAIZ_DEL_REPO, resolve(ruta));
  return r.startsWith('..') || isAbsolute(r);
};
const respaldoPedido = opcion('respaldo');
const RESPALDO = respaldoPedido
  ? resolve(respaldoPedido)
  : join(tmpdir(), `respaldo-comprobantes-recibidos-${PROYECTO ?? 'sin-proyecto'}-${new Date().toISOString().slice(0, 10)}.json`);

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (SOLO && !ID_TENANT.test(SOLO)) problemas.push('--tenant inválido (minúsculas, guiones, 3 a 60)');
if (!CORREO.test(OPERADOR)) problemas.push('--operador <correo> es obligatorio: es quien queda en la auditoría');
if (APLICAR && !fueraDelRepo(RESPALDO)) problemas.push('--respaldo debe estar FUERA del repositorio');
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/modulos/cobros/copiar-comprobantes-recibidos.mjs --proyecto <id> --operador <correo> [--tenant <id>] [--respaldo <ruta>] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const numeroONulo = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Los documentos que saldrían de UNA conversación (puro sobre lo leído). */
function documentosDe(conversacion) {
  const solicitud = conversacion.get('solicitud');
  const lista = solicitud && Array.isArray(solicitud.comprobantes) ? solicitud.comprobantes : [];
  const nombre = texto(conversacion.get('nombreContacto'), 120);
  const salida = [];
  let sinDatos = 0;
  for (const c of lista) {
    const idMeta = texto(c?.idMeta, 120);
    if (idMeta === '' || !(c.en instanceof Timestamp)) { sinDatos += 1; continue; }
    salida.push({
      id: nombreDeObjeto(idMeta),
      datos: {
        idMeta, conversacionId: conversacion.id,
        estado: texto(c.estado, 30), motivo: texto(c.motivo, 60),
        en: c.en, vence: Timestamp.fromMillis(c.en.toMillis() + DIAS_DE_RECIBIDOS * DIA_MS),
        importe: numeroONulo(c.importe), montoLeido: numeroONulo(c.montoLeido), montoDistinto: c.montoDistinto === true,
        intentos: Number.isInteger(c.intentos) && c.intentos >= 0 ? c.intentos : 0,
        ruta: typeof c.ruta === 'string' && c.ruta !== '' ? c.ruta : null,
        ...(nombre ? { nombreContacto: nombre } : {}),
      },
    });
  }
  return { documentos: salida, sinDatos };
}

console.log(`\n  Copia de comprobantes recibidos · proyecto ${PROYECTO} · ${APLICAR ? 'APLICAR' : 'seco'} · operador ${OPERADOR}`);
const tenants = (await db.collection('tenants').select('estado').get()).docs
  .filter((d) => !SOLO || d.id === SOLO).sort((a, b) => a.id.localeCompare(b.id));
if (SOLO && tenants.length === 0) { console.error(`\n  ✗ No existe el comercio «${SOLO}».\n`); process.exit(1); }

// --- Análisis (todo lo que se lee, por comercio) ---------------------------------
const plan = [];
for (const ficha of tenants) {
  if (ficha.get('estado') === 'dado_de_baja') { console.log(`  ${ficha.id}: dado de baja, no se toca`); continue; }
  const conversaciones = (await db.collection(`tenants/${ficha.id}/conversaciones`).where('solicitud.reglaCobro', '==', 2).get()).docs;
  const porId = new Map();
  let sinDatos = 0;
  for (const conv of conversaciones) {
    const r = documentosDe(conv);
    sinDatos += r.sinDatos;
    for (const d of r.documentos) if (!porId.has(d.id)) porId.set(d.id, d);
  }
  const existentes = [];
  for (const d of porId.values()) {
    if ((await db.doc(`tenants/${ficha.id}/comprobantesRecibidos/${d.id}`).get()).exists) existentes.push(d.id);
  }
  const crear = [...porId.values()].filter((d) => !existentes.includes(d.id));
  plan.push({ tenant: ficha.id, conversaciones: conversaciones.length, total: porId.size, existentes: existentes.length, sinDatos, crear });
  console.log(`  ${ficha.id}: ${conversaciones.length} conversación(es) con cobro de regla 2 · ${porId.size} comprobante(s) · ya copiados ${existentes.length} · a crear ${crear.length}${sinDatos ? ` · omitidos sin idMeta o fecha ${sinDatos}` : ''}`);
}

const aCrear = plan.reduce((n, p) => n + p.crear.length, 0);
console.log(`\n  Comercios: ${plan.length} · comprobantes a crear: ${aCrear}`);
if (!APLICAR) {
  console.log('  Seco: no se escribió nada. Agregue --aplicar (con el OK de Andres).\n');
  process.exit(0);
}
if (aCrear === 0) { console.log('  Nada que copiar: no se escribe respaldo ni auditoría.\n'); process.exit(0); }

// --- Respaldo, escritura y relectura ---------------------------------------------
mkdirSync(dirname(RESPALDO), { recursive: true });
writeFileSync(RESPALDO, JSON.stringify({
  proyecto: PROYECTO, operador: OPERADOR, en: new Date().toISOString(),
  crear: plan.flatMap((p) => p.crear.map((d) => ({
    ruta: `tenants/${p.tenant}/comprobantesRecibidos/${d.id}`,
    datos: { ...d.datos, en: d.datos.en.toMillis(), vence: d.datos.vence.toMillis() },
  }))),
}, null, 2), { mode: 0o600 });
console.log(`  Respaldo guardado (fuera del repositorio): ${RESPALDO}`);

let fallos = 0;
for (const p of plan) {
  if (p.crear.length === 0) continue;
  let creados = 0;
  let saltados = 0;
  for (const d of p.crear) {
    const ref = db.doc(`tenants/${p.tenant}/comprobantesRecibidos/${d.id}`);
    try {
      await ref.create(d.datos);
    } catch (e) {
      // 6 = ALREADY_EXISTS: otro camino lo escribió entre el análisis y ahora. Se salta.
      if (e && e.code === 6) { saltados += 1; continue; }
      fallos += 1;
      console.log(`    ✗ ${p.tenant}: falló una escritura (código ${e?.code ?? 'desconocido'})`);
      continue;
    }
    const leido = await ref.get();
    const ok = leido.exists && ['idMeta', 'conversacionId', 'estado', 'motivo', 'ruta', 'intentos']
      .every((k) => leido.get(k) === d.datos[k])
      && leido.get('en').isEqual(d.datos.en) && leido.get('vence').isEqual(d.datos.vence);
    if (!ok) { fallos += 1; console.log(`    ✗ ${p.tenant}: un documento releído no coincide`); continue; }
    creados += 1;
  }
  if (creados > 0) {
    await db.collection(`tenants/${p.tenant}/auditoria`).doc().create({
      accion: 'copiar_comprobantes_recibidos', uid: OPERADOR, origen: 'script', script: 'copiar-comprobantes-recibidos',
      en: Timestamp.now(), creados, saltados,
    });
  }
  console.log(`  ${p.tenant}: ${creados} creado(s) y releído(s) · ${saltados} ya existían`);
}
console.log(`\n  Fallos: ${fallos}\n`);
process.exit(fallos > 0 ? 1 : 0);
