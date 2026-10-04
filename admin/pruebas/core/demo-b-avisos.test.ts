/**
 * DEMO B: LOS AVISOS AL DUEÑO SE VERIFICAN (PR-4 del plan «se entrega lo que se promete», 03/10/2026).
 *
 * Cada defecto se prueba NEGANDO, ejecutando el código del JSON versionado y con Meta rechazando el envío:
 *
 *   (a) `Avisar al dueño` tenía `continueRegularOutput` y nadie leía su salida: el aviso del pedido, del cobro
 *       y del uso extendido podía fallar callado. Ahora lo lee `Verificar aviso al dueño`.
 *   (b) El texto de una transferencia decía «Le aviso a…» ANTES de que el aviso se intentara. Ahora no anuncia
 *       nada en ese turno (solo el botón) y «Ya le avisé» solo sale si un aviso anterior dejó la marca, que
 *       únicamente se escribe con el id de Meta en la mano.
 *   (c) El aviso de «pedido confirmado» salía aunque el QR del mismo turno hubiera fallado.
 *   (d) El despacho «hoy a las 17:00» del demo era una promesa sin mecanismo.
 *
 * COSTO EN MENSAJES: 0 por conversación en el camino normal (se agrega un NODO de envío, no un mensaje: la
 * transferencia pasa por su propio envío en vez de compartir el del pedido). Con un aviso rechazado no se agrega
 * ningún mensaje: el cliente ya tenía su texto y el botón, y el aviso no se reintenta más allá del reintento del
 * propio nodo (`maxTries` 2, que ya existía).
 */
import { describe, expect, it } from 'vitest';
import { codigoDe, configBase, destinos, ejecutar, entradas, expresion, leerFlujo, nodo, plantilla, type J } from '../lib/flujo.ts';

const f = leerFlujo('demo-b-venta-cobro.json');
const DUENO = '59170000009';
const CLIENTE = '59170000001';
const ENT: J = {
  from: CLIENTE, nombrePerfil: 'Ana', phoneNumberId: '1000000001', numeroDueno: DUENO,
  waGraphVersion: 'v26.0', nombreNegocio: 'Un Negocio', userInput: 'quiero hablar con una persona',
  rotuloDemo: 'rótulo simulado', textoPagoSimulado: 'Pago verificado (SIMULADO).',
};
const reloj = (ahora: { t: number }) => class extends Date { static override now() { return ahora.t; } };

const RECHAZO = { error: { message: '(#131047) Re-engagement message' } };
const ACEPTADO = { messages: [{ id: 'wamid.AVISO' }] };

function procesar(salida: J, sd: J, ahora: { t: number }): J {
  return ejecutar(codigoDe(f, 'Procesar respuesta'), [salida], { 'Normalizar entrada': [ENT] },
    { $getWorkflowStaticData: () => sd, Date: reloj(ahora) })[0] ?? {};
}
const enviar = (item: J): J =>
  ejecutar(codigoDe(f, 'Mensaje a enviar'), [item], { 'Config del negocio': [{ numeroDueno: DUENO, nombreNegocio: 'Un Negocio' }] })[0] ?? {};
const mapear = (p: J): J => ejecutar(codigoDe(f, 'Aviso de transferencia'), [p])[0] ?? {};
function marcar(sd: J, ahora: { t: number }, p: J, meta: J): J {
  const registro: unknown[] = [];
  const s = ejecutar(codigoDe(f, 'Marcar aviso de transferencia'), [meta], { 'Aviso de transferencia': [mapear(p)] },
    { $getWorkflowStaticData: () => sd, Date: reloj(ahora), console: { error: (...a: unknown[]) => registro.push(a) } })[0] ?? {};
  return { ...s, registro };
}

