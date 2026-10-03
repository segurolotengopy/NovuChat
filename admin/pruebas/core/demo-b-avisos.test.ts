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

  it('Meta rechaza el aviso: queda `avisoAceptado: false` y una línea en el registro de n8n', () => {
    const { s, registro } = verificar(RECHAZO);
    expect(s['avisoAceptado']).toBe(false);
    expect(registro).toHaveLength(1);
    expect(String(registro[0]?.[0])).toContain('AVISO_AL_DUENO_NO_SALIO');
  });

  it('Meta responde sin id (200 sin messages): tampoco cuenta como entregado', () => {
    expect(verificar({}).s['avisoAceptado']).toBe(false);
    expect(verificar({ messages: [{}] }).s['avisoAceptado']).toBe(false);
    expect(verificar({ messages: [{ id: '' }] }).s['avisoAceptado']).toBe(false);
  });

  it('Meta acepta: entregado y sin ruido', () => {
    const { s, registro } = verificar(ACEPTADO);
    expect(s['avisoAceptado']).toBe(true);
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
