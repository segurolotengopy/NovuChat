// TRASPASO A UN ASESOR (guion de Silvana, paso 5): el cliente toco «Hablar con
// un asesor» -- o lo escribio --. SIN MODELO: el texto es fijo y la decision
// tambien. Es tambien la salida de quien ya es cliente y pide soporte: desde el
// 27/09/2026 esa persona recibe la respuesta del agente con este mismo boton.
//
// HACE TRES COSAS:
//  1. Le dice al cliente que sus datos pasaron al equipo y cuando le escriben:
//     «en horario de atencion (…)» si la consola tiene horario, «lo antes
//     posible» si no lo tiene. Nunca un horario de respaldo que nadie cumple.
//     Y EL MENSAJE SALE CON EL BOTON `cta_url` AL WHATSAPP DE UNA PERSONA
//     (`numeroRecepcion`, de la consola). Hasta el
//     22/09/2026 este mensaje solo prometia que un especialista escribiria:
//     el prospecto quedaba esperando, sin ninguna forma de escribir el. La
//     politica de NovuChat (CLAUDE.md, 21/09/2026) es que pasar con una
//     persona es SIEMPRE el aviso interno MAS el boton para escribirle
//     directo; sin el numero configurado no hay boton, y entonces el texto
//     tampoco invita a escribir. El boton VIAJA DENTRO DEL MISMO MENSAJE: no
//     cuesta un mensaje mas.
//  2. Avisa a recepcion con la plantilla, UNA vez por conversacion y con lo
//     que haya de los datos aunque falten: quien pide una persona no tiene que
//     completar un formulario antes. `Salida` no le avisa al propio numero de
//     recepcion (la misma regla del Demo B, #68). «Una vez» se cuenta sobre los
//     avisos que META ACEPTO (`c.avisado`, que escribe `Confirmar envio`): si la
//     plantilla fue rechazada -- estaba en revision el 15/09/2026 --, el proximo
//     toque vuelve a intentarlo. Un mensaje que Meta rechaza no se cobra.
//  3. Guarda el prospecto y deja la etapa en `cerrado`: el asistente sigue
//     respondiendo dudas, pero ya no pide datos.
//  4. SI FALTA ALGO DE LA FICHA, LO PIDE EN ESTE MISMO MENSAJE (22/09/2026).
//     Este flujo existe para captar: contacto, empresa y rubro. Quien tocaba
//     «Hablar con un asesor» antes de darlos se iba con la ficha a medias y el
//     especialista recibia un telefono y nada mas. No se le pone un formulario
//     delante -- pedir una persona no puede costar un tramite --: se avisa
//     igual, el boton sale igual, y la pregunta viaja DENTRO del mismo mensaje.
//     Contestarla es voluntario; si contesta, se registra como cualquier dato.
//
// MENSAJES: 1 al cliente (con el boton adentro), y 1 plantilla utility la
// primera vez. El cambio del 22/09 no agrega ninguno.
const EMOJI = /\p{Extended_Pictographic}\uFE0F?/gu;
function conEmojis(t, nivel) {
  if (nivel === 'muchos') return t;
  let quedo = false;
  return t.replace(EMOJI, (m) => {
    if (nivel !== 'ninguno' && !quedo) { quedo = true; return m; }
    return '';
  }).replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').trim();
}

const sd = $getWorkflowStaticData('global');
sd.conversaciones = sd.conversaciones ?? {};

