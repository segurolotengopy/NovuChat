/**
 * RONDA 10 de Casa Bermejo (26/11/2026), revisión independiente de los datos del envío. Cada punto trae su caso sano y su caso NEGADO (adverso), sin listas negras nuevas.
 *  (e) el texto del modelo que PIDE dirección, teléfono, ubicación o flota no sale: sale la pregunta del paso vigente (filtro en código, no en el prompt);
 *  (d1) una ficha viva con `cierre: true` no emite un QR ante un «hola»: el QR sale solo en el turno en que se confirma;
 *  (b3) el documento con letras («LP4412345», «4412345-1A») se guarda completo y no recorta el nombre;
 *  (c) una ficha vieja con `pide` «ciudad» pide primero el departamento;
 *  (a) DECIDIDO por Andres: el nombre exacto de una opción escrito vale SOLO en el paso donde se mostró la lista (sin mayúsculas, tildes ni signos de borde), con igualdad de la opción ENTERA.
 * Mensajes por conversación: 0 agregados ni quitados.
 */
import { describe, expect, it } from 'vitest';
import { ANA, ARGENTINO, CATALOGO, catalogoOk, crear, hablar, mLista, modelo, modeloSano, mTexto, mToque, type Opciones } from './mundo';

type Mund = ReturnType<typeof crear>;
type Turno = ReturnType<typeof hablar>;
type Ficha = { entrega: Record<string, string>; pide: string[]; carrito: unknown[] };
const fichaDe = (m: Mund, tel = ANA): Ficha => (m.sd['casabermejo'] as Record<string, Ficha>)[tel]!;
const cuerpos = (t: Turno): string => t.mensajes.map((x) => x.cuerpo).join(' | ');
const hayQr = (t: Turno): boolean => t.mensajes.some((x) => x.tipo === 'image');
const itemAr = { ...CATALOGO[1], moneda: 'ARS', precio: 450000, precioCentavos: 45000000, stock: 10, disponible: true };
// Lo que el asistente NUNCA pide (el texto fijo del código dice «recoge el envío en la flota»: eso no es pedir la flota).
const PROHIBIDO = /direcci[oó]n (exacta|de (entrega|env[ií]o))|su direcci[oó]n|tel[eé]fono|comparta? (su|tu|la) ubicaci[oó]n|empresa de transporte|por qu[eé] flota|qu[eé] (flota|transporte)/i;

const conEnvio = (o: Opciones): Mund => { const m = crear(o); hablar(m, ANA, mTexto('quiero una billetera')); hablar(m, ANA, mToque('entrega:envio', 'Envío')); return m; };
const conCiudadPedida = (o: Opciones): Mund => { const m = conEnvio(o); hablar(m, ANA, mLista('dep:cb', 'Cochabamba')); return m; };
const conNombreYCiPedidos = (o: Opciones): Mund => { const m = conCiudadPedida(o); hablar(m, ANA, mTexto('Cochabamba, oficina Zona Sur')); return m; };
const sembrar = (m: Mund, f: Record<string, unknown>): void => { m.sd['casabermejo'] = { ...((m.sd['casabermejo'] as object) ?? {}), [ANA]: { ultimoMs: m.ahora() - 1000, carrito: [{ id: 'billetera-cuero', cantidad: 1, detalle: '' }], ...f } }; };

