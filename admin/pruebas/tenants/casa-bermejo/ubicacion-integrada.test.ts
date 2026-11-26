/**
 * UBICACIÓN Y HORARIO, INTEGRADOS (#1113 dentro de #1098, 25/11/2026). El dato sale PRIMERO del campo `tienda` del catálogo de NovuTienda y, de respaldo, del tenant («Config base»).
 *   - (a) el HORARIO lo contesta el código («a qué hora abren», «horario»), sin modelo; sin dato → recepción;
 *   - (c) una pregunta de la tienda CON otra cosa («¿dónde están ubicados? quiero comprar una billetera»): la respuesta de la tienda va antepuesta en el MISMO mensaje del turno (0 agregados) y el modelo ve solo el resto;
 *   - (a) el prompt del modelo no dice «aún no está cargado» cuando NovuTienda sí lo tiene.
 * Se prueba NEGANDO. Los datos son ficticios.
 */
import { describe, expect, it } from 'vitest';
import { ANA, BILLETERA, catalogoOk, crear, hablar, modelo, mTexto, textoAlModelo, textos } from './mundo';
import type { LlamadaDoble } from '../../lib/n8n-de-mentira';

const DIR = 'Calle Ejemplo 123, zona Centro';
const MAPA = 'https://maps.app.goo.gl/EjemploDePrueba1';
const HORARIO = 'lunes a sábado de 9 a 19';
const J = (x: unknown): string => JSON.stringify(x);
type Turno = ReturnType<typeof hablar>;
const corridos = (t: Turno): string[] => t.registro.map((r) => r.nodo);
const llamoAlModelo = (t: Turno): boolean => corridos(t).includes('Conversar con el modelo');
const plan = (t: Turno): { plan?: string; resumen?: { mensajes?: number; llamadasModelo?: number } } => (t.porNodo['Armar mensajes']?.[0] ?? {}) as never;
const ADVERSO = modelo('Estamos en Av. Inventada 999 y abrimos las 24 horas: https://maps.app.goo.gl/Inventado');
const TIENDA = { tienda: { direccion: DIR, enlaceMapa: MAPA, horario: HORARIO } };

