/**
 * =============================================================================
 * FIJAR O RESTAURAR LOS UMBRALES DE ATENCIÓN DE UN COMERCIO
 * =============================================================================
 *
 * POR QUÉ EXISTE. Los dos umbrales de corte —a cuántas respuestas del asistente
 * en la ventana de 24 h se pasa al operador, y a cuántas se deja de responder—
 * viven en `tenants/{t}/cuenta/estado` (`umbralOperador`, `umbralBloqueo`) y
 * los lee el servidor (`functions/src/atencion.ts`; CLAUDE.md, base comercial
 * §2 y §7). La callable `actualizarEstadoCuenta` los escribe, pero ninguna
 * pantalla la llama todavía (`Analisis/29`). Sin este script, la prueba de
 * aceptación 24a–24c de un cliente —bajar los umbrales a 3 y 5, comprobar con
 * un teléfono real que el asistente se corta, y devolverlos— no tenía camino
 * que no fuera editar Firestore a mano.
 *
 * QUÉ HACE, en UNA transacción y con la misma validación del servidor:
 *   - `--operador N --bloqueo M`: escribe la pareja, solo si es coherente
 *     (`umbralesDeAtencion`: enteros entre 1 y UMBRAL_MAXIMO, bloqueo > operador);
 *   - `--restaurar`: borra los dos campos y vuelven a regir los de respaldo
 *     (50 / 100), que es lo que hay que hacer al terminar la prueba;
 *   - no toca nada más de la cuenta (plan, límites, estado de pago, mensualidad);
 *   - deja auditoría `cambiar_umbrales` con el antes y el después.
 * Si el comercio ya tiene esos umbrales, no escribe nada.
 *
 * LOS DOS SE ESCRIBEN JUNTOS O NINGUNO. Un solo umbral cargado se combinaría
 * con el de respaldo del otro y el resultado puede no describir nada (bloqueo
 * 5 con operador 50): el servidor lo descartaría en silencio y la prueba
 * creería que bajó el techo cuando no lo bajó.
 *
 *   node scripts/fijar-umbrales.mjs --proyecto <id> --tenant platinum --operador 3 --bloqueo 5
 *   node scripts/fijar-umbrales.mjs --proyecto <id> --tenant platinum --operador 3 --bloqueo 5 --aplicar
 *   node scripts/fijar-umbrales.mjs --proyecto <id> --tenant platinum --restaurar --aplicar
 *
 * Sin `--aplicar` no escribe nada: dice qué haría.
 */
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const RESTAURAR = args.includes('--restaurar');

const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const OPERADOR = opcion('operador');
const BLOQUEO = opcion('bloqueo');

const { UMBRALES_ATENCION, UMBRAL_MAXIMO, umbralValido, umbralesDeAtencion } =
  await import('../functions/src/atencion.ts');

// Mismo formato que `ID_TENANT` en functions/src/index.ts.
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;

// Un número escrito a mano: solo dígitos, sin signos ni decimales. `Number('')`
// es 0 y `Number(' 3 ')` es 3; acá se exige la forma exacta.
const entero = (s) => (typeof s === 'string' && /^\d{1,4}$/.test(s) ? Number(s) : NaN);

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!ID_TENANT.test(TENANT)) problemas.push('--tenant inválido (minúsculas, guiones, 3 a 60)');

