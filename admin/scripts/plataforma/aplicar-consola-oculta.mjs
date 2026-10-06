/**
 * ESCRIBIR `tenants/{id}.consolaOculta` DE UN SOLO COMERCIO — seco por omisión.
 *
 * QUÉ ES. La lista cerrada de funciones que la consola de ese comercio no pinta
 * (`horario`, `hoy`, `invitar`, `pagar`, `reemplazoQr`; ver
 * `functions/src/central/consola-oculta.ts` y `docs/arquitectura/consola-oculta.md`).
 * Es SOLO PRESENTACIÓN: no cambia lo que el servidor permite. Ningún navegador
 * puede escribirla (`firestore.rules`: `tenants/{id}` no admite escritura de
 * clientes); este script es el único camino. Modelado sobre
 * `aplicar-modulos-tenant.mjs` (#444): seco, freno, respaldo, precondición,
 * relectura y vuelta atrás.
 *
 *   node scripts/plataforma/aplicar-consola-oculta.mjs --proyecto <id> --tenant <id> \
 *        --ocultar a,b,c [--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]
 *   node scripts/plataforma/aplicar-consola-oculta.mjs --revertir --respaldo <ruta> \
 *        --tenant <id> --proyecto <id> [--aplicar] [--confirmo-produccion <tenant>]
 *
 * QUÉ HACE.
 *   · SECO (sin `--aplicar`): lee SOLO el campo `consolaOculta` de `tenants/{id}`,
 *     imprime la lista de hoy y la de después y qué se agrega o se quita. No escribe.
 *   · `--aplicar`: exige `--respaldo` (ruta absoluta, fuera de todo repositorio,
 *     carpeta 0700, archivo 0600, nunca se pisa), guarda el valor previo (o su
 *     AUSENCIA), lo relee, y recién entonces escribe SOLO `consolaOculta` con la
 *     precondición de la hora de actualización leída (si la ficha cambió entre la
 *     lectura y la escritura, aborta sin escribir). Relee y compara. Una escritura.
 *   · `--revertir --aplicar`: restaura desde el respaldo (si el campo no existía, lo
 *     ELIMINA). No pisa un cambio ajeno: si el campo de hoy no es lo que escribió
 *     este script, sale con 2 sin escribir.
 *   · IDEMPOTENTE: si la lista ya es la pedida, sale con 0 sin escribir.
 *   · Un id fuera de la lista cerrada, repetido o vacío se RECHAZA (salida 2).
 *   · Al escribir el campo a la lista de siempre, ninguna otra cosa de la ficha se toca.
 *
 * SALVAGUARDA DE PROYECTO. Lista blanca por variables de entorno
 * `GCP_PROJECT_ID_STAGING` y `GCP_PROJECT_ID_PROD`; contra PRODUCCIÓN, `--aplicar`
 * exige `--confirmo-produccion <tenant>` igual a `--tenant`. Contra el emulador
 * (`demo-*`) exige `FIRESTORE_EMULATOR_HOST` local. El id de un proyecto real NUNCA
 * se imprime: se imprime `staging` o `produccion`.
 *
 * SALIDA. 0: seco sin diferencias, o escritura hecha y comprobada. 1: el seco
 * encontró diferencias (o la ficha no existe). 2: uso o salvaguarda (nada escrito).
 * 3: error de ejecución (solo `e.code ?? e.name`). 130: Ctrl-C.
 *
 * COSTO. Seco: una lectura. `--aplicar`: dos lecturas y UNA escritura de un campo
 * (más el archivo local del respaldo). 0 mensajes por conversación. NO se corre
 * contra producción sin el «sí» de Andres.
 */
import { closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, statSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDS_CONSOLA_OCULTA, esIdConsolaOculta, validarListaConsolaOculta } from '../../functions/src/central/consola-oculta.ts';

const RAIZ_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CAMPO = 'consolaOculta';
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const ID_PROYECTO_REAL = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const ID_PROYECTO_DEMO = /^demo-[a-z0-9-]{1,40}$/;
const HOST_LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):[0-9]{1,5}$/;
const VARIABLES_DE_EMULADOR = [
  'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST',
  'STORAGE_EMULATOR_HOST', 'FIREBASE_EMULATOR_HUB',
];
const CON_VALOR = ['proyecto', 'tenant', 'ocultar', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];

export const USO = '  node scripts/plataforma/aplicar-consola-oculta.mjs --proyecto <id> --tenant <id> --ocultar a,b,c '
  + '[--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]\n'
  + '  node scripts/plataforma/aplicar-consola-oculta.mjs --revertir --respaldo <ruta> --tenant <id> --proyecto <id> '
  + '[--aplicar] [--confirmo-produccion <tenant>]\n'
  + `  ids permitidos: ${IDS_CONSOLA_OCULTA.join(', ')}`;