describe('(a) el HORARIO lo contesta el código, con el dato de NovuTienda primero y el del tenant de respaldo', () => {
  for (const frase of ['horario', '¿A qué hora abren?', 'hasta qué hora atienden', '¿abren los domingos?', 'a qué hora cierran']) {
    it(`«${frase}» con el horario en el catálogo: 1 mensaje con el horario, sin la dirección ni el botón del mapa, 0 llamadas al modelo y sin aviso`, () => {
      const t = hablar(crear({ catalogo: catalogoOk(TIENDA), modeloDice: ADVERSO }), ANA, mTexto(frase));
      expect(t.mensajes).toHaveLength(1);
      expect(textos(t).join(' ')).toContain(HORARIO);
      expect(J(t.mensajes)).not.toContain(MAPA);
      expect(J(t.mensajes)).not.toContain(DIR);
      expect(J(t.mensajes)).not.toMatch(/Inventada|24 horas/);
      expect(llamoAlModelo(t)).toBe(false);
      expect(t.avisos).toHaveLength(0);
      expect(plan(t).plan).toBe('ubicacion_tienda');
      expect(plan(t).resumen?.llamadasModelo).toBe(0);
    });
  }
  it('el horario del tenant responde cuando NovuTienda no lo trae, y el del catálogo manda sobre el del tenant', () => {
    expect(textos(hablar(crear({ base: { horarioTienda: 'de 8 a 12' }, modeloDice: ADVERSO }), ANA, mTexto('horario'))).join(' ')).toContain('de 8 a 12');
    const t = hablar(crear({ catalogo: catalogoOk(TIENDA), base: { horarioTienda: 'de 8 a 12' }, modeloDice: ADVERSO }), ANA, mTexto('horario'));
    expect(textos(t).join(' ')).toContain(HORARIO);
    expect(textos(t).join(' ')).not.toContain('de 8 a 12');
  });
  it('«¿dónde queda y a qué hora abren?»: UN mensaje con la dirección, el botón del mapa y el horario', () => {
    const t = hablar(crear({ catalogo: catalogoOk(TIENDA), modeloDice: ADVERSO }), ANA, mTexto('¿Dónde queda y a qué hora abren?'));
    expect(t.mensajes).toHaveLength(1);
    expect(J(t.mensajes)).toContain(MAPA);
    expect(J(t.mensajes)).toContain(DIR);
    expect(J(t.mensajes)).toContain(HORARIO);
    expect(llamoAlModelo(t)).toBe(false);
  });
  it('NEGADO: sin el horario cargado no se inventa: pasa con recepción (aviso + botón), sin modelo; y con la dirección pero sin horario, «¿a qué hora abren?» tampoco se contesta con la dirección', () => {
    for (const base of [{}, { ubicacionTienda: DIR, mapaTienda: MAPA }]) {
      const t = hablar(crear({ base, modeloDice: ADVERSO }), ANA, mTexto('¿A qué hora abren?'));
      expect(llamoAlModelo(t)).toBe(false);
      expect(t.avisos).toHaveLength(1);
      expect(J(t.mensajes.map((x) => x.payload))).toContain('wa.me');
      expect(textos(t).join(' ')).toMatch(/horario/i);   // el texto de derivación es el del horario, no el de la dirección
      expect(J(t.mensajes)).not.toMatch(/Inventada|24 horas/);
      expect(J(t.mensajes)).not.toContain(DIR);
    }
  });
  it('NEGADO: lo que no es del horario de la tienda sigue su camino (al modelo): «¿a qué hora llega mi pedido?», «mi horario es de 8 a 12», «horario de entrega»', () => {
    for (const frase of ['¿a qué hora llega mi pedido?', 'mi horario es de 8 a 12', 'horario de entrega']) {
      const t = hablar(crear({ catalogo: catalogoOk(TIENDA), modeloDice: modelo('Con gusto.') }), ANA, mTexto(frase));
      expect(plan(t).plan, frase).not.toBe('ubicacion_tienda');
      expect(J(t.mensajes), frase).not.toContain(HORARIO);
    }
  });
});

describe('(a) el prompt del modelo usa la misma fuente: NovuTienda primero', () => {
  const prompt = (ll: LlamadaDoble): string => String(((ll.cuerpo?.['systemInstruction'] as { parts?: { text?: string }[] } | undefined)?.parts ?? [])[0]?.text ?? '');
  it('con `tienda` en el catálogo, el prompt lleva la dirección y el horario y NO dice «aún no está cargado»; sin ningún dato, sí lo dice', () => {
    const vistos: string[] = [];
    const m = crear({ catalogo: catalogoOk(TIENDA), modeloDice: (ll) => { vistos.push(prompt(ll)); return modelo('Con gusto.'); } });
    hablar(m, ANA, mTexto('quiero ver las billeteras'));
    expect(vistos[0]).toContain('ubicación: ' + DIR);
    expect(vistos[0]).toContain('horario: ' + HORARIO);
    expect(vistos[0]).not.toMatch(/aún no está cargad/);
    const vacios: string[] = [];
    const m2 = crear({ modeloDice: (ll) => { vacios.push(prompt(ll)); return modelo('Con gusto.'); } });
    hablar(m2, ANA, mTexto('quiero ver las billeteras'));
    expect(vacios[0]).toMatch(/la ubicación aún no está cargada/);
    expect(vacios[0]).toMatch(/el horario aún no está cargado/);
  });
});

