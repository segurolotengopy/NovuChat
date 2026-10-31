/**
 * `crm-cuenta-servicio.mjs`: aislamiento entre tenants del miniCRM. Puro, sin red: gcloud, n8n y la clave
 * son falsos. Se prueba NEGANDO (qué rechaza) y comprobando que ninguna clave sale por los mensajes.
 */
import { describe, expect, it } from 'vitest';
import {
  // @ts-expect-error módulo .mjs sin tipos
  correoCuenta, ejecutar, nombreCredencial, nombreCuenta, verificarAislamiento,
} from '../../scripts/plataforma/crm-cuenta-servicio.mjs';

const PROY = 'proyecto-ejemplo';
const CLAVE = 'CLAVE-PRIVADA-FALSA-NO-DEBE-SALIR';

function fabrica(existentes: { id: string; name: string }[] = [], opts: { rechaza?: boolean; duda?: boolean } = {}) {
  const llamadas: string[][] = [];
  const subidas: { nombre: string; correo: string }[] = [];
  const descartes: { subida: boolean; duda: boolean }[] = [];
  const borradas: string[] = [];
  const d = {
    gcloud: async (args: string[]) => { llamadas.push(args); return { codigo: args[2] === 'describe' ? 1 : 0, salida: '' }; },
    n8n: {
      listar: async () => existentes,
      borrar: async (id: string) => { borradas.push(id); },
      crear: async (nombre: string, k: { correo: string }) => {
        if (opts.rechaza) throw Object.assign(new Error('x'), { definitivo: true, estado: 400 });
        if (opts.duda) throw new Error('corte');
        subidas.push({ nombre, correo: k.correo });
        return { id: 'c1' };
      },
    },
    clave: {
      crear: async (correo: string) => ({ ok: true, correo, privateKey: CLAVE, keyId: 'k1' }),
      descartar: async (_k: unknown, e: { subida: boolean; duda: boolean }) => { descartes.push(e); },
    },
  };
  return { d, llamadas, subidas, descartes, borradas };
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
    await ejecutar({ sub: 'quitar', tenant: 'evy', proyecto: PROY, ...aplicado, d: f.d });
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
