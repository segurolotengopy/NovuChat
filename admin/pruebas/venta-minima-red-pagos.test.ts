/**
 * LA RED DE FRASES PROHIBIDAS DE «VENTA MÍNIMA» ATRAPA CUALQUIER FORMA DE «YA TENEMOS TU PLATA» (PROHIBICIÓN 3 de CLAUDE.md).
 *
 * Con cobro real, el asistente NUNCA dice «pago acreditado», «pago verificado» ni «recibimos tu pago»: el OCR de un
 * comprobante no es una acreditación bancaria; quien confirma que entró la plata es el banco y el negocio. La red tenía huecos
 * (hallazgo de seguridad del 04/10/2026 sobre el módulo del Demo B, extendido a Q'Taco): «recibimos SU pago», «transferencia
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
];
// Lo honesto: el comprobante llegó, los datos coinciden o no, y quien confirma es el banco.
const HONESTAS = [
  'Recibí tu comprobante y los datos coinciden con tu pedido.', 'Recibí tu comprobante, pero no pude revisarlo.',
  'Revisen el pago en su banco antes de entregar.', 'El pago se coordina con el restaurante al recibir tu pedido.',
  'Envíame aquí la foto o el PDF de tu comprobante.', 'Si ya hiciste tu pago, envíame el comprobante.',
  'Total de la comida: 155 Bs.', 'Escanea el QR con la app de tu banco.', 'Tu pedido sigue guardado.',
  'Estoy esperando el comprobante de tu pedido.', 'El delivery no está incluido: se lo pagas al repartidor al recibir.',
];

describe.each(REDES)('red de prohibidas de $nombre', (red) => {
  it('atrapa cada forma de «recibimos tu plata» (con su canonización: acentos, mayúsculas, espacios)', () => {
    for (const f of PROHIBIDAS) {
      const atrapada = red.re.test(red.canon(f)) || red.re.test(f);
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
      const veredictos = REDES.map((r) => r.re.test(r.canon(f)) || r.re.test(f));
      expect(new Set(veredictos).size, `las copias discrepan con «${f}»: ${veredictos.join(',')}`).toBe(1);
    }
  });
});
