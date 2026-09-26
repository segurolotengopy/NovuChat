/**
 * EL ERROR DEL SERVIDOR, TAL CUAL. Las Functions escriben mensajes para quien
 * opera («El umbral de bloqueo tiene que ser mayor que el de operador», «El
 * comercio no tiene cuenta: primero asignar-plan.mjs»). Se muestran como
 * vienen y no se tapan con «ocurrió un error», que obligaría a mirar el
 * registro del servidor para saber qué pasó (`CLAUDE.md` §7: la pantalla
 * acompaña, el servidor manda). Solo se cae al respaldo si no hay mensaje o si
 * es el «internal» genérico del SDK.
 *
 * Módulo puro, compartido por Central y Plataforma.
 */
export function mensajeDeError(e: unknown, respaldo: string): string {
  const mensaje = (e as { message?: unknown } | undefined)?.message;
  return typeof mensaje === 'string' && mensaje.trim() !== '' && !/^internal$/i.test(mensaje)
    ? mensaje : respaldo;
}
