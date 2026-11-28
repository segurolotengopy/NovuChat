/**
 * PR #1151, REVISIÓN DEL 28/11/2026, obligatorios O1, O3 y O4 (mensajes de Casa Bermejo). Se prueba NEGANDO, sobre el JSON versionado y el n8n de mentira:
 *   O1  «no figura» lo arma la PIEZA COMÚN (`icAvisoNoFigura` / `icTextoNoFigura`), no Bermejo: sin groserías, con tope, con tildes, sin confundir «pantallas para la compu» con televisores ni «menú» con una pieza;
 *   O3  el trato es un dato del tenant: TODO texto fijo que el flujo emite sale bien en «usted» y en «tú» (prueba por propiedad);
 *   O4  Estándar 3.1: ningún párrafo del cuerpo de una lista de más de 10 productos pasa de 2 oraciones (primera página y «Ver más», en los dos tratos).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { ResultadoTurno } from '../../lib/n8n-de-mentira';
import { cargarFuente } from '../../core/fuente-vm';
import { ANA, CARPETA, catalogoOk, crear, hablar, modelo, mLista, mTexto, mAudio, mDocumento, mImagen, mSticker, mUbicacion } from './mundo';
import { ENLACE_CATALOGO, electro } from './catalogo-electro';

const RAIZ = join(CARPETA, '../../..');
const fuente = (r: string): string => readFileSync(join(RAIZ, r), 'utf8');
const COMUN = cargarFuente<Record<string, (...a: unknown[]) => string>>([join(RAIZ, 'Flujos/src/modulos/productos/intencion-de-catalogo.js')], ['icAvisoNoFigura', 'icTextoNoFigura']);

interface Op { usted?: boolean; enlace?: string }
const abrir = (op: Op = {}) => crear({
  catalogo: catalogoOk({}, electro()), enlaceCatalogo: op.enlace === undefined ? ENLACE_CATALOGO : op.enlace,
  modeloDice: modelo('Con gusto.'), base: { tratamiento: op.usted ? 'usted' : 'tu' },
});
const decir = (m: ReturnType<typeof abrir>, frase: string): ResultadoTurno => hablar(m, ANA, mTexto(frase), { toleraFallo: true });
const textoDe = (t: ResultadoTurno): string => t.mensajes.map((e) => e.cuerpo).join('\n');
const cuerposDeLista = (t: ResultadoTurno): string[] => t.mensajes.filter((e) => e.payload['type'] === 'interactive' && ((e.payload['interactive'] as J)['type'] === 'list')).map((e) => String((((e.payload['interactive'] as J)['body']) as J)['text']));

// ===================================================================================== O1
describe('O1: «no figura» lo arma la pieza común, no Bermejo', () => {
  const fig = (frase: string, usted = false): string => textoDe(decir(abrir({ usted }), frase));

  it('ESTRUCTURAL: el fuente de «Armar mensajes» no escribe «no figura» (fuera de comentarios) y llama a la pieza común', () => {
    const src = fuente('Flujos/clientes/casa-bermejo/src/nodos/armar-mensajes.js');
    const sinComentarios = src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(sinComentarios).not.toMatch(/no figur/i);
    expect(sinComentarios).toMatch(/icTextoNoFigura\(/);
    expect(sinComentarios).toMatch(/icAvisoNoFigura\(/);
    // y la detección de Bermejo no escribe la frase tampoco
    const det = fuente('Flujos/clientes/casa-bermejo/src/lib/bm-venta.js').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(det).not.toMatch(/no figur/i);
  });
  it('el texto emitido es EXACTAMENTE el de la pieza común', () => {
    const t = fig('¿tienen bicicletas?');
    expect(t).toContain(COMUN['icTextoNoFigura']!(['bicicletas']));
    expect(t).toContain('"bicicletas" no figura en nuestro catálogo; estas son las categorías que tenemos.');
  });
  it('conserva las tildes de lo que escribió el cliente («cámaras»)', () => {
    const t = fig('¿tienen cámaras?');
    expect(t).toContain('"cámaras" no figura');
    expect(t).not.toContain('"camaras"');
  });
  it('NO cita una grosería («putas»): sale «Eso no figura…»', () => {
    const t = fig('¿tienen putas?');
    expect(t).not.toMatch(/putas/i);
    expect(t).toContain('Eso no figura en nuestro catálogo');
  });
  it('tope de elementos citados: nunca más de 3 (los fija la pieza común)', () => {
    const t = fig('¿tienen teles, bicicletas, cámaras, drones y patines?');
    const citados = t.match(/"[^"]+"/g) ?? [];
    expect(citados.length).toBeGreaterThan(0);   // sí cita lo que no figura (la propiedad no se cumple por no citar nada)
    expect(citados.length).toBeLessThanOrEqual(3);
    expect(t).not.toContain('"patines"');
  });
  it('«pantallas para la compu» NO lleva a Televisores', () => {
    const t = fig('¿tienen pantallas para la compu?');
    expect(t).not.toMatch(/Estos son los productos de Televisores/);
    expect(t).not.toMatch(/TELEVISOR/);   // ni una lista ni una viñeta de televisores
    expect(t).not.toMatch(/no figura/);   // y tampoco se niega
  });
  it('«pantallas» a secas SÍ es un televisor (no se niega)', () => {
    const t = fig('¿tienen pantallas?');
    expect(t).toMatch(/Estos son los productos de Televisores/);
    expect(t).not.toMatch(/no figura/);
  });
  it('«¿tienen menú?» NO produce «"menú" no figura»', () => {
    const t = fig('¿tienen menú?');    expect(t).not.toMatch(/men[uú]"? no figura/i);
    expect(t).not.toMatch(/"men/i);
  });
  it('«bicis y teles»: los televisores MÁS el aviso de la pieza común', () => {
    const t = fig('¿tienen bicis y teles?');
    expect(t).toContain(COMUN['icAvisoNoFigura']!(['bicis']));
    expect(t).toMatch(/Estos son los productos de Televisores/);
  });
});

// ===================================================================================== O3
// Los textos fijos que el flujo puede emitir: cada escenario devuelve los turnos que corre.
type Escenario = { nombre: string; correr: (m: ReturnType<typeof abrir>) => ResultadoTurno[] };
const ESCENARIOS: Escenario[] = [
  { nombre: 'saludo y primer contacto', correr: (m) => [decir(m, 'hola')] },
  { nombre: 'lista de categorías (con botón aparte)', correr: (m) => [decir(m, '¿Qué productos tienen? Quiero ver el catálogo completo con precios')] },
  { nombre: 'una categoría (23) y «Ver más» dos veces y «los demás»', correr: (m) => [decir(m, '¿Qué televisores tienen y a qué precio?'), hablar(m, ANA, mLista('mas:televisores:1', 'Ver más'), { toleraFallo: true }), hablar(m, ANA, mLista('mas:televisores:2', 'Ver más'), { toleraFallo: true }), decir(m, '¿Qué otros televisores tienen? Quiero ver todos')] },
  { nombre: 'una categoría de 12 (aires)', correr: (m) => [decir(m, '¿tienen aires acondicionados?')] },
  { nombre: 'varias categorías', correr: (m) => [decir(m, '¿tienen heladeras y freezers?')] },
  { nombre: 'sin pieza', correr: (m) => [decir(m, '¿tienen bicicletas?'), decir(m, '¿tienen bicis y teles?')] },
  { nombre: 'toque viejo', correr: (m) => [hablar(m, ANA, mLista('pro:no-existe', 'Algo'), { toleraFallo: true }), hablar(m, ANA, mLista('cat:zzz', 'Algo'), { toleraFallo: true }), hablar(m, ANA, mLista('mas:televisores:99', 'Ver más'), { toleraFallo: true })] },
  { nombre: 'agregar una pieza de la lista', correr: (m) => [decir(m, '¿Qué heladeras tienen?'), hablar(m, ANA, mLista('pro:heladeras-1', 'Heladera'), { toleraFallo: true })] },
  { nombre: 'catálogo pedido a secas / el enlace', correr: (m) => [decir(m, 'pásame el catálogo'), decir(m, 'el link de la página')] },
  { nombre: 'un pedido con una lista adjunta', correr: (m) => [decir(m, 'quiero una heladera y mándenme la lista de aires')] },
  { nombre: 'identidad', correr: (m) => [decir(m, '¿eres un bot?')] },
  { nombre: 'baja', correr: (m) => [decir(m, 'dame de baja')] },
  { nombre: 'medios fijos', correr: (m) => [hablar(m, ANA, mSticker(), { toleraFallo: true }), hablar(m, ANA, mUbicacion(), { toleraFallo: true }), hablar(m, ANA, mAudio(), { toleraFallo: true }), hablar(m, ANA, mDocumento(), { toleraFallo: true }), hablar(m, ANA, mImagen(), { toleraFallo: true })] },
  { nombre: 'ubicación de la tienda y horario', correr: (m) => [decir(m, '¿dónde queda su tienda y a qué hora abren?')] },
  { nombre: 'descuento, factura y pago', correr: (m) => [decir(m, '¿hacen descuento?'), decir(m, 'necesito factura'), decir(m, 'quiero pagar')] },
];
// Formas del TUTEO (segunda persona informal): en «usted» no puede quedar ninguna.
const TUTEO = /\b(?:elige|eliges|toca|tocas|mira|miras|míralos|míralas|pídeme|pideme|escríbeme|escribeme|escríbele|dime|cuéntame|envíame|mándame|puedes|quieres|necesitas|prefieres|buscas|tu|tus|tú|te|contigo|avísame|ayúdame|indícame|háblame|llámame|sigue|espera|dime)\b/i;
// Formas de USTED: en «tú» no puede quedar ninguna.
const DE_USTED = /\b(?:usted|ustedes|elija|elíjalo|toque|mire|mírelos|mírelas|pídame|escríbame|escríbale|dígame|cuénteme|envíeme|mándeme|indíquenos|vea|escriba|aguarde|espere|sírvase)\b/i;
/** Las cadenas del mensaje que ve el cliente: cuerpo, botones, pies y títulos de menú; no las filas (nombres de producto) ni las URL. */
function cadenas(v: unknown, salida: string[] = [], clave = ''): string[] {
  if (typeof v === 'string') { if (!/^https?:\/\//.test(v) && !['id', 'type', 'messaging_product', 'to', 'recipient_type'].includes(clave)) salida.push(v); }
  else if (Array.isArray(v)) v.forEach((x) => cadenas(x, salida, clave));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as J)) { if (k === 'rows') continue; cadenas(x, salida, k); }
  return salida;
}
const textosFijos = (t: ResultadoTurno): string[] => t.mensajes.flatMap((e) => [e.cuerpo, ...cadenas(e.payload)]);
// Lo que NO se puede juzgar con el trato: el nombre de un producto o lo que escribió el cliente («¿tienes…?» citado) y lo que escribió el modelo simulado.
const EXCEPCIONES: RegExp[] = [];

