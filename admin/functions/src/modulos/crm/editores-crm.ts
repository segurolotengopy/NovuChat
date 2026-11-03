/**
 * EDITORES DEL miniCRM: la lógica pura y el cliente de Drive (03/11/2026, plan «edición del miniCRM por Gmail»).
 *
 * Sin Firestore y sin Firebase: lo que decide quién puede registrar a quién, de dónde sale el archivo que se
 * comparte, cómo se verifica la cuenta de Google y cómo se habla con Drive. Los callables (`editoresCrm.ts`)
 * solo juntan esto con Firestore.
 *
 * HALLAZGO QUE CAMBIA EL DISEÑO: NO se vincula Google al usuario de Firebase. `core/seguridad/claims.ts` impone
 * «una identidad, un proveedor» (admin y operador = solo contraseña). El ID token de Google que llega aquí NO
 * inicia sesión ni crea nada: solo prueba que la persona controla ese Gmail, y se verifica en el servidor.
 *
 * Reglas de oro:
 *   · el correo sale DEL TOKEN verificado (con `email_verified === true`), nunca del cuerpo de la petición;
 *   · el archivo sale SOLO de la URL validada de `tenants/{t}/enlaces/minicrm` del tenant autenticado;
 *   · jamás `type: anyone` ni `domain`; siempre `sendNotificationEmail=false`;
 *   · ni el token, ni la clave, ni el correo completo van a un registro o a un mensaje de error.
 */
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { esEnlaceDeHoja } from '../../central/enlace-minicrm.js';

/** Reexportado para que las pruebas (que no resuelven los paquetes de `functions/`) armen un cliente con certificados locales. */
export { OAuth2Client };

export type EstadoEditor = 'activo' | 'revocado' | 'revocado_pendiente';
export type RolQueLlama = 'admin' | 'oper';
export type VerificadoPor = 'token-google' | 'admin';

/** La forma de un uid de Firebase Auth: sin barras ni nada que cambie la ruta del documento. */
export const UID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const CORREO_VALIDO = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$/;
const ARCHIVO_DE_HOJA = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{10,100})/;

/** El id del archivo de Drive, sacado de una URL que pasó `esEnlaceDeHoja`; `null` si no es una hoja válida. */
export function archivoDeEnlace(enlace: unknown): string | null {
  if (!esEnlaceDeHoja(enlace)) return null;
  return ARCHIVO_DE_HOJA.exec(enlace)?.[1] ?? null;
}

export function normalizarCorreo(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const c = v.trim().toLowerCase();
  return c.length <= 254 && CORREO_VALIDO.test(c) ? c : null;
}

/** Para auditoría y mensajes: nunca el correo completo (`a***@dominio`). */
export function abreviarCorreo(correo: string): string {
  const [local = '', dominio = ''] = correo.split('@');
  return `${local.slice(0, 1)}***@${dominio}`;
}

/**
 * ¿Puede quien llama apuntar a ese destino? El administrador da de alta a terceros; el operador solo a sí mismo
 * (Andres, 03/11/2026, decisión 2). Se decide ANTES de verificar el token: un operador que apunta a otro no
 * gasta una verificación ni averigua nada.
 */
export function puedeApuntarA(rol: RolQueLlama, uidActor: string, uidDestino: string): boolean {
  return rol === 'admin' || uidActor === uidDestino;
}

/**
 * Decide con quién se queda el correo del token. Devuelve `verificadoPor` o `null` si no se permite.
 *   · operador: el correo del token DEBE ser el de su login;
 *   · administrador sobre sí mismo con el correo de su login: `token-google`;
 *   · administrador con otro Gmail, o sobre un tercero: `admin` (el token sigue siendo de esa cuenta).
 */
export function verificadoPorDe(
  rol: RolQueLlama, uidActor: string, uidDestino: string, correoLogin: string | null, correoToken: string,
): VerificadoPor | null {
  if (!puedeApuntarA(rol, uidActor, uidDestino)) return null;
  const mismo = correoLogin !== null && correoLogin === correoToken;
  if (rol === 'oper') return mismo ? 'token-google' : null;
  return uidActor === uidDestino && mismo ? 'token-google' : 'admin';
}

