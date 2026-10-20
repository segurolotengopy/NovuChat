/**
 * «EL PUENTE» DE ANTONIO (tenant rroca-antonio) — PR-B: LAS PRUEBAS NEGADAS (plan §5), con el caso límite de cada una y el vigilante de UX aplicado a toda la batería.
 *
 * Una BATERÍA corre todos los caminos del flujo (saludo, prellenados, ángulos, botones, lista, QR, comprobantes de todos los estados, avisos que salen y que no, derivaciones, riesgo, medios, no bolivianos)
 * y a TODO lo que sale al cliente (y a Antonio) le aplica las negaciones globales. Después, una prueba por línea del plan:
 *   1. no dice «acreditado», «verificado», «validado» ni «recibimos tu pago» (tampoco con homoglifos o letras separadas en la redacción del modelo);
 *   2. un comprobante con otro destinatario o monto no dispara el aviso de pago válido; 3. PDF = imagen; ilegible no avisa;   4. sin QR no se envía cobro;
 *   7. con violencia no se ofrece el libro;   8. no niega ser una IA, no dice psicólogo ni terapeuta, no narra banco/titular/cuenta, no envía enlaces;
 *   9. «le avisé» solo si el aviso salió;   10. sesión por `from`, acuses descartados;   11. un botón pulsado no reaparece (y el vigilante probado con casos negativos);
 *   12. audio y medios;   13. cero mensajes agregados;   texto en párrafos separados por línea en blanco;   no bolivianos sin QR (1 mensaje cada 24 h).
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo, ResultadoTurno } from '../../lib/n8n-de-mentira';
import { ANGULOS, PRELLENADOS, COMPROBANTE, ANA, BETO, REC, crear, entrega, hablar, mAudio, mBoton, mDocumento, mImagen, mLista, mTexto, panelConAgotados, panelConQr, panelOk, valorMeta, type Opciones } from './mundo';
import { LIB, UX_CONTADOR, vigilarUx, violacionesDeParrafos, violacionesDeUx, type UxMsg } from './vigilante-ux';

const nuevo = (o: Opciones = {}): Mundo => { const w = crear(o); vigilarUx(w); return w; };
const NEGADAS_PAGO = /acreditad|verificad|validad|recibimos tu pago|pago (?:recibido|confirmado|aprobado|exitoso)|ya (?:pag[oó]|llegó tu pago)/i;
const ENLACES = /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|bo|app|me)\b/i;
// «Banco de Preguntas» es el nombre de un bono; «tu banco» es el del cliente y «un banco boliviano» es la explicación del QR: ninguno narra el banco del comercio.
const BANCO = /\b((?<!\b(?:tu|un) )banco(?! de (?:100 )?preguntas)|titular|mercantil|cuenta bancaria|n[uú]mero de cuenta)\b/i;
const PROMESAS = /(?:^|\W)(?:te llamo|te llamar|te escribir|te avisar|lo consulto|te avisamos|te contactar)/i;

/** Todo lo que sale en una batería: los textos al cliente (y al respaldo) y los avisos a Antonio. */
function bateria(): Array<{ rotulo: string; t: ResultadoTurno }> {
  const salida: Array<{ rotulo: string; t: ResultadoTurno }> = [];
  const turno = (rotulo: string, w: Mundo, tel: string, msg: J, op: Parameters<typeof hablar>[3] = {}): void => { salida.push({ rotulo, t: hablar(w, tel, msg, op) }); };
  // 1. Conversación y menús.
  const a = nuevo();
  for (const [i, m] of [mTexto('hola'), mTexto('estamos distantes hace meses'), mTexto('no sabemos cómo hablar'), mTexto('¿cuánto cuesta?'), mBoton('b_bonos'), mLista('b_workbook'), mTexto('¿hay factura?'), mTexto('¿me garantiza recuperar mi relación?'), mTexto('quiero comprar')].entries()) turno('charla ' + i, a, ANA, m);
  // 2. Prellenados, ángulos y botones.
  for (const [k, texto] of Object.entries({ ...PRELLENADOS, ...ANGULOS })) turno('entrada ' + k, nuevo(), ANA, mTexto(texto));
  for (const id of ['b_pack', 'b_libro', 'b_bonos']) { const w = nuevo(); turno('saludo', w, ANA, mTexto('hola')); turno('botón ' + id, w, ANA, mBoton(id)); }
  // 3. Comprobantes en todos los estados (con aviso que sale y que no).
  const estados: Array<J | 'cae'> = [
    { statusCode: 200, body: { estado: 'valido', avisarComercio: true } }, { statusCode: 200, body: { estado: 'aproximado', motivo: 'monto_distinto', avisarComercio: true } },
    { statusCode: 200, body: { estado: 'reintentar', motivo: 'monto_menor', montoLeido: 5, importe: 49 } }, { statusCode: 200, body: { estado: 'reintentar', motivo: 'ilegible' } },
    { statusCode: 200, body: { estado: 'tardio', avisarComercio: true } }, { statusCode: 200, body: { estado: 'en_revision', avisarComercio: true } },
    { statusCode: 200, body: { estado: 'ya_resuelto' } }, 'cae',
  ];
  for (const aviso of ['acepta', 'error'] as const) for (const [i, cotejo] of estados.entries()) {
    const w = nuevo({ panel: panelConQr(49), medio: { clasificacion: COMPROBANTE }, cotejo: cotejo as never, aviso });
    turno(`comprobante ${i} aviso ${aviso}`, w, ANA, mImagen());
  }
  turno('comprobante sin QR', nuevo({ medio: { clasificacion: COMPROBANTE } }), ANA, mImagen());
  // 4. Derivaciones, riesgo, medios y no bolivianos.
  for (const texto of ['¿me hacen una factura?', 'quiero la devolución', '¿pago con tarjeta?', 'tengo un reclamo', 'quiero hablar con Antonio', '¿me hacen un descuento?']) turno('deriva ' + texto, nuevo(), ANA, mTexto(texto));
  for (const texto of ['mi pareja me golpea', 'le tengo miedo a mi esposo', 'me amenaza todos los días']) { const w = nuevo(); turno('riesgo', w, ANA, mTexto(texto)); turno('riesgo siguiente', w, ANA, mTexto('quiero el libro')); }
  turno('audio', nuevo({ medio: { transcripcion: 'quiero comprar el libro' } }), ANA, mAudio());
  turno('sticker', nuevo(), ANA, { type: 'sticker', sticker: { id: 's' } });
  turno('pdf', nuevo({ medio: { clasificacion: { categoria: 'otro', texto: '' }, mime: 'application/pdf' } }), ANA, mDocumento());
  turno('no boliviano', nuevo(), '54100000011', mTexto('hola'));
  turno('agotado', nuevo({ panel: panelConAgotados('pack-completo', 'guia-de-conversaciones') }), ANA, mTexto(PRELLENADOS.pack));
  return salida;
}

