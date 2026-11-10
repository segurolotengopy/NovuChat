/**
 * «Confirmar» un pedido de catálogo externo (B5b): lo que la pantalla decide, sin React, para probarlo aparte.
 * El servidor es quien valida todo (`confirmarPedidoExterno`); acá solo se decide cuándo mostrar el botón y cómo
 * leer el error. Un botón que se muestra de más no abre nada: el servidor lo vuelve a negar.
 */
export interface FaltanteVista { productoId: string; nombre: string; solicitado?: number; disponible?: number }
export interface ResultadoDeError { mensaje: string; faltantes: FaltanteVista[] }

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** El rol de la sesión en ESTE comercio (`rolEn`): solo `admin` y `oper` pueden confirmar. */
export const rolPuedeConfirmar = (rol: string | null | undefined): boolean => rol === 'admin' || rol === 'oper';

/** Solo un pedido de catálogo externo que sigue `recibido`, y solo para admin u oper de ese comercio, tiene botón. */
export const puedeConfirmarse = (p: { catalogo?: unknown; estado?: unknown }, rol: string | null | undefined): boolean =>
  p.catalogo === 'externo' && p.estado === 'recibido' && rolPuedeConfirmar(rol);

/** Un pedido externo `confirmando` se muestra como «Confirmando…», sin botón (otra persona, o esta, ya lo está confirmando). */
export const estaConfirmando = (p: { catalogo?: unknown; estado?: unknown }): boolean =>
  p.catalogo === 'externo' && p.estado === 'confirmando';

/** El error de la callable como lo muestra la pantalla: el 409 (stock) trae la lista; el resto, el mensaje del servidor. */
export function leerErrorDeConfirmar(e: unknown): ResultadoDeError {
  const code = esObjeto(e) && typeof e['code'] === 'string' ? e['code'] : '';
  const mensaje = esObjeto(e) && typeof e['message'] === 'string' && e['message'] !== ''
    ? e['message'] : 'No se pudo confirmar el pedido. Intente de nuevo.';
  const det = esObjeto(e) ? e['details'] : undefined;
  const lista = code.endsWith('failed-precondition') && esObjeto(det) && det['motivo'] === 'stock_insuficiente' && Array.isArray(det['faltantes'])
    ? det['faltantes'] : [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const faltantes: FaltanteVista[] = [];
  for (const f of lista.slice(0, 30)) {
    if (!esObjeto(f) || typeof f['productoId'] !== 'string') continue;
    const solicitado = num(f['solicitado']);
    const disponible = num(f['disponible']);
    faltantes.push({
      productoId: f['productoId'],
      nombre: typeof f['nombre'] === 'string' && f['nombre'] !== '' ? f['nombre'] : f['productoId'],
      ...(solicitado !== undefined ? { solicitado } : {}),
      ...(disponible !== undefined ? { disponible } : {}),
    });
  }
  return { mensaje, faltantes };
}
