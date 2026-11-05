/**
 * EDITORES DEL miniCRM, LA LÓGICA PURA Y EL CLIENTE DE DRIVE (03/11/2026). Sin Firestore y sin red: el verificador
 * del token usa un `OAuth2Client` con certificados locales (firma, audiencia y vencimiento los comprueba la
 * biblioteca real) y el cliente de Drive recibe un `fetch` falso que anota cada llamada. Se escribe NEGANDO.
 */
import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ErrorDrive, ErrorPermisoNoRevocable, ErrorToken, OAuth2Client, abreviarCorreo, archivoDeEnlace, correoCuentaCrm, crearClienteDrive, crearVerificadorGoogle,
  hayCupo, normalizarCorreo, puedeApuntarA, verificadoPorDe, type Fetch,
} from '../../../functions/src/modulos/crm/editores-crm.ts';

const correoDe = (local: string, dominio = 'example.invalid') => [local, dominio].join('@');
const ID_HOJA = 'a'.repeat(12) + '_-' + 'B'.repeat(10);
const URL_HOJA = `https://docs.google.com/spreadsheets/d/${ID_HOJA}/edit#gid=0`;

describe('archivoDeEnlace: el archivo sale SOLO de la URL validada', () => {
  it('extrae el id de una hoja válida', () => {
    expect(archivoDeEnlace(URL_HOJA)).toBe(ID_HOJA);
  });
  it('NIEGA: otro dominio, http, javascript:, usuario, id corto, vacío o no texto', () => {
    for (const v of [
      `https://evil.example/spreadsheets/d/${ID_HOJA}`, `http://docs.google.com/spreadsheets/d/${ID_HOJA}`,
      `javascript:alert(1)//docs.google.com/spreadsheets/d/${ID_HOJA}`, `https://u${"@"}docs.google.com/spreadsheets/d/${ID_HOJA}`,
      'https://docs.google.com/spreadsheets/d/corto', `https://docs.google.com.evil.example/spreadsheets/d/${ID_HOJA}`,
      '', null, undefined, 42, { enlaceHoja: URL_HOJA },
    ]) expect(archivoDeEnlace(v), String(v)).toBeNull();
  });
});

describe('quién puede registrar a quién', () => {
  it('el operador solo apunta a sí mismo; el admin, a cualquiera', () => {
    expect(puedeApuntarA('oper', 'u1', 'u1')).toBe(true);
    expect(puedeApuntarA('oper', 'u1', 'u2')).toBe(false);
    expect(puedeApuntarA('admin', 'u1', 'u2')).toBe(true);
  });
  it('NIEGA: el operador con un correo de token distinto al de su login', () => {
    expect(verificadoPorDe('oper', 'u1', 'u1', correoDe('a'), correoDe('b'))).toBeNull();
    expect(verificadoPorDe('oper', 'u1', 'u1', null, correoDe('b'))).toBeNull();
  });
  it('NIEGA: el operador sobre otra persona, aunque el correo coincida', () => {
    expect(verificadoPorDe('oper', 'u1', 'u2', correoDe('a'), correoDe('a'))).toBeNull();
  });
  it('permite: el operador con su propio correo, y el admin con su correo, con otro y sobre terceros', () => {
    expect(verificadoPorDe('oper', 'u1', 'u1', correoDe('a'), correoDe('a'))).toBe('token-google');
    expect(verificadoPorDe('admin', 'u1', 'u1', correoDe('a'), correoDe('a'))).toBe('token-google');
    expect(verificadoPorDe('admin', 'u1', 'u1', correoDe('a'), correoDe('otro'))).toBe('admin');
    expect(verificadoPorDe('admin', 'u1', 'u2', correoDe('a'), correoDe('b'))).toBe('admin');
  });
  it('el tope: no cabe uno más al llegar al límite, salvo que el destino ya cuente', () => {
    expect(hayCupo(4, 5, false)).toBe(true);
    expect(hayCupo(5, 5, false)).toBe(false);
    expect(hayCupo(5, 5, true)).toBe(true);
    expect(hayCupo(7, 5, false)).toBe(false);
  });
});

