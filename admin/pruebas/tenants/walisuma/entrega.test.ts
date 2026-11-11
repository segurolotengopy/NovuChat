/**
 * EL ENVÍO Y LA ENTREGA de Walisuma (decisiones de Andres del 10/11/2026 con las respuestas del cliente). Se prueba NEGANDO:
 *   - el envío es gratis desde el umbral (DATO `envioGratisDesdeBs`, incluido), en cualquier envío; bajo el umbral el caso va a recepción (aviso + botón) para cotizar POR FUERA de NovuChat;
 *   - el QR cobra SOLO los productos: el monto es la suma de las líneas, nunca suma envío;
 *   - la entrega pide nombre completo, teléfono y, en un envío, dirección exacta; el recojo pide nombre, teléfono y tienda;
 *   - el modelo no dice el costo del envío ni si es gratis: lo dice el código;
 *   - todos los países se atienden igual (mismo trato, en español);
 *   - el teléfono de contacto nunca llega al prospecto del miniCRM.
 */
import { describe, expect, it } from 'vitest';
import type { Mundo } from '../../lib/n8n-de-mentira';
import { ANA, CATALOGO, COMPROBANTE, ENTREGA, ENVIO, REC, crear, hablar, mImagen, mTexto, modelo, panelConQr, panelOk, textos, type Opciones } from './mundo';

