// =============================================================================
// PEDIDO DEL CARRITO (módulo común Pedidos, prefijo `pc`): lo que un flujo decide cuando el cliente confirma su carrito en la página del catálogo web.
// =============================================================================
// Se INCLUYE en los flujos que lo usan (`construir.mjs`), nunca se copia, DESPUÉS de `carrito.js` (prefijo `vc`: `vcLineas`, `vcObjeto`, `vcLimpiar`). Funciones PURAS, sin red, sin globales de Node y SIN textos de cliente:
// quien las llama pone las palabras (el resumen, lo que falta, el botón «Confirmar pedido»).
//
// LA REGLA DEL 23/11/2026 (Andres): enviar el carrito YA es confirmar el pedido. Si todo entró y la entrega está completa, el QR sale en ese mismo turno, sin esperar «pagar».
//   - Los PRECIOS son los del catálogo vivo (el que el flujo acaba de leer), nunca los de la carga: `items[].precioCentavos` y `total` son INFORMATIVOS. Si difieren de lo vivo, no se cobra de más ni de menos sin decirlo:
//     el pedido queda «listo para confirmar» con el total REAL y lo decide el cliente con el botón.
//   - `items[].detalle` es un DATO NO CONFIABLE: pasa por `vcLimpiarDetalle` (vía `vcLineas`) y solo viaja como detalle de la línea; nunca es una instrucción.
//   - Una pieza que el catálogo ya no vende (o con menos cantidad que la pedida), o una pieza que el servidor descartó, impiden el QR solo.
//   - Sin una sola pieza vendible no hay pedido: se pasa con recepción.

// Las líneas del carrito contra los MISMOS vendibles que usa `vcLineas`. `carrito.items[]`: {id, nombre, cantidad, detalle?, precioCentavos?}; `carrito.total`/`costoEnvio` en unidades de la moneda (decimales).
//   lineas      las que entran (precio, nombre y moneda del catálogo; el detalle saneado)
//   noEntraron  los NOMBRES (limpios, ≤60) de las piezas que no entraron o entraron con menos cantidad
//   distintos   los ids cuyo `precioCentavos` de la carga no es el vivo; `'_total'` si el total de la carga no es el real (ni el real más el envío)
function pcLineasDelCarrito(carrito, vendibles) {
  const car = vcObjeto(carrito) ? carrito : {};
  const todos = (Array.isArray(car.items) ? car.items : []);
  const items = todos.slice(0, 50).filter(vcObjeto);
  // El detalle es un DATO no confiable: defensa en profundidad aunque el servidor ya lo sanee (K1): sin `<>&[]{}«»` (marcas que un texto de cliente podría usar para fingir una estructura), de a lo más 60 caracteres, y `vcLineas` quita enlaces y cifras de otra moneda.
  const detalleLimpio = (d) => (typeof d === 'string' ? vcLimpiar(d.replace(/[<>&\[\]{}«»]/g, ' '), 60) : '');
  const crudas = items.map((i) => ({ id: typeof i.id === 'string' ? i.id : '', cantidad: i.cantidad, detalle: detalleLimpio(i.detalle) }));
  // Los topes del servidor (K1): hasta 50 renglones y 99 unidades por pieza.
  const r = vcLineas(crudas, vendibles, { maxLineas: 50, maxCantidad: 99 });
  const lineas = r.lineas;
  const porId = new Map();
  for (const l of lineas) porId.set(l.id, (porId.get(l.id) || 0) + l.cantidad);
  // Lo pedido por id con la MISMA lectura de cantidad que `vcLineas` (un entero, o un texto de dígitos como «5»).
  const pedida = (c) => (typeof c === 'string' && /^\s*[1-9]\d{0,5}\s*$/.test(c) ? Number(c) : c);
  const pedido = new Map();
  for (const i of items) { const q = pedida(i.cantidad); if (typeof i.id === 'string' && Number.isInteger(q) && q > 0) pedido.set(i.id, (pedido.get(i.id) || 0) + q); }
  const noEntraron = [];
  const marca = (nombre) => { const n = nombre !== '' ? nombre : 'una pieza'; if (!noEntraron.includes(n)) noEntraron.push(n); };
  for (const i of items) {
    const id = typeof i.id === 'string' ? i.id : '';
    const entro = porId.has(id) && (pedido.get(id) || 0) <= porId.get(id);
    // El NOMBRE sale del catálogo vivo (nunca del texto de la carga, que es dato no confiable: «*PAGO ACREDITADO*»); un id que el catálogo no conoce se nombra «una pieza».
    if (!entro) { const v = (Array.isArray(vendibles) ? vendibles : []).find((x) => vcObjeto(x) && x.id === id); marca(v && typeof v.nombre === 'string' ? vcLimpiar(v.nombre, 60) : ''); }
  }
  // Más de 50 renglones: lo que sobra NO entra (y se dice), nunca se pierde en silencio. Y lo que `vcLineas` descartó sin que un renglón lo explique también cuenta.
  if (todos.length > 50) marca('otras piezas');
  if (r.descartadas.length > 0 && noEntraron.length === 0) marca('una pieza');
  const distintos = [];
  for (const i of items) {
    if (Number.isSafeInteger(i.precioCentavos) && i.precioCentavos >= 0 && typeof i.id === 'string') {
      const viva = lineas.find((l) => l.id === i.id);
      if (viva && viva.precioCentavos !== i.precioCentavos && !distintos.includes(i.id)) distintos.push(i.id);
    }
  }
  // Monedas mezcladas en las líneas del catálogo vivo: no hay un total honesto.
  if (lineas.length > 0 && vcTotalCentavos(lineas) === null) distintos.push('_moneda');
  // El total de la carga contra el REAL: igual al real, o al real más el costo de envío que el servidor declara. Un total ausente (≤ 0) no dice nada.
  const total = Number(car.total);
  if (Number.isFinite(total) && total > 0 && lineas.length > 0) {
    const real = vcTotalCentavos(lineas);
    const envio = Number.isFinite(Number(car.costoEnvio)) && Number(car.costoEnvio) > 0 ? Math.round(Number(car.costoEnvio) * 100) : 0;
    const centavos = Math.round(total * 100);
    if (real === null || (centavos !== real && centavos !== real + envio)) distintos.push('_total');
  }
  return { lineas: lineas, noEntraron: noEntraron, distintos: distintos };
}