describe('correos', () => {
  it('normaliza a minúsculas y rechaza lo que no es un correo', () => {
    expect(normalizarCorreo(`  ${correoDe('Ab')} `)).toBe(correoDe('ab'));
    for (const v of ['', 'sin-arroba', 'a@b', 'a b@c.d', 42, null, 'x'.repeat(300) + '@a.bc']) expect(normalizarCorreo(v), String(v)).toBeNull();
  });
  it('abreviar nunca devuelve el correo completo', () => {
    const c = correoDe('persona.larga');
    const a = abreviarCorreo(c);
    expect(a).not.toContain('persona.larga');
    expect(a.startsWith('p***@')).toBe(true);
  });
  it('la cuenta del tenant: forma fija y rechazo de ids raros', () => {
    expect(correoCuentaCrm('comercio-a', 'proyecto-demo')).toBe('crm-comercio-a@proyecto-demo.iam.gserviceaccount.com');
    for (const t of ['A', 'a--b', 'x', '../x', 'a b', '']) expect(correoCuentaCrm(t, 'proyecto-demo'), t).toBeNull();
    expect(correoCuentaCrm('comercio-a', '')).toBeNull();
    expect(correoCuentaCrm('comercio-a', 'X')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// El verificador, con la biblioteca real y certificados locales
// ---------------------------------------------------------------------------
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' }) as string;
const AUD = 'cliente-oauth-de-prueba.apps.example.invalid';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

function firmar(carga: Record<string, unknown>): string {
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = { iss: 'https://accounts.google.com', aud: AUD, sub: '1', iat: ahora - 10, exp: ahora + 3000, ...carga };
  const datos = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'k1' })}.${b64(cuerpo)}`;
  const firma = createSign('RSA-SHA256').update(datos).sign(privateKey).toString('base64url');
  return `${datos}.${firma}`;
}

class ClienteLocal extends OAuth2Client {
  override async getFederatedSignonCertsAsync() {
    return { certs: { k1: PEM }, format: 'pem' } as never;
  }
}
const verificador = (aud = AUD) => crearVerificadorGoogle(() => aud, new ClienteLocal());
const motivo = async (p: Promise<unknown>) => p.then(() => 'sin error', (e: unknown) => (e instanceof ErrorToken ? e.motivo : `otro: ${String(e)}`));

describe('verificador del ID token de Google', () => {
  it('control: un token bueno devuelve el correo DEL TOKEN en minúsculas', async () => {
    const r = await verificador()(firmar({ email: correoDe('Persona'), email_verified: true }));
    expect(r.correo).toBe(correoDe('persona'));
  });
  it('NIEGA: email_verified distinto de true (false, ausente o el texto «true»)', async () => {
    for (const ev of [false, undefined, 'true', 1]) {
      expect(await motivo(verificador()(firmar({ email: correoDe('p'), email_verified: ev }))), String(ev)).toBe('correo_no_verificado');
    }
  });
  it('NIEGA: audiencia errónea', async () => {
    expect(await motivo(verificador()(firmar({ email: correoDe('p'), email_verified: true, aud: 'otro-cliente' })))).toBe('invalido');
  });
  it('NIEGA: token vencido', async () => {
    const ahora = Math.floor(Date.now() / 1000);
    expect(await motivo(verificador()(firmar({ email: correoDe('p'), email_verified: true, iat: ahora - 7200, exp: ahora - 3600 })))).toBe('invalido');
  });
  it('NIEGA: emisor ajeno, firma de otra llave, texto basura y sin correo', async () => {
    expect(await motivo(verificador()(firmar({ email: correoDe('p'), email_verified: true, iss: 'https://evil.example' })))).toBe('invalido');
    const otra = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const datos = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'k1' })}.${b64({ iss: 'https://accounts.google.com', aud: AUD, sub: '1', email: correoDe('p'), email_verified: true, exp: Math.floor(Date.now() / 1000) + 3000 })}`;
    const falso = `${datos}.${createSign('RSA-SHA256').update(datos).sign(otra).toString('base64url')}`;
    expect(await motivo(verificador()(falso))).toBe('invalido');
    expect(await motivo(verificador()('no-es-un-token'))).toBe('invalido');
    expect(await motivo(verificador()(firmar({ email_verified: true })))).toBe('invalido');
  });
  it('NIEGA: audiencia vacía o de solo espacios = falla cerrada, ni siquiera se consulta al cliente', async () => {
    let llamadas = 0;
    const espia = { verifyIdToken: async () => { llamadas++; throw new Error('no debía llamarse'); } };
    for (const aud of ['', '   ']) {
      expect(await motivo(crearVerificadorGoogle(() => aud, espia as never)('x'))).toBe('sin_audiencia');
    }
    expect(llamadas).toBe(0);
  });
  it('el error nunca lleva el token', async () => {
    const token = firmar({ email: correoDe('p'), email_verified: true, aud: 'otro' });
    const e = await verificador()(token).catch((x: unknown) => x as Error);
    expect(String((e as Error).message) + String((e as Error).stack)).not.toContain(token.slice(-40));
  });
});

