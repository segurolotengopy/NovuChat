#!/usr/bin/env node
/**
 * =============================================================================
 * ESCRIBIR EL MEDIA ID DEL QR DE UN COMERCIO REAL EN LA CONFIGURACIÓN DEL SERVIDOR
 * =============================================================================
 *
 * POR QUÉ EXISTE. `renovar-qr-demo.mjs` quedó limitado a los demos de venta por
 * diseño, y ese candado se mantiene. Un comercio REAL con flujo de venta tiene
 * la misma doble residencia del media ID: el valor de Firestore
 * (`tenants/{id}/config/venta.mediaIdQr`) manda sobre el del flujo. Esta
 * herramienta es la contraparte acotada para comercios reales: escribe SOLO ese
 * campo y se niega a tocar un demo.
 *
 * USO.
 *   node scripts/datos/escribir-qr-comercio.mjs --tenant <id> --proyecto <id> \
 *        --marcador REEMPLAZAR_MEDIA_ID_QR_<X> --archivo <tabla local> [--aplicar]
 *
 * El valor sale de la fila `| `MARCADOR` | valor |` de una TABLA LOCAL (mismo
 * formato que `marcador-local.sh`). Se exige `--archivo` o `CONFIG_LOCAL`: no
 * hay lectura por omisión de `CONFIGURACION.local.md`.
 *
 *   - SECO (por defecto): no escribe. Sin `--proyecto` no se conecta y solo
 *     valida la fila. Con `--proyecto` LEE `config/venta` y dice si `mediaIdQr`
 *     está y si COINCIDE o DIFIERE de la fila local (sha256, sin valores).
 *   - `--aplicar` (exige `--proyecto` y `--tenant`): escribe SOLO `config/venta`
 *     con `mergeFields` [mediaIdQr, actualizadoPor, actualizadoEn]; `cobroReal`
 *     y todo lo demás quedan intactos. Deja una entrada en
 *     `tenants/{id}/auditoria`, sin el valor.
 *
 * CANDADOS.
 *   - El marcador empieza por `REEMPLAZAR_MEDIA_ID_QR_` y NO es el de demo.
 *   - Valor: solo dígitos, 10 a 20. Fila repetida, vacía o «pendiente»: aborta.
 *   - `--tenant` con la forma de un id (`/^[a-z0-9][a-z0-9-]{2,59}$/`).
 *   - El marcador lleva el id del tenant: `rroca-ruben` -> `..._RROCA_RUBEN`.
 *   - El tenant debe EXISTIR y `documentoDeCobro(modulosDeFicha(ficha))` (el
 *     registro, como `activar-cobro-real`: manda la lista `modulos` si la hay,
 *     si no los `flujos`) debe ser `venta`.
 *   - El cobro real debe estar ACTIVO (criterio de ingesta.ts: activo === true
 *     con ficha y carga útil). Si no, ingesta copia mediaIdQr al cobro simulado.
 *     Orden operativo: cobro real activo, luego mediaIdQr.
 *   - Un tenant demo (`creadoPor: 'sembrar-demos'` o id de demo de venta):
 *     NEGADO; para esos está `renovar-qr-demo.mjs`.
 *   - Con FIRESTORE_EMULATOR_HOST solo un proyecto `demo-*`.
 *   - NUNCA se imprime el valor local ni el del servidor.
 *
 * El ID vence a los 30 días y queda ligado al número que lo subió.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { descubrirDemosDeVenta } from './demos-de-venta.mjs';

const PREFIJO = 'REEMPLAZAR_MEDIA_ID_QR_';
const MARCADOR_DEMO = 'REEMPLAZAR_MEDIA_ID_QR_DEMO';

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const PROYECTO = opcion('proyecto');
const TENANT = opcion('tenant');
const MARCADOR = opcion('marcador');
const ARCHIVO = opcion('archivo') ?? process.env.CONFIG_LOCAL ?? null;

const sha = (t) => createHash('sha256').update(t).digest('hex');
const niega = (m) => { console.error(`\nNEGADO: ${m}\n`); process.exit(1); };

if (!TENANT) niega('falta --tenant <id>.');
// Antes de usarlo en cualquier ruta de Firestore.
if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(TENANT)) {
  niega('--tenant no tiene la forma de un id de tenant (minúsculas, dígitos y guion; 3 a 60).');
}
if (!MARCADOR) niega(`falta --marcador ${PREFIJO}<X>.`);
if (!/^REEMPLAZAR_MEDIA_ID_QR_[A-Z0-9_]+$/.test(MARCADOR)) {
  niega(`el marcador debe tener la forma ${PREFIJO}<X> (mayúsculas, dígitos y guion bajo).`);
}
if (MARCADOR === MARCADOR_DEMO) {
  niega('ese es el marcador de los demos; para ellos está renovar-qr-demo.mjs.');
}
// El marcador queda ligado al tenant: sufijo = id en mayúsculas, con «_» por «-».
const SUFIJO_ESPERADO = TENANT.toUpperCase().replace(/-/g, '_');
if (MARCADOR !== `${PREFIJO}${SUFIJO_ESPERADO}`) {
  niega(`el marcador no corresponde al tenant ${TENANT} (se esperaba ${PREFIJO}${SUFIJO_ESPERADO}).`);
}
if (!ARCHIVO) niega('falta --archivo <tabla local> (o CONFIG_LOCAL); no hay lectura por omisión.');
if (APLICAR && !PROYECTO) niega('--aplicar exige --proyecto <id>.');

// --- La fila local: solo esa fila, nunca su valor en pantalla -----------------
let valorLocal = '';
let duplicada = false;
try {
  const texto = readFileSync(ARCHIVO, 'utf8');
  const filas = [...texto.matchAll(/^\|\s*`(REEMPLAZAR_[^`]*)`\s*\|([^|]*)\|/gm)]
    .filter((m) => m[1] === MARCADOR);
  if (filas.length > 1) duplicada = true;
  else if (filas.length === 1) valorLocal = filas[0][2].trim().replace(/^`|`$/g, '').trim();
} catch {
  niega('no se pudo leer el archivo de valores locales.');
}
if (duplicada) niega(`la fila ${MARCADOR} está repetida; corrija la tabla local.`);
if (!valorLocal || /pendiente/i.test(valorLocal)) {
  niega(`la fila ${MARCADOR} está vacía o pendiente.`);
}
if (!/^\d{10,20}$/.test(valorLocal)) {
  niega(`la fila ${MARCADOR} no tiene la forma de un media ID (solo dígitos, 10 a 20).`);
}
console.log(`\nFila local ${MARCADOR}: presente, forma válida.`);

if (!PROYECTO) {
  console.log('Seco sin --proyecto: no se abrió ninguna conexión.\n');
  process.exit(0);
}
const EMULADOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (EMULADOR && !PROYECTO.startsWith('demo-')) {
  niega('hay FIRESTORE_EMULATOR_HOST en el entorno y el proyecto no es de pruebas (demo-*).');
}

// Los demos de venta se descubren en sembrar-demos.mjs (sin copiar sus ids).
let DEMOS_VENTA;
try {
  DEMOS_VENTA = descubrirDemosDeVenta(readFileSync(new URL('./sembrar-demos.mjs', import.meta.url), 'utf8'));
} catch (e) {
  niega(e.message);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
const { documentoDeCobro, modulosDeFicha } = await import('../../functions/src/registro.ts');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const ref = db.doc(`tenants/${TENANT}/config/venta`);

const tenant = await db.doc(`tenants/${TENANT}`).get();
if (!tenant.exists) niega(`el tenant ${TENANT} no existe en ${PROYECTO}.`);
if (tenant.get('creadoPor') === 'sembrar-demos' || DEMOS_VENTA.includes(TENANT)) {
  niega(`el tenant ${TENANT} es un demo; para los demos está renovar-qr-demo.mjs.`);
}
const docVenta = await ref.get();
// Como `activar-cobro-real`: cobra por config/venta el comercio cuyos MÓDULOS lo dicen (con la lista `modulos,
// manda ella; sin lista, los de sus flujos). Misma función del registro que decide el servidor.
if (documentoDeCobro(modulosDeFicha(tenant.data())) !== 'venta') {
  niega(`el tenant ${TENANT} no tiene la venta habilitada (sus módulos no incluyen cobros y pedidos, es decir, venta).`);
}
// Mismo criterio que ingesta.ts (cobroRealActivo): encendido Y con ficha y carga útil.
// Con el cobro real apagado, ingesta copia mediaIdQr a cobroSimulado.mediaIdQr y
// el QR REAL saldría con los rótulos de simulado.
const cobroReal = docVenta.get('cobroReal');
const cobroRealActivo = cobroReal?.activo === true
  && String(cobroReal?.ficha ?? '') !== ''
  && String(cobroReal?.cargaUtil ?? '') !== '';
if (!cobroRealActivo) {
  niega(`el cobro real de ${TENANT} no está activo (config/venta.cobroReal ausente, apagado o incompleto): `
    + 'con el cobro real apagado el QR real saldría como QR de demostración. Active primero el cobro real.');
}
const negocio = await db.doc(`tenants/${TENANT}/config/negocio`).get();
const nombreNegocio = negocio.get('nombreNegocio');
console.log(`Proyecto: ${PROYECTO}${EMULADOR ? ' (EMULADOR)' : ''}. Tenant: ${TENANT}. Negocio: ${typeof nombreNegocio === 'string' && nombreNegocio ? nombreNegocio : '(sin nombreNegocio)'}. Confirme que es el comercio correcto.`);

function veredicto(doc) {
  const v = doc.get('mediaIdQr');
  if (typeof v !== 'string' || !v) return 'AUSENTE';
  return sha(v) === sha(valorLocal) ? 'COINCIDE' : 'DIFIERE';
}

const antes = veredicto(docVenta);
console.log(`Servidor${EMULADOR ? ' (EMULADOR)' : ''} (${PROYECTO}, tenants/${TENANT}/config/venta): mediaIdQr ${antes} respecto de la fila local.`);

if (!APLICAR) {
  console.log(antes === 'COINCIDE'
    ? '\nSeco: no hay nada que escribir. No se escribió nada.\n'
    : '\nSeco: no se escribió nada. Para escribir, repita con --aplicar.\n');
  process.exit(0);
}

await ref.set({
  mediaIdQr: valorLocal,
  actualizadoPor: 'escribir-qr-comercio',
  actualizadoEn: FieldValue.serverTimestamp(),
}, { mergeFields: ['mediaIdQr', 'actualizadoPor', 'actualizadoEn'] });

await db.collection(`tenants/${TENANT}/auditoria`).add({
  accion: 'escribir_qr_comercio', en: Timestamp.now(), documento: 'venta', porScript: true,
  marcador: MARCADOR, antes,
});

if (veredicto(await ref.get()) !== 'COINCIDE') niega('la relectura no coincide con la fila local. Revíselo a mano.');
console.log('\n  ✓ mediaIdQr escrito en config/venta (relectura: COINCIDE) y anotado en la auditoría.\n');
