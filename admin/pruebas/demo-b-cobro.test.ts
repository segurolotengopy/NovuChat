/**
 * EL COBRO DEL DEMO B: REAL O SIMULADO, NUNCA LOS DOS.
 *
 * QUÉ DEFIENDE ESTA SUITE, y por qué está escrita NEGANDO.
 *
 * La prohibición 3 de `CLAUDE.md` tiene dos mitades que se contradicen entre
 * sí, y por eso los dos modos son excluyentes:
 *
 *   - Con cobro SIMULADO hay que DECIR que es simulado: el QR lleva el rótulo
 *     impreso y en el epígrafe, y la confirmación dice «simulado».
 *   - Con cobro REAL hay que NO AFIRMAR un pago: el OCR de un comprobante no es
 *     una acreditación bancaria —una imagen se edita— así que el asistente
 *     nunca dice «pago acreditado», «pago verificado» ni «recibimos tu pago».
 *     Dice que el comprobante llegó y que los datos coinciden; quien confirma
 *     que entró la plata es el negocio, en su banco.
 *
 * Mezclarlos da el peor resultado posible: un cobro real rotulado como
 * simulacro, o un simulacro que parece real. Por eso la prueba central no
 * comprueba que el camino feliz funcione —eso es fácil—: le da al flujo una
 * configuración IMPOSIBLE (cobro real encendido Y los tres rótulos de
 * simulado a la vez) y exige que el rótulo NO salga. Es el patrón de
 * `pruebas/reglas.test.ts`, aplicado a un texto en vez de a un permiso.
 *
 * Y la segunda cosa que defiende: QUE EL CIERRE NAZCA DE UN HECHO. Hasta el
 * 23/09/2026, `¿Hay comprobante?` registraba la venta si el texto del asistente
 * contenía la palabra «SIMULADO». Eso es una afirmación del modelo —lo que
 * dijo, no lo que pasó— y es el mismo modo de fallo que costó las citas
 * duplicadas del 17/09. Ahora el cierre exige dos hechos: que el servidor
 * hubiera abierto un pago pendiente y que el cliente hubiera mandado el archivo.
 *
 * Como en el resto de las suites de flujos, el código y las expresiones se
 * EXTRAEN DEL JSON VERSIONADO y se ejecutan: copiar la lógica acá dejaría la
 * prueba en verde mientras el flujo se rompe.
 */
import { describe, expect, it } from 'vitest';
import {
  type J, codigoDe, configBase, destinos, ejecutar, entradas, expresion, leerFlujo, nodo, plantilla,
} from './lib/flujo.ts';

const f = leerFlujo('demo-b-venta-cobro.json');
const y = (nombre: string) => nodo(f, nombre).position?.[1] ?? Number.NaN;

/** Nada de lo que sale al cliente puede afirmar que un pago entró. */
const AFIRMA_PAGO = /(pago|cobro|transferencia|dep[oó]sito)\s+(\S+\s+){0,3}(acreditad|verificad|recibid|confirmad)|ya\s+(recibimos|se\s+acredit)/i;
/** Y con cobro real, nada puede decir que el cobro es de mentira. */
const DICE_SIMULADO = /(simulad|simulacr|demostraci[oó]n|\bdemo\b|no\s+cobra)/i;

// --- La respuesta del panel, en sus dos modos ------------------------------

const RESPUESTA_BASE = {
  tenantId: 'un-negocio', estadoComercio: 'activo', phoneNumberId: '1000000001',
  operacion: { moneda: 'BOB', horarioAtencion: 'lunes a sábado' },
  datosDelNegocio: { nombreNegocio: 'Un Negocio' },
  catalogo: [], funcionarios: [], voz: {},
  atencion: { estado: 'normal', respuestasEnVentana: 3 },
};

const QR_REAL = 'https://us-east1-novuchat-demo.cloudfunctions.net/imagenDeCobro?f=' + 'a'.repeat(32);

/** Cobro REAL encendido, tal como lo manda `configuracionFlujo`. */
const real = (cobro: J = {}): J => ({
  statusCode: 200,
  body: {
    ...RESPUESTA_BASE,
    cobroReal: { nombreCuenta: 'Comercio Boliviano SRL', banco: 'BNB', cuentas: ['1000000890'],
      venceEl: '2027-12-31', moneda: 'BOB', montoFijo: null, fichaQr: 'a'.repeat(32) },
    cobro: { activo: true, moneda: 'BOB', montoFijo: null,
      qr: { url: QR_REAL, nombreCuenta: 'Comercio Boliviano SRL', banco: 'BNB' },
      pendiente: false, monto: null, pedido: null, qrEnviadoEn: null, vencidoHaceMin: null, ...cobro },
  },
});

/** Cobro SIMULADO: lo que manda el panel cuando el real no está encendido. */
const simulado = (cobro: J = {}): J => ({
  statusCode: 200,
  body: {
    ...RESPUESTA_BASE,
    cobroSimulado: { rotuloSuperior: 'DEMOSTRACION · ESTE QR NO COBRA',
      rotuloInferior: 'SIMULACRO DE PAGO', epigrafe: 'Cobro SIMULADO: no cobra ni mueve dinero.',
      confirmacion: 'Pago verificado (SIMULADO - demostracion, sin cobro real).',
      mediaIdQr: '1000000000000001' },
    cobro: { activo: false, moneda: 'BOB', montoFijo: null, qr: null,
      pendiente: false, monto: null, pedido: null, qrEnviadoEn: null, vencidoHaceMin: null, ...cobro },
  },
});

const fusionar = (respuesta: unknown, webhook: J = {}): J =>
  ejecutar(codigoDe(f, 'Config del negocio'), [respuesta as J],
    { 'Config base': { ...configBase(f), ...webhook } })[0] ?? {};

