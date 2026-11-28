/**
 * LEER UN CAMPO PÚBLICO DE `tenants/{id}/config/negocio` — SOLO LECTURA.
 *
 * QUÉ ES. Una comprobación de lo que el comercio publica (el enlace de su catálogo, su ubicación…) sin abrir la Consola ni la nube.
 * NO escribe nada, ni tiene forma de hacerlo: el archivo solo hace `get` (con máscara de UN campo) y no importa ni llama a
 * `set`, `update`, `delete`, `runTransaction` ni `batch` (lo verifica una prueba que lee este texto).
 *
 *   node scripts/plataforma/leer-config-negocio.mjs --entorno staging|produccion --tenant <id> --campo <campo> [--esperado <url>]
 *   node scripts/plataforma/leer-config-negocio.mjs --proyecto <id> --tenant <id> --campo <campo> [--esperado <url>]
 *
 * LISTA CERRADA de campos (datos públicos, no secretos): `enlaceCatalogo`, `ubicacionTienda`, `mapaTienda`, `horarioTienda`. Un campo
 * fuera de la lista se rechaza ANTES de abrir Firebase; y la lectura lleva una máscara con ESE campo solo: ningún otro sale del servidor.
 *
 * `enlaceCatalogo` es una URL pública: se imprime tal cual, con tres comprobaciones —«sin barra final», «empieza por https://» y, si se
 * pasa `--esperado <url>`, «es exactamente igual a la URL esperada»— y nada más. Los otros campos se imprimen como texto (o como JSON
 * acotado a 500 caracteres si no son texto).
 *
 * SALVAGUARDA DE PROYECTO: la misma que los demás scripts de plataforma (lista blanca por `GCP_PROJECT_ID_STAGING` y
 * `GCP_PROJECT_ID_PROD`; `demo-*` solo contra el emulador). El id de un proyecto real NUNCA se imprime. Se rechazan NovuChat, los demos
 * y el ensayo.
 *
 * SALIDA. 0: el campo existe y las comprobaciones pasan. 1: no existe el documento o el campo, o falla una comprobación. 2: uso o
 * salvaguarda (nada leído). 3: error de ejecución (solo `e.code ?? e.name`).
 *
 * COSTO. UNA lectura de un documento (un campo). 0 escrituras. 0 mensajes por conversación.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ID_TENANT, comprobarProyecto } from './aplicar-consola-conversaciones.mjs';

/** Los ÚNICOS campos que este script puede leer: públicos y no secretos. */
export const CAMPOS_PERMITIDOS = Object.freeze(['enlaceCatalogo', 'ubicacionTienda', 'mapaTienda', 'horarioTienda']);
const CON_VALOR = ['proyecto', 'entorno', 'tenant', 'campo', 'esperado'];
const RESERVADO = /^(novuchat.*|ensayo|demo(-.*)?)$/;

export const USO = '  node scripts/plataforma/leer-config-negocio.mjs --entorno staging|produccion --tenant <id> '
  + `--campo ${CAMPOS_PERMITIDOS.join('|')} [--esperado <url>]`;

