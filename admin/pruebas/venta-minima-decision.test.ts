/**
 * LA DECISIÓN DEL TURNO DE «VENTA MÍNIMA v0» (`Flujos/experimental/venta-minima/src/nodos/{decidir-turno,plan-del-turno}.js`).
 *
 * `Decidir turno` elige la acción sin llamar a ningún modelo; `Plan del turno` arma los mensajes, el aviso, el
 * cierre y el estado nuevo. Las dos reglas que sostienen esta suite (CLAUDE.md, PROHIBICIÓN 3 y política «solo se
 * ofrece lo que se cumple»):
 *   - un «sí» escrito NO confirma nada: la confirmación se pide siempre con botones;
 *   - el cliente solo lee «ya pasé tu pedido» o «llegó al restaurante» si el aviso salió: el plan trae los dos
 *     textos (`condicionados`) y `Armar mensajes` (T7b) elige uno según los `wamid` del aviso.
 *
 * LAS LIBRERÍAS NO ESTÁN ACÁ. Las escriben otros agentes a la vez (comun, pedido, reserva, avisos, promos, cobro).
 * Esta suite define DOBLES MÍNIMOS de lo que estos dos nodos llaman, con el contrato del diseño (§4.2) y lo que
 * suponen los nodos; los dobles viven solo en este archivo, nunca en el código de producción. Lo que suponen:
 *   - `vmIdEstable` (B0): la clave sale de (ancla, teléfono, contenido), nunca del reloj; `pdNuevoPedido` la usa para `pedidoId` y `codigo`.
 *   - `pdCarta`/`pdAgregarLineas`/`pdResolverForma`: la carta tiene `forma` y `piezas`; un producto con una orden y
 *     unidades sueltas pregunta si la cantidad es múltiplo de las piezas; `pendiente` = {cantidad, producto,
 *     opciones: [itemOrden, itemUnidad]}; `pdResolverForma` devuelve {carrito}.
 *   - `pdTotal` suma en centavos y devuelve Bs; `pdResumen` devuelve el texto completo del resumen.
 *   - `rsValidar`: el campo inválido queda vacío y va en `faltan`; `error` es solo el primero.
 *   - `cbTextoAlCliente` devuelve {cuerpo, enlace, aviso}; `cbResultado(resp, previo)` como `cobro.js`.
 *   - `vmLeerEstado` devuelve el estado guardado por teléfono (60 min; 24 h en `esperando_comprobante`).
 * Lo que `Armar mensajes` (T7b) hace con el plan se simula en `turno()`: guarda `estadoNuevo`, guarda `pedido` y,
 * si `aviso.tipo === 'reserva'`, llama `rsAnotar` (sin ese llamado el tope diario no funciona: hay una prueba).
 *
 * Reloj: lunes 05/10/2026 10:00 en La Paz = `Date.UTC(2026, 9, 5, 14)`. Teléfonos sintéticos con seis ceros.
 * Las pruebas usan `ejecutar` de `./lib/flujo` (que quita los globales que el sandbox de n8n no tiene).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar } from './lib/flujo';

const NODOS = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/venta-minima/src/nodos');
const DECIDIR = readFileSync(join(NODOS, 'decidir-turno.js'), 'utf8');
const PLAN = readFileSync(join(NODOS, 'plan-del-turno.js'), 'utf8');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;

// La red de palabras que el asistente jamás dice (`VM_PROHIBIDAS` de comun.js, literal del diseño §4.2).
const PROHIBIDAS = /validad|confirmad|pagad[oa]|acreditad|verificad|recibimos\s+tu\s+pago|ya lo (est[aá]n )?prepar|lo preparamos|te avisa(mos|remos)|en camino|te llama(mos|remos)|te escribir[aá]n|lo consulto/i;

// --- Los dobles de las librerías --------------------------------------------------------------
const DOBLES = String.raw`
function vmNodo(n){ try { const x = $(n); return x && x.isExecuted ? x : null; } catch (e) { return null; } }
function vmPrimero(n){ const x = vmNodo(n); if (!x) return null; const i = x.first(); return i && i.json ? i.json : null; }
function vmCfg(){ return vmPrimero('Config del negocio') || {}; }
function vmNorm(t){ return String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function vmLinea(t, max){ const s = String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f<>&]+/g, ' ').replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max).trimEnd() : s; }
function vmEnlaceDeMapa(v){ if (typeof v !== 'string') return ''; const t = v.trim(); return t.length <= 200 && /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.com\/maps|google\.com\/maps|maps\.google\.com)([/?][A-Za-z0-9._~:/?#@!$&()*+,;=%-]*)?$/.test(t) ? t : ''; }
function vmRecorte(t, max){ const s = String(t == null ? '' : t); return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s; }
function vmTextoDeGemini(j){ if (!j || j.error) return ''; const c = j.candidates && j.candidates[0]; return c && c.content && c.content.parts ? c.content.parts.map(function(p){ return p.text || ''; }).join('\n') : ''; }
function vmJsonDeGemini(j){ const t = vmTextoDeGemini(j).trim(); if (!t) return null; try { const o = JSON.parse(t); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch (e) { return null; } }
function vmSd(){ try { const g = $getWorkflowStaticData('global'); if (!g.ventaMinima) g.ventaMinima = {}; return g.ventaMinima; } catch (e) { return null; } }
function vmEstadoBase(){ return { paso: 'inicio', ultimoMensajeMs: 0 }; }
function vmLeerEstado(sd, from, ahora){ const e = sd && sd.estados && sd.estados[from]; if (!e) return vmEstadoBase(); const vida = e.paso === 'esperando_comprobante' ? 86400000 : 3600000; return ahora - e.ultimoMensajeMs < vida ? JSON.parse(JSON.stringify(e)) : vmEstadoBase(); }
function vmIdDeBoton(){ return Array.prototype.slice.call(arguments).join('|'); }
function vmLeerBoton(id){ const p = String(id).split('|'); return p.length >= 2 && /^[a-z]$/.test(p[0]) ? { tipo: p[0], partes: p.slice(1) } : null; }
function vmCodigoCorto(ms){ return ms.toString(36).slice(-4).toUpperCase(); }
function vmSinProhibidas(t){ return String(t == null ? '' : t).replace(new RegExp(${JSON.stringify(PROHIBIDAS.source)}, 'gi'), '…'); }
function vmEnlaceDeMapa(v){ const t = typeof v === 'string' ? v.trim() : ''; return t.length <= 200 && /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.com\/maps|google\.com\/maps|maps\.google\.com)([/?][A-Za-z0-9._~:/?#@!$&()*+,;=%-]*)?$/.test(t) ? t : ''; }
function vmHorario(csv){ const o = {}; let mal = false; String(csv).split(',').forEach(function(p){ const kv = p.split('='); const v = (kv[1] || '').trim(); if (v === 'cerrado') o[kv[0].trim()] = []; else { const m = /^(\d\d:\d\d)-(\d\d:\d\d)$/.exec(v); if (m) o[kv[0].trim()] = [{ desde: m[1], hasta: m[2] }]; else mal = true; } }); return mal ? null : o; }
function vmAbierto(h, ms){ const l = new Date(ms - 4 * 3600000); const dia = ['dom','lun','mar','mie','jue','vie','sab'][l.getUTCDay()]; const hm = ('0' + l.getUTCHours()).slice(-2) + ':' + ('0' + l.getUTCMinutes()).slice(-2); const tr = h[dia] || []; return { abierto: tr.some(function(x){ return hm >= x.desde && hm < x.hasta; }), hoyCerrado: !tr.length }; }

function pdCarta(cat, o){ const ex = (o.areasExcluidas || []).map(vmNorm); return cat.filter(function(i){ return typeof i.precio === 'number' && i.precio > 0 && i.agotado !== true && ex.indexOf(vmNorm(i.area)) < 0; }).map(function(i){ const n = vmNorm(i.nombre); const m = /orden de (\d+)/.exec(n); return Object.assign({}, i, { forma: /\b(orden|porcion|plato)\b/.test(n) ? 'orden' : (/\b(unidad|suelto)\b/.test(n) ? 'unidad' : ''), piezas: m ? Number(m[1]) : 1 }); }); }
function pdCuerpoExtraccion(texto, carta, o){ return { marcador: 'pedido', texto: texto, ahoraMs: o.ahoraMs, items: carta.length }; }
function pdTextoDeLaCarta(carta, o){ const lineas = carta.map(function(i){ return '• ' + i.nombre + ': ' + i.precio + ' Bs'; }); const partes = []; let cur = ''; lineas.forEach(function(l){ if (cur && (cur + '\n' + l).length > o.max) { partes.push(cur); cur = l; } else cur = cur ? cur + '\n' + l : l; }); if (cur) partes.push(cur); return partes; }
function pdValidarExtraccion(o){ return { lineas: (o.lineas || []).filter(function(l){ return l && l.producto && l.cantidad > 0; }).map(function(l){ return { producto: String(l.producto), cantidad: Math.floor(l.cantidad), forma: l.forma || '', detalle: l.detalle || '' }; }), entrega: o.entrega || '', direccion: o.direccion || '', referencia: o.referencia || '', nombre: o.nombre || '', quiereHablar: o.quiereHablar === true }; }
function pdBuscar(carta, producto){ const p = vmNorm(producto); if (!p) return { estado: 'ninguno', sugerencias: [] }; const m = carta.filter(function(i){ return i.clave === p || vmNorm(i.nombre).indexOf(p) >= 0 || (i.clave || '').indexOf(p) >= 0; }); if (m.length === 1) return { estado: 'unico', item: m[0] }; if (m.length === 2 && m[0].clave === m[1].clave && m[0].forma === 'orden' && m[1].forma === 'unidad') return { estado: 'forma', opciones: m }; if (m.length > 1) return { estado: 'ambiguo', opciones: m.slice(0, 3) }; return { estado: 'ninguno', sugerencias: carta.filter(function(i){ return vmNorm(i.nombre).split(' ')[0] === p.split(' ')[0]; }).slice(0, 3) }; }
function _sumar(car, item, cantidad, detalle){ car.push({ id: item.id, nombre: item.nombre, cantidad: cantidad, detalle: detalle || '', precio: item.precio, area: item.area }); }
function pdAgregarLineas(carrito, carta, lineas){ const car = carrito.slice(); const pendiente = []; const noEncontrados = []; lineas.forEach(function(l){ const b = pdBuscar(carta, l.producto); if (b.estado === 'unico') _sumar(car, b.item, l.cantidad, l.detalle); else if (b.estado === 'forma') { const o = b.opciones[0]; const u = b.opciones[1]; if (l.forma === 'orden') _sumar(car, o, l.cantidad, l.detalle); else if (l.forma === 'unidad') _sumar(car, u, l.cantidad, l.detalle); else if (l.cantidad % o.piezas === 0) pendiente.push({ cantidad: l.cantidad, producto: l.producto, opciones: b.opciones, detalle: l.detalle, piezas: o.piezas, ordenes: l.cantidad / o.piezas, totalOrden: o.precio * l.cantidad / o.piezas, totalUnidad: u.precio * l.cantidad }); else _sumar(car, u, l.cantidad, l.detalle); } else noEncontrados.push({ cantidad: l.cantidad, producto: l.producto, sugerencias: b.sugerencias, opciones: b.opciones }); }); return { carrito: car, pendiente: pendiente, noEncontrados: noEncontrados }; }
function pdResolverForma(carrito, lista, forma){ const car = carrito.slice(); const p = lista[0]; if (forma === 'orden') _sumar(car, p.opciones[0], p.ordenes, p.detalle); else _sumar(car, p.opciones[1], p.cantidad, p.detalle); return { carrito: car, pendiente: lista.slice(1), noEncontrados: [] }; }
function pdQuitarSinDelivery(carrito, carta, areas){ const ex = areas.map(vmNorm); const quitados = []; const car = carrito.filter(function(l){ if (ex.indexOf(vmNorm(l.area)) >= 0) { quitados.push(l.nombre); return false; } return true; }); return { carrito: car, quitados: quitados }; }
function pdTotal(carrito){ return carrito.reduce(function(s, l){ return s + Math.round(l.precio * 100) * l.cantidad; }, 0) / 100; }
function _pdUbicacion(u){ return !!u && typeof u === 'object' && Number.isFinite(u.lat) && Number.isFinite(u.lng) && Math.abs(u.lat) <= 90 && Math.abs(u.lng) <= 180 && !(Math.round(u.lat * 1e5) === 0 && Math.round(u.lng * 1e5) === 0); }
function _pdCopiaUbicacion(u){ return { lat: Math.round(u.lat * 1e5) / 1e5, lng: Math.round(u.lng * 1e5) / 1e5 }; }
function pdFaltanEntrega(e, perfil){ const f = []; if (!e.direccion && !e.ubicacion) f.push('direccion'); return f; }
function pdResumen(carrito, e, o){ return 'Tu pedido:\n' + carrito.map(function(l){ return '• ' + l.cantidad + ' × ' + l.nombre + (l.detalle ? ' (' + l.detalle + ')' : '') + ': ' + (l.precio * l.cantidad) + ' ' + o.moneda; }).join('\n') + '\nEntrega: ' + (e.entrega === 'delivery' ? 'delivery a ' + e.direccion + (e.referencia ? ' (' + e.referencia + ')' : '') + ', recibe ' + e.nombre : 'recojo en el local') + '.\nTotal de la comida: ' + pdTotal(carrito) + ' ' + o.moneda + '.' + (e.entrega === 'delivery' ? '\nEl delivery no está incluido: se lo pagas al repartidor al recibir.' : ''); }
function pdLineaCompacta(carrito, max){ return carrito.map(function(l){ return l.cantidad + ' ' + l.nombre; }).join(', ').slice(0, max); }
function vmIdEstable(pre, from, cont, ancla, resp){ const a = ancla > 0 ? ancla : resp; const t = JSON.stringify([pre, a, from, cont]); let h = 7; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 0x100000000; return { id: pre + '-2026-10-05-' + String(from).slice(-4) + '-' + h.toString(36), codigo: vmCodigoCorto(h), huella: h }; }
function pdNuevoPedido(from, perfil, carrito, e, total, moneda, ahora, ancla){ const k = vmIdEstable('ped', from, carrito, ancla, ahora); return { pedidoId: k.id, codigo: k.codigo, from: from, lineas: carrito.slice(), entrega: Object.assign({}, e), modalidad: e.entrega, total: pdTotal(carrito), moneda: 'BOB', mediaId: null, resultado: null, errores: [] }; }
function pdMonto(n, m){ const c = Math.round(n * 100); return Math.floor(c / 100) + (c % 100 ? ',' + ('0' + (c % 100)).slice(-2) : '') + ' ' + m; }
function pdLineasAviso(carrito){ return carrito.map(function(l){ return { cantidad: l.cantidad, nombre: l.nombre, detalle: l.detalle }; }); }
function pdTextoForma(p, o){ return '¿«' + p.cantidad + ' ' + p.producto + '» es ' + (p.ordenes === 1 ? '1 orden' : p.ordenes + ' órdenes') + ' de ' + p.piezas + ' (' + pdMonto(p.totalOrden, o.moneda) + ') o ' + p.cantidad + ' sueltos (' + pdMonto(p.totalUnidad, o.moneda) + ')?'; }
function pdTextoNoEncontrado(n){ const sug = (n.sugerencias || []).map(function(i){ return i.nombre; }).slice(0, 3); return 'No encuentro «' + n.producto + '» en la carta.' + (sug.length ? ' ¿Es alguno de estos: ' + sug.join(', ') + '?' : ' ¿Me lo escribes como figura en la carta?'); }
function pdExcluidos(cat, o){ const ex = ((o && o.areasExcluidas) || []).map(vmNorm); return cat.filter(function(i){ return ex.indexOf(vmNorm(i.area)) >= 0; }); }
function pdNombreCorto(i){ return String(i.nombre).replace(/\s*\([^)]*(orden|unidad)[^)]*\)/gi, '').trim(); }
function pdEjemploDePedido(c){ const v = []; const n = []; (Array.isArray(c) ? c : []).forEach(function(i){ const k = i.clave || pdNombreCorto(i); if (n.length < 2 && v.indexOf(k) < 0) { v.push(k); n.push('1 ' + pdNombreCorto(i)); } }); return n.join(' y '); }
function pdTextoExcluido(n){ return 'Lo siento, «' + n + '» no está disponible para pedir por WhatsApp. ¿Te muestro la carta?'; }
function pdBotonAgregar(i, c){ return { id: 'g|agregar|' + i.id + '|' + c, title: 'Agregar ' + pdNombreCorto(i) }; }
function pdTextoFaltanEntrega(f){ return 'Para el delivery necesito la dirección exacta.'; }

function rsCuerpoExtraccion(texto, o){ if (!isFinite(Number(o.ahoraMs))) throw new Error('ahoraMs'); return { marcador: 'reserva', texto: texto, zonas: o.zonas }; }
function rsValidarExtraccion(o){ o = o || {}; return { personas: Number(o.personas) || 0, fecha: o.fecha || '', hora: o.hora || '', zona: o.zona || '', nombre: o.nombre || '', celebracion: o.celebracion || '', requerimiento: o.requerimiento || '' }; }
function rsFusionar(a, b){ const x = rsValidarExtraccion(a); const y = rsValidarExtraccion(b); const r = {}; Object.keys(x).forEach(function(k){ r[k] = y[k] ? y[k] : x[k]; }); return r; }
function rsValidar(r, c, perfil, ahora){ const x = rsValidarExtraccion(r); const res = Object.assign({}, x, { grupoGrande: false }); let error = null; const marcar = function(campo, texto){ if (!error) error = { campo: campo, texto: texto }; res[campo] = campo === 'personas' ? 0 : ''; }; if (!c.horario) error = { campo: 'horario', texto: 'En este momento no puedo tomar solicitudes de reserva.' }; const hoy = new Date(ahora - 4 * 3600000).toISOString().slice(0, 10); if (res.fecha && res.fecha < hoy) marcar('fecha', 'Esa fecha ya pasó. ¿Para qué día quieres la reserva?'); const zonas = c.zonas || []; if (res.zona && zonas.length && zonas.map(vmNorm).indexOf(vmNorm(res.zona)) < 0) marcar('zona', 'No tengo «' + res.zona + '» como opción.'); if (!res.nombre && vmNorm(perfil).split(' ').length >= 2) res.nombre = perfil; const faltan = ['personas', 'fecha', 'hora', 'nombre'].filter(function(k){ return !res[k]; }); return { completa: !faltan.length && !error, faltan: faltan, error: error, reserva: res, grupoGrande: false }; }
function rsPreguntaFaltantes(f, o){ if (f.indexOf('personas') >= 0 && f.indexOf('fecha') >= 0 && f.indexOf('hora') >= 0) return 'Para tu solicitud de reserva dime, en un solo mensaje: cuántas personas, qué día y a qué hora, si prefieres ' + (o.zonas || []).join(' o ') + ' y a nombre de quién.'; return f.length ? 'Para tu solicitud de reserva me falta saber ' + f.join(', ') + '.' : ''; }
function rsResumen(r){ return 'Tu reserva:\n• ' + r.fecha + ' ' + r.hora + '\n• ' + r.personas + ' personas' + (r.zona ? ', ' + r.zona : '') + '\n• A nombre de ' + r.nombre; }
function rsFraseDeConfirmacion(r){ return 'el ' + r.fecha + ' a las ' + r.hora + ', ' + r.personas + ' personas' + (r.zona ? ', ' + r.zona : ''); }
function rsLineaCompacta(r, rol){ return (rol === 'completo' ? r.nombre : r.nombre.split(' ')[0]) + ' · ' + r.fecha + ' ' + r.hora + ' · ' + r.personas + ' personas'; }
function rsReclamo(t){ return false; }
function rsHoraSuelta(t, r, c, a){ return ''; }
function rsDentroDelTope(sd, from, ahora, tope){ const max = Number(tope); if (!sd || !isFinite(max)) return false; const hoy = new Date(ahora - 4 * 3600000).toISOString().slice(0, 10); const t = sd.reservasDelDia && sd.reservasDelDia[from]; return (t && t.dia === hoy ? t.n : 0) < max; }
function rsAnotar(sd, from, ahora){ const hoy = new Date(ahora - 4 * 3600000).toISOString().slice(0, 10); sd.reservasDelDia = sd.reservasDelDia || {}; const t = sd.reservasDelDia[from]; const n = (t && t.dia === hoy ? t.n : 0) + 1; sd.reservasDelDia[from] = { dia: hoy, n: n }; return n; }

function _vig(c, ahora){ const i = Date.parse(c.inicio); const f = Date.parse(c.fin); return isFinite(i) && isFinite(f) && i <= ahora && ahora < f; }
function prCampanaDelTexto(campanas, texto, ahora){ const n = vmNorm(texto); return campanas.find(function(c){ return vmNorm(c.texto) === n && _vig(c, ahora); }) || null; }
function prFicha(c, carta, ahora){ if (!c || !_vig(c, ahora)) return null; const t = ' ' + vmNorm(c.texto) + ' '; const m = carta.filter(function(i){ return t.indexOf(' ' + vmNorm(i.nombre) + ' ') >= 0; }); return m.length ? { id: String(m[0].id), nombre: m[0].nombre, precio: m[0].precio } : null; }
function prTexto(f, cfg){ if (!f) return null; const b = []; if (cfg.pedidosActivo === true) b.push({ id: 'g|pedir|' + f.id, title: 'Pedir la promo' }); if (cfg.reservasActivo === true) b.push({ id: 'm|reserva', title: 'Reservar mesa' }); if (cfg.pedidosActivo === true) b.push({ id: 'm|pedido', title: 'Ver la carta' }); return { cuerpo: '¡Hola! Qué bueno que viste nuestra promo. ' + f.nombre + '. Precio: ' + f.precio + ' Bs.', botones: b }; }

function cbCodigo(c){ return String(c === undefined || c === null ? '' : c).replace(/[^A-Za-z0-9]/g, '').slice(0, 12); }
function cbHayQr(c){ c = c || {}; if (!/^https:\/\//i.test(String(c.qrUrl || ''))) return false; if (c.modo === 'real') return c.activo === true; if (c.modo === 'simulado') return c.activo !== true; return false; }
function cbQrVencido(c, ahora){ c = c || {}; if (c.modo !== 'real') return false; const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof c.venceEl === 'string' ? c.venceEl : ''); if (!m) return false; const f = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59) + 4 * 3600000; return Number.isFinite(f) && Number.isFinite(Number(ahora)) && f <= Number(ahora); }
function cbCaption(p, o){ if (o.simulado === true) return 'PRUEBA · COBRO SIMULADO: este QR es de demostración, no cobra ni mueve dinero.\nPedido #' + p.codigo + '. Total de la prueba: ' + p.total + ' Bs (solo la comida' + (o.delivery === true ? '; el delivery se paga aparte' : '') + ').\nNo intentes pagarlo. Envíame aquí cualquier foto como comprobante simulado.'; return 'Pedido #' + p.codigo + '. Total a pagar con este QR: ' + p.total + ' Bs (solo la comida' + (o.delivery === true ? '; el delivery se paga aparte, al repartidor' : '') + ').\nEscanéalo con la app de tu banco.'; }
function cbResultado(resp, previo){ const r = resp || {}; const b = r.body || {}; let res = 'sin_cotejo'; if (r.statusCode === 200 && ['cuadra', 'no_cuadra', 'ilegible'].indexOf(b.resultado) >= 0) res = b.resultado; else if (r.statusCode === 409 && b.error === 'sin_sena_pendiente' && (previo === undefined || previo === 'cuadra')) res = 'ya_cotejado'; return { resultado: res, diferencias: res === 'no_cuadra' && Array.isArray(b.diferencias) ? b.diferencias : [], importe: null, cierreId: b.cierreId || '' }; }
function cbEstadoParaAviso(r){ const e = { cuadra: 'comprobante: datos coinciden', no_cuadra: 'comprobante: NO coinciden', ilegible: 'comprobante ilegible', sin_cotejo: 'comprobante sin cotejar', ya_cotejado: null, simulado: 'PRUEBA: cobro SIMULADO, sin dinero', qr_vencido: 'QR vencido: coordinar el pago' }; return e[r] === undefined ? 'sin QR: cobrar al entregar' : e[r]; }
function cbTextoAlCliente(r, o){ const ped = 'tu pedido #' + o.codigo; const salio = o.avisoSalio === true; const sin = 'No pude pasarle tu pedido a nuestro equipo en este momento: escríbenos directamente con el botón.'; if (r === 'cuadra') return salio ? { cuerpo: 'Recibí tu comprobante y los datos coinciden con ' + ped + '. Ya lo pasé a nuestro equipo.', enlace: false, aviso: true } : { cuerpo: 'Recibí tu comprobante y los datos coinciden con ' + ped + '. ' + sin, enlace: true, aviso: true }; if (r === 'no_cuadra') return { cuerpo: 'Recibí tu comprobante, pero algunos datos no coinciden con ' + ped + '. ' + (salio ? 'Ya lo pasé a nuestro equipo.' : sin), enlace: true, aviso: true }; if (r === 'ilegible') { if (!(Number(o.ilegibles) >= 2)) return { cuerpo: 'Recibí tu comprobante, pero no pude leerlo bien. ¿Me lo envías de nuevo?', enlace: false, aviso: false }; return { cuerpo: 'Recibí tu comprobante, pero no pude leerlo bien para revisar ' + ped + '. ' + (salio ? 'Ya lo pasé a nuestro equipo.' : sin), enlace: true, aviso: true }; } if (r === 'sin_cotejo') return { cuerpo: 'Recibí tu comprobante, pero no pude revisarlo contra ' + ped + '. ' + (salio ? 'Ya lo pasé a nuestro equipo.' : sin), enlace: true, aviso: true }; if (r === 'simulado') { const cab = 'Recibí tu comprobante SIMULADO de ' + ped + '. Es una prueba: no se movió dinero.'; return salio ? { cuerpo: cab + ' Ya lo pasé a nuestro equipo como pedido de PRUEBA.', enlace: false, aviso: true } : { cuerpo: cab + ' ' + sin, enlace: true, aviso: true }; } if (r === 'ya_cotejado') return { cuerpo: 'Ya tengo el comprobante de ' + ped + '. Si necesitas algo más, toca el botón.', enlace: true, aviso: false }; if (r === 'sin_qr') return salio ? { cuerpo: 'Listo: pasé ' + ped + ' al restaurante. El pago lo coordinas con ellos ' + (o.entrega === 'delivery' ? 'al recibir' : 'al recoger') + '.', enlace: false, aviso: true } : { cuerpo: sin, enlace: true, aviso: true }; return { cuerpo: 'Eso lo ve directamente nuestro equipo.', enlace: true, aviso: false }; }
function cbResumenCorto(l, m){ return ''; }
const AV_ENLACE = /(?:https?:\/\/|www\.)\S+|\b(?:wa\.me|t\.me|bit\.ly|goo\.gl|tinyurl\.com)\/\S*|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|bo|me|io|co|app|ly|link|info|biz|xyz|site|online)\b(?:\/\S*)?/gi;
`;

// --- El mundo de las pruebas -------------------------------------------------------------------
const AHORA = Date.UTC(2026, 9, 5, 14); // lunes 05/10/2026 10:00 La Paz
const FROM = '59100000011';
const OTRO = '59100000012';

const CATALOGO = [
  { id: 'i1', nombre: 'Orden de 3 tacos de birria', precio: 55, area: 'Tacos', clave: 'tacos de birria' },
  { id: 'i2', nombre: 'Taco de birria (unidad)', precio: 21, area: 'Tacos', clave: 'tacos de birria' },
  { id: 'i3', nombre: 'Queso fundido con chorizo', precio: 40, area: 'Entradas', clave: 'queso fundido con chorizo' },
  { id: 'i4', nombre: 'Cerveza artesanal', precio: 20, area: 'Bebidas', clave: 'cerveza artesanal' },
  { id: 'i5', nombre: 'Michelada', precio: 25, area: 'Cócteles', clave: 'michelada' },
  { id: 'i6', nombre: 'Promo Dúo', precio: 95, area: 'Promos', clave: 'promo duo' },
];
const HORARIO = 'lun=09:00-22:00,mar=09:00-22:00,mie=09:00-22:00,jue=09:00-22:00,vie=09:00-22:00,sab=09:00-22:00,dom=09:00-22:00';
const QR = 'https://ejemplo.invalid/qr.png';

const CFG: J = {
  nombreNegocio: "Q' Taco de prueba", nombreAsistente: '', pedidosActivo: true, reservasActivo: true, promosActivo: true,
  moneda: 'Bs', direccion: 'Av. Ejemplo 123', horarioAtencion: 'todos los días de 9:00 a 22:00', horario: HORARIO,
  numeroRecepcion: '59100000099', catalogo: CATALOGO, campanas: [{ id: 'c1', texto: 'Quiero la Promo Dúo', inicio: '2026-10-05T04:00:00.000Z', fin: '2026-10-06T04:00:00.000Z' }],
  areasExcluidas: 'Cócteles', areasSinDelivery: 'Bebidas', zonasReserva: 'salón,terraza', maxPersonasReserva: 10,
  anticipacionReservaMin: 60, maxDiasReserva: 30, topeReservasDia: 3, topeTransferenciasHora: 1,
  aceptaDelivery: true, aceptaRetiroEnLocal: true, cobro: { activo: false },
};
const CFG_QR = { cobro: { activo: true, modo: 'real', qrUrl: QR, titular: 'Titular de prueba', pendiente: false, pedidoRef: '' } };
const CFG_SIM = { cobro: { activo: false, modo: 'simulado', qrUrl: QR, titular: '', pendiente: false, pedidoRef: '' } };

const gemini = (obj: J) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });
const extPedido = (o: J = {}) => gemini({ lineas: [], entrega: '', direccion: '', referencia: '', nombre: '', quiereHablar: false, ...o });
const extReserva = (o: J = {}) => gemini({ personas: 0, fecha: '', hora: '', zona: '', nombre: '', celebracion: '', requerimiento: '', ...o });
const linea = (producto: string, cantidad: number, forma = '', detalle = '') => ({ producto, cantidad, forma, detalle });

interface Mundo { global: J; cfg: J; ahora: number }
const crearMundo = (cfg: J = {}, ahora = AHORA): Mundo => ({ global: {}, cfg: { ...CFG, ...cfg }, ahora });
const sdDe = (m: Mundo): J => (m.global['ventaMinima'] ??= {});
const estadoDe = (m: Mundo, from = FROM): J => sdDe(m)['estados']?.[from] ?? {};

interface Entrada {
  from?: string; texto?: string; boton?: string; tipo?: string; esAudio?: boolean; esComprobante?: boolean; comprobanteSimulado?: boolean; comprobanteCruzado?: boolean; mediaId?: string;
  ubicacion?: J; nombrePerfil?: string;
  extraccion?: J; transcripcion?: string; cotejo?: J; lectura?: J;
}
interface Salida { d: J; p: J | null; cuerpos: string[] }

const cuerpos = (p: J | null): string[] => {
  if (!p) return [];
  const todos = [...p['mensajes'], ...(p['condicionados']?.['siSalio'] ?? []), ...(p['condicionados']?.['siNoSalio'] ?? [])];
  return todos.map((m: J) => String(m['cuerpo']));
};

/** Un turno entero: `Decidir turno` y, si la decisión llega al plan, `Plan del turno`, con lo que haría T7b. */
function turno(m: Mundo, e: Entrada = {}): Salida {
  const from = e.from ?? FROM;
  const t: J = {
    from, nombrePerfil: e.nombrePerfil ?? 'Ana Pérez', mensajeId: 'wamid.x', tipo: e.tipo ?? 'text', texto: e.texto ?? '',
    boton: e.boton ?? '', esAudio: e.esAudio ?? false, esComprobante: e.esComprobante ?? false, comprobanteSimulado: e.comprobanteSimulado ?? false, comprobanteCruzado: e.comprobanteCruzado ?? false, mediaId: e.mediaId ?? '',
    ubicacion: e.ubicacion ?? null, ahoraMs: m.ahora,
  };
  const refs: J = { 'Config del negocio': m.cfg, 'Interpretar entrada': t };
  if (e.transcripcion !== undefined) refs['Transcribir audio'] = gemini({ texto: e.transcripcion });
  if (e.transcripcion !== undefined) refs['Transcribir audio'] = { candidates: [{ content: { parts: [{ text: e.transcripcion }] } }] };
  if (e.cotejo !== undefined) refs['Cotejar en el servidor'] = e.cotejo;
  if (e.lectura !== undefined) refs['Interpretar lectura'] = e.lectura;
  const globales = { $getWorkflowStaticData: () => m.global };
  const d = ejecutar(`${DOBLES}\n${DECIDIR}`, [{}], refs, globales)[0]!;
  if (String(d['accion']).startsWith('extraer') && e.extraccion !== undefined) refs['Extraer'] = e.extraccion;
  const p = ejecutar(`${DOBLES}\n${PLAN}`, [{}], { ...refs, 'Decidir turno': d }, globales)[0]!;
  // Lo que hace `Armar mensajes` (T7b) con el plan.
  const sd = sdDe(m);
  sd['estados'] ??= {};
  sd['estados'][from] = p['estadoNuevo'];
  if (p['pedido']) { sd['pedidos'] ??= {}; sd['pedidos'][p['pedido']['pedidoId']] = p['pedido']; }
  if (p['aviso']?.['tipo'] === 'reserva' && p['anotarReserva'] === true) {
    ejecutar(`${DOBLES}\nconst i = $input.first().json; rsAnotar(vmSd(), i.from, i.ahora); return [{ json: {} }];`, [{ from, ahora: m.ahora }], {}, globales);
  }
  return { d, p, cuerpos: cuerpos(p) };
}

