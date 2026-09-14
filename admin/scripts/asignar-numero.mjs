/**
 * ASIGNAR EL NÚMERO DE WHATSAPP DE UN COMERCIO, CON SU ALIAS DE INGESTA.
 *
 * POR QUÉ EXISTE. El procedimiento de alta (`DISENO.md` §6.1) dice «asignarNumero
 * desde la consola, más `aliasSecreto` en /rutasWhatsApp». Pero ninguna pantalla
 * de la consola llama a la Function `asignarNumero`, y las reglas prohíben que
 * cualquier navegador escriba `/rutasWhatsApp` (solo el SDK Admin). Además la
 * Function no escribe `aliasSecreto`, sin el cual `rutaAutenticada` rechaza todo
 * lo que mande n8n. O sea: el paso 3 del alta no tenía ningún camino. Se
 * descubrió el 2026-09-14 al dar de alta a NovuChat como su propio cliente.
 *
 * QUÉ HACE, lo mismo que `asignarNumero` (functions/src/index.ts) y lo que le
 * faltaba, en UNA transacción:
 *   - rechaza un número que ya apunta a OTRO comercio (una fuga de datos por un
 *     error de dedo);
 *   - rechaza un alias que ya usa OTRO número (dos números con el mismo secreto
 *     rompen «un secreto por número», que es lo que limita el daño de filtrar uno);
 *   - escribe la ruta con `aliasSecreto`; suma el flujo a la ficha sin quitar los
 *     que tenía; crea el documento de config del flujo si faltaba; deja auditoría.
 *
 * LOS ALIAS VÁLIDOS SE LEEN DE `functions/src/firma.ts`, no de una copia: si se
 * amplía la reserva allá, este script la ve sin tocarlo.
 *
 *   node scripts/asignar-numero.mjs --proyecto <id> --listar
 *   node scripts/asignar-numero.mjs --proyecto <id> --tenant novuchat \
 *     --numero <phone_number_id> --waba <waba_id> --flujo onboarding --alias cliente01
 *
 * Sin `--aplicar` no escribe nada: dice qué haría. Nunca imprime identificadores
 * completos: solo sus últimos cuatro dígitos.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const LISTAR = args.includes('--listar');

const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const NUMERO = (opcion('numero') ?? '').trim();
const WABA = (opcion('waba') ?? '').trim();
const FLUJO = (opcion('flujo') ?? '').trim();
const ALIAS = (opcion('alias') ?? '').trim();

// Mismos formatos que `ID_TENANT`, `ID_NUMERO` y `VERTICALES` de functions/src/index.ts.
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const ID_NUMERO = /^[0-9]{6,25}$/;
const FLUJOS_VALIDOS = new Set(['agendamiento', 'venta', 'onboarding']);
// Mismo mapa que `documentoDeVertical` en functions/src/prompt.ts.
const DOCUMENTO = { agendamiento: 'agendamiento', venta: 'venta', onboarding: 'onboarding' };

const firma = readFileSync(new URL('../functions/src/firma.ts', import.meta.url), 'utf8');
const RESERVA = [...firma.matchAll(/^\s*(\w+):\s*defineSecret\('([A-Z0-9_]+)'\)/gm)]
  .map((m) => ({ alias: m[1], secreto: m[2] }));
const ALIAS_VALIDOS = new Set(RESERVA.map((r) => r.alias));

const cola = (v) => (v ? `…${String(v).slice(-4)}` : '—');

if (!PROYECTO) {
  console.error('\n  ✗ falta --proyecto\n'); process.exit(2);
}
if (!LISTAR) {
  const problemas = [];
  if (!ID_TENANT.test(TENANT)) problemas.push('--tenant inválido (minúsculas, guiones, 3 a 60)');
  if (!ID_NUMERO.test(NUMERO)) problemas.push('--numero no es un phone_number_id (solo dígitos, 6 a 25)');
  if (!ID_NUMERO.test(WABA)) problemas.push('--waba no es un WABA ID (solo dígitos, 6 a 25)');
  if (NUMERO && NUMERO === WABA) problemas.push('--numero y --waba son iguales: son dos IDs distintos');
  if (!FLUJOS_VALIDOS.has(FLUJO)) problemas.push(`--flujo desconocido: ${FLUJO || '(vacío)'}`);
  if (!ALIAS_VALIDOS.has(ALIAS)) problemas.push(`--alias no está en la reserva de firma.ts: ${ALIAS || '(vacío)'}`);
  if (problemas.length) {
    console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
    console.error('\n  node scripts/asignar-numero.mjs --proyecto <id> --tenant <id> --numero <phone_number_id> \\');
    console.error('      --waba <waba_id> --flujo <flujo> --alias <clienteNN> [--aplicar]');
    console.error('  node scripts/asignar-numero.mjs --proyecto <id> --listar\n');
    process.exit(2);
  }
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

// --- listar: qué alias están tomados y cuáles quedan -------------------------
if (LISTAR) {
  const rutas = await db.collection('rutasWhatsApp').get();
  const usados = new Map();
  console.log(`\n  Rutas de WhatsApp en ${PROYECTO}: ${rutas.size}\n`);
  for (const r of rutas.docs) {
    const alias = String(r.get('aliasSecreto') ?? '');
    if (alias) usados.set(alias, (usados.get(alias) ?? 0) + 1);
    console.log(`  número ${cola(r.id)} · ${String(r.get('tenantId') ?? '?').padEnd(24)}`
      + ` · ${String(r.get('flujo') ?? '?').padEnd(12)} · alias ${alias || '(sin alias)'}`
      + ` · ${r.get('estado') ?? '?'}`);
  }
  const libres = RESERVA.filter((r) => !usados.has(r.alias)).map((r) => r.alias);
  const repetidos = [...usados].filter(([, n]) => n > 1).map(([a]) => a);
  console.log(`\n  Alias libres (${libres.length}): ${libres.join(', ') || 'ninguno'}`);
  if (repetidos.length) console.log(`  ✗ Alias usados por más de un número: ${repetidos.join(', ')}`);
  console.log(`  Siguiente para un cliente: ${libres.find((a) => a.startsWith('cliente')) ?? 'NINGUNO: ampliar la reserva'}\n`);
  process.exit(0);
}

const refRuta = db.doc(`rutasWhatsApp/${NUMERO}`);
const refTenant = db.doc(`tenants/${TENANT}`);
const documento = DOCUMENTO[FLUJO] ?? null;
const refConfig = documento ? db.doc(`tenants/${TENANT}/config/${documento}`) : null;
const secreto = RESERVA.find((r) => r.alias === ALIAS)?.secreto;

console.log(`\n  Negocio   : ${TENANT}`);
console.log(`  Número    : ${cola(NUMERO)} · WABA ${cola(WABA)}`);
console.log(`  Flujo     : ${FLUJO}`);
console.log(`  Alias     : ${ALIAS} (secreto ${secreto})`);
console.log(`  Proyecto  : ${PROYECTO}\n`);

let plan;
await db.runTransaction(async (tx) => {
  // Lecturas antes que escrituras, como exige la transacción.
  const [ruta, tenant, config, conAlias] = await Promise.all([
    tx.get(refRuta), tx.get(refTenant),
    refConfig ? tx.get(refConfig) : Promise.resolve(null),
    tx.get(db.collection('rutasWhatsApp').where('aliasSecreto', '==', ALIAS).limit(5)),
  ]);

  if (!tenant.exists) throw new Error(`No existe el comercio «${TENANT}». Primero alta-comercio.mjs.`);
  if (ruta.exists && ruta.get('tenantId') !== TENANT) {
    throw new Error('Ese número ya está asignado a OTRO comercio. Libérelo primero.');
  }
  const otro = conAlias.docs.find((d) => d.id !== NUMERO);
  if (otro) {
    throw new Error(`El alias ${ALIAS} ya lo usa el número ${cola(otro.id)} (${otro.get('tenantId')}). `
      + 'Use el siguiente libre: --listar.');
  }

  plan = {
    rutaNueva: !ruta.exists,
    configNueva: Boolean(refConfig && config && !config.exists),
    estado: tenant.get('estado') ?? 'activo',
    flujosAntes: tenant.get('flujos') ?? [tenant.get('vertical')].filter(Boolean),
  };
  if (!APLICAR) return;

  tx.set(refRuta, {
    tenantId: TENANT, flujo: FLUJO, wabaId: WABA, aliasSecreto: ALIAS,
    estado: plan.estado,
    asignadoEn: Timestamp.now(), asignadoPor: 'asignar-numero',
  }, { merge: true });
  tx.update(refTenant, {
    waPhoneNumberId: NUMERO, waWabaId: WABA,
    vertical: tenant.get('vertical') ?? FLUJO,
    flujos: FieldValue.arrayUnion(FLUJO),
  });
  if (plan.configNueva) {
    tx.set(refConfig, { actualizadoPor: 'asignar-numero', actualizadoEn: Timestamp.now() });
  }
  tx.create(db.collection(`tenants/${TENANT}/auditoria`).doc(), {
    accion: 'asignar_numero', uid: 'asignar-numero', en: Timestamp.now(),
    phoneNumberId: NUMERO, wabaId: WABA, flujo: FLUJO, aliasSecreto: ALIAS,
  });
});

console.log(`  Ruta      : ${plan.rutaNueva ? 'se crea' : 'ya existía, se actualiza'}`);
console.log(`  Ficha     : flujos ${JSON.stringify(plan.flujosAntes)} + ${FLUJO} · estado ${plan.estado}`);
console.log(`  Config    : ${documento ? (plan.configNueva ? `se crea config/${documento}` : `config/${documento} ya existe`) : 'sin documento propio'}`);

if (!APLICAR) {
  console.log('\n  Seco: no se escribió nada. Agregue --aplicar.\n');
  process.exit(0);
}

// --- verificación por relectura ---------------------------------------------
const ruta = await refRuta.get();
const ficha = await refTenant.get();
const ok = ruta.get('tenantId') === TENANT && ruta.get('aliasSecreto') === ALIAS
  && ruta.get('flujo') === FLUJO && (ficha.get('flujos') ?? []).includes(FLUJO)
  && ficha.get('waPhoneNumberId') === NUMERO;
console.log(`\n  ${ok ? '✓' : '✗'} Verificación: ruta → ${ruta.get('tenantId')} · alias ${ruta.get('aliasSecreto')}`
  + ` · flujos ${JSON.stringify(ficha.get('flujos'))}\n`);
console.log('  Siguiente: el valor del secreto va a la credencial de cabecera de n8n');
console.log(`  (Name: Authorization · Value: Bearer <valor>), nunca al repositorio:`);
console.log(`    gcloud secrets versions access latest --secret=${secreto} --project ${PROYECTO}\n`);
if (!ok) process.exit(1);
