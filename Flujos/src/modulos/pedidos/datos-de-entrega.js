// MÓDULO PEDIDOS — LOS DATOS DE ENVÍO QUE EL CLIENTE YA DIO NO SE VUELVEN A PEDIR (Andres, 23/11/2026; reclamo de Casa Bermejo).
// Se INCLUYE en los flujos que piden datos de envío (construir.mjs, lista de librerías), nunca se copia. Funciones puras, sin red ni globales de Node.
//
// POR QUÉ EXISTE. El 23/11/2026 el cliente escribió en UN mensaje «Andres 1234567 yacuiba. Flota bolivar» y el asistente guardó el nombre y la flota, pero siguió pidiendo el CI y la ciudad en cada turno
// (también con «Ya te lo di» y con el CI solo). El código solo reconocía el CI con la palabra «CI» y la ciudad con «a/en/para/hasta + Mayúscula»; todo lo demás dependía de que el modelo copiara cada
// campo en su JSON, y no lo hizo. Un dato dado NO puede depender de la transcripción del modelo: lo capta el CÓDIGO, a partir de lo que el cliente escribió.
//
// QUÉ HACE (`entCapturar`). Recibe lo que escribió el cliente y lo que la ficha ya sabe, y devuelve SOLO los campos que faltan y que se reconocen con seguridad:
//   · documento: una cifra suelta de 5 a 10 dígitos (con un complemento opcional «-1A»). No es un documento: un celular boliviano (8 dígitos que empiezan con 6 o 7), una cifra con «+», «591», «Bs», «$», «cód.»
//     delante, ni cuando el mensaje habla de un teléfono. Con dos cifras posibles no se elige ninguna.
//   · nombre y ciudad cuando vienen en el MISMO mensaje que el documento: lo que está antes del documento es el nombre; lo que está después, hasta el punto, la coma, «flota», «terminal» o «empresa», es la ciudad.
//   · la ciudad sola: un mensaje de 1 a 3 palabras de letras, cuando la ciudad es lo ÚNICO que falta (nombre, documento y flota ya están).
// Lo que ya está guardado NUNCA se pisa. Nada de esto toca el cobro: solo reconoce datos de la entrega.
const ENT_NO_ES_DATO = new Set('si sí no hola gracias ok okey listo claro ya dije di dio flota terminal empresa envio envío retiro recojo persona hablar confirmo confirmar pagar pago descuento factura quiero catalogo catálogo precio favor buenas buenos dias días tardes noches mi ci dni carnet cedula cédula nombre ciudad lo te se me que qué con por una un el la'.split(' '));
// Las palabras de un trozo de texto, solo si TODO el trozo son letras: «Santa Cruz» sí, «Santa Cruz 3» o «yacuiba?» no.
function entPalabras(trozo, min, max) {
  const t = String(trozo === undefined || trozo === null ? '' : trozo).replace(/\s+/g, ' ').trim();
  if (t === '' || /[^\p{L} .'-]/u.test(t)) return null;
  const p = t.replace(/[.']/g, ' ').split(/[\s-]+/).filter((x) => x !== '');
  if (p.length < min || p.length > max) return null;
  if (p.some((x) => x.length < 2 || ENT_NO_ES_DATO.has(x.toLocaleLowerCase('es')))) return null;
  return p;
}
function entTitulo(palabras) {
  return palabras.map((w) => w.charAt(0).toLocaleUpperCase('es') + w.slice(1).toLocaleLowerCase('es')).join(' ');
}
// La única cifra del mensaje que puede ser el documento, con dónde empieza y dónde termina. `null` si no hay ninguna, si hay dos, o si parece un teléfono, un precio o un código.
function entDocumentoSuelto(texto, mercado) {
  const t = String(texto === undefined || texto === null ? '' : texto);
  if (/\b(tel[eé]fono|celular|whats|llam|contacto)\b/i.test(t)) return null;
  const re = /(?<![\d+])(\d{5,10}(?:-[0-9A-Za-z]{1,2})?)(?![\d])/g;
  const halladas = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    const digitos = m[1].replace(/\D/g, '');
    const antes = t.slice(Math.max(0, m.index - 6), m.index);
    if (/(\+|591|bs\.?|\$|usd|c[oó]d\.?|n[º°o]\.?)\s*$/i.test(antes)) continue;
    if (mercado !== 'AR' && digitos.length === 8 && /^[67]/.test(digitos)) continue; // un celular de Bolivia
    halladas.push({ valor: m[1], inicio: m.index, fin: m.index + m[1].length });
  }
  return halladas.length === 1 ? halladas[0] : null;
}
// `saben`: lo que la ficha ya sabe, en la forma `{nombre, documento, ciudad, flota}` (vacío = falta). Devuelve `{documento?, nombre?, ciudad?}` solo con lo reconocido.
function entCapturar(texto, saben, mercado) {
  const t = String(texto === undefined || texto === null ? '' : texto).replace(/\s+/g, ' ').trim();
  const sabe = saben && typeof saben === 'object' ? saben : {};
  const falta = (k) => typeof sabe[k] !== 'string' || sabe[k].trim() === '';
  const salida = {};
  if (t === '' || t.length > 300) return salida;
  const doc = entDocumentoSuelto(t, mercado);
  if (doc !== null && falta('documento')) salida.documento = doc.valor;
  if (doc !== null && mercado !== 'AR') {
    // «Nombre 1234567 ciudad. Flota …»: antes del documento, el nombre; después, hasta el corte, la ciudad.
    const izquierda = t.slice(0, doc.inicio).replace(/\b(mi nombre es|me llamo|a nombre de|soy|mi ci es|ci|c\.i\.?|carnet|cedula|cédula)\b/giu, ' ').replace(/[,:;]+/g, ' ');
    const corte = t.slice(doc.fin).search(/[.,;\n]|\s(?:flota|terminal|empresa)\b/i);
    const derecha = corte === -1 ? t.slice(doc.fin) : t.slice(doc.fin, doc.fin + corte);
    const nombre = entPalabras(izquierda, 1, 5);
    if (nombre !== null && falta('nombre')) salida.nombre = entTitulo(nombre);
    const ciudad = entPalabras(derecha, 1, 3);
    if (ciudad !== null && falta('ciudad')) salida.ciudad = entTitulo(ciudad);
  } else if (doc === null && mercado !== 'AR' && falta('ciudad') && !falta('nombre') && !falta('documento') && !falta('flota')) {
    // La ciudad es lo único que falta: «yacuiba», «Santa Cruz».
    const sola = entPalabras(t, 1, 3);
    if (sola !== null) salida.ciudad = entTitulo(sola);
  }
  return salida;
}
