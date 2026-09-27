/**
 * =============================================================================
 * LA FRONTERA DE ZONAS (F2, PR 2) — prueba pura, sin emulador
 * =============================================================================
 *
 * `Analisis/41` §1 y §8.2, y CLAUDE.md («Dependencias hacia abajo, nunca hacia
 * arriba»): lee los `import` de cada archivo con zona y falla si una zona
 * importa hacia arriba (registro < core < central < plataforma < módulo <
 * coordinador < tenants) o si un módulo importa a otro que no declara en
 * `dependeDe`. Sin esta prueba en verde no se fusiona nada de F2 en adelante.
 *
 * La regla vive en `frontera.ts`, que usa también `scripts/medir-zonas.mjs`:
 * la medición que se cita en cada informe y esta prueba no pueden contar
 * distinto.
 *
 * LA DEUDA CONOCIDA. El código de hoy ya tiene cruces: el plano los esperaba
 * (el coordinador de turno de F3 existe para deshacer los de `ingesta.ts`).
 * Están abajo, uno por uno, con lo que los saca. La lista solo se ACHICA:
 *   - un cruce que no está en la lista falla (es nuevo);
 *   - una entrada cuyo cruce ya no existe falla (se arregló o se movió el
 *     archivo: se saca la entrada, o se corrige su ruta si solo se movió).
 * Lo mismo con los archivos de código sin zona: el número es EXACTO, y cada
 * tanda de F2 lo baja en el mismo PR que mueve los archivos.
 *
 * Y la regla se prueba NEGANDO, con un árbol inventado: sin esa parte, un
 * lector de imports que no ve nada daría verde para siempre.
 */
import { describe, expect, it } from 'vitest';
import { IDS_MODULOS, REGISTRO } from '../../functions/src/registro.ts';
import {
  INDICE_DE_FUNCTIONS, analizar, claveDeCruce, esPrueba, importsDe, listarRaices, motivoDeCruce,
  zonaDeCodigo, zonaPorCarpeta, type Arbol,
} from './frontera.ts';

const F = 'admin/functions/src/';
const W = 'admin/web/src/';

// ------------------------------------------------------------------ la deuda
const COORDINADOR_F3 = 'Lo deshace el coordinador de turno con ganchos (F3): nadie importa ingesta.ts';
const PRUEBA_DE_PLATAFORMA = 'Prueba de una pantalla de Plataforma guardada en pruebas/central/: se mueve a pruebas/plataforma/ en F2';

/** Cruces que existían el 26/09/2026, con lo que los saca. Solo se achica. */
const DEUDA_CONOCIDA: readonly { desde: string; hacia: string; porque: string }[] = [
  { desde: `${F}catalogoWeb.ts`, hacia: `${F}ingesta.ts`, porque: COORDINADOR_F3 },
  { desde: `${F}cierres.ts`, hacia: `${F}ingesta.ts`, porque: COORDINADOR_F3 },
  { desde: `${F}cobranza.ts`, hacia: `${F}ingesta.ts`, porque: COORDINADOR_F3 },
  { desde: `${F}cobroPrepago.ts`, hacia: `${F}ingesta.ts`, porque: COORDINADOR_F3 },
  { desde: `${F}index.ts`, hacia: `${F}ingesta.ts`, porque: COORDINADOR_F3 },
  { desde: `${F}pagos.ts`, hacia: `${F}ingesta.ts`, porque: COORDINADOR_F3 },
  { desde: `${F}seguimientos.ts`, hacia: `${F}ingesta.ts`, porque: COORDINADOR_F3 },
  { desde: `${F}sena.ts`, hacia: `${F}ingesta.ts`, porque: COORDINADOR_F3 },
  { desde: `${F}captacion.ts`, hacia: `${F}imagenCatalogo.ts`,
    porque: 'Captación usa la imagen del catálogo (Productos) sin declararlo: dependeDe o la pieza baja a Central, al mover captación' },
  { desde: `${F}verificarCampanas.ts`, hacia: `${F}imagenCatalogo.ts`,
    porque: 'Campañas usa la imagen del catálogo (Productos) sin declararlo: dependeDe o la pieza baja a Central, al mover campañas' },
  { desde: `${F}verificarComportamiento.ts`, hacia: `${F}imagenCatalogo.ts`,
    porque: 'Central usa una pieza de Productos: la verificación de imagen baja a Central al mover productos' },
  { desde: `${F}catalogoWeb.ts`, hacia: `${F}inventario.ts`,
    porque: 'Catálogo web lee el stock de Inventario sin declararlo: dependeDe o gancho, al mover catálogo web' },
  { desde: `${F}cobroVenta.ts`, hacia: `${F}sena.ts`,
    porque: 'Solo tipo: Cobros toma un tipo de la seña (Agenda), y es Agenda la que depende de Cobros; el tipo sube a Cobros al moverlos' },
  { desde: `${F}prompt.ts`, hacia: `${F}saneo.ts`,
    porque: 'El prompt (Core) usa el saneo (Central): lo que usa baja a Core al mover prompt.ts' },
  { desde: `${W}paginas/Captacion.tsx`, hacia: `${W}lib/csv.ts`,
    porque: 'csv.ts es un servicio compartido (nota del inventario): pasa a Central al mover productos' },
  { desde: `${W}plataforma/lib/negocios.ts`, hacia: `${W}lib/archivoPlanes.ts`,
    porque: 'Plataforma lee el archivo de planes de Captación: la pieza compartida baja a Central al mover captación' },
  { desde: 'admin/pruebas/central/contrato-f1b-consola.test.ts', hacia: `${W}plataforma/componentes/PanelEjes.tsx`, porque: PRUEBA_DE_PLATAFORMA },
  { desde: 'admin/pruebas/central/contrato-f1b-consola.test.ts', hacia: `${W}plataforma/lib/negocios.ts`, porque: PRUEBA_DE_PLATAFORMA },
  { desde: 'admin/pruebas/central/copia-por-contrato-consola.test.ts', hacia: `${W}plataforma/componentes/PanelEjes.tsx`, porque: PRUEBA_DE_PLATAFORMA },
];

