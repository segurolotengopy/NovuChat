/**
 * =============================================================================
 * EL CARRITO DEL CATÁLOGO WEB, DE PUNTA A PUNTA (Venta mínima v0, Q'Taco)
 * =============================================================================
 *
 * La topología (T) y la lógica (C) se escribieron por separado y acordaron nombres; esta suite las prueba JUNTAS, con el JSON
 * versionado de producción y el código REAL de cada nodo, corrido con el n8n de mentira. Es la prueba del integrador:
 *
 *   `Carrito del catálogo` -> `Carga de entrada` (mensaje sintético `type: 'carrito'`) -> `¿Es un mensaje?` -> `Traer configuración`
 *   -> `Config del negocio` -> `Interpretar entrada` (`tipo: 'carrito'`, `reportarEntrante: false`) -> `¿Reportar? (entrante)`
 *   (por la rama que NO reporta) -> `Decidir turno` -> `¿Extraer?` (sale SIN `Extraer`) -> `Plan del turno` -> `Armar mensajes` -> envíos.
 *
 * Lo que se afirma:
 *   - un carrito válido produce UN solo mensaje de resumen con [Confirmar pedido] [Cambiar algo] [Menú], sin reportarse como mensaje
 *     entrante (el servidor ya escribió el pedido y el hilo), sin llamar al modelo y sin avisar al restaurante (eso es al confirmar);
 *   - un carrito inválido (otro número, sin ítems, sin firma, de marca vieja) no produce nada: 0 mensajes, 0 avisos, 0 reportes;
 *   - un mensaje normal de WhatsApp sigue pasando por el receptor y SÍ se reporta como entrante (la guardia nueva no lo toca).
 */
import { describe, expect, it } from 'vitest';
import { type J } from './lib/flujo';
import {
  AHORA, boton, botonesDe, CLIENTE, crear, entrega, estadoDe, idDeBoton, nodoDe, panel, PHONE_ID, QTACO, texto, turno,
} from './lib/venta-minima-mundo';

const CARRITO = 'Carrito del catálogo';

const cabeceras = (extra: J = {}): J => ({
  'x-novuchat-numero': PHONE_ID, 'x-novuchat-timestamp': String(AHORA), 'x-novuchat-signature': `sha256=${'0'.repeat(64)}`, ...extra,
});
/** El cuerpo que manda el servidor de NovuChat (el mismo del Demo B): los ids son los de la carta del comercio. */
const cuerpo = (extra: J = {}): J => ({
  tipo: 'carrito', tenantId: 'qtaco', telefono: '59100000011', accion: 'responder', pedidoId: 'p-100', conversacionId: 'c-100',
  ventanaAbierta: true, items: [{ id: 'birria3', nombre: 'Tacos de Birria (orden de 3)', cantidad: 2, subtotal: 110 }],
  total: 110, moneda: 'Bs', entrega: 'retiro', costoEnvio: 0, ...extra,
});
const carrito = (w: ReturnType<typeof crear>, item: J) => w.mundo.turno(item, { via: CARRITO, tolerarFallo: true });
const titulos = (t: ReturnType<typeof carrito>): string[] => (t.mensajes[0] ? botonesDe(t.mensajes[0]).map((b) => b.title) : []);

describe('un carrito válido: UN resumen con sus tres botones, sin reportarse como entrante y sin el modelo', () => {
  it('llega por su webhook, recorre el flujo por los nombres acordados y sale UN mensaje [Confirmar pedido] [Cambiar algo] [Menú]', () => {
    const w = crear();
    const t = carrito(w, { headers: cabeceras(), body: cuerpo() });
    expect(t.fallo).toBeNull();
    // El camino exacto, en orden.
    const camino = ['Carga de entrada', '¿Es un mensaje?', 'Traer configuración', 'Config del negocio', 'Interpretar entrada', '¿Reportar? (entrante)', 'Decidir turno', '¿Extraer?', 'Plan del turno', 'Armar mensajes'];
    const posiciones = camino.map((n) => t.orden.indexOf(n));
    expect(posiciones.every((p) => p >= 0), `faltan nodos del camino: ${camino.filter((n, i) => posiciones[i]! < 0).join(', ')}; orden: ${t.orden.join(' > ')}`).toBe(true);
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
    expect(t.orden.slice(0, 2)).toEqual([CARRITO, 'Carga de entrada']);
    expect(t.ejecutados.has('Entrega del receptor')).toBe(false);
    // Lo que el carrito NO hace: no se reporta como mensaje del cliente, no llama al modelo, no avisa todavía al restaurante.
    expect(t.ejecutados.has('Reportar mensaje (entrante)')).toBe(false);
    expect(t.ejecutados.has('Extraer')).toBe(false);
    expect(t.llamadas.extraer).toHaveLength(0);
    expect(t.avisos).toHaveLength(0);
    expect(w.mundo.llamadas.ingesta.filter((x) => x['direccion'] === 'entrante')).toHaveLength(0);
    // Lo que sí: UN mensaje, con el resumen que calcula el código (110 = 2 x 55) y los tres botones.
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]!.a).toBe('59100000011');
    expect(t.mensajes[0]!.cuerpo).toMatch(/110/);
    expect(titulos(t)).toEqual(['Confirmar pedido', 'Cambiar algo', 'Menú']);
    expect(estadoDe(w)['paso']).toBe('pedido_confirmar');
    // Cada nodo corre una vez.
    const veces = new Map<string, number>();
    for (const n of t.orden) veces.set(n, (veces.get(n) ?? 0) + 1);
    expect([...veces].filter(([, v]) => v > 1).map(([n]) => n), `orden: ${t.orden.join(' > ')}`).toEqual([]);
  });

  it('el carrito confirma con el botón, no por sí mismo: «Confirmar pedido» saca el QR y el aviso; sin tocarlo, nada se cobra ni se avisa', () => {
    const w = crear();
    const t = carrito(w, { headers: cabeceras(), body: cuerpo() });
    expect(w.mundo.llamadas.ingesta.filter((x) => x['evento'] === 'qr_enviado')).toHaveLength(0);
    const confirmar = turno(w, boton(idDeBoton(t, 'Confirmar pedido'), 'Confirmar pedido'));
    expect(confirmar.mensajes.some((m) => m.tipo === 'image')).toBe(true);
    expect(w.mundo.llamadas.ingesta.filter((x) => x['evento'] === 'qr_enviado')).toHaveLength(1);
  });

  it('el total lo calcula el código desde la carta: un precio y un total inventados en el cuerpo no mueven el resumen', () => {
    const w = crear();
    const t = carrito(w, { headers: cabeceras(), body: cuerpo({ total: 1, items: [{ id: 'birria3', nombre: 'Tacos de Birria (orden de 3)', cantidad: 2, subtotal: 1 }] }) });
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]!.cuerpo).toMatch(/110/);
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/Total[^\n]*\b1\b(?!\d)/);
  });

  it('un reintento del servidor con el mismo `pedidoId` no se procesa dos veces', () => {
    const w = crear();
    const a = carrito(w, { headers: cabeceras(), body: cuerpo() });
    expect(a.mensajes).toHaveLength(1);
    const b = carrito(w, { headers: cabeceras(), body: cuerpo() });
    expect(b.mensajes).toHaveLength(0);
    expect(b.avisos).toHaveLength(0);
  });
});

describe('el carrito para recoger no llega a cocina sin nombre (revisión del PR #382)', () => {
  it('el nombre ya dado en la conversación se conserva cuando llega el carrito de la página, y viaja al pedido que se confirma', () => {
    const w = crear();
    turno(w, texto('hola'));
    w.estado.extraccion = { lineas: [{ producto: 'tacos de birria', cantidad: 4, forma: 'unidad', detalle: '' }], entrega: 'recojo', direccion: '', referencia: '', nombre: '', quiereHablar: false };
    turno(w, texto('quiero 4 tacos de birria'));
    expect((estadoDe(w)['entrega'] as J)['nombre']).toBe('Carlos Pérez');
    const t = carrito(w, { headers: cabeceras(), body: cuerpo() });
    expect(t.mensajes).toHaveLength(1);
    expect((estadoDe(w)['entrega'] as J)['nombre'], 'el carrito no borra el nombre').toBe('Carlos Pérez');
    const confirmar = turno(w, boton(idDeBoton(t, 'Confirmar pedido'), 'Confirmar pedido'));
    expect(confirmar.mensajes.length).toBeGreaterThan(0);
    expect((estadoDe(w)['pedido'] as J)['nombre']).toBe('Carlos Pérez');
  });
  it('NEGANDO: un cliente sin conversación previa no tiene nombre que conservar (el carrito no trae el nombre de perfil): queda vacío, nunca inventado', () => {
    const w = crear();
    carrito(w, { headers: cabeceras(), body: cuerpo() });
    expect((estadoDe(w)['entrega'] as J)['nombre']).toBe('');
  });
});

