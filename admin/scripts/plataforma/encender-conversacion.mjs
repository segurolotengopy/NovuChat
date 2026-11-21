/**
 * ENCENDER TODO EL JUEGO DE CONVERSACIÓN DE UN COMERCIO, CON UNA SOLA CORRIDA — seco por omisión.
 *
 * POR QUÉ EXISTE (reclamo de Andres, 21/11/2026). Las funciones de conversación son del core: todo comercio las
 * corre igual, sin venderse en un plan, y se encienden JUNTO con su alta. Hasta hoy el alta no nombraba ninguna
 * bandera y cada una se encendía a mano, una a una. La definición del juego vive en core
 * (`functions/src/core/conversacion/juego.ts`) y este archivo no repite sus nombres ni valores:
 *   · `JUEGO_DE_FICHA` (consolaConversaciones, guardarMedios) lo escribe el ALTA (`alta-comercio.mjs`, `fichaInicial`);
 *   · `JUEGO_CON_INFRA` (personaPuedeEscribir, personaPuedeEnviarMedios) certifica que la infraestructura del número
 *     funciona; lo escribe ESTE script, SOLO después de verificarla («flujo antes que bandera»).
 *
 * QUÉ HACE, EN ESTE ORDEN FIJO (`pasosDelEncendido`; cada paso reutiliza el script que ya existe, sin copiar su lógica):
 *   1. relé inerte       `scripts/cargar-timbre-n8n.sh --crear-rele-inerte` (decisión D2 de Principal)
 *   2. alias             `scripts/nube-salida-persona.sh --agregar-alias` (una versión nueva del secreto; deja la entrega
 *                        en `$XDG_RUNTIME_DIR` para el paso 3)
 *   3. timbre            `scripts/cargar-timbre-n8n.sh` (carga el flujo INACTIVO) y después `--activar`
 *   4. puerta            `verificar-salida-persona.mjs --medios` (solo lectura): sale 0 solo con 1a a 4e y 4f en OK
 *   5. personaPuedeEscribir        `ejecutar()` de `aplicar-persona-puede-escribir.mjs`, con respaldo
 *   6. personaPuedeEnviarMedios    `ejecutar()` de `aplicar-persona-puede-enviar-medios.mjs`, con respaldo
 * Ninguna bandera se escribe antes de la puerta, y se corta en el primer paso que falle.
 *
 *   node scripts/plataforma/encender-conversacion.mjs --tenant <id> --env .env [--alias <clienteNN>] \
 *        --cred-ingesta "<nombre>" --cred-envio "<nombre>" [--cred-rele "<nombre>"] --respaldo-dir <ruta> \
 *        [--proyecto <id>] [--aplicar --confirmo produccion]
 *   node scripts/plataforma/encender-conversacion.mjs --todos --proyecto <id>       (solo lectura: `faltanDelJuego`)
 *
 *   · `--alias`: si falta, se lee de `rutasWhatsApp` (`aliasSecreto` de la ruta del comercio, que fija
 *     `asignar-numero.mjs`); si el comercio no tiene exactamente UN alias, se detiene.
 *   · `--env`: archivo `.env` de la raíz (`.env` o `.env.<nombre>`) con N8N_BASE_URL y N8N_API_KEY (modo 600).
 *   · `--cred-ingesta` y `--cred-envio`: NOMBRES de las credenciales de n8n del comercio (no sus valores). `--cred-rele`
 *     por omisión es «Relé inerte (<alias>)», la que crea el paso 1.
 *   · `--respaldo-dir`: carpeta absoluta para los respaldos de las banderas (reglas de `comprobarRespaldo`).
 *   · `--proyecto`: por omisión, GCP_PROJECT_ID_PROD del entorno; tiene que estar en la lista blanca. El seco admite
 *     staging o producción (la salida dice cuál); `--aplicar` solo vale contra producción y exige `--confirmo produccion`.
 *   · `--cred-ingesta` y `--cred-envio` se piden siempre: sin ellos no se puede sondear el flujo ya cargado.
 *
 * SECO (por omisión): sondea los pasos de infraestructura y, solo si TODOS están hechos, corre la puerta; después el
 * seco de `personaPuedeEscribir` y, si esa ya está en true, el de `personaPuedeEnviarMedios`. Lo que depende de algo
 * que aún no se escribió se declara «se comprueba al aplicar». Sale 0 si no hay nada pendiente, 1 si hay pasos por
 * hacer, 2 por uso o salvaguarda, 3 por un fallo.
 *
 * SIN REDESPLIEGUE (decisión D1 de Andres, 21/11/2026). Este script NO despliega nada. Firebase fija la versión del
 * secreto al desplegar; como `Tomar` entra por el barrido del flujo de salida (cada minuto, el pendiente caduca a
 * los 2 minutos), el comercio nuevo queda atendido hasta ~60 s después sin redesplegar. Por eso la puerta se corre
 * con `--sin-redespliegue`: acepta el alias presente en `latest` cuando la ÚNICA falla del secreto es que la versión
 * fijada de la Function todavía no lo trae, y lo avisa en voz alta («el timbre llega con la próxima etiqueta;
 * mientras tanto, el barrido»). Cualquier otra falla de la puerta (flujo no activo, credenciales, 4a, 4f…) corta.
 *
 * !!! D1 TODAVÍA NO ESTÁ VERIFICADO EN EL ENSAYO DEL DEMO A (V1). NO se usa con `--aplicar` en un comercio real hasta
 * !!! ese ensayo: el seco sí se puede correr siempre.
 *
 * REANUDAR (idempotente). Antes de actuar, y sin escribir, cada paso de infraestructura se sondea con lecturas: relé
 * inerte existente (salida 0 de `--crear-rele-inerte` en seco), alias presente en el mapa, flujo del alias cargado
 * (`--activar` en seco: 0 o 1) y activo y publicado (`--activar` en seco: 0). Lo que ya está hecho se salta; un flujo ya
 * cargado implica que el relé y el alias ya estaban. Un comercio encendido a medias da un seco limpio que dice qué falta.
 *
 * SALVAGUARDAS. Rechaza todo comercio de `COMERCIOS_NO_TOCADOS` (por inclusión, sin tildes ni mayúsculas, en el id y
 * en el nombre de la ficha; `--todos` los salta). Se niega si `rutasWhatsApp.canalSalida` del comercio es `rele`
 * (`--canal-graph` es una afirmación que aquí se comprueba, no se supone). Antes de CADA bandera relee el mapa de
 * alias y corta si el alias desapareció. `--respaldo-dir` se valida con `comprobarRespaldo`. Guardado de medios de un
 * comercio excluido de él va por su propio script (`aplicar-guardar-medios.mjs`), no por este.
 *
 * LÍMITE QUE CONVIENE SABER. Con `consolaConversaciones: 'nueva'` y la salida de persona TODAVÍA sin publicar, solo
 * funcionan DEVOLVER una conversación y BLOQUEAR un contacto: no hay envíos de la persona (ni texto ni adjuntos). Por
 * eso las banderas con infraestructura no se escriben antes de la puerta, y por eso `fichaInicial` puede escribir la
 * consola nueva en el alta sin riesgo: la consola nunca ofrece «Tomar» ni el cuadro de escritura hasta el paso 5.
 *
 * Los pasos 1 a 3 no se corren dos veces a la vez ni junto a otro `--agregar-alias` (`nube-salida-persona.sh` no
 * controla concurrencia: dos corridas en paralelo se pisan). Este script no se usa mientras otra sesión agrega un alias.
 *
 * SECRETOS. Nunca imprime la ruta del webhook, una clave ni el id del proyecto: la salida de cada paso pasa por
 * `censurar`, que además tapa los ids de proyecto del entorno, los `Bearer` y las URL de webhook. Los scripts que
 * llama ya tienen la misma regla; esta es la segunda barrera.
 *
 * REVERTIR. Al cortarse (y al terminar bien) imprime cómo deshacer lo hecho: `--quitar` y `--quitar-alias` de los
 * scripts de n8n y de Secret Manager, y `--revertir` con el respaldo de cada bandera.
 *
 * COSTO. Seco: lecturas (n8n, Secret Manager, Firestore). Aplicar: 1 credencial y 1 flujo y su activación en n8n, 1
 * versión de Secret Manager, 2 escrituras de ficha en Firestore y 1 de auditoría. 0 mensajes por conversación. NO se
 * corre `--aplicar` sin el botón de Andres, ni mientras haya un `--agregar-alias` en curso.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JUEGO_CON_INFRA, faltanDelJuego } from '../../functions/src/core/conversacion/juego.ts';
import { comprobarRespaldo } from './aplicar-consola-conversaciones.mjs';
import { COMERCIOS_NO_TOCADOS } from './comercios-no-tocados.mjs';
import * as escribir from './aplicar-persona-puede-escribir.mjs';
import * as enviarMedios from './aplicar-persona-puede-enviar-medios.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');

const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const ID_ALIAS = /^[A-Za-z][A-Za-z0-9]{1,29}$/;
const ARCHIVO_ENV = /^\.env(\.[a-z0-9-]+)?$/;
const CON_VALOR = ['tenant', 'alias', 'env', 'proyecto', 'cred-ingesta', 'cred-envio', 'cred-rele', 'respaldo-dir', 'confirmo'];
const BANDERAS = ['aplicar', 'todos'];

export const USO = '  node scripts/plataforma/encender-conversacion.mjs --tenant <id> --env .env [--alias <clienteNN>] '
  + '--cred-ingesta "<nombre>" --cred-envio "<nombre>" [--cred-rele "<nombre>"] --respaldo-dir <ruta> [--proyecto <id>] '
  + '[--aplicar --confirmo produccion]\n'
  + '  node scripts/plataforma/encender-conversacion.mjs --todos [--proyecto <id>]   (solo lectura)';

/** Quién escribe cada bandera con infraestructura. Si core agrega una a `JUEGO_CON_INFRA` sin escritor aquí, el orquestador se niega. */
const ESCRITORES = Object.freeze({
  personaPuedeEscribir: { modulo: escribir, script: 'aplicar-persona-puede-escribir.mjs', enSeco: true },
  // Su precondición es `personaPuedeEscribir === true`: en seco solo se corre si la anterior ya dio 0 (ya está en true).
  personaPuedeEnviarMedios: { modulo: enviarMedios, script: 'aplicar-persona-puede-enviar-medios.mjs', enSeco: false, dependeDe: 'personaPuedeEscribir' },
});

