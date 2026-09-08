/**
 * CARGAR EL TIPO DE CAMBIO OFICIAL DEL BCB.
 *
 * La lista de precios está en dólares y se cobra en bolivianos (ver
 * `functions/src/prepago.ts`). Este script escribe `plataforma/tipoCambio`, que
 * es de donde sale la conversión. **Sin este documento no se puede cotizar**:
 * el sistema lanza en vez de inventar un tipo de cambio, y eso es deliberado.
 *
 * DE DÓNDE SALE EL NÚMERO. Del Tipo de Cambio Oficial que publica el Banco
 * Central de Bolivia, que desde el 29/06/2026 flota y se publica a diario.
 * NovuChat no publica un tipo de cambio propio: un proveedor que fija el tipo
 * de cambio con el que cobra invita a la sospecha, aunque lo fije bien. Se
 * carga a mano a propósito, para que quede claro quién lo puso y de qué día.
 *
 * CUÁNDO SE CARGA. Una vez por mes, el primer día hábil, con el TCO de ese día:
 * es la política implementada —un TCO por mes, fijo para todo el mes—, que es
 * la recomendada en `Analisis/17` §3.0 porque le permite a una PyME saber de
 * antemano cuánto va a pagar.
 *
 *   node scripts/fijar-tipo-cambio.mjs --proyecto <id> --tco 12.60
 *   node scripts/fijar-tipo-cambio.mjs --proyecto <id> --tco 12.60 --periodo 2026-10
 *
 * Sin `--aplicar` no escribe nada: muestra lo que hay y lo que quedaría.
 */
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');

const PROYECTO = opcion('proyecto');
const TCO = Number(opcion('tco'));
const FUENTE = opcion('fuente') ?? 'BCB · Tipo de Cambio Oficial';

let planes;
try {
  planes = await import('../functions/lib/prepago.js');
} catch {
  console.error('\n  ✗ Falta functions/lib/prepago.js: corra `pnpm functions:build` primero.\n');
  process.exit(2);
}
const { PLANES, BOLSA, TCO_MAXIMO, TCO_MINIMO, importeBs, periodoDe } = planes;

const PERIODO = opcion('periodo') ?? periodoDe(Date.now());

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!Number.isFinite(TCO) || TCO < TCO_MINIMO || TCO > TCO_MAXIMO) {
  problemas.push(`--tco debe ser un número entre ${TCO_MINIMO} y ${TCO_MAXIMO}`);
}
if (!/^\d{4}-\d{2}$/.test(PERIODO)) problemas.push('--periodo debe ser aaaa-mm');
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/fijar-tipo-cambio.mjs --proyecto <id> --tco 12.60 [--periodo aaaa-mm] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const ref = db.doc('plataforma/tipoCambio');
const actual = (await ref.get()).data();

console.log(`\n  Proyecto : ${PROYECTO}`);
console.log(`  Hoy      : ${actual ? `${actual.tco} (${actual.periodo}, ${actual.fuente})` : 'sin cargar'}`);
console.log(`  Quedaría : ${TCO} (${PERIODO}, ${FUENTE})\n`);
console.log('  Con este tipo de cambio, la lista queda así:\n');
for (const [id, p] of Object.entries(PLANES)) {
  console.log(`    ${p.nombre.padEnd(20)} USD ${String(p.precioUsd).padStart(3)}  =  Bs ${importeBs(p.precioUsd, TCO)}   (${p.conversaciones} conversaciones)`);
}
console.log(`    ${'Bolsa'.padEnd(20)} USD ${String(BOLSA.precioUsd).padStart(3)}  =  Bs ${importeBs(BOLSA.precioUsd, TCO)}   (${BOLSA.conversaciones} conversaciones)\n`);

if (!APLICAR) {
  console.log('  Sin --aplicar no se escribe nada.\n');
  process.exit(0);
}

await ref.set({
  tco: TCO, periodo: PERIODO, fuente: FUENTE, actualizadoEn: Timestamp.now(),
});
console.log('  ✓ escrito. Las funciones lo toman en menos de una hora, o al reiniciarse.\n');
