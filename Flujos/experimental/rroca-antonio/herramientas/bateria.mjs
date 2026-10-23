#!/usr/bin/env node
// BATERÍA DE LA CONVERSACIÓN DE «EL PUENTE» DE ANTONIO (REHECHO SOBRE LA ENTREGA 2, 23/10/2026) CONTRA EL MODELO REAL.
//
// QUÉ ES. Corre los turnos del cliente de `bateria-casos.json` (A el camino completo, B «precio primero», C precios en general y el puente, D anuncio) por el flujo armado de PRUEBA (`rroca-antonio.prueba.json`):
// recorre su grafo nodo por nodo y corre de verdad los nodos Code del JSON. Lo ÚNICO que sale a la red es «Conversar con el modelo» (el cuerpo EXACTO que arma `raCuerpoModelo`, con la línea `[MODO_TURNO: …]`): la
// consola, la ingesta, Graph, los medios y el cotejo van simulados y en memoria, igual que en `chat-novuchat`. El motor (`crearMundo`, `llamarGemini`, `leerCredencial`, `limpiarSecretos`, `TARIFA`) se IMPORTA de
// `Flujos/experimental/chat-novuchat/herramientas/bateria.mjs`: NO se copia un cuarto motor. (Es la herramienta de `rroca-ruben/herramientas/bateria.mjs` adaptada a los nombres y a las reglas de Antonio.)
//
// QUÉ MIDE (lo que depende del MODELO; lo determinista lo cubren `rehecho.test.ts` y el vigilante de UX):
//   - qué porcentaje de los turnos del modelo pasa las barreras (sin texto de respaldo) y, si no, el motivo del rechazo;
//   - `finishReason = MAX_TOKENS`, un solo «?», responde al tema del cliente, la duda conecta con el libro, ninguna cifra inventada y el largo entre 120 y 700 caracteres;
//   - las violaciones de los invariantes del vigilante (versión espejo, en JavaScript, sobre lo que el cliente RECIBE) y las reglas duras (nunca «acreditado», nunca negar ser una IA, nunca el nombre de una persona en la presentación);
//   - tokens, latencia y costo.
// UMBRAL para seguir con `gemini-3.5-flash-lite`: al menos 85 % de los turnos del modelo sin texto de respaldo y 0 violaciones duras (si no, DECISIÓN de Andres).
//
// Se corre desde la raíz del repositorio:
//   node Flujos/experimental/rroca-antonio/herramientas/bateria.mjs --seco
//   node Flujos/experimental/rroca-antonio/herramientas/bateria.mjs --vertex <proyecto-de-pruebas> --n 3 --confirmo-gasto
//   node Flujos/experimental/rroca-antonio/herramientas/bateria.mjs --env <archivo> --n 3 --confirmo-gasto --conversaciones
//
// OPCIONES (las de `chat-novuchat` más tres propias)
//   --seco            NO llama a nada: el modelo es una respuesta fija por turno (campo `seco` de cada turno del caso; sin él, el modelo «cae»). No lee ninguna clave ni toca la red.
//   --n <1..20>       corridas por caso (3 por defecto).
//   --casos A,B,C     ids de los casos (todos por defecto).
//   --env <archivo>   archivo con la clave (`.env` y este). --vertex <proyecto> usa Vertex AI con el token de `gcloud` (la clave vive solo en n8n). --locacion <región>.
//   --confirmo-gasto  OBLIGATORIA fuera de `--seco`: la corrida real es GASTO y solo se hace con el «sí» de Andres. USA UNA CREDENCIAL DEL PROYECTO DE PRUEBAS, NUNCA la de producción.
//   --conversaciones  además del informe, imprime cada conversación (lo que dijo el cliente y lo que se le envió).
//   --crudo           por turno del modelo: el TEXTO CRUDO que devolvió Gemini (antes de filtros), el motivo EXACTO de rechazo y el texto que quedó tras cada barrera. Sin secretos.
//   --json            salida de máquina: UN objeto JSON en la salida estándar. --ayuda: este resumen.
//
// NUNCA SE IMPRIME EL VALOR DE UN SECRETO (sale el NOMBRE de la variable). NO ESCRIBE ARCHIVOS. El código del flujo se ejecuta con el motor de chat-novuchat: es código del propio repositorio.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ErrorDeUso, TARIFA, crearMundo, leerArgumentos, leerCredencial, limpiarSecretos, llamarGemini, telefonoDe, textoDeGemini } from '../../chat-novuchat/herramientas/bateria.mjs';
import { CONFIG } from '../construir.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CARPETA_FLUJO = join(AQUI, '..');
const RUTA_FLUJO = join(CARPETA_FLUJO, 'rroca-antonio.prueba.json');
const RUTA_CASOS = join(AQUI, 'bateria-casos.json');
// El filtro común de la redacción y, EN EL MISMO ORDEN que el armador, las librerías del flujo (base común, core de texto y `ra.js`): no hay una lista aparte que pueda desactualizarse.
const RUTAS_DE_LA_LIBRERIA = [join(CARPETA_FLUJO, '../comun-sin-agente/src/filtro-redaccion.js'), ...CONFIG.librerias.map((r) => join(CARPETA_FLUJO, r))];

