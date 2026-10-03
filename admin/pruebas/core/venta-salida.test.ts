/**
 * DEMO B: LA SALIDA AL CLIENTE (F3a, 02/10/2026).
 *
 * QUÉ SE PRUEBA Y POR QUÉ. La política del 21/09/2026 dice que ante un error o
 * una consulta sin respuesta lo único que el asistente ofrece es pasar con una
 * persona, y que eso es SIEMPRE el aviso al negocio MÁS el botón para
 * escribirle directo. Reservas y captación ya lo cumplían; el Demo B no tenía
 * a quién transferir y, si el modelo fallaba, el cliente no recibía nada. Esta
 * suite clava, ejecutando el código del JSON versionado:
 *
 *   1. UN EMBUDO: todo camino al cliente pasa por «Mensaje a enviar» (salvo la
 *      imagen del QR, que es del módulo Cobros).
 *   2. TRANSFERIR: la marca [TRANSFERIR] da UN mensaje con el botón adentro y
 *      el aviso al dueño UNA vez por teléfono y ventana de 24 h.
 *   3. FALLO DEL MODELO: botón; sin QR, sin catálogo, sin pedido confirmado.
 *   4. CONTRAPRUEBAS: una respuesta normal sale sin botón; una promesa sin
 *      respaldo se quita; sin número no hay botón ni aviso.
 *   5. SI META RECHAZA EL BOTÓN: el mismo texto, con el enlace, en un mensaje.
 *
 * Costo en mensajes (Base comercial §1): 0 por transferencia al cliente (el
 * botón va dentro), +1 al dueño por teléfono y 24 h, +1 al cliente en el turno
 * en que el modelo falla (antes: silencio).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  type J, GLOBALES_FUERA_DEL_SANDBOX, codigoDe, destinos, ejecutar, entradas, expresion, leerFlujo,
  nodo, plantilla,
} from '../lib/flujo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const f = leerFlujo('demo-b-venta-cobro.json');
const y = (n: string) => nodo(f, n).position?.[1] ?? Number.NaN;

const DUENO = '59170000009';
const CLIENTE = '59170000001';
const ENT: J = {
  from: CLIENTE, nombrePerfil: 'Ana', phoneNumberId: '1000000001', numeroDueno: DUENO,
  waGraphVersion: 'v26.0', nombreNegocio: 'Un Negocio', userInput: 'quiero hablar con una persona',
  rotuloDemo: 'rótulo simulado', textoPagoSimulado: 'Pago verificado (SIMULADO).',
};

/** Un `Date` con reloj controlado: `Date.now()` devuelve `ahora.t`. */
const reloj = (ahora: { t: number }) => class extends Date { static override now() { return ahora.t; } };

const HORA = 3_600_000;

/** «Procesar respuesta» con estado compartido (`$getWorkflowStaticData`) y reloj. */
function turno(
  salida: J, ent: J = {}, sd: J = {}, ahora = { t: 1_800_000_000_000 },
): J {
  return ejecutar(codigoDe(f, 'Procesar respuesta'), [salida],
    { 'Normalizar entrada': [{ ...ENT, ...ent }] },
    { $getWorkflowStaticData: () => sd, Date: reloj(ahora) })[0] ?? {};
}

/** «Mensaje a enviar» sobre la salida de «Procesar respuesta». */
const enviar = (item: J, cfg: J | null = { numeroDueno: DUENO, nombreNegocio: 'Un Negocio' }): J =>
  ejecutar(codigoDe(f, 'Mensaje a enviar'), [item], cfg ? { 'Config del negocio': [cfg] } : {})[0] ?? {};

/** Lo que `Aviso de transferencia` deja para el envío: el texto propio en `textoAviso`. */
const mapear = (p: J): J => ejecutar(codigoDe(f, 'Aviso de transferencia'), [p])[0] ?? {};

/** `Marcar aviso de transferencia` tras el envío: con id de Meta (aceptado) o con error. */
function marcar(sd: J, ahora: { t: number }, p: J, aceptado = true): void {
  ejecutar(codigoDe(f, 'Marcar aviso de transferencia'),
    [aceptado ? { messages: [{ id: 'wamid.AVISO' }] } : { error: { message: 'rechazado' } }],
    { 'Aviso de transferencia': [mapear(p)] },
    { $getWorkflowStaticData: () => sd, Date: reloj(ahora) });
}

const FALLA = { error: { message: 'The model is overloaded (503)' } };

// ---------------------------------------------------------------------------

