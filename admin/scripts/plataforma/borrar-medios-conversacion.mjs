/**
 * BORRAR LOS MEDIOS DE UNA CONVERSACIÓN (pedido del titular de los datos). Seco por omisión.
 *
 *   node scripts/plataforma/borrar-medios-conversacion.mjs --proyecto <id> --tenant <id> --conversacion wa_<tel> \
 *        [--motivo "texto corto"] [--respaldo-en <carpeta fuera del repositorio>] [--bucket <nombre>] [--aplicar]
 *
 * Un comercio y una conversación por ejecución. Con --aplicar exige --motivo y --respaldo-en. La lógica (y sus
 * garantías) está en `borrar-medios-conversacion-logica.mjs`. Salida: 0 hecho o seco; 1 rechazo/error; 2 mal llamado.
 */
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ejecutar, validarEntrada } from './borrar-medios-conversacion-logica.mjs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const CONVERSACION = opcion('conversacion') ?? '';
const problemas = validarEntrada({ tenant: TENANT, conversacion: CONVERSACION });
if (!PROYECTO) problemas.push('falta --proyecto');
const RESPALDO = opcion('respaldo-en') ? resolve(opcion('respaldo-en')) : null;
const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
if (RESPALDO) { const r = relative(REPO, RESPALDO); if (r === '' || (!r.startsWith('..') && !isAbsolute(r))) problemas.push('--respaldo-en debe estar fuera del repositorio'); }
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/plataforma/borrar-medios-conversacion.mjs --proyecto <id> --tenant <id> --conversacion wa_<tel> [--motivo "..."] [--respaldo-en <carpeta>] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const { getStorage } = await import('firebase-admin/storage');
const bucketNombre = opcion('bucket') ?? `${PROYECTO}.firebasestorage.app`;
initializeApp({ projectId: PROYECTO, storageBucket: bucketNombre });
const bucket = getStorage().bucket();
const almacen = {
  existe: async (ruta) => (await bucket.file(ruta).exists())[0],
  borrar: async (ruta) => { const [ex] = await bucket.file(ruta).exists(); if (ex) await bucket.file(ruta).delete(); return ex; },
};

try {
  const r = await ejecutar({
    db: getFirestore(), almacen, tenant: TENANT, conversacion: CONVERSACION, motivo: opcion('motivo') ?? '',
    aplicar: args.includes('--aplicar'), respaldoEn: RESPALDO, ejecutor: `adc:${PROYECTO}`, log: (t) => console.log(`  ${t}`),
  });
  if (!r.ok) { console.error(`\n  ✗ ${r.error}\n`); process.exit(1); }
  process.exit(0);
} catch (e) {
  console.error(`\n  ✗ ${e instanceof Error ? e.message : 'error'}\n`);
  process.exit(1);
}
