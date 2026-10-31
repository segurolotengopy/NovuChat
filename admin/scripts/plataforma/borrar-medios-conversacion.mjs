/**
 * BORRAR LOS MEDIOS DE UNA CONVERSACIÓN (pedido del titular de los datos). Seco por omisión.
 *
 *   node scripts/plataforma/borrar-medios-conversacion.mjs --proyecto <id> --tenant <id> --conversacion wa_<tel> \
 *        [--motivo "texto corto"] [--respaldo-en <carpeta fuera del repositorio>] --bucket <nombre> [--aplicar --confirmar-comercio "<nombre>" [--objetos-ya-borrados]]
 *
 * Un comercio y una conversación por ejecución. --bucket es obligatorio (no se adivina). Con --aplicar exige --motivo, --respaldo-en,
 * --confirmar-comercio (el seco imprime el nombre) y que el proyecto esté en NOVUCHAT_PROYECTOS_PERMITIDOS (lista separada por comas). La lógica (y sus
 * garantías) está en `borrar-medios-conversacion-logica.mjs`. Salida: 0 hecho o seco; 1 rechazo/error; 2 mal llamado.
 */
import { realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ejecutar, limpiarError, rutaReal, validarEntrada } from './borrar-medios-conversacion-logica.mjs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const CONVERSACION = opcion('conversacion') ?? '';
const problemas = validarEntrada({ tenant: TENANT, conversacion: CONVERSACION });
if (!PROYECTO) problemas.push('falta --proyecto');
const RESPALDO = opcion('respaldo-en') ? rutaReal(opcion('respaldo-en')) : null;
const aqui = dirname(fileURLToPath(import.meta.url));
const REPO = realpathSync(join(aqui, '..', '..', '..'));
const BUCKET = opcion('bucket');
if (!BUCKET) problemas.push('falta --bucket <nombre del bucket de Storage del proyecto>: no se adivina');
if (RESPALDO) { const r = relative(REPO, RESPALDO); if (r === '' || (!r.startsWith('..') && !isAbsolute(r))) problemas.push('--respaldo-en debe estar fuera del repositorio'); }
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/plataforma/borrar-medios-conversacion.mjs --proyecto <id> --tenant <id> --conversacion wa_<tel> [--motivo "..."] [--respaldo-en <carpeta>] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const { getStorage } = await import('firebase-admin/storage');
initializeApp({ projectId: PROYECTO, storageBucket: BUCKET });
const bucket = getStorage().bucket();
const almacen = {
  verificar: async () => { if (!(await bucket.exists())[0]) throw new Error('bucket inexistente'); },
  estado: async (ruta) => ((await bucket.file(ruta).exists())[0] ? 'existe' : 'ausente'),
  borrar: async (ruta) => { await bucket.file(ruta).delete({ ignoreNotFound: true }); },
};

try {
  const r = await ejecutar({
    db: getFirestore(), almacen, tenant: TENANT, conversacion: CONVERSACION, motivo: opcion('motivo') ?? '',
    aplicar: args.includes('--aplicar'), respaldoEn: RESPALDO, ejecutor: `${(() => { try { return userInfo().username; } catch { return 'sistema'; } })()}@adc:${PROYECTO}`,
    proyecto: PROYECTO, proyectosPermitidos: (process.env.NOVUCHAT_PROYECTOS_PERMITIDOS ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    confirmarComercio: opcion('confirmar-comercio'), objetosYaBorrados: args.includes('--objetos-ya-borrados'),
    log: (t) => console.log(`  ${t}`),
  });
  if (!r.ok) { console.error(`\n  ✗ ${r.error}\n`); process.exit(1); }
  process.exit(0);
} catch (e) {
  console.error(`\n  ✗ ${limpiarError(e)}\n`);
  process.exit(1);
}