export function analizarArgumentos(argv, env = process.env) {
  const problemas = [];
  const valores = { __proto__: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string' || !a.startsWith('--')) { problemas.push('argumento suelto (sin su opción)'); continue; }
    const nombre = a.slice(2);
    if (!CON_VALOR.includes(nombre)) { problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40)}`); continue; }
    if (nombre in valores) problemas.push(`opción repetida: --${nombre}`);
    const valor = argv[i + 1];
    if (valor === undefined || valor.startsWith('--')) { problemas.push(`--${nombre} sin valor`); continue; }
    valores[nombre] = valor;
    i += 1;
  }
  const { tenant, campo, esperado } = valores;
  let { proyecto } = valores;
  if (valores['entorno'] !== undefined) {
    const VARIABLE = { staging: 'GCP_PROJECT_ID_STAGING', produccion: 'GCP_PROJECT_ID_PROD' }[valores['entorno']];
    if (proyecto !== undefined) problemas.push('--entorno no se combina con --proyecto');
    else if (VARIABLE === undefined) problemas.push('--entorno admite solo staging o produccion');
    else {
      const id = typeof env[VARIABLE] === 'string' ? env[VARIABLE].trim() : '';
      if (id === '') problemas.push(`--entorno ${valores['entorno']}: falta ${VARIABLE} en el entorno`);
      else proyecto = id;
    }
  }
  if (proyecto === undefined && valores['entorno'] === undefined) problemas.push('falta --proyecto (o --entorno)');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto !== undefined && !proy.ok) problemas.push(proy.motivo);

  if (tenant === undefined) problemas.push('falta --tenant');
  else if (!ID_TENANT.test(tenant)) problemas.push('--tenant inválido (minúsculas, dígitos y guiones, de 3 a 60)');
  else if (RESERVADO.test(tenant)) problemas.push('--tenant: NovuChat, los demos y el ensayo no se leen con este script');

  if (campo === undefined) problemas.push('falta --campo');
  else if (!CAMPOS_PERMITIDOS.includes(campo)) problemas.push(`--campo fuera de la lista cerrada (${CAMPOS_PERMITIDOS.join(', ')})`);
  if (esperado !== undefined) {
    if (campo !== 'enlaceCatalogo') problemas.push('--esperado solo vale con --campo enlaceCatalogo');
    else if (!/^https:\/\/[^/\s][^\s]{0,1999}$/.test(esperado)) problemas.push('--esperado tiene que ser una URL https:// con host y sin espacios');
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, campo, esperado: esperado ?? null } };
}

/** Las comprobaciones de `enlaceCatalogo`: SOLO estas tres, sin imprimir nada más del documento. */
export function comprobarEnlace(valor, esperado) {
  const texto = typeof valor === 'string' ? valor : '';
  const r = [
    { nombre: 'sin barra final', ok: texto !== '' && !texto.endsWith('/') },
    { nombre: 'empieza por https://', ok: texto.startsWith('https://') },
  ];
  if (esperado !== null && esperado !== undefined) r.push({ nombre: 'es exactamente igual a la URL esperada', ok: texto === esperado });
  return r;
}

/** Lo que se imprime: los controles (`\p{Cc}`, así una secuencia ANSI u OSC no se ejecuta en la terminal) y U+2028/2029 salen como «?». */
export const mostrar = (v) => {
  let t;
  if (typeof v === 'string') t = v;
  else { try { t = JSON.stringify(v).slice(0, 500); } catch { t = '(no se puede mostrar)'; } }
  return String(t).replace(/[\p{Cc}\u2028\u2029]/gu, '?');
};

/** Corre la lectura ya validada. `deps`: `{ db, log }`. Devuelve el código de salida. SOLO `getAll` con máscara de UN campo. */
export async function ejecutar(cfg, deps) {
  const { db } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  if (!CAMPOS_PERMITIDOS.includes(cfg.campo)) { log('\n  ✗ Campo fuera de la lista cerrada: no se lee nada.\n'); return 2; }
  const [snap] = await db.getAll(db.doc(`tenants/${cfg.tenant}/config/negocio`), { fieldMask: [cfg.campo] });
  log(`\n  LECTURA · ${cfg.entorno} · tenant ${cfg.tenant} · config/negocio.${cfg.campo}\n`);
  if (!snap.exists) { log(`  ✗ ${cfg.tenant}: no existe config/negocio (comercio inexistente o sin ese documento)\n`); return 1; }
  const datos = snap.data() ?? {};
  if (!Object.prototype.hasOwnProperty.call(datos, cfg.campo)) { log(`  ✗ El campo ${cfg.campo} no está en config/negocio\n`); return 1; }
  const valor = datos[cfg.campo];
  log(`  ${cfg.campo}: ${mostrar(valor)}`);
  if (cfg.campo !== 'enlaceCatalogo') { log(''); return 0; }
  let todas = true;
  for (const c of comprobarEnlace(valor, cfg.esperado)) {
    log(`  ${c.ok ? '✓' : '✗'} ${c.nombre}`);
    if (!c.ok) todas = false;
  }
  log('');
  return todas ? 0 : 1;
}

async function principal() {
  const analisis = analizarArgumentos(process.argv.slice(2));
  if (!analisis.ok) {
    console.error(`\n  ✗ ${analisis.problemas.join('\n  ✗ ')}\n\n${USO}\n`);
    process.exit(2);
  }
  const { cfg } = analisis;
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  const codigo = await ejecutar(cfg, { db });
  await db.terminate().catch(() => {});
  process.exit(codigo);
}

function seEjecutaDirecto() {
  try {
    return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (seEjecutaDirecto()) {
  try {
    await principal();
  } catch (e) {
    console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`);
    process.exit(3);
  }
}
