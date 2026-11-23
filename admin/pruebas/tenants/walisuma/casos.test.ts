/**
 * LA TABLA DE CASOS de Walisuma (cuarta pasada de la revisión del PR #1020): frases reales con su resultado esperado, corridas contra el CÓDIGO REAL de los nodos (el JSON
 * versionado en el n8n de mentira). Cubre las cuatro reglas que se rompieron de una pasada a otra: la pregunta por la identidad, la captura de los datos de factura, el
 * enmascarado de números (antes del modelo y en el reporte entrante) y la negación implícita de ser una IA. Si una regla cambia, esta tabla dice qué frase se rompió.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo, ResultadoTurno } from '../../lib/n8n-de-mentira';
import { join } from 'node:path';
import { cargarFuente } from '../../core/fuente-vm';
import { ANA, CARPETA, COMPROBANTE, ENTREGA, cotejoValidoConCodigo, crear, hablar, mImagen, mTexto, modelo, panelConQr, panelOk, textos } from './mundo';

const corrio = (t: ResultadoTurno, n: string): boolean => t.registro.some((r) => r.nodo === n);

// ------------------------------------------------------------------------------------------------ 1. identidad
const IDENTIDAD: [string, boolean][] = [
  ['¿eres un bot?', true], ['¿Eres una IA? jaja', true], ['¿eres humano? quiero saber', true], ['¿es un bot? porque responde rápido', true],
  ['¿Es usted un robot?', true], ['¿es usted una persona?', true], ['¿Me atiende una persona?', true], ['erez un bot', true],
  ['¿Estoy chateando con una máquina?', true], ['¿hablo con un humano?', true], ['¿Es automático?', true], ['¿eres un robot o una persona?', true],
  ['¿es una persona de La Paz quien teje?', false], ['¿quién me atiende en la tienda?', false], ['¿es un programa de descuentos?', false],
  ['¿es una máquina de coser la que usan?', false], ['¿es cuero real?', false], ['¿el envío es automático?', false],
  ['¿Esto lo contesta una IA?', true], ['¿Eres chatGPT?', true], ['¿esto es chatgpt?', true],
];
describe('1 · la pregunta por la identidad', () => {
  for (const [frase, esperado] of IDENTIDAD) {
    it(`«${frase}» → ${esperado ? 'texto fijo que dice IA' : 'conversación'}`, () => {
      const t = hablar(crear({ modeloDice: modelo('Con gusto le ayudamos.') }), ANA, mTexto(frase));
      expect(textos(t).join(' ').includes('inteligencia artificial'), frase).toBe(esperado);
      expect(corrio(t, 'Conversar con el modelo'), frase).toBe(!esperado);
    });
  }
});

// ------------------------------------------------------------------------------------------------ 2. captura de factura (tras «Pedido confirmado»)
function pagado(): Mundo {
  const m = crear({ modeloDice: modelo('Con gusto, lo anotamos.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA }), medio: { clasificacion: COMPROBANTE }, cotejo: cotejoValidoConCodigo(450) });
  hablar(m, ANA, mTexto('una billetera'));
  hablar(m, ANA, mTexto('quiero pagar'));
  m.dobles['Traer configuración'] = () => panelConQr(450);
  hablar(m, ANA, mImagen({ caption: '' }));
  m.dobles['Traer configuración'] = () => panelOk();
  return m;
}
// [frase, NIT esperado | null (la factura sigue pedida) | 'sin' (S/N, decisión 10)]
const FACTURA: [string, string | null][] = [
  ['Razón social: Mariana Quiroga, NIT: 482910301', '482910301'], ['NIT 4455667 para mi pedido', '4455667'], ['NIT 4455667, gracias por el envío', '4455667'],
  ['Textiles Zona Sur SRL NIT 4455667', '4455667'], ['NIT1234567 Ana Pérez', '1234567'], ['N.I.T. 1234567', '1234567'], ['CI 71234567', '71234567'],
  ['NIT 1020 3040 5', '102030405'], ['Pedido WAL-251119-001, NIT 102030405', '102030405'], ['Mi NIT es 1234567, mi cel 71234567', '1234567'],
  ['NIT 1234567 tel 71234567', '1234567'], ['Por WhatsApp le paso el NIT 1234567', '1234567'], ['NIT １２３４５６７', '1234567'], ['Mariana Quiroga 482910301', '482910301'],
  ['Ana 71234567', null], ['Factura por favor 71234567', null], ['mi teléfono es 71234567', null], ['envío a calle Pinilla 12345', null],
  ['quiero otro pedido de 2 billeteras 123456', null], ['no necesito nada más, gracias', null],
  ['¿y la factura del pedido 251119-001?', null], ['la factura que sea por 12500 Bs', null], ['quiero otro pedido, 2 bufandas, NIT 4455667', null],
  ['Razón social: Textiles Andinos SRL, CI 4455667 LP', '4455667'], ['NIT 0', 'sin'],
];
describe('2 · la captura de los datos de factura tras el pago', () => {
  for (const [frase, nit] of FACTURA) {
    it(`«${frase}» → ${nit === null ? 'no son datos de factura' : `NIT ${nit}`}`, () => {
      const m = pagado();
      const t = hablar(m, ANA, mTexto(frase));
      const ficha = ((m.sd['walisuma'] ?? {}) as J)[ANA] as J;
      if (nit === 'sin') {
        expect(ficha['ultimoPedido']['factura'], frase).toBe('sin');
        expect(t.avisos, frase).toHaveLength(0); // 0 avisos extra: «S/N - NIT 0» ya viajó en el aviso del pedido
        return;
      }
      if (nit === null) {
        expect(ficha['ultimoPedido']['factura'], frase).toBe('pedida');
        expect(t.avisos.filter((a) => /datos de factura/.test(JSON.stringify(a.payload))), frase).toHaveLength(0);
      } else {
        expect(ficha['ultimoPedido']['factura'], frase).toBe('dada');
        const aviso = JSON.stringify(t.avisos[0]?.payload);
        expect(aviso, frase).toMatch(new RegExp(`NIT/CI: ${nit}\\b`));
        expect(aviso, frase).not.toMatch(/251119001/);
        // Los datos de factura nunca pasan por el modelo.
        expect(corrio(t, 'Conversar con el modelo'), frase).toBe(false);
      }
    });
  }
});

// ------------------------------------------------------------------------------------------------ 3. enmascarado (reporte entrante y modelo)
const reporte = (t: ResultadoTurno): string => String(t.registro.find((r) => r.nodo === 'Reportar mensaje (entrante)')?.cuerpo?.['texto'] ?? '');
const ENMASCARADO: [string, string[], string[]][] = [
  // [frase, lo que NO puede quedar, lo que SÍ queda]
  ['Juan Pérez 1234567', ['1234567'], ['Juan Pérez']], ['NIT 123 4567', ['123 4567'], []], ['NIT 12 345 678', ['12 345 678'], []], ['CI: 1 2 3 4 5 6 7', ['1 2 3 4 5 6 7'], []],
  ['NIT 123\n4567', ['123\n4567'], []], ['NIT 1,234,567', ['1,234,567'], []], ['NIT 1/234/567', ['1/234/567'], []], ['NIT 123–4567', ['123–4567'], []],
  ['NIT １２３４５６７', ['１２３４５６７', '1234567'], []], ['CI 71234567', ['71234567'], []], ['mi documento es 12.345.678', ['12.345.678'], []],
  ['pedido WAL-251119-001', [], ['WAL-251119-001']], ['pedido wal-251119-001', [], ['wal-251119-001']], ['mi cel 71234567', [], ['71234567']],
  ['Av. Arce 2132\n71234567', [], ['2132', '71234567']], ['Torre 10500, piso 3', [], ['10500']], ['Nº 12345', [], ['12345']], ['quiero 10000 unidades', [], ['10000']],
  ['presupuesto 15.000 Bs', [], ['15.000']], ['para el 19.11.2026', [], ['19.11.2026']], ['mi fijo es 2 2412345', ['2412345'], []],
  ['fecha 2026-11-19', [], ['2026-11-19']], ['NIT 123\u20104567', ['4567'], []], ['NIT 123\u22124567', ['4567'], []], ['NIT 123 · 4567', ['4567'], []],
  ['NIT 123\u200b4567', ['4567'], []], ['NIT 123 . 4567', ['4567'], []], ['CI ٧١٢٣٤٥٦٧', ['٧١٢٣٤٥٦٧'], []], ['Mi carnet es 12,345,678 y quiero 2 chompas', ['12,345,678'], ['2 chompas']],
  // RIESGO RESIDUAL DECLARADO (PROPIO.md): sin etiqueta, un número partido por comas o espacios no se enmascara.
  ['Ana 12,345,678', [], ['12,345,678']], ['mi tarjeta 4111 1111 1111 1111', [], ['4111 1111 1111 1111']],
];
describe('3 · el enmascarado de números (reporte entrante y modelo, la misma función)', () => {
  for (const [frase, no, si] of ENMASCARADO) {
    it(`«${frase.replaceAll('\n', '⏎')}»`, () => {
      let alModelo = '';
      const t = hablar(crear({ modeloDice: (ll) => { alModelo = String((((ll.cuerpo as J)['contents'] as J[]).slice(-1)[0] as J)?.['parts']?.[0]?.text ?? ''); return modelo('Con gusto.'); } }), ANA, mTexto(frase));
      const r = reporte(t);
      for (const x of no) {
        expect(r, `reporte: ${frase}`).not.toContain(x);
        if (alModelo) expect(alModelo, `modelo: ${frase}`).not.toContain(x);
      }
      for (const x of si) {
        expect(r, `reporte: ${frase}`).toContain(x);
        if (alModelo) expect(alModelo, `modelo: ${frase}`).toContain(x);
      }
    });
  }
});

// ------------------------------------------------------------------------------------------------ 4. negación implícita (lo que dice el modelo)
const NEGACION: [string, boolean][] = [
  ['Soy Carla.', false], ['Hola, soy Carla 😊', false], ['Soy Carla, asesora de Walisuma', false], ['Le saluda Carla', false], ['Le atiende Carla.', false],
  ['Te saluda Carla, de ventas.', false], ['Habla Carla, de ventas.', false], ['Soy la encargada Carla', false], ['Le atiende la señorita Carla', false], ['me llamo carla', false],
  ['Hola, le atiende Tienda Walisuma.', true], ['Le escribe Atención al cliente de Walisuma.', true], ['Soy Asistente virtual de Walisuma', true], ['Le atiende La encargada en tienda.', true],
  ['Para el recojo, le atiende Doña Rosa en la tienda de Calacoto.', true], ['Me llamó la atención su pregunta: la bufanda es de vicuña.', true], ['Soy el asistente de atención y ventas.', true],
  ['¡Claro! Aquí, Bufanda Vicuña Clásica: Bs 2.500.', true], ['¡Por supuesto! Aquí Tiene nuestras bufandas.', true], ['Aquí La Paz tiene frío, una bufanda abriga.', true],
  ['En la tienda Le atiende Sopocachi.', true], ['Le atiende Rosa en la tienda.', true], ['Saludos de Walisuma.', true],
  ['Saludos, Carla', false], ['Un saludo, Lucía.', false], ['Atentamente, Carla - Walisuma', false], ['Con gusto, Carla aquí.', false], ['Atte. Carla', false], ['Soy CARLA', false],
  ['Aquí Carla, para servirle.', false],
];
// `wlSeguro` del archivo REAL del flujo (la barrera que se aplica a todo lo que sale): «sale» = lo deja igual. Las que NO salen se prueban además en el flujo entero.
const WL = cargarFuente<{ wlSeguro: (t: string) => string }>([join(CARPETA, '../../experimental/venta-digital/src/cobro.js'), join(CARPETA, '../../src/core/texto/identidad.js'), join(CARPETA, 'src/lib/wl.js')], ['wlSeguro']);
describe('4 · la negación implícita de ser una IA (lo que redacta el modelo)', () => {
  for (const [frase, sale] of NEGACION) {
    it(`«${frase}» → ${sale ? 'sale' : 'NO sale'}`, () => {
      expect(WL.wlSeguro(frase) === frase, frase).toBe(sale);
      if (!sale) expect(textos(hablar(crear({ modeloDice: modelo(frase) }), ANA, mTexto('hola'))).join(' ').includes(frase), frase).toBe(false);
    });
  }
});

// ------------------------------------------------------------------------------------------------ 5. la memoria de la charla (dos turnos)
describe('5 · un carnet o una cédula no vuelve al modelo en el turno siguiente (memoria con el mismo enmascarado)', () => {
  for (const [frase, numero] of [['Mi carnet es 12,345,678 y quiero 2 chompas', '12,345,678'], ['mi cédula 1/234/567', '1/234/567'], ['ci １２３４５６７', '1234567'], ['mi CI es 1234–567', '1234–567']] as const) {
    it(`«${frase}»: ni en el turno 1 ni en la memoria del turno 2`, () => {
      const cuerpos: string[] = [];
      const m = crear({ modeloDice: (ll) => { cuerpos.push(JSON.stringify(ll.cuerpo)); return modelo('Con gusto le ayudamos.'); } });
      hablar(m, ANA, mTexto(frase));
      hablar(m, ANA, mTexto('¿y qué colores tienen?'));
      for (const c of cuerpos) {
        expect(c, frase).not.toContain(numero);
        expect(c, frase).not.toContain(numero.replace(/\D/g, ''));
      }
      expect(JSON.stringify(m.sd), frase).not.toContain(numero.replace(/\D/g, ''));
    });
  }
});
