/**
 * RUBÉN — EL GMAIL TRAS UNA VENTA CONFIRMADA (10/11/2026, decisiones D1 y D2 de Andres).
 *
 * Tras un comprobante que CUADRA con el aviso a Rubén ya salido, el mensaje de «los datos coinciden» pide SOLO el correo de Gmail del cliente. El código lo lee del texto literal (`vgExtraerGmail`),
 * lo guarda y avisa a Rubén con el correo para que le envíe el enlace de Drive por el chat. El modelo no ve ni produce el correo.
 *
 * ESTA SUITE ESCRIBE NEGANDO: sin comprobante que cuadre y sin aviso salido no se pide; solo `@gmail.com`; un audio o una imagen no capturan el correo; un mensaje que no es básicamente el correo no se captura;
 * el modelo no inventa, no pide correos ni promete entregas aunque la barrera ya no rechace las palabras «correo» y «gmail»; ningún texto dice «ya se compartió», plazos ni «pago acreditado/verificado».
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo, ResultadoTurno } from '../../lib/n8n-de-mentira';
import { COMPROBANTE, ANA, REC, crear, hablar, mAudio, mBoton, mImagen, mTexto, panelConQr, type Opciones } from './mundo';
import { cargarLibrerias } from './librerias';
import { vigilarUx } from './vigilante-ux';

const nuevo = (o: Opciones = {}): Mundo => { const w = crear(o); vigilarUx(w); return w; };
const fichaDe = (w: Mundo, tel: string): J => ((w.sd['ruben'] ?? {}) as J)[tel] as J;
const PROHIBIDAS = /acreditad|verificad|validad|recibimos tu pago|pago (?:recibido|confirmado)/i;
const PROMESAS = /ya te compart|compartid|ya te (?:lo )?envi|ya se (?:compartio|envio)|en unos minutos|en \d+ (?:horas?|minutos?)|hoy mismo|pronto|enseguida/i;
const PIDE_GMAIL = /escríbeme tu correo de Gmail \(el que termina en @gmail\.com\)/;
const conComprobante = (o: Opciones = {}): Mundo => nuevo({ panel: panelConQr(70), medio: { clasificacion: COMPROBANTE }, ...o });
const llamadasAlModelo = (t: ResultadoTurno): number => t.registro.filter((r) => r.nodo === 'Conversar con el modelo').length;
const hechos = (w: Mundo): void => { hablar(w, ANA, mImagen()); };
/** Una compra del Pack con el QR emitido (el producto queda en la ficha) y un comprobante que cuadra. */
const compraDelPack = (o: Opciones = {}): Mundo => {
  const w = nuevo({ medio: { clasificacion: COMPROBANTE }, ...o });
  hablar(w, ANA, mBoton('b_pack'));
  w.dobles['Traer configuración'] = () => panelConQr(70);
  return w;
};

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

  it('el comprobante de un LIBRO que cuadra: el MISMO mensaje trae el pedido del Gmail, el párrafo del cambio al Pack va AL FINAL y su botón sigue siendo el único', () => {
    const w = nuevo({ medio: { clasificacion: COMPROBANTE } });
    hablar(w, ANA, mBoton('b_libro'));
    w.dobles['Traer configuración'] = () => panelConQr(35);
    const t = hablar(w, ANA, mImagen());
    expect(t.mensajes).toHaveLength(1);
    const tx = t.mensajes[0]!.cuerpo;
    expect(tx).toMatch(PIDE_GMAIL);
    expect(tx).toMatch(/puedes pasar al Pack por 35 Bs más/);
    expect(tx.indexOf('Gmail')).toBeLessThan(tx.indexOf('puedes pasar al Pack'));
    expect(tx.trimEnd().endsWith('Gmail (el que termina en @gmail.com).')).toBe(false);
    expect(((t.mensajes[0]!.payload['interactive']?.action?.buttons ?? []) as J[]).map((b) => String(b['reply']?.id))).toEqual(['b_upgrade']);
    expect(tx).not.toMatch(PROHIBIDAS);
    expect(fichaDe(w, ANA)['gmailPedidoMs']).toBeGreaterThan(0);
  });
});

