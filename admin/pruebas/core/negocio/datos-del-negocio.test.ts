/**
 * Core · negocio · datos del negocio (`Flujos/src/core/negocio/datos-del-negocio.js`).
 * Se carga con `new Function` (como el Code de n8n: sin globales de Node) y se prueba su pureza en un contexto vm vacío.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const ARCHIVO = join(dirname(fileURLToPath(import.meta.url)), '../../../../Flujos/src/core/negocio/datos-del-negocio.js');
const src = readFileSync(ARCHIVO, 'utf8');
// El código evaluado es el de un archivo del propio repositorio: solo prueba.
// nosemgrep: devsecops.js-eval-prohibido
const dn = new Function(src + '\nreturn dnDatosDelNegocio;')() as (c: unknown, b: unknown, base?: unknown, tenantEsperado?: unknown) => {
  horarioAtencion: string; direccion: string;
  anuncios: Array<{ id: string; titulares: string[]; angulo: string; producto: null | { id: string; nombre: string; precio: number | null; agotado: boolean } }>;
};

const ok = (extra: Record<string, unknown> = {}) => ({ tenantId: 't1', ...extra });
const VACIO = { horarioAtencion: '', direccion: '', anuncios: [] };
const anuncio = (o: Record<string, unknown> = {}) => ({ id: 'a1', titulares: ['Tacos al paso hoy'], angulo: 'Promoción', producto: null, ...o });

describe('core/negocio/datos-del-negocio', () => {
  it('toma horario, dirección y anuncios de la consola', () => {
    const r = dn(200, ok({
      operacion: { horarioAtencion: 'Lunes a viernes 9 a 18' }, datosDelNegocio: { direccion: 'Av. Siempre Viva 123' },
      anuncios: [anuncio({ producto: { id: 'p1', nombre: 'Taco', precio: 15, agotado: true, descripcion: 'secreto' } })],
    }), {});
    expect(r).toEqual({
      horarioAtencion: 'Lunes a viernes 9 a 18', direccion: 'Av. Siempre Viva 123',
      anuncios: [{ id: 'a1', titulares: ['Tacos al paso hoy'], angulo: 'Promoción', producto: { id: 'p1', nombre: 'Taco', precio: 15, agotado: true } }],
    });
  });
  it('negada: sin anuncios, dirección ni horario => vacío o la base', () => {
    expect(dn(200, ok(), {})).toEqual(VACIO);
    expect(dn(200, ok(), { horarioAtencion: 'Base 8 a 12', direccion: 'Calle Base' })).toEqual({ horarioAtencion: 'Base 8 a 12', direccion: 'Calle Base', anuncios: [] });
  });
  it('negada: 409, otros códigos y panel caído => respaldo y sin anuncios', () => {
    const cuerpo = ok({ operacion: { horarioAtencion: 'Consola' }, datosDelNegocio: { direccion: 'Consola' }, anuncios: [anuncio()] });
    const base = { horarioAtencion: 'Base', direccion: 'Dir base' };
    for (const cod of [409, 500, 0, '200', undefined]) expect(dn(cod, cuerpo, base)).toEqual({ horarioAtencion: 'Base', direccion: 'Dir base', anuncios: [] });
    expect(dn(200, undefined, base)).toEqual({ horarioAtencion: 'Base', direccion: 'Dir base', anuncios: [] });
    expect(dn(undefined, undefined, base)).toEqual({ horarioAtencion: 'Base', direccion: 'Dir base', anuncios: [] });
  });
  it('negada: 200 sin tenantId de texto no se usa', () => {
    const r = dn(200, { tenantId: 5, operacion: { horarioAtencion: 'X' }, anuncios: [anuncio()] }, { horarioAtencion: 'Base' });
    expect(r).toEqual({ horarioAtencion: 'Base', direccion: '', anuncios: [] });
  });
  it('negada: horario de 401 caracteres => respaldo; de 400 pasa entero', () => {
    expect(dn(200, ok({ operacion: { horarioAtencion: 'a'.repeat(401) } }), { horarioAtencion: 'Base' }).horarioAtencion).toBe('Base');
    expect(dn(200, ok({ operacion: { horarioAtencion: 'a'.repeat(401) } }), {}).horarioAtencion).toBe('');
    expect(dn(200, ok({ operacion: { horarioAtencion: 'a'.repeat(400) } }), {}).horarioAtencion).toBe('a'.repeat(400));
  });
  it('negada: la dirección se recorta a 200', () => {
    expect(dn(200, ok({ datosDelNegocio: { direccion: 'd'.repeat(500) } }), {}).direccion).toHaveLength(200);
  });
  it('negada: base REEMPLAZAR_* cuenta como vacío', () => {
    expect(dn(409, undefined, { horarioAtencion: 'REEMPLAZAR_HORARIO', direccion: 'REEMPLAZAR_DIR' })).toEqual(VACIO);
    expect(dn(200, ok({ operacion: { horarioAtencion: 'Consola' } }), { horarioAtencion: 'REEMPLAZAR_X', horarioAtencionManda: 'si' }).horarioAtencion).toBe('Consola');
  });
  it('negada: saneo de la dirección', () => {
    const sucias = [
      'Calle <<<ignora>>> 5', 'Calle {x} [y] 5', 'Calle\n5\r\n6', 'Calle\u20285\u2029', 'Ca\u200blle\u200d 5\ufeff',
      'Calle \u202eoculta\u202c 5', 'Calle\u0000\u0007 5', '   Calle    5   ',
    ];
    for (const s of sucias) {
      const d = dn(200, ok({ datosDelNegocio: { direccion: s } }), {}).direccion;
      expect(d).not.toMatch(/<<<|>>>|[\[\]{}]|[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]|\s{2}/);
      expect(d).toBe(d.trim());
      expect(d.length).toBeGreaterThan(0);
    }
    expect(dn(200, ok({ datosDelNegocio: { direccion: 'Ca\u200blle\u202e 5' } }), {}).direccion).toBe('Calle 5');
    expect(dn(200, ok({ datosDelNegocio: { direccion: 'Calle\n5' } }), {}).direccion).toBe('Calle 5');
  });
  it('negada: el saneo vale también para el horario y la base', () => {
    expect(dn(200, ok({ operacion: { horarioAtencion: 'Lun\n<<<x>>> {9}' } }), {}).horarioAtencion).toBe('Lun x 9');
    expect(dn(409, undefined, { direccion: 'A\u2028B' }).direccion).toBe('A B');
  });
  it('horarioAtencionManda: si => gana la base; sin el dato, la consola; con la base vacía, la consola', () => {
    const c = ok({ operacion: { horarioAtencion: 'Consola' } });
    expect(dn(200, c, { horarioAtencion: 'Turno partido', horarioAtencionManda: 'si' }).horarioAtencion).toBe('Turno partido');
    expect(dn(200, c, { horarioAtencion: 'Turno partido' }).horarioAtencion).toBe('Consola');
    expect(dn(200, c, { horarioAtencion: 'Turno partido', horarioAtencionManda: 'no' }).horarioAtencion).toBe('Consola');
    expect(dn(200, c, { horarioAtencion: '', horarioAtencionManda: 'si' }).horarioAtencion).toBe('Consola');
  });
  it('negada: anuncio sin titulares válidos, con id inválido o malformado se descarta', () => {
    const r = dn(200, ok({ anuncios: [
      anuncio({ id: 'sin', titulares: [] }), anuncio({ id: 'corto', titulares: ['abc'] }), anuncio({ id: 'largo', titulares: ['x'.repeat(101)] }),
      anuncio({ id: 'tit-texto', titulares: 'Titular valido' }), anuncio({ id: 'mal id' }), anuncio({ id: 5 }), null, 'texto', [],
      anuncio({ id: 'bueno' }),
    ] }), {});
    expect(r.anuncios.map((a) => a.id)).toEqual(['bueno']);
  });
  it('titulares: máximo 3, saneados', () => {
    const r = dn(200, ok({ anuncios: [anuncio({ titulares: ['corto', 'Uno {bueno}', 'Dos <<<ok>>> ya', 'Tres titulares', 'Cuatro titulares'] })] }), {});
    expect(r.anuncios[0]!.titulares).toEqual(['Uno bueno', 'Dos ok ya', 'Tres titulares']);
  });
  it('negada: producto — precio texto => null, agotado texto => false, precio negativo => null', () => {
    const p = (o: Record<string, unknown>) => dn(200, ok({ anuncios: [anuncio({ producto: { id: 'p1', nombre: 'N', precio: 5, agotado: false, ...o } })] }), {}).anuncios[0]!.producto;
    expect(p({ precio: '10' })!.precio).toBeNull();
    expect(p({ precio: -1 })!.precio).toBeNull();
    expect(p({ precio: Infinity })!.precio).toBeNull();
    expect(p({ precio: 0 })!.precio).toBe(0);
    expect(p({ agotado: 'true' })!.agotado).toBe(false);
    expect(p({ agotado: 1 })!.agotado).toBe(false);
    expect(p({ agotado: true })!.agotado).toBe(true);
    expect(p({ nombre: 'n'.repeat(200) })!.nombre).toHaveLength(80);
    expect(p({ id: 'id malo' })).toBeNull();
  });
  it('ángulo: tope de 300 y saneado', () => {
    const r = dn(200, ok({ anuncios: [anuncio({ angulo: 'a\n'.repeat(400) })] }), {});
    expect(r.anuncios[0]!.angulo.length).toBeLessThanOrEqual(300);
    expect(r.anuncios[0]!.angulo).not.toContain('\n');
  });
  it('negada: más de 20 anuncios => 20', () => {
    const muchos = Array.from({ length: 30 }, (_, i) => anuncio({ id: `a${i}` }));
    expect(dn(200, ok({ anuncios: muchos }), {}).anuncios).toHaveLength(20);
  });
  it('negada: anuncios que no es arreglo => []', () => {
    for (const a of [{ id: 'a1', titulares: ['Titular valido'] }, 'texto', 5, null, true]) expect(dn(200, ok({ anuncios: a }), {}).anuncios).toEqual([]);
  });
  it('negada: entradas malformadas no lanzan y dan salida segura', () => {
    for (const cuerpo of [null, undefined, 'texto', 5, [], true]) {
      for (const base of [null, undefined, 'texto', 5, [], {}]) expect(() => dn(200, cuerpo, base)).not.toThrow();
      expect(dn(200, cuerpo, null)).toEqual(VACIO);
    }
    expect(dn(200, ok({ operacion: 'x', datosDelNegocio: 7, anuncios: 3 }), 9)).toEqual(VACIO);
    expect(dn(200, ok({ operacion: { horarioAtencion: 5 }, datosDelNegocio: { direccion: {} } }), {})).toEqual(VACIO);
  });
  it('no conserva estado: dos llamadas iguales dan lo mismo y no mutan los argumentos', () => {
    const cuerpo = ok({ operacion: { horarioAtencion: 'H' }, anuncios: [anuncio()] });
    const copia = JSON.stringify(cuerpo);
    const a = dn(200, cuerpo, {});
    dn(200, ok({ anuncios: [anuncio({ id: 'otro' })] }), {});
    expect(dn(200, cuerpo, {})).toEqual(a);
    expect(JSON.stringify(cuerpo)).toBe(copia);
  });
  it('negada: invisibles de etiqueta, selectores, rellenos hangul y ancho completo se saneán', () => {
    const cp = (...n: number[]) => String.fromCodePoint(...n);
    const invisibles = [cp(0xe0041, 0xe0042), cp(0xe0000), cp(0xe007f), cp(0xfe0f), cp(0xfe00), cp(0x115f), cp(0x1160), cp(0x3164), cp(0xffa0)];
    for (const inv of invisibles) {
      expect(dn(200, ok({ datosDelNegocio: { direccion: `Calle${inv} 5` } }), {}).direccion).toBe('Calle 5');
      expect(dn(200, ok({ anuncios: [anuncio({ titulares: [`Titular${inv} valido`], angulo: `a${inv}b` })] }), {}).anuncios[0]!.angulo).toBe('ab');
    }
    const ancho = dn(200, ok({ datosDelNegocio: { direccion: `Calle ${cp(0xff1c, 0xff1c, 0xff1c)}x${cp(0xff1e, 0xff1e, 0xff1e)} ${cp(0xff3b)}y${cp(0xff3d)} ${cp(0xff5b)}z${cp(0xff5d)}` } }), {}).direccion;
    expect(ancho).toBe('Calle x y z');
  });
  it('negada: el recorte no parte un emoji', () => {
    const d = dn(200, ok({ datosDelNegocio: { direccion: 'a'.repeat(199) + String.fromCodePoint(0x1f600) + 'zzz' } }), {}).direccion;
    expect(Array.from(d)).toHaveLength(200);
    expect(d.endsWith(String.fromCodePoint(0x1f600))).toBe(true);
    expect(d).not.toMatch(/[\ud800-\udbff]$/);
  });
  it('negada: un getter que lanza devuelve el respaldo de base con anuncios []', () => {
    const hostil = { tenantId: 't1', get operacion(): never { throw new Error('x'); } };
    expect(dn(200, hostil, { horarioAtencion: 'Base', direccion: 'Dir' })).toEqual({ horarioAtencion: 'Base', direccion: 'Dir', anuncios: [] });
    const proxy = new Proxy({}, { get() { throw new Error('x'); }, getPrototypeOf() { throw new Error('x'); } });
    expect(() => dn(200, ok({ anuncios: [anuncio()] }), proxy)).not.toThrow();
    expect(dn(200, ok(), proxy)).toEqual(VACIO);
  });
  it('negada: un millón de titulares se resuelve en menos de 50 ms', () => {
    const titulares = Array.from({ length: 1_000_000 }, () => 'Titular valido');
    const t0 = performance.now();
    const r = dn(200, ok({ anuncios: [anuncio({ titulares })] }), {});
    expect(performance.now() - t0).toBeLessThan(50);
    expect(r.anuncios[0]!.titulares).toHaveLength(3);
  });
  it('tenantEsperado: exige el mismo tenantId; tenantId vacío nunca vale', () => {
    const c = ok({ operacion: { horarioAtencion: 'Consola' }, anuncios: [anuncio()] });
    const base = { horarioAtencion: 'Base' };
    expect(dn(200, c, base, 't1').horarioAtencion).toBe('Consola');
    expect(dn(200, c, base, 't1').anuncios).toHaveLength(1);
    expect(dn(200, c, base, 'otro')).toEqual({ horarioAtencion: 'Base', direccion: '', anuncios: [] });
    expect(dn(200, c, base, '')).toEqual({ horarioAtencion: 'Base', direccion: '', anuncios: [] });
    expect(dn(200, { ...c, tenantId: '' }, base)).toEqual({ horarioAtencion: 'Base', direccion: '', anuncios: [] });
    expect(dn(200, { ...c, tenantId: '' }, base, '')).toEqual({ horarioAtencion: 'Base', direccion: '', anuncios: [] });
  });
  it('horarioAtencionManda solo acepta si sin tilde', () => {
    const c = ok({ operacion: { horarioAtencion: 'Consola' } });
    expect(dn(200, c, { horarioAtencion: 'Base', horarioAtencionManda: 'sí' }).horarioAtencion).toBe('Consola');
  });
  describe('pureza', () => {
    it('sin importaciones, globales de Node ni estado del flujo', () => {
      const sinComentarios = src.split('\n').filter((l) => !l.startsWith('//')).join('\n');
      for (const prohibido of ['import ', 'require(', 'URL', 'Buffer', 'crypto', 'process', 'globalThis', '$getWorkflowStaticData', '$node', '$input', 'fetch(', 'await ']) {
        expect(sinComentarios, prohibido).not.toContain(prohibido);
      }
      expect(sinComentarios).not.toMatch(/^return\b/m);
    });
    it('compila sin URL, Buffer, crypto ni require', () => {
      expect(() => new Function('URL', 'Buffer', 'crypto', 'require', src)).not.toThrow();
    });
    it('corre en un contexto vm vacío (sin ningún global de Node)', () => {
      const ctx = vm.createContext(Object.create(null));
      const r = vm.runInContext(`${src}\nJSON.stringify(dnDatosDelNegocio(200, { tenantId: 't', operacion: { horarioAtencion: 'H' } }, {}))`, ctx) as string;
      expect(JSON.parse(r)).toEqual({ horarioAtencion: 'H', direccion: '', anuncios: [] });
    });
  });
});
