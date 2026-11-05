// SOLTAR MENSAJES (PR-4a): decide qué sale, con lo que contestó el servidor al compromiso del estado. Un ÍTEM POR MENSAJE: de aquí cuelgan el envío, el cierre y «Confirmar envío».
//
// «Armar mensajes» armó TODO en un solo ítem y pidió comprometer el bloque (estado + pedidos del teléfono) ANTES de enviar. Aquí:
//   - sin nada que comprometer (el turno no cambia el estado: uso extendido, comercio no operativo, sin estado) o comprometido: salen los mensajes armados;
//   - CONFLICTO DE VERSIÓN: otra ejecución del mismo teléfono comprometió primero (una ráfaga). La que pierde CEDE: no envía nada (no hay respuesta que replanificar sin repetir
//     el modelo y los avisos que ya salieron); la ganadora responde. Reemplazar por el genérico sería sumar ruido a una carrera normal;
//   - el compromiso falló (5xx o timeout, ya reintentado con el MISMO idCompromiso), no hay sesión o el bloque no cabe: sale SOLO el genérico con el botón a recepción, sin cierre. REEMPLAZA la respuesta (0 mensajes más).
// Una puerta cerrada o sin respuesta (uso extendido, comercio no operativo, sin estado) no compromete nada y nunca cae al genérico.
// Si el estado salió de la memoria vieja de n8n (lectura de respaldo) y quedó comprometido, se borra de allí; pasado el retiro (30/11/2026), se borran los mapas viejos.
const a = vmPrimero('Armar mensajes');
if (!a || a.turno !== true) return [];
const r = a.comprometer === true ? ssResultadoDeCompromiso(vmPrimero('Comprometer turno')) : { resultado: 'ok', version: 0, ganador: null };
if (a.comprometer === true && r.resultado === 'conflicto') return [];
const comprometido = a.comprometer === true && r.resultado === 'ok';
const bien = a.modo === 'sin_estado_que_guardar' || (a.modo === 'comprometer' && r.resultado === 'ok');
const salida = bien ? a.salida : a.salidaFalla;
if (comprometido) vmRetirarRespaldo(a.from, a.ahoraMs, a.deRespaldo === true);
else if (!(Number(a.ahoraMs) < VM_RESPALDO_HASTA_MS)) vmRetirarRespaldo(a.from, a.ahoraMs, false);
const estado = { modo: a.modo, resultado: a.comprometer === true ? r.resultado : 'sin_compromiso', comprometido: comprometido, version: comprometido ? r.version : null };
const items = (Array.isArray(salida) && salida.length ? salida : [{ sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: a.from, cierre: null, errores: [] }])
  .map((x) => ({ json: Object.assign({}, x) }));
Object.assign(items[0].json, { sesion: estado, comprometido: comprometido, versionComprometida: comprometido ? r.version : 0, previo: bien ? a.previo : null, bloque: comprometido ? a.bloque : null, numero: a.numero });
return items;
