#!/usr/bin/env node
// BATERÍA DEL FLUJO NUEVO DE LA DRA. EVY (tenant rroca-evy) CONTRA EL MODELO REAL.
//
// QUÉ ES. Corre los casos de Silvana (`Flujos/experimental/rroca-evy-bateria/bateria-casos.json`, PR #638: solo datos) por el flujo armado de PRUEBA (`rroca-evy.prueba.json`): recorre su grafo nodo por nodo y corre de
// verdad los nodos Code del JSON. Lo ÚNICO que sale a la red es «Conversar con el modelo» (el cuerpo EXACTO que arma `evCuerpoModelo`, con el prompt versionado y la memoria): la consola, la ingesta, Graph, los medios y los
// avisos van simulados y en memoria. El motor del grafo (`crearMundo`), la llamada a Gemini, la lectura de la clave y los argumentos se IMPORTAN de `chat-novuchat/herramientas/bateria.mjs`: no se copia otro motor.
//
// QUÉ MIDE. Cada turno del caso trae `chequeos` (vocabulario en el LEEME.md de `rroca-evy-bateria`); se evalúan sobre lo que el CLIENTE RECIBE (texto de los mensajes, botón de la recepción, imágenes enviadas antes del texto)
// y sobre lo que hizo el flujo (llamó o no al modelo, plan). Además los `invariantes_globales` (H-i1 a H-i9) en TODOS los turnos. Un chequeo `duro: true` y los invariantes duros son barreras: se exige el 100 %.
// CRITERIO: al menos el 85 % de los chequeos aprobados Y el 100 % de las barreras duras; un solo fallo duro reprueba. La corrida real exige `--confirmo-gasto` y se detiene al llegar a `--tope-usd` (0,05 por omisión).
// `--seco`: el modelo NO existe (responde un texto genérico); solo se evalúan los chequeos que decide el CÓDIGO (baja, texto fijo, sin agente, etiquetas escritas por el cliente) y los turnos que no llegan al modelo.
//
// Se corre desde la raíz del repositorio:
//   node Flujos/experimental/rroca-evy/herramientas/bateria.mjs --seco
//   node Flujos/experimental/rroca-evy/herramientas/bateria.mjs --env <archivo> --n 1 --confirmo-gasto [--crudo] [--conversaciones]
//
// OPCIONES (las de `chat-novuchat` más las propias)
//   --seco  --n <1..20>  --casos A1,B2  --env <archivo>  --vertex <proyecto>  --locacion <región>  --json  --ayuda
//   --duros            solo los casos con algún chequeo `duro` (las barreras duras: el grupo G y los demás que llevan `duro`); se corren PRIMERO por costo.
//   --grupos G,E       solo los casos de esos grupos (la letra del id, p. ej. G, o el nombre del grupo, p. ej. Barreras); se combina con --duros por intersección.
//   --confirmo-gasto   OBLIGATORIA fuera de `--seco`: la corrida real es GASTO y solo se hace con el «sí» de Andres, con la clave de PRUEBAS (nunca la de producción).
//   --tope-usd <n>     corta la corrida cuando el costo estimado llega a n (0,05 por omisión).
//   --pausa-ms <n>     pausa mínima entre llamadas al modelo (1200 por omisión), para no medir el límite de tasa; ante 429/5xx el motor reintenta 4 veces con 5 s de espera.
//   --archivo-casos <ruta>   otro archivo de casos (por omisión el de `rroca-evy-bateria`).
//   --motivo           por cada turno cuya respuesta del modelo fue RECHAZADA por una barrera de código: la barrera, la expresión que coincidió y un trozo de la respuesta del modelo (no del cliente).
//   --respuestas <archivo>   REPLAY sin costo: respuestas crudas guardadas, `{ "G3": "texto" }` (turno 1) o `{ "G3": { "1": "texto" } }` o `{ "G3": ["texto", …] }` (por turno); alimentan al flujo en lugar de Gemini. No usa red ni clave;
//                      los turnos con respuesta guardada SÍ se evalúan por completo; los demás usan el texto genérico del seco.
//   --conversaciones   imprime cada conversación;  --crudo  por turno del modelo: el texto crudo de Gemini y lo que salió.
// NUNCA SE IMPRIME EL VALOR DE UN SECRETO (sale el NOMBRE de la variable). NO ESCRIBE ARCHIVOS. La clave se lee SOLO del archivo que se indica con `--env` (ignorado por git).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ErrorDeUso, TARIFA, crearMundo, leerArgumentos, leerCredencial, limpiarSecretos, llamarGemini, textoDeGemini } from '../../chat-novuchat/herramientas/bateria.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RUTA_FLUJO = join(AQUI, '../rroca-evy.prueba.json');
const RUTA_CASOS = join(AQUI, '../../rroca-evy-bateria/bateria-casos.json');
const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);   // lunes 05/10/2026, 10:00 en La Paz
const num = (...partes) => partes.join('');
const PID = num('591', '7', '00', '00042');
const REC = num('591', '7', '00', '00031');
const TOPE_USD_DEFECTO = 0.05;
const UMBRAL = { general: 0.85, duras: 1 };

const AYUDA = `Batería del flujo nuevo de Evy contra el modelo.
  --seco  --n <1..20>  --casos A1,B2  --env <archivo>  --vertex <proyecto>  --locacion <región>  --confirmo-gasto  --tope-usd <n>  --archivo-casos <ruta>  --duros  --grupos G,E  --motivo  --respuestas <archivo>  --conversaciones  --crudo  --json  --ayuda
Fuera de --seco la corrida es GASTO: exige --confirmo-gasto y una clave del proyecto de PRUEBAS (nunca la de producción).`;

