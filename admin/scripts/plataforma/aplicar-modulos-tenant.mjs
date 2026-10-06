/**
 * ESCRIBIR `tenants/{id}.modulos` DE UN SOLO COMERCIO — seco por omisión.
 *
 * POR QUÉ EXISTE. `migrar-modulos.mjs` (#421) demuestra, en seco, qué cambiaría
 * al pasar un comercio de `flujos` a `modulos`. Este script es el paso que
 * escribe, de a UN comercio por corrida, con freno, respaldo y vuelta atrás.
 * El caso que lo motiva: `tenants/qtaco` tiene `flujos: ['venta']` y no tiene
 * `modulos`; debe pasar a `productos, campanas, cobros, pedidos, catalogo-web`
 * (sin `inventario`). La ÚNICA capacidad que cambia es `inventario`, y el script
 * solo escribe si quien lo corre declara exactamente eso.
 *
 *   node scripts/plataforma/aplicar-modulos-tenant.mjs --proyecto <id> --tenant <id> \
 *        --modulos a,b,c [--acepto-diferencias inventario] [--aplicar] [--respaldo <ruta>] \
 *        [--confirmo-produccion <tenant>]
 *   node scripts/plataforma/aplicar-modulos-tenant.mjs --revertir --respaldo <ruta> \
 *        --tenant <id> --proyecto <id> [--aplicar] [--confirmo-produccion <tenant>]
 *
 * QUÉ HACE.
 *   · SECO (sin `--aplicar`): lee SOLO `tenants/{id}` (campos `flujos`, `vertical`
 *     y `modulos`), imprime la lista de módulos de antes y de después, los siete
 *     chequeos de `migrar-modulos.mjs` (antes = lo que cada lector decide hoy con
 *     `flujos`; después = la lista nueva) y las capacidades que cambian. No
 *     escribe ni abre una escritura.
 *   · `--aplicar`: exige que las capacidades que cambian sean EXACTAMENTE las de
 *     `--acepto-diferencias` (el freno contra quitar algo por error) y que la
 *     ficha no difiera por sí sola entre `flujos` y el registro. Exige
 *     `--respaldo`: guarda ahí el valor previo de `modulos` (o su AUSENCIA) y
 *     `flujos`/`vertical`, lo vuelve a leer, y recién entonces escribe SOLO el
 *     campo `modulos`, con la precondición de la hora de actualización leída (si la
 *     ficha cambió entre la lectura y la escritura, aborta sin escribir). No toca
 *     `flujos` ni `vertical`. Después relee y compara. Una escritura por corrida.
 *   · `--revertir --aplicar`: restaura desde el respaldo (si `modulos` no
 *     existía, ELIMINA el campo; si existía, lo restaura), con la misma
 *     precondición y relectura. Sin `--aplicar` es seco.
 *
 * LA LISTA MANDA. Las reglas dicen «si hay lista, manda la lista»: un módulo que
 * no está en `modulos` deja de abrirse aunque `flujos` lo diga. Por eso se rechaza
 * una lista sin `productos` y `campanas` (los módulos comunes): sin ellos el
 * catálogo y las campañas dejan de escribirse.
 *
 * RESPALDO. Ruta absoluta en una carpeta del usuario (la existente más cercana es
 * suya y no la escribe nadie más), FUERA de todo repositorio. El directorio se crea con permisos 0700 y el archivo con 0600; uno
 * ya existente con permisos de grupo u otros se rechaza, y un archivo de respaldo
 * ya existente nunca se pisa. Contiene solo ids, nombres de módulos, la hora de la
 * ficha y la etiqueta del entorno (`staging`/`produccion`): nada de datos del
 * comercio ni de sus clientes, ni el id del proyecto.
 *
 * SALVAGUARDA DE PROYECTO. Lista blanca por variables de entorno (las de GitHub):
 * `GCP_PROJECT_ID_STAGING` y `GCP_PROJECT_ID_PROD`; el proyecto tiene que ser
 * exactamente una de las dos (minúsculas, sin espacios). Contra PRODUCCIÓN,
 * `--aplicar` exige además `--confirmo-produccion <tenant>` igual a `--tenant`.
 * Contra el emulador (`demo-*`) exige `FIRESTORE_EMULATOR_HOST` local; con un
 * proyecto real, cualquier variable de emulador se rechaza por ambigua. Cualquier
 * otra combinación sale con 2, también en seco. El id de un proyecto real NUNCA se
 * imprime (el repositorio es público): se imprime `staging` o `produccion`.
 *
 * SALIDA. 0: seco sin diferencias, o escritura hecha y comprobada. 1: el seco
 * encontró diferencias (o la ficha pedida no existe). 2: uso o salvaguarda (nada
 * leído de la nube más allá de lo dicho; nada escrito). 3: error de ejecución
 * (permiso, red, precondición, relectura que no coincide: se imprime solo
 * `e.code ?? e.name`, nunca el mensaje). 130: Ctrl-C. Imprime solo ids de tenant,
 * nombres de módulos, banderas y conteos.
 *
 * COSTO. Seco: una lectura de la ficha. `--aplicar`: dos lecturas más y UNA
 * escritura de un campo (más el archivo local del respaldo). 0 mensajes por
 * conversación. NO se corre contra producción sin el «sí» de Andres.
 */
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDS_MODULOS, MODULOS_COMUNES_HOY, modulosDeFicha } from '../../functions/src/registro.ts';
import { comparar } from './migrar-modulos.mjs';

