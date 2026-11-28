/**
 * RONDA 12 de Casa Bermejo (26/11/2026), revisión final del #1130 (BERMEJO_revision-1130-final). Mensajes por conversación: 0 agregados, 0 quitados.
 *  B1. Un carrito NUEVO de la página con otro modo de entrega y el QR abierto cierra el cobro (los dos sentidos, con los tres modelos): se compara con la entrega ORIGINAL de la ficha.
 *  I1. Vaciar el pedido EN EL RESUMEN (pedido completo antes del turno) con un modelo que vacía: texto fijo del código, nunca el del modelo.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { LlamadaDoble } from '../../lib/n8n-de-mentira';
// @ts-expect-error — el módulo común es un .mjs
import { WEBHOOK_DEL_CARRITO } from '../../../../Flujos/src/modulos/catalogo-web/carrito-del-catalogo.mjs';
import { ANA, BILLETERA, PID, crear, hablar, modelo, modeloAdverso, mLista, mTexto, panelConQr, textoAlModelo } from './mundo';

type Mund = ReturnType<typeof crear>;
type Turno = ReturnType<typeof hablar>;
const MARCA = 'ZQXMARCA12';
const cabeceras = (m: Mund): J => ({ 'x-novuchat-numero': PID, 'x-novuchat-timestamp': String(m.ahora()), 'x-novuchat-signature': `sha256=${'0'.repeat(64)}` });
let seq = 0;
const cuerpo = (op: J = {}): J => ({
  tipo: 'carrito', tenantId: 'casa-bermejo', telefono: ANA, accion: 'responder', pedidoId: `cat_r12_${++seq}`, conversacionId: `wa_${ANA}`, ventanaAbierta: true,
  items: [{ id: 'billetera-cuero', nombre: 'Billetera de cuero', cantidad: 1, subtotal: 450, precioCentavos: 45000 }],
  total: 450, moneda: 'BOB', mercado: 'BO', catalogo: 'externo', entrega: 'retiro', costoEnvio: 0, direccion: '', nota: '', descartados: [], ...op,
});
const enviar = (m: Mund, body: J): Turno => m.turno({ headers: cabeceras(m), body }, { via: WEBHOOK_DEL_CARRITO, tolerarFallo: true });
const hayQr = (t: Turno): boolean => t.mensajes.some((x) => x.tipo === 'image');
const sinQr = (t: Turno): boolean => !hayQr(t) && t.llamadas.ingesta.every((x) => x['evento'] !== 'qr_enviado');
const cuerpos = (t: Turno): string => t.mensajes.map((x) => x.cuerpo).join(' | ');
const ficha = (m: Mund): Record<string, any> => ((m.sd['casabermejo'] ?? {}) as Record<string, any>)[ANA] ?? {}; // eslint-disable-line @typescript-eslint/no-explicit-any

const MODELOS: Record<string, () => ((ll: LlamadaDoble) => J)> = {
  sano: () => (ll) => modelo(`Entendido ${MARCA}.`, { lineas: BILLETERA, entrega: /Ana/.test(textoAlModelo(ll)) ? { nombre: 'Ana Pérez' } : {} }),
  marcador: () => () => modelo(MARCA, { lineas: BILLETERA, entrega: {} }),
  adverso: () => modeloAdverso(),
  vacio: () => (ll) => modelo(`Entendido ${MARCA}.`, { lineas: [], entrega: /Ana/.test(textoAlModelo(ll)) ? { nombre: 'Ana Pérez' } : {} }),
};
const TRES = ['sano', 'marcador', 'adverso'] as const;
const ENVIO_COMPLETO = { departamento: 'dep:cb', ciudad: 'Cochabamba', nombre: 'Ana Pérez', documento: '4412345' };

describe('B1. carrito nuevo de la página con otro modo y el QR abierto: se cierra el cobro', () => {
  for (const k of TRES) {
    it(`retiro con QR → carrito de envío (modelo ${k}): cobro_cancelado, QR anulado, pregunta fija del departamento, sin QR ni marca`, () => {
      const m = crear({ modeloDice: MODELOS[k]!(), entregaPrevia: { nombre: 'Ana Pérez' } });
      expect(hayQr(enviar(m, cuerpo()))).toBe(true);
      m.dobles['Traer configuración'] = () => panelConQr(450);
      const t = enviar(m, cuerpo({ entrega: 'envio' }));
      expect(t.llamadas.ingesta.find((x) => x['evento'] === 'cobro_cancelado')).toBeTruthy();
      expect(sinQr(t)).toBe(true);
      expect(cuerpos(t)).toMatch(/QR anterior quedó anulado/);
      expect(cuerpos(t)).toMatch(/departamento/i);
      expect(cuerpos(t)).not.toContain(MARCA);
      expect(ficha(m).qrHastaMs).toBe(0);
      expect(ficha(m).qrCarrito).toEqual([]);
      expect(ficha(m).entrega.modo).toBe('Envío');
      // el siguiente paso sigue por el camino normal, con texto del código y sin QR
      const t2 = hablar(m, ANA, mLista('dep:cb', 'Cochabamba'));
      expect(sinQr(t2)).toBe(true);
      expect(cuerpos(t2)).not.toContain(MARCA);
    });
    it(`envío con QR → carrito de retiro (modelo ${k}): cobro_cancelado, QR anulado, resumen con «Confirmar pedido» del retiro, sin QR ni marca`, () => {
      const m = crear({ modeloDice: MODELOS[k]!(), entregaPrevia: ENVIO_COMPLETO });
      expect(hayQr(enviar(m, cuerpo({ entrega: 'envio' })))).toBe(true);
      m.dobles['Traer configuración'] = () => panelConQr(450);
      const t = enviar(m, cuerpo());
      expect(t.llamadas.ingesta.find((x) => x['evento'] === 'cobro_cancelado')).toBeTruthy();
      expect(sinQr(t)).toBe(true);
      expect(cuerpos(t)).toMatch(/QR anterior quedó anulado/);
      expect(JSON.stringify(t.mensajes.map((x) => x.payload))).toMatch(/Confirmar pedido/);
      expect(cuerpos(t)).not.toContain(MARCA);
      expect(ficha(m).qrHastaMs).toBe(0);
      expect(ficha(m).qrCarrito).toEqual([]);
      expect(ficha(m).entrega.modo).toBe('Retiro en tienda');
    });
  }
  it('SANO: el mismo carrito (mismo modo, mismas piezas) con el QR abierto NO cierra el cobro', () => {
    const m = crear({ modeloDice: MODELOS['sano']!(), entregaPrevia: { nombre: 'Ana Pérez' } });
    expect(hayQr(enviar(m, cuerpo()))).toBe(true);
    m.dobles['Traer configuración'] = () => panelConQr(450);
    const t = enviar(m, cuerpo());
    expect(t.llamadas.ingesta.find((x) => x['evento'] === 'cobro_cancelado')).toBeUndefined();
    expect(ficha(m).qrHastaMs).toBeGreaterThan(0);
  });
});

describe('I1. vaciar el pedido en el RESUMEN con el modelo que vacía: texto fijo del código', () => {
  for (const texto of ['ya no quiero nada', 'cancela todo']) {
    it(`resumen tras «Ana Pérez», «${texto}»: sin la marca del modelo y con el pedido vacío`, () => {
      const m = crear({ modeloDice: MODELOS['vacio']!() });
      enviar(m, cuerpo());
      hablar(m, ANA, mTexto('Ana Pérez'));
      const t = hablar(m, ANA, mTexto(texto));
      expect(cuerpos(t)).not.toContain(MARCA);
      expect(cuerpos(t)).toMatch(/Quité .+ de (su|tu) pedido/);
      expect(sinQr(t)).toBe(true);
      expect(ficha(m).carrito).toEqual([]);
    });
    it(`pedido ya completo antes del turno (carrito con total distinto → resumen), «${texto}»: texto fijo`, () => {
      const m = crear({ modeloDice: MODELOS['vacio']!(), entregaPrevia: { nombre: 'Ana Pérez' } });
      enviar(m, cuerpo({ total: 999 }));
      const t = hablar(m, ANA, mTexto(texto));
      expect(cuerpos(t)).not.toContain(MARCA);
      expect(cuerpos(t)).toMatch(/Quité .+ de (su|tu) pedido/);
      expect(sinQr(t)).toBe(true);
    });
  }
  it('NEGADO/SANO: en el resumen, «gracias» con el modelo vacío no vacía el pedido', () => {
    const m = crear({ modeloDice: MODELOS['vacio']!() });
    enviar(m, cuerpo());
    hablar(m, ANA, mTexto('Ana Pérez'));
    const t = hablar(m, ANA, mTexto('gracias'));
    expect(cuerpos(t)).not.toMatch(/Quité .+ de (su|tu) pedido/);
    expect(ficha(m).carrito.length).toBeGreaterThan(0);
  });
});
