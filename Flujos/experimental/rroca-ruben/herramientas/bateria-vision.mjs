#!/usr/bin/env node
// BATERÍA DE LA VISIÓN DE «VENTA DIGITAL DE RUBÉN» CONTRA LAS ARTES REALES (23/10/2026).
//
// QUÉ ES. Corre el MISMO prompt del nodo «Ver imagen» del flujo armado (`rroca-ruben.prueba.json`) contra las imágenes REALES de las campañas de Rubén, con el modelo del nodo
// (`gemini-3.5-flash-lite`), y mide lo que decide el reconocimiento del anuncio: si la categoría es `publicidad` y si el `titular_principal` que devuelve coincide con el catálogo de anuncios
// (`admin/scripts/datos/rroca-ruben/campanas-rroca-ruben.json`) según el módulo común `anuncio-por-titular.js` (el MISMO que corre «Preparar imagen»). Motor reutilizado de
// `chat-novuchat/herramientas/bateria.mjs` (credencial, llamada, costo): no se copia un motor más.
//
// LAS IMÁGENES SON DEL CLIENTE. Se leen de una carpeta que se pasa con `--imagenes` (en la copia base: `CLIENTES/RUBEN_ROCA/Ruben/`), SOLO LECTURA y EN MEMORIA: nunca se copian al repositorio, nunca se
// escriben, y el informe NO imprime su contenido ni sus nombres: cada una sale como «arte 1», «arte 2»… con su categoría, el anuncio reconocido (por id) y el LARGO del titular que leyó la visión.
//
//   node Flujos/experimental/rroca-ruben/herramientas/bateria-vision.mjs --seco                           # por omisión: NO llama a nada ni lee clave
//   node Flujos/experimental/rroca-ruben/herramientas/bateria-vision.mjs --seco --imagenes <carpeta>      # además cuenta las artes que encuentra (no las lee)
//   node Flujos/experimental/rroca-ruben/herramientas/bateria-vision.mjs --imagenes <carpeta> --vertex <proyecto-de-pruebas> --confirmo-gasto
//   node Flujos/experimental/rroca-ruben/herramientas/bateria-vision.mjs --imagenes <carpeta> --env <archivo> --confirmo-gasto --json
//
// OPCIONES  --seco (por omisión)  --confirmo-gasto (OBLIGATORIA para llamar al modelo: es GASTO, ≈ USD 0,0005 por imagen)  --imagenes <carpeta>  --n <1..5> corridas por imagen (1)
//   --env <archivo> / --vertex <proyecto> / --locacion <región>  (la credencial: del proyecto de PRUEBAS, nunca la de producción)  --pausa <segundos> (65: tras cada 10 llamadas, el límite es ~10 por minuto)  --json  --ayuda
//
// NUNCA SE IMPRIME EL VALOR DE UN SECRETO. NO ESCRIBE ARCHIVOS. Solo habla con `generativelanguage.googleapis.com` o `aiplatform.googleapis.com`.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ErrorDeUso, TARIFA, leerCredencial, limpiarSecretos, llamarGemini, textoDeGemini } from '../../chat-novuchat/herramientas/bateria.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RUTA_FLUJO = join(AQUI, '../rroca-ruben.prueba.json');
const RUTA_ANUNCIOS = join(AQUI, '../../../../admin/scripts/datos/rroca-ruben/campanas-rroca-ruben.json');
const RUTA_MODULO = join(AQUI, '../../../src/core/medios/anuncio-por-titular.js');
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const MAX_BYTES = 5_000_000;   // el mismo tope de foto del flujo
const POR_MINUTO = 10;

const AYUDA = `Batería de la visión de Rubén contra las artes reales.
  --seco (por omisión)  --confirmo-gasto  --imagenes <carpeta>  --n <1..5>  --env <archivo>  --vertex <proyecto>  --locacion <región>  --pausa <segundos>  --json  --ayuda
Fuera de --seco la corrida es GASTO: exige --confirmo-gasto y una credencial del proyecto de PRUEBAS. Las imágenes son del cliente: se leen en memoria y no se imprimen.`;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const mensajeDe = (e) => (e instanceof Error ? e.message : String(e));

