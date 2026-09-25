/**
 * FIJAR EL TIPO DE CAMBIO DEL DÍA, EN SECO POR DEFECTO.
 *
 * POR QUÉ EXISTE (`CLAUDE.md`, base comercial §3; `DISENO.md` §4undecies.8,
 * fila 2). NovuChat cobra en bolivianos al Tipo de Cambio Oficial que publica
 * el BCB, con el TCO DEL DÍA en que se emite el cobro, y NO publica un tipo de
 * cambio propio. El valor vive en UN documento, `plataforma/tipoCambio
 * { tco, fecha, fuente }`, que ninguna pantalla puede escribir (las reglas
 * de `/plataforma` solo dejan leer al propietario) y que lee `tipoCambio.ts`
 * al emitir un cobro y `cobranza.ts` al armar un recordatorio con importe.
 *
 * SIN ESTE DOCUMENTO NO SE COBRA: `tipoCambioDelDia` lanza si falta, si está
 * fuera de 5..40 o si tiene más de 4 días (el BCB no publica los fines de
 * semana). Cobrar con un TCO supuesto es peor que no poder cobrar.
 *
 * QUÉ HACE, con la misma validación que el servidor (`esTipoCambio` y
 * `tipoCambioVigente` del módulo compilado):
 *   - rechaza un TCO fuera de la cota de cordura, una fecha mal formada,
 *     futura o de más de 4 días atrás (un TCO viejo no sirve para emitir);
 *   - muestra el valor actual y el nuevo;
 *   - con `--aplicar`: escribe `plataforma/tipoCambio` y una entrada en
 *     `plataforma/tipoCambio/historial` con quién y cuándo, y verifica por
 *     relectura.
 *
 * DESDE EL 25/09/2026 LA CARGA DIARIA ES AUTOMÁTICA: `tipoCambioBcb` lee la
 * tabla del BCB tres veces al día y escribe si hay un TCO nuevo, válido y sin
 * un salto de más del 5 %. Este script queda para CORREGIR a mano --un salto
 * que la Function no escribe sola, una página del BCB caída varios días--:
 * el valor lo lee una persona, lo carga con su nombre en `--por`, con el OK de
 * Andres en el chat, y NUNCA sin `--aplicar` explícito. La Function no pisa
 * una carga manual con la misma fecha o posterior.
 *
 * EL MÓDULO SE IMPORTA COMPILADO (`functions/lib/prepago.js`): antes de
 * correrlo, `pnpm functions:build`.
 *
 *   node scripts/fijar-tipo-cambio.mjs --proyecto <id> --tco 12.60 --fecha 2026-09-21 --por andres
 *   node scripts/fijar-tipo-cambio.mjs --proyecto <id> --tco 12.60 --fecha 2026-09-21 --por andres --aplicar
 *
 * `--fuente` es `BCB` salvo que se diga otra cosa. Sin `--aplicar` no
 * escribe nada: dice qué haría.
 */
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');

const PROYECTO = opcion('proyecto');
const TCO = Number(opcion('tco'));
const FECHA = (opcion('fecha') ?? '').trim();
const FUENTE = (opcion('fuente') ?? 'BCB').trim();
const POR = (opcion('por') ?? '').trim().slice(0, 40);

let prepago;
try {
  prepago = await import('../functions/lib/prepago.js');
} catch {
  console.error('\n  ✗ No se encuentra functions/lib/prepago.js. Compile primero: pnpm functions:build\n');
  process.exit(2);
}
const { TCO_DIAS_VIGENCIA, TCO_MAXIMO, TCO_MINIMO, esFecha, esTipoCambio, tipoCambioVigente } = prepago;

const nuevo = { tco: TCO, fecha: FECHA, fuente: FUENTE };
const ahoraMs = Date.now();
const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!Number.isFinite(TCO) || TCO < TCO_MINIMO || TCO > TCO_MAXIMO) problemas.push(`--tco tiene que ser un número entre ${TCO_MINIMO} y ${TCO_MAXIMO} (bolivianos por dólar)`);
if (!esFecha(FECHA)) problemas.push('--fecha tiene que ser aaaa-mm-dd (el día del TCO según el BCB)');
if (!FUENTE) problemas.push('--fuente no puede estar vacía');
if (!/^[a-z0-9._-]{2,40}$/i.test(POR)) problemas.push('--por es obligatorio: quién lo carga (letras, números, ., _, -)');
if (problemas.length === 0 && !esTipoCambio(nuevo)) problemas.push('el tipo de cambio no pasa la validación del servidor');
if (problemas.length === 0 && !tipoCambioVigente(nuevo, ahoraMs)) {
  problemas.push(`--fecha es futura o tiene más de ${TCO_DIAS_VIGENCIA} días: un TCO así no sirve para emitir cobros`);
}
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/fijar-tipo-cambio.mjs --proyecto <id> --tco <bs por usd> --fecha aaaa-mm-dd --por <quien> [--fuente BCB] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const ref = db.doc('plataforma/tipoCambio');
const actual = (await ref.get()).data() ?? null;

console.log(`\n  Proyecto   : ${PROYECTO}`);
console.log(`  Actual     : ${actual ? `${actual.tco} Bs/USD · ${actual.fecha} · ${actual.fuente}${tipoCambioVigente(actual, ahoraMs) ? '' : ' (VENCIDO)'}` : '(no hay tipo de cambio cargado)'}`);
console.log(`  Nuevo      : ${nuevo.tco} Bs/USD · ${nuevo.fecha} · ${nuevo.fuente} · carga ${POR}`);
if (actual && esFecha(actual.fecha) && actual.fecha > nuevo.fecha) {
  console.log('  Aviso      : la fecha nueva es ANTERIOR a la cargada. Se escribe igual si se aplica; revise que sea a propósito.');
}

if (!APLICAR) { console.log('\n  Seco: no se escribió nada. Agregue --aplicar (con el OK de Andres).\n'); process.exit(0); }

const ahora = Timestamp.now();
const lote = db.batch();
// El documento lo lee cualquier sesión (la pantalla «Pagar»): lleva el TCO y
// cuándo se cargó, no QUIÉN. Eso va al historial, que solo lee el propietario.
lote.set(ref, { ...nuevo, actualizadoEn: ahora });
lote.create(ref.collection('historial').doc(), { ...nuevo, en: ahora, por: POR, antes: actual ? { tco: actual.tco ?? null, fecha: actual.fecha ?? null } : null });
await lote.commit();

const releido = (await ref.get()).data() ?? {};
const ok = releido.tco === nuevo.tco && releido.fecha === nuevo.fecha && releido.fuente === nuevo.fuente;
console.log(`\n  ${ok ? '✓' : '✗'} Verificación: ${releido.tco} Bs/USD · ${releido.fecha} · ${releido.fuente}\n`);
if (!ok) process.exit(1);
