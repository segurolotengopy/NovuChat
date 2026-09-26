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
 * vitest.config.ts). La consola se importa con `lib/firebase` sustituido, para
 * no inicializar una app de Firebase.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../web/src/lib/firebase', () => ({ db: {} }));

import {
  IDS_MODULOS, MODULOS_COMUNES_HOY, PUENTE_DE_FLUJOS, REGISTRO, carpetasDe, esModulo, manifiestoDe,
  type IdModulo, type Manifiesto, type Pestana,
} from '../../functions/src/registro.ts';
import { FLUJOS } from '../../web/src/lib/flujos.ts';
import { VERTICALES_CONOCIDOS, documentoDeVertical } from '../../functions/src/prompt.ts';
import { PLANES } from '../../functions/src/planes.ts';
import { DESTINOS_F2 } from './destinos-f2.ts';

process.env['GCLOUD_PROJECT'] ??= 'demo-test';
const indice = (await import('../../functions/src/index.ts')) as Record<string, unknown>;

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(aqui, '..', '..', '..');
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');

const MANIFIESTOS = REGISTRO as readonly Manifiesto[];
const FLUJOS_HOY = Object.keys(PUENTE_DE_FLUJOS) as (keyof typeof PUENTE_DE_FLUJOS)[];
const comunes = MODULOS_COMUNES_HOY as readonly IdModulo[];
const ordenado = <T>(xs: Iterable<T>) => [...xs].sort();

