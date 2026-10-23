/**
 * «EL PUENTE» DE ANTONIO — PR-D (22/10/2026): QR abierto «como Rubén», nunca el mismo texto dos veces, audio corto, sin configuración, saludo fijo, catálogo e imágenes.
 * Escribe NEGANDO, con las frases EXACTAS de la prueba real y el vigilante de UX en cada turno. 0 mensajes agregados: un mensaje por turno, o ninguno.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo, ResultadoTurno } from '../../lib/n8n-de-mentira';
import { ANA, COMPROBANTE, COTEJO_VALIDO, PRELLENADOS, crear, hablar, mAudio, mDocumento, mImagen, mTexto, mBoton, panelConQr, panelOk, type Opciones } from './mundo';
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
    expect(esBotonDeAntonio(t)).toBe(false);
    expect(t.mensajes[0]!.tipo).toBe('text');
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/Ya tienes un QR abierto/);
  });
  it('pedir OTRAS opciones con un QR abierto da el catálogo: sin aviso a Antonio, sin cancelación, sin botones de producto', () => {
    for (const x of ['no quiero comprar, quiero ver otras opciones', 'que otras opciones tengo?', 'quiero ver otras opciones', 'qué más tienes']) {
      const w = conQr();
      const t = hablar(w, ANA, mTexto(x));
      expect(t.avisos, x).toHaveLength(0);
      expect(t.mensajes, x).toHaveLength(1);
      expect(t.mensajes[0]!.cuerpo, x).toMatch(/Pack Completo: 49 Bs/);
      expect(t.mensajes[0]!.cuerpo, x).not.toMatch(/no puedo cancelar un pedido/);
      expect(t.mensajes[0]!.tipo, x).not.toBe('image');
      expect(t.ejecutados.has('Conversar con el modelo'), x).toBe(false);
    }
  });
  it('si el servidor NO cierra el cobro: «cancela ese qr» escala; repetido, sale «Antonio ya recibió tu aviso anterior», NUNCA la alterna genérica', () => {
    const w = conQr({ cancelar: 'cae' });
    const o = hablar(w, ANA, mTexto('no quiero comprar, quiero ver otras opciones'));
    expect(o.avisos).toHaveLength(0);
    const c1 = hablar(w, ANA, mTexto('cancela ese qr'));
    expect(c1.avisos).toHaveLength(1);
    expect(c1.mensajes[0]!.cuerpo).toMatch(/no puedo cancelar un pedido/);
    expect(c1.mensajes[0]!.cuerpo).toMatch(/Le avisé/);
    expect(c1.mensajes[0]!.cuerpo).not.toMatch(/cerré tu pedido/);
    // El segundo aviso del mismo motivo: texto distinto del primero («ya recibió»), no la alterna genérica. (Un tercero idéntico al segundo cae en la alterna por la regla de nunca el mismo texto dos veces.)
    for (const x of ['cancela el qr']) {
      const t = hablar(w, ANA, mTexto(x));
      expect(t.avisos, x).toHaveLength(0);
      expect(t.mensajes[0]!.cuerpo, x).toMatch(/Antonio ya recibió tu aviso anterior/);
      expect(t.mensajes[0]!.cuerpo, x).not.toMatch(/Eso ya te lo conté|Prefiero no repetirte|ya está más arriba/);
      expect(esBotonDeAntonio(t), x).toBe(true);
    }
  });
  it('«no puedes cancelar» (solo o con «dime por favor») sigue derivando a Antonio con aviso y botón; «qué más tengo» solo es el catálogo', () => {
    for (const x of ['no puedes cancelar', 'Entonces no puedes cancelar… dime por favor']) {
      const w = conQr();
      const c = hablar(w, ANA, mTexto(x));
      expect(c.avisos, x).toHaveLength(1);
      expect(esBotonDeAntonio(c), x).toBe(true);
      expect(c.mensajes[0]!.cuerpo, x).toMatch(/Antonio/);
      expect(c.mensajes[0]!.cuerpo, x).not.toMatch(/queda(ó|ron)? cancelad/i);
    }
    const w2 = conQr();
    const o = hablar(w2, ANA, mTexto('qué más tengo'));
    expect(o.avisos).toHaveLength(0);
    expect(o.mensajes[0]!.cuerpo).toMatch(/Pack Completo: 49 Bs/);
  });
  it('(E) un PDF genérico tras una imagen recibe su texto propio (sin «sigo»); dos PDF seguidos, la alterna neutra', () => {
    const w = nuevo();
    const i = hablar(w, ANA, mImagen());
    expect(i.mensajes[0]!.cuerpo).toMatch(/Recibí tu imagen/);
    const d1 = hablar(w, ANA, mDocumento());
    expect(d1.mensajes[0]!.cuerpo).toMatch(/Recibí tu archivo/);
    expect(d1.mensajes[0]!.cuerpo).not.toMatch(/\bsigo\b|tampoco/i);
    const d2 = hablar(w, ANA, mDocumento());
    expect(d2.mensajes[0]!.cuerpo).toMatch(/Ese archivo ya lo recibí/);
    expect(d2.mensajes[0]!.cuerpo).not.toMatch(/\bsigo\b|tampoco/i);
  });
  it('«no quiero comprar» a secas, «ya no lo quiero» y «cancela mi pedido» siguen siendo cancelación: con el servidor caído, escalan', () => {
    for (const x of ['no quiero comprar', 'ya no lo quiero', 'cancela mi pedido']) {
      for (const cancelar of ['cae', { statusCode: 409, body: {} }] as const) {
        const w = conQr({ cancelar });
        const t = hablar(w, ANA, mTexto(x));
        expect(t.avisos, x).toHaveLength(1);
        expect(t.mensajes[0]!.cuerpo, x).toMatch(/no puedo cancelar un pedido/);
        expect(t.mensajes[0]!.cuerpo, x).not.toMatch(/cerré tu pedido/);
        expect(esBotonDeAntonio(t), x).toBe(true);
      }
    }
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
    expect(esBotonDeAntonio(t)).toBe(false);
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

describe('revisión de #588', () => {
  it('(1) un audio «ya pagué» o «ya cancelé» tras un comprobante recibe la derivación de no entrega con aviso, NO «tu nota de voz fue muy corta»', () => {
    for (const voz of ['ya pagué', 'ya cancelé']) {
      const w = nuevo({ panel: panelConQr(49), medio: { clasificacion: COMPROBANTE, transcripcion: voz }, cotejo: COTEJO_VALIDO });
      hablar(w, ANA, { type: 'image', image: { id: 'media-img', mime_type: 'image/jpeg' } });
      w.dobles['Traer configuración'] = () => panelOk();
      w.avanzar(31);
      const t = hablar(w, ANA, mAudio());
      expect(t.mensajes[0]!.cuerpo, voz).not.toMatch(/muy corta/);
      expect(t.mensajes[0]!.cuerpo, voz).toMatch(/Antonio revisa los comprobantes/);
      expect(t.avisos, voz).toHaveLength(1);
      expect(esBotonDeAntonio(t), voz).toBe(true);
    }
  });
  it('(2) cancelación: «cancelo el pedido», «me arrepentí, lo cancelo», «cancela ese qr» cancelan; «cancelé», «cancelado» y «ya cancelé el libro» son PAGO y no cancelan', () => {
    for (const x of ['cancelo el pedido', 'me arrepentí, lo cancelo', 'cancela ese qr', 'quiero anular la compra']) {
      const w = conQr({ cancelar: 'cae' });
      const t = hablar(w, ANA, mTexto(x));
      expect(t.mensajes[0]!.cuerpo, x).toMatch(/no puedo cancelar un pedido/);
      expect(t.avisos, x).toHaveLength(1);
    }
    for (const x of ['cancelé', 'ya está cancelado', 'ya cancelé el libro', 'cancelamos ayer el pack']) {
      const w = conQr();
      const t = hablar(w, ANA, mTexto(x));
      expect(t.mensajes[0]!.cuerpo, x).not.toMatch(/no puedo cancelar un pedido/);
      expect(t.mensajes[0]!.cuerpo, x).toMatch(/Ya tienes un QR abierto/);
    }
  });
  it('(3) sin configuración con una imagen: el aviso dice «posible comprobante» y no copia el texto del cliente', () => {
    const w = nuevo({ panel: 'cae', medio: { clasificacion: COMPROBANTE } });
    const t = hablar(w, ANA, { type: 'image', image: { id: 'media-img', mime_type: 'image/jpeg', caption: 'TEXTO-DEL-CLIENTE-123' } });
    expect(t.avisos).toHaveLength(1);
    expect(t.avisos[0]!.cuerpo).toMatch(/envió una imagen \(posible comprobante\) mientras la configuración no estaba disponible/);
    expect(t.avisos[0]!.cuerpo).not.toContain('TEXTO-DEL-CLIENTE-123');
  });
  it('(4) un primer audio corto lleva la presentación fija y luego el texto de repetir, en UN mensaje con párrafos separados; el segundo no se vuelve a presentar', () => {
    const w = nuevo({ medio: { transcripcion: 'eh' } });
    const a = hablar(w, ANA, mAudio());
    expect(a.mensajes).toHaveLength(1);
    expect(a.mensajes[0]!.cuerpo).toMatch(/^¡Hola![^\n]*asistente virtual de Antonio Dauber\.\n\n[\s\S]*muy corta/);
    const b = hablar(w, ANA, mAudio());
    expect(b.mensajes[0]!.cuerpo).not.toMatch(/asistente virtual/);
  });
  it('(5) la reversión con un ultimoHash previo NO vacío: el turno cuyo envío falla deja hash y firma como estaban', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    const antes = { h: fichaDe(w)['ultimoHash'], f: fichaDe(w)['ultimaFirma'] };
    expect(antes.h).toMatch(/^[0-9a-f]{8}$/);
    const falla = () => ({ error: { message: '(#131053) Media upload error', code: 131053 } });
    w.dobles['Enviar a WhatsApp'] = falla;
    w.dobles['Enviar respaldo'] = falla;
    const t = hablar(w, ANA, mTexto('¿qué vendes?'), { toleraFallo: true });
    expect(t.fallo).not.toBeNull();
    expect({ h: fichaDe(w)['ultimoHash'], f: fichaDe(w)['ultimaFirma'] }).toEqual(antes);
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
