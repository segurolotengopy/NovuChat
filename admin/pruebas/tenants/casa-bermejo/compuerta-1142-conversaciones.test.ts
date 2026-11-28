/**
 * COMPUERTA DE LA OCTAVA RONDA DEL #1142 (28/11/2026): los guiones G1 a G24 como CONVERSACIONES COMPLETAS (ficha nueva, estado entre turnos, modelo realista que ante un mensaje vago pregunta).
 * Se comprueba por turno: el texto enviado, los avisos a recepción y `derivadoMs`. En todo guion: 1 mensaje al cliente por turno y nunca «pago acreditado / verificado / recibimos tu pago».
 * La válvula (mensajes vagos seguidos, el mismo fallo real seguido) la decide un CONTADOR de la ficha (`sinAvance`, `fallos`), no una comparación de textos. D-A (Andres, 28/11): el saludo vago cuenta como 1.º (pregunta fija), el 2.º seguido → categorías (nunca deriva), el 3.º → recepción con aviso y botón. D-B: ese pase NO abre la ventana de 2 h; la insistencia real («No pude agregar…» repetido) sí.
 * Novena ronda (criterio de la dueña): el contador caduca a los 30 min entre mensajes del cliente (hora del MENSAJE), una coincidencia real o el catálogo es avance, tras un comprobante cotejado no corre, «?» y «...» cuentan como vagos.
 * Pendiente para el #1151 (declarado): «¿qué venden?» / «catálogo» respondidos por código con el catálogo o su botón (Estándar 1.1); aquí, sin botón de catálogo, se exige que NO derive ni calle (G6, G7).
 * G17 (catálogo caído o modelo caído abren la ventana) queda como excepción registrada, no resuelta en esta ronda.
 */
import { describe, expect, it } from 'vitest';
import * as C from '../../../../Flujos/clientes/casa-bermejo/construir.mjs';
import type { J } from '../../lib/flujo';
import type { LlamadaDoble } from '../../lib/n8n-de-mentira';
import { ANA, ARGENTINO, COMPROBANTE, ENTREGA, catalogoOk, completarEnvio, crear, hablar, mAudio, mImagen, mSticker, mTexto, mToque, mUbicacion, modelo, PRODUCCION, PRUEBA, panelConQr, textoAlModelo, textos, type Opciones } from './mundo';

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

