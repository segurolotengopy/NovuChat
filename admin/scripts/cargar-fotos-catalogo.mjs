#!/usr/bin/env node
/**
 * =============================================================================
 * SUBIR LAS FOTOS DEL CATÁLOGO Y EL LOGO DE UN COMERCIO, DESDE ARCHIVOS.
 * =============================================================================
 *
 * POR QUÉ EXISTE. `cargar-negocio.mjs` escribe el catálogo entero desde un JSON
 * versionado, pero NO escribe las fotos: la foto de un ítem no vive dentro del
 * ítem —`configuracionFlujo` lee el catálogo en la ruta de CADA mensaje de
 * WhatsApp y no tiene por qué cargar megas de imagen—, vive en
 * `tenants/{t}/fotosCatalogo/{itemId}`, y el logo en `tenants/{t}/config/marca`.
 * Hasta hoy los dos se subían de a uno por la consola, con el ratón. Para una
 * demostración de ciento cincuenta productos eso no es una molestia: es que la
 * demostración no se arma.
 *
 * QUÉ HACE, y qué NO:
 *   - toma una carpeta de imágenes `<idDelItem>.webp|.jpeg|.jpg|.png`, y escribe
 *     una por documento en `fotosCatalogo/{itemId}`, con los mismos cinco campos
 *     que escribe la consola (`datos`, `ancho`, `alto`, `bytes`, `tipo`) más el
 *     sello;
 *   - con `--logo <archivo>` escribe `config/marca.logo`. El archivo tiene que
 *     venir ya recortado a 320 px del lado mayor, que es lo que hace el
 *     navegador en `web/src/paginas/Configuracion.tsx`; si viene más grande se
 *     avisa, porque el resultado no sería idéntico al de subirlo a mano;
 *   - con `--limpiar` borra las fotos del comercio, que es como se vuelve de una
 *     demostración a otra;
 *   - **no redimensiona ni recomprime nada más**. Lo que se le da tiene que
 *     entrar ya en los límites; si no entra, lo dice y no escribe. Meterle un
 *     codificador de imágenes a un script de operación sería agregarle una
 *     dependencia nativa a algo que corre contra producción, y el recorte ya lo
 *     hace quien prepara los archivos.
 *
 * LOS LÍMITES SON LOS DE `firestore.rules`, leídos de ahí y no inventados:
 *   fotosCatalogo → `datos` casa `^data:image/(webp|jpeg|png);base64,…`, hasta
 *                   210.000 caracteres; `bytes` hasta 210.000; `ancho` y `alto`
 *                   entre 1 y 4.000; y NINGUNA clave fuera de las siete.
 *   config/marca  → `logo` casa `^data:image/(png|jpeg|webp);base64,…` y hasta
 *                   200.000 caracteres; solo `logo` y el sello.
 * El SDK Admin no pasa por las reglas, así que si este script no las respetara,
 * dejaría escrito algo que la consola después no podría ni editar ni borrar.
 *
 * UNA FOTO SIN SU ÍTEM NO SE ESCRIBE. `fotosCatalogo/{itemId}` se ata a un ítem
 * del catálogo: si el ítem no existe, la foto es peso muerto que nadie va a ver
 * ni a limpiar. Se avisa y se sigue con las demás, igual que hace la importación
 * en lote de la consola con una foto que no entra.
 *
 * NO IMPRIME NINGÚN SECRETO, y tampoco imprime los datos de las imágenes: de
 * cada una salen el identificador, las medidas y los kilobytes.
 *
 *   node scripts/cargar-fotos-catalogo.mjs --proyecto <id> --tenant <id> \
 *     --fotos CLIENTES/WALISUMA/fotos [--logo CLIENTES/WALISUMA/logo.webp] [--aplicar]
 *
 *   node scripts/cargar-fotos-catalogo.mjs --proyecto <id> --tenant <id> \
 *     --limpiar [--logo] [--aplicar]   # borra las fotos (y vacía el logo con
 *                                      # --logo sin archivo), para volver al otro demo
 *
 * Seco por defecto: sin `--aplicar` no escribe nada.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const args = process.argv.slice(2);
const leer = (bandera) => {
  const i = args.indexOf(bandera);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '';
};
const hay = (bandera) => args.includes(bandera);

const PROYECTO = leer('--proyecto');
const TENANT = leer('--tenant');
const DIR_FOTOS = leer('--fotos');
const ARCHIVO_LOGO = leer('--logo');
const LIMPIAR = hay('--limpiar');
const APLICAR = hay('--aplicar');

const V = '\x1b[32m'; const A = '\x1b[33m'; const R = '\x1b[31m'; const G = '\x1b[90m'; const F = '\x1b[0m';
const salir = (mensaje) => { console.error(`${R}✗${F} ${mensaje}`); process.exit(1); };

// --- EL CONTRATO, copiado de firestore.rules --------------------------------
const TOPE_FOTO = 210_000;   // caracteres de `datos` Y valor de `bytes`
const TOPE_LOGO = 200_000;   // caracteres de `logo`
const LADO_MAXIMO = 4_000;   // `ancho` y `alto`
/** `fotoValida`: solo estos tres tipos, y en este orden en la expresión. */
const TIPOS_FOTO = { '.webp': 'image/webp', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png' };
/** Mismo identificador de documento que deriva `cargar-negocio.mjs` del nombre. */
const ID_ITEM = /^[a-z0-9][a-z0-9-]{0,59}$/;

if (!PROYECTO) salir('Falta --proyecto.');
if (!TENANT) salir('Falta --tenant.');
if (!LIMPIAR && !DIR_FOTOS && !ARCHIVO_LOGO) salir('Falta --fotos, --logo o --limpiar.');
if (LIMPIAR && DIR_FOTOS) salir('--limpiar y --fotos son excluyentes: o se borra o se carga.');

/**
 * Las medidas de una imagen, leídas de su cabecera.
 *
 * SE LEEN DE LOS BYTES Y NO SE PIDEN POR BANDERA porque `ancho` y `alto` son
 * campos que las reglas validan y que la página usa para reservar el hueco de
 * la tarjeta antes de que la foto cargue. Un valor tecleado a mano que no
 * coincida con la imagen no lo detecta nadie: se ve como un salto en la página.
 *
 * Solo hacen falta tres formatos y sus cabeceras son fijas, así que esto son
 * treinta líneas en vez de una dependencia.
 */
function medidas(buf, tipo) {
  if (tipo === 'image/png') {
    // PNG: firma de 8 bytes, después el chunk IHDR con ancho y alto en 32 bits.
    if (buf.length < 24 || buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
    return { ancho: buf.readUInt32BE(16), alto: buf.readUInt32BE(20) };
  }
  if (tipo === 'image/webp') {
    // RIFF....WEBP y después VP8 (lossy), VP8L (lossless) o VP8X (extendido).
    if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF'
        || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
    const clase = buf.toString('ascii', 12, 16);
    if (clase === 'VP8 ') {
      return { ancho: buf.readUInt16LE(26) & 0x3fff, alto: buf.readUInt16LE(28) & 0x3fff };
    }
    if (clase === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { ancho: (b & 0x3fff) + 1, alto: ((b >> 14) & 0x3fff) + 1 };
    }
    if (clase === 'VP8X') {
      const leer24 = (i) => buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16);
      return { ancho: leer24(24) + 1, alto: leer24(27) + 1 };
    }
    return null;
  }
  // JPEG: se recorren los marcadores hasta un SOF, que es el que trae medidas.
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marca = buf[i + 1];
    if (marca === 0xd8 || marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7)) { i += 2; continue; }
    const largo = buf.readUInt16BE(i + 2);
    // SOF0..SOF15, salvo los cuatro que no son de inicio de cuadro.
    if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca)) {
      return { alto: buf.readUInt16BE(i + 5), ancho: buf.readUInt16BE(i + 7) };
    }
    i += 2 + largo;
  }
  return null;
}

