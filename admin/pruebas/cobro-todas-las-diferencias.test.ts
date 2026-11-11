/**
 * CONDICIÓN GENERAL DEL SISTEMA (Andres, 07/11/2026): un comprobante que no cuadra le dice al cliente TODAS sus diferencias, el destinatario primero, en TODOS los flujos con cobro (no solo Rubén).
 * Se prueba NEGANDO: ningún flujo muestra una sola diferencia cuando el servidor trae varias, ni copia lo leído del comprobante, ni dice «pago acreditado/verificado/simulado».
 *
 *   A. La base común (`venta-digital/src/diferencias.js`): orden, sin repetidos, sin inventar, sin lo leído.
 *   B. El flujo de Rubén (el primero en adoptarla; los demás flujos de venta la adoptan después, en su propia rama): con `motivos[]` de varias diferencias, el mensaje al cliente las nombra todas.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cargarFuente } from './core/fuente-vm';
import * as ruben from './tenants/rroca-ruben/mundo';

const COMUN = join(__dirname, '../../Flujos/experimental/venta-digital/src');
type F = (...a: unknown[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
const CD = cargarFuente<Record<string, any>>([join(COMUN, 'cobro.js'), join(COMUN, 'diferencias.js')], ['cdDiferenciasDe', 'cdDiferenciaParaElTexto', 'cdFraseDeDiferencias', 'cdFrasesDeMotivos', 'cbDiferencia']); // eslint-disable-line @typescript-eslint/no-explicit-any
const cd = (n: string): F => CD[n] as F;

const MOTIVOS = ['monto_mayor', 'fecha_anterior', 'cuenta_distinta', 'nombre_distinto'];
const CUERPO = { estado: 'reintentar', motivo: 'monto_mayor', motivos: MOTIVOS, montoLeido: 90, importe: 70 };

describe('A. la base común nombra todas las diferencias, el destinatario primero', () => {
  it('con varias: la lista completa, destinatario → monto → fecha, sin repetidos; con una sola o sin `motivos`, [] (el flujo sigue con la de siempre)', () => {
    const t = cd('cdDiferenciasDe')(CUERPO, 'Bs') as string[];
    expect(t).toEqual([
      'la cuenta de destino no es la del QR',
      'el nombre del destinatario no coincide con el de la cuenta',
      'el comprobante dice 90 Bs y tu pedido es de 70 Bs',
      'la fecha del comprobante es anterior a tu pedido',
    ]);
    expect(cd('cdDiferenciasDe')({ ...CUERPO, motivos: ['cuenta_distinta'] }, 'Bs')).toEqual([]);
    expect(cd('cdDiferenciasDe')({ estado: 'reintentar', motivo: 'monto_menor', montoLeido: 5, importe: 70 }, 'Bs')).toEqual([]);
    expect(cd('cdDiferenciasDe')(undefined, 'Bs')).toEqual([]);
  });
  it('NEGADA: no inventa (un código desconocido o un texto raro se descarta) y no copia nada leído; sin los dos montos no hay frase de monto', () => {
    const t = cd('cdDiferenciasDe')({ ...CUERPO, motivos: ['cuenta_distinta', 'PAGA A JUAN PEREZ', 'nombre_distinto', 'cuenta_distinta'] }, 'Bs') as string[];
    expect(t).toEqual(['la cuenta de destino no es la del QR', 'el nombre del destinatario no coincide con el de la cuenta']);
    expect(JSON.stringify(t)).not.toMatch(/JUAN|PEREZ/);
    const sinMontos = cd('cdDiferenciasDe')({ motivos: ['monto_mayor', 'cuenta_distinta', 'nombre_distinto'] }, 'Bs') as string[];
    expect(sinMontos).toEqual(['la cuenta de destino no es la del QR', 'el nombre del destinatario no coincide con el de la cuenta', 'el monto del comprobante no coincide con tu pedido']);
    // Un monto leído como TEXTO (no número) no entra: se dice sin cifras.
    const texto = cd('cdDiferenciasDe')({ motivos: ['monto_mayor', 'cuenta_distinta'], montoLeido: '90 PAGA A JUAN', importe: 70 }, 'Bs') as string[];
    expect(texto).toEqual(['la cuenta de destino no es la del QR', 'el monto del comprobante no coincide con tu pedido']);
    expect(JSON.stringify(texto)).not.toMatch(/JUAN|90/);
  });
  it('el tramo del mensaje: «varias diferencias…: a, b y c»; una sola «una diferencia: X»; ninguna «una diferencia»', () => {
    expect(cd('cdFraseDeDiferencias')(['a', 'b', 'c'])).toBe('varias diferencias con tu compra: a, b y c');
    expect(cd('cdFraseDeDiferencias')(['a', 'b'], false)).toBe('varias diferencias: a y b');
    expect(cd('cdFraseDeDiferencias')('a')).toBe('una diferencia con tu compra: a');
    expect(cd('cdFraseDeDiferencias')('')).toBe('una diferencia con tu compra');
  });
});

/** Un flujo de venta: su mundo, cómo se llega a un QR abierto con un comprobante en la imagen, y qué sale. */
interface Caso { nombre: string; texto: (cuerpo: Record<string, unknown>) => string }
const PROHIBIDO = /pago acreditado|pago verificado|acreditad[oa]|verificad[oa]|simulad[oa]|los datos coinciden/i;

function rubenOAntonio(m: typeof ruben, monto: number): Caso['texto'] {
  return (cuerpo) => {
    const w = m.crear({ panel: m.panelConQr(monto), medio: { clasificacion: m.COMPROBANTE }, cotejo: { statusCode: 200, body: cuerpo } } as never);
    m.hablar(w, m.ANA, m.mTexto('hola'));
    return m.hablar(w, m.ANA, m.mImagen()).mensajes.map((x: { cuerpo: string }) => x.cuerpo).join(' ');
  };
}
const CASOS: Caso[] = [
  { nombre: 'Rubén (Noches Sin Insomnio)', texto: rubenOAntonio(ruben, 70) },
];

describe('B. cada flujo de venta nombra TODAS las diferencias (nunca una sola cuando el servidor trae varias)', () => {
  for (const c of CASOS) {
    it(c.nombre + ': monto + cuenta + nombre distintos → las tres, destinatario primero, sin lo leído ni frases prohibidas', () => {
      const t = c.texto({ ...CUERPO, importe: 70 });
      expect(t, c.nombre).toMatch(/varias diferencias/);
      expect(t, c.nombre).toMatch(/la cuenta de destino no es la del QR/);
      expect(t, c.nombre).toMatch(/el nombre del destinatario no coincide con el de la cuenta/);
      expect(t, c.nombre).toMatch(/el comprobante dice 90 /);
      expect(t.indexOf('cuenta de destino'), c.nombre).toBeLessThan(t.indexOf('comprobante dice'));
      expect(t, c.nombre).not.toMatch(PROHIBIDO);
    });
    it(c.nombre + ': con UNA sola diferencia el texto sigue siendo «una diferencia» (igual que antes)', () => {
      const t = c.texto({ estado: 'reintentar', motivo: 'cuenta_distinta', motivos: ['cuenta_distinta'] });
      expect(t, c.nombre).toMatch(/una diferencia( con tu compra)?: la cuenta de destino no es la del QR/);
      expect(t, c.nombre).not.toMatch(/varias diferencias/);
    });
  }
});