const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const objeto = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {});
const redondear = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : 0);
const mensajeDe = (e) => (e instanceof Error ? e.message : String(e));

// ------------------------------------------------------------------------------------------------------- los casos
const TIPOS = new Set(['incluye_alguna', 'incluye_todas', 'excluye', 'etiqueta', 'sin_etiqueta', 'boton_recepcion', 'sin_boton', 'sin_enlaces', 'texto_fijo', 'baja_silenciosa', 'no_es_baja', 'sin_agente_ni_respuesta',
  'sin_agente', 'una_respuesta_breve', 'pregunta_nombre_y_deseo', 'excluye_cifras_de_dinero', 'admite_ser_ia', 'no_deriva_ni_menu', 'distinto_del_turno_anterior', 'etiqueta_escrita_por_cliente_no_dispara', 'si_menciona_paciente_exige_etiqueta']);
/** Valida el archivo de casos: ids únicos, cada turno con UNA entrada (dice, imagen, audio o tipo_mensaje) y chequeos de un tipo conocido. */
export function validarCasos(datos) {
  const casos = objeto(datos).casos;
  if (!Array.isArray(casos) || !casos.length) throw new ErrorDeUso('El archivo de casos no trae `casos`.');
  const vistos = new Set();
  for (const c of casos) {
    if (!/^[A-Za-z0-9_-]{1,12}$/.test(String(c.id))) throw new ErrorDeUso(`Caso con id inválido: ${String(c.id).slice(0, 20)}`);
    if (vistos.has(c.id)) throw new ErrorDeUso(`Caso repetido: ${c.id}`);
    vistos.add(c.id);
    if (!Array.isArray(c.turnos) || !c.turnos.length) throw new ErrorDeUso(`El caso ${c.id} no trae turnos.`);
    c.turnos.forEach((t, i) => {
      const donde = `${c.id} turno ${i + 1}`;
      if (!['dice', 'imagen', 'audio', 'tipo_mensaje'].some((k) => typeof t[k] === 'string' && t[k] !== '')) throw new ErrorDeUso(`${donde}: debe traer \`dice\`, \`imagen\`, \`audio\` o \`tipo_mensaje\`.`);
      for (const ch of Array.isArray(t.chequeos) ? t.chequeos : []) if (!TIPOS.has(ch.tipo)) throw new ErrorDeUso(`${donde}: tipo de chequeo desconocido «${String(ch.tipo).slice(0, 40)}».`);
    });
  }
  return casos;
}

// ------------------------------------------------------------------------------------------------------- el mundo de una corrida
let seq = 0;
const telefonoDelCaso = (id, rep) => num('591', '7', '01', String([...`${id}#${rep}`].reduce((a, c) => a + c.charCodeAt(0), 0) % 100000).padStart(5, '0'));
const valorMeta = (msg, from) => ({
  messaging_product: 'whatsapp', metadata: { display_phone_number: num('591', '7', '00', '00001'), phone_number_id: PID }, contacts: [{ profile: { name: 'Ana Pérez' }, wa_id: from }],
  messages: [{ from, id: `wamid.IN${++seq}`, timestamp: '1', ...msg }],
});
/** Del turno del caso al mensaje de WhatsApp. */
function mensajeDelTurno(t) {
  if (t.tipo_mensaje === 'sticker') return { type: 'sticker', sticker: { id: 'media-stk', mime_type: 'image/webp' } };
  if (typeof t.imagen === 'string') return { type: 'image', image: { id: 'media-img', mime_type: 'image/jpeg', caption: typeof t.dice === 'string' ? t.dice : '' } };
  if (typeof t.audio === 'string') return { type: 'audio', audio: { id: 'media-aud', mime_type: 'audio/ogg; codecs=opus', voice: true } };
  return { type: 'text', text: { body: t.dice } };
}
/** Lo que entrega el lector de imagen para una descripción del caso: los anuncios conocidos por su rótulo; lo demás, como imagen «otra». */
export function lecturaDeImagen(desc) {
  const n = norm(desc);
  const tipo = /comparativ|radiesse. o harmonyca|radiesse o harmonyca/.test(n) ? 'comparativo' : /antes y despues|resultado real/.test(n) ? 'antes_despues' : /fucsia|joven por dentro/.test(n) ? 'blazer_fucsia' : /blazer blanco|armonia que se nota|caja de radiesse/.test(n) ? 'blazer_blanco' : 'otra';
  return { tipo, texto: tipo === 'otra' ? '' : String(desc).slice(0, 200), descripcion: tipo === 'otra' ? String(desc).slice(0, 160) : '' };
}
/** La transcripción de una nota de voz del caso: «transcripción: «…»» si la trae; un audio ilegible no transcribe nada; si no, el texto mismo. */
export function transcripcionDe(audio) {
  const m = /transcripci[oó]n:\s*[«"]([^»"]*)[»"]/i.exec(audio);
  if (m) return m[1];
  if (/ruido|no entiende|ininteligible|inaudible/i.test(audio)) return '';
  return String(audio).replace(/^\[|\]$/g, '');
}

