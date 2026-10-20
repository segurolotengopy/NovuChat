// ARMAR MENSAJES (PR-A, esqueleto): lo que sale al cliente. UN ÍTEM POR MENSAJE, cada uno con su destinatario, su `payload` de la Cloud API, su texto de respaldo y si se reporta; o ninguno.
//
// MENSAJES POR TURNO: uno al cliente o ninguno. CERO agregados. En PR-A el único texto es el que decidió «Decidir turno» (la puerta cerrada o el texto cortés fijo).
//
// LA FICHA SE ESCRIBE AQUÍ, siempre con la clave `messages[0].from`: solo recuerda el id del mensaje de Meta que se acaba de atender, para que un reenvío no se procese dos veces.
const cfg = cnCfg();
const t = cnPrimero('Normalizar entrada') || {};
const d = cnPrimero('Decidir turno') || {};
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
const prueba = cfg.modoPrueba === true;
const telPrueba = String(cfg.telefonoDePrueba || '');

const mensajes = [];
if (d.responder === true && String(d.texto || '').trim() !== '') {
  const tx = String(d.texto);
  mensajes.push(cmMensaje('cliente', cmTexto(tx), tx, tx, { tipoReporte: 'text', evento: '' }));
}

// ============================================ LA FICHA: un solo lugar, al final del turno
const claveOk = cnClaveValida(from);
if (claveOk) {
  const fichas = cnMapaDeFichas(true);
  const nueva = raFichaVigente(cnFichaDe(fichas.mapa, from), ahora);
  raRecordarIds(nueva, [t.mensajeId]);
  nueva.ultimoMs = ahora;
  fichas.mapa[from] = nueva;
  // Primero se escribe y después se barre: así el total nunca pasa del tope (5.000), contando esta ficha.
  raBarrer(fichas.mapa, ahora);
}

const salida = [];
for (const m of mensajes) {
  // En modo prueba TODO va al teléfono de prueba.
  const numero = prueba ? telPrueba : from;
  if (!numero) continue;
  const p = m.payload;
  p.to = numero;
  salida.push({ json: {
    para: numero, destino: m.para, payload: p, texto: m.texto, respaldo: m.respaldo || m.texto,
    tipoReporte: m.tipoReporte || null, evento: m.evento || '', esInteractivo: p.type === 'interactive',
    // Solo lo que sale al cliente se reporta; en modo prueba, nada.
    reportar: !prueba && m.para === 'cliente' && !!m.tipoReporte,
    phoneNumberId: cfg.phoneNumberId, waGraphVersion: cfg.waGraphVersion || 'v26.0', from: from, sinMensajes: false,
  } });
}
const resumen = { plan: String(d.ruta || 'nada'), mensajes: salida.length, llamadasModelo: 0 };
if (!salida.length) {
  return [{ json: { sinMensajes: true, para: '', payload: null, texto: '', respaldo: '', reportar: false, from: from, plan: resumen.plan, resumen: resumen } }];
}
salida[0].json.resumen = resumen;
return salida;