const normalizar = (cfg: J, mensaje: J): J =>
  ejecutar(codigoDe(f, 'Normalizar entrada'), [{
    ...cfg,
    messages: [{ from: '59170000001', id: 'wamid.PRUEBA', ...mensaje }],
    contacts: [{ profile: { name: 'Ana' } }],
  }])[0] ?? {};

const procesar = (salidaDelModelo: string, cfg: J): J =>
  ejecutar(codigoDe(f, 'Procesar respuesta'), [{ output: salidaDelModelo }],
    { 'Normalizar entrada': [cfg] })[0] ?? {};

const prepararQr = (previo: J, cfg: J): J =>
  ejecutar(codigoDe(f, 'Preparar QR de cobro'), [previo], { 'Config del negocio': [cfg] })[0] ?? {};

/** Una compuerta IF del flujo, evaluada como la evaluaría n8n. */
const pasa = (compuerta: string, json: J): boolean => {
  const cs = (nodo(f, compuerta).parameters['conditions'] as {
    conditions: { leftValue: string; rightValue?: unknown; operator: { operation: string } }[];
  }).conditions;
  return cs.every((c) => {
    const v = expresion(c.leftValue, json);
    if (c.operator.operation === 'false') return v !== true;
    if (c.operator.operation === 'notEquals') return v !== expresion(c.rightValue, json);
    return v === true;
  });
};

// ===========================================================================

describe('(1) Los dos modos son EXCLUYENTES, y lo decide el servidor', () => {
  it('con cobro real, los tres rótulos de simulado salen VACÍOS', () => {
    const cfg = fusionar(real());
    expect(cfg['cobroRealActivo']).toBe('si');
    expect(cfg['rotuloDemo']).toBe('');
    expect(cfg['captionQr']).toBe('');
    expect(cfg['textoPagoSimulado']).toBe('');
    // Y el QR que se manda es el del comercio, no el de demostración.
    expect(cfg['cobroQrUrl']).toBe(QR_REAL);
    expect(cfg['qrMediaId']).toBe('');
  });

  it('NEGANDO: ni con los rótulos de simulado metidos a la fuerza junto al cobro real', () => {
    // La configuración imposible: el panel manda las dos cosas a la vez. No
    // debería poder pasar --`ingesta.ts` las hace excluyentes-- y por eso mismo
    // esta es la prueba que importa: si alguien rompe aquella regla, o si el
    // flujo se conecta a otro servidor, el rótulo NO puede aparecer igual.
    const imposible = real();
    (imposible['body'] as J)['cobroSimulado'] = {
      rotuloSuperior: 'DEMOSTRACION', rotuloInferior: 'SIMULACRO',
      epigrafe: 'Cobro SIMULADO: no cobra ni mueve dinero.',
      confirmacion: 'Pago verificado (SIMULADO).', mediaIdQr: '1000000000000001',
    };
    const cfg = fusionar(imposible);
    expect(cfg['cobroRealActivo']).toBe('si');
    for (const clave of ['rotuloDemo', 'captionQr', 'textoPagoSimulado', 'qrMediaId']) {
      expect(cfg[clave], clave).toBe('');
    }
    // Y el pie del QR que recibe el cliente tampoco los lleva.
    const previo = procesar('Tu pedido: 350 Bs. [ENVIAR_QR]', cfg);
    const qr = prepararQr(previo, cfg);
    expect(String(qr['captionQr'])).not.toMatch(DICE_SIMULADO);
    expect(String(qr['captionQr'])).not.toMatch(AFIRMA_PAGO);
  });

  it('sin cobro real, los rótulos son los de `Config base` y NO los que mande el panel', () => {
    const base = configBase(f);
    const cfg = fusionar(simulado());
    expect(cfg['cobroRealActivo']).toBe('');
    // Los rótulos que llegan al cliente son los del flujo, letra por letra: son
    // de NovuChat, no del comercio, y no dependen de que el panel conteste.
    expect(cfg['rotuloDemo']).toBe(base['rotuloDemo']);
    expect(cfg['captionQr']).toBe(base['captionQr']);
    expect(cfg['textoPagoSimulado']).toBe(base['textoPagoSimulado']);
  });

  it('del cobro simulado se toma QUÉ imagen, nunca QUÉ dice', () => {
    const cfg = fusionar(simulado());
    expect(cfg['qrMediaId']).toBe('1000000000000001');
    expect(cfg['rotuloDemo']).toBe(configBase(f)['rotuloDemo']);
    // El epígrafe del panel NO pisa al del flujo: son textos distintos y el que
    // llega al cliente es el del flujo, que no depende de ningún documento.
    expect(cfg['captionQr']).toBe(configBase(f)['captionQr']);
    expect(cfg['captionQr']).not.toBe('Cobro SIMULADO: no cobra ni mueve dinero.');
  });

  it('EL FALLO POR OMISIÓN CAE DEL LADO DEL RÓTULO, en los cuatro caminos', () => {
    const base = configBase(f);
    const caidas: [string, unknown][] = [
      ['el panel no contesta', {}],
      ['el panel contesta 500', { statusCode: 500, body: {} }],
      ['el comercio está suspendido', { statusCode: 409, body: { estado: 'suspendido' } }],
      ['cobro real sin la dirección del QR', (() => {
        const r = real();
        (r['body'] as J)['cobro'] = { activo: true, qr: null, pendiente: false };
        return r;
      })()],
    ];
    for (const [caso, respuesta] of caidas) {
      const cfg = fusionar(respuesta);
      expect(cfg['cobroRealActivo'], caso).toBe('');
      expect(cfg['rotuloDemo'], caso).toBe(base['rotuloDemo']);
      expect(cfg['textoPagoSimulado'], caso).toBe(base['textoPagoSimulado']);
    }
  });

  it('un QR real sin `https://` no se usa: se cobra simulado', () => {
    const cfg = fusionar(real({ qr: { url: 'http://inseguro/qr.png', nombreCuenta: 'X', banco: 'Y' } }));
    expect(cfg['cobroRealActivo']).toBe('');
    expect(cfg['rotuloDemo']).toBe(configBase(f)['rotuloDemo']);
  });
});