describe('la batería: las negaciones globales valen para TODO lo que sale', () => {
  const todo = bateria();
  const cliente = todo.flatMap((x) => [...x.t.mensajes.map((m) => ({ ...x, cuerpo: m.cuerpo, payload: m.payload })), ...x.t.mensajes.map((m) => ({ ...x, cuerpo: m.payload['image'] ? '' : '', payload: m.payload }))]);
  const textos = todo.flatMap((x) => [...x.t.mensajes, ...x.t.avisos].map((m) => ({ rotulo: x.rotulo, cuerpo: m.cuerpo, tipo: m.tipo, payload: m.payload })));

  it('se corrió una batería amplia (si quedara vacía, las negaciones no probarían nada)', () => {
    expect(todo.length).toBeGreaterThan(60);
    expect(textos.length).toBeGreaterThan(60);
    expect(cliente.length).toBeGreaterThan(0);
  });
  it('1. ninguna salida dice «acreditado», «verificado», «validado» ni «recibimos tu pago»', () => {
    for (const x of textos) expect(x.cuerpo, x.rotulo).not.toMatch(NEGADAS_PAGO);
  });
  it('8. ninguna salida niega ser una IA, dice psicólogo o terapeuta, narra banco, titular o cuenta, ni envía un enlace', () => {
    for (const x of textos) {
      const n = LIB.raNorm(x.cuerpo);
      expect(LIB.RA_NIEGA_IA.test(n), x.rotulo + ': ' + x.cuerpo).toBe(false);
      expect(x.cuerpo, x.rotulo).not.toMatch(/psic[oó]logo|terapeuta/i);
      expect(x.cuerpo, x.rotulo).not.toMatch(BANCO);
      expect(x.cuerpo, x.rotulo).not.toMatch(ENLACES);
      expect(x.cuerpo, x.rotulo).not.toMatch(/enlaces? de descarga|los enlaces/i);
    }
  });
  it('9. ninguna salida promete «te llamo», «te escribirán», «te aviso» ni «lo consulto» (solo se ofrece lo que se cumple)', () => {
    for (const x of textos) expect(x.cuerpo, x.rotulo).not.toMatch(PROMESAS);
  });
  it('texto en párrafos: cada texto va en párrafos de a lo más dos oraciones separados por una línea en blanco', () => {
    for (const x of textos) expect(violacionesDeParrafos(x.cuerpo), x.rotulo + ': ' + x.cuerpo).toEqual([]);
  });
  it('11 y 13. un mensaje por turno, jamás un botón de más de 20 caracteres ni una clave `link`', () => {
    for (const x of todo) {
      expect(x.t.mensajes.filter((m) => !m.respaldo).length, x.rotulo).toBeLessThanOrEqual(1);
      expect(JSON.stringify(x.t.mensajes.map((m) => m.payload)), x.rotulo).not.toMatch(/"link"\s*:/);
    }
  });
  it('el vigilante corrió en cada turno de la batería', () => {
    expect(UX_CONTADOR.turnos).toBeGreaterThanOrEqual(todo.length);
  });
});

