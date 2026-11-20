/**
 * REVISIÓN DEL PR #1020 (Walisuma, fase 1): lo que pidieron el revisor y seguridad. Se prueba NEGANDO.
 *   1. Prohibición 4: «¿es usted un robot?» y sus variantes reciben el texto fijo que SÍ dice que es una IA; el modelo que se presenta como persona no sale.
 *   2. La captura del NIT tras el pago es acotada: teléfonos, direcciones, pedidos y «no necesito nada más» no son NIT ni «sin factura».
 *   3. Sin factura pendiente, «NIT …» no promete pedirla al confirmar: pasa con nuestra encargada; un número largo no llega crudo al modelo.
 *   4. El NIT no viaja en el reporte del mensaje entrante.
 *   5. Ningún texto que puede llegar al cliente tutea (puerta, uso extendido, fuera de país, baja, errores, fijos).
 *   8. 10 imágenes de un comprobante sin cotejar dan UN solo aviso.
 *  11. Más de una exclamación del modelo no sale.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo, ResultadoTurno } from '../../lib/n8n-de-mentira';
import { ANA, COMPROBANTE, ENTREGA, EXTRANJERO, cotejoValidoConCodigo, crear, hablar, mAudio, mDocumento, mImagen, mSticker, mTexto, modelo, panelConQr, panelOk, textos, type Opciones } from './mundo';

const TUTEO = /\b(te|tu|tus|ti|contigo|cuéntame|escríbeme|envíame|escríbele|quieres|puedes|tienes|pagues|pagas|recoges|confirmes|necesitas|deseas|gustaría|atenderte|paciencia tuya)\b/i;
const corrio = (t: ResultadoTurno, n: string): boolean => t.registro.some((r) => r.nodo === n);
const boton = (t: ResultadoTurno): boolean => t.mensajes.some((x) => (x.payload['interactive'] as J | undefined)?.['type'] === 'cta_url');
const fichaDe = (m: Mundo): J => ((m.sd['walisuma'] ?? {}) as J)[ANA];

describe('1 · prohibición 4: la pregunta por la identidad, en usted y con errores de tipeo', () => {
  for (const p of ['¿Es usted un robot?', '¿es usted una persona?', '¿Me atiende una persona?', 'erez un bot', '¿Estoy chateando con una máquina?', '¿hablo con un humano?', '¿Es automático?', '¿Es usted real?']) {
    it(`«${p}»: el texto fijo que dice «inteligencia artificial», sin modelo`, () => {
      const t = hablar(crear({ modeloDice: modelo('Soy Carla, del equipo de ventas.') }), ANA, mTexto(p));
      expect(textos(t).join(' ')).toMatch(/inteligencia artificial/);
      expect(corrio(t, 'Conversar con el modelo')).toBe(false);
    });
  }
  it('control: «¿es cuero real?» o «¿es para una persona?» siguen a la conversación', () => {
    for (const p of ['¿es cuero real?', '¿es para una persona mayor?']) expect(corrio(hablar(crear({ modeloDice: modelo('Con gusto.') }), ANA, mTexto(p)), 'Conversar con el modelo'), p).toBe(true);
  });
  for (const falso of ['Soy Carla, del equipo de ventas.', 'Le atiende una asesora de la tienda.', 'Le atiende nuestra encargada en este momento.', 'Me llamo Carla y con gusto le ayudo.', 'Le saluda Carla, de ventas.']) {
    it(`NEGADO: el modelo diciendo «${falso}» no sale (negación implícita de ser una IA)`, () => {
      const t = hablar(crear({ modeloDice: modelo(falso) }), ANA, mTexto('hola, busco un regalo'));
      expect(textos(t).join(' ')).not.toContain(falso);
      expect(textos(t).join(' ')).not.toMatch(/Carla|le atiende (una|nuestra)/i);
    });
  }
  it('control: «soy el asistente de atención y ventas» y la derivación fija SÍ salen', () => {
    const t = hablar(crear({ modeloDice: modelo('Con gusto le ayudamos a elegir.') }), ANA, mTexto('hola'));
    expect(textos(t)[0]).toMatch(/soy el asistente de atención y ventas/);
    expect(textos(hablar(crear(), ANA, mTexto('quiero hablar con una persona'))).join(' ')).toMatch(/esto lo atiende directamente nuestra encargada/);
  });
});

/** Un mundo con el pedido ya confirmado («Pedido confirmado» y la factura pedida). */
function pagado(o: Opciones = {}): Mundo {
  const m = crear({ modeloDice: modelo('Con gusto, lo anotamos.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA }), medio: { clasificacion: COMPROBANTE }, cotejo: cotejoValidoConCodigo(450), ...o });
  hablar(m, ANA, mTexto('una billetera'));
  hablar(m, ANA, mTexto('quiero pagar'));
  m.dobles['Traer configuración'] = () => panelConQr(450);
  const t = hablar(m, ANA, mImagen({ caption: '' }));
  expect(t.mensajes[0]?.cuerpo.startsWith('Pedido confirmado')).toBe(true);
  m.dobles['Traer configuración'] = () => panelOk();
  return m;
}

describe('2 · la captura del NIT tras el pago es acotada', () => {
  for (const no of ['mi teléfono es 71234567', 'envío a calle Pinilla 12345', 'quiero otro pedido de 2 billeteras 123456', 'no necesito nada más, gracias']) {
    it(`NEGADO: «${no}» no es NIT ni «sin factura»: la factura sigue pedida`, () => {
      const m = pagado();
      const t = hablar(m, ANA, mTexto(no));
      expect(t.avisos.filter((a) => /datos de factura/.test(JSON.stringify(a.payload)))).toHaveLength(0);
      expect(fichaDe(m)['ultimoPedido']['factura']).toBe('pedida');
    });
  }
  it('un mensaje que es SOLO nombre y número sí se toma como datos de factura', () => {
    const m = pagado();
    const t = hablar(m, ANA, mTexto('Mariana Quiroga 482910301'));
    expect(JSON.stringify(t.avisos[0]?.payload)).toContain('482910301');
    expect(fichaDe(m)['ultimoPedido']['factura']).toBe('dada');
  });
  it('NEGADO: pasada la ventana (24 h desde «Pedido confirmado»), «NIT 4455667» ya no se captura: pasa con nuestra encargada', () => {
    const m = pagado();
    const f = fichaDe(m); f['ultimoPedido']['ms'] = Number(f['ultimoPedido']['ms']) - 25 * 60 * 60 * 1000;
    const t = hablar(m, ANA, mTexto('NIT 4455667'));
    expect(t.avisos.filter((a) => /datos de factura/.test(JSON.stringify(a.payload)))).toHaveLength(0);
    expect(boton(t)).toBe(true);
  });
});

describe('3 · sin factura pendiente, «NIT …» no promete pedirla al confirmar', () => {
  it('con la factura ya dada: «NIT …» pasa con nuestra encargada (botón), sin «le pediremos»', () => {
    const m = pagado();
    hablar(m, ANA, mTexto('NIT: 482910301, Mariana Quiroga'));
    const t = hablar(m, ANA, mTexto('perdón, el NIT correcto es 482910302'));
    expect(boton(t)).toBe(true);
    expect(textos(t).join(' ')).not.toMatch(/le pediremos/);
  });
  it('con «sin factura»: igual', () => {
    const m = pagado();
    hablar(m, ANA, mTexto('a mi nombre nomás'));
    const t = hablar(m, ANA, mTexto('mejor sí, NIT 482910301'));
    expect(boton(t)).toBe(true);
    expect(textos(t).join(' ')).not.toMatch(/le pediremos/);
  });
  it('NEGADO: «Mariana Quiroga 482910301» sin factura pendiente no llega crudo al modelo (5+ dígitos enmascarados); un celular sí pasa', () => {
    let cuerpo = '';
    const m = crear({ modeloDice: (ll) => { cuerpo = JSON.stringify(ll.cuerpo); return modelo('Con gusto.'); } });
    hablar(m, ANA, mTexto('Mariana Quiroga 482910301'));
    expect(cuerpo).not.toContain('482910301');
    expect(cuerpo).toContain('[nº]');
    hablar(m, ANA, mTexto('mi celular es 71234567'));
    expect(cuerpo).toContain('71234567');
  });
});

describe('4 · el NIT no viaja en el reporte del mensaje entrante', () => {
  const reporte = (t: ResultadoTurno): string => String(t.registro.find((r) => r.nodo === 'Reportar mensaje (entrante)')?.cuerpo?.['texto'] ?? '');
  it('NEGADO: «Razón social: Mariana Quiroga, NIT: 482910301» se reporta con el número enmascarado', () => {
    const t = hablar(pagado(), ANA, mTexto('Razón social: Mariana Quiroga, NIT: 482910301'));
    expect(reporte(t)).not.toContain('482910301');
    expect(reporte(t)).toMatch(/NIT: \[nº\]/);
  });
  it('NEGADO: antes del pago, «mi NIT es 4455667» tampoco llega al reporte', () => {
    expect(reporte(hablar(crear(), ANA, mTexto('quiero una billetera, mi NIT es 4455667')))).not.toContain('4455667');
  });
  it('control: un teléfono sin la palabra NIT se reporta tal cual (la entrega lo necesita)', () => {
    expect(reporte(hablar(crear({ modeloDice: modelo('Con gusto.') }), ANA, mTexto('mi celular es 71234567')))).toContain('71234567');
  });
});

describe('tercera pasada · el reporte entrante enmascara SIN etiqueta (seguridad)', () => {
  const reporte = (t: ResultadoTurno): string => String(t.registro.find((r) => r.nodo === 'Reportar mensaje (entrante)')?.cuerpo?.['texto'] ?? '');
  for (const [texto, numero] of [['Juan Pérez 1234567', '1234567'], ['NIT1234567', '1234567'], ['CI1234567', '1234567'], ['N.I.T. 1234567', '1234567'], ['mi documento es 12.345.678', '12.345.678']] as const) {
    it(`NEGADO: «${texto}» no llega con el número al reporte`, () => {
      expect(reporte(hablar(crear({ modeloDice: modelo('Con gusto.') }), ANA, mTexto(texto)))).not.toContain(numero);
    });
  }
  it('control: el celular y el código WAL quedan visibles; el número de puerta corto también; no se cruza un salto de línea', () => {
    const r = reporte(hablar(crear({ modeloDice: modelo('Con gusto.') }), ANA, mTexto('mi pedido WAL-261005-001, Av. Arce 2132\n71234567')));
    expect(r).toContain('WAL-261005-001');
    expect(r).toContain('2132');
    expect(r).toContain('71234567');
  });
});

describe('tercera pasada · la guarda del aviso del comprobante tiene su propia marca (seguridad)', () => {
  it('una consulta reciente NO silencia el aviso de un comprobante que no se pudo cotejar', () => {
    const m = crear({ modeloDice: modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA }), medio: { clasificacion: COMPROBANTE }, cotejo: 'cae' });
    hablar(m, ANA, mTexto('una billetera'));
    hablar(m, ANA, mTexto('quiero pagar'));
    expect(hablar(m, ANA, mTexto('quiero hablar con una persona')).avisos).toHaveLength(1);
    m.dobles['Traer configuración'] = () => panelConQr(450);
    const t = hablar(m, ANA, mImagen({ caption: '' }));
    expect(t.avisos).toHaveLength(1);
    expect(JSON.stringify(t.avisos[0]?.payload)).toMatch(/no se pudo cotejar/);
  });
});

describe('tercera pasada · negación implícita con nombre propio (texto sin normalizar)', () => {
  for (const falso of ['Soy Carla.', 'Hola, soy Carla 😊', 'Soy Carla, asesora de Walisuma', 'Le saluda Carla', 'Le atiende Carla.', 'Aquí le atiende Carla con gusto.']) {
    it(`NEGADO: «${falso}» no sale`, () => {
      expect(textos(hablar(crear({ modeloDice: modelo(falso) }), ANA, mTexto('hola'))).join(' ')).not.toMatch(/Carla/);
    });
  }
  for (const bien of ['Me llamó la atención su pregunta: la bufanda es de vicuña.', 'Soy el asistente de atención y ventas de la tienda.', 'Le atiende nuestro catálogo con piezas de vicuña.']) {
    it(`control: «${bien}» sale`, () => {
      expect(textos(hablar(crear({ modeloDice: modelo(bien) }), ANA, mTexto('hola'))).join(' ')).toContain(bien);
    });
  }
});

describe('tercera pasada · regresiones de la factura y de los números', () => {
  for (const sí of ['NIT 4455667 para mi pedido', 'NIT 4455667, gracias por el envío', 'Textiles Zona Sur SRL NIT 4455667', 'NIT1234567 Ana Pérez']) {
    it(`con etiqueta, «${sí}» SÍ son datos de factura (sin bucle de pedirlos otra vez)`, () => {
      const m = pagado();
      const t = hablar(m, ANA, mTexto(sí));
      expect(fichaDe(m)['ultimoPedido']['factura']).toBe('dada');
      expect(t.avisos).toHaveLength(1);
    });
  }
  it('NEGADO: «Ana 71234567» (celular) no es NIT', () => {
    const m = pagado();
    hablar(m, ANA, mTexto('Ana 71234567'));
    expect(fichaDe(m)['ultimoPedido']['factura']).toBe('pedida');
  });
  it('antes del modelo cada grupo de cifras se mira por separado: puerta y celular pasan; «2 2412345» enmascara solo el grupo largo', () => {
    let cuerpo = '';
    const m = crear({ modeloDice: (ll) => { cuerpo = String(((ll.cuerpo as J)['contents'] as J[]).slice(-1)[0]?.['parts']?.[0]?.text ?? ''); return modelo('Con gusto.'); } });
    hablar(m, ANA, mTexto('Av. Arce 2132\n71234567'));
    expect(cuerpo).toContain('2132');
    expect(cuerpo).toContain('71234567');
    hablar(m, ANA, mTexto('al 71234567 2 unidades'));
    expect(cuerpo).toContain('71234567 2 unidades');
    hablar(m, ANA, mTexto('mi fijo es 2 2412345'));
    expect(cuerpo).toContain('2 [nº]');
  });
  for (const p of ['¿es una persona de La Paz quien teje?', '¿quién me atiende en la tienda?', '¿es un programa de descuentos?', '¿es una máquina de coser la que usan?']) {
    it(`control: «${p}» no recibe el texto de identidad`, () => {
      expect(corrio(hablar(crear({ modeloDice: modelo('Con gusto.') }), ANA, mTexto(p)), 'Conversar con el modelo')).toBe(true);
    });
  }
  for (const p of ['¿es usted una persona?', '¿me atiende una persona?', '¿eres un bot?', '¿eres un robot o una persona?']) {
    it(`«${p}» sí recibe el texto de identidad`, () => {
      expect(textos(hablar(crear(), ANA, mTexto(p))).join(' ')).toMatch(/inteligencia artificial/);
    });
  }
});

describe('5 · ningún texto que puede llegar al cliente tutea', () => {
  const USTED = modelo('Con gusto le ayudamos.');
  const casos: [string, () => ResultadoTurno][] = [
    ['saludo y conversación', () => hablar(crear({ modeloDice: USTED }), ANA, mTexto('hola'))],
    ['uso extendido (texto por defecto de la puerta)', () => hablar(crear({ ingesta: { atencion: { estado: 'operador' } } }), ANA, mTexto('hola'))],
    ['comercio suspendido', () => hablar(crear({ panel: { statusCode: 409, body: {} } }), ANA, mTexto('hola'))],
    ['fuera de país', () => hablar(crear({ base: { prefijosPermitidos: '591' } }), EXTRANJERO, mTexto('hola'))],
    ['baja', () => hablar(crear(), ANA, mTexto('no me escriban más'))],
    ['modelo caído', () => hablar(crear({ modeloDice: 'cae' }), ANA, mTexto('hola'))],
    ['sin catálogo', () => hablar(crear({ panel: 'cae' }), ANA, mTexto('hola'))],
    ['sticker', () => hablar(crear(), ANA, mSticker())],
    ['audio no entendido', () => hablar(crear({ medio: { transcripcion: null } }), ANA, mAudio())],
    ['documento', () => hablar(crear({ medio: { clasificacion: { categoria: 'otro', texto: '' } } }), ANA, mDocumento())],
    ['imagen', () => hablar(crear({ medio: { clasificacion: { categoria: 'otro', texto: '' } } }), ANA, mImagen())],
    ['identidad', () => hablar(crear(), ANA, mTexto('¿es usted un bot?'))],
    ['derivación', () => hablar(crear(), ANA, mTexto('quiero hablar con una persona'))],
    ['comprobante sin pedido', () => hablar(crear({ medio: { clasificacion: COMPROBANTE } }), ANA, mImagen({ caption: '' }))],
  ];
  for (const [nombre, turno] of casos) {
    it(`${nombre}: sin tuteo (cuerpo y respaldo)`, () => {
      const t = turno();
      expect(t.mensajes.length, nombre).toBeGreaterThan(0);
      for (const x of t.mensajes) {
        expect(x.cuerpo ?? '', nombre).not.toMatch(TUTEO);
        expect(typeof x.respaldo === 'string' ? x.respaldo : '', nombre).not.toMatch(TUTEO);
      }
    });
  }
  it('el uso extendido usa el texto de Walisuma, de usted', () => {
    const t = hablar(crear({ ingesta: { atencion: { estado: 'operador' } } }), ANA, mTexto('hola'));
    expect(t.mensajes[0]?.cuerpo).toMatch(/Gracias por su paciencia/);
  });
});

describe('8 · la guarda del aviso de un comprobante sin cotejar', () => {
  it('10 imágenes seguidas de un comprobante que no se puede cotejar dan UN solo aviso', () => {
    const m = crear({ modeloDice: modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA }), medio: { clasificacion: COMPROBANTE }, cotejo: 'cae' });
    hablar(m, ANA, mTexto('una billetera'));
    hablar(m, ANA, mTexto('quiero pagar'));
    m.dobles['Traer configuración'] = () => panelConQr(450);
    let avisos = 0;
    for (let i = 0; i < 10; i++) avisos += hablar(m, ANA, mImagen({ caption: '' })).avisos.length;
    expect(avisos).toBe(1);
  });
});

