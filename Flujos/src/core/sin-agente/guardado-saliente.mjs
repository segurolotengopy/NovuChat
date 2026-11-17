/**
 * =============================================================================
 * guardado-saliente.mjs — la rama común que GUARDA la imagen que el asistente envió
 * =============================================================================
 *
 *   import { injertarGuardadoSaliente, hallazgosDelGuardadoSaliente } from '<ruta>/core/sin-agente/guardado-saliente.mjs';
 *
 * Plan «ver en la consola las imágenes enviadas por el asistente» (Andres, 16/11/2026), bloque 2a. El servidor (`guardarMedio`, bloque 1) acepta una imagen
 * SALIENTE del asistente: mismo `idMeta` que registró «Reportar mensaje (saliente)», tipo `image`, hasta 30 minutos, y la guarda con `origen: 'asistente'`.
 * Lo INCLUYE cada constructor, nunca se copia: el código del nodo Code sale de `Flujos/src/core/medios/guardado-saliente-preparar.js` tal cual.
 *
 *   Reportar mensaje (saliente) → Preparar guardado (saliente) ─┬─ vía `enlace` → Descargar enlace (guardado saliente) ───────────────────────┐
 *                                                               └─ vía `media`  → Pedir imagen a Meta → Descargar imagen de Meta ────────────┴→ Guardar imagen enviada
 *   Según las vías del flujo (`vias`): solo enlace = 3 nodos; solo media = 4; las dos = 6 (con «¿Por enlace? (guardado saliente)»).
 *
 * POR QUÉ ASÍ:
 *  - COLGADA DE «Reportar mensaje (saliente)» y DEBAJO de todo el lienzo: el servidor exige el saliente YA registrado, y con `executionOrder: v1` la rama corre
 *    después de que el cliente recibió todo lo que se le envía. NO agrega un mensaje de WhatsApp (0), no cambia el texto ni el orden de lo que se envía.
 *  - NADA CORTA EL TURNO: cada nodo de red lleva `onError: continueRegularOutput` y `alwaysOutputData`; «Guardar imagen enviada» pide la respuesta completa
 *    sin error. No hay aviso de falla ni reintento: una copia para el control de calidad que no se pudo guardar se pierde en silencio, nunca rompe el turno.
 *    Los topes y la bandera `guardarMedios` los decide el SERVIDOR (409 `guardado_apagado`, 413, 415, 429): el flujo no reintenta nada.
 *  - SOLO UNA IMAGEN QUE META ACEPTÓ: «Preparar guardado (saliente)» omite un texto, un botón, una lista, un interactivo con imagen de encabezado y un envío
 *    que falló (sin el wamid de Meta). El servidor lo exige otra vez (tipo `image`).
 *  - LA CREDENCIAL DE ENVÍO que el flujo YA usa (la de «Enviar a WhatsApp», o la del nodo `envio` que se indique), SOLO hacia Meta; el enlace del QR se baja
 *    SIN credencial (el token de Meta nunca sale hacia otro anfitrión); la de ingesta SOLO hacia `guardarMedio` (la trampa del 15/09).
 *  - NINGÚN NODO CODE LEE EL BINARIO. El mime sale del `mimeType` del binario que armó el nodo HTTP (metadato, no contenido), y solo viaja si es jpeg, png o webp.
 *  - NO TOCA cobros, pedidos ni conteo: un QR guardado es lo que se ENVIÓ, nunca prueba de pago (CLAUDE.md, prohibición 3).
 *
 * `opciones` de `injertarGuardadoSaliente`:
 *   guardarUrl  https://…/guardarMedio  (obligatoria)
 *   vias        ['enlace'], ['media'] o ['enlace', 'media'] (obligatoria): por cuáles vías envía imágenes ESTE flujo
 *   fuentes     { meta, payload, tipoReporte, telefono, version? }: expresiones JavaScript de la cabecera de «Preparar guardado (saliente)» para el ítem `i`
 *               (con nombres de nodo LITERALES: `$('Armar mensajes').itemMatching(i).json.payload`)
 *   reportero   nodo del que cuelga (por defecto «Reportar mensaje (saliente)»)
 *   envio       nodo de envío cuya credencial de Meta se reutiliza (por defecto «Enviar a WhatsApp»)
 * Devuelve el mismo flujo, con los nodos y sus conexiones agregados. Lanza si falta algo: una rama a medias no se arma.
 */
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODOS_DEL_GUARDADO_SALIENTE, numeroDelAncla } from './guardado.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

