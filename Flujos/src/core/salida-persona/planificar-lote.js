// SALIDA DE PERSONA, paso 3: de la lista reclamada a un envio por mensaje.
//
// Entra la respuesta de `reclamarSalidaPersona`: { mensajes: [...] } con hasta 10
// mensajes ya pasados a `enviando`. Sale UN item por mensaje con lo que los nodos
// de envio necesitan. Lista vacia = fin del bucle (no sale ningun item).
//
// Un mensaje que NO se puede enviar por un defecto propio (canal que no es
// 'rele' ni 'graph', texto vacio, direccion invalida, rele sin configurar) lleva
// `sinEnvio` con un codigo: el Switch lo manda directo a `Resultado del envío`,
// que lo confirma como rechazado. Nunca se queda en `enviando` ni se envia a ciegas.
const cfg = $('Config base').first().json;
const entrada = $input.all()[0];
const lista = entrada && entrada.json && Array.isArray(entrada.json.mensajes) ? entrada.json.mensajes : [];
const releBase = String(cfg.releBaseUrl ?? '').trim();
const releListo = /^http:\/\/[A-Za-z0-9._-]+(:[0-9]{2,5})?$/.test(releBase);

const salida = [];
for (const m of lista) {
  const p = (m && typeof m === 'object') ? m : {};
  const mensajeId = String(p.mensajeId ?? '');
  const conversacionId = String(p.conversacionId ?? '');
  const texto = typeof p.texto === 'string' ? p.texto : '';
  const to = String(p.to ?? '');
  const canal = String(p.canal ?? '');
  const claveRele = String(p.claveRele ?? '');

  let sinEnvio = '';
  let reintentable = false;
  if (!mensajeId || !conversacionId) sinEnvio = 'NV-RECLAMO';
  else if (canal !== 'rele' && canal !== 'graph') sinEnvio = 'NV-CANAL';
  else if (!/^[0-9]{8,15}$/.test(to)) sinEnvio = 'NV-DESTINO';
  else if (texto.trim() === '' || texto.length > 1000) sinEnvio = 'NV-TEXTO';
  else if (canal === 'rele' && !/^[A-Za-z0-9_.:-]{16,128}$/.test(claveRele)) sinEnvio = 'NV-CLAVE';
  else if (canal === 'rele' && !releListo) { sinEnvio = 'NV-RELE-CONFIG'; reintentable = true; }

  salida.push({ json: {
    mensajeId, conversacionId, canal, claveRele,
    sinEnvio, reintentable,
    // Por donde sigue el Switch: un mensaje con defecto propio NUNCA entra a un nodo de envio.
    ruta: sinEnvio ? 'ninguna' : canal,
    // Mismo cuerpo para el rele y para Graph: el rele reenvia a Graph tal cual.
    cuerpoEnvio: { messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } },
  }});
}
return salida;