/** La raíz de ESTE repositorio (admin/scripts/plataforma → tres niveles arriba). */
const RAIZ_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CAMPOS = ['flujos', 'vertical', 'modulos'];
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const ID_PROYECTO_REAL = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const ID_PROYECTO_DEMO = /^demo-[a-z0-9-]{1,40}$/;
const HOST_LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):[0-9]{1,5}$/;
const VARIABLES_DE_EMULADOR = [
  'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST',
  'STORAGE_EMULATOR_HOST', 'FIREBASE_EMULATOR_HUB',
];
const CON_VALOR = ['proyecto', 'tenant', 'modulos', 'acepto-diferencias', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];

export const USO = '  node scripts/plataforma/aplicar-modulos-tenant.mjs --proyecto <id> --tenant <id> --modulos a,b,c '
  + '[--acepto-diferencias x,y] [--aplicar] [--respaldo <ruta>] [--confirmo-produccion <tenant>]\n'
  + '  node scripts/plataforma/aplicar-modulos-tenant.mjs --revertir --respaldo <ruta> --tenant <id> --proyecto <id> '
  + '[--aplicar] [--confirmo-produccion <tenant>]';

// ===========================================================================
// SALVAGUARDA DE PROYECTO (pura: recibe el entorno)
// ===========================================================================

/**
 * ¿Este proyecto es un destino permitido? Devuelve `{ ok, entorno, motivo }`, con `entorno`
 * `staging`, `produccion` o `emulador`. NUNCA devuelve ni imprime el id de un proyecto real.
 */
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
  // El proyecto se compara tal cual: ni se recorta ni se pasa a minúsculas. Un espacio, un
  // salto de línea o una mayúscula de más no pueden esquivar la lista blanca.
  if (!ID_PROYECTO_REAL.test(proyecto)) return { ok: false, motivo: 'el id del proyecto no tiene la forma exacta (minúsculas, dígitos y guiones, sin espacios)' };
  // Un proyecto real con un emulador a medio configurar es una trampa: el SDK Admin iría al
  // emulador con el nombre de un proyecto de verdad. Basta que la variable EXISTA, aunque esté vacía.
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
// VALIDACIONES DE LISTAS DE MÓDULOS (puras)
// ===========================================================================

/** Los módulos comunes que toda lista debe traer: las reglas dicen «si hay lista, manda la lista». */
export const COMUNES_OBLIGATORIOS = MODULOS_COMUNES_HOY;

/**
 * Valida una lista `a,b,c` de módulos. `{ ok, lista }` o `{ ok: false, problemas }`.
 * `exigirComunes`: la lista de `--modulos` lleva `productos` y `campanas`; la de
 * `--acepto-diferencias` no (nombra lo que cambia, que puede ser cualquier módulo).
 */
