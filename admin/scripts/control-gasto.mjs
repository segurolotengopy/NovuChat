/**
 * CONTROL DE GASTO — qué nos va a cobrar Meta este mes, por comercio.
 *
 * POR QUÉ EXISTE. Desde el 1 de octubre de 2026 Meta cobra cada respuesta del
 * asistente y es el 94 % de lo que cuesta el servicio. La consola muestra
 * CONVERSACIONES, que es lo que se le factura al comercio; esto muestra
 * MENSAJES, que es lo que Meta nos factura a nosotros. Sin este número, la
 * primera noticia del gasto es la factura.
 *
 * QUÉ MIRAR, EN ESTE ORDEN:
 *
 *  1. **La franquicia.** Mil mensajes gratis por número y por mes. Un comercio
 *     por debajo no cuesta nada; uno por encima cuesta cada mensaje. La columna
 *     «franquicia» dice cuánto lleva consumido.
 *  2. **Los mensajes por conversación.** Es la palanca más grande que queda:
 *     bajar de 10 a 6 no ahorra un 38 %, además duplica cuántas conversaciones
 *     entran en la franquicia.
 *  3. **La cola.** El promedio esconde lo que cuesta: diez conversaciones de 4
 *     y una de 40 promedian 7, y lo que se paga es la de 40. `--detalle` abre
 *     la distribución por tramos.
 *
 *   node scripts/control-gasto.mjs --proyecto <id>
 *   node scripts/control-gasto.mjs --proyecto <id> --periodo 2026-10 --detalle
 *   node scripts/control-gasto.mjs --proyecto <id> --tenant salon-rosa --detalle
 *
 * SOLO LEE. No escribe nada y no toca ninguna conversación: las métricas son
 * agregados por mes, sin contenido ni teléfonos.
 */
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const DETALLE = args.includes('--detalle');

const PROYECTO = opcion('proyecto');
const TENANT = opcion('tenant');

let costos, prepago;
try {
  costos = await import('../functions/lib/costos.js');
  prepago = await import('../functions/lib/prepago.js');
} catch {
  console.error('\n  ✗ Falta functions/lib: corra `pnpm functions:build` primero.\n');
  process.exit(2);
}
const { FRANQUICIA_MENSUAL, distribucionDe, proyectar, seCobra } = costos;
const { periodoDe } = prepago;

const PERIODO = opcion('periodo') ?? periodoDe(Date.now());