export function leerOpciones(argv) {
  const o = { seco: true, confirmo: false, imagenes: null, n: 1, env: '.env.novuchat', vertex: null, locacion: 'us-central1', pausa: 65, json: false, ayuda: false, envDado: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seco') { o.seco = true; continue; }
    if (a === '--confirmo-gasto') { o.confirmo = true; continue; }
    if (a === '--json') { o.json = true; continue; }
    if (a === '--ayuda') { o.ayuda = true; continue; }
    if (!['--imagenes', '--n', '--env', '--vertex', '--locacion', '--pausa'].includes(a)) throw new ErrorDeUso(`Opción desconocida: ${limpiarSecretos(a).slice(0, 40)}. Usa --ayuda.`);
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) throw new ErrorDeUso(`Falta el valor de ${a}.`);
    if (a === '--imagenes') o.imagenes = v;
    else if (a === '--n') { if (!/^[1-5]$/.test(v)) throw new ErrorDeUso('--n debe ser un entero de 1 a 5.'); o.n = Number(v); }
    else if (a === '--env') { o.env = v; o.envDado = true; }
    else if (a === '--vertex') { if (!/^[a-z][a-z0-9-]{4,60}$/.test(v)) throw new ErrorDeUso('--vertex debe ser un id de proyecto de Google Cloud.'); o.vertex = v; }
    else if (a === '--locacion') { if (!/^[a-z0-9-]{3,30}$/.test(v)) throw new ErrorDeUso('--locacion no es una región válida.'); o.locacion = v; }
    else if (a === '--pausa') { if (!/^\d{1,3}$/.test(v)) throw new ErrorDeUso('--pausa son segundos (0 a 999).'); o.pausa = Number(v); }
  }
  // La corrida real es la que trae --confirmo-gasto; sin ella, todo es en seco.
  o.seco = !o.confirmo;
  if (o.confirmo && (!o.imagenes)) throw new ErrorDeUso('La corrida real necesita --imagenes <carpeta>.');
  return o;
}

/** El prompt, el modelo y la URL del nodo «Ver imagen» del flujo ARMADO (la misma fuente que el flujo vivo). */
export function leerNodoVerImagen() {
  const flujo = JSON.parse(readFileSync(RUTA_FLUJO, 'utf8'));
  const nodo = (flujo.nodes ?? []).find((n) => n.name === 'Ver imagen');
  const p = nodo?.parameters ?? {};
  const modelo = /^models\/([A-Za-z0-9._-]+)$/.exec(String(p.modelId?.value ?? ''))?.[1];
  if (!nodo || typeof p.text !== 'string' || !modelo) throw new ErrorDeUso('No se encontró el nodo «Ver imagen» con su prompt y su modelo en el flujo armado.');
  return { prompt: p.text, modelo, maxOutputTokens: Number(p.options?.maxOutputTokens) || 400 };
}

/** Los anuncios como los entrega la Consola al flujo: titulares, ángulo y producto (aquí sin producto: solo importa el reconocimiento). */
export function anunciosDelArchivo() {
  const d = JSON.parse(readFileSync(RUTA_ANUNCIOS, 'utf8'));
  return (d.anuncios ?? []).map((a) => ({ id: a.id, titulares: a.titulares.slice(0, 3), angulo: a.angulo, producto: null }));
}

/** El módulo común que corre «Preparar imagen», cargado tal cual. Es código del propio repositorio. */
export function cargarReconocedor() {
  // nosemgrep: devsecops.js-eval-prohibido
  return new Function(`${readFileSync(RUTA_MODULO, 'utf8')}\nreturn anuncioPorTitular;`)();
}

