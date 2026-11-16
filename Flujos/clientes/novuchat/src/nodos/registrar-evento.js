// REGISTRAR EVENTO: el mensaje del cliente entra a la COLA de eventos de su ficha, con un número de secuencia, y se COMPROMETE en el servidor (estado de la conversación, PR-4c2).
//
// COALESCENCIA DE CLICS (documento comercial §7 y «Escenario 1»): quien toca tres botones seguidos manda tres mensajes y n8n arranca tres ejecuciones. Cada una registra su evento AQUÍ
// (y lo compromete en el servidor: así ve la cola de las demás), espera 2,5 s («Esperar ráfaga») y la última arma el contexto con TODOS los eventos desde el último mensaje del asistente
// y responde UNA vez. Las demás terminan sin enviar nada cuando su compromiso final choca con el de la más nueva (`conflicto_version`).
//
// ESTE MISMO CÓDIGO corre en «Registrar evento» (pasada 1: estado leído en «Traer configuración»), «Replanificar registro» (2.ª: sobre el estado ganador del primer conflicto) y
// «Replanificar registro (2.º)» (3.ª). El nodo no llama a la red: arma el pedido (`compromiso`) y un nodo HTTP lo manda.
// Un audio se transcribe y una imagen o un documento se leen ANTES de llegar aquí (nodos de medios): este nodo arma el evento con lo que leyeron. Lo leído NUNCA se mezcla con lo que
// escribió el cliente: va aparte, rotulado como dato. Si la puerta cerró el turno (comercio suspendido, uso extendido, sin estado), no se registra nada y la espera es mínima.
const t = cnPrimero('Interpretar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const cfg = cnCfg();
const pasada = cnNodo('Comprometer evento (2.º intento)') ? 3 : (cnNodo('Comprometer evento') ? 2 : 1);
const sin = (extra) => [{ json: Object.assign({ registrado: false, comprometer: false, falla: false, seq: 0, esperarSeg: 0.1, from: t.from }, extra || {}) }];
if (puerta.ruta !== 'sigue' || !cnClaveValida(t.from)) return sin();

let ev = t.evento;
if (!ev) {
  if (t.tipo === 'audio') {
    const tr = t.esAudio ? cnTextoDeGemini(cnPrimero('Transcribir audio')).trim() : '';
    ev = chEventoMedio('audio', { transcripcion: tr.length <= 4400 ? tr : '' });
  } else if (t.tipo === 'image' || t.tipo === 'document') {
    // Imagen o documento: la categoría es de lista cerrada (`comprobante` u `otro`) y lo leído es un DATO del cliente, nunca una instrucción.
    const lectura = t.esVisual ? (cnPrimero('Describir documento') || cnPrimero('Describir imagen')) : null;
    const o = lectura ? cnJsonDeGemini(lectura) : null;
    ev = chEventoMedio(t.tipo === 'document' ? 'documento' : 'imagen', {
      pie: t.pie, comprobante: !!o && o.categoria === 'comprobante', lectura: o && typeof o.texto === 'string' ? o.texto : '',
    });
  } else {
    ev = chEventoOtro(t.tipo);
  }
}
// El estado sobre el que se registra: en la 1.ª pasada el que leyó «Traer configuración»; en las otras, el ESTADO GANADOR del conflicto anterior.
const previo = pasada === 1 ? null : ssResultadoDeCompromiso(cnPrimero(pasada === 2 ? 'Comprometer evento' : 'Comprometer evento (2.º intento)'));
if (pasada === 1 ? (!cfg.sesion || cfg.sesion.ok !== true) : (!previo || previo.resultado !== 'conflicto')) return sin({ falla: true });
const base = pasada === 1 ? cfg.sesion.estado : previo.ganador;
const version = pasada === 1 ? cfg.sesion.version : previo.version;
const f = chFichaVigente(base, t.ahoraMs);
// Meta reenvió este mensaje y otra ejecución ya lo registró: esa responde.
if (pasada > 1 && chYaVisto(f, t.mensajeId)) return [];
f.seq += 1;
const saneado = chEventoSaneado(Object.assign({}, ev, { seq: f.seq, id: t.mensajeId, ms: t.ahoraMs }));
if (!saneado) return sin();
f.cola.push(saneado);
f.cola = f.cola.slice(-CH_TOPE_COLA);
f.ultimoMs = t.ahoraMs;
// El estado se recorta por BYTES (CJK y emojis pesan 3 y 4 bytes por carácter) antes de comprometer: una cola larga no debe llevar al genérico.
const ajuste = chAjustarBytes(f, 14900);
const compromiso = ajuste.cupo ? ssCuerpoComprometer(t.from, $execution.id, 'reg' + pasada, version, f) : null;
// Sin poder comprometer (estado demasiado grande o teléfono que el servidor no admite) el turno sale con el genérico y el botón.
if (!compromiso) return sin({ falla: true });
return [{ json: { registrado: true, comprometer: true, falla: false, seq: f.seq, esperarSeg: CH_ESPERA_SEG, from: t.from, ficha: f, compromiso: compromiso, numero: ssNumeroHeader(), pasada: pasada } }];
