/**
 * MIGRAR `tenants.flujos` A `tenants.modulos` — H2b-3, SOLO EN SECO.
 *
 * POR QUÉ EXISTE. `Analisis/41` §3.3 y el plan H2b: las capacidades de un
 * comercio pasan de la lista `flujos` a la lista `modulos`, derivada del
 * registro (`functions/src/registro.ts`). Antes de escribir un solo dato en la
 * nube hay que demostrar, ficha por ficha, que NADA cambia para el comercio.
 * Q'Taco da altas el 05/10: un `modulos` mal migrado le quitaría el enlace de
 * la carta (`catalogoWeb.ts`). Este script es esa demostración.
 *
 * QUÉ HACE. Lee las fichas `tenants/{id}` (una lectura por ficha, solo los
 * campos `flujos`, `vertical` y `modulos`) y, por cada una, compara SIETE
 * chequeos «antes» (lo que cada lector decide hoy con `flujos`) contra
 * «después» (lo que el registro decide con `modulos`):
 *
 *   1. `tieneModulo` de los nueve módulos.
 *   2. Las capacidades de las reglas: agenda, cobro, catálogo web,
 *      onboarding y comunes.
 *   3. `documentoDeCobro` (dónde vive el QR).
 *   4. La venta del catálogo web (el enlace de la carta).
 *   5. Captación (`comprobarArchivoPlanes`).
 *   6. Pestañas de la consola: conjunto y orden.
 *   7. Etiqueta del catálogo.
 *
 * Informa además: fichas con `flujos` que no es lista, fichas con dos o más
 * flujos y los documentos de `funcionarios/*\/privado` de los comercios sin
 * agenda (lo que la regla futura de H2b-6 les cerraría). Solo cuenta.
 *
 * ES SOLO UN SECO. `--aplicar` y `--revertir` NO EXISTEN todavía: terminan con
 * código 2 sin abrir Firestore. Escribir `modulos` es otro PR, con ventana,
 * respaldo y vuelta atrás escrita (plan H2b, «operación del paso 1»). Este
 * archivo no tiene ninguna llamada de escritura, y una prueba lo comprueba
 * sobre su texto y contra el emulador (`updateTime` iguales).
 *
 * SALIDA. Código 0: cero diferencias. Código 1: hay diferencias (o una ficha
 * pedida no existe). Código 2: uso. Imprime solo ids de tenant, nombres de
 * módulos, banderas y conteos: nunca un dato del comercio ni de sus clientes.
 *
 *   node scripts/plataforma/migrar-modulos.mjs --proyecto <id> [--tenant a,b]
 *
 * NO se corre contra producción sin el «sí» de Andres. Costo en la nube: una
 * lectura por ficha, más el listado de `funcionarios/*\/privado` de los
 * comercios sin agenda. Cero escrituras.
 */
import { pathToFileURL } from 'node:url';
import {
  IDS_MODULOS, MODULOS_COMUNES_HOY, PUENTE_DE_FLUJOS, documentoDeCobro, etiquetaDeCatalogo,
  modulosDeFicha, pestanasDe, tieneModulo,
} from '../../functions/src/registro.ts';

// ===========================================================================
// «ANTES»: copia congelada de lo que hoy hace cada lector. TRANSITORIA: se
// borra con el paso 2 (cuando los lectores solo miren `modulos`). No se
// «arregla» aquí: si un lector cambia, esta copia sigue diciendo lo que hacía
// el código que está hoy en producción.
// ===========================================================================

/** `flujosTenant` de `firestore.rules`: `get('flujos', [vertical])`. Lista, o null (la regla falla y niega). */
function flujosDeReglas(ficha) {
  const lista = 'flujos' in ficha ? ficha.flujos : [ficha.vertical ?? ''];
  return Array.isArray(lista) ? lista : null;
}
const flujoEnReglas = (ficha, flujo) => flujosDeReglas(ficha)?.includes(flujo) === true;

