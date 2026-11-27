/**
 * EL RECORRIDO «COMPRAR» DE PUNTA A PUNTA (B2, 27/11/2026; Estándar 1.4, 5.3 a 5.8): el mensaje que arma el botón «COMPRAR» del carrito de NovuTienda llega al chat → resumen con los precios VIVOS del catálogo → botones de entrega →
 * nombre → resumen con «Confirmar pedido» → QR del comercio → comprobante. Los mensajes son los FORMATOS REALES que entregó NovuTienda (`NOVUTIENDA_mensajes-comprar-reales_2026-11-27.md`, A a D y sus variantes: sin precio, sin montos,
 * «… y N productos más», pesos argentinos). No cubre el sitio real de NovuTienda, ni el modelo real, ni WhatsApp real (el mensaje real de NovuTienda sigue sin verificar en su repositorio: ver el documento).
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { LlamadaDoble } from '../../lib/n8n-de-mentira';
import { ANA, ARGENTINO, COMPROBANTE, catalogoOk, crear, hablar, mImagen, mTexto, mToque, modelo, panelConQr, textoAlModelo, textos, type Opciones } from './mundo';

const PROHIBIDO = /pago acreditado|pago verificado|recib[ií]mos? tu pago|acreditad[oa]|verificad[oa]|simulad[oa]/i;
const PIDE_PAGAR = /(escrib\w*|di(?:ga|me)?|mand\w*|env\w*) [«"]?pagar/i;
const item = (id: string, nombre: string, area: string, precio: number, moneda = 'BOB'): J => ({ id, nombre, descripcion: nombre, area, moneda, activo: true, precio, precioCentavos: precio * 100, stock: 10, disponible: true });
const BO = [item('samsung-65-u8000f', 'SAMSUNG 65 U8000F', 'Televisores', 7655), item('jbl-party-box-120', 'JBL PARTY BOX 120', 'Parlantes', 4148), item('aire-tcl-18-btu-inverter', 'AIRE TCL 18 BTU INVERTER', 'Aires', 5451), item('freezer-tcl-530-litros', 'FREEZER TCL 530 LITROS', 'Freezers', 7347)];
const AR = [item('samsung-65-u8000f', 'SAMSUNG 65 U8000F', 'Televisores', 991000, 'ARS'), item('aire-tcl-24-btu', 'AIRE TCL 24 BTU', 'Aires', 977000, 'ARS')];
const LEYENDA = 'El precio final y el envío se confirman por WhatsApp';
const MENSAJE_A = ['Hola, quiero comprar estos productos:', '1 x SAMSUNG 65 U8000F (cód. samsung-65-u8000f): Bs 7.655 c/u, subtotal Bs 7.655', '2 x JBL PARTY BOX 120 (cód. jbl-party-box-120): Bs 4.148 c/u, subtotal Bs 8.296', 'Total referencial: Bs 15.951', LEYENDA].join('\n');
const MENSAJE_B = ['Hola, quiero comprar estos productos:', '1 x AIRE TCL 18 BTU INVERTER (cód. aire-tcl-18-btu-inverter): Bs 5.451 c/u, subtotal Bs 5.451', '1 x FREEZER TCL 530 LITROS (cód. freezer-tcl-530-litros): Bs 7.347 c/u, subtotal Bs 7.347', 'Total referencial: Bs 12.798', LEYENDA].join('\n');
const MENSAJE_C = ['Hola, quiero comprar estos productos:', '1 x SAMSUNG 65 U8000F (cód. samsung-65-u8000f): $ 991.000 c/u, subtotal $ 991.000', '2 x AIRE TCL 24 BTU (cód. aire-tcl-24-btu): $ 977.000 c/u, subtotal $ 1.954.000', 'Total referencial: $ 2.945.000', LEYENDA].join('\n');
const MENSAJE_D = ['Hola, quiero comprar estos productos:', '1 x SAMSUNG 65 U8000F (cód. samsung-65-u8000f): Bs 7.655 c/u, subtotal Bs 7.655', '2 x JBL PARTY BOX 120 (cód. jbl-party-box-120): Bs 4.148 c/u, subtotal Bs 8.296', 'Total referencial: Bs 15.951', 'Nota: Entregar después de las 18', LEYENDA].join('\n');

/** El modelo de la conversación: no propone piezas (las del mensaje del sitio entran por código) y, cuando el asistente pidió el nombre, devuelve lo que el cliente escribió. */
const modeloDelSitio = () => { let n = 0; return (ll: LlamadaDoble): J => { n++; return modelo('Con gusto.', { lineas: [], entrega: n > 1 ? { nombre: textoAlModelo(ll) } : {} }); }; };
const abrir = (o: Opciones = {}) => crear({ catalogo: catalogoOk({}, BO as never), modeloDice: modeloDelSitio(), ...o });
const J_ = (x: unknown): string => JSON.stringify(x);
const hayQr = (t: ReturnType<typeof hablar>): boolean => t.mensajes.some((x) => x.tipo === 'image');
const idConfirmar = (t: ReturnType<typeof hablar>): string => /"id":"(pedido:confirmar:[a-z0-9]+)"/.exec(t.mensajes.map((x) => J_(x.payload)).join(' '))?.[1] ?? 'sin-boton';
const fichaDe = (m: ReturnType<typeof abrir>, tel = ANA): J => ((m.sd['casabermejo'] as Record<string, J>)[tel] as J);
const qr = (t: ReturnType<typeof hablar>): { monto?: number; lineas?: unknown[] } | undefined => t.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado') as { monto?: number; lineas?: unknown[] } | undefined;

