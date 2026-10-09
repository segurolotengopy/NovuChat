// REGISTRAR EVENTO: el mensaje del cliente entra a la COLA de eventos de su ficha, con un número de secuencia, y dice cuánto esperar la ráfaga.
//
// COALESCENCIA DE CLICS (documento comercial §7 y «Escenario 1»): quien toca tres botones seguidos manda tres mensajes y n8n arranca tres ejecuciones. Cada una registra su evento AQUÍ,
// espera 2,5 s («Esperar ráfaga») y «Armar turno» solo sigue si su evento sigue siendo el último de ese teléfono: la última arma el contexto con TODOS los eventos desde el último mensaje
// del asistente, y responde UNA vez. Las demás terminan sin enviar nada.
//
// Un audio se transcribe y una imagen o un documento se leen ANTES de llegar aquí (nodos de medios): este nodo arma el evento con lo que leyeron. Lo leído NUNCA se mezcla con lo que
// escribió el cliente: va aparte, rotulado como dato. Si la puerta cerró el turno (comercio suspendido, uso extendido), no se registra nada y la espera es mínima.
const t = cnPrimero('Interpretar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
if (puerta.ruta !== 'sigue' || !cnClaveValida(t.from)) return [{ json: { registrado: false, seq: 0, esperarSeg: 0.1, from: t.from } }];

let ev = t.evento;
if (!ev) {
  if (t.tipo === 'audio') {
    const tr = t.esAudio ? cnTextoDeGemini(cnPrimero('Transcribir audio')).trim() : '';
    ev = chEventoMedio('audio', { transcripcion: tr.length <= 4400 ? tr : '' });
  } else {
    // Imagen o documento: la categoría es de lista cerrada (`comprobante` u `otro`) y lo leído es un DATO del cliente, nunca una instrucción.
    const lectura = t.esVisual ? (cnPrimero('Describir documento') || cnPrimero('Describir imagen')) : null;
    const o = lectura ? cnJsonDeGemini(lectura) : null;
    ev = chEventoMedio(t.tipo === 'document' ? 'documento' : 'imagen', {
      pie: t.pie, comprobante: !!o && o.categoria === 'comprobante', lectura: o && typeof o.texto === 'string' ? o.texto : '',
    });
  }
}
const fichas = cnMapaDeFichas(true);
const f = chFichaVigente(cnFichaDe(fichas.mapa, t.from), t.ahoraMs);
f.seq += 1;
const saneado = chEventoSaneado(Object.assign({}, ev, { seq: f.seq, id: t.mensajeId, ms: t.ahoraMs }));
if (!saneado) return [{ json: { registrado: false, seq: 0, esperarSeg: 0.1, from: t.from } }];
f.cola.push(saneado);
f.cola = f.cola.slice(-8);
f.ultimoMs = t.ahoraMs;
fichas.mapa[t.from] = f;
// Primero se escribe y después se barre: así el total nunca pasa del tope, contando esta ficha.
chBarrer(fichas.mapa, t.ahoraMs);
return [{ json: { registrado: true, seq: f.seq, esperarSeg: CH_ESPERA_SEG, from: t.from } }];
