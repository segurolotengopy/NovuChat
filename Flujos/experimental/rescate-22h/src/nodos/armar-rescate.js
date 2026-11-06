// «Armar rescate»: junta cada rescate con la respuesta del modelo (por posición), elige el texto y arma el mensaje.
// Un ítem por mensaje, con la forma que espera la cadena de envío común. SIN la clave `evento`: el rescate no enciende nada.
const cfg = $('Config base').first().json;
const base = $('Preparar rescates').all().map((i) => i.json);
const entra = $input.all().map((i) => i.json);
// Este nodo corre hasta dos veces por ejecución (n8n lo ejecuta por cada rama que le llega): (a) desde «¿Hay historial?» (salida «no»), con los rescates de historial
// insuficiente, que salen con el texto fijo SIN pasar por el modelo; (b) desde «Redactar rescate», con una respuesta del modelo por cada rescate de historial suficiente,
// en el mismo orden que en «Preparar rescates». Cada corrida atiende un subconjunto distinto: ninguno sale dos veces.
const sinModelo = entra.length > 0 && entra.every((j) => j && typeof j.telefono === 'string' && j.suficiente === false);
let pares;
if (sinModelo) pares = entra.map((b) => [b, '']);
else {
  const conModelo = base.filter((b) => b.suficiente === true);
  if (conModelo.length !== entra.length) throw new Error('RS-PAREO');
  pares = conModelo.map((b, i) => [b, rsTextoDeGemini(entra[i])]);
}
const version = /^v\d{1,2}\.\d$/.test(String(cfg.waGraphVersion)) ? cfg.waGraphVersion : 'v26.0';
const salida = [];
for (const [b, crudo] of pares) {
  // La ventana de Meta cierra a las 24 h: pasado el corte, ese rescate ya no sale.
  if (Date.now() >= b.ultimoEntranteMs + RS_CORTE_MS) continue;
  const e = rsElegirTexto(cfg, b, crudo);
  if (!e.texto) continue;
  salida.push({
    json: {
      para: b.telefono,
      destino: 'cliente',
      payload: { messaging_product: 'whatsapp', recipient_type: 'individual', to: b.telefono, type: 'text', text: { preview_url: false, body: e.texto } },
      texto: e.texto,
      tipoReporte: 'text',
      reportar: true,
      sinMensajes: false,
      phoneNumberId: rsDigitos(cfg.phoneNumberId),
      waGraphVersion: version,
      origen: e.origen,
      motivo: e.motivo,
    },
  });
}
return salida;
