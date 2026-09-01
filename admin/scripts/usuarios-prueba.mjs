#!/usr/bin/env node
/**
 * =============================================================================
 * USUARIOS DE PRUEBA CON SUS ROLES Y CREDENCIALES
 * =============================================================================
 *
 * EL HUECO QUE TAPA. `invitarUsuario` exige que la persona YA HAYA ENTRADO al
 * panel («La persona debe ingresar una vez primero»), y el panel no tiene
 * pantalla de registro: solo de ingreso. Para una cuenta de Google eso funciona
 * —la identidad nace sola al entrar—, pero para un administrador de comercio,
 * que va con correo y contraseña, no hay ningún camino: no puede entrar porque
 * no existe, y no puede existir porque nadie la crea. Hoy es imposible probar
 * el panel con los ojos de un comercio, que es con los que lo va a ver el
 * cliente el 9 de septiembre.
 *
 * Este script crea esas cuentas con el SDK Admin, que es el único que puede.
 *
 * `emailVerified: true` NO es un atajo: las reglas exigen `correoVerificado()`
 * para los roles de comercio, así que sin eso la persona entra y no ve nada
 * —la pantalla de ingreso ya lo avisa: «Verifique su correo antes del primer
 * ingreso». Como estas cuentas son de prueba y su correo no existe, no hay
 * mensaje de verificación que llegue: se marca acá.
 *
 * SOLO CORREOS DE PRUEBA. Se niega a tocar cualquier dirección que no termine
 * en @ejemplo.com o @example.com. Un script que crea usuarios con contraseña
 * conocida no puede apuntarle jamás a la cuenta real de una persona.
 *
 * Uso:
 *   node scripts/usuarios-prueba.mjs                            # seco
 *   node scripts/usuarios-prueba.mjs --proyecto <id> --aplicar
 *   node scripts/usuarios-prueba.mjs --proyecto <id> --borrar   # limpieza
 */
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const BORRAR = args.includes('--borrar');
const iProy = args.indexOf('--proyecto');
const PROYECTO = iProy >= 0 ? args[iProy + 1] : null;

const A = 'demo-agendamiento';
const B = 'demo-venta';

/**
 * Un usuario por ROL Y POR VERTICAL, no uno por rol.
 *
 * Las pantallas cambian según el rubro —el salón configura servicios y agendas,
 * el resto configura catálogo y envíos—, así que un solo administrador no
 * alcanza para ver el panel entero. Y el operador existe porque su menú es el
 * caso que más veces se rompió: ve tres enlaces de once.
 */
const USUARIOS = [
  { correo: 'admin.salon@ejemplo.com',    nombre: 'Rosa Quispe',   tenant: A, rol: 'admin',
    para: 'Administradora del salón: configura servicios, agendas y usuarios.' },
  { correo: 'operador.salon@ejemplo.com', nombre: 'Luis Mamani',   tenant: A, rol: 'oper',
    para: 'Operador del salón: solo conversaciones, uso y reclamos.' },
  { correo: 'admin.resto@ejemplo.com',    nombre: 'Carlos Vargas', tenant: B, rol: 'admin',
    para: 'Administrador del resto: catálogo, envíos y cobro simulado.' },
  { correo: 'operador.resto@ejemplo.com', nombre: 'Ana Flores',    tenant: B, rol: 'oper',
    para: 'Operadora del resto: atiende pedidos.' },
];

const DE_PRUEBA = /@(ejemplo|example)\.com$/i;

/**
 * Contraseña larga y aleatoria, distinta en cada corrida.
 *
 * No se usa una fija y compartida a propósito. Una contraseña escrita en el
 * repositorio es la prohibición 2 de CLAUDE.md, y una «de prueba» memorizada
 * termina, siempre, probada contra algo que no era de prueba. Se imprime una
 * vez y se guarda en el gestor de contraseñas.
 *
 * Mínimo 12 caracteres porque es lo que exige la política del proyecto, que la
 * propia pantalla de ingreso anuncia.
 */
const clave = () => `NC-${randomBytes(9).toString('base64url')}-26`;

console.log('\nUsuarios de prueba\n');
for (const u of USUARIOS) {
  console.log(`  ${u.correo}`);
  console.log(`      ${u.nombre} · ${u.rol === 'admin' ? 'administrador' : 'operador'} de ${u.tenant}`);
  console.log(`      ${u.para}`);
}

const invalidos = USUARIOS.filter((u) => !DE_PRUEBA.test(u.correo));
if (invalidos.length) {
  console.error('\nNEGADO: hay correos que no son de prueba:');
  for (const u of invalidos) console.error(`  ✗ ${u.correo}`);
  console.error('Solo se admiten @ejemplo.com y @example.com.\n');
  process.exit(1);
}

