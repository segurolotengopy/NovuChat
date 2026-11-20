/**
 * `scripts/plataforma/aplicar-catalogo-externo.mjs` — ESCRIBE `tenants/{id}/config/pedidos.catalogoExterno`
 * (`{ activo, monedas }`, lo que lee `configExternaDe` en `functions/src/modulos/pedidos/pedidoDelQr.ts`).
 * Calcado de `aplicar-guardar-medios.test.ts`; reutiliza las piezas de proyecto y respaldo de
 * `aplicar-consola-conversaciones.mjs`, que ya tienen su prueba.
 *
 * Sin emulador ni nube: lógica pura y una base en memoria. Los documentos son sintéticos.
 *   C1. Argumentos y salvaguarda (negando primero): monedas exactas, un comercio, producción con confirmación.
 *   C2. Seco por omisión, `--aplicar` con respaldo, UNA escritura de un campo con precondición.
 *   C3. Revertir (restaura o elimina el campo; no pisa un cambio ajeno ni toca otros campos).
 *   C4. El texto del script: su única escritura es `update` de `catalogoExterno`; no toca cobros.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', 'scripts', 'plataforma', 'aplicar-catalogo-externo.mjs');
type Cfg = Record<string, unknown>;
const mod = await import('../../scripts/plataforma/aplicar-catalogo-externo.mjs') as unknown as {
  analizarArgumentos: (argv: string[], env?: Record<string, string>, op?: Record<string, unknown>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  validarMonedas: (t: unknown) => { ok: boolean; monedas?: string[] };
  leerRespaldo: (ruta: string, o: { entorno: string; tenant: string }) => { ok: boolean; motivo?: string };
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
};
const conv = await import('../../scripts/plataforma/aplicar-consola-conversaciones.mjs') as unknown as {
  comprobarRespaldo: (r: unknown, o?: Record<string, unknown>) => { ok: boolean; real?: string };
};

const PROY = 'demo-novuchat-pruebas';
const ENV_EMU = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' };
const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };

const dirs: string[] = [];
const nuevoDir = () => { const d = mkdtempSync(join('/tmp', 'catalogo-externo-')); chmodSync(d, 0o700); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const rutaRespaldo = () => join(nuevoDir(), 'respaldo.json');

const FICHA = { nombre: 'Tienda Sintetica', flujos: ['venta'] };
const PEDIDOS = { otroCampo: 'intacto', maximo: 7 };
const ACTIVO_BOB = { activo: true, monedas: ['BOB'] };
const ACTIVO_BOB_ARS = { activo: true, monedas: ['BOB', 'ARS'] };

/** Una Firestore en memoria con la ficha y `config/pedidos`: cuenta escrituras y puede cambiar entre la lectura y la escritura. */
function baseDe(pedidos: Record<string, unknown> | null, opciones: { cambiaAntesDeEscribir?: boolean; otroCreaAntes?: boolean; ficha?: Record<string, unknown> | null } = {}) {
  let datos = pedidos === null ? null : { ...pedidos };
  const ficha = opciones.ficha === undefined ? FICHA : opciones.ficha;
  let hora = 1;
  const lecturas: { campos: string[] | undefined; docs: number }[] = [];
  const escrituras: { campos: Record<string, unknown> }[] = [];
  const snap = (d: Record<string, unknown> | null, mascara?: string[]) => ({
    exists: d !== null,
    data: () => (d === null ? undefined : Object.fromEntries(Object.entries(d).filter(([k]) => !mascara || mascara.includes(k)))),
    updateTime: { toDate: () => new Date(hora * 1000), hora },
  });
  const refPedidos = {
    es: 'pedidos',
    get: async () => snap(datos),
    create: async (campos: Record<string, unknown>) => {
      if (opciones.otroCreaAntes) { datos = { creadoPorOtro: true }; hora += 1; }
      if (datos !== null) throw Object.assign(new Error('ya existe'), { code: 6 });
      datos = { ...campos };
      hora += 1;
      escrituras.push({ campos });
    },
    delete: async (pre: { lastUpdateTime: { hora: number } }) => {
      if (datos === null) throw Object.assign(new Error('no existe'), { code: 5 });
      if (pre.lastUpdateTime.hora !== hora) throw Object.assign(new Error('precondición'), { code: 9 });
      datos = null;
      hora += 1;
      escrituras.push({ campos: { __documento_borrado: true } });
    },
    update: async (campos: Record<string, unknown>, pre: { lastUpdateTime: { hora: number } }) => {
      if (opciones.cambiaAntesDeEscribir) { hora += 1; datos = { ...(datos ?? {}), otro: 'cambio-ajeno' }; }
      if (pre.lastUpdateTime.hora !== hora) throw Object.assign(new Error('precondición'), { code: 9 });
      for (const [k, v] of Object.entries(campos)) {
        if (v && typeof v === 'object' && (v as { __borrar?: boolean }).__borrar) delete (datos as Record<string, unknown>)[k];
        else (datos as Record<string, unknown>)[k] = v;
      }
      hora += 1;
      escrituras.push({ campos });
    },
  };
  const refFicha = { es: 'ficha', update: async () => { throw new Error('la ficha no se escribe'); } };
  return {
    escrituras, lecturas, datos: () => datos,
    db: {
      doc: (ruta: string) => (ruta.endsWith('/config/pedidos') ? refPedidos : refFicha),
      getAll: async (...args: unknown[]) => {
        const o = args[args.length - 1] as { fieldMask?: string[] };
        const refs = args.slice(0, -1) as { es: string }[];
        lecturas.push({ campos: o?.fieldMask, docs: refs.length });
        return refs.map((r) => (r.es === 'pedidos' ? snap(datos, o?.fieldMask) : snap(ficha, o?.fieldMask)));
      },
    },
    FieldValue: { delete: () => ({ __borrar: true }) },
  };
}
const correr = async (cfg: Cfg, b: ReturnType<typeof baseDe>) => {
  const salida: string[] = [];
  const codigo = await mod.ejecutar(cfg, { db: b.db, FieldValue: b.FieldValue, log: (t: string) => salida.push(t) });
  return { codigo, salida: salida.join('\n') };
};
const cfgDe = (extra: Cfg = {}): Cfg => {
  const c: Cfg = { proyecto: PROY, entorno: 'emulador', tenant: 'tienda-prueba', valor: ACTIVO_BOB, aplicar: false, revertir: false, respaldo: null, ...extra };
  if (typeof c['respaldo'] === 'string' && !('respaldoResuelto' in c)) c['respaldoResuelto'] = conv.comprobarRespaldo(c['respaldo'], { permitirExistente: true }).real ?? null;
  return c;
};

