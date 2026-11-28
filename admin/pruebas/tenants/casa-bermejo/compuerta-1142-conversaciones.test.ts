/**
 * COMPUERTA DE LA OCTAVA RONDA DEL #1142 (28/11/2026): los guiones G1 a G24 como CONVERSACIONES COMPLETAS (ficha nueva, estado entre turnos, modelo realista que ante un mensaje vago pregunta).
 * Se comprueba por turno: el texto enviado, los avisos a recepción y `derivadoMs`. En todo guion: 1 mensaje al cliente por turno y nunca «pago acreditado / verificado / recibimos tu pago».
 * La válvula (la pregunta fija seguida, el mismo fallo real seguido) la decide un CONTADOR de la ficha (`sinAvance`, `fallos`), no una comparación de textos. D-A (Andres, 28/11): tras el saludo, 1.º vago → pregunta fija, 2.º → categorías (nunca deriva), 3.º → recepción con aviso y botón. D-B: ese pase NO abre la ventana de 2 h; la insistencia real («No pude agregar…» repetido) sí.
 * Pendiente para el #1151 (declarado): «¿qué venden?» / «catálogo» respondidos por código con el catálogo o su botón (Estándar 1.1); aquí, sin botón de catálogo, se exige que NO derive ni calle (G6, G7).
 * G17 (catálogo caído o modelo caído abren la ventana) queda como excepción registrada, no resuelta en esta ronda.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { LlamadaDoble } from '../../lib/n8n-de-mentira';
import { ANA, ARGENTINO, COMPROBANTE, ENTREGA, catalogoOk, completarEnvio, crear, hablar, mImagen, mSticker, mTexto, mToque, modelo, panelConQr, textoAlModelo, textos, type Opciones } from './mundo';

const pieza = (id: string, nombre: string, precio: number, extra: J = {}): J => ({ id, nombre, descripcion: nombre, area: 'Hogar · Electro', precio, moneda: 'BOB', activo: true, precioCentavos: precio * 100, stock: 100, disponible: true, ...extra });
const REAL = [pieza('lavadora-9kg', 'Lavadora Samsung 9 kg', 7655), pieza('licuadora-oster', 'Licuadora Oster', 4148), pieza('billetera-cuero', 'Billetera de cuero', 450)];
const REAL_AR = REAL.map((v) => ({ ...v, moneda: 'ARS', precio: v.precio as number * 1000, precioCentavos: (v.precioCentavos as number) * 1000 }));
type Rep = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const U = { base: { tratamiento: 'usted' } };
const P = '¿Qué producto busca?';
const F = 'Con gusto. Si necesita algo más, escríbame.';
const COINC = 'Tenemos Billetera de cuero a Bs 450. ¿Le interesa?';
const PROHIBIDO = /pago acreditado|pago verificado|recib[ií]mos? tu pago/i;
// El modelo realista: ante un mensaje vago responde con una pregunta y sin líneas; con «tapiz» propone un id inventado.
const realista = (ll: LlamadaDoble): J => (/tapiz/i.test(textoAlModelo(ll)) ? modelo('Agregué el tapiz azul.', { lineas: [{ id: 'tapiz-azul', cantidad: 1 }] }) : modelo('¡Hola! ¿En qué puedo ayudarle?'));
const mundo = (o: Opciones = {}) => crear({ catalogo: catalogoOk({}, REAL as never), modeloDice: realista, ...U, ...o });
const ficha = (m: ReturnType<typeof crear>, tel = ANA): Rep => ((m.sd['casabermejo'] ?? {}) as Record<string, Rep>)[tel] ?? {};
type Turno = { x: string; txt: string; avisos: number; derivado: number; n: number; t: ReturnType<typeof hablar> };
function charla(m: ReturnType<typeof crear>, msgs: Array<string | J>, tel = ANA): Turno[] {
  return msgs.map((x) => {
    const t = hablar(m, tel, typeof x === 'string' ? mTexto(x) : x);
    const txt = textos(t).join(' ');
    expect(t.mensajes.length, String(typeof x === 'string' ? x : 'medio')).toBeLessThanOrEqual(1);   // 7.4: 1 mensaje por turno
    expect(txt).not.toMatch(PROHIBIDO);
    return { x: typeof x === 'string' ? x : 'medio', txt, avisos: t.avisos.length, derivado: ficha(m, tel).derivadoMs ?? 0, n: t.mensajes.length, t };
  });
}
const sinRecepcion = (ts: Turno[]): void => { for (const t of ts) { expect(t.avisos, t.x).toBe(0); expect(t.derivado, t.x).toBe(0); expect(t.txt, t.x).not.toContain(F); expect(t.txt, t.x).not.toMatch(/persona del equipo/); } };

describe('G1 a G5 (r7): dos mensajes vagos seguidos son normales; la pieza pedida después se atiende', () => {
  const G: Array<[string, string[]]> = [
    ['G1', ['hola', 'qué tal', 'estoy buscando algo para regalar', 'una billetera']],
    ['G2', ['Hola buenas tardes', 'quería hacer una consulta', 'busco una billetera']],
    ['G3', ['hola', 'hola?', 'busco una billetera']],
    ['G4', ['buenas', 'tienen cosas para la casa?', 'y billeteras?']],
    ['G5', ['hola', 'gracias', 'quiero ver opciones', 'una billetera']],
  ];
  for (const [id, msgs] of G) {
    it(`${id}: «${msgs.join('» / «')}»`, () => {
      const ts = charla(mundo(), msgs);
      sinRecepcion(ts);
      expect(ts[0]!.txt).toContain(P);
      expect(ts[ts.length - 1]!.txt).toContain(COINC);
      if (id !== 'G4') for (const t of ts.slice(1, -1)) expect(t.txt, t.x).toContain(P);
    });
  }
});

describe('G6 y G7: «¿qué venden?» y «catálogo» no derivan ni callan', () => {
  // PENDIENTE #1151: responderlos por código con el catálogo o su botón (1.1). Hoy, sin botón de catálogo en este sha, sale la pregunta fija y nunca la derivación.
  it('G6: «hola» / «¿qué venden?», sin y con enlace del catálogo', () => {
    for (const o of [{}, { enlaceCatalogo: 'https://sitio.example' }, { panel: undefined }]) {
      const ts = charla(mundo(o as Opciones), ['hola', '¿qué venden?']);
      sinRecepcion(ts);
      expect(ts[1]!.txt).toContain(P);
    }
  });
  it('G7: «hola» / «catálogo» / «catálogo»', () => sinRecepcion(charla(mundo(), ['hola', 'catálogo', 'catálogo'])));
});

describe('G8: la insistencia REAL (el mismo fallo dos veces) sigue pasando con recepción y SÍ abre la ventana de 2 h', () => {
  it('«quiero el tapiz azul» ×2 y luego «una billetera»', () => {
    const m = mundo();
    const [t1, t2, t3] = charla(m, ['quiero el tapiz azul', 'quiero el tapiz azul', 'una billetera']);
    expect(t1!.txt).toMatch(/No pude agregar esa pieza al pedido\.\s*¿Cuál de nuestras piezas le interesa\?/);
    expect(t1!.avisos).toBe(0);
    expect(t2!.avisos).toBe(1);
    expect(t2!.derivado).toBeGreaterThan(0);
    expect(t3!.txt).toBe(F);
  });
});

describe('G9, G10 y G11: la válvula por estado', () => {
  it('G9: «hola» / «hola?» / «hmm» / «ok» / «ok» / «ok» / «ok»: recepción al 3.er turno sin avance (después del saludo), sin ventana; el aviso del bucle no se repite en 30 min', () => {
    const ts = charla(mundo(), ['hola', 'hola?', 'hmm', 'ok', 'ok', 'ok', 'ok']);
    expect([0, 1, 2].map((i) => ts[i]!.txt.includes(P))).toEqual([true, true, true]);
    expect(ts[2]!.txt).toContain('Tenemos piezas de Hogar');   // D-A: el 2.º mensaje seguido sin avance recibe las categorías y NUNCA deriva
    expect(ts[1]!.txt).not.toContain('Tenemos piezas de');
    expect([1, 2].map((i) => ts[i]!.avisos)).toEqual([0, 0]);
    expect(ts[3]!.avisos).toBe(1);
    expect(ts[3]!.txt).toMatch(/persona del equipo/);
    expect(ts.map((t) => t.derivado)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(ts[4]!.txt).toContain(P);
    expect(ts[5]!.txt).toContain(P);
    expect(ts[6]!.avisos).toBe(0);   // otra recepción dentro de 30 min: aviso «repetido»
    expect(ts[6]!.txt).toMatch(/ya recibió tu aviso anterior|ya recibió su aviso anterior|Recepción ya recibió/);
  });
  it('D-B: tras el pase a recepción por falta de avance, «una billetera» se atiende normal (no «Con gusto…») y no hay ventana', () => {
    const m = mundo();
    const ts = charla(m, ['hola', 'hola?', 'hmm', 'ok', 'una billetera']);
    expect(ts[3]!.avisos).toBe(1);
    expect(ts[3]!.t.avisos[0]!.cuerpo).toMatch(/no logró saber qué pieza busca/);   // motivo propio `sin_avance`, distinto de «pidió hablar con una persona»
    expect(ts[3]!.t.avisos[0]!.cuerpo).not.toMatch(/pidió hablar con una persona/);
    expect(ficha(m).derivadoMs ?? 0).toBe(0);
    expect(ts[4]!.txt).toContain(COINC);
    expect(ts[4]!.txt).not.toContain(F);
  });
  it('G10: coincidencias y «sí» alternados no son un vaivén sin fin: la válvula los cuenta', () => {
    const ts = charla(mundo(), ['¿tienen billeteras?', 'sí', 'la billetera', 'sí', 'la billetera', 'sí']);
    expect(ts.map((t) => t.avisos)).toEqual([0, 0, 0, 0, 0, 1]);
    expect(ts[0]!.txt).toContain(COINC);
    expect(ts[2]!.txt).toContain(COINC);
  });
  for (const [nombre, medio] of [['un sticker', mSticker()], ['una foto', mImagen({ caption: '' })], ['la identidad', '¿eres un bot?']] as Array<[string, string | J]>) {
    it(`G11: «hola» / ${nombre} / «ok» no deriva: los turnos que no son la ruta vacía reinician el contador`, () => {
      const ts = charla(mundo(), ['hola', medio, 'ok', 'ok']);
      expect(ts.map((t) => t.avisos)).toEqual([0, 0, 0, 0]);
      expect(ts.map((t) => t.derivado)).toEqual([0, 0, 0, 0]);
      expect(ts[2]!.txt).toContain(P);
    });
  }
});

describe('G12 y G13: después del pago el cliente que agradece no deriva', () => {
  it('G12 (BO): pedido → entrega → «Confirmar pedido» → QR → comprobante que cuadra → «gracias» ×2', () => {
    const m = crear({ catalogo: catalogoOk({}, REAL as never), ...U, entregaPrevia: ENTREGA, modeloDice: (ll: LlamadaDoble) => (/gracias/i.test(textoAlModelo(ll)) ? modelo('¡Gracias a usted!') : modelo('Con gusto, lo anoto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }] })), medio: { clasificacion: COMPROBANTE } });
    hablar(m, ANA, mTexto('una billetera'));
    hablar(m, ANA, mTexto('quiero pagar'));
    m.dobles['Traer configuración'] = () => panelConQr(450);
    const comp = hablar(m, ANA, mImagen({ caption: '' }));
    expect(textos(comp).join(' ')).toMatch(/llegó y los datos coinciden/);
    const ts = charla(m, ['gracias', 'muchas gracias']);
    for (const t of ts) { expect(t.avisos, t.x).toBe(0); expect(t.txt, t.x).not.toMatch(/persona del equipo|pidió hablar/); }
    expect(ficha(m).derivadoMs ?? 0).toBe(0);
  });
  it('G13 (AR): pedido anotado con el botón «Pagar» → «gracias» / «ok» no derivan', () => {
    const m = crear({ catalogo: catalogoOk({ mercado: 'AR', moneda: 'ARS' }, REAL_AR as never), ...U, modeloDice: (ll: LlamadaDoble) => (/gracias|ok/i.test(textoAlModelo(ll)) ? modelo('Con gusto.') : modelo('Con gusto, lo anoto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }] })) });
    hablar(m, ARGENTINO, mTexto('una billetera'));
    hablar(m, ARGENTINO, mToque('entrega:envio', 'Envío'));
    completarEnvio(m, ARGENTINO, 'AR');
    const anotado = hablar(m, ARGENTINO, mTexto('quiero pagar'));
    expect(JSON.stringify(anotado.mensajes.map((x) => x.payload))).toContain('pedido:alias');
    const ts = charla(m, ['gracias', 'ok'], ARGENTINO);
    for (const t of ts) { expect(t.avisos, t.x).toBe(0); expect(t.txt, t.x).not.toMatch(/persona del equipo|pidió hablar/); }
  });
});

describe('G14 a G17, G21 a G23: la derivación legítima sigue abriendo la ventana (I-4 intacto)', () => {
  it('G14: «quiero hablar con una persona» / «una billetera» / «Bien, gracias»; a las 3 h, la conducta normal', () => {
    const m = mundo();
    const ts = charla(m, ['quiero hablar con una persona', 'una billetera', 'Bien, gracias']);
    expect(ts[0]!.avisos).toBe(1);
    expect(ts[0]!.derivado).toBeGreaterThan(0);
    expect(ts[1]!.txt).toBe(F);
    expect(ts[2]!.txt).toBe(F);
    m.avanzar(180);
    expect(charla(m, ['una billetera'])[0]!.txt).toContain(COINC);
  });
  it('G15: la derivación por falta de avance no tapa un aviso real: a los 5 minutos «necesito factura» llega a recepción', () => {
    const m = mundo();
    const ts = charla(m, ['hola', 'hola?', 'hmm', 'ok']);
    expect(ts[3]!.avisos).toBe(1);
    m.avanzar(5);
    const [f] = charla(m, ['necesito factura']);
    expect(f!.avisos).toBe(1);
    expect(f!.txt).not.toMatch(/ya recibió (tu|su) aviso anterior/);
  });
  it('G16: con el pedido NO vacío la válvula no corre: «hola» ×3 responde el estado del pedido', () => {
    const m = crear({ catalogo: catalogoOk({}, REAL as never), ...U, modeloDice: (ll: LlamadaDoble) => (/billetera/i.test(textoAlModelo(ll)) ? modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }] }) : modelo('¡Hola!')) });
    hablar(m, ANA, mTexto('una billetera'));
    const ts = charla(m, ['hola', 'hola', 'hola', 'hola']);
    for (const t of ts) { expect(t.avisos, t.x).toBe(0); expect(t.txt, t.x).not.toBe(''); expect(t.txt, t.x).not.toContain(F); }
    expect(ficha(m).carrito.length).toBe(1);
  });
  it('G21: «¿aceptan tarjeta?» (medio no cargado) pasa con recepción y abre la ventana: «busco una billetera» recibe el texto fijo', () => {
    const ts = charla(mundo(), ['hola', '¿aceptan tarjeta?', 'busco una billetera']);
    expect(ts[1]!.avisos).toBe(1);
    expect(ts[1]!.derivado).toBeGreaterThan(0);
    expect(ts[2]!.txt).toBe(F);
  });
  it('G22: «quiero hablar con alguien» a t0 y otra vez a t0 + 1 h 59: 2.ª recepción con aviso; la ventana se reinicia', () => {
    const m = mundo();
    const [a] = charla(m, ['quiero hablar con alguien']);
    m.avanzar(118);
    const [b] = charla(m, ['quiero hablar con alguien']);
    expect(a!.avisos).toBe(1);
    expect(b!.avisos).toBe(1);
    expect(b!.derivado).toBeGreaterThan(a!.derivado);
  });
  it('G23: con la ventana abierta, tres consultas reciben el texto fijo, sin recepción ni válvula', () => {
    const ts = charla(mundo(), ['quiero hablar con una persona', '¿tienen billeteras?', '¿y licuadoras?', '¿cuánto cuesta una lavadora?']);
    expect(ts.slice(1).map((t) => t.txt)).toEqual([F, F, F]);
    expect(ts.slice(1).map((t) => t.avisos)).toEqual([0, 0, 0]);
  });
});

describe('G18 y G19: una cantidad o un stock que el catálogo no respalda no pasa', () => {
  for (const frase of ['Tenemos 3 Billetera de cuero.', 'Tenemos Billetera de cuero a Bs 450, quedan 2.', 'Tenemos 10 Billetera de cuero a Bs 450.']) {
    it(`G18 NEGADO: «${frase}» no sale; sale la coincidencia del código`, () => {
      const [, t] = charla(mundo({ modeloDice: (ll: LlamadaDoble) => (/billeteras/.test(textoAlModelo(ll)) ? modelo(frase) : realista(ll)) }), ['hola', '¿tienen billeteras?']);
      expect(t!.txt).toBe(COINC);
      expect(t!.txt).not.toMatch(/Tenemos 3|Tenemos 10|quedan 2/);
    });
  }
  it('G18 control: «Tenemos Billetera de cuero a Bs 450.» sí sale', () => {
    expect(charla(mundo({ modeloDice: (ll: LlamadaDoble) => (/billeteras/.test(textoAlModelo(ll)) ? modelo('Tenemos Billetera de cuero a Bs 450.') : realista(ll)) }), ['hola', '¿tienen billeteras?'])[1]!.txt).toBe('Tenemos Billetera de cuero a Bs 450.');
  });
  it('G19 (AR): «Tenemos 2 Billetera de cuero a ARS 450.000.» no sale; el texto solo con el monto sí', () => {
    const cat = () => catalogoOk({ mercado: 'AR', moneda: 'ARS' }, REAL_AR as never);
    const con = (x: string | null) => charla(crear({ catalogo: cat(), ...U, modeloDice: (ll: LlamadaDoble) => (/billeteras/.test(textoAlModelo(ll)) && x !== null ? modelo(x) : realista(ll)) }), ['hola', '¿tienen billeteras?'], ARGENTINO)[1]!.txt;
    const base = con(null);
    const solo = base.replace(/\.\s*¿Le interesa\?$/, '.');
    expect(base).toMatch(/Tenemos Billetera de cuero a ARS/);
    expect(con(solo.replace('Tenemos ', 'Tenemos 2 '))).toBe(base);
    expect(con(solo)).toBe(solo);
  });
});

describe('G20, G24: el procedimiento no cuenta para la válvula; el trato no se mezcla', () => {
  it('G20: «¿cómo compro?» / «¿cómo pago?» / «¿cómo compro?» dan el procedimiento 3 veces, sin recepción', () => {
    const m = mundo();
    const ts = charla(m, ['¿cómo compro?', '¿cómo pago?', '¿cómo compro?']);
    sinRecepcion(ts);
    for (const t of ts) expect(t.txt).toMatch(/«Confirmar pedido»/);
    expect(ficha(m).sinAvance ?? 0).toBe(0);
  });
  it('G24 (trato tú): «hola» / «hola?» no deriva y todo sale en tú, también las coincidencias', () => {
    const m = crear({ catalogo: catalogoOk({}, REAL as never), modeloDice: realista });
    const ts = charla(m, ['hola', 'hola?', '¿tienen billeteras?']);
    expect(ts[1]!.avisos).toBe(0);
    expect(ts[1]!.txt).toContain('¿Qué producto buscas?');
    expect(ts[2]!.txt).toContain('¿Te interesa?');
    expect(ts[2]!.txt).not.toMatch(/Le interesa|\bbusca\?/);
  });
});
