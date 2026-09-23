/**
 * =============================================================================
 * `scripts/datos/negocio-demo-venta.json` — EL CATÁLOGO DE LA DEMOSTRACIÓN
 * =============================================================================
 *
 * QUÉ DEFIENDE ESTA SUITE. El archivo es lo que se muestra a un prospecto: 17
 * productos con foto en la página del catálogo web del Demo B. Un archivo que
 * no cumple el contrato no se descubre al cargarlo —`cargar-negocio.mjs` lo
 * rechaza entero y no escribe nada—, se descubre delante del cliente, media
 * hora antes de la reunión, sin tiempo de arreglarlo.
 *
 * CÓMO SE VALIDA, Y POR QUÉ ASÍ. No se reimplementa el contrato acá: se
 * EJECUTA el script de verdad, en seco, contra el emulador. Un contrato
 * copiado en una prueba se queda viejo el día que cambia `firestore.rules`, y
 * entonces la prueba pasa en verde mientras la carga real falla. Lo que sí se
 * escribe acá son las condiciones propias de ESTE archivo, que el script no
 * puede saber: que estén los seis productos que el prompt del flujo nombra,
 * con su precio; que todos tengan precio (un ítem «a consultar» no se publica
 * en la página); que el catálogo quede por debajo del umbral que lo manda al
 * prompt; y que el español sea boliviano sin voseo.
 *
 * Cada regla del script se ejercita NEGANDO, sobre una copia retocada del
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
import { urlImagenValida } from '../functions/src/catalogoWeb.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'cargar-negocio.mjs');
const ARCHIVO = join(aqui, '..', 'scripts', 'datos', 'negocio-demo-venta.json');
const SEMBRAR = join(aqui, '..', 'scripts', 'sembrar-demos.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'demo-venta-datos')
  ?? initializeApp({ projectId: PROYECTO }, 'demo-venta-datos');
const db = getFirestore(app);

/** Identificadores propios de esta suite, para no pisar a ninguna otra. */
const T = 'dv-venta';
const SIN_VENTA = 'dv-sin-venta';

interface Item {
  nombre: string; descripcion?: string; area?: string;
  precio?: number; moneda?: string; imagenUrl?: string; activo: boolean;
}
interface Archivo {
  negocio: Record<string, unknown>;
  catalogo: Item[];
  [k: string]: unknown;
}
const base = JSON.parse(readFileSync(ARCHIVO, 'utf8')) as Archivo;

/** La MISMA `idDe` de `cargar-negocio.mjs` y `sembrar-demos.mjs`. */
const idDe = (nombre: string) => nombre.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const tmp = mkdtempSync(join(tmpdir(), 'demo-venta-'));
/** Tabla local vacía: este archivo no usa ningún marcador, y eso también se prueba. */
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
/** Copia profunda del archivo real con un retoque. */
const con = (retoque: (d: Archivo) => void) => { const d = structuredClone(base); retoque(d); return d; };