/** `documentoQueCobra` de `modulos/cobros/cobro.ts`. */
function documentoQueCobraAntes(ficha) {
  const lista = ficha.flujos;
  const flujos = Array.isArray(lista) ? lista.map(String) : [String(ficha.vertical ?? '')];
  if (flujos.includes('venta')) return 'venta';
  if (flujos.includes('agendamiento')) return 'agendamiento';
  return null;
}

/** `tieneVenta` de `modulos/catalogo-web/catalogoWeb.ts` antes de H2b-4d. */
function tieneVentaAntes(ficha) {
  if (Array.isArray(ficha.flujos)) return ficha.flujos.includes('venta');
  return ficha.vertical === 'venta';
}

/** La comprobación de `comprobarArchivoPlanes` de `captacion.ts` antes de H2b-4b. */
function tieneCaptacionAntes(ficha) {
  const flujos = ficha.flujos ?? [ficha.vertical];
  return Array.isArray(flujos) && flujos.includes('onboarding');
}

/** `FLUJOS` y `flujosDe` de `web/src/central/lib/flujos.ts` (pestañas y etiqueta de catálogo). */
const FLUJOS_CONSOLA = {
  agendamiento: {
    catalogo: 'Servicios',
    pestanas: [
      { ruta: 'agenda', etiqueta: 'Agenda' },
      { ruta: 'cobros', etiqueta: 'Cobros' },
      { ruta: 'cobro', etiqueta: 'Configuración de QR' },
    ],
  },
  venta: {
    catalogo: 'Productos',
    pestanas: [
      { ruta: 'pedidos', etiqueta: 'Pedidos', roles: ['admin', 'oper'] },
      { ruta: 'cobros', etiqueta: 'Cobros' },
      { ruta: 'inventario', etiqueta: 'Inventario' },
      { ruta: 'cobro', etiqueta: 'Configuración de QR' },
    ],
  },
  onboarding: {
    catalogo: 'Catálogo',
    pestanas: [{ ruta: 'captacion', etiqueta: 'Captación', tambienPropietario: true }],
  },
};
const esFlujoConsola = (v) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(FLUJOS_CONSOLA, v);
function flujosDeConsola(ficha) {
  if (Array.isArray(ficha.flujos)) return ficha.flujos.filter(esFlujoConsola);
  return esFlujoConsola(ficha.vertical) ? [ficha.vertical] : [];
}
/** Las pestañas que pinta `App.tsx`: por flujo, una por ruta (queda la primera). */
function pestanasAntes(ficha) {
  return flujosDeConsola(ficha)
    .flatMap((f) => FLUJOS_CONSOLA[f].pestanas)
    .filter((p, i, todas) => todas.findIndex((q) => q.ruta === p.ruta) === i)
    .map((p) => `${p.ruta}|${p.etiqueta}|${(p.roles ?? ['admin']).join('+')}|${p.tambienPropietario === true}`);
}
function etiquetaAntes(ficha) {
  const nombres = [...new Set(flujosDeConsola(ficha).map((f) => FLUJOS_CONSOLA[f].catalogo))];
  return nombres.length === 1 ? nombres[0] : 'Catálogo';
}

/** Los módulos que el puente da a los flujos que leen las reglas, más los comunes, en orden de `IDS_MODULOS`. */
function modulosAntes(ficha) {
  const activos = [...MODULOS_COMUNES_HOY];
  for (const f of flujosDeReglas(ficha) ?? []) {
    if (Object.prototype.hasOwnProperty.call(PUENTE_DE_FLUJOS, f)) activos.push(...PUENTE_DE_FLUJOS[f].modulos);
  }
  return IDS_MODULOS.filter((m) => activos.includes(m));
}

// ===========================================================================
// COMPARACIÓN
// ===========================================================================

export const CHEQUEOS = [
  '1 tieneModulo', '2 capacidades de las reglas', '3 documentoDeCobro', '4 venta del catálogo web',
  '5 captación', '6a pestañas (conjunto)', '6b pestañas (orden)', '7 etiqueta del catálogo',
];

/**
 * Compara una ficha (`{flujos?, vertical?, modulos?}`) antes y después.
 * «Después» migra la ficha: `modulos` = lo que `modulosDeFicha` deriva hoy, y
 * todo se lee sobre `{...ficha, modulos}` solo con las funciones del registro.
 * Devuelve `{ modulos, diferencias: [{ chequeo, antes, despues }] }`.
 */