// ===========================================================================
// LOS PASOS (puro)
// ===========================================================================
/**
 * El plan de la corrida, en orden. Puro: no toca red, disco ni reloj. Cada paso dice si escribe, cómo se llama (para
 * `spawnSync`, sin shell) y cómo se revierte. La puerta de verificación va SIEMPRE antes de cualquier bandera.
 */
export function pasosDelEncendido({ tenant, alias, env, credIngesta, credEnvio, credRele, proyecto, respaldoDir, sello } = {}) {
  const rele = credRele ?? `Relé inerte (${alias})`;
  const quitarFlujo = `./scripts/cargar-timbre-n8n.sh --alias ${alias} --env ${env} --quitar --aplicar --confirmo produccion`;
  const conMapa = ['--alias', alias, '--env', env, '--cred-ingesta', credIngesta ?? '', '--cred-envio', credEnvio ?? '', '--cred-rele', rele];
  const argsActivar = [...conMapa, '--activar'];
  // `sondeo`: lecturas (nunca `--aplicar`) que dicen si el paso YA está hecho, para reanudar sin repetir.
  const pasos = [
    {
      id: 'rele-inerte', tipo: 'spawn', titulo: 'credencial inerte del relé', escribe: true, enSeco: false,
      comando: './scripts/cargar-timbre-n8n.sh',
      args: ['--alias', alias, '--env', env, '--crear-rele-inerte'],
      sondeo: { args: ['--alias', alias, '--env', env, '--crear-rele-inerte'], hecho: (codigo) => codigo === 0 }, impliedBy: 'timbre-carga',
      revertir: `borrar en n8n la credencial «${rele}» (nada la cita hasta el paso de carga)`,
    },
    {
      id: 'alias', tipo: 'spawn', titulo: 'alias del timbre en el secreto de rutas', escribe: true, enSeco: false,
      comando: './scripts/nube-salida-persona.sh',
      args: ['--agregar-alias', alias, '--env', env],
      sondeo: { args: ['--agregar-alias', alias, '--env', env], hecho: (_codigo, salida) => /el alias pedido está presente/.test(String(salida ?? '')) }, impliedBy: 'timbre-carga',
      revertir: `./scripts/nube-salida-persona.sh --quitar-alias ${alias} --aplicar --confirmo produccion (las versiones anteriores del secreto siguen guardadas)`,
    },
    {
      id: 'timbre-carga', tipo: 'spawn', titulo: 'carga del flujo de salida (inactivo)', escribe: true, enSeco: false,
      comando: './scripts/cargar-timbre-n8n.sh',
      args: [...conMapa, '--rele-inerte', '--canal-graph'],
      // `--activar` en seco: 0 (activo) o 1 (cargado, falta activar) = el flujo existe y está completo; 2 = no está cargado.
      sondeo: { args: argsActivar, hecho: (codigo) => codigo === 0 || codigo === 1 },
      revertir: quitarFlujo,
    },
    {
      id: 'timbre-activar', tipo: 'spawn', titulo: 'activación del flujo de salida', escribe: true, enSeco: false,
      comando: './scripts/cargar-timbre-n8n.sh',
      args: argsActivar,
      sondeo: { args: argsActivar, hecho: (codigo) => codigo === 0 },
      revertir: quitarFlujo,
    },
    {
      id: 'puerta', tipo: 'puerta', titulo: 'puerta: salida de persona verificada (4a y 4f en OK)', escribe: false, enSeco: false,
      comando: process.execPath,
      // `--sin-redespliegue` (D1): acepta el alias en `latest` si SOLO falta en la versión fijada de la Function.
      args: [join(AQUI, 'verificar-salida-persona.mjs'), '--proyecto', proyecto ?? '', '--alias', alias, '--tenant', tenant, '--env', env, '--medios', '--sin-redespliegue'],
      revertir: null,
    },
  ];
  for (const campo of Object.keys(JUEGO_CON_INFRA)) {
    const escritor = ESCRITORES[campo];
    if (!escritor) throw new Error(`falta quién escribe la bandera «${campo}» del juego (ESCRITORES)`);
    const respaldo = respaldoDir ? join(respaldoDir, `${campo}-${tenant}-${sello ?? 'sin-sello'}.json`) : null;
    pasos.push({
      id: campo, tipo: 'bandera', bandera: campo, titulo: `bandera ${campo}`, escribe: true, enSeco: escritor.enSeco,
      dependeDe: escritor.dependeDe ?? null, modulo: escritor.modulo, respaldo,
      revertir: `node scripts/plataforma/${escritor.script} --revertir --respaldo ${respaldo ?? '<respaldo>'} --tenant ${tenant} --proyecto <el de producción> --aplicar --confirmo-produccion ${tenant}`,
    });
  }
  return pasos;
}