describe('la captura del Gmail', () => {
  it('con el Gmail pedido: «juanperez@gmail.com» da UN mensaje, UN aviso a Rubén con el correo literal, queda en la ficha y el modelo no corre', () => {
    const w = conComprobante();
    hechos(w);
    const t = hablar(w, ANA, mTexto('Mi correo es JuanPerez@Gmail.com'));
    expect(t.fallo).toBeNull();
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]!.cuerpo).toBe('Gracias. Le pasé tu correo a Rubén para que te envíe el enlace.');
    expect(t.mensajes[0]!.cuerpo).not.toMatch(PROMESAS);
    expect(t.avisos).toHaveLength(1);
    expect(t.avisos[0]!.a).toBe(REC);
    expect(JSON.stringify(t.avisos[0]!.payload)).toContain('juanperez@gmail.com');
    expect(fichaDe(w, ANA)['gmail']).toBe('juanperez@gmail.com');
    expect(llamadasAlModelo(t)).toBe(0);
    expect(JSON.stringify(fichaDe(w, ANA)['hist'] ?? [])).not.toContain('gmail.com');
  });

  it('el aviso fuera de la ventana de Rubén usa la plantilla de consulta: el producto va en el motivo y el tercer parámetro es EXACTAMENTE «Gmail: <correo>»', () => {
    const w = compraDelPack();
    hechos(w);
    const t = hablar(w, ANA, mTexto('juanperez@gmail.com'));
    const a = t.avisos[0]!;
    expect(a.tipo).toBe('template');
    const params = a.payload['template'].components[0].parameters.map((p: J) => String(p['text']));
    expect(params).toHaveLength(3);
    expect(params[0]).toMatch(/^venta con comprobante de .+: enviar el enlace de Drive por el chat$/);
    expect(params[1]).toBe(`+${ANA}`);
    expect(params[2]).toBe('Gmail: juanperez@gmail.com');
  });

  it('sin producto en la ficha, el motivo de la plantilla es genérico (sin «de sin producto»)', () => {
    const w = conComprobante();
    hechos(w);
    const t = hablar(w, ANA, mTexto('juanperez@gmail.com'));
    const params = t.avisos[0]!.payload['template'].components[0].parameters.map((p: J) => String(p['text']));
    expect(params[0]).toBe('venta con comprobante: enviar el enlace de Drive por el chat');
    expect(params[2]).toBe('Gmail: juanperez@gmail.com');
  });

  it('«Listo juanito@gmail.com, cuándo me llega?» se captura (pocas palabras) y la respuesta no da plazo', () => {
    const w = conComprobante();
    hechos(w);
    const t = hablar(w, ANA, mTexto('Listo juanito@gmail.com, cuándo me llega?'));
    expect(t.mensajes[0]!.cuerpo).toBe('Gracias. Le pasé tu correo a Rubén para que te envíe el enlace.');
    expect(t.mensajes[0]!.cuerpo).not.toMatch(PROMESAS);
    expect(fichaDe(w, ANA)['gmail']).toBe('juanito@gmail.com');
  });

  it('un correo con caracteres invisibles o una barra final se captura limpio', () => {
    const w = conComprobante();
    hechos(w);
    hablar(w, ANA, mTexto('juani\u200bto@gmail.com/'));
    expect(fichaDe(w, ANA)['gmail']).toBe('juanito@gmail.com');
  });

  it('un correo que NO se captura (no hay pedido, o es un reclamo) no llega al modelo ni a la memoria: se cambia por «[correo]»', () => {
    const w = nuevo();
    hablar(w, ANA, mTexto('hola'));
    const t = hablar(w, ANA, mTexto('quiero contarte algo, mi correo es juanito@hotmail.com y estamos pasando un momento difícil'));
    expect(llamadasAlModelo(t)).toBeGreaterThan(0);
    const alModelo = (x: ResultadoTurno): string => JSON.stringify(x.registro.filter((y) => y.nodo === 'Conversar con el modelo'));
    expect(alModelo(t)).not.toContain('juanito@hotmail.com');
    expect(JSON.stringify(fichaDe(w, ANA)['hist'] ?? [])).not.toContain('juanito@hotmail.com');
    const w2 = conComprobante({ modeloDice: 'Entiendo, cuéntame más.' });
    hechos(w2);
    const r2 = hablar(w2, ANA, mTexto('No me llegó nada y Rubén no contesta, mi correo es juanito@hotmail.com'));
    expect(alModelo(r2)).not.toContain('juanito@hotmail.com');
    expect(JSON.stringify(fichaDe(w2, ANA)['hist'] ?? [])).not.toContain('juanito@hotmail.com');
  });

  it('el Gmail capturado no se reporta a la consola (el reporte entrante dice «[correo]»); Rubén lo recibe en el aviso', () => {
    const w = conComprobante();
    hechos(w);
    const t = hablar(w, ANA, mTexto('juanito@gmail.com'));
    const reportes = JSON.stringify(t.llamadas.ingesta);
    expect(reportes).not.toContain('juanito@gmail.com');
    expect(reportes).toContain('[correo]');
    expect(JSON.stringify(t.avisos[0]!.payload)).toContain('juanito@gmail.com');
  });

  it('el aviso dentro de la ventana de Rubén es texto libre: pide enviar el enlace de Drive por el chat (no «comparte desde tu Drive») y trae el correo', () => {
    const w = conComprobante();
    hablar(w, REC, mTexto('hola'));
    hechos(w);
    const t = hablar(w, ANA, mTexto('juanperez@gmail.com'));
    const a = t.avisos[0]!;
    expect(a.tipo).toBe('text');
    expect(a.cuerpo).toMatch(/Gmail: juanperez@gmail\.com\. Envíale el enlace de Drive por este chat\./);
    expect(a.cuerpo).not.toMatch(/comparte/i);
    expect(a.cuerpo).not.toMatch(PROHIBIDAS);
  });

  it('un correo que NO es de Gmail, mal escrito o más de uno: se pide de nuevo, sin aviso y sin guardar nada', () => {
    const casos: Array<[string, RegExp]> = [
      ['x@hotmail.com', /no es de Gmail/],
      ['x@googlemail.com', /no es de Gmail/],
      ['a..b@gmail.com', /No pude leer bien ese correo/],
      ['juanperez@gmail.com y anagomez@gmail.com', /más de un correo/],
    ];
    for (const [texto, esperado] of casos) {
      const w = conComprobante();
      hechos(w);
      const t = hablar(w, ANA, mTexto(texto));
      expect(t.mensajes).toHaveLength(1);
      expect(t.mensajes[0]!.cuerpo).toMatch(esperado);
      expect(t.mensajes[0]!.cuerpo).toMatch(/@gmail\.com/);
      expect(t.mensajes[0]!.payload['interactive']?.type, texto).toBe('cta_url'); // con el botón para escribirle directo a Rubén
      expect(t.avisos).toHaveLength(0);
      expect(fichaDe(w, ANA)['gmail']).toBe('');
      expect(llamadasAlModelo(t)).toBe(0);
    }
  });

  it('un mensaje que NO es básicamente el correo (reclamo, derivación o texto largo) no se captura: sigue su camino y no guarda ni avisa el Gmail', () => {
    const casos = [
      'no me llegó el material, mi correo es juanperez@gmail.com',
      'quiero hablar con Rubén, escríbeme a juanperez@gmail.com',
      'cancela mi pedido juanperez@gmail.com',
      'te cuento que llevo meses durmiendo muy mal y un amigo me recomendó el método, y mi correo es juanperez@gmail.com',
    ];
    for (const texto of casos) {
      const w = conComprobante();
      hechos(w);
      const t = hablar(w, ANA, mTexto(texto));
      expect(t.mensajes.map((m) => m.cuerpo).join(' '), texto).not.toMatch(/Le pasé tu correo|no es de Gmail|No pude leer bien ese correo/);
      expect(JSON.stringify(t.avisos.map((a) => a.payload)), texto).not.toMatch(/Gmail: juanperez@gmail\.com/);
      expect(fichaDe(w, ANA)['gmail'], texto).toBe('');
    }
  });

  it('sin el pedido previo (no hubo comprobante) un mensaje con un Gmail sigue el flujo normal: ni aviso de Gmail ni captura', () => {
    const w = nuevo();
    const t = hablar(w, ANA, mTexto('mi correo es x@gmail.com'));
    expect(t.avisos.filter((a) => /Gmail/.test(JSON.stringify(a.payload)))).toHaveLength(0);
    expect(fichaDe(w, ANA)['gmail']).toBe('');
  });

  it('un audio o una imagen que «dicen» un correo no lo capturan', () => {
    const w = conComprobante({ medio: { clasificacion: COMPROBANTE, transcripcion: 'mi correo es juan arroba gmail punto com' } });
    hechos(w);
    const t = hablar(w, ANA, mAudio());
    expect(t.avisos).toHaveLength(0);
    expect(fichaDe(w, ANA)['gmail']).toBe('');
    const w2 = conComprobante({ medio: { clasificacion: { ...COMPROBANTE, categoria: 'otro', texto: 'juanperez@gmail.com' } } });
    hechos(w2);
    const t2 = hablar(w2, ANA, mImagen());
    expect(t2.avisos.filter((a) => /juanperez@gmail\.com/.test(JSON.stringify(a.payload)))).toHaveLength(0);
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
    const o: Opciones = { panel: panelConQr(70), medio: { clasificacion: COMPROBANTE } };
    const w = nuevo(o);
    hechos(w);
    o.aviso = 'error'; // el doble de «Enviar aviso» lee la opción en cada llamada: desde aquí el aviso a Rubén falla
    const t = hablar(w, ANA, mTexto('juanperez@gmail.com'));
    expect(t.mensajes[0]!.cuerpo).toMatch(/no pude pasárselo a Rubén/);
    expect(t.mensajes[0]!.payload['interactive']?.type).toBe('cta_url');
    expect(t.mensajes[0]!.cuerpo).not.toMatch(PROMESAS);
    expect(fichaDe(w, ANA)['gmail']).toBe('');
    o.aviso = 'acepta';
    const r = hablar(w, ANA, mTexto('juanperez@gmail.com'));
    expect(r.mensajes[0]!.cuerpo).toBe('Gracias. Le pasé tu correo a Rubén para que te envíe el enlace.');
    expect(fichaDe(w, ANA)['gmail']).toBe('juanperez@gmail.com');
  });

  it('INTENCIONAL: si Meta no entrega la respuesta «Gracias. Le pasé tu correo…», el aviso a Rubén ya salió y el correo queda guardado (no se revierte)', () => {
    const o: Opciones = { panel: panelConQr(70), medio: { clasificacion: COMPROBANTE } };
    const w = nuevo(o);
    hechos(w);
    o.envio = { 'Enviar a WhatsApp': 'error', 'Enviar respaldo': 'error' };
    const t = hablar(w, ANA, mTexto('juanperez@gmail.com'), { toleraFallo: true });
    expect(t.avisos).toHaveLength(1);
    expect(fichaDe(w, ANA)['gmail']).toBe('juanperez@gmail.com');
  });

  it('segunda compra con el Gmail ya guardado: no se vuelve a pedir y el aviso del comprobante lo recuerda', () => {
    const w = conComprobante();
    hablar(w, REC, mTexto('hola'));
    hechos(w);
    hablar(w, ANA, mTexto('juanperez@gmail.com'));
    const t = hablar(w, ANA, mImagen());
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/Gmail|correo/i);
    expect(JSON.stringify(t.avisos)).toContain('Gmail ya registrado: juanperez@gmail.com.');
  });

  it('el prospecto de la planilla del miniCRM no lleva el correo', () => {
    const w = conComprobante();
    hechos(w);
    const t = hablar(w, ANA, mTexto('juanperez@gmail.com'));
    const planilla = JSON.stringify(t.registro.filter((r) => /planilla|crm/i.test(String(r.nodo))));
    expect(planilla).not.toContain('@');
  });
});