describe('O3: todo texto fijo sale bien en los DOS tratamientos (prueba por propiedad)', () => {
  // EXCEPCIÓN EXPLÍCITA Y NOMBRADA (PROPIO.md:149): el texto del carrito (`bmResolverCarrito`) va fijo de «usted» y NO es de esta zona; se reporta aparte.
  const EXCEPCION_CARRITO = 'bmResolverCarrito';
  it(`la excepción declarada existe y es solo ${EXCEPCION_CARRITO} (no se cuela otra)`, () => {
    expect(fuente('Flujos/clientes/casa-bermejo/PROPIO.md')).toMatch(/Tratamiento mezclado:[^\n]*bmResolverCarrito/);
  });
  for (const usted of [true, false]) {
    for (const esc of ESCENARIOS) {
      it(`${usted ? 'usted' : 'tú'}: ${esc.nombre}`, () => {
        const turnos = esc.correr(abrir({ usted }));
        const todos = turnos.flatMap(textosFijos);
        expect(todos.length, 'el escenario no emitió nada').toBeGreaterThan(0);
        const malos: string[] = [];
        for (const tx of todos) {
          // El texto del carrito (excepción nombrada) y los textos del modelo simulado no se juzgan.
          if (/^Con gusto\.?$/.test(tx.trim()) || EXCEPCIONES.some((r) => r.test(tx))) continue;
          const re = usted ? TUTEO : DE_USTED;
          const m = re.exec(tx.replace(/«[^»]*»/g, (x) => (/ver más|ver catálogo|ver opciones/i.test(x) ? '' : x)));
          if (m) malos.push(`«${m[0]}» en: ${tx.replace(/\n/g, ' ⏎ ').slice(0, 160)}`);
        }
        // Mientras exista la excepción del carrito, los escenarios que lo emiten (pedido) se juzgan sin él.
        const reales = esc.nombre.startsWith('agregar') || esc.nombre.startsWith('un pedido') ? malos.filter((x) => !/pedido|agreg|carrito/i.test(x)) : malos;
        expect(reales).toEqual([]);
      });
    }
  }
  // PROPIEDAD ESTÁTICA: todo literal de texto de «Armar mensajes» que esté en tuteo tiene que CONVERTIRSE limpio con `bmAUsted` (o estar escrito en las dos formas con `usted ?`); así ningún texto fijo que los escenarios no alcanzan (QR anulado, «¿Cómo prefieres recibir…?») sale tuteado en «usted».
  it('todo literal de «Armar mensajes» con tuteo se convierte limpio a «usted»', () => {
    const B = cargarFuente<Record<string, (t: string) => string>>([join(CARPETA, 'src/lib/bm.js')], ['bmAUsted']);
    const src = fuente('Flujos/clientes/casa-bermejo/src/nodos/armar-mensajes.js').split('\n').filter((l) => !/^\s*\/\//.test(l) && !/\busted\b/.test(l)).join('\n');   // una línea que decide por `usted` ya trae las dos formas escritas (la cubren los escenarios)
    const literales = [...src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((x) => x[1]!).filter((x) => /[a-záéíóú]{3,}\s+[a-záéíóú]{2,}/i.test(x) && TUTEO.test(x));
    expect(literales.length, 'la propiedad no encontró ningún literal con tuteo: ¿cambió el fuente?').toBeGreaterThan(0);
    const sinConvertir = literales.filter((x) => TUTEO.test(B['bmAUsted']!(x)));
    expect(sinConvertir).toEqual([]);
  });
  it('el conversor a «usted» cubre los imperativos de las listas (propiedad directa sobre bmAUsted)', () => {
    const B = cargarFuente<Record<string, (t: string) => string>>([join(CARPETA, 'src/lib/bm.js')], ['bmAUsted']);
    const casos = ['Elige uno para agregarlo a tu pedido.', 'Toca «Ver más» para seguir.', 'Mira todo el catálogo: https://x.test', 'Pídeme el resto por categoría.', 'Míralos en el catálogo.', 'Dime cuál buscas y te lo muestro.', 'Escríbeme qué buscas y te ayudo.'];
    for (const c of casos) expect(B['bmAUsted']!(c), c).not.toMatch(TUTEO);
  });
});

// ===================================================================================== O4
describe('O4 (Estándar 3.1): ningún párrafo del cuerpo de una lista de más de 10 productos pasa de 2 oraciones', () => {
  const oraciones = (p: string): number => p.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚ¿¡«"])/).filter((x) => x.trim() !== '').length;
  for (const usted of [true, false]) {
    it(`${usted ? 'usted' : 'tú'}: Televisores (23), primera página y «Ver más»`, () => {
      const m = abrir({ usted });
      const turnos = [decir(m, '¿Qué televisores tienen y a qué precio?'), hablar(m, ANA, mLista('mas:televisores:1', 'Ver más'), { toleraFallo: true }), hablar(m, ANA, mLista('mas:televisores:2', 'Ver más'), { toleraFallo: true })];
      const cuerpos = turnos.flatMap(cuerposDeLista);
      expect(cuerpos.length).toBe(3);
      for (const c of cuerpos) for (const p of c.split(/\n\s*\n/)) expect(oraciones(p), `«${p}»`).toBeLessThanOrEqual(2);
      // el cuerpo de la primera página sí trae las 3 ideas (qué es, qué hacer, cuántos son), pero separadas
      expect(cuerpos[0]!.split(/\n\s*\n/).length).toBeGreaterThan(1);
    });
    it(`${usted ? 'usted' : 'tú'}: con «lo que no figura» antepuesto, tampoco`, () => {
      const m = abrir({ usted });
      const t = decir(m, '¿tienen bicis y televisores?');
      for (const c of cuerposDeLista(t)) for (const p of c.split(/\n\s*\n/)) expect(oraciones(p), `«${p}»`).toBeLessThanOrEqual(2);
    });
  }
});

// ===================================================================================== Menores
describe('Menores: comentarios y código muerto', () => {
  it('sin «Punto A CONFIRMAR con Andres» ni «pendiente de revisar» en el fuente de Bermejo', () => {
    for (const r of ['Flujos/clientes/casa-bermejo/src/nodos/armar-mensajes.js', 'Flujos/clientes/casa-bermejo/src/lib/bm-venta.js']) {
      expect(fuente(r)).not.toMatch(/Punto A CONFIRMAR/i);
      expect(fuente(r)).not.toMatch(/pendiente de revisar/i);
    }
  });
  it('sin código muerto: ni `bmBloqueCategoria` ni el ternario inalcanzable de «sin pieza»', () => {
    expect(fuente('Flujos/clientes/casa-bermejo/src/lib/bm-venta.js')).not.toMatch(/bmBloqueCategoria/);
    expect(fuente('Flujos/clientes/casa-bermejo/src/nodos/armar-mensajes.js')).not.toMatch(/\(usted \? 'Nuestras categorías:' : 'Nuestras categorías:'\)/);
    expect(fuente('Flujos/clientes/casa-bermejo/src/nodos/armar-mensajes.js')).not.toMatch(/\? textoConEnlace\(cuerpoModelo[^\n]*: \(mensajeCategorias\(cuerpoModelo/);
  });
});