describe('(2) La red de la prohibición 3 cambia con el modo', () => {
  it('SIMULADO: si el modelo afirma un cobro sin decir que es simulado, se rotula', () => {
    const cfg = fusionar(simulado());
    const s = procesar('Tu pago fue verificado. Gracias.', cfg);
    expect(String(s['respuesta'])).toContain(String(cfg['rotuloDemo']));
    expect(s['avisos']).toContain('rotulo_generico');
  });

  it('REAL: la oración que afirma un pago se REEMPLAZA, no se rotula', () => {
    const cfg = fusionar(real());
    const s = procesar('Tu pago fue verificado. Te lo preparamos.', cfg);
    const t = String(s['respuesta']);
    expect(t).not.toMatch(AFIRMA_PAGO);
    expect(t).toContain('El comprobante lo revisa Un Negocio y ellos confirman el pago.');
    expect(t).toContain('Te lo preparamos.');
    expect(s['avisos']).toContain('correccion_cobro');
    // Y no se le agregó ningún rótulo de simulacro: sería mentira.
    expect(t).not.toMatch(DICE_SIMULADO);
  });

  it('REAL: se juzga SIN marcas de formato, como en los flujos de reservas', () => {
    const cfg = fusionar(real());
    const t = String(procesar('*Pago acreditado*. Ya sale.', cfg)['respuesta']);
    expect(t.replace(/[*_~]/g, '')).not.toMatch(AFIRMA_PAGO);
  });

  it('REAL: si el modelo dice «simulado», la oración se quita', () => {
    const cfg = fusionar(real());
    const s = procesar('Listo. Este cobro es una demostración y no mueve dinero. Te lo preparamos.', cfg);
    expect(String(s['respuesta'])).not.toMatch(DICE_SIMULADO);
    expect(String(s['respuesta'])).toContain('Te lo preparamos.');
    expect(s['avisos']).toContain('simulado_quitado');
  });

  it('la corrección es LETRA POR LETRA la de los flujos de reservas', () => {
    // Si las dos se separan, un vertical corrige y el otro no, y nadie lo nota
    // hasta que un cliente lee «pago acreditado» sobre un QR de verdad.
    const b = codigoDe(f, 'Procesar respuesta');
    const a = codigoDe(leerFlujo('platinum-agendamiento.json'), 'Procesar respuesta');
    const regex = /const AFIRMA_COBRO = (\/.+\/i);/;
    expect(regex.exec(b)?.[1]).toBe(regex.exec(a)?.[1]);
    expect(b).toContain('y ellos confirman el pago.');
    expect(a).toContain('y ellos confirman el pago.');
  });

  it('SIMULADO: el rótulo del QR y el de la confirmación siguen saliendo como siempre', () => {
    const cfg = fusionar(simulado());
    expect(String(procesar('Son 350 Bs. [ENVIAR_QR]', cfg)['respuesta']))
      .toContain(String(cfg['rotuloDemo']));
    expect(String(procesar('Listo. [PEDIDO_CONFIRMADO]', cfg)['respuesta']))
      .toContain(String(cfg['textoPagoSimulado']));
  });
});

describe('(3) UN SOLO MENSAJE: el texto viaja en el pie del QR', () => {
  it('con [ENVIAR_QR] el texto NO sale aparte: «¿Responder ahora?» lo corta', () => {
    const cfg = fusionar(simulado());
    const s = procesar('Tu pedido: Ruana 590 Bs + envío 7 Bs. Total 597 Bs. [ENVIAR_QR]', cfg);
    expect(s['enviarQr']).toBe(true);
    expect(s['textoEnElQr']).toBe(true);
    expect(pasa('¿Responder ahora?', s)).toBe(false);
    expect(pasa('¿Enviar QR?', s)).toBe(true);
    // Y el texto del asistente está en el pie de la imagen.
    const qr = prepararQr(s, cfg);
    expect(String(qr['captionQr'])).toContain('Total 597 Bs');
  });

  it('sin la marca, el texto sale por el camino de siempre', () => {
    const cfg = fusionar(simulado());
    const s = procesar('¿Querés agregar algo más?', cfg);
    expect(s['textoEnElQr']).toBe(false);
    expect(pasa('¿Responder ahora?', s)).toBe(true);
  });

  it('un desglose muy largo vuelve a salir en dos mensajes, sin recortar nada', () => {
    const cfg = fusionar(simulado());
    const largo = 'Detalle del pedido. '.repeat(45) + 'Total 597 Bs. [ENVIAR_QR]';
    const s = procesar(largo, cfg);
    expect(s['enviarQr']).toBe(true);
    expect(s['textoEnElQr']).toBe(false);
    expect(pasa('¿Responder ahora?', s)).toBe(true);
    // El cliente recibe su desglose entero: nunca se trunca lo que tiene que leer.
    expect(String(s['respuesta'])).toContain('Total 597 Bs.');
    const qr = prepararQr(s, cfg);
    expect(String(qr['captionQr']).length).toBeLessThanOrEqual(1024);
  });

  it('el pie nunca pasa de los 1.024 caracteres que acepta Meta', () => {
    const cfg = fusionar(simulado());
    // 600 y no 690: en simulado la red de la prohibición 3 agrega el rótulo al
    // texto ANTES de medirlo, y el tope se mide sobre lo que de verdad viaja.
    const s = procesar('x'.repeat(600) + ' [ENVIAR_QR]', cfg);
    expect(s['textoEnElQr']).toBe(true);
    expect(String(prepararQr(s, cfg)['captionQr']).length).toBeLessThanOrEqual(1024);
  });

  it('SIMULADO: el rótulo ABRE el pie, antes que nada', () => {
    const cfg = fusionar(simulado());
    const qr = prepararQr(procesar('Son 350 Bs. [ENVIAR_QR]', cfg), cfg);
    expect(String(qr['captionQr']).startsWith(String(cfg['rotuloDemo']))).toBe(true);
    expect(qr['qrMedia']).toBe('1000000000000001');
    expect(qr['qrEsReal']).toBe(false);
  });

  it('REAL: el pie dice a quién se le paga y pide guardar el comprobante', () => {
    const cfg = fusionar(real());
    const qr = prepararQr(procesar('Son 350 Bs. [ENVIAR_QR]', cfg), cfg);
    const pie = String(qr['captionQr']);
    expect(pie).toContain('Comercio Boliviano SRL');
    expect(pie).toContain('BNB');
    expect(pie).toContain('ANTES de salir de la');
    expect(pie).not.toMatch(DICE_SIMULADO);
    expect(pie).not.toMatch(AFIRMA_PAGO);
    expect(qr['qrEnlace']).toBe(QR_REAL);
    expect(qr['qrMedia']).toBe('');
  });

  it('el cuerpo del envío elige media id o enlace, y nunca manda los dos', () => {
    const cuerpo = (json: J) => JSON.parse(String(plantilla(
      nodo(f, 'Enviar QR de cobro').parameters['jsonBody'], json)));
    const conMedia = cuerpo({ from: '59170000001', captionQr: 'pie', qrMedia: '1000000000000001', qrEnlace: 'https://x/y' });
    expect(conMedia.image).toEqual({ caption: 'pie', id: '1000000000000001' });
    const conEnlace = cuerpo({ from: '59170000001', captionQr: 'pie', qrMedia: '', qrEnlace: QR_REAL });
    expect(conEnlace.image).toEqual({ caption: 'pie', link: QR_REAL });
    expect(conMedia.type).toBe('image');
  });
});