describe('(a) «Avisar al dueño»: su salida se verifica', () => {
  const verificar = (meta: J) => {
    const registro: unknown[][] = [];
    const s = ejecutar(codigoDe(f, 'Verificar aviso al dueño'), [meta], {}, { console: { error: (...a: unknown[]) => registro.push(a) } })[0] ?? {};
    return { s, registro };
  };

  it('Meta rechaza el aviso: queda `avisoAceptado: false` y el código de Meta EN LOS DATOS de la ejecución', () => {
    // Forma REAL en n8n 2.36.5 con continueOnFail: `error` es TEXTO.
    const { s } = verificar({ error: '(#131047) Re-engagement message' });
    expect(s['avisoAceptado']).toBe(false);
    expect(s['avisoError']).toEqual({ code: 131047 });
    // Mismo criterio en «Marcar aviso de transferencia».
    const m = marcar({}, { t: 1_800_000_000_000 }, procesar({ output: '[TRANSFERIR]' }, {}, { t: 1_800_000_000_000 }), { error: '(#131047) Re-engagement message' });
    expect(m['avisoError']).toEqual({ code: 131047 });
    // Sin código reconocible: null, nunca un error.
    expect(verificar({ error: 'timeout' }).s['avisoError']).toEqual({ code: null });
  });

  it('el módulo no promete una línea en el registro del servidor', () => {
    expect(codigoDe(f, 'Verificar aviso al dueño').replace(/\/\/.*$/gm, '')).not.toMatch(/console\./);
  });

  it('Meta responde sin id (200 sin messages): tampoco cuenta como aceptado', () => {
    expect(verificar({}).s['avisoAceptado']).toBe(false);
    expect(verificar({ messages: [{}] }).s['avisoAceptado']).toBe(false);
    expect(verificar({ messages: [{ id: '' }] }).s['avisoAceptado']).toBe(false);
  });

  it('Meta acepta: aceptado y sin `avisoError`', () => {
    const { s, registro } = verificar(ACEPTADO);
    expect(s['avisoAceptado']).toBe(true);
    expect(s['avisoError']).toBeUndefined();
    expect(registro).toHaveLength(0);
  });

  it('no corta la ejecución: un aviso rechazado no detiene el cierre de la venta que viene después', () => {
    expect(() => verificar(RECHAZO)).not.toThrow();
    expect(codigoDe(f, 'Verificar aviso al dueño').replace(/\/\/.*$/gm, '')).not.toMatch(/\bthrow\b/);
  });

  it('el pedido, el QR no enviado, el cobro y el uso extendido llegan a ese único envío, y de él al verificador', () => {
    expect(entradas(f, 'Avisar al dueño').sort()).toEqual(['QR no enviado', '¿Avisar del cobro?', '¿Avisar uso extendido?', '¿Pedido confirmado?'].sort());
    expect(destinos(f, 'Avisar al dueño')).toEqual(['Verificar aviso al dueño']);
    expect(nodo(f, 'Avisar al dueño').onError).toBe('continueRegularOutput');
  });
});

describe('(b) «Le aviso» / «Ya le avisé» solo si el aviso salió', () => {
  const MARCA = 'Ya le avisé a Un Negocio';

  it('el turno de la transferencia no anuncia el aviso: solo el botón (el aviso todavía no se intentó)', () => {
    const sd: J = {};
    const ahora = { t: 1_800_000_000_000 };
    const p = procesar({ output: '[TRANSFERIR]' }, sd, ahora);
    expect(p['avisarDueno']).toBe(true);
    expect(p['respuesta']).toBe('Para que te atienda una persona de Un Negocio, toca el botón y escríbele directo.');
    expect(enviar(p)['conBoton']).toBe(true);
  });

  it('el modelo escribe «le aviso» o «ya le avisé» en ese turno: el código lo quita', () => {
    for (const o of ['Le aviso a Un Negocio. Toca el botón para escribirle.', 'Ya le avisé a recepción. Toca el botón para escribirle.',
      'Ya avisé a Un Negocio, toca el botón.', 'El sistema ya le avisó. Toca el botón.']) {
      const p = procesar({ output: o + ' [TRANSFERIR]' }, {}, { t: 1_800_000_000_000 });
      expect(p['avisos'], o).toContain('aviso_anunciado_quitado');
      expect(String(p['respuesta']), o).not.toMatch(/avis/i);
      expect(enviar(p)['conBoton'], o).toBe(true);
    }
    // Una pregunta no promete nada y queda.
    const q = procesar({ output: '¿Quieres que le avise a Un Negocio? [TRANSFERIR]' }, {}, { t: 1_800_000_000_000 });
    expect(q['avisos']).not.toContain('aviso_anunciado_quitado');
  });

  it('Meta RECHAZA el aviso: ninguna marca, ningún «ya le avisé» después, y el cliente sigue con botón', () => {
    const sd: J = {};
    const ahora = { t: 1_800_000_000_000 };
    const turno1 = procesar({ output: '[TRANSFERIR]' }, sd, ahora);
    const m = marcar(sd, ahora, turno1, RECHAZO);
    expect(m['avisoAceptado']).toBe(false);
    expect(sd['avisosTransferencia'][CLIENTE]).toBeUndefined();
    // El cliente insiste: se vuelve a intentar el aviso y el texto NO dice que ya se avisó.
    ahora.t += 60_000;
    const turno2 = procesar({ output: '[TRANSFERIR]' }, sd, ahora);
    expect(turno2['avisarDueno']).toBe(true);
    expect(String(turno2['respuesta'])).not.toContain(MARCA);
    expect(String(turno2['respuesta'])).toContain('escríbele directo');
    expect(enviar(turno2)['conBoton']).toBe(true);
  });

  it('Meta ACEPTA el aviso: la marca queda y, ahora sí, el siguiente turno dice «Ya le avisé»', () => {
    const sd: J = {};
    const ahora = { t: 1_800_000_000_000 };
    const turno1 = procesar({ output: '[TRANSFERIR]' }, sd, ahora);
    expect(marcar(sd, ahora, turno1, ACEPTADO)['avisoAceptado']).toBe(true);
    ahora.t += 60_000;
    const turno2 = procesar({ output: '[TRANSFERIR]' }, sd, ahora);
    expect(turno2['avisarDueno']).toBe(false);
    expect(String(turno2['respuesta'])).toContain(MARCA);
    expect(enviar(turno2)['conBoton']).toBe(true);
  });

  it('el aviso por transferencia tiene su propio envío: ningún otro aviso puede marcar la ventana', () => {
    expect(entradas(f, 'Avisar al dueño (transferencia)')).toEqual(['Aviso de transferencia']);
    expect(destinos(f, 'Avisar al dueño (transferencia)')).toEqual(['Marcar aviso de transferencia']);
    expect(nodo(f, 'Avisar al dueño (transferencia)').onError).toBe('continueRegularOutput');
    expect(String(nodo(f, 'Avisar al dueño (transferencia)').parameters['recipientPhoneNumber'])).toContain('numeroDueno');
    // El texto sale del aviso de transferencia, no del del pedido.
    const p = procesar({ output: 'Listo. [PEDIDO_CONFIRMADO] [TRANSFERIR]' }, {}, { t: 1_800_000_000_000 });
    expect(plantilla(nodo(f, 'Avisar al dueño (transferencia)').parameters['textBody'], mapear(p))).toContain('necesita atención de una persona');
  });

  it('el orden del lienzo no cambia: la rama de la transferencia sigue debajo de la respuesta al cliente', () => {
    const y = (n: string) => nodo(f, n).position?.[1] ?? Number.NaN;
    expect(y('¿Responder ahora?')).toBeLessThan(y('¿Transferir al dueño?'));
    expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('AI Agent NovuChat'));
  });
});

