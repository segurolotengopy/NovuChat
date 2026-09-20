/**
 * =============================================================================
 * ENCENDER (O APAGAR) EL COBRO REAL DE UN COMERCIO
 * =============================================================================
 *
 * POR QUÉ EXISTE. `registrarQrDeCobro` guarda el QR **apagado**, a propósito:
 * entre registrar un QR y empezar a cobrar de verdad con él tiene que haber una
 * decisión, no un efecto secundario de guardar un formulario. La consola se lo
 * dice al comercio con todas las letras —«Guardado, todavía sin cobrar… te
 * avisamos cuando lo activemos»— y por eso NO trae interruptor.
 *
 * Pero hasta el 19/09/2026 ese acto deliberado no existía en ninguna parte: el
 * QR quedaba apagado para siempre, o alguien tenía que escribir a mano en
 * Firestore. Esto es ese acto, revisable y con auditoría.
 *
 * QUÉ COMPRUEBA ANTES DE ENCENDER, y aborta si algo no cuadra:
 *   - que el comercio exista y tenga un flujo que cobre (venta o agendamiento);
 *   - que haya un QR registrado —no se enciende un cobro sin QR—;
 *   - que el QR no esté vencido, que es la causa más común de un cobro que
 *     falla en silencio;
 *   - que, si el flujo es de agendamiento, la seña tenga un importe: sin
 *     importe el asistente no pediría nada y encenderlo no cambiaría nada;
 *   - que un QR de monto CERRADO valga lo mismo que la seña: si no, el banco
 *     le cobra al cliente otro monto, el cotejo no cuadra nunca y cada reserva
 *     termina en una persona. Solo se puede ver en los QR legibles.
 *
 * LO QUE NO HACE. No toca el importe de la seña ni la retención (eso es
 * `cargar-negocio.mjs`), y no lee ni muestra la carga útil del QR.
 *
 *   node scripts/activar-cobro-real.mjs --proyecto <id> --tenant <id> [--aplicar]
 *   node scripts/activar-cobro-real.mjs --proyecto <id> --tenant <id> --apagar --aplicar
 *   ... --motivo 'prueba de seña del 19/09'    # queda en la auditoría
 *
 * Sin `--aplicar` no escribe nada: dice qué cambiaría.
 */
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const APAGAR = args.includes('--apagar');
const PROYECTO = opcion('proyecto');
const TENANT = opcion('tenant');
const MOTIVO = opcion('motivo') ?? '';

const rojo = (t) => console.log(`\x1b[1;31m${t}\x1b[0m`);
const verde = (t) => console.log(`\x1b[1;32m${t}\x1b[0m`);
const gris = (t) => console.log(`\x1b[0;90m${t}\x1b[0m`);