describe('A) Bolivia, el recorrido completo: mensaje → resumen → retiro → nombre → «Confirmar pedido» → QR → comprobante', () => {
  it('cada paso, con el precio del catálogo vivo y ningún texto prohibido ni «escribe pagar»', () => {
    const m = abrir({ medio: { clasificacion: { ...COMPROBANTE, monto: '15951.00' } }, cotejo: { statusCode: 200, body: { estado: 'valido', importe: 15951, avisarComercio: true } } });
    const todos: string[] = [];
    const paso = (t: ReturnType<typeof hablar>) => { todos.push(...textos(t), ...t.mensajes.map((x) => J_(x.payload))); return t; };
    const t1 = paso(hablar(m, ANA, mTexto(MENSAJE_A)));
    expect(t1.mensajes).toHaveLength(1);
    expect(textos(t1).join(' ')).toContain('SAMSUNG 65 U8000F');
    expect(textos(t1).join(' ')).toContain('JBL PARTY BOX 120');
    expect(textos(t1).join(' ')).toContain('Total: Bs 15.951');
    expect(textos(t1).join(' ')).not.toMatch(/no coinciden con los del catálogo/);
    expect(fichaDe(m)['carrito']).toEqual([{ id: 'samsung-65-u8000f', cantidad: 1, detalle: '' }, { id: 'jbl-party-box-120', cantidad: 2, detalle: '' }]);
    expect(J_(t1.mensajes[0]!.payload)).toMatch(/entrega:retiro/);
    const t2 = paso(hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda')));
    expect(hayQr(t2)).toBe(false);
    const t3 = paso(hablar(m, ANA, mTexto('Ana Pérez')));
    expect(hayQr(t3)).toBe(false);   // 5.4: tras un dato de texto libre, NUNCA el QR directo: el resumen con «Confirmar pedido»
    expect(idConfirmar(t3)).toMatch(/^pedido:confirmar:/);
    expect(textos(t3).join(' ')).toContain('Total: Bs 15.951');
    const t4 = paso(hablar(m, ANA, mToque(idConfirmar(t3), 'Confirmar pedido')));
    expect(hayQr(t4)).toBe(true);   // 5.2: el QR sale en el turno en que se toca «Confirmar pedido»
    expect(qr(t4)?.monto).toBe(15951);
    m.dobles['Traer configuración'] = () => panelConQr(15951);
    const t5 = paso(hablar(m, ANA, mImagen({ caption: '' })));
    expect(textos(t5).join(' ')).toMatch(/llegó y los datos coinciden/);
    for (const x of todos) { expect(x).not.toMatch(PROHIBIDO); expect(x).not.toMatch(PIDE_PAGAR); }
  });
  it('5.3 «¿confirmo?» como pregunta NO emite el QR; «confirmo» y «pagar» con el pedido completo SÍ; nunca se pide escribir «pagar»', () => {
    const listo = () => { const m = abrir(); hablar(m, ANA, mTexto(MENSAJE_A)); hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda')); const t = hablar(m, ANA, mTexto('Ana Pérez')); return { m, t }; };
    const a = listo();
    const pregunta = hablar(a.m, ANA, mTexto('¿confirmo?'));
    expect(hayQr(pregunta)).toBe(false);
    expect(textos(pregunta).join(' ')).not.toMatch(PIDE_PAGAR);
    for (const frase of ['confirmo', 'pagar']) {
      const { m } = listo();
      expect(hayQr(hablar(m, ANA, mTexto(frase))), frase).toBe(true);
    }
    expect(textos(a.t).join(' ')).not.toMatch(PIDE_PAGAR);
  });
  it('5.8 un pedido que cambia con el QR ya enviado: el QR nuevo trae en el MISMO mensaje que el anterior quedó anulado', () => {
    const m = abrir();
    hablar(m, ANA, mTexto(MENSAJE_A)); hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    const t3 = hablar(m, ANA, mTexto('Ana Pérez'));
    hablar(m, ANA, mToque(idConfirmar(t3), 'Confirmar pedido'));
    m.dobles['Traer configuración'] = () => panelConQr(15951);
    const t = hablar(m, ANA, mTexto(MENSAJE_B));
    expect(textos(t).join(' ')).toMatch(/anulado|anular/i);
    expect(t.mensajes.length).toBeLessThanOrEqual(2);
  });
});

describe('B) Bolivia: otro carrito (aire y freezer): total Bs 12.798', () => {
  it('el resumen trae las dos piezas y el total del catálogo, sin aviso de precios', () => {
    const m = abrir();
    const t = hablar(m, ANA, mTexto(MENSAJE_B));
    expect(textos(t).join(' ')).toContain('AIRE TCL 18 BTU INVERTER');
    expect(textos(t).join(' ')).toContain('FREEZER TCL 530 LITROS');
    expect(textos(t).join(' ')).toContain('Total: Bs 12.798');
  });
});

describe('C) Argentina: pesos con «$» y el redondeo al millar', () => {
  it('«$ 991.000 c/u» + «2 x … $ 977.000»: el total del catálogo es ARS 2.945.000, sin aviso, y no se emite un QR de Bolivia', () => {
    const m = crear({ catalogo: catalogoOk({ mercado: 'AR', moneda: 'ARS' }, AR as never), modeloDice: modeloDelSitio() });
    const t = hablar(m, ARGENTINO, mTexto(MENSAJE_C));
    expect(textos(t).join(' ')).toContain('Total: ARS 2.945.000');
    expect(textos(t).join(' ')).not.toMatch(/no coinciden con los del catálogo/);
    expect(hayQr(t)).toBe(false);
    expect(fichaDe(m, ARGENTINO)['carrito']).toEqual([{ id: 'samsung-65-u8000f', cantidad: 1, detalle: '' }, { id: 'aire-tcl-24-btu', cantidad: 2, detalle: '' }]);
  });
});

describe('D) con la nota del cliente (el PR 248 de NovuTienda, sin publicar al 27/11)', () => {
  it('la nota llega ENTERA y UNA sola vez, rotulada, y no cambia piezas ni precios; la leyenda final no se arrastra', () => {
    const m = abrir();
    const t = hablar(m, ANA, mTexto(MENSAJE_D));
    const cuerpo = textos(t).join('\n');
    expect(cuerpo.match(/Entregar después de las 18/g)).toHaveLength(1);
    expect(cuerpo).toContain('Nota del cliente: Entregar después de las 18');
    expect(cuerpo).not.toMatch(/precio final y el envío se confirman/i);
    expect(cuerpo).toContain('Total: Bs 15.951');
    expect(fichaDe(m)['nota']).toBe('Entregar después de las 18');
  });
});

describe('las variantes que describe NovuTienda', () => {
  it('sin montos: «N x NOMBRE (cód. id)» sin precio ni total; la leyenda final sigue; entra igual con el precio del catálogo', () => {
    const m = abrir();
    const t = hablar(m, ANA, mTexto(['Hola, quiero comprar estos productos:', '1 x SAMSUNG 65 U8000F (cód. samsung-65-u8000f)', '2 x JBL PARTY BOX 120 (cód. jbl-party-box-120)', LEYENDA].join('\n')));
    expect(textos(t).join(' ')).toContain('Total: Bs 15.951');
    expect(textos(t).join(' ')).not.toMatch(/no coinciden con los del catálogo/);
  });
  it('una pieza «precio a consultar» (sin precio en el catálogo): no se cobra, y se DICE en el mismo mensaje; sin «Total referencial»', () => {
    const m = abrir();
    const t = hablar(m, ANA, mTexto(['Hola, quiero comprar estos productos:', '1 x SAMSUNG 65 U8000F (cód. samsung-65-u8000f): Bs 7.655 c/u, subtotal Bs 7.655', '1 x TAPIZ ARTESANAL (cód. tapiz-artesanal): precio a consultar', LEYENDA].join('\n')));
    expect(t.mensajes).toHaveLength(1);
    expect(textos(t).join(' ')).toContain('Total: Bs 7.655');
    expect(textos(t).join(' ')).toMatch(/Una pieza de tu mensaje no se pudo incluir porque no tiene precio o no está disponible/);
    expect(fichaDe(m)['carrito']).toEqual([{ id: 'samsung-65-u8000f', cantidad: 1, detalle: '' }]);
  });
  it('«… y 3 productos más (se detallan por WhatsApp)»: el pedido NO se da por completo; se dice cuántos faltan y se pide que los diga; también «y 1 producto más»', () => {
    for (const [n, esperado] of [[3, /faltaban 3 productos más que no llegaron completos/], [1, /faltaba 1 producto más que no llegó completo/]] as const) {
      const m = abrir();
      const t = hablar(m, ANA, mTexto(['Hola, quiero comprar estos productos:', '1 x SAMSUNG 65 U8000F (cód. samsung-65-u8000f): Bs 7.655 c/u, subtotal Bs 7.655', `… y ${n} producto${n === 1 ? '' : 's'} más (se detallan por WhatsApp)`, 'Total referencial: Bs 7.655', LEYENDA].join('\n')));
      expect(t.mensajes).toHaveLength(1);
      expect(textos(t).join(' ')).toMatch(esperado);
      expect(textos(t).join(' ')).toMatch(/dime cuáles son para sumarlos/);
    }
  });
  it('NEGADO: montos distintos del catálogo: se cobra el del catálogo y se avisa (el mensaje del sitio nunca fija el precio)', () => {
    const m = abrir();
    const t = hablar(m, ANA, mTexto(MENSAJE_A.replace('Bs 7.655 c/u, subtotal Bs 7.655', 'Bs 100 c/u, subtotal Bs 100').replace('Total referencial: Bs 15.951', 'Total referencial: Bs 8.396')));
    expect(textos(t).join(' ')).toMatch(/no coinciden con los del catálogo de hoy/);
    expect(textos(t).join(' ')).toContain('Total: Bs 15.951');
  });
});
