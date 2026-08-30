import { getAuth } from 'firebase-admin/auth';

/**
 * Emisión de custom claims. ESTE ES EL ÚNICO LUGAR DEL SISTEMA QUE OTORGA
 * PERMISOS. Todo lo demás los consume.
 *
 * FORMA DEL CLAIM
 *   { nc: { p?: true, t: { "<tenantId>": "admin" | "oper" | "ingesta" }, v: n } }
 *
 * POR QUÉ CLAVES DE UNA LETRA
 * ---------------------------
 * Firebase impone un tope DURO de 1000 bytes al conjunto de custom claims. Con
 * claves largas (`roles`, `tenantId`, `propietario`) un usuario que administre
 * ocho o diez negocios revienta el tope y el `setCustomUserClaims` falla en
 * producción, con el usuario ya creado. Con este formato entran del orden de 15
 * a 20 tenants por usuario, que es de sobra para el modelo comercial (un dueño
 * de PyME administra uno, a lo sumo tres locales).
 *
 * Si algún día hiciera falta un usuario con más tenants que eso, la salida NO es
 * agrandar el claim sino cambiar el criterio de pertenencia a una lectura de
 * documento en las reglas (`get(/tenants/$(t)/miembros/$(uid))`), que no tiene
 * tope pero cuesta una lectura por consulta. Está analizado en admin/DISENO.md.
 */

export type Rol = 'admin' | 'oper' | 'ingesta';

/**
 * ===========================================================================
 * VÍNCULO ROL ↔ PROVEEDOR DE IDENTIDAD — LA MITAD DE SERVIDOR
 * ===========================================================================
 *
 * `firestore.rules` ya exige que la SESIÓN venga del proveedor correcto
 * (`sign_in_provider`). Esta comprobación es la otra mitad: impide que el claim
 * llegue a existir sobre una IDENTIDAD del tipo equivocado.
 *
 * POR QUÉ HACEN FALTA LAS DOS. La de las reglas protege cada lectura y cada
 * escritura, y es la que no se puede eludir. La de acá evita que el sistema
 * quede en un estado incoherente —un administrador de comercio con `p: true`
 * guardado— que después alguien "arregla" relajando una regla porque "el claim
 * está bien puesto, algo falla". Un estado imposible no hay que explicarlo.
 *
 * REGLA: UNA IDENTIDAD, UN PROVEEDOR.
 *   superadministrador → la cuenta debe tener Google y NO tener contraseña
 *   admin / operador   → la cuenta debe tener contraseña y NO tener Google
 *
 * Se rechaza el caso de cuenta VINCULADA (los dos proveedores sobre el mismo
 * uid) aunque las reglas ya lo neutralizarían: una identidad ambigua es una
 * fuente permanente de razonamientos equivocados sobre quién puede qué.
 */
const PROVEEDOR_GOOGLE = 'google.com';
const PROVEEDOR_PASSWORD = 'password';

function proveedoresDe(usuario: { providerData: Array<{ providerId: string }> }): Set<string> {
  return new Set(usuario.providerData.map((p) => p.providerId));
}

async function exigirProveedor(uid: string, requerido: string, prohibido: string): Promise<void> {
  const usuario = await getAuth().getUser(uid);
  const proveedores = proveedoresDe(usuario);
  if (!proveedores.has(requerido)) {
    throw new Error(
      `La cuenta ${uid} no tiene el proveedor «${requerido}», que este rol exige. ` +
      'Superadministradores de NovuChat: solo cuenta de Google. ' +
      'Administradores y operadores de comercio: solo usuario y contraseña.',
    );
  }
  if (proveedores.has(prohibido)) {
    throw new Error(
      `La cuenta ${uid} tiene también «${prohibido}». Una identidad, un proveedor: ` +
      'desvincule el otro método antes de asignar este rol.',
    );
  }
}


const TOPE_CLAIMS_BYTES = 1000;
// Margen: Firebase cuenta el JSON completo de los custom claims.
const MARGEN_SEGURIDAD = 100;