describe('1. la redacción del modelo no puede afirmar un pago, ni con homoglifos ni con letras separadas', () => {
  it('«рagо recibido» (letras cirílicas), «p a g o   r e c i b i d o», «paaago acreditado» y «pag0 verificad0» caen al texto fijo', () => {
    for (const crudo of ['Tu рagо ya está recibido, gracias por confiar.', 'P a g o   r e c i b i d o, muchas gracias.', 'Tu paaago fue acreditado.', 'Tu pag0 está verificad0.', 'Recibimos tu pago, todo en orden.']) {
      const w = nuevo({ modeloDice: crudo });
      hablar(w, ANA, mTexto('hola'));
      const t = hablar(w, ANA, mTexto('estamos mal desde hace tiempo'));
      expect(t.mensajes[0]!.cuerpo, crudo).toMatch(/Gracias por escribir\. Cuéntame un poco más/);
    }
  });
  it('6. el modelo que escribe «49 Bs», «gratis», «cuarenta y nueve bolivianos» o un descuento cae al texto fijo', () => {
    for (const crudo of ['Cuesta 49 Bs.', 'Es gratis para ti.', 'Son cuarenta y nueve bolivianos.', 'Tienes un descuento especial.', 'Por solo Bs 35 lo tienes.']) {
      const w = nuevo({ modeloDice: crudo });
      hablar(w, ANA, mTexto('hola'));
      const t = hablar(w, ANA, mTexto('cuéntame del libro'));
      expect(t.mensajes[0]!.cuerpo, crudo).toMatch(/Gracias por escribir\. Cuéntame un poco más/);
    }
  });
  it('8. si preguntan «¿eres un bot?», la respuesta del modelo que lo niega cae; el flujo nunca niega ser una IA', () => {
    for (const crudo of ['No, soy una persona como tú.', 'Claro que no, soy Antonio.', 'Hablas con un humano.', 'No soy un robot, tranquila.']) {
      const w = nuevo({ modeloDice: crudo });
      hablar(w, ANA, mTexto('hola'));
      const t = hablar(w, ANA, mTexto('¿eres un bot?'));
      expect(LIB.RA_NIEGA_IA.test(LIB.raNorm(t.mensajes[0]!.cuerpo)), crudo).toBe(false);
      expect(t.mensajes[0]!.cuerpo, crudo).not.toContain(crudo);
    }
  });
});

