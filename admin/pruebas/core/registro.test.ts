/**
 * =============================================================================
 * EL REGISTRO CONTRA EL CÓDIGO DE HOY (F2, PR 1) — prueba pura, sin emulador
 * =============================================================================
 *
 * `functions/src/registro.ts` todavía no lo importa nadie. Esta suite comprueba
 * que dice la verdad sobre el código que YA existe, sin mover nada: que las
 * pestañas, los documentos de configuración, las colecciones, los límites, las
 * herramientas y las Functions que declara cada manifiesto son los que hoy
 * están en la consola, en `firestore.rules`, en `planes.ts`, en los flujos de
 * n8n y en `index.ts`; y que las siete copias de la lista de flujos
 * (`Analisis/41` §3.3) coinciden con el puente `PUENTE_DE_FLUJOS`.
 *
 * Cuando F2 mueva un archivo o F3 cambie una copia por una lectura del
 * registro, esta prueba es la que dice si el registro sigue siendo cierto. Lo
 * que hoy es una incoherencia CONOCIDA del código (y no un error del registro)
 * está en una lista con nombre y comentario, y esas listas solo pueden
 * achicarse: si el código se arregla, la prueba pide sacar la entrada.
 *
 * Es pura: lee archivos e importa módulos que no abren Firebase (`index.ts` se
 * importa igual que en `region-y-cuenta.test.ts`, con GCLOUD_PROJECT de
 * vitest.config.ts). La consola se importa con `core/lib/firebase` sustituido, para
 * no inicializar una app de Firebase.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../web/src/core/lib/firebase', () => ({ db: {} }));

import {
  IDS_FLUJOS, IDS_MODULOS, MODULOS_COMUNES_HOY, PUENTE_DE_FLUJOS, REGISTRO, carpetasDe, documentoDeCobro,
  documentoDeFlujo, esFlujo, esModulo, etiquetaDeCatalogo, flujosDeFicha, manifiestoDe, modulosDeFicha, modulosDeFlujos, pestanasDe, tieneModulo,
  type FichaConCapacidades, type IdFlujo, type IdModulo, type Manifiesto, type Pestana,
} from '../../functions/src/registro.ts';
import { VERTICALES_CONOCIDOS, documentoDeVertical } from '../../functions/src/core/prompt/prompt.ts';
import { PLANES } from '../../functions/src/central/cuenta/planes.ts';
import { zonaDeCodigo } from '../frontera/frontera.ts';

process.env['GCLOUD_PROJECT'] ??= 'demo-test';
const indice = (await import('../../functions/src/index.ts')) as Record<string, unknown>;

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(aqui, '..', '..', '..');
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');

const MANIFIESTOS = REGISTRO as readonly Manifiesto[];
const FLUJOS_HOY = Object.keys(PUENTE_DE_FLUJOS) as (keyof typeof PUENTE_DE_FLUJOS)[];
const comunes = MODULOS_COMUNES_HOY as readonly IdModulo[];
const ordenado = <T>(xs: Iterable<T>) => [...xs].sort();

// ------------------------------------------------- la consola, congelada al 03/10
/**
 * H2b-0: lo que `web/src/central/lib/flujos.ts` declaraba el 03/10/2026, copiado
 * LITERAL de `origin/main` (sin comentarios). Es la base contra la que se compara
 * el registro: así `flujos.ts` puede convertirse en una fachada derivada de
 * `registro.ts` sin que esta suite se rompa ni se la reescriba en cada PR de H2b.
 * Mientras `flujos.ts` conserve sus literales, la sección 8 comprueba que siguen
 * siendo esta fixture. No se edita: lo que el registro cambie a propósito se
 * decide en un PR aparte, con la coordinadora.
 */
type PestanaDeConsola = { ruta: string; etiqueta: string; roles?: ('admin' | 'oper')[]; tambienPropietario?: boolean };
const PESTANAS_DE_LA_CONSOLA_AL_03_10: Record<IdFlujo, {
  nombre: string; pestanas: PestanaDeConsola[]; catalogo: string; documento: string;
}> = {
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
      { ruta: 'cobros', etiqueta: 'Cobros', roles: ['admin', 'oper'] },
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
/** Alias corto: la consola de hoy es la fixture. */
const FLUJOS = PESTANAS_DE_LA_CONSOLA_AL_03_10;
/** `esFlujo`, `flujosDe` y `etiquetaCatalogo` de la consola al 03/10, sobre la fixture. */
const esFlujoConsola = (v: unknown): boolean =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(FLUJOS, v);
const flujosDe = (ficha: { flujos?: unknown; vertical?: unknown } | undefined): string[] => {
  if (!ficha) return [];
  if (Array.isArray(ficha.flujos)) return ficha.flujos.filter(esFlujoConsola) as string[];
  return esFlujoConsola(ficha.vertical) ? [ficha.vertical as string] : [];
};
const etiquetaCatalogo = (flujos: string[]): string => {
  const nombres = new Set(flujos.map((f) => FLUJOS[f as IdFlujo].catalogo));
  return nombres.size === 1 ? [...nombres][0] as string : 'Catálogo';
};
/** `documentoQueCobra` de `modulos/cobros/cobro.ts` (líneas 174-183 al 03/10), copiada LITERAL. */
const documentoQueCobraHoy = (ficha: { get(campo: string): unknown }): 'venta' | 'agendamiento' | null => {
  const lista = ficha.get('flujos');
  const flujos = Array.isArray(lista) ? lista.map(String) : [String(ficha.get('vertical') ?? '')];
  if (flujos.includes('venta')) return 'venta';
  if (flujos.includes('agendamiento')) return 'agendamiento';
  return null;
};
/** ¿El código importa `simbolo` POR SU NOMBRE de `registro`? (El alias `X as Y` no cuenta.) */
const importaSimbolo = (codigo: string, simbolo: string) =>
  new RegExp(`import\\s*(?:type\\s*)?\\{[^}]*\\b${simbolo}\\b[^}]*\\}\\s*from\\s*['"][^'"]*/registro(?:\\.[tj]s)?['"]`).test(codigo);

// ------------------------------------------------------------ lectura de textos
/**
 * Todos los .ts de una carpeta, en subcarpetas también (F2, tanda cero): un
 * archivo que F2 mueve a `central/cuenta/` o `modulos/<m>/` no puede dejar de
 * revisarse porque el recorrido miraba un solo nivel.
 */
const tsDe = (dir: string): string[] => readdirSync(join(RAIZ, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? tsDe(`${dir}/${e.name}`) : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : []));
/** Sin comentarios `//` y `/* *\/`. Un `//` pegado a `:` (una URL) no es comentario. */
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;])\/\/.*$/gm, '$1');

const REGLAS = sinComentarios(leer('admin/firestore.rules'));
const STORAGE = sinComentarios(leer('admin/storage.rules'));
const APP = leer('admin/web/src/App.tsx');
const TEXTO_REGISTRO = leer('admin/functions/src/registro.ts');

/** Desde `desde` (un `{`), hasta su `}` pareja. Devuelve el texto entre llaves. */
function hastaLaLlave(texto: string, desde: number): { cuerpo: string; fin: number } {
  let nivel = 0;
  for (let i = desde; i < texto.length; i++) {
    if (texto[i] === '{') nivel++;
    else if (texto[i] === '}' && --nivel === 0) return { cuerpo: texto.slice(desde + 1, i), fin: i };
  }
  throw new Error('llaves sin cerrar');
}

function cuerpoDeFuncion(texto: string, nombre: string): string {
  const i = texto.indexOf(`function ${nombre}(`);
  if (i < 0) throw new Error(`No existe la función ${nombre} en las reglas`);
  return hastaLaLlave(texto, texto.indexOf('{', i)).cuerpo;
}

/**
 * Los módulos que son SOLO de un flujo según el puente (ni comunes ni de otro flujo): lo que una capacidad de las
 * reglas puede nombrar para decir «este flujo».
 */
const propiosDe = (f: IdFlujo): string[] => (PUENTE_DE_FLUJOS[f].modulos as readonly string[]).filter((m) =>
  !(MODULOS_COMUNES_HOY as readonly string[]).includes(m)
  && !FLUJOS_HOY.some((o) => o !== f && (PUENTE_DE_FLUJOS[o].modulos as readonly string[]).includes(m)));
/**
 * Las dos únicas formas que una capacidad (`tieneAgenda`, `tieneCobro`, `tieneOnboarding`) puede tener en las
 * reglas, con el cuerpo ENTERO y nada más:
 *   hoy:      `return tieneFlujo(tenantId, '<flujo>');`
 *   derivada: `return tieneModulo(tenantId, '<módulo propio del flujo>');`   (la que enchufan los PR de H2b)
 * Cualquier otro cuerpo (`return true;`, `flujosTenant(tenantId).size() > 0`) es una capacidad rota.
 */
const FORMA_LITERAL = /^\s*return tieneFlujo\(tenantId, '(\w+)'\);\s*$/;
const FORMA_DERIVADA = /^\s*return tieneModulo\(tenantId, '([\w-]+)'\);\s*$/;
const MODULO_EN_REGLAS = /\btieneModulo\(tenantId,\s*'([\w-]+)'\)/g;
const MODULO_COMUN_EN_REGLAS = /\btieneModuloComun\(tenantId,\s*'([\w-]+)'\)/g;
/** El flujo que abre una capacidad según su cuerpo en las reglas, o null si el cuerpo no es ninguna de las dos formas. */
function flujoQueAbre(reglas: string, capacidad: string): IdFlujo | null {
  const cuerpo = cuerpoDeFuncion(reglas, capacidad);
  const literal = FORMA_LITERAL.exec(cuerpo);
  if (literal) return esFlujo(literal[1]) ? literal[1] as IdFlujo : null;
  const modulo = FORMA_DERIVADA.exec(cuerpo)?.[1];
  return modulo ? FLUJOS_HOY.find((f) => propiosDe(f).includes(modulo)) ?? null : null;
}

