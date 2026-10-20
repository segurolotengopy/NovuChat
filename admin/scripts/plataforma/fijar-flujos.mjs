/**
 * FIJAR LOS FLUJOS DE UN COMERCIO (`tenants/{id}.flujos` y `.vertical`), UNO POR UNO, SECO POR OMISIÓN.
 *
 * POR QUÉ EXISTE. `alta-comercio.mjs` exige un flujo y `asignar-numero.mjs` solo SUMA flujos (`arrayUnion`): no había
 * forma de quitar uno. El 20/10/2026 `rroca-antonio` salió del alta con `agendamiento` provisional y Antonio vende
 * libros con QR: la consola le mostraba la agenda y guardó su QR en `config/agendamiento`, donde `activar-cobro-real`
 * lo rechaza (la seña no tiene importe). Este script corrige una ficha: deja EXACTAMENTE los flujos pedidos
 * (en ese orden; el primero es el `vertical`) y crea el documento de configuración del flujo agregado si faltaba.
 *
 * QUÉ NO HACE. No borra la configuración de un flujo quitado (queda sin uso, y se dice); no toca rutas, plan,
 * cobro ni usuarios; no cambia `modulos`; y rechaza, sin escribir, quitar un flujo que usa una ruta de WhatsApp del
 * comercio o cambiar una ficha que ya tiene `modulos`. La decisión es pura y está probada en
 * `fijar-flujos-logica.mjs`.
 *
 *   node scripts/plataforma/fijar-flujos.mjs --proyecto <id> --operador <correo> --tenant rroca-antonio --flujos venta
 *   ... --aplicar      # una sola transacción: ficha, config del flujo nuevo y auditoría
 *
 * Sin `--aplicar` no escribe nada. Salida: 0 hecho, o seco sin problemas; 1 rechazo o error; 2 llamada mal hecha.
 */
import { documentoDeFlujo, esFlujo } from '../../functions/src/registro.ts';
import { MAX_RUTAS, planearFlujos } from './fijar-flujos-logica.mjs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const PEDIDOS = (opcion('flujos') ?? '').split(',').map((f) => f.trim()).filter(Boolean);
const OPERADOR = (opcion('operador') ?? '').trim().toLowerCase();
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Estos comercios no se tocan desde acá (regla del proyecto).
const EXCLUIDOS = ['bellido', 'platinum'];
const esExcluido = (t) => EXCLUIDOS.some((e) => t.startsWith(e));

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!ID_TENANT.test(TENANT)) problemas.push('--tenant inválido');
if (esExcluido(TENANT)) problemas.push(`${TENANT} no se toca desde este script`);
if (!CORREO.test(OPERADOR)) problemas.push('--operador <correo> es obligatorio: es quien queda en la auditoría');
if (PEDIDOS.length === 0) problemas.push('falta --flujos');
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/plataforma/fijar-flujos.mjs --proyecto <id> --operador <correo> --tenant <id> --flujos <flujo[,flujo]> [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const refTenant = db.doc(`tenants/${TENANT}`);

// UN RECHAZO NO SE LANZA DENTRO DE LA TRANSACCIÓN: se devuelve (ver `asignar-numero.mjs` y por qué).
let resultado;
try {
  resultado = await db.runTransaction(async (tx) => {
    const [fichaSnap, rutasSnap] = await Promise.all([
      tx.get(refTenant), tx.get(db.collection('rutasWhatsApp').where('tenantId', '==', TENANT).limit(MAX_RUTAS + 1)),
    ]);
    const ficha = fichaSnap.exists ? fichaSnap.data() : null;
    const rutas = rutasSnap.docs.map((d) => ({ numero: d.id, flujo: d.get('flujo') }));
    const plan = planearFlujos({ ficha, pedidos: PEDIDOS, rutas, esFlujo });
    if (plan.error) return { error: plan.error };
    const configs = {};
    for (const f of [...plan.agregados, ...plan.quitados]) {
      const doc = documentoDeFlujo(f);
      configs[f] = doc ? (await tx.get(db.doc(`tenants/${TENANT}/config/${doc}`))).exists : null;
    }
    if (!APLICAR || plan.sinCambios) return { plan, configs };
    tx.update(refTenant, { flujos: plan.despues, vertical: plan.vertical });
    for (const f of plan.agregados) {
      const doc = documentoDeFlujo(f);
      if (doc && configs[f] === false) {
        tx.set(db.doc(`tenants/${TENANT}/config/${doc}`), { actualizadoPor: OPERADOR, actualizadoEn: Timestamp.now() });
      }
    }
    tx.create(db.collection(`tenants/${TENANT}/auditoria`).doc(), {
      accion: 'cambiar_flujos', uid: OPERADOR, origen: 'script', script: 'fijar-flujos', en: Timestamp.now(),
      antes: plan.antes, despues: plan.despues,
    });
    return { plan, configs, escrito: true };
  });
} catch (e) {
  console.error(`  ✗ ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
if (resultado.error) {
  console.error(`\n  ✗ ${resultado.error}\n`);
  process.exit(1);
}
const { plan, configs } = resultado;
console.log(`\n  Negocio   : ${TENANT}`);
console.log(`  Antes     : ${JSON.stringify(plan.antes)}`);
console.log(`  Después   : ${JSON.stringify(plan.despues)} · vertical ${plan.vertical}`);
console.log(`  Operador  : ${OPERADOR}`);
for (const f of plan.agregados) console.log(`  + ${f}: ${configs[f] === false ? 'se crea su documento de configuración' : 'su documento de configuración ya existe'}`);
for (const f of plan.quitados) console.log(`  - ${f}: se quita de la ficha; su configuración${configs[f] ? ' (existe)' : ''} NO se borra y queda sin uso`);
if (plan.sinCambios) { console.log('\n  Sin cambios: la ficha ya está así.\n'); process.exit(0); }
if (!APLICAR) { console.log('\n  Seco: no se escribió nada. Agregue --aplicar.\n'); process.exit(0); }
const despues = (await refTenant.get()).data() ?? {};
const ok = JSON.stringify(despues.flujos) === JSON.stringify(plan.despues) && despues.vertical === plan.vertical;
console.log(`\n  ${ok ? '✓' : '✗'} Verificación: flujos ${JSON.stringify(despues.flujos)} · vertical ${despues.vertical}\n`);
process.exit(ok ? 0 : 1);