export const REPORTERO_DEL_GUARDADO_SALIENTE = 'Reportar mensaje (saliente)';
export const FUENTE_PREPARAR_SALIENTE = readFileSync(join(AQUI, '../medios/guardado-saliente-preparar.js'), 'utf8').trimEnd();
/** El tope de una imagen que el flujo baja (el mismo del servidor: 5 MiB por tipo `image`); lo que Meta informa por encima no se baja. */
export const LIMITE_DE_IMAGEN_SALIENTE = 5 * 1024 * 1024;
/** Los nodos de la rama que hablan con `guardarMedio` (credencial de ingesta, no de Meta). */
export const NODOS_DE_INGESTA_DEL_GUARDADO_SALIENTE = ['Guardar imagen enviada'];
/** Las vías admitidas. */
export const VIAS_DEL_GUARDADO_SALIENTE = ['enlace', 'media'];
/** Lo que una fuente puede decir: lo que lee n8n de un ítem, nada más (la cabecera es código del repositorio, no un dato del cliente). */
const GLOBALES_PROHIBIDOS = /\b(require|process|Buffer|URL|crypto|fetch|eval|Function|constructor|prototype|__proto__|globalThis|import)\b/;
const CAMPOS_DE_LA_FUENTE = ['meta', 'payload', 'tipoReporte', 'telefono'];
const MIMES = ['image/jpeg', 'image/png', 'image/webp'];

const SIN_CORTAR = { onError: 'continueRegularOutput', alwaysOutputData: true };
const OPERADOR_BOOLEANO = { type: 'boolean', operation: 'true', singleValue: true };
const condicion = (izquierda) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: 'c1', leftValue: izquierda, rightValue: true, operator: OPERADOR_BOOLEANO }],
    combinator: 'and',
  },
  options: {},
});
const enlace = (a, indice = 0) => ({ node: a, type: 'main', index: indice });

/**
 * Las fuentes de la forma común (la cadena de envío de `envio.mjs` y las de Rubén, Antonio, Walisuma, Casa Bermejo y Venta mínima): el ítem que arma los mensajes
 * trae `payload`, `tipoReporte`, `para` y `waGraphVersion`; la respuesta de Meta es la de la IMAGEN (`envio`), no la del respaldo en texto: si cayó el respaldo, el
 * cliente no recibió la imagen y NO se guarda como enviada.
 */
export const fuentesDeLaCadenaComun = (armar = 'Armar mensajes', envio = 'Enviar a WhatsApp') => ({
  meta: `$('${envio}').itemMatching(i).json`,
  payload: `$('${armar}').itemMatching(i).json.payload`,
  tipoReporte: `$('${armar}').itemMatching(i).json.tipoReporte`,
  telefono: `$('${armar}').itemMatching(i).json.para`,
  version: `$('${armar}').itemMatching(i).json.waGraphVersion`,
});

/** Valida las vías y las devuelve ordenadas y sin repetir. */
export function validarVias(vias) {
  if (!Array.isArray(vias) || vias.length < 1) throw new Error('guardado saliente: faltan las vías (enlace, media o las dos)');
  for (const v of vias) if (!VIAS_DEL_GUARDADO_SALIENTE.includes(v)) throw new Error(`guardado saliente: vía desconocida: ${String(v).slice(0, 20)} (enlace o media)`);
  return VIAS_DEL_GUARDADO_SALIENTE.filter((v) => vias.includes(v));
}

