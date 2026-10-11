/**
 * ESCRIBIR `tenants/{id}.consolaConversaciones` DE UN SOLO COMERCIO — seco por omisión.
 *
 * QUÉ ES. La bandera que decide qué pantalla de Conversaciones ve ese comercio:
 * `clasica` (la de siempre) o `nueva` (lista y hilo con búsqueda y filtros; ver
 * `functions/src/central/consola-conversaciones.ts`). Ausente = `clasica`. Es SOLO
 * PRESENTACIÓN: no cambia lo que el servidor permite. Ningún navegador puede
 * escribirla (`firestore.rules`: `tenants/{id}` no admite escritura de clientes);
 * este script es el único camino. Calcado de `aplicar-consola-oculta.mjs`: seco,
 * respaldo, precondición, relectura y vuelta atrás.
 *
 *   node scripts/plataforma/aplicar-consola-conversaciones.mjs --proyecto <id> --tenant <id> \
 *        --pantalla nueva|clasica [--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]
 *   node scripts/plataforma/aplicar-consola-conversaciones.mjs --revertir --respaldo <ruta> \
 *        --tenant <id> --proyecto <id> [--aplicar] [--confirmo-produccion <tenant>]
 *
 * QUÉ HACE.
 *   · SECO (sin `--aplicar`): lee SOLO `consolaConversaciones` (y el nombre de la ficha, para
 *     el freno de Bellido) de `tenants/{id}`; imprime valor actual → nuevo. No escribe.
 *   · `--aplicar`: exige `--respaldo`; guarda el valor previo (o su AUSENCIA), lo relee y
 *     recién entonces escribe SOLO `consolaConversaciones` con la precondición de la hora de
 *     actualización leída (si la ficha cambió entre la lectura y la escritura, aborta sin
 *     escribir). Relee y compara. Una escritura.
 *   · `--revertir --aplicar`: restaura desde el respaldo (si el campo no existía, lo ELIMINA).
 *     No pisa un cambio ajeno: si el campo de hoy no es lo que escribió este script, sale con
 *     2 sin escribir.
 *   · IDEMPOTENTE: si el valor ya es el pedido, sale con 0 sin escribir.
 *   · `--pantalla` se valida con `validarPantallaConversaciones` (el mismo archivo que lee la
 *     consola): un valor desconocido se RECHAZA (salida 2).
 *
 * BELLIDO NO SE TOCA (decisión P1, Andres, 09/10/2026): a Bellido no se le enciende la bandera
 * y su pantalla actual queda intacta. El script se NIEGA (salida 2, sin abrir Firebase) si el
 * id del comercio es de Bellido o está en la lista de exclusión (`TENANTS_EXCLUIDOS`, más lo que
 * agregue la variable `NOVUCHAT_TENANTS_EXCLUIDOS`, ids separados por coma), y una segunda
 * vez si el NOMBRE de la ficha lo nombra (por si el id del comercio no fuera el esperado).
 *
 * SALVAGUARDA DE PROYECTO. Lista blanca por `GCP_PROJECT_ID_STAGING` y `GCP_PROJECT_ID_PROD`;
 * contra PRODUCCIÓN, `--aplicar` exige `--confirmo-produccion <tenant>` igual a `--tenant`.
 * Contra el emulador (`demo-*`) exige `FIRESTORE_EMULATOR_HOST` local. El id de un proyecto
 * real NUNCA se imprime: se imprime `staging` o `produccion`.
 *
 * RESPALDO. Absoluto y normalizado; carpeta 0700 y archivo 0600, nunca se pisa. Lista POSITIVA de
 * lugares; todo lo demás se rechaza (en particular `~/`, directo o debajo de él, y cualquier carpeta
 * versionable, porque un repositorio público no es su lugar):
 *   (a) el scratchpad de la sesión: dentro de `/tmp` o `/var/tmp` (fijas, no dependen de `TMPDIR`);
 *   (b) una carpeta IGNORADA POR GIT del propio proyecto, tanto desde la copia principal como desde
 *       cualquiera de sus worktrees (se compara el repositorio común, no la raíz). Es el lugar
 *       DURADERO: `CLIENTES/<CLIENTE>/` de la copia principal está ignorada.
 * PASO PREVIO para (b): la carpeta del cliente (`CLIENTES/<CLIENTE>/`) debería existir ya (si falta, el
 * script la crea también 0700) y el respaldo va en una subcarpeta NUEVA, por ejemplo
 * `<copia principal>/CLIENTES/<CLIENTE>/respaldos-h1/<nombre>.json`: el script la crea con 0700 y no
 * exige que `CLIENTES/<CLIENTE>/` sea 0700 (suele ser 0775), solo que sea del usuario. Una subcarpeta
 * que ya existe tiene que ser del usuario y 0700. Para (a) lo mismo: la subcarpeta nueva dentro del
 * scratchpad. Tras guardar el respaldo, el script lo vuelve a LEER con la forma que `--revertir` exige y
 * se detiene (salida 2) antes de tocar la ficha si no sirve.
 *
 * SALIDA. 0: seco sin diferencias, o escritura hecha y comprobada. 1: el seco encontró
 * diferencias (o la ficha no existe). 2: uso o salvaguarda (nada escrito). 3: error de
 * ejecución (solo `e.code ?? e.name`). 130: Ctrl-C.
 *
 * COSTO. Seco: una lectura. `--aplicar`: dos lecturas y UNA escritura de un campo (más el
 * archivo local del respaldo). 0 mensajes por conversación. NO se corre contra producción sin
 * el «sí» de Andres.
 */
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PANTALLAS_CONVERSACIONES, validarPantallaConversaciones } from '../../functions/src/central/consola-conversaciones.ts';
import { comprobarProyecto, guardarRespaldo } from './aplicar-consola-oculta.mjs';