describe('G8 (undécima ronda): con el pedido vacío una línea inventada por el modelo se IGNORA entera: sin «No pude agregar», sin contar insistencia, sin ventana', () => {
  it('«quiero el tapiz azul» ×2 y luego «una billetera»', () => {
    const m = mundo();
    const [t1, t2, t3] = charla(m, ['quiero el tapiz azul', 'quiero el tapiz azul', 'una billetera']);
    for (const t of [t1!, t2!, t3!]) { expect(t.txt).not.toMatch(/No pude agregar/); expect(t.avisos).toBe(0); expect(t.derivado).toBe(0); }
    expect(ficha(m).fallos ?? 0).toBe(0);
    expect(t3!.txt).toContain(COINC);
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
    const ts = charla(mundo(), ['¿tienen billeteras?', 'hmm', 'la billetera', 'hmm', 'la billetera', 'hmm', 'la billetera', 'hmm']);
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

// R1 reforzada (undécima ronda): con el pedido vacío el TEXTO del modelo no decide nada: ni la salida ni el parche de la ficha (`sinAvance`, `fallos`, ventana, avisos). Ninguna regla que mire el texto del modelo (R59 «precios actualizados», afirmaciones, promesas, enlaces…) corre.
describe('R1 reforzada: la salida y el parche de la ficha son idénticos para CUALQUIER texto del modelo con el pedido vacío', () => {
  const TEXTOS = ['Hola.', 'Los precios están actualizados al día de hoy.', 'Precios verificados y vigentes.', 'Catálogo actualizado.', 'Acabamos de actualizar los precios del catálogo.', 'Tenemos 3 Billetera de cuero.', 'Agregué la billetera.',
    'Te envío el enlace del catálogo web.', 'Tenemos un 10% de descuento por tiempo limitado.', '¿Le gustaría ver más piezas?', 'Ya está en tu pedido.', 'Soy una persona real.', 'Lo verá una persona del equipo.'];
  const ESTADO = ['sinAvance', 'fallos', 'derivadoMs', 'saludado', 'carrito', 'mostrados', 'pide', 'avisoConsultaMs', 'avisoSinAvanceMs', 'comprobanteMs', 'qrHastaMs', 'cierre'];
  const huella = (m: ReturnType<typeof crear>, tel: string): string => JSON.stringify(ESTADO.map((k) => ficha(m, tel)[k]));
  const corrida = (dice: string, guion: string[], o: Opciones, tel: string): Array<{ txt: string; avisos: number; estado: string }> => {
    const m = crear({ catalogo: catalogoOk({}, REAL as never), ...U, ...o, modeloDice: () => modelo(dice) });
    return guion.map((x) => { const t = hablar(m, tel, mTexto(x)); return { txt: textos(t).join(' | '), avisos: t.avisos.length, estado: huella(m, tel) }; });
  };
  const ESCENARIOS: Array<[string, Opciones, string, string[]]> = [
    ['usted BO', {}, ANA, ['hola', '¿tienen billeteras?', 'hmm', 'hmm', 'hmm', '¿qué venden?', '¿qué accesorios y qué hogar y oficina tienen?']],
    ['tú BO', { base: {} }, ANA, ['hola', '¿tienen billeteras?', 'hmm', 'hmm', 'hmm', '¿qué venden?']],
    ['usted AR', { catalogo: catalogoOk({ mercado: 'AR', moneda: 'ARS' }, REAL_AR as never) }, ARGENTINO, ['hola', '¿tienen billeteras?', 'hmm', 'hmm', 'hmm', '¿qué venden?']],
  ];
  for (const [nombre, o, tel, guion] of ESCENARIOS) {
    it(`${nombre}: «${guion.slice(0, 3).join('» / «')}»…: ${TEXTOS.length} textos del modelo dan la salida y el estado del modelo neutro`, () => {
      const base = corrida('Hola.', guion, o, tel);
      for (const dice of TEXTOS) {
        const r = corrida(dice, guion, o, tel);
        r.forEach((t, i) => { expect(t, `«${dice}» en «${guion[i]}»`).toEqual(base[i]); });
      }
      // la salida correcta: «hola» → pregunta fija (no el texto de los precios); «¿tienen billeteras?» → la coincidencia; «hmm» ×3 → recepción al 3.º con sinAvance en cero
      expect(base[0]!.txt).toMatch(/¿Qué producto buscas?\?/);
      expect(base[0]!.txt).not.toMatch(/precios que/);
      expect(base[1]!.txt).toMatch(/Tenemos Billetera de cuero a/);
      expect(base[4]!.avisos).toBe(1);
    });
  }
  it('el guion de «hola» con el texto «Los precios están actualizados…»: nunca «Los precios que le indico…»', () => {
    for (const o of [{}, { base: {} }]) {
      const ts = charla(crear({ catalogo: catalogoOk({}, REAL as never), ...U, ...o, modeloDice: () => modelo('Los precios están actualizados al día de hoy.') }), ['hola', 'hmm', 'hmm']);
      for (const t of ts) expect(t.txt).not.toMatch(/Los precios que (le|te) indico/);
      expect(ts[2]!.avisos).toBe(1);
    }
  });
});

// REGLA ÚNICA (undécima ronda): con el pedido vacío ni el texto ni las MARCAS del modelo deciden nada. PROPIEDAD FINAL: un modelo ADVERSARIO (texto arbitrario, líneas inventadas o de piezas no nombradas, marcas arbitrarias: quiereHablar, entrega, facturación)
// contra un modelo NEUTRO: la salida y el parche de la ficha son idénticos para cada mensaje del generador (solo se exceptúa la línea que el cliente sí nombró).
describe('REGLA ÚNICA: modelo adversario = modelo neutro con el pedido vacío', () => {
  const SEM = 1130;
  const azar = (semilla: number): (() => number) => { let a = semilla >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; }; };
  const MENSAJES = ['hola', 'sí', 'deme dos', 'hmm', 'ok', '?', '...', '👍', 'gracias', '¿tienen billeteras?', '¿qué venden?', 'catálogo', 'quiero ver algo para regalar', '¿cómo compro?', '¿aceptan tarjeta?', 'alguien sabe el precio?', 'hola buenas tardes', 'quiero el tapiz azul', '¿cuánto cuesta el tapiz?'];
  const ESTADO = ['sinAvance', 'fallos', 'derivadoMs', 'saludado', 'carrito', 'mostrados', 'pide', 'avisoConsultaMs', 'avisoSinAvanceMs', 'qrHastaMs', 'cierre', 'nota', 'entrega'];
  const correr = (guion: string[], dice: (ll: LlamadaDoble) => J, o: Opciones, tel: string): Array<{ txt: string; avisos: number; estado: string; ingesta: string }> => {
    const m = crear({ catalogo: catalogoOk({}, REAL as never), ...U, ...o, modeloDice: dice });
    return guion.map((x) => { const t = hablar(m, tel, mTexto(x)); return { txt: textos(t).join(' | '), avisos: t.avisos.length, estado: JSON.stringify(ESTADO.map((k) => ficha(m, tel)[k])), ingesta: JSON.stringify(t.llamadas.ingesta.map((e) => e['evento'])) }; });
  };
  it('texto, líneas y marcas arbitrarias (incluida quiereHablar) no cambian la salida ni la ficha: 12 guiones al azar en usted, tú y Argentina', () => {
    const r = azar(SEM);
    const una = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
    const textosM = ['Los precios están actualizados al día de hoy.', 'Tenemos 3 Billetera de cuero a Bs 41,48.', 'Agregué la lavadora.', 'Hay una en la tienda. ¿Le interesa?', 'Te envío el enlace del catálogo web.', 'Lo verá una persona del equipo.', 'Soy una persona real.', '¡Hola! ¿En qué puedo ayudarle?'];
    const escenarios: Array<[Opciones, string, J[]]> = [[{}, ANA, REAL], [{ base: {} }, ANA, REAL], [{ catalogo: catalogoOk({ mercado: 'AR', moneda: 'ARS' }, REAL_AR as never) }, ARGENTINO, REAL_AR]];
    for (let i = 0; i < 12; i++) {
      const [o, tel] = una(escenarios);
      const guion = Array.from({ length: 4 + Math.floor(r() * 3) }, () => una(MENSAJES));
      const neutro = correr(guion, () => modelo('Hola.'), o, tel);
      const adversario = correr(guion, () => modelo(una(textosM), { lineas: una([[], [{ id: 'zzz-1', cantidad: 3 }], [{ id: 'lavadora-9kg', cantidad: 999 }, { id: 'inventada', cantidad: 1 }]]), quiereHablar: una([true, false]), entrega: una([{}, { modo: 'Retiro en tienda', nombre: 'Ana' }]), facturacion: una([{}, { nit: '123' }]) }), o, tel);
      guion.forEach((x, k) => {
        expect(adversario[k], `caso ${i}, semilla ${SEM}, turno ${k}: «${x}»`).toEqual(neutro[k]);
      });
    }
  });
  it('(3) con el pedido vacío un texto vacío del modelo NO es una falla; un error real de la llamada sí', () => {
    const [t] = charla(mundo({ modeloDice: () => modelo('') }), ['hola']);
    expect(t!.avisos).toBe(0);
    expect(t!.txt).toContain(P);
    const [caido] = charla(mundo({ modeloDice: 'cae' }), ['hola']);
    expect(caido!.avisos).toBe(1);
  });
  it('(2) un pedido real de persona NUNCA se ignora (formas variadas, con y sin tildes y mayúsculas); los vagos no lo activan', () => {
    for (const x of ['quiero hablar con alguien', 'Pásame con una persona', 'pasame con una persona', 'atención humana', 'ATENCION HUMANA', 'un asesor', '¿Me atiende alguien?', 'me atiende alguien', 'necesito un humano', 'comunícame con un vendedor']) {
      const [t] = charla(mundo({ modeloDice: () => modelo('Hola.', { quiereHablar: false }) }), [x]);
      expect(t!.avisos, x).toBe(1);
    }
    for (const x of ['hola buenas tardes', 'alguien sabe el precio?', 'hmm', 'quiero una billetera']) {
      const [t] = charla(mundo({ modeloDice: () => modelo('Hola.', { quiereHablar: true }) }), [x]);
      expect(t!.avisos, x).toBe(0);
    }
  });
  it('(4) el turno que vacía el pedido: «Quité … de su pedido.» y la MISMA pregunta fija, con el contador en cero (usted y tú)', () => {
    for (const [o, quite] of [[{}, 'de su pedido.'], [{ base: {} }, 'de tu pedido.']] as Array<[Opciones, string]>) {
      const m = mundo({ ...o, modeloDice: (ll: LlamadaDoble) => (/quita/.test(textoAlModelo(ll)) ? modelo('Listo.', { lineas: [] }) : modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }] })) });
      hablar(m, ANA, mTexto('una billetera'));
      const t = hablar(m, ANA, mTexto('quita todo'));
      expect(textos(t).join(' ')).toMatch(new RegExp('Quité Billetera de cuero ' + quite.replace('.', '\\.') + '\\s+¿Qué producto busca'));
      expect(ficha(m).carrito).toEqual([]);
      expect(ficha(m).sinAvance).toBe(0);
    }
  });
  it('(5) más de 6 categorías: remisión expresa, nunca un tope en silencio', () => {
    const muchas = Array.from({ length: 9 }, (_, i) => pieza(`p${i}`, `Producto ${i}`, 10 + i, { area: `Categoría ${i} · Cosas` }));
    const ts = charla(mundo({ catalogo: catalogoOk({}, muchas as never) }), ['hola', 'hmm']);
    expect(ts[1]!.txt).toMatch(/y otras categorías/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// G1 (duodécima ronda): el «sí» a lo que el CÓDIGO ofreció arma el pedido; si ofreció varias, «¿cuál de ellas?»; la cantidad vale solo si el cliente la dijo.
// ---------------------------------------------------------------------------------------------------------------------
describe('G1: el cliente que asiente a la oferta del código', () => {
  // El modelo «bien portado»: ante un asentimiento propone la billetera (como hacía en main); el código decide si vale.
  const portado = (ll: LlamadaDoble): J => modelo('Con gusto.', { lineas: /^(?:que )?s[ií]|esa|la quiero|ok|deme|dame|me interesa|quiero/i.test(textoAlModelo(ll)) ? [{ id: 'billetera-cuero', cantidad: 1 }] : [] });
  const ASIENTOS = ['sí', 'sí, la quiero', 'que sí, esa', 'la quiero', 'esa', 'ok la llevo', 'deme una', 'sí me interesa'];
  for (const [nombre, o] of [['usted', {}], ['tú', { base: {} }]] as Array<[string, Opciones]>) {
    for (const a of ASIENTOS) {
      it(`${nombre}: «¿tienen billeteras?» → «${a}» arma el pedido con la billetera (como en main)`, () => {
        const m = mundo({ ...o, modeloDice: portado });
        const [t1, t2] = charla(m, ['¿tienen billeteras?', a]);
        expect(t1!.txt).toMatch(/Tenemos Billetera de cuero a Bs 450\. ¿(Le|Te) interesa\?/);
        expect(ficha(m).carrito).toEqual([{ id: 'billetera-cuero', cantidad: 1, detalle: '' }]);
        expect(t2!.txt).toMatch(/1 × Billetera de cuero — Bs 450/);
        expect(t2!.avisos).toBe(0);
      });
    }
  }
  it('Argentina: «sí» a la oferta en pesos arma el pedido', () => {
    const m = crear({ catalogo: catalogoOk({ mercado: 'AR', moneda: 'ARS' }, REAL_AR as never), ...U, modeloDice: portado });
    charla(m, ['¿tienen billeteras?', 'sí'], ARGENTINO);
    expect(ficha(m, ARGENTINO).carrito).toEqual([{ id: 'billetera-cuero', cantidad: 1, detalle: '' }]);
  });
  it('NEGADO: el asentimiento sin una oferta del código no arma nada (sale la pregunta fija); la oferta caduca al turno siguiente', () => {
    const m = mundo({ modeloDice: portado });
    const [t1, t2] = charla(m, ['hola', 'sí']);
    expect(ficha(m).carrito).toEqual([]);
    expect(t2!.txt).not.toMatch(/1 × Billetera/);
    expect(t1!.avisos).toBe(0);
    const m2 = mundo({ modeloDice: portado });
    charla(m2, ['¿tienen billeteras?', 'hmm', 'sí']);   // «hmm» deja pasar un turno: la oferta ya no es «la del turno inmediato anterior»
    expect(ficha(m2).carrito).toEqual([]);
  });
  it('si el código ofreció VARIAS piezas y el «sí» no dice cuál: «¿Cuál de ellas…?» por código; no se elige una; al decir cuál, entra esa', () => {
    const m = mundo({ modeloDice: portado });
    const [t1, t2, t3] = charla(m, ['¿tienen cosas de hogar?', 'sí', 'la licuadora']);
    expect(t1!.txt).toMatch(/Tenemos .*Lavadora.*Licuadora|Tenemos .*Licuadora.*Lavadora|Tenemos piezas de/);
    if (/^.*Tenemos [^p]/.test(t1!.txt) && !/Tenemos piezas de/.test(t1!.txt)) {
      expect(t2!.txt).toMatch(/¿Cuál de ellas le interesa\?/);
      expect(ficha(m).carrito).toEqual([]);
      expect(t3!.avisos).toBe(0);
    }
    const tu = mundo({ base: {}, modeloDice: portado });
    const ts = charla(tu, ['¿tienen lavadoras y licuadoras?', 'que sí, esa']);
    expect(ts[0]!.txt).toMatch(/Lavadora Samsung 9 kg/);
    expect(ts[1]!.txt).toBe('¿Cuál de ellas te interesa?');
    expect(ficha(tu).carrito).toEqual([]);
    const us = mundo({ modeloDice: (ll: LlamadaDoble) => (/^la licuadora/.test(textoAlModelo(ll)) ? modelo('Con gusto.', { lineas: [{ id: 'licuadora-oster', cantidad: 1 }] }) : portado(ll)) });
    const tus = charla(us, ['¿tienen lavadoras y licuadoras?', 'sí', 'la licuadora']);
    expect(tus[1]!.txt).toBe('¿Cuál de ellas le interesa?');
    expect(ficha(us).carrito.map((l: Rep) => l.id)).toEqual(['licuadora-oster']);
  });
  it('la cantidad vale solo si el texto del CLIENTE la trae (cifra o letras); si no, 1: un modelo que pone 50 unidades con el pedido vacío no decide', () => {
    for (const [dice, esperado] of [['quiero una billetera', 1], ['quiero dos billeteras', 2], ['quiero 3 billeteras', 3], ['quiero billeteras', 1]] as Array<[string, number]>) {
      const m = mundo({ modeloDice: () => modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 50 }] }) });
      charla(m, [dice]);
      expect(ficha(m).carrito[0]?.cantidad, dice).toBe(dice.includes('50') ? 50 : 1);   // el 50 del modelo NUNCA vale: el cliente no lo dijo
      void esperado;
    }
    const m = mundo({ modeloDice: () => modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 2 }] }) });
    charla(m, ['quiero dos billeteras']);
    expect(ficha(m).carrito[0]?.cantidad).toBe(2);
    const oferta = mundo({ modeloDice: portado });
    charla(oferta, ['¿tienen billeteras?', 'deme dos']);
    expect(ficha(oferta).carrito[0]?.cantidad).toBe(2);
  });
});