describe('C1. argumentos y salvaguarda (puros)', () => {
  const base = ['--proyecto', PROY, '--tenant', 'tienda-prueba', '--monedas', 'BOB'];
  const problemas = (argv: string[], env: Record<string, string> = ENV_EMU) => {
    const r = mod.analizarArgumentos(argv, env);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    return (r.problemas ?? []).join(' | ');
  };

  it('la invocación completa es válida y queda en seco; BOB, ARS y ambas valen; --desactivar escribe activo=false', () => {
    const r = mod.analizarArgumentos(base, ENV_EMU);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.cfg).toMatchObject({ tenant: 'tienda-prueba', valor: ACTIVO_BOB, aplicar: false, revertir: false, entorno: 'emulador' });
    expect(mod.analizarArgumentos(['--proyecto', PROY, '--tenant', 'tienda-prueba', '--monedas', 'ARS,BOB'], ENV_EMU).cfg?.['valor']).toEqual({ activo: true, monedas: ['ARS', 'BOB'] });
    expect(mod.analizarArgumentos(['--proyecto', PROY, '--tenant', 'tienda-prueba', '--desactivar'], ENV_EMU).cfg?.['valor']).toEqual({ activo: false, monedas: [] });
  });

  it('NEGADO: monedas = lista exacta de BOB/ARS, sin repetidos, vacíos ni espacios', () => {
    for (const malo of ['USD', 'bob', 'BOB,USD', 'BOB,BOB', 'BOB,', ',ARS', 'BOB, ARS', ' BOB', 'BOB;ARS', 'ARS,ARS,BOB', '__proto__', '']) {
      expect(mod.validarMonedas(malo).ok, malo).toBe(false);
    }
    expect(mod.validarMonedas(['BOB']).ok).toBe(false);
    expect(mod.validarMonedas(undefined).ok).toBe(false);
    expect(problemas(['--proyecto', PROY, '--tenant', 'tienda-prueba', '--monedas', 'USD'])).toContain('SOLO BOB y/o ARS');
    expect(problemas(['--proyecto', PROY, '--tenant', 'tienda-prueba', '--monedas', 'BOB,BOB'])).toContain('repetidas');
    expect(problemas(['--proyecto', PROY, '--tenant', 'tienda-prueba'])).toContain('falta --monedas');
    expect(problemas(['--proyecto', PROY, '--tenant', 'tienda-prueba', '--monedas'])).toContain('--monedas sin valor');
    expect(problemas([...base, '--desactivar'])).toContain('no se combina');
  });

  it('NEGADO: sin tenant, varios comercios, id inválido, opciones desconocidas o repetidas', () => {
    expect(problemas(['--proyecto', PROY, '--monedas', 'BOB'])).toContain('falta --tenant');
    expect(problemas(['--proyecto', PROY, '--tenant', 'a-uno,b-dos', '--monedas', 'BOB'])).toContain('UN solo comercio');
    expect(problemas(['--proyecto', PROY, '--tenant', 'Tienda', '--monedas', 'BOB'])).toContain('--tenant inválido');
    expect(problemas([...base, '--todos'])).toContain('opción desconocida');
    expect(problemas([...base, '--monedas', 'ARS'])).toContain('opción repetida');
    expect(problemas([...base, 'suelto'])).toContain('argumento suelto');
    expect(problemas(['--tenant', 'tienda-prueba', '--monedas', 'BOB'])).toContain('falta --proyecto');
  });

  it('NEGADO: tenant excluido (Bellido y NOVUCHAT_TENANTS_EXCLUIDOS)', () => {
    const arg = (t: string, env: Record<string, string> = ENV_EMU) => mod.analizarArgumentos(['--proyecto', PROY, '--tenant', t, '--monedas', 'BOB'], env);
    expect(arg('bellido').ok).toBe(false);
    expect((arg('consultorio-bellido').problemas ?? []).join(' ')).toContain('EXCLUIDO');
    expect(arg('tienda-prueba').ok).toBe(true);
    expect(arg('tienda-prueba', { ...ENV_EMU, NOVUCHAT_TENANTS_EXCLUIDOS: 'tienda-prueba' }).ok).toBe(false);
  });

  it('NEGADO: proyecto fuera de la lista blanca, y producción exige --confirmo-produccion igual al tenant', () => {
    expect(problemas(['--proyecto', 'otro-proyecto-real', '--tenant', 'tienda-prueba', '--monedas', 'BOB'], ENV_REAL)).toContain('lista blanca');
    const prod = ['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'tienda-prueba', '--monedas', 'BOB'];
    expect(mod.analizarArgumentos(prod, ENV_REAL).ok).toBe(true); // seco: se permite sin confirmación
    const resp = rutaRespaldo();
    expect(problemas([...prod, '--aplicar', '--respaldo', resp], ENV_REAL)).toContain('--confirmo-produccion');
    expect(problemas([...prod, '--aplicar', '--respaldo', resp, '--confirmo-produccion', 'otro-comercio'], ENV_REAL)).toContain('no coincide');
    expect(mod.analizarArgumentos([...prod, '--aplicar', '--respaldo', resp, '--confirmo-produccion', 'tienda-prueba'], ENV_REAL).ok).toBe(true);
    expect(problemas([...base, '--confirmo-produccion', 'tienda-prueba'])).toContain('solo se usa contra producción');
  });

  it('NEGADO: --aplicar sin respaldo; respaldo dentro del repositorio; --revertir sin respaldo o con --monedas/--desactivar', () => {
    expect(problemas([...base, '--aplicar'])).toContain('--aplicar exige --respaldo');
    expect(problemas([...base, '--aplicar', '--respaldo', join(aqui, 'respaldo.json')])).toMatch(/respaldo[^|]*(duradero|dentro del proyecto)/);
    expect(problemas(['--revertir', '--proyecto', PROY, '--tenant', 'tienda-prueba'])).toContain('--revertir exige --respaldo');
    expect(problemas(['--revertir', '--proyecto', PROY, '--tenant', 'tienda-prueba', '--monedas', 'BOB', '--respaldo', rutaRespaldo()])).toContain('--revertir no admite');
    expect(problemas(['--revertir', '--proyecto', PROY, '--tenant', 'tienda-prueba', '--desactivar', '--respaldo', rutaRespaldo()])).toContain('--revertir no admite');
  });
});

