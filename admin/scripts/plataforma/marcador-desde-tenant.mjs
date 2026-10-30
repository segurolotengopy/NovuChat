#!/usr/bin/env node
/**
 * marcador-desde-tenant.mjs — copia `waPhoneNumberId` de `tenants/<id>` a una fila
 * `REEMPLAZAR_PHONE_NUMBER_ID_<ALIAS>` de CONFIGURACION.local.md SIN MOSTRAR NUNCA EL VALOR.
 *
 * POR QUÉ EXISTE. `cargar-timbre-n8n.sh` ata las credenciales de un alias al phoneNumberId de su fila
 * y aborta sin ella; la tabla local está en `deny` y el id no debe pasar por el chat. Si el id ya está
 * en la ficha del tenant (lo escribe `asignar-numero.mjs`), este paso lo copia una sola vez, revisado.
 * Hermano de `scripts/marcador-desde-archivo.sh` (que parte de un archivo de CLIENTES/).
 *
 * USO (SECO por omisión: lee y valida, no escribe nada)
 *   node scripts/plataforma/marcador-desde-tenant.mjs --proyecto <id-consola> --tenant <id> \
 *       --marcador REEMPLAZAR_PHONE_NUMBER_ID_<ALIAS> [--aplicar]
 * Con --aplicar delega la escritura en `scripts/marcador-local.sh` (valida la forma, respalda y NO
 * pisa una fila existente); el valor viaja por el entorno, nunca por argumentos.
 *
 * Solo lectura de Firestore. Imprime nombres y veredictos: jamás el valor ni sus últimas cifras.
 * Salidas: 0 hecho o seco sin problemas · 1 el campo no existe o no es un phone_number_id ·
 * 2 uso o salvaguarda (nada escrito) · 3 la fila ya existía y NO se comparó su valor.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
export const MARCADOR_PHONE = /^REEMPLAZAR_PHONE_NUMBER_ID_[A-Z0-9_]+$/;
export const ID_NUMERO = /^[0-9]{10,20}$/;

/** Núcleo puro: `leer(tenant)` devuelve {valor, alias}; `escribir(marcador, valor)` devuelve {codigo, salida}. */
export async function copiar({ tenant, marcador, aplicar, leer, escribir }) {
  if (!ID_TENANT.test(tenant ?? '')) return { codigo: 2, mensajes: ['--tenant inválido'] };
  if (!MARCADOR_PHONE.test(marcador ?? '')) {
    return { codigo: 2, mensajes: ['--marcador debe ser REEMPLAZAR_PHONE_NUMBER_ID_<ALIAS>'] };
  }
  const { valor, alias } = await leer(tenant);
  if (valor === undefined || valor === null || valor === '') {
    return { codigo: 1, mensajes: [`tenants/${tenant}: no tiene waPhoneNumberId. No se inventa: no se escribió nada.`] };
  }
  if (!ID_NUMERO.test(String(valor))) {
    return { codigo: 1, mensajes: [`tenants/${tenant}: waPhoneNumberId no tiene forma de phone_number_id.`] };
  }
  // Atadura tenant ↔ marcador: el sufijo del marcador tiene que ser el alias de la ruta del número
  // (rutasWhatsApp/{numero}.aliasSecreto); si no, el número de un tenant caería en la fila de otro.
  if (String(alias ?? '').toUpperCase() !== marcador.slice('REEMPLAZAR_PHONE_NUMBER_ID_'.length)) {
    return { codigo: 2, mensajes: [`${marcador} no corresponde al alias de la ruta de tenants/${tenant}. No se escribió nada.`] };
  }
  if (!aplicar) {
    return { codigo: 0, mensajes: [`SECO: tenants/${tenant}.waPhoneNumberId presente y con forma válida; ${marcador} no se escribió (falta --aplicar).`] };
  }
  const r = escribir(marcador, String(valor));
  if (r.codigo !== 0) return { codigo: 1, mensajes: [r.salida] };
  // marcador-local.sh no pisa una fila existente y sale 0: no se compara el valor guardado con el del tenant.
  if (/ya estaba en la tabla/.test(r.salida)) {
    return { codigo: 3, mensajes: [`${marcador} ya existía: NO se comparó su valor con el del tenant. Revísalo o usa marcador-local.sh --reemplazar.`] };
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
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('✗ falta GOOGLE_APPLICATION_CREDENTIALS: las credenciales aisladas de la consola, no las ADC por omisión'); process.exit(2);
  }
  console.log('  proyecto de la consola indicado (no se imprime su id)');
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: proyecto });
  const db = getFirestore();
  const res = await copiar({
    tenant: arg('--tenant'), marcador: arg('--marcador'), aplicar: a.includes('--aplicar'),
    leer: async (t) => {
      const valor = (await db.doc(`tenants/${t}`).get()).get('waPhoneNumberId');
      const ruta = valor && ID_NUMERO.test(String(valor)) ? await db.doc(`rutasWhatsApp/${valor}`).get() : null;
      // La ruta debe ser de ESE tenant: si no, no hay alias que valga.
      return { valor, alias: ruta?.exists && ruta.get('tenantId') === t ? ruta.get('aliasSecreto') : undefined };
    },
    escribir: escribirConMarcadorLocal,
  });
  for (const m of res.mensajes) console.log(`  ${res.codigo === 0 ? '✓' : '✗'} ${m}`);
  process.exit(res.codigo);
}
