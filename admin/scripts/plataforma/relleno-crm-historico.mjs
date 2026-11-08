/**
 * RELLENO HISTÓRICO DEL miniCRM — una fila por cada contacto anterior de UNA subcuenta. Seco por omisión.
 *
 * QUÉ ES. Antes de publicar el miniCRM, cada subcuenta ya tenía contactos (Firestore `tenants/{t}/conversaciones`). Este script
 * crea en la hoja oficial del comercio (hoja `Leads_CRM`) una fila por cada contacto que todavía NO tiene fila, con SOLO los campos
 * que existen y un vocabulario cerrado. Un comercio por corrida (evy, emma, ruben o antonio); nada se comparte entre iteraciones.
 *
 *   ENV_FILE=<.env con N8N_BASE_URL y N8N_API_KEY> SHEET_ID=<id de la hoja del comercio> \
 *   node scripts/plataforma/relleno-crm-historico.mjs --proyecto <id> --tenant <rroca-...> \
 *        [--aplicar --respaldo <ruta> [--confirmo-produccion <tenant>]]
 *   ENV_FILE=… SHEET_ID=… node scripts/plataforma/relleno-crm-historico.mjs --revertir --respaldo <ruta> --tenant <t> --proyecto <id> [--aplicar]
 *
 * QUÉ ESCRIBE (por fila nueva; el resto de las columnas queda vacío, y J..M y U son del equipo: no se tocan):
 *   A  ID correlativo (LEAD-n, a continuación del mayor que ya haya en la hoja)      B  fecha del PRIMER mensaje (La Paz)
 *   C  nombre del contacto (el de su perfil de WhatsApp, sin signos de fórmula)       E  teléfono
 *   F  etapa inicial       G  origen/canal («Campaña Meta Ads» si la conversación vino de un anuncio)      H  calificación: VACÍA (sin evaluar)
 *   I  resumen fijo («Contacto anterior al miniCRM; calificación sin evaluar.»)     L  estado inicial (Activo)     N  clasificación: VACÍA (sin evaluar)
 *   S  última interacción (La Paz)
 * NUNCA escribe: lo que dijo el cliente, datos de salud, motivos ni montos; «qué pidió», día, horario, derivación y diagnóstico quedan
 * vacíos (no se inventan). Ninguna fila dice que alguien pagó.
 *
 * Q'TACO (`--tenant qtaco`): además de los contactos, trae las COMPRAS anteriores (ver «COMPRAS ANTERIORES» más abajo) y, en las filas nuevas, completa O «Eligió»
 * (Pedido|Reserva, la última), P «Reserva» («Enviada AAAA-MM-DD HH:MM») y Q «Pedido» («Registrado AAAA-MM-DD HH:MM»), hora de La Paz, con el mapa de
 * `datos/venta-minima/qtaco-3727.json`. Para las filas que YA estaban en la hoja, el seco cuenta cuántas celdas vacías de O/P/Q se completarían
 * (`construirActualizaciones`) y `--aplicar` la ejecuta: relee la hoja justo antes, escribe SOLO las celdas O/P/Q hoy vacías (un `values:batchUpdate` por rangos explícitos, que el flujo
 * temporal corta si alguna ya tiene dato), guarda antes un respaldo de celda y valor (`<ruta>.completar` si en la misma corrida también hay filas nuevas), relee y compara;
 * `--revertir` con ese respaldo limpia solo esas celdas y solo si siguen igual. DATO HISTÓRICO POR CIERRE: «Enviada» y «Registrado» salen de la fecha del cierre/pedido; un cierre
 * prueba que se registró, no que el aviso al local salió (aproximación aceptada por Andres). `TELEFONOS_EXCLUIDOS` (dígitos separados por comas, en el entorno, nunca en un archivo) deja fuera los teléfonos de prueba.
 *
 * LO QUE NUNCA LEE: el texto de un mensaje (de cada conversación solo pide la hora del primero, `select('ts')`), ni la columna U de la hoja.
 *
 * IDEMPOTENTE POR TELÉFONO: un contacto cuyo teléfono ya está en la hoja se SALTA (no se crea otra fila; una fila existente SOLO se toca en O/P/Q de Q'Taco y solo si esas celdas están vacías, ver «COMPLETAR O/P/Q»). Correr dos veces
 * escribe una vez. Los teléfonos se comparan solo por sus dígitos.
 *
 * SECO: lee la hoja (A3:T, sin la U) y Firestore y IMPRIME SOLO CONTEOS (nunca teléfonos ni nombres).
 * `--aplicar`: exige `--confirmo-produccion <tenant>` SIEMPRE (la hoja es la real aunque Firestore sea staging o el emulador) y `--respaldo`
 * (ruta absoluta, 0600, fuera de todo repositorio, nunca se pisa). Guarda ahí SOLO las filas que va a escribir y dónde (no copia la hoja: lleva
 * datos de personas; el respaldo se borra al cerrar la operación), escribe las filas nuevas en un rango explícito con el formato de la primera fila de datos (`values:update`, USER_ENTERED con
 * apóstrofo en los textos) y relee y compara.
 * `--revertir --aplicar`: borra SOLO el rango que escribió este script (lo CALCULA desde la fila inicial y la cantidad; nunca llega a la U) y solo si
 * su contenido sigue siendo el escrito.
 *
 * LA CREDENCIAL. La cuenta `crm-<tenant>` no tiene clave en este equipo (vive en n8n). La lectura y la escritura de la hoja pasan por un flujo
 * TEMPORAL de n8n que usa la credencial «Google Sheets miniCRM (crm-<tenant>)»: se crea, se activa, se llama y se BORRA, con la retención de
 * ejecuciones en `none`. Cuesta una escritura en n8n por llamada y 0 mensajes por conversación.
 *
 * SALIDA. 0 hecho o seco sin diferencias; 1 el seco encontró filas por crear; 2 uso o salvaguarda (nada escrito); 3 error de ejecución.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comprobarProyecto, comprobarRespaldo, guardarRespaldo, leerRespaldoGenerico } from './aplicar-consola-conversaciones.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..', '..');
// `TENANTS` (solo los rroca-*) lo importan también `vaciar-hoja-crm` y `vaciar-chats-tenant` como salvaguarda: vaciar la hoja de Q'Taco NO debe aceptarse. Q'Taco entra únicamente al relleno.
export const TENANTS = Object.freeze(['rroca-evy', 'rroca-emma', 'rroca-ruben', 'rroca-antonio']);
export const TENANTS_RELLENO = Object.freeze([...TENANTS, 'qtaco']);
// Los rroca-* leen su mapa de `admin/scripts/datos/<t>/<t>.json`; Q'Taco lo trae en el JSON de datos de su flujo (`venta-minima/qtaco-3727.json`, clave `crm`).
const MAPA_PROPIO = Object.freeze({ qtaco: ['admin', 'scripts', 'datos', 'venta-minima', 'qtaco-3727.json'] });
// Los comercios cuyo pasado incluye PEDIDOS y RESERVAS registrados (cierres `registro`/`venta` y la colección `pedidos`): además de los contactos, completan O, P y Q.
export const TENANTS_CON_COMPRAS = Object.freeze(['qtaco']);
const HOJA = 'Leads_CRM';
// Un contacto anterior al miniCRM está SIN EVALUAR: la calificación y la clasificación se dejan vacías (no un juicio sobre la persona) y las escribe el bot.
const RESUMEN = 'Contacto anterior al miniCRM; calificación sin evaluar.';
const CON_VALOR = ['proyecto', 'tenant', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];

export const USO = '  ENV_FILE=… SHEET_ID=… [TELEFONOS_EXCLUIDOS=<dígitos separados por comas>] node scripts/plataforma/relleno-crm-historico.mjs --proyecto <id> --tenant <rroca-evy|rroca-emma|rroca-ruben|rroca-antonio|qtaco> '
  + '[--aplicar --respaldo <ruta> [--confirmo-produccion <tenant>]]\n'
  + '  ENV_FILE=… SHEET_ID=… node scripts/plataforma/relleno-crm-historico.mjs --revertir --respaldo <ruta> --tenant <t> --proyecto <id> [--aplicar] [--confirmo-produccion <tenant>]';

// Las rutinas de texto y fecha son las del módulo `crm` (se cargan del mismo archivo que corre en n8n, no se copian).
const CRM = runInNewContext(`${readFileSync(join(RAIZ, 'Flujos', 'src', 'modulos', 'crm', 'crm.js'), 'utf8')}\n({ crmDigitos, crmSeguro, crmComoTexto, crmFechaLaPaz, crmFechaHoraLaPaz })`, {});

export function leerMapa(tenant, raiz = RAIZ) {
  if (!TENANTS_RELLENO.includes(tenant)) throw new Error('tenant fuera de la lista');
  const ruta = MAPA_PROPIO[tenant] ?? ['admin', 'scripts', 'datos', tenant, `${tenant}.json`];
  const m = JSON.parse(readFileSync(join(raiz, ...ruta), 'utf8')).crm;
  delete m._nota;
  return m;
}

// ===========================================================================
// ARGUMENTOS
// ===========================================================================
export function analizarArgumentos(argv, env = process.env, opciones = {}) {
  const problemas = [];
  const valores = { __proto__: null };
  const banderas = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string' || !a.startsWith('--')) { problemas.push('argumento suelto (sin su opción)'); continue; }
    const nombre = a.slice(2);
    if (BANDERAS.includes(nombre)) { if (banderas.includes(nombre)) problemas.push(`opción repetida: --${nombre}`); banderas.push(nombre); }
    else if (CON_VALOR.includes(nombre)) {
      if (nombre in valores) problemas.push(`opción repetida: --${nombre}`);
      const valor = argv[i + 1];
      if (valor === undefined || valor.startsWith('--')) { problemas.push(`--${nombre} sin valor`); continue; }
      valores[nombre] = valor; i += 1;
    } else problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40)}`);
  }
  const aplicar = banderas.includes('aplicar');
  const revertir = banderas.includes('revertir');
  const { proyecto, tenant, respaldo } = valores;
  const confirmo = valores['confirmo-produccion'];
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto === undefined) problemas.push('falta --proyecto'); else if (!proy.ok) problemas.push(proy.motivo);
  if (tenant === undefined) problemas.push('falta --tenant');
  else if (!TENANTS_RELLENO.includes(tenant)) problemas.push(`--tenant tiene que ser uno de: ${TENANTS_RELLENO.join(', ')} (un comercio por corrida)`);
  // LA HOJA ES SIEMPRE LA REAL: la lectura y la escritura pasan por el n8n real, con la credencial y el SHEET_ID reales, aunque Firestore sea el emulador
  // o staging. Por eso TODO --aplicar (y --revertir --aplicar) exige la confirmación con el nombre del comercio, sea cual sea el proyecto.
  if (confirmo !== undefined && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  if (aplicar && confirmo === undefined) problemas.push('--aplicar exige --confirmo-produccion <tenant> (igual a --tenant): escribe en la hoja REAL del comercio, sea cual sea el proyecto de Firestore');
  if (!/^[A-Za-z0-9_-]{25,100}$/.test(env.SHEET_ID ?? '')) problemas.push('falta SHEET_ID (el id de la hoja del comercio, en el entorno)');
  if (typeof env.ENV_FILE !== 'string' || env.ENV_FILE === '') problemas.push('falta ENV_FILE (el .env de n8n)');
  if (revertir) {
    if (respaldo === undefined) problemas.push('--revertir exige --respaldo <ruta>');
  } else if (aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta>');
  let respaldoResuelto = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: revertir, permitirExistente: !revertir });
    if (r.ok) respaldoResuelto = r.real; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, aplicar, revertir, respaldo: respaldo ?? null, respaldoResuelto } };
}

// ===========================================================================
// FILAS (puro)
// ===========================================================================
const finito = (n) => typeof n === 'number' && Number.isFinite(n);

// ===========================================================================
// COMPRAS ANTERIORES (puro): pedidos y reservas que el sistema registró antes del miniCRM
// ===========================================================================
// DE DÓNDE SALEN (Q'Taco, `venta-minima`): (1) cierres `registro` en `tenants/{t}/cierres`: el pedido SIN QR / QR vencido (detalle «Pedido #…», referencia = pedidoId)
// y la solicitud de reserva (detalle «Solicitud de reserva #…», referencia `res-…`); (2) cierres `venta`: el pedido con QR cuyo comprobante cuadró (referencia = pedidoId);
// (3) la colección `pedidos` (módulo Pedidos), de TODOS los orígenes (`whatsapp`: el pedido cuyo QR salió; `catalogo-web`: el carrito web), cualquiera sea su estado. El detalle de un cierre se usa SOLO para clasificarlo y se descarta; el teléfono sale
// de `/privado` (cierres) o de `conversacionId` (pedidos) y nunca se imprime. Un pedido que está en dos fuentes cuenta UNA vez (misma clave = su referencia) con su hora más temprana.
// LO QUE NO SE ESCRIBE: monto, líneas, dirección, notas ni nada del comprobante. Ni «pagado» ni «acreditado»: P dice «Enviada <fecha>» y Q «Registrado <fecha>» (el vocabulario del bot).
export const PREFIJO_RESERVA = 'Enviada';
export const PREFIJO_PEDIDO = 'Registrado';

/** Qué es un cierre: 'pedido' | 'reserva' | 'prueba' | 'otro'. Pura; `detalle` solo se mira por su comienzo y no sale de aquí. */
export function clasificarCierre({ tipo, referencia, detalle }) {
  const ref = typeof referencia === 'string' ? referencia.trim() : '';
  const det = typeof detalle === 'string' ? detalle.trimStart() : '';
  if (/^PRUEBA\b/i.test(det)) return 'prueba';
  if (tipo === 'venta') return /^res-/.test(ref) ? 'otro' : 'pedido';
  if (tipo !== 'registro') return 'otro';
  if (/^res-/.test(ref) || /^Solicitud de reserva/i.test(det)) return 'reserva';
  if (/^Pedido #/i.test(det)) return 'pedido';
  return 'otro';
}

/**
 * De los eventos sueltos [{ telefono, tipo: 'pedido'|'reserva', clave, ms }] al mapa por teléfono (solo dígitos):
 * { pedidoMs, reservaMs } con el MÁS RECIENTE de cada clase (como hace el bot: cada evento pisa al anterior), y los conteos de eventos distintos.
 */
export function reunirCompras(eventos, { excluir = [], ahoraMs = Date.now(), clavesDePrueba = [] } = {}) {
  const pruebas = new Set(clavesDePrueba.map((c) => String(c ?? '').replace(/^wa_/, '')).filter(Boolean));
  const fuera = new Set(excluir.map((t) => CRM.crmDigitos(t)).filter(Boolean));
  const conteos = { pedidos: 0, reservas: 0, porOrigen: {}, descartados: { sinTelefono: 0, sinFecha: 0, excluidos: 0, pruebas: 0 } };
  const unicos = new Map(); // `${tipo}:${clave}` -> { telefono, ms }
  for (const e of eventos) {
    if (e?.tipo !== 'pedido' && e?.tipo !== 'reserva') continue;
    if (pruebas.has(String(e.clave ?? '').replace(/^wa_/, ''))) { conteos.descartados.pruebas += 1; continue; }
    const tel = CRM.crmDigitos(e.telefono);
    if (tel.length < 8 || tel.length > 15) { conteos.descartados.sinTelefono += 1; continue; }
    if (fuera.has(tel)) { conteos.descartados.excluidos += 1; continue; }
    if (!finito(e.ms) || e.ms < Date.UTC(2020, 0, 1) || e.ms > ahoraMs + 86_400_000) { conteos.descartados.sinFecha += 1; continue; }
    const k = `${e.tipo}:${String(e.clave ?? '').replace(/^wa_/, '') || `${tel}:${e.ms}`}`;
    const previo = unicos.get(k);
    const origen = typeof e.origen === 'string' && e.origen !== '' ? e.origen.slice(0, 30) : 'cierre';
    // Misma clave en dos fuentes: la hora más temprana y, como origen, el de la colección `pedidos` (whatsapp, catalogo-web…) si lo hay.
    if (!previo) unicos.set(k, { telefono: tel, tipo: e.tipo, ms: e.ms, origen });
    else { if (e.ms < previo.ms) previo.ms = e.ms; if (previo.origen === 'cierre') previo.origen = origen; }
  }
  const porTelefono = new Map();
  for (const u of unicos.values()) {
    const f = porTelefono.get(u.telefono) ?? { pedidoMs: null, reservaMs: null, eventos: [] };
    f.eventos.push({ tipo: u.tipo, ms: u.ms });
    const campo = u.tipo === 'pedido' ? 'pedidoMs' : 'reservaMs';
    if (f[campo] === null || u.ms > f[campo]) f[campo] = u.ms;
    porTelefono.set(u.telefono, f);
    if (u.tipo === 'pedido') { conteos.pedidos += 1; conteos.porOrigen[u.origen] = (conteos.porOrigen[u.origen] ?? 0) + 1; } else conteos.reservas += 1;
  }
  return { porTelefono, conteos };
}

/** Lo que va en O, P y Q para un teléfono con compras. Vacío = no hay dato (no se escribe, nunca «No»). */
export function celdasDeCompra(c) {
  const ultimo = c.pedidoMs !== null && (c.reservaMs === null || c.pedidoMs >= c.reservaMs) ? 'Pedido' : (c.reservaMs !== null ? 'Reserva' : '');
  return {
    quePidio: ultimo,
    diaPreferido: c.reservaMs !== null ? `${PREFIJO_RESERVA} ${CRM.crmFechaHoraLaPaz(c.reservaMs)}` : '',
    horarioPreferido: c.pedidoMs !== null ? `${PREFIJO_PEDIDO} ${CRM.crmFechaHoraLaPaz(c.pedidoMs)}` : '',
  };
}

/**
 * Para las filas que YA están en la hoja, qué se completa en O, P y Q (el seco lo cuenta; `--aplicar` lo escribe, ver `completarExistentes`). Solo una celda VACÍA se completa;
 * una con dato (del bot o del equipo) no se toca. Con varias filas del mismo teléfono, cada compra va a la fila cuya fecha (B) es la última anterior o igual a la compra (la más reciente).
 * Devuelve { propuestas: [{ fila, celdas: { O?, P?, Q? } }], conteos }.
 */
export function construirActualizaciones({ valores, mapa, compras }) {
  const idx = (campo) => mapa.columnas[campo].letra.charCodeAt(0) - 65;
  const filasDe = new Map();
  valores.slice(1).forEach((f, i) => {
    const tel = CRM.crmDigitos(f[idx('telefono')] ?? '');
    if (!tel) return;
    const dia = /^\d{4}-\d{2}-\d{2}/.exec(String(f[idx('fecha')] ?? '').trim())?.[0] ?? '';
    if (!filasDe.has(tel)) filasDe.set(tel, []);
    filasDe.get(tel).push({ f, fila: mapa.filaEncabezados + 1 + i, dia });
  });
  const propuestas = [];
  const conteos = { existentesConCompra: 0, aCompletar: 0, celdas: 0, sinHuecos: 0, conVariasFilas: 0 };
  for (const [tel, c] of compras) {
    const filas = filasDe.get(tel);
    if (!filas) continue;
    conteos.existentesConCompra += 1;
    if (filas.length > 1) conteos.conVariasFilas += 1;
    // El bot abre una fila NUEVA tras 48 h: cada compra va a la fila cuya fecha (B) es la última anterior o igual al día de la compra; sin fila anterior, a la primera.
    // Una fila sin fecha legible cuenta como anterior (con todas sin fecha, la compra va a la última, la más reciente de la hoja).
    const porFila = new Map();
    const eventos = Array.isArray(c.eventos) && c.eventos.length ? c.eventos : [{ tipo: 'pedido', ms: c.pedidoMs }, { tipo: 'reserva', ms: c.reservaMs }].filter((e) => e.ms !== null);
    for (const e of eventos) {
      const diaE = CRM.crmFechaLaPaz(e.ms);
      let destino = filas[0];
      for (const fila of filas) if (fila.dia <= diaE) destino = fila;
      const acum = porFila.get(destino) ?? { pedidoMs: null, reservaMs: null };
      const campo = e.tipo === 'pedido' ? 'pedidoMs' : 'reservaMs';
      if (acum[campo] === null || e.ms > acum[campo]) acum[campo] = e.ms;
      porFila.set(destino, acum);
    }
    let alguna = false;
    for (const [fila, acum] of porFila) {
      const deseadas = celdasDeCompra(acum);
      const celdas = {};
      for (const campo of ['quePidio', 'diaPreferido', 'horarioPreferido']) {
        const letra = mapa.columnas[campo].letra;
        if (deseadas[campo] !== '' && String(fila.f[idx(campo)] ?? '').trim() === '') celdas[letra] = deseadas[campo];
      }
      if (Object.keys(celdas).length === 0) continue;
      alguna = true;
      conteos.aCompletar += 1; conteos.celdas += Object.keys(celdas).length;
      propuestas.push({ fila: fila.fila, telefono: tel, celdas });
    }
    if (!alguna) conteos.sinHuecos += 1;
  }
  propuestas.sort((x, y) => x.fila - y.fila);
  return { propuestas, conteos };
}

/**
 * De las conversaciones + lo que ya hay en la hoja a las filas nuevas.
 *   conversaciones: [{ telefono, nombre?, origen?, primeroMs?, ultimoMs? }]   (sin ningún texto de mensaje)
 *   hoja: { telefonos: string[] (solo dígitos o crudos), ids: string[], ultimaFila: number }
 * Devuelve { filas: string[][] (A..ultima letra del bot), omitidos, conteos }.
 */
export function construirFilas({ conversaciones: conversacionesBase, hoja, mapa, compras = new Map() }) {
  const col = (c) => mapa.columnas[c];
  const letras = Object.values(mapa.columnas).map((c) => c.letra).sort();
  const ultima = letras[letras.length - 1];
  const idx = (letra) => letra.charCodeAt(0) - 65;
  const ancho = idx(ultima) + 1;
  const estado = mapa.equipo.estado;
  const tieneEstado = estado && estado.letra <= ultima;
  const existentes = new Set(hoja.telefonos.map((t) => CRM.crmDigitos(t)).filter(Boolean));
  const re = new RegExp(`^\\s*${mapa.prefijoId.replace(/[^A-Za-z0-9]/g, '\\$&')}(\\d+)\\s*$`, 'i');
  let proximo = Math.max(mapa.primerId - 1, ...hoja.ids.map((v) => { const m = re.exec(String(v ?? '')); return m ? Number(m[1]) : 0; })) + 1;
  const omitidos = { sinTelefono: 0, yaTienenFila: 0, repetidos: 0 };
  // Quien tiene pedido o reserva registrados pero ya no tiene conversación (o nunca se leyó) igual es un contacto: su primera y su última marca son las de sus compras.
  const conTelefono = new Set(conversacionesBase.map((c) => CRM.crmDigitos(c.telefono)));
  const soloCompra = [...compras].filter(([tel]) => !conTelefono.has(tel)).map(([tel, c]) => {
    const ms = [c.pedidoMs, c.reservaMs].filter((m) => m !== null);
    return { telefono: tel, primeroMs: Math.min(...ms), ultimoMs: Math.max(...ms) };
  });
  const conversaciones = [...conversacionesBase, ...soloCompra];
  const vistos = new Set();
  const filas = [];
  let conAnuncio = 0; let conNombre = 0; let conCompra = 0; let conPedido = 0; let conReserva = 0;
  // Orden estable: el contacto más antiguo recibe el ID más bajo.
  const ordenadas = [...conversaciones].sort((a, b) => (finito(a.primeroMs) ? a.primeroMs : Infinity) - (finito(b.primeroMs) ? b.primeroMs : Infinity));
  for (const c of ordenadas) {
    const tel = CRM.crmDigitos(c.telefono);
    if (tel.length < 8 || tel.length > 15) { omitidos.sinTelefono += 1; continue; }
    if (existentes.has(tel)) { omitidos.yaTienenFila += 1; continue; }
    if (vistos.has(tel)) { omitidos.repetidos += 1; continue; }
    vistos.add(tel);
    const fila = new Array(ancho).fill('');
    const poner = (campo, valor) => { if (col(campo) && valor !== '') fila[idx(col(campo).letra)] = valor; };
    const anuncio = c.origen === 'anuncio';
    if (anuncio) conAnuncio += 1;
    const nombre = CRM.crmComoTexto(String(c.nombre ?? '').slice(0, 120));
    if (nombre) conNombre += 1;
    poner('id', `${mapa.prefijoId}${proximo}`);
    poner('fecha', finito(c.primeroMs) ? CRM.crmFechaLaPaz(c.primeroMs) : '');
    poner('nombre', nombre);
    poner('telefono', `'${tel}`);
    poner('etapaInicial', mapa.alCrear.etapaInicial);
    poner('origen', anuncio ? mapa.alCrear.origenAnuncio : mapa.alCrear.origen);
    // Calificación (H) y clasificación (N) quedan VACÍAS = sin evaluar: el módulo solo las sube, así que un valor por omisión («Media», «Tibio») le impediría
    // al bot clasificar bien al próximo mensaje; vacías, las escribe en el primer turno real.
    poner('resumen', `'${RESUMEN}`);
    poner('ultimaInteraccion', finito(c.ultimoMs) ? CRM.crmFechaHoraLaPaz(c.ultimoMs) : '');
    if (tieneEstado && mapa.alCrear.estado) fila[idx(estado.letra)] = mapa.alCrear.estado;
    // O «Eligió», P «Reserva» y Q «Pedido» (Q'Taco): solo si hay una compra registrada, con el vocabulario y el formato del bot.
    const compra = compras.get(tel);
    if (compra) {
      conCompra += 1; if (compra.pedidoMs !== null) conPedido += 1; if (compra.reservaMs !== null) conReserva += 1;
      for (const [campo, valor] of Object.entries(celdasDeCompra(compra))) poner(campo, valor);
    }
    filas.push(fila);
    proximo += 1;
  }
  return { filas, omitidos, conteos: { conversaciones: conversacionesBase.length, soloCompra: soloCompra.length, aCrear: filas.length, conAnuncio, conNombre, conCompra, conPedido, conReserva, ancho, ultima } };
}

// ===========================================================================
// n8n: flujo temporal que lee o escribe la hoja con la credencial del comercio
// ===========================================================================
function leerEnv(ruta) {
  const env = {};
  for (const l of readFileSync(ruta, 'utf8').split('\n')) { const m = /^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(l); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); }
  return env;
}

