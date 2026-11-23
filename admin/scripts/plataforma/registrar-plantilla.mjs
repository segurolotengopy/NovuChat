/**
 * REGISTRAR LA PLANTILLA DE «RETOMAR» DE UN NÚMERO — seco por omisión.
 *
 * QUÉ ES. Retomar (escribirle a un cliente cuando la ventana de 24 h de Meta ya cerró) envía una plantilla aprobada.
 * Cada número vivo (cada WABA) tiene la suya, que crea y aprueba WAM (WhatsApp-Modular): aquí nunca se llama a Meta
 * (`message_templates` es de esa sesión). Este script solo ANOTA, como dato del número, lo que WAM informa:
 *
 *   rutasWhatsApp/{phoneNumberId}.plantillas.retomar = { nombre, idioma, categoria, estado, variables, registradaEn }
 *
 * Es el contrato C1 del plan de Retomar (23/11/2026). El servidor solo envía si el registro es EXACTO:
 * `nombre` ^[a-z0-9_]{1,100}$, `idioma` ^[a-z]{2,3}(_[A-Z]{2})?$, `categoria === 'UTILITY'`, `estado === 'APPROVED'`
 * y `variables === 1`. El mapa `plantillas` se llama así a propósito: otros usos (aviso a recepción, envío masivo)
 * agregan sus claves ahí. Solo se toca la clave del uso pedido; las demás se conservan.
 *
 *   node scripts/plataforma/registrar-plantilla.mjs --proyecto <id> --numero <phoneNumberId> --uso retomar \
 *        --nombre <nombre> --idioma <es> --categoria UTILITY --estado APPROVED [--variables 1] \
 *        [--aplicar [--confirmo produccion]]
 *
 * REGLAS.
 *   · Con `--estado APPROVED` se exige UTILITY y `--variables 1` (lo contrario no se registra: el servidor no la usaría
 *     y dejaría una plantilla «buena» que no lo es).
 *   · Con un estado distinto de APPROVED (PAUSED, REJECTED, DISABLED, PENDING…) SÍ se permite registrar cualquier
 *     categoría: sirve para APAGAR Retomar cuando WAM avisa que Meta pausó o recategorizó la plantilla. El nombre y el
 *     idioma se validan siempre.
 *   · La ruta tiene que EXISTIR (nunca se crea una ruta aquí) y no se escribe nada más que `plantillas.<uso>`.
 *   · IDEMPOTENTE: si lo registrado ya es igual (sin contar `registradaEn`), sale con 0 sin escribir.
 *   · Escribe con `update` y la precondición de la hora leída: si la ruta cambió entre la lectura y la escritura, no
 *     escribe. Relee y muestra lo que quedó.
 *   · Contra producción, `--aplicar` exige `--confirmo produccion`, escrito a mano. Sin `--aplicar` es seco (una lectura).
 *
 * SALIDA. 0: sin diferencias o escrito y comprobado. 1: el seco encontró diferencias. 2: uso o precondición (nada
 * escrito). 3: error de ejecución. COSTO: seco, 1 lectura; aplicar, 2 lecturas y 1 escritura. 0 mensajes por
 * conversación. No se corre contra producción sin el «sí» de Andres.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { comprobarProyecto } from './aplicar-consola-conversaciones.mjs';

const USOS = ['retomar'];
const PATRON_NOMBRE = /^[a-z0-9_]{1,100}$/;
const PATRON_IDIOMA = /^[a-z]{2,3}(_[A-Z]{2})?$/;
const PATRON_ESTADO = /^[A-Z][A-Z_]{2,29}$/;
const CATEGORIAS = ['UTILITY', 'MARKETING', 'AUTHENTICATION'];
const PATRON_NUMERO = /^[0-9]{6,20}$/;
const CON_VALOR = ['proyecto', 'numero', 'uso', 'nombre', 'idioma', 'categoria', 'estado', 'variables', 'confirmo'];
const BANDERAS = ['aplicar'];

export const USO = '  node scripts/plataforma/registrar-plantilla.mjs --proyecto <id> --numero <phoneNumberId> --uso retomar '
  + '--nombre <nombre> --idioma <es> --categoria UTILITY --estado APPROVED [--variables 1] [--aplicar [--confirmo produccion]]';

const cola = (n) => `…${String(n).slice(-4)}`;

/**
 * C1 EXACTO, puro: ¿este registro autoriza a enviar? `registradaEn` no cuenta. Todo es `===`: `'1'`, `1.0` en
 * texto, `'utility'` o un estado en minúsculas no valen.
 */