/** La cabecera de «Preparar guardado (saliente)»: las vías y la fuente de ESTE flujo, con nombres de nodo literales. */
export function cabeceraDeFuentesSaliente(vias, fuentes) {
  const v = validarVias(vias);
  const f = fuentes && typeof fuentes === 'object' ? fuentes : {};
  const lineas = [];
  for (const c of [...CAMPOS_DE_LA_FUENTE, 'version']) {
    const e = f[c];
    if (e === undefined && c === 'version') continue;
    if (typeof e !== 'string' || !e.trim()) throw new Error(`guardado saliente: la fuente «${c}» tiene que ser una expresión JavaScript`);
    if (/[\r\n]/.test(e) || e.length > 600) throw new Error(`guardado saliente: la fuente «${c}» no puede tener saltos de línea ni pasar de 600 caracteres`);
    if (GLOBALES_PROHIBIDOS.test(e)) throw new Error(`guardado saliente: la fuente «${c}» usa un global que el Code de n8n no tiene o que no se permite`);
    try { compileFunction(`return (${e});`, ['$', 'i']); } catch (x) { throw new Error(`guardado saliente: la fuente «${c}» no compila: ${String(x && x.message).slice(0, 80)}`); }
    lineas.push(`  ${c}: ${e},`);
  }
  return [
    '// FUENTES DEL GUARDADO SALIENTE: las arma Flujos/src/core/sin-agente/guardado-saliente.mjs para este flujo (nombres de nodo literales, para que n8n los precargue).',
    `const GS_VIAS = ${JSON.stringify(v)};`,
    'const GS_FUENTE = (i) => ({',
    ...lineas,
    '});',
  ].join('\n');
}

/** El Content-Type (y `X-NovuChat-Mime`) del POST: el mime del binario que armó el nodo HTTP, solo si es de la lista cerrada; si no, octet-stream (el servidor da 415). */
export const MIME_DEL_BINARIO = `={{ (() => { const ok = ${JSON.stringify(MIMES).replace(/"/g, "'")}; const b = String((($binary || {}).data || {}).mimeType || '').toLowerCase().split(';')[0].trim(); return ok.indexOf(b) >= 0 ? b : 'application/octet-stream'; })() }}`;
/** La URL que baja la imagen de Meta: solo del CDN de Meta y solo si Meta informó un tamaño dentro del tope (o no lo informó: lo acota el servidor). */
export const URL_DESCARGA_SALIENTE = `={{ (String($json.url || '').startsWith('https://lookaside.fbsbx.com/') && !(Number($json.file_size) > ${LIMITE_DE_IMAGEN_SALIENTE})) ? $json.url : '' }}`;
const P = "$('Preparar guardado (saliente)').item.json";

