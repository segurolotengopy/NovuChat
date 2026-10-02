/**
 * =============================================================================
 * SOLTAR LA SEÑA PENDIENTE DE UN TELÉFONO
 * =============================================================================
 *
 * POR QUÉ EXISTE. Mientras un teléfono tiene una seña pendiente, el asistente
 * le pide el comprobante en cada vuelta: es lo correcto —el horario está
 * retenido a su nombre— pero deja de serlo cuando esa reserva ya no va a
 * completarse y el flujo de señas vencidas no la liberó. El 19/09/2026 pasó
 * justamente eso: la cita quedó retenida, el flujo programado no la encontró,
 * y el paciente quedó atrapado en un pedido de comprobante que no tenía fin.
 *
 * Esto es la salida manual: limpia el estado pendiente de ESE teléfono, en ESE
 * comercio, y lo deja como si nunca hubiera empezado el cobro.
 *
 * LO QUE NO HACE, y hay que saberlo: **no toca el calendario**. Si la cita
 * retenida sigue existiendo, el horario sigue ocupado y hay que borrarla desde
 * el calendario del negocio. Acá no hay credencial de Google, y borrar una cita
 * de un cliente a ciegas es peor que dejarla.
 *
 *   node scripts/soltar-sena-pendiente.mjs --proyecto <id> --tenant <id> \
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
  console.error('\n  node scripts/soltar-sena-pendiente.mjs --proyecto <id> --tenant <id> '
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

const solicitud = conv.get('solicitud') ?? {};
const evento = solicitud.evento ?? null;
console.log();
console.log(`  Comercio : ${TENANT}`);
console.log(`  Teléfono : …${TELEFONO.slice(-4)}`);
console.log(`  Etapa    : ${solicitud.etapa ?? '(sin solicitud)'}`);
console.log(`  QR enviado: ${solicitud.qrEnviadoEn?.toDate?.().toISOString() ?? 'no'}`);
console.log(`  Cotejos  : ${solicitud.cotejos ?? 0}`);
console.log(`  Cita retenida: ${evento ? `${evento.id} (calendario …${String(evento.calendario ?? '').slice(0, 6)}…)` : 'ninguna'}`);
console.log();

if (!solicitud.qrEnviadoEn && !evento) {
  verde('  ✓ Ese teléfono no tiene ninguna seña pendiente: no hay nada que soltar.');
  process.exit(0);
}

if (!APLICAR) {
  gris('  Seco: no se escribió nada. Agregue --aplicar.\n');
  process.exit(0);
}

await ref.set({
  solicitud: {
    etapa: 'agendada',
    qrEnviadoEn: FieldValue.delete(),
    evento: FieldValue.delete(),
    soltadaEn: Timestamp.now(),
  },
}, { merge: true });

await db.collection(`tenants/${TENANT}/auditoria`).add({
  accion: 'soltar_sena_pendiente', en: Timestamp.now(),
  telefono: `…${TELEFONO.slice(-4)}`, motivo: MOTIVO.slice(0, 200), porScript: true,
});

const despues = (await ref.get()).get('solicitud') ?? {};
if (despues.qrEnviadoEn || despues.evento) { rojo('✗ La relectura sigue mostrando la seña pendiente.'); process.exit(1); }
verde('  ✓ Seña pendiente soltada: el asistente deja de pedir el comprobante.');
if (evento) {
  gris(`  OJO: la cita retenida ${evento.id} NO se borró. Mientras exista, ese`);
  gris('  horario sigue ocupado: bórrela desde el calendario del negocio.');
}
console.log();
