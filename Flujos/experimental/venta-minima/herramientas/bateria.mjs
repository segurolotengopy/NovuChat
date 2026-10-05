#!/usr/bin/env node
// BATERIA DE CONVERSACION DE «VENTA MINIMA v0» (Q'Taco), OFFLINE (05/10/2026).
//
// QUE ES. Corre conversaciones de `bateria-casos/*.json` por el FLUJO ARMADO de produccion (`venta-minima.qtaco.json`, 50 nodos;
// la bateria solo lo LEE: no se importa a n8n). Recorre su grafo nodo por nodo, en el orden del lienzo, con el motor de
// `captacion-minima/herramientas/bateria.mjs` (`crearMundo`): corre de verdad los nodos Code del JSON (con `new Function`, sin los
// globales de Node que el Code de n8n no tiene) y evalua los IF y los Set. Todo lo que sale a la red va a un DOBLE por nombre de
// nodo: la firma del receptor, la consola (un panel de ejemplo), el reporte, los medios, la transcripcion y la lectura del
// comprobante, el cotejo del servidor, los envios a WhatsApp y los avisos (registran el payload y devuelven un `wamid` sintetico;
// un caso puede hacer que Meta RECHACE un envio) y el cierre. SOLO «Extraer» es el modelo: en `--seco` responde la respuesta fija
// del turno; con `--vertex` llama a Vertex AI con el cuerpo EXACTO que arma el flujo.
//
// Se corre desde la raiz del repositorio:
//   node Flujos/experimental/venta-minima/herramientas/bateria.mjs --seco
//   node Flujos/experimental/venta-minima/herramientas/bateria.mjs --seco --casos A9,B1 --json
//   node Flujos/experimental/venta-minima/herramientas/bateria.mjs --vertex <proyecto> [--locacion us-central1] --n 3
//
// OPCIONES
//   --seco              NO llama a nada: el modelo es la respuesta fija de cada turno (`seco`). No lee ninguna clave ni toca la
//                       red; corre UNA vez por caso (n = 1 efectivo). Verifica lo determinista del flujo.
//   --vertex <proy>     usa Vertex AI con el token de `gcloud auth print-access-token` (la clave vive solo en n8n). El token viaja
//                       solo a `*-aiplatform.googleapis.com` y NUNCA se imprime. Hace falta `--seco` o `--vertex`.
//   --locacion <loc>    region de Vertex (us-central1 por defecto).
//   --n <1..20>         corridas por caso (1 por defecto; con --seco siempre 1).
//   --casos A9,B1,..    ids separados por coma (todos por defecto). `E8` (el negativo global) mira los textos de los casos que
//                       corren; solo se evalua si se corren todos los casos o si se nombra: sola, corre todos.
//   --json              salida de maquina: UN objeto JSON en la salida estandar (con la conversacion de cada corrida).
//   --tabla             la tabla en formato Markdown (para pegarla en un informe) en lugar de la tabla de texto.
//   --ayuda             este resumen.
// SALIDA: una tabla por escenario (id, titulo, corridas, aprobo/fallo y POR QUE, en una linea) y un resumen (turnos, llamadas al
// modelo, avisos, costo). Codigo de salida: 0 todo aprobo; 1 algun caso fallo; 2 uso incorrecto o casos mal formados.
// NO ESCRIBE ARCHIVOS (solo la salida estandar) y NUNCA imprime ni guarda un secreto.
//
// =================================================================================================================================
// FORMATO DE LOS CASOS (`bateria-casos/<seccion>.json`, uno por seccion de los escenarios: A, B, C, D, E, F)
// =================================================================================================================================
// { "seccion": "A", "casos": [ <caso>, … ], "negativoGlobal": { … } }   (esta ultima clave es opcional; ver «E8»)
//
// <caso> = {
//   "id": "A9",                     letras/numeros, unico entre todos los archivos
//   "titulo": "…",
//   "config": { "horario": "…" },   (opcional) valores de «Config base» que este caso cambia (ver CONFIG_VIVA y HORARIO_REAL)
//   "panel":  { … },                (opcional) lo que este caso cambia de la consola (mezcla de primer nivel sobre el panel base)
//   "perfil": "Carlos Pérez",       (opcional) el nombre de perfil de WhatsApp del cliente; "" = sin nombre de perfil
//   "reloj":  "2026-10-06T13:00:00-04:00",  (opcional) el instante del primer turno (con su desfase); por omision, martes 06/10/2026 13:00 La Paz
//   "estadoPrevio": [ <turno>, … ], (opcional) turnos que CORREN POR EL FLUJO antes de los turnos del caso. Es la forma preferida de
//                                   llegar a un estado («llega el carrito», «Hacer un pedido»): nada se siembra a mano en los datos
//                                   estaticos. Un turno previo puede llevar `esperado` como GUARDA: si falla, el caso dice que no
//                                   se logro el estado previo (y no mide lo que sigue).
//   "turnos": [ <turno>, … ],
//   "esperadoFinal": { "estado": { … } }   (opcional) lo que debe valer al terminar (mismo vocabulario que `esperado`)
//   "variantes": { "turno": 1, "frases": [ "texto", { "texto": "…", "audio": true, "seco": {…}, "esperado": {…} } ] }   (opcional) el MISMO caso se
//                                   corre una vez por frase, desde el mismo estado previo, poniendo cada frase como lo que dice el
//                                   turno `turno` (1 = el primero de `turnos`, de tipo texto o audio); una frase puede ser un audio
//                                   (`audio: true`: el texto es la transcripcion) y traer su propio `seco` y su propio `esperado` (se
//                                   mezcla sobre el del turno: sus claves mandan; `estado` se mezcla ruta por ruta). Cada una es una corrida
//                                   aparte (la tabla dice «k/N» y el «por qué» nombra la frase que fallo)
// }
// <turno> = {
//   "cliente": <lo que hace el cliente>,
//   "seco": <respuesta fija del modelo>,   solo si el turno llama a «Extraer» (pedido o reserva en texto libre): un objeto con los
//                                          campos que devolveria (se envia tal cual, sin completar) o un texto crudo. Con --vertex
//                                          se IGNORA: contesta el modelo de verdad. Sin `seco`, el modelo «falla» (error del servicio).
//   "lectura": …, "cotejo": …,             comprobante (ver abajo)
//   "avanzarMin": 1,                       minutos que avanza el reloj antes del turno (1 por omision, 0 en el primero)
//   "consola": { "panel": {…}, "precios": { "<idItem>": 60 }, "agotados": ["<idItem>"] }  cambios de la consola ANTES del turno
//   "meta": { "rechaza": ["Enviar aviso"] }  nodos de envio que Meta rechaza desde este turno (persiste; `[]` lo quita)
//   "esperado": { … }                      aserciones sobre ESTE turno (abajo)
// }
// <lo que hace el cliente> (`cliente`):
//   { "tipo": "texto", "texto": "…" }
//   { "tipo": "boton", "titulo": "Cambiar algo" }      toca un boton QUE EL FLUJO LE MOSTRO (se busca por titulo en lo recibido, de lo
//                                                       mas reciente a lo mas viejo: si no hay, el caso falla «no habia ese boton»)
//   { "tipo": "boton", "id": "p|cambiar", "titulo": "Cambiar algo" }   un id literal (un boton viejo o inventado)
//   { "tipo": "fila", "titulo": "…" } / { "tipo": "fila", "id": "…" }  una fila de una lista, igual que el boton
//   { "tipo": "audio", "transcripcion": "…" }         una nota de voz; `transcripcion` es lo que «Transcribir audio» devolveria
//   { "tipo": "imagen", "pie": "…" } / { "tipo": "documento", "pie": "…" }   foto o PDF (el comprobante, si hay un QR esperandolo)
//   { "tipo": "carrito", "items": [{ "id": "cat_x", "cantidad": 2 }], "entrega": "envio"|"retiro", "direccion": "…", "nota": "…" }
//                                                       el carrito de la pagina de la carta: entra por «Carrito del catálogo»; el
//                                                       nombre y el subtotal los pone la bateria con la carta del panel
//   `lectura` (comprobante): { "monto": "21.00", … } los datos que «Leer comprobante» devolveria, o "ilegible" (vacio). Por omision,
//                            la lectura correcta del importe del pedido pendiente.
//   `cotejo` (comprobante): "cuadra" | "no_cuadra" | "ilegible" | { resultado, diferencias: [...] } | { statusCode: 409, body: {…} };
//                            lo que el servidor contestaria. Por omision, "cuadra".
//
// <esperado> (todo lo que aparezca es una asercion; lo que no aparece no se mira):
//   "mensajes": 1 | { "min": 1, "max": 2 }          cuantos mensajes recibe el cliente en el turno
//   "textos":   ["regex", …]                         cada una debe aparecer en algun mensaje recibido (NUNCA texto exacto: el modelo
//                                                    real varia). Se prueba sobre el texto original y sobre el normalizado (sin
//                                                    tildes, en minusculas), siempre sin distinguir mayusculas
//   "textosNo": ["regex", …]                         ninguna puede aparecer
//   "botones": ["p|confirmar", …] / "botonesNo"      ids de botones o de filas presentes / ausentes
//   "titulos":  ["Confirmar pedido", …] / "titulosNo"   titulos de boton (regex) presentes / ausentes; cuentan los botones de
//                                                    respuesta, las filas de una lista y el boton de enlace («Escribir al local»)
//   "enlaces":  ["wa\\.me/59100000031"]               cada regex debe coincidir con la URL de algun boton de enlace recibido
//   "estado": { "paso": "pedido_confirmar", "entrega.entrega": "delivery", "carrito": { "vacio": false } }
//                                                    el estado del telefono en los datos estaticos, por ruta con puntos. Valores:
//                                                    un escalar (igual), { "regex": … }, { "noRegex": … }, { "vacio": bool },
//                                                    { "existe": bool }, { "longitud": n }, { "contiene": "…" }
//   "igualAntes": ["entrega", "carrito"]             rutas del estado que NO cambiaron respecto del comienzo del turno
//   "reporteQr": { "monto": 120, "referencia": { "noRegex": "^cat_" } }   lo que el flujo reporto al servidor en `qr_enviado` (campos
//                                                    `referencia`, `monto`…; mismas condiciones que `estado`); si no hubo QR, falla
//   "efectos": { "aviso": bool, "derivacion": bool, "qr": bool, "modelo": bool, "cierre": bool }
//                                                    aviso = salio un aviso al local; derivacion = la ruta del plan es `transferir`
//                                                    (aviso + boton para escribir directo); qr = se envio la imagen del QR;
//                                                    modelo = el flujo llamo a «Extraer»; cierre = se registro un cierre
//   "ruta": "regex"                                  la ruta que el plan reporta («pedido:qr», «transferir:…»)
//   "fallo": "Resumen del turno"                     un turno SIN `fallo` exige que ningun nodo falle; con el nombre, lo exige
//
// =================================================================================================================================
// E8 — EL NEGATIVO GLOBAL
// =================================================================================================================================
// `negativoGlobal: { "id": "E8", "titulo": "…", "frases": ["regex", …] }` (en `E.json`): una lista de frases que NINGUN mensaje que
// el cliente recibe, en NINGUN turno de NINGUN caso que corra, puede contener. Falla E8 aunque cada caso haya pasado. Los textos de
// respaldo (los que recibiria el cliente solo si Meta rechazara un mensaje interactivo) se revisan tambien, pero como AVISO.
//
// SUPUESTOS DECLARADOS (lo que esta bateria fija y por que)
//  - CONFIG_VIVA: «Config base» del JSON versionado trae `areasSinDelivery: "Bebidas"`, pero el flujo PUBLICADO desde el 05/10 la
//    tiene vacia (las bebidas se piden por delivery). Los casos corren con el valor vivo; el desvio queda en el informe.
//  - HORARIO_REAL: el de Q'Taco (lun–vie 12–16 y 18–22, sab–dom 12–22), con el reloj en un martes 06/10/2026 13:00 (La Paz). Un
//    caso que no pruebe el horario puede pedir 7×24 con `config.horario`.
//  - El COBRO es el REAL (el servidor manda `cobroReal` y la ficha del QR): tras un `qr_enviado` la bateria hace de servidor y abre
//    el cobro (pendiente, monto y referencia) para el turno siguiente.
//  - Todo dato es sintetico: telefonos de seis ceros seguidos, un negocio inventado en la forma, ninguna URL de un servicio real.
//
// COSTO: la TARIFA es la de la bateria de Captacion minima (se importa). En `--seco` no hay uso real; se estima desde el tamaño del
// cuerpo de cada llamada (≈ 4 caracteres por token de entrada y 150 tokens de salida) y se rotula como estimacion. No es una factura.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crearMundo, ErrorDeUso, leerCredencial, limpiarSecretos, llamarGemini, TARIFA } from '../../captacion-minima/herramientas/bateria.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RUTA_FLUJO = join(AQUI, '..', 'venta-minima.qtaco.json');
const CARPETA_CASOS = join(AQUI, 'bateria-casos');
const ARCHIVO_PENDIENTES = 'pendientes.json';

