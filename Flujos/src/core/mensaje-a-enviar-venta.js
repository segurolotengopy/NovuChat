// PUNTO UNICO DE SALIDA AL CLIENTE DEL DEMO B (F3a, 02/10/2026).
//
// Hasta hoy a `Responder al cliente` se llegaba desde seis lugares (la respuesta
// del agente, el enlace del catalogo, comercio no operativo, uso extendido, el
// cobro y el carrito) y ninguno podia ponerle un boton: el texto salia siempre
// plano. Ahora todo camino pasa por este nodo, que decide UNA cosa: si el
// mensaje lleva el boton para escribirle directo al negocio. Es la misma
// politica de los flujos de reservas y de captacion (Andres, 21/09/2026): lo
// unico que el asistente ofrece ante un error o una consulta sin respuesta es
// pasar con una persona, y eso es SIEMPRE el aviso mas el boton.
//
// EL BOTON VA DENTRO DEL MISMO MENSAJE (patron de captacion), no en uno aparte
// (patron de reservas, «Enviar contacto»): el aparte cuesta un mensaje mas por
// cada transferencia y cada fallo. Un interactivo `cta_url` con el texto como
// cuerpo cuesta uno solo.
//
// Lleva boton solo si hay numero del negocio y el mensaje es una transferencia,
// un fallo del modelo o una respuesta vacia. Una respuesta normal sale sin boton.
//
// Si Meta rechaza el interactivo, `Responder con botón` sale por su salida de
// error a `Responder al cliente`, que manda el MISMO texto con el enlace
// adentro: el cliente recibe un solo mensaje (el rechazado no se cobra).
//
// NO ENVIA NADA: cuesta CERO mensajes de WhatsApp. Sin `URL`, `Buffer` ni
// `crypto`: el sandbox de n8n no los tiene.
const NEGRITA_MD = (t) => String(t).replace(/\*\*\*([^*\n]+?)\*\*\*/g, '*_$1_*').replace(/\*\*([^*\n]+?)\*\*/g, '*$1*');

// Limite de Meta para el cuerpo de un mensaje interactivo.
const LIMITE_INTERACTIVO = 1024;

// PROTEGIDO: la rama del carrito no ejecuto `Config del negocio`.
let cfg = {};
try { cfg = $('Config del negocio').first().json ?? {}; } catch (e) { cfg = {}; }

return $input.all().map((i, idx) => {
  const j = i.json;
  const respuesta = NEGRITA_MD(j.respuesta ?? '');
  const numero = String(j.numeroDueno || cfg.numeroDueno || '').replace(/\D/g, '');
  const negocio = j.nombreNegocio || cfg.nombreNegocio || 'el negocio';
  const avisos = Array.isArray(j.avisos) ? [...j.avisos] : [];

  const pedido = numero !== '' && respuesta.trim() !== ''
    && (j.transferir === true || j.falloModelo === true || j.respuestaVacia === true);
  let conBoton = pedido;
  if (conBoton && respuesta.length > LIMITE_INTERACTIVO) {
    conBoton = false;
    avisos.push('boton_perdido_por_largo');
  }

  const enlace = 'https://wa.me/' + numero;
  const from = String(j.from ?? '');
  return {
    json: {
      ...j,
      respuesta,
      avisos,
      conBoton,
      numeroDueno: numero,
      nombreNegocio: negocio,
      phoneNumberId: j.phoneNumberId || cfg.phoneNumberId || '',
      waGraphVersion: j.waGraphVersion || cfg.waGraphVersion || '',
      // Lo que sale si NO hay boton, o si Meta lo rechaza: el mismo texto, con
      // el enlace dentro cuando el boton estaba pedido.
      textoParaTexto: pedido ? respuesta + '\n\nEscríbele directo a ' + negocio + ': ' + enlace : respuesta,
      cuerpoBoton: conBoton ? {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: from,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: respuesta },
          // El texto del boton tiene un maximo de 20 caracteres (Meta).
          action: { name: 'cta_url', parameters: {
            display_text: 'Escribir al negocio',
            url: enlace + '?text=' + encodeURIComponent('Hola, escribo desde el asistente de ' + negocio + '.'),
          } },
        },
      } : undefined,
    },
    pairedItem: { item: idx },
  };
});