/** ¿Cabe uno más? `yaCuenta`: el destino ya figura activo (reintento o cambio de correo): no suma. */
export function hayCupo(activos: number, limite: number, yaCuenta: boolean): boolean {
  return yaCuenta || activos < limite;
}

// ---------------------------------------------------------------------------
// VERIFICACIÓN DEL ID TOKEN DE GOOGLE
// ---------------------------------------------------------------------------
export type MotivoToken = 'sin_audiencia' | 'invalido' | 'correo_no_verificado';
export class ErrorToken extends Error {
  constructor(readonly motivo: MotivoToken) { super(motivo); }
}

export type VerificarTokenGoogle = (idToken: string) => Promise<{ correo: string }>;

/**
 * El verificador real: `OAuth2Client.verifyIdToken` con la audiencia del cliente OAuth del proyecto. Firma, emisor,
 * audiencia y vencimiento los comprueba la biblioteca; aquí se exige además `email_verified === true` y se toma el
 * correo DEL TOKEN. Audiencia vacía = falla cerrada (nada se verifica contra «cualquiera»). El mensaje de error
 * nunca lleva el token.
 */
export function crearVerificadorGoogle(
  audiencia: () => string, cliente: Pick<OAuth2Client, 'verifyIdToken'> = new OAuth2Client(),
): VerificarTokenGoogle {
  return async (idToken) => {
    const aud = audiencia().trim();
    if (aud === '') throw new ErrorToken('sin_audiencia');
    let carga;
    try {
      const ticket = await cliente.verifyIdToken({ idToken, audience: aud });
      carga = ticket.getPayload();
    } catch {
      throw new ErrorToken('invalido');
    }
    if (!carga || carga.email_verified !== true) throw new ErrorToken('correo_no_verificado');
    const correo = normalizarCorreo(carga.email);
    if (correo === null) throw new ErrorToken('invalido');
    return { correo };
  };
}

// ---------------------------------------------------------------------------
// DRIVE
// ---------------------------------------------------------------------------
export interface ClienteDrive {
  /** Idempotente: si el permiso ya existe (rol de escritura), devuelve su id sin duplicar. */
  crearPermiso(archivoId: string, correo: string): Promise<{ permisoId: string }>;
  /** Idempotente: un permiso que ya no existe (404) cuenta como borrado. Lanza `ErrorDrive` en cualquier otro fallo. */
  borrarPermiso(archivoId: string, permisoId: string): Promise<void>;
}

/** Un fallo de Drive o de IAM: solo el estado HTTP, nunca el cuerpo (puede llevar correos o tokens). */
export class ErrorDrive extends Error {
  constructor(readonly estado: number) { super(`Drive/IAM ${estado}`); }
}

const DRIVE = 'https://www.googleapis.com/drive/v3';
const IAM = 'https://iamcredentials.googleapis.com/v1';
const ALCANCE_DRIVE = 'https://www.googleapis.com/auth/drive';
const ROLES_DE_ESCRITURA = new Set(['writer', 'fileOrganizer', 'organizer', 'owner']);
const PAGINAS_MAXIMAS = 5;

const ID_TENANT_CUENTA = /^[a-z][a-z0-9-]{1,24}[a-z0-9]$/;
const ID_PROYECTO = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** `crm-<tenant>@<proyecto>.iam.gserviceaccount.com`, la misma forma que `scripts/plataforma/crm-cuenta-servicio.mjs`. */
export function correoCuentaCrm(tenantId: string, proyecto: string): string | null {
  if (!ID_TENANT_CUENTA.test(tenantId) || tenantId.includes('--') || !ID_PROYECTO.test(proyecto)) return null;
  return `crm-${tenantId}@${proyecto}.iam.gserviceaccount.com`;
}

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** El token de la identidad de la Function (cuenta de ejecución), solo para pedir el de la cuenta del tenant. */
export type TokenDeLaFunction = () => Promise<string>;