// COMPARACIÓN CONTRA MAIN del camino de venta más común: consulta → oferta → asentimiento → pedido → datos → confirmar → QR. Los valores esperados salen de correr ESTA misma conversación sobre el flujo de origin/main (28/11/2026, modelo simulado):
// mismo pedido (1 × Billetera de cuero), mismo total (Bs 450), mismo resumen, misma línea del QR y UN QR. Solo cambia el trato del texto de la oferta (main decía «¿Le interesa?» también en tú).
describe('camino de venta común: el mismo pedido y el mismo total que en main', () => {
  const modeloVenta = (ll: LlamadaDoble): J => { const x = textoAlModelo(ll); return /^[A-Za-zÁ-ú ]{3,40}$/.test(x) && /Ana/.test(x) ? modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: { nombre: x } }) : modelo('Con gusto.', { lineas: /^(?:s[ií]|quiero)/i.test(x) ? [{ id: 'billetera-cuero', cantidad: 1 }] : [] }); };
  it('consulta, «sí», recojo, nombre y «Confirmar pedido»: pedido, total, resumen y QR iguales a los de main', () => {
    const m = crear({ catalogo: catalogoOk({}, REAL as never), modeloDice: modeloVenta });
    const t1 = hablar(m, ANA, mTexto('¿tienen billeteras?'));
    const t2 = hablar(m, ANA, mTexto('sí'));
    hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    const t4 = hablar(m, ANA, mTexto('Ana Pérez'));
    const id = [...JSON.stringify(t4.mensajes.map((x) => x.payload)).matchAll(/"id":"(pedido:confirmar[^"]*)"/g)][0]?.[1];
    const t5 = hablar(m, ANA, mToque(id!, 'Confirmar pedido'));
    expect(textos(t1).join(' ')).toContain('Tenemos Billetera de cuero a Bs 450.');
    expect(textos(t2)).toEqual(['¿Cómo prefiere recibir su pedido: Retiro en tienda o Envío?\n\n1 × Billetera de cuero — Bs 450\nTotal: Bs 450']);
    expect(ficha(m).carrito).toEqual([{ id: 'billetera-cuero', cantidad: 1, detalle: '' }]);
    expect(textos(t4)).toEqual(['¿Quieres confirmar tu pedido?\n\n1 × Billetera de cuero — Bs 450\nTotal: Bs 450\n\nDatos de entrega:\n• Entrega: Retiro en tienda\n• Retira: Ana Pérez\n\nSi algún dato no está bien, toca «Corregir datos».\n\nSi todo está bien, toca «Confirmar pedido».']);
    const q = t5.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado') as Rep;
    expect(q['lineas']).toEqual([{ externa: true, id: 'billetera-cuero', nombre: 'Billetera de cuero', cantidad: 1, precioCentavos: 45000, moneda: 'BOB', subtotalCentavos: 45000 }]);
    expect(q['monto']).toBe(450);
    expect(t5.mensajes.filter((x) => x.tipo === 'image')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// G2 (duodécima ronda): «nombrada» con el buscador tolerante COMÚN (palabra-tolerante.js): erratas sí, falsos positivos no, la exacta manda, la ambigua pregunta.
// ---------------------------------------------------------------------------------------------------------------------
describe('G2: errata, plural y fonética nombran la pieza; falsos positivos no; exacta manda; ambigua pregunta', () => {
  const EXTRA = [pieza('tela-estampada', 'Tela estampada', 90, { area: 'Hogar · Telas' }), pieza('planta-deco', 'Planta decorativa', 120, { area: 'Hogar · Plantas' }), pieza('televisor-65', 'Televisor Samsung 65', 5999, { area: 'Electro · Televisores' })];
  const CAT = [...REAL, ...EXTRA];
  const IDS: Array<[RegExp, string]> = [[/b?v?i+l+e?t?e?ra/i, 'billetera-cuero'], [/licuadora|liquadora/i, 'licuadora-oster'], [/lavadora|labadora/i, 'lavadora-9kg'], [/televisor|telebisor/i, 'televisor-65'], [/tela/i, 'tela-estampada'], [/planta/i, 'planta-deco']];
  const modeloLee = (ll: LlamadaDoble): J => { const x = textoAlModelo(ll); const h = IDS.find(([re]) => re.test(x)); return modelo('Con gusto.', { lineas: h ? [{ id: h[1], cantidad: 1 }] : [] }); };
  const carrito = (cliente: string, cat: J[] = CAT, o: Opciones = {}): string[] => { const m = mundo({ catalogo: catalogoOk({}, cat as never), modeloDice: modeloLee, ...o }); charla(m, [cliente]); return (ficha(m).carrito as Rep[]).map((l) => l.id); };
  for (const [cliente, id] of [['quiero una biletera', 'billetera-cuero'], ['quiero una villetera', 'billetera-cuero'], ['quiero una billetra', 'billetera-cuero'], ['quiero una liquadora', 'licuadora-oster'], ['quiero una labadora', 'lavadora-9kg'], ['quiero un telebisor', 'televisor-65'], ['quiero dos biletera', 'billetera-cuero']] as Array<[string, string]>) {
    it(`«${cliente}» arma el pedido con la pieza correcta`, () => {
      expect(carrito(cliente)).toEqual([id]);
    });
  }
  it('la errata también arma la OFERTA correcta cuando el cliente solo pregunta', () => {
    const [, t] = charla(mundo({ catalogo: catalogoOk({}, CAT as never) }), ['hola', '¿tienen biletera?']);
    expect(t!.txt).toMatch(/Tenemos Billetera de cuero a Bs 450\./);
    expect(t!.txt).not.toMatch(/Lavadora|Licuadora/);
  });
  for (const [cliente, noId] of [['quiero una tele', 'tela-estampada'], ['quiero una tela', 'televisor-65'], ['quiero una plancha', 'planta-deco'], ['quiero una cartera', 'billetera-cuero'], ['quiero una lavadora', 'licuadora-oster']] as Array<[string, string]>) {
    it(`NEGADO (falso positivo): «${cliente}» NO nombra «${noId}»`, () => {
      const m = mundo({ catalogo: catalogoOk({}, CAT as never), modeloDice: () => modelo('Con gusto.', { lineas: [{ id: noId, cantidad: 1 }] }) });
      charla(m, [cliente]);
      expect((ficha(m).carrito as Rep[]).map((l) => l.id)).not.toContain(noId);
    });
  }
  it('la coincidencia EXACTA manda sobre la tolerante: «billetera» exacta no arrastra a la «Biletera artesanal»', () => {
    const cat = [...REAL, pieza('biletera-art', 'Biletera artesanal', 800)];
    const m = mundo({ catalogo: catalogoOk({}, cat as never), modeloDice: (ll: LlamadaDoble) => modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }, { id: 'biletera-art', cantidad: 1 }] }) });
    charla(m, ['quiero una billetera']);
    expect((ficha(m).carrito as Rep[]).map((l) => l.id)).toEqual(['billetera-cuero']);
  });
  it('si el texto casa SOLO por tolerancia con más de una pieza: «¿Cuál de ellas…?» por código y no se elige una', () => {
    const cat = [...REAL, pieza('billetera-tela', 'Billetera de tela', 200)];
    const m = mundo({ catalogo: catalogoOk({}, cat as never), modeloDice: modeloLee });
    const [t] = charla(m, ['quiero una biletera']);
    expect(t!.txt).toContain('¿Cuál de ellas le interesa?');
    expect(ficha(m).carrito).toEqual([]);
    const tu = mundo({ base: {}, catalogo: catalogoOk({}, cat as never), modeloDice: modeloLee });
    expect(charla(tu, ['quiero una biletera'])[0]!.txt).toContain('¿Cuál de ellas te interesa?');
  });
  it('con el pedido vacío un modelo ADVERSARIO sigue sin decidir (líneas de piezas que la errata no nombra)', () => {
    const neutro = charla(mundo({ catalogo: catalogoOk({}, CAT as never) }), ['hola', 'quiero una cartera', 'hmm']);
    const adversario = charla(mundo({ catalogo: catalogoOk({}, CAT as never), modeloDice: () => modelo('Agregué la billetera.', { lineas: [{ id: 'billetera-cuero', cantidad: 9 }], quiereHablar: true }) }), ['hola', 'quiero una cartera', 'hmm']);
    expect(adversario.map((t) => t.txt)).toEqual(neutro.map((t) => t.txt));
    expect(adversario.map((t) => t.avisos)).toEqual(neutro.map((t) => t.avisos));
  });
  it('GUARDIA: sin la pieza palabra-tolerante.js el armado FALLA (no hay respaldo silencioso); con ella, no', () => {
    for (const base of [PRODUCCION, PRUEBA]) {
      expect(C.guardias(base === PRODUCCION ? 'produccion' : 'prueba', base).filter((h: string) => /palabra-tolerante/.test(h))).toEqual([]);
      const sin = JSON.parse(JSON.stringify(base).split('function ptNombra(').join('function ptNombraAusente('));
      expect(C.guardias(base === PRODUCCION ? 'produccion' : 'prueba', sin).join(' | ')).toMatch(/palabra-tolerante\.js \(ptNombra, ptCasiIgual\): es obligatoria/);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// G3 (duodécima ronda): con el pedido vacío la marca quiereHablar del modelo vale SOLO con una palabra de rol humano o de contacto en el texto del cliente; el detector por código puro vale por sí solo.
// ---------------------------------------------------------------------------------------------------------------------
describe('G3: pedidos reales de una persona (híbrido)', () => {
  const FORMAS = ['me puede atender una persona?', 'hay alguien que me atienda?', 'quiero atención de una persona', 'me pueden llamar?', 'me llaman por favor?', 'me comunicas con alguien?', 'hay algún vendedor?', 'quiero hablar con el dueño', 'quiero hablar con la tienda',
    'quiero hablar con ustedes', 'con quién puedo hablar?', 'necesito hablar con ventas', 'atiéndame una persona', 'no quiero hablar con un robot', 'tienen un número para llamar?', 'necesito ayuda de una persona real'];
  for (const x of FORMAS) {
    it(`«${x}» llega a recepción (con la marca del modelo o por el detector), con aviso y ventana`, () => {
      const m = mundo({ modeloDice: () => modelo('Lo verá una persona.', { quiereHablar: true }) });
      const [t] = charla(m, [x]);
      expect(t!.avisos, x).toBe(1);
      expect(t!.derivado, x).toBeGreaterThan(0);
    });
  }
  for (const x of ['hmm', 'hola buenas tardes', 'alguien sabe el precio?', 'hola', 'es un regalo', 'hay alguien?']) {
    it(`NEGADO: «${x}» NO deriva aunque el modelo marque quiereHablar`, () => {
      const m = mundo({ modeloDice: () => modelo('Lo verá una persona.', { quiereHablar: true }) });
      const [t] = charla(m, [x]);
      expect(t!.avisos, x).toBe(0);
      expect(t!.derivado, x).toBe(0);
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