// ===========================================================================
// SALVAGUARDA DE PROYECTO (pura: recibe el entorno)
// ===========================================================================
export function comprobarProyecto(proyecto, env = process.env) {
  if (typeof proyecto !== 'string' || proyecto === '') return { ok: false, motivo: 'falta --proyecto' };
  const v = (k) => (typeof env[k] === 'string' ? env[k].trim() : '');
  const hayEmulador = VARIABLES_DE_EMULADOR.some((k) => env[k] !== undefined);
  if (proyecto.startsWith('demo-')) {
    if (!ID_PROYECTO_DEMO.test(proyecto)) return { ok: false, motivo: 'el id del proyecto demo no tiene la forma exacta (minúsculas, sin espacios)' };
    if (!HOST_LOCAL.test(v('FIRESTORE_EMULATOR_HOST'))) {
      return { ok: false, motivo: 'un proyecto demo-* solo se usa contra el emulador: falta FIRESTORE_EMULATOR_HOST (127.0.0.1, localhost o [::1] con puerto)' };
    }
    return { ok: true, entorno: 'emulador' };
  }
  if (!ID_PROYECTO_REAL.test(proyecto)) return { ok: false, motivo: 'el id del proyecto no tiene la forma exacta (minúsculas, dígitos y guiones, sin espacios)' };
  if (hayEmulador) return { ok: false, motivo: 'hay variables de emulador puestas y el proyecto no es demo-*: se rechaza por ambiguo' };
  const staging = v('GCP_PROJECT_ID_STAGING');
  const prod = v('GCP_PROJECT_ID_PROD');
  if (!staging) return { ok: false, motivo: 'falta GCP_PROJECT_ID_STAGING: la lista blanca de proyectos está incompleta' };
  if (!prod) return { ok: false, motivo: 'falta GCP_PROJECT_ID_PROD: la lista blanca de proyectos está incompleta' };
  if (!ID_PROYECTO_REAL.test(staging) || !ID_PROYECTO_REAL.test(prod)) {
    return { ok: false, motivo: 'GCP_PROJECT_ID_STAGING o GCP_PROJECT_ID_PROD no tienen la forma de un id de proyecto' };
  }
  if (staging === prod) return { ok: false, motivo: 'GCP_PROJECT_ID_STAGING y GCP_PROJECT_ID_PROD son iguales: no se sabe cuál es cuál' };
  if (proyecto === prod) return { ok: true, entorno: 'produccion' };
  if (proyecto === staging) return { ok: true, entorno: 'staging' };
  return { ok: false, motivo: 'el proyecto no es ninguno de la lista blanca (GCP_PROJECT_ID_STAGING, GCP_PROJECT_ID_PROD)' };
}

// ===========================================================================
// VALORES DEL CAMPO (puros)
// ===========================================================================

/** ¿Es un valor que este script habría escrito (lista de ids cerrados, sin repetidos)? Lo exige el respaldo. */
export function listaValida(v) {
  if (!Array.isArray(v) || v.length === 0 || v.length > IDS_CONSOLA_OCULTA.length) return false;
  return v.every((m, i) => esIdConsolaOculta(m) && v.indexOf(m) === i);
}

/** Mismo conjunto, sin importar el orden. */
export const mismoConjunto = (a, b) => Array.isArray(a) && Array.isArray(b)
  && a.length === b.length && a.every((x) => b.includes(x)) && b.every((x) => a.includes(x));

const lista = (l) => (Array.isArray(l) && l.length ? l.join(', ') : '(ninguno)');

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

function directorioPrivadoDe(s) {
  if (!s.isDirectory()) return 'la carpeta del respaldo no es una carpeta';
  if (typeof process.getuid === 'function' && s.uid !== process.getuid()) return 'la carpeta del respaldo no es del usuario';
  if ((s.mode & 0o077) !== 0) return 'la carpeta del respaldo tiene permisos de grupo u otros (tiene que ser 0700)';
  return null;
}

/**
 * ¿Esta ruta sirve de respaldo? Absoluta y normalizada, en una carpeta DEL USUARIO, fuera de este repositorio y de
 * cualquier otro (ningún ancestro con `.git`). No crea nada. `lectura`: tiene que existir (0600, del usuario);
 * si no, no puede existir (un respaldo nunca se pisa). `permitirExistente`: al aplicar, uno ya existente pasa si
 * es regular, del usuario y 0600 (reaplicar el mismo comando sale «nada que hacer»); si hay que escribir encima,
 * `guardarRespaldo` lo rechaza igual (`O_EXCL`).
 */