/**
 * Problemas del orden de un plan (puro). Un plan con problemas NO se ejecuta. Reglas: cubre exactamente cada clave de
 * `JUEGO_CON_INFRA` una vez; hay una sola puerta; la puerta va después de todos los pasos de infraestructura y antes de
 * toda bandera; y no hay pasos de tipo desconocido (en particular, ninguno de despliegue: decisión D1).
 */
export function validarOrden(pasos) {
  const problemas = [];
  const tipos = new Set(['spawn', 'puerta', 'bandera']);
  for (const p of pasos) if (!tipos.has(p.tipo)) problemas.push(`paso «${p.id}» de tipo no admitido (${p.tipo}): el orquestador no despliega`);
  const puertas = pasos.map((p, i) => (p.tipo === 'puerta' ? i : -1)).filter((i) => i >= 0);
  if (puertas.length !== 1) problemas.push(`tiene que haber exactamente una puerta de verificación (hay ${puertas.length})`);
  const iPuerta = puertas[0] ?? -1;
  const banderas = pasos.map((p, i) => ({ p, i })).filter((x) => x.p.tipo === 'bandera');
  for (const { p, i } of banderas) if (iPuerta < 0 || i < iPuerta) problemas.push(`la bandera «${p.bandera}» va antes de la puerta de verificación`);
  pasos.forEach((p, i) => { if (p.tipo === 'spawn' && iPuerta >= 0 && i > iPuerta) problemas.push(`el paso de infraestructura «${p.id}» va después de la puerta`); });
  const campos = banderas.map((x) => x.p.bandera);
  for (const clave of Object.keys(JUEGO_CON_INFRA)) {
    const n = campos.filter((c) => c === clave).length;
    if (n !== 1) problemas.push(`la bandera «${clave}» del juego aparece ${n} veces (debe ser 1)`);
  }
  for (const c of campos) if (!(c in JUEGO_CON_INFRA)) problemas.push(`la bandera «${c}» no es del juego (JUEGO_CON_INFRA)`);
  return problemas;
}

