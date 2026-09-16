/**
 * ASIGNAR EL PLAN DE UN COMERCIO, CON LA COPIA DE SUS LÍMITES.
 *
 * POR QUÉ EXISTE. El plan de un comercio vive en `tenants/{t}/cuenta/estado`
 * (`plan`, más la copia `limites` y la versión `catalogoPlanes`), y quien hace
 * cumplir un límite lee la copia (`functions/src/planes.ts`, `Analisis/29`
 * §2.2-2.3). La callable `actualizarEstadoCuenta` lo hace, pero ninguna pantalla
 * la llama todavía. Este script es el camino para los demos, para NovuChat misma
 * y para migrar los comercios dados de alta con el viejo `plan: 'basico'`.
 *
 * QUÉ HACE, lo mismo que la callable cuando recibe `plan`, en UNA transacción:
 *   - rechaza un plan que no está en el catálogo (no hay texto libre);
 *   - rechaza un comercio que no existe o que está dado de baja;
 *   - escribe en la cuenta `plan`, `limites` (copia entera, reemplazando la
 *     anterior) y `catalogoPlanes`, sin tocar nada más (estado de pago,
 *     mensualidad, umbrales, motivo);
 *   - actualiza el espejo `tenants/{t}.plan`;
 *   - deja auditoría `cambiar_plan` con el antes y el después.
 * Si el comercio ya tiene ese plan con esos límites, no escribe nada.
 *
 * EL CATÁLOGO SE IMPORTA DE `functions/src/planes.ts`, no se copia: Node 22.18+
 * carga TypeScript sin compilar, y `planes.ts` es puro a propósito.
 *
 *   node scripts/asignar-plan.mjs --proyecto <id> --tenant demo-venta --plan demostracion
 *   node scripts/asignar-plan.mjs --proyecto <id> --tenant salon-rosa --plan crecimiento --aplicar
 *
 * Sin `--aplicar` no escribe nada: dice qué haría.
 */
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');

const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const PLAN = (opcion('plan') ?? '').trim();

const { PLANES_ASIGNABLES, CATALOGO_PLANES, esIdPlan, limitesDe } =
  await import('../functions/src/planes.ts');

