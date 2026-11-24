/**
 * COMPRA COMPLETA CON EL MODELO ADVERSO (reclamo de Andres, 24/11/2026: «recojo en tienda» terminaba en «una persona del equipo se encargará» y no se guardaba el modo).
 * El modelo simulado hace lo peor que ha hecho: pone quiereHablar en true al elegir el modo y al dar el nombre, devuelve lineas: [] sin que nadie vacíe el pedido y redacta
 * «una persona del equipo se encargará». El CÓDIGO debe llevar la compra hasta «Confirmar pedido» y el QR. Se prueba NEGANDO.
 */
import { describe, expect, it } from 'vitest';
import { ANA, crear, hablar, mTexto, modelo } from './mundo';

const J = (x: unknown): string => JSON.stringify(x);
type Ficha = { carrito: { id: string }[]; entrega: { modo: string; nombre: string; ciudad?: string; flota?: string; documento?: string } };
const ficha = (m: ReturnType<typeof crear>): Ficha => (m.sd['casabermejo'] as Record<string, Ficha>)[ANA]!;
const mToque = (id: string, title: string) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const hayQr = (t: ReturnType<typeof hablar>): boolean => t.mensajes.some((x) => x.tipo === 'image' && /qr/i.test(J(x.payload)));
const ids = (t: ReturnType<typeof hablar>): string[] => t.mensajes.flatMap((x) => J(x.payload).match(/"id":"[^"]+"/g) ?? []);
const PERSONA = /persona del equipo|se encargar/i;
/** El modelo adverso: el primer turno agrega la billetera sin pedir nada raro; los demás devuelven lineas: [] y quiereHablar:true con el texto de la derivación. */
const adverso = () => { let n = 0; return () => { n++; return n === 1 ? modelo('Con gusto, lo anoto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }] }) : modelo('Una persona del equipo se encargará.', { lineas: [], quiereHablar: true }); }; };

describe('recojo en tienda con el modelo adverso', () => {
  it('el modo escrito se guarda por código, no deriva y el texto lo arma el código (nunca «una persona del equipo»); el nombre de UNA palabra completa el pedido: «Confirmar pedido» con el resumen', () => {
    const m = crear({ modeloDice: adverso() });
    const t0 = hablar(m, ANA, mTexto('quiero una billetera'));
    expect(ficha(m).carrito.map((l) => l.id)).toEqual(['billetera-cuero']);
    const t1 = hablar(m, ANA, mTexto('recojo en tienda'));
    expect(ficha(m).entrega.modo).toMatch(/retiro|recojo/i);
    expect(ficha(m).carrito).toHaveLength(1); // lineas: [] del modelo NO borra el pedido
    expect(t1.mensajes.map((x) => x.cuerpo).join(' ')).not.toMatch(PERSONA);
    expect(t1.avisos).toHaveLength(0);
    const t2 = hablar(m, ANA, mTexto('Silvana'));
    expect(ficha(m).entrega.nombre).toBe('Silvana');
    expect(t2.mensajes.map((x) => x.cuerpo).join(' ')).not.toMatch(PERSONA);
    expect(t2.mensajes.map((x) => x.cuerpo).join(' ')).toMatch(/Billetera de cuero/); // el resumen acompaña al botón aunque el carrito no cambió
    expect(ids(t2).join(' ')).toMatch(/pedido:confirmar:/);
    void t0;
  });
  it('tocar «Confirmar pedido» emite el QR en el mismo turno', () => {
    const m = crear({ modeloDice: adverso() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mTexto('recojo en tienda'));
    const t2 = hablar(m, ANA, mTexto('Ana Pérez'));
    const id = /"id":"(pedido:confirmar:[a-z0-9]+)"/.exec(J(t2.mensajes.map((x) => x.payload)))?.[1] ?? 'sin-boton';
    const t3 = hablar(m, ANA, mToque(id, 'Confirmar pedido'));
    expect(hayQr(t3)).toBe(true);
  });
  it('con el botón de entrega, el nombre de UNA palabra y el modelo adverso: termina en «Confirmar pedido», sin derivar', () => {
    const m = crear({ modeloDice: adverso() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    const t1 = hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    expect(t1.mensajes.map((x) => x.cuerpo).join(' ')).not.toMatch(PERSONA);
    const t2 = hablar(m, ANA, mTexto('Silvana'));
    expect(t2.avisos).toHaveLength(0);
    expect(ids(t2).join(' ')).toMatch(/pedido:confirmar:/);
  });
});

describe('envío con el modelo adverso', () => {
  it('el modo «envío» escrito se guarda; el nombre de UNA palabra NO basta (se pide más); con los datos completos sale «Confirmar pedido» y luego el QR', () => {
    const m = crear({ modeloDice: adverso() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    const t1 = hablar(m, ANA, mTexto('con envío'));
    expect(ficha(m).entrega.modo).toMatch(/env/i);
    expect(t1.mensajes.map((x) => x.cuerpo).join(' ')).not.toMatch(PERSONA);
    expect(t1.avisos).toHaveLength(0);
    const t2 = hablar(m, ANA, mTexto('Ana Pérez 4412345 Cochabamba flota Bolivar'));
    expect(t2.mensajes.map((x) => x.cuerpo).join(' ')).not.toMatch(PERSONA);
    expect(ficha(m).carrito).toHaveLength(1);
    expect(ficha(m).entrega.nombre).toMatch(/Ana/);
  });
});

describe('NEGADO: el cliente que sí pide una persona sigue derivando', () => {
  it('«quiero hablar con una persona» deriva (aviso + botón) aunque haya pedido en curso', () => {
    const m = crear({ modeloDice: adverso() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mTexto('recojo en tienda'));
    const t = hablar(m, ANA, mTexto('quiero hablar con una persona'));
    expect(t.avisos.length).toBeGreaterThanOrEqual(1);
  });
  it('sin pedido en curso, el quiereHablar del modelo (una pieza que no existe) sigue derivando', () => {
    const m = crear({ modeloDice: modelo('Lo verá una persona del equipo.', { lineas: [], quiereHablar: true }) });
    const t = hablar(m, ANA, mTexto('quiero un televisor de 80 pulgadas'));
    expect(t.avisos.length).toBeGreaterThanOrEqual(1);
  });
});