describe('un carrito inválido no produce nada: 0 mensajes, 0 avisos, 0 reportes, 0 llamadas al modelo', () => {
  const casos: [string, J][] = [
    ['de otro número (la cabecera nombra un número que no es el del negocio)', { headers: cabeceras({ 'x-novuchat-numero': '100000000000099' }), body: cuerpo() }],
    ['sin ítems', { headers: cabeceras(), body: cuerpo({ items: [] }) }],
    ['sin firma', { headers: Object.fromEntries(Object.entries(cabeceras()).filter(([k]) => k !== 'x-novuchat-signature')), body: cuerpo() }],
    ['con una firma que no tiene la forma', { headers: cabeceras({ 'x-novuchat-signature': 'sha256=corta' }), body: cuerpo() }],
    ['de marca de tiempo vieja (más de 10 minutos)', { headers: cabeceras({ 'x-novuchat-timestamp': String(AHORA - 11 * 60_000) }), body: cuerpo() }],
    ['de otro tenant vacío', { headers: cabeceras(), body: cuerpo({ tenantId: '' }) }],
    ['con un teléfono que no es un número', { headers: cabeceras(), body: cuerpo({ telefono: 'no-es-un-numero' }) }],
    ['sin `pedidoId` (no hay clave para no procesarlo dos veces)', { headers: cabeceras(), body: cuerpo({ pedidoId: '' }) }],
    ['con una acción que no es del carrito', { headers: cabeceras(), body: cuerpo({ accion: 'otra' }) }],
  ];
  for (const [etiqueta, item] of casos) {
    it(etiqueta, () => {
      const w = crear();
      const t = carrito(w, item);
      expect(t.fallo).toBeNull();
      expect(t.mensajes).toHaveLength(0);
      expect(t.avisos).toHaveLength(0);
      for (const n of ['Reportar mensaje (entrante)', 'Reportar mensaje (saliente)', 'Extraer', 'Plan del turno', 'Enviar a WhatsApp', 'Entrega del receptor']) {
        expect(t.ejecutados.has(n), n).toBe(false);
      }
      expect(t.llamadas.extraer).toHaveLength(0);
      expect(w.mundo.llamadas.ingesta).toHaveLength(0);
    });
  }

  it('lo que cae en el webhook del carrito NUNCA se lee como un mensaje de WhatsApp: ni `messages` en la raíz ni dentro de `body`', () => {
    const mensaje = { from: '59100000011', id: 'wamid.X', timestamp: '1', type: 'text', text: { body: 'hola' } };
    const valor = { messaging_product: 'whatsapp', metadata: { phone_number_id: PHONE_ID }, contacts: [], messages: [mensaje] };
    for (const item of [
      { headers: cabeceras({ 'x-novuchat-signature': '' }), body: valor },
      { headers: cabeceras({ 'x-novuchat-signature': '' }), body: { entry: [{ changes: [{ value: valor }] }] } },
      { headers: cabeceras({ 'x-novuchat-signature': '' }), ...valor },
    ]) {
      const w = crear();
      const t = carrito(w, item as J);
      expect(t.mensajes).toHaveLength(0);
      expect(t.ejecutados.has('Plan del turno')).toBe(false);
      expect(w.mundo.llamadas.ingesta).toHaveLength(0);
    }
  });
});

describe('un carrito con la ventana cerrada no recibe nada aunque el comercio esté suspendido o la atención sea de un operador (revisión del PR #382)', () => {
  const ATENCION = { mensajeFijo: 'Gracias por tu paciencia. Una persona del equipo sigue contigo.', avisarRecepcion: 'operador', respuestasEnVentana: 80 };
  const estados: [string, J][] = [
    ['comercio suspendido', { estadoComercio: 'suspendido' }],
    ['atención de un operador (uso extendido)', { atencion: { estado: 'operador', ...ATENCION } }],
    ['atención bloqueada', { atencion: { estado: 'bloqueado', ...ATENCION } }],
  ];
  const conPanel = (extra: J) => {
    const w = crear();
    w.mundo.dobles['Traer configuración'] = () => ({ statusCode: 200, body: { ...panel(), ...extra } });
    return w;
  };
  for (const [etiqueta, extra] of estados) {
    it(`${etiqueta}: con la ventana cerrada (o sin el dato) no sale ningún mensaje ni aviso; Meta no recibe nada que rechazar`, () => {
      for (const ventana of [{ ventanaAbierta: false }, { ventanaAbierta: undefined }, { ventanaAbierta: 'true' }]) {
        const w = conPanel(extra);
        const t = carrito(w, { headers: cabeceras(), body: cuerpo(ventana) });
        expect(t.fallo, JSON.stringify(ventana)).toBeNull();
        expect(t.mensajes, JSON.stringify(ventana)).toHaveLength(0);
        expect(t.avisos, JSON.stringify(ventana)).toHaveLength(0);
        expect(t.ejecutados.has('Enviar a WhatsApp'), JSON.stringify(ventana)).toBe(false);
        expect(t.ejecutados.has('Uso extendido'), JSON.stringify(ventana)).toBe(false);
        expect(t.ejecutados.has('Comercio no operativo'), JSON.stringify(ventana)).toBe(false);
      }
    });
  }
  it('NEGANDO: con la ventana ABIERTA el comportamiento de siempre sigue (aviso fijo del operador, texto neutro del comercio suspendido) y un mensaje normal también', () => {
    const operador = carrito(conPanel({ atencion: { estado: 'operador', ...ATENCION } }), { headers: cabeceras(), body: cuerpo() });
    expect(operador.mensajes.length).toBeGreaterThan(0);
    const suspendido = carrito(conPanel({ estadoComercio: 'suspendido' }), { headers: cabeceras(), body: cuerpo() });
    expect(suspendido.mensajes.length).toBeGreaterThan(0);
    expect(turno(conPanel({ estadoComercio: 'suspendido' }), texto('hola')).mensajes.length).toBeGreaterThan(0);
  });
});

describe('un mensaje normal de WhatsApp sigue igual', () => {
  it('entra por el receptor, SÍ se reporta como entrante, y el carrito no corre', () => {
    const w = crear();
    const t = turno(w, texto('hola'));
    expect(t.ejecutados.has('Entrega del receptor')).toBe(true);
    expect(t.ejecutados.has(CARRITO)).toBe(false);
    expect(t.ejecutados.has('Reportar mensaje (entrante)')).toBe(true);
    expect(w.mundo.llamadas.ingesta.filter((x) => x['direccion'] === 'entrante')).toHaveLength(1);
    expect(t.mensajes.length).toBeGreaterThan(0);
  });

  it('el reporte de «entrante» depende de `reportarEntrante` y de nada más que del modo prueba: la cláusula está en `¿Reportar? (entrante)`', () => {
    const expresion = String(nodoDe(QTACO, '¿Reportar? (entrante)').parameters['conditions']?.['conditions']?.[0]?.['leftValue']);
    expect(expresion).toContain("$('Interpretar entrada').first().json.reportarEntrante !== false");
    expect(expresion).toContain("$('Config del negocio').first().json.modoPrueba !== true");
  });
});

