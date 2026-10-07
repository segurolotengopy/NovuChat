/**
 * =============================================================================
 * H2b-5: LA CONSOLA CONSUME EL REGISTRO — equivalencia antes/después
 * =============================================================================
 *
 * Hasta H2b-5 la consola decidía sus pestañas, rótulos y capacidades con su
 * propia tabla (`web/src/central/lib/flujos.ts`) y con `flujos.includes('x')`
 * repartido por las pantallas. Ahora lee `functions/src/registro.ts`. La promesa
 * es CERO cambios visibles para los comercios de hoy, y esta suite la prueba:
 *
 *   «ANTES» es la consola del 03/10/2026 copiada LITERAL, con su lógica (la
 *   tabla, `flujosDe`, `etiquetaCatalogo`, el filtro de la cabecera de
 *   `App.tsx`, y lo que decidían `Cobro`, `Catalogo`, `Captacion` y `Tablero`).
 *   «DESPUÉS» son las funciones puras de la fachada `flujos.ts` que las
 *   pantallas LLAMAN (`pestanasVisibles`, `capacidadesDeConsola`,
 *   `etiquetaDeCatalogoDe`): esta suite ejecuta esas mismas funciones, no una
 *   copia. Lo que ninguna suite ejecuta es el JSX: que cada pantalla las llame
 *   con los argumentos y los campos correctos lo exigen las GUARDAS DE FUENTE
 *   de abajo (la llamada exacta), y cada una se probó mutando la pantalla (ver
 *   la descripción del PR). No hay prueba que RENDERICE las pantallas.
 *
 * Se comparan los OCHO subconjuntos de los tres flujos, escritos como `flujos`
 * y, los de un solo flujo, como `vertical` (las fichas anteriores a la lista),
 * para cada visitante (administrador, operador, otro rol, sin rol; con y sin
 * sesión de propietario).
 *
 * UNA DIFERENCIA, A PROPÓSITO, y probada negando:
 *   1. Una ficha con `flujos` que NO es lista CIERRA (antes la consola caía a
 *      `vertical` y abría pestañas que las reglas cerraban: seguimiento #392).
 *   2. Con más de un flujo el ORDEN de las pestañas es el del registro (`orden`),
 *      no el de la lista de la ficha ni el de la lista de cada flujo (venta
 *      intercalaba «Inventario» entre las dos de Cobros); el CONJUNTO es el mismo.
 *      Solo se nota en una mezcla de reservas y venta o con la lista escrita al
 *      revés; ningún comercio de hoy tiene más de un flujo.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { IDS_FLUJOS, IDS_MODULOS, PUENTE_DE_FLUJOS } from '../../functions/src/registro.ts';
import type { IdFlujo } from '../../functions/src/registro.ts';
import {
  FLUJOS as FLUJOS_DESPUES, capacidadesDeConsola, etiquetaCatalogo as etiquetaDespues, etiquetaDeCatalogoDe,
  flujosDe as flujosDespues, modulosDe, pestanasVisibles,
} from '../../web/src/central/lib/flujos.ts';

/** La fachada importa `core/lib/firebase` (para `useModulos`); acá no hay navegador ni claves. */
vi.mock('../../web/src/core/lib/firebase', () => ({ db: {} }));

const aqui = dirname(fileURLToPath(import.meta.url));
const WEB = join(aqui, '..', '..', 'web', 'src');

