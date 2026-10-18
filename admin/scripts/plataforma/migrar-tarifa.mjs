/**
 * FIJAR LA TARIFA DE LOS COMERCIOS QUE SE NOMBREN (Bloque 1 «planes y bolsas», PR-4b), EN SECO POR DEFECTO.
 *
 * POR QUÉ EXISTE. La tarifa (`estandar` o `meta_incluido`) es el campo `tarifa` de `cuenta/estado`.
 * Una cuenta SIN el campo rige `meta_incluido` (`tarifaDe`): es el caso de Bellido (Impulso, copia de
 * 100 conversaciones, sin tarifa) y de Q'Taco hasta el traslado. Pasar un comercio a `estandar`
 * cambia qué bolsa puede comprar (`bolsaPermitida`: 300 por USD 15 en vez de 30 por USD 10) y qué
 * cifras muestra el catálogo; por eso se hace SOLO con el comercio nombrado y con constancia.
 *
 * QUÉ HACE.
 *   - Sin `--tenant`: LISTA todos los tenants (plan, modalidad, copia `limites`, precio por contrato,
 *     titularidad de cada número, `bolsa`, `bolsaSalientes` y `tarifa`) y NO escribe nada, ni con
 *     `--aplicar` (en ese caso sale con 2).
 *   - Con `--tenant <id>` (repetible) y `--tarifa <t>`: propone el cambio de cada comercio nombrado
 *     y, con `--aplicar`, escribe SOLO el campo `tarifa` de `tenants/{t}/cuenta/estado`, más la
 *     auditoría `migrar_tarifa` (antes y después) en la MISMA transacción, y RELEE al terminar.
 *   - NUNCA toca la copia `limites`, ni `plan`, ni los derivados, ni la ficha, ni las rutas, ni un
 *     tenant que no se nombró. La copia se actualiza, si hace falta, con `asignar-plan.mjs --plan`.
 *   - Un tenant que no existe, dado de baja o sin `cuenta/estado` se RECHAZA antes de escribir nada:
 *     si uno de los nombrados falla la validación, no se escribe ninguno.
 *   - Un valor de `--tarifa` fuera de la lista sale con 2, antes de abrir la conexión.
 *
 * `--operador <correo>` es obligatorio: queda en la auditoría (`uid`, `origen: 'script'`).
 *
 *   node scripts/plataforma/migrar-tarifa.mjs --proyecto <id> --operador <correo>
 *   node scripts/plataforma/migrar-tarifa.mjs --proyecto <id> --operador <correo> --tenant <id> --tarifa estandar
 *   node scripts/plataforma/migrar-tarifa.mjs --proyecto <id> --operador <correo> --tenant <id> --tarifa estandar --aplicar
 *
 * DECISIÓN C: Q'Taco se queda en `meta_incluido` hasta el traslado de su número (~07/11): no se
 * nombra ahora. Nunca imprime un número completo: solo sus últimos cuatro dígitos.
 */
import { registerHooks } from 'node:module';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const opciones = (n) => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1] ?? ''] : []));
const APLICAR = args.includes('--aplicar');
const PROYECTO = opcion('proyecto');
const NOMBRADOS = [...new Set(opciones('tenant').map((t) => t.trim().toLowerCase()))];
const TARIFA = opcion('tarifa');
const OPERADOR = (opcion('operador') ?? '').trim().toLowerCase();

registerHooks({
  resolve(especificador, contexto, siguiente) {
    try {
      return siguiente(especificador, contexto);
    } catch (e) {
      if (especificador.startsWith('.') && especificador.endsWith('.js') && contexto.parentURL?.endsWith('.ts')) {
        return siguiente(`${especificador.slice(0, -3)}.ts`, contexto);
      }
      throw e;
    }
  },
});
const { esTarifa, limitesDeCuenta, precioPorContratoDe, tarifaDe } = await import('../../functions/src/central/cuenta/planes.ts');

const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!CORREO.test(OPERADOR)) problemas.push('--operador <correo> es obligatorio: es quien queda en la auditoría');
for (const t of NOMBRADOS) if (!ID_TENANT.test(t)) problemas.push(`--tenant inválido: «${t}» (minúsculas, guiones, 3 a 60)`);
if (TARIFA !== null && !esTarifa(TARIFA)) problemas.push(`--tarifa desconocida: ${TARIFA || '(vacía)'}. Una de: estandar, meta_incluido`);
if (NOMBRADOS.length > 0 && TARIFA === null) problemas.push('con --tenant hace falta --tarifa <estandar|meta_incluido>');
if (TARIFA !== null && NOMBRADOS.length === 0) problemas.push('--tarifa sin --tenant: este script nunca escribe sin nombrar a los comercios');
if (APLICAR && (NOMBRADOS.length === 0 || TARIFA === null)) problemas.push('--aplicar exige --tenant <id> y --tarifa');
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/plataforma/migrar-tarifa.mjs --proyecto <id> --operador <correo> [--tenant <id> ... --tarifa <estandar|meta_incluido>] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const cola = (v) => (v ? `…${String(v).slice(-4)}` : '—');
const copiaTexto = (l) => (l && typeof l === 'object'
  ? `${l.conversaciones ?? '?'} conv · ${l.productos ?? '?'} prod · ${l.agendas ?? '?'} ag · ${l.cambiosIncluidos ?? '?'} cambios`
  : '(sin copia)');

const [tenantsSnap, rutasSnap] = await Promise.all([db.collection('tenants').get(), db.collection('rutasWhatsApp').get()]);
const rutasPorTenant = new Map();
for (const r of rutasSnap.docs) {
  const t = String(r.get('tenantId') ?? '');
  if (!rutasPorTenant.has(t)) rutasPorTenant.set(t, []);
  rutasPorTenant.get(t).push(r);
}
const fichas = new Map(tenantsSnap.docs.map((d) => [d.id, d]));