if (!PROYECTO || !/^\d{4}-\d{2}$/.test(PERIODO)) {
  console.error('\n  node scripts/control-gasto.mjs --proyecto <id> [--periodo aaaa-mm] [--tenant <id>] [--detalle]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const V = '\x1b[1;32m', A = '\x1b[1;33m', R = '\x1b[1;31m', G = '\x1b[0;90m', FIN = '\x1b[0m';

const fichas = TENANT
  ? [await db.doc(`tenants/${TENANT}`).get()].filter((d) => d.exists)
  : (await db.collection('tenants').where('estado', '==', 'activo').limit(500).get()).docs;

if (fichas.length === 0) {
  console.error(`\n  ✗ No hay comercios que mirar en ${PROYECTO}.\n`);
  process.exit(1);
}

const filas = [];
for (const ficha of fichas) {
  const metricas = (await db.doc(`tenants/${ficha.id}/metricas/${PERIODO}`).get()).data();
  const p = proyectar({
    // `salientes` se cuenta desde el 08/09/2026. Para los meses anteriores se
    // deriva, que es lo mejor que hay: mensajes menos entrantes.
    salientes: Number(metricas?.salientes ?? ((Number(metricas?.mensajes ?? 0)) - (Number(metricas?.entrantes ?? 0)))),
    conversaciones: Number(metricas?.conversaciones ?? metricas?.atenciones ?? 0),
  }, PERIODO);
  filas.push({
    id: ficha.id,
    nombre: String(ficha.get('nombre') ?? ''),
    derivado: metricas?.salientes === undefined,
    distribucion: distribucionDe(metricas?.distribucion),
    ...p,
  });
}
filas.sort((a, b) => b.costoUsd - a.costoUsd || b.salientes - a.salientes);

const color = (pct) => (pct >= 100 ? R : pct >= 70 ? A : V);
const n = (x, ancho) => String(x).padStart(ancho);

console.log(`\n  Gasto de Meta · ${PROYECTO} · ${PERIODO}`);
console.log(`  ${seCobra(PERIODO) ? `Se cobra cada mensaje del asistente, con ${FRANQUICIA_MENSUAL} gratis por número` : `${G}Mes anterior al 1 de octubre: los mensajes de servicio todavía son gratis${FIN}`}\n`);
console.log(`  ${'Comercio'.padEnd(24)} ${'Convers.'.padStart(8)} ${'Mensajes'.padStart(9)} ${'Msg/conv'.padStart(9)} ${'Franquicia'.padStart(11)} ${'Se pagan'.padStart(9)} ${'USD'.padStart(8)}`);
console.log(`  ${'-'.repeat(24)} ${'-'.repeat(8)} ${'-'.repeat(9)} ${'-'.repeat(9)} ${'-'.repeat(11)} ${'-'.repeat(9)} ${'-'.repeat(8)}`);

let totalUsd = 0, totalMsg = 0, totalConv = 0;
for (const f of filas) {
  totalUsd += f.costoUsd; totalMsg += f.salientes; totalConv += f.conversaciones;
  const etiqueta = `${f.nombre || f.id}`.slice(0, 24);
  const pct = `${color(f.porcentajeFranquicia)}${n(f.porcentajeFranquicia.toFixed(0) + '%', 11)}${FIN}`;
  console.log(`  ${etiqueta.padEnd(24)} ${n(f.conversaciones, 8)} ${n(f.salientes, 9)}${f.derivado ? `${G}*${FIN}` : ' '}${n(f.mensajesPorConversacion ?? '—', 8)} ${pct} ${n(f.facturables, 9)} ${n(f.costoUsd.toFixed(2), 8)}`);

  if (DETALLE && f.distribucion.total > 0) {
    const d = f.distribucion;
    const barra = d.tramos.map((t) => `${t.desde}-${Number.isFinite(t.hasta) ? t.hasta : '+'}: ${t.cuenta}`).join('  ');
    console.log(`  ${G}${' '.repeat(24)} ${barra}${FIN}`);
    console.log(`  ${G}${' '.repeat(24)} cola (más de 10 respuestas): ${d.cola} de ${d.total} (${d.porcentajeCola}%)${FIN}`);
  }
}

console.log(`  ${'-'.repeat(24)} ${'-'.repeat(8)} ${'-'.repeat(9)} ${'-'.repeat(9)} ${'-'.repeat(11)} ${'-'.repeat(9)} ${'-'.repeat(8)}`);
console.log(`  ${'TOTAL'.padEnd(24)} ${n(totalConv, 8)} ${n(totalMsg, 9)} ${n(totalConv > 0 ? (totalMsg / totalConv).toFixed(1) : '—', 9)} ${' '.repeat(11)} ${n(filas.reduce((s, f) => s + f.facturables, 0), 9)} ${n(totalUsd.toFixed(2), 8)}`);

if (filas.some((f) => f.derivado)) {
  console.log(`\n  ${G}* mensajes derivados de (mensajes − entrantes): ese mes todavía no se contaban aparte.${FIN}`);
}
const cargados = filas.filter((f) => f.porcentajeFranquicia >= 70);
if (cargados.length > 0) {
  console.log(`\n  ${A}Atención:${FIN} ${cargados.length} comercio(s) por encima del 70 % de su franquicia.`);
  console.log(`  ${G}La palanca es acortar la conversación, no subir el precio: bajar de 10 a 6`);
  console.log(`  respuestas duplica cuántas conversaciones entran en los 1.000 gratis.${FIN}`);
}
console.log();