describe('(b2) El filtro de avisos anunciados (tildes, presente, pasado, falsos positivos)', () => {
  const turno = (o: string, ent: J = {}, sd: J = {}) => {
    const ahora = { t: 1_800_000_000_000 };
    return ejecutar(codigoDe(f, 'Procesar respuesta'), [{ output: o }], { 'Normalizar entrada': [{ ...ENT, ...ent }] },
      { $getWorkflowStaticData: () => sd, Date: reloj(ahora) })[0] ?? {};
  };
  const FORMAS = ['Ya le avisé.', 'Ya se le avisó al negocio.', 'Ya les informé, toca el botón.', 'Le notifiqué al negocio.',
    'Ya le comuniqué tu pedido.', 'Ya he avisado a recepción.', 'El negocio fue avisado.', 'Ya están avisados.', 'Entonces le avisaré a Un Negocio.',
    'Puedo avisarle ahora.', 'Le avisaré a Un Negocio.', 'El sistema le avisa ahora.', 'Le pasé tu consulta.'];

  it('con transferencia y aviso por salir, todas esas formas se quitan (también las que terminan en é/ó)', () => {
    for (const o of FORMAS) {
      const p = turno(o + ' Toca el botón para escribirle. [TRANSFERIR]');
      // «le avisaré» lo quita también el filtro de promesas anterior: basta con que se quite alguno.
      expect((p['avisos'] as string[]).some((a) => /^(aviso_anunciado|promesa)_quitad/.test(a)), o).toBe(true);
      expect(String(p['respuesta']), o).not.toMatch(/avis|notific|inform|comuniqu|le pas[eé]/i);
      expect(String(p['respuesta']), o).toContain('botón');
    }
  });

  it('con la ventana ya marcada se conserva «ya le avisé», pero no el presente ni el futuro', () => {
    const sd: J = { avisosTransferencia: { [CLIENTE]: 1_800_000_000_000 - 60_000 } };
    const pasado = turno('Ya le avisé a Un Negocio. Toca el botón. [TRANSFERIR]', {}, sd);
    expect(pasado['avisos']).not.toContain('aviso_anunciado_quitado');
    expect(String(pasado['respuesta'])).toContain('Ya le avisé');
    for (const o of ['Le aviso a Un Negocio.', 'Le avisaré a Un Negocio.', 'Puedo avisarle.']) {
      const r = turno(o + ' Toca el botón. [TRANSFERIR]', {}, sd);
      expect((r['avisos'] as string[]).some((a) => /^(aviso_anunciado|promesa)_quitad/.test(a)), o).toBe(true);
      expect(String(r['respuesta']), o).not.toMatch(/avis/i);
    }
  });

  it('sin marca vigente se filtra también sin transferencia, y cuando escribe el dueño', () => {
    expect(turno('Ya le avisé a recepción, ¿algo más?')['avisos']).toContain('aviso_anunciado_quitado');
    const dueno = turno('Le aviso al negocio. Toca el botón. [TRANSFERIR]', { from: DUENO });
    expect(dueno['avisos']).toContain('aviso_anunciado_quitado');
    expect(String(dueno['respuesta'])).not.toMatch(/avis/i);
    // La marca del DUEÑO no cuenta aunque exista.
    const sd: J = { avisosTransferencia: { [DUENO]: 1_800_000_000_000 - 60_000 } };
    expect(turno('Ya le avisé. Toca el botón. [TRANSFERIR]', { from: DUENO }, sd)['avisos']).toContain('aviso_anunciado_quitado');
  });

  it('una pregunta pegada tras una coma queda; «le aviso que…» y «le informo» no son anuncios', () => {
    const q = turno('Ya le avisé, ¿quieres algo más? [TRANSFERIR]');
    expect(String(q['respuesta'])).toBe('¿quieres algo más?');
    for (const o of ['Le aviso que el pedido mínimo es de 30 Bs.', 'Le informo que el total es de 70 Bs.', 'Le comunico el precio: 15 Bs.']) {
      expect(turno(o)['avisos'], o).not.toContain('aviso_anunciado_quitado');
    }
  });
});