describe('(e) el texto del modelo no puede pedir dirección, teléfono, ubicación ni flota', () => {
  const PIDEN = ['Perfecto. ¿Me indica su dirección exacta y un teléfono de contacto?', 'Listo. ¿Por qué flota prefiere que lo enviemos?', 'Gracias. Comparta su ubicación, por favor.', 'Anotado. ¿Qué empresa de transporte prefiere?', 'Envíeme su dirección de entrega.'];
  for (const texto of PIDEN) {
    it(`NEGADO: «${texto}» no sale; sale la pregunta del paso (nombre y cédula)`, () => {
      const m = conCiudadPedida({ modeloDice: modeloSano(() => ({}), texto) as Opciones['modeloDice'] });
      const t = hablar(m, ANA, mTexto('Cochabamba'));
      expect(cuerpos(t)).not.toMatch(PROHIBIDO);
      expect(cuerpos(t)).toMatch(/nombre completo/i);
      expect(fichaDe(m).pide).toEqual(['nombre', 'documento']);
    });
    it(`NEGADO (retiro): «${texto}» no sale; sale la pregunta del nombre`, () => {
      const m = crear({ modeloDice: modeloSano(() => ({}), texto) as Opciones['modeloDice'] });
      hablar(m, ANA, mTexto('quiero una billetera'));
      const t = hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
      const u = hablar(m, ANA, mTexto('hola'));
      expect(cuerpos(t) + cuerpos(u)).not.toMatch(/direcci[oó]n exacta|tel[eé]fono|flota|transporte/i);
      expect(cuerpos(u)).toMatch(/a nombre de qui[eé]n/i);
    });
  }
  it('sano: un texto del modelo que no pide eso sale tal cual', () => {
    const m = conCiudadPedida({ modeloDice: modeloSano(() => ({}), 'Cochabamba es un destino muy querido por nuestros clientes.') as Opciones['modeloDice'] });
    expect(cuerpos(hablar(m, ANA, mTexto('Cochabamba')))).toContain('destino muy querido');
  });
});

describe('(d1) un `cierre: true` guardado no abre un cobro', () => {
  const ficha = { entrega: { modo: 'Retiro en tienda', nombre: 'Ana Pérez' }, cierre: true, pide: [] };
  it('NEGADO: ficha con cierre:true y retiro completo + «hola» no emite QR', () => {
    const m = crear({ modeloDice: modeloSano() as Opciones['modeloDice'] });
    sembrar(m, ficha);
    expect(hayQr(hablar(m, ANA, mTexto('hola')))).toBe(false);
  });
  it('sano (decidido, d2): con el pedido completo, «pagar» sigue valiendo en el mismo turno', () => {
    const m = crear({ modeloDice: modeloSano() as Opciones['modeloDice'] });
    sembrar(m, { ...ficha, cierre: false });
    expect(hayQr(hablar(m, ANA, mTexto('pagar')))).toBe(true);
  });
});

