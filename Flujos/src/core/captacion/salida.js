// SALIDA: la ultima compuerta. TODO lo que sale al cliente pasa por aca, venga
// del traspaso a un asesor, del corte, del aviso de comercio no operativo o del
// agente. Arma los cuerpos listos para enviar y guardar:
//
//   cuerpoMeta      el mensaje al cliente (interactivo o texto)
//   cuerpoRespaldo  el mismo en texto plano, por si Meta rechaza el interactivo
//   cuerpoAviso     la plantilla del aviso interno, si corresponde
//   cuerpoCrm       el registro del prospecto para un CRM propio (`crmUrl`)
//   filaPlanilla    la fila del prospecto para la planilla de Google
//
// MENSAJES POR TURNO: UNO al cliente (o su respaldo si el primero fallo,
// nunca los dos), salvo con el telefono BLOQUEADO por el servidor, que no
// recibe nada (`responder: false`). El aviso interno es una plantilla utility
// aparte: +1 por prospecto que pasa a un asesor -- el boton o un cierre --, una
// vez por conversacion, y +1 por cada umbral que el servidor marca. El CRM y la
// planilla no mandan ningun mensaje.
//
// Que el mensaje SALIO no lo decide este nodo: lo decide `Confirmar envio`, al
// final, con lo que contesto Meta. Solo eso se reporta y se da por hecho.
// El largo del cuerpo interactivo (1024) esta escrito UNA sola vez en el flujo:
// `limiteInteractivo` de `Config base`, validado en `Config del negocio`. Aca
// solo se lee, porque quien compacta para que el boton sobreviva es `Procesar
// respuesta` y tiene que usar el mismo numero. Un item que no venga de la
// configuracion no trae el dato: entonces no se degrada por largo y queda la
// red de `¿Fallo el interactivo?`.
const LIMITE_TEXTO = 4096;         // cuerpo de un mensaje de texto (Meta)

// Una variable de plantilla no admite saltos de linea, tabuladores ni mas de
// cuatro espacios seguidos, y no puede ir vacia: Meta rechaza el envio entero.
const variable = (v, max = 60) => {
  const t = String(v ?? '').replace(/[\r\n\t]+/g, ' · ').replace(/\s{2,}/g, ' ').trim();
  return (t || 'no indicado').slice(0, max);
};
// LA PLANILLA DE PROSPECTOS (Andres, 27/09/2026). Hasta esa fecha el
// prospecto solo se guardaba si `crmUrl` apuntaba a un CRM https, que nunca
// existio: no se guardo nada. Ahora, ademas, la hoja «Leads_CRM» de una
// planilla de Google. Aca solo se entregan los DATOS del prospecto
// (`prospectoPlanilla`); que columna recibe cada uno, las listas de la planilla
// y la regla de «agregar o actualizar» viven en `Decidir fila de la planilla`,
// y en ningun otro lado.
const celda = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 200);

const texto = (to, cuerpo) => ({
  messaging_product: 'whatsapp', recipient_type: 'individual', to,
  type: 'text', text: { preview_url: false, body: String(cuerpo).slice(0, LIMITE_TEXTO) },
});

