import { deleteField, serverTimestamp } from 'firebase/firestore';
import { PALETA_POR_DEFECTO } from './paletas';

/**
 * EL DOCUMENTO QUE LA PANTALLA «CONFIGURACIÓN» MANDA A `tenants/{t}/config/negocio`.
 *
 * Vive acá, y no dentro del manejador de `Configuracion.tsx`, para que la prueba
 * del guardado completo (`pruebas/plataforma/guardado-configuracion.test.ts`)
 * arme EXACTAMENTE los campos que manda la pantalla y no una copia escrita a
 * mano que un día se desvíe. Es la misma construcción de siempre, movida sin
 * cambiarla: el orden de los campos, qué se escribe solo si tiene valor o si el
 * documento ya lo tenía, y el sello.
 *
 * Lo que NO entra, a propósito: `instruccionesVigentes` e `instruccionesRevision`
 * (los escribe solo el servidor; si el navegador los mandara, la regla
 * rechazaría el formulario entero) — `comportamiento-pantalla.test.ts` lo vigila
 * sobre esta fuente.
 */
export type EntradaPayloadNegocio = {
  /** Los campos de texto del formulario (`datos` de la pantalla). */
  datos: Record<string, string>;
  /** El enlace del mapa ya recortado (`trim`). */
  direccionMaps: string;
  /** El pin como números, o `null` si no hay. */
  ubicacion: { lat: number; lng: number } | null;
  /** Si el documento ya traía esos campos (para poder vaciarlos). */
  teniaUbicacion: { direccionMaps: boolean; ubicacion: boolean };
  /** El nombre del asistente ya aplanado y recortado. */
  nombre: string;
  teniaNombreAsistente: boolean;
  /** «Nombre de quien atiende» ya aplanado y recortado; opcional (sin él, ni se envía). */
  quienAtiende?: string;
  teniaQuienAtiende?: boolean;
  /** El horario ya escrito: `{ lun: '09:00-18:00', dom: 'cerrado' }`; un día sin datos no está. */
  horarios?: Record<string, string>;
  catalogoWeb: boolean;
  /** `auth.currentUser?.uid ?? ''`. */
  uid: string;
};

export function payloadNegocio(e: EntradaPayloadNegocio): Record<string, unknown> {
  const { datos, direccionMaps, ubicacion, teniaUbicacion, nombre, teniaNombreAsistente, horarios, catalogoWeb, uid, quienAtiende = '', teniaQuienAtiende = false } = e;
  return {
    ...datos,
    ...(direccionMaps !== '' || teniaUbicacion.direccionMaps ? { direccionMaps } : {}),
    // NÚMEROS en un mapa, o el campo se quita: nunca la cadena vacía, que
    // la regla rechaza, ni un par a medias.
    ...(ubicacion ? { ubicacion } : teniaUbicacion.ubicacion ? { ubicacion: deleteField() } : {}),
    ...(nombre !== '' || teniaNombreAsistente ? { nombreAsistente: nombre } : {}),
    // Solo si tiene texto o el documento ya lo traía (para poder vaciarlo): un
    // comercio que no lo usa guarda igual aunque la consola llegue antes que la regla.
    ...(quienAtiende !== '' || teniaQuienAtiende ? { nombreQuienAtiende: quienAtiende } : {}),
    // El mapa se reemplaza entero: un día que se vació desaparece del
    // documento, en vez de quedar con el horario viejo.
    ...(horarios ? { horarios } : {}),
    catalogoWebActivo: catalogoWeb,
    zonaHoraria: 'America/La_Paz',
    moneda: 'BOB',
    // El sello lo verifica la regla: `actualizadoPor == request.auth.uid` y
    // `actualizadoEn == request.time`. No se puede falsear desde el cliente.
    actualizadoPor: uid,
    actualizadoEn: serverTimestamp(),
  };
}

/**
 * LOS CAMPOS DE TEXTO DEL FORMULARIO (`datos` de la pantalla) tal como se arman
 * al LEER `config/negocio`: todo a cadena, con el valor por defecto de cada
 * enumerado. Es lo que, sin tocar nada, la pantalla vuelve a mandar con
 * «Guardar» (junto con lo que arma `payloadNegocio`).
 */
