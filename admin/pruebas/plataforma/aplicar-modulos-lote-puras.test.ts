/**
 * `scripts/plataforma/aplicar-modulos-lote.mjs` — parte PURA: argumentos, selección y lista destino.
 * Sin Firestore: importar el script no abre nada. Las pruebas con el emulador están en
 * `aplicar-modulos-lote.test.ts`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mod = await import('../../scripts/plataforma/aplicar-modulos-lote.mjs') as unknown as {
  analizarArgumentos: (argv: string[], env?: Record<string, string>, op?: { raiz?: string }) =>
    { ok: boolean; problemas?: string[]; cfg?: Record<string, unknown> };
  clasificar: (id: string, ficha: Record<string, unknown>, excluir: string[]) => { accion: string; motivo?: string; derivada?: string[] };
  destinoDe: (derivada: string[], aceptadas: string[]) => { ok: boolean; destino?: string[]; motivo?: string };
  huellaDe: (plan: { id: string; destino?: string[] }[], entorno: string) => string;
};

const ENV_EMU = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8231' };
const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };
const dirs: string[] = [];
const nuevoDir = () => { const d = mkdtempSync(join(tmpdir(), 'apl-lote-puro-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const problemas = (argv: string[], env: Record<string, string> = ENV_EMU) => {
  const r = mod.analizarArgumentos(argv, env);
  expect(r.ok, JSON.stringify(r)).toBe(false);
  return (r.problemas ?? []).join(' | ');
};

describe('argumentos', () => {
  it('seco mínimo válido; no exige --excluir ni respaldo', () => {
    const r = mod.analizarArgumentos(['--proyecto', 'demo-lote'], ENV_EMU);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.cfg).toMatchObject({ aplicar: false, excluir: [], entorno: 'emulador' });
  });

  it('--aplicar exige --respaldo-dir, --excluir y --esperar explícitos', () => {
    const dir = nuevoDir();
    const H = 'a'.repeat(32);
    expect(problemas(['--proyecto', 'demo-lote', '--aplicar', '--excluir', 'ninguno', '--esperar', H])).toContain('--respaldo-dir');
    expect(problemas(['--proyecto', 'demo-lote', '--aplicar', '--respaldo-dir', join(dir, 'r'), '--esperar', H])).toContain('--excluir');
    expect(problemas(['--proyecto', 'demo-lote', '--aplicar', '--excluir', 'ninguno', '--respaldo-dir', join(dir, 'r')])).toContain('--esperar');
    expect(problemas(['--proyecto', 'demo-lote', '--aplicar', '--excluir', 'ninguno', '--respaldo-dir', join(dir, 'r'), '--esperar', 'corta'])).toContain('huella');
    const r = mod.analizarArgumentos(['--proyecto', 'demo-lote', '--aplicar', '--excluir', 'ninguno', '--respaldo-dir', join(dir, 'r'), '--esperar', H], ENV_EMU);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('--excluir: ids válidos, sin repetidos; «ninguno» no excluye a nadie', () => {
    expect(problemas(['--proyecto', 'demo-lote', '--excluir', 'A,b'])).toContain('inválido');
    expect(problemas(['--proyecto', 'demo-lote', '--excluir', 'abc,abc'])).toContain('repetido');
    const r = mod.analizarArgumentos(['--proyecto', 'demo-lote', '--excluir', 'abc,def'], ENV_EMU);
    expect(r.cfg).toMatchObject({ excluir: ['abc', 'def'] });
  });

  it('--acepto: forma tenant:caps, repetible por tenants distintos, sin quitar comunes ni módulos desconocidos', () => {
    const r = mod.analizarArgumentos(['--proyecto', 'demo-lote', '--acepto', 'qtaco:inventario', '--acepto', 'otro1:agenda,cobros'], ENV_EMU);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.cfg?.['acepto']).toMatchObject({ qtaco: ['inventario'], otro1: ['agenda', 'cobros'] });
    expect(problemas(['--proyecto', 'demo-lote', '--acepto', 'qtaco'])).toContain('<tenant>:<cap');
    expect(problemas(['--proyecto', 'demo-lote', '--acepto', 'qtaco:productos'])).toContain('comunes');
    expect(problemas(['--proyecto', 'demo-lote', '--acepto', 'qtaco:inventarios'])).toContain('desconocido');
    expect(problemas(['--proyecto', 'demo-lote', '--acepto', 'qtaco:inventario', '--acepto', 'qtaco:agenda'])).toContain('repite un tenant');
  });

  it('salvaguarda de proyecto: lista blanca, nunca imprime el id, y --confirmo-produccion lote contra producción', () => {
    const dir = nuevoDir();
    const base = ['--aplicar', '--excluir', 'ninguno', '--esperar', 'b'.repeat(32), '--respaldo-dir', join(dir, 'r')];
    expect(problemas(['--proyecto', 'proyecto-ajeno-xyz', ...base], ENV_REAL)).not.toContain('proyecto-ajeno-xyz');
    expect(problemas(['--proyecto', 'proyecto-ficticio-prod', ...base], ENV_REAL)).toContain('--confirmo-produccion lote');
    expect(problemas(['--proyecto', 'proyecto-ficticio-prod', ...base, '--confirmo-produccion', 'otro'], ENV_REAL)).toContain('exactamente «lote»');
    expect(problemas(['--proyecto', 'proyecto-ficticio-staging', ...base, '--confirmo-produccion', 'lote'], ENV_REAL)).toContain('solo se usa contra producción');
    const ok = mod.analizarArgumentos(['--proyecto', 'proyecto-ficticio-prod', ...base, '--confirmo-produccion', 'lote'], ENV_REAL);
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    expect(ok.cfg).toMatchObject({ entorno: 'produccion' });
    // Sin emulador local, un demo-* se rechaza.
    expect(problemas(['--proyecto', 'demo-lote'], {})).toContain('FIRESTORE_EMULATOR_HOST');
  });

  it('el respaldo no puede quedar dentro del repositorio ni ser relativo', () => {
    expect(problemas(['--proyecto', 'demo-lote', '--aplicar', '--excluir', 'ninguno', '--esperar', 'b'.repeat(32), '--respaldo-dir', 'relativa/r'])).toContain('ruta absoluta');
    expect(problemas(['--proyecto', 'demo-lote', '--aplicar', '--excluir', 'ninguno', '--esperar', 'b'.repeat(32), '--respaldo-dir', join(process.cwd(), 'r')])).toContain('repositorio');
  });

  it('--revertir ya no existe; opciones desconocidas y sueltas se rechazan', () => {
    expect(problemas(['--proyecto', 'demo-lote', '--revertir'])).toContain('opción desconocida');
    expect(problemas(['--proyecto', 'demo-lote', '--incluir-bellido'])).toContain('opción desconocida');
    expect(problemas(['--proyecto', 'demo-lote', 'suelto'])).toContain('argumento suelto');
  });
});

describe('selección y lista destino', () => {
  it('omite excluidas, dadas de baja y las que ya tienen modulos (cualquier valor)', () => {
    expect(mod.clasificar('abc', { flujos: ['venta'] }, ['abc']).accion).toBe('omitir');
    expect(mod.clasificar('abc', { flujos: ['venta'], estado: 'dado_de_baja' }, []).motivo).toBe('dada de baja');
    expect(mod.clasificar('abc', { flujos: ['venta'], estado: 'baja' }, []).accion).toBe('omitir');
    expect(mod.clasificar('abc', { flujos: ['venta'], modulos: [] }, []).motivo).toContain('ya tiene');
    expect(mod.clasificar('abc', { flujos: ['venta'], modulos: 'x' }, []).accion).toBe('omitir');
  });

  it('deriva la lista de flujos/vertical con el registro, incluyendo los comunes', () => {
    const v = mod.clasificar('abc', { flujos: ['venta'] }, []);
    expect(v.accion).toBe('candidata');
    expect(v.derivada).toEqual(expect.arrayContaining(['productos', 'campanas', 'pedidos']));
    const a = mod.clasificar('abc', { vertical: 'agendamiento' }, []);
    expect(a.derivada).toContain('agenda');
  });

  it('destinoDe quita solo lo aceptado y rechaza lo que no estaba derivado', () => {
    expect(mod.destinoDe(['productos', 'campanas', 'inventario'], ['inventario'])).toEqual({ ok: true, destino: ['productos', 'campanas'] });
    expect(mod.destinoDe(['productos', 'campanas'], [])).toEqual({ ok: true, destino: ['productos', 'campanas'] });
    expect(mod.destinoDe(['productos', 'campanas'], ['agenda']).ok).toBe(false);
  });

  it('destinoDe rechaza una lista con una dependencia rota (dependeDe del registro), sin excepción', () => {
    const derivada = ['productos', 'campanas', 'cobros', 'pedidos', 'inventario', 'catalogo-web'];
    const r = mod.destinoDe(derivada, ['inventario']);
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('«catalogo-web» depende de inventario');
    expect(mod.destinoDe(derivada, ['pedidos']).ok).toBe(false);
    expect(mod.destinoDe(derivada, ['catalogo-web']).ok).toBe(true);
  });

  it('huellaDe: igual con el mismo plan en cualquier orden; cambia si aparece una candidata o cambia una lista', () => {
    const a = [{ id: 'aaa', destino: ['productos', 'campanas'] }, { id: 'bbb', destino: ['productos', 'campanas', 'agenda'] }];
    const h = mod.huellaDe(a, 'emulador');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(mod.huellaDe([...a].reverse(), 'emulador')).toBe(h);
    expect(mod.huellaDe([...a, { id: 'ccc', destino: ['productos', 'campanas'] }], 'emulador')).not.toBe(h);
    expect(mod.huellaDe([a[0]!, { id: 'bbb', destino: ['productos', 'campanas'] }], 'emulador')).not.toBe(h);
    // La misma lista en otro entorno es otra huella: un seco de staging no autoriza producción.
    expect(mod.huellaDe(a, 'staging')).not.toBe(h);
    expect(mod.huellaDe(a, 'produccion')).not.toBe(mod.huellaDe(a, 'staging'));
  });
});