// ============================================================ ANTES (03/10)
type PestanaAntes = { ruta: string; etiqueta: string; roles?: ('admin' | 'oper')[]; tambienPropietario?: boolean };
const FLUJOS_ANTES: Record<string, { nombre: string; pestanas: PestanaAntes[]; catalogo: string; documento: string }> = {
  agendamiento: {
    nombre: 'Reservas y citas',
    pestanas: [
      { ruta: 'agenda', etiqueta: 'Agenda' },
      { ruta: 'cobros', etiqueta: 'Cobros' },
      { ruta: 'cobro', etiqueta: 'Configuración de QR' },
    ],
    catalogo: 'Servicios',
    documento: 'agendamiento',
  },
  venta: {
    nombre: 'Pedidos y cobro',
    pestanas: [
      { ruta: 'pedidos', etiqueta: 'Pedidos', roles: ['admin', 'oper'] },
      { ruta: 'cobros', etiqueta: 'Cobros' },
      { ruta: 'inventario', etiqueta: 'Inventario' },
      { ruta: 'cobro', etiqueta: 'Configuración de QR' },
    ],
    catalogo: 'Productos',
    documento: 'venta',
  },
  onboarding: {
    nombre: 'Captación de clientes',
    pestanas: [{ ruta: 'captacion', etiqueta: 'Captación', tambienPropietario: true }],
    catalogo: 'Catálogo',
    documento: 'onboarding',
  },
};
type Ficha = { flujos?: unknown; vertical?: unknown; modulos?: unknown };
const esFlujoAntes = (v: unknown): boolean => typeof v === 'string' && Object.prototype.hasOwnProperty.call(FLUJOS_ANTES, v);
/** `flujosDe` de la consola, tal cual: la lista manda; sin lista (`!Array.isArray`), `vertical`. */
const flujosAntes = (ficha: Ficha | undefined): string[] => {
  if (!ficha) return [];
  if (Array.isArray(ficha.flujos)) return ficha.flujos.filter(esFlujoAntes) as string[];
  return esFlujoAntes(ficha.vertical) ? [ficha.vertical as string] : [];
};
const catalogoAntes = (flujos: string[]): string => {
  const nombres = new Set(flujos.map((f) => FLUJOS_ANTES[f]!.catalogo));
  return nombres.size === 1 ? [...nombres][0] as string : 'Catálogo';
};
/** El filtro de la cabecera de `App.tsx`, copiado literal (rol y propietario como los pasa la cabecera). */
const menuAntes = (flujos: string[], rol: string | null, propietario: boolean) =>
  flujos.flatMap((f) => FLUJOS_ANTES[f]!.pestanas
    .filter((p) => (p.tambienPropietario === true && propietario)
      || (p.roles ?? ['admin']).includes(rol as 'admin' | 'oper')))
    .filter((p, i, todas) => todas.findIndex((q) => q.ruta === p.ruta) === i)
    .map((p) => ({ ruta: p.ruta, titulo: p.etiqueta }));
/** Lo que decidía `Cobro.tsx`. */
const cobroAntes = (flujos: string[]) => {
  const tieneVenta = flujos.includes('venta');
  const tieneAgenda = flujos.includes('agendamiento');
  return { tieneVenta, tieneAgenda, documento: tieneVenta ? 'venta' : tieneAgenda ? 'agendamiento' : null };
};

// ============================================================ DESPUÉS
const menuDespues = (ficha: Ficha, rol: string | null, propietario: boolean) =>
  pestanasVisibles(modulosDe(ficha), { rol, propietario });
/** Lo que decide `Cobro.tsx`, con la función que `Cobro.tsx` llama. */
const cobroDespues = (ficha: Ficha) => {
  const c = capacidadesDeConsola(modulosDe(ficha));
  return { tieneVenta: c.conPedidos, tieneAgenda: c.conAgenda, documento: c.documentoCobro };
};

// ============================================================ los casos
const subconjuntos: IdFlujo[][] = Array.from({ length: 1 << IDS_FLUJOS.length },
  (_, mascara) => IDS_FLUJOS.filter((_f, i) => (mascara >> i) & 1));
const nombre = (s: readonly string[]) => `[${s.join(', ')}]`;
const mezclaReservasYVenta = (s: readonly string[]) => s.includes('agendamiento') && s.includes('venta');
const enOrdenDelRegistro = (s: readonly string[]) =>
  s.every((f, i) => i === 0 || IDS_FLUJOS.indexOf(s[i - 1] as IdFlujo) < IDS_FLUJOS.indexOf(f as IdFlujo));
const VISITANTES: { rol: string | null; propietario: boolean }[] = [
  { rol: 'admin', propietario: false }, { rol: 'oper', propietario: false }, { rol: 'ingesta', propietario: false },
  { rol: null, propietario: false }, { rol: null, propietario: true }, { rol: 'admin', propietario: true },
  { rol: 'oper', propietario: true },
];
/** Las fichas que representan un conjunto de flujos: la lista y, si es uno solo, el `vertical` viejo. */
const fichasDe = (s: IdFlujo[]): Ficha[] => [
  { flujos: s }, { flujos: s, vertical: s[0] },
  ...(s.length === 1 ? [{ vertical: s[0] }] : []),
  ...(s.length > 1 ? [{ flujos: [...s].reverse() }] : []),
];

