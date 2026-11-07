#!/usr/bin/env node
/**
 * cobro-ensayo-ruben.mjs — pone en el comercio `ensayo` el QR REAL de Rubén (monto abierto) para ensayar el cobro de su flujo en el Demo A,
 * y lo quita al restaurar. SECO por omisión. EXCEPCIÓN EXPRESA DE ANDRES (07/11/2026): la regla del ensayo era «solo un QR de NovuChat»; para el
 * ensayo de Rubén, Andres decidió usar el QR de Rubén y pagar 1 Bs (el dinero va a la cuenta de Rubén). Modo cobro REAL: el asistente nunca dice
 * «pago acreditado», «verificado» ni «simulado»; dice que el comprobante llegó y que los datos coinciden.
 *
 *   node scripts/plataforma/cobro-ensayo-ruben.mjs --proyecto <id> --copiar [--aplicar --confirmo-produccion ensayo]
 *   node scripts/plataforma/cobro-ensayo-ruben.mjs --proyecto <id> --quitar [--aplicar --confirmo-produccion ensayo]
 *
 * --copiar: copia `tenants/rroca-ruben/config/venta.cobroReal` a `tenants/ensayo/config/venta.cobroReal` (solo ese campo, `mergeFields`), con una
 *   `ficha` NUEVA al azar (la ficha sirve la imagen del QR y no puede repetirse entre comercios) y encendido. Se niega si el QR de origen no existe,
 *   venció, trae monto fijo (en una venta nunca cuadra), o si `ensayo` ya tiene un cobroReal de OTRO origen.
 * --quitar: borra `cobroReal` y `mediaIdQr` de `tenants/ensayo/config/venta` (la reversa; es lo que hay que correr al restaurar el Demo A).
 * Origen y destino están escritos aquí y no son parámetros. Escribe una auditoría sin valores. Nunca imprime la carga útil, la cuenta ni la ficha.
 * El media id de la imagen del QR (ligado al número del Demo A) lo escribe `escribir-qr-comercio.mjs`; este script no lo toca al copiar.
 * Salida: 0 hecho o sin cambios · 1 el seco encontró diferencias · 2 uso, salvaguarda o rechazo · 3 error.
 */
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { comprobarProyecto } from './aplicar-consola-oculta.mjs';

export const ORIGEN = 'rroca-ruben';
export const DESTINO = 'ensayo';
const MARCA = 'ensayo-rroca-ruben';

/** Núcleo puro. `io`: leerOrigen() → cobroReal|undefined; leerDestino() → cobroReal|undefined; escribir(cobro); quitar(); auditar(accion). */
export async function ejecutar({ modo, aplicar, hoy, io, nuevaFicha = () => randomBytes(16).toString('hex'), log = (t) => console.log(t) }) {
  if (modo === 'quitar') {
    const d = await io.leerDestino();
    const hayMedia = await io.hayMediaId();
    if (!d && !hayMedia) { log('\n  ✓ ensayo no tiene cobro ni media id del QR: nada que quitar.\n'); return 0; }
    log(`\n  ${aplicar ? 'QUITAR' : 'SECO'} · ensayo: ${d ? 'cobroReal' : ''}${d && hayMedia ? ' y ' : ''}${hayMedia ? 'mediaIdQr' : ''} se borrarían de config/venta`);
    if (!aplicar) { log('  Seco: no se escribió nada. Agregue --aplicar --confirmo-produccion ensayo.\n'); return 1; }
    await io.quitar();
    await io.auditar('quitar_cobro_ensayo_ruben');
    if ((await io.leerDestino()) || (await io.hayMediaId())) { log('\n  ✗ La relectura no coincide. Revise a mano.\n'); return 3; }
    log('\n  ✓ Quitado y anotado en la auditoría.\n');
    return 0;
  }
  const o = await io.leerOrigen();
  const problemas = [];
  if (!o || typeof o !== 'object') problemas.push('el comercio de origen no tiene un QR registrado');
  else {
    if (typeof o.cargaUtil !== 'string' || o.cargaUtil === '') problemas.push('el QR de origen no tiene carga útil');
    if (typeof o.venceEl !== 'string' || o.venceEl === '' || o.venceEl < hoy) problemas.push('el QR de origen venció o no tiene fecha');
    if (typeof o.montoFijo === 'number') problemas.push('el QR de origen tiene monto fijo: en una venta nunca cuadra (tiene que ser de monto abierto)');
    if (o.activo !== true) problemas.push('el cobro de origen no está encendido');
  }
  const d = await io.leerDestino();
  if (d && d.copiadoDe !== MARCA) problemas.push('ensayo ya tiene un cobro de otro origen: no se pisa (quitarlo primero con --quitar)');
  if (problemas.length) { for (const p of problemas) log(`  ✗ ${p}`); return 2; }
  const copia = { ...o, ficha: nuevaFicha(), activo: true, copiadoDe: MARCA };
  log(`\n  ${aplicar ? 'COPIAR' : 'SECO'} · QR de Rubén -> ensayo (venta, cobro REAL, monto abierto, vence ${String(o.venceEl)}). Se escribe solo cobroReal, con ficha nueva.`);
  if (!aplicar) { log('  Seco: no se escribió nada. Agregue --aplicar --confirmo-produccion ensayo.\n'); return 1; }
  await io.escribir(copia);
  await io.auditar('copiar_cobro_ensayo_ruben');
  const r = await io.leerDestino();
  if (!r || r.activo !== true || r.copiadoDe !== MARCA || r.ficha === o.ficha) { log('\n  ✗ La relectura no coincide. Revise a mano.\n'); return 3; }
  log('\n  ✓ Copiado, con ficha distinta de la de Rubén, encendido y anotado en la auditoría. Al restaurar el Demo A: --quitar.\n');
  return 0;
}