// ------------------------------------------------------------------------------------------------------- datos de ejemplo
// Un negocio inventado y telefonos sinteticos (seis ceros seguidos): ningun dato real. Martes 06/10/2026, 13:00 en La Paz.
export const PID = '100000000000042';  // phone_number_id del numero del negocio
export const CLIENTE = '59100000011';  // quien escribe
const AV1 = '59100000021';             // destinatario del aviso con rol «completo»
const AV2 = '59100000022';             // destinatario del aviso con rol «cocina»
const REC = '59100000031';             // recepcion: destino del boton «Escribir al local»
const QR_URL = 'https://qr.ejemplo.invalid/qtaco.png';
const AHORA = Date.UTC(2026, 9, 6, 17, 0, 0);
export const HORARIO_REAL = 'lun=12:00-16:00/18:00-22:00,mar=12:00-16:00/18:00-22:00,mie=12:00-16:00/18:00-22:00,jue=12:00-16:00/18:00-22:00,vie=12:00-16:00/18:00-22:00,sab=12:00-22:00,dom=12:00-22:00';
/** Lo que el flujo PUBLICADO tiene distinto del JSON versionado (ver los supuestos de la cabecera). */
const CONFIG_VIVA = { areasSinDelivery: '' };

const item = (id, nombre, precio, area) => ({ id, nombre, precio, area, descripcion: `Ejemplo: ${nombre}` });
export const CATALOGO = [
  item('cat_nachos', 'Nachos Supremos', 58, 'Entradas'),
  item('cat_queso', 'Queso Fundido', 75, 'Entradas'),
  item('cat_pastor3', 'Tacos al Pastor (orden de 3)', 45, 'Tacos'),
  item('cat_pastor1', 'Taco al Pastor (unidad)', 16, 'Tacos'),
  item('cat_birria3', 'Tacos de Birria (orden de 3)', 55, 'Tacos'),
  item('cat_birria1', 'Taco de Birria (unidad)', 21, 'Tacos'),
  item('cat_suizas', 'Enchiladas Suizas', 55, 'Platos fuertes'),
  item('cat_horchata', 'Horchata', 20, 'Bebidas'),
  item('cat_gaseosas', 'Gaseosas', 16, 'Bebidas'),
  item('cat_michelada', 'Michelada', 35, 'cocteleria'),
  item('cat_pils', 'Pils Chop 300 ml', 25, 'cervezas'),
  item('cat_rompope', 'Helado de Rompope', 23, 'postres'),
];

/** El panel que «Traer configuración» devolveria (la forma que esperan las suites del flujo). */
export function panelBase() {
  return {
    tenantId: 'qtaco',
    estadoComercio: 'activo',
    datosDelNegocio: { nombreNegocio: "Q'Taco Mexican Grill", direccion: 'Calle Ejemplo 123, zona Sur', direccionMaps: 'https://www.google.com/maps/place/ejemplo-qtaco' },
    operacion: { horarioAtencion: 'lunes a viernes de 12 a 16 y de 18 a 22; sábado y domingo de 12 a 22', moneda: 'BOB', numeroRecepcion: REC, prefijosPermitidos: ['591'] },
    voz: { nombreAsistente: '', nivelEmojis: 'pocos' },
    venta: { aceptaDelivery: true, aceptaRetiroEnLocal: true },
    catalogo: CATALOGO.map((x) => ({ ...x })),
    campanas: [],
    atencion: { estado: 'normal' },
    cobroReal: { nombreCuenta: 'Q TACO SRL', banco: 'Banco Ejemplo' },
    cobro: { activo: true, qr: { url: QR_URL } },
  };
}

// ------------------------------------------------------------------------------------------------------- utilidades
const clonar = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const objeto = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {});
const mensajeDe = (e) => (e instanceof Error ? e.message : e && typeof e === 'object' && typeof e.message === 'string' ? e.message : String(e));
const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const redondear = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : 0);
const suma = (a) => a.reduce((x, y) => x + y, 0);
const recorta = (t, n) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** Una expresion regular de un caso: siempre sin distinguir mayusculas. Una invalida es un error de uso (con el id del caso). */
function regexDe(texto, donde) {
  try { return new RegExp(String(texto), 'i'); } catch { throw new ErrorDeUso(`${donde}: la expresión regular «${recorta(texto, 40)}» no es válida.`); }
}
/** ¿Aparece? Se prueba sobre el texto original y sobre el normalizado (sin tildes, en minusculas; la expresion tambien sin tildes). */
const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const aparece = (re, texto) => re.test(texto) || new RegExp(sinTildes(re.source), 'i').test(norm(texto));

// ------------------------------------------------------------------------------------------------------- argumentos
const CON_VALOR = new Set(['--n', '--casos', '--vertex', '--locacion']);
const SIN_VALOR = new Set(['--seco', '--json', '--tabla', '--ayuda', '-h']);

