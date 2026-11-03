/**
 * `scripts/plataforma/aplicar-guardar-medios.mjs` — ESCRIBE `tenants/{id}.guardarMedios` DE UN COMERCIO
 * (la bandera que `functions/src/core/medios/guardarMedio.ts` lee con `=== true`). Calcado de
 * `aplicar-consola-conversaciones.test.ts`; reutiliza sus piezas de proyecto y respaldo, que ya tienen su prueba.
 *
 * Sin emulador ni nube: lógica pura y una base en memoria. Las fichas son sintéticas.
 *   B1. Argumentos y salvaguarda (negando primero): el valor es EXACTAMENTE true o false, un comercio, producción con confirmación.
 *   B2. Seco por omisión (no escribe), `--aplicar` con respaldo, UNA escritura de un campo con precondición.
 *   B3. Revertir (restaura o elimina el campo; no pisa un cambio ajeno).
 *   B4. El texto del script: su única escritura es `update` de `guardarMedios`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', 'scripts', 'plataforma', 'aplicar-guardar-medios.mjs');
type Cfg = Record<string, unknown>;
const mod = await import('../../scripts/plataforma/aplicar-guardar-medios.mjs') as unknown as {
  analizarArgumentos: (argv: string[], env?: Record<string, string>, op?: Record<string, unknown>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  validarValor: (t: unknown) => { ok: boolean; valor?: boolean };
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
const nuevoDir = () => { const d = mkdtempSync(join('/tmp', 'guardar-medios-')); chmodSync(d, 0o700); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const rutaRespaldo = () => join(nuevoDir(), 'respaldo.json');

/** Una Firestore en memoria con UNA ficha: cuenta las escrituras y puede cambiar entre la lectura y la escritura. */
function baseDe(ficha: Record<string, unknown> | null, opciones: { cambiaAntesDeEscribir?: boolean } = {}) {
  let datos = ficha === null ? null : { ...ficha };
  let hora = 1;
  const lecturas: { campos: string[] | undefined }[] = [];
  const escrituras: { campos: Record<string, unknown> }[] = [];
  const snap = (mascara?: string[]) => {
    const d = datos === null ? undefined : Object.fromEntries(Object.entries(datos).filter(([k]) => !mascara || mascara.includes(k)));
    return { exists: datos !== null, data: () => d, updateTime: { toDate: () => new Date(hora * 1000), hora } };
  };
  const ref = {
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
  return {
    escrituras, lecturas, datos: () => datos,
    db: { doc: () => ref, getAll: async (_r: unknown, o?: { fieldMask?: string[] }) => { lecturas.push({ campos: o?.fieldMask }); return [snap(o?.fieldMask)]; } },
    FieldValue: { delete: () => ({ __borrar: true }) },
  };
}
const correr = async (cfg: Cfg, b: ReturnType<typeof baseDe>) => {
  const salida: string[] = [];
  const codigo = await mod.ejecutar(cfg, { db: b.db, FieldValue: b.FieldValue, log: (t: string) => salida.push(t) });
  return { codigo, salida: salida.join('\n') };
};
const cfgDe = (extra: Cfg = {}): Cfg => {
  const c: Cfg = { proyecto: PROY, entorno: 'emulador', tenant: 'tienda-prueba', valor: true, aplicar: false, revertir: false, respaldo: null, ...extra };
  if (typeof c['respaldo'] === 'string' && !('respaldoResuelto' in c)) c['respaldoResuelto'] = conv.comprobarRespaldo(c['respaldo'], { permitirExistente: true }).real ?? null;
  return c;
};
const FICHA = { nombre: 'Tienda Sintetica', flujos: ['venta'] };

describe('B1. argumentos y salvaguarda (puros)', () => {
  const base = ['--proyecto', PROY, '--tenant', 'tienda-prueba', '--valor', 'true'];
  const problemas = (argv: string[], env: Record<string, string> = ENV_EMU) => {
    const r = mod.analizarArgumentos(argv, env);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    return (r.problemas ?? []).join(' | ');
  };

  it('la invocación completa es válida y queda en seco; true y false valen', () => {
    const r = mod.analizarArgumentos(base, ENV_EMU);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.cfg).toMatchObject({ tenant: 'tienda-prueba', valor: true, aplicar: false, revertir: false, entorno: 'emulador' });
    expect(mod.analizarArgumentos(['--proyecto', PROY, '--tenant', 'tienda-prueba', '--valor', 'false'], ENV_EMU).cfg?.['valor']).toBe(false);
  });

  it('NEGADO: el valor es EXACTAMENTE true o false (texto), nada más', () => {
    for (const malo of ['True', 'FALSE', '1', '0', 'si', 'yes', 'on', ' true', 'true ', 'null', '', '__proto__', 'true,false']) {
      const r = mod.validarValor(malo);
      expect(r.ok, malo).toBe(false);
    }
    expect(mod.validarValor(true).ok).toBe(false);
    expect(mod.validarValor(undefined).ok).toBe(false);
    expect(problemas(['--proyecto', PROY, '--tenant', 'tienda-prueba', '--valor', 'si'])).toContain('exactamente');
    expect(problemas(['--proyecto', PROY, '--tenant', 'tienda-prueba'])).toContain('falta --valor');
    expect(problemas(['--proyecto', PROY, '--tenant', 'tienda-prueba', '--valor'])).toContain('--valor sin valor');
  });

  it('NEGADO: un solo comercio, id válido, opciones desconocidas o repetidas', () => {
    expect(problemas(['--proyecto', PROY, '--tenant', 'a-uno,b-dos', '--valor', 'true'])).toContain('UN solo comercio');
    expect(problemas(['--proyecto', PROY, '--tenant', 'Tienda', '--valor', 'true'])).toContain('--tenant inválido');
    expect(problemas([...base, '--todos'])).toContain('opción desconocida');
    expect(problemas([...base, '--valor', 'false'])).toContain('opción repetida');
    expect(problemas([...base, 'suelto'])).toContain('argumento suelto');
  });

  it('NEGADO: proyecto fuera de la lista blanca, y producción exige --confirmo-produccion igual al tenant', () => {
    expect(problemas(['--proyecto', 'otro-proyecto-real', '--tenant', 'tienda-prueba', '--valor', 'true'], ENV_REAL)).toContain('lista blanca');
    const prod = ['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'tienda-prueba', '--valor', 'true'];
    expect(mod.analizarArgumentos(prod, ENV_REAL).ok).toBe(true); // seco: se permite sin confirmación
    const resp = rutaRespaldo();
    expect(problemas([...prod, '--aplicar', '--respaldo', resp], ENV_REAL)).toContain('--confirmo-produccion');
    expect(problemas([...prod, '--aplicar', '--respaldo', resp, '--confirmo-produccion', 'otro-comercio'], ENV_REAL)).toContain('no coincide');
    expect(mod.analizarArgumentos([...prod, '--aplicar', '--respaldo', resp, '--confirmo-produccion', 'tienda-prueba'], ENV_REAL).ok).toBe(true);
    expect(problemas([...base, '--confirmo-produccion', 'tienda-prueba'])).toContain('solo se usa contra producción');
  });

  it('NEGADO: --aplicar sin respaldo; respaldo dentro del repositorio; --revertir sin respaldo o con --valor', () => {
    expect(problemas([...base, '--aplicar'])).toContain('--aplicar exige --respaldo');
    expect(problemas([...base, '--aplicar', '--respaldo', join(aqui, 'respaldo.json')])).toMatch(/respaldo (duradero|no puede)/);
    expect(problemas(['--revertir', '--proyecto', PROY, '--tenant', 'tienda-prueba'])).toContain('--revertir exige --respaldo');
    expect(problemas(['--revertir', '--proyecto', PROY, '--tenant', 'tienda-prueba', '--valor', 'true', '--respaldo', rutaRespaldo()])).toContain('--revertir no admite --valor');
  });
});

describe('B2. seco, aplicar, una sola escritura con precondición', () => {
  it('el seco NO escribe, lee solo el campo y sale 1 si hay diferencia; al encender recuerda las condiciones', async () => {
    const b = baseDe({ ...FICHA });
    const r = await correr(cfgDe(), b);
    expect(r.codigo).toBe(1);
    expect(b.escrituras).toEqual([]);
    expect(b.lecturas.every((l) => l.campos?.length === 1 && l.campos[0] === 'guardarMedios')).toBe(true);
    expect(r.salida).toContain('AUSENTE');
    expect(r.salida).toContain('Antes de encender');
    const apagar = await correr(cfgDe({ valor: false }), baseDe({ ...FICHA, guardarMedios: true }));
    expect(apagar.salida).not.toContain('Antes de encender');
  });

  it('es idempotente: si ya vale lo pedido, sale 0 sin escribir (y sin respaldo)', async () => {
    const b = baseDe({ ...FICHA, guardarMedios: true });
    const r = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(r.codigo).toBe(0);
    expect(b.escrituras).toEqual([]);
  });

  it('--aplicar guarda el respaldo, escribe UN campo con precondición y relee; la ficha conserva lo demás', async () => {
    const resp = rutaRespaldo();
    const b = baseDe({ ...FICHA });
    const r = await correr(cfgDe({ aplicar: true, respaldo: resp }), b);
    expect(r.codigo, r.salida).toBe(0);
    expect(b.escrituras).toHaveLength(1);
    expect(Object.keys(b.escrituras[0].campos)).toEqual(['guardarMedios']);
    expect(b.datos()).toMatchObject({ ...FICHA, guardarMedios: true });
    const rr = JSON.parse(readFileSync(resp, 'utf8'));
    expect(rr).toMatchObject({ campo: 'guardarMedios', tenant: 'tienda-prueba', previo: { presente: false, valor: null }, escrito: true });
    expect(mod.leerRespaldo(resp, { entorno: 'emulador', tenant: 'tienda-prueba' }).ok).toBe(true);
  });

  it('NEGADO: si la ficha cambia entre la lectura y la escritura, aborta sin escribir (3)', async () => {
    const b = baseDe({ ...FICHA }, { cambiaAntesDeEscribir: true });
    const r = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(r.codigo).toBe(3);
    expect(b.escrituras).toEqual([]);
    expect((b.datos() as Record<string, unknown>)['guardarMedios']).toBeUndefined();
  });

  it('NEGADO: ficha inexistente (1); valor previo que no es booleano (2, sin respaldo ni escritura); respaldo ya existente (2)', async () => {
    expect((await correr(cfgDe(), baseDe(null))).codigo).toBe(1);
    const malo = baseDe({ ...FICHA, guardarMedios: 'si' });
    const r = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), malo);
    expect(r.codigo).toBe(2);
    expect(malo.escrituras).toEqual([]);
    const resp = rutaRespaldo();
    writeFileSync(resp, '{}', { mode: 0o600 });
    const yaHay = baseDe({ ...FICHA });
    expect((await correr(cfgDe({ aplicar: true, respaldo: resp }), yaHay)).codigo).toBe(2);
    expect(yaHay.escrituras).toEqual([]);
  });
});