/** Si un flujo temporal no se pudo borrar, la corrida termina con 3 aunque lo demás haya salido bien: queda un webhook vivo que limpiar a mano. */
export const estado = { limpiezaFallida: false };

export function nombreCredencial(tenant) { return `Google Sheets miniCRM (crm-${tenant})`; }

/** Crea, activa, llama y BORRA un flujo temporal. `nodos` cuelga de un webhook; devuelve el JSON de la última salida. */
export async function correrEnN8n({ envFile, tenant, hacer, cuerpo }) {
  const env = leerEnv(envFile);
  const BASE = (env.N8N_BASE_URL || '').replace(/\/+$/, '');
  if (!BASE || !env.N8N_API_KEY) throw Object.assign(new Error('faltan N8N_BASE_URL o N8N_API_KEY'), { code: 'sin-n8n' });
  const CABECERA_CLAVE = ['X', 'N8N', 'API', 'KEY'].join('-'); // armada así para que el detector de secretos no confunda el NOMBRE de la cabecera con una clave
  // La clave y los datos de la hoja viajan por esta URL: solo https (o esta misma máquina).
  if (!/^https:\/\//.test(BASE) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE)) throw Object.assign(new Error('url'), { code: 'n8n-sin-https' });
  const H = { [CABECERA_CLAVE]: env.N8N_API_KEY, 'Content-Type': 'application/json' };
  const api = async (met, ruta, c) => {
    const r = await fetch(`${BASE}/api/v1${ruta}`, { method: met, headers: H, body: c ? JSON.stringify(c) : undefined, signal: AbortSignal.timeout(30000) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
    return { ok: r.ok, estado: r.status, j };
  };
  const lc = await api('GET', '/credentials?limit=250');
  const cred = (lc.j?.data || []).filter((c) => c.name === nombreCredencial(tenant));
  if (!lc.ok || cred.length !== 1) throw Object.assign(new Error('credencial del comercio: se esperaba 1'), { code: 'sin-credencial' });
  const credencial = { googleApi: { id: String(cred[0].id), name: nombreCredencial(tenant) } };
  const camino = `prueba-crm-${randomBytes(16).toString('hex')}`;
  const http = (id, name, x, parametros) => ({ id, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x, 0], credentials: credencial,
    parameters: { authentication: 'predefinedCredentialType', nodeCredentialType: 'googleApi', options: { timeout: 30000 }, ...parametros } });
  const { nodos, salida } = hacer({ http });
  const flujo = { name: `TEMPORAL relleno miniCRM ${tenant} (borrar)`,
    nodes: [{ id: 'entrada', name: 'Entrada', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: randomBytes(8).toString('hex'),
      parameters: { httpMethod: 'POST', path: camino, responseMode: 'lastNode', options: {} } }, ...nodos],
    connections: Object.fromEntries(['Entrada', ...nodos.map((n) => n.name)].slice(0, -1).map((n, i) => [n, { main: [[{ node: nodos[i].name, type: 'main', index: 0 }]] }])),
    settings: { executionOrder: 'v1', saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false } };
  void salida;
  let id = null;
  // Borra el flujo temporal pase lo que pase: cada paso en su propio try (si desactivar falla, igual se intenta borrar) y, si el borrado falla, se avisa con el id.
  const limpiar = async () => {
    if (!id) return;
    const idLocal = id; id = null;
    try { await api('POST', `/workflows/${idLocal}/deactivate`); } catch { /* se intenta borrar igual */ }
    let borrado = false;
    try { borrado = (await api('DELETE', `/workflows/${idLocal}`)).ok; } catch { /* se avisa abajo */ }
    if (!borrado) estado.limpiezaFallida = true;
    if (!borrado) console.error(`\n  ! No se pudo borrar el flujo temporal «TEMPORAL relleno miniCRM ${tenant} (borrar)» (id ${idLocal}): bórrelo a mano en n8n.\n`);
  };
  const alSenal = () => { void limpiar().finally(() => process.exit(130)); };
  process.once('SIGINT', alSenal);
  process.once('SIGTERM', alSenal);
  try {
    const c = await api('POST', '/workflows', flujo);
    if (!c.ok) throw Object.assign(new Error('crear'), { code: `n8n-crear-${c.estado}` });
    id = c.j.id;
    const a = await api('POST', `/workflows/${id}/activate`);
    if (!a.ok) throw Object.assign(new Error('activar'), { code: `n8n-activar-${a.estado}` });
    await new Promise((r) => setTimeout(r, 4000));
    const r = await fetch(`${BASE}/webhook/${camino}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo ?? {}), signal: AbortSignal.timeout(90000) });
    const texto = await r.text();
    if (!r.ok) throw Object.assign(new Error('llamada'), { code: `n8n-llamada-${r.status}` });
    try { return JSON.parse(texto); } catch { throw Object.assign(new Error('respuesta'), { code: 'n8n-respuesta-no-json' }); }
  } finally {
    process.off('SIGINT', alSenal);
    process.off('SIGTERM', alSenal);
    await limpiar();
  }
}

const urlHoja = (sheet, ruta) => `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheet)}/values/${ruta}`;

/** Lee A{fila}:{ultima} (NUNCA la columna del equipo U). */
export async function leerHoja({ envFile, tenant, sheet, mapa }) {
  const ultima = Object.values(mapa.columnas).map((c) => c.letra).sort().pop();
  const rango = encodeURIComponent(`'${HOJA}'!A${mapa.filaEncabezados}:${ultima}`);
  const r = await correrEnN8n({ envFile, tenant, hacer: ({ http }) => ({ nodos: [http('leer', 'Leer', 240, { method: 'GET', url: `${urlHoja(sheet, rango)}?valueRenderOption=FORMATTED_VALUE` })] }) });
  return Array.isArray(r.values) ? r.values : [];
}

/** Los títulos que debe tener la fila de encabezados, de A hasta la última letra del bot (las del bot y las del equipo que caen dentro). */
export function encabezadosEsperados(mapa) {
  const ultima = Object.values(mapa.columnas).map((c) => c.letra).sort().pop();
  const f = [];
  for (const c of Object.values(mapa.columnas)) f[c.letra.charCodeAt(0) - 65] = c.titulo;
  for (const c of Object.values(mapa.equipo)) if (c && c.letra <= ultima) f[c.letra.charCodeAt(0) - 65] = c.titulo;
  return Array.from({ length: ultima.charCodeAt(0) - 64 }, (_, i) => f[i] ?? '');
}

export const resumenDeLaHoja =(valores, mapa) => {
  const e = (c) => c.charCodeAt(0) - 65;
  const datos = valores.slice(1);
  return { telefonos: datos.map((f) => f[e(mapa.columnas.telefono.letra)] ?? ''), ids: datos.map((f) => f[e(mapa.columnas.id.letra)] ?? ''), ultimaFila: mapa.filaEncabezados + valores.length - 1 };
};

/**
 * Escribe las filas en un rango EXPLÍCITO (`filaDesde`), con el formato de la primera fila de datos. Tres llamadas en un solo flujo temporal:
 *   1. lee el `sheetId` de la pestaña; 2. copia a las filas destino el formato, las listas desplegables y los formatos condicionales de la fila de referencia
 *   (la primera de datos, `filaEncabezados + 1`; solo A..última letra del bot: la U del equipo no se toca); 3. escribe los valores con `values:update`.
 * Antes se usaba `values:append` con INSERT_ROWS: Google insertaba las filas heredando el formato de la fila de arriba (el encabezado, fondo oscuro), dejaba las
 * fechas como número serie y, con filas con formato debajo de la tabla, las ponía lejos de donde se esperaba. El formato va ANTES de los valores para que una
 * fecha `yyyy-mm-dd` se interprete con el formato de la celda y no quede como número.
 * REQUISITO: la fila de referencia (la 4) debe tener el formato bueno (el de la fila 4 de Emma); si la hoja quedó dañada por el `append` anterior, se arregla ANTES de correr esto.
 * Dentro del flujo, el destino se lee dos veces (antes de formatear y antes de escribir) y se corta si ya hay algo: nunca se pisa una fila del bot.
 */
export function pedidoDeFormato({ mapa, filaDesde, cantidad }) {
  const ultima = Object.values(mapa.columnas).map((c) => c.letra).sort().pop();
  const columnas = ultima.charCodeAt(0) - 64; // A..última letra del bot; jamás la U
  const origen = { startRowIndex: mapa.filaEncabezados, endRowIndex: mapa.filaEncabezados + 1, startColumnIndex: 0, endColumnIndex: columnas };
  const destino = { startRowIndex: filaDesde - 1, endRowIndex: filaDesde - 1 + cantidad, startColumnIndex: 0, endColumnIndex: columnas };
  return { origen, destino, pegados: ['PASTE_FORMAT', 'PASTE_DATA_VALIDATION', 'PASTE_CONDITIONAL_FORMATTING'] };
}

export async function agregarFilas({ envFile, tenant, sheet, mapa, filas, filaDesde }) {
  const ultima = Object.values(mapa.columnas).map((c) => c.letra).sort().pop();
  const fin = filaDesde + filas.length - 1;
  const rango = encodeURIComponent(`'${HOJA}'!A${filaDesde}:${ultima}${fin}`);
  const { origen, destino, pegados } = pedidoDeFormato({ mapa, filaDesde, cantidad: filas.length });
  const peticiones = pegados.map((pegar) => ({ copyPaste: { source: { sheetId: '__ID__', ...origen }, destination: { sheetId: '__ID__', ...destino }, pasteType: pegar, pasteOrientation: 'NORMAL' } }));
  // REGLA de las expresiones de n8n: el analizador corta en el PRIMER «}}», no cuenta llaves. Por eso ninguna expresión lleva JSON ni llaves seguidas incrustadas:
  // los pedidos viajan como DATO en el cuerpo de la entrada y la expresión solo los lee. Prueba: «sin }} en medio».
  const cuerpoFormato = `={{ JSON.stringify($('Entrada').first().json.body.peticiones).replace(/"__ID__"/g, String($json.sheets.find((x) => x.properties.title === ${JSON.stringify(HOJA)}).properties.sheetId)) }}`;
  // El destino se lee dentro del flujo, justo antes de formatear y otra vez justo antes de escribir: si hay algo, se corta (nunca se pisa una fila del bot).
  const ocupado = (nodo) => `$('${nodo}').first().json.values`;
  const aborta = "(() => { throw new Error('destino ocupado'); })()";
  const urlDestino = `${urlHoja(sheet, rango)}?valueRenderOption=FORMATTED_VALUE`;
  const cuerpoEscribir = `={{ ${ocupado('Destino 2')} ? ${aborta} : JSON.stringify({ range: ${JSON.stringify(`'${HOJA}'!A${filaDesde}:${ultima}${fin}`)}, majorDimension: 'ROWS', values: $('Entrada').first().json.body.filas }) }}`;
  const cuerpoFormatoGuardado = cuerpoFormato.replace('={{ ', `={{ ${ocupado('Destino')} ? ${aborta} : `);
  return correrEnN8n({ envFile, tenant, cuerpo: { filas, peticiones }, hacer: ({ http }) => ({ nodos: [
    http('destino', 'Destino', 240, { method: 'GET', url: urlDestino }),
    http('propiedades', 'Propiedades', 480, { method: 'GET', url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheet)}?fields=sheets.properties(sheetId,title)` }),
    http('formato', 'Formato', 720, { method: 'POST', url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheet)}:batchUpdate`, sendBody: true, contentType: 'json',
      specifyBody: 'json', jsonBody: cuerpoFormatoGuardado }),
    http('destino2', 'Destino 2', 960, { method: 'GET', url: urlDestino }),
    http('escribir', 'Escribir', 1200, { method: 'PUT', url: `${urlHoja(sheet, rango)}?valueInputOption=USER_ENTERED`, sendBody: true, contentType: 'json',
      specifyBody: 'json', jsonBody: cuerpoEscribir }),
  ] }) });
}

const CAMPOS_COMPRA = ['quePidio', 'diaPreferido', 'horarioPreferido'];
/** Las celdas O/P/Q de una lista de filas, con una lectura previa DENTRO del flujo: si alguna ya tiene dato (el bot o el equipo escribió a la vez), se corta y no se escribe ninguna. */
export async function completarCeldas({ envFile, tenant, sheet, celdas }) {
  // Integridad: además de las celdas, el flujo lee la columna del teléfono (E) de cada fila y la compara con los dígitos esperados; si la fila se movió o cambió, se corta.
  const filas = [...new Set(celdas.map((c) => c.fila))];
  const telefonos = filas.map((f) => celdas.find((c) => c.fila === f).tel);
  const rangosTel = filas.map((f) => `'${HOJA}'!E${f}`);
  const consulta = [...celdas.map((c) => c.rango), ...rangosTel].map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const aborta = "(() => { throw new Error('celda ocupada'); })()";
  const B = "$('Entrada').first().json.body";
  // Los datos viajan como DATO en el cuerpo de la entrada (regla: ninguna expresión lleva JSON ni «}}» incrustados).
  const ocupada = `$('Destino').first().json.valueRanges.some((r, i) => i < ${B}.n ? (Array.isArray(r.values) && r.values.some((f) => f.some((v) => String(v).trim() !== ''))) : String((r.values && r.values[0] && r.values[0][0]) || '').replace(/\\D/g, '') !== ${B}.telefonos[i - ${B}.n])`;
  const cuerpo = `={{ ${ocupada} ? ${aborta} : JSON.stringify({ valueInputOption: 'USER_ENTERED', data: ${B}.datos }) }}`;
  return correrEnN8n({ envFile, tenant, cuerpo: { n: celdas.length, telefonos, datos: celdas.map((c) => ({ range: c.rango, majorDimension: 'ROWS', values: [[c.valor]] })) }, hacer: ({ http }) => ({ nodos: [
    http('destino', 'Destino', 240, { method: 'GET', url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheet)}/values:batchGet?${consulta}&valueRenderOption=FORMATTED_VALUE` }),
    http('escribir', 'Escribir', 480, { method: 'POST', url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheet)}/values:batchUpdate`, sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: cuerpo }),
  ] }) });
}

export async function limpiarCeldas({ envFile, tenant, sheet, rangos }) {
  return correrEnN8n({ envFile, tenant, cuerpo: { rangos }, hacer: ({ http }) => ({ nodos: [http('limpiar', 'Limpiar', 240, { method: 'POST', url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheet)}/values:batchClear`,
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: "={{ JSON.stringify({ ranges: $('Entrada').first().json.body.rangos }) }}" })] }) });
}