describe('2 y 3. el comprobante: lo que el servidor rechaza no dispara el aviso de pago válido; PDF = imagen', () => {
  it('otro destinatario, otro monto, tardío o inválido: ningún aviso de «comprobante recibido» con estado de datos coincidentes', () => {
    for (const cotejo of [{ estado: 'reintentar', motivo: 'cuenta_distinta' }, { estado: 'reintentar', motivo: 'monto_mayor', montoLeido: 99, importe: 49 }, { estado: 'reintentar', motivo: 'nombre_distinto' }]) {
      const w = nuevo({ panel: panelConQr(49), medio: { clasificacion: COMPROBANTE }, cotejo: { statusCode: 200, body: cotejo } });
      const t = hablar(w, ANA, mImagen());
      expect(t.avisos, JSON.stringify(cotejo)).toHaveLength(0);
      expect(t.mensajes[0]!.cuerpo).not.toMatch(/los datos coinciden/);
    }
  });
  it('un PDF válido y un PDF ilegible reciben el mismo trato que la imagen', () => {
    const v = nuevo({ panel: panelConQr(49), medio: { clasificacion: COMPROBANTE, mime: 'application/pdf' } });
    const a = hablar(v, ANA, mDocumento());
    expect(a.mensajes[0]!.cuerpo).toMatch(/los datos coinciden/);
    const i = nuevo({ panel: panelConQr(49), medio: { clasificacion: COMPROBANTE, mime: 'application/pdf' }, cotejo: { statusCode: 200, body: { estado: 'reintentar', motivo: 'ilegible' } } });
    const b = hablar(i, ANA, mDocumento());
    expect(b.mensajes[0]!.cuerpo).toMatch(/no pude leer bien el comprobante/);
    expect(b.avisos).toHaveLength(0);
  });
  it('un comprobante cuya lectura falla (Gemini caído) no se da por bueno: «otro» sin cobro cotejado', () => {
    const w = nuevo({ panel: panelConQr(49), medio: { clasificacion: null } });
    const t = hablar(w, ANA, mImagen());
    expect(t.llamadas.cotejo).toHaveLength(0);
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/los datos coinciden/);
  });
});

describe('4 y 7. sin QR no se cobra; con violencia no se ofrece el libro', () => {
  it('sin `mediaIdQr` y sin cobro real: ningún mensaje de pago, y cada pedido de compra se deriva a Antonio', () => {
    for (const panel of [panelOk({ venta: {} }), panelOk({ cobroReal: undefined }), panelOk({ cobro: { activo: false } })]) {
      const w = nuevo({ panel });
      for (const msg of [mTexto(PRELLENADOS.pack), mTexto(PRELLENADOS.libro), mBoton('b_pack'), mLista('b_workbook')]) {
        const t = hablar(w, ANA, msg);
        expect(t.mensajes.some((m) => m.tipo === 'image')).toBe(false);
        expect(t.mensajes[0]!.cuerpo).not.toMatch(/escanea|ingresa exactamente/i);
      }
    }
  });
  it('con violencia (en cualquier turno de la charla) el libro no se ofrece: ni el menú, ni la lista, ni el precio', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    hablar(w, ANA, mTexto('mi pareja me pega'));
    for (const msg of [mTexto('quiero comprar'), mBoton('b_bonos'), mTexto('¿cuánto cuesta el libro?')]) {
      const t = hablar(w, ANA, msg);
      expect(t.mensajes[0]!.tipo).toBe('text');
      expect(t.mensajes[0]!.cuerpo).not.toMatch(/\d+\s*Bs|libro|Pack/);
    }
  });
});

