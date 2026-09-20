/**
 * =============================================================================
 * REINICIAR LA VENTANA DE UN TELÉFONO (para poder seguir probando)
 * =============================================================================
 *
 * POR QUÉ EXISTE. A las 50 respuestas en 24 h la conversación entra en «uso
 * extendido»: el asistente deja de llamar al modelo, contesta un aviso fijo y
 * avisa a recepción. Está bien que así sea —es el techo de costo de la ventana
 * (`Analisis/27` §5)— pero una sesión de PRUEBAS lo alcanza en una tarde, y
 * entonces no se puede seguir probando nada hasta que la ventana se renueve
 * sola, 24 horas después.
 *
 * Esto pone en cero el contador de ESE teléfono, en ESE comercio.
 *
 * LO QUE NO HACE, Y ES A PROPÓSITO: **no toca lo ya facturado**. El agregado
 * del mes (`conversaciones`, `bloquesAdicionales`) queda intacto. Lo que se
 * cobró, se cobró; esto solo deja que el asistente vuelva a responder. Falsear
 * la cuenta del mes para que una prueba salga gratis sería mentirle a la
 * facturación, que es el dato del que sale una factura.
 *
 *   node scripts/reiniciar-ventana.mjs --proyecto <id> --tenant <id> \
 *       --telefono 59170000000 [--aplicar]
 *
 * Sin `--aplicar` informa y no escribe. Queda en la auditoría del comercio.
 */
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const PROYECTO = opcion('proyecto');
const TENANT = opcion('tenant');
const TELEFONO = (opcion('telefono') ?? '').replace(/\D/g, '');
const MOTIVO = opcion('motivo') ?? '';

const rojo = (t) => console.log(`\x1b[1;31m${t}\x1b[0m`);
const verde = (t) => console.log(`\x1b[1;32m${t}\x1b[0m`);
const gris = (t) => console.log(`\x1b[0;90m${t}\x1b[0m`);

if (!PROYECTO || !TENANT || TELEFONO === '') {
  console.error('\n  node scripts/reiniciar-ventana.mjs --proyecto <id> --tenant <id> '
    + '--telefono <digitos> [--motivo <texto>] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = await import('firebase-admin/firestore');
initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
const db = getFirestore();

const ref = db.doc(`tenants/${TENANT}/conversaciones/wa_${TELEFONO}`);
const conv = await ref.get();
if (!conv.exists) { rojo(`✗ No hay conversación de ese teléfono en ${TENANT}.`); process.exit(1); }

const antes = conv.data() ?? {};
console.log();
console.log(`  Comercio  : ${TENANT}`);
console.log(`  Teléfono  : …${TELEFONO.slice(-4)}`);
console.log(`  Ventana   : ${antes.mensajesVentana ?? 0} respuestas  ->  0`);
console.log(`  Atención  : ${antes.atencionEstado ?? 'normal'}  ->  normal`);
console.log(`  Facturado : ${antes.bloquesAdicionales ?? 0} bloque(s) adicional(es) — NO se toca`);
console.log();

if (!APLICAR) {
  gris('  Seco: no se escribió nada. Agregue --aplicar.\n');
  process.exit(0);
}

// NO se mueve el ancla de la ventana (`atencionDesde`): la ventana sigue
// venciendo a las 24 h de la primera consulta, como siempre. Solo el contador
// vuelve a cero, y el estado se recalcula desde el en cada mensaje
// (`atencion.ts`, `estadoDeAtencion`), asi que no hace falta escribirlo.
await ref.set({
  mensajesVentana: 0,
  atencionEstado: FieldValue.delete(),
  atencionAvisadaEn: FieldValue.delete(),
  ventanaReiniciadaEn: Timestamp.now(),
}, { merge: true });

await db.collection(`tenants/${TENANT}/auditoria`).add({
  accion: 'reiniciar_ventana', en: Timestamp.now(),
  telefono: `…${TELEFONO.slice(-4)}`,
  ventanaPrevia: antes.mensajesVentana ?? 0,
  motivo: MOTIVO.slice(0, 200), porScript: true,
});

const despues = (await ref.get()).data() ?? {};
if ((despues.mensajesVentana ?? 0) !== 0 || despues.atencionEstado) {
  rojo('✗ La relectura no coincide. Revíselo a mano.'); process.exit(1);
}
verde('  ✓ Ventana en cero: el asistente vuelve a responder con el modelo.');
gris('  Lo ya contado en el mes sigue contado: esto no cambia la factura.');
console.log();