function autenticacionDeMeta(envio) {
  const tipos = Object.keys((envio && envio.credentials) || {});
  if (tipos.length !== 1 || !['httpHeaderAuth', 'whatsAppApi'].includes(tipos[0])) throw new Error(`guardado saliente: «${(envio || {}).name}» no lleva una sola credencial de WhatsApp`);
  const c = envio.credentials[tipos[0]];
  const parametros = tipos[0] === 'httpHeaderAuth'
    ? { authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth' }
    : { authentication: 'predefinedCredentialType', nodeCredentialType: 'whatsAppApi' };
  return { parametros, credentials: { [tipos[0]]: { id: String(c.id ?? ''), name: String(c.name ?? '') } } };
}

/** Los nodos de la rama para las vías dadas, sin conectar al flujo. `desde` es [x, y] del primero. */
export function nodosDelGuardadoSaliente(opciones) {
  const o = opciones || {};
  const vias = validarVias(o.vias);
  if (!/^https:\/\/[a-z0-9.-]+\/guardarMedio$/.test(String(o.guardarUrl || ''))) throw new Error('guardado saliente: guardarUrl tiene que ser https://<anfitrión>/guardarMedio');
  if (!o.numero) throw new Error('guardado saliente: falta la expresión del número del negocio (numero)');
  if (!o.ingesta || !o.meta) throw new Error('guardado saliente: faltan las credenciales (ingesta y meta)');
  const [x, y] = o.desde || [0, 0];
  const conEnlace = vias.includes('enlace');
  const conMedia = vias.includes('media');
  const nodos = [{
    id: 'gs-preparar', name: 'Preparar guardado (saliente)', type: 'n8n-nodes-base.code', typeVersion: 2, position: [x, y],
    parameters: { jsCode: `${cabeceraDeFuentesSaliente(vias, o.fuentes)}\n\n${FUENTE_PREPARAR_SALIENTE}\n` },
    notes: 'Rama del GUARDADO de la imagen que el asistente ENVIÓ (módulo común Flujos/src/core/medios/guardado-saliente-preparar.js). Corre después del reporte saliente y de todo envío al cliente; omite todo lo que no sea una imagen aceptada por Meta. No toca el binario ni hace llamadas.',
  }];
  if (conEnlace && conMedia) {
    nodos.push({
      id: 'gs-por-enlace', name: '¿Por enlace? (guardado saliente)', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [x + 240, y],
      parameters: condicion("={{ $json.via === 'enlace' }}"),
      notes: 'La imagen salió por enlace https (QR de cobro por imagenDeCobro): se baja el mismo enlace SIN credencial. Si salió por media id de Meta, va por Graph.',
    });
  }
  if (conEnlace) {
    nodos.push({
      id: 'gs-enlace', name: 'Descargar enlace (guardado saliente)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + (conMedia ? 480 : 240), y - 120],
      parameters: {
        method: 'GET', url: '={{ $json.enlace }}',
        options: { timeout: 10000, redirect: { redirect: { followRedirects: false } }, response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } },
      },
      ...SIN_CORTAR,
      notes: 'Baja el MISMO enlace que se le envió al cliente, SIN credencial (el token de Meta nunca va hacia otro anfitrión) y sin seguir redirecciones. Sin neverError: un 4xx o 5xx deja un ítem sin binario y la rama termina en silencio.',
    });
  }
  if (conMedia) {
    nodos.push({
      id: 'gs-pedir', name: 'Pedir imagen a Meta (guardado saliente)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + (conEnlace ? 480 : 240), y + 120],
      parameters: {
        method: 'GET', url: "=https://graph.facebook.com/{{ $json.waGraphVersion }}/{{ String($json.mediaId || '').replace(/[^A-Za-z0-9_-]/g, '') }}",
        ...o.meta.parametros, options: { timeout: 8000 },
      },
      credentials: o.meta.credentials, ...SIN_CORTAR,
      notes: 'GET /{media-id} con la MISMA credencial de envío del flujo: devuelve url, mime_type y file_size de la imagen que se envió (el media id dura 30 días; el servidor exige que el saliente tenga a lo más 30 minutos).',
    }, {
      id: 'gs-bajar', name: 'Descargar imagen de Meta (guardado saliente)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + (conEnlace ? 720 : 480), y + 120],
      parameters: {
        method: 'GET', url: URL_DESCARGA_SALIENTE, ...o.meta.parametros,
        options: { timeout: 15000, redirect: { redirect: { followRedirects: false } }, response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } },
      },
      credentials: o.meta.credentials, ...SIN_CORTAR,
      notes: 'Baja el archivo del CDN de Meta con la credencial de envío, sin seguir redirecciones, SOLO desde lookaside.fbsbx.com y si Meta no informó un tamaño por encima de 5 MiB. Si no, la URL queda vacía y no se baja nada.',
    });
  }
  nodos.push({
    id: 'gs-guardar', name: 'Guardar imagen enviada', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x + (conEnlace && conMedia ? 960 : 720), y],
    parameters: {
      method: 'POST', url: o.guardarUrl, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'X-NovuChat-Numero', value: `={{ ${o.numero} }}` },
        { name: 'X-NovuChat-Telefono', value: `={{ ${P}.telefono }}` },
        { name: 'X-NovuChat-IdMeta', value: `={{ ${P}.idMeta }}` },
        { name: 'X-NovuChat-Tipo', value: 'image' },
        { name: 'Content-Type', value: MIME_DEL_BINARIO },
        { name: 'X-NovuChat-Mime', value: MIME_DEL_BINARIO },
      ] },
      sendBody: true, contentType: 'binaryData', inputDataFieldName: 'data',
      options: { timeout: 15000, response: { response: { fullResponse: true, neverError: true } } },
    },
    credentials: { httpHeaderAuth: { id: '', name: o.ingesta } }, ...SIN_CORTAR,
    notes: 'POST guardarMedio con los BYTES de la imagen enviada y el wamid del saliente: solo el token de ingesta del número, nunca firma. El servidor decide (bandera guardarMedios, tope de tamaño y cupo, 30 minutos): si no la guarda, la rama termina en silencio. Sin reintentos, sin aviso: no suma ningún mensaje de WhatsApp.',
  });
  return nodos;
}

