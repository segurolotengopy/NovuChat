#!/usr/bin/env node
/**
 * marcador-desde-negocio.mjs — copia `numeroRecepcion` de `tenants/<id>/config/negocio` a una fila
 * `REEMPLAZAR_NUMERO_RECEPCION_<ALIAS>` de CONFIGURACION.local.md SIN MOSTRAR NUNCA EL VALOR.
 *
 * POR QUÉ EXISTE. `cargar-negocio.mjs` resuelve `numeroRecepcionMarcador` contra la tabla local y, con --aplicar, se niega si la
 * fila falta; en seco avisa que dejaría el número VACÍO, es decir, borraría el que la Consola ya tiene. El número ya está en la
 * Consola (lo que vive allí no se repite a mano) y la tabla local está en `deny`: este paso lo copia una sola vez, revisado.
 * Hermano de `marcador-desde-tenant.mjs` (que copia `waPhoneNumberId`).
 *
 * USO (SECO por omisión: lee y valida, no escribe nada)
 *   node scripts/plataforma/marcador-desde-negocio.mjs --proyecto <id-consola> --tenant <id> \
 *       --marcador REEMPLAZAR_NUMERO_RECEPCION_<ALIAS> [--aplicar]
 * Con --aplicar delega la escritura en `scripts/marcador-local.sh` (valida la forma 591…, respalda y NO pisa una fila existente);
 * el valor viaja por el entorno, nunca por argumentos.
 *
 * Solo lectura de Firestore. Imprime nombres y veredictos: jamás el valor ni sus últimas cifras.
 * Salidas: 0 hecho o seco sin problemas · 1 el campo no existe o no tiene forma de número boliviano ·
 * 2 uso o salvaguarda (nada escrito) · 3 la fila ya existía y NO se comparó su valor.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
export const MARCADOR_NUMERO = /^REEMPLAZAR_NUMERO_RECEPCION_[A-Z0-9_]+$/;
export const FORMA_NUMERO = /^591[0-9]{7,8}$/;

/** Deja solo los dígitos (la Consola puede guardar «+591 …»). Un valor con letras u otros signos no se acepta. */
export function normalizar(valor) {
  const s = String(valor ?? '').trim();
  if (!/^\+?[0-9 ]+$/.test(s)) return '';
  return s.replace(/[+ ]/g, '');
}

/** Núcleo puro: `leer(tenant)` devuelve el valor de `numeroRecepcion`; `escribir(marcador, valor)` devuelve {codigo, salida}. */
export async function copiar({ tenant, marcador, aplicar, leer, escribir }) {
  if (!ID_TENANT.test(tenant ?? '')) return { codigo: 2, mensajes: ['--tenant inválido'] };
  if (!MARCADOR_NUMERO.test(marcador ?? '')) {
    return { codigo: 2, mensajes: ['--marcador debe ser REEMPLAZAR_NUMERO_RECEPCION_<ALIAS>'] };
  }
  const crudo = await leer(tenant);
  if (crudo === undefined || crudo === null || crudo === '') {
    return { codigo: 1, mensajes: [`tenants/${tenant}/config/negocio: no tiene numeroRecepcion. No se inventa: no se escribió nada.`] };
  }
  const valor = normalizar(crudo);
  if (!FORMA_NUMERO.test(valor)) {
    return { codigo: 1, mensajes: [`tenants/${tenant}/config/negocio: numeroRecepcion no tiene forma de número boliviano (591…). No se escribió nada.`] };
  }
  if (!aplicar) {
    return { codigo: 0, mensajes: [`SECO: tenants/${tenant}/config/negocio.numeroRecepcion presente y con forma válida; ${marcador} no se escribió (falta --aplicar).`] };
  }
  const r = escribir(marcador, valor);
  if (r.codigo !== 0) return { codigo: 1, mensajes: [r.salida] };
  if (/ya estaba en la tabla/.test(r.salida)) {
    return { codigo: 3, mensajes: [`${marcador} ya existía: NO se comparó su valor con el de la Consola. Revísalo o usa marcador-local.sh --reemplazar.`] };
  }
  return { codigo: 0, mensajes: [r.salida] };
}

export const escribirConMarcadorLocal = (marcador, valor, ejecutar = spawnSync) => {
  const script = fileURLToPath(new URL('../../../scripts/marcador-local.sh', import.meta.url));
  const r = ejecutar('bash', [script, '--marcador', marcador], {
    encoding: 'utf8', env: { ...process.env, MARCADOR_VALOR: valor },
  });
  // Se descarta lo que imprima el hijo salvo su veredicto: si algún día eco el valor, no sale de aquí.
  const salida = ((r.stdout ?? '') + (r.stderr ?? '')).split('\n').filter((l) => !l.includes(valor)).join('\n').trim();
  return { codigo: r.status ?? 1, salida: salida || (r.error ? `no se pudo lanzar bash (${r.error.code ?? 'error'})` : '') };
};

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const a = process.argv.slice(2);
  const arg = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const proyecto = arg('--proyecto');
  if (!proyecto) { console.error('✗ falta --proyecto (el proyecto de la CONSOLA)'); process.exit(2); }
  console.log('  proyecto de la consola indicado (no se imprime su id)');
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: proyecto });
  const db = getFirestore();
  const res = await copiar({
    tenant: arg('--tenant'), marcador: arg('--marcador'), aplicar: a.includes('--aplicar'),
    leer: async (t) => (await db.doc(`tenants/${t}/config/negocio`).get()).get('numeroRecepcion'),
    escribir: escribirConMarcadorLocal,
  });
  for (const m of res.mensajes) console.log(`  ${res.codigo === 0 ? '✓' : '✗'} ${m}`);
  process.exit(res.codigo);
}