export function comprobarRespaldo(ruta, { raiz = RAIZ_REPO, lectura = false, permitirExistente = false } = {}) {
  if (typeof ruta !== 'string' || ruta === '' || ruta.includes('\0')) return { ok: false, motivo: 'falta --respaldo' };
  if (!isAbsolute(ruta) || resolve(ruta) !== ruta) return { ok: false, motivo: '--respaldo tiene que ser una ruta absoluta y normalizada (sin «..», «.» ni barras repetidas)' };
  const resuelta = rutaRealConPendientes(ruta);
  if (resuelta === null) return { ok: false, motivo: 'la ruta del respaldo no se puede resolver' };
  const { real, existente } = resuelta;
  let raizReal;
  try { raizReal = realpathSync(raiz); } catch { raizReal = raiz; }
  if (real === raizReal || estaDentro(raizReal, real)) return { ok: false, motivo: '--respaldo no puede estar dentro del repositorio' };
  const partes = real.split(sep).filter((p) => p !== '');
  for (let n = 0; n < partes.length; n++) {
    if (existsSync(join(sep, ...partes.slice(0, n), '.git'))) return { ok: false, motivo: '--respaldo no puede estar dentro de un repositorio git' };
  }
  const dir = dirname(real);
  if (existente === dir) {
    const malo = directorioPrivadoDe(statSync(dir));
    if (malo) return { ok: false, motivo: malo };
  } else {
    const s = statSync(existente);
    const esMia = typeof process.getuid !== 'function' || s.uid === process.getuid();
    if (!s.isDirectory() || !esMia || (s.mode & 0o022) !== 0) {
      return { ok: false, motivo: '--respaldo tiene que quedar en una carpeta del usuario (la existente más cercana no es suya o la pueden escribir otros)' };
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

  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) {
    problemas.push('contra producción, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  }

  let ocultar = null;
  if (revertir) {
    if ('ocultar' in valores) problemas.push('--revertir no admite --ocultar: restaura lo del respaldo');
    if (respaldo === undefined) problemas.push('--revertir exige --respaldo <ruta>');
  } else {
    if (!('ocultar' in valores)) problemas.push('falta --ocultar');
    else {
      const r = validarListaConsolaOculta(valores['ocultar']);
      if (r.ok) ocultar = r.lista; else problemas.push(...r.problemas);
    }
    if (aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta> (por omisión no hay respaldo)');
  }
  let respaldoReal = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: revertir, permitirExistente: !revertir });
    if (r.ok) respaldoReal = respaldo; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, ocultar, aplicar, revertir, respaldo: respaldoReal } };
}

// ===========================================================================
// RESPALDO: escritura local con permisos 0700/0600 y relectura
// ===========================================================================

/** Lo que se guarda: ids y nombres de ids, la hora de la ficha y la etiqueta del entorno. Nada del comercio. */
export function contenidoDelRespaldo({ entorno, tenant, ficha, actualizadoEn, escrito }) {
  const presente = Object.prototype.hasOwnProperty.call(ficha, CAMPO);
  return {
    version: 1, entorno, tenant, creadoEn: new Date().toISOString(), fichaActualizadaEn: actualizadoEn,
    previo: { presente, valor: presente ? ficha[CAMPO] : null }, escrito,
  };
}

export function guardarRespaldo(ruta, contenido) {
  const dir = dirname(ruta);
  const creada = mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fdDir = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    if (creada !== undefined) fchmodSync(fdDir, 0o700);
    const malo = directorioPrivadoDe(fstatSync(fdDir));
    if (malo) throw Object.assign(new Error(malo), { code: 'respaldo-carpeta' });
    const texto = `${JSON.stringify(contenido, null, 2)}\n`;
    const fd = openSync(ruta, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      fchmodSync(fd, 0o600);
      writeSync(fd, texto);
      fsyncSync(fd);
      const s = fstatSync(fd);
      const leido = Buffer.alloc(s.size);
      const n = readSync(fd, leido, 0, s.size, 0);
      const bien = s.isFile() && (s.mode & 0o777) === 0o600
        && (typeof process.getuid !== 'function' || s.uid === process.getuid())
        && n === s.size && leido.toString('utf8') === texto;
      if (!bien) throw Object.assign(new Error('el respaldo no quedó como se escribió'), { code: 'respaldo-relectura' });
    } finally {
      closeSync(fd);
    }
  } finally {
    closeSync(fdDir);
  }
}