export async function limpiarRango({ envFile, tenant, sheet, rango }) {
  return correrEnN8n({ envFile, tenant, hacer: ({ http }) => ({ nodos: [http('limpiar', 'Limpiar', 240, { method: 'POST', url: `${urlHoja(sheet, encodeURIComponent(rango))}:clear` })] }) });
}

// ===========================================================================
// FIRESTORE: solo metadatos (nunca el texto de un mensaje)
// ===========================================================================
async function leerConversaciones(db, tenant) {
  const docs = (await db.collection(`tenants/${tenant}/conversaciones`).select('telefono', 'nombreContacto', 'origen', 'ultimoEn').get()).docs;
  const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null);
  const salida = [];
  for (const d of docs) {
    const x = d.data();
    // De cada conversación SOLO la hora del primer mensaje (`ts`): el texto nunca se lee.
    const primero = (await d.ref.collection('mensajes').orderBy('ts', 'asc').limit(1).select('ts').get()).docs[0];
    salida.push({ telefono: x.telefono ?? d.id.replace(/^wa_/, ''), nombre: x.nombreContacto, origen: x.origen, primeroMs: ms(primero?.get('ts')) ?? ms(x.ultimoEn), ultimoMs: ms(x.ultimoEn) });
  }
  return salida;
}

