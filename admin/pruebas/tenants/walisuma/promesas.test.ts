/**
 * SOLO SE OFRECE LO QUE SE CUMPLE (política de NovuChat, 21/09/2026) en el flujo de Walisuma: ante un error, una consulta sin respuesta, una pieza sin precio o un pedido por volumen, lo único que se ofrece es pasar con
 * recepción —el aviso al comercio MÁS el botón para escribirle directo—. Nunca «te aviso luego», «te llamamos» ni «te escribirán». «Ya avisé» solo con un `wamid` real. Se prueba NEGANDO.
 */
import { describe, expect, it } from 'vitest';
import { ANA, REC, crear, hablar, mTexto, modelo, textos, type Opciones } from './mundo';

const PROMESA = /te aviso|te avisar|te avisamos|te llamamos|te llamar|te escribir|te escribiremos|se comunicar|nos comunicaremos|lo consulto|lo consultamos|te contactar|te confirmamos luego|más tarde te/i;
const BOTON = (t: ReturnType<typeof hablar>): boolean => t.mensajes.some((x) => (x.payload['interactive'] as any)?.type === 'cta_url' && String((x.payload['interactive'] as any).action.parameters.url).includes(REC)); // eslint-disable-line @typescript-eslint/no-explicit-any
const deriva = (o: Opciones, texto: string) => hablar(crear(o), ANA, mTexto(texto));

describe('el error del modelo, la pieza sin precio y el volumen pasan con recepción: aviso Y botón', () => {
  const casos: [string, Opciones, string][] = [
    ['el modelo cae (503)', { modeloDice: 'cae' }, 'quiero una billetera'],
    ['el modelo no devuelve texto', { modeloDice: null }, 'quiero una billetera'],
    ['el modelo devuelve algo que no es JSON', { modeloDice: 'lo siento, no sé' }, 'quiero una billetera'],
    ['un tapiz sin precio', {}, 'quiero el tapiz mujer río'],
    ['«tapices» en general', {}, '¿cuánto cuestan los tapices?'],
    ['regalos corporativos', {}, 'necesito regalos corporativos para mi empresa'],
    ['300 piezas', {}, 'quiero 300 bufandas'],
    ['pide factura', {}, 'necesito factura con mi NIT'],
    ['pide hablar con una persona', {}, 'quiero hablar con una persona'],
    ['el modelo marca quiereHablar', { modeloDice: modelo('Lo ve una persona.', { quiereHablar: true }) }, 'quiero algo especial hecho a medida'],
  ];
  for (const [nombre, o, texto] of casos) {
    it(`${nombre}: exactamente UN mensaje, con el botón de recepción, y UN aviso al comercio`, () => {
      const t = deriva(o, texto);
      expect(t.mensajes).toHaveLength(1);
      expect(BOTON(t)).toBe(true);
      expect(t.avisos).toHaveLength(1);
      expect(t.mensajes[0]?.cuerpo).toMatch(/Ya avisé a recepción/);
      expect(t.mensajes[0]?.cuerpo).not.toMatch(PROMESA);
    });
  }
  it('la pieza sin precio NO llama al modelo ni inventa un precio', () => {
    const t = deriva({}, 'quiero el tapiz mujer río 66 x 31');
    expect(t.registro.map((r) => r.nodo)).not.toContain('Conversar con el modelo');
    expect(textos(t).join(' ')).not.toMatch(/Bs\s*\d|\d\s*Bs/);
  });
});

describe('«ya avisé» solo con un wamid real', () => {
  it('NEGADO: si Meta rechaza el aviso, el cliente lee que no se pudo avisar y el botón (no «ya avisé»)', () => {
    const t = deriva({ aviso: 'error' }, 'quiero hablar con una persona');
    expect(t.mensajes[0]?.cuerpo).not.toMatch(/Ya avisé/);
    expect(t.mensajes[0]?.cuerpo).toMatch(/No pude avisar a recepción/);
    expect(BOTON(t)).toBe(true);
  });
  it('NEGADO: si la red del aviso cae, tampoco', () => {
    const t = deriva({ aviso: 'lanza' }, 'quiero hablar con una persona');
    expect(t.mensajes[0]?.cuerpo).not.toMatch(/Ya avisé/);
    expect(BOTON(t)).toBe(true);
  });
  it('NEGADO: sin plantilla aprobada (y fuera de la ventana del comercio) no hay aviso y no se dice que se avisó', () => {
    const t = deriva({ base: { avisoPedidoEstado: 'PENDING' } }, 'quiero hablar con una persona');
    expect(t.avisos).toHaveLength(0);
    expect(t.mensajes[0]?.cuerpo).not.toMatch(/Ya avisé/);
    expect(BOTON(t)).toBe(true);
  });
  it('a lo más UN aviso de consulta cada 30 minutos: el segundo dice que recepción ya lo recibió', () => {
    const m = crear();
    expect(hablar(m, ANA, mTexto('quiero hablar con una persona')).avisos).toHaveLength(1);
    const t2 = hablar(m, ANA, mTexto('necesito factura'));
    expect(t2.avisos).toHaveLength(0);
    expect(t2.mensajes[0]?.cuerpo).toMatch(/ya recibió tu aviso anterior/);
    expect(t2.mensajes[0]?.cuerpo).not.toMatch(/Ya avisé a recepción;/);
  });
});

describe('el modelo no promete lo que no se cumple', () => {
  for (const promesa of ['Te aviso luego cuando tengamos novedades.', 'Te llamamos mañana para confirmar.', 'Un asesor se comunicará contigo.', 'Lo consulto con el equipo y te escribo.', 'Te avisaremos apenas llegue.']) {
    it(`NEGADO: «${promesa}» no sale`, () => {
      const t = hablar(crear({ modeloDice: modelo(promesa) }), ANA, mTexto('¿tienen más modelos?'));
      expect(textos(t).join(' ')).not.toMatch(PROMESA);
    });
  }
  it('NEGADO: afirmar que el pedido está cerrado, pagado o enviado tampoco', () => {
    for (const falso of ['Tu pedido ya quedó cerrado y enviado.', 'Ya compraste tu bufanda, te la enviamos.', 'Tu compra está confirmada.']) {
      const t = hablar(crear({ modeloDice: modelo(falso) }), ANA, mTexto('hola'));
      expect(textos(t).join(' ')).not.toMatch(/cerrado y enviado|ya compraste|compra est[aá] confirmada|te la enviamos/i);
    }
  });
  it('sin QR de cobro real, el pedido queda anotado y recepción lo coordina: aviso con «sin comprobante aún» y el botón', async () => {
    const { panelSinCobro, ENTREGA } = await import('./mundo');
    const m = crear({ panel: panelSinCobro(), modeloDice: modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA }) });
    hablar(m, ANA, mTexto('una billetera'));
    const t = hablar(m, ANA, mTexto('quiero pagar'));
    expect(t.mensajes.every((x) => x.tipo !== 'image')).toBe(true);
    expect(t.avisos).toHaveLength(1);
    const vars = (t.avisos[0]?.payload['template'] as any).components[0].parameters.map((p: { text: string }) => p.text); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(vars[3]).toBe('sin comprobante aún');
    expect(t.mensajes[0]?.cuerpo).toMatch(/el pago por QR no está disponible/);
    expect(t.mensajes[0]?.cuerpo).toMatch(/Ya avisé a recepción/);
    expect(BOTON(t)).toBe(true);
  });
});
