/**
 * «QUIERO TU CATÁLOGO» (Andres, 20/11/2026): pedir el catálogo o las fotos da el botón con el catálogo web POR CÓDIGO (MD: [MOSTRAR_CATALOGO]),
 * sin modelo. El enlace lo manda la consola (`catalogoWeb.enlace`, con `catalogoCompleto: true`); sin enlace, o con uno que no es https, sigue al modelo.
 * Se prueba NEGANDO.
 */
import { describe, expect, it } from 'vitest';
import { ANA, crear, hablar, modelo, mTexto, panelConQr, panelOk, textos } from './mundo';

const ENLACE = 'https://catalogo.example.com/c/abc123';
const conEnlace = (e: unknown = ENLACE) => panelOk({ catalogoWeb: { activo: true, derivar: false, enlace: e } });
const boton = (t: ReturnType<typeof hablar>) => (t.mensajes[0]?.payload['interactive'] as { type?: string; action?: { parameters?: { url?: string; display_text?: string } } } | undefined);

describe('el catálogo web sale como botón y sin modelo', () => {
  for (const frase of ['quiero tu catálogo', 'Quisiera primero ver fotos', 'me manda el catalogo?', 'tienen fotografías de las bufandas', 'catálogo']) {
    it(`«${frase}»: UN mensaje con el botón «Ver catálogo» al enlace de la consola, sin llamar al modelo`, () => {
      const t = hablar(crear({ panel: conEnlace(), modeloDice: modelo('NO DEBE SALIR') }), ANA, mTexto(frase));
      expect(t.mensajes).toHaveLength(1);
      const b = boton(t);
      expect(b?.type).toBe('cta_url');
      expect(b?.action?.parameters?.url).toBe(ENLACE);
      expect(b?.action?.parameters?.display_text).toBe('Ver catálogo');
      expect(t.registro.map((r) => r.nodo)).not.toContain('Conversar con el modelo');
      expect(textos(t).join(' ')).not.toMatch(/NO DEBE SALIR/);
    });
  }
  it('NEGADO: sin enlace de la consola, o con uno que no es https, NO sale botón (sigue al modelo)', () => {
    for (const e of [null, '', 'http://catalogo.example.com/c/x', 'javascript:alert(1)', 'https://con espacio.example.com']) {
      const t = hablar(crear({ panel: conEnlace(e), modeloDice: modelo('Con gusto le cuento de las piezas.') }), ANA, mTexto('quiero tu catálogo'));
      expect(boton(t)?.action?.parameters?.url, String(e)).not.toBe(e);
      expect(t.registro.map((r) => r.nodo), String(e)).toContain('Conversar con el modelo');
    }
  });
  it('NEGADO: con el catálogo web apagado no hay botón', () => {
    const t = hablar(crear({ panel: panelOk({ catalogoWeb: { activo: false, enlace: ENLACE } }), modeloDice: modelo('Con gusto.') }), ANA, mTexto('quiero tu catálogo'));
    expect(JSON.stringify(t.mensajes)).not.toContain(ENLACE);
  });
  it('una pregunta que no pide el catálogo (precio, color, horario, pago, comprobante, pedido) no recibe el botón', () => {
    for (const f of ['cuanto cuesta la bufanda dennis', 'tienen en otros colores', 'a que hora atienden', 'ya vi el catálogo, quiero 2 bufandas dennis', 'le mando la foto del comprobante', 'quiero ver las opciones de pago', 'no quiero ver el catálogo', 'mandame fotos de las 3 bufandas', 'quiero ver las piezas']) {
      const t = hablar(crear({ panel: conEnlace(), modeloDice: modelo('Con gusto.') }), ANA, mTexto(f));
      expect(JSON.stringify(t.mensajes), f).not.toContain(ENLACE);
    }
  });
  it('el texto del botón es fijo, de usted y no promete lo que no cumple (sin «te», sin «lo consulto»)', () => {
    const t = hablar(crear({ panel: conEnlace(), modeloDice: modelo('x') }), ANA, mTexto('quiero tu catálogo'));
    const cuerpo = String((t.mensajes[0]?.payload['interactive'] as { body?: { text?: string } }).body?.text);
    expect(cuerpo).toMatch(/puede ver/);
    expect(cuerpo).not.toMatch(/te aviso|lo consulto|te llamamos|\bte\b/i);
  });
});

describe('«¿puedo pagar con tarjeta?» recibe cómo se paga, por código (20/11/2026)', () => {
  for (const f of ['puedo pagar con tarjeta', 'aceptan efectivo?', 'cuales son las formas de pago', 'como se paga', 'como pagar', 'como hago el pago']) {
    it(`«${f}»: un texto fijo de usted con el cobro por QR, sin modelo y sin «cuéntenos un poco más»`, () => {
      const t = hablar(crear({ modeloDice: modelo('NO DEBE SALIR') }), ANA, mTexto(f));
      expect(t.mensajes).toHaveLength(1);
      const x = textos(t).join(' ');
      expect(x).toMatch(/código QR/);
      expect(x).not.toMatch(/NO DEBE SALIR|Cuéntenos un poco más|acreditad|verificad|recibimos tu pago/i);
      expect(x).not.toMatch(/acept(amos|a) tarjeta|con tarjeta sí/i);
      expect(t.registro.map((r) => r.nodo)).not.toContain('Conversar con el modelo');
    });
  }
  it('NEGADO: «quiero pagar» y «pago con QR» siguen siendo el cierre del pedido, no esta respuesta', () => {
    for (const f of ['quiero pagar', 'voy a pagar con qr', 'le mando el comprobante de la tarjeta', 'mi tarjeta no funciona, mando captura', 'quiero pagar en efectivo 500', 'no quiero pagar con tarjeta']) {
      const t = hablar(crear({ modeloDice: modelo('Con gusto.') }), ANA, mTexto(f));
      expect(textos(t).join(' '), f).not.toMatch(/Si necesita otra forma de pago/);
    }
  });
});

describe('el botón del catálogo no interrumpe un pedido en curso (revisión del PR #1033)', () => {
  it('NEGADO: con el carrito armado, «quiero ver fotos» sigue al modelo (el pedido manda)', () => {
    const m = crear({ panel: conEnlace(), modeloDice: modelo('Con gusto, lo anoto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }] }) });
    hablar(m, ANA, mTexto('quiero una billetera de cuero'));
    const t = hablar(m, ANA, mTexto('quiero ver fotos'));
    expect(JSON.stringify(t.mensajes)).not.toContain(ENLACE);
    expect(t.registro.map((r) => r.nodo)).toContain('Conversar con el modelo');
  });
});

describe('con un QR abierto, la pregunta de pago sigue al modelo (revisión del PR #1033)', () => {
  it('NEGADO: «puedo pagar con tarjeta» con el cobro pendiente no recibe el texto fijo', () => {
    const t = hablar(crear({ panel: panelConQr(120), modeloDice: modelo('Con gusto.') }), ANA, mTexto('puedo pagar con tarjeta'));
    expect(textos(t).join(' ')).not.toMatch(/Si necesita otra forma de pago/);
  });
});
