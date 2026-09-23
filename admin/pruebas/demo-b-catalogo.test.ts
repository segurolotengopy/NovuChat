/**
 * EL CATÁLOGO WEB EN EL DEMO B: UN ENLACE, EN UN SOLO MENSAJE.
 *
 * QUÉ SE PRUEBA Y POR QUÉ. El asistente de venta puede derivar al cliente al
 * catálogo web propio: manda la dirección, el cliente navega y elige. Tres
 * cosas tenían que quedar clavadas, y son las tres que esta suite defiende:
 *
 *   1. UN SOLO MENSAJE. El texto del agente y la dirección salen juntos. Desde
 *      el 01/10/2026 Meta cobra cada mensaje del asistente (0,0113 USD por
 *      mensaje, «Base comercial» §1 de CLAUDE.md): partir la derivación en dos
 *      mensajes habría hecho que la jugada que existe para ACORTAR la
 *      conversación costara más que no hacerla.
 *   2. SIN ENLACE NO SE PROMETE NADA. `enlaceCatalogo` tiene diez respuestas
 *      posibles y solo una trae dirección. En las otras nueve el mensaje sigue
 *      la conversación por chat —que es lo que este flujo sí cumple— y jamás
 *      dice «te lo mando en un rato». Es la política general del 21/09/2026
 *      hecha código, no prompt.
 *   3. SE REPORTA LO QUE SALIÓ. `Reportar mensaje (saliente)` colgaba de
 *      `Procesar respuesta` y registraba el texto del MODELO. En el turno del
 *      catálogo ese texto no es el que se envía, así que la consola —que es
 *      donde se mira lo que Meta va a cobrar— habría registrado otra cosa.
 *
 * Como en el resto de las suites de flujos, el código y las expresiones se
 * EXTRAEN DEL JSON VERSIONADO y se ejecutan (`lib/flujo.ts`): copiar la lógica
 * acá dejaría la prueba en verde mientras el flujo se rompe.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  type J, codigoDe, configBase, destinos, ejecutar, entradas, expresion, leerFlujo, nodo, plantilla,
} from './lib/flujo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));

const f = leerFlujo('demo-b-venta-cobro.json');
const y = (nombre: string) => nodo(f, nombre).position?.[1] ?? Number.NaN;

/** La configuración que `Normalizar entrada` deja en el item de cada turno. */
const CONFIG: J = {
  from: '59170000001', nombrePerfil: 'Ana', phoneNumberId: '1000000001',
  numeroDueno: '59170000009', waGraphVersion: 'v26.0', nombreNegocio: 'Un Negocio',
  rotuloDemo: 'rótulo simulado', textoPagoSimulado: 'Pago verificado (SIMULADO).',
  captionQr: 'caption', qrMediaId: '', qrUrl: '',
};

const procesar = (salidaDelModelo: string, cfg: J = {}): J =>
  ejecutar(codigoDe(f, 'Procesar respuesta'), [{ output: salidaDelModelo }],
    { 'Normalizar entrada': [{ ...CONFIG, ...cfg }] })[0] ?? {};

/** `Enlace del catálogo` con una respuesta simulada de `enlaceCatalogo`. */
const enlazar = (respuestaHttp: J, previo: J): J =>
  ejecutar(codigoDe(f, 'Enlace del catálogo'), [respuestaHttp],
    { 'Procesar respuesta': [previo] })[0] ?? {};

/** Lo que el cliente recibe en un turno de catálogo, de punta a punta. */
const turnoDeCatalogo = (salidaDelModelo: string, respuestaHttp: J): J => {
  const previo = procesar(salidaDelModelo);
  expect(previo['pedirCatalogo']).toBe(true);
  return enlazar(respuestaHttp, previo);
};

const OK = (extra: J = {}): J => ({
  statusCode: 200,
  body: {
    url: 'https://novuchat-demo.web.app/c/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    caducaEn: '2026-09-25T12:00:00.000Z', items: 12, catalogoGrande: false, ...extra,
  },
});

/**
 * Lo que el asistente NO puede decir cuando no hay enlace: cualquier promesa
 * que este flujo no cumple. No hay a quién pasarle la conversación ni nadie
 * que escriba después.
 */
const PROMESA_SIN_RESPALDO =
  /(te (lo )?(mando|paso|env[ií]o|comparto)[^.!?]{0,30}(luego|despu[eé]s|en un rato|m[aá]s tarde|en breve|apenas)|te aviso|te escribo (luego|despu[eé]s)|lo consulto|voy a (consultar|averiguar|revisar)|en cuanto (lo|est[eé]) )/i;

/** Una compuerta IF del flujo, evaluada como la evaluaría n8n. */
const pasa = (compuerta: string, json: J): boolean => {
  const c = (nodo(f, compuerta).parameters['conditions'] as {
    conditions: { leftValue: string; operator: { operation: string } }[];
  }).conditions[0]!;
  const v = expresion(c.leftValue, json);
  return c.operator.operation === 'false' ? v !== true : v === true;
};

// ---------------------------------------------------------------------------

describe('El cableado: quién entra y quién sale de cada nodo nuevo', () => {
  it('el abanico de «Procesar respuesta» ya no responde directo ni reporta el saliente', () => {
    // La primera rama es la que responde al cliente y la segunda la del
    // catálogo: con `executionOrder: v1` corren en el orden del lienzo, de
    // arriba hacia abajo, y el cliente tiene que recibir su mensaje antes de
    // que corran las ramas que solo registran o avisan.
    expect(destinos(f, 'Procesar respuesta')).toEqual([
      '¿Responder ahora?', '¿Pedir catálogo?', '¿Enviar QR?', '¿Pedido confirmado?', '¿Hay comprobante?',
    ]);
    expect(destinos(f, 'Procesar respuesta')).not.toContain('Reportar mensaje (saliente)');
    expect(destinos(f, 'Procesar respuesta')).not.toContain('Responder al cliente');
  });

  it('la compuerta del catálogo lleva al pedido del enlace, y su rama falsa no hace nada', () => {
    expect(destinos(f, '¿Pedir catálogo?', 0)).toEqual(['Pedir enlace del catálogo']);
    expect(destinos(f, '¿Pedir catálogo?', 1)).toEqual([]);
    expect(destinos(f, 'Pedir enlace del catálogo')).toEqual(['Enlace del catálogo']);
    expect(destinos(f, 'Enlace del catálogo')).toEqual(['Responder al cliente']);
  });

  it('«¿Responder ahora?» corta el camino normal; los otros orígenes siguen directos', () => {
    expect(destinos(f, '¿Responder ahora?', 0)).toEqual(['Responder al cliente']);
    expect(destinos(f, '¿Responder ahora?', 1)).toEqual([]);
    // `Comercio no operativo` y `¿Responder uso extendido?` NO pasan por la
    // compuerta nueva: solo la respuesta del agente puede tener que callarse
    // para que el mensaje lo arme el enlace. Desde el 22/09 se suma la rama del
    // carrito, que entra por el otro disparador.
    expect([...entradas(f, 'Responder al cliente')].sort()).toEqual([
      '¿Avisar del carrito?', '¿Responder ahora?', '¿Responder uso extendido?',
      'Comercio no operativo', 'Enlace del catálogo',
    ].sort());
  });

  it('el saliente se reporta DESPUÉS del envío, una sola vez y por un solo camino', () => {
    // Antes colgaba de `Procesar respuesta` (el texto del modelo) y además del
    // uso extendido, que reportaba en paralelo al envío. Ahora hay un único
    // camino: envío → «Texto enviado» → reporte.
    expect(destinos(f, 'Responder al cliente')).toEqual(['Texto enviado']);
    expect(destinos(f, 'Texto enviado')).toEqual(['Reportar mensaje (saliente)']);
    expect(entradas(f, 'Reportar mensaje (saliente)')).toEqual(['Texto enviado']);
    expect(destinos(f, '¿Responder uso extendido?', 0)).toEqual(['Responder al cliente']);
  });

  it('el orden de las ramas es el del lienzo: de arriba hacia abajo por coordenada Y', () => {
    expect(f.settings?.executionOrder).toBe('v1');
    const ys = destinos(f, 'Procesar respuesta').map(y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(y('¿Responder ahora?')).toBeLessThan(y('¿Pedir catálogo?'));
    expect(y('¿Pedir catálogo?')).toBeLessThan(y('¿Enviar QR?'));
    // Lo que no puede cambiar nunca: el mensaje del cliente se reporta antes
    // que la respuesta, o el aviso de uso extendido no sale (PR #66).
    expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('¿Comercio operativo?'));
  });

  it('los nodos nuevos tienen id corto, no un UUID', () => {
    for (const n of ['¿Responder ahora?', '¿Pedir catálogo?', 'Pedir enlace del catálogo',
      'Enlace del catálogo', 'Texto enviado']) {
      expect(nodo(f, n).id, n).toMatch(/^[a-z][a-z0-9-]{2,30}$/);
    }
  });
});