export function plantillaRetomarValida(p) {
  return typeof p === 'object' && p !== null
    && typeof p.nombre === 'string' && PATRON_NOMBRE.test(p.nombre)
    && typeof p.idioma === 'string' && PATRON_IDIOMA.test(p.idioma)
    && p.categoria === 'UTILITY' && p.estado === 'APPROVED' && p.variables === 1;
}

/**
 * Problemas para REGISTRAR (puro). Vacío = se puede escribir. Con APPROVED exige lo mismo que C1; con otro estado
 * permite cualquier categoría y cualquier cantidad de variables entera (para poder apagar).
 */
export function problemasDeLaPlantilla(p) {
  const problemas = [];
  if (typeof p !== 'object' || p === null) return ['no hay datos de la plantilla'];
  if (typeof p.nombre !== 'string' || !PATRON_NOMBRE.test(p.nombre)) problemas.push('--nombre inválido (minúsculas, dígitos y guion bajo, de 1 a 100)');
  if (typeof p.idioma !== 'string' || !PATRON_IDIOMA.test(p.idioma)) problemas.push('--idioma inválido (por ejemplo es, o es_MX)');
  if (typeof p.categoria !== 'string' || !CATEGORIAS.includes(p.categoria)) problemas.push(`--categoria tiene que ser una de ${CATEGORIAS.join(', ')}`);
  if (typeof p.estado !== 'string' || !PATRON_ESTADO.test(p.estado)) problemas.push('--estado inválido (en mayúsculas, como lo informa WAM: APPROVED, PAUSED…)');
  if (!Number.isInteger(p.variables) || p.variables < 0 || p.variables > 10) problemas.push('--variables tiene que ser un entero de 0 a 10');
  if (p.estado === 'APPROVED') {
    if (p.categoria !== 'UTILITY') problemas.push('una plantilla APPROVED tiene que ser UTILITY (Meta la tomó como otra categoría: el servidor no la enviaría; registre el estado real, no APPROVED)');
    if (p.variables !== 1) problemas.push('Retomar usa exactamente UNA variable (el nombre del comercio): --variables 1');
  }
  return problemas;
}

// ===========================================================================
// ARGUMENTOS (puro)
// ===========================================================================
export function analizarArgumentos(argv, env = process.env) {
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
  const { proyecto, numero, uso } = valores;

  if (proyecto === undefined) problemas.push('falta --proyecto');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto !== undefined && !proy.ok) problemas.push(proy.motivo);

  if (numero === undefined) problemas.push('falta --numero');
  else if (!PATRON_NUMERO.test(numero)) problemas.push('--numero inválido (el phoneNumberId: solo dígitos)');
  if (uso === undefined) problemas.push('falta --uso');
  else if (!USOS.includes(uso)) problemas.push(`--uso tiene que ser uno de: ${USOS.join(', ')}`);
  for (const k of ['nombre', 'idioma', 'categoria', 'estado']) if (!(k in valores)) problemas.push(`falta --${k}`);

  let variables = 1;
  if ('variables' in valores) {
    if (!/^[0-9]{1,2}$/.test(valores['variables'])) problemas.push('--variables tiene que ser un entero de 0 a 10');
    else variables = Number(valores['variables']);
  }
  const plantilla = { nombre: valores['nombre'], idioma: valores['idioma'], categoria: valores['categoria'], estado: valores['estado'], variables };
  if (['nombre', 'idioma', 'categoria', 'estado'].every((k) => k in valores)) problemas.push(...problemasDeLaPlantilla(plantilla));

  const confirmo = valores['confirmo'];
  if (confirmo !== undefined) {
    if (!aplicar) problemas.push('--confirmo solo acompaña a --aplicar');
    else if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo solo se usa contra producción');
    else if (confirmo !== 'produccion') problemas.push('--confirmo tiene que ser exactamente «produccion»');
  } else if (aplicar && proy.ok && proy.entorno === 'produccion') {
    problemas.push('contra producción, --aplicar exige --confirmo produccion (escrito a mano)');
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, numero, uso, plantilla, aplicar } };
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================
const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';
const CLAVES = ['nombre', 'idioma', 'categoria', 'estado', 'variables'];
const igual = (a, b) => typeof a === 'object' && a !== null && CLAVES.every((k) => a[k] === b[k]);
const linea = (p) => (p ? `${p.nombre} · ${p.idioma} · ${p.categoria} · ${p.estado} · ${p.variables} variable(s)` : 'AUSENTE');

