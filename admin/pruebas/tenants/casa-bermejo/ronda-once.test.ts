/**
 * RONDA 11 de Casa Bermejo (26/11/2026), revisión independiente del #1130 (BERMEJO_revision-1130-ronda11). Cada punto con su caso SANO y su caso NEGADO, con los tres modelos (sano, que toma el texto como dato, y vacío) y la MARCA del modelo.
 *  (1) DECISIÓN DE ANDRES: tras capturar un dato de TEXTO LIBRE (nombre, documento, ciudad, aclaración) NUNCA hay QR directo: sale el resumen con «Confirmar pedido» y «Corregir datos»; el QR sale al tocar el botón;
 *  (2) una PREGUNTA no es una orden: «¿confirmo?» no emite el QR ni pide el alias (chat, carrito y Argentina);
 *  (3) el turno que VACÍA el pedido en un paso de datos lo escribe el código, no el modelo;
 *  (4) stock que recorta Y precio que cambió, sin `precioCentavos`: se avisa el cambio de precio;
 *  (5) `bmPideAlias` recibe el `completoAntes` real: «confirmo» a secas con un pedido de Argentina incompleto no pide el alias.
 * Mensajes por conversación: carrito con la entrega por completar, +1 (el resumen antes del QR); con la entrega ya completa en la ficha, 0 (2, como antes).
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { LlamadaDoble } from '../../lib/n8n-de-mentira';
// @ts-expect-error — el módulo común es un .mjs
import { WEBHOOK_DEL_CARRITO } from '../../../../Flujos/src/modulos/catalogo-web/carrito-del-catalogo.mjs';
import { ANA, ARGENTINO, BILLETERA, CATALOGO, PID, catalogoOk, crear, hablar, modelo, mTexto, mToque, textoAlModelo } from './mundo';

type Mund = ReturnType<typeof crear>;
type Turno = ReturnType<typeof hablar>;
const MARCA = 'ZQXMARCA91';
const cabeceras = (m: Mund): J => ({ 'x-novuchat-numero': PID, 'x-novuchat-timestamp': String(m.ahora()), 'x-novuchat-signature': `sha256=${'0'.repeat(64)}` });
let seq = 0;
const cuerpo = (op: J = {}): J => ({
  tipo: 'carrito', tenantId: 'casa-bermejo', telefono: ANA, accion: 'responder', pedidoId: `cat_r11_${++seq}`, conversacionId: `wa_${ANA}`, ventanaAbierta: true,
  items: [{ id: 'billetera-cuero', nombre: 'Billetera de cuero', cantidad: 1, subtotal: 450, precioCentavos: 45000 }],
  total: 450, moneda: 'BOB', mercado: 'BO', catalogo: 'externo', entrega: 'retiro', costoEnvio: 0, direccion: '', nota: '', descartados: [], ...op,
});
const enviar = (m: Mund, body: J): Turno => m.turno({ headers: cabeceras(m), body }, { via: WEBHOOK_DEL_CARRITO, tolerarFallo: true });
const hayQr = (t: Turno): boolean => t.mensajes.some((x) => x.tipo === 'image');
const sinQr = (t: Turno): boolean => !hayQr(t) && t.llamadas.ingesta.every((x) => x['evento'] !== 'qr_enviado');
const cuerpos = (t: Turno): string => t.mensajes.map((x) => x.cuerpo).join(' | ');
const ids = (t: Turno): string[] => t.mensajes.flatMap((x) => ((x.payload['interactive'] as { action?: { buttons?: { reply: { id: string } }[] } } | undefined)?.action?.buttons ?? []).map((b) => b.reply.id));
const titulos = (t: Turno): string[] => t.mensajes.flatMap((x) => ((x.payload['interactive'] as { action?: { buttons?: { reply: { title: string } }[] } } | undefined)?.action?.buttons ?? []).map((b) => b.reply.title));
const confirmar = (m: Mund, t: Turno): Turno => { const id = ids(t).find((x) => x.startsWith('pedido:confirmar')); if (!id) throw new Error('el resumen no trae «Confirmar pedido»'); return hablar(m, ANA, mToque(id, 'Confirmar pedido')); };
const ficha = (m: Mund, tel = ANA): Record<string, any> => ((m.sd['casabermejo'] ?? {}) as Record<string, any>)[tel] ?? {}; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Los tres modelos, todos con la MARCA en su texto. */
const MODELOS: Record<string, () => ((ll: LlamadaDoble) => J)> = {
  sano: () => (ll) => modelo(`Entendido ${MARCA}.`, { lineas: BILLETERA, entrega: /Ana/.test(textoAlModelo(ll)) ? { nombre: 'Ana Pérez' } : {} }),
  tomaTexto: () => (ll) => modelo(`Entendido ${MARCA}.`, { lineas: BILLETERA, entrega: { nombre: textoAlModelo(ll), documento: textoAlModelo(ll).replace(/\D/g, '') } }),
  vacio: () => (ll) => modelo(`Entendido ${MARCA}.`, { lineas: [], entrega: /Ana/.test(textoAlModelo(ll)) ? { nombre: 'Ana Pérez' } : {} }),
};