let pedido = null;
if (RESTAURAR) {
  if (OPERADOR !== null || BLOQUEO !== null) {
    problemas.push('--restaurar no se combina con --operador ni --bloqueo');
  }
} else {
  const operador = entero(OPERADOR);
  const bloqueo = entero(BLOQUEO);
  if (OPERADOR === null || BLOQUEO === null) {
    problemas.push('hacen falta --operador y --bloqueo juntos (o --restaurar)');
  } else if (!umbralValido(operador) || !umbralValido(bloqueo)) {
    problemas.push(`cada umbral tiene que ser un entero entre 1 y ${UMBRAL_MAXIMO}`);
  } else if (umbralesDeAtencion({ umbralOperador: operador, umbralBloqueo: bloqueo }).origen !== 'cuenta') {
    problemas.push('el umbral de bloqueo tiene que ser mayor que el de operador');
  } else {
    pedido = { umbralOperador: operador, umbralBloqueo: bloqueo };
  }
}
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/fijar-umbrales.mjs --proyecto <id> --tenant <id> --operador N --bloqueo M [--aplicar]');
  console.error('  node scripts/fijar-umbrales.mjs --proyecto <id> --tenant <id> --restaurar [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const refFicha = db.doc(`tenants/${TENANT}`);
const refCuenta = db.doc(`tenants/${TENANT}/cuenta/estado`);

const texto = (u) => `operador ${u.operador} · bloqueo ${u.bloqueo} (${u.origen === 'cuenta' ? 'de la cuenta' : 'de respaldo'})`;

console.log(`\n  Negocio   : ${TENANT}`);
console.log(`  Pedido    : ${RESTAURAR
  ? `restaurar los de respaldo (${UMBRALES_ATENCION.operador} / ${UMBRALES_ATENCION.bloqueo})`
  : `operador ${pedido.umbralOperador} · bloqueo ${pedido.umbralBloqueo}`}`);
console.log(`  Proyecto  : ${PROYECTO}\n`);

// UN RECHAZO NO SE LANZA DENTRO DE LA TRANSACCIÓN: se devuelve (ver el motivo
// en asignar-plan.mjs: un rollback «best effort» deja bloqueos colgados).
let resumen;
try {
  await db.runTransaction(async (tx) => {
    const [ficha, cuenta] = await Promise.all([tx.get(refFicha), tx.get(refCuenta)]);
    if (!ficha.exists) {
      resumen = { error: `No existe el comercio «${TENANT}». Primero alta-comercio.mjs.` };
      return;
    }
    if (ficha.get('estado') === 'dado_de_baja') {
      resumen = { error: `«${TENANT}» está dado de baja: no se le tocan los umbrales.` };
      return;
    }
    if (!cuenta.exists) {
      resumen = { error: `«${TENANT}» no tiene cuenta (cuenta/estado). Primero asignar-plan.mjs.` };
      return;
    }
    const actual = cuenta.data() ?? {};
    const antes = umbralesDeAtencion(actual);
    const cargados = {
      umbralOperador: actual['umbralOperador'] ?? null,
      umbralBloqueo: actual['umbralBloqueo'] ?? null,
    };
    const despues = RESTAURAR ? umbralesDeAtencion(undefined) : umbralesDeAtencion(pedido);
    const sinCambios = RESTAURAR
      ? cargados.umbralOperador === null && cargados.umbralBloqueo === null
      : cargados.umbralOperador === pedido.umbralOperador && cargados.umbralBloqueo === pedido.umbralBloqueo;
    resumen = { antes, cargados, despues, sinCambios };
    if (!APLICAR || sinCambios) return;

    const ahora = Timestamp.now();
    const escritura = RESTAURAR
      ? { umbralOperador: FieldValue.delete(), umbralBloqueo: FieldValue.delete(), actualizadoEn: ahora }
      : { ...pedido, actualizadoEn: ahora };
    tx.update(refCuenta, escritura);
    tx.create(db.collection(`tenants/${TENANT}/auditoria`).doc(), {
      accion: 'cambiar_umbrales', uid: 'fijar-umbrales', en: ahora,
      umbralesAntes: cargados,
      umbralesDespues: RESTAURAR ? { umbralOperador: null, umbralBloqueo: null } : pedido,
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

console.log(`  Antes     : ${texto(resumen.antes)}`);
if (resumen.antes.origen === 'estandar'
  && (resumen.cargados.umbralOperador !== null || resumen.cargados.umbralBloqueo !== null)) {
  console.log(`              (cargados ${JSON.stringify(resumen.cargados)}, pero incoherentes: el servidor usa los de respaldo)`);
}
console.log(`  Después   : ${texto(resumen.despues)}`);

if (resumen.sinCambios) {
  console.log('\n  Sin cambios: ya rigen esos umbrales.\n');
  process.exit(0);
}
if (!APLICAR) {
  console.log('\n  Seco: no se escribió nada. Agregue --aplicar.\n');
  process.exit(0);
}

// --- verificación por relectura ---------------------------------------------
const cuenta = await refCuenta.get();
const vigentes = umbralesDeAtencion(cuenta.data() ?? {});
const ok = vigentes.operador === resumen.despues.operador
  && vigentes.bloqueo === resumen.despues.bloqueo
  && vigentes.origen === resumen.despues.origen;
console.log(`\n  Relectura : ${texto(vigentes)} ${ok ? '✓' : '✗ NO COINCIDE'}\n`);
process.exit(ok ? 0 : 1);