describe('(b3) Más formas, troceo, falsos positivos y líneas', () => {
  const turno = (o: string, ent: J = {}, sd: J = {}) => ejecutar(codigoDe(f, 'Procesar respuesta'), [{ output: o }],
    { 'Normalizar entrada': [{ ...ENT, ...ent }] }, { $getWorkflowStaticData: () => sd, Date: reloj({ t: 1_800_000_000_000 }) })[0] ?? {};
  const quita = (o: string) => (turno(o)['avisos'] as string[]).some((a) => /^(aviso_anunciado|promesa)_quitad/.test(a));
  const FORMAS = ['Notifiqué al negocio.', 'Ya informé a la dueña.', 'Comuniqué al negocio tu caso.', 'Ya he notificado al negocio.', 'Hemos informado al negocio.',
    'Acabo de avisar a recepción.', 'Le estoy avisando a Un Negocio.', 'Le avisó a la dueña.', 'Pasé tu pedido al negocio.', 'Mandé tu consulta a recepción.',
    'Envié tu mensaje al negocio.', 'Escribí a la dueña.', 'Aviso al negocio ahora mismo.', 'Ahora aviso a recepción.', 'Le hemos notificado.', 'Ya está al tanto.',
    'Le avisaremos que llegaste.', 'Estamos avisando al negocio.', 'Le paso tu consulta al negocio.', 'Le estoy pasando tu pedido a recepción.', 'Ya avisé.', 'Ya les informé,', 'Ya le comuniqué tu pedido.', 'Te avisamos por aquí cuando esté listo.', 'Te avisamos cuando esté listo.'];

  it('cada forma se quita', () => {
    for (const o of FORMAS) expect(quita(o + ' Toca el botón. [TRANSFERIR]'), o).toBe(true);
  });

  it('troceo: la pregunta pegada tras «a la dueña», coma o punto y coma no salva el anuncio', () => {
    for (const o of ['Ya le avisé a la dueña ¿algo más?', 'Le avisé a Un Negocio; ¿algo más?', 'Le aviso a Un Negocio, ¿algo más?']) {
      const p = turno(o + ' [TRANSFERIR]');
      expect(p['avisos'], o).toContain('aviso_anunciado_quitado');
      expect(String(p['respuesta']), o).toContain('¿algo más?');
      expect(String(p['respuesta']), o).not.toMatch(/avis/i);
    }
  });

  it('un anuncio pegado a un monto no se lleva el monto', () => {
    for (const o of ['Tu total es 80 Bs; ya le avisé al negocio.', 'Total: 80 Bs, ya le avisé al negocio.', 'Total: 80 Bs, le avisé al negocio.']) {
      const p = turno(o + ' [TRANSFERIR]');
      expect(p['avisos'], o).toContain('aviso_anunciado_quitado');
      expect(String(p['respuesta']), o).toContain('80 Bs');
      expect(String(p['respuesta']), o).not.toMatch(/avis/i);
    }
  });

  it('falsos positivos: lo que informa, no anuncia, se conserva', () => {
    for (const o of ['Le informé el precio antes: 10 Bs.', 'Le aviso: el pedido mínimo es 30 Bs.', 'Como le comuniqué, el total es 70 Bs.',
      'Como le informé, el envío cuesta 10 Bs.', 'Ya le comuniqué el total: 70 Bs.', 'Le aviso que el pedido mínimo es 30 Bs.', 'Ya te he informado del precio: 10 Bs.', 'Ya te lo he informado.', 'Ya informé al cliente del precio.', 'Como ya le informé, el envío cuesta 10 Bs.', 'Ya te la he notificado.']) {
      const p = turno(o);
      expect(p['avisos'], o).not.toContain('aviso_anunciado_quitado');
      expect(String(p['respuesta']), o).toBe(o);
    }
  });

  it('«cuando» no rompe lo legítimo (y «te mando» sin tiempo sigue igual)', () => {
    for (const o of ['Cuando quieras te muestro el catálogo.', 'Te mando el catálogo ahora.', 'Escríbeme cuando decidas.', 'Te aviso cuando me digas la dirección.', 'Te confirmo cuando me envíes el comprobante.']) {
      expect(turno(o)['avisos'], o).not.toContain('promesa_quitada');
    }
  });

  it('si el filtro deja la respuesta vacía en un turno con transferencia, queda el texto de transferencia con botón', () => {
    const p = turno('Ya le avisé a la dueña. [TRANSFERIR]');
    expect(p['avisos']).not.toContain('respuesta_vacia');
    expect(String(p['respuesta'])).toBe('Para que te atienda una persona de Un Negocio, toca el botón y escríbele directo.');
    expect(enviar(p)['conBoton']).toBe(true);
  });

  it('un resumen de pedido de varias líneas conserva sus saltos al quitar una oración', () => {
    const o = 'Tu pedido:\n- 2 pizzas: 70 Bs\n- 1 gaseosa: 10 Bs\nTotal: 80 Bs. Ya le avisé al negocio.';
    const p = turno(o);
    expect(p['avisos']).toContain('aviso_anunciado_quitado');
    expect(String(p['respuesta'])).toBe('Tu pedido:\n- 2 pizzas: 70 Bs\n- 1 gaseosa: 10 Bs\nTotal: 80 Bs.');
  });
});

