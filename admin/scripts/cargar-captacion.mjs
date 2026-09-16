/**
 * CARGAR EL CONTENIDO DEL FLUJO DE CAPTACIÓN DE UN COMERCIO, DESDE UN JSON.
 *
 * POR QUÉ EXISTE. El flujo de captación (`onboarding`) es genérico: lo que el
 * asistente ofrece —rubros, planes, cargos únicos, aclaraciones de la oferta y
 * el nombre del asistente— sale de la consola, no del flujo de n8n. Se puede
 * cargar a mano desde la pestaña «Captación», pero en un alta conviene partir
 * de un archivo versionado y revisable (NovuChat: `datos/captacion-novuchat.json`,
 * copiado del sitio), y cargarlo entero en una operación que se puede repetir.
 *
 * QUÉ ESCRIBE, en UNA transacción:
 *   - los campos COMUNES de `config/negocio` que traiga el JSON —nombre del
 *     asistente, trato y nivel de emojis— (merge: no toca el resto de lo común);
 *   - en `config/onboarding`, SOLO los campos que trae el JSON, cada uno
 *     reemplazado entero (`mergeFields`: una lista vieja no se mezcla con la
 *     nueva), más el sello `actualizadoPor: 'cargar-captacion'`;
 *   - una entrada en `auditoria`.
 *
 * EL SDK ADMIN SE SALTA LAS REGLAS. Por eso este script valida el JSON con el
 * mismo contrato que las reglas y la pantalla (tamaños, tipos, enumerados, y
 * más de 5 planes exige `archivoPlanes`), rechaza cualquier clave que no esté
 * en el contrato —un campo que no está en la lista no entra, igual que en las
 * reglas— y exige que el comercio tenga `onboarding` en `flujos` y esté activo.
 *
 *   node scripts/cargar-captacion.mjs --proyecto <id> --tenant novuchat \
 *     --archivo scripts/datos/captacion-novuchat.json            # en seco
 *   ... --aplicar                                                 # escribe
 *
 * Sin `--aplicar` no escribe nada: dice qué cambiaría, con conteos y nombres,
 * no con los textos largos. Las claves que empiezan con `_` (p. ej. `_fuente`)
 * son notas del archivo y no se escriben.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');

const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const ARCHIVO = opcion('archivo');

// Mismo formato que `ID_TENANT` en functions/src/index.ts.
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;

// --- EL CONTRATO -------------------------------------------------------------
// El mismo que `configOnboardingValida()` en firestore.rules y la pantalla
// «Captación». Si cambia allá, cambia acá: la prueba del script lo ejercita.
const FLUJOS_SUGERIDOS = new Set(['agendamiento', 'venta', 'recordatorios', 'a_medida']);
const PERIODOS = new Set(['mes', 'anio', 'unico']);
const TIPOS_ARCHIVO = new Set(['pdf', 'imagen']);
const ID_RUBRO = /^[a-z0-9-]{1,30}$/;
const URL_HTTPS = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~/?#=&%-]*)?$/;
const PLANTILLA = /^[a-z0-9_]{1,64}$/;
const MAX = { rubros: 8, planes: 20, cargosUnicos: 5, aclaraciones: 15, planesEnTexto: 5 };

// Campos de `config/onboarding` que este script escribe. `nombreAsistente` es
// COMÚN (va a `config/negocio`), y el sello lo pone el script.
const CAMPOS_ONBOARDING = [
  'rubros', 'planes', 'cargosUnicos', 'aclaraciones', 'archivoPlanes',
  'mensajeClienteActual', 'enlaceConsola', 'topeAviso', 'plantillaAviso',
];
// Campos COMUNES (`config/negocio`): identidad y voz del asistente. Valen para
// todos los flujos del comercio, no solo para la captación.
const CAMPOS_NEGOCIO = ['nombreAsistente', 'tratamiento', 'estiloEmojis'];
const TRATAMIENTOS = new Set(['usted', 'tu', 'vos', 'neutro']);
const ESTILOS_EMOJIS = new Set(['ninguno', 'pocos', 'muchos']);
const CLAVES = new Set([...CAMPOS_NEGOCIO, ...CAMPOS_ONBOARDING]);

const esTexto = (v, max, { vacio = false } = {}) =>
  typeof v === 'string' && v.length <= max && (vacio || v.trim().length > 0);
const esPrecio = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Devuelve la lista de problemas del JSON; vacía si cumple el contrato. */
function validar(d) {
  const p = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['el archivo no es un objeto JSON'];

  for (const k of Object.keys(d)) {
    if (!k.startsWith('_') && !CLAVES.has(k)) p.push(`clave desconocida: «${k}» (no está en el contrato; no se escribe nada)`);
  }
  // Solo las claves de cada elemento que admite el contrato: lo demás no entra.
  const soloClaves = (obj, permitidas, donde) => {
    for (const k of Object.keys(obj)) if (!permitidas.includes(k)) p.push(`${donde}: clave desconocida «${k}»`);
  };
  const lista = (nombre, max, revisar) => {
    if (!(nombre in d)) return;
    const v = d[nombre];
    if (!Array.isArray(v)) { p.push(`${nombre}: tiene que ser una lista`); return; }
    if (v.length > max) p.push(`${nombre}: ${v.length} elementos, el máximo es ${max}`);
    v.forEach((e, i) => {
      const donde = `${nombre}[${i}]`;
      if (!e || typeof e !== 'object' || Array.isArray(e)) { p.push(`${donde}: tiene que ser un objeto`); return; }
      revisar(e, donde);
    });
  };

  if ('nombreAsistente' in d && !esTexto(d.nombreAsistente, 40)) {
    p.push('nombreAsistente: texto de 1 a 40 caracteres');
  }
  // Los enumerados son los mismos de la consola y de `prompt.ts`: el servidor
  // traduce cada uno a una frase fija, así que un valor inventado dejaría al
  // asistente con la voz de respaldo sin que nadie lo note.
  if ('tratamiento' in d && !TRATAMIENTOS.has(d.tratamiento)) {
    p.push(`tratamiento: uno de ${[...TRATAMIENTOS].join(', ')}`);
  }
  if ('estiloEmojis' in d && !ESTILOS_EMOJIS.has(d.estiloEmojis)) {
    p.push(`estiloEmojis: uno de ${[...ESTILOS_EMOJIS].join(', ')}`);
  }

  const idsRubro = new Set();
  lista('rubros', MAX.rubros, (r, donde) => {
    soloClaves(r, ['id', 'nombre', 'solucion', 'flujoSugerido'], donde);
    if (typeof r.id !== 'string' || !ID_RUBRO.test(r.id)) p.push(`${donde}.id: minúsculas, dígitos y guiones, 1 a 30`);
    else if (idsRubro.has(r.id)) p.push(`${donde}.id: «${r.id}» repetido`);
    else idsRubro.add(r.id);
    if (!esTexto(r.nombre, 40)) p.push(`${donde}.nombre: texto de 1 a 40 caracteres`);
    if (!esTexto(r.solucion, 300)) p.push(`${donde}.solucion: texto de 1 a 300 caracteres (tiene ${String(r.solucion ?? '').length})`);
    if (!FLUJOS_SUGERIDOS.has(r.flujoSugerido)) p.push(`${donde}.flujoSugerido: uno de ${[...FLUJOS_SUGERIDOS].join(', ')}`);
  });

  lista('planes', MAX.planes, (pl, donde) => {
    soloClaves(pl, ['nombre', 'precioUsd', 'periodo', 'incluye'], donde);
    if (!esTexto(pl.nombre, 40)) p.push(`${donde}.nombre: texto de 1 a 40 caracteres`);
    if (!esPrecio(pl.precioUsd)) p.push(`${donde}.precioUsd: número mayor o igual a 0, en dólares`);
    if (!PERIODOS.has(pl.periodo)) p.push(`${donde}.periodo: uno de ${[...PERIODOS].join(', ')}`);
    if (!esTexto(pl.incluye, 200, { vacio: true })) p.push(`${donde}.incluye: texto de hasta 200 caracteres (tiene ${String(pl.incluye ?? '').length})`);
  });

  lista('cargosUnicos', MAX.cargosUnicos, (c, donde) => {
    soloClaves(c, ['nombre', 'precioUsd', 'desde', 'detalle'], donde);
    if (!esTexto(c.nombre, 60)) p.push(`${donde}.nombre: texto de 1 a 60 caracteres`);
    if (!esPrecio(c.precioUsd)) p.push(`${donde}.precioUsd: número mayor o igual a 0, en dólares`);
    if (typeof c.desde !== 'boolean') p.push(`${donde}.desde: true o false`);
    if (!esTexto(c.detalle, 200, { vacio: true })) p.push(`${donde}.detalle: texto de hasta 200 caracteres (tiene ${String(c.detalle ?? '').length})`);
  });

  lista('aclaraciones', MAX.aclaraciones, (a, donde) => {
    soloClaves(a, ['tema', 'texto'], donde);
    if (!esTexto(a.tema, 60)) p.push(`${donde}.tema: texto de 1 a 60 caracteres`);
    if (!esTexto(a.texto, 600)) p.push(`${donde}.texto: texto de 1 a 600 caracteres (tiene ${String(a.texto ?? '').length})`);
  });

  if ('archivoPlanes' in d) {
    const a = d.archivoPlanes;
    if (!a || typeof a !== 'object' || Array.isArray(a)) p.push('archivoPlanes: tiene que ser un objeto');
    else {
      soloClaves(a, ['url', 'tipo', 'nombreArchivo'], 'archivoPlanes');
      if (typeof a.url !== 'string' || a.url.length > 500 || !URL_HTTPS.test(a.url)) p.push('archivoPlanes.url: una dirección https://');
      if (!TIPOS_ARCHIVO.has(a.tipo)) p.push('archivoPlanes.tipo: pdf o imagen');
      if (!esTexto(a.nombreArchivo, 80)) p.push('archivoPlanes.nombreArchivo: texto de 1 a 80 caracteres');
    }
  }
  // Con más de 5 planes la lista ya no se lee en un chat: va un archivo.
  if (Array.isArray(d.planes) && d.planes.length > MAX.planesEnTexto && !('archivoPlanes' in d)) {
    p.push(`planes: ${d.planes.length} planes exigen archivoPlanes (hasta ${MAX.planesEnTexto} van en texto)`);
  }

  if ('mensajeClienteActual' in d && !esTexto(d.mensajeClienteActual, 600, { vacio: true })) {
    p.push('mensajeClienteActual: texto de hasta 600 caracteres');
  }
  if ('enlaceConsola' in d && !(d.enlaceConsola === ''
      || (typeof d.enlaceConsola === 'string' && d.enlaceConsola.length <= 200 && URL_HTTPS.test(d.enlaceConsola)))) {
    p.push('enlaceConsola: vacío o una dirección https:// de hasta 200 caracteres');
  }
  if ('topeAviso' in d && !(Number.isInteger(d.topeAviso) && d.topeAviso >= 3 && d.topeAviso <= 100)) {
    p.push('topeAviso: entero de 3 a 100');
  }
  if ('plantillaAviso' in d && !(typeof d.plantillaAviso === 'string' && PLANTILLA.test(d.plantillaAviso))) {
    p.push('plantillaAviso: minúsculas, dígitos y guion bajo, 1 a 64');
  }
  return p;
}