// Datos de ejemplo: teléfonos sintéticos (seis ceros) y el catálogo de Antonio. Lunes 05/10/2026, 10:00 en La Paz.
const PID = '59100000003';
const REC = '59100000001';
const MEDIA_QR = 'MEDIAQR100200';
const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);
const NEGOCIO = 'El Puente';
const CATALOGO = [
  { id: 'pack-completo', nombre: 'Pack completo', precio: 49, activo: true },
  { id: 'libro', nombre: 'Libro', precio: 35, activo: true },
  { id: 'workbook', nombre: 'Workbook', precio: 20, activo: true },
  { id: 'guia-de-conversaciones', nombre: 'Guía de conversaciones', precio: 19, activo: true },
  { id: 'calendario-de-conexion', nombre: 'Calendario de conexión', precio: 17, activo: true },
  { id: 'preguntas-profundas', nombre: 'Preguntas profundas', precio: 15, activo: true },
];
// Legítimas: las del libro (14 capítulos, 4 partes, 6 pilares, 30 días, 138 páginas, 10 a 20 minutos al día) y el número de un capítulo (1 a 14).
const CIFRAS_PERMITIDAS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '20', '30', '138']);
const UMBRAL_SIN_RESPALDO = 0.85;
const PLANES_DEL_MODELO_BUENOS = ['modelo', 'angulo', 'puente', 'opciones'];
const PLANES_DE_RESPALDO = ['modelo_caido', 'angulo_fijo', 'puente_fijo', 'opciones_fijo', 'charla_fija'];
const PLANES_DE_CHARLA = ['saludo', 'modelo', 'angulo', 'angulo_fijo', 'puente', 'puente_fijo', 'charla_fija', 'opciones', 'opciones_fijo'];
const PLANES_EXENTOS = ['qr', 'qr_pendiente', 'complemento', 'comprobante', 'opciones_fijo', 'repetido'];
const BOTONES_DE_PRODUCTO = ['b_pack', 'b_libro', 'b_workbook', 'b_guia', 'b_calendario', 'b_preguntas', 'b_comp'];
const CON_PRECIO = /\b\d+(?:[.,]\d{1,2})?\s?Bs\b/i;
const CIERRE_PUENTE = '¿Te muestro las opciones?';
const BLOQUE = /Te dejo aqu[ií] abajo las opciones/;

const AYUDA = `Batería de la conversación de Antonio contra el modelo (rehecho sobre la ENTREGA 2).
  --seco  --n <1..20>  --casos A,B,C,D  --env <archivo>  --vertex <proyecto>  --locacion <región>  --confirmo-gasto  --conversaciones  --crudo  --json  --ayuda
Fuera de --seco la corrida es GASTO: exige --confirmo-gasto y una credencial del proyecto de PRUEBAS (nunca la de producción).`;

const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const redondear = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : 0);
const mensajeDe = (e) => (e instanceof Error ? e.message : String(e));
const objeto = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Las funciones de la librería del flujo (la base común, el core de texto y `ra.js`) en un contexto aislado, sin los globales de Node. */
export function cargarLibreria() {
  const fuente = RUTAS_DE_LA_LIBRERIA.map((r) => readFileSync(r, 'utf8')).join('\n');
  return runInNewContext(`${fuente}\n({ raQuitarEcoDeMarcador, cmRevisarRedaccion, raExtraRedaccion, raEsDerivar, raEsMarcaRiesgo, vdQuitarPromesaDeOpciones, vdSinPreguntaFinal, vdOraciones, vdPrometeOpciones, RA_PROMETE_DEBILES, raNorm })`, {});
}

