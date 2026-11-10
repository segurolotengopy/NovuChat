/**
 * ARGENTINA: EL COBRO POR ALIAS EN EL FLUJO DE CASA BERMEJO (B9). Contratos: `pedirAliasArs` y `cotejarAliasArs` (módulo Cobros). Se prueba NEGANDO, con el n8n de mentira:
 * el servidor es un doble; el código de los nodos es el real.
 *   - El alias llega en el TURNO SIGUIENTE al pedido (el cliente escribe «pagar»): 0 mensajes agregados; la llamada es del nodo «Avisar al servidor» y el cotejo, del nodo «Cotejar en el servidor».
 *   - `telefono` sale de messages[0].from, jamás del texto ni del modelo; las frases son fijas; NUNCA «pago acreditado/verificado/recibimos tu pago».
 *   - Alias apagado (409 `cerrado`): vuelve el comportamiento de antes, sin prometer nada.
 *   - Vencido, en revisión, un 409 distinto o una caída: aviso + botón.
 */
import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { join } from 'node:path';
import { cargarFuente, RAIZ_REPO } from '../../core/fuente-vm';
import type { LlamadaDoble } from '../../lib/n8n-de-mentira';
import { ANA, CATALOGO, COMPROBANTE, ENTREGA, PRODUCCION, PRUEBA, catalogoOk, crear, hablar, mImagen, mTexto, modelo, textos, type Opciones } from './mundo';