/** Las aristas internas de la rama, según las vías. */
export function aristasDelGuardadoSaliente(vias) {
  const v = validarVias(vias);
  const a = [];
  const E = 'Descargar enlace (guardado saliente)';
  const M = 'Pedir imagen a Meta (guardado saliente)';
  if (v.length === 2) {
    a.push(['Preparar guardado (saliente)', 0, '¿Por enlace? (guardado saliente)'], ['¿Por enlace? (guardado saliente)', 0, E], ['¿Por enlace? (guardado saliente)', 1, M]);
  } else a.push(['Preparar guardado (saliente)', 0, v[0] === 'enlace' ? E : M]);
  if (v.includes('enlace')) a.push([E, 0, 'Guardar imagen enviada']);
  if (v.includes('media')) a.push([M, 0, 'Descargar imagen de Meta (guardado saliente)'], ['Descargar imagen de Meta (guardado saliente)', 0, 'Guardar imagen enviada']);
  return a;
}

/** Cuántos nodos agrega la rama con estas vías. */
export const nodosQueAgrega = (vias) => (validarVias(vias).length === 2 ? 6 : validarVias(vias)[0] === 'enlace' ? 3 : 4);

/** Agrega la rama al flujo (lo modifica y lo devuelve). */
export function injertarGuardadoSaliente(flujo, opciones) {
  const o = opciones || {};
  const vias = validarVias(o.vias);
  const nombreReportero = o.reportero || REPORTERO_DEL_GUARDADO_SALIENTE;
  const nombreEnvio = o.envio || 'Enviar a WhatsApp';
  const reportero = (flujo.nodes || []).find((n) => n.name === nombreReportero);
  if (!reportero) throw new Error(`guardado saliente: el flujo no tiene «${nombreReportero}»`);
  const envio = (flujo.nodes || []).find((n) => n.name === nombreEnvio);
  if (!envio) throw new Error(`guardado saliente: el flujo no tiene «${nombreEnvio}» (de donde se toma la credencial de envío)`);
  for (const n of NODOS_DEL_GUARDADO_SALIENTE) if ((flujo.nodes || []).some((x) => x.name === n)) throw new Error(`guardado saliente: el flujo ya tiene «${n}»`);
  const ingesta = String((((reportero.credentials || {}).httpHeaderAuth) || {}).name || '');
  if (!ingesta) throw new Error(`guardado saliente: «${nombreReportero}» no lleva la credencial de ingesta (httpHeaderAuth) por nombre`);
  const meta = autenticacionDeMeta(envio);
  const credMeta = Object.values(meta.credentials)[0].name;
  if (credMeta === ingesta || /ingesta/i.test(credMeta)) throw new Error('guardado saliente: la credencial de Meta no puede ser la de ingesta (la trampa del 15/09)');
  // Debajo de TODO el flujo: con executionOrder v1 la rama corre después de las que responden.
  const yMax = Math.max(...flujo.nodes.map((n) => Number((n.position || [0, 0])[1]) || 0));
  const nodos = nodosDelGuardadoSaliente({
    ...o, vias, ingesta, meta, numero: o.numero || numeroDelAncla(reportero),
    desde: [Number(reportero.position[0]) + 240, yMax + 400],
  });
  flujo.nodes.push(...nodos);
  const con = flujo.connections || (flujo.connections = {});
  const salida = (con[nombreReportero] || (con[nombreReportero] = { main: [[]] })).main;
  if (!salida[0]) salida[0] = [];
  salida[0].push(enlace('Preparar guardado (saliente)'));
  for (const [de, s, a] of aristasDelGuardadoSaliente(vias)) {
    const m = (con[de] || (con[de] = { main: [] })).main;
    while (m.length <= s) m.push([]);
    m[s].push(enlace(a));
  }
  return flujo;
}

