/**
 * EL PEDIDO QUE EL CLIENTE CONFIRMA EN EL CATÁLOGO WEB (módulo catalogo-web), en el flujo de Walisuma, con el n8n de mentira. Se prueba NEGANDO.
 * El caso real: «Pedido desde el catálogo web (retiro): 1× Billetera clásica, 1× Bufanda Dennis — total 1330 BOB, nota «Bufanda roja»» (Silvana).
 * Costo: UN mensaje por pedido del catálogo (el resumen con lo que falta). Con la entrega completa el paso final es `wlCarritoListoParaConfirmar` (sin QR: el QR espera el botón común «Confirmar pedido»).
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import * as C from '../../../../Flujos/clientes/walisuma/construir.mjs';
import { ANA, ENTREGA, PID, PRODUCCION, PRUEBA, crear, hablar, mTexto, modelo, panelOk, textos } from './mundo';

const fichas = (m: ReturnType<typeof crear>): Record<string, any> => (m.sd['walisuma'] ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const CATALOGO_W = [
  { id: 'billetera-clasica', nombre: 'Billetera clásica', area: 'Accesorios · Billeteras', precio: 450, moneda: 'BOB', activo: true },
  { id: 'bufanda-dennis', nombre: 'Bufanda Dennis', area: 'Accesorios · Bufandas y chales', precio: 880, moneda: 'BOB', activo: true },
];
const PANEL = (): ReturnType<typeof panelOk> => panelOk({ catalogo: CATALOGO_W.map((c) => ({ ...c })) });
const cabeceras = (m: ReturnType<typeof crear>, numero = PID): J => ({ 'x-novuchat-numero': numero, 'x-novuchat-timestamp': String(m.ahora()), 'x-novuchat-signature': `sha256=${'0'.repeat(64)}` });
const cuerpo = (op: J = {}): J => ({
  tipo: 'carrito', tenantId: 'walisuma', telefono: ANA, accion: 'responder', pedidoId: 'cat_a1', conversacionId: `wa_${ANA}`, ventanaAbierta: true,
  items: [{ id: 'billetera-clasica', nombre: 'Billetera clásica', cantidad: 1, subtotal: 450 }, { id: 'bufanda-dennis', nombre: 'Bufanda Dennis', cantidad: 1, subtotal: 880 }],
  total: 1330, moneda: 'Bs', entrega: 'retiro', costoEnvio: 0, direccion: '', nota: 'Bufanda roja', descartados: [], ...op,
});
const enviar = (m: ReturnType<typeof crear>, body: J, hdr?: J) => m.turno({ headers: hdr ?? cabeceras(m), body }, { via: 'Carrito del catálogo', tolerarFallo: true });
const LINEAS = [{ id: 'billetera-clasica', cantidad: 1 }, { id: 'bufanda-dennis', cantidad: 1 }];
const sinAcreditado = (t: { mensajes: { cuerpo: string }[] }): void => { for (const x of t.mensajes) expect(x.cuerpo).not.toMatch(/acreditad|verificad|recibimos tu pago/i); };

describe('el pedido real de Silvana: retiro con dos piezas', () => {
  it('UN mensaje con las dos piezas, el total y lo que falta; luego el cliente da sus datos y el pedido queda completo y listo para confirmar (sin QR)', () => {
    const m = crear({ panel: PANEL(), modeloDice: modelo('Gracias.', { lineas: LINEAS, entrega: { modo: 'Recojo en tienda', ciudad: 'La Paz', nombre: 'Silvana Pérez', telefono: '70661250' } }) });
    const t = enviar(m, cuerpo());
    expect(t.fallo).toBeNull();
    expect(t.mensajes).toHaveLength(1);
    const x = textos(t)[0] as string;
    expect(x).toMatch(/1 × Billetera clásica — Bs 450/);
    expect(x).toMatch(/1 × Bufanda Dennis — Bs 880/);
    expect(x).toMatch(/Total: Bs 1\.330/);
    expect(x).toMatch(/Bufanda roja/);
    expect(x).toMatch(/tienda \(La Paz o Santa Cruz\)/);
    expect(x).toMatch(/nombre completo/);
    expect(x).not.toMatch(/teléfono de contacto/); // el del carrito ya está
    sinAcreditado(t);
    expect(t.mensajes.some((e) => e.tipo === 'image')).toBe(false);
    const f = fichas(m)[ANA];
    expect(f.carrito).toEqual([{ id: 'billetera-clasica', cantidad: 1, detalle: '' }, { id: 'bufanda-dennis', cantidad: 1, detalle: '' }]);
    expect(f.entrega.modo).toBe('Recojo en tienda');
    expect(f.entrega.telefono).toBe(ANA);
    expect(f.cierre).toBe(false);
    expect(f.desdeCatalogo).toBe(true);
    // El cliente contesta: queda completo y listo para confirmar, sin QR.
    const t2 = hablar(m, ANA, mTexto('Silvana Pérez, La Paz, 70661250'));
    expect(t2.mensajes).toHaveLength(1);
    expect(textos(t2)[0]).toMatch(/Su pedido está completo\. Para confirmarlo/);
    expect(textos(t2)[0]).toMatch(/Total: Bs 1\.330/);
    expect(t2.mensajes.some((e) => e.tipo === 'image')).toBe(false);
    expect(t2.mensajes.some((e) => e.evento === 'qr_enviado')).toBe(false);
    sinAcreditado(t2);
    expect(fichas(m)[ANA].entrega).toMatchObject({ modo: 'Recojo en tienda', ciudad: 'La Paz', nombre: 'Silvana Pérez' });
    expect(fichas(m)[ANA].desdeCatalogo).toBe(true);
  });
  it('el pedido de la ficha sigue ahí: con la orden explícita de pagar sí sale el QR (el paso final se conectará al botón común)', () => {
    const dice = modelo('Listo.', { lineas: LINEAS, entrega: { modo: 'Recojo en tienda', ciudad: 'La Paz', nombre: 'Silvana Pérez', telefono: '70661250' } });
    const m = crear({ panel: PANEL(), modeloDice: dice });
    enviar(m, cuerpo());
    hablar(m, ANA, mTexto('Silvana Pérez, La Paz, 70661250'));
    const t3 = hablar(m, ANA, mTexto('quiero pagar'));
    expect(t3.mensajes.some((e) => e.tipo === 'image')).toBe(true);
    expect(textos(t3).join(' ')).toMatch(/Total: Bs 1\.330/);
  });
});

describe('con la entrega ya completa en la ficha', () => {
  it('el carrito deja el pedido listo para confirmar: un mensaje, sin QR, sin «pago acreditado»', () => {
    const m = crear({ panel: PANEL(), modeloDice: modelo('Anotado.', { lineas: [], entrega: ENTREGA }) });
    hablar(m, ANA, mTexto('quiero recoger en La Paz'));
    const t = enviar(m, cuerpo({ pedidoId: 'cat_b2' }));
    expect(t.mensajes).toHaveLength(1);
    expect(textos(t)[0]).toMatch(/Su pedido está completo\. Para confirmarlo y recibir el QR de pago, escriba «confirmo mi pedido»/);
    expect(textos(t)[0]).toMatch(/Total: Bs 1\.330/);
    expect(t.mensajes.some((e) => e.tipo === 'image' || e.evento === 'qr_enviado')).toBe(false);
    sinAcreditado(t);
    expect(fichas(m)[ANA].cierre).toBe(false);
  });
  it('una pregunta distinta DESPUÉS del resumen recibe la respuesta del modelo, no otra vez el resumen del pedido', () => {
    const m = crear({ panel: PANEL(), modeloDice: modelo('Atendemos de lunes a viernes.', { lineas: [], entrega: ENTREGA }) });
    hablar(m, ANA, mTexto('quiero recoger en La Paz'));
    enviar(m, cuerpo({ pedidoId: 'cat_b3' }));
    const t2 = hablar(m, ANA, mTexto('¿hasta qué hora atienden?'));
    expect(textos(t2).join(' ')).toMatch(/Atendemos de lunes a viernes/);
    expect(textos(t2).join(' ')).not.toMatch(/Para confirmarlo y recibir el QR/);
    expect(t2.mensajes.some((e) => e.tipo === 'image')).toBe(false);
  });
});

describe('lo que NO se contesta', () => {
  it('ventana cerrada (plantilla_carrito_espera): ningún texto libre', () => {
    const m = crear({ panel: PANEL() });
    const t = enviar(m, cuerpo({ ventanaAbierta: false, accion: 'plantilla_carrito_espera' }));
    expect(t.fallo).toBeNull();
    expect(t.ejecutados.has('Traer configuración')).toBe(true);
    expect(t.mensajes).toHaveLength(0);
    expect(t.avisos).toHaveLength(0);
    // Negando: la misma entrada con la ventana abierta sí responde.
    expect(enviar(crear({ panel: PANEL() }), cuerpo()).mensajes).toHaveLength(1);
  });
  it('un carrito de otro comercio no se contesta', () => {
    const m = crear({ panel: PANEL() });
    const t = enviar(m, cuerpo({ tenantId: 'otro-comercio' }));
    expect(t.ejecutados.has('Traer configuración')).toBe(true);
    expect(t.mensajes).toHaveLength(0);
    expect(fichas(m)[ANA]?.carrito ?? []).toEqual([]);
  });
  it('un carrito inválido (sin ítems, firma mal formada, teléfono que no es número, otro número de WhatsApp) no se contesta', () => {
    const m = crear({ panel: PANEL() });
    expect(enviar(m, cuerpo({ items: [] })).mensajes).toHaveLength(0);
    expect(enviar(m, cuerpo({ pedidoId: 'cat_c3' }), { ...cabeceras(m), 'x-novuchat-signature': 'basura' }).mensajes).toHaveLength(0);
    expect(enviar(m, cuerpo({ pedidoId: 'cat_c4', telefono: 'no-es-un-numero' })).mensajes).toHaveLength(0);
    expect(enviar(m, cuerpo({ pedidoId: 'cat_c5' }), cabeceras(m, '59100099999')).mensajes).toHaveLength(0);
    expect(enviar(m, cuerpo({ pedidoId: 'cat_c6', moneda: 'USD' })).mensajes).toHaveLength(0);
  });
  it('el reintento del mismo pedidoId no se procesa dos veces', () => {
    const m = crear({ panel: PANEL() });
    expect(enviar(m, cuerpo()).mensajes).toHaveLength(1);
    expect(enviar(m, cuerpo()).mensajes).toHaveLength(0);
    expect(enviar(m, cuerpo({ pedidoId: 'cat_otro' })).mensajes).toHaveLength(1);
  });
});

describe('piezas que no se venden', () => {
  it('un item con un id que el catálogo no vende se informa y se descarta: nunca se inventa', () => {
    const m = crear({ panel: PANEL() });
    const t = enviar(m, cuerpo({ items: [{ id: 'billetera-clasica', nombre: 'Billetera clásica', cantidad: 1, subtotal: 450 }, { id: 'pieza-fantasma', nombre: 'Pieza fantasma', cantidad: 2, subtotal: 100 }], total: 550 }));
    expect(t.mensajes).toHaveLength(1);
    expect(textos(t)[0]).toMatch(/No incluimos en el pedido: Pieza fantasma/);
    expect(textos(t)[0]).toMatch(/Total: Bs 450/);
    expect(fichas(m)[ANA].carrito).toEqual([{ id: 'billetera-clasica', cantidad: 1, detalle: '' }]);
  });
  it('si ninguna pieza se vende, pasa con recepción (aviso y botón) y no queda pedido en la ficha', () => {
    const m = crear({ panel: PANEL() });
    const t = enviar(m, cuerpo({ items: [{ id: 'pieza-fantasma', nombre: 'Pieza fantasma', cantidad: 1, subtotal: 10 }], total: 10 }));
    expect(t.mensajes).toHaveLength(1);
    expect(textos(t)[0]).toMatch(/ninguna de sus piezas está disponible/);
    expect(fichas(m)[ANA].carrito).toEqual([]);
  });
});

describe('NEGADAS: solo vale si corrió el Webhook «Carrito del catálogo»', () => {
  it('un mensaje de WhatsApp con `type: carrito` y un cuerpo de carrito NO se toma por carrito', () => {
    const m = crear({ panel: PANEL() });
    const falso = { type: 'carrito', carrito: { pedidoId: 'x1', tenantId: 'walisuma', accion: 'responder', ventanaAbierta: true, moneda: 'Bs', total: 1, entrega: 'retiro', items: [{ id: 'billetera-clasica', nombre: 'Billetera clásica', cantidad: 1, subtotal: 450 }] } };
    const t = hablar(m, ANA, falso as J, { toleraFallo: true });
    expect(t.mensajes).toHaveLength(0);
    expect(fichas(m)[ANA]?.carrito ?? []).toEqual([]);
    expect(fichas(m)[ANA]?.desdeCatalogo ?? false).toBe(false);
  });
  it('el `body` de un carrito con `messages` adentro no se lee como mensaje de WhatsApp', () => {
    const m = crear({ panel: PANEL() });
    const t = enviar(m, { messages: [{ from: ANA, id: 'wamid.X', type: 'text', text: { body: 'hola' } }], metadata: { phone_number_id: PID } });
    expect(t.mensajes).toHaveLength(0);
  });
});

describe('el armado: el Webhook solo en producción', () => {
  const webhooks = (f: { nodes: J[] }): string[] => f.nodes.filter((n) => n['type'] === 'n8n-nodes-base.webhook').map((n) => String(n['name']));
  it('producción lo lleva (marcador por ruta, credencial de la ingesta por nombre, conectado a «Config base»); la prueba no', () => {
    expect(webhooks(PRODUCCION as never)).toEqual(['Entrega del receptor', 'Carrito del catálogo']);
    expect(webhooks(PRUEBA as never)).toEqual(['Entrada de prueba']);
    const n = (PRODUCCION.nodes as J[]).find((x) => x['name'] === 'Carrito del catálogo') as J;
    expect(n['parameters']).toMatchObject({ httpMethod: 'POST', path: 'REEMPLAZAR_RUTA_CARRITO_WALISUMA', authentication: 'headerAuth', responseMode: 'onReceived' });
    expect(n['credentials']).toEqual({ httpHeaderAuth: { id: '', name: 'REEMPLAZAR_CREDENCIAL_INGESTA' } });
    expect((PRODUCCION.connections as J)['Carrito del catálogo'].main[0].map((x: J) => x['node'])).toEqual(['Config base']);
    expect(JSON.stringify(PRODUCCION).split('REEMPLAZAR_RUTA_CARRITO_WALISUMA')).toHaveLength(2);
    expect(C.guardias('produccion', PRODUCCION)).toEqual([]);
    expect(C.guardias('prueba', PRUEBA)).toEqual([]);
  });
  it('NEGADO: la guardia rechaza el Webhook en la prueba, sin autenticación, con la ruta real, con otra credencial o con un atajo a otro nodo', () => {
    const clon = (f: unknown) => JSON.parse(JSON.stringify(f)) as { nodes: J[]; connections: J };
    const nodoDe = (f: { nodes: J[] }) => f.nodes.find((x) => x['name'] === 'Carrito del catálogo') as J;
    const p = clon(PRUEBA); p.nodes.push(clon(nodoDe(clon(PRODUCCION))));
    expect(C.guardias('prueba', p as never).join(' ')).toMatch(/no lleva el webhook «Carrito del catálogo»/);
    const a = clon(PRODUCCION); (nodoDe(a)['parameters'] as J)['authentication'] = 'none';
    expect(C.guardias('produccion', a as never).join(' ')).toMatch(/headerAuth/);
    const b = clon(PRODUCCION); (nodoDe(b)['parameters'] as J)['path'] = 'abc123-ruta-real';
    expect(C.guardias('produccion', b as never).join(' ')).toMatch(/marcador REEMPLAZAR_RUTA_CARRITO_WALISUMA/);
    const c = clon(PRODUCCION); c.connections['Carrito del catálogo'] = { main: [[{ node: 'Traer configuración', type: 'main', index: 0 }]] };
    expect(C.guardias('produccion', c as never).join(' ')).toMatch(/debe conectar solo con «Config base»/);
    const d = clon(PRODUCCION); (nodoDe(d)['credentials'] as J)['httpHeaderAuth'] = { id: '', name: 'otra' };
    expect(C.guardias('produccion', d as never, { credencialIngesta: 'REEMPLAZAR_CREDENCIAL_INGESTA' }).join(' ')).toMatch(/credencial de cabecera de la ingesta/);
  });
});