describe('(c) Con el QR del turno fallido, el pedido no se anuncia como confirmado', () => {
  const texto = nodo(f, 'Avisar al dueño').parameters['textBody'];
  const p = procesar({ output: 'Listo, tu pedido. [PEDIDO_CONFIRMADO] [ENVIAR_QR]' }, {}, { t: 1_800_000_000_000 });

  it('QR fallido: «PEDIDO SIN CONFIRMAR», sin «NUEVO PEDIDO CONFIRMADO»', () => {
    const aviso = String(expresion(texto, p, { 'QR no enviado': [{}] }));
    expect(aviso).toContain('PEDIDO SIN CONFIRMAR');
    expect(aviso).toContain('NO llegó al cliente');
    expect(aviso).not.toContain('NUEVO PEDIDO CONFIRMADO');
  });

  it('QR enviado: el aviso de siempre', () => {
    const aviso = String(expresion(texto, p, {}));
    expect(aviso).toContain('NUEVO PEDIDO CONFIRMADO');
    expect(aviso).not.toContain('SIN CONFIRMAR');
  });

  it('en ningún caso afirma un pago (prohibición 3): solo dice que no hay acreditación', () => {
    for (const refs of [{}, { 'QR no enviado': [{}] }]) {
      const aviso = String(expresion(texto, p, refs));
      expect(aviso).not.toMatch(/pago\s+(acreditado|verificado|recibido)|recibimos tu pago|ya (se )?acredit/i);
      expect(aviso).toContain('SIMULADO');
    }
  });

  it('«¿Pedido confirmado?» no deja pasar el pedido cuando el QR del turno falló: no hay doble aviso', () => {
    const cond = (nodo(f, '¿Pedido confirmado?').parameters['conditions'] as J)['conditions'] as J[];
    const pasa = (refs: Record<string, J[]>) => cond.every((c) => {
      const v = expresion(c.leftValue, { ...p, from: CLIENTE, numeroDueno: DUENO }, refs);
      const op = c.operator;
      if (op.type === 'boolean') return op.operation === 'true' ? v === true : v === false;
      return String(v) !== String(c.rightValue === '={{ $json.from }}' ? CLIENTE : c.rightValue);
    });
    expect(pasa({})).toBe(true);
    expect(pasa({ 'QR no enviado': [{}] })).toBe(false);
  });

  it('el único otro camino al aviso del pedido es la compuerta «¿Pedido confirmado?», y el QR fallido avisa por su propio nodo', () => {
    expect(entradas(f, 'Avisar al dueño')).toContain('¿Pedido confirmado?');
    expect(entradas(f, 'Avisar al dueño')).toContain('QR no enviado');
    // «QR no enviado» arma un aviso propio que dice que no se pudo enviar el QR: no usa el texto del pedido.
    expect(codigoDe(f, 'QR no enviado')).toContain('no se pudo enviar el QR de pago');
  });
});

