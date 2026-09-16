#!/usr/bin/env node
/**
 * =============================================================================
 * CONTADOR DEL CATÁLOGO: CREARLO ANTES DE DESPLEGAR, Y RECONCILIARLO
 * =============================================================================
 *
 * POR QUÉ EXISTE. Desde el 15/09 el catálogo tiene límite por plan (20 / 100 /
 * 500) y lo hacen cumplir las reglas con un contador,
 * `tenants/{t}/contadores/catalogo = { items, ultimoItem, actualizadoEn }`, que
 * se mueve en el mismo lote que cada alta o baja. Las reglas no pueden contar
 * una colección: si el contador falta, NIEGAN crear y borrar productos (tratar
 * la ausencia como cero regalaría el cupo a quien ya lo tiene lleno).
 *
 * Por eso este script va ANTES de desplegar las reglas nuevas: cuenta los
 * productos de cada comercio y escribe su contador. Y sirve después para
 * reconciliar si algo lo desajustó (una escritura con el SDK Admin que no lo
 * movió). Un contador de menos deja pasar productos de más; uno de más le quita
 * cupo al comercio.
 *
 * NO BORRA NADA. Un comercio que ya está por encima de su límite (bajó de plan)
 * queda con su contador verdadero: no puede crear hasta bajar del límite, pero
 * sigue editando y borrando. Se avisa, y es una conversación comercial.
 *
 *   node scripts/contar-catalogo.mjs --proyecto <id>                   # seco
 *   node scripts/contar-catalogo.mjs --proyecto <id> --tenant <id>
 *   node scripts/contar-catalogo.mjs --proyecto <id> [--tenant <id>] --aplicar
 *
 * Sin `--aplicar` no escribe nada: dice qué haría. Con `FIRESTORE_EMULATOR_HOST`
 * en el entorno escribe en el emulador (así lo prueba
 * `pruebas/limite-catalogo.test.ts`).
 *
 * EL LÍMITE SE LEE DE `functions/src/planes.ts`, no de una copia: es
 * `limitesDeCuenta`, la misma función que usa `importarCatalogo`. Node 22.18+
 * carga TypeScript sin compilar (igual que `asignar-plan.mjs`), y `planes.ts`
 * es puro a propósito.
 */
const { LIMITE_MAXIMO, esIdPlan, limitesDeCuenta } = await import('../functions/src/planes.ts');

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;

/**
 * El límite y de dónde sale, para el informe. El número es siempre el de
 * `limitesDeCuenta`; el origen solo lo explica.
 */
function limiteDe(cuenta) {
  const limite = limitesDeCuenta(cuenta).productos;
  const propio = cuenta?.limites?.productos;
  const plan = cuenta?.plan;
  const origen = Number.isInteger(propio) && propio >= 1 && propio <= LIMITE_MAXIMO
    ? 'limites.productos'
    : esIdPlan(plan) ? `plan ${plan}` : `sin plan conocido${plan ? ` (${plan})` : ''}`;
  return { limite, origen };
}

if (!PROYECTO) {
  console.error('\n  ✗ falta --proyecto');
  console.error('  node scripts/contar-catalogo.mjs --proyecto <id> [--tenant <id>] [--aplicar]\n');
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

const CLAVES = ['items', 'ultimoItem', 'actualizadoEn'];
const escritos = [];
let excedidos = 0;
let pendientes = 0;

for (const t of ids) {
  const refContador = db.doc(`tenants/${t}/contadores/catalogo`);
  const refCuenta = db.doc(`tenants/${t}/cuenta/estado`);
  const coleccion = db.collection(`tenants/${t}/catalogo`);

  // Contar y escribir en la MISMA transacción: si la consola da un alta en el
  // medio, la transacción se reintenta y cuenta de nuevo.
  const r = await db.runTransaction(async (tx) => {
    const [contador, cuenta] = await tx.getAll(refContador, refCuenta);
    const productos = (await tx.get(coleccion.select())).size;
    const antes = contador.exists ? contador.get('items') : null;
    // «Coincide» es también tener SOLO los tres campos: con uno de más, la
    // regla del contador rechazaría todo cambio y el comercio quedaría trabado.
    const coincide = contador.exists && antes === productos
      && Object.keys(contador.data() ?? {}).every((k) => CLAVES.includes(k));
    if (APLICAR && !coincide) {
      const ultimo = contador.exists && typeof contador.get('ultimoItem') === 'string'
        ? contador.get('ultimoItem') : '';
      tx.set(refContador, { items: productos, ultimoItem: ultimo, actualizadoEn: FieldValue.serverTimestamp() });
    }
    return { productos, antes, coincide, ...limiteDe(cuenta.exists ? cuenta.data() : undefined) };
  });

  const accion = r.coincide ? 'al día'
    : (APLICAR ? (r.antes === null ? 'contador creado' : 'contador corregido')
      : (r.antes === null ? 'se crearía' : 'se corregiría'));
  console.log(`  ${r.coincide ? '=' : '→'} ${t.padEnd(28)} productos ${String(r.productos).padStart(4)}`
    + ` · contador ${r.antes === null ? 'FALTA' : String(r.antes).padStart(4)}`
    + ` · límite ${r.limite} (${r.origen}) · ${accion}`);
  if (r.productos > r.limite) {
    excedidos += 1;
    console.log(`    ⚠ por encima del límite: no puede crear hasta bajar de ${r.limite}. No se borra nada.`);
  }
  if (!r.coincide) pendientes += 1;
  if (APLICAR && !r.coincide) escritos.push({ t, productos: r.productos });
}

console.log(`\n  Comercios: ${ids.length} · ${APLICAR ? 'escritos' : 'por escribir'}: ${pendientes}`
  + `${excedidos ? ` · por encima del límite: ${excedidos}` : ''}`);

if (!APLICAR) {
  console.log('\n  Seco: no se escribió nada. Agregue --aplicar.\n');
  process.exit(0);
}

// Verificación por relectura: no basta con que la transacción no falle.
let mal = 0;
for (const { t, productos } of escritos) {
  const c = await db.doc(`tenants/${t}/contadores/catalogo`).get();
  if (c.get('items') !== productos) {
    mal += 1;
    console.log(`  ✗ ${t}: el contador dice ${c.get('items')} y se escribió ${productos}.`);
  }
}
console.log(`\n  ${mal ? '✗' : '✓'} Verificación: ${escritos.length - mal} de ${escritos.length} contadores releídos.\n`);
if (mal) process.exit(1);