// =====================================================================================================
// EL ENLACE DE LA CARTA, DE PUNTA A PUNTA: `Traer configuración` lo pide, `Config del negocio` lo copia, el plan lo usa
// =====================================================================================================
describe('el enlace de la carta recorre el flujo entero: se pide, se copia, sale como botón; sin enlace sale la carta en texto', () => {
  const URL_CATALOGO = 'https://catalogo.ejemplo.invalid/c/qtaco-abc123';
  const conPanel = (w: ReturnType<typeof crear>, extra: J) => {
    w.mundo.dobles['Traer configuración'] = () => ({ statusCode: 200, body: { ...panel(), ...extra } });
  };
  const urlDe = (t: ReturnType<typeof carrito>): string[] => t.mensajes.map((m) => String(m.payload['interactive']?.action?.parameters?.url ?? ''));

  it('`Traer configuración` pide `catalogoCompleto: true` en cada turno (sin un nodo nuevo para el enlace)', () => {
    const w = crear();
    const t = turno(w, texto('hola'));
    const cfg = t.registro.find((r) => r.nodo === 'Traer configuración');
    expect(cfg?.cuerpo).toMatchObject({ catalogoCompleto: true });
  });

  it('con `catalogoWeb.enlace` válido: la carta sale como UN mensaje con «Ver la carta» y esa URL (nunca el chat del local), y `Config del negocio` lo copió a `catalogoWebEnlace`', () => {
    const w = crear();
    conPanel(w, { catalogoWeb: { enlace: URL_CATALOGO } });
    turno(w, texto('hola'));
    const t = turno(w, boton('m|pedido', 'Hacer un pedido'));
    expect(t.salidas['Config del negocio']?.flat()[0]?.['catalogoWebEnlace']).toBe(URL_CATALOGO);
    expect(t.mensajes).toHaveLength(1);
    expect(urlDe(t)).toEqual([URL_CATALOGO]);
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/Nachos Supremos/); // no hay carta en texto además del enlace
    expect(JSON.stringify(t.mensajes[0]!.payload)).not.toContain('wa.me');
  });

  it('sin enlace (el servidor no lo manda, vacío o apagado): la carta sale en TEXTO, con sus productos, sin botón de carta ni promesa de página', () => {
    for (const extra of [{}, { catalogoWeb: { enlace: '' } }, { catalogoWeb: { enlace: null } }, { catalogoWeb: { activo: false } }]) {
      const w = crear();
      conPanel(w, extra);
      turno(w, texto('hola'));
      const t = turno(w, boton('m|pedido', 'Hacer un pedido'));
      expect(t.mensajes.length, JSON.stringify(extra)).toBeGreaterThan(0);
      expect(t.mensajes.map((m) => m.cuerpo).join('\n'), JSON.stringify(extra)).toContain('Nachos Supremos');
      expect(urlDe(t).filter(Boolean), JSON.stringify(extra)).toEqual([]);
      expect(t.mensajes.some((m) => botonesDe(m).some((b) => b.title === 'Ver la carta')), JSON.stringify(extra)).toBe(false);
      // El ejemplo del cierre sale de los dos primeros productos de ESTA carta, con las librerías reales (nunca un plato de un cliente).
      expect(t.mensajes.map((m) => m.cuerpo).join('\n'), JSON.stringify(extra)).toMatch(/\(por ejemplo: «1 Nachos Supremos y 1 Tacos de Birria»\)/);
    }
  });

  it('un enlace inseguro (http, javascript, localhost) NO se ofrece: carta en texto', () => {
    for (const enlace of ['http://catalogo.ejemplo.invalid/c/x', 'javascript:alert(1)', 'https://localhost/c/x']) {
      const w = crear();
      conPanel(w, { catalogoWeb: { enlace } });
      turno(w, texto('hola'));
      const t = turno(w, boton('m|pedido', 'Hacer un pedido'));
      expect(urlDe(t).filter(Boolean), enlace).toEqual([]);
      expect(t.mensajes.map((m) => m.cuerpo).join('\n'), enlace).toContain('Nachos Supremos');
    }
  });
});

