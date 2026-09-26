/**
 * =============================================================================
 * `scripts/datos/negocio-demo-venta-*.json` — LOS CATÁLOGOS DE LA DEMOSTRACIÓN
 * =============================================================================
 *
 * SON DOS ARCHIVOS Y LOS DOS SE MUESTRAN. El Demo B (`demo-venta`) se viste de
 * dos maneras según a quién se le enseñe:
 *
 *   `-resto`     «Resto & Tienda Demo NovuChat», 17 productos en bolivianos con
 *                la foto ENLAZADA. Es el genérico, para un prospecto sin rubro.
 *   `-walisuma`  el catálogo real de Walisuma —artesanía boliviana de alta gama,
 *                sacado de su PDF— con 154 productos en dólares y la foto
 *                SUBIDA. Es el que se muestra a esa marca.
 *
 * Son EXCLUYENTES en Firestore: el último que se carga es el que se ve. Acá se
 * validan los dos con las MISMAS reglas, porque los dos se cargan con el mismo
 * script y los dos terminan delante de un cliente. Antes esta suite miraba uno
 * solo; el día que se agregó el segundo, ninguna prueba lo cubría.
 *
 * QUÉ DEFIENDE. Un archivo que no cumple el contrato no se descubre al
 * cargarlo —`cargar-negocio.mjs` lo rechaza entero y no escribe nada—, se
 * descubre delante del cliente, media hora antes de la reunión, sin tiempo de
 * arreglarlo.
 *
 * CÓMO SE VALIDA, Y POR QUÉ ASÍ. No se reimplementa el contrato acá: se
 * EJECUTA el script de verdad, en seco, contra el emulador. Un contrato
 * copiado en una prueba se queda viejo el día que cambia `firestore.rules`, y
 * entonces la prueba pasa en verde mientras la carga real falla. Lo que sí se
 * escribe acá son las condiciones propias de ESTOS archivos, que el script no
 * puede saber: que todos tengan precio (un ítem «a consultar» no se publica en
 * la página); que los identificadores no colisionen; que el español sea
 * boliviano sin voseo; que el de resto conserve los seis productos que el
 * prompt del flujo nombra; que el de Walisuma se presente como DEMOSTRACIÓN y
 * no como la tienda de la marca; y de qué lado del umbral cae cada uno.
 *
 * Cada regla del script se ejercita NEGANDO, sobre una copia retocada de un
 * archivo real: una URL con una coma, dos nombres que colapsan al mismo
 * identificador, una sección `venta`, `catalogoWebActivo` en un comercio sin
 * el flujo de venta. Si el script dejara de mirar cualquiera de esas cosas, la
 * prueba se cae acá y no en la demostración.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { UMBRAL_CATALOGO_AL_PROMPT } from '../functions/src/prompt.ts';
import { limitesDe } from '../functions/src/planes.ts';
import { urlImagenValida } from '../functions/src/catalogoWeb.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'cargar-negocio.mjs');
const DATOS = join(aqui, '..', 'scripts', 'datos');
const SEMBRAR = join(aqui, '..', 'scripts', 'sembrar-demos.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'demo-venta-datos')
  ?? initializeApp({ projectId: PROYECTO }, 'demo-venta-datos');
const db = getFirestore(app);

interface Item {
  nombre: string; descripcion?: string; area?: string;
  precio?: number; moneda?: string; imagenUrl?: string; activo: boolean;
}
interface Archivo {
  negocio: Record<string, unknown>;
  catalogo: Item[];
  [k: string]: unknown;
}

/**
 * UN COMERCIO POR ARCHIVO, y no uno compartido. `cargar-negocio.mjs` no borra
 * los ítems que el archivo no nombra —y hace bien: no es su trabajo—, así que
 * cargar los dos sobre el mismo tenant dejaría 171 productos y el contador no
 * cuadraría con ninguno de los dos. En producción son excluyentes porque el
 * operador limpia entre uno y otro; acá se separan y se prueba cada uno limpio.
 */
