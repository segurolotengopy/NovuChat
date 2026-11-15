// CORE · TEXTO · IDENTIDAD «ASISTENTE VIRTUAL CON IA» (prefijo `ct`, 14/11/2026). Funciones PURAS para incluir byte a byte en un nodo Code de n8n (JS): sin importaciones ni globales de Node, sin retorno de nivel superior.
// Qué resuelve: quien recibe el primer mensaje tiene que saber que habla con una inteligencia artificial (política de WhatsApp para proveedores de IA, vigente desde el 15/01/2026; el Reglamento europeo de IA, art. 50, como vara). Un saludo que solo dice «asistente virtual» deja la duda; el nuevo dice «asistente virtual con IA».
// Cómo: `ctConIA(texto)` se aplica al texto YA ARMADO que sale al cliente, así vale aunque el saludo sea un dato del negocio. Es idempotente y solo toca lo que nombra al «asistente virtual»: si el texto ya dice IA o inteligencia artificial, o no se presenta, sale igual. Cuesta 0 mensajes: no agrega ni quita envíos, solo dos palabras.
// Lo exige `admin/pruebas/core/ux-identidad.test.ts`: todo flujo que atiende a un cliente incluye esta pieza y la llama, o tiene su excepción declarada con tope y vencimiento. Sin textos ni nombres de un cliente.
const CT_ROTULO_IA = 'con IA';
// ¿El texto ya dice que es una IA? Se prueba sobre el texto plegado (sin tildes, en minúsculas): «con IA», «una IA», «inteligencia artificial», «I.A.».
function ctDiceIA(texto) {
  const t = String(texto === undefined || texto === null ? '' : texto).normalize('NFKC').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /\binteligencia artificial\b/.test(t) || /(^|[^a-z0-9])i\.?a\.?(?![a-z0-9])/.test(t);
}
// «asistente virtual» → «asistente virtual con IA» la primera vez que aparece, conservando las mayúsculas del original. Solo se mira la ORACIÓN que se presenta (hasta el próximo . ! ? o salto de línea): una «IA» en otra parte del texto (un producto, una URL, lo que escribió el modelo) no tapa la presentación. Sin «asistente virtual» o con la IA ya dicha en esa oración, el texto no cambia.
function ctConIA(texto) {
  const t = String(texto === undefined || texto === null ? '' : texto);
  return t.replace(/\basistente virtual\b[^.!?\n]*/i, (oracion) => (ctDiceIA(oracion) ? oracion : oracion.replace(/asistente virtual/i, (m) => m + ' ' + CT_ROTULO_IA)));
}