describe('Las compuertas: el texto sale por UN camino y solo por uno', () => {
  it('sin pedido de catálogo responde el camino normal y la rama del catálogo no', () => {
    const item = procesar('Claro, tenemos hamburguesas. ¿Cuántas quieres?');
    expect(item['pedirCatalogo']).toBe(false);
    expect(pasa('¿Responder ahora?', item)).toBe(true);
    expect(pasa('¿Pedir catálogo?', item)).toBe(false);
  });

  it('con pedido de catálogo se corta el camino normal y responde la rama del catálogo', () => {
    const item = procesar('Mira todo lo que tenemos. [ENVIAR_CATALOGO]');
    expect(item['pedirCatalogo']).toBe(true);
    expect(pasa('¿Responder ahora?', item)).toBe(false);
    expect(pasa('¿Pedir catálogo?', item)).toBe(true);
  });

  it('un item sin el campo (un camino viejo) responde igual: ante la duda, se contesta', () => {
    expect(pasa('¿Responder ahora?', { respuesta: 'hola' })).toBe(true);
    expect(pasa('¿Pedir catálogo?', { respuesta: 'hola' })).toBe(false);
  });
});

describe('CUÁNTOS MENSAJES CUESTA: exactamente los mismos que antes', () => {
  /** Cuántos mensajes de texto recibe el cliente en un turno. */
  const mensajes = (item: J) =>
    (pasa('¿Responder ahora?', item) ? 1 : 0) + (pasa('¿Pedir catálogo?', item) ? 1 : 0);

  it('el turno del catálogo manda UN mensaje, con el texto y la dirección juntos', () => {
    const item = procesar('Te comparto lo que tenemos. [ENVIAR_CATALOGO]');
    expect(mensajes(item)).toBe(1);
    const salida = enlazar(OK(), item);
    expect(String(salida['respuesta'])).toContain('Te comparto lo que tenemos.');
    expect(String(salida['respuesta'])).toContain('https://novuchat-demo.web.app/c/');
  });

  it('un turno normal manda UN mensaje, como siempre', () => {
    expect(mensajes(procesar('Son 70 Bs en total. ¿Delivery o pasas a recoger?'))).toBe(1);
  });

  it('sin enlace tampoco se manda un mensaje de más: sigue siendo uno', () => {
    const item = procesar('Te paso el catálogo. [ENVIAR_CATALOGO]');
    expect(mensajes(item)).toBe(1);
    expect(String(enlazar({ statusCode: 409, body: { error: 'catalogo web apagado' } }, item)['respuesta']))
      .not.toBe('');
  });

  it('el único nodo que le escribe al cliente sigue siendo «Responder al cliente»', () => {
    // Si alguien agregara un segundo emisor, cada conversación costaría más sin
    // que nadie lo note hasta la factura de Meta.
    const aClientes = f.nodes.filter((n) => n.type === 'n8n-nodes-base.whatsApp')
      .map((n) => n.name).sort();
    expect(aClientes).toEqual(['Avisar al dueño', 'Responder al cliente']);
  });
});

describe('«Procesar respuesta»: la marca se detecta y nunca llega al cliente', () => {
  it('detecta [ENVIAR_CATALOGO], la borra del texto y avisa a la rama', () => {
    const s = procesar('Tenemos de todo. [ENVIAR_CATALOGO]');
    expect(s['pedirCatalogo']).toBe(true);
    expect(s['respuesta']).toBe('Tenemos de todo.');
    expect(String(s['respuesta'])).not.toContain('[');
  });

  it('una marca que el modelo se inventó se borra y no dispara nada', () => {
    const s = procesar('Acá tienes el catálogo. [MANDAR_CATALOGO]');
    expect(s['pedirCatalogo']).toBe(false);
    expect(s['respuesta']).toBe('Acá tienes el catálogo.');
    expect(String(s['respuesta'])).not.toContain('MANDAR_CATALOGO');
  });

  it('una respuesta que es SOLO la marca no se toma por vacía', () => {
    // Política del 21/09/2026. Con el aviso de fallo, el cliente que pidió el
    // catálogo habría recibido «no pude generar la respuesta» y el enlace.
    const s = procesar('[ENVIAR_CATALOGO]');
    expect(s['pedirCatalogo']).toBe(true);
    expect(s['avisos']).toContain('catalogo_sin_texto');
    expect(s['avisos']).not.toContain('respuesta_vacia');
    expect(String(s['respuesta'])).not.toBe('');
    expect(String(s['respuesta'])).not.toMatch(/no pude generar/i);
  });

  it('las marcas de siempre siguen funcionando igual', () => {
    const qr = procesar('Son 70 Bs. [ENVIAR_QR]');
    expect(qr['enviarQr']).toBe(true);
    expect(qr['pedirCatalogo']).toBe(false);
    expect(String(qr['respuesta'])).toContain('rótulo simulado');
    const ok = procesar('Listo. [PEDIDO_CONFIRMADO]');
    expect(ok['pedidoConfirmado']).toBe(true);
    expect(ok['pedirCatalogo']).toBe(false);
  });
});