const ids = (msg: J): string[] => (msg['botones'] ?? []).map((b: J) => b['id']);
const titulos = (msg: J): string[] => (msg['botones'] ?? []).map((b: J) => b['title']);
const todosLosTextos: string[] = [];
const registrar = (s: Salida) => { todosLosTextos.push(...s.cuerpos); return s; };

/** Lleva a un teléfono hasta el resumen de un pedido de recojo (1 orden de tacos de birria). */
function hastaResumen(m: Mundo, mod: 'recojo' | 'delivery' = 'recojo'): Salida {
  turno(m, { texto: 'hola' });
  const s = turno(m, { texto: 'quiero 1 orden de tacos de birria', extraccion: extPedido({ lineas: [linea('tacos de birria', 1, 'orden')], entrega: mod === 'recojo' ? 'recojo' : '' }) });
  if (mod === 'recojo') return s;
  turno(m, { boton: 'e|delivery' });
  return turno(m, { texto: 'Calle Falsa 123, casa azul', extraccion: extPedido({ direccion: 'Calle Falsa 123', referencia: 'casa azul' }) });
}

// =================================================================================================
describe('Decidir turno: el orden de §4.5, sin modelo', () => {
  it('«hola» en `inicio` muestra el menú (y un texto de otro tipo, no)', () => {
    const m = crearMundo();
    expect(turno(m, { texto: 'hola' }).d['accion']).toBe('menu');
    expect(turno(crearMundo(), { texto: 'hola' }).d['cuerpoExtraccion']).toBeNull();
  });

  it('1. el resultado del cotejo gana sobre todo lo demás; sin cotejo ni QR pendiente una imagen no es un pago', () => {
    const m = crearMundo(CFG_QR);
    expect(turno(m, { tipo: 'image', esComprobante: true, texto: 'hola', cotejo: { statusCode: 200, body: { resultado: 'cuadra' } } }).d['accion']).toBe('comprobante');
    expect(turno(m, { tipo: 'image', esComprobante: true }).d['accion']).toBe('comprobante');
    // Negativo: la misma imagen sin `esComprobante` (no hay QR pendiente) NO es un comprobante.
    expect(turno(crearMundo(), { tipo: 'image' }).d['accion']).toBe('imagen_sin_pendiente');
    expect(turno(crearMundo(), { tipo: 'document' }).d['accion']).toBe('imagen_sin_pendiente');
  });

  it('2. una imagen con pie de foto se procesa como texto; el audio transcripto también; sin transcripción, `medio_no_leido`', () => {
    expect(turno(crearMundo(), { tipo: 'image', texto: 'hola' }).d['accion']).toBe('menu');
    expect(turno(crearMundo(), { tipo: 'audio', esAudio: true, transcripcion: 'quiero 3 tacos de birria' }).d['accion']).toBe('extraer_pedido');
    expect(turno(crearMundo(), { tipo: 'audio', esAudio: true }).d['accion']).toBe('medio_no_leido');
    expect(turno(crearMundo(), { tipo: 'audio', esAudio: false, transcripcion: 'quiero 3 tacos de birria' }).d['accion']).toBe('medio_no_leido');
    expect(turno(crearMundo(), { tipo: 'sticker' }).d['accion']).toBe('medio_no_leido');
  });

  it('una ubicación compartida muestra el paso actual (supuesto 6) y no se toma como dirección', () => {
    const s = turno(crearMundo(), { tipo: 'location', ubicacion: { latitude: 1, longitude: 2 } });
    expect(s.d['accion']).toBe('boton');
    expect(s.d['boton']).toBeNull();
    expect(s.d['motivo']).toBe('ubicacion');
  });

  it('3. un botón vale solo en su paso: uno viejo vuelve a mostrar el paso actual y no cambia nada', () => {
    const m = crearMundo();
    expect(turno(m, { boton: 'm|pedido' }).d['accion']).toBe('carta');
    const m2 = crearMundo();
    expect(turno(m2, { boton: 'm|reserva' }).d['boton']).toEqual({ tipo: 'm', partes: ['reserva'] });
    // «Hacer un pedido» vale en cualquier paso (03/10): en medio de un pedido muestra la carta y no borra nada…
    expect(turno(m, { boton: 'm|pedido' }).d['accion']).toBe('carta');
    // …salvo con un comprobante en espera (negativo): ahí solo «Menú» vale y lo demás muestra el paso actual.
    const enEspera3 = crearMundo(CFG_QR);
    hastaResumen(enEspera3);
    turno(enEspera3, { boton: 'p|confirmar' });
    for (const id of ['m|pedido', 'm|reserva', 'm|promos']) {
      const viejo = turno(enEspera3, { boton: id });
      expect([id, viejo.d['accion'], viejo.d['boton'], viejo.d['motivo']]).toEqual([id, 'boton', null, 'boton_viejo']);
    }
    expect(turno(enEspera3, { boton: 'm|menu' }).d['accion']).toBe('menu');
    // Los demás tipos exigen su paso: nada de confirmar sin el resumen.
    const sinResumen = crearMundo();
    for (const id of ['p|confirmar', 'r|enviar', 'e|delivery', 'f|0|orden', 'q|reenviar', 'q|cancelar', 'x|1', 'roto']) {
      const s = turno(sinResumen, { boton: id });
      expect(s.d['boton'], id).toBeNull();
      expect(s.d['motivo'], id).toBe('boton_viejo');
    }
  });

  it('3. cada botón vale en SU paso', () => {
    const m = crearMundo(CFG_QR);
    const r = hastaResumen(m);
    expect(estadoDe(m)['paso']).toBe('pedido_confirmar');
    expect(r.d['accion']).toBe('extraer_pedido');
    expect(turno(m, { boton: 'p|cambiar' }).d['boton']).toEqual({ tipo: 'p', partes: ['cambiar'] });
    const m2 = crearMundo(CFG_QR);
    hastaResumen(m2);
    turno(m2, { boton: 'p|confirmar' });
    expect(estadoDe(m2)['paso']).toBe('esperando_comprobante');
    expect(turno(m2, { boton: 'q|reenviar' }).d['accion']).toBe('reenviar_qr');
    const cancelar = turno(m2, { boton: 'q|cancelar' });
    expect(cancelar.d['accion']).toBe('cancelar'); // 04/10: cancela de verdad y lo dice (antes volvía al saludo sin decirlo)
    expect(cancelar.d['motivo']).toBe('cancelar_pedido');
    expect(cancelar.d['limpiar']).toBe('pedido');
  });

  it('4. el texto exacto de una campaña vigente es `promo` (otras mayúsculas, tildes o un emoji); una palabra de más, no', () => {
    expect(turno(crearMundo(), { texto: 'QUIERO LA PROMO DUO 😋' }).d['accion']).toBe('promo');
    expect(turno(crearMundo(), { texto: 'quiero la promo dúo!' }).d['campana']['id']).toBe('c1');
    expect(turno(crearMundo(), { texto: 'quiero la promo duo hoy' }).d['accion']).not.toBe('promo');
    expect(turno(crearMundo({ promosActivo: false }), { texto: 'Quiero la Promo Dúo' }).d['accion']).not.toBe('promo');
    // Una campaña vencida no viene en `campanas`: menú normal.
    expect(turno(crearMundo({ campanas: [] }), { texto: 'Quiero la Promo Dúo' }).d['accion']).not.toBe('promo');
  });

  it('5. pide una persona → `transferir`; la pregunta por la identidad se revisa primero; «mesa para 1 persona» no deriva', () => {
    for (const x of ['quiero hablar con una persona', 'necesito hablar con alguien', 'tengo una queja', 'pásame con el encargado', 'quiero un humano']) {
      expect(turno(crearMundo(), { texto: x }).d['accion'], x).toBe('transferir');
    }
    for (const x of ['¿eres un robot?', 'eres una persona?', '¿estoy hablando con una persona real?', 'eres humano', 'esto es un bot']) {
      expect(turno(crearMundo(), { texto: x }).d['accion'], x).toBe('identidad');
    }
    // «encargado» o «asesor» sueltos (una referencia de entrega) no derivan.
    const m = crearMundo();
    turno(m, { texto: 'quiero pedir queso', extraccion: extPedido({ lineas: [linea('queso fundido', 1)] }) });
    turno(m, { boton: 'e|delivery' });
    expect(turno(m, { texto: 'déjalo con el encargado del edificio' }).d['accion']).toBe('extraer_pedido');
    const mesa = turno(crearMundo(), { texto: 'una mesa para 1 persona' });
    expect(mesa.d['accion']).toBe('extraer_reserva');
    expect(turno(crearMundo(), { texto: 'somos 3 personas' }).d['accion']).toBe('menu');
  });

  it('6. «menu», «empezar de nuevo» y «cancelar» vuelven al menú', () => {
    for (const x of ['menu', 'Menú', 'empezar de nuevo']) {
      expect(turno(crearMundo(), { texto: x }).d['accion'], x).toBe('menu');
    }
    // «cancelar» ya no vuelve al saludo sin decirlo: es la acción `cancelar` (04/10), que dice que canceló o que no hay nada.
    for (const x of ['cancelar', 'Cancelar!']) expect(turno(crearMundo(), { texto: x }).d['accion'], x).toBe('cancelar');
    expect(turno(crearMundo(), { texto: 'no quiero cancelar mi vida' }).d['accion']).toBe('menu'); // cae al menú por falta de intención, no por reinicio
    expect(turno(crearMundo(), { texto: 'no quiero cancelar mi vida' }).d['motivo']).toBe('');
  });

  it('7. consultas fijas en `inicio`/`menu`: una sola; «quiero delivery» es un pedido; dos a la vez van al menú', () => {
    const casos: [string, string, string][] = [
      ['cuál es la dirección', 'consulta', 'direccion_local'], ['a qué hora abren', 'consulta', 'horario'], // 09/10: la dirección del local va por el paso 5b (`direccion_local`)
      ['hacen delivery?', 'consulta', 'delivery'], ['tienen promociones', 'consulta', 'promociones'],
      ['me pasas la carta', 'carta', 'carta'], ['qué venden', 'carta', 'carta'],
    ];
    for (const [x, accion, clave] of casos) {
      const s = turno(crearMundo(), { texto: x });
      expect([x, s.d['accion'], s.d['consulta']]).toEqual([x, accion, clave]);
    }
    expect(turno(crearMundo(), { texto: 'quiero delivery' }).d['accion']).toBe('extraer_pedido');
    expect(turno(crearMundo(), { texto: 'cuál es la dirección y a qué hora abren' }).d['accion']).toBe('menu');
    expect(turno(crearMundo(), { texto: 'cuál es la dirección y a qué hora abren' }).d['consulta']).toBe('');
    expect(turno(crearMundo(), { texto: 'quiero pedir de la carta' }).d['accion']).toBe('extraer_pedido');
  });

  it('8. por paso: intención de pedido o de reserva desde el inicio; respetan las banderas', () => {
    expect(turno(crearMundo(), { texto: 'quiero 3 tacos de birria' }).d['accion']).toBe('extraer_pedido');
    expect(turno(crearMundo(), { texto: 'quiero reservar una mesa' }).d['accion']).toBe('extraer_reserva');
    expect(turno(crearMundo({ pedidosActivo: false }), { texto: 'quiero 3 tacos' }).d['accion']).toBe('menu');
    expect(turno(crearMundo({ reservasActivo: false }), { texto: 'quiero reservar una mesa' }).d['accion']).toBe('menu');
    expect(turno(crearMundo(), { texto: 'cuánto sale?' }).d['accion']).toBe('menu');
  });

  it('el cuerpo de la extracción lo arma la librería con el reloj del turno', () => {
    const s = turno(crearMundo(), { texto: 'quiero 3 tacos de birria' });
    expect(s.d['cuerpoExtraccion']).toMatchObject({ marcador: 'pedido', ahoraMs: AHORA });
    const r = turno(crearMundo(), { texto: 'quiero reservar una mesa' });
    expect(r.d['cuerpoExtraccion']).toMatchObject({ marcador: 'reserva', zonas: ['salón', 'terraza'] });
  });

  it('9. un pedido fuera de horario es `fuera_de_horario`; una consulta no', () => {
    const noche = crearMundo({}, Date.UTC(2026, 9, 6, 3)); // lunes 23:00 La Paz
    expect(turno(noche, { texto: 'quiero 3 tacos de birria' }).d['accion']).toBe('fuera_de_horario');
    expect(turno(noche, { boton: 'm|pedido' }).d['accion']).toBe('fuera_de_horario');
    expect(turno(crearMundo({}, Date.UTC(2026, 9, 6, 3)), { texto: 'a qué hora abren' }).d['accion']).toBe('consulta');
    expect(turno(crearMundo(), { texto: 'quiero 3 tacos de birria' }).d['accion']).toBe('extraer_pedido');
    // Sin horario cargado no se bloquea nada, y un horario ilegible tampoco (se anota).
    expect(turno(crearMundo({ horario: '' }, Date.UTC(2026, 9, 6, 3)), { texto: 'quiero 3 tacos de birria' }).d['accion']).toBe('extraer_pedido');
    const roto = turno(crearMundo({ horario: 'lun=cuando sea' }), { texto: 'quiero 3 tacos de birria' });
    expect(roto.d['accion']).toBe('extraer_pedido');
    expect(roto.d['errores']).toContain('horario_ilegible');
  });

  it('sin carta cargada no hay pedido que tomar: `transferir`', () => {
    const s = turno(crearMundo({ catalogo: [] }), { texto: 'quiero 3 tacos de birria' });
    expect(s.d['accion']).toBe('transferir');
    expect(s.d['motivo']).toBe('carta sin cargar');
  });

  it('esperando el comprobante, un texto recibe el recordatorio', () => {
    const m = crearMundo(CFG_QR);
    hastaResumen(m);
    turno(m, { boton: 'p|confirmar' });
    expect(turno(m, { texto: 'ya pagué' }).d['accion']).toBe('recordatorio_comprobante');
  });
});