/** La primera lista blanca de una validación: `soloCampos([…])`, `hasOnly([…])` o `clavesPermitidas = […]`. */
function listaBlanca(cuerpo: string): string[] {
  const m = /soloCampos\(\[|hasOnly\(\[|clavesPermitidas\s*=\s*\[/.exec(cuerpo);
  if (!m) throw new Error('sin lista blanca');
  const inicio = m.index + m[0].length;
  const lista = cuerpo.slice(inicio, cuerpo.indexOf(']', inicio));
  return [...lista.matchAll(/'([^']+)'/g)].map((x) => x[1] as string);
}

/** El bloque `match /<segmento>/{x} { … }` a partir de `desde`, o null. */
function bloqueMatch(texto: string, segmento: string, desde = 0): { cuerpo: string; inicio: number; fin: number } | null {
  const re = new RegExp(`match /${segmento}/\\{[^}]*\\}\\s*\\{`, 'g');
  re.lastIndex = desde;
  const m = re.exec(texto);
  if (!m) return null;
  const llave = m.index + m[0].length - 1;
  const { cuerpo, fin } = hastaLaLlave(texto, llave);
  return { cuerpo, inicio: m.index, fin };
}

/** El cuerpo de un bloque sin los `match` anidados, para leer SUS `allow`. */
function sinAnidados(cuerpo: string): string {
  let resto = cuerpo;
  for (;;) {
    const i = resto.search(/match \//);
    if (i < 0) return resto;
    const { fin } = hastaLaLlave(resto, resto.indexOf('{', resto.indexOf('}', i) + 1));
    resto = resto.slice(0, i) + resto.slice(fin + 1);
  }
}

const TENANTS = bloqueMatch(REGLAS, 'tenants');
if (!TENANTS) throw new Error('firestore.rules sin match /tenants/');

/**
 * El bloque de reglas de una colección del tenant (`padre/hija` es una
 * subcolección anidada; si `hija` no es un `match`, es un documento con nombre
 * de la colección padre, como `contadores/catalogo`).
 */
function bloqueDeColeccion(ruta: string): string | null {
  const [padre, hija] = ruta.split('/') as [string, string | undefined];
  const b = bloqueMatch(TENANTS!.cuerpo, padre);
  if (!b) return null;
  if (!hija) return b.cuerpo;
  const anidado = bloqueMatch(b.cuerpo, hija);
  if (anidado) return anidado.cuerpo;
  return new RegExp(`== '${hija}'`).test(b.cuerpo) ? b.cuerpo : null;
}

type Escritura = 'solo-servidor' | 'exige-capacidad' | 'sin-exigir';
/** Qué exigen los `allow` de escritura de un bloque (sin los anidados). */
function escrituraDe(cuerpo: string, modulosPermitidos: readonly string[] = []): Escritura {
  const condiciones = [...sinAnidados(cuerpo).matchAll(/allow\s+([\w,\s]+?)\s*:\s*if\s+([\s\S]*?);/g)]
    .filter((m) => /create|update|delete|write/.test(m[1] as string))
    .map((m) => (m[2] as string).trim())
    .filter((c) => c !== 'false');
  if (condiciones.length === 0) return 'solo-servidor';
  /**
   * `tieneModulo(tenantId, 'm')` solo cuenta si es UN TÉRMINO de la cadena de `&&` (ni dentro de un paréntesis ni
   * con `||` al lado) y `m` es el módulo dueño de la colección o un módulo propio de su flujo.
   */
  const exigeModulo = (c: string) => [...c.matchAll(/(?:^|&&)\s*tieneModulo\(tenantId,\s*'([\w-]+)'\)\s*(?=&&|$)/g)]
    .some((m) => modulosPermitidos.includes(m[1] as string));
  /** Lo mismo para `tieneModuloComun(tenantId, 'm')` (módulos comunes: productos, campanas), con `m` del módulo de la colección. */
  const exigeModuloComun = (c: string) => [...c.matchAll(/(?:^|&&)\s*tieneModuloComun\(tenantId,\s*'([\w-]+)'\)\s*(?=&&|$)/g)]
    .some((m) => modulosPermitidos.includes(m[1] as string) && (MODULOS_COMUNES_HOY as readonly string[]).includes(m[1] as string));
  return condiciones.every((c) => /\btiene\w+\(tenantId\)/.test(c) || exigeModulo(c) || exigeModuloComun(c)) ? 'exige-capacidad' : 'sin-exigir';
}

// ======================================================================= 1
describe('1. estructura del registro', () => {
  it('los ids son únicos y el registro sigue el orden de IDS_MODULOS', () => {
    expect(new Set(IDS_MODULOS).size).toBe(IDS_MODULOS.length);
    expect(MANIFIESTOS.map((m) => m.modulo)).toEqual([...IDS_MODULOS]);
  });

  it('dependeDe es válido, acíclico y cada dependencia aparece antes', () => {
    MANIFIESTOS.forEach((m, i) => {
      for (const d of m.dependeDe) {
        expect(esModulo(d), `${m.modulo} depende de «${d}», que no es un módulo`).toBe(true);
        expect(IDS_MODULOS.indexOf(d), `${m.modulo} depende de ${d}, que aparece después`).toBeLessThan(i);
      }
    });
  });

  it('catálogo web declara su dependencia de inventario, y no al revés (sin ciclo)', () => {
    const porId = (id: string) => MANIFIESTOS.find((m) => m.modulo === id)!;
    expect(porId('catalogo-web').dependeDe).toContain('inventario');
    expect(porId('inventario').dependeDe).not.toContain('catalogo-web');
  });

  it('versión entera desde 1 y cero mensajes por conversación en todos', () => {
    for (const m of MANIFIESTOS) {
      expect(Number.isInteger(m.version) && m.version >= 1, m.modulo).toBe(true);
      expect(m.mensajes, m.modulo).toBe(0);
    }
  });

  it('pestañas, herramientas, Functions, colecciones y flujos programados tienen UN solo dueño', () => {
    for (const campo of ['herramientas', 'functions', 'colecciones', 'coleccionesRaiz', 'flujosProgramados', 'tablero'] as const) {
      const todos = MANIFIESTOS.flatMap((m) => m[campo]);
      expect(todos.length, `${campo} repetido entre módulos`).toBe(new Set(todos).size);
    }
    const rutas = MANIFIESTOS.flatMap((m) => m.pestanas.map((p) => p.ruta));
    expect(rutas.length, 'ruta de pestaña repetida').toBe(new Set(rutas).size);
  });

  it('un documento compartido lo declaran los dos lados, sin campos en común ni del servidor en la lista', () => {
    const porDocumento = new Map<string, { modulo: IdModulo; campos: readonly string[]; servidor: readonly string[]; con: readonly IdModulo[] }[]>();
    for (const m of MANIFIESTOS) for (const c of m.configuracion) {
      expect(c.campos.filter((x) => c.camposDelServidor?.includes(x)), `${m.modulo} ${c.documento}`).toEqual([]);
      const lista = porDocumento.get(c.documento) ?? [];
      lista.push({ modulo: m.modulo, campos: c.campos, servidor: c.camposDelServidor ?? [], con: c.compartidoCon ?? [] });
      porDocumento.set(c.documento, lista);
    }
    for (const [documento, duenos] of porDocumento) {
      for (const d of duenos) {
        expect(ordenado(d.con), `${d.modulo} en ${documento}: compartidoCon`)
          .toEqual(ordenado(duenos.filter((o) => o.modulo !== d.modulo).map((o) => o.modulo)));
      }
      const campos = duenos.flatMap((d) => d.campos);
      expect(campos.length, `${documento}: un campo con dos dueños`).toBe(new Set(campos).size);
    }
  });

  it('los flujos programados existen en Flujos/', () => {
    const hay = new Set(readdirSync(join(RAIZ, 'Flujos')));
    for (const f of MANIFIESTOS.flatMap((m) => m.flujosProgramados)) expect(hay.has(f), f).toBe(true);
  });

  it('manifiestoDe, esModulo y carpetasDe', () => {
    expect(manifiestoDe('agenda').nombre).toBe('Agenda');
    expect(esModulo('agenda')).toBe(true);
    expect(esModulo('agendamiento')).toBe(false);
    expect(esModulo(undefined)).toBe(false);
    expect(carpetasDe('catalogo-web').functions).toBe('admin/functions/src/modulos/catalogo-web/');
  });

  it('CERO import en registro.ts, y Node carga registro.ts y frontera.ts quitando tipos', () => {
    const codigoDeRegistro = sinComentarios(leer('admin/functions/src/registro.ts'));
    expect(codigoDeRegistro, 'registro.ts').not.toMatch(/^\s*import\b|\bimport\s*\(|\brequire\s*\(|^\s*export\s[^;]*?\bfrom\s/m);
    for (const ruta of ['admin/functions/src/registro.ts', 'admin/pruebas/frontera/frontera.ts']) {
      expect(sinComentarios(leer(ruta)), `${ruta}: sintaxis que Node no borra`).not.toMatch(/\benum\s+\w|\bnamespace\s+\w|constructor\s*\(\s*(public|private|protected|readonly)\b/);
    }
    // Si Node no puede cargarlos quitando tipos, las herramientas que los cargan tampoco.
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
      const r = await import(${JSON.stringify(join(RAIZ, 'admin/functions/src/registro.ts'))});
      const f = await import(${JSON.stringify(join(RAIZ, 'admin/pruebas/frontera/frontera.ts'))});
      console.log(r.REGISTRO.length, Object.keys(f.ZONA_POR_ARCHIVO).length > 0);`], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe(`${IDS_MODULOS.length} true`);
  });

  it('ningún nombre de cliente en los archivos de este bloque', () => {
    // Los nombres salen de los archivos que HOY llevan un tenant en el nombre
    // (flujos por cliente y datos de carga), menos las palabras genéricas: así
    // la prueba no tiene que escribir ningún nombre de cliente.
    const GENERICAS = new Set([
      'agendamiento', 'seguimientos', 'senas', 'vencidas', 'demo', 'recordatorios', 'venta', 'cobro',
      'novuchat', 'onboarding', 'captacion', 'negocio', 'resto', 'json',
    ]);
    const nombres = new Set(
      [...readdirSync(join(RAIZ, 'Flujos')), ...readdirSync(join(RAIZ, 'admin/scripts/datos'))]
        .filter((n) => n.endsWith('.json'))
        .flatMap((n) => n.replace(/\.json$/, '').split(/[-_.]/))
        .filter((t) => t.length >= 4 && !/^\d+$/.test(t) && !GENERICAS.has(t)),
    );
    expect(nombres.size, 'la derivación de nombres no encontró ninguno').toBeGreaterThan(0);
    for (const ruta of [
      'admin/functions/src/registro.ts', 'admin/pruebas/frontera/frontera.ts',
      'admin/pruebas/core/registro.test.ts',
    ]) {
      const texto = leer(ruta).toLowerCase();
      for (const n of nombres) expect(texto.includes(n), `${ruta} nombra a un cliente`).toBe(false);
    }
  });
});

// ======================================================================= 2
describe('2. pestañas: el registro contra web/src/central/lib/flujos.ts y App.tsx', () => {
  type PestanaDeHoy = { ruta: string; etiqueta: string; roles?: readonly string[]; tambienPropietario?: boolean };
  const normal = (p: { ruta: string; titulo: string; roles?: readonly string[]; tambienPropietario?: boolean }) => ({
    ruta: p.ruta, titulo: p.titulo, roles: ordenado(p.roles ?? ['admin']), tambienPropietario: p.tambienPropietario === true,
  });
  const porRuta = (a: { ruta: string }, b: { ruta: string }) => a.ruta.localeCompare(b.ruta);

  it.each(FLUJOS_HOY)('las pestañas de «%s» son la unión de las de sus módulos, menos las comunes', (f) => {
    const hoy = (FLUJOS[f].pestanas as PestanaDeHoy[])
      .map((p) => normal({ ...p, titulo: p.etiqueta })).sort(porRuta);
    const delRegistro = PUENTE_DE_FLUJOS[f].modulos
      .filter((m) => !comunes.includes(m))
      .flatMap((m) => manifiestoDe(m).pestanas as readonly Pestana[])
      // `rolesConModulo` suma sus roles solo si el flujo trae ese módulo (09/10/2026: «Cobros» y el operador con «pedidos»).
      .map((p) => normal({
        ...p,
        roles: [...p.roles, ...(p.rolesConModulo !== undefined && PUENTE_DE_FLUJOS[f].modulos.includes(p.rolesConModulo.modulo) ? p.rolesConModulo.roles : [])],
      })).sort(porRuta);
    // El ORDEN no se compara: hoy lo decide la lista de cada flujo (venta
    // intercala Inventario entre las dos de Cobros). Ver el cuerpo del PR.
    expect(hoy).toEqual(delRegistro);
  });

  it('las pestañas de los módulos comunes hoy son enlaces fijos de App.tsx, fuera de flujos.ts', () => {
    const deFlujos = new Set(Object.values(FLUJOS).flatMap((d) => d.pestanas.map((p) => p.ruta)));
    for (const m of comunes) for (const p of manifiestoDe(m).pestanas) {
      expect(APP, `${m}: sin NavLink a ${p.ruta}`).toContain(`<NavLink to={\`/negocio/\${tenantId}/${p.ruta}\`}>`);
      expect(deFlujos.has(p.ruta), `${p.ruta} está además en flujos.ts`).toBe(false);
    }
  });

  it('`rolesConModulo` tiene una forma válida en todo el registro', () => {
    for (const m of MANIFIESTOS) for (const p of m.pestanas) {
      const r = p.rolesConModulo;
      if (r === undefined) continue;
      const donde = `${m.modulo}/${p.ruta}`;
      expect(IDS_MODULOS as readonly string[], `${donde}: módulo desconocido`).toContain(r.modulo);
      expect(r.modulo, `${donde}: se nombra a sí mismo`).not.toBe(m.modulo);
      expect(new Set(r.roles).size, `${donde}: roles repetidos`).toBe(r.roles.length);
      expect(r.roles.length, `${donde}: sin roles`).toBeGreaterThan(0);
      for (const rol of r.roles) expect(p.roles as readonly string[], `${donde}: ${rol} ya está en roles`).not.toContain(rol);
    }
  });

  it('«Cobros» la ve el operador SOLO con el módulo «pedidos» (decisión de Andres, 09/10/2026)', () => {
    const rolesDe = (modulos: IdModulo[], ruta: string) => pestanasDe(modulos).find((p) => p.ruta === ruta)?.roles;
    expect(manifiestoDe('cobros').pestanas.find((p) => p.ruta === 'cobros')?.rolesConModulo)
      .toEqual({ modulo: 'pedidos', roles: ['oper'] });
    expect(rolesDe(['productos', 'campanas', 'cobros'], 'cobros')).toEqual(['admin']);
    expect(rolesDe(['productos', 'campanas', 'cobros', 'agenda'], 'cobros')).toEqual(['admin']);
    expect(rolesDe(['productos', 'campanas', 'cobros', 'pedidos'], 'cobros')).toEqual(['admin', 'oper']);
    // La configuración del QR sigue siendo solo del administrador, con o sin Pedidos.
    expect(rolesDe(['productos', 'campanas', 'cobros', 'pedidos'], 'cobro')).toEqual(['admin']);
    // `pestanasDe` no deja `rolesConModulo` en lo que devuelve.
    expect(pestanasDe(['productos', 'campanas', 'cobros', 'pedidos']).every((p) => !('rolesConModulo' in p))).toBe(true);
  });

  it('toda pestaña tiene su ruta en App.tsx, protegida según sus roles', () => {
    const requiere = (p: Pestana) => (p.roles.includes('oper') || p.rolesConModulo?.roles.includes('oper') === true ? 'miembroTenant'
      : p.tambienPropietario ? 'adminOPropietario' : 'adminTenant');
    for (const m of MANIFIESTOS) for (const p of m.pestanas) {
      const ruta = new RegExp(`<Route path="/negocio/:tenantId/${p.ruta}" element=\\{\\s*<Proteger requiere="(\\w+)"`);
      const hallada = ruta.exec(APP);
      expect(hallada, `${m.modulo}: sin <Route> para ${p.ruta}`).not.toBeNull();
      expect(hallada?.[1], `${m.modulo}: ${p.ruta}`).toBe(requiere(p));
    }
  });
});

// ======================================================================= 3
describe('3. configuración: el registro contra las listas blancas de firestore.rules', () => {
  /** Qué función de las reglas valida cada documento. */
  const VALIDADOR: Record<string, string> = {
    'config/agendamiento': 'configAgendamientoValida',
    'config/venta': 'configVentaValida',
    'config/onboarding': 'configOnboardingValida',
    'config/campanas': 'configCampanasValida',
    'config/marca': 'logoValido',
  };
  /** Documentos de un módulo COMÚN (no de un flujo): la regla exige `tieneModuloComun(tenantId, '<módulo>')` (H2b-6). */
  const DOCUMENTOS_DE_MODULO_COMUN = [
    'config/campanas', // Campañas es común hoy (App.tsx y la regla).
  ];
  const SELLO = ['actualizadoPor', 'actualizadoEn'];
  const documentos = ordenado(new Set(MANIFIESTOS.flatMap((m) => m.configuracion.map((c) => c.documento))));

  it('cada documento de módulo tiene su validador y nada más que esos', () => {
    expect(documentos).toEqual(ordenado(Object.keys(VALIDADOR)));
  });

  it.each(documentos)('%s: la lista blanca de la regla = los campos de sus módulos + el sello', (documento) => {
    const cuerpo = cuerpoDeFuncion(REGLAS, VALIDADOR[documento] as string);
    const nombre = documento.split('/')[1];
    expect(REGLAS, `la regla no liga ${documento} a su validador`)
      .toMatch(new RegExp(`documento == '${nombre}'[\\s\\S]{0,300}?${VALIDADOR[documento]}\\(\\)`));
    const declarantes = MANIFIESTOS.flatMap((m) => m.configuracion.filter((c) => c.documento === documento));
    const campos = declarantes.flatMap((c) => c.campos);
    expect(ordenado(listaBlanca(cuerpo))).toEqual(ordenado([...campos, ...SELLO]));
    for (const s of declarantes.flatMap((c) => c.camposDelServidor ?? [])) {
      expect(listaBlanca(cuerpo), `${s} es del servidor y está en la lista blanca`).not.toContain(s);
    }
  });

  it.each(documentos)('%s: toda rama de la regla exige la capacidad del flujo que reúne a sus módulos', (documento) => {
    const nombre = documento.split('/')[1];
    const declarantes = MANIFIESTOS.filter((m) => m.configuracion.some((c) => c.documento === documento)).map((m) => m.modulo);
    const flujos = FLUJOS_HOY.filter((f) =>
      declarantes.every((m) => (PUENTE_DE_FLUJOS[f].modulos as readonly IdModulo[]).includes(m)));
    const ramas = REGLAS.split(`documento == '${nombre}'`).slice(1)
      .map((r) => r.split(/documento ==|;/)[0] as string);
    expect(ramas.length, `ninguna rama de la regla nombra ${documento}`).toBeGreaterThan(0);
    const capacidades = new Set(ramas.flatMap((r) => [
      ...[...r.matchAll(/\b(tiene\w+)\(tenantId\)/g)].map((m) => m[1] as string),
      ...[...r.matchAll(MODULO_EN_REGLAS)].map((m) => `tieneModulo:${m[1]}`),
    ]));
    if (flujos.length === 0) {
      expect(DOCUMENTOS_DE_MODULO_COMUN, `${documento} no es de ningún flujo y la lista no lo dice`).toContain(documento);
      expect([...capacidades], `${documento}: un documento común no exige la capacidad de un flujo`).toEqual([]);
      for (const r of ramas) {
        const comunes = [...r.matchAll(MODULO_COMUN_EN_REGLAS)].map((m) => m[1] as string);
        expect(comunes.some((m) => declarantes.includes(m as IdModulo) && (MODULOS_COMUNES_HOY as readonly string[]).includes(m)),
          `${documento}: una rama no exige tieneModuloComun(tenantId, '<módulo>') de ${declarantes.join(', ')}`).toBe(true);
      }
      return;
    }
    expect(flujos.length, `${documento}: más de un flujo reúne a ${declarantes.join(', ')}`).toBe(1);
    const esperada = PUENTE_DE_FLUJOS[flujos[0]!].capacidadEnReglas;
    const propios = propiosDe(flujos[0]!);
    const modulosDe = (r: string) => [...r.matchAll(MODULO_EN_REGLAS)].map((m) => m[1] as string);
    for (const r of ramas) {
      expect(r.includes(`${esperada}(tenantId)`) || modulosDe(r).some((m) => propios.includes(m)),
        `${documento}: una rama no exige ${esperada} ni tieneModulo de un módulo propio (${propios.join(', ')})`).toBe(true);
    }
    for (const c of capacidades) {
      expect(c === esperada || (c.startsWith('tieneModulo:') && propios.includes(c.slice('tieneModulo:'.length))),
        `${documento}: exige ${c}, que no es la capacidad del flujo`).toBe(true);
    }
  });

  it('los campos que el módulo tiene en config/negocio están en su lista blanca', () => {
    const negocio = listaBlanca(cuerpoDeFuncion(REGLAS, 'configNegocioValida'));
    for (const m of MANIFIESTOS) for (const c of m.camposEnNegocio) expect(negocio, `${m.modulo}: ${c}`).toContain(c);
  });

  it('la tabla de campos de ConfiguracionVertical.tsx no ofrece nada que el registro no declare', () => {
    const pantalla = leer('admin/web/src/central/componentes/ConfiguracionModulo.tsx');
    for (const [f, siguiente] of [['agendamiento', 'venta'], ['venta', null]] as const) {
      const desde = pantalla.indexOf(`  ${f}: {`);
      const hasta = siguiente ? pantalla.indexOf(`  ${siguiente}: {`, desde) : pantalla.length;
      const claves = [...pantalla.slice(desde, hasta).matchAll(/clave: '(\w+)'/g)].map((m) => m[1]);
      const declarados = MANIFIESTOS.flatMap((m) => m.configuracion.filter((c) => c.documento === `config/${f}`))
        .flatMap((c) => c.campos);
      expect(claves.length, f).toBeGreaterThan(0);
      for (const k of claves) expect(declarados, `config/${f}.${k}`).toContain(k);
    }
  });
});

// ======================================================================= 4
describe('4. colecciones y almacenamiento: el registro contra las reglas', () => {
  /**
   * Colecciones de módulo cuya escritura HOY no exige la capacidad del flujo.
   * Solo puede achicarse, pero la prueba es de SUBCONJUNTO (H2b-0): una colección
   * que la regla empieza a exigir (`tieneX(tenantId)` o `tieneModulo(tenantId, 'm')`)
   * puede quedar en la lista sin que falle; lo que falla es una colección NUEVA sin
   * exigir. El PR `H2b-cierre` devuelve el «exactamente» y obliga a sacar la entrada.
   */
  const ESCRITURA_SIN_EXIGIR_MODULO_HOY = [
    // (H2b-6 cerró `catalogo`, `fotosCatalogo`, `contadores/catalogo` con tieneModuloComun('productos') y
    // `funcionarios/privado` con tieneAgenda: ya no están, y revertir una de esas exigencias hace fallar la prueba.)
    // La escribe solo la ingesta del comercio (esIngesta), sin mirar el flujo.
    'agenda',
  ];
  const colecciones = MANIFIESTOS.flatMap((m) => m.colecciones.map((c) => ({ modulo: m.modulo, c })));
  /** `tieneModulo(tenantId, 'm')` vale para una colección si `m` es su módulo dueño o propio de un flujo que lo lleva. */
  const modulosDeLaColeccion = (modulo: IdModulo): string[] => [modulo,
    ...FLUJOS_HOY.filter((f) => (PUENTE_DE_FLUJOS[f].modulos as readonly string[]).includes(modulo)).flatMap(propiosDe)];

  it.each(colecciones)('$modulo: $c tiene su match en las reglas del tenant', ({ c }) => {
    expect(bloqueDeColeccion(c)).not.toBeNull();
  });

  // TODO(H2b-cierre): el PR de cierre de H2b devuelve el «exactamente» de esta prueba. Mientras los PR de H2b
  // enchufan `tieneModulo` en las reglas, una colección puede salir de la lista sin que cada PR edite esta suite.
  // H2b-6: las reglas definen `tieneModulo` y `tieneModuloComun` (la prueba de abajo lo exige) y su comportamiento
  // se prueba en el emulador (`plataforma/reglas-modulos.test.ts`).
  it('la lista «escritura sin exigir módulo» es un subconjunto de la de hoy (nada nuevo sin exigir)', () => {
    const hoy = colecciones.filter(({ modulo, c }) => escrituraDe(bloqueDeColeccion(c) as string, modulosDeLaColeccion(modulo)) === 'sin-exigir').map(({ c }) => c);
    for (const c of hoy) expect(ESCRITURA_SIN_EXIGIR_MODULO_HOY, `${c}: escritura sin exigir módulo que la lista no declara`).toContain(c);
  });

  it('H2b-6: las exigencias que cerró siguen en las reglas (si se revierte una, falla)', () => {
    const hoy = (c: string) => {
      const m = colecciones.find((x) => x.c === c);
      return escrituraDe(bloqueDeColeccion(c) as string, modulosDeLaColeccion(m!.modulo));
    };
    for (const c of ['catalogo', 'fotosCatalogo', 'contadores/catalogo', 'funcionarios/privado']) {
      expect(hoy(c), `${c}: la regla dejó de exigir su módulo`).toBe('exige-capacidad');
    }
    for (const f of ['tieneModulo', 'tieneModuloComun']) {
      expect(() => cuerpoDeFuncion(REGLAS, f), `las reglas no definen ${f}`).not.toThrow();
    }
  });

  it('H2b-6 (mutación en memoria): sin la exigencia, la prueba de arriba falla', () => {
    const sinExigir = (c: string, quitar: RegExp) => {
      const m = colecciones.find((x) => x.c === c)!;
      const bloque = bloqueDeColeccion(c) as string;
      const roto = bloque.replace(quitar, '');
      expect(roto, `${c}: la mutación cambia algo`).not.toBe(bloque);
      return escrituraDe(roto, modulosDeLaColeccion(m.modulo));
    };
    expect(sinExigir('funcionarios/privado', /&&\s*tieneAgenda\(tenantId\)/g)).toBe('sin-exigir');
    expect(sinExigir('catalogo', /&&\s*tieneModuloComun\(tenantId,\s*'productos'\)/g)).toBe('sin-exigir');
    expect(sinExigir('fotosCatalogo', /&&\s*tieneModuloComun\(tenantId,\s*'productos'\)/g)).toBe('sin-exigir');
    expect(sinExigir('contadores/catalogo', /&&\s*tieneModuloComun\(tenantId,\s*'productos'\)/g)).toBe('sin-exigir');
  });

  it('H2b-6: tieneModulo solo recibe módulos propios de un flujo y tieneModuloComun solo comunes (siempre con literal)', () => {
    const propios = new Set(FLUJOS_HOY.flatMap(propiosDe));
    const sinDefiniciones = REGLAS.replace(/function tieneModulo(Comun)?\([^)]*\)/g, '');
    const llamadasModulo = [...sinDefiniciones.matchAll(/\btieneModulo\(/g)].length;
    const llamadasComun = [...sinDefiniciones.matchAll(/\btieneModuloComun\(/g)].length;
    const conLiteral = [...sinDefiniciones.matchAll(MODULO_EN_REGLAS)].map((m) => m[1] as string);
    const comunesLiteral = [...sinDefiniciones.matchAll(MODULO_COMUN_EN_REGLAS)].map((m) => m[1] as string);
    expect(conLiteral.length, 'toda llamada a tieneModulo pasa un módulo literal').toBe(llamadasModulo);
    expect(comunesLiteral.length, 'toda llamada a tieneModuloComun pasa un módulo literal').toBe(llamadasComun);
    expect(llamadasModulo, 'control: las reglas usan tieneModulo').toBeGreaterThan(0);
    expect(llamadasComun, 'control: las reglas usan tieneModuloComun').toBeGreaterThan(0);
    for (const m of conLiteral) expect(propios, `tieneModulo(tenantId, '${m}'): no es un módulo propio de un flujo`).toContain(m);
    for (const m of comunesLiteral) {
      expect(MODULOS_COMUNES_HOY as readonly string[], `tieneModuloComun(tenantId, '${m}'): no es un módulo común`).toContain(m);
    }
  });

  it('escrituraDe: tieneModuloComun solo cuenta como término propio de `&&` y con un módulo común de la colección', () => {
    const bloque = (cond: string) => `allow create, update: if ${cond};`;
    expect(escrituraDe(bloque("esAdmin(tenantId) && tieneModuloComun(tenantId, 'productos') && valido()"), ['productos'])).toBe('exige-capacidad');
    expect(escrituraDe(bloque("esAdmin(tenantId) && tieneModuloComun(tenantId, 'campanas') && valido()"), ['productos'])).toBe('sin-exigir');
    expect(escrituraDe(bloque("esAdmin(tenantId) && (tieneModuloComun(tenantId, 'productos') || true)"), ['productos'])).toBe('sin-exigir');
    expect(escrituraDe(bloque("tieneModuloComun(tenantId, 'productos') || esAdmin(tenantId)"), ['productos'])).toBe('sin-exigir');
    // un módulo propio de un flujo no cuenta como «común» aunque la colección lo permita
    expect(escrituraDe(bloque("esAdmin(tenantId) && tieneModuloComun(tenantId, 'agenda')"), ['agenda'])).toBe('sin-exigir');
  });

  it('escrituraDe: tieneModulo solo cuenta como término propio de `&&` y con un módulo de la colección', () => {
    const bloque = (cond: string) => `allow create, update: if ${cond};`;
    const funcionarios = ['agenda'];
    expect(escrituraDe(bloque('esAdmin(tenantId) && tieneAgenda(tenantId)'), funcionarios)).toBe('exige-capacidad');
    expect(escrituraDe(bloque("esAdmin(tenantId) && tieneModulo(tenantId, 'agenda') && valido()"), funcionarios)).toBe('exige-capacidad');
    expect(escrituraDe(bloque("tieneModulo(tenantId, 'agenda')"), funcionarios)).toBe('exige-capacidad');
    // h5: módulo ajeno
    expect(escrituraDe(bloque("esAdmin(tenantId) && tieneModulo(tenantId, 'pedidos') && valido()"), funcionarios)).toBe('sin-exigir');
    // h7: con `||`, dentro de un paréntesis o a la derecha de un `||`
    expect(escrituraDe(bloque("esAdmin(tenantId) && (tieneModulo(tenantId, 'agenda') || true) && valido()"), funcionarios)).toBe('sin-exigir');
    expect(escrituraDe(bloque("tieneModulo(tenantId, 'agenda') || esAdmin(tenantId)"), funcionarios)).toBe('sin-exigir');
    expect(escrituraDe(bloque("esAdmin(tenantId) || tieneModulo(tenantId, 'agenda')"), funcionarios)).toBe('sin-exigir');
    expect(escrituraDe(bloque("esAdmin(tenantId) && tieneModulo(tenantId, 'agenda')"), [])).toBe('sin-exigir');
  });

  it('las colecciones de la raíz tienen su match fuera del tenant', () => {
    for (const m of MANIFIESTOS) for (const c of m.coleccionesRaiz) {
      const b = bloqueMatch(REGLAS, c);
      expect(b, c).not.toBeNull();
      expect(b!.inicio > TENANTS!.fin || b!.inicio < TENANTS!.inicio, `${c} está dentro del tenant`).toBe(true);
    }
  });

  it('el almacenamiento de cada módulo tiene su match en storage.rules', () => {
    for (const m of MANIFIESTOS) for (const a of m.almacenamiento) {
      expect(STORAGE, `${m.modulo}: ${a}`).toContain(`match /tenants/{tenantId}/${a}`);
    }
  });
});

// ======================================================================= 5
describe('5. límites: el registro contra planes.ts y las reglas', () => {
  const limites = MANIFIESTOS.flatMap((m) => m.limites.map((l) => ({ modulo: m.modulo, ...l })));
  const capital = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  const archivosDelServidor = tsDe('admin/functions/src').filter((a) => !/\/(planes|registro)\.ts$/.test(a));
  const servidor = archivosDelServidor.map((a) => leer(a)).join('\n');

  it('el servidor que se revisa incluye las subcarpetas (control de que no pasa en vacío al mover)', () => {
    // central/ejes.ts está en una subcarpeta desde F1: si el recorrido no baja, no aparece.
    expect(archivosDelServidor.some((a) => a.endsWith('/central/ejes.ts'))).toBe(true);
    expect(archivosDelServidor.some((a) => a.endsWith('/limiteCatalogo.ts'))).toBe(true);
  });

  it('las claves de límite de los módulos son las de PLANES, menos las del core y Central', () => {
    const numericas = Object.entries(PLANES.impulso).filter(([, v]) => typeof v === 'number').map(([k]) => k);
    const ajenas = ['precioUsd', 'conversaciones', 'cambiosIncluidos']; // precio; core; Central
    expect(ordenado(limites.map((l) => l.clave))).toEqual(ordenado(numericas.filter((k) => !ajenas.includes(k))));
    for (const plan of Object.values(PLANES)) for (const l of limites) expect(plan, l.clave).toHaveProperty(l.clave);
  });

  it.each(limites)('$modulo: $clave se hace cumplir donde dice ($hacerCumplir)', (l) => {
    const enReglas = new RegExp(`function limite${capital(l.clave)}\\(\\)`);
    const enServidor = new RegExp(`limitesDeCuenta\\([^)]*\\)\\.${l.clave}\\b|limiteDe${capital(l.clave)}\\(`);
    if (l.hacerCumplir === 'pendiente') {
      expect(REGLAS, `${l.clave} ya está en las reglas: actualizar el registro`).not.toMatch(enReglas);
      expect(servidor, `${l.clave} ya se cuenta en el servidor: actualizar el registro`).not.toMatch(enServidor);
      expect(l.contador).toBeUndefined();
      return;
    }
    if (l.hacerCumplir.includes('reglas')) {
      expect(REGLAS).toMatch(enReglas);
      expect(REGLAS.split(`limite${capital(l.clave)}()`).length, 'la función existe pero nadie la usa').toBeGreaterThan(2);
    }
    if (l.hacerCumplir.includes('servidor')) expect(servidor).toMatch(enServidor);
    if (l.contador) expect(REGLAS).toContain(`/${l.contador}`);
  });
});

// ======================================================================= 6
describe('6. herramientas: el registro contra los nodos de Flujos/*.json', () => {
  it('cada nodo-herramienta de un flujo es de exactamente un módulo, y al revés', () => {
    const enFlujos = new Set<string>();
    for (const n of readdirSync(join(RAIZ, 'Flujos')).filter((x) => x.endsWith('.json'))) {
      const flujo = JSON.parse(leer(`Flujos/${n}`)) as { nodes?: { name: string; type: string }[] };
      for (const nodo of flujo.nodes ?? []) if (/tool/i.test(nodo.type)) enFlujos.add(nodo.name);
    }
    const declaradas = MANIFIESTOS.flatMap((m) => m.herramientas);
    expect(enFlujos.size).toBeGreaterThan(0);
    for (const h of enFlujos) expect(declaradas.filter((d) => d === h), h).toHaveLength(1);
    expect(ordenado(declaradas)).toEqual(ordenado(enFlujos));
  });
});

// ======================================================================= 7
describe('7. Functions: el registro contra index.ts', () => {
  it('cada Function de un manifiesto es una exportación de index.ts', () => {
    for (const m of MANIFIESTOS) for (const f of m.functions) {
      expect(typeof indice[f], `${m.modulo}: ${f} no se exporta`).toBe('function');
    }
  });

  // La zona sale de `zonaDeCodigo` (la carpeta, más lo que anota SE_PARTE): un
  // archivo movido a `modulos/<m>/` conserva su zona (F2, tanda cero).
  const verificadas = new Set<string>();
  it('toda Function que index.ts reexporta de un archivo de módulo está en el manifiesto de ese módulo', () => {
    const texto = sinComentarios(leer('admin/functions/src/index.ts'));
    // `[\w/-]`: `modulos/catalogo-web/` lleva guion (revisión de seguridad del #239).
    for (const m of texto.matchAll(/export\s*\{([^}]*)\}\s*from\s*'\.\/([\w/-]+)\.js'/g)) {
      const archivo = `admin/functions/src/${m[2]}.ts`;
      const destino = zonaDeCodigo(archivo);
      if (destino?.zona !== 'modulo') continue;
      const seParte = destino.seParte ?? [];
      const duenos = [destino.modulo, ...seParte.map((s) => s.replace(/^modulo:/, ''))];
      for (const nombre of (m[1] as string).split(',').map((s) => s.trim()).filter(Boolean)) {
        const dueno = MANIFIESTOS.find((x) => (x.functions as readonly string[]).includes(nombre));
        expect(dueno, `${nombre} (de ${m[2]}.ts) no está en ningún manifiesto`).toBeDefined();
        expect(duenos, `${nombre}: lo declara ${dueno?.modulo}`).toContain(dueno?.modulo);
        verificadas.add(nombre);
      }
    }
    // Control de que no pasa en vacío: TODA Function de un manifiesto se verificó
    // contra el archivo del que index.ts la reexporta, esté donde esté.
    expect([...verificadas].sort()).toEqual(MANIFIESTOS.flatMap((x) => [...x.functions]).sort());
  });
});

// ======================================================================= 8
describe('8. las copias de la lista de flujos coinciden con el puente', () => {
  const claves = ordenado(FLUJOS_HOY);
  const literales = (texto: string, re: RegExp) => ordenado(new Set([...texto.matchAll(re)].map((m) => m[1] as string)));
  /** Los literales de `const <nombre> = new Set([...])`, o null si el literal ya no está. */
  const conjuntoOpcional = (texto: string, nombre: string) => {
    const m = new RegExp(`const ${nombre} = new Set\\(\\[([^\\]]*)\\]\\)`).exec(texto);
    return m ? ordenado([...(m[1] as string).matchAll(/'(\w+)'/g)].map((x) => x[1] as string)) : null;
  };
  /**
   * Formas derivadas EXACTAS que una copia puede tener en lugar de su literal (H2b-0). Los símbolos se importan
   * por su nombre (los imports con alias, `IDS_FLUJOS as F`, se rechazan a propósito: no se pueden anclar).
   */
  const DERIVADO_CONJUNTO = {
    simbolos: ['IDS_FLUJOS'],
    definicion: /^\s*new Set(?:<string>)?\(\s*IDS_FLUJOS\s*\)\s*$/,
    usos: [/\bIDS_FLUJOS\.includes\(/, /\besFlujo\(/],
    importes: ['IDS_FLUJOS', 'esFlujo'],
    forma: '`new Set(IDS_FLUJOS)`',
  };
  const DERIVADO_DOCUMENTO = {
    simbolos: ['IDS_FLUJOS', 'documentoDeFlujo'],
    definicion: /^\s*Object\.fromEntries\(\s*IDS_FLUJOS\.map\(\((\w+)\) => \[\1, documentoDeFlujo\(\1\)\]\)\s*\)\s*$/,
    usos: [/\bdocumentoDeFlujo\(/],
    importes: ['documentoDeFlujo'],
    forma: '`Object.fromEntries(IDS_FLUJOS.map((f) => [f, documentoDeFlujo(f)]))`',
  };
  /**
   * Tolerante a los dos estados de la copia (H2b-0), pero sin hueco:
   *  1. con el literal `const <X> = new Set([...])` (o el objeto `DOCUMENTO`): tiene que ser el del puente;
   *  2. sin ese literal, y sin comentarios: la constante, si existe, tiene que ser EXACTAMENTE la forma derivada
   *     (`new Set(IDS_FLUJOS)`; para DOCUMENTO, `Object.fromEntries(IDS_FLUJOS.map((f) => [f, documentoDeFlujo(f)]))`)
   *     con sus símbolos importados por nombre de `registro`; si ya no existe, el archivo tiene que importar y
   *     LLAMAR a `esFlujo(`, `IDS_FLUJOS.includes(` o `documentoDeFlujo(`.
   * Cualquier otra forma de la constante (`new Set([...IDS_FLUJOS, 'x'])`, `.filter(...)`, `Object.freeze({...})`)
   * FALLA: no se la trata como «sin literal» ni como derivada.
   */
  const copiaCoincide = (
    texto: string, nombre: string, constante: string, esperado: unknown, leido: (t: string) => unknown,
    derivado: typeof DERIVADO_CONJUNTO | typeof DERIVADO_DOCUMENTO,
  ) => {
    const codigo = sinComentarios(texto);
    const literal = leido(codigo);
    if (literal !== null) { expect(literal, `${nombre}: el literal ya no es el del puente`).toEqual(esperado); return; }
    const definicion = new RegExp(`\\bconst\\s+${constante}\\b\\s*(?::[^=]+)?=([^;]*);`).exec(codigo);
    if (definicion) {
      expect(derivado.definicion.test(definicion[1] as string),
        `${nombre}: ${constante} no es el literal del puente ni exactamente ${derivado.forma}`).toBe(true);
      for (const x of derivado.simbolos) expect(importaSimbolo(codigo, x), `${nombre}: no importa ${x} de registro`).toBe(true);
    } else {
      expect(derivado.importes.some((x) => importaSimbolo(codigo, x)) && derivado.usos.some((u) => u.test(codigo)),
        `${nombre}: sin literal ni constante, tiene que importar y llamar ${derivado.importes.join('/')}`).toBe(true);
    }
  };

  it('prompt.ts (VERTICALES_CONOCIDOS), la consola (FLUJOS) y plataforma/tenants.ts (VERTICALES)', () => {
    expect(ordenado(VERTICALES_CONOCIDOS)).toEqual(claves);
    expect(ordenado(Object.keys(FLUJOS))).toEqual(claves);
    copiaCoincide(leer('admin/functions/src/plataforma/tenants.ts'), 'tenants.ts VERTICALES', 'VERTICALES', claves,
      (t) => conjuntoOpcional(t, 'VERTICALES'), DERIVADO_CONJUNTO);
  });

  it('copiaCoincide: las formas derivadas exactas pasan; todo lo demás FALLA (g1-g5, a2-a4, b3-b4)', () => {
    const imp = (...x: string[]) => `import { ${x.join(', ')} } from '../registro.js';\n`;
    const conj = (nombre: string, expr: string, ...simbolos: string[]) => `${imp(...simbolos)}const ${nombre} = ${expr};\n`;
    const leerConjunto = (nombre: string) => (t: string) => conjuntoOpcional(t, nombre);
    const leerDocumento = (t: string) => {
      const doc = /const DOCUMENTO = \{([^}]*)\}/.exec(t);
      return doc ? Object.fromEntries([...(doc[1] as string).matchAll(/(\w+):\s*'(\w+)'/g)].map((m) => [m[1], m[2]])) : null;
    };
    const esperadoDoc = Object.fromEntries(FLUJOS_HOY.map((f) => [f, PUENTE_DE_FLUJOS[f].documento]));
    const conjunto = (nombre: string, texto: string) => () =>
      copiaCoincide(texto, 'x', nombre, claves, leerConjunto(nombre), DERIVADO_CONJUNTO);
    const documento = (texto: string) => () =>
      copiaCoincide(texto, 'x', 'DOCUMENTO', esperadoDoc, leerDocumento, DERIVADO_DOCUMENTO);
    // pasan
    expect(conjunto('VERTICALES', conj('VERTICALES', 'new Set(IDS_FLUJOS)', 'IDS_FLUJOS'))).not.toThrow();
    expect(conjunto('VERTICALES', conj('VERTICALES', 'new Set<string>(IDS_FLUJOS)', 'IDS_FLUJOS'))).not.toThrow();
    expect(conjunto('FLUJOS_VALIDOS', `${imp('esFlujo')}if (!esFlujo(x)) throw 1;\n`)).not.toThrow();
    expect(conjunto('FLUJOS_VALIDOS', `const FLUJOS_VALIDOS = new Set(['agendamiento', 'venta', 'onboarding']);`)).not.toThrow();
    expect(documento(conj('DOCUMENTO', 'Object.fromEntries(IDS_FLUJOS.map((f) => [f, documentoDeFlujo(f)]))', 'IDS_FLUJOS', 'documentoDeFlujo'))).not.toThrow();
    // fallan
    const malas: [string, () => void][] = [
      ['g1', conjunto('VERTICALES', conj('VERTICALES', "new Set<string>([...IDS_FLUJOS, 'x'])", 'IDS_FLUJOS'))],
      ['g2', conjunto('VERTICALES', conj('VERTICALES', "new Set([...IDS_FLUJOS, 'x'])", 'IDS_FLUJOS'))],
      ['g3', conjunto('VERTICALES', conj('VERTICALES', "new Set(IDS_FLUJOS.filter((f) => f !== 'onboarding'))", 'IDS_FLUJOS'))],
      ['g4', documento(conj('DOCUMENTO', "Object.fromEntries(IDS_FLUJOS.map((f) => [f, 'captacion']))", 'IDS_FLUJOS', 'documentoDeFlujo'))],
      ['g5', conjunto('FLUJOS_VALIDOS', conj('FLUJOS_VALIDOS', "new Set([...IDS_FLUJOS].concat('x'))", 'IDS_FLUJOS'))],
      ['a2', conjunto('VERTICALES', "const VERTICALES = new Set<string>(['agendamiento', 'venta']);")],
      ['a3', conjunto('VERTICALES', `${imp('esFlujo')}const VERTICALES = new Set<string>(['agendamiento', 'venta']);`)],
      ['a4', conjunto('VERTICALES', "// import { IDS_FLUJOS } from '../registro.js';\nconst VERTICALES = new Set<string>(['agendamiento']);")],
      ['b4', documento(`${imp('IDS_FLUJOS')}const DOCUMENTO = Object.freeze({ agendamiento: 'agendamiento', venta: 'venta', onboarding: 'captacion' });`)],
      ['sin import', conjunto('VERTICALES', 'const VERTICALES = new Set(IDS_FLUJOS);')],
      ['alias', conjunto('VERTICALES', "import { IDS_FLUJOS as F } from '../registro.js';\nconst VERTICALES = new Set(F);")],
      ['importa y no llama', conjunto('FLUJOS_VALIDOS', `${imp('esFlujo')}`)],
      ['sin constante y sin nada', conjunto('FLUJOS_VALIDOS', 'const otra = 1;')],
    ];
    for (const [id, f] of malas) expect(f, id).toThrow();
  });

  it('flujos.ts, literal o fachada, produce lo mismo que la fixture del 03/10; el nombre del puente es el de la consola', async () => {
    for (const f of FLUJOS_HOY) expect(PUENTE_DE_FLUJOS[f].nombre, f).toBe(FLUJOS[f].nombre);
    // SIEMPRE se compara: una fachada correcta produce el mismo objeto que la fixture.
    const real = await import('../../web/src/central/lib/flujos.ts');
    expect(real.FLUJOS).toEqual(FLUJOS);
    for (const v of [...IDS_FLUJOS, 'interno', '', null, undefined, 3, 'toString']) expect(real.esFlujo(v), String(v)).toBe(esFlujoConsola(v));
    for (const f of [{ flujos: ['venta', 'x'] }, { vertical: 'agendamiento' }, { flujos: 'venta' }, undefined]) {
      expect(real.flujosDe(f)).toEqual(flujosDe(f));
    }
    for (const l of [['venta'], ['agendamiento'], ['venta', 'agendamiento'], ['onboarding'], []] as const) {
      expect(real.etiquetaCatalogo([...l])).toBe(etiquetaCatalogo([...l]));
    }
  });

  it('firestore.rules: cada capacidad abre SU flujo, con el literal de hoy o con tieneModulo de un módulo propio', () => {
    const cuerpos = FLUJOS_HOY.map((f) => cuerpoDeFuncion(REGLAS, PUENTE_DE_FLUJOS[f].capacidadEnReglas));
    FLUJOS_HOY.forEach((f) => {
      const cap = PUENTE_DE_FLUJOS[f].capacidadEnReglas;
      expect(flujoQueAbre(REGLAS, cap),
        `${cap} no abre ${f}: su cuerpo no es «return tieneFlujo(tenantId, '${f}');» ni «return tieneModulo(tenantId, '<módulo propio de ${f}>');»`).toBe(f);
    });
    const delTexto = literales(REGLAS, /tieneFlujo\(tenantId, '(\w+)'\)/g);
    if (cuerpos.every((c) => FORMA_LITERAL.test(c))) expect(delTexto).toEqual(claves);
    else for (const l of delTexto) expect(claves, `tieneFlujo con un flujo desconocido: ${l}`).toContain(l);
  });

  it('documento y etiqueta de catálogo: prompt.ts y la consola (fixture) contra el puente', () => {
    for (const f of FLUJOS_HOY) {
      expect(documentoDeVertical(f)).toBe(PUENTE_DE_FLUJOS[f].documento);
      expect(FLUJOS[f].documento).toBe(PUENTE_DE_FLUJOS[f].documento);
      expect(FLUJOS[f].catalogo).toBe(PUENTE_DE_FLUJOS[f].catalogo);
    }
    expect(documentoDeVertical('otro')).toBeNull();
  });

  // Dos copias más que el §3.3 de Analisis/41 no lista: los scripts de alta.
  it.each([
    ['alta-comercio', () => leer('admin/scripts/plataforma/alta-comercio.mjs')],
    ['asignar-numero', () => leer('admin/scripts/plataforma/asignar-numero.mjs')],
  ])(
    '%s: FLUJOS_VALIDOS y DOCUMENTO', (nombre, leerScript) => {
      const texto = leerScript();
      copiaCoincide(texto, `${nombre} FLUJOS_VALIDOS`, 'FLUJOS_VALIDOS', claves, (t) => conjuntoOpcional(t, 'FLUJOS_VALIDOS'), DERIVADO_CONJUNTO);
      const esperado = Object.fromEntries(FLUJOS_HOY.map((f) => [f, PUENTE_DE_FLUJOS[f].documento]));
      copiaCoincide(texto, `${nombre} DOCUMENTO`, 'DOCUMENTO', esperado, (t) => {
        const doc = /const DOCUMENTO = \{([^}]*)\}/.exec(t);
        return doc ? Object.fromEntries([...(doc[1] as string).matchAll(/(\w+):\s*'(\w+)'/g)].map((m) => [m[1], m[2]])) : null;
      }, DERIVADO_DOCUMENTO);
    });

  it('el puente solo nombra módulos del registro', () => {
    for (const f of FLUJOS_HOY) for (const m of PUENTE_DE_FLUJOS[f].modulos) expect(esModulo(m), `${f}: ${m}`).toBe(true);
    for (const m of comunes) expect(esModulo(m)).toBe(true);
    expect(TEXTO_REGISTRO).toContain('TRANSITORIO');
  });
});

// ======================================================================= 9
describe('9. derivaciones equivalentes: el registro calcula lo que las copias calculan hoy', () => {
  // Los 8 subconjuntos de los tres flujos, en el orden en que los lista una ficha.
  const subconjuntos: IdFlujo[][] = Array.from({ length: 1 << IDS_FLUJOS.length },
    (_, mascara) => IDS_FLUJOS.filter((_f, i) => (mascara >> i) & 1));
  const nombre = (s: readonly string[]) => `[${s.join(', ')}]`;

  /** Lo que las reglas de Firestore deciden por texto: la función `tieneX` abre el flujo que dice su cuerpo. */
  const flujoDeCapacidad = (cap: string) => {
    const f = flujoQueAbre(REGLAS, cap);
    if (!f) throw new Error(`${cap}: su cuerpo no es tieneFlujo(tenantId, '<flujo>') ni tieneModulo(tenantId, '<módulo propio>')`);
    return f;
  };
  /** `flujo in get('flujos', [vertical])` de `flujosTenant`/`tieneFlujo`, sobre la ficha cruda. */
  const tieneFlujoEnReglas = (ficha: FichaConCapacidades, flujo: string) => {
    const lista = 'flujos' in ficha ? ficha.flujos : [ficha.vertical ?? ''];
    return Array.isArray(lista) && lista.includes(flujo);
  };

  it('los 8 subconjuntos existen y esFlujo coincide con el de la consola', () => {
    expect(subconjuntos).toHaveLength(8);
    for (const v of [...IDS_FLUJOS, 'interno', '', null, undefined, 3, 'toString', '__proto__']) {
      expect(esFlujo(v), String(v)).toBe(esFlujoConsola(v));
    }
    expect(esFlujo('interno')).toBe(false);
    expect(esFlujo('toString')).toBe(false);
  });

  it('documentoDeFlujo: el documento de cada flujo, y null para lo que no lo es', () => {
    for (const f of IDS_FLUJOS) {
      expect(documentoDeFlujo(f)).toBe(FLUJOS[f].documento);
      expect(documentoDeFlujo(f)).toBe(documentoDeVertical(f));
    }
    for (const v of ['interno', 'toString', '', null, undefined, 7]) expect(documentoDeFlujo(v), String(v)).toBeNull();
  });

  const fichas: [string, FichaConCapacidades | undefined][] = [
    ...subconjuntos.map((s): [string, FichaConCapacidades] => [`flujos ${nombre(s)}`, { flujos: s }]),
    ...IDS_FLUJOS.map((f): [string, FichaConCapacidades] => [`solo vertical «${f}»`, { vertical: f }]),
    ['vertical desconocido', { vertical: 'interno' }],
    ['flujos no es lista (cadena)', { flujos: 'venta', vertical: 'agendamiento' }],
    ['flujos no es lista (objeto)', { flujos: { venta: true } }],
    ['flujos null', { flujos: null, vertical: 'agendamiento' }],
    ['flujos: []', { flujos: [], vertical: 'venta' }],
    ['flujos con un flujo desconocido', { flujos: ['interno'] }],
    ['flujos con desconocido y conocido', { flujos: ['interno', 'venta'] }],
    ['la lista manda sobre vertical', { flujos: ['venta'], vertical: 'agendamiento' }],
    ['ficha vacía', {}],
    ['sin ficha', undefined],
  ];

  // Con `flujos` que no es lista la consola abre por vertical y las reglas no abren nada: ahí el registro cierra (prueba aparte).
  it.each(fichas.filter(([, f]) => f === undefined || !('flujos' in f) || Array.isArray(f.flujos)))(
    'flujosDeFicha(%s) coincide con flujosDe de la consola', (_n, ficha) => {
    expect(flujosDeFicha(ficha)).toEqual(flujosDe(ficha));
  });

  it('flujos que no es lista cierra: ni flujos ni módulos por vertical, y tieneModulo es false', () => {
    for (const flujos of [null, 'venta', { venta: true }, 3]) {
      const ficha = { flujos, vertical: 'agendamiento' };
      expect(flujosDeFicha(ficha), String(flujos)).toEqual([]);
      for (const [modulo] of CAPACIDADES) expect(tieneModulo(ficha, modulo), `${modulo} / ${String(flujos)}`).toBe(false);
    }
    expect(flujosDeFicha({ flujos: undefined, vertical: 'venta' })).toEqual(['venta']);
  });

  it('las propiedades heredadas no cuentan como flujos ni como módulos', () => {
    const heredada = Object.create({ flujos: ['venta'], modulos: ['agenda'] }) as FichaConCapacidades;
    expect(flujosDeFicha(heredada)).toEqual([]);
    expect(modulosDeFicha(heredada)).toEqual(modulosDeFlujos([]));
  });

  it('pestanasDe devuelve copias, no las instancias del registro', () => {
    const todas = pestanasDe(IDS_MODULOS);
    expect(todas.length).toBeGreaterThan(0);
    const originales = new Set<object>(MANIFIESTOS.flatMap((m) => [...m.pestanas]));
    for (const p of todas) expect(originales.has(p)).toBe(false);
    // `roles` también es copia: mutar el resultado no contamina el registro ni otra llamada.
    const originalesPorRuta = new Map(MANIFIESTOS.flatMap((m) => [...m.pestanas]).map((o) => [o.ruta, o]));
    for (const p of todas) expect(p.roles).not.toBe(originalesPorRuta.get(p.ruta)!.roles);
    const antes = JSON.stringify(pestanasDe(IDS_MODULOS));
    (todas[0]!.roles as string[]).push('intruso');
    expect(JSON.stringify(pestanasDe(IDS_MODULOS))).toBe(antes);
  });

  it('flujosTenant de las reglas lee `flujos` de la ficha del tenant con el `vertical` de ESA ficha por defecto', () => {
    const cuerpo = cuerpoDeFuncion(REGLAS, 'flujosTenant');
    // La ruta se nombra una vez (presupuesto de expresiones) y es la ficha de `tenantId`, no otra.
    expect(cuerpo).toMatch(/let ruta = \/databases\/\$\(database\)\/documents\/tenants\/\$\(tenantId\);/);
    // Manda `flujos`; sin él, `[vertical]` de la misma ficha. Nada más: ni `get('flujos', [''])` ni otro valor.
    expect(cuerpo).toMatch(/get\(ruta\)\.data\.get\('flujos',\s*\[get\(ruta\)\.data\.get\('vertical',\s*''\)\]\)/);
    // Una ficha que no existe no abre ningún flujo.
    expect(cuerpo).toMatch(/exists\(ruta\)\s*\?[\s\S]*:\s*\[\];/);
  });

  it('flujosDeFicha quita repetidos y deja la lista vacía si no hay nada conocido', () => {
    expect(flujosDeFicha({ flujos: ['venta', 'venta', 'agendamiento', 'venta'] })).toEqual(['venta', 'agendamiento']);
    expect(flujosDeFicha({ flujos: ['interno'] })).toEqual([]);
    expect(flujosDeFicha({ flujos: [] })).toEqual([]);
    expect(flujosDeFicha({ flujos: 'venta' })).toEqual([]);
    expect(flujosDeFicha({})).toEqual([]);
  });

  it.each(subconjuntos.map((s) => [nombre(s), s] as const))(
    'flujos %s: módulos, pestañas y etiqueta de catálogo coinciden con la consola', (_n, s) => {
      const modulos = modulosDeFlujos(s);
      // Orden de IDS_MODULOS, sin repetidos, y siempre con los comunes.
      expect(modulos).toEqual(IDS_MODULOS.filter((m) => modulos.includes(m)));
      for (const m of comunes) expect(modulos).toContain(m);
      // Nada de más: cada módulo viene de un flujo del subconjunto o es común.
      for (const m of modulos) {
        expect(comunes.includes(m) || s.some((f) => (PUENTE_DE_FLUJOS[f].modulos as readonly string[]).includes(m)), m).toBe(true);
      }
      // Pestañas: la unión de las de FLUJOS[f].pestanas, sin repetir ruta.
      const hoy = [...new Set(s.flatMap((f) => FLUJOS[f].pestanas.map((p) => p.ruta)))].sort();
      expect(pestanasDe(modulos).map((p) => p.ruta).sort()).toEqual(hoy);
      expect(etiquetaDeCatalogo(modulos)).toBe(etiquetaCatalogo(s));
    });

  it.each(IDS_FLUJOS.map((f) => [f] as const))(
    'el orden de las pestañas de «%s» por sí solo es EXACTAMENTE el de la consola, con título y roles', (f) => {
      const hoy = FLUJOS[f].pestanas.map((p) => ({
        ruta: p.ruta, titulo: p.etiqueta, roles: [...(p.roles ?? ['admin'])].sort(), tambienPropietario: p.tambienPropietario === true,
      }));
      const delRegistro = pestanasDe(modulosDeFlujos([f])).map((p) => ({
        ruta: p.ruta, titulo: p.titulo, roles: [...p.roles].sort(), tambienPropietario: p.tambienPropietario === true,
      }));
      expect(delRegistro).toEqual(hoy);
    });

  it('en una mezcla de flujos el orden es el declarado en `orden`, y no cambia con el de la lista', () => {
    const a = pestanasDe(modulosDeFlujos(['agendamiento', 'venta', 'onboarding'])).map((p) => p.ruta);
    const b = pestanasDe(modulosDeFlujos(['onboarding', 'venta', 'agendamiento'])).map((p) => p.ruta);
    expect(a).toEqual(['agenda', 'pedidos', 'cobros', 'inventario', 'cobro', 'captacion']);
    expect(b).toEqual(a);
  });

  it('pestanasDe no devuelve las comunes ni repite una ruta', () => {
    const rutas = pestanasDe(IDS_MODULOS).map((p) => p.ruta);
    expect(new Set(rutas).size).toBe(rutas.length);
    for (const m of comunes) for (const p of manifiestoDe(m).pestanas) expect(rutas).not.toContain(p.ruta);
    expect(pestanasDe([])).toEqual([]);
    expect(pestanasDe(['productos', 'campanas'])).toEqual([]);
  });

  it('el campo `orden` es único entre las pestañas del registro', () => {
    const ordenes = MANIFIESTOS.flatMap((m) => m.pestanas.map((p) => p.orden));
    expect(new Set(ordenes).size).toBe(ordenes.length);
  });

  it('etiquetaDeCatalogo: la combinación que no es de un solo flujo es «Catálogo»', () => {
    expect(etiquetaDeCatalogo(['productos', 'agenda'])).toBe('Servicios');
    expect(etiquetaDeCatalogo(['productos', 'pedidos'])).toBe('Productos');
    expect(etiquetaDeCatalogo(['productos', 'agenda', 'pedidos'])).toBe('Catálogo');
    expect(etiquetaDeCatalogo(['productos', 'agenda', 'captacion'])).toBe('Catálogo');
    expect(etiquetaDeCatalogo(['productos', 'pedidos', 'captacion'])).toBe('Catálogo');
    expect(etiquetaDeCatalogo(['productos'])).toBe('Catálogo');
    expect(etiquetaDeCatalogo([])).toBe('Catálogo');
  });

  // Los cuatro módulos con capacidad en las reglas, contra la función `tieneX` que el cuerpo
  // de las reglas dice que abre cada flujo: agenda y catálogo web/pedidos y captación.
  const CAPACIDADES: [IdModulo, string][] = [
    ['agenda', 'tieneAgenda'],
    ['pedidos', 'tieneCobro'],
    ['catalogo-web', 'tieneCobro'],
    ['captacion', 'tieneOnboarding'],
  ];
  it('las capacidades de las reglas abren los flujos que el puente dice', () => {
    expect(CAPACIDADES.map(([, c]) => flujoDeCapacidad(c))).toEqual(['agendamiento', 'venta', 'venta', 'onboarding']);
  });

  it.each(fichas.filter(([, f]) => f !== undefined && (!('flujos' in f) || Array.isArray(f.flujos))))(
    'tieneModulo(%s) coincide con tieneFlujo de las reglas', (_n, ficha) => {
      for (const [modulo, cap] of CAPACIDADES) {
        expect(tieneModulo(ficha, modulo), `${modulo} / ${cap}`).toBe(tieneFlujoEnReglas(ficha!, flujoDeCapacidad(cap)));
      }
    });

  it('una ficha con `modulos` que contradice `flujos` manda `modulos`', () => {
    const ficha = { modulos: ['campanas', 'agenda', 'productos'], flujos: ['venta'], vertical: 'venta' };
    expect(modulosDeFicha(ficha)).toEqual(['productos', 'agenda', 'campanas']);
    expect(tieneModulo(ficha, 'agenda')).toBe(true);
    expect(tieneModulo(ficha, 'pedidos')).toBe(false);
    expect(tieneModulo(ficha, 'cobros')).toBe(false);
  });

  it('`modulos` filtra desconocidos y repetidos; si no es lista, manda `flujos`', () => {
    expect(modulosDeFicha({ modulos: ['interno', 'agenda', 'agenda'] })).toEqual(['agenda']);
    expect(modulosDeFicha({ modulos: [] })).toEqual([]);
    expect(modulosDeFicha({ modulos: 'agenda', flujos: ['venta'] })).toEqual(modulosDeFlujos(['venta']));
    expect(modulosDeFicha({ flujos: ['venta'] })).toEqual(modulosDeFlujos(['venta']));
    expect(modulosDeFicha(undefined)).toEqual([]);
    expect(modulosDeFicha(null)).toEqual([]);
    expect(modulosDeFicha({})).toEqual(['productos', 'campanas']);
  });

  it.each(subconjuntos.map((s) => [nombre(s), s] as const))(
    'flujos %s: documentoDeCobro coincide con documentoQueCobra de cobro.ts', (_n, s) => {
      const ficha = { get: (campo: string) => (campo === 'flujos' ? s : undefined) };
      expect(documentoDeCobro(modulosDeFlujos(s))).toBe(documentoQueCobraHoy(ficha));
    });

  it('documentoDeCobro: sin cobros no hay documento, y venta gana sobre agendamiento', () => {
    expect(documentoDeCobro(['pedidos'])).toBeNull();
    expect(documentoDeCobro(['agenda'])).toBeNull();
    expect(documentoDeCobro([])).toBeNull();
    expect(documentoDeCobro(['cobros'])).toBeNull();
    expect(documentoDeCobro(['cobros', 'pedidos'])).toBe('venta');
    expect(documentoDeCobro(['cobros', 'agenda'])).toBe('agendamiento');
    expect(documentoDeCobro(['cobros', 'agenda', 'pedidos'])).toBe('venta');
  });

  it('registro.ts sigue sin `import` y las derivaciones no tocan nada del exterior', () => {
    expect(TEXTO_REGISTRO).not.toMatch(/^\s*import\s/m);
  });
});
