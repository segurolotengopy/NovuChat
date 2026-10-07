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
  /** El horario ya escrito: `{ lun: '09:00-18:00', dom: 'cerrado' }`; un día sin datos no está. */
  horarios: Record<string, string>;
  catalogoWeb: boolean;
  /** `auth.currentUser?.uid ?? ''`. */
  uid: string;
};

export function payloadNegocio(e: EntradaPayloadNegocio): Record<string, unknown> {
  const { datos, direccionMaps, ubicacion, teniaUbicacion, nombre, teniaNombreAsistente, horarios, catalogoWeb, uid } = e;
  return {
    ...datos,
    ...(direccionMaps !== '' || teniaUbicacion.direccionMaps ? { direccionMaps } : {}),
    // NÚMEROS en un mapa, o el campo se quita: nunca la cadena vacía, que
    // la regla rechaza, ni un par a medias.
    ...(ubicacion ? { ubicacion } : teniaUbicacion.ubicacion ? { ubicacion: deleteField() } : {}),
    ...(nombre !== '' || teniaNombreAsistente ? { nombreAsistente: nombre } : {}),
    // El mapa se reemplaza entero: un día que se vació desaparece del
    // documento, en vez de quedar con el horario viejo.
    horarios,
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