// ---------------------------------------------------------------------------
// El cliente de Drive, con un fetch falso
// ---------------------------------------------------------------------------
interface Llamada { url: string; method: string; headers: Record<string, string>; body: unknown }
function fetchFalso(respuestas: (l: Llamada) => { status?: number; cuerpo?: unknown }) {
  const llamadas: Llamada[] = [];
  const f: Fetch = async (url, init) => {
    const l: Llamada = { url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : undefined };
    llamadas.push(l);
    const r = respuestas(l);
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.cuerpo ?? {} };
  };
  return { f, llamadas };
}
const TOKEN_FUNCTION = 'token-de-la-function-secreto';
const TOKEN_CUENTA = 'token-de-la-cuenta-secreto';
const CUENTA = 'crm-comercio-a@proyecto-demo.iam.gserviceaccount.com';
const esIam = (l: Llamada) => new URL(l.url).hostname === 'iamcredentials.googleapis.com';

describe('cliente de Drive', () => {
  it('alta: suplanta a la cuenta del tenant con alcance drive y crea writer/user con sendNotificationEmail=false', async () => {
    const { f, llamadas } = fetchFalso((l) => esIam(l) ? { cuerpo: { accessToken: TOKEN_CUENTA } }
      : l.method === 'GET' ? { cuerpo: { permissions: [] } } : { cuerpo: { id: 'perm-1' } });
    const r = await crearClienteDrive({ cuentaServicio: CUENTA, fetch: f, tokenDeLaFunction: async () => TOKEN_FUNCTION })
      .crearPermiso(ID_HOJA, correoDe('persona'));
    expect(r).toEqual({ permisoId: 'perm-1', creado: true });
    const iam = llamadas.find(esIam)!;
    expect(iam.url).toContain(`/serviceAccounts/${encodeURIComponent(CUENTA)}:generateAccessToken`);
    expect(iam.headers['authorization']).toBe(`Bearer ${TOKEN_FUNCTION}`);
    expect(iam.body).toEqual({ scope: ['https://www.googleapis.com/auth/drive'] });
    const crear = llamadas.find((l) => l.method === 'POST' && !esIam(l))!;
    expect(crear.url).toContain(`/drive/v3/files/${ID_HOJA}/permissions?`);
    expect(crear.url).toContain('sendNotificationEmail=false');
    expect(crear.headers['authorization']).toBe(`Bearer ${TOKEN_CUENTA}`);
    expect(crear.body).toEqual({ role: 'writer', type: 'user', emailAddress: correoDe('persona') });
  });
  it('NIEGA: jamás type anyone/domain ni sendNotificationEmail=true en ninguna llamada', async () => {
    const { f, llamadas } = fetchFalso((l) => esIam(l) ? { cuerpo: { accessToken: TOKEN_CUENTA } }
      : l.method === 'GET' ? { cuerpo: { permissions: [] } } : { cuerpo: { id: 'perm-1' } });
    await crearClienteDrive({ cuentaServicio: CUENTA, fetch: f, tokenDeLaFunction: async () => TOKEN_FUNCTION })
      .crearPermiso(ID_HOJA, correoDe('persona'));
    const todo = JSON.stringify(llamadas);
    expect(todo).not.toMatch(/anyone|domain/);
    expect(todo).not.toContain('sendNotificationEmail=true');
    for (const l of llamadas.filter((x) => x.method === 'POST' && !esIam(x))) {
      expect((l.body as { type: string }).type).toBe('user');
      expect(l.url).toContain('sendNotificationEmail=false');
    }
  });
  it('idempotente: si el permiso ya existe con rol de escritura, reutiliza su id y no crea otro', async () => {
    const { f, llamadas } = fetchFalso((l) => esIam(l) ? { cuerpo: { accessToken: TOKEN_CUENTA } }
      : { cuerpo: { permissions: [{ id: 'perm-9', type: 'user', role: 'writer', emailAddress: correoDe('Persona') }] } });
    const r = await crearClienteDrive({ cuentaServicio: CUENTA, fetch: f, tokenDeLaFunction: async () => TOKEN_FUNCTION })
      .crearPermiso(ID_HOJA, correoDe('persona'));
    expect(r).toEqual({ permisoId: 'perm-9', creado: false });
    expect(llamadas.filter((l) => l.method === 'POST' && !esIam(l))).toHaveLength(0);
  });
  it('un permiso de solo lectura no se reutiliza: se crea el de escritura', async () => {
    const { f, llamadas } = fetchFalso((l) => esIam(l) ? { cuerpo: { accessToken: TOKEN_CUENTA } }
      : l.method === 'GET' ? { cuerpo: { permissions: [{ id: 'perm-9', type: 'user', role: 'reader', emailAddress: correoDe('persona') }] } }
        : { cuerpo: { id: 'perm-10' } });
    const r = await crearClienteDrive({ cuentaServicio: CUENTA, fetch: f, tokenDeLaFunction: async () => TOKEN_FUNCTION })
      .crearPermiso(ID_HOJA, correoDe('persona'));
    expect(r).toEqual({ permisoId: 'perm-10', creado: true });
    expect(llamadas.filter((l) => l.method === 'POST' && !esIam(l))).toHaveLength(1);
  });
  it('NIEGA: si el Gmail ya es propietario u organizador de la hoja se rechaza (no se podría revocar) y no se crea nada', async () => {
    for (const role of ['owner', 'organizer', 'fileOrganizer']) {
      const { f, llamadas } = fetchFalso((l) => esIam(l) ? { cuerpo: { accessToken: TOKEN_CUENTA } }
        : { cuerpo: { permissions: [{ id: 'perm-7', type: 'user', role, emailAddress: correoDe('persona') }] } });
      await expect(crearClienteDrive({ cuentaServicio: CUENTA, fetch: f, tokenDeLaFunction: async () => TOKEN_FUNCTION })
        .crearPermiso(ID_HOJA, correoDe('persona')), role).rejects.toBeInstanceOf(ErrorPermisoNoRevocable);
      expect(llamadas.filter((l) => l.method === 'POST' && !esIam(l)), role).toHaveLength(0);
    }
  });
  it('baja: un DELETE al permiso; 404 cuenta como borrado; otro fallo lanza ErrorDrive con solo el estado', async () => {
    let status = 204;
    const { f, llamadas } = fetchFalso((l) => esIam(l) ? { cuerpo: { accessToken: TOKEN_CUENTA } } : { status });
    const drive = crearClienteDrive({ cuentaServicio: CUENTA, fetch: f, tokenDeLaFunction: async () => TOKEN_FUNCTION });
    await drive.borrarPermiso(ID_HOJA, 'perm-1');
    expect(llamadas.some((l) => l.method === 'DELETE' && l.url.endsWith(`/files/${ID_HOJA}/permissions/perm-1`))).toBe(true);
    status = 404;
    await drive.borrarPermiso(ID_HOJA, 'perm-1');
    status = 500;
    const e = await drive.borrarPermiso(ID_HOJA, 'perm-1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorDrive);
    expect((e as ErrorDrive).estado).toBe(500);
    expect(String((e as Error).message)).not.toContain(TOKEN_CUENTA);
  });
  it('NIEGA: un id de permiso con barras o caracteres raros no llega a la ruta', async () => {
    const { f, llamadas } = fetchFalso(() => ({ cuerpo: { accessToken: TOKEN_CUENTA } }));
    const drive = crearClienteDrive({ cuentaServicio: CUENTA, fetch: f, tokenDeLaFunction: async () => TOKEN_FUNCTION });
    for (const id of ['../x', 'a/b', '', 'a b']) await expect(drive.borrarPermiso(ID_HOJA, id), id).rejects.toBeInstanceOf(ErrorDrive);
    expect(llamadas).toHaveLength(0);
  });
  it('si IAM no entrega el token de la cuenta, nada se envía a Drive', async () => {
    const { f, llamadas } = fetchFalso((l) => esIam(l) ? { status: 403 } : {});
    const drive = crearClienteDrive({ cuentaServicio: CUENTA, fetch: f, tokenDeLaFunction: async () => TOKEN_FUNCTION });
    await expect(drive.crearPermiso(ID_HOJA, correoDe('p'))).rejects.toBeInstanceOf(ErrorDrive);
    await expect(drive.borrarPermiso(ID_HOJA, 'perm-1')).rejects.toBeInstanceOf(ErrorDrive);
    expect(llamadas.every(esIam)).toBe(true);
  });
});
