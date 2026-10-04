#!/usr/bin/env node
/**
 * =============================================================================
 * FIJAR EL NÚMERO PÚBLICO DE LA LÍNEA DE UN COMERCIO (para «Volver al chat»)
 * =============================================================================
 *
 * POR QUÉ EXISTE (Q'Taco, 04/10/2026). Al confirmar su pedido en el catálogo
 * web, el cliente vuelve a la conversación de WhatsApp del negocio con
 * `https://wa.me/<número>`. Ese número NO estaba guardado en ningún lado: el
 * comercio solo tiene `waPhoneNumberId` (un identificador de Meta, que no se
 * puede marcar) y `numeroRecepcion` (el de recepción interna, que NO es la
 * línea del asistente y mandaría al cliente al teléfono del personal).
 *
 * Se guarda en `rutasWhatsApp/<phoneNumberId>.numeroPublico`: la ruta ES la
 * línea, y la ficha del catálogo ya sabe por cuál línea entró el cliente, así
 * que un comercio con dos líneas manda a cada cliente a la suya. `rutasWhatsApp`
 * está cerrada a todo navegador: la escribe solo el SDK Admin, es decir, esto.
 *
 * QUÉ HACE
 *   - resuelve el `phoneNumberId` desde `tenants/<id>.waPhoneNumberId`;
 *   - niega si el comercio no existe o no está activo, si no tiene número
 *     asignado, si ese número no tiene ruta, o si la ruta es de OTRO comercio;
 *   - valida el número: SOLO dígitos, 8 a 15, con prefijo de país, sin `+`,
 *     sin espacios y sin cero inicial. Un número local boliviano de 8 dígitos
 *     (empieza en 6 o 7) se rechaza: sin el 591 el enlace llevaría a otro país;
 *     y si empieza por 591 tiene que tener EXACTAMENTE 11 dígitos (591 más los 8
 *     del número): un dígito de más o de menos es un enlace a nadie;
 *   - muestra antes y después (el número público, que el negocio ya publica, y
 *     del `phoneNumberId` solo los últimos cuatro dígitos), sin imprimir ningún
 *     otro dato de la ruta ni del comercio;
 *   - escribe SOLO `numeroPublico` y el sello (`actualizadoPor` con el
 *     correo del operador, `actualizadoEn`) con un `update` dentro de una transacción, y deja una
 *     entrada en `tenants/<id>/auditoria`.
 *
 * SECO POR OMISIÓN: sin `--aplicar` no escribe nada.
 *
 *   node scripts/modulos/catalogo-web/fijar-numero-publico.mjs \
 *     --proyecto <id> --tenant <id> --numero <dígitos con prefijo, sin +> \
 *     --operador <correo de quien lo corre> [--aplicar]
 *
 * `--operador` es obligatorio (la misma validación que `asignar-numero.mjs`): es
 * quien queda como `actualizadoPor` de la ruta y como `uid` de la auditoría.
 *
 * Dos avisos operativos:
 *   - `asignarNumero` (la callable) REEMPLAZA el documento de la ruta y borraría
 *     este campo; `asignar-numero.mjs` escribe con merge y lo conserva. Con un
 *     número nuevo (`--reemplaza`) la ruta es otra: hay que volver a fijarlo.
 *   - Para sacarlo, borre el campo en la ruta con una herramienta de
 *     administración; sin el campo la página simplemente no ofrece el botón.
 */
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const APLICAR = args.includes('--aplicar');
const PROYECTO = (opcion('proyecto') ?? '').trim();
const TENANT = (opcion('tenant') ?? '').trim();
const NUMERO = (opcion('numero') ?? '').trim();
const OPERADOR = (opcion('operador') ?? '').trim().toLowerCase();

const rojo = (t) => console.error(`\x1b[1;31m${t}\x1b[0m`);
const verde = (t) => console.log(`\x1b[1;32m${t}\x1b[0m`);
const gris = (t) => console.log(`\x1b[0;90m${t}\x1b[0m`);
const ult4 = (v) => `…${String(v).slice(-4)}`;