console.log(`\n  Tarifa por comercio · proyecto ${PROYECTO} · ${APLICAR ? 'APLICAR' : 'seco'} · operador ${OPERADOR}`);
console.log(`  Tenants en Firestore: ${tenantsSnap.size} · se ${NOMBRADOS.length ? `proponen ${NOMBRADOS.length} nombrados a ${TARIFA}` : 'listan, sin proponer nada'}\n`);

// --- el inventario: cada tenant, con todo lo que decide la tarifa o depende de ella ---------------
const cuentas = new Map();
for (const ficha of [...tenantsSnap.docs].sort((a, b) => a.id.localeCompare(b.id))) {
  const c = await db.doc(`tenants/${ficha.id}/cuenta/estado`).get();
  cuentas.set(ficha.id, c);
  const d = c.data() ?? {};
  const precio = precioPorContratoDe(d);
  const marca = NOMBRADOS.includes(ficha.id) ? '>' : ' ';
  console.log(` ${marca} ${ficha.id} (${ficha.get('nombre') ?? '?'}) · estado ${ficha.get('estado') ?? '?'}`);
  if (!c.exists) { console.log('      sin cuenta/estado'); continue; }
  const rutas = (rutasPorTenant.get(ficha.id) ?? []).map((r) => `${cola(r.id)}:${r.get('titularidad') ?? '(ninguna)'}`);
  console.log(`      plan ${d.plan ?? '(ninguno)'} · modalidad ${d.modalidad ?? '(ninguna)'} · copia ${copiaTexto(d.limites)}`
    + ` · precio ${precio === null ? 'del plan' : `USD ${precio} por contrato`}`);
  console.log(`      bolsa ${d.bolsa ?? 0} · bolsaSalientes ${d.bolsaSalientes ?? 0} · números ${rutas.join(', ') || '(ninguno)'}`
    + ` · tarifa ${d.tarifa ?? '(sin campo: rige meta_incluido)'}`);
}

if (NOMBRADOS.length === 0) {
  console.log('\n  Solo lista: no se escribió nada. Nombre los comercios con --tenant y --tarifa.\n');
  process.exit(0);
}

// --- la validación de TODOS los nombrados, antes de escribir ninguno ------------------------------
const rechazos = [];
for (const t of NOMBRADOS) {
  const f = fichas.get(t);
  if (!f) rechazos.push(`${t}: no existe`);
  else if (f.get('estado') === 'dado_de_baja') rechazos.push(`${t}: está dado de baja`);
  else if (!cuentas.get(t)?.exists) rechazos.push(`${t}: no tiene cuenta/estado`);
}
if (rechazos.length) {
  console.error('\n  ✗ No se escribe nada: ' + rechazos.join('; ') + '\n');
  process.exit(1);
}

console.log('');
let cambian = 0;
let fallos = 0;
for (const t of NOMBRADOS) {
  const d = cuentas.get(t).data() ?? {};
  const antes = tarifaDe(d);
  const lim = limitesDeCuenta(d);
  if (d.tarifa === TARIFA) { console.log(`  = ${t}: ya tiene tarifa ${TARIFA}, sin cambios`); continue; }
  cambian += 1;
  console.log(`  ${t}: tarifa ${d.tarifa ?? '(sin campo)'} (rige ${antes}) → ${TARIFA}; la copia (${lim.conversaciones} conversaciones) NO se toca`);
  if (!APLICAR) continue;

  const ref = db.doc(`tenants/${t}/cuenta/estado`);
  let resultado;
  try {
    resultado = await db.runTransaction(async (tx) => {
      const [f, c] = await Promise.all([tx.get(db.doc(`tenants/${t}`)), tx.get(ref)]);
      // Un rechazo se DEVUELVE, no se lanza (ver asignar-plan.mjs: el rollback del SDK no se espera).
      if (!f.exists || f.get('estado') === 'dado_de_baja' || !c.exists) return 'rechazado';
      const previa = c.get('tarifa');
      if (previa === TARIFA) return 'igual';
      tx.update(ref, { tarifa: TARIFA });
      tx.create(db.collection(`tenants/${t}/auditoria`).doc(), {
        accion: 'migrar_tarifa', uid: OPERADOR, origen: 'script', script: 'migrar-tarifa', en: Timestamp.now(),
        antes: { tarifa: previa ?? null, rige: tarifaDe(c.data()) }, despues: { tarifa: TARIFA, rige: TARIFA },
      });
      return 'escrito';
    });
  } catch (e) {
    fallos += 1;
    console.log(`    ✗ falló: ${e instanceof Error ? e.message : String(e)}`);
    continue;
  }
  if (resultado === 'rechazado') { fallos += 1; console.log('    ✗ rechazado dentro de la transacción: no se escribió'); continue; }
  if (resultado === 'igual') { console.log('    = otro escritor ya la había fijado'); continue; }
  const leida = (await ref.get()).get('tarifa');
  const ok = leida === TARIFA;
  if (!ok) fallos += 1;
  console.log(`    ${ok ? '✓' : '✗'} releído: tarifa ${leida ?? '(sin campo)'}`);
}

console.log(`\n  Nombrados: ${NOMBRADOS.length} · con cambio: ${cambian} · fallos: ${fallos}`);
if (!APLICAR) console.log('  Seco: no se escribió nada. Agregue --aplicar (con el OK de Andres).\n');
else console.log('');
process.exit(fallos > 0 ? 1 : 0);
