/**
 * El tramo de la ruta que decide el título de la pestaña del navegador.
 *
 * Para `/negocio/:tenantId/<tramo>/…` es el TERCER segmento: así `/negocio/x/conversaciones/wa_…`
 * sigue titulándose «Conversaciones» y el título nunca lleva el id de una conversación (que es el
 * teléfono). En cualquier otra ruta es el último segmento, como siempre.
 */
export function tramoDeTitulo(pathname: string): string {
  const partes = pathname.replace(/\/+$/, '').split('/');
  if (partes[1] === 'negocio' && partes.length >= 4) return partes[3] ?? '';
  return partes[partes.length - 1] ?? '';
}
