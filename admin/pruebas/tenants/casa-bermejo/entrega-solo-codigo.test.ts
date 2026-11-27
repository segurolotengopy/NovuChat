/**
 * DECISIÓN DE ANDRES (26/11/2026): en los pasos de DATOS de la entrega (departamento, región, provincia, ciudad y aclaración, nombre y documento, nombre del retiro) y en el RESUMEN con «Confirmar pedido»,
 * el mensaje al cliente lo escribe SOLO EL CÓDIGO (la pregunta fija del paso o el resumen); el texto del modelo no se envía. Se decide por estado, sin listas de palabras.
 * La CONTRAPRUEBA: un modelo cuyo texto es un MARCADOR reconocible; en ningún mensaje de un turno de entrega puede aparecer. Fuera de la entrega el asistente conversa como siempre (el marcador sí sale).
 * Mensajes por conversación: 0 agregados, 0 quitados (solo cambia quién escribe el texto).
 */
import { describe, expect, it } from 'vitest';
import { ANA, ARGENTINO, CATALOGO, catalogoOk, crear, hablar, mLista, mTexto, mToque, modeloSano, type Opciones } from './mundo';

type Mund = ReturnType<typeof crear>;
const MARCADOR = 'MARCADOR-DEL-MODELO-QZX';
const cuerpos = (t: ReturnType<typeof hablar>): string => t.mensajes.map((x) => x.cuerpo).join(' | ');
const itemAr = { ...CATALOGO[1], moneda: 'ARS', precio: 450000, precioCentavos: 45000000, stock: 10, disponible: true };
const modeloMarcador = (): Opciones['modeloDice'] => modeloSano((t) => ({ nombre: t }), MARCADOR) as Opciones['modeloDice'];
const modeloMarcadorDato = (): Opciones['modeloDice'] => modeloSano((t) => ({ nombre: t }), MARCADOR + ' Deme su teléfono y su dirección.') as Opciones['modeloDice'];

const turnos = (m: Mund, tel: string, msgs: Record<string, unknown>[]): string[] => msgs.map((x) => cuerpos(hablar(m, tel, x)));

for (const [nombre, modeloDe] of [['sano', modeloMarcador], ['«dato» (pide dato prohibido)', modeloMarcadorDato]] as const) {
  describe(`el texto del modelo no sale en un turno de entrega (modelo ${nombre})`, () => {
    it('envío Bolivia: lista, ciudad, nombre y cédula, resumen, y un «gracias» con el pedido listo', () => {
      const m = crear({ modeloDice: modeloDe() });
      hablar(m, ANA, mTexto('quiero una billetera'));
      const t = turnos(m, ANA, [mToque('entrega:envio', 'Envío'), mTexto('hola'), mLista('dep:cb', 'Cochabamba'), mTexto('gracias'), mTexto('Cochabamba'), mTexto('Ana Pérez'), mTexto('Ana Pérez 4412345'), mTexto('gracias')]);
      for (const x of t) expect(x).not.toContain(MARCADOR);
      expect(t[7]).toMatch(/confirmar/i);
    });
    it('envío Argentina: región, provincia, ciudad, nombre y DNI, resumen', () => {
      const m = crear({ modeloDice: modeloDe(), base: {}, catalogo: catalogoOk({ mercado: 'AR', moneda: 'ARS' }, [itemAr] as never) });
      hablar(m, ARGENTINO, mTexto('quiero una billetera'));
      const t = turnos(m, ARGENTINO, [mToque('entrega:envio', 'Envío'), mLista('reg:centro', 'Centro'), mLista('prov:ar-x', 'Córdoba'), mTexto('Córdoba'), mTexto('Ana Pérez 30123456'), mTexto('hola')]);
      for (const x of t) expect(x).not.toContain(MARCADOR);
    });
    it('retiro: nombre y resumen', () => {
      const m = crear({ modeloDice: modeloDe() });
      hablar(m, ANA, mTexto('quiero una billetera'));
      const t = turnos(m, ANA, [mToque('entrega:retiro', 'Recojo en tienda'), mTexto('hola'), mTexto('Ana Pérez'), mTexto('gracias')]);
      for (const x of t) expect(x).not.toContain(MARCADOR);
    });
  });
}

describe('fuera de la entrega el asistente conversa como siempre (control de la contraprueba)', () => {
  it('con piezas y sin modo elegido, el texto del modelo sale: el marcador es detectable', () => {
    const m = crear({ modeloDice: modeloMarcador() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    expect(cuerpos(hablar(m, ANA, mTexto('hola')))).toContain(MARCADOR);
  });
});
