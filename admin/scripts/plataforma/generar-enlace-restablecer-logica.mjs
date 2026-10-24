/**
 * LA DECISIÓN DE `generar-enlace-restablecer.mjs`, SIN NUBE: ¿se puede generar un enlace de contraseña para esta
 * cuenta? Un enlace así ES la credencial (quien lo tenga fija la contraseña), así que solo se genera para una cuenta de
 * persona de un comercio que ya existe, activa y con rol, nunca para Bellido ni Platinum, ni para una cuenta con
 * Google, deshabilitada o con segundo factor. Devuelve el motivo del rechazo o `null`.
 */
const EXCLUIDOS = ['bellido', 'platinum'];
export const esExcluido = (t) => EXCLUIDOS.some((e) => String(t).toLowerCase().includes(e));

export function motivoSiNoSePuede({ tenant, ficha, usuario, miembro }) {
  if (esExcluido(tenant)) return `${tenant} no se toca desde este script`;
  if (!ficha) return 'el comercio no existe';
  if (!usuario) return 'no hay ninguna cuenta con ese correo: este script no crea cuentas';
  if (usuario.deshabilitada) return 'la cuenta está deshabilitada';
  if (usuario.conSegundoFactor) return 'la cuenta tiene un segundo factor inscrito: se resuelve a mano';
  if ((usuario.proveedores ?? []).some((p) => p !== 'password')) return 'la cuenta tiene un proveedor distinto de contraseña';
  if (usuario.propietario) return 'la cuenta es propietaria de la plataforma: no se toca desde este script';
  const rol = (usuario.claims ?? {})[tenant];
  if (rol !== 'admin' && rol !== 'oper') return `la cuenta no tiene rol en ${tenant}`;
  if (!miembro || miembro.estado !== 'activo') return 'la cuenta no es miembro activo de ese comercio';
  if (miembro.rol !== rol) return 'el rol de la membresía no coincide con el de sus claims: se resuelve a mano';
  return null;
}