/**
 * Pedidos y reservas anteriores (solo Q'Taco). Lee metadatos: tipo, referencia, fecha y teléfono; del `detalle` de un cierre solo se usa su comienzo para clasificarlo.
 * Nada de esto se imprime ni se devuelve salvo el evento mínimo { telefono, tipo, clave, ms } que `reunirCompras` agrupa.
 */
export async function leerCompras(db, tenant, excluir) {
  const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null);
  const eventos = []; const clavesDePrueba = [];
  const cierres = (await db.collection(`tenants/${tenant}/cierres`).where('tipo', 'in', ['registro', 'venta']).select('tipo', 'ocurridoEn', 'referencia').get()).docs;
  for (let i = 0; i < cierres.length; i += 100) {
    const lote = cierres.slice(i, i + 100);
    const privados = await db.getAll(...lote.map((d) => d.ref.collection('privado').doc('datos')), { fieldMask: ['telefono', 'detalle'] });
    lote.forEach((d, j) => {
      const x = d.data(); const p = privados[j].exists ? privados[j].data() : {};
      const tipo = clasificarCierre({ tipo: x.tipo, referencia: x.referencia, detalle: p.detalle });
      if (tipo === 'prueba') clavesDePrueba.push(x.referencia);
      if (tipo === 'pedido' || tipo === 'reserva') eventos.push({ telefono: p.telefono ?? '', tipo, clave: x.referencia, ms: ms(x.ocurridoEn) });
    });
  }
  // TODOS los orígenes de `pedidos` (whatsapp, catalogo-web…), con solo origen, conversación y fecha. Los estados `cancelado` y `reemplazado` TAMBIÉN cuentan: el bot escribió
  // «Registrado» al registrarse el pedido y nunca lo borra al cancelarse; este dato es «hubo un pedido registrado», no «se entregó».
  const pedidos = (await db.collection(`tenants/${tenant}/pedidos`).select('origen', 'conversacionId', 'creadoEn').get()).docs;
  for (const d of pedidos) {
    const x = d.data();
    eventos.push({ telefono: String(x.conversacionId ?? '').replace(/^wa_/, ''), tipo: 'pedido', clave: d.id, ms: ms(x.creadoEn), origen: typeof x.origen === 'string' ? x.origen : 'sin-origen' });
  }
  return reunirCompras(eventos, { excluir, clavesDePrueba });
}


