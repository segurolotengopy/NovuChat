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
 * es puro a propósito. El acceso va por `lib/contador-catalogo.mjs`, que es
 * donde vive el criterio de conteo compartido.
 */
// EL CRITERIO DE CONTEO, EL LÍMITE Y LA FORMA DEL DOCUMENTO viven en
// `lib/contador-catalogo.mjs`, que comparte con `cargar-negocio.mjs` (que
// también mueve el contador, en la misma transacción en la que carga el
// catálogo) y con `importarCatalogo`. Tener el criterio dos veces es pedir que
// un día uno cuente los activos y el otro los documentos.
const { contadorAlDia, contarProductos, escribirContador, limiteDe } =
  await import('./lib/contador-catalogo.mjs');

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;

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
const { getFirestore } = await import('firebase-admin/firestore');
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
    const productos = await contarProductos(tx, coleccion);
    const antes = contador.exists ? contador.get('items') : null;
    // «Coincide» es también tener SOLO los tres campos: con uno de más, la
    // regla del contador rechazaría todo cambio y el comercio quedaría trabado.
    const coincide = contadorAlDia(contador, productos);
    if (APLICAR && !coincide) {
      escribirContador(tx, refContador, { items: productos, ultimoItem: contador.get('ultimoItem') });
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

// CERRAR EL CLIENTE ANTES DE SALIR, Y NO ES CORTESÍA. Con `process.exit()` la
// conexión se corta de golpe y el emulador conserva los bloqueos de la última
// transacción —esta consulta un rango entero— hasta que vencen (medido el
// 17/09: 60 s). La suite que corre después se queda esperando y falla con
// «Transaction lock timeout», que es un diagnóstico que no lleva a ninguna
// parte. `terminate()` cierra el cliente y libera todo; contra Firestore de
// verdad es igual de correcto.
const salir = async (codigo) => { await db.terminate().catch(() => {}); process.exit(codigo); };

if (!APLICAR) {
  console.log('\n  Seco: no se escribió nada. Agregue --aplicar.\n');
  await salir(0);
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
await salir(mal ? 1 : 0);