describe('H2b-5: la consola de hoy es la del 03/10 para los ocho subconjuntos de flujos', () => {
  it('son ocho, con el vacío y los tres juntos', () => {
    expect(subconjuntos).toHaveLength(8);
    expect(subconjuntos).toContainEqual([]);
    expect(subconjuntos).toContainEqual([...IDS_FLUJOS]);
  });

  it.each(subconjuntos.map((s) => [nombre(s), s] as const))('%s: flujos y módulos de la ficha', (_n, s) => {
    for (const ficha of fichasDe(s)) {
      expect(flujosDespues(ficha), JSON.stringify(ficha)).toEqual(flujosAntes(ficha));
    }
  });

  it.each(subconjuntos.map((s) => [nombre(s), s] as const))('%s: pestañas y rótulos del menú, por visitante', (_n, s) => {
    for (const ficha of fichasDe(s)) {
      for (const v of VISITANTES) {
        const antes = menuAntes(flujosAntes(ficha), v.rol, v.propietario);
        const despues = menuDespues(ficha, v.rol, v.propietario);
        const donde = `${JSON.stringify(ficha)} ${JSON.stringify(v)}`;
        // En una mezcla de reservas y venta, o con la lista escrita en otro orden que el del
        // registro, el orden es el del registro (`orden`); el conjunto, el mismo.
        if (mezclaReservasYVenta(flujosAntes(ficha)) || !enOrdenDelRegistro(flujosAntes(ficha))) {
          expect(despues.map((p) => p.ruta).sort(), donde).toEqual(antes.map((p) => p.ruta).sort());
          expect([...despues].sort((a, b) => a.ruta.localeCompare(b.ruta)), donde)
            .toEqual([...antes].sort((a, b) => a.ruta.localeCompare(b.ruta)));
        } else {
          expect(despues, donde).toEqual(antes);
        }
      }
    }
  });

  it.each(subconjuntos.map((s) => [nombre(s), s] as const))('%s: etiqueta de catálogo, título de página y del Tablero', (_n, s) => {
    for (const ficha of fichasDe(s)) {
      const antes = catalogoAntes(flujosAntes(ficha));
      expect(etiquetaDeCatalogoDe(modulosDe(ficha)), JSON.stringify(ficha)).toBe(antes);
      expect(etiquetaDespues(flujosDespues(ficha)), JSON.stringify(ficha)).toBe(antes);
      // El Tablero muestra el nombre de cada flujo de la ficha.
      expect(flujosDespues(ficha).map((f) => FLUJOS_DESPUES[f].nombre), JSON.stringify(ficha))
        .toEqual(flujosAntes(ficha).map((f) => FLUJOS_ANTES[f]!.nombre));
    }
  });

  it.each(subconjuntos.map((s) => [nombre(s), s] as const))('%s: lo que deciden Cobro, Catálogo y Captación', (_n, s) => {
    for (const ficha of fichasDe(s)) {
      const flujos = flujosAntes(ficha);
      const c = capacidadesDeConsola(modulosDe(ficha));
      const donde = JSON.stringify(ficha);
      expect(cobroDespues(ficha), donde).toEqual(cobroAntes(flujos));
      // Catalogo.tsx: duración de cita (agenda), vista previa del sitio (venta) y título.
      expect(c.conAgenda, donde).toBe(flujos.includes('agendamiento'));
      expect(c.conVistaPrevia, donde).toBe(flujos.includes('venta'));
      expect(c.etiquetaCatalogo, donde).toBe(catalogoAntes(flujos));
      // Captacion.tsx: la pantalla se abre solo con el flujo de captación.
      expect(c.conCaptacion, donde).toBe(flujos.includes('onboarding'));
      // Inventario.tsx: la ruta solo se abre con el módulo; con los flujos, lo trae el de venta (respaldo).
      expect(c.conInventario, donde).toBe(flujos.includes('venta'));
    }
  });

  it('los seis comercios de hoy: el menú exacto, en orden, para su administrador', () => {
    const esperado: Record<string, string[]> = {
      // Demo A, Platinum y Bellido.
      agendamiento: ['agenda', 'cobros', 'cobro'],
      // Demo B y Q'Taco.
      venta: ['pedidos', 'cobros', 'inventario', 'cobro'],
      // NovuChat.
      onboarding: ['captacion'],
    };
    for (const f of IDS_FLUJOS) {
      for (const ficha of [{ flujos: [f] }, { vertical: f }, { vertical: f, flujos: [f] }]) {
        expect(menuDespues(ficha, 'admin', false).map((p) => p.ruta), JSON.stringify(ficha)).toEqual(esperado[f]);
      }
    }
    // El operador de venta ve solo «Pedidos»; el de reservas, nada de flujo.
    expect(menuDespues({ flujos: ['venta'] }, 'oper', false)).toEqual([{ ruta: 'pedidos', titulo: 'Pedidos' }]);
    expect(menuDespues({ flujos: ['agendamiento'] }, 'oper', false)).toEqual([]);
    // El propietario de NovuChat ve «Captación» aunque no sea del negocio.
    expect(menuDespues({ flujos: ['onboarding'] }, null, true)).toEqual([{ ruta: 'captacion', titulo: 'Captación' }]);
    expect(menuDespues({ flujos: ['venta'] }, null, true)).toEqual([]);
  });

  it('la tabla FLUJOS que usa el Tablero y la suite del registro es la del 03/10', () => {
    expect(FLUJOS_DESPUES).toEqual(FLUJOS_ANTES);
  });
});

