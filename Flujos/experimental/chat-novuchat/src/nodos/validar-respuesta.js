// VALIDAR RESPUESTA: lo que el modelo escribió NO sale sin pasar por aquí. Lee la respuesta de «Llamar al modelo», valida cada campo (el JSON, el rubro, la necesidad, el nombre y la
// empresa contra lo que el cliente escribió) y valida el MENSAJE (`chValidarMensaje`): contenido mínimo, cierre con pregunta o con la invitación a elegir, nada de identidad falsa,
// promesas, ofertas, montos o cifras fuera de las permitidas, sistemas ajenos, validar pagos con el banco, nombres de personas, ni prometer lo que solo hacen los botones.
//
// Si el mensaje viola una guardia, hay UN reintento: este nodo arma el pedido con la CAUSA (de una lista cerrada, nunca el texto del cliente) y «¿Reintentar?» lo manda a
// «Reintentar el modelo». Un fallo de la llamada (sin respuesta) no se reintenta: «Armar mensajes» sale con el texto de respaldo del contexto.
const turno = cnPrimero('Armar turno') || {};
const cfg = cnCfg();
const t = cnPrimero('Interpretar entrada') || {};
const f = chFichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, t.from), t.ahoraMs);
const entrada = $input.first();
const r = chRevisarModelo((entrada && entrada.json) || {}, chValidacion({ cfg: cfg, plan: turno.plan, eventos: turno.eventos || [], precios: turno.precios === true, ficha: f }));
const reintentar = chReintentable(r.causa);
const cuerpoReintento = reintentar
  ? chCuerpoModelo({ cfg: cfg, ficha: f, eventos: turno.eventos || [], contexto: turno.plan.contexto, ahoraMs: t.ahoraMs, precios: turno.precios === true, reintento: r.causa })
  : null;
return [{ json: { reintentar: reintentar, cuerpoReintento: cuerpoReintento, modelo: turno.modelo, causa: r.causa, primero: r } }];
