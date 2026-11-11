// =============================================================================
// GMAIL DEL CLIENTE (prefijo `vg` / `VG_`): extrae y valida el correo de Gmail que el cliente escribe tras una venta con comprobante.
// =============================================================================
// Lo usa solo el CÓDIGO sobre el texto literal que escribió el cliente: el modelo nunca ve ni produce el correo. Solo `@gmail.com` (ni googlemail ni alias con «+»).
// Sin `import`/`export`, `require`, `URL`, `Buffer` ni `crypto`. Sin textos ni nombres de un negocio.

/** Una parte local válida: de 6 a 30 caracteres (Gmail exige al menos 6) de a-z, 0-9 y «.», sin punto al inicio ni al final y sin dos puntos seguidos. */
const VG_LOCAL = /^(?!.*\.\.)[a-z0-9][a-z0-9.]{4,28}[a-z0-9]$/;

/** ¿Es un Gmail válido, ya normalizado (minúsculas, sin espacios)? */
function vgEsGmail(c) {
  if (typeof c !== 'string') return false;
  const p = c.split('@');
  return p.length === 2 && p[1] === 'gmail.com' && VG_LOCAL.test(p[0]);
}

/**
 * Del texto literal del cliente saca UN correo de Gmail. Devuelve `{ resultado, correo }`:
 *   recibido    un solo correo, de Gmail y bien formado (`correo` en minúsculas);
 *   no_gmail    un solo correo, de otro dominio (incluye googlemail.com, gmail.co, gmial.com);
 *   mal_formado ningún correo, o su parte local no es válida;
 *   varios      más de un correo distinto (el mismo repetido cuenta uno).
 * `correo` solo viaja con `recibido`.
 */
function vgExtraerGmail(crudo) {
  const texto = String(crudo === undefined || crudo === null ? '' : crudo).normalize('NFKC').replace(/\p{Cf}/gu, '');
  const hallados = texto.match(/[^\s@<>()\[\],;:"'«»¡¿]+@[^\s@<>()\[\],;:"'«»¡¿]+/g) || [];
  const unicos = [];
  for (const h of hallados) {
    // Se quitan los bordes que no son del correo: la negrita, cursiva o tachado de WhatsApp (* _ ~) y la puntuación de cierre.
    const c = h.replace(/^[*_~!?]+/, '').replace(/[.,;:!?)*_~\/]+$/, '').toLowerCase();
    if (c !== '' && unicos.indexOf(c) < 0) unicos.push(c);
  }
  if (unicos.length === 0) return { resultado: 'mal_formado', correo: '' };
  if (unicos.length > 1) return { resultado: 'varios', correo: '' };
  const correo = unicos[0];
  const partes = correo.split('@');
  // Un dominio sin punto («juan@gmail .com» partido por un espacio) no es de otro proveedor: es un correo mal escrito.
  if (partes.length !== 2 || partes[0] === '' || partes[1] === '' || partes[1].indexOf('.') < 0) return { resultado: 'mal_formado', correo: '' };
  if (partes[1] !== 'gmail.com') return { resultado: 'no_gmail', correo: '' };
  if (!vgEsGmail(correo)) return { resultado: 'mal_formado', correo: '' };
  // Guarda final: el correo guardado es, letra por letra, lo que escribió el cliente (nunca algo armado por otra vía).
  if (texto.toLowerCase().indexOf(correo) < 0) return { resultado: 'mal_formado', correo: '' };
  return { resultado: 'recibido', correo: correo };
}