describe('10. la sesión es el número de origen; los acuses se descartan; solo `messages[0]`', () => {
  it('dos teléfonos intercalados no comparten memoria, botones usados ni QR; un acuse de estado no produce nada', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    hablar(w, BETO, mTexto('hola'));
    hablar(w, ANA, mBoton('b_pack'));
    const f = (w.sd['antonio'] ?? {}) as J;
    expect(f[ANA]['usados']).toContain('b_pack');
    expect(f[BETO]['usados']).not.toContain('b_pack');
    const t = hablar(w, BETO, mBoton('b_pack'));
    expect(t.mensajes[0]!.tipo).toBe('image');
    const acuse = { messaging_product: 'whatsapp', metadata: { phone_number_id: '59100000042' }, statuses: [{ id: 'wamid.X', status: 'read', recipient_id: ANA }] };
    const u = w.turno(entrega(acuse));
    expect(u.mensajes).toHaveLength(0);
    expect(u.ejecutados.has('Decidir turno')).toBe(false);
  });
  it('de una carga con dos mensajes solo se atiende el primero (límite declarado)', () => {
    const w = nuevo();
    const v = valorMeta(mTexto('hola'), ANA);
    (v['messages'] as J[]).push({ from: BETO, id: 'wamid.SEGUNDO', timestamp: '1', type: 'text', text: { body: 'hola' } });
    expect(w.turno(entrega(v)).mensajes.map((m) => m.a)).toEqual([ANA]);
  });
});

describe('11. el vigilante de UX, probado con casos negativos (una regla que nunca falla no vigila nada)', () => {
  const msg = (cuerpo: string, extra: Partial<UxMsg> = {}): UxMsg => ({ tipo: 'text', cuerpo, payload: {}, ...extra });
  const boton = (id: string, title = 'Solo libro 35 Bs'): UxMsg => ({ tipo: 'interactive', cuerpo: 'Elige.', payload: { interactive: { type: 'button', action: { buttons: [{ type: 'reply', reply: { id, title } }] } } } });
  const toque = (id: string): J => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id } } });
  it('un botón pulsado que reaparece, un QR sin elegir producto, un texto de pago sin QR, dos presentaciones y opciones sin botones se detectan', () => {
    expect(violacionesDeUx(new Set(), toque('b_pack'), [boton('b_pack')]).join()).toMatch(/reapareció/);
    expect(violacionesDeUx(new Set(), mTexto('hola'), [{ tipo: 'image', cuerpo: 'qr', payload: {} }]).join()).toMatch(/sin que el cliente eligiera/);
    expect(violacionesDeUx(new Set(), mTexto('hola'), [msg('Escanea el QR y paga.')]).join()).toMatch(/texto de pago fuera del QR/);
    expect(violacionesDeUx(new Set(), mTexto('hola'), [msg('Soy el asistente virtual de Antonio. Soy el asistente virtual de Antonio.')]).join()).toMatch(/más de una vez/);
    const pres = { n: 1 };
    expect(violacionesDeUx(new Set(), mTexto('hola'), [msg('Soy el asistente virtual de Antonio.')], pres).join()).toMatch(/más de una vez en la conversación/);
    expect(violacionesDeUx(new Set(), mTexto('hola'), [msg('¿Cuál prefieres?')]).join()).toMatch(/opciones pero el mensaje no trae/);
  });
  it('un título de botón de más de 20, una fila de más de 24, más de 3 botones, una clave `link` y un párrafo corrido se detectan', () => {
    expect(violacionesDeUx(new Set(), mTexto('hola'), [boton('b_x', 'Un título de botón demasiado largo')]).join()).toMatch(/más de 20/);
    const lista: UxMsg = { tipo: 'interactive', cuerpo: 'Elige.', payload: { interactive: { type: 'list', action: { sections: [{ rows: [{ id: 'b_a', title: 'Una fila con un título demasiado largo' }] }] } } } };
    expect(violacionesDeUx(new Set(), mTexto('hola'), [lista]).join()).toMatch(/más de 24/);
    expect(violacionesDeUx(new Set(), mTexto('hola'), [{ tipo: 'interactive', cuerpo: 'x', payload: { interactive: { action: { buttons: [1, 2, 3, 4].map((i) => ({ reply: { id: 'b' + i, title: 't' } })) } } } }]).join()).toMatch(/más de 3 botones/);
    expect(violacionesDeUx(new Set(), mTexto('hola'), [{ tipo: 'image', cuerpo: 'x', payload: { image: { link: 'https://x' } } }]).join()).toMatch(/clave `link`/);
    expect(violacionesDeParrafos('Una frase. Otra frase. Una tercera frase sin línea en blanco.').join()).toMatch(/3 oraciones/);
    expect(violacionesDeParrafos('Una frase.\n\n\nOtra.').join()).toMatch(/triples/);
    expect(violacionesDeParrafos('Una frase.\n\nOtra frase.')).toEqual([]);
  });
  it('una fila de lista pulsada no reaparece en el menú siguiente', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    hablar(w, ANA, mBoton('b_bonos'));
    hablar(w, ANA, mLista('b_workbook'));
    const t = hablar(w, BETO, mTexto('hola'));
    expect(t.mensajes).toHaveLength(1);
    const otra = hablar(w, ANA, mTexto('quiero ver las opciones'));
    const idsOtra = JSON.stringify(otra.mensajes[0]!.payload);
    expect(idsOtra).not.toContain('b_bonos');
  });
});

