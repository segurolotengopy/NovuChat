#!/usr/bin/env node
/**
 * =============================================================================
 * ALTA Y BAJA DE SUPERADMINISTRADORES DE NOVUCHAT
 * =============================================================================
 *
 * El rol más poderoso del sistema. No se otorga desde el panel a propósito:
 * quien puede darlo puede dárselo, y eso convierte cualquier sesión de
 * superadministrador comprometida en una toma permanente de la plataforma. Se
 * otorga desde acá, con el SDK Admin, que exige credenciales de la máquina.
 *
 * NO PUEDE CREAR LA CUENTA, Y ES A PROPÓSITO. El rol exige proveedor de Google
 * (`claims.ts`, vínculo rol ↔ proveedor), y una identidad de Google no se crea
 * desde el servidor: nace cuando la persona entra por primera vez. Crear la
 * cuenta acá solo sería posible con correo y contraseña, y esa identidad sería
 * después RECHAZADA por el mismo control. Así que el orden es siempre:
 *
 *   1. la persona entra al panel con «Ingresar con Google»;
 *   2. queda dentro, sin negocio asociado y sin permisos — es lo esperado;
 *   3. recién entonces este script la marca como superadministradora;
 *   4. sale y vuelve a entrar, para que el token traiga el permiso nuevo.
 *
 * Uso:
 *   node scripts/superadmin.mjs --proyecto <id> correo@dominio [otro@dominio]
 *   node scripts/superadmin.mjs --proyecto <id> --quitar correo@dominio
 *   node scripts/superadmin.mjs --proyecto <id> --listar
 */
const args = process.argv.slice(2);
const QUITAR = args.includes('--quitar');
const LISTAR = args.includes('--listar');
const iProy = args.indexOf('--proyecto');
const PROYECTO = iProy >= 0 ? args[iProy + 1] : null;
const correos = args.filter((a, i) => !a.startsWith('--') && i !== iProy + 1);

if (!PROYECTO) {
  console.error('\nFalta --proyecto <id>. El SDK Admin se salta las reglas: el destino se nombra a mano.\n');
  process.exit(1);
}
if (!LISTAR && correos.length === 0) {
  console.error('\nNo se indicó ningún correo.\n');
  process.exit(1);
}
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('\nHay variables de emulador en el entorno y esto opera sobre cuentas reales.');
  console.error('Límpielas antes de correrlo.\n');
  process.exit(1);
}

const { initializeApp } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
initializeApp({ projectId: PROYECTO });
const auth = getAuth();

if (LISTAR) {
  const r = await auth.listUsers(1000);
  const jefes = r.users.filter((u) => u.customClaims?.['nc']?.p === true);
  console.log(`\nSuperadministradores en ${PROYECTO}: ${jefes.length}\n`);
  for (const u of jefes) {
    console.log(`  ${u.email}  ·  ${u.providerData.map((p) => p.providerId).join(',')}`);
  }
  console.log();
  process.exit(0);
}

// El mismo vínculo rol ↔ proveedor que aplica `functions/src/claims.ts`. Se
// repite acá a propósito: este script no pasa por las funciones desplegadas, y
// un control que solo existe en el camino que hoy se usa no es un control.
const GOOGLE = 'google.com';
const PASSWORD = 'password';

let fallos = 0;
for (const correo of correos) {
  let usuario;
  try {
    usuario = await auth.getUserByEmail(correo);
  } catch {
    console.error(`\n✗ ${correo}: no existe todavía en Authentication.`);
    console.error('  Tiene que entrar UNA VEZ al panel con «Ingresar con Google».');
    console.error('  Va a ver «Su cuenta todavía no está asociada a ningún negocio»:');
    console.error('  eso es lo correcto. Después vuelva a correr esto.');
    fallos++;
    continue;
  }

  // Set y no arreglo, igual que `proveedoresDe()` en functions/src/claims.ts.
  // Dos razones. La primera es que este control existe para ser el ESPEJO de
  // aquel, y dos espejos que se escriben distinto se separan con el tiempo.
  //
  // La segunda la aporto CodeQL: con `.includes()` sobre un arreglo marcaba
  // "Incomplete URL substring sanitization", porque 'google.com' parece un
  // dominio y `.includes` parece una busqueda de subcadena. Era falso --
  // `Array.prototype.includes` compara elementos exactos, no subcadenas-- pero
  // el codigo se prestaba a leerse mal, y no solo por una herramienta. `has()`
  // sobre un Set no admite esa lectura.
  const proveedores = new Set(usuario.providerData.map((p) => p.providerId));
  if (!QUITAR && !proveedores.has(GOOGLE)) {
    console.error(`\n✗ ${correo}: no entró con Google (tiene: ${[...proveedores].join(',') || 'ninguno'}).`);
    console.error('  El superadministrador exige Google: el segundo factor lo administra Google,');
    console.error('  así que no hay contraseña que adivinar ni que robar.');
    fallos++;
    continue;
  }
  if (!QUITAR && proveedores.has(PASSWORD)) {
    console.error(`\n✗ ${correo}: tiene también contraseña. Una identidad, un proveedor.`);
    fallos++;
    continue;
  }

  const actual = usuario.customClaims?.['nc'] ?? { t: {}, v: 0 };
  const nuevo = QUITAR
    ? { t: actual.t ?? {}, v: (actual.v ?? 0) + 1 }
    : { ...actual, p: true, v: (actual.v ?? 0) + 1 };

  await auth.setCustomUserClaims(usuario.uid, { nc: nuevo });
  // Sin esto el token viejo sigue valiendo hasta una hora, con los permisos de
  // antes. Al quitar el rol eso sería un agujero; al darlo, una confusión.
  await auth.revokeRefreshTokens(usuario.uid);
  console.log(`  ${QUITAR ? '−' : '✓'} ${correo}  ·  ${QUITAR ? 'ya no es' : 'es'} superadministrador`);
}

console.log(fallos
  ? `\n${fallos} cuenta(s) sin procesar. Las demás quedaron aplicadas.\n`
  : '\nListo. Cada persona tiene que SALIR y volver a ENTRAR para que su token traiga el permiso.\n');
process.exit(fallos ? 1 : 0);