describe('UN «SÍ» ESCRITO NO CONFIRMA NADA', () => {
  it('en el resumen del pedido, «sí», «dale», «ok» muestran el resumen otra vez con sus botones; ni aviso ni pedido', () => {
    for (const x of ['sí', 'Dale', 'ok', 'confirmo', 'sí, por favor', 'enviar']) {
      const m = crearMundo(CFG_QR);
      hastaResumen(m);
      const s = turno(m, { texto: x });
      expect(s.d['accion'], x).toBe('boton');
      expect(s.d['boton'], x).toBeNull();
      expect(s.d['motivo'], x).toBe('si_suelto');
      expect(ids(s.p!['mensajes'][0]), x).toEqual(['p|confirmar', 'p|cambiar']);
      expect(s.p!['aviso'], x).toBeNull();
      expect(s.p!['pedido'], x).toBeNull();
      expect(s.p!['mensajes'].some((x2: J) => x2['evento']), x).toBe(false);
      expect(estadoDe(m)['paso'], x).toBe('pedido_confirmar');
    }
  });

  it('en el resumen de la reserva, igual: ni aviso ni cierre ni anotación', () => {
    const m = crearMundo();
    turno(m, { boton: 'm|reserva' });
    turno(m, { texto: 'mesa', extraccion: extReserva({ personas: 4, fecha: '2026-10-09', hora: '20:00', zona: 'salón' }) });
    expect(estadoDe(m)['paso']).toBe('reserva_confirmar');
    const s = turno(m, { texto: 'sí' });
    expect(s.d['motivo']).toBe('si_suelto');
    expect(ids(s.p!['mensajes'][0])).toEqual(['r|enviar', 'r|corregir']);
    expect(s.p!['aviso']).toBeNull();
    expect(s.p!['cierre']).toBeNull();
    expect(s.p!['anotarReserva']).toBe(false);
  });

  it('negativo: un texto que sí dice algo («agrega 2 tacos») no es un «sí»: va a la extracción', () => {
    const m = crearMundo(CFG_QR);
    hastaResumen(m);
    expect(turno(m, { texto: 'agrega 2 tacos de birria' }).d['accion']).toBe('extraer_pedido');
  });

  it('negativo: en el menú un «sí» no es una confirmación: es el menú', () => {
    expect(turno(crearMundo(), { texto: 'sí' }).d['accion']).toBe('menu');
  });
});

// =================================================================================================
describe('Plan del turno: menú, carta, consultas y promoción', () => {
  it('el menú trae un botón por capacidad activa y se presenta como asistente virtual', () => {
    const s = registrar(turno(crearMundo(), { texto: 'hola' }));
    const msg = s.p!['mensajes'][0];
    expect(msg['tipo']).toBe('botones');
    expect(msg['cuerpo']).toBe("¡Hola! 👋 Gracias por escribir a Q' Taco de prueba. Soy el asistente virtual. ¿Qué te gustaría hacer?");
    // «Promociones» solo con una campaña vigente con ficha (en este mundo la hay).
    expect(ids(msg)).toEqual(['m|pedido', 'm|reserva', 'm|promos']);
    expect(titulos(msg)).toEqual(['Hacer un pedido', 'Reservar mesa', 'Promociones']);
    expect(ids(turno(crearMundo({ campanas: [] }), { texto: 'hola' }).p!['mensajes'][0])).toEqual(['m|pedido', 'm|reserva']);
    expect(s.p!['aviso']).toBeNull();
    expect(estadoDe(crearMundo()).paso).toBeUndefined();
    const con = turno(crearMundo({ nombreAsistente: 'Taquito' }), { texto: 'hola' });
    expect(con.p!['mensajes'][0]['cuerpo']).toContain('Gracias por escribir a Q\' Taco de prueba. Soy Taquito, el asistente virtual. ¿Qué te gustaría hacer?');
  });

  it('con una sola capacidad no hay nada que elegir: va directo (carta o datos de la reserva)', () => {
    const solo = registrar(turno(crearMundo({ reservasActivo: false }), { texto: 'hola' }));
    expect(solo.p!['mensajes'][0]['cuerpo']).toMatch(/^Esta es nuestra carta:/);
    const m = crearMundo({ reservasActivo: false });
    turno(m, { texto: 'hola' });
    expect(estadoDe(m)['paso']).toBe('pedido');
    const res = registrar(turno(crearMundo({ pedidosActivo: false }), { texto: 'hola' }));
    expect(res.p!['mensajes'][0]['cuerpo']).toMatch(/^Para tu solicitud de reserva dime/);
    // Ninguna capacidad: lo único que se ofrece es pasar con el local.
    const nada = turno(crearMundo({ pedidosActivo: false, reservasActivo: false }), { texto: 'hola' });
    expect(nada.p!['aviso']['tipo']).toBe('transferencia');
    expect(nada.p!['mensajes'][0]['tipo']).toBe('enlace');
  });

  it('la carta trae el texto fijo, sin las áreas excluidas, con la nota del delivery y el estado queda en `pedido`', () => {
    const m = crearMundo();
    const s = registrar(turno(m, { boton: 'm|pedido' }));
    const cuerpo = s.p!['mensajes'][0]['cuerpo'] as string;
    expect(cuerpo).toContain('Esta es nuestra carta:');
    expect(cuerpo).toContain('Orden de 3 tacos de birria');
    expect(cuerpo).not.toContain('Michelada'); // área excluida
    // El ejemplo sale de los DOS PRIMEROS productos de la carta del negocio (`pdEjemploDePedido`), nunca de un plato de un cliente.
    expect(cuerpo).toContain('(por ejemplo: «1 Orden de 3 tacos de birria y 1 Queso fundido con chorizo»)');
    expect(cuerpo).not.toMatch(/cochinita/i);
    // Otra carta, otro ejemplo; y sin productos nombrables no hay ejemplo (nunca uno de código).
    const otra = turno(crearMundo({ catalogo: [{ id: 'z1', nombre: 'Pizza Cuatro Quesos', precio: 60, area: 'Pizzas', clave: 'pizza' }, { id: 'z2', nombre: 'Lasaña', precio: 50, area: 'Pastas', clave: 'lasana' }] }), { boton: 'm|pedido' });
    const cuerpoOtra = otra.p!['mensajes'][0]['cuerpo'] as string;
    expect(cuerpoOtra).toContain('(por ejemplo: «1 Pizza Cuatro Quesos y 1 Lasaña»)');
    expect(cuerpoOtra).not.toMatch(/cochinita|chorizo|birria/i);
    expect(cuerpo).toContain(' Por delivery no enviamos bebidas.');
    expect(estadoDe(m)['paso']).toBe('pedido');
    const sin = turno(crearMundo({ areasSinDelivery: '' }), { boton: 'm|pedido' });
    expect(sin.p!['mensajes'][0]['cuerpo']).not.toContain('bebidas sueltas');
  });

  it('una carta larga sale en dos mensajes: el encabezado en el primero y la instrucción en el último', () => {
    const grande = Array.from({ length: 150 }, (_, i) => ({ id: 'x' + i, nombre: 'Producto de la carta número ' + i, precio: 10 + i, area: 'Platos', clave: 'p' + i }));
    const s = registrar(turno(crearMundo({ catalogo: grande }), { boton: 'm|pedido' }));
    expect(s.p!['mensajes'].length).toBe(2);
    expect(s.p!['mensajes'][0]['cuerpo']).toMatch(/^Esta es nuestra carta:/);
    expect(s.p!['mensajes'][0]['cuerpo']).not.toContain('Escríbeme en un mensaje');
    expect(s.p!['mensajes'][1]['cuerpo']).toContain('Escríbeme en un mensaje');
  });

  it('sin carta cargada: se pasa con el local (aviso + botón), nunca una carta vacía', () => {
    const s = turno(crearMundo({ catalogo: [] }), { boton: 'm|pedido' });
    expect(s.p!['aviso']['tipo']).toBe('transferencia');
    expect(s.p!['mensajes'][0]['tipo']).toBe('enlace');
  });

  it('consultas fijas: responden con el dato cargado y el menú; sin el dato, se pasa con el local', () => {
    const dir = registrar(turno(crearMundo(), { texto: 'cuál es la dirección' }));
    expect(dir.p!['mensajes'][0]['cuerpo']).toBe('Estamos en Av. Ejemplo 123.');
    expect(dir.p!['ruta']).toBe('consulta:direccion_local'); // 09/10: UN mensaje con el mapa (si hay enlace válido) y sin los botones del menú; no cambia el paso
    expect(ids(dir.p!['mensajes'][0])).toEqual([]);
    expect(registrar(turno(crearMundo(), { texto: 'a qué hora abren' })).cuerpos[0]).toBe('Atendemos todos los días de 9:00 a 22:00.');
    expect(registrar(turno(crearMundo(), { texto: 'hacen delivery?' })).cuerpos[0]).toBe('Sí, hacemos delivery. Por delivery no enviamos bebidas.');
    expect(registrar(turno(crearMundo({ aceptaDelivery: false }), { texto: 'hacen delivery?' })).cuerpos[0]).toContain('Por ahora no hacemos delivery');
    const sinDato = turno(crearMundo({ direccion: '' }), { texto: 'cuál es la dirección' });
    expect(sinDato.p!['aviso']['tipo']).toBe('transferencia');
    expect(sinDato.p!['mensajes'][0]['tipo']).toBe('enlace');
    const promos = registrar(turno(crearMundo(), { texto: 'tienen promociones' }));
    expect(promos.p!['mensajes'][0]['cuerpo']).toContain('Promo Dúo');
    expect(registrar(turno(crearMundo({ campanas: [] }), { texto: 'tienen promociones' })).cuerpos[0]).toContain('no tenemos promociones');
  });

  it('promoción: ficha con 3 botones; reinicia el estado; sin ficha (producto fuera de la carta) es el menú normal', () => {
    const m = crearMundo();
    turno(m, { texto: 'hola' });
    const s = registrar(turno(m, { texto: 'Quiero la Promo Dúo' }));
    const msg = s.p!['mensajes'][0];
    expect(msg['cuerpo']).toContain('Promo Dúo');
    expect(ids(msg)).toEqual(['g|pedir|i6', 'm|reserva', 'm|pedido']);
    expect(estadoDe(m)['paso']).toBe('menu');
    expect(s.p!['aviso']).toBeNull();
    expect(s.p!['mensajes'].some((x: J) => x['evento'] || x['monto'])).toBe(false);
    // La ficha no existe si el ítem no está en la carta: menú normal.
    const sinFicha = turno(crearMundo({ catalogo: CATALOGO.filter((i) => i.id !== 'i6') }), { texto: 'Quiero la Promo Dúo' });
    expect(sinFicha.p!['mensajes'][0]['cuerpo']).toMatch(/^¡Hola! 👋 Gracias por escribir a .* Soy el asistente virtual\./);
    // «Pedir la promo» agrega el ítem al carrito.
    turno(m, { boton: 'g|pedir|i6' });
    expect(estadoDe(m)['carrito'][0]['nombre']).toBe('Promo Dúo');
    expect(estadoDe(m)['paso']).toBe('pedido_entrega');
  });

  it('en medio de un pedido, el texto exacto de la campaña vuelve al menú SIN borrar el carrito (03/10: nada se borra de paso)', () => {
    const m = crearMundo();
    hastaResumen(m);
    turno(m, { texto: 'Quiero la Promo Dúo' });
    expect(estadoDe(m)['paso']).toBe('menu');
    expect(estadoDe(m)['carrito'].length).toBeGreaterThan(0);
  });

  it('identidad: dice que es un asistente virtual con IA, con botón al local y sin aviso', () => {
    const s = registrar(turno(crearMundo(), { texto: '¿eres un robot?' }));
    expect(s.p!['mensajes'][0]['cuerpo']).toContain('asistente virtual con inteligencia artificial');
    expect(s.p!['mensajes'][0]['tipo']).toBe('enlace');
    expect(s.p!['aviso']).toBeNull();
  });

  it('un medio que no se entiende pide escribirlo; una imagen sin pedido pendiente no es un pago', () => {
    const s = registrar(turno(crearMundo(), { tipo: 'audio', esAudio: true }));
    expect(s.p!['mensajes'][0]['cuerpo']).toBe('No pude escuchar bien ese mensaje 😅. ¿Me lo escribes?');
    expect(ids(s.p!['mensajes'][0])).toEqual(['m|pedido']);
    expect(titulos(s.p!['mensajes'][0])).toEqual(['Ver la carta']);
    const otro = turno(crearMundo(), { tipo: 'sticker' });
    expect(otro.p!['mensajes'][0]['cuerpo']).toBe('No pude entender bien ese mensaje 😅. ¿Me lo escribes?');
    const img = registrar(turno(crearMundo(), { tipo: 'image' }));
    expect(img.p!['mensajes'][0]['cuerpo']).toBe('¡Gracias por la imagen! Por aquí solo leo comprobantes de un pedido con QR, y ahora no tienes ninguno pendiente. ¿Qué te gustaría hacer?');
    expect(ids(img.p!['mensajes'][0])).toEqual(['m|pedido', 'm|reserva']);
    expect(img.p!['aviso']).toBeNull();
    expect(img.p!['pedido']).toBeNull();
    // En medio de un pedido la imagen no lo borra: el paso y el carrito siguen, y los botones valen en cualquier paso.
    const m = crearMundo();
    hastaResumen(m);
    const medio = turno(m, { tipo: 'image' });
    expect(medio.p!['mensajes'][0]['tipo']).toBe('botones');
    expect(estadoDe(m)['paso']).toBe('pedido_confirmar');
    expect(estadoDe(m)['carrito'].length).toBeGreaterThan(0);
  });

  it('redacción del horario: nunca doble punto y «Atendemos» sigue en minúscula, para cada día de la semana (consulta y fuera de horario)', () => {
    const dias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    for (const dia of dias) {
      for (const cierre of ['', '.', '..', ' .']) {
        const horarioAtencion = dia + ' a ' + dia + ' de 12:00 a 22:00' + cierre;
        const esperado = dia.toLowerCase() + ' a ' + dia + ' de 12:00 a 22:00.';
        const consulta = registrar(turno(crearMundo({ horarioAtencion }), { texto: 'a qué hora abren' })).cuerpos[0]!;
        expect(consulta, horarioAtencion).toBe('Atendemos ' + esperado);
        expect(consulta, horarioAtencion).not.toContain('..');
        expect(consulta, horarioAtencion).not.toMatch(/Atendemos [A-ZÁÉÍÓÚ]/);
        const fuera = registrar(turno(crearMundo({ horarioAtencion }, Date.UTC(2026, 9, 6, 3)), { texto: 'quiero 3 tacos de birria' }));
        const cuerpoFuera = String(fuera.p!['mensajes'][0]['cuerpo']);
        expect(cuerpoFuera, horarioAtencion).toBe('¡Gracias por escribirnos! 🕒 Ahora estamos fuera de nuestro horario de pedidos. Atendemos ' + esperado + ' Mientras tanto, puedes reservar una mesa con el botón.');
        expect(cuerpoFuera, horarioAtencion).not.toContain('..');
      }
    }
    // Una sigla no se parte («LUN a VIE»).
    expect(registrar(turno(crearMundo({ horarioAtencion: 'LUN a VIE de 9 a 18.' }), { texto: 'a qué hora abren' })).cuerpos[0]).toBe('Atendemos LUN a VIE de 9 a 18.');
  });

  it('fuera de horario: lo dice con el horario y ofrece reservar solo si las reservas están activas; sin carrito', () => {
    const m = crearMundo({}, Date.UTC(2026, 9, 6, 3));
    const s = registrar(turno(m, { texto: 'quiero 3 tacos de birria' }));
    expect(s.p!['mensajes'][0]['cuerpo']).toBe('¡Gracias por escribirnos! 🕒 Ahora estamos fuera de nuestro horario de pedidos. Atendemos todos los días de 9:00 a 22:00. Mientras tanto, puedes reservar una mesa con el botón.');
    expect(ids(s.p!['mensajes'][0])).toEqual(['m|reserva']);
    expect(estadoDe(m)['carrito']).toEqual([]);
    const sin = turno(crearMundo({ reservasActivo: false }, Date.UTC(2026, 9, 6, 3)), { texto: 'quiero 3 tacos de birria' });
    expect(sin.p!['mensajes'][0]['tipo']).toBe('texto');
    // Sin el botón de reservar no se nombra: «con el botón» solo sale si el botón sale.
    expect(sin.p!['mensajes'][0]['cuerpo']).toBe('¡Gracias por escribirnos! 🕒 Ahora estamos fuera de nuestro horario de pedidos. Atendemos todos los días de 9:00 a 22:00.');
  });
});

