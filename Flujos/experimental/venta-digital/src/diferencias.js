// =============================================================================
// TODAS LAS DIFERENCIAS DE UN COMPROBANTE (prefijo `cd` / `CD_`) — base común de las ventas digitales
// =============================================================================
// Condición general del sistema (Andres, 07/11/2026): un comprobante que no cuadra le dice al cliente TODAS sus diferencias —el destinatario primero—, no solo la primera.
// El servidor (`cotejarComprobanteVenta`) devuelve `motivos[]` (códigos fijos, aditivo; `motivo` sigue siendo el primario). Este módulo los vuelve frases FIJAS para el cliente: lo leído de la imagen (un nombre,
// una cuenta) NUNCA se copia; solo pasan dos números (monto leído y monto del pedido) que el servidor ya tradujo.
//
// Va DESPUÉS de `cobro.js` en la lista de librerías de cada flujo: usa `CB_FRASE_DEL_MOTIVO` y `cbDiferencia`, y no cambia ninguna de sus declaraciones (las de `cobro.js` están fijadas por hash contra su origen).
// JavaScript plano: sin `import`/`export`, `require`, `URL`, `Buffer` ni `crypto`, sin red y sin reloj (el nodo Code de n8n no los tiene). Nada de textos de un negocio.

// El orden en que se le dicen al cliente: primero el destinatario (cuenta, nombre o destino), luego el monto, luego la fecha.
function cdGrupoDeMotivo(m) {
  if (/^(cuenta_distinta|nombre_distinto|destino_no_coincide|destino_no_verificable)$/.test(m)) return 0;
  if (/^monto_(menor|mayor|distinto)$/.test(m)) return 1;
  if (/^fecha_(anterior|posterior)$/.test(m)) return 2;
  return 3;
}

// Los motivos de un cuerpo de respuesta del cotejo a las frases en la forma que reconoce `cbDiferencia`, sin repetidos y en el orden de lectura. Un código desconocido se descarta.
// El monto solo se dice con sus dos números (si faltan, no hay frase de monto).
function cdFrasesDeMotivos(cuerpo) {
  const c = cuerpo && typeof cuerpo === 'object' ? cuerpo : {};
  const ms = Array.isArray(c.motivos) ? c.motivos.filter((m) => typeof m === 'string') : [];
  const leido = typeof c.montoLeido === 'number' && Number.isFinite(c.montoLeido) && c.montoLeido > 0 ? c.montoLeido : null;
  const pedido = typeof c.importe === 'number' && Number.isFinite(c.importe) && c.importe > 0 ? c.importe : null;
  const ordenados = ms.map((m, i) => ({ m: m, i: i })).sort((a, b) => cdGrupoDeMotivo(a.m) - cdGrupoDeMotivo(b.m) || a.i - b.i).map((x) => x.m);
  const frases = [];
  for (let i = 0; i < ordenados.length; i++) {
    const m = ordenados[i];
    let f = '';
    if (/^monto_(menor|mayor|distinto)$/.test(m)) f = leido !== null && pedido !== null ? 'El comprobante dice ' + leido + ' y el pedido es de ' + pedido : 'El monto del comprobante no coincide';
    else if (Object.prototype.hasOwnProperty.call(CB_FRASE_DEL_MOTIVO, m)) f = CB_FRASE_DEL_MOTIVO[m];
    if (f !== '' && frases.indexOf(f) < 0) frases.push(f);
  }
  return frases;
}

// TODAS las diferencias que se le dicen al cliente, como frases fijas (`cbDiferencia` las traduce). Con el cuerpo del cotejo (`cbCuerpoDe(resp).cuerpo`): si trae `motivos[]` con MÁS de una frase que decir,
// la lista completa; si no (un servidor que aún no lo manda, un repetido, una sola diferencia), [] y el flujo sigue con la única de siempre (`cbDiferencia(r.diferencias, moneda)`).
function cdDiferenciasDe(cuerpo, moneda) {
  const frases = [];
  const crudas = cdFrasesDeMotivos(cuerpo);
  for (let i = 0; i < crudas.length; i++) {
    // Sin los dos montos (el servidor no los trajo) el monto se dice sin cifras: frase fija, nada leído.
    const f = crudas[i] === 'El monto del comprobante no coincide' ? 'el monto del comprobante no coincide con tu pedido' : cbDiferencia([crudas[i]], moneda);
    if (f !== '' && frases.indexOf(f) < 0) frases.push(f);
  }
  return frases.length > 1 ? frases : [];
}

// La diferencia para el texto: la lista (varias) o la de siempre (una, o ninguna → '').
function cdDiferenciaParaElTexto(cuerpo, r, moneda) {
  const varias = cdDiferenciasDe(cuerpo, moneda);
  return varias.length > 1 ? varias : cbDiferencia(r.diferencias, moneda);
}

// El tramo del mensaje al cliente: «una diferencia con tu compra: X» o «varias diferencias con tu compra: a, b y c» (`conCompra === false`: sin «con tu compra»). Acepta un texto (una) o una lista.
function cdFraseDeDiferencias(diferencia, conCompra) {
  const con = conCompra === false ? '' : ' con tu compra';
  const f = (Array.isArray(diferencia) ? diferencia : (diferencia ? [diferencia] : [])).filter((x) => typeof x === 'string' && x !== '');
  if (f.length > 1) return 'varias diferencias' + con + ': ' + f.slice(0, -1).join(', ') + ' y ' + f[f.length - 1];
  return 'una diferencia' + con + (f.length === 1 ? ': ' + f[0] : '');
}
