/**
 * C4: los contadores de cobro en la consola. Se prueba negando: sin contadores
 * de la regla nueva no hay línea, y la pantalla no dice nunca que un pago está
 * acreditado ni lee imágenes ni datos personales del comprobante.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  COLUMNAS, cobroRealActivo, decidirPintado, estadoDeError, leerContadores, lineasDeCobros, mesLegible,
  ultimosMesesDeCobro, type EstadoLectura,
} from '../../../web/src/modulos/cobros/contadoresDeCobro.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const carpeta = join(aqui, '../../../web/src/modulos/cobros');

describe('lineasDeCobros', () => {
  it('sin ningún contador de la regla nueva no hay líneas (regla vieja: sin cambios)', () => {
    expect(lineasDeCobros([])).toEqual([]);
    expect(lineasDeCobros([
      { id: '2026-09', mensajes: 40, cobrosCotejados: 3, cobrosVencidos: 1, senasEnviadas: 2 },
    ])).toEqual([]);
  });

  it('un mes con datos da una línea y suma aproximados + en revisión como por confirmar', () => {
    const l = lineasDeCobros([
      { id: '2026-09', cobrosQrEnviados: 10, cobrosValidos: 4, cobrosAproximados: 2, cobrosEnRevision: 1, cobrosInvalidos: 2, cobrosTardios: 1 },
      { id: '2026-10', cobrosQrEnviados: 3 },
      { id: '2026-08', mensajes: 9 },
    ]);
    expect(l.map((x) => x.periodo)).toEqual(['2026-10', '2026-09']);
    expect(l[1]).toMatchObject({ qrEnviados: 10, validos: 4, porConfirmar: 3, invalidos: 2, tardios: 1, cancelados: 0 });
  });

  it('valores raros no rompen: negativos, texto y NaN cuentan como 0', () => {
    const l = lineasDeCobros([{ id: '2026-10', cobrosValidos: -2, cobrosQrEnviados: 'x', cobrosTardios: Number.NaN, cobrosCancelados: 2.9 }]);
    expect(l[0]).toMatchObject({ validos: 0, qrEnviados: 0, tardios: 0, cancelados: 2 });
  });

  it('ultimosMesesDeCobro cruza el cambio de año', () => {
    expect(ultimosMesesDeCobro(3, new Date(Date.UTC(2027, 0, 15)))).toEqual(['2027-01', '2026-12', '2026-11']);
  });
});

describe('la pantalla de contadores', () => {
  const fuente = readFileSync(join(carpeta, 'ContadoresDeCobro.tsx'), 'utf8')
    + readFileSync(join(carpeta, 'contadoresDeCobro.ts'), 'utf8');
  const texto = fuente.replace(/\/\*[\s\S]*?\*\//g, '');

  it('nunca presenta un pago como acreditado, verificado o recibido (prohibición 3)', () => {
    expect(texto).not.toMatch(/acreditad|verificad|recibimos tu pago/i);
  });

  it('solo cuenta: no lee imágenes, rutas ni datos personales', () => {
    expect(texto).not.toMatch(/storage|getDownloadURL|<img|telefono|cierres|ruta|montoLeido/i);
    expect(texto).toMatch(/collection\(db, 'tenants', tenantId, 'metricas'\)/);
    expect(texto).not.toMatch(/setDoc|updateDoc|addDoc|deleteDoc/);
  });

  it('avisa que aproximado y en revisión los confirma una persona del negocio', () => {
    expect(texto).toMatch(/aproximados.*en revisión.*confirma una persona/s);
  });

  it('Cobros.tsx monta el componente', () => {
    expect(readFileSync(join(carpeta, 'Cobros.tsx'), 'utf8')).toContain('<ContadoresDeCobro tenantId={tenantId} />');
  });

  it('devuelve null cuando no hay líneas y avisa si la lectura falla', () => {
    expect(texto).toMatch(/pintado === 'nada'\) return null/);
    expect(texto).toMatch(/pintado === 'error'\) return <p role="alert"/);
    expect(texto).toMatch(/role="alert"/);
    expect(texto).toMatch(/overflowX: 'auto'/);
  });
});

describe('columnas y meses', () => {
  const l = lineasDeCobros([{ id: '2026-10', cobrosQrEnviados: 1, cobrosValidos: 2, cobrosAproximados: 3,
    cobrosEnRevision: 4, cobrosInvalidos: 5, cobrosCancelados: 6, cobrosVencidos: 7, cobrosTardios: 8 }])[0]!;

  it('cada cabecera lleva su dato', () => {
    const por = Object.fromEntries(COLUMNAS.map((c) => [c.titulo, c.valor(l)]));
    expect(por).toEqual({
      'QR enviados': 1, 'Datos coinciden': 2, 'Aproximados': 3, 'Pasaron a revisión': 4,
      'Comprobantes que no coinciden': 5, 'Cancelados': 6, 'Vencidos': 7, 'Tardíos': 8,
    });
  });

  it('un mes con solo en revisión, o solo cancelados, cuenta', () => {
    expect(lineasDeCobros([{ id: '2026-10', cobrosEnRevision: 1 }])[0]).toMatchObject({ enRevision: 1, porConfirmar: 1 });
    expect(lineasDeCobros([{ id: '2026-09', cobrosCancelados: 2 }])).toHaveLength(1);
  });

  it('Infinity no entra a la suma', () => {
    expect(lineasDeCobros([{ id: '2026-10', cobrosAproximados: Infinity, cobrosEnRevision: 1 }])[0]!.porConfirmar).toBe(1);
  });

  it('el mes se lee legible', () => {
    expect(mesLegible('2026-10')).toBe('octubre 2026');
    expect(mesLegible('raro')).toBe('raro');
  });
});

describe('solo con cobro real (prohibición 3)', () => {
  it('encendido y con ficha y código: sí; apagado, ausente o ilegible: no', () => {
    expect(cobroRealActivo({ cobroReal: { activo: true, ficha: 'f', cargaUtil: 'c' } })).toBe(true);
    expect(cobroRealActivo({ cobroReal: { activo: false, ficha: 'f', cargaUtil: 'c' } })).toBe(false);
    expect(cobroRealActivo({ cobroReal: { activo: true, ficha: '', cargaUtil: 'c' } })).toBe(false);
    expect(cobroRealActivo({ cobroReal: { activo: 'true', ficha: 'f', cargaUtil: 'c' } })).toBe(false);
    expect(cobroRealActivo({})).toBe(false);
    expect(cobroRealActivo(undefined)).toBe(false);
    expect(cobroRealActivo('raro')).toBe(false);
  });

  it('la pantalla lee config/venta, usa lectura única y dice «simulado» si no es real', () => {
    const f = readFileSync(join(carpeta, 'ContadoresDeCobro.tsx'), 'utf8');
    expect(f).toMatch(/'config', 'venta'/);
    expect(f).toMatch(/Cobro simulado: los comprobantes no se cotejan/);
    expect(f).not.toMatch(/onSnapshot/);
    expect(f).toMatch(/Este mes hubo/);
  });
});

describe('dos lecturas independientes: metricas y config/venta', () => {
  const ok: EstadoLectura = 'ok';
  const denegada: EstadoLectura = 'denegada';
  const error: EstadoLectura = 'error';

  describe('decidirPintado', () => {
    it('ambas ok con cobro real: tabla', () => {
      expect(decidirPintado(ok, ok, true, true)).toBe('tabla');
    });
    it('ambas ok con cobro no real: «cobro simulado»', () => {
      expect(decidirPintado(ok, ok, false, true)).toBe('simulado');
    });
    it('metricas ok y config denegada: tabla, SIN afirmar que es simulado (real desconocido no es real = false)', () => {
      expect(decidirPintado(ok, denegada, false, true)).toBe('tabla');
      expect(decidirPintado(ok, denegada, true, true)).toBe('tabla');
      expect(decidirPintado(ok, error, false, true)).toBe('tabla');
    });
    it('metricas falla (denegada o error): mensaje de error, con cualquier config', () => {
      for (const m of [denegada, error]) {
        for (const c of [ok, denegada, error]) {
          expect(decidirPintado(m, c, true, true)).toBe('error');
          expect(decidirPintado(m, c, false, false)).toBe('error');
        }
      }
    });
    it('sin líneas de la regla nueva: nada, con cualquier config', () => {
      for (const c of [ok, denegada, error]) {
        expect(decidirPintado(ok, c, true, false)).toBe('nada');
        expect(decidirPintado(ok, c, false, false)).toBe('nada');
      }
    });
  });

  describe('estadoDeError', () => {
    it('permission-denied es denegada; lo demás, error', () => {
      expect(estadoDeError({ code: 'permission-denied' })).toBe('denegada');
      expect(estadoDeError({ code: 'unavailable' })).toBe('error');
      expect(estadoDeError(new Error('x'))).toBe('error');
      expect(estadoDeError(undefined)).toBe('error');
      expect(estadoDeError(null)).toBe('error');
    });
  });

  describe('leerContadores (las dos lecturas no se tumban entre sí)', () => {
    const periodos = [{ id: '2026-10', cobrosQrEnviados: 2 }];
    const venta = { cobroReal: { activo: true, ficha: 'f', cargaUtil: 'c' } };
    const denegar = () => Promise.reject(Object.assign(new Error('x'), { code: 'permission-denied' }));
    const caer = () => Promise.reject(new Error('red'));

    it('ambas ok con cobro real', async () => {
      const l = await leerContadores(() => Promise.resolve(periodos), () => Promise.resolve(venta));
      expect(l).toEqual({ metricas: 'ok', config: 'ok', periodos, real: true });
      expect(decidirPintado(l.metricas, l.config, l.real, lineasDeCobros(l.periodos).length > 0)).toBe('tabla');
    });

    it('ambas ok con cobro no real (documento ausente incluido): simulado', async () => {
      for (const v of [{ cobroReal: { activo: false } }, undefined]) {
        const l = await leerContadores(() => Promise.resolve(periodos), () => Promise.resolve(v));
        expect(l).toMatchObject({ metricas: 'ok', config: 'ok', real: false });
        expect(decidirPintado(l.metricas, l.config, l.real, true)).toBe('simulado');
      }
    });

    it('config/venta denegada (propietario de NovuChat): los contadores se leen y no se dice «simulado»', async () => {
      const l = await leerContadores(() => Promise.resolve(periodos), denegar);
      expect(l).toMatchObject({ metricas: 'ok', config: 'denegada', periodos });
      expect(decidirPintado(l.metricas, l.config, l.real, lineasDeCobros(l.periodos).length > 0)).toBe('tabla');
    });

    it('config/venta con otro fallo: lo mismo', async () => {
      const l = await leerContadores(() => Promise.resolve(periodos), caer);
      expect(l).toMatchObject({ metricas: 'ok', config: 'error', periodos });
      expect(decidirPintado(l.metricas, l.config, l.real, true)).toBe('tabla');
    });

    it('metricas falla con config ok: error, no se traga', async () => {
      const l = await leerContadores(caer, () => Promise.resolve(venta));
      expect(l).toMatchObject({ metricas: 'error', config: 'ok', periodos: [] });
      expect(decidirPintado(l.metricas, l.config, l.real, false)).toBe('error');
      const d = await leerContadores(denegar, () => Promise.resolve(venta));
      expect(d.metricas).toBe('denegada');
      expect(decidirPintado(d.metricas, d.config, d.real, false)).toBe('error');
    });

    it('ambas fallan: error', async () => {
      const l = await leerContadores(caer, denegar);
      expect(l).toMatchObject({ metricas: 'error', config: 'denegada', periodos: [] });
      expect(decidirPintado(l.metricas, l.config, l.real, false)).toBe('error');
    });

    it('un lector que lanza en seco (no devuelve promesa rechazada) tampoco tumba al otro', async () => {
      const seco = () => { throw Object.assign(new Error('x'), { code: 'permission-denied' }); };
      const l = await leerContadores(() => Promise.resolve(periodos), seco);
      expect(l).toMatchObject({ metricas: 'ok', config: 'denegada' });
    });

    it('sin líneas: nada', async () => {
      const l = await leerContadores(() => Promise.resolve([{ id: '2026-10', mensajes: 4 }]), () => Promise.resolve(venta));
      expect(decidirPintado(l.metricas, l.config, l.real, lineasDeCobros(l.periodos).length > 0)).toBe('nada');
    });
  });

  describe('guarda de fuente', () => {
    const tsx = readFileSync(join(carpeta, 'ContadoresDeCobro.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    it('config/venta ya NO va en el mismo Promise.all (ni allSettled/race) que metricas', () => {
      const juntas = tsx.match(/Promise\s*\.\s*(?:all|allSettled|race|any)\s*\(\s*\[[\s\S]*?\]\s*\)/g) ?? [];
      for (const j of juntas) {
        expect(/metricas/.test(j) && /venta/.test(j), `lecturas juntas: ${j.slice(0, 80)}`).toBe(false);
      }
      expect(tsx).not.toMatch(/Promise\s*\.\s*all/);
    });

    it('la pantalla delega las lecturas en leerContadores y la decisión en decidirPintado', () => {
      expect(tsx).toMatch(/leerContadores\(/);
      expect(tsx).toMatch(/decidirPintado\(/);
      expect(tsx).toMatch(/'config', 'venta'/);
    });

    it('cada lector de leerContadores tiene su propio try/catch (el código puro no usa Promise.all)', () => {
      const puro = readFileSync(join(carpeta, 'contadoresDeCobro.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(puro).not.toMatch(/Promise\s*\.\s*(?:all|allSettled|race|any)/);
      const cuerpo = puro.slice(puro.indexOf('export async function leerContadores'));
      expect((cuerpo.match(/\btry\s*\{/g) ?? []).length).toBeGreaterThanOrEqual(2);
      expect((cuerpo.match(/\bcatch\s*\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });

    it('«Cobro simulado» solo se pinta desde el caso «simulado» de la decisión', () => {
      expect(tsx).toMatch(/pintado === 'simulado'\)\s*\{\s*return <p className="ayuda">Cobro simulado/);
      expect(tsx.match(/Cobro simulado/g)).toHaveLength(1);
    });
  });
});
