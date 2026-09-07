/**
 * Completa `flujos` en las fichas que solo tienen `vertical`, y crea el
 * documento de configuración de cada flujo si falta.
 *
 * POR QUÉ EXISTE. El 2026-09-06 la ficha del negocio pasó de un flujo único
 * (`vertical`) a una lista (`flujos`). Las reglas y la consola caen en
 * `vertical` cuando la lista no está, así que nada se rompe sin correr esto;
 * pero todo lo que venga después —agregar un segundo flujo a un negocio— parte
 * de la lista, y conviene que exista en todas las fichas.
 *
 * Es idempotente: una ficha que ya tiene lista no se toca, y un documento de
 * configuración que ya existe no se pisa.
 *
 *   node scripts/completar-flujos.mjs --proyecto <id-del-proyecto>
 */
const args = process.argv.slice(2);
const iProy = args.indexOf('--proyecto');
const PROYECTO = iProy >= 0 ? args[iProy + 1] : null;
if (!PROYECTO) {
  console.error('Uso: node scripts/completar-flujos.mjs --proyecto <id>');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

// Misma tabla que `documentoDeVertical` en functions/src/prompt.ts.
const DOCUMENTO = { agendamiento: 'agendamiento', venta: 'venta' };

const fichas = await db.collection('tenants').get();
let completadas = 0, creados = 0;
for (const ficha of fichas.docs) {
  const datos = ficha.data();
  const flujos = Array.isArray(datos.flujos) && datos.flujos.length > 0
    ? datos.flujos
    : (typeof datos.vertical === 'string' && datos.vertical ? [datos.vertical] : []);

  if (!Array.isArray(datos.flujos)) {
    await ficha.ref.update({ flujos });
    completadas += 1;
  }
  for (const flujo of flujos) {
    const documento = DOCUMENTO[flujo];
    if (!documento) continue;
    const ref = ficha.ref.collection('config').doc(documento);
    if (!(await ref.get()).exists) {
      await ref.set({ actualizadoPor: 'completar-flujos', actualizadoEn: Timestamp.now() });
      creados += 1;
    }
  }
  console.log(`  ${ficha.id}: flujos ${JSON.stringify(flujos)}`);
}
console.log(`\n${fichas.size} fichas · ${completadas} completadas · ${creados} documentos de configuración creados`);