describe('12. audio y medios', () => {
  it('«quiero comprar el libro» por nota de voz abre el QR del libro como si lo hubiera escrito; el texto transcrito pasa por los mismos detectores (prellenado, derivación)', () => {
    const w = nuevo({ medio: { transcripcion: 'quiero comprar el libro' } });
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mAudio());
    expect(t.mensajes[0]!.tipo).toBe('image');
    expect(t.llamadas.ingesta.find((c) => c['evento'] === 'qr_enviado')).toMatchObject({ monto: 35 });
    const v = nuevo({ medio: { transcripcion: 'necesito una factura por favor' } });
    const u = hablar(v, ANA, mAudio());
    expect(u.avisos).toHaveLength(1);
    const p = nuevo({ medio: { transcripcion: PRELLENADOS.pack } });
    expect(hablar(p, ANA, mAudio()).mensajes[0]!.tipo).toBe('image');
  });
  it('una transcripción larga (> 5 min), vacía o inaudible recibe un texto fijo y no llama al modelo; un sticker, una ubicación y un contacto, el texto cortés', () => {
    for (const [medio, re] of [[{ bytes: 721_000 }, /muy larga/], [{ transcripcion: '' }, /No pude entender tu nota de voz/], [{ transcripcion: null }, /No pude entender tu nota de voz/]] as const) {
      const w = nuevo({ medio });
      const t = hablar(w, ANA, mAudio());
      expect(t.mensajes[0]!.cuerpo).toMatch(re);
      expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
    }
    for (const msg of [{ type: 'sticker', sticker: { id: 's' } }, { type: 'location', location: { latitude: 1, longitude: 2 } }, { type: 'contacts', contacts: [{}] }]) {
      const t = hablar(nuevo(), ANA, msg);
      expect(t.mensajes[0]!.cuerpo).toMatch(/solo puedo leer texto, notas de voz, fotos y archivos PDF/);
      expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
    }
  });
  it('una captura de anuncio sin ángulo reconocido, ya saludado, sigue como charla; una foto cualquiera recibe el texto fijo', () => {
    const w = nuevo({ medio: { clasificacion: { categoria: 'publicidad', texto: 'Oferta de zapatos' } } });
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mImagen());
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes.some((m) => m.tipo === 'image')).toBe(false);
    const o = nuevo({ medio: { clasificacion: { categoria: 'otro', texto: '' } } });
    expect(hablar(o, ANA, mImagen()).mensajes[0]!.cuerpo).toMatch(/solo puedo leer texto y los comprobantes/);
  });
});

