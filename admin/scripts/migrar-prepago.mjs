/**
 * MIGRAR UN COMERCIO AL PREPAGO, UNO POR UNO Y EN SECO POR DEFECTO.
 *
 * POR QUÉ EXISTE (`DISENO.md` §4undecies.2, «Migración»; `Analisis/29` §2.6).
 * El módulo del prepago decide sobre `cuenta/estado.modalidad`, `periodoPagado`
 * y `periodoPrueba`, y los comercios dados de alta antes del 20/09 no tienen
 * ninguno de los tres: para ellos rige «sin modalidad = demostración», que es
 * la salvaguarda. Los comercios REALES reciben su modalidad y su último mes
 * pagado A MANO, uno por uno, con este script o con `actualizarEstadoCuenta`.
 * Ningún comercio recibe `modalidad: 'prepago'` sin un pago o una decisión
 * explícita de Andres: por eso no hay modo «todos», y por eso NO SE CORRE sin
 * su «sí» en el chat. Los demos y `novuchat` quedan como están.
 *
 * QUÉ HACE, en UNA transacción y con auditoría `migrar_prepago`:
 *   - rechaza un comercio que no existe, dado de baja, o con `plan:
 *     'demostracion'` si se le pide prepago o prueba (un demo no se migra);
 *   - `--modalidad prepago --periodo-pagado aaaa-mm`: escribe la modalidad y
 *     el último mes pagado (los meses anteriores ya se pagaron por fuera);
 *   - `--modalidad prueba [--periodo-prueba aaaa-mm]`: la prueba es el mes
 *     dado o el mes en curso de Bolivia, con su bolsa de 20 si no tenía;
 *   - `--modalidad demostracion`: la deja explícitamente fuera del prepago;
 *   - recalcula los campos DERIVADOS (`estadoPago`, `montoMensual`, `moneda`,
 *     `proximoVencimiento`) con `camposDerivados`, igual que la ingesta;
 *   - no toca el plan, los límites, los umbrales, la bolsa ni el corte.
 *
 * EL MÓDULO SE IMPORTA COMPILADO (`functions/lib/prepago.js`): `prepago.ts`
 * importa `./planes.js`, y Node no reescribe esa extensión al cargar
 * TypeScript sin compilar. Antes de correrlo: `pnpm functions:build`.
 *
 *   node scripts/migrar-prepago.mjs --proyecto <id> --tenant salon-rosa --modalidad prepago --periodo-pagado 2026-09
 *   node scripts/migrar-prepago.mjs --proyecto <id> --tenant salon-rosa --modalidad prueba
 *   node scripts/migrar-prepago.mjs --proyecto <id> --tenant salon-rosa --modalidad prepago --periodo-pagado 2026-09 --aplicar
 *
 * Sin `--aplicar` no escribe nada: dice qué haría.
 */
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');

const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const MODALIDAD = (opcion('modalidad') ?? '').trim();
const PERIODO_PAGADO = (opcion('periodo-pagado') ?? '').trim();
const PERIODO_PRUEBA = (opcion('periodo-prueba') ?? '').trim();

let prepago;
try {
  prepago = await import('../functions/lib/prepago.js');
} catch {
  console.error('\n  ✗ No se encuentra functions/lib/prepago.js. Compile primero: pnpm functions:build\n');
  process.exit(2);
}
const {
  MODALIDADES, PRUEBA, camposDerivados, consumidasDe, esModalidad, esPeriodo, estadoDeServicio, mesBolivia,
} = prepago;
const { periodoDe } = await import('../functions/lib/planes.js');

// Mismo formato que `ID_TENANT` en functions/src/index.ts.
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!ID_TENANT.test(TENANT)) problemas.push('--tenant inválido (minúsculas, guiones, 3 a 60)');
if (!esModalidad(MODALIDAD)) problemas.push(`--modalidad desconocida: ${MODALIDAD || '(vacía)'}. Una de: ${MODALIDADES.join(', ')}`);
if (MODALIDAD === 'prepago' && !esPeriodo(PERIODO_PAGADO)) problemas.push('--periodo-pagado aaaa-mm es obligatorio con prepago');
if (PERIODO_PRUEBA && !esPeriodo(PERIODO_PRUEBA)) problemas.push('--periodo-prueba tiene que ser aaaa-mm');
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/migrar-prepago.mjs --proyecto <id> --tenant <id> --modalidad <prepago|prueba|demostracion> [--periodo-pagado aaaa-mm] [--periodo-prueba aaaa-mm] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const ahoraMs = Date.now();
const refFicha = db.doc(`tenants/${TENANT}`);
const refCuenta = db.doc(`tenants/${TENANT}/cuenta/estado`);
const refMetricas = db.doc(`tenants/${TENANT}/metricas/${periodoDe(ahoraMs)}`);

