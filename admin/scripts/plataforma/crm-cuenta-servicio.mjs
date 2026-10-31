#!/usr/bin/env node
/**
 * crm-cuenta-servicio.mjs — UNA CUENTA DE SERVICIO POR CLIENTE para el miniCRM (PR-C).
 *
 * POR QUÉ EXISTE. Cada subcuenta tiene su planilla del miniCRM. Si todas se compartieran con una sola
 * cuenta de servicio, el flujo de un cliente podría leer y escribir la hoja de otro (aislamiento entre
 * tenants, regla mandatoria). Aquí cada planilla se comparte SOLO con `crm-<tenant>@<proyecto>…`, y la
 * credencial de n8n que la usa lleva el tenant en el nombre. La cuenta no tiene ningún rol: solo toca
 * lo que una persona le comparta a mano.
 *
 * USO (SECO por omisión: imprime lo que haría, sin red ni credenciales)
 *   node scripts/plataforma/crm-cuenta-servicio.mjs <crear|mostrar-correo|registrar-credencial-n8n|quitar> \
 *       --tenant <id> [--proyecto <id-gcp>] [--aplicar --confirmo produccion]
 * El proyecto sale de --proyecto o de CRM_PROYECTO_GCP; el .env de n8n (N8N_BASE_URL, N8N_API_KEY) de
 * ENV_FILE, leído sin ejecutarlo. gcloud usa el CLOUDSDK_CONFIG aislado que ya esté en el entorno.
 *
 * LA CLAVE PRIVADA NUNCA SALE DEL PROCESO: se crea en un archivo 600 de /dev/shm, se sube a n8n y se
 * borra; no pasa por stdout ni por el repositorio. Si no llega a n8n, se borra también de IAM.
 * Salidas: 0 hecho o seco · 1 fallo operativo · 2 uso o salvaguarda (nada escrito) · 3 no se sabe si llegó.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SUBCOMANDOS = ['crear', 'mostrar-correo', 'registrar-credencial-n8n', 'quitar'];
/** 3 a 26 caracteres: `crm-` + tenant cabe en los 30 que admite el id de una cuenta de servicio. */
export const ID_TENANT = /^[a-z][a-z0-9-]{1,24}[a-z0-9]$/;
export const ID_PROYECTO = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export const nombreCuenta = (tenant) => {
  if (!ID_TENANT.test(tenant ?? '') || tenant.includes('--')) throw new Error('tenant inválido');
  return `crm-${tenant}`;
};
export const correoCuenta = (tenant, proyecto) => {
  if (!ID_PROYECTO.test(proyecto ?? '')) throw new Error('proyecto inválido');
  return `${nombreCuenta(tenant)}@${proyecto}.iam.gserviceaccount.com`;
};
/** El tenant va en el nombre: dos tenants nunca comparten credencial de n8n. */
export const nombreCredencial = (tenant) => `Google Sheets miniCRM (${nombreCuenta(tenant)})`;

/** Aislamiento de un conjunto de tenants: ni cuenta ni credencial repetidas, ni tenants duplicados. */
export function verificarAislamiento(tenants) {
  const problemas = [];
  const cuentas = new Map();
  const creds = new Map();
  const vistos = new Set();
  for (const t of tenants) {
    let cuenta; let cred;
    try { cuenta = nombreCuenta(t); cred = nombreCredencial(t); } catch { problemas.push(`tenant inválido: ${String(t).slice(0, 40)}`); continue; }
    if (vistos.has(t)) { problemas.push(`tenant repetido: ${t}`); continue; }
    vistos.add(t);
    if (cuentas.has(cuenta)) problemas.push(`la cuenta ${cuenta} colisiona entre ${cuentas.get(cuenta)} y ${t}`);
    if (creds.has(cred)) problemas.push(`la credencial «${cred}» colisiona entre ${creds.get(cred)} y ${t}`);
    cuentas.set(cuenta, t); creds.set(cred, t);
  }
  return problemas;
}

/**
 * Núcleo. `d` = dependencias: gcloud(args) -> {codigo, salida}; n8n.listar() -> [{id,name}];
 * n8n.crear(nombre, claveJson) -> {id}; n8n.borrar(id); clave.crear(correo) -> {clavePath|json, keyId}.
 * En seco no se llama a ninguna dependencia.
 */