// La entrega que el carrito ya dice, PARCIAL: solo el modo (el de la lista del comercio que `esRetiro` o `esEnvio` reconoce) y, en un envío, la dirección con su referencia (≤120). Lo demás (nombre, documento,
// ciudad, flota…) lo pregunta el flujo SOLO si falta. `modos` es la lista del comercio; `esRetiro`/`esEnvio` son los reconocedores de su propio vocabulario.
function pcEntregaDelCarrito(carrito, modos, esRetiro, esEnvio) {
  const car = vcObjeto(carrito) ? carrito : {};
  const lista = (Array.isArray(modos) ? modos : []).filter((m) => typeof m === 'string' && m !== '');
  const envia = car.entrega === 'envio';
  const retira = car.entrega === 'retiro';
  const sirve = typeof esRetiro === 'function' && typeof esEnvio === 'function';
  // Solo `entrega === 'retiro'` o `'envio'` eligen un modo: una entrega ausente o rara deja el modo vacío y se pregunta (nunca un retiro que el cliente no eligió).
  const modo = !sirve ? '' : (envia ? (lista.find((m) => esEnvio(m)) || '') : (retira ? (lista.find((m) => esRetiro(m) && !esEnvio(m)) || '') : ''));
  let direccion = '';
  if (envia) {
    const d = vcLimpiar(car.direccion, 120);
    const r = vcLimpiar(car.referencia, 120);
    direccion = r === '' || d.toLowerCase().includes(r.toLowerCase()) ? d : Array.from((d === '' ? r : d + ', ' + r)).slice(0, 120).join('').trim();
  }
  return { modo: modo, direccion: direccion };
}