// ===========================================================================
// COMPLETAR O/P/Q DE FILAS EXISTENTES (aplicar y revertir)
// ===========================================================================
const celdaDe = (letra, fila) => `${letra}${fila}`;
const leerCelda = (valores, mapa, celda) => {
  const m = /^([A-Z])(\d+)$/.exec(celda);
  return m ? String(valores[Number(m[2]) - mapa.filaEncabezados]?.[m[1].charCodeAt(0) - 65] ?? '') : '';
};

/** Relee la hoja, recalcula qué celdas O/P/Q siguen vacías y escribe SOLO esas (con respaldo previo, relectura y comparación). Devuelve el código de salida. */
async function completarExistentes({ cfg, deps, mapa, compras, log, rutaRespaldo }) {
  const valores = await deps.leer(); // justo antes de escribir: lo que dejó de estar vacío se respeta
  const { propuestas } = construirActualizaciones({ valores, mapa, compras });
  const celdas = propuestas.flatMap((p) => Object.entries(p.celdas).map(([letra, valor]) => ({ celda: celdaDe(letra, p.fila), valor, fila: p.fila, tel: p.telefono })));
  if (celdas.length === 0) { log('  ✓ Filas existentes: no hay celdas O/P/Q vacías que completar.'); return 0; }
  if (cfg.respaldo === null || rutaRespaldo === null) { log('\n  ✗ falta la ruta del respaldo\n'); return 2; }
  try {
    guardarRespaldo(rutaRespaldo, { version: 1, campo: 'relleno-crm-historico-completar', entorno: cfg.entorno, tenant: cfg.tenant, creadoEn: new Date().toISOString(), escrito: celdas.map((c) => ({ celda: c.celda, valor: c.valor })) });
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe el respaldo de las celdas (<ruta>.completar): un respaldo nunca se pisa. No se completó nada; use otra ruta y vuelva a correr.\n'); return 2; }
    throw e;
  }
  log(`  Respaldo de las ${celdas.length} celdas a completar (solo celda y valor, sin teléfonos): ${rutaRespaldo}`);
  try {
    await deps.completar(celdas.map((c) => ({ rango: `'${HOJA}'!${c.celda}`, valor: c.valor, fila: c.fila, tel: c.tel })));
  } catch (e) {
    // «celda ocupada» (alguien escribió, o la fila se movió, entre la relectura y la escritura) u otro fallo: el flujo corta ANTES de escribir, así que la hoja no cambia.
    // El respaldo queda con las celdas que se iban a escribir; revertirlo no borra nada (las celdas no tienen ese valor). Vuelva a correr el seco.
    log(`\n  ✗ No se completó nada (${e?.code ?? e?.name ?? 'error'}): la hoja cambió o el flujo falló antes de escribir. Vuelva a correr el seco. El respaldo guardado no corresponde a una escritura.\n`);
    return 3;
  }
  const despues = await deps.leer();
  const mal = celdas.filter((c) => leerCelda(despues, mapa, c.celda).trim() !== c.valor).length;
  if (mal) { log(`\n  ✗ La relectura no coincide en ${mal} celda(s). Revise la hoja; el respaldo permite revertir lo que sí quedó.\n`); return 3; }
  log(`  ✓ Filas existentes completadas y releídas: ${celdas.length} celda(s) O/P/Q.`);
  return 0;
}