export function validarListaDeModulos(texto, nombre, { exigirComunes }) {
  const problemas = [];
  if (typeof texto !== 'string' || texto === '') return { ok: false, problemas: [`${nombre} vacío`] };
  const lista = texto.split(',');
  for (const m of lista) {
    if (m === '') problemas.push(`${nombre} trae un elemento vacío`);
    else if (!IDS_MODULOS.includes(m)) problemas.push(`${nombre}: módulo desconocido (${m.slice(0, 40)})`);
  }
  lista.forEach((m, i) => {
    if (m !== '' && lista.indexOf(m) !== i) problemas.push(`${nombre}: módulo repetido (${m.slice(0, 40)})`);
  });
  if (exigirComunes) {
    for (const c of COMUNES_OBLIGATORIOS) {
      if (!lista.includes(c)) {
        problemas.push(`${nombre} no contiene el módulo común «${c}»: con una lista, manda la lista, y sin él `
          + (c === 'productos' ? 'el catálogo' : 'las campañas') + ' dejan de escribirse');
      }
    }
  }
  return problemas.length ? { ok: false, problemas } : { ok: true, lista };
}

// ===========================================================================
// RUTA DEL RESPALDO (el sistema de archivos solo se mira, no se escribe)
// ===========================================================================

/** ¿`hijo` está estrictamente dentro de `padre`? Ambas rutas ya resueltas. */
const estaDentro = (padre, hijo) => {
  const r = relative(padre, hijo);
  return r !== '' && !r.startsWith('..') && !isAbsolute(r);
};

/**
 * La ruta real (sin enlaces simbólicos) de una ruta absoluta, y su ancestro existente más cercano
 * (`existente`). Lo que falta por crear se agrega tal cual. `null` si ni la raíz se puede resolver.
 */