const MAXIMO_RESPALDO = 64 * 1024;

export function leerRespaldo(ruta, { entorno, tenant }) {
  let texto;
  let fd;
  try {
    fd = openSync(ruta, constants.O_RDONLY | constants.O_NOFOLLOW);
    const s = fstatSync(fd);
    if (!s.isFile()) return { ok: false, motivo: 'el respaldo no es un archivo regular' };
    if (typeof process.getuid === 'function' && s.uid !== process.getuid()) return { ok: false, motivo: 'el respaldo no es del usuario' };
    if ((s.mode & 0o077) !== 0) return { ok: false, motivo: 'el respaldo tiene permisos de grupo u otros (tiene que ser 0600)' };
    if (s.size > MAXIMO_RESPALDO) return { ok: false, motivo: 'el respaldo no es un JSON legible' };
    texto = readFileSync(fd, 'utf8');
  } catch {
    return { ok: false, motivo: 'el respaldo no se pudo abrir ni leer' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  let r;
  try { r = JSON.parse(texto); } catch { return { ok: false, motivo: 'el respaldo no es un JSON legible' }; }
  if (r?.version !== 1 || typeof r.previo !== 'object' || r.previo === null) return { ok: false, motivo: 'el respaldo no tiene la forma esperada' };
  if (r.tenant !== tenant) return { ok: false, motivo: 'el respaldo es de otro comercio' };
  if (r.entorno !== entorno) return { ok: false, motivo: 'el respaldo es de otro entorno (staging, produccion o emulador)' };
  if (typeof r.previo.presente !== 'boolean') return { ok: false, motivo: 'el respaldo no dice si «consolaOculta» existía' };
  if (r.previo.presente ? !listaValida(r.previo.valor) : r.previo.valor !== null) {
    return { ok: false, motivo: 'el respaldo no guardó el valor previo con fidelidad (lista de ids cerrados, sin repetidos)' };
  }
  if (!listaValida(r.escrito)) return { ok: false, motivo: 'el respaldo no dice qué lista se escribió' };
  return { ok: true, respaldo: r };
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================
const iso = (t) => (t && typeof t.toDate === 'function' ? t.toDate().toISOString() : null);
const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';

/** LA ÚNICA ESCRITURA A FIRESTORE DE TODO EL ARCHIVO: solo `consolaOculta`, con la precondición de la hora leída. */
async function escribirCampo(ref, valor, ultimaActualizacion) {
  await ref.update({ [CAMPO]: valor }, { lastUpdateTime: ultimaActualizacion });
}

async function leerFicha(db, tenant) {
  const ref = db.doc(`tenants/${tenant}`);
  const [snap] = await db.getAll(ref, { fieldMask: [CAMPO] });
  return { ref, snap };
}

export function mensajeDeInterrupcion(estado) {
  if (estado === 'antes') return '\n  ! Interrumpido por el operador antes de escribir en la ficha. No se escribió nada en la ficha.\n';
  if (estado === 'escrito') {
    return '\n  ! Interrumpido DESPUÉS de escribir: la escritura SÍ se hizo y la relectura no se completó. '
      + 'Corra el seco para verificar la ficha; si hay que deshacer, use --revertir con el mismo respaldo, tenant y proyecto.\n';
  }
  return '\n  ! Interrumpido DURANTE la escritura: puede haberse escrito o no. Corra el seco para ver en qué estado quedó la ficha.\n';
}

/**
 * Corre la operación ya validada. `deps`: `{ db, FieldValue, log, marcarEscritura }`. Devuelve el código de salida.
 * Importable para probar la precondición con una base que cambia entre la lectura y la escritura.
 */
export async function ejecutar(cfg, deps) {
  const { db, FieldValue } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const marcar = deps.marcarEscritura ?? (() => {});
  const rotulo = `${cfg.entorno} · tenant ${cfg.tenant}`;

  const { ref, snap } = await leerFicha(db, cfg.tenant);
  if (!snap.exists) { log(`\n  ✗ ${cfg.tenant}: no existe la ficha (${cfg.entorno})\n`); return 1; }
  const ficha = snap.data() ?? {};
  const hoyPresente = Object.prototype.hasOwnProperty.call(ficha, CAMPO);

  // ------------------------------------------------------------------ revertir
  if (cfg.revertir) {
    const lectura = leerRespaldo(cfg.respaldo, cfg);
    if (!lectura.ok) { log(`\n  ✗ ${lectura.motivo}\n`); return 2; }
    const { previo, escrito } = lectura.respaldo;
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
    log(`  «${CAMPO}» antes del respaldo : ${previo.presente ? lista(previo.valor) : 'AUSENTE (se eliminaría el campo)'}`);
    log(`  «${CAMPO}» hoy                : ${hoyPresente ? (Array.isArray(ficha[CAMPO]) ? lista(ficha[CAMPO]) : '(no es una lista)') : 'AUSENTE'}`);
    const yaIgual = previo.presente
      ? hoyPresente && JSON.stringify(ficha[CAMPO]) === JSON.stringify(previo.valor)
      : !hoyPresente;
    if (yaIgual) { log('\n  ✓ La ficha ya está como el respaldo: nada que revertir.\n'); return 0; }
    if (!hoyPresente || !mismoConjunto(ficha[CAMPO], escrito)) {
      log('\n  ✗ La ficha ya no tiene la lista que escribió este script: alguien la cambió después (o este script no llegó a escribirla). '
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
    const bien = previo.presente
      ? Array.isArray(d[CAMPO]) && JSON.stringify(d[CAMPO]) === JSON.stringify(previo.valor)
      : !Object.prototype.hasOwnProperty.call(d, CAMPO);
    if (!bien) { log('\n  ✗ La relectura no coincide con lo esperado. Revise la ficha con el seco.\n'); return 3; }
    log(`\n  ✓ Revertido: «${CAMPO}» ${previo.presente ? 'restaurado' : 'eliminado (no existía)'}.\n`);
    return 0;
  }

  // -------------------------------------------------------- seco y aplicar
  const hoy = hoyPresente && Array.isArray(ficha[CAMPO]) ? ficha[CAMPO] : [];
  const agrega = cfg.ocultar.filter((i) => !hoy.includes(i));
  const quita = hoy.filter((i) => !cfg.ocultar.includes(i));
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
  log(`  «${CAMPO}» hoy        : ${hoyPresente ? (Array.isArray(ficha[CAMPO]) ? lista(ficha[CAMPO]) : '(no es una lista)') : 'AUSENTE'}`);
  log(`  «${CAMPO}» después    : ${lista(cfg.ocultar)}`);
  log(`  se oculta (agrega)    : ${lista(agrega)}`);
  log(`  se vuelve a mostrar   : ${lista(quita)}`);

  const yaEscrita = hoyPresente && JSON.stringify(ficha[CAMPO]) === JSON.stringify(cfg.ocultar);
  if (yaEscrita) { log('\n  ✓ «consolaOculta» ya está escrita con esa lista: nada que hacer.\n'); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (y --respaldo) para escribir.\n'); return 1; }

  // Solo se escribe encima de un valor que se pueda respaldar con fidelidad y restaurar después.
  if (hoyPresente && !listaValida(ficha[CAMPO])) {
    log('\n  ✗ La ficha ya tiene «consolaOculta» y no es una lista válida de ids cerrados: no se puede respaldar y restaurar con fidelidad. No se escribe nada.\n');
    return 2;
  }
  try {
    guardarRespaldo(cfg.respaldo, contenidoDelRespaldo({
      entorno: cfg.entorno, tenant: cfg.tenant, ficha, actualizadoEn: iso(snap.updateTime), escrito: cfg.ocultar,
    }));
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa; elija otro nombre. No se escribe nada.\n'); return 2; }
    throw e;
  }
  log(`\n  Respaldo guardado y releído: ${cfg.respaldo}`);

  marcar('escribiendo');
  try {
    await escribirCampo(ref, cfg.ocultar, snap.updateTime);
    marcar('escrito');
  } catch (e) {
    if (esPrecondicion(e)) { marcar('antes'); log('\n  ✗ La ficha cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr el seco.\n'); return 3; }
    throw e;
  }
  const { snap: despues } = await leerFicha(db, cfg.tenant);
  const d = despues.data() ?? {};
  if (!Array.isArray(d[CAMPO]) || JSON.stringify(d[CAMPO]) !== JSON.stringify(cfg.ocultar)) {
    log('\n  ✗ La relectura no coincide con lo escrito. Revise la ficha con el seco; el respaldo permite revertir.\n');
    return 3;
  }
  log(`\n  ✓ Escrito y releído: «${CAMPO}» = ${lista(d[CAMPO])}.`);
  log('  Para deshacer: --revertir con el mismo respaldo, tenant y proyecto.\n');
  return 0;
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
  let estado = 'antes';
  process.on('SIGINT', () => {
    console.error(mensajeDeInterrupcion(estado));
    process.exit(130);
  });
  const codigo = await ejecutar(cfg, { db, FieldValue, marcarEscritura: (v) => { estado = v; } });
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
