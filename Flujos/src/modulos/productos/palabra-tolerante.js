// =============================================================================
// PALABRA TOLERANTE (prefijo `pt`): comparar una palabra del cliente con una del catálogo tolerando erratas, PURA
// =============================================================================
// Se pega DELANTE del código de un nodo Code (el armador la incluye por texto): el nodo Code de n8n no tiene
// módulos. Es AUTOSUFICIENTE: no usa ninguna función de otro paquete, no lee la configuración, no llama a la red
// y no conoce a ningún cliente. ES5: sin `import`/`export`, sin globales de Node. Funciones globales.
//
// Qué tolera: mayúsculas, tildes, plural («s»/«es»), las confusiones de escritura del español (b/v, ll/y, s/z/c,
// qu/k/c, h muda, letras dobladas) y UNA edición (sustitución, inserción, borrado o transposición) en palabras
// largas. Qué NO hace: sinónimos («cartera» no es «billetera»), cantidades ni decidir qué pieza se pidió; eso es
// de quien la consume.
//
// Umbrales (para que «tele» no sea «tela», «casa» no sea «cosa», «radio» no sea «rubio» ni «plancha» «planta»):
//   - menos de 5 letras, o con alguna cifra: igualdad exacta (tras plural y equivalencias fonéticas);
//   - una inserción, borrado o transposición: ambas palabras de 6 letras o más y misma primera letra;
//   - una sustitución: ambas de 7 letras o más y misma primera letra.

function ptNorm(s) {
  var t = String(s === undefined || s === null ? '' : s).toLowerCase().replace(/ñ/g, '\u0001').normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return t.replace(/[^a-z0-9\u0001]/g, '').replace(/\u0001/g, 'ñ');
}

// Palabras de un texto, normalizadas (separa por todo lo que no sea letra o cifra).
function ptPalabras(texto) {
  var t = String(texto === undefined || texto === null ? '' : texto).toLowerCase().replace(/ñ/g, '\u0001').normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  var partes = t.split(/[^a-z0-9\u0001]+/);
  var out = [];
  for (var i = 0; i < partes.length; i++) {
    if (partes[i]) out.push(partes[i].replace(/\u0001/g, 'ñ'));
  }
  return out;
}

// Equivalencias fonéticas del español, sobre una palabra ya normalizada.
function ptFonetica(w) {
  var t = w.replace(/ch/g, 'x').replace(/h/g, '').replace(/ll/g, 'y').replace(/qu/g, 'k')
    .replace(/c(?=[ei])/g, 's').replace(/c/g, 'k').replace(/z/g, 's').replace(/v/g, 'b');
  // Solo se colapsan consonantes dobladas: una vocal doblada («ee») suele ser una errata de otra clase.
  return t.replace(/([^aeiou0-9])\1+/g, '$1');
}

// Verdadero si a y b (ya normalizadas) son iguales o difieren en UNA edición. Lineal, con corte temprano.
// `soloSustitucion`: 0 admite todas; el llamador decide los umbrales de largo con ptTipoEdicion.
function ptTipoEdicion(a, b) {
  // Devuelve '' (iguales), 'sub', 'ins' (inserción, borrado o transposición) o 'no' (más de una edición).
  if (a === b) return '';
  var la = a.length;
  var lb = b.length;
  if (la - lb > 1 || lb - la > 1) return 'no';
  var m = la < lb ? la : lb;
  var i = 0;
  while (i < m && a.charAt(i) === b.charAt(i)) i++;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return 'sub';
    if (i + 1 < la && a.charAt(i) === b.charAt(i + 1) && a.charAt(i + 1) === b.charAt(i) &&
        a.slice(i + 2) === b.slice(i + 2)) return 'ins';
    return 'no';
  }
  if (la > lb) return a.slice(i + 1) === b.slice(i) ? 'ins' : 'no';
  return b.slice(i + 1) === a.slice(i) ? 'ins' : 'no';
}
function ptDistancia1(a, b) {
  return ptTipoEdicion(String(a), String(b)) !== 'no';
}

// Singular aproximado: «es» en palabras de 7+ letras, «s» en palabras de 5+.
function ptSingular(w) {
  if (w.length >= 7 && /es$/.test(w)) return w.slice(0, -2);
  if (w.length >= 5 && /s$/.test(w)) return w.slice(0, -1);
  return w;
}

function ptCasiIgualFon(f, g) {
  var fs = ptSingular(f);
  var gs = ptSingular(g);
  var pares = [[f, g], [fs, g], [f, gs], [fs, gs]];
  for (var i = 0; i < pares.length; i++) {
    var a = pares[i][0];
    var b = pares[i][1];
    if (a === b) return true;
    if (a.length < 6 || b.length < 6) continue;
    if (/[0-9]/.test(a) || /[0-9]/.test(b)) continue;
    if (a.charAt(0) !== b.charAt(0)) continue;
    var tipo = ptTipoEdicion(a, b);
    if (tipo === 'ins') return true;
    if (tipo === 'sub' && a.length >= 7 && b.length >= 7) return true;
  }
  return false;
}

function ptCasiIgual(palabraCliente, palabraCatalogo) {
  var a = ptNorm(palabraCliente);
  var b = ptNorm(palabraCatalogo);
  if (!a || !b) return false;
  if (a === b) return true;
  var sinCifra = !/[0-9]/.test(a) && !/[0-9]/.test(b);
  // Se prueba con las equivalencias fonéticas y también sin ellas: borrar la vocal tras una «c» cambia su sonido.
  if (ptCasiIgualFon(a, b)) return true;
  return sinCifra && ptCasiIgualFon(ptFonetica(a), ptFonetica(b));
}

// Verdadero si alguna palabra significativa del nombre (5+ letras, o cualquiera si el nombre tiene una sola)
// casa con alguna palabra del texto del cliente.
function ptNombra(textoCliente, nombreDePieza) {
  var nom = ptPalabras(nombreDePieza);
  var txt = ptPalabras(textoCliente);
  if (!nom.length || !txt.length) return false;
  var sig = [];
  var i;
  var j;
  for (i = 0; i < nom.length; i++) {
    if (nom.length === 1 || nom[i].length >= 5) sig.push(nom[i]);
  }
  for (i = 0; i < sig.length; i++) {
    for (j = 0; j < txt.length; j++) {
      if (ptCasiIgual(txt[j], sig[i])) return true;
    }
  }
  return false;
}