// --- argumentos y archivo ----------------------------------------------------
const problemasArgs = [];
if (!PROYECTO) problemasArgs.push('falta --proyecto');
if (!ID_TENANT.test(TENANT)) problemasArgs.push('--tenant inválido (minúsculas, guiones, 3 a 60)');
if (!ARCHIVO) problemasArgs.push('falta --archivo');
if (problemasArgs.length) {
  console.error('\n  ✗ ' + problemasArgs.join('\n  ✗ '));
  console.error('\n  node scripts/cargar-captacion.mjs --proyecto <id> --tenant <id> --archivo <json> [--aplicar]\n');
  process.exit(2);
}

let datos;
try {
  datos = JSON.parse(readFileSync(ARCHIVO, 'utf8'));
} catch (e) {
  console.error(`\n  ✗ No se pudo leer ${ARCHIVO} como JSON: ${e.message}\n`);
  process.exit(2);
}
const problemas = validar(datos);
if (problemas.length) {
  console.error(`\n  ✗ El archivo no cumple el contrato de /config/onboarding (${problemas.length}):`);
  console.error('    - ' + problemas.join('\n    - '));
  console.error('\n  No se escribió nada.\n');
  process.exit(2);
}
const camposOnb = CAMPOS_ONBOARDING.filter((k) => k in datos);
const camposNeg = CAMPOS_NEGOCIO.filter((k) => k in datos);
if (!camposOnb.length && !camposNeg.length) {
  console.error('\n  ✗ El archivo no trae ningún campo que cargar.\n');
  process.exit(2);
}

