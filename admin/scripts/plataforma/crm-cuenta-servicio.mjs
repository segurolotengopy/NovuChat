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
 *   node scripts/plataforma/crm-cuenta-servicio.mjs <crear|mostrar-correo|registrar-credencial-n8n|rotar|quitar> \
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

export const SUBCOMANDOS = ['crear', 'mostrar-correo', 'registrar-credencial-n8n', 'rotar', 'quitar'];
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
 * Núcleo. `d` = dependencias: gcloud(args) -> {codigo}; n8n.listar() -> [{id,name}] (lanza si falla);
 * n8n.crear(nombre, k) / n8n.actualizar(id, nombre, k) (lanzan; `definitivo` = n8n rechazó);
 * n8n.borrar(id) (lanza si falla); clave.existentes(correo) -> {ok, ids}; clave.crear(correo) ->
 * {ok, abortar?, huerfana?, ids?, correo, privateKey, keyId}; clave.descartar(k, {subida, duda});
 * clave.borrar(correo, keyId) -> boolean. En seco no se llama a ninguna dependencia.
 * `quitar` es solo la BAJA del cliente; rotar la clave es `rotar`.
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
        `comprobaría que n8n no tiene ya «${cred}» y que la cuenta no tiene claves (se rota, no se duplica)`,
        `crearía una clave de ${cuenta} en RAM, la subiría a n8n como «${cred}» y borraría el archivo`],
      rotar: [
        `comprobaría que «${cred}» existe y que ${cuenta} tiene exactamente una clave`,
        'crearía una clave nueva, la pondría en la misma credencial (mismo id), verificaría y borraría la clave vieja de IAM'],
      quitar: [`BAJA del cliente: borraría la credencial «${cred}» de n8n y la cuenta ${cuenta} (con sus claves)`],
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

  if (sub === 'registrar-credencial-n8n' || sub === 'rotar') {
    const rotando = sub === 'rotar';
    let existentes;
    try { existentes = await d.n8n.listar(); } catch { msg.push('no se pudo leer la lista de credenciales de n8n'); return fin(1); }
    const actual = existentes.find((c) => c.name === cred);
    if (!rotando && actual) { msg.push(`«${cred}» ya existe en n8n: usar rotar, no duplicar`); return fin(1); }
    if (rotando && !actual) { msg.push(`«${cred}» no existe en n8n: usar registrar-credencial-n8n`); return fin(1); }
    const previas = await d.clave.existentes(correo);
    if (!previas.ok) { msg.push('no se pudo listar las claves de la cuenta'); return fin(1); }
    if (!rotando && previas.ids.length > 0) {
      msg.push(`la cuenta ya tiene ${previas.ids.length} clave(s) de usuario: borrar la vieja (o usar rotar) antes de crear otra`); return fin(1);
    }
    if (rotando && previas.ids.length !== 1) {
      msg.push(`rotar exige exactamente una clave vigente y hay ${previas.ids.length}: revisar a mano`); return fin(1);
    }
    const k = await d.clave.crear(correo);
    if (!k.ok) {
      if (k.abortar) { msg.push(k.motivo ?? 'entorno sin /dev/shm: no se crea la clave'); return fin(2); }
      if (k.huerfana) {
        msg.push(`se creó una clave pero no se pudo leer: hay que borrarla de IAM (${(k.ids ?? []).map((x) => String(x).split('/').pop().slice(0, 8)).join(', ') || 'ver keys list'}…)`);
        return fin(1);
      }
      msg.push('no se pudo crear la clave'); return fin(1);
    }
    let subida = false; let duda = false;
    try {
      if (k.correo !== correo) { msg.push('la clave no pertenece a la cuenta de este tenant: no se sube'); return fin(1); }
      try {
        if (rotando) await d.n8n.actualizar(actual.id, cred, k); else await d.n8n.crear(cred, k);
        subida = true;
      } catch (e) {
        if (e && e.definitivo) { msg.push(`n8n rechazó la credencial (${e.estado ?? '?'})`); return fin(1); }
        duda = true; msg.push('sin respuesta clara de n8n: no se sabe si se aplicó. Comprobar antes de borrar claves de IAM.'); return fin(3);
      }
      if (rotando) {
        let despues = [];
        try { despues = await d.n8n.listar(); } catch { /* se trata como no verificado */ }
        if (!despues.some((c) => c.id === actual.id && c.name === cred)) {
          subida = true; duda = true; msg.push('no se pudo verificar la credencial tras la rotación: comprobar en n8n; la clave vieja NO se borró'); return fin(3);
        }
      }
    } finally {
      await d.clave.descartar(k, { subida, duda });
    }
    if (rotando) {
      if (!(await d.clave.borrar(correo, previas.ids[0]))) { msg.push('rotada, pero no se pudo borrar la clave vieja de IAM: borrarla'); return fin(1); }
      msg.push(`credencial «${cred}» rotada (mismo id) y clave vieja borrada.`);
      return fin(0);
    }
    msg.push(`credencial «${cred}» registrada en n8n.`);
    msg.push(`Falta un paso de una persona: compartir la planilla de ${tenant} como EDITOR solo con ${correo}.`);
    return fin(0);
  }

  // quitar: BAJA del cliente
  let hechas = 0;
  try {
    const todas = await d.n8n.listar();
    for (const c of todas.filter((x) => x.name === cred)) { await d.n8n.borrar(c.id); hechas += 1; }
  } catch { msg.push(`n8n falló al listar o borrar la credencial (borradas: ${hechas}). La cuenta NO se tocó.`); return fin(1); }
  const b = await d.gcloud(['iam', 'service-accounts', 'delete', correo, '--project', proyecto, '--quiet']);
  if (b.codigo !== 0) { msg.push(`credencial(es) borrada(s): ${hechas}; no se pudo borrar la cuenta (¿ya no existía?)`); return fin(1); }
  msg.push(`credencial(es) borrada(s): ${hechas}; cuenta de ${tenant} borrada.`);
  return fin(0);
}