async function revertirCompletar({ cfg, deps, mapa, r, log, rotulo }) {
  const letras = new Set(CAMPOS_COMPRA.map((c) => mapa.columnas[c].letra));
  const valido = r.version === 1 && r.tenant === cfg.tenant && r.entorno === cfg.entorno && Array.isArray(r.escrito) && r.escrito.length > 0 && r.escrito.length <= 2000
    && r.escrito.every((c) => c && typeof c.celda === 'string' && typeof c.valor === 'string' && c.valor !== '' && /^[A-Z]\d+$/.test(c.celda)
      && letras.has(c.celda[0]) && Number(c.celda.slice(1)) > mapa.filaEncabezados);
  if (!valido) { log('\n  ✗ el respaldo no es de este comercio y entorno, o no tiene la forma esperada (solo celdas O/P/Q): no se borra nada\n'); return 2; }
  const hoy = await deps.leer();
  const cambiadas = r.escrito.filter((c) => leerCelda(hoy, mapa, c.celda).trim() !== c.valor).length;
  log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO'} · ${rotulo}: ${r.escrito.length} celdas O/P/Q escritas por este script.`);
  if (cambiadas) { log(`  ✗ ${cambiadas} celda(s) ya no tienen lo que escribió este script: alguien las cambió. No se borra nada.\n`); return 2; }
  if (!cfg.aplicar) { log('  Seco: no se borró nada. Agregue --aplicar para limpiar esas celdas.\n'); return 1; }
  await deps.limpiarCeldas(r.escrito.map((c) => `'${HOJA}'!${c.celda}`));
  const despues = await deps.leer();
  if (r.escrito.some((c) => leerCelda(despues, mapa, c.celda).trim() !== '')) { log('  ✗ Alguna celda no quedó vacía; revise la hoja.\n'); return 3; }
  log('  ✓ Celdas limpiadas.\n');
  return 0;
}