function rutaRealConPendientes(absoluta) {
  const partes = absoluta.split(sep).filter((p) => p !== '');
  // El último tramo (el archivo) nunca se resuelve: un enlace simbólico ahí se detecta aparte, con `lstat`.
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

/** ¿El directorio es del usuario y sin permisos de grupo ni otros? */
function directorioPrivado(dir) {
  const s = statSync(dir);
  if (!s.isDirectory()) return 'la carpeta del respaldo no es una carpeta';
  if (typeof process.getuid === 'function' && s.uid !== process.getuid()) return 'la carpeta del respaldo no es del usuario';
  if ((s.mode & 0o077) !== 0) return 'la carpeta del respaldo tiene permisos de grupo u otros (tiene que ser 0700)';
  return null;
}

/**
 * ¿Esta ruta sirve de respaldo? Absoluta, normalizada, en una carpeta DEL USUARIO (la existente más
 * cercana es suya y no la escribe nadie más; una carpeta ya existente del respaldo, además, es 0700),
 * fuera de este repositorio y de cualquier otro (ningún ancestro con `.git`). No crea nada. `lectura`:
 * el archivo tiene que existir y ser del usuario con 0600 (lo que `--revertir` exige); si no, no puede
 * existir (nunca se pisa un respaldo).
 */
export function comprobarRespaldo(ruta, { raiz = RAIZ_REPO, lectura = false } = {}) {
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
    const malo = directorioPrivado(dir);
    if (malo) return { ok: false, motivo: malo };
  } else {
    // La carpeta se va a crear: la que existe más cerca tiene que ser del usuario y no escribible por otros.
    const s = statSync(existente);
    const esMia = typeof process.getuid !== 'function' || s.uid === process.getuid();
    if (!s.isDirectory() || !esMia || (s.mode & 0o022) !== 0) {
      return { ok: false, motivo: '--respaldo tiene que quedar en una carpeta del usuario (la existente más cercana no es suya o la pueden escribir otros)' };
    }
  }
  let archivo = null;
  // `lstat` sobre la ruta DADA: no sigue el último componente, así un enlace simbólico se ve como tal.
  try { archivo = lstatSync(ruta); } catch { /* no existe */ }
  if (lectura) {
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

/**
 * Lee y valida los argumentos y la salvaguarda. Pura salvo por mirar el sistema de archivos
 * (ruta del respaldo). Devuelve `{ ok: true, cfg }` o `{ ok: false, problemas }`. Los problemas
 * nunca incluyen el id del proyecto ni el valor de un argumento desconocido.
 */
export function analizarArgumentos(argv, env = process.env, opciones = {}) {
  const problemas = [];
  // Objeto sin prototipo y listas: sin `Map.set` ni `Set.add`, para que el texto del script no tenga más
  // métodos de escritura que el `update` de `modulos` (una prueba lo lee).
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
      // Se corta en «=» para no devolver el valor (podría ser el id de un proyecto).
      problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40)}`);
    }
  }

  const aplicar = banderas.includes('aplicar');
  const revertir = banderas.includes('revertir');
  const proyecto = valores['proyecto'];
  const tenant = valores['tenant'];
  const respaldo = valores['respaldo'];
  const confirmo = valores['confirmo-produccion'];

  // Proyecto (la salvaguarda corre también en seco).
  if (proyecto === undefined) problemas.push('falta --proyecto');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto !== undefined && !proy.ok) problemas.push(proy.motivo);

  // UN tenant por corrida.
  if (tenant === undefined) problemas.push('falta --tenant');
  else if (tenant.includes(',')) problemas.push('--tenant admite UN solo comercio por corrida (sin comas)');
  else if (!ID_TENANT.test(tenant)) problemas.push('--tenant inválido (minúsculas, dígitos y guiones, de 3 a 60)');

  // Confirmación de producción.
  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) {
    problemas.push('contra producción, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  }

  let modulos = null;
  let acepto = [];
  if (revertir) {
    if ('modulos' in valores) problemas.push('--revertir no admite --modulos: restaura lo del respaldo');
    if ('acepto-diferencias' in valores) problemas.push('--revertir no admite --acepto-diferencias');
    if (respaldo === undefined) problemas.push('--revertir exige --respaldo <ruta>');
  } else {
    if (!('modulos' in valores)) problemas.push('falta --modulos');
    else {
      const r = validarListaDeModulos(valores['modulos'], '--modulos', { exigirComunes: true });
      if (r.ok) modulos = r.lista; else problemas.push(...r.problemas);
    }
    if ('acepto-diferencias' in valores) {
      const r = validarListaDeModulos(valores['acepto-diferencias'], '--acepto-diferencias', { exigirComunes: false });
      if (r.ok) acepto = r.lista; else problemas.push(...r.problemas);
    }
    if (aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta> (por omisión no hay respaldo)');
  }
  let respaldoReal = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: revertir });
    if (r.ok) respaldoReal = respaldo; else problemas.push(r.motivo);
  }

  if (problemas.length) return { ok: false, problemas };
  return {
    ok: true,
    cfg: { proyecto, entorno: proy.entorno, tenant, modulos, acepto, aplicar, revertir, respaldo: respaldoReal },
  };
}

// ===========================================================================
// EVALUACIÓN (pura): qué cambia y si se puede escribir
// ===========================================================================

const sinModulos = (ficha) => {
  const { modulos: _quitado, ...resto } = ficha ?? {};
  return resto;
};
const igualesComoConjunto = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Compara la ficha con la lista destino. `cambian`: los módulos cuya presencia cambia respecto de lo que
 * decide HOY el registro (la lista `modulos` si ya existe, si no los `flujos`). `diferencias`: los
 * chequeos de `migrar-modulos` (antes = `flujos`; después = la lista). `propias`: las diferencias que la
 * ficha ya tiene por sí sola entre `flujos` y el registro (con la derivación normal): si las hay, un
 * freno por módulos no alcanza para decir qué se cambia.
 */
export function evaluar(ficha, destino) {
  const f = ficha ?? {};
  const actual = modulosDeFicha(f);
  const despues = modulosDeFicha({ modulos: destino });
  return {
    actual,
    despues,
    cambian: IDS_MODULOS.filter((m) => actual.includes(m) !== despues.includes(m)),
    diferencias: comparar(f, destino).diferencias,
    propias: comparar(sinModulos(f)).diferencias,
    yaEscrita: Array.isArray(f.modulos) && JSON.stringify(f.modulos) === JSON.stringify(destino),
  };
}

/** ¿Se puede aplicar? `{ ok, motivo }`: el freno de `--acepto-diferencias` y el de la ficha. */
export function permitirAplicar(evaluacion, acepto) {
  if (evaluacion.propias.length > 0) {
    return {
      ok: false,
      motivo: `la ficha ya difiere por sí sola entre «flujos» y el registro (${evaluacion.propias.map((d) => d.chequeo).join('; ')}): `
        + 'corríjase primero; este script solo cambia módulos declarados',
    };
  }
  if (!igualesComoConjunto(evaluacion.cambian, acepto)) {
    return {
      ok: false,
      motivo: `las capacidades que cambian (${evaluacion.cambian.join(', ') || 'ninguna'}) no son exactamente las declaradas `
        + `en --acepto-diferencias (${acepto.join(', ') || 'ninguna'}): no se escribe nada`,
    };
  }
  return { ok: true };
}

// ===========================================================================
// RESPALDO: escritura local con permisos 0700/0600 y relectura
// ===========================================================================

const textos = (v) => (Array.isArray(v) && v.length <= 50 && v.every((x) => typeof x === 'string' && x.length <= 60) ? [...v] : null);

/** Lo que se guarda de la ficha: solo estos campos, y nada que no sea un id o un nombre de módulo. */
export function contenidoDelRespaldo({ entorno, tenant, ficha, actualizadoEn, escrito }) {
  const tiene = (c) => Object.prototype.hasOwnProperty.call(ficha, c);
  return {
    version: 1,
    entorno,
    tenant,
    creadoEn: new Date().toISOString(),
    fichaActualizadaEn: actualizadoEn,
    previo: {
      modulosPresente: tiene('modulos'),
      modulos: tiene('modulos') ? textos(ficha.modulos) : null,
      flujos: !tiene('flujos') ? '(ausente)' : (textos(ficha.flujos) ?? '(no es una lista de textos)'),
      vertical: !tiene('vertical') ? '(ausente)' : (typeof ficha.vertical === 'string' && ficha.vertical.length <= 60 ? ficha.vertical : '(no es un texto)'),
    },
    escrito,
  };
}

/** Escribe el respaldo (carpeta 0700, archivo 0600, sin pisar) y lo relee. Lanza si no coincide. */
export function guardarRespaldo(ruta, contenido) {
  const dir = dirname(ruta);
  const existiaCarpeta = existsSync(dir);
  if (!existiaCarpeta) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  }
  const malo = directorioPrivado(dir);
  if (malo) throw Object.assign(new Error(malo), { code: 'respaldo-carpeta' });
  const texto = `${JSON.stringify(contenido, null, 2)}\n`;
  const fd = openSync(ruta, 'wx', 0o600);
  try {
    writeSync(fd, texto);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(ruta, 0o600);
  const s = statSync(ruta);
  if ((s.mode & 0o777) !== 0o600 || readFileSync(ruta, 'utf8') !== texto) {
    throw Object.assign(new Error('el respaldo no quedó como se escribió'), { code: 'respaldo-relectura' });
  }
}

/** Lee y valida un respaldo para `--revertir`. `{ ok, respaldo }` o `{ ok: false, motivo }`. */
export function leerRespaldo(ruta, { entorno, tenant }) {
  let r;
  try { r = JSON.parse(readFileSync(ruta, 'utf8')); } catch { return { ok: false, motivo: 'el respaldo no es un JSON legible' }; }
  const esTextos = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (r?.version !== 1 || typeof r.previo !== 'object' || r.previo === null) return { ok: false, motivo: 'el respaldo no tiene la forma esperada' };
  if (r.tenant !== tenant) return { ok: false, motivo: 'el respaldo es de otro comercio' };
  if (r.entorno !== entorno) return { ok: false, motivo: 'el respaldo es de otro entorno (staging, produccion o emulador)' };
  if (typeof r.previo.modulosPresente !== 'boolean') return { ok: false, motivo: 'el respaldo no dice si «modulos» existía' };
  if (r.previo.modulosPresente ? !esTextos(r.previo.modulos) : r.previo.modulos !== null) {
    return { ok: false, motivo: 'el respaldo no guardó el valor previo de «modulos» con fidelidad' };
  }
  if (!esTextos(r.escrito)) return { ok: false, motivo: 'el respaldo no dice qué lista se escribió' };
  return { ok: true, respaldo: r };
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================

const iso = (t) => (t && typeof t.toDate === 'function' ? t.toDate().toISOString() : null);
const lista = (l) => (l.length ? l.join(', ') : '(ninguno)');
const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';

/**
 * LA ÚNICA ESCRITURA A FIRESTORE DE TODO EL ARCHIVO. Solo el campo `modulos`, con la precondición de la
 * hora de actualización leída: si la ficha cambió después, Firestore la rechaza (código 9) y no se escribe.
 */
async function escribirModulos(ref, valor, ultimaActualizacion) {
  await ref.update({ modulos: valor }, { lastUpdateTime: ultimaActualizacion });
}

/** Lee la ficha (solo flujos, vertical y modulos). */
async function leerFicha(db, tenant) {
  const ref = db.doc(`tenants/${tenant}`);
  const [snap] = await db.getAll(ref, { fieldMask: CAMPOS });
  return { ref, snap };
}

/**
 * Corre la operación ya validada. `deps`: `{ db, FieldValue, log, escribiendo }`. Devuelve el código
 * de salida. Importable para probar la precondición con una base que cambia entre la lectura y la escritura.
 */
export async function ejecutar(cfg, deps) {
  const { db, FieldValue } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const marcar = deps.marcarEscritura ?? (() => {});
  const rotulo = `${cfg.entorno} · tenant ${cfg.tenant}`;

  const { ref, snap } = await leerFicha(db, cfg.tenant);
  if (!snap.exists) { log(`\n  ✗ ${cfg.tenant}: no existe la ficha (${cfg.entorno})\n`); return 1; }
  const ficha = snap.data() ?? {};

  // ------------------------------------------------------------------ revertir
  if (cfg.revertir) {
    const lectura = leerRespaldo(cfg.respaldo, cfg);
    if (!lectura.ok) { log(`\n  ✗ ${lectura.motivo}\n`); return 2; }
    const { previo, escrito } = lectura.respaldo;
    const restaurada = modulosDeFicha(previo.modulosPresente ? { ...sinModulos(ficha), modulos: previo.modulos } : sinModulos(ficha));
    const actual = modulosDeFicha(ficha);
    const cambian = IDS_MODULOS.filter((m) => actual.includes(m) !== restaurada.includes(m));
    const hoyPresente = Object.prototype.hasOwnProperty.call(ficha, 'modulos');
    const yaIgual = previo.modulosPresente
      ? hoyPresente && JSON.stringify(ficha.modulos) === JSON.stringify(previo.modulos)
      : !hoyPresente;
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
    log(`  «modulos» antes del respaldo : ${previo.modulosPresente ? lista(previo.modulos) : 'AUSENTE (se eliminaría el campo)'}`);
    log(`  «modulos» hoy                : ${hoyPresente ? (Array.isArray(ficha.modulos) ? lista(ficha.modulos) : '(no es una lista)') : 'AUSENTE'}`);
    log(`  capacidades que cambian      : ${lista(cambian)}`);
    if (hoyPresente && JSON.stringify(ficha.modulos) !== JSON.stringify(escrito)) {
      log('  ! la ficha ya no tiene la lista que escribió este script: alguien la cambió después. Se restaura el valor del respaldo.');
    }
    if (yaIgual) { log('\n  ✓ La ficha ya está como el respaldo: nada que revertir.\n'); return 0; }
    if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar para revertir.\n'); return 0; }
    marcar(true);
    try {
      await escribirModulos(ref, previo.modulosPresente ? previo.modulos : FieldValue.delete(), snap.updateTime);
    } catch (e) {
      if (esPrecondicion(e)) { log('\n  ✗ La ficha cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr el seco.\n'); return 3; }
      throw e;
    } finally { marcar(false); }
    const { snap: despues } = await leerFicha(db, cfg.tenant);
    const d = despues.data() ?? {};
    const bien = previo.modulosPresente
      ? Array.isArray(d.modulos) && JSON.stringify(d.modulos) === JSON.stringify(previo.modulos)
      : !Object.prototype.hasOwnProperty.call(d, 'modulos');
    if (!bien || JSON.stringify(d.flujos) !== JSON.stringify(ficha.flujos) || d.vertical !== ficha.vertical) {
      log('\n  ✗ La relectura no coincide con lo esperado. Revise la ficha con el seco.\n');
      return 3;
    }
    log(`\n  ✓ Revertido: «modulos» ${previo.modulosPresente ? 'restaurado' : 'eliminado (no existía)'}; «flujos» y «vertical» intactos.\n`);
    return 0;
  }

  // -------------------------------------------------------- seco y aplicar
  const ev = evaluar(ficha, cfg.modulos);
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
  log(`  ahora decide el registro por : ${Object.prototype.hasOwnProperty.call(ficha, 'modulos') && Array.isArray(ficha.modulos) ? '«modulos»' : '«flujos»'}`);
  log(`  módulos de hoy               : ${lista(ev.actual)}`);
  log(`  módulos de después           : ${lista(ev.despues)}`);
  log('  siete chequeos (antes = «flujos» tal como los leen hoy los lectores; después = la lista nueva):');
  if (ev.diferencias.length === 0) log('    ✓ cero diferencias');
  for (const d of ev.diferencias) {
    log(`    ✗ ${d.chequeo}\n        antes  : ${JSON.stringify(d.antes)}\n        después: ${JSON.stringify(d.despues)}`);
  }
  log(`  capacidades que cambian      : ${ev.cambian.length ? ev.cambian.map((m) => `${m} (${ev.despues.includes(m) ? 'se agrega' : 'se quita'})`).join(', ') : '(ninguna)'}`);

  const permiso = permitirAplicar(ev, cfg.acepto);
  if (!cfg.aplicar) {
    if (permiso.ok) log('\n  Con --aplicar se aceptaría: lo declarado en --acepto-diferencias coincide.');
    else log(`\n  Con --aplicar NO se escribiría: ${permiso.motivo}.`);
    log('  Seco: no se escribió nada.\n');
    return ev.diferencias.length || ev.cambian.length ? 1 : 0;
  }

  if (!permiso.ok) { log(`\n  ✗ ${permiso.motivo}\n`); return 2; }
  if (Object.prototype.hasOwnProperty.call(ficha, 'modulos') && !textos(ficha.modulos)) {
    log('\n  ✗ La ficha ya tiene «modulos» y no es una lista de textos: no se puede respaldar con fidelidad. No se escribe nada.\n');
    return 2;
  }
  if (ev.yaEscrita) { log('\n  ✓ «modulos» ya está escrita con esa lista: nada que hacer.\n'); return 0; }

  // Respaldo ANTES de escribir, y se relee.
  guardarRespaldo(cfg.respaldo, contenidoDelRespaldo({
    entorno: cfg.entorno, tenant: cfg.tenant, ficha, actualizadoEn: iso(snap.updateTime), escrito: cfg.modulos,
  }));
  log(`\n  Respaldo guardado y releído: ${cfg.respaldo}`);

  marcar(true);
  try {
    await escribirModulos(ref, cfg.modulos, snap.updateTime);
  } catch (e) {
    if (esPrecondicion(e)) { log('\n  ✗ La ficha cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr el seco.\n'); return 3; }
    throw e;
  } finally { marcar(false); }

  const { snap: despues } = await leerFicha(db, cfg.tenant);
  const d = despues.data() ?? {};
  if (!Array.isArray(d.modulos) || JSON.stringify(d.modulos) !== JSON.stringify(cfg.modulos)
    || JSON.stringify(d.flujos) !== JSON.stringify(ficha.flujos) || d.vertical !== ficha.vertical) {
    log('\n  ✗ La relectura no coincide con lo escrito. Revise la ficha con el seco; el respaldo permite revertir.\n');
    return 3;
  }
  log(`\n  ✓ Escrito y releído: «modulos» = ${lista(d.modulos)}. «flujos» y «vertical» intactos.`);
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

  let escribiendo = false;
  process.on('SIGINT', () => {
    console.error(escribiendo
      ? '\n  ! Interrumpido DURANTE la escritura: corra el seco para ver en qué estado quedó la ficha.\n'
      : '\n  ! Interrumpido por el operador. No se escribió nada.\n');
    process.exit(130);
  });

  const codigo = await ejecutar(cfg, { db, FieldValue, marcarEscritura: (v) => { escribiendo = v; } });
  await db.terminate().catch(() => {});
  process.exit(codigo);
}

/** ¿Se ejecutó este archivo (aunque sea por un enlace simbólico) y no se importó? */
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
    // Un fallo de ejecución (permiso, red) NO es «hay diferencias»: código 3, sin mensaje (podría traer datos).
    console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`);
    process.exit(3);
  }
}
