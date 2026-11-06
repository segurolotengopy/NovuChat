// SOLTAR MENSAJES (PR-4a): decide qué sale, con lo que contestó el servidor al compromiso del estado. Un ÍTEM POR MENSAJE: de aquí cuelgan el envío, el cierre y «Confirmar envío».
//
// «Armar mensajes» armó TODO en un solo ítem y pidió comprometer el bloque (estado + pedidos del teléfono) ANTES de enviar. Aquí:
//   - sin nada que comprometer (el turno no cambia el estado: uso extendido, comercio no operativo, sin estado) o comprometido: salen los mensajes armados;
//   - CONFLICTO DE VERSIÓN (otra ejecución del mismo teléfono comprometió primero, una ráfaga): SIN hecho externo ya ocurrido, la que pierde CEDE (no envía nada; la ganadora responde).
//     CON hecho externo (un aviso al local ya salió, o se cotejó el comprobante), ceder en silencio es un defecto (B1): el local tiene un pedido que el cliente no vio y al reconfirmar saldría un segundo
//     pedido. Entonces se REPLANIFICA una vez (`Comprometer turno (2.º intento)`: el bloque del ganador, el pedido de este turno unido por pedidoId, el paso en `menu`, con la versión ganadora y el mismo
//     idCompromiso por paso); si ese también falla o choca, sale el genérico con el botón: NUNCA silencio con un hecho externo;
//   - el compromiso falló (5xx o timeout, ya reintentado con el MISMO idCompromiso), no hay sesión o el bloque no cabe: sale SOLO el genérico con el botón a recepción, sin cierre. REEMPLAZA la respuesta (0 mensajes más).
// Una puerta cerrada o sin respuesta (uso extendido, comercio no operativo, sin estado) no compromete nada y nunca cae al genérico.
// PR-4b: el primer ítem lleva `asentar` (el cuerpo que devuelve el cupo de aviso si ningún aviso salió; lo manda «Confirmar envío»). Si la ejecución CEDE (conflicto sin hecho externo) no sale ningún ítem y el cupo, si se consumió, queda consumido (lado conservador).
// Si el estado salió de la memoria vieja de n8n (lectura de respaldo) y quedó comprometido, se borra de allí; pasado el retiro (30/11/2026), se borran los mapas viejos.
const a = vmPrimero('Armar mensajes');
if (!a || a.turno !== true) return [];
let r = a.comprometer === true ? ssResultadoDeCompromiso(vmPrimero('Comprometer turno')) : { resultado: 'ok', version: 0, ganador: null };
let bloqueComprometido = a.bloque;
let replanificado = false;
if (a.comprometer === true && r.resultado === 'conflicto') {
  if (a.hechoExterno !== true) {
    // Ráfaga: la que pierde no envía nada de lo suyo (la ganadora responde a su mensaje), pero un TEXTO perdido no queda sin respuesta: sale el aviso corto que pide repetirlo (un botón doble sigue en silencio).
    const cede = Array.isArray(a.salidaCede) ? a.salidaCede : [];
    return cede.map((x) => ({ json: Object.assign({}, x, { sesion: { replanificado: false, modo: a.modo, resultado: 'conflicto', comprometido: false, version: null, cedio: true }, comprometido: false, versionComprometida: 0, previo: null, bloque: null, numero: a.numero, asentar: null }) }));
  }
  replanificado = true;
  const intento2 = vmNodo('Comprometer turno (2.º intento)') ? vmPrimero('Comprometer turno (2.º intento)') : null;
  r = intento2 ? ssResultadoDeCompromiso(intento2) : { resultado: 'falla', version: 0, ganador: null };
  const cuerpo2 = intento2 && typeof intento2.body === 'object' && intento2.body ? intento2.body : {};
  if (r.resultado === 'ok' && cuerpo2.conversacion && typeof cuerpo2.conversacion.estado === 'object') bloqueComprometido = cuerpo2.conversacion.estado;
  // un segundo conflicto cuenta como falla: con hecho externo nunca se cede
  if (r.resultado === 'conflicto') r = { resultado: 'falla', version: 0, ganador: null };
}
const comprometido = a.comprometer === true && r.resultado === 'ok';
const bien = a.modo === 'sin_estado_que_guardar' || (a.modo === 'comprometer' && r.resultado === 'ok');
const salida = bien ? a.salida : a.salidaFalla;
if (comprometido) vmRetirarRespaldo(a.from, a.ahoraMs, a.deRespaldo === true);
else if (!(Number(a.ahoraMs) < VM_RESPALDO_HASTA_MS)) vmRetirarRespaldo(a.from, a.ahoraMs, false);
// I1: si el compromiso falló DESPUÉS de un aviso de pedido o de comprobante, se anota por `tipo:pedidoId` (residuo de PR-4b, 72 h) para que el turno siguiente no lo repita; si el estado avanzó, se borra.
{
  const sd = vmSd();
  const marcas = Array.isArray(a.avisoMarcas) ? a.avisoMarcas : [];
  if (sd && marcas.length) {
    if (!sd.avisosHuerfanos || typeof sd.avisosHuerfanos !== 'object' || Array.isArray(sd.avisosHuerfanos)) sd.avisosHuerfanos = {};
    for (const k of Object.keys(sd.avisosHuerfanos)) if (!(Number(a.ahoraMs) - Number(sd.avisosHuerfanos[k]) < 72 * 60 * 60 * 1000)) delete sd.avisosHuerfanos[k];
    for (const k of marcas) { if (!bien) sd.avisosHuerfanos[k] = Number(a.ahoraMs); else delete sd.avisosHuerfanos[k]; }
    const claves = Object.keys(sd.avisosHuerfanos);
    if (claves.length > 500) for (const k of claves.sort((x, y) => Number(sd.avisosHuerfanos[x]) - Number(sd.avisosHuerfanos[y])).slice(0, claves.length - 500)) delete sd.avisosHuerfanos[k];
  }
}
// El genérico de una falla SIN hecho externo lleva el aviso de transferencia a recepción: se anota la marca de la hora (`topeTransferenciasHora`) como `Armar mensajes` la anota cuando un aviso sale.
if (!bien && a.avisoFalla === true) {
  const sd = vmSd();
  if (sd) {
    if (!sd.transferencias || typeof sd.transferencias !== 'object' || Array.isArray(sd.transferencias)) sd.transferencias = {};
    const previas = Object.prototype.hasOwnProperty.call(sd.transferencias, a.from) && Array.isArray(sd.transferencias[a.from]) ? sd.transferencias[a.from] : [];
    // y cuenta para el tope DIARIO de avisos (`topeAvisosDia`), igual que el contador de avisos de la librería (la fecha la calculó «Armar mensajes»)
    if (!sd.av || typeof sd.av !== 'object') sd.av = {};
    const previo = sd.av.dia && sd.av.dia.fecha === a.avisoFallaFecha && Number.isFinite(sd.av.dia.n) ? Math.max(0, Math.floor(sd.av.dia.n)) : 0;
    sd.av.dia = { fecha: a.avisoFallaFecha, n: previo + Math.max(0, Math.floor(Number(a.avisoFallaN) || 0)) };
    sd.transferencias[a.from] = previas.filter((ms) => Number(a.ahoraMs) - Number(ms) < 60 * 60 * 1000).concat([Number(a.ahoraMs)]);
  }
}
const estado = { replanificado: replanificado, modo: a.modo, resultado: a.comprometer === true ? r.resultado : 'sin_compromiso', comprometido: comprometido, version: comprometido ? r.version : null };
const items = (Array.isArray(salida) && salida.length ? salida : [{ sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: a.from, cierre: null, errores: [] }])
  .map((x) => ({ json: Object.assign({}, x) }));
Object.assign(items[0].json, { sesion: estado, comprometido: comprometido, versionComprometida: comprometido ? r.version : 0, previo: bien ? a.previo : null, bloque: comprometido ? bloqueComprometido : null, numero: a.numero, asentar: a.asentar || null });
return items;
