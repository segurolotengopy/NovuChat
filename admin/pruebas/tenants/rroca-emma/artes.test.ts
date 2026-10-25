/**
 * LAS IMÁGENES DE APOYO DE EMMA (etiquetas que el CÓDIGO convierte en imagen). Se NIEGA: una etiqueta nunca llega al cliente; solo las permitidas envían imagen (HOY dos: bata = autoridad, y antes y después; la comparativa no existe y está INACTIVA) y una sola vez por conversación; con un id sin
 * resolver, o si Meta rechaza el envío, el texto sale igual SIN la etiqueta y SIN prometer la imagen; «paciente real» solo si el antes y después salió ese turno; el comparativo solo con `usarMarcas` y solo si el
 * cliente pregunta por la diferencia (lo decide el código, no el modelo); un máximo de 3 por conversación.
 */
import { describe, expect, it } from 'vitest';
import { ANA, BETO, IDS, crear, dice, hablar, imagenes, mTexto, textos } from './mundo';

const PIDE_DIFERENCIA = '¿Cuál es la diferencia entre los dos tratamientos?';
const PIDE_VER = 'Quiero ver cómo queda, me da miedo verme artificial';
const PIDE_QUIEN = '¿Quién aplica el producto? ¿tiene certificación?';
const ETIQUETAS = /\[|\]|ENVIAR_ARTE|DERIVAR_RECEPCION/i;

describe('las etiquetas nunca llegan al cliente', () => {
  const formas = [
    '[ENVIAR_ARTE_ANTES_DESPUES] Es una paciente real de la Dra. Emma. Cada rostro responde distinto.',
    '[ENVIAR_ARTE_ANTES_DESPUES][ENVIAR_ARTE_ANTES_DESPUES] Es una paciente real. Cada rostro responde distinto.',
    'Es una paciente real. Cada rostro responde distinto. [enviar_arte_antes_despues]',
    'ENVIAR_ARTE_ANTES_DESPUES] Es una paciente real. Cada rostro responde distinto.',
    '[ENVIAR_ARTE_ANTES_DESPU Es una paciente real. Cada rostro responde distinto.',
    '[ ENVIAR ARTE ANTES DESPUÉS ] Es una paciente real. Cada rostro responde distinto.',
    '[ENVIAR_ARTE_INVENTADO] [OTRA_ETIQUETA] Cuéntame, ¿qué zona quieres mejorar? [nota interna]',
  ];
  for (const f of formas) {
    it(`sale limpia: ${f.slice(0, 50)}`, () => {
      const m = crear({ modeloDice: dice(f) });
      const t = hablar(m, ANA, mTexto(PIDE_VER));
      expect(t.mensajes.length).toBe(1);
      expect(textos(t)[0]).not.toMatch(ETIQUETAS);
    });
  }
});

