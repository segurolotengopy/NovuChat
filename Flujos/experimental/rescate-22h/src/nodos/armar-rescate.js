// «Armar rescate»: junta cada rescate con la respuesta del modelo (por posición), elige el texto y arma el mensaje.
// Un ítem por mensaje, con la forma que espera la cadena de envío común. SIN la clave `evento`: el rescate no enciende nada.
const cfg = $('Config base').first().json;
const base = $('Preparar rescates').all().map((i) => i.json);
const resp = $input.all().map((i) => i.json);
if (base.length !== resp.length) throw new Error('RS-PAREO');
const version = /^v\d+\.\d$/.test(String(cfg.waGraphVersion)) ? cfg.waGraphVersion : 'v26.0';
const salida = [];
for (let i = 0; i < base.length; i++) {
  const b = base[i];
  // La ventana de Meta cierra a las 24 h: pasado el corte, ese rescate ya no sale.
  if (Date.now() >= b.ultimoEntranteMs + RS_CORTE_MS) continue;
  const e = rsElegirTexto(cfg, b, rsTextoDeGemini(resp[i]));
  if (!e.texto) continue;
  salida.push({
    json: {
      para: b.telefono,
      destino: 'cliente',
      payload: { messaging_product: 'whatsapp', recipient_type: 'individual', to: b.telefono, type: 'text', text: { preview_url: false, body: e.texto } },
      texto: e.texto,
      respaldo: e.texto,
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