describe('C2. seco, aplicar, una sola escritura con precondición', () => {
  it('el seco NO escribe, lee solo el campo (una lectura) y sale 1 si hay diferencia; con ARS recuerda el alias', async () => {
    const b = baseDe({ ...PEDIDOS });
    const r = await correr(cfgDe(), b);
    expect(r.codigo).toBe(1);
    expect(b.escrituras).toEqual([]);
    expect(b.lecturas).toHaveLength(1);
    expect(b.lecturas.every((l) => l.campos?.length === 2 && l.campos.includes('catalogoExterno') && l.campos.includes('nombre'))).toBe(true);
    expect(r.salida).toContain('AUSENTE');
    expect(r.salida).not.toContain('alias');
    const ars = await correr(cfgDe({ valor: ACTIVO_BOB_ARS }), baseDe({ ...PEDIDOS }));
    expect(ars.salida).toContain('alias de cobro de Argentina');
    const apagar = await correr(cfgDe({ valor: { activo: false, monedas: [] } }), baseDe({ ...PEDIDOS, catalogoExterno: ACTIVO_BOB_ARS }));
    expect(apagar.salida).not.toContain('alias');
  });

  it('es idempotente: si ya vale lo pedido, sale 0 sin escribir (y sin respaldo)', async () => {
    const b = baseDe({ ...PEDIDOS, catalogoExterno: { activo: true, monedas: ['BOB'] } });
    const r = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(r.codigo).toBe(0);
    expect(b.escrituras).toEqual([]);
  });

  it('--aplicar guarda el respaldo, escribe UN campo con precondición y relee; el documento conserva lo demás', async () => {
    const resp = rutaRespaldo();
    const b = baseDe({ ...PEDIDOS });
    const r = await correr(cfgDe({ aplicar: true, respaldo: resp, valor: ACTIVO_BOB_ARS }), b);
    expect(r.codigo, r.salida).toBe(0);
    expect(b.escrituras).toHaveLength(1);
    expect(Object.keys(b.escrituras[0].campos)).toEqual(['catalogoExterno']);
    expect(b.datos()).toEqual({ ...PEDIDOS, catalogoExterno: ACTIVO_BOB_ARS });
    expect(b.lecturas).toHaveLength(2); // 1 lectura + 1 relectura, 1 escritura
    const rr = JSON.parse(readFileSync(resp, 'utf8'));
    expect(rr).toMatchObject({ campo: 'catalogoExterno', tenant: 'tienda-prueba', previo: { presente: false, valor: null }, escrito: ACTIVO_BOB_ARS });
    expect(mod.leerRespaldo(resp, { entorno: 'emulador', tenant: 'tienda-prueba' }).ok).toBe(true);
  });

  it('--desactivar escribe activo=false con monedas vacías', async () => {
    const b = baseDe({ ...PEDIDOS, catalogoExterno: ACTIVO_BOB });
    const r = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo(), valor: { activo: false, monedas: [] } }), b);
    expect(r.codigo, r.salida).toBe(0);
    expect((b.datos() as Record<string, unknown>)['catalogoExterno']).toEqual({ activo: false, monedas: [] });
  });

  it('NEGADO: si el documento cambia entre la lectura y la escritura, aborta sin escribir (3)', async () => {
    const b = baseDe({ ...PEDIDOS }, { cambiaAntesDeEscribir: true });
    const r = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(r.codigo).toBe(3);
    expect(b.escrituras).toEqual([]);
    expect((b.datos() as Record<string, unknown>)['catalogoExterno']).toBeUndefined();
  });

  it('NEGADO: ficha o config/pedidos inexistentes (1, sin escribir); forma previa irreconocible (2); respaldo ya existente (2)', async () => {
    const sinPedidos = baseDe(null);
    expect((await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), sinPedidos)).codigo).toBe(1);
    expect(sinPedidos.escrituras).toEqual([]);
    const sinFicha = baseDe({ ...PEDIDOS }, { ficha: null });
    expect((await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), sinFicha)).codigo).toBe(1);
    expect(sinFicha.escrituras).toEqual([]);
    for (const raro of ['si', true, { activo: true }, { activo: 'si', monedas: ['BOB'] }, { activo: true, monedas: ['USD'] }, { activo: true, monedas: ['BOB'], extra: 1 }, []]) {
      const malo = baseDe({ ...PEDIDOS, catalogoExterno: raro });
      const r = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), malo);
      expect(r.codigo, JSON.stringify(raro)).toBe(2);
      expect(malo.escrituras).toEqual([]);
    }
    const resp = rutaRespaldo();
    writeFileSync(resp, '{}', { mode: 0o600 });
    const yaHay = baseDe({ ...PEDIDOS });
    expect((await correr(cfgDe({ aplicar: true, respaldo: resp }), yaHay)).codigo).toBe(2);
    expect(yaHay.escrituras).toEqual([]);
  });
});