describe('H2b-5: lo que cambia a propósito, negando', () => {
  it('una ficha con `flujos` que no es lista CIERRA (antes caía a `vertical` y abría pestañas)', () => {
    const noListas: unknown[] = ['venta', null, {}, 3, true, 'agendamiento'];
    for (const flujos of noListas) {
      for (const vertical of ['venta', 'agendamiento', 'onboarding']) {
        const ficha = { flujos, vertical };
        // ANTES: con `flujos: null` o cadena la consola leía `vertical` y abría las pestañas del flujo.
        const antes = menuAntes(flujosAntes(ficha), 'admin', false);
        expect(antes.length, `antes: ${JSON.stringify(ficha)}`).toBeGreaterThan(0);
        // AHORA: nada de flujo, ni catálogo ni cobro; coincide con el registro y con las reglas.
        expect(menuDespues(ficha, 'admin', true), JSON.stringify(ficha)).toEqual([]);
        expect(flujosDespues(ficha), JSON.stringify(ficha)).toEqual([]);
        expect(cobroDespues(ficha), JSON.stringify(ficha)).toEqual({ tieneVenta: false, tieneAgenda: false, documento: null });
        expect(etiquetaDeCatalogoDe(modulosDe(ficha))).toBe('Catálogo');
      }
    }
  });

  it('con la clave `flujos` ausente la ficha sigue leyéndose por `vertical`; con `flujos: undefined` también', () => {
    expect(menuDespues({ vertical: 'venta' }, 'admin', false).map((p) => p.ruta)).toEqual(['pedidos', 'cobros', 'inventario', 'cobro']);
    expect(menuDespues({ flujos: undefined, vertical: 'venta' }, 'admin', false).map((p) => p.ruta))
      .toEqual(['pedidos', 'cobros', 'inventario', 'cobro']);
  });

  it('una ficha sin flujos reconocidos no abre nada de flujo; con vertical desconocido, tampoco', () => {
    for (const ficha of [{}, { flujos: [] }, { vertical: 'interno' }, { flujos: ['otro'] }, { flujos: ['toString'] }]) {
      expect(menuDespues(ficha, 'admin', true), JSON.stringify(ficha)).toEqual([]);
      expect(cobroDespues(ficha).documento, JSON.stringify(ficha)).toBeNull();
    }
    expect(menuDespues({} as Ficha, 'admin', true)).toEqual([]);
  });

  it('una ficha con `modulos` (lista) manda sobre sus flujos; un operador sin «pedidos» no ve nada', () => {
    const ficha = { flujos: ['venta'], modulos: ['agenda', 'cobros'] };
    expect(menuDespues(ficha, 'admin', false).map((p) => p.ruta)).toEqual(['agenda', 'cobros', 'cobro']);
    expect(menuDespues(ficha, 'oper', false)).toEqual([]);
    expect(cobroDespues(ficha).documento).toBe('agendamiento');
    // `modulos: []` explícito apaga todo, aunque la ficha diga venta.
    expect(menuDespues({ flujos: ['venta'], modulos: [] }, 'admin', true)).toEqual([]);
    // Un valor que no es lista no cuenta: se lee por los flujos.
    expect(menuDespues({ flujos: ['venta'], modulos: 'agenda' }, 'admin', false).map((p) => p.ruta))
      .toEqual(['pedidos', 'cobros', 'inventario', 'cobro']);
  });

  it('cada capacidad de la consola se enciende con SU módulo y con ningún otro (fichas con `modulos`)', () => {
    // Con flujos, «pedidos» e «inventario» siempre van juntos: solo una lista de módulos los separa.
    const campos = {
      conAgenda: 'agenda', conPedidos: 'pedidos', conVistaPrevia: 'catalogo-web', conCaptacion: 'captacion',
      conInventario: 'inventario',
    } as const;
    for (const [campo, modulo] of Object.entries(campos)) {
      for (const m of IDS_MODULOS) {
        const c = capacidadesDeConsola(modulosDe({ modulos: [m] }));
        expect(c[campo as keyof typeof campos], `${campo} con solo «${m}»`).toBe(m === modulo);
      }
    }
    const doc = (modulos: string[]) => capacidadesDeConsola(modulosDe({ modulos })).documentoCobro;
    expect(doc(['cobros', 'pedidos'])).toBe('venta');
    expect(doc(['cobros', 'agenda'])).toBe('agendamiento');
    expect(doc(['cobros', 'pedidos', 'agenda'])).toBe('venta');
    expect(doc(['pedidos', 'agenda'])).toBeNull();
    expect(doc(['cobros'])).toBeNull();
    expect(doc(['inventario', 'cobros'])).toBeNull();
    const etiqueta = (modulos: string[]) => capacidadesDeConsola(modulosDe({ modulos })).etiquetaCatalogo;
    expect(etiqueta(['agenda'])).toBe('Servicios');
    expect(etiqueta(['pedidos'])).toBe('Productos');
    expect(etiqueta(['agenda', 'pedidos'])).toBe('Catálogo');
    expect(etiqueta(['agenda', 'captacion'])).toBe('Catálogo');
  });

  it('el operador y los roles ajenos no ven pestañas de administrador (negativa de roles)', () => {
    for (const f of IDS_FLUJOS) {
      for (const rol of ['oper', 'ingesta', null]) {
        const rutas = menuDespues({ flujos: [f] }, rol, false).map((p) => p.ruta);
        expect(rutas.filter((r) => r !== 'pedidos'), `${f} ${rol}`).toEqual([]);
      }
    }
  });
});

