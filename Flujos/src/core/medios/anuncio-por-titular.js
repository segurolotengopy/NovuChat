// EL ANUNCIO SE RECONOCE POR SU TITULAR, Y LO DECIDE EL CODIGO (PR-3 de core, 23/10/2026).
//
// QUE RESUELVE. Un cliente manda la captura de un anuncio del negocio. Hasta hoy el
// asistente comparaba el texto leido con lo que el prompt sabia de las campañas, y los
// anuncios de Ruben vivian CABLEADOS en su flujo. Ahora el anuncio es un DATO del tenant
// (la clave `anuncios` de `configuracionFlujo`, solo vigentes y aprobados) y la
// coincidencia la decide este codigo; el modelo nunca decide que anuncio es.
//
// CONTRATO.  anuncioPorTitular(titularLeido, anuncios) -> anuncio | null
//   anuncios = [{ id, titulares: [<=3 textos], angulo, producto: {id,nombre,precio,agotado}|null }]
//   Devuelve una COPIA saneada { id, titular, angulo, producto }: `titular` es el CANONICO
//   del dato (titulares[0]), NUNCA el texto leido de la imagen. Sin coincidencia, null.
//
// NIVELES, en este orden (el primero que algun anuncio cumpla gana):
//   1) igualdad con algun titular
//   2) contencion por palabras completas, con 3 palabras o mas en el texto contenido
//   3) similitud de Dice por bigramas >= 0,85, con 12 caracteres o mas
// Si dos anuncios DISTINTOS cumplen el mejor nivel, no hay coincidencia (null): ante la
// duda el asistente cae en su comportamiento de siempre, que es preguntar.
//
// NORMALIZACION: NFKC; NFD sin diacriticos; minusculas; homoglifos cirilicos y griegos a
// latinos; lo que no sea [a-z0-9] pasa a espacio; espacios colapsados.
//
// ENTRADA MALA (no es array, vacio, elementos sin id o sin titulares): null, sin lanzar.
//
// QUIEN LO USA. `preparar-imagen.js` (se incluye DESPUES de este archivo en el mismo nodo
// Code). Cada flujo cuyo clasificador de imagen quiera este reconocimiento debe pedir en
// su esquema el campo `titular_principal`: «el titular PRINCIPAL: el texto mas grande o el
// de mas arriba, nunca una insignia de precio». Eso lo adopta cada cliente en su propio
// prompt; sin el campo, o sin `anuncios` en `Config del negocio`, todo queda como antes.
const anuncioPorTitular = (() => {
  const DE = 'аеорсухіѕјԁοανρτκιε';
  const A = 'aeopcyxisjdoavptkie';
  const TILDES = new RegExp('[\\u0300-\\u036f]', 'g');
  const norm = (v) => {
    if (typeof v !== 'string') return '';
    const base = v.slice(0, 500).normalize('NFKC').normalize('NFD').replace(TILDES, '').toLowerCase();
    let s = '';
    for (const c of base) { const i = DE.indexOf(c); s += i >= 0 ? A.charAt(i) : c; }
    return s.replace(/[^a-z0-9]+/g, ' ').trim();
  };
  const palabras = (s) => (s ? s.split(' ') : []);
  const contiene = (grande, chico) => (' ' + grande + ' ').indexOf(' ' + chico + ' ') >= 0;
  const bigramas = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); m.set(b, (m.get(b) || 0) + 1); }
    return m;
  };
  const dice = (a, b) => {
    if (a.length < 2 || b.length < 2) return 0;
    const ma = bigramas(a);
    const mb = bigramas(b);
    let comun = 0;
    for (const [k, n] of ma) comun += Math.min(n, mb.get(k) || 0);
    return (2 * comun) / ((a.length - 1) + (b.length - 1));
  };
  // 1, 2, 3 si el texto coincide con ese titular en ese nivel; 0 si no.
  const nivelContra = (t, h) => {
    if (!t || !h) return 0;
    if (t === h) return 1;
    const chico = t.length <= h.length ? t : h;
    const grande = chico === t ? h : t;
    if (palabras(chico).length >= 3 && contiene(grande, chico)) return 2;
    if (t.length >= 12 && h.length >= 12 && dice(t, h) >= 0.85) return 3;
    return 0;
  };
  const texto = (v, tope) => (typeof v === 'string'
    ? v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/[\[\]{}<>"`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, tope) : '');
  const producto = (p) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const nombre = texto(p.nombre, 120);
    if (!nombre) return null;
    const precio = (typeof p.precio === 'number' && Number.isFinite(p.precio)) ? p.precio
      : (typeof p.precio === 'string' && p.precio.trim() !== '' ? texto(p.precio, 40) : null);
    return { id: texto(typeof p.id === 'string' ? p.id : '', 80), nombre, precio, agotado: p.agotado === true };
  };
  return (titularLeido, anuncios) => {
    try {
      const t = norm(titularLeido);
      if (!t || !Array.isArray(anuncios)) return null;
      const validos = [];
      for (const a of anuncios.slice(0, 50)) {
        if (!a || typeof a !== 'object' || Array.isArray(a)) continue;
        const id = typeof a.id === 'string' ? a.id.trim() : '';
        const crudos = Array.isArray(a.titulares) ? a.titulares.filter((x) => typeof x === 'string' && norm(x) !== '') : [];
        if (!id || !crudos.length) continue;
        validos.push({ a, id, crudos: crudos.slice(0, 3) });
      }
      let mejor = 4;
      let ganadores = [];
      for (const v of validos) {
        let nivel = 4;
        for (const c of v.crudos) { const n = nivelContra(t, norm(c)); if (n && n < nivel) nivel = n; }
        if (nivel > 3) continue;
        if (nivel < mejor) { mejor = nivel; ganadores = [v]; } else if (nivel === mejor) ganadores.push(v);
      }
      if (!ganadores.length) return null;
      if (new Set(ganadores.map((g) => g.id)).size !== 1) return null;
      const g = ganadores[0];
      return { id: texto(g.id, 80), titular: texto(g.crudos[0], 100),
        angulo: texto(g.a.angulo, 300), producto: producto(g.a.producto) };
    } catch (e) { return null; }
  };
})();