describe('(4) El total que se coteja es el que se cotizó al mandar el QR', () => {
  const cfg = () => fusionar(real());

  it('sale del desglose y es el MAYOR, no el último', () => {
    const c = cfg();
    const qr = prepararQr(procesar('Ruana 590 Bs + envío 7 Bs. Total 597 Bs. [ENVIAR_QR]', c), c);
    expect(qr['cobroTotal']).toBe('597');
    const otro = prepararQr(procesar('Total 350 Bs. El envío son 7 Bs. [ENVIAR_QR]', c), c);
    expect(otro['cobroTotal']).toBe('350');
  });

  it('«1.234,50» y «1,234.50» son el mismo número', () => {
    const c = cfg();
    for (const t of ['Son Bs 1.234,50 [ENVIAR_QR]', 'Son Bs 1,234.50 [ENVIAR_QR]']) {
      expect(prepararQr(procesar(t, c), c)['cobroTotal'], t).toBe('1234.5');
    }
  });

  it('sin total no se inventa ninguno: va vacío y lo mira una persona', () => {
    const c = cfg();
    expect(prepararQr(procesar('Gracias por tu pedido. [ENVIAR_QR]', c), c)['cobroTotal']).toBe('');
  });

  it('el reporte del QR manda el hecho `qr_enviado` con el monto', () => {
    const cuerpo = JSON.parse(String(plantilla(
      nodo(f, 'Reportar QR (saliente)').parameters['jsonBody'], { messages: [{ id: 'wamid.SALIENTE' }] },
      { 'Preparar QR de cobro': { from: '59170000001', captionQr: 'pie', cobroTotal: '597', cobroPedido: '' },
        'Normalizar entrada': { phoneNumberId: '1000000001' } })));
    expect(cuerpo).toMatchObject({
      telefono: '59170000001', direccion: 'saliente', tipo: 'image',
      evento: 'qr_enviado', monto: 597, idMeta: 'wamid.SALIENTE',
    });
    // Sin pedido del carrito, la referencia es el id del mensaje del QR: es una
    // prueba verificable, y con ella el cierre del cotejo tiene dónde caer.
    expect(cuerpo.referencia).toBe('wamid.SALIENTE');
  });

  it('UN REENVÍO NO ABRE UN PAGO NUEVO: no manda `qr_enviado` ni reinicia el reloj', () => {
    const cuerpo = JSON.parse(String(plantilla(
      nodo(f, 'Reportar QR (saliente)').parameters['jsonBody'], { messages: [{ id: 'wamid.OTRO' }] },
      { 'Preparar QR de cobro': { from: '59170000001', captionQr: 'pie', esReenvio: true },
        'Normalizar entrada': { phoneNumberId: '1000000001' } })));
    expect(cuerpo.evento).toBeUndefined();
    expect(cuerpo.monto).toBeUndefined();
    expect(cuerpo.tipo).toBe('image');
  });
});

