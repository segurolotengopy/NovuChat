/**
 * OCTAVA RONDA DEL #1142 (28/11/2026).
 *  - El bucle y la válvula por estado se prueban como conversaciones completas en `compuerta-1142-conversaciones.test.ts`.
 *  - Nota («Entera, una vez»): tope en puntos de código sin partir emojis; se conservan «&», «<», «>», ZWJ y `* _ ~`; se siguen quitando enlaces y controles; llega idéntica a la ficha, al mensaje y al aviso.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { LlamadaDoble } from '../../lib/n8n-de-mentira';
import { ANA, catalogoOk, crear, hablar, mTexto, mToque, modelo, textoAlModelo, textos } from './mundo';

const pieza = (id: string, nombre: string, precio: number): J => ({ id, nombre, descripcion: nombre, area: 'Hogar · Electro', precio, moneda: 'BOB', activo: true, precioCentavos: precio * 100, stock: 100, disponible: true });
const REAL = [pieza('lavadora-9kg', 'Lavadora Samsung 9 kg', 7655), pieza('licuadora-oster', 'Licuadora Oster', 4148), pieza('billetera-cuero', 'Billetera de cuero', 450)];
type Rep = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ficha = (m: ReturnType<typeof crear>): Rep => ((m.sd['casabermejo'] ?? {}) as Record<string, Rep>)[ANA] ?? {};

describe('«Tenemos 3 Billetera…»: una cantidad no verificada contra el catálogo no pasa', () => {
  const dice = (txt: string) => hablar(crear({ catalogo: catalogoOk({}, REAL as never), modeloDice: () => modelo(txt) }), ANA, mTexto('¿tienen billeteras?'));
  it('NEGADO: la cantidad inventada no sale; el precio del catálogo sí', () => {
    expect(textos(dice('Tenemos 3 Billetera de cuero a Bs 450.')).join(' ')).not.toContain('Tenemos 3');
    expect(textos(dice('Tenemos Billetera de cuero a Bs 450.')).join(' ')).toContain('Tenemos Billetera de cuero a Bs 450');
  });
});

describe('la nota llega entera y idéntica a la ficha, al mensaje y al aviso', () => {
  const pegado = (nota: string): string => `Hola, quiero comprar estos productos:\n1 x Billetera de cuero (cód. billetera-cuero): Bs 450 c/u, subtotal Bs 450\nTotal referencial: Bs 450\nNota: ${nota}`;
  const corre = (nota: string) => {
    const m = crear({ catalogo: catalogoOk({}, REAL as never), modeloDice: (ll: LlamadaDoble) => modelo('Listo.', { lineas: [], entrega: /^[A-Za-zÁ-ú ]{3,40}$/.test(textoAlModelo(ll)) ? { nombre: textoAlModelo(ll) } : {} }) });
    const t0 = hablar(m, ANA, mTexto(pegado(nota)));
    return { m, t0 };
  };
  for (const nota of ['Juan & Maria <3', 'regalo 👨‍👩‍👧 para *mamá* _hoy_ ~gracias~']) {
    it(`«${nota}» queda igual en la ficha y en el mensaje`, () => {
      const { m, t0 } = corre(nota);
      expect(ficha(m).nota).toBe(nota);
      expect(textos(t0).join(' ')).toContain('Nota del cliente: ' + nota);
    });
  }
  it('«Juan & Maria <3» llega idéntica al aviso (detalle de la línea del pedido)', () => {
    const { m } = corre('Juan & Maria <3');
    hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    const r = hablar(m, ANA, mTexto('Ana Pérez'));
    const id = [...JSON.stringify(r.mensajes.map((x) => x.payload)).matchAll(/"id":"(pedido:confirmar[^"]*)"/g)][0]?.[1];
    const q = hablar(m, ANA, mToque(id!, 'Confirmar pedido'));
    const ls = (q.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado') as Rep)['lineas'] as Rep[];
    expect(ls[0]!['detalle']).toBe('nota del cliente: Juan & Maria <3');
  });
  it('NEGADO: 500 emojis compuestos no se parten y el tope es de puntos de código', () => {
    const fam = '👨‍👩‍👧';
    const { m } = corre(fam.repeat(300));
    const n: string = ficha(m).nota;
    expect(Array.from(n).length).toBeLessThanOrEqual(500);
    expect(n.length % fam.length).toBe(0);   // solo familias enteras
    expect(n.replaceAll(fam, '')).toBe('');
    const { m: m2 } = corre('😀'.repeat(600));
    expect(Array.from(ficha(m2).nota).length).toBe(500);
    expect(ficha(m2).nota).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
  });
  it('NEGADO: un enlace y un dominio sí se quitan; los controles pasan a espacio', () => {
    const { m } = corre('mira https://malo.example/x y www.malo.com o malo.com ok\u0007fin');
    expect(ficha(m).nota).not.toMatch(/malo|https|www/);
    expect(ficha(m).nota).toContain('ok fin');
  });
});
