/**
 * `scripts/modulos/pedidos/fijar-nota-novutienda.mjs` — enciende o apaga `tenants/{id}/config/pedidos.notaANovuTienda`.
 * Sin emulador ni nube: lógica pura y una base en memoria con documentos sintéticos. Negando primero:
 *   S1. Argumentos: sin --confirmo, comercio equivocado, demos/NovuChat/ensayo, modos excluyentes, producción.
 *   S2. Seco por omisión; --aplicar con respaldo; escribe SOLO `notaANovuTienda` (nunca pisa `catalogoExterno`).
 *   S3. Revertir restaura el valor previo o la AUSENCIA, y no pisa un cambio ajeno.
 *   S4. El texto del script: no importa Firebase al cargar, su única escritura es el lote de un campo y la auditoría.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', '..', 'scripts', 'modulos', 'pedidos', 'fijar-nota-novutienda.mjs');
type Cfg = Record<string, unknown>;
const mod = await import('../../../scripts/modulos/pedidos/fijar-nota-novutienda.mjs') as unknown as {
  analizarArgumentos: (argv: string[], env?: Record<string, string>, op?: Record<string, unknown>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
};
const conv = await import('../../../scripts/plataforma/aplicar-consola-conversaciones.mjs') as unknown as {
  comprobarRespaldo: (r: unknown, o?: Record<string, unknown>) => { ok: boolean; real?: string };
};

const PROY = 'demo-novuchat-pruebas';
const ENV_EMU = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' };
const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };
const dirs: string[] = [];
const rutaRespaldo = () => {
  const d = mkdtempSync(join('/tmp', 'nota-novutienda-')); chmodSync(d, 0o700); dirs.push(d);
  return join(d, 'respaldo.json');
};
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const CATALOGO = { activo: true, monedas: ['BOB'] };
const FICHA = { nombre: 'Tienda Sintetica' };

/** Una Firestore en memoria: la ficha, `config/pedidos` y la auditoría; cuenta escrituras y puede cambiar antes de escribir. */
function baseDe(pedidos: Record<string, unknown> | null, o: { cambiaAntesDeEscribir?: boolean } = {}) {
  let datos = pedidos === null ? null : { ...pedidos };
  let hora = 1;
  const lotes: Array<{ campos: Record<string, unknown>; auditoria: Record<string, unknown> }> = [];
  const lecturas: Array<string[] | undefined> = [];
  const snap = (d: Record<string, unknown> | null, mascara?: string[]) => ({
    exists: d !== null,
    data: () => (d === null ? undefined : Object.fromEntries(Object.entries(d).filter(([k]) => !mascara || mascara.includes(k)))),
    updateTime: d === null ? undefined : { toDate: () => new Date(hora * 1000), hora },
  });
  const refPedidos = { es: 'pedidos' };
  const refFicha = { es: 'ficha' };
  return {
    lotes, lecturas, datos: () => datos,
    db: {
      doc: (ruta: string) => (ruta.endsWith('/config/pedidos') ? refPedidos : refFicha),
      collection: (ruta: string) => ({ doc: () => ({ ruta }) }),
      getAll: async (...args: unknown[]) => {
        const op = args[args.length - 1] as { fieldMask?: string[] };
        lecturas.push(op?.fieldMask);
        return (args.slice(0, -1) as Array<{ es: string }>).map((r) => (r.es === 'pedidos' ? snap(datos, op?.fieldMask) : snap(FICHA, op?.fieldMask)));
      },
      batch: () => {
        const campos: Record<string, unknown>[] = []; const aud: Record<string, unknown>[] = [];
        let pre: { lastUpdateTime: { hora: number } } | null = null;
        return {
          update: (_r: unknown, c: Record<string, unknown>, p: { lastUpdateTime: { hora: number } }) => { campos.push(c); pre = p; },
          create: (_r: unknown, a: Record<string, unknown>) => { aud.push(a); },
          commit: async () => {
            if (o.cambiaAntesDeEscribir) { hora += 1; datos = { ...(datos ?? {}), otro: 'cambio-ajeno' }; }
            if (pre!.lastUpdateTime.hora !== hora) throw Object.assign(new Error('precondición'), { code: 9 });
            for (const [k, v] of Object.entries(campos[0]!)) {
              if (v && typeof v === 'object' && (v as { __borrar?: boolean }).__borrar) delete (datos as Record<string, unknown>)[k];
              else (datos as Record<string, unknown>)[k] = v;
            }
            hora += 1;
            lotes.push({ campos: campos[0]!, auditoria: aud[0]! });
          },
        };
      },
    },
    FieldValue: { delete: () => ({ __borrar: true }) },
  };
}
const correr = async (cfg: Cfg, b: ReturnType<typeof baseDe>) => {
  const salida: string[] = [];
  const codigo = await mod.ejecutar(cfg, { db: b.db, FieldValue: b.FieldValue, log: (t: string) => salida.push(t), env: {} });
  return { codigo, salida: salida.join('\n') };
};
const cfgDe = (extra: Cfg = {}): Cfg => {
  const c: Cfg = { proyecto: PROY, entorno: 'emulador', tenant: 'tienda-prueba', valor: true, aplicar: false, revertir: false, respaldo: null, ...extra };
  if (typeof c['respaldo'] === 'string' && !('respaldoResuelto' in c)) c['respaldoResuelto'] = conv.comprobarRespaldo(c['respaldo'], { permitirExistente: true }).real ?? null;
  return c;
};