describe('C2b. exclusión por nombre y barreras del respaldo', () => {
  it('NEGADO: segunda barrera en `ejecutar`: el NOMBRE de la ficha nombra a un excluido (2, sin respaldo ni escritura)', async () => {
    const b = baseDe({ ...PEDIDOS }, { ficha: { nombre: 'Consultorio Béllido' } });
    const r = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(r.codigo).toBe(2);
    expect(b.escrituras).toEqual([]);
    expect(r.salida).toContain('EXCLUIDO');
  });
  it('el seco de --revertir sale 1 sin escribir cuando queda un cambio pendiente', async () => {
    const resp = rutaRespaldo();
    const b = baseDe({ ...PEDIDOS });
    await correr(cfgDe({ aplicar: true, respaldo: resp }), b);
    const antes = b.escrituras.length;
    const r = await correr(cfgDe({ revertir: true, aplicar: false, respaldo: resp, valor: null }), b);
    expect(r.codigo).toBe(1);
    expect(b.escrituras).toHaveLength(antes);
  });
  it('NEGADO: un respaldo recién guardado que no se puede releer, o una ruta que cambió, salen 2 sin escribir', async () => {
    const malo = baseDe({ ...PEDIDOS });
    const salida: string[] = [];
    const c1 = await mod.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), { db: malo.db, FieldValue: malo.FieldValue, log: (t: string) => salida.push(t), leerRespaldo: () => ({ ok: false, motivo: 'ilegible' }) });
    expect(c1).toBe(2);
    expect(malo.escrituras).toEqual([]);
    const otra = baseDe({ ...PEDIDOS });
    const c2 = await mod.ejecutar(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), { db: otra.db, FieldValue: otra.FieldValue, log: () => {}, comprobarRespaldo: () => ({ ok: false }) });
    expect(c2).toBe(2);
    expect(otra.escrituras).toEqual([]);
  });
});