export function comparar(ficha) {
  const f = ficha ?? {};
  const modulos = modulosDeFicha(f);
  const migrada = { ...f, modulos };
  const diferencias = [];
  const ver = (chequeo, antes, despues) => {
    if (JSON.stringify(antes) !== JSON.stringify(despues)) diferencias.push({ chequeo, antes, despues });
  };

  // 1. Los nueve módulos.
  const mAntes = modulosAntes(f);
  ver(CHEQUEOS[0],
    IDS_MODULOS.filter((m) => mAntes.includes(m)),
    IDS_MODULOS.filter((m) => tieneModulo(migrada, m)));

  // 2. Capacidades de las reglas. Cobro = flujo `venta` = módulo propio `pedidos`;
  //    el catálogo web exige `tieneCobro` en las reglas (`catalogoWebActivo`);
  //    «comunes» no exigen capacidad: toda ficha existente.
  ver(CHEQUEOS[1], {
    agenda: flujoEnReglas(f, 'agendamiento'),
    cobro: flujoEnReglas(f, 'venta'),
    catalogoWeb: flujoEnReglas(f, 'venta'),
    onboarding: flujoEnReglas(f, 'onboarding'),
    comunes: true,
  }, {
    agenda: tieneModulo(migrada, 'agenda'),
    cobro: tieneModulo(migrada, 'pedidos'),
    catalogoWeb: tieneModulo(migrada, 'catalogo-web'),
    onboarding: tieneModulo(migrada, 'captacion'),
    comunes: tieneModulo(migrada, 'productos') && tieneModulo(migrada, 'campanas'),
  });

  // 3. El documento del QR.
  ver(CHEQUEOS[2], documentoQueCobraAntes(f), documentoDeCobro(modulos));

  // 4. La venta del catálogo web.
  ver(CHEQUEOS[3], tieneVentaAntes(f), tieneModulo(migrada, 'catalogo-web'));

  // 5. Captación.
  ver(CHEQUEOS[4], tieneCaptacionAntes(f), tieneModulo(migrada, 'captacion'));

  // 6. Pestañas: conjunto (sin orden) y orden.
  const pA = pestanasAntes(f);
  const pD = pestanasDe(modulosDeFicha(migrada))
    .map((p) => `${p.ruta}|${p.titulo}|${p.roles.join('+')}|${p.tambienPropietario === true}`);
  ver(CHEQUEOS[5], [...pA].sort(), [...pD].sort());
  if (JSON.stringify([...pA].sort()) === JSON.stringify([...pD].sort())) ver(CHEQUEOS[6], pA, pD);

  // 7. Etiqueta del catálogo.
  ver(CHEQUEOS[7], etiquetaAntes(f), etiquetaDeCatalogo(modulosDeFicha(migrada)));

  return { modulos, diferencias };
}

/** Lo que el informe cuenta de una ficha aparte de las diferencias. */
export function notas(ficha) {
  const f = ficha ?? {};
  const tieneFlujos = 'flujos' in f;
  return {
    flujosNoLista: tieneFlujos && !Array.isArray(f.flujos),
    variosFlujos: Array.isArray(f.flujos) && new Set(f.flujos).size >= 2,
    conModulosYa: 'modulos' in f,
  };
}

// ===========================================================================
// EJECUCIÓN (solo con `node migrar-modulos.mjs`; importarlo no abre nada)
// ===========================================================================

