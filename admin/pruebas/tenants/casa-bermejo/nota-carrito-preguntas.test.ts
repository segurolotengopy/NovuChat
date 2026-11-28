/**
 * QUINTA REVISIÓN DEL #1142 (Casa Bermejo, 27/11/2026), bloqueante de Estándar 5.9 e importante de 6.1.
 *   I-1 preguntas: con el pedido vacío, una pregunta del modelo NO sale por tener forma «¿…?»: pasa por los mismos detectores que una afirmación (agregado, hecho, promesa, posesión), sin borrar «que te …»,
 *   y toda pieza que nombra debe existir en el catálogo vivo. Si algo falla, sale el texto del código. La prueba es un GENERADOR CON SEMILLA (no una tabla fija) más las frases de las revisiones.
 *   6.1: el texto del procedimiento se arma por modo de cobro, mercado y modos de entrega; los medios de pago no cargados pasan con recepción (aviso + botón).
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { LlamadaDoble } from '../../lib/n8n-de-mentira';
import { ANA, ARGENTINO, CATALOGO, catalogoOk, crear, hablar, mTexto, modelo, panelSinCobro, textoAlModelo, textos, type Opciones } from './mundo';

const pieza = (id: string, nombre: string, precio: number): J => ({ id, nombre, descripcion: nombre, area: 'Hogar · Electro', precio, moneda: 'BOB', activo: true, precioCentavos: precio * 100, stock: 100, disponible: true });
const REAL = [pieza('lavadora-9kg', 'Lavadora Samsung 9 kg', 7655), pieza('licuadora-oster', 'Licuadora Oster', 4148), pieza('billetera-cuero', 'Billetera de cuero', 450)];
type Rep = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ficha = (m: ReturnType<typeof crear>): Rep => ((m.sd['casabermejo'] ?? {}) as Record<string, Rep>)[ANA] ?? {};
const SIN_PIEZA = /Aún no tengo claro/;

// Una conversación ya iniciada: el SEGUNDO turno es el que se prueba (pedido vacío, frase del modelo dada).
const conv = (frase: string, lineas: unknown[] = [], opc: Partial<Opciones> = {}): ReturnType<typeof crear> => {
  const m = crear({ catalogo: catalogoOk({}, REAL as never), modeloDice: (ll: LlamadaDoble) => (/saludo-inicial/.test(textoAlModelo(ll)) ? modelo('¿Qué pieza le interesa?') : modelo(frase, { lineas: lineas as never })), ...opc });
  hablar(m, ANA, mTexto('saludo-inicial hola'));
  return m;
};
const sale = (frase: string, lineas: unknown[] = []): string => textos(hablar(conv(frase, lineas), ANA, mTexto('¿qué venden?'))).join(' ');

// Generador con semilla (mulberry32): reproducible, y la semilla se imprime en el mensaje de cada caso.
const SEMILLA = 1127;
function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const elige = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)]!;

describe('I-1 preguntas del modelo con el pedido vacío (Estándar 5.9)', () => {
  const FRASES_R5 = ['¿Ya viste que te agregué el licor?', '¿Sabías que el licor de coca ya es tuyo?', '¿No es genial que ya tengas tu licor?', '¿Le interesa nuestro licor de coca artesanal?', '¿Qué tal si te envío el licor hoy mismo?', '¿Quiere también nuestra cocina a gas?'];
  for (const frase of FRASES_R5) {
    it(`NEGADO: «${frase}» no sale (líneas vacías, línea que no entró e id inventado): sale el texto del código`, () => {
      for (const lineas of [[], [{ id: 'licor-de-coca', cantidad: 1 }], [{ id: 'lavadora-9kg-X', cantidad: 1 }]]) {
        const m = conv(frase, lineas);
        const t = textos(hablar(m, ANA, mTexto('¿qué venden?'))).join(' ');
        expect(t).not.toContain(frase.replace(/[¿?]/g, ''));
        expect(t).toMatch(/Aún no tengo claro|No pude agregar esa pieza al pedido/);
        expect(ficha(m).carrito).toEqual([]);
      }
    });
  }
  it(`GENERADOR (semilla ${SEMILLA}): ninguna pregunta que afirma, promete o nombra una pieza inexistente sale`, () => {
    const r = azar(SEMILLA);
    const afirma = ['Ya viste que te {v} {p}', 'Sabías que {p} ya es tuyo', 'No es genial que ya tengas {p}', 'Notaste que te {v} {p} a tu pedido', 'Viste que {p} quedó en tu carrito'];
    const verbos = ['agregué', 'añadí', 'sumé', 'separé', 'reservé', 'guardé', 'dejé', 'agregue', 'puse'];
    const promete = ['Qué tal si te envío {p} hoy mismo', 'Te mando {p} mañana, ¿te parece', 'Quieres que te reserve {p} ya', 'Te regalo {p}, ¿te interesa', 'Te {v} {p} con descuento'];
    const inexistentes = ['el licor de coca', 'una bufanda', 'nuestra cocina a gas', 'el celular Samsung A15', 'unas zapatillas', 'una bicicleta'];
    const existentes = ['la Billetera de cuero', 'la Licuadora Oster', 'la Lavadora Samsung 9 kg'];
    const ofrece = ['Le interesa {p}', 'Quiere también {p}', 'Le muestro {p}', 'Prefiere {p}'];
    for (let i = 0; i < 90; i++) {
      const tipo = i % 3;
      const plantilla = elige(r, tipo === 0 ? afirma : tipo === 1 ? promete : ofrece);
      const p = elige(r, tipo === 2 ? inexistentes : [...inexistentes, ...existentes]);
      const frase = '¿' + plantilla.replace('{v}', elige(r, verbos)).replace('{p}', p) + '?';
      const lineas = elige(r, [[], [{ id: 'licor-de-coca', cantidad: 1 }], [{ id: 'billetera-cuero-X', cantidad: 1 }]]);
      // Una oferta de una pieza que SÍ existe («¿Le interesa la Billetera de cuero?») es legítima: solo las inexistentes y las demás categorías deben bloquearse.
      const legitima = tipo === 2 && existentes.includes(p);
      const t = sale(frase, lineas);
      if (legitima) continue;
      expect(t, `caso ${i}, semilla ${SEMILLA}: «${frase}»`).not.toContain(frase.slice(1, -1));
      expect(t, `caso ${i}, semilla ${SEMILLA}: «${frase}»`).toMatch(/Aún no tengo claro|No pude agregar esa pieza al pedido/);
    }
  });
  it('salen (falsos positivos conservados): preguntas legítimas sin afirmar, prometer ni nombrar piezas ajenas', () => {
    for (const frase of ['¿Qué otra pieza le interesa?', '¿Qué buscas hoy en nuestra tienda?', '¿Desea que agregue la billetera cuando guste?']) {
      expect(sale(frase)).toContain(frase);
    }
    // el modelo informa coincidencias reales con una pregunta al final
    expect(textos(hablar(conv('Tenemos Billetera de cuero a Bs 450. ¿Le interesa?'), ANA, mTexto('¿tienen billeteras?'))).join(' ')).toContain('Tenemos Billetera de cuero a Bs 450');
  });
  it('NEGADO: «que te …» ya no se borra: «Te aviso que te agregué la billetera» no sale', () => {
    expect(sale('Te aviso que te agregué la billetera.')).not.toContain('agregué');
  });
});

describe('6.1 el procedimiento y los medios de pago se dicen por lo que el comercio tiene cargado', () => {
  const pregunta = (m: ReturnType<typeof crear>, tel: string, texto: string): ReturnType<typeof hablar> => {
    hablar(m, tel, mTexto('hola'));
    return hablar(m, tel, mTexto(texto));
  };
  const modeloLibre = (ll: LlamadaDoble): J => modelo(/hola/i.test(textoAlModelo(ll)) && !/pag|compro|tarjeta|efectivo/.test(textoAlModelo(ll)) ? '¿Qué pieza le interesa?' : 'Con gusto.');
  const catAr = () => catalogoOk({ mercado: 'AR', moneda: 'ARS' }, [{ ...CATALOGO[1], moneda: 'ARS', precio: 450000, precioCentavos: 45000000, stock: 10, disponible: true }] as never);
  for (const usted of [false, true]) {
    const base = usted ? { base: { tratamiento: 'usted' } } : {};
    it(`Bolivia con QR (${usted ? 'usted' : 'tú'}): el pago se hace con un QR`, () => {
      expect(textos(pregunta(crear({ modeloDice: modeloLibre, ...base }), ANA, '¿cómo pago?')).join(' ')).toMatch(/QR/);
    });
    it(`Bolivia SIN cobro por QR (${usted ? 'usted' : 'tú'}): no nombra el QR; el pago lo coordina recepción`, () => {
      const t = textos(pregunta(crear({ modeloDice: modeloLibre, panel: panelSinCobro(), ...base }), ANA, '¿cómo pago?')).join(' ');
      expect(t).not.toMatch(/QR/);
      expect(t).toMatch(/recepción/);
      expect(t).toMatch(/«Confirmar pedido»/);
    });
    it(`Argentina (${usted ? 'usted' : 'tú'}): por transferencia a un alias, nunca un QR`, () => {
      const t = textos(pregunta(crear({ catalogo: catAr(), modeloDice: modeloLibre, ...base }), ARGENTINO, '¿cómo compro?')).join(' ');
      expect(t).not.toMatch(/QR/);
      expect(t).toMatch(/transferencia a un alias/);
    });
  }
  it('los modos de entrega salen de los que el comercio ofrece: solo retiro, solo envío', () => {
    const solo = (modos: string): string => textos(pregunta(crear({ modeloDice: modeloLibre, base: { modosDeEntrega: modos } }), ANA, '¿cómo compro?')).join(' ');
    expect(solo('Retiro en tienda')).toMatch(/que la retiras en tienda/);
    expect(solo('Retiro en tienda')).not.toMatch(/por envío/);
    expect(solo('Envío a domicilio')).toMatch(/que la recibes por envío/);
    expect(solo('Envío a domicilio')).not.toMatch(/retiras/);
  });
  for (const q of ['¿se puede pagar con tarjeta?', '¿aceptan efectivo?', '¿puedo pagar contra entrega?']) {
    it(`NEGADO: «${q}» no se afirma ni responde «Aún no tengo claro»: pasa con recepción (aviso + botón)`, () => {
      const t = pregunta(crear({ modeloDice: modeloLibre }), ANA, q);
      const todo = [...textos(t), ...t.mensajes.map((x) => JSON.stringify(x.payload))].join(' ');
      expect(todo).not.toMatch(SIN_PIEZA);
      expect(todo).not.toMatch(/aceptamos|sí se puede|si se puede/i);
      expect(t.avisos.length).toBeGreaterThanOrEqual(1);
      expect(todo).toMatch(/wa\.me/);
    });
  }
  it('el medio que SÍ está cargado se afirma: «¿se puede pagar con QR?» en Bolivia con cobro real responde el procedimiento', () => {
    const t = pregunta(crear({ modeloDice: modeloLibre }), ANA, '¿se puede pagar con QR?');
    expect(textos(t).join(' ')).toMatch(/el pago se hace con un QR/);
    expect(t.avisos.length).toBe(0);
  });
});
