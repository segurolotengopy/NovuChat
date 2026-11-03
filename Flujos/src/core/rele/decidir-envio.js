// LEER RESPUESTA DEL RELÉ (módulo común de envío por el relé B9). Corre en «run once for all items», después de «Enviar a WhatsApp», y decide
// por cada mensaje qué sigue. La Switch «¿Qué hacer con el envío?» lee `accion`.
//
//   ok ........... el relé devolvió {messages:[{id}]}: se reporta con `idMeta`.
//   reintentar ... se repite el MISMO mensaje con la MISMA clave tras `esperaS` segundos (nodo «Esperar reintento»).
//   respaldo ..... el relé rechazó antes de Meta, o Meta rechazó con un código conocido: sale el mismo contenido como texto (un solo intento).
//   incierto ..... el mensaje pudo haber salido (504 WM-3041, error de red, 2xx sin id, un código desconocido): NO se reenvía, sin respaldo, sin reporte.
//   agotado ...... se acabaron los reintentos de una causa transitoria: sin respaldo y sin reporte (ese turno queda sin esa respuesta; decisión de Andres, D4).
//
// Tabla (plan del 02/11, §3f):
//   WM-3041 ............................ incierto, nunca se reenvía
//   WM-3037 (429) ...................... UNA vez tras 61 s + azar (61 a 64 s, bajo los 65 s en que n8n deja de esperar en memoria); luego agotado
//   WM-3035 (409) ...................... hasta 2 veces tras 2 a 3 s; luego agotado
//   `reintentable` de un código conocido  hasta 2 reintentos (2 s y 8 s); luego agotado (salvo WM-3032 y WM-3039, que nunca se repiten)
//   TOPE TOTAL ......................... la suma de reintentos de todos los motivos no pasa de 3 por mensaje; el siguiente es agotado
//   código previo o de Meta conocido ... respaldo
//   cualquier otra cosa ................ incierto
//
// La respuesta llega SIN `fullResponse`: éxito = {messages:[{id}]}, error del relé = {error:{codigo, reintentable, metaCodigo}}, error de red o de tiempo
// = {error:'texto'} (un string). De dónde viene el mensaje original: de «¿Enviar de verdad?» en la primera vuelta y de «Esperar reintento» en las
// siguientes (`$runIndex` es el de este nodo, que corre una vez por cada vuelta del envío), emparejado por `pairedItem`.
// JavaScript plano del nodo Code de n8n: sin require, URL, Buffer ni crypto.
function releDecidir(respuesta, intentos, azar) {
  const r = respuesta !== null && typeof respuesta === 'object' && !Array.isArray(respuesta) ? respuesta : {};
  const ya = intentos !== null && typeof intentos === 'object' ? intentos : {};
  const cuenta = { n429: Number(ya.n429) > 0 ? Number(ya.n429) : 0, n409: Number(ya.n409) > 0 ? Number(ya.n409) : 0, nReint: Number(ya.nReint) > 0 ? Number(ya.nReint) : 0 };
  // Tope TOTAL por mensaje: la suma de reintentos de todos los motivos no pasa de RELE_TOPE_TOTAL (cada causa tiene además el suyo).
  const total = cuenta.n429 + cuenta.n409 + cuenta.nReint;
  const a = Math.min(Math.max(Number(azar) || 0, 0), 0.999999);
  const limpio = (v) => String(v === undefined || v === null ? '' : v).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40);
  const fin = (accion, codigo, extra) => Object.assign({ accion: accion, codigo: limpio(codigo), esperaS: 0, intentos: cuenta }, extra || {});
  const err = r.error !== null && typeof r.error === 'object' && !Array.isArray(r.error) ? r.error : null;
  if (!err) {
    // Un error que no es objeto (red, tiempo agotado): el mensaje pudo salir.
    if (r.error !== undefined && r.error !== null && r.error !== false) return fin('incierto', 'RED');
    const primero = Array.isArray(r.messages) ? r.messages[0] : undefined;
    const id = primero && typeof primero.id === 'string' ? primero.id : '';
    if (/^[A-Za-z0-9_.=:+/-]{1,120}$/.test(id)) return fin('ok', '', { idMeta: id });
    return fin('incierto', 'SIN-ID');
  }
  const wm = typeof err.codigo === 'string' ? err.codigo : '';
  if (!/^WM-\d{4}$/.test(wm)) return fin('incierto', 'SIN-CODIGO');
  if (wm === 'WM-3041') return fin('incierto', wm);
  if (wm === 'WM-3037') {
    if (cuenta.n429 >= RELE_TOPE_429 || total >= RELE_TOPE_TOTAL) return fin('agotado', wm);
    cuenta.n429 += 1;
    return fin('reintentar', wm, { esperaS: 61 + Math.floor(a * 4) });
  }
  if (wm === 'WM-3035') {
    if (cuenta.n409 >= RELE_TOPE_409 || total >= RELE_TOPE_TOTAL) return fin('agotado', wm);
    cuenta.n409 += 1;
    return fin('reintentar', wm, { esperaS: 2 + Math.round(a * 10) / 10 });
  }
  let codigo = wm;
  let conocido = false;
  let reintentable = err.reintentable === true;
  if (wm === 'WM-3040') {
    const meta = String(err.metaCodigo === undefined || err.metaCodigo === null ? '' : err.metaCodigo);
    conocido = RELE_METAS.indexOf(meta) >= 0;
    codigo = conocido ? meta : wm;
    if (meta === '130429') reintentable = true;
  } else conocido = RELE_PREVIOS.indexOf(wm) >= 0;
  if (!conocido) return fin('incierto', codigo);
  if (reintentable && RELE_NUNCA_REINTENTAR.indexOf(wm) < 0) {
    if (cuenta.nReint >= RELE_PAUSAS_REINTENTABLE_S.length || total >= RELE_TOPE_TOTAL) return fin('agotado', codigo);
    const espera = RELE_PAUSAS_REINTENTABLE_S[cuenta.nReint];
    cuenta.nReint += 1;
    return fin('reintentar', codigo, { esperaS: espera });
  }
  return fin('respaldo', codigo);
}

const respuestas = $input.all();
const vuelta = $runIndex;
const origen = vuelta > 0 ? $('Esperar reintento').all(0, vuelta - 1) : $('¿Enviar de verdad?').all(0, 0);
return respuestas.map((x, i) => {
  const par = x && x.pairedItem && Number.isInteger(x.pairedItem.item) ? x.pairedItem.item : i;
  const src = origen[par] && origen[par].json && typeof origen[par].json === 'object' ? origen[par].json : null;
  // Sin el mensaje original no hay con qué reintentar ni con qué respaldar: incierto, sin reenviar.
  if (!src) return { json: { accion: 'incierto', codigo: 'SIN-ORIGEN', esperaS: 0 }, pairedItem: { item: i } };
  const d = releDecidir(x.json, src.releIntentos, Math.random());
  const salida = Object.assign({}, src, { accion: d.accion, codigo: d.codigo, esperaS: d.esperaS, releIntentos: d.intentos });
  if (d.idMeta) salida.idMeta = d.idMeta; else delete salida.idMeta;
  return { json: salida, pairedItem: { item: i } };
});
