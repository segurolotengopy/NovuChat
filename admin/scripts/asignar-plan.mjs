/**
 * ASIGNAR LOS EJES DE LA CUENTA DE UN COMERCIO: plan (con la copia de sus
 * límites), modalidad, modelo, titularidad de un número y umbrales.
 *
 * POR QUÉ EXISTE. El plan de un comercio vive en `tenants/{t}/cuenta/estado`
 * (`plan`, más la copia `limites` y la versión `catalogoPlanes`), y quien hace
 * cumplir un límite lee la copia (`functions/src/planes.ts`, `Analisis/29`
 * §2.2-2.3). La callable `actualizarEstadoCuenta` lo hace; este script es el
 * mismo camino desde la terminal, para los demos, para NovuChat misma y para
 * un alta que todavía no pasó por la consola.
 *
 * DESDE F1 (`Analisis/41` §4, 25/09/2026) EL PLAN ES UNO DE TRES EJES, y este
 * script escribe los tres más el modelo, cada uno solo si se pide:
 *   --plan <id>                 plan del catálogo → `plan`, `limites` (copia
 *                               entera, reemplazando la anterior),
 *                               `catalogoPlanes`, y el espejo `tenants/{t}.plan`.
 *                               «demostracion» YA NO ES UN PLAN: un demo es
 *                               modalidad `demostracion` con cualquier plan.
 *   --modalidad <m>             demostracion | prueba | prepago → `modalidad`.
 *                               Con `prueba` y sin período previo, el mes en
 *                               curso de Bolivia con su bolsa de 20, como la
 *                               callable. `periodoPagado` NO se escribe acá:
 *                               eso es un pago o `migrar-prepago.mjs`.
 *   --modelo <id>               de la lista cerrada de `central/ejes.ts` →
 *                               `tenants/{t}.modelo`.
 *   --titularidad <t> --numero <phone_number_id>
 *                               novuchat | comercio → `rutasWhatsApp/{n}
 *                               .titularidad`, solo si el número es de ESTE
 *                               comercio.
 *   --umbral-operador N --umbral-bloqueo M
 *                               la pareja de `atencion.ts`, validada igual.
 *
 * Todo en UNA transacción, con auditoría (`cambiar_plan` para el plan, como
 * siempre; `estado_cuenta` para el resto, con los campos que cambiaron). Los
 * campos DERIVADOS (`estadoPago`, `montoMensual`, `moneda`,
 * `proximoVencimiento`) se recalculan con `camposDerivados` si la cuenta tiene
 * modalidad, igual que la callable; sin modalidad no se tocan (LOW 8). Si nada
 * cambia, no escribe nada.
 *
 * EL CATÁLOGO SE IMPORTA DE `functions/src/planes.ts`, no se copia. Los
 * módulos que importan `./x.js` entre sí se cargan con un hook de resolución
 * (`module.registerHooks`, Node 22.15+), como `pase-a-produccion.mjs`, así que
 * no hace falta compilar.
 *
 *   node scripts/asignar-plan.mjs --proyecto <id> --tenant demo-venta --plan pro --modalidad demostracion
 *   node scripts/asignar-plan.mjs --proyecto <id> --tenant salon-rosa --plan crecimiento --aplicar
 *   node scripts/asignar-plan.mjs --proyecto <id> --tenant platinum --titularidad comercio --numero <phone id> --aplicar
 *
 * Sin `--aplicar` no escribe nada: dice qué haría.
 */
import { registerHooks } from 'node:module';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');

const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const PLAN = opcion('plan');
const MODALIDAD = opcion('modalidad');
const MODELO = opcion('modelo');
const TITULARIDAD = opcion('titularidad');
const NUMERO = opcion('numero');
const UMBRAL_OPERADOR = opcion('umbral-operador');
const UMBRAL_BLOQUEO = opcion('umbral-bloqueo');

// --- los módulos del servidor, sin compilar ---------------------------------
registerHooks({
  resolve(especificador, contexto, siguiente) {
    try {
      return siguiente(especificador, contexto);
    } catch (e) {
      if (especificador.startsWith('.') && especificador.endsWith('.js') && contexto.parentURL?.endsWith('.ts')) {
        return siguiente(`${especificador.slice(0, -3)}.ts`, contexto);
      }
      throw e;
    }
  },
});
const { PLANES, CATALOGO_PLANES, esIdPlan, limitesDe } = await import('../functions/src/planes.ts');
const {
  MODALIDADES, PRUEBA, camposDerivados, consumidasDe, esModalidad, esPeriodo, estadoDeServicio, mesBolivia,
} = await import('../functions/src/prepago.ts');
const { periodoDe } = await import('../functions/src/planes.ts');
const { MODELOS, MODELO_POR_DEFECTO, TITULARIDADES, esModelo, esTitularidad } = await import('../functions/src/central/ejes.ts');
const { umbralValido, umbralesDeAtencion } = await import('../functions/src/atencion.ts');