describe('S1. argumentos y salvaguarda', () => {
  const base = ['--proyecto', PROY, '--tenant', 'tienda-prueba', '--activar'];
  const problemas = (argv: string[], env: Record<string, string> = ENV_EMU) => {
    const r = mod.analizarArgumentos(argv, env);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    return (r.problemas ?? []).join(' | ');
  };
  it('la invocación completa es válida y queda en seco; --activar escribe true y --desactivar false', () => {
    expect(mod.analizarArgumentos(base, ENV_EMU).cfg).toMatchObject({ tenant: 'tienda-prueba', valor: true, aplicar: false, revertir: false });
    expect(mod.analizarArgumentos(['--proyecto', PROY, '--tenant', 'tienda-prueba', '--desactivar'], ENV_EMU).cfg?.['valor']).toBe(false);
  });
  it('NEGADO: --aplicar sin --confirmo, o con otro comercio', () => {
    const r = rutaRespaldo();
    expect(problemas([...base, '--aplicar', '--respaldo', r])).toContain('--aplicar exige --confirmo');
    expect(problemas([...base, '--aplicar', '--respaldo', r, '--confirmo', 'otro-comercio'])).toContain('--confirmo no coincide');
    expect(problemas([...base, '--confirmo', 'otro-comercio'])).toContain('--confirmo no coincide');
    expect(mod.analizarArgumentos([...base, '--aplicar', '--respaldo', r, '--confirmo', 'tienda-prueba'], ENV_EMU).ok).toBe(true);
  });
  it('NEGADO: --aplicar sin --respaldo; --revertir sin respaldo; modos excluyentes o ausentes', () => {
    expect(problemas([...base, '--aplicar', '--confirmo', 'tienda-prueba'])).toContain('--aplicar exige --respaldo');
    expect(problemas(['--proyecto', PROY, '--tenant', 'tienda-prueba', '--revertir'])).toContain('--revertir exige --respaldo');
    expect(problemas([...base, '--desactivar'])).toContain('excluyentes');
    expect(problemas(['--proyecto', PROY, '--tenant', 'tienda-prueba'])).toContain('falta --activar');
  });
  it('NEGADO: NovuChat, los demos y el ensayo; varios comercios; id inválido; excluidos por entorno', () => {
    for (const t of ['novuchat', 'novuchat-staging', 'ensayo', 'demo', 'demo-venta', 'demo-agendamiento']) {
      expect(problemas(['--proyecto', PROY, '--tenant', t, '--activar']), t).toContain('no llevan este dato');
    }
    expect(problemas(['--proyecto', PROY, '--tenant', 'a-uno,b-dos', '--activar'])).toContain('UN solo comercio');
    expect(problemas(['--proyecto', PROY, '--tenant', 'Tienda', '--activar'])).toContain('--tenant inválido');
    expect(problemas(base, { ...ENV_EMU, NOVUCHAT_TENANTS_EXCLUIDOS: 'tienda-prueba' })).toContain('EXCLUIDO');
  });
  it('NEGADO: opciones desconocidas o repetidas, argumento suelto, proyecto fuera de la lista blanca', () => {
    expect(problemas([...base, '--todos'])).toContain('opción desconocida');
    expect(problemas([...base, '--activar'])).toContain('opción repetida');
    expect(problemas([...base, 'suelto'])).toContain('argumento suelto');
    expect(problemas(['--tenant', 'tienda-prueba', '--activar'])).toContain('falta --proyecto');
    expect(problemas(['--proyecto', 'otro-proyecto-real', '--tenant', 'tienda-prueba', '--activar'], ENV_REAL)).toContain('lista blanca');
  });
  it('--entorno toma el id del ENTORNO, no de argv', () => {
    const r = mod.analizarArgumentos(['--entorno', 'staging', '--tenant', 'tienda-prueba', '--activar'], ENV_REAL);
    expect(r.cfg?.['proyecto']).toBe(ENV_REAL.GCP_PROJECT_ID_STAGING);
    expect(problemas(['--entorno', 'staging', '--proyecto', PROY, '--tenant', 'tienda-prueba', '--activar'], ENV_REAL)).toContain('no se combina');
  });
});