const BIL = 'billetera-cuero';
const ARG = ['54', '9', '11', '5550', '0001'].join('');
const OTRO = ['54', '9', '11', '5559', '9999'].join('');
const ALIAS = 'casa.bermejo.pagos';
const PROHIBIDO = /pago acreditado|pago verificado|recib[ií]mos? tu pago|acreditad[oa]|verificad[oa]|pagad[oa]|simulad[oa]|ya pagaste/i;
const PROMESA = /te avisamos|te avisar[eé]|te llamamos|te escribir[aá]n|lo consulto/i;
type Rep = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const fichas = (m: ReturnType<typeof crear>): Record<string, any> => (m.sd['casabermejo'] ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const itemAr = { ...CATALOGO[1], moneda: 'ARS', precio: 450000, precioCentavos: 45000000, stock: 10, disponible: true };
const catAr = () => catalogoOk({ mercado: 'AR', moneda: 'ARS' }, [itemAr]);
const todo = (t: ReturnType<typeof hablar>): string[] => [...textos(t), ...t.mensajes.map((x) => JSON.stringify(x.payload)), ...t.avisos.map((x) => x.cuerpo)];
const conBoton = (t: ReturnType<typeof hablar>) => t.mensajes.some((x) => JSON.stringify(x.payload).includes('cta_url'));

/** Un mundo de Argentina con el pedido ya anotado (turno 0) y un doble del servidor de alias. */
function conPedido(o: Opciones = {}) {
  const m = crear({ catalogo: catAr(), modeloDice: modelo('Con gusto, lo anoto.', { lineas: [{ id: BIL, cantidad: 1 }], entrega: ENTREGA }), medio: { clasificacion: { ...COMPROBANTE, monto: '450.000,00', cuentaDestino: '', alias: ALIAS, operacion: 'OP123456' } }, ...o });
  hablar(m, ARG, mTexto('una billetera'));
  const t0 = hablar(m, ARG, mTexto('quiero pagar'));
  return { m, t0 };
}
const llamadas: { url: string; cuerpo: unknown }[] = [];
const servidor = (m: ReturnType<typeof crear>, respuesta: (ll: LlamadaDoble) => unknown) => {
  llamadas.length = 0;
  m.dobles['Avisar al servidor'] = (ll) => { llamadas.push({ url: ll.url, cuerpo: ll.cuerpo }); return respuesta(ll) as never; };
  m.dobles['Cotejar en el servidor'] = (ll) => { llamadas.push({ url: ll.url, cuerpo: ll.cuerpo }); return respuesta(ll) as never; };
};
const abierto = (m: ReturnType<typeof crear>, extra: Rep = {}) => ({ statusCode: 200, body: { estado: 'abierto', alias: ALIAS, montoCentavos: 45000000, moneda: 'ARS', venceEn: new Date(m.ahora() + 30 * 60_000).toISOString(), reutilizado: false, ...extra } });
const codigo = (c: string, extra: Rep = {}) => ({ statusCode: 200, body: { codigo: c, intentosRestantes: 2, reintento: false, ...extra } });

describe('el pedido anotado (turno 0): cero mensajes agregados', () => {
  it('sigue siendo 1 mensaje y 1 aviso; ofrece «pagar» y guarda el pedido en la ficha, sin decir el alias ni prometer', () => {
    const { m, t0 } = conPedido();
    expect(t0.mensajes).toHaveLength(1);
    expect(t0.avisos).toHaveLength(1);
    expect(textos(t0).join(' ')).toMatch(/escríbeme «pagar»/);
    expect(textos(t0).join(' ')).not.toMatch(new RegExp(ALIAS));
    for (const x of todo(t0)) { expect(x).not.toMatch(PROHIBIDO); expect(x).not.toMatch(PROMESA); }
    const ev = t0.llamadas.ingesta.find((x) => x['evento'] === 'pedido_sin_cobro') as Rep;
    expect(fichas(m)[ARG]).toMatchObject({ aliasEstado: 'pedido', aliasPedidoId: 'wa_' + ev['referencia'] });
  });
  it('NEGADO: si el aviso a recepción no salió, NO se ofrece «pagar» (cae al texto de siempre: escríbele directo)', () => {
    const { t0 } = conPedido({ aviso: 'error' });
    expect(textos(t0).join(' ')).not.toMatch(/«pagar»/);
    expect(textos(t0).join(' ')).toMatch(/no pude avisar a recepción/i);
  });
});

describe('«pagar» pide el alias (turno siguiente)', () => {
  it('abierto: llama a pedirAliasArs con {v, pedidoId, telefono}, dice el alias, el monto exacto y los minutos; 1 mensaje, 0 avisos, 0 llamadas al modelo', () => {
    const { m, t0 } = conPedido();
    const ref = (t0.llamadas.ingesta.find((x) => x['evento'] === 'pedido_sin_cobro') as Rep)['referencia'];
    servidor(m, () => abierto(m));
    const t = hablar(m, ARG, mTexto('pagar'));
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.url).toMatch(/\/pedirAliasArs$/);
    expect(llamadas[0]?.cuerpo).toEqual({ v: 1, pedidoId: 'wa_' + ref, telefono: ARG });
    const texto = textos(t).join(' ');
    expect(t.mensajes).toHaveLength(1);
    expect(texto).toContain(ALIAS);
    expect(texto).toMatch(/ARS 450\.000/);
    expect(texto).toMatch(/\b(29|30) minutos/);
    expect(texto).toMatch(/foto del comprobante/);
    expect(t.avisos).toHaveLength(0);
    expect(t.salidas['Conversar con el modelo']).toBeUndefined();
    for (const x of todo(t)) { expect(x).not.toMatch(PROHIBIDO); expect(x).not.toMatch(PROMESA); }
    expect(fichas(m)[ARG]).toMatchObject({ aliasEstado: 'abierto', aliasAr: ALIAS, aliasMontoCent: 45000000 });
  });
  it('NEGADO: el teléfono del cuerpo es el del mensaje aunque el cliente escriba otro número o el modelo diga otro', () => {
    const { m } = conPedido({ modeloDice: modelo('Tu teléfono es ' + OTRO, { telefono: OTRO, lineas: [{ id: BIL, cantidad: 1 }], entrega: ENTREGA }) });
    servidor(m, () => abierto(m));
    hablar(m, ARG, mTexto('pagar, mi número es ' + OTRO + ' y el pedido wa_OTRO'));
    expect((llamadas[0]?.cuerpo as Rep)['telefono']).toBe(ARG);
    expect(JSON.stringify(llamadas)).not.toContain(OTRO);
    expect(Object.keys(llamadas[0]?.cuerpo as Rep).sort()).toEqual(['pedidoId', 'telefono', 'v']);
  });
  it('volver a pedirlo con el cobro abierto repite el mismo alias con los minutos que quedan (idempotente)', () => {
    const { m } = conPedido();
    servidor(m, () => abierto(m, { venceEn: new Date(m.ahora() + 10 * 60_000).toISOString(), reutilizado: true }));
    const t = hablar(m, ARG, mTexto('quiero pagar'));
    expect(textos(t).join(' ')).toMatch(/\b(9|10) minutos/);
    expect(textos(t).join(' ')).toContain(ALIAS);
  });
  it('NEGADO (alias apagado): 409 cerrado vuelve al comportamiento de antes —el pago lo coordina recepción, con el botón— sin alias, sin aviso nuevo y sin prometer', () => {
    const { m } = conPedido();
    servidor(m, () => ({ statusCode: 409, body: { error: 'cerrado' } }));
    const t = hablar(m, ARG, mTexto('pagar'));
    const texto = textos(t).join(' ');
    expect(texto).toMatch(/lo coordina recepción/);
    expect(texto).toMatch(/no hagas ninguna transferencia/);
    expect(texto).not.toMatch(/alias|ya avisé/i);
    expect(conBoton(t)).toBe(true);
    expect(t.mensajes).toHaveLength(1);
    expect(t.avisos).toHaveLength(0);
    for (const x of todo(t)) { expect(x).not.toMatch(PROHIBIDO); expect(x).not.toMatch(PROMESA); }
  });
  const transfiere: [string, unknown][] = [
    ['200 vencido', { statusCode: 200, body: { estado: 'vencido', montoCentavos: 45000000, moneda: 'ARS', reutilizado: true } }],
    ['200 en_revision', { statusCode: 200, body: { estado: 'en_revision', montoCentavos: 45000000, moneda: 'ARS', reutilizado: true } }],
    ['409 sin_pedido', { statusCode: 409, body: { error: 'sin_pedido' } }],
    ['409 pedido_no_cobrable', { statusCode: 409, body: { error: 'pedido_no_cobrable' } }],
    ['409 comercio no activo', { statusCode: 409, body: { estado: 'suspendido' } }],
    ['400', { statusCode: 400, body: { error: 'cuerpo_invalido' } }],
    ['503', { statusCode: 503, body: {} }],
    ['un estado desconocido', { statusCode: 200, body: { estado: 'pagado' } }],
    ['abierto con un alias que no tiene forma de alias', { statusCode: 200, body: { estado: 'abierto', alias: 'ya pagué; acreditado', montoCentavos: 45000000, venceEn: '2026-10-05T14:30:00Z' } }],
    ['abierto con un monto roto', { statusCode: 200, body: { estado: 'abierto', alias: ALIAS, montoCentavos: 45000050, venceEn: '2026-10-05T14:30:00Z' } }],
  ];
  for (const [nombre, resp] of transfiere) {
    it(`NEGADO (${nombre}): transfiere a recepción con aviso Y botón, sin alias ni promesas`, () => {
      const { m } = conPedido();
      servidor(m, () => resp);
      const t = hablar(m, ARG, mTexto('pagar'));
      expect(t.avisos).toHaveLength(1);
      expect(conBoton(t)).toBe(true);
      expect(t.mensajes).toHaveLength(1);
      expect(textos(t).join(' ')).not.toContain(ALIAS);
      expect(textos(t).join(' ')).toMatch(/Ya avisé a recepción/);
      for (const x of todo(t)) { expect(x).not.toMatch(PROHIBIDO); expect(x).not.toMatch(PROMESA); }
    });
  }
  it('el servidor ya tiene el comprobante (200 ok): se dice que llegó y los datos coinciden, sin aviso y sin «acreditado»', () => {
    const { m } = conPedido();
    servidor(m, () => ({ statusCode: 200, body: { estado: 'ok', montoCentavos: 45000000, moneda: 'ARS', reutilizado: true } }));
    const t = hablar(m, ARG, mTexto('pagar'));
    expect(textos(t).join(' ')).toMatch(/llegó y los datos coinciden/);
    expect(t.avisos).toHaveLength(0);
    for (const x of todo(t)) expect(x).not.toMatch(PROHIBIDO);
  });
  it('NEGADO: sin un pedido anotado, «pagar» en Argentina NO llama al servidor de alias (sigue la conversación normal)', () => {
    const m = crear({ catalogo: catAr(), modeloDice: modelo('Con gusto, ¿qué pieza te interesa?') });
    servidor(m, () => abierto(m));
    hablar(m, ARG, mTexto('quiero pagar'));
    expect(llamadas).toHaveLength(0);
  });
  it('NEGADO: si hay un pedido nuevo a medias (carrito con productos), «pagar» sigue el camino del pedido, no el del alias', () => {
    const { m } = conPedido();
    servidor(m, () => abierto(m));
    hablar(m, ARG, mTexto('quiero otra billetera'));
    llamadas.length = 0;
    const t = hablar(m, ARG, mTexto('quiero pagar'));
    expect(llamadas.filter((x) => /pedirAliasArs/.test(x.url))).toHaveLength(0);
    expect(t.llamadas.ingesta.some((x) => x['evento'] === 'pedido_sin_cobro')).toBe(true);
  });
  it('NEGADO: Bolivia nunca llama al servidor de alias', () => {
    const m = crear({ modeloDice: modelo('Con gusto.', { lineas: [{ id: BIL, cantidad: 1 }], entrega: ENTREGA }) });
    servidor(m, () => abierto(m));
    hablar(m, ANA, mTexto('una billetera'));
    hablar(m, ANA, mTexto('quiero pagar'));
    hablar(m, ANA, mTexto('pagar'));
    expect(llamadas.filter((x) => /AliasArs/.test(x.url))).toHaveLength(0);
  });
  it('un segundo pedido reemplaza al primero: «pagar» pide el alias del pedido NUEVO', () => {
    const { m } = conPedido();
    const t1 = hablar(m, ARG, mTexto('quiero otra billetera'));
    expect(t1.mensajes).toHaveLength(1);
    const t2 = hablar(m, ARG, mTexto('quiero pagar'));
    const ref2 = (t2.llamadas.ingesta.find((x) => x['evento'] === 'pedido_sin_cobro') as Rep)['referencia'];
    servidor(m, () => abierto(m));
    hablar(m, ARG, mTexto('pagar'));
    expect((llamadas[0]?.cuerpo as Rep)['pedidoId']).toBe('wa_' + ref2);
  });
});

