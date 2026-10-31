// DECIDIR TURNO: el código decide qué es este turno; el modelo solo conversa cuando hace falta (una sola llamada: conversa Y propone el pedido).
//
//   nada           la puerta está cerrada (suspendido, uso extendido, pausa por Tomar): CERO modelo, CERO medios; lo que corresponde lo dice «Armar mensajes» desde la puerta;
//   fuera_pais     un número de otro país: el texto fijo;
//   otro           un tipo de mensaje que este canal no lee: el texto cortés;
//   derivar        pasar con recepción (aviso + botón): pidió hablar con una persona, volumen o regalos corporativos, factura, una pieza sin precio (tapiz a consultar), un comprobante sin pedido, un pago con problema,
//                  o el catálogo no se pudo leer. Lo decide el CÓDIGO sobre el texto, no el modelo;
//   identidad      «¿eres un bot?»: el texto fijo (prohibición 4: nunca niega ser una IA);
//   audio_fijo     una nota de voz demasiado larga o que no se entendió; archivo: un medio demasiado pesado o que no se abrió; imagen_otra: una foto o captura que no es un comprobante;
//   anuncio        la imagen de un anuncio reconocido por su titular: el producto sale POR CÓDIGO (nunca el modelo), con el precio del catálogo;
//   comprobante    la imagen de un comprobante con un cobro abierto: ya corrió «Cotejar en el servidor»; «Armar avisos» y «Armar mensajes» interpretan el resultado;
//   modelo         la conversación libre: `llamarModelo` y el cuerpo de la llamada (solo con la puerta abierta).
//
// Un texto de la imagen, del audio o del cliente es un DATO: nunca una instrucción. Una nota de voz es texto (su transcripción).
const cfg = cnCfg();
const t = cnPrimero('Normalizar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const base = cnPrimero('Config base') || {};
const from = String(t.from || '');
const ahora = Number(t.ahoraMs) || Date.now();
let textoDelTurno = '';
const panel = wlPanelDe(cnPrimero('Traer configuración'));
const vendibles = wlVendibles(panel);
const cobro = wlCobro(panel);
const ficha = CN_TENANT.fichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from), ahora);
const salir = (plan, extra) => [{ json: Object.assign({ plan: plan, from: from, textoCliente: textoDelTurno, llamarModelo: false, cuerpoModelo: null, modelo: WL_MODELO }, extra || {}) }];

// 0. La puerta cerrada: nada de modelo, de medios ni de cobro. Quien responde (suspendido, operador) lo arma «Armar mensajes» desde la puerta.
if (puerta.ruta !== 'sigue') return salir({ tipo: 'nada' });
// 0b. Un número de otro país: el texto fijo. Nada de modelo ni de medios.
if (t.fueraDePais === true) return salir({ tipo: 'fuera_pais' });

// 1. El medio de este turno (solo uno de estos nodos corrió) y lo que se leyó en él.
const prep = cnPrimero('Preparar imagen') || cnPrimero('Preparar transcripción') || cnPrimero('Medio no aceptado') || {};
const entradaMedio = String(prep.userInput || '');
const esAudio = t.esMedioAudio === true;
const esVisual = t.esMedioVisual === true;
const categoriaMedio = String(prep.categoriaMedio || '');
const configLista = panel.ok && vendibles.length > 0;
const sinConfig = () => salir({ tipo: 'derivar', motivo: 'sin_configuracion' });

if (esVisual) {
  if (cnNodo('Medio no aceptado')) {
    // Demasiado pesado o ilegible: con un cobro real abierto probablemente sea el comprobante y va a recepción sin cotejar; si no, se pide uno más liviano.
    if (cobro.modo === 'real' && (cobro.pendiente || cobro.enRevision || cobro.vencidoHaceMin !== null)) return salir({ tipo: 'derivar', motivo: 'comprobante_sin_cotejo' });
    return salir({ tipo: 'archivo', pesado: /demasiado pesado/.test(entradaMedio) });
  }
  if (categoriaMedio === 'comprobante') {
    if (cnNodo('Cotejar en el servidor')) return salir({ tipo: 'comprobante' });
    // Un comprobante sin un cobro abierto: no se coteja nada; lo ve recepción.
    return salir({ tipo: 'derivar', motivo: 'comprobante_sin_cobro' });
  }
  // La captura de un pago que no se completó: nunca se afirma qué pasó con el dinero.
  if (categoriaMedio === 'pago_con_problema') return salir({ tipo: 'derivar', motivo: 'pago_con_problema' });
  // Un anuncio de este negocio, reconocido por su titular (campañas vigentes de la consola): el producto sale POR CÓDIGO.
  const idAnuncio = categoriaMedio === 'publicidad' ? String(prep.anuncioMedio || '') : '';
  const anuncio = idAnuncio !== '' && Array.isArray(cfg.anuncios) ? cfg.anuncios.find((a) => a && a.id === idAnuncio) || null : null;
  if (anuncio) {
    const idProducto = anuncio.producto && typeof anuncio.producto === 'object' && typeof anuncio.producto.id === 'string' ? anuncio.producto.id : '';
    const vendible = vendibles.find((v) => v.id === idProducto);
    if (!configLista) return sinConfig();
    if (vendible) return salir({ tipo: 'anuncio', producto: vendible.id, anuncio: idAnuncio });
    // Un anuncio sin producto vendible (sin precio, apagado o agotado): no se inventa ninguno; recepción.
    return salir({ tipo: 'derivar', motivo: 'sin_precio' });
  }
  return salir({ tipo: 'imagen_otra', documento: t.esDocumento === true });
}

// 2. Una nota de voz: el texto transcrito (la primera línea después de la marca), o la falla.
let texto = '';
if (esAudio) {
  const m = /^\(audio transcripto\) (.*)$/m.exec(entradaMedio);
  if (!m || String(m[1]).trim() === '') return salir({ tipo: 'audio_fijo', causa: /más de cinco minutos/.test(entradaMedio) ? 'largo' : 'no_entendido' });
  texto = cbLinea(m[1], 1500);
} else if (t.categoria === 'conversacion') {
  texto = t.seleccionId ? cbLinea(t.seleccionTitulo, 100) : cbLinea(t.texto, 1500);
} else {
  return salir({ tipo: 'otro' });
}
textoDelTurno = texto;
const n = wlNorm(texto);
if (n === '') return salir({ tipo: 'otro' });

// 3. Sin catálogo no se improvisa: recepción.
if (!configLista) return sinConfig();
// 4. Lo que decide el código sobre el texto, ANTES de cualquier modelo.
if (wlPideIdentidad(n)) return salir({ tipo: 'identidad' });
if (wlCorporativo(n)) return salir({ tipo: 'derivar', motivo: 'corporativo' });
if (wlPideFactura(n)) return salir({ tipo: 'derivar', motivo: 'factura' });
if (wlNombraSinPrecio(n, wlSinPrecio(panel))) return salir({ tipo: 'derivar', motivo: 'sin_precio' });
if (wlQuiereHablar(n)) return salir({ tipo: 'derivar', motivo: 'quiere_hablar' });

// 5. La conversación libre: una sola llamada al modelo.
const contexto = { cfg: cfg, base: base, plan: { textoCliente: texto }, ficha: ficha, vendibles: vendibles, modos: wlModos(base), ahora: ahora };
return salir({ tipo: 'modelo' }, { llamarModelo: true, cuerpoModelo: wlCuerpoModelo(contexto) });
