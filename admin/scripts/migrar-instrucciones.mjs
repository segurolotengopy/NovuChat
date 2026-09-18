/**
 * MIGRAR EL COMPORTAMIENTO GENERAL AL CONTRATO DEL 17/09/2026.
 *
 * POR QUÉ EXISTE. Desde el 17/09 el flujo lee `config/negocio.instruccionesVigentes`
 * y no `instruccionesExtra` (`functions/src/comportamiento.ts`). Los comercios
 * dados de alta antes tienen texto en `instruccionesExtra` —cargado por
 * NovuChat con `cargar-negocio.mjs` o escrito en la consola— y NADA en
 * `instruccionesVigentes`. Sin esta migración, al desplegar `configuracionFlujo`
 * el asistente de Clínica Platinum se quedaría sin sus precios, objeciones y
 * prohibiciones clínicas, en silencio.
 *
 * QUÉ HACE. Para cada tenant con `instruccionesExtra` no vacío y SIN
 * `instruccionesVigentes`, copia el propuesto a vigente y deja la revisión
 * aprobada:
 *
 *   instruccionesRevision = { estado: 'aprobado',
 *                             motivo: 'migración 17/09: texto cargado por NovuChat',
 *                             hash, capa: 'patrones', revisadoPor: 'migrar-instrucciones',
 *                             revisadoEn }
 *
 * y una entrada en `auditoria` (`migrar_instrucciones`). Los que ya tienen
 * vigente, o no tienen texto, no se tocan. El texto NO se muestra: solo el
 * comercio y la cantidad de caracteres.
 *
 * AVISA, PERO NO NIEGA, cuando el texto no pasaría la capa de patrones de la
 * Function: ese texto ya rige hoy y lo revisó NovuChat, así que se migra; pero
 * la próxima vez que el comercio lo edite desde la consola la verificación lo
 * va a rechazar por ese carácter o esa palabra, y conviene corregirlo antes
 * (Platinum tenía comillas angulares en «cuánto dura»; el JSON versionado ya
 * no las lleva).
 *
 *   node scripts/migrar-instrucciones.mjs --proyecto <id>            # seco
 *   node scripts/migrar-instrucciones.mjs --proyecto <id> --aplicar  # escribe
 *
 * Sin `--aplicar` no escribe nada: dice qué haría.
 */
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const PROYECTO = opcion('proyecto');

const rojo = (s) => `\x1b[1;31m${s}\x1b[0m`;

if (!PROYECTO) {
  console.error('\n  ✗ falta --proyecto');
  console.error('\n  node scripts/migrar-instrucciones.mjs --proyecto <id> [--aplicar]\n');
  process.exit(2);
}

const { hashCorto, verificarPatrones } = await import('../functions/src/comportamiento.ts');
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const salir = async (codigo) => { await db.terminate().catch(() => {}); process.exit(codigo); };

const MOTIVO = 'migración 17/09: texto cargado por NovuChat';
const REVISOR = 'migrar-instrucciones';

console.log(`\n  Proyecto : ${PROYECTO}`);
console.log(`  Modo     : ${APLICAR ? 'APLICAR' : 'seco'}\n`);

const tenants = await db.collection('tenants').select('nombre', 'estado').get();
const plan = [];
let yaMigrados = 0;
let sinTexto = 0;
for (const t of tenants.docs) {
  const doc = await db.doc(`tenants/${t.id}/config/negocio`).get();
  const propuesto = doc.get('instruccionesExtra');
  const vigente = doc.get('instruccionesVigentes');
  if (typeof propuesto !== 'string' || propuesto.trim() === '') { sinTexto++; continue; }
  if (typeof vigente === 'string') { yaMigrados++; continue; }
  plan.push({ id: t.id, estado: t.get('estado') ?? '?', propuesto, patrones: verificarPatrones(propuesto) });
}

console.log(`  Comercios: ${tenants.size} · sin texto: ${sinTexto} · ya con vigente: ${yaMigrados} · a migrar: ${plan.length}`);
for (const p of plan) {
  console.log(`\n    ${p.id.padEnd(30)} ${p.estado.padEnd(12)} ${p.propuesto.length} caracteres · hash ${hashCorto(p.propuesto)}`);
  if (p.patrones.nivel === 'rechazado') {
    console.log(`      ${rojo('⚠')} la capa de patrones lo rechazaría (${p.patrones.motivo}): se migra igual porque ya rige,`);
    console.log('        pero la próxima edición desde la consola será rechazada hasta corregirlo.');
  } else if (p.patrones.nivel === 'dudoso') {
    console.log(`      · ${p.patrones.motivo}`);
  }
}

if (!APLICAR) {
  console.log(`\n  Seco: no se escribió nada.${plan.length ? ' Agregue --aplicar.' : ''}\n`);
  await salir(0);
}

const fallas = [];
for (const p of plan) {
  const ref = db.doc(`tenants/${p.id}/config/negocio`);
  const ahora = Timestamp.now();
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    // Por si algo escribió en el medio: se migra lo que se leyó, no otra cosa.
    if (doc.get('instruccionesExtra') !== p.propuesto || typeof doc.get('instruccionesVigentes') === 'string') return;
    tx.update(ref, {
      instruccionesVigentes: p.propuesto,
      instruccionesRevision: {
        estado: 'aprobado', motivo: MOTIVO, hash: hashCorto(p.propuesto), capa: 'patrones',
        revisadoPor: REVISOR, revisadoEn: ahora,
      },
    });
    tx.create(db.collection(`tenants/${p.id}/auditoria`).doc(), {
      accion: 'migrar_instrucciones', uid: REVISOR, en: ahora,
      estado: 'aprobado', hash: hashCorto(p.propuesto), caracteres: p.propuesto.length, motivo: MOTIVO,
    });
  });
  // Relectura como evidencia.
  const doc = await ref.get();
  const rev = doc.get('instruccionesRevision') ?? {};
  if (doc.get('instruccionesVigentes') !== p.propuesto || rev.estado !== 'aprobado' || rev.hash !== hashCorto(p.propuesto)) {
    fallas.push(p.id);
  }
}
console.log(`\n  ${fallas.length ? '✗' : '✓'} Verificación: ${fallas.length ? `no coincide ${fallas.join(', ')}` : `releídos ${plan.length} comercio(s), vigente = propuesto y revisión aprobada`}\n`);
await salir(fallas.length ? 1 : 0);
