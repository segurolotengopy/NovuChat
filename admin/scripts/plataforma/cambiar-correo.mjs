/**
 * CAMBIAR EL CORREO DE UNA CUENTA CONSERVANDO SU uid, SECO POR OMISIÓN.
 *
 * POR QUÉ. Los roles (claims `nc.t`), el titular (`titularCuentaUid`) y las membresías cuelgan del uid: cambiar el
 * correo de la MISMA cuenta los conserva; crear otra cuenta los perdería. El 21/10/2026 el correo con el que se dio de
 * alta a Antonio (rroca-antonio y rroca-emma comparten cuenta) hubo que cambiarlo antes de su primer ingreso.
 *
 * QUÉ HACE, en este orden: (1) Auth: `email` nuevo, `emailVerified=false` y una contraseña aleatoria que nadie ve (la de alta deja de servir), y
 * cierra las sesiones; (2) en UN lote atómico de Firestore, `correo` de la membresía en cada comercio de la
 * cuenta, y una auditoría `cambiar_correo` por comercio (con el correo anterior, para la vuelta atrás; sin correos
 * en la salida). La cuenta se busca por el TITULAR de `--tenant`, así que no hace falta saber el correo viejo.
 * Si se corta entre (1) y (2), repetir el mismo comando completa lo pendiente.
 *
 * VUELTA ATRÁS: `--revertir` toma el correo anterior de la última auditoría `cambiar_correo` del comercio.
 *
 *   node scripts/plataforma/cambiar-correo.mjs --proyecto <id> --operador <correo> --tenant rroca-antonio --a <correo nuevo>
 *   node scripts/plataforma/cambiar-correo.mjs ... --tenant rroca-antonio --revertir
 *   ... --aplicar      # sin esto no escribe nada
 *
 * Nunca imprime un correo completo. Salida: 0 hecho o seco sin problemas; 1 rechazo o error; 2 llamada mal hecha.
 */
import { randomBytes } from 'node:crypto';
import { CORREO, enmascarar, esExcluido, planearCambioCorreo } from './cambiar-correo-logica.mjs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const REVERTIR = args.includes('--revertir');
const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const OPERADOR = (opcion('operador') ?? '').trim().toLowerCase();
let NUEVO = (opcion('a') ?? '').trim().toLowerCase();

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(TENANT)) problemas.push('--tenant inválido');
if (esExcluido(TENANT)) problemas.push(`${TENANT} no se toca desde este script`);
if (!CORREO.test(OPERADOR)) problemas.push('--operador <correo> es obligatorio: es quien queda en la auditoría');
if (REVERTIR === Boolean(NUEVO)) problemas.push('indique --a <correo nuevo> o --revertir (uno solo)');
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/plataforma/cambiar-correo.mjs --proyecto <id> --operador <correo> --tenant <id> (--a <correo> | --revertir) [--aunque-haya-ingresado] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const { getAuth } = await import('firebase-admin/auth');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const auth = getAuth();
const soloInexistente = (e) => { if (e?.code === 'auth/user-not-found') return null; throw e; };
const fallo = (m) => { console.error(`\n  ✗ ${m}\n`); process.exit(1); };

const ficha = await db.doc(`tenants/${TENANT}`).get();
if (!ficha.exists) fallo(`el comercio «${TENANT}» no existe`);
const uid = ficha.get('titularCuentaUid');
if (!uid) fallo('el comercio no tiene titular de cuenta: no se sabe qué cuenta cambiar');
const u = await auth.getUser(uid).catch(soloInexistente);
if (!u) fallo('la cuenta titular no existe en Auth');

if (REVERTIR) {
  // Sin índice compuesto: se leen las auditorías de la acción y se ordenan acá. Solo vale la que es de ESTA cuenta y
  // cuyo correo nuevo es el que la cuenta tiene hoy: así una auditoría ajena o vieja no pone un correo cualquiera.
  const aud = await db.collection(`tenants/${TENANT}/auditoria`).where('accion', '==', 'cambiar_correo').limit(50).get();
  const ult = aud.docs.filter((d) => d.get('uidAfectado') === uid && String(d.get('correoNuevo') ?? '').toLowerCase() === String(u.email ?? '').toLowerCase())
    .sort((a, b) => b.get('en').toMillis() - a.get('en').toMillis())[0];
  NUEVO = String(ult?.get('correoAnterior') ?? '').toLowerCase();
  if (!NUEVO) fallo('no hay una auditoría cambiar_correo de esta cuenta que lleve a su correo actual');
  console.log(`\n  Revertir a: ${enmascarar(NUEVO)}`);
}