describe('(d) El despacho del demo no promete una hora que nadie cumple', () => {
  const sistema = String(nodo(f, 'AI Agent NovuChat').parameters['options'].systemMessage);

  it('el dato de configuración no trae una hora fija y dice que es una demostración', () => {
    const despacho = String(configBase(f)['despachoRetail']);
    expect(despacho).not.toMatch(/\d{1,2}:\d{2}/);
    expect(despacho).not.toMatch(/hoy/i);
    expect(despacho).toMatch(/demostraci[oó]n/i);
  });

  it('el texto del dato sobrevive al filtro de promesas de «Procesar respuesta» (no se borra ni se vuelve «no pude responder»)', () => {
    const despacho = String(configBase(f)['despachoRetail']);
    const o = `Tu pedido es de 70 Bs en total. El despacho: ${despacho}.`;
    const p = ejecutar(codigoDe(f, 'Procesar respuesta'), [{ output: o }], { 'Normalizar entrada': [ENT] },
      { $getWorkflowStaticData: () => ({}), Date })[0] ?? {};
    expect(p['avisos']).not.toContain('promesa_quitada');
    expect(p['avisos']).not.toContain('respuesta_vacia');
    expect(String(p['respuesta'])).toContain('70 Bs');
    expect(String(p['respuesta'])).toContain(despacho);
  });

  it('el prompt armado con ese dato no contiene «17:00»', () => {
    const base = configBase(f);
    const armado = plantilla(sistema, { ...ENT, ...base, moneda: 'Bs' });
    expect(armado).not.toContain('17:00');
    expect(armado).toContain(String(base['despachoRetail']));
  });
});

describe('(e) Credenciales y lienzo de los nodos nuevos', () => {
  const envios = f.nodes.filter((n) => n.type === 'n8n-nodes-base.whatsApp' && n.parameters['operation'] === 'send');

  it('todo nodo de WhatsApp que ENVÍA declara su credencial por nombre, el mismo de «Obtener URL del medio»', () => {
    const nombre = nodo(f, 'Obtener URL del medio').credentials?.['whatsAppApi']?.name;
    expect(nombre).toBeTruthy();
    expect(envios.map((n) => n.name)).toContain('Avisar al dueño (transferencia)');
    for (const n of envios) {
      expect(n.credentials?.['whatsAppApi']?.name, n.name).toBe(nombre);
      expect(n.credentials?.['whatsAppApi']?.id, n.name).toBe('');
    }
  });

  it('los nodos nuevos o movidos no se encima con ningún otro (cajas de 100 x 60)', () => {
    const pos = f.nodes.map((n) => ({ n: n.name, x: n.position?.[0] ?? 0, y: n.position?.[1] ?? 0 }));
    const choques: string[] = [];
    const mios = new Set(['Verificar aviso al dueño', 'Avisar al dueño (transferencia)', 'Aviso de transferencia', 'Marcar aviso de transferencia']);
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
      const a = pos[i]!; const b = pos[j]!;
      if (!mios.has(a.n) && !mios.has(b.n)) continue;
      if (Math.abs(a.x - b.x) < 100 && Math.abs(a.y - b.y) < 60) choques.push(`${a.n} / ${b.n}`);
    }
    expect(choques).toEqual([]);
  });
});