// --- Dependencias reales (solo las usa la línea de comandos; exportadas para probarlas) -------------
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

/** Cliente de la API de credenciales de n8n. Cada fetch con tope de 30 s; todo error HTTP lanza. */
export function n8nCliente({ baseUrl, apiKey, timeoutMs = 30000 }) {
  const base = baseUrl.replace(/\/$/, '') + '/api/v1/credentials';
  const h = { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' };
  const llamar = async (url, init) => {
    try { return await fetch(url, { ...init, headers: h, signal: AbortSignal.timeout(timeoutMs) }); }
    catch { throw new Error('sin respuesta'); }
  };
  const rechazo = (r) => Object.assign(new Error('rechazada'), { definitivo: true, estado: r.status });
  const cuerpo = (nombre, k) => JSON.stringify({
    name: nombre, type: 'googleApi',
    data: { email: k.correo, privateKey: k.privateKey, inpersonate: false, httpNode: true,
            scopes: 'https://www.googleapis.com/auth/spreadsheets' } });
  return {
    listar: async () => {
      const todas = []; let cursor;
      do {
        const r = await llamar(`${base}?limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, {});
        if (!r.ok) throw rechazo(r);
        const j = await r.json();
        todas.push(...(j.data ?? []));
        cursor = j.nextCursor || undefined;
      } while (cursor);
      return todas;
    },
    borrar: async (id) => { const r = await llamar(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (!r.ok) throw rechazo(r); },
    crear: async (nombre, k) => { const r = await llamar(base, { method: 'POST', body: cuerpo(nombre, k) }); if (!r.ok) throw rechazo(r); return r.json(); },
    actualizar: async (id, nombre, k) => {
      const r = await llamar(`${base}/${encodeURIComponent(id)}`, { method: 'PATCH', body: cuerpo(nombre, k) });
      if (!r.ok) throw rechazo(r); return r.json();
    },
  };
}

function n8nReal(ruta) {
  const env = leerEnv(ruta);
  if (!env.N8N_BASE_URL?.startsWith('https://') || !env.N8N_API_KEY) throw new Error('faltan N8N_BASE_URL (https) o N8N_API_KEY en ENV_FILE');
  const acceso = { baseUrl: env.N8N_BASE_URL, apiKey: env.N8N_API_KEY };
  return n8nCliente(acceso);
}

/**
 * Claves de la cuenta vía gcloud. La clave privada solo vive en un directorio 700 de /dev/shm (RAM):
 * si no existe, se ABORTA (nunca disco). El directorio se borra siempre (finally) y ante SIGINT,
 * SIGTERM o SIGHUP (sale 130).
 */
export function claveReal(proyecto, { shm = '/dev/shm', gcloud = 'gcloud' } = {}) {
  const run = (args, capturar = false) =>
    spawnSync(gcloud, args, { encoding: 'utf8', stdio: ['ignore', capturar ? 'pipe' : 'ignore', 'ignore'] });
  const listar = (correo) => run(['iam', 'service-accounts', 'keys', 'list', '--iam-account', correo,
    '--project', proyecto, '--managed-by=user', '--format=value(name)'], true);
  const ids = (r) => String(r.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const borrar = async (correo, keyId) => run(['iam', 'service-accounts', 'keys', 'delete', keyId,
    '--iam-account', correo, '--project', proyecto, '--quiet']).status === 0;
  return {
    existentes: async (correo) => { const r = listar(correo); return r.status === 0 ? { ok: true, ids: ids(r) } : { ok: false, ids: [] }; },
    borrar,
    crear: async (correo) => {
      if (!existsSync(shm)) return { ok: false, abortar: true, motivo: `no existe ${shm}: la clave no se escribe en disco, se aborta` };
      const dir = mkdtempSync(join(shm, 'crm-'));
      const limpiar = () => rmSync(dir, { recursive: true, force: true });
      const salir = () => { limpiar(); process.exit(130); };
      const senales = ['SIGINT', 'SIGTERM', 'SIGHUP'];
      for (const s of senales) process.once(s, salir);
      try {
        chmodSync(dir, 0o700);
        const archivo = join(dir, 'clave.json');
        const r = run(['iam', 'service-accounts', 'keys', 'create', archivo, '--iam-account', correo, '--project', proyecto, '--quiet']);
        if (r.status !== 0 || !existsSync(archivo)) return { ok: false };
        let j;
        try { j = JSON.parse(readFileSync(archivo, 'utf8')); } catch {
          // La clave existe en IAM pero no se pudo leer: se informa para borrarla (no se adivina cuál).
          return { ok: false, huerfana: true, ids: ids(listar(correo)) };
        }
        return { ok: true, correo: j.client_email, privateKey: j.private_key, keyId: j.private_key_id, iam: correo };
      } finally {
        for (const s of senales) process.removeListener(s, salir);
        limpiar();
      }
    },
    descartar: async (k, { subida, duda }) => {
      k.privateKey = undefined;
      if (subida) return;
      if (duda) { console.error(`  ! no se sabe si llegó a n8n: comprobar antes de borrar la clave ${String(k.keyId).slice(0, 8)}… de IAM`); return; }
      console.error((await borrar(k.iam, k.keyId))
        ? `  ↺ clave ${String(k.keyId).slice(0, 8)}… borrada de IAM (no llegó a n8n)`
        : `  ✗ quedó la clave ${String(k.keyId).slice(0, 8)}… en IAM: hay que borrarla`);
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
    if (['registrar-credencial-n8n', 'rotar', 'quitar'].includes(sub)) {
      try { d.n8n = n8nReal(process.env.ENV_FILE ?? ''); } catch (e) { console.error(`  ✗ ${e.message}`); process.exit(2); }
    }
  }
  const res = await ejecutar({ sub, tenant: arg('--tenant'), proyecto, aplicar, confirmo: arg('--confirmo'), d });
  for (const m of res.mensajes) console.log(`  ${res.codigo === 0 ? '✓' : '✗'} ${m}`);
  process.exit(res.codigo);
}