const usuario = { uid, email: u.email, deshabilitada: u.disabled, conSegundoFactor: (u.multiFactor?.enrolledFactors ?? []).length > 0, proveedores: u.providerData.map((p) => p.providerId), ultimoIngreso: u.metadata.lastSignInTime || null, claims: ((u.customClaims ?? {}).nc ?? {}).t ?? {} };
const otro = await auth.getUserByEmail(NUEVO).catch(soloInexistente);
const miembros = await Promise.all(Object.keys(usuario.claims).map(async (t) => {
  const s = await db.doc(`tenants/${t}/miembros/${uid}`).get();
  return { tenant: t, existe: s.exists, correo: s.get('correo') };
}));
const plan = planearCambioCorreo({ usuario, nuevo: NUEVO, uidDelNuevo: otro?.uid ?? null, miembros, permitirIngresada: args.includes('--aunque-haya-ingresado') });
if (plan.error) fallo(plan.error);

console.log(`\n  Cuenta    : titular de ${TENANT} (comercios: ${plan.tenants.join(', ')})`);
console.log(`  Correo    : ${enmascarar(u.email)} → ${enmascarar(plan.nuevo)}  (emailVerified pasa a false)`);
console.log(`  Auth      : ${plan.haceAuth ? 'se cambia el correo y se cierran las sesiones' : 'ya tiene el correo nuevo'}`);
console.log(`  Membresías: ${plan.miembros.length ? plan.miembros.join(', ') : 'ninguna pendiente'}`);
console.log(`  Operador  : ${enmascarar(OPERADOR)}`);
if (plan.sinCambios) { console.log('\n  Sin cambios: la cuenta ya está así.\n'); process.exit(0); }
if (!APLICAR) { console.log('\n  Seco: no se escribió nada. Agregue --aplicar.\n'); process.exit(0); }

// Reanudando (Auth ya cambió), el correo anterior es el que sigue en las membresías sin actualizar.
const anterior = plan.haceAuth ? u.email : miembros.find((m) => plan.miembros.includes(m.tenant))?.correo;
try {
  if (plan.haceAuth) {
    // Contraseña aleatoria que nadie ve: la de antes no sirve con el correo nuevo. La persona pone la suya con «Olvidé mi contraseña».
    await auth.updateUser(uid, { email: plan.nuevo, emailVerified: false, password: randomBytes(24).toString('base64url') });
  }
  await auth.revokeRefreshTokens(uid);
  const lote = db.batch();
  for (const t of plan.miembros) {
    lote.update(db.doc(`tenants/${t}/miembros/${uid}`), { correo: plan.nuevo });
    lote.create(db.collection(`tenants/${t}/auditoria`).doc(), {
      accion: 'cambiar_correo', uid: OPERADOR, origen: 'script', script: 'cambiar-correo', en: Timestamp.now(),
      uidAfectado: uid, correoNuevo: plan.nuevo, correoAnterior: String(anterior ?? '').toLowerCase(),
    });
  }
  await lote.commit();
} catch (e) {
  fallo(`${e instanceof Error ? e.message : String(e)}\n  Si Auth ya cambió, repita el mismo comando: completa lo pendiente.`);
}
const v = await auth.getUser(uid);
const ms = await Promise.all(plan.tenants.map(async (t) => (await db.doc(`tenants/${t}/miembros/${uid}`).get()).get('correo')));
const ok = v.email === plan.nuevo && v.emailVerified === false && ms.every((c) => String(c).toLowerCase() === plan.nuevo);
console.log(`\n  ${ok ? '✓' : '✗'} Verificación: ${enmascarar(v.email)} · emailVerified ${v.emailVerified} · membresías ${ms.every((c) => String(c).toLowerCase() === plan.nuevo) ? 'al día' : 'PENDIENTES'}\n`);
process.exit(ok ? 0 : 1);