/** Lee y valida los argumentos. Rechaza lo desconocido, los valores que faltan y los fuera de rango. */
export function leerArgumentos(argv) {
  const o = { seco: false, json: false, tabla: false, ayuda: false, n: 1, casos: null, vertex: null, locacion: 'us-central1' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (SIN_VALOR.has(a)) {
      if (a === '--seco') o.seco = true; else if (a === '--json') o.json = true; else if (a === '--tabla') o.tabla = true; else o.ayuda = true;
      continue;
    }
    if (!CON_VALOR.has(a)) throw new ErrorDeUso(`Opción desconocida: ${limpiarSecretos(a).slice(0, 40)}. Usa --ayuda.`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new ErrorDeUso(`Falta el valor de ${a}.`);
    i++;
    if (a === '--n') {
      if (!/^\d{1,3}$/.test(v) || Number(v) < 1 || Number(v) > 20) throw new ErrorDeUso('--n debe ser un entero de 1 a 20.');
      o.n = Number(v);
    } else if (a === '--casos') {
      const ids = v.split(',').map((x) => x.trim()).filter(Boolean);
      if (!ids.length || ids.some((x) => !/^[A-Za-z0-9_-]{1,12}$/.test(x))) throw new ErrorDeUso('--casos debe ser una lista de ids separados por coma (A9,B1).');
      o.casos = ids;
    } else if (a === '--vertex') {
      if (!/^[a-z][a-z0-9-]{4,60}$/.test(v)) throw new ErrorDeUso('--vertex debe ser un id de proyecto de Google Cloud (minúsculas, números y guiones).');
      o.vertex = v;
    } else if (a === '--locacion') {
      if (!/^[a-z0-9-]{3,30}$/.test(v)) throw new ErrorDeUso('--locacion no es una región válida.');
      o.locacion = v;
    }
  }
  if (o.seco && o.vertex) throw new ErrorDeUso('--seco no llama al modelo: no se combina con --vertex.');
  if (!o.ayuda && !o.seco && !o.vertex) throw new ErrorDeUso('Indica --seco (modelo simulado, sin red) o --vertex <proyecto> (modelo real). Usa --ayuda.');
  return o;
}

// ------------------------------------------------------------------------------------------------------- los casos
const TIPOS_CLIENTE = ['texto', 'boton', 'fila', 'audio', 'imagen', 'documento', 'carrito'];
const CLAVES_ESPERADO = ['mensajes', 'textos', 'textosNo', 'botones', 'botonesNo', 'titulos', 'titulosNo', 'enlaces', 'estado', 'reporteQr', 'igualAntes', 'efectos', 'ruta', 'fallo'];
const CLAVES_EFECTOS = ['aviso', 'derivacion', 'qr', 'modelo', 'cierre'];
const CLAVES_ESTADO_MATCH = ['regex', 'noRegex', 'vacio', 'existe', 'longitud', 'contiene'];

function validarEsperado(e, donde) {
  if (e === undefined) return;
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw new ErrorDeUso(`${donde}: «esperado» debe ser un objeto.`);
  for (const k of Object.keys(e)) if (!CLAVES_ESPERADO.includes(k)) throw new ErrorDeUso(`${donde}: «esperado» con una clave desconocida («${recorta(k, 30)}»).`);
  for (const k of ['textos', 'textosNo', 'botones', 'botonesNo', 'titulos', 'titulosNo', 'enlaces', 'igualAntes']) {
    if (e[k] !== undefined && (!Array.isArray(e[k]) || e[k].some((x) => typeof x !== 'string'))) throw new ErrorDeUso(`${donde}: «${k}» debe ser una lista de textos.`);
  }
  for (const k of ['textos', 'textosNo', 'titulos', 'titulosNo', 'enlaces']) for (const x of e[k] ?? []) regexDe(x, donde);
  if (e.ruta !== undefined) { if (typeof e.ruta !== 'string') throw new ErrorDeUso(`${donde}: «ruta» debe ser un texto.`); regexDe(e.ruta, donde); }
  if (e.mensajes !== undefined) {
    const m = e.mensajes;
    const ok = Number.isInteger(m) || (m && typeof m === 'object' && Object.keys(m).every((k) => ['min', 'max'].includes(k)) && Object.values(m).every(Number.isInteger));
    if (!ok) throw new ErrorDeUso(`${donde}: «mensajes» debe ser un entero o { min, max }.`);
  }
  if (e.fallo !== undefined && e.fallo !== null && typeof e.fallo !== 'string') throw new ErrorDeUso(`${donde}: «fallo» debe ser un nombre de nodo o null.`);
  if (e.efectos !== undefined) {
    if (!e.efectos || typeof e.efectos !== 'object' || Array.isArray(e.efectos)) throw new ErrorDeUso(`${donde}: «efectos» debe ser un objeto.`);
    for (const [k, v] of Object.entries(e.efectos)) {
      if (!CLAVES_EFECTOS.includes(k)) throw new ErrorDeUso(`${donde}: «efectos» con una clave desconocida («${recorta(k, 30)}»).`);
      if (typeof v !== 'boolean') throw new ErrorDeUso(`${donde}: «efectos.${k}» debe ser true o false.`);
    }
  }
  for (const clave of ['estado', 'reporteQr']) {
    if (e[clave] === undefined) continue;
    if (!e[clave] || typeof e[clave] !== 'object' || Array.isArray(e[clave])) throw new ErrorDeUso(`${donde}: «${clave}» debe ser un objeto de rutas.`);
    for (const [ruta, v] of Object.entries(e[clave])) {
      if (!/^[A-Za-z0-9_.]{1,80}$/.test(ruta)) throw new ErrorDeUso(`${donde}: la ruta de ${clave} «${recorta(ruta, 30)}» no es válida.`);
      if (v !== null && typeof v === 'object') {
        const claves = Object.keys(v);
        if (claves.length !== 1 || !CLAVES_ESTADO_MATCH.includes(claves[0])) throw new ErrorDeUso(`${donde}: «${clave}.${ruta}» con una condición desconocida.`);
        if (claves[0] === 'regex' || claves[0] === 'noRegex') regexDe(v[claves[0]], donde);
      }
    }
  }
}

function validarTurno(t, donde) {
  if (!t || typeof t !== 'object') throw new ErrorDeUso(`${donde}: el turno no es un objeto.`);
  const c = t.cliente;
  if (!c || typeof c !== 'object' || !TIPOS_CLIENTE.includes(c.tipo)) throw new ErrorDeUso(`${donde}: «cliente.tipo» desconocido o ausente.`);
  if (c.tipo === 'texto' && typeof c.texto !== 'string') throw new ErrorDeUso(`${donde}: falta el texto.`);
  if ((c.tipo === 'boton' || c.tipo === 'fila') && typeof c.id !== 'string' && typeof c.titulo !== 'string') throw new ErrorDeUso(`${donde}: falta el id o el titulo del ${c.tipo}.`);
  if (c.tipo === 'audio' && typeof c.transcripcion !== 'string') throw new ErrorDeUso(`${donde}: falta la transcripción.`);
  if (c.tipo === 'carrito' && (!Array.isArray(c.items) || !c.items.length || c.items.some((x) => !x || typeof x.id !== 'string'))) throw new ErrorDeUso(`${donde}: el carrito necesita «items» con id.`);
  if (t.seco !== undefined && typeof t.seco !== 'string' && (t.seco === null || typeof t.seco !== 'object' || Array.isArray(t.seco))) throw new ErrorDeUso(`${donde}: «seco» debe ser un objeto o un texto.`);
  if (t.avanzarMin !== undefined && (!Number.isInteger(t.avanzarMin) || t.avanzarMin < 0 || t.avanzarMin > 10080)) throw new ErrorDeUso(`${donde}: «avanzarMin» debe ser un entero de 0 a 10080.`);
  if (t.meta !== undefined && (!t.meta || !Array.isArray(t.meta.rechaza) || t.meta.rechaza.some((x) => typeof x !== 'string'))) throw new ErrorDeUso(`${donde}: «meta.rechaza» debe ser una lista de nodos.`);
  validarEsperado(t.esperado, donde);
}

/** Valida los casos de una seccion: uno mal escrito se rechaza con su id, nunca se corre a medias. */
export function validarCasos(datos, origen = 'casos') {
  const casos = datos?.casos;
  if (!Array.isArray(casos)) throw new ErrorDeUso(`${origen}: falta la lista «casos».`);
  for (const c of casos) {
    if (!c || typeof c.id !== 'string' || !/^[A-Za-z0-9_-]{1,12}$/.test(c.id)) throw new ErrorDeUso(`${origen}: un caso sin id válido.`);
    if (typeof c.titulo !== 'string' || !c.titulo) throw new ErrorDeUso(`${origen}: ${c.id} sin título.`);
    if (!Array.isArray(c.turnos) || !c.turnos.length) throw new ErrorDeUso(`${origen}: ${c.id} sin turnos.`);
    if (c.estadoPrevio !== undefined && !Array.isArray(c.estadoPrevio)) throw new ErrorDeUso(`${origen}: ${c.id}: «estadoPrevio» debe ser una lista de turnos.`);
    if (c.config !== undefined && (typeof c.config !== 'object' || c.config === null || Array.isArray(c.config))) throw new ErrorDeUso(`${origen}: ${c.id}: «config» debe ser un objeto.`);
    if (c.panel !== undefined && (typeof c.panel !== 'object' || c.panel === null || Array.isArray(c.panel))) throw new ErrorDeUso(`${origen}: ${c.id}: «panel» debe ser un objeto.`);
    if (c.perfil !== undefined && typeof c.perfil !== 'string') throw new ErrorDeUso(`${origen}: ${c.id}: «perfil» debe ser un texto.`);
    if (c.reloj !== undefined && (typeof c.reloj !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?[+-]\d{2}:\d{2}$/.test(c.reloj) || Number.isNaN(Date.parse(c.reloj)))) throw new ErrorDeUso(`${origen}: ${c.id}: «reloj» debe ser una fecha ISO con desfase (2026-10-06T13:00:00-04:00).`);
    for (const [i, t] of (c.estadoPrevio ?? []).entries()) validarTurno(t, `${c.id}, previo ${i + 1}`);
    for (const [i, t] of c.turnos.entries()) validarTurno(t, `${c.id}, turno ${i + 1}`);
    validarEsperado(c.esperadoFinal, `${c.id}, esperadoFinal`);
    if (c.variantes !== undefined) {
      const v = c.variantes;
      if (!v || !Number.isInteger(v.turno) || v.turno < 1 || v.turno > c.turnos.length || !Array.isArray(v.frases) || !v.frases.length) throw new ErrorDeUso(`${origen}: ${c.id}: «variantes» necesita un turno válido y una lista de frases.`);
      if (!['texto', 'audio'].includes(c.turnos[v.turno - 1].cliente.tipo)) throw new ErrorDeUso(`${origen}: ${c.id}: el turno de «variantes» debe ser de tipo texto o audio.`);
      for (const x of v.frases) {
        if (typeof x === 'string') continue;
        if (x && x.esperado !== undefined) validarEsperado(x.esperado, `${c.id}, variante «${recorta(x.texto, 30)}»`);
        if (!x || typeof x.texto !== 'string' || (x.audio !== undefined && typeof x.audio !== 'boolean') || (x.seco !== undefined && typeof x.seco !== 'string' && (x.seco === null || typeof x.seco !== 'object'))) throw new ErrorDeUso(`${origen}: ${c.id}: una frase de «variantes» mal formada.`);
      }
    }
  }
  const g = datos.negativoGlobal;
  if (g !== undefined) {
    if (!g || typeof g.id !== 'string' || !/^[A-Za-z0-9_-]{1,12}$/.test(g.id) || !Array.isArray(g.frases) || !g.frases.length || g.frases.some((x) => typeof x !== 'string')) {
      throw new ErrorDeUso(`${origen}: «negativoGlobal» necesita id y una lista de frases.`);
    }
    for (const x of g.frases) regexDe(x, `${origen}, negativoGlobal`);
  }
  return casos;
}

/** Lee todas las secciones de `bateria-casos/` (menos la lista de pendientes): casos en el orden de los archivos y el negativo global. */
export function leerCasosDeCarpeta(carpeta = CARPETA_CASOS) {
  const archivos = readdirSync(carpeta).filter((f) => f.endsWith('.json') && f !== ARCHIVO_PENDIENTES).sort();
  const casos = [];
  let global = null;
  const ids = new Set();
  for (const f of archivos) {
    let datos;
    try { datos = JSON.parse(readFileSync(join(carpeta, f), 'utf8')); } catch { throw new ErrorDeUso(`${f}: no es un JSON válido.`); }
    for (const c of validarCasos(datos, f)) {
      if (ids.has(c.id)) throw new ErrorDeUso(`${f}: id repetido ${c.id}.`);
      ids.add(c.id);
      casos.push(c);
    }
    if (datos.negativoGlobal) {
      if (global && global.id !== datos.negativoGlobal.id) throw new ErrorDeUso(`${f}: hay dos negativos globales con ids distintos.`);
      global = { id: datos.negativoGlobal.id, titulo: String(datos.negativoGlobal.titulo ?? ''), frases: [...(global?.frases ?? []), ...datos.negativoGlobal.frases] };
    }
  }
  if (global) {
    if (ids.has(global.id)) throw new ErrorDeUso(`el id ${global.id} del negativo global se repite con un caso.`);
  }
  return { casos, global };
}

// ------------------------------------------------------------------------------------------------------- lo que recibe el cliente
/** Los textos visibles de un payload de la Graph API: cuerpo, encabezado, pie, titulos de boton y fila, boton de enlace y pie de imagen. */
export function piezasDeEnvio(p) {
  const piezas = [];
  const t = p?.type;
  if (t === 'text') piezas.push(String(objeto(p.text).body ?? ''));
  else if (t === 'image' || t === 'document') piezas.push(String(objeto(p[t]).caption ?? ''));
  else if (t === 'interactive') {
    const i = objeto(p.interactive);
    const h = objeto(i.header);
    if (h.text) piezas.push(String(h.text));
    if (h.image?.caption) piezas.push(String(h.image.caption));
    piezas.push(String(objeto(i.body).text ?? ''));
    if (objeto(i.footer).text) piezas.push(String(i.footer.text));
    const a = objeto(i.action);
    for (const b of a.buttons ?? []) piezas.push(String(objeto(b.reply).title ?? ''));
    for (const s of a.sections ?? []) for (const f of s.rows ?? []) { piezas.push(String(f.title ?? '')); if (f.description) piezas.push(String(f.description)); }
    if (objeto(a.parameters).display_text) piezas.push(String(a.parameters.display_text));
    if (a.button) piezas.push(String(a.button));
  }
  return piezas.filter((x) => x !== '');
}
const botonesDe = (p) => (objeto(objeto(p.interactive).action).buttons ?? []).map((b) => ({ id: String(objeto(b.reply).id ?? ''), title: String(objeto(b.reply).title ?? '') }));
const enlacesDe = (p) => (objeto(objeto(p.interactive).action).name === 'cta_url' ? [{ title: String(objeto(objeto(p.interactive).action.parameters).display_text ?? ''), url: String(objeto(objeto(p.interactive).action.parameters).url ?? '') }] : []);
const filasDe = (p) => (objeto(objeto(p.interactive).action).sections ?? []).flatMap((s) => s.rows ?? []).map((f) => ({ id: String(f.id ?? ''), title: String(f.title ?? '') }));

// ------------------------------------------------------------------------------------------------------- una conversacion
const mensajeDeMeta = (t, wamid, ctx) => {
  const c = t.cliente;
  const base = { from: CLIENTE, id: wamid, timestamp: '1' };
  if (c.tipo === 'texto') return { ...base, type: 'text', text: { body: c.texto } };
  if (c.tipo === 'boton') return { ...base, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: ctx.idDe(c), title: c.titulo ?? ctx.idDe(c) } } };
  if (c.tipo === 'fila') return { ...base, type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: ctx.idDe(c), title: c.titulo ?? ctx.idDe(c) } } };
  if (c.tipo === 'audio') return { ...base, type: 'audio', audio: { id: 'media-aud', mime_type: 'audio/ogg; codecs=opus', voice: true } };
  if (c.tipo === 'imagen') return { ...base, type: 'image', image: { id: 'media-img', mime_type: 'image/jpeg', ...(c.pie ? { caption: c.pie } : {}) } };
  if (c.tipo === 'documento') return { ...base, type: 'document', document: { id: 'media-doc', mime_type: 'application/pdf', ...(c.pie ? { caption: c.pie } : {}) } };
  throw new Error('tipo de turno desconocido: ' + c.tipo);
};