console.log(`\n  Negocio    : ${TENANT}`);
console.log(`  Modalidad  : ${MODALIDAD}`);
if (MODALIDAD === 'prepago') console.log(`  Pagado     : hasta ${PERIODO_PAGADO}`);
if (MODALIDAD === 'prueba') console.log(`  Prueba     : ${PERIODO_PRUEBA || `${mesBolivia(ahoraMs)} (mes en curso)`}`);
console.log(`  Proyecto   : ${PROYECTO}\n`);

// UN RECHAZO NO SE LANZA DENTRO DE LA TRANSACCIÓN: se devuelve (ver
// `asignar-plan.mjs`: lanzar deja los documentos bloqueados en el emulador).
let resumen;
try {
  await db.runTransaction(async (tx) => {
    const [ficha, cuenta, metricas] = await Promise.all([tx.get(refFicha), tx.get(refCuenta), tx.get(refMetricas)]);
    if (!ficha.exists) { resumen = { error: `No existe el comercio «${TENANT}».` }; return; }
    if (ficha.get('estado') === 'dado_de_baja') { resumen = { error: `«${TENANT}» está dado de baja.` }; return; }
    const actual = cuenta.data() ?? {};
    if (actual.plan === 'demostracion' && MODALIDAD !== 'demostracion') {
      resumen = { error: `«${TENANT}» tiene plan de demostración: no se migra a ${MODALIDAD}. Asigne un plan del catálogo antes.` };
      return;
    }

    const escritura = { modalidad: MODALIDAD, actualizadoEn: Timestamp.now() };
    if (MODALIDAD === 'prepago') escritura.periodoPagado = PERIODO_PAGADO;
    if (MODALIDAD === 'prueba') {
      escritura.periodoPrueba = PERIODO_PRUEBA || (esPeriodo(actual.periodoPrueba) ? actual.periodoPrueba : mesBolivia(ahoraMs));
      if (typeof actual.bolsaPrueba !== 'number') escritura.bolsaPrueba = PRUEBA.conversaciones;
    }
    const combinada = { ...actual, ...escritura };
    const servicio = estadoDeServicio(combinada, consumidasDe(metricas.data()), ahoraMs);
    const d = camposDerivados(servicio, combinada);
    escritura.estadoPago = d.estadoPago;
    escritura.montoMensual = d.montoMensual;
    escritura.moneda = d.moneda;
    escritura.proximoVencimiento = d.proximoVencimientoMs === null
      ? FieldValue.delete() : Timestamp.fromMillis(d.proximoVencimientoMs);

    const antes = {
      modalidad: actual.modalidad ?? null, periodoPagado: actual.periodoPagado ?? null,
      periodoPrueba: actual.periodoPrueba ?? null, estadoPago: actual.estadoPago ?? null, plan: actual.plan ?? null,
    };
    const despues = {
      modalidad: MODALIDAD, periodoPagado: escritura.periodoPagado ?? antes.periodoPagado,
      periodoPrueba: escritura.periodoPrueba ?? antes.periodoPrueba, estadoPago: d.estadoPago,
      fase: servicio.fase, operativo: servicio.operativo, motivo: servicio.motivo,
    };
    resumen = { antes, despues, cuentaNueva: !cuenta.exists };
    if (!APLICAR) return;

    const sinBorrados = Object.fromEntries(Object.entries(escritura).filter(([, v]) => !(v instanceof FieldValue)));
    if (cuenta.exists) tx.update(refCuenta, escritura); else tx.set(refCuenta, sinBorrados);
    tx.create(db.collection(`tenants/${TENANT}/auditoria`).doc(), {
      accion: 'migrar_prepago', uid: 'migrar-prepago', en: Timestamp.now(), antes, despues,
    });
  });
} catch (e) {
  console.error(`  ✗ ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
if (resumen.error) { console.error(`  ✗ ${resumen.error}\n`); process.exit(1); }

const mostrar = (o) => Object.entries(o).map(([k, v]) => `${k} ${v ?? '(ninguno)'}`).join(' · ');
console.log(`  Antes      : ${mostrar(resumen.antes)}`);
console.log(`  Después    : ${mostrar(resumen.despues)}`);
console.log(`  Cuenta     : ${resumen.cuentaNueva ? 'no existía, se crea' : 'existe, se actualiza'}`);

if (!APLICAR) { console.log('\n  Seco: no se escribió nada. Agregue --aplicar (con el OK de Andres).\n'); process.exit(0); }

// --- verificación por relectura ---------------------------------------------
const cuenta = await refCuenta.get();
const ok = cuenta.get('modalidad') === MODALIDAD
  && (MODALIDAD !== 'prepago' || cuenta.get('periodoPagado') === PERIODO_PAGADO)
  && cuenta.get('estadoPago') === resumen.despues.estadoPago;
console.log(`\n  ${ok ? '✓' : '✗'} Verificación: modalidad ${cuenta.get('modalidad')} · estadoPago ${cuenta.get('estadoPago')}\n`);
if (!ok) process.exit(1);