describe('(5) El comprobante: quién lo desvía y quién NO', () => {
  it('con cobro real y QR pendiente, una imagen es un comprobante', () => {
    const cfg = fusionar(real({ pendiente: true, monto: 597 }));
    const s = normalizar(cfg, { type: 'image', image: { id: '1000000000000002', mime_type: 'image/jpeg' } });
    expect(s['esComprobante']).toBe(true);
    expect(s['mediaId']).toBe('1000000000000002');
    expect(pasa('¿Es un comprobante?', s)).toBe(true);
  });

  it('NEGANDO: sin QR pendiente, la misma imagen NO es un comprobante', () => {
    const cfg = fusionar(real({ pendiente: false }));
    const s = normalizar(cfg, { type: 'image', image: { id: '1000000000000002' } });
    expect(s['esComprobante']).toBe(false);
    expect(s['pagoDeclarado']).toBe(false);
    expect(pasa('¿Es un comprobante?', s)).toBe(false);
  });

  it('NEGANDO: con cobro simulado NO se desvía al cotejo, aunque haya QR pendiente', () => {
    // En la demostración no hay cuenta contra la que cotejar: todo daría «no
    // cuadra» y cada demo terminaría en una persona.
    const cfg = fusionar(simulado({ pendiente: true }));
    const s = normalizar(cfg, { type: 'image', image: { id: '1000000000000002' } });
    expect(s['esComprobante']).toBe(false);
    // Pero el HECHO del pago sí quedó marcado: es con lo que se cierra la venta.
    expect(s['pagoDeclarado']).toBe(true);
  });

  it('CON COBRO SIMULADO cualquier archivo pasa como comprobante del pago simulado, haya o no QR pendiente (Andres, 23/09)', () => {
    // El port del cobro le había pegado la exigencia del pendiente a los dos
    // modos: en la demostración una foto sin QR pendiente hacía decir «no hay
    // ningún pago pendiente». La exigencia es del modo real.
    for (const pendiente of [false, true]) {
      const cfg = fusionar(simulado({ pendiente }));
      const s = normalizar(cfg, { type: 'image', image: { id: '1000000000000002', mime_type: 'image/jpeg' } });
      expect(String(s['userInput']), `pendiente=${pendiente}`).toContain('pago SIMULADO del QR');
      expect(String(s['userInput']), `pendiente=${pendiente}`).not.toContain('no hay ningún pago pendiente');
      expect(s['esComprobante']).toBe(false);
      // El cierre sigue siendo por hecho: solo cuenta si el servidor tenía un QR pendiente.
      expect(s['pagoDeclarado']).toBe(pendiente);
    }
  });

  it('NEGANDO: con cobro REAL y sin QR pendiente, el archivo NO se trata como pago', () => {
    const cfg = fusionar(real({ pendiente: false }));
    const s = normalizar(cfg, { type: 'image', image: { id: '1000000000000002' } });
    expect(String(s['userInput'])).toContain('no hay ningún pago pendiente');
    expect(String(s['userInput'])).not.toContain('SIMULADO');
  });

  it('con cobro REAL y QR pendiente pero sin id del medio, el modelo recibe el aviso de que no se pudo leer y NO da el pago por recibido', () => {
    const cfg = fusionar(real({ pendiente: true }));
    const s = normalizar(cfg, { type: 'image', image: { mime_type: 'image/jpeg' } });
    expect(s['esComprobante']).toBe(false);
    expect(String(s['userInput'])).toContain('NO des el pago por recibido');
  });

  it('un PDF también es comprobante; un audio o un sticker, nunca', () => {
    const cfg = fusionar(real({ pendiente: true }));
    const pdf = normalizar(cfg, { type: 'document', document: { id: '1000000000000003', mime_type: 'application/pdf' } });
    expect(pdf['esComprobante']).toBe(true);
    expect(pdf['mimeType']).toBe('application/pdf');
    expect(expresion(
      (nodo(f, '¿Es PDF?').parameters['conditions'] as J).conditions[0].leftValue,
      {}, { 'Normalizar entrada': [pdf] })).toBe(true);
    for (const tipo of ['audio', 'sticker', 'video', 'text']) {
      expect(normalizar(cfg, { type: tipo })['esComprobante'], tipo).toBe(false);
    }
  });

  it('sin id del medio no se desvía: no hay nada que bajar', () => {
    const cfg = fusionar(real({ pendiente: true }));
    expect(normalizar(cfg, { type: 'image', image: {} })['esComprobante']).toBe(false);
  });

  it('EN USO EXTENDIDO el comprobante no espera a que se renueve la ventana', () => {
    const cfg = fusionar({ ...real({ pendiente: true }), body: {
      ...(real({ pendiente: true })['body'] as J),
      atencion: { estado: 'operador', respuestasEnVentana: 51 } } });
    const s = normalizar(cfg, { type: 'image', image: { id: '1000000000000002' } });
    expect(s['atencionEstado']).toBe('operador');
    expect(pasa('¿Comprobante en uso extendido?', s)).toBe(true);
    // En BLOQUEADO no: la regla comercial es no enviar nada más a ese teléfono.
    expect(pasa('¿Comprobante en uso extendido?', { ...s, atencionEstado: 'bloqueado' })).toBe(false);
  });

  it('la cadena del cotejo no pasa por ningún agente', () => {
    const cadena = ['¿Es un comprobante?', 'Obtener URL del medio', 'Descargar comprobante',
      '¿Es PDF?', 'Leer comprobante (PDF)', 'Interpretar lectura', 'Cotejar en el servidor',
      'Respuesta del cobro'];
    for (let i = 0; i < cadena.length - 1; i++) {
      expect(destinos(f, cadena[i]!, 0), `${cadena[i]} → ${cadena[i + 1]}`).toContain(cadena[i + 1]!);
    }
    expect(destinos(f, '¿Es PDF?', 1)).toEqual(['Leer comprobante (imagen)']);
    expect(destinos(f, 'Leer comprobante (imagen)')).toEqual(['Interpretar lectura']);
    // Y la rama falsa de la compuerta es la que lleva al modelo, como siempre.
    expect(destinos(f, '¿Es un comprobante?', 1)).toEqual(['AI Agent NovuChat']);
  });
});