describe('(1) Un embudo único de salida al cliente', () => {
  it('todos los caminos al cliente entran a «Mensaje a enviar»', () => {
    expect([...entradas(f, 'Mensaje a enviar')].sort()).toEqual([
      '¿Avisar del carrito?', '¿Responder ahora?', '¿Responder uso extendido?',
      'Comercio no operativo', 'Enlace del catálogo', 'QR no enviado', 'Respuesta del cobro',
    ].sort());
    // Y nadie más llega a los envíos de texto sin pasar por él.
    expect([...entradas(f, 'Responder al cliente')].sort()).toEqual(['¿Con botón?', 'Responder con botón'].sort());
    expect(entradas(f, 'Responder con botón')).toEqual(['¿Con botón?']);
    expect(destinos(f, 'Mensaje a enviar')).toEqual(['¿Con botón?']);
    expect(destinos(f, '¿Con botón?', 0)).toEqual(['Responder con botón']);
    expect(destinos(f, '¿Con botón?', 1)).toEqual(['Responder al cliente']);
  });

  it('conteo de emisores declarado: texto, botón, aviso al dueño y la imagen del QR (excepción por nombre)', () => {
    const envian = f.nodes.filter((n) => (n.type === 'n8n-nodes-base.whatsApp' && n.parameters['operation'] === 'send')
      || (n.type === 'n8n-nodes-base.httpRequest' && /^=?https:\/\/graph\.facebook\.com\//.test(String(n.parameters['url'] ?? ''))
        && String(n.parameters['url']).endsWith('/messages')))
      .map((n) => n.name).sort();
    expect(envian).toEqual(['Avisar al dueño', 'Enviar QR de cobro', 'Responder al cliente', 'Responder con botón']);
    // «Enviar QR de cobro» queda fuera del embudo: es la imagen con su pie.
    expect(entradas(f, 'Enviar QR de cobro').sort()).toEqual(['Preparar QR de cobro', 'Preparar reenvío del QR']);
  });

  it('el botón y el texto reportan por el mismo camino, después del envío', () => {
    expect(destinos(f, 'Responder con botón', 0)).toEqual(['Texto enviado']);
    expect(destinos(f, 'Responder con botón', 1)).toEqual(['Responder al cliente']);
    expect(destinos(f, 'Responder al cliente')).toEqual(['Texto enviado']);
    expect(destinos(f, 'Texto enviado')).toEqual(['Reportar mensaje (saliente)']);
    expect(nodo(f, 'Responder con botón').onError).toBe('continueErrorOutput');
    // Su salida de error ya es el respaldo de texto: reintentar mandaría dos veces.
    expect(nodo(f, 'Responder con botón').maxTries).toBe(1);
  });

  it('el orden de ramas es el del lienzo: «Reportar mensaje (entrante)» sigue arriba de la rama del agente', () => {
    expect(f.settings?.executionOrder).toBe('v1');
    expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('¿Comercio operativo?'));
    expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('AI Agent NovuChat'));
    expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('Procesar respuesta'));
    // La respuesta al cliente va antes que el aviso al dueño: el cliente recibe primero.
    const abanico = destinos(f, 'Procesar respuesta').map(y);
    expect(abanico).toEqual([...abanico].sort((a, b) => a - b));
    expect(destinos(f, 'Procesar respuesta').at(-1)).toBe('¿Transferir al dueño?');
    expect(y('¿Responder ahora?')).toBeLessThan(y('¿Transferir al dueño?'));
    expect(y('Mensaje a enviar')).toBeLessThan(y('¿Transferir al dueño?'));
    expect(destinos(f, '¿Transferir al dueño?', 0)).toEqual(['Aviso de transferencia']);
    expect(destinos(f, 'Aviso de transferencia')).toEqual(['Avisar al dueño']);
    expect(destinos(f, 'Avisar al dueño')).toEqual(['Marcar aviso de transferencia']);
    // El aviso del pedido (más arriba) llega al envío ANTES que el de la transferencia.
    expect(y('¿Pedido confirmado?')).toBeLessThan(y('¿Transferir al dueño?'));
  });

  it('«Mensaje a enviar» corre en el sandbox de n8n: sin URL, Buffer ni crypto', () => {
    const codigo = codigoDe(f, 'Mensaje a enviar');
    for (const g of GLOBALES_FUERA_DEL_SANDBOX) {
      expect(new RegExp(`(?<![\\w$.])${g}(?![\\w$])`).test(codigo.replace(/\/\/.*$/gm, '')), g).toBe(false);
    }
  });

  it('la negrita es la misma línea que en reservas y el módulo es el declarado', () => {
    const linea = (t: string) => /const NEGRITA_MD = .*/.exec(t)?.[0];
    const agenda = readFileSync(join(aqui, '../../../Flujos/src/modulos/agenda/mensaje-a-enviar.js'), 'utf8');
    expect(linea(codigoDe(f, 'Mensaje a enviar'))).toBe(linea(agenda));
  });

  it('el agente sigue y no corta el turno si el modelo falla', () => {
    expect(nodo(f, 'AI Agent NovuChat').onError).toBe('continueRegularOutput');
  });
});

// ---------------------------------------------------------------------------

