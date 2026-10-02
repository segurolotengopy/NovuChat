#!/usr/bin/env node
/**
 * Borra los cierres cuya referencia empieza con `verificacion_`, `prueba_`,
 * `diag_`, `tok_` o `cruz_`, y recalcula el contador del período.
 *
 * POR QUÉ RECALCULA EN VEZ DE RESTAR. El contador es lo que se factura. Restar
 * uno por cada borrado deja el número correcto solo si no se perdió ninguna
 * escritura; recontar los documentos que quedan deja el número correcto SIEMPRE.
 * Cuando la cifra sostiene una factura, se prefiere la operación que no depende
 * de que nada haya fallado antes.
 *
 * Es lo único del sistema que borra un cierre, y por eso vive acá y no en la
 * consola: las reglas prohíben borrar cierres desde cualquier cliente, incluida
 * la cuenta de NovuChat.
 *
 *   node scripts/limpiar-cierres-de-prueba.mjs --proyecto novuchat-demo
 */
const args = process.argv.slice(2);
const i = args.indexOf('--proyecto');
const PROYECTO = i >= 0 ? args[i + 1] : null;
if (!PROYECTO) {
  console.error('\nFalta --proyecto <id>.\n');
  process.exit(1);
}

const DE_PRUEBA = /^(verificacion|prueba|diag|tok|cruz)_/;

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const tenants = await db.collection('tenants').get();
console.log(`\nProyecto ${PROYECTO}\n`);

for (const t of tenants.docs) {
  const cierres = await db.collection(`tenants/${t.id}/cierres`).get();
  let borrados = 0;
  for (const d of cierres.docs) {
    if (!DE_PRUEBA.test(String(d.get('referencia') ?? ''))) continue;
    await d.ref.collection('privado').doc('datos').delete().catch(() => {});
    await d.ref.delete();
    borrados++;
  }

  // Recuento real por período, a partir de lo que quedó.
  const quedan = await db.collection(`tenants/${t.id}/cierres`).get();
  const porPeriodo = new Map();
  for (const d of quedan.docs) {
    const f = d.get('ocurridoEn')?.toDate?.();
    if (!f) continue;
    const p = f.toISOString().slice(0, 7);
    porPeriodo.set(p, (porPeriodo.get(p) ?? 0) + 1);
  }
  const periodoActual = new Date().toISOString().slice(0, 7);
  if (!porPeriodo.has(periodoActual)) porPeriodo.set(periodoActual, 0);
  for (const [p, n] of porPeriodo) {
    await db.doc(`tenants/${t.id}/metricas/${p}`).set({ cierres: n }, { merge: true });
  }

  console.log(`  ${t.id}: ${borrados} borrado(s) · quedan ${quedan.size}`
    + ` · contador ${periodoActual} = ${porPeriodo.get(periodoActual)}`);
}
console.log();