// ------------------------------------------------------------------------------------------------------- los casos
/** Valida `bateria-casos.json`: ids únicos, turnos con `dice` (texto) o `boton` (id b_*), y las marcas de medida bien formadas. */
export function validarCasos(datos) {
  const casos = objeto(datos).casos;
  if (!Array.isArray(casos) || !casos.length) throw new ErrorDeUso('bateria-casos.json no trae `casos`.');
  const vistos = new Set();
  for (const c of casos) {
    if (!/^[A-Za-z0-9_-]{1,12}$/.test(String(c.id))) throw new ErrorDeUso(`Caso con id inválido: ${String(c.id).slice(0, 20)}`);
    if (vistos.has(c.id)) throw new ErrorDeUso(`Caso repetido: ${c.id}`);
    vistos.add(c.id);
    if (!Array.isArray(c.turnos) || !c.turnos.length) throw new ErrorDeUso(`El caso ${c.id} no trae turnos.`);
    c.turnos.forEach((t, i) => {
      const donde = `${c.id} turno ${i + 1}`;
      const tieneTexto = typeof t.dice === 'string' && t.dice.trim() !== '';
      const tieneBoton = typeof t.boton === 'string' && /^b_[a-z]{1,12}$/.test(t.boton);
      if (tieneTexto === tieneBoton) throw new ErrorDeUso(`${donde}: debe traer \`dice\` (texto) o \`boton\` (id b_*), uno solo.`);
      if (t.seco !== undefined && typeof t.seco !== 'string') throw new ErrorDeUso(`${donde}: \`seco\` debe ser un texto.`);
      if (t.tema !== undefined && (!Array.isArray(t.tema) || t.tema.some((x) => typeof x !== 'string' || !x))) throw new ErrorDeUso(`${donde}: \`tema\` debe ser una lista de palabras.`);
      if (t.duda !== undefined && typeof t.duda !== 'boolean') throw new ErrorDeUso(`${donde}: \`duda\` debe ser verdadero o falso.`);
    });
  }
  return casos;
}

// ------------------------------------------------------------------------------------------------------- el mundo de una corrida
let seq = 0;
const valorMeta = (msg, from) => ({
  messaging_product: 'whatsapp', metadata: { display_phone_number: '59100000002', phone_number_id: PID }, contacts: [{ profile: { name: 'Ana Pérez' }, wa_id: from }],
  messages: [{ from, id: `wamid.IN${++seq}`, timestamp: '1', ...msg }],
});
const mensajeDelTurno = (t) => (t.boton ? { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: t.boton, title: 'x' } } } : { type: 'text', text: { body: t.dice } });

