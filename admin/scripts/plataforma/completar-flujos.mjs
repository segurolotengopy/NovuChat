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
 * configuración que ya existe no se pisa (se crea con `create`, sin carrera).
 * NO TIENE MODO SECO: escribe al correrlo. Desde H2b-3 su `DOCUMENTO` sale del
 * registro y por eso también crea `config/onboarding` en las fichas de captación
 * que no lo tengan (antes las ignoraba). Seguimiento: darle `--aplicar`.
 *
 *   node scripts/plataforma/completar-flujos.mjs --proyecto <id-del-proyecto>
 */
import { IDS_FLUJOS, documentoDeFlujo } from '../../functions/src/registro.ts';

const args = process.argv.slice(2);
const iProy = args.indexOf('--proyecto');
const PROYECTO = iProy >= 0 ? args[iProy + 1] : null;
if (!PROYECTO) {
  console.error('Uso: node scripts/plataforma/completar-flujos.mjs --proyecto <id>');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

// El documento de cada flujo sale del registro (antes faltaba `onboarding`).
const DOCUMENTO = Object.fromEntries(IDS_FLUJOS.map((f) => [f, documentoDeFlujo(f)]));

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
    // `create` falla si ya existe: sin carrera y sin pisar lo que haya (ALREADY_EXISTS = ya estaba).
    try {
      await ref.create({ actualizadoPor: 'completar-flujos', actualizadoEn: Timestamp.now() });
      creados += 1;
    } catch (e) {
      if (e?.code !== 6 && !/ALREADY_EXISTS/.test(String(e?.message ?? e))) throw e;
    }
  }
  console.log(`  ${ficha.id}: flujos ${JSON.stringify(flujos)}`);
}
console.log(`\n${fichas.size} fichas · ${completadas} completadas · ${creados} documentos de configuración creados`);
