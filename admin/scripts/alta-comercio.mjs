/**
 * ALTA DE UN COMERCIO REAL, con su administrador.
 *
 * POR QUÉ EXISTE, y por qué es el único camino que faltaba. Las funciones
 * `altaTenant` e `invitarUsuario` exigen que la persona YA HAYA INGRESADO una
 * vez —`getUserByEmail` y, si no está, `failed-precondition`—. Pero un
 * administrador de comercio entra con correo y contraseña, y la consola **no
 * tiene pantalla de registro**: nadie puede crearse una cuenta. O sea que hasta
 * hoy no había forma de dar de alta a un cliente real. El único script que
 * creaba usuarios era `usuarios-prueba.mjs`, con contraseñas conocidas escritas
 * en el propio script: perfecto para probar, inadmisible para un cliente.
 *
 * CÓMO SE RESUELVE LA CONTRASEÑA. No se elige ninguna. Se crea la cuenta con una
 * clave aleatoria de 32 bytes que **no se imprime, no se guarda y nadie ve**, y
 * se genera un enlace de restablecimiento para que la persona ponga la suya. Es
 * la diferencia entre «te mando tu contraseña por WhatsApp» y un alta seria.
 *
 * Y RESUELVE ADEMÁS EL CORREO VERIFICADO, que las reglas exigen para cualquier
 * rol de comercio: completar un restablecimiento de contraseña marca el correo
 * como verificado, porque la persona probó que tiene acceso a esa casilla. Por
 * eso el alta NO pone `emailVerified: true` a mano como hace el script de
 * pruebas: acá el correo se verifica de verdad.
 *
 *   node scripts/alta-comercio.mjs --proyecto <id> \
 *     --tenant salon-rosa --nombre "Salón Rosa" --flujos agendamiento \
 *     --admin ana@ejemplo.com --nombre-admin "Ana Quispe" \
 *     --modalidad prueba --plan base --telefonos-cobro 5917XXXXXXX \
 *     --razon-social "Salón Rosa SRL" --nit 1234567 --dueno "Ana Quispe"
 *
 * LA CUENTA PREPAGO NACE CON EL ALTA (2026-09-07). `--modalidad` es `prueba`
 * (mes calendario en curso, sin mensualidad, 20 conversaciones), `prepago`
 * (con `--primer-mes-pagado` si ya pagó) o `demostracion` (sin cobro ni corte).
 * Sin modalidad el negocio sería una demostración más. Ver
 * `admin/functions/src/prepago.ts`. Este script hace lo mismo que la pantalla
 * «Dar de alta un negocio» de la consola; existe para cuando la consola no está
 * a mano o las Functions no están desplegadas.
 *
 * Requiere `pnpm functions:build` hecho: importa el módulo compilado de prepago
 * para escribir los mismos campos derivados que escribe el servidor.
 *
 * Sin `--aplicar` no escribe nada: dice qué haría.
 */
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');

const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const NOMBRE = opcion('nombre');
const ADMIN = opcion('admin');
const NOMBRE_ADMIN = opcion('nombre-admin') ?? '';
const FLUJOS = (opcion('flujos') ?? 'agendamiento').split(',').map((f) => f.trim()).filter(Boolean);
const MODALIDAD = opcion('modalidad') ?? 'prueba';
const PLAN = opcion('plan') ?? 'base';
const PRIMER_MES_PAGADO = args.includes('--primer-mes-pagado');
const RAZON_SOCIAL = opcion('razon-social') ?? '';
const NIT = opcion('nit') ?? '';
const DUENO = opcion('dueno') ?? '';
const TELEFONO_DUENO = (opcion('telefono-dueno') ?? '').replace(/\D/g, '');
const CORREO_DUENO = (opcion('correo-dueno') ?? '').toLowerCase();
const TELEFONOS_COBRO = [...new Set((opcion('telefonos-cobro') ?? '').split(',')
  .map((t) => t.replace(/\D/g, '')).filter(Boolean))];

