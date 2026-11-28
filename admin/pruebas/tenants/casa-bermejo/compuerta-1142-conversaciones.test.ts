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
      expect(ts[1]!.txt).toContain('Tenemos piezas de Hogar');
      expect([ts[0]!.avisos, ts[1]!.avisos, ts[2]!.avisos]).toEqual([0, 0, 1]);
      expect(ts.map((t) => t.derivado)).toEqual([0, 0, 0, 0]);
      expect(ts[3]!.txt).toContain(COINC);
      expect(ts[3]!.txt).not.toContain(F);
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
  it('G9: «hola» / «hola?» / «hmm» / «ok» / «ok» / «ok» / «ok»: recepción al 3.er mensaje seguido (nunca al 2.º), sin ventana; el aviso no se repite en 30 min', () => {
    const ts = charla(mundo(), ['hola', 'hola?', 'hmm', 'ok', 'ok', 'ok', 'ok']);
    expect(ts[0]!.txt).toContain(P);
    expect(ts[1]!.txt).toContain('Tenemos piezas de Hogar');   // el 2.º: categorías, NUNCA recepción
    expect(ts.map((t) => t.avisos)).toEqual([0, 0, 1, 0, 0, 0, 0]);
    expect(ts[2]!.txt).toMatch(/persona del equipo/);
    expect(ts.map((t) => t.derivado)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(ts[3]!.txt).toContain(P);
    expect(ts[4]!.txt).toContain('Tenemos piezas de Hogar');
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
    expect(ts[4]!.txt).toContain('Tenemos piezas de Hogar');
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
  // N5: la caducidad se mide con la HORA DEL MENSAJE en TODAS las rutas (también con «?», «...» y «👍»), no con la de la ejecución. El sello se arma a partir del último mensaje REGISTRADO en la ficha.
  for (const vago of ['hmm', '?', '...', '👍']) {
    it(`F2 (negada, «${vago}»): un reintento tardío con el sello 1 minuto después del anterior (ejecutado 2 h después) NO reinicia el contador; escrito de verdad 2 h después, sí`, () => {
      const m = mundo();
      charla(m, ['hola', 'hola?']);
      const previo = ficha(m).ultimoMensajeMs as number;
      m.avanzar(120);   // n8n ejecuta el mensaje 2 h después, pero WhatsApp lo selló 1 minuto después del anterior
      const t = hablar(m, ANA, { ...mTexto(vago), timestamp: String(Math.floor(previo / 1000) + 60) });
      expect(t.avisos.length).toBe(1);
      const m2 = mundo();
      charla(m2, ['hola', 'hola?']);
      m2.avanzar(120);
      const t2 = hablar(m2, ANA, { ...mTexto(vago), timestamp: String(Math.floor(m2.ahora() / 1000)) });   // el cliente escribió de verdad 2 h después
      expect(t2.avisos.length).toBe(0);
    });
  }
  it('(f) «¿qué venden?» y «catálogo» son avance y no derivan, repetidos', () => {
    const ts = charla(mundo(), ['hola', '¿qué venden?', '¿qué venden?', 'catálogo', 'catálogo', '¿qué venden?']);
    sinRecepcion(ts);
    expect(ts.slice(1).map((t) => t.txt.includes('Tenemos piezas de Hogar'))).toEqual([true, true, true, true, true]);
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

describe('R2: el contador solo existe con el pedido VACÍO y FUERA de la ventana de 2 h; «?», «...» y «👍» reciben la pregunta fija', () => {
  const vagos = ['?', '...', '👍'];
  for (const v of vagos) {
    it(`(h) «${v}» solo recibe la pregunta fija (es texto), no «solo puedo leer texto»; con el pedido vacío cuenta como vago y el 3.º pasa con recepción`, () => {
      const ts = charla(mundo(), [v, v, v]);
      expect(ts[0]!.txt).toContain(P);
      expect(ts[0]!.txt).not.toMatch(/solo puedo leer texto/);
      expect(ts[1]!.txt).toContain('Tenemos piezas de Hogar');
      expect(ts.map((t) => t.avisos)).toEqual([0, 0, 1]);
    });
    it(`N4: con un pedido NO vacío «${v}» ×4 no deriva (el contador no existe), en usted, tú y Argentina`, () => {
      const modeloPedido = (ll: LlamadaDoble): J => (/billetera/i.test(textoAlModelo(ll)) ? modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }] }) : modelo('¡Hola!'));
      for (const [o, tel] of [[{ ...U }, ANA], [{ base: {} }, ANA], [{ catalogo: catalogoOk({ mercado: 'AR', moneda: 'ARS' }, REAL_AR as never) }, ARGENTINO]] as Array<[Opciones, string]>) {
        const m = mundo({ modeloDice: modeloPedido, ...o });
        hablar(m, tel, mTexto('una billetera'));
        const ts = charla(m, [v, v, v, v], tel);
        for (const t of ts) { expect(t.avisos, v).toBe(0); expect(t.txt, v).not.toMatch(/persona del equipo/); }
        expect(ficha(m, tel).carrito.length).toBe(1);
      }
    });
    it(`N4: dentro de la ventana de 2 h tras «quiero hablar con una persona», «${v}» ×3 no da una segunda derivación ni un segundo aviso`, () => {
      const ts = charla(mundo(), ['quiero hablar con una persona', v, v, v, v]);
      expect(ts.map((t) => t.avisos)).toEqual([1, 0, 0, 0, 0]);
      expect(ts.slice(1).map((t) => t.txt)).toEqual([F, F, F, F]);
    });
  }
  it('(i) tras un comprobante cotejado el contador no corre durante 30 min; después, normal', () => {
    const m = crear({ catalogo: catalogoOk({}, REAL as never), ...U, entregaPrevia: ENTREGA, modeloDice: (ll: LlamadaDoble) => (/gracias|ok|hmm/i.test(textoAlModelo(ll)) ? modelo('Con gusto.') : modelo('Con gusto, lo anoto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }] })), medio: { clasificacion: COMPROBANTE } });
    hablar(m, ANA, mTexto('una billetera'));
    hablar(m, ANA, mTexto('quiero pagar'));
    m.dobles['Traer configuración'] = () => panelConQr(450);
    hablar(m, ANA, mImagen({ caption: '' }));
    expect(charla(m, ['gracias', 'gracias', 'gracias'])!.map((t) => t.avisos)).toEqual([0, 0, 0]);
    m.avanzar(31);
    const ts = charla(m, ['hmm', 'hmm', 'hmm']);
    expect(ts.map((t) => t.avisos)).toEqual([0, 0, 1]);   // pasados 30 min el contador corre normal: recepción al 3.º
  });
  it('(k) con el pedido vacío la marca quiereHablar del modelo ante un texto vago («hmm») no deriva ni abre la ventana; el pedido real lo decide el código', () => {
    const m = mundo({ modeloDice: () => modelo('Lo verá una persona.', { quiereHablar: true }) });
    const ts = charla(m, ['hola', 'hmm', 'una billetera']);
    expect(ts.map((t) => t.avisos)).toEqual([0, 0, 0]);
    expect(ficha(m).derivadoMs ?? 0).toBe(0);
    expect(ts[2]!.txt).toContain(COINC);
    const real = charla(mundo({ modeloDice: () => modelo('Lo verá una persona.', { quiereHablar: true }) }), ['quiero hablar con una persona']);
    expect(real[0]!.avisos).toBe(1);
  });
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
  it('G18 control (R1): ni siquiera el texto exacto del modelo sale: sale el del código', () => {
    const ts = charla(mundo({ modeloDice: (ll: LlamadaDoble) => (/billeteras/.test(textoAlModelo(ll)) ? modelo('Tenemos Billetera de cuero a Bs 450.') : realista(ll)) }), ['hola', '¿tienen billeteras?']);
    expect(ts[1]!.txt).toBe(COINC);
  });
});

// R1 (la dueña, décima ronda): con el pedido VACÍO ningún texto del modelo llega al cliente. PROPIEDAD con generador con semilla: para CUALQUIER texto del modelo la salida es exactamente la que da un modelo neutro
// (la oración de coincidencias del código, la pregunta fija, las categorías o el procedimiento): ninguna subcadena del modelo que no venga del catálogo o de un texto fijo. Incluye N1 (precios cruzados), N2 (mismas cifras, otro valor) y N3 (cantidad con letras), en Bs y ARS.
describe('R1: con el pedido vacío ningún texto del modelo llega al cliente (propiedad con semilla)', () => {
  const SEMILLA_R1 = 1128;
  const azarR1 = (semilla: number): (() => number) => { let a = semilla >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; }; };
  const una = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
  const salida = (cat: J[], moneda: 'BOB' | 'ARS', from: string, cliente: string, dice: string): string => charla(crear({ catalogo: catalogoOk(moneda === 'ARS' ? { mercado: 'AR', moneda: 'ARS' } : {}, cat as never), ...U, modeloDice: (ll: LlamadaDoble) => (textoAlModelo(ll) === cliente ? modelo(dice) : realista(ll)) }), ['hola', cliente], from)[1]!.txt;
  const mundoDe = (m: 'BOB' | 'ARS') => (m === 'ARS' ? { cat: REAL_AR, from: ARGENTINO, p: ['450.000', '4.148.000', '7.655.000'], sim: 'ARS' } : { cat: REAL, from: ANA, p: ['450', '4.148', '7.655'], sim: 'Bs' });
  for (const mon of ['BOB', 'ARS'] as const) {
    it(`${mon}: N1 precios cruzados, N2 mismas cifras con otro valor, N3 cantidad con letras y 80 textos al azar no llegan al cliente`, () => {
      const w = mundoDe(mon);
      const cliente = '¿tienen lavadoras y licuadoras?';
      const base = salida(w.cat, mon, w.from, cliente, 'Hola.');
      expect(base).toMatch(/Lavadora Samsung 9 kg a /);
      const [pl, pq, pb] = [w.p[2]!, w.p[1]!, w.p[0]!];
      const fijas = [
        `Tenemos Lavadora Samsung 9 kg a ${w.sim} ${pq} y Licuadora Oster a ${w.sim} ${pl}.`,                       // N1
        `Tenemos Licuadora Oster a ${w.sim} 41,48.`, `Tenemos Licuadora Oster a ${w.sim} 414.8.`, `Tenemos Billetera de cuero a ${w.sim} 4,50.`,   // N2
        `Tenemos Billetera de cuero a ${w.sim} ${pb} y hay una en la tienda.`, `Tenemos Billetera de cuero a ${w.sim} ${pb}, hay uno.`, `Hay una Billetera de cuero en la tienda.`,   // N3
        `Tenemos Lavadora Samsung 9 kg a ${w.sim} ${pl} y Licuadora Oster a ${w.sim} ${pq}.`,                       // el texto "correcto" tampoco sale
      ];
      for (const f of fijas) expect(salida(w.cat, mon, w.from, cliente, f), f).toBe(base);
      const r = azarR1(SEMILLA_R1);
      const palabras = ['zorro', 'xilofon', 'cuatro', 'hay', 'quedan', 'unas', 'uno', 'oferta', 'garantia', 'envio', 'gratis', 'ultimas'];
      const precios = [...w.p, '4', '148', '7', '450', '41,48', '4,50', '99'];
      const piezas = ['Lavadora Samsung 9 kg', 'Licuadora Oster', 'Billetera de cuero', 'el licor de coca'];
      for (let i = 0; i < 80; i++) {
        const n = 2 + Math.floor(r() * 5);
        const partes: string[] = [];
        for (let k = 0; k < n; k++) partes.push(una(r, [una(r, palabras), una(r, piezas), `${w.sim} ${una(r, precios)}`, una(r, precios), `a ${w.sim} ${una(r, precios)}`]));
        const frase = una(r, ['Tenemos', 'Hay', 'Le muestro', '']) + ' ' + partes.join(' ') + una(r, ['.', '?', '!', '']);
        const t = salida(w.cat, mon, w.from, cliente, frase);
        expect(t, `caso ${i}, semilla ${SEMILLA_R1}: «${frase}»`).toBe(base);
        expect(t).not.toMatch(/zorro|xilofon|quedan|oferta|garantia|gratis|ultimas/);
      }
    });
  }
});

// R3 (Estándar 2.2, décima ronda): las coincidencias las arma el CÓDIGO y nunca omiten piezas en silencio: salen todas o el texto dice que hay más.
describe('R3: nunca una lista parcial sin decirlo', () => {
  const LISTA = [
    pieza('bufanda', 'Bufanda de vicuña', 7795, { area: 'Accesorios · Bufandas y chales' }), pieza('billetera-cuero', 'Billetera de cuero', 450, { area: 'Accesorios · Billeteras' }),
    pieza('llavero-llama', 'Llavero de llama', 36, { area: 'Hogar y oficina · Llaveros' }), pieza('tapiz', 'Tapiz mujer río', 900, { area: 'Hogar y oficina · Tapices' }), pieza('taza', 'Taza de barro', 50, { area: 'Hogar y oficina · Tazas' }),
    pieza('lampara', 'Lámpara de mesa', 300, { area: 'Hogar y oficina · Lámparas' }), pieza('florero', 'Florero de cerámica', 120, { area: 'Hogar y oficina · Floreros' }),
  ];
  const nombresEn = (t: string): string[] => LISTA.map((v) => v.nombre as string).filter((n) => t.includes(n));
  it('«¿qué accesorios y qué hogar y oficina tienen?» (guion exacto): no omite en silencio los productos de Accesorios', () => {
    const [, t] = charla(mundo({ catalogo: catalogoOk({}, LISTA as never) }), ['hola', '¿qué accesorios y qué hogar y oficina tienen?']);
    const accesorios = ['Bufanda de vicuña', 'Billetera de cuero'];
    expect(accesorios.every((n) => t!.txt.includes(n)) || /Hay más piezas relacionadas/.test(t!.txt)).toBe(true);
    expect(t!.avisos).toBe(0);
  });
  it('PROPIEDAD (semilla 1128): para cualquier consulta, las piezas mostradas son todas las que coinciden o el texto dice que hay más', () => {
    const r = azarR1b(1128);
    const palabras = ['accesorios', 'hogar', 'oficina', 'bufanda', 'billetera', 'llavero', 'tapiz', 'taza', 'lampara', 'florero', 'cuero', 'mesa', 'barro', 'vicuña', 'cerámica'];
    for (let i = 0; i < 60; i++) {
      const k = 1 + Math.floor(r() * 3);
      const q = '¿tienen ' + Array.from({ length: k }, () => palabras[Math.floor(r() * palabras.length)]).join(' y ') + '?';
      const [, t] = charla(mundo({ catalogo: catalogoOk({}, LISTA as never) }), ['hola', q]);
      if (!/Tenemos /.test(t!.txt)) continue;   // sin coincidencias salen la pregunta fija o las categorías
      const sinTilde = (x: string): string => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const coinciden = LISTA.filter((v) => sinTilde(q).split(/[^a-z]+/).some((w) => w.length >= 4 && w !== 'tienen' && sinTilde((v.nombre as string) + ' ' + (v.area as string)).includes(w))).map((v) => v.nombre as string);
      const mostradas = nombresEn(t!.txt);
      expect(mostradas.length === coinciden.length || /Hay más piezas relacionadas/.test(t!.txt), `«${q}»: coinciden ${coinciden.length}, mostradas ${mostradas.length}`).toBe(true);
    }
  });
});
function azarR1b(semilla: number): () => number { let a = semilla >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; }; }

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