/**
 * Archivos de código (fuera de `admin/pruebas/`) sin zona, medidos el
 * 26/09/2026. EXACTO: el PR que ubica archivos lo baja; uno que agrega un
 * archivo sin zona no pasa.
 */
const SIN_ZONA = 42;

// ------------------------------------------------------------ el árbol real
const ARCHIVOS = listarRaices();
const REAL = analizar(ARCHIVOS);

describe('la frontera sobre el código de hoy', () => {
  it('ninguna importación hacia arriba fuera de la deuda conocida', () => {
    const conocidas = new Set(DEUDA_CONOCIDA.map(claveDeCruce));
    const nuevas = REAL.cruces.filter((c) => !conocidas.has(claveDeCruce(c)))
      .map((c) => `${claveDeCruce(c)}  (${c.motivo}${c.soloTipo ? ', solo tipo' : ''})`);
    expect(nuevas, 'Importación hacia arriba nueva: se corta (la pieza baja de zona) o se declara en dependeDe; no se agrega a la deuda').toEqual([]);
  });

  it('la deuda solo se achica: cada entrada sigue existiendo', () => {
    const vivas = new Set(REAL.cruces.map(claveDeCruce));
    const saldadas = DEUDA_CONOCIDA.map(claveDeCruce).filter((k) => !vivas.has(k));
    expect(saldadas, 'Estos cruces ya no existen: sacar la entrada (o corregir su ruta si el archivo solo se movió)').toEqual([]);
  });

  it('la deuda no tiene entradas repetidas y cada una dice qué la saca', () => {
    const claves = DEUDA_CONOCIDA.map(claveDeCruce);
    expect(new Set(claves).size).toBe(claves.length);
    for (const d of DEUDA_CONOCIDA) expect(d.porque.length, claveDeCruce(d)).toBeGreaterThan(20);
  });

  it('todo import relativo lleva a un archivo (si no, el lector no ve el cruce)', () => {
    expect(REAL.sinResolver).toEqual([]);
  });

  it(`los archivos de código sin zona son exactamente ${SIN_ZONA}`, () => {
    const sinZona = ARCHIVOS.filter((a) => !esPrueba(a) && !zonaDeCodigo(a));
    expect(sinZona.length, `Sin zona hoy:\n${sinZona.join('\n')}\n(si bajó, se baja SIN_ZONA en este PR; si subió, el archivo nuevo va a una carpeta de zona)`).toBe(SIN_ZONA);
  });

  it('una carpeta modulos/<m>/ solo existe para un módulo del registro', () => {
    const ajenos = ARCHIVOS.map((a) => zonaPorCarpeta(a)).filter((z) => z?.zona === 'modulo')
      .map((z) => z!.modulo!).filter((m) => !(IDS_MODULOS as readonly string[]).includes(m));
    expect([...new Set(ajenos)]).toEqual([]);
  });

  it('el coordinador de turno no se pierde al moverlo (sigue habiendo uno)', () => {
    expect(ARCHIVOS.some((a) => zonaDeCodigo(a)?.zona === 'coordinador')).toBe(true);
  });
});

