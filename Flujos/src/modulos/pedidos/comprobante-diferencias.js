// COMPROBANTE CON DIFERENCIAS (módulo común de Pedidos; 24/11/2026): el texto al cliente cuando un comprobante llegó pero no coincide. Función pura sin dependencias; sin nombres de cliente.
// El texto al cliente cuando un comprobante LLEGÓ pero no coincide con su pedido (Andres, 24/11/2026, D3): se le dicen TODAS las diferencias (`dif`: la lista de `cdDiferenciaParaElTexto`, o un texto, o '') y el caso PASA A RECEPCIÓN
// (aviso + botón) en lugar de pedirle otro comprobante. `salio`: true (el aviso a recepción salió con un `wamid` real), 'repetido' (recepción ya recibió uno hace menos de 30 minutos) o false (no salió: se le dice y se le da el botón).
// Nunca dice «acreditado», «verificado» ni «recibimos tu pago»: solo que llegó y qué no coincide. `usted`: el trato del comercio. Sin nombres de cliente ni de comercio.
function cdTextoComprobanteConDiferencias(dif, salio, usted) {
  const f = (Array.isArray(dif) ? dif : (dif ? [dif] : [])).filter((x) => typeof x === 'string' && x !== '');
  const lista = f.length > 1 ? f.slice(0, -1).join(', ') + ' y ' + f[f.length - 1] : (f[0] || '');
  const cabeza = f.length > 1 ? 'Recibí tu comprobante. Veo estas diferencias con tu pedido: ' + lista + '.'
    : (f.length === 1 ? 'Recibí tu comprobante. Veo una diferencia con tu pedido: ' + lista + '.' : 'Recibí tu comprobante. Veo diferencias con tu pedido.');
  const cola = salio === true ? 'Ya lo pasé a recepción para que lo revise; también puedes escribirle con el botón.'
    : (salio === 'repetido' ? 'Recepción ya recibió mi aviso anterior; también puedes escribirle con el botón.' : 'No pude avisar a recepción; escríbele directo con el botón.');
  const t = cabeza + ' ' + cola;
  if (usted !== true) return t;
  return t.replace(/\btus\b/g, 'sus').replace(/\btu\b/g, 'su').replace(/\bpuedes\b/g, 'puede').replace(/\bescríbele\b/g, 'escríbale');
}
