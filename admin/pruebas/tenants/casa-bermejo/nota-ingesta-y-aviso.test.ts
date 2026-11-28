/**
 * LA NOTA DEL CLIENTE HACIA EL SERVIDOR Y HACIA RECEPCIÓN (27/11/2026). Se prueba NEGANDO, con el n8n de mentira:
 *   - Contrato de la ingesta (Auxiliar 2): la clave `nota` (texto plano, SIN rótulo, hasta 500, UNA vez por pedido) va en el MISMO cuerpo plano que `lineas` y `entrega`, solo con `qr_enviado` y `pedido_sin_cobro`;
 *     el `detalle` de las líneas ya no la lleva; sin nota, la clave no viaja. ORDEN DE DESPLIEGUE: servidor primero, luego publicar el flujo.
 *   - El AVISO a recepción del pedido lleva la nota entera (≤500), rotulada «Nota escrita por el cliente (no es un estado de pago): …», sin enlaces, en el MISMO aviso (0 mensajes agregados); sin nota, el aviso no cambia.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { LlamadaDoble } from '../../lib/n8n-de-mentira';
import { ANA, CATALOGO, REC, catalogoOk, completarEnvio, crear, hablar, mTexto, mToque, modelo, textoAlModelo, type Opciones } from './mundo';

type Rep = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const pieza = (id: string, nombre: string, precio: number): J => ({ id, nombre, descripcion: nombre, area: 'Hogar · Electro', precio, moneda: 'BOB', activo: true, precioCentavos: precio * 100, stock: 10, disponible: true });
const REAL = [pieza('lavadora-9kg', 'Lavadora Samsung 9 kg', 7655), pieza('licuadora-oster', 'Licuadora Oster', 4148)];
const pegado = (nota: string): string => `Hola, quiero comprar estos productos:\n2 x Lavadora Samsung 9 kg (cód. lavadora-9kg): Bs 7.655 c/u, subtotal Bs 15.310\n1 x Licuadora Oster (cód. licuadora-oster): Bs 4.148 c/u, subtotal Bs 4.148\nTotal referencial: Bs 19.458${nota === '' ? '' : '\nNota: ' + nota}`;
const sinPedido: Opciones['modeloDice'] = (ll: LlamadaDoble) => modelo('Listo.', { lineas: [], entrega: /^[A-Za-zÁ-ú ]{3,40}$/.test(textoAlModelo(ll)) ? { nombre: textoAlModelo(ll) } : {} });
const ids = (t: ReturnType<typeof hablar>): string[] => [...JSON.stringify(t.mensajes.map((x) => x.payload)).matchAll(/"id":"([^"]+)"/g)].map((x) => x[1]!);
const ingesta = (t: ReturnType<typeof hablar>, e: string): Rep | undefined => t.llamadas.ingesta.find((x) => x['evento'] === e) as Rep | undefined;
const ROTULO = 'Nota escrita por el cliente (no es un estado de pago): ';
const LARGA = 'Entregar en la calle 21, tocar el timbre dos veces y avisar al llegar. '.repeat(9).slice(0, 500).trim();

/** BO: del mensaje pegado hasta el QR (`qr_enviado`). */
function hastaElQr(nota: string): ReturnType<typeof hablar> {
  const m = crear({ modeloDice: sinPedido, catalogo: catalogoOk({}, REAL as never) });
  hablar(m, ANA, mTexto(pegado(nota)));
  hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
  const r = hablar(m, ANA, mTexto('Ana Pérez'));
  return hablar(m, ANA, mToque(ids(r).find((x) => x.startsWith('pedido:confirmar'))!, 'Confirmar pedido'));
}

