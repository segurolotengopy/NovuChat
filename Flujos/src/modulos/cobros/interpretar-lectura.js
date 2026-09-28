// LO QUE LEYO EL MODELO EN EL COMPROBANTE, COMO DATO (bloque 2, Analisis/07 §4.3).
//
// El nodo de Gemini devuelve texto; el prompt le pidio SOLO un objeto JSON,
// pero un modelo a veces lo envuelve en ```json o le agrega una frase. Aca se
// busca el primer objeto `{…}` del texto y se interpreta con try: si no hay
// JSON, o esta vacio, el comprobante es ILEGIBLE y se le pide de nuevo. Un
// campo que el modelo no vio queda vacio (asi lo pide el prompt): un campo
// vacio hace que el cotejo NO confirme y que una persona mire; un campo
// inventado confirmaria un pago que no existio.
//
// ESTE NODO NO COMPARA NADA. Compara el servidor (`cotejarComprobante`),
// contra el importe de la seña y las cuentas del QR del comercio, que el flujo
// ni conoce ni necesita conocer (CLAUDE.md §7: todo limite se hace cumplir en
// el servidor). Aca solo se sanea: seis claves, texto corto, nada mas.
//
// La imagen o el PDF NO se guardan en ningun lado: entraron como binario,
// se leyeron, y de aca sale solo este objeto.
const entradas = $('Normalizar entrada').all();
const cfg = $('Config del negocio').first().json;

// La salida simplificada del nodo Google Gemini trae el texto en
// `content.parts[].text`; se toleran las otras formas conocidas por si el
// nodo cambia de version o se apaga `simplify`.
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
const campo = (o, k, max) => {
  const v = o[k];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
};

const items = $input.all();
const out = [];
for (let i = 0; i < items.length; i++) {
  const ent = (entradas[i] ?? entradas[entradas.length - 1]).json;
  const texto = textoDe(items[i].json);
  let objeto = null;
  const m = /\{[\s\S]*\}/.exec(texto);
  if (m) { try { objeto = JSON.parse(m[0]); } catch (e) { objeto = null; } }
  if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto)) objeto = {};
  const leido = {
    monto: campo(objeto, 'monto', 40),
    cuentaDestino: campo(objeto, 'cuentaDestino', 60),
    nombreCuenta: campo(objeto, 'nombreCuenta', 120),
    fecha: campo(objeto, 'fecha', 40),
    hora: campo(objeto, 'hora', 20),
    banco: campo(objeto, 'banco', 80),
  };
  const legible = String(leido.monto) !== '' || String(leido.cuentaDestino) !== '';

  out.push({ json: {
    telefono: String(ent.from || ''),
    legible,
    leido,
    idMeta: String(ent.mensajeId || ''),
    from: ent.from,
    nombrePerfil: ent.nombrePerfil,
    // Lo que los nodos de la respuesta necesitan, arrastrado en el item.
    nombreNegocio: String(cfg.nombreNegocio || ''),
    direccion: String(cfg.direccion || ''),
    direccionMaps: String(cfg.direccionMaps || ''),
    senaImporte: String(cfg.senaImporte || ''),
    senaMoneda: String(cfg.senaMoneda || 'Bs'),
    senaEventoId: String(cfg.senaEventoId || ''),
    senaEventoCalendario: String(cfg.senaEventoCalendario || ''),
  }, pairedItem: { item: i } });
}
return out;