// ------------------------------------------------------------ lectura de textos
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
function escrituraDe(cuerpo: string): Escritura {
  const condiciones = [...sinAnidados(cuerpo).matchAll(/allow\s+([\w,\s]+?)\s*:\s*if\s+([\s\S]*?);/g)]
    .filter((m) => /create|update|delete|write/.test(m[1] as string))
    .map((m) => (m[2] as string).trim())
    .filter((c) => c !== 'false');
  if (condiciones.length === 0) return 'solo-servidor';
  return condiciones.every((c) => /\btiene\w+\(tenantId\)/.test(c)) ? 'exige-capacidad' : 'sin-exigir';
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

  it('CERO import en registro.ts y en destinos-f2.ts, y Node los carga quitando tipos', () => {
    for (const ruta of ['admin/functions/src/registro.ts', 'admin/pruebas/core/destinos-f2.ts']) {
      const codigo = sinComentarios(leer(ruta));
      expect(codigo, ruta).not.toMatch(/^\s*import\b|\bimport\s*\(|\brequire\s*\(|^\s*export\s[^;]*?\bfrom\s/m);
      expect(codigo, `${ruta}: sintaxis que Node no borra`).not.toMatch(/\benum\s+\w|\bnamespace\s+\w|constructor\s*\(\s*(public|private|protected|readonly)\b/);
    }
    // Lo que hace `medir-zonas.mjs`: si Node no lo puede cargar, los scripts tampoco.
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
      const r = await import(${JSON.stringify(join(RAIZ, 'admin/functions/src/registro.ts'))});
      const d = await import(${JSON.stringify(join(RAIZ, 'admin/pruebas/core/destinos-f2.ts'))});
      console.log(r.REGISTRO.length, Object.keys(d.DESTINOS_F2).length > 0);`], { encoding: 'utf8' });
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
      'admin/functions/src/registro.ts', 'admin/pruebas/core/destinos-f2.ts',
      'admin/pruebas/core/registro.test.ts', 'admin/scripts/medir-zonas.mjs',
    ]) {
      const texto = leer(ruta).toLowerCase();
      for (const n of nombres) expect(texto.includes(n), `${ruta} nombra a un cliente`).toBe(false);
    }
  });
});

// ======================================================================= 2
describe('2. pestañas: el registro contra web/src/lib/flujos.ts y App.tsx', () => {
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
      .map(normal).sort(porRuta);
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

  it('toda pestaña tiene su ruta en App.tsx, protegida según sus roles', () => {
    const requiere = (p: Pestana) => (p.roles.includes('oper') ? 'miembroTenant'
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
  /** Documentos de módulo que hoy escribe el administrador de CUALQUIER comercio. Solo puede achicarse. */
  const DOCUMENTOS_SIN_CAPACIDAD_HOY = [
    'config/campanas', // Campañas es común hoy (App.tsx y la regla); F2 le da tieneModulo.
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
    const capacidades = new Set(ramas.flatMap((r) => [...r.matchAll(/\b(tiene\w+)\(tenantId\)/g)].map((m) => m[1])));
    if (flujos.length === 0) {
      expect(DOCUMENTOS_SIN_CAPACIDAD_HOY, `${documento} no es de ningún flujo y la lista no lo dice`).toContain(documento);
      expect([...capacidades], `${documento} ya exige capacidad: sacarlo de DOCUMENTOS_SIN_CAPACIDAD_HOY`).toEqual([]);
      return;
    }
    expect(flujos.length, `${documento}: más de un flujo reúne a ${declarantes.join(', ')}`).toBe(1);
    const esperada = PUENTE_DE_FLUJOS[flujos[0]!].capacidadEnReglas;
    for (const r of ramas) expect(r, `${documento}: una rama no exige ${esperada}`).toContain(`${esperada}(tenantId)`);
    expect([...capacidades]).toEqual([esperada]);
  });

  it('los campos que el módulo tiene en config/negocio están en su lista blanca', () => {
    const negocio = listaBlanca(cuerpoDeFuncion(REGLAS, 'configNegocioValida'));
    for (const m of MANIFIESTOS) for (const c of m.camposEnNegocio) expect(negocio, `${m.modulo}: ${c}`).toContain(c);
  });

  it('la tabla de campos de ConfiguracionVertical.tsx no ofrece nada que el registro no declare', () => {
    const pantalla = leer('admin/web/src/paginas/ConfiguracionVertical.tsx');
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
   * Solo puede achicarse: si la regla empieza a exigirla, la prueba pide
   * sacar la entrada.
   */
  const ESCRITURA_SIN_EXIGIR_MODULO_HOY = [
    // Productos es común a todo comercio hoy; F2 agrega tieneModulo('productos').
    'catalogo', 'fotosCatalogo', 'contadores/catalogo',
    // HALLAZGO del 26/09: `funcionarios` exige tieneAgenda, pero su
    // subcolección `privado` (datos personales) solo exige esAdmin: el admin
    // de un comercio SIN agenda puede escribir ahí. Sin funcionario visible,
    // pero escribible. Lo cierra el agente de Agenda en F2.
    'funcionarios/privado',
    // La escribe solo la ingesta del comercio (esIngesta), sin mirar el flujo.
    'agenda',
  ];
  const colecciones = MANIFIESTOS.flatMap((m) => m.colecciones.map((c) => ({ modulo: m.modulo, c })));

  it.each(colecciones)('$modulo: $c tiene su match en las reglas del tenant', ({ c }) => {
    expect(bloqueDeColeccion(c)).not.toBeNull();
  });

  it('la lista «escritura sin exigir módulo» es exactamente la de hoy', () => {
    const hoy = colecciones.filter(({ c }) => escrituraDe(bloqueDeColeccion(c) as string) === 'sin-exigir').map(({ c }) => c);
    expect(ordenado(hoy)).toEqual(ordenado(ESCRITURA_SIN_EXIGIR_MODULO_HOY));
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
  const servidor = readdirSync(join(RAIZ, 'admin/functions/src'))
    .filter((n) => n.endsWith('.ts') && n !== 'planes.ts' && n !== 'registro.ts')
    .map((n) => leer(`admin/functions/src/${n}`)).join('\n');

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

  it('toda Function que index.ts reexporta de un archivo de módulo está en el manifiesto de ese módulo', () => {
    const texto = sinComentarios(leer('admin/functions/src/index.ts'));
    for (const m of texto.matchAll(/export\s*\{([^}]*)\}\s*from\s*'\.\/([\w/]+)\.js'/g)) {
      const destino = DESTINOS_F2[`admin/functions/src/${m[2]}.ts`];
      if (destino?.zona !== 'modulo') continue;
      const duenos = [destino.modulo, ...(destino.seParte ?? []).map((s) => s.replace(/^modulo:/, ''))];
      for (const nombre of (m[1] as string).split(',').map((s) => s.trim()).filter(Boolean)) {
        const dueno = MANIFIESTOS.find((x) => (x.functions as readonly string[]).includes(nombre));
        expect(dueno, `${nombre} (de ${m[2]}.ts) no está en ningún manifiesto`).toBeDefined();
        expect(duenos, `${nombre}: lo declara ${dueno?.modulo}`).toContain(dueno?.modulo);
      }
    }
  });
});

// ======================================================================= 8
describe('8. las copias de la lista de flujos coinciden con el puente', () => {
  const claves = ordenado(FLUJOS_HOY);
  const literales = (texto: string, re: RegExp) => ordenado(new Set([...texto.matchAll(re)].map((m) => m[1] as string)));
  const conjunto = (texto: string, nombre: string) => {
    const m = new RegExp(`const ${nombre} = new Set\\(\\[([^\\]]*)\\]\\)`).exec(texto);
    if (!m) throw new Error(`sin ${nombre}`);
    return ordenado([...(m[1] as string).matchAll(/'(\w+)'/g)].map((x) => x[1] as string));
  };

  it('prompt.ts (VERTICALES_CONOCIDOS), flujos.ts (FLUJOS) e index.ts (VERTICALES)', () => {
    expect(ordenado(VERTICALES_CONOCIDOS)).toEqual(claves);
    expect(ordenado(Object.keys(FLUJOS))).toEqual(claves);
    expect(conjunto(leer('admin/functions/src/index.ts'), 'VERTICALES')).toEqual(claves);
  });

  it('firestore.rules: los literales de tieneFlujo y la capacidad de cada flujo', () => {
    expect(literales(REGLAS, /tieneFlujo\(tenantId, '(\w+)'\)/g)).toEqual(claves);
    for (const f of FLUJOS_HOY) {
      const cap = PUENTE_DE_FLUJOS[f].capacidadEnReglas;
      expect(REGLAS, `${cap} no abre ${f}`).toMatch(
        new RegExp(`function ${cap}\\(tenantId\\)\\s*\\{\\s*return tieneFlujo\\(tenantId, '${f}'\\);`));
    }
  });

  it('documento y etiqueta de catálogo: prompt.ts y flujos.ts contra el puente', () => {
    for (const f of FLUJOS_HOY) {
      expect(documentoDeVertical(f)).toBe(PUENTE_DE_FLUJOS[f].documento);
      expect(FLUJOS[f].documento).toBe(PUENTE_DE_FLUJOS[f].documento);
      expect(FLUJOS[f].catalogo).toBe(PUENTE_DE_FLUJOS[f].catalogo);
    }
    expect(documentoDeVertical('otro')).toBeNull();
  });

  // Dos copias más que el §3.3 de Analisis/41 no lista: los scripts de alta.
  it.each(['admin/scripts/alta-comercio.mjs', 'admin/scripts/asignar-numero.mjs'])(
    '%s: FLUJOS_VALIDOS y DOCUMENTO', (ruta) => {
      const texto = leer(ruta);
      expect(conjunto(texto, 'FLUJOS_VALIDOS')).toEqual(claves);
      const doc = /const DOCUMENTO = \{([^}]*)\}/.exec(texto);
      expect(doc, `${ruta} sin DOCUMENTO`).not.toBeNull();
      const pares = Object.fromEntries([...(doc![1] as string).matchAll(/(\w+):\s*'(\w+)'/g)].map((m) => [m[1], m[2]]));
      expect(pares).toEqual(Object.fromEntries(FLUJOS_HOY.map((f) => [f, PUENTE_DE_FLUJOS[f].documento])));
    });

  it('el puente solo nombra módulos del registro', () => {
    for (const f of FLUJOS_HOY) for (const m of PUENTE_DE_FLUJOS[f].modulos) expect(esModulo(m), `${f}: ${m}`).toBe(true);
    for (const m of comunes) expect(esModulo(m)).toBe(true);
    expect(TEXTO_REGISTRO).toContain('TRANSITORIO');
  });
});