export async function ejecutar({ sub, tenant, proyecto, aplicar = false, confirmo, d = {} }) {
  const msg = [];
  const fin = (codigo) => ({ codigo, mensajes: msg });
  if (!SUBCOMANDOS.includes(sub)) { msg.push(`subcomando inválido (${SUBCOMANDOS.join(' | ')})`); return fin(2); }
  let cuenta; let cred;
  try { cuenta = nombreCuenta(tenant); cred = nombreCredencial(tenant); } catch { msg.push('--tenant inválido'); return fin(2); }
  if (!ID_PROYECTO.test(proyecto ?? '')) { msg.push('falta --proyecto (o CRM_PROYECTO_GCP) con forma de id de proyecto'); return fin(2); }
  const correo = correoCuenta(tenant, proyecto);
  if (sub === 'mostrar-correo') { msg.push(correo); return fin(0); }
  if (aplicar && confirmo !== 'produccion') { msg.push('--aplicar exige --confirmo produccion. No se escribió nada.'); return fin(2); }
  if (!aplicar && confirmo !== undefined) { msg.push('--confirmo sin --aplicar: no tiene efecto. No se escribió nada.'); return fin(2); }

  if (!aplicar) {
    const plan = {
      crear: [`activaría la API de Google Sheets y crearía la cuenta ${cuenta} (sin ningún rol) en el proyecto indicado`],
      'registrar-credencial-n8n': [
        `comprobaría que n8n no tiene ya «${cred}» (se rota, no se duplica)`,
        `crearía una clave de ${cuenta} en RAM, la subiría a n8n como «${cred}» y borraría el archivo`],
      quitar: [`borraría la credencial «${cred}» de n8n y la cuenta ${cuenta} (con sus claves)`],
    }[sub];
    for (const l of plan) msg.push(`SECO: ${l}.`);
    msg.push('Seco: no se escribió nada. Agregue --aplicar --confirmo produccion (con el OK de Andres).');
    return fin(0);
  }

  if (sub === 'crear') {
    const ya = await d.gcloud(['iam', 'service-accounts', 'describe', correo, '--project', proyecto]);
    if (ya.codigo === 0) { msg.push(`la cuenta ${cuenta} ya existe: no se duplica`); return fin(0); }
    const a = await d.gcloud(['services', 'enable', 'sheets.googleapis.com', '--project', proyecto, '--quiet']);
    if (a.codigo !== 0) { msg.push('no se pudo activar la API de Sheets'); return fin(1); }
    const c = await d.gcloud(['iam', 'service-accounts', 'create', cuenta, '--project', proyecto, '--quiet',
      '--display-name', `miniCRM: ${tenant}`,
      '--description', 'Sin roles. Solo toca la planilla del miniCRM que se le comparte a mano.']);
    if (c.codigo !== 0) { msg.push('no se pudo crear la cuenta'); return fin(1); }
    msg.push(`cuenta creada. Compartir la planilla de ${tenant} como EDITOR solo con ${correo}.`);
    return fin(0);
  }

  if (sub === 'registrar-credencial-n8n') {
    const existentes = await d.n8n.listar();
    if (existentes.some((c) => c.name === cred)) { msg.push(`«${cred}» ya existe en n8n: rotar, no duplicar`); return fin(1); }
    // Una credencial con la cuenta de OTRO tenant jamás se acepta aquí: el nombre sale del tenant.
    const k = await d.clave.crear(correo);
    if (!k.ok) { msg.push('no se pudo crear la clave'); return fin(1); }
    let subida = false; let duda = false;
    try {
      if (k.correo !== correo) { msg.push('la clave no pertenece a la cuenta de este tenant: no se sube'); return fin(1); }
      try { await d.n8n.crear(cred, k); subida = true; } catch (e) {
        if (e && e.definitivo) { msg.push(`n8n rechazó la credencial (${e.estado ?? '?'})`); return fin(1); }
        duda = true; msg.push('sin respuesta clara de n8n: no se sabe si se creó. Comprobar antes de borrar la clave de IAM.'); return fin(3);
      }
    } finally {
      await d.clave.descartar(k, { subida, duda });
    }
    msg.push(`credencial «${cred}» registrada en n8n.`);
    msg.push(`Falta un paso de una persona: compartir la planilla de ${tenant} como EDITOR solo con ${correo}.`);
    return fin(0);
  }

  // quitar
  const todas = await d.n8n.listar();
  for (const c of todas.filter((x) => x.name === cred)) await d.n8n.borrar(c.id);
  const b = await d.gcloud(['iam', 'service-accounts', 'delete', correo, '--project', proyecto, '--quiet']);
  if (b.codigo !== 0) { msg.push('no se pudo borrar la cuenta (¿ya no existía?)'); return fin(1); }
  msg.push(`credencial y cuenta de ${tenant} borradas.`);
  return fin(0);
}

