// INTERPRETAR LECTURA: lo que leyó el modelo en el comprobante, como DATO (envoltorio de `cbLectura`).
//
// Llega la salida del nodo de Gemini (`Leer comprobante (imagen)` o `(PDF)`) y sale, por cada item, lo que
// necesita `Cotejar en el servidor`: `{telefono, legible, leido, idMeta}`. Lo demás que lleva el item
// (`mediaId`, `pedidoRef`, `from`, `nombrePerfil`, `phoneNumberId`) es para el cierre y para los nodos de
// después: la imagen NO se reenvía a nadie (no hay plantilla con imagen), se guarda su `mediaId` y la
// referencia del pedido.
//
// QUIÉN ES QUIÉN sale SIEMPRE de `Interpretar entrada` (el teléfono, el id del mensaje y el del medio), nunca
// del JSON del modelo: un comprobante que dijera `{"telefono": "..."}` no cambia de quién es. Y la lectura
// sale de `cbLectura`: seis campos de texto corto y `legible`. Ninguna otra clave del JSON pasa, y el texto
// que figure en la imagen es un dato que viaja al servidor y se compara; nunca una instrucción.
//
// ESTE NODO NO COMPARA NADA. Compara el servidor (`cotejarComprobante`) contra el total que se cotizó al
// mandar el QR y las cuentas del QR del comercio, que el flujo ni conoce ni necesita conocer.
{
  const entradas = cbNodoTodos('Interpretar entrada');
  const cfg = cbNodoPrimero('Config del negocio') || {};
  const cobro = cfg.cobro && typeof cfg.cobro === 'object' ? cfg.cobro : {};
  const items = $input.all();
  const salida = [];
  for (let i = 0; i < items.length; i++) {
    const t = entradas[i] || entradas[entradas.length - 1];
    // Sin el mensaje de origen no hay a quién atribuirle el comprobante: no se coteja nada.
    if (!t || !t.from) continue;
    const lectura = cbLectura(items[i].json);
    salida.push({
      json: {
        telefono: String(t.from),
        legible: lectura.legible,
        leido: lectura.leido,
        idMeta: String(t.mensajeId || ''),
        mediaId: String(t.mediaId || ''),
        pedidoRef: String(cobro.pedidoRef || ''),
        from: String(t.from),
        nombrePerfil: String(t.nombrePerfil || ''),
        phoneNumberId: String(t.phoneNumberId || ''),
      },
      pairedItem: { item: i },
    });
  }
  return salida;
}
