/**
 * =============================================================================
 * EL ENLACE DE CONTRASEÑA: DÓNDE QUEDA, EN UN SOLO LUGAR
 * =============================================================================
 *
 * QUÉ ES. `alta-comercio.mjs` y `asignar-rol.mjs` crean una cuenta con una clave
 * aleatoria que nadie ve y generan un enlace de Firebase Auth para que la
 * persona ponga la suya. Quien tenga el `oobCode` de ese enlace FIJA la
 * contraseña de la cuenta: por unas horas, es la credencial misma.
 *
 * NO VA POR LA SALIDA ESTÁNDAR. Los scripts los corre también el agente
 * `plataforma`, y lo que imprime un comando que corre un agente entra a su
 * contexto: el agente leería la credencial sin quererlo, y bastaría con pegar
 * la salida para pedir ayuda para publicarla. Pasó el 15/09/2026 en el alta de
 * Clínica Platinum: hubo que rotar la contraseña para invalidar el enlace.
 *
 * NO VA AL DIRECTORIO PERSONAL. Hasta el 28/09/2026 iba a
 * `~/enlace-admin-<tenant>.txt`. En `~/` cada carpeta es un proyecto (regla de
 * Andres) y un archivo suelto ahí no es de nadie: ese día había dos, del 16 y
 * del 17/09 (Bellido y Platinum), olvidados, y hubo que pedir borrarlos.
 *
 * VA A LA CARPETA DEL CLIENTE, OCULTA: `CLIENTES/<CLIENTE>/.enlaces/` de la
 * COPIA PRINCIPAL del proyecto.
 *   · `CLIENTES/` está en `.gitignore` (y `.enlaces/` también, por si alguien
 *     mueve la carpeta): un `git add` no lo sube.
 *   · Es la copia principal y no el worktree desde el que se corre: en un
 *     worktree `CLIENTES/` no existe, y un enlace dentro del worktree se
 *     perdería al borrarlo. La raíz sale de `git --git-common-dir`.
 *   · Carpeta 700, archivo 600: solo el usuario de la máquina.
 *   · Oculta, porque el coordinador `alta-cliente` lee y busca en
 *     `CLIENTES/<CLIENTE>/` (ficha, estado): `rg`, y con él Grep, salta las
 *     carpetas ocultas, y `.claude/settings.json` niega leerla.
 *   · Queda junto al resto del cliente: cuando se cierra su alta, se ve.
 *
 * EL AGENTE NUNCA LO ABRE. La salida del script dice DÓNDE quedó, nunca QUÉ
 * dice. Lo abre una persona, lo manda por el canal que corresponda y borra el
 * archivo (docs/alta-cliente/RUNBOOK.md, etapa 4).
 *
 * EL ENLACE NACE Y MUERE ACÁ. `guardarEnlaceDeContrasena` lo pide a Auth y lo
 * escribe sin devolverlo: en los scripts no existe ni como variable, así que
 * no hay cómo imprimirlo por descuido (revisión de seguridad del PR #254).
 *
 * `pruebas/plataforma/enlace-privado.test.ts` falla si un script vuelve a escribir en el
 * directorio personal o si el enlace aparece en la salida.
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync, closeSync, constants, existsSync, fchmodSync, lstatSync, mkdirSync, openSync,
  realpathSync, renameSync, rmSync, statSync, writeSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Como las carpetas de `CLIENTES/`: `BELLIDO`, `RUBEN_ROCA`. */
export const ID_CLIENTE = /^[A-Z0-9][A-Z0-9_]{1,59}$/;

/** `ruben-roca` → `RUBEN_ROCA`: la carpeta por defecto de un tenant. */
export const clienteDeTenant = (tenant) => String(tenant ?? '').toUpperCase().replace(/-/g, '_');

/**
 * La raíz de la copia principal: la carpeta que contiene el `.git` común,
 * aunque el script se corra desde un worktree.
 */
export function raizDelProyecto() {
  const aqui = dirname(fileURLToPath(import.meta.url));
  // Sin las GIT_* del entorno: un GIT_DIR heredado apuntaría a otro repositorio.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const comun = execFileSync('git', ['-C', aqui, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env }).trim();
  return dirname(comun);
}