export { comprobarProyecto, guardarRespaldo };

const RAIZ_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CAMPO = 'consolaConversaciones';
export const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const CON_VALOR = ['proyecto', 'tenant', 'pantalla', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];

/** Los comercios a los que NUNCA se les corre este script (ni el de relleno). Ver el encabezado. */
export const TENANTS_EXCLUIDOS = Object.freeze(['bellido']);

export const USO = '  node scripts/plataforma/aplicar-consola-conversaciones.mjs --proyecto <id> --tenant <id> --pantalla nueva|clasica '
  + '[--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]\n'
  + '  node scripts/plataforma/aplicar-consola-conversaciones.mjs --revertir --respaldo <ruta> --tenant <id> --proyecto <id> '
  + '[--aplicar] [--confirmo-produccion <tenant>]\n'
  + `  pantallas permitidas: ${PANTALLAS_CONVERSACIONES.join(', ')}`;

// ===========================================================================
// BELLIDO Y LA LISTA DE EXCLUSIÓN (puras)
// ===========================================================================
const sinTildes = (s) => String(s).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();

/** Los ids excluidos: la lista fija más la variable de entorno (solo AGREGA, nunca quita). */
export function excluidos(env = process.env) {
  const extra = typeof env.NOVUCHAT_TENANTS_EXCLUIDOS === 'string'
    ? env.NOVUCHAT_TENANTS_EXCLUIDOS.split(',').map((s) => sinTildes(s.trim())).filter(Boolean)
    : [];
  return [...TENANTS_EXCLUIDOS, ...extra];
}

/**
 * ¿Es un comercio de la lista de exclusión? Coincide si el id ES uno de la lista o LO CONTIENE
 * (`bellido`, `consultorio-bellido`, `bellido2`): ante la duda se niega, nunca se deja pasar.
 */
export function esTenantExcluido(tenant, env = process.env) {
  if (typeof tenant !== 'string') return false;
  const t = sinTildes(tenant);
  return excluidos(env).some((x) => t === x || t.includes(x));
}

