/**
 * =============================================================================
 * LA CONFIGURACIÓN DE LA ALERTA OPERATIVA: `plataforma/alertas`
 * =============================================================================
 *
 * `alertaOperativa` lee de `plataforma/alertas` lo que no puede vivir en el repositorio (es público) ni en el `.env` de
 * despliegue (el de producción es de exactamente dos nombres): el dominio de avisos, el destinatario, los hosts de enlace,
 * los repositorios de Actions permitidos, la lista de cadenas denegadas y el tope diario. Sin este documento la Function
 * guarda los eventos y NO envía correos.
 *
 * QUÉ HACE. Escribe SOLO esos seis campos de `plataforma/alertas` (los que no se pasan, se conservan), con el SDK Admin:
 *   - sin `--aplicar` NO escribe nada: dice qué haría;
 *   - con `--aplicar` deja primero un RESPALDO del documento anterior (archivo de modo 600, creado con O_EXCL, dentro de
 *     `$XDG_RUNTIME_DIR` o de `--respaldo`), escribe y RELEE para confirmar lo escrito (si no coincide, sale 3);
 *   - `--revertir <respaldo>`: vuelve al documento anterior (si no existía, lo borra) y relee.
 *
 * LOS VALORES NO SE VERSIONAN NI SE IMPRIMEN ENTEROS. Vienen por argumento o de un archivo local `*.local.json` (ignorado
 * por git; el script se niega a leer otro nombre). El destinatario se muestra enmascarado (`a***@e***`) y la lista
 * `avisosDenegar` nunca se imprime (solo cuántas cadenas son). Sin valores reales en ningún archivo del repositorio.
 *
 *   node scripts/plataforma/alertas-config.mjs --proyecto <id> --dominio <avisos...> --destinatario <correo> \
 *        --hosts github.com --repos <dueño/repo>[,...] [--denegar a,b] [--tope 5] [--aplicar] [--respaldo <ruta>]
 *   node scripts/plataforma/alertas-config.mjs --proyecto <id> --archivo ./alertas.local.json [--aplicar]
 *   node scripts/plataforma/alertas-config.mjs --proyecto <id> --revertir <respaldo.json> [--aplicar]
 *
 * Campos del archivo: dominioAvisos, destinatario, enlaceHosts, enlaceRepos, avisosDenegar, topeDiario (listas como
 * arreglo o como texto separado por comas). El tope va de 1 a 8 (el código no permite más; un valor mayor se RECHAZA aquí).
 * Salida: 0 hecho o seco · 2 uso o valores inválidos (nada escrito) · 3 la relectura no coincide.
 */
import { closeSync, openSync, readFileSync, writeFileSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const PROYECTO = opcion('proyecto');
const ARCHIVO = opcion('archivo');
const REVERTIR = opcion('revertir');
const RESPALDO = opcion('respaldo');

/** El tope duro del código (`TOPE_MAXIMO` en alertaOperativa.ts; una prueba verifica que sean iguales). */
const TOPE_MAXIMO = 8;
const CAMPOS = ['dominioAvisos', 'destinatario', 'enlaceHosts', 'enlaceRepos', 'avisosDenegar', 'topeDiario'];

const lista = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);
const HOST = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const REPO = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
const CORREO = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

