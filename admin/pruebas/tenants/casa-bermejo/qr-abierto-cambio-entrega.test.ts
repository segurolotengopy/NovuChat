/**
 * REVISIÓN DE LA RONDA 11 (26/11/2026), hallazgos 1 a 3. Mensajes por conversación: 0 agregados, 0 quitados (todo cambia DENTRO del mismo mensaje).
 *
 * 1. Con el QR ABIERTO, un cambio de MODO o de DATOS de la entrega se trata como un cambio de piezas: el QR abierto es del pedido anterior, así que se CIERRA el cobro (`cobro_cancelado`, `qrAnulado`)
 *    y se vuelve al paso que corresponde con texto del CÓDIGO (la pregunta fija del paso; luego el resumen con «Confirmar pedido»). Sin QR nuevo en ese turno y sin texto del modelo.
 * 2. «vendedor», «humano», «quiero un vendedor» a secas derivan por código (aviso + botón), sin depender de que el modelo marque `quiereHablar`.
 * 3. Un medio (foto, ubicación, sticker) en un paso de la entrega recibe el texto del medio MÁS la pregunta del paso (y su lista, si el dato es de lista).
 */
import { describe, expect, it } from 'vitest';
import { ANA, completarEnvio, crear, hablar, mImagen, mLista, mSticker, mTexto, mToque, mUbicacion, modelo, modeloAdverso, modeloSano, panelConQr, textos, type Opciones } from './mundo';

