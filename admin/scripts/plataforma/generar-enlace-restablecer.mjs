/**
 * GENERAR UN ENLACE PARA QUE UNA CUENTA PONGA SU CONTRASEÑA, SECO POR OMISIÓN.
 *
 * PARA QUÉ. La vía normal es «Olvidé mi contraseña» en la consola: Firebase manda el correo. Este script es el respaldo
 * cuando una persona de NovuChat prefiere entregar el enlace por otro canal (Rubén, 21/10/2026). No crea cuentas ni
 * cambia nada en los datos: pide el enlace a Firebase Auth y lo deja en `CLIENTES/<CLIENTE>/.enlaces/` (carpeta 700,
 * archivo 600, copia principal, ignorada por git) con `guardarEnlaceDeContrasena`, donde el enlace nace y muere sin
 * existir como variable ni salir por la salida estándar (ver `enlace-privado.mjs`). Lo abre UNA PERSONA, nunca un agente.
 *
 * El archivo lleva el correo completo en su encabezado (es 600); la salida estándar solo lo muestra enmascarado.
 *
 * VIGENCIA. La fija Firebase y no se configura: el enlace vence a la hora de generarse y sirve una sola vez. Al
 * completarlo, el correo queda verificado. La contraseña actual NO cambia hasta que se use.
 *
 *   node scripts/plataforma/generar-enlace-restablecer.mjs --proyecto <id> --tenant rroca-ruben --correo <correo> [--cliente RUBEN_ROCA]
 *   ... --aplicar      # sin esto solo dice si se puede y dónde quedaría
 *
 * Salida: 0 hecho o seco sin problemas; 1 rechazo o error; 2 llamada mal hecha.
 */
import { clienteDeTenant, comprobarDestino, guardarEnlaceDeContrasena, raizDelProyecto } from './enlace-privado.mjs';
import { esExcluido, motivoSiNoSePuede } from './generar-enlace-restablecer-logica.mjs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); const v = i >= 0 ? args[i + 1] : null; return v && !v.startsWith('--') ? v : null; };
const APLICAR = args.includes('--aplicar');
const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const CORREO = (opcion('correo') ?? '').trim().toLowerCase();
const CLIENTE = opcion('cliente') ?? clienteDeTenant(TENANT);
const enmascarar = (c) => c.replace(/^(.).*@(.).*(\.[^.]+)$/, '$1***@$2***$3');

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(TENANT)) problemas.push('--tenant inválido');
if (esExcluido(TENANT)) problemas.push(`${TENANT} no se toca desde este script`);
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(CORREO)) problemas.push('--correo no es un correo');
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/plataforma/generar-enlace-restablecer.mjs --proyecto <id> --tenant <id> --correo <correo> [--cliente <CARPETA>] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const { getAuth } = await import('firebase-admin/auth');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const auth = getAuth();
const fallo = (m) => { console.error(`\n  ✗ ${m}\n`); process.exit(1); };

let u, ficha, miembro;
try {
  u = await auth.getUserByEmail(CORREO).catch((e) => { if (e?.code === 'auth/user-not-found') return null; throw e; });
  ficha = await db.doc(`tenants/${TENANT}`).get();
  miembro = u ? await db.doc(`tenants/${TENANT}/miembros/${u.uid}`).get() : null;
} catch (e) {
  // Sin traza: el mensaje de Firebase suele traer el correo completo.
  fallo(`no se pudo leer la cuenta (${e?.code ?? 'error'})`);
}
const motivo = motivoSiNoSePuede({
  tenant: TENANT,
  ficha: ficha.exists ? ficha.data() : null,
  usuario: u && { deshabilitada: u.disabled, conSegundoFactor: (u.multiFactor?.enrolledFactors ?? []).length > 0,
    proveedores: u.providerData.map((p) => p.providerId), claims: ((u.customClaims ?? {}).nc ?? {}).t ?? {}, propietario: ((u.customClaims ?? {}).nc ?? {}).p === true },
  miembro: miembro?.exists ? miembro.data() : null,
});
if (motivo) fallo(motivo);

const raiz = raizDelProyecto();
const destino = comprobarDestino({ raiz, cliente: CLIENTE, nombre: `restablecer-${TENANT}` });
console.log(`\n  Cuenta   : ${enmascarar(CORREO)} · ${TENANT} · correo verificado: ${u.emailVerified}`);
console.log(`  Destino  : ${destino.legible}${destino.existe ? '' : '  ✗ NO EXISTE la carpeta del cliente (indique --cliente)'}`);
if (!destino.existe) process.exit(1);
if (!APLICAR) { console.log('\n  Seco: no se generó nada. Agregue --aplicar.\n'); process.exit(0); }

const escrito = await guardarEnlaceDeContrasena({ auth, correo: CORREO, raiz, cliente: CLIENTE, nombre: `restablecer-${TENANT}`, encabezado:
  `Enlace para que ${CORREO} ponga su contrasena en la consola de NovuChat.\n`
  + `Comercio: ${TENANT}. Un solo uso, vence a la hora de generarse.\n`
  + 'NO lo pegue en ningun chat: quien lo tenga fija esa contrasena.\n'
  + 'Borre este archivo apenas lo use.' });
console.log(`\n  Enlace escrito en: ${escrito}   (copia principal, permisos 600; no se muestra acá)`);
console.log('  Lo abre UNA PERSONA, nunca un agente, y borra el archivo al usarlo. Vence a la hora.\n');
