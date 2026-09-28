// FILTRAR CATEGORIA: la lista que ESTE flujo puede cumplir (revision de
// seguridad del PR #256, M1; 28/09/2026).
//
// «Preparar imagen» es el modulo comun de los cinco flujos, y su lista cerrada
// incluye categorias cuyos avisos este flujo NO cumple: «publicidad» ofrece
// agendar, «boca_o_dientes» y «documento_salud» hablan de la valoracion con el
// profesional. El prompt del clasificador ya no las nombra, pero un
// prompt no es una barrera: si el modelo las devolviera igual --o si el texto
// de la imagen se lo dictara--, este nodo las reduce a «otro» antes de que
// «Preparar imagen» elija su texto fijo.
//
// Deja la MISMA forma que devuelve el nodo de Gemini (content.parts[].text con
// el JSON), asi «Preparar imagen» no cambia, y reescribe el JSON entero: solo
// viajan «categoria» y «texto», nada mas de lo que haya escrito el modelo.
const PERMITIDAS = ["comprobante","otro"];

// La misma lectura que «Preparar imagen»: el texto en content.parts[].text, o
// las otras formas conocidas del nodo de Gemini.
const textoDe = (j) => {
  if (!j || typeof j !== 'object') return '';
  const partes = (c) => (c && Array.isArray(c.parts))
    ? c.parts.map((p) => (p && typeof p.text === 'string') ? p.text : '').join('\n') : '';
  if (typeof j.content === 'string') return j.content;
  const c1 = partes(j.content);
  if (c1) return c1;
  const cand = Array.isArray(j.candidates) ? j.candidates[0] : null;
  const c2 = cand ? partes(cand.content) : '';
  if (c2) return c2;
  for (const k of ['text', 'output', 'response']) {
    if (typeof j[k] === 'string' && j[k].trim()) return j[k];
  }
  return '';
};

const items = $input.all();
const out = [];
for (let i = 0; i < items.length; i++) {
  let objeto = null;
  const m = /\{[\s\S]*\}/.exec(textoDe(items[i].json));
  if (m) { try { objeto = JSON.parse(m[0]); } catch (e) { objeto = null; } }
  if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto)) objeto = {};
  const categoria = PERMITIDAS.includes(objeto.categoria) ? objeto.categoria : 'otro';
  const texto = typeof objeto.texto === 'string' ? objeto.texto : '';
  out.push({ json: { content: { parts: [{ text: JSON.stringify({ categoria, texto }) }] } }, pairedItem: { item: i } });
}
return out;