describe('(1) DECISIÓN DE ANDRES: tras un dato de texto libre nunca hay QR directo (los casos del ataque de la ronda 11, con los tres modelos)', () => {
  const NOMBRES = ['ana pérez todavía no', 'Ana Pérez Todavía No', 'Ana Pérez Luego', 'ana perez despues', 'Ana Pérez', 'Ana Pérez, todavía no', 'Ana Pérez, después te confirmo', 'Ana Pérez pero espera', 'Ana Pérez CI 4412345, espera', 'Ana Pérez Todavía 4412345'];
  for (const [nombre, modeloDe] of Object.entries(MODELOS)) {
    for (const texto of NOMBRES) {
      it(`retiro, paso del nombre, modelo ${nombre}: «${texto}» no emite QR ni qr_enviado, y nunca el texto del modelo`, () => {
        const m = crear({ modeloDice: modeloDe() });
        enviar(m, cuerpo());
        const t = hablar(m, ANA, mTexto(texto));
        expect(sinQr(t), texto).toBe(true);
        expect(cuerpos(t)).not.toContain(MARCA);
      });
    }
    for (const texto of ['Ana Pérez Todavía 4412345', 'Ana Pérez 4412345', 'Ana Pérez, CI 4412345, espera', '4412345 Ana Pérez, todavía no']) {
      it(`envío, paso del nombre y la cédula, modelo ${nombre}: «${texto}» no emite QR`, () => {
        const m = crear({ modeloDice: modeloDe(), entregaPrevia: { departamento: 'dep:cb', ciudad: 'Cochabamba' } });
        enviar(m, cuerpo({ entrega: 'envio' }));
        const t = hablar(m, ANA, mTexto(texto));
        expect(sinQr(t), texto).toBe(true);
        expect(cuerpos(t)).not.toContain(MARCA);
      });
    }
    for (const texto of ['La Paz todavía no', 'El Alto todavía no', 'Quillacollo, todavía no', 'Sucre pero espera que consulto', 'Cochabamba']) {
      it(`envío, la ciudad como último dato, modelo ${nombre}: «${texto}» no emite QR (sale el resumen con «Confirmar pedido»)`, () => {
        const m = crear({ modeloDice: modeloDe(), entregaPrevia: { nombre: 'Ana Pérez', documento: '4412345' } });
        enviar(m, cuerpo({ entrega: 'envio' }));
        hablar(m, ANA, mTexto('hola'));   // el flujo pide el departamento; el cliente lo toca por la lista
        const l = hablar(m, ANA, { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'dep:lp', title: 'La Paz', description: '' } } });
        expect(sinQr(l)).toBe(true);
        const t = hablar(m, ANA, mTexto(texto));
        expect(sinQr(t), texto).toBe(true);
        expect(cuerpos(t)).not.toContain(MARCA);
      });
    }
  }
  it('SANO: el QR sale al tocar «Confirmar pedido» (2 mensajes: resumen del botón y QR), tras el resumen de 1 mensaje', () => {
    const m = crear({ modeloDice: MODELOS['sano']!() });
    enviar(m, cuerpo());
    const t = hablar(m, ANA, mTexto('Ana Pérez'));
    expect(t.mensajes).toHaveLength(1);
    expect(titulos(t)).toEqual(expect.arrayContaining(['Confirmar pedido', 'Corregir datos']));
    const q = confirmar(m, t);
    expect(hayQr(q)).toBe(true);
    expect(q.llamadas.ingesta.some((x) => x['evento'] === 'qr_enviado')).toBe(true);
  });
  it('SANO: con «confirmo» y el pedido ya completo (turno siguiente al resumen) el QR sale también', () => {
    const m = crear({ modeloDice: MODELOS['sano']!() });
    enviar(m, cuerpo());
    hablar(m, ANA, mTexto('Ana Pérez'));
    expect(hayQr(hablar(m, ANA, mTexto('confirmo')))).toBe(true);
  });
  it('ÚNICO camino con QR directo: el turno del carrito con la entrega YA completa en la ficha (no se captura ningún texto): 2 mensajes, como antes', () => {
    const m = crear({ modeloDice: MODELOS['sano']!(), entregaPrevia: { nombre: 'Ana Pérez' } });
    const t = enviar(m, cuerpo());
    expect(t.mensajes).toHaveLength(2);
    expect(hayQr(t)).toBe(true);
  });
});

