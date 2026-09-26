#!/usr/bin/env node
/**
 * EL ENSAYO: probar el cambio de un cliente en un número de DEMOSTRACIÓN antes
 * de que llegue a su número de verdad (Andres, 21/09/2026).
 *
 * POR QUÉ EXISTE. Hasta hoy un cambio pedido por un cliente se probaba en su
 * propio número: con sus pacientes escribiendo, con su agenda real y con su
 * recepción recibiendo los avisos de las pruebas. Con Platinum en producción en
 * su propia WABA eso deja de ser aceptable.
 *
 * CÓMO. Un comercio aparte, `ensayo`, que existe solo para esto. Mientras dura
 * el ensayo, la ruta del número de un DEMO (el del Demo A) apunta a `ensayo` en
 * vez de a su comercio de siempre, así que:
 *   - lo que el flujo lee (prompt, catálogo, agendas, seña) sale de `ensayo`,
 *     que tiene la configuración PROPUESTA del cliente;
 *   - lo que escribe (conversaciones, conteos) cae en `ensayo`, no en el demo
 *     ni en el cliente;
 *   - la configuración del demo NO se toca: volver es cambiar la ruta de nuevo.
 * El flujo del cliente se publica sobre el del demo con `scripts/ensayo-flujo.sh`.
 * El procedimiento completo está en `docs/ensayo/LEEME.md`.
 *
 * LOS DATOS SENSIBLES DEL CLIENTE NO VIAJAN. El archivo del cliente nombra su
 * recepción y sus calendarios por marcador; acá se cambian por los marcadores
 * del ensayo antes de cargar:
 *   REEMPLAZAR_NUMERO_*_<CLIENTE>       -> REEMPLAZAR_NUMERO_RECEPCION_ENSAYO
 *   REEMPLAZAR_CALENDARIO_<CLIENTE>_<n> -> REEMPLAZAR_CALENDARIO_ENSAYO_<i>
 * (i = orden de aparición). Esas filas viven en `CONFIGURACION.local.md` y
 * apuntan al teléfono de quien prueba y a calendarios de prueba de NovuChat:
 * un ensayo NUNCA agenda en la agenda del cliente ni avisa a su recepción.
 *
 * LOS CERROJOS, que se prueban negando (`pruebas/ensayo.test.ts`):
 *   - solo se desvía el número de un comercio con `modalidad: 'demostracion'`
 *     EXPLÍCITA en su cuenta (desde F1 el plan no dice si es un demo): nunca
 *     el de un cliente que paga, ni el de uno sin modalidad cargada;
 *   - el único comercio que se vacía y se recarga es `ensayo`, escrito en el
 *     código;
 *   - la ruta recuerda de dónde vino (`ensayoDe`) y `--restaurar` vuelve solo
 *     ahí;
 *   - sin `--aplicar` no escribe nada.
 *
 *   node scripts/ensayo.mjs --proyecto <id> --numero <phone id del demo> --estado
 *   node scripts/ensayo.mjs --proyecto <id> --numero <phone id del demo> --preparar \
 *     --cliente platinum --archivo scripts/datos/negocio-platinum.json \
 *     --local <ruta a CONFIGURACION.local.md> [--aplicar]
 *   node scripts/ensayo.mjs --proyecto <id> --numero <phone id del demo> --restaurar [--aplicar]
 *
 * Nunca imprime identificadores completos ni valores de la tabla local.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ENSAYO = 'ensayo';
const aqui = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const MODO = ['--preparar', '--restaurar', '--estado'].filter((m) => args.includes(m));
const PROYECTO = opcion('proyecto');
const NUMERO = (opcion('numero') ?? '').trim();
const CLIENTE = (opcion('cliente') ?? '').trim().toLowerCase();
const ARCHIVO = opcion('archivo');
const LOCAL = opcion('local');

const cola = (v) => (v ? `…${String(v).slice(-4)}` : '—');
const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!/^[0-9]{6,25}$/.test(NUMERO)) problemas.push('--numero no es un phone_number_id');
if (MODO.length !== 1) problemas.push('elija UNO: --preparar, --restaurar o --estado');
if (MODO[0] === '--preparar') {
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(CLIENTE)) problemas.push('--cliente inválido');
  if (CLIENTE === ENSAYO) problemas.push('--cliente no puede ser el propio ensayo');
  if (!ARCHIVO) problemas.push('falta --archivo (el JSON del cliente, con los cambios a probar)');
}
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ ') + '\n');
  process.exit(2);
}

/**
 * Cambia los marcadores del cliente por los del ensayo. Pura: la prueba la
 * llama con un objeto y mira el resultado.
 */
