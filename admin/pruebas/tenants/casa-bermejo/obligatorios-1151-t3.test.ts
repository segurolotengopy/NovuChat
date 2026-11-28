/**
 * PR #1151, REVISIÓN DEL 28/11/2026, T3 (Casa Bermejo). Se prueba NEGANDO, sobre el JSON versionado y el n8n de mentira:
 *   O5   con un pedido en curso y una pieza que no existe («¿tienen bicicletas?»), el CÓDIGO deriva (aviso + botón a recepción); nunca «No tenemos…», aunque el modelo lo diga;
 *   D-A  el 2.º mensaje vago seguido responde con la LISTA de categorías y el botón «Ver catálogo»; el 3.º, recepción;
 *   1.1  «¿qué venden?», «catálogo», «carta», «productos», «todo», «lista» los contesta el código con la lista y el botón, nunca con la pregunta fija; la pregunta fija y el saludo llevan el botón con enlace válido;
 *   URL  el enlace del botón «Ver catálogo» sale IDÉNTICO al dato del comercio (ni barra final agregada o quitada, ni ruta tocada), en el botón y en el respaldo de texto.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { LlamadaDoble } from '../../lib/n8n-de-mentira';
import type { ResultadoTurno } from '../../lib/n8n-de-mentira';
import { ANA, catalogoOk, crear, hablar, modelo, mTexto } from './mundo';
import { ENLACE_CATALOGO, electro } from './catalogo-electro';

const NO_TENEMOS = /no tenemos|no encuentro|no contamos|no disponemos|no manejamos|no vendemos|no hay /i;
const PREGUNTA_FIJA = /¿Qué producto busca\?|¿Qué producto buscas\?/;
interface Op { usted?: boolean; enlace?: string; modeloDice?: (ll: LlamadaDoble) => J; ahora?: number }
const abrir = (op: Op = {}) => crear({
  catalogo: catalogoOk({}, electro()), enlaceCatalogo: op.enlace === undefined ? ENLACE_CATALOGO : op.enlace,
  modeloDice: op.modeloDice ?? (() => modelo('¡Hola! ¿En qué puedo ayudarte?')), base: { tratamiento: op.usted ? 'usted' : 'tu' },
});
const decir = (m: ReturnType<typeof abrir>, frase: string): ResultadoTurno => hablar(m, ANA, mTexto(frase), { toleraFallo: true });
const interactivo = (e: { payload: J }): J => ((e.payload['interactive'] ?? {}) as J);
const tipoDe = (e: { payload: J }): string => String(interactivo(e)['type'] ?? e.payload['type']);
const tipos = (t: ResultadoTurno): string => t.mensajes.map(tipoDe).join('+');
const urlsBoton = (t: ResultadoTurno): string[] => t.mensajes.filter((e) => tipoDe(e) === 'cta_url').map((e) => String(((interactivo(e)['action'] as J)['parameters'] as J)['url']));
const todoTexto = (t: ResultadoTurno): string => t.mensajes.map((e) => e.cuerpo).join('\n');
const modeloLlamado = (t: ResultadoTurno): boolean => t.ejecutados.has('Conversar con el modelo');

describe('O5: con un pedido en curso, una pieza que no existe se deriva POR CÓDIGO (aviso + botón), nunca «No tenemos…»', () => {
  // El modelo ADVERSO: en el primer turno agrega un televisor; después niega todo («No tenemos bicicletas»).
  const adverso = (): ((ll: LlamadaDoble) => J) => { let n = 0; return () => { n++; return n === 1 ? modelo('Anotado.', { lineas: [{ id: 'televisores-1', cantidad: 1 }] }) : modelo('No tenemos bicicletas, lo siento.'); }; };
  for (const usted of [false, true]) {
    it(`${usted ? 'usted' : 'tú'}: «¿tienen bicicletas?» con un televisor en el pedido: aviso a recepción + botón, sin modelo y sin «No tenemos»`, () => {
      const m = abrir({ usted, modeloDice: adverso() });
      const t0 = decir(m, 'me llevo el televisor samsung de 30 pulgadas');
      expect(t0.fallo).toBeFalsy();
      const ficha0 = ((m.sd['casabermejo'] as Record<string, J>)[ANA] as J);
      expect((ficha0['carrito'] as J[]).length, 'el pedido en curso existe').toBe(1);
      const t = decir(m, '¿tienen bicicletas?');
      expect(modeloLlamado(t), 'no llega al modelo').toBe(false);
      expect(t.avisos, 'un aviso a recepción').toHaveLength(1);
      expect(t.mensajes).toHaveLength(1);
      expect(JSON.stringify(t.mensajes[0]!.payload)).toMatch(/wa\.me|cta_url/);   // el botón para escribirle a recepción
      expect(todoTexto(t)).not.toMatch(NO_TENEMOS);
      expect(todoTexto(t)).not.toMatch(/bicicleta/i);
      const ficha1 = ((m.sd['casabermejo'] as Record<string, J>)[ANA] as J);
      expect((ficha1['carrito'] as J[]).length, 'el pedido en curso no se toca').toBe(1);
    });
  }
  it('NEGADO: sin pedido en curso sigue como siempre (la pieza común dice «no figura» y salen las categorías, sin recepción)', () => {
    const t = decir(abrir(), '¿tienen bicicletas?');
    expect(t.avisos).toHaveLength(0);
    expect(todoTexto(t)).not.toMatch(NO_TENEMOS);
    expect(todoTexto(t)).toContain('"bicicletas" no figura en nuestro catálogo');
  });
});

describe('D-A: el 2.º mensaje vago seguido responde con la LISTA de categorías y el botón «Ver catálogo»; el 3.º, recepción', () => {
  for (const usted of [false, true]) {
    it(`${usted ? 'usted' : 'tú'}: «hola» / «hola?» / «hmm»`, () => {
      const m = abrir({ usted });
      const t1 = decir(m, 'hola');
      expect(todoTexto(t1)).toMatch(PREGUNTA_FIJA);
      expect(urlsBoton(t1), '1.º: la pregunta fija lleva el botón «Ver catálogo»').toEqual([ENLACE_CATALOGO]);
      expect(t1.avisos).toHaveLength(0);
      const t2 = decir(m, 'hola?');
      expect(tipos(t2), '2.º: la lista de categorías y el botón').toBe('list+cta_url');
      expect(urlsBoton(t2)).toEqual([ENLACE_CATALOGO]);
      expect(t2.avisos).toHaveLength(0);
      const t3 = decir(m, 'hmm');
      expect(t3.avisos, '3.º: recepción').toHaveLength(1);
      expect(todoTexto(t3)).toMatch(/persona del equipo/);
    });
  }
  it('sin enlace del comercio, la lista sale sola (sin prometer un botón)', () => {
    const m = abrir({ enlace: '' });
    decir(m, 'hola');
    const t2 = decir(m, 'hola?');
    expect(tipos(t2)).toBe('list');
    expect(JSON.stringify(t2.mensajes.map((e) => e.payload))).not.toMatch(/cta_url/);
  });
});

describe('1.1: pedir lo que se vende lo contesta el código con la lista y el botón, nunca con la pregunta fija', () => {
  for (const frase of ['¿qué venden?', 'catálogo', 'carta', 'productos', 'todo', 'lista', 'qué tienen', 'catalogo por favor']) {
    it(`«${frase}»: lista o catálogo con el botón, sin modelo y sin la pregunta fija`, () => {
      const t = decir(abrir(), frase);
      expect(modeloLlamado(t), 'sin modelo').toBe(false);
      expect(todoTexto(t)).not.toMatch(PREGUNTA_FIJA);
      expect(t.avisos).toHaveLength(0);
      expect(urlsBoton(t), 'con el botón «Ver catálogo»').toEqual([ENLACE_CATALOGO]);
      expect(t.mensajes.some((e) => tipoDe(e) === 'list' || /categor/i.test(e.cuerpo)), 'con las categorías').toBe(true);
    });
  }
  it('NEGADO: «hola» con el comercio sin categorías cargadas sigue con la pregunta fija y el botón (no inventa una lista)', () => {
    const m = crear({ catalogo: catalogoOk({}, []), enlaceCatalogo: ENLACE_CATALOGO, modeloDice: modelo('¡Hola!') });
    const t = decir(m, 'hola');
    expect(t.avisos.length + t.mensajes.length).toBeGreaterThan(0);
    expect(todoTexto(t)).not.toMatch(NO_TENEMOS);
  });
});

describe('URL: el botón «Ver catálogo» sale IDÉNTICO al dato del comercio (sin barra agregada ni quitada, sin tocar la ruta)', () => {
  const DATOS = ['https://catalogo.ejemplo.test/casa-bermejo', 'https://catalogo.ejemplo.test/casa-bermejo/', 'https://catalogo.ejemplo.test', 'https://catalogo.ejemplo.test/', 'https://catalogo.ejemplo.test/tienda/Casa-Bermejo/catalogo?v=2&x=1#top', 'https://catalogo.ejemplo.test:8443/a//b/'];
  for (const dato of DATOS) {
    it(`${dato}`, () => {
      for (const frase of ['catálogo', '¿qué venden?', 'hola']) {
        const t = decir(abrir({ enlace: dato }), frase);
        expect(urlsBoton(t), `«${frase}»: botón`).toEqual([dato]);
        for (const e of t.mensajes) {
          const enTexto = (e.cuerpo.match(/https:\/\/\S+/g) ?? []);
          for (const u of enTexto) expect(u, `«${frase}»: respaldo en texto`).toBe(dato);
        }
      }
    });
  }
  it('NEGADO: un espacio alrededor del dato se quita, pero la barra final nunca se toca', () => {
    const t = decir(abrir({ enlace: '  https://catalogo.ejemplo.test/casa-bermejo/  ' }), 'catálogo');
    expect(urlsBoton(t)).toEqual(['https://catalogo.ejemplo.test/casa-bermejo/']);
  });
});