/**
 * Dónde queda el enlace. Pura: no toca el disco.
 *   carpetaCliente — CLIENTES/<CLIENTE>/, que tiene que existir (la crea la
 *                    etapa «preparar» del alta, nunca este script).
 *   archivo        — CLIENTES/<CLIENTE>/.enlaces/<nombre>.txt
 */
export function destinoDelEnlace({ raiz, cliente, nombre }) {
  if (!ID_CLIENTE.test(String(cliente))) throw new Error(`cliente inválido: «${cliente}»`);
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(String(nombre))) throw new Error(`nombre de enlace inválido: «${nombre}»`);
  const carpetaCliente = join(raiz, 'CLIENTES', cliente);
  return { carpetaCliente, carpeta: join(carpetaCliente, '.enlaces'), archivo: join(carpetaCliente, '.enlaces', `${nombre}.txt`) };
}

/** Lo que el script dice ANTES de escribir nada: dónde irá y si se puede. */
export function comprobarDestino(opciones) {
  const d = destinoDelEnlace(opciones);
  const existe = existsSync(d.carpetaCliente) && statSync(d.carpetaCliente).isDirectory();
  return { ...d, existe, legible: relative(opciones.raiz, d.archivo) };
}

/**
 * Escribe el texto. Devuelve la ruta relativa a la raíz, que es lo único que
 * el script imprime. No crea la carpeta del cliente: si falta, falla.
 *
 * NO SIGUE ENLACES SIMBÓLICOS (CWE-59). Un agente con el mismo usuario podría
 * dejar `CLIENTES/<X>` o el archivo destino como enlace a un lugar que sí puede
 * leer, o a un archivo versionado, y la próxima alta escribiría la credencial
 * ahí. Por eso: la carpeta del cliente tiene que quedar DENTRO de CLIENTES/ ya
 * resuelta, `.enlaces` tiene que ser una carpeta de verdad, y el texto va a un
 * temporal nuevo (O_EXCL | O_NOFOLLOW, 600 desde el primer byte) que después
 * REEMPLAZA al destino con `rename`: si el destino era un enlace simbólico, se
 * reemplaza el enlace, no se escribe a donde apunta. Y un archivo que ya
 * existía con otros permisos nunca llega a tener el texto nuevo con esos
 * permisos.
 */
export function escribirEnlace({ raiz, cliente, nombre, texto }) {
  const d = comprobarDestino({ raiz, cliente, nombre });
  if (!d.existe) throw new Error(`no existe ${relative(raiz, d.carpetaCliente)}/`);
  const base = realpathSync(join(raiz, 'CLIENTES'));
  if (!realpathSync(d.carpetaCliente).startsWith(base + sep)) {
    throw new Error(`${relative(raiz, d.carpetaCliente)} sale de CLIENTES/ (enlace simbólico)`);
  }
  try { mkdirSync(d.carpeta, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const st = lstatSync(d.carpeta);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('.enlaces no es una carpeta de verdad');
  chmodSync(d.carpeta, 0o700);
  const temporal = join(d.carpeta, `.${nombre}.${process.pid}.tmp`);
  const fd = openSync(temporal, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, texto);
  } catch (e) {
    closeSync(fd);
    rmSync(temporal, { force: true });
    throw e;
  }
  closeSync(fd);
  renameSync(temporal, d.archivo);
  return d.legible;
}

/**
 * Pide el enlace a Firebase Auth y lo escribe junto al encabezado, sin
 * devolverlo ni imprimirlo. `auth` es el de `firebase-admin/auth` (o un doble
 * en las pruebas). Devuelve solo la ruta relativa.
 */
export async function guardarEnlaceDeContrasena({ auth, correo, raiz, cliente, nombre, encabezado }) {
  // Primero la comprobación: sin carpeta no se pide el enlace a Auth.
  if (!comprobarDestino({ raiz, cliente, nombre }).existe) {
    throw new Error(`no existe CLIENTES/${cliente}/`);
  }
  return escribirEnlace({
    raiz, cliente, nombre,
    texto: `${encabezado.trimEnd()}\n\n${await auth.generatePasswordResetLink(correo)}\n`,
  });
}
