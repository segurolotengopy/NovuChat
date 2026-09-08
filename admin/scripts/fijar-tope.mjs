/**
 * AJUSTAR EL TOPE DE RESPUESTAS POR CONVERSACIÓN DE UN COMERCIO.
 *
 * El estándar son **25 respuestas del asistente por ventana de 24 h, igual para
 * los tres planes** (ver `functions/src/planes.ts`, y `Analisis/16` para por qué
 * no se escalona por plan). Este script escribe la EXCEPCIÓN para un comercio
 * concreto en `tenants/{t}/cuenta/estado.topeMensajes24h`, que es lo que
 * `configuracionFlujo` lee para decidir cuántas respuestas le quedan al
 * asistente. Surte efecto en menos de 60 s, la vigencia del caché.
 *
 * NO TOCA EL PLAN. El plan, su precio y las conversaciones incluidas son de la
 * relación comercial y viven en otro lado. Acá solo se ajusta la calidad de
 * servicio de un negocio cuyas conversaciones son legítimamente más largas, o
 * uno al que hay que acotar más.
 *
 *   node scripts/fijar-tope.mjs --proyecto <id> --tenant salon-rosa --tope 35
 *   node scripts/fijar-tope.mjs --proyecto <id> --tenant salon-rosa --estandar
 *
 * Sin `--aplicar` no escribe nada: muestra lo que hay y lo que haría.
 * Requiere haber compilado las funciones (`pnpm functions:build`): el estándar
 * se lee del código compilado para no tener dos copias del número.
 */
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const ESTANDAR = args.includes('--estandar');

const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const TOPE = opcion('tope');

const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;

let planes;
try {
  planes = await import('../functions/lib/planes.js');
} catch {
  console.error('\n  ✗ Falta functions/lib/planes.js: corra `pnpm functions:build` primero.\n');
  process.exit(2);
}
const { TOPE_MAXIMO, TOPE_MENSAJES_24H, topeMensajes24h } = planes;

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!ID_TENANT.test(TENANT)) problemas.push('--tenant inválido (minúsculas, guiones, 3 a 60)');
if (TOPE === null && !ESTANDAR) problemas.push('indique --tope N o --estandar');
if (TOPE !== null && ESTANDAR) problemas.push('--tope y --estandar son excluyentes');
let tope = null;
if (TOPE !== null) {
  tope = Number(TOPE);
  if (!Number.isInteger(tope) || tope < 1 || tope > TOPE_MAXIMO) {
    problemas.push(`--tope debe ser un entero entre 1 y ${TOPE_MAXIMO}`);
  }
}
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/fijar-tope.mjs --proyecto <id> --tenant <id> [--tope N | --estandar] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const refFicha = db.doc(`tenants/${TENANT}`);
const refCuenta = db.doc(`tenants/${TENANT}/cuenta/estado`);
const [ficha, cuenta] = await Promise.all([refFicha.get(), refCuenta.get()]);
if (!ficha.exists) {
  console.error(`\n  ✗ No existe el comercio ${TENANT} en ${PROYECTO}.\n`);
  process.exit(1);
}
const actual = cuenta.data() ?? {};
const antes = topeMensajes24h(actual.topeMensajes24h);
const despues = topeMensajes24h(ESTANDAR ? undefined : tope);

console.log(`\n  Comercio   : ${TENANT} · ${ficha.get('nombre') ?? ''} (${ficha.get('estado') ?? '?'})`);
console.log(`  Estándar   : ${TOPE_MENSAJES_24H} respuestas por conversación (24 h)`);
console.log(`  Hoy        : ${antes.tope} (según ${antes.origen})`);
console.log(`  Quedaría   : ${despues.tope} (según ${despues.origen})\n`);

if (!APLICAR) {
  console.log('  Sin --aplicar no se escribe nada.\n');
  process.exit(0);
}

await refCuenta.set({
  topeMensajes24h: ESTANDAR ? FieldValue.delete() : tope,
  actualizadoEn: Timestamp.now(),
}, { merge: true });
await db.collection(`tenants/${TENANT}/auditoria`).add({
  accion: 'tope_mensajes', uid: 'script:fijar-tope', en: Timestamp.now(),
  topeMensajes24h: ESTANDAR ? 'estandar' : tope,
});
console.log('  ✓ escrito. El asistente lo aplica en menos de 60 s.\n');