describe('11 · más de una exclamación del modelo no sale', () => {
  it('NEGADO: «¡Qué bonita elección! ¡Le encantará!» cae al texto fijo; una sola exclamación sí sale', () => {
    expect(textos(hablar(crear({ modeloDice: modelo('¡Qué bonita elección! ¡Le encantará!') }), ANA, mTexto('hola'))).join(' ')).not.toMatch(/Le encantará/);
    expect(textos(hablar(crear({ modeloDice: modelo('¡Qué bonita elección! ¿Qué color prefiere?') }), ANA, mTexto('hola'))).join(' ')).toMatch(/Qué bonita elección/);
  });
});

describe('el historial que se le manda al modelo va en el formato que se le pide (20/11/2026)', () => {
  // El historial con las respuestas en TEXTO PLANO hacía que el modelo imitara el texto plano y respondiera sin JSON: 17 de 20 respuestas
  // de una batería real salieron «tuvimos un inconveniente» y avisaron a recepción. Las respuestas anteriores del modelo van como `{"texto": …}`.
  it('las respuestas anteriores del modelo viajan como JSON {"texto"} y las del cliente en texto', () => {
    let contenidos: { role: string; parts: { text: string }[] }[] = [];
    const m = crear({ modeloDice: (ll) => { contenidos = (ll.cuerpo as J)['contents'] as typeof contenidos; return modelo('Con gusto le muestro piezas.'); } });
    hablar(m, ANA, mTexto('hola'));
    hablar(m, ANA, mTexto('que piezas tienen'));
    const previa = contenidos.filter((c) => c.role === 'model');
    expect(previa.length).toBeGreaterThan(0);
    for (const c of previa) expect(JSON.parse(c.parts[0]!.text)).toEqual({ texto: expect.any(String) });
    expect(contenidos.filter((c) => c.role === 'user')[0]!.parts[0]!.text).not.toMatch(/^\{/);
  });
});

describe('la llamada al modelo exige el esquema de la respuesta (20/11/2026)', () => {
  // Sin esquema, 2 de cada 20 respuestas de una batería real salían en texto plano y el cliente recibía «tuvimos un inconveniente».
  it('generationConfig lleva responseMimeType JSON y un responseSchema con los campos del prompt', () => {
    let cfg: Record<string, any> = {};
    const m = crear({ modeloDice: (ll) => { cfg = ((ll.cuerpo as J)['generationConfig'] ?? {}) as typeof cfg; return modelo('Con gusto.'); } });
    hablar(m, ANA, mTexto('que piezas tienen'));
    expect(cfg['responseMimeType']).toBe('application/json');
    const e = cfg['responseSchema'];
    expect(e?.type).toBe('OBJECT');
    expect(Object.keys(e.properties).sort()).toEqual(['entrega', 'facturacion', 'lineas', 'quiereHablar', 'texto']);
    expect(e.required).toEqual(['texto']);
  });
});