// Mismos formatos que `ID_TENANT` e `ID_NUMERO` en functions/src/index.ts.
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const ID_NUMERO = /^[0-9]{6,25}$/;
const cola = (v) => (v ? `…${String(v).slice(-4)}` : '—');

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!ID_TENANT.test(TENANT)) problemas.push('--tenant inválido (minúsculas, guiones, 3 a 60)');
if (PLAN !== null && !esIdPlan(PLAN)) {
  problemas.push(`--plan desconocido: ${PLAN || '(vacío)'}. Del catálogo: ${Object.keys(PLANES).join(', ')}`);
}
if (MODALIDAD !== null && !esModalidad(MODALIDAD)) {
  problemas.push(`--modalidad desconocida: ${MODALIDAD || '(vacía)'}. Una de: ${MODALIDADES.join(', ')}`);
}
if (MODELO !== null && !esModelo(MODELO)) {
  problemas.push(`--modelo desconocido: ${MODELO || '(vacío)'}. Uno de: ${MODELOS.join(', ')}`);
}
if (TITULARIDAD !== null && !esTitularidad(TITULARIDAD)) {
  problemas.push(`--titularidad desconocida: ${TITULARIDAD || '(vacía)'}. Una de: ${TITULARIDADES.join(', ')}`);
}
if ((TITULARIDAD !== null) !== (NUMERO !== null)) problemas.push('--titularidad y --numero van juntos');
if (NUMERO !== null && !ID_NUMERO.test(NUMERO)) problemas.push('--numero no es un phone_number_id (solo dígitos, 6 a 25)');
const umbrales = {};
for (const [clave, crudo] of [['umbralOperador', UMBRAL_OPERADOR], ['umbralBloqueo', UMBRAL_BLOQUEO]]) {
  if (crudo === null) continue;
  const n = Number(crudo);
  if (!umbralValido(n)) problemas.push(`--${clave === 'umbralOperador' ? 'umbral-operador' : 'umbral-bloqueo'} inválido: ${crudo}`);
  else umbrales[clave] = n;
}
const pideAlgo = PLAN !== null || MODALIDAD !== null || MODELO !== null || TITULARIDAD !== null || Object.keys(umbrales).length > 0;
if (!pideAlgo) problemas.push('nada que asignar: --plan, --modalidad, --modelo, --titularidad/--numero o --umbral-*');
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/asignar-plan.mjs --proyecto <id> --tenant <id> [--plan <plan>] [--modalidad <m>]');
  console.error('      [--modelo <id>] [--titularidad <t> --numero <phone_number_id>] [--umbral-operador N --umbral-bloqueo M] [--aplicar]\n');
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
const refRuta = NUMERO ? db.doc(`rutasWhatsApp/${NUMERO}`) : null;
const limites = PLAN ? limitesDe(PLAN) : null;
const texto = (l) => (l && typeof l === 'object'
  ? `${l.conversaciones ?? '?'} conversaciones · ${l.productos ?? '?'} productos · ${l.agendas ?? '?'} agendas`
    + ` · ${l.cambiosIncluidos ?? '?'} cambios/mes`
  : '(sin copia de límites)');

