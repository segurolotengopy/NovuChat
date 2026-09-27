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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAIZ, importsDe } from './frontera/frontera.ts';

/**
 * LOS ARCHIVOS SE BUSCAN POR NOMBRE EN TODO `functions/src` (F2, tanda cero):
 * F2 los mueve a `central/pagar/`, `modulos/cobros/` y `modulos/agenda/`, y
 * una lista filtrada por `existsSync` en la raíz los dejaba caer sin avisar.
 * Es la única guarda de que Cobros no importe Pagar: para la frontera de
 * zonas, módulo → Central es hacia abajo y está permitido.
 */
const FUENTES = 'admin/functions/src';
const todos = (dir: string): string[] => readdirSync(join(RAIZ, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? todos(`${dir}/${e.name}`) : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : []));
const ARCHIVOS = todos(FUENTES);
/** La ruta del archivo con ese nombre, esté en la carpeta que esté; null si no existe. */
const buscar = (nombre: string): string | null => {
  const hay = ARCHIVOS.filter((a) => a.endsWith(`/${nombre}`));
  if (hay.length > 1) throw new Error(`${nombre} aparece dos veces: ${hay.join(', ')}`);
  return hay[0] ?? null;
};
const leer = (archivo: string) => readFileSync(join(RAIZ, archivo), 'utf8');
const nombre = (a: string) => a.slice(a.lastIndexOf('/') + 1);

const DEL_PREPAGO = ['cobrador.ts', 'cobroPrepago.ts', 'pagos-stub.ts', 'prepago.ts', 'pagos.ts', 'pagosConCobrador.ts', 'cobranza.ts', 'tipoCambio.ts']
  .map(buscar).filter((a): a is string => a !== null);
const DE_LA_SENA = ['cobro.ts', 'sena.ts', 'cotejo.ts', 'qrSimple.ts'].map(buscar).filter((a): a is string => a !== null);

/** El cuerpo del archivo sin sus comentarios: lo que de verdad corre y lo que se muestra. */
const sinComentarios = (fuente: string) => fuente
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * Los NOMBRES de los archivos que importa, resueltos (el lector de la frontera):
 * `'./cobro.js'` y `'../../modulos/cobros/cobro.js'` son el mismo cobro.ts.
 */
const importaciones = (archivo: string) =>
  importsDe(archivo).map((i) => (i.destino ? nombre(i.destino) : i.especificador));

describe('Separación entre la seña y el prepago', () => {
  it('los archivos de las dos listas existen, todos (control de que la prueba no pasa en vacío)', () => {
    // Todos los de hoy: uno que se renombre no cae de la lista en silencio. El
    // único que falta a propósito es `pagos-stub.ts`, que se borró al llegar pagos.ts.
    expect(DEL_PREPAGO.map(nombre).sort()).toEqual(
      ['cobrador.ts', 'cobranza.ts', 'cobroPrepago.ts', 'pagos.ts', 'pagosConCobrador.ts', 'prepago.ts', 'tipoCambio.ts']);
    expect(DE_LA_SENA.map(nombre).sort()).toEqual(['cobro.ts', 'cotejo.ts', 'qrSimple.ts', 'sena.ts']);
  });

  it('todo import de los dos lados se resuelve (uno roto, calculado o por alias no se podría comparar)', () => {
    for (const archivo of [...DEL_PREPAGO, ...DE_LA_SENA]) {
      expect(importsDe(archivo).filter((i) => !i.destino).map((i) => i.especificador), archivo).toEqual([]);
    }
  });

  it('ningún archivo del prepago importa cobro.ts, sena.ts, cotejo.ts, qrSimple.ts ni dibujoQr.ts', () => {
    for (const archivo of DEL_PREPAGO) {
      const modulos = importaciones(archivo);
      for (const prohibido of ['cobro.ts', 'sena.ts', 'cotejo.ts', 'qrSimple.ts', 'dibujoQr.ts']) {
        expect(modulos, `${archivo} importa ${prohibido}`).not.toContain(prohibido);
      }
    }
  });

  it('ningún archivo de la seña importa el prepago', () => {
    for (const archivo of DE_LA_SENA) {
      const modulos = importaciones(archivo);
      for (const prohibido of ['cobrador.ts', 'cobroPrepago.ts', 'pagos-stub.ts', 'pagos.ts', 'prepago.ts', 'pagosConCobrador.ts', 'cobranza.ts']) {
        expect(modulos, `${archivo} importa ${prohibido}`).not.toContain(prohibido);
      }
    }
  });

  it('el lector ve los imports resueltos (control: cobroPrepago.ts importa pagos.ts)', () => {
    expect(importaciones(buscar('cobroPrepago.ts')!)).toContain('pagos.ts');
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
    const modulos = importaciones(buscar('cobroPrepago.ts')!);
    if (buscar('pagos.ts')) {
      expect(modulos, 'cobroPrepago.ts sigue importando el stub con pagos.ts ya en el repositorio').not.toContain('pagos-stub.ts');
      expect(buscar('pagos-stub.ts'), 'pagos-stub.ts tiene que borrarse cuando exista pagos.ts').toBeNull();
      expect(modulos).toContain('pagos.ts');
    } else {
      // Antes de pagos.ts: el stub existe y es lo que se importa.
      expect(buscar('pagos-stub.ts')).not.toBeNull();
      expect(modulos).toContain('pagos-stub.ts');
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
