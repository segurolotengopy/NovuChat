/**
 * LA SEÑA Y EL PREPAGO NO SE TOCAN — prueba de fuente (DISENO.md §4undecies.3).
 *
 * Son dos direcciones del dinero. La seña (`cobro.ts`, `sena.ts`, `cotejo.ts`,
 * `qrSimple.ts`) es el comercio cobrándole a su cliente; el prepago
 * (`cobrador.ts`, `cobroPrepago.ts`, `pagos-stub.ts`, y cuando existan
 * `prepago.ts` y `pagos.ts`) es NovuChat cobrándole al comercio. Comparten el
 * esquema de firma (`firma.ts`) y nada más. Ningún archivo del prepago importa
 * uno de la seña, ningún texto del prepago dice «seña», y ninguno de la seña
 * dice «mensualidad». Lee las fuentes, como `comportamiento-pantalla.test.ts`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const ruta = (archivo: string) => join(aqui, '..', 'functions', 'src', archivo);
const leer = (archivo: string) => readFileSync(ruta(archivo), 'utf8');

const DEL_PREPAGO = ['cobrador.ts', 'cobroPrepago.ts', 'pagos-stub.ts', 'prepago.ts', 'pagos.ts', 'pagosConCobrador.ts', 'cobranza.ts', 'tipoCambio.ts']
  .filter((a) => existsSync(ruta(a)));
const DE_LA_SENA = ['cobro.ts', 'sena.ts', 'cotejo.ts', 'qrSimple.ts'].filter((a) => existsSync(ruta(a)));

/** El cuerpo del archivo sin sus comentarios: lo que de verdad corre y lo que se muestra. */
const sinComentarios = (fuente: string) => fuente
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const importaciones = (fuente: string) =>
  [...fuente.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);

describe('Separación entre la seña y el prepago', () => {
  it('los archivos del prepago existen (control de que la prueba no pasa en vacío)', () => {
    expect(DEL_PREPAGO).toEqual(expect.arrayContaining(['cobrador.ts', 'cobroPrepago.ts']));
    expect(DE_LA_SENA).toEqual(expect.arrayContaining(['cobro.ts', 'sena.ts', 'cotejo.ts', 'qrSimple.ts']));
  });

  it('ningún archivo del prepago importa cobro.ts, sena.ts, cotejo.ts, qrSimple.ts ni dibujoQr.ts', () => {
    for (const archivo of DEL_PREPAGO) {
      const modulos = importaciones(leer(archivo));
      for (const prohibido of ['./cobro.js', './sena.js', './cotejo.js', './qrSimple.js', './dibujoQr.js']) {
        expect(modulos, `${archivo} importa ${prohibido}`).not.toContain(prohibido);
      }
    }
  });

  it('ningún archivo de la seña importa el prepago', () => {
    for (const archivo of DE_LA_SENA) {
      const modulos = importaciones(leer(archivo));
      for (const prohibido of ['./cobrador.js', './cobroPrepago.js', './pagos-stub.js', './pagos.js', './prepago.js']) {
        expect(modulos, `${archivo} importa ${prohibido}`).not.toContain(prohibido);
      }
    }
  });

  it('ningún texto del prepago dice «seña», y ninguno de la seña dice «mensualidad» (fuera de los comentarios que explican la separación)', () => {
    for (const archivo of DEL_PREPAGO) {
      expect(sinComentarios(leer(archivo)), `${archivo} menciona la seña`).not.toMatch(/se[ñn]a\b/i);
    }
    for (const archivo of DE_LA_SENA) {
      expect(sinComentarios(leer(archivo)), `${archivo} menciona la mensualidad`).not.toMatch(/mensualidad/i);
    }
  });

  it('los datos tampoco se cruzan: el prepago no toca `cobroReal` y la seña no toca `/pagos`', () => {
    for (const archivo of DEL_PREPAGO) expect(sinComentarios(leer(archivo))).not.toContain('cobroReal');
    for (const archivo of DE_LA_SENA) expect(sinComentarios(leer(archivo))).not.toMatch(/\/pagos\//);
  });

  it('el stub de A-1 se va cuando llega pagos.ts: cobroPrepago.ts no puede importar los dos', () => {
    const modulos = importaciones(leer('cobroPrepago.ts'));
    if (existsSync(ruta('pagos.ts'))) {
      expect(modulos, 'cobroPrepago.ts sigue importando el stub con pagos.ts ya en el repositorio').not.toContain('./pagos-stub.js');
      expect(existsSync(ruta('pagos-stub.ts')), 'pagos-stub.ts tiene que borrarse cuando exista pagos.ts').toBe(false);
      expect(modulos).toContain('./pagos.js');
    } else {
      // Hoy: el stub existe y es lo que se importa (control de que la vigilancia funciona).
      expect(existsSync(ruta('pagos-stub.ts'))).toBe(true);
      expect(modulos).toContain('./pagos-stub.js');
    }
  });

  it('el prepago SÍ puede decir «pago confirmado por el banco»; la seña, nunca', () => {
    const afirma = /pago confirmado|pago acreditado|pago verificado|recibimos tu pago/i;
    for (const archivo of DE_LA_SENA) {
      // La seña solo lo nombra en comentarios que explican la prohibición.
      expect(sinComentarios(leer(archivo)), `${archivo} afirma un pago`).not.toMatch(afirma);
    }
  });
});