const MARCADOR = 'MARCADOR-DEL-MODELO-QZX';
const J = (x: unknown): string => JSON.stringify(x);
type Mund = ReturnType<typeof crear>;
type Turno = ReturnType<typeof hablar>;
const fichas = (m: Mund): Record<string, any> => (m.sd['casabermejo'] ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const todo = (t: Turno): string => t.mensajes.map((x) => x.cuerpo + ' ' + J(x.payload)).join(' | ') + ' ' + J(t.avisos);
const hayQr = (t: Turno): boolean => t.mensajes.some((x) => x.tipo === 'image' && /qr/i.test(J(x.payload)));
const idBoton = (t: Turno): string => /"id":"(pedido:confirmar:[a-z0-9]+)"/.exec(t.mensajes.map((x) => J(x.payload)).join(' '))?.[1] ?? 'pedido:confirmar:sin-boton';
const modeloMarcador = (): Opciones['modeloDice'] => modeloSano((t) => ({ nombre: t }), MARCADOR) as Opciones['modeloDice'];
const modeloCobro = (): Opciones['modeloDice'] => modeloSano((t) => ({ nombre: t }), 'Pago acreditado, recibimos tu pago. ' + MARCADOR) as Opciones['modeloDice'];
/** El modelo que devuelve SOLO el marcador (el texto entero es el marcador) y, en el primer turno, la billetera. */
/** El modelo adverso SOLO después del pedido armado (las primeras `n` llamadas son del modelo sano que arma el pedido): el adverso desde el primer turno no deja llegar al QR. */
const modeloAdversoTras = (n: number): Opciones['modeloDice'] => { const sano = modeloSano((t) => ({ nombre: t })); const adv = modeloAdverso(); adv({} as never); let k = 0; return ((ll: never) => { k++; return k <= n ? sano(ll) : adv(ll); }) as Opciones['modeloDice']; };
const MODELOS: [string, (n: number) => Opciones['modeloDice']][] = [['sano', () => modeloSano((t) => ({ nombre: t })) as Opciones['modeloDice']], ['con marcador', modeloMarcador], ['cobro y marcador', modeloCobro], ['adverso', modeloAdversoTras]];

/** Retiro con «Ana Pérez», «Confirmar pedido» y el QR abierto. */
function conQrDeRetiro(modeloDice: Opciones['modeloDice']): Mund {
  const m = crear({ modeloDice });
  hablar(m, ANA, mTexto('quiero una billetera'));
  hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
  const resumen = hablar(m, ANA, mTexto('Ana Pérez'));
  const q = hablar(m, ANA, mToque(idBoton(resumen), 'Confirmar pedido'));
  expect(hayQr(q)).toBe(true);
  m.dobles['Traer configuración'] = () => panelConQr(450);
  return m;
}
/** Envío completo (Cochabamba) con el QR abierto. */
function conQrDeEnvio(modeloDice: Opciones['modeloDice']): Mund {
  const m = crear({ modeloDice });
  hablar(m, ANA, mTexto('quiero una billetera'));
  hablar(m, ANA, mToque('entrega:envio', 'Envío'));
  const resumen = completarEnvio(m, ANA);
  const q = hablar(m, ANA, mToque(idBoton(resumen), 'Confirmar pedido'));
  expect(hayQr(q)).toBe(true);
  m.dobles['Traer configuración'] = () => panelConQr(450);
  return m;
}
/** Lo que NO puede quedar tras el turno: un cobro abierto con datos distintos a los del pedido. */
function sinCobroAbierto(m: Mund, t: Turno): void {
  expect(t.llamadas.ingesta.find((x) => x['evento'] === 'cobro_cancelado')).toBeTruthy();
  expect(hayQr(t)).toBe(false);
  expect(t.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado')).toBeUndefined();
  expect(fichas(m)[ANA].qrHastaMs).toBe(0);
  expect(fichas(m)[ANA].qrCarrito).toEqual([]);
}

for (const [nombre, modeloDe] of MODELOS) {
  describe(`1. con el QR abierto, cambiar el modo o los datos de la entrega cierra el cobro y vuelve al paso (modelo ${nombre})`, () => {
    it('retiro con QR → «mejor que me lo envíen»: se anula el QR, sale la pregunta fija del departamento con su lista, sin texto del modelo', () => {
      const m = conQrDeRetiro(modeloDe(2));
      const t = hablar(m, ANA, mTexto('mejor que me lo envíen'));
      sinCobroAbierto(m, t);
      expect(t.mensajes).toHaveLength(1);
      expect(todo(t)).not.toContain(MARCADOR);
      expect(todo(t)).not.toMatch(/acreditad|verificad|recibimos tu pago/i);
      if (nombre === 'adverso') return;   // el adverso marca quiereHablar: lo decide el código (ver su prueba aparte)
      expect(textos(t).join(' ')).toMatch(/QR anterior quedó anulado/);
      expect(todo(t)).toMatch(/departamento/i);
      expect(fichas(m)[ANA].entrega.modo).toBe('Envío');
      expect(fichas(m)[ANA].pide).toEqual(['departamento']);
      // el siguiente paso sigue el camino normal y el QR NO sale hasta confirmar con el resumen
      const t2 = hablar(m, ANA, mLista('dep:cb', 'Cochabamba'));
      expect(hayQr(t2)).toBe(false);
      expect(todo(t2)).not.toContain(MARCADOR);
    });
    it('envío completo con QR → «mejor lo recojo en tienda»: se anula el QR y sale lo que corresponde (pregunta del nombre o resumen con «Confirmar pedido»), sin texto del modelo', () => {
      const m = conQrDeEnvio(modeloDe(3));
      const t = hablar(m, ANA, mTexto('mejor lo recojo en tienda'));
      sinCobroAbierto(m, t);
      expect(t.mensajes).toHaveLength(1);
      expect(todo(t)).not.toContain(MARCADOR);
      expect(todo(t)).not.toMatch(/acreditad|verificad|recibimos tu pago/i);
      if (nombre === 'adverso') return;
      expect(textos(t).join(' ')).toMatch(/QR anterior quedó anulado/);
      expect(fichas(m)[ANA].entrega.modo).toBe('Retiro en tienda');
      expect(todo(t)).toMatch(/a nombre de quién|Confirmar pedido/i);
      // el pedido de ahora es el que se ve: nada del envío anterior en el resumen
      expect(todo(t)).not.toMatch(/Cochabamba/);
    });
  });
}

describe('1. NEGADO: sin cambio de entrega, el QR abierto sigue abierto', () => {
  it('«hola» o «gracias» con el QR abierto no cierran el cobro ni anulan nada', () => {
    const m = conQrDeRetiro(modeloSano((t) => ({ nombre: t })) as Opciones['modeloDice']);
    const t = hablar(m, ANA, mTexto('gracias'));
    expect(t.llamadas.ingesta.find((x) => x['evento'] === 'cobro_cancelado')).toBeUndefined();
    expect(textos(t).join(' ')).not.toMatch(/anulado/);
    expect(fichas(m)[ANA].qrHastaMs).toBeGreaterThan(0);
  });
  it('si el servidor no puede cerrar el cobro, el cambio de entrega NO se acepta en silencio: pasa con recepción y no sale otro QR', () => {
    const m = crear({ cancelar: 'cae', modeloDice: modeloSano((t) => ({ nombre: t })) as Opciones['modeloDice'] });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    const r = hablar(m, ANA, mTexto('Ana Pérez'));
    hablar(m, ANA, mToque(idBoton(r), 'Confirmar pedido'));
    m.dobles['Traer configuración'] = () => panelConQr(450);
    const t = hablar(m, ANA, mTexto('mejor que me lo envíen'));
    expect(hayQr(t)).toBe(false);
    expect(textos(t).join(' ')).toMatch(/no pagues con ese QR/);
  });
});

describe('2. «vendedor», «humano», «quiero un vendedor» a secas derivan por código (aviso + botón)', () => {
  for (const frase of ['vendedor', 'humano', 'quiero un vendedor', 'una persona']) {
    for (const [nombre, modeloDe] of [['sano', () => modeloSano((t) => ({ nombre: t })) as Opciones['modeloDice']], ['con marcador', modeloMarcador]] as const) {
      it(`«${frase}» en el paso de la ciudad, modelo ${nombre}`, () => {
        const m = crear({ modeloDice: modeloDe() });
        hablar(m, ANA, mTexto('quiero una billetera'));
        hablar(m, ANA, mToque('entrega:envio', 'Envío'));
        hablar(m, ANA, mLista('dep:cb', 'Cochabamba'));
        const t = hablar(m, ANA, mTexto(frase));
        expect(t.avisos.length).toBeGreaterThanOrEqual(1);
        expect(J(t.mensajes.map((x) => x.payload))).toMatch(/Escribir/);
        expect(todo(t)).not.toContain(MARCADOR);
      });
    }
  }
  it('NEGADO: una frase que solo contiene la palabra NO deriva («humano» dentro de otra consulta)', () => {
    const m = crear({ modeloDice: modeloSano((t) => ({ nombre: t })) as Opciones['modeloDice'] });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mToque('entrega:envio', 'Envío'));
    hablar(m, ANA, mLista('dep:cb', 'Cochabamba'));
    expect(hablar(m, ANA, mTexto('Cochabamba, zona humano')).avisos).toHaveLength(0);
  });
});

describe('3. un medio en un paso de entrega recibe la pregunta del paso (un solo mensaje)', () => {
  const medios: [string, () => Record<string, unknown>][] = [['foto', () => mImagen()], ['ubicación', mUbicacion], ['sticker', mSticker]];
  for (const [medio, mensaje] of medios) {
    it(`${medio} en el paso del departamento: texto del medio + la pregunta y la LISTA del paso`, () => {
      const m = crear({ modeloDice: modeloMarcador() });
      hablar(m, ANA, mTexto('quiero una billetera'));
      hablar(m, ANA, mToque('entrega:envio', 'Envío'));
      const t = hablar(m, ANA, mensaje());
      expect(t.mensajes).toHaveLength(1);
      expect(todo(t)).toMatch(/departamento/i);
      expect(todo(t)).toMatch(/"type":"list"/);
      expect(todo(t)).not.toContain(MARCADOR);
    });
    it(`${medio} en el paso de la ciudad y en el del nombre del retiro`, () => {
      const m = crear({ modeloDice: modeloMarcador() });
      hablar(m, ANA, mTexto('quiero una billetera'));
      hablar(m, ANA, mToque('entrega:envio', 'Envío'));
      hablar(m, ANA, mLista('dep:cb', 'Cochabamba'));
      const t = hablar(m, ANA, mensaje());
      expect(t.mensajes).toHaveLength(1);
      expect(todo(t)).toMatch(/ciudad/i);
      const r = crear({ modeloDice: modeloMarcador() });
      hablar(r, ANA, mTexto('quiero una billetera'));
      hablar(r, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
      const t2 = hablar(r, ANA, mensaje());
      expect(t2.mensajes).toHaveLength(1);
      expect(todo(t2)).toMatch(/a nombre de quién/i);
    });
  }
  it('NEGADO: fuera de la entrega (sin pedido) el medio sigue recibiendo solo su texto, sin pregunta de paso', () => {
    const m = crear({ modeloDice: modeloMarcador() });
    const t = hablar(m, ANA, mUbicacion());
    expect(todo(t)).not.toMatch(/departamento|a nombre de quién|ciudad de destino/i);
  });
});
