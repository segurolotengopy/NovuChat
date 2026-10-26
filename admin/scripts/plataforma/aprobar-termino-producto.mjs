/**
 * =============================================================================
 * APROBAR, RECHAZAR O REVOCAR UN TÉRMINO DE PRODUCTO REGISTRADO (respaldo de la pantalla)
 * =============================================================================
 *
 * POR QUÉ EXISTE. Un comercio registra el nombre literal de un producto con «prompt/prompts»
 * («100 prompts») y NovuChat decide si el sistema lo trata como dato. La pantalla de Negocios
 * (`aprobarTerminoProducto`) es el camino normal; esto es el mismo acto por script, revisable y
 * con auditoría, para cuando la consola no está disponible o para dejarlo escrito en una sesión.
 *

 * SOLO RECHAZAR O REVOCAR. Aprobar se hace en la pantalla de Negocios (ver más abajo el porqué).
 * LA MISMA LÓGICA QUE LA CALLABLE. No repite nada: carga `plataforma/terminosProducto.ts` (la
 * transacción: estado, quién y cuándo, auditoría). Node no resuelve `.js` → `.ts`
 * solo, así que el script registra un resolvedor mínimo (solo para archivos del propio repo).
 *
 *   node scripts/plataforma/aprobar-termino-producto.mjs --proyecto <id> --tenant <id> --item <id> --decision aprobar|rechazar|revocar [--operador <nombre>] [--aplicar]
 *
 * SIN `--aplicar` NO ESCRIBE NADA: corre las mismas validaciones dentro de la transacción y dice
 * qué haría. Credenciales: las de gcloud del proyecto de la consola (`applicationDefault`),
 * como `activar-cobro-real.mjs`. Quien decide queda como `script:<operador>`.
 */
import { register } from 'node:module';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const PROYECTO = opcion('proyecto');
const TENANT = opcion('tenant');
const ITEM = opcion('item');
const DECISION = opcion('decision');
const OPERADOR = (opcion('operador') ?? 'claude').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) || 'claude';

const rojo = (t) => console.log(`\x1b[1;31m${t}\x1b[0m`);
const verde = (t) => console.log(`\x1b[1;32m${t}\x1b[0m`);
const gris = (t) => console.log(`\x1b[0;90m${t}\x1b[0m`);

if (!PROYECTO || !TENANT || !ITEM || !['aprobar', 'rechazar', 'revocar'].includes(DECISION ?? '')) {
  console.error('\n  node scripts/plataforma/aprobar-termino-producto.mjs --proyecto <id> --tenant <id> '
    + '--item <id> --decision aprobar|rechazar|revocar [--operador <nombre>] [--aplicar]\n');
  process.exit(2);
}

// APROBAR NO SE HACE POR ACÁ. La aprobación exige además el predicado de Productos
// (`nombreDeProductoApto`), y la frontera de zonas (`fronteras.test.ts`) no deja que un script de
// Plataforma lo importe: lo une `ganchos.ts` (coordinador) y solo lo tiene el callable desplegado.
// Aprobar con un predicado más flojo que el de la pantalla sería un camino lateral, así que se niega.
// Rechazar y revocar no lo necesitan y sí funcionan por acá.
if (DECISION === 'aprobar') {
  console.error('\n  ✗ Aprobar se hace en la pantalla de Negocios (callable aprobarTerminoProducto), que valida el nombre '
    + 'con el filtro de Productos. Este script solo rechaza o revoca.\n');
  process.exit(2);
}

// `.js` → `.ts` solo cuando el `.js` pedido no existe y el archivo importador es del repo.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(especificador, contexto, siguiente) {
  try { return await siguiente(especificador, contexto); } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' && especificador.startsWith('.') && especificador.endsWith('.js')
      && String(contexto.parentURL ?? '').includes('/functions/src/')) {
      return siguiente(especificador.slice(0, -3) + '.ts', contexto);
    }
    throw e;
  }
}`), import.meta.url);

const { decidirTermino, ErrorTermino } = await import('../../functions/src/plataforma/terminosProducto.ts');
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
const db = getFirestore();

console.log();
console.log(`  Comercio : ${TENANT}`);
console.log(`  Ítem     : ${ITEM}`);
console.log(`  Decisión : ${DECISION}${APLICAR ? '' : '   (en seco)'}`);
console.log();

try {
  const r = await decidirTermino(db, {
    tenantId: TENANT, itemId: ITEM, decision: DECISION, quien: `script:${OPERADOR}`,
    nombreApto: () => false, // nunca se usa: solo se consulta al aprobar, y aprobar se negó arriba
    porScript: true, enSeco: !APLICAR,
  });
  console.log(`  Término  : ${r.termino}`);
  console.log(`  Queda    : ${r.estado} · aprobados del comercio: ${r.aprobados}`);
  if (!APLICAR) {
    gris(`\n  Seco: no se escribió nada.${r.sinCambio ? ' (Ya estaba así.)' : ''} Agregue --aplicar.\n`);
  } else if (r.sinCambio) {
    verde('\n  ✓ Ya estaba así: no hay nada que cambiar.\n');
  } else {
    verde('\n  ✓ Hecho, con quién y cuándo en el término y una entrada en la auditoría del comercio.\n');
  }
  await db.terminate().catch(() => {});
} catch (e) {
  if (e instanceof ErrorTermino) {
    rojo(`  ✗ ${e.message} (${e.codigo})`);
  } else {
    rojo(`  ✗ ${e instanceof Error ? e.message : String(e)}`);
  }
  await db.terminate().catch(() => {});
  process.exit(1);
}