describe('Plan del turno: el pedido', () => {
  it('«3 tacos de birria»: pregunta entre orden y sueltos con los dos precios y SIN total', () => {
    const m = crearMundo();
    const s = registrar(turno(m, { texto: 'quiero 3 tacos de birria', extraccion: extPedido({ lineas: [linea('tacos de birria', 3)] }) }));
    const msg = s.p!['mensajes'][0];
    expect(msg['cuerpo']).toBe('¿«3 tacos de birria» es 1 orden de 3 (55 Bs) o 3 sueltos (63 Bs)?');
    expect(ids(msg)).toEqual(['f|0|orden', 'f|0|unidad']);
    expect(titulos(msg)).toEqual(['Orden', 'Sueltos']);
    expect(msg['cuerpo']).not.toMatch(/total/i);
    expect(estadoDe(m)['paso']).toBe('pedido');
    expect(s.p!['aviso']).toBeNull();
  });

  it('«6 tacos» pregunta 110 contra 126; «4 tacos» va como sueltos (84) sin preguntar', () => {
    const seis = turno(crearMundo(), { texto: 'quiero 6 tacos de birria', extraccion: extPedido({ lineas: [linea('tacos de birria', 6)] }) });
    expect(seis.p!['mensajes'][0]['cuerpo']).toBe('¿«6 tacos de birria» es 2 órdenes de 3 (110 Bs) o 6 sueltos (126 Bs)?');
    const m = crearMundo();
    turno(m, { texto: 'quiero 4 tacos de birria', extraccion: extPedido({ lineas: [linea('tacos de birria', 4)], entrega: 'recojo' }) });
    expect(estadoDe(m)['carrito'][0]).toMatchObject({ cantidad: 4, nombre: 'Taco de birria (unidad)' });
    expect(estadoDe(m)['paso']).toBe('pedido_confirmar');
  });

  it('el botón «Orden» o «Sueltos» resuelve la pregunta; con dos preguntas pendientes pregunta la siguiente', () => {
    const m = crearMundo();
    turno(m, { texto: 'quiero 3 tacos y 6 tacos', extraccion: extPedido({ lineas: [linea('tacos de birria', 3), linea('queso fundido', 1), linea('tacos de birria', 6)] }) });
    expect(estadoDe(m)['pendiente'].length).toBe(2);
    const sig = turno(m, { boton: 'f|0|orden' });
    expect(sig.p!['mensajes'][0]['cuerpo']).toContain('«6 tacos de birria»');
    const fin = turno(m, { boton: 'f|0|unidad' });
    expect(estadoDe(m)['pendiente']).toEqual([]);
    expect(estadoDe(m)['carrito'].length).toBe(3);
    expect(ids(fin.p!['mensajes'][0])).toEqual(['e|delivery', 'e|recojo']);
  });

  it('mientras la pregunta orden/unidad está pendiente, un texto vuelve a hacerla (no suma nada)', () => {
    const m = crearMundo();
    turno(m, { texto: 'quiero 3 tacos de birria', extraccion: extPedido({ lineas: [linea('tacos de birria', 3)] }) });
    const s = turno(m, { texto: 'dale' });
    expect(s.d['motivo']).toBe('forma_pendiente');
    expect(s.p!['mensajes'][0]['cuerpo']).toContain('«3 tacos de birria»');
    expect(estadoDe(m)['carrito']).toEqual([]);
    // Una respuesta («sueltos») también repite la pregunta, sin gastar un modelo.
    expect(turno(m, { texto: 'sueltos' }).d['motivo']).toBe('forma_pendiente');
    // Negativo (03/10): un mensaje NUEVO ya no recibe la misma pregunta: se atiende (extracción) y la pregunta sigue pendiente.
    const nuevo = turno(m, { texto: 'quiero un helado', extraccion: extPedido({ lineas: [linea('helado', 1)] }) });
    expect(nuevo.d['accion']).toBe('extraer_pedido');
    expect(estadoDe(m)['pendiente'].length).toBe(1);
  });

  it('el total y el resumen salen de la carta: el precio y el «total 999» del modelo se ignoran', () => {
    const m = crearMundo(CFG_QR);
    const s = turno(m, {
      texto: 'quiero 1 orden de tacos de birria con 10% de descuento',
      extraccion: extPedido({ lineas: [{ ...linea('tacos de birria', 1, 'orden'), precio: 5, total: 999 }], entrega: 'recojo', total: 999, descuento: 10 }),
    });
    expect(s.p!['mensajes'][0]['cuerpo']).toContain('Total de la comida: 55 Bs.');
    expect(s.p!['mensajes'][0]['cuerpo']).not.toContain('999');
    const c = turno(m, { boton: 'p|confirmar' });
    expect(c.p!['mensajes'][0]['monto']).toBe(55);
    expect(typeof c.p!['mensajes'][0]['monto']).toBe('number');
    expect(c.p!['pedido']['total']).toBe(55);
  });

  it('producto inexistente: lo dice con sugerencias o pide escribirlo como figura; «2 micheladas» (área excluida) no existe', () => {
    const m = crearMundo();
    const s = registrar(turno(m, { texto: 'quiero 2 micheladas', extraccion: extPedido({ lineas: [linea('michelada', 2)] }) }));
    expect(s.p!['mensajes'][0]['cuerpo']).toBe('No encuentro «michelada» en la carta. ¿Me lo escribes como figura en la carta?');
    expect(s.p!['mensajes'].length).toBe(1); // no repite la carta
    const sug = registrar(turno(crearMundo(), { texto: 'quiero pedir cerveza', extraccion: extPedido({ lineas: [linea('cerveza', 1), linea('pizza', 1)] }) }));
    expect(sug.p!['mensajes'][0]['cuerpo']).toContain('No encuentro «pizza» en la carta.');
  });

  it('una línea entendida y otra no: avisa lo que no encontró y sigue con lo demás en el mismo mensaje', () => {
    const m = crearMundo();
    const s = registrar(turno(m, { texto: 'quiero pedir queso y una michelada', extraccion: extPedido({ lineas: [linea('queso fundido', 1), linea('michelada', 1)], entrega: 'recojo' }) }));
    expect(s.p!['mensajes'].length).toBe(1);
    expect(s.p!['mensajes'][0]['cuerpo']).toMatch(/^No encuentro «michelada» en la carta\./);
    expect(s.p!['mensajes'][0]['cuerpo']).toContain('Tu pedido:');
    expect(ids(s.p!['mensajes'][0])).toEqual(['p|confirmar', 'p|cambiar']);
  });

  it('delivery: pide la entrega, luego SOLO la dirección (la referencia es opcional), luego el resumen', () => {
    const m = crearMundo();
    turno(m, { texto: 'quiero 1 queso fundido', extraccion: extPedido({ lineas: [linea('queso fundido', 1)] }) });
    expect(estadoDe(m)['paso']).toBe('pedido_entrega');
    const datos = registrar(turno(m, { boton: 'e|delivery' }));
    expect(datos.p!['mensajes'][0]['cuerpo']).toBe('Para el delivery necesito la dirección exacta. Escríbela aquí o comparte tu ubicación con el botón.');
    expect(estadoDe(m)['paso']).toBe('pedido_datos');
    // Con la dirección sola ya sigue al resumen (ni referencia ni nombre se exigen).
    const fin = registrar(turno(m, { texto: 'Calle 5', extraccion: extPedido({ direccion: 'Calle 5' }) }));
    expect(fin.p!['mensajes'][0]['cuerpo']).toContain('Entrega: delivery a Calle 5, recibe Ana Pérez.');
    expect(fin.p!['mensajes'][0]['cuerpo']).toContain('El delivery no está incluido');
    expect(estadoDe(m)['paso']).toBe('pedido_confirmar');
  });

  it('el delivery nunca entra al total aunque el panel traiga un costo', () => {
    const m = crearMundo({ ...CFG_QR, costoDelivery: 10 });
    hastaResumen(m, 'delivery');
    const c = turno(m, { boton: 'p|confirmar' });
    expect(c.p!['mensajes'][0]['monto']).toBe(55);
    expect(c.p!['pedido']['total']).toBe(55);
  });

  it('una bebida suelta por delivery se quita, con su texto, ANTES de pedir los datos; en recojo se queda', () => {
    const m = crearMundo();
    turno(m, { texto: 'quiero pedir queso y cerveza', extraccion: extPedido({ lineas: [linea('queso fundido', 1), linea('cerveza', 2)] }) });
    const s = registrar(turno(m, { boton: 'e|delivery' }));
    expect(s.p!['mensajes'][0]['cuerpo']).toMatch(/^Quité «Cerveza artesanal» de tu pedido porque no lo enviamos por delivery\./);
    expect(s.p!['mensajes'][0]['cuerpo']).toContain('Para el delivery necesito');
    expect(estadoDe(m)['carrito'].map((l: J) => l['nombre'])).toEqual(['Queso fundido con chorizo']);
    const rec = crearMundo();
    turno(rec, { texto: 'quiero pedir queso y cerveza', extraccion: extPedido({ lineas: [linea('queso fundido', 1), linea('cerveza', 2)], entrega: 'recojo' }) });
    expect(estadoDe(rec)['carrito'].length).toBe(2);
    // Si lo único que pidió era la bebida, el carrito queda vacío y se le muestra la carta.
    const solo = crearMundo();
    turno(solo, { texto: 'quiero pedir una cerveza', extraccion: extPedido({ lineas: [linea('cerveza', 1)] }) });
    const v = registrar(turno(solo, { boton: 'e|delivery' }));
    expect(v.p!['mensajes'][0]['cuerpo']).toMatch(/^Quité «Cerveza artesanal»/);
    expect(v.p!['mensajes'][0]['cuerpo']).toContain('Esta es nuestra carta:');
    expect(estadoDe(solo)['paso']).toBe('pedido');
  });

  it('si el local solo acepta una modalidad no se pregunta: va directo a esa', () => {
    const m = crearMundo({ aceptaDelivery: false });
    const s = turno(m, { texto: 'quiero pedir queso', extraccion: extPedido({ lineas: [linea('queso fundido', 1)] }) });
    expect(s.p!['mensajes'][0]['cuerpo']).toContain('Entrega: recojo en el local.');
    const d = crearMundo({ aceptaDelivery: false });
    turno(d, { texto: 'quiero queso para delivery', extraccion: extPedido({ lineas: [linea('queso fundido', 1)], entrega: 'delivery' }) });
    expect(estadoDe(d)['entrega']['entrega']).toBe('recojo');
    const nada = turno(crearMundo({ aceptaDelivery: false, aceptaRetiroEnLocal: false }), { texto: 'quiero pedir queso', extraccion: extPedido({ lineas: [linea('queso fundido', 1)] }) });
    expect(nada.p!['aviso']['tipo']).toBe('transferencia');
  });

  it('«Cambiar algo» reinicia el carrito y la modalidad; conserva la dirección ya dada', () => {
    const m = crearMundo();
    hastaResumen(m, 'delivery');
    const s = turno(m, { boton: 'p|cambiar' });
    expect(s.p!['mensajes'][0]['cuerpo']).toMatch(/^Claro\. Elige de nuevo todo lo que quieres: eso reemplaza tu pedido de ahora \(\d+ × [^)]+\)\. Si mejor lo dejas como está, toca «Dejarlo como estaba»\.\n\nEsta es nuestra carta:/);
    const e = estadoDe(m);
    expect(e['paso']).toBe('pedido');
    expect(e['carrito']).toEqual([]);
    expect(e['entrega']['entrega']).toBe('');
    expect(e['entrega']['direccion']).toBe('Calle Falsa 123');
  });

  it('con QR real: la imagen lleva el pie, `qr_enviado`, la referencia `ped-…` y el monto del código; todavía no hay aviso', () => {
    const m = crearMundo(CFG_QR);
    hastaResumen(m);
    const s = registrar(turno(m, { boton: 'p|confirmar' }));
    const q = s.p!['mensajes'][0];
    expect(s.p!['mensajes'].length).toBe(1);
    expect(q).toMatchObject({ tipo: 'imagen', url: QR, evento: 'qr_enviado', monto: 55 });
    expect(q['referencia']).toMatch(/^ped-/);
    expect(q['cuerpo']).toContain('Total a pagar con este QR: 55 Bs (solo la comida)');
    expect(q['cuerpo']).not.toContain('delivery se paga');
    expect(s.p!['aviso']).toBeNull();
    expect(s.p!['cierre']).toBeNull();
    expect(s.p!['condicionados']).toBeNull();
    expect(estadoDe(m)['paso']).toBe('esperando_comprobante');
    expect(estadoDe(m)['pedido']['pedidoId']).toBe(q['referencia']);
    expect(s.p!['pedido']).toMatchObject({ pedidoId: q['referencia'], total: 55, modalidad: 'recojo' });
    // Con delivery, el pie dice que se paga aparte.
    const d = crearMundo(CFG_QR);
    hastaResumen(d, 'delivery');
    expect(turno(d, { boton: 'p|confirmar' }).p!['mensajes'][0]['cuerpo']).toContain('el delivery se paga aparte');
  });

  it('un QR sin dirección https (cobro a medias) no se manda: va el plan B', () => {
    const m = crearMundo({ cobro: { activo: true, qrUrl: 'http://ejemplo.invalid/qr.png' } });
    hastaResumen(m);
    const s = turno(m, { boton: 'p|confirmar' });
    expect(s.p!['mensajes']).toEqual([]);
    expect(s.p!['aviso']['datos']['resultado']).toBe('sin_qr');
  });

  it('plan B (sin QR): aviso de tipo pedido, textos condicionados al aviso, registro de 300 caracteres o menos', () => {
    const m = crearMundo();
    hastaResumen(m);
    const s = registrar(turno(m, { boton: 'p|confirmar' }));
    const p = s.p!;
    expect(p['mensajes']).toEqual([]);
    expect(p['aviso']['tipo']).toBe('pedido');
    expect(p['aviso']['datos']).toMatchObject({
      resultado: 'sin_qr', estado: 'sin QR: cobrar al entregar', from: FROM, nombrePerfil: 'Ana Pérez', telefono: FROM,
      total: 55, modalidad: 'recojo', nombre: 'Ana Pérez', lineas: [{ cantidad: 1, nombre: 'Orden de 3 tacos de birria', detalle: '' }],
    });
    expect(p['aviso']['datos']['pedido']['pedidoId']).toMatch(/^ped-/);
    expect(p['aviso']['datos']['codigo']).toBe(p['pedido']['codigo']);
    const si = p['condicionados']['siSalio'][0];
    const no = p['condicionados']['siNoSalio'][0];
    expect(si['cuerpo']).toMatch(/^Listo: pasé tu pedido #\w+ al restaurante\. El pago lo coordinas con ellos al recoger\.$/);
    expect(si['tipo']).toBe('texto');
    expect(no['cuerpo']).toContain('No pude pasarle tu pedido a nuestro equipo');
    expect(no['tipo']).toBe('enlace');
    expect(no['url']).toBe('https://wa.me/59100000099');
    expect(no['botones']).toEqual([{ id: '', title: 'Escribir al local' }]);
    // La promesa y su opuesto nunca viajan juntos.
    expect(si['cuerpo']).not.toContain('No pude');
    expect(no['cuerpo']).not.toContain('pasé tu pedido #');
    expect(p['cierre']['tipo']).toBe('registro');
    expect(p['cierre']['detalle'].length).toBeLessThanOrEqual(300);
    expect(p['cierre']['detalle']).toContain('Total 55 Bs');
    expect(p['pedido']).toMatchObject({ resultado: 'sin_qr', total: 55 });
    expect(estadoDe(m)['paso']).toBe('menu');
    expect(estadoDe(m)['carrito']).toEqual([]);
  });

  it('plan B con delivery: el pago se coordina «al recibir»; el aviso trae dirección y referencia', () => {
    const m = crearMundo();
    hastaResumen(m, 'delivery');
    const p = turno(m, { boton: 'p|confirmar' }).p!;
    expect(p['condicionados']['siSalio'][0]['cuerpo']).toContain('al recibir');
    expect(p['aviso']['datos']).toMatchObject({ modalidad: 'delivery', direccion: 'Calle Falsa 123', referencia: 'casa azul' });
  });

  it('en recojo el aviso no lleva dirección ni referencia', () => {
    const m = crearMundo();
    hastaResumen(m);
    const p = turno(m, { boton: 'p|confirmar' }).p!;
    expect(p['aviso']['datos']['direccion']).toBe('');
    expect(p['aviso']['datos']['referencia']).toBe('');
  });

  it('confirmar con el pedido incompleto no avisa: muestra lo que falta', () => {
    const m = crearMundo();
    hastaResumen(m);
    // Se rompe el estado a propósito: carrito vacío con el paso de confirmación.
    sdDe(m)['estados'][FROM]['carrito'] = [];
    const s = turno(m, { boton: 'p|confirmar' });
    expect(s.p!['aviso']).toBeNull();
    expect(s.p!['mensajes'][0]['cuerpo']).toMatch(/^Esta es nuestra carta:/);
  });

  it('dos teléfonos no comparten estado', () => {
    const m = crearMundo();
    hastaResumen(m);
    turno(m, { from: OTRO, texto: 'hola' });
    expect(estadoDe(m, OTRO)['paso']).toBe('menu');
    expect(estadoDe(m, OTRO)['carrito']).toEqual([]);
    expect(estadoDe(m)['paso']).toBe('pedido_confirmar');
    expect(estadoDe(m)['carrito'].length).toBe(1);
  });

  it('un estado vencido (60 min) vuelve a `inicio`', () => {
    const m = crearMundo();
    hastaResumen(m);
    m.ahora += 61 * 60000;
    const s = turno(m, { texto: 'hola' });
    expect(s.p!['mensajes'][0]['cuerpo']).toMatch(/^¡Hola! 👋 Gracias por escribir a .* Soy el asistente virtual/);
    expect(estadoDe(m)['carrito']).toEqual([]);
  });
});