// ----------------------------------------------------------------- la guardia
const destinosDe = (flujo, de, salida) => ((((flujo.connections || {})[de] || {}).main || [])[salida] || []).map((x) => x.node);
const credDe = (n) => Object.entries((n && n.credentials) || {}).map(([tipo, c]) => ({ tipo, nombre: String((c || {}).name || '') }));

/**
 * Lo que le falta o le sobra a la rama del guardado saliente en un flujo armado. Vacío si está bien. Con `exigir` falla también si la rama no está.
 * `opciones`: { vias (las que se esperan), reportero, envio }.
 */
export function hallazgosDelGuardadoSaliente(flujo, opciones = {}) {
  const h = [];
  const nodos = Array.isArray(flujo && flujo.nodes) ? flujo.nodes : [];
  const por = (nombre) => nodos.find((n) => n.name === nombre);
  const hay = NODOS_DEL_GUARDADO_SALIENTE.filter((n) => por(n));
  if (!hay.length) { if (opciones.exigir) h.push('guardado saliente: falta la rama'); return h; }
  const reportero = opciones.reportero || REPORTERO_DEL_GUARDADO_SALIENTE;
  const envio = opciones.envio || 'Enviar a WhatsApp';
  const prep = por('Preparar guardado (saliente)');
  if (!prep) { h.push('guardado saliente: falta «Preparar guardado (saliente)»'); return h; }
  const m = /const GS_VIAS = (\[[^\]]*\]);/.exec(String((prep.parameters || {}).jsCode || ''));
  let vias = [];
  try { vias = validarVias(JSON.parse(m ? m[1] : 'null')); } catch (x) { h.push('guardado saliente: «Preparar guardado (saliente)» no declara sus vías (GS_VIAS)'); return h; }
  if (opciones.vias && JSON.stringify(validarVias(opciones.vias)) !== JSON.stringify(vias)) h.push(`guardado saliente: las vías son ${JSON.stringify(vias)} y se esperaban ${JSON.stringify(validarVias(opciones.vias))}`);
  const esperados = ['Preparar guardado (saliente)', 'Guardar imagen enviada', ...(vias.length === 2 ? ['¿Por enlace? (guardado saliente)'] : []),
    ...(vias.includes('enlace') ? ['Descargar enlace (guardado saliente)'] : []),
    ...(vias.includes('media') ? ['Pedir imagen a Meta (guardado saliente)', 'Descargar imagen de Meta (guardado saliente)'] : [])];
  for (const n of esperados) if (!por(n)) h.push(`guardado saliente: falta el nodo «${n}»`);
  for (const n of hay) if (!esperados.includes(n)) h.push(`guardado saliente: sobra «${n}» (el flujo solo tiene las vías ${JSON.stringify(vias)})`);
  if (h.length) return h;
  // Cuelga de «Reportar mensaje (saliente)» y va DEBAJO de todo el flujo (corre después de todo envío al cliente).
  const rep = por(reportero);
  if (!rep) { h.push(`guardado saliente: falta «${reportero}»`); return h; }
  if (!destinosDe(flujo, reportero, 0).includes('Preparar guardado (saliente)')) h.push(`guardado saliente: «Preparar guardado (saliente)» no cuelga de «${reportero}»`);
  if (!(Number(rep.position[1]) < Number(prep.position[1]))) h.push(`guardado saliente: «${reportero}» tiene que ir arriba de «Preparar guardado (saliente)»`);
  const resto = nodos.filter((n) => !NODOS_DEL_GUARDADO_SALIENTE.includes(n.name));
  const bajos = resto.filter((n) => Number((n.position || [0, 0])[1]) >= Number(prep.position[1]) && !/guardado|Guardar medio|medio \(guardado\)/i.test(n.name));
  if (bajos.length) h.push(`guardado saliente: «Preparar guardado (saliente)» tiene que ir DEBAJO de todo el flujo (hay ${bajos.map((n) => `«${n.name}»`).join(', ')} más abajo)`);
  for (const [de, s, a] of aristasDelGuardadoSaliente(vias)) if (!destinosDe(flujo, de, s).includes(a)) h.push(`guardado saliente: «${de}» (salida ${s}) no está conectado a «${a}»`);
  for (const n of esperados) {
    for (const d of [0, 1].flatMap((i) => destinosDe(flujo, n, i))) if (!esperados.includes(d)) h.push(`guardado saliente: «${n}» sigue hacia «${d}», fuera de la rama`);
  }
  // Ningún nodo de la rama manda un mensaje de WhatsApp ni cambia lo que se le envía al cliente: ninguno habla a /messages, y ninguno es un nodo de envío.
  for (const n of esperados) {
    const nodo = por(n);
    const texto = JSON.stringify(nodo.parameters || {});
    if (/\/messages\b/.test(texto)) h.push(`guardado saliente: «${n}» llama a /messages (la rama no manda ningún mensaje)`);
    if (nodo.retryOnFail === true) h.push(`guardado saliente: «${n}» no reintenta (el servidor decide; una rama sin tope no corre)`);
    if (/Signature/i.test(texto)) h.push(`guardado saliente: «${n}» manda una firma: guardarMedio va solo con el token`);
  }
  // El código común, tal cual; ningún Code lee el binario.
  if (!String((prep.parameters || {}).jsCode || '').includes(FUENTE_PREPARAR_SALIENTE)) h.push('guardado saliente: «Preparar guardado (saliente)» no incluye guardado-saliente-preparar.js tal cual');
  if (prep.type !== 'n8n-nodes-base.code') h.push('guardado saliente: «Preparar guardado (saliente)» tiene que ser un nodo Code');
  if (/getBinaryDataBuffer|getBinaryStream|\bBuffer\b|\batob\b|\bbtoa\b|base64|\.data\.data\b/.test(String((prep.parameters || {}).jsCode || '').replace(/^\s*\/\/.*$/gm, ''))) h.push('guardado saliente: «Preparar guardado (saliente)» lee el contenido del binario');
  for (const n of esperados.filter((x) => x !== 'Preparar guardado (saliente)' && x !== '¿Por enlace? (guardado saliente)')) {
    const nodo = por(n);
    if (nodo.type !== 'n8n-nodes-base.httpRequest') h.push(`guardado saliente: «${n}» tiene que ser un nodo HTTP`);
    if (nodo.onError !== 'continueRegularOutput' || nodo.alwaysOutputData !== true) h.push(`guardado saliente: «${n}» tiene que llevar onError continueRegularOutput y alwaysOutputData (la rama nunca corta el turno)`);
  }
  // Credenciales: Meta solo con la de envío del flujo; el enlace, SIN credencial; guardarMedio, solo con la de ingesta del reportero.
  const env = por(envio);
  const ingesta = String((((rep.credentials || {}).httpHeaderAuth) || {}).name || '');
  if (!ingesta) h.push(`guardado saliente: «${reportero}» no lleva la credencial de ingesta por nombre`);
  for (const n of ['Pedir imagen a Meta (guardado saliente)', 'Descargar imagen de Meta (guardado saliente)'].filter((x) => esperados.includes(x))) {
    const url = String((por(n).parameters || {}).url || '');
    if (n.startsWith('Pedir') ? !url.startsWith('=https://graph.facebook.com/') : url !== URL_DESCARGA_SALIENTE) h.push(`guardado saliente: «${n}» llama a otro anfitrión`);
    if (!env) { h.push(`guardado saliente: falta «${envio}» (la credencial de envío)`); continue; }
    if (JSON.stringify(por(n).credentials || {}) !== JSON.stringify(autenticacionDeMeta(env).credentials)) h.push(`guardado saliente: «${n}» tiene que llevar la MISMA credencial de Meta que «${envio}»`);
    const cs = credDe(por(n));
    if (cs.length === 1 && (cs[0].nombre === ingesta || /ingesta/i.test(cs[0].nombre))) h.push(`guardado saliente: «${n}» llama a Meta con la credencial de ingesta (la trampa del 15/09)`);
    const redir = ((((por(n).parameters || {}).options || {}).redirect || {}).redirect || {});
    if (n.startsWith('Descargar') && redir.followRedirects !== false) h.push(`guardado saliente: «${n}» no puede seguir redirecciones`);
  }
  if (esperados.includes('Descargar enlace (guardado saliente)')) {
    const d = por('Descargar enlace (guardado saliente)');
    if (credDe(d).length || (d.parameters || {}).authentication || (d.parameters || {}).genericAuthType || (d.parameters || {}).nodeCredentialType) h.push('guardado saliente: «Descargar enlace (guardado saliente)» no lleva credencial (el token de Meta nunca va hacia otro anfitrión)');
    if ((d.parameters || {}).url !== '={{ $json.enlace }}') h.push('guardado saliente: «Descargar enlace (guardado saliente)» baja solo el enlace que se envió');
    if (((((d.parameters || {}).options || {}).redirect || {}).redirect || {}).followRedirects !== false) h.push('guardado saliente: «Descargar enlace (guardado saliente)» no puede seguir redirecciones');
  }
  const g = por('Guardar imagen enviada');
  const cg = credDe(g);
  if (cg.length !== 1 || cg[0].tipo !== 'httpHeaderAuth' || !ingesta || cg[0].nombre !== ingesta) h.push(`guardado saliente: «Guardar imagen enviada» tiene que llevar SOLO la credencial de ingesta del flujo (la de «${reportero}»)`);
  const gp = g.parameters || {};
  if (!/^https:\/\/[a-z0-9.-]+\/guardarMedio$/.test(String(gp.url || ''))) h.push('guardado saliente: «Guardar imagen enviada» no llama a guardarMedio');
  else if (/^https:\/\/[a-z0-9.-]+\//.test(String((rep.parameters || {}).url || '')) && String(gp.url).split('/')[2] !== String(rep.parameters.url).split('/')[2]) h.push(`guardado saliente: «Guardar imagen enviada» llama a guardarMedio en otro anfitrión que «${reportero}» (el token de ingesta solo va a las Functions del propio reporte)`);
  if (gp.sendBody !== true || gp.contentType !== 'binaryData' || gp.inputDataFieldName !== 'data') h.push('guardado saliente: «Guardar imagen enviada» manda los bytes (binaryData, campo data)');
  const r = ((((gp.options || {}).response || {}).response) || {});
  if (r.fullResponse !== true || r.neverError !== true) h.push('guardado saliente: «Guardar imagen enviada» tiene que pedir la respuesta completa sin error (fullResponse, neverError)');
  const cab = ((gp.headerParameters || {}).parameters || []);
  const val = (n) => (cab.find((x) => x && String(x.name).toLowerCase() === n.toLowerCase()) || {}).value;
  if (val('X-NovuChat-Tipo') !== 'image') h.push('guardado saliente: «Guardar imagen enviada» manda siempre X-NovuChat-Tipo: image');
  if (val('Content-Type') !== MIME_DEL_BINARIO || val('X-NovuChat-Mime') !== MIME_DEL_BINARIO) h.push('guardado saliente: «Guardar imagen enviada» manda el mime del binario saneado (jpeg, png o webp)');
  if (val('X-NovuChat-Telefono') !== `={{ ${P}.telefono }}` || val('X-NovuChat-IdMeta') !== `={{ ${P}.idMeta }}`) h.push('guardado saliente: «Guardar imagen enviada» manda el teléfono y el wamid de «Preparar guardado (saliente)»');
  const repNumero = ((((rep.parameters || {}).headerParameters || {}).parameters) || []).find((x) => x && x.name === 'X-NovuChat-Numero');
  if (!repNumero || val('X-NovuChat-Numero') !== repNumero.value) h.push(`guardado saliente: «Guardar imagen enviada» manda el MISMO X-NovuChat-Numero que «${reportero}»`);
  return h;
}