// =====================================================================================================
// UN SOLO REGISTRO POR PEDIDO WEB (decisión de Andres, 03/10): el `cat_…` del checkout es el `pedidoId` del turno
// =====================================================================================================
describe('el pedido que llega de la página conserva su `cat_…` como pedidoId (código, cobro, cierre y aviso hablan del mismo pedido)', () => {
  const CAT = 'cat_k1a2b3c4_9f8e7d6c';
  const CAT2 = 'cat_k1a2b3c5_0a1b2c3d';
  const web = (extra: J = {}) => ({ headers: cabeceras(), body: cuerpo({ pedidoId: CAT, ...extra }) });
  const pedidoDe = (w: ReturnType<typeof crear>): J => (estadoDe(w)['pedido'] ?? {}) as J;
  const guardados = (w: ReturnType<typeof crear>): J[] => Object.values((((w.mundo.sd['ventaMinima'] as J | undefined)?.['pedidos']) ?? {}) as J);
  const qrAbiertos = (t: { llamadas: { ingesta: J[] } }): J[] => t.llamadas.ingesta.filter((x) => x['evento'] === 'qr_enviado');
  const confirmar = (w: ReturnType<typeof crear>, t: ReturnType<typeof carrito>) => turno(w, boton(idDeBoton(t, 'Confirmar pedido'), 'Confirmar pedido'));
  /** Plan B: sin cobro real, el pedido se registra y se avisa (cierre `registro` con la referencia del pedido). */
  const planB = () => {
    const w = crear();
    w.mundo.dobles['Traer configuración'] = () => ({ statusCode: 200, body: { ...panel(), cobroReal: undefined, cobro: { activo: false } } });
    return w;
  };

  it('con QR: el cobro se abre con el `cat_…` como referencia, el pedido guardado lleva ese id, y el código sale de él (el mismo en otra corrida)', () => {
    const w = crear();
    const c = confirmar(w, carrito(w, web()));
    expect(qrAbiertos(c)).toHaveLength(1);
    expect(qrAbiertos(c)[0]!['referencia']).toBe(CAT);
    expect(pedidoDe(w)['pedidoId']).toBe(CAT);
    expect(guardados(w).map((p) => p['pedidoId'])).toEqual([CAT]);
    const codigo = String(pedidoDe(w)['codigo']);
    expect(codigo).toMatch(/^[0-9A-Z]{4}$/);
    expect(c.mensajes[0]!.cuerpo).toContain(`#${codigo}`);
    // Otra corrida del mismo pedido: mismo código. Otro pedido web: otro id y otro código.
    const w2 = crear();
    confirmar(w2, carrito(w2, web()));
    expect(String(pedidoDe(w2)['codigo'])).toBe(codigo);
    const w3 = crear();
    confirmar(w3, carrito(w3, web({ pedidoId: CAT2 })));
    expect(pedidoDe(w3)['pedidoId']).toBe(CAT2);
    expect(String(pedidoDe(w3)['codigo'])).not.toBe(codigo);
  });

  it('plan B: el cierre `registro` y el aviso llevan el MISMO `cat_…` y el mismo código que el cliente lee; uno solo por pedido', () => {
    const w = planB();
    const c = confirmar(w, carrito(w, web()));
    expect(c.llamadas.cierre).toHaveLength(1);
    expect(c.llamadas.cierre[0]!['referencia']).toBe(CAT);
    expect(c.llamadas.cierre[0]!['tipo']).toBe('registro');
    expect(guardados(w).map((p) => p['pedidoId'])).toEqual([CAT]);
    const codigo = String(guardados(w)[0]!['codigo']);
    expect(c.mensajes[0]!.cuerpo).toContain(codigo);
    expect(JSON.stringify(c.avisos.map((a) => a.payload))).toContain(codigo);
    expect(JSON.stringify([c.llamadas.cierre, c.avisos.map((a) => a.payload)])).not.toContain('ped-');
  });

  it('R3 con QR: si no llega el QR, reconfirmar da el MISMO pedido (mismo `cat_…` y código), UN cobro y UN pedido guardado', () => {
    const w = crear();
    const t = carrito(w, web());
    const id = idDeBoton(t, 'Confirmar pedido');
    w.envios['Enviar a WhatsApp'] = 'cuerpo vacío';
    w.envios['Enviar respaldo'] = 'cuerpo vacío';
    expect(() => turno(w, boton(id, 'Confirmar pedido'))).toThrow(/Entrega fallida/);
    const codigoFallido = String(guardados(w)[0]!['codigo']);
    expect(guardados(w).map((p) => p['pedidoId'])).toEqual([CAT]);
    w.envios['Enviar a WhatsApp'] = 'acepta';
    w.envios['Enviar respaldo'] = 'acepta';
    const ok = turno(w, boton(id, 'Confirmar pedido'));
    expect(qrAbiertos(ok)).toHaveLength(1);
    expect(qrAbiertos(ok)[0]!['referencia']).toBe(CAT);
    expect(guardados(w).map((p) => p['pedidoId'])).toEqual([CAT]);
    expect(String(pedidoDe(w)['codigo'])).toBe(codigoFallido);
  });

  it('R3 en plan B (el aviso y el cierre ya salieron): el cierre del turno fallido ya llevaba el `cat_…` y el botón viejo no arma otro pedido ni repite el cierre', () => {
    const w = planB();
    const t = carrito(w, web());
    const id = idDeBoton(t, 'Confirmar pedido');
    w.envios['Enviar a WhatsApp'] = 'cuerpo vacío';
    w.envios['Enviar respaldo'] = 'cuerpo vacío';
    const fallido = w.mundo.turno(entrega(CLIENTE, boton(id, 'Confirmar pedido')), { tolerarFallo: true });
    expect(fallido.fallo?.mensaje).toMatch(/Entrega fallida/);
    expect(fallido.llamadas.cierre.map((x) => x['referencia'])).toEqual([CAT]);
    w.envios['Enviar a WhatsApp'] = 'acepta';
    w.envios['Enviar respaldo'] = 'acepta';
    const otra = turno(w, boton(id, 'Confirmar pedido'));
    expect(otra.llamadas.cierre).toHaveLength(0);
    expect(otra.avisos).toHaveLength(0);
    expect(guardados(w).map((p) => p['pedidoId'])).toEqual([CAT]);
  });

  it('NEGANDO: un pedido por CHAT sigue con su `ped-…` propio (referencia del cobro y pedido guardado)', () => {
    const w = crear();
    turno(w, texto('hola'));
    w.estado.extraccion = { lineas: [{ producto: 'tacos de birria', cantidad: 4, forma: 'unidad', detalle: '' }], entrega: 'recojo', direccion: '', referencia: '', nombre: '', quiereHablar: false };
    const resumen = turno(w, texto('quiero 4 tacos de birria'));
    const c = confirmar(w, resumen);
    expect(String(qrAbiertos(c)[0]!['referencia'])).toMatch(/^ped-/);
    expect(String(pedidoDe(w)['pedidoId'])).toMatch(/^ped-/);
  });

  it('una línea QUITADA o ACOTADA con el total igual (el servidor no contó el producto que el flujo no tiene) también conserva el `ped-…` propio (mutación M03)', () => {
    // Sin la guarda de líneas quitadas, solo el total distinto lo evitaba: aquí el total coincide a propósito.
    const quitada = crear();
    const t1 = carrito(quitada, web({ items: [{ id: 'birria3', nombre: 'x', cantidad: 2, subtotal: 110 }, { id: 'no-existe', nombre: 'Cosa', cantidad: 1, subtotal: 0 }], total: 110 }));
    expect(t1.mensajes).toHaveLength(1);
    expect((estadoDe(quitada)['carrito'] as J[]).length).toBe(1); // el flujo quitó una línea…
    expect(estadoDe(quitada)['pedidoWeb'] ?? null).toBeNull(); // …y ya no es EL pedido de la página
    confirmar(quitada, t1);
    expect(String(pedidoDe(quitada)['pedidoId'])).toMatch(/^ped-/);
    // Acotada: 60 horchatas, el flujo toma 50 (el máximo) y el servidor dice el total de 50: coincide, pero el flujo cambió la cantidad.
    const acotada = crear();
    const t2 = carrito(acotada, web({ items: [{ id: 'horchata', nombre: 'Horchata', cantidad: 60, subtotal: 1000 }], total: 1000 }));
    expect(t2.mensajes.length).toBeGreaterThan(0);
    expect(estadoDe(acotada)['pedidoWeb'] ?? null).toBeNull();
    // NEGANDO: sin líneas quitadas ni acotadas, con el mismo total, sí conserva el `cat_…`.
    const intacto = crear();
    carrito(intacto, web({ items: [{ id: 'birria3', nombre: 'x', cantidad: 2, subtotal: 110 }], total: 110 }));
    expect(estadoDe(intacto)['pedidoWeb']).toMatchObject({ id: CAT });
  });

  it('un carrito SIN conversación previa que se confirma lleva el nombre de perfil del turno de la confirmación al pedido y al aviso (mutación M28)', () => {
    const w = planB();
    const t = carrito(w, web());
    expect((estadoDe(w)['entrega'] as J)['nombre']).toBe(''); // el carrito no trae el nombre
    const c = confirmar(w, t); // el mensaje de confirmación sí viene de un teléfono con perfil «Carlos Pérez»
    expect(guardados(w)[0]!['nombre']).toBe('Carlos Pérez');
    expect(JSON.stringify(c.avisos.map((x) => x.payload))).toContain('Carlos Pérez');
  });

  describe('la MODALIDAD de entrega es parte de «el pedido de la página» (revisión del PR #382, LOW de seguridad)', () => {
    const EX = (extra: J = {}): J => ({ lineas: [], entrega: '', direccion: '', referencia: '', nombre: '', quiereHablar: false, ...extra });
    const idConfirmado = (w: ReturnType<typeof crear>, t: ReturnType<typeof carrito>): string => {
      const c = confirmar(w, t);
      expect(qrAbiertos(c)).toHaveLength(1);
      return String(pedidoDe(w)['pedidoId']);
    };
    it('retiro en la página y delivery por chat: conserva el `ped-…` (la consola decía retiro, el aviso diría delivery)', () => {
      const w = crear();
      carrito(w, web());
      expect((estadoDe(w)['pedidoWeb'] as J)['id']).toBe(CAT);
      w.estado.extraccion = EX({ entrega: 'delivery', direccion: 'Av. Banzer 1234', referencia: 'puerta azul', nombre: 'Carlos Pérez' });
      const t = turno(w, texto('mejor para delivery, Av. Banzer 1234, puerta azul'));
      expect(String((estadoDe(w)['entrega'] as J)['entrega'])).toBe('delivery');
      expect(idConfirmado(w, t)).toMatch(/^ped-/);
    });
    it('delivery en la página y retiro por chat: también conserva el `ped-…`', () => {
      const w = crear();
      const entrada = carrito(w, web({ entrega: 'envio', direccion: 'Av. Banzer 1234', costoEnvio: 0 }));
      expect(entrada.mensajes.length).toBeGreaterThan(0);
      w.estado.extraccion = EX({ entrega: 'delivery', referencia: 'puerta azul', nombre: 'Carlos Pérez' });
      turno(w, texto('puerta azul, a nombre de Carlos Pérez'));
      expect(estadoDe(w)['pedidoWeb']).toMatchObject({ id: CAT });
      w.estado.extraccion = EX({ entrega: 'recojo' });
      const t = turno(w, texto('mejor paso a recoger'));
      expect(String((estadoDe(w)['entrega'] as J)['entrega'])).toBe('recojo');
      expect(idConfirmado(w, t)).toMatch(/^ped-/);
    });
    it('NEGANDO: si la modalidad no cambia (retiro, o delivery con sus datos completados por chat), el `cat_…` se conserva', () => {
      const w = crear();
      expect(idConfirmado(w, carrito(w, web()))).toBe(CAT);
      const v = crear();
      carrito(v, web({ entrega: 'envio', direccion: 'Av. Banzer 1234', costoEnvio: 0 }));
      v.estado.extraccion = EX({ entrega: 'delivery', referencia: 'puerta azul', nombre: 'Carlos Pérez' });
      const t = turno(v, texto('puerta azul, a nombre de Carlos Pérez'));
      expect(idConfirmado(v, t)).toBe(CAT);
    });
  });

  describe('NEGANDO: si el pedido del flujo ya no es EL de la página, conserva su id propio `ped-…`', () => {
    const idFinal = (t0: ReturnType<typeof carrito>, w: ReturnType<typeof crear>): string => {
      const c = confirmar(w, t0);
      expect(qrAbiertos(c)).toHaveLength(1);
      return String(pedidoDe(w)['pedidoId']);
    };
    it('un id que no tiene la forma del checkout (otro prefijo, caracteres raros, mayúsculas)', () => {
      let probados = 0;
      for (const pedidoId of ['p-100', 'ped-2026-10-05-0011-abc', 'cat_', 'cat_ñ', 'CAT_abc']) {
        const w = crear();
        const t = carrito(w, web({ pedidoId }));
        if (t.mensajes.length === 0) continue; // la entrada ya lo rechazó (no es un carrito válido): nada que confirmar
        expect(idFinal(t, w), pedidoId).toMatch(/^ped-/);
        probados++;
      }
      expect(probados).toBeGreaterThan(0);
    });
    it('con costo de envío (el servidor coteja contra el total CON envío y el QR es solo la comida)', () => {
      const w = crear();
      const t = carrito(w, web({ entrega: 'envio', direccion: 'Av. Banzer 1234', costoEnvio: 10, total: 120 }));
      expect(t.mensajes.length).toBeGreaterThan(0);
      expect(estadoDe(w)['pedidoWeb'] ?? null).toBeNull();
    });
    it('con un total del servidor distinto del que calcula el flujo', () => {
      const w = crear();
      const t = carrito(w, web({ total: 90 }));
      expect(idFinal(t, w)).toMatch(/^ped-/);
    });
    it('con un producto que el flujo no pudo incluir', () => {
      const w = crear();
      const t = carrito(w, web({ items: [{ id: 'birria3', nombre: 'x', cantidad: 2, subtotal: 110 }, { id: 'no-existe', nombre: 'Cosa', cantidad: 1, subtotal: 5 }], total: 115 }));
      expect(idFinal(t, w)).toMatch(/^ped-/);
    });
    it('si el cliente agrega un producto por chat al pedido de la página', () => {
      const w = crear();
      carrito(w, web());
      expect(estadoDe(w)['pedidoWeb']).toMatchObject({ id: CAT });
      w.estado.extraccion = { lineas: [{ producto: 'horchata', cantidad: 1, forma: '', detalle: '' }], entrega: 'recojo', direccion: '', referencia: '', nombre: '', quiereHablar: false };
      const resumen = turno(w, texto('agrega una horchata'));
      expect(idFinal(resumen, w)).toMatch(/^ped-/);
    });
    it('«Cambiar algo» (reinicia el carrito) y cancelar el pedido borran la marca: un pedido nuevo no hereda el `cat_…`', () => {
      const w = crear();
      const t = carrito(w, web());
      turno(w, boton(idDeBoton(t, 'Cambiar algo'), 'Cambiar algo'));
      expect(estadoDe(w)['pedidoWeb'] ?? null).toBeNull();
      const v = crear();
      carrito(v, web());
      turno(v, texto('cancelar pedido'));
      expect(estadoDe(v)['pedidoWeb'] ?? null).toBeNull();
    });
  });
});