/** ¿El NOMBRE de la ficha nombra a un comercio excluido? Segunda barrera, por si el id no fuera el esperado. */
export function nombreExcluido(nombre, env = process.env) {
  if (typeof nombre !== 'string') return false;
  const n = sinTildes(nombre);
  return excluidos(env).some((x) => n.includes(x));
}

// ===========================================================================
// RUTA DEL RESPALDO (el sistema de archivos solo se mira, no se escribe)
// ===========================================================================
const estaDentro = (padre, hijo) => {
  const r = relative(padre, hijo);
  return r !== '' && !r.startsWith('..') && !isAbsolute(r);
};

function rutaRealConPendientes(absoluta) {
  const partes = absoluta.split(sep).filter((p) => p !== '');
  for (let n = partes.length - 1; n >= 0; n--) {
    try {
      const existente = realpathSync(sep + partes.slice(0, n).join(sep));
      return { real: join(existente, ...partes.slice(n)), existente };
    } catch {
      // ese tramo no existe todavía: se sube un nivel
    }
  }
  return null;
}

/**
 * La raíz de repositorio git más cercana (carpeta con `.git`, directorio o archivo de un worktree), o null.
 * `techo`: no sube hasta él ni más arriba (una raíz permitida es de confianza: lo que haya por encima no cuenta).
 */
function raizGitDe(carpeta, techo = null) {
  if (techo !== null && !estaDentro(techo, carpeta)) return null;
  if (existsSync(join(carpeta, '.git'))) return carpeta;
  const padre = dirname(carpeta);
  return padre === carpeta ? null : raizGitDe(padre, techo);
}

const ENTORNO_GIT = () => ({ PATH: process.env.PATH ?? '', LC_ALL: 'C' });

/**
 * El repositorio COMÚN de una carpeta (el `.git` de verdad): un worktree y la copia principal comparten el mismo,
 * aunque sus raíces sean distintas. null si git no lo puede decir.
 */