describe('(6) Lo que se le dice al cliente según el cotejo: ninguno afirma un pago', () => {
  const interpretar = (salidaGemini: J, entrada: J, cfg: J): J =>
    ejecutar(codigoDe(f, 'Interpretar lectura'), [salidaGemini],
      { 'Normalizar entrada': [entrada], 'Config del negocio': [cfg] })[0] ?? {};

  const responder = (respuestaHttp: J, previo: J): J =>
    ejecutar(codigoDe(f, 'Respuesta del cobro'), [respuestaHttp],
      { 'Interpretar lectura': [previo] })[0] ?? {};

  const LEIDO = {
    monto: '597,00', cuentaDestino: '1000000890', nombreCuenta: 'COMERCIO BOLIVIANO SRL',
    fecha: '23/09/2026', hora: '10:15', banco: 'BNB',
  };
  const previo = () => {
    const cfg = fusionar(real({ pendiente: true, monto: 597 }));
    const ent = normalizar(cfg, { type: 'image', image: { id: '1000000000000002' } });
    return interpretar({ content: { parts: [{ text: '```json\n' + JSON.stringify(LEIDO) + '\n```' }] } }, ent, cfg);
  };

  it('el nodo NO compara nada: solo sanea las seis claves', () => {
    const p = previo();
    expect(p['legible']).toBe(true);
    expect(p['leido']).toEqual(LEIDO);
    expect(codigoDe(f, 'Interpretar lectura')).not.toMatch(/cuadra|coincide|montoCoincide/);
    // Y lo que viaja al servidor es lo leído, sin veredicto.
    const cuerpo = JSON.parse(String(plantilla(
      nodo(f, 'Cotejar en el servidor').parameters['jsonBody'], p)));
    expect(cuerpo).toEqual({ telefono: '59170000001', legible: true, leido: LEIDO, idMeta: 'wamid.PRUEBA' });
  });

  it('una salida que no es JSON deja el comprobante ilegible', () => {
    const cfg = fusionar(real({ pendiente: true }));
    const ent = normalizar(cfg, { type: 'image', image: { id: '1000000000000002' } });
    expect(interpretar({ content: { parts: [{ text: 'no pude leerlo' }] } }, ent, cfg)['legible']).toBe(false);
  });

  it('CUADRA: se dice que los datos coinciden, NUNCA que el pago entró', () => {
    const s = responder({ statusCode: 200, body: { resultado: 'cuadra', diferencias: [], importe: 597,
      moneda: 'BOB', cierreId: 'venta_wamid' } }, previo());
    const t = String(s['respuesta']);
    expect(t).toMatch(/los datos coinciden/i);
    expect(t).not.toMatch(AFIRMA_PAGO);
    expect(t).not.toMatch(DICE_SIMULADO);
    // Con los datos coincidiendo no se avisa: el cierre ya está en la consola.
    expect(s['transferir']).toBe(false);
    expect(pasa('¿Avisar del cobro?', { ...s, numeroDueno: '59170000009' })).toBe(false);
  });

  it('NO CUADRA e ILEGIBLE: lo revisa una persona, y el aviso SALE de verdad', () => {
    for (const [resultado, marca] of [['no_cuadra', /no me coincide/i], ['ilegible', /no pude leerlo/i]] as const) {
      const s = responder({ statusCode: 200, body: { resultado,
        diferencias: ['El comprobante dice 350 y el pedido es de 597.'], importe: 597 } }, previo());
      expect(String(s['respuesta']), resultado).toMatch(marca);
      expect(String(s['respuesta']), resultado).not.toMatch(AFIRMA_PAGO);
      expect(s['transferir'], resultado).toBe(true);
      expect(pasa('¿Avisar del cobro?', { ...s, numeroDueno: '59170000009' }), resultado).toBe(true);
      expect(String(s['textoAviso']), resultado).not.toBe('');
    }
  });

  it('SIN COTEJO (409 o panel caído): nunca se deja al cliente sin respuesta', () => {
    for (const r of [{ statusCode: 409, body: { error: 'sin_total' } },
                     { statusCode: 409, body: { error: 'sin_sena_pendiente' } },
                     { statusCode: 500, body: {} }, {}]) {
      const s = responder(r, previo());
      expect(String(s['respuesta'])).toContain('Recibí tu comprobante');
      expect(String(s['respuesta'])).not.toMatch(AFIRMA_PAGO);
      expect(s['transferir']).toBe(true);
    }
  });

  it('SOLO SE OFRECE LO QUE SE CUMPLE: todo lo que promete una persona, la avisa', () => {
    // La política del 21/09/2026: ninguna promesa sin mecanismo detrás. Si el
    // texto dice «lo revisa una persona», `transferir` tiene que ser true y el
    // aviso tiene que llegar al número del negocio.
    for (const r of [{ statusCode: 200, body: { resultado: 'no_cuadra', diferencias: [] } },
                     { statusCode: 200, body: { resultado: 'cuadra', diferencias: [] } },
                     { statusCode: 409, body: { error: 'sin_total' } }]) {
      const s = responder(r, previo());
      const prometeUnaPersona = /revisa una persona|te escribe por acá/i.test(String(s['respuesta']));
      expect(prometeUnaPersona, String(s['respuesta'])).toBe(s['transferir'] === true);
    }
  });

  it('el aviso NUNCA va al propio número del cliente', () => {
    const s = responder({ statusCode: 200, body: { resultado: 'ilegible' } }, previo());
    expect(pasa('¿Avisar del cobro?', { ...s, numeroDueno: s['from'] })).toBe(false);
  });
});