/** Valida lo pedido y devuelve `{valores, problemas}`. Nunca imprime un valor. */
function validar(pedido) {
  const problemas = [];
  const v = {};
  if (pedido.dominioAvisos !== undefined) {
    if (typeof pedido.dominioAvisos === 'string' && HOST.test(pedido.dominioAvisos.trim())) v.dominioAvisos = pedido.dominioAvisos.trim().toLowerCase();
    else problemas.push('dominioAvisos: tiene que ser un dominio (sin esquema ni ruta)');
  }
  if (pedido.destinatario !== undefined) {
    if (typeof pedido.destinatario === 'string' && CORREO.test(pedido.destinatario.trim())) v.destinatario = pedido.destinatario.trim();
    else problemas.push('destinatario: tiene que ser una dirección de correo');
  }
  if (pedido.enlaceHosts !== undefined) {
    const l = lista(pedido.enlaceHosts);
    if (l.length > 0 && l.every((h) => HOST.test(h) && !/^[\d.]+$/.test(h))) v.enlaceHosts = l.map((h) => h.toLowerCase()).join(',');
    else problemas.push('enlaceHosts: una lista de hosts exactos (sin IP, sin esquema, sin puerto)');
  }
  if (pedido.enlaceRepos !== undefined) {
    const l = lista(pedido.enlaceRepos);
    if (l.every((r) => REPO.test(r))) v.enlaceRepos = l.join(',');
    else problemas.push('enlaceRepos: una lista de dueño/repo (vacía = sin enlaces de Actions)');
  }
  if (pedido.avisosDenegar !== undefined) {
    const l = lista(pedido.avisosDenegar);
    if (l.every((x) => x.length >= 3 && x.length <= 80)) v.avisosDenegar = l.join(',');
    else problemas.push('avisosDenegar: cadenas de 3 a 80 caracteres, sin comas');
  }
  if (pedido.topeDiario !== undefined) {
    const n = typeof pedido.topeDiario === 'number' ? pedido.topeDiario : /^\d{1,3}$/.test(String(pedido.topeDiario)) ? Number(pedido.topeDiario) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= TOPE_MAXIMO) v.topeDiario = n;
    else problemas.push(`topeDiario: un entero de 1 a ${TOPE_MAXIMO} (el código no admite más)`);
  }
  return { valores: v, problemas };
}

/** Lo que se muestra de cada campo: el destinatario enmascarado y las denegadas solo contadas. */
function mostrar(campo, valor) {
  if (valor === undefined || valor === null) return '(sin valor)';
  if (campo === 'destinatario') { const [l = '', d = ''] = String(valor).split('@'); return `${l.slice(0, 1)}***@${d.slice(0, 1)}***`; }
  if (campo === 'avisosDenegar') return `${lista(valor).length} cadena(s), no se imprimen`;
  return String(valor);
}

const usoMal = (m) => {
  console.error(`\n  ✗ ${m}`);
  console.error('\n  node scripts/plataforma/alertas-config.mjs --proyecto <id> [--dominio D --destinatario C --hosts H --repos R --denegar X --tope N | --archivo f.local.json] [--aplicar]');
  console.error('  node scripts/plataforma/alertas-config.mjs --proyecto <id> --revertir <respaldo.json> [--aplicar]\n');
  process.exit(2);
};

if (!PROYECTO || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(PROYECTO)) usoMal('--proyecto inválido o ausente');

let pedido = {};
if (!REVERTIR) {
  if (ARCHIVO) {
    if (!/\.local\.json$/.test(ARCHIVO)) usoMal('--archivo tiene que llamarse *.local.json (ignorado por git): los valores reales no se versionan');
    try { pedido = JSON.parse(readFileSync(ARCHIVO, 'utf8')); } catch { usoMal('no pude leer --archivo como JSON'); }
    if (!pedido || typeof pedido !== 'object' || Array.isArray(pedido)) usoMal('--archivo tiene que ser un objeto JSON');
    for (const k of Object.keys(pedido)) if (!CAMPOS.includes(k)) usoMal(`--archivo: campo no permitido «${k.slice(0, 30)}»`);
  } else {
    const por = { dominioAvisos: 'dominio', destinatario: 'destinatario', enlaceHosts: 'hosts', enlaceRepos: 'repos', avisosDenegar: 'denegar', topeDiario: 'tope' };
    for (const [campo, nombre] of Object.entries(por)) { const v = opcion(nombre); if (v !== null) pedido[campo] = v; }
  }
  if (Object.keys(pedido).length === 0) usoMal('no se pidió ningún campo');
}
const { valores, problemas } = REVERTIR ? { valores: {}, problemas: [] } : validar(pedido);
if (problemas.length) usoMal(problemas.join('\n  ✗ '));

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const ref = db.doc('plataforma/alertas');