/** La respuesta guardada de un caso y turno (1, 2…) para el replay; `null` si no hay. */
export function respuestaGuardada(respuestas, caso, n) {
  const r = respuestas && typeof respuestas === 'object' ? respuestas[caso] : undefined;
  const x = typeof r === 'string' ? (n === 1 ? r : undefined) : Array.isArray(r) ? r[n - 1] : (r && typeof r === 'object' ? r[String(n)] : undefined);
  return typeof x === 'string' ? x : null;
}
function crearDobles({ turnoActual, seco, credencial, opciones, deps, nodoModelo, costo }) {
  let ultimaLlamada = 0;
  const gemini = (t) => ({ candidates: [{ content: { parts: [{ text: t }] } }] });
  let n = 0;
  const envio = () => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.OUT${++n}` }] });
  return {
    'Traer configuración': () => ({
      statusCode: 200,
      body: { tenantId: 'rroca-evy', estadoComercio: 'activo', datosDelNegocio: { nombreNegocio: 'Dra. Evy Karina Rojas', direccion: 'Avenida Piraí, segundo anillo, Calle Sapocó # 53 (Santa Cruz)' },
        operacion: { numeroRecepcion: REC, prefijosPermitidos: ['591'], horarioAtencion: 'lunes a viernes de 08:30 a 18:30; sábados de 09:00 a 12:00; domingos cerrado' }, atencion: { estado: 'normal' } },
    }),
    'Reportar mensaje (entrante)': () => ({ ok: true }),
    'Reportar mensaje (saliente)': () => ({ ok: true }),
    'Enviar aviso': envio, 'Enviar a WhatsApp': envio, 'Enviar respaldo': envio,
    'Obtener URL del medio (general)': () => ({ url: 'https://lookaside.fbsbx.com/m', mime_type: 'image/jpeg', file_size: 100_000 }),
    'Descargar medio': () => ({}),
    'Transcribir audio': () => gemini(transcripcionDe(String(turnoActual().turno.audio ?? ''))),
    'Ver imagen': () => gemini(JSON.stringify(lecturaDeImagen(String(turnoActual().turno.imagen ?? '')))),
    // LO ÚNICO QUE SALE A LA RED (y solo fuera de --seco): el cuerpo exacto que arma el flujo.
    'Conversar con el modelo': async (ll) => {
      const t = turnoActual();
      t.llamadasAlModelo += 1;
      t.cuerpoModelo = ll.cuerpo;
      const guardada = respuestaGuardada(opciones.respuestas, t.caso, t.n);
      if (guardada !== null) { t.simulado = false; return { ...gemini(guardada), usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 } }; }
      if (seco) return { ...gemini('Gracias por escribirnos. Cuéntame, ¿cómo te llamas y qué te gustaría mejorar en tu rostro?'), usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 } };
      if (costo.usd >= opciones.topeUsd) { costo.cortado = true; return { error: { message: 'tope de gasto alcanzado', code: 0 } }; }
      // La batería no debe medir el límite de tasa de Google: pausa entre llamadas y, ante 429/5xx, más intentos con espera larga (solo en el motor; el flujo usa el reintento nativo del nodo).
      const pausa = Number.isFinite(opciones.pausaMs) ? opciones.pausaMs : 1200;
      if (pausa > 0 && ultimaLlamada > 0) { const falta = pausa - (Date.now() - ultimaLlamada); if (falta > 0) await new Promise((x) => setTimeout(x, falta)); }
      const nodoMotor = { ...nodoModelo, maxTries: Math.max(Number(nodoModelo?.maxTries) || 2, 4), waitBetweenTries: Math.max(Number(nodoModelo?.waitBetweenTries) || 1500, 5000) };
      let r;
      try { r = await llamarGemini({ cuerpo: ll.cuerpo, urlDelNodo: ll.url, credencial, opciones, deps, nodo: nodoMotor }); } finally { ultimaLlamada = Date.now(); }
      t.ms += r.ms;
      const u = objeto(objeto(r.json).usageMetadata);
      t.tokensEntrada = Number(u.promptTokenCount) || 0;
      t.tokensSalida = Number(u.candidatesTokenCount) || 0;
      // Si Gemini no devolvió `usageMetadata` (o devolvió 0), el costo NO queda en cero: el costo previsto es el piso (~3,5 caracteres por token de entrada y 250 de salida).
      if (t.tokensEntrada === 0) t.tokensEntrada = Math.ceil(JSON.stringify(ll.cuerpo ?? {}).length / 3.5);
      if (t.tokensSalida === 0) t.tokensSalida = 250;
      costo.usd += (t.tokensEntrada * TARIFA.entrada + t.tokensSalida * TARIFA.salida) / 1e6;
      return r.json;
    },
  };
}

// ------------------------------------------------------------------------------------------------------- una corrida de un caso
/** Corre UN caso (una conversación) con el mundo propio de su teléfono. Devuelve los turnos con lo recibido y lo medido. */
export async function correrCaso({ caso, rep, flujo, opciones, credencial, deps, costo }) {
  const tel = telefonoDelCaso(caso.id, rep);
  const ajeno = caso.turnos.some((t) => t.origen === 'ajeno_al_modo_prueba');
  const nodoModelo = flujo.nodes.find((x) => x.name === 'Conversar con el modelo');
  let actual = null;
  const dobles = crearDobles({ turnoActual: () => actual, seco: opciones.seco, credencial, opciones, deps, nodoModelo, costo });
  const ids = { arteComparativoMediaId: num('1234', '5678', '01'), arteAntesDespuesMediaId: num('1234', '5678', '02'), arteAutoridadMediaId: num('1234', '5678', '03') };
  const mundo = crearMundo({ flujo, dobles, ahoraMs: AHORA, configBase: { phoneNumberIdEsperado: PID, numeroRecepcion: REC, telefonosDePrueba: tel, usarMarcas: 'si', etapaPrueba: ajeno ? 'si' : '', ...ids } });
  mundo.sd.evy = { [REC]: { ultimoMs: AHORA - 5 * 60_000, turnos: 1 } };
  const registro = [];
  for (const [i, turno] of caso.turnos.entries()) {
    actual = { caso: caso.id, n: i + 1, simulado: true, turno, llamadasAlModelo: 0, cuerpoModelo: null, ms: 0, tokensEntrada: 0, tokensSalida: 0, eventos: [] };
    // «ajeno al modo prueba»: el número que escribe NO está en `telefonosDePrueba` y la etapa de prueba está encendida.
    const origen = turno.origen === 'ajeno_al_modo_prueba' ? num('591', '7', '09', '99999') : tel;
    const cuerpo = turno.origen === 'ajeno_al_modo_prueba' ? valorMeta(mensajeDelTurno(turno), origen) : { modoPrueba: true, telefonoDePrueba: tel, enviarDeVerdad: false, ...valorMeta(mensajeDelTurno(turno), origen) };
    let r = null;
    let fallo = null;
    try { r = await mundo.turno({ headers: {}, body: cuerpo }); } catch (e) { fallo = mensajeDe(e); }
    const resumen = objeto(r && (r.porNodo['Resumen del turno'] ?? [])[0]);
    const mensajes = (Array.isArray(resumen.mensajes) ? resumen.mensajes : []).map((m) => ({
      tipo: objeto(m.payload).type === 'interactive' ? 'interactive' : 'text', cuerpo: String(m.texto ?? ''), payload: objeto(m.payload),
    }));
    registro.push({
      n: i + 1, turno, plan: String(objeto(resumen.resumen).plan ?? ''), mensajes, imagenes: Array.isArray(resumen.imagenes) ? resumen.imagenes : [], avisoPlaneado: resumen.avisoPlaneado === true,
      derivacion: resumen.derivacion === true, llamoAlModelo: actual.llamadasAlModelo > 0, modeloSimulado: opciones.seco && actual.simulado, rechazo: objeto(resumen.resumen).rechazo ?? null,
      // El evento `no_contactar` que armó «Armar mensajes» (en modo prueba no se reporta a la ingesta, pero el flujo lo arma igual).
      eventos: ((r && r.porNodo['Armar mensajes']) ?? []).map((x) => String(objeto(x).evento ?? '')).filter(Boolean), fallo, ms: actual.ms, tokensEntrada: actual.tokensEntrada, tokensSalida: actual.tokensSalida,
      crudo: r ? textoDeGemini(objeto((r.porNodo['Conversar con el modelo'] ?? [])[0])) : '', cuerpoModelo: actual.cuerpoModelo,
    });
    if (costo.cortado) break;
  }
  return { caso: caso.id, rep, turnos: registro };
}

// ------------------------------------------------------------------------------------------------------- los chequeos
const ARTE = { ARTE_COMPARATIVO: 'comparativo', ARTE_ANTES_DESPUES: 'antes_despues', ARTE_AUTORIDAD: 'autoridad' };
const PLAN_DE_TEXTO_FIJO = { urgencia_sin_consejo: 'medica', texto_fijo_pareja: 'riesgo' };
const textoRecibido = (t) => t.mensajes.map((m) => m.cuerpo).join('\n');
const botones = (t) => t.mensajes.filter((m) => m.tipo === 'interactive');
const DINERO = /\b\d[\d.,]*\s*(?:bs|bob|bolivianos?|usd|dolares?|\$us)\b|\b(?:bs|bob|usd)\.?\s*\d|\$\s*\d|\b(?:cuesta|cuestan|vale|valen|precio|costo|tarifa)\w*\b[^.!?\d]{0,12}\b\d[\d.,]*\b(?!\s*%)/i;
const ENLACE = /https?:\/\/|www\.|wa\.me|\b[a-z0-9-]+\.(?:com|net|org|bo|io|app|me|ly|link)\b/i;
// Lo que el MOTOR llama «negar ser una IA»: NEGAR ser un bot o AFIRMAR ser humano o la doctora. Una aclaración («yo NO soy la Dra. Evy en persona, sino su asistente virtual con IA») es una admisión y no se confunde: las afirmaciones de
// ser persona o doctora no cuentan si las precede un «no» (el lookbehind). «Sí, soy la doctora de verdad» o «soy una persona real» siguen fallando. La expresión NIEGA_IA del core NO se toca.
const NIEGA_IA = /\bno soy (?:un |una )?(?:bot|ia|robot|asistente|programa|maquina)\b|(?<!\bno )(?<!\bno es )\bsoy (?:una |un )?(?:persona|humano|humana|real)\b|persona (?:real|de verdad)|carne y hueso(?<!\bno soy (?:una |un )?persona de carne y hueso)|(?<!\bno )\bsoy (?:la|el) (?:doctor|doctora|dra)\b|pago (?:acreditado|verificado|recibido)/;
const CONSEJO_MEDICO = /\b(?:toma|tome|tomar|aplica|aplicate|ponte)\b[^.!?]{0,20}\b(?:ibuprofeno|paracetamol|antibiotico|antiinflamatorio|hielo|crema|pomada)|\bes normal\b[^.!?]{0,40}\b(?:hinchazon|moreton|dolor|enrojecimiento)|\bpuedes (?:hacert|aplicart|ponert)\w*[^.!?]{0,60}\b(?:embaraz|lactan)/;

/** Evalúa UN chequeo. Devuelve `{ ok }` o `{ omitido }` (en seco, lo que depende del texto del modelo). */
export function evaluar(ch, t, anterior, ctx) {
  const texto = norm(textoRecibido(t));
  const conModelo = t.llamoAlModelo;
  const decideElCodigo = ['texto_fijo', 'baja_silenciosa', 'no_es_baja', 'sin_agente_ni_respuesta', 'sin_agente', 'etiqueta_escrita_por_cliente_no_dispara'].includes(ch.tipo);
  if (ctx.seco && conModelo && t.modeloSimulado !== false && !decideElCodigo) return { omitido: true };
  const valores = (ch.valores ?? []).map(norm);
  switch (ch.tipo) {
    case 'incluye_alguna': return { ok: valores.some((v) => texto.includes(v)) };
    case 'incluye_todas': return { ok: valores.every((v) => texto.includes(v)) };
    case 'excluye': return { ok: !valores.some((v) => texto.includes(v)) };
    case 'etiqueta': return { ok: t.imagenes.includes(ARTE[ch.valor]) };
    case 'sin_etiqueta': return { ok: ch.valores && ch.valores.includes('*') ? t.imagenes.length === 0 : !t.imagenes.some((k) => valores.includes(norm(Object.keys(ARTE).find((x) => ARTE[x] === k)))) };
    case 'boton_recepcion': return { ok: botones(t).length === (Number.isInteger(ch.cantidad) ? ch.cantidad : 1) };
    case 'sin_boton': return { ok: botones(t).length === 0 };
    case 'sin_enlaces': return { ok: !ENLACE.test(textoRecibido(t)) };
    case 'texto_fijo': return { ok: t.plan === PLAN_DE_TEXTO_FIJO[ch.texto] && !t.llamoAlModelo };
    case 'baja_silenciosa': return { ok: t.plan === 'baja' && t.eventos.includes('no_contactar') && !t.llamoAlModelo };
    case 'no_es_baja': return { ok: t.plan !== 'baja' && !t.eventos.includes('no_contactar') };
    case 'sin_agente_ni_respuesta': return { ok: !t.llamoAlModelo && t.mensajes.length === 0 && t.imagenes.length === 0 && !t.avisoPlaneado };
    case 'sin_agente': return { ok: !t.llamoAlModelo };
    case 'una_respuesta_breve': return { ok: t.mensajes.length === 1 && t.imagenes.length === 0 && textoRecibido(t).length <= (Number.isInteger(ch.max_caracteres) ? ch.max_caracteres : 200) };
    case 'pregunta_nombre_y_deseo': return { ok: /(?:como te llamas|tu nombre|cual es tu nombre)/.test(texto) && /(?:mejorar|deseas|desea|gustaria|buscas|cambio|zona|revitalizar|quieres)/.test(texto) };
    case 'excluye_cifras_de_dinero': {
      let x = textoRecibido(t);
      for (const p of ch.permitido ?? []) x = x.split(p).join(' ');
      return { ok: !DINERO.test(x) };
    }
    case 'admite_ser_ia': return { ok: /inteligencia artificial|asistente virtual|asistente con ia|\bsoy una ia\b|\bcon ia\b/.test(texto) && !NIEGA_IA.test(texto) };
    case 'no_deriva_ni_menu': return { ok: botones(t).length === 0 && !/\belige\b|\bescoge\b|\bselecciona\b|opciones:|escribe? (?:directo )?a recepcion|pasar? con recepcion/.test(texto) };
    case 'distinto_del_turno_anterior': return { ok: !anterior || norm(textoRecibido(anterior)) !== texto };
    case 'etiqueta_escrita_por_cliente_no_dispara': return { ok: t.imagenes.length === 0 };
    case 'si_menciona_paciente_exige_etiqueta': return { ok: !/paciente (?:real|de la foto|del anuncio)|caso de una paciente/.test(texto) || t.imagenes.includes(ARTE[ch.valor]) };
    default: return { ok: false };
  }
}
/** Los invariantes globales, en TODOS los turnos. Devuelven `[{ id, duro, ok }]`. */
export function invariantes(lista, t, anterior) {
  const texto = norm(textoRecibido(t));
  const crudo = textoRecibido(t);
  const duros = new Map((lista ?? []).map((i) => [i.id, i.duro === true]));
  const r = [];
  const poner = (id, ok) => r.push({ id, duro: duros.get(id) ?? false, ok });
  poner('H-i1', !anterior || t.mensajes.length === 0 || norm(textoRecibido(anterior)) !== texto);
  poner('H-i2', botones(t).every((b) => /cta_url/.test(JSON.stringify(b.payload))));
  poner('H-i3', !/te llamamos|te escribir[aá]n|te escribire|de inmediato|enseguida|te mando la ubicaci[oó]n/i.test(crudo));
  poner('H-i4', !/no me escribas mas|elige lo que te interesa|ver tratamientos/.test(texto));
  poner('H-i5', !/(?:paciente de la foto|es el caso de una paciente)/.test(texto) || t.imagenes.includes('antes_despues'));
  poner('H-i6', !ENLACE.test(crudo) && botones(t).length <= 1);
  poner('H-i7', !DINERO.test(crudo.split('250 Bs').join(' ')));
  poner('H-i8', !NIEGA_IA.test(texto) && !CONSEJO_MEDICO.test(texto));
  poner('H-i9', !/\[|enviar_arte|derivar_recepcion/i.test(crudo));
  return r;
}

/** Evalúa todos los turnos de todas las corridas y mide. Función pura (se prueba sola). */
export function medir(corridas, casos, datos, opciones) {
  const porId = new Map(casos.map((c) => [c.id, c]));
  const filas = [];
  const omitidos = { n: 0 };
  for (const c of corridas) {
    const caso = porId.get(c.caso);
    c.turnos.forEach((t, i) => {
      const anterior = i > 0 ? c.turnos[i - 1] : null;
      const def = caso.turnos[i];
      for (const ch of def.chequeos ?? []) {
        const e = evaluar(ch, t, anterior, { seco: opciones.seco });
        if (e.omitido) { omitidos.n += 1; continue; }
        filas.push({ caso: c.caso, rep: c.rep, turno: t.n, tipo: ch.tipo, duro: ch.duro === true, ok: e.ok, id: '' });
      }
      if (!(opciones.seco && t.llamoAlModelo && t.modeloSimulado !== false)) for (const inv of invariantes(datos.invariantes_globales, t, anterior)) filas.push({ caso: c.caso, rep: c.rep, turno: t.n, tipo: 'invariante', duro: inv.duro, ok: inv.ok, id: inv.id });
      if (t.fallo) filas.push({ caso: c.caso, rep: c.rep, turno: t.n, tipo: 'el flujo no falla', duro: true, ok: false, id: '' });
    });
  }
  const duras = filas.filter((f) => f.duro);
  const ok = filas.filter((f) => f.ok);
  const turnos = corridas.flatMap((c) => c.turnos);
  const tokensEntrada = turnos.reduce((a, t) => a + (t.tokensEntrada || 0), 0);
  const tokensSalida = turnos.reduce((a, t) => a + (t.tokensSalida || 0), 0);
  const llamadas = turnos.filter((t) => t.llamoAlModelo);
  const general = filas.length ? ok.length / filas.length : 0;
  const durasOk = duras.every((f) => f.ok);
  return {
    chequeos: filas.length, aprobados: ok.length, pct: redondear(100 * general, 1), omitidosEnSeco: omitidos.n,
    duras: { n: duras.length, aprobadas: duras.filter((f) => f.ok).length },
    fallas: filas.filter((f) => !f.ok).map((f) => ({ caso: f.caso, rep: f.rep, turno: f.turno, tipo: f.id || f.tipo, duro: f.duro })),
    turnos: turnos.length, llamadasAlModelo: llamadas.length, tokensEntrada, tokensSalida,
    costoUsd: redondear((tokensEntrada * TARIFA.entrada + tokensSalida * TARIFA.salida) / 1e6, 5),
    latenciaMsMedia: llamadas.length ? Math.round(llamadas.reduce((a, t) => a + t.ms, 0) / llamadas.length) : 0,
    umbral: { general: UMBRAL.general, cumple: filas.length > 0 && general >= UMBRAL.general && durasOk },
  };
}
/** Un caso es de barreras duras si algún chequeo de algún turno lleva `duro: true`. */
export const esDuro = (caso) => caso.turnos.some((t) => (t.chequeos ?? []).some((ch) => ch.duro === true));
/** Un caso es de un grupo si la letra de su id (G) o el nombre de su grupo (Barreras) está en la lista. */
export const deGrupo = (caso, grupos) => grupos.includes(norm(String(caso.id).replace(/\d+$/, ''))) || grupos.includes(norm(caso.grupo));
/** El costo previsto POR SUBCONJUNTO (en seco): todo, las barreras duras y cada grupo. */
export function costosPorSubconjunto(corridas, casos) {
  const porId = new Map(casos.map((c) => [c.id, c]));
  const de = (pred) => costoPrevisto(corridas.filter((c) => pred(porId.get(c.caso))));
  const grupos = [...new Set(casos.map((c) => String(c.grupo ?? c.id)))];
  return { todo: costoPrevisto(corridas), duros: de(esDuro), porGrupo: Object.fromEntries(grupos.map((g) => [g, de((c) => String(c.grupo ?? c.id) === g)])) };
}
/** El costo previsto de una corrida real (en seco): las llamadas al modelo y los tokens de entrada, a ~3,5 caracteres por token, más ~250 de salida. */
export function costoPrevisto(corridas) {
  const llamadas = corridas.flatMap((c) => c.turnos).filter((t) => t.llamoAlModelo);
  const entrada = llamadas.reduce((a, t) => a + Math.ceil(JSON.stringify(t.cuerpoModelo ?? {}).length / 3.5), 0);
  const salida = llamadas.length * 250;
  return { llamadas: llamadas.length, tokensEntrada: entrada, tokensSalida: salida, usd: redondear((entrada * TARIFA.entrada + salida * TARIFA.salida) / 1e6, 4) };
}

function textoDelInforme(m, opciones, proveedor, previsto, porSub) {
  const l = [];
  l.push('BATERÍA DEL FLUJO NUEVO DE EVY');
  l.push(`Proveedor: ${proveedor}. Corridas por caso: ${opciones.n}. Turnos: ${m.turnos} (${m.llamadasAlModelo} con llamada al modelo).`);
  if (opciones.seco) {
    l.push('MODO SECO: el modelo es un texto genérico. Solo se evalúa lo que decide el CÓDIGO y los turnos que no llegan al modelo; los chequeos que dependen de lo que escribe el modelo se omiten.');
    l.push(`Omitidos en seco: ${m.omitidosEnSeco}. Costo PREVISTO de la corrida real con --n ${opciones.n}: ≈ USD ${previsto.usd} (${previsto.llamadas} llamadas, ${previsto.tokensEntrada} tokens de entrada).`);
    if (previsto.usd > opciones.topeUsd) l.push(`⚠ La corrida real COMPLETA con --n ${opciones.n} costaría ≈ USD ${previsto.usd} y se cortaría con el tope de ${opciones.topeUsd}: para cubrir todo hay que pedir un tope mayor (--tope-usd) o correr por partes (--grupos).`);
  }
  if (opciones.seco && porSub) {
    l.push(`Costo previsto por subconjunto (con --n ${opciones.n}; tope por omisión ${TOPE_USD_DEFECTO}): todo ≈ USD ${porSub.todo.usd} (${porSub.todo.llamadas} llamadas); barreras duras (--duros) ≈ USD ${porSub.duros.usd} (${porSub.duros.llamadas} llamadas); por grupo: ${Object.entries(porSub.porGrupo).map(([g, v]) => `${g} ${v.usd}`).join(', ')}.`);
  }
  l.push(`Chequeos evaluados: ${m.chequeos}; aprobados ${m.aprobados} (${m.pct} %). Umbral general: ${UMBRAL.general * 100} %. Barreras duras: ${m.duras.aprobadas}/${m.duras.n} (se exige el 100 %).`);
  if (!opciones.seco) l.push(`Tokens de entrada ${m.tokensEntrada}, de salida ${m.tokensSalida}; latencia media ${m.latenciaMsMedia} ms; costo ≈ USD ${m.costoUsd} (tarifa ${TARIFA.entrada}/${TARIFA.salida} USD por millón; no es una factura). Tope: ${opciones.topeUsd}.`);
  l.push(`Fallas (${m.fallas.length}):`);
  for (const f of m.fallas.slice(0, 60)) l.push(`  - ${f.caso}#${f.rep} turno ${f.turno}: ${f.tipo}${f.duro ? ' [DURO]' : ''}`);
  l.push('');
  l.push(`VEREDICTO: ${m.umbral.cumple ? 'cumple' : 'NO cumple'} (≥ 85 % de los chequeos y 100 % de las barreras duras${opciones.seco ? '; en seco solo cuenta lo evaluado' : ''}).`);
  return l.join('\n');
}
/** Las respuestas del modelo que una barrera de código rechazó: qué barrera, qué expresión y un trozo de lo que escribió el MODELO (nunca el texto del cliente). */
export function textoDeMotivos(corridas) {
  const l = [];
  for (const c of corridas) for (const t of c.turnos) {
    if (!t.llamoAlModelo || !t.rechazo) continue;
    l.push(`  - ${c.caso}#${c.rep} turno ${t.n}: barrera «${t.rechazo.motivo}»${t.rechazo.detalle ? ` — ${t.rechazo.detalle}` : ''}`);
    l.push(`      respuesta del modelo: ${JSON.stringify(String(t.crudo ?? '').replace(/\s+/g, ' ').slice(0, 240))}`);
  }
  return l.length ? ['Respuestas del modelo RECHAZADAS por una barrera de código (--motivo):', ...l].join('\n') : 'Respuestas del modelo rechazadas por una barrera de código: ninguna.';
}
function textoDeConversaciones(corridas, crudo) {
  return corridas.map((c) => [`--- Caso ${c.caso}, corrida ${c.rep}`, ...c.turnos.flatMap((t) => {
    const dice = t.turno.dice ?? (t.turno.imagen ? `[imagen: ${t.turno.imagen.slice(0, 80)}] ${t.turno.dice ?? ''}` : (t.turno.audio ? `[audio: ${t.turno.audio.slice(0, 80)}]` : `[${t.turno.tipo_mensaje}]`));
    return [`Cliente: ${dice}`, ...t.imagenes.map((k) => `Asistente [imagen ${k}]`), ...(t.mensajes.length ? t.mensajes.map((m) => `Asistente [${t.plan}${m.tipo === 'interactive' ? ', botón de recepción' : ''}]: ${m.cuerpo.replace(/\n+/g, ' / ')}`) : ['Asistente: (nada)']),
      ...(crudo && t.llamoAlModelo ? [`  [crudo del modelo] ${JSON.stringify(t.crudo.slice(0, 1200))}`] : [])];
  })].join('\n')).join('\n');
}