describe('el comprobante de Argentina: cotejarAliasArs', () => {
  const conAlias = (o: Opciones = {}) => {
    const { m } = conPedido(o);
    servidor(m, () => abierto(m));
    hablar(m, ARG, mTexto('pagar'));
    return m;
  };
  const foto = (m: ReturnType<typeof crear>, resp: unknown) => { servidor(m, () => resp); return hablar(m, ARG, mImagen({ caption: '' })); };
  it('llama a cotejarAliasArs con la forma cerrada, el teléfono del mensaje y lo leído (alias y operación incluidos); no manda la ruta de la imagen', () => {
    const m = conAlias();
    const ref = fichas(m)[ARG].aliasPedidoId;
    foto(m, codigo('ok'));
    const ll = llamadas.find((x) => /cotejarAliasArs$/.test(x.url));
    expect(ll).toBeTruthy();
    const c = ll?.cuerpo as Rep;
    expect(Object.keys(c).sort()).toEqual(['idMeta', 'legible', 'leido', 'pedidoId', 'telefono', 'v']);
    expect(c).toMatchObject({ v: 1, pedidoId: ref, telefono: ARG, legible: true });
    expect(c['idMeta']).toMatch(/^wamid\./);
    expect(c['leido']).toEqual({ monto: '450.000,00', alias: ALIAS, fecha: COMPROBANTE.fecha, hora: COMPROBANTE.hora, operacion: 'OP123456' });
    expect(JSON.stringify(c)).not.toMatch(/ruta|tenants\//);
  });
  it('ok: llegó y los datos coinciden (NUNCA acreditado/verificado), 1 mensaje, 1 aviso a recepción; el pedido queda cerrado', () => {
    const m = conAlias();
    const t = foto(m, codigo('ok'));
    expect(textos(t).join(' ')).toMatch(/llegó y los datos coinciden/);
    expect(t.mensajes).toHaveLength(1);
    expect(t.avisos).toHaveLength(1);
    for (const x of todo(t)) { expect(x).not.toMatch(PROHIBIDO); expect(x).not.toMatch(PROMESA); }
    expect(fichas(m)[ARG].aliasEstado).toBe('fin');
    // un segundo comprobante ya no se coteja: lo ve recepción
    const t2 = foto(m, codigo('ok'));
    expect(t2.llamadas.ingesta.length).toBeGreaterThanOrEqual(0);
    expect(llamadas.filter((x) => /cotejarAliasArs$/.test(x.url))).toHaveLength(0);
  });
  it('monto_distinto: dice los dos montos y pide el correcto; sin aviso', () => {
    const t = foto(conAlias(), codigo('monto_distinto', { montoLeidoCentavos: 5000000 }));
    expect(textos(t).join(' ')).toMatch(/el comprobante dice ARS 50\.000 y tu pedido es de ARS 450\.000/);
    expect(textos(t).join(' ')).toMatch(/comprobante correcto/);
    expect(t.avisos).toHaveLength(0);
    for (const x of todo(t)) expect(x).not.toMatch(PROHIBIDO);
  });
  it('alias_distinto: pide revisar el alias y volver a enviar; sin aviso', () => {
    const t = foto(conAlias(), codigo('alias_distinto'));
    expect(textos(t).join(' ')).toMatch(/no muestra el alias al que debías transferir \(casa\.bermejo\.pagos\)/);
    expect(t.avisos).toHaveLength(0);
  });
  it('ilegible: pide una foto más nítida; sin aviso', () => {
    const t = foto(conAlias(), codigo('ilegible'));
    expect(textos(t).join(' ')).toMatch(/más nítida/);
    expect(t.avisos).toHaveLength(0);
  });
  it('repetido: se dice que ya está registrado; vuelve a pedir el comprobante solo si es otro pago', () => {
    const t = foto(conAlias(), codigo('repetido'));
    expect(textos(t).join(' ')).toMatch(/Ya tengo registrado tu comprobante anterior/);
    for (const x of todo(t)) expect(x).not.toMatch(PROHIBIDO);
  });
  for (const [nombre, resp, intro] of [
    ['vencido', codigo('vencido'), /ya venció/],
    ['en_revision', codigo('en_revision'), /quedó en revisión de recepción/],
    ['409 cerrado', { statusCode: 409, body: { error: 'cerrado' } }, /no pude compararlo/],
    ['409 sin_pedido', { statusCode: 409, body: { error: 'sin_pedido' } }, /no pude compararlo/],
    ['503', { statusCode: 503, body: {} }, /no pude compararlo/],
    ['un código inventado ("pagado")', codigo('pagado'), /no pude compararlo/],
    ['un 200 sin código', { statusCode: 200, body: {} }, /no pude compararlo/],
  ] as [string, unknown, RegExp][]) {
    it(`NEGADO (${nombre}): transfiere a recepción con aviso Y botón; nunca dice que coincide`, () => {
      const t = foto(conAlias(), resp);
      expect(textos(t).join(' ')).toMatch(intro);
      expect(t.avisos).toHaveLength(1);
      expect(conBoton(t)).toBe(true);
      expect(textos(t).join(' ')).not.toMatch(/coinciden/);
      for (const x of todo(t)) { expect(x).not.toMatch(PROHIBIDO); expect(x).not.toMatch(PROMESA); }
    });
  }
  it('NEGADO: un comprobante sin pago por alias abierto no se coteja: lo ve recepción (aviso + botón)', () => {
    const { m } = conPedido();
    servidor(m, () => codigo('ok'));
    const t = hablar(m, ARG, mImagen({ caption: '' }));
    expect(llamadas).toHaveLength(0);
    expect(t.avisos).toHaveLength(1);
    expect(conBoton(t)).toBe(true);
    expect(textos(t).join(' ')).toMatch(/no tengo un pago por alias abierto/);
  });
  it('NEGADO: Bolivia sigue cotejando contra cotejarComprobanteVenta con el cuerpo de siempre (telefono, legible, leido de seis campos, idMeta, ruta)', () => {
    const m = crear({ modeloDice: modelo('Con gusto.', { lineas: [{ id: BIL, cantidad: 1 }], entrega: ENTREGA }), medio: { clasificacion: { ...COMPROBANTE, alias: 'no.debe.viajar', operacion: 'OPNOVIAJA' } } });
    hablar(m, ANA, mTexto('una billetera'));
    hablar(m, ANA, mTexto('quiero pagar'));
    m.dobles['Traer configuración'] = () => ({ statusCode: 200, body: { tenantId: 'casa-bermejo', estadoComercio: 'activo', datosDelNegocio: { nombreNegocio: 'Tienda de prueba' }, operacion: { numeroRecepcion: '59100000031', prefijosPermitidos: ['591', '54'] }, atencion: { estado: 'normal' }, catalogo: CATALOGO.map((c) => ({ ...c })), venta: { mediaIdQr: 'media-qr-1' }, cobroReal: { nombreCuenta: 'Cuenta', banco: 'Banco' }, cobro: { activo: true, qr: { url: 'https://qr.example.com/q.png' }, pendiente: true, monto: 450, pedido: 'WL1', regla: 2 } } });
    servidor(m, () => ({ statusCode: 200, body: { estado: 'valido', importe: 450, avisarComercio: true } }));
    hablar(m, ANA, mImagen({ caption: '' }));
    const ll = llamadas.find((x) => /cotejar/.test(x.url));
    expect(ll?.url).toMatch(/\/cotejarComprobanteVenta$/);
    const c = ll?.cuerpo as Rep;
    expect(Object.keys(c).sort()).toEqual(['idMeta', 'legible', 'leido', 'ruta', 'telefono']);
    expect(Object.keys(c['leido']).sort()).toEqual(['banco', 'cuentaDestino', 'fecha', 'hora', 'monto', 'nombreCuenta']);
    expect(JSON.stringify(c)).not.toMatch(/no\.debe\.viajar|OPNOVIAJA/);
  });
});

describe('piezas puras y guardias', () => {
  const F = cargarFuente<{ bmAliasPedirResultado: (r: unknown) => { tipo: string }; bmCuerpoPedirAlias: (p: string, f: string) => unknown; bmCuerpoCotejarAlias: (...a: unknown[]) => unknown }>([
    join(RAIZ_REPO, 'Flujos/experimental/venta-digital/src/cobro.js'),
    join(RAIZ_REPO, 'Flujos/experimental/venta-digital/src/catalogo-externo.js'),
    join(RAIZ_REPO, 'Flujos/experimental/casa-bermejo/src/lib/bm-venta.js'),
  ], ['bmAliasPedirResultado', 'bmCuerpoPedirAlias', 'bmCuerpoCotejarAlias']);
  it('los cuerpos rechazan teléfonos, pedidos e idMeta mal formados (null: no se llama)', () => {
    expect(F.bmCuerpoPedirAlias('wa_BM1', ARG)).toEqual({ v: 1, pedidoId: 'wa_BM1', telefono: ARG });
    for (const [p, f] of [['BM1', ARG], ['wa_', ARG], ['wa_BM1', '+' + ARG], ['wa_BM1', '123'], ['wa_BM1', ''], ['wa_B M', ARG]]) expect(F.bmCuerpoPedirAlias(p!, f!)).toBeNull();
    const leido = { monto: '1', alias: 'a', fecha: 'f', hora: 'h', operacion: '' };
    expect(F.bmCuerpoCotejarAlias('wa_BM1', ARG, 'wamid.ABC=', true, leido)).toBeTruthy();
    expect(F.bmCuerpoCotejarAlias('wa_BM1', ARG, '', true, leido)).toBeNull();
    expect(F.bmCuerpoCotejarAlias('wa_BM1', ARG, 'wamid con espacios', true, leido)).toBeNull();
  });
  it('la expresión de «¿Hay avisos?» decide el aviso igual que bmAliasPedirResultado, para cada respuesta posible del servidor', () => {
    const nodo = (PRODUCCION.nodes as Rep[]).find((n) => n['name'] === '¿Hay avisos?') as Rep;
    const expr = String(nodo['parameters'].conditions.conditions[0].leftValue).replace(/^=\{\{/, '').replace(/\}\}$/, '').trim();
    const futuro = '2099-01-01T00:00:00.000Z';
    const casos: Rep[] = [
      { statusCode: 200, body: { estado: 'abierto', alias: ALIAS, montoCentavos: 45000000, venceEn: futuro } },
      { statusCode: 200, body: JSON.stringify({ estado: 'abierto', alias: ALIAS, montoCentavos: 45000000, venceEn: futuro }) },
      { statusCode: 200, body: { estado: 'abierto', alias: 'x', montoCentavos: 45000000, venceEn: futuro } },
      { statusCode: 200, body: { estado: 'abierto', alias: ALIAS, montoCentavos: 45000050, venceEn: futuro } },
      { statusCode: 200, body: { estado: 'abierto', alias: ALIAS, montoCentavos: 0, venceEn: futuro } },
      { statusCode: 200, body: { estado: 'abierto', alias: ALIAS, montoCentavos: 45000000, venceEn: 'no es fecha' } },
      { statusCode: 200, body: { estado: 'abierto', alias: ALIAS, montoCentavos: 45000000 } },
      { statusCode: 200, body: { estado: 'ok' } }, { statusCode: 200, body: { estado: 'vencido' } }, { statusCode: 200, body: { estado: 'en_revision' } },
      { statusCode: 200, body: { estado: 'raro' } }, { statusCode: 200, body: {} }, { statusCode: 200, body: 'no es json' },
      { statusCode: 409, body: { error: 'cerrado' } }, { statusCode: 409, body: { error: 'sin_pedido' } }, { statusCode: 409, body: { error: 'pedido_no_cobrable' } },
      { statusCode: 409, body: { estado: 'suspendido' } }, { statusCode: 400, body: { error: 'x' } }, { statusCode: 503, body: {} }, { error: { message: 'timeout' } }, {},
    ];
    const sinAviso = new Set(['abierto', 'ok', 'cerrado']);
    for (const r of casos) {
      const ctx = { json: (j: Rep) => j };
      const evalua = vm.compileFunction(`return (${expr});`, ['$', 'Date', 'Number', 'JSON']) as (...a: unknown[]) => unknown;
      const dolar = (nombre: string) => ({ first: () => ({ json: nombre === 'Armar avisos' ? { sinAviso: false, avisoSi: 'pedir_fallo' } : nombre === 'Avisar al servidor' ? r : { modoPrueba: false } }) });
      const hayAviso = evalua(dolar, Date, Number, JSON);
      const tipo = F.bmAliasPedirResultado(r).tipo;
      expect(hayAviso, JSON.stringify(r)).toBe(!sinAviso.has(tipo));
      void ctx;
    }
  });
  it('«¿Hay avisos?» sin avisoSi se comporta como siempre (hay aviso si «Armar avisos» lo armó)', () => {
    const nodo = (PRODUCCION.nodes as Rep[]).find((n) => n['name'] === '¿Hay avisos?') as Rep;
    const expr = String(nodo['parameters'].conditions.conditions[0].leftValue).replace(/^=\{\{/, '').replace(/\}\}$/, '').trim();
    const evalua = vm.compileFunction(`return (${expr});`, ['$', 'Date', 'Number', 'JSON']) as (...a: unknown[]) => unknown;
    const con = (a: Rep) => evalua((n: string) => ({ first: () => ({ json: n === 'Armar avisos' ? a : { modoPrueba: false } }) }), Date, Number, JSON);
    expect(con({ sinAviso: false })).toBe(true);
    expect(con({ sinAviso: true })).toBe(false);
  });
  it('el prompt de lectura de los dos nodos de imagen pide alias y operación (solo la variante de Casa Bermejo)', () => {
    for (const flujo of [PRODUCCION, PRUEBA]) for (const nm of ['Describir imagen', 'Describir documento']) {
      const t = String(((flujo.nodes as Rep[]).find((n) => n['name'] === nm) as Rep)['parameters'].text);
      expect(t).toMatch(/"alias": "", "operacion": ""/);
      expect(t).toMatch(/alias\s+el ALIAS/);
    }
  });
  it('el flujo sigue en 57 nodos (producción) y 52 (prueba)', () => {
    expect((PRODUCCION.nodes as unknown[]).length).toBe(57);
    expect((PRUEBA.nodes as unknown[]).length).toBe(52);
  });
});
