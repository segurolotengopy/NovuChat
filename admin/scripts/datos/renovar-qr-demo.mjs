#!/usr/bin/env node
/**
 * =============================================================================
 * RENOVAR EL MEDIA ID DEL QR DE DEMOSTRACIÓN EN LA CONFIGURACIÓN DEL SERVIDOR
 * =============================================================================
 *
 * POR QUÉ EXISTE. El media ID del QR rotulado del demo de venta (Demo B) tiene
 * DOS destinos, y renovar uno solo deja el sistema roto en silencio. El 03/10/2026
 * (ejecución #19676) se renovó el ID en la tabla local y se republicó el flujo,
 * pero el valor que MANDA es el de Firestore (`tenants/{id}/config/venta.mediaIdQr`:
 * `admin/functions/src/ingesta.ts` y `Flujos/src/core/venta/config-del-negocio.js`,
 * «el valor del servidor manda sobre el del flujo»). Meta siguió rechazando el
 * ID viejo: «image.id is not a valid whatsapp business account media attachment
 * ID». Hasta hoy solo `sembrar-demos.mjs` escribía `mediaIdQr`, y su `--aplicar`
 * reescribe además negocio, catálogo, funcionarios y estado de cuenta: demasiado
 * amplio para cambiar un número.
 *
 * PROCEDIMIENTO COMPLETO DE RENOVACIÓN (el ID VENCE A LOS 30 DÍAS y queda LIGADO
 * AL NÚMERO que lo sube: un ID subido con el número de otro demo no sirve):
 *
 *   1. Subir la imagen y obtener el ID nuevo:        scripts/subir-qr.sh
 *   2. Destino 1, tabla local y flujo:
 *        MARCADOR_VALOR=<id> scripts/marcador-local.sh \
 *          --marcador REEMPLAZAR_MEDIA_ID_QR_DEMO --reemplazar
 *      y republicar el flujo con `publicar-flujo.sh`.
 *   3. Destino 2, configuración del servidor (ESTA herramienta):
 *        node scripts/datos/renovar-qr-demo.mjs --tenant <demo> --proyecto <id>            # seco
 *        node scripts/datos/renovar-qr-demo.mjs --tenant <demo> --proyecto <id> --aplicar
 *   4. Repetir el seco: debe decir COINCIDE.
 *
 * QUÉ HACE. Toma el valor de la fila `REEMPLAZAR_MEDIA_ID_QR_DEMO` de la tabla
 * local (el mismo formato de tabla que `marcador-local.sh`: `--archivo` para
 * pruebas, `CONFIG_LOCAL`, o `CONFIGURACION.local.md` de la raíz; OJO:
 * `sembrar-demos.mjs` lee siempre la raíz y no admite ninguna de las dos) y lo escribe en `config/venta`.
 *
 *   - SECO (por defecto): no escribe. Sin `--proyecto` no se conecta y solo
 *     valida la fila local (solo dígitos, 10 a 20). Con `--proyecto` LEE
 *     `config/venta` y dice si `mediaIdQr` está y si COINCIDE o DIFIERE de la
 *     fila local, comparando por sha256.
 *   - `--aplicar` (exige `--proyecto` y `--tenant`): escribe SOLO `config/venta`
 *     con `mergeFields` [mediaIdQr, actualizadoPor, actualizadoEn]. Cualquier
 *     otra clave (por ejemplo `cobroReal`) y cualquier otro documento quedan
 *     intactos. Deja una entrada en `tenants/{id}/auditoria`, sin el valor.
 *
 * CANDADOS.
 *   - Solo los demos de venta que `sembrar-demos.mjs` declara (se descubren
 *     leyendo ese archivo, sin copiar sus ids). Otro tenant: NEGADO.
 *   - Fila vacía, «pendiente» o con forma inválida: se aborta sin escribir.
 *   - NUNCA se imprime el valor local ni el del servidor. Solo veredictos.
 *   - Una fila repetida del marcador se niega (no se toma la última).
 *   - En el servidor, el tenant debe tener `creadoPor: 'sembrar-demos'`.
 *   - Con FIRESTORE_EMULATOR_HOST (seco o aplicar) se rechaza salvo con un proyecto `demo-*`
 *     (el de las pruebas); contra un proyecto real, NEGADO.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { descubrirDemosDeVenta } from './demos-de-venta.mjs';

const RAIZ = new URL('../../..', import.meta.url);
const MARCADOR = 'REEMPLAZAR_MEDIA_ID_QR_DEMO';

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const PROYECTO = opcion('proyecto');
const TENANT = opcion('tenant');
const ARCHIVO = opcion('archivo') ?? process.env.CONFIG_LOCAL
  ?? new URL('CONFIGURACION.local.md', RAIZ).pathname;

const sha = (t) => createHash('sha256').update(t).digest('hex');
const niega = (m) => { console.error(`\nNEGADO: ${m}\n`); process.exit(1); };

// --- Los demos de venta: se descubren en sembrar-demos.mjs -------------------
const fuente = readFileSync(new URL('./sembrar-demos.mjs', import.meta.url), 'utf8');
let DEMOS_VENTA;
try {
  DEMOS_VENTA = descubrirDemosDeVenta(fuente);
} catch (e) {
  niega(e.message);
}

if (!TENANT) niega(`falta --tenant <id>. Demos de venta: ${DEMOS_VENTA.join(', ')}.`);
if (!DEMOS_VENTA.includes(TENANT)) {
  niega(`«${TENANT}» no es un demo de venta de sembrar-demos.mjs. Solo: ${DEMOS_VENTA.join(', ')}.`);
}
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
  niega(`la fila ${MARCADOR} está vacía o pendiente; renueve primero la tabla local.`);
}
if (!/^\d{10,20}$/.test(valorLocal)) {
  niega(`la fila ${MARCADOR} no tiene la forma de un media ID (solo dígitos, 10 a 20).`);
}
console.log(`\nFila local ${MARCADOR}: presente, forma válida.`);

if (!PROYECTO) {
  console.log('Seco sin --proyecto: no se abrió ninguna conexión.\n');
  process.exit(0);
}
// También en el seco: con el emulador heredado, una lectura del emulador se
// rotularía como si fuera la del proyecto real.
const EMULADOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (EMULADOR && !PROYECTO.startsWith('demo-')) {
  niega('hay FIRESTORE_EMULATOR_HOST en el entorno y el proyecto no es de pruebas (demo-*).');
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const ref = db.doc(`tenants/${TENANT}/config/venta`);

const tenant = await db.doc(`tenants/${TENANT}`).get();
if (!tenant.exists) niega(`el tenant ${TENANT} no existe en ${PROYECTO}.`);
// Candado en el servidor: lo creó `sembrar-demos.mjs` (campo `creadoPor`). Un
// tenant con el mismo id pero de otro origen no es un demo. Vale para el seco.
if (tenant.get('creadoPor') !== 'sembrar-demos') {
  niega(`el tenant ${TENANT} no fue creado por sembrar-demos: no es un demo.`);
}

async function veredicto() {
  const v = (await ref.get()).get('mediaIdQr');
  if (typeof v !== 'string' || !v) return 'AUSENTE';
  return sha(v) === sha(valorLocal) ? 'COINCIDE' : 'DIFIERE';
}

const antes = await veredicto();
console.log(`Servidor${EMULADOR ? ' (EMULADOR)' : ''} (${PROYECTO}, tenants/${TENANT}/config/venta): mediaIdQr ${antes} respecto de la fila local.`);

if (!APLICAR) {
  console.log(antes === 'COINCIDE'
    ? '\nSeco: no hay nada que renovar. No se escribió nada.\n'
    : '\nSeco: no se escribió nada. Para renovar, repita con --aplicar.\n');
  process.exit(0);
}

await ref.set({
  mediaIdQr: valorLocal,
  actualizadoPor: 'renovar-qr-demo',
  actualizadoEn: FieldValue.serverTimestamp(),
}, { mergeFields: ['mediaIdQr', 'actualizadoPor', 'actualizadoEn'] });

await db.collection(`tenants/${TENANT}/auditoria`).add({
  accion: 'renovar_qr_demo', en: Timestamp.now(), documento: 'venta', porScript: true,
});

const despues = await veredicto();
if (despues !== 'COINCIDE') niega('la relectura no coincide con la fila local. Revíselo a mano.');
console.log('\n  ✓ mediaIdQr renovado en config/venta (relectura: COINCIDE) y anotado en la auditoría.\n');