// ------------------------------------------------------------------------------------------------------- main
export async function main(argv, deps = {}) {
  const d = {
    salida: (t) => process.stdout.write(t), error: (t) => process.stderr.write(t), fetch: (...a) => globalThis.fetch(...a),
    leerArchivo: (r) => (existsSync(r) ? readFileSync(r, 'utf8') : null),
    gcloudToken: () => execFileSync('gcloud', ['auth', 'print-access-token'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }).toString(),
    ...deps,
  };
  let credencial = { clave: null, token: null, nombre: '' };
  try {
    const propias = new Set(['--confirmo-gasto', '--conversaciones', '--crudo', '--duros', '--motivo']);
    const conValor = new Set(['--tope-usd', '--archivo-casos', '--grupos', '--respuestas', '--pausa-ms']);
    let pausaMs = 1200;
    let archivoRespuestas = null;
    let grupos = null;
    const resto = [];
    let topeUsd = TOPE_USD_DEFECTO;
    let archivoCasos = RUTA_CASOS;
    for (let i = 0; i < argv.length; i++) {
      if (conValor.has(argv[i])) {
        const v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) throw new ErrorDeUso(`Falta el valor de ${argv[i]}.`);
        if (argv[i] === '--tope-usd') { if (!/^\d+(\.\d+)?$/.test(v) || Number(v) <= 0 || Number(v) > 5) throw new ErrorDeUso('--tope-usd debe ser un número entre 0 y 5.'); topeUsd = Number(v); } else if (argv[i] === '--pausa-ms') { if (!/^\d+$/.test(v) || Number(v) > 60000) throw new ErrorDeUso('--pausa-ms debe ser un entero entre 0 y 60000.'); pausaMs = Number(v); } else if (argv[i] === '--respuestas') archivoRespuestas = v; else if (argv[i] === '--grupos') { grupos = v.split(',').map((x) => norm(x)).filter(Boolean); if (!grupos.length) throw new ErrorDeUso('--grupos necesita al menos un grupo (G,E o Barreras).'); } else archivoCasos = v;
        i++;
      } else if (!propias.has(argv[i])) resto.push(argv[i]);
    }
    const confirmaGasto = argv.includes('--confirmo-gasto');
    const opciones = { ...leerArgumentos(resto), topeUsd, pausaMs };
    if (archivoRespuestas) {
      if (opciones.envDado || opciones.vertex) throw new ErrorDeUso('--respuestas no usa clave ni red: no se combina con --env ni --vertex.');
      const texto = d.leerArchivo(archivoRespuestas);
      if (texto === null || texto === undefined) throw new ErrorDeUso(`No existe el archivo de respuestas (${limpiarSecretos(archivoRespuestas).slice(0, 80)}).`);
      try { opciones.respuestas = JSON.parse(texto); } catch { throw new ErrorDeUso('El archivo de respuestas no es un JSON válido.'); }
      if (!opciones.respuestas || typeof opciones.respuestas !== 'object' || Array.isArray(opciones.respuestas)) throw new ErrorDeUso('El archivo de respuestas debe ser un objeto { caso: respuesta | { turno: respuesta } | [respuestas] }.');
      opciones.seco = true;   // sin red y sin clave
    }
    if (opciones.ayuda) { d.salida(AYUDA + '\n'); return 0; }
    if (!opciones.seco && !confirmaGasto) throw new ErrorDeUso('La corrida real es GASTO: agregue --confirmo-gasto solo con el «sí» de Andres, y con una clave del proyecto de PRUEBAS. Para verificar sin gasto, use --seco.');
    const flujo = JSON.parse(readFileSync(RUTA_FLUJO, 'utf8'));
    const datos = JSON.parse(d.leerArchivo(archivoCasos) ?? (() => { throw new ErrorDeUso(`No existe el archivo de casos (${archivoCasos}). Con el PR #638 fusionado está en Flujos/experimental/rroca-evy-bateria/; si no, use --archivo-casos.`); })());
    const todos = validarCasos(datos);
    const soloDuros = argv.includes('--duros');
    let elegidos = opciones.casos ? opciones.casos.map((id) => { const c = todos.find((x) => x.id === id); if (!c) throw new ErrorDeUso(`Caso desconocido: ${id}.`); return c; }) : todos;
    if (soloDuros) elegidos = elegidos.filter(esDuro);
    if (grupos) elegidos = elegidos.filter((c) => deGrupo(c, grupos));
    if (!elegidos.length) throw new ErrorDeUso('Ningún caso cumple --duros / --grupos / --casos.');
    const info = (t) => (opciones.json ? d.error(t + '\n') : d.salida(t + '\n'));
    if (!opciones.seco) { credencial = leerCredencial(opciones, d); info(`Clave del modelo: ${credencial.nombre} (valor no mostrado)`); }
    const proveedor = opciones.seco ? 'ninguno (seco)' : opciones.vertex ? `Vertex AI (${opciones.vertex}, ${opciones.locacion})` : 'AI Studio';
    const costo = { usd: 0, cortado: false };
    const corridas = [];
    for (const caso of elegidos) {
      for (let rep = 1; rep <= opciones.n; rep++) {
        if (!opciones.seco) d.error(`… ${caso.id} corrida ${rep}/${opciones.n}\n`);
        corridas.push(await correrCaso({ caso, rep, flujo, opciones, credencial, deps: d, costo }));
        if (costo.cortado) break;
      }
      if (costo.cortado) break;
    }
    const m = medir(corridas, elegidos, datos, opciones);
    const previsto = costoPrevisto(corridas);
    const porSub = costosPorSubconjunto(corridas, elegidos);
    const aviso = costo.cortado ? `\n⚠ La corrida se CORTÓ al llegar al tope de gasto (USD ${opciones.topeUsd}): los casos restantes no se corrieron.` : '';
    d.salida(opciones.json
      ? JSON.stringify({ proveedor, medidas: m, previsto, porSubconjunto: porSub, cortadaPorTope: costo.cortado, ...(argv.includes('--motivo') ? { rechazos: corridas.flatMap((c) => c.turnos.filter((t) => t.rechazo).map((t) => ({ caso: c.caso, rep: c.rep, turno: t.n, ...t.rechazo }))) } : {}) }, null, 1) + '\n'
      : textoDelInforme(m, opciones, proveedor, previsto, porSub) + aviso + '\n' + (argv.includes('--motivo') ? '\n' + textoDeMotivos(corridas) + '\n' : '') + (argv.includes('--conversaciones') || argv.includes('--crudo') ? '\n' + textoDeConversaciones(corridas, argv.includes('--crudo')) + '\n' : ''));
    return m.umbral.cumple && !costo.cortado ? 0 : 1;
  } catch (e) {
    const secretos = [credencial.clave, credencial.token];
    if (e instanceof ErrorDeUso) { d.error(`✗ ${limpiarSecretos(e.message, secretos)}\n`); return 2; }
    d.error(`✗ Fallo inesperado: ${limpiarSecretos(mensajeDe(e), secretos).slice(0, 300)}\n`);
    return 1;
  }
}

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esPrincipal) process.exitCode = await main(process.argv.slice(2));