const FLUJOS_VALIDOS = new Set(['agendamiento', 'venta', 'interno']);
// Mismo formato que `ID_TENANT` en functions/src/index.ts.
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!ID_TENANT.test(TENANT)) problemas.push('--tenant inválido (minúsculas, guiones, 3 a 60)');
if (!NOMBRE) problemas.push('falta --nombre');
if (!ADMIN || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ADMIN)) problemas.push('--admin no es un correo');
for (const f of FLUJOS) if (!FLUJOS_VALIDOS.has(f)) problemas.push(`flujo desconocido: ${f}`);
if (!['prueba', 'prepago', 'demostracion'].includes(MODALIDAD)) problemas.push('--modalidad: prueba, prepago o demostracion');
if (!['base', 'crecimiento', 'corporativo'].includes(PLAN)) problemas.push('--plan: base, crecimiento o corporativo');
if (NIT && !/^[0-9]{5,15}$/.test(NIT)) problemas.push('--nit: solo dígitos');
if (TELEFONO_DUENO && !/^[0-9]{8,15}$/.test(TELEFONO_DUENO)) problemas.push('--telefono-dueno inválido');
for (const t of TELEFONOS_COBRO) if (!/^[0-9]{8,15}$/.test(t)) problemas.push(`teléfono de cobro inválido: ${t}`);
if (TELEFONOS_COBRO.length > 5) problemas.push('hasta cinco teléfonos de cobro');
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/alta-comercio.mjs --proyecto <id> --tenant <id> --nombre "<nombre>" \\');
  console.error('      --flujos agendamiento[,venta] --admin <correo> [--nombre-admin "<nombre>"] \\');
  console.error('      [--modalidad prueba|prepago|demostracion] [--plan base|crecimiento|corporativo] \\');
  console.error('      [--primer-mes-pagado] [--telefonos-cobro 591...,591...] [--razon-social ..] [--nit ..] \\');
  console.error('      [--dueno ..] [--telefono-dueno ..] [--correo-dueno ..] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const { getAuth } = await import('firebase-admin/auth');
// El MISMO módulo que usa el servidor para cortar y para mostrar el saldo.
// Compilado: exige `pnpm functions:build`.
const prepago = await import('../functions/lib/prepago.js').catch(() => null);
if (!prepago) {
  console.error('\n  ✗ Falta functions/lib/prepago.js: corré `pnpm functions:build` primero.\n');
  process.exit(2);
}
initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const auth = getAuth();

// Mismo mapa que `documentoDeVertical` en functions/src/prompt.ts.
const DOCUMENTO = { agendamiento: 'agendamiento', venta: 'venta' };

console.log(`\n  Negocio    : ${TENANT} · ${NOMBRE}`);
console.log(`  Flujos     : ${FLUJOS.join(', ')}`);
console.log(`  Modalidad  : ${MODALIDAD} · plan ${PLAN}${MODALIDAD === 'prepago' ? (PRIMER_MES_PAGADO ? ' · mes en curso pagado' : ' · SIN pago: queda detenido hasta registrar el pago') : ''}`);
console.log(`  Cobro      : ${TELEFONOS_COBRO.length ? `${TELEFONOS_COBRO.length} teléfono(s)` : 'SIN teléfono de cobro (no podrá pagar por WhatsApp ni recibir recordatorios)'}`);
console.log(`  Admin      : ${ADMIN}${NOMBRE_ADMIN ? ` (${NOMBRE_ADMIN})` : ''}`);
console.log(`  Proyecto   : ${PROYECTO}\n`);

// UN IDENTIFICADOR NO SE REUTILIZA NUNCA, ni siquiera uno dado de baja: un claim
// viejo que todavía diga {"salon-x": "admin"} le daría al dueño anterior acceso
// al negocio nuevo. Es la misma regla que aplica `altaTenant`.
if ((await db.doc(`tenants/${TENANT}`).get()).exists) {
  console.error(`  ✗ El identificador «${TENANT}» ya se usó. Elegí otro.\n`);
  process.exit(1);
}

const yaExiste = await auth.getUserByEmail(ADMIN).catch(() => null);
if (yaExiste) {
  console.log(`  ! Ya hay una cuenta con ese correo (${yaExiste.uid.slice(0, 8)}…).`);
  console.log('    Se le dará el rol en este negocio, sin tocar su contraseña.\n');
}

if (!APLICAR) {
  console.log('  Seco: no se escribió nada. Agregá --aplicar.\n');
  process.exit(0);
}

// --- 1. la cuenta -----------------------------------------------------------
let usuario = yaExiste;
if (!usuario) {
  usuario = await auth.createUser({
    email: ADMIN,
    ...(NOMBRE_ADMIN ? { displayName: NOMBRE_ADMIN } : {}),
    // Aleatoria y descartada en el acto. Nadie la conoce, ni siquiera quien
    // corre este script: la persona pone la suya con el enlace de abajo.
    password: randomBytes(32).toString('base64url'),
    emailVerified: false,
  });
  console.log(`  ✓ cuenta creada (${usuario.uid.slice(0, 8)}…)`);
}

// --- 2. la ficha del negocio ------------------------------------------------
const sello = { creadoEn: Timestamp.now(), creadoPor: 'alta-comercio' };
const lote = db.batch();
lote.create(db.doc(`tenants/${TENANT}`), {
  nombre: NOMBRE, estado: 'activo', plan: PLAN,
  vertical: FLUJOS[0], flujos: FLUJOS,
  razonSocial: RAZON_SOCIAL, nit: NIT,
  dueno: { nombre: DUENO, telefono: TELEFONO_DUENO, correo: CORREO_DUENO },
  telefonosCobro: TELEFONOS_COBRO,
  waPhoneNumberId: null, waWabaId: null, ...sello,
});
// LA CUENTA PREPAGO, con los mismos derivados que escribe `escribirCuenta` en
// el servidor: estado de pago, mensualidad y vencimiento salen del módulo.
const periodo = prepago.periodoDe(Date.now());
const cuenta = {
  plan: PLAN, modalidad: MODALIDAD, bolsa: 0,
  ...(MODALIDAD === 'prueba' ? { periodoPrueba: periodo, bolsaPrueba: prepago.PRUEBA.conversaciones } : {}),
  ...(MODALIDAD === 'prepago' ? { periodoPagado: PRIMER_MES_PAGADO ? periodo : '' } : {}),
};
const estado = prepago.estadoDeServicio(cuenta, 0, periodo);
lote.create(db.doc(`tenants/${TENANT}/cuenta/estado`), {
  ...cuenta,
  estadoPago: estado.cubierto ? 'al_dia' : 'vencido',
  montoMensual: estado.mensualidad, moneda: prepago.MONEDA,
  ...(estado.cubiertoHasta
    ? { proximoVencimiento: Timestamp.fromMillis(prepago.finDelPeriodoMs(estado.cubiertoHasta)) } : {}),
  motivoVisible: '', actualizadoEn: Timestamp.now(),
});
lote.create(db.doc(`tenants/${TENANT}/config/negocio`), {
  nombreNegocio: NOMBRE, zonaHoraria: 'America/La_Paz', moneda: 'BOB',
  actualizadoPor: 'alta-comercio', actualizadoEn: Timestamp.now(),
});
// El documento de cada flujo nace acá: las reglas prohíben crearlo desde el
// navegador, así que sin esto la pestaña del flujo no podría guardar nunca.
for (const f of FLUJOS) {
  if (DOCUMENTO[f]) {
    lote.create(db.doc(`tenants/${TENANT}/config/${DOCUMENTO[f]}`), {
      actualizadoPor: 'alta-comercio', actualizadoEn: Timestamp.now(),
    });
  }
}
lote.create(db.doc(`tenants/${TENANT}/miembros/${usuario.uid}`), {
  correo: ADMIN, rol: 'admin', estado: 'activo', desde: Timestamp.now(),
});
await lote.commit();
console.log('  ✓ ficha, configuración y membresía');

// --- 3. el rol --------------------------------------------------------------
// Misma forma de claim que functions/src/claims.ts: claves de una letra, porque
// el token tiene un tope de 1000 bytes.
const actual = (usuario.customClaims ?? {}).nc ?? {};
await auth.setCustomUserClaims(usuario.uid, {
  ...(usuario.customClaims ?? {}),
  nc: { ...actual, t: { ...(actual.t ?? {}), [TENANT]: 'admin' }, v: (actual.v ?? 0) + 1 },
});
console.log('  ✓ rol de administrador');

// --- 4. el enlace -----------------------------------------------------------
const enlace = await auth.generatePasswordResetLink(ADMIN);
console.log('\n  Enlace para que ponga su contraseña (vence en unas horas):\n');
console.log(`  ${enlace}\n`);
console.log('  Al completarlo, Firebase marca el correo como verificado, que es lo');
console.log('  que las reglas exigen para cualquier rol de comercio.\n');

// --- verificación por relectura ---------------------------------------------
const ficha = await db.doc(`tenants/${TENANT}`).get();
const claim = ((await auth.getUser(usuario.uid)).customClaims ?? {}).nc ?? {};
const cuentaEscrita = await db.doc(`tenants/${TENANT}/cuenta/estado`).get();
console.log(`  Verificación: ficha ${ficha.exists ? 'sí' : 'NO'}`
  + ` · flujos ${JSON.stringify(ficha.get('flujos'))}`
  + ` · rol ${claim.t?.[TENANT] ?? 'NO'}`
  + ` · cuenta ${cuentaEscrita.get('modalidad') ?? 'NO'} (${estado.operativo ? 'operativa' : `detenida: ${estado.motivo}`})\n`);
console.log('  FALTA, y no lo hace este script: asignarle su número de WhatsApp');
console.log('  con `asignarNumero`, y cargar el secreto de su alias.\n');