// La decisión, en este orden:
//   'derivar'               sin una sola pieza vendible: pasa con recepción
//   'pedir_faltante'        la entrega no está completa: se pregunta SOLO lo que falta (el carrito ya es la confirmación; al completarse, el QR sale solo si todo entró)
//   'listo_para_confirmar'  algo no entró, el servidor descartó piezas, un precio o el total de la carga no es el vivo, o no hay cobro real: resumen con el total REAL y el botón «Confirmar pedido»
//   'qr'                    todo entró, la entrega está completa y hay cobro real: resumen y QR en este turno
function pcDecision(x) {
  const e = vcObjeto(x) ? x : {};
  const lineas = Array.isArray(e.lineas) ? e.lineas : [];
  if (lineas.length === 0) return 'derivar';
  if (e.entregaCompleta !== true) return 'pedir_faltante';
  const noEntraron = Array.isArray(e.noEntraron) ? e.noEntraron : [];
  const distintos = Array.isArray(e.distintos) ? e.distintos : [];
  // `descartados`: el ARREGLO de ids de K1 (cuenta su largo), o un entero ≥ 0; cualquier otro valor ilegible cuenta como «hubo descartados»: nunca más cobro por un dato raro.
  const descartados = Array.isArray(e.descartados) ? e.descartados.length : (Number.isSafeInteger(e.descartados) && e.descartados >= 0 ? e.descartados : 1);
  // El QR exige que el mercado y la moneda de la carga coincidan con el país del teléfono (`pcMercadoCoincide`): el candado está AQUÍ, no en quien llama.
  if (noEntraron.length > 0 || distintos.length > 0 || descartados > 0 || e.cobroReal !== true || e.mercadoCoincide !== true) return 'listo_para_confirmar';
  return 'qr';
}

// ¿Una vez completada la entrega, el QR saldría solo? (todo entró, nada descartado, precios y total vivos). Lo guarda la ficha del cliente como «viene del catálogo, ya confirmó».
function pcQrSoloAlCompletar(x) {
  const e = vcObjeto(x) ? x : {};
  const lineas = Array.isArray(e.lineas) ? e.lineas : [];
  return pcDecision({ lineas: lineas, noEntraron: e.noEntraron, distintos: e.distintos, descartados: e.descartados, entregaCompleta: true, cobroReal: e.cobroReal, mercadoCoincide: e.mercadoCoincide }) === 'qr';
}

// K1 (contrato de la carga, 24/11/2026): ¿la moneda y el mercado que dice la carga son los del país del TELÉFONO del cliente? `mercadoDelTelefono`: 'BO' | 'AR' (lo decide el flujo por el prefijo; otro país = '').
// BO ⇒ moneda BOB (o ausente: los tenants de Firestore no la traen en K1) y mercado BO (o ausente); AR ⇒ ARS y AR. USD nunca coincide con un mercado externo. La carga nunca decide el mercado: solo se COMPRUEBA contra el teléfono.
// Si no coincide, el flujo no emite un QR de esa carga: pasa a `listo_para_confirmar`/derivar según su regla; jamás cobra en la moneda equivocada.
function pcMercadoCoincide(carrito, mercadoDelTelefono, exigeExterno) {
  if (!vcObjeto(carrito)) return false;
  const car = carrito;
  const m = mercadoDelTelefono === 'BO' || mercadoDelTelefono === 'AR' ? mercadoDelTelefono : '';
  if (m === '') return false;
  const moneda = car.moneda === undefined || car.moneda === null || car.moneda === '' ? '' : car.moneda;
  const mercado = car.mercado === undefined || car.mercado === null || car.mercado === '' ? '' : car.mercado;
  // Bolivia: BOB (o sin moneda, como los tenants de Firestore) y mercado BO (o ausente). Argentina solo existe con fuente externa: ARS, mercado AR y catalogo 'externo', los tres presentes.
  // `exigeExterno === true`: el flujo SOLO acepta cargas de la fuente externa: también en Bolivia la carga debe traer `catalogo: 'externo'`. Los flujos con catálogo propio del comercio no lo traen.
  if (exigeExterno === true && car.catalogo !== 'externo') return false;
  if (m === 'BO') return (moneda === '' || moneda === 'BOB') && (mercado === '' || mercado === 'BO');
  return moneda === 'ARS' && mercado === 'AR' && car.catalogo === 'externo';
}