/** La respuesta del modelo como la lee «Preparar imagen»: del primer `{` al último `}`. */
export function objetoDeLaRespuesta(texto) {
  const m = /\{[\s\S]*\}/.exec(String(texto ?? ''));
  if (!m) return {};
  try { const o = JSON.parse(m[0]); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
}

/** Lo que se mide de UNA respuesta: categoría, si se reconoció un anuncio (id) y el largo del titular. Nunca el texto del titular. */
export function medirRespuesta(objeto, reconocedor, anuncios) {
  const categoria = typeof objeto.categoria === 'string' ? objeto.categoria : '';
  const titular = typeof objeto.titular_principal === 'string' ? objeto.titular_principal : '';
  const hallado = categoria === 'publicidad' ? reconocedor(titular, anuncios) : null;
  return { categoria, esPublicidad: categoria === 'publicidad', reconocido: hallado ? hallado.id : '', largoTitular: titular.length, conPago: ['comprobante', 'pago_con_problema'].includes(categoria) };
}

function listarArtes(carpeta) {
  if (!existsSync(carpeta)) throw new ErrorDeUso('La carpeta de imágenes no existe.');
  return readdirSync(carpeta).filter((f) => MIME[extname(f).toLowerCase()]).sort().map((f) => join(carpeta, f)).filter((r) => statSync(r).isFile() && statSync(r).size <= MAX_BYTES);
}

export async function correr(opciones, deps) {
  const nodo = leerNodoVerImagen();
  const anuncios = anunciosDelArchivo();
  const reconocedor = cargarReconocedor();
  const informe = { modo: opciones.seco ? 'seco' : 'real', modelo: nodo.modelo, anuncios: anuncios.length, artes: 0, llamadas: 0, filas: [], costoUsd: 0, tokensEntrada: 0, tokensSalida: 0 };
  if (opciones.seco) {
    // Sin red ni clave: comprueba que cada titular del catálogo se reconoce con el módulo común (la mitad determinista de la medida) y cuenta las artes si se pasó la carpeta.
    informe.artes = opciones.imagenes ? listarArtes(opciones.imagenes).length : 0;
    informe.filas = anuncios.map((a, i) => ({ arte: `titular ${i + 1}`, ...medirRespuesta({ categoria: 'publicidad', titular_principal: a.titulares[0] }, reconocedor, anuncios) }));
    return informe;
  }
  const credencial = leerCredencial(opciones, deps);
  const artes = listarArtes(opciones.imagenes);
  if (!artes.length) throw new ErrorDeUso('No hay imágenes (jpg, png o webp de hasta 5 MB) en la carpeta.');
  informe.artes = artes.length;
  const urlDelNodo = `https://generativelanguage.googleapis.com/v1beta/models/${nodo.modelo}:generateContent`;
  let enLaVentana = 0;
  for (let k = 0; k < artes.length; k++) {
    for (let rep = 0; rep < opciones.n; rep++) {
      if (enLaVentana >= POR_MINUTO) { await deps.dormir(opciones.pausa * 1000); enLaVentana = 0; }
      const bytes = readFileSync(artes[k]);   // en memoria; no se escribe ni se imprime
      const cuerpo = { contents: [{ role: 'user', parts: [{ text: nodo.prompt }, { inline_data: { mime_type: MIME[extname(artes[k]).toLowerCase()], data: bytes.toString('base64') } }] }], generationConfig: { maxOutputTokens: nodo.maxOutputTokens } };
      const r = await llamarGemini({ cuerpo, urlDelNodo, credencial, opciones, deps, nodo: { maxTries: 2, waitBetweenTries: 1500, parameters: { options: { timeout: 60000 } } } });
      enLaVentana++; informe.llamadas++;
      const uso = r.json?.usageMetadata ?? {};
      informe.tokensEntrada += Number(uso.promptTokenCount) || 0;
      informe.tokensSalida += (Number(uso.candidatesTokenCount) || 0) + (Number(uso.thoughtsTokenCount) || 0);
      const fila = r.fallo ? { arte: `arte ${k + 1}`, error: limpiarSecretos(String(r.json?.error?.message ?? 'sin respuesta'), [credencial.clave, credencial.token]).slice(0, 100) }
        : { arte: `arte ${k + 1}`, ...medirRespuesta(objetoDeLaRespuesta(textoDeGemini(r.json)), reconocedor, anuncios) };
      informe.filas.push(fila);
    }
  }
  informe.costoUsd = Math.round(((informe.tokensEntrada * TARIFA.entrada + informe.tokensSalida * TARIFA.salida) / 1e6) * 1e5) / 1e5;
  return informe;
}

export function resumir(inf) {
  const ok = inf.filas.filter((f) => !f.error);
  const pub = ok.filter((f) => f.esPublicidad).length;
  const rec = ok.filter((f) => f.reconocido).length;
  const ids = [...new Set(ok.map((f) => f.reconocido).filter(Boolean))];
  const mal = ok.filter((f) => f.conPago).length;
  return { medidas: ok.length, errores: inf.filas.length - ok.length, publicidad: pub, reconocidas: rec, anunciosDistintos: ids, tomadasPorPago: mal };
}

export async function main(argv, deps) {
  const o = leerOpciones(argv);
  if (o.ayuda) { deps.salida(AYUDA); return 0; }
  const inf = await correr(o, deps);
  const r = resumir(inf);
  if (o.json) { deps.salida(JSON.stringify({ ...inf, resumen: r })); return r.tomadasPorPago > 0 || r.errores > 0 ? 1 : 0; }
  deps.salida(`Modo: ${inf.modo} · modelo ${inf.modelo} · anuncios del catálogo: ${inf.anuncios} · artes: ${inf.artes} · llamadas: ${inf.llamadas}`);
  for (const f of inf.filas) deps.salida(`  ${f.arte}: ${f.error ? `ERROR ${f.error}` : `categoría=${f.categoria || '(ninguna)'} reconocido=${f.reconocido || '—'} largo del titular=${f.largoTitular}`}`);
  deps.salida(`Resumen: ${r.publicidad}/${r.medidas} como publicidad · ${r.reconocidas}/${r.medidas} reconocidas (${r.anunciosDistintos.length} anuncios distintos) · tomadas por comprobante o pago: ${r.tomadasPorPago} · errores: ${r.errores}`);
  if (inf.modo === 'real') deps.salida(`Tokens: ${inf.tokensEntrada} de entrada y ${inf.tokensSalida} de salida · costo ≈ USD ${inf.costoUsd} (tarifa de bateria.mjs; no es una factura)`);
  else deps.salida('Seco: no se llamó a nada. La corrida real exige --imagenes y --confirmo-gasto.');
  return r.tomadasPorPago > 0 || r.errores > 0 || (inf.modo === 'seco' && r.reconocidas !== r.medidas) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const deps = {
    fetch: globalThis.fetch, dormir,
    leerArchivo: (a) => { try { return readFileSync(a, 'utf8'); } catch { return null; } },
    gcloudToken: () => execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }),
    salida: (t) => console.log(t),
  };
  main(process.argv.slice(2), deps).then((c) => process.exit(c)).catch((e) => { console.error(`✗ ${limpiarSecretos(mensajeDe(e)).slice(0, 300)}`); process.exit(e instanceof ErrorDeUso ? 2 : 1); });
}
