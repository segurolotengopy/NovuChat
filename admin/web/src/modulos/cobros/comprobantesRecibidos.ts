/**
 * COMPROBANTES RECIBIDOS — la parte pura (sin React, sin red).
 *
 * Un comprobante inválido nunca crea un cierre (decisión del 03/10), pero queda
 * registrado en `tenants/{t}/comprobantesRecibidos/{nombreDeObjeto(idMeta)}`,
 * que escribe `cotejarComprobanteVenta` en la misma transacción del cotejo.
 * Esta pantalla muestra esos documentos, uno por fila, del más nuevo al más
 * viejo, para que el comercio vea qué mandó cada cliente.
 *
 * LA FILA ES UNA ENTRADA NORMALIZADA (`ComprobanteRecibido`): la pantalla solo
 * conoce ese contrato.
 *
 * Los estados hablan de DATOS, nunca de dinero (prohibición 3 de CLAUDE.md): el
 * OCR de una imagen no es una acreditación bancaria. Ninguna palabra de esta
 * tabla sugiere que el dinero entró; eso lo confirma el banco, y el negocio.
 */

/** Una fila de la lista. Contrato estable entre el origen de los datos y la pantalla. */
export interface ComprobanteRecibido {
  idMeta: string;
  conversacionId: string;
  /** Instante de llegada en milisegundos, o `null` si el registro no trae fecha. */
  fechaMs: number | null;
  /** «dd/mm/aaaa hh:mm» en hora de La Paz, o «—». */
  fecha: string;
  /** Nombre del contacto, o el teléfono enmascarado («****123»). */
  cliente: string;
  /** Lo que se pidió; `null` se pinta «—». */
  montoPedido: number | null;
  /** Lo que se leyó de la imagen; `null` se pinta «—». */
  montoLeido: number | null;
  /** Moneda del pedido («BOB» si la solicitud no la trae). */
  moneda: string;
  estadoPalabras: string;
  /** Hay una imagen guardada que la callable `verComprobante` pueda entregar. */
  tieneFoto: boolean;
  /** Tuvo foto pero ya pasaron los 90 días de custodia: se avisa en vez de ofrecer un botón que falla. */
  fotoVencida: boolean;
}

/** Un documento de `comprobantesRecibidos` tal como llega de Firestore: todo desconocido hasta que se mire. */
export interface DocumentoRecibido {
  id: string;
  [campo: string]: unknown;
}

/** El único id de conversación con el que la callable acepta pedir una foto. */
export const ID_DE_CONVERSACION = /^wa_[0-9]{10,15}$/;

/** Texto de un estado desconocido: ante la duda, una persona lo mira. */
export const ESTADO_POR_DEFECTO = 'En revisión';

/** Textos fijos de la pantalla. */
export const AVISO_COMPROBANTES = 'NovuChat nunca confirma que el dinero entró: eso lo ve usted en su banco.';
export const TEXTO_FOTO_VENCIDA = 'La foto ya no está disponible';

/** Días que se conserva la imagen de un comprobante. */
export const DIAS_DE_CUSTODIA = 90;

/** Forma de un `idMeta` que se puede pedir a la callable. */
export const ID_META_PEDIBLE = /^[A-Za-z0-9._=:+/-]{1,120}$/;

export const TEXTO_SIN_COMPROBANTES = 'Todavía no llegó ningún comprobante.';

/**
 * Tabla cerrada de estados, sobre los códigos de `cotejo.ts` y del cobro de venta.
 * Los motivos `falta_*` son «no es comprobante»: sin monto leído, para el comercio es
 * una imagen ilegible; con el monto leído y sin fecha o destino, «Faltan datos».
 */
export function estadoEnPalabras(estado: unknown, motivo: unknown, montoLeido: unknown = null): string {
  const m = typeof motivo === 'string' ? motivo : '';
  switch (estado) {
    case 'valido': return 'Datos coinciden';
    case 'aproximado': return 'Coinciden en parte';
    case 'en_revision': return m.startsWith('monto_') ? 'En revisión (no coincide el monto)' : 'En revisión';
    case 'tardio': return 'Llegó fuera de plazo';
    case 'no_es_comprobante': return 'Ilegible';
    case 'invalido': {
      // Con el monto ya leído, lo que falta es la fecha o el destino: no es una imagen ilegible.
      if ((m === 'falta_fecha' || m === 'falta_destino') && numero(montoLeido) !== null) return 'Faltan datos';
      if (m === 'ilegible' || m === 'no_es_comprobante' || m.startsWith('falta_')) return 'Ilegible';
      if (m.startsWith('monto_')) return 'No coincide el monto';
      return 'No coinciden los datos';
    }
    default: return ESTADO_POR_DEFECTO;
  }
}