if (!APLICAR && !BORRAR) {
  console.log('\nSeco: no se abrió ninguna conexión.');
  console.log('  node scripts/usuarios-prueba.mjs --proyecto <id> --aplicar\n');
  process.exit(0);
}
if (!PROYECTO) {
  console.error('\nNEGADO: exige --proyecto <id>.\n');
  process.exit(1);
}
if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('\nNEGADO: hay variables de emulador en el entorno.\n');
  process.exit(1);
}

const { initializeApp } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const auth = getAuth();
const db = getFirestore();

console.log(`\nDestino: ${PROYECTO}\n`);

if (BORRAR) {
  for (const u of USUARIOS) {
    const usuario = await auth.getUserByEmail(u.correo).catch(() => null);
    if (!usuario) { console.log(`  − ${u.correo}: no existía`); continue; }
    await db.doc(`tenants/${u.tenant}/miembros/${usuario.uid}`).delete();
    await db.doc(`usuarios/${usuario.uid}`).delete();
    await auth.deleteUser(usuario.uid);
    console.log(`  − ${u.correo}: borrado`);
  }
  console.log();
  process.exit(0);
}

const credenciales = [];
for (const u of USUARIOS) {
  const contrasena = clave();
  const datos = {
    email: u.correo,
    emailVerified: true,     // las reglas lo exigen; ver cabecera
    password: contrasena,
    displayName: u.nombre,
    disabled: false,
  };

  let usuario = await auth.getUserByEmail(u.correo).catch(() => null);
  if (usuario) await auth.updateUser(usuario.uid, datos);
  else usuario = await auth.createUser(datos);
  const uid = usuario.uid;

  // El vínculo rol ↔ proveedor: un rol de comercio va con contraseña y NUNCA
  // con Google. Se comprueba aunque el usuario lo acabemos de crear, porque
  // `updateUser` sobre una cuenta preexistente puede encontrarse otra cosa.
  const proveedores = new Set((await auth.getUser(uid)).providerData.map((p) => p.providerId));
  if (proveedores.has('google.com')) {
    console.error(`  ✗ ${u.correo}: tiene Google. Un rol de comercio no puede tenerlo.`);
    continue;
  }

  // Misma forma de claim que functions/src/claims.ts: claves de una letra por
  // el tope de 1000 bytes, y `v` que sube en cada cambio.
  const actual = (await auth.getUser(uid)).customClaims?.['nc'] ?? { t: {}, v: 0 };
  await auth.setCustomUserClaims(uid, {
    nc: { t: { ...actual.t, [u.tenant]: u.rol }, v: (actual.v ?? 0) + 1 },
  });
  await auth.revokeRefreshTokens(uid);

  await db.doc(`usuarios/${uid}`).set({ nombre: u.nombre, preferencias: {} }, { merge: true });
  await db.doc(`tenants/${u.tenant}/miembros/${uid}`).set({
    correo: u.correo, rol: u.rol, estado: 'activo', desde: Timestamp.now(),
  }, { merge: true });

  credenciales.push({ ...u, contrasena });
  console.log(`  ✓ ${u.correo}  ·  ${u.rol} de ${u.tenant}`);
}

// Relectura: que la escritura no falle no prueba que el permiso quedó puesto.
console.log('\nVerificación por relectura:');
for (const u of USUARIOS) {
  const usuario = await auth.getUserByEmail(u.correo).catch(() => null);
  if (!usuario) { console.log(`  ✗ ${u.correo}: no existe`); continue; }
  const claim = usuario.customClaims?.['nc'] ?? {};
  const miembro = await db.doc(`tenants/${u.tenant}/miembros/${usuario.uid}`).get();
  const ok = claim.t?.[u.tenant] === u.rol && usuario.emailVerified && miembro.exists
    && !usuario.providerData.some((p) => p.providerId === 'google.com');
  console.log(`  ${ok ? '✓' : '✗'} ${u.correo}: rol ${claim.t?.[u.tenant] ?? 'NINGUNO'}`
    + ` · correo ${usuario.emailVerified ? 'verificado' : 'SIN VERIFICAR'}`
    + ` · miembro ${miembro.exists ? 'sí' : 'NO'}`);
}

console.log('\n' + '='.repeat(72));
console.log('CREDENCIALES — se muestran UNA sola vez. Guárdelas en el gestor.');
console.log('='.repeat(72));
for (const c of credenciales) {
  console.log(`\n  ${c.correo}`);
  console.log(`  ${c.contrasena}`);
}
console.log('\n  Entran por la pestaña «Soy un comercio».');
console.log('  Para rehacerlas: --borrar y volver a aplicar (la contraseña cambia).\n');