if (!PROYECTO || !TENANT) {
  console.error('\n  node scripts/activar-cobro-real.mjs --proyecto <id> --tenant <id> '
    + '[--apagar] [--motivo <texto>] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
const db = getFirestore();

const comercio = await db.doc(`tenants/${TENANT}`).get();
if (!comercio.exists) { rojo(`✗ No existe el comercio ${TENANT}.`); process.exit(1); }
const flujos = comercio.get('flujos') ?? [];

// El mismo criterio que `registrarQrDeCobro` (DISENO §4sexies): quien vende
// cobra la venta; quien solo agenda cobra la seña de la reserva.
const documento = flujos.includes('venta') ? 'venta'
  : (flujos.includes('agendamiento') ? 'agendamiento' : null);
if (!documento) {
  rojo(`✗ ${TENANT} no tiene un flujo que cobre (venta o agendamiento). Flujos: ${JSON.stringify(flujos)}`);
  process.exit(1);
}

const ref = db.doc(`tenants/${TENANT}/config/${documento}`);
const cfg = await ref.get();
const qr = cfg.get('cobroReal');
if (!qr) {
  rojo(`✗ ${TENANT} no tiene ningún QR registrado en config/${documento}.`);
  gris('  El comercio lo carga en la consola: Cobros → Configuración de QR.');
  process.exit(1);
}

const estabaActivo = qr.activo === true;
const importe = cfg.get('senaImporte');
const hoy = new Date().toISOString().slice(0, 10);

console.log();
console.log(`  Comercio  : ${TENANT} — ${comercio.get('nombre') ?? ''}`);
console.log(`  Documento : config/${documento}`);
console.log(`  QR        : ${qr.nombreCuenta ?? '(sin nombre)'} · ${qr.banco || 'sin banco'} · vence ${qr.venceEl ?? '(sin fecha)'}`);
console.log(`  Estado    : ${estabaActivo ? 'COBRANDO' : 'guardado, sin cobrar'} → ${APAGAR ? 'guardado, sin cobrar' : 'COBRANDO'}`);
if (documento === 'agendamiento') console.log(`  Seña      : importe ${importe ?? '(sin importe)'} · retención ${cfg.get('senaMinutosRetencion') ?? '(respaldo)'} min`);
console.log();

if (!APAGAR) {
  const problemas = [];
  if (typeof qr.venceEl === 'string' && qr.venceEl !== '' && qr.venceEl < hoy) {
    problemas.push(`El QR venció el ${qr.venceEl}. Que el comercio cargue uno nuevo antes de encender el cobro.`);
  }
  if (documento === 'agendamiento' && !(Number.isInteger(importe) && importe > 0)) {
    problemas.push('La seña no tiene importe (`senaImporte`), así que el asistente no pediría nada. '
      + 'Cárguelo con `cargar-negocio.mjs` antes de encender.');
  }
  // EL QR DE MONTO CERRADO QUE NO COINCIDE CON LA SEÑA (19/09/2026). Si el
  // código trae un importe grabado y NO es el de la seña, el banco obliga al
  // cliente a pagar ese otro monto: el cotejo dice «no cuadra» SIEMPRE, todas
  // las reservas terminan en una persona, y el comercio no entiende por qué.
  // Nadie pierde plata en silencio —el cotejo compara contra la seña, no
  // contra el QR—, pero es un cobro que no funciona, y encenderlo así es
  // encender algo roto. Solo se puede comprobar en los QR legibles: en un
  // cifrado no hay nada que leer, y por eso el comercio lo declara.
  if (documento === 'agendamiento' && typeof qr.montoFijo === 'number' && qr.montoFijo !== importe) {
    problemas.push(`El QR cobra siempre ${qr.montoFijo} y la seña es de ${importe}. `
      + 'El banco le cobraría al cliente el monto del QR, el cotejo nunca cuadraría y cada reserva '
      + 'terminaría en una persona. Iguale la seña al QR, o que el comercio genere uno de monto abierto.');
  }
  if (problemas.length > 0) {
    for (const p of problemas) rojo(`✗ ${p}`);
    process.exit(1);
  }
}

if (estabaActivo === !APAGAR) {
  verde(`✓ Ya estaba ${APAGAR ? 'apagado' : 'encendido'}: no hay nada que cambiar.`);
  process.exit(0);
}

if (!APLICAR) {
  gris('  Seco: no se escribió nada. Agregue --aplicar.\n');
  process.exit(0);
}

await ref.set({
  cobroReal: {
    activo: !APAGAR,
    [APAGAR ? 'apagadoEn' : 'activadoEn']: Timestamp.now(),
  },
}, { merge: true });

await db.collection(`tenants/${TENANT}/auditoria`).add({
  accion: APAGAR ? 'apagar_cobro_real' : 'activar_cobro_real',
  en: Timestamp.now(), documento, motivo: MOTIVO.slice(0, 200), porScript: true,
});

const releido = (await ref.get()).get('cobroReal');
if (releido?.activo !== !APAGAR) { rojo('✗ La relectura no coincide. Revíselo a mano.'); process.exit(1); }
verde(`\n  ✓ Cobro real ${APAGAR ? 'APAGADO' : 'ENCENDIDO'} para ${TENANT} (config/${documento}), y anotado en la auditoría.`);
if (!APAGAR && documento === 'agendamiento') {
  gris('  Desde ahora, cada reserva retiene el horario y manda el QR con el resumen.');
  gris('  El asistente NUNCA dice que el pago se acreditó: eso lo confirma el negocio.');
}
console.log();