describe('(2) una pregunta no es una orden: «¿confirmo?» no emite el QR ni pide el alias', () => {
  const PREGUNTAS = ['¿confirmo?', '¿Confirmo o no?', '¿Confirmo el pedido?', 'confirmo?'];
  for (const texto of PREGUNTAS) {
    it(`chat: con el pedido completo, «${texto}» no emite QR; «confirmo» a secas sí (control)`, () => {
      const m = crear({ modeloDice: MODELOS['sano']!() });
      enviar(m, cuerpo());
      hablar(m, ANA, mTexto('Ana Pérez'));
      expect(sinQr(hablar(m, ANA, mTexto(texto))), texto).toBe(true);
      expect(hayQr(hablar(m, ANA, mTexto('confirmo')))).toBe(true);
    });
    it(`carrito con la entrega completa (resumen con botón por un total distinto): «${texto}» no emite QR`, () => {
      const m = crear({ modeloDice: MODELOS['sano']!(), entregaPrevia: { nombre: 'Ana Pérez' } });
      expect(hayQr(enviar(m, cuerpo({ total: 999 })))).toBe(false);
      expect(sinQr(hablar(m, ANA, mTexto(texto))), texto).toBe(true);
    });
  }
  const itemAr = { ...CATALOGO[1], moneda: 'ARS', precio: 450000, precioCentavos: 45000000, stock: 10, disponible: true };
  const arSembrado = (f: Record<string, unknown>): Mund => {
    const m = crear({ catalogo: catalogoOk({ mercado: 'AR', moneda: 'ARS' }, [itemAr] as never), modeloDice: MODELOS['sano']!() });
    m.sd['casabermejo'] = { [ARGENTINO]: { ultimoMs: m.ahora() - 1000, carrito: [], ...f } };
    return m;
  };
  const pidioAlias = (m: Mund, texto: string): boolean => { let n = 0; m.dobles['Avisar al servidor'] = (ll: LlamadaDoble) => { if (/pedirAliasArs/.test(ll.url)) n++; return { statusCode: 200, body: { estado: 'abierto', alias: 'a.b', montoCentavos: 45000000, moneda: 'ARS', venceEn: new Date(m.ahora() + 1_800_000).toISOString(), reutilizado: false } } as never; }; hablar(m, ARGENTINO, mTexto(texto)); return n > 0; };
  for (const texto of PREGUNTAS) {
    it(`Argentina: con el pedido anotado y completo, «${texto}» no llama a pedirAliasArs; «confirmo» sí (control)`, () => {
      expect(pidioAlias(arSembrado({ aliasEstado: 'pedido', aliasPedidoId: 'wa_x1', aliasMontoCent: 45000000 }), texto), texto).toBe(false);
      expect(pidioAlias(arSembrado({ aliasEstado: 'pedido', aliasPedidoId: 'wa_x1', aliasMontoCent: 45000000 }), 'confirmo')).toBe(true);
    });
  }
});

