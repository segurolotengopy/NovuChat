/**
 * «EL PUENTE» DE ANTONIO — EL GMAIL TRAS UNA VENTA CONFIRMADA (10/11/2026, decisiones D1 y D2 de Andres).
 *
 * Tras un comprobante que CUADRA con el aviso a Antonio ya salido, el mensaje de «los datos coinciden» pide SOLO el correo de Gmail del cliente. El código lo lee del texto literal (`vgExtraerGmail`),
 * lo guarda y avisa a Antonio con el correo para que le envíe el enlace de Drive por el chat. El modelo no ve ni produce el correo.
 *
 * ESTA SUITE ESCRIBE NEGANDO: sin comprobante que cuadre y sin aviso salido no se pide; solo `@gmail.com`; un audio o una imagen no capturan el correo; el modelo no inventa correos ni promete entregas
 * aunque la barrera ya no rechace las palabras «correo» y «gmail»; ningún texto dice «ya se compartió», plazos ni «pago acreditado/verificado».
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo, ResultadoTurno } from '../../lib/n8n-de-mentira';
import { COMPROBANTE, COTEJO_VALIDO, ANA, REC, crear, hablar, mAudio, mImagen, mTexto, panelConQr, type Opciones } from './mundo';
import { vigilarUx } from './vigilante-ux';

const nuevo = (o: Opciones = {}): Mundo => { const w = crear(o); vigilarUx(w); return w; };
const fichaDe = (w: Mundo, tel: string): J => ((w.sd['antonio'] ?? {}) as J)[tel] as J;
const PROHIBIDAS = /acreditad|verificad|validad|recibimos tu pago|pago (?:recibido|confirmado)/i;
const PROMESAS = /ya te compart|compartid|ya te (?:lo )?envi|ya se (?:compartio|envio)|en unos minutos|en \d+ (?:horas?|minutos?)|hoy mismo|pronto|enseguida/i;
const PIDE_GMAIL = /escríbeme tu correo de Gmail \(el que termina en @gmail\.com\)/;
const conComprobante = (o: Opciones = {}): Mundo => nuevo({ panel: panelConQr(49), medio: { clasificacion: COMPROBANTE }, ...o });
const llamadasAlModelo = (t: ResultadoTurno): number => t.registro.filter((r) => r.nodo === 'Conversar con el modelo').length;
const hechos = (w: Mundo): void => { hablar(w, ANA, mImagen()); };

describe('el pedido del Gmail', () => {
  it('comprobante que cuadra con el aviso salido: el MISMO mensaje pide el Gmail (sin plazo ni «acreditado») y la ficha recuerda que se pidió', () => {
    const w = conComprobante();
    const t = hablar(w, ANA, mImagen());
    expect(t.mensajes).toHaveLength(1);
    const tx = t.mensajes[0]!.cuerpo;
    expect(tx).toMatch(/Recibí tu comprobante y los datos coinciden con tu compra/);
    expect(tx).toMatch(/él te enviará el material por este chat\./);
    expect(tx).toMatch(PIDE_GMAIL);
    expect(tx).not.toMatch(PROHIBIDAS);
    expect(tx).not.toMatch(PROMESAS);
    expect(fichaDe(w, ANA)['gmailPedidoMs']).toBeGreaterThan(0);
    expect(fichaDe(w, ANA)['gmail']).toBe('');
  });

  it('NO se pide con «aproximado», «sin cotejar» ni con el aviso fallido', () => {
    const casos: Opciones[] = [
      { cotejo: { statusCode: 200, body: { estado: 'aproximado', motivo: 'monto_distinto', avisarComercio: true } } },
      { cotejo: 'cae' },
      { aviso: 'error' },
    ];
    for (const c of casos) {
      const w = conComprobante(c);
      const t = hablar(w, ANA, mImagen());
      expect(t.mensajes[0]!.cuerpo).not.toMatch(/Gmail|correo/i);
      expect(fichaDe(w, ANA)['gmailPedidoMs']).toBe(0);
    }
  });

  it('si Meta no entrega el mensaje que pide el Gmail, la marca de «ya se pidió» se restaura', () => {
    const w = conComprobante({ envio: { 'Enviar a WhatsApp': 'error', 'Enviar respaldo': 'error' } });
    hablar(w, ANA, mImagen(), { toleraFallo: true });
    expect(fichaDe(w, ANA)['gmailPedidoMs']).toBe(0);
  });
});

describe('la captura del Gmail', () => {
  it('con el Gmail pedido: «juanito@gmail.com» da UN mensaje, UN aviso a Antonio con el correo literal, queda en la ficha y el modelo no corre', () => {
    const w = conComprobante();
    hechos(w);
    const t = hablar(w, ANA, mTexto('Mi correo es Juanito@Gmail.com'));
    expect(t.fallo).toBeNull();
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]!.cuerpo).toBe('Gracias. Le pasé tu correo a Antonio para que te envíe el enlace.');
    expect(t.mensajes[0]!.cuerpo).not.toMatch(PROMESAS);
    expect(t.avisos).toHaveLength(1);
    expect(t.avisos[0]!.a).toBe(REC);
    expect(JSON.stringify(t.avisos[0]!.payload)).toContain('juanito@gmail.com');
    expect(fichaDe(w, ANA)['gmail']).toBe('juanito@gmail.com');
    expect(llamadasAlModelo(t)).toBe(0);
    expect(JSON.stringify(fichaDe(w, ANA)['hist'] ?? [])).not.toContain('gmail.com');
  });

  it('el aviso fuera de la ventana de Antonio usa la plantilla de consulta y el tercer parámetro trae «Gmail: <correo>» exacto', () => {
    const w = conComprobante();
    hechos(w);
    const t = hablar(w, ANA, mTexto('juanito@gmail.com'));
    const a = t.avisos[0]!;
    expect(a.tipo).toBe('template');
    const params = a.payload['template'].components[0].parameters.map((p: J) => String(p['text']));
    expect(params).toHaveLength(3);
    expect(params[0]).toMatch(/^venta con comprobante de .+: enviar el enlace de Drive por el chat$/);
    expect(params[1]).toBe(`+${ANA}`);
    expect(params[2]).toBe('Gmail: juanito@gmail.com');
  });

  it('el aviso dentro de la ventana de Antonio es texto libre: pide enviar el enlace de Drive por el chat (no «comparte desde tu Drive») y trae el correo', () => {
    const w = conComprobante();
    hablar(w, REC, mTexto('hola'));
    hechos(w);
    const t = hablar(w, ANA, mTexto('juanito@gmail.com'));
    const a = t.avisos[0]!;
    expect(a.tipo).toBe('text');
    expect(a.cuerpo).toMatch(/Gmail: juanito@gmail\.com\. Envíale el enlace de Drive por este chat\./);
    expect(a.cuerpo).not.toMatch(/comparte/i);
    expect(a.cuerpo).not.toMatch(PROHIBIDAS);
  });

  it('un correo que NO es de Gmail, mal escrito o más de uno: se pide de nuevo, sin aviso y sin guardar nada', () => {
    const casos: Array<[string, RegExp]> = [
      ['x@hotmail.com', /no es de Gmail/],
      ['x@googlemail.com', /no es de Gmail/],
      ['a..b@gmail.com', /No pude leer bien ese correo/],
      ['juanito@gmail.com y anabel@gmail.com', /más de un correo/],
    ];
    for (const [texto, esperado] of casos) {
      const w = conComprobante();
      hechos(w);
      const t = hablar(w, ANA, mTexto(texto));
      expect(t.mensajes).toHaveLength(1);
      expect(t.mensajes[0]!.cuerpo).toMatch(esperado);
      expect(t.mensajes[0]!.cuerpo).toMatch(/@gmail\.com/);
      expect(t.avisos).toHaveLength(0);
      expect(fichaDe(w, ANA)['gmail']).toBe('');
      expect(llamadasAlModelo(t)).toBe(0);
    }
  });

  it('sin el pedido previo (no hubo comprobante) un mensaje con un Gmail sigue el flujo normal: ni aviso de Gmail ni captura', () => {
    const w = nuevo();
    const t = hablar(w, ANA, mTexto('mi correo es x@gmail.com'));
    expect(t.avisos.filter((a) => /Gmail/.test(JSON.stringify(a.payload)))).toHaveLength(0);
    expect(fichaDe(w, ANA)['gmail']).toBe('');
  });

  it('un reclamo con un correo dentro NO se captura: sigue el flujo normal y no se pierde el reclamo', () => {
    const w = conComprobante();
    hechos(w);
    const t = hablar(w, ANA, mTexto('No me llegó nada y Antonio no contesta, mi correo es juanito@hotmail.com'));
    expect(t.avisos.filter((a) => /enlace de Drive/.test(JSON.stringify(a.payload)))).toHaveLength(0);
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/no es de Gmail|Le pasé tu correo/);
    expect(fichaDe(w, ANA)['gmail']).toBe('');
    const u = hablar(w, ANA, mTexto('No me llegó nada, mi correo es juanito@gmail.com y quiero mi plata, ya pasaron horas desde el pago'));
    expect(fichaDe(w, ANA)['gmail']).toBe('');
    expect(u.mensajes[0]!.cuerpo).not.toBe('Gracias. Le pasé tu correo a Antonio para que te envíe el enlace.');
  });

  it('un audio o una imagen que «dicen» un correo no lo capturan', () => {
    const w = conComprobante({ medio: { clasificacion: COMPROBANTE, transcripcion: 'mi correo es juan arroba gmail punto com' } });
    hechos(w);
    const t = hablar(w, ANA, mAudio());
    expect(t.avisos).toHaveLength(0);
    expect(fichaDe(w, ANA)['gmail']).toBe('');
    const w2 = conComprobante({ medio: { clasificacion: { ...COMPROBANTE, categoria: 'otro', texto: 'juanito@gmail.com' } } });
    hechos(w2);
    // la segunda imagen ya no es un comprobante: se clasifica como otra cosa y tampoco captura
    const t2 = hablar(w2, ANA, mImagen());
    expect(t2.avisos.filter((a) => /juanito@gmail\.com/.test(JSON.stringify(a.payload)))).toHaveLength(0);
    expect(fichaDe(w2, ANA)['gmail']).toBe('');
  });

  it('un correo inventado por el modelo (el cliente no escribió «@») no se guarda ni se avisa', () => {
    const w = conComprobante({ modeloDice: 'Claro, tu correo es zz@gmail.com, ¿cierto?' });
    hechos(w);
    const t = hablar(w, ANA, mTexto('cuéntame más del método'));
    expect(t.avisos).toHaveLength(0);
    expect(fichaDe(w, ANA)['gmail']).toBe('');
    expect(JSON.stringify(t.mensajes)).not.toContain('zz@gmail.com');
  });

  it('el recibido sin aviso salido: el cliente lee la verdad con el botón y el correo NO queda guardado (un reenvío reintenta)', () => {
    const o: Opciones = { panel: panelConQr(49), medio: { clasificacion: COMPROBANTE } };
    const w = nuevo(o);
    hechos(w);
    o.aviso = 'error'; // el doble de «Enviar aviso» lee la opción en cada llamada: desde aquí el aviso a Antonio falla
    const t = hablar(w, ANA, mTexto('juanito@gmail.com'));
    expect(t.mensajes[0]!.cuerpo).toMatch(/no pude pasárselo a Antonio/);
    expect(t.mensajes[0]!.payload['interactive']?.type).toBe('cta_url');
    expect(t.mensajes[0]!.cuerpo).not.toMatch(PROMESAS);
    expect(fichaDe(w, ANA)['gmail']).toBe('');
    o.aviso = 'acepta';
    const r = hablar(w, ANA, mTexto('juanito@gmail.com'));
    expect(r.mensajes[0]!.cuerpo).toBe('Gracias. Le pasé tu correo a Antonio para que te envíe el enlace.');
    expect(fichaDe(w, ANA)['gmail']).toBe('juanito@gmail.com');
  });

  it('segunda compra con el Gmail ya guardado: no se vuelve a pedir y el aviso del comprobante lo recuerda', () => {
    const w = conComprobante();
    hablar(w, REC, mTexto('hola'));
    hechos(w);
    hablar(w, ANA, mTexto('juanito@gmail.com'));
    const t = hablar(w, ANA, mImagen());
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/Gmail|correo/i);
    expect(JSON.stringify(t.avisos)).toContain('Gmail ya registrado: juanito@gmail.com.');
  });
});

describe('la barrera del modelo tras abrir «correo» y «gmail» (D2)', () => {
  const dichoPorElModelo = (dicho: string): string => {
    const w = nuevo({ modeloDice: dicho });
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mTexto('estamos pasando un momento difícil'));
    return t.mensajes.map((m) => m.cuerpo).join(' ');
  };
  it('lo que sigue rechazado: promesas de entrega en cualquier forma, plazos, «ya te lo envié/compartí» y el estado del pago', () => {
    const textos = [
      'Te envío el material mañana a tu correo.', 'Ya te lo compartí a tu Gmail.', 'Te lo mando en unos minutos a tu correo.', 'Ya te envié el libro por correo.', 'Tu pago fue acreditado y te llega al correo.',
      'Te lo mando al mail', 'Te la mando al correo', 'Te lo envío al Gmail', 'Dime tu correo y te lo envío', 'Te mandaremos todo a tu correo hoy', 'Te llega la invitación a tu Gmail',
      'Vas a recibir una invitación a tu Gmail', 'El acceso te llega por Gmail', 'Revisa tu correo, ahí está todo', 'Revisa tu bandeja de entrada.',
    ];
    for (const dicho of textos) {
      const enviado = dichoPorElModelo(dicho);
      expect(enviado, dicho).not.toBe(dicho);
      expect(enviado, dicho).not.toMatch(PROMESAS);
      expect(enviado, dicho).not.toMatch(PROHIBIDAS);
    }
  });
  it('el modelo no PIDE el correo: solo el texto fijo del comprobante lo pide', () => {
    for (const dicho of ['¿Me pasas tu correo de Gmail?', 'Escríbeme tu correo, por favor.', 'Dime tu gmail.', 'Compárteme tu email.', 'Necesito tu correo para continuar.', 'Mándame tu correo.']) {
      const enviado = dichoPorElModelo(dicho);
      expect(enviado, dicho).not.toBe(dicho);
    }
  });
  it('«correo» y «gmail» como TEMA ya no se rechazan por sí solas', () => {
    const dicho = 'Entiendo, es un tema que te importa. ¿Desde cuándo lo sienten?';
    expect(dichoPorElModelo(dicho).replace(/\s+/g, ' ')).toBe(dicho);
    const conGmail = 'Cada pareja es distinta; mi Gmail no es relevante aquí, cuéntame más de lo que sienten.';
    expect(dichoPorElModelo(conGmail).replace(/\s+/g, ' '), 'el tema «gmail» pasa si no hay verbo de entrega ni pedido').toBe(conGmail);
  });
});
