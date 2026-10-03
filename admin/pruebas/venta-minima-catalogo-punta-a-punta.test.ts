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
  AHORA, boton, botonesDe, crear, estadoDe, idDeBoton, nodoDe, panel, PHONE_ID, QTACO, texto, turno,
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