describe('(c) la pregunta de la tienda CON otra cosa: se responde y la venta sigue en el MISMO mensaje', () => {
  const sano = (): ((ll: LlamadaDoble) => ReturnType<typeof modelo>) => (ll) => modelo('Con gusto, anoté la billetera. ' + (textoAlModelo(ll).length > 0 ? 'Me dices cómo la prefieres.' : ''), { lineas: BILLETERA });
  it('«¿Dónde están ubicados? Quiero comprar una billetera»: 1 mensaje con la dirección ANTEPUESTA y el texto de la venta; el modelo ve solo «Quiero comprar una billetera»; el pedido avanza', () => {
    const vistos: string[] = [];
    const m = crear({ catalogo: catalogoOk(TIENDA), modeloDice: (ll) => { vistos.push(textoAlModelo(ll)); return sano()(ll); } });
    const t = hablar(m, ANA, mTexto('¿Dónde están ubicados? Quiero comprar una billetera'));
    expect(t.mensajes).toHaveLength(1);
    const cuerpo = t.mensajes.map((x) => x.cuerpo).join(' ');
    expect(cuerpo.indexOf(DIR)).toBeGreaterThanOrEqual(0);
    expect(cuerpo).toContain(MAPA);
    expect(cuerpo).toMatch(/Billetera de cuero/);   // la venta sigue en el mismo mensaje: el resumen del pedido y la pregunta de la entrega
    expect(cuerpo.indexOf(DIR)).toBeLessThan(cuerpo.indexOf('Billetera de cuero'));
    expect(vistos).toEqual(['Quiero comprar una billetera']);
    expect((m.sd['casabermejo'] as Record<string, { carrito: unknown[] }>)[ANA]!.carrito).toHaveLength(1);
    expect(t.avisos).toHaveLength(0);
    expect(plan(t).resumen?.mensajes).toBe(1);
  });
  it('«Hola. ¿A qué hora abren? Quiero dos billeteras»: el horario antepuesto, sin la dirección', () => {
    const t = hablar(crear({ catalogo: catalogoOk(TIENDA), modeloDice: sano() }), ANA, mTexto('Hola. ¿A qué hora abren? Quiero dos billeteras'));
    expect(t.mensajes).toHaveLength(1);
    const cuerpo = t.mensajes.map((x) => x.cuerpo).join(' ');
    expect(cuerpo).toContain('Nuestro horario: ' + HORARIO);
    expect(cuerpo).not.toContain(DIR);
  });
  it('NEGADO: sin el dato cargado no se inventa y no se sigue la venta a medias: pasa con recepción (aviso + botón) y el pedido no cambia', () => {
    const m = crear({ modeloDice: ADVERSO });
    const t = hablar(m, ANA, mTexto('¿Dónde están ubicados? Quiero comprar una billetera'));
    expect(llamoAlModelo(t)).toBe(false);
    expect(t.avisos).toHaveLength(1);
    expect(J(t.mensajes)).not.toMatch(/Inventada/);
    expect((m.sd['casabermejo'] as Record<string, { carrito: unknown[] }>)[ANA]!.carrito).toHaveLength(0);
  });
  it('NEGADO: «¿dónde está mi pedido? quiero una billetera» no es una pregunta de la tienda: el turno es el de siempre, sin la dirección', () => {
    const t = hablar(crear({ catalogo: catalogoOk(TIENDA), modeloDice: sano() }), ANA, mTexto('¿Dónde está mi pedido? Quiero una billetera'));
    expect(J(t.mensajes)).not.toContain(DIR);
  });
});

describe('(d) los falsos positivos no disparan la ubicación: «pásame el mapa de tallas», «pásame la dirección donde envían»', () => {
  for (const frase of ['pásame el mapa de tallas', 'pásame la dirección donde envían']) {
    it(`«${frase}» sigue su camino (al modelo) y no contesta la ubicación de la tienda`, () => {
      const t = hablar(crear({ catalogo: catalogoOk(TIENDA), modeloDice: modelo('Con gusto.') }), ANA, mTexto(frase));
      expect(plan(t).plan).not.toBe('ubicacion_tienda');
      expect(J(t.mensajes)).not.toContain(MAPA);
      expect(J(t.mensajes)).not.toContain(DIR);
    });
  }
  it('(b) «me pasan la dirección» sí la contesta', () => {
    const t = hablar(crear({ catalogo: catalogoOk(TIENDA), modeloDice: ADVERSO }), ANA, mTexto('me pasan la dirección'));
    expect(J(t.mensajes)).toContain(MAPA);
    expect(llamoAlModelo(t)).toBe(false);
  });
});