describe('(5) `completoAntes` real de `bmPideAlias`: «confirmo» a secas con un pedido de Argentina incompleto no pide el alias', () => {
  const itemAr = { ...CATALOGO[1], moneda: 'ARS', precio: 450000, precioCentavos: 45000000, stock: 10, disponible: true };
  const pide = (f: Record<string, unknown>, texto: string): boolean => {
    const m = crear({ catalogo: catalogoOk({ mercado: 'AR', moneda: 'ARS' }, [itemAr] as never), modeloDice: MODELOS['sano']!() });
    m.sd['casabermejo'] = { [ARGENTINO]: { ultimoMs: m.ahora() - 1000, carrito: [], ...f } };
    let n = 0;
    m.dobles['Avisar al servidor'] = (ll: LlamadaDoble) => { if (/pedirAliasArs/.test(ll.url)) n++; return { statusCode: 200, body: { estado: 'abierto', alias: 'a.b', montoCentavos: 45000000, moneda: 'ARS', venceEn: new Date(m.ahora() + 1_800_000).toISOString(), reutilizado: false } } as never; };
    const t = hablar(m, ARGENTINO, mTexto(texto));
    return n > 0 || t.salidas['Conversar con el modelo'] === undefined;   // pidió el alias, o tomó la ruta del alias (sin pasar por el modelo)
  };
  it('NEGADO: pedido «anotado» sin referencia ni monto (incompleto): «confirmo» no toma la ruta del alias (sigue su camino normal, con el modelo)', () => {
    expect(pide({ aliasEstado: 'pedido', aliasPedidoId: '', aliasMontoCent: 0 }, 'confirmo')).toBe(false);
    expect(pide({ aliasEstado: 'pedido', aliasPedidoId: '', aliasMontoCent: 0 }, 'sí, confirmo')).toBe(false);
  });
  it('SANO: pedido completo (referencia y monto): «confirmo» pide el alias', () => {
    expect(pide({ aliasEstado: 'pedido', aliasPedidoId: 'wa_x1', aliasMontoCent: 45000000 }, 'confirmo')).toBe(true);
  });
});

describe('(3) el turno que vacía el pedido en un paso de datos lo escribe el código', () => {
  for (const texto of ['Ana Pérez, ya no quiero nada', 'Ana Pérez, cancela todo', 'La Paz, ya no quiero nada']) {
    it(`NEGADO: modelo vacío (lineas []) y «${texto}» en el paso de datos: texto fijo del código, sin la marca del modelo y sin QR`, () => {
      const m = crear({ modeloDice: MODELOS['vacio']!() });
      enviar(m, cuerpo());
      const t = hablar(m, ANA, mTexto(texto));
      expect(cuerpos(t)).not.toContain(MARCA);
      expect(cuerpos(t)).toMatch(/Quité .+ de (su|tu) pedido/);
      expect(sinQr(t)).toBe(true);
      expect(ficha(m).carrito).toEqual([]);
    });
    it(`NEGADO: modelo sano y toma-texto con «${texto}»: tampoco sale el texto del modelo ni un QR`, () => {
      for (const k of ['sano', 'tomaTexto']) {
        const m = crear({ modeloDice: MODELOS[k]!() });
        enviar(m, cuerpo());
        const t = hablar(m, ANA, mTexto(texto));
        expect(cuerpos(t), k).not.toContain(MARCA);
        expect(sinQr(t), k).toBe(true);
      }
    });
  }
});

describe('(4) stock que recorta Y precio vivo distinto, sin `precioCentavos` en la carga: se avisa el cambio de precio', () => {
  const cat = (precioCentavos: number, stock: number): ReturnType<typeof catalogoOk> => catalogoOk({}, CATALOGO.filter((c) => (c as J)['id'] === 'billetera-cuero').map((c) => ({ ...c, precio: precioCentavos / 100, precioCentavos, stock, disponible: true })) as never);
  const sinPrecio = (cantidad: number, total: number): J => cuerpo({ items: [{ id: 'billetera-cuero', nombre: 'Billetera de cuero', cantidad, subtotal: total }], total });
  it('NEGADO: stock 10, 51 pedidas, carga a 450 y vivo 520: dice «solo pude incluir 10» Y «Algún precio»; sin QR', () => {
    const m = crear({ catalogo: cat(52000, 10), entregaPrevia: { nombre: 'Ana Pérez' } });
    const t = enviar(m, sinPrecio(51, 22950));
    expect(sinQr(t)).toBe(true);
    expect(cuerpos(t)).toMatch(/solo pude incluir 10/);
    expect(cuerpos(t)).toMatch(/Algún precio/);
  });
  it('SANO: precios iguales (vivo 450): «solo pude incluir 10» sin «Algún precio»', () => {
    const m = crear({ catalogo: cat(45000, 10), entregaPrevia: { nombre: 'Ana Pérez' } });
    const t = enviar(m, sinPrecio(51, 22950));
    expect(cuerpos(t)).toMatch(/solo pude incluir 10/);
    expect(cuerpos(t)).not.toMatch(/Algún precio/);
  });
});
