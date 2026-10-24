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
import { ANA, crear, hablar, mImagen, mTexto, panelConQr, panelOk } from './mundo';
import { cargarLibrerias } from './librerias';
import { vigilarUx } from './vigilante-ux';

const LIB = cargarLibrerias('raPreguntaPorIA, raNorm, raTextoIdentidad') as J;
const pregunta = (t: string): boolean => (LIB['raPreguntaPorIA'] as (n: string) => boolean)((LIB['raNorm'] as (t: string) => string)(t));
const NEGOCIO = { datosDelNegocio: { nombreNegocio: 'Método Puente' } };
const nuevo = (qr = false): Mundo => { const w = crear({ panel: qr ? panelConQr(49, NEGOCIO) : panelOk(NEGOCIO) }); vigilarUx(w); return w; };
const PREGUNTAS = [
  '¿Eres un bot?', 'eres un bot', 'ERES UN ROBOT?', '¿Eres una persona?', 'sos un humano?', '¿Eres humano?', '¿Eres una IA?', 'eres inteligencia artificial', '¿Eres chatgpt?', '¿Eres un chatbot?',
  '¿Quién eres?', 'quien eres', '¿Con quién hablo?', 'con quien estoy hablando', '¿Hablo con una persona?', '¿Hablo con Antonio?', '¿Eres Antonio?', 'eres antonio', '¿Eres tú Antonio?', 'bot?', '¿Me responde una persona?',
  '¿Eres una persona real?', 'esto es automático?', '¿Hay alguien ahí?', 'are you a bot?', 'você é um robô?',
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