const fichas = (m: Mundo): Record<string, any> => (m.sd['walisuma'] ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
// Piezas de prueba justo en el borde del umbral de 500 Bs.
const BORDE = [
  { id: 'pieza-499', nombre: 'Pieza 499,99', descripcion: 'x', area: 'x', precio: 499.99, moneda: 'BOB', activo: true },
  { id: 'pieza-500', nombre: 'Pieza 500', descripcion: 'x', area: 'x', precio: 500, moneda: 'BOB', activo: true },
  { id: 'pieza-501', nombre: 'Pieza 501', descripcion: 'x', area: 'x', precio: 501, moneda: 'BOB', activo: true },
  { id: 'pieza-100', nombre: 'Pieza 100', descripcion: 'x', area: 'x', precio: 100, moneda: 'BOB', activo: true },
];
const panelBorde = (): ReturnType<typeof panelOk> => panelOk({ catalogo: [...CATALOGO, ...BORDE].map((c) => ({ ...c })) });
/** Un pedido confirmado: el cliente pide y luego dice «quiero pagar». */
function pedir(lineas: unknown[], entrega: Record<string, unknown>, o: Opciones = {}): { m: Mundo; t: ReturnType<typeof hablar> } {
  const m = crear({ panel: panelBorde(), modeloDice: modelo('Con gusto, lo anoto.', { lineas, entrega }), ...o });
  hablar(m, ANA, mTexto('quiero una pieza'));
  return { m, t: hablar(m, ANA, mTexto('quiero pagar')) };
}
const hayQr = (t: ReturnType<typeof hablar>): boolean => t.mensajes.some((x) => x.tipo === 'image');
const montoQr = (t: ReturnType<typeof hablar>): number => Number(t.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado')?.['monto']);
const conBoton = (t: ReturnType<typeof hablar>): boolean => t.mensajes.some((x) => !!x.payload['interactive']);

describe('el envío es gratis desde 500 Bs (incluido) y bajo el umbral va a recepción', () => {
  it('500,00 con envío: gratis, sin aviso ni botón, y el QR cobra 500', () => {
    const { t } = pedir([{ id: 'pieza-500', cantidad: 1 }], ENVIO);
    expect(hayQr(t)).toBe(true);
    expect(montoQr(t)).toBe(500);
    expect(t.mensajes[0]?.cuerpo).toMatch(/El envío no tiene costo \(compras desde Bs 500\)/);
    expect(t.avisos).toHaveLength(0);
    expect(conBoton(t)).toBe(false);
  });
  it('NEGADO: 499,99 con envío NO es gratis: el QR cobra solo los productos, sale UN aviso a recepción para cotizar y el mensaje lleva el botón', () => {
    const { t } = pedir([{ id: 'pieza-499', cantidad: 1 }], ENVIO);
    expect(hayQr(t)).toBe(true);
    expect(montoQr(t)).toBe(499.99);
    expect(t.mensajes[0]?.cuerpo).not.toMatch(/no tiene costo/);
    expect(t.mensajes[0]?.cuerpo).toMatch(/El QR es solo por los productos; el envío se cotiza y se paga aparte, directo a quien lo lleva/);
    expect(t.mensajes[0]?.cuerpo).toMatch(/Ya avisé a recepción/);
    expect(t.mensajes[0]?.payload['interactive']).toBeTruthy();
    expect(t.avisos).toHaveLength(1);
    const aviso = JSON.stringify(t.avisos[0]?.payload);
    expect(aviso).toMatch(/COTIZAR ENVÍO/);
    expect(aviso).toMatch(/QR emitido o por emitir/);
    expect(aviso).toMatch(/envío: a cotizar/);
    expect(aviso).toMatch(/tel\. 71234567/);
    expect(aviso).toMatch(/Av\. Arce 2345/);
  });
  it('501 con envío: gratis; también en «Envío nacional» y en «Envío en Santa Cruz» (sin excepciones)', () => {
    for (const modo of ['Envío en La Paz', 'Envío en Santa Cruz', 'Envío nacional']) {
      const { t } = pedir([{ id: 'pieza-501', cantidad: 1 }], { ...ENVIO, modo, ciudad: modo === 'Envío nacional' ? 'Tarija' : 'Santa Cruz' });
      expect(hayQr(t), modo).toBe(true);
      expect(montoQr(t), modo).toBe(501);
      expect(t.mensajes[0]?.cuerpo, modo).toMatch(/El envío no tiene costo/);
      expect(t.avisos, modo).toHaveLength(0);
    }
  });
  it('NEGADO: el envío nacional bajo el umbral tampoco es gratis', () => {
    const { t } = pedir([{ id: 'pieza-100', cantidad: 1 }], { ...ENVIO, modo: 'Envío nacional', ciudad: 'Tarija' });
    expect(t.mensajes[0]?.cuerpo).not.toMatch(/no tiene costo/);
    expect(t.avisos).toHaveLength(1);
    expect(t.mensajes[0]?.payload['interactive']).toBeTruthy();
  });
  it('el monto del QR es la suma de las líneas en los tres casos (el envío nunca se suma)', () => {
    for (const [lineas, esperado] of [[[{ id: 'pieza-499', cantidad: 1 }], 499.99], [[{ id: 'pieza-500', cantidad: 1 }], 500], [[{ id: 'pieza-501', cantidad: 1 }], 501], [[{ id: 'pieza-100', cantidad: 3 }], 300]] as const) {
      const { t } = pedir([...lineas], ENVIO);
      expect(montoQr(t)).toBe(esperado);
    }
  });
  it('el umbral es DATO: con 1.000 en los datos, 501 ya no es gratis', () => {
    const { t } = pedir([{ id: 'pieza-501', cantidad: 1 }], ENVIO, { base: { envioGratisDesdeBs: 1000 } });
    expect(t.mensajes[0]?.cuerpo).not.toMatch(/no tiene costo/);
    expect(t.avisos).toHaveLength(1);
  });
  it('NEGADO: sin umbral declarado nunca se promete envío gratis', () => {
    const { t } = pedir([{ id: 'pieza-501', cantidad: 1 }], ENVIO, { base: { envioGratisDesdeBs: 0 } });
    expect(t.mensajes[0]?.cuerpo).not.toMatch(/no tiene costo/);
    expect(t.avisos).toHaveLength(1);
  });
  it('NEGADO: si el aviso a recepción no sale, el cliente lee «No pude avisar» y el botón', () => {
    const { t } = pedir([{ id: 'pieza-100', cantidad: 3 }], ENVIO, { aviso: 'error' });
    expect(t.mensajes[0]?.cuerpo).not.toMatch(/Ya avisé/);
    expect(t.mensajes[0]?.cuerpo).toMatch(/No pude avisar a recepción; escríbele directo con el botón/);
    expect(t.mensajes[0]?.payload['interactive']).toBeTruthy();
  });
  it('recojo en tienda con 100 Bs: sin aviso de envío, sin frase de costo, con la dirección de la tienda (dato del comercio)', () => {
    const { t } = pedir([{ id: 'pieza-100', cantidad: 1 }], ENTREGA);
    expect(hayQr(t)).toBe(true);
    expect(montoQr(t)).toBe(100);
    expect(t.avisos).toHaveLength(0);
    expect(conBoton(t)).toBe(false);
    expect(t.mensajes[0]?.cuerpo).not.toMatch(/envío/i);
    expect(t.mensajes[0]?.cuerpo).toMatch(/Recoges tu pedido en: Calle Claudio Aliaga 1231, San Miguel/);
    const sc = pedir([{ id: 'pieza-100', cantidad: 1 }], { ...ENTREGA, ciudad: 'Santa Cruz' });
    expect(sc.t.mensajes[0]?.cuerpo).toMatch(/Av\. Marcelo Terceros/);
  });
  it('el aviso del comprobante de un envío bajo el umbral lleva «envío: a cotizar», el teléfono y la dirección', () => {
    const { m } = pedir([{ id: 'pieza-100', cantidad: 3 }], ENVIO, { medio: { clasificacion: COMPROBANTE } });
    expect(fichas(m)[ANA].entrega.telefono).toBe('71234567');
    m.dobles['Traer configuración'] = () => panelConQr(300, { catalogo: [...CATALOGO, ...BORDE].map((c) => ({ ...c })) });
    const t = hablar(m, ANA, mImagen({ caption: '' }));
    expect(t.avisos).toHaveLength(1);
    const vars = ((t.avisos[0]?.payload['template'] as any).components[0].parameters as { text: string }[]).map((p) => p.text); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(vars[2]).toBe('Envío en La Paz · La Paz · a nombre de Ana Pérez · tel. 71234567 · Av. Arce 2345, Sopocachi · envío: a cotizar');
    expect(vars[3]).toBe('llegó y los datos coinciden');
  });
  it('un cambio de pedido con el QR abierto no avisa (el aviso se arma antes de saber si el cobro se cerró): el texto manda al botón', () => {
    const m = crear({ panel: panelBorde(), modeloDice: (ll) => modelo('Con gusto.', { lineas: [{ id: 'pieza-100', cantidad: /mejor cuatro/.test(String((ll.cuerpo as any)?.contents?.slice(-1)[0]?.parts?.[0]?.text)) ? 4 : 3 }], entrega: ENVIO }) }); // eslint-disable-line @typescript-eslint/no-explicit-any
    hablar(m, ANA, mTexto('tres piezas'));
    const t1 = hablar(m, ANA, mTexto('quiero pagar'));
    expect(t1.avisos).toHaveLength(1);
    m.dobles['Traer configuración'] = () => panelOk({ catalogo: [...CATALOGO, ...BORDE].map((c) => ({ ...c })), cobro: { activo: true, qr: { url: 'https://qr.example.com/q.png' }, pendiente: true, monto: 300, pedido: 'WL1', regla: 2 } });
    const t2 = hablar(m, ANA, mTexto('mejor cuatro'));
    expect(hayQr(t2)).toBe(true);
    expect(t2.avisos).toHaveLength(0);
    expect(t2.mensajes[0]?.cuerpo).toMatch(/escríbele a recepción con el botón para cotizar el envío/);
    expect(t2.mensajes[0]?.payload['interactive']).toBeTruthy();
  });
});

describe('bajo el umbral el resumen cabe en el botón (1.024) sin perder la política ni el pie', () => {
  it('un resumen largo (6 líneas con detalle de 120 caracteres) recorta la LISTA, no la cola', () => {
    const piezas = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `larga-${n}`, nombre: `Pieza larga ${n}`, descripcion: 'x', area: 'x', precio: 10, moneda: 'BOB', activo: true }));
    const detalle = 'color azul con borde rojo y nombre bordado en hilo dorado '.repeat(3).slice(0, 120);
    const m = crear({ panel: panelOk({ catalogo: [...CATALOGO, ...piezas].map((c) => ({ ...c })) }), modeloDice: modelo('Con gusto.', { lineas: piezas.map((p) => ({ id: p.id, cantidad: 1, detalle })), entrega: ENVIO }) });
    hablar(m, ANA, mTexto('quiero seis piezas'));
    const t = hablar(m, ANA, mTexto('quiero pagar'));
    expect(hayQr(t)).toBe(true);
    const cuerpo = String(((t.mensajes[0]?.payload['interactive'] as any).body.text)); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(cuerpo.length).toBeLessThanOrEqual(1024);
    expect(cuerpo).toMatch(/… y \d+ más/);
    expect(cuerpo).toMatch(/Total: Bs 60/);
    expect(cuerpo).toMatch(/El QR es solo por los productos; el envío se cotiza y se paga aparte/);
    expect(cuerpo).toMatch(/Ya avisé a recepción; también puedes escribirle directo con el botón/);
    expect(cuerpo).toMatch(/Abajo va el QR para pagar\./);
  });
  it('sin QR de cobro real el texto no habla del QR junto a «el pago por QR no está disponible»', () => {
    const p = panelBorde(); const { cobroReal: _c, cobro: _o, ...resto } = p.body as Record<string, unknown>;
    const { t } = pedir([{ id: 'pieza-100', cantidad: 1 }], ENVIO, { panel: { statusCode: 200, body: resto as never } });
    const cuerpo = t.mensajes[0]?.cuerpo ?? '';
    expect(cuerpo).toMatch(/el pago por QR no está disponible/);
    expect(cuerpo).toMatch(/El envío se cotiza y se paga aparte/);
    expect(cuerpo).not.toMatch(/El QR es solo por los productos/);
  });
});

