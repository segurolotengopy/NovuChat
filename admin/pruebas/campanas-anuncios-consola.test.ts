/**
 * CAMPAÑAS CON TITULARES, PRODUCTO Y ÁNGULO EN LA CONSOLA (PR-2 sobre #601).
 * La pantalla ayuda y el servidor decide: se comprueba que avise lo que el
 * servidor rechaza, que no escriba más de lo que la regla admite y que no
 * toque lo que es del servidor.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as servidor from '../functions/src/modulos/campanas/campanas.ts';
import * as consola from '../web/src/modulos/campanas/campanas.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const AHORA = Date.now();
const dia = (n: number) => servidor.diaBolivia(AHORA + n * 86_400_000);
const HOY = dia(0);
const base = (extra: Record<string, unknown> = {}) =>
  ({ id: 'a', texto: '', inicio: HOY, fin: dia(30), ...extra }) as consola.Campana;

describe('cifras iguales a las del servidor', () => {
  it('límites', () => {
    expect(consola.MAX_TITULARES).toBe(servidor.MAX_TITULARES);
    expect(consola.MIN_LARGO_TITULAR).toBe(servidor.MIN_LARGO_TITULAR);
    expect(consola.MAX_LARGO_TITULAR).toBe(servidor.MAX_LARGO_TITULAR);
    expect(consola.TOPE_ANGULO).toBe(servidor.TOPE_ANGULO);
  });
  it('el hash del navegador coincide con el del servidor con las claves nuevas', async () => {
    const lista = [base({ titulares: ['Control niño sano', 'Control de niño sano'], productoId: 'p1', angulo: 'Enfócate en el control' })];
    expect(await consola.hashListaEnNavegador(lista)).toBe(servidor.hashLista(lista));
  });
  it('lo que avisa la pantalla, el servidor también lo rechaza sin modelo', () => {
    const malos = [
      base({ titulares: ['corto'] }),
      base({ titulares: ['x'.repeat(101)] }),
      base({ titulares: ['Desde solo 32 Bs en consulta'] }),
      base({ titulares: ['Titular válido uno', 'Titular​ válido dos'] }),
      base({ titulares: ['Titular válido'], angulo: 'y'.repeat(301) }),
    ];
    for (const k of malos) {
      const p = consola.problemaEnPantalla(k, [], null, HOY);
      const s = servidor.revisarSinModelo([k], [], 10, AHORA, { ids: [], nombres: [] }, new Set()).get('a');
      expect(p, JSON.stringify(k.titulares)).not.toBeNull();
      expect(s, JSON.stringify(k.titulares)).toBeTruthy();
    }
    expect(consola.problemaEnPantalla(base({ titulares: ['Control niño sano'] }), [], null, HOY)).toBeNull();
  });
});

describe('validación de la pantalla', () => {
  it('sin titulares ni texto no se guarda', () => {
    expect(consola.problemaEnPantalla(base(), [], null, HOY)).toMatchObject({ campo: 'titulares' });
    expect(consola.problemaEnPantalla(base({ titulares: ['   '] }), [], null, HOY)).toMatchObject({ campo: 'titulares' });
  });
  it('seis titulares distintos no pasan; los duplicados exactos se colapsan', () => {
    const seis = ['Uno uno uno', 'Dos dos dos', 'Tres tres', 'Cuatro cuatro', 'Cinco cinco', 'Seis seis'];
    expect(consola.problemaEnPantalla(base({ titulares: seis }), [], null, HOY)).toMatchObject({ campo: 'titulares' });
    expect(consola.titularesLimpios(['Hola mundo', ' Hola   mundo ', 'Otro titular'])).toEqual(['Hola mundo', 'Otro titular']);
  });
  it('un titular repetido en otro anuncio se avisa', () => {
    const otra = { ...base({ titulares: ['Control niño sano'] }), id: 'b' };
    expect(consola.problemaEnPantalla(base({ titulares: ['Control NIÑO sano!'] }), [otra], null, HOY)).toMatchObject({ campo: 'titulares' });
  });
  it('el precio en un titular dice por qué', () => {
    expect(consola.problemaDeTitular('Desde solo 32 Bs')).toContain('precios');
    expect(consola.problemaDeTitular('Pizza grande ya')).toBeNull();
  });
  it('un producto que no está entre los activos se avisa', () => {
    const k = base({ titulares: ['Control niño sano'], productoId: 'zzz' });
    expect(consola.problemaEnPantalla(k, [], null, HOY, new Set(['p1']))).toMatchObject({ campo: 'productoId' });
    expect(consola.problemaEnPantalla(k, [], null, HOY, new Set(['zzz']))).toBeNull();
  });
});

describe('el selector de productos', () => {
  it('solo ofrece los activos con nombre; precio solo para leer', () => {
    const r = consola.productosElegibles([
      { id: 'p2', data: { nombre: 'Zeta', activo: true, precio: 10, moneda: 'BOB' } },
      { id: 'p1', data: { nombre: 'Alfa', activo: true, precio: 5, moneda: 'USD' } },
      { id: 'p3', data: { nombre: 'Inactivo', activo: false } },
      { id: 'p4', data: { nombre: 'Sin bandera' } },
      { id: 'p5', data: { nombre: '  ', activo: true } },
    ]);
    expect(r.map((x) => x.id)).toEqual(['p1', 'p2']);
    expect(r[0]).toMatchObject({ precio: 5, moneda: 'USD' });
  });
});

describe('lo que se escribe', () => {
  it('nunca más de 7 claves, sin vigentes ni revision, y sin claves vacías', () => {
    const todo = consola.campanaParaGuardar(base({
      texto: ' Hola quiero ', titulares: ['Control niño sano', 'Control niño sano', 'Otra variante'],
      productoId: 'p1', angulo: ' enfoque ',
      vigentes: 1, revision: 2, extra: 3,
    }));
    expect(Object.keys(todo).length).toBeLessThanOrEqual(consola.MAX_CLAVES_POR_CAMPANA);
    expect(Object.keys(todo).sort()).toEqual(['angulo', 'fin', 'id', 'inicio', 'productoId', 'texto', 'titulares']);
    expect(todo['titulares']).toEqual(['Control niño sano', 'Otra variante']);
    expect(todo['texto']).toBe('Hola quiero');
    const solo = consola.campanaParaGuardar(base({ titulares: ['Control niño sano'] }));
    expect(Object.keys(solo).sort()).toEqual(['fin', 'id', 'inicio', 'titulares']);
    const vieja = consola.campanaParaGuardar(base({ texto: 'Quiero una cita' }));
    expect(Object.keys(vieja).sort()).toEqual(['fin', 'id', 'inicio', 'texto']);
  });
  it('leerCampanas conserva las claves nuevas y acepta un anuncio sin texto', () => {
    const l = consola.leerCampanas([
      { id: 'a', inicio: HOY, fin: dia(3), titulares: ['Control niño sano'], productoId: 'p1', angulo: 'x' },
      { id: 'b', inicio: HOY, fin: HOY },
    ]);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ texto: '', titulares: ['Control niño sano'], productoId: 'p1', angulo: 'x' });
  });
});

describe('la página', () => {
  const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const pagina = sinComentarios(readFileSync(join(aqui, '..', 'web', 'src', 'modulos', 'campanas', 'Campanas.tsx'), 'utf8'));
  it('escribe solo la lista y pasa cada campaña por campanaParaGuardar', () => {
    expect(pagina).not.toMatch(/vigentes\s*:/);
    expect(pagina).not.toMatch(/revision\s*:/);
    expect((pagina.match(/map\(campanaParaGuardar\)/g) ?? []).length).toBe(2);
  });
  it('lee el catálogo solo del tenant de la ruta y no lo escribe', () => {
    expect(pagina).toContain("collection(db, 'tenants', tenantId, 'catalogo')");
    expect(pagina).not.toMatch(/(setDoc|updateDoc|addDoc|deleteDoc)\(\s*doc\(db, 'tenants', tenantId, 'catalogo'/);
  });
  it('accesibilidad básica y la nota del ángulo', () => {
    expect(pagina).toContain('aria-invalid');
    expect(pagina).toContain('role="alert"');
    expect(pagina).toContain('aria-label={`Quitar el titular');
    expect(pagina).toContain('no puede negar que es un asistente virtual ni afirmar pagos');
    expect(pagina).not.toContain('dangerouslySetInnerHTML');
  });
});