const textoNoVacio = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/** «****123»: nunca el teléfono entero en una lista. */
export function telefonoEnmascarado(telefono: unknown, conversacionId: string): string {
  const crudo = typeof telefono === 'string' || typeof telefono === 'number'
    ? String(telefono) : conversacionId.replace(/^wa_/, '');
  const digitos = crudo.replace(/\D/g, '');
  return digitos.length >= 3 ? `****${digitos.slice(-3)}` : '****';
}

const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Milisegundos de un Timestamp de Firestore, un Date, un número o `{seconds}`. */
export function milisegundosDe(v: unknown): number | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'object' || v === null) return null;
  const t = v as { toMillis?: unknown; toDate?: unknown; seconds?: unknown };
  if (typeof t.toMillis === 'function') return milisegundosDe((t.toMillis as () => unknown).call(v));
  if (typeof t.toDate === 'function') return milisegundosDe((t.toDate as () => unknown).call(v));
  if (typeof t.seconds === 'number' && Number.isFinite(t.seconds)) return t.seconds * 1000;
  return null;
}

const dos = (n: number) => String(n).padStart(2, '0');

/** «dd/mm/aaaa hh:mm» en La Paz (UTC−4 fijo, como todo el proyecto). */
export function fechaDeLaPaz(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms - 4 * 3_600_000);
  return `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}`;
}

/**
 * Convierte los documentos de `comprobantesRecibidos` en filas, del más nuevo al
 * más viejo (sin fecha, al final). Sin `idMeta` ni `conversacionId` no se puede
 * pedir ni identificar la fila y se descarta; todo lo demás tiene un valor por
 * defecto. El cliente es el nombre del contacto o `****` + los 3 últimos
 * dígitos de la conversación: el teléfono entero no se muestra.
 */
export function filasDeRecibidos(docs: readonly DocumentoRecibido[], ahora: number = Date.now()): ComprobanteRecibido[] {
  const filas: ComprobanteRecibido[] = [];
  for (const d of docs) {
    const idMeta = textoNoVacio(d['idMeta']);
    const conversacionId = textoNoVacio(d['conversacionId']);
    if (idMeta === null || conversacionId === null) continue;
    const fechaMs = milisegundosDe(d['en']);
    const moneda = typeof d['moneda'] === 'string' && /^[A-Z]{3}$/.test(d['moneda']) ? d['moneda'] : 'BOB';
    const conRuta = textoNoVacio(d['ruta']) !== null && ID_DE_CONVERSACION.test(conversacionId) && ID_META_PEDIBLE.test(idMeta);
    const vencida = conRuta && fechaMs !== null && ahora - fechaMs > DIAS_DE_CUSTODIA * 86_400_000;
    filas.push({
      idMeta,
      conversacionId,
      fechaMs,
      fecha: fechaDeLaPaz(fechaMs),
      cliente: textoNoVacio(d['nombreContacto']) ?? telefonoEnmascarado(undefined, conversacionId),
      montoPedido: numero(d['importe']),
      montoLeido: numero(d['montoLeido']),
      moneda,
      estadoPalabras: estadoEnPalabras(d['estado'], d['motivo'], d['montoLeido']),
      // La foto solo se pide con ids que la callable acepte y dentro de los 90 días de custodia.
      tieneFoto: conRuta && !vencida,
      fotoVencida: vencida,
    });
  }
  return filas
    .map((fila, orden) => ({ fila, orden }))
    .sort((a, b) => {
      if (a.fila.fechaMs === b.fila.fechaMs) return a.orden - b.orden;
      if (a.fila.fechaMs === null) return 1;
      if (b.fila.fechaMs === null) return -1;
      return b.fila.fechaMs - a.fila.fechaMs;
    })
    .map((x) => x.fila);
}
