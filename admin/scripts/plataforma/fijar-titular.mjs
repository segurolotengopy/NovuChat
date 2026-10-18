#!/usr/bin/env node
/**
 * FIJAR (O QUITAR) EL TITULAR DE LA CUENTA DE UN COMERCIO, EN SECO POR DEFECTO.
 *
 * POR QUÉ EXISTE. Decisión de Andres (17/10/2026): un administrador del comercio no puede
 * quitar al titular de la cuenta; solo NovuChat lo cambia, y este es el camino. «Titular de
 * la cuenta» no es «titularidad» (esa es del número de WhatsApp). Se guarda en la ficha
 * `tenants/{t}` (`titularCuentaUid`, `titularCuentaEn`, `titularCuentaPor`), que solo escribe
 * el SDK Admin. Las dos altas (`alta-comercio.mjs` y `altaTenant`) lo fijan al crear la cuenta;
 * este script es para los comercios que ya existían y para cambiarlo después.
 *
 * REGLAS (la lógica está en `titular-cuenta.mjs`, con sus pruebas):
 *   - el destino tiene que ser miembro ACTIVO con rol admin en la ficha Y con claim admin en
 *     Auth: se rechaza un operador, un no miembro y una membresía en pendiente_verificacion o baja;
 *   - un `update` de los tres campos y la auditoría `fijar_titular` (anterior y nuevo) van en la
 *     MISMA transacción, y se relee;
 *   - `--quitar` deja la cuenta sin titular (auditado);
 *   - sin `--tenant` solo LISTA los administradores activos, de cada comercio, sin escribir.
 *
 * «SIN TITULAR» ES UN ESTADO VÁLIDO: los comercios anteriores a este cambio y los sembrados de
 * emulador y de demos no lo fijan, y la consola lo tolera. `titularCuentaUid: null` (el
 * resultado de `--quitar`) significa lo mismo que el campo ausente.
 *
 * Un comercio con clientes en producción solo se nombra con el «sí» de Andres, por acción.
 * `--operador <correo>` es obligatorio: es quien queda en la auditoría.
 *
 *   node scripts/plataforma/fijar-titular.mjs --proyecto <id> --operador <correo>
 *   node scripts/plataforma/fijar-titular.mjs --proyecto <id> --operador <correo> --tenant <id> --uid <uid> [--aplicar]
 *   node scripts/plataforma/fijar-titular.mjs --proyecto <id> --operador <correo> --tenant <id> --quitar [--aplicar]
 *
 * Salida: 0 si hizo (o si el seco terminó bien), 1 si no pudo, 2 si la llamada está mal.
 */
import { fijarTitular, adminsActivos } from './titular-cuenta.mjs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const bandera = (n) => args.includes(`--${n}`);
const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const UID = opcion('uid');
const QUITAR = bandera('quitar');
const APLICAR = bandera('aplicar');
const OPERADOR = (opcion('operador') ?? '').trim().toLowerCase();

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(OPERADOR)) problemas.push('--operador <correo> es obligatorio: es quien queda en la auditoría');
if (TENANT && !/^[a-z0-9][a-z0-9-]{2,59}$/.test(TENANT)) problemas.push('--tenant inválido');
if (TENANT && QUITAR && UID) problemas.push('--quitar no lleva --uid');
if (TENANT && !QUITAR && !UID) problemas.push('falta --uid (o --quitar)');
if (!TENANT && (QUITAR || UID || APLICAR)) problemas.push('--uid, --quitar y --aplicar necesitan --tenant');
if (UID && !/^[A-Za-z0-9]{6,128}$/.test(UID)) problemas.push('--uid inválido');
if (problemas.length) {
  console.error(`\n  ✗ ${problemas.join('\n  ✗ ')}\n`);
  console.error('  Uso: fijar-titular.mjs --proyecto <id> --operador <correo> [--tenant <id> (--uid <uid> | --quitar)] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const { getAuth } = await import('firebase-admin/auth');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const auth = getAuth();
const corto = (u) => (u ? `${String(u).slice(0, 8)}…` : 'ninguno');

console.log(`\n  Operador : ${OPERADOR}`);
console.log(`  Modo     : ${APLICAR ? 'APLICAR' : 'seco (no escribe)'}\n`);

if (!TENANT) {
  const fichas = await db.collection('tenants').get();
  for (const f of fichas.docs) {
    const admins = await adminsActivos({ db, auth, tenant: f.id });
    console.log(`  ${f.id} · titular ${corto(f.get('titularCuentaUid'))} · administradores activos: `
      + (admins.length ? admins.map((a) => `${corto(a.uid)}${a.claimAdmin ? '' : ' (sin claim admin)'}`).join(', ') : 'ninguno'));
  }
  console.log('\n  Solo se listó. Nada se escribió.\n');
  process.exit(0);
}

const r = await fijarTitular({ db, auth, tenant: TENANT, uid: QUITAR ? null : UID, operador: OPERADOR, aplicar: APLICAR })
  .catch((e) => ({ ok: false, motivo: e instanceof Error ? e.message : String(e) }));
if (!r.ok) {
  console.error(`  ✗ ${r.motivo}. No se escribió nada.\n`);
  process.exit(1);
}
console.log(`  Comercio : ${TENANT}`);
console.log(`  Titular  : ${corto(r.anterior)} → ${corto(r.nuevo)}`);
console.log(r.aplicado ? '  ✓ escrito y releído (ficha + auditoría fijar_titular)\n' : '  Seco: no se escribió nada. Agrega --aplicar.\n');
