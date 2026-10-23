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
//   2) el titular del DATO, con 3 palabras o mas, esta contenido en lo leido (palabras completas)
//   3) similitud de Dice por bigramas >= 0,85, con 12 caracteres o mas y las MISMAS cifras
// Se calcula el nivel de TODOS los anuncios: si coinciden varios en niveles distintos, o varios por
// contencion con el mismo largo, no hay coincidencia (null). Una igualdad unica siempre gana.
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
  // { nivel, largo } si el texto leido coincide con ese titular; nivel 0 si no.
  //  1) igualdad  2) el titular DEL DATO (>= 3 palabras) esta contenido en lo leido, por palabras completas
  //  3) Dice >= 0,85 con 12 caracteres o mas Y las mismas cifras en el mismo orden ('3x1' no es '2x1').
  const cifras = (x) => (x.match(/\d+/g) || []).join(',');
  const nivelContra = (t, h) => {
    if (!t || !h) return { nivel: 0, largo: 0 };
    if (t === h) return { nivel: 1, largo: h.length };
    if (palabras(h).length >= 3 && contiene(t, h)) return { nivel: 2, largo: h.length };
    if (t.length >= 12 && h.length >= 12 && cifras(t) === cifras(h) && dice(t, h) >= 0.85) return { nivel: 3, largo: h.length };
    return { nivel: 0, largo: 0 };
  };
  // Un campo con caracteres de control, bidireccionales o de ancho cero se OMITE (queda vacio), no se limpia.
  const RARO = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u034f\\u061c\\u115f\\u1160\\u180e\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u206f\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\u{e0000}-\\u{e007f}]', 'u');
  const texto = (v, tope) => (typeof v === 'string' && !RARO.test(v.normalize('NFKC'))
    ? v.normalize('NFKC').replace(/[\[\]{}<>"`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, tope) : '');
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
      // El nivel de TODOS los anuncios, antes de decidir: nadie gana solo por mirarse primero.
      const hallados = [];
      for (const v of validos) {
        let mejorDe = { nivel: 0, largo: 0 };
        for (const c of v.crudos) {
          const r = nivelContra(t, norm(c));
          if (r.nivel && (!mejorDe.nivel || r.nivel < mejorDe.nivel || (r.nivel === mejorDe.nivel && r.largo > mejorDe.largo))) mejorDe = r;
        }
        if (mejorDe.nivel) hallados.push({ v, ...mejorDe });
      }
      if (!hallados.length) return null;
      const ids = new Set(hallados.map((h) => h.v.id));
      let ganadores;
      if (ids.size === 1) ganadores = [hallados[0]];
      else {
        // Varios anuncios distintos coinciden. Solo se resuelve si hay igualdad (nivel 1) unica, o si todos son
        // contencion (nivel 2) y uno contiene un titular estrictamente mas largo que los demas. Todo lo demas: ninguno.
        const igualdad = hallados.filter((h) => h.nivel === 1);
        if (igualdad.length) ganadores = igualdad;
        else if (hallados.every((h) => h.nivel === 2)) {
          const tope = Math.max(...hallados.map((h) => h.largo));
          ganadores = hallados.filter((h) => h.largo === tope);
        } else return null;
        if (new Set(ganadores.map((h) => h.v.id)).size !== 1) return null;
      }
      const g = ganadores[0].v;
      return { id: texto(g.id, 80), titular: texto(g.crudos[0], 100),
        angulo: texto(g.a.angulo, 300), producto: producto(g.a.producto) };
    } catch (e) { return null; }
  };
})();