describe('la entrega pide nombre completo, teléfono y dirección exacta (o la tienda en el recojo)', () => {
  const sinQr = (entrega: Record<string, unknown>, falta: RegExp): void => {
    const prompts: string[] = [];
    const m = crear({ panel: panelBorde(), modeloDice: (ll) => { prompts.push(String((ll.cuerpo as any)?.systemInstruction?.parts?.[0]?.text)); return modelo('Con gusto, lo anoto.', { lineas: [{ id: 'pieza-501', cantidad: 1 }], entrega }); } }); // eslint-disable-line @typescript-eslint/no-explicit-any
    hablar(m, ANA, mTexto('quiero una pieza'));
    const t = hablar(m, ANA, mTexto('quiero pagar'));
    expect(hayQr(t)).toBe(false);
    expect(t.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado')).toBeUndefined();
    const faltan = (prompts[prompts.length - 1] ?? '').split('\n').find((l) => l.startsWith('FALTAN')) ?? '';
    expect(faltan).toMatch(falta);
  };
  it('NEGADO: sin teléfono, no sale QR y «FALTAN» lo nombra', () => sinQr({ ...ENVIO, telefono: '' }, /teléfono de contacto/));
  it('NEGADO: un teléfono de 7 dígitos no vale', () => sinQr({ ...ENVIO, telefono: '7123456' }, /teléfono de contacto/));
  it('NEGADO: sin dirección, no sale QR', () => sinQr({ ...ENVIO, direccion: '' }, /dirección exacta/));
  it('NEGADO: «zona sur» no es una dirección exacta', () => sinQr({ ...ENVIO, direccion: 'zona sur' }, /dirección exacta/));
  it('NEGADO: una dirección sin número ni «s/n» no es exacta', () => sinQr({ ...ENVIO, direccion: 'Avenida Arce frente a la plaza' }, /dirección exacta/));
  it('NEGADO: «Zona Sur 4to anillo» y «Santa Cruz 3er anillo» no son direcciones exactas', () => {
    sinQr({ ...ENVIO, direccion: 'Zona Sur 4to anillo' }, /dirección exacta/);
    sinQr({ ...ENVIO, direccion: 'Santa Cruz 3er anillo' }, /dirección exacta/);
  });
  it('«Arce 2631» y «sin número» sí valen como direcciones exactas', () => {
    for (const direccion of ['Arce 2631', 'Calle Los Pinos sin número, Achumani']) expect(hayQr(pedir([{ id: 'pieza-501', cantidad: 1 }], { ...ENVIO, direccion }).t), direccion).toBe(true);
  });
  it('la dirección conserva «2do piso» y solo enmascara secuencias de 7 o más dígitos', () => {
    const { m } = pedir([{ id: 'pieza-501', cantidad: 1 }], { ...ENVIO, direccion: 'Av. Arce 2345, 2do piso, CI 4455667' });
    expect(fichas(m)[ANA].entrega.direccion).toBe('Av. Arce 2345, 2do piso, CI [nº]');
  });
  it('al pasar de envío a recojo se limpia la dirección vieja (ficha y pedido del servidor)', () => {
    let entrega: Record<string, unknown> = ENVIO;
    const m = crear({ panel: panelBorde(), modeloDice: () => modelo('Con gusto.', { lineas: [{ id: 'pieza-501', cantidad: 1 }], entrega }) });
    hablar(m, ANA, mTexto('quiero una pieza'));
    expect(fichas(m)[ANA].entrega.direccion).toMatch(/Arce/);
    entrega = { modo: 'Recojo en tienda', ciudad: 'La Paz' };
    const t = hablar(m, ANA, mTexto('mejor lo recojo, quiero pagar'));
    expect(hayQr(t)).toBe(true);
    expect(fichas(m)[ANA].entrega.direccion).toBe('');
    const qr = t.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado');
    expect(JSON.stringify(qr)).not.toMatch(/Arce/);
  });
  it('NEGADO: un nombre de una sola palabra no basta', () => sinQr({ ...ENVIO, nombre: 'Ana' }, /nombre completo/));
  it('NEGADO: el recojo sin tienda (o en otra ciudad) no emite QR', () => {
    sinQr({ ...ENTREGA, ciudad: '' }, /tienda \(La Paz o Santa Cruz\)/);
    sinQr({ ...ENTREGA, ciudad: 'Cochabamba' }, /tienda \(La Paz o Santa Cruz\)/);
  });
  it('NEGADO: el recojo sin teléfono no emite QR', () => sinQr({ ...ENTREGA, telefono: '' }, /teléfono de contacto/));
  it('«s/n» cuenta como número de dirección', () => {
    const { t } = pedir([{ id: 'pieza-501', cantidad: 1 }], { ...ENVIO, direccion: 'Calle Los Pinos s/n, Achumani' });
    expect(hayQr(t)).toBe(true);
  });
  it('«MISMO» toma el teléfono de este chat y la ficha lo guarda', () => {
    const { m, t } = pedir([{ id: 'pieza-501', cantidad: 1 }], { ...ENVIO, telefono: 'MISMO' });
    expect(hayQr(t)).toBe(true);
    expect(fichas(m)[ANA].entrega.telefono).toBe(ANA);
  });
  it('al modelo el teléfono NUNCA se le muestra: solo «anotado»', () => {
    const prompts: string[] = [];
    const m = crear({ panel: panelBorde(), modeloDice: (ll) => { prompts.push(String((ll.cuerpo as any)?.systemInstruction?.parts?.[0]?.text)); return modelo('Con gusto.', { lineas: [{ id: 'pieza-501', cantidad: 1 }], entrega: ENVIO }); } }); // eslint-disable-line @typescript-eslint/no-explicit-any
    hablar(m, ANA, mTexto('quiero una pieza'));
    hablar(m, ANA, mTexto('mi teléfono es 71234567'));
    const ultimo = prompts[prompts.length - 1] ?? '';
    expect(ultimo).toMatch(/teléfono de contacto anotado/);
    expect(ultimo).not.toMatch(/71234567/);
  });
});

describe('el modelo no dice el costo del envío: lo dice el código', () => {
  const FALSOS = [
    'El envío es gratis para ti.', 'El envío cuesta 20 Bs.', 'Tenemos delivery sin costo en La Paz.', 'El costo del envío corre por nuestra cuenta.', 'Envío incluido en tu pedido.',
    'El envío es por nuestra cuenta.', 'Te lo enviamos gratis.', 'No cobramos el envío.', 'Te lo mandamos sin costo a tu casa.', 'Lo enviamos sin cargo.',
    'Tu envío no tiene ningún costo.', 'El envío va de regalo.', 'El envío es cortesía de la casa.', 'El envío lo pagas tú al courier.', 'Lo despachamos gratis a Tarija.',
  ];
  for (const falso of FALSOS) {
    it(`NEGADO con 300 Bs: «${falso}» no sale; sale el texto fijo`, () => {
      const m = crear({ panel: panelBorde(), modeloDice: modelo(falso, { lineas: [{ id: 'pieza-100', cantidad: 3 }], entrega: ENVIO }) });
      const t = hablar(m, ANA, mTexto('quiero tres piezas'));
      expect(textos(t).join(' ')).toMatch(/Cuéntame un poco más de lo que buscas/);
      expect(textos(t).join(' ')).not.toContain(falso);
    });
  }
  for (const bien of ['Te envío un abrazo.', 'Te mando el detalle de la pieza.', 'La Pieza 100 cuesta Bs 100 y es de alpaca.', 'Envíame tu nombre completo, por favor.']) {
    it(`«${bien}» sigue pasando`, () => {
      const m = crear({ panel: panelBorde(), modeloDice: modelo(bien) });
      const t = hablar(m, ANA, mTexto('hola'));
      expect(textos(t).join(' ')).toContain(bien);
    });
  }
  it('si el cliente pregunta por el envío, el código agrega la política fija con el umbral', () => {
    const m = crear({ panel: panelBorde(), modeloDice: modelo('Con gusto, te cuento.') });
    const t = hablar(m, ANA, mTexto('¿hacen envíos a Tarija? ¿cuánto cuesta el envío?'));
    expect(textos(t).join(' ')).toMatch(/Sobre el envío: desde Bs 500 de compra no tiene costo, en cualquier envío, también al resto del país\. En compras menores, recepción cotiza el envío y se paga aparte/);
  });
  it('NEGADO: «te envío el comprobante» o «envío mis datos» no activan la política de envío', () => {
    for (const frase of ['te envío el comprobante ahora', 'envío mis datos: Ana Pérez', 'ya te envié la foto, me envías el QR']) {
      const m = crear({ panel: panelBorde(), modeloDice: modelo('Con gusto.') });
      expect(textos(hablar(m, ANA, mTexto(frase))).join(' ')).not.toMatch(/Sobre el envío/);
    }
  });
  it('el prompt ya no deriva por «envíos» y prohíbe decir el costo', () => {
    const prompts: string[] = [];
    const m = crear({ modeloDice: (ll) => { prompts.push(String((ll.cuerpo as any)?.systemInstruction?.parts?.[0]?.text)); return modelo('Hola.'); } }); // eslint-disable-line @typescript-eslint/no-explicit-any
    hablar(m, ANA, mTexto('hola'));
    expect(prompts[0]).toMatch(/NUNCA dices el costo del envío ni si es gratis/);
    expect(prompts[0]).not.toMatch(/No ofreces descuentos, envíos ni su costo/);
    expect(prompts[0]).toMatch(/Respondes siempre en español/);
  });
});

describe('todos los países se atienden igual (mismo trato, en español)', () => {
  const sinPrefijosDeLaConsola = (): ReturnType<typeof panelOk> => panelOk({ operacion: { numeroRecepcion: REC } });
  for (const [pais, tel] of [['Argentina (54)', '5491100000033'], ['EE. UU. (1)', '15551230044']] as const) {
    it(`${pais}: llama al modelo y NO sale el texto de otro país`, () => {
      let llamadas = 0;
      const m = crear({ base: { prefijosPermitidos: '1,2,3,4,5,6,7,8,9' }, panel: sinPrefijosDeLaConsola(), modeloDice: () => { llamadas++; return modelo('Con gusto. ¿Qué pieza te interesa?'); } });
      const t = hablar(m, tel, mTexto('hello, I want a scarf'));
      expect(llamadas).toBe(1);
      expect(textos(t).join(' ')).toMatch(/¿Qué pieza te interesa\?/);
      expect(textos(t).join(' ')).not.toMatch(/atendemos pedidos de números de Bolivia/);
    });
  }
});

describe('el teléfono de contacto nunca llega al prospecto del miniCRM', () => {
  it('el prospecto no lleva el teléfono de entrega, la dirección ni el nombre de quien recibe', () => {
    const m = crear({
      panel: panelBorde(), base: { planillaProspectosId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', planillaProspectosHoja: 'Leads_CRM' },
      modeloDice: modelo('Con gusto.', { lineas: [{ id: 'pieza-501', cantidad: 1 }], entrega: { ...ENVIO, telefono: '76543210', nombre: 'Rosa Quispe Mamani' } }),
    });
    for (const n of ['Buscar teléfono en planilla', 'Leer IDs de la planilla', 'Leer encabezados de la planilla', 'Agregar fila', 'Actualizar fila']) m.dobles[n] = () => [];
    hablar(m, ANA, mTexto('quiero una pieza'), { toleraFallo: true });
    const t = hablar(m, ANA, mTexto('quiero pagar'), { toleraFallo: true });
    const prospectos = (t.porNodo['Armar mensajes'] ?? []).map((s) => s['prospectoPlanilla']).filter((p) => p !== null && p !== undefined);
    expect(prospectos.length).toBeGreaterThan(0);
    const texto = JSON.stringify(prospectos);
    expect(texto).not.toMatch(/76543210|Rosa Quispe|Av\. Arce|Sopocachi/);
    expect(fichas(m)[ANA].entrega.telefono).toBe('76543210');
  });
});