/** La entrega firmada del receptor, con el `value` de Meta adentro (la forma de `Entrega del receptor`). */
const entregaDelReceptor = (msg, wamid, n, perfil) => ({
  headers: { 'x-aab1-signature': 'v1=abc', 'x-aab1-timestamp': '1', 'x-aab1-delivery-id': `entrega-${wamid}-${n}`, 'x-aab1-attempt': '1' },
  body: {
    field: 'messages',
    value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '59100000001', phone_number_id: PID },
      contacts: [{ profile: { name: perfil }, wa_id: CLIENTE }],
      messages: [msg],
    },
  },
});

/** El carrito que manda el servidor de NovuChat desde la pagina de la carta. El nombre y el subtotal salen de la carta del panel. */
function entregaDelCarrito(c, panel, reloj, n) {
  const carta = new Map(panel.catalogo.map((x) => [x.id, x]));
  const items = c.items.map((x) => {
    const e = carta.get(x.id);
    const cantidad = Number(x.cantidad) || 1;
    return { id: x.id, nombre: e ? e.nombre : x.nombre ?? 'producto', cantidad, subtotal: (e && Number.isFinite(e.precio) ? e.precio : 0) * cantidad };
  });
  const envio = c.entrega === 'envio';
  return {
    headers: { 'x-novuchat-numero': PID, 'x-novuchat-timestamp': String(reloj), 'x-novuchat-signature': `sha256=${'0'.repeat(64)}` },
    body: {
      tipo: 'carrito', tenantId: 'qtaco', telefono: CLIENTE, accion: 'responder', pedidoId: c.pedidoId ?? `p-bat-${n}`, conversacionId: `c-bat-${n}`,
      ventanaAbierta: true, items, total: suma(items.map((x) => x.subtotal)), moneda: 'Bs',
      entrega: envio ? 'envio' : 'retiro', costoEnvio: 0, direccion: envio ? String(c.direccion ?? '') : '', nota: String(c.nota ?? ''),
    },
  };
}

