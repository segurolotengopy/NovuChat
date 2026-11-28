/**
 * QUINTA RONDA DEL #1142 (Casa Bermejo, 27/11/2026): dos REGLAS ESTRUCTURALES decididas por Andres (botón), sin listas de frases como barrera.
 *   I-4 «Solo escribe el código»: tras derivar (ventana de 2 h, sin cambio del pedido) el texto del modelo NO sale NUNCA; responde el código (lo que ya contesta) o el texto fijo en el trato del comercio. Nunca «Aún no tengo claro…».
 *   I-1 «Regla estricta»: con el pedido vacío y sin cambios, el texto del modelo sale SOLO si TODA la respuesta es una pregunta o informa coincidencias reales del catálogo; lo demás lo responde el código.
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

// Una conversación ya iniciada (el primer turno lo contesta el saludo del código): el SEGUNDO turno es el que se prueba, con el pedido vacío y la frase del modelo dada. El primer turno recibe una pregunta del modelo para no dejar un texto fijo repetido en el historial.
const conv = (frase: string, lineas: unknown[] = [], opc: Partial<Opciones> = {}): ReturnType<typeof crear> => {
  const m = crear({ catalogo: catalogoOk({}, REAL as never), modeloDice: (ll: LlamadaDoble) => (/saludo-inicial/.test(textoAlModelo(ll)) ? modelo('¿Qué pieza le interesa?') : modelo(frase, { lineas: lineas as never })), ...opc });
  hablar(m, ANA, mTexto('saludo-inicial hola'));
  return m;
};
const FIJO_USTED = 'Con gusto. Si necesita algo más, escríbame.';
const PROC_TU = 'Dime qué pieza te interesa y, cuando la elijas, la sumo a tu pedido. Luego me indicas si la retiras o la recibes por envío y tocas «Confirmar pedido»; el pago se hace con un QR que te envío en ese momento.';
const PROC_USTED = 'Dígame qué pieza le interesa y, cuando la elija, la sumo a su pedido. Luego me indica si la retira o la recibe por envío y toca «Confirmar pedido»; el pago se hace con un QR que le envío en ese momento.';
const SIN_PIEZA = /Aún no tengo claro/;

describe('I-4 «Solo escribe el código»: tras derivar el texto del modelo no sale nunca', () => {
  const tras = (frase: string, opc: Partial<Opciones> = {}, derivarAntes = true): string => {
    const m = crear({ catalogo: catalogoOk({}, REAL as never), ...opc, modeloDice: (ll: LlamadaDoble) => (/persona/.test(textoAlModelo(ll)) ? modelo('Lo verá una persona del equipo.', { quiereHablar: true }) : modelo(frase)) });
    if (derivarAntes) hablar(m, ANA, mTexto('quiero hablar con una persona'));
    return textos(hablar(m, ANA, mTexto('Bien, gracias'))).join(' ');
  };
  const FRASES = [
    // revisión 4
    '¿Quiere saber el precio de la segunda unidad?', '¿Me confirma su nombre para la cotización de la cocina?', '¿Me pasa su ciudad para cotizarle el envío de una cocina?', '¿Desea su número de cliente frecuente para acumular puntos?',
    // revisión 3
    '¿Le interesa ver más modelos?', '¿Quiere que le arme otro pedido?', '¿Busca algo para regalar?', 'Le recomiendo visitar nuestro catálogo.', 'Hay novedades en la tienda, ¿le cuento?', 'Mientras tanto, puede elegir otra pieza.',
    // revisión 2
    '¿Le paso las licuadoras disponibles?', 'Si quiere, puedo enseñarle nuestras billeteras.', 'Tenemos ofertas en licuadoras.',
    // revisión 1
    '¿Le interesaría llevar también una bufanda?', 'También tenemos billeteras, ¿te interesa?', '¿Te muestro otras piezas?', '¡De nada! ¿Le gustaría sumar una bufanda?',
    // lo que antes se permitía: tampoco sale (el texto del modelo no sale nunca)
    'Con mucho gusto, quedo atento.', '¿Desea que agregue su número de referencia?', 'El costo de envío lo confirma recepción.', 'Gracias. Que tengas un buen día.', '¿Me confirma su nombre completo?', 'Lo verá una persona del equipo.',
  ];
  for (const frase of FRASES) {
    it(`NEGADO: «${frase}» no sale tras derivar: sale el texto fijo`, () => {
      expect(tras(frase)).toBe(FIJO);
    });
  }
  it('PROPIEDAD: cualquier combinación de oraciones de cortesía, oferta, afirmación y pregunta del modelo, tras derivar, no sale: sale el texto fijo (tú y usted)', () => {
    const cortesia = ['Con gusto.', 'Gracias por escribir.', '¡Excelente día!'];
    const oferta = ['Tenemos ofertas en licuadoras.', 'Le muestro otras piezas.', 'Hay una promoción en electro.'];
    const afirma = ['Ya te lo guardé.', 'Quedó agregado el licor de coca.', 'El envío lo cotiza la tienda.'];
    const pregunta = ['¿Le interesa algo más?', '¿Me confirma su nombre?', '¿Quiere ver el catálogo?'];
    for (const a of cortesia) for (const b of oferta) for (const c of afirma) for (const d of pregunta) {
      const texto = [a, b, c, d].join(' ');
      expect(tras(texto)).toBe(FIJO);
    }
    for (const x of [...cortesia, ...oferta, ...afirma, ...pregunta]) expect(tras(x, { base: { tratamiento: 'usted' } })).toBe(FIJO_USTED);
  });
  it('NEGADO: tras derivar, cuando falla la redacción sale el texto fijo, NUNCA «Aún no tengo claro…» ni coincidencias que invitan a comprar', () => {
    for (const rotas of ['Tenemos descuento del 20 % en billeteras.', 'Te dejo el enlace al catálogo web.']) {
      const t = tras(rotas);
      expect(t).toBe(FIJO);
      expect(t).not.toMatch(SIN_PIEZA);
    }
    const m = crear({ catalogo: catalogoOk({}, REAL as never), modeloDice: (ll: LlamadaDoble) => (/persona/.test(textoAlModelo(ll)) ? modelo('Lo verá una persona del equipo.', { quiereHablar: true }) : modelo('Tenemos descuento del 20 % en billeteras.')) });
    hablar(m, ANA, mTexto('quiero hablar con una persona'));
    const t = textos(hablar(m, ANA, mTexto('¿tienen billeteras?'))).join(' ');
    expect(t).not.toMatch(SIN_PIEZA);
    expect(t).toBe(FIJO);
  });
  it('NEGADO: el texto fijo repetido dos veces NO deriva de nuevo (no es un bucle de «sin pieza»)', () => {
    const m = crear({ catalogo: catalogoOk({}, REAL as never), modeloDice: (ll: LlamadaDoble) => (/persona/.test(textoAlModelo(ll)) ? modelo('Lo verá una persona del equipo.', { quiereHablar: true }) : modelo('Tenemos descuento del 20 % en billeteras.')) });
    hablar(m, ANA, mTexto('quiero hablar con una persona'));
    for (const x of ['¿tienen billeteras?', '¿y licuadoras?', '¿cuánto cuesta una lavadora?']) expect(textos(hablar(m, ANA, mTexto(x))).join(' ')).toBe(FIJO);
  });
  it('control: sin haber derivado, el mismo texto del modelo SÍ sale (la regla solo rige en la ventana de 2 h)', () => {
    expect(tras('¿Le interesa ver más modelos?', {}, false)).toContain('ver más modelos');
  });
});

describe('I-1 «Regla estricta»: con el pedido vacío el texto del modelo sale solo si es una pregunta entera o informa coincidencias reales', () => {
  const FRASES = [
    // revisión 4
    'He agregado el licor de coca.', 'Añadido el licor de coca.', 'Incluido el licor de coca.', 'Sumado el licor de coca.', 'Ya es tuyo el licor de coca.', 'Quedó cargado.', 'Ya quedó apuntado.', 'Considéralo hecho.', 'Te he puesto el licor de coca.', 'Tomé nota del licor de coca para tu pedido.', 'Asunto resuelto: el licor de coca.',
    // revisión 3
    'Hecho, te lo dejé en la lista.', 'Ya te lo guardé.', 'Ok, va el licor de coca.', 'Te lo incorporé.', 'Cuenta con el licor de coca.', 'Listo, licor de coca x1 a tu orden.',
    // revisión 2
    'El licor de coca va en tu pedido.', 'Lo tienes listo, ya va con tu compra.',
    // revisión 1
    'Ya está en tu pedido, quedó listo.', 'La lavadora quedó en tu pedido.', 'Agregué la lavadora.', 'Te separé el licor de coca.', 'Ya lo tienes en tu carrito.', 'Quedó reservado el licor para ti.',
    // afirmación + pregunta: no es una pregunta entera
    'Agregado. ¿Algo más?', 'Listo, la billetera es tuya. ¿Quieres algo más?',
    // una forma de existencia con una afirmación que el catálogo no respalda
    'Tenemos la Billetera de cuero, ya es tuya.', 'Tenemos la Billetera de cuero y te la agregué.',
  ];
  const PROHIBIDO = /licor|agreg|a[nñ]adid|incluid|sumad|tuyo|tuya|cargado|apuntado|hecho|puesto|tom[eé] nota|resuelto|te lo dej|guard[eé]|incorpor|cuenta con|a tu orden|va en tu pedido|va con tu compra|listo|est[aá] en tu pedido|quedó en tu pedido|te separé|en tu carrito|reservado|algo más/i;
  for (const frase of FRASES) {
    it(`NEGADO: «${frase}» con el pedido vacío no sale (líneas vacías, con una línea que no entró y con id inventado)`, () => {
      for (const lineas of [[], [{ id: 'licor-de-coca', cantidad: 1 }], [{ id: 'lavadora-9kg-X', cantidad: 1 }]]) {
        const m = conv(frase, lineas);
        const t = hablar(m, ANA, mTexto('¿qué venden?'));
        expect(ficha(m).carrito).toEqual([]);
        expect(textos(t).join(' ')).toMatch(/Aún no tengo claro|No pude agregar esa pieza al pedido/);   // texto del código
        expect(textos(t).join(' ').replace('No pude agregar esa pieza al pedido.', '')).not.toMatch(PROHIBIDO);   // sin el texto del código que niega haber agregado
      }
    });
  }
  it('PROPIEDAD: cualquier afirmación del modelo (verbo × pieza × cierre) con el pedido vacío no sale', () => {
    const verbos = ['Agregué', 'Añadí', 'Incluí', 'Sumé', 'Puse', 'Dejé', 'Anoté', 'Cargué', 'Apunté', 'Reservé', 'Ya tienes', 'Va', 'Cuentas con', 'Quedó', 'Te regalo', 'Aseguré', 'Marqué'];
    const piezas = ['el licor de coca', 'la lavadora', 'la billetera'];
    const cierres = ['.', ', como pediste.', ' para ti.'];
    for (const v of verbos) for (const pz of piezas) for (const c of cierres) {
      const texto = `${v} ${pz}${c}`;
      const m = conv(texto);
      const t = textos(hablar(m, ANA, mTexto('¿qué venden?'))).join(' ');
      expect(t).not.toContain(texto);
      expect(ficha(m).carrito).toEqual([]);
    }
  });
  it('salen: una pregunta ENTERA, y la información de coincidencias reales («¿tienen billeteras?» muestra la pieza)', () => {
    expect(textos(hablar(conv('¿Qué otra pieza le interesa?'), ANA, mTexto('quiero ver algo'))).join(' ')).toContain('¿Qué otra pieza le interesa?');
    expect(textos(hablar(conv('Tenemos Billetera de cuero a Bs 450. ¿Le interesa?'), ANA, mTexto('¿tienen billeteras?'))).join(' ')).toContain('Tenemos Billetera de cuero a Bs 450');
    // el modelo informa una pieza que NO coincide con lo que pidió: sale el texto del código con la que sí coincide
    const t = textos(hablar(conv('Tenemos Licuadora Oster a Bs 4.148.'), ANA, mTexto('¿tienen billeteras?'))).join(' ');
    expect(t).not.toContain('Licuadora');
    expect(t).toContain('Billetera de cuero');
  });
  it('sin coincidencias ni pregunta: «Aún no tengo claro…» (código), sin afirmar nada', () => {
    const t = textos(hablar(conv('Perfecto, gracias por tu mensaje.'), ANA, mTexto('¿qué venden?'))).join(' ');
    expect(t).toMatch(SIN_PIEZA);
  });
  for (const [pregunta, proc, usted] of [['¿cómo hago un pedido?', PROC_TU, false], ['¿cómo compro?', PROC_TU, false], ['¿cómo pago?', PROC_TU, false], ['¿cómo pago?', PROC_USTED, true]] as [string, string, boolean][]) {
    it(`falso positivo: «${pregunta}» (${usted ? 'usted' : 'tú'}) tiene respuesta: el texto fijo del procedimiento, sin afirmar nada agregado ni pedir «pagar»`, () => {
      const t = textos(hablar(conv('Elija la pieza, la sumo a su pedido y al final toca «Confirmar pedido».', [], usted ? { base: { tratamiento: 'usted' } } : {}), ANA, mTexto(pregunta))).join(' ');
      expect(t).toBe(proc);
      expect(t).not.toMatch(/escrib\w+ «?pagar|pago acreditado|pago verificado|recibimos tu pago|agregu[eé]/i);
      expect(t).not.toMatch(SIN_PIEZA);
    });
  }
  it('NEGADO: una consulta de procedimiento NO deja pasar el pasado («Ya te lo guardé»)', () => {
    const t = hablar(conv('Ya te lo guardé.'), ANA, mTexto('¿cómo compro?'));
    expect(textos(t).join(' ')).not.toMatch(/guard/i);
  });
  it('NEGADO: el texto de procedimiento no se confunde con un bucle: pedirlo dos veces responde dos veces', () => {
    const m = conv('Ya te lo guardé.');
    expect(textos(hablar(m, ANA, mTexto('¿cómo compro?'))).join(' ')).toBe(PROC_TU);
    expect(textos(hablar(m, ANA, mTexto('¿cómo pago?'))).join(' ')).toBe(PROC_TU);
  });
  it('falso positivo (N-2): con un QR abierto, «La billetera que está en su pedido tiene garantía de un mes.» SALE (el pedido tiene piezas)', () => {
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
    it(`al cliente NO se le repite en ningún mensaje (confirmar y QR) y ve «queda anotada con ${usted ? 'su' : 'tu'} pedido»; a la tienda llega rotulada`, () => {
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
      for (const l of lineas) expect(l['detalle']).toMatch(/^Nota escrita por el cliente \(no es un estado de pago\): el anticipo ya está pagado/);
    });
  }
  it('NEGADO: la red de «pago acreditado» no se toca: una nota normal sale entera como hoy y viaja con el rótulo corto', () => {
    const m = flujo();
    const t0 = hablar(m, ANA, mTexto(pegado(STD, '19.458', '\nNota: pagaré en efectivo al recibir')));
    expect(textos(t0).join(' ')).toContain('Nota del cliente: pagaré en efectivo al recibir');
    const q = hablar(m, ANA, mToque(ids(t0).find((x) => x.startsWith('pedido:confirmar'))!, 'Confirmar pedido'));
    expect(textos(q).join(' ')).toContain('Nota del cliente: pagaré en efectivo al recibir');
    expect(((evento(q, 'qr_enviado')?.['lineas'] as Rep[])[0] ?? {})['detalle']).toBe('nota del cliente: pagaré en efectivo al recibir');
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