async function principal() {
  const args = process.argv.slice(2);
  const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

  if (args.includes('--aplicar') || args.includes('--revertir')) {
    console.error('\n  ✗ migrar-modulos.mjs es SOLO un seco: --aplicar y --revertir no existen todavía.');
    console.error('    Escribir `modulos` es un PR aparte, con ventana, respaldo y el OK de Andres.\n');
    process.exit(2);
  }
  const PROYECTO = opcion('proyecto');
  const pedidos = (opcion('tenant') ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
  const problemas = [];
  if (!PROYECTO) problemas.push('falta --proyecto');
  if (args.includes('--tenant') && pedidos.length === 0) problemas.push('--tenant sin ids');
  for (const t of pedidos) if (!ID_TENANT.test(t)) problemas.push(`--tenant inválido: ${t}`);
  if (problemas.length) {
    console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
    console.error('\n  node scripts/plataforma/migrar-modulos.mjs --proyecto <id> [--tenant a,b]\n');
    process.exit(2);
  }

  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: PROYECTO });
  const db = getFirestore();
  const campos = ['flujos', 'vertical', 'modulos'];

  console.log(`\n  SECO (solo lecturas) · proyecto ${PROYECTO}${pedidos.length ? ` · tenants ${pedidos.join(', ')}` : ''}\n`);

  let fichas;
  let faltan = [];
  if (pedidos.length) {
    const refs = pedidos.map((t) => db.doc(`tenants/${t}`));
    const docs = await db.getAll(...refs, { fieldMask: campos });
    fichas = docs.filter((d) => d.exists).map((d) => ({ id: d.id, ficha: d.data() ?? {} }));
    faltan = docs.filter((d) => !d.exists).map((d) => d.id);
  } else {
    const docs = await db.collection('tenants').select(...campos).get();
    fichas = docs.docs.map((d) => ({ id: d.id, ficha: d.data() ?? {} }));
  }

  let conDiferencias = 0;
  const flujosNoLista = [];
  const variosFlujos = [];
  const conModulosYa = [];
  const sinAgenda = [];
  for (const { id, ficha } of fichas.sort((a, b) => a.id.localeCompare(b.id))) {
    const { modulos, diferencias } = comparar(ficha);
    const n = notas(ficha);
    if (n.flujosNoLista) flujosNoLista.push(id);
    if (n.variosFlujos) variosFlujos.push(id);
    if (n.conModulosYa) conModulosYa.push(id);
    if (!tieneModulo({ ...ficha, modulos }, 'agenda')) sinAgenda.push(id);
    if (diferencias.length === 0) {
      console.log(`  ✓ ${id}: igual (${modulos.length} módulos)`);
      continue;
    }
    conDiferencias += 1;
    console.log(`  ✗ ${id}: ${diferencias.length} diferencia(s)`);
    for (const d of diferencias) {
      console.log(`      ${d.chequeo}\n        antes  : ${JSON.stringify(d.antes)}\n        después: ${JSON.stringify(d.despues)}`);
    }
  }
  for (const t of faltan) { console.log(`  ✗ ${t}: no existe la ficha`); }

  // Documentos de funcionarios/*/privado de los comercios sin agenda: SOLO se cuentan (listDocuments no lee datos).
  console.log('\n  funcionarios/*/privado en comercios sin agenda (solo conteo):');
  let totalPrivados = 0;
  for (const id of sinAgenda) {
    const funcionarios = await db.collection(`tenants/${id}/funcionarios`).listDocuments();
    let privados = 0;
    for (const fu of funcionarios) privados += (await fu.collection('privado').listDocuments()).length;
    totalPrivados += privados;
    if (privados > 0) console.log(`    ${id}: ${privados} documento(s)`);
  }
  console.log(`    total: ${totalPrivados} en ${sinAgenda.length} comercio(s) sin agenda`);

  console.log('\n  Informe');
  console.log(`    fichas leídas            : ${fichas.length}`);
  console.log(`    con diferencias          : ${conDiferencias + faltan.length}`);
  console.log(`    flujos que no es lista   : ${flujosNoLista.length}${flujosNoLista.length ? ` (${flujosNoLista.join(', ')})` : ''}`);
  console.log(`    con 2 o más flujos       : ${variosFlujos.length}${variosFlujos.length ? ` (${variosFlujos.join(', ')})` : ''}`);
  console.log(`    con modulos ya escrita   : ${conModulosYa.length}${conModulosYa.length ? ` (${conModulosYa.join(', ')})` : ''}`);
  console.log('\n  Seco: no se escribió nada.\n');

  await db.terminate().catch(() => {});
  process.exit(conDiferencias + faltan.length > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal();
