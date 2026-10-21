/**
 * LA DECISIÓN DE `cambiar-correo.mjs`, SIN NUBE: dada la cuenta (resuelta por el titular de un comercio), el correo
 * nuevo y las membresías que la cuenta tiene, qué se haría o por qué se rechaza. Pura, para probarla negando.
 *
 * Se rechaza, sin escribir, cuando: la cuenta está deshabilitada o tiene segundo factor; el correo nuevo no es un correo o es el actual; la cuenta ya ingresó alguna vez
 * (salvo `permitirIngresada`); tiene un proveedor distinto de contraseña (un Google no cambia de correo así); tiene
 * acceso a Bellido o Platinum; no tiene acceso a ningún comercio; le falta la membresía de un comercio de sus claims;
 * o el correo nuevo ya pertenece a OTRA cuenta. Si la cuenta ya tiene el correo nuevo (una corrida cortada a la
 * mitad), solo se completan las membresías pendientes.
 */
export const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const EXCLUIDOS = ['bellido', 'platinum'];
export const esExcluido = (t) => EXCLUIDOS.some((e) => String(t).toLowerCase().includes(e));

/** «a***@g***.com»: lo único que el script imprime de un correo. */
export const enmascarar = (c) => (typeof c === 'string' && c.includes('@') ? c.replace(/^(.).*@(.).*(\.[^.]+)$/, '$1***@$2***$3') : '(sin correo)');

export function planearCambioCorreo({ usuario, nuevo, uidDelNuevo = null, miembros = [], permitirIngresada = false }) {
  const problemas = [];
  const correoNuevo = String(nuevo ?? '').trim().toLowerCase();
  if (!usuario) return { error: 'la cuenta no existe' };
  if (!CORREO.test(correoNuevo)) problemas.push('--a no es un correo');
  const actual = String(usuario.email ?? '').toLowerCase();
  const yaCambiada = actual === correoNuevo;
  if (uidDelNuevo && uidDelNuevo !== usuario.uid) problemas.push('el correo nuevo ya pertenece a otra cuenta');
  const tenants = Object.keys(usuario.claims ?? {});
  if (tenants.length === 0) problemas.push('la cuenta no tiene acceso a ningún comercio');
  for (const t of tenants) if (esExcluido(t)) problemas.push(`la cuenta tiene acceso a ${t}: no se toca desde este script`);
  for (const t of tenants) if (!miembros.find((m) => m.tenant === t)?.existe) problemas.push(`falta la membresía en ${t}`);
  if (usuario.deshabilitada) problemas.push('la cuenta está deshabilitada');
  if (usuario.conSegundoFactor) problemas.push('la cuenta tiene un segundo factor inscrito: se cambia a mano');
  if (!yaCambiada) {
    if ((usuario.proveedores ?? []).some((p) => p !== 'password')) problemas.push('la cuenta tiene un proveedor distinto de contraseña');
    if (usuario.ultimoIngreso && !permitirIngresada) problemas.push('la cuenta ya ingresó alguna vez: agregue --aunque-haya-ingresado si es a propósito');
  }
  if (problemas.length) return { error: problemas.join('; ') };
  const pendientes = miembros.filter((m) => m.existe && String(m.correo ?? '').toLowerCase() !== correoNuevo).map((m) => m.tenant);
  return { uid: usuario.uid, nuevo: correoNuevo, tenants, haceAuth: !yaCambiada, miembros: pendientes, sinCambios: yaCambiada && pendientes.length === 0 };
}
