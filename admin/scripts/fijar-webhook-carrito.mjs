#!/usr/bin/env node
/**
 * REGISTRAR A DÓNDE AVISAR CUANDO LLEGA UN CARRITO DEL CATÁLOGO WEB.
 *
 * POR QUÉ EXISTE. `admin/CATALOGO-WEB.md` §5 dice «NovuChat: `fijarWebhookCarrito`
 * con la URL del webhook de n8n». Esa callable existe (`catalogoWeb.ts`), pero
 * **ninguna pantalla de la consola la llama** y solo la puede invocar una sesión
 * iniciada del propietario. O sea: el paso no tenía ningún camino, igual que le
 * pasó al alias de ingesta el 14/09 (ver `asignar-numero.mjs`). Sin este paso el
 * cliente confirma su pedido en la página, el pedido se guarda y se ve en la
 * consola, **y el asistente no le contesta nada**: el síntoma más caro, porque
 * nadie lo nota hasta que el cliente reclama.
 *
 * QUÉ HACE, exactamente lo que hace la callable, con las MISMAS validaciones
 * leídas del código del servidor y no copiadas a mano:
 *   - `phoneNumberId` con la forma que exige `rutaAutenticada` (6 a 25 dígitos);
 *   - la URL tiene que ser `https` PÚBLICA. Se rechaza `http`, una dirección
 *     interna, `localhost` y los rangos privados: por ese destino viaja una
 *     cabecera con el secreto del número, así que mandarlo a un sitio equivocado
 *     es filtrar el secreto;
 *   - la ruta tiene que existir (no se inventa un número que nadie asignó);
 *   - `--quitar` borra el campo, que es como se apaga la derivación sin tocar el
 *     resto de la ruta.
 *
 * POR QUÉ NO TOCA NADA MÁS DE LA RUTA. `asignarNumero` REEMPLAZA el documento;
 * por eso el webhook vive en su propia función y acá se escribe con `update`.
 * Si se reasignara el número, el webhook habría que volver a fijarlo.
 *
 * NO IMPRIME NINGÚN SECRETO. Del número muestra los últimos cuatro dígitos, y
 * **de la URL solo el host y el final de la ruta**. La ruta del webhook es un
 * secreto compartido, igual que `N8N_WEBHOOK_PATH` (`CONFIGURACION.md` §2):
 * quien la conozca puede golpear el disparador, y aunque n8n le conteste 403
 * sin la cabecera, una ruta publicada es una ruta que hay que rotar. Por eso no
 * se escribe entera ni en la pantalla, ni en el historial, ni en la auditoría.
 *
 *   node scripts/fijar-webhook-carrito.mjs --proyecto <id> --listar
 *   node scripts/fijar-webhook-carrito.mjs --proyecto <id> --numero <phone_number_id> \
 *     --url https://<host de n8n>/webhook/<ruta> [--aplicar]
 *   node scripts/fijar-webhook-carrito.mjs --proyecto <id> --numero <phone_number_id> \
 *     --quitar [--aplicar]
 *
 * Seco por defecto: sin `--aplicar` no escribe nada.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const leer = (bandera) => {
  const i = args.indexOf(bandera);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '';
};
const hay = (bandera) => args.includes(bandera);

const PROYECTO = leer('--proyecto');
const NUMERO = leer('--numero');
const URL_DESTINO = leer('--url');
const LISTAR = hay('--listar');
const QUITAR = hay('--quitar');
const APLICAR = hay('--aplicar');

const V = '\x1b[32m'; const A = '\x1b[33m'; const R = '\x1b[31m'; const G = '\x1b[90m'; const F = '\x1b[0m';
const salir = (mensaje) => { console.error(`${R}✗${F} ${mensaje}`); process.exit(1); };

if (!PROYECTO) salir('Falta --proyecto.');
if (!LISTAR && !NUMERO) salir('Falta --numero (o --listar).');
if (!LISTAR && !QUITAR && !URL_DESTINO) salir('Falta --url (o --quitar).');
if (QUITAR && URL_DESTINO) salir('--quitar y --url son excluyentes.');

/**
 * MISMO CRITERIO QUE EL SERVIDOR. `destinoValido` de `catalogoWeb.ts` delega en
 * `urlImagenValida`; acá se reimplementa su regla porque el script no compila
 * TypeScript, y se deja escrita para que se vea qué se rechaza y por qué.
 *
 * El host se compara por partes y nunca por subcadena: `includes('.local')`
 * daría por interna a `milocal.com.bo`, y CodeQL lo rechaza con razón.
 */
