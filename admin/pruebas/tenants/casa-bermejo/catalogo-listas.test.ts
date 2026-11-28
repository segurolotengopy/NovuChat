/**
 * LA BATERÍA DE ATAQUE DEL CATÁLOGO DE CASA BERMEJO (B2, 27/11/2026): los 39 casos de `BERMEJO_bateria-ataque-catalogo_2026-11-27.md` (5 frases literales de Andres + 34 variantes) sobre el JSON VERSIONADO, con el n8n de mentira y un modelo simulado
 * (incluso uno que niega el catálogo, resume, corta a 3, inventa un precio o deriva). Lo que se mide es lo que el cliente RECIBE (`Enviado`), nunca un regex del prompt.
 *
 * Criterios comunes C1 a C9 (la batería, §3), comprobados en cada caso:
 *   C1 enlace al catálogo (botón, línea con la dirección o cuerpo de la lista; el enlace del DATO `enlaceCatalogo`, nunca otro);   C2 completa o con remisión numérica exacta;   C3 una línea `• nombre — Bs precio` por producto;
 *   C4 lista interactiva cuando corresponde (≤10 filas, título ≤24);   C5 jamás «No encuentro eso» ni «no tenemos catálogo»;   C6 UN mensaje por turno, salvo una lista con enlace: lista PRIMERO y botón «Ver catálogo» DESPUÉS (+1, declarado);   C7 todo precio es de un producto vigente del catálogo vivo;
 *   C8 límites de WhatsApp (4096 / 1024 / 10 filas / 24 / 72 / ids `^[a-z0-9:_-]{1,200}$`);   C9 jamás Wegic ni otro dominio.
 * Hay cambios de DISEÑO frente a la batería, declarados en cada caso (decisiones de Andres del 27/11/2026): una categoría sale como lista interactiva (hasta 10 filas; con más, páginas de 9 + «Ver más», hasta el final) y, con enlace del comercio, un SEGUNDO mensaje con el botón «Ver catálogo»
 * (WhatsApp no junta lista y botón: +1 mensaje, 0,0113 USD, solo con la primera página); varias categorías a la vez siguen como texto con viñetas completo (con el botón, o la dirección al final si pasa de 1000); «los demás» sigue donde quedó;
 * pedir «el catálogo» a secas da el botón «Ver catálogo» con las categorías en el cuerpo. El nombre de un producto llega al flujo recortado a 80 caracteres (contrato de NovuTienda).
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { ResultadoTurno } from '../../lib/n8n-de-mentira';
import { cargarFuente } from '../../core/fuente-vm';
import { problemasDeLimites } from '../../core/ux/vigilante';
import { ANA, catalogoOk, crear, hablar, modelo, mLista, mTexto, mToque, panelOk, type Opciones } from './mundo';
import {
  ENLACE_CATALOGO, GRUPOS, GRUPOS_BORDE, GRUPOS_GRANDES, GRUPOS_TV_Y_VIDEO, electro, modeloCortaA3, modeloDeriva, modeloNiega, modeloNiegaEncuentro, modeloPrecioFalso, modeloResumidor, modeloSinEnlace, type Grupo,
} from './catalogo-electro';

interface Opc { enlace?: boolean; modelo?: boolean; sinAparte?: boolean }
interface Op { items?: J[]; enlace?: string; modeloDice?: Opciones['modeloDice']; panel?: Opciones['panel'] }
const abrir = (op: Op = {}) => crear({ catalogo: catalogoOk({}, op.items ?? electro()), enlaceCatalogo: op.enlace === undefined ? ENLACE_CATALOGO : op.enlace, modeloDice: op.modeloDice ?? modeloNiegaEncuentro, panel: op.panel });
const decir = (m: ReturnType<typeof abrir>, frase: string): ResultadoTurno => hablar(m, ANA, mTexto(frase), { toleraFallo: true });
const uno = (frase: string, op: Op = {}): ResultadoTurno => decir(abrir(op), frase);
const modeloLlamado = (t: ResultadoTurno): boolean => t.ejecutados.has('Conversar con el modelo');
const ficha = (m: ReturnType<typeof abrir>): J => ((m.sd['casabermejo'] as Record<string, J>)[ANA] as J);

// ----------------------------------------------------------------------------- lo que el cliente recibe
const interactivo = (e: { payload: J }): J => ((e.payload['interactive'] ?? {}) as J);
const tipoDe = (e: { payload: J }): string => String(interactivo(e)['type'] ?? e.payload['type']);
const filasDe = (t: ResultadoTurno): J[] => t.mensajes.flatMap((e) => (((interactivo(e)['action'] as J | undefined)?.['sections'] as J[] | undefined) ?? []).flatMap((s) => (s['rows'] as J[] | undefined) ?? []));
const textoTodo = (t: ResultadoTurno): string => t.mensajes.map((e) => e.cuerpo).join('\n');
const viñetas = (t: ResultadoTurno): string[] => textoTodo(t).split('\n').filter((l) => l.startsWith('• ') && / — Bs /.test(l));
const botonCatalogo = (t: ResultadoTurno): boolean => t.mensajes.some((e) => tipoDe(e) === 'cta_url' && String(((interactivo(e)['action'] as J)['parameters'] as J)['url']) === ENLACE_CATALOGO);
const hayEnlace = (t: ResultadoTurno): boolean => t.mensajes.some((e) => JSON.stringify(e.payload).includes(ENLACE_CATALOGO));
const vendibles = (items: J[]): J[] => items.filter((i) => Number.isInteger(i['precioCentavos']) && (i['precioCentavos'] as number) > 0 && i['disponible'] !== false);
/** NUNCA «No tenemos X», «No encuentro eso» ni un equivalente en un mensaje del código (decisión de Andres, 28/11/2026). */
const NO_TENEMOS = /no tenemos|no encuentro|no contamos|no disponemos|no manejamos|no vendemos|no hay /i;
const NEGACION = /no encuentro|no tenemos cat[aá]logo|no contamos con cat|no tengo un cat|no puedo mostrar/i;