describe('(2) [TRANSFERIR]: un mensaje con botón y un aviso al dueño por ventana', () => {
  it('la marca no llega al cliente: sale un solo mensaje con el botón adentro', () => {
    const p = turno({ output: 'Claro, te paso con una persona del negocio. [TRANSFERIR]' });
    expect(p['respuesta']).toBe('Claro, te paso con una persona del negocio.');
    expect(p['transferir']).toBe(true);
    const m = enviar(p);
    expect(m['conBoton']).toBe(true);
    const cuerpo = m['cuerpoBoton'] as J;
    expect(cuerpo['type']).toBe('interactive');
    expect(cuerpo['to']).toBe(CLIENTE);
    expect(cuerpo['interactive'].type).toBe('cta_url');
    expect(cuerpo['interactive'].body.text).toBe('Claro, te paso con una persona del negocio.');
    expect(cuerpo['interactive'].action.parameters.display_text.length).toBeLessThanOrEqual(20);
    expect(cuerpo['interactive'].action.parameters.url).toContain('https://wa.me/' + DUENO + '?text=');
    expect(JSON.stringify(cuerpo)).not.toContain('TRANSFERIR');
  });

  it('el JSON del botón sale de «Responder con botón» tal cual', () => {
    const m = enviar(turno({ output: 'Te paso con alguien. [TRANSFERIR]' }));
    const cuerpo = expresion(nodo(f, 'Responder con botón').parameters['jsonBody'], {}, { 'Mensaje a enviar': [m] });
    expect(JSON.parse(String(cuerpo))).toEqual(m['cuerpoBoton']);
    expect(plantilla(nodo(f, 'Responder con botón').parameters['url'], {}, { 'Mensaje a enviar': [m] }))
      .toBe('https://graph.facebook.com/v26.0/1000000001/messages');
  });

  it('solo la marca: el texto fijo remite al botón', () => {
    const p = turno({ output: '[TRANSFERIR]' });
    expect(p['respuesta']).toBe('Le aviso a Un Negocio para que te atienda una persona. Si prefieres no esperar, toca el botón y escríbele directo.');
    expect(p['avisos']).not.toContain('respuesta_vacia');
    expect(enviar(p)['conBoton']).toBe(true);
  });

  it('el aviso al dueño sale UNA vez por teléfono y ventana de 24 h', () => {
    const sd: J = {};
    const ahora = { t: 1_800_000_000_000 };
    const primero = turno({ output: 'Te paso. [TRANSFERIR]' }, {}, sd, ahora);
    expect(primero['avisarDueno']).toBe(true);
    expect(primero['textoAvisoTransferencia']).toContain('Ana (' + CLIENTE + ')');
    expect(primero['textoAvisoTransferencia']).toContain('Motivo: quiero hablar con una persona');
    // `Procesar respuesta` no marca: lo hace el nodo posterior al envío.
    expect(sd['avisosTransferencia'] ?? {}).toEqual({});
    marcar(sd, ahora, primero);
    // CONTRAPRUEBA: dentro de las 24 h el cliente insiste y NO se avisa de nuevo,
    // pero el botón sale igual.
    ahora.t += 23 * HORA;
    const repetido = turno({ output: 'Te paso otra vez. [TRANSFERIR]' }, {}, sd, ahora);
    expect(repetido['avisarDueno']).toBe(false);
    expect(repetido['textoAvisoTransferencia']).toBe('');
    expect(repetido['avisos']).toContain('aviso_dueno_repetido');
    expect(enviar(repetido)['conBoton']).toBe(true);
    // Otro teléfono no comparte la barrera.
    const otro = turno({ output: 'Te paso. [TRANSFERIR]' }, { from: '59170000002' }, sd, ahora);
    expect(otro['avisarDueno']).toBe(true);
    // Pasadas las 24 h desde el primer aviso, vuelve a avisar.
    ahora.t += 2 * HORA;
    expect(turno({ output: 'Te paso. [TRANSFERIR]' }, {}, sd, ahora)['avisarDueno']).toBe(true);
  });

  it('la ventana se cierra DESPUÉS del envío y solo si salió: un aviso rechazado no la cierra', () => {
    const sd: J = {};
    const ahora = { t: 1_800_000_000_000 };
    const p = turno({ output: 'Te paso. [TRANSFERIR]' }, {}, sd, ahora);
    marcar(sd, ahora, p, false);
    expect(sd['avisosTransferencia']?.[CLIENTE]).toBeUndefined();
    expect(turno({ output: 'Te paso de nuevo. [TRANSFERIR]' }, {}, sd, ahora)['avisarDueno']).toBe(true);
    marcar(sd, ahora, p, true);
    expect(sd['avisosTransferencia'][CLIENTE]).toBe(ahora.t);
  });

  it('el aviso del pedido, que llega antes, no cierra la ventana de la transferencia', () => {
    const sd: J = {};
    const ahora = { t: 1_800_000_000_000 };
    // `Aviso de transferencia` todavía no corrió: el envío del pedido pasa de largo.
    ejecutar(codigoDe(f, 'Marcar aviso de transferencia'), [{ messages: [{ id: 'wamid.PEDIDO' }] }], {},
      { $getWorkflowStaticData: () => sd, Date: reloj(ahora) });
    expect(sd['avisosTransferencia']).toBeUndefined();
  });

  it('el texto fijo de «solo la marca» dice lo que ese turno cumple', () => {
    const sd: J = {};
    const ahora = { t: 1_800_000_000_000 };
    const primero = turno({ output: '[TRANSFERIR]' }, {}, sd, ahora);
    expect(primero['respuesta']).toMatch(/^Le aviso a Un Negocio/);
    marcar(sd, ahora, primero);
    const repetido = turno({ output: '[TRANSFERIR]' }, {}, sd, ahora);
    expect(repetido['respuesta']).toBe('Ya le avisé a Un Negocio; si prefieres no esperar, toca el botón y escríbele directo.');
    expect(repetido['respuesta']).not.toMatch(/^Le aviso/);
    const dueno = turno({ output: '[TRANSFERIR]' }, { from: DUENO });
    expect(dueno['respuesta']).toBe('Para hablar con una persona de Un Negocio, toca el botón y escríbele directo.');
    expect(dueno['respuesta']).not.toMatch(/avis/i);
    for (const p of [primero, repetido, dueno]) expect(enviar(p)['conBoton']).toBe(true);
  });

  it('el estado por teléfono es el de la ejecución: sin transferencia no se toca', () => {
    const sd: J = {};
    turno({ output: 'Hola, ¿qué te sirvo?' }, {}, sd);
    expect(sd['avisosTransferencia']).toBeUndefined();
  });

  it('si quien escribe es el dueño, no hay aviso', () => {
    const p = turno({ output: 'Te paso. [TRANSFERIR]' }, { from: DUENO });
    expect(p['transferir']).toBe(true);
    expect(p['avisarDueno']).toBe(false);
  });

  it('sin número del dueño: ni botón ni aviso, y el texto no promete', () => {
    const p = turno({ output: 'Lo consulto con el negocio y te aviso más tarde. [TRANSFERIR]' }, { numeroDueno: '' });
    expect(p['transferir']).toBe(false);
    expect(p['avisarDueno']).toBe(false);
    expect(p['avisos']).toContain('transferencia_sin_numero');
    expect(p['avisos']).toContain('promesa_quitada');
    expect(String(p['respuesta'])).not.toMatch(/te aviso/);
    const m = enviar(p, { numeroDueno: '' });
    expect(m['conBoton']).toBe(false);
    expect(m['cuerpoBoton']).toBeUndefined();
  });

  it('el aviso al dueño usa el texto armado por «Procesar respuesta»', () => {
    const p = turno({ output: 'Te paso. [TRANSFERIR]' });
    const txt = plantilla(nodo(f, 'Avisar al dueño').parameters['textBody'], mapear(p));
    expect(txt).toBe(p['textoAvisoTransferencia']);
    // `Procesar respuesta` no emite `textoAviso`: es del pedido.
    expect(p['textoAviso']).toBeUndefined();
    expect(txt).toContain('necesita atención de una persona');
    // El pedido confirmado sigue usando su texto de siempre.
    const pedido = turno({ output: 'Listo. [PEDIDO_CONFIRMADO]' });
    expect(plantilla(nodo(f, 'Avisar al dueño').parameters['textBody'], pedido)).toContain('NUEVO PEDIDO CONFIRMADO');
  });

  it('[PEDIDO_CONFIRMADO] + [TRANSFERIR] en el mismo turno: un aviso de pedido y como máximo uno de transferencia', () => {
    const p = turno({ output: 'Listo. [PEDIDO_CONFIRMADO] [TRANSFERIR]' });
    expect(p['pedidoConfirmado']).toBe(true);
    expect(p['transferir']).toBe(true);
    // Lo que sale por «Avisar al dueño»: cada rama arma su texto por el camino que tiene.
    const avisoDelPedido = plantilla(nodo(f, 'Avisar al dueño').parameters['textBody'], p);
    const avisoDeTransferencia = plantilla(nodo(f, 'Avisar al dueño').parameters['textBody'], mapear(p));
    expect(avisoDelPedido).toContain('NUEVO PEDIDO CONFIRMADO');
    expect(avisoDelPedido).toContain('SIMULADO');
    expect(avisoDelPedido).not.toContain('necesita atención');
    expect(avisoDeTransferencia).toContain('necesita atención de una persona');
    expect(avisoDeTransferencia).not.toContain('NUEVO PEDIDO');
    // Cableado: el pedido entra al envío por su compuerta y la transferencia por la suya.
    expect(destinos(f, '¿Pedido confirmado?', 0)).toEqual(['Avisar al dueño']);
    const avisosDelDueno = [
      ...(p['pedidoConfirmado'] === true ? [avisoDelPedido] : []),
      ...(p['avisarDueno'] === true ? [avisoDeTransferencia] : []),
    ];
    expect(avisosDelDueno.filter((t) => t.includes('NUEVO PEDIDO CONFIRMADO'))).toHaveLength(1);
    expect(avisosDelDueno.filter((t) => t.includes('necesita atención'))).toHaveLength(1);
    // Mensajes: al cliente 1 (con botón); al dueño 2 (pedido, que ya existía, y transferencia, la 1.ª en 24 h).
    expect(enviar(p)['conBoton']).toBe(true);
    // Repetido dentro de la ventana: solo el aviso del pedido.
    const sd: J = {};
    const ahora = { t: 1_800_000_000_000 };
    marcar(sd, ahora, turno({ output: 'x [TRANSFERIR]' }, {}, sd, ahora));
    const otra = turno({ output: 'Listo. [PEDIDO_CONFIRMADO] [TRANSFERIR]' }, {}, sd, ahora);
    expect(otra['avisarDueno']).toBe(false);
    expect(otra['pedidoConfirmado']).toBe(true);
  });

  it('transferir con QR pendiente: el texto sale por el embudo con el botón, no en el pie de la imagen', () => {
    const p = turno({ output: 'Aquí tu QR. [ENVIAR_QR] [TRANSFERIR]' });
    expect(p['enviarQr']).toBe(true);
    expect(p['textoEnElQr']).toBe(false);
    expect(enviar(p)['conBoton']).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('(3) El modelo falla: el cliente recibe algo, y con botón', () => {
  it('sin `output` o con `error`, texto fijo + botón (antes: silencio)', () => {
    for (const salida of [FALLA, {}, { output: undefined }]) {
      const p = turno(salida);
      expect(p['falloModelo'], JSON.stringify(salida)).toBe(true);
      expect(p['avisos']).toContain('fallo_modelo');
      expect(p['respuesta']).toBe('Disculpa, tuve un problema para responderte. Si prefieres, toca el botón y escríbele directo a Un Negocio.');
      const m = enviar(p);
      expect(m['conBoton']).toBe(true);
      expect((m['cuerpoBoton'] as J)['interactive'].body.text).toBe(p['respuesta']);
    }
  });

  it('CONTRAPRUEBA: si el botón no se arma en el fallo, la suite lo detecta', () => {
    const p = turno(FALLA);
    // El mismo item sin la bandera de fallo NO lleva botón: la bandera es lo que lo decide.
    expect(enviar({ ...p, falloModelo: false })['conBoton']).toBe(false);
    expect(enviar(p)['conBoton']).toBe(true);
  });

  it('en el fallo no se envía QR, no se pide catálogo ni se confirma un pedido, y no se avisa al dueño', () => {
    const p = turno(FALLA);
    expect(p['enviarQr']).toBe(false);
    expect(p['reenviarQr']).toBe(false);
    expect(p['pedirCatalogo']).toBe(false);
    expect(p['pedidoConfirmado']).toBe(false);
    expect(p['transferir']).toBe(false);
    expect(p['avisarDueno']).toBe(false);
  });

  it('un fallo sin número del negocio: texto sin invitar a tocar un botón que no existe', () => {
    const p = turno(FALLA, { numeroDueno: '' });
    expect(p['respuesta']).toBe('Disculpa, tuve un problema para responderte. ¿Me lo repites?');
    expect(p['respuesta']).not.toMatch(/bot[oó]n/i);
    expect(enviar(p, { numeroDueno: '' })['conBoton']).toBe(false);
  });

  it('una respuesta vacía del modelo (con output) también sale con botón, y una marca sola no es vacía', () => {
    const vacia = turno({ output: '   ' });
    expect(vacia['respuestaVacia']).toBe(true);
    expect(vacia['falloModelo']).toBe(false);
    expect(vacia['avisos']).toContain('respuesta_vacia');
    expect(enviar(vacia)['conBoton']).toBe(true);
    const soloCatalogo = turno({ output: '[ENVIAR_CATALOGO]' });
    expect(soloCatalogo['respuestaVacia']).toBe(false);
    expect(soloCatalogo['avisos']).toContain('catalogo_sin_texto');
  });
});

// ---------------------------------------------------------------------------

describe('(4) Contrapruebas: lo normal no se toca', () => {
  it('una respuesta normal sale sin botón y sin aviso', () => {
    const p = turno({ output: 'La hamburguesa doble cuesta 35 Bs. ¿Te la anoto?' });
    expect(p['transferir']).toBe(false);
    expect(p['avisarDueno']).toBe(false);
    expect(p['falloModelo']).toBe(false);
    const m = enviar(p);
    expect(m['conBoton']).toBe(false);
    expect(m['cuerpoBoton']).toBeUndefined();
    expect(m['textoParaTexto']).toBe('La hamburguesa doble cuesta 35 Bs. ¿Te la anoto?');
  });

  it('una promesa sin respaldo (sin [TRANSFERIR]) se quita: no hay botón que la cumpla', () => {
    const p = turno({ output: 'No tengo la dirección cargada. Lo consulto con el negocio y te aviso más tarde. ¿Quieres ver el catálogo?' });
    expect(p['respuesta']).toBe('No tengo la dirección cargada. ¿Quieres ver el catálogo?');
    expect(p['avisos']).toContain('promesa_quitada');
    expect(enviar(p)['conBoton']).toBe(false);
  });

  it('las ramas que no pasan por el agente (cobro, carrito, no operativo) salen sin botón', () => {
    for (const item of [
      { respuesta: 'Recibimos tu comprobante.', from: CLIENTE, phoneNumberId: '1' },
      { respuesta: 'Tu pedido del catálogo…', from: CLIENTE },
      { respuesta: 'Estamos cerrados.', from: CLIENTE, phoneNumberId: '1' },
    ]) {
      const m = enviar(item);
      expect(m['conBoton']).toBe(false);
      expect(m['textoParaTexto']).toBe(item.respuesta);
    }
  });

  it('el carrito, que no ejecutó «Config del negocio», no rompe: completa el teléfono desde el item', () => {
    const m = enviar({ respuesta: 'Tu pedido del catálogo…', from: CLIENTE, phoneNumberId: '1000000001' }, null);
    expect(m['conBoton']).toBe(false);
    expect(m['phoneNumberId']).toBe('1000000001');
    // Y el código lo protege por escrito, porque el helper no tira como n8n.
    expect(codigoDe(f, 'Mensaje a enviar')).toMatch(/try \{ cfg = \$\('Config del negocio'\)\.first\(\)\.json \?\? \{\}; \} catch/);
  });

  it('la negrita de Markdown sale como la de WhatsApp', () => {
    expect(enviar({ respuesta: '**Total:** 35 Bs', from: CLIENTE })['respuesta']).toBe('*Total:* 35 Bs');
  });
});

// ---------------------------------------------------------------------------

describe('(5) Si Meta rechaza el botón, sale el mismo texto con el enlace, en un solo mensaje', () => {
  it('cuerpo de más de 1.024 caracteres: texto con enlace y aviso `boton_perdido_por_largo`', () => {
    const largo = 'Detalle del pedido. '.repeat(55) + '[TRANSFERIR]';
    const p = turno({ output: largo });
    expect(String(p['respuesta']).length).toBeGreaterThan(1024);
    const m = enviar(p);
    expect(m['conBoton']).toBe(false);
    expect(m['avisos']).toContain('boton_perdido_por_largo');
    expect(m['textoParaTexto']).toBe(m['respuesta'] + '\n\nEscríbele directo a Un Negocio: https://wa.me/' + DUENO);
  });

  it('error del interactivo: «Responder al cliente» manda el texto con el enlace, leyendo del embudo y no del error', () => {
    const m = enviar(turno({ output: 'Te paso con alguien. [TRANSFERIR]' }));
    const p = nodo(f, 'Responder al cliente').parameters;
    // En la salida de error de «Responder con botón», `$json` es el error de Meta.
    const error = { error: { message: 'Meta rechazó el interactivo' } };
    const refs = { 'Mensaje a enviar': [m] };
    expect(expresion(p['textBody'], error, refs)).toBe('Te paso con alguien.\n\nEscríbele directo a Un Negocio: https://wa.me/' + DUENO);
    expect(expresion(p['recipientPhoneNumber'], error, refs)).toBe(CLIENTE);
    expect(expresion(p['phoneNumberId'], error, refs)).toBe('1000000001');
  });

  it('sin botón pedido, el envío de texto manda la respuesta tal cual', () => {
    const m = enviar(turno({ output: 'Hola, ¿qué te sirvo?' }));
    expect(expresion(nodo(f, 'Responder al cliente').parameters['textBody'], m, { 'Mensaje a enviar': [m] }))
      .toBe('Hola, ¿qué te sirvo?');
  });
});

describe('(6) «Texto enviado» reporta exactamente lo que salió', () => {
  const reportar = (m: J, rechazado: boolean): J => ejecutar(codigoDe(f, 'Texto enviado'),
    [{ messages: [{ id: 'wamid.X' }] }], {
      'Normalizar entrada': [ENT], 'Mensaje a enviar': [m], 'Procesar respuesta': [m],
      ...(rechazado ? { 'Responder al cliente': [{}] } : {}),
    })[0] ?? {};

  it('botón aceptado: el cuerpo del botón; botón rechazado: el texto con el enlace', () => {
    const m = enviar(turno({ output: 'Te paso con alguien. [TRANSFERIR]' }));
    expect(reportar(m, false)['texto']).toBe('Te paso con alguien.');
    expect(reportar(m, false)['fuenteDelTexto']).toBe('Mensaje a enviar');
    expect(reportar(m, true)['texto']).toBe(m['textoParaTexto']);
    expect(reportar(m, true)['idMeta']).toBe('wamid.X');
  });

  it('una respuesta normal se reporta tal cual', () => {
    const m = enviar(turno({ output: 'Hola, ¿qué te sirvo?' }));
    expect(reportar(m, false)['texto']).toBe('Hola, ¿qué te sirvo?');
  });
});

describe('(6b) Meta rechaza el QR: el cliente no queda en silencio (03/10/2026, ejecución #19549)', () => {
  const ROTULO = '⚠️ QR de DEMOSTRACIÓN: pago simulado.';
  // El caso del 03/10: el texto del asistente viaja DENTRO del pie de la imagen.
  const previo: J = {
    ...ENT, cobroTotal: '597', respuesta: 'Aquí tienes el código QR para pagar.', enviarQr: true, textoEnElQr: true,
    captionQr: ROTULO + '\n\nAquí tienes el código QR para pagar.\n\nNo hay dinero real en juego.',
  };
  const rechazo = { error: { message: 'image.id is not a valid whatsapp business account media attachment ID' } };
  const noEnviado = (cfg: J | null = null): J => ejecutar(codigoDe(f, 'QR no enviado'), [rechazo],
    { 'Preparar QR de cobro': [previo], 'Config del negocio': [cfg ?? { rotuloDemo: ROTULO }] })[0] ?? {};

  it('el cliente recibe exactamente UN mensaje, con el botón; el dueño recibe su aviso', () => {
    const s = noEnviado();
    const salida = enviar(s);
    expect(salida['conBoton']).toBe(true);
    expect((salida['cuerpoBoton'] as J)['to']).toBe(CLIENTE);
    // Un solo texto: el pie con el rótulo de simulacro (prohibición 3) + la frase de que la imagen no salió.
    expect(String(salida['respuesta'])).toBe(ROTULO + '\n\nNo pude enviarte la imagen del QR.');
    expect(String(salida['respuesta'])).toContain('No pude enviarte la imagen del QR.');
    // Dos ramas: el cliente (arriba) y el aviso al dueño (abajo); ni una más.
    expect(destinos(f, 'QR no enviado')).toEqual(['Mensaje a enviar', 'Avisar al dueño']);
    expect(y('Mensaje a enviar')).toBeLessThan(y('Avisar al dueño'));
    expect(String(s['textoAviso'])).toContain('no se pudo enviar el QR');
    expect(s['transferir']).toBe(true);
  });

  it('no promete QR, tiempos ni acciones sin respaldo', () => {
    const texto = String(enviar(noEnviado())['respuesta']);
    expect(texto).not.toMatch(/te (aviso|llamo|llamamos|escribir|enviar|mand)|en unos? (minutos|momentos)|luego|enseguida|ahora te|aqu[ií] (est[aá]|tienes)|c[oó]digo QR para|ya (le|te) avis|\d/i);
    // Español de Bolivia, sin voseo.
    expect(texto).not.toMatch(/\b(escribí|mandá|tocá|escaneá|guardá|podés|tenés)\b/i);
  });

  it('sin número del negocio no se invita a un botón que no existe', () => {
    const s = ejecutar(codigoDe(f, 'QR no enviado'), [rechazo],
      { 'Preparar QR de cobro': [{ ...previo, numeroDueno: '' }], 'Config del negocio': [{ numeroDueno: '', rotuloDemo: ROTULO }] })[0] ?? {};
    const salida = enviar(s, { numeroDueno: '', nombreNegocio: 'Un Negocio' });
    expect(salida['conBoton']).toBe(false);
    expect(String(salida['textoParaTexto'])).not.toMatch(/bot[oó]n|wa\.me/);
    expect(String(salida['textoParaTexto'])).toContain('No pude enviarte la imagen del QR.');
  });

  it('el fallo del REENVÍO lee el preparador que corrió, y el reporte del QR bueno también', () => {
    const reenvio: J = { ...ENT, captionQr: ROTULO + '\n\nEste es el QR de tu pedido.', esReenvio: true, cobroTotal: '' };
    const s = ejecutar(codigoDe(f, 'QR no enviado'), [rechazo],
      { 'Preparar reenvío del QR': [reenvio], 'Config del negocio': [{ rotuloDemo: ROTULO }] })[0] ?? {};
    expect(s['from']).toBe(CLIENTE);
    expect(String(s['respuesta'])).toBe(ROTULO + '\n\nNo pude enviarte la imagen del QR.');
    expect(enviar(s)['conBoton']).toBe(true);
    // «Reportar QR (saliente)» en un reenvío: el pie y el teléfono son del reenvío, sin `qr_enviado`.
    const cuerpo = JSON.parse(String(expresion(nodo(f, 'Reportar QR (saliente)').parameters['jsonBody'],
      { messages: [{ id: 'wamid.RE' }] }, { 'Normalizar entrada': [ENT], 'Preparar reenvío del QR': [reenvio] })));
    expect(cuerpo.telefono).toBe(CLIENTE);
    expect(cuerpo.texto).toContain('Este es el QR de tu pedido.');
    expect(cuerpo.evento).toBeUndefined();
    expect(cuerpo.idMeta).toBe('wamid.RE');
  });

  it('el QR que falló no se reporta como saliente; el mensaje al cliente solo si Meta devuelve un id', () => {
    expect(destinos(f, 'Enviar QR de cobro', 0)).toEqual(['Reportar QR (saliente)']);
    expect(destinos(f, 'Enviar QR de cobro', 1)).toEqual(['QR no enviado']);
    expect(entradas(f, 'Reportar QR (saliente)')).toEqual(['Enviar QR de cobro']);
    // El reporte del mensaje cuelga del envío aceptado (con el id), no de «QR no enviado».
    expect(destinos(f, 'Responder con botón', 0)).toEqual(['Texto enviado']);
    const mensaje = enviar(noEnviado());
    const rep = ejecutar(codigoDe(f, 'Texto enviado'), [{ messages: [{ id: 'wamid.X' }] }],
      { 'Normalizar entrada': [ENT], 'Mensaje a enviar': [mensaje] })[0] ?? {};
    expect(rep['idMeta']).toBe('wamid.X');
    expect(rep['texto']).toBe(mensaje['respuesta']);
  });

  it('sin fallo el camino normal queda igual: ningún mensaje de más', () => {
    // Solo la salida de error del QR llega a «QR no enviado».
    expect(entradas(f, 'QR no enviado')).toEqual(['Enviar QR de cobro']);
    const p = turno({ output: 'Aquí tu QR. [ENVIAR_QR]' });
    expect(p['enviarQr']).toBe(true);
    expect(p['textoEnElQr']).toBe(true);
    expect(f.nodes.filter((n) => n.type === 'n8n-nodes-base.whatsApp').map((n) => n.name).sort())
      .toEqual(['Avisar al dueño', 'Obtener URL del medio', 'Obtener URL del medio (general)', 'Responder al cliente'].sort());
  });

  it('con el pie REAL de los preparadores (simulado, real y reenvío) no se piden cosas imposibles ni hay voseo', () => {
    const base: J = {
      rotuloDemo: ROTULO, captionQr: 'Envía la foto de tu comprobante para continuar con la demo.',
      nivelEmojis: 'ninguno', moneda: 'Bs', cobroMonto: '597', cobroNombreCuenta: 'Un Negocio', cobroBanco: 'Banco X',
      cobroQrUrl: 'https://ejemplo.invalid/qr.png', qrUrl: 'https://ejemplo.invalid/demo.png', qrMediaId: 'MEDIA1',
    };
    const ARMADORES: [string, string, J][] = [
      ['Preparar QR de cobro', 'simulado', { ...base, cobroRealActivo: 'no' }],
      ['Preparar QR de cobro', 'real', { ...base, cobroRealActivo: 'si' }],
      ['Preparar reenvío del QR', 'reenvío simulado', { ...base, cobroRealActivo: 'no' }],
      ['Preparar reenvío del QR', 'reenvío real', { ...base, cobroRealActivo: 'si' }],
    ];
    for (const [preparador, modo, cfg] of ARMADORES) {
      const prep = ejecutar(codigoDe(f, preparador), [{ ...ENT, respuesta: 'Aquí tienes el código QR para pagar.', textoEnElQr: true }],
        { 'Config del negocio': [cfg] })[0] ?? {};
      expect(String(prep['captionQr']), modo).not.toBe('');
      const s = ejecutar(codigoDe(f, 'QR no enviado'), [rechazo], { [preparador]: [prep], 'Config del negocio': [cfg] })[0] ?? {};
      const texto = String(s['respuesta']);
      expect(texto, modo).not.toMatch(/escane|comprobante|este es el qr|aqu[ií] tienes|guard[aá]|mand[aá]/i);
      expect(texto, modo).toContain('No pude enviarte la imagen del QR.');
      if (modo.includes('simulado')) expect(texto, modo).toContain(ROTULO);
      else expect(texto, modo).toBe('No pude enviarte la imagen del QR.');
      expect(enviar(s)['conBoton'], modo).toBe(true);
    }
  });

  it('un error sin `message` no imprime «[object Object]» en el aviso', () => {
    for (const error of [{ code: 400 }, { message: '' }, {}]) {
      const s = ejecutar(codigoDe(f, 'QR no enviado'), [{ error }],
        { 'Preparar QR de cobro': [previo], 'Config del negocio': [{ rotuloDemo: ROTULO }] })[0] ?? {};
      expect(String(s['textoAviso'])).not.toContain('[object Object]');
    }
  });

  it('dos corridas de «Mensaje a enviar»: un botón aceptado se reporta con su cuerpo, no con el texto con enlace', () => {
    const texto = enviar(turno({ output: 'Te paso con alguien. [TRANSFERIR]' }));
    const fallo = enviar(noEnviado());
    const rep = (prev: string): J => ejecutar(codigoDe(f, 'Texto enviado'), [{ messages: [{ id: 'wamid.Z' }] }],
      { 'Normalizar entrada': [ENT], 'Mensaje a enviar': [fallo, texto], 'Responder al cliente': [{}] },
      { $prevNode: { name: prev } })[0] ?? {};
    expect(rep('Responder con botón')['texto']).toBe(fallo['respuesta']);
    expect(rep('Responder al cliente')['texto']).toBe(fallo['textoParaTexto']);
  });
  // COSTO POR TURNO, declarado. Un turno con QR que falla manda, al cliente: el texto
  // del agente (si NO viaja en el pie de la imagen) + el mensaje de fallo. La imagen
  // que Meta rechazó no se cobra. Esperado: 1 mensaje si el texto iba en el pie
  // (el caso del 03/10: antes 0), 2 si el texto sale por el embudo.
  const turnoConQrFallido = (output: string, ent: J = {}): { texto: J; mensajes: J[] } => {
    const p = turno({ output }, ent);
    const mensajes: J[] = [];
    if (p['pedirCatalogo'] !== true && p['textoEnElQr'] !== true) mensajes.push(enviar(p));
    const s = ejecutar(codigoDe(f, 'QR no enviado'), [rechazo],
      { 'Preparar QR de cobro': [{ ...ENT, ...p, captionQr: ROTULO + '\n\n' + String(p['respuesta']) }], 'Config del negocio': [{ rotuloDemo: ROTULO }] })[0] ?? {};
    mensajes.push(enviar(s));
    return { texto: p, mensajes };
  };

  it('costo: [TRANSFERIR] con el QR fallido = 2 mensajes al cliente, AMBOS con botón', () => {
    const { mensajes } = turnoConQrFallido('Te paso con alguien. [ENVIAR_QR] [TRANSFERIR]');
    expect(mensajes).toHaveLength(2);
    expect(mensajes.map((m) => m['conBoton'])).toEqual([true, true]);
  });

  it('costo: un texto de más de 700 caracteres no cabe en el pie = 2 mensajes (el del agente, sin botón, y el de fallo, con botón)', () => {
    const largo = 'Tu pedido incluye varios productos del menú del día. '.repeat(14) + '[ENVIAR_QR]';
    const { texto, mensajes } = turnoConQrFallido(largo);
    expect(texto['textoEnElQr']).toBe(false);
    expect(mensajes).toHaveLength(2);
    expect(mensajes.map((m) => m['conBoton'])).toEqual([false, true]);
  });

  it('costo: el texto corto en el pie = 1 mensaje al cliente (antes del arreglo, 0)', () => {
    const { texto, mensajes } = turnoConQrFallido('Aquí tu QR. [ENVIAR_QR]');
    expect(texto['textoEnElQr']).toBe(true);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]?.['conBoton']).toBe(true);
  });

  it('costo: el reenvío fallido = 2 mensajes (el texto del agente y el de fallo, con botón)', () => {
    const p = turno({ output: 'Te lo reenvío. [REENVIAR_QR]' }, { cobroPendiente: 'si' });
    expect(p['reenviarQr']).toBe(true);
    expect(p['textoEnElQr']).toBe(false);
    const reenvio: J = { ...ENT, captionQr: ROTULO + '\n\nEste es el QR de tu pedido.', esReenvio: true, qrEsReal: false };
    const s = ejecutar(codigoDe(f, 'QR no enviado'), [rechazo],
      { 'Preparar reenvío del QR': [reenvio], 'Config del negocio': [{ rotuloDemo: ROTULO }] })[0] ?? {};
    const mensajes = [enviar(p), enviar(s)];
    expect(mensajes).toHaveLength(2);
    expect(mensajes[1]?.['conBoton']).toBe(true);
    expect(String(mensajes[1]?.['respuesta'])).not.toMatch(/Este es el QR/);
  });

  it('si no se puede leer ningún preparador, en modo simulado el mensaje conserva el rótulo; en real, no', () => {
    const sim = ejecutar(codigoDe(f, 'QR no enviado'), [rechazo],
      { 'Normalizar entrada': [ENT], 'Config del negocio': [{ rotuloDemo: ROTULO, cobroRealActivo: 'no' }] })[0] ?? {};
    expect(String(sim['respuesta'])).toContain(ROTULO);
    expect(sim['from']).toBe(CLIENTE);
    const real = ejecutar(codigoDe(f, 'QR no enviado'), [rechazo],
      { 'Normalizar entrada': [ENT], 'Config del negocio': [{ rotuloDemo: ROTULO, cobroRealActivo: 'si' }] })[0] ?? {};
    expect(String(real['respuesta'])).toBe('No pude enviarte la imagen del QR.');
  });

  it('[PEDIDO_CONFIRMADO] con el QR fallido: el aviso del pedido NO dice que el resumen se envió al cliente', () => {
    const p = turno({ output: 'Listo, tu pedido. [PEDIDO_CONFIRMADO] [ENVIAR_QR]' });
    expect(p['pedidoConfirmado']).toBe(true);
    expect(p['textoEnElQr']).toBe(true);
    const texto = nodo(f, 'Avisar al dueño').parameters['textBody'];
    const conFallo = String(expresion(texto, p, { 'QR no enviado': [{}] }));
    expect(conFallo).not.toContain('Resumen enviado al cliente');
    expect(conFallo).toContain('NO llegó al cliente');
    // Sin fallo, o con el texto fuera del pie, el aviso sigue siendo el de siempre.
    expect(String(expresion(texto, p, {}))).toContain('Resumen enviado al cliente');
    expect(String(expresion(texto, { ...p, textoEnElQr: false }, { 'QR no enviado': [{}] }))).toContain('Resumen enviado al cliente');
  });

  it('limitación conocida (D11): «Responder al cliente» sin onError, y no se mueve ningún nodo', () => {
    expect(nodo(f, 'Responder al cliente').onError).toBeUndefined();
    expect(codigoDe(f, 'QR no enviado')).toContain('LIMITACION CONOCIDA');
  });
});

describe('(7) El prompt: solo promete pasar con una persona si hay a quién', () => {
  const sistema = String(nodo(f, 'AI Agent NovuChat').parameters['options'].systemMessage);
  const con = plantilla(sistema, { ...ENT, moneda: 'Bs' });
  const sin = plantilla(sistema, { ...ENT, moneda: 'Bs', numeroDueno: '' });

  it('con número del dueño enseña [TRANSFERIR]', () => {
    expect(con).toContain('escribe [TRANSFERIR] al final');
    expect(con).toContain('pasar con una persona del negocio');
    expect(con).not.toContain('no tiene a quién pasarle');
  });

  it('sin número conserva la regla anterior y no ofrece pasar con nadie', () => {
    expect(sin).not.toContain('[TRANSFERIR]');
    expect(sin).toContain('Este negocio no tiene a quién pasarle la conversación');
    expect(sin).toContain('mandar el QR de pago y confirmar el pedido.');
    expect(sin).not.toContain('pasar con una persona');
  });

  it('la regla de no prometer es la nueva y el filtro PROMESA no borra la oración de la transferencia', () => {
    expect(con).toContain('no le prometes al cliente que alguien le escribirá ni que le avisarás después');
    // Solo se afirma lo que siempre se cumple: el botón. El aviso al dueño puede no
    // salir (repetido en 24 h, o rechazado), y eso lo dicen los textos fijos del código.
    expect(con).toContain('Si transfieres, di que puede tocar el botón para escribirle directo al negocio, sin prometer tiempos.');
    expect(con).not.toContain('ya fue avisado');
    expect(con).not.toContain('«le avisas»');
    expect(sin).toContain('no le prometes al cliente que alguien le escribirá');
    expect(sin).not.toContain('Si transfieres');
    for (const o of ['Ya le avisé al negocio, así que puedes tocar el botón para escribirle directo.',
      'Puedes tocar el botón para escribirle directo al negocio.']) {
      const p = turno({ output: o + ' [TRANSFERIR]' });
      expect(p['respuesta'], o).toBe(o);
      expect(p['avisos']).not.toContain('promesa_quitada');
    }
    // Y la promesa de verdad sí se quita.
    expect(turno({ output: 'Hola. Mañana te avisaré cuando esté. [TRANSFERIR]' })['avisos']).toContain('promesa_quitada');
  });
});
