/**
 * =============================================================================
 * RELLENAR LOS TÉRMINOS DE PRODUCTO DE LOS ÍTEMS QUE YA EXISTÍAN
 * =============================================================================
 *
 * POR QUÉ EXISTE. El disparador de Productos (`registrarTerminoDeProducto`) solo corre cuando un
 * ítem del catálogo cambia. Los ítems con «prompt» que ya existían al desplegarlo no tienen
 * documento en `tenants/{t}/terminosProducto/{itemId}`, y un `rechazado/límite` no se reevalúa
 * cuando se libera un lugar. Esto los deja como los dejaría el disparador: `pendiente` o
 * `rechazado`, NUNCA `aprobado` (aprobar es de la pantalla de Negocios o de
 * `aprobar-termino-producto.mjs`). Lógica: `plataforma/rellenarTerminos.ts`.
 *
 *   node scripts/plataforma/rellenar-terminos-producto.mjs --proyecto <id> (--tenant <id> | --todos) [--operador <nombre>] [--aplicar]
 *
 * SIN `--aplicar` NO ESCRIBE NADA: dice qué escribiría. Con `--aplicar` deja además una entrada en
 * la auditoría de cada comercio donde escribió. Cada comercio se procesa solo con sus propios
 * datos; `--todos` salta los dados de baja. Credenciales de gcloud (`applicationDefault`).
 */
import { register } from 'node:module';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const TODOS = args.includes('--todos');
const PROYECTO = opcion('proyecto');
const TENANT = opcion('tenant');
const OPERADOR = (opcion('operador') ?? 'claude').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) || 'claude';

const rojo = (t) => console.log(`\x1b[1;31m${t}\x1b[0m`);
const verde = (t) => console.log(`\x1b[1;32m${t}\x1b[0m`);
const gris = (t) => console.log(`\x1b[0;90m${t}\x1b[0m`);

if (!PROYECTO || (!TENANT && !TODOS) || (TENANT && TODOS)) {
  console.error('\n  node scripts/plataforma/rellenar-terminos-producto.mjs --proyecto <id> (--tenant <id> | --todos) [--operador <nombre>] [--aplicar]\n');
  process.exit(2);
}

// `.js` → `.ts` solo cuando el `.js` pedido no existe y el importador es del repo.
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

const { rellenarTerminos } = await import('../../functions/src/plataforma/rellenarTerminos.ts');
const { ErrorTermino } = await import('../../functions/src/plataforma/terminosProducto.ts');
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
const db = getFirestore();

console.log(`\n  Proyecto : ${PROYECTO}\n  Alcance  : ${TODOS ? 'todos los comercios' : TENANT}${APLICAR ? '' : '   (en seco)'}\n`);
let codigo = 0;
try {
  const ids = TODOS
    ? (await db.collection('tenants').select('estado').get()).docs.filter((d) => d.get('estado') !== 'baja').map((d) => d.id).sort()
    : [TENANT];
  let total = 0;
  for (const t of ids) {
    try {
      const r = await rellenarTerminos(db, t, { quien: `script:${OPERADOR}`, enSeco: !APLICAR });
      if (r.conPrompt === 0 && r.huerfanos === 0) continue;
      total += r.escritos.length;
      console.log(`  ${t}: ${r.conPrompt} ítems con «prompt» · ${APLICAR ? 'escritos' : 'se escribirían'} ${r.escritos.length}`
        + ` (${r.escritos.map((e) => `${e.itemId}=${e.estado}`).join(', ') || '—'}) · sin cambio ${r.sinCambio}`
        + (r.huerfanos > 0 ? ` · documentos sin ítem que lo pida: ${r.huerfanos} (no se borran)` : ''));
    } catch (e) {
      codigo = 1;
      rojo(`  ✗ ${t}: ${e instanceof ErrorTermino ? e.message : (e instanceof Error ? e.message : String(e))}`);
    }
  }
  if (APLICAR) verde(`\n  ✓ Hecho: ${total} documentos escritos (ninguno aprobado).\n`);
  else gris(`\n  Seco: no se escribió nada (${total} por escribir). Agregue --aplicar.\n`);
} finally {
  await db.terminate().catch(() => {});
}
process.exit(codigo);