const CONJUNTOS = [
  {
    nombre: 'resto', tenant: 'dv-venta', moneda: 'BOB',
    archivo: join(DATOS, 'negocio-demo-venta-resto.json'),
    areas: ['gastronomia', 'retail'],
    // ENLAZADAS: el comercio referencia fotos que ya tiene publicadas.
    fotoEnlazada: true,
    bajoElUmbral: true,
    muestra: /nuevo\s+hamburguesa-doble\s+gastronomia · 35 BOB · activo/,
  },
  {
    nombre: 'walisuma', tenant: 'dv-venta-wali', moneda: 'USD',
    archivo: join(DATOS, 'negocio-demo-venta-walisuma.json'),
    areas: ['abrigos', 'accesorios', 'cuero', 'hogar y oficina',
            'ruanas y chales', 'souvenirs', 'sweaters'],
    // SUBIDAS a `fotosCatalogo` con `cargar-fotos-catalogo.mjs`: son fotos de
    // producto de un tercero y no se publican en este repositorio.
    fotoEnlazada: false,
    bajoElUmbral: false,
    muestra: /nuevo\s+cartera-emilie\s+cuero · 900 USD · activo/,
  },
] as const;

const SIN_VENTA = 'dv-sin-venta';
const leerArchivo = (r: string) => JSON.parse(readFileSync(r, 'utf8')) as Archivo;

/** La MISMA `idDe` de `cargar-negocio.mjs` y `sembrar-demos.mjs`. */
const idDe = (nombre: string) => nombre.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const tmp = mkdtempSync(join(tmpdir(), 'demo-venta-'));
/** Tabla local vacía: estos archivos no usan ningún marcador, y eso también se prueba. */
const LOCAL = join(tmp, 'CONFIGURACION.local.md');
writeFileSync(LOCAL, '# sin marcadores\n');