describe('solo las dos activas envían imagen, una vez por imagen y por conversación', () => {
  it('cada etiqueta permitida envía SU imagen ANTES del texto', () => {
    const casos: Array<[string, string, string]> = [
      ['[ENVIAR_ARTE_ANTES_DESPUES] Es una paciente real. Cada rostro responde distinto.', PIDE_VER, IDS.antes_despues],
      ['[ENVIAR_ARTE_AUTORIDAD] La Dra. Emma es aplicadora certificada.', PIDE_QUIEN, IDS.autoridad],
    ];
    for (const [salida, pregunta, id] of casos) {
      const m = crear({ modeloDice: dice(salida) });
      const t = hablar(m, ANA, mTexto(pregunta));
      expect(imagenes(t)).toEqual([id]);
      // la imagen sale antes que el texto
      const iImagen = t.registro.findIndex((r) => r.nodo === 'Enviar aviso');
      const iTexto = t.registro.findIndex((r) => r.nodo === 'Enviar a WhatsApp');
      expect(iImagen).toBeGreaterThanOrEqual(0);
      expect(iImagen).toBeLessThan(iTexto);
      expect(t.avisos.find((a) => a.tipo === 'image')!.payload['type']).toBe('image');
    }
  });
  it('una etiqueta fuera de la lista no envía nada', () => {
    const m = crear({ modeloDice: dice('[ENVIAR_ARTE_PROMOCION] Hola, cuéntame qué zona quieres mejorar.') });
    expect(imagenes(hablar(m, ANA, mTexto('hola')))).toEqual([]);
  });
  it('la misma imagen se envía UNA sola vez por conversación; la ficha es por teléfono', () => {
    const m = crear({ modeloDice: dice('[ENVIAR_ARTE_ANTES_DESPUES] Es una paciente real. Cada rostro responde distinto.') });
    expect(imagenes(hablar(m, ANA, mTexto(PIDE_VER))).length).toBe(1);
    const otra = hablar(m, ANA, mTexto('mostrame de nuevo cómo queda'));
    expect(imagenes(otra)).toEqual([]);
    expect(textos(otra)[0]).not.toMatch(ETIQUETAS);
    // otro teléfono tiene su propia ficha
    expect(imagenes(hablar(m, BETO, mTexto(PIDE_VER))).length).toBe(1);
  });
  it('a las 48 h la ficha se olvida y la imagen puede volver a enviarse', () => {
    const m = crear({ modeloDice: dice('[ENVIAR_ARTE_AUTORIDAD] La Dra. Emma es aplicadora certificada.') });
    expect(imagenes(hablar(m, ANA, mTexto(PIDE_QUIEN))).length).toBe(1);
    m.avanzar(49 * 60);
    expect(imagenes(hablar(m, ANA, mTexto(PIDE_QUIEN))).length).toBe(1);
  });
  it('con la comparativa inactiva, una conversación recibe como máximo DOS imágenes (autoridad y antes y después)', () => {
    const salidas = ['[ENVIAR_ARTE_AUTORIDAD] Certificada.', '[ENVIAR_ARTE_ANTES_DESPUES] Paciente real. Cada rostro responde distinto.', '[ENVIAR_ARTE_COMPARATIVO] La diferencia.', '[ENVIAR_ARTE_AUTORIDAD] [ENVIAR_ARTE_COMPARATIVO] Otra vez.'];
    let i = 0;
    const m = crear({ modeloDice: () => salidas[Math.min(i++, salidas.length - 1)]! });
    const preg = [PIDE_QUIEN, PIDE_VER, PIDE_DIFERENCIA, PIDE_DIFERENCIA];
    const total = preg.map((p) => imagenes(hablar(m, ANA, mTexto(p))).length).reduce((a, b) => a + b, 0);
    expect(total).toBe(2);
  });
});

describe('la barrera por hecho: si la imagen no salió, el texto no la promete', () => {
  const PROMETE = '[ENVIAR_ARTE_ANTES_DESPUES] Te envío la imagen del caso. Es una paciente real de la Dra. Emma. Cada rostro responde distinto. ¿Qué zona te gustaría mejorar?';
  it('con el id sin resolver: sale el texto sin etiqueta, sin la promesa y sin «paciente real»', () => {
    const m = crear({ modeloDice: dice(PROMETE), base: { arteAntesDespuesMediaId: 'REEMPLAZAR_MEDIA_ID_ARTE_ANTES_DESPUES' } });
    const t = hablar(m, ANA, mTexto(PIDE_VER));
    expect(imagenes(t)).toEqual([]);
    const txt = textos(t)[0]!;
    expect(txt).not.toMatch(ETIQUETAS);
    expect(txt).not.toMatch(/te env[ií]o|paciente real/i);
    expect(txt).toContain('¿Qué zona');
  });
  it('si Meta rechaza el envío de la imagen: el texto igual sale, sin la promesa ni «paciente real»', () => {
    const m = crear({ modeloDice: dice(PROMETE), previos: 'error' });
    const t = hablar(m, ANA, mTexto(PIDE_VER));
    expect(t.avisos.some((a) => a.tipo === 'image')).toBe(true);
    const txt = textos(t)[0]!;
    expect(txt).not.toMatch(ETIQUETAS);
    expect(txt).not.toMatch(/te env[ií]o|paciente real/i);
    expect(t.mensajes.length).toBe(1);
    // y no se anota como enviada: la próxima vez se vuelve a intentar
    const m2 = crear({ modeloDice: dice(PROMETE), previos: (ll) => (ll.n === 1 ? 'error' : 'acepta') });
    hablar(m2, ANA, mTexto(PIDE_VER));
    expect(imagenes(hablar(m2, ANA, mTexto(PIDE_VER))).length).toBe(1);
  });
  it('si la red lanza al enviar la imagen, el turno no se corta', () => {
    const m = crear({ modeloDice: dice(PROMETE), previos: 'lanza' });
    expect(textos(hablar(m, ANA, mTexto(PIDE_VER))).length).toBe(1);
  });
  it('«paciente real» sale solo si el antes y después salió ESE turno, y entonces va con la aclaración', () => {
    const sale = crear({ modeloDice: dice('[ENVIAR_ARTE_ANTES_DESPUES] Es una paciente real de la Dra. Emma.') });
    const t = hablar(sale, ANA, mTexto(PIDE_VER));
    expect(textos(t)[0]).toMatch(/paciente real/i);
    expect(textos(t)[0]).toMatch(/cada rostro responde distinto/i);
    // sin etiqueta, el modelo habla de la paciente real y el código lo quita
    const sin = crear({ modeloDice: dice('Es una paciente real de la Dra. Emma que recuperó su contorno. ¿Qué zona quieres mejorar?') });
    expect(textos(hablar(sin, ANA, mTexto('hola')))[0]).not.toMatch(/paciente real/i);
  });
  it('un texto que promete una imagen sin etiqueta pierde la promesa', () => {
    const m = crear({ modeloDice: dice('Mira la imagen que te adjunto. La valoración es gratuita. ¿Cómo te llamas?') });
    const txt = textos(hablar(m, ANA, mTexto('hola')))[0]!;
    expect(txt).not.toMatch(/adjunto|mira la imagen/i);
    expect(txt).toContain('¿Cómo te llamas?');
  });
});