function crearDobles({ tel, seco, turnoActual, credencial, opciones, deps, nodoModelo }) {
  const cobro = { pendiente: false, monto: null, pedido: null };
  const panel = () => ({
    statusCode: 200,
    body: {
      tenantId: 'rroca-antonio', estadoComercio: 'activo', datosDelNegocio: { nombreNegocio: NEGOCIO }, operacion: { numeroRecepcion: REC, prefijosPermitidos: ['591'] }, atencion: { estado: 'normal' },
      catalogo: CATALOGO, venta: { mediaIdQr: MEDIA_QR },
      cobroReal: { nombreCuenta: 'Titular Ejemplo', banco: 'Banco Ejemplo' },
      cobro: { activo: true, qr: { url: 'https://qr.example.com/q.png' }, regla: 2, pendiente: cobro.pendiente, monto: cobro.monto, pedido: cobro.pedido },
    },
  });
  const gemini = (t) => ({ candidates: [{ content: { parts: [{ text: t }] } }] });
  let n = 0;
  const envio = () => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.OUT${++n}` }] });
  const dobles = {
    'Traer configuración': () => panel(),
    'Reportar mensaje (entrante)': () => ({ ok: true }),
    'Reportar mensaje (saliente)': (ll) => {
      const c = ll.cuerpo ?? {};
      if (c.evento === 'qr_enviado') { cobro.pendiente = true; cobro.monto = Number(c.monto); cobro.pedido = String(c.referencia); }
      return { ok: true };
    },
    'Reportar protección': () => ({ ok: true }),
    'Enviar aviso': envio, 'Enviar a WhatsApp': envio, 'Enviar respaldo': envio,
    'Obtener URL del medio (general)': () => ({ url: 'https://lookaside.fbsbx.com/m', mime_type: 'image/jpeg', file_size: 100_000 }),
    'Descargar medio': () => ({}),
    'Transcribir audio': () => gemini(''),
    'Describir imagen': () => gemini(JSON.stringify({ categoria: 'otro', texto: '' })),
    'Describir documento': () => gemini(JSON.stringify({ categoria: 'otro', texto: '' })),
    'Cotejar en el servidor': () => { cobro.pendiente = false; return { statusCode: 200, body: { estado: 'valido', importe: 49, avisarComercio: true } }; },
    'Cancelar cobro en el servidor': () => ({ statusCode: 200, body: { atencion: { estado: 'normal' } } }),
    // LO ÚNICO QUE SALE A LA RED (y solo fuera de --seco): el cuerpo exacto que arma el flujo.
    'Conversar con el modelo': async (ll) => {
      const t = turnoActual();
      t.llamadasAlModelo += 1;
      t.cuerpoModelo = ll.cuerpo;
      if (seco) {
        const fijo = t.turno.seco;
        if (typeof fijo !== 'string') return { error: { message: 'modelo caído (seco, sin respuesta fija)', code: 0 } };
        return { ...gemini(fijo), usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 } };
      }
      const r = await llamarGemini({ cuerpo: ll.cuerpo, urlDelNodo: ll.url, credencial, opciones, deps, nodo: nodoModelo });
      t.ms += r.ms;
      t.reintentos += r.reintentos;
      return r.json;
    },
  };
  return { dobles, tel };
}

// ------------------------------------------------------------------------------------------------------- una corrida de un caso
/** Corre UN caso (una conversación) con el mundo propio de su teléfono. Devuelve los turnos con lo medido. */
export async function correrCaso({ caso, rep, flujo, lib, opciones, credencial, deps }) {
  const tel = telefonoDe(caso.id, rep);
  const nodoModelo = flujo.nodes.find((n) => n.name === 'Conversar con el modelo');
  const registro = [];
  let actual = null;
  const { dobles } = crearDobles({ tel, seco: opciones.seco, turnoActual: () => actual, credencial, opciones, deps, nodoModelo });
  const mundo = crearMundo({ flujo, dobles, ahoraMs: AHORA, configBase: { phoneNumberIdEsperado: PID, numeroRecepcion: REC, telefonosDePrueba: tel } });
  mundo.sd.antonio = { [REC]: { ultimoMs: AHORA - 5 * 60_000, turnos: 1 } };
  const estado = { charla: 0, qrVisto: false, bloques: 0, ultimoFuePuente: false };
  for (const [i, turno] of caso.turnos.entries()) {
    actual = { turno, llamadasAlModelo: 0, cuerpoModelo: null, ms: 0, reintentos: 0 };
    const entrada = { headers: {}, body: { modoPrueba: true, telefonoDePrueba: tel, enviarDeVerdad: false, ...valorMeta(mensajeDelTurno(turno), tel) } };
    const r = await mundo.turno(entrada);
    const armado = objeto((r.porNodo['Armar mensajes'] ?? [])[0]);
    const decision = objeto((r.porNodo['Decidir turno'] ?? [])[0]);
    const resumen = objeto((r.porNodo['Resumen del turno'] ?? [])[0]);
    const respuestaModelo = (r.porNodo['Conversar con el modelo'] ?? [])[0];
    const crudo = textoDeGemini(respuestaModelo);
    const plan = String(objeto(armado.resumen).plan ?? armado.plan ?? '');
    const mensajes = (Array.isArray(resumen.mensajes) ? resumen.mensajes : []).map((m) => ({ tipo: objeto(m.payload).type === 'image' ? 'image' : objeto(m.payload).type === 'interactive' ? 'interactive' : 'text', cuerpo: String(m.texto ?? ''), payload: objeto(m.payload) }));
    // Lo que el cliente RECIBE: el cuerpo del mensaje; los botones, por su id y título.
    const botones = mensajes.flatMap((m) => (objeto(objeto(m.payload.interactive).action).buttons ?? []).map((b) => ({ id: String(objeto(b.reply).id), title: String(objeto(b.reply).title) })));
    const t = {
      n: i + 1, dice: turno.dice ?? `[botón ${turno.boton}]`, plan, fallo: r.fallo, mensajes, botones,
      llamoAlModelo: decision.llamarModelo === true || actual.llamadasAlModelo > 0, crudo,
      finishReason: String(objeto(objeto((objeto(respuestaModelo).candidates ?? [])[0])).finishReason ?? ''),
      tokensEntrada: Number(objeto(objeto(respuestaModelo).usageMetadata).promptTokenCount) || 0, tokensSalida: Number(objeto(objeto(respuestaModelo).usageMetadata).candidatesTokenCount) || 0,
      ms: actual.ms, reintentos: actual.reintentos, marcas: turno,
    };
    const planDec = objeto(decision.plan);
    t.diagnostico = t.llamoAlModelo ? diagnosticar(lib, crudo, { modo: String(planDec.modo ?? ''), habil: decision.opcionesHabilitadas === true, qrAbierto: planDec.qrAbierto === true, textoCliente: String(planDec.textoCliente ?? turno.dice ?? '') }) : null;
    t.motivo = t.diagnostico ? t.diagnostico.motivo : '';
    t.modo = String(planDec.modo ?? '');
    t.violaciones = [...violacionesDelTurno(estado, turno, t), ...(r.fallo ? [`el flujo falló en «${r.fallo.nodo}»: ${r.fallo.mensaje}`] : [])];
    actualizarEstado(estado, t);
    registro.push(t);
  }
  return { caso: caso.id, rep, turnos: registro };
}

/**
 * EL DIAGNÓSTICO de un turno del modelo: repite, etapa por etapa y con las mismas condiciones, la cadena de «Armar mensajes» (eco del marcador, RIESGO, DERIVAR, `cmRevisarRedaccion` con sus filtros siempre activos y `raExtraRedaccion`,
 * quita de promesas de opciones, pregunta final del puente y de las opciones) y devuelve `{ motivo, pasos }`: `motivo` es el NOMBRE de la regla que rechazó (o «vacio_tras_<etapa>» si una quita dejó el texto vacío; '' si pasa)
 * y `pasos` el texto que quedó tras cada barrera. `ctx` = { modo, habil, qrAbierto, textoCliente }.
 */
export function diagnosticar(lib, crudo, ctx) {
  const pasos = [{ etapa: 'crudo', texto: String(crudo ?? '') }];
  const sinEco = lib.raQuitarEcoDeMarcador(String(crudo ?? ''));
  if (sinEco !== String(crudo ?? '').trim()) pasos.push({ etapa: 'sin eco de marcador', texto: sinEco });
  crudo = sinEco;
  const fin = (motivo) => ({ motivo, pasos });
  if (String(crudo).trim() === '') return fin('vacio');
  if (lib.raEsMarcaRiesgo(crudo)) return fin('riesgo');
  if (lib.raEsDerivar(crudo)) return fin('derivar');
  const rev = lib.cmRevisarRedaccion(crudo, {
    maximo: 700, enlacesPermitidos: [], quienPromete: ['antonio', 'el equipo'], nombreNegocio: NEGOCIO, textoDelCliente: ctx.textoCliente, extra: [lib.raExtraRedaccion],
    sinDatosDePago: true, sinAfirmarCompra: true, sinPromesasDeAviso: true, avisoRespaldado: false, maxOraciones: ctx.qrAbierto === true ? 3 : undefined,
  });
  pasos.push({ etapa: 'filtro (cmRevisarRedaccion + raExtraRedaccion)', texto: rev.texto, motivo: rev.motivo });
  if (rev.motivo !== '') return fin(rev.motivo);
  let t = rev.texto;
  if (ctx.qrAbierto !== true && (!ctx.habil || ctx.modo === 'puente' || ctx.modo === 'opciones')) {
    t = lib.vdQuitarPromesaDeOpciones(t, lib.RA_PROMETE_DEBILES);
    pasos.push({ etapa: 'sin promesas de opciones', texto: t });
    if (t.trim() === '') return fin('vacio_tras_promesas_de_opciones');
  }
  if (!ctx.habil && ctx.qrAbierto !== true && ctx.modo !== 'puente' && t.split('\n').some((l) => lib.vdOraciones(l).some((o) => lib.vdPrometeOpciones(o, lib.RA_PROMETE_DEBILES)))) return fin('promete_opciones');
  if (ctx.qrAbierto !== true && (ctx.modo === 'puente' || ctx.modo === 'opciones')) { t = lib.vdSinPreguntaFinal(t); pasos.push({ etapa: 'sin pregunta final', texto: t }); if (t.trim() === '') return fin('vacio_tras_pregunta_final'); }
  return fin('');
}

// ------------------------------------------------------------------------------------------------------- invariantes (espejo del vigilante, sobre lo que el cliente recibe)
function violacionesDelTurno(est, turno, t) {
  const v = [];
  const idToque = turno.boton ?? '';
  const prellenado = typeof turno.dice === 'string' && /^Hola, (quiero conocer el Pack|quiero el libro|me interesa el Workbook|quiero saber más del Calendario)/.test(turno.dice);
  if (t.mensajes.length > 1) v.push(`el turno ${t.n} envió ${t.mensajes.length} mensajes`);
  for (const m of t.mensajes) {
    const titulos = (objeto(objeto(m.payload.interactive).action).buttons ?? []).map((b) => String(objeto(b.reply).title));
    const ids = (objeto(objeto(m.payload.interactive).action).buttons ?? []).map((b) => String(objeto(b.reply).id));
    const montos = new Set((m.cuerpo.match(new RegExp(CON_PRECIO.source, 'gi')) ?? []).map((x) => x.replace(/\s/g, '')));
    // 11. Ningún precio antes de tiempo. La excepción declarada: el precio de UN producto nombrado (un solo monto, sin botones de producto ni de precio).
    const precioDeUnProducto = t.plan === 'precio' && montos.size === 1 && !titulos.some((x) => CON_PRECIO.test(x)) && !ids.some((i) => BOTONES_DE_PRODUCTO.includes(i));
    if (est.charla < 2 && !est.qrVisto && !prellenado && !PLANES_EXENTOS.includes(t.plan) && !precioDeUnProducto) {
      if (CON_PRECIO.test(m.cuerpo) || titulos.some((x) => CON_PRECIO.test(x))) v.push(`inv. 11: un precio con ${est.charla} mensaje(s) de conversación («${m.cuerpo.slice(0, 40)}…»)`);
      if (ids.some((i) => BOTONES_DE_PRODUCTO.includes(i))) v.push(`inv. 11: un botón de producto con ${est.charla} mensaje(s) de conversación`);
    }
    // 12. El bloque de opciones a lo más una vez.
    if (BLOQUE.test(m.cuerpo) && est.bloques >= 1) v.push('inv. 12: el bloque de las opciones salió más de una vez');
    // 15. Una sola pregunta.
    if (PLANES_DE_CHARLA.includes(t.plan)) {
      if ((m.cuerpo.match(/\?/g) ?? []).length > 1) v.push('inv. 15: más de una pregunta en un mensaje de conversación');
      if (/^opciones(_fijo)?$/.test(t.plan) && /\?\s*$/.test(m.cuerpo)) v.push('inv. 15: el bloque de las opciones termina en una pregunta');
    }
    // El botón de Antonio solo al derivar: la conversación no lo lleva.
    if (PLANES_DE_CHARLA.includes(t.plan) && objeto(m.payload.interactive).type === 'cta_url') v.push(`el plan «${t.plan}» no deriva, pero salió con el botón de Antonio`);
    // Reglas duras: prohibición 3 y 4, y la presentación sin el nombre de una persona.
    if (/acreditad|verificad|recibimos tu pago/i.test(m.cuerpo)) v.push('regla 3: dice que un pago está acreditado, verificado o recibido');
    if (/no soy (un |una )?(bot|ia|robot|asistente)|persona (real|de verdad)|soy humano/i.test(norm(m.cuerpo))) v.push('regla 4: niega ser una IA');
    if (/soy el asistente virtual de (antonio|dauber)/i.test(norm(m.cuerpo))) v.push('la presentación nombra a una persona');
  }
  // 13. Lo que se ofrece se cumple.
  const acepta = /^(si|claro|dale|ok|bueno|por favor|me interesa|adelante|si por favor)$/.test(norm(turno.dice ?? '')) || idToque === 'b_opciones';
  if (est.ultimoFuePuente && !est.qrVisto && acepta && !t.botones.some((b) => CON_PRECIO.test(b.title))) v.push('inv. 13: se ofreció «¿Te muestro las opciones?» y la respuesta no trae botones con precio');
  return v;
}
function actualizarEstado(est, t) {
  for (const m of t.mensajes) {
    if (m.tipo === 'image') est.qrVisto = true;
    // Cuenta como conversación el saludo con presentación, lo que sigue de la charla y el precio de un producto que lleva la presentación (el primer mensaje).
    if ((PLANES_DE_CHARLA.includes(t.plan) && (t.plan !== 'saludo' || /asistente virtual/i.test(m.cuerpo))) || (t.plan === 'precio' && /asistente virtual/i.test(m.cuerpo))) est.charla += 1;
    if (BLOQUE.test(m.cuerpo)) est.bloques += 1;
  }
  const ult = [...t.mensajes].reverse().find((m) => m.tipo !== 'image' && m.cuerpo.trim() !== '');
  if (t.mensajes.length) est.ultimoFuePuente = !!ult && ult.cuerpo.trim().endsWith(CIERRE_PUENTE);
}

// ------------------------------------------------------------------------------------------------------- las métricas
/** Mide lo que depende del modelo sobre todas las corridas. Función pura (se prueba sola). */
export function medir(corridas) {
  const turnos = corridas.flatMap((c) => c.turnos.map((t) => ({ ...t, caso: c.caso, rep: c.rep })));
  const delModelo = turnos.filter((t) => t.llamoAlModelo);
  const sinRespaldo = delModelo.filter((t) => PLANES_DEL_MODELO_BUENOS.includes(t.plan));
  const conRespaldo = delModelo.filter((t) => PLANES_DE_RESPALDO.includes(t.plan));
  const motivos = {};
  for (const t of conRespaldo) motivos[t.motivo || 'sin_motivo_del_filtro'] = (motivos[t.motivo || 'sin_motivo_del_filtro'] ?? 0) + 1;
  const pct = (n, d) => (d ? redondear((100 * n) / d, 1) : 0);
  const conTexto = delModelo.filter((t) => t.crudo.trim() !== '' && t.motivo !== 'derivar');
  const unaPregunta = conTexto.filter((t) => (t.crudo.match(/\?/g) ?? []).length <= 1);
  const conTema = delModelo.filter((t) => Array.isArray(t.marcas.tema));
  const temaOk = conTema.filter((t) => t.marcas.tema.some((p) => norm(t.crudo).includes(norm(p))));
  const conDuda = delModelo.filter((t) => t.marcas.duda === true);
  const dudaOk = conDuda.filter((t) => /libro|ejercicio|capitulo|30 dias|metodo|pilar|pausa|escuch/.test(norm(t.crudo)));
  const conCifras = conTexto.filter((t) => (t.crudo.match(/\b\d+(?:[.,]\d+)?\b/g) ?? []).some((x) => !CIFRAS_PERMITIDAS.has(x)));
  const largoOk = conTexto.filter((t) => t.crudo.length >= 120 && t.crudo.length <= 700);
  const violaciones = turnos.flatMap((t) => t.violaciones.map((v) => ({ caso: t.caso, rep: t.rep, turno: t.n, v })));
  const tokensEntrada = delModelo.reduce((a, t) => a + t.tokensEntrada, 0);
  const tokensSalida = delModelo.reduce((a, t) => a + t.tokensSalida, 0);
  const costo = (tokensEntrada * TARIFA.entrada + tokensSalida * TARIFA.salida) / 1e6;
  const proporcion = delModelo.length ? sinRespaldo.length / delModelo.length : 0;
  return {
    turnosTotales: turnos.length, turnosDelModelo: delModelo.length,
    sinRespaldo: { n: sinRespaldo.length, pct: pct(sinRespaldo.length, delModelo.length) }, conRespaldo: { n: conRespaldo.length, motivos },
    maxTokens: delModelo.filter((t) => t.finishReason === 'MAX_TOKENS').length,
    unaSolaPregunta: { n: unaPregunta.length, de: conTexto.length }, respondeAlTema: { n: temaOk.length, de: conTema.length },
    laDudaConectaConElLibro: { n: dudaOk.length, de: conDuda.length }, cifrasInventadas: conCifras.length, largoEntre120y700: { n: largoOk.length, de: conTexto.length },
    violaciones, tokensEntrada, tokensSalida, costoUsd: redondear(costo, 5), latenciaMsMedia: delModelo.length ? Math.round(delModelo.reduce((a, t) => a + t.ms, 0) / delModelo.length) : 0,
    umbral: { sinRespaldoMinimo: UMBRAL_SIN_RESPALDO, cumple: delModelo.length > 0 && proporcion >= UMBRAL_SIN_RESPALDO && violaciones.length === 0 },
  };
}

function textoDelInforme(m, proveedor, opciones) {
  const l = [];
  l.push('BATERÍA DE LA CONVERSACIÓN DE ANTONIO (rehecho sobre la ENTREGA 2)');
  l.push(`Proveedor: ${proveedor}. Corridas por caso: ${opciones.n}. Turnos: ${m.turnosTotales} (${m.turnosDelModelo} con llamada al modelo).`);
  if (opciones.seco) l.push('MODO SECO: el modelo es una respuesta fija por turno; las cifras del modelo NO significan nada. Solo prueba que lo determinista corre sin violaciones.');
  l.push('');
  l.push(`Turnos del modelo sin texto de respaldo: ${m.sinRespaldo.n}/${m.turnosDelModelo} (${m.sinRespaldo.pct} %). Umbral: ${UMBRAL_SIN_RESPALDO * 100} %.`);
  l.push(`Con respaldo: ${m.conRespaldo.n}. Motivos: ${Object.keys(m.conRespaldo.motivos).length ? Object.entries(m.conRespaldo.motivos).map(([k, v]) => `${k}=${v}`).join(', ') : 'ninguno'}.`);
  l.push(`finishReason MAX_TOKENS: ${m.maxTokens}. Una sola «?»: ${m.unaSolaPregunta.n}/${m.unaSolaPregunta.de}. Responde al tema: ${m.respondeAlTema.n}/${m.respondeAlTema.de}.`);
  l.push(`La duda conecta con el libro: ${m.laDudaConectaConElLibro.n}/${m.laDudaConectaConElLibro.de}. Cifras inventadas: ${m.cifrasInventadas}. Largo 120 a 700: ${m.largoEntre120y700.n}/${m.largoEntre120y700.de}.`);
  l.push(`Tokens de entrada ${m.tokensEntrada}, de salida ${m.tokensSalida}; latencia media ${m.latenciaMsMedia} ms; costo ≈ USD ${m.costoUsd} (tarifa ${TARIFA.entrada}/${TARIFA.salida} USD por millón; no es una factura).`);
  l.push(`Violaciones de los invariantes y de las reglas duras: ${m.violaciones.length}.`);
  for (const x of m.violaciones.slice(0, 30)) l.push(`  - ${x.caso}#${x.rep} turno ${x.turno}: ${x.v}`);
  l.push('');
  l.push(`VEREDICTO: ${m.umbral.cumple ? 'cumple el umbral' : 'NO cumple el umbral'} (${opciones.seco ? 'en seco solo cuenta la parte de violaciones' : 'si no cumple: decisión de Andres'}).`);
  return l.join('\n');
}
function textoDelCrudo(corridas) {
  const l = [];
  for (const c of corridas) for (const t of c.turnos.filter((x) => x.llamoAlModelo)) {
    l.push(`--- ${c.caso}#${c.rep} turno ${t.n} · modo ${t.modo || '-'} · plan final «${t.plan}» · motivo exacto: ${t.motivo || '(pasa las barreras)'} · finishReason ${t.finishReason || '-'}`);
    l.push(`Cliente: ${t.dice}`);
    for (const p of t.diagnostico.pasos) l.push(`  [${p.etapa}]${p.motivo ? ` RECHAZA «${p.motivo}»` : ''} ${JSON.stringify(String(p.texto).slice(0, 1200))}`);
    l.push(`  Cliente recibió: ${t.mensajes.map((m) => JSON.stringify(m.cuerpo.slice(0, 600))).join(' | ') || '(nada)'}`);
  }
  return l.join('\n');
}
function textoDeConversaciones(corridas) {
  return corridas.map((c) => [`--- Caso ${c.caso}, corrida ${c.rep}`, ...c.turnos.flatMap((t) => [`Cliente: ${t.dice}`, ...(t.mensajes.length ? t.mensajes.map((m) => `Asistente [${t.plan}]: ${m.cuerpo.replace(/\n+/g, ' / ')}${t.botones.length ? `  (botones: ${t.botones.map((b) => b.title).join(' | ')})` : ''}`) : [`Asistente [${t.plan}]: (sin mensaje)`])])].join('\n')).join('\n\n');
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
    const confirmaGasto = argv.includes('--confirmo-gasto');
    const conversaciones = argv.includes('--conversaciones');
    const crudo = argv.includes('--crudo');
    const opciones = leerArgumentos(argv.filter((a) => a !== '--confirmo-gasto' && a !== '--conversaciones' && a !== '--crudo'));
    if (opciones.ayuda) { d.salida(AYUDA + '\n'); return 0; }
    // La corrida real es GASTO: sin la confirmación explícita (que solo da el «sí» de Andres) no se llama a nada.
    if (!opciones.seco && !confirmaGasto) throw new ErrorDeUso('La corrida real es GASTO: agregue --confirmo-gasto solo con el «sí» de Andres, y con una credencial del proyecto de PRUEBAS. Para verificar sin gasto, use --seco.');
    const flujo = JSON.parse(readFileSync(RUTA_FLUJO, 'utf8'));
    const todos = validarCasos(JSON.parse(readFileSync(RUTA_CASOS, 'utf8')));
    const elegidos = opciones.casos ? opciones.casos.map((id) => { const c = todos.find((x) => x.id === id); if (!c) throw new ErrorDeUso(`Caso desconocido: ${id}. Hay: ${todos.map((x) => x.id).join(', ')}.`); return c; }) : todos;
    const info = (t) => (opciones.json ? d.error(t + '\n') : d.salida(t + '\n'));
    if (!opciones.seco) { credencial = leerCredencial(opciones, d); info(`Clave del modelo: ${credencial.nombre} (valor no mostrado)`); }
    const lib = cargarLibreria();
    const proveedor = opciones.seco ? 'ninguno (seco)' : opciones.vertex ? `Vertex AI (${opciones.vertex}, ${opciones.locacion})` : 'AI Studio';
    const corridas = [];
    for (const caso of elegidos) {
      for (let rep = 1; rep <= opciones.n; rep++) {
        if (!opciones.seco) d.error(`… ${caso.id} corrida ${rep}/${opciones.n}\n`);
        corridas.push(await correrCaso({ caso, rep, flujo, lib, opciones, credencial, deps: d }));
      }
    }
    const m = medir(corridas);
    d.salida(opciones.json ? JSON.stringify({ proveedor, medidas: m, ...(conversaciones ? { conversaciones: corridas } : {}), ...(crudo ? { crudo: corridas.flatMap((c) => c.turnos.filter((x) => x.llamoAlModelo).map((x) => ({ caso: c.caso, rep: c.rep, turno: x.n, modo: x.modo, motivo: x.motivo, pasos: x.diagnostico.pasos }))) } : {}) }) + '\n' : textoDelInforme(m, proveedor, opciones) + (conversaciones ? '\n\n' + textoDeConversaciones(corridas) : '') + (crudo ? '\n\n' + textoDelCrudo(corridas) : '') + '\n');
    return m.violaciones.length === 0 ? 0 : 1;
  } catch (e) {
    const secretos = [credencial.clave, credencial.token];
    if (e instanceof ErrorDeUso) { d.error(`✗ ${limpiarSecretos(e.message, secretos)}\n`); return 2; }
    d.error(`✗ Fallo inesperado: ${limpiarSecretos(mensajeDe(e), secretos).slice(0, 300)}\n`);
    return 1;
  }
}

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esPrincipal) process.exitCode = await main(process.argv.slice(2));