export function analizarArgumentos(argv, env = process.env) {
  const problemas = [];
  const v = { __proto__: null };
  const b = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--copiar' || a === '--quitar' || a === '--aplicar') { if (b.includes(a)) problemas.push(`opción repetida: ${a}`); b.push(a); }
    else if (a === '--proyecto' || a === '--confirmo-produccion') {
      const x = argv[i + 1];
      if (x === undefined || x.startsWith('--')) { problemas.push(`${a} sin valor`); continue; }
      v[a.slice(2)] = x; i += 1;
    } else problemas.push(`opción desconocida: ${String(a).split('=')[0].slice(0, 40)}`);
  }
  const copiar = b.includes('--copiar');
  const quitar = b.includes('--quitar');
  const aplicar = b.includes('--aplicar');
  if (copiar === quitar) problemas.push('elija UNO: --copiar o --quitar');
  const proy = v.proyecto === undefined ? { ok: false } : comprobarProyecto(v.proyecto, env);
  if (v.proyecto === undefined) problemas.push('falta --proyecto'); else if (!proy.ok) problemas.push(proy.motivo);
  if (proy.ok && proy.entorno === 'produccion' && aplicar && v['confirmo-produccion'] !== DESTINO) problemas.push(`contra producción, --aplicar exige --confirmo-produccion ${DESTINO}`);
  if (v['confirmo-produccion'] !== undefined && v['confirmo-produccion'] !== DESTINO) problemas.push(`--confirmo-produccion debe ser ${DESTINO}`);
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto: v.proyecto, modo: copiar ? 'copiar' : 'quitar', aplicar } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const a = analizarArgumentos(process.argv.slice(2));
  if (!a.ok) { console.error(`\n  ✗ ${a.problemas.join('\n  ✗ ')}\n`); process.exit(2); }
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp, FieldValue } = await import('firebase-admin/firestore');
  initializeApp({ projectId: a.cfg.proyecto });
  const db = getFirestore();
  const refO = db.doc(`tenants/${ORIGEN}/config/venta`);
  const refD = db.doc(`tenants/${DESTINO}/config/venta`);
  const code = await ejecutar({
    modo: a.cfg.modo, aplicar: a.cfg.aplicar, hoy: new Date().toISOString().slice(0, 10),
    io: {
      leerOrigen: async () => (await refO.get()).get('cobroReal'),
      leerDestino: async () => (await refD.get()).get('cobroReal'),
      hayMediaId: async () => { const m = (await refD.get()).get('mediaIdQr'); return typeof m === 'string' && m !== ''; },
      escribir: async (cobro) => { await refD.set({ cobroReal: cobro }, { mergeFields: ['cobroReal'] }); },
      quitar: async () => { await refD.update({ cobroReal: FieldValue.delete(), mediaIdQr: FieldValue.delete() }); },
      auditar: async (accion) => { await db.collection(`tenants/${DESTINO}/auditoria`).add({ accion, en: Timestamp.now(), porScript: true }); },
    },
  });
  process.exit(code);
}