function aMarcadoresDeEnsayo(datos, cliente) {
  const sufijo = cliente.toUpperCase().replace(/-/g, '_');
  const calendarios = new Map();
  const texto = JSON.stringify(datos, (clave, valor) => {
    if (typeof valor !== 'string' || !valor.startsWith('REEMPLAZAR_')) return valor;
    // Comparación de texto y no una expresión armada con el argumento: el
    // nombre del cliente llega por la línea de comandos (CodeQL, #148).
    if (valor.startsWith('REEMPLAZAR_NUMERO_') && valor.endsWith(`_${sufijo}`)
      && /^[A-Z_]*$/.test(valor.slice('REEMPLAZAR_NUMERO_'.length, -sufijo.length - 1))) {
      return 'REEMPLAZAR_NUMERO_RECEPCION_ENSAYO';
    }
    const cal = `REEMPLAZAR_CALENDARIO_${sufijo}`;
    if (valor.startsWith(cal) && /^(_[0-9]+)?$/.test(valor.slice(cal.length))) {
      if (!calendarios.has(valor)) calendarios.set(valor, `REEMPLAZAR_CALENDARIO_ENSAYO_${calendarios.size + 1}`);
      return calendarios.get(valor);
    }
    return valor;
  });
  return JSON.parse(texto);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const salir = async (codigo) => { await db.terminate().catch(() => {}); process.exit(codigo); };

const refRuta = db.doc(`rutasWhatsApp/${NUMERO}`);
const ruta = await refRuta.get();
if (!ruta.exists) { console.error(`\n  ✗ El número ${cola(NUMERO)} no tiene ruta.\n`); await salir(1); }
const actual = String(ruta.get('tenantId') ?? '');
const origen = String(ruta.get('ensayoDe') ?? '');

console.log(`\n  Número    : ${cola(NUMERO)} · alias ${ruta.get('aliasSecreto') ?? '?'} · flujo ${ruta.get('flujo') ?? '?'}`);
console.log(`  Apunta a  : ${actual}${origen ? ` (en ensayo; su comercio es ${origen}, cliente ${ruta.get('ensayoCliente') ?? '?'})` : ''}`);

if (MODO[0] === '--estado') await salir(0);

// ---------------------------------------------------------------- restaurar --
if (MODO[0] === '--restaurar') {
  if (actual !== ENSAYO || !origen) {
    console.log('\n  No está en ensayo: no hay nada que restaurar.\n');
    await salir(0);
  }
  console.log(`  Vuelve a  : ${origen}`);
  if (!APLICAR) { console.log('\n  Seco: no se escribió nada. Agregue --aplicar.\n'); await salir(0); }
  await refRuta.update({
    tenantId: origen, ensayoDe: FieldValue.delete(), ensayoCliente: FieldValue.delete(),
    ensayoDesde: FieldValue.delete(),
  });
  await db.collection(`tenants/${origen}/auditoria`).add({
    accion: 'ensayo_terminado', uid: 'ensayo', en: Timestamp.now(), phoneNumberId: NUMERO,
  });
  const ok = (await refRuta.get()).get('tenantId') === origen;
  console.log(`\n  ${ok ? '✓' : '✗'} La ruta apunta otra vez a ${origen}.`);
  console.log('  Falta el flujo: scripts/ensayo-flujo.sh --restaurar.\n');
  await salir(ok ? 0 : 1);
}

// ----------------------------------------------------------------- preparar --
// 1. Solo un número de DEMOSTRACIÓN. Si ya está en ensayo, su origen se conserva.
const comercioDeOrigen = actual === ENSAYO ? origen : actual;
if (!comercioDeOrigen) { console.error('\n  ✗ La ruta está en ensayo sin origen anotado: revisar a mano.\n'); await salir(1); }
// La modalidad tiene que estar ESCRITA: «sin modalidad» rige como demostración
// para el prepago, pero acá se va a desviar un número, y ante la duda no.
const [fichaOrigen, cuentaOrigen] = await Promise.all([
  db.doc(`tenants/${comercioDeOrigen}`).get(), db.doc(`tenants/${comercioDeOrigen}/cuenta/estado`).get(),
]);
if (!fichaOrigen.exists || cuentaOrigen.get('modalidad') !== 'demostracion') {
  console.error(`\n  ✗ ${comercioDeOrigen} no es un comercio de demostración (modalidad ${cuentaOrigen.get('modalidad') ?? 'sin cargar'}): su número no se usa para ensayar.\n`);
  await salir(1);
}
if (ruta.get('estado') && ruta.get('estado') !== 'activo') {
  console.error(`\n  ✗ La ruta está ${ruta.get('estado')}: el flujo no respondería.\n`);
  await salir(1);
}

// 2. El archivo del cliente, con los marcadores del ensayo.
let datos;
try { datos = JSON.parse(readFileSync(ARCHIVO, 'utf8')); } catch (e) {
  console.error(`\n  ✗ No se pudo leer ${ARCHIVO}: ${e instanceof Error ? e.message : e}\n`); await salir(2);
}
const flujoCliente = String(ruta.get('flujo') ?? 'agendamiento');
const ensayado = aMarcadoresDeEnsayo(datos, CLIENTE);
ensayado._fuente = `ensayo de ${CLIENTE}, desde ${ARCHIVO}`;
const marcadores = [...new Set(JSON.stringify(ensayado).match(/REEMPLAZAR_[A-Z0-9_]+/g) ?? [])];
console.log(`  Cliente   : ${CLIENTE} · archivo ${ARCHIVO}`);
console.log(`  Marcadores: ${marcadores.join(', ') || 'ninguno'}`);
const sinTraducir = marcadores.filter((m) => !m.endsWith('_ENSAYO') && !/_ENSAYO_[0-9]+$/.test(m)
  && !m.startsWith('REEMPLAZAR_HORARIO_'));
if (sinTraducir.length) {
  console.error(`\n  ✗ Estos marcadores no son del ensayo y apuntarían a datos del cliente: ${sinTraducir.join(', ')}\n`);
  await salir(1);
}

// 3. El comercio `ensayo`: se crea si falta; si existe, se vacía lo que carga
//    un archivo de negocio (config, catálogo, funcionarios y su contador). Es
//    el ÚNICO comercio que este script vacía, y está escrito arriba.
const refEnsayo = db.doc(`tenants/${ENSAYO}`);
const fichaEnsayo = await refEnsayo.get();
const colecciones = ['catalogo', 'funcionarios'];
const aBorrar = [];
if (fichaEnsayo.exists) {
  for (const c of colecciones) aBorrar.push(...(await db.collection(`tenants/${ENSAYO}/${c}`).select().get()).docs.map((d) => d.ref));
  for (const d of ['config/negocio', 'config/agendamiento', 'config/venta', 'contadores/catalogo']) aBorrar.push(db.doc(`tenants/${ENSAYO}/${d}`));
}
console.log(`  Ensayo    : ${fichaEnsayo.exists ? `existe; se vacían ${aBorrar.length} documento(s) antes de cargar` : 'se crea'}`);
console.log(`  Ruta      : ${actual} -> ${ENSAYO}`);

if (!APLICAR) {
  console.log('\n  Seco: no se escribió nada. La carga se muestra con cargar-negocio en seco:');
}

if (APLICAR) {
  if (!fichaEnsayo.exists) {
    // El comercio del ensayo es un demo de NovuChat: modalidad demostración
    // (nunca se corta, sin cargo) con los límites de Pro, porque carga el
    // catálogo entero del cliente que se ensaya (`cargar-negocio.mjs` respeta
    // `limites.productos`). `plan: 'demostracion'` ya no existe (F1).
    const { CATALOGO_PLANES, limitesDe } = await import('../functions/src/planes.ts');
    await refEnsayo.set({
      nombre: 'Ensayo de NovuChat', estado: 'activo', vertical: flujoCliente, flujos: [flujoCliente],
      plan: 'pro', creadoPor: 'ensayo', creadoEn: Timestamp.now(),
    });
    await db.doc(`tenants/${ENSAYO}/cuenta/estado`).set({
      plan: 'pro', limites: limitesDe('pro'), catalogoPlanes: CATALOGO_PLANES, modalidad: 'demostracion',
      estadoPago: 'sin_cargo', montoMensual: 0, moneda: 'USD', actualizadoEn: Timestamp.now(),
    }, { merge: true });
  } else {
    await refEnsayo.update({ estado: 'activo', vertical: flujoCliente, flujos: FieldValue.arrayUnion(flujoCliente) });
    for (let i = 0; i < aBorrar.length; i += 400) {
      const lote = db.batch();
      for (const r of aBorrar.slice(i, i + 400)) lote.delete(r);
      await lote.commit();
    }
  }
}

if (!APLICAR && !fichaEnsayo.exists) {
  console.log('  (el comercio `ensayo` todavía no existe: la carga en seco se ve después de crearlo con --aplicar)\n');
  await salir(0);
}

// 4. La carga, con el MISMO script que carga a los clientes: mismas
//    validaciones que las reglas, mismo contador de catálogo, misma capa de
//    patrones para las instrucciones. En seco, su seco.
const tmp = mkdtempSync(join(tmpdir(), 'ensayo-'));
const archivoTmp = join(tmp, `negocio-ensayo-${CLIENTE}.json`);
writeFileSync(archivoTmp, JSON.stringify(ensayado, null, 2));
const carga = spawnSync(process.execPath, [join(aqui, 'cargar-negocio.mjs'), '--proyecto', PROYECTO,
  '--tenant', ENSAYO, '--archivo', archivoTmp, ...(LOCAL ? ['--local', LOCAL] : []), ...(APLICAR ? ['--aplicar'] : [])],
  { env: process.env, encoding: 'utf8' });
rmSync(tmp, { recursive: true, force: true });
process.stdout.write((carga.stdout ?? '').split('\n').map((l) => `    ${l}`).join('\n'));
process.stderr.write(carga.stderr ?? '');
if (carga.status !== 0) {
  console.error(`\n  ✗ La carga falló${APLICAR ? '; la ruta NO se cambió' : ''}.\n`);
  await salir(1);
}
if (!APLICAR) { console.log('\n  Seco: no se escribió nada. Agregue --aplicar.\n'); await salir(0); }

// 5. Recién con la carga hecha, la ruta: el demo empieza a responder como el cliente.
await refRuta.update({
  tenantId: ENSAYO, ensayoDe: comercioDeOrigen, ensayoCliente: CLIENTE, ensayoDesde: Timestamp.now(),
});
await db.collection(`tenants/${ENSAYO}/auditoria`).add({
  accion: 'ensayo_preparado', uid: 'ensayo', en: Timestamp.now(), phoneNumberId: NUMERO,
  cliente: CLIENTE, ensayoDe: comercioDeOrigen,
});
const ok = (await refRuta.get()).get('tenantId') === ENSAYO;
console.log(`\n  ${ok ? '✓' : '✗'} El número ${cola(NUMERO)} responde como ${CLIENTE}, con los datos del ensayo.`);
console.log('  Falta el flujo: scripts/ensayo-flujo.sh. Para volver: --restaurar.\n');
await salir(ok ? 0 : 1);
