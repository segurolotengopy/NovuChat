/**
 * «VENTA DIGITAL DE RUBÉN» (tenant rroca-ruben) — LOS ANUNCIOS COMO DATO (visión por categorías, 23/10/2026). Sin red ni Firestore.
 *
 * ESCRIBE NEGANDO. El archivo `campanas-rroca-ruben.json` (los 5 anuncios aprobados) tiene que pasar las MISMAS comprobaciones que el servidor aplica sin
 * modelo (`revisarSinModelo`, el de verdad, importado de `functions/src/modulos/campanas/campanas.ts`) y cada caso malo lo rechazan los dos; lo que el servidor
 * entrega al flujo (`anunciosParaElFlujo`) lo reconoce el código del flujo (`rrAnuncioDe` para el texto; `anuncioPorTitular` del módulo común para la imagen) y los
 * tres anuncios RETIRADOS no se reconocen en ninguno de los dos caminos. Ningún ángulo ni titular lleva montos ni enlaces: el precio sale del catálogo.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as servidor from '../../../functions/src/modulos/campanas/campanas.ts';
import * as validar from '../../../scripts/datos/rroca-ruben/anuncios-validar.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '../../../..');
const DATOS = JSON.parse(readFileSync(join(RAIZ, 'admin/scripts/datos/rroca-ruben/campanas-rroca-ruben.json'), 'utf8')) as { anuncios: Array<{ id: string; titulares: string[]; productoId?: string; angulo?: string }>; diasDeVigencia: number; tenant: string };
const AHORA = Date.now();
const HOY = servidor.diaBolivia(AHORA);
const SIN_OTROS = { ids: [] as string[], nombres: [] as string[] };
const PRODUCTOS = new Set(['libro-bonos']);
const copia = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// El código evaluado es el de los archivos del propio repositorio, no una entrada externa: solo prueba.
const codigoLib = ['cobro.js', 'avisos.js', 'rr.js'].map((a) => readFileSync(join(RAIZ, 'Flujos/experimental/rroca-ruben/src/lib', a), 'utf8')).join('\n');
// nosemgrep: devsecops.js-eval-prohibido
const RR = new Function(codigoLib + '\nreturn { rrAnuncioDe };')() as Record<string, (...a: unknown[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
// nosemgrep: devsecops.js-eval-prohibido
const anuncioPorTitular = new Function(readFileSync(join(RAIZ, 'Flujos/src/core/medios/anuncio-por-titular.js'), 'utf8') + '\nreturn anuncioPorTitular;')() as (t: string, a: unknown) => { id: string; titular: string; angulo: string; producto: { nombre: string } | null } | null;

const RETIRADOS = ['La IA es mucho más que escribir textos', '¿Te escriben pero no compran?', '¿Quieres hacer videos pero no sabes cómo?'];
const CATALOGO = [{ id: 'libro-bonos', nombre: 'Libro + bonos', precio: 32, agotado: false }, { id: 'pack-completo', nombre: 'Pack completo', precio: 60, agotado: false }];
const servidorRechaza = (lista: servidor.Campana[], productos: Set<string> = PRODUCTOS): boolean => [...servidor.revisarSinModelo(lista, [], 10, AHORA, SIN_OTROS, productos).values()].some((r) => r !== null);

describe('el archivo de los anuncios de Rubén (dato del tenant)', () => {
  it('trae los 5 anuncios aprobados, para el comercio correcto, sin montos ni enlaces, con ángulos de a lo más 300 caracteres y el precio por referencia al catálogo', () => {
    expect(DATOS.tenant).toBe('rroca-ruben');
    expect(DATOS.anuncios).toHaveLength(5);
    expect(DATOS.anuncios.map((a) => a.titulares[0])).toEqual([
      'Convierte la IA en tu asistente de negocio', '¿Estás usando la IA realmente para tu negocio?', '¿No sabes qué publicar?',
      '¿Cuánto tiempo pierdes en tareas que podrías automatizar con IA?', '¿Ya tienes ChatGPT… pero no sabes cómo usarlo para tu negocio?']);
    for (const a of DATOS.anuncios) {
      expect(a.angulo!.length, a.id).toBeLessThanOrEqual(300);
      expect(JSON.stringify(a), a.id).not.toMatch(/\bBs\b|\$|usd|https?:|www\./i);
      expect(a.productoId, a.id).toBe('libro-bonos');
    }
    // Ninguno de los tres retirados está en los datos, ni como titular ni dentro de un ángulo.
    for (const retirado of RETIRADOS) expect(validar.armarLista(DATOS, HOY).flatMap((c: { titulares?: string[]; angulo?: string }) => [...(c.titulares ?? []), c.angulo ?? '']).map(servidor.palabrasDeCampana).join('|')).not.toContain(servidor.palabrasDeCampana(retirado));
  });

  // 24/10/2026 (decisión de Andres): el ángulo de «¿No sabes qué publicar?» llevaba un «;» pegado a «100 prompts», que la regla 4 del servidor (#649/#650) rechaza; se cambió SOLO ese «;» por un punto
  // (y «pregunta» pasó a «Pregunta»). Con eso las 5 campañas aprobadas pasan.
  it('las 5 campañas, incluida «¿No sabes qué publicar?» con «100 prompts», pasan las comprobaciones del archivo y las del SERVIDOR sin modelo', () => {
    expect(validar.validarArchivo(DATOS, { productosActivos: PRODUCTOS, limite: 10 })).toEqual([]);
    expect(DATOS.anuncios.find((a) => a.id === 'que-publicar')!.angulo).toBe('Habla de contenido: capítulo 6 y el bono de 100 prompts. Pregunta a qué se dedica y en qué red publica.');
    const lista = validar.armarLista(DATOS, HOY) as servidor.Campana[];
    expect(lista).toHaveLength(5);
    const r = servidor.revisarSinModelo(lista, [], 10, AHORA, SIN_OTROS, PRODUCTOS);
    for (const c of lista) expect(r.get(c.id), c.id).toBeNull();
    // Las fechas: hoy hasta hoy + 179 días (180 de vigencia), dentro del máximo de un año.
    expect(lista.every((c) => c.inicio === HOY && c.fin === validar.sumarDias(HOY, DATOS.diasDeVigencia - 1))).toBe(true);
    // El producto y el catálogo: sin el producto activo el servidor las rechaza.
    expect(servidorRechaza(lista, new Set())).toBe(true);
    expect(validar.validarArchivo(DATOS, { productosActivos: new Set(), limite: 10 }).join('|')).toMatch(/productoId.*no existe o no está activo/);
  });

  it('NEGADO: el ángulo con el «;» pegado a «100 prompts» (la redacción anterior) lo rechaza el servidor', () => {
    const d = copia(DATOS);
    d.anuncios[2]!.angulo = d.anuncios[2]!.angulo!.replace('100 prompts. Pregunta', '100 prompts; pregunta');
    const r = servidor.revisarSinModelo(validar.armarLista(d, HOY) as servidor.Campana[], [], 10, AHORA, SIN_OTROS, PRODUCTOS);
    expect(r.get('que-publicar')).toMatchObject({ estado: 'rechazada', capa: 'patrones', campo: 'angulo' });
  });

  it('las cifras del archivo de validación son las del servidor', () => {
    expect(validar.MAX_TITULARES).toBe(servidor.MAX_TITULARES);
    expect(validar.MIN_LARGO_TITULAR).toBe(servidor.MIN_LARGO_TITULAR);
    expect(validar.MAX_LARGO_TITULAR).toBe(servidor.MAX_LARGO_TITULAR);
    expect(validar.TOPE_ANGULO).toBe(servidor.TOPE_ANGULO);
    expect(validar.MAX_DIAS_DE_DURACION).toBe(servidor.MAX_DIAS_DE_DURACION);
    expect(validar.diaBolivia(AHORA)).toBe(servidor.diaBolivia(AHORA));
  });

  it('NEGADOS: cada caso malo lo rechazan el validador del archivo Y el servidor (monto en un titular, titular corto o largo, 6 titulares, ángulo largo, titular repetido en otro anuncio, producto inexistente, invisibles)', () => {
    // Se parte del archivo aprobado, que pasa entero: cada rechazo es atribuible al caso malo.
    const base = (mod: (d: typeof DATOS) => void): typeof DATOS => { const d = copia(DATOS); mod(d); return d; };
    expect(servidorRechaza(validar.armarLista(base(() => undefined), HOY) as servidor.Campana[])).toBe(false);
    const casos: Array<[string, typeof DATOS]> = [
      ['monto en un titular', base((d) => { d.anuncios[0]!.titulares = ['Desde solo 32 Bs en libros']; })],
      ['titular corto', base((d) => { d.anuncios[0]!.titulares = ['Hola']; })],
      ['titular largo', base((d) => { d.anuncios[0]!.titulares = ['x'.repeat(101)]; })],
      ['seis titulares', base((d) => { d.anuncios[0]!.titulares = ['Uno uno uno', 'Dos dos dos', 'Tres tres tres', 'Cuatro cuatro', 'Cinco cinco', 'Seis seis seis']; })],
      ['ángulo largo', base((d) => { d.anuncios[0]!.angulo = 'a'.repeat(301); })],
      ['titular repetido en otro anuncio', base((d) => { d.anuncios[1]!.titulares = [d.anuncios[0]!.titulares[0]!]; })],
      ['producto inexistente', base((d) => { d.anuncios[0]!.productoId = 'no-existe'; })],
      ['titular con caracteres invisibles', base((d) => { d.anuncios[0]!.titulares = ['Titular​ con cero ancho']; })],
    ];
    for (const [nombre, datos] of casos) {
      expect(validar.validarArchivo(datos, { productosActivos: PRODUCTOS, limite: 10 }).length, `validador: ${nombre}`).toBeGreaterThan(0);
      expect(servidorRechaza(validar.armarLista(datos, HOY) as servidor.Campana[]), `servidor: ${nombre}`).toBe(true);
    }
    // Lo que solo el archivo comprueba (el servidor lo comprueba al escribir): más anuncios de los que admite el plan, clave desconocida, id repetido, ángulo con monto o enlace.
    expect(validar.validarArchivo(DATOS, { productosActivos: PRODUCTOS, limite: 3 }).join('|')).toMatch(/plan del comercio admite 3/);
    expect(validar.validarArchivo(base((d) => { (d.anuncios[0] as Record<string, unknown>)['texto'] = '  '; }), { productosActivos: PRODUCTOS }).join('|')).toMatch(/texto: un texto con palabras/);
    expect(validar.validarArchivo(base((d) => { (d.anuncios[0] as Record<string, unknown>)['texto'] = 'Hola Rubén, consulta'; (d.anuncios[1] as Record<string, unknown>)['texto'] = 'hola rubén consulta'; }), { productosActivos: PRODUCTOS }).join('|')).toMatch(/mismo texto/);
    expect(validar.validarArchivo(base((d) => { d.anuncios[1]!.id = d.anuncios[0]!.id; }), { productosActivos: PRODUCTOS }).join('|')).toMatch(/repetido/);
    expect(validar.validarArchivo(base((d) => { d.anuncios[0]!.angulo = 'Dile que cuesta 32 Bs'; }), { productosActivos: PRODUCTOS }).join('|')).toMatch(/no lleva montos/);
    expect(validar.validarArchivo(base((d) => { d.anuncios[0]!.angulo = 'Mándalo a https://x.com/libro'; }), { productosActivos: PRODUCTOS }).join('|')).toMatch(/no lleva enlaces/);
    expect(validar.validarArchivo({ anuncios: [] }, {}).join('|')).toMatch(/al menos un anuncio/);
    expect(validar.validarArchivo(null, {}).join('|')).toMatch(/no es un objeto/);
    expect(validar.validarArchivo({ ...DATOS, extra: 1 }, {}).join('|')).toMatch(/clave desconocida: «extra»/);
    expect(validar.validarArchivo({ ...DATOS, diasDeVigencia: 400 }, {}).join('|')).toMatch(/diasDeVigencia/);
  });
});

describe('de punta a punta: lo que el servidor entrega al flujo lo reconoce el flujo (texto e imagen) y los RETIRADOS no', () => {
  // `anunciosParaElFlujo` es lo que `configuracionFlujo` manda en la clave `anuncios`: solo las vigentes, con titulares, producto y ángulo.
  const lista = validar.armarLista(DATOS, HOY) as servidor.Campana[];
  const paraElFlujo = servidor.anunciosParaElFlujo(lista, 10, AHORA, CATALOGO);

  it('el servidor entrega los 5 anuncios con a lo más 3 titulares, el ángulo y el producto del catálogo (el precio es el del catálogo, no del dato)', () => {
    expect(paraElFlujo).toHaveLength(5);
    for (const a of paraElFlujo) {
      expect(a.titulares.length).toBeLessThanOrEqual(3);
      expect(a.producto).toMatchObject({ id: 'libro-bonos', nombre: 'Libro + bonos', precio: 32 });
    }
    expect(paraElFlujo[0]!.angulo).toBe(DATOS.anuncios[0]!.angulo);
  });

  it('el CÓDIGO del flujo reconoce cada titular (principal o secundario) en un texto, devuelve el canónico y nada más que su nombre de producto; un titular ajeno o uno retirado, no', () => {
    for (const a of DATOS.anuncios) for (const t of a.titulares) {
      const h = RR['rrAnuncioDe']!(`vi esto: ${t}`, paraElFlujo);
      expect(h?.id, t).toBe(a.id);
      expect(h.titular, t).toBe(a.titulares[0]!.normalize('NFKC')); // (el rótulo del modelo va en NFKC: «…» pasa a «...»)
      expect(h.producto, t).toBe('Libro + bonos');
      expect(JSON.stringify(h), t).not.toMatch(/32|precio/i);
    }
    for (const t of [...RETIRADOS, 'Compra el libro con 90% de descuento', 'La IA', 'hola, quiero saber el precio']) expect(RR['rrAnuncioDe']!(t, paraElFlujo), t).toBeNull();
  });

  it('el módulo común de la imagen (`anuncioPorTitular`) reconoce el titular principal leído de una captura, y NO un titular ajeno, uno retirado ni la insignia de precio', () => {
    for (const a of DATOS.anuncios) {
      const h = anuncioPorTitular(a.titulares[0]!, paraElFlujo);
      expect(h?.id, a.id).toBe(a.id);
      expect(h!.titular, a.id).toBe(a.titulares[0]);
      expect(h!.angulo, a.id).toBe(a.angulo);
    }
    for (const t of [...RETIRADOS, 'Desde solo 32 Bs', 'Compra ya con 90% de descuento', '']) expect(anuncioPorTitular(t, paraElFlujo), t).toBeNull();
    // Un anuncio sin producto en el catálogo no inventa precio: `producto` es null.
    const sinProducto = servidor.anunciosParaElFlujo(lista, 10, AHORA, []);
    expect(sinProducto[0]!.producto).toBeNull();
    expect(anuncioPorTitular(DATOS.anuncios[0]!.titulares[0]!, sinProducto)!.producto).toBeNull();
  });
});