// ===========================================================================
// SALIDA SEGURA (pura)
// ===========================================================================
/** Tapa ids de proyecto dados, `Bearer <algo>` y URL de webhook. Segunda barrera: los scripts llamados ya no los imprimen. */
export function censurar(texto, valoresSecretos = []) {
  let t = String(texto ?? '');
  for (const v of valoresSecretos) if (typeof v === 'string' && v.length >= 5) t = t.split(v).join('«…»');
  return t
    .replace(/Bearer\s+\S+/g, 'Bearer «…»')
    .replace(/https?:\/\/\S*\/webhook\S*/gi, '«url de webhook»');
}

/** Los ids de proyecto y la clave de la API de n8n que el entorno conoce, para taparlos. */
export function valoresSecretosDelEntorno(env, extra = []) {
  return [env.GCP_PROJECT_ID_PROD, env.GCP_PROJECT_ID_STAGING, env.N8N_API_KEY, ...extra].filter((v) => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
}

/** Minúsculas y sin tildes, para comparar como `esTenantExcluido`. */
const normalizar = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** ¿El id o el nombre contiene algún comercio de `COMERCIOS_NO_TOCADOS`? Por inclusión, sin tildes ni mayúsculas. */
export function esComercioNoTocado(idONombre) {
  const t = normalizar(idONombre);
  return typeof idONombre === 'string' && COMERCIOS_NO_TOCADOS.some((x) => t.includes(normalizar(x)));
}

// ===========================================================================
// ARGUMENTOS (puro)
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
      problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40).replace(/[^\w-]/g, '?')}`);
    }
  }
  const aplicar = banderas.includes('aplicar');
  const todos = banderas.includes('todos');
  const proyecto = valores.proyecto ?? (typeof env.GCP_PROJECT_ID_PROD === 'string' && env.GCP_PROJECT_ID_PROD.trim() !== '' ? env.GCP_PROJECT_ID_PROD.trim() : undefined);

  const proy = proyecto === undefined ? { ok: false } : escribir.comprobarProyecto(proyecto, env);
  if (proyecto === undefined) problemas.push('falta --proyecto (o GCP_PROJECT_ID_PROD en el entorno)');
  else if (!proy.ok) problemas.push(proy.motivo);

  if (todos) {
    if (aplicar) problemas.push('--todos es solo lectura: no se combina con --aplicar');
    for (const k of ['tenant', 'alias', 'env', 'cred-ingesta', 'cred-envio', 'cred-rele', 'respaldo-dir', 'confirmo']) if (k in valores) problemas.push(`--todos no admite --${k}`);
    if (problemas.length) return { ok: false, problemas };
    return { ok: true, cfg: { todos: true, proyecto, entorno: proy.entorno, aplicar: false } };
  }

  const { tenant, alias, env: archivoEnv } = valores;
  if (tenant === undefined) problemas.push('falta --tenant');
  else if (tenant.includes(',')) problemas.push('--tenant admite UN solo comercio por corrida (sin comas)');
  else if (!ID_TENANT.test(tenant)) problemas.push('--tenant inválido (minúsculas, dígitos y guiones, de 3 a 60)');
  else if (esComercioNoTocado(tenant)) problemas.push('este comercio está en COMERCIOS_NO_TOCADOS: no se toca sin una orden expresa de Andres');
  if (alias !== undefined && !ID_ALIAS.test(alias)) problemas.push('--alias inválido (letras y dígitos, de 2 a 30, empieza con letra)');
  if (archivoEnv === undefined) problemas.push('falta --env (.env o .env.<nombre> de la raíz del repositorio)');
  else if (!ARCHIVO_ENV.test(archivoEnv)) problemas.push('--env tiene que ser un archivo .env de la raíz del repositorio (.env o .env.<nombre>)');
  for (const k of ['cred-ingesta', 'cred-envio', 'cred-rele']) {
    const v = valores[k];
    if (v !== undefined && (v.trim() === '' || v !== v.trim() || v.length > 100 || /[\u0000-\u001f]/.test(v))) problemas.push(`--${k} no es un nombre de credencial válido`);
  }
  if (aplicar) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--aplicar solo se usa contra producción (los scripts de n8n y de Secret Manager son de producción)');
    if (valores.confirmo !== 'produccion') problemas.push('--aplicar exige --confirmo produccion (escrito a mano)');
    if (!('respaldo-dir' in valores)) problemas.push('--aplicar exige --respaldo-dir');
  } else if ('confirmo' in valores) {
    problemas.push('--confirmo solo acompaña a --aplicar');
  }
  for (const k of ['cred-ingesta', 'cred-envio']) if (!(k in valores)) problemas.push(`falta --${k} (sin ella no se puede sondear el flujo ya cargado)`);
  if (valores['respaldo-dir'] !== undefined) {
    // Las mismas reglas que los scripts de las banderas (fuera del repo o carpeta ignorada, carpeta 0700, del usuario).
    const r = comprobarRespaldo(join(valores['respaldo-dir'], 'comprobacion.json'), { permitirExistente: false, ...(opciones.respaldo ?? {}) });
    if (!r.ok) problemas.push(`--respaldo-dir: ${r.motivo}`);
  }
  if (problemas.length) return { ok: false, problemas };
  return {
    ok: true,
    cfg: {
      todos: false, aplicar, proyecto, entorno: proy.entorno, tenant, alias, env: archivoEnv,
      credIngesta: valores['cred-ingesta'], credEnvio: valores['cred-envio'], credRele: valores['cred-rele'], respaldoDir: valores['respaldo-dir'],
    },
  };
}

// ===========================================================================
// EJECUCIÓN (las dependencias se inyectan: las pruebas no tocan red ni disco)
// ===========================================================================
/** Cómo se corre un paso: argumentos finales (con `--aplicar --confirmo produccion` solo al aplicar un paso que escribe). */
export function argumentosDelPaso(paso, aplicar) {
  if (paso.tipo === 'puerta' || !aplicar || !paso.escribe) return paso.args;
  return [...paso.args, '--aplicar', '--confirmo', 'produccion'];
}

const codigosAceptados = (paso, aplicar) => (aplicar || !paso.escribe ? [0] : [0, 1]);

/**
 * Corre el plan en orden y se corta en el primer paso que falla, sin escribir ninguna bandera pendiente.
 * `deps`: `{ ejecutar(paso, aplicar) → número, sondear(paso) → { codigo, salida }, log }`. `sondear` es SOLO lectura.
 * Devuelve `{ codigo, fallo, hechos, pendientes }`.
 * Códigos: 0 todo listo; 1 (seco) hay pasos por hacer; 2 el plan o un paso se niega sin escribir; 3 un paso falló.
 * Reanuda: los pasos de infraestructura ya hechos (según su sondeo) se saltan y no entran en lo que se deshace.
 */
export async function correrPasos(pasos, { aplicar, deps }) {
  const log = deps.log ?? (() => {});
  const problemas = validarOrden(pasos);
  if (problemas.length) {
    log(`\n  ✗ El plan no es válido; no se ejecutó nada:\n    - ${problemas.join('\n    - ')}\n`);
    return { codigo: 2, fallo: null, hechos: [], pendientes: [] };
  }
  const sondear = async (paso) => {
    try { return await deps.sondear(paso); } catch { return { codigo: 3, salida: '' }; }
  };
  const yaHechos = new Set();
  for (const paso of pasos.filter((x) => x.sondeo)) {
    const r = await sondear(paso);
    if (paso.sondeo.hecho(r.codigo, r.salida)) yaHechos.add(paso.id);
  }
  for (const paso of pasos) if (paso.impliedBy && yaHechos.has(paso.impliedBy)) yaHechos.add(paso.id);
  const infra = pasos.filter((p) => p.tipo === 'spawn');
  const pendientes = infra.filter((p) => !yaHechos.has(p.id)).map((p) => p.id);
  const alias = pasos.find((p) => p.id === 'alias');

  const hechos = [];
  const salidas = {};
  let puertaOk = false;
  for (const [i, paso] of pasos.entries()) {
    const rotulo = `${i + 1}. ${paso.titulo}`;
    if (yaHechos.has(paso.id)) { log(`  ✓ ${rotulo}: ya está hecho (sondeo de solo lectura); se salta.`); continue; }
    if (paso.tipo === 'spawn' && !aplicar) { log(`  · ${rotulo}: falta; se hace al aplicar.`); continue; }
    const correEnSeco = paso.enSeco
      || (paso.tipo === 'puerta' && pendientes.length === 0)
      || (paso.tipo === 'bandera' && paso.dependeDe && salidas[paso.dependeDe] === 0);
    if (!aplicar && !correEnSeco) { log(`  · ${rotulo}: se comprueba al aplicar (depende de lo que escriben los pasos anteriores).`); continue; }
    if (paso.tipo === 'bandera' && aplicar) {
      // Segunda barrera, independiente del orden del plan: ninguna bandera sin la puerta pasada en ESTA corrida...
      if (!puertaOk) {
        log(`\n  ✗ ${rotulo}: la puerta de verificación no se pasó; no se escribe ninguna bandera.\n`);
        return { codigo: 2, fallo: paso.id, hechos, pendientes };
      }
      // ...y con el alias todavía en el mapa: otra corrida pudo quitarlo entre la puerta y esta bandera.
      if (alias?.sondeo) {
        const r = await sondear(alias);
        if (!alias.sondeo.hecho(r.codigo, r.salida)) {
          log(`\n  ✗ ${rotulo}: el alias ya no está en el mapa de rutas (otra corrida lo quitó). No se escribe esta bandera.\n`);
          return { codigo: 3, fallo: paso.id, hechos, pendientes };
        }
      }
    }
    log(`\n  ▶ ${rotulo}${aplicar ? '' : ' (seco)'}`);
    const codigo = await deps.ejecutar(paso, aplicar);
    salidas[paso.id] = codigo;
    if (!codigosAceptados(paso, aplicar).includes(codigo)) {
      log(`\n  ✗ Se cortó en «${paso.titulo}» (salida ${codigo}). No se escribió ninguna bandera pendiente.`);
      const aDeshacer = [...(aplicar && paso.escribe && codigo !== 2 ? [paso] : []), ...hechos].filter((p) => p.escribe && p.revertir).reverse();
      if (aDeshacer.length) {
        log('  Para deshacer lo hecho (en este orden; el orquestador no despliega nada, así que no hay nada que redesplegar):');
        for (const p of aDeshacer) log(`    - ${p.titulo}: ${p.revertir}`);
      }
      log('');
      return { codigo: codigo === 2 ? 2 : 3, fallo: paso.id, hechos, pendientes };
    }
    if (paso.tipo === 'puerta' && aplicar) puertaOk = true;
    if (!aplicar && paso.tipo === 'bandera' && codigo === 1) pendientes.push(paso.id);
    if (aplicar) hechos.push(paso);
  }
  if (aplicar) {
    log('\n  ✓ Juego de conversación encendido. Para deshacerlo (en este orden):');
    for (const p of [...hechos].filter((x) => x.escribe && x.revertir).reverse()) log(`    - ${p.titulo}: ${p.revertir}`);
    log('');
    return { codigo: 0, fallo: null, hechos, pendientes: [] };
  }
  log(pendientes.length ? `\n  Seco: no se escribió nada. Falta: ${pendientes.join(', ')}. Más lo que solo se comprueba al aplicar.\n` : '\n  Seco: no se escribió nada y no falta nada.\n');
  return { codigo: pendientes.length ? 1 : 0, fallo: null, hechos, pendientes };
}

/** El alias del comercio sale de `rutasWhatsApp` (`aliasSecreto`): debe haber exactamente uno distinto. */
export async function aliasDeRutas(db, tenant) {
  const snap = await db.collection('rutasWhatsApp').where('tenantId', '==', tenant).get();
  const alias = [...new Set(snap.docs.map((d) => d.get('aliasSecreto')).filter((a) => typeof a === 'string' && ID_ALIAS.test(a)))];
  if (alias.length !== 1) return { ok: false, motivo: alias.length === 0 ? 'el comercio no tiene ruta con alias en rutasWhatsApp (asigne el número primero) o pase --alias' : 'el comercio tiene más de un alias en rutasWhatsApp: pase --alias' };
  return { ok: true, alias: alias[0] };
}

/**
 * `--canal-graph` es una AFIRMACIÓN del alta (el relé inerte no manda a Meta); aquí se comprueba: si alguna ruta del comercio
 * tiene `canalSalida === 'rele'`, o no hay ruta, se niega. Solo lectura.
 */
export async function comprobarCanal(db, tenant) {
  const snap = await db.collection('rutasWhatsApp').where('tenantId', '==', tenant).get();
  if (snap.docs.length === 0) return { ok: false, motivo: 'el comercio no tiene ruta en rutasWhatsApp: no se puede comprobar el canal de salida' };
  if (snap.docs.some((d) => d.get('canalSalida') === 'rele')) return { ok: false, motivo: 'el canal de salida de la ruta es «rele»: --canal-graph no es verdad y el relé inerte no debe cargarse. No se escribió nada.' };
  return { ok: true };
}

/** `--todos`: qué claves del juego faltan en cada ficha. Solo lectura. */
export async function repasarTodos(db) {
  const snap = await db.collection('tenants').get();
  return snap.docs.filter((d) => !esComercioNoTocado(d.id) && !esComercioNoTocado(d.get('nombre'))).map((d) => ({ tenant: d.id, estado: d.get('estado') ?? null, faltan: faltanDelJuego(d.data()) })).sort((a, b) => a.tenant.localeCompare(b.tenant));
}

export function lineasDeTodos(filas) {
  const lineas = filas.map((f) => `  ${f.faltan.length ? '✗' : '✓'} ${f.tenant}${f.estado && f.estado !== 'activo' ? ` (${f.estado})` : ''}: ${f.faltan.length ? `faltan ${f.faltan.join(', ')}` : 'juego completo'}`);
  const incompletos = filas.filter((f) => f.faltan.length).length;
  lineas.push(`\n  (los comercios de COMERCIOS_NO_TOCADOS se saltan)\n  ${filas.length} comercios, ${incompletos} con el juego incompleto. Solo lectura: no se escribió nada.`);
  return lineas;
}

/** Las dependencias reales: procesos hijos sin shell, `ejecutar()` de las dos banderas con su respaldo, y salida censurada. */
function dependenciasReales({ cfg, db, FieldValue, secretos }) {
  const log = (t) => console.log(censurar(t, secretos));
  const correr = (paso, args) => spawnSync(paso.comando, args, {
    cwd: RAIZ, encoding: 'utf8', env: process.env, maxBuffer: 32 * 1024 * 1024, timeout: 15 * 60_000,
  });
  const ejecutar = async (paso, aplicar) => {
    if (paso.tipo === 'bandera') {
      const argv = ['--proyecto', cfg.proyecto, '--tenant', cfg.tenant, '--valor', 'true'];
      if (aplicar) argv.push('--aplicar', '--respaldo', paso.respaldo, '--confirmo-produccion', cfg.tenant);
      const a = paso.modulo.analizarArgumentos(argv, process.env);
      if (!a.ok) { log(`\n  ✗ ${a.problemas.join('\n  ✗ ')}\n`); return 2; }
      return paso.modulo.ejecutar(a.cfg, { db, FieldValue, log, env: process.env });
    }
    const r = correr(paso, argumentosDelPaso(paso, aplicar));
    if (r.stdout) log(r.stdout.trimEnd());
    if (r.stderr) log(r.stderr.trimEnd());
    return r.status ?? 3;
  };
  // Solo lectura: nunca lleva `--aplicar`, y su salida NO se imprime (solo se usa para decidir si el paso ya está hecho).
  const sondear = async (paso) => {
    const r = correr(paso, paso.sondeo.args);
    return { codigo: r.status ?? 3, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  return { ejecutar, sondear, log };
}

async function principal() {
  const analisis = analizarArgumentos(process.argv.slice(2));
  if (!analisis.ok) {
    console.error(`\n  ✗ ${analisis.problemas.join('\n  ✗ ')}\n\n${USO}\n`);
    process.exit(2);
  }
  const { cfg } = analisis;
  const secretos = valoresSecretosDelEntorno(process.env, [cfg.proyecto]);
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  let codigo = 3;
  try {
    if (cfg.todos) {
      for (const l of lineasDeTodos(await repasarTodos(db))) console.log(censurar(l, secretos));
      codigo = 0;
    } else {
      const fichaTenant = await db.doc(`tenants/${cfg.tenant}`).get();
      if (fichaTenant.exists && esComercioNoTocado(fichaTenant.get('nombre'))) {
        console.error('\n  ✗ El nombre de la ficha corresponde a un comercio de COMERCIOS_NO_TOCADOS: no se toca. No se escribió nada.\n');
        process.exit(2);
      }
      const canal = await comprobarCanal(db, cfg.tenant);
      if (!canal.ok) { console.error(`\n  ✗ ${canal.motivo}\n`); process.exit(2); }
      let alias = cfg.alias;
      if (alias === undefined) {
        const r = await aliasDeRutas(db, cfg.tenant);
        if (!r.ok) { console.error(`\n  ✗ ${r.motivo}\n`); process.exit(2); }
        alias = r.alias;
      }
      const sello = new Date().toISOString().replace(/[:.]/g, '-');
      const pasos = pasosDelEncendido({ ...cfg, alias, proyecto: cfg.proyecto, sello });
      console.log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO'} · ${cfg.entorno} · tenant ${cfg.tenant} · alias ${alias}`);
      const deps = dependenciasReales({ cfg, db, FieldValue, secretos });
      ({ codigo } = await correrPasos(pasos, { aplicar: cfg.aplicar, deps }));
    }
  } finally {
    await db.terminate().catch(() => {});
  }
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
