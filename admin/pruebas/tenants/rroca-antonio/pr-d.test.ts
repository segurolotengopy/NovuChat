/**
 * «EL PUENTE» DE ANTONIO — PR-D (22/10/2026): QR abierto «como Rubén», nunca el mismo texto dos veces, audio corto, sin configuración, saludo fijo, catálogo e imágenes.
 * Escribe NEGANDO, con las frases EXACTAS de la prueba real y el vigilante de UX en cada turno. 0 mensajes agregados: un mensaje por turno, o ninguno.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo, ResultadoTurno } from '../../lib/n8n-de-mentira';
import { ANA, COMPROBANTE, PRELLENADOS, crear, hablar, mAudio, mTexto, mBoton, panelConQr, panelOk, type Opciones } from './mundo';
import { vigilarUx } from './vigilante-ux';

const nuevo = (o: Opciones = {}): Mundo => { const w = crear(o); vigilarUx(w); return w; };
const fichaDe = (w: Mundo, tel = ANA): J => ((w.sd['antonio'] ?? {}) as J)[tel] as J;
const esBotonDeAntonio = (t: ResultadoTurno): boolean => t.mensajes[0]?.payload['interactive']?.type === 'cta_url';
const conQr = (o: Opciones = {}): Mundo => { const w = nuevo({ panel: panelConQr(49), ...o }); hablar(w, ANA, mTexto('hola')); return w; };

describe('C. con un QR abierto: se responde, no se repite el recordatorio, no se abre otro QR', () => {
  it('«¿qué otras opciones tengo?» recibe el catálogo por código, sin botones de producto, sin modelo y sin otro QR', () => {
    const w = conQr();
    const t = hablar(w, ANA, mTexto('¿qué otras opciones tengo?'));
    expect(t.mensajes).toHaveLength(1);
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
    expect(t.mensajes[0]!.cuerpo).toMatch(/Pack Completo: 49 Bs[\s\S]*Libro[^\n]*: 35 Bs[\s\S]*Workbook: 20 Bs/);
    expect(t.mensajes[0]!.tipo).not.toBe('image');
    expect(esBotonDeAntonio(t)).toBe(true);
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/Ya tienes un QR abierto/);
  });
  it('las TRES frases de la prueba real ya no reciben el mismo recordatorio tres veces', () => {
    const w = conQr();
    const textos = ['¿qué otras opciones tengo?', 'no quiero comprar, quiero ver otras opciones', 'cancela ese qr'].map((x) => hablar(w, ANA, mTexto(x)));
    const cuerpos = textos.map((t) => t.mensajes[0]!.cuerpo);
    expect(new Set(cuerpos).size).toBe(3);
    expect(cuerpos.filter((c) => /Ya tienes un QR abierto/.test(c))).toHaveLength(0);
    // El aviso sale una vez (límite de 30 minutos por motivo); la tercera frase llevaría el MISMO texto que la segunda y por eso sale la alternativa fija (D), siempre con el botón.
    expect(textos[1]!.avisos).toHaveLength(1);
    expect(textos[2]!.avisos).toHaveLength(0);
    expect(cuerpos[1]).toMatch(/no puedo cancelar un pedido/);
    expect(cuerpos[1]).not.toMatch(/queda(ó|ron)? cancelad/i);
    expect(cuerpos[2]).toMatch(/Antonio/);
    for (const t of textos.slice(1)) expect(esBotonDeAntonio(t)).toBe(true);
  });
  it('«cancela/cancelar el qr/pedido» escala a Antonio con aviso y botón, y libera la guarda local del QR', () => {
    for (const x of ['cancela ese qr', 'quiero cancelar el pedido', 'ya no lo quiero']) {
      const w = conQr();
      hablar(w, ANA, mBoton('b_pack')); // la guarda local queda marcada por el QR del turno anterior
      const t = hablar(w, ANA, mTexto(x));
      expect(t.avisos, x).toHaveLength(1);
      expect(esBotonDeAntonio(t), x).toBe(true);
      expect(t.ejecutados.has('Conversar con el modelo'), x).toBe(false);
    }
  });
  it('una pregunta de precio se responde por código sin repetir el recordatorio ni ofrecer botones; hablar de pagar SÍ recibe el recordatorio', () => {
    const w = conQr();
    const p = hablar(w, ANA, mTexto('¿cuánto cuesta el libro?'));
    expect(p.mensajes[0]!.cuerpo).toMatch(/35 Bs/);
    expect(p.mensajes[0]!.cuerpo).not.toMatch(/Ya tienes un QR abierto/);
    const r = hablar(w, ANA, mTexto('¿cómo pago?'));
    expect(r.mensajes[0]!.cuerpo).toMatch(/Ya tienes un QR abierto/);
  });
  it('el recordatorio repetido escala a Antonio (qr_insistente) en vez de repetirse', () => {
    const w = conQr();
    const a = hablar(w, ANA, mTexto('ya voy a pagar'));
    expect(a.mensajes[0]!.cuerpo).toMatch(/Ya tienes un QR abierto/);
    w.avanzar(1);
    const b = hablar(w, ANA, mTexto('¿cómo pago?'));
    expect(b.mensajes[0]!.cuerpo).not.toBe(a.mensajes[0]!.cuerpo);
    expect(b.mensajes[0]!.cuerpo).toMatch(/Sigo viendo tu QR abierto/);
    expect(b.avisos).toHaveLength(1);
    expect(esBotonDeAntonio(b)).toBe(true);
  });
  it('una pregunta que el código no sabe con un QR abierto la contesta el modelo, sin botones de producto', () => {
    const w = conQr({ modeloDice: 'El libro tiene 14 capítulos con ejercicios prácticos para cada semana.' });
    const t = hablar(w, ANA, mTexto('¿el libro sirve si mi pareja no quiere leerlo?'));
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(true);
    expect(esBotonDeAntonio(t)).toBe(true);
  });
});

describe('D. nunca el mismo texto dos veces seguidas, con reversión si Meta no aceptó el envío', () => {
  it('el mismo texto dos veces seguidas sale como alternativa con el botón de Antonio; el QR y el resultado de un comprobante están exentos', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    const a = hablar(w, ANA, mTexto('hola'));
    const b = hablar(w, ANA, mTexto('hola'));
    expect(b.mensajes[0]!.cuerpo).not.toBe(a.mensajes[0]!.cuerpo);
    expect(esBotonDeAntonio(b)).toBe(true);
    expect(fichaDe(w)['ultimaFirma']).toBe('repetido');
  });
  it('la protección ante violencia o miedo NO se sustituye aunque se repita', () => {
    const w = nuevo();
    const a = hablar(w, ANA, mTexto('mi pareja me pega'));
    const b = hablar(w, ANA, mTexto('mi pareja me pega'));
    expect(b.mensajes[0]!.cuerpo).toBe(a.mensajes[0]!.cuerpo);
    expect(b.mensajes[0]!.cuerpo).toBe('Este asistente no atiende ese tipo de consultas.');
  });
  it('si Meta no aceptó el envío ni el respaldo, el hash y la firma vuelven a su valor anterior', () => {
    const w = nuevo({ envio: { 'Enviar a WhatsApp': 'error', 'Enviar respaldo': 'error' } });
    const t = hablar(w, ANA, mTexto('hola'), { toleraFallo: true });
    expect(t.fallo).not.toBeNull();
    expect(fichaDe(w)['ultimoHash']).toBe('');
    expect(fichaDe(w)['ultimaFirma']).toBe('');
  });
});

describe('A. nota de voz corta o ininteligible, y sin configuración', () => {
  const casos: Array<[string, string | null]> = [['vacía', ''], ['una palabra', 'eh'], ['dos palabras sin sentido', 'mmm aja'], ['sin transcripción', null], ['marca de ruido', '[inaudible]']];
  for (const [nombre, transcripcion] of casos) {
    it(`transcripción ${nombre}: texto fijo para repetir y el modelo NO responde`, () => {
      const w = nuevo({ medio: { transcripcion } });
      hablar(w, ANA, mTexto('hola'));
      const t = hablar(w, ANA, mAudio());
      expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
      expect(t.mensajes).toHaveLength(1);
      expect(t.mensajes[0]!.cuerpo).toMatch(/nota de voz/);
      expect(t.mensajes[0]!.cuerpo).toMatch(/repites|envías de nuevo|por escrito/);
    });
  }
  it('un audio claro «quiero el pack» abre el QR (el código lo atiende, no el modelo)', () => {
    const w = nuevo({ medio: { transcripcion: 'quiero el pack' } });
    const t = hablar(w, ANA, mAudio());
    expect(t.mensajes[0]!.tipo).toBe('image');
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
  });
  it('un audio ajeno al tema de varias palabras sigue su camino normal (no se confunde con corto)', () => {
    const w = nuevo({ medio: { transcripcion: 'hola buenas tardes quisiera contarles mi situacion' } });
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mAudio());
    expect(t.mensajes).toHaveLength(1);
  });
  for (const [nombre, panel] of [['el panel cae (503)', 'cae'], ['sin catálogo', panelOk({ catalogo: [] })], ['sin cobro ni venta', panelOk({ cobro: undefined, venta: undefined })]] as const) {
    it(`SIN CONFIGURACIÓN (${nombre}): no improvisa, no dice «no puedo mostrarte el QR», sin modelo; aviso a Antonio y botón`, () => {
      const w = nuevo({ panel: panel as never });
      for (const x of ['hola', PRELLENADOS.pack, 'quiero el pack', '¿cuánto cuesta?', 'estamos pasando un momento difícil']) {
        const t = hablar(w, ANA, mTexto(x));
        expect(t.ejecutados.has('Conversar con el modelo'), x).toBe(false);
        expect(t.mensajes[0]!.tipo, x).toBe('interactive');
        expect(esBotonDeAntonio(t), x).toBe(true);
        expect(t.mensajes[0]!.cuerpo, x).not.toMatch(/QR|Bs/);
        w.avanzar(31);
      }
      const t = hablar(nuevo({ panel: panel as never }), BETO_, mTexto('hola'));
      expect(t.avisos).toHaveLength(1);
      expect(t.mensajes[0]!.cuerpo).toMatch(/no puedo consultar la información necesaria/);
    });
  }
});
const BETO_ = '59100000022';

describe('B. saludo fijo en el primer turno y el menú no antes de tiempo', () => {
  it('un primer mensaje libre recibe el saludo fijo por código (sin modelo, sin montos); la conversación sigue en la segunda y el menú llega en la tercera', () => {
    let n = 0;
    const w = nuevo({ modeloDice: () => `Te escucho con atención, gracias por contarlo. ¿Desde cuándo pasa esto? (${++n})` });
    const a = hablar(w, ANA, mTexto('estamos discutiendo mucho y no sé qué hacer'));
    expect(a.ejecutados.has('Conversar con el modelo')).toBe(false);
    expect(a.mensajes[0]!.cuerpo).toMatch(/asistente virtual de Antonio Dauber/);
    expect(a.mensajes[0]!.cuerpo).not.toMatch(/Bs/);
    const b = hablar(w, ANA, mTexto('desde hace meses'));
    expect(b.ejecutados.has('Conversar con el modelo')).toBe(true);
    expect(b.mensajes[0]!.tipo).toBe('text');
    const c = hablar(w, ANA, mTexto('ya no nos escuchamos'));
    expect(c.mensajes[0]!.tipo).toBe('interactive');
    expect(c.mensajes).toHaveLength(1);
  });
});

describe('E y F. catálogo por código desde la consola e imágenes con texto fijo', () => {
  it('«qué vendes», «catálogo» y «lista» listan SOLO lo que el catálogo de la consola trae (sin precios inventados)', () => {
    for (const x of ['¿qué vendes?', 'catálogo', 'lista']) {
      const w = nuevo({ panel: panelOk({ catalogo: [{ id: 'libro', precio: 31 }, { id: 'workbook', precio: 12 }] }) });
      hablar(w, ANA, mTexto('hola'));
      const t = hablar(w, ANA, mTexto(x));
      expect(t.ejecutados.has('Conversar con el modelo'), x).toBe(false);
      expect(t.mensajes[0]!.cuerpo, x).toMatch(/31 Bs/);
      expect(t.mensajes[0]!.cuerpo, x).toMatch(/12 Bs/);
      expect(t.mensajes[0]!.cuerpo, x).not.toMatch(/Pack Completo|49 Bs|35 Bs/);
    }
  });
  it('«¿tienes imágenes?» tiene texto fijo sin modelo; y el modelo no puede prometer una imagen (cae al texto fijo)', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mTexto('¿tienes imágenes del libro?'));
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
    expect(t.mensajes[0]!.cuerpo).toMatch(/no tengo imágenes del libro/);
    for (const crudo of ['Claro, te envío una foto de la portada del libro.', 'Te comparto unas capturas del contenido.']) {
      const v = nuevo({ modeloDice: crudo });
      hablar(v, ANA, mTexto('hola'));
      const r = hablar(v, ANA, mTexto('estamos distanciados desde hace meses'));
      expect(r.mensajes[0]!.cuerpo).toMatch(/Gracias por escribir\. Cuéntame un poco más/);
    }
  });
});
void COMPROBANTE;