describe('la comparativa «¿Sculptra® o Radiesse®?» está INACTIVA (no existe el archivo)', () => {
  const COMP = '[ENVIAR_ARTE_COMPARATIVO] Te explico la diferencia entre ambos.';
  it('sin id resuelto NUNCA se envía, ni con la pregunta de la diferencia, y la etiqueta no llega al cliente', () => {
    for (const msg of [PIDE_DIFERENCIA, '¿Cuál me conviene más?', 'Sculptra o Radiesse, ¿cuál es mejor?', 'hola']) {
      const t = hablar(crear({ modeloDice: dice(COMP), base: { arteComparativoMediaId: '' } }), ANA, mTexto(msg));
      expect(imagenes(t), msg).toEqual([]);
      expect(textos(t)[0]).not.toMatch(ETIQUETAS);
    }
  });
  it('PREPARADA: el día que exista el archivo y se cargue su id, sale solo con la bandera y solo si el cliente pregunta por la diferencia', () => {
    const ID = ['1234', '5678', '01'].join('');
    for (const msg of ['Hola, vi su anuncio', 'quiero agendar mi valoración', '¿cuánto cuesta?', 'cuéntame de Radiesse']) {
      expect(imagenes(hablar(crear({ modeloDice: dice(COMP), base: { arteComparativoMediaId: ID } }), ANA, mTexto(msg))), msg).toEqual([]);
    }
    for (const msg of [PIDE_DIFERENCIA, '¿Cuál me conviene más?', 'Sculptra o Radiesse, ¿cuál es mejor?']) {
      expect(imagenes(hablar(crear({ modeloDice: dice(COMP), base: { arteComparativoMediaId: ID } }), ANA, mTexto(msg))), msg).toEqual([ID]);
    }
    expect(imagenes(hablar(crear({ modeloDice: dice(COMP), base: { arteComparativoMediaId: ID, usarMarcas: '' } }), ANA, mTexto(PIDE_DIFERENCIA)))).toEqual([]);
  });
  it('el prompt sin marcas no nombra Sculptra ni Radiesse; con marcas sí', () => {
    let sistema = '';
    const captura = { modeloDice: (ll: { cuerpo?: Record<string, unknown> }) => { sistema = JSON.stringify(ll.cuerpo?.['systemInstruction']); return 'ok'; } };
    hablar(crear({ ...captura, base: { usarMarcas: '' } }), ANA, mTexto('hola'));
    expect(sistema).not.toMatch(/Sculptra|Radiesse/);
    expect(sistema).toContain('bioestimuladores de colágeno');
    hablar(crear({ ...captura }), ANA, mTexto('hola'));
    expect(sistema).toMatch(/Sculptra/);
    expect(sistema).toMatch(/Radiesse/);
  });
});