describe('(f) Prohibición 3: «Recibimos tu pago» con cobro REAL se corrige y con SIMULADO lleva el rótulo', () => {
  const turno = (o: string, ent: J = {}) => ejecutar(codigoDe(f, 'Procesar respuesta'), [{ output: o }],
    { 'Normalizar entrada': [{ ...ENT, ...ent }] }, { $getWorkflowStaticData: () => ({}), Date: reloj({ t: 1_800_000_000_000 }) })[0] ?? {};
  const REAL: J = { cobroRealActivo: 'si' };
  const CORRECCION = 'El comprobante lo revisa Un Negocio y ellos confirman el pago.';
  const FORMAS = ['Recibimos tu pago.', 'RECIBIMOS TU PAGO!', '¡Recibimos su pago!', 'Recibimos el depósito.', 'Recibimos tu transferencia.', 'recibimos tu pago',
    'Recibi tu pago.', 'Recibí tu pago.', 'Pago recibido.', 'Pago recibida.', 'Hemos recibido tu pago.', 'He recibido tu pago.', 'Acreditamos tu pago.',
    'Tu pago quedó acreditado.', 'Pago acreditada.', 'Pago verificado.', 'Pago confirmado.', 'Pago aprobado.', 'Pago realizado.', 'Pago exitoso.',
    'Tu pago llegó.', 'Tu pago ya llego.', 'Tu pago fue recibido.', 'Tu pago fue acreditado.', 'Tu pago fue confirmado.', 'Ya nos llegó tu pago.',
    'Ya llegó tu transferencia.', 'Ya pagaste.', 'Gracias por tu pago.', '*Recibimos tu pago*.', 'Recibimos  tu pago.'];

  it('REAL: cada forma se reescribe a la frase fija y se deja constancia', () => {
    for (const o of FORMAS) {
      const p = turno('Listo, tu pedido va en camino. ' + o + '\nAvísame si necesitas algo.', REAL);
      expect(p['avisos'], o).toContain('correccion_cobro');
      expect(String(p['respuesta']), o).toContain(CORRECCION);
      expect(String(p['respuesta']), o).toContain('Avísame si necesitas algo.');
      expect(String(p['respuesta']).replace(CORRECCION, ''), o).not.toMatch(/recib[ií]|acredit|lleg[oó]|pagaste|gracias por/i);
    }
  });

  it('SIMULADO: cada forma lleva el rótulo de demostración', () => {
    for (const o of FORMAS) {
      const p = turno('Listo. ' + o, { cobroRealActivo: 'no' });
      expect(p['avisos'], o).toContain('rotulo_generico');
      expect(String(p['respuesta']), o).toContain('rótulo simulado');
    }
    // Y el que ya dice que es simulado no lo repite.
    expect(turno('Recibimos tu pago (simulado).', { cobroRealActivo: 'no' })['avisos']).not.toContain('rotulo_generico');
  });

  it('los futuros y las preguntas legítimos no se tocan (ni con cobro real ni con simulado)', () => {
    for (const o of ['Te aviso cuando recibamos tu comprobante.', 'Cuando recibamos tu pago te confirmamos.', 'Apenas recibamos tu comprobante lo revisamos.',
      'Recibiremos tu pago en el banco.', 'Envíanos tu comprobante y lo revisamos.', 'Recibimos tu comprobante.', 'Recibimos tu pedido.', 'Recibimos tu mensaje.',
      '¿Ya pagaste?', '¿Recibiste el QR?', 'Tu pedido llegó a la tienda.', 'Gracias por tu pedido.', 'Gracias por tu paciencia.']) {
      for (const ent of [REAL, { cobroRealActivo: 'no' }]) {
        const p = turno(o, ent);
        expect(p['avisos'], o).not.toContain('correccion_cobro');
        expect(p['avisos'], o).not.toContain('rotulo_generico');
        if (!/aviso|confirmamos|revisamos/.test(o)) expect(String(p['respuesta']), o).toBe(o);
      }
    }
  });

  it('REAL: solo se reescribe la oración que afirma; el resto, el monto y las líneas quedan', () => {
    const p = turno('Tu pedido:\n- 2 pizzas: 70 Bs\nTotal: 80 Bs. Recibimos tu pago. ¿Algo más?', REAL);
    expect(String(p['respuesta'])).toBe('Tu pedido:\n- 2 pizzas: 70 Bs\nTotal: 80 Bs. ' + CORRECCION + ' ¿Algo más?');
  });

  it('REAL: lo que ya corregía el regex de siempre sigue corrigiendo («ya recibimos», «pago verificado»)', () => {
    for (const o of ['Ya recibimos tu comprobante.', 'Pago verificado.', 'Ya se acreditó.']) {
      expect(turno(o, REAL)['avisos'], o).toContain('correccion_cobro');
    }
  });

  it('sin ReDoS: 50 000 caracteres de casi-coincidencias terminan rápido', () => {
    for (const bloque of ['recibimos tu ', 'tu pago ya ', 'ya nos ', 'pago ', 'recibimos   '.repeat(3)]) {
      const t0 = Date.now();
      turno(bloque.repeat(Math.ceil(50_000 / bloque.length)), REAL);
      expect(Date.now() - t0, bloque).toBeLessThan(3000);
    }
  });
});

