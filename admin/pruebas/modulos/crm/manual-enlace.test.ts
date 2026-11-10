/**
 * LOS MANUALES DE USO (10/11/2026) — sin emulador. Se prueba NEGANDO:
 *   M1. La forma del enlace: solo documentos/presentaciones/hojas/archivos de Google por https.
 *   M2. Quién ve qué: el operador NUNCA recibe el manual del administrador (función pura y consola).
 *   M3. El script de Plataforma: rol obligatorio, seco por omisión, respaldo, producción con confirmación.
 *   M4. La Consola no se suscribe a lo que su rol no puede leer; sin secretos.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentosDeManualPara, esEnlaceDeManual, manualesParaBoton } from '../../../functions/src/central/enlace-minicrm';

const ADMIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leer = (r: string) => readFileSync(join(ADMIN, r), 'utf8');
const ID = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123';
const DOC = `https://docs.google.com/document/d/${ID}/edit`;
const PDF = `https://drive.google.com/file/d/${ID}/view`;

const mod = await import('../../../scripts/plataforma/manual-enlace.mjs') as unknown as {
  analizarArgumentos: (a: string[], env?: Record<string, string>) => { ok: boolean; problemas?: string[]; cfg?: Record<string, unknown> };
};

describe('M1. la forma del enlace', () => {
  it('acepta documento, presentación, hoja y archivo de Drive', () => {
    for (const u of [DOC, PDF, `https://docs.google.com/presentation/d/${ID}/edit`, `https://docs.google.com/spreadsheets/d/${ID}`]) expect(esEnlaceDeManual(u), u).toBe(true);
  });
  it('NIEGA: http, otros dominios, subdominios parecidos, credenciales, puerto, esquemas peligrosos, espacios y rutas raras', () => {
    const malos = [
      `http://docs.google.com/document/d/${ID}`, `https://evil.example/document/d/${ID}`,
      `https://docs.google.com.malo.example/document/d/${ID}`, `https://drive.google.com.malo.example/file/d/${ID}`,
      `https://usuario:clave${String.fromCharCode(64)}docs.google.com/document/d/${ID}`, `https://docs.google.com:8443/document/d/${ID}`,
      `https://drive.google.com/drive/folders/${ID}`, `https://docs.google.com/forms/d/${ID}`,
      'javascript:alert(1)', 'data:text/html,x', `https://docs.google.com/document/d/corto`,
      `https://docs.google.com/document/d/${ID}/../x`, ` ${DOC}`, `${DOC}\n`, `${DOC}"x`, '',
      `https://docs.google.com/document/d/${ID}/${'a'.repeat(300)}`,
    ];
    for (const u of malos) expect(esEnlaceDeManual(u), JSON.stringify(u).slice(0, 60)).toBe(false);
    for (const v of [null, undefined, 1, {}, [], true]) expect(esEnlaceDeManual(v)).toBe(false);
  });
});

describe('M2. quién ve qué', () => {
  it('el admin ve los dos; el operador solo el suyo', () => {
    expect(manualesParaBoton({ rol: 'admin', operador: DOC, admin: PDF })).toEqual({ operador: DOC, admin: PDF });
    expect(manualesParaBoton({ rol: 'oper', operador: DOC, admin: PDF })).toEqual({ operador: DOC, admin: null });
  });
  it('NIEGA: al operador jamás se le entrega el manual del admin, aunque el dato esté a mano', () => {
    expect(documentosDeManualPara('oper')).not.toContain('manual-admin');
    expect(manualesParaBoton({ rol: 'oper', operador: null, admin: PDF }).admin).toBeNull();
  });
  it('NIEGA: un rol desconocido, ausente o disfrazado no ve ninguno', () => {
    for (const rol of [undefined, null, 'ingesta', 'ADMIN', 'admin ', true, {}, 'visor']) {
      expect(manualesParaBoton({ rol, operador: DOC, admin: PDF }), String(rol)).toEqual({ operador: null, admin: null });
    }
  });
  it('NIEGA: un enlace inválido no se pinta', () => {
    expect(manualesParaBoton({ rol: 'admin', operador: 'javascript:alert(1)', admin: 'https://evil.example/x' })).toEqual({ operador: null, admin: null });
  });
});

describe('M3. el script de Plataforma', () => {
  const ENV = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' };
  const base = ['--proyecto', 'demo-novuchat-pruebas', '--tenant', 'comercio-x'];
  it('seco por omisión', () => {
    const r = mod.analizarArgumentos([...base, '--rol', 'admin', '--enlace', DOC], ENV);
    expect(r.ok, String(r.problemas)).toBe(true);
    expect(r.cfg).toMatchObject({ aplicar: false, rol: 'admin' });
  });
  it('NIEGA: sin --rol, con un rol inventado, enlace inválido, --aplicar sin respaldo, más de un comercio', () => {
    expect(mod.analizarArgumentos([...base, '--enlace', DOC], ENV).ok).toBe(false);
    expect(mod.analizarArgumentos([...base, '--rol', 'dueno', '--enlace', DOC], ENV).ok).toBe(false);
    expect(mod.analizarArgumentos([...base, '--rol', 'admin', '--enlace', 'https://evil.example/x'], ENV).ok).toBe(false);
    expect(mod.analizarArgumentos([...base, '--rol', 'admin', '--enlace', DOC, '--aplicar'], ENV).ok).toBe(false);
    expect(mod.analizarArgumentos(['--proyecto', 'demo-novuchat-pruebas', '--tenant', 'a-1,b-2', '--rol', 'admin', '--enlace', DOC], ENV).ok).toBe(false);
  });
  it('escribe el documento que corresponde al rol, con una sola escritura', () => {
    const t = leer('scripts/plataforma/manual-enlace.mjs');
    expect(t).toContain('enlaces/manual-${cfg.rol}');
    expect(t.match(/ref\.(create|update|delete)\(/g)?.length).toBe(3); // una por camino, nunca dos en el mismo
  });
});

describe('M4. la Consola', () => {
  const ui = leer('web/src/central/componentes/BotonesManual.tsx');
  it('solo el admin se suscribe al manual del admin', () => {
    const i = ui.indexOf("'manual-admin'");
    expect(i).toBeGreaterThan(0);
    expect(ui.slice(Math.max(0, i - 120), i)).toContain('if (esAdmin)');
    expect(ui).not.toMatch(/addDoc|setDoc|updateDoc|deleteDoc/);
  });
  it('el Tablero la monta', () => expect(leer('web/src/central/paginas/Tablero.tsx')).toContain('<BotonesManual tenantId={tenantId} esAdmin={esAdmin} />'));
});