describe('la nota hacia el servidor: una vez, en «nota», sin rótulo, hasta 500, solo con qr_enviado y pedido_sin_cobro', () => {
  it('una nota de 500 caracteres con un enlace: viaja UNA vez, sin el enlace, sin rótulo, ≤500, y NO está en el detalle de ninguna línea', () => {
    const q = hastaElQr(LARGA + ' https://malo.example/x');
    const ev = ingesta(q, 'qr_enviado')!;
    expect(ev['nota']).toBe(LARGA);
    expect(String(ev['nota']).length).toBeLessThanOrEqual(500);
    expect(String(ev['nota'])).not.toMatch(/http|malo\.example|nota del cliente|Nota escrita/i);
    for (const l of ev['lineas'] as Rep[]) { expect(l['detalle']).toBeUndefined(); expect(JSON.stringify(l)).not.toContain('timbre'); }
    expect((JSON.stringify(ev).match(/Entregar en la calle 21/g) ?? []).length).toBe((LARGA.match(/Entregar en la calle 21/g) ?? []).length);   // la nota entera, una sola vez
  });
  it('NEGADO: sin nota, la clave «nota» no viaja', () => {
    const ev = ingesta(hastaElQr(''), 'qr_enviado')!;
    expect('nota' in ev).toBe(false);
  });
  it('NEGADO: ningún otro evento de la ingesta lleva «nota» (solo qr_enviado y pedido_sin_cobro)', () => {
    const m = crear({ modeloDice: sinPedido, catalogo: catalogoOk({}, REAL as never) });
    const turnos = [hablar(m, ANA, mTexto(pegado('color negro'))), hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda')), hablar(m, ANA, mTexto('Ana Pérez')), hablar(m, ANA, mTexto('gracias'))];
    for (const t of turnos) for (const x of t.llamadas.ingesta as Rep[]) if (x['evento'] !== 'qr_enviado' && x['evento'] !== 'pedido_sin_cobro') expect('nota' in x, String(x['evento'])).toBe(false);
  });
});

describe('Argentina (pedido_sin_cobro): la nota viaja en «nota» y el AVISO a recepción la lleva entera y rotulada', () => {
  const ARG = ['54', '9', '11', '5550', '0001'].join('');
  const itemAr = { ...CATALOGO[1], moneda: 'ARS', precio: 450000, precioCentavos: 45000000, stock: 10, disponible: true };
  const pegadoAr = (nota: string): string => `Hola, quiero comprar estos productos:\n1 x Billetera de cuero (cód. billetera-cuero): $ 450.000 c/u, subtotal $ 450.000\nTotal referencial: $ 450.000${nota === '' ? '' : '\nNota: ' + nota}`;
  /** `ventana`: recepción escribió hace poco (el aviso sale como TEXTO LIBRE); sin ella sale por la plantilla, cuyas variables pasan por la red común de palabras de cobro. */
  const pedidoAr = (nota: string, ventana = true) => {
    const m = crear({ catalogo: catalogoOk({ mercado: 'AR', moneda: 'ARS' }, [itemAr]), modeloDice: modelo('Listo.', { lineas: [] }) });
    if (ventana) hablar(m, REC, mTexto('hola'));
    hablar(m, ARG, mTexto(pegadoAr(nota)));
    hablar(m, ARG, mToque('entrega:envio', 'Envío'));
    completarEnvio(m, ARG, 'AR');
    return hablar(m, ARG, mTexto('quiero pagar'));
  };
  it('con nota: «nota» en el evento (sin rótulo, no en el detalle) y el aviso la trae ENTERA con el rótulo, sin enlaces; sigue siendo 1 mensaje y 1 aviso', () => {
    const t = pedidoAr(LARGA + ' www.malo.example/x');
    const ev = ingesta(t, 'pedido_sin_cobro');
    expect(ev, JSON.stringify(t.mensajes.map((x) => x.cuerpo))).toBeDefined();
    expect(ev!['nota']).toBe(LARGA);
    for (const l of ev!['lineas'] as Rep[]) expect(l['detalle']).toBeUndefined();
    expect(t.avisos).toHaveLength(1);
    expect(t.mensajes).toHaveLength(1);
    const aviso = String(t.avisos[0]!.cuerpo);
    expect(aviso).toContain(ROTULO + LARGA);
    expect(aviso).not.toMatch(/malo\.example|http/);
  });
  it('NEGADO: sin nota, el aviso no cambia (ni rótulo ni «nota») y el evento no lleva «nota»', () => {
    const t = pedidoAr('');
    expect(String(t.avisos[0]!.cuerpo)).not.toMatch(/Nota escrita|nota del cliente/i);
    expect('nota' in ingesta(t, 'pedido_sin_cobro')!).toBe(false);
  });
  it('fuera de la ventana (plantilla): el aviso lleva el rótulo y la nota en la variable de los ítems, y sigue siendo 1 aviso', () => {
    const t = pedidoAr('pagaré en efectivo al recibir', false);
    expect(t.avisos).toHaveLength(1);
    expect(String(t.avisos[0]!.cuerpo)).toContain(ROTULO + 'pagaré en efectivo al recibir');
  });
  it('«Remitir a Pedidos»: fuera de la ventana (plantilla), una nota que cita un pago NO sale como «[texto omitido]»: el aviso dice que hay una nota y que se lee entera en Pedidos de la Consola; una nota normal va como hasta ahora', () => {
    const t = pedidoAr('el anticipo ya está pagado, pago acreditado', false);
    expect(t.avisos).toHaveLength(1);
    const c = String(t.avisos[0]!.cuerpo);
    expect(c).toContain('El cliente dejó una nota; léela entera en Pedidos de la Consola.');
    expect(c).not.toMatch(/texto omitido|anticipo|acreditado/i);
    expect(t.mensajes).toHaveLength(1);
    expect(String(pedidoAr('pagaré en efectivo al recibir', false).avisos[0]!.cuerpo)).not.toContain('Pedidos de la Consola');
  });
  it('una nota con palabras de pago llega a recepción entera y rotulada (no se convierte en «[texto omitido]»); el cliente no la ve', () => {
    const t = pedidoAr('el anticipo ya está pagado, pago acreditado');
    expect(String(t.avisos[0]!.cuerpo)).toContain(ROTULO + 'el anticipo ya está pagado, pago acreditado');
    expect(t.mensajes.map((x) => x.cuerpo).join(' ')).not.toMatch(/anticipo|acreditado/i);
  });
});