// =====================================================================================================
// COBRO SIMULADO Y REAL SE CRUZAN (revisión del cobro simulado, H2): el comprobante de un pedido de PRUEBA nunca se coteja como real
// =====================================================================================================
describe('un pedido SIMULADO con el cobro real encendido y una solicitud pendiente: cero cotejos y nada rotulado como pago real', () => {
  const imagen = (): J => ({ type: 'image', image: { id: 'media-9', mime_type: 'image/jpeg' } });
  it('la foto llega, no se baja, no se lee, no se coteja en el servidor y se pasa con una persona; el pedido de prueba se suelta', () => {
    const w = crear();
    // Modo simulado: sin cobroReal y con `cobroSimulado` declarado por el servidor.
    w.mundo.dobles['Traer configuración'] = () => ({ statusCode: 200, body: { ...panel(), cobroReal: undefined, cobro: { activo: false }, cobroSimulado: {} } });
    turno(w, texto('hola'));
    w.estado.extraccion = { lineas: [{ producto: 'tacos de birria', cantidad: 4, forma: 'unidad', detalle: '' }], entrega: 'recojo', direccion: '', referencia: '', nombre: '', quiereHablar: false };
    const resumen = turno(w, texto('quiero 4 tacos de birria'));
    const qr = turno(w, boton(idDeBoton(resumen, 'Confirmar pedido'), 'Confirmar pedido'));
    expect(qr.mensajes.some((m) => m.tipo === 'image')).toBe(true);
    const abierto = qr.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado');
    const ref = String(abierto?.['referencia']);
    expect((estadoDe(w)['pedido'] as J)['simulado']).toBe(true);
    // El cobro real se enciende (el servidor manda cobroReal y la solicitud pendiente de ESE pedido).
    w.mundo.dobles['Traer configuración'] = () => ({ statusCode: 200, body: { ...panel(), cobroReal: { nombreCuenta: 'Q TACO SRL', banco: 'Banco Ejemplo' }, cobro: { activo: true, qr: { url: 'https://qr.ejemplo.invalid/qtaco.png' }, pendiente: true, monto: Number(abierto?.['monto']), pedido: ref } } });
    const t = w.mundo.turno(entrega(CLIENTE, imagen()), { tolerarFallo: true });
    expect(t.fallo).toBeNull();
    expect(t.llamadas.cotejo).toHaveLength(0);
    for (const n of ['Cotejar en el servidor', 'Leer comprobante (imagen)', 'Leer comprobante (PDF)', 'Obtener URL del medio', 'Descargar medio']) expect(t.ejecutados.has(n), n).toBe(false);
    expect(String(((t.resumen as J)['resumen'] as J)['ruta'])).toContain('transferir:el modo de cobro cambió: comprobante de un pedido simulado');
    expect(t.mensajes.length).toBeGreaterThan(0); // se pasa con una persona: aviso + botón
    expect(t.llamadas.cierre).toHaveLength(0);
    expect(JSON.stringify([t.mensajes.map((m) => m.cuerpo), t.avisos.map((a) => a.cuerpo)])).not.toMatch(/datos coinciden|cuadra|Recibí tu comprobante/i);
    expect(estadoDe(w)['paso']).toBe('menu'); // el pedido de PRUEBA se suelta: ni «sigue esperando» ni otra foto (que volvería a derivar)
    expect((estadoDe(w)['pedido'] ?? null)).toBeNull();
    expect(w.mundo.llamadas.cotejo).toHaveLength(0);
  });
});

describe('el recordatorio SIMULADO sale de punta a punta con el enlace del QR (H3), en un solo mensaje y sin pasar por la red de palabras', () => {
  it('«¿ya llegó?» con un QR simulado pendiente: UN mensaje que trae «Si no ves el QR, ábrelo aquí» y el enlace, y Meta lo recibe', () => {
    const w = crear();
    w.mundo.dobles['Traer configuración'] = () => ({ statusCode: 200, body: { ...panel(), cobroReal: undefined, cobro: { activo: false }, cobroSimulado: {} } });
    turno(w, texto('hola'));
    w.estado.extraccion = { lineas: [{ producto: 'tacos de birria', cantidad: 4, forma: 'unidad', detalle: '' }], entrega: 'recojo', direccion: '', referencia: '', nombre: '', quiereHablar: false };
    const resumen = turno(w, texto('quiero 4 tacos de birria'));
    turno(w, boton(idDeBoton(resumen, 'Confirmar pedido'), 'Confirmar pedido'));
    const t = turno(w, texto('¿ya llegó?'));
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]!.ok).toBe(true);
    expect(t.mensajes[0]!.cuerpo).toContain('SIMULADO');
    expect(t.mensajes[0]!.cuerpo).toMatch(/Si no ves el QR, ábrelo aquí: https:\/\/\S+/);
  });
});