describe('Plan del turno: derivar a una persona (solo se ofrece lo que se cumple)', () => {
  it('con `quiereHablar`: texto fijo, botón con enlace al local y aviso de transferencia', () => {
    const m = crearMundo();
    const s = registrar(turno(m, { texto: 'tengo un problema con mi pedido de ayer, necesito ayuda de una persona', extraccion: extPedido({ quiereHablar: true }) }));
    expect(s.d['accion']).toBe('extraer_pedido');
    const msg = s.p!['mensajes'][0];
    expect(msg).toMatchObject({ tipo: 'enlace', cuerpo: '¡Claro! 🙂 Toca «Escribir al local» y conversas directamente con nuestro equipo. Para volver al inicio, escribe «menú».', url: 'https://wa.me/59100000099' });
    expect(s.p!['aviso']['tipo']).toBe('transferencia');
    expect(s.p!['aviso']['datos']).toMatchObject({ from: FROM, nombrePerfil: 'Ana Pérez', telefono: FROM, motivo: 'tengo un problema con mi pedido de ayer, necesito ayuda de una persona' });
    expect(s.p!['aviso']['datos']['codigo']).toMatch(/^[0-9A-Z]{4}$/);
  });

  it('dos extracciones seguidas sin líneas: la primera muestra la carta, la segunda deriva; con líneas el contador se reinicia', () => {
    const m = crearMundo();
    const a = turno(m, { texto: 'quiero pedir algo rico', extraccion: extPedido() });
    expect(a.p!['mensajes'][0]['cuerpo']).toMatch(/^Esta es nuestra carta:/);
    expect(a.p!['aviso']).toBeNull();
    expect(estadoDe(m)['vacias']).toBe(1);
    const b = turno(m, { texto: 'lo que sea', extraccion: extPedido() });
    expect(b.p!['mensajes'][0]['tipo']).toBe('enlace');
    expect(b.p!['aviso']['tipo']).toBe('transferencia');
    expect(estadoDe(m)['vacias']).toBe(0);
    // Negativo: sin líneas, pero entre dos mensajes con líneas, no deriva.
    const n = crearMundo();
    turno(n, { texto: 'quiero pedir x', extraccion: extPedido() });
    turno(n, { texto: 'queso', extraccion: extPedido({ lineas: [linea('queso fundido', 1)] }) });
    const c = turno(n, { texto: 'x', extraccion: extPedido() });
    expect(c.p!['aviso']).toBeNull();
    expect(c.p!['mensajes'][0]['tipo']).toBe('botones'); // sigue en el paso donde estaba, con su botón
  });

  it('un mensaje con solo datos de entrega no cuenta como «sin líneas»', () => {
    const m = crearMundo();
    turno(m, { texto: 'quiero pedir queso', extraccion: extPedido({ lineas: [linea('queso fundido', 1)] }) });
    turno(m, { boton: 'e|delivery' });
    turno(m, { texto: 'Calle 5', extraccion: extPedido({ direccion: 'Calle 5' }) });
    const s = turno(m, { texto: 'casa azul', extraccion: extPedido({ referencia: 'casa azul' }) });
    expect(s.p!['aviso']).toBeNull();
    expect(estadoDe(m)['paso']).toBe('pedido_confirmar');
  });

  it('si el modelo falla (sin JSON), se deriva: nunca «tuve un problema técnico»', () => {
    const m = crearMundo();
    const s = registrar(turno(m, { texto: 'quiero 3 tacos de birria', extraccion: { error: { code: 500 } } }));
    expect(s.p!['aviso']['tipo']).toBe('transferencia');
    expect(s.p!['mensajes'][0]['tipo']).toBe('enlace');
    expect(s.p!['errores']).toContain('extraccion_invalida');
    const sinNodo = turno(crearMundo(), { texto: 'quiero reservar una mesa' });
    expect(sinNodo.p!['aviso']['tipo']).toBe('transferencia');
    expect(sinNodo.p!['errores']).toContain('extraccion_invalida');
  });

  it('R3: el plan SIEMPRE pide el aviso de derivación y no escribe ninguna marca ni suprime el aviso por su cuenta', () => {
    // El tope por teléfono y por hora lo aplica `Armar avisos` con la marca que escribe `Armar mensajes` solo si el aviso
    // salió (prueba en `venta-minima-salida` y de punta a punta en `venta-minima-integracion`). Aquí, negado: aunque haya
    // una derivación reciente, el plan vuelve a pedir el aviso, y no deja nada en `transferencias` ni en `sd`.
    const m = crearMundo();
    const a = turno(m, { texto: 'quiero hablar con una persona' });
    expect(a.p!['aviso']['tipo']).toBe('transferencia');
    expect(a.p!['estadoNuevo']['transferencias']).toEqual([]);
    expect(sdDe(m)['transferencias']).toBeUndefined();
    m.ahora += 60 * 1000;
    const b = turno(m, { texto: 'quiero hablar con una persona' });
    expect(b.p!['aviso']['tipo']).toBe('transferencia');
    expect(b.p!['mensajes'][0]['tipo']).toBe('enlace');
    expect(b.p!['estadoNuevo']['transferencias']).toEqual([]);
    expect(sdDe(m)['transferencias']).toBeUndefined();
    // Con cualquier tope configurado (también 0), el plan pide el aviso: el tope no es cosa suya.
    for (const tope of [0, 1, 2]) {
      const w = crearMundo({ topeTransferenciasHora: tope });
      turno(w, { texto: 'tengo una queja' });
      expect(turno(w, { texto: 'tengo una queja' }).p!['aviso']['tipo']).toBe('transferencia');
    }
  });

  it('sin número de recepción utilizable el botón no tiene enlace y se anota el error', () => {
    const s = turno(crearMundo({ numeroRecepcion: 'REEMPLAZAR_NUMERO_RECEPCION_QTACO' }), { texto: 'tengo una queja' });
    expect(s.p!['mensajes'][0]['url']).toBe('');
    expect(s.p!['errores']).toContain('sin_numero_recepcion');
  });
});

