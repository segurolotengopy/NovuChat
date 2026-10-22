/**
 * Antonio PR-C, bloque 3: las palabras de pago de Bolivia y el cobro con medios que no son comprobante.
 *  (a) «cancelé / cancelado / cancelamos / voucher / recibo / abono / mi pago» cuentan como «ya pagué»; «cancelo mi pedido» sin «ya» no;
 *  (b) los cierres de pago con otras palabras los dice solo el código (`raExtraRedaccion` → `estado_de_pago`);
 *  (c) una foto o un PDF que NO es comprobante, con un cobro abierto, vencido o en revisión, ni cotiza ni avisa.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import { ANA, COMPROBANTE, REC, crear, hablar, mDocumento, mImagen, mTexto, panelConQr, textos } from './mundo';
import { vigilarUx } from './vigilante-ux';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RA = join(dirname(fileURLToPath(import.meta.url)), '../../../../Flujos/experimental/rroca-antonio');
// El código evaluado es el de los archivos del propio repositorio (src/lib), no una entrada externa: solo prueba.
// nosemgrep: devsecops.js-eval-prohibido
const ra = new Function(`${readFileSync(join(RA, 'src/lib/ra.js'), 'utf8')}\nreturn { raHablaDePagar, raExtraRedaccion, raNorm };`)() as { raHablaDePagar: (n: string) => boolean; raExtraRedaccion: (t: string, n: string) => string; raNorm: (t: string) => string };

describe('(a) «cancelé» es «ya pagué» en Bolivia', () => {
  it('cuentan como pago', () => {
    for (const t of ['ya cancelé', 'cancelé el libro', 'ya está cancelado', 'cancelamos ayer', 'te mando el voucher', 'mi recibo', 'hice un abono', 'mi pago ya salió']) expect(ra.raHablaDePagar(ra.raNorm(t)), t).toBe(true);
  });
  it('NEGANDO: «cancelo mi pedido» sin «ya» y un saludo no cuentan', () => {
    for (const t of ['cancelo mi pedido', 'quiero cancelar mi pedido', 'hola', 'cuánto cuesta el libro']) expect(ra.raHablaDePagar(ra.raNorm(t)), t).toBe(false);
  });
  it('punta a punta: tras un comprobante, «ya cancelé» es una queja de no entrega (aviso y botón), y «cancelo mi pedido» no', () => {
    const w = crear({ panel: panelConQr(49), medio: { clasificacion: COMPROBANTE } }); vigilarUx(w);
    hablar(w, ANA, mImagen());
    const t = hablar(w, ANA, mTexto('ya cancelé'));
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
    // «Cancelo mi pedido» con el QR abierto es una cancelación (PR-D, [C]): aviso y botón, pero NO una queja de no entrega ni un pago.
    const u = hablar(w, ANA, mTexto('cancelo mi pedido'));
    expect(u.ejecutados.has('Conversar con el modelo')).toBe(false);
    expect(u.mensajes[0]!.cuerpo).toMatch(/no puedo cancelar un pedido/);
    expect(u.mensajes[0]!.cuerpo).not.toMatch(/Antonio revisa los comprobantes|material/);
  });
});

describe('(b) cierres de pago con otras palabras', () => {
  it('«ya recibí todo», «todo listo con tu pago» y «coinciden… todo listo» dan estado_de_pago', () => {
    for (const t of ['Ya recibí todo, gracias.', 'Todo listo con tu pago.', 'Los datos coinciden, todo listo.']) expect(ra.raExtraRedaccion(t, ra.raNorm(t)), t).toBe('estado_de_pago');
  });
  it('NEGANDO: una frase corriente no se marca', () => {
    const t = 'Cuéntame un poco más de lo que viven en casa.';
    expect(ra.raExtraRedaccion(t, ra.raNorm(t))).toBe('');
  });
});

describe('(c) una foto o un PDF que no es comprobante no cotiza ni avisa (cobro abierto, vencido o en revisión)', () => {
  const paneles: Array<[string, { statusCode: number; body: J }]> = [
    ['abierto', panelConQr(49)],
    ['vencido', panelConQr(49, { cobro: { activo: true, qr: { url: 'https://qr.example.com/q.png' }, pendiente: false, monto: 49, pedido: 'AN1', vencidoHaceMin: 30, regla: 2 } })],
    ['en revisión', panelConQr(49, { cobro: { activo: true, qr: { url: 'https://qr.example.com/q.png' }, pendiente: false, monto: 49, pedido: 'AN1', regla: 2, enRevision: true } })],
  ];
  for (const [estado, panel] of paneles) {
    for (const [tipo, msg, mime] of [['foto', mImagen(), 'image/jpeg'], ['PDF', mDocumento(), 'application/pdf']] as const) {
      it(`${tipo} que no es comprobante con el cobro ${estado}: sin cotejo, sin aviso, texto fijo`, () => {
        const w = crear({ panel, medio: { clasificacion: { categoria: 'otro', texto: 'mi perro' }, mime } }); vigilarUx(w);
        const t = hablar(w, ANA, msg);
        expect(t.ejecutados.has('Cotejar en el servidor')).toBe(false);
        expect(t.llamadas.cotejo).toHaveLength(0);
        expect(t.avisos.filter((a) => a.a === REC)).toHaveLength(0);
        expect(textos(t)[0]).toMatch(/solo puedo leer texto y los comprobantes/);
      });
    }
  }
});