export const tokenDeLaFunctionReal: TokenDeLaFunction = async () => {
  const token = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getAccessToken();
  if (!token) throw new ErrorDrive(401);
  return token;
};

/**
 * El cliente real de Drive. Suplanta (IAM Credentials `generateAccessToken`) a la cuenta `crm-<tenant>`, que es
 * Editora de la hoja de ESE cliente y de ninguna otra, con el alcance `drive`. No lee ni guarda ninguna clave.
 * Llamadas por alta: 1 `permissions.list` + 0 o 1 `permissions.create`; por baja: 1 `permissions.delete`
 * (más 1 `generateAccessToken` por operación).
 */
export function crearClienteDrive(opciones: {
  cuentaServicio: string; fetch?: Fetch; tokenDeLaFunction?: TokenDeLaFunction;
}): ClienteDrive {
  const pedir: Fetch = opciones.fetch ?? ((url, init) => fetch(url, init as RequestInit) as ReturnType<Fetch>);
  const tokenFunction = opciones.tokenDeLaFunction ?? tokenDeLaFunctionReal;

  async function tokenDeLaCuenta(): Promise<string> {
    const r = await pedir(`${IAM}/projects/-/serviceAccounts/${encodeURIComponent(opciones.cuentaServicio)}:generateAccessToken`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await tokenFunction()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ scope: [ALCANCE_DRIVE] }),
    });
    if (!r.ok) throw new ErrorDrive(r.status);
    const cuerpo = (await r.json()) as { accessToken?: unknown };
    if (typeof cuerpo.accessToken !== 'string' || cuerpo.accessToken === '') throw new ErrorDrive(502);
    return cuerpo.accessToken;
  }

  const cabeceras = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

  return {
    async crearPermiso(archivoId, correo) {
      const token = await tokenDeLaCuenta();
      const base = `${DRIVE}/files/${encodeURIComponent(archivoId)}/permissions`;
      let pagina = '';
      for (let i = 0; i < PAGINAS_MAXIMAS; i++) {
        const q = `fields=${encodeURIComponent('nextPageToken,permissions(id,type,role,emailAddress)')}&pageSize=100${pagina}`;
        const r = await pedir(`${base}?${q}`, { method: 'GET', headers: cabeceras(token) });
        if (!r.ok) throw new ErrorDrive(r.status);
        const cuerpo = (await r.json()) as { permissions?: unknown; nextPageToken?: unknown };
        const lista = Array.isArray(cuerpo.permissions) ? cuerpo.permissions as Record<string, unknown>[] : [];
        const hay = lista.find((p) => p['type'] === 'user' && typeof p['emailAddress'] === 'string'
          && p['emailAddress'].toLowerCase() === correo && typeof p['id'] === 'string'
          && typeof p['role'] === 'string' && ROLES_DE_ESCRITURA.has(p['role']));
        if (hay) return { permisoId: hay['id'] as string };
        if (typeof cuerpo.nextPageToken !== 'string' || cuerpo.nextPageToken === '') break;
        pagina = `&pageToken=${encodeURIComponent(cuerpo.nextPageToken)}`;
      }
      const c = await pedir(`${base}?sendNotificationEmail=false&fields=id`, {
        method: 'POST',
        headers: cabeceras(token),
        body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: correo }),
      });
      if (!c.ok) throw new ErrorDrive(c.status);
      const creado = (await c.json()) as { id?: unknown };
      if (typeof creado.id !== 'string' || creado.id === '') throw new ErrorDrive(502);
      return { permisoId: creado.id };
    },

    async borrarPermiso(archivoId, permisoId) {
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(permisoId)) throw new ErrorDrive(400);
      const token = await tokenDeLaCuenta();
      const r = await pedir(
        `${DRIVE}/files/${encodeURIComponent(archivoId)}/permissions/${encodeURIComponent(permisoId)}`,
        { method: 'DELETE', headers: cabeceras(token) },
      );
      if (!r.ok && r.status !== 404) throw new ErrorDrive(r.status);
    },
  };
}
