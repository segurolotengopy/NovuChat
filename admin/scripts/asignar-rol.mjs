#!/usr/bin/env node
/**
 * =============================================================================
 * DARLE ACCESO A LA CONSOLA A UNA PERSONA DE UN COMERCIO QUE YA EXISTE
 * =============================================================================
 *
 * POR QUÉ EXISTE. El modelo de roles y las reglas de Firestore soportan un
 * OPERADOR por comercio desde siempre (`functions/src/claims.ts`,
 * `firestore.rules`), pero no había forma de otorgarlo: `alta-comercio.mjs`
 * crea el comercio con UN administrador y nada más. El 23/09/2026 el Dr.
 * Bellido preguntó si su asistente, María René, podía entrar al sistema, y dio
 * por hecho que no: «Creo que no, ¿no? ¿Tendría que hacerlo manual?». Sí
 * puede, y esto es lo que faltaba para decírselo con un hecho.
 *
 * QUÉ VE UN OPERADOR, y por qué es el rol correcto para una recepción
 * (`firestore.rules`, donde está escrito con su motivo):
 *   · SÍ: las conversaciones, los contactos, lo operativo del negocio. Es lo
 *     que hace falta para atender a un paciente.
 *   · NO: el estado de cuenta ni la situación financiera —«no es asunto de
 *     quien atiende el chat»— ni los teléfonos de pago del negocio.
 * Un administrador ve todo. Si la persona además paga, va `admin`, no `oper`.
 *
 * LO QUE ESTE SCRIPT NO HACE. No crea comercios (eso es `alta-comercio.mjs`) y
 * NUNCA otorga el rol `ingesta`: ese es para identidades de servicio y
 * `claims.ts` lo rechaza para una cuenta de persona. Acá se rechaza antes,
 * para que el motivo se lea en una línea.
 *
 * EL ENLACE DE CONTRASEÑA NO SE IMPRIME. Quien tenga el `oobCode` fija la
 * contraseña de esa cuenta: es la credencial misma. Va a un archivo del `$HOME`
 * con permisos 600, fuera de todo repositorio, igual que en `alta-comercio.mjs`
 * y por el mismo incidente del 15/09/2026, cuando un enlace quedó a la vista en
 * una conversación y hubo que rotar la contraseña.
 *
 *   node scripts/asignar-rol.mjs --proyecto <id> --tenant bellido \
 *     --correo recepcion@ejemplo.com --rol oper --nombre "María René" [--aplicar]
 *
 *   node scripts/asignar-rol.mjs --proyecto <id> --tenant bellido \
 *     --correo recepcion@ejemplo.com --quitar [--aplicar]
 *
 * Sin `--aplicar` no escribe nada: dice qué haría. Salida: 0 si hizo (o si el
 * seco terminó bien), 1 si no pudo, 2 si la llamada está mal.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const bandera = (n) => args.includes(`--${n}`);

const PROYECTO = opcion('proyecto');
const TENANT = opcion('tenant');
const CORREO = opcion('correo');
const NOMBRE = opcion('nombre') ?? '';
const QUITAR = bandera('quitar');
const ROL = opcion('rol') ?? (QUITAR ? null : 'oper');
const APLICAR = bandera('aplicar');

// Los roles que una PERSONA puede tener en un comercio. `ingesta` no está, y no
// es un olvido: `claims.ts` lo reserva para el principal de servicio de la
// ingesta y rechaza dárselo a una cuenta con contraseña.
const ROLES = ['admin', 'oper'];

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!TENANT || !/^[a-z0-9-]{3,40}$/.test(TENANT)) problemas.push('--tenant no es un identificador válido');
if (!CORREO || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(CORREO)) problemas.push('--correo no es un correo');
if (!QUITAR && !ROLES.includes(String(ROL))) {
  problemas.push(`--rol tiene que ser ${ROLES.join(' o ')}`
    + (ROL === 'ingesta' ? ' («ingesta» es solo para identidades de servicio, nunca para una persona)' : ''));
}
if (QUITAR && opcion('rol')) problemas.push('--quitar no lleva --rol: quita el que tenga');
if (NOMBRE.length > 80) problemas.push('--nombre es demasiado largo');
if (problemas.length) {
  console.error(`\n  ✗ ${problemas.join('\n  ✗ ')}\n`);
  console.error('  Uso: asignar-rol.mjs --proyecto <id> --tenant <id> --correo <correo>');
  console.error('       [--rol admin|oper] [--nombre "<nombre>"] [--quitar] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

console.log(`\n  Comercio : ${TENANT}`);
console.log(`  Persona  : ${CORREO}${NOMBRE ? ` (${NOMBRE})` : ''}`);
console.log(`  Acción   : ${QUITAR ? 'QUITAR el acceso' : `dar el rol «${ROL}»`}`);
console.log(`  Proyecto : ${PROYECTO}\n`);

// EL COMERCIO TIENE QUE EXISTIR. Un `--tenant` mal escrito escribiría un claim
// para un comercio que no existe, y ese claim queda en la cuenta para siempre:
// el día que alguien use ese identificador, esta persona entraría sin que nadie
// lo haya decidido. Es la misma razón por la que un identificador no se
// reutiliza nunca (`alta-comercio.mjs`).
const ficha = await db.doc(`tenants/${TENANT}`).get();
if (!ficha.exists) {
  console.error(`  ✗ El comercio «${TENANT}» no existe. Revisa el identificador.\n`);
  process.exit(1);
}
console.log(`  Negocio  : ${ficha.get('nombre') ?? '(sin nombre)'} · estado ${ficha.get('estado') ?? '?'}\n`);

if (!APLICAR) {
  console.log(QUITAR
    ? '  Seco: se quitaría el rol de esa persona en este comercio y se cerrarían sus sesiones.'
    : `  Seco: se le daría el rol «${ROL}» en este comercio`
      + '\n  (si la cuenta no existe, se crearía y se escribiría su enlace de contraseña en $HOME).');
  console.log('  No se escribió nada. Agrega --aplicar.\n');
  process.exit(0);
}

const { getAuth } = await import('firebase-admin/auth');
const auth = getAuth();
const existente = await auth.getUserByEmail(CORREO).catch(() => null);

// --- quitar -----------------------------------------------------------------
if (QUITAR) {
  if (!existente) {
    console.error('  ✗ No hay ninguna cuenta con ese correo: no hay nada que quitar.\n');
    process.exit(1);
  }
  const previo = (existente.customClaims ?? {}).nc ?? {};
  const tenants = { ...(previo.t ?? {}) };
  const teniaEl = tenants[TENANT];
  delete tenants[TENANT];
  await auth.setCustomUserClaims(existente.uid, {
    ...(existente.customClaims ?? {}),
    nc: { ...previo, t: tenants, v: (previo.v ?? 0) + 1 },
  });
  // QUITAR UN ROL CIERRA LAS SESIONES. Un token ya emitido vale hasta una hora:
  // sin esto, la persona seguiría entrando después de que se le quitó el
  // acceso, que es exactamente lo que nadie espera de un «quitar».
  await auth.revokeRefreshTokens(existente.uid);
  await db.doc(`tenants/${TENANT}/miembros/${existente.uid}`)
    .set({ estado: 'baja', rol: teniaEl ?? null, hasta: Timestamp.now() }, { merge: true });
  const despues = ((await auth.getUser(existente.uid)).customClaims ?? {}).nc ?? {};
  console.log(`  ✓ rol quitado (tenía «${teniaEl ?? 'ninguno'}») y sesiones cerradas`);
  console.log(`  Verificación: rol en ${TENANT} = ${despues.t?.[TENANT] ?? 'ninguno'}\n`);
  process.exit(0);
}

// --- dar --------------------------------------------------------------------
let usuario = existente;
let enlace = null;
if (!usuario) {
  usuario = await auth.createUser({
    email: CORREO,
    ...(NOMBRE ? { displayName: NOMBRE } : {}),
    // Aleatoria y descartada en el acto: nadie la conoce, ni quien corre esto.
    // La persona pone la suya con el enlace de más abajo.
    password: randomBytes(32).toString('base64url'),
    emailVerified: false,
  });
  console.log(`  ✓ cuenta creada (${usuario.uid.slice(0, 8)}…)`);
} else {
  console.log(`  ! La cuenta ya existía (${usuario.uid.slice(0, 8)}…): no se toca su contraseña.`);
}

const previo = (usuario.customClaims ?? {}).nc ?? {};
await auth.setCustomUserClaims(usuario.uid, {
  ...(usuario.customClaims ?? {}),
  // Misma forma que `functions/src/claims.ts`: claves de una letra, porque el
  // token tiene un tope de 1000 bytes.
  nc: { ...previo, t: { ...(previo.t ?? {}), [TENANT]: ROL }, v: (previo.v ?? 0) + 1 },
});
await db.doc(`tenants/${TENANT}/miembros/${usuario.uid}`).set({
  correo: CORREO, rol: ROL, estado: 'activo', desde: Timestamp.now(),
  ...(NOMBRE ? { nombre: NOMBRE } : {}),
}, { merge: true });
console.log(`  ✓ rol «${ROL}» y membresía`);

if (!existente) {
  enlace = await auth.generatePasswordResetLink(CORREO);
  const destino = join(homedir(), `enlace-${ROL}-${TENANT}.txt`);
  writeFileSync(destino,
    `Enlace para que ${CORREO} ponga su contrasena en la consola de NovuChat.\n`
    + `Comercio: ${TENANT}. Rol: ${ROL}. Un solo uso, vence en unas horas.\n`
    + `NO lo pegue en ningun chat ni lo reenvie: quien lo tenga fija esa contrasena.\n`
    + `Borre este archivo apenas lo use.\n\n${enlace}\n`, 'utf8');
  chmodSync(destino, 0o600);
  console.log('\n  Enlace para que ponga su contraseña (vence en unas horas), escrito en:');
  console.log(`  ${destino}   (solo para usted; no se muestra acá)\n`);
  console.log('  Al completarlo, Firebase marca el correo como verificado, que es lo');
  console.log('  que las reglas exigen para cualquier rol de comercio.\n');
}

const claim = ((await auth.getUser(usuario.uid)).customClaims ?? {}).nc ?? {};
const miembro = await db.doc(`tenants/${TENANT}/miembros/${usuario.uid}`).get();
console.log(`  Verificación: rol en ${TENANT} = ${claim.t?.[TENANT] ?? 'NO'}`
  + ` · membresía ${miembro.exists ? miembro.get('estado') : 'NO'}\n`);
if (ROL === 'oper') {
  console.log('  Un operador ve las conversaciones y lo operativo del negocio.');
  console.log('  NO ve el estado de cuenta ni los teléfonos de pago: eso es del administrador.\n');
}