describe('(b3) el documento con letras se guarda completo y no recorta el nombre', () => {
  for (const [texto, documento] of [['Ana Pérez LP4412345', 'LP4412345'], ['Ana Pérez 4412345-1A', '4412345-1A'], ['Ana Pérez 4412345', '4412345'], ['Ana Pérez, CI 4412345', '4412345']] as const) {
    for (const mod of ['sano', 'dato'] as const) {
      it(`«${texto}» (${mod}): nombre «Ana Pérez» y documento «${documento}»`, () => {
        const m = conNombreYCiPedidos({ modeloDice: (mod === 'sano' ? modeloSano(() => ({ nombre: 'Ana Pérez' })) : () => modelo('Listo.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: { nombre: texto, documento: texto } })) as Opciones['modeloDice'] });
        hablar(m, ANA, mTexto(texto));
        expect(fichaDe(m).entrega).toMatchObject({ nombre: 'Ana Pérez', documento });
      });
    }
  }
  it('NEGADO: «Ana Pérez ABCDEF» (letras solas) no guarda un nombre con la clave pegada ni un documento', () => {
    const m = conNombreYCiPedidos({ modeloDice: ((): unknown => modelo('Listo.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: { nombre: 'Ana Pérez ABCDEF', documento: 'Ana Pérez ABCDEF' } })) as Opciones['modeloDice'] });
    hablar(m, ANA, mTexto('Ana Pérez ABCDEF'));
    expect(fichaDe(m).entrega['nombre']).toBe('');
    expect(fichaDe(m).entrega['documento']).toBe('');
  });
  it('NEGADO: un celular de 8 dígitos no es una cédula', () => {
    const m = conNombreYCiPedidos({ modeloDice: modeloSano(() => ({ nombre: 'Ana Pérez' })) as Opciones['modeloDice'] });
    hablar(m, ANA, mTexto('Ana Pérez 70012345'));
    expect(fichaDe(m).entrega['documento']).toBe('');
  });
});

describe('(c) una ficha vieja con `pide` «ciudad» pide primero el departamento', () => {
  it('NEGADO: envío sin departamento, pide [ciudad, flota] + «Cochabamba»: la ciudad queda vacía y se pide el departamento', () => {
    const m = crear({ modeloDice: modeloSano() as Opciones['modeloDice'] });
    sembrar(m, { entrega: { modo: 'Envío', nombre: 'Ana Pérez', documento: '4412345' }, pide: ['ciudad', 'flota'] });
    const t = hablar(m, ANA, mTexto('Cochabamba'));
    expect(fichaDe(m).entrega['ciudad']).toBe('');
    expect(fichaDe(m).pide).toEqual(['departamento']);
    expect(cuerpos(t)).toMatch(/departamento/i);
  });
});

describe('(a) DECIDIDO: el nombre exacto de la opción vale solo en el paso de la lista', () => {
  it('sano: en el paso del departamento, «La Paz», «la paz», «POTOSÍ» y «LA PAZ!!» fijan la opción entera (sin mayúsculas, tildes ni signos de borde)', () => {
    for (const [t, id] of [['La Paz', 'dep:lp'], ['la paz', 'dep:lp'], ['POTOSÍ', 'dep:pt'], ['LA PAZ!!', 'dep:lp'], ['  Cochabamba ', 'dep:cb']] as const) {
      const m = conEnvio({ modeloDice: modeloSano() as Opciones['modeloDice'] });
      hablar(m, ANA, mTexto(t));
      expect(fichaDe(m).entrega['departamento'], t).toBe(id);
    }
  });
  it('NEGADO: coincidencia PARCIAL o con más texto («La Paz y pago con QR», «vivo cerca de Cochabamba», «Departamento: La Paz», «dep:lp», «Cbba») no fija nada y se vuelve a mostrar la lista', () => {
    for (const t of ['La Paz y pago con QR', 'vivo cerca de Cochabamba', 'Departamento: La Paz', 'dep:lp', 'Cbba', 'La']) {
      const m = conEnvio({ modeloDice: modeloSano() as Opciones['modeloDice'] });
      const r = hablar(m, ANA, mTexto(t));
      expect(fichaDe(m).entrega['departamento'], t).toBe('');
      expect(fichaDe(m).pide, t).toEqual(['departamento']);
      expect(JSON.stringify(r.mensajes.map((x) => x.payload)), t).toContain('"list"');
    }
  });
  it('NEGADO: FUERA del paso (modo sin elegir, o ya capturado el departamento) el nombre de una opción no cambia el departamento', () => {
    const sinModo = crear({ modeloDice: modeloSano() as Opciones['modeloDice'] });
    hablar(sinModo, ANA, mTexto('quiero una billetera'));
    hablar(sinModo, ANA, mTexto('La Paz'));
    expect(fichaDe(sinModo).entrega['departamento']).toBe('');
    const yaPuesto = conCiudadPedida({ modeloDice: modeloSano() as Opciones['modeloDice'] });
    hablar(yaPuesto, ANA, mTexto('Potosí'));
    expect(fichaDe(yaPuesto).entrega['departamento']).toBe('dep:cb');
  });
  it('Argentina: la región escrita vale solo en su paso y la provincia solo en el suyo; el texto parcial no fija nada', () => {
    const m = crear({ modeloDice: modeloSano() as Opciones['modeloDice'], base: {}, catalogo: catalogoOk({ mercado: 'AR', moneda: 'ARS' }, [itemAr] as never) });
    hablar(m, ARGENTINO, mTexto('quiero una billetera'));
    hablar(m, ARGENTINO, mToque('entrega:envio', 'Envío'));
    const ar = (): Record<string, string> => fichaDe(m, ARGENTINO).entrega;
    hablar(m, ARGENTINO, mTexto('Centro y pago con QR'));
    expect(ar()['region']).toBe('');
    hablar(m, ARGENTINO, mTexto('Centro'));
    expect(ar()['region']).toBe('reg:centro');
    hablar(m, ARGENTINO, mTexto('NOA'));
    expect(ar()['region']).toBe('reg:centro');   // fuera de su paso (ya capturada) no se pisa
  });
});
