/**
 * VERIFICAR QUE TODA FICHA DE TENANT TIENE `modulos` (SECO, SOLO LEE).
 *
 * PARA QUÉ. H2b-cierre quita de las reglas y del código toda lectura de `flujos`
 * y `vertical` para decidir capacidades: `tenants.modulos` es la ÚNICA fuente y
 * una ficha sin lista `modulos` no tiene ningún módulo (falla cerrado). Antes de
 * desplegar esas reglas hay que saber que NINGUNA ficha viva está sin lista; una
 * sola que falte pierde a su comercio la agenda, los pedidos o el catálogo.
 *
 *   node scripts/modulos/verificar-todas-con-modulos.mjs --proyecto <id> [--tenant a,b]
 *
 * SALIDA. Código 0: todas las fichas tienen `modulos` como lista NO vacía. Código 1: al
 * menos una no (se imprime su id y el motivo: ausente, nula, no es lista o VACÍA), o un
 * `--tenant` pedido no existe. Las fichas dadas de baja no fallan (no operan) pero se
 * AVISAN con su conteo. Además se compara cada lista con lo que derivaría la migración
 * (`modulosDeFlujos(flujosDeFicha)`, como `migrar-modulos.mjs`) y se REPORTAN las diferencias
 * (no fallan: una lista puede cerrar módulos a propósito, pero hay que verlas). Código
 * 2: uso. Código 3: error de ejecución (solo el código o nombre del error).
 * Imprime ids de tenant, banderas y conteos: nunca un dato del comercio.
 *
 * SOLO LEE: una lectura por ficha (con máscara de campos `modulos` y `estado`),
 * cero escrituras; una prueba comprueba sobre el texto que no hay llamadas de
 * escritura. NO se corre contra producción sin el «sí» de Andres.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IDS_MODULOS, modulosDeFlujos, flujosDeFicha } from '../../functions/src/registro.ts';

/** Pura: clasifica una ficha. `ok` solo si `modulos` es una lista (aunque esté vacía). */
export function clasificarFicha(ficha) {
  const f = ficha ?? {};
  if (!Object.prototype.hasOwnProperty.call(f, 'modulos') || f.modulos === undefined) return { ok: false, motivo: 'ausente' };
  if (f.modulos === null) return { ok: false, motivo: 'nula' };
  if (!Array.isArray(f.modulos)) return { ok: false, motivo: 'no es lista' };
  if (f.modulos.length === 0) return { ok: false, motivo: 'vacía' };
  return { ok: true, motivo: 'lista' };
}

/** Pura: resume una lista de { id, ficha }. Las dadas de baja no cuentan como faltante. */
export function verificar(fichas) {
  const faltan = [];
  let conModulos = 0;
  let bajasSinModulos = 0;
  for (const { id, ficha } of fichas) {
    const c = clasificarFicha(ficha);
    if (c.ok) { conModulos += 1; continue; }
    if ((ficha ?? {}).estado === 'dado_de_baja') { bajasSinModulos += 1; continue; }
    faltan.push({ id, motivo: c.motivo });
  }
  // Diferencias con la derivación de la migración (solo fichas con lista válida y operativas).
  const diferencias = [];
  for (const { id, ficha } of fichas) {
    if (!clasificarFicha(ficha).ok || (ficha ?? {}).estado === 'dado_de_baja') continue;
    const derivada = modulosDeFlujos(flujosDeFicha(ficha));
    const lista = ficha.modulos;
    const faltan_ = IDS_MODULOS.filter((m) => derivada.includes(m) && !lista.includes(m));
    const sobran = IDS_MODULOS.filter((m) => lista.includes(m) && !derivada.includes(m));
    if (faltan_.length || sobran.length) diferencias.push({ id, sinElLegado: faltan_, masQueElLegado: sobran });
  }
  return { total: fichas.length, conModulos, bajasSinModulos, faltan, diferencias };
}

const esPrincipal = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (esPrincipal) {
  const args = process.argv.slice(2);
  const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
  if (args.includes('--aplicar')) {
    console.error('\n  ✗ Este script es SOLO un seco: --aplicar no existe.\n');
    process.exit(2);
  }
  const PROYECTO = opcion('proyecto');
  const pedidos = [...new Set((opcion('tenant') ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
  const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
  const problemas = [];
  if (!PROYECTO) problemas.push('falta --proyecto');
  if (args.includes('--tenant') && pedidos.length === 0) problemas.push('--tenant sin ids');
  for (const t of pedidos) if (!ID_TENANT.test(t)) problemas.push(`--tenant inválido: ${t}`);
  if (problemas.length) {
    console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
    console.error('\n  node scripts/modulos/verificar-todas-con-modulos.mjs --proyecto <id> [--tenant a,b]\n');
    process.exit(2);
  }
  try {
    const { initializeApp } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    initializeApp({ projectId: PROYECTO });
    const db = getFirestore();
    const campos = ['modulos', 'estado', 'flujos', 'vertical'];
    let docs;
    if (pedidos.length) {
      docs = (await db.getAll(...pedidos.map((t) => db.doc(`tenants/${t}`)), { fieldMask: campos })).filter((d) => d.exists);
    } else {
      docs = (await db.collection('tenants').select(...campos).get()).docs;
    }
    const r = verificar(docs.map((d) => ({ id: d.id, ficha: d.data() ?? {} })));
    // Un `--tenant` pedido que no existe NO es «todo bien»: se cuenta como falla.
    const existentes = new Set(docs.map((d) => d.id));
    const noExisten = pedidos.filter((t) => !existentes.has(t));
    for (const t of noExisten) r.faltan.push({ id: t, motivo: 'la ficha no existe' });
    console.log(`\n  SECO (solo lecturas) · proyecto ${PROYECTO}\n`);
    console.log(`  fichas: ${r.total} · con modulos: ${r.conModulos} · dadas de baja sin modulos: ${r.bajasSinModulos} · sin modulos: ${r.faltan.length}`);
    for (const f of r.faltan.sort((a, b) => a.id.localeCompare(b.id))) console.log(`  ✗ ${f.id}: modulos ${f.motivo}`);
    for (const d of r.diferencias) {
      console.log(`  ~ ${d.id}: frente a la derivación de la migración — le faltan [${d.sinElLegado.join(', ')}], tiene de más [${d.masQueElLegado.join(', ')}]`);
    }
    if (r.bajasSinModulos > 0) console.log(`  ! aviso: ${r.bajasSinModulos} ficha(s) dada(s) de baja sin modulos (no fallan; no operan).`);
    if (r.faltan.length) {
      console.log('\n  Hay fichas sin `modulos`: NO desplegar las reglas de H2b-cierre hasta escribírselas.\n');
      process.exit(1);
    }
    console.log('\n  ✓ Todas las fichas tienen `modulos`.\n');
  } catch (e) {
    console.error(`\n  ✗ Error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`);
    process.exit(3);
  }
}
