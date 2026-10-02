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
 * se genera un enlace de restablecimiento para que la persona ponga la suya, que
 * NO se imprime: se escribe en `CLIENTES/<CLIENTE>/.enlaces/enlace-admin-<tenant>.txt`
 * de la copia principal, con permisos 600 (`plataforma/enlace-privado.mjs` dice por qué
 * ahí y no en `~/`). Es la diferencia entre «te mando tu contraseña por WhatsApp»
 * y un alta seria.
 *
 * Y RESUELVE ADEMÁS EL CORREO VERIFICADO, que las reglas exigen para cualquier
 * rol de comercio: completar un restablecimiento de contraseña marca el correo
 * como verificado, porque la persona probó que tiene acceso a esa casilla. Por
 * eso el alta NO pone `emailVerified: true` a mano como hace el script de
 * pruebas: acá el correo se verifica de verdad.
 *
 *   node scripts/plataforma/alta-comercio.mjs --proyecto <id> \
 *     --tenant salon-rosa --nombre "Salón Rosa" --flujos agendamiento \
 *     --admin ana@ejemplo.com --nombre-admin "Ana Quispe" [--cliente SALON_ROSA]
 *
 * `--cliente` es la carpeta de `CLIENTES/`; por defecto, el tenant en mayúsculas
 * con `_` por `-`. Tiene que existir: la crea la etapa «preparar» del alta.
 *
 * Sin `--aplicar` no escribe nada: dice qué haría.
 */
import { randomBytes } from 'node:crypto';
import {
  ID_CLIENTE, clienteDeTenant, comprobarDestino, guardarEnlaceDeContrasena, raizDelProyecto,
} from './enlace-privado.mjs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');

const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const NOMBRE = opcion('nombre');
const ADMIN = opcion('admin');
const NOMBRE_ADMIN = opcion('nombre-admin') ?? '';
const FLUJOS = (opcion('flujos') ?? 'agendamiento').split(',').map((f) => f.trim()).filter(Boolean);
const CLIENTE = opcion('cliente') ?? clienteDeTenant(TENANT);

const FLUJOS_VALIDOS = new Set(['agendamiento', 'venta', 'onboarding']);
// Mismo formato que `ID_TENANT` en functions/src/index.ts.
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!ID_TENANT.test(TENANT)) problemas.push('--tenant inválido (minúsculas, guiones, 3 a 60)');
if (!NOMBRE) problemas.push('falta --nombre');
if (!ADMIN || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ADMIN)) problemas.push('--admin no es un correo');
for (const f of FLUJOS) if (!FLUJOS_VALIDOS.has(f)) problemas.push(`flujo desconocido: ${f}`);
if (!ID_CLIENTE.test(CLIENTE)) problemas.push('--cliente inválido (la carpeta de CLIENTES/: mayúsculas, dígitos y _)');
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/plataforma/alta-comercio.mjs --proyecto <id> --tenant <id> --nombre "<nombre>" \\');
  console.error('      --flujos agendamiento[,venta] --admin <correo> [--nombre-admin "<nombre>"] [--cliente <CARPETA>] [--aplicar]\n');
  process.exit(2);
}