// --- Firestore ---------------------------------------------------------------
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const refTenant = db.doc(`tenants/${TENANT}`);
const refNegocio = db.doc(`tenants/${TENANT}/config/negocio`);
const refOnb = db.doc(`tenants/${TENANT}/config/onboarding`);

// Comparación que no depende del orden de las claves: Firestore no lo conserva.
const canonico = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const igual = (a, b) => canonico(a ?? null) === canonico(b ?? null);

const resumen = {
  rubros: (v) => `${v.length}: ${v.map((r) => `${r.nombre} → ${r.flujoSugerido}`).join(' · ')}`,
  planes: (v) => `${v.length}: ${v.map((x) => `${x.nombre} USD ${x.precioUsd}/${x.periodo}`).join(' · ')}`,
  cargosUnicos: (v) => `${v.length}: ${v.map((x) => `${x.nombre} ${x.desde ? 'desde ' : ''}USD ${x.precioUsd}`).join(' · ')}`,
  aclaraciones: (v) => `${v.length}: ${v.map((x) => x.tema).join(' · ')}`,
  archivoPlanes: (v) => `${v.tipo} «${v.nombreArchivo}»`,
  mensajeClienteActual: (v) => `${v.length} caracteres`,
  enlaceConsola: (v) => v || '(vacío)',
  topeAviso: (v) => String(v),
  plantillaAviso: (v) => v,
};

