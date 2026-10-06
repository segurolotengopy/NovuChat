/**
 * CONSOLA OCULTA — `tenants/{id}.consolaOculta`, la lista cerrada de funciones que la consola de UN
 * comercio no pinta (`horario`, `hoy`, `invitar`, `pagar`, `reemplazoQr`). Caso que la motiva: Q'Taco
 * abre el 08/10/2026 y estas cinco cosas no están probadas o dicen algo falso del asistente.
 *
 * Todo SIN emulador ni nube: lógica pura, las pantallas renderizadas con `react-dom/server` (el hook
 * que lee la ficha se sustituye por una lista fija) y el script contra una base en memoria.
 *
 *   A. La lectura: un id desconocido se ignora, un valor que no es lista no oculta nada, sin lista todo
 *      se ve (el comercio sin lista y el de siempre son idénticos).
 *   B. Cada id oculta SU control con la lista y NO sin ella; los demás controles no se tocan.
 *   C. La ruta directa a una página oculta no la abre (redirige al tablero).
 *   D. La regla del servidor: ningún navegador escribe `tenants/{id}` (la lista no la edita el comercio).
 *   (El script que la escribe se prueba en `pruebas/plataforma/aplicar-consola-oculta.test.ts`.)
 *
 * ES SOLO PRESENTACIÓN: nada de esto sustituye un límite del servidor.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IDS_CONSOLA_OCULTA, consolaOcultaDeFicha, esVisible, reemplazoQrOculto,
} from '../../functions/src/central/consola-oculta';

// --- Sustitutos de las pantallas: sin red, sin router real, con una lista fija. -------------------
let LISTA: readonly string[] | null = null;
vi.mock('../../web/src/core/lib/firebase', () => ({ db: {}, funciones: {}, auth: { currentUser: null } }));
vi.mock('../../web/src/central/componentes/ConsolaOculta', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../web/src/central/componentes/ConsolaOculta')>();
  return { ...real, useConsolaOculta: () => LISTA };
});

// El react-router que importan las pantallas (web/node_modules): el especificador desnudo no se resuelve desde aquí.
vi.mock('../../web/node_modules/react-router-dom', () => {
  // `desdeWeb` se define más abajo y se usa recién cuando una pantalla pide el módulo (después).
  const React = { createElement: (c: string, p: unknown, ...h: unknown[]) => createElement(c, p, ...h) };
  type P = { to: string; children?: unknown };
  return {
    useParams: () => ({ tenantId: 'qtaco' }),
    Navigate: (p: P) => React.createElement('span', { 'data-redirige': p.to }),
    Link: (p: P) => React.createElement('a', { href: p.to }, p.children),
    NavLink: (p: P) => React.createElement('a', { href: p.to }, p.children),
  };
});

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const leer = (ruta: string) => readFileSync(join(ADMIN, ruta), 'utf8');
const sinComentarios = (f: string) => f
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const desdeWeb = createRequire(join(ADMIN, 'web', 'package.json'));
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p: unknown, ...h: unknown[]) => unknown };
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };
const { Usuarios } = await import('../../web/src/central/paginas/Usuarios');
const { Configuracion } = await import('../../web/src/central/paginas/Configuracion');
const { PuertaOculta } = await import('../../web/src/central/componentes/ConsolaOculta');
const pintar = (c: unknown, lista: readonly string[] | null) => { LISTA = lista; return renderToStaticMarkup(createElement(c, {})); };

// ===========================================================================
describe('A. la lectura de la lista', () => {
  it('sin la clave, o con una ficha vacía o ausente, no se oculta nada', () => {
    expect(consolaOcultaDeFicha({})).toEqual([]);
    expect(consolaOcultaDeFicha(null)).toEqual([]);
    expect(consolaOcultaDeFicha(undefined)).toEqual([]);
    expect(consolaOcultaDeFicha({ flujos: ['venta'] })).toEqual([]);
  });

  it('un id desconocido se ignora (y no rompe a los conocidos que lo acompañan)', () => {
    expect(consolaOcultaDeFicha({ consolaOculta: ['inventado'] })).toEqual([]);
    expect(consolaOcultaDeFicha({ consolaOculta: ['pagar', 'inventado', '__proto__', 'constructor'] })).toEqual(['pagar']);
    expect(consolaOcultaDeFicha({ consolaOculta: [1, null, {}, ['pagar'], 'pagar'] })).toEqual(['pagar']);
  });

  it('un valor que no es lista no oculta nada (cadena, objeto, null, número)', () => {
    for (const v of ['pagar', { pagar: true }, null, 3, true]) {
      expect(consolaOcultaDeFicha({ consolaOculta: v })).toEqual([]);
    }
  });

  it('sale en el orden de la lista cerrada y sin repetidos', () => {
    expect(consolaOcultaDeFicha({ consolaOculta: ['reemplazoQr', 'pagar', 'pagar', 'horario'] }))
      .toEqual(['horario', 'pagar', 'reemplazoQr']);
  });

  it('la lista cerrada es exactamente esta (agregar un id es un cambio de código con su prueba)', () => {
    expect([...IDS_CONSOLA_OCULTA]).toEqual(['horario', 'hoy', 'invitar', 'pagar', 'reemplazoQr']);
  });

  it('esVisible: sin lista leída nada ocultable aparece; leída, solo se esconde lo listado', () => {
    for (const id of IDS_CONSOLA_OCULTA) {
      expect(esVisible(null, id)).toBe(false);
      expect(esVisible([], id)).toBe(true);
      expect(esVisible([id], id)).toBe(false);
      for (const otro of IDS_CONSOLA_OCULTA.filter((o) => o !== id)) expect(esVisible([otro], id)).toBe(true);
    }
  });

  it('reemplazoQrOculto: solo con la lista Y el cobro activo; el PRIMER QR siempre se puede registrar', () => {
    // Con la lista: activo, se esconde; sin cobro activo (leído), se pinta; sin leer, todavía no.
    expect(reemplazoQrOculto(['reemplazoQr'], true, true)).toBe(true);
    expect(reemplazoQrOculto(['reemplazoQr'], true, false)).toBe(false);
    expect(reemplazoQrOculto(['reemplazoQr'], false, false)).toBe(true);
    // Sin la lista (o con otros ids): idéntico a hoy, aunque el cobro esté activo.
    expect(reemplazoQrOculto([], true, true)).toBe(false);
    expect(reemplazoQrOculto(['pagar', 'horario'], true, true)).toBe(false);
    expect(reemplazoQrOculto([], false, false)).toBe(false);
    // La lista todavía sin leer: no se pinta (no aparece y desaparece).
    expect(reemplazoQrOculto(null, true, false)).toBe(true);
  });
});

// ===========================================================================
describe('B. cada id oculta su control con la lista y NO sin ella', () => {
  it('invitar: el formulario «Invitar» sale sin lista y no sale con ella; la tabla de usuarios queda', () => {
    const sin = pintar(Usuarios, []);
    expect(sin).toContain('Invitar');
    expect(sin).toContain('Enviar invitación');
    const con = pintar(Usuarios, ['invitar']);
    expect(con).not.toContain('Invitar');
    expect(con).not.toContain('Enviar invitación');
    expect(con).toContain('Usuarios del negocio');
    // Otro comercio con otros ids ocultos (o ninguno) ve todo.
    expect(pintar(Usuarios, ['pagar', 'horario'])).toContain('Enviar invitación');
  });

  it('horario: la sección «Horario de atención» sale sin lista y no sale con ella; lo demás queda', () => {
    const sin = pintar(Configuracion, []);
    expect(sin).toContain('Horario de atención');
    expect(sin).toContain('Voz del asistente');
    const con = pintar(Configuracion, ['horario']);
    expect(con).not.toContain('Horario de atención');
    expect(con).not.toContain('Días y horas');
    expect(con).toContain('Voz del asistente');
    expect(pintar(Configuracion, ['hoy', 'pagar', 'invitar'])).toContain('Horario de atención');
  });

  it('con la lista sin leer (carga) no aparece nada ocultable', () => {
    expect(pintar(Usuarios, null)).not.toContain('Enviar invitación');
    expect(pintar(Configuracion, null)).not.toContain('Horario de atención');
  });

  // Tablero, Pagar (menú y botón de «Estado de cuenta») y Cobro dependen de datos del servidor para
  // pintarse: se comprueban por la guarda de fuente (la decisión es la misma función pura de arriba).
  it('hoy: la tarjeta «Hoy» del Tablero se pinta solo con esVisible(ocultos, \'hoy\')', () => {
    const f = sinComentarios(leer('web/src/central/paginas/Tablero.tsx'));
    expect(f).toContain("const verHoy = esVisible(ocultos, 'hoy');");
    expect(f).toMatch(/\{verHoy && <Tarjeta\s+titulo="Hoy"/);
    expect(f).toContain('useConsolaOculta(tenantId)');
  });

  it('pagar: la pestaña del menú y el botón de «Estado de cuenta» siguen a la lista', () => {
    const app = sinComentarios(leer('web/src/App.tsx'));
    expect(app).toMatch(/esVisible\(ocultos, 'pagar'\) &&\s*<NavLink to=\{`\/negocio\/\$\{tenantId\}\/pagar`\}>Pagar<\/NavLink>/);
    const cuenta = sinComentarios(leer('web/src/central/paginas/EstadoCuenta.tsx'));
    expect(cuenta).toContain("esVisible(ocultos, 'pagar')");
  });

  it('reemplazoQr: el formulario de reemplazo lo decide reemplazoQrOculto y el primer QR no se toca', () => {
    const f = sinComentarios(leer('web/src/modulos/cobros/Cobro.tsx'));
    expect(f).toContain('const sinReemplazo = reemplazoQrOculto(ocultos, leido, activo);');
    expect(f).toContain('setLeido(true)');
    expect(f).toMatch(/\{sinReemplazo \? \(/);
    // El título y el formulario están DENTRO de la rama que se esconde.
    const rama = f.slice(f.indexOf('{sinReemplazo ? ('));
    expect(rama.indexOf("Cambiar el QR")).toBeGreaterThan(0);
    expect(rama.indexOf('<form onSubmit={enviar}>')).toBeGreaterThan(rama.indexOf("Cambiar el QR"));
  });

  it('guardar Configuración con «Horario» oculto no valida ni escribe `horarios`', () => {
    const f = sinComentarios(leer('web/src/central/paginas/Configuracion.tsx'));
    expect(f).toContain('if (conHorario && DIAS_SEMANA.some(');
    expect(f).toContain('...(conHorario ? { horarios: escribirHorarios(horarios) } : {}),');
    expect(f).not.toMatch(/^\s*horarios: escribirHorarios\(horarios\),/m);
  });
});

// ===========================================================================
describe('C. la ruta directa a una página oculta no se abre', () => {
  const pagina = createElement('div', {}, 'PAGINA-DE-PAGAR');
  const puerta = (ocultos: readonly string[] | null) =>
    renderToStaticMarkup(createElement(PuertaOculta, { ocultos, id: 'pagar', children: pagina }));

  it('sin lista, la página se abre', () => {
    expect(puerta([])).toContain('PAGINA-DE-PAGAR');
    expect(puerta(['horario', 'hoy', 'invitar', 'reemplazoQr'])).toContain('PAGINA-DE-PAGAR');
  });

  it('con «pagar» oculto redirige al tablero y no pinta la página', () => {
    const html = puerta(['pagar']);
    expect(html).not.toContain('PAGINA-DE-PAGAR');
    expect(html).not.toContain('Cargando');
    expect(html).toContain('data-redirige="/"'); // «/» es el tablero
  });

  it('mientras carga la lista no pinta la página', () => {
    const html = puerta(null);
    expect(html).not.toContain('PAGINA-DE-PAGAR');
    expect(html).toContain('Cargando');
  });

  it('la ruta de Pagar en App.tsx pasa por la puerta', () => {
    const app = sinComentarios(leer('web/src/App.tsx'));
    expect(app).toMatch(/path="\/negocio\/:tenantId\/pagar"[\s\S]{0,200}<SiNoOculta id="pagar"><Pagar \/><\/SiNoOculta>/);
  });

  it('la consola no escribe la lista: ningún archivo de web/ la nombra con un `setDoc`/`updateDoc`', () => {
    const lector = sinComentarios(leer('web/src/central/componentes/ConsolaOculta.tsx'));
    expect(lector).not.toMatch(/setDoc|updateDoc|addDoc|writeBatch|runTransaction/);
    expect(lector).not.toContain('dangerouslySetInnerHTML');
  });
});

// ===========================================================================
describe('D. el servidor: ningún navegador escribe la ficha del comercio', () => {
  it('firestore.rules cierra create, update y delete de tenants/{tenantId}', () => {
    const reglas = leer('firestore.rules');
    const inicio = reglas.indexOf('match /tenants/{tenantId} {');
    expect(inicio).toBeGreaterThan(0);
    const cuerpo = reglas.slice(inicio, reglas.indexOf('match /config/{documento}', inicio));
    expect(cuerpo).toMatch(/allow create, update, delete: if false;/);
    expect(cuerpo).not.toMatch(/allow (create|update|write)[^;]*if (?!false)/);
  });
});

