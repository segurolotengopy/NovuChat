/**
 * EL ENLACE A LA HOJA DEL miniCRM (03/11/2026). Función pura, sin dependencias: la usan el script de Plataforma que
 * lo escribe (`scripts/plataforma/crm-enlace.mjs`) y la Consola que pinta el botón «Abrir miniCRM».
 *
 * Una sola forma válida: `https://docs.google.com/spreadsheets/d/<id>[/…]`, sin usuario, sin puerto, sin espacios ni
 * caracteres de control, de hasta 300 caracteres. Cualquier otra cosa (otro dominio, `http:`, `javascript:`, un
 * subdominio parecido) no es un enlace a la hoja y no se escribe ni se pinta. Es una URL, nunca un secreto.
 */
export const LARGO_MAXIMO_ENLACE_HOJA = 300;

const FORMA = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{10,100}(?:\/[A-Za-z0-9_\-./%?=&#]*)?$/;

export function esEnlaceDeHoja(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > LARGO_MAXIMO_ENLACE_HOJA) return false;
  if (!FORMA.test(v)) return false;
  if (v.includes('..') || v.includes('//', 8)) return false; // nada de subir de ruta ni de segmentos vacíos
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname === 'docs.google.com' && u.username === '' && u.password === '' && u.port === '';
  } catch {
    return false;
  }
}

/** Lo que la Consola pinta: el enlace si es válido, o `null`. Nunca devuelve un valor que no pasó `esEnlaceDeHoja`. */
export function enlaceDeHojaVisible(v: unknown): string | null {
  return esEnlaceDeHoja(v) ? v : null;
}

/**
 * ¿Se ofrece el botón? Solo el administrador del comercio, con el miniCRM encendido (`config/crm.activo`; ausente =
 * encendido) y con un enlace válido. Sin enlace, o sin alguna de las tres, no hay botón.
 */
export function enlaceMiniCrmParaBoton(entrada: { esAdmin: boolean; crmActivo: unknown; enlace: unknown }): string | null {
  if (entrada.esAdmin !== true) return null;
  if (entrada.crmActivo === false) return null;
  return enlaceDeHojaVisible(entrada.enlace);
}

// ---------------------------------------------------------------------------------------------------------------
// MANUALES DE USO (10/11/2026). Dos enlaces por comercio, uno para el OPERADOR y otro para el ADMINISTRADOR.
// El operador ve solo el suyo; el admin ve los dos. Es una URL, nunca un secreto.
// Dominios cerrados: documentos, presentaciones, hojas y archivos de Google (docs.google.com, drive.google.com).
// ---------------------------------------------------------------------------------------------------------------
export const LARGO_MAXIMO_ENLACE_MANUAL = 300;

const FORMA_MANUAL = /^https:\/\/(?:docs\.google\.com\/(?:document|presentation|spreadsheets)\/d|drive\.google\.com\/file\/d)\/[A-Za-z0-9_-]{10,100}(?:\/[A-Za-z0-9_\-./%?=&#]*)?$/;

export function esEnlaceDeManual(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > LARGO_MAXIMO_ENLACE_MANUAL) return false;
  if (!FORMA_MANUAL.test(v)) return false;
  if (v.includes('..') || v.includes('//', 8)) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && (u.hostname === 'docs.google.com' || u.hostname === 'drive.google.com')
      && u.username === '' && u.password === '' && u.port === '';
  } catch {
    return false;
  }
}

export type RolManual = 'admin' | 'oper';

/** Documentos de `enlaces/` que lee cada rol. El operador NUNCA incluye `manual-admin`. */
export function documentosDeManualPara(rol: unknown): Array<'manual-operador' | 'manual-admin'> {
  if (rol === 'admin') return ['manual-operador', 'manual-admin'];
  if (rol === 'oper') return ['manual-operador'];
  return [];
}

/** Lo que la Consola pinta de manuales: solo enlaces válidos y solo los que el rol puede ver. */
export function manualesParaBoton(entrada: { rol: unknown; operador: unknown; admin: unknown }): { operador: string | null; admin: string | null } {
  const permitidos = documentosDeManualPara(entrada.rol);
  return {
    operador: permitidos.includes('manual-operador') && esEnlaceDeManual(entrada.operador) ? entrada.operador : null,
    admin: permitidos.includes('manual-admin') && esEnlaceDeManual(entrada.admin) ? entrada.admin : null,
  };
}
