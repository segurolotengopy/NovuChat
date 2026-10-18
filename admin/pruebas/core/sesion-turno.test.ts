/**
 * ESTADO DE LA CONVERSACIÓN (F3b, PR-1): EL NÚCLEO PURO.
 *
 * Lo que se defiende, negando: la petición `sesion` se rechaza con error fijo
 * ante cualquier forma fuera del contrato; los ids de documento no admiten `/`
 * ni `~`; los períodos cortan a medianoche y a la hora EN LA PAZ (fechas
 * calculadas, nunca fijas); un estado vencido se lee como `null` sin borrar la
 * versión; y el compromiso no mueve la versión en ningún caso negativo.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  decidirCompromiso, decidirVisto, ERRORES_SESION, finDelPeriodo, idCupo, idSesion, idVisto,
  leerConversacion, periodoDe, planDeCupos, validarSesion, venceDeCupo,
  type DocSesion, type EntradaCompromiso,
} from '../../functions/src/core/turno/sesion';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FUENTE = readFileSync(join(AQUI, '../../functions/src/core/turno/sesion.ts'), 'utf8');
const TEL = '59170000001';
const H = 3_600_000;
const D = 24 * H;

const comprometer = (extra: Record<string, unknown> = {}) => ({
  v: 1, accion: 'comprometer', espacio: 'venta', ejecucion: 'ej-1', versionLeida: 0,
  idCompromiso: 'ej-1:turno-1', estado: { paso: 'menu' }, venceEnMin: 60, ...extra,
});
const malo = (sesion: unknown, tel: string | null = TEL) => {
  const r = validarSesion(sesion, tel);
  if (r.ok) throw new Error('debía rechazarse');
  return r;
};

describe('validarSesion: lo que entra', () => {
  it('acepta un leer mínimo y aplica los valores por omisión', () => {
    const r = validarSesion({ v: 1, espacio: 'venta', ejecucion: 'ej-1', idMensaje: 'wamid.X' }, TEL);
    expect(r).toMatchObject({ ok: true, peticion: { accion: 'leer', canal: 'wa', cupos: [] } });
  });

  it('acepta un comprometer completo', () => {
    const r = validarSesion(
      comprometer({ cupos: [{ clave: 'aviso', alcance: 'contacto', periodo: 'hora', cantidad: 1, tope: 3 }] }), TEL,
    );
    expect(r.ok).toBe(true);
  });

  it('v desconocido o ausente -> 400', () => {
    expect(malo({ ...comprometer(), v: 2 })).toMatchObject({ status: 400, error: ERRORES_SESION.version });
    expect(malo({ ...comprometer(), v: '1' })).toMatchObject({ status: 400, error: ERRORES_SESION.version });
    expect(malo({ ...comprometer(), v: undefined })).toMatchObject({ status: 400 });
  });

  it('sesion sin teléfono válido -> 400, aunque lo demás esté bien', () => {
    for (const t of [null, '', '123', 'abc12345678', '1234567890123456', '5917000000+']) {
      expect(malo(comprometer(), t)).toMatchObject({ status: 400, error: ERRORES_SESION.telefono });
    }
  });

  it('no es un objeto -> 400', () => {
    for (const s of [null, undefined, 'x', 7, [], [comprometer()]]) {
      expect(malo(s)).toMatchObject({ status: 400, error: ERRORES_SESION.forma });
    }
  });

  it('claves ajenas (un tenantId del cuerpo, por ejemplo) -> 400', () => {
    expect(malo(comprometer({ tenantId: 'otro' })).status).toBe(400);
    expect(malo(comprometer({ phoneNumberId: '1' })).status).toBe(400);
  });

  it('accion y canal fuera de la lista -> 400', () => {
    expect(malo(comprometer({ accion: 'borrar' })).status).toBe(400);
    expect(malo(comprometer({ canal: 'ms' })).status).toBe(400);
    expect(malo(comprometer({ accion: 7 })).status).toBe(400);
  });

  it('espacio malformado o con "/" -> 400', () => {
    for (const e of ['', 'Venta', '1venta', 'venta/otro', 've~nta', 'a'.repeat(33), 'ven ta', '../x', 7, null]) {
      expect(malo(comprometer({ espacio: e })).status).toBe(400);
    }
  });

  it('idCompromiso malformado o con "/" -> 400', () => {
    for (const i of ['corto', 'a/b/c/d/e/f', 'con espacio!', 'a'.repeat(129), 'x~y~z~w~12', '', 7, null]) {
      expect(malo(comprometer({ idCompromiso: i })).status).toBe(400);
    }
  });

  it('ejecucion malformada -> 400', () => {
    for (const e of ['', 'a/b', 'a b', 'x'.repeat(65), 5, undefined]) {
      expect(malo(comprometer({ ejecucion: e })).status).toBe(400);
    }
  });

  it('versionLeida: entero >= 0, y obligatoria al comprometer', () => {
    for (const v of [-1, 1.5, '0', null, NaN]) expect(malo(comprometer({ versionLeida: v })).status).toBe(400);
    expect(malo(comprometer({ versionLeida: undefined })).status).toBe(400);
  });

  it('venceEnMin: 1..4320 entero', () => {
    for (const v of [0, -1, 4321, 1.5, '60', null]) expect(malo(comprometer({ venceEnMin: v })).status).toBe(400);
    expect(validarSesion(comprometer({ venceEnMin: 1 }), TEL).ok).toBe(true);
    expect(validarSesion(comprometer({ venceEnMin: 4320 }), TEL).ok).toBe(true);
  });

  it('comprometer exige estado y venceEnMin; estado debe ser objeto o null', () => {
    expect(malo(comprometer({ estado: undefined })).status).toBe(400);
    expect(malo(comprometer({ venceEnMin: undefined })).status).toBe(400);
    for (const s of ['texto', 5, [1], true]) expect(malo(comprometer({ estado: s })).status).toBe(400);
    expect(validarSesion(comprometer({ estado: null }), TEL).ok).toBe(true);
  });

  it('idMensaje: solo en leer, 1..256', () => {
    const base = { v: 1, espacio: 'venta', ejecucion: 'ej-1' };
    expect(malo({ ...base, idMensaje: '' }).status).toBe(400);
    expect(malo({ ...base, idMensaje: 'x'.repeat(257) }).status).toBe(400);
    expect(malo({ ...base, idMensaje: 5 }).status).toBe(400);
    expect(validarSesion({ ...base, idMensaje: 'x'.repeat(256) }, TEL).ok).toBe(true);
    expect(malo(comprometer({ idMensaje: 'wamid.X' })).status).toBe(400);
  });

  it('leer no admite compromiso, estado, vencimiento ni cupos', () => {
    const base = { v: 1, espacio: 'venta', ejecucion: 'ej-1' };
    for (const extra of [{ idCompromiso: 'ej-1:turno-1' }, { estado: {} }, { venceEnMin: 5 }, { cupos: [] }]) {
      expect(malo({ ...base, ...extra }).status).toBe(400);
    }
  });

  describe('cupos', () => {
    const cupo = { clave: 'aviso', alcance: 'comercio', periodo: 'dia', cantidad: 1, tope: 10 };
    it('más de 5 -> 400; exactamente 5 distintos pasa', () => {
      const seis = Array.from({ length: 6 }, (_, i) => ({ ...cupo, clave: `c${i}` }));
      expect(malo(comprometer({ cupos: seis })).status).toBe(400);
      expect(validarSesion(comprometer({ cupos: seis.slice(0, 5) }), TEL).ok).toBe(true);
    });
    it('cantidad 1..20, tope 0..1000, enteros', () => {
      for (const cantidad of [0, 21, -1, 1.5, '1']) expect(malo(comprometer({ cupos: [{ ...cupo, cantidad }] })).status).toBe(400);
      for (const tope of [-1, 1001, 2.5, '5', null]) expect(malo(comprometer({ cupos: [{ ...cupo, tope }] })).status).toBe(400);
      expect(validarSesion(comprometer({ cupos: [{ ...cupo, cantidad: 20, tope: 1000 }] }), TEL).ok).toBe(true);
      expect(validarSesion(comprometer({ cupos: [{ ...cupo, tope: 0 }] }), TEL).ok).toBe(true);
    });
    it('clave, alcance y periodo fuera de la lista -> 400', () => {
      for (const clave of ['', 'A', 'a/b', 'a~b', '1a', 'x'.repeat(33), 7]) {
        expect(malo(comprometer({ cupos: [{ ...cupo, clave }] })).status).toBe(400);
      }
      expect(malo(comprometer({ cupos: [{ ...cupo, alcance: 'global' }] })).status).toBe(400);
      expect(malo(comprometer({ cupos: [{ ...cupo, periodo: 'mes' }] })).status).toBe(400);
    });
    it('claves ajenas, no-arreglo y duplicados -> 400', () => {
      expect(malo(comprometer({ cupos: [{ ...cupo, x: 1 }] })).status).toBe(400);
      expect(malo(comprometer({ cupos: {} })).status).toBe(400);
      expect(malo(comprometer({ cupos: [cupo, { ...cupo, cantidad: 2 }] })).status).toBe(400);
      expect(malo(comprometer({ cupos: [null] })).status).toBe(400);
    });
    it('misma clave con otro alcance o período no es duplicado', () => {
      const r = validarSesion(comprometer({ cupos: [cupo, { ...cupo, periodo: 'hora' }, { ...cupo, alcance: 'contacto' }] }), TEL);
      expect(r.ok).toBe(true);
    });
  });

  describe('estado: tamaño y profundidad', () => {
    it('justo en 16 KiB pasa; un byte más -> 413', () => {
      const vacio = Buffer.byteLength(JSON.stringify({ a: '' }), 'utf8');
      const justo = { a: 'x'.repeat(16 * 1024 - vacio) };
      expect(Buffer.byteLength(JSON.stringify(justo), 'utf8')).toBe(16 * 1024);
      expect(validarSesion(comprometer({ estado: justo }), TEL).ok).toBe(true);
      const r = malo(comprometer({ estado: { a: 'x'.repeat(16 * 1024 - vacio + 1) } }));
      expect(r).toMatchObject({ status: 413, error: ERRORES_SESION.grande });
    });
    it('se mide en bytes, no en caracteres', () => {
      // 6000 caracteres de 3 bytes = 18000 bytes
      expect(malo(comprometer({ estado: { a: '€'.repeat(6000) } })).status).toBe(413);
    });
    it('profundidad 20 pasa, 21 -> 400 (y gana sobre el tamaño)', () => {
      const anidar = (n: number) => {
        let o: unknown = 1;
        for (let i = 0; i < n; i++) o = { k: o };
        return o as Record<string, unknown>;
      };
      expect(validarSesion(comprometer({ estado: anidar(20) }), TEL).ok).toBe(true);
      expect(malo(comprometer({ estado: anidar(21) })).status).toBe(400);
      expect(malo(comprometer({ estado: anidar(5000) })).status).toBe(400);
      expect(malo(comprometer({ estado: { a: [[[[[[[[[[[[[[[[[[[[[1]]]]]]]]]]]]]]]]]]]]] } })).status).toBe(400);
    });
  });
});

describe('ids de documento', () => {
  it('formato fijo', () => {
    expect(idSesion('1234', 'venta', TEL)).toBe(`1234~venta~wa_${TEL}`);
    expect(idVisto('1234', 'wamid.X')).toBe(createHash('sha256').update('1234|wamid.X').digest('hex'));
    expect(idCupo('1234', 'aviso', 'comercio', null, '2026-10-18')).toBe('1234~aviso~_~2026-10-18');
    expect(idCupo('1234', 'aviso', 'contacto', TEL, '2026-10-18T09')).toBe(`1234~aviso~wa_${TEL}~2026-10-18T09`);
  });
  it('el visto no depende del id crudo: "/" en idMensaje no llega al id', () => {
    expect(idVisto('1234', 'a/b/c')).toMatch(/^[0-9a-f]{64}$/);
    expect(idVisto('1234', 'a')).not.toBe(idVisto('5678', 'a'));
  });
  it('rechaza "/", "~" y lo que sale de la regex en cada componente', () => {
    for (const p of ['', 'a/b', 'a~b', 'a b']) {
      expect(() => idSesion(p, 'venta', TEL)).toThrow();
      expect(() => idVisto(p, 'x')).toThrow();
      expect(() => idCupo(p, 'aviso', 'comercio', null, '2026-10-18')).toThrow();
    }
    for (const e of ['a/b', 'a~b', 'A', '']) expect(() => idSesion('1234', e, TEL)).toThrow();
    for (const t of ['1', 'a/b', '59170000001/x', null as unknown as string]) {
      expect(() => idSesion('1234', 'venta', t)).toThrow();
    }
    for (const c of ['a/b', 'a~b', 'A']) expect(() => idCupo('1234', c, 'comercio', null, '2026-10-18')).toThrow();
    expect(() => idCupo('1234', 'aviso', 'comercio', null, '2026/10/18')).toThrow();
    expect(() => idCupo('1234', 'aviso', 'contacto', null, '2026-10-18')).toThrow();
    expect(() => idVisto('1234', '')).toThrow();
  });
});

describe('períodos en America/La_Paz (UTC-4 fijo)', () => {
  // Medianoche de La Paz de HOY, calculada: nunca una fecha escrita.
  const hoyLaPaz = Math.floor((Date.now() - 4 * H) / D) * D + 4 * H;

  it('el día corta a las 00:00 de La Paz = 04:00 UTC', () => {
    expect(new Date(hoyLaPaz).getUTCHours()).toBe(4);
    const antes = hoyLaPaz - 1;
    const despues = hoyLaPaz;
    expect(periodoDe(antes, 'dia')).not.toBe(periodoDe(despues, 'dia'));
    expect(periodoDe(despues, 'dia')).toBe(periodoDe(hoyLaPaz + D - 1, 'dia'));
    expect(periodoDe(hoyLaPaz + D, 'dia')).not.toBe(periodoDe(despues, 'dia'));
  });
  it('a las 23:30 de La Paz todavía es el mismo día, aunque en UTC ya sea el siguiente', () => {
    const t = hoyLaPaz + 23.5 * H;
    expect(new Date(t).getUTCDate()).not.toBe(new Date(hoyLaPaz).getUTCDate());
    expect(periodoDe(t, 'dia')).toBe(periodoDe(hoyLaPaz, 'dia'));
  });
  it('la hora corta en punto de La Paz y el id lleva el día y la hora locales', () => {
    expect(periodoDe(hoyLaPaz, 'hora')).toBe(`${periodoDe(hoyLaPaz, 'dia')}T00`);
    expect(periodoDe(hoyLaPaz + 5 * H + 59 * 60_000, 'hora')).toBe(`${periodoDe(hoyLaPaz, 'dia')}T05`);
    expect(periodoDe(hoyLaPaz + 6 * H, 'hora')).toBe(`${periodoDe(hoyLaPaz, 'dia')}T06`);
    expect(periodoDe(hoyLaPaz - 1, 'hora').endsWith('T23')).toBe(true);
  });
  it('el fin del período es el siguiente corte, y es exclusivo', () => {
    const t = hoyLaPaz + 7 * H + 1234;
    expect(finDelPeriodo(t, 'dia')).toBe(hoyLaPaz + D);
    expect(finDelPeriodo(t, 'hora')).toBe(hoyLaPaz + 8 * H);
    expect(finDelPeriodo(hoyLaPaz + 8 * H, 'hora')).toBe(hoyLaPaz + 9 * H);
    expect(finDelPeriodo(hoyLaPaz, 'dia')).toBe(hoyLaPaz + D);
  });
  it('vence = fin del período + 24 h', () => {
    const t = hoyLaPaz + 7 * H;
    expect(venceDeCupo(t, 'dia')).toBe(hoyLaPaz + 2 * D);
    expect(venceDeCupo(t, 'hora')).toBe(hoyLaPaz + 8 * H + D);
  });
  it('un reloj roto lanza, no inventa un período', () => {
    expect(() => periodoDe(NaN, 'dia')).toThrow();
    expect(() => finDelPeriodo(Infinity, 'hora')).toThrow();
  });
});

describe('lectura y vencimiento', () => {
  const ahora = 1_800_000_000_000;
  const doc = (extra: Partial<DocSesion> = {}): DocSesion => ({
    version: 7, estadoJson: '{"paso":"pago"}', vence: ahora + 1000, actualizadoEn: ahora - 5000, compromisos: [], ...extra,
  });

  it('documento ausente -> versión 0 y todo vacío', () => {
    expect(leerConversacion(null, ahora)).toEqual({ version: 0, estado: null, desde: null, vence: null, vencido: false });
  });
  it('vigente devuelve el estado', () => {
    expect(leerConversacion(doc(), ahora)).toEqual({
      version: 7, estado: { paso: 'pago' }, desde: ahora - 5000, vence: ahora + 1000, vencido: false,
    });
  });
  it('vencido -> estado null, vencido true, conserva la versión real (no se borra ni se reinicia)', () => {
    const d = doc({ vence: ahora - 1 });
    const r = leerConversacion(d, ahora);
    expect(r).toMatchObject({ version: 7, estado: null, vencido: true });
    expect(d.estadoJson).toBe('{"paso":"pago"}'); // el documento no se tocó
    expect(leerConversacion(doc({ vence: ahora }), ahora)).toMatchObject({ vencido: true, version: 7 });
  });
  it('un estadoJson corrupto se lee como null sin lanzar ni marcar vencido', () => {
    expect(leerConversacion(doc({ estadoJson: '{no es json' }), ahora)).toMatchObject({ estado: null, vencido: false, version: 7 });
    expect(leerConversacion(doc({ estadoJson: '[1,2]' }), ahora)).toMatchObject({ estado: null });
  });
  it('visto: nuevo si no existe o venció; repetido si sigue vigente', () => {
    expect(decidirVisto(null, ahora)).toBe('nuevo');
    expect(decidirVisto({ vence: ahora + 1 }, ahora)).toBe('repetido');
    expect(decidirVisto({ vence: ahora }, ahora)).toBe('nuevo');
    expect(decidirVisto({ vence: null }, ahora)).toBe('nuevo');
  });
});

describe('decidirCompromiso', () => {
  const ahora = 1_800_000_000_000;
  const PNID = '1234';
  const doc = (extra: Partial<DocSesion> = {}): DocSesion => ({
    version: 3, estadoJson: '{"paso":"viejo"}', vence: ahora + 10 * 60_000, actualizadoEn: ahora - 1000,
    compromisos: ['ant-00000001', 'ant-00000002'], ...extra,
  });
  const entrada = (extra: Partial<EntradaCompromiso> = {}): EntradaCompromiso => ({
    doc: doc(), ahoraMs: ahora, versionLeida: 3, idCompromiso: 'nuevo-0000001', estado: { paso: 'nuevo' },
    venceEnMin: 30, cupos: [], cuposActuales: {}, ...extra,
  });
  const plan = (cupos: Parameters<typeof planDeCupos>[2]) => planDeCupos(PNID, TEL, cupos, ahora);

  it('comprometido: versión+1, estado nuevo, vence, últimos 5 compromisos', () => {
    const r = decidirCompromiso(entrada());
    expect(r.resultado).toBe('comprometido');
    if (r.resultado !== 'comprometido') return;
    expect(r.version).toBe(4);
    expect(r.estadoJson).toBe('{"paso":"nuevo"}');
    expect(r.vence).toBe(ahora + 30 * 60_000);
    expect(r.compromisos).toEqual(['ant-00000001', 'ant-00000002', 'nuevo-0000001']);
    expect(r.conversacion).toEqual({ version: 4, estado: { paso: 'nuevo' }, desde: ahora, vence: ahora + 30 * 60_000, vencido: false });
  });
  it('conserva solo los últimos 5 compromisos', () => {
    const ids = ['a-00000001', 'a-00000002', 'a-00000003', 'a-00000004', 'a-00000005'];
    const r = decidirCompromiso(entrada({ doc: doc({ compromisos: ids }) }));
    if (r.resultado !== 'comprometido') throw new Error('x');
    expect(r.compromisos).toEqual([...ids.slice(1), 'nuevo-0000001']);
  });
  it('documento ausente: se compromete desde la versión 0', () => {
    const r = decidirCompromiso(entrada({ doc: null, versionLeida: 0 }));
    expect(r).toMatchObject({ resultado: 'comprometido', version: 1, compromisos: ['nuevo-0000001'] });
  });
  it('estado null guarda estadoJson null', () => {
    const r = decidirCompromiso(entrada({ estado: null }));
    expect(r).toMatchObject({ resultado: 'comprometido', estadoJson: null });
  });
  it('sobre un estado vencido compromete desde la versión real, no desde 0', () => {
    const d = doc({ vence: ahora - 1 });
    expect(decidirCompromiso(entrada({ doc: d, versionLeida: 0 })).resultado).toBe('conflicto_version');
    expect(decidirCompromiso(entrada({ doc: d, versionLeida: 3 }))).toMatchObject({ resultado: 'comprometido', version: 4 });
  });

  it('repetido: idempotente, devuelve el estado actual y no cambia nada', () => {
    const d = doc();
    const r = decidirCompromiso(entrada({ doc: d, idCompromiso: 'ant-00000002', versionLeida: 1 }));
    expect(r).toEqual({ resultado: 'repetido', conversacion: leerConversacion(d, ahora) });
    expect(r.conversacion.version).toBe(3);
    // y llamarlo dos veces da lo mismo
    expect(decidirCompromiso(entrada({ doc: d, idCompromiso: 'ant-00000002', versionLeida: 1 }))).toEqual(r);
  });
  it('repetido gana sobre el conflicto y sobre los cupos', () => {
    const cupos = plan([{ clave: 'aviso', alcance: 'comercio', periodo: 'dia', cantidad: 1 }]);
    expect(decidirCompromiso(entrada({ idCompromiso: 'ant-00000001', versionLeida: 99, cupos })).resultado).toBe('repetido');
  });

  it('conflicto_version: devuelve el estado ganador y nada que escribir', () => {
    const d = doc();
    for (const v of [0, 2, 4, 99]) {
      const r = decidirCompromiso(entrada({ doc: d, versionLeida: v }));
      expect(r).toEqual({ resultado: 'conflicto_version', conversacion: { version: 3, estado: { paso: 'viejo' }, desde: ahora - 1000, vence: d.vence, vencido: false } });
      expect(r).not.toHaveProperty('version');
      expect(r).not.toHaveProperty('cupos');
    }
  });
  it('conflicto con documento ausente (otro ya lo creó es el caso inverso: ausente + versionLeida>0)', () => {
    expect(decidirCompromiso(entrada({ doc: null, versionLeida: 2 })).resultado).toBe('conflicto_version');
  });

  describe('cupos', () => {
    const pedido = { clave: 'aviso', alcance: 'contacto' as const, periodo: 'hora' as const, cantidad: 1 };
    it('tope ausente -> sin_tope, versión intacta', () => {
      const r = decidirCompromiso(entrada({ cupos: plan([pedido]) }));
      expect(r).toMatchObject({ resultado: 'cupo_negado', motivo: 'sin_tope', clave: 'aviso', conversacion: { version: 3 } });
      expect(r).not.toHaveProperty('cupos');
    });
    it('tope 0 -> sin_tope', () => {
      expect(decidirCompromiso(entrada({ cupos: plan([{ ...pedido, tope: 0 }]) }))).toMatchObject({ motivo: 'sin_tope' });
    });
    it('agotado: usados + cantidad > tope, versión intacta', () => {
      const cupos = plan([{ ...pedido, tope: 3 }]);
      const r = decidirCompromiso(entrada({ cupos, cuposActuales: { [cupos[0].id]: { usados: 3, vence: ahora + D } } }));
      expect(r).toMatchObject({ resultado: 'cupo_negado', motivo: 'agotado', clave: 'aviso', conversacion: { version: 3 } });
      expect(r).not.toHaveProperty('version');
    });
    it('en tope-1 concede uno; con cantidad 2 en tope-1 lo niega', () => {
      const cupos = plan([{ ...pedido, tope: 3 }]);
      const act = { [cupos[0].id]: { usados: 2, vence: ahora + D } };
      const ok = decidirCompromiso(entrada({ cupos, cuposActuales: act }));
      expect(ok).toMatchObject({ resultado: 'comprometido', cupos: [{ usados: 3, tope: 3 }] });
      const dos = plan([{ ...pedido, tope: 3, cantidad: 2 }]);
      expect(decidirCompromiso(entrada({ cupos: dos, cuposActuales: { [dos[0].id]: { usados: 2, vence: ahora + D } } })))
        .toMatchObject({ motivo: 'agotado' });
    });
    it('incrementa, registra por[idCompromiso] y fija tope y vence', () => {
      const cupos = plan([{ ...pedido, tope: 10, cantidad: 4 }]);
      const r = decidirCompromiso(entrada({
        cupos, cuposActuales: { [cupos[0].id]: { usados: 2, vence: ahora + D, por: { previo: 2 } } },
      }));
      if (r.resultado !== 'comprometido') throw new Error('x');
      expect(r.cupos).toEqual([{
        id: cupos[0].id, usados: 6, tope: 10, vence: venceDeCupo(ahora, 'hora'), por: { previo: 2, 'nuevo-0000001': 4 },
      }]);
    });
    it('un cupo vencido que el TTL aún no borró cuenta como vacío', () => {
      const cupos = plan([{ ...pedido, tope: 1 }]);
      const r = decidirCompromiso(entrada({ cupos, cuposActuales: { [cupos[0].id]: { usados: 1, vence: ahora - 1 } } }));
      expect(r).toMatchObject({ resultado: 'comprometido', cupos: [{ usados: 1 }] });
    });
    it('si un cupo falla no se concede ninguno (todo o nada) y se nombra el que falló', () => {
      const cupos = plan([
        { ...pedido, clave: 'bueno', tope: 5 },
        { ...pedido, clave: 'malo', tope: 1 },
      ]);
      const r = decidirCompromiso(entrada({ cupos, cuposActuales: { [cupos[1].id]: { usados: 1, vence: ahora + D } } }));
      expect(r).toMatchObject({ resultado: 'cupo_negado', motivo: 'agotado', clave: 'malo' });
      expect(r).not.toHaveProperty('cupos');
    });
    it('`por` conserva solo las 50 entradas más recientes', () => {
      const cupos = plan([{ ...pedido, tope: 1000 }]);
      const por: Record<string, number> = {};
      for (let i = 0; i < 50; i++) por[`viejo-${String(i).padStart(3, '0')}`] = 1;
      const r = decidirCompromiso(entrada({ cupos, cuposActuales: { [cupos[0].id]: { usados: 50, vence: ahora + D, por } } }));
      if (r.resultado !== 'comprometido') throw new Error('x');
      const claves = Object.keys(r.cupos[0].por);
      expect(claves).toHaveLength(50);
      expect(claves).not.toContain('viejo-000');
      expect(claves).toContain('nuevo-0000001');
    });
    it('planDeCupos: el cupo de comercio no depende del teléfono; el de contacto sí', () => {
      const a = planDeCupos(PNID, '59170000001', [{ clave: 'aviso', alcance: 'comercio', periodo: 'dia', cantidad: 1 }], ahora);
      const b = planDeCupos(PNID, '59170000002', [{ clave: 'aviso', alcance: 'comercio', periodo: 'dia', cantidad: 1 }], ahora);
      expect(a[0].id).toBe(b[0].id);
      const c1 = planDeCupos(PNID, '59170000001', [pedido], ahora);
      const c2 = planDeCupos(PNID, '59170000002', [pedido], ahora);
      expect(c1[0].id).not.toBe(c2[0].id);
    });
  });

  it('no muta sus entradas', () => {
    const d = doc();
    const copia = JSON.stringify(d);
    decidirCompromiso(entrada({ doc: d }));
    decidirCompromiso(entrada({ doc: d, versionLeida: 0 }));
    expect(JSON.stringify(d)).toBe(copia);
  });
});

describe('pureza del archivo', () => {
  // Se quitan los comentarios: lo que se niega es el CÓDIGO.
  const codigo = FUENTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('no lee el reloj ni el entorno por su cuenta', () => {
    expect(codigo).not.toMatch(/Date\.now\s*\(/);
    expect(codigo).not.toMatch(/new Date\s*\(\s*\)/);
    expect(codigo).not.toMatch(/process\.env/);
    expect(codigo).not.toMatch(/Math\.random/);
  });
  it('solo importa node:crypto', () => {
    const imports = [...codigo.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    expect(imports).toEqual(['node:crypto']);
  });
});
