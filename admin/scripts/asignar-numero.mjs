#!/usr/bin/env node
/**
 * =============================================================================
 * ASIGNAR UN NÚMERO DE WHATSAPP A UN NEGOCIO, CON SU FLUJO Y SU ALIAS DE SECRETO
 * =============================================================================
 *
 * Hace lo mismo que la Function `asignarNumero` (unicidad del número, suma del
 * flujo a la ficha, documento del flujo) y además escribe `aliasSecreto` en la
 * ruta, que la Function no escribe y sin el cual la ingesta no autentica.
 * Existe porque la consola no tiene pantalla para esto y el alta de un cliente
 * real lo necesita en el paso 3 (`DISENO.md` §6.1).
 *
 * El `phone_number_id` NUNCA va en un archivo del repositorio: se pasa por
 * línea de comandos y se toma de `CONFIGURACION.local.md` o del panel de Meta.
 *
 *   node scripts/asignar-numero.mjs --proyecto <id> --tenant salon-rosa \
 *     --phone-number-id <id del numero> --waba-id <id de la WABA> \
 *     --flujo agendamiento --alias cliente01 --aplicar
 *
 * Para el número de NovuChat: `--tenant novuchat --flujo interno --alias cliente20`.
 * Sin `--aplicar` no escribe nada.
 */
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');

const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const PNID = opcion('phone-number-id') ?? '';
const WABA = opcion('waba-id') ?? '';
const FLUJO = opcion('flujo') ?? '';
const ALIAS = opcion('alias') ?? '';

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(TENANT)) problemas.push('--tenant inválido');
if (!/^[0-9]{6,25}$/.test(PNID)) problemas.push('--phone-number-id: solo dígitos');
if (!/^[0-9]{6,25}$/.test(WABA)) problemas.push('--waba-id: solo dígitos');
if (!['agendamiento', 'venta', 'interno'].includes(FLUJO)) problemas.push('--flujo: agendamiento, venta o interno');
if (!/^(demoA|demoB|cliente(0[1-9]|1[0-9]|20))$/.test(ALIAS)) problemas.push('--alias: demoA, demoB o cliente01…cliente20');
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ ') + '\n');
  process.exit(2);
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('\n  ✗ hay FIRESTORE_EMULATOR_HOST en el entorno y esto opera sobre el proyecto real.\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const DOCUMENTO = { agendamiento: 'agendamiento', venta: 'venta' };

const ruta = await db.doc(`rutasWhatsApp/${PNID}`).get();
const tenant = await db.doc(`tenants/${TENANT}`).get();
if (!tenant.exists) { console.error(`\n  ✗ No existe el negocio «${TENANT}».\n`); process.exit(1); }
if (ruta.exists && ruta.get('tenantId') !== TENANT) {
  console.error('\n  ✗ Ese número ya está asignado a OTRO negocio. Liberalo primero.\n');
  process.exit(1);
}
// Un alias es un secreto: dos números con el mismo alias comparten clave, y
// comprometer uno alcanzaría al otro. Se rechaza.
const mismoAlias = await db.collection('rutasWhatsApp').where('aliasSecreto', '==', ALIAS).get();
const otro = mismoAlias.docs.find((d) => d.id !== PNID);
if (otro) {
  console.error(`\n  ✗ El alias «${ALIAS}» ya lo usa otro número (${otro.get('tenantId')}). Elegí el siguiente libre.\n`);
  process.exit(1);
}

console.log(`\n  Negocio : ${TENANT} (${tenant.get('nombre')})`);
console.log(`  Número  : cargado · flujo ${FLUJO} · alias ${ALIAS}`);
console.log(`  Ruta    : ${ruta.exists ? 'existe (se actualiza)' : 'nueva'}\n`);

if (!APLICAR) { console.log('  Seco: no se escribió nada. Agregá --aplicar.\n'); process.exit(0); }

await db.runTransaction(async (tx) => {
  const refConfig = DOCUMENTO[FLUJO] ? db.doc(`tenants/${TENANT}/config/${DOCUMENTO[FLUJO]}`) : null;
  const config = refConfig ? await tx.get(refConfig) : null;
  tx.set(db.doc(`rutasWhatsApp/${PNID}`), {
    tenantId: TENANT, flujo: FLUJO, wabaId: WABA, aliasSecreto: ALIAS,
    estado: tenant.get('estado') ?? 'activo',
    asignadoEn: Timestamp.now(), asignadoPor: 'asignar-numero',
  }, { merge: true });
  tx.update(tenant.ref, {
    waPhoneNumberId: PNID, waWabaId: WABA,
    vertical: tenant.get('vertical') ?? FLUJO,
    flujos: FieldValue.arrayUnion(FLUJO),
  });
  if (refConfig && config && !config.exists) {
    tx.set(refConfig, { actualizadoPor: 'asignar-numero', actualizadoEn: Timestamp.now() });
  }
});
await db.collection(`tenants/${TENANT}/auditoria`).add({
  accion: 'asignar_numero', uid: 'asignar-numero', en: Timestamp.now(), flujo: FLUJO, alias: ALIAS,
});
console.log('  ✓ ruta escrita, ficha actualizada.');
console.log(`  Ahora: el valor del secreto INGESTA_${ALIAS.toUpperCase()} va como credencial de cabecera en n8n.\n`);