describe('Plan del turno: el comprobante', () => {
  const enEspera = (extra: J = {}): Mundo => {
    const m = crearMundo({ ...CFG_QR, ...extra });
    hastaResumen(m);
    turno(m, { boton: 'p|confirmar' });
    return m;
  };
  const cotejo = (resultado: string, extra: J = {}) => ({ statusCode: 200, body: { resultado, ...extra } });

  it('cuadra: aviso de comprobante; «ya pasé» solo si el aviso salió, y si no, «no pude» con botón', () => {
    const m = enEspera();
    const s = registrar(turno(m, { tipo: 'image', esComprobante: true, mediaId: 'media-1', cotejo: cotejo('cuadra', { cierreId: 'cierre-1' }) }));
    const p = s.p!;
    expect(s.d['accion']).toBe('comprobante');
    expect(p['mensajes']).toEqual([]);
    expect(p['aviso']['tipo']).toBe('comprobante');
    expect(p['aviso']['datos']).toMatchObject({ resultado: 'cuadra', estado: 'comprobante: datos coinciden', mediaId: 'media-1', total: 55, from: FROM });
    const si = p['condicionados']['siSalio'][0];
    const no = p['condicionados']['siNoSalio'][0];
    expect(si['cuerpo']).toContain('Ya lo pasé a nuestro equipo');
    expect(si['tipo']).toBe('texto');
    expect(no['cuerpo']).toContain('No pude pasarle tu pedido');
    expect(no['cuerpo']).not.toMatch(/ya (lo |la )?pas[eé]/i);
    expect(no['tipo']).toBe('enlace');
    expect(p['pedido']).toMatchObject({ resultado: 'cuadra', mediaId: 'media-1', total: 55 });
    expect(p['pedido']['lineas'].length).toBe(1);
    expect(p['cierre']).toBeNull(); // el cierre de venta lo crea el cotejo en el servidor
    expect(estadoDe(m)['paso']).toBe('menu');
    expect(estadoDe(m)['pedido']).toBeNull();
  });

  it('no cuadra: el aviso lleva las diferencias y el estado «NO coinciden»; ambos textos con botón', () => {
    const m = enEspera();
    const p = registrar(turno(m, { tipo: 'image', esComprobante: true, mediaId: 'media-2', cotejo: cotejo('no_cuadra', { diferencias: ['El comprobante dice 50 y el pedido es de 55'] }) })).p!;
    expect(p['aviso']['datos']).toMatchObject({ resultado: 'no_cuadra', estado: 'comprobante: NO coinciden', diferencias: ['El comprobante dice 50 y el pedido es de 55'] });
    expect(p['condicionados']['siSalio'][0]['tipo']).toBe('enlace');
    expect(p['condicionados']['siNoSalio'][0]['tipo']).toBe('enlace');
  });

  it('ilegible: la primera vez se pide de nuevo (sin aviso, sigue esperando); la segunda se avisa', () => {
    const m = enEspera();
    const a = registrar(turno(m, { tipo: 'image', esComprobante: true, cotejo: cotejo('ilegible') }));
    expect(a.p!['aviso']).toBeNull();
    expect(a.p!['mensajes'][0]['cuerpo']).toContain('no pude leerlo bien');
    expect(estadoDe(m)['paso']).toBe('esperando_comprobante');
    expect(estadoDe(m)['ilegibles']).toBe(1);
    expect(estadoDe(m)['pedido']).not.toBeNull();
    const b = registrar(turno(m, { tipo: 'image', esComprobante: true, cotejo: cotejo('ilegible') }));
    expect(b.p!['aviso']['datos']).toMatchObject({ resultado: 'ilegible', estado: 'comprobante ilegible' });
    expect(b.p!['condicionados']['siSalio'][0]['cuerpo']).toContain('Ya lo pasé a nuestro equipo');
    expect(estadoDe(m)['paso']).toBe('menu');
  });

  it('sin cotejo (el servidor falló o no se llegó a cotejar): se avisa «sin cotejar», nunca «cuadra»', () => {
    const m = enEspera();
    const p = turno(m, { tipo: 'image', esComprobante: true, cotejo: { statusCode: 500, body: {} } }).p!;
    expect(p['aviso']['datos']).toMatchObject({ resultado: 'sin_cotejo', estado: 'comprobante sin cotejar' });
    const n = enEspera();
    const q = turno(n, { tipo: 'image', esComprobante: true }).p!; // ni lectura ni cotejo corrieron
    expect(q['aviso']['datos']['resultado']).toBe('sin_cotejo');
    // Una lectura ilegible sin cotejo es «ilegible»: la primera vez se pide de nuevo, la segunda se avisa.
    const l = enEspera();
    const r = turno(l, { tipo: 'image', esComprobante: true, lectura: { legible: false } }).p!;
    expect(r['aviso']).toBeNull();
    expect(r['mensajes'][0]['cuerpo']).toContain('no pude leerlo bien');
    const r2 = turno(l, { tipo: 'image', esComprobante: true, lectura: { legible: false } }).p!;
    expect(r2['aviso']['datos']['resultado']).toBe('ilegible');
  });

  it('409 después de `cuadra` (ya cotejado): «Ya tengo el comprobante», sin aviso nuevo', () => {
    const m = enEspera();
    turno(m, { tipo: 'image', esComprobante: true, mediaId: 'm1', cotejo: cotejo('cuadra') });
    // El pedido quedó guardado con su resultado; el servidor todavía lo ve como pendiente y devuelve 409.
    const ref = Object.keys(sdDe(m)['pedidos'])[0]!;
    m.cfg['cobro'] = { ...CFG_QR.cobro, pedidoRef: ref, pendiente: true };
    const s = registrar(turno(m, { tipo: 'image', esComprobante: true, mediaId: 'm2', cotejo: { statusCode: 409, body: { error: 'sin_sena_pendiente' } } }));
    expect(s.p!['aviso']).toBeNull();
    expect(s.p!['pedido']).toBeNull();
    expect(s.p!['mensajes'][0]['cuerpo']).toMatch(/^Ya tengo el comprobante de tu pedido #/);
    expect(s.p!['mensajes'][0]['tipo']).toBe('enlace');
    // Negativo: el 409 de un pedido que NO cuadró (QR vencido) es «sin cotejar», no «ya cotejado».
    const v = enEspera();
    const sin = turno(v, { tipo: 'image', esComprobante: true, cotejo: { statusCode: 409, body: { error: 'sin_sena_pendiente' } } });
    expect(sin.p!['aviso']['datos']['resultado']).toBe('sin_cotejo');
  });

  it('el pedido se busca por la referencia del servidor; sin pedido en ningún lado, se deriva', () => {
    const m = enEspera();
    const ref = estadoDe(m)['pedido']['pedidoId'];
    sdDe(m)['pedidos'] = { [ref]: { ...estadoDe(m)['pedido'], codigo: 'ZZ99' } };
    delete sdDe(m)['estados'][FROM]; // el estado venció, pero el pedido está guardado
    m.cfg['cobro'] = { ...CFG_QR.cobro, pedidoRef: ref, pendiente: true };
    const s = turno(m, { tipo: 'image', esComprobante: true, cotejo: cotejo('cuadra') });
    expect(s.p!['aviso']['datos']['codigo']).toBe('ZZ99');
    const nada = crearMundo(CFG_QR);
    const d = turno(nada, { tipo: 'image', esComprobante: true, cotejo: cotejo('cuadra') });
    expect(d.p!['aviso']['tipo']).toBe('transferencia');
    expect(d.p!['mensajes'][0]['tipo']).toBe('enlace');
  });

  it('recordatorio y reenvío del QR: dos botones; el reenvío no vuelve a reportar `qr_enviado`', () => {
    const m = enEspera();
    const r = registrar(turno(m, { texto: 'ya pagué' }));
    expect(r.p!['mensajes'][0]['cuerpo']).toMatch(/^Tu pedido #\w+ sigue pendiente: falta que me envíes la foto o el PDF del comprobante del QR\. Si ya no lo quieres, toca «Cancelar pedido»\.$/);
    expect(ids(r.p!['mensajes'][0])).toEqual(['q|reenviar', 'q|cancelar']);
    expect(titulos(r.p!['mensajes'][0])).toEqual(['Reenviar QR', 'Cancelar pedido']);
    const q = turno(m, { boton: 'q|reenviar' });
    expect(q.p!['mensajes'][0]).toMatchObject({ tipo: 'imagen', url: QR });
    expect(q.p!['mensajes'][0]['evento']).toBeUndefined();
    expect(q.p!['aviso']).toBeNull();
    expect(estadoDe(m)['paso']).toBe('esperando_comprobante');
    const c = turno(m, { boton: 'q|cancelar' });
    expect(estadoDe(m)['paso']).toBe('menu');
    expect(estadoDe(m)['pedido']).toBeNull();
    expect(c.p!['aviso']).toBeNull();
  });

  it('el estado de «esperando comprobante» dura 24 h', () => {
    const m = enEspera();
    m.ahora += 23 * 3600000;
    expect(turno(m, { texto: 'gracias' }).d['accion']).toBe('recordatorio_comprobante');
    const v = enEspera();
    v.ahora += 25 * 3600000;
    expect(turno(v, { texto: 'hola' }).d['accion']).toBe('menu');
  });
});

describe('Plan del turno: la reserva', () => {
  const datos = (o: J = {}) => extReserva({ personas: 4, fecha: '2026-10-09', hora: '20:00', zona: 'salón', ...o });

  it('«Reservar mesa» pide los datos en un solo mensaje, con las zonas del negocio', () => {
    const m = crearMundo();
    const s = registrar(turno(m, { boton: 'm|reserva' }));
    expect(s.p!['mensajes'][0]['cuerpo']).toBe('Para tu solicitud de reserva dime, en un solo mensaje: cuántas personas, qué día y a qué hora, si prefieres salón o terraza y a nombre de quién.');
    expect(estadoDe(m)['paso']).toBe('reserva');
  });

  it('con todo lo necesario muestra el resumen con «Reservar» y «Corregir»; sin aviso todavía', () => {
    const m = crearMundo();
    turno(m, { boton: 'm|reserva' });
    const s = registrar(turno(m, { texto: 'mesa para 4 el viernes a las 8', extraccion: datos() }));
    const msg = s.p!['mensajes'][0];
    expect(msg['cuerpo']).toContain('Tu reserva:');
    expect(titulos(msg)).toEqual(['Reservar', 'Corregir']);
    expect(ids(msg)).toEqual(['r|enviar', 'r|corregir']);
    expect(s.p!['aviso']).toBeNull();
    expect(estadoDe(m)['paso']).toBe('reserva_confirmar');
  });

  it('lo que falta se pregunta; un campo inválido da la pregunta específica y NINGÚN aviso', () => {
    const m = crearMundo();
    turno(m, { boton: 'm|reserva' });
    const falta = registrar(turno(m, { texto: 'mesa para 4', extraccion: extReserva({ personas: 4 }) }));
    expect(falta.p!['mensajes'][0]['cuerpo']).toBe('Para tu solicitud de reserva me falta saber fecha, hora.');
    expect(falta.p!['aviso']).toBeNull();
    const pasada = registrar(turno(m, { texto: 'el 1 a las 8', extraccion: extReserva({ fecha: '2026-10-01', hora: '20:00' }) }));
    expect(pasada.p!['mensajes'][0]['cuerpo']).toBe('Esa fecha ya pasó. ¿Para qué día quieres la reserva?');
    expect(pasada.p!['aviso']).toBeNull();
    expect(estadoDe(m)['paso']).toBe('reserva');
    // Lo ya dicho se conserva y el campo corregido pisa al inválido.
    const ok = turno(m, { texto: 'mejor el 9', extraccion: extReserva({ fecha: '2026-10-09' }) });
    expect(ok.p!['mensajes'][0]['cuerpo']).toContain('Tu reserva:');
    const zona = crearMundo();
    turno(zona, { boton: 'm|reserva' });
    const jardin = turno(zona, { texto: 'en el jardín', extraccion: datos({ zona: 'jardín' }) });
    expect(jardin.p!['mensajes'][0]['cuerpo']).toContain('No tengo «jardín»');
    expect(jardin.p!['aviso']).toBeNull();
  });

  it('sin horario cargado no se toma ninguna solicitud: se pasa con el local', () => {
    const m = crearMundo({ horario: '' });
    turno(m, { boton: 'm|reserva' });
    const s = turno(m, { texto: 'mesa', extraccion: datos() });
    expect(s.p!['aviso']['tipo']).toBe('transferencia');
    expect(s.p!['mensajes'][0]['tipo']).toBe('enlace');
  });

  it('«Reservar»: aviso de tipo reserva, textos condicionados («Anotamos» solo si salió), cierre y `anotarReserva`', () => {
    const m = crearMundo();
    turno(m, { boton: 'm|reserva' });
    turno(m, { texto: 'mesa', extraccion: datos({ celebracion: 'cumpleaños' }) });
    const s = registrar(turno(m, { boton: 'r|enviar' }));
    const p = s.p!;
    expect(p['mensajes']).toEqual([]);
    expect(p['aviso']['tipo']).toBe('reserva');
    expect(p['aviso']['datos']).toMatchObject({
      from: FROM, nombrePerfil: 'Ana Pérez', telefono: FROM, nombre: 'Ana Pérez',
      reserva: { personas: 4, fecha: '2026-10-09', hora: '20:00', zona: 'salón', nombre: 'Ana Pérez', celebracion: 'cumpleaños' },
    });
    expect(p['aviso']['datos']['codigo']).toMatch(/^[0-9A-Z]{4}$/);
    expect(p['condicionados']['siSalio'][0]['cuerpo']).toBe('¡Listo, Ana! Anotamos tu reserva para el 2026-10-09 a las 20:00, 4 personas, salón. Te esperamos en Av. Ejemplo 123.');
    // Con el aviso salido NO hay «Escribir al local» ni promesa de contacto.
    expect(p['condicionados']['siSalio'][0]['tipo']).toBe('texto');
    expect(p['condicionados']['siNoSalio'][0]['cuerpo']).toBe('No pude hacer llegar tu reserva a nuestro equipo en este momento. Escríbenos directamente con el botón para reservar.');
    expect(p['condicionados']['siNoSalio'][0]['tipo']).toBe('enlace');
    expect(p['condicionados']['siNoSalio'][0]['botones'][0]['title']).toBe('Escribir al local');
    expect(p['aviso']['datos']['reserva']['diaLleno']).toBeUndefined();
    expect(p['cierre']['tipo']).toBe('registro');
    expect(p['cierre']['detalle'].length).toBeLessThanOrEqual(300);
    expect(p['anotarReserva']).toBe(true);
    expect(estadoDe(m)['paso']).toBe('menu');
    expect(estadoDe(m)['reserva']).toBeNull();
  });

  it('«Ver ubicación»: con un enlace de Google Maps válido, la confirmación lleva ese botón (CTA), sin «Escribir al local» ni chat', () => {
    const URL_MAPA = 'https://www.google.com/maps/place/Q+Taco/@-17.78,-63.18,17z';
    const m = crearMundo({ direccionMaps: URL_MAPA });
    turno(m, { boton: 'm|reserva' });
    turno(m, { texto: 'mesa', extraccion: datos() });
    const s = registrar(turno(m, { boton: 'r|enviar' }));
    const c = s.p!['condicionados']['siSalio'][0];
    expect(c).toMatchObject({ tipo: 'enlace', mapa: true, url: URL_MAPA });
    expect(c['botones'].map((b: J) => b['title'])).toEqual(['Ver ubicación']);
    expect(c['cuerpo']).toMatch(/^¡Listo, Ana! Anotamos tu reserva para /);
    expect(JSON.stringify(s.p!['condicionados']['siSalio'])).not.toMatch(/wa\.me|Escribir al local/);
    // «Escribir al local» solo existe en el texto honesto de «no salió».
    expect(s.p!['condicionados']['siNoSalio'][0]['botones'][0]['title']).toBe('Escribir al local');
  });

  it('«Ver ubicación»: SIN enlace válido no hay botón (ausente, otro dominio, http, con espacios, de más de 200 caracteres)', () => {
    const malos = [undefined, '', 'https://evil.example/maps/x', 'http://www.google.com/maps/x', 'https://www.google.com/maps/x y',
      'https://www.google.com.evil.example/maps/x', 'https://wa.me/59170000000', 'https://www.google.com/maps/' + 'a'.repeat(200), 42];
    for (const direccionMaps of malos) {
      const m = crearMundo({ direccionMaps });
      turno(m, { boton: 'm|reserva' });
      turno(m, { texto: 'mesa', extraccion: datos() });
      const c = turno(m, { boton: 'r|enviar' }).p!['condicionados']['siSalio'][0];
      expect(c['tipo'], String(direccionMaps)).toBe('texto');
      expect(c['cuerpo']).toMatch(/^¡Listo, Ana! Anotamos tu reserva para /);
    }
  });

  it('«Corregir» vuelve a los datos (conservando lo dicho); un botón de envío viejo no avisa', () => {
    const m = crearMundo();
    turno(m, { boton: 'm|reserva' });
    turno(m, { texto: 'mesa', extraccion: datos() });
    const c = turno(m, { boton: 'r|corregir' });
    expect(c.p!['mensajes'][0]['cuerpo']).toContain('Tu reserva:');
    expect(estadoDe(m)['paso']).toBe('reserva_confirmar');
    // En el menú (otro paso), el mismo botón es viejo: no hay aviso.
    const otro = crearMundo();
    const s = turno(otro, { boton: 'r|enviar' });
    expect(s.p!['aviso']).toBeNull();
    expect(s.p!['anotarReserva']).toBe(false);
  });

  it('al enviar se vuelve a validar: una fecha que ya pasó no se avisa', () => {
    const m = crearMundo();
    turno(m, { boton: 'm|reserva' });
    turno(m, { texto: 'mesa', extraccion: datos() });
    sdDe(m)['estados'][FROM]['reserva']['fecha'] = '2026-10-01'; // la fecha del resumen ya no vale
    const s = turno(m, { boton: 'r|enviar' });
    expect(s.p!['aviso']).toBeNull();
    expect(s.p!['mensajes'][0]['cuerpo']).toContain('Esa fecha ya pasó');
  });

  it('varias reservas hoy del mismo número: de la 4.ª a la 6.ª se anotan y el aviso al local las marca «VARIAS RESERVAS HOY DE ESTE NÚMERO/revisar»; la 7.ª (techo duro) no arma aviso', () => {
    const m = crearMundo();
    const enviar = (): Salida => {
      turno(m, { boton: 'm|reserva' });
      turno(m, { texto: 'mesa', extraccion: datos() });
      return turno(m, { boton: 'r|enviar' });
    };
    for (let i = 0; i < 3; i++) expect(enviar().p!['aviso']['datos']['reserva']['diaLleno']).toBeUndefined();
    const cuarta = registrar(enviar());
    expect(cuarta.p!['aviso']['tipo']).toBe('reserva');
    expect(cuarta.p!['aviso']['datos']['reserva']['diaLleno']).toBe(true);
    expect(cuarta.p!['anotarReserva']).toBe(true);
    expect(cuarta.p!['cierre']['tipo']).toBe('registro');
    // El MISMO texto de reserva, sin derivar y sin «Escribir al local» al cliente.
    expect(cuarta.p!['condicionados']['siSalio'][0]['cuerpo']).toMatch(/^¡Listo, Ana! Anotamos tu reserva para /);
    expect(cuarta.p!['condicionados']['siSalio'][0]['tipo']).toBe('texto');
    expect(JSON.stringify(cuarta.p!['condicionados'])).not.toMatch(/lleno|tope|ya no puedo tomar/i);
    for (let i = 0; i < 2; i++) {
      const s = registrar(enviar());
      expect(s.p!['aviso']['datos']['reserva']['diaLleno'], `reserva ${5 + i}`).toBe(true);
    }
    // TECHO DURO (2 × topeReservasDia = 6): la séptima NO arma aviso y NO dice que se anotó; texto honesto con «Escribir al local».
    const septima = registrar(enviar());
    expect(septima.p!['aviso']).toBeNull();
    expect(septima.p!['anotarReserva']).toBe(false);
    expect(septima.p!['cierre']).toBeNull();
    expect(septima.p!['condicionados']).toBeNull();
    expect(septima.p!['mensajes'][0]['tipo']).toBe('enlace');
    expect(septima.p!['mensajes'][0]['cuerpo']).toBe('No pude hacer llegar tu reserva a nuestro equipo en este momento. Escríbenos directamente con el botón para reservar.');
    expect(septima.p!['mensajes'][0]['botones'][0]['title']).toBe('Escribir al local');
    expect(JSON.stringify(septima.p)).not.toMatch(/Anotamos|Te esperamos/);
    // Otro teléfono tiene su propio conteo; al día siguiente se reinicia.
    turno(m, { from: OTRO, boton: 'm|reserva' });
    turno(m, { from: OTRO, texto: 'mesa', extraccion: datos() });
    expect(turno(m, { from: OTRO, boton: 'r|enviar' }).p!['aviso']['datos']['reserva']['diaLleno']).toBeUndefined();
    m.ahora += 24 * 3600000;
    expect(enviar().p!['aviso']['datos']['reserva']['diaLleno']).toBeUndefined();
  });

  it('grupo grande: el mismo texto de reserva; el aviso lleva la reserva con `grupoGrande` (la marca «GRUPO GRANDE» la pone el aviso)', () => {
    const m = crearMundo();
    turno(m, { boton: 'm|reserva' });
    turno(m, { texto: 'mesa', extraccion: datos() });
    sdDe(m)['estados'][FROM]['reserva']['grupoGrande'] = true;
    sdDe(m)['estados'][FROM]['reserva']['personas'] = 15;
    const s = registrar(turno(m, { boton: 'r|enviar' }));
    expect(s.p!['condicionados']['siSalio'][0]['cuerpo']).toMatch(/^¡Listo, Ana! Anotamos tu reserva para .*15 personas/);
    expect(s.p!['aviso']['tipo']).toBe('reserva');
    expect(JSON.stringify(s.p!['condicionados'])).not.toMatch(/grande|revisa/i);
  });

  it('DOCUMENTA el supuesto 4: el plan NO escribe en `sd`; sin el `rsAnotar` de T7b el tope nunca se alcanza', () => {
    const m = crearMundo();
    for (let i = 0; i < 5; i++) {
      turno(m, { boton: 'm|reserva' });
      turno(m, { texto: 'mesa', extraccion: datos() });
      const p = turno(m, { boton: 'r|enviar' }).p!;
      expect(p['aviso']['tipo']).toBe('reserva');
      expect(p['anotarReserva']).toBe(true); // lo que el plan le pide a T7b
      // Lo que NO hace T7b en esta prueba: borrar la anotación que hizo `turno()`.
      delete sdDe(m)['reservasDelDia'];
    }
    // Sin anotaciones, la quinta solicitud sigue avisando: el tope depende por completo de T7b.
    expect(sdDe(m)['reservasDelDia']).toBeUndefined();
  });

  it('sin tope en la configuración el techo duro falla cerrado (`rsDentroDelTope` da false): sin aviso y sin decir que se anotó', () => {
    const m = crearMundo();
    turno(m, { boton: 'm|reserva' });
    turno(m, { texto: 'mesa', extraccion: datos() });
    delete m.cfg['topeReservasDia'];
    const s = turno(m, { boton: 'r|enviar' });
    expect(s.p!['aviso']).toBeNull();
    expect(s.p!['mensajes'][0]['cuerpo']).toMatch(/^No pude hacer llegar tu reserva/);
    expect(s.p!['mensajes'][0]['tipo']).toBe('enlace');
  });
});

describe('Vigencia, botones de promoción y costo en mensajes', () => {
  it('la campaña vencida no cuenta aunque el texto coincida: el reloj del turno llega a `prCampanaDelTexto` y a `prFicha`', () => {
    const vencida = [{ id: 'c1', texto: 'Quiero la Promo Dúo', inicio: '2026-10-01T04:00:00.000Z', fin: new Date(AHORA - 1).toISOString() }];
    const vigente = [{ id: 'c1', texto: 'Quiero la Promo Dúo', inicio: '2026-10-01T04:00:00.000Z', fin: new Date(AHORA + 3600000).toISOString() }];
    expect(turno(crearMundo({ campanas: vencida }), { texto: 'Quiero la Promo Dúo' }).d['accion']).not.toBe('promo');
    expect(turno(crearMundo({ campanas: vigente }), { texto: 'Quiero la Promo Dúo' }).d['accion']).toBe('promo');
    // En la consulta de promociones, una campaña vencida no se muestra.
    expect(turno(crearMundo({ campanas: vencida }), { texto: 'tienen promociones' }).p!['mensajes'][0]['cuerpo']).toContain('no tenemos promociones');
  });

  it('«Pedir la promo» con un ítem que ya no está en la carta vuelve al menú, sin carrito', () => {
    const m = crearMundo();
    turno(m, { texto: 'hola' });
    const s = turno(m, { boton: 'g|pedir|no-existe' });
    // Ya estaba en el menú: la vuelta es corta (el saludo completo es solo para el primer mensaje).
    expect(s.p!['mensajes'][0]['cuerpo']).toBe('¿Qué te gustaría hacer ahora?');
    expect(estadoDe(m)['carrito']).toEqual([]);
  });

  it('una acción que el plan no conoce se deriva y se anota (nunca se calla)', () => {
    const t: J = { from: FROM, nombrePerfil: 'Ana Pérez', ahoraMs: AHORA, tipo: 'text', texto: 'x' };
    const d = { accion: 'inventada', estado: { paso: 'menu' }, errores: [], texto: 'x' };
    const p = ejecutar(`${DOBLES}\n${PLAN}`, [{}], { 'Config del negocio': CFG, 'Interpretar entrada': t, 'Decidir turno': d },
      { $getWorkflowStaticData: () => ({}) })[0]!;
    expect(p['errores']).toContain('accion_desconocida');
    expect(p['aviso']['tipo']).toBe('transferencia');
  });

  it('costo: un pedido de recojo con QR son 6 mensajes al cliente (menú, carta, entrega, resumen, QR, comprobante)', () => {
    const m = crearMundo(CFG_QR);
    const contar = (s: Salida): number => s.p!['mensajes'].length + (s.p!['condicionados']?.['siSalio']?.length ?? 0);
    let n = 0;
    n += contar(turno(m, { texto: 'hola' }));
    n += contar(turno(m, { boton: 'm|pedido' }));
    n += contar(turno(m, { texto: '1 queso fundido', extraccion: extPedido({ lineas: [linea('queso fundido', 1)] }) }));
    n += contar(turno(m, { boton: 'e|recojo' }));
    n += contar(turno(m, { boton: 'p|confirmar' }));
    n += contar(turno(m, { tipo: 'image', esComprobante: true, cotejo: { statusCode: 200, body: { resultado: 'cuadra' } } }));
    expect(n).toBe(6);
  });

  it('costo: una reserva son 4 mensajes (menú, datos, resumen, enviada)', () => {
    const m = crearMundo();
    const contar = (s: Salida): number => s.p!['mensajes'].length + (s.p!['condicionados']?.['siSalio']?.length ?? 0);
    let n = 0;
    n += contar(turno(m, { texto: 'hola' }));
    n += contar(turno(m, { boton: 'm|reserva' }));
    n += contar(turno(m, { texto: 'mesa', extraccion: extReserva({ personas: 4, fecha: '2026-10-09', hora: '20:00' }) }));
    n += contar(turno(m, { boton: 'r|enviar' }));
    expect(n).toBe(4);
  });
});

// =================================================================================================
// COBRO SIMULADO (piloto de Q'Taco): la foto es el comprobante de la prueba. Nunca se coteja ni se lee con Gemini.
// =================================================================================================
describe('Plan del turno: el cobro SIMULADO (QR de prueba, comprobante sin cotejo)', () => {
  const enEsperaReal = (): Mundo => {
    const m = crearMundo(CFG_QR);
    hastaResumen(m);
    turno(m, { boton: 'p|confirmar' });
    return m;
  };
  const enEsperaSim = (extra: J = {}): Mundo => {
    const m = crearMundo({ ...CFG_SIM, ...extra });
    hastaResumen(m);
    turno(m, { boton: 'p|confirmar' });
    return m;
  };
  /** Lo que el servidor dice después del QR: hay uno pendiente de ESTE pedido. */
  const pendiente = (m: Mundo, ref = estadoDe(m)['pedido']?.['pedidoId'] ?? ''): void => {
    m.cfg['cobro'] = { ...CFG_SIM.cobro, pedidoRef: ref, pendiente: true };
  };
  const foto = (m: Mundo, extra: Partial<Entrada> = {}): Salida => registrar(turno(m, { tipo: 'image', comprobanteSimulado: true, ...extra }));

  it('confirmar el pedido manda la imagen con el pie «SIMULADO», abre el cobro (`qr_enviado`) y guarda el modo en el pedido', () => {
    const m = crearMundo(CFG_SIM);
    hastaResumen(m);
    const s = registrar(turno(m, { boton: 'p|confirmar' }));
    const img = s.p!['mensajes'][0];
    expect(img).toMatchObject({ tipo: 'imagen', url: QR, evento: 'qr_enviado', monto: 55 });
    expect(img['cuerpo']).toContain('SIMULADO');
    expect(img['cuerpo']).toContain('no cobra');
    expect(img['cuerpo']).not.toContain('Escanéalo con la app de tu banco');
    expect(s.p!['ruta']).toBe('pedido:qr_simulado');
    expect(s.p!['ruta']).not.toBe('pedido:sin_qr');
    expect(estadoDe(m)['paso']).toBe('esperando_comprobante');
    expect(estadoDe(m)['pedido']).toMatchObject({ simulado: true });
    expect(s.p!['aviso']).toBeNull(); // el aviso al restaurante sale con el comprobante, no con el QR
    // Negativo: con el cobro REAL el pie no dice «SIMULADO» y el pedido guarda `simulado: false`.
    const r = crearMundo(CFG_QR);
    hastaResumen(r);
    const real = registrar(turno(r, { boton: 'p|confirmar' }));
    expect(real.p!['mensajes'][0]['cuerpo']).not.toMatch(/simulad|prueba/i);
    expect(real.p!['ruta']).toBe('pedido:qr');
    expect(estadoDe(r)['pedido']).toMatchObject({ simulado: false });
  });

  it('modo `simulado` con `activo:true` (imposible desde `Config del negocio`) NO manda QR: cae al plan B', () => {
    const m = crearMundo({ cobro: { ...CFG_SIM.cobro, activo: true } });
    hastaResumen(m);
    const s = turno(m, { boton: 'p|confirmar' });
    expect(s.p!['ruta']).toBe('pedido:sin_qr');
    expect(s.p!['mensajes'].every((x: J) => x['tipo'] !== 'imagen')).toBe(true);
  });

  it('cualquier foto con el QR pendiente es el comprobante simulado: aviso de PRUEBA, cierre `registro` sin monto y SIN imagen del comprobante', () => {
    const m = enEsperaSim();
    pendiente(m);
    const s = foto(m, { mediaId: 'media-1' });
    const p = s.p!;
    expect(s.d['accion']).toBe('comprobante');
    expect(p['ruta']).toBe('comprobante:simulado');
    expect(p['mensajes']).toEqual([]);
    expect(p['aviso']['tipo']).toBe('comprobante');
    expect(p['aviso']['datos']).toMatchObject({ resultado: 'simulado', estado: 'PRUEBA: cobro SIMULADO, sin dinero', mediaId: '', total: 55, from: FROM });
    expect(p['cierre']).toMatchObject({ tipo: 'registro' });
    expect(p['cierre']['detalle']).toMatch(/^PRUEBA · cobro SIMULADO/);
    expect(p['cierre']).not.toHaveProperty('monto'); // un cierre con monto sumaría como venta en Cobros
    expect(p['cierre']['referencia']).toBe(p['pedido']['pedidoId']);
    expect(p['pedido']).toMatchObject({ resultado: 'simulado', mediaId: '', simulado: true });
    const si = p['condicionados']['siSalio'][0];
    const no = p['condicionados']['siNoSalio'][0];
    expect(si['cuerpo']).toContain('SIMULADO');
    expect(si['cuerpo']).toContain('Ya lo pasé a nuestro equipo como pedido de PRUEBA');
    expect(no['cuerpo']).toContain('SIMULADO');
    expect(no['cuerpo']).not.toMatch(/ya (lo |la )?pas[eé]/i);
    expect(no['tipo']).toBe('enlace');
    expect(estadoDe(m)['paso']).toBe('menu');
    expect(estadoDe(m)['pedido']).toBeNull();
  });

  it('también un documento y una foto con pie de foto; el simulado no depende del medio ni del cotejo', () => {
    for (const extra of [{ tipo: 'document' }, { texto: 'mi comprobante' }, { mediaId: '' }]) {
      const m = enEsperaSim();
      pendiente(m);
      const s = foto(m, extra);
      expect(s.p!['ruta'], JSON.stringify(extra)).toBe('comprobante:simulado');
      expect(s.p!['aviso']['datos']['resultado']).toBe('simulado');
    }
  });

  it('ninguno de sus textos dice «verificado», «acreditado» ni «recibimos tu pago»', () => {
    const m = enEsperaSim();
    pendiente(m);
    const s = foto(m);
    const todos = [...cuerpos(s.p), s.p!['aviso']['datos']['estado'], s.p!['cierre']['detalle']];
    for (const t of todos) expect(String(t), String(t)).not.toMatch(/pago (acreditado|verificado)|recibimos\s+tu\s+pago|acreditad|verificad/i);
    for (const t of todos) expect(PROHIBIDAS.test(String(t)), String(t)).toBe(false);
  });

  it('una segunda foto del mismo pedido es «ya tengo el comprobante»: sin aviso y sin cierre (el servidor sigue viéndolo pendiente)', () => {
    const m = enEsperaSim();
    pendiente(m);
    const ref = String(estadoDe(m)['pedido']['pedidoId']);
    foto(m);
    // El estado volvió a `menu` y el pedido quedó guardado con su resultado; el servidor aún lo cree pendiente.
    pendiente(m, ref);
    const s = foto(m);
    expect(s.p!['ruta']).toBe('comprobante:ya_cotejado');
    expect(s.p!['aviso']).toBeNull();
    expect(s.p!['cierre']).toBeNull();
    expect(s.p!['pedido']).toBeNull();
    expect(s.p!['mensajes'][0]['cuerpo']).toMatch(/^Ya tengo el comprobante de tu pedido #/);
  });

  it('H5: «ya tengo el comprobante» NO cambia el paso si el cliente ya empezó otro pedido; y una foto con PIE en ese caso es una imagen con pie (el pie se atiende como texto)', () => {
    const m = enEsperaSim();
    const ref = String(estadoDe(m)['pedido']['pedidoId']);
    pendiente(m);
    foto(m); // primer comprobante: el pedido queda con resultado «simulado» y el estado vuelve a `menu`
    pendiente(m, ref); // el servidor aún lo ve pendiente
    hastaResumen(m); // el cliente empieza OTRO pedido y llega al resumen
    expect(estadoDe(m)['paso']).toBe('pedido_confirmar');
    const carritoAntes = JSON.stringify(estadoDe(m)['carrito']);
    // Sin pie: «ya tengo el comprobante», sin aviso ni cierre, y el pedido en curso queda donde estaba (antes se iba a `menu`).
    const sin = foto(m);
    expect(sin.p!['ruta']).toBe('comprobante:ya_cotejado');
    expect(sin.p!['aviso']).toBeNull();
    expect(sin.p!['cierre']).toBeNull();
    expect(estadoDe(m)['paso']).toBe('pedido_confirmar');
    expect(JSON.stringify(estadoDe(m)['carrito'])).toBe(carritoAntes);
    // Con pie: es una imagen con pie, el pie se atiende como texto (no «ya tengo el comprobante»).
    const con = turno(m, { tipo: 'image', comprobanteSimulado: true, texto: 'mejor 3 tacos de birria', extraccion: extPedido({ lineas: [linea('tacos de birria', 3, 'orden')] }) });
    expect(con.d['accion']).toBe('extraer_pedido');
    expect(con.d['accion']).not.toBe('comprobante');
    // NEGANDO: dentro del cobro (esperando el comprobante) una foto CON pie sigue siendo el comprobante simulado, y la segunda sigue cerrando el cobro.
    const dentro = enEsperaSim();
    pendiente(dentro);
    expect(registrar(turno(dentro, { tipo: 'image', comprobanteSimulado: true, texto: 'aquí está' })).p!['ruta']).toBe('comprobante:simulado');
    expect(estadoDe(dentro)['paso']).toBe('menu');
  });

  it('LOW: un pedido REAL ya cancelado (paso `menu`) cuyo QR sigue pendiente con el modo ahora simulado NO se descarta como «sin pendiente»: aviso de comprobante sin cotejar con su código', () => {
    const m = enEsperaReal();
    const ref = String(estadoDe(m)['pedido']['pedidoId']);
    const codigo = String(estadoDe(m)['pedido']['codigo']);
    turno(m, { boton: 'q|cancelar' });
    expect(estadoDe(m)['paso']).toBe('menu');
    expect(sdDe(m)['pedidos'][ref]['simulado']).toBe(false);
    m.cfg['cobro'] = { ...CFG_SIM.cobro, pedidoRef: ref, pendiente: true };
    const s = foto(m); // una foto SIN pie: la que podría ser un pago real
    expect(s.p!['aviso']['tipo']).toBe('comprobante');
    expect(s.p!['aviso']['datos']['resultado']).toBe('sin_cotejo');
    expect(s.p!['aviso']['datos']['codigo']).toBe(codigo);
    expect(s.p!['ruta']).toBe('comprobante:sin_cotejo');
    expect(JSON.stringify([s.p!['mensajes'], s.p!['condicionados']])).not.toMatch(/no tienes ninguno pendiente|SIMULADO|simulado/);
    // NEGANDO: un pedido SIMULADO cancelado sigue siendo una imagen sin pendiente (sin aviso), como antes.
    const sim = enEsperaSim();
    const refSim = String(estadoDe(sim)['pedido']['pedidoId']);
    turno(sim, { boton: 'q|cancelar' });
    pendiente(sim, refSim);
    const t = foto(sim);
    expect(t.p!['aviso']).toBeNull();
    expect(JSON.stringify(t.p!['mensajes'])).toContain('no tienes ninguno pendiente');
  });

  const enEsperaSimCancelado = (): Mundo => {
    const m = enEsperaSim();
    const ref = String(estadoDe(m)['pedido']['pedidoId']);
    turno(m, { boton: 'q|cancelar' });
    pendiente(m, ref);
    return m;
  };
  const conPie = { tipo: 'image', comprobanteSimulado: true, texto: 'quiero 3 tacos de birria', extraccion: extPedido({ lineas: [linea('tacos de birria', 3, 'orden')] }) } as const;

  it('H5 completo: tras «Cancelar pedido» una foto CON pie («quiero 3 tacos de birria») es una imagen con pie: el pie se atiende como pedido, no se descarta', () => {
    const m = enEsperaSim();
    const ref = String(estadoDe(m)['pedido']['pedidoId']);
    turno(m, { boton: 'q|cancelar' });
    expect(estadoDe(m)['paso']).toBe('menu');
    pendiente(m, ref); // el servidor aún ve el QR pendiente
    const s = turno(m, conPie);
    expect(s.d['accion']).toBe('extraer_pedido');
    expect(JSON.stringify(s.p!['mensajes'])).not.toContain('no tienes ninguno pendiente');
    expect(s.p!['aviso']).toBeNull();
    // NEGANDO: la misma foto SIN pie sigue siendo «sin pendiente» (no hay nada que atender como texto).
    const t = turno(enEsperaSimCancelado(), { tipo: 'image', comprobanteSimulado: true });
    expect(JSON.stringify(t.p!['mensajes'])).toContain('no tienes ninguno pendiente');
  });

  it('LOW: «imagen con pie» solo se mira por el pedido de ESTE teléfono: un pedido REAL ajeno no cambia nada, y uno REAL propio sigue como comprobante (sin cotejo)', () => {
    // Un pedido REAL de OTRO teléfono en la referencia: no es mío, mi foto con pie es una imagen con pie (texto).
    const ajeno = enEsperaReal();
    const refAjeno = String(estadoDe(ajeno)['pedido']['pedidoId']);
    turno(ajeno, { boton: 'q|cancelar' });
    sdDe(ajeno)['pedidos'][refAjeno]['from'] = '59100000099';
    ajeno.cfg['cobro'] = { ...CFG_SIM.cobro, pedidoRef: refAjeno, pendiente: true };
    expect(turno(ajeno, conPie).d['accion']).toBe('extraer_pedido');
    // El MISMO pedido real, de ESTE teléfono: puede ser un pago, la foto sigue como comprobante aunque traiga pie.
    const mio = enEsperaReal();
    const refMio = String(estadoDe(mio)['pedido']['pedidoId']);
    turno(mio, { boton: 'q|cancelar' });
    mio.cfg['cobro'] = { ...CFG_SIM.cobro, pedidoRef: refMio, pendiente: true };
    const s = turno(mio, conPie);
    expect(s.d['accion']).toBe('comprobante');
    expect(registrar(s).p!['aviso']['tipo']).toBe('comprobante');
  });

  it('una foto después de «Cancelar pedido» es una imagen sin pendiente: ni aviso ni cierre, aunque el servidor aún vea el QR', () => {
    const m = enEsperaSim();
    const ref = String(estadoDe(m)['pedido']['pedidoId']);
    turno(m, { boton: 'q|cancelar' });
    expect(estadoDe(m)['paso']).toBe('menu');
    expect(sdDe(m)['pedidos'][ref]).toBeDefined(); // el pedido sigue guardado, sin resultado
    pendiente(m, ref);
    const s = foto(m);
    expect(s.p!['aviso']).toBeNull();
    expect(s.p!['cierre']).toBeNull();
    expect(s.p!['pedido']).toBeNull();
    expect(s.p!['ruta']).not.toBe('comprobante:simulado');
    expect(s.p!['mensajes'][0]['cuerpo']).toContain('no tienes ninguno pendiente');
  });

  it('un pedido que salió con el cobro REAL no se cierra como simulado cuando el modo cambió', () => {
    const m = enEsperaReal();
    const ref = String(estadoDe(m)['pedido']['pedidoId']);
    expect(estadoDe(m)['pedido']['simulado']).toBe(false);
    const codigoDelPedido = String(estadoDe(m)['pedido']['codigo']);
    m.cfg['cobro'] = { ...CFG_SIM.cobro, pedidoRef: ref, pendiente: true };
    const s = foto(m);
    expect(s.p!['cierre']).toBeNull();
    expect(s.p!['ruta']).not.toBe('comprobante:simulado');
    // H1 (revisión del cobro simulado): la foto puede ser un pago REAL. Sigue el camino del cobro real SIN cotejo (`sin_cotejo`): el restaurante recibe
    // un aviso de COMPROBANTE con el código DEL PEDIDO (no una «consulta» genérica) y el cliente lee que no se pudo revisar; nada dice «SIMULADO»
    // ni «sin pendiente», y el cliente no queda esperando (el pedido se suelta).
    expect(s.p!['aviso']['tipo']).toBe('comprobante');
    expect(s.p!['aviso']['datos']['resultado']).toBe('sin_cotejo');
    expect(s.p!['aviso']['datos']['codigo']).toBe(codigoDelPedido); // el número DEL PEDIDO, no uno inventado del turno
    expect(s.p!['ruta']).toBe('comprobante:sin_cotejo');
    const textos = JSON.stringify([s.p!['mensajes'], s.p!['condicionados']]);
    expect(textos).toMatch(/no pude revisarlo/);
    expect(textos).not.toMatch(/SIMULADO|simulado|PRUEBA|no tienes ninguno pendiente/);
    expect(estadoDe(m)['paso']).toBe('menu');
    expect(estadoDe(m)['pedido'] ?? null).toBeNull();
  });

  it('H1: el recordatorio de un pedido REAL nunca dice «SIMULADO» aunque el modo vigente sea simulado; el de un pedido simulado sí', () => {
    const real = enEsperaReal();
    real.cfg['cobro'] = { ...CFG_SIM.cobro, pendiente: true };
    const r = registrar(turno(real, { texto: '¿ya llegó?' }));
    expect(r.p!['mensajes'][0]['cuerpo']).toMatch(/^Tu pedido #\w+ sigue pendiente: falta que me envíes la foto o el PDF del comprobante del QR\. Si ya no lo quieres, toca «Cancelar pedido»\.$/);
    expect(JSON.stringify(r.p!['mensajes'])).not.toMatch(/SIMULADO|prueba/i);
    // Un pedido simulado con el modo vigente ya REAL: no se pide otra foto (volvería a derivar): se pasa con una persona y se suelta (ver «sin callejón»).
    const sim = enEsperaSim();
    sim.cfg['cobro'] = CFG_QR.cobro;
    const rs = registrar(turno(sim, { texto: '¿ya llegó?' }));
    expect(rs.p!['mensajes'][0]['tipo']).toBe('enlace');
    expect(JSON.stringify(rs.p!['mensajes'])).not.toMatch(/sigue esperando el comprobante|Envíame aquí/);
    // NEGANDO: con el modo vigente simulado, el pedido simulado sí habla de SU comprobante simulado.
    const normal = enEsperaSim();
    expect(registrar(turno(normal, { texto: '¿ya llegó?' })).p!['mensajes'][0]['cuerpo']).toContain('SIMULADO');
  });

  it('H3: el recordatorio SIMULADO lleva «Si no ves el QR, ábrelo aquí» con el enlace validado; el real nunca lo lleva ni el enlace del QR simulado cambia de pedido', () => {
    const sim = enEsperaSim();
    const r = registrar(turno(sim, { texto: '¿ya llegó?' }));
    expect(r.p!['mensajes'][0]['cuerpo']).toContain(`Si no ves el QR, ábrelo aquí: ${QR}`);
    expect(r.p!['mensajes'].length).toBe(1); // sin mensajes extra
    // NEGANDO: un pedido real no lleva el enlace; un pedido simulado con el modo ya cambiado a real tampoco (no se filtra el QR real).
    const real = enEsperaReal();
    expect(registrar(turno(real, { texto: '¿ya llegó?' })).p!['mensajes'][0]['cuerpo']).not.toContain('Si no ves el QR');
    const cambiado = enEsperaSim();
    cambiado.cfg['cobro'] = CFG_QR.cobro;
    expect(registrar(turno(cambiado, { texto: '¿ya llegó?' })).p!['mensajes'][0]['cuerpo']).not.toContain('Si no ves el QR');
    // un enlace inseguro (http) tampoco se manda
    const malo = enEsperaSim();
    malo.cfg['cobro'] = { ...CFG_SIM.cobro, qrUrl: 'http://qr.ejemplo.invalid/x.png' };
    expect(registrar(turno(malo, { texto: '¿ya llegó?' })).p!['mensajes'][0]['cuerpo']).not.toContain('http://');
  });

  it('«Reenviar QR» en simulado manda la imagen con el pie «SIMULADO» y sin `qr_enviado`', () => {
    const m = enEsperaSim();
    const q = registrar(turno(m, { boton: 'q|reenviar' }));
    expect(q.p!['mensajes'][0]).toMatchObject({ tipo: 'imagen', url: QR, monto: 55 });
    expect(q.p!['mensajes'][0]['cuerpo']).toContain('SIMULADO');
    expect(q.p!['mensajes'][0]['evento']).toBeUndefined();
    expect(q.p!['aviso']).toBeNull();
    expect(estadoDe(m)['paso']).toBe('esperando_comprobante');
  });

  it('«Reenviar QR» con otro modo vigente que el del pedido deriva y NO manda imagen (en los dos sentidos)', () => {
    // Pedido simulado, ahora el cobro es real.
    const a = enEsperaSim();
    a.cfg['cobro'] = CFG_QR.cobro;
    const ra = turno(a, { boton: 'q|reenviar' });
    expect(ra.p!['mensajes'].every((x: J) => x['tipo'] !== 'imagen')).toBe(true);
    expect(ra.p!['aviso']['tipo']).toBe('transferencia');
    // Pedido real, ahora el cobro es simulado.
    const b = enEsperaReal();
    b.cfg['cobro'] = CFG_SIM.cobro;
    const rb = turno(b, { boton: 'q|reenviar' });
    expect(rb.p!['mensajes'].every((x: J) => x['tipo'] !== 'imagen')).toBe(true);
    expect(rb.p!['aviso']['tipo']).toBe('transferencia');
    // Negativo: con el mismo modo sí se reenvía.
    expect(turno(enEsperaReal(), { boton: 'q|reenviar' }).p!['mensajes'][0]['tipo']).toBe('imagen');
  });

  it('el recordatorio en simulado dice «SIMULADO»; en real no', () => {
    const m = enEsperaSim();
    const r = registrar(turno(m, { texto: 'ya pagué' }));
    expect(r.p!['mensajes'][0]['cuerpo']).toMatch(/^Tu pedido #\w+ sigue pendiente: falta que me envíes cualquier foto del comprobante SIMULADO \(es una prueba: no se paga nada\)\. Si ya no lo quieres, toca «Cancelar pedido»\./);
    expect(ids(r.p!['mensajes'][0])).toEqual(['q|reenviar', 'q|cancelar']);
    const real = turno(enEsperaReal(), { texto: 'ya pagué' });
    expect(real.p!['mensajes'][0]['cuerpo']).not.toMatch(/simulad|prueba/i);
  });

  it('con `Cotejar en el servidor` corrido la rama simulada NO se toma (nunca se mezcla con el cotejo) y un pedido REAL se coteja como siempre', () => {
    const m = enEsperaReal();
    const ref = String(estadoDe(m)['pedido']['pedidoId']);
    m.cfg['cobro'] = { ...CFG_QR.cobro, pedidoRef: ref, pendiente: true };
    const s = registrar(turno(m, { tipo: 'image', esComprobante: true, cotejo: { statusCode: 200, body: { resultado: 'cuadra', cierreId: 'c1' } } }));
    expect(s.p!['ruta']).toBe('comprobante:cuadra');
    expect(s.p!['aviso']['datos']['resultado']).toBe('cuadra');
  });

  it('H2: un pedido SIMULADO con el cobro real encendido y su cotejo ya corrido NO se avisa como real ni se rotula «cuadra»: se deriva y conserva el paso', () => {
    const m = enEsperaSim();
    const ref = String(estadoDe(m)['pedido']['pedidoId']);
    m.cfg['cobro'] = { ...CFG_QR.cobro, pedidoRef: ref, pendiente: true };
    const s = registrar(turno(m, { tipo: 'image', esComprobante: true, cotejo: { statusCode: 200, body: { resultado: 'cuadra', cierreId: 'c1' } } }));
    expect(s.p!['aviso']['tipo']).toBe('transferencia');
    expect(s.p!['cierre']).toBeNull();
    expect(s.p!['pedido']).toBeNull();
    expect(s.p!['ruta']).toContain('transferir:el modo de cobro cambió: comprobante de un pedido simulado');
    expect(JSON.stringify(s.p!['mensajes'])).not.toMatch(/datos coinciden|cuadra|ya (lo )?pasé|sigue esperando el comprobante/i);
    // El restaurante lee QUÉ es: el código del PEDIDO, `comprobante: true` y un motivo fijo (no «el cliente pide hablar con una persona»).
    expect(estadoDe(m)['paso']).toBe('menu');
    expect(estadoDe(m)['pedido'] ?? null).toBeNull(); // el pedido se suelta: sin callejón
    // Y desde `Interpretar entrada` la marca `comprobanteCruzado` manda a derivar sin cotejo (`Decidir turno`).
    const m2 = enEsperaSim();
    const codigo2 = String(estadoDe(m2)['pedido']['codigo']);
    m2.cfg['cobro'] = { ...CFG_QR.cobro, pedidoRef: String(estadoDe(m2)['pedido']['pedidoId']), pendiente: true };
    const d = turno(m2, { tipo: 'image', comprobanteCruzado: true });
    expect(d.d['accion']).toBe('transferir');
    expect(d.p!['aviso']['tipo']).toBe('transferencia');
    expect(d.p!['aviso']['datos']).toMatchObject({ codigo: codigo2, comprobante: true });
    expect(d.p!['aviso']['datos']['motivo']).toBe(`comprobante enviado por el cliente (pedido de PRUEBA #${codigo2}); cambió el modo de cobro y no se revisó`);
    expect(d.p!['aviso']['datos']['codigo']).not.toBe(AHORA.toString(36).slice(-4).toUpperCase()); // no el código inventado del turno
  });

  it('sin callejón: tras la derivación por cambio de modo el pedido se SUELTA; una segunda foto, un texto o «Reenviar QR» no piden otra foto ni dicen «sigue esperando»', () => {
    const m = enEsperaSim();
    const ref = String(estadoDe(m)['pedido']['pedidoId']);
    m.cfg['cobro'] = { ...CFG_QR.cobro, pedidoRef: ref, pendiente: true };
    const primera = registrar(turno(m, { tipo: 'image', comprobanteCruzado: true }));
    expect(primera.p!['aviso']['tipo']).toBe('transferencia');
    expect(estadoDe(m)['paso']).toBe('menu');
    expect(estadoDe(m)['pedido'] ?? null).toBeNull();
    expect(JSON.stringify(primera.p!['mensajes'])).not.toMatch(/sigue esperando el comprobante|Envíame aquí|cualquier foto/);
    // «verbo no previsto»: la segunda foto en ese estado no pide otra foto ni deja al cliente esperando.
    const segunda = registrar(turno(m, { tipo: 'image', comprobanteCruzado: true }));
    expect(JSON.stringify(segunda.p!['mensajes'])).not.toMatch(/sigue esperando el comprobante|Envíame aquí|cualquier foto/);
    expect(estadoDe(m)['paso']).toBe('menu');
    const texto = registrar(turno(m, { texto: '¿ya llegó mi pago?' }));
    expect(JSON.stringify(texto.p!['mensajes'])).not.toMatch(/sigue esperando el comprobante|Envíame aquí/);
    // «Reenviar QR» con un pedido de PRUEBA y el cobro ya real: deriva con el código del pedido y suelta el pedido (no «sigue esperando»).
    const n = enEsperaSim();
    const codigoN = String(estadoDe(n)['pedido']['codigo']);
    n.cfg['cobro'] = CFG_QR.cobro;
    const q = registrar(turno(n, { boton: 'q|reenviar' }));
    expect(q.p!['mensajes'].every((x: J) => x['tipo'] !== 'imagen')).toBe(true);
    expect(q.p!['aviso']['datos']).toMatchObject({ codigo: codigoN, comprobante: true });
    expect(JSON.stringify(q.p!['mensajes'])).not.toMatch(/sigue esperando el comprobante/);
    expect(estadoDe(n)['pedido'] ?? null).toBeNull();
  });

  it('sin la marca `comprobanteSimulado` una imagen no es un comprobante, aunque el QR esté pendiente', () => {
    const m = enEsperaSim();
    pendiente(m);
    const s = turno(m, { tipo: 'image' });
    expect(s.d['accion']).not.toBe('comprobante');
    expect(s.p!['aviso']).toBeNull();
    expect(s.p!['cierre']).toBeNull();
  });
});

describe('Todo texto al cliente es seguro (PROHIBICIÓN 3)', () => {
  it('ninguno de los textos de los escenarios de arriba coincide con la red de palabras prohibidas', () => {
    expect(todosLosTextos.length).toBeGreaterThan(30);
    for (const t of todosLosTextos) expect(PROHIBIDAS.test(t), t).toBe(false);
  });

  it('negativo: la red sí atrapa las frases que el asistente jamás debe decir', () => {
    for (const f of ['pago confirmado', 'tu pedido está validado', 'pagado', 'pago acreditado', 'recibimos tu pago', 'ya lo preparan',
      'lo preparamos', 'te avisamos', 'va en camino', 'te llamamos', 'te escribirán', 'lo consulto', 'verificado']) {
      expect(PROHIBIDAS.test(f), f).toBe(true);
    }
  });

  it('el plan nunca promete antes de que el aviso salga: ningún mensaje directo dice «ya pasé», «llegó a nuestro equipo» ni «Anotamos tu reserva»', () => {
    const m = crearMundo(CFG_QR);
    const salidas = [
      hastaResumen(m), turno(m, { boton: 'p|confirmar' }),
      turno(m, { tipo: 'image', esComprobante: true, cotejo: { statusCode: 200, body: { resultado: 'cuadra' } } }),
    ];
    const r = crearMundo();
    turno(r, { boton: 'm|reserva' });
    turno(r, { texto: 'mesa', extraccion: extReserva({ personas: 4, fecha: '2026-10-09', hora: '20:00' }) });
    salidas.push(turno(r, { boton: 'r|enviar' }));
    const p = crearMundo();
    hastaResumen(p);
    salidas.push(turno(p, { boton: 'p|confirmar' }));
    for (const s of salidas) {
      for (const msg of s.p!['mensajes']) expect(String(msg['cuerpo'])).not.toMatch(/ya (lo )?pasé|llegó al restaurante|llegó a nuestro equipo|anotamos tu reserva|pasé tu pedido/i);
    }
  });
});

// =================================================================================================
// Correcciones de la revisión del PR-1 (R4, R5, R7, R8, S4, S7), cada una probada negando el defecto.
// Los dobles de arriba son mínimos: lo que depende de las librerías reales se prueba en la suite de integración.
describe('Plan del turno: correcciones de la revisión', () => {
  const enEspera = (extra: J = {}): Mundo => {
    const m = crearMundo({ ...CFG_QR, ...extra });
    hastaResumen(m);
    turno(m, { boton: 'p|confirmar' });
    return m;
  };
  const cotejo = (resultado: string) => ({ statusCode: 200, body: { resultado } });

  it('R7: la ubicación compartida pasa a `entrega.ubicacion` {lat, lng} en un pedido con delivery', () => {
    const m = crearMundo();
    turno(m, { texto: 'hola' });
    turno(m, { texto: 'quiero 1 orden de tacos de birria para delivery', extraccion: extPedido({ lineas: [linea('tacos de birria', 1, 'orden')], entrega: 'delivery' }) });
    expect(estadoDe(m)['paso']).toBe('pedido_datos');
    const s = turno(m, { tipo: 'location', ubicacion: { latitud: -16.5, longitud: -68.15, nombre: '', direccion: '' } });
    expect(s.d['motivo']).toBe('ubicacion');
    expect(estadoDe(m)['entrega']['ubicacion']).toEqual({ lat: -16.5, lng: -68.15 });
    // «Cambiar algo» conserva la ubicación ya dada, como la dirección.
    turno(m, { boton: 'p|cambiar' });
    expect(estadoDe(m)['entrega']['ubicacion']).toEqual({ lat: -16.5, lng: -68.15 });
  });

  it('R7 negado: sin delivery, fuera de un pedido, con coordenadas fuera de rango o de otro tipo, no se toma ninguna ubicación', () => {
    const recojo = crearMundo();
    hastaResumen(recojo);
    turno(recojo, { tipo: 'location', ubicacion: { latitud: -16.5, longitud: -68.15 } });
    expect(estadoDe(recojo)['entrega']['ubicacion']).toBeUndefined();
    const menu = crearMundo();
    turno(menu, { texto: 'hola' });
    turno(menu, { tipo: 'location', ubicacion: { latitud: -16.5, longitud: -68.15 } });
    expect(estadoDe(menu)['entrega']['ubicacion']).toBeUndefined();
    for (const u of [{ latitud: 95, longitud: -68 }, { latitud: -16, longitud: 190 }, { latitud: '-16', longitud: '-68' }, { latitud: null, longitud: null }, null]) {
      const m = crearMundo();
      turno(m, { texto: 'hola' });
      turno(m, { texto: 'quiero 1 orden de tacos de birria para delivery', extraccion: extPedido({ lineas: [linea('tacos de birria', 1, 'orden')], entrega: 'delivery' }) });
      turno(m, { tipo: 'location', ubicacion: u as J });
      expect(estadoDe(m)['entrega']['ubicacion'], JSON.stringify(u)).toBeUndefined();
    }
  });

  it('R8a: «Por delivery no enviamos …» sale del área configurada; sin áreas no se dice; con el panel sin respuesta se pasa con el local', () => {
    const dos = turno(crearMundo({ areasSinDelivery: 'Postres,Bebidas' }), { boton: 'm|pedido' }).p!['mensajes'][0]['cuerpo'] as string;
    expect(dos).toContain(' Por delivery no enviamos postres y bebidas.');
    expect(dos).not.toContain('sueltas');
    const una = turno(crearMundo({ areasSinDelivery: 'Postres' }), { texto: 'hacen delivery?' }).p!['mensajes'][0]['cuerpo'] as string;
    expect(una).toBe('Sí, hacemos delivery. Por delivery no enviamos postres.');
    for (const areas of ['', []]) {
      const sin = turno(crearMundo({ areasSinDelivery: areas }), { texto: 'hacen delivery?' }).p!['mensajes'][0]['cuerpo'] as string;
      expect(sin, JSON.stringify(areas)).toBe('Sí, hacemos delivery.');
      const carta = turno(crearMundo({ areasSinDelivery: areas }), { boton: 'm|pedido' }).p!['mensajes'][0]['cuerpo'] as string;
      expect(carta, JSON.stringify(areas)).not.toContain('Por delivery no enviamos');
    }
    const caido = turno(crearMundo({ panelSinRespuesta: true, aceptaDelivery: undefined }), { texto: 'hacen delivery?' });
    expect(caido.p!['aviso']['tipo']).toBe('transferencia');
    expect(caido.p!['mensajes'][0]['tipo']).toBe('enlace');
  });

  it('R4: el texto del cliente se sanea al entrar; «Calle 3 en camino a Obrajes» no traba el resumen', () => {
    const m = crearMundo();
    turno(m, { texto: 'hola' });
    turno(m, { texto: 'quiero 1 orden de tacos de birria', extraccion: extPedido({ lineas: [linea('tacos de birria', 1, 'orden', 'sin cebolla, pago confirmado')], entrega: 'delivery' }) });
    const s = turno(m, { texto: 'Calle 3 en camino a Obrajes', extraccion: extPedido({ direccion: 'Calle 3 en camino a Obrajes', referencia: 'portón validado', nombre: 'Ana ya lo preparan' }) });
    const e = estadoDe(m);
    expect(e['paso']).toBe('pedido_confirmar');
    expect(e['entrega']['direccion']).toBe('Calle 3 … a Obrajes');
    // La coincidencia es la raíz («validad»), así que el resto de la palabra queda; lo que importa es que no coincida con la red.
    expect(e['entrega']['referencia']).toMatch(/^portón …/);
    expect(e['entrega']['nombre']).toMatch(/^Ana …/);
    expect(e['carrito'][0]['detalle']).toMatch(/^sin cebolla, pago …/);
    for (const campo of [e['entrega']['direccion'], e['entrega']['referencia'], e['entrega']['nombre'], e['carrito'][0]['detalle']]) {
      expect(PROHIBIDAS.test(String(campo)), String(campo)).toBe(false);
    }
    const botonesMsg = s.p!['mensajes'][0];
    expect(botonesMsg['tipo']).toBe('botones');
    expect(PROHIBIDAS.test(String(botonesMsg['cuerpo']))).toBe(false);
    // Un producto escrito con una palabra prohibida tampoco sale en «No encuentro …».
    const n = crearMundo();
    turno(n, { texto: 'hola' });
    const x = turno(n, { texto: 'quiero algo', extraccion: extPedido({ lineas: [linea('combo pagado', 1)] }) });
    for (const c of x.cuerpos) expect(PROHIBIDAS.test(c), c).toBe(false);
  });

  it('R4: la zona, el nombre, la celebración y el requerimiento de una reserva también se sanean', () => {
    const m = crearMundo();
    turno(m, { boton: 'm|reserva' });
    turno(m, { texto: 'mesa', extraccion: extReserva({ personas: 4, fecha: '2026-10-09', hora: '20:00', nombre: 'Ana validado', celebracion: 'cumple, pago acreditado', requerimiento: 'silla en camino' }) });
    const r = estadoDe(m)['reserva'];
    expect(r['nombre']).toMatch(/^Ana …/);
    expect(r['celebracion']).toMatch(/^cumple, pago …/);
    expect(r['requerimiento']).toBe('silla …');
    for (const campo of [r['nombre'], r['celebracion'], r['requerimiento']]) expect(PROHIBIDAS.test(String(campo)), String(campo)).toBe(false);
  });

  it('R5: un resumen de más de 1.024 caracteres se parte: el detalle en texto y el total con los botones en un mensaje corto', () => {
    const m = crearMundo();
    turno(m, { texto: 'hola' });
    const doce = Array.from({ length: 12 }, (_, i) => linea('queso fundido con chorizo', i + 1, '', `nota de la línea ${i} con bastante texto para que ocupe lugar en el resumen`));
    const s = turno(m, { texto: 'pedido grande', extraccion: extPedido({ lineas: doce, entrega: 'delivery', direccion: 'Calle Falsa 123', referencia: 'casa azul', nombre: 'Ana Pérez' }) });
    const ms = s.p!['mensajes'] as J[];
    expect(ms.length).toBeGreaterThanOrEqual(2);
    const ultimo = ms[ms.length - 1]!;
    expect(ultimo['tipo']).toBe('botones');
    expect((ultimo['cuerpo'] as string).length).toBeLessThanOrEqual(1024);
    expect(ultimo['cuerpo']).toMatch(/^Total de la comida: /);
    expect(ultimo['cuerpo']).toContain('El delivery no está incluido');
    expect(ids(ultimo)).toEqual(['p|confirmar', 'p|cambiar']);
    for (const previo of ms.slice(0, -1)) {
      expect(previo['tipo']).toBe('texto');
      expect((previo['cuerpo'] as string).length).toBeLessThanOrEqual(3800);
    }
    const detalle = ms.slice(0, -1).map((x) => x['cuerpo']).join('\n');
    expect(detalle).toContain('nota de la línea 0');
    expect(detalle).toContain('nota de la línea 11');
    expect(detalle).not.toContain('Total de la comida');
    expect(estadoDe(m)['paso']).toBe('pedido_confirmar');
  });

  it('R5 negado: un pedido corto sigue en UN solo mensaje con botones, con el total adentro', () => {
    const m = crearMundo();
    const s = hastaResumen(m, 'delivery');
    expect(s.p!['mensajes']).toHaveLength(1);
    expect(s.p!['mensajes'][0]['tipo']).toBe('botones');
    expect(s.p!['mensajes'][0]['cuerpo']).toContain('Total de la comida');
  });

  it('S4: «Reenviar QR» lleva monto y referencia del pedido y NO el evento `qr_enviado`', () => {
    const m = enEspera();
    const ped = estadoDe(m)['pedido'];
    const s = turno(m, { boton: 'q|reenviar' });
    expect(s.d['accion']).toBe('reenviar_qr');
    const q = s.p!['mensajes'][0];
    expect(q).toMatchObject({ tipo: 'imagen', url: QR, monto: 55, referencia: ped['pedidoId'] });
    expect(q).not.toHaveProperty('evento');
    // Negado: sin cobro real encendido no hay QR que reenviar: se deriva.
    const sin = enEspera();
    sin.cfg['cobro'] = { activo: false };
    expect(turno(sin, { boton: 'q|reenviar' }).p!['aviso']['tipo']).toBe('transferencia');
  });

  it('S7: la referencia del servidor solo vale si es un pedido propio de `sd.pedidos` y de este teléfono; si no, se deriva', () => {
    const intentar = (ref: string, antes?: (m: Mundo) => void) => {
      const m = enEspera();
      antes?.(m);
      m.cfg['cobro'] = { ...CFG_QR.cobro, pedidoRef: ref, pendiente: true };
      return turno(m, { tipo: 'image', esComprobante: true, mediaId: 'm1', cotejo: cotejo('cuadra') }).p!;
    };
    const ajeno = 'ped-2026-10-05-0012-zzz';
    const deOtro = (m: Mundo) => { sdDe(m)['pedidos'][ajeno] = { pedidoId: ajeno, from: OTRO, codigo: 'ZZZZ', total: 10, lineas: [], modalidad: 'recojo' }; };
    // Negativos: claves heredadas del prototipo, un pedido de otro teléfono, una referencia inexistente.
    for (const ref of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const p = intentar(ref);
      expect(p['aviso']['tipo'], ref).toBe('transferencia');
      expect(p['ruta'], ref).toContain('comprobante sin pedido en el flujo');
    }
    const otro = intentar(ajeno, deOtro);
    expect(otro['aviso']['tipo']).toBe('transferencia');
    expect(otro['pedido']).toBeNull();
    expect(intentar('ped-no-existe')['aviso']['tipo']).toBe('transferencia');
    // Positivo: la referencia del propio pedido, esté o no en `sd.pedidos` (si está en el estado, sirve).
    const m = enEspera();
    const id = estadoDe(m)['pedido']['pedidoId'] as string;
    m.cfg['cobro'] = { ...CFG_QR.cobro, pedidoRef: id, pendiente: true };
    expect(turno(m, { tipo: 'image', esComprobante: true, mediaId: 'm1', cotejo: cotejo('cuadra') }).p!['aviso']['tipo']).toBe('comprobante');
    const sinGuardado = enEspera();
    const id2 = estadoDe(sinGuardado)['pedido']['pedidoId'] as string;
    delete sdDe(sinGuardado)['pedidos'];
    sinGuardado.cfg['cobro'] = { ...CFG_QR.cobro, pedidoRef: id2, pendiente: true };
    expect(turno(sinGuardado, { tipo: 'image', esComprobante: true, mediaId: 'm1', cotejo: cotejo('cuadra') }).p!['aviso']['tipo']).toBe('comprobante');
  });
});

describe('la réplica de `cbEstadoParaAviso` conoce el QR vencido', () => {
  it('`qr_vencido` se rotula «QR vencido: coordinar el pago» y no «sin QR: cobrar al entregar»', () => {
    const e = (r: string): unknown => ejecutar(`${DOBLES}\nreturn [{ json: { v: cbEstadoParaAviso(${JSON.stringify(r)}) } }];`, [{}])[0]!['v'];
    expect(e('qr_vencido')).toBe('QR vencido: coordinar el pago');
    expect(e('sin_qr')).toBe('sin QR: cobrar al entregar');
  });
});

/**
 * LA UBICACIÓN DEL LOCAL, PEDIDA EXPRESAMENTE (09/10/2026, pedido de Q'Taco; `Decidir turno`, paso 5b).
 * `pideElLocal(norm, restringido)` es una función PURA: se corre tal como está en el nodo versionado (se saca de su código, sin copiarla)
 * con una tabla de frases. Lo que PIDE el local dispara; lo que DA algo —una dirección de entrega, la propia ubicación, un enlace pegado,
 * un dígito— no dispara. La prueba se escribe negando: la mitad de la tabla son frases que NO deben disparar. El recorrido por el flujo entero
 * (estado que no cambia, un solo mensaje, sin modelo, el botón «Ver ubicación») lo mide la batería (`A-ubicacion-local.json`).
 */
// La función completa: desde su declaración hasta la llave que cierra en la columna 0.
const inicioUbicacion = DECIDIR.indexOf('function pideElLocal(');
const finUbicacion = DECIDIR.indexOf('\n}\n', inicioUbicacion);
const FUENTE_UBICACION = DECIDIR.slice(inicioUbicacion, finUbicacion + 3);

// Una normalización igual a `vmNorm` (sin tildes, en minúsculas, sin signos), para que la tabla se lea con tildes y signos.
const normUbicacion = (t: string): string => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const pide = (texto: string, restringido = false): boolean =>
  ejecutar(`${FUENTE_UBICACION}\nreturn [{ json: { r: pideElLocal(${JSON.stringify(normUbicacion(texto))}, ${restringido}) } }];`, [])[0]['r'] as boolean;

describe('pideElLocal: PEDIR el local dispara, DAR la propia dirección no', () => {
  it('la función se extrae completa del nodo', () => {
    expect(inicioUbicacion).toBeGreaterThan(0);
    expect(FUENTE_UBICACION.startsWith('function pideElLocal(')).toBe(true);
    expect(FUENTE_UBICACION.trimEnd().endsWith('}')).toBe(true);
  });

  it('pedidos expresos del local, fuera de la entrega', () => {
    const pedidos = [
      '¿Dónde están?', 'donde estan', 'Dónde queda', '¿dónde queda el local?', '¿Dónde está el restaurante?', 'dónde se ubican', 'dónde se encuentran', 'dónde los encuentro',
      'dnd estan', 'ubicados?', '¿Dónde están ubicados?', '¿Cómo llego?', 'cómo llegar', 'como se llega', 'cómo llegamos a su local',
      'dirección del local', 'ubicación del restaurante', 'dirección de ustedes', 'su dirección', 'su ubicación', 'vuestra dirección',
      '¿cuál es la dirección?', '¿cuál es la ubicación?', 'ubicación', 'dirección', 'link', 'el link por favor', 'mapa', 'google maps', 'gmaps',
      'link de la ubicación', 'enlace de la dirección', 'enlace al mapa',
      'pásame la ubicación', 'mándame la dirección', 'compárteme la ubicación', 'pasen la ubicación', 'manden la dirección', 'me pasas la ubicación por favor',
      'ubicasion', 'direcion', 'k direccion', 'hola, ¿cuál es su dirección?', 'Hola buenas tardes, dónde están ubicados', 'cual es tu direccion',
    ];
    for (const f of pedidos) expect([f, pide(f)], f).toEqual([f, true]);
  });

  it('negado: lo que DA una dirección o una ubicación, o no pregunta por el local, no dispara', () => {
    const noPide = [
      // marcas de entrega y direcciones armadas
      'Av. Banzer 1234 zona Norte', 'mi dirección es calle 5 nro 10', 'mi ubicación', 'mi dirección', 'te paso mi ubicación', 'estoy en la Av. Busch',
      'vivo en Sopocachi', 'llévalo a la calle 3', 'entregar en mi casa', 'Calle Los Pinos esquina Rosales', 'barrio El Alto', 'zona Sur, frente a la plaza',
      'cerca de la iglesia', 'edificio Mesa Grande piso 3', 'dirección de entrega', 'la dirección es calle 5', 'dirección 1234', 'ubicación 2',
      // un enlace pegado (es la ubicación de ella, no un pedido)
      'https://maps.app.goo.gl/abc123', 'mira www.google.com/maps/place/x', 'te mando el google maps',
      // no preguntan por el local
      '¿dónde está mi pedido?', 'dónde están los tacos', 'dónde están mis bebidas', '¿dónde queda la farmacia?', 'cambiar la dirección', 'quiero cambiar la dirección del pedido',
      'cómo llega mi pedido', 'cuánto demora en llegar', 'hola', 'menú', 'quiero tres tacos', 'cancelar',
      // vacío o demasiado largo
      '', 'a'.repeat(250),
    ];
    for (const f of noPide) expect([f, pide(f)], f).toEqual([f, false]);
  });

  it('pidiendo SU dirección de entrega (restringido): «ubicación» y «dirección» sueltas son darla; solo cuenta lo que nombra al local', () => {
    for (const f of ['ubicación', 'dirección', 'la ubicación', 'k direccion', 'mi ubicación', 'mi dirección', 'te paso mi ubicación', 'pásame la ubicación', 'cuál es la dirección', 'Av. Banzer 1234 zona Norte',
      // revisión de seguridad (LOW): frases que DAN la dirección con «ubicados» o «su dirección»
      'estamos ubicados por el centro', 'estoy ubicada atrás del mercado', 'ubicados en Sopocachi', 'su dirección es la misma', 'ubicados', '¿cómo llego?']) {
      expect([f, pide(f, true)], f).toEqual([f, false]);
    }
    for (const f of ['¿Dónde están?', '¿cuál es su dirección?', 'dirección del local', 'ubicación de ustedes', 'su ubicación', 'mapa', 'link', 'el link por favor', 'google maps', 'cómo llego a su local', 'dónde están ubicados', 'su dirección, por favor', 'dónde queda su local']) {
      expect([f, pide(f, true)], f).toEqual([f, true]);
    }
  });
});