/** Lo que se va a escribir para una imagen, o el motivo por el que no. */
function prepararImagen(ruta, tope) {
  const ext = extname(ruta).toLowerCase();
  const tipo = TIPOS_FOTO[ext];
  if (!tipo) return { problema: `extensión ${ext || '(ninguna)'}: solo webp, jpeg o png` };
  const buf = readFileSync(ruta);
  if (buf.length === 0) return { problema: 'archivo vacío' };
  const m = medidas(buf, tipo);
  if (!m) return { problema: `no se pudo leer la cabecera ${tipo}: ¿el archivo está completo?` };
  if (m.ancho < 1 || m.alto < 1 || m.ancho > LADO_MAXIMO || m.alto > LADO_MAXIMO) {
    return { problema: `${m.ancho}×${m.alto}: las reglas exigen de 1 a ${LADO_MAXIMO} por lado` };
  }
  const datos = `data:${tipo};base64,${buf.toString('base64')}`;
  if (datos.length > tope) {
    return { problema: `${Math.round(datos.length / 1024)} KB en base64, y el tope es `
      + `${Math.round(tope / 1024)} KB. Recórtela o baje la calidad antes de cargarla.` };
  }
  return { datos, tipo, ancho: m.ancho, alto: m.alto, bytes: buf.length };
}

initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
const db = getFirestore();

const ficha = await db.doc(`tenants/${TENANT}`).get();
if (!ficha.exists) salir(`El comercio ${TENANT} no existe en ${PROYECTO}.`);
const flujos = Array.isArray(ficha.get('flujos')) ? ficha.get('flujos') : [ficha.get('vertical')];

console.log(`\n  Proyecto : ${PROYECTO}`);
console.log(`  Comercio : ${TENANT} — ${ficha.get('nombre')}  ${G}(${flujos.join(', ')})${F}`);

// EL LOGO ES CAPACIDAD DE VENTA, igual que el catálogo web: `config/marca` solo
// se acepta con `tieneCobro` (firestore.rules §/config/marca). Escribirlo en un
// comercio sin el flujo dejaría un documento que la consola no puede editar.
if (ARCHIVO_LOGO && !flujos.includes('venta')) {
  salir(`El comercio ${TENANT} no tiene el flujo venta: /config/marca no le corresponde.`);
}

// ---------------------------------------------------------------------------
// LIMPIAR
// ---------------------------------------------------------------------------
if (LIMPIAR) {
  const actuales = await db.collection(`tenants/${TENANT}/fotosCatalogo`).select().get();
  console.log(`\n  ${actuales.size} foto(s) cargada(s) en fotosCatalogo.`);
  for (const d of actuales.docs) console.log(`    ${G}borrar${F}  ${d.id}`);
  // `--limpiar --logo` (sin archivo) quita también el logo. Se escribe la
  // cadena VACÍA y no se borra el documento: es como lo quita el comercio desde
  // la consola, y `firestore.rules` acepta el vacío justamente por eso —el
  // borrado del documento está cerrado—.
  const quitarLogo = hay('--logo') && ARCHIVO_LOGO === '';
  if (quitarLogo) console.log(`    ${G}vaciar${F}  config/marca.logo`);
  if (!APLICAR) {
    console.log(`\n  ${A}Seco: no se borró nada. Agregue --aplicar.${F}\n`);
    process.exit(0);
  }
  let lote = db.batch(); let n = 0;
  for (const d of actuales.docs) {
    lote.delete(d.ref); n += 1;
    if (n % 400 === 0) { await lote.commit(); lote = db.batch(); }
  }
  await lote.commit();
  if (quitarLogo) {
    await db.doc(`tenants/${TENANT}/config/marca`).set(
      { logo: '', actualizadoPor: 'cargar-fotos-catalogo', actualizadoEn: FieldValue.serverTimestamp() },
      { merge: true });
  }
  await db.collection(`tenants/${TENANT}/auditoria`).add({
    accion: 'limpiar_fotos_catalogo', cantidad: actuales.size, logo: quitarLogo,
    por: 'cargar-fotos-catalogo.mjs', en: FieldValue.serverTimestamp(),
  });
  console.log(`\n  ${V}✓${F} Borradas ${actuales.size} foto(s) de ${TENANT}`
    + `${quitarLogo ? ' y vaciado el logo' : ''}.\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// PREPARAR
// ---------------------------------------------------------------------------
/** Los ítems que existen: una foto sin ítem no se escribe. */
const catalogo = new Set(
  (await db.collection(`tenants/${TENANT}/catalogo`).select().get()).docs.map((d) => d.id));

const listas = []; const problemas = [];

if (DIR_FOTOS) {
  let archivos;
  try {
    archivos = readdirSync(DIR_FOTOS).filter((f) => TIPOS_FOTO[extname(f).toLowerCase()]).sort();
  } catch { salir(`No se pudo leer la carpeta ${DIR_FOTOS}.`); }
  if (archivos.length === 0) salir(`${DIR_FOTOS} no tiene ninguna imagen webp, jpeg o png.`);

  for (const f of archivos) {
    const id = basename(f, extname(f));
    if (!ID_ITEM.test(id)) { problemas.push([id, 'el nombre del archivo no es un identificador válido']); continue; }
    if (!catalogo.has(id)) { problemas.push([id, 'no hay ningún ítem con ese identificador en el catálogo']); continue; }
    const r = prepararImagen(join(DIR_FOTOS, f), TOPE_FOTO);
    if (r.problema) { problemas.push([id, r.problema]); continue; }
    listas.push({ id, ...r });
  }
  const sinFoto = [...catalogo].filter((id) => !listas.some((l) => l.id === id));
  console.log(`\n  Fotos    : ${DIR_FOTOS}`);
  console.log(`             ${listas.length} lista(s) · ${problemas.length} con problema `
    + `· ${sinFoto.length} ítem(s) del catálogo sin foto`);
  const total = listas.reduce((s, l) => s + l.bytes, 0);
  if (listas.length) {
    const mayor = listas.reduce((a, b) => (a.bytes > b.bytes ? a : b));
    console.log(`             ${Math.round(total / 1024)} KB en total · la mayor es `
      + `${mayor.id} con ${Math.round(mayor.bytes / 1024)} KB (${mayor.ancho}×${mayor.alto})`);
  }
  if (sinFoto.length) console.log(`             ${G}sin foto: ${sinFoto.slice(0, 6).join(', ')}`
    + `${sinFoto.length > 6 ? `, y ${sinFoto.length - 6} más` : ''}${F}`);
}

let logo = null;
if (ARCHIVO_LOGO) {
  try { statSync(ARCHIVO_LOGO); } catch { salir(`No existe ${ARCHIVO_LOGO}.`); }
  const r = prepararImagen(ARCHIVO_LOGO, TOPE_LOGO);
  if (r.problema) salir(`El logo no sirve: ${r.problema}`);
  // Es el recorte de `Configuracion.tsx`: no se puede agrandar acá, pero sí
  // avisar, porque un logo de 2.000 px cargado por este camino se vería
  // distinto del que sube el comercio por la consola.
  if (Math.max(r.ancho, r.alto) > 320) {
    console.log(`\n  ${A}Aviso${F}: el logo mide ${r.ancho}×${r.alto}. La consola recorta a 320 px `
      + `del lado mayor;\n         este archivo quedará más grande que uno subido a mano.`);
  }
  logo = r;
  console.log(`\n  Logo     : ${basename(ARCHIVO_LOGO)} · ${r.ancho}×${r.alto} · `
    + `${Math.round(r.bytes / 1024)} KB · ${r.tipo} → config/marca`);
}

for (const [id, motivo] of problemas) console.log(`  ${R}✗${F} ${id.padEnd(40)} ${motivo}`);

if (!listas.length && !logo) salir('No hay nada que escribir.');

if (!APLICAR) {
  console.log(`\n  ${A}Seco: no se escribió nada. Agregue --aplicar.${F}\n`);
  process.exit(problemas.length ? 1 : 0);
}

// ---------------------------------------------------------------------------
// ESCRIBIR
// ---------------------------------------------------------------------------
const sello = { actualizadoPor: 'cargar-fotos-catalogo', actualizadoEn: FieldValue.serverTimestamp() };

// En lotes y no en una transacción: ciento cincuenta imágenes no entran en el
// límite de una transacción de Firestore, y además no hace falta que entren.
// Cada foto es independiente de las demás; si una falla, las otras siguen
// sirviendo y volver a correr el script repone la que falte.
let lote = db.batch(); let n = 0;
for (const l of listas) {
  lote.set(db.doc(`tenants/${TENANT}/fotosCatalogo/${l.id}`), {
    datos: l.datos, ancho: l.ancho, alto: l.alto, bytes: l.bytes, tipo: l.tipo, ...sello,
  });
  n += 1;
  // El tope real es de 10 MiB por lote, no de documentos: con imágenes de
  // hasta 210 KB, veinte por lote dejan margen de sobra.
  if (n % 20 === 0) { await lote.commit(); lote = db.batch(); }
}
if (n % 20 !== 0) await lote.commit();

if (logo) {
  await db.doc(`tenants/${TENANT}/config/marca`).set({ logo: logo.datos, ...sello }, { merge: true });
}

await db.collection(`tenants/${TENANT}/auditoria`).add({
  accion: 'cargar_fotos_catalogo',
  fotos: listas.length,
  logo: Boolean(logo),
  por: 'cargar-fotos-catalogo.mjs',
  en: FieldValue.serverTimestamp(),
});

// VERIFICACIÓN: se relee lo escrito. Es el mismo criterio de `cargar-negocio.mjs`:
// decir «listo» sin haber mirado es lo que hace que un defecto aparezca delante
// del cliente y no en la terminal.
const releidas = await db.collection(`tenants/${TENANT}/fotosCatalogo`).select().get();
console.log(`\n  ${V}✓${F} Escritas ${listas.length} foto(s)${logo ? ' y el logo' : ''}.`);
console.log(`  ${V}✓${F} Verificación: ${releidas.size} foto(s) en fotosCatalogo de ${TENANT}.\n`);
process.exit(problemas.length ? 1 : 0);
