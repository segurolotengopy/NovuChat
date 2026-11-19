// RESUMEN DEL TURNO: el último nodo. En producción no hace nada visible salvo dos cosas: guarda en la memoria lo que el asistente dijo SOLO si Meta lo aceptó, y hace fallar la ejecución si un mensaje no se entregó.
// En la variante de prueba, «Entrada de prueba» responde con lo que devuelve este nodo (modo `lastNode`): los mensajes del turno y un resumen, para que un corredor externo evalúe cada turno sin depender de WhatsApp.
//
// Lee TODO por nombre de «Armar mensajes» y no de lo que devolvieron los nodos de envío ni de reporte (un nodo desactivado deja pasar su entrada). Cuelga de «Armar mensajes» por debajo
// de todo el lienzo, así que con `executionOrder: v1` corre después de los envíos y del cierre.
const items = cnTodos('Armar mensajes');
const evId = (j) => {
  const m = j && j.messages;
  return Array.isArray(m) && !!m[0] && typeof m[0].id === 'string' && m[0].id !== '';
};
// MEMORIA POR TELÉFONO: la entrada del asistente se guarda SOLO si Meta aceptó el envío (el principal o, si no, su respaldo en texto); en modo prueba sin envío cuenta el principal.
// Si algo falla aquí no se interrumpe el turno.
try {
  const h = (items[0] || {}).hist;
  if (h && typeof h === 'object' && (items[0] || {}).sinMensajes !== true) {
    const okP = cnNodo('Enviar a WhatsApp') ? cnTodos('Enviar a WhatsApp').some(evId) : cnCfg().modoPrueba === true;
    const okR = !okP && cnTodos('Enviar respaldo').some(evId);
    const dicho = okP ? h.a : (okR ? h.b : '');
    const fichas = cnMapaDeFichas(true);
    const f = cnFichaDe(fichas.mapa, String((items[0] || {}).from || ''));
    if (f && typeof dicho === 'string' && dicho.trim() !== '') {
      f.historial = (Array.isArray(f.historial) ? f.historial : []).concat([{ r: 'a', t: evEntradaAsistente(dicho) }]).slice(-EV_TOPE_HISTORIAL);
      // El cierre completo cuenta como hecho SOLO si Meta lo aceptó (el principal o su respaldo): si el envío falla, la próxima vez vuelve a salir completo.
      if ((items[0] || {}).plan === 'derivar') f.cierreMs = Number((cnPrimero('Normalizar entrada') || {}).ahoraMs) || Date.now();
      // La comparación fija cuenta como mostrada SOLO si Meta la aceptó: habilita la ubicación en el cierre que sigue.
      if ((items[0] || {}).plan === 'comparacion') f.comparacionMs = Number((cnPrimero('Normalizar entrada') || {}).ahoraMs) || Date.now();
    }
  }
} catch (e) { /* la memoria no es crítica: nunca tumba el turno */ }
// ENTREGA («se entrega lo que se promete»): este nodo corre DESPUÉS de los envíos. Un mensaje a la persona cuenta como entregado SOLO si Meta devolvió un `messages[0].id` no vacío, por el envío principal o por
// su respaldo en texto. Si hubo mensajes que no salieron ni por uno ni por el otro, la ejecución termina en ERROR en vez de en `success`: queda marcada en la lista de ejecuciones de n8n (sin datos: `saveDataErrorExecution` es `none`) y NO hay un Error Workflow que avise a nadie; límite declarado en DISENO.md. El error no lleva texto ni número de la persona.
if (cnNodo('Enviar a WhatsApp')) {
  const esperados = items.filter((i) => i && i.sinMensajes !== true).length;
  const entregados = cnTodos('Enviar a WhatsApp').filter(evId).length + cnTodos('Enviar respaldo').filter(evId).length;
  if (entregados < esperados) {
    throw new Error('Entrega fallida: Meta rechazó el envío y su respaldo en texto; ' + (esperados - entregados) + ' de ' + esperados + ' mensaje(s) a la persona sin entregar. La persona no recibió respuesta.');
  }
}
const cfg = cnCfg();
const primero = items[0] || {};
const mensajes = items.filter((i) => i && i.sinMensajes !== true).map((i) => ({
  para: i.para, destino: i.destino, payload: i.payload, texto: i.texto, respaldo: i.respaldo, reportar: i.reportar === true,
}));
const previos = cnTodos('Armar previos').filter((i) => i && (i.kind === 'arte' || i.kind === 'aviso')).map((i) => ({ kind: i.kind, arte: i.arte || '', para: i.para, payload: i.payload }));
// Lo PLANEADO para este turno (también en modo prueba sin envío, donde `previos` queda vacío): las imágenes por clave y el aviso a recepción. Lo lee la batería.
const planeado = ((cnTodos('Armar previos')[0] || {}).res) || {};
const r = primero.resumen || { plan: primero.plan || 'nada', mensajes: 0 };
return [{ json: {
  ok: true,
  modoPrueba: cfg.modoPrueba === true,
  mensajes: mensajes,
  previos: previos,
  imagenes: Array.isArray(planeado.artesPlan) ? planeado.artesPlan : [],
  avisoPlaneado: !!planeado.aviso && planeado.aviso.planeado === true,
  // La preferencia de día y horario que llevó el aviso de solicitud (o «pidió que la llamen»): la lee la batería (`aviso_horario_contiene`).
  avisoHorario: typeof planeado.preferencia === 'string' ? planeado.preferencia : '',
  derivacion: planeado.efectivo === 'derivar' || planeado.efectivo === 'derivar_corto',
  resumen: Object.assign({}, r, { mensajesSalientes: mensajes.length }),
} }];