const instantanea = async () => { const d = await ref.get(); return d.exists ? { existia: true, datos: Object.fromEntries(CAMPOS.filter((c) => d.get(c) !== undefined).map((c) => [c, d.get(c)])) } : { existia: false, datos: {} }; };
const igual = (a, b) => JSON.stringify(CAMPOS.map((c) => a[c] ?? null)) === JSON.stringify(CAMPOS.map((c) => b[c] ?? null));

console.log(`\n  Documento : plataforma/alertas`);
console.log(`  Modo      : ${APLICAR ? 'APLICANDO' : 'seco (no escribe)'}${REVERTIR ? ' · revertir' : ''}\n`);

if (REVERTIR) {
  let previo;
  try { previo = JSON.parse(readFileSync(REVERTIR, 'utf8')); } catch { usoMal('no pude leer el respaldo'); }
  if (typeof previo?.existia !== 'boolean' || typeof previo?.datos !== 'object') usoMal('el respaldo no tiene la forma esperada');
  for (const k of Object.keys(previo.datos)) if (!CAMPOS.includes(k)) usoMal('el respaldo trae campos que este script no maneja');
  console.log(`  Volvería a: ${previo.existia ? 'el documento anterior' : 'sin documento (se borra)'}`);
  for (const c of CAMPOS) console.log(`    ${c.padEnd(14)} ${mostrar(c, previo.datos[c])}`);
  if (!APLICAR) { console.log('\n  Sin --aplicar no se escribió nada.\n'); process.exit(0); }
  if (previo.existia) {
    // Se reemplazan los seis campos: los que el respaldo no trae se borran.
    const { FieldValue } = await import('firebase-admin/firestore');
    await ref.set(Object.fromEntries(CAMPOS.map((c) => [c, previo.datos[c] === undefined ? FieldValue.delete() : previo.datos[c]])), { merge: true });
  } else {
    await ref.delete();   // no existía: se borra el documento entero
  }
  const ahora = await instantanea();
  if (!igual(ahora.datos, previo.datos)) { console.error('  ✗ al releer, el documento NO quedó como el respaldo'); process.exit(3); }
  console.log('\n  ✓ revertido y comprobado por relectura\n');
  process.exit(0);
}

const antes = await instantanea();
const despues = { ...antes.datos, ...valores };
console.log(`  ${antes.existia ? 'Hay un documento' : 'No hay documento todavía'}. Cambios:`);
for (const c of CAMPOS) {
  if (valores[c] === undefined) continue;
  const igualCampo = JSON.stringify(antes.datos[c] ?? null) === JSON.stringify(valores[c]);
  console.log(`    ${c.padEnd(14)} ${mostrar(c, antes.datos[c])}  →  ${mostrar(c, valores[c])}${igualCampo ? '  (sin cambio)' : ''}`);
}
if (igual(antes.datos, despues)) { console.log('\n  Nada que cambiar.\n'); process.exit(0); }
if (!APLICAR) { console.log('\n  Sin --aplicar no se escribió nada.\n'); process.exit(0); }

// RESPALDO primero (O_EXCL, modo 600): sin respaldo no se escribe.
const base = RESPALDO ?? join(process.env.XDG_RUNTIME_DIR || '', `alertas-config-respaldo-${Date.now()}.json`);
if (!RESPALDO && !process.env.XDG_RUNTIME_DIR) { console.error('  ✗ sin $XDG_RUNTIME_DIR ni --respaldo no hay dónde dejar el respaldo: no se escribió nada'); process.exit(2); }
const ruta = resolve(base);
try {
  const fd = openSync(ruta, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  closeSync(fd);
  writeFileSync(ruta, JSON.stringify(antes), { mode: 0o600 });
} catch { console.error('  ✗ no pude crear el respaldo (¿ya existe?): no se escribió nada'); process.exit(2); }

await ref.set(valores, { merge: true });
const ahora = await instantanea();
if (!igual(ahora.datos, despues)) { console.error(`  ✗ al releer, el documento NO quedó como se pidió. Respaldo: ${ruta}`); process.exit(3); }
console.log(`\n  ✓ escrito y comprobado por relectura\n  Respaldo (modo 600): ${ruta}`);
console.log('  Para deshacer: --revertir <ese archivo> --aplicar\n');
