/**
 * BOTONES DE ENTREGA (Andres, 24/11/2026; bloque B2): cuando lo ÚNICO que falta del pedido es el modo de entrega, el MISMO mensaje del turno lleva «Recojo en tienda» y «Envío» (0 mensajes más).
 * Tocar uno lo anota POR CÓDIGO, sin llamar al modelo; si con eso el pedido queda completo sale el resumen con «Confirmar pedido», y tocarlo emite el QR en el mismo turno. Se prueba NEGANDO:
 * un id inventado, un modo que el comercio no ofrece, un pedido vacío, un QR abierto o un modo ya elegido NO cambian nada; y NUNCA se le pide escribir «pagar».
 */
import { describe, expect, it } from 'vitest';
import { ANA, crear, hablar, mTexto, modelo, panelConQr, type Opciones } from './mundo';

const J = (x: unknown): string => JSON.stringify(x);
type Ficha = { carrito: unknown[]; entrega: { modo: string; nombre: string }; pedidos: number };
const ficha = (m: ReturnType<typeof crear>): Ficha => (m.sd['casabermejo'] as Record<string, Ficha>)[ANA]!;
const mToque = (id: string, title: string) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const hayQr = (t: ReturnType<typeof hablar>): boolean => t.mensajes.some((x) => x.tipo === 'image' && /qr/i.test(J(x.payload)));
const botonesDe = (t: ReturnType<typeof hablar>): { id: string; title: string }[] =>
  t.mensajes.flatMap((x) => ((x.payload['interactive'] as { action?: { buttons?: { reply: { id: string; title: string } }[] } } | undefined)?.action?.buttons ?? []).map((b) => b.reply));
const SIN_MODO: Opciones = { modeloDice: modelo('Con gusto, lo anoto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: { nombre: 'Ana Pérez' } }) };
const llamadasAlModelo = (m: ReturnType<typeof crear>): { n: number } => {
  const c = { n: 0 };
  const previo = m.dobles['Conversar con el modelo'];
  m.dobles['Conversar con el modelo'] = (...a: unknown[]) => { c.n++; return (previo as (...x: unknown[]) => unknown)(...a); };
  return c;
};
const TEXTO_PAGAR = /escr[ií]b\w*\s+(?:\w+\s+){0,3}«?"?pagar/i;

describe('cuando solo falta el modo, el mismo mensaje lleva los dos botones', () => {
  it('1 mensaje, con «Recojo en tienda» (entrega:retiro) y «Envío» (entrega:envio), títulos de a lo más 20 y sin «Confirmar pedido»', () => {
    const m = crear(SIN_MODO);
    const t = hablar(m, ANA, mTexto('una billetera'));
    expect(t.mensajes).toHaveLength(1);
    expect(botonesDe(t)).toEqual([{ id: 'entrega:retiro', title: 'Recojo en tienda' }, { id: 'entrega:envio', title: 'Envío' }]);
    for (const b of botonesDe(t)) expect(b.title.length).toBeLessThanOrEqual(20);
    expect(J(t.mensajes[0]!.payload)).not.toContain('pedido:confirmar');
    expect(t.mensajes[0]!.cuerpo).not.toMatch(TEXTO_PAGAR);
  });
  it('NEGADO: si falta algo MÁS que el modo (sin piezas, o sin nombre y sin modo… con modo ya elegido) NO hay botones de entrega', () => {
    const m = crear({ modeloDice: modelo('Hola, ¿qué busca?') });
    expect(botonesDe(hablar(m, ANA, mTexto('hola')))).toEqual([]);
    const m2 = crear({ modeloDice: modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: { modo: 'Retiro en tienda' } }) });
    expect(botonesDe(hablar(m2, ANA, mTexto('una billetera'))).some((b) => b.id.startsWith('entrega:'))).toBe(false);
  });
  it('NEGADO: un comercio que NO ofrece envío solo ofrece el botón que puede cumplir', () => {
    const m = crear({ ...SIN_MODO, base: { modosDeEntrega: 'Retiro en tienda' } });
    expect(botonesDe(hablar(m, ANA, mTexto('una billetera'))).map((b) => b.id)).toEqual(['entrega:retiro']);
  });
});

describe('el toque de un botón de entrega lo decide el CÓDIGO, sin modelo', () => {
  it('«Recojo en tienda» escribe el modo (el de la lista del comercio); con el nombre ya dicho, el pedido queda completo: resumen + «Confirmar pedido», 1 mensaje, 0 llamadas al modelo', () => {
    const m = crear(SIN_MODO);
    hablar(m, ANA, mTexto('una billetera'));
    const c = llamadasAlModelo(m);
    const t = hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    expect(c.n).toBe(0);
    expect((t as unknown as { resumen: { resumen: { llamadasModelo: number } } }).resumen.resumen.llamadasModelo).toBe(0);
    expect(t.mensajes).toHaveLength(1);
    expect(ficha(m).entrega.modo).toBe('Retiro en tienda');
    expect(botonesDe(t).map((b) => b.title)).toEqual(['Confirmar pedido']);
    expect(t.mensajes[0]!.cuerpo).toMatch(/Billetera de cuero/);
    expect(t.mensajes[0]!.cuerpo).not.toMatch(TEXTO_PAGAR);
    expect(hayQr(t)).toBe(false);
  });
  it('de punta a punta: botón de entrega → «Confirmar pedido» → el QR sale EN EL MISMO TURNO del toque, y ninguno de los dos llama al modelo', () => {
    const m = crear(SIN_MODO);
    hablar(m, ANA, mTexto('una billetera'));
    const c = llamadasAlModelo(m);
    const t1 = hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    const id = botonesDe(t1)[0]!.id;
    expect(id).toMatch(/^pedido:confirmar:[a-z0-9]+$/);
    const t2 = hablar(m, ANA, mToque(id, 'Confirmar pedido'));
    expect(hayQr(t2)).toBe(true);
    expect(c.n).toBe(0);
  });
  it('«Envío» escribe el modo y pregunta por lo que falta (no completa el pedido): sin «Confirmar pedido» y sin QR', () => {
    const m = crear(SIN_MODO);
    hablar(m, ANA, mTexto('una billetera'));
    const t = hablar(m, ANA, mToque('entrega:envio', 'Envío'));
    expect(ficha(m).entrega.modo).toBe('Envío');
    expect(botonesDe(t)).toEqual([]);
    expect(t.mensajes[0]!.cuerpo).toMatch(/carnet de identidad|ciudad de destino|flota/i);
    expect(hayQr(t)).toBe(false);
  });
});