export function datosDeNegocio(v: Record<string, unknown>): Record<string, string> {
  return {
    nombreNegocio: String(v['nombreNegocio'] ?? ''),
    descripcion: String(v['descripcion'] ?? ''),
    direccion: String(v['direccion'] ?? ''),
    direccionMaps: String(v['direccionMaps'] ?? ''),
    numeroRecepcion: String(v['numeroRecepcion'] ?? ''),
    calendarioId: String(v['calendarioId'] ?? ''),
    politicaCancelacion: String(v['politicaCancelacion'] ?? ''),
    tratamiento: String(v['tratamiento'] ?? 'usted'),
    estiloEmojis: String(v['estiloEmojis'] ?? 'pocos'),
    mensajeCierre: String(v['mensajeCierre'] ?? ''),
    mensajeErrorTemporal: String(v['mensajeErrorTemporal'] ?? ''),
    mensajeReservaNoConfirmada: String(v['mensajeReservaNoConfirmada'] ?? ''),
    mensajeComercioSuspendido: String(v['mensajeComercioSuspendido'] ?? ''),
    instruccionesExtra: String(v['instruccionesExtra'] ?? ''),
    paleta: String(v['paleta'] ?? PALETA_POR_DEFECTO),
  };
}

/**
 * Validación en el navegador de «Nombre de quien atiende». Es ayuda para decir
 * POR QUÉ; la autoridad es la regla de Firestore (y `quienAtiende` en el
 * servidor). Las cadenas son las MISMAS de `firestore.rules` y de prompt.ts
 * (`voz-quien-atiende.test.ts` las compara). Lista de permitidos + vocabulario.
 */
export const TOPE_QUIEN_ATIENDE = 60;
export const QUIEN_RE_CARACTERES = '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,&()-]{0,60}$';
export const QUIEN_RE_VOCABULARIO =
  'banc|pag[oóu]|dep[oó]sit|transferenc|tesorer|acreditad|verificad|comprobante|recibimos'
  + '|\\bbots?\\b|robot|human[oa]s?|persona real|persona de verdad|soy una persona|\\breal\\b|carne y hueso'
  + '|inteligencia artificial|\\bi[. ]?a\\b|\\ba[.]?i\\b'
  + '|no soy (un|una)\\b|www[.]|[.](com|net|org|bo|me|app|io|gl|ly)\\b|([0-9][^0-9]{0,3}){6,}'
  + '|\\b(bnb|bcp|fie|asfi|sin|jefe|bcb|bisa|bmsc|qr|meta)\\b|uni[oó]n|mercantil|ganadero|econ[oó]mico|fassil|tigo ?money'
  + '|prodem|ecofuturo|cobranzas?|\\byape\\b|whatsapp|soporte'
  + '|impuestos nacionales|polic[ií]a|sistema|tu jefe|ya pag';
const RE_CARACTERES = new RegExp(QUIEN_RE_CARACTERES);
const RE_VOCABULARIO = new RegExp(QUIEN_RE_VOCABULARIO, 'i');
export const COMPACTO_PROHIBIDO = [
  'banc', 'pago', 'pagu', 'deposit', 'transferenc', 'tesorer', 'acreditad', 'verificad',
  'comprobante', 'recibimos', 'robot', 'chatbot', 'humano', 'humana', 'personareal', 'personadeverdad',
  'unapersona', 'asesorareal', 'carneyhueso', 'inteligenciaartificial', 'prodem', 'ecofuturo', 'cobranza',
  'whatsapp', 'mercantil', 'ganadero', 'economico', 'fassil', 'tigomoney',
  'impuestosnacionales', 'policia', 'sistema', 'tujefe', 'yapag',
];
export function compactarQuien(texto: string): string {
  return texto.normalize('NFKC').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[4]/g, 'a').replace(/3/g, 'e').replace(/1/g, 'i').replace(/0/g, 'o')
    .replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's')
    .replace(/[^a-z]/g, '');
}


export function errorQuienAtiende(valor: string): string | null {
  if (valor === '') return null;
  if (Array.from(valor).length > TOPE_QUIEN_ATIENDE) {
    return `El nombre de quien atiende puede tener hasta ${TOPE_QUIEN_ATIENDE} caracteres.`;
  }
  if (!RE_CARACTERES.test(valor)) {
    return 'El nombre de quien atiende solo admite letras, números, espacios y . , & ( ) -';
  }
  if (RE_VOCABULARIO.test(valor)) {
    return 'El nombre de quien atiende no puede llevar enlaces ni números largos, ni hablar de bancos, pagos o de ser o no una inteligencia artificial.';
  }
  if (valor.replace(/[^0-9]/g, '').length >= 6) {
    return 'El nombre de quien atiende no puede llevar números largos.';
  }
  const compacto = compactarQuien(valor);
  if (COMPACTO_PROHIBIDO.some((t) => compacto.includes(t))) {
    return 'El nombre de quien atiende no puede hablar de bancos, pagos o instituciones.';
  }
  return null;
}
