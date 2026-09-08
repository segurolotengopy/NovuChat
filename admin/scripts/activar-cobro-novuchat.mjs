#!/usr/bin/env node
/**
 * =============================================================================
 * EL NEGOCIO «novuchat» Y SU QR DE COBRO — puesta en marcha del flujo interno
 * =============================================================================
 *
 * El flujo interno de cobro prepago le manda a cada cliente el QR de NovuChat.
 * Ese QR vive donde viven todos los QR de cobro real: en
 * `/tenants/novuchat/config/venta.cobroReal`, registrado y validado por la
 * pantalla «Pedidos y cobro» de la consola (que lee el código de la imagen,
 * comprueba la familia, las cuentas y el vencimiento, y lo guarda APAGADO).
 *
 * Este script hace las dos cosas que la consola no hace para ese negocio:
 *
 *   1. Crea la ficha `tenants/novuchat` si no existe, con el flujo `interno`.
 *      Sin ficha, `asignarNumero` no puede colgarle el número de NovuChat, y
 *      sin esa ruta los endpoints del flujo interno responden 401.
 *   2. ENCIENDE el QR (`cobroReal.activo = true`) después de comprobar que hay
 *      uno registrado. Encender un cobro real es un acto aparte y deliberado,
 *      y para NovuChat mismo lo hace este script y no un botón.
 *
 * El orden completo está en `Analisis/11-prepago-y-alta-de-clientes.md`:
 *   a. `node scripts/alta-comercio.mjs --tenant novuchat --nombre NovuChat
 *       --flujos venta,interno --admin cobros@... --modalidad demostracion --aplicar`
 *   b. entrar a la consola como ese administrador y registrar el QR en
 *      «Pedidos y cobro»;
 *   c. `node scripts/activar-cobro-novuchat.mjs --proyecto <id> --aplicar`.
 *
 * Sin `--aplicar` no escribe nada: dice qué haría.
 */
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const APAGAR = args.includes('--apagar');
const PROYECTO = opcion('proyecto');
const TENANT = 'novuchat';

if (!PROYECTO) {
  console.error('\n  ✗ falta --proyecto <id>\n');
  process.exit(2);
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('\n  ✗ hay FIRESTORE_EMULATOR_HOST en el entorno y esto opera sobre el proyecto real.\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const ficha = await db.doc(`tenants/${TENANT}`).get();
const venta = await db.doc(`tenants/${TENANT}/config/venta`).get();
const cobro = venta.get('cobroReal');

console.log(`\n  Proyecto : ${PROYECTO}`);
console.log(`  Ficha    : ${ficha.exists ? 'existe' : 'NO existe (se crea)'}`);
console.log(`  QR       : ${cobro?.cargaUtil ? `registrado · ${cobro.familia} · vence ${cobro.venceEl} · ${cobro.activo ? 'ENCENDIDO' : 'apagado'}` : 'NO registrado'}\n`);

if (!cobro?.cargaUtil && !APAGAR) {
  console.error('  ✗ No hay QR registrado. Regístralo desde la consola («Pedidos y cobro» del negocio');
  console.error('    novuchat, con su administrador) y volvé a correr esto.\n');
  process.exit(1);
}
if (cobro?.venceEl && /^\d{4}-\d{2}-\d{2}$/.test(cobro.venceEl)) {
  const vence = new Date(`${cobro.venceEl}T23:59:59-04:00`).getTime();
  if (vence < Date.now()) {
    console.error(`  ✗ Ese QR venció el ${cobro.venceEl}. Generá uno nuevo en el banco antes de encenderlo.\n`);
    process.exit(1);
  }
}

if (!APLICAR) {
  console.log('  Seco: no se escribió nada. Agregá --aplicar.\n');
  process.exit(0);
}

if (!ficha.exists) {
  await db.doc(`tenants/${TENANT}`).set({
    nombre: 'NovuChat', estado: 'activo', plan: 'base',
    vertical: 'interno', flujos: ['venta', 'interno'],
    razonSocial: '', nit: '', dueno: { nombre: '', telefono: '', correo: '' }, telefonosCobro: [],
    waPhoneNumberId: null, waWabaId: null,
    creadoEn: Timestamp.now(), creadoPor: 'activar-cobro-novuchat',
  });
  await db.doc(`tenants/${TENANT}/config/negocio`).set({
    nombreNegocio: 'NovuChat', zonaHoraria: 'America/La_Paz', moneda: 'BOB',
    actualizadoPor: 'activar-cobro-novuchat', actualizadoEn: Timestamp.now(),
  }, { merge: true });
  await db.doc(`tenants/${TENANT}/config/venta`).set({
    actualizadoPor: 'activar-cobro-novuchat', actualizadoEn: Timestamp.now(),
  }, { merge: true });
  await db.doc(`tenants/${TENANT}/cuenta/estado`).set({
    modalidad: 'demostracion', plan: 'base', actualizadoEn: Timestamp.now(),
  }, { merge: true });
  console.log('  ✓ ficha de novuchat creada (flujos venta e interno, sin cobro ni corte)');
}

if (cobro?.cargaUtil) {
  await db.doc(`tenants/${TENANT}/config/venta`).set({
    cobroReal: { activo: !APAGAR, activadoEn: Timestamp.now(), activadoPor: 'activar-cobro-novuchat' },
  }, { merge: true });
  await db.collection(`tenants/${TENANT}/auditoria`).add({
    accion: APAGAR ? 'apagar_cobro_real' : 'encender_cobro_real', uid: 'activar-cobro-novuchat', en: Timestamp.now(),
  });
  console.log(`  ✓ QR de NovuChat ${APAGAR ? 'APAGADO' : 'ENCENDIDO'}: el flujo interno ya puede enviarlo por su ficha.\n`);
}

console.log('  FALTA, y no lo hace este script: asignar el número de WhatsApp de NovuChat');
console.log('  con flujo `interno` y su alias de secreto en /rutasWhatsApp (scripts/asignar-numero.mjs).\n');