describe('(7) El cierre de la venta nace de un HECHO, no de una palabra', () => {
  const hayCierre = (cfgPanel: J, mensaje: J, textoDelModelo: string): J => {
    const cfg = fusionar(cfgPanel);
    const ent = normalizar(cfg, mensaje);
    const previo = procesar(textoDelModelo, ent);
    return ejecutar(codigoDe(f, '¿Hay comprobante?'), [previo],
      { 'Normalizar entrada': [ent] })[0] ?? {};
  };
  const IMAGEN = { type: 'image', image: { id: '1000000000000002' } };

  it('SIMULADO: con QR pendiente y archivo del cliente, hay cierre', () => {
    const s = hayCierre(simulado({ pendiente: true }), IMAGEN, 'Listo. [PEDIDO_CONFIRMADO]');
    expect(s['hayCierre']).toBe(true);
    expect(s['referenciaCierre']).toBe('wamid.PRUEBA');
    expect(pasa('¿Registrar venta?', s)).toBe(true);
  });

  it('EL DEFECTO VIEJO, NEGADO: sin la palabra «SIMULADO» el cierre se registra igual', () => {
    // Antes esto daba `false`, porque el cierre dependía de que el modelo
    // escribiera esa palabra. Un prompt nuevo la dejaba de decir y los cierres
    // desaparecían sin un solo error a la vista.
    const s = hayCierre(simulado({ pendiente: true }), IMAGEN, 'Gracias, ya lo preparamos.');
    expect(s['hayCierre']).toBe(true);
    // Y la palabra ya no se busca en ninguna parte del código (los comentarios
    // sí la nombran, para explicar el defecto que esto cerró).
    const sinComentarios = codigoDe(f, '¿Hay comprobante?')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(sinComentarios).not.toMatch(/SIMULADO/i);
    expect(sinComentarios).not.toMatch(/item\.respuesta|\.respuesta\b/);
  });

  it('EL OTRO LADO, NEGADO: una imagen SIN QR pendiente no cierra ninguna venta', () => {
    const s = hayCierre(simulado({ pendiente: false }), IMAGEN, 'Pago recibido (SIMULADO). [PEDIDO_CONFIRMADO]');
    expect(s['hayCierre']).toBe(false);
    expect(pasa('¿Registrar venta?', s)).toBe(false);
  });

  it('un texto no cierra una venta por mucho que el modelo lo afirme', () => {
    const s = hayCierre(simulado({ pendiente: true }),
      { type: 'text', text: { body: 'ya pagué' } }, 'Pago verificado (SIMULADO). [PEDIDO_CONFIRMADO]');
    expect(s['hayCierre']).toBe(false);
  });

  it('REAL: el cierre lo crea el SERVIDOR al cotejar, así que acá no se crea otro', () => {
    const s = hayCierre(real({ pendiente: true }), IMAGEN, 'Listo.');
    expect(s['hayCierre']).toBe(false);
  });
});

describe('(8) El reenvío del QR, y el QR que Meta rechazó', () => {
  it('la marca solo vale si hay un QR pendiente de verdad', () => {
    const conQr = fusionar(real({ pendiente: true, monto: 597 }));
    expect(procesar('Te lo reenvío. [REENVIAR_QR]', conQr)['reenviarQr']).toBe(true);
    const sinQr = fusionar(real({ pendiente: false }));
    expect(procesar('Te lo reenvío. [REENVIAR_QR]', sinQr)['reenviarQr']).toBe(false);
    // Y la marca nunca llega al cliente.
    expect(String(procesar('Te lo reenvío. [REENVIAR_QR]', conQr)['respuesta'])).not.toContain('[');
  });

  it('el reenvío manda el MISMO QR, con el importe pendiente y sin afirmar ningún pago', () => {
    const cfg = fusionar(real({ pendiente: true, monto: 597 }));
    const s = ejecutar(codigoDe(f, 'Preparar reenvío del QR'),
      [procesar('Te lo reenvío. [REENVIAR_QR]', cfg)], { 'Config del negocio': [cfg] })[0] ?? {};
    expect(String(s['captionQr'])).toContain('597 Bs');
    expect(String(s['captionQr'])).not.toMatch(AFIRMA_PAGO);
    expect(String(s['captionQr'])).not.toMatch(DICE_SIMULADO);
    expect(s['qrEnlace']).toBe(QR_REAL);
    expect(s['esReenvio']).toBe(true);
    expect(s['cobroTotal']).toBe('');
  });

  it('en simulado el reenvío también lleva su rótulo', () => {
    const cfg = fusionar(simulado({ pendiente: true, monto: 350 }));
    const s = ejecutar(codigoDe(f, 'Preparar reenvío del QR'),
      [procesar('Te lo reenvío. [REENVIAR_QR]', cfg)], { 'Config del negocio': [cfg] })[0] ?? {};
    expect(String(s['captionQr']).startsWith(String(cfg['rotuloDemo']))).toBe(true);
  });

  it('un QR que Meta rechazó avisa al negocio y NO se reporta como enviado', () => {
    const s = ejecutar(codigoDe(f, 'QR no enviado'),
      [{ error: { message: 'media id no válido' } }],
      { 'Preparar QR de cobro': [{ from: '59170000001', nombrePerfil: 'Ana', cobroTotal: '597' }] })[0] ?? {};
    expect(s['transferir']).toBe(true);
    expect(String(s['textoAviso'])).toContain('no se pudo enviar el QR');
    expect(String(s['textoAviso'])).toContain('media id no válido');
    // La salida de error del envío va al aviso, NUNCA al reporte del saliente.
    expect(destinos(f, 'Enviar QR de cobro', 1)).toEqual(['QR no enviado']);
    expect(destinos(f, 'Enviar QR de cobro', 0)).toEqual(['Reportar QR (saliente)']);
    expect(destinos(f, 'QR no enviado')).toEqual(['Avisar al dueño']);
  });
});