return $input.all().map((it, i) => {
  const e = it.json;
  const negocio = e.nombreNegocio || 'NovuChat';
  const cuando = String(e.fraseContacto || '').trim() || 'lo antes posible';
  const c = sd.conversaciones[e.from];
  const lead = (c && c.lead) || e.leadConocido || {};

  // Lo que falta de la ficha, en el orden en que se pide. DESDE EL 03/10/2026
  // (Bloque 1) el nombre y la empresa ya no se piden al inicio: la empresa se
  // pide AQUI, dentro de este mensaje, y el nombre solo si el perfil de
  // WhatsApp no sirve (menos de dos letras: vacio o solo emojis).
  const ETIQUETA = { contacto: 'tu nombre', empresa: 'el nombre de tu empresa', rubro: 'a qué se dedica' };
  const letrasDelPerfil = (String(e.nombrePerfil || '').match(/\p{L}/gu) || []).length;
  const conoceElContacto = !!lead.contacto || letrasDelPerfil >= 2;
  const faltan = ['empresa', 'rubro', 'contacto'].filter((k) => (k === 'contacto' ? !conoceElContacto : !lead[k]));
  // A quien ya es cliente no se le piden datos de prospecto.
  const soporte = e.pideSoporte === true || e.soporteEnVentana === true || !!(c && c.soporte);
  const pedido = faltan.length && !soporte
    ? ' Para que llegue al grano, ¿me dices ' +
      (faltan.length === 1 ? ETIQUETA[faltan[0]]
        : faltan.slice(0, -1).map((k) => ETIQUETA[k]).join(', ') + ' y ' + ETIQUETA[faltan[faltan.length - 1]]) +
      '?'
    : '';
  // El numero de una persona. Sin el no hay boton, y el texto no promete nada
  // que no se pueda cumplir desde este mismo mensaje.
  const recepcion = String(e.numeroRecepcion || '').replace(/\D/g, '');
  const url = recepcion
    ? 'https://wa.me/' + recepcion + '?text=' +
      encodeURIComponent('Hola, escribo desde el WhatsApp de ' + negocio + '. Quiero hablar con un asesor.')
    : '';

  const texto = conEmojis('¡Anotado! 📋 Ya le pasé tus datos a nuestro equipo. Un asesor de ' +
    negocio + ' te escribirá a este mismo número ' + cuando +
    (url ? ', y si prefieres no esperar, toca el botón y escríbele ahora mismo.' : '.') +
    (pedido || ' ¡Que tengas un excelente día! ✨'),
    e.nivelEmojis);

  const avisar = !(c && c.avisado);
  if (c) c.etapa = 'cerrado';
  // Si se pidio un dato, la conversacion queda esperando esa respuesta, EN ESTE
  // ORDEN: `Estado de la conversacion` registra lo que conteste en el PRIMERO
  // (la empresa) y el rubro dicho en palabras tambien. Sin pedido (soporte) no
  // se espera nada.
  if (c && pedido) { c.pidio = faltan; c.pidioRubro = faltan.includes('rubro'); }
  // Pedir un asesor es un hecho de Alta (Bloque 1), salvo para quien ya es cliente: pedir
  // soporte no es interes de compra. Lo marca `Estado de la conversacion`; aca se asegura,
  // por si el item no pasara por el. Nunca se quita.
  const hechos = { pidioAsesor: !soporte, pidioPlanes: false, eligioOtro: false, respondioDolor: false,
    descarte: '', ...(e.hechos && typeof e.hechos === 'object' ? e.hechos : {}) };
  if (!soporte) hechos.pidioAsesor = true;
  if (c && !soporte) c.hechos = { ...(c.hechos || {}), pidioAsesor: true };

  return { json: { ...e,
    respuesta: texto,
    // El boton `cta_url` abre el WhatsApp de una persona. El texto del boton
    // tiene un maximo de 20 caracteres (Meta). Si `Salida` no puede mandar el
    // interactivo, `textoRespaldo` lleva el enlace adentro.
    cuerpoMeta: url ? {
      messaging_product: 'whatsapp', recipient_type: 'individual', to: e.from,
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: { text: texto },
        action: { name: 'cta_url', parameters: { display_text: 'Escribir ahora', url } },
      },
    } : undefined,
    textoRespaldo: url ? texto + '\n\nPara escribirle a una persona: ' + url : texto,
    lead,
    hechos,
    avisar,
    estadoAviso: 'pidió hablar con un asesor',
    guardarLead: true,
    estadoLead: 'cerrado',
  }, pairedItem: { item: i } };
});