// ===========================================================================
// EJECUCIÓN
// ===========================================================================
export async function ejecutar(cfg, deps) {
  const log = deps.log ?? ((t) => console.log(t));
  const mapa = deps.mapa ?? leerMapa(cfg.tenant);
  const rotulo = `${cfg.entorno} · ${cfg.tenant}`;

  if (cfg.revertir) {
    const l = leerRespaldoGenerico(cfg.respaldo, { limite: 512 * 1024 });
    if (!l.ok) { log(`\n  ✗ ${l.motivo}\n`); return 2; }
    const r = l.respaldo;
    if (r?.campo === 'relleno-crm-historico-completar') return revertirCompletar({ cfg, deps, mapa, r, log, rotulo });
    if (r?.version !== 1 || r.campo !== 'relleno-crm-historico' || r.tenant !== cfg.tenant || r.entorno !== cfg.entorno || !Array.isArray(r.escrito)) {
      log('\n  ✗ el respaldo no es de este comercio y entorno, o no tiene la forma esperada\n'); return 2;
    }
    // El rango a limpiar se CALCULA (nunca se confía en el del archivo): desde `filaDesde`, tantas filas como se escribieron, hasta la última letra del bot (jamás la U).
    const ultima = Object.values(mapa.columnas).map((c) => c.letra).sort().pop();
    if (!Number.isInteger(r.filaDesde) || r.filaDesde <= mapa.filaEncabezados || r.escrito.length === 0 || r.escrito.length > 2000) {
      log('\n  ✗ el respaldo trae una fila inicial o una cantidad que no son válidas: no se borra nada\n'); return 2;
    }
    const rangoALimpiar = `'${HOJA}'!A${r.filaDesde}:${ultima}${r.filaDesde + r.escrito.length - 1}`;
    const hoy = await deps.leer(); // A3:T completo
    const desde = r.filaDesde - mapa.filaEncabezados;
    // Se comparan SOLO el ID y el teléfono: Google reformatea las fechas al leerlas (formato regional) y compararlas haría imposible revertir.
    const claves = [mapa.columnas.id.letra, mapa.columnas.telefono.letra].map((l) => l.charCodeAt(0) - 65);
    const dig = (v) => String(v ?? '').replace(/^'/, '').trim();
    const actual = hoy.slice(desde, desde + r.escrito.length).map((f) => claves.map((j) => dig(f[j])));
    const esperado = r.escrito.map((f) => claves.map((j) => dig(f[j])));
    const igual = actual.length === esperado.length && actual.every((f, i) => f.every((v, j) => v === esperado[i][j]));
    // El rango que se limpia (A..T) incluye las columnas del EQUIPO (J, K, M y L): si el equipo anotó algo en esas filas, revertir lo borraría. Se rechaza.
    const filasHoy = hoy.slice(desde, desde + r.escrito.length);
    const idxEq = (c) => (c && c.letra <= ultima ? c.letra.charCodeAt(0) - 65 : -1);
    const anotadas = filasHoy.some((f) => ['valor', 'responsable', 'proximaAccion'].some((k) => { const j = idxEq(mapa.equipo[k]); return j >= 0 && String(f[j] ?? '').trim() !== ''; })
      || (idxEq(mapa.equipo.estado) >= 0 && String(f[idxEq(mapa.equipo.estado)] ?? '').trim() !== '' && String(f[idxEq(mapa.equipo.estado)]).trim() !== String(mapa.alCrear.estado ?? '')));
    if (igual && anotadas) { log('\n  ✗ El equipo anotó algo en esas filas (valor, responsable, estado o próxima acción): revertir lo borraría. No se borra nada; quite esas filas a mano.\n'); return 2; }
    log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO'} · ${rotulo}: ${r.escrito.length} filas escritas por este script.`);
    if (!igual) { log('  ✗ El rango ya no tiene lo que escribió este script: alguien lo cambió. No se borra nada.\n'); return 2; }
    if (!cfg.aplicar) { log('  Seco: no se borró nada. Agregue --aplicar para limpiar ese rango.\n'); return 1; }
    await deps.limpiar(rangoALimpiar);
    log('  ✓ Rango limpiado.\n');
    return 0;
  }

  const conCompras = TENANTS_CON_COMPRAS.includes(cfg.tenant) && typeof deps.compras === 'function';
  if (conCompras && cfg.aplicar && (deps.excluir ?? []).map((t) => CRM.crmDigitos(t)).filter(Boolean).length === 0) {
    log('\n  ✗ --aplicar en este comercio exige TELEFONOS_EXCLUIDOS (los teléfonos de prueba, dígitos separados por comas) en el entorno: sin ellos se cargarían pedidos de prueba. No se escribe nada.\n');
    return 2;
  }
  const [conversacionesTodas, valores, resultadoCompras] = await Promise.all([deps.conversaciones(), deps.leer(), conCompras ? deps.compras() : Promise.resolve(null)]);
  const compras = resultadoCompras?.porTelefono ?? new Map();
  // Los teléfonos de prueba (TELEFONOS_EXCLUIDOS) tampoco entran como contactos nuevos.
  const fuera = new Set((deps.excluir ?? []).map((t) => CRM.crmDigitos(t)).filter(Boolean));
  const conversaciones = conversacionesTodas.filter((c) => !fuera.has(CRM.crmDigitos(c.telefono)));
  const conversacionesExcluidas = conversacionesTodas.length - conversaciones.length;
  if (valores.length === 0) { log('\n  ✗ la hoja no se pudo leer (fila de encabezados vacía): no se escribe nada.\n'); return 3; }
  // Los títulos de la fila de encabezados tienen que ser los del mapa, letra por letra: si el equipo movió columnas, se escribiría en las equivocadas.
  const esperados = encabezadosEsperados(mapa);
  const malos = esperados.map((t, j) => (String(valores[0][j] ?? '').trim() === t ? null : t)).filter((t) => t !== null);
  if (malos.length) { log(`\n  ✗ Los encabezados de la fila ${mapa.filaEncabezados} no son los del mapa (${malos.length} distinto/s, p. ej. «${malos[0]}»): no se escribe nada.\n`); return 3; }
  const hoja = resumenDeLaHoja(valores, mapa);
  const { filas, omitidos, conteos } = construirFilas({ conversaciones, hoja, mapa, compras });
  log(`\n  ${cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)'} · ${rotulo}\n`);
  log(`  conversaciones en Firestore : ${conteos.conversaciones}${conversacionesExcluidas ? ` (más ${conversacionesExcluidas} excluidas por TELEFONOS_EXCLUIDOS)` : ''}`);
  log(`  filas ya en la hoja         : ${hoja.telefonos.filter((t) => String(t).trim() !== '').length}`);
  log(`  se saltan (ya tienen fila)  : ${omitidos.yaTienenFila}`);
  log(`  se saltan (sin teléfono)    : ${omitidos.sinTelefono + omitidos.repetidos}`);
  log(`  filas a crear               : ${conteos.aCrear}  (con anuncio: ${conteos.conAnuncio}; con nombre: ${conteos.conNombre})`);
  let a = { aCompletar: 0 };
  if (conCompras) {
    const c = resultadoCompras.conteos; const d = c.descartados;
    log(`  compras registradas antes   : ${c.pedidos} pedidos y ${c.reservas} reservas distintos, de ${compras.size} teléfonos (descartados: sin teléfono ${d.sinTelefono}, sin fecha ${d.sinFecha}, excluidos ${d.excluidos}, de prueba ${d.pruebas ?? 0})`);
    log(`  contactos que solo están en sus compras (sin conversación): ${conteos.soloCompra}`);
    log(`  pedidos por origen          : ${Object.entries(c.porOrigen ?? {}).map(([o, n]) => `${o} ${n}`).join(', ') || 'ninguno'} (cierre = solo figura en un cierre)`);
    log(`  filas a crear con compra    : ${conteos.conCompra}  (con pedido: ${conteos.conPedido}; con reserva: ${conteos.conReserva})`);
    a = construirActualizaciones({ valores, mapa, compras }).conteos;
    log(`  filas YA en la hoja con compra: ${a.existentesConCompra}  -> a completar: ${a.aCompletar} fila(s), ${a.celdas} celda(s) O/P/Q vacías; sin huecos: ${a.sinHuecos}; teléfonos con varias filas: ${a.conVariasFilas}`);
    log(cfg.aplicar ? '  (con --aplicar se completan SOLO esas celdas O/P/Q vacías; lo que ya tenga dato no se toca)' : '  (seco: las celdas a completar solo se escriben con --aplicar)');
  }
  const porCompletar = a.aCompletar;
  if (conteos.aCrear === 0) {
    if (porCompletar === 0) { log('\n  ✓ Nada que crear ni completar: la hoja ya tiene a todos.\n'); return 0; }
    if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar --respaldo <ruta> --confirmo-produccion <tenant> para completar.\n'); return 1; }
    const c = await completarExistentes({ cfg, deps, mapa, compras, log, rutaRespaldo: cfg.respaldo });
    log('');
    return c;
  }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar --respaldo <ruta> para escribir.\n'); return 1; }

  const filaDesde = hoja.ultimaFila + 1;
  const rango = `'${HOJA}'!A${filaDesde}:${conteos.ultima}${filaDesde + filas.length - 1}`;
  // El rango es explícito: antes de escribir se relee y, si el bot agregó una fila mientras tanto, NO se escribe (se pisaría).
  const ahora = resumenDeLaHoja(await deps.leer(), mapa);
  if (ahora.ultimaFila !== hoja.ultimaFila) { log('\n  ✗ La hoja cambió mientras se preparaba (el bot escribió una fila): no se escribe nada. Vuelva a correr el seco.\n'); return 3; }
  // Si también hay celdas por completar, su respaldo no puede existir: se comprueba ANTES de escribir las filas nuevas (así nunca queda a medias por eso).
  if (porCompletar > 0 && existsSync(`${cfg.respaldo}.completar`)) { log('\n  ✗ Ya existe <ruta>.completar: use otra ruta de respaldo. No se escribió nada.\n'); return 2; }
  try {
    guardarRespaldo(cfg.respaldo, { version: 1, campo: 'relleno-crm-historico', entorno: cfg.entorno, tenant: cfg.tenant, creadoEn: new Date().toISOString(),
      rango, filaDesde, escrito: filas });
  } catch (e) {
    if (e?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa. No se escribe nada.\n'); return 2; }
    throw e;
  }
  log(`\n  Respaldo guardado (las filas a escribir y dónde; no copia la hoja): ${cfg.respaldo}`);
  const respuesta = await deps.agregar(filas, filaDesde);
  // DÓNDE quedaron de verdad: `values:update` lo dice en `updatedRange` (`values:append` lo decía en `updates.updatedRange`; se acepta cualquiera).
  const real = /!A(\d+):[A-Z]+(\d+)$/.exec(String(respuesta?.updatedRange ?? respuesta?.updates?.updatedRange ?? ''));
  if (!real || Number(real[1]) !== filaDesde || Number(real[2]) !== filaDesde + filas.length - 1) {
    log(`\n  ✗ Las filas no quedaron donde se esperaba (esperado ${rango.split('!')[1]}, Google dice ${real ? `filas ${real[1]} a ${real[2]}` : 'otra cosa'}). Revise la hoja a mano; el respaldo NO sirve para revertir esa escritura.\n`);
    return 3;
  }
  const despues = resumenDeLaHoja(await deps.leer(), mapa);
  const nuevos = new Set(filas.map((f) => CRM.crmDigitos(f[mapa.columnas.telefono.letra.charCodeAt(0) - 65])));
  const presentes = new Set(despues.telefonos.map((t) => CRM.crmDigitos(t)).filter((t) => nuevos.has(t))).size;
  if (presentes !== nuevos.size) { log(`\n  ✗ La relectura no coincide: esperadas ${nuevos.size} filas nuevas, se ven ${presentes}. Revise la hoja; el respaldo permite revertir.\n`); return 3; }
  // Carrera con el bot vivo: si escribió una fila a la vez, puede haber IDs o teléfonos repetidos. Se revisa toda la hoja.
  const repetidos = (lista) => { const v = lista.map((x) => String(x ?? '').trim().toLowerCase()).filter(Boolean); return v.length - new Set(v).size; };
  const rIds = repetidos(despues.ids);
  const rTel = repetidos(despues.telefonos.map((t) => CRM.crmDigitos(t)));
  if (rIds || rTel) { log(`\n  ✗ La hoja quedó con ${rIds} ID(s) y ${rTel} teléfono(s) repetidos (el bot escribió a la vez). Revise esas filas a mano.\n`); return 3; }
  log(`\n  ✓ Escritas y releídas: ${filas.length} filas (${rango.split('!')[1]}).`);
  log('  Para deshacer: --revertir con el mismo respaldo, comercio y proyecto.\n');
  if (porCompletar > 0) {
    const c = await completarExistentes({ cfg, deps, mapa, compras, log, rutaRespaldo: `${cfg.respaldo}.completar` });
    log('');
    return c;
  }
  return 0;
}

async function principal() {
  const a = analizarArgumentos(process.argv.slice(2));
  if (!a.ok) { console.error(`\n  ✗ ${a.problemas.join('\n  ✗ ')}\n\n${USO}\n`); process.exit(2); }
  const { cfg } = a;
  const mapa = leerMapa(cfg.tenant);
  const excluir = String(process.env.TELEFONOS_EXCLUIDOS ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const args = { envFile: process.env.ENV_FILE, tenant: cfg.tenant, sheet: process.env.SHEET_ID, mapa };
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  const codigo = await ejecutar(cfg, {
    mapa,
    conversaciones: () => leerConversaciones(db, cfg.tenant),
    excluir,
    compras: () => leerCompras(db, cfg.tenant, excluir),
    leer: () => leerHoja(args),
    agregar: (filas, filaDesde) => agregarFilas({ ...args, filas, filaDesde }),
    limpiar: (rango) => limpiarRango({ ...args, rango }),
    completar: (celdas) => completarCeldas({ ...args, celdas }),
    limpiarCeldas: (rangos) => limpiarCeldas({ ...args, rangos }),
  });
  await db.terminate().catch(() => {});
  process.exit(estado.limpiezaFallida ? 3 : codigo);
}

function seEjecutaDirecto() {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}
if (seEjecutaDirecto()) {
  try { await principal(); } catch (e) { console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`); process.exit(3); }
}
