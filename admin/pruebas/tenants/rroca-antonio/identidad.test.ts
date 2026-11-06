/**
 * «EL PUENTE» DE ANTONIO — LA IDENTIDAD POR CÓDIGO (prohibición 4), 24/10/2026. De punta a punta y negando.
 *
 * «¿Eres un bot?», «¿quién eres?», «¿hablo con Antonio?» las contesta el CÓDIGO con una frase fija que reconoce ser un asistente virtual con IA: el modelo no interviene (antes caía al modelo y solo se filtraba su
 * salida: probando, «respondía cualquier cosa»). Vale en el primer mensaje, en la charla y con un QR abierto (sin abrir otro QR, sin derivar, sin aviso y sin botón de Antonio). Nunca niega ser una IA, nunca dice «soy Antonio»,
 * nunca lleva montos, no repite la presentación («¡Hola!»). +0 mensajes: es UN mensaje y, además, ya no hay llamada al modelo.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo, ResultadoTurno } from '../../lib/n8n-de-mentira';
import { ANA, ANGULOS, COTEJO_VALIDO, crear, hablar, mImagen, mTexto, panelConQr, panelOk } from './mundo';
import { cargarLibrerias } from './librerias';
import { vigilarUx } from './vigilante-ux';

const LIB = cargarLibrerias('raPreguntaPorIA, raPreguntaPorIAPlegada, raNorm, raTextoIdentidad') as J;
const pregunta = (t: string): boolean => (LIB['raPreguntaPorIA'] as (n: string) => boolean)((LIB['raNorm'] as (t: string) => string)(t)) || (LIB['raPreguntaPorIAPlegada'] as (t: string) => boolean)(t);
const NEGOCIO = { datosDelNegocio: { nombreNegocio: 'Método Puente' } };
const nuevo = (qr = false): Mundo => { const w = crear({ panel: qr ? panelConQr(49, NEGOCIO) : panelOk(NEGOCIO) }); vigilarUx(w); return w; };
const PREGUNTAS = [
  '¿Eres un bot?', 'eres un bot', 'ERES UN ROBOT?', '¿Eres una persona?', 'sos un humano?', '¿Eres humano?', '¿Eres una IA?', 'eres inteligencia artificial', '¿Eres chatgpt?', '¿Eres un chatbot?',
  '¿Quién eres?', 'quien eres', '¿Con quién hablo?', 'con quien estoy hablando', '¿Hablo con una persona?', '¿Hablo con Antonio?', '¿Eres Antonio?', 'eres antonio', '¿Eres tú Antonio?', 'bot?', '¿Me responde una persona?',
  '¿Eres una persona real?', 'esto es automático?', '¿Hay alguien ahí?', 'are you a bot?', 'você é um robô?', 'eres un rob0t?', 'eres un b0t', 'eres un bøt?', 'eres un r0b0t', 'rob0t', 'b0t?',
];
const NO_SON = ['yo uso IA en mi trabajo', 'estoy estudiando inteligencia artificial', 'el libro es sobre ia', 'quiero el libro', 'mi pareja es una persona muy callada', 'hola', 'cuánto cuesta el pack', 'usamos chatgpt para escribirnos'];
const unico = (t: ResultadoTurno): ResultadoTurno['mensajes'][number] => { expect(t.mensajes).toHaveLength(1); return t.mensajes[0]!; };

function verificar(t: ResultadoTurno, q: string): void {
  const m = unico(t);
  expect(t.ejecutados.has('Conversar con el modelo'), q).toBe(false);
  expect(t.ejecutados.has('Enviar aviso'), q).toBe(false);
  expect(m.tipo, q).toBe('text');                                   // sin botones (ni de producto ni el de Antonio) ni lista ni QR
  expect(m.cuerpo, q).toMatch(/^Soy el asistente virtual del Método Puente: una inteligencia artificial, no una persona \(Antonio es el autor del libro\)\./);
  expect(m.cuerpo, q).not.toMatch(/¡Hola|Qué gusto saludarte|Dauber|soy Antonio|no soy (?:una )?(?:ia|inteligencia)|\d\s*Bs|\bBs\b|\d/i);
  expect((m.cuerpo.match(/\?/g) ?? []).length, q).toBe(1);
  expect(t.llamadas.ingesta.filter((c) => c['evento'] === 'qr_enviado'), q).toHaveLength(0);
}

describe('la identidad por código: la pregunta y sus variantes', () => {
  it('reconoce cada variante (tildes, mayúsculas, sin signos, voseo, inglés, portugués)', () => {
    for (const q of PREGUNTAS) expect(pregunta(q), q).toBe(true);
  });
  it('NEGANDO: no se dispara con lo que no es la pregunta («yo uso IA», «estoy estudiando inteligencia artificial», «el libro es sobre ia»…)', () => {
    for (const q of NO_SON) expect(pregunta(q), q).toBe(false);
  });
});

describe('la identidad por código, de punta a punta', () => {
  it('como PRIMER mensaje: la respuesta fija, sin saludo repetido, sin modelo, sin aviso ni botón; la siguiente respuesta ya no se presenta de nuevo', () => {
    for (const q of PREGUNTAS) {
      const w = nuevo();
      verificar(hablar(w, ANA, mTexto(q)), q);
    }
    const w = nuevo();
    verificar(hablar(w, ANA, mTexto('¿eres un bot?')), 'primero');
    const sig = hablar(w, ANA, mTexto('estamos pasando un momento difícil'));
    expect(sig.mensajes.map((m) => m.cuerpo).join(' ')).not.toMatch(/¡Hola!|Qué gusto saludarte/);
  });
  it('en plena charla (ya saludado), cada variante recibe lo mismo, aun repitiéndola', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    hablar(w, ANA, mTexto('estamos pasando un momento difícil'));
    for (const q of ['¿Eres un bot?', '¿eres una persona?', '¿Quién eres?', '¿eres un bot?']) verificar(hablar(w, ANA, mTexto(q)), q);
  });
  it('con un QR ABIERTO: la misma respuesta, sin abrir otro QR, sin derivar y sin recordatorio de pago', () => {
    const w = nuevo(true);
    hablar(w, ANA, mTexto('hola'));
    for (const q of ['¿eres un bot?', '¿Hablo con Antonio?', '¿Eres una persona?']) {
      const t = hablar(w, ANA, mTexto(q));
      verificar(t, q);
      expect(t.mensajes.map((m) => m.cuerpo).join(' '), q).not.toMatch(/QR|pagar|comprobante/i);
    }
  });
  it('NEGANDO: un mensaje MEZCLADO sigue su camino y la intención reconocida gana (cancelar, comprar, pagar): el código no lo toma por la pregunta de identidad', () => {
    // Cancelar con un QR abierto: se cierra el pedido (pasa con Antonio), no se responde la identidad.
    const c = nuevo(true);
    hablar(c, ANA, mTexto('hola'));
    const cancela = hablar(c, ANA, mTexto('cancela mi pedido eres un robot'));
    expect(cancela.mensajes.map((m) => m.cuerpo).join(' ')).not.toMatch(/una inteligencia artificial, no una persona/);
    expect(['cancelar_cobro', 'cobro_cerrado', 'derivar', 'cancelacion']).toContain(String(cancela.porNodo['Armar mensajes']?.[0]?.['plan'] ?? ''));
    // Pedir un producto: abre su QR.
    const p = nuevo();
    hablar(p, ANA, mTexto('hola'));
    const compra = hablar(p, ANA, mTexto('quiero el pack, eres un bot?'));
    expect(compra.mensajes.map((m) => m.cuerpo).join(' ')).not.toMatch(/una inteligencia artificial, no una persona/);
    expect(compra.mensajes[0]!.tipo === 'image' || /pack|opciones|QR/i.test(compra.mensajes[0]!.cuerpo)).toBe(true);
    // Hablar del pago: sigue el camino del pago.
    const g = nuevo(true);
    hablar(g, ANA, mTexto('hola'));
    const pago = hablar(g, ANA, mTexto('ya pagué eres humano?'));
    expect(pago.mensajes.map((m) => m.cuerpo).join(' ')).not.toMatch(/una inteligencia artificial, no una persona/);
    // La pregunta sola, con o sin QR abierto, SÍ la contesta el código.
    for (const qr of [false, true]) { const w = nuevo(qr); hablar(w, ANA, mTexto('hola')); verificar(hablar(w, ANA, mTexto('eres un bot?')), 'sola'); }
  });
  it('NEGANDO: «rob0t», «b0t», «bøt», «r0b0t» (cifras y diacríticos por letras) se detectan; un número suelto no se pliega', () => {
    for (const q of ['rob0t', 'b0t', 'bøt', 'r0b0t', '¿Eres un rób0t?', 'eres un bøt']) expect(pregunta(q), q).toBe(true);
    for (const q of ['quiero 100 preguntas', 'son 30 días', 'el capítulo 4']) expect(pregunta(q), q).toBe(false);
  });
  it('NEGANDO: «yo uso IA» sigue su camino (el modelo conversa) y una imagen no es la pregunta', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mTexto('yo uso IA en mi trabajo y estamos cansados de discutir'));
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(true);
    const i = hablar(nuevo(), ANA, mImagen());
    expect(i.mensajes.map((m) => m.cuerpo).join(' ')).not.toMatch(/una inteligencia artificial, no una persona/);
  });
  it('el texto nunca niega ser una IA: la constante pasa los filtros comunes y no lleva montos ni el nombre de una persona como autor del asistente', () => {
    const texto = (LIB['raTextoIdentidad'] as (n: string) => string)('Método Puente');
    expect(texto).toMatch(/asistente virtual del Método Puente/);
    expect(texto).not.toMatch(/\d|Dauber|persona real|soy una persona|soy Antonio/i);
  });
});

// =============================================================================================================== PASO 7: LA IMAGEN DE UN ANUNCIO CON UN QR ABIERTO
describe('una captura de anuncio con un QR abierto se responde con su ángulo + la invitación a pagar (24/10/2026)', () => {
  const ARTES: Array<[string, string]> = [
    ['perder', ANGULOS['perder']!], ['mismo', ANGULOS['mismo']!], ['cuarto', ANGULOS['cuarto']!],
    ['plan30 con sello del libro', `${ANGULOS['plan30']!} LIBRO DIGITAL Bs 35 Precio de lanzamiento`],
    ['plan30 con sello del pack', `${ANGULOS['plan30']!} PACK COMPLETO Bs 49 (Antes Bs 106 - Ahorras Bs 57)`],
  ];
  const clasif = (texto: string): J => ({ categoria: 'publicidad', texto, titular_principal: '', descripcion: '' });
  const conImagen = (qr: boolean, medio: J): Mundo => { const w = crear({ panel: qr ? panelConQr(35, NEGOCIO) : panelOk(NEGOCIO), medio: { clasificacion: medio } }); vigilarUx(w); return w; };
  const plan = (t: ResultadoTurno): string => String(t.porNodo['Armar mensajes']?.[0]?.['plan'] ?? '');

  it('(a) con QR abierto: UN mensaje con la apertura del ángulo y la invitación a pagar con el monto del PEDIDO (no el del sello), sin otro QR, sin derivar, sin botón de Antonio ni de producto', () => {
    for (const [nombre, texto] of ARTES) {
      const w = conImagen(true, clasif(texto));
      hablar(w, ANA, mTexto('hola'));
      const t = hablar(w, ANA, mImagen());
      const m = unico(t);
      expect(m.tipo, nombre).toBe('text');
      expect(plan(t), nombre).toMatch(/^angulo/);
      expect(m.cuerpo, nombre).toMatch(/35 Bs/);                       // el monto del pedido abierto (35)
      expect(m.cuerpo, nombre).not.toMatch(/\b49\b|\b106\b|\b57\b|Dauber/);   // ni el del sello ni el ahorro de la imagen
      expect(m.cuerpo, nombre).not.toMatch(/¡Hola|Qué gusto saludarte/);
      expect(t.ejecutados.has('Enviar aviso'), nombre).toBe(false);
      expect(t.llamadas.ingesta.filter((c) => c['evento'] === 'qr_enviado'), nombre).toHaveLength(0);
      expect(JSON.stringify(m.payload), nombre).not.toMatch(/cta_url|b_pack|b_libro|b_comp/);
    }
  });
  it('(a) y si el modelo falla, el texto fijo del ángulo + la invitación', () => {
    const w = crear({ panel: panelConQr(35, NEGOCIO), medio: { clasificacion: clasif(ANGULOS['perder']!) }, modeloDice: 'cae' });
    vigilarUx(w);
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mImagen());
    expect(plan(t)).toBe('angulo_fijo');
    expect(unico(t).cuerpo).toMatch(/35 Bs/);
    expect(unico(t).tipo).toBe('text');
  });
  it('(b) con ficha limpia sigue el comportamiento de siempre: plan `angulo`, con sus botones de compra', () => {
    for (const [nombre, texto] of ARTES) {
      const w = conImagen(false, clasif(texto));
      const t = hablar(w, ANA, mImagen());
      expect(plan(t), nombre).toMatch(/^angulo/);
      expect(t.ejecutados.has('Enviar aviso'), nombre).toBe(false);
    }
  });
  it('(c) un comprobante real con QR abierto sigue a comprobante, y un pago con problema sigue derivando', () => {
    const c = crear({ panel: panelConQr(35, NEGOCIO), medio: { clasificacion: { categoria: 'comprobante', texto: 'Transferencia exitosa', titular_principal: '', descripcion: '' } }, cotejo: COTEJO_VALIDO });
    vigilarUx(c);
    hablar(c, ANA, mTexto('hola'));
    expect(plan(hablar(c, ANA, mImagen()))).toBe('comprobante');
    const p = crear({ panel: panelConQr(35, NEGOCIO), medio: { clasificacion: { categoria: 'pago_con_problema', texto: 'Pago rechazado', titular_principal: '', descripcion: '' } } });
    vigilarUx(p);
    hablar(p, ANA, mTexto('hola'));
    const t = hablar(p, ANA, mImagen());
    expect(plan(t)).toBe('derivar');
    expect(t.ejecutados.has('Enviar aviso')).toBe(true);
  });
  it('(d) una publicidad SIN ángulo conocido con QR abierto no cambia: no se inventa un ángulo', () => {
    const w = conImagen(true, clasif('Ofertas de verano en zapatos'));
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mImagen());
    expect(plan(t)).toBe('imagen_descrita');
    expect(unico(t).cuerpo).not.toMatch(/pareja|relación/i);
  });
});
