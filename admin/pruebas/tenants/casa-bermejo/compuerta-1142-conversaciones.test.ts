/**
 * COMPUERTA DE LA OCTAVA RONDA DEL #1142 (28/11/2026): los guiones G1 a G24 como CONVERSACIONES COMPLETAS (ficha nueva, estado entre turnos, modelo realista que ante un mensaje vago pregunta).
 * Se comprueba por turno: el texto enviado, los avisos a recepción y `derivadoMs`. En todo guion: 1 mensaje al cliente por turno y nunca «pago acreditado / verificado / recibimos tu pago».
 * La válvula (mensajes vagos seguidos, el mismo fallo real seguido) la decide un CONTADOR de la ficha (`sinAvance`, `fallos`), no una comparación de textos. D-A (Andres, 28/11): el saludo vago cuenta como 1.º (pregunta fija), el 2.º seguido → categorías (nunca deriva), el 3.º → recepción con aviso y botón. D-B: ese pase NO abre la ventana de 2 h; la insistencia real («No pude agregar…» repetido) sí.
 * Novena ronda (criterio de la dueña): el contador caduca a los 30 min entre mensajes del cliente (hora del MENSAJE), una coincidencia real o el catálogo es avance, tras un comprobante cotejado no corre, «?» y «...» cuentan como vagos.
 * Pendiente para el #1151 (declarado): «¿qué venden?» / «catálogo» respondidos por código con el catálogo o su botón (Estándar 1.1); aquí, sin botón de catálogo, se exige que NO derive ni calle (G6, G7).
 * G17 (catálogo caído o modelo caído abren la ventana) queda como excepción registrada, no resuelta en esta ronda.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { LlamadaDoble } from '../../lib/n8n-de-mentira';
import { ANA, ARGENTINO, COMPROBANTE, ENTREGA, catalogoOk, completarEnvio, crear, hablar, mAudio, mImagen, mSticker, mTexto, mToque, mUbicacion, modelo, panelConQr, textoAlModelo, textos, type Opciones } from './mundo';

const pieza = (id: string, nombre: string, precio: number, extra: J = {}): J => ({ id, nombre, descripcion: nombre, area: 'Hogar · Electro', precio, moneda: 'BOB', activo: true, precioCentavos: precio * 100, stock: 100, disponible: true, ...extra });
const REAL = [pieza('lavadora-9kg', 'Lavadora Samsung 9 kg', 7655), pieza('licuadora-oster', 'Licuadora Oster', 4148), pieza('billetera-cuero', 'Billetera de cuero', 450)];
const REAL_AR = REAL.map((v) => ({ ...v, moneda: 'ARS', precio: v.precio as number * 1000, precioCentavos: (v.precioCentavos as number) * 1000 }));
type Rep = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const U = { base: { tratamiento: 'usted' } };
const P = '¿Qué producto busca?';
const F = 'Con gusto. Si necesita algo más, escríbame.';
const COINC = 'Tenemos Billetera de cuero a Bs 450.\n\n¿Le interesa?';
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
    // 7.4: 1 mensaje por turno; una LISTA del catálogo con enlace va seguida de su botón «Ver catálogo» aparte (+1, aceptado por Andres el 27/11/2026) y solo eso.
    const conBotonAparte = t.mensajes.length === 2 && JSON.stringify(t.mensajes[1]!.payload).includes('cta_url') && JSON.stringify(t.mensajes[0]!.payload).includes('"list"');
    expect(t.mensajes.length, String(typeof x === 'string' ? x : 'medio')).toBeLessThanOrEqual(conBotonAparte ? 2 : 1);
    expect(txt).not.toMatch(PROHIBIDO);
    return { x: typeof x === 'string' ? x : 'medio', txt, avisos: t.avisos.length, derivado: ficha(m, tel).derivadoMs ?? 0, n: t.mensajes.length, t };
  });
}
const sinRecepcion = (ts: Turno[]): void => { for (const t of ts) { expect(t.avisos, t.x).toBe(0); expect(t.derivado, t.x).toBe(0); expect(t.txt, t.x).not.toContain(F); expect(t.txt, t.x).not.toMatch(/persona del equipo/); } };

describe('G1 a G5: el saludo vago cuenta como 1.º; la pieza pedida se atiende normal, también después del pase a recepción', () => {
  const G: Array<[string, string[]]> = [
    ['G2', ['Hola buenas tardes', 'quería hacer una consulta', 'busco una billetera']],
    ['G3', ['hola', 'hola?', 'busco una billetera']],
    ['G4', ['buenas', 'tienen cosas para la casa?', 'y billeteras?']],
  ];
  for (const [id, msgs] of G) {
    it(`${id}: «${msgs.join('» / «')}»: sin recepción y la última muestra la pieza`, () => {
      const ts = charla(mundo(), msgs);
      sinRecepcion(ts);
      expect(ts[0]!.txt).toContain(P);
      expect(ts[ts.length - 1]!.txt).toContain(COINC);
    });
  }
  for (const [id, msgs] of [['G1', ['hola', 'qué tal', 'estoy buscando algo para regalar', 'una billetera']], ['G5', ['hola', 'gracias', 'quiero ver opciones', 'una billetera']]] as Array<[string, string[]]>) {
    it(`${id}: «${msgs.join('» / «')}»: 1.º pregunta fija, 2.º categorías sin recepción, 3.º recepción SIN ventana, y «una billetera» se atiende normal`, () => {
      const ts = charla(mundo(), msgs);
      expect(ts[0]!.txt).toContain(P);
      expect(ts[1]!.txt).toMatch(/Estos son los productos de Hogar/);
      expect([ts[0]!.avisos, ts[1]!.avisos, ts[2]!.avisos]).toEqual([0, 0, 1]);
      expect(ts.map((t) => t.derivado)).toEqual([0, 0, 0, 0]);
      expect(ts[3]!.txt).toContain(COINC);
      expect(ts[3]!.txt).not.toContain(F);
    });
  }
});

describe('G6 y G7: «¿qué venden?» y «catálogo» no derivan ni callan', () => {
  it('G6: «hola» / «¿qué venden?», sin y con enlace del catálogo', () => {
    for (const o of [{}, { enlaceCatalogo: 'https://sitio.example' }, { panel: undefined }]) {
      const ts = charla(mundo(o as Opciones), ['hola', '¿qué venden?']);
      sinRecepcion(ts);
      expect(ts[1]!.txt).not.toContain(P);   // #1151 (1.1): lo contesta el código con el catálogo (lista, y con enlace el botón), nunca con la pregunta fija
      expect(ts[1]!.txt).toMatch(/productos de Hogar|categor/i);
      expect(JSON.stringify(ts[1]!.t.mensajes.map((e) => e.payload)).includes('cta_url')).toBe(o.enlaceCatalogo !== undefined);
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
  it('G9: «hola» / «hola?» / «hmm» / «ok» / «ok» / «ok» / «ok»: recepción al 3.er mensaje seguido (nunca al 2.º), sin ventana; el aviso no se repite en 30 min', () => {
    const ts = charla(mundo(), ['hola', 'hola?', 'hmm', 'ok', 'ok', 'ok', 'ok']);
    expect(ts[0]!.txt).toContain(P);
    expect(ts[1]!.txt).toMatch(/Estos son los productos de Hogar/);   // el 2.º: categorías, NUNCA recepción
    expect(ts.map((t) => t.avisos)).toEqual([0, 0, 1, 0, 0, 0, 0]);
    expect(ts[2]!.txt).toMatch(/persona del equipo/);
    expect(ts.map((t) => t.derivado)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(ts[3]!.txt).toContain(P);
    expect(ts[4]!.txt).toMatch(/Estos son los productos de Hogar/);
    expect(ts[5]!.txt).toMatch(/ya recibió (tu|su) aviso anterior|Recepción ya recibió/);   // 2.º pase dentro de 30 min: aviso «repetido»
  });
  it('G9 literal: «?» y «...» cuentan como vagos con la misma salida de tres pasos', () => {
    const ts = charla(mundo(), ['hola', '?', '...', 'ok']);
    expect(ts.map((t) => t.avisos)).toEqual([0, 0, 1, 0]);
    expect(ts.map((t) => t.derivado)).toEqual([0, 0, 0, 0]);
    const emojis = charla(mundo(), ['hola', '👍', '👍', 'una billetera']);
    expect(emojis.map((t) => t.avisos)).toEqual([0, 0, 1, 0]);
    expect(emojis[3]!.txt).toContain(COINC);
  });
  it('D-B: tras el pase a recepción por falta de avance, «una billetera» se atiende normal (no «Con gusto…») y no hay ventana', () => {
    const m = mundo();
    const ts = charla(m, ['hola', 'hola?', 'hmm', 'una billetera']);
    expect(ts[2]!.avisos).toBe(1);
    expect(ts[2]!.t.avisos[0]!.cuerpo).toMatch(/no logró saber qué pieza busca/);   // motivo propio `sin_avance`, distinto de «pidió hablar con una persona»
    expect(ts[2]!.t.avisos[0]!.cuerpo).not.toMatch(/pidió hablar con una persona/);
    expect(ficha(m).derivadoMs ?? 0).toBe(0);
    expect(ts[3]!.txt).toContain(COINC);
    expect(ts[3]!.txt).not.toContain(F);
  });
  it('G10 (rehecho): una consulta que el código responde con una coincidencia real es avance y reinicia el contador: «sí» entre coincidencias no deriva', () => {
    const ts = charla(mundo(), ['¿tienen billeteras?', 'sí', 'la billetera', 'sí', 'la billetera', 'sí', 'la billetera', 'sí']);
    expect(ts.map((t) => t.avisos)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(ts[0]!.txt).toContain(COINC);
    expect(ts[2]!.txt).toContain(COINC);
  });
  it('F3: un pedido concreto en medio reinicia: «hola» / «hola?» / «busco una billetera» / «ok» / «ok» no deriva hasta el 3.º seguido', () => {
    const ts = charla(mundo(), ['hola', 'hola?', 'busco una billetera', 'ok', 'ok']);
    expect(ts.map((t) => t.avisos)).toEqual([0, 0, 0, 0, 0]);
    expect(ts[3]!.txt).toContain(P);
    expect(ts[4]!.txt).toMatch(/Estos son los productos de Hogar/);
    const tres = charla(mundo(), ['hola', 'hola?', 'hmm', 'busco una billetera', 'ok']);
    expect(tres.map((t) => t.avisos)).toEqual([0, 0, 1, 0, 0]);   // tras el pase por falta de avance y la coincidencia, el «ok» es el 1.º vago
  });
  it('F2: el contador caduca a los 30 minutos sin mensajes del cliente (también a 1 h y a 47 h)', () => {
    for (const minutos of [31, 60, 47 * 60]) {
      const m = mundo();
      charla(m, ['hola', 'hola?']);
      m.avanzar(minutos);
      m.dobles['Traer catálogo'] = () => catalogoOk({ generadoEn: new Date(m.ahora()).toISOString(), cotizacion: { id: 'c1', par: 'USD/BOB', valor: 12, fecha: new Date(m.ahora()).toISOString().slice(0, 10), fuente: 'prueba', estado: 'vigente' } }, REAL as never);
      const [t] = charla(m, ['hmm']);
      expect(t!.avisos, `${minutos} min`).toBe(0);
      expect(t!.txt, `${minutos} min`).toContain(P);
      expect(t!.txt, `${minutos} min`).not.toContain('Tenemos piezas de');
    }
    const m = mundo();
    charla(m, ['hola', 'hola?']);
    m.avanzar(20);
    expect(charla(m, ['hmm'])[0]!.avisos).toBe(1);   // dentro de los 30 min sigue contando
  });
  it('F2 (negada): la caducidad se mide con la HORA DEL MENSAJE, no con la de la ejecución: un reintento tardío del mismo mensaje no reinicia el contador', () => {
    const m = mundo();
    charla(m, ['hola', 'hola?']);
    const sello = Math.floor(m.ahora() / 1000);
    m.avanzar(120);   // n8n ejecuta el mensaje 2 h después, pero WhatsApp lo selló 1 minuto después del anterior
    const t = hablar(m, ANA, { ...mTexto('hmm'), timestamp: String(sello - 60 * 119) });
    expect(t.avisos.length).toBe(1);
    const m2 = mundo();
    charla(m2, ['hola', 'hola?']);
    m2.avanzar(120);
    const t2 = hablar(m2, ANA, { ...mTexto('hmm'), timestamp: String(Math.floor(m2.ahora() / 1000)) });   // el cliente escribió de verdad 2 h después
    expect(t2.avisos.length).toBe(0);
  });
  it('(f) «¿qué venden?» y «catálogo» son avance y no derivan, repetidos', () => {
    const ts = charla(mundo(), ['hola', '¿qué venden?', '¿qué venden?', 'catálogo', 'catálogo', '¿qué venden?']);
    sinRecepcion(ts);
    expect(ts.slice(1).map((t) => /productos de Hogar|categor/i.test(t.txt) && !t.txt.includes(P))).toEqual([true, true, true, true, true]);
  });
  for (const [nombre, medio] of [['un sticker', mSticker()], ['una foto', mImagen({ caption: '' })], ['la identidad', '¿eres un bot?'], ['una ubicación compartida', mUbicacion()]] as Array<[string, string | J]>) {
    it(`G11: «hola» / ${nombre} / «ok» no deriva: los turnos que no son la ruta vacía reinician el contador`, () => {
      const ts = charla(mundo(), ['hola', medio, 'ok', 'ok']);
      expect(ts.map((t) => t.avisos)).toEqual([0, 0, 0, 0]);
      expect(ts.map((t) => t.derivado)).toEqual([0, 0, 0, 0]);
      expect(ts[2]!.txt).toContain(P);
    });
  }
});

describe('G11 (audio y ubicación de la tienda)', () => {
  it('«hola» / un audio sin transcripción / «ok» / «ok»: el audio reinicia el contador y no deriva', () => {
    const ts = charla(mundo({ medio: { transcripcion: null } }), ['hola', mAudio(), 'ok', 'ok']);
    expect(ts.map((t) => t.avisos)).toEqual([0, 0, 0, 0]);
    expect(ts.map((t) => t.derivado)).toEqual([0, 0, 0, 0]);
  });
  it('«hola» / «¿dónde están ubicados?» (con dirección cargada) / «ok» / «ok»: no deriva, la ubicación reinicia el contador', () => {
    const ts = charla(mundo({ catalogo: catalogoOk({ tienda: { nombre: 'Casa Bermejo', direccion: 'Calle Comercio 123, La Paz' } }, REAL as never) }), ['hola', '¿dónde están ubicados?', 'ok', 'ok']);
    expect(ts.map((t) => t.avisos)).toEqual([0, 0, 0, 0]);
    expect(ts[1]!.txt).toContain('Calle Comercio 123');
  });
});

describe('G12 y G13: después del pago el cliente que agradece no deriva', () => {
  it('G12 (BO): pedido → entrega → «Confirmar pedido» → QR → comprobante que cuadra → «gracias» ×2', () => {
    const m = crear({ catalogo: catalogoOk({}, REAL as never), ...U, entregaPrevia: ENTREGA, modeloDice: (ll: LlamadaDoble) => (/gracias/i.test(textoAlModelo(ll)) ? modelo('¡Gracias a usted!') : modelo('Con gusto, lo anoto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }] })), medio: { clasificacion: COMPROBANTE } });
    hablar(m, ANA, mTexto('una billetera'));
    hablar(m, ANA, mTexto('quiero pagar'));
    m.dobles['Traer configuración'] = () => panelConQr(450);
    const comp = hablar(m, ANA, mImagen({ caption: '' }));
    expect(textos(comp).join(' ')).toMatch(/llegó y los datos coinciden/);
    const ts = charla(m, ['gracias', 'muchas gracias', 'gracias', 'gracias']);   // tras un comprobante cotejado el contador no corre
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
    const ts = charla(m, ['gracias', 'ok', 'gracias', 'ok'], ARGENTINO);
    for (const t of ts) { expect(t.avisos, t.x).toBe(0); expect(t.txt, t.x).not.toMatch(/persona del equipo|pidió hablar/); }
    // El toque «Pagar» al final de la misma secuencia: con el alias encendido da el alias; con el alias apagado (409 cerrado) pasa a recepción con el botón, sin alias.
    const ALIAS = 'casa.bermejo.pagos';
    m.dobles['Avisar al servidor'] = () => ({ statusCode: 200, body: { estado: 'abierto', alias: ALIAS, montoCentavos: 45000000, moneda: 'ARS', venceEn: new Date(m.ahora() + 30 * 60_000).toISOString(), reutilizado: false } }) as never;
    const pago = hablar(m, ARGENTINO, mToque('pedido:alias', 'Pagar'));
    expect(textos(pago).join(' ')).toContain(ALIAS);
    const apagado = crear({ catalogo: catalogoOk({ mercado: 'AR', moneda: 'ARS' }, REAL_AR as never), ...U, modeloDice: (ll: LlamadaDoble) => (/gracias|ok/i.test(textoAlModelo(ll)) ? modelo('Con gusto.') : modelo('Con gusto, lo anoto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }] })) });
    hablar(apagado, ARGENTINO, mTexto('una billetera'));
    hablar(apagado, ARGENTINO, mToque('entrega:envio', 'Envío'));
    completarEnvio(apagado, ARGENTINO, 'AR');
    hablar(apagado, ARGENTINO, mTexto('quiero pagar'));
    charla(apagado, ['gracias', 'ok'], ARGENTINO);
    apagado.dobles['Avisar al servidor'] = () => ({ statusCode: 409, body: { error: 'cerrado' } }) as never;
    const sinAlias = hablar(apagado, ARGENTINO, mToque('pedido:alias', 'Pagar'));
    expect(textos(sinAlias).join(' ')).not.toContain(ALIAS);
    expect(JSON.stringify(sinAlias.mensajes.map((x) => x.payload))).toContain('cta_url');   // el botón para escribir a recepción
  });
});

describe('G17 (excepción registrada, fija lo actual): una derivación que el cliente no pidió abre la ventana de 2 h', () => {
  it('catálogo caído en t1 → recepción y ventana; al volver el catálogo, «una billetera» recibe el texto fijo por 2 h y luego la conducta normal', () => {
    const m = mundo({ catalogo: 'cae' });
    const [t1] = charla(m, ['hola']);
    expect(t1!.avisos).toBe(1);
    expect(t1!.derivado).toBeGreaterThan(0);
    m.dobles['Traer catálogo'] = () => catalogoOk({}, REAL as never);
    expect(charla(m, ['una billetera'])[0]!.txt).toBe(F);   // PENDIENTE (G17): hoy calla 2 h aunque el cliente no pidió una persona
    m.avanzar(180);
    expect(charla(m, ['una billetera'])[0]!.txt).toContain(COINC);
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
    const ts = charla(m, ['hola', 'hola?', 'hmm']);
    expect(ts[2]!.avisos).toBe(1);
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

describe('F1: ninguna cantidad de existencias sale del modelo con el pedido vacío; una cifra solo vale como EL precio tras Bs, ARS o $', () => {
  const casos = (cat: J[], moneda: string, from: string, pieza: string, busca: string, precio: string): void => {
    const modelos = [
      `Tenemos 4 ${pieza} a ${moneda} ${precio}.`, `Tenemos 148 ${pieza} a ${moneda} ${precio}.`, `Tenemos 7 ${pieza} a ${moneda} ${precio}.`, `Tenemos ${pieza} a ${moneda} ${precio} y hay 7.`,
      `Tenemos 450 ${pieza} a ${moneda} ${precio}.`, `Tenemos ${pieza} a ${moneda} ${precio}, quedan 2.`, `Tenemos ${pieza} a ${moneda} ${precio.replace(/\.\d+$/, '')}.`, `Tenemos ${pieza} a ${moneda} 655.`, `Tenemos ${pieza} a ${moneda} 7.`,
      `Tenemos ${pieza} a ${moneda} ${precio} (${precio.replace(/\D/g, '').slice(0, 1)} en stock).`,
    ];
    const buena = `Tenemos ${pieza} a ${moneda} ${precio}.`;
    for (const frase of modelos.filter((x) => x !== buena)) {
      const ts = charla(crear({ catalogo: catalogoOk(moneda === 'ARS' ? { mercado: 'AR', moneda: 'ARS' } : {}, cat as never), ...U, modeloDice: (ll: LlamadaDoble) => (/tienen/.test(textoAlModelo(ll)) ? modelo(frase) : realista(ll)) }), ['hola', busca], from);
      expect(ts[1]!.txt, frase).not.toBe(frase);
      expect(ts[1]!.txt, frase).toMatch(/¿Le interesa\?/);   // sale el texto fijo de la coincidencia
    }
    const ok = charla(crear({ catalogo: catalogoOk(moneda === 'ARS' ? { mercado: 'AR', moneda: 'ARS' } : {}, cat as never), ...U, modeloDice: (ll: LlamadaDoble) => (/tienen/.test(textoAlModelo(ll)) ? modelo(buena) : realista(ll)) }), ['hola', busca], from);
    expect(ok[1]!.txt).toBe(buena);   // control: solo el nombre y el precio exacto sí salen
  };
  it('Bs: licuadora Bs 4.148 (cifras 4 y 148), lavadora Bs 7.655 (7), billetera Bs 450 (450)', () => {
    casos(REAL, 'Bs', ANA, 'Licuadora Oster', '¿tienen licuadoras?', '4.148');
    casos(REAL, 'Bs', ANA, 'Lavadora Samsung 9 kg', '¿tienen lavadoras?', '7.655');
    casos(REAL, 'Bs', ANA, 'Billetera de cuero', '¿tienen billeteras?', '450');
  });
  it('ARS: billetera ARS 450.000 (450 y 000)', () => casos(REAL_AR, 'ARS', ARGENTINO, 'Billetera de cuero', '¿tienen billeteras?', '450.000'));
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
