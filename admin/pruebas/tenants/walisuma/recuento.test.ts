/**
 * RECUENTO DEL 24/11/2026 (revisor independiente contra el MD de Walisuma): los puntos 1 y 2 que dan un dato falso al cliente. Se prueba NEGANDO.
 *   1. Comprobante: se nombran TODAS las diferencias (el destinatario primero) y ninguna tapa a otra (antes la del monto reemplazaba a la del destinatario).
 *   2. Tapices: «quiero el Tapiz Carnaval» (con precio) no recibe «no tenemos un precio»; la pieza que de verdad no tiene precio sigue derivándose.
 */
import { describe, expect, it } from 'vitest';
import type { Mundo } from '../../lib/n8n-de-mentira';
import { ANA, COMPROBANTE, ENTREGA, crear, entregaEnElSegundoTurno, hablar, mImagen, mTexto, modelo, panelConQr, panelOk, textos, type Opciones } from './mundo';

const PROHIBIDO = /pago acreditado|pago verificado|recib[ií]mos? tu pago|acreditad[oa]|verificad[oa]|pagad[oa]|simulad[oa]/i;
function conQrAbierto(o: Opciones = {}): Mundo {
  const m = crear({ modeloDice: entregaEnElSegundoTurno(modelo('Con gusto, lo anoto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA })), ...o });
  hablar(m, ANA, mTexto('una billetera'));
  hablar(m, ANA, mTexto('quiero pagar'));
  m.dobles['Traer configuración'] = () => panelConQr(450);
  return m;
}
const cotejo = (body: Record<string, unknown>) => ({ statusCode: 200, body: { estado: 'reintentar', importe: 450, ...body } });

describe('punto 1: el comprobante nombra TODAS las diferencias, el destinatario primero', () => {
  it('cuenta distinta + monto menor: las dos, la del destinatario antes que la del monto; ninguna tapa a la otra', () => {
    const m = conQrAbierto({ medio: { clasificacion: COMPROBANTE }, cotejo: cotejo({ motivo: 'monto_menor', motivos: ['monto_menor', 'cuenta_distinta'], montoLeido: 50, montoEsperado: 450 }) });
    const x = textos(hablar(m, ANA, mImagen({ caption: '' }))).join(' ');
    expect(x).toMatch(/hay varias diferencias/);
    expect(x).toMatch(/su comprobante dice Bs 50 y su pedido es Bs 450/);
    expect(x).toMatch(/cuenta/i);
    expect(x.search(/cuenta/i)).toBeLessThan(x.search(/su comprobante dice/));
    expect(x).not.toMatch(PROHIBIDO);
  });
  it('destinatario + fecha, sin monto: las dos', () => {
    const m = conQrAbierto({ medio: { clasificacion: COMPROBANTE }, cotejo: cotejo({ motivo: 'nombre_distinto', motivos: ['fecha_anterior', 'nombre_distinto'] }) });
    const x = textos(hablar(m, ANA, mImagen({ caption: '' }))).join(' ');
    expect(x).toMatch(/hay varias diferencias/);
    expect(x).toMatch(/nombre del destinatario no coincide/);
    expect(x).toMatch(/fecha del comprobante es anterior/);
    expect(x.search(/destinatario/)).toBeLessThan(x.search(/fecha del comprobante/));
  });
  it('NEGADO: con UNA sola diferencia sigue el texto de siempre («hay una diferencia: …»)', () => {
    const m = conQrAbierto({ medio: { clasificacion: COMPROBANTE }, cotejo: cotejo({ motivo: 'monto_menor', motivos: ['monto_menor'], montoLeido: 50, montoEsperado: 450 }) });
    const x = textos(hablar(m, ANA, mImagen({ caption: '' }))).join(' ');
    expect(x).toMatch(/hay una diferencia: su comprobante dice Bs 50 y su pedido es Bs 450/);
    expect(x).not.toMatch(/varias diferencias/);
  });
});

describe('punto 2: los tapices con precio no se tratan como «sin precio»', () => {
  const CAT = [
    { id: 'billetera-cuero', nombre: 'Billetera de cuero', descripcion: 'Cuero.', area: 'Accesorios · Billeteras', precio: 450, moneda: 'BOB', activo: true },
    { id: 'tapiz-carnaval', nombre: 'Tapiz Carnaval', descripcion: 'Tapiz tejido a mano.', area: 'Hogar y oficina · Tapices', precio: 3750, moneda: 'BOB', activo: true },
    { id: 'tapiz-jalqa', nombre: 'Tapiz Jalq\'a', descripcion: 'Tapiz tejido a mano.', area: 'Hogar y oficina · Tapices', precio: 2900, moneda: 'BOB', activo: true },
    { id: 'tapiz-mujer-rio', nombre: 'Tapiz mujer río 66 x 31 cm', descripcion: 'Pieza única.', area: 'Hogar y oficina · Tapices', activo: true },
  ];
  const SIN_PRECIO = /cotizamos de forma personalizada|no tenemos un precio/;
  const decir = (frase: string) => textos(hablar(crear({ panel: panelOk({ catalogo: CAT.map((c) => ({ ...c })) }), modeloDice: modelo('Con gusto, le cuento del tapiz.') }), ANA, mTexto(frase))).join(' ');
  it('«quiero el Tapiz Carnaval» y «el tapiz Jalq\'a» (con precio) no reciben «no tenemos un precio»', () => {
    expect(decir('quiero el Tapiz Carnaval')).not.toMatch(SIN_PRECIO);
    expect(decir('me interesa el tapiz Jalq\'a')).not.toMatch(SIN_PRECIO);
  });
  it('NEGADO: nombrar una pieza con precio que NO es un tapiz no tapa al tapiz sin precio («la billetera y un tapiz»)', () => {
    expect(decir('quiero la billetera de cuero y un tapiz')).toMatch(SIN_PRECIO);
  });
  it('NEGADO: el tapiz que de verdad no tiene precio, por su nombre o por «tapiz» a secas, sigue derivándose', () => {
    expect(decir('quiero el tapiz mujer río 66 x 31 cm')).toMatch(SIN_PRECIO);
    expect(decir('quiero un tapiz')).toMatch(SIN_PRECIO);
  });
});
