#!/usr/bin/env node
/**
 * =============================================================================
 * CONTADOR DE AGENDAS: CREARLO ANTES DE DESPLEGAR, Y RECONCILIARLO (H2b-9)
 * =============================================================================
 *
 * El límite de agendas por plan (1 / 5 / 10) lo hacen cumplir las reglas con
 * `tenants/{t}/contadores/agendas = { calendarios, refs, ultimoFuncionario,
 * actualizadoEn }`. Cuentan los `calendarioId` DISTINTOS entre los funcionarios
 * ACTIVOS (decisión Q6=A): un activo con `calendarioId` vacío no cuenta. Sin
 * contador, las reglas NIEGAN cambiar el calendario de un funcionario desde el
 * navegador (tratar la ausencia como cero regalaría el cupo).
 *
 * El criterio de conteo es `functions/src/modulos/agenda/agendasContadas.ts`.
 *
 * NO BORRA NADA. Un comercio por encima de su límite queda con su contador
 * verdadero: no suma agendas, sí quita y edita. Se avisa.
 *
 *   node scripts/modulos/agenda/contar-agendas.mjs --proyecto <id> [--tenant <id>]            # seco
 *   node scripts/modulos/agenda/contar-agendas.mjs --proyecto <id> [--tenant <id>] --aplicar
 *
 * Sin `--aplicar` no escribe nada. Con `FIRESTORE_EMULATOR_HOST` escribe en el
 * emulador. Contra producción solo con la autorización de Andres.
 */
const { contarAgendas } = await import('../../../functions/src/modulos/agenda/agendasContadas.ts');
const { limitesDeCuenta } = await import('../../../functions/src/central/cuenta/planes.ts');

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;

if (!PROYECTO) {
  console.error('\n  ✗ falta --proyecto');
  console.error('  node scripts/modulos/agenda/contar-agendas.mjs --proyecto <id> [--tenant <id>] [--aplicar]\n');
  process.exit(2);
}
if (TENANT && !ID_TENANT.test(TENANT)) {
  console.error('\n  ✗ --tenant inválido (minúsculas, guiones, 3 a 60)\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const destino = process.env.FIRESTORE_EMULATOR_HOST ? `emulador (${PROYECTO})` : PROYECTO;
console.log(`\n  Destino   : ${destino}`);
console.log(`  Modo      : ${APLICAR ? 'APLICAR' : 'seco (no escribe)'}\n`);

let ids;
if (TENANT) {
  if (!(await db.doc(`tenants/${TENANT}`).get()).exists) {
    console.error(`  ✗ No existe el comercio «${TENANT}».\n`);
    process.exit(1);
  }
  ids = [TENANT];
} else {
  ids = (await db.collection('tenants').select().get()).docs.map((d) => d.id);
}

const CLAVES = ['calendarios', 'refs', 'ultimoFuncionario', 'actualizadoEn'];
const firma = (m) => JSON.stringify(Object.entries(m ?? {}).sort());
let cambios = 0;
let excedidos = 0;

for (const id of ids) {
  const refContador = db.doc(`tenants/${id}/contadores/agendas`);
  await db.runTransaction(async (tx) => {
    const funcs = await tx.get(db.collection(`tenants/${id}/funcionarios`));
    const contador = await tx.get(refContador);
    const cuenta = await tx.get(db.doc(`tenants/${id}/cuenta/estado`));
    const real = contarAgendas(funcs.docs.map((d) => d.data()));
    const limite = limitesDeCuenta(cuenta.exists ? cuenta.data() : undefined).agendas;
    const alDia = contador.exists
      && contador.get('calendarios') === real.calendarios
      && firma(contador.get('refs')) === firma(real.refs)
      && Object.keys(contador.data() ?? {}).every((k) => CLAVES.includes(k));
    const exceso = real.calendarios > limite;
    if (exceso) excedidos += 1;
    const estado = alDia ? 'al día' : contador.exists ? 'DESAJUSTADO' : 'FALTA';
    console.log(`  ${id.padEnd(30)} agendas ${real.calendarios}/${limite}  contador ${estado}`
      + (exceso ? '  ⚠ por encima del límite' : ''));
    if (alDia) return;
    cambios += 1;
    if (!APLICAR) return;
    // `set` sin `merge`: el documento tiene exactamente CLAVES y nada más.
    tx.set(refContador, {
      calendarios: real.calendarios,
      refs: real.refs,
      ultimoFuncionario: '',
      actualizadoEn: FieldValue.serverTimestamp(),
    });
  });
}

console.log(`\n  ${ids.length} comercio(s); ${cambios} ${APLICAR ? 'escritos' : 'por escribir'}; ${excedidos} por encima del límite.`);
if (!APLICAR && cambios > 0) console.log('  Seco: no se escribió nada. Repita con --aplicar.');
console.log('');