function archivo(nombre: string, datos: unknown) {
  const ruta = join(tmp, `${nombre}.json`);
  writeFileSync(ruta, JSON.stringify(datos));
  return ruta;
}
function correr(tenant: string, ruta: string, ...extra: string[]) {
  const r = spawnSync(process.execPath,
    [SCRIPT, '--proyecto', PROYECTO, '--tenant', tenant, '--archivo', ruta, '--local', LOCAL, ...extra],
    { env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8' });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}

beforeAll(async () => {
  for (const t of [...CONJUNTOS.map((c) => c.tenant), SIN_VENTA]) {
    for (const d of ['config/negocio', 'contadores/catalogo', 'cuenta/estado']) {
      await db.doc(`tenants/${t}/${d}`).delete();
    }
    for (const col of ['catalogo', 'auditoria']) {
      for (const x of (await db.collection(`tenants/${t}/${col}`).get()).docs) await x.ref.delete();
    }
  }
  // Como está demo-venta en producción: flujo `venta`, plan `demostracion`,
  // sin contador de catálogo (es justamente lo que esta carga tiene que dejar
  // bien) y sin `catalogoWebActivo`.
  for (const c of CONJUNTOS) {
    await db.doc(`tenants/${c.tenant}`).set({
      nombre: 'Demo B', estado: 'activo', vertical: 'venta', flujos: ['venta'],
    });
    // Un demo desde F1: modalidad demostración con un plan del catálogo y su copia de límites (Pro, como tenían).
    await db.doc(`tenants/${c.tenant}/cuenta/estado`).set({ plan: 'pro', limites: limitesDe('pro'), modalidad: 'demostracion' });
  }
  // Un comercio SIN el flujo venta, para negar el catálogo web.
  await db.doc(`tenants/${SIN_VENTA}`).set({
    nombre: 'Consultorio', estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'],
  });
}, 60_000);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// =============================================================================
// LAS MISMAS REGLAS PARA LOS DOS ARCHIVOS
// =============================================================================
for (const c of CONJUNTOS) describe(`negocio-demo-venta-${c.nombre}.json`, () => {
  const base = leerArchivo(c.archivo);

  it('tiene catálogo, con las áreas esperadas y ninguna área de una sola tarjeta', () => {
    expect(base.catalogo.length).toBeGreaterThanOrEqual(14);
    const areas = [...new Set(base.catalogo.map((i) => i.area))].sort();
    expect(areas).toEqual([...c.areas].sort());
    // Con una sola tarjeta el filtro por área no luce.
    for (const a of areas) {
      expect(base.catalogo.filter((i) => i.area === a).length,
        `el área «${a}» tiene muy pocos ítems`).toBeGreaterThanOrEqual(5);
    }
  });

  it('cae del lado del umbral que le corresponde, y eso cambia lo que hace el asistente', () => {
    // POR DEBAJO DE 40: el catálogo entero viaja al prompt y el asistente puede
    // recitar precios por chat Y mandar el enlace. POR ENCIMA: al prompt va solo
    // un resumen por categorías y el asistente DERIVA al enlace. Las dos cosas
    // están bien; lo que no puede pasar es que nadie sepa en cuál está.
    if (c.bajoElUmbral) expect(base.catalogo.length).toBeLessThan(UMBRAL_CATALOGO_AL_PROMPT);
    else expect(base.catalogo.length).toBeGreaterThan(UMBRAL_CATALOGO_AL_PROMPT);
  });

  it('todos los ítems tienen precio en la moneda del archivo, están activos y traen descripción', () => {
    for (const i of base.catalogo) {
      // Un ítem sin precio NO se publica en el catálogo web: quedaría un hueco
      // en la vitrina justo delante del prospecto.
      expect(typeof i.precio, `«${i.nombre}» sin precio`).toBe('number');
      expect(i.precio!).toBeGreaterThan(0);
      expect(i.moneda).toBe(c.moneda);
      expect(i.activo).toBe(true);
      expect(i.nombre.length).toBeGreaterThan(0);
      expect(i.nombre.length).toBeLessThanOrEqual(80);
      expect(typeof i.descripcion).toBe('string');
      expect(i.descripcion!.length).toBeLessThanOrEqual(300);
      expect(i.area!.length).toBeLessThanOrEqual(40);
      // Área en minúsculas y sin tildes: es lo que se pinta en el chip.
      expect(i.area, `área con mayúsculas o tildes en «${i.nombre}»`).toBe(
        i.area!.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
    }
  });

  /**
   * UNA DESCRIPCIÓN VACÍA SE TOLERA; UNA INVENTADA NO. En el catálogo de
   * Walisuma hay nueve piezas —cuatro fuentes de madera, dos bolsos de aguayo,
   * un jabón, un joyero y una tote— a las que el PDF de la marca no le imprime
   * ningún subtítulo. Rellenarlas «para que no queden vacías» sería ponerle a
   * la marca una frase que no dijo, que es exactamente lo que no se puede hacer
   * en una demostración con material ajeno. La tarjeta se ve bien sin ella.
   * Lo que sí se vigila es que sean pocas: si la mayoría quedara vacía, la
   * extracción se rompió y hay que mirarla, no publicarla.
   */
  it('casi todos los ítems traen la descripción del catálogo original', () => {
    const vacias = base.catalogo.filter((i) => !i.descripcion);
    expect(vacias.length / base.catalogo.length,
      `${vacias.length} de ${base.catalogo.length} sin descripción`).toBeLessThan(0.1);
  });

  it('las fotos son del origen que le toca a este conjunto', () => {
    for (const i of base.catalogo) {
      if (c.fotoEnlazada) {
        // `urlImagenValida` es el criterio COMPARTIDO con las reglas y la Function;
        // el del script es aún más estricto y lo ejercita la prueba de abajo.
        expect(urlImagenValida(i.imagenUrl), `foto inválida en «${i.nombre}»`).toBe(true);
        expect(i.imagenUrl!.length).toBeLessThanOrEqual(500);
      } else {
        // La foto SUBIDA gana sobre el enlace (`SitioCatalogo.tsx`): un
        // `imagenUrl` acá sería un enlace que nunca se va a ver, y peor, uno
        // que se vería si la subida fallara.
        expect(i.imagenUrl, `«${i.nombre}» trae imagenUrl y sus fotos van subidas`).toBeUndefined();
      }
    }
  });

  it('los nombres producen identificadores distintos entre sí', () => {
    const ids = base.catalogo.map((i) => idDe(i.nombre));
    expect(ids.every((id) => id.length > 0)).toBe(true);
    const repetidos = ids.filter((id, k) => ids.indexOf(id) !== k);
    expect([...new Set(repetidos)]).toEqual([]);
  });

  it('enciende el catálogo web con una paleta de la lista cerrada', () => {
    expect(base.negocio['catalogoWebActivo']).toBe(true);
    expect(['terracota', 'bosque', 'indigo', 'vino', 'oceano'])
      .toContain(base.negocio['paleta']);
  });

  it('trae la identidad completa, para poder volver desde el otro archivo', () => {
    // `mergeFields` reemplaza SOLO lo que el archivo trae. Si uno de los dos no
    // trajera el nombre, la descripción y la moneda, cargar el otro dejaría el
    // nombre y la moneda del anterior puestos y nadie lo notaría hasta verlo en
    // la página.
    for (const k of ['nombreNegocio', 'descripcion', 'moneda']) {
      expect(base.negocio[k], `falta negocio.${k}`).toBeTruthy();
    }
    expect(base.negocio['moneda']).toBe(c.moneda);
  });

  it('no trae la sección `venta` ni ninguna otra fuera del contrato', () => {
    expect(Object.keys(base).filter((k) => !k.startsWith('_')).sort())
      .toEqual(['catalogo', 'negocio']);
  });

  it('está escrito en español boliviano, sin voseo', () => {
    const textos = [
      ...base.catalogo.map((i) => i.nombre),
      ...base.catalogo.map((i) => i.descripcion ?? ''),
      String(base.negocio['descripcion'] ?? ''),
      String(base.negocio['instruccionesExtra'] ?? ''),
    ];
    // Imperativos y presentes de voseo que se cuelan al escribir rápido. Se
    // listan SOLO las formas acentuadas («indicá», no «indica»): el imperativo
    // de tuteo es correcto y aparece en el archivo. Y el borde se escribe a
    // mano porque `\b` de JavaScript no reconoce las vocales acentuadas como
    // letras: `/pedí\b/` no casaría con «pedí » y la prueba sería un adorno.
    const VOSEO = /(^|[^a-záéíóúñ])(pedí|llevá|indicá|elegí|escribí|tomá|mirá|probá|revisá|tenés|querés|podés|sabés|venís|sos|vos)(?![a-záéíóúñ])/i;
    for (const t of textos) expect(VOSEO.test(t), `voseo en «${t}»`).toBe(false);
  });

  it('cumple el contrato del script y en seco no escribe nada', async () => {
    const r = correr(c.tenant, c.archivo);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect(r.salida).toMatch(/Flujos del comercio: venta/);
    expect(r.salida).toMatch(/nuevo\s+catalogoWebActivo\s+true/);
    expect(r.salida).toMatch(new RegExp(`catalogo \\(${base.catalogo.length} ítem\\(s\\)\\)`));
    expect(r.salida).toMatch(c.muestra);
    // Ningún marcador: la tabla local de esta suite está vacía y aun así sale limpio.
    expect(r.salida).not.toMatch(/sin resolver/);
    // Nada escrito.
    expect((await db.collection(`tenants/${c.tenant}/catalogo`).get()).size).toBe(0);
    expect((await db.doc(`tenants/${c.tenant}/contadores/catalogo`).get()).exists).toBe(false);
  }, 60_000);

  it('en seco dice que crearía el contador, con el límite de la copia de la cuenta (Pro, 500)', () => {
    const r = correr(c.tenant, c.archivo);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(new RegExp(
      `contador: FALTA → ${base.catalogo.length} \\(${base.catalogo.length} ítem\\(s\\) nuevo\\(s\\)\\)`
      + ' · límite 500 \\(limites.productos\\)'));
    expect(r.salida).not.toMatch(/por encima del límite/);
  }, 60_000);

  it('con --aplicar deja el catálogo y el contador cuadrado, con sus tres claves', async () => {
    const r = correr(c.tenant, c.archivo, '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación: releídos/);
    const items = await db.collection(`tenants/${c.tenant}/catalogo`).get();
    expect(items.size).toBe(base.catalogo.length);
    // EL CONTADOR ES LO QUE DESTRABA LA CONSOLA. Sin él —o con una clave de
    // más— las reglas niegan crear y borrar productos desde el navegador.
    const contador = await db.doc(`tenants/${c.tenant}/contadores/catalogo`).get();
    expect(contador.get('items')).toBe(base.catalogo.length);
    expect(Object.keys(contador.data() ?? {}).sort())
      .toEqual(['actualizadoEn', 'items', 'ultimoItem']);
    const negocio = await db.doc(`tenants/${c.tenant}/config/negocio`).get();
    expect(negocio.get('catalogoWebActivo')).toBe(true);
    expect(negocio.get('paleta')).toBe(base.negocio['paleta']);
    expect(negocio.get('moneda')).toBe(c.moneda);
    expect(negocio.get('nombreNegocio')).toBe(base.negocio['nombreNegocio']);
  }, 60_000);

  it('repetir la misma carga NO descuadra el contador', async () => {
    const r = correr(c.tenant, c.archivo, '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    const contador = await db.doc(`tenants/${c.tenant}/contadores/catalogo`).get();
    expect(contador.get('items')).toBe(base.catalogo.length);
  }, 60_000);

  it('NO enciende el catálogo web en un comercio sin el flujo venta', async () => {
    const r = correr(SIN_VENTA, c.archivo, '--aplicar');
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(/no tiene el flujo venta: catalogoWebActivo no puede ser true/);
    expect((await db.collection(`tenants/${SIN_VENTA}/catalogo`).get()).size).toBe(0);
  }, 60_000);
});

// =============================================================================
// LO PROPIO DE CADA UNO
// =============================================================================
describe('negocio-demo-venta-resto.json: lo que el prompt del flujo nombra', () => {
  const base = leerArchivo(CONJUNTOS[0].archivo);

  it('trae entre 14 y 20 productos', () => {
    expect(base.catalogo.length).toBeGreaterThanOrEqual(14);
    expect(base.catalogo.length).toBeLessThanOrEqual(20);
  });

  it('conserva los seis productos que ya tenía el Demo B, con su nombre y su precio exactos', () => {
    // La fuente es `sembrar-demos.mjs`, no una lista copiada acá: si alguien
    // cambia un precio allá, esta prueba lo dice. Se lee como TEXTO porque ese
    // script habla con Firestore apenas se importa.
    const fuente = readFileSync(SEMBRAR, 'utf8');
    const bloque = fuente.slice(fuente.indexOf("id: 'demo-venta'"), fuente.indexOf('funcionarios: []'));
    const originales = [...bloque.matchAll(/\{ nombre: '([^']+)', area: '([^']+)', precio: (\d+)/g)]
      .map((m) => ({ nombre: m[1], area: m[2], precio: Number(m[3]) }));
    expect(originales.length).toBe(6);
    for (const o of originales) {
      const item = base.catalogo.find((i) => i.nombre === o.nombre);
      expect(item, `falta «${o.nombre}», que el prompt del flujo nombra`).toBeDefined();
      expect(item!.precio, `cambió el precio de «${o.nombre}»`).toBe(o.precio);
      expect(item!.area).toBe(o.area);
    }
  });
});

describe('negocio-demo-venta-walisuma.json: una demostración, no la tienda de la marca', () => {
  const base = leerArchivo(CONJUNTOS[1].archivo);
  const negocio = base.negocio as Record<string, string | string[] | boolean>;

  /**
   * ESTA ES LA PRUEBA QUE IMPORTA DE ESTE ARCHIVO. Es una demostración PARA
   * Walisuma, con su propio material, y eso está bien. Lo que no puede pasar es
   * que el asistente se presente COMO Walisuma: el nombre del negocio es lo
   * primero que el prompt le dice al modelo sobre quién es, y es lo que
   * encabeza la página del catálogo web.
   */
  it('se presenta como demostración en el nombre y en la descripción', () => {
    expect(String(negocio['nombreNegocio']).toLowerCase()).toMatch(/demostraci[óo]n/);
    expect(String(negocio['descripcion']).toLowerCase()).toMatch(/demostraci[óo]n/);
    expect(String(negocio['descripcion']).toLowerCase())
      .toMatch(/no es la tienda de walisuma/);
    expect(String(negocio['instruccionesExtra']).toLowerCase())
      .toMatch(/no es la tienda de walisuma/);
  });

  /**
   * LO QUE NO SE SABE VA EN `datosQueNoTenemos`, que es lo que hace que el
   * asistente lo diga en vez de inventarlo (`prompt.ts`). El PDF de Walisuma no
   * dice nada de envíos, pagos, plazos, garantías, stock ni tallas: si alguna de
   * esas listas se cayera del archivo, el modelo tendría vía libre para
   * improvisar un plazo de entrega en boca de la marca.
   */
  it('declara como desconocido todo lo que el catálogo de la marca no dice', () => {
    const faltantes = (negocio['datosQueNoTenemos'] as string[]).join(' · ').toLowerCase();
    for (const tema of ['env', 'pago', 'stock', 'tallas', 'garant', 'promocion', 'direccion']) {
      expect(faltantes, `«${tema}» no está en datosQueNoTenemos`).toMatch(tema);
    }
    expect((negocio['datosQueNoTenemos'] as string[]).length).toBeLessThanOrEqual(20);
    for (const d of negocio['datosQueNoTenemos'] as string[]) {
      expect(d.length).toBeGreaterThan(0);
      expect(d.length).toBeLessThanOrEqual(80);
    }
  });

  /**
   * NI UN DATO DE CONTACTO DE LA MARCA. El PDF trae dos direcciones y dos
   * números de WhatsApp de Walisuma en su última página. No se cargan: el
   * repositorio es público, y un teléfono de un tercero puesto en boca del
   * asistente es precisamente lo que no se puede hacer. La prueba mira el
   * archivo ENTERO, no solo la sección `negocio`, porque una descripción de
   * producto también es texto que sale por WhatsApp.
   */
  it('no lleva teléfonos, direcciones ni sitios de Walisuma', () => {
    const todo = JSON.stringify(base);
    expect(todo).not.toMatch(/walisuma\.(org|com)/i);
    expect(todo).not.toMatch(/@walisumabolivia/i);
    expect(todo).not.toMatch(/\bWA:\s*\d/i);
    // Cualquier corrida de 7 o más dígitos: un teléfono boliviano entra ahí, y
    // ningún precio ni medida de este catálogo llega a siete cifras.
    expect(todo.replace(/\\u[0-9a-f]{4}/gi, '')).not.toMatch(/\d{7,}/);
    expect(todo).not.toMatch(/Claudio Aliaga|Equipetrol|Marcelo Terceros/i);
  });

  it('los precios están en dólares y son enteros razonables para el rubro', () => {
    for (const i of base.catalogo) {
      expect(i.moneda).toBe('USD');
      expect(Number.isInteger(i.precio)).toBe(true);
      expect(i.precio!).toBeGreaterThanOrEqual(7);
      expect(i.precio!).toBeLessThanOrEqual(900);
    }
  });

  /**
   * LO QUE SE DEJÓ FUERA SE ESCRIBE. El PDF trae precios en rango
   * («$211-$221»), precios contradictorios entre dos páginas y nombres que solo
   * se distinguen por un color que el PDF no imprime. Nada de eso se carga, y el
   * archivo tiene que decir POR QUÉ: sin esa lista, el próximo que lo lea va a
   * creer que la extracción se olvidó de veintidós productos.
   */
  it('deja escrito qué quedó fuera del PDF y por qué', () => {
    const fuera = base['_fuera'] as string[];
    expect(Array.isArray(fuera)).toBe(true);
    expect(fuera.length).toBeGreaterThan(0);
    for (const f of fuera) expect(f).toMatch(/→/);
    expect(fuera.join(' ')).toMatch(/rango/);
  });
});

// =============================================================================
// ALTERNAR ENTRE LOS DOS VESTIDOS DEL MISMO COMERCIO
// =============================================================================
/**
 * ES LA OPERACIÓN DE LA REUNIÓN, y hasta hoy no existía. Los dos archivos caen
 * sobre `demo-venta`, y `cargar-negocio.mjs` —con razón— no borra lo que el
 * archivo no nombra. Cargar Walisuma encima del genérico dejaba 171 productos:
 * una hamburguesa entre los abrigos de baby alpaca, delante del prospecto. Se
 * vio en el diagnóstico en seco contra producción el 22/09, no en una prueba,
 * que es la razón por la que esta prueba existe.
 */
describe('alternar los dos demos sobre el MISMO comercio, con --vaciar-ajenos', () => {
  const T = 'dv-venta-alterna';
  const [resto, wali] = CONJUNTOS;

  beforeAll(async () => {
    for (const x of (await db.collection(`tenants/${T}/catalogo`).get()).docs) await x.ref.delete();
    await db.doc(`tenants/${T}/contadores/catalogo`).delete();
    await db.doc(`tenants/${T}`).set({
      nombre: 'Demo B', estado: 'activo', vertical: 'venta', flujos: ['venta'],
    });
    await db.doc(`tenants/${T}/cuenta/estado`).set({ plan: 'pro', limites: limitesDe('pro'), modalidad: 'demostracion' });
  }, 60_000);

  it('sin la bandera, el segundo archivo se SUMA al primero y lo dice', async () => {
    expect(correr(T, resto.archivo, '--aplicar').codigo).toBe(0);
    const r = correr(T, wali.archivo);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/ítem\(s\) existente\(s\) que el archivo no nombra quedan como están/);
    expect(r.salida).toMatch(/con --vaciar-ajenos se borran/);
  }, 60_000);

  it('en seco con la bandera, lista lo que borraría y no borra nada', async () => {
    const r = correr(T, wali.archivo, '--vaciar-ajenos');
    expect(r.codigo, r.salida).toBe(0);
    // `BORRA` va en rojo: entre la palabra y el identificador hay un código ANSI.
    expect(r.salida).toMatch(/BORRA.*hamburguesa-doble/);
    expect(r.salida).toMatch(/contador: 17 → 154/);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    const items = await db.collection(`tenants/${T}/catalogo`).get();
    expect(items.size).toBe(leerArchivo(resto.archivo).catalogo.length);
  }, 60_000);

  it('con --aplicar deja SOLO el catálogo del archivo, y el contador cuadrado', async () => {
    const esperado = leerArchivo(wali.archivo).catalogo.length;
    const r = correr(T, wali.archivo, '--vaciar-ajenos', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    const items = await db.collection(`tenants/${T}/catalogo`).get();
    expect(items.size).toBe(esperado);
    expect((await db.doc(`tenants/${T}/catalogo/hamburguesa-doble`).get()).exists).toBe(false);
    // EL CONTADOR TIENE QUE BAJAR TAMBIÉN. Si solo subiera, el comercio se
    // quedaría sin cupo de plan por productos que ya no existen, y las reglas
    // le negarían crear desde la consola sin que nada lo explique.
    expect((await db.doc(`tenants/${T}/contadores/catalogo`).get()).get('items')).toBe(esperado);
  }, 120_000);

  it('y se puede volver al genérico con el mismo comando', async () => {
    const esperado = leerArchivo(resto.archivo).catalogo.length;
    const r = correr(T, resto.archivo, '--vaciar-ajenos', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    const items = await db.collection(`tenants/${T}/catalogo`).get();
    expect(items.size).toBe(esperado);
    expect((await db.doc(`tenants/${T}/catalogo/cartera-emilie`).get()).exists).toBe(false);
    expect((await db.doc(`tenants/${T}/contadores/catalogo`).get()).get('items')).toBe(esperado);
    const negocio = await db.doc(`tenants/${T}/config/negocio`).get();
    expect(negocio.get('nombreNegocio')).toBe('Resto & Tienda Demo NovuChat');
    expect(negocio.get('moneda')).toBe('BOB');
  }, 120_000);
});

// =============================================================================
// CADA REGLA DEL SCRIPT, NEGADA
// =============================================================================
/**
 * Se niegan sobre UN archivo y no sobre los dos: lo que se está probando acá es
 * el script, que es el mismo para los dos, y cada caso arranca un proceso.
 * Duplicarlos costaría el doble de tiempo sin cubrir una línea más.
 */
describe('cargar-negocio.mjs rechaza lo que no cumple el contrato', () => {
  const T = CONJUNTOS[0].tenant;
  const base = leerArchivo(CONJUNTOS[0].archivo);
  /** Copia profunda del archivo real con un retoque. */
  const con = (retoque: (d: Archivo) => void) => { const d = structuredClone(base); retoque(d); return d; };

  it('NO acepta una URL de foto con una coma, un paréntesis o sin https', () => {
    for (const mala of [
      'https://images.pexels.com/photos/1/foto,1.jpeg',
      'https://images.pexels.com/photos/1/foto(1).jpeg',
      'http://images.pexels.com/photos/1/foto.jpeg',
    ]) {
      const r = correr(T, archivo('foto-mala', con((d) => { d.catalogo[0]!.imagenUrl = mala; })), '--aplicar');
      expect(r.codigo, `${mala} → ${r.salida}`).toBe(2);
      expect(r.salida).toMatch(/imagenUrl: una dirección https:\/\//);
      expect(r.salida).toMatch(/No se escribió nada/);
    }
  }, 60_000);

  it('NO acepta dos nombres que colapsan al mismo identificador', () => {
    const r = correr(T, archivo('id-repetido', con((d) => {
      d.catalogo[1]!.nombre = `${d.catalogo[0]!.nombre} ¡!`;
    })), '--aplicar');
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toMatch(/repite el identificador/);
  }, 60_000);

  it('NO acepta una sección `venta`: rechaza el archivo ENTERO', () => {
    const r = correr(T, archivo('con-venta', con((d) => {
      (d as Record<string, unknown>)['venta'] = { costoDelivery: 7 };
    })), '--aplicar');
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toMatch(/sección desconocida: «venta»/);
    expect(r.salida).toMatch(/No se escribió nada/);
  }, 60_000);

  it('NO acepta `stock` ni ninguna otra clave fuera de las ocho del ítem', () => {
    const r = correr(T, archivo('con-stock', con((d) => {
      (d.catalogo[0] as unknown as Record<string, unknown>)['stock'] = 10;
    })), '--aplicar');
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toMatch(/catalogo\[0\]: clave desconocida «stock»/);
  }, 60_000);

  it('NO acepta un precio fuera de rango ni una paleta inventada', () => {
    const r = correr(T, archivo('fuera-de-rango', con((d) => {
      d.catalogo[0]!.precio = 1000001;
      d.negocio['paleta'] = 'fucsia';
    })), '--aplicar');
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toMatch(/catalogo\[0\]\.precio/);
    expect(r.salida).toMatch(/negocio\.paleta/);
  }, 60_000);
});