return $input.all().map((it, i) => {
  const e = it.json;
  const responder = e.responder !== false;
  const respuesta = String(e.respuesta ?? '').trim()
    || 'Disculpa, no pude generar la respuesta. ¿Me lo repites?';
  const textoRespaldo = String(e.textoRespaldo ?? respuesta).trim() || respuesta;

  // Un interactivo con el cuerpo demasiado largo lo rechaza Meta: se manda
  // directo como texto, con el enlace adentro. Mejor eso que un envio fallido.
  //
  // PERDER EL BOTON NO PASA EN SILENCIO. Es la unica salida hacia una persona,
  // asi que la degradacion queda anotada en los avisos del turno (se ve con
  // `scripts/ver-ejecuciones.sh`). Llegar aca con un mensaje demasiado largo es
  // un caso extremo: `Procesar respuesta` ya intento compactarlo.
  const avisos = Array.isArray(e.avisos) ? [...e.avisos] : [];
  const limiteInteractivo = Number(e.limiteInteractivo) > 0 ? Number(e.limiteInteractivo) : 0;
  let cuerpoMeta = e.cuerpoMeta && e.cuerpoMeta.type === 'interactive' ? e.cuerpoMeta : null;
  if (cuerpoMeta && limiteInteractivo
    && String(cuerpoMeta.interactive?.body?.text ?? '').length > limiteInteractivo) {
    cuerpoMeta = null;
    if (!avisos.includes('boton_perdido_por_largo')) avisos.push('boton_perdido_por_largo');
  }
  const esInteractivo = cuerpoMeta !== null;
  const cuerpoRespaldo = texto(e.from, textoRespaldo);
  // Sin interactivo: si la rama traia uno y hubo que bajarlo a texto, va el
  // respaldo -- que lleva el enlace adentro --; si nunca lo trajo, la respuesta.
  const enviado = esInteractivo ? respuesta : (e.cuerpoMeta ? textoRespaldo : respuesta);
  if (!cuerpoMeta) cuerpoMeta = texto(e.from, enviado);

  // Solo los campos del prospecto: un NIT guardado antes del 15/09 no sale.
  const bruto = e.lead ?? e.leadConocido ?? {};
  const lead = Object.fromEntries(['empresa', 'contacto', 'rubro', 'flujos', 'personalizacion', 'consulta']
    .filter((k) => bruto[k]).map((k) => [k, bruto[k]]));
  const recepcion = String(e.numeroRecepcion || '').replace(/\D/g, '');
  // A NADIE SE LE AVISA DE SU PROPIO MENSAJE (misma regla que el Demo B, #68):
  // si quien escribe es el propio numero de recepcion -- una persona de NovuChat
  // probando desde su telefono --, el aviso seria un mensaje pagado que no le
  // dice nada nuevo. En produccion los numeros difieren y no cambia nada.
  const esElMismo = recepcion !== '' && recepcion === String(e.from ?? '').replace(/\D/g, '');
  const cuerpoAviso = e.avisar === true && recepcion && !esElMismo ? {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: recepcion,
    type: 'template',
    template: {
      name: e.plantillaAviso || 'solicitud_contacto',
      language: { code: 'es' },
      components: [{ type: 'body', parameters: [
        e.estadoAviso, lead.empresa, lead.contacto || e.nombrePerfil,
        lead.rubro, lead.flujos, String(e.from ?? '').replace(/\D/g, ''),
      ].map((v) => ({ type: 'text', text: variable(v) })) }],
    },
  } : null;

  const crmUrl = String(e.crmUrl ?? '').trim();
  const guardar = /^https:\/\//.test(crmUrl) && (e.guardarLead === true || e.primeraVez === true);
  const cuerpoCrm = guardar ? {
    origen: 'whatsapp',
    telefono: String(e.from ?? ''),
    nombrePerfil: String(e.nombrePerfil ?? ''),
    estado: e.estadoLead || 'en_conversacion',
    ...lead,
    ...(e.anuncio ? { anuncio: e.anuncio } : {}),
    fecha: new Date().toISOString(),
  } : null;

  // LA PLANILLA: con su id en `Config base` (`Config del negocio` lo deja vacio
  // si no es valido, y pone la hoja «Leads_CRM» si no viene otra), y cuando la
  // ficha cambio -- el mismo criterio que el CRM --. Sin id no se intenta:
  // `Prospecto para la planilla` no deja pasar nada y Google ni se consulta.
  const planillaId = String(e.planillaProspectosId ?? '').trim();
  const planillaHoja = String(e.planillaProspectosHoja ?? '').trim();
  const guardarPlanilla = planillaId !== '' && !/^REEMPLAZAR_/.test(planillaId)
    && planillaHoja !== '' && !/^REEMPLAZAR_/.test(planillaHoja)
    && (e.guardarLead === true || e.primeraVez === true)
    // Quien ya es cliente no entra a la planilla como prospecto nuevo.
    && e.pideSoporte !== true && e.soporteEnVentana !== true;

  return { json: {
    from: e.from,
    phoneNumberId: e.phoneNumberId,
    waGraphVersion: e.waGraphVersion || 'v26.0',
    nombrePerfil: e.nombrePerfil,
    accion: e.accion ?? (e.comercioSuspendido ? 'comercio_no_operativo' : ''),
    responder,
    respuesta: responder ? String(enviado).slice(0, LIMITE_TEXTO) : '',
    // Lo que se reporta si sale el respaldo: `Confirmar envio` no abre cuerpos.
    respuestaRespaldo: responder ? String(textoRespaldo).slice(0, LIMITE_TEXTO) : '',
    esInteractivo,
    cuerpoMeta,
    cuerpoRespaldo,
    avisar: cuerpoAviso !== null,
    cuerpoAviso,
    guardar,
    crmUrl,
    cuerpoCrm,
    guardarPlanilla,
    prospectoPlanilla: guardarPlanilla ? {
      telefono: String(e.from ?? '').replace(/\D/g, ''),
      nombre: celda(lead.contacto || e.nombrePerfil),
      empresa: celda(lead.empresa),
      rubro: celda(lead.rubro),
      flujos: celda(lead.flujos),
      consulta: celda(lead.consulta),
      estado: e.estadoLead || 'en_conversacion',
      anuncio: !!(e.anuncio || e.anuncioConocido),
    } : null,
    avisos,
  }, pairedItem: { item: i } };
});