// DÓNDE IRÁ EL ENLACE, comprobado ANTES de abrir Firebase: si la carpeta del
// cliente no existe, el alta se corta acá, y no después de crear la cuenta,
// cuando ya no habría dónde dejar el enlace.
const RAIZ = raizDelProyecto();
const ENLACE = { raiz: RAIZ, cliente: CLIENTE, nombre: `enlace-admin-${TENANT}` };
const destino = comprobarDestino(ENLACE);
if (!destino.existe) {
  console.error(`\n  ✗ No existe CLIENTES/${CLIENTE}/ en la copia principal, y ahí va el enlace de contraseña.`);
  console.error('    Créela con la etapa «preparar» del alta, o indique la carpeta con --cliente.\n');
  process.exit(1);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const { getAuth } = await import('firebase-admin/auth');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const auth = getAuth();

// Mismo mapa que `documentoDeVertical` en functions/src/core/prompt/prompt.ts.
const DOCUMENTO = { agendamiento: 'agendamiento', venta: 'venta', onboarding: 'onboarding' };

console.log(`\n  Negocio    : ${TENANT} · ${NOMBRE}`);
console.log(`  Flujos     : ${FLUJOS.join(', ')}`);
console.log(`  Admin      : ${ADMIN}${NOMBRE_ADMIN ? ` (${NOMBRE_ADMIN})` : ''}`);
console.log(`  Proyecto   : ${PROYECTO}`);
console.log(`  Enlace     : ${destino.legible} (copia principal)\n`);

// UN IDENTIFICADOR NO SE REUTILIZA NUNCA, ni siquiera uno dado de baja: un claim
// viejo que todavía diga {"salon-x": "admin"} le daría al dueño anterior acceso
// al negocio nuevo. Es la misma regla que aplica `altaTenant`.
if ((await db.doc(`tenants/${TENANT}`).get()).exists) {
  console.error(`  ✗ El identificador «${TENANT}» ya se usó. Elige otro.\n`);
  process.exit(1);
}

const yaExiste = await auth.getUserByEmail(ADMIN).catch(() => null);
if (yaExiste) {
  console.log(`  ! Ya hay una cuenta con ese correo (${yaExiste.uid.slice(0, 8)}…).`);
  console.log('    Se le dará el rol en este negocio, sin tocar su contraseña.\n');
}

if (!APLICAR) {
  console.log('  Seco: no se escribió nada. Agrega --aplicar.\n');
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
// EL PLAN INICIAL SALE DE `functions/src/central/cuenta/planes.ts` (`cuentaInicial`): Impulso,
// con su copia de límites y la versión del catálogo, lo mismo que `altaTenant`.
// Antes se escribía `plan: 'basico'`, que no es un plan del catálogo. Si el
// comercio contrató otro plan, se asigna después con `asignar-plan.mjs`.
const { cuentaInicial } = await import('../../functions/src/central/cuenta/planes.ts');
const cuenta = cuentaInicial();
const sello = { creadoEn: Timestamp.now(), creadoPor: 'alta-comercio' };
const lote = db.batch();
lote.create(db.doc(`tenants/${TENANT}`), {
  nombre: NOMBRE, estado: 'activo', plan: cuenta.plan,
  vertical: FLUJOS[0], flujos: FLUJOS,
  waPhoneNumberId: null, waWabaId: null, ...sello,
});
lote.create(db.doc(`tenants/${TENANT}/cuenta/estado`), {
  ...cuenta, actualizadoEn: Timestamp.now(),
});
// EL CONTADOR DEL CATÁLOGO NACE EN CERO. Sin él, las reglas no dejan dar de
// alta ni de baja un producto (no pueden saber cuántos hay). Exactamente estos
// tres campos: es lo único que la regla del contador acepta después.
lote.create(db.doc(`tenants/${TENANT}/contadores/catalogo`), {
  items: 0, ultimoItem: '', actualizadoEn: Timestamp.now(),
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
// Misma forma de claim que functions/src/core/seguridad/claims.ts: claves de una letra, porque
// el token tiene un tope de 1000 bytes.
const actual = (usuario.customClaims ?? {}).nc ?? {};
await auth.setCustomUserClaims(usuario.uid, {
  ...(usuario.customClaims ?? {}),
  nc: { ...actual, t: { ...(actual.t ?? {}), [TENANT]: 'admin' }, v: (actual.v ?? 0) + 1 },
});
console.log('  ✓ rol de administrador');

// --- 4. el enlace -----------------------------------------------------------
//
// EL ENLACE NO SE IMPRIME, Y ESO NO ES PRUDENCIA DE MÁS. Quien tenga el
// `oobCode` de este enlace FIJA la contraseña de la cuenta administradora del
// comercio: es, por unas horas, la credencial misma. El runbook ya decía «no se
// pega en ningún chat», pero el script lo escribía en su salida estándar, así
// que bastaba con que lo corriera un agente —o con que alguien pegara la salida
// para pedir ayuda— para publicarlo. Pasó el 15/09/2026 en el alta de Clínica
// Platinum: el enlace quedó a la vista en una conversación, y hubo que rotar la
// contraseña para invalidarlo.
//
// Hasta el 28/09/2026 iba a `~/enlace-admin-<tenant>.txt`, y quedaban archivos
// olvidados en el directorio personal. Ahora va a `CLIENTES/<CLIENTE>/.enlaces/`
// de la copia principal, ignorada por git, con permisos 600: el porqué entero
// está en `plataforma/enlace-privado.mjs`. La salida dice dónde quedó, nunca qué
// dice: el enlace lo pide y lo escribe el módulo, y acá no existe ni como variable.
const escrito = await guardarEnlaceDeContrasena({ auth, correo: ADMIN, ...ENLACE, encabezado:
  `Enlace para que ${ADMIN} ponga su contrasena en la consola de NovuChat.\n`
  + `Comercio: ${TENANT}. Un solo uso, vence en unas horas.\n`
  + `NO lo pegue en ningun chat ni lo reenvie: quien lo tenga fija esa contrasena.\n`
  + 'Borre este archivo apenas lo use.' });
console.log('\n  Enlace para que ponga su contraseña (vence en unas horas), escrito en:');
console.log(`  ${escrito}   (copia principal, permisos 600; no se muestra acá)`);
console.log('  Lo abre UNA PERSONA, nunca un agente, y borra el archivo al usarlo.\n');
console.log('  Al completarlo, Firebase marca el correo como verificado, que es lo');
console.log('  que las reglas exigen para cualquier rol de comercio.\n');

// --- verificación por relectura ---------------------------------------------
const ficha = await db.doc(`tenants/${TENANT}`).get();
const claim = ((await auth.getUser(usuario.uid)).customClaims ?? {}).nc ?? {};
console.log(`  Verificación: ficha ${ficha.exists ? 'sí' : 'NO'}`
  + ` · flujos ${JSON.stringify(ficha.get('flujos'))}`
  + ` · rol ${claim.t?.[TENANT] ?? 'NO'}\n`);
console.log(`  Plan       : ${cuenta.plan} (${cuenta.limites.productos} productos,`
  + ` ${cuenta.limites.conversaciones} conversaciones) · contador del catálogo en 0\n`);
console.log('  SIGUE (docs/alta-cliente/RUNBOOK.md, etapa 4): si contrató otro plan,');
console.log('  `node scripts/plataforma/asignar-plan.mjs --tenant ... --plan <plan>`; después, su número');
console.log('  y su alias de ingesta con `node scripts/plataforma/asignar-numero.mjs --listar` y');
console.log('  `--tenant ... --numero ... --waba ... --flujo ... --alias clienteNN`.\n');