export function repositorioComun(raizRepo) {
  const r = spawnSync('git', ['-C', raizRepo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
    env: ENTORNO_GIT(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (r.status !== 0 || typeof r.stdout !== 'string' || r.stdout.trim() === '') return null;
  try { return realpathSync(r.stdout.trim()); } catch { return null; }
}

/** ¿`git` dice que esa ruta está ignorada? Solo mira; si git no está o falla, NO está ignorada. */
export function ignoradaPorGit(raizGit, real, existente) {
  if (!raizGit || !estaDentro(raizGit, real)) return false;
  const r = spawnSync('git', ['-C', existente, 'check-ignore', '-q', '--', real], {
    env: ENTORNO_GIT(), stdio: 'ignore',
  });
  return r.status === 0;
}

function directorioPrivadoDe(s) {
  if (!s.isDirectory()) return 'la carpeta del respaldo no es una carpeta';
  if (typeof process.getuid === 'function' && s.uid !== process.getuid()) return 'la carpeta del respaldo no es del usuario';
  if ((s.mode & 0o077) !== 0) return 'la carpeta del respaldo tiene permisos de grupo u otros (tiene que ser 0700)';
  return null;
}

/** Las carpetas temporales del sistema donde vive el scratchpad. FIJAS: no dependen de `TMPDIR` ni del entorno. */
export const RAICES_TEMPORALES = Object.freeze(['/tmp', '/var/tmp']);

/**
 * ¿Esta ruta sirve de respaldo? Absoluta y normalizada, y en uno de dos lugares (lista POSITIVA: todo lo demás se
 * rechaza, en particular el directorio personal, directo o debajo de él, y cualquier carpeta versionable):
 *
 *  (a) el SCRATCHPAD: dentro de `/tmp` o `/var/tmp` (fijas), sin que ninguna carpeta entre esa raíz y el archivo sea
 *      un repositorio git (lo que haya por encima de la raíz no cuenta);
 *  (b) una carpeta IGNORADA POR GIT del propio proyecto: el destino tiene que ser del MISMO repositorio común que
 *      `raiz` (así vale tanto la copia principal como cualquiera de sus worktrees: `CLIENTES/` vive en la principal) y
 *      `git check-ignore` tiene que decir que esa ruta se ignora.
 *
 * La carpeta del respaldo la crea el script con 0700 si no existe (`guardarRespaldo`). Si ya existe, tiene que ser del
 * usuario y 0700. Si NO existe, la carpeta existente más cercana tiene que ser del usuario (en el caso (a) además no
 * escribible por otros; en el (b) puede ser 0775: `CLIENTES/<CLIENTE>/` suele serlo, y la subcarpeta nueva sí queda
 * 0700). No crea nada. `lectura`: tiene que existir (0600, del usuario); si no, no puede existir (un respaldo nunca se
 * pisa). `permitirExistente`: al aplicar, uno ya existente pasa si es regular, del usuario y 0600. `raiz` y `raices`
 * se inyectan solo en las pruebas.
 */
export function comprobarRespaldo(ruta, { raiz = RAIZ_REPO, raices = RAICES_TEMPORALES, lectura = false, permitirExistente = false } = {}) {
  if (typeof ruta !== 'string' || ruta === '' || ruta.includes('\0')) return { ok: false, motivo: 'falta --respaldo' };
  if (!isAbsolute(ruta) || resolve(ruta) !== ruta) return { ok: false, motivo: '--respaldo tiene que ser una ruta absoluta y normalizada (sin «..», «.» ni barras repetidas)' };
  const resuelta = rutaRealConPendientes(ruta);
  if (resuelta === null) return { ok: false, motivo: 'la ruta del respaldo no se puede resolver' };
  const { real, existente } = resuelta;

  const permitida = raices.map((r) => { try { return realpathSync(r); } catch { return null; } })
    .find((rr) => rr !== null && estaDentro(rr, real)) ?? null;
  const repo = raizGitDe(dirname(real), permitida);
  let enProyecto = false;
  if (repo !== null) {
    const destino = repositorioComun(repo);
    const proyecto = repositorioComun(raiz);
    if (destino === null || proyecto === null) return { ok: false, motivo: 'no se pudo determinar a qué repositorio git pertenece --respaldo' };
    if (destino !== proyecto) return { ok: false, motivo: '--respaldo no puede estar dentro de otro repositorio git' };
    let repoReal;
    try { repoReal = realpathSync(repo); } catch { repoReal = repo; }
    if (!ignoradaPorGit(repoReal, real, existente)) {
      return { ok: false, motivo: '--respaldo dentro del proyecto solo vale en una carpeta ignorada por git (no versionable); use el scratchpad o una carpeta ignorada' };
    }
    enProyecto = true;
  } else if (permitida === null) {
    return { ok: false, motivo: '--respaldo no puede quedar en «~/» ni en otra carpeta personal: use el scratchpad de la sesión o una carpeta ignorada por git del proyecto' };
  }

  const dir = dirname(real);
  if (existente === dir) {
    const malo = directorioPrivadoDe(statSync(dir));
    if (malo) return { ok: false, motivo: malo };
  } else {
    const s = statSync(existente);
    const esMia = typeof process.getuid !== 'function' || s.uid === process.getuid();
    if (!s.isDirectory() || !esMia || (!enProyecto && (s.mode & 0o022) !== 0)) {
      return { ok: false, motivo: '--respaldo tiene que quedar en una carpeta del usuario (la existente más cercana no es suya o, fuera del proyecto, la pueden escribir otros)' };
    }
  }
  let archivo = null;
  try { archivo = lstatSync(ruta); } catch { /* no existe */ }
  if (lectura || (permitirExistente && archivo)) {
    if (!archivo) return { ok: false, motivo: 'el archivo de respaldo no existe' };
    if (!archivo.isFile()) return { ok: false, motivo: 'el respaldo no es un archivo regular (un enlace simbólico se rechaza)' };
    if (typeof process.getuid === 'function' && archivo.uid !== process.getuid()) return { ok: false, motivo: 'el respaldo no es del usuario' };
    if ((archivo.mode & 0o077) !== 0) return { ok: false, motivo: 'el respaldo tiene permisos de grupo u otros (tiene que ser 0600)' };
  } else if (archivo) {
    return { ok: false, motivo: 'ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa; elija otro nombre' };
  }
  return { ok: true, real };
}

// ===========================================================================
// ARGUMENTOS
// ===========================================================================
export function analizarArgumentos(argv, env = process.env, opciones = {}) {
  const problemas = [];
  const valores = { __proto__: null };
  const banderas = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string' || !a.startsWith('--')) { problemas.push('argumento suelto (sin su opción)'); continue; }
    const nombre = a.slice(2);
    if (BANDERAS.includes(nombre)) {
      if (banderas.includes(nombre)) problemas.push(`opción repetida: --${nombre}`);
      banderas.push(nombre);
    } else if (CON_VALOR.includes(nombre)) {
      if (nombre in valores) problemas.push(`opción repetida: --${nombre}`);
      const valor = argv[i + 1];
      if (valor === undefined || valor.startsWith('--')) { problemas.push(`--${nombre} sin valor`); continue; }
      valores[nombre] = valor;
      i += 1;
    } else {
      problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40)}`);
    }
  }
  const aplicar = banderas.includes('aplicar');
  const revertir = banderas.includes('revertir');
  const { proyecto, tenant, respaldo } = valores;
  const confirmo = valores['confirmo-produccion'];

  if (proyecto === undefined) problemas.push('falta --proyecto');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto !== undefined && !proy.ok) problemas.push(proy.motivo);

  if (tenant === undefined) problemas.push('falta --tenant');
  else if (tenant.includes(',')) problemas.push('--tenant admite UN solo comercio por corrida (sin comas)');
  else if (!ID_TENANT.test(tenant)) problemas.push('--tenant inválido (minúsculas, dígitos y guiones, de 3 a 60)');
  else if (esTenantExcluido(tenant, env)) {
    problemas.push('este comercio está EXCLUIDO: a Bellido no se le enciende ni se le cambia la bandera de la pantalla de Conversaciones (decisión del 09/10/2026)');
  }

  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) {
    problemas.push('contra producción, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  }

  let pantalla = null;
  if (revertir) {
    if ('pantalla' in valores) problemas.push('--revertir no admite --pantalla: restaura lo del respaldo');
    if (respaldo === undefined) problemas.push('--revertir exige --respaldo <ruta>');
  } else {
    if (!('pantalla' in valores)) problemas.push('falta --pantalla');
    else {
      const r = validarPantallaConversaciones(valores['pantalla']);
      if (r.ok) pantalla = r.pantalla; else problemas.push(...r.problemas);
    }
    if (aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta> (por omisión no hay respaldo)');
  }
  let respaldoReal = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: revertir, permitirExistente: !revertir });
    if (r.ok) respaldoReal = respaldo; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, pantalla, aplicar, revertir, respaldo: respaldoReal } };
}

// ===========================================================================
// RESPALDO (el archivo se escribe con `guardarRespaldo`: 0700/0600, O_EXCL, O_NOFOLLOW, relectura)
// ===========================================================================
const valorValido = (v) => typeof v === 'string' && PANTALLAS_CONVERSACIONES.includes(v);

/** Lo que se guarda: el valor previo (o su ausencia), el valor escrito y la etiqueta del entorno. Nada del comercio. */
export function contenidoDelRespaldo({ entorno, tenant, ficha, actualizadoEn, escrito }) {
  const presente = Object.prototype.hasOwnProperty.call(ficha, CAMPO);
  return {
    version: 1, campo: CAMPO, entorno, tenant, creadoEn: new Date().toISOString(), fichaActualizadaEn: actualizadoEn,
    previo: { presente, valor: presente ? ficha[CAMPO] : null }, escrito,
  };
}

/**
 * Abre el respaldo UNA vez (sin seguir enlaces), exige archivo regular del usuario y 0600, y lo lee desde el mismo
 * descriptor (sin «comprobar y luego abrir»). Devuelve el JSON crudo: cada script valida su propia forma.
 */
export function leerRespaldoGenerico(ruta, { limite }) {
  let texto;
  let fd;
  try {
    fd = openSync(ruta, constants.O_RDONLY | constants.O_NOFOLLOW);
    const s = fstatSync(fd);
    if (!s.isFile()) return { ok: false, motivo: 'el respaldo no es un archivo regular' };
    if (typeof process.getuid === 'function' && s.uid !== process.getuid()) return { ok: false, motivo: 'el respaldo no es del usuario' };
    if ((s.mode & 0o077) !== 0) return { ok: false, motivo: 'el respaldo tiene permisos de grupo u otros (tiene que ser 0600)' };
    if (s.size > limite) return { ok: false, motivo: 'el respaldo no es un JSON legible' };
    texto = readFileSync(fd, 'utf8');
  } catch {
    return { ok: false, motivo: 'el respaldo no se pudo abrir ni leer' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  try { return { ok: true, respaldo: JSON.parse(texto) }; } catch { return { ok: false, motivo: 'el respaldo no es un JSON legible' }; }
}

export function leerRespaldo(ruta, { entorno, tenant }) {
  const l = leerRespaldoGenerico(ruta, { limite: 64 * 1024 });
  if (!l.ok) return l;
  const r = l.respaldo;
  if (r?.version !== 1 || r.campo !== CAMPO || typeof r.previo !== 'object' || r.previo === null) return { ok: false, motivo: 'el respaldo no tiene la forma esperada' };
  if (r.tenant !== tenant) return { ok: false, motivo: 'el respaldo es de otro comercio' };
  if (r.entorno !== entorno) return { ok: false, motivo: 'el respaldo es de otro entorno (staging, produccion o emulador)' };
  if (typeof r.previo.presente !== 'boolean') return { ok: false, motivo: `el respaldo no dice si «${CAMPO}» existía` };
  if (r.previo.presente ? !valorValido(r.previo.valor) : r.previo.valor !== null) {
    return { ok: false, motivo: 'el respaldo no guardó el valor previo con fidelidad (una pantalla conocida)' };
  }
  if (!valorValido(r.escrito)) return { ok: false, motivo: 'el respaldo no dice qué pantalla se escribió' };
  return { ok: true, respaldo: r };
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================
const iso = (t) => (t && typeof t.toDate === 'function' ? t.toDate().toISOString() : null);
const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';
const mostrar = (ficha, hay) => (hay ? (typeof ficha[CAMPO] === 'string' ? ficha[CAMPO] : '(no es una pantalla conocida)') : 'AUSENTE (equivale a clasica)');

/** LA ÚNICA ESCRITURA A FIRESTORE DE TODO EL ARCHIVO: solo `consolaConversaciones`, con la precondición de la hora leída. */
async function escribirCampo(ref, valor, ultimaActualizacion) {
  await ref.update({ [CAMPO]: valor }, { lastUpdateTime: ultimaActualizacion });
}

async function leerFicha(db, tenant) {
  const ref = db.doc(`tenants/${tenant}`);
  const [snap] = await db.getAll(ref, { fieldMask: [CAMPO, 'nombre'] });
  return { ref, snap };
}

/**
 * Corre la operación ya validada. `deps`: `{ db, FieldValue, log, marcarEscritura, env }`. Devuelve el código de salida.
 * Importable para probar la precondición con una base que cambia entre la lectura y la escritura.
 */
export async function ejecutar(cfg, deps) {
  const { db, FieldValue } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const marcar = deps.marcarEscritura ?? (() => {});
  const rotulo = `${cfg.entorno} · tenant ${cfg.tenant}`;

  // Segunda barrera de Bellido, antes de leer nada más: el id también se comprueba aquí, no solo al analizar los argumentos.
  if (esTenantExcluido(cfg.tenant, deps.env)) { log('\n  ✗ Este comercio está EXCLUIDO (Bellido): no se toca.\n'); return 2; }

  const { ref, snap } = await leerFicha(db, cfg.tenant);
  if (!snap.exists) { log(`\n  ✗ ${cfg.tenant}: no existe la ficha (${cfg.entorno})\n`); return 1; }
  const ficha = snap.data() ?? {};
  if (nombreExcluido(ficha.nombre, deps.env)) {
    log('\n  ✗ El nombre de la ficha corresponde a un comercio EXCLUIDO (Bellido): no se toca. No se escribió nada.\n');
    return 2;
  }
  const hoyPresente = Object.prototype.hasOwnProperty.call(ficha, CAMPO);

  // ------------------------------------------------------------------ revertir
  if (cfg.revertir) {
    const lectura = leerRespaldo(cfg.respaldo, cfg);
    if (!lectura.ok) { log(`\n  ✗ ${lectura.motivo}\n`); return 2; }
    const { previo, escrito } = lectura.respaldo;
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
    log(`  «${CAMPO}» antes del respaldo : ${previo.presente ? previo.valor : 'AUSENTE (se eliminaría el campo)'}`);
    log(`  «${CAMPO}» hoy                : ${mostrar(ficha, hoyPresente)}`);
    const yaIgual = previo.presente ? hoyPresente && ficha[CAMPO] === previo.valor : !hoyPresente;
    if (yaIgual) { log('\n  ✓ La ficha ya está como el respaldo: nada que revertir.\n'); return 0; }
    if (!hoyPresente || ficha[CAMPO] !== escrito) {
      log('\n  ✗ La ficha ya no tiene el valor que escribió este script: alguien lo cambió después (o este script no llegó a escribirlo). '
        + 'Revertir pisaría ese cambio. No se escribe nada; revise la ficha y corríjala a propósito.\n');
      return 2;
    }
    if (!cfg.aplicar) {
      log('\n  Seco: no se escribió nada. Queda un cambio pendiente; agregue --aplicar para revertir.\n');
      return 1;
    }
    marcar('escribiendo');
    try {
      await escribirCampo(ref, previo.presente ? previo.valor : FieldValue.delete(), snap.updateTime);
      marcar('escrito');
    } catch (e) {
      if (esPrecondicion(e)) { marcar('antes'); log('\n  ✗ La ficha cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr el seco.\n'); return 3; }
      throw e;
    }
    const { snap: despues } = await leerFicha(db, cfg.tenant);
    const d = despues.data() ?? {};
    const bien = previo.presente ? d[CAMPO] === previo.valor : !Object.prototype.hasOwnProperty.call(d, CAMPO);
    if (!bien) { log('\n  ✗ La relectura no coincide con lo esperado. Revise la ficha con el seco.\n'); return 3; }
    log(`\n  ✓ Revertido: «${CAMPO}» ${previo.presente ? 'restaurado' : 'eliminado (no existía)'}.\n`);
    return 0;
  }

  // -------------------------------------------------------- seco y aplicar
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
  log(`  «${CAMPO}» hoy      : ${mostrar(ficha, hoyPresente)}`);
  log(`  «${CAMPO}» después  : ${cfg.pantalla}`);
  log(`  cambio              : ${hoyPresente && typeof ficha[CAMPO] === 'string' ? ficha[CAMPO] : 'AUSENTE'} → ${cfg.pantalla}`);

  if (hoyPresente && ficha[CAMPO] === cfg.pantalla) { log(`\n  ✓ «${CAMPO}» ya está escrita con ese valor: nada que hacer.\n`); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (y --respaldo) para escribir.\n'); return 1; }

  // Solo se escribe encima de un valor que se pueda respaldar con fidelidad y restaurar después.
  if (hoyPresente && !valorValido(ficha[CAMPO])) {
    log(`\n  ✗ La ficha ya tiene «${CAMPO}» y no es una pantalla conocida: no se puede respaldar y restaurar con fidelidad. No se escribe nada.\n`);
    return 2;
  }
  try {
    guardarRespaldo(cfg.respaldo, contenidoDelRespaldo({
      entorno: cfg.entorno, tenant: cfg.tenant, ficha, actualizadoEn: iso(snap.updateTime), escrito: cfg.pantalla,
    }));
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa; elija otro nombre. No se escribe nada.\n'); return 2; }
    throw e;
  }
  marcar('respaldo');
  // El respaldo tiene que poder LEERSE de vuelta con la forma que --revertir exige, ANTES de tocar la ficha.
  const comprobado = (deps.leerRespaldo ?? leerRespaldo)(cfg.respaldo, cfg);
  if (!comprobado.ok) {
    log(`\n  ✗ El respaldo recién guardado no sirve para revertir (${comprobado.motivo}). No se escribe nada en la ficha; para repetir use OTRA ruta de --respaldo.\n`);
    return 2;
  }
  log(`\n  Respaldo guardado y releído: ${cfg.respaldo}`);

  marcar('escribiendo');
  try {
    await escribirCampo(ref, cfg.pantalla, snap.updateTime);
    marcar('escrito');
  } catch (e) {
    if (esPrecondicion(e)) { marcar('respaldo'); log('\n  ✗ La ficha cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr el seco y repita --aplicar con OTRA ruta de --respaldo (la anterior ya existe y no se pisa).\n'); return 3; }
    throw e;
  }
  const { snap: despues } = await leerFicha(db, cfg.tenant);
  const d = despues.data() ?? {};
  if (d[CAMPO] !== cfg.pantalla) {
    log('\n  ✗ La relectura no coincide con lo escrito. Revise la ficha con el seco; el respaldo permite revertir.\n');
    return 3;
  }
  log(`\n  ✓ Escrito y releído: «${CAMPO}» = ${d[CAMPO]}.`);
  log('  Para deshacer: --revertir con el mismo respaldo, tenant y proyecto.\n');
  return 0;
}

/** En qué punto está la corrida: 'antes' (nada guardado), 'respaldo' (guardado, la ficha sin escribir), 'escribiendo', 'escrito'. */
const corrida = { estado: 'antes' };

/** Qué decirle al operador si la corrida se corta (Ctrl-C o un error) según el punto en que quedó. */
export function mensajeDeInterrupcion(estado, causa = 'Interrumpido por el operador') {
  if (estado === 'antes') return `\n  ! ${causa} antes de escribir. No se guardó respaldo ni se escribió nada en la ficha.\n`;
  if (estado === 'respaldo') {
    return `\n  ! ${causa} con el respaldo YA guardado y la ficha sin escribir. Para repetir use OTRA ruta de --respaldo (la anterior ya existe y no se pisa).\n`;
  }
  if (estado === 'escrito') {
    return `\n  ! ${causa} DESPUÉS de escribir: la escritura SÍ se hizo y la relectura no se completó. Corra el seco para verificar la ficha; `
      + 'si hay que deshacer, use --revertir con el mismo respaldo, tenant y proyecto.\n';
  }
  return `\n  ! ${causa} DURANTE la escritura: puede haberse escrito o no. Existe el respaldo: corra el seco para ver en qué estado quedó la ficha `
    + 'y, si hay que deshacer, use --revertir con el mismo respaldo, tenant y proyecto.\n';
}

async function principal() {
  const analisis = analizarArgumentos(process.argv.slice(2));
  if (!analisis.ok) {
    console.error(`\n  ✗ ${analisis.problemas.join('\n  ✗ ')}\n\n${USO}\n`);
    process.exit(2);
  }
  const { cfg } = analisis;
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  process.on('SIGINT', () => {
    console.error(mensajeDeInterrupcion(corrida.estado));
    process.exit(130);
  });
  const codigo = await ejecutar(cfg, { db, FieldValue, marcarEscritura: (v) => { corrida.estado = v; } });
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
    if (corrida.estado !== 'antes') console.error(mensajeDeInterrupcion(corrida.estado, 'Falló con un error'));
    process.exit(3);
  }
}