// =====================================================================================================
// DELIVERY OPCIONAL (decisión de Andres y Silvana, 05/10): la secuencia real de las 04:25–04:27 UTC, con el tercer teléfono
// =====================================================================================================
describe('delivery opcional: la secuencia real del 05/10 (dirección ya puesta en el catálogo; «Ok», «Déjale al portero», «A media cuadra del gas»)', () => {
  const NADA = { lineas: [], entrega: '', direccion: '', referencia: '', nombre: '', quiereHablar: false };
  const conDireccion = (extra: J = {}): J => cuerpo({ entrega: 'envio', direccion: 'Av. Banzer 1234', pedidoId: 'cat_seq_0001', ...extra });

  it('el carrito con dirección y SIN referencia (página vieja) va directo al resumen: UN mensaje, 0 de `pedido_datos`, 0 llamadas al modelo', () => {
    const w = crear();
    const t = carrito(w, { headers: cabeceras(), body: conDireccion() });
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]!.cuerpo).toContain('Entrega: delivery a Av. Banzer 1234');
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/necesito|referencia|no va en el QR/i);
    expect(titulos(t)).toEqual(['Confirmar pedido', 'Cambiar algo', 'Menú']);
    expect(estadoDe(w)['paso']).toBe('pedido_confirmar');
    expect(t.llamadas.extraer).toHaveLength(0);
  });

  it('«Ok» sigue al resumen; «Déjale al portero» queda como la referencia (aunque el modelo no asigne nada); un segundo texto no pisa la referencia; y se confirma sin más vueltas', () => {
    const w = crear();
    const t0 = carrito(w, { headers: cabeceras(), body: conDireccion() });
    w.estado.extraccion = NADA;
    const ok = turno(w, texto('Ok'));
    expect(ok.mensajes).toHaveLength(1);
    expect(botonesDe(ok.mensajes[0]!).map((b) => b.title)).toContain('Confirmar pedido');
    expect(ok.llamadas.extraer).toHaveLength(0); // «Ok» no llama al modelo ni se toma como dato
    expect((estadoDe(w)['entrega'] as J)['referencia']).toBe('');
    const portero = turno(w, texto('Déjale al portero'));
    expect((estadoDe(w)['entrega'] as J)['referencia']).toBe('Déjale al portero');
    expect(portero.mensajes[0]!.cuerpo).toContain('Entrega: delivery a Av. Banzer 1234 (Déjale al portero)');
    expect(portero.avisos).toHaveLength(0);
    expect(estadoDe(w)['paso']).toBe('pedido_confirmar');
    const gas = turno(w, texto('A media cuadra del gas'));
    expect((estadoDe(w)['entrega'] as J)['referencia'], 'ya hay referencia: un segundo texto no la pisa').toBe('Déjale al portero');
    expect(gas.avisos).toHaveLength(0);
    expect(gas.mensajes[0]!.cuerpo).toContain('Entrega: delivery a Av. Banzer 1234');
    // El pedido sigue y se confirma: el QR sale y la referencia viaja al pedido.
    const confirmar = turno(w, boton(idDeBoton(t0, 'Confirmar pedido'), 'Confirmar pedido'));
    expect(confirmar.mensajes.some((m) => m.tipo === 'image')).toBe(true);
    expect(JSON.stringify(estadoDe(w)['pedido'])).toContain('Déjale al portero');
  });

  it('con una referencia que manda la página nueva, el resumen la muestra desde el primer mensaje', () => {
    const w = crear();
    const t = carrito(w, { headers: cabeceras(), body: conDireccion({ referencia: 'portón verde', pedidoId: 'cat_seq_0002' }) });
    expect(t.mensajes[0]!.cuerpo).toContain('Entrega: delivery a Av. Banzer 1234 (portón verde)');
    expect(t.mensajes).toHaveLength(1);
  });

  it('si FALTA la dirección, cualquier texto con letras o dígitos es la dirección (sin depender del modelo) y sigue al resumen; algo sin letras ni dígitos se vuelve a pedir', () => {
    const w = crear();
    carrito(w, { headers: cabeceras(), body: cuerpo({ entrega: 'envio', direccion: '', pedidoId: 'cat_seq_0003' }) });
    expect(estadoDe(w)['paso']).toBe('pedido_datos');
    w.estado.extraccion = NADA;
    const raro = turno(w, texto('...'));
    expect(raro.mensajes[0]!.cuerpo).toBe('Para el delivery necesito la dirección exacta.');
    expect((estadoDe(w)['entrega'] as J)['direccion']).toBe('');
    const t = turno(w, texto('calle 1 numerro 2 Irpavi'));
    expect((estadoDe(w)['entrega'] as J)['direccion']).toBe('calle 1 numerro 2 Irpavi');
    expect(t.mensajes[0]!.cuerpo).toContain('Entrega: delivery a calle 1 numerro 2 Irpavi');
    expect(estadoDe(w)['paso']).toBe('pedido_confirmar');
  });

  it('dirección en un mensaje y referencia en otro: sin bucle («a media cuadra de la calle foton» queda como referencia); una pregunta, un enlace o «no gracias» NO se toman', () => {
    const nuevo = (id: string) => {
      const x = crear();
      carrito(x, { headers: cabeceras(), body: cuerpo({ entrega: 'envio', direccion: '', pedidoId: id }) });
      x.estado.extraccion = NADA;
      turno(x, texto('calle 1 numerro 2 Irpavi'));
      return x;
    };
    for (const [i, dicho] of ['¿cuánto demora?', 'mira https://malo.test/x', 'no gracias'].entries()) {
      const x = nuevo(`cat_seq_010${i}`);
      turno(x, texto(dicho));
      expect((estadoDe(x)['entrega'] as J)['referencia'], dicho).toBe('');
      expect((estadoDe(x)['entrega'] as J)['direccion'], dicho).toBe('calle 1 numerro 2 Irpavi');
    }
    const w = nuevo('cat_seq_0004');
    const t = turno(w, texto('a media cuadra de la calle foton'));
    expect((estadoDe(w)['entrega'] as J)['referencia']).toBe('a media cuadra de la calle foton');
    expect(t.mensajes[0]!.cuerpo).toContain('(a media cuadra de la calle foton)');
    expect(t.avisos).toHaveLength(0);
  });

  it('una petición explícita de persona no se toma como dato de entrega (deriva como siempre)', () => {
    const w = crear();
    carrito(w, { headers: cabeceras(), body: conDireccion({ pedidoId: 'cat_seq_0005' }) });
    w.estado.extraccion = { ...NADA, quiereHablar: true };
    const t = turno(w, texto('necesito ayuda de un encargado'));
    expect((estadoDe(w)['entrega'] as J)['referencia']).toBe('');
    expect(t.mensajes[0]!.cuerpo).toMatch(/Esto prefiero que lo vea una persona/);
  });
});

// =====================================================================================================
// Revisión de seguridad del PR #435 (M1, M2, L1, L2) y la batería real de la Operadora: el texto libre solo se toma como dato de entrega si PUEDE serlo
// =====================================================================================================
describe('#435 M1/M2: una intención no se vuelve dirección ni referencia', () => {
  const NADA = { lineas: [], entrega: '', direccion: '', referencia: '', nombre: '', quiereHablar: false };
  /** Mundo con la dirección ya dada (falta, a lo sumo, la referencia opcional). */
  function conDireccion(id: string) {
    const w = crear();
    carrito(w, { headers: cabeceras(), body: cuerpo({ entrega: 'envio', direccion: 'Av. Banzer 1234', pedidoId: id }) });
    return w;
  }
  /** Mundo con la dirección PENDIENTE (`pedido_datos`). */
  function sinDireccion(id: string) {
    const w = crear();
    carrito(w, { headers: cabeceras(), body: cuerpo({ entrega: 'envio', direccion: '', pedidoId: id }) });
    expect(estadoDe(w)['paso']).toBe('pedido_datos');
    return w;
  }
  const ent = (w: ReturnType<typeof crear>): J => estadoDe(w)['entrega'] as J;

  it.each([
    'necesito ayuda', 'quiero que me atienda alguien', 'tengo un problema con mi pedido', 'comuníquenme con el local', 'esto es un robo',
  ])('M1 «%s» con `quiereHablar` del modelo DERIVA (no se vuelve referencia ni dirección), con la dirección dada y con la dirección pendiente', (dicho) => {
    const a = conDireccion('cat_m1_a_' + dicho.length);
    a.estado.extraccion = { ...NADA, quiereHablar: true };
    const t = turno(a, texto(dicho));
    expect(ent(a)['referencia'], dicho).toBe('');
    expect(t.mensajes[0]!.cuerpo, dicho).toMatch(/Esto prefiero que lo vea una persona/);
    const b = sinDireccion('cat_m1_b_' + dicho.length);
    b.estado.extraccion = { ...NADA, quiereHablar: true };
    const u = turno(b, texto(dicho));
    expect(ent(b)['direccion'], dicho).toBe('');
    expect(u.mensajes[0]!.cuerpo, dicho).toMatch(/Esto prefiero que lo vea una persona/);
  });

  it('M1, el caso opuesto: «Déjale al portero» con `quiereHablar` del modelo SÍ queda como referencia (tiene rasgos de un dato de entrega)', () => {
    const w = conDireccion('cat_m1_c');
    w.estado.extraccion = { ...NADA, quiereHablar: true };
    const t = turno(w, texto('Déjale al portero'));
    expect(ent(w)['referencia']).toBe('Déjale al portero');
    expect(t.mensajes[0]!.cuerpo).toContain('(Déjale al portero)');
  });

  const NEGATIVAS = [
    'cancela el pedido', 'cancela todo', 'anula mi pedido', 'mejor no', 'a que hora llega', 'puedo pagar con tarjeta', 'Pague 110 Bs comprobante 123456789',
    'dame la carta', 'quiero 2 tacos', 'quiero 60 tacos', 'mejor paso a recogerlo yo mismo', 'ya pagué por transferencia', 'cuánto demora', 'olvídalo',
    'quiero el menú', 'tengo una queja', 'delivery no', 'sin delivery', 'prefiero delivery', 'quiero que me manden', 'ver x.com/a', 'aa bb',
  ];
  it.each(NEGATIVAS)('M2 «%s»: con la dirección PENDIENTE no se guarda como dirección y el pedido no pasa al resumen', (dicho) => {
    const w = sinDireccion('cat_m2_a_' + dicho.length + dicho.charCodeAt(0));
    w.estado.extraccion = NADA;
    turno(w, texto(dicho));
    expect(ent(w)['direccion'], dicho).toBe('');
    expect(estadoDe(w)['paso'], dicho).not.toBe('pedido_confirmar');
    expect(JSON.stringify(estadoDe(w)['pedido']), dicho).not.toContain(dicho);
  });
  it.each(NEGATIVAS)('M2 «%s»: con la dirección ya dada no se guarda como referencia', (dicho) => {
    const w = conDireccion('cat_m2_b_' + dicho.length + dicho.charCodeAt(0));
    w.estado.extraccion = NADA;
    turno(w, texto(dicho));
    expect(ent(w)['referencia'], dicho).toBe('');
  });

  it('M2, el caso opuesto: lo que SÍ es una dirección o una referencia se toma (con dígitos o palabra de vía)', () => {
    const w = sinDireccion('cat_m2_c');
    w.estado.extraccion = NADA;
    turno(w, texto('calle 1 numerro 2 Irpavi'));
    expect(ent(w)['direccion']).toBe('calle 1 numerro 2 Irpavi');
    const t = turno(w, texto('a media cuadra del gas'));
    expect(ent(w)['referencia']).toBe('a media cuadra del gas');
    expect(t.avisos).toHaveLength(0);
  });

  it('L1: «70012345» repetido no se queda en un bucle: se vuelve a pedir una vez y, a la segunda vez seguida, se pasa con el local', () => {
    const w = sinDireccion('cat_l1');
    w.estado.extraccion = NADA;
    const uno = turno(w, texto('70012345'));
    expect(ent(w)['direccion']).toBe('');
    expect(uno.mensajes[0]!.cuerpo).toBe('Para el delivery necesito la dirección exacta.');
    const dos = turno(w, texto('70012345'));
    expect(dos.mensajes[0]!.cuerpo).toMatch(/Esto prefiero que lo vea una persona/);
    expect(dos.avisos.length).toBeGreaterThan(0);
  });

  it('L2: la referencia y la dirección tomadas del texto salen sin formato de WhatsApp ni enlaces (con o sin esquema); también la del carrito web', () => {
    const w = conDireccion('cat_l2_a');
    w.estado.extraccion = NADA;
    turno(w, texto('*portón* _verde_'));
    expect(ent(w)['referencia']).toBe('portón verde');
    const v = crear();
    carrito(v, { headers: cabeceras(), body: cuerpo({ entrega: 'envio', direccion: 'Av. Arce 12', referencia: 'ver malo.com/x `portón`', pedidoId: 'cat_l2_b' }) });
    expect(ent(v)['referencia']).toBe('ver portón');
  });

  it('(3) si el modelo deja la dirección VACÍA pero el texto trae rasgos de una dirección, la toma el código (con la instrucción de entrega dentro)', () => {
    const w = sinDireccion('cat_3_a');
    w.estado.extraccion = { ...NADA, entrega: 'delivery', referencia: 'déjalo con el guardia nomás' };
    turno(w, texto('Calle Sucre 12, déjalo con el guardia nomás'));
    expect(String(ent(w)['direccion'])).toContain('Calle Sucre 12');
    expect(estadoDe(w)['paso']).toBe('pedido_confirmar');
    const v = sinDireccion('cat_3_b');
    v.estado.extraccion = NADA;
    turno(v, texto('Calle 1 número 2 Irpavi'));
    expect(ent(v)['direccion']).toBe('Calle 1 número 2 Irpavi');
    expect(estadoDe(v)['paso']).toBe('pedido_confirmar');
  });

  it('(4) «ella va a recoger en portería» con el modelo que lo «sube» a recojo: la entrega SIGUE siendo delivery y el pedido no pasa a recojo', () => {
    const w = sinDireccion('cat_4');
    w.estado.extraccion = { ...NADA, entrega: 'recojo' };
    turno(w, texto('ella va a recoger en portería'));
    expect(ent(w)['entrega']).toBe('delivery');
    expect(estadoDe(w)['paso']).not.toBe('pedido_confirmar');
  });

  it('la secuencia de Silvana (A13–A15) sigue bien: «Déjale al portero», «Ok», «A media cuadra del gas» (no pisa), y un nombre («Rexibe pedro») cae como referencia si no la hay', () => {
    const w = conDireccion('cat_seq_1');
    w.estado.extraccion = NADA;
    turno(w, texto('Déjale al portero'));
    expect(ent(w)['referencia']).toBe('Déjale al portero');
    const ok = turno(w, texto('Ok'));
    expect(ok.mensajes[0]!.cuerpo).toContain('Entrega: delivery a Av. Banzer 1234 (Déjale al portero)');
    turno(w, texto('A media cuadra del gas'));
    expect(ent(w)['referencia']).toBe('Déjale al portero');
    // Un nombre cuando el modelo no lo extrae: cae como referencia (límite declarado en DISENO.md).
    const v = conDireccion('cat_seq_2');
    v.estado.extraccion = NADA;
    turno(v, texto('Rexibe pedro'));
    expect(ent(v)['referencia']).toBe('Rexibe pedro');
  });
});