beforeAll(async () => {
  for (const t of [T, SIN_VENTA]) {
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
  await db.doc(`tenants/${T}`).set({
    nombre: 'Resto & Tienda Demo NovuChat', estado: 'activo', vertical: 'venta', flujos: ['venta'],
  });
  await db.doc(`tenants/${T}/cuenta/estado`).set({ plan: 'demostracion', modalidad: 'demostracion' });
  // Un comercio SIN el flujo venta, para negar el catálogo web.
  await db.doc(`tenants/${SIN_VENTA}`).set({
    nombre: 'Consultorio', estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'],
  });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('negocio-demo-venta.json: el contenido de la demostración', () => {
  it('trae entre 14 y 20 productos, en las dos áreas, y queda por debajo del umbral que lo manda al prompt', () => {
    expect(base.catalogo.length).toBeGreaterThanOrEqual(14);
    expect(base.catalogo.length).toBeLessThanOrEqual(20);
    // POR DEBAJO DE 40 A PROPÓSITO: con el catálogo completo en el prompt, en la
    // demostración el asistente puede recitar precios por chat Y mandar el
    // enlace. Por encima solo viaja un resumen por categorías.
    expect(base.catalogo.length).toBeLessThan(UMBRAL_CATALOGO_AL_PROMPT);
    const areas = new Set(base.catalogo.map((i) => i.area));
    expect([...areas].sort()).toEqual(['gastronomia', 'retail']);
    // Ninguna área vacía de contenido: con una sola tarjeta el filtro no luce.
    for (const a of areas) {
      expect(base.catalogo.filter((i) => i.area === a).length).toBeGreaterThanOrEqual(5);
    }
  });

  it('conserva los seis productos que ya tenía el Demo B, con su nombre y su precio exactos', () => {
    // La fuente es `sembrar-demos.mjs`, no una lista copiada acá: si alguien
    // cambia un precio allá, esta prueba lo dice. Se lee como TEXTO porque ese
    // script habla con Firestore apenas se importa.
    const fuente = readFileSync(SEMBRAR, 'utf8');
    const bloque = fuente.slice(fuente.indexOf("id: 'demo-venta'"), fuente.indexOf("funcionarios: []"));
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

  it('todos los ítems tienen precio en bolivianos, están activos y traen foto', () => {
    for (const i of base.catalogo) {
      // Un ítem sin precio NO se publica en el catálogo web: quedaría un hueco
      // en la vitrina justo delante del prospecto.
      expect(typeof i.precio, `«${i.nombre}» sin precio`).toBe('number');
      expect(i.precio!).toBeGreaterThan(0);
      expect(i.moneda).toBe('BOB');
      expect(i.activo).toBe(true);
      expect(i.descripcion!.length).toBeGreaterThan(0);
      expect(i.descripcion!.length).toBeLessThanOrEqual(300);
      // `urlImagenValida` es el criterio COMPARTIDO con las reglas y la Function;
      // el del script es aún más estricto y lo ejercita la prueba de abajo.
      expect(urlImagenValida(i.imagenUrl), `foto inválida en «${i.nombre}»`).toBe(true);
      expect(i.imagenUrl!.length).toBeLessThanOrEqual(500);
    }
  });

  it('los nombres producen identificadores distintos entre sí', () => {
    const ids = base.catalogo.map((i) => idDe(i.nombre));
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('enciende el catálogo web con la paleta terracota y no toca nada más del negocio', () => {
    expect(base.negocio['catalogoWebActivo']).toBe(true);
    expect(base.negocio['paleta']).toBe('terracota');
    // `mergeFields` reemplaza SOLO lo que el archivo trae: cualquier clave de
    // más acá pisaría un texto del Demo B que nadie pidió cambiar.
    expect(Object.keys(base.negocio).filter((k) => !k.startsWith('_')).sort())
      .toEqual(['catalogoWebActivo', 'paleta']);
  });

  it('no trae la sección `venta` ni ninguna otra fuera del contrato', () => {
    expect(Object.keys(base).filter((k) => !k.startsWith('_')).sort())
      .toEqual(['catalogo', 'negocio']);
  });

  it('está escrito en español boliviano, sin voseo', () => {
    const textos = [
      ...base.catalogo.map((i) => i.nombre),
      ...base.catalogo.map((i) => i.descripcion ?? ''),
    ];
    // Imperativos y presentes de voseo que se cuelan al escribir rápido. Se
    // listan SOLO las formas acentuadas («indicá», no «indica»): el imperativo
    // de tuteo es correcto y aparece en el archivo. Y el borde se escribe a
    // mano porque `\b` de JavaScript no reconoce las vocales acentuadas como
    // letras: `/pedí\b/` no casaría con «pedí » y la prueba sería un adorno.
    const VOSEO = /(^|[^a-záéíóúñ])(pedí|llevá|indicá|elegí|escribí|tomá|mirá|probá|revisá|tenés|querés|podés|sabés|venís|sos|vos)(?![a-záéíóúñ])/i;
    for (const t of textos) expect(VOSEO.test(t), `voseo en «${t}»`).toBe(false);
  });
});

describe('negocio-demo-venta.json contra cargar-negocio.mjs', () => {
  it('cumple el contrato del script y en seco no escribe nada', async () => {
    const r = correr(T, ARCHIVO);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect(r.salida).toMatch(/Flujos del comercio: venta/);
    expect(r.salida).toMatch(/nuevo\s+catalogoWebActivo\s+true/);
    expect(r.salida).toMatch(/nuevo\s+paleta\s+terracota/);
    expect(r.salida).toMatch(new RegExp(`catalogo \\(${base.catalogo.length} ítem\\(s\\)\\)`));
    expect(r.salida).toMatch(/nuevo\s+hamburguesa-doble\s+gastronomia · 35 BOB · activo/);
    expect(r.salida).toMatch(/nuevo\s+audifonos-inalambricos\s+retail · 95 BOB · activo/);
    // Ningún marcador: la tabla local de esta suite está vacía y aun así sale limpio.
    expect(r.salida).not.toMatch(/sin resolver/);
    // Nada escrito.
    expect((await db.collection(`tenants/${T}/catalogo`).get()).size).toBe(0);
    expect((await db.doc(`tenants/${T}/contadores/catalogo`).get()).exists).toBe(false);
  });

  it('en seco dice que crearía el contador en 17, con el límite del plan demostración', () => {
    const r = correr(T, ARCHIVO);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(
      new RegExp(`contador: FALTA → ${base.catalogo.length} \\(${base.catalogo.length} ítem\\(s\\) nuevo\\(s\\)\\) · límite 500 \\(plan demostracion\\)`));
    expect(r.salida).not.toMatch(/por encima del límite/);
  });

  it('con --aplicar deja el catálogo y el contador cuadrado, con sus tres claves', async () => {
    const r = correr(T, ARCHIVO, '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación: releídos/);
    const items = await db.collection(`tenants/${T}/catalogo`).get();
    expect(items.size).toBe(base.catalogo.length);
    const doble = await db.doc(`tenants/${T}/catalogo/hamburguesa-doble`).get();
    expect(doble.get('precio')).toBe(35);
    expect(doble.get('moneda')).toBe('BOB');
    expect(String(doble.get('imagenUrl'))).toMatch(/^https:\/\/images\.pexels\.com\//);
    // EL CONTADOR ES LO QUE DESTRABA LA CONSOLA. Sin él —o con una clave de
    // más— las reglas niegan crear y borrar productos desde el navegador.
    const contador = await db.doc(`tenants/${T}/contadores/catalogo`).get();
    expect(contador.get('items')).toBe(base.catalogo.length);
    expect(Object.keys(contador.data() ?? {}).sort())
      .toEqual(['actualizadoEn', 'items', 'ultimoItem']);
    const negocio = await db.doc(`tenants/${T}/config/negocio`).get();
    expect(negocio.get('catalogoWebActivo')).toBe(true);
    expect(negocio.get('paleta')).toBe('terracota');
  });

  it('repetir la misma carga NO descuadra el contador', async () => {
    const r = correr(T, ARCHIVO, '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    const contador = await db.doc(`tenants/${T}/contadores/catalogo`).get();
    expect(contador.get('items')).toBe(base.catalogo.length);
  });

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
  });

  it('NO acepta dos nombres que colapsan al mismo identificador', () => {
    const r = correr(T, archivo('id-repetido', con((d) => {
      d.catalogo[1]!.nombre = 'Hamburguesa ¡doble!';
    })), '--aplicar');
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toMatch(/repite el identificador hamburguesa-doble/);
  });

  it('NO acepta una sección `venta`: rechaza el archivo ENTERO', () => {
    const r = correr(T, archivo('con-venta', con((d) => {
      (d as Record<string, unknown>)['venta'] = { costoDelivery: 7 };
    })), '--aplicar');
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toMatch(/sección desconocida: «venta»/);
    expect(r.salida).toMatch(/No se escribió nada/);
  });

  it('NO acepta `stock` ni ninguna otra clave fuera de las ocho del ítem', () => {
    const r = correr(T, archivo('con-stock', con((d) => {
      (d.catalogo[0] as unknown as Record<string, unknown>)['stock'] = 10;
    })), '--aplicar');
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toMatch(/catalogo\[0\]: clave desconocida «stock»/);
  });

  it('NO acepta un precio fuera de rango ni una paleta inventada', () => {
    const r = correr(T, archivo('fuera-de-rango', con((d) => {
      d.catalogo[0]!.precio = 1000001;
      d.negocio['paleta'] = 'fucsia';
    })), '--aplicar');
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toMatch(/catalogo\[0\]\.precio/);
    expect(r.salida).toMatch(/negocio\.paleta/);
  });

  it('NO enciende el catálogo web en un comercio sin el flujo venta', async () => {
    const r = correr(SIN_VENTA, ARCHIVO, '--aplicar');
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(/no tiene el flujo venta: catalogoWebActivo no puede ser true/);
    expect((await db.collection(`tenants/${SIN_VENTA}/catalogo`).get()).size).toBe(0);
  });
});