describe('C3. revertir', () => {
  it('si el campo no existía, lo ELIMINA y deja intacto el resto del documento', async () => {
    const resp = rutaRespaldo();
    const b = baseDe({ ...PEDIDOS });
    await correr(cfgDe({ aplicar: true, respaldo: resp }), b);
    const r = await correr(cfgDe({ revertir: true, aplicar: true, respaldo: resp, valor: null }), b);
    expect(r.codigo, r.salida).toBe(0);
    expect(b.datos()).toEqual(PEDIDOS);
  });

  it('si existía, lo restaura con su forma exacta', async () => {
    const resp = rutaRespaldo();
    const previo = { activo: false, monedas: ['ARS'] };
    const c = baseDe({ ...PEDIDOS, catalogoExterno: previo });
    await correr(cfgDe({ aplicar: true, respaldo: resp }), c);
    expect((c.datos() as Record<string, unknown>)['catalogoExterno']).toEqual(ACTIVO_BOB);
    expect((await correr(cfgDe({ revertir: true, aplicar: true, respaldo: resp, valor: null }), c)).codigo).toBe(0);
    expect(c.datos()).toEqual({ ...PEDIDOS, catalogoExterno: previo });
  });

  it('NEGADO: no pisa un cambio ajeno al campo ni a otros campos (2, sin escribir); respaldo de otro comercio o entorno se rechaza', async () => {
    const resp = rutaRespaldo();
    const b = baseDe({ ...PEDIDOS });
    await correr(cfgDe({ aplicar: true, respaldo: resp }), b);
    (b.datos() as Record<string, unknown>)['catalogoExterno'] = { activo: true, monedas: ['ARS'] }; // alguien lo cambió a mano
    const antes = b.escrituras.length;
    const r = await correr(cfgDe({ revertir: true, aplicar: true, respaldo: resp, valor: null }), b);
    expect(r.codigo).toBe(2);
    expect(b.escrituras).toHaveLength(antes);
    expect((b.datos() as Record<string, unknown>)['catalogoExterno']).toEqual({ activo: true, monedas: ['ARS'] });
    expect(mod.leerRespaldo(resp, { entorno: 'emulador', tenant: 'otro-comercio' }).ok).toBe(false);
    expect(mod.leerRespaldo(resp, { entorno: 'produccion', tenant: 'tienda-prueba' }).ok).toBe(false);
  });

  it('NEGADO: un campo ajeno cambiado después de aplicar se conserva al revertir (solo se escribe catalogoExterno)', async () => {
    const resp = rutaRespaldo();
    const b = baseDe({ ...PEDIDOS });
    await correr(cfgDe({ aplicar: true, respaldo: resp }), b);
    (b.datos() as Record<string, unknown>)['maximo'] = 99; // otro campo, cambio legítimo posterior
    const r = await correr(cfgDe({ revertir: true, aplicar: true, respaldo: resp, valor: null }), b);
    expect(r.codigo, r.salida).toBe(0);
    expect(b.datos()).toEqual({ otroCampo: 'intacto', maximo: 99 });
    expect(Object.keys(b.escrituras[b.escrituras.length - 1].campos)).toEqual(['catalogoExterno']);
  });
});