// =====================================================================================================
// #435, ronda 2 (batería real de la Operadora y revisión de seguridad sobre 542d5f7e): dos listas (dirección / referencia), ayuda por código, `vacias`, «otra persona recoge»
// =====================================================================================================
describe('#435 ronda 2: rasgos de dirección y de referencia, ayuda por código, vacías y «otra persona recoge»', () => {
  const NADA = { lineas: [], entrega: '', direccion: '', referencia: '', nombre: '', quiereHablar: false };
  let k = 0;
  const id = (): string => 'cat_r2_' + String(++k).padStart(4, '0');
  const conDireccion = () => {
    const w = crear();
    carrito(w, { headers: cabeceras(), body: cuerpo({ entrega: 'envio', direccion: 'Av. Banzer 1234', pedidoId: id() }) });
    w.estado.extraccion = NADA;
    return w;
  };
  const sinDireccion = () => {
    const w = crear();
    carrito(w, { headers: cabeceras(), body: cuerpo({ entrega: 'envio', direccion: '', pedidoId: id() }) });
    expect(estadoDe(w)['paso']).toBe('pedido_datos');
    w.estado.extraccion = NADA;
    return w;
  };
  const ent = (w: ReturnType<typeof crear>): J => estadoDe(w)['entrega'] as J;
  const PIDE_DIRECCION = 'Para el delivery necesito la dirección exacta.';
  const DERIVA = /Esto prefiero que lo vea una persona/;

  it.each(['A media cuadra del gas', 'Déjale al portero', 'frente al mercado', 'Zona Sur', 'por la puerta verde'])(
    'A4 «%s» con la dirección PENDIENTE queda como REFERENCIA (no como dirección) y se vuelve a pedir la dirección, sin pasar al resumen', (dicho) => {
      const w = sinDireccion();
      const t = turno(w, texto(dicho));
      expect(ent(w)['direccion'], dicho).toBe('');
      expect(ent(w)['referencia'], dicho).toBe(dicho);
      expect(t.mensajes[0]!.cuerpo, dicho).toBe(PIDE_DIRECCION);
      expect(estadoDe(w)['paso'], dicho).toBe('pedido_datos');
      expect(t.avisos, dicho).toHaveLength(0);
      // y luego la dirección real completa el pedido SIN duplicar la referencia
      const u = turno(w, texto('calle 1 numerro 2 Irpavi'));
      expect(ent(w)['direccion'], dicho).toBe('calle 1 numerro 2 Irpavi');
      expect(u.mensajes[0]!.cuerpo, dicho).toContain('Entrega: delivery a calle 1 numerro 2 Irpavi (' + dicho + ')');
      expect(estadoDe(w)['paso'], dicho).toBe('pedido_confirmar');
    },
  );

  it.each(['necesito ayuda', 'quiero que me atienda alguien', 'comuníquenme con el local', 'tengo un problema con mi pedido', 'esto es una estafa'])(
    'M1s «%s» con el modelo devolviendo SOLO {"lineas":[]} (sin quiereHablar) deriva a una persona, con la dirección dada y con la pendiente', (dicho) => {
      for (const [w, campo] of [[conDireccion(), 'referencia'], [sinDireccion(), 'direccion']] as const) {
        const t = turno(w, texto(dicho));
        expect(ent(w)[campo], dicho).toBe('');
        expect(t.mensajes[0]!.cuerpo, dicho).toMatch(DERIVA);
        expect(t.avisos.length, dicho).toBeGreaterThan(0);
      }
    },
  );
  it('M1s, el opuesto: una referencia con rasgos de entrega («que alguien me abra la puerta») NO deriva', () => {
    const w = conDireccion();
    const t = turno(w, texto('que alguien me abra la puerta'));
    expect(ent(w)['referencia']).toBe('que alguien me abra la puerta');
    expect(t.avisos).toHaveLength(0);
  });

  it('SV2: con la dirección YA dada, la secuencia de Silvana y textos sin dato no pasan con el local ni suman «vacías»: sigue el resumen', () => {
    const w = conDireccion();
    for (const dicho of ['Déjale al portero', 'Ok', 'A media cuadra del gas', 'Rexibe pedro', 'Rexibe pedro', 'gracias nomas', 'Rexibe pedro']) {
      const t = turno(w, texto(dicho));
      expect(t.avisos, dicho).toHaveLength(0);
      expect(t.mensajes[0]!.cuerpo, dicho).not.toMatch(DERIVA);
      expect(estadoDe(w)['paso'], dicho).toBe('pedido_confirmar');
      expect(t.mensajes[0]!.cuerpo, dicho).toContain('Entrega: delivery a Av. Banzer 1234');
    }
    expect(ent(w)['referencia']).toBe('Déjale al portero');
  });
  it('SV2, el opuesto: con la dirección PENDIENTE, dos textos seguidos sin dato sí pasan con el local a la 2.ª vez', () => {
    const w = sinDireccion();
    turno(w, texto('jajaja'));
    expect(ent(w)['direccion']).toBe('');
    const t = turno(w, texto('jajaja'));
    expect(t.mensajes[0]!.cuerpo).toMatch(DERIVA);
  });

  it('«ella va a recoger en portería» con la dirección pendiente y el modelo vacío: no es dirección; se vuelve a pedir', () => {
    const w = sinDireccion();
    const t = turno(w, texto('ella va a recoger en portería'));
    expect(ent(w)['direccion']).toBe('');
    expect(t.mensajes[0]!.cuerpo).toBe(PIDE_DIRECCION);
    expect(estadoDe(w)['paso']).toBe('pedido_datos');
  });
  it('«Calle Sucre 12, déjalo con el guardia nomás» (modelo vacío) es la dirección, con la instrucción dentro', () => {
    const w = sinDireccion();
    turno(w, texto('Calle Sucre 12, déjalo con el guardia nomás'));
    expect(ent(w)['direccion']).toBe('Calle Sucre 12, déjalo con el guardia nomás');
    expect(estadoDe(w)['paso']).toBe('pedido_confirmar');
  });

  it.each(['voy a recoger el pedido', 'mejor lo retiro yo en el local', 'el lo recoge'])(
    'MEDIUM «%s» con el modelo devolviendo `recojo` en pedido_datos: SÍ pasa a recojo (no es «otra persona»)', (dicho) => {
      const w = sinDireccion();
      w.estado.extraccion = { ...NADA, entrega: 'recojo' };
      turno(w, texto(dicho));
      expect(ent(w)['entrega'], dicho).toBe('recojo');
    },
  );
  it.each(['pedido_datos', 'pedido_confirmar'])('LOW-4 «ella va a recoger en portería» con el modelo devolviendo `recojo` en %s: SIGUE siendo delivery', (paso) => {
    const w = paso === 'pedido_datos' ? sinDireccion() : conDireccion();
    expect(estadoDe(w)['paso']).toBe(paso);
    w.estado.extraccion = { ...NADA, entrega: 'recojo' };
    turno(w, texto('ella va a recoger en portería'));
    expect(ent(w)['entrega']).toBe('delivery');
  });

  it('LOW-1: «prefiero delivery» se perdona UNA vez (vuelve a pedir la dirección); «no me manden nada» y «cancelen el envío» no se perdonan: derivan a la 2.ª vez', () => {
    const w = sinDireccion();
    const uno = turno(w, texto('prefiero delivery'));
    expect(uno.mensajes[0]!.cuerpo).toBe(PIDE_DIRECCION);
    expect(uno.avisos).toHaveLength(0);
    for (const dicho of ['no me manden nada', 'cancelen el envio']) {
      const v = sinDireccion();
      turno(v, texto(dicho));
      const dos = turno(v, texto(dicho));
      expect(dos.mensajes[0]!.cuerpo, dicho).toMatch(DERIVA);
    }
  });

  it.each(['dejalo como estaba', 'cambiar algo', 'q hora llega', 'me equivoque', 'una coca cola mas', 'dos de birria mas', 'paso a buscarlo a las 8'])(
    'LOW-3 «%s» con la dirección ya dada NO se guarda como referencia', (dicho) => {
      const w = conDireccion();
      turno(w, texto(dicho));
      expect(ent(w)['referencia'], dicho).toBe('');
    },
  );
  it.each(['quiero 2 tacos en calle 5', 'paso a buscarlo a las 8'])('LOW-3 «%s» con la dirección pendiente y el modelo con 0 líneas NO se toma como dirección', (dicho) => {
    const w = sinDireccion();
    turno(w, texto(dicho));
    expect(ent(w)['direccion'], dicho).toBe('');
  });
});

