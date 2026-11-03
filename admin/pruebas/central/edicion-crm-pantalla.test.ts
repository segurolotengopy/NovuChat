/**
 * EDICIÓN DEL miniCRM CON LA CUENTA DE GOOGLE — LA PANTALLA (03/11/2026). Sin navegador ni red. Se prueba NEGANDO:
 *   P1. Qué se muestra según rol y estado; sin client id no se pinta nada.
 *   P2. Los errores del servidor no se muestran crudos; cada código tiene su texto.
 *   P3. El texto de fuente: sin vincular Google al usuario de Firebase, el token no se imprime ni se guarda, el operador no apunta a otros.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  abreviarCorreoVista, accionesDeMiembro, clientIdGoogle, leerMiEdicion, textoErrorEdicion, textoResultadoQuitar, vistaDeEdicion,
  type EstadoEdicion,
} from '../../web/src/central/lib/edicionCrm';

const ADMIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (r: string) => readFileSync(join(ADMIN, r), 'utf8');
const sinComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const HOJA = 'https://docs.google.com/spreadsheets/d/' + 'AbCdEfGhIjKlMnOp';
const ID = 'cliente-de-prueba.apps';

describe('P1. qué se muestra', () => {
  it('sin client id no se pinta nada, sea quien sea', () => {
    for (const clientId of [null, clientIdGoogle(undefined), clientIdGoogle(''), clientIdGoogle('corto')]) {
      expect(vistaDeEdicion({ clientId, esAdmin: true, esOper: false, miEdicion: leerMiEdicion({ estado: 'ninguno' }) }).visible).toBe(false);
    }
    expect(clientIdGoogle(ID)).toBe(ID);
  });
  it('sin rol del negocio o sin respuesta del servidor, tampoco', () => {
    expect(vistaDeEdicion({ clientId: ID, esAdmin: false, esOper: false, miEdicion: leerMiEdicion({}) }).visible).toBe(false);
    expect(vistaDeEdicion({ clientId: ID, esAdmin: true, esOper: false, miEdicion: null }).visible).toBe(false);
  });
  it('ninguno/revocado ofrecen habilitar; activo, quitar y enlace; pendiente, aviso y quitar', () => {
    const v = (estado: EstadoEdicion, enlaceHoja: string | null = null) =>
      vistaDeEdicion({ clientId: ID, esAdmin: false, esOper: true, miEdicion: leerMiEdicion({ estado, enlaceHoja, correo: 'ab***@gmail.com' }) });
    expect(v('ninguno')).toMatchObject({ visible: true, puedeHabilitar: true, puedeQuitar: false, verEnlace: false });
    expect(v('revocado')).toMatchObject({ puedeHabilitar: true, puedeQuitar: false });
    expect(v('activo', HOJA)).toMatchObject({ puedeHabilitar: false, puedeQuitar: true, verEnlace: true });
    expect(v('activo', null)).toMatchObject({ verEnlace: false });
    expect(v('revocado_pendiente')).toMatchObject({ puedeHabilitar: false, puedeQuitar: true, aviso: 'pendiente' });
  });
  it('NIEGA: un enlace que no es de una hoja de Google no se pinta; un estado raro es «ninguno»', () => {
    for (const e of ['javascript:alert(1)', 'https://evil.example/x', 5, null]) expect(leerMiEdicion({ estado: 'activo', enlaceHoja: e }).enlaceHoja).toBeNull();
    expect(leerMiEdicion({ estado: 'otro' }).estado).toBe('ninguno');
    expect(leerMiEdicion({ estado: 'ninguno', enlaceHoja: HOJA }).enlaceHoja).toBeNull();
  });
  it('el correo se muestra abreviado, nunca completo', () => {
    expect(abreviarCorreoVista('persona' + String.fromCharCode(64) + 'gmail.com')).toBe('pe***' + String.fromCharCode(64) + 'gmail.com');
    expect(abreviarCorreoVista(5)).toBe('');
  });
  it('en Usuarios: solo el admin ve acciones sobre terceros; el operador, ninguna', () => {
    const a = (esAdmin: boolean, estado: EstadoEdicion, miembroActivo = true, clientId: string | null = ID) =>
      accionesDeMiembro({ clientId, esAdmin, estado, miembroActivo });
    expect(a(true, 'ninguno')).toEqual({ habilitar: true, quitar: false });
    expect(a(true, 'activo')).toEqual({ habilitar: false, quitar: true });
    expect(a(true, 'revocado_pendiente').quitar).toBe(true);
    expect(a(false, 'ninguno')).toEqual({ habilitar: false, quitar: false });
    expect(a(false, 'activo')).toEqual({ habilitar: false, quitar: false });
    expect(a(true, 'ninguno', false).habilitar).toBe(false);
    expect(a(true, 'ninguno', true, null)).toEqual({ habilitar: false, quitar: false });
  });
});

describe('P2. errores y resultados', () => {
  it('cada código tiene su texto y el del servidor no se muestra crudo', () => {
    const crudo = 'Detalle interno del servidor XYZ';
    const textos = new Set<string>();
    for (const code of ['failed-precondition', 'already-exists', 'resource-exhausted', 'unavailable', 'permission-denied', 'unauthenticated', 'aborted', 'not-found']) {
      const t = textoErrorEdicion({ code: `functions/${code}`, message: crudo });
      expect(t).not.toContain(crudo);
      expect(t.length).toBeGreaterThan(20);
      textos.add(t);
    }
    expect(textos.size).toBe(8);
    expect(textoErrorEdicion({ code: 'functions/internal', message: crudo })).not.toContain(crudo);
    expect(textoErrorEdicion(undefined, 'quitar')).toContain('quitar');
    expect(textoErrorEdicion({ code: 'resource-exhausted' })).toContain('máximo');
  });
  it('una baja pendiente nunca se dice «quitada»', () => {
    expect(textoResultadoQuitar({ ok: true, estado: 'revocado' })).toBe('Edición quitada.');
    expect(textoResultadoQuitar({ ok: false, estado: 'revocado_pendiente' })).toContain('pendiente');
    expect(textoResultadoQuitar(undefined)).toContain('pendiente');
  });
});

describe('P3. el texto de fuente', () => {
  const rutas = [
    'web/src/central/componentes/EdicionMiniCrm.tsx', 'web/src/central/componentes/BotonGoogle.tsx', 'web/src/central/paginas/Usuarios.tsx',
    'web/src/central/lib/edicionCrm.ts', 'web/src/central/lib/googleIdentidad.ts',
  ];
  it('NIEGA: no se vincula ni se inicia sesión con Google (una identidad, un proveedor)', () => {
    for (const r of rutas) {
      const f = sinComentarios(leer(r));
      expect(f, r).not.toMatch(/linkWithPopup|linkWithCredential|linkWithRedirect|signInWithPopup|signInWithCredential|signInWithRedirect|GoogleAuthProvider/);
    }
  });
  it('NIEGA: el token no se imprime ni se guarda; sin HTML inyectado', () => {
    for (const r of rutas) {
      const f = sinComentarios(leer(r));
      expect(f, r).not.toMatch(/console\./);
      expect(f, r).not.toMatch(/dangerouslySetInnerHTML|innerHTML|localStorage|sessionStorage/);
      expect(f, r).not.toMatch(/useState[^;]*[iI]dToken|setIdToken|setToken/);
    }
  });
  it('el client id sale de VITE_GOOGLE_OAUTH_CLIENT_ID y sin él no se pinta', () => {
    const t = sinComentarios(leer('web/src/central/componentes/EdicionMiniCrm.tsx'));
    expect(t).toContain('import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID');
    expect(t).toMatch(/if \(!vista\.visible[^)]*\) return null/);
    expect(sinComentarios(leer('web/src/central/paginas/Usuarios.tsx'))).toContain('{clientId && <th>');
  });
  it('el operador nunca apunta a otra persona: el Tablero no pasa uidDestino', () => {
    expect(sinComentarios(leer('web/src/central/componentes/EdicionMiniCrm.tsx'))).not.toMatch(/uidDestino|CAPA\.(registrar|quitar)\([^)]*,[^)]*,/);
    expect(sinComentarios(leer('web/src/central/componentes/EdicionMiniCrm.tsx'))).not.toContain('Habilitar edición');
    expect(leer('web/src/central/paginas/Usuarios.tsx')).toContain('accionesDeMiembro({ clientId, esAdmin: true');
  });
  it('los tres callables se llaman por nombre y sin importar del servidor', () => {
    const f = leer('web/src/central/lib/edicionCrm.ts');
    for (const n of ['consultarMiEdicionCrm', 'registrarEditorCrm', 'quitarEditorCrm']) expect(f).toContain(`'${n}'`);
    expect(f).not.toMatch(/from '[^']*functions\/src/);
  });
  it('la CSP de la consola deja entrar a Google Identity Services, y solo a sus rutas', () => {
    const csp = (JSON.parse(leer('firebase.json')) as { hosting: Array<{ headers?: Array<{ headers: Array<{ key: string; value: string }> }> }> })
      .hosting.flatMap((h) => (h.headers ?? []).flatMap((x) => x.headers)).map((h) => h.value).filter((v) => v.includes('accounts.google.com'));
    expect(csp.length).toBe(1);
    expect(csp[0]).toContain('https://accounts.google.com/gsi/client');
    expect(csp[0]).not.toMatch(/https:\/\/accounts\.google\.com(?!\/gsi\/)/);
    expect(csp[0]).toContain("object-src 'none'");
  });
});