const respuestaDeGemini = (texto) => ({ candidates: [{ content: { parts: [{ text: texto }] } }] });
const aceptado = (n) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.OUT${n}` }] });
const rechazado = () => ({ error: { message: 'Meta rechazó el envío (simulado)', code: 131000 } });

/** El valor de una ruta con puntos dentro de un objeto (los numeros indexan arreglos). */
function valorEn(o, ruta) {
  let v = o;
  for (const p of ruta.split('.')) {
    if (v === null || v === undefined || typeof v !== 'object') return undefined;
    v = v[p];
  }
  return v;
}
const estaVacio = (v) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/** ¿El valor cumple la condicion de una ruta de `estado`? Devuelve '' si cumple, o por que no. */
function condicionDeEstado(v, cond) {
  const mostrar = (x) => recorta(typeof x === 'string' ? `«${x}»` : JSON.stringify(x), 80);
  if (cond === null || typeof cond !== 'object') return Object.is(v, cond) || v === cond ? '' : `vale ${mostrar(v)} y se esperaba ${mostrar(cond)}`;
  const [k] = Object.keys(cond);
  const x = cond[k];
  if (k === 'regex') return aparece(regexDe(x, 'estado'), String(v ?? '')) ? '' : `vale ${mostrar(v)} y no coincide con /${x}/`;
  if (k === 'noRegex') return !aparece(regexDe(x, 'estado'), String(v ?? '')) ? '' : `vale ${mostrar(v)} y coincide con /${x}/`;
  if (k === 'vacio') return estaVacio(v) === x ? '' : `${x ? 'debía estar vacío' : 'no debía estar vacío'} y vale ${mostrar(v)}`;
  if (k === 'existe') return (v !== undefined && v !== null) === x ? '' : `${x ? 'debía existir' : 'no debía existir'} y vale ${mostrar(v)}`;
  if (k === 'longitud') return Array.isArray(v) && v.length === x ? '' : `su longitud es ${Array.isArray(v) ? v.length : 'n/d'} y se esperaba ${x}`;
  return String(v ?? '').includes(String(x)) ? '' : `vale ${mostrar(v)} y no contiene «${x}»`;
}

/**
 * Evalua el `esperado` de un turno contra lo que paso. `r` = { mensajes (los del cliente: {tipo, piezas, botones, filas}), estado,
 * estadoAntes, avisos, ruta, qr, modelo, cierre, fallo }. Devuelve la lista de incumplimientos (textos de una linea); vacia si cumple.
 */
export function evaluarEsperado(e, r, donde = 'esperado') {
  const f = [];
  if (!e) return f;
  const visible = r.mensajes.map((m) => m.piezas.join(' '));
  const todo = visible.join(' ¦ ');
  const recibido = () => `recibió: ${recorta(todo || '(nada)', 160)}`;
  if (e.mensajes !== undefined) {
    const n = r.mensajes.length;
    const { min, max } = Number.isInteger(e.mensajes) ? { min: e.mensajes, max: e.mensajes } : e.mensajes;
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) f.push(`esperaba ${Number.isInteger(e.mensajes) ? e.mensajes : JSON.stringify(e.mensajes)} mensaje(s) y recibió ${n} (${recorta(todo || 'nada', 120)})`);
  }
  for (const x of e.textos ?? []) if (!visible.some((v) => aparece(regexDe(x, donde), v))) f.push(`esperaba un texto con /${x}/; ${recibido()}`);
  for (const x of e.textosNo ?? []) { const v = visible.find((y) => aparece(regexDe(x, donde), y)); if (v !== undefined) f.push(`no debía aparecer /${x}/ y apareció en: ${recorta(v, 160)}`); }
  const ids = [...r.mensajes.flatMap((m) => m.botones.map((b) => b.id)), ...r.mensajes.flatMap((m) => m.filas.map((b) => b.id))];
  const titulos = [...r.mensajes.flatMap((m) => m.botones.map((b) => b.title)), ...r.mensajes.flatMap((m) => m.filas.map((b) => b.title)), ...r.mensajes.flatMap((m) => (m.enlaces ?? []).map((b) => b.title))];
  const urls = r.mensajes.flatMap((m) => (m.enlaces ?? []).map((b) => b.url));
  for (const x of e.enlaces ?? []) if (!urls.some((u) => aparece(regexDe(x, donde), u))) f.push(`esperaba un botón de enlace con /${x}/; había: ${urls.join(', ') || '(ninguno)'}`);
  for (const x of e.botones ?? []) if (!ids.includes(x)) f.push(`esperaba el botón o fila «${x}»; había: ${ids.join(', ') || '(ninguno)'}`);
  for (const x of e.botonesNo ?? []) if (ids.includes(x)) f.push(`no debía haber el botón o fila «${x}»`);
  for (const x of e.titulos ?? []) if (!titulos.some((y) => aparece(regexDe(x, donde), y))) f.push(`esperaba un botón con título /${x}/; había: ${titulos.join(' | ') || '(ninguno)'}`);
  for (const x of e.titulosNo ?? []) { const y = titulos.find((z) => aparece(regexDe(x, donde), z)); if (y !== undefined) f.push(`no debía haber un botón con título /${x}/ y hay «${y}»`); }
  for (const [ruta, cond] of Object.entries(e.estado ?? {})) {
    const por = condicionDeEstado(valorEn(r.estado, ruta), cond);
    if (por) f.push(`estado.${ruta}: ${por}`);
  }
  if (e.reporteQr !== undefined) {
    if (r.reporteQr === undefined) f.push('se esperaba el reporte `qr_enviado` al servidor y el flujo no lo hizo');
    else for (const [ruta, cond] of Object.entries(e.reporteQr)) { const por = condicionDeEstado(valorEn(r.reporteQr, ruta), cond); if (por) f.push(`reporte qr_enviado.${ruta}: ${por}`); }
  }
  for (const ruta of e.igualAntes ?? []) {
    const antes = JSON.stringify(valorEn(r.estadoAntes, ruta) ?? null);
    const despues = JSON.stringify(valorEn(r.estado, ruta) ?? null);
    if (antes !== despues) f.push(`estado.${ruta} debía quedar igual y cambió: ${recorta(antes, 60)} → ${recorta(despues, 60)}`);
  }
  const ef = e.efectos ?? {};
  const real = { aviso: r.avisos > 0, derivacion: /^transferir/.test(r.ruta), qr: r.qr, modelo: r.modelo > 0, cierre: r.cierre > 0 };
  for (const k of CLAVES_EFECTOS) if (ef[k] !== undefined && ef[k] !== real[k]) f.push(`efecto «${k}»: se esperaba ${ef[k] ? 'que ocurriera' : 'que NO ocurriera'} y ${real[k] ? 'ocurrió' : 'no ocurrió'}${k === 'derivacion' ? ` (ruta «${r.ruta || 'ninguna'}»)` : ''}`);
  if (e.ruta !== undefined && !aparece(regexDe(e.ruta, donde), r.ruta)) f.push(`ruta «${r.ruta || '(ninguna)'}» no coincide con /${e.ruta}/`);
  const falloEsperado = e.fallo ?? null;
  const falloReal = r.fallo ? r.fallo.nodo : null;
  if (falloEsperado !== falloReal) f.push(falloReal ? `falló el nodo «${falloReal}»: ${r.fallo.mensaje}` : `se esperaba que fallara «${falloEsperado}» y no falló`);
  return f;
}

/** Una corrida (un caso, una repeticion): un mundo nuevo, con su estado, su consola y su reloj. */
export async function correrCaso({ caso, rep, flujo, opciones, credencial, deps }) {
  const panel = Object.assign(panelBase(), clonar(caso.panel ?? {}));
  const rechaza = new Set();
  const turnoActual = { t: null };
  let captura = null;
  let seq = 0;
  const nodoExtraer = flujo.nodes.find((n) => n.name === 'Extraer');

  const envio = (nodo) => (ll) => {
    const payload = ll.cuerpo ?? {};
    const rec = rechaza.has(nodo);
    const respuesta = rec ? rechazado() : aceptado(++seq);
    captura[nodo === 'Enviar a WhatsApp' || nodo === 'Enviar respaldo' ? 'mensajes' : 'avisos'].push({ nodo, a: String(payload.to ?? ''), tipo: String(payload.type ?? ''), payload, ok: !rec });
    return respuesta;
  };
  const dobles = {
    'Verificar firma con el receptor': (ll) => ({ valido: !String(ll.cuerpo?.firma ?? '').includes('mala'), deliveryId: ll.cuerpo?.deliveryId }),
    'Aceptar (200)': (ll) => { captura.respuestasWebhook.push(200); return ll.item; },
    'Rechazar (401)': (ll) => { captura.respuestasWebhook.push(401); return ll.item; },
    // `removeDuplicates`: la memoria de «ya visto» vive en la corrida y sobrevive entre turnos.
    'Descartar repetidos': (() => {
      const vistos = new Set();
      return (ll) => { const k = String(ll.parametros.dedupeValue ?? ''); if (!k || vistos.has(k)) return []; vistos.add(k); return ll.item; };
    })(),
    'Traer configuración': () => ({ statusCode: 200, body: clonar(panel) }),
    'Reportar mensaje (entrante)': (ll) => { captura.ingesta.push(ll.cuerpo ?? {}); return { ok: true }; },
    'Reportar mensaje (saliente)': (ll) => { captura.ingesta.push(ll.cuerpo ?? {}); return { ok: true }; },
    'Registrar cierre': (ll) => { captura.cierre.push(ll.cuerpo ?? {}); return { ok: true }; },
    'Obtener URL del medio': () => ({ id: 'm', url: 'https://medios.ejemplo.invalid/m', mime_type: 'image/jpeg', file_size: 100_000 }),
    'Descargar medio': () => ({}),
    'Transcribir audio': () => ({ content: { parts: [{ text: String(turnoActual.t?.cliente?.transcripcion ?? '') }] } }),
    'Leer comprobante (imagen)': () => lecturaDe(turnoActual.t, captura),
    'Leer comprobante (PDF)': () => lecturaDe(turnoActual.t, captura),
    'Cotejar en el servidor': () => cotejoDe(turnoActual.t),
    Extraer: async (ll) => {
      captura.extraer++;
      const bytes = JSON.stringify(ll.cuerpo ?? {}).length;
      captura.extraerBytes += bytes;
      if (opciones.seco) {
        const s = turnoActual.t?.seco;
        return s === undefined ? { error: { message: 'sin respuesta fija declarada para este turno (simulado)', httpCode: '503' } }
          : typeof s === 'string' ? respuestaDeGemini(s) : respuestaDeGemini(JSON.stringify(s));
      }
      const r = await llamarGemini({ cuerpo: ll.cuerpo, urlDelNodo: ll.url, credencial, opciones, deps, nodo: nodoExtraer });
      const u = objeto(r.json.usageMetadata);
      if (!r.fallo) captura.usos.push({ entrada: Number(u.promptTokenCount) || 0, salida: Number(u.candidatesTokenCount) || 0, cacheados: Number(u.cachedContentTokenCount) || 0, razonamiento: Number(u.thoughtsTokenCount) || 0, ms: r.ms });
      return r.json;
    },
    'Enviar a WhatsApp': envio('Enviar a WhatsApp'),
    'Enviar respaldo': envio('Enviar respaldo'),
    'Enviar aviso': envio('Enviar aviso'),
    'Aviso de respaldo': envio('Aviso de respaldo'),
  };
  // Lo que «Leer comprobante» devolveria: por omision, la lectura correcta del importe del cobro pendiente.
  function lecturaDe(t, cap) {
    const l = t?.lectura;
    if (l === 'ilegible') return {};
    const monto = Number(panel.cobro?.monto);
    const leido = typeof l === 'object' && l !== null ? l : { monto: Number.isFinite(monto) ? monto.toFixed(2) : '0.00' };
    cap.lecturas++;
    return { content: { parts: [{ text: JSON.stringify({ cuentaDestino: '***4321', nombreCuenta: 'Q TACO SRL', fecha: '06/10/2026', hora: '13:05', banco: 'Banco Ejemplo', ...leido }) }] } };
  }
  function cotejoDe(t) {
    const c = t?.cotejo ?? 'cuadra';
    if (typeof c === 'string') return { statusCode: 200, body: { resultado: c, diferencias: [], cierreId: 'venta_bateria' } };
    if (c.statusCode !== undefined) return { statusCode: c.statusCode, body: c.body ?? {} };
    return { statusCode: 200, body: { cierreId: 'venta_bateria', diferencias: [], ...c } };
  }

  const inicio = caso.reloj ? Date.parse(caso.reloj) : AHORA;
  const mundo = crearMundo({
    flujo, dobles, ahoraMs: inicio,
    configBase: {
      phoneNumberIdEsperado: PID, respaldoNumeroRecepcion: REC, destinatariosAviso: `completo:${AV1},cocina:${AV2}`,
      horario: HORARIO_REAL, ...CONFIG_VIVA, ...(caso.config ?? {}),
    },
  });

  const estadoDe = () => clonar(objeto(objeto(objeto(mundo.sd.ventaMinima).estados)[CLIENTE]));
  const corrida = { caso: caso.id, rep, ok: true, fallas: [], turnos: 0, llamadasModelo: 0, lecturas: 0, avisos: 0, mensajes: 0, usos: [], bytesModelo: 0, conversacion: [], textos: [], respaldos: [], previoLogrado: true };
  const vistos = []; // lo que el cliente recibio, por turno: [{id, title}] de botones y filas (para tocarlos por titulo)
  let reloj = inicio;
  let n = 0;

  const todos = [...(caso.estadoPrevio ?? []).map((t) => ({ t, previo: true })), ...caso.turnos.map((t) => ({ t, previo: false }))];
  for (const { t, previo } of todos) {
    n++;
    const donde = `${previo ? 'previo ' : 'turno '}${n}`;
    const c = t.cliente;
    // Cambios de la consola antes del turno.
    if (t.consola) {
      Object.assign(panel, clonar(t.consola.panel ?? {}));
      for (const [id, precio] of Object.entries(t.consola.precios ?? {})) { const x = panel.catalogo.find((y) => y.id === id); if (x) x.precio = precio; }
      for (const id of t.consola.agotados ?? []) { const x = panel.catalogo.find((y) => y.id === id); if (x) x.agotado = true; }
    }
    if (t.meta) { rechaza.clear(); for (const x of t.meta.rechaza) rechaza.add(x); }
    // El boton o la fila se busca por titulo entre lo que el cliente recibio, de lo mas reciente a lo mas viejo.
    const idDe = (cc) => {
      if (typeof cc.id === 'string') return cc.id;
      for (let i = vistos.length - 1; i >= 0; i--) {
        const h = vistos[i].find((x) => norm(x.title) === norm(cc.titulo));
        if (h) return h.id;
      }
      throw new ErrorSinBoton(cc.titulo);
    };
    captura = { mensajes: [], avisos: [], ingesta: [], cierre: [], respuestasWebhook: [], extraer: 0, extraerBytes: 0, usos: [], lecturas: 0 };
    turnoActual.t = t;
    const avanzar = n === 1 ? 0 : (t.avanzarMin ?? 1);
    reloj += avanzar * 60_000;
    const estadoAntes = estadoDe();
    const wamid = `wamid.BAT${caso.id}.${rep}.${n}`;
    let r;
    try {
      if (c.tipo === 'carrito') r = await mundo.turno(entregaDelCarrito(c, panel, reloj, n), avanzar, 'Carrito del catálogo');
      else r = await mundo.turno(entregaDelReceptor(mensajeDeMeta(t, wamid, { idDe }), wamid, n, caso.perfil ?? 'Carlos Pérez'), avanzar, 'Entrega del receptor');
    } catch (e) {
      if (e instanceof ErrorSinBoton) {
        corrida.fallas.push({ turno: n, previo, dicho: `(toca «${e.titulo}»)`, por: `no había un botón «${e.titulo}» entre lo que el cliente recibió` });
        corrida.conversacion.push({ turno: n, previo, dicho: `(toca «${e.titulo}»)`, recibio: [], ruta: '', avisos: 0 });
        break;
      }
      throw e;
    }
    // Lo que se recibio.
    const alCliente = captura.mensajes.filter((m) => m.a === CLIENTE);
    const mensajes = alCliente.map((m) => ({ tipo: m.tipo, piezas: piezasDeEnvio(m.payload), botones: botonesDe(m.payload), filas: filasDe(m.payload), enlaces: enlacesDe(m.payload), ok: m.ok, nodo: m.nodo }));
    const entregados = mensajes.filter((m) => m.ok);
    const seleccionables = entregados.flatMap((m) => [...m.botones, ...m.filas]);
    if (seleccionables.length) vistos.push(seleccionables);
    const avisosSalidos = captura.avisos.filter((a) => a.ok && a.nodo === 'Enviar aviso').length;
    const resumen = objeto(objeto((r.porNodo['Resumen del turno'] ?? [])[0]).resumen);
    const plan = (r.porNodo['Plan del turno'] ?? [])[0] ?? {};
    const ruta = String(resumen.ruta ?? plan.ruta ?? '');
    const qr = alCliente.some((m) => m.ok && m.tipo === 'image');
    const estado = estadoDe();
    // El servidor abre el cobro cuando el flujo reporta `qr_enviado` (referencia y monto): el turno siguiente lo ve pendiente.
    const abierto = captura.ingesta.find((x) => x.evento === 'qr_enviado');
    const reporteQr = abierto ? clonar(abierto) : undefined;
    if (abierto && panel.cobro) panel.cobro = { activo: true, qr: { url: QR_URL }, pendiente: true, monto: Number(abierto.monto), pedido: String(abierto.referencia ?? '') };

    corrida.turnos++;
    corrida.llamadasModelo += captura.extraer;
    corrida.bytesModelo += captura.extraerBytes;
    corrida.lecturas += captura.lecturas;
    corrida.avisos += avisosSalidos;
    corrida.mensajes += entregados.length;
    corrida.usos.push(...captura.usos);
    const dicho = c.tipo === 'texto' ? c.texto : c.tipo === 'audio' ? `(audio) ${c.transcripcion}` : c.tipo === 'carrito' ? `(carrito) ${c.items.map((x) => `${x.cantidad ?? 1}× ${x.id}`).join(', ')}` : c.tipo === 'imagen' || c.tipo === 'documento' ? `(${c.tipo})${c.pie ? ' ' + c.pie : ''}` : `(toca) ${c.titulo ?? c.id}`;
    for (const m of entregados) corrida.textos.push({ turno: n, previo, texto: m.piezas.join(' ') });
    for (const it of r.porNodo['Armar mensajes'] ?? []) if (it && it.destino === 'cliente' && typeof it.respaldo === 'string' && it.respaldo) corrida.respaldos.push({ turno: n, previo, texto: it.respaldo });
    corrida.conversacion.push({
      turno: n, previo, dicho, ruta, avisos: avisosSalidos, qr,
      recibio: mensajes.map((m) => ({ tipo: m.tipo, texto: m.piezas.join(' ¦ '), botones: m.botones.map((b) => b.id), filas: m.filas.map((b) => b.id), enlaces: m.enlaces.map((b) => b.url) })),
    });

    const fallas = evaluarEsperado(t.esperado, {
      mensajes: entregados, estado, estadoAntes, avisos: avisosSalidos, ruta, qr, modelo: captura.extraer, cierre: captura.cierre.length,
      fallo: r.fallo, reporteQr,
    }, `${caso.id}, ${donde}`);
    // Un fallo de nodo que el turno no esperaba tambien cuenta aunque el turno no declare `esperado`.
    if (!t.esperado && r.fallo) fallas.push(`falló el nodo «${r.fallo.nodo}»: ${r.fallo.mensaje}`);
    for (const por of fallas) corrida.fallas.push({ turno: n, previo, dicho, por });
    if (previo && fallas.length) { corrida.previoLogrado = false; break; }
  }
  if (corrida.previoLogrado && !corrida.fallas.some((x) => /no había un botón/.test(x.por)) && caso.esperadoFinal) {
    const estado = estadoDe();
    for (const por of evaluarEsperado(caso.esperadoFinal, { mensajes: [], estado, estadoAntes: estado, avisos: 0, ruta: '', qr: false, modelo: 0, cierre: 0, fallo: null }, `${caso.id}, esperadoFinal`)) {
      corrida.fallas.push({ turno: n, previo: false, dicho: '(al terminar)', por });
    }
  }
  corrida.ok = corrida.fallas.length === 0;
  corrida.estadoFinal = estadoDe();
  return corrida;
}
class ErrorSinBoton extends Error {
  constructor(titulo) { super(`no había un botón «${titulo}»`); this.titulo = titulo; }
}

/** Un caso con `variantes` se vuelve UNO por frase (cada una desde el mismo estado previo); sin ellas, el caso tal cual. */
export function expandirVariantes(caso) {
  const v = caso.variantes;
  if (!v) return [{ etiqueta: '', caso }];
  return v.frases.map((x, i) => {
    const texto = typeof x === 'string' ? x : x.texto;
    const turnos = clonar(caso.turnos);
    const t = turnos[v.turno - 1];
    const comoAudio = typeof x === 'object' && x.audio !== undefined ? x.audio : t.cliente.tipo === 'audio';
    t.cliente = comoAudio ? { tipo: 'audio', transcripcion: texto } : { tipo: 'texto', texto };
    if (typeof x === 'object' && x.seco !== undefined) t.seco = x.seco;
    if (typeof x === 'object' && x.esperado !== undefined) {
      const base = t.esperado ?? {};
      t.esperado = { ...base, ...x.esperado, ...(base.estado || x.esperado.estado ? { estado: { ...base.estado, ...x.esperado.estado } } : {}) };
    }
    return { etiqueta: `v${i + 1}`, caso: { ...caso, turnos, variantes: undefined } };
  });
}

// ------------------------------------------------------------------------------------------------------- el negativo global (E8)
/**
 * Las frases prohibidas que aparecen en lo que el cliente RECIBE, en todos los turnos de todas las corridas. Devuelve [{ caso, rep, corrida, turno, frase, texto }].
 * `corridas[i].textos` = [{ turno, previo, texto }].
 */
export function revisarNegativoGlobal(frases, corridas, campo = 'textos') {
  const out = [];
  const res = frases.map((f) => [f, regexDe(f, 'negativo global')]);
  corridas.forEach((c, corrida) => {
    for (const t of c[campo] ?? []) {
      for (const [f, re] of res) if (aparece(re, t.texto)) out.push({ caso: c.caso, rep: c.rep, corrida, turno: t.turno, frase: f, texto: recorta(t.texto, 160) });
    }
  });
  return out;
}

// ------------------------------------------------------------------------------------------------------- costo
const costoDe = (u) => ((u.entrada - u.cacheados) * TARIFA.entrada + u.cacheados * TARIFA.cacheado + (u.salida + u.razonamiento) * TARIFA.salida) / 1e6;
const SUPUESTO_TARIFA = `USD ${TARIFA.entrada} por millón de tokens de entrada, USD ${TARIFA.salida} de salida y USD ${TARIFA.cacheado} de cacheados (la tarifa de la batería de Captación mínima, calibrada el 01/10/2026). No es una factura.`;
const SALIDA_ESTIMADA = 150; // tokens de salida por llamada a «Extraer» (un JSON de líneas o de reserva)

// ------------------------------------------------------------------------------------------------------- salida
function informe({ opciones, flujo, casos, corridas, global, pendientes }) {
  const porCaso = casos.map((c) => {
    const cs = corridas.filter((x) => x.caso === c.id);
    const fallaron = cs.filter((x) => !x.ok);
    const primera = fallaron[0]?.fallas[0];
    return {
      id: c.id, titulo: c.titulo, corridas: cs.length, aprobaron: cs.length - fallaron.length, ok: fallaron.length === 0,
      por: primera ? `T${primera.turno}${primera.previo ? ' (previo)' : ''} «${recorta(primera.dicho, 40)}»: ${primera.por}${fallaron[0].fallas.length > 1 ? ` (+${fallaron[0].fallas.length - 1} más)` : ''}` : '',
      turnos: suma(cs.map((x) => x.turnos)), llamadasModelo: suma(cs.map((x) => x.llamadasModelo)),
      conversacion: cs[0]?.conversacion ?? [], fallas: fallaron[0]?.fallas ?? [],
    };
  });
  const violaciones = global ? revisarNegativoGlobal(global.frases, corridas) : [];
  const latentes = global ? revisarNegativoGlobal(global.frases, corridas, 'respaldos') : [];
  const filaGlobal = global ? {
    id: global.id, titulo: global.titulo || 'Negativo global', corridas: corridas.length, aprobaron: corridas.length - new Set(violaciones.map((v) => v.corrida)).size, ok: violaciones.length === 0,
    por: violaciones.length ? `${violaciones.length} violación(es) en ${new Set(violaciones.map((v) => v.corrida)).size} corrida(s): ${[...new Set(violaciones.map((v) => `«${v.frase}» en ${v.caso} T${v.turno}`))].slice(0, 3).join('; ')}…` : '',
    turnos: 0, llamadasModelo: 0, conversacion: [], fallas: [],
  } : null;
  const usos = corridas.flatMap((c) => c.usos);
  const uso = { entrada: suma(usos.map((u) => u.entrada)), salida: suma(usos.map((u) => u.salida)), cacheados: suma(usos.map((u) => u.cacheados)), razonamiento: suma(usos.map((u) => u.razonamiento)) };
  const llamadas = suma(corridas.map((c) => c.llamadasModelo));
  const bytes = suma(corridas.map((c) => c.bytesModelo));
  const estimado = llamadas ? costoDe({ entrada: Math.ceil(bytes / 4), salida: llamadas * SALIDA_ESTIMADA, cacheados: 0, razonamiento: 0 }) : 0;
  const todos = filaGlobal ? [...porCaso, filaGlobal] : porCaso;
  return {
    version: 1, modo: opciones.seco ? 'seco' : 'real', flujo: flujo.name, proveedor: opciones.seco ? 'ninguno (seco)' : `Vertex AI (${opciones.vertex}, ${opciones.locacion})`,
    corridasPorCaso: opciones.seco ? 1 : opciones.n,
    casos: todos, aprobaron: todos.filter((x) => x.ok).length, fallaron: todos.filter((x) => !x.ok).length,
    total: {
      corridas: corridas.length, turnos: suma(corridas.map((c) => c.turnos)), llamadasModelo: llamadas, mensajesAlCliente: suma(corridas.map((c) => c.mensajes)),
      avisosAlLocal: suma(corridas.map((c) => c.avisos)), lecturasSimuladas: suma(corridas.map((c) => c.lecturas)), usoModelo: opciones.seco ? null : uso,
    },
    negativoGlobal: global ? { id: global.id, violaciones, latentes } : null,
    costo: {
      usd: opciones.seco ? null : usos.length ? redondear(costoDe(uso), 6) : null,
      estimadoPorLlamadaUsd: llamadas ? redondear(estimado / llamadas, 6) : 0, estimadoTotalUsd: redondear(estimado, 5),
      tarifa: { ...TARIFA, unidad: 'USD por millón de tokens' }, supuesto: SUPUESTO_TARIFA,
      nota: opciones.seco ? `ESTIMACIÓN de una corrida real: ${llamadas} llamada(s) a «Extraer» con ≈ ${Math.round(bytes / 4 / Math.max(1, llamadas))} tokens de entrada y ${SALIDA_ESTIMADA} de salida cada una (entrada ≈ caracteres/4).` : '',
    },
    pendientes,
    aviso: opciones.seco ? 'SECO: el modelo es simulado (respuesta fija por turno); lo que se mide es el flujo determinista, no al modelo.' : '',
  };
}

const fmtUsd = (n) => (n === null || n === undefined ? 'n/d' : `USD ${n.toFixed(4)}`);

function tablaTexto(filas, columnas) {
  const anchos = columnas.map((c, i) => Math.max(c.length, ...filas.map((f) => String(f[i]).length)));
  const linea = (f) => f.map((x, i) => String(x).padEnd(anchos[i])).join('  ').trimEnd();
  return [linea(columnas), anchos.map((a) => '-'.repeat(a)).join('  '), ...filas.map(linea)].join('\n');
}
const tablaMarkdown = (filas, columnas) => [`| ${columnas.join(' | ')} |`, `|${columnas.map(() => '---').join('|')}|`, ...filas.map((f) => `| ${f.map((x) => String(x).replace(/\|/g, '\\|')).join(' | ')} |`)].join('\n');

function textoDelInforme(r, opciones) {
  const o = [];
  o.push(`Flujo: ${r.flujo} · proveedor: ${r.proveedor} · ${r.casos.length} escenario(s) · ${r.corridasPorCaso} corrida(s) por caso`);
  if (r.aviso) o.push(r.aviso);
  o.push('');
  const cols = ['ID', 'TÍTULO', 'CORR', 'RESULTADO', 'POR QUÉ'];
  const filas = r.casos.map((c) => [c.id, recorta(c.titulo, 56), c.corridas, c.ok ? 'APROBÓ' : `FALLÓ (${c.aprobaron}/${c.corridas})`, recorta(c.por, opciones.tabla ? 400 : 150)]);
  o.push((opciones.tabla ? tablaMarkdown : tablaTexto)(filas, cols));
  o.push('');
  const t = r.total;
  o.push(`Escenarios: ${r.aprobaron} aprobaron · ${r.fallaron} fallaron · turnos totales: ${t.turnos} · llamadas al modelo («Extraer»): ${t.llamadasModelo} · mensajes al cliente (todos los turnos): ${t.mensajesAlCliente} · avisos al local: ${t.avisosAlLocal} · lecturas de comprobante simuladas: ${t.lecturasSimuladas}`);
  if (r.negativoGlobal) {
    o.push(`Negativo global ${r.negativoGlobal.id}: ${r.negativoGlobal.violaciones.length === 0 ? 'ninguna frase prohibida en lo que el cliente recibe' : `${r.negativoGlobal.violaciones.length} violación(es)`}`);
    for (const v of r.negativoGlobal.violaciones.slice(0, 20)) o.push(`  [${v.caso} T${v.turno}] «${v.frase}» → ${v.texto}`);
    if (r.negativoGlobal.latentes.length) {
      o.push(`  AVISO (no falla): ${r.negativoGlobal.latentes.length} texto(s) de RESPALDO con una frase prohibida; el cliente solo los recibiría si Meta rechazara el mensaje interactivo:`);
      for (const v of r.negativoGlobal.latentes.slice(0, 10)) o.push(`    [${v.caso} T${v.turno}] «${v.frase}» → ${v.texto}`);
    }
  }
  const fallos = r.casos.filter((c) => !c.ok && c.fallas.length);
  if (fallos.length) {
    o.push('');
    o.push('DETALLE DE LO QUE FALLÓ (primera corrida que falló):');
    for (const c of fallos) for (const f of c.fallas) o.push(`  ${c.id} T${f.turno}${f.previo ? ' (previo)' : ''} «${recorta(f.dicho, 50)}»: ${f.por}`);
  }
  o.push('');
  if (r.modo === 'seco') {
    o.push(t.llamadasModelo
      ? `Costo: sin uso real (modo seco). ${r.costo.nota} ≈ USD ${r.costo.estimadoPorLlamadaUsd.toFixed(4)} por llamada, ${fmtUsd(r.costo.estimadoTotalUsd)} en total. Supuesto de la tarifa: ${r.costo.supuesto}`
      : 'Costo: sin uso real (modo seco) y sin llamadas al modelo en estos casos.');
  }
  else {
    const u = t.usoModelo;
    o.push(`Uso del modelo: ${t.llamadasModelo} llamadas · entrada ${u.entrada} tokens (cacheados ${u.cacheados}) · salida ${u.salida} (razonamiento ${u.razonamiento})`);
    o.push(`Costo estimado: ${fmtUsd(r.costo.usd)}. Supuesto de la tarifa: ${r.costo.supuesto}`);
  }
  if (r.pendientes.length) o.push(`Escenarios que esperan una rama (no están en estos lotes): ${r.pendientes.map((p) => p.id).join(', ')}`);
  return o.join('\n');
}

// ------------------------------------------------------------------------------------------------------- principal
const AYUDA = `Batería de conversación de «Venta mínima v0» (Q'Taco), offline.
  node Flujos/experimental/venta-minima/herramientas/bateria.mjs (--seco | --vertex proyecto [--locacion región]) [--casos A9,B1] [--n 1..20] [--json] [--tabla]
  --seco: modelo simulado, sin clave ni red (1 corrida por caso) · --vertex: Vertex AI con el token de gcloud (nunca se imprime)
  --casos: ids (E8 = el negativo global; sola, corre todos) · --json: salida de máquina · --tabla: tabla en Markdown
  Salida 0 = todo aprobó · 1 = algún caso falló · 2 = uso incorrecto o casos mal formados`;

function leerPendientes(carpeta) {
  try {
    const datos = JSON.parse(readFileSync(join(carpeta, ARCHIVO_PENDIENTES), 'utf8'));
    return Array.isArray(datos.pendientes) ? datos.pendientes.filter((p) => p && typeof p.id === 'string') : [];
  } catch { return []; }
}

/**
 * Corre la bateria. `deps` (solo para pruebas): { salida, error, fetch, gcloudToken, leerCasos }. Devuelve el codigo de salida:
 * 0 = todo aprobo; 1 = algun caso fallo (o un fallo inesperado); 2 = uso invalido o casos mal formados (sin red ni traza).
 */
export async function main(argv, deps = {}) {
  const d = {
    salida: (t) => process.stdout.write(t),
    error: (t) => process.stderr.write(t),
    fetch: (...a) => globalThis.fetch(...a),
    leerArchivo: (r) => (existsSync(r) ? readFileSync(r, 'utf8') : null),
    gcloudToken: () => execFileSync('gcloud', ['auth', 'print-access-token'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
    leerCasos: () => leerCasosDeCarpeta(),
    ...deps,
  };
  let opciones;
  let credencial = { clave: null, token: null, nombre: '' };
  try {
    opciones = leerArgumentos(argv);
    if (opciones.ayuda) { d.salida(AYUDA + '\n'); return 0; }
    const flujo = JSON.parse(readFileSync(RUTA_FLUJO, 'utf8'));
    const { casos: todos, global } = d.leerCasos();
    let elegidos = todos;
    let conGlobal = global; // E8 corre con todos los casos, o cuando `--casos` lo nombra
    if (opciones.casos) {
      const ids = opciones.casos;
      const conocidos = [...todos.map((x) => x.id), ...(global ? [global.id] : [])];
      for (const id of ids) if (!conocidos.includes(id)) throw new ErrorDeUso(`Caso desconocido: ${id}. Hay: ${conocidos.join(', ')}.`);
      const soloGlobal = global && ids.every((id) => id === global.id);
      elegidos = soloGlobal ? todos : ids.filter((id) => !global || id !== global.id).map((id) => todos.find((x) => x.id === id));
      if (global && !ids.includes(global.id)) conGlobal = null;
    }
    const info = (t) => (opciones.json ? d.error(t + '\n') : d.salida(t + '\n'));
    if (!opciones.seco) {
      credencial = leerCredencial(opciones, d);
      info(`Token del modelo: ${credencial.nombre} (valor no mostrado)`);
    }
    const nRep = opciones.seco ? 1 : opciones.n;
    const corridas = [];
    for (const caso of elegidos) {
      for (const { etiqueta, caso: concreto } of expandirVariantes(caso)) {
        for (let rep = 1; rep <= nRep; rep++) {
          if (!opciones.seco) d.error(`… ${caso.id}${etiqueta ? ' ' + etiqueta : ''} corrida ${rep}/${nRep}\n`);
          corridas.push(await correrCaso({ caso: concreto, rep, flujo, opciones, credencial, deps: d }));
        }
      }
    }
    const r = informe({ opciones, flujo, casos: elegidos, corridas, global: conGlobal, pendientes: leerPendientes(CARPETA_CASOS) });
    d.salida(opciones.json ? JSON.stringify(r) + '\n' : textoDelInforme(r, opciones) + '\n');
    return r.fallaron > 0 ? 1 : 0;
  } catch (e) {
    const secretos = [credencial.clave, credencial.token];
    if (e instanceof ErrorDeUso) { d.error(`✗ ${limpiarSecretos(e.message, secretos)}\n`); return 2; }
    d.error(`✗ Fallo inesperado: ${limpiarSecretos(mensajeDe(e), secretos).slice(0, 300)}\n`);
    return 1;
  }
}

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esPrincipal) process.exitCode = await main(process.argv.slice(2));