// =====================================================================================================
// #435, LOW-A1 y LOW-A2 (revisión de seguridad sobre 6c1935df): lo que pone el MODELO también pasa por las reglas del código; cortesías y entrega no son «ayuda»
// =====================================================================================================
describe('#435 LOW-A2: la «dirección» o la «referencia» que pone el modelo pasa por las listas del código', () => {
  const NADA = { lineas: [], entrega: '', direccion: '', referencia: '', nombre: '', quiereHablar: false };
  let k = 0;
  const id = (): string => 'cat_a2_' + String(++k).padStart(4, '0');
  const sinDireccion = () => {
    const w = crear();
    carrito(w, { headers: cabeceras(), body: cuerpo({ entrega: 'envio', direccion: '', pedidoId: id() }) });
    return w;
  };
  const conDireccion = () => {
    const w = crear();
    carrito(w, { headers: cabeceras(), body: cuerpo({ entrega: 'envio', direccion: 'Av. Banzer 1234', pedidoId: id() }) });
    return w;
  };
  const ent = (w: ReturnType<typeof crear>): J => estadoDe(w)['entrega'] as J;

  it.each(['Déjale al portero', 'A media cuadra del gas', 'frente al mercado'])(
    'A2 `{direccion: «%s»}` del modelo NO es la dirección: pasa a la referencia y se vuelve a pedir la dirección (sin pasar al resumen)', (dicho) => {
      const w = sinDireccion();
      w.estado.extraccion = { ...NADA, direccion: dicho };
      const t = turno(w, texto(dicho));
      expect(ent(w)['direccion'], dicho).toBe('');
      expect(ent(w)['referencia'], dicho).toBe(dicho);
      expect(t.mensajes[0]!.cuerpo, dicho).toBe('Para el delivery necesito la dirección exacta.');
      expect(estadoDe(w)['paso'], dicho).toBe('pedido_datos');
    },
  );
  it('A2, el opuesto: `{direccion: «Calle Sucre 12»}` del modelo SÍ es la dirección y sigue al resumen', () => {
    const w = sinDireccion();
    w.estado.extraccion = { ...NADA, direccion: 'Calle Sucre 12' };
    turno(w, texto('Calle Sucre 12'));
    expect(ent(w)['direccion']).toBe('Calle Sucre 12');
    expect(estadoDe(w)['paso']).toBe('pedido_confirmar');
  });
  it('A2: una ayuda que el modelo pone como dirección o referencia («necesito ayuda») deriva a una persona', () => {
    for (const campo of ['direccion', 'referencia']) {
      for (const [w, dicho] of [[sinDireccion(), 'necesito ayuda'], [conDireccion(), 'quiero que me atienda alguien']] as const) {
        w.estado.extraccion = { ...NADA, [campo]: dicho };
        const t = turno(w, texto(dicho));
        expect(t.mensajes[0]!.cuerpo, `${campo} ${dicho}`).toMatch(/Esto prefiero que lo vea una persona|¡Claro! 🙂 Toca «Escribir al local»|Disculpa, eso no lo puedo resolver por aquí/);
        expect(t.avisos.length, `${campo} ${dicho}`).toBeGreaterThan(0);
        expect(String(ent(w)[campo]), `${campo} ${dicho}`).not.toContain(dicho);
      }
    }
  });
});

describe('#435 LOW-A1: cortesías y datos de entrega no son «ayuda»; «ayúdenme» y «auxilio» sí', () => {
  const NADA = { lineas: [], entrega: '', direccion: '', referencia: '', nombre: '', quiereHablar: false };
  let k = 0;
  const conDireccion = () => {
    const w = crear();
    carrito(w, { headers: cabeceras(), body: cuerpo({ entrega: 'envio', direccion: 'Av. Banzer 1234', pedidoId: 'cat_a1_' + String(++k).padStart(4, '0') }) });
    w.estado.extraccion = NADA;
    return w;
  };
  it.each(['no hay problema', 'sin problema', 'ningún problema', 'alguien lo recibe', 'que lo reciba alguien', 'cualquier persona lo recibe', 'recibe Pedro, alguien de la familia', 'es para una persona'])(
    '«%s» NO deriva a una persona', (dicho) => {
      const w = conDireccion();
      const t = turno(w, texto(dicho));
      expect(t.avisos, dicho).toHaveLength(0);
      expect(estadoDe(w)['paso'], dicho).toBe('pedido_confirmar');
    },
  );
  it.each(['ayúdenme', 'auxilio', 'necesito ayuda urgente'])('«%s» SÍ deriva', (dicho) => {
    const w = conDireccion();
    const t = turno(w, texto(dicho));
    expect(t.avisos.length, dicho).toBeGreaterThan(0);
  });
});