describe('los números no bolivianos: texto fijo + botón, sin QR, UN mensaje cada 24 horas (decisión de Andres)', () => {
  it('el texto explica que el pago es con QR boliviano, trae el botón de Antonio, no tiene QR ni monto, y el segundo mensaje de la ventana se descarta', () => {
    const w = nuevo();
    const EXT = '54100000099';
    const t = hablar(w, EXT, mTexto(PRELLENADOS.pack));
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]!.cuerpo).toMatch(/QR de un banco boliviano/);
    expect(t.mensajes[0]!.tipo).toBe('interactive');
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/\d+\s*Bs/);
    expect(t.mensajes.some((m) => m.tipo === 'image')).toBe(false);
    expect(t.avisos).toHaveLength(0);
    expect(hablar(w, EXT, mTexto(PRELLENADOS.pack)).mensajes).toHaveLength(0);
    expect(hablar(w, EXT, mBoton('b_pack')).mensajes).toHaveLength(0);
    w.avanzar(23 * 60);
    expect(hablar(w, EXT, mTexto('hola')).mensajes).toHaveLength(0);
    w.avanzar(120);
    expect(hablar(w, EXT, mTexto('hola')).mensajes).toHaveLength(1);
  });
});

describe('MEDIUM 1: el modelo no habla del estado de un pago ni de una entrega, ni de plazos', () => {
  const frases = [
    'Tu pago se está procesando y pronto tendrás el material en tu correo.',
    'Todo en orden con tu compra; el material ya salió.',
    'El material te llegará en unos minutos por este chat.',
    'Te lo envían en pocas horas.', 'Lo tendrás en un par de días.', 'Enseguida lo recibes.', 'Revisa tu correo, ahí llega el libro.',
  ];
  it('cada una de estas redacciones del modelo cae al texto fijo', () => {
    for (const crudo of frases) {
      const w = nuevo({ modeloDice: crudo });
      hablar(w, ANA, mTexto('hola'));
      const t = hablar(w, ANA, mTexto('estamos distanciados desde hace meses'));
      expect(t.mensajes[0]!.cuerpo, crudo).toMatch(/Gracias por escribir\. Cuéntame un poco más/);
    }
  });
  it('lo legítimo sigue pasando: hablar del método y de los capítulos sin pagos, entregas ni plazos', () => {
    const w = nuevo({ modeloDice: 'Entiendo lo que cuentas. Los capítulos 4 y 5 trabajan justo las pausas. ¿Qué suele pasar cuando discuten?' });
    hablar(w, ANA, mTexto('hola'));
    expect(hablar(w, ANA, mTexto('discutimos siempre por lo mismo y no sé qué hacer')).mensajes[0]!.cuerpo).toMatch(/capítulos 4 y 5/);
  });
  it('«ya pagué, ¿cuándo llega mi libro?» tras un comprobante NO llama al modelo: derivación de no entrega con el plazo del dato, aviso y botón', () => {
    const w = nuevo({ panel: panelConQr(49), medio: { clasificacion: COMPROBANTE }, modeloDice: 'Todo en orden, el material ya salió.' });
    hablar(w, ANA, mImagen());
    w.dobles['Traer configuración'] = () => panelOk();
    for (const texto of ['ya pagué, ¿cuándo llega mi libro?', '¿ya revisaron mi transferencia?', 'el material, ¿cuándo?']) {
      w.avanzar(31);
      const t = hablar(w, ANA, mTexto(texto));
      expect(t.ejecutados.has('Conversar con el modelo'), texto).toBe(false);
      expect(t.mensajes[0]!.cuerpo, texto).toMatch(/Antonio revisa el pago y envía el material por este chat hasta en 6 horas; desde aquí no puedo confirmarte si ya salió/);
      expect(t.mensajes[0]!.cuerpo).not.toMatch(NEGADAS_PAGO);
      expect(t.mensajes[0]!.tipo).toBe('interactive');
    }
  });
});