// Mismo formato que `ID_TENANT` en functions/src/index.ts.
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!ID_TENANT.test(TENANT)) problemas.push('--tenant inválido (minúsculas, guiones, 3 a 60)');
if (!esIdPlan(PLAN)) {
  problemas.push(`--plan desconocido: ${PLAN || '(vacío)'}. Del catálogo: ${Object.keys(PLANES_ASIGNABLES).join(', ')}`);
}
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/asignar-plan.mjs --proyecto <id> --tenant <id> --plan <plan> [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const refFicha = db.doc(`tenants/${TENANT}`);
const refCuenta = db.doc(`tenants/${TENANT}/cuenta/estado`);
const limites = limitesDe(PLAN);
const plan = PLANES_ASIGNABLES[PLAN];
const texto = (l) => (l && typeof l === 'object'
  ? `${l.conversaciones ?? '?'} conversaciones · ${l.productos ?? '?'} productos · ${l.agendas ?? '?'} agendas`
  : '(sin copia de límites)');

console.log(`\n  Negocio   : ${TENANT}`);
console.log(`  Plan      : ${PLAN} (${plan.nombre}, USD ${plan.precioUsd})`);
console.log(`  Límites   : ${texto(limites)}`);
console.log(`  Catálogo  : ${CATALOGO_PLANES}`);
console.log(`  Proyecto  : ${PROYECTO}\n`);

// UN RECHAZO NO SE LANZA DENTRO DE LA TRANSACCIÓN: se devuelve. Si el callback
// lanza, el SDK manda el rollback SIN esperarlo («best effort», transaction.js),
// y un script que termina enseguida puede irse antes de que llegue: los
// documentos leídos quedan bloqueados hasta que el bloqueo vence, y cualquier
// escritura sobre ellos espera. Se vio el 15/09 en el emulador, con otro script
// que sí lanza. Devolviendo el rechazo, la transacción cierra sin escrituras y
// libera todo.
let resumen;
try {
  await db.runTransaction(async (tx) => {
    // Lecturas antes que escrituras, como exige la transacción.
    const [ficha, cuenta] = await Promise.all([tx.get(refFicha), tx.get(refCuenta)]);
    if (!ficha.exists) {
      resumen = { error: `No existe el comercio «${TENANT}». Primero alta-comercio.mjs.` };
      return;
    }
    if (ficha.get('estado') === 'dado_de_baja') {
      resumen = { error: `«${TENANT}» está dado de baja: no se le asigna plan.` };
      return;
    }

    const antes = {
      plan: cuenta.get('plan') ?? null,
      limites: cuenta.get('limites') ?? null,
      catalogo: cuenta.get('catalogoPlanes') ?? null,
      espejo: ficha.get('plan') ?? null,
    };
    const mismosLimites = antes.limites !== null
      && ['conversaciones', 'productos', 'agendas'].every((k) => antes.limites[k] === limites[k]);
    const sinCambios = antes.plan === PLAN && antes.espejo === PLAN
      && antes.catalogo === CATALOGO_PLANES && mismosLimites;
    resumen = { antes, sinCambios, cuentaNueva: !cuenta.exists };
    if (!APLICAR || sinCambios) return;

    const ahora = Timestamp.now();
    const escritura = { plan: PLAN, limites, catalogoPlanes: CATALOGO_PLANES, actualizadoEn: ahora };
    // `update` reemplaza `limites` entero; `set` solo si la cuenta no existía.
    if (cuenta.exists) tx.update(refCuenta, escritura); else tx.set(refCuenta, escritura);
    tx.update(refFicha, { plan: PLAN });
    tx.create(db.collection(`tenants/${TENANT}/auditoria`).doc(), {
      accion: 'cambiar_plan', uid: 'asignar-plan', en: ahora,
      planAntes: antes.plan, planDespues: PLAN,
      limitesAntes: antes.limites, limitesDespues: limites,
      catalogoPlanes: CATALOGO_PLANES,
    });
  });
} catch (e) {
  console.error(`  ✗ ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
if (resumen.error) {
  console.error(`  ✗ ${resumen.error}\n`);
  process.exit(1);
}

console.log(`  Antes     : plan ${resumen.antes.plan ?? '(ninguno)'} · espejo ${resumen.antes.espejo ?? '(ninguno)'}`
  + ` · catálogo ${resumen.antes.catalogo ?? '(ninguno)'}`);
console.log(`              ${texto(resumen.antes.limites)}`);
console.log(`  Cuenta    : ${resumen.cuentaNueva ? 'no existía, se crea' : 'existe, se actualiza solo el plan'}`);

if (resumen.sinCambios) {
  console.log('\n  Sin cambios: ya tiene ese plan, con esos límites y ese catálogo.\n');
  process.exit(0);
}
if (!APLICAR) {
  console.log('\n  Seco: no se escribió nada. Agregue --aplicar.\n');
  process.exit(0);
}

// --- verificación por relectura ---------------------------------------------
const [cuenta, ficha] = await Promise.all([refCuenta.get(), refFicha.get()]);
const copia = cuenta.get('limites') ?? {};
const ok = cuenta.get('plan') === PLAN && ficha.get('plan') === PLAN
  && cuenta.get('catalogoPlanes') === CATALOGO_PLANES
  && ['conversaciones', 'productos', 'agendas'].every((k) => copia[k] === limites[k]);
console.log(`\n  ${ok ? '✓' : '✗'} Verificación: cuenta ${cuenta.get('plan')} · espejo ${ficha.get('plan')}`
  + ` · ${texto(copia)}\n`);
if (!ok) process.exit(1);