// MISMAS FORMAS QUE EL SERVIDOR (`catalogoWeb.ts`) y el navegador (`saneo.ts`).
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const ID_RUTA = /^[0-9]{6,25}$/;
const NUMERO_PUBLICO = /^[1-9][0-9]{7,14}$/;
// La misma validación que `asignar-numero.mjs`.
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const problemas = [];
if (PROYECTO === '') problemas.push('falta --proyecto');
if (!ID_TENANT.test(TENANT)) problemas.push('--tenant no es un identificador válido');
if (!CORREO.test(OPERADOR)) problemas.push('--operador <correo> es obligatorio: es quien queda en la auditoría');
if (!NUMERO_PUBLICO.test(NUMERO)) {
  problemas.push('--numero tiene que ser solo dígitos, de 8 a 15, con el prefijo del país '
    + '(sin +, sin espacios, sin cero inicial)');
} else if (/^[67][0-9]{7}$/.test(NUMERO)) {
  problemas.push('--numero parece un número local boliviano sin prefijo: falta el código del país '
    + 'delante, o el enlace llevaría a otro número');
} else if (NUMERO.startsWith('591') && NUMERO.length !== 11) {
  problemas.push('--numero empieza por 591 (Bolivia) y tiene que tener exactamente 11 dígitos: '
    + '591 más los 8 del número');
}
if (problemas.length > 0) {
  rojo(`\n  ✗ ${problemas.join('\n  ✗ ')}\n`);
  console.error('  node scripts/modulos/catalogo-web/fijar-numero-publico.mjs --proyecto <id> '
    + '--tenant <id> --numero <dígitos con prefijo, sin +> --operador <correo> [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const NEGADO = Symbol('negado');

let plan;
try {
  plan = await db.runTransaction(async (tx) => {
    const tenant = await tx.get(db.doc(`tenants/${TENANT}`));
    if (!tenant.exists) return { [NEGADO]: `No existe el comercio ${TENANT}.` };
    if (tenant.get('estado') !== 'activo') {
      return { [NEGADO]: `El comercio ${TENANT} no está activo (estado: ${String(tenant.get('estado'))}).` };
    }
    const phoneNumberId = String(tenant.get('waPhoneNumberId') ?? '');
    if (!ID_RUTA.test(phoneNumberId)) {
      return { [NEGADO]: `El comercio ${TENANT} no tiene un número de WhatsApp asignado (waPhoneNumberId).` };
    }
    const refRuta = db.doc(`rutasWhatsApp/${phoneNumberId}`);
    const ruta = await tx.get(refRuta);
    if (!ruta.exists) {
      return { [NEGADO]: `El número ${ult4(phoneNumberId)} no tiene ruta en rutasWhatsApp: no se inventa una.` };
    }
    if (ruta.get('tenantId') !== TENANT) {
      return { [NEGADO]: `La ruta ${ult4(phoneNumberId)} es de otro comercio, no de ${TENANT}.` };
    }
    const antes = ruta.get('numeroPublico');
    const resumen = {
      phoneNumberId,
      antes: typeof antes === 'string' ? antes : '',
      igual: antes === NUMERO,
    };
    if (!APLICAR || resumen.igual) return resumen;

    tx.update(refRuta, {
      numeroPublico: NUMERO,
      actualizadoPor: OPERADOR,
      actualizadoEn: Timestamp.now(),
    });
    tx.create(db.collection(`tenants/${TENANT}/auditoria`).doc(), {
      accion: 'fijar_numero_publico', uid: OPERADOR, origen: 'script', script: 'fijar-numero-publico',
      en: Timestamp.now(), phoneNumberId: ult4(phoneNumberId),
      antes: resumen.antes, despues: NUMERO,
    });
    return { ...resumen, escrito: true };
  });
} catch (e) {
  console.error(`  ✗ ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}

if (plan[NEGADO]) {
  rojo(`\n  ✗ ${plan[NEGADO]}\n`);
  process.exit(1);
}

console.log();
console.log(`  Proyecto : ${PROYECTO}`);
console.log(`  Comercio : ${TENANT}  ·  línea ${ult4(plan.phoneNumberId)}`);
console.log(`  Operador : ${OPERADOR}`);
console.log(`  Antes    : ${plan.antes === '' ? '(sin número público)' : plan.antes}`);
console.log(`  Después  : ${NUMERO}`);
console.log();

if (plan.igual) {
  verde('  ✓ Ya estaba así: no hay nada que cambiar.\n');
  process.exit(0);
}
if (!plan.escrito) {
  gris('  Seco: no se escribió nada. Agregue --aplicar.\n');
  process.exit(0);
}

const releido = (await db.doc(`rutasWhatsApp/${plan.phoneNumberId}`).get()).get('numeroPublico');
if (releido !== NUMERO) { rojo('  ✗ La relectura no coincide. Revíselo a mano.\n'); process.exit(1); }
verde(`  ✓ Número público fijado para ${TENANT}, y anotado en la auditoría.\n`);