describe('(9) El orden del lienzo y el costo en mensajes', () => {
  it('el mensaje del cliente se sigue reportando ANTES que la rama del agente', () => {
    expect(f.settings?.executionOrder).toBe('v1');
    expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('¿Comercio operativo?'));
  });

  it('el envío al cliente va ARRIBA del aviso al negocio, en la rama del cotejo', () => {
    expect(destinos(f, 'Respuesta del cobro')).toEqual(['Responder al cliente', '¿Avisar del cobro?']);
    expect(y('Responder al cliente')).toBeLessThan(y('¿Avisar del cobro?'));
  });

  it('la rama del carrito sigue abajo de todo', () => {
    for (const n of ['Carrito del catálogo', 'Validar carrito', 'Mensaje del carrito']) {
      expect(y(n), n).toBeGreaterThanOrEqual(1020);
    }
    for (const n of ['Preparar QR de cobro', 'Respuesta del cobro', 'Interpretar lectura']) {
      expect(y(n), n).toBeLessThan(1020);
    }
  });

  it('NINGÚN mensaje de WhatsApp agregado: los mismos dos emisores de siempre', () => {
    const emisores = f.nodes.filter((n) => n.type === 'n8n-nodes-base.whatsApp'
      && n.parameters['operation'] === 'send').map((n) => n.name).sort();
    expect(emisores).toEqual(['Avisar al dueño', 'Responder al cliente']);
    // Y el único HTTP que le manda un mensaje al cliente es el del QR, que
    // reemplaza al que ya existía: no hay un segundo envío nuevo.
    //
    // EL HOST SE COMPARA ENTERO, NO POR SUBCADENA, y también acá. CodeQL lo
    // marca como `js/incomplete-url-substring-sanitization` —con razón:
    // `includes('graph.facebook.com')` da por buena a
    // `https://graph.facebook.com.otro-dominio.tld`— y el proyecto ya tiene la
    // regla escrita para el código; una prueba que la incumple enseña a
    // incumplirla. Como el `url` del nodo es una expresión de n8n con `{{ }}`,
    // se compara el host del primer tramo, que es donde vive el dominio.
    const HOST_META = 'graph.facebook.com';
    const vaAMeta = (url: string): boolean => {
      // El `=` del principio marca una expresión de n8n; el host va antes de
      // la primera `{{`, así que sale entero y se compara entero.
      const host = /^=?https:\/\/([^/?#{]+)/i.exec(url)?.[1]?.toLowerCase() ?? '';
      return host === HOST_META || host.endsWith(`.${HOST_META}`);
    };
    const porGraph = f.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest'
      && vaAMeta(String(n.parameters['url'] ?? ''))).map((n) => n.name);
    expect(porGraph).toEqual(['Enviar QR de cobro']);
  });

  it('lo que se reporta como saliente es el texto del COTEJO, no el del modelo', () => {
    // «Texto enviado» averigua cuál de los caminos armó lo que salió. Si
    // «Respuesta del cobro» no estuviera en su lista, el turno del comprobante
    // se reportaría con el texto del modelo --o con nada-- y la consola, que es
    // donde se mira lo que Meta cobra, registraría otra cosa.
    const codigo = codigoDe(f, 'Texto enviado');
    expect(codigo).toContain("'Respuesta del cobro'");
    const fuentes = /const FUENTES = \[([\s\S]*?)\];/.exec(codigo)?.[1] ?? '';
    expect(fuentes.indexOf('Respuesta del cobro')).toBeLessThan(fuentes.indexOf('Procesar respuesta'));
    const salida = ejecutar(codigo, [{ messages: [{ id: 'wamid.SALIENTE' }] }], {
      'Normalizar entrada': [{ from: '59170000001', phoneNumberId: '1000000001' }],
      'Respuesta del cobro': [{ from: '59170000001', phoneNumberId: '1000000001',
        respuesta: 'Recibí tu comprobante y los datos coinciden con tu pedido.' }],
    })[0] ?? {};
    expect(salida).toMatchObject({
      telefono: '59170000001', idMeta: 'wamid.SALIENTE', fuenteDelTexto: 'Respuesta del cobro',
    });
    expect(String(salida['texto'])).toContain('los datos coinciden');
  });

  it('los ids nuevos son nombres cortos, sin UUID, y no se repiten', () => {
    const ids = f.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('las credenciales nuevas van por nombre, con id vacío', () => {
    for (const n of ['Enviar QR de cobro', 'Obtener URL del medio', 'Descargar comprobante',
                     'Reportar QR (saliente)', 'Cotejar en el servidor']) {
      const c = Object.values(nodo(f, n).credentials ?? {})[0] as { id?: string; name?: string };
      expect(c?.id, n).toBe('');
      expect(c?.name, n).not.toBe('');
    }
  });
});

describe('(10) El prompt: el bloque de cobro cambia con el modo', () => {
  const sistema = String((nodo(f, 'AI Agent NovuChat').parameters['options'] as J)['systemMessage']);
  const render = (cfg: J) => plantilla(sistema, { ...configBase(f), ...cfg });

  it('ya no promete que «el banco lo confirma por webhook»: eso no existe', () => {
    // Hallazgo del 23/09: la regla 10 decía que en producción la acreditación
    // la confirma el banco por webhook. No hay tal webhook, y es justo lo que
    // la prohibición 3 niega: quien confirma es el negocio, en su banco.
    expect(sistema).not.toMatch(/webhook/i);
  });

  it('REAL: le prohíbe afirmar un pago y le prohíbe decir «demostración»', () => {
    const t = render({ cobroRealActivo: 'si' });
    expect(t).toContain('EL DINERO VA A LA CUENTA DEL NEGOCIO');
    expect(t).toMatch(/NUNCA digas ni insinúes que un pago está acreditado/);
    expect(t).toMatch(/NUNCA digas que el cobro es una demostración/);
    expect(t).toContain('[REENVIAR_QR]');
    // Y no le enseña a decir el texto del pago simulado.
    expect(t).not.toContain('ES UNA DEMOSTRACIÓN, NUNCA UN COBRO REAL');
  });

  it('SIMULADO: sigue siendo el bloque de siempre, con su rótulo', () => {
    const t = render({ cobroRealActivo: '', textoPagoSimulado: 'Pago verificado (SIMULADO).' });
    expect(t).toContain('ES UNA DEMOSTRACIÓN, NUNCA UN COBRO REAL');
    expect(t).toContain('Pago verificado (SIMULADO).');
    expect(t).toContain('[PEDIDO_CONFIRMADO]');
    expect(t).not.toContain('EL DINERO VA A LA CUENTA DEL NEGOCIO');
  });

  it('los dos bloques le piden que el total sea el último número del mensaje', () => {
    for (const modo of ['si', '']) {
      expect(render({ cobroRealActivo: modo }), modo).toMatch(/último número de tu mensaje sea el TOTAL|último número de tu mensaje sea el TOTAL a pagar/);
    }
  });
});