describe('«Enlace del catálogo»: el camino feliz', () => {
  const previo = { ...CONFIG, respuesta: 'Mira todo lo que tenemos.', pedirCatalogo: true, avisos: [] };

  it('un 200 con dirección sale en el MISMO mensaje que el texto del agente', () => {
    const s = enlazar(OK(), previo);
    const texto = String(s['respuesta']);
    expect(texto).toContain('Mira todo lo que tenemos.');
    expect(texto).toContain('https://novuchat-demo.web.app/c/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(texto).toContain('12 productos');
    // Y sigue la conversación por donde este flujo sí puede seguirla.
    expect(texto).toMatch(/escríbeme por acá/i);
    expect(s['catalogoMotivo']).toBe('ok');
    expect(s['avisos']).toContain('catalogo_enlace');
  });

  it('arrastra el teléfono y la configuración que leen el envío y el reporte', () => {
    const s = enlazar(OK(), previo);
    expect(s['from']).toBe('59170000001');
    expect(s['phoneNumberId']).toBe('1000000001');
    expect(s['numeroDueno']).toBe('59170000009');
  });

  it('con el catálogo GRANDE dice que el detalle está en el enlace', () => {
    // Con más de 40 ítems el asistente recibe `catalogo: []` y un resumen: si
    // el mensaje no dijera que el detalle está en la página, el cliente le
    // pediría por chat una lista que el modelo no puede recitar.
    const s = enlazar(OK({ catalogoGrande: true, items: 312 }), previo);
    const texto = String(s['respuesta']);
    expect(texto).toMatch(/más productos de los que puedo escribirte/i);
    expect(texto).toContain('el detalle completo, con precios, está en este enlace');
    expect(texto).toContain('312 en total');
    expect(s['catalogoGrande']).toBe(true);
    expect(s['avisos']).toContain('catalogo_enlace_grande');
  });

  it('guarda en la ejecución lo que contestó el endpoint, para poder auditarlo', () => {
    const s = enlazar(OK(), previo);
    expect(s['catalogoCodigo']).toBe(200);
    expect(s['caducaCatalogoEn']).toBe('2026-09-25T12:00:00.000Z');
    expect(s['catalogoItems']).toBe(12);
  });
});

describe('«Enlace del catálogo»: sin enlace no se promete nada', () => {
  /** Las diez respuestas de `enlaceCatalogo`, verificadas en `catalogoWeb.ts`. */
  const SIN_ENLACE: [string, J, string][] = [
    ['405 · no es POST', { statusCode: 405, body: 'metodo' }, 'metodo'],
    ['401 · firma o token inválidos', { statusCode: 401, body: 'no autorizado' }, 'no autorizado'],
    ['404 · número sin tenant', { statusCode: 404, body: 'numero no asignado' }, 'numero no asignado'],
    ['409 · la ruta no está activa', { statusCode: 409, body: { estado: 'suspendido' } }, 'suspendido'],
    ['409 · el comercio no vende', { statusCode: 409, body: { error: 'el catalogo web es solo para venta' } },
      'el catalogo web es solo para venta'],
    ['400 · teléfono mal formado', { statusCode: 400, body: { error: 'telefono' } }, 'telefono'],
    ['500 · falta SITIO_PUBLICO', { statusCode: 500, body: { error: 'sitio no configurado' } },
      'sitio no configurado'],
    ['409 · el comercio no lo encendió', { statusCode: 409, body: { error: 'catalogo web apagado' } },
      'catalogo web apagado'],
    ['409 · sin ítems vendibles', { statusCode: 409, body: { error: 'catalogo sin items vendibles' } },
      'catalogo sin items vendibles'],
    ['sin respuesta · se cayó la red', { error: 'ETIMEDOUT' }, 'sin respuesta'],
  ];

  it.each(SIN_ENLACE)('%s: sigue por chat y no promete nada', (_n, respuesta, motivo) => {
    const s = enlazar(respuesta, {
      ...CONFIG, respuesta: 'Claro, tenemos hamburguesas, salchipapas y gaseosas.', pedirCatalogo: true,
    });
    const texto = String(s['respuesta']);
    expect(texto).not.toMatch(/https?:\/\//);
    expect(texto).not.toMatch(PROMESA_SIN_RESPALDO);
    // Lo único que se ofrece es lo que este flujo cumple: tomar el pedido acá.
    expect(texto).toContain('Te tomo el pedido por acá mismo');
    expect(s['catalogoMotivo']).toBe(motivo);
    expect(s['catalogoUrl']).toBe('');
    expect(s['avisos']).toContain('catalogo_sin_enlace');
  });

  it('se quita la oración del agente que anunciaba la página, y no queda a medias', () => {
    const s = enlazar({ statusCode: 409, body: { error: 'catalogo web apagado' } }, {
      ...CONFIG, pedirCatalogo: true,
      respuesta: 'Tenemos hamburguesas y salchipapas. Te paso el enlace de nuestro catálogo web.',
    });
    const texto = String(s['respuesta']);
    expect(texto).toContain('Tenemos hamburguesas y salchipapas.');
    expect(texto).not.toMatch(/enlace|cat[aá]logo web/i);
    expect(s['avisos']).toContain('anuncio_de_enlace_quitado');
  });

  it('si el agente no dijo nada más que el anuncio, el mensaje sigue teniendo sentido', () => {
    const s = enlazar({ statusCode: 500, body: { error: 'sitio no configurado' } }, {
      ...CONFIG, pedirCatalogo: true, respuesta: 'Te comparto nuestro catálogo para que veas todo lo que tenemos.',
    });
    expect(String(s['respuesta'])).toBe('Te tomo el pedido por acá mismo: dime qué quieres y las cantidades, y lo cerramos.');
  });

  it('un 200 con una dirección que no es https —o que no es una URL— NO se manda', () => {
    // El host se compara entero con `new URL()`: reconocerlo por subcadena
    // dejaría pasar cualquier dominio que contenga el nuestro.
    for (const url of ['http://novuchat-demo.web.app/c/x', 'javascript:alert(1)', 'no es una url', '', 42]) {
      const s = enlazar({ statusCode: 200, body: { url, items: 3 } },
        { ...CONFIG, respuesta: 'Mira.', pedirCatalogo: true });
      expect(String(s['respuesta']), String(url)).not.toMatch(/https?:\/\//);
      expect(s['catalogoUrl'], String(url)).toBe('');
      expect(s['catalogoMotivo'], String(url)).toBe('sin url');
    }
  });

  it('el mensaje nunca queda vacío, pase lo que pase', () => {
    for (const r of [{}, { statusCode: 200, body: {} }, { statusCode: 502, body: 'bad gateway' }]) {
      const s = enlazar(r, { ...CONFIG, respuesta: '', pedirCatalogo: true });
      expect(String(s['respuesta']).trim()).not.toBe('');
    }
  });
});

describe('«Pedir enlace del catálogo»: el nodo HTTP', () => {
  const n = nodo(f, 'Pedir enlace del catálogo');
  const cfg = nodo(f, 'Traer configuración');

  it('llama a `enlaceCatalogo` por POST, con la autenticación de la ingesta', () => {
    expect(n.parameters['method']).toBe('POST');
    expect(String(n.parameters['url'])).toBe('https://us-east1-novuchat-demo.cloudfunctions.net/enlaceCatalogo');
    expect(n.parameters['authentication']).toBe('genericCredentialType');
    expect(n.parameters['genericAuthType']).toBe('httpHeaderAuth');
  });

  it('manda el número del comercio en la cabecera y el teléfono del cliente en el cuerpo', () => {
    const cabecera = (n.parameters['headerParameters'] as { parameters: { name: string; value: string }[] })
      .parameters[0]!;
    expect(cabecera.name).toBe('X-NovuChat-Numero');
    expect(expresion(cabecera.value, { phoneNumberId: '1000000001' })).toBe('1000000001');
    expect(JSON.parse(String(expresion(n.parameters['jsonBody'], { from: '59170000001' }))))
      .toEqual({ telefono: '59170000001' });
  });

  it('espera 8 segundos, no 4: `enlaceCatalogo` paga arranque en frío', () => {
    // `configuracionFlujo` tiene instancia caliente (`instancias-minimas`) y
    // por eso le alcanzan 4 s. Este no la tiene: con 4 s, la primera
    // derivación del día se perdería.
    const o = n.parameters['options'] as { timeout?: number; response?: J };
    expect(o.timeout).toBe(8000);
    expect((cfg.parameters['options'] as { timeout?: number }).timeout).toBe(4000);
  });

  it('trae la respuesta COMPLETA y no se cae: el código se examina y el cliente recibe algo', () => {
    const o = n.parameters['options'] as { response?: { response?: { fullResponse?: boolean; neverError?: boolean } } };
    expect(o.response?.response?.fullResponse).toBe(true);
    expect(o.response?.response?.neverError).toBe(true);
    expect(n.onError).toBe('continueRegularOutput');
  });

  it('declara su credencial POR NOMBRE, el mismo que «Traer configuración»', () => {
    // El 15/09/2026 una credencial declarada por tipo terminó siendo la
    // equivocada: `publicar-flujo.sh` resuelve primero por (tipo, nombre) y
    // solo cae al tipo cuando el nombre no aparece.
    const c = n.credentials?.['httpHeaderAuth'];
    expect(c?.name).toBe(cfg.credentials?.['httpHeaderAuth']?.name);
    expect(c?.id).toBe('');
  });

  it('«Enviar QR (imagen DEMO)» ya no lleva el `genericAuthType` residual', () => {
    // Con él, `importar-flujo-cliente.sh` lo tomaba por un nodo de ingesta y le
    // pisaba la credencial de WhatsApp con la del reporte. Mismo defecto que
    // el del 15/09, latente en otro nodo.
    const qr = nodo(f, 'Enviar QR (imagen DEMO)');
    expect(qr.parameters['authentication']).toBe('predefinedCredentialType');
    expect(qr.parameters['genericAuthType']).toBeUndefined();
    expect(qr.credentials?.['whatsAppApi']?.name).not.toBe(undefined);
  });
});

describe('«Texto enviado»: la consola registra lo que salió', () => {
  const META = { messages: [{ id: 'wamid.SALIENTE' }] };
  const correr = (referencias: Record<string, J[]>) =>
    ejecutar(codigoDe(f, 'Texto enviado'), [META],
      { 'Normalizar entrada': [{ from: '59170000001', phoneNumberId: '1000000001' }], ...referencias })[0] ?? {};

  it('en un turno normal reporta el texto de «Procesar respuesta»', () => {
    const s = correr({ 'Procesar respuesta': [{ from: '59170000001', respuesta: 'Son 70 Bs.' }] });
    expect(s).toMatchObject({ telefono: '59170000001', texto: 'Son 70 Bs.', idMeta: 'wamid.SALIENTE' });
    expect(s['fuenteDelTexto']).toBe('Procesar respuesta');
  });

  it('en el turno del catálogo reporta el mensaje CON la dirección, no el del modelo', () => {
    // Es el defecto de facturación que este cambio cierra: los dos nodos
    // corrieron, y el que mandó es el del enlace.
    const s = correr({
      'Procesar respuesta': [{ from: '59170000001', respuesta: 'Mira lo que tenemos.' }],
      'Enlace del catálogo': [{ from: '59170000001', respuesta: 'Mira lo que tenemos.\n\nAcá: https://x.tld/c/y' }],
    });
    expect(String(s['texto'])).toContain('https://x.tld/c/y');
    expect(s['fuenteDelTexto']).toBe('Enlace del catálogo');
  });

  it('reporta también el aviso de uso extendido y el de comercio no operativo', () => {
    expect(correr({ 'Uso extendido': [{ from: '59170000001', respuesta: 'Gracias por su paciencia.' }] }))
      .toMatchObject({ texto: 'Gracias por su paciencia.', fuenteDelTexto: 'Uso extendido' });
    expect(correr({ 'Comercio no operativo': [{ from: '59170000001', respuesta: 'No podemos atenderte.' }] }))
      .toMatchObject({ texto: 'No podemos atenderte.', fuenteDelTexto: 'Comercio no operativo' });
  });

  it('si ninguna fuente contesta, el reporte sale igual con el teléfono del entrante', () => {
    // Una cifra de menos en la consola es malo; cortar la ejecución después de
    // haber enviado un mensaje que Meta ya cobra es peor.
    const s = correr({});
    expect(s['telefono']).toBe('59170000001');
    expect(s['texto']).toBe('');
    expect(s['idMeta']).toBe('wamid.SALIENTE');
  });

  it('el reporte manda lo que este nodo le deja, como saliente de texto', () => {
    const cuerpo = JSON.parse(String(expresion(
      nodo(f, 'Reportar mensaje (saliente)').parameters['jsonBody'],
      { telefono: '59170000001', texto: 'Son 70 Bs.', idMeta: 'wamid.SALIENTE' })));
    expect(cuerpo).toEqual({
      telefono: '59170000001', direccion: 'saliente', tipo: 'text',
      texto: 'Son 70 Bs.', idMeta: 'wamid.SALIENTE',
    });
  });
});

describe('«Config del negocio»: el catálogo web llega desde el panel', () => {
  const panel = (extra: J) => ({
    statusCode: 200,
    body: {
      tenantId: 'un-negocio', estadoComercio: 'activo', phoneNumberId: '1000000001',
      operacion: { moneda: 'BOB' }, datosDelNegocio: { nombreNegocio: 'Un Negocio' },
      catalogo: [], ...extra,
    },
  });
  const fusionar = (respuesta: unknown): J =>
    ejecutar(codigoDe(f, 'Config del negocio'), [respuesta as J], { 'Config base': [configBase(f)] })[0] ?? {};

  it('el respaldo lo deja APAGADO: sin panel no se ofrece una página que quizá no existe', () => {
    expect(configBase(f)['catalogoWebActivo']).toBe(false);
    for (const r of [{}, { statusCode: 500, body: {} }, { statusCode: 409, body: { estado: 'suspendido' } }]) {
      expect(fusionar(r)['catalogoWebActivo']).toBe(false);
    }
    expect(fusionar(panel({}))['catalogoWebActivo']).toBe(false);
  });

  it('con el catálogo web encendido, el asistente se entera', () => {
    expect(fusionar(panel({ catalogoWeb: { activo: true, derivar: false } }))['catalogoWebActivo']).toBe(true);
  });

  it('con el catálogo GRANDE, el resumen llega como una frase que el modelo pueda leer', () => {
    const s = fusionar(panel({
      catalogoWeb: { activo: true, derivar: true },
      catalogoResumen: {
        total: 312, areas: ['gastronomia', 'retail'], precioMin: 15, precioMax: 480,
        moneda: 'BOB', hayACotizar: true,
      },
    }));
    expect(s['catalogoWebActivo']).toBe(true);
    expect(String(s['catalogoResumen'])).toBe(
      '312 productos en gastronomia, retail con precios de 15 a 480 Bs y algunos a cotizar.');
  });

  it('sin resumen —el catálogo entró entero al prompt— no se inventa ninguna frase', () => {
    expect(fusionar(panel({ catalogoWeb: { activo: true, derivar: false } }))['catalogoResumen']).toBe('');
    expect(fusionar(panel({ catalogoResumen: { total: 0, areas: [] } }))['catalogoResumen']).toBe('');
  });
});

describe('El prompt: cuándo se manda el enlace, y cuándo no', () => {
  const prompt = (cfg: J) =>
    plantilla((nodo(f, 'AI Agent NovuChat').parameters['options'] as { systemMessage: string }).systemMessage, cfg);
  const CON = prompt({ catalogoWebActivo: true, catalogoResumen: '' });
  const SIN = prompt({ catalogoWebActivo: false, catalogoResumen: '' });

  it('con el catálogo web encendido, explica la marca y que la dirección la pone el sistema', () => {
    expect(CON).toContain('[ENVIAR_CATALOGO]');
    expect(CON).toMatch(/el sistema agrega la dirección a ESE MISMO mensaje/);
    expect(CON).toMatch(/Nunca escribas tú una dirección web/);
  });

  it('manda el enlace solo cuando REEMPLAZA la conversación, no cuando la alarga', () => {
    // `Analisis/19` y «Base comercial» §5: si el cliente ya sabe qué quiere, el
    // enlace no ahorra nada y encima agrega vueltas.
    expect(CON).toMatch(/NO LA MANDES si ya te dijo qué quiere/);
    expect(CON).toMatch(/REEMPLAZA la conversación/);
  });

  it('no deja prometer el enlace para después', () => {
    expect(CON).toMatch(/Nunca prometas mandarla «en un rato»/);
  });

  it('con el catálogo web apagado, el prompt no ofrece ninguna página', () => {
    expect(SIN).toMatch(/NO tiene catálogo web/);
    expect(SIN).toContain('No existe ninguna lista tocable ni botón: todo se hace escribiendo.');
    expect(SIN).toMatch(/nunca ofrezcas un enlace ni una página/i);
    // Y la regla 1 vuelve a mandar enumerar el menú en el mismo mensaje.
    expect(SIN).toContain('ENUMÉRASELO TÚ en el mismo mensaje');
  });

  it('con el catálogo grande, el prompt dice que NO recibió la lista', () => {
    const p = prompt({ catalogoWebActivo: true, catalogoResumen: '312 productos en gastronomia.' });
    expect(p).toMatch(/NO lo recibiste completo/);
    expect(p).toContain('312 productos en gastronomia.');
    expect(CON).not.toMatch(/NO lo recibiste completo/);
  });

  it('el prompt del Demo B ya no tutea a medias: se acabó el voseo', () => {
    // CLAUDE.md pide español boliviano sin voseo, y el propio campo
    // `tratamiento` del flujo lo dice desde siempre: «NUNCA uses voseo».
    for (const p of [CON, SIN]) {
      expect(p).not.toMatch(/\b(sos|ten[ée]s|pod[ée]s|quer[ée]s|decilo|pedilos?|atendelo|recordale|resumilo)\b/i);
      // Sin `\b` alrededor: en JavaScript, sin la bandera `u`, una vocal
      // acentuada no es un carácter de palabra y el límite no cierra donde uno
      // cree. Y sin acento estas formas son el imperativo de tú, que sí va.
      expect(p).not.toMatch(/(respondé|terminá|confirmá|avisá|cerrá|mostrá|resumí|recalculá|sumá|preguntá|pedí|calculá|seguí)/);
    }
    expect(String(configBase(f)['estiloEmojis'])).not.toMatch(/\bdecis\b/);
  });
});

/* ==========================================================================
 * LA VUELTA DEL CARRITO (§4.2 de `admin/CATALOGO-WEB.md`)
 *
 * El cliente confirma en la página, `checkoutCatalogo` guarda el pedido y
 * despierta a este flujo por un webhook. Lo que se defiende acá:
 *
 *   1. UN SOLO MENSAJE por carrito, con todo junto: la confirmación, lo que no
 *      entró, lo que falta y la pregunta de quién es el pedido. Es el único
 *      mensaje que este encargo agrega, y agrega uno, no dos.
 *   2. NO SE MANDA LO QUE META RECHAZARÍA. Fuera de la ventana de 24 h solo
 *      entra una plantilla aprobada, y `carrito_te_espera` no lo está: el flujo
 *      calla y el pedido queda en la consola. Inventar un envío que falla es
 *      peor que no mandar.
 *   3. UN CARRITO DE OTRO COMERCIO NO SE CONTESTA. El `tenantId` del cuerpo y
 *      el que el panel devuelve para el número que autenticó tienen que ser el
 *      mismo: son dos caminos distintos hasta el mismo dato.
 *   4. LA RUTA DEL WEBHOOK NO LE PISA LA DE META. `preparar-import.sh` le ponía
 *      a TODOS los disparadores el UUID que Meta tiene registrado.
 * ========================================================================== */

describe('El carrito: el cableado de la rama nueva', () => {
  it('entra por su propio disparador y termina en el envío que ya existía', () => {
    expect(destinos(f, 'Carrito del catálogo')).toEqual(['Validar carrito']);
    expect(destinos(f, 'Validar carrito')).toEqual(['¿Carrito válido?']);
    expect(destinos(f, '¿Carrito válido?', 0)).toEqual(['Config del carrito']);
    expect(destinos(f, '¿Carrito válido?', 1)).toEqual([]);
    expect(destinos(f, 'Config del carrito')).toEqual(['Mensaje del carrito']);
    expect(destinos(f, 'Mensaje del carrito')).toEqual(['¿Avisar del carrito?']);
    expect(destinos(f, '¿Avisar del carrito?', 0)).toEqual(['Responder al cliente']);
    expect(destinos(f, '¿Avisar del carrito?', 1)).toEqual([]);
  });

  it('el envío sigue siendo uno solo, con cinco caminos que llegan a él', () => {
    expect([...entradas(f, 'Responder al cliente')].sort()).toEqual([
      '¿Avisar del carrito?', '¿Responder ahora?', '¿Responder uso extendido?',
      'Comercio no operativo', 'Enlace del catálogo',
    ].sort());
    // Y lo que cuelga del envío no cambió: el reporte del saliente, una vez.
    expect(destinos(f, 'Responder al cliente')).toEqual(['Texto enviado']);
  });

  it('la rama del carrito está debajo de todo: no reordena ninguna rama del mensaje', () => {
    const y = (n: string) => nodo(f, n).position?.[1] ?? Number.NaN;
    const abajo = ['Carrito del catálogo', 'Validar carrito', '¿Carrito válido?',
      'Config del carrito', 'Mensaje del carrito', '¿Avisar del carrito?'];
    const maxDelMensaje = Math.max(...f.nodes
      .filter((n) => !abajo.includes(n.name)).map((n) => n.position?.[1] ?? 0));
    for (const n of abajo) expect(y(n), n).toBeGreaterThan(maxDelMensaje);
    // Y el abanico del agente sigue en el mismo orden.
    const ys = destinos(f, 'Procesar respuesta').map(y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it('los nodos nuevos tienen id corto y no chocan con ninguno', () => {
    const ids = f.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of ['Carrito del catálogo', 'Validar carrito', '¿Carrito válido?',
      'Config del carrito', 'Mensaje del carrito', '¿Avisar del carrito?']) {
      expect(nodo(f, n).id, n).toMatch(/^[a-z][a-z0-9-]{2,30}$/);
    }
  });
});

describe('El disparador del carrito', () => {
  const w = nodo(f, 'Carrito del catálogo');
  const cfg = nodo(f, 'Traer configuración');

  it('es un Webhook POST autenticado por cabecera, con la credencial de siempre', () => {
    expect(w.type).toBe('n8n-nodes-base.webhook');
    expect(w.parameters['httpMethod']).toBe('POST');
    // El nodo Webhook de n8n 2.36 solo sabe none / basicAuth / headerAuth /
    // jwtAuth / n8nOAuth2: NO verifica firmas HMAC. Quien autentica es esta
    // credencial, que lleva el mismo secreto por número que la ingesta.
    expect(w.parameters['authentication']).toBe('headerAuth');
    expect(w.credentials?.['httpHeaderAuth']?.name).toBe(cfg.credentials?.['httpHeaderAuth']?.name);
    expect(w.credentials?.['httpHeaderAuth']?.id).toBe('');
  });

  it('contesta apenas recibe: `despertarFlujo` corta a los 8 s y solo mira el código', () => {
    // Con `lastNode` el servidor esperaría al envío de WhatsApp, y un Meta
    // lento se vería como un webhook caído: el pedido quedaría marcado
    // `entregadoAlFlujo: false` habiéndose entregado.
    expect(w.parameters['responseMode']).toBe('onReceived');
  });

  it('tiene RUTA PROPIA por cliente, y no la del disparador de WhatsApp', () => {
    // Es la mitad del arreglo del §4: con `path` vacío n8n usa el `webhookId`,
    // y ahí `preparar-import.sh` escribe el UUID que Meta tiene registrado.
    expect(String(w.parameters['path'])).toMatch(/^REEMPLAZAR_[A-Z_]+$/);
    expect(w.webhookId).toBeUndefined();
    const meta = nodo(f, 'WhatsApp Trigger');
    expect((meta.parameters as J)['path']).toBeUndefined();
  });
});

describe('«Validar carrito»: qué se atiende y qué se descarta', () => {
  const FIRMA = `sha256=${'a'.repeat(64)}`;
  const CUERPO = {
    tipo: 'carrito', tenantId: 'demo-venta', pedidoId: 'cat_x1', telefono: '59170000001',
    items: [{ id: 'i1', nombre: 'Hamburguesa doble', cantidad: 2, precio: 35, subtotal: 70 }],
    total: 77, moneda: 'BOB', costoEnvio: 7, entrega: 'envio', direccion: 'Calle 21 #100',
    nota: '', descartados: [], ventanaAbierta: true, accion: 'responder', fichaCompartida: false,
  };
  const peticion = (cuerpo: J = {}, cab: J = {}): J => ({
    headers: {
      'x-novuchat-numero': '1000000001',
      'x-novuchat-timestamp': String(Date.now()),
      'x-novuchat-signature': FIRMA,
      ...cab,
    },
    body: { ...CUERPO, ...cuerpo },
  });
  const validar = (p: J): J => ejecutar(codigoDe(f, 'Validar carrito'), [p])[0] ?? {};

  it('un carrito bien formado pasa, con sus datos saneados', () => {
    const v = validar(peticion());
    expect(v['procesar']).toBe(true);
    expect(v['fallas']).toEqual([]);
    expect(v).toMatchObject({
      numero: '1000000001', from: '59170000001', tenantId: 'demo-venta',
      accion: 'responder', entrega: 'envio', moneda: 'Bs', itemsTotal: 1,
    });
  });

  it('una firma que no tiene forma de firma se descarta', () => {
    // No se puede verificar el HMAC sin el secreto —y el secreto no va en el
    // lienzo, prohibición 2—, así que se comprueba la FORMA. Quien autentica
    // es la cabecera del nodo Webhook; esto descarta basura.
    for (const firma of ['', 'sha256=nope', 'md5=' + 'a'.repeat(64), 'a'.repeat(64)]) {
      const v = validar(peticion({}, { 'x-novuchat-signature': firma }));
      expect(v['procesar'], firma).toBe(false);
      expect(v['fallas'], firma).toContain('firma');
    }
  });

  it('una marca de tiempo vieja se descarta: acota el reenvío de una captura', () => {
    expect(validar(peticion({}, { 'x-novuchat-timestamp': String(Date.now() - 45 * 60 * 1000) }))['fallas'])
      .toContain('marca');
    expect(validar(peticion({}, { 'x-novuchat-timestamp': 'ayer' }))['fallas']).toContain('marca');
    // Un reloj corrido de un par de minutos NO tira un carrito legítimo.
    expect(validar(peticion({}, { 'x-novuchat-timestamp': String(Date.now() - 120_000) }))['procesar'])
      .toBe(true);
  });

  it('un cuerpo que no es un carrito del contrato no se contesta', () => {
    expect(validar(peticion({ tipo: 'otra-cosa' }))['fallas']).toContain('tipo');
    expect(validar(peticion({ telefono: 'no-es-un-numero' }))['fallas']).toContain('telefono');
    expect(validar(peticion({ items: [] }))['fallas']).toContain('items');
    expect(validar(peticion({ tenantId: '' }))['fallas']).toContain('tenant');
    expect(validar(peticion({ accion: 'inventada' }))['fallas']).toContain('accion');
    expect(validar(peticion({}, { 'x-novuchat-numero': 'abc' }))['fallas']).toContain('numero');
  });

  it('el texto que va a salir por WhatsApp se sanea igual, aunque venga de casa', () => {
    const v = validar(peticion({
      items: [{ nombre: `Hamburguesa${String.fromCharCode(0x2028)}doble   ${'x'.repeat(200)}`, cantidad: 2, subtotal: 70 }],
      nota: `sin  cebolla${String.fromCharCode(0)}`,
    }));
    const nombre = String((v['items'] as J[])[0]?.['nombre']);
    expect(nombre).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
    expect(nombre.length).toBeLessThanOrEqual(80);
    expect(v['nota']).toBe('sin cebolla');
  });

  it('la compuerta deja pasar solo lo válido', () => {
    const cond = (nodo(f, '¿Carrito válido?').parameters['conditions'] as
      { conditions: { leftValue: string }[] }).conditions[0]?.leftValue;
    expect(expresion(cond, { procesar: true })).toBe(true);
    expect(expresion(cond, { procesar: false })).toBe(false);
  });
});

describe('«Mensaje del carrito»: uno solo, y solo cuando se puede', () => {
  const PREVIO: J = {
    procesar: true, numero: '1000000001', from: '59170000001', tenantId: 'demo-venta',
    pedidoId: 'cat_x1', accion: 'responder', ventanaAbierta: true, fichaCompartida: false,
    items: [
      { nombre: 'Hamburguesa doble', cantidad: 2, subtotal: 70 },
      { nombre: 'Gaseosa', cantidad: 1, subtotal: 12 },
    ],
    itemsTotal: 2, total: 89, moneda: 'Bs', costoEnvio: 7, entrega: 'envio',
    direccion: 'Calle 21 #100, Calacoto', nota: 'Sin cebolla', descartados: 0,
  };
  const PANEL = (extra: J = {}): J => ({
    statusCode: 200,
    body: {
      tenantId: 'demo-venta', estadoComercio: 'activo', phoneNumberId: '1000000001',
      operacion: { moneda: 'BOB' }, datosDelNegocio: { nombreNegocio: 'Un Negocio' },
      catalogo: [], atencion: { estado: 'normal' }, ...extra,
    },
  });
  const armar = (previo: J = {}, panel: J = PANEL()): J =>
    ejecutar(codigoDe(f, 'Mensaje del carrito'), [panel],
      { 'Validar carrito': [{ ...PREVIO, ...previo }] })[0] ?? {};

  /** Nada de lo que el mensaje diga puede ser una promesa sin respaldo. */
  const NO_PROMETE = (texto: string) => {
    expect(texto).not.toMatch(PROMESA_SIN_RESPALDO);
    // Prohibición 3: acá no se cobró nada, y este mensaje no pasa por el
    // modelo, así que el rótulo no lo pone nadie más.
    expect(texto).not.toMatch(/pago|cobr|acredit|transferencia|dep[oó]sito/i);
    // Ni promesas sobre lo que hace el comercio, que el flujo no controla.
    expect(texto).not.toMatch(/prepar|despach|envi(amos|aremos)|sale en|listo en/i);
  };

  it('con la ventana abierta manda UN mensaje con el pedido completo', () => {
    const s = armar();
    expect(s['responder']).toBe(true);
    expect(s['motivo']).toBe('ok');
    const t = String(s['respuesta']);
    expect(t).toContain('2× Hamburguesa doble — 70 Bs');
    expect(t).toContain('1× Gaseosa — 12 Bs');
    expect(t).toContain('Envío: 7 Bs');
    expect(t).toContain('Total: 89 Bs');
    expect(t).toContain('Entrega: envío a Calle 21 #100, Calacoto.');
    expect(t).toContain('Tu nota: Sin cebolla');
    NO_PROMETE(t);
    // Y lo que el envío necesita, en el mismo item.
    expect(s['from']).toBe('59170000001');
    expect(s['phoneNumberId']).toBe('1000000001');
  });

  it('el mensaje entra en un mensaje de WhatsApp aunque el carrito sea enorme', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      nombre: `Producto con nombre largo número ${i + 1}`, cantidad: 3, subtotal: 99,
    }));
    const t = String(armar({ items, itemsTotal: 50 })['respuesta']);
    expect(t.length).toBeLessThan(4096);
    expect(t).toMatch(/y \d+ productos más/);
  });

  it('con la ventana CERRADA no manda nada, y deja la plantilla preparada', () => {
    // `carrito_te_espera` no está aprobada por Meta: un texto libre fuera de la
    // ventana lo rechaza Meta, y una plantilla que no existe también. El pedido
    // igual quedó guardado y el comercio lo ve en su consola.
    const s = armar({ accion: 'plantilla_carrito_espera', ventanaAbierta: false });
    expect(s['responder']).toBe(false);
    expect(s['respuesta']).toBe('');
    expect(String(s['motivo'])).toMatch(/ventana cerrada/);
    expect(s['plantillaPendiente']).toBe(true);
    expect(s['plantilla']).toMatchObject({ nombre: 'carrito_te_espera', idioma: 'es' });
  });

  it('con descartados lo dice y PREGUNTA cuál era: no supone el motivo', () => {
    // Desde el webhook no se distingue si el ítem se dio de baja, si quedó sin
    // precio o si se agotó, y solo llegan identificadores: no se puede ni
    // nombrar el producto. Suponerlo sería inventar.
    const uno = String(armar({ descartados: 1 })['respuesta']);
    expect(uno).toContain('Hay 1 producto que no pude incluir');
    expect(uno).toMatch(/dime cuál era/);
    const varios = String(armar({ descartados: 3 })['respuesta']);
    expect(varios).toContain('Hay 3 productos que no pude incluir');
    expect(varios).toMatch(/dime cuáles eran/);
    for (const t of [uno, varios]) {
      expect(t).toMatch(/se agotar?o?n?|dieron de baja|sin precio/);
      NO_PROMETE(t);
    }
  });

  it('con ficha compartida pide confirmar de quién es el pedido', () => {
    const t = String(armar({ fichaCompartida: true })['respuesta']);
    expect(t).toMatch(/confírmame que el pedido es tuyo/);
  });

  it('si es envío y no hay dirección, la pide en el MISMO mensaje', () => {
    const t = String(armar({ direccion: '' })['respuesta']);
    expect(t).toMatch(/Me falta la dirección de entrega/);
    expect(t).toContain('Total: 89 Bs');
  });

  it('con retiro no habla de envío ni de dirección', () => {
    const t = String(armar({ entrega: 'retiro', costoEnvio: 0, direccion: '' })['respuesta']);
    expect(t).toContain('Entrega: pasas a recoger.');
    expect(t).not.toMatch(/Envío:|dirección/);
  });

  it('un carrito de OTRO comercio no se contesta', () => {
    // El `tenantId` del cuerpo lo escribió `checkoutCatalogo` desde la ficha; el
    // del panel sale del número que autenticó. Dos caminos, un solo dato.
    const s = armar({ tenantId: 'otro-comercio' });
    expect(s['responder']).toBe(false);
    expect(s['respuesta']).toBe('');
    expect(String(s['motivo'])).toMatch(/no es de este comercio/);
  });

  it('con el comercio suspendido o el teléfono bloqueado, no sale nada', () => {
    expect(armar({}, { statusCode: 409, body: { estado: 'suspendido' } })['responder']).toBe(false);
    expect(armar({}, PANEL({ estadoComercio: 'suspendido' }))['responder']).toBe(false);
    // Pasado el umbral de bloqueo no se le manda NADA más a ese teléfono.
    expect(armar({}, PANEL({ atencion: { estado: 'bloqueado' } }))['responder']).toBe(false);
    // En «operador» sí: es un mensaje fijo, no una llamada al modelo, y el
    // cliente acaba de hacer un pedido.
    expect(armar({}, PANEL({ atencion: { estado: 'operador' } }))['responder']).toBe(true);
  });

  it('si el panel no contesta, el carrito se contesta igual', () => {
    // Misma doctrina que «Config del negocio»: una caída del panel no puede
    // dejar sin respuesta a alguien que acaba de hacer un pedido. El número
    // sale de la cabecera, que ya se autenticó.
    for (const roto of [{}, { statusCode: 500, body: {} }, { error: 'ETIMEDOUT' }]) {
      const s = armar({}, roto);
      expect(s['responder']).toBe(true);
      expect(s['phoneNumberId']).toBe('1000000001');
      expect(s['panelContesto']).toBe(false);
    }
  });

  it('la compuerta del aviso solo deja pasar lo que hay que mandar', () => {
    const cond = (nodo(f, '¿Avisar del carrito?').parameters['conditions'] as
      { conditions: { leftValue: string }[] }).conditions[0]?.leftValue;
    expect(expresion(cond, { responder: true })).toBe(true);
    expect(expresion(cond, { responder: false })).toBe(false);
  });
});

describe('El carrito y la cuenta de mensajes', () => {
  it('un carrito confirmado cuesta UN mensaje, y los que no se mandan cuestan CERO', () => {
    const cond = (nombre: string, json: J) => {
      const c = (nodo(f, nombre).parameters['conditions'] as
        { conditions: { leftValue: string; operator: { operation: string } }[] }).conditions[0]!;
      const v = expresion(c.leftValue, json);
      return c.operator.operation === 'false' ? v !== true : v === true;
    };
    const mensajes = (validacion: J, mensaje: J) =>
      (cond('¿Carrito válido?', validacion) && cond('¿Avisar del carrito?', mensaje)) ? 1 : 0;
    expect(mensajes({ procesar: true }, { responder: true })).toBe(1);
    expect(mensajes({ procesar: true }, { responder: false })).toBe(0);
    expect(mensajes({ procesar: false }, { responder: true })).toBe(0);
  });

  it('el mensaje del carrito se reporta como saliente: es un mensaje que Meta cobra', () => {
    // Y se reporta aunque «Normalizar entrada» no haya corrido, que es lo que
    // pasa SIEMPRE en esta rama: el carrito no entra por WhatsApp.
    const s = ejecutar(codigoDe(f, 'Texto enviado'), [{ messages: [{ id: 'wamid.CARRITO' }] }],
      { 'Mensaje del carrito': [{ from: '59170000001', respuesta: 'Recibí tu pedido…', phoneNumberId: '1000000001' }] })[0] ?? {};
    expect(s).toMatchObject({
      telefono: '59170000001', texto: 'Recibí tu pedido…',
      idMeta: 'wamid.CARRITO', fuenteDelTexto: 'Mensaje del carrito',
    });
  });
});

describe('`preparar-import.sh` no le pisa a Meta la ruta del webhook', () => {
  const SCRIPT = join(aqui, '../../scripts/preparar-import.sh');
  const temporales: string[] = [];
  afterAll(() => { for (const d of temporales) rmSync(d, { recursive: true, force: true }); });

  /** Un entorno de juguete: tabla de marcadores, `.env` con la ruta de Meta. */
  const entorno = (nodos: J[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'novuchat-import-'));
    temporales.push(dir);
    writeFileSync(join(dir, 'tabla.md'), '| Marcador | Valor |\n|---|---|\n');
    writeFileSync(join(dir, 'env'), 'N8N_WEBHOOK_PATH=/webhook/00000000-0000-0000-0000-000000000000/webhook\n');
    const flujo = join(dir, 'flujo.json');
    writeFileSync(flujo, JSON.stringify({
      name: 'prueba', settings: { executionOrder: 'v1' }, nodes: nodos, connections: {},
    }, null, 2));
    const r = spawnSync('bash', [SCRIPT, flujo, join(dir, 'env')], {
      encoding: 'utf8', env: { ...process.env, CONFIG_LOCAL_MD: join(dir, 'tabla.md') },
    });
    return { dir, flujo, r };
  };
  const meta: J = {
    id: 't1', name: 'WhatsApp Trigger', type: 'n8n-nodes-base.whatsAppTrigger',
    typeVersion: 1, position: [0, 0], parameters: {},
  };
  const carrito = (path?: string): J => ({
    id: 't2', name: 'Carrito del catálogo', type: 'n8n-nodes-base.webhook',
    typeVersion: 2, position: [0, 200],
    parameters: { httpMethod: 'POST', ...(path === undefined ? {} : { path }) },
  });

  it('el UUID de Meta va SOLO al disparador que no tiene ruta propia', () => {
    const { flujo, r } = entorno([meta, carrito('ruta-propia-del-carrito')]);
    expect(r.status, r.stderr).toBe(0);
    const d = JSON.parse(readFileSync(flujo.replace(/\.json$/, '.local.json'), 'utf8')) as { nodes: J[] };
    const porNombre = Object.fromEntries(d.nodes.map((n) => [n['name'], n]));
    expect(porNombre['WhatsApp Trigger']!['webhookId']).toBe('00000000-0000-0000-0000-000000000000');
    expect(porNombre['Carrito del catálogo']!['webhookId']).toBeUndefined();
    expect(r.stdout).toContain('conserva su ruta propia');
  });

  it('dos disparadores SIN ruta propia se rechazan, y no se escribe nada', () => {
    // Es el defecto que esto cierra: los dos quedaban con el mismo `webhookId`,
    // el nodo Webhook se registraba en la ruta de Meta y dejaba de llegar
    // cualquier mensaje de WhatsApp. El operador no tendría por qué
    // relacionarlo con haber importado.
    const { flujo, r } = entorno([meta, carrito()]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/disparadores sin ruta propia/);
    expect(existsSync(flujo.replace(/\.json$/, '.local.json'))).toBe(false);
  });

  it('el flujo versionado del Demo B pasa esa guarda: su webhook tiene ruta propia', () => {
    const disparadores = f.nodes.filter((n) => /trigger|webhook/i.test(n.type));
    expect(disparadores).toHaveLength(2);
    const sinRuta = disparadores.filter((n) => !String((n.parameters as J)['path'] ?? '').trim());
    expect(sinRuta.map((n) => n.name)).toEqual(['WhatsApp Trigger']);
  });
});