console.log(`\n  Negocio   : ${TENANT}`);
console.log(`  Archivo   : ${ARCHIVO}`);
console.log(`  Proyecto  : ${PROYECTO}\n`);

let plan;
try {
  await db.runTransaction(async (tx) => {
    const [tenant, negocio, onb] = await Promise.all([tx.get(refTenant), tx.get(refNegocio), tx.get(refOnb)]);
    if (!tenant.exists) throw new Error(`No existe el comercio «${TENANT}». Primero alta-comercio.mjs.`);
    const flujos = tenant.get('flujos') ?? [tenant.get('vertical')].filter(Boolean);
    if (!flujos.includes('onboarding')) {
      throw new Error(`«${TENANT}» no tiene el flujo onboarding (flujos: ${JSON.stringify(flujos)}). `
        + 'La captación se carga solo en un comercio con ese flujo.');
    }
    // Como las reglas: un comercio suspendido o dado de baja no se reconfigura.
    const estado = tenant.get('estado') ?? 'activo';
    if (estado !== 'activo') throw new Error(`«${TENANT}» está ${estado}: no se reconfigura.`);

    const actual = onb.exists ? onb.data() : {};
    plan = {
      onbNuevo: !onb.exists,
      negocio: camposNeg.map((k) => ({ k, antes: negocio.get(k) ?? null, despues: datos[k] })),
      campos: camposOnb.map((k) => ({
        k, estado: !(k in actual) ? 'nuevo' : igual(actual[k], datos[k]) ? 'igual' : 'cambia',
      })),
      archivoHuerfano: 'archivoPlanes' in actual && !('archivoPlanes' in datos)
        && (datos.planes ?? actual.planes ?? []).length <= MAX.planesEnTexto,
    };
    if (!APLICAR) return;

    const ahora = Timestamp.now();
    const sello = { actualizadoPor: 'cargar-captacion', actualizadoEn: ahora };
    if (camposNeg.length) {
      const comunes = Object.fromEntries(camposNeg.map((k) => [k, datos[k]]));
      tx.set(refNegocio, { ...comunes, ...sello }, { merge: true });
    }
    if (camposOnb.length) {
      const escribir = Object.fromEntries(camposOnb.map((k) => [k, datos[k]]));
      tx.set(refOnb, { ...escribir, ...sello }, { mergeFields: [...camposOnb, 'actualizadoPor', 'actualizadoEn'] });
    }
    tx.create(db.collection(`tenants/${TENANT}/auditoria`).doc(), {
      accion: 'cargar_captacion', uid: 'cargar-captacion', en: ahora,
      campos: [...camposNeg, ...camposOnb],
      conteos: Object.fromEntries(['rubros', 'planes', 'cargosUnicos', 'aclaraciones']
        .filter((k) => k in datos).map((k) => [k, datos[k].length])),
    });
  });
} catch (e) {
  console.error(`  ✗ ${e.message}\n`);
  process.exit(1);
}

for (const { k, antes, despues } of plan.negocio) {
  console.log(`  config/negocio.${k.padEnd(16)}: ${antes === despues ? `igual («${despues}»)` : `«${antes ?? '—'}» → «${despues}»`}`);
}
console.log(`  config/onboarding${plan.onbNuevo ? ' (se crea)' : ''}:`);
for (const { k, estado } of plan.campos) {
  console.log(`    ${estado.padEnd(6)} ${k.padEnd(20)} ${resumen[k](datos[k])}`);
}
if (plan.archivoHuerfano) {
  console.log('  ! config/onboarding ya tiene archivoPlanes y este archivo no lo trae: queda como está.');
}
const sinCambios = plan.campos.every((c) => c.estado === 'igual') && plan.negocio.every((c) => c.antes === c.despues);
if (sinCambios) console.log('\n  Sin cambios de contenido (se renovaría solo el sello).');

if (!APLICAR) {
  console.log('\n  Seco: no se escribió nada. Agrega --aplicar.\n');
  process.exit(0);
}

// --- verificación por relectura ---------------------------------------------
const [negocio, onb] = await Promise.all([refNegocio.get(), refOnb.get()]);
const fallas = [
  ...camposNeg.filter((k) => negocio.get(k) !== datos[k]),
  ...camposOnb.filter((k) => !igual(onb.get(k), datos[k])),
  ...(onb.get('actualizadoPor') === 'cargar-captacion' ? [] : ['sello']),
];
console.log(`\n  ${fallas.length ? '✗' : '✓'} Verificación: ${fallas.length
  ? `no coincide ${fallas.join(', ')}` : `${camposOnb.length} campo(s) de captación y ${camposNeg.length} común(es) releídos`}\n`);
if (fallas.length) process.exit(1);
