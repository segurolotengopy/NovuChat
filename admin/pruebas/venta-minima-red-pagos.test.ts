/**
 * LA RED DE FRASES PROHIBIDAS DE «VENTA MÍNIMA» ATRAPA CUALQUIER FORMA DE «YA TENEMOS TU PLATA» (PROHIBICIÓN 3 de CLAUDE.md).
 *
 * Con cobro real, el asistente NUNCA dice «pago acreditado», «pago verificado» ni «recibimos tu pago»: el OCR de un
 * comprobante no es una acreditación bancaria; quien confirma que entró la plata es el banco y el negocio. La red tenía huecos
 * (hallazgo de seguridad del 03/10/2026 sobre el módulo del Demo B, extendido a Q'Taco): «recibimos SU pago», «transferencia
 * recibida», «depósito recibido», «ya llegó tu pago», «hemos recibido su pago o depósito».
 *
 * La red existe en TRES copias (`comun.js`, `cobro.js`, `avisos.js`) porque cada librería se prueba sola. Esta suite recorre las
 * tres con las mismas frases —escritas ACÁ, no importadas— y exige también que NO se disparen con lo honesto («recibí tu
 * comprobante», «revisen el pago en su banco»). Cada copia se compara con su propia canonización (NFKC, sin acentos, minúsculas).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar } from './lib/flujo';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/venta-minima/src/lib');
const leer = (f: string) => readFileSync(join(RAIZ, f), 'utf8');

type Red = { nombre: string; re: RegExp; canon: (t: string) => string };
function cargar(archivo: string, constante: string, canon: string): Red {
  const r = ejecutar(`${leer(archivo)}\nreturn [{ json: { re: ${constante}, canon: ${canon} } }];`, [{}])[0] as { re: RegExp; canon: (t: string) => string };
  return { nombre: archivo, re: r.re, canon: r.canon };
}
const REDES: Red[] = [
  cargar('comun.js', 'VM_PROHIBIDAS', 'vmCanon'),
  cargar('cobro.js', 'CB_PROHIBIDAS', 'cbCanon'),
  cargar('avisos.js', 'AV_PROHIBIDAS', 'avCanon'),
];

// Las formas que NUNCA puede decir el asistente (cliente o restaurante). Incluye las del hallazgo y variantes de persona y de medio.
const PROHIBIDAS = [
  'Recibimos tu pago.', 'Recibimos el pago', 'Recibimos su pago', 'Ya recibimos tu pago', 'Hemos recibido su pago o depósito',
  'Recibí tu pago', 'recibimos tu transferencia', 'Recibimos su transferencia', 'Recibimos tu depósito', 'recibimos el abono',
  'pago recibido', 'Pago recibido ✅', 'transferencia recibida', 'depósito recibido', 'depósito ya recibido', 'abono recibido',
  'pago acreditado', 'transferencia acreditada', 'pago verificado', 'depósito verificado',
  'tu pago fue confirmado', 'el pago fue confirmado', 'tu transferencia fue confirmada', 'el pago está confirmado', 'pago confirmado',
  'Ya llegó tu pago', 'Llegó tu pago', 'llegó el pago', 'tu pago ya llegó', 'su transferencia ingresó', 'tu depósito entró',
  'pago aprobado', 'pago exitoso', 'pago realizado', 'pago registrado', 'transferencia realizada', 'depósito efectuado',
  'RECIBIMOS SU PAGO', 'Recibimos  su   pago', 'recibimos su pago',
  // Hallazgo de seguridad (04/10), formas graves y medias que la primera red dejaba pasar
  'gracias por tu pago', 'verificamos tu pago', 'ya tenemos tu pago', 'vimos tu pago', 'aceptamos tu pago', 'comprobamos tu pago',
  'confirmamos que pagaste', 'ingresó tu pago', 'llegó la transferencia', 'la transferencia ya llegó', 'llegaron tus pagos',
  'tus pagos ya llegaron', 'el dinero llegó', 'la plata ya llegó', 'recibimos el dinero', 'recibimos la plata', 'recibimos 155 Bs',
  'pago aceptado', 'pago completado', 'pago procesado', 'tu pago fue procesado', 'cobro exitoso', 'cobro realizado', 'cobro aprobado',
  'tu pago se reflejó', 'pago listo', 'pago ok', 'tu pago está ok', 'tu pago está completo', 'todo en orden con tu pago', 'quedó saldado',
  'tu cuenta quedó saldada', 'tu pedido está cancelado', 'ya nos pagaste', 'gracias por pagar', 'ya pagaste, gracias', 'PAGO ACEPTADO POR EL BANCO',
  'gracias por tu pago jeje',
];
// Lo honesto: el comprobante llegó, los datos coinciden o no, y quien confirma es el banco.
const HONESTAS = [
  'Recibí tu comprobante y los datos coinciden con tu pedido.', 'Recibí tu comprobante, pero no pude revisarlo.',
  'Revisen el pago en su banco antes de entregar.', 'El pago se coordina con el restaurante al recibir tu pedido.',
  'Envíame aquí la foto o el PDF de tu comprobante.', 'Si ya hiciste tu pago, envíame el comprobante.',
  'Total de la comida: 155 Bs.', 'Escanea el QR con la app de tu banco.', 'Tu pedido sigue guardado.',
  'Estoy esperando el comprobante de tu pedido.',
  // Redacción de Venta mínima (04/10): los textos nuevos de cara al cliente no disparan la red.
  'Ya lo pasé al restaurante; ellos revisan el pago en su banco antes de despacharlo.',
  'Ya lo pasé al restaurante, con los datos que leí, para que lo revisen. Guárdalo por si te lo piden. Si quieres hablar con ellos, toca el botón.',
  'Ya lo pasé al restaurante como pedido de PRUEBA.',
  'Listo, Ana: tu solicitud llegó al restaurante, pero todavía no es una reserva: ellos la revisan según sus mesas. Toca el botón si quieres hablar con ellos.',
  'No pude incluir tu nota: «tequila» no está disponible por este medio.', 'Para volver al inicio, escribe «menú».',
  // Correcciones de conversación (04/10).
  'Tu pedido #K7Q2 está guardado; falta tu comprobante: envíame aquí la foto o el PDF.',
  'Tu pedido #K7Q2 está guardado; falta tu comprobante SIMULADO (es una prueba: no se paga nada): envíame aquí cualquier foto.',
  'Tengo: jueves 8 de octubre a las 19:00, 2 personas, aniversario. Me falta: a nombre de quién (nombre y apellido).',
  'Disculpa, no me quedó claro. Tengo: jueves 8 de octubre, 2 personas. Me falta: la hora. Escribe la hora así: «19:00».',
  'Para cambiar tu pedido, vuelve a elegir todo desde la carta: lo que elijas ahí reemplaza tu pedido actual (hoy tienes: 1 × Horchata, 2 × Gaseosas, … y 2 más). Si prefieres dejarlo como estaba, toca «Dejarlo como estaba».',
  'Para cambiar tu pedido, vuelve a elegir todo desde la carta: lo que elijas ahí reemplaza tu pedido actual (hoy tienes: 1 × Horchata). Si prefieres dejarlo como estaba, escribe «dejarlo como estaba».', 'Dejarlo como estaba',
  'Para tu solicitud de reserva tengo: jueves 8 de octubre a las 19:00, 2 personas, celebración: aniversario, pedido especial: mesa tranquila. Me falta: a nombre de quién (nombre y apellido).',
  'Esto prefiero que lo vea una persona del restaurante 🙂. Toca «Escribir al local» para hablar con ellos. Tu pedido sigue guardado.',
  'Esto prefiero que lo vea una persona del restaurante 🙂. Toca «Escribir al local» para hablar con ellos.',
  'Cuando tu pago llegue al banco, ellos lo revisan.', 'Tu depósito ingresará en 24 horas según tu banco.', 'Si ya pagaste, envíame el comprobante.', 'Cancelar pedido', 'Hemos recibido tu comprobante de pago.', 'El delivery no está incluido: se lo pagas al repartidor al recibir.',
];

describe.each(REDES)('red de prohibidas de $nombre', (red) => {
  it('atrapa cada forma de «recibimos tu plata» (con su canonización: acentos, mayúsculas, espacios)', () => {
    for (const f of PROHIBIDAS) {
      const atrapada = red.re.test(red.canon(f)); // el mismo predicado que producción (forma canónica)
      expect(atrapada, `${red.nombre} deja pasar: «${f}»`).toBe(true);
    }
  });
  it('no se dispara con lo honesto (el caso opuesto)', () => {
    for (const f of HONESTAS) {
      expect(red.re.test(red.canon(f)), `${red.nombre} bloquea lo honesto: «${f}»`).toBe(false);
      expect(red.re.test(f), `${red.nombre} bloquea lo honesto: «${f}»`).toBe(false);
    }
  });
});

describe('las tres redes dicen lo mismo', () => {
  it('cada frase se atrapa o se deja pasar igual en las tres copias', () => {
    for (const f of [...PROHIBIDAS, ...HONESTAS]) {
      const veredictos = REDES.map((r) => r.re.test(r.canon(f)));
      expect(new Set(veredictos).size, `las copias discrepan con «${f}»: ${veredictos.join(',')}`).toBe(1);
    }
  });
});