describe('H2b-5: ninguna lista de flujos ni de pestañas queda escrita en la consola', () => {
  const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{])\/\/.*$/gm, '$1');
  const fuentes = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? fuentes(join(dir, e.name))
      : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : []));
  const ARCHIVOS = fuentes(WEB);
  const relativo = (a: string) => a.slice(WEB.length + 1);

  it('la fachada importa del registro y no escribe un solo id de flujo ni una ruta de pestaña', () => {
    const t = sinComentarios(readFileSync(join(WEB, 'central/lib/flujos.ts'), 'utf8'));
    expect(t).toMatch(/from '(\.\.\/)+functions\/src\/registro'/);
    expect(t).not.toMatch(/['"](agendamiento|venta|onboarding)['"]/);
    // Los ids de módulo solo aparecen dentro de `capacidadesDeConsola` (una consulta por pantalla).
    const fuera = t.replace(/export function capacidadesDeConsola[\s\S]*?\n}\n/, '');
    expect(fuera.length).toBeLessThan(t.length);
    for (const m of IDS_MODULOS) expect(fuera, `módulo ${m}`).not.toContain(`'${m}'`);
    for (const f of IDS_FLUJOS) {
      for (const p of FLUJOS_ANTES[f]!.pestanas) expect(t, `${f}/${p.ruta}`).not.toContain(`ruta: '${p.ruta}'`);
    }
  });

  /** Sin comentarios y con los espacios colapsados: la llamada exacta no depende del formato. */
  const normal = (t: string) => sinComentarios(t).replace(/\s+/g, ' ');
  const pantalla = (ruta: string) => normal(readFileSync(join(WEB, ruta), 'utf8'));

  // ---- Las pantallas llaman a las funciones de la fachada, con los argumentos y los campos correctos.
  // Nadie ejecuta el JSX en una prueba: estas guardas son la única red de la llamada, y cada una se
  // probó mutando la pantalla (descripción del PR). Un cambio de estilo que las rompa se corrige acá.
  it('App.tsx: el rol sale de rolEn, el propietario de la sesión, y las pestañas y el rótulo de la fachada', () => {
    const app = pantalla('App.tsx');
    expect(app).toContain('const rol = tenantId ? rolEn(permisos, tenantId) : null;');
    expect(app).toContain('const modulos = useModulos(tenantId);');
    // La llamada exacta: ni `propietario: false`, ni un rol fijo, ni otra lista de módulos.
    expect(app).toMatch(/\{tenantId && pestanasVisibles\(modulos \?\? \[\], \{ rol, propietario: permisos\.propietario \}\)\.map\(/);
    expect(app).toContain('<NavLink key={p.ruta} to={`/negocio/${tenantId}/${p.ruta}`}>{p.titulo}</NavLink>');
    expect(app).toContain('{tenantId && esAdminDelNegocio && modulos && <NavLink to={`/negocio/${tenantId}/catalogo`}>{etiquetaDeCatalogoDe(modulos)}</NavLink>}');
    expect(app).toContain("tramo === 'catalogo' ? etiquetaDeCatalogoDe(modulos ?? []) : TITULOS[tramo]");
    expect(app).not.toMatch(/\bFLUJOS\b/);
    expect(app).not.toMatch(/\.pestanas\b/);
    expect(app).not.toMatch(/etiquetaCatalogo\(/);
  });

  it('Cobro, Catálogo, Captación y Tablero: cada decisión sale de capacidadesDeConsola, por su campo', () => {
    const cobro = pantalla('modulos/cobros/Cobro.tsx');
    expect(cobro).toContain('const modulos = useModulos(tenantId);');
    expect(cobro).toContain('const capacidades = capacidadesDeConsola(modulos ?? []); const tieneVenta = capacidades.conPedidos; const tieneAgenda = capacidades.conAgenda;');
    expect(cobro).toContain('modulos === null ? null : capacidades.documentoCobro;');
    expect(cobro).toContain('if (modulos !== null && documento === null) {');
    expect(cobro).toContain('{tieneVenta && <ConfiguracionVertical tenantId={tenantId} vertical="venta" />}');
    expect(cobro).toContain('{tieneAgenda && <ConfiguracionVertical tenantId={tenantId} vertical="agendamiento" />}');

    const catalogo = pantalla('modulos/productos/Catalogo.tsx');
    expect(catalogo).toContain('const modulos = useModulos(tenantId) ?? []; const capacidades = capacidadesDeConsola(modulos); const conAgenda = capacidades.conAgenda;');
    expect(catalogo).toContain('const conVenta = capacidades.conVistaPrevia;');
    expect(catalogo).toContain('const titulo = capacidades.etiquetaCatalogo;');

    const captacion = pantalla('modulos/captacion/Captacion.tsx');
    expect(captacion).toContain('const modulos = useModulos(tenantId);');
    expect(captacion).toContain('if (modulos !== null && !capacidadesDeConsola(modulos).conCaptacion) {');

    // Inventario: la ruta lleva al inicio sin el módulo y no abre lecturas hasta saberlo (05/10).
    const inventario = pantalla('modulos/inventario/Inventario.tsx');
    expect(inventario).toContain('const modulos = useModulos(tenantId); if (modulos === null) return');
    expect(inventario).toContain('if (!capacidadesDeConsola(modulos).conInventario) return <Navigate to="/" replace />;');

    const tablero = pantalla('central/paginas/Tablero.tsx');
    expect(tablero).toContain('const modulos = useModulos(tenantId) ?? []; const nombreItems = capacidadesDeConsola(modulos).etiquetaCatalogo.toLowerCase();');
    // La cartera lista los flujos de cada ficha con el nombre del puente.
    expect(tablero).toContain('{flujosDe(n).map((f) => ( <span key={f} className="tag tag-outline">{FLUJOS[f].nombre}</span> ))}');
  });

  it('ninguna pantalla decide por un id de módulo con `.includes(...)`: lo hace la fachada', () => {
    const ids = IDS_MODULOS.join('|');
    const reg = new RegExp(`\\.includes\\(\\s*['"\`](${ids})['"\`]`);
    for (const a of ARCHIVOS) {
      if (relativo(a) === 'central/lib/flujos.ts') continue;
      expect(normal(readFileSync(a, 'utf8')), relativo(a)).not.toMatch(reg);
    }
  });

  // ---- Lo que queda con ids de flujo: listas que SOLO SE ACHICAN.
  it('los ids de flujo escritos (comillas simples, dobles o plantillas) solo sobreviven donde se declara, y solo bajan', () => {
    // Conocidos, con su porqué. Tope por archivo (`<=`): bajar es bueno y no rompe; subir, o un archivo nuevo, falla.
    //  - Configuracion.tsx: `flujos.includes('agendamiento'|'venta')`; el encargo H2b-5 pidió no tocarla.
    //  - Captacion.tsx: `FLUJOS_SUGERIDOS` es el catálogo de ofertas que el asesor sugiere a un prospecto
    //    (no los flujos que el negocio tiene) y `config/onboarding` es el nombre de un documento.
    //  - Cobro.tsx: `config/venta` y `config/agendamiento` son nombres de documento (`vertical=` de
    //    `ConfiguracionVertical`, que declara los campos de cada uno), no una lista de flujos.
    //  - ContadoresDeCobro.tsx (#407, llegó con main): `getDoc(.../config/venta)` es la lectura de UN documento
    //    (`cobroReal`), no una lista ni una decisión por flujo. Límite conocido, fuera de H2b-5: «Cobros» también
    //    la abre un negocio de reservas, cuyo QR vive en `config/agendamiento`; derivar el documento con
    //    `capacidadesDeConsola(...).documentoCobro` cambiaría lo que ese negocio ve y es de su dueño (#407).
    const TOPE: Record<string, number> = {
      'central/paginas/Configuracion.tsx': 2,
      'modulos/captacion/Captacion.tsx': 6,
      'modulos/cobros/Cobro.tsx': 10,
      'modulos/cobros/ContadoresDeCobro.tsx': 1,
    };
    const hallados: Record<string, number> = {};
    for (const a of ARCHIVOS) {
      if (relativo(a) === 'central/lib/flujos.ts') continue;
      const n = (sinComentarios(readFileSync(a, 'utf8')).match(/['"`](agendamiento|venta|onboarding)['"`]/g) ?? []).length;
      if (n > 0) hallados[relativo(a)] = n;
    }
    for (const [archivo, n] of Object.entries(hallados)) {
      expect(TOPE[archivo], `${archivo}: archivo nuevo con ids de flujo`).toBeDefined();
      expect(n, `${archivo}: más ids de flujo que el tope`).toBeLessThanOrEqual(TOPE[archivo] as number);
    }
  });

  it('`includes` con un id de flujo (con o sin punto delante, y en plantilla) solo en Configuracion.tsx', () => {
    const reg = /includes\(\s*['"`](agendamiento|venta|onboarding)['"`]/;
    const donde = ARCHIVOS.filter((a) => relativo(a) !== 'central/lib/flujos.ts'
      && reg.test(sinComentarios(readFileSync(a, 'utf8')))).map(relativo);
    expect(donde.filter((d) => d !== 'central/paginas/Configuracion.tsx')).toEqual([]);
  });

  it('`useFlujos` solo lo importa Configuracion.tsx, y la lista solo se achica', () => {
    const TOPE = ['central/paginas/Configuracion.tsx'];
    const importan = ARCHIVOS.filter((a) => relativo(a) !== 'central/lib/flujos.ts'
      && /\buseFlujos\b/.test(sinComentarios(readFileSync(a, 'utf8')))).map(relativo);
    expect(importan.filter((i) => !TOPE.includes(i)), 'archivo nuevo que usa useFlujos: que use useModulos').toEqual([]);
  });

  it('ninguna pantalla lee `vertical` ni `flujos` de una ficha por su cuenta', () => {
    for (const a of ARCHIVOS) {
      const t = sinComentarios(readFileSync(a, 'utf8'));
      if (relativo(a) === 'central/lib/flujos.ts') continue;
      expect(t, relativo(a)).not.toMatch(/\.(vertical|flujos)\b(?!\s*\()/);
      expect(t, relativo(a)).not.toMatch(/\[['"](vertical|flujos)['"]\]/);
    }
  });

  it('el nombre del puente es el que la cartera muestra', () => {
    for (const f of IDS_FLUJOS) expect(FLUJOS_DESPUES[f].nombre).toBe(PUENTE_DE_FLUJOS[f].nombre);
  });
});