console.log(`\n  Negocio   : ${TENANT}`);
if (PLAN) console.log(`  Plan      : ${PLAN} (${PLANES[PLAN].nombre}, USD ${PLANES[PLAN].precioUsd}) · ${texto(limites)} · catálogo ${CATALOGO_PLANES}`);
if (MODALIDAD) console.log(`  Modalidad : ${MODALIDAD}`);
if (MODELO) console.log(`  Modelo    : ${MODELO}`);
if (TITULARIDAD) console.log(`  Número    : ${cola(NUMERO)} → titularidad ${TITULARIDAD}`);
if (Object.keys(umbrales).length) console.log(`  Umbrales  : ${JSON.stringify(umbrales)}`);
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
    const [ficha, cuenta, metricas, ruta] = await Promise.all([
      tx.get(refFicha), tx.get(refCuenta), tx.get(refMetricas), refRuta ? tx.get(refRuta) : Promise.resolve(null),
    ]);
    if (!ficha.exists) {
      resumen = { error: `No existe el comercio «${TENANT}». Primero alta-comercio.mjs.` };
      return;
    }
    if (ficha.get('estado') === 'dado_de_baja') {
      resumen = { error: `«${TENANT}» está dado de baja: no se le asignan ejes.` };
      return;
    }
    if (ruta && !ruta.exists) {
      resumen = { error: `El número ${cola(NUMERO)} no tiene ruta: primero asignar-numero.mjs.` };
      return;
    }
    if (ruta && ruta.get('tenantId') !== TENANT) {
      resumen = { error: `El número ${cola(NUMERO)} es de OTRO comercio (${ruta.get('tenantId')}). No se toca.` };
      return;
    }
    const actual = cuenta.data() ?? {};

    // --- qué cambia en la cuenta -------------------------------------------
    const escritura = {};
    if (PLAN) {
      const mismosLimites = actual.limites && typeof actual.limites === 'object'
        && ['conversaciones', 'productos', 'agendas', 'cambiosIncluidos'].every((k) => actual.limites[k] === limites[k]);
      if (!(actual.plan === PLAN && ficha.get('plan') === PLAN && actual.catalogoPlanes === CATALOGO_PLANES && mismosLimites)) {
        Object.assign(escritura, { plan: PLAN, limites, catalogoPlanes: CATALOGO_PLANES });
      }
    }
    if (MODALIDAD && actual.modalidad !== MODALIDAD) {
      escritura.modalidad = MODALIDAD;
      if (MODALIDAD === 'prueba' && !esPeriodo(actual.periodoPrueba)) {
        escritura.periodoPrueba = mesBolivia(ahoraMs);
        escritura.bolsaPrueba = PRUEBA.conversaciones;
      }
    }
    for (const [k, v] of Object.entries(umbrales)) if (actual[k] !== v) escritura[k] = v;
    if (Object.keys(umbrales).length) {
      const combinados = { ...actual, ...umbrales };
      if (umbralesDeAtencion(combinados).origen !== 'cuenta') {
        resumen = { error: 'El umbral de bloqueo tiene que ser mayor que el de operador.' };
        return;
      }
    }
    const fichaCambios = {};
    if (PLAN && ficha.get('plan') !== PLAN) fichaCambios.plan = PLAN;
    if (MODELO && ficha.get('modelo') !== MODELO) fichaCambios.modelo = MODELO;
    const rutaCambia = Boolean(ruta && ruta.get('titularidad') !== TITULARIDAD);

    // --- los derivados, con la cuenta como va a quedar (solo con modalidad) --
    const combinada = { ...actual, ...escritura };
    let derivados = null;
    if (esModalidad(combinada.modalidad) && Object.keys(escritura).length > 0) {
      const servicio = estadoDeServicio(combinada, consumidasDe(metricas.data()), ahoraMs);
      const d = camposDerivados(servicio, combinada);
      derivados = { estadoPago: d.estadoPago, montoMensual: d.montoMensual, moneda: d.moneda };
      escritura.estadoPago = d.estadoPago;
      escritura.montoMensual = d.montoMensual;
      escritura.moneda = d.moneda;
      escritura.proximoVencimiento = d.proximoVencimientoMs === null
        ? FieldValue.delete() : Timestamp.fromMillis(d.proximoVencimientoMs);
    }

    const antes = {
      plan: actual.plan ?? null, limites: actual.limites ?? null, catalogo: actual.catalogoPlanes ?? null,
      espejo: ficha.get('plan') ?? null, modalidad: actual.modalidad ?? null, modelo: ficha.get('modelo') ?? null,
      titularidad: ruta ? (ruta.get('titularidad') ?? null) : undefined,
      umbrales: { operador: actual.umbralOperador ?? null, bloqueo: actual.umbralBloqueo ?? null },
    };
    const sinCambios = Object.keys(escritura).length === 0 && Object.keys(fichaCambios).length === 0 && !rutaCambia;
    resumen = { antes, sinCambios, cuentaNueva: !cuenta.exists, derivados, campos: Object.keys(escritura).sort() };
    if (!APLICAR || sinCambios) return;

    const ahora = Timestamp.now();
    escritura.actualizadoEn = ahora;
    // `update` reemplaza `limites` entero; `set` solo si la cuenta no existía.
    if (cuenta.exists) tx.update(refCuenta, escritura);
    else tx.set(refCuenta, Object.fromEntries(Object.entries(escritura).filter(([, v]) => !(v instanceof FieldValue))));
    if (Object.keys(fichaCambios).length) tx.update(refFicha, fichaCambios);
    // El modelo y la titularidad dejan la MISMA auditoría que la callable
    // `asignarEjes`: un solo vocabulario para leerla después.
    if (rutaCambia || fichaCambios.modelo) {
      if (rutaCambia) tx.update(refRuta, { titularidad: TITULARIDAD, titularidadEn: ahora, titularidadPor: 'asignar-plan' });
      tx.create(db.collection(`tenants/${TENANT}/auditoria`).doc(), {
        accion: 'asignar_ejes', uid: 'asignar-plan', en: ahora,
        ...(fichaCambios.modelo ? { modeloAntes: antes.modelo ?? MODELO_POR_DEFECTO, modeloDespues: MODELO } : {}),
        ...(rutaCambia ? {
          phoneNumberId: NUMERO, titularidadAntes: antes.titularidad ?? 'novuchat', titularidadDespues: TITULARIDAD,
        } : {}),
      });
    }
    if (escritura.plan) {
      tx.create(db.collection(`tenants/${TENANT}/auditoria`).doc(), {
        accion: 'cambiar_plan', uid: 'asignar-plan', en: ahora,
        planAntes: antes.plan, planDespues: PLAN,
        limitesAntes: antes.limites, limitesDespues: limites,
        catalogoPlanes: CATALOGO_PLANES,
      });
    }
    const otros = Object.keys(escritura)
      .filter((k) => !['plan', 'limites', 'catalogoPlanes', 'actualizadoEn', 'estadoPago', 'montoMensual', 'moneda', 'proximoVencimiento'].includes(k))
      .sort();
    if (otros.length) {
      tx.create(db.collection(`tenants/${TENANT}/auditoria`).doc(), {
        accion: 'estado_cuenta', uid: 'asignar-plan', en: ahora, campos: otros,
        valores: Object.fromEntries(otros.map((k) => [k, escritura[k]])),
      });
    }
  });
} catch (e) {
  console.error(`  ✗ ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
if (resumen.error) {
  console.error(`  ✗ ${resumen.error}\n`);
  process.exit(1);
}

const a = resumen.antes;
console.log(`  Antes     : plan ${a.plan ?? '(ninguno)'} · espejo ${a.espejo ?? '(ninguno)'} · catálogo ${a.catalogo ?? '(ninguno)'}`);
console.log(`              ${texto(a.limites)}`);
console.log(`              modalidad ${a.modalidad ?? '(ninguna: rige demostración)'} · modelo ${a.modelo ?? '(ninguno: rige el de defecto)'}`
  + (a.titularidad !== undefined ? ` · titularidad ${a.titularidad ?? '(ninguna: rige novuchat)'}` : '')
  + ` · umbrales ${a.umbrales.operador ?? '-'}/${a.umbrales.bloqueo ?? '-'}`);
console.log(`  Cuenta    : ${resumen.cuentaNueva ? 'no existía, se crea' : `existe, cambian: ${resumen.campos.join(', ') || 'nada de la cuenta'}`}`);
if (resumen.derivados) console.log(`  Derivados : ${JSON.stringify(resumen.derivados)}`);

if (resumen.sinCambios) {
  console.log('\n  Sin cambios: ya tiene esos ejes.\n');
  process.exit(0);
}
if (!APLICAR) {
  console.log('\n  Seco: no se escribió nada. Agregue --aplicar.\n');
  process.exit(0);
}

// --- verificación por relectura ---------------------------------------------
const [cuenta, ficha, ruta] = await Promise.all([refCuenta.get(), refFicha.get(), refRuta ? refRuta.get() : null]);
const copia = cuenta.get('limites') ?? {};
const okPlan = !PLAN || (cuenta.get('plan') === PLAN && ficha.get('plan') === PLAN
  && cuenta.get('catalogoPlanes') === CATALOGO_PLANES
  && ['conversaciones', 'productos', 'agendas', 'cambiosIncluidos'].every((k) => copia[k] === limites[k]));
const okModalidad = !MODALIDAD || cuenta.get('modalidad') === MODALIDAD;
const okModelo = !MODELO || ficha.get('modelo') === MODELO;
const okTitularidad = !TITULARIDAD || ruta?.get('titularidad') === TITULARIDAD;
const okUmbrales = Object.entries(umbrales).every(([k, v]) => cuenta.get(k) === v);
const ok = okPlan && okModalidad && okModelo && okTitularidad && okUmbrales;
console.log(`\n  ${ok ? '✓' : '✗'} Verificación: plan ${cuenta.get('plan')} · espejo ${ficha.get('plan')} · ${texto(copia)}`);
console.log(`    modalidad ${cuenta.get('modalidad') ?? '(ninguna)'} · modelo ${ficha.get('modelo') ?? '(ninguno)'}`
  + (ruta ? ` · titularidad ${ruta.get('titularidad') ?? '(ninguna)'}` : '')
  + ` · umbrales ${cuenta.get('umbralOperador') ?? '-'}/${cuenta.get('umbralBloqueo') ?? '-'}\n`);
if (!ok) process.exit(1);