describe('NEGADO: lo que NO es un botón de entrega de este comercio no cambia nada', () => {
  const sinCambio = (m: ReturnType<typeof crear>, id: string, antes: Ficha) => {
    const c = llamadasAlModelo(m);
    const t = hablar(m, ANA, mToque(id, 'Hacker'));
    expect(c.n, id).toBe(0);
    expect(ficha(m).entrega, id).toEqual(antes.entrega);
    expect(ficha(m).carrito, id).toEqual(antes.carrito);
    expect(hayQr(t), id).toBe(false);
    return t;
  };
  it('`entrega:x`, `entrega:`, `ENTREGA:RETIRO` o `entrega:retiro2`: ni el modo ni el pedido cambian, sin QR y sin modelo', () => {
    for (const id of ['entrega:x', 'entrega:', 'entrega:Retiro', 'ENTREGA:RETIRO', 'entrega:retiro2', 'entrega:envio ']) {
      const m = crear(SIN_MODO);
      hablar(m, ANA, mTexto('una billetera'));
      const antes = JSON.parse(J(ficha(m))) as Ficha;
      sinCambio(m, id, antes);
      expect(ficha(m).entrega.modo, id).toBe('');
    }
  });
  it('un modo que el comercio no ofrece (solo retiro): «Envío» no escribe nada', () => {
    const m = crear({ ...SIN_MODO, base: { modosDeEntrega: 'Retiro en tienda' } });
    hablar(m, ANA, mTexto('una billetera'));
    const antes = JSON.parse(J(ficha(m))) as Ficha;
    sinCambio(m, 'entrega:envio', antes);
    expect(ficha(m).entrega.modo).toBe('');
  });
  it('sin carrito (el botón es de un mensaje viejo): no inventa un pedido, no emite QR y pide una pieza', () => {
    const m = crear({ modeloDice: modelo('Hola.') });
    const c = llamadasAlModelo(m);
    const t = hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    expect(c.n).toBe(0);
    expect(ficha(m).carrito).toEqual([]);
    expect(ficha(m).entrega.modo).toBe('');
    expect(hayQr(t)).toBe(false);
    expect(t.mensajes[0]!.cuerpo).toMatch(/pedido anterior que ya no está en curso/);
  });
  it('un modo ya elegido no se pisa con un botón viejo', () => {
    const m = crear(SIN_MODO);
    hablar(m, ANA, mTexto('una billetera'));
    hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    const antes = JSON.parse(J(ficha(m))) as Ficha;
    sinCambio(m, 'entrega:envio', antes);
    expect(ficha(m).entrega.modo).toBe('Retiro en tienda');
  });
  it('con un QR abierto el botón no cambia la entrega ni abre otro QR', () => {
    const m = crear(SIN_MODO);
    hablar(m, ANA, mTexto('una billetera'));
    m.dobles['Traer configuración'] = () => panelConQr(450);
    const antes = JSON.parse(J(ficha(m))) as Ficha;
    sinCambio(m, 'entrega:retiro', antes);
  });
});

describe('NUNCA se le pide escribir «pagar» (Andres, 23/11/2026), en ningún trato ni camino', () => {
  const ENTREGA_LISTA = { modo: 'Retiro en tienda', nombre: 'Ana Pérez' };
  const todo = (t: ReturnType<typeof hablar>): string => [...t.mensajes.map((x) => x.cuerpo), ...t.mensajes.map((x) => J(x.payload))].join(' ');
  for (const usted of [false, true]) {
    const base = { tratamiento: usted ? 'usted' : 'tu' };
    it(`${usted ? 'usted' : 'tuteo'}: pedido listo (redacción del modelo rechazada → texto del código), con el botón y con un QR abierto, ningún texto lo pide`, () => {
      // La redacción del modelo habla de un «descuento» (prohibido): sale el texto de estado del código.
      const m = crear({ base, modeloDice: modelo('Tenemos un descuento especial.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA_LISTA }) });
      const t1 = hablar(m, ANA, mTexto('una billetera'));
      expect(botonesDe(t1).map((b) => b.title)).toEqual(['Confirmar pedido']);
      expect(todo(t1)).not.toMatch(TEXTO_PAGAR);
      // El cliente confirma con el botón (el QR sale de verdad y la ficha guarda el carrito del QR); luego el servidor dice que el QR sigue abierto.
      expect(hayQr(hablar(m, ANA, mToque(botonesDe(t1)[0]!.id, 'Confirmar pedido')))).toBe(true);
      m.dobles['Traer configuración'] = () => panelConQr(450);
      const t2 = hablar(m, ANA, mTexto('gracias'));
      expect(t2.mensajes).toHaveLength(1);
      expect(todo(t2)).toMatch(/QR abierto/);
      expect(todo(t2)).not.toMatch(TEXTO_PAGAR);
      expect(todo(t2)).not.toMatch(/Confirmar pedido/);
    });
  }
});