/** C1, C5, C6, C7, C8 y C9 de un turno; devuelve los problemas (vacío = cumple). */
function criterios(t: ResultadoTurno, items: J[], o: Opc = {}): string[] {
  const p: string[] = [];
  if (t.fallo) p.push(`el flujo falló: ${t.fallo.mensaje.slice(0, 100)}`);
  // C6: un mensaje; una LISTA con enlace del comercio va seguida del botón aparte (la primera página), y solo eso.
  const conLista = t.mensajes.length > 0 && tipoDe(t.mensajes[0]!) === 'list';
  const esperados = conLista && o.enlace !== false && o.sinAparte !== true ? ['list', 'cta_url'] : null;
  if (esperados !== null ? t.mensajes.map(tipoDe).join() !== esperados.join() : t.mensajes.length !== 1) p.push(`C6: salieron ${t.mensajes.map(tipoDe).join(' + ')}`);
  if (NEGACION.test(textoTodo(t))) p.push('C5: niega el catálogo');
  if (o.modelo !== true && modeloLlamado(t)) p.push('la consulta llegó al modelo');
  const precios = new Set(vendibles(items).map((i) => (i['precioCentavos'] as number) / 100));
  const visto = textoTodo(t) + '\n' + filasDe(t).map((f) => String(f['description'] ?? '')).join('\n');
  for (const m of visto.matchAll(/Bs (\d{1,3}(?:\.\d{3})*)/g)) if (!precios.has(Number(m[1]!.replace(/\./g, '')))) p.push(`C7: el precio Bs ${m[1]} no es de un producto vigente`);
  if (/AGOTADA|SIN PRECIO/.test(visto)) p.push('C7: salió un producto sin precio o no disponible');
  for (const e of t.mensajes) for (const l of problemasDeLimites(e.payload)) p.push(`C8: ${l}`);
  for (const f of filasDe(t)) if (!/^[a-z0-9:_-]{1,200}$/.test(String(f['id']))) p.push(`C8: id de fila fuera del patrón: ${String(f['id'])}`);
  const urls = JSON.stringify(t.mensajes.map((e) => e.payload)).match(/https?:\/\/[^\s"\\)]+/g) ?? [];
  if (urls.some((u) => /wegic/i.test(u))) p.push('C9: Wegic');
  if (o.enlace === false) { if (urls.length) p.push(`C1: sin enlace del comercio salió una dirección: ${urls[0]}`); } else {
    if (!hayEnlace(t) && o.sinAparte !== true) p.push('C1: falta el enlace al catálogo');   // las páginas de «Ver más» no repiten el botón (solo la primera)
    if (urls.some((u) => !u.startsWith(ENLACE_CATALOGO))) p.push('C9: otra dirección distinta del dato del comercio');
  }
  return p;
}
const cumple = (t: ResultadoTurno, items: J[], o: Opc = {}): void => { expect(criterios(t, items, o)).toEqual([]); };
/** Los productos (filas `pro:`) de una lista, en orden. */
const productosDe = (t: ResultadoTurno): string[] => filasDe(t).filter((f) => String(f['id']).startsWith('pro:')).map((f) => String(f['id']));
const verMasDe = (t: ResultadoTurno): string => String(filasDe(t).find((f) => String(f['id']).startsWith('mas:'))?.['id'] ?? '');
/** La primera página de una categoría de `total` productos: lista de 9 + «Ver más» (o de hasta 10 si caben) y el botón aparte. */
const primeraPagina = (t: ResultadoTurno, total: number): void => {
  expect(t.mensajes.map(tipoDe)).toEqual(['list', 'cta_url']);
  expect(productosDe(t)).toHaveLength(total <= 10 ? total : 9);
  expect(verMasDe(t) !== '').toBe(total > 10);
  expect(botonCatalogo(t)).toBe(true);
};
/** C3: cada línea de producto es `• nombre — Bs precio` y no hay dos productos en una línea. */
const formatoC3 = (t: ResultadoTurno): void => { for (const l of textoTodo(t).split('\n').filter((x) => x.startsWith('• ') && x.includes(' — Bs '))) expect(l).toMatch(/^• [^•]+ — Bs \d{1,3}(?:\.\d{3})*$/); };
const completaOCon = (t: ResultadoTurno, total: number): void => {
  const l = viñetas(t).length;
  if (l === total) return;
  expect(textoTodo(t), `C2: salieron ${l} de ${total}`).toMatch(new RegExp(`son ${total}\\b`, 'i'));
  expect(textoTodo(t)).toMatch(/(resto|demás|todos).{0,40}catálogo/i);
};
const categorias7 = ['Televisores', 'Aires acondicionados', 'Heladeras', 'Freezers', 'Lavadoras', 'Microondas', 'Parlantes'];
/** La lista de categorías: 7 filas con su cantidad. */
const esListaDeCategorias = (t: ResultadoTurno): void => {
  expect(t.mensajes.map(tipoDe)).toEqual(['list', 'cta_url']);
  expect(filasDe(t).map((f) => f['title'])).toEqual(categorias7);
  expect(filasDe(t).map((f) => f['description'])[0]).toBe('23 productos');
  expect(filasDe(t).every((f) => /^cat:/.test(String(f['id'])))).toBe(true);
};

describe('4.1 las cinco frases literales de Andres', () => {
  it('L1 «¿Qué productos tienen? Quiero ver el catálogo completo con precios»: lista interactiva de las 7 categorías con su cantidad y, DESPUÉS, el botón «Ver catálogo» en un segundo mensaje', () => {
    const t = uno('¿Qué productos tienen? Quiero ver el catálogo completo con precios');
    cumple(t, electro());
    esListaDeCategorias(t);
  });
  it('L2 «¿Qué televisores tienen y a qué precio?»: con 23, lista de 9 + «Ver más» (con su precio en cada fila) y, DESPUÉS, el botón «Ver catálogo»; ya no texto con viñetas para una sola categoría', () => {
    const t = uno('¿Qué televisores tienen y a qué precio?');
    cumple(t, electro());
    primeraPagina(t, 23);
    expect(verMasDe(t)).toBe('mas:televisores:1');
    expect(filasDe(t).filter((f) => String(f['id']).startsWith('pro:')).every((f) => /^Bs /.test(String(f['description'])))).toBe(true);
    expect(viñetas(t)).toHaveLength(0);
    expect(JSON.stringify(t.mensajes[0]!.payload)).not.toContain(ENLACE_CATALOGO);   // fuera el enlace escrito en el cuerpo de la lista
  });
  it('L3 (tras L2) «¿Qué otros televisores tienen? Quiero ver todos»: sigue con la página siguiente SIN repetir y SIN el botón de nuevo; con 23, tres páginas (9 + 9 + 5) y luego «Esos eran todos»', () => {
    const m = abrir();
    const l2 = decir(m, '¿Qué televisores tienen y a qué precio?');
    const l3 = decir(m, '¿Qué otros televisores tienen? Quiero ver todos');
    const l3b = decir(m, '¿Qué otros televisores tienen? Quiero ver todos');
    cumple(l2, electro()); cumple(l3, electro(), { sinAparte: true }); cumple(l3b, electro(), { sinAparte: true });
    expect(l3.mensajes.map(tipoDe)).toEqual(['list']);
    const todos = [...productosDe(l2), ...productosDe(l3), ...productosDe(l3b)];
    expect(todos).toHaveLength(23);
    expect(new Set(todos).size).toBe(23);
    expect(verMasDe(l3b)).toBe('');
    const ya = decir(m, '¿Qué otros televisores tienen? Quiero ver todos');
    cumple(ya, electro());
    expect(productosDe(ya)).toHaveLength(0);
    expect(textoTodo(ya)).toMatch(/Esos eran todos/);
    expect(botonCatalogo(ya)).toBe(true);
  });
  it('L4 «¿Y qué aires acondicionados tienen? Todos, con precio»: con 12, lista de 9 + «Ver más» y el botón aparte', () => {
    const m = abrir();
    const t = decir(m, '¿Y qué aires acondicionados tienen? Todos, con precio');
    cumple(t, electro());
    primeraPagina(t, 12);
    const p2 = hablar(m, ANA, mLista(verMasDe(t), 'Ver más'), { toleraFallo: true });
    cumple(p2, electro(), { sinAparte: true });
    expect(productosDe(p2)).toHaveLength(3);
    expect(new Set([...productosDe(t), ...productosDe(p2)]).size).toBe(12);
  });
  it('L5 «¿Qué heladeras, freezers, lavadoras, microondas y parlantes tienen? Todos con precio»: 5 bloques con su título, 32 líneas, un solo mensaje', () => {
    const t = uno('¿Qué heladeras, freezers, lavadoras, microondas y parlantes tienen? Todos con precio');
    cumple(t, electro());
    expect(viñetas(t)).toHaveLength(32);
    const bloques = textoTodo(t).split('\n\n').filter((b) => /^\*[^*]+\* \(\d+\)\n•/.test(b));
    expect(bloques.map((b) => b.split('\n')[0])).toEqual(['*Heladeras* (6)', '*Freezers* (4)', '*Lavadoras* (8)', '*Microondas* (5)', '*Parlantes* (9)']);
    formatoC3(t);
  });
});

describe('4.2 variantes de forma: tildes, errores, singular y plural, registro', () => {
  for (const frase of ['que productos tienen', 'q tienen', 'mándenme la lista', 'precios de todo']) {
    it(`A1/A2/A8/A9 «${frase}» = L1: la lista de las 7 categorías con el enlace`, () => {
      const t = uno(frase);
      cumple(t, electro());
      esListaDeCategorias(t);
    });
  }
  for (const [id, frase] of [['A3', 'tienen tele?'], ['A4', 'televisor'], ['A5', 'TELEVISORES PRECIOS'], ['A6', 'telebisores']] as const) {
    it(`${id} «${frase}» = L2: la lista de los televisores, 9 + «Ver más» (nunca «No encuentro»)`, () => {
      const t = uno(frase);
      cumple(t, electro());
      primeraPagina(t, 23);
    });
  }
  it('A3 con el área «TV y video» («tele», «TV» y «televisor» son lo mismo)', () => {
    const items = electro(GRUPOS_TV_Y_VIDEO);
    for (const frase of ['tienen tele?', 'televisores', 'tv']) {
      const t = uno(frase, { items });
      cumple(t, items);
      expect(productosDe(t), frase).toHaveLength(9);
      expect(verMasDe(t), frase).toBe('mas:tv-y-video:1');
    }
  });
  it('A7 «aire acondisionado» (error de ortografía) = L4: la lista de los 12 aires (9 + «Ver más»)', () => {
    const t = uno('aire acondisionado');
    cumple(t, electro());
    primeraPagina(t, 12);
  });
  it('A10 «catalogo» (una palabra): el botón «Ver catálogo» con las 7 categorías en el cuerpo, en un solo mensaje', () => {
    const t = uno('catalogo');
    cumple(t, electro());
    expect(botonCatalogo(t)).toBe(true);
    for (const c of categorias7) expect(textoTodo(t)).toContain(c);
  });
  it('A11 «me pasas el link del catálogo?» da el botón EN ESTE TURNO aunque ya haya salido en el saludo', () => {
    const m = abrir({ modeloDice: modelo('Con gusto. ¿Qué pieza te interesa?') });
    const saludo = decir(m, 'hola');
    expect(botonCatalogo(saludo)).toBe(true);
    const t = decir(m, 'me pasas el link del catálogo?');
    cumple(t, electro());
    expect(botonCatalogo(t)).toBe(true);
  });
  for (const frase of ['heladera', 'heladeras', 'refri']) {
    it(`A12 «${frase}» = la categoría Heladeras: lista interactiva con las 6, completa, y el botón aparte`, () => {
      const t = uno(frase);
      cumple(t, electro());
      expect(t.mensajes.map(tipoDe)).toEqual(['list', 'cta_url']);
      expect(filasDe(t)).toHaveLength(6);
      expect(filasDe(t).every((f) => /^pro:/.test(String(f['id'])) && /^Bs /.test(String(f['description'])))).toBe(true);
    });
  }
  it('A13 «parlantes bluetooth baratos»: los 9 parlantes, sin inventar «baratos»', () => {
    const t = uno('parlantes bluetooth baratos');
    cumple(t, electro());
    expect(filasDe(t)).toHaveLength(9);
    expect(filasDe(t).every((f) => /^PARLANTE/.test(String(f['title'])))).toBe(true);
  });
});

describe('4.3 categoría inexistente', () => {
  for (const [id, frase, dicho] of [['A14', '¿tienen bicicletas?', /"bicicletas" no figura en nuestro catálogo; estas son las categorías que tenemos/], ['A15', 'venden celulares?', /"celulares" no figura en nuestro catálogo; estas son las categorías que tenemos/]] as const) {
    it(`${id} «${frase}»: «"X" no figura en nuestro catálogo; estas son las categorías que tenemos» + la lista de categorías y, después, el botón (decisión del 28/11); no deriva a recepción`, () => {
      const t = uno(frase);
      cumple(t, electro());
      expect(textoTodo(t)).toMatch(dicho);
      expect(t.mensajes.map(tipoDe)).toEqual(['list', 'cta_url']);
      expect(textoTodo(t)).not.toMatch(NO_TENEMOS);
      expect(filasDe(t).map((f) => f['title'])).toEqual(categorias7);
      expect(t.avisos).toHaveLength(0);
    });
  }
  it('A16 «bicis y teles»: la lista de los televisores con «"bicis" no figura en nuestro catálogo» en su cuerpo y el botón aparte', () => {
    const t = uno('bicis y teles');
    cumple(t, electro());
    expect(textoTodo(t)).toMatch(/"bicis" no figura en nuestro catálogo/);
    expect(textoTodo(t)).not.toMatch(NO_TENEMOS);
    primeraPagina(t, 23);
  });
  it('sin pieza con el modelo diciendo «No encuentro eso en nuestro catálogo» («quiero un televisor» en el catálogo de accesorios): nunca la negación; el botón y las categorías', () => {
    const m = crear({ enlaceCatalogo: ENLACE_CATALOGO, modeloDice: modeloNiegaEncuentro });
    const t = decir(m, 'quiero un televisor');
    expect(criterios(t, [{ precioCentavos: 45000 }, { precioCentavos: 779500 }, { precioCentavos: 3600 }], { modelo: true })).toEqual([]);
    expect(botonCatalogo(t)).toBe(true);
    expect(textoTodo(t)).toContain('Accesorios');
  });
});

describe('4.4 tamaño: más de 10 productos y más de 4096 caracteres', () => {
  it('A17 60 televisores de nombre largo: páginas de 9 + «Ver más» recorridas por el toque hasta el final (7 páginas), sin repetir ninguno; solo la primera lleva el botón aparte; límites de WhatsApp en todas', () => {
    const items = electro(GRUPOS_GRANDES);
    const m = abrir({ items });
    let t = decir(m, '¿Qué televisores tienen y a qué precio?');
    cumple(t, items);
    primeraPagina(t, 60);
    const vistos: string[] = [...productosDe(t)];
    let paginas = 1;
    while (verMasDe(t) !== '' && paginas < 20) {
      t = hablar(m, ANA, mLista(verMasDe(t), 'Ver más'), { toleraFallo: true });
      cumple(t, items, { sinAparte: true });
      expect(t.mensajes.map(tipoDe)).toEqual(['list']);
      expect(modeloLlamado(t)).toBe(false);
      vistos.push(...productosDe(t));
      paginas++;
    }
    expect(paginas).toBe(7);
    expect(vistos).toHaveLength(60);
    expect(new Set(vistos).size).toBe(60);
  });
  it('A18 más de 10 categorías: la lista tiene 10 filas (9 + «Ver más»), título ≤24, y el toque de «Ver más» trae las que faltan, sin repetir', () => {
    const grupos: Grupo[] = Array.from({ length: 12 }, (_, i) => ({ area: `Categoría número ${i + 1} de prueba larga`, cantidad: 2, base: `ARTICULO ${i + 1}`, precio: 100 }));
    const items = electro(grupos);
    const m = abrir({ items });
    const t = decir(m, 'qué tienen');
    cumple(t, items);
    expect(filasDe(t)).toHaveLength(10);
    expect(t.mensajes.map(tipoDe)).toEqual(['list', 'cta_url']);
    expect(String(filasDe(t)[9]!['id'])).toBe('mas:cats:1');
    const p2 = hablar(m, ANA, mLista('mas:cats:1', 'Ver más'), { toleraFallo: true });
    cumple(p2, items, { sinAparte: true });
    expect(modeloLlamado(p2)).toBe(false);
    const a = filasDe(t).slice(0, 9).map((f) => String(f['id']));
    const b = filasDe(p2).map((f) => String(f['id']));
    expect(b).toHaveLength(3);
    expect(b.filter((x) => a.includes(x))).toEqual([]);
  });
  it('A19 una categoría con exactamente 10: lista interactiva completa (10 filas) y sin «Ver más»', () => {
    const items = electro(GRUPOS_BORDE);
    const t = uno('¿qué televisores tienen?', { items });
    cumple(t, items);
    expect(filasDe(t)).toHaveLength(10);
    expect(filasDe(t).some((f) => String(f['id']).startsWith('mas:'))).toBe(false);
  });
  it('A20 varias categorías con más de 1000 caracteres de viñetas (heladeras, freezers, lavadoras, microondas y parlantes): el texto sale ENTERO, un solo mensaje, y la dirección del catálogo SALE igual, como línea al final', () => {
    const t = uno('¿Qué heladeras, freezers, lavadoras, microondas y parlantes tienen? Todos con precio');
    cumple(t, electro());
    expect(viñetas(t)).toHaveLength(32);
    expect(textoTodo(t).length).toBeGreaterThan(1000);
    expect(textoTodo(t).trimEnd().endsWith(ENLACE_CATALOGO)).toBe(true);
  });
});

describe('4.5 seguimiento', () => {
  /** Sigue pidiendo «lo que falta» con `frase` hasta que diga «Esos eran todos»: devuelve los productos por página. */
  const seguirHasta = (m: ReturnType<typeof abrir>, frase: string, items: J[], primera: ResultadoTurno): { paginas: string[][]; fin: ResultadoTurno } => {
    const paginas = [productosDe(primera)];
    for (let i = 0; i < 30; i++) {
      const t = decir(m, frase);
      cumple(t, items, { sinAparte: !/Esos eran todos/.test(textoTodo(t)) });
      if (/Esos eran todos/.test(textoTodo(t))) return { paginas, fin: t };
      paginas.push(productosDe(t));
    }
    throw new Error('nunca dijo «Esos eran todos»');
  };
  it('A21 L2 → «¿y otros?» (con 60 televisores): la página siguiente de cada vez, sin repetir ni el botón; al final, «Esos eran todos» + el botón', () => {
    const items = electro(GRUPOS_GRANDES);
    const m = abrir({ items });
    const l2 = decir(m, '¿Qué televisores tienen y a qué precio?');
    const { paginas, fin } = seguirHasta(m, '¿y otros?', items, l2);
    expect(paginas).toHaveLength(7);
    expect(paginas.flat()).toHaveLength(60);
    expect(new Set(paginas.flat()).size).toBe(60);
    expect(botonCatalogo(fin)).toBe(true);
  });
  it('A22 L4 → «los demás» con 50 aires: las páginas restantes, sin repetir', () => {
    const items = electro(GRUPOS.map((g) => (g.area === 'Aires acondicionados' ? { ...g, cantidad: 50 } : g)));
    const m = abrir({ items });
    const l4 = decir(m, '¿Y qué aires acondicionados tienen? Todos, con precio');
    expect(productosDe(l4)).toHaveLength(9);
    const { paginas } = seguirHasta(m, 'los demás', items, l4);
    expect(paginas.flat()).toHaveLength(50);
    expect(new Set(paginas.flat()).size).toBe(50);
  });
  it('A23 L2 → «y aires?»: cambia de categoría (= L4)', () => {
    const m = abrir();
    decir(m, '¿Qué televisores tienen y a qué precio?');
    const t = decir(m, 'y aires?');
    cumple(t, electro());
    primeraPagina(t, 12);
  });
  it('A24 L1 → toque de la fila «Televisores»: = L2 (9 + «Ver más» y el botón aparte), sin pasar por el modelo; un id inventado no hace nada raro', () => {
    const m = abrir();
    decir(m, '¿Qué productos tienen? Quiero ver el catálogo completo con precios');
    const t = hablar(m, ANA, mLista('cat:televisores', 'Televisores'), { toleraFallo: true });
    cumple(t, electro());
    primeraPagina(t, 23);
    expect(modeloLlamado(t)).toBe(false);
    for (const id of ['cat:xyz', 'pro:xyz', 'mas:cats:99', 'mas:xyz:1', 'cat:']) {
      const v = hablar(m, ANA, mLista(id, 'x'), { toleraFallo: true });
      expect(criterios(v, electro()), `${id}: ${textoTodo(v).slice(0, 120)}`).toEqual([]);
      expect(textoTodo(v), id).toMatch(/ya no está disponible/);
      expect(ficha(m)['carrito']).toEqual([]);
    }
  });
  it('el toque de una pieza (`pro:`) la agrega al pedido POR CÓDIGO, sin modelo; una pieza que ya estaba no se duplica', () => {
    const m = abrir();
    const t = hablar(m, ANA, mLista('pro:heladeras-2', 'x'), { toleraFallo: true });
    expect(modeloLlamado(t)).toBe(false);
    expect(t.fallo).toBeNull();
    expect(ficha(m)['carrito']).toEqual([{ id: 'heladeras-2', cantidad: 1, detalle: '' }]);
    expect(textoTodo(t)).toMatch(/Anoté HELADERA LG/);
    hablar(m, ANA, mLista('pro:heladeras-2', 'x'), { toleraFallo: true });
    expect(ficha(m)['carrito']).toEqual([{ id: 'heladeras-2', cantidad: 1, detalle: '' }]);
  });
});

describe('4.6 mezcla de catálogo y pedido', () => {
  const pedido = () => modelo('Con gusto, anoto la heladera.', { lineas: [{ id: 'heladeras-1', cantidad: 1 }] });
  it('A25 «quiero la heladera más barata y mándenme la lista de aires»: anota la heladera (la más barata, precio del catálogo) Y muestra los 12 aires en viñetas, en UN mensaje (texto: el botón va en el mismo mensaje)', () => {
    const m = abrir({ modeloDice: pedido() });
    const t = decir(m, 'quiero la heladera más barata y mándenme la lista de aires');
    cumple(t, electro(), { modelo: true });
    expect(viñetas(t)).toHaveLength(12);
    formatoC3(t);
    expect(ficha(m)['carrito']).toEqual([{ id: 'heladeras-1', cantidad: 1, detalle: '' }]);
  });
  it('A26 con un pedido en curso: «qué televisores tienen?» da la lista (9 + «Ver más») y el botón aparte, sin borrar el carrito ni meter el resumen del pedido en la lista', () => {
    const m = abrir({ modeloDice: pedido() });
    decir(m, 'quiero la heladera más barata');
    expect(ficha(m)['carrito']).toHaveLength(1);
    const t = decir(m, 'qué televisores tienen?');
    cumple(t, electro());
    primeraPagina(t, 23);
    expect(textoTodo(t)).not.toMatch(/Total:/);
    expect(ficha(m)['carrito']).toEqual([{ id: 'heladeras-1', cantidad: 1, detalle: '' }]);
  });
  it('con un QR en curso, «catálogo» da el botón igual (siempre que lo pida)', () => {
    const m = abrir({ panel: panelOk({ cobro: { activo: true, qr: { url: 'https://qr.example.com/q.png' }, pendiente: true, monto: 450, pedido: 'WL1', regla: 2 } }) });
    const t = decir(m, 'catálogo');
    cumple(t, electro());
    expect(botonCatalogo(t)).toBe(true);
  });
});

describe('4.7 modelo adverso: el código lo corrige', () => {
  it('A27 el modelo resume sin lista: la lista sale igual (la arma el código)', () => {
    const t = uno('¿Qué televisores tienen y a qué precio?', { modeloDice: modeloResumidor });
    cumple(t, electro());
    primeraPagina(t, 23);
  });
  it('A28 el modelo lista solo 3: sale la lista completa de los 12 (el texto del modelo no manda)', () => {
    const t = uno('¿Y qué aires acondicionados tienen? Todos, con precio', { modeloDice: modeloCortaA3 });
    cumple(t, electro());
    primeraPagina(t, 12);
  });
  it('A29 el modelo niega el catálogo: se reemplaza; salen las categorías y el enlace', () => {
    const t = uno('¿Qué productos tienen? Quiero ver el catálogo completo con precios', { modeloDice: modeloNiega });
    cumple(t, electro());
    esListaDeCategorias(t);
  });
  it('A30 el modelo marca «quiero hablar» ante «¿qué tienen?»: NO deriva; una consulta de catálogo la contesta el código (sin aviso ni botón de recepción)', () => {
    const t = uno('¿Qué tienen?', { modeloDice: modeloDeriva });
    cumple(t, electro());
    expect(t.avisos).toHaveLength(0);
    expect(JSON.stringify(t.mensajes.map((e) => e.payload))).not.toContain('wa.me');
  });
  it('A31 el modelo inventa un precio: ningún precio falso sale (C7)', () => {
    const t = uno('¿Qué televisores tienen y a qué precio?', { modeloDice: modeloPrecioFalso });
    cumple(t, electro());
    primeraPagina(t, 23);
    expect(textoTodo(t)).not.toContain('Bs 999');
  });
  it('A32 el modelo lista completa pero sin enlace: el enlace lo agrega el código', () => {
    const t = uno('¿Qué televisores tienen y a qué precio?', { modeloDice: modeloSinEnlace });
    cumple(t, electro());
    expect(botonCatalogo(t)).toBe(true);
  });
  it('A33 sin enlace del comercio (dato vacío): la lista sale SIN botón aparte ni enlace y sin prometerlo («solo se ofrece lo que se cumple», sin mensajes de más): un solo mensaje', () => {
    const t = uno('¿Qué televisores tienen y a qué precio?', { enlace: '' });
    cumple(t, electro(), { enlace: false });
    expect(t.mensajes.map(tipoDe)).toEqual(['list']);
    expect(productosDe(t)).toHaveLength(9);
    expect(textoTodo(t)).not.toMatch(/enlace|bot[oó]n|p[aá]gina|ver el cat[aá]logo|mira el cat[aá]logo/i);
    const cats = uno('qué tienen', { enlace: '' });
    cumple(cats, electro(), { enlace: false });
    expect(textoTodo(cats)).not.toMatch(/enlace|bot[oó]n web|p[aá]gina|cat[aá]logo completo/i);
  });
  it('A34 el enlace del dato es de Wegic o no es https: se trata como sin enlace (C9)', () => {
    for (const enlace of ['https://wegic.ai/tienda', 'http://catalogo.ejemplo.test/x']) {
      const t = uno('¿Qué productos tienen? Quiero ver el catálogo completo con precios', { enlace });
      cumple(t, electro(), { enlace: false });
      expect(JSON.stringify(t.mensajes.map((e) => e.payload))).not.toMatch(/wegic|http:/i);
    }
  });
});

describe('4.8 decisiones de Andres del 27/11/2026 (negadas)', () => {
  it('«Botón en otro mensaje», COSTO ACEPTADO: una lista con enlace cuesta +1 mensaje (lista PRIMERO, botón DESPUÉS); un texto con enlace, 0 más; una lista sin enlace, 0 más; la página de «Ver más», 0 más', () => {
    const m = abrir();
    const lista = decir(m, '¿Qué productos tienen? Quiero ver el catálogo completo con precios');
    expect(lista.mensajes.map(tipoDe)).toEqual(['list', 'cta_url']);
    expect(JSON.stringify(lista.mensajes[0]!.payload)).not.toContain('http');
    const texto = decir(m, 'catalogo');
    expect(texto.mensajes).toHaveLength(1);
    expect(uno('qué tienen', { enlace: '' }).mensajes.map(tipoDe)).toEqual(['list']);
    const sig = hablar(m, ANA, mLista('mas:cats:1', 'Ver más'), { toleraFallo: true });
    expect(sig.mensajes.length).toBeLessThanOrEqual(1);
  });
  it('NEGADO: un producto que no se vende, CON un pedido en curso, NO dice «"X" no figura…» ni «No tenemos…»: lo deriva el CÓDIGO a recepción (aviso + botón), sin modelo y sin categorías (#1151, O5)', () => {
    const m = abrir({ modeloDice: modelo('Con gusto, anoto la heladera.', { lineas: [{ id: 'heladeras-1', cantidad: 1 }] }) });
    decir(m, 'quiero la heladera más barata');
    expect(ficha(m)['carrito']).toHaveLength(1);
    const t = decir(m, '¿tienen bicicletas?');
    expect(textoTodo(t)).not.toMatch(/No tenemos bicicletas/);
    expect(modeloLlamado(t)).toBe(false);   // #1151 (O5): lo decide el código
    expect(t.avisos).toHaveLength(1);
    expect(textoTodo(t)).not.toMatch(/no figura|categor/i);
    expect(ficha(m)['carrito']).toHaveLength(1);
  });
  it('NEGADO: una palabra suelta que responde a un dato pedido («Televisor» como nombre) no es una consulta de catálogo', () => {
    const m = abrir({ modeloDice: modelo('Con gusto, anoto la heladera.', { lineas: [{ id: 'heladeras-1', cantidad: 1 }] }) });
    decir(m, 'quiero la heladera más barata');
    hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'), { toleraFallo: true });
    const t = decir(m, 'Televisor');
    expect(tipoDe(t.mensajes[0] ?? { payload: {} })).not.toBe('list');
  });
});

describe('4.9 «no figura en nuestro catálogo» (decisión de Andres del 28/11/2026), negada', () => {
  it('NEGADO: ningún mensaje del código dice «no tenemos»/«no encuentro»: ni con piezas que no existen, ni con el modelo adverso, ni con sinónimos («pantallas»), ni en la pregunta fija; la pregunta fija lleva el botón con enlace y no sin él', () => {
    const frases = ['¿tienen bicicletas?', 'venden celulares?', 'bicis y teles', 'quiero un televisor', 'necesito información de las piezas', 'pantallas', 'qué tienen', 'catalogo', 'televisor'];
    for (const modeloDice of [modeloNiegaEncuentro, modeloNiega, modeloDeriva]) {
      for (const frase of frases) {
        for (const enlace of [ENLACE_CATALOGO, '']) {
          const t = uno(frase, { modeloDice, enlace });
          expect(textoTodo(t), `${frase} / ${enlace}`).not.toMatch(NO_TENEMOS);
        }
      }
    }
    const pf = uno('quiero un televisor', { items: [{ id: 'a', nombre: 'Accesorio', area: 'Accesorios', precio: 10, precioCentavos: 1000, moneda: 'BOB', activo: true, stock: 5, disponible: true }], modeloDice: modeloNiegaEncuentro });
    expect(botonCatalogo(pf)).toBe(true);
    const sinEnlace = uno('quiero un televisor', { items: [{ id: 'a', nombre: 'Accesorio', area: 'Accesorios', precio: 10, precioCentavos: 1000, moneda: 'BOB', activo: true, stock: 5, disponible: true }], modeloDice: modeloNiegaEncuentro, enlace: '' });
    expect(JSON.stringify(sinEnlace.mensajes.map((e) => e.payload))).not.toMatch(/cta_url|Ver catálogo/);
  });
  it('«pantallas» (sinónimo de la pieza común) es la categoría Televisores: lista de productos, no «no figura»', () => {
    const t = uno('pantallas');
    expect(textoTodo(t)).not.toMatch(/no figura/);
    expect(productosDe(t).length).toBeGreaterThan(0);
  });
});

describe('8. el saludo trae opciones y el botón «Ver catálogo» (Estándar 4.2 y 1.2), en el mismo mensaje', () => {
  it('«hola» con enlace: UN mensaje con el botón «Ver catálogo» del dato; sin enlace, un texto sin botón y sin prometerlo', () => {
    const m = abrir({ modeloDice: modelo('Con gusto. ¿Qué pieza te interesa?') });
    const t = decir(m, 'hola');
    expect(t.mensajes).toHaveLength(1);
    expect(botonCatalogo(t)).toBe(true);
    const sin = uno('hola', { enlace: '', modeloDice: modelo('Con gusto. ¿Qué pieza te interesa?') });
    expect(sin.mensajes).toHaveLength(1);
    expect(JSON.stringify(sin.mensajes[0]!.payload)).not.toMatch(/cta_url|Ver catálogo/);
  });
});

describe('9. los límites de WhatsApp se cumplen en el código (con pruebas negadas)', () => {
  const core = cargarFuente<{ cmLista: (c: string, b: string, t: string, f: J[]) => J; cmTexto: (c: string) => J; lcResolverId: (id: string, v: J[]) => J }>([
    'Flujos/src/core/sin-agente/mensajes.js', 'Flujos/src/modulos/productos/lista-de-catalogo.js',
  ], ['cmLista', 'cmTexto', 'lcResolverId']);
  it('NEGADO: 11 filas, títulos de 40, descripciones de 100, botón de 30 y cuerpo de 2000 salen cortados a 10 / 24 / 72 / 20 / 1024; un texto de 5000 sale en 4000', () => {
    const filas = Array.from({ length: 11 }, (_, i) => ({ id: `cat:${i}`, title: 'T'.repeat(40), description: 'D'.repeat(100) }));
    const p = core.cmLista('c'.repeat(2000), 'B'.repeat(30), 'S'.repeat(40), filas);
    expect(problemasDeLimites(p)).toEqual([]);
    const i = p['interactive'] as J;
    expect((((i['action'] as J)['sections'] as J[])[0]!['rows'] as J[]).length).toBe(10);
    expect(String(((i['body'] as J)['text'])).length).toBeLessThanOrEqual(1024);
    expect(String((((core.cmTexto('x'.repeat(5000))['text']) as J)['body'])).length).toBeLessThanOrEqual(4000);
  });
  it('NEGADO: un id fuera de `^[a-z0-9:_-]{1,200}$` (mayúsculas, espacios, 201 caracteres, vacío) nunca resuelve a un producto o categoría', () => {
    const v = [{ id: 'abc-1', nombre: 'Pieza', area: 'Cat', precioCentavos: 100 }];
    for (const id of ['PRO:ABC-1', 'pro:abc 1', 'pro:' + 'a'.repeat(200), 'pro:', '', 'cat:', 'mas:cats', 'mas:cats:1:2', 'pro:abc-1;']) expect(core.lcResolverId(id, v)['tipo'], id).toBe('obsoleto');
    expect(core.lcResolverId('pro:abc-1', v)).toEqual({ tipo: 'pro', id: 'abc-1' });
  });
  it('un producto con id en mayúsculas se elige por su id de fila en minúsculas y entra al pedido con SU id real', () => {
    const items = electro([{ area: 'Mayúsculas', cantidad: 3, base: 'PIEZA', precio: 100 }]).map((i, n) => (n === 0 ? { ...i, id: 'ABC-001' } : i));
    const m = abrir({ items });
    const t = decir(m, 'mayusculas');
    expect(criterios(t, items)).toEqual([]);   // lista + botón aparte
    expect(filasDe(t).map((f) => String(f['id']))).toContain('pro:abc-001');
    hablar(m, ANA, mLista('pro:abc-001', 'x'), { toleraFallo: true });
    expect(ficha(m)['carrito']).toEqual([{ id: 'ABC-001', cantidad: 1, detalle: '' }]);
  });
});