// --- Dependencias reales (solo las usa la línea de comandos) ---------------------------------------
const gcloudReal = async (args) => {
  const r = spawnSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { codigo: r.status ?? 1, salida: '' }; // la salida de gcloud nunca se reenvía
};

export function leerEnv(ruta) {
  const env = {};
  for (const l of readFileSync(ruta, 'utf8').split('\n')) {
    const m = l.match(/^\s*(?:export\s+)?(N8N_BASE_URL|N8N_API_KEY)\s*=\s*(.*)$/);
    if (m) { const v = m[2].trim(); env[m[1]] = v.length > 1 && v[0] === v.at(-1) && '"\''.includes(v[0]) ? v.slice(1, -1) : v; }
  }
  return env;
}

function n8nReal(ruta) {
  const env = leerEnv(ruta);
  if (!env.N8N_BASE_URL?.startsWith('https://') || !env.N8N_API_KEY) throw new Error('faltan N8N_BASE_URL (https) o N8N_API_KEY en ENV_FILE');
  const base = env.N8N_BASE_URL.replace(/\/$/, '') + '/api/v1/credentials';
  const h = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
  return {
    listar: async () => (await (await fetch(`${base}?limit=250`, { headers: h })).json()).data ?? [],
    borrar: async (id) => { await fetch(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: h }); },
    crear: async (nombre, k) => {
      let r;
      try {
        r = await fetch(base, { method: 'POST', headers: h, body: JSON.stringify({
          name: nombre, type: 'googleApi',
          data: { email: k.correo, privateKey: k.privateKey, inpersonate: false, httpNode: true,
                  scopes: 'https://www.googleapis.com/auth/spreadsheets' } }) });
      } catch { throw new Error('sin respuesta'); }
      if (!r.ok) { const e = new Error('rechazada'); e.definitivo = true; e.estado = r.status; throw e; }
      return r.json();
    },
  };
}

function claveReal(proyecto) {
  return {
    crear: async (correo) => {
      const dir = mkdtempSync(join(existsSync('/dev/shm') ? '/dev/shm' : tmpdir(), 'crm-'));
      chmodSync(dir, 0o700);
      const archivo = join(dir, 'clave.json');
      const r = spawnSync('gcloud', ['iam', 'service-accounts', 'keys', 'create', archivo, '--iam-account', correo,
        '--project', proyecto, '--quiet'], { stdio: 'ignore' });
      if (r.status !== 0 || !existsSync(archivo)) { rmSync(dir, { recursive: true, force: true }); return { ok: false }; }
      const j = JSON.parse(readFileSync(archivo, 'utf8'));
      rmSync(dir, { recursive: true, force: true }); // el archivo ya no existe; la clave vive solo en memoria
      return { ok: true, correo: j.client_email, privateKey: j.private_key, keyId: j.private_key_id, iam: correo };
    },
    descartar: async (k, { subida, duda }) => {
      k.privateKey = undefined;
      if (subida) return;
      if (duda) { console.error(`  ! no se sabe si llegó a n8n: comprobar antes de borrar la clave ${String(k.keyId).slice(0, 8)}… de IAM`); return; }
      spawnSync('gcloud', ['iam', 'service-accounts', 'keys', 'delete', k.keyId, '--iam-account', k.iam,
        '--project', proyecto, '--quiet'], { stdio: 'ignore' });
      console.error(`  ↺ clave ${String(k.keyId).slice(0, 8)}… borrada de IAM (no llegó a n8n)`);
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const a = process.argv.slice(2);
  const sub = a[0];
  const arg = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const aplicar = a.includes('--aplicar');
  const proyecto = arg('--proyecto') ?? process.env.CRM_PROYECTO_GCP;
  const d = {};
  if (aplicar && arg('--confirmo') === 'produccion' && SUBCOMANDOS.includes(sub)) {
    d.gcloud = gcloudReal;
    d.clave = claveReal(proyecto);
    if (sub === 'registrar-credencial-n8n' || sub === 'quitar') {
      try { d.n8n = n8nReal(process.env.ENV_FILE ?? ''); } catch (e) { console.error(`  ✗ ${e.message}`); process.exit(2); }
    }
  }
  const res = await ejecutar({ sub, tenant: arg('--tenant'), proyecto, aplicar, confirmo: arg('--confirmo'), d });
  for (const m of res.mensajes) console.log(`  ${res.codigo === 0 ? '✓' : '✗'} ${m}`);
  process.exit(res.codigo);
}