interface ClaimNovuChat {
  p?: true;
  t: Record<string, Rol>;
  v: number;
}

const leerClaim = (claims: Record<string, unknown> | undefined): ClaimNovuChat => {
  const nc = claims?.['nc'];
  if (typeof nc !== 'object' || nc === null) return { t: {}, v: 0 };
  const bruto = nc as Record<string, unknown>;
  const t = (typeof bruto['t'] === 'object' && bruto['t'] !== null)
    ? (bruto['t'] as Record<string, Rol>) : {};
  return {
    ...(bruto['p'] === true ? { p: true as const } : {}),
    t,
    v: typeof bruto['v'] === 'number' ? bruto['v'] : 0,
  };
};

/**
 * Asigna (o quita, con rol `null`) el rol de un usuario en un tenant.
 *
 * `revocarSesiones` invalida los refresh tokens del usuario. Sin eso, el usuario
 * conserva los permisos viejos hasta que caduque su ID token: hasta una hora de
 * ventana en la que un empleado despedido sigue leyendo conversaciones.
 */
export async function asignarRol(
  uid: string,
  tenantId: string,
  rol: Rol | null,
  opciones: { revocarSesiones?: boolean } = {},
): Promise<void> {
  const auth = getAuth();

  // Solo al OTORGAR. Quitar un rol nunca se bloquea por el proveedor: si hay que
  // sacarle el acceso a alguien, se le saca, y no importa cómo entró.
  if (rol === 'admin' || rol === 'oper') {
    await exigirProveedor(uid, PROVEEDOR_PASSWORD, PROVEEDOR_GOOGLE);
  }
  if (rol === 'ingesta') {
    // El principal de servicio no es una persona y no debe tener ningún método
    // de acceso interactivo: llega solo con tokens personalizados.
    const proveedores = proveedoresDe(await auth.getUser(uid));
    if (proveedores.size > 0) {
      throw new Error(
        `La cuenta ${uid} tiene proveedores de acceso interactivo y no puede ser ` +
        'principal de ingesta. Ese rol es solo para identidades de servicio.',
      );
    }
  }

  const usuario = await auth.getUser(uid);
  const actual = leerClaim(usuario.customClaims);

  const tenants = { ...actual.t };
  if (rol === null) delete tenants[tenantId];
  else tenants[tenantId] = rol;

  const nuevo: ClaimNovuChat = { ...actual, t: tenants, v: actual.v + 1 };
  const bytes = Buffer.byteLength(JSON.stringify({ nc: nuevo }), 'utf8');
  if (bytes > TOPE_CLAIMS_BYTES - MARGEN_SEGURIDAD) {
    throw new Error(
      `Los custom claims de ${uid} llegarían a ${bytes} bytes y el tope es ${TOPE_CLAIMS_BYTES}. ` +
      'Este usuario pertenece a demasiados negocios: ver admin/DISENO.md, §Tope de los custom claims.',
    );
  }

  await auth.setCustomUserClaims(uid, { nc: nuevo });
  if (opciones.revocarSesiones ?? rol === null) await auth.revokeRefreshTokens(uid);
}

/** Marca (o desmarca) a alguien como propietario de la plataforma NovuChat. */
export async function asignarPropietario(uid: string, esPropietario: boolean): Promise<void> {
  const auth = getAuth();

  // El rol más poderoso del sistema exige la cuenta de Google, cuyo segundo
  // factor lo administra Google. Con esto, la superficie de ataque de la
  // plataforma es "comprometer la cuenta de Google de Andres o de Silvana", no
  // "adivinar una contraseña".
  if (esPropietario) await exigirProveedor(uid, PROVEEDOR_GOOGLE, PROVEEDOR_PASSWORD);

  const usuario = await auth.getUser(uid);
  const actual = leerClaim(usuario.customClaims);
  const nuevo: ClaimNovuChat = esPropietario
    ? { ...actual, p: true, v: actual.v + 1 }
    : { t: actual.t, v: actual.v + 1 };
  await auth.setCustomUserClaims(uid, { nc: nuevo });
  await auth.revokeRefreshTokens(uid);
}
