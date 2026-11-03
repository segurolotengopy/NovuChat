/**
 * CONSOLA DE CONVERSACIONES — `tenants/{id}.consolaConversaciones`, la bandera que
 * elige entre la pantalla de siempre ('clasica') y la nueva ('nueva') de UN comercio.
 *
 * Todo SIN emulador ni nube: lógica pura y el selector renderizado con
 * `react-dom/server` (el hook que lee la ficha y las dos pantallas se sustituyen por
 * marcas), igual que `consola-oculta.test.ts`.
 *
 *   A. La lectura (24/10/2026): la NUEVA es la de por defecto. Ausente, desconocida o de otro
 *      tipo es 'nueva'; SOLO un 'clasica' exacto da la de siempre. Y el default NO habilita Tomar.
 *   B. La validación del script que la escribe: lo desconocido se rechaza.
 *   C. El selector: con 'clasica' pinta la clásica, con cualquier otra cosa la nueva,
 *      y mientras carga no pinta ninguna.
 *   D. El hook: error de lectura = el default compartido ('nueva'); lee la ficha del negocio y nada más.
 *   E. El servidor: ningún navegador escribe `tenants/{id}` (la bandera no la edita el comercio).
 *
 * ES SOLO PRESENTACIÓN: la bandera no es un límite; lo que el servidor permite no cambia con ella.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { habilitadoParaPersona } from '../../functions/src/core/conversacion/accesoPersona';
import {
  PANTALLA_POR_DEFECTO, PANTALLAS_CONVERSACIONES, esPantallaConversaciones, pantallaConversacionesDeFicha, validarPantallaConversaciones,
} from '../../functions/src/central/consola-conversaciones';

// --- Sustitutos: sin red, sin router real, con una pantalla fija. ------------------------------------
let PANTALLA: 'clasica' | 'nueva' | null = null;
vi.mock('../../web/src/core/lib/firebase', () => ({ db: {}, funciones: {}, auth: { currentUser: null } }));
vi.mock('../../web/src/central/componentes/ConsolaConversaciones', () => ({ useConsolaConversaciones: () => PANTALLA }));
vi.mock('../../web/src/central/paginas/ConversacionesClasica', () => {
  const React = { createElement: (c: string, p: unknown, ...h: unknown[]) => createElement(c, p, ...h) };
  return { Conversaciones: () => React.createElement('p', { 'data-pantalla': 'clasica' }, 'PANTALLA-DE-SIEMPRE') };
});
vi.mock('../../web/src/central/paginas/ConversacionesNueva', () => {
  const React = { createElement: (c: string, p: unknown, ...h: unknown[]) => createElement(c, p, ...h) };
  return { ConversacionesNueva: () => React.createElement('p', { 'data-pantalla': 'nueva' }, 'PANTALLA-NUEVA') };
});
vi.mock('../../web/node_modules/react-router-dom', () => ({ useParams: () => ({ tenantId: 'comercio-x' }) }));

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const leer = (ruta: string) => readFileSync(join(ADMIN, ruta), 'utf8');
const sinComentarios = (f: string) => f
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const desdeWeb = createRequire(join(ADMIN, 'web', 'package.json'));
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p: unknown, ...h: unknown[]) => unknown };
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };
const { Conversaciones } = await import('../../web/src/central/paginas/Conversaciones');
const pintar = (pantalla: 'clasica' | 'nueva' | null) => { PANTALLA = pantalla; return renderToStaticMarkup(createElement(Conversaciones, {})); };

// ===========================================================================
describe('A. la lectura de la bandera', () => {
  it('las pantallas son estas dos, en este orden (agregar una es un cambio de código con su prueba)', () => {
    expect([...PANTALLAS_CONVERSACIONES]).toEqual(['clasica', 'nueva']);
    expect(esPantallaConversaciones('clasica')).toBe(true);
    expect(esPantallaConversaciones('nueva')).toBe(true);
    for (const v of ['', 'Nueva', 'NUEVA', ' nueva', 'antigua', null, undefined, 1, true, {}, ['nueva']]) expect(esPantallaConversaciones(v)).toBe(false);
  });

  it('el default es «nueva» y es la única constante', () => {
    expect(PANTALLA_POR_DEFECTO).toBe('nueva');
    expect(pantallaConversacionesDeFicha({ consolaConversaciones: 'nueva' })).toBe('nueva');
  });

  it('SOLO un «clasica» exacto (emergencia) da la pantalla de siempre', () => {
    expect(pantallaConversacionesDeFicha({ consolaConversaciones: 'clasica' })).toBe('clasica');
  });

  it('SIN BANDERA: ausente, ficha vacía o ausente, desconocida o de otro tipo → «nueva»', () => {
    expect(pantallaConversacionesDeFicha({})).toBe('nueva');
    expect(pantallaConversacionesDeFicha(null)).toBe('nueva');
    expect(pantallaConversacionesDeFicha(undefined)).toBe('nueva');
    expect(pantallaConversacionesDeFicha({ flujos: ['venta'] })).toBe('nueva');
    for (const v of ['Clasica', 'CLASICA', ' clasica', 'clasica ', 'antigua', '', null, undefined, 0, 1, true, false, {}, ['clasica'], { clasica: true }]) {
      expect(pantallaConversacionesDeFicha({ consolaConversaciones: v }), JSON.stringify(v)).toBe('nueva');
    }
  });

  it('NEGATIVA: una clave heredada del prototipo de objetos no cuenta (solo la propia de la ficha)', () => {
    const heredada = Object.create({ consolaConversaciones: 'clasica' }) as { consolaConversaciones?: unknown };
    expect(pantallaConversacionesDeFicha(heredada)).toBe('nueva');
  });

  it('NEGATIVA: el default implícito NO habilita Tomar ni escribir como persona (exigen «nueva» explícito)', () => {
    // Sin bandera: pantalla nueva en lectura, pero el servidor deniega la intervención.
    const sinBandera = { nombre: 'Tienda A', estado: 'activo' };
    expect(pantallaConversacionesDeFicha(sinBandera)).toBe('nueva');
    expect(habilitadoParaPersona('tienda-a', sinBandera)).toBe(false);
    // Bellido con bandera «nueva»: pantalla nueva, y Tomar sigue denegado (por id y por nombre).
    const bellido = { nombre: 'Consultorio Bellido', estado: 'activo', consolaConversaciones: 'nueva' };
    expect(pantallaConversacionesDeFicha(bellido)).toBe('nueva');
    expect(habilitadoParaPersona('bellido', bellido)).toBe(false);
    expect(habilitadoParaPersona('tienda-a', bellido)).toBe(false);
    // Un comercio común con «nueva» explícito sí queda habilitado (control positivo).
    expect(habilitadoParaPersona('tienda-a', { ...sinBandera, consolaConversaciones: 'nueva' })).toBe(true);
    // «clasica» explícito: pantalla clásica y sin intervención.
    expect(habilitadoParaPersona('tienda-a', { ...sinBandera, consolaConversaciones: 'clasica' })).toBe(false);
  });
});

// ===========================================================================
describe('B. la validación del valor que escribe el script de plataforma', () => {
  it('acepta exactamente las dos pantallas', () => {
    expect(validarPantallaConversaciones('nueva')).toEqual({ ok: true, pantalla: 'nueva' });
    expect(validarPantallaConversaciones('clasica')).toEqual({ ok: true, pantalla: 'clasica' });
  });

  it('NEGATIVA: rechaza lo desconocido, vacío o de otro tipo (quien escribe tiene que saber lo que escribe)', () => {
    for (const v of ['', 'Nueva', 'nueva,clasica', 'otra', undefined, null, 3, {}]) {
      const r = validarPantallaConversaciones(v);
      expect(r.ok, JSON.stringify(v)).toBe(false);
      if (!r.ok) expect(r.problemas.length).toBeGreaterThan(0);
    }
    const r = validarPantallaConversaciones('x'.repeat(200));
    expect(r.ok === false && r.problemas.join('').length < 250).toBe(true);   // no vuelca un valor largo en el mensaje
  });
});

// ===========================================================================
describe('C. el selector', () => {
  it('con «nueva» (o sin bandera) pinta la pantalla nueva y NO la de siempre', () => {
    const html = pintar('nueva');
    expect(html).toContain('PANTALLA-NUEVA');
    expect(html).not.toContain('PANTALLA-DE-SIEMPRE');
  });

  it('con «clasica» pinta la de siempre y NO la nueva', () => {
    const html = pintar('clasica');
    expect(html).toContain('PANTALLA-DE-SIEMPRE');
    expect(html).not.toContain('PANTALLA-NUEVA');
  });

  it('mientras la bandera carga no pinta NINGUNA (no parpadea la equivocada)', () => {
    const html = pintar(null);
    expect(html).toContain('Cargando');
    expect(html).not.toContain('PANTALLA-NUEVA');
    expect(html).not.toContain('PANTALLA-DE-SIEMPRE');
  });

  it('todo lo que no es «clasica» cae en la nueva (la elección es una sola comparación)', () => {
    const f = sinComentarios(leer('web/src/central/paginas/Conversaciones.tsx'));
    expect(f).toContain("return pantalla === 'clasica' ? <ConversacionesClasica /> : <ConversacionesNueva />;");
    expect(f).toContain('if (pantalla === null) return <p>Cargando…</p>;');
    // `key`: al cambiar de negocio la elección empieza de cero.
    expect(f).toContain('<ConversacionesSegunBandera key={tenantId} tenantId={tenantId} />');
  });
});

// ===========================================================================
describe('D. el hook que lee la bandera', () => {
  const hook = sinComentarios(leer('web/src/central/componentes/ConsolaConversaciones.tsx'));

  it('lee SOLO la ficha del negocio de la ruta, con la función pura', () => {
    expect(hook).toContain("onSnapshot(doc(db, 'tenants', tenantId),");
    expect(hook).toContain('(d) => setPantalla(pantallaConversacionesDeFicha(d.data())),');
  });

  it('si la lectura falla, usa el MISMO default que el servidor (una sola constante, sin literal propio)', () => {
    expect(hook).toContain('() => setPantalla(PANTALLA_POR_DEFECTO));');
    expect(hook).not.toContain("setPantalla('clasica')");
    expect(hook).not.toContain("setPantalla('nueva')");
  });

  it('mientras carga es `null`, y al cambiar de negocio vuelve a `null` antes de leer', () => {
    expect(hook).toContain('useState<PantallaConversaciones | null>(null)');
    expect(hook).toContain('setPantalla(null);');
  });

  it('el hook no escribe nada', () => {
    expect(hook).not.toMatch(/setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction/);
  });
});

// ===========================================================================
describe('E. el servidor: ningún navegador escribe la ficha del comercio', () => {
  it('firestore.rules cierra create, update y delete de tenants/{tenantId} (la bandera la escribe solo el script de plataforma)', () => {
    const reglas = leer('firestore.rules');
    const inicio = reglas.indexOf('match /tenants/{tenantId} {');
    expect(inicio).toBeGreaterThan(0);
    const cuerpo = reglas.slice(inicio, reglas.indexOf('match /config/{documento}', inicio));
    expect(cuerpo).toMatch(/allow create, update, delete: if false;/);
    expect(cuerpo).not.toMatch(/allow (create|update|write)[^;]*if (?!false)/);
  });

  it('el helper de la bandera no tiene `import` (lo cargan la consola, el script y las pruebas)', () => {
    expect(sinComentarios(leer('functions/src/central/consola-conversaciones.ts'))).not.toMatch(/^\s*import\b/m);
  });
});