describe('S2. seco, aplicar y escritura de UN solo campo', () => {
  it('seco (sin --aplicar): muestra hoy → después, no escribe, sale con 1 y solo lee los campos pedidos', async () => {
    const b = baseDe({ catalogoExterno: CATALOGO });
    const r = await correr(cfgDe(), b);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('AUSENTE (apagado)');
    expect(r.salida).toContain('true (ENCENDIDO');
    expect(b.lotes).toHaveLength(0);
    expect(b.datos()).toEqual({ catalogoExterno: CATALOGO });
    expect(b.lecturas).toEqual([['notaANovuTienda', 'nombre']]);
  });
  it('aplicar escribe SOLO `notaANovuTienda`, deja `catalogoExterno` intacto, audita y guarda el respaldo con la ausencia', async () => {
    const b = baseDe({ catalogoExterno: CATALOGO, otroCampo: 7 });
    const ruta = rutaRespaldo();
    const r = await correr(cfgDe({ aplicar: true, respaldo: ruta }), b);
    expect(r.codigo, r.salida).toBe(0);
    expect(b.lotes).toHaveLength(1);
    expect(Object.keys(b.lotes[0]!.campos)).toEqual(['notaANovuTienda']);
    expect(b.lotes[0]!.auditoria).toMatchObject({ accion: 'activar_nota_novutienda', origen: 'script', antes: null, despues: true });
    expect(b.datos()).toEqual({ catalogoExterno: CATALOGO, otroCampo: 7, notaANovuTienda: true });
    const resp = JSON.parse(readFileSync(ruta, 'utf8'));
    expect(resp).toMatchObject({ campo: 'notaANovuTienda', tenant: 'tienda-prueba', previo: { presente: false, valor: null }, escrito: true });
    expect(JSON.stringify(resp)).not.toMatch(/Sintetica/); // el respaldo no lleva datos del comercio
  });
  it('idempotente: ya encendido no escribe; apagar lo ausente o ya en false tampoco', async () => {
    let b = baseDe({ notaANovuTienda: true });
    expect((await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b)).codigo).toBe(0);
    expect(b.lotes).toHaveLength(0);
    for (const previo of [{}, { notaANovuTienda: false }]) {
      b = baseDe(previo);
      expect((await correr(cfgDe({ valor: false, aplicar: true, respaldo: rutaRespaldo() }), b)).codigo).toBe(0);
      expect(b.lotes).toHaveLength(0);
    }
  });
  it('desactivar un `true` escribe false (un campo)', async () => {
    const b = baseDe({ catalogoExterno: CATALOGO, notaANovuTienda: true });
    const r = await correr(cfgDe({ valor: false, aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(r.codigo, r.salida).toBe(0);
    expect(b.datos()).toEqual({ catalogoExterno: CATALOGO, notaANovuTienda: false });
    expect(Object.keys(b.lotes[0]!.campos)).toEqual(['notaANovuTienda']);
  });
  it('NEGADO: sin `config/pedidos` no crea el documento (sale con 1)', async () => {
    const b = baseDe(null);
    expect((await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b)).codigo).toBe(1);
    expect(b.lotes).toHaveLength(0);
  });
  it('NEGADO: un valor previo que no es booleano no se pisa (no se puede respaldar con fidelidad)', async () => {
    const b = baseDe({ notaANovuTienda: 'true' });
    expect((await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b)).codigo).toBe(2);
    expect(b.lotes).toHaveLength(0);
  });
  it('NEGADO: si el documento cambia entre la lectura y la escritura, no escribe (sale con 3)', async () => {
    const b = baseDe({ catalogoExterno: CATALOGO }, { cambiaAntesDeEscribir: true });
    expect((await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b)).codigo).toBe(3);
    expect(b.lotes).toHaveLength(0);
  });
  it('NEGADO: un respaldo existente nunca se pisa', async () => {
    const ruta = rutaRespaldo();
    expect((await correr(cfgDe({ aplicar: true, respaldo: ruta }), baseDe({}))).codigo).toBe(0);
    const b = baseDe({});
    const r = await correr(cfgDe({ aplicar: true, respaldo: ruta }), b);
    expect(r.codigo).toBe(2);
    expect(b.lotes).toHaveLength(0);
  });
});

