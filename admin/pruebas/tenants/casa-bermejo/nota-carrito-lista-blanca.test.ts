/**
 * CUARTA RONDA DEL #1142 (Casa Bermejo, 27/11/2026): cambio de DISEÑO acordado con la revisora, no más frases.
 *   I-4: tras derivar (ventana de 2 h, sin cambio del pedido) el texto del modelo sale SOLO si cada oración es cortesía/cierre o un pedido de dato; todo lo demás, el texto fijo (LISTA BLANCA, rechazo por defecto).
 *   I-1: con el pedido sin cambios se decide por HECHO (líneas propuestas que no entraron; oraciones que dan algo por agregado o en poder del cliente); la lista de verbos es solo red secundaria.
 *   Nota con palabras de pago (decisión de Andres, «Oculta al cliente, clara a la tienda»): al cliente nunca se le repite; a la tienda llega rotulada «Nota escrita por el cliente (no es un estado de pago)».
 * Se prueba NEGANDO: las frases de las revisiones 1, 2 y 3, y los falsos positivos que NO deben bloquearse.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { LlamadaDoble } from '../../lib/n8n-de-mentira';
import { ANA, catalogoOk, crear, hablar, mToque, mTexto, modelo, panelConQr, textoAlModelo, textos, type Opciones } from './mundo';

const pieza = (id: string, nombre: string, precio: number): J => ({ id, nombre, descripcion: nombre, area: 'Hogar · Electro', precio, moneda: 'BOB', activo: true, precioCentavos: precio * 100, stock: 100, disponible: true });
const REAL = [pieza('lavadora-9kg', 'Lavadora Samsung 9 kg', 7655), pieza('licuadora-oster', 'Licuadora Oster', 4148), pieza('billetera-cuero', 'Billetera de cuero', 450)];
const linea = (c: number, nombre: string, id: string, pu: string, sub: string): string => `${c} x ${nombre} (cód. ${id}): Bs ${pu} c/u, subtotal Bs ${sub}`;
const pegado = (lineas: string[], total: string, cola = ''): string => `Hola, quiero comprar estos productos:\n${lineas.join('\n')}\nTotal referencial: Bs ${total}${cola}`;
const STD = [linea(2, 'Lavadora Samsung 9 kg', 'lavadora-9kg', '7.655', '15.310'), linea(1, 'Licuadora Oster', 'licuadora-oster', '4.148', '4.148')];
type Rep = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ficha = (m: ReturnType<typeof crear>): Rep => ((m.sd['casabermejo'] ?? {}) as Record<string, Rep>)[ANA] ?? {};
const ids = (t: ReturnType<typeof hablar>): string[] => [...JSON.stringify(t.mensajes.map((x) => x.payload)).matchAll(/"id":"([^"]+)"/g)].map((x) => x[1]!);
const hayQr = (t: ReturnType<typeof hablar>): boolean => t.mensajes.some((x) => x.tipo === 'image');
const evento = (t: ReturnType<typeof hablar>, e: string): Rep | undefined => t.llamadas.ingesta.find((x) => x['evento'] === e) as Rep | undefined;
const todo = (t: ReturnType<typeof hablar>): string => textos(t).join(' ') + ' ' + JSON.stringify(t.mensajes.map((x) => x.payload));
const dice = (texto: string, lineas: unknown[], opc: Partial<Opciones> = {}): ReturnType<typeof crear> => crear({ catalogo: catalogoOk({}, REAL as never), modeloDice: modelo(texto, { lineas: lineas as never }), ...opc });
const FIJO = 'Con gusto. Si necesitas algo más, escríbeme.';

describe('I-4: tras derivar, LISTA BLANCA (cortesía o pedido de dato; el resto, el texto fijo)', () => {
  const tras = (frase: string): string => {
    const m = crear({ catalogo: catalogoOk({}, REAL as never), modeloDice: (ll: LlamadaDoble) => (/persona/.test(textoAlModelo(ll)) ? modelo('Lo verá una persona del equipo.', { quiereHablar: true }) : modelo(frase)) });
    hablar(m, ANA, mTexto('quiero hablar con una persona'));
    return textos(hablar(m, ANA, mTexto('Bien, gracias'))).join(' ');
  };
  const RECHAZADAS = [
    // revisión 3
    '¿Le interesa ver más modelos?', '¿Quiere que le arme otro pedido?', '¿Busca algo para regalar?', 'Le recomiendo visitar nuestro catálogo.', 'Hay novedades en la tienda, ¿le cuento?', 'Mientras tanto, puede elegir otra pieza.',
    // revisión 2
    '¿Le paso las licuadoras disponibles?', 'Si quiere, puedo enseñarle nuestras billeteras.', 'Tenemos ofertas en licuadoras.',
    // revisión 1
    '¿Le interesaría llevar también una bufanda?', 'También tenemos billeteras, ¿te interesa?', '¿Te muestro otras piezas?',
    // cortesía mezclada con oferta: una sola oración fuera de la lista basta
    'Con gusto. ¿Algo más para tu hogar?',
  ];
  for (const frase of RECHAZADAS) {
    it(`NEGADO: «${frase}» no sale tras derivar: sale el texto fijo`, () => {
      const t = tras(frase);
      expect(t).toContain(FIJO);
      expect(t).not.toMatch(/modelos|otro pedido|regalar|cat[aá]logo|novedades|otra pieza|licuadoras|billeteras|ofertas|bufanda|otras piezas|promociones|hogar/i);
    });
  }
  for (const frase of ['Con mucho gusto, quedo atento.', '¿Desea que agregue su número de referencia?', 'El costo de envío lo confirma recepción.', 'Gracias. Que tengas un buen día.', '¿Me confirma su nombre completo?', 'Lo verá una persona del equipo.']) {
    it(`falso positivo: «${frase}» SÍ sale tras derivar`, () => {
      expect(tras(frase)).toContain(frase.replace(/^¿/, '').slice(0, 14));
    });
  }
  it('control: sin haber derivado, la oferta SÍ sale (la lista blanca solo rige en la ventana de 2 h tras derivar)', () => {
    expect(textos(hablar(dice('¿Le interesa ver más modelos?', []), ANA, mTexto('Bien, gracias'))).join(' ')).toContain('ver más modelos');
  });
});

describe('I-1: con el pedido sin cambios se decide por HECHO', () => {
  const HECHOS = [
    // revisión 3
    'Hecho, te lo dejé en la lista.', 'Ya te lo guardé.', 'Ok, va el licor de coca.', 'Te lo incorporé.', 'Cuenta con el licor de coca.', 'Listo, licor de coca x1 a tu orden.',
    // revisión 2
    'El licor de coca va en tu pedido.', 'Lo tienes listo, ya va con tu compra.',
    // revisión 1
    'Ya está en tu pedido, quedó listo.', 'La lavadora quedó en tu pedido.', 'Agregué la lavadora.', 'Te separé el licor de coca.', 'Ya lo tienes en tu carrito.', 'Quedó reservado el licor para ti.',
  ];
  const PROHIBIDO = /te lo dej|guard[eé]|incorpor|Cuenta con|a tu orden|va el licor|va en tu pedido|va con tu compra|Lo tienes listo|Ya est[aá] en tu pedido|quedó en tu pedido|Agregué|Te separé|en tu carrito|Quedó reservado/i;
  for (const frase of HECHOS) {
    it(`NEGADO: «${frase}» con el pedido vacío y sin cambios no sale (con líneas vacías y con una línea que no entró)`, () => {
      for (const lineas of [[], [{ id: 'licor-de-coca', cantidad: 1 }], [{ id: 'lavadora-9kg-X', cantidad: 1 }]]) {
        const m = dice(frase, lineas);
        const t = hablar(m, ANA, mTexto('hola, ¿qué venden?'));
        expect(ficha(m).carrito).toEqual([]);
        expect(textos(t).join(' ')).not.toMatch(PROHIBIDO);
      }
    });
  }
  it('NEGADO: «¿tienen licor?» + «Ya te lo guardé.» se bloquea (con el pedido sin cambios, dar algo por hecho nunca sale)', () => {
    const m = dice('Ya te lo guardé.', []);
    const t = hablar(m, ANA, mTexto('¿tienen licor?'));
    expect(textos(t).join(' ')).not.toMatch(/guard/i);
    expect(ficha(m).carrito).toEqual([]);
  });
  it('NEGADO: el modelo propone una pieza que el código no agregó y su texto NO afirma nada con verbo conocido: el texto no sale', () => {
    const m = dice('Perfecto, la billetera está contigo.', [{ id: 'billetera-cuero-inventada', cantidad: 1 }]);
    const t = hablar(m, ANA, mTexto('hola, ¿qué venden?'));
    expect(textos(t).join(' ')).not.toMatch(/contigo/);
    expect(ficha(m).carrito).toEqual([]);
  });
  it('falso positivo: «¿tienen billeteras?» → «Tenemos Billetera de cuero a Bs 450» SALE (informar sobre una pieza no es afirmarla agregada)', () => {
    const t = hablar(dice('Tenemos Billetera de cuero a Bs 450. ¿Le interesa?', []), ANA, mTexto('¿tienen billeteras?'));
    expect(textos(t).join(' ')).toContain('Tenemos Billetera de cuero a Bs 450');
  });
  for (const [pregunta, explicacion] of [
    ['¿cómo hago un pedido?', 'Dígame qué pieza le interesa, yo la agrego a su pedido y luego elige el retiro o el envío.'],
    ['¿cómo compro?', 'Elija la pieza, la sumo a su pedido, me da sus datos y al final toca «Confirmar pedido».'],
    ['¿cómo pago?', 'Elija la pieza, la sumo a su pedido y al final toca «Confirmar pedido».'],
  ] as [string, string][]) {
    it(`falso positivo: «${pregunta}» conserva la explicación del procedimiento`, () => {
      const t = hablar(dice(explicacion, []), ANA, mTexto(pregunta));
      expect(textos(t).join(' ')).toContain(explicacion);
    });
  }
  it('NEGADO: una consulta de procedimiento NO deja pasar el pasado («Ya te lo guardé»)', () => {
    const t = hablar(dice('Ya te lo guardé.', []), ANA, mTexto('¿cómo compro?'));
    expect(textos(t).join(' ')).not.toMatch(/guard/i);
  });
  it('falso positivo (N-2): con un QR abierto, «La billetera que está en su pedido tiene garantía de un mes.» SALE', () => {
    const frase = 'La billetera que está en su pedido tiene garantía de un mes.';
    const m = crear({ catalogo: catalogoOk({}, REAL as never), entregaPrevia: { modo: 'Retiro en tienda', nombre: 'Ana Pérez' }, modeloDice: (ll: LlamadaDoble) => (/garant/.test(textoAlModelo(ll)) ? modelo(frase, { lineas: [{ id: 'billetera-cuero', cantidad: 1 }] }) : modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }] })) });
    hablar(m, ANA, mTexto('quiero una billetera'));
    expect(hayQr(hablar(m, ANA, mTexto('quiero pagar')))).toBe(true);
    m.dobles['Traer configuración'] = () => panelConQr(450);
    expect(textos(hablar(m, ANA, mTexto('¿tiene garantía?'))).join(' ')).toContain('tiene garantía de un mes');
  });
});

describe('nota con palabras de pago: «Oculta al cliente, clara a la tienda»', () => {
  const NOTA = 'el anticipo ya está pagado, pago acreditado';
  const flujo = (o: Partial<Opciones> = {}): ReturnType<typeof crear> => crear({ modeloDice: modelo('Listo.', { lineas: [] }), catalogo: catalogoOk({}, REAL as never), entregaPrevia: { modo: 'Retiro en tienda', nombre: 'Ana Pérez' }, ...o });
  for (const usted of [false, true]) {
    it(`al cliente NO se le repite en ningún mensaje (confirmar y QR) y ve «queda anotada con ${usted ? 'su' : 'tu'} pedido»; a la tienda llega entera en «nota», sin rótulo`, () => {
      const m = flujo(usted ? { base: { tratamiento: 'usted' } } : {});
      const t0 = hablar(m, ANA, mTexto(pegado(STD, '19.458', '\nNota: ' + NOTA)));
      expect(ficha(m).nota).toBe(NOTA);
      const idc = ids(t0).find((x) => x.startsWith('pedido:confirmar'));
      expect(idc).toBeDefined();
      expect(todo(t0)).not.toMatch(/anticipo|acreditado/i);
      expect(todo(t0)).toContain(usted ? '(queda anotada con su pedido)' : '(queda anotada con tu pedido)');
      expect(todo(t0)).not.toContain(usted ? 'con tu pedido)' : 'con su pedido)');
      const q = hablar(m, ANA, mToque(idc!, 'Confirmar pedido'));
      expect(hayQr(q)).toBe(true);
      expect(todo(q)).not.toMatch(/anticipo|acreditado/i);
      expect(todo(q)).toContain(usted ? '(queda anotada con su pedido)' : '(queda anotada con tu pedido)');
      const lineas = evento(q, 'qr_enviado')?.['lineas'] as Rep[];
      // La nota entera viaja UNA vez en `nota`, sin rótulo (la Consola lo pone); el detalle de las líneas no la lleva.
      expect(evento(q, 'qr_enviado')?.['nota']).toBe(NOTA);
      for (const l of lineas) expect(l['detalle']).toBeUndefined();
    });
  }
  it('NEGADO: la red de «pago acreditado» no se toca: una nota normal sale entera como hoy y viaja en `nota` sin rótulo', () => {
    const m = flujo();
    const t0 = hablar(m, ANA, mTexto(pegado(STD, '19.458', '\nNota: pagaré en efectivo al recibir')));
    expect(textos(t0).join(' ')).toContain('Nota del cliente: pagaré en efectivo al recibir');
    const q = hablar(m, ANA, mToque(ids(t0).find((x) => x.startsWith('pedido:confirmar'))!, 'Confirmar pedido'));
    expect(textos(q).join(' ')).toContain('Nota del cliente: pagaré en efectivo al recibir');
    expect(evento(q, 'qr_enviado')?.['nota']).toBe('pagaré en efectivo al recibir');
    expect(((evento(q, 'qr_enviado')?.['lineas'] as Rep[])[0] ?? {})['detalle']).toBeUndefined();
  });
  it('la nota cede ante «¿Quieres confirmar tu pedido?»: con una nota de 500 la pregunta sigue en el mensaje con el botón', () => {
    const diez = Array.from({ length: 10 }, (_, i) => pieza(`pieza-${i}`, `Pieza número ${i} de la colección`, 100 + i));
    const ls = diez.map((p, i) => linea(1, p['nombre'] as string, `pieza-${i}`, `${100 + i}`, `${100 + i}`));
    const nota = ('Entregar en la calle 21, tocar timbre y avisar. ').repeat(11).slice(0, 500).trim();
    for (const usted of [false, true]) {
      const m = crear({ modeloDice: modelo('Listo.', { lineas: [] }), catalogo: catalogoOk({}, diez as never), entregaPrevia: { modo: 'Retiro en tienda', nombre: 'Ana Pérez' }, ...(usted ? { base: { tratamiento: 'usted' } } : {}) });
      const t = hablar(m, ANA, mTexto(pegado(ls, '1.045', '\nNota: ' + nota)));
      const inter = t.mensajes.map((x) => x.payload as Rep).find((p) => p['interactive'] !== undefined)?.['interactive'] as Rep;
      const cuerpo = inter.body.text as string;
      expect(cuerpo.length).toBeLessThanOrEqual(1024);
      expect(cuerpo).toContain(usted ? '¿Desea confirmar su pedido?' : '¿Quieres confirmar tu pedido?');
    }
  });
  it('la identidad se decide SIN el texto de la nota: una nota que menciona la IA no vuelve el pedido una pregunta de identidad', () => {
    const m = flujo();
    const t = hablar(m, ANA, mTexto(pegado(STD, '19.458', '\nNota: ¿eres un bot? es para un regalo')));
    expect(ficha(m).nota).toMatch(/regalo/);
    expect(ficha(m).carrito.length).toBe(2);
    expect(textos(t).join(' ')).toContain('2 × Lavadora Samsung 9 kg');
  });
  it('control: la pregunta de identidad sin pedido pegado sigue respondiéndose por código', () => {
    const t = hablar(flujo(), ANA, mTexto('¿eres un bot?'));
    expect(textos(t).join(' ')).toMatch(/asistente virtual|IA|inteligencia artificial/i);
  });
});