const PRIVADAS = [
  /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, /^0\./,
];
function destinoValido(valor) {
  let u;
  try { u = new URL(valor); } catch { return 'no es una URL'; }
  if (u.protocol !== 'https:') return 'tiene que ser https (por ahí viaja el secreto del número)';
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1') return 'es una dirección local';
  const partes = host.split('.');
  const ultima = partes[partes.length - 1] ?? '';
  if (['local', 'internal', 'localdomain', 'home', 'lan'].includes(ultima)) {
    return 'es un dominio interno';
  }
  if (partes.length < 2) return 'no tiene un dominio público';
  if (/^[0-9.]+$/.test(host) && PRIVADAS.some((re) => re.test(host))) {
    return 'es una dirección IP privada';
  }
  return '';
}

initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
const db = getFirestore();
const ocultar = (n) => `…${String(n).slice(-4)}`;

/**
 * La URL, enmascarada entera: ni el host ni la ruta se escriben completos.
 *
 * LA PRIMERA VERSIÓN DE ESTO MOSTRABA EL HOST, y estaba mal. El host de n8n
 * está entre los valores que `verificar-saneo.sh` busca en modo A —y su dominio
 * de DNS dinámico es uno de los patrones del modo B, el que corre en CI—, o sea
 * que el propio repositorio lo trata como algo que no se publica. Un script que
 * lo imprime lo deja en el historial de la terminal y en el registro de quien
 * lo haya corrido. Se descubrió el 22/09/2026 usándolo por primera vez.
 *
 * Queda lo justo para operar: el esquema, el final del host —que distingue una
 * instancia de otra sin nombrarla— y el final de la ruta.
 */
const ocultarUrl = (valor) => {
  if (!valor) return '';
  let u;
  try { u = new URL(valor); } catch { return '(URL ilegible)'; }
  const ruta = u.pathname.replace(/\/+$/, '');
  return `${u.protocol}//…${u.hostname.slice(-6)}/…${ruta.slice(-4)}`;
};

const rutas = await db.collection('rutasWhatsApp').get();

if (LISTAR) {
  console.log(`\n  Rutas de ${PROYECTO}  ${G}(webhook del carrito)${F}\n`);
  for (const r of rutas.docs) {
    const w = r.get('webhookCarrito');
    console.log(`  ${ocultar(r.id).padEnd(8)} ${String(r.get('tenantId')).padEnd(20)}`
      + (w ? `${V}fijado${F}  ${ocultarUrl(w)}` : `${G}no fijado${F}`));
  }
  console.log();
  process.exit(0);
}

if (!/^[0-9]{6,25}$/.test(NUMERO)) salir('El phone_number_id tiene que ser de 6 a 25 dígitos.');

if (!QUITAR) {
  const problema = destinoValido(URL_DESTINO);
  if (problema) salir(`La URL ${problema}.`);
}

const ref = db.doc(`rutasWhatsApp/${NUMERO}`);
const actual = await ref.get();
if (!actual.exists) salir(`El número ${ocultar(NUMERO)} no está asignado a ningún comercio.`);

const tenant = actual.get('tenantId');
const antes = actual.get('webhookCarrito');

console.log(`\n  Proyecto : ${PROYECTO}`);
console.log(`  Número   : ${ocultar(NUMERO)}  →  comercio ${tenant}`);
console.log(`  Estado   : ${actual.get('estado')}`);
console.log(`  Antes    : ${antes ? ocultarUrl(antes) : `${G}(sin webhook)${F}`}`);
console.log(`  Después  : ${QUITAR ? `${G}(sin webhook)${F}` : ocultarUrl(URL_DESTINO)}\n`);

// EL COMERCIO TIENE QUE VENDER. El catálogo web es capacidad de venta y nada
// más (decisión del 08/09): fijarle el webhook a un comercio de agendamiento
// sería dejar puesto un destino que ninguna función va a usar nunca.
const ficha = await db.doc(`tenants/${tenant}`).get();
const flujos = Array.isArray(ficha.get('flujos')) ? ficha.get('flujos') : [ficha.get('vertical')];
if (!flujos.includes('venta')) {
  salir(`El comercio ${tenant} no tiene el flujo «venta» (${flujos.join(', ')}). `
    + 'El catálogo web es una capacidad de venta: no hay carrito que devolver.');
}

if (!APLICAR) {
  console.log(`  ${A}Seco: no se escribió nada. Agregue --aplicar.${F}\n`);
  process.exit(0);
}

await ref.update({ webhookCarrito: QUITAR ? FieldValue.delete() : URL_DESTINO });
await db.collection(`tenants/${tenant}/auditoria`).add({
  accion: QUITAR ? 'quitar_webhook_carrito' : 'fijar_webhook_carrito',
  numero: ocultar(NUMERO),
  // En la auditoría tampoco va la ruta entera: queda quién y cuándo, no el secreto.
  url: QUITAR ? '' : ocultarUrl(URL_DESTINO),
  por: 'fijar-webhook-carrito.mjs',
  en: FieldValue.serverTimestamp(),
});
console.log(`  ${V}✓${F} Listo. El carrito de ${tenant} ya tiene a dónde volver.\n`);
process.exit(0);