/** LA ÚNICA ESCRITURA DEL ARCHIVO: solo `plantillas.<uso>`, con `update` y la precondición de la hora leída. */
async function escribir(ref, uso, plantilla, ultimaActualizacion, FieldValue) {
  await ref.update({ [`plantillas.${uso}`]: { ...plantilla, registradaEn: FieldValue.serverTimestamp() } }, { lastUpdateTime: ultimaActualizacion });
}

/** `deps`: `{ db, FieldValue, log }`. Devuelve el código de salida. */
export async function ejecutar(cfg, deps) {
  const { db, FieldValue } = deps;
  const log = deps.log ?? ((t) => console.log(t));
  const ref = db.doc(`rutasWhatsApp/${cfg.numero}`);
  const snap = await ref.get();
  const rotulo = `${cfg.entorno} · número ${cola(cfg.numero)} · uso ${cfg.uso}`;
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo una lectura)'} · ${rotulo}\n`);
  if (!snap.exists) { log('  ✗ No existe la ruta de ese número (nunca se crea aquí; se asigna con asignar-numero). No se escribió nada.\n'); return 2; }
  const hoy = snap.get(`plantillas.${cfg.uso}`);
  log(`  hoy      : ${linea(hoy)}`);
  log(`  después  : ${linea(cfg.plantilla)}`);
  if (igual(hoy, cfg.plantilla)) { log('\n  ✓ Ya está registrada así: nada que hacer.\n'); return 0; }
  if (hoy !== undefined && (typeof hoy !== 'object' || hoy === null)) {
    log('\n  ✗ Lo que hay hoy en ese lugar no es un registro (no es un mapa): no se pisa. No se escribió nada.\n');
    return 2;
  }
  const otro = snap.get('plantillas');
  if (otro !== undefined && (typeof otro !== 'object' || otro === null || Array.isArray(otro))) {
    log('\n  ✗ «plantillas» de la ruta no es un mapa: no se pisa. No se escribió nada.\n');
    return 2;
  }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (y --confirmo produccion) para escribir.\n'); return 1; }
  try {
    await escribir(ref, cfg.uso, cfg.plantilla, snap.updateTime, FieldValue);
  } catch (e) {
    if (esPrecondicion(e)) { log('\n  ✗ La ruta cambió entre la lectura y la escritura: no se escribió nada. Vuelva a correr.\n'); return 3; }
    throw e;
  }
  const despues = (await ref.get()).get(`plantillas.${cfg.uso}`);
  if (!igual(despues, cfg.plantilla)) { log('\n  ✗ La relectura no coincide con lo escrito. Revise la ruta con el seco.\n'); return 3; }
  log(`\n  ✓ Escrito y releído: ${linea(despues)}.`);
  log(plantillaRetomarValida(despues)
    ? '  Cumple C1: el servidor puede enviarla. Falta encender la bandera (aplicar-persona-puede-retomar.mjs).\n'
    : '  NO cumple C1 (no es APPROVED/UTILITY/1 variable): el servidor no la enviará. Si la bandera ya estaba encendida, apáguela.\n');
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
  const codigo = await ejecutar(cfg, { db, FieldValue });
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
