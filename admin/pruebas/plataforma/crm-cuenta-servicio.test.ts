/**
 * `crm-cuenta-servicio.mjs`: aislamiento entre tenants del miniCRM. Puro, sin red: gcloud, n8n y la clave
 * son falsos. Se prueba NEGANDO (qué rechaza) y comprobando que ninguna clave sale por los mensajes.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import { claveReal, correoCuenta, ejecutar, n8nCliente, nombreCredencial, nombreCuenta, verificarAislamiento } from '../../scripts/plataforma/crm-cuenta-servicio.mjs';

const PROY = 'proyecto-ejemplo';
const CLAVE = 'CLAVE-PRIVADA-FALSA-NO-DEBE-SALIR';

function fabrica(existentes: { id: string; name: string }[] = [], opts: { rechaza?: boolean; duda?: boolean; claves?: string[]; listarFalla?: boolean; borrarFalla?: boolean; claveVieja?: boolean } = {}) {
  const llamadas: string[][] = [];
  const subidas: { nombre: string; correo: string }[] = [];
  const descartes: { subida: boolean; duda: boolean }[] = [];
  const borradas: string[] = [];
  const clavesBorradas: string[] = [];
  const actualizadas: string[] = [];
  const d = {
    gcloud: async (args: string[]) => { llamadas.push(args); return { codigo: args[2] === 'describe' ? 1 : 0, salida: '' }; },
    n8n: {
      listar: async () => { if (opts.listarFalla) throw new Error('500'); return existentes; },
      borrar: async (id: string) => { if (opts.borrarFalla) throw new Error('500'); borradas.push(id); },
      actualizar: async (id: string) => {
        if (opts.rechaza) throw Object.assign(new Error('x'), { definitivo: true, estado: 400 });
        if (opts.duda) throw new Error('corte');
        actualizadas.push(id);
        return { id };
      },
      crear: async (nombre: string, k: { correo: string }) => {
        if (opts.rechaza) throw Object.assign(new Error('x'), { definitivo: true, estado: 400 });
        if (opts.duda) throw new Error('corte');
        subidas.push({ nombre, correo: k.correo });
        return { id: 'c1' };
      },
    },
    clave: {
      existentes: async () => ({ ok: true, ids: opts.claves ?? [] }),
      borrar: async (_c: string, id: string) => { clavesBorradas.push(id); return true; },
      crear: async (correo: string): Promise<Record<string, unknown>> => ({ ok: true, correo, privateKey: CLAVE, keyId: 'k1' }),
      descartar: async (_k: unknown, e: { subida: boolean; duda: boolean }) => { descartes.push(e); },
    },
  };
  return { d, llamadas, subidas, descartes, borradas, clavesBorradas, actualizadas };
}
const aplicado = { aplicar: true, confirmo: 'produccion' } as const;
const txt = (r: { mensajes: string[] }) => r.mensajes.join('\n');

describe('crm-cuenta-servicio: nombres', () => {
  it('la cuenta es crm-<tenant> y la credencial lleva el tenant', () => {
    expect(nombreCuenta('rubenroca')).toBe('crm-rubenroca');
    expect(nombreCredencial('evy')).toContain('crm-evy');
    expect(correoCuenta('evy', PROY)).toBe(`crm-evy@${PROY}.iam.gserviceaccount.com`);
  });
  it('rechaza tenants inválidos', () => {
    for (const t of ['', 'AB', 'a', 'Ruben', 'ru ben', 'ruben_roca', '-ruben', 'ruben-', 'ru--ben', 'x'.repeat(27), '../x', 'ruben;rm', undefined]) {
      expect(() => nombreCuenta(t as string), String(t)).toThrow();
    }
  });
  it('rechaza proyecto inválido', () => {
    expect(() => correoCuenta('evy', 'Mal Proyecto')).toThrow();
  });
});

describe('crm-cuenta-servicio: aislamiento', () => {
  it('cuatro tenants distintos no colisionan', () => {
    expect(verificarAislamiento(['ruben', 'antonio', 'evy', 'emma'])).toEqual([]);
  });
  it('un tenant repetido o inválido es un problema', () => {
    expect(verificarAislamiento(['evy', 'evy']).join()).toContain('repetido');
    expect(verificarAislamiento(['evy', 'Evy']).join()).toContain('inválido');
  });
  it('dos tenants nunca producen la misma cuenta ni la misma credencial', () => {
    const ts = ['ruben', 'antonio', 'evy', 'emma', 'ruben-2'];
    expect(new Set(ts.map(nombreCuenta)).size).toBe(ts.length);
    expect(new Set(ts.map(nombreCredencial)).size).toBe(ts.length);
  });
  it('registrar rechaza si la credencial del tenant ya existe y no sube nada', async () => {
    const f = fabrica([{ id: '9', name: nombreCredencial('evy') }]);
    const r = await ejecutar({ sub: 'registrar-credencial-n8n', tenant: 'evy', proyecto: PROY, ...aplicado, d: f.d });
    expect(r.codigo).toBe(1);
    expect(f.subidas).toHaveLength(0);
  });
  it('la credencial de otro tenant no estorba ni se reutiliza', async () => {
    const f = fabrica([{ id: '9', name: nombreCredencial('emma') }]);
    const r = await ejecutar({ sub: 'registrar-credencial-n8n', tenant: 'evy', proyecto: PROY, ...aplicado, d: f.d });
    expect(r.codigo).toBe(0);
    expect(f.subidas).toEqual([{ nombre: nombreCredencial('evy'), correo: correoCuenta('evy', PROY) }]);
  });
  it('una clave de otra cuenta no se sube', async () => {
    const f = fabrica();
    f.d.clave.crear = async () => ({ ok: true, correo: correoCuenta('emma', PROY), privateKey: CLAVE, keyId: 'k1' });
    const r = await ejecutar({ sub: 'registrar-credencial-n8n', tenant: 'evy', proyecto: PROY, ...aplicado, d: f.d });
    expect(r.codigo).toBe(1);
    expect(f.subidas).toHaveLength(0);
    expect(f.descartes).toEqual([{ subida: false, duda: false }]);
  });
  it('quitar borra solo la credencial del tenant', async () => {
    const f = fabrica([{ id: '1', name: nombreCredencial('evy') }, { id: '2', name: nombreCredencial('emma') }]);
    expect((await ejecutar({ sub: 'quitar', tenant: 'evy', proyecto: PROY, ...aplicado, d: f.d })).codigo).toBe(0);
    expect(f.borradas).toEqual(['1']);
    expect(f.llamadas.flat().join(' ')).toContain('crm-evy@');
    expect(f.llamadas.flat().join(' ')).not.toContain('crm-emma');
  });
});

describe('crm-cuenta-servicio: salvaguardas', () => {
  it('por omisión es seco: no llama a nada', async () => {
    const f = fabrica();
    for (const sub of ['crear', 'registrar-credencial-n8n', 'quitar']) {
      const r = await ejecutar({ sub, tenant: 'evy', proyecto: PROY, d: undefined });
      expect(r.codigo).toBe(0);
      expect(txt(r)).toContain('SECO');
    }
    expect(f.llamadas).toHaveLength(0);
  });
  it('fuera del seco sin --confirmo produccion sale 2 y no escribe', async () => {
    for (const confirmo of [undefined, '', 'si', 'prod', 'Produccion']) {
      const f = fabrica();
      const r = await ejecutar({ sub: 'crear', tenant: 'evy', proyecto: PROY, aplicar: true, confirmo, d: f.d });
      expect(r.codigo).toBe(2);
      expect(f.llamadas).toHaveLength(0);
    }
  });
  it('--confirmo sin --aplicar no se acepta', async () => {
    const r = await ejecutar({ sub: 'quitar', tenant: 'evy', proyecto: PROY, aplicar: false, confirmo: 'produccion' });
    expect(r.codigo).toBe(2);
  });
  it('subcomando, tenant y proyecto inválidos salen 2', async () => {
    expect((await ejecutar({ sub: 'borrar-todo', tenant: 'evy', proyecto: PROY })).codigo).toBe(2);
    expect((await ejecutar({ sub: 'crear', tenant: 'EVY', proyecto: PROY })).codigo).toBe(2);
    expect((await ejecutar({ sub: 'crear', tenant: 'evy', proyecto: undefined })).codigo).toBe(2);
  });
  it('mostrar-correo imprime el correo y no necesita dependencias', async () => {
    const r = await ejecutar({ sub: 'mostrar-correo', tenant: 'evy', proyecto: PROY });
    expect(r.mensajes).toEqual([correoCuenta('evy', PROY)]);
  });
  it('la clave privada nunca aparece en los mensajes (éxito, rechazo ni duda)', async () => {
    for (const o of [{}, { rechaza: true }, { duda: true }]) {
      const f = fabrica([], o);
      const r = await ejecutar({ sub: 'registrar-credencial-n8n', tenant: 'evy', proyecto: PROY, ...aplicado, d: f.d });
      expect(txt(r)).not.toContain(CLAVE);
      expect(f.descartes).toHaveLength(1);
    }
  });
  it('rechazo definitivo → la clave se descarta (se borra de IAM); duda → sale 3 sin borrar', async () => {
    const a = fabrica([], { rechaza: true });
    expect((await ejecutar({ sub: 'registrar-credencial-n8n', tenant: 'evy', proyecto: PROY, ...aplicado, d: a.d })).codigo).toBe(1);
    expect(a.descartes).toEqual([{ subida: false, duda: false }]);
    const b = fabrica([], { duda: true });
    expect((await ejecutar({ sub: 'registrar-credencial-n8n', tenant: 'evy', proyecto: PROY, ...aplicado, d: b.d })).codigo).toBe(3);
    expect(b.descartes).toEqual([{ subida: false, duda: true }]);
  });
  it('crear no duplica una cuenta existente', async () => {
    const f = fabrica();
    f.d.gcloud = async (args: string[]) => { f.llamadas.push(args); return { codigo: 0, salida: '' }; };
    const r = await ejecutar({ sub: 'crear', tenant: 'evy', proyecto: PROY, ...aplicado, d: f.d });
    expect(r.codigo).toBe(0);
    expect(f.llamadas.some((a) => a[2] === 'create')).toBe(false);
  });
});

describe('crm-cuenta-servicio: claves previas, quitar y rotar', () => {
  it('registrar sale 1 si la cuenta ya tiene claves de usuario y no crea otra', async () => {
    const f = fabrica([], { claves: ['k-vieja'] });
    let creadas = 0;
    const orig = f.d.clave.crear;
    f.d.clave.crear = async (c: string) => { creadas += 1; return orig(c); };
    const r = await ejecutar({ sub: 'registrar-credencial-n8n', tenant: 'evy', proyecto: PROY, ...aplicado, d: f.d });
    expect(r.codigo).toBe(1);
    expect(creadas).toBe(0);
    expect(f.subidas).toHaveLength(0);
  });
  it('registrar sale 1 si no se pueden listar las claves o n8n no lista', async () => {
    const f = fabrica();
    f.d.clave.existentes = async () => ({ ok: false, ids: [] });
    expect((await ejecutar({ sub: 'registrar-credencial-n8n', tenant: 'evy', proyecto: PROY, ...aplicado, d: f.d })).codigo).toBe(1);
    const g = fabrica([], { listarFalla: true });
    expect((await ejecutar({ sub: 'registrar-credencial-n8n', tenant: 'evy', proyecto: PROY, ...aplicado, d: g.d })).codigo).toBe(1);
  });
  it('sin /dev/shm la creación aborta con 2', async () => {
    const f = fabrica();
    f.d.clave.crear = async () => ({ ok: false, abortar: true, motivo: 'sin shm' });
    const r = await ejecutar({ sub: 'registrar-credencial-n8n', tenant: 'evy', proyecto: PROY, ...aplicado, d: f.d });
    expect(r.codigo).toBe(2);
  });
  it('clave ilegible: avisa que hay que borrarla de IAM', async () => {
    const f = fabrica();
    f.d.clave.crear = async () => ({ ok: false, huerfana: true, ids: ['projects/x/keys/abcdef123456'] });
    const r = await ejecutar({ sub: 'registrar-credencial-n8n', tenant: 'evy', proyecto: PROY, ...aplicado, d: f.d });
    expect(r.codigo).toBe(1);
    expect(txt(r)).toContain('borrarla de IAM');
  });
  it('quitar: si n8n falla al listar o al borrar sale 1, no dice «borradas» y no toca la cuenta', async () => {
    for (const o of [{ listarFalla: true }, { borrarFalla: true }]) {
      const f = fabrica([{ id: '1', name: nombreCredencial('evy') }], o);
      const r = await ejecutar({ sub: 'quitar', tenant: 'evy', proyecto: PROY, ...aplicado, d: f.d });
      expect(r.codigo).toBe(1);
      expect(txt(r)).not.toContain('cuenta de evy borrada');
      expect(f.llamadas).toHaveLength(0);
    }
  });
  it('rotar: mantiene el id, sube la clave nueva y borra la vieja', async () => {
    const f = fabrica([{ id: '7', name: nombreCredencial('evy') }], { claves: ['k-vieja'] });
    const r = await ejecutar({ sub: 'rotar', tenant: 'evy', proyecto: PROY, ...aplicado, d: f.d });
    expect(r.codigo).toBe(0);
    expect(f.actualizadas).toEqual(['7']);
    expect(f.subidas).toHaveLength(0);
    expect(f.clavesBorradas).toEqual(['k-vieja']);
    expect(txt(r)).not.toContain(CLAVE);
  });
  it('rotar rechaza: sin credencial, sin exactamente una clave vieja, o con credencial de otro tenant', async () => {
    const sin = fabrica([{ id: '9', name: nombreCredencial('emma') }], { claves: ['k'] });
    expect((await ejecutar({ sub: 'rotar', tenant: 'evy', proyecto: PROY, ...aplicado, d: sin.d })).codigo).toBe(1);
    for (const claves of [[], ['a', 'b']]) {
      const f = fabrica([{ id: '7', name: nombreCredencial('evy') }], { claves });
      expect((await ejecutar({ sub: 'rotar', tenant: 'evy', proyecto: PROY, ...aplicado, d: f.d })).codigo).toBe(1);
      expect(f.actualizadas).toHaveLength(0);
    }
  });
  it('rotar: si n8n rechaza se descarta la clave nueva y no se borra la vieja; si hay duda sale 3', async () => {
    const a = fabrica([{ id: '7', name: nombreCredencial('evy') }], { claves: ['k-vieja'], rechaza: true });
    expect((await ejecutar({ sub: 'rotar', tenant: 'evy', proyecto: PROY, ...aplicado, d: a.d })).codigo).toBe(1);
    expect(a.descartes).toEqual([{ subida: false, duda: false }]);
    expect(a.clavesBorradas).toEqual([]);
    const b = fabrica([{ id: '7', name: nombreCredencial('evy') }], { claves: ['k-vieja'], duda: true });
    expect((await ejecutar({ sub: 'rotar', tenant: 'evy', proyecto: PROY, ...aplicado, d: b.d })).codigo).toBe(3);
    expect(b.clavesBorradas).toEqual([]);
  });
  it('el seco de rotar y quitar no llama a nada', async () => {
    for (const sub of ['rotar', 'quitar']) expect((await ejecutar({ sub, tenant: 'evy', proyecto: PROY })).codigo).toBe(0);
  });
});

describe('claveReal con un gcloud falso (el directorio de la clave siempre desaparece)', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'crm-prueba-'));
  afterAll(() => rmSync(raiz, { recursive: true, force: true }));
  const shm = join(raiz, 'shm');
  const falso = join(raiz, 'gcloud-falso');
  writeFileSync(falso, `#!/usr/bin/env bash
if [[ "$*" == *"keys list"* ]]; then printf '%s\n' $FAKE_IDS; exit 0; fi
if [[ "$*" == *"keys create"* ]]; then
  archivo="$5"
  case "$FAKE_MODO" in
    ok) printf '{"client_email":"%s","private_key":"FALSA","private_key_id":"idfalso"}' "$7" > "$archivo"; exit 0 ;;
    falla) printf 'parcial' > "$archivo"; exit 1 ;;
    roto) printf '{no es json' > "$archivo"; exit 0 ;;
  esac
fi
if [[ "$*" == *"keys delete"* ]]; then exit "\${FAKE_BORRAR:-0}"; fi
exit 1
`);
  chmodSync(falso, 0o700);
  const correo = correoCuenta('evy', PROY);
  const conModo = (modo: string, ids = '') => { process.env.FAKE_MODO = modo; process.env.FAKE_IDS = ids; };

  it('éxito: devuelve la clave en memoria y no deja nada en el directorio', async () => {
    rmSync(shm, { recursive: true, force: true }); mkdirSync(shm);
    conModo('ok');
    const k = await claveReal(PROY, { shm, gcloud: falso }).crear(correo);
    expect(k.ok).toBe(true);
    expect(k.correo).toBe(correo);
    expect(readdirSync(shm)).toEqual([]);
  });
  it('gcloud escribe el archivo y luego falla: el directorio desaparece', async () => {
    rmSync(shm, { recursive: true, force: true }); mkdirSync(shm);
    conModo('falla');
    expect((await claveReal(PROY, { shm, gcloud: falso }).crear(correo)).ok).toBe(false);
    expect(readdirSync(shm)).toEqual([]);
  });
  it('JSON roto: el directorio desaparece y se informa la clave huérfana con sus ids', async () => {
    rmSync(shm, { recursive: true, force: true }); mkdirSync(shm);
    conModo('roto', 'projects/p/keys/abc123');
    const k = await claveReal(PROY, { shm, gcloud: falso }).crear(correo);
    expect(k.ok).toBe(false);
    expect(k.huerfana).toBe(true);
    expect(k.ids).toEqual(['projects/p/keys/abc123']);
    expect(readdirSync(shm)).toEqual([]);
  });
  it('sin /dev/shm aborta y no escribe en ningún otro lado', async () => {
    rmSync(shm, { recursive: true, force: true });
    conModo('ok');
    const k = await claveReal(PROY, { shm, gcloud: falso }).crear(correo);
    expect(k.abortar).toBe(true);
    expect(existsSync(shm)).toBe(false);
  });
  it('existentes lista las claves de usuario', async () => {
    conModo('ok', 'k1 k2');
    expect(await claveReal(PROY, { shm, gcloud: falso }).existentes(correo)).toEqual({ ok: true, ids: ['k1', 'k2'] });
  });
});

describe('n8nCliente contra un servidor HTTP local', () => {
  const servidores: Server[] = [];
  afterAll(() => { for (const s of servidores) s.close(); });
  const levantar = async (manejador: Parameters<typeof createServer>[1]) => {
    const s = createServer(manejador);
    servidores.push(s);
    await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
    const { port } = s.address() as { port: number };
    return n8nCliente({ baseUrl: `http://127.0.0.1:${port}`, llaveApi: 'llave-falsa', timeoutMs: 400 });
  };
  const k = { correo: 'a@b', privateKey: 'FALSA' };

  it('401 y 500 lanzan en listar, borrar, crear y actualizar (crear/actualizar como rechazo definitivo)', async () => {
    for (const estado of [401, 500]) {
      const c = await levantar((_q, r) => { r.statusCode = estado; r.end('{}'); });
      await expect(c.listar()).rejects.toThrow();
      await expect(c.borrar('1')).rejects.toThrow();
      await expect(c.crear('n', k)).rejects.toMatchObject({ definitivo: true, estado });
      await expect(c.actualizar('1', 'n', k)).rejects.toMatchObject({ definitivo: true, estado });
    }
  });
  it('listar pagina con nextCursor y manda la llave', async () => {
    const vistas: string[] = [];
    const c = await levantar((q, r) => {
      vistas.push(`${q.headers['x-n8n-api-key']} ${q.url}`);
      const pag2 = (q.url ?? '').includes('cursor=p2');
      r.setHeader('content-type', 'application/json');
      r.end(JSON.stringify(pag2 ? { data: [{ id: '2', name: 'b' }] } : { data: [{ id: '1', name: 'a' }], nextCursor: 'p2' }));
    });
    expect((await c.listar()).map((x: { id: string }) => x.id)).toEqual(['1', '2']);
    expect(vistas).toHaveLength(2);
    expect(vistas[0]).toContain('llave-falsa');
  });
  it('actualizar usa PATCH sobre el id', async () => {
    let visto = '';
    const c = await levantar((q, r) => { visto = `${q.method} ${q.url}`; r.end('{"id":"7"}'); });
    await c.actualizar('7', 'n', k);
    expect(visto).toBe('PATCH /api/v1/credentials/7');
  });
  it('un servidor que no contesta corta por tiempo (sin definitivo: es duda)', async () => {
    const c = await levantar(() => { /* no responde */ });
    const e = await c.crear('n', k).catch((x: Error & { definitivo?: boolean }) => x);
    expect(e).toBeInstanceOf(Error);
    expect((e as { definitivo?: boolean }).definitivo).toBeUndefined();
  });
});
