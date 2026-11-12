/**
 * EL AVISO DE UN DEFECTO DEL CATÁLOGO en el flujo de Casa Bermejo: cuando NovuTienda falla por un DEFECTO (clave rechazada, formato, moneda, país), el aviso de derivación que YA sale al comercio lleva la causa y qué hacer,
 * a lo más una vez por causa cada 6 h (tope global, en datos estáticos, anotado solo si el aviso salió con un `wamid` real). 0 nodos nuevos y 0 mensajes agregados: el cliente final recibe lo mismo que con una caída transitoria.
 * Se prueba NEGANDO: lo transitorio no alerta, lo repetido no alerta, un aviso que no salió no consume el tope, y nada filtra un secreto.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import { ANA, BETO, PRODUCCION, PRUEBA, REC, catalogoOk, crear, hablar, mTexto, valorMeta, type Opciones } from './mundo';

const tel = (n: number): string => `591000000${String(n).padStart(2, '0')}`;
const TEXTOS: Record<string, string> = {
  credencial: 'Catálogo caído: NovuTienda rechazó la clave de acceso. Pide a NovuChat que la renueve',
  version_no_soportada: 'Catálogo caído: NovuTienda cambió el formato de su respuesta. Avisa a NovuChat',
  respuesta_invalida: 'Catálogo caído: la respuesta de NovuTienda no se puede leer. Avisa a NovuChat',
  moneda_distinta: 'Catálogo caído: NovuTienda envió precios en otra moneda. Avisa a NovuChat',
  mercado_invalido: 'Catálogo caído: NovuTienda no reconoce el país pedido. Avisa a NovuChat',
};
const DEFECTOS: Record<string, Opciones['catalogo']> = {
  credencial: { statusCode: 401, body: { error: 'no_autorizado' } },
  mercado_invalido: { statusCode: 400, body: { error: 'mercado' } },
  respuesta_invalida: { statusCode: 200, body: { cosa: 'rara' } },
  version_no_soportada: catalogoOk({ version: 2 }),
  moneda_distinta: catalogoOk({ moneda: 'USD' }),
};
const TRANSITORIOS: Record<string, Opciones['catalogo']> = {
  '503': { statusCode: 503, body: { error: 'sin_cotizacion' } },
  '500': { statusCode: 500, body: { error: 'interno' } },
  '429': { statusCode: 429, body: { error: 'limite' } },
  timeout: { error: 'timeout' } as never,
};
const CAIDO = 'quiero una billetera';
const VARS = (a: { payload: J }): string[] => ((a.payload['template'] as J)['components'] as J[])[0]!['parameters'].map((p: { text: string }) => p.text); // eslint-disable-line @typescript-eslint/no-explicit-any
const primero = (t: ReturnType<typeof hablar>): string => VARS(t.avisos[0]!)[0]!;
const GENERICO = 'Consulta: el asistente no pudo leer el catálogo o la configuración';
const marcas = (m: ReturnType<typeof crear>): Record<string, number> => (m.sd['casabermejoAlertas'] ?? {}) as Record<string, number>;
const MIN = 60_000;

describe('un defecto del catálogo lleva su causa en el aviso que ya sale', () => {
  it('A1 NEGADO: con el catálogo bien no hay «Catálogo caído» ni marca', () => {
    const m = crear();
    const t = hablar(m, ANA, mTexto('quiero hablar con una persona'));
    expect(t.avisos).toHaveLength(1);
    expect(primero(t)).not.toMatch(/Catálogo caído/);
    expect(m.sd['casabermejoAlertas']).toBeUndefined();
  });
  for (const [nombre, cat] of Object.entries(TRANSITORIOS)) {
    it(`A2 NEGADO: una caída transitoria (${nombre}) avisa con el motivo genérico y no deja marca`, () => {
      const m = crear({ catalogo: cat });
      const t = hablar(m, ANA, mTexto(CAIDO));
      expect(t.avisos).toHaveLength(1);
      expect(primero(t)).toBe(GENERICO);
      expect(m.sd['casabermejoAlertas']).toBeUndefined();
    });
  }
  for (const [motivo, cat] of Object.entries(DEFECTOS)) {
    it(`A3 el defecto «${motivo}»: 1 aviso con su texto, 1 mensaje al cliente y la marca`, () => {
      const m = crear({ catalogo: cat });
      const t = hablar(m, ANA, mTexto(CAIDO));
      expect(t.avisos).toHaveLength(1);
      expect(t.mensajes).toHaveLength(1);
      expect(VARS(t.avisos[0]!)[0]).toBe('Consulta: ' + TEXTOS[motivo]);
      expect(marcas(m)[motivo]).toBe(m.ahora());
    });
  }
  it('A4 no repite: el mismo defecto con otro teléfono, a +1 minuto y a +5 h, lleva el motivo genérico', () => {
    const m = crear({ catalogo: DEFECTOS['credencial'] });
    expect(primero(hablar(m, ANA, mTexto(CAIDO)))).toBe('Consulta: ' + TEXTOS['credencial']);
    const t2 = hablar(m, tel(1), mTexto(CAIDO));
    expect(t2.avisos).toHaveLength(1);
    expect(primero(t2)).toBe(GENERICO);
    m.avanzar(5 * 60 - 2);   // cada turno suma 1 minuto: este llega a +5 h
    expect(primero(hablar(m, tel(2), mTexto(CAIDO)))).toBe(GENERICO);
  });
  it('A5 una causa distinta sí avisa y quedan las dos marcas', () => {
    const m = crear({ catalogo: DEFECTOS['credencial'] });
    hablar(m, ANA, mTexto(CAIDO));
    m.dobles['Traer catálogo'] = () => DEFECTOS['moneda_distinta'] as never;
    expect(primero(hablar(m, tel(1), mTexto(CAIDO)))).toBe('Consulta: ' + TEXTOS['moneda_distinta']);
    expect(Object.keys(marcas(m)).sort()).toEqual(['credencial', 'moneda_distinta']);
  });
  it('A6 a 359 minutos sigue el genérico; a 360 vuelve la causa y la marca se actualiza', () => {
    const m = crear({ catalogo: DEFECTOS['credencial'] });
    hablar(m, ANA, mTexto(CAIDO));
    const inicio = m.ahora();
    // Cada turno adelanta el reloj 1 minuto por sí solo: 358 + 1 = 359 minutos; el turno siguiente llega a los 360.
    m.avanzar(358);
    expect(primero(hablar(m, tel(1), mTexto(CAIDO)))).toBe(GENERICO);
    expect(marcas(m)['credencial']).toBe(inicio);
    expect(primero(hablar(m, tel(2), mTexto(CAIDO)))).toBe('Consulta: ' + TEXTOS['credencial']);
    expect(marcas(m)['credencial']).toBe(inicio + 360 * MIN);
  });
  it('A7 con el destinatario dentro de su ventana, el texto libre lleva la causa', () => {
    const m = crear({ catalogo: DEFECTOS['credencial'] });
    hablar(m, REC, mTexto('hola'));
    const t = hablar(m, ANA, mTexto(CAIDO));
    expect(t.avisos).toHaveLength(1);
    expect(t.avisos[0]!.tipo).toBe('text');
    expect(t.avisos[0]!.cuerpo).toContain('Motivo: ' + TEXTOS['credencial'] + '.');
  });
  it('A8 NEGADO: si el aviso no sale (envío con error, red caída o plantilla sin aprobar) no queda marca', () => {
    for (const falla of [{ aviso: 'error' as const }, { aviso: 'lanza' as const }, { base: { avisoPedidoEstado: 'PENDING' } }]) {
      const m = crear({ catalogo: DEFECTOS['credencial'], ...falla });
      hablar(m, ANA, mTexto(CAIDO));
      expect(m.sd['casabermejoAlertas']).toBeUndefined();
    }
  });
  it('A8 NEGADO: tras un envío fallido, el siguiente teléfono lleva la causa y entonces sí queda la marca', () => {
    const m = crear({ catalogo: DEFECTOS['credencial'] });
    m.dobles['Enviar aviso'] = () => ({ error: { message: '(#131047) fuera de la ventana', code: 131047 } });
    hablar(m, ANA, mTexto(CAIDO));
    expect(m.sd['casabermejoAlertas']).toBeUndefined();
    m.dobles['Enviar aviso'] = (ll) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.AVISO${ll.n}` }] });
    const t = hablar(m, BETO, mTexto(CAIDO));
    expect(primero(t)).toBe('Consulta: ' + TEXTOS['credencial']);
    expect(marcas(m)['credencial']).toBe(m.ahora());
  });
  it('A9 el cliente final recibe lo mismo (textos y tipos) que con una caída transitoria, con causa y sin ella', () => {
    const forma = (t: ReturnType<typeof hablar>) => t.mensajes.map((x) => [x.tipo, x.cuerpo]);
    const mb = crear({ catalogo: TRANSITORIOS['503'] });
    const base = hablar(mb, ANA, mTexto(CAIDO));
    mb.avanzar(31);
    const baseSiguiente = hablar(mb, ANA, mTexto(CAIDO));
    const m = crear({ catalogo: DEFECTOS['credencial'] });
    const conCausa = hablar(m, ANA, mTexto(CAIDO));
    m.avanzar(31);
    const siguiente = hablar(m, ANA, mTexto(CAIDO));
    expect(forma(conCausa)).toEqual(forma(base));
    expect(forma(siguiente)).toEqual(forma(baseSiguiente));
    expect(conCausa.mensajes).toHaveLength(1);
  });
  it('A10 sin secretos: ni el aviso ni lo que ve el cliente llevan Bearer, enlaces, marcadores ni la consulta del mercado', () => {
    for (const cat of Object.values(DEFECTOS)) {
      const m = crear({ catalogo: cat });
      const t = hablar(m, ANA, mTexto(CAIDO));
      const todo = JSON.stringify([t.avisos.map((a) => a.payload), t.mensajes.map((x) => x.cuerpo)]);
      expect(todo).not.toMatch(/Bearer|REEMPLAZAR_|\?mercado|"error"|no_autorizado/);
      expect(t.avisos.map((a) => a.cuerpo).join(' ')).not.toMatch(/https?:/);
    }
  });
  it('A11 variante de prueba: el aviso va al teléfono de prueba con la causa y la marca queda solo en su mundo', () => {
    const w = crear({ flujo: PRUEBA, catalogo: DEFECTOS['credencial'] });
    const prod = crear({ catalogo: DEFECTOS['credencial'] });
    const t = w.turno({ headers: {}, body: { modoPrueba: true, telefonoDePrueba: BETO, enviarDeVerdad: true, ...valorMeta(mTexto(CAIDO), ANA) } });
    expect(t.fallo).toBeNull();
    expect(t.avisos).toHaveLength(1);
    expect(t.avisos[0]!.a).toBe(BETO);
    expect(VARS(t.avisos[0]!)[0]).toBe('Consulta: ' + TEXTOS['credencial']);
    expect(marcas(w)['credencial']).toBeGreaterThan(0);
    expect(prod.sd['casabermejoAlertas']).toBeUndefined();
  });
  it('NEGADO: en la variante de prueba SIN envío de verdad no queda marca (una corrida en seco no gasta el tope)', () => {
    const w = crear({ flujo: PRUEBA, catalogo: DEFECTOS['credencial'] });
    const t = w.turno({ headers: {}, body: { modoPrueba: true, telefonoDePrueba: BETO, enviarDeVerdad: false, ...valorMeta(mTexto(CAIDO), ANA) } });
    expect(t.fallo).toBeNull();
    expect(w.sd['casabermejoAlertas']).toBeUndefined();
  });
  it('el flujo no crece: 57 nodos en producción y 52 en prueba', () => {
    expect(PRODUCCION.nodes).toHaveLength(57);
    expect(PRUEBA.nodes).toHaveLength(52);
  });
});