// ------------------------------------------------------- la regla, negando
/**
 * Un árbol inventado: rutas en carpetas de zona que el inventario no nombra.
 * Los textos se escriben con IMPORT, EXPORT, FROM y REQUIRE en mayúsculas y
 * se pasan a minúsculas al leerlos: escritos tal cual, el lector los vería en
 * ESTE archivo y los tomaría por imports suyos.
 */
const codigo = (t: string): string => t.replace(/\b(IMPORT|EXPORT|FROM|REQUIRE)\b/g, (p) => p.toLowerCase());
function arbolDe(archivos: Record<string, string>): Arbol {
  return { leer: (a) => codigo(archivos[a] ?? ''), existe: (a) => a in archivos };
}
const cruces = (archivos: Record<string, string>) =>
  analizar(Object.keys(archivos), zonaDeCodigo, arbolDe(archivos));

describe('la regla de la frontera (árbol inventado)', () => {
  const CORE = `${F}core/a.ts`;
  const CENTRAL = `${F}central/b.ts`;
  const PLATAFORMA = `${F}plataforma/c.ts`;

  it('Core no importa de Central, y Central sí de Core', () => {
    const r = cruces({ [CORE]: "IMPORT { b } FROM '../central/b';", [CENTRAL]: "IMPORT { a } FROM '../core/a.js';" });
    expect(r.cruces.map(claveDeCruce)).toEqual([`${CORE} → ${CENTRAL}`]);
    expect(r.cruces[0].motivo).toBe('core → central');
  });

  it('Central no importa de Plataforma, ni Plataforma de un módulo', () => {
    const r = cruces({
      [CENTRAL]: "IMPORT { c } FROM '../plataforma/c';",
      [PLATAFORMA]: "IMPORT { x } FROM '../modulos/agenda/x';",
      [`${F}modulos/agenda/x.ts`]: '',
    });
    expect(r.cruces.map((c) => c.motivo)).toEqual(['central → plataforma', 'plataforma → modulo:agenda']);
  });

  it('un módulo importa a otro solo si lo declara en dependeDe (también indirecto)', () => {
    const conDependencia = REGISTRO.find((m) => m.dependeDe.length > 0)!;
    const declarado = conDependencia.dependeDe[0];
    const sinDependencia = REGISTRO.find((m) => m.modulo !== conDependencia.modulo
      && !m.dependeDe.includes(conDependencia.modulo) && !conDependencia.dependeDe.includes(m.modulo)
      && m.dependeDe.length === 0)!;
    const desde = `${F}modulos/${conDependencia.modulo}/a.ts`;
    const r = cruces({
      [desde]: `IMPORT { b } FROM '../${declarado}/b';\nIMPORT { c } FROM '../${sinDependencia.modulo}/c';`,
      [`${F}modulos/${declarado}/b.ts`]: '',
      [`${F}modulos/${sinDependencia.modulo}/c.ts`]: '',
    });
    expect(r.cruces.map((c) => c.motivo)).toEqual([`módulo sin dependeDe (${conDependencia.modulo} → ${sinDependencia.modulo})`]);
    // Indirecto: catalogo-web → pedidos → productos.
    expect(motivoDeCruce({ zona: 'modulo', modulo: 'catalogo-web', destino: '' }, { zona: 'modulo', modulo: 'productos', destino: '' })).toBeNull();
    // Y al revés, no: que A dependa de B no deja a B importar de A.
    expect(motivoDeCruce({ zona: 'modulo', modulo: declarado, destino: '' }, { zona: 'modulo', modulo: conDependencia.modulo, destino: '' }))
      .toMatch(/módulo sin dependeDe/);
  });

  it('todo el mundo lee el registro, y el registro no importa a nadie', () => {
    const r = cruces({
      [CORE]: "IMPORT { REGISTRO } FROM '../registro';",
      [`${F}registro.ts`]: "IMPORT { a } FROM './core/a';",
    });
    expect(r.cruces.map((c) => c.motivo)).toEqual(['registro → core']);
  });

  it('los tenants no son de nadie: ninguna zona importa de scripts/datos/', () => {
    const r = cruces({
      'admin/scripts/plataforma/alta.mjs': "IMPORT { d } FROM '../datos/bellido.mjs';",
      'admin/scripts/datos/bellido.mjs': "IMPORT { c } FROM '../plataforma/alta.mjs';",
    });
    expect(r.cruces.map((c) => c.motivo)).toEqual(['plataforma → tenants']);
  });

  it('ve todas las formas de importar: tipo, varias líneas, reexportación, dinámico y require', () => {
    const r = cruces({
      [CORE]: [
        "IMPORT type { T } FROM '../central/b';",
        "IMPORT {\n  x,\n  y,\n} FROM '../central/c';",
        "EXPORT * FROM '../central/d';",
        "const m = await IMPORT('../central/e');",
        "const n = REQUIRE('../central/f');",
        "IMPORT '../central/g';",
      ].join('\n'),
      ...Object.fromEntries(['b', 'c', 'd', 'e', 'f', 'g'].map((n) => [`${F}central/${n}.ts`, ''])),
    });
    // En el orden de los patrones: `import|export … from`, el import suelto, el dinámico y require.
    expect(r.cruces.map((c) => c.hacia.slice(-4))).toEqual(['b.ts', 'c.ts', 'd.ts', 'g.ts', 'e.ts', 'f.ts']);
    expect(r.cruces.find((c) => c.hacia.endsWith('b.ts'))!.soloTipo).toBe(true);
  });

  it('un import comentado no cuenta, y una URL dentro de un texto no es comentario', () => {
    const r = cruces({
      [CORE]: "// IMPORT { b } FROM '../central/b';\n/* IMPORT { c } FROM '../central/c'; */\nconst u = 'https://x.y'; IMPORT { d } FROM '../central/d';",
      [`${F}central/b.ts`]: '', [`${F}central/c.ts`]: '', [`${F}central/d.ts`]: '',
    });
    expect(r.cruces.map((c) => c.hacia)).toEqual([`${F}central/d.ts`]);
  });

  it('un import relativo que no lleva a nada se informa, no se ignora', () => {
    const r = cruces({ [CORE]: "IMPORT { b } FROM '../central/no-existe';" });
    expect(r.sinResolver).toEqual([{ desde: CORE, especificador: '../central/no-existe' }]);
  });

  it('los scripts que importan las Functions compiladas dependen de su fuente', () => {
    expect(importsDe('admin/scripts/migrar-prepago.mjs').map((i) => i.destino))
      .toEqual(expect.arrayContaining([`${F}prepago.ts`, `${F}planes.ts`]));
  });

  it('index.ts: sus reexportaciones no cuentan; un import suyo sí', () => {
    const r = cruces({
      [INDICE_DE_FUNCTIONS]: "EXPORT { x } FROM './modulos/agenda/x';\nIMPORT { y } FROM './modulos/agenda/y';",
      [`${F}modulos/agenda/x.ts`]: '', [`${F}modulos/agenda/y.ts`]: '',
    });
    // index.ts es Plataforma (inventario §5): importar un módulo es subir.
    expect(r.cruces.map((c) => c.hacia)).toEqual([`${F}modulos/agenda/y.ts`]);
  });

  it('una prueba en carpeta de zona sigue la misma regla, salvo llamar a index.ts', () => {
    const r = cruces({
      'admin/pruebas/core/p.test.ts': "IMPORT { b } FROM '../../functions/src/central/b';\nIMPORT * as f FROM '../../functions/src/index';",
      'admin/pruebas/central/q.test.ts': "IMPORT { a } FROM '../../functions/src/core/a';",
      [CENTRAL]: '', [CORE]: '', [INDICE_DE_FUNCTIONS]: '',
    });
    expect(r.cruces.map(claveDeCruce)).toEqual([`admin/pruebas/core/p.test.ts → ${CENTRAL}`]);
  });

  it('la zona sale de la carpeta', () => {
    expect(zonaPorCarpeta(`${W}modulos/agenda/Agenda.tsx`)).toMatchObject({ zona: 'modulo', modulo: 'agenda' });
    expect(zonaPorCarpeta('Flujos/src/core/medios/a.js')).toMatchObject({ zona: 'core' });
    expect(zonaPorCarpeta('admin/scripts/plataforma/alta.mjs')).toMatchObject({ zona: 'plataforma' });
    expect(zonaPorCarpeta('admin/scripts/datos/x.mjs')).toMatchObject({ zona: 'tenants' });
    expect(zonaPorCarpeta(`${F}registro.ts`)).toMatchObject({ zona: 'registro' });
    // Un archivo suelto en la raíz, o una carpeta que no es de zona, no tiene zona por carpeta.
    expect(zonaPorCarpeta(`${F}suelto.ts`)).toBeNull();
    expect(zonaPorCarpeta(`${W}componentes/Marca.tsx`)).toBeNull();
    expect(zonaPorCarpeta(`${F}modulos/suelto.ts`)).toBeNull();
  });
});