describe('C5. --crear-documento', () => {
  const baseArgs = ['--proyecto', PROY, '--tenant', 'tienda-prueba', '--monedas', 'BOB', '--crear-documento'];
  const problemas = (argv: string[], env: Record<string, string> = ENV_EMU) => {
    const r = mod.analizarArgumentos(argv, env);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    return (r.problemas ?? []).join(' | ');
  };
  const crearCfg = (extra: Cfg = {}) => cfgDe({ crearDocumento: true, ...extra });

  it('argumentos: válido solo con --monedas; NEGADO con --desactivar o --revertir; producción exige --confirmo-produccion', () => {
    expect(mod.analizarArgumentos(baseArgs, ENV_EMU).cfg).toMatchObject({ crearDocumento: true, aplicar: false });
    expect(mod.analizarArgumentos(baseArgs.slice(0, -1), ENV_EMU).cfg).toMatchObject({ crearDocumento: false });
    expect(problemas(['--proyecto', PROY, '--tenant', 'tienda-prueba', '--desactivar', '--crear-documento'])).toContain('no se combina con --desactivar');
    expect(problemas(['--revertir', '--crear-documento', '--proyecto', PROY, '--tenant', 'tienda-prueba', '--respaldo', rutaRespaldo()])).toContain('--revertir no admite');
    expect(problemas([...baseArgs, '--crear-documento'])).toContain('opción repetida');
    const prod = ['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'tienda-prueba', '--monedas', 'BOB', '--crear-documento', '--aplicar', '--respaldo', rutaRespaldo()];
    expect(problemas(prod, ENV_REAL)).toContain('--confirmo-produccion');
    expect(mod.analizarArgumentos([...prod, '--confirmo-produccion', 'tienda-prueba'], ENV_REAL).ok).toBe(true);
  });

  it('NEGADO: sin la opción, un documento ausente NO se crea (1, sin escribir ni respaldo)', async () => {
    const resp = rutaRespaldo();
    const b = baseDe(null);
    const r = await correr(cfgDe({ aplicar: true, respaldo: resp }), b);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('sin --crear-documento');
    expect(b.escrituras).toEqual([]);
    expect(b.datos()).toBeNull();
  });

  it('el seco con la opción no escribe (1) y avisa que crearía el documento', async () => {
    const b = baseDe(null);
    const r = await correr(crearCfg(), b);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('se CREARÍA');
    expect(b.escrituras).toEqual([]);
  });

  it('--aplicar crea el documento con ÚNICAMENTE catalogoExterno, respalda y relee; las lecturas llevan máscara', async () => {
    const resp = rutaRespaldo();
    const b = baseDe(null);
    const r = await correr(crearCfg({ aplicar: true, respaldo: resp, valor: ACTIVO_BOB_ARS }), b);
    expect(r.codigo, r.salida).toBe(0);
    expect(b.escrituras).toEqual([{ campos: { catalogoExterno: ACTIVO_BOB_ARS } }]);
    expect(b.datos()).toEqual({ catalogoExterno: ACTIVO_BOB_ARS });
    const rr = JSON.parse(readFileSync(resp, 'utf8'));
    expect(rr).toMatchObject({ documentoCreado: true, previo: { presente: false, valor: null }, escrito: ACTIVO_BOB_ARS });
    expect(mod.leerRespaldo(resp, { entorno: 'emulador', tenant: 'tienda-prueba' }).ok).toBe(true);
  });

  it('NEGADO: si el documento YA existe, la opción sale 2 sin escribir (ni en seco ni con --aplicar)', async () => {
    for (const aplicar of [false, true]) {
      const b = baseDe({ ...PEDIDOS });
      const r = await correr(crearCfg({ aplicar, respaldo: aplicar ? rutaRespaldo() : null }), b);
      expect(r.codigo).toBe(2);
      expect(r.salida).toContain('YA existe');
      expect(b.escrituras).toEqual([]);
      expect(b.datos()).toEqual(PEDIDOS);
    }
  });

  it('NEGADO: si otro proceso lo crea entre la lectura y la escritura, create() falla y no se pisa nada (3)', async () => {
    const b = baseDe(null, { otroCreaAntes: true });
    const r = await correr(crearCfg({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(r.codigo).toBe(3);
    expect(b.escrituras).toEqual([]);
    expect(b.datos()).toEqual({ creadoPorOtro: true });
  });

  it('revertir BORRA el documento creado si sigue idéntico; con --revertir repetido (ya no existe) sale 0', async () => {
    const resp = rutaRespaldo();
    const b = baseDe(null);
    await correr(crearCfg({ aplicar: true, respaldo: resp }), b);
    const seco = await correr(cfgDe({ revertir: true, aplicar: false, respaldo: resp, valor: null }), b);
    expect(seco.codigo).toBe(1);
    expect(b.datos()).not.toBeNull();
    const r = await correr(cfgDe({ revertir: true, aplicar: true, respaldo: resp, valor: null }), b);
    expect(r.codigo, r.salida).toBe(0);
    expect(b.datos()).toBeNull();
    expect((await correr(cfgDe({ revertir: true, aplicar: true, respaldo: resp, valor: null }), b)).codigo).toBe(0);
  });

  it('NEGADO: revertir con contenido ajeno (otro campo, o el valor cambiado) sale 2 sin tocar', async () => {
    for (const cambio of [{ otro: 1 }, { catalogoExterno: { activo: true, monedas: ['ARS'] } }]) {
      const resp = rutaRespaldo();
      const b = baseDe(null);
      await correr(crearCfg({ aplicar: true, respaldo: resp }), b);
      Object.assign(b.datos() as Record<string, unknown>, cambio);
      const antes = JSON.stringify(b.datos());
      const n = b.escrituras.length;
      const r = await correr(cfgDe({ revertir: true, aplicar: true, respaldo: resp, valor: null }), b);
      expect(r.codigo, JSON.stringify(cambio)).toBe(2);
      expect(b.escrituras).toHaveLength(n);
      expect(JSON.stringify(b.datos())).toBe(antes);
    }
  });

  it('NEGADO: revertir con un respaldo de la corrida normal y el documento ausente sale 1 (no lo creó este script)', async () => {
    const resp = rutaRespaldo();
    const b = baseDe({ ...PEDIDOS });
    await correr(cfgDe({ aplicar: true, respaldo: resp }), b);
    const sin = baseDe(null);
    expect((await correr(cfgDe({ revertir: true, aplicar: true, respaldo: resp, valor: null }), sin)).codigo).toBe(1);
  });
});

describe('C4. el texto del script', () => {
  const texto = readFileSync(SCRIPT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('sus escrituras son `ref.update` del campo, `ref.create` con solo ese campo y el borrado de lo que creó; no usa set, batch ni toca cobros', () => {
    expect(texto.match(/\.update\(/g)).toHaveLength(1);
    expect(texto.match(/\.create\(/g)).toHaveLength(1); // solo --crear-documento, con create() (falla si existe)
    expect(texto.match(/ref\.delete\(/g)).toHaveLength(1); // solo revertir un documento creado por el script
    expect(texto).toContain("const CAMPO = 'catalogoExterno'");
    expect(texto).toContain('config/pedidos');
    expect(texto).not.toMatch(/\.set\(|batch\(|runTransaction|bulkWriter/);
    expect(texto).not.toMatch(/config\/cobros|\.doc\([^)]*cobros/);
  });
  it('no imprime el id de un proyecto real ni lee variables de entorno de secretos', () => {
    expect(texto).not.toMatch(/process\.env\.[A-Z_]*(KEY|SECRET|TOKEN)/);
    expect(texto).not.toMatch(/console\.(log|error)\([^)]*proyecto\b/);
  });
});