describe('S3. revertir', () => {
  it('restaura la AUSENCIA: el campo se elimina y `catalogoExterno` no se toca', async () => {
    const ruta = rutaRespaldo();
    const b = baseDe({ catalogoExterno: CATALOGO });
    expect((await correr(cfgDe({ aplicar: true, respaldo: ruta }), b)).codigo).toBe(0);
    expect(b.datos()).toHaveProperty('notaANovuTienda', true);
    const r = await correr(cfgDe({ revertir: true, valor: null, aplicar: true, respaldo: ruta, respaldoResuelto: ruta }), b);
    expect(r.codigo, r.salida).toBe(0);
    expect(b.datos()).toEqual({ catalogoExterno: CATALOGO });
    expect(b.datos()).not.toHaveProperty('notaANovuTienda');
    expect(b.lotes[1]!.auditoria).toMatchObject({ accion: 'revertir_nota_novutienda' });
  });
  it('restaura un valor previo `false`', async () => {
    const ruta = rutaRespaldo();
    const b = baseDe({ notaANovuTienda: false });
    await correr(cfgDe({ aplicar: true, respaldo: ruta }), b);
    expect(b.datos()).toEqual({ notaANovuTienda: true });
    expect((await correr(cfgDe({ revertir: true, valor: null, aplicar: true, respaldo: ruta, respaldoResuelto: ruta }), b)).codigo).toBe(0);
    expect(b.datos()).toEqual({ notaANovuTienda: false });
  });
  it('NEGADO: si alguien cambió el valor después, no lo pisa (sale con 2); en seco solo informa', async () => {
    const ruta = rutaRespaldo();
    const b = baseDe({});
    await correr(cfgDe({ aplicar: true, respaldo: ruta }), b);
    const otra = baseDe({ notaANovuTienda: false }); // hoy no es lo que escribió el script
    const r = await correr(cfgDe({ revertir: true, valor: null, aplicar: true, respaldo: ruta, respaldoResuelto: ruta }), otra);
    expect(r.codigo).toBe(2);
    expect(otra.lotes).toHaveLength(0);
    const seco = await correr(cfgDe({ revertir: true, valor: null, aplicar: false, respaldo: ruta, respaldoResuelto: ruta }), b);
    expect(seco.codigo).toBe(1);
    expect(b.lotes).toHaveLength(1); // solo la escritura de antes
  });
  it('NEGADO: un respaldo de otro comercio o con forma ajena se rechaza', async () => {
    const ruta = rutaRespaldo();
    await correr(cfgDe({ aplicar: true, respaldo: ruta }), baseDe({}));
    const r = await correr(cfgDe({ tenant: 'otra-tienda', revertir: true, valor: null, aplicar: true, respaldo: ruta, respaldoResuelto: ruta }), baseDe({ notaANovuTienda: true }));
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('otro comercio');
  });
});

describe('S4. el texto del script', () => {
  const texto = readFileSync(SCRIPT, 'utf8');
  const codigo = texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('existe, solo escribe el campo y la auditoría, y no toca cobros ni catalogoExterno', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    expect(codigo.match(/\.update\(/g)).toHaveLength(1);
    expect(codigo.match(/\.create\(/g)).toHaveLength(1);
    expect(codigo).not.toMatch(/\.set\(|merge|config\/cobros|catalogoExterno/);
  });
  it('no lleva números de teléfono, secretos ni ids de proyecto', () => {
    expect(texto).not.toMatch(/\b591\d{8}\b|AIza|-----BEGIN|Bearer /);
  });
});
