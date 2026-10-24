/**
 * LOS 4 HUECOS DEL FILTRO DE REDACCIÓN SEGURA (`Flujos/experimental/comun-sin-agente/src/filtro-redaccion.js`):
 * tope de oraciones configurable, datos de pago, afirmar compra/entrega y promesas de aviso. Todas son opciones OPT-IN:
 * apagadas, el filtro se comporta como antes. Banco: `fixtures/redaccion-segura-huecos.json`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar } from './lib/flujo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FUENTE = readFileSync(join(AQUI, '../../Flujos/experimental/comun-sin-agente/src/filtro-redaccion.js'), 'utf8');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
const F = ejecutar(`${FUENTE}\nreturn [{ json: { cmMotivoDeRechazo, cmPulirRedaccion } }];`, [{}])[0] as Record<'cmMotivoDeRechazo' | 'cmPulirRedaccion', Fn>;
const motivo = (t: string, o?: object): string => F.cmMotivoDeRechazo(t, o);

interface Grupo { falsosPositivosConocidos?: string[]; opcion: string; motivo: string; rechazos: string[]; pasan: string[]; conAvisoRespaldado?: { pasan: string[]; rechazos: string[] } }
const BANCO = JSON.parse(readFileSync(join(AQUI, 'fixtures/redaccion-segura-huecos.json'), 'utf8')) as { grupos: Grupo[] };
// Los montos los dice el código; el banco prueba la opción, así que se permiten para que el motivo sea el de la opción.
const base = { permitirMontos: true };

for (const g of BANCO.grupos) {
  describe(`opción ${g.opcion}`, () => {
    // Lo que una regla de NovuChat que no se apaga ya rechazaba (`promesa`, `afirma_un_hecho`) sigue con ese motivo; lo NUEVO, con el de la opción.
    for (const t of g.rechazos) it(`rechaza «${t}»`, () => expect(motivo(t, { ...base, [g.opcion]: true }), t).toBe(motivo(t, base) || g.motivo));
    for (const t of g.pasan) it(`deja pasar «${t}»`, () => expect(motivo(t, { ...base, [g.opcion]: true }), t).toBe(''));
    // Falsos positivos conocidos: caen al texto fijo del código (barato). Si dejan de rechazarse, se quitan del banco.
    for (const t of g.falsosPositivosConocidos || []) it(`falso positivo conocido (documentado): «${t}»`, () => expect(motivo(t, { ...base, [g.opcion]: true }), t).toBe(g.motivo));
    it('apagada (por defecto) no cambia nada: ningún rechazo es de esta opción', () => {
      for (const t of g.rechazos) expect(motivo(t, base), t).not.toBe(g.motivo);
    });
    it('encendida con el texto invisible (etiquetas U+E00xx) o separadores no se evade', () => {
      const tag = (x: string): string => [...x].map((c, i) => (i % 2 ? String.fromCodePoint(0xe0061) : '') + c).join('');
      for (const t of g.rechazos.slice(0, 4)) expect(motivo(tag(t), { ...base, [g.opcion]: true }), t).not.toBe('');
    });
  });
}

describe('avisoRespaldado: el aviso al equipo se puede decir, el aviso al cliente no', () => {
  const g = BANCO.grupos.find((x) => x.opcion === 'sinPromesasDeAviso')!;
  const o = { ...base, sinPromesasDeAviso: true, avisoRespaldado: true };
  for (const t of g.conAvisoRespaldado!.pasan) it(`pasa «${t}»`, () => expect(motivo(t, o), t).toBe(''));
  for (const t of g.conAvisoRespaldado!.rechazos) it(`rechaza «${t}»`, () => expect(motivo(t, o), t).not.toBe(''));
  it('avisoRespaldado solo actúa con sinPromesasDeAviso: solo, no debilita la regla base', () => {
    expect(motivo('Le avisamos al equipo', { ...base, avisoRespaldado: true })).toBe('promesa');
    expect(motivo('Le avisamos al asesor que te llame', { ...base, avisoRespaldado: true })).toBe('promesa');
  });
  it('sin avisoRespaldado, «le avisamos al equipo» se rechaza', () => {
    expect(motivo('Le avisamos al equipo', { ...base, sinPromesasDeAviso: true })).not.toBe('');
    expect(motivo('Le avisamos al equipo', base)).not.toBe('');
  });
});

describe('las reglas de NovuChat siguen mandando con las opciones encendidas', () => {
  const todas = { ...base, sinDatosDePago: true, sinAfirmarCompra: true, sinPromesasDeAviso: true, avisoRespaldado: true };
  it('pago acreditado, negar ser IA y enlaces ajenos', () => {
    expect(motivo('Tu pago fue acreditado', todas)).toBe('afirma_un_hecho');
    expect(motivo('Recibimos tu pago', todas)).toBe('afirma_un_hecho');
    expect(motivo('No soy un bot', todas)).toBe('afirma_un_hecho');
    expect(motivo('Mira https://ejemplo.mx/x', todas)).toBe('enlace_ajeno');
  });
  it('un texto honesto con todo encendido sale', () => {
    expect(motivo('El libro cuesta 49 Bs e incluye 4 bonos. ¿Quieres que te cuente más?', todas)).toBe('');
  });
});

describe('opción maxOraciones', () => {
  const t4 = 'Uno dos. Tres cuatro. Cinco seis. Siete ocho. ¿Te sirve?';
  it('apagada no limita (como antes)', () => {
    expect(motivo(t4)).toBe('');
    expect(F.cmPulirRedaccion(t4)).toBe(t4);
  });
  it('encendida rechaza lo que pasa del tope y acepta lo que no', () => {
    expect(motivo(t4, { maxOraciones: 3 })).toBe('largo_en_oraciones');
    expect(motivo('Uno dos. Tres cuatro. ¿Te sirve?', { maxOraciones: 3 })).toBe('');
    expect(motivo(t4, { maxOraciones: 5 })).toBe('');
  });
  it('«Dr.» y los decimales no cuentan como oración', () => {
    expect(motivo('El Dr. Pérez atiende. Cuesta 49.50 Bs. ¿Te sirve?', { maxOraciones: 3, permitirMontos: true })).toBe('');
  });
  it('pulir recorta al tope y conserva la pregunta final', () => {
    expect(F.cmPulirRedaccion(t4, { maxOraciones: 3 })).toBe('Uno dos. Tres cuatro. ¿Te sirve?');
    expect(F.cmPulirRedaccion('Uno dos. Tres cuatro. Cinco seis. Siete ocho.', { maxOraciones: 3 })).toBe('Uno dos. Tres cuatro. Cinco seis.');
    const p = F.cmPulirRedaccion(t4, { maxOraciones: 3 });
    expect(motivo(p, { maxOraciones: 3 })).toBe('');
  });
});

describe('costo: con todo encendido, un texto adversarial de 2000 caracteres no se cuelga', () => {
  it('termina en menos de 1 s', () => {
    const o = { maximo: 2000, permitirMontos: true, sinDatosDePago: true, sinAfirmarCompra: true, sinPromesasDeAviso: true };
    const malos = ['ya ' + 'a '.repeat(990), 'cuenta ' + '1 '.repeat(990), 'te ' + 'avisa '.repeat(330), 'tu pedido ' + 'esta, '.repeat(300), 'p'.repeat(1990)];
    const t0 = Date.now();
    for (const m of malos) motivo(m.slice(0, 2000), o);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('invisibles: cmNorm los quita (las prohibiciones 3 y 4 no se evaden con etiquetas U+E00xx)', () => {
  const tag = (x: string, k: number): string => [...x].map((c, i) => (i % k === 0 ? String.fromCodePoint(0xe0061) : '') + c).join('');
  const FRASES = ['Tu pago fue acreditado', 'Recibimos tu pago', 'Pago verificado', 'No soy un bot', 'Soy una persona real', 'Quedó agendada tu cita'];
  for (const t of FRASES) {
    for (const k of [2, 3]) it(`rechaza con una etiqueta cada ${k}: «${t}»`, () => expect(motivo(tag(t, k)), t).toBe('afirma_un_hecho'));
    it(`rechaza con selectores de variación y ZWJ: «${t}»`, () => expect(motivo([...t].join('\uFE0F\u200D')), t).toBe('afirma_un_hecho'));
  }
  it('con texto sin invisibles la salida no cambia', () => {
    for (const t of ['Tenemos lugar el viernes a las 11:30. ¿Te sirve?', 'El libro incluye 4 bonos 😊', 'Hola, ¿en qué te ayudo?']) expect(motivo(t, { permitirMontos: true })).toBe('');
  });
});

describe('invisibles Default_Ignorable y Braille (re-revisión): no evaden las prohibiciones 3 y 4', () => {
  const FRASES = ['Tu pago fue acreditado', 'Recibimos tu pago', 'Pago verificado', 'No soy un bot', 'Soy una persona real', 'Quedó agendada tu cita'];
  const INVISIBLES: Array<[string, string]> = [['U+17B4', '\u17B4'], ['U+17B5', '\u17B5'], ['U+180B', '\u180B'], ['U+180C', '\u180C'], ['U+180D', '\u180D'], ['U+180E', '\u180E'], ['U+180F', '\u180F'], ['U+2800', '\u2800'], ['U+034F', '\u034F'], ['U+115F', '\u115F'], ['U+3164', '\u3164']];
  for (const [nombre, ch] of INVISIBLES) {
    for (const t of FRASES) it(`${nombre} dentro de «${t}»`, () => expect(motivo(ch === '\u2800' ? t.replace(/\S+$/, (w) => [...w].join(ch)) : [...t].join(ch)), t).toBe('afirma_un_hecho')); // Braille cuenta como ESPACIO: letras sueltas, como «p a g o»
    it(`${nombre} en una frase de pago de las opciones`, () => expect(motivo(['Deposita', 'a', 'la', 'cuenta'].join(ch === '\u2800' ? ch : ' ' + ch), { sinDatosDePago: true })).not.toBe(''));
  }
  it('el enlace partido con invisibles se detecta', () => {
    expect(motivo(`Mira ejemplo${'\u2800'}.mx/x${'\u17B4'}`)).toBe('enlace_ajeno');
  });
  it('los emojis siguen pasando', () => {
    for (const e of ['👨‍⚕️', '❤️', '👩‍👩‍👧', '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', '1️⃣', '👋🏽']) {
      expect(motivo(`Hola ${e} ¿en qué te ayudo?`), e).toBe('');
      expect(F.cmPulirRedaccion(`Hola ${e} ¿en qué te ayudo?`), e).toContain(e);
    }
  });
});

describe('invisibles ENTRE palabras y frases sin espacios (revisión de seguridad del #630)', () => {
  const OCHO = ['Tu pago fue acreditado', 'Recibimos tu pago', 'Pago verificado', 'No soy un bot', 'Soy una persona real', 'Quedó agendada tu cita', 'Pago verificado, gracias', 'Soy una persona real, no un bot', 'Ya agendé tu cita', 'Yateagendélacita'];
  const SEP = ['\u2800', '\u3164', '\u115F', '\u17B4', '\u17B5', '\u180B', '\u180E', '\u034F', '\u200B', '\u00AD', '\u2800\u2800'];
  const TODAS = { permitirMontos: true, sinDatosDePago: true, sinAfirmarCompra: true, sinPromesasDeAviso: true };
  for (const sep of SEP) {
    for (const t of OCHO) {
      it(`prefijo pegado y envuelto en pregunta con U+${sep.codePointAt(0)!.toString(16).toUpperCase()}: «${t}»`, () => {
        expect(motivo('Hola' + t.split(' ').join(sep)), t).not.toBe('');
        // «¿Recibimos tu pago?» es una pregunta legítima (misma exención que main con espacios).
        if (!/^Recibimos/.test(t)) expect(motivo('¿' + t.split(' ').join(sep) + '?'), t).not.toBe('');
      });
      for (const [nombre, o] of [['sin opciones', undefined], ['con opciones', TODAS]] as Array<[string, object | undefined]>) {
        it(`${nombre}: U+${sep.codePointAt(0)!.toString(16).toUpperCase()} como separador de «${t}»`, () => expect(motivo(t.split(' ').join(sep), o), t).not.toBe(''));
        it(`${nombre}: U+${sep.codePointAt(0)!.toString(16).toUpperCase()} dentro de las palabras de «${t}»`, () => expect(motivo([...t].join(sep), o), t).not.toBe(''));
      }
    }
  }
  it('letras sueltas con espacios y sin ellos', () => {
    for (const t of ['P a g o v e r i f i c a d o', 'Pagoverificado', 'P a g o   v e r i f i c a d o', 'Nosoyunbot', 'Soyunapersona', 'Recibimostupago', 'Quedoagendada']) expect(motivo(t), t).toBe('afirma_un_hecho');
  });
  it('un texto honesto con invisibles de emoji sigue pasando', () => {
    for (const e of ['👨‍⚕️', '❤️', '👩‍👩‍👧', '1️⃣', '👋🏽']) expect(motivo(`Hola ${e} ¿en qué te ayudo con el libro?`, { permitirMontos: true }), e).toBe('');
  });
});

describe('seguimiento del #630 (dos LOW de seguridad): la forma sin espacios no rechaza de más', () => {
  it('«caso y una persona» y las preguntas ya no son falsos positivos', () => {
    for (const t of ['Para tu caso y una persona adicional, te ayudo.', '¿Ya recibimos su pago? Lo revisa recepción.', 'Para tu caso y una persona adicional']) expect(motivo(t), t).toBe('');
    // Pegado es ambiguo: cae al texto fijo.
    expect(motivo('Casoyunapersona')).toBe('afirma_un_hecho');
  });
  it('«ya agendemos» y «ya agenden» no afirman una cita', () => {
    for (const t of ['Ya agendemos la cita', 'Ya agenden ustedes', 'Ya agendemos mañana ¿te sirve?']) expect(motivo(t), t).toBe('');
  });
  it('lo que sí afirma sigue rechazado, también con una pregunta metida en medio o con «soy» suelto', () => {
    for (const t of ['Soyunapersona', 'Yo soyunapersona', 'Pago ¿x? verificado', 'Pagoverificado ¿ok?', 'Ya agendé tu cita', 'Yaagendé', 'Yateagendélacita', 'Te agendé la cita', 'Yaagendeelturno', 'Ya agendé nada', 'Holasoyunapersonareal', 'Yosoyunapersona', 'Hola ¿Pagoverificado? gracias', '¿Nosoyunbot?', '¿Pagoverificado? Sí', '¿Yaagendetucita?', '¿¿Pagoverificado??', '¿Hola\nPagoverificado\ngracias?']) expect(motivo(t), t).toBe('afirma_un_hecho');
  });
  it('una frase fuera de la pregunta sigue contando aunque haya otra pregunta en el texto', () => {
    expect(motivo('Pagoverificado. ¿Algo más?')).toBe('afirma_un_hecho');
  });
});

describe('maxOraciones: saltos de línea, emojis y listas numeradas', () => {
  const o = { maxOraciones: 3 };
  it('el salto de línea y el emoji final cierran oración', () => {
    expect(motivo('Uno\ndos\ntres\ncuatro', o)).toBe('largo_en_oraciones');
    expect(motivo('Uno 😊 dos 😊 tres 😊 cuatro', o)).toBe('largo_en_oraciones');
  });
  it('un número de lista no cierra oración y pulir no deja «1. ¿Te interesa?»', () => {
    const t = 'El libro tiene: 1. Teoría 2. Práctica 3. Bonos ¿Te interesa?';
    expect(motivo(t, o)).toBe('');
    expect(F.cmPulirRedaccion(t, o)).toBe(t);
    expect(F.cmPulirRedaccion('El libro tiene: 1. Teoría 2. Práctica. Uno. Dos. Tres. ¿Te interesa?', o)).not.toMatch(/^El libro tiene: 1\. ¿Te interesa\?$/);
  });
});

describe('tiempo: dígitos largos junto a «cuenta»', () => {
  it('2000 dígitos no son cuadráticos', () => {
    const t0 = Date.now();
    motivo('9'.repeat(1990) + ' cuenta', { maximo: 2000, sinDatosDePago: true });
    motivo('cuenta ' + '9'.repeat(1990), { maximo: 2000, sinDatosDePago: true });
    expect(Date.now() - t0).toBeLessThan(300);
  });
});

describe('«te lo confirmo»: confirmar INFORMACIÓN no es una acción del código (falso positivo de Evy, 24/10)', () => {
  const EVY = '¡Hola! Te entiendo perfectamente, es una pregunta muy común porque suena demasiado bien para ser verdad. 😊 Te lo confirmo con total transparencia: **la valoración médica con la Dra. Evy es 100% gratuita**. No hay ningún costo escondido, no pagas nada por adelantado para reservar.';
  it('la respuesta de Evy y la información confirmada salen', () => {
    for (const t of [EVY, 'Te lo confirmo.', 'Te lo confirmo con total transparencia.', 'Te lo confirmo: la valoración es gratuita.', 'Te confirmo que la valoración es 100% gratuita.', 'Es gratuita, te lo confirmo.', 'Te lo confirmo: no hay ningún costo.', 'Te lo confirmo: la consulta es gratis.', 'Te lo confirmo: es gratuita y no hay pago de reserva.', 'Te lo confirmo: sin costo ni pago por adelantado.']) expect(motivo(t), t).toBe('');
  });
  it('confirmar una cita, un pago o un estado sigue rechazado, antes o después de los dos puntos', () => {
    for (const t of ['Te confirmo tu cita para el lunes.', 'Te lo confirmo: tu cita es el lunes.', 'Te lo confirmo: ya agendé tu cita.', 'Te confirmo tu reserva', 'Confirmo tu pago', 'Tu cita es el lunes, te lo confirmo.', 'Te lo confirmo: tu cita quedó para el lunes', 'Te lo confirmo: reservé tu lugar', 'Te lo confirmo: no hay pago de reserva y tu cita es el lunes.', 'Te lo confirmo, ya está.', 'Te lo confirmo: queda reservado', 'Te lo confirmo: el horario es de 9 a 12', 'Te lo confirmo: nos vemos mañana a las 10', 'Te confirmo que recibimos tu pago', 'Te lo confirmo: tu turno', 'Te lo​ confirmo: tu​ cita es el lunes', 'Te lo c0nfirmo: tu c1ta es el lunes', 'Ｔｅ ｌｏ ｃｏｎｆｉｒｍｏ： ｔｕ ｃｉｔａ', 'Te lo confirmo: tu citaa es el lunes', 'Teㅤlo confirmo: tu cita es el lunes', 'Te lo⠀confirmo: tu cita']) expect(motivo(t), t).toBe('afirma_un_hecho');
  });
  it('el resto de la matriz sigue igual', () => {
    for (const t of ['Tu pago fue acreditado', 'Recibimos tu pago', 'Pago verificado', 'Quedó agendada tu cita', 'Ya agendé tu cita', 'ya pagaste tu reserva', 'ya te llegó tu pago', 'No soy un bot']) expect(motivo(t), t).toBe('afirma_un_hecho');
  });
  it('no es cuadrático', () => {
    const t0 = Date.now();
    motivo('te lo confirmo ' + 'sin '.repeat(450), { maximo: 2000 });
    motivo('no hay '.repeat(280) + 'te lo confirmo', { maximo: 2000 });
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
