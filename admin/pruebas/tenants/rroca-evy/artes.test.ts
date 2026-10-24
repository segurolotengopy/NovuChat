/**
 * LAS TRES IMÁGENES DE APOYO (etiquetas que el CÓDIGO convierte en imagen). Se NIEGA: una etiqueta nunca llega al cliente; solo las tres permitidas envían imagen y una sola vez por conversación; con un id sin
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
    '[ENVIAR_ARTE_ANTES_DESPUES] Es una paciente real de la Dra. Evy. Cada rostro responde distinto.',
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

describe('solo las tres permitidas envían imagen, una vez por imagen y por conversación', () => {
  it('cada etiqueta permitida envía SU imagen ANTES del texto', () => {
    const casos: Array<[string, string, string]> = [
      ['[ENVIAR_ARTE_COMPARATIVO] Te explico la diferencia entre ambos.', PIDE_DIFERENCIA, IDS.comparativo],
      ['[ENVIAR_ARTE_ANTES_DESPUES] Es una paciente real. Cada rostro responde distinto.', PIDE_VER, IDS.antes_despues],
      ['[ENVIAR_ARTE_AUTORIDAD] La Dra. Evy es aplicadora certificada.', PIDE_QUIEN, IDS.autoridad],
    ];
    for (const [salida, pregunta, id] of casos) {
      const m = crear({ modeloDice: dice(salida) });
      const t = hablar(m, ANA, mTexto(pregunta));
      expect(imagenes(t)).toEqual([id]);
      // la imagen sale antes que el texto
      const iImagen = t.registro.findIndex((r) => r.nodo === 'Enviar previos');
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
    const m = crear({ modeloDice: dice('[ENVIAR_ARTE_AUTORIDAD] La Dra. Evy es aplicadora certificada.') });
    expect(imagenes(hablar(m, ANA, mTexto(PIDE_QUIEN))).length).toBe(1);
    m.avanzar(49 * 60);
    expect(imagenes(hablar(m, ANA, mTexto(PIDE_QUIEN))).length).toBe(1);
  });
  it('un máximo de 3 imágenes por conversación', () => {
    const salidas = ['[ENVIAR_ARTE_AUTORIDAD] Certificada.', '[ENVIAR_ARTE_ANTES_DESPUES] Paciente real. Cada rostro responde distinto.', '[ENVIAR_ARTE_COMPARATIVO] La diferencia.', '[ENVIAR_ARTE_AUTORIDAD] [ENVIAR_ARTE_COMPARATIVO] Otra vez.'];
    let i = 0;
    const m = crear({ modeloDice: () => salidas[Math.min(i++, salidas.length - 1)]! });
    const preg = [PIDE_QUIEN, PIDE_VER, PIDE_DIFERENCIA, PIDE_DIFERENCIA];
    const total = preg.map((p) => imagenes(hablar(m, ANA, mTexto(p))).length).reduce((a, b) => a + b, 0);
    expect(total).toBe(3);
  });
});

describe('la barrera por hecho: si la imagen no salió, el texto no la promete', () => {
  const PROMETE = '[ENVIAR_ARTE_ANTES_DESPUES] Te envío la imagen del caso. Es una paciente real de la Dra. Evy. Cada rostro responde distinto. ¿Qué zona te gustaría mejorar?';
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
    const sale = crear({ modeloDice: dice('[ENVIAR_ARTE_ANTES_DESPUES] Es una paciente real de la Dra. Evy.') });
    const t = hablar(sale, ANA, mTexto(PIDE_VER));
    expect(textos(t)[0]).toMatch(/paciente real/i);
    expect(textos(t)[0]).toMatch(/cada rostro responde distinto/i);
    // sin etiqueta, el modelo habla de la paciente real y el código lo quita
    const sin = crear({ modeloDice: dice('Es una paciente real de la Dra. Evy que recuperó su contorno. ¿Qué zona quieres mejorar?') });
    expect(textos(hablar(sin, ANA, mTexto('hola')))[0]).not.toMatch(/paciente real/i);
  });
  it('un texto que promete una imagen sin etiqueta pierde la promesa', () => {
    const m = crear({ modeloDice: dice('Mira la imagen que te adjunto. La valoración es gratuita. ¿Cómo te llamas?') });
    const txt = textos(hablar(m, ANA, mTexto('hola')))[0]!;
    expect(txt).not.toMatch(/adjunto|mira la imagen/i);
    expect(txt).toContain('¿Cómo te llamas?');
  });
});

describe('D6: el comparativo (las marcas) solo con la bandera y solo si el cliente pregunta', () => {
  const COMP = '[ENVIAR_ARTE_COMPARATIVO] Te explico la diferencia entre ambos.';
  it('con usarMarcas apagada no se envía y la etiqueta no llega al cliente', () => {
    const m = crear({ modeloDice: dice(COMP), base: { usarMarcas: '' } });
    const t = hablar(m, ANA, mTexto(PIDE_DIFERENCIA));
    expect(imagenes(t)).toEqual([]);
    expect(textos(t)[0]).not.toMatch(ETIQUETAS);
  });
  it('con usarMarcas encendida, el saludo y cualquier mensaje que no pregunte por la diferencia nunca lo envían', () => {
    for (const msg of ['Hola, vi su anuncio', 'quiero agendar mi valoración', '¿cuánto cuesta?', 'cuéntame de Radiesse']) {
      const m = crear({ modeloDice: dice(COMP) });
      expect(imagenes(hablar(m, ANA, mTexto(msg)))).toEqual([]);
    }
  });
  it('con usarMarcas encendida y la pregunta de la diferencia o de cuál conviene, sí', () => {
    for (const msg of [PIDE_DIFERENCIA, '¿Cuál me conviene más?', 'Radiesse o HArmonyCa, ¿cuál es mejor?', 'qué diferencia hay entre uno y otro']) {
      const m = crear({ modeloDice: dice(COMP) });
      expect(imagenes(hablar(m, ANA, mTexto(msg)))).toEqual([IDS.comparativo]);
    }
  });
  it('el prompt sin marcas no nombra Radiesse ni HArmonyCa; con marcas sí', () => {
    let sistema = '';
    const captura = { modeloDice: (ll: { cuerpo?: Record<string, unknown> }) => { sistema = JSON.stringify(ll.cuerpo?.['systemInstruction']); return 'ok'; } };
    hablar(crear({ ...captura, base: { usarMarcas: '' } }), ANA, mTexto('hola'));
    expect(sistema).not.toMatch(/Radiesse|HArmonyCa/);
    expect(sistema).toContain('bioestimuladores de colágeno');
    hablar(crear({ ...captura }), ANA, mTexto('hola'));
    expect(sistema).toMatch(/Radiesse/);
  });
});
