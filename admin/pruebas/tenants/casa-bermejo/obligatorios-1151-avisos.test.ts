/**
 * PR #1151, revisión del 28/11/2026, obligatorio 2 (Estándar 1.5; decisión de Andres «Remitir a Pedidos», 28/11/2026): por PLANTILLA, la nota larga del cliente NUNCA se corta en silencio.
 * La variable de los ítems lleva los ítems (a 400 PUNTOS DE CÓDIGO), « · » y la nota rotulada; la plantilla recorta todo a 500. Si la nota no cabe ENTERA (o la red común de palabras de cobro la altera), la parte de la nota pasa a ser la frase fija
 * «El cliente dejó una nota; léela entera en Pedidos de la Consola.» (sin plantilla nueva ni variable nueva). Por texto libre la nota sigue llegando entera. Nunca se parte un emoji ni un par sustituto. 0 mensajes agregados.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGO, REC, catalogoOk, completarEnvio, crear, hablar, modelo, mTexto, mToque } from './mundo';

const ARG = ['54', '9', '11', '5550', '0001'].join('');
const itemAr = { ...CATALOGO[1], moneda: 'ARS', precio: 450000, precioCentavos: 45000000, stock: 10, disponible: true };
const pegadoAr = (nota: string): string => `Hola, quiero comprar estos productos:\n1 x Billetera de cuero (cód. billetera-cuero): $ 450.000 c/u, subtotal $ 450.000\nTotal referencial: $ 450.000${nota === '' ? '' : '\nNota: ' + nota}`;
const ROTULO = 'Nota escrita por el cliente (no es un estado de pago): ';
const FRASE = 'El cliente dejó una nota; léela entera en Pedidos de la Consola.';
const puntos = (s: string): number => Array.from(s).length;

/** Un pedido de Argentina (sin QR: sale `pedido_sin_cobro` y el aviso a recepción). `ventana`: recepción escribió hace poco, así que el aviso va por TEXTO LIBRE; sin ella, por PLANTILLA. */
function pedido(nota: string, ventana: boolean) {
  const m = crear({ catalogo: catalogoOk({ mercado: 'AR', moneda: 'ARS' }, [itemAr]), modeloDice: modelo('Listo.', { lineas: [] }) });
  if (ventana) hablar(m, REC, mTexto('hola'));
  hablar(m, ARG, mTexto(pegadoAr(nota)));
  hablar(m, ARG, mToque('entrega:envio', 'Envío'));
  completarEnvio(m, ARG, 'AR');
  return hablar(m, ARG, mTexto('quiero pagar'));
}
/** Una nota de EXACTAMENTE 500 puntos de código, con familias de emoji (ZWJ) y emojis sueltos. */
const NOTA_500 = (() => {
  const base = 'Entregar 👨‍👩‍👧 temprano 🎁 y avisar al llegar 🚚. ';
  let s = '';
  while (puntos(s) < 500) s += base;
  return Array.from(s).slice(0, 500).join('');
})();
const sinParSustitutoSuelto = (s: string): boolean => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);

describe('obligatorio 2: la nota larga por PLANTILLA no se corta en silencio (remite a Pedidos)', () => {
  it('la nota de prueba tiene 500 puntos de código con emojis y ZWJ', () => {
    expect(puntos(NOTA_500)).toBe(500);
    expect(NOTA_500).toContain('‍');
    expect(NOTA_500.length).toBeGreaterThan(500);   // más unidades UTF-16 que puntos: el caso que cortaba mal
  });
  it('NEGADO: nota de 500 puntos con emojis y ZWJ, por plantilla: NO sale truncada; sale la frase fija, sin un fragmento de la nota, bien formada y como 1 aviso', () => {
    const t = pedido(NOTA_500, false);
    expect(t.avisos).toHaveLength(1);
    const c = String(t.avisos[0]!.cuerpo);
    expect(c).toContain(FRASE);
    expect(c).not.toContain(ROTULO);
    expect(c).not.toContain('Entregar');
    expect(sinParSustitutoSuelto(c)).toBe(true);
    expect(sinParSustitutoSuelto(JSON.stringify(t.avisos[0]!.payload))).toBe(true);
    expect(t.mensajes).toHaveLength(1);   // 0 mensajes agregados
  });
  it('por TEXTO LIBRE (dentro de la ventana) una nota de 440 puntos con emojis, que por plantilla no cabría, llega ENTERA, rotulada y sin la frase fija', () => {
    const nota = Array.from('🎁 Entregar en la calle 21, tocar el timbre dos veces y avisar al llegar 🚚. '.concat('Entregar en la calle 21, tocar el timbre dos veces y avisar al llegar. '.repeat(8))).slice(0, 440).join('').trim();
    const t = pedido(nota, true);
    expect(t.avisos).toHaveLength(1);
    const c = String(t.avisos[0]!.cuerpo);
    expect(c).toContain(ROTULO + nota);
    expect(c).not.toContain(FRASE);   // la limpieza común quita el ZWJ; el resto llega entero
  });
  it('nota corta por plantilla: sale ENTERA y rotulada (sin la frase fija)', () => {
    const nota = 'Entregar por la tarde 🎁, tocar el timbre dos veces.';
    const c = String(pedido(nota, false).avisos[0]!.cuerpo);
    expect(c).toContain(ROTULO + nota);
    expect(c).not.toContain(FRASE);
  });
  it('nota mediana (300 puntos) por plantilla: cabe entera con los ítems; no se cambia por la frase', () => {
    const nota = Array.from('Dejar el paquete con el portero del edificio y llamar al llegar. '.repeat(6)).slice(0, 300).join('').trim();
    const c = String(pedido(nota, false).avisos[0]!.cuerpo);
    expect(c).toContain(ROTULO + nota);
    expect(c).not.toContain(FRASE);
  });
  it('nota con palabras de pago por plantilla: sigue remitiendo a Pedidos (no «[texto omitido]»)', () => {
    const c = String(pedido('el anticipo ya está pagado, pago acreditado', false).avisos[0]!.cuerpo);
    expect(c).toContain(FRASE);
    expect(c).not.toMatch(/texto omitido|anticipo|acreditado/i);
  });
  it('sin nota, el aviso no cambia: ni rótulo ni frase fija', () => {
    const c = String(pedido('', false).avisos[0]!.cuerpo);
    expect(c).not.toContain(FRASE);
    expect(c).not.toContain(ROTULO);
  });
});