describe('la barrera del modelo tras abrir «correo» y «gmail» (D2): solo como tema', () => {
  const L = cargarLibrerias<{ rrExtraRedaccion: (t: string, n: string, c: J) => string; rrNorm: (t: string) => string }>('rrExtraRedaccion, rrNorm');
  const motivo = (t: string): string => L.rrExtraRedaccion(t, L.rrNorm(t), { textoCliente: '' });

  it('rechaza toda promesa o aviso de entrega con correo, Gmail o mail, en cualquier forma', () => {
    const rechazadas = [
      'Te lo mando al mail.', 'Te la mando al correo.', 'Te lo envío al Gmail.', 'Dime tu correo y te lo envío.', 'Te mandaremos todo a tu correo hoy.',
      'Te llega la invitación a tu Gmail.', 'Vas a recibir una invitación a tu Gmail.', 'El acceso te llega por Gmail.', 'Revisa tu correo, ahí está todo.',
      'Te envío el material mañana a tu correo.', 'Ya te lo compartí a tu Gmail.', 'Te lo mando en unos minutos a tu correo.', 'Ya te envié el libro por correo.',
      'Tu pago fue acreditado y te llega al correo.', 'Te enviaremos la carpeta de Drive a tu correo.', 'Revisa tu bandeja de entrada.', 'Te daré acceso a la carpeta de Drive.', 'Quedas con acceso al Drive esta noche.', 'Aquí tienes el enlace de la carpeta.', 'Te dejo el link del Drive.',
      'Te invito a la carpeta compartida.', 'Daremos acceso a tu Gmail.', 'Te habilito el acceso hoy.', 'Tendrás la invitación en tu correo.', 'Escríbelo en tu correo de Gmail.', 'Te lo dejo en el mail.',
      'Quedas con acceso por Gmail', 'Ya está en tu correo', 'Lo tienes en tu correo', 'Lo tendrás en tu Gmail', 'Lo vas a tener en tu correo', 'Te doy acceso por Gmail', 'Te habilito el acceso con tu Gmail',
      'Tendrás acceso desde tu Gmail', 'Mira tu correo', 'Busca en tu Gmail', 'Chequea tu Gmail', 'El enlace va a tu Gmail', 'Gracias, ya tengo tu correo', 'Anotado tu Gmail', 'Listo, registré tu correo',
      'Gracias, tu correo quedó guardado', 'Te va a aparecer en tu Gmail.', 'Quedará disponible en tu Gmail.', 'El material va directo a tu correo de Gmail.', 'Podrás descargarlo desde tu Gmail.', 'El enlace estará en tu Gmail.',
      'Ya puedes entrar al Drive con tu Gmail.', 'Tu acceso está activo en tu Gmail.', 'Mira tu Gmail.', 'Abre tu correo.', 'Busca en tu Gmail el mensaje de Rubén.', 'Tu correo ya está en la lista de Rubén.', 'Déjame tu correo.',
      'Aquí tienes el enlace', 'Te dejo el enlace', 'Te invito a la carpeta de Drive', 'Te daremos acceso a la carpeta',
    ];
    for (const x of rechazadas) expect(motivo(x), x).not.toBe('');
  });

  it('rechaza que el modelo PIDA el correo (el pedido lo hace solo el código)', () => {
    const pedidos = ['Pásame tu correo de Gmail.', 'Dime tu correo.', 'Escríbeme tu Gmail.', 'Compárteme tu email.', 'Mándame tu correo.', 'Envíame tu Gmail por favor.', '¿Cuál es tu correo?', '¿Me pasas tu correo de Gmail?', 'Necesito tu correo para continuar.', '¿Podrías darme tu correo?', 'Déjame tu Gmail.', 'Facilítame tu email.', 'Regálame tu correo.', 'Apunta aquí tu Gmail.', '¿Tienes un Gmail?', 'Proporciónanos tu correo.', 'Déjame tu correo', '¿Me facilitas tu correo?', 'Facilítame tu email', 'Proporcióname tu correo', 'Tu correo, por favor', '¿Qué correo usas?', 'Apunta tu correo aquí', '¿Tienes Gmail?', 'Con tu Gmail basta'];
    for (const x of pedidos) expect(motivo(x), x).not.toBe('');
  });

  it('las palabras solas YA no se rechazan (D2): hablar del correo como tema pasa', () => {
    for (const x of ['Un correo electrónico no hace falta para conocer el método.', 'El método no usa ningún Gmail ni mail.', 'Cada pareja es distinta; mi Gmail no es relevante aquí, cuéntame más.']) expect(motivo(x), x).toBe('');
  });

  it('de punta a punta: lo que dice el modelo con una promesa de correo cae al texto fijo y no sale tal cual', () => {
    for (const dicho of ['Te envío el material mañana a tu correo.', 'Ya te lo compartí a tu Gmail.', 'Pásame tu correo de Gmail y te lo mando.']) {
      const w = nuevo({ modeloDice: dicho });
      hablar(w, ANA, mTexto('hola'));
      const t = hablar(w, ANA, mTexto('estamos pasando un momento difícil'));
      const enviado = t.mensajes.map((m) => m.cuerpo).join(' ');
      expect(enviado, dicho).not.toBe(dicho);
      expect(enviado, dicho).not.toMatch(PROMESAS);
      expect(enviado, dicho).not.toMatch(PROHIBIDAS);
    }
  });
});
