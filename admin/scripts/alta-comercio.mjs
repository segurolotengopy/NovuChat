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
 *     --admin ana@ejemplo.com --nombre-admin "Ana Quispe"
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

const FLUJOS_VALIDOS = new Set(['agendamiento', 'venta', 'interno']);
// Mismo formato que `ID_TENANT` en functions/src/index.ts.
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!ID_TENANT.test(TENANT)) problemas.push('--tenant inválido (minúsculas, guiones, 3 a 60)');
if (!NOMBRE) problemas.push('falta --nombre');
if (!ADMIN || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ADMIN)) problemas.push('--admin no es un correo');
for (const f of FLUJOS) if (!FLUJOS_VALIDOS.has(f)) problemas.push(`flujo desconocido: ${f}`);
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/alta-comercio.mjs --proyecto <id> --tenant <id> --nombre "<nombre>" \\');
  console.error('      --flujos agendamiento[,venta] --admin <correo> [--nombre-admin "<nombre>"] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const { getAuth } = await import('firebase-admin/auth');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const auth = getAuth();

// Mismo mapa que `documentoDeVertical` en functions/src/prompt.ts.
const DOCUMENTO = { agendamiento: 'agendamiento', venta: 'venta' };

console.log(`\n  Negocio    : ${TENANT} · ${NOMBRE}`);
console.log(`  Flujos     : ${FLUJOS.join(', ')}`);
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
  nombre: NOMBRE, estado: 'activo', plan: 'basico',
  vertical: FLUJOS[0], flujos: FLUJOS,
  waPhoneNumberId: null, waWabaId: null, ...sello,
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
console.log(`  Verificación: ficha ${ficha.exists ? 'sí' : 'NO'}`
  + ` · flujos ${JSON.stringify(ficha.get('flujos'))}`
  + ` · rol ${claim.t?.[TENANT] ?? 'NO'}\n`);
console.log('  FALTA, y no lo hace este script: asignarle su número de WhatsApp');
console.log('  con `asignarNumero`, y cargar el secreto de su alias.\n');
