#!/usr/bin/env node
/**
 * RENOMBRAR UN COMERCIO (ficha `tenants/<t>.nombre`), EN SECO POR DEFECTO.
 *
 * POR QUÉ EXISTE. El nombre que muestra la consola en el selector de comercios sale de `tenants/<t>.nombre`
 * (`ListaDeCuentas.tsx`). El alta lo fija con `--nombre`; cargar el negocio (`config/negocio.nombreNegocio`) NO lo
 * toca, y por eso un comercio puede conservar el nombre de un producto anterior (caso Rubén, 08/11/2026).
 *
 * QUÉ HACE. Cambia SOLO ese campo (un `update` de `nombre`), con el valor anterior guardado en un respaldo de
 * una línea y relectura. No toca config, flujos, ni el nombre visible del número de WhatsApp (eso es de Meta).
 *
 *   node scripts/plataforma/renombrar-comercio.mjs --proyecto <id> --tenant <id> --nombre "<nuevo>"
 *        [--aplicar --respaldo <ruta absoluta> --confirmo-produccion <tenant>]
 *
 * `--aplicar` exige `--confirmo-produccion` igual a `--tenant` y `--respaldo` (ruta absoluta que no exista).
 * Salida: 0 hecho (o seco bien), 2 uso o salvaguarda, 3 error de ejecución.
 */
import { writeFileSync, existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const NOMBRE = (opcion('nombre') ?? '').trim();
const APLICAR = args.includes('--aplicar');
const RESPALDO = opcion('respaldo');
const CONFIRMO = opcion('confirmo-produccion');

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(TENANT)) problemas.push('--tenant inválido');
if (NOMBRE.length < 3 || NOMBRE.length > 80 || /[\u0000-\u001f<>‪-‮⁦-⁩]/.test(NOMBRE)) problemas.push('--nombre debe tener de 3 a 80 caracteres, sin controles ni < >');
if (APLICAR && CONFIRMO !== TENANT) problemas.push('--aplicar exige --confirmo-produccion igual a --tenant');
if (APLICAR && (!RESPALDO || !isAbsolute(RESPALDO) || existsSync(RESPALDO))) problemas.push('--aplicar exige --respaldo con ruta absoluta que no exista');
if (problemas.length) { console.error(`\n  ✗ ${problemas.join('\n  ✗ ')}\n`); process.exit(2); }

try {
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: PROYECTO });
  const db = getFirestore();
  const ref = db.doc(`tenants/${TENANT}`);
  const antes = await ref.get();
  if (!antes.exists) { console.error('  ✗ el comercio no existe'); process.exit(2); }
  const anterior = antes.data().nombre ?? null;
  console.log(`  nombre actual : ${JSON.stringify(anterior)}`);
  console.log(`  nombre nuevo  : ${JSON.stringify(NOMBRE)}`);
  if (!APLICAR) { console.log('  (seco: no se escribió nada)'); process.exit(0); }
  writeFileSync(RESPALDO, JSON.stringify({ tenant: TENANT, nombreAnterior: anterior }) + '\n', { mode: 0o600, flag: 'wx' });
  await ref.update({ nombre: NOMBRE });
  const despues = (await ref.get()).data().nombre;
  if (despues !== NOMBRE) { console.error('  ✗ la relectura no coincide'); process.exit(3); }
  console.log(`  ✓ nombre fijado: ${JSON.stringify(despues)} (respaldo en ${RESPALDO})`);
  process.exit(0);
} catch (e) {
  console.error(`  ✗ ${e.message}`);
  process.exit(3);
}
