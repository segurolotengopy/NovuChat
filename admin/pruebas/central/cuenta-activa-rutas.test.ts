/**
 * RUTAS DEL SELECTOR (PR-1 + PR-2 en un PR): lo que el cableado de App.tsx
 * promete y no debe romper.
 *  - `/negocio/<ajeno>/inicio` da «Sin permiso» SIN leer nada (ni un getDoc).
 *  - `/cuentas` exige sesión (va dentro de Proteger) y el propietario no la ve.
 *  - Todo `/negocio/:tenantId/*` cuelga de un solo árbol con `key={tenantId}`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const sesion = vi.hoisted(() => ({ valor: null as unknown }));
const lecturas = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../web/src/core/lib/firebase', () => ({ db: {}, auth: {} }));
vi.mock('../../web/src/core/lib/contexto', () => ({ useSesion: () => sesion.valor, ProveedorSesion: ({ children }: { children: unknown }) => children }));
vi.mock('firebase/firestore', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  const cuenta = () => { lecturas.n++; throw new Error('lectura no permitida'); };
  return { ...real, getDoc: cuenta, onSnapshot: cuenta, getDocs: cuenta, getCountFromServer: cuenta };
});

import { TableroDeLaCuenta } from '../../web/src/central/paginas/Tablero';
import { rolEn } from '../../web/src/core/lib/sesion';
import { SoloConVariasCuentas } from '../../web/src/central/componentes/SoloConVariasCuentas';

const aqui = dirname(fileURLToPath(import.meta.url));
const desdeWeb = createRequire(join(aqui, '..', '..', 'web', 'package.json'));
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p?: unknown, ...h: unknown[]) => unknown };
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };
const { MemoryRouter, Routes, Route } = desdeWeb('react-router-dom') as Record<string, unknown>;

const poner = (tenants: Record<string, string>, propietario = false) => {
  sesion.valor = { cargando: false, usuario: { uid: 'u1' }, permisos: { propietario, tenants, version: 1 }, refrescar: async () => {} };
};
const verRuta = (ruta: string, patron: string, elemento: unknown) => renderToStaticMarkup(
  createElement(MemoryRouter, { initialEntries: [ruta] },
    createElement(Routes, null, createElement(Route, { path: patron, element: elemento }),
      createElement(Route, { path: '/', element: createElement('p', null, 'RAIZ') }))));

beforeEach(() => { lecturas.n = 0; });

describe('/negocio/:tenantId/inicio', () => {
  const ver = (id: string) => verRuta(`/negocio/${id}/inicio`, '/negocio/:tenantId/inicio', createElement(TableroDeLaCuenta));
  it('un id ajeno, inexistente o hostil da «Sin permiso» y no lee nada', () => {
    poner({ a: 'admin', b: 'oper' });
    for (const id of ['ajeno', 'inexistente', '__proto__', 'constructor', 'A']) {
      expect(ver(id), id).toContain('Sin permiso');
    }
    expect(lecturas.n).toBe(0);
  });
  it('CONTROL POSITIVO: con un id propio (admin u oper) NO aparece «Sin permiso» y se entra al tablero', () => {
    for (const rol of ['admin', 'oper']) {
      poner({ a: rol });
      const html = ver('a');
      expect(html, rol).not.toContain('Sin permiso');
      expect(html, rol).not.toContain('RAIZ'); // el efecto de lectura no corre en render estático: se pinta el tablero (cargando)
    }
  });
  it('un rol ingesta tampoco entra al tablero de una persona', () => {
    poner({ m: 'ingesta' });
    expect(ver('m')).toContain('Sin permiso');
    expect(lecturas.n).toBe(0);
  });
  it('el propietario sin rol en esa cuenta tampoco ve su tablero por esta ruta', () => {
    poner({}, true);
    expect(ver('a')).toContain('Sin permiso');
  });
});

describe('/cuentas', () => {
  const ver = () => verRuta('/cuentas', '/cuentas', createElement(SoloConVariasCuentas, null, createElement('p', null, 'SELECTOR')));
  it('control positivo: con dos cuentas se muestra', () => {
    poner({ a: 'admin', b: 'oper' });
    expect(ver()).toContain('SELECTOR');
  });
  it('el propietario no lo ve, ni con cuentas', () => {
    poner({ a: 'admin', b: 'oper' }, true);
    expect(ver()).not.toContain('SELECTOR');
  });
  it('con 0 o 1 cuenta (o una admin y una ingesta) vuelve al inicio', () => {
    for (const t of [{}, { a: 'admin' }, { a: 'admin', m: 'ingesta' }]) {
      poner(t);
      expect(ver(), JSON.stringify(t)).not.toContain('SELECTOR');
    }
  });
});

describe('rolEn: solo claves propias del token', () => {
  const p = { propietario: false, tenants: { a: 'admin' as const }, version: 1 };
  it('constructor, toString, __proto__ y hasOwnProperty dan null; el rol propio sigue funcionando', () => {
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(rolEn(p, id), id).toBeNull();
    }
    expect(rolEn(p, 'a')).toBe('admin');
    expect(rolEn(p, 'b')).toBeNull();
  });
});

describe('App.tsx: el cableado', () => {
  const app = readFileSync(join(aqui, '..', '..', 'web', 'src', 'App.tsx'), 'utf8');
  it('/cuentas va dentro de Proteger (sin sesión, a /ingresar) y no es pública', () => {
    expect(app).toMatch(/path="\/cuentas" element=\{\s*<Proteger><SoloConVariasCuentas>/);
  });
  it('inicio pide miembroTenant; todo /negocio/:tenantId cuelga de un árbol con key', () => {
    expect(app).toMatch(/path="\/negocio\/:tenantId\/inicio" element=\{\s*<Proteger requiere="miembroTenant">/);
    expect(app).toContain('<Outlet key={tenantId} />');
    const ini = app.indexOf('<Route element={<PorCuenta />}>');
    const fin = app.indexOf('</Route>', ini);
    expect(ini).toBeGreaterThan(-1);
    const dentro = app.slice(ini, fin);
    const fuera = app.slice(0, ini) + app.slice(fin);
    const todas = app.match(/<Route path="\/negocio\/:tenantId[^"]*"/g) ?? [];
    expect(todas.length).toBeGreaterThan(15);
    expect(dentro.match(/<Route path="\/negocio\/:tenantId[^"]*"/g)).toEqual(todas);
    expect(fuera).not.toContain('path="/negocio/:tenantId');
  });
  it('los títulos nuevos', () => {
    expect(app).toContain("cuentas: 'Elegir cuenta'");
    expect(app).toContain("inicio: 'Inicio'");
  });
  it('la cabecera ofrece «Cambiar de cuenta» y recuerda la última', () => {
    expect(app).toContain('Cambiar de cuenta');
    expect(app).toContain("pathname !== '/cuentas' && pathname !== '/'");
    expect(app).toContain('/inicio`}>Inicio</NavLink>');
    expect(app).not.toContain('Mis negocios');
    expect(app).toContain('guardarUltima(uid, tenantDeLaRuta)');
  });
});