describe('(g) Seguimiento del #391: destinatarios, monto, falsos positivos y borde', () => {
  const turno = (o: string, ent: J = {}, sd: J = {}) => ejecutar(codigoDe(f, 'Procesar respuesta'), [{ output: o }],
    { 'Normalizar entrada': [{ ...ENT, ...ent }] }, { $getWorkflowStaticData: () => sd, Date: reloj({ t: 1_800_000_000_000 }) })[0] ?? {};
  const quita = (o: string) => (turno(o)['avisos'] as string[]).some((a) => /^(aviso_anunciado|promesa)_quitad/.test(a));

  it('(a) «avisé/notifiqué» a cualquier destinatario se quita; «informé/comuniqué» solo a la lista cerrada', () => {
    for (const o of ['Ya avisé al local.', 'Ya avisé al equipo.', 'Ya avisé a la tienda.', 'Ya avisé al vendedor.', 'Ya avisé a nuestro equipo.',
      'Ya avisé a la cocina.', 'Ya avisé al personal.', 'Avisé al local.', 'Notifiqué al equipo.', 'Ya informé al equipo.', 'Comuniqué a nuestro equipo.']) {
      expect(quita(o), o).toBe(true);
    }
    // La lista cerrada sigue valiendo para informar: al cliente se le informa, no se le «avisa al negocio».
    for (const o of ['Ya informé al cliente del precio.', 'Ya informé al vendedor del precio.', 'Te avisé a las 5 que ya estaba.', 'Te avisé al mediodía.']) {
      expect(quita(o), o).toBe(false);
    }
  });

  it('(b) el monto sobrevive a un anuncio pegado por coma, «y», raya o punto y coma (también el futuro)', () => {
    for (const o of ['Total: 80 Bs, ya avisé al negocio.', 'Total 80 Bs y ya le avisé al negocio.', 'Total: 80 Bs — ya le avisé al negocio.',
      'Total: 80 Bs; le avisaré al negocio.', 'Total: 80 Bs, le avisaré al negocio.', 'Total 80 Bs y le aviso a recepción.', 'Total: 80 Bs - ya informé al negocio.']) {
      const p = turno(o);
      expect(String(p['respuesta']), o).toContain('80 Bs');
      expect(String(p['respuesta']), o).not.toMatch(/avis|inform/i);
    }
  });

  it('(c) falsos positivos: lo que informa o no anuncia se conserva', () => {
    for (const o of ['Estamos avisando a todos de la promo.', 'Te lo he notificado arriba.', 'Ya te lo he avisado: el envío cuesta 10 Bs.',
      'Te lo avisé arriba.', 'Estamos avisando a todos los clientes de la promo.']) {
      const p = turno(o);
      expect(p['avisos'], o).not.toContain('aviso_anunciado_quitado');
      expect(String(p['respuesta']), o).toBe(o);
    }
    // Y con destinatario de la lista o sin complemento, «estamos avisando» sigue siendo un anuncio.
    for (const o of ['Estamos avisando al negocio.', 'Estamos avisando.', 'Estoy avisando a recepción.', 'Estamos avisando a nuestro equipo.']) expect(quita(o), o).toBe(true);
  });

  it('(d) «Ya avisé ✅» y «Avisé, toca el botón.» se filtran; con una palabra detrás, no', () => {
    for (const o of ['Ya avisé ✅', 'Ya avisé ✅.', 'Avisé, toca el botón.', 'Avisé.', 'Avisé 👍', 'Ya notifiqué ✔️', 'Avisé']) expect(quita(o), o).toBe(true);
    for (const o of ['Como avisé, el envío cuesta 10 Bs.', 'Avisé que el envío cuesta 10 Bs.', 'Ya avisé que el envío cuesta 10 Bs.', 'Te avisé.']) expect(quita(o), o).toBe(false);
  });

  it('con la marca vigente se conserva el pasado también en las formas nuevas', () => {
    const sd: J = { avisosTransferencia: { [CLIENTE]: 1_800_000_000_000 - 60_000 } };
    for (const o of ['Ya avisé al local.', 'Ya avisé ✅', 'Avisé, toca el botón.']) {
      expect(turno(o, {}, sd)['avisos'], o).not.toContain('aviso_anunciado_quitado');
    }
  });

  it('sin ReDoS: 50 000 caracteres de casi-coincidencias terminan rápido', () => {
    for (const bloque of ['ya avisé a ', 'estamos avisando ', 'Total 80 Bs y ya le ', 'avisé ', ', ya le avis ', ' - ya ']) {
      const t0 = Date.now();
      turno(bloque.repeat(Math.ceil(50_000 / bloque.length)));
      expect(Date.now() - t0, bloque).toBeLessThan(3000);
    }
  });
});
