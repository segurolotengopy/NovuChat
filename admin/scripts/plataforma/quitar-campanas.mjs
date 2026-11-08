#!/usr/bin/env node
/**
 * QUITAR CAMPAÑAS NOMBRADAS DE `tenants/<t>/config/campanas.lista`, EN SECO POR DEFECTO.
 *
 * POR QUÉ. Rubén cambió de libro («Noches Sin Insomnio»): sus campañas del libro anterior (08/11/2026) quedaron en la lista
 * aunque ya no viajan al flujo. Andres decidió quitarlas. Solo quita los ids NOMBRADOS y presentes en la lista cerrada de abajo;
 * conserva las demás campañas tal cual. El servidor recalcula `vigentes` y `revision` con la propia escritura.
 *
 *   node scripts/plataforma/quitar-campanas.mjs --proyecto <id> --tenant rroca-ruben --ids a,b
 *        [--aplicar --respaldo <ruta absoluta que no exista> --confirmo-produccion rroca-ruben]
 *
 * El respaldo (0600) guarda las entradas quitadas completas, para poder restaurarlas. Salida: 0 hecho o seco, 2 uso, 3 error.
 */
import { writeFileSync, existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const PERMITIDOS = { 'rroca-ruben': ['asistente-de-negocio', 'usando-la-ia-realmente', 'que-publicar', 'tiempo-automatizar', 'chatgpt-sin-saber-usarlo'] };
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const IDS = (opcion('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const APLICAR = args.includes('--aplicar');
const RESPALDO = opcion('respaldo');
const CONFIRMO = opcion('confirmo-produccion');

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!PERMITIDOS[TENANT]) problemas.push('--tenant fuera de la lista cerrada');
if (!IDS.length) problemas.push('falta --ids');
for (const id of IDS) if (!(PERMITIDOS[TENANT] ?? []).includes(id)) problemas.push(`id fuera de la lista cerrada: ${id.slice(0, 40)}`);
if (APLICAR && CONFIRMO !== TENANT) problemas.push('--aplicar exige --confirmo-produccion igual a --tenant');
if (APLICAR && (!RESPALDO || !isAbsolute(RESPALDO) || existsSync(RESPALDO))) problemas.push('--aplicar exige --respaldo con ruta absoluta que no exista');
if (problemas.length) { console.error(`\n  ✗ ${problemas.join('\n  ✗ ')}\n`); process.exit(2); }

try {
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: PROYECTO });
  const db = getFirestore();
  const ref = db.doc(`tenants/${TENANT}/config/campanas`);
  const resultado = await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const lista = Array.isArray(doc.get('lista')) ? doc.get('lista') : [];
    const quitar = lista.filter((a) => IDS.includes(a?.id));
    const quedan = lista.filter((a) => !IDS.includes(a?.id));
    console.log(`  en la lista: ${lista.length} · se quitan: ${quitar.map((a) => a.id).join(', ') || '(ninguna)'} · quedan: ${quedan.map((a) => a.id).join(', ')}`);
    if (!APLICAR || !quitar.length) return { quitar, quedan, escrito: false };
    writeFileSync(RESPALDO, JSON.stringify({ tenant: TENANT, quitadas: quitar }) + '\n', { mode: 0o600, flag: 'wx' });
    tx.update(ref, { lista: quedan, actualizadoPor: 'quitar-campanas', actualizadoEn: new Date() });
    return { quitar, quedan, escrito: true };
  });
  if (!resultado.escrito) { console.log(APLICAR ? '  (nada que quitar)' : '  (seco: no se escribió nada)'); process.exit(0); }
  const despues = (await ref.get()).get('lista') ?? [];
  if (despues.some((a) => IDS.includes(a?.id)) || despues.length !== resultado.quedan.length) { console.error('  ✗ la relectura no coincide'); process.exit(3); }
  console.log(`  ✓ quitadas ${resultado.quitar.length}; quedan ${despues.length} (respaldo en ${RESPALDO})`);
  process.exit(0);
} catch (e) {
  console.error(`  ✗ ${e.message}`);
  process.exit(3);
}