describe('MEDIUM 2: la protección corre también con la puerta cerrada y fuera del país', () => {
  const protegido = (t: ResultadoTurno): void => {
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]!.cuerpo).toMatch(/Lamento mucho lo que estás pasando/);
    expect(t.mensajes[0]!.tipo).toBe('text');
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/\d+\s*Bs|QR|banco boliviano|una persona del equipo|no podemos atenderte/);
    expect(t.llamadas.ingesta.some((c) => c['direccion'] === 'saliente' && c['evento'] === 'no_contactar')).toBe(true);
  };
  it('en estado «operador» (uso extendido): el texto de protección y `no_contactar`, no el aviso fijo', () => {
    const w = nuevo({ ingesta: { ok: true, atencion: { estado: 'operador', respuestasEnVentana: 55 } } });
    protegido(hablar(w, ANA, mTexto('mi pareja me golpea')));
  });
  it('con el comercio suspendido: el texto de protección y `no_contactar`, no el texto neutro', () => {
    const w = nuevo({ panel: { statusCode: 409, body: { estado: 'suspendido' } } });
    protegido(hablar(w, ANA, mTexto('mi esposo me amenaza')));
  });
  it('con un número no boliviano: el texto de protección y `no_contactar`, no el de «QR boliviano»', () => {
    protegido(hablar(nuevo(), '54100000077', mTexto('le tengo miedo a mi pareja')));
  });
  it('la pausa por persona («bloqueado») sigue en silencio: responde Antonio', () => {
    const w = nuevo({ ingesta: { ok: true, atencion: { estado: 'bloqueado', respuestasEnVentana: 30 } } });
    expect(hablar(w, ANA, mTexto('mi pareja me golpea')).mensajes).toHaveLength(0);
  });
});

describe('LOW 1 y 2: el aviso del pago con riesgo, y `no_contactar` aunque el envío falle', () => {
  it('un comprobante que cuadra Y que casi cuadra junto a un riesgo: el aviso a Antonio lleva la línea fija (sin copiar lo que escribió), y la ficha registra el comprobante y libera el QR', () => {
    for (const estado of ['valido', 'aproximado']) {
      const w = nuevo({ panel: panelConQr(49), medio: { clasificacion: COMPROBANTE }, cotejo: { statusCode: 200, body: { estado, motivo: 'monto_distinto', avisarComercio: true } } });
      hablar(w, REC, mTexto('hola'));
      const t = hablar(w, ANA, mImagen({ caption: 'mi pareja me amenaza con matarme' }));
      expect(t.avisos, estado).toHaveLength(1);
      expect(t.avisos[0]!.cuerpo).toMatch(/La persona mencionó miedo o violencia; contactarla solo para entregar el material/);
      expect(t.avisos[0]!.cuerpo).not.toMatch(/amenaza|matarme/);
      expect(t.mensajes[0]!.cuerpo).toMatch(/Lamento mucho/);
      const f = (w.sd['antonio'] as J)[ANA];
      expect(f['comprobanteMs'], estado).toBeGreaterThan(0);
      expect(f['qrHastaMs'], estado).toBe(0);
    }
  });
  it('si ni el envío ni el respaldo salen, `no_contactar` se reporta igual (la persona no recibe un rescate)', () => {
    const w = nuevo({ envio: { 'Enviar a WhatsApp': 'error', 'Enviar respaldo': 'error' } });
    const t = hablar(w, ANA, mTexto('mi pareja me golpea'), { toleraFallo: true });
    expect(t.llamadas.ingesta.filter((c) => c['evento'] === 'no_contactar')).toHaveLength(1);
    expect(t.ejecutados.has('Reportar protección')).toBe(true);
    // Si el mensaje salió, no se duplica el reporte.
    const v = nuevo();
    const u = hablar(v, ANA, mTexto('mi pareja me golpea'));
    expect(u.llamadas.ingesta.filter((c) => c['evento'] === 'no_contactar')).toHaveLength(1);
    expect(u.ejecutados.has('Reportar protección')).toBe(false);
  });
});