describe('B3. revertir', () => {
  it('restaura el valor previo; si el campo no existía, lo ELIMINA', async () => {
    const resp = rutaRespaldo();
    const b = baseDe({ ...FICHA });
    await correr(cfgDe({ aplicar: true, respaldo: resp }), b);
    const r = await correr(cfgDe({ revertir: true, aplicar: true, respaldo: resp, valor: null }), b);
    expect(r.codigo, r.salida).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(b.datos(), 'guardarMedios')).toBe(false);

    const resp2 = rutaRespaldo();
    const c = baseDe({ ...FICHA, guardarMedios: false });
    await correr(cfgDe({ aplicar: true, respaldo: resp2 }), c);
    expect((c.datos() as Record<string, unknown>)['guardarMedios']).toBe(true);
    expect((await correr(cfgDe({ revertir: true, aplicar: true, respaldo: resp2, valor: null }), c)).codigo).toBe(0);
    expect((c.datos() as Record<string, unknown>)['guardarMedios']).toBe(false);
  });

  it('NEGADO: no pisa un cambio ajeno (2, sin escribir); respaldo de otro comercio o entorno se rechaza', async () => {
    const resp = rutaRespaldo();
    const b = baseDe({ ...FICHA });
    await correr(cfgDe({ aplicar: true, respaldo: resp }), b);
    (b.datos() as Record<string, unknown>)['guardarMedios'] = false; // alguien lo apagó a mano
    const antes = b.escrituras.length;
    const r = await correr(cfgDe({ revertir: true, aplicar: true, respaldo: resp, valor: null }), b);
    expect(r.codigo).toBe(2);
    expect(b.escrituras).toHaveLength(antes);
    expect(mod.leerRespaldo(resp, { entorno: 'emulador', tenant: 'otro-comercio' }).ok).toBe(false);
    expect(mod.leerRespaldo(resp, { entorno: 'produccion', tenant: 'tienda-prueba' }).ok).toBe(false);
  });
});

describe('B4. el texto del script', () => {
  const texto = readFileSync(SCRIPT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('su única escritura a Firestore es `ref.update` del campo guardarMedios; no usa set, delete de documento ni batch', () => {
    expect(texto.match(/\.update\(/g)).toHaveLength(1);
    expect(texto).toContain("const CAMPO = 'guardarMedios'");
    expect(texto).not.toMatch(/\.set\(|\.create\(|batch\(|runTransaction|bulkWriter/);
  });
  it('no imprime el id de un proyecto real ni lee variables de entorno de secretos', () => {
    expect(texto).not.toMatch(/process\.env\.[A-Z_]*(KEY|SECRET|TOKEN)/);
    expect(texto).not.toMatch(/console\.(log|error)\([^)]*proyecto\b/);
  });
});
